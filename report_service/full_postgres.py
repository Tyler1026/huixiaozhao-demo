"""FullStore on PostgreSQL, including durable delivery bytes.

Reuse the fenced state machine. A transaction advisory lock gives the same
serialization as SQLite BEGIN IMMEDIATE across hosts. Disk is only a private
bundle-building scratch area; completed artifacts live in the database.
"""
import contextlib
import hashlib

from .full_store import FullStore


class _Connection:
    def __init__(self, connection):
        from psycopg2.extras import DictCursor
        self.cursor = connection.cursor(cursor_factory=DictCursor)

    def execute(self, sql, parameters=()):
        if sql == 'BEGIN IMMEDIATE':
            sql, parameters = 'SELECT pg_advisory_xact_lock(%s)', (725490185321,)
        # SQLite's boolean binding is INTEGER; keep the persisted schema/API.
        parameters = tuple(int(value) if type(value) is bool else value for value in parameters)
        self.cursor.execute(sql.replace('?', '%s'), parameters)
        return self.cursor

    def executescript(self, sql):
        self.execute('BEGIN IMMEDIATE')
        self.cursor.execute(sql.replace('INTEGER PRIMARY KEY AUTOINCREMENT',
                                       'BIGSERIAL PRIMARY KEY').replace('REAL', 'DOUBLE PRECISION'))


class PostgresFullStore(FullStore):
    def __init__(self, database_url, **kwargs):
        # DSN stays in memory and never becomes a path, error, or CLI argument.
        if not isinstance(database_url, str) or not database_url:
            raise ValueError('report database is required')
        self._database_url = database_url
        super().__init__('postgres-store', **kwargs)
        with self.db() as c:
            c.executescript('''CREATE TABLE IF NOT EXISTS full_artifact_bytes (
                report_id TEXT NOT NULL REFERENCES full_reports(id),
                name TEXT NOT NULL, sha256 TEXT NOT NULL, data BYTEA NOT NULL,
                PRIMARY KEY(report_id,name));''')

    @contextlib.contextmanager
    def db(self):
        import psycopg2
        connection = psycopg2.connect(self._database_url, connect_timeout=10)
        wrapper = None
        try:
            wrapper = _Connection(connection)
            wrapper.execute("SET LOCAL lock_timeout = '5s'")
            wrapper.execute("SET LOCAL statement_timeout = '15s'")
            with connection:
                yield wrapper
        finally:
            if wrapper:
                wrapper.cursor.close()
            connection.close()

    def worker_parts(self, report_id):
        """Pass committed inputs, rather than database credentials, to a child."""
        return self.parts(report_id)

    def complete(self, sid, token, manifest):
        from .full_artifacts import _bundle_fd, _verify
        if not isinstance(manifest, dict) or self.artifact_root is None:
            return False
        rid = manifest.get('report_id')
        try:
            with _bundle_fd(self.artifact_root, rid) as fd:
                contents = _verify(fd, rid, manifest)
        except (OSError, ValueError, KeyError, TypeError):
            return False
        # Store all bytes before completed can be acknowledged. A crash between
        # transactions leaves resumable work, never a completed missing bundle.
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            row = self._owned(c, sid, token)
            if not row or row['stage'] != '__bundle__' or row['report_id'] != rid:
                return False
            report = c.execute('SELECT synthetic FROM full_reports WHERE id=?', (rid,)).fetchone()
            if manifest.get('synthetic') is not bool(report['synthetic']):
                return False
            for name, data in contents.items():
                checksum = hashlib.sha256(data).hexdigest()
                old = c.execute('SELECT sha256 FROM full_artifact_bytes WHERE report_id=? AND name=?',
                                (rid, name)).fetchone()
                if old and old['sha256'] != checksum:
                    raise ValueError('immutable artifact conflict')
                c.execute('INSERT INTO full_artifact_bytes VALUES(?,?,?,?) ON CONFLICT DO NOTHING',
                          (rid, name, checksum, data))
        return super().complete(sid, token, manifest)

    def artifact(self, tenant, report_id, name):
        """Serve only a completed, tenant-owned, manifest-verified payload."""
        report = self.get(tenant, report_id)
        if not report or report['status'] != 'completed':
            raise ValueError('report is not complete')
        entry = next((e for e in report['manifest']['files'] if e['name'] == name), None)
        if not entry:
            raise ValueError('unlisted artifact')
        with self.db() as c:
            row = c.execute('SELECT data,sha256 FROM full_artifact_bytes WHERE report_id=? AND name=?',
                            (report_id, name)).fetchone()
        if not row:
            raise ValueError('missing durable artifact')
        data = bytes(row['data'])
        if (len(data) != entry['bytes'] or row['sha256'] != entry['sha256']
                or hashlib.sha256(data).hexdigest() != entry['sha256']):
            raise ValueError('artifact integrity failure')
        return data
