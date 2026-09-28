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
from .services import ServiceMixin


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600000).hex()


class Store(ServiceMixin):
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
            CREATE TABLE IF NOT EXISTS service_credentials(
              token TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id), project_id TEXT NOT NULL, expires REAL);
            CREATE TABLE IF NOT EXISTS deliveries(
              org_id TEXT NOT NULL, project_id TEXT NOT NULL, delivery_id TEXT NOT NULL,
              payload_hash TEXT NOT NULL, result_version INTEGER NOT NULL,
              PRIMARY KEY(org_id, project_id, delivery_id));
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
            if not row or row['role'] == 'revoked' or not hmac.compare_digest(actual, row['password']):
                raise PermissionError('invalid credentials')
            token = secrets.token_urlsafe(32)
            csrf = hmac.new(token.encode(), b'hxz-session-csrf-v1', hashlib.sha256).hexdigest()
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
        if not row or row['role'] == 'revoked' or row['expires'] <= time.time():
            raise PermissionError('unauthorized')
        if csrf is not None and not hmac.compare_digest(digest(csrf), row['csrf']):
            raise PermissionError('invalid csrf')
        principal = {k: row[k] for k in ('id', 'role', 'org_id')}
        principal['_session'] = digest(token)
        return principal

    def resume(self, token):
        principal = self.authenticate(token)
        # Derive stable per-session CSRF from the opaque secret, never from its stored hash.
        # Multiple tabs can recover CSRF without invalidating one another.
        csrf = hmac.new(token.encode(), b'hxz-session-csrf-v1', hashlib.sha256).hexdigest()
        with self.db() as c:
            updated = c.execute('UPDATE sessions SET csrf=? WHERE token=? AND expires>?',
                                (digest(csrf), digest(token), time.time())).rowcount
            if updated != 1:
                raise PermissionError('unauthorized')
        return {'principal': {k: principal[k] for k in ('id', 'role', 'org_id')}, 'csrf': csrf}

    def logout(self, token):
        with self.db() as c:
            c.execute('DELETE FROM sessions WHERE token=?', (digest(token),))

    def add_member(self, principal, login, password):
        if not isinstance(login, str) or not isinstance(password, str):
            raise ValueError('invalid account')
        login = login.strip().casefold()
        if not login or len(login) > 128 or not 12 <= len(password) <= 1024:
            raise ValueError('invalid account')
        salt = secrets.token_hex(16)
        hashed = password_hash(password, salt)
        uid = str(uuid.uuid4())
        try:
            with self.db() as c:
                self._authorize(principal, principal.get('org_id'), c, admin=True)
                c.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',
                          (uid, login, salt, hashed, 'org_member', principal['org_id']))
        except sqlite3.IntegrityError as e:
            raise ValueError('account already exists') from e
        return uid

    def remove_member(self, principal, uid):
        with self.db() as c:
            self._authorize(principal, principal.get('org_id'), c, admin=True)
            target = c.execute('SELECT org_id,role FROM users WHERE id=?', (uid,)).fetchone()
            if not target or target['org_id'] != principal['org_id'] or target['role'] != 'org_member':
                raise PermissionError('member operation forbidden')
            c.execute('DELETE FROM sessions WHERE user_id=?', (uid,))
            # Keep the account record for audit; revoked members cannot log in.
            c.execute("UPDATE users SET role='revoked' WHERE id=?", (uid,))

    def _authorize(self, principal, org, connection, admin=False):
        # Revalidate both membership and live session in the data transaction.
        # A caller-supplied/cached principal is never the source of authority.
        if not isinstance(principal, dict) or not org:
            raise PermissionError('forbidden')
        row = connection.execute('''SELECT u.id,u.org_id,u.role FROM users u
            JOIN sessions s ON s.user_id=u.id
            WHERE s.token=? AND s.expires>?''',
            (principal.get('_session', ''), time.time())).fetchone()
        if (not row or row['id'] != principal.get('id') or row['org_id'] != org
                or row['role'] not in (('org_admin',) if admin else ('org_admin', 'org_member'))
                or principal.get('org_id') != org):
            raise PermissionError('forbidden')

    def get_state(self, principal, org):
        with self.db() as c:
            self._authorize(principal, org, c)
            row = c.execute('SELECT version,data FROM states WHERE org_id=?', (org,)).fetchone()
        if row is None:
            raise PermissionError('forbidden')
        return {'version': row['version'], 'data': json.loads(row['data'])}

    def put_state(self, principal, org, data, version):
        if not isinstance(data, dict) or set(data) - {'projects', 'reports', 'knowledge', 'demands'}:
            raise ValueError('unsupported state fields')
        if type(version) is not int or version < 0:
            raise ValueError('invalid version')
        # Business payload is opaque for now; never read authorization from it.
        body = json.dumps(data, ensure_ascii=False, allow_nan=False)
        if len(body.encode()) > 1024 * 1024:
            raise ValueError('state too large')
        with self.db() as c:
            self._authorize(principal, org, c)
            changed = c.execute('UPDATE states SET version=version+1,data=? WHERE org_id=? AND version=?',
                                (body, org, version)).rowcount
            if changed != 1:
                raise ValueError('version conflict')
        return version + 1
