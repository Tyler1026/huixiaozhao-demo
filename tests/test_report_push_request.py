"""Exercise the production push route with synthetic storage and no credentials."""
import ast
import http.client
import io
import json
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import MethodType, SimpleNamespace
from unittest.mock import Mock
from backend.auth import AdminConfig, handle_auth
from report_service.website_queue import ENGINE

ROOT = Path(__file__).resolve().parents[1]


class ReportPushRequestTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((ROOT / 'server.py').read_text())
        handler = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Handler')
        method_names = {'do_POST', '_account_session', '_account_config', '_secure_cookie'}
        methods = [n for n in handler.body if isinstance(n, ast.FunctionDef) and n.name in method_names]
        self.state = {
            'PROJECTS': {'keep': {'city': 'Other'}},
            'REPORT_REQUESTS': [
                {'id': 'old', 'city': 'A', 'status': 'done', 'ts': 1, 'engine': ENGINE},
                {'id': 'new', 'city': 'A', 'status': 'done', 'ts': 2, 'engine': ENGINE},
                {'id': 'other', 'city': 'B', 'status': 'done', 'ts': 3, 'engine': ENGINE},
            ],
        }
        self.write = Mock(return_value=True)
        self.read = Mock(side_effect=lambda: json.dumps(self.state))
        session = Mock()
        session.__enter__ = Mock(return_value=session)
        session.__exit__ = Mock(return_value=False)
        session.read = self.read
        def commit(raw):
            committed = self.write(raw)
            if committed is True:
                self.state = json.loads(raw)
            return committed
        session.write = commit
        self.ns = dict(json=json, time=time, _PG_AVAIL=True, DATABASE_URL='synthetic',
                       os=SimpleNamespace(environ={'HXZ_ADMIN_USERNAME':'offline-admin',
                                                   'HXZ_ADMIN_PASSWORD':'offline-admin-password-7'}),
                       _db_get=self.read, _db_set=self.write, SYNC_PATH='unused',
                       _file_snapshot=Mock(), _sync_transaction=lambda: session)
        unit = ast.Module(body=methods, type_ignores=[])
        exec(compile(unit, 'isolated-report-push', 'exec'), self.ns)
        # Run actual credential validation and session creation against this
        # synthetic storage seam; later requests use the persisted cookie.
        login = handle_auth('login', {'username':'offline-admin', 'password':'offline-admin-password-7'},
                            lambda: session, admin_config=AdminConfig('offline-admin', 'offline-admin-password-7'))
        self.cookie = 'hxz_session=' + login['session_token']
        self.read.reset_mock(); self.write.reset_mock()

    def request(self, body=None, raw=None):
        payload = raw if raw is not None else json.dumps(body).encode()
        responder = Mock()
        responder.path = '/api/report-push-request'
        responder.headers = {'Content-Length': str(len(payload)), 'Cookie':self.cookie}
        responder.rfile = io.BytesIO(payload)
        responder.wfile = io.BytesIO()
        for name in ('_account_session', '_account_config', '_secure_cookie'):
            setattr(responder, name, MethodType(self.ns[name], responder))
        self.ns['do_POST'](responder)
        self.assertEqual(responder.send_response.call_count, 1)
        return responder.send_response.call_args.args[0], json.loads(responder.wfile.getvalue())

    def test_clicked_request_is_selected_among_same_city_reports(self):
        status, body = self.request({'requestId': 'old', 'city': 'A'})
        self.assertEqual(status, 200)
        self.assertTrue(body['ok'])
        self.assertEqual(body['id'], 'old')
        saved = json.loads(self.write.call_args.args[0])
        self.assertTrue(saved['REPORT_REQUESTS'][0]['pushRequested'])
        self.assertFalse(saved['REPORT_REQUESTS'][0]['pushed'])
        self.assertNotIn('pushRequested', saved['REPORT_REQUESTS'][1])
        self.assertNotIn('pushRequested', saved['REPORT_REQUESTS'][2])
        self.assertEqual(saved['PROJECTS'], self.state['PROJECTS'])

    def test_unknown_city_never_falls_back_to_another_city(self):
        status, body = self.request({'city': 'Missing'})
        self.assertEqual(status, 404)
        self.assertFalse(body['ok'])
        self.write.assert_not_called()

    def test_missing_id_or_city_mismatch_never_falls_back(self):
        for request_id, city in [('missing', 'A'), ('old', 'B')]:
            with self.subTest(request_id=request_id, city=city):
                status, body = self.request({'requestId': request_id, 'city': city})
                self.assertEqual(status, 404)
                self.assertFalse(body['ok'])
                self.write.assert_not_called()

    def test_incomplete_request_is_rejected(self):
        self.state['REPORT_REQUESTS'][0]['status'] = 'running'
        status, body = self.request({'requestId': 'old', 'city': 'A'})
        self.assertEqual(status, 409)
        self.assertFalse(body['ok'])
        self.write.assert_not_called()

    def test_unambiguous_legacy_city_request_still_works(self):
        status, body = self.request({'city': 'B'})
        self.assertEqual(status, 200)
        self.assertTrue(body['ok'])
        self.assertEqual(body['id'], 'other')

    def test_ambiguous_legacy_city_request_requires_refresh(self):
        status, body = self.request({'city': 'A'})
        self.assertEqual(status, 409)
        self.assertFalse(body['ok'])
        self.write.assert_not_called()

    def test_duplicate_request_ids_are_rejected(self):
        self.state['REPORT_REQUESTS'][1]['id'] = 'old'
        status, body = self.request({'requestId': 'old', 'city': 'A'})
        self.assertEqual(status, 409)
        self.assertFalse(body['ok'])
        self.write.assert_not_called()

    def test_failed_database_write_is_not_acknowledged(self):
        self.write.return_value = False
        status, body = self.request({'requestId': 'old', 'city': 'A'})
        self.assertEqual(status, 503)
        self.assertFalse(body['ok'])

    def test_failed_read_does_not_write_an_empty_replacement(self):
        self.read.side_effect = None
        self.read.return_value = None
        status, body = self.request({'requestId': 'old', 'city': 'A'})
        self.assertEqual(status, 503)
        self.assertFalse(body['ok'])
        self.write.assert_not_called()

    def test_storage_exceptions_do_not_expose_private_details(self):
        self.write.side_effect = OSError('synthetic private storage detail')
        status, body = self.request({'requestId': 'old', 'city': 'A'})
        self.assertEqual(status, 503)
        self.assertFalse(body['ok'])
        self.assertNotIn('synthetic private', body['error'])

    def test_retries_do_not_reset_pending_or_completed_pushes(self):
        for flag in ['pushRequested', 'pushed']:
            with self.subTest(flag=flag):
                self.state['REPORT_REQUESTS'][0] = {
                    'id': 'old', 'city': 'A', 'status': 'done', flag: True,
                    'pushRequestedTs': 123, 'engine': ENGINE,
                }
                status, body = self.request({'requestId': 'old', 'city': 'A'})
                self.assertEqual(status, 200)
                self.assertTrue(body['ok'])
                self.assertTrue(body['alreadyRequested'])
                self.write.assert_not_called()

    def test_unpublished_historical_report_does_not_wait_for_a_desktop_publisher(self):
        target = self.state['REPORT_REQUESTS'][0]
        target.pop('engine')
        target['pushRequested'] = True  # An old request must not be acknowledged again.
        status, body = self.request({'requestId': 'old', 'city': 'A'})
        self.assertEqual(status, 409)
        self.assertEqual(body['code'], 'legacy-report-requires-regeneration')
        self.write.assert_not_called()
        target['pushed'] = True
        status, body = self.request({'requestId': 'old', 'city': 'A'})
        self.assertEqual(status, 200)
        self.assertTrue(body['pushed'])
        self.write.assert_not_called()

    def test_invalid_input_is_rejected_after_only_the_authentication_read(self):
        for body in [[], {}, {'city': []}, {'city': ' '}, {'city': 'A', 'requestId': []},
                     {'city': 'A', 'requestId': ''}]:
            with self.subTest(body=body):
                status, response = self.request(body)
                self.assertEqual(status, 400)
                self.assertFalse(response['ok'])
                # The HTTP boundary must read current credentials before the
                # domain route; invalid input still never reaches its storage.
                self.read.assert_called_once()
                self.write.assert_not_called()
                self.read.reset_mock()
        status, body = self.request(raw=b'{invalid')
        self.assertEqual(status, 400)
        self.assertFalse(body['ok'])

    def test_file_storage_saves_the_selected_request(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            path.write_text(json.dumps(self.state))
            self.ns.update(_PG_AVAIL=False, SYNC_PATH=str(path))
            status, body = self.request({'requestId': 'old', 'city': 'A'})
            self.assertEqual(status, 200)
            self.assertTrue(body['ok'])
            saved = json.loads(path.read_text())
            self.assertTrue(saved['REPORT_REQUESTS'][0]['pushRequested'])
            self.assertNotIn('pushRequested', saved['REPORT_REQUESTS'][1])
            self.ns['_file_snapshot'].assert_called_once()
            self.write.assert_not_called()

    def test_file_write_failure_is_not_acknowledged(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            path.write_text(json.dumps(self.state))
            self.ns.update(_PG_AVAIL=False, SYNC_PATH=str(path))
            self.ns['_file_snapshot'].side_effect = OSError('synthetic failure')
            status, body = self.request({'requestId': 'old', 'city': 'A'})
            self.assertEqual(status, 503)
            self.assertFalse(body['ok'])
            self.assertEqual(json.loads(path.read_text()), self.state)

    def test_push_route_status_and_body_over_real_http(self):
        handler = type('IsolatedHandler', (BaseHTTPRequestHandler,), {
            'do_POST': self.ns['do_POST'],
            '_account_session': self.ns['_account_session'],
            '_account_config': self.ns['_account_config'],
            '_secure_cookie': self.ns['_secure_cookie'],
            'cors': lambda responder: None,
            'log_message': lambda responder, *args: None,
        })
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def request(body):
            connection = http.client.HTTPConnection(*server.server_address, timeout=3)
            try:
                connection.request('POST', '/api/report-push-request', json.dumps(body),
                                   {'Content-Type': 'application/json', 'Cookie':self.cookie})
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally:
                connection.close()

        try:
            status, body = request({'requestId': 'old', 'city': 'A'})
            self.assertEqual(status, 200)
            self.assertEqual(body['id'], 'old')
            self.assertTrue(body['ok'])
            status, body = request({'city': 'Missing'})
            self.assertEqual(status, 404)
            self.assertFalse(body['ok'])
            self.write.return_value = False
            # The first write really persisted in this fixture. Use another
            # unrequested report so idempotent retry does not skip the commit.
            status, body = request({'requestId': 'new', 'city': 'A'})
            self.assertEqual(status, 503)
            self.assertFalse(body['ok'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
