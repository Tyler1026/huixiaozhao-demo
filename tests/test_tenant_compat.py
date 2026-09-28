import unittest
import test_identity_http as harness


class CompatTests(unittest.TestCase):
    setUp = harness.HTTPTests.setUp
    tearDown = harness.HTTPTests.tearDown
    request = harness.HTTPTests.request
    login = harness.HTTPTests.login

    def test_scoped_sync_and_global_rejection(self):
        cookie, csrf = self.login()
        status, _, result = self.request('GET', '/api/sync', cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(result, {'PROJECTS': {}, 'REPORTSTATE': {}, 'KB': {}, 'DEMANDS': [], '_version': 0})
        body = dict(result, PROJECTS={'p': {'city': 'same'}})
        self.assertEqual(self.request('POST', '/api/sync', body, cookie, csrf)[0], 200)
        self.assertEqual(self.request('POST', '/api/sync', body, cookie, csrf)[0], 409)
        body['_version'] = 1
        body['USER_PROFILES'] = {'evil': {'pwd': 'x'}}
        self.assertEqual(self.request('POST', '/api/sync', body, cookie, csrf)[0], 400)
        self.assertNotIn('USER_PROFILES', self.request('GET', '/api/sync', cookie=cookie)[2])

    def test_foreign_selectors_and_deny_legacy_routes(self):
        cookie, csrf = self.login()
        self.assertEqual(self.request('GET', '/api/sync?org=' + self.b, cookie=cookie)[0], 400)
        for path in ['/api/sync-history', '/api/report-file?city=same', '/rag-log', '/api/kb-summary']:
            self.assertEqual(self.request('GET', path, cookie=cookie)[0], 403)
        for path in ['/api/admin-reset', '/api/kb-upload', '/api/report-push-request']:
            self.assertEqual(self.request('POST', path, {}, cookie, csrf)[0], 403)

    def test_two_same_city_logins_do_not_share_state(self):
        cookie, csrf = self.login()
        body = {'PROJECTS': {'p': {'city': 'same'}}, '_version': 0}
        self.assertEqual(self.request('POST', '/api/sync', body, cookie, csrf)[0], 200)
        status, headers, data = self.request('POST', '/auth/login', {'login': 'bob', 'password': 'bob password long enough'})
        self.assertEqual(status, 200)
        other = headers['Set-Cookie'].split(';')[0]
        self.assertEqual(self.request('GET', '/api/sync', cookie=other)[2]['PROJECTS'], {})


if __name__ == '__main__':
    unittest.main()
