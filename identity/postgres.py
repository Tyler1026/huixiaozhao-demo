"""PostgreSQL adapter using the same scoped Store contract; explicit schema only."""
import contextlib
import sqlite3
import psycopg2
import psycopg2.extras
from .store import Store


class Connection:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=()):
        cursor = self.conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        try:
            cursor.execute(sql.replace('?', '%s'), params)
        except psycopg2.IntegrityError as e:
            raise sqlite3.IntegrityError('constraint violation') from e
        return cursor


class PostgresStore(Store):
    def __init__(self, dsn):
        self._dsn = dsn
        # Never initialize on construction. Migration is an explicit operation.

    @contextlib.contextmanager
    def db(self):
        conn = psycopg2.connect(self._dsn, connect_timeout=10,
                                options='-c statement_timeout=10000 -c search_path=hxz_identity')
        try:
            with conn:
                yield Connection(conn)
        finally:
            conn.close()

    def initialize(self):
        with self.db() as c:
            c.execute('CREATE SCHEMA IF NOT EXISTS hxz_identity')
            c.execute('CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY)')
            c.execute('''CREATE TABLE IF NOT EXISTS users(
              id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, salt TEXT NOT NULL,
              password TEXT NOT NULL, role TEXT NOT NULL, org_id TEXT REFERENCES organizations(id))''')
            c.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_admin ON users(role) WHERE role='platform_admin'")
            c.execute('''CREATE TABLE IF NOT EXISTS sessions(
              token TEXT PRIMARY KEY, csrf TEXT NOT NULL, user_id TEXT REFERENCES users(id), expires DOUBLE PRECISION)''')
            c.execute('''CREATE TABLE IF NOT EXISTS states(
              org_id TEXT PRIMARY KEY REFERENCES organizations(id), version INTEGER NOT NULL, data TEXT NOT NULL)''')
