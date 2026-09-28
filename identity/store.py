"""Isolated SQLite identity adapter. Not wired into the production application."""
import contextlib
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import uuid


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600000).hex()


class Store:
    def __init__(self, path):
        self.path = str(path)
        with self.db() as c:
            c.executescript('''
            CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS users(
              id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, salt TEXT NOT NULL,
              password TEXT NOT NULL, role TEXT NOT NULL, org_id TEXT REFERENCES organizations(id));
            CREATE UNIQUE INDEX IF NOT EXISTS one_admin ON users(role) WHERE role='platform_admin';
            CREATE TABLE IF NOT EXISTS sessions(
              token TEXT PRIMARY KEY, csrf TEXT NOT NULL, user_id TEXT REFERENCES users(id), expires REAL);
            CREATE TABLE IF NOT EXISTS states(
              org_id TEXT PRIMARY KEY REFERENCES organizations(id), version INTEGER NOT NULL, data TEXT NOT NULL);
            ''')
        os.chmod(self.path, 0o600)

    @contextlib.contextmanager
    def db(self):
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA foreign_keys=ON')
        try:
            with c:
                yield c
        finally:
            c.close()

    def _create(self, login, password, admin=False):
        if not isinstance(login, str) or not isinstance(password, str):
            raise ValueError('invalid account')
        login = login.strip().casefold()
        if not login or len(login) > 128 or len(password) < 12 or len(password) > 1024:
            raise ValueError('invalid account')
        org = None if admin else str(uuid.uuid4())
        salt = secrets.token_hex(16)
        hashed = password_hash(password, salt)
        try:
            with self.db() as c:
                if org:
                    c.execute('INSERT INTO organizations VALUES(?)', (org,))
                    c.execute('INSERT INTO states VALUES(?,0,?)', (org, '{}'))
                c.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',
                          (str(uuid.uuid4()), login, salt, hashed,
                           'platform_admin' if admin else 'org_admin', org))
        except sqlite3.IntegrityError as e:
            raise ValueError('account or administrator already exists') from e
        return org

    def create_customer(self, login, password):
        return self._create(login, password)

    def bootstrap_admin(self, login, password):
        return self._create(login, password, admin=True)

    def login(self, login, password, ttl=3600):
        if not isinstance(login, str) or not isinstance(password, str) or len(password) > 1024:
            raise PermissionError('invalid credentials')
        with self.db() as c:
            row = c.execute('SELECT * FROM users WHERE login=?', (login.strip().casefold(),)).fetchone()
            salt = row['salt'] if row else '00' * 16
            actual = password_hash(password, salt)
            if not row or not hmac.compare_digest(actual, row['password']):
                raise PermissionError('invalid credentials')
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            c.execute('DELETE FROM sessions WHERE expires<=?', (time.time(),))
            c.execute('INSERT INTO sessions VALUES(?,?,?,?)',
                      (digest(token), digest(csrf), row['id'], time.time() + ttl))
        return token, csrf

    def authenticate(self, token, csrf=None):
        if not isinstance(token, str) or len(token) > 256:
            raise PermissionError('unauthorized')
        with self.db() as c:
            row = c.execute('''SELECT u.id,u.role,u.org_id,s.csrf,s.expires FROM sessions s
                              JOIN users u ON s.user_id=u.id WHERE s.token=?''', (digest(token),)).fetchone()
        if not row or row['expires'] <= time.time():
            raise PermissionError('unauthorized')
        if csrf is not None and not hmac.compare_digest(digest(csrf), row['csrf']):
            raise PermissionError('invalid csrf')
        return {k: row[k] for k in ('id', 'role', 'org_id')}

    def logout(self, token):
        with self.db() as c:
            c.execute('DELETE FROM sessions WHERE token=?', (digest(token),))

    def _authorize(self, principal, org):
        # No implicit cross-tenant administrator bypass.
        if not org or principal.get('org_id') != org or principal.get('role') != 'org_admin':
            raise PermissionError('forbidden')

    def get_state(self, principal, org):
        self._authorize(principal, org)
        with self.db() as c:
            row = c.execute('SELECT version,data FROM states WHERE org_id=?', (org,)).fetchone()
        if row is None:
            raise PermissionError('forbidden')
        return {'version': row['version'], 'data': json.loads(row['data'])}

    def put_state(self, principal, org, data, version):
        self._authorize(principal, org)
        if not isinstance(data, dict) or set(data) - {'projects', 'reports', 'knowledge', 'demands'}:
            raise ValueError('unsupported state fields')
        if type(version) is not int or version < 0:
            raise ValueError('invalid version')
        # Business payload is opaque for now; never read authorization from it.
        body = json.dumps(data, ensure_ascii=False, allow_nan=False)
        if len(body.encode()) > 1024 * 1024:
            raise ValueError('state too large')
        with self.db() as c:
            changed = c.execute('UPDATE states SET version=version+1,data=? WHERE org_id=? AND version=?',
                                (body, org, version)).rowcount
            if changed != 1:
                raise ValueError('version conflict')
        return version + 1
