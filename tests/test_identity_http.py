import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path


class HTTPTests(unittest.TestCase):
    def setUp(self):
        from identity.store import Store
        from identity.http import make_server
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / 'test.db')
        self.a = self.store.create_customer('alice', 'alice password long enough')
        self.b = self.store.create_customer('bob', 'bob password long enough')
        self.server = make_server(self.store, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port
        self.origin = 'http://127.0.0.1:' + str(self.port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def request(self, method, path, body=None, cookie=None, csrf=None, origin=True):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        headers = {'Content-Type': 'application/json'}
        if origin: headers['Origin'] = self.origin if origin is True else origin
        if cookie: headers['Cookie'] = cookie
        if csrf: headers['X-CSRF-Token'] = csrf
        c.request(method, path, json.dumps(body) if body is not None else None, headers)
        r = c.getresponse()
        out = r.status, dict(r.getheaders()), json.loads(r.read())
        c.close()
        return out

    def login(self):
        status, headers, data = self.request('POST', '/auth/login', {'login': 'alice', 'password': 'alice password long enough'})
        self.assertEqual(status, 200)
        self.assertIn('HttpOnly', headers['Set-Cookie'])
        self.assertIn('SameSite=Strict', headers['Set-Cookie'])
        return headers['Set-Cookie'].split(';')[0], data['csrf']

    def test_anonymous_and_foreign_denied(self):
        self.assertEqual(self.request('GET', '/orgs/' + self.a + '/state')[0], 401)
        cookie, _ = self.login()
        self.assertEqual(self.request('GET', '/orgs/' + self.b + '/state', cookie=cookie)[0], 403)
        self.assertEqual(self.request('GET', '/orgs/' + self.a + '/state', cookie=cookie)[0], 200)
        self.assertEqual(self.request('GET', '/api/not-enabled', cookie=cookie)[0], 404)

    def test_csrf_origin_version_logout(self):
        cookie, csrf = self.login()
        path = '/orgs/' + self.a + '/state'
        payload = {'version': 0, 'data': {'projects': {'p': {'city': 'same'}}}}
        self.assertEqual(self.request('PUT', path, payload, cookie=cookie)[0], 403)
        self.assertEqual(self.request('PUT', path, payload, cookie=cookie, csrf=csrf, origin='https://evil.test')[0], 403)
        self.assertEqual(self.request('PUT', path, payload, cookie=cookie, csrf=csrf)[0], 200)
        self.assertEqual(self.request('PUT', path, payload, cookie=cookie, csrf=csrf)[0], 409)
        self.assertEqual(self.request('POST', '/auth/logout', {}, cookie=cookie, csrf=csrf)[0], 200)
        self.assertEqual(self.request('GET', path, cookie=cookie)[0], 401)

    def test_session_resume_stable_csrf_and_cross_origin_denied(self):
        cookie, original_csrf = self.login()
        status, _, data = self.request('GET', '/auth/session', cookie=cookie)
        self.assertEqual(data.get('csrf'), original_csrf)
        self.assertEqual(status, 200)
        self.assertEqual(data['principal']['org_id'], self.a)
        self.assertEqual(self.request('GET', '/auth/session', cookie=cookie)[2]['csrf'], data['csrf'])
        self.assertEqual(self.request('POST', '/api/sync', {'_version': 0}, cookie, data['csrf'])[0], 200)
        self.assertEqual(self.request('GET', '/auth/session', cookie=cookie, origin='https://evil.test')[0], 403)

    def test_login_throttled(self):
        for _ in range(5):
            self.assertEqual(self.request('POST', '/auth/login', {'login': 'alice', 'password': 'wrong'})[0], 401)
        self.assertEqual(self.request('POST', '/auth/login', {'login': 'alice', 'password': 'wrong'})[0], 429)


if __name__ == '__main__':
    unittest.main()
