"""Real HTTP account boundaries, using only isolated local files and fixtures.

The real Handler is compiled without executing server module globals (which
load deployment credentials). Authentication, sessions and file transactions
are the production implementations; only storage location/config are injected.
"""
import ast
import concurrent.futures
import gzip
import hashlib
import http.client
import json
import tempfile
import threading
import unittest
from urllib.parse import urlencode
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
        self.topic_research_calls = []
        self.topic_plan_calls = []
        def offline_topic_research(*args, **kwargs):
            self.topic_research_calls.append((args, kwargs))
            raise AssertionError('No real research is allowed in the HTTP fixture')
        def offline_topic_plan(*args, **kwargs):
            self.topic_plan_calls.append((args, kwargs))
            raise AssertionError('No real model is allowed in the HTTP fixture')
        self.ns['_complete_topic_plan'] = offline_topic_plan
        # Run the real route's authentication, source and confirmation gates,
        # but make accidental entry into research fail locally and explicitly.
        # Patching only DS_OPENER no longer covers this dedicated report route.
        from backend import topic_report_route
        real_topic_route = topic_report_route.serve_topic_report
        def offline_topic_route(*args, **kwargs):
            kwargs['research'] = offline_topic_research
            return real_topic_route(*args, **kwargs)
        self.topic_route_patch = patch.object(topic_report_route, 'serve_topic_report', offline_topic_route)
        self.topic_route_patch.start()
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
        self.topic_route_patch.stop()
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

    def create_monthly_workspace(self, cookie):
        status, _, raw = self.http.request('POST', '/api/admin/invites', {
            'action': 'create', 'city': '随州市', 'province': '湖北省'}, cookie=cookie)
        self.assertEqual(status, 200, raw)
        result = json.loads(raw)
        path = '/api/admin/city-workspaces?' + urlencode({
            'city': '随州市', 'projectKey': result['cityWorkspace']['projectKey']})
        return path, result

    def test_monthly_read_is_minimal_read_only_and_avoids_sync_projection_or_write_lock(self):
        admin = self.http.admin()
        path, created = self.create_monthly_workspace(admin)
        before = self.http.path.read_bytes()
        with patch.object(self.http.ns['Handler'], '_account_session',
                          side_effect=AssertionError('read must not take the write lock')), \
                patch('backend.access_control.scoped_sync_view',
                      side_effect=AssertionError('read must not project all workspace data')):
            status, headers, raw = self.http.request('GET', path, cookie=admin)
        self.assertEqual(status, 200, raw)
        workspace = created['cityWorkspace']
        self.assertEqual(json.loads(raw), {
            'ok': True, 'city': '随州市', 'projectKey': workspace['projectKey'],
            'cityWorkspace': {key: workspace[key] for key in
                              ('projectKey', 'province', 'monthlyEnabled', 'nextReportAt')}})
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertNotIn('Set-Cookie', headers)
        self.assertLess(len(raw), 512)
        for forbidden in ('inviteCode', created['invite']['code'], 'ownerUser', 'AUTH_SESSIONS',
                          'USER_PROFILES', 'PROJECTS', 'reportFiles', ADMIN_PASSWORD):
            self.assertNotIn(forbidden, raw.decode())
        self.assertEqual(before, self.http.path.read_bytes())

    def test_monthly_read_requires_live_admin_session(self):
        admin = self.http.admin()
        path, _ = self.create_monthly_workspace(admin)
        member, _ = self.http.register()
        before = self.http.path.read_bytes()
        for cookie, expected in ((None, 401), ('hxz_session=forged', 401), (member, 403)):
            with self.subTest(cookie=cookie):
                status, _, raw = self.http.request('GET', path, cookie=cookie)
                self.assertEqual(status, expected, raw)
        self.assertEqual(before, self.http.path.read_bytes())
        state = self.http.state()
        for session in state['AUTH_SESSIONS'].values():
            if session.get('source') == 'admin':
                session['expires_at'] = 0
        self.http.replace(state)
        self.assertEqual(self.http.request('GET', path, cookie=admin)[0], 401)

    def test_monthly_read_rejects_cross_origin_and_ambiguous_city_binding(self):
        admin = self.http.admin()
        path, created = self.create_monthly_workspace(admin)
        before = self.http.path.read_bytes()
        for extra in ({'Origin': 'https://other.invalid'}, {'Sec-Fetch-Site': 'cross-site'},
                      {'Origin': 'null'}, {'Origin': 'http://[malformed'}):
            self.assertEqual(self.http.request('GET', path, cookie=admin, headers=extra)[0], 403)
        for query, expected in (({}, 400), ({'city': '随州市'}, 400),
                                ({'city': '', 'projectKey': 'valid'}, 400),
                                ({'city': '<invalid>', 'projectKey': 'valid'}, 400),
                                ({'city': '另一城市', 'projectKey': created['cityWorkspace']['projectKey']}, 404),
                                ({'city': '随州市', 'projectKey': 'another-project'}, 404)):
            status, _, raw = self.http.request('GET', '/api/admin/city-workspaces?' + urlencode(query), cookie=admin)
            self.assertEqual(status, expected, raw)
        self.assertEqual(self.http.request('GET', path + '&' + urlencode({'city': '随州市'}), cookie=admin)[0], 400)
        self.assertEqual(before, self.http.path.read_bytes())

    def test_monthly_read_recovers_committed_setting_without_repeating_post(self):
        admin = self.http.admin()
        path, created = self.create_monthly_workspace(admin)
        workspace = created['cityWorkspace']
        status, _, raw = self.http.request('POST', '/api/admin/city-workspaces', {
            'action': 'set_monthly', 'city': '随州市', 'projectKey': workspace['projectKey'],
            'monthlyEnabled': False, 'expectedMonthlyEnabled': True,
            'expectedNextReportAt': workspace['nextReportAt']}, cookie=admin)
        self.assertEqual(status, 200, raw)
        before = self.http.path.read_bytes()
        status, _, raw = self.http.request('GET', path, cookie=admin)
        self.assertEqual(status, 200, raw)
        self.assertFalse(json.loads(raw)['cityWorkspace']['monthlyEnabled'])
        self.assertEqual(json.loads(raw)['cityWorkspace']['nextReportAt'], 0)
        self.assertEqual(before, self.http.path.read_bytes())

    def test_monthly_read_reports_unavailable_storage_and_corrupt_binding(self):
        admin = self.http.admin()
        path, _ = self.create_monthly_workspace(admin)
        before = self.http.path.read_bytes()
        self.http.path.write_text('{invalid')
        status, _, raw = self.http.request('GET', path, cookie=admin)
        self.assertEqual(status, 503, raw)
        self.assertNotIn('invalid', json.loads(raw)['message'])
        self.http.path.write_bytes(before)
        state = self.http.state()
        state['CITY_WORKSPACES']['随州市']['monthlyEnabled'] = 'true'
        self.http.replace(state)
        before = self.http.path.read_bytes()
        status, _, raw = self.http.request('GET', path, cookie=admin)
        self.assertEqual(status, 503, raw)
        self.assertEqual(json.loads(raw)['error'], 'city_workspace_unavailable')
        self.assertEqual(before, self.http.path.read_bytes())

    def test_sync_gzip_preserves_report_file_and_download_transport(self):
        admin = self.http.admin()
        import base64
        original = b'offline-original-report\x00' * 2048
        state = self.http.state()
        state['REPORT_REQUESTS'] = [{'id': 'rr-legacy-completed', 'city': '测试甲市',
                                    'status': 'done', 'files': [{
                                        'kind': 'full', 'name': 'original.docx',
                                        'b64': base64.b64encode(original).decode()}]}]
        self.http.replace(state)
        before = self.http.path.read_bytes()
        status, plain_headers, plain = self.http.request('GET', '/api/sync', cookie=admin)
        self.assertEqual(status, 200)
        self.assertNotIn('Content-Encoding', plain_headers)
        status, headers, compressed = self.http.request('GET', '/api/sync', cookie=admin,
                                                       headers={'Accept-Encoding': 'gzip'})
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Encoding'], 'gzip')
        self.assertEqual(gzip.decompress(compressed), plain)
        self.assertEqual(int(headers['Content-Length']), len(compressed))
        self.assertEqual(base64.b64decode(json.loads(plain)['REPORT_REQUESTS'][0]['files'][0]['b64']), original)
        status, headers, downloaded = self.http.request('GET', '/api/report-file?' +
            urlencode({'city': '测试甲市', 'requestId': 'rr-legacy-completed', 'kind': 'full'}),
            cookie=admin, headers={'Accept-Encoding': 'gzip'})
        self.assertEqual(status, 200)
        self.assertNotIn('Content-Encoding', headers)
        self.assertEqual(downloaded, original)
        self.assertEqual(int(headers['Content-Length']), len(original))
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
