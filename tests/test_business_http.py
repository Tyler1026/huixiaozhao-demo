import unittest
import test_identity_http as harness


class BusinessHTTPTests(unittest.TestCase):
    setUp = harness.HTTPTests.setUp
    tearDown = harness.HTTPTests.tearDown
    request = harness.HTTPTests.request
    login = harness.HTTPTests.login

    def seed(self):
        cookie, csrf = self.login()
        body = {'_version': 0, 'PROJECTS': {'p': {'city': 'same', 'kb': [{'topic': '产业', 'known': ['old']}] }},
                'REPORTSTATE': {'p': {'text': 'synthetic report'}}}
        self.assertEqual(self.request('POST', '/api/sync', body, cookie, csrf)[0], 200)
        return cookie, csrf

    def test_knowledge_read_update_and_conflict(self):
        cookie, csrf = self.seed()
        path = '/api/projects/p/knowledge'
        status, _, result = self.request('GET', path, cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(result['kb'][0]['known'], ['old'])
        body = {'version': result['version'], 'kb': [{'topic': '产业', 'known': ['corrected']}]}
        self.assertEqual(self.request('PUT', path, body, cookie, csrf)[0], 200)
        self.assertEqual(self.request('PUT', path, body, cookie, csrf)[0], 409)
        self.assertEqual(self.request('GET', path, cookie=cookie)[2]['kb'][0]['known'], ['corrected'])
        self.assertEqual(self.request('GET', '/api/projects/p/report', cookie=cookie)[2]['report']['text'], 'synthetic report')

    def test_foreign_project_inaccessible_and_no_csrf_no_write(self):
        cookie, csrf = self.seed()
        self.assertEqual(self.request('PUT', '/api/projects/p/knowledge', {'version': 1, 'kb': []}, cookie)[0], 403)
        status, headers, _ = self.request('POST', '/auth/login', {'login': 'bob', 'password': 'bob password long enough'})
        self.assertEqual(status, 200)
        other = headers['Set-Cookie'].split(';')[0]
        for path in ['/api/projects/p/knowledge', '/api/projects/p/report', '/api/projects/missing/report']:
            self.assertEqual(self.request('GET', path, cookie=other)[0], 404)
        self.assertEqual(self.request('GET', '/api/projects/p/report')[0], 401)

    def test_invalid_shapes_and_owner_fields_rejected(self):
        cookie, csrf = self.seed()
        for body in [{'version': 1, 'kb': 'wrong'}, {'version': 1, 'kb': [], 'org_id': self.b},
                     {'version': 1, 'kb': [{'topic': 'x', 'known': 'wrong'}]}]:
            self.assertEqual(self.request('PUT', '/api/projects/p/knowledge', body, cookie, csrf)[0], 400)
        self.assertEqual(self.request('GET', '/api/projects/p/knowledge?org=x', cookie=cookie)[0], 400)


if __name__ == '__main__':
    unittest.main()
