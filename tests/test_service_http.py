import unittest
import http.client
import json
import test_identity_http as harness


class ServiceHTTPTests(unittest.TestCase):
    setUp = harness.HTTPTests.setUp
    tearDown = harness.HTTPTests.tearDown

    def test_real_pipeline_adapter_retry_and_revoke(self):
        from identity.pipeline_client import deliver
        self.store.bootstrap_admin('platform', 'synthetic platform password')
        admin = self.store.authenticate(self.store.login('platform', 'synthetic platform password')[0])
        user = self.store.authenticate(self.store.login('alice', 'alice password long enough')[0])
        self.store.put_state(user, self.a, {'projects': {'p': {}}}, 0)
        token = self.store.issue_service(admin, self.a, 'p')
        first = deliver(self.origin, token, 'p', 'synthetic report', 1, 'job-1')
        self.assertEqual(first, deliver(self.origin, token, 'p', 'synthetic report', 1, 'job-1'))
        self.store.revoke_service(admin, token)
        with self.assertRaisesRegex(RuntimeError, '401'):
            deliver(self.origin, token, 'p', 'synthetic report', 1, 'job-1')

    def test_delivery_scope_and_cookie_api_denial(self):
        self.store.bootstrap_admin('platform', 'synthetic platform password')
        admin = self.store.authenticate(self.store.login('platform', 'synthetic platform password')[0])
        user = self.store.authenticate(self.store.login('alice', 'alice password long enough')[0])
        self.store.put_state(user, self.a, {'projects': {'p': {}}}, 0)
        token = self.store.issue_service(admin, self.a, 'p')
        def request(path, body, bearer=token):
            c = http.client.HTTPConnection('127.0.0.1', self.port)
            c.request('POST', path, json.dumps(body), {'Authorization': 'Bearer ' + bearer, 'Content-Type': 'application/json'})
            r = c.getresponse(); data = json.loads(r.read()); c.close()
            return r.status, data
        self.assertEqual(request('/service/report-delivery', {'project_id': 'p', 'text': 'report', 'version': 1})[0], 200)
        self.assertEqual(request('/service/report-delivery', {'project_id': 'foreign', 'text': 'report', 'version': 2})[0], 403)
        self.assertEqual(request('/api/sync', {'_version': 2})[0], 403)
        self.assertEqual(request('/service/report-delivery', {'project_id': 'p', 'text': 'report', 'version': 2}, 'fake')[0], 401)
        self.store.revoke_service(admin, token)
        self.assertEqual(request('/service/report-delivery', {'project_id': 'p', 'text': 'report', 'version': 2})[0], 401)


if __name__ == '__main__':
    unittest.main()
