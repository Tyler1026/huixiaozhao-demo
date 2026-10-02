"""Default-closed, INTERNAL server integration seam; not an HTTP/auth implementation.

Host integration (no production routes are wired here):
* Construct FullReportBridge with enabled=True only after host authentication has
  been independently accepted. authorize(session, project, action) MUST revalidate
  the live server session, membership and project permission on EVERY call; return
  {'org_id': ..., 'user_id': ...} or None. Actions: create/get/artifact.
* Supply an explicit server-owned org -> TenantCredential map, never browser
  parameters or a default tenant. Tenant IDs are pinned durably; changing a pin
  requires an explicit offline migration, not silently remapping existing reports.
* validate_csrf(session, context) must verify host-established CSRF evidence bound
  to that session/request. Pass an opaque internal context, NOT a browser boolean.
  This hook and authorize are trusted host code, not user-selectable callbacks.
* client(action, *, tenant_id, credential, **kwargs) is server-only. create takes
  payload/idempotency_key and returns {'id': external_id}; get takes report_id and
  returns {'status': enum, 'artifacts': [manifest-controlled filenames]}; artifact
  takes report_id/name and returns bytes. Client must enforce manifest membership
  and integrity itself as well. Never forward remote headers, URLs or errors.
  Remote create MUST implement durable tenant-scoped idempotency: a crash after
  remote success but before local commit is recovered by replaying the same key.

Public IDs are local opaque IDs, not arbitrary external report IDs. Idempotency
is org-scoped, with project/user/payload conflicts rejected. Reads permit another
currently authorized member of the same org/project; creator user stays recorded.
SQLite is a local durable file (not a shared multi-host database). Transactions
serialize creation across instances; configure bounded client timeouts. Service
errors are intentionally reduced to safe codes. No retry/sync/publish route is
implemented, and this module does not deliver production authentication.
"""

from dataclasses import dataclass, field
import hashlib
import json
import re
import sqlite3
import uuid
from contextlib import contextmanager
from collections.abc import Mapping


class BridgeError(Exception):
    def __init__(self, status, code):
        self.status = status
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class TenantCredential:
    tenant_id: str
    credential: str = field(repr=False)


class FullReportBridge:
    def __init__(self, database, *, authorize, tenants, client, validate_csrf,
                 enabled=False):
        if not all(callable(fn) for fn in (authorize, client, validate_csrf)):
            raise TypeError('trusted callbacks required')
        self.database = str(database)
        if self.database == ':memory:':
            raise ValueError('durable SQLite file required')
        self.authorize = authorize
        self.tenants = dict(tenants)
        self.client = client
        self.validate_csrf = validate_csrf
        self.enabled = enabled is True
        with self._db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS bridge_tenants (
                    org TEXT PRIMARY KEY, tenant TEXT NOT NULL UNIQUE);
                CREATE TABLE IF NOT EXISTS bridge_reports (
                    id TEXT PRIMARY KEY, org TEXT NOT NULL, project TEXT NOT NULL,
                    user TEXT NOT NULL, idem TEXT NOT NULL, digest TEXT NOT NULL,
                    remote_key TEXT NOT NULL, external TEXT,
                    UNIQUE(org, idem), UNIQUE(org, external));
            ''')

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.database, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def _text(value):
        return isinstance(value, str) and 0 < len(value) <= 512

    def _identity(self, session, project, action):
        if not self.enabled:
            raise BridgeError(503, 'bridge_disabled')
        try:
            principal = self.authorize(session, project, action)
        except Exception:
            raise BridgeError(404, 'not_found') from None
        if (not self._text(project) or not isinstance(principal, Mapping)
                or not self._text(principal.get('org_id'))
                or not self._text(principal.get('user_id'))):
            raise BridgeError(404, 'not_found')
        org, user = principal['org_id'], principal['user_id']
        config = self.tenants.get(org)
        if (not isinstance(config, TenantCredential)
                or not self._text(config.tenant_id)
                or not self._text(config.credential)):
            raise BridgeError(404, 'not_found')
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT OR IGNORE INTO bridge_tenants VALUES (?, ?)',
                       (org, config.tenant_id))
            pin = db.execute('SELECT tenant FROM bridge_tenants WHERE org=?',
                             (org,)).fetchone()
            if pin is None or pin['tenant'] != config.tenant_id:
                raise BridgeError(404, 'not_found')
        return org, user, config

    def _remote(self, action, config, **kwargs):
        try:
            return self.client(action, tenant_id=config.tenant_id,
                               credential=config.credential, **kwargs)
        except Exception:
            raise BridgeError(502, 'service_unavailable') from None

    def create(self, session, project, payload, idempotency_key, *, csrf_context):
        org, user, config = self._identity(session, project, 'create')
        try:
            valid = (csrf_context is not None and not isinstance(csrf_context, bool)
                     and self.validate_csrf(session, csrf_context) is True)
        except Exception:
            valid = False
        if not valid:
            raise BridgeError(403, 'csrf_required')
        if not self._text(idempotency_key) or not isinstance(payload, dict):
            raise BridgeError(400, 'invalid_request')
        try:
            canonical = json.dumps(payload, sort_keys=True, separators=(',', ':'),
                                   allow_nan=False)
        except (TypeError, ValueError):
            raise BridgeError(400, 'invalid_request') from None
        digest = hashlib.sha256(canonical.encode()).hexdigest()
        # Commit reservation BEFORE remote I/O so crash/retry cannot change payload.
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM bridge_reports WHERE org=? AND idem=?',
                             (org, idempotency_key)).fetchone()
            if row is None:
                local_id = uuid.uuid4().hex
                db.execute('INSERT INTO bridge_reports VALUES (?,?,?,?,?,?,?,NULL)',
                           (local_id, org, project, user, idempotency_key, digest,
                            'bridge-' + uuid.uuid4().hex))
            elif (row['project'], row['user'], row['digest']) != (project, user, digest):
                raise BridgeError(409, 'idempotency_conflict')
        with self._db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM bridge_reports WHERE org=? AND idem=?',
                             (org, idempotency_key)).fetchone()
            if row['external'] is None:
                result = self._remote('create', config, payload=json.loads(canonical),
                                      idempotency_key=row['remote_key'])
                if not isinstance(result, Mapping) or not self._text(result.get('id')):
                    raise BridgeError(502, 'invalid_service_response')
                try:
                    db.execute('UPDATE bridge_reports SET external=? WHERE id=?',
                               (result['id'], row['id']))
                except sqlite3.IntegrityError:
                    raise BridgeError(502, 'invalid_service_response') from None
            return {'id': row['id']}

    def _association(self, org, project, report_id):
        with self._db() as db:
            row = db.execute('SELECT * FROM bridge_reports WHERE id=? AND org=? AND project=?',
                             (report_id, org, project)).fetchone()
        if row is None or row['external'] is None:
            raise BridgeError(404, 'not_found')
        return row

    def _metadata(self, config, external):
        result = self._remote('get', config, report_id=external)
        statuses = {'queued', 'running', 'retry_wait', 'failed', 'completed'}
        if (not isinstance(result, Mapping) or not isinstance(result.get('status'), str)
                or result['status'] not in statuses
                or not isinstance(result.get('artifacts'), list)):
            raise BridgeError(502, 'invalid_service_response')
        names = result['artifacts']
        if any(not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,199}', name)
               or '..' in name or config.credential in name for name in names):
            raise BridgeError(502, 'invalid_service_response')
        public = {'status': result['status'], 'artifacts': list(names)}
        for key in ('stages_done', 'stages_total', 'parts_done', 'parts_total'):
            value = result.get(key)
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                public[key] = value
        progress = result.get('progress_at')
        if isinstance(progress, (int, float)):
            public['progress_at'] = progress
        code = result.get('failure_code')
        if code in {'timeout','worker_crash','upstream','rate_limit','quality','configuration','budget_exhausted','artifact'}:
            public['failure_code'] = code
        current = result.get('current')
        if isinstance(current, dict):
            public['current'] = {key: current[key] for key in ('stage','part','status','attempts','next_at') if key in current and isinstance(current[key], (str,int,float)) and config.credential not in str(current[key])}
        return public

    def get(self, session, project, report_id):
        org, _, config = self._identity(session, project, 'get')
        row = self._association(org, project, report_id)
        return dict(id=row['id'], **self._metadata(config, row['external']))

    def artifact(self, session, project, report_id, name):
        org, _, config = self._identity(session, project, 'artifact')
        row = self._association(org, project, report_id)
        metadata = self._metadata(config, row['external'])
        if not isinstance(name, str) or name not in metadata['artifacts']:
            raise BridgeError(404, 'not_found')
        content = self._remote('artifact', config, report_id=row['external'], name=name)
        if not isinstance(content, bytes) or config.credential.encode() in content:
            raise BridgeError(502, 'invalid_service_response')
        return content
