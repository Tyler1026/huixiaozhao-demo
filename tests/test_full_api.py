import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from report_service.full_api import make_handler, ThreadingHTTPServer
from report_service.full_store import FullStore

TOKEN_A = 'synthetic-a-' + 'a' * 40
TOKEN_B = 'synthetic-b-' + 'b' * 40


class FullAPITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = FullStore(Path(self.tmp.name) / 'db', artifact_root=Path(self.tmp.name) / 'artifacts')
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(self.store, {TOKEN_A: 'org-a', TOKEN_B: 'org-b'}))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:' + str(self.server.server_port)
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.tmp.cleanup()

    def request(self, path, data=None, token=TOKEN_A, headers=None):
        h = {'Content-Type': 'application/json'}
        if token: h['Authorization'] = 'Bearer ' + token
        h.update(headers or {})
        req = urllib.request.Request(self.base + path, headers=h, data=json.dumps(data).encode() if data is not None else None)
        try: r = urllib.request.urlopen(req, timeout=3)
        except urllib.error.HTTPError as e: r = e
        with r: return r.status, r.read(), dict(r.headers)

    def create(self, key='test'):
        status, body, _ = self.request('/v1/reports', {'province': '上海市', 'city': '合成区', 'idempotency_key': key, 'synthetic': True})
        self.assertEqual(status, 201)
        return json.loads(body)

    def test_auth_and_cross_tenant(self):
        self.assertEqual(self.request('/v1/reports', token=None)[0], 401)
        report = self.create()
        self.assertEqual(self.request('/v1/reports/' + report['id'], token=TOKEN_B)[0], 404)
        self.assertEqual(self.request('/v1/reports/' + report['id'])[0], 200)

    def test_browser_credentials_rejected(self):
        self.assertEqual(self.request('/v1/reports', headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request('/v1/reports', headers={'Cookie': 'session=anything'})[0], 403)

    def test_idempotency_and_payload_conflict(self):
        report = self.create()
        payload = {'province': '上海市', 'city': '合成区', 'idempotency_key': 'test', 'synthetic': True}
        status, body, _ = self.request('/v1/reports', payload)
        self.assertEqual(status, 200); self.assertEqual(json.loads(body)['id'], report['id'])
        payload['city'] = 'another'
        self.assertEqual(self.request('/v1/reports', payload)[0], 409)

    def test_live_default_closed_and_untrusted_tenant_rejected(self):
        payload = {'province': 'p', 'city': 'c', 'idempotency_key': 'k', 'synthetic': False}
        self.assertEqual(self.request('/v1/reports', payload)[0], 403)
        payload['synthetic'] = True; payload['tenant'] = 'org-b'
        self.assertEqual(self.request('/v1/reports', payload)[0], 400)

    def test_no_artifacts_before_completed(self):
        r = self.create()
        self.assertEqual(self.request('/v1/reports/' + r['id'] + '/artifacts/full.docx')[0], 409)
        self.assertEqual(self.request('/v1/reports/' + r['id'] + '/artifacts/..%2Fsecrets')[0], 404)
        self.assertEqual(self.request('/v1/reports/' + r['id'] + '/artifacts/full.docx', token=TOKEN_B)[0], 404)

    def test_status_is_persistent_and_no_fake_eta(self):
        r = self.create(); self.store.claim()
        status, body, headers = self.request('/v1/reports/' + r['id'])
        report = json.loads(body)
        self.assertEqual(status, 200); self.assertEqual(report['status'], 'running')
        self.assertIsNone(report['progress_at']); self.assertIsNone(report['eta_seconds'])
        self.assertNotIn(TOKEN_A, body.decode())
        self.assertNotIn('Access-Control-Allow-Origin', headers)
        self.assertEqual(headers['Cache-Control'], 'no-store')

    def test_token_map_has_no_default_tenant_fallback(self):
        for mapping in ({}, {'short': 'org-a'}, {TOKEN_A: 'default'}):
            with self.assertRaises(ValueError): make_handler(self.store, mapping)


if __name__ == '__main__': unittest.main()
