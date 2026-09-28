import unittest
import test_identity_http as harness

class MembersHTTPTests(unittest.TestCase):
    setUp = harness.HTTPTests.setUp
    tearDown = harness.HTTPTests.tearDown
    request = harness.HTTPTests.request
    login = harness.HTTPTests.login

    def test_add_login_revoke(self):
        cookie, csrf = self.login()
        status, _, body = self.request('POST', '/auth/members', {'login': 'member', 'password': 'synthetic member password'}, cookie, csrf)
        self.assertEqual(status, 201)
        uid = body['id']
        status, headers, info = self.request('POST', '/auth/login', {'login': 'member', 'password': 'synthetic member password'})
        self.assertEqual(status, 200)
        other = headers['Set-Cookie'].split(';')[0]
        self.assertEqual(self.request('GET', '/api/sync', cookie=other)[0], 200)
        self.assertEqual(self.request('POST', '/auth/members', {'login': 'x', 'password': 'synthetic password x'}, other, info['csrf'])[0], 403)
        self.assertEqual(self.request('POST', '/auth/members/revoke', {'id': uid}, cookie, csrf)[0], 200)
        self.assertEqual(self.request('GET', '/api/sync', cookie=other)[0], 401)

    def test_reject_role_or_organization_override(self):
        cookie, csrf = self.login()
        for extra in [{'role': 'platform_admin'}, {'org_id': self.b}]:
            body = dict(login='evil', password='synthetic password evil', **extra)
            self.assertEqual(self.request('POST', '/auth/members', body, cookie, csrf)[0], 400)
