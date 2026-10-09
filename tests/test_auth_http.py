"""Real HTTP account boundaries, using only isolated local files and fixtures.

The real Handler is compiled without executing server module globals (which
load deployment credentials). Authentication, sessions and file transactions
are the production implementations; only storage location/config are injected.
"""
import ast
import concurrent.futures
import hashlib
import http.client
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend import sync_merge


ROOT = Path(__file__).resolve().parents[1]
PASSWORD = 'offline-http-password-7'
ADMIN_PASSWORD = 'offline-admin-password-8'


def initial_state():
    return {
        'INVITE_CODES': {
            'TEAM_A': {'city': '测试甲市', 'projKey': 'project-a', 'role': 'member', 'usedBy': []},
            'TEAM_B': {'city': '测试乙市', 'projKey': 'project-b', 'role': 'member', 'usedBy': []},
            'REVOKED': {'city': '已撤销市', 'projKey': 'project-b', 'revoked': True},
        },
        'PROJECTS': {
            'project-a': {'id': 'project-a', 'workspaceId': 'project-a', 'city': '测试甲市'},
            'project-b': {'id': 'project-b', 'workspaceId': 'project-b', 'city': '测试乙市', 'private': 'OTHER_TEAM_MARKER'},
        },
        'USER_PROFILES': {}, 'CITY_ACCOUNTS': {},
    }


class HttpFixture:
    def __enter__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'sync.json'
        self.replace(initial_state())
        source = ast.parse((ROOT / 'server.py').read_text())
        names = {'Handler', '_clean_sync_data', '_is_noise_chunk'}
        nodes = [node for node in source.body
                 if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names]
        # Do not pass os.environ or execute the production module initializer.
        config = {'HXZ_ADMIN_USERNAME': 'offline-admin', 'HXZ_ADMIN_PASSWORD': ADMIN_PASSWORD}
        self.ns = dict(BaseHTTPRequestHandler=BaseHTTPRequestHandler, json=json,
                       os=SimpleNamespace(environ=config),
                       HTML_GOV=str(ROOT / 'index.html'), HTML_OPS=str(ROOT / 'ops.html'),
                       PORT_OPS=-1, MODEL='offline', DS_KEY='', _PG_AVAIL=False,
                       DATABASE_URL='', _NOISE_RE=[], _db_get=lambda: None, _db_conn=lambda: None,
                       _db_set=lambda value: False, SYNC_PATH=str(self.path),
                       _file_snapshot=lambda: None)
        self.ns.update({name: getattr(sync_merge, name) for name in dir(sync_merge)
                        if name.startswith('_') and not name.startswith('__')})
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'isolated-auth-handler', 'exec'), self.ns)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), self.ns['Handler'])
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = 'http://%s:%s' % self.server.server_address
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def replace(self, state):
        self.path.write_text(json.dumps(state), encoding='utf-8')

    def state(self):
        return json.loads(self.path.read_text())

    def request(self, method, path, body=None, *, cookie=None, headers=None):
        outgoing = {'Origin': self.origin} if method == 'POST' else {}
        if cookie:
            outgoing['Cookie'] = cookie
        outgoing.update(headers or {})
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            outgoing['Content-Type'] = 'application/json'
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=10)
        try:
            connection.request(method, path, body=body, headers=outgoing)
            response = connection.getresponse()
            raw = response.read()
            return response.status, dict(response.getheaders()), raw
        finally:
            connection.close()

    def register(self, user='alice', code='TEAM_A'):
        status, headers, raw = self.request('POST', '/api/auth/register', {
            'username': user, 'password': PASSWORD, 'inviteCode': code})
        if status != 200:
            raise AssertionError((status, raw))
        return headers['Set-Cookie'].split(';', 1)[0], json.loads(raw)

    def admin(self):
        status, headers, raw = self.request('POST', '/api/auth/login', {
            'username': 'offline-admin', 'password': ADMIN_PASSWORD})
        if status != 200:
            raise AssertionError((status, raw))
        return headers['Set-Cookie'].split(';', 1)[0]


class AuthHttpTests(unittest.TestCase):
    def setUp(self):
        self.http = HttpFixture().__enter__()
        self.addCleanup(self.http.__exit__)

    def test_register_login_cookie_and_safe_current_view(self):
        cookie, result = self.http.register()
        self.assertTrue(result['authenticated'])
        self.assertEqual(result['auth']['projectKeys'], ['project-a'])
        self.assertEqual(result['auth']['scope'], 'project')
        self.assertNotIn('session_token', result)
        status, headers, raw = self.http.request('POST', '/api/auth/login', {
            'username': 'alice', 'password': PASSWORD})
        self.assertEqual(status, 200)
        self.assertIn('HttpOnly', headers['Set-Cookie'])
        self.assertIn('SameSite=Strict', headers['Set-Cookie'])
        self.assertIn('Max-Age=604800', headers['Set-Cookie'])
        token = cookie.split('=', 1)[1]
        state = self.http.state()
        self.assertIn(hashlib.sha256(token.encode()).hexdigest(), state['AUTH_SESSIONS'])
        self.assertNotIn(token, json.dumps(state))
        status, _, raw = self.http.request('GET', '/api/sync', cookie=cookie)
        self.assertEqual(status, 200)
        value = json.loads(raw)
        self.assertEqual(set(value['PROJECTS']), {'project-a'})
        for secret in ('OTHER_TEAM_MARKER', PASSWORD, 'passwordHash', 'AUTH_SESSIONS', 'TEAM_B'):
            self.assertNotIn(secret, raw.decode())

    def test_unauthenticated_and_forged_cookie_rejected(self):
        for cookie in (None, 'hxz_session=forged'):
            with self.subTest(cookie=cookie):
                status, _, raw = self.http.request('GET', '/api/sync', cookie=cookie)
                self.assertEqual(status, 401)
                self.assertEqual(json.loads(raw)['error'], 'auth_required')
        status, _, _ = self.http.request('POST', '/api/auth/login', {'username': 'admin', 'password': 'admin'})
        self.assertEqual(status, 401)

    def test_invite_validation_returns_only_requested_city(self):
        status, _, raw = self.http.request('POST', '/api/auth/invite/validate', {'inviteCode': 'TEAM_A'})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), {'ok': True, 'city': '测试甲市'})
        for code in ('REVOKED', 'UNKNOWN'):
            status, headers, raw = self.http.request('POST', '/api/auth/register', {
                'username': 'invalid', 'password': PASSWORD, 'inviteCode': code})
            self.assertEqual(status, 400)
            self.assertNotIn('Set-Cookie', headers)
        self.assertEqual(self.http.state()['USER_PROFILES'], {})

    def test_cross_workspace_sync_and_auth_fields_rejected_without_writes(self):
        cookie, _ = self.http.register()
        before = self.http.path.read_bytes()
        for body in ({'PROJECTS': {'project-b': {'city': 'attacker'}}},
                     {'cur': 'project-b'}, {'AUTH_SESSIONS': {}},
                     {'USER_PROFILES': {'alice': {'role': 'admin'}}}):
            with self.subTest(body=body):
                status, _, raw = self.http.request('POST', '/api/sync', body, cookie=cookie)
                self.assertEqual(status, 403, raw)
                self.assertFalse(json.loads(raw)['ok'])
                self.assertEqual(self.http.path.read_bytes(), before)
        status, _, raw = self.http.request('POST', '/api/sync', {
            'PROJECTS': {'project-a': {'city': '测试甲市', 'topic': 'authorized'}}}, cookie=cookie)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw)['ok'])
        self.assertEqual(self.http.state()['PROJECTS']['project-a']['topic'], 'authorized')
        self.assertEqual(self.http.state()['PROJECTS']['project-b']['private'], 'OTHER_TEAM_MARKER')

    def test_join_and_switch_preserve_prior_membership(self):
        cookie, _ = self.http.register()
        for _ in range(2):
            status, _, raw = self.http.request('POST', '/api/auth/join', {'inviteCode': 'TEAM_B'}, cookie=cookie)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(raw)['auth']['projectKeys'], ['project-a', 'project-b'])
            self.assertEqual(json.loads(raw)['auth']['projKey'], 'project-b')
        state = self.http.state()
        self.assertEqual(state['USER_PROFILES']['alice']['projKey'], 'project-a')
        self.assertEqual(set(state['USER_PROFILES']['alice']['memberships']), {'project-a', 'project-b'})
        self.assertEqual(len(state['INVITE_CODES']['TEAM_B']['usedBy']), 1)
        status, _, raw = self.http.request('POST', '/api/auth/workspace', {'projKey': 'project-a'}, cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['auth']['projKey'], 'project-a')
        status, _, _ = self.http.request('POST', '/api/auth/workspace', {'projKey': 'unowned'}, cookie=cookie)
        self.assertEqual(status, 403)

    def test_logout_and_disabled_or_expired_profiles_invalidate_session(self):
        cookie, _ = self.http.register()
        status, headers, raw = self.http.request('POST', '/api/auth/logout', {}, cookie=cookie)
        self.assertEqual(status, 200)
        self.assertIn('Max-Age=0', headers['Set-Cookie'])
        self.assertEqual(self.http.request('GET', '/api/auth/session', cookie=cookie)[0], 401)
        _, headers, _ = self.http.request('POST', '/api/auth/login', {'username': 'alice', 'password': PASSWORD})
        cookie = headers['Set-Cookie'].split(';', 1)[0]
        state = self.http.state()
        state['USER_PROFILES']['alice']['disabled'] = True
        self.http.replace(state)
        self.assertEqual(self.http.request('GET', '/api/auth/session', cookie=cookie)[0], 401)
        del state['USER_PROFILES']['alice']['disabled']
        for record in state['AUTH_SESSIONS'].values():
            record['expires_at'] = 0
        self.http.replace(state)
        self.assertEqual(self.http.request('GET', '/api/auth/session', cookie=cookie)[0], 401)

    def test_cross_origin_and_fetch_metadata_block_before_mutation(self):
        cookie, _ = self.http.register()
        before = self.http.path.read_bytes()
        for extra in ({'Origin': 'https://other.invalid'}, {'Sec-Fetch-Site': 'cross-site'},
                      {'Origin': 'null'}, {'Origin': 'http://[malformed'}):
            for route, body in (('/api/auth/logout', {}), ('/api/sync', {'PROJECTS': {'project-a': {'topic': 'bad'}}})):
                status, headers, raw = self.http.request('POST', route, body, cookie=cookie, headers=extra)
                self.assertEqual(status, 403, raw)
                self.assertNotIn('Set-Cookie', headers)
                self.assertEqual(self.http.path.read_bytes(), before)

    def test_failed_commit_never_sets_or_clears_cookie_or_acknowledges(self):
        before = self.http.path.read_bytes()
        with patch('backend.sync_transaction.os.replace', side_effect=OSError('SECRET_STORAGE_DETAIL')):
            status, headers, raw = self.http.request('POST', '/api/auth/register', {
                'username': 'alice', 'password': PASSWORD, 'inviteCode': 'TEAM_A'})
        self.assertEqual(status, 503)
        self.assertNotIn('Set-Cookie', headers)
        self.assertNotIn('SECRET_STORAGE_DETAIL', raw.decode())
        self.assertEqual(before, self.http.path.read_bytes())
        cookie, _ = self.http.register()
        before = self.http.path.read_bytes()
        with patch('backend.sync_transaction.os.replace', side_effect=OSError('SECRET_STORAGE_DETAIL')):
            for route, body in (('/api/auth/login', {'username': 'alice', 'password': PASSWORD}),
                                ('/api/auth/logout', {}), ('/api/auth/join', {'inviteCode': 'TEAM_B'})):
                status, headers, raw = self.http.request('POST', route, body, cookie=cookie)
                self.assertEqual(status, 503, raw)
                self.assertNotIn('Set-Cookie', headers)
                self.assertNotIn('SECRET_STORAGE_DETAIL', raw.decode())
        self.assertEqual(before, self.http.path.read_bytes())
        self.assertEqual(self.http.request('GET', '/api/auth/session', cookie=cookie)[0], 200)

    def test_admin_invite_ack_is_committed_and_regular_member_denied(self):
        cookie, _ = self.http.register()
        before = self.http.path.read_bytes()
        status, _, raw = self.http.request('POST', '/api/admin/invites', {'action': 'create', 'city': '新测试市'}, cookie=cookie)
        self.assertEqual(status, 403)
        self.assertEqual(before, self.http.path.read_bytes())
        admin = self.http.admin()
        status, _, raw = self.http.request('POST', '/api/admin/invites', {'action': 'create', 'city': '新测试市'}, cookie=admin)
        self.assertEqual(status, 200)
        result = json.loads(raw)
        code = result['invite']['code']
        self.assertEqual(self.http.state()['INVITE_CODES'][code]['city'], '新测试市')
        key = result['invite']['projKey']
        self.assertEqual(self.http.state()['PROJECTS'][key]['workspaceId'], key)
        before = self.http.path.read_bytes()
        with patch('backend.sync_transaction.os.replace', side_effect=OSError('SECRET_STORAGE_DETAIL')):
            status, headers, raw = self.http.request('POST', '/api/admin/invites', {'action': 'revoke', 'code': code}, cookie=admin)
        self.assertEqual(status, 503)
        self.assertFalse(json.loads(raw)['ok'])
        self.assertNotIn('Set-Cookie', headers)
        self.assertEqual(before, self.http.path.read_bytes())

    def test_history_details_require_admin_and_never_return_credentials(self):
        cookie, _ = self.http.register()
        admin = self.http.admin()
        backup = self.http.state()
        backup['USER_PROFILES']['old-user'] = {'pwd': 'OLD_PASSWORD_MARKER',
            'passwordHash': 'OLD_HASH_MARKER', 'name': 'historical name'}
        backup['AUTH_SESSIONS']['OLD_SESSION_MARKER'] = {'token': 'OLD_TOKEN_MARKER'}
        Path(str(self.http.path) + '.bak.123').write_text(json.dumps(backup))
        self.assertEqual(self.http.request('GET', '/api/sync-history?ts=123', cookie=cookie)[0], 403)
        status, _, raw = self.http.request('GET', '/api/sync-history?ts=123', cookie=admin)
        self.assertEqual(status, 200)
        value = json.loads(raw)
        self.assertTrue(value['ok'])
        data = json.loads(value['data'])
        self.assertEqual(data['PROJECTS']['project-a']['city'], '测试甲市')
        self.assertEqual(data['USER_PROFILES']['old-user']['name'], 'historical name')
        for secret in ('OLD_PASSWORD_MARKER', 'OLD_HASH_MARKER', 'OLD_SESSION_MARKER',
                       'OLD_TOKEN_MARKER', 'passwordHash', 'AUTH_SESSIONS'):
            self.assertNotIn(secret, raw.decode())

    def test_parallel_registration_uses_real_file_lock_without_lost_accounts(self):
        def register(user):
            return self.http.request('POST', '/api/auth/register', {
                'username': user, 'password': PASSWORD, 'inviteCode': 'TEAM_A'})[0]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(list(pool.map(register, ['alice', 'bob'])), [200, 200])
        state = self.http.state()
        self.assertEqual(set(state['USER_PROFILES']), {'alice', 'bob'})
        self.assertEqual(len(state['AUTH_SESSIONS']), 2)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(register, ['carol', 'carol'])), [200, 409])
        state = self.http.state()
        self.assertEqual(set(state['USER_PROFILES']), {'alice', 'bob', 'carol'})
        self.assertEqual(len(state['AUTH_SESSIONS']), 3)


if __name__ == '__main__':
    unittest.main()
