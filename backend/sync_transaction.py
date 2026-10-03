"""Serialize legacy sync read/merge/write without changing its merge policy.

Commit precedes the HTTP acknowledgement. PostgreSQL protects the singleton
row across processes; the local fallback uses a file lock and atomic replace.
"""
import contextlib
import dataclasses
import json
import os
import tempfile
import time


class PostgresSession:
    def __init__(self, connect, snapshot):
        self.connect = connect
        self.snapshot = snapshot
        self.connection = self.cursor = None
        self.committed = False

    def __enter__(self):
        try:
            self.connection = self.connect()
            self.cursor = self.connection.cursor()
            self.cursor.execute("SET LOCAL lock_timeout = '5s'")
            self.cursor.execute("SET LOCAL statement_timeout = '15s'")
            self.cursor.execute("INSERT INTO sync_data(id,data) VALUES(1,'{}') ON CONFLICT(id) DO NOTHING")
            self.cursor.execute('SELECT data FROM sync_data WHERE id=1 FOR UPDATE')
            row = self.cursor.fetchone()
            if row is None:
                raise RuntimeError('storage unavailable')
            self.current = row[0]
            return self
        except Exception:
            self.__exit__(None, None, None)
            raise

    def read(self):
        return self.current

    def write(self, value):
        try:
            self.snapshot(self.cursor)
            self.cursor.execute('UPDATE sync_data SET data=%s,updated_at=NOW() WHERE id=1', (value,))
            self.connection.commit()
            self.committed = True
            return True
        except Exception:
            return False

    def __exit__(self, *args):
        try:
            if self.connection and not self.committed:
                self.connection.rollback()
        finally:
            try:
                if self.cursor:
                    self.cursor.close()
            finally:
                if self.connection:
                    self.connection.close()


@contextlib.contextmanager
def postgres_session():
    from . import storage
    def connect():
        return storage.psycopg2.connect(storage.DATABASE_URL, connect_timeout=10)
    with PostgresSession(connect, storage._db_snapshot) as session:
        yield session


def read_sync_bounded():
    """Keep the legacy JSON/None contract, with bounded I/O and no leaked session."""
    from . import storage
    connection = cursor = None
    try:
        connection = storage.psycopg2.connect(storage.DATABASE_URL, connect_timeout=10)
        cursor = connection.cursor()
        cursor.execute("SET LOCAL statement_timeout = '15s'")
        cursor.execute('SELECT data FROM sync_data WHERE id=1')
        row = cursor.fetchone()
        return row[0] if row else '{}'
    except Exception:
        return None
    finally:
        try:
            if cursor:
                cursor.close()
        finally:
            if connection:
                connection.close()


def write_sync_bounded(value):
    """Keep the legacy bool contract and snapshot-before-write semantics."""
    try:
        with postgres_session() as session:
            return session.write(value)
    except Exception:
        return False


@contextlib.contextmanager
def file_session(path, snapshot):
    import fcntl
    with open(path + '.lock', 'a') as lock:
        end = time.monotonic() + 5
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= end:
                    raise TimeoutError('storage busy')
                time.sleep(.02)
        class Session:
            def read(self):
                try:
                    with open(path, encoding='utf-8') as stream:
                        return stream.read()
                except FileNotFoundError:
                    return '{}'
            def write(self, value):
                tmp = None
                try:
                    snapshot()
                    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=os.path.dirname(os.path.abspath(path)), delete=False) as stream:
                        tmp = stream.name
                        stream.write(value)
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.replace(tmp, path)
                    return True
                except Exception:
                    return False
                finally:
                    if tmp and os.path.exists(tmp):
                        os.unlink(tmp)
        try:
            yield Session()
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def handle_sync_serialized(handler, raw, deps, *, transaction=None):
    from .sync_route import handle_sync
    # Explicit injection keeps isolated HTTP tests away from real credentials.
    if deps.use_database and transaction is None:
        return handle_sync(handler, raw, deps)
    try:
        factory = transaction() if deps.use_database else file_session(deps.file_path, deps.snapshot_file)
        with factory as session:
            return handle_sync(handler, raw, dataclasses.replace(deps, use_database=True, read=session.read, write=session.write))
    except (BrokenPipeError, ConnectionResetError):
        # A committed write survives a disconnected browser. Retrying its same
        # report request ID is safe; never roll back a confirmed database commit.
        return
    except Exception:
        body = json.dumps({'ok': False, 'error': 'storage unavailable; retry safely'}).encode()
        handler.send_response(200)
        handler.send_header('Content-Type', 'application/json')
        handler.send_header('Content-Length', str(len(body)))
        handler.cors(); handler.end_headers(); handler.wfile.write(body)
