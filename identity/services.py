"""Restricted machine credentials: one organization, one project, report delivery only."""
import json
import secrets
import time
import hashlib


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


class ServiceMixin:
    def _platform(self, principal, c):
        row = c.execute('''SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id
            WHERE s.token=? AND s.expires>? AND u.role='platform_admin' ''',
            (principal.get('_session', ''), time.time())).fetchone()
        if not row or row['id'] != principal.get('id'):
            raise PermissionError('platform administrator required')

    def issue_service(self, principal, org, project, ttl=3600):
        token = secrets.token_urlsafe(32)
        with self.db() as c:
            self._platform(principal, c)
            row = c.execute('SELECT data FROM states WHERE org_id=?', (org,)).fetchone()
            if not row or project not in json.loads(row['data']).get('projects', {}):
                raise ValueError('project not found')
            c.execute('INSERT INTO service_credentials VALUES(?,?,?,?)',
                      (digest(token), org, project, time.time() + ttl))
        return token

    def revoke_service(self, principal, token):
        with self.db() as c:
            self._platform(principal, c)
            c.execute('DELETE FROM service_credentials WHERE token=?', (digest(token),))

    def _service(self, token, c):
        if not isinstance(token, str) or len(token) > 256:
            raise PermissionError('invalid service credential')
        row = c.execute('SELECT org_id,project_id FROM service_credentials WHERE token=? AND expires>?',
                        (digest(token), time.time())).fetchone()
        if not row:
            raise PermissionError('invalid service credential')
        return {'role': 'report_service', 'org_id': row['org_id'], 'project_id': row['project_id']}

    def authenticate_service(self, token):
        with self.db() as c:
            return self._service(token, c)

    def deliver_report(self, token, project, text, version, delivery_id=None):
        if not isinstance(text, str) or not text.strip() or len(text.encode()) > 500000:
            raise ValueError('invalid report')
        if type(version) is not int or version < 0:
            raise ValueError('invalid version')
        if delivery_id is not None and (not isinstance(delivery_id, str) or not 1 <= len(delivery_id) <= 128):
            raise ValueError('invalid delivery id')
        payload_hash = digest(json.dumps([project, text, version], ensure_ascii=False))
        with self.db() as c:
            principal = self._service(token, c)
            if project != principal['project_id']:
                raise PermissionError('project scope denied')
            # Serialize this organization's deliveries before checking replay history.
            # A no-op row update provides a transaction lock in SQLite and PostgreSQL.
            c.execute('UPDATE states SET version=version WHERE org_id=?', (principal['org_id'],))
            if delivery_id:
                previous = c.execute('SELECT payload_hash,result_version FROM deliveries WHERE org_id=? AND project_id=? AND delivery_id=?',
                                     (principal['org_id'], project, delivery_id)).fetchone()
                if previous:
                    if previous['payload_hash'] != payload_hash:
                        raise ValueError('delivery id payload conflict')
                    return {'ok': True, 'version': previous['result_version']}
            row = c.execute('SELECT data FROM states WHERE org_id=?', (principal['org_id'],)).fetchone()
            if not row:
                raise PermissionError('project scope denied')
            data = json.loads(row['data'])
            if project not in data.get('projects', {}):
                raise PermissionError('project scope denied')
            data.setdefault('reports', {})[project] = {'text': text}
            body = json.dumps(data, ensure_ascii=False, allow_nan=False)
            if len(body.encode()) > 1024 * 1024:
                raise ValueError('state too large')
            n = c.execute('UPDATE states SET data=?,version=version+1 WHERE org_id=? AND version=?',
                          (body, principal['org_id'], version)).rowcount
            if n != 1:
                raise ValueError('version conflict')
            if delivery_id:
                c.execute('INSERT INTO deliveries VALUES(?,?,?,?,?)',
                          (principal['org_id'], project, delivery_id, payload_hash, version + 1))
        return {'ok': True, 'version': version + 1}
