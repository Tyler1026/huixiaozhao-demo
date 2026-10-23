"""Admin maintenance must not overwrite committed edits or acknowledge failures."""
import concurrent.futures
from contextlib import contextmanager
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urlsplit

from backend import kb_admin, kb_edits
from backend.auth import AuthError
from backend.sync_transaction import PostgresSession, file_session


KEY = 'workspace-test'
ADMIN = {'scope': 'admin', 'user': 'admin'}
MEMBER = {'scope': 'project', 'user': 'member', 'projectKeys': [KEY], 'projKey': KEY}


def state():
    return {'PROJECTS': {KEY: {'workspaceId': KEY, 'city': '测试市', 'kb': [
        {'t': '政策', 'known': ['原报告政策。']}] }}, 'KB_EDITS': {KEY: {
            'already-saved': {'text': '之前已提交的修订', 'revision': 1}}},
            'UPLOADS': {KEY: [{'name': '已有原件.txt', 'originalId': 'a' * 32}]}}


def handler():
    value = Mock(); value.headers = {}; value.wfile = io.BytesIO()
    return value


def request(factory, value, *, operation='clean'):
    h = handler()
    kb_admin.handle_kb_admin(h, json.dumps(value).encode(), factory, operation=operation)
    return h.send_response.call_args.args[0], json.loads(h.wfile.getvalue())


def clean_body():
    return {'projectKey': KEY, 'kb': [{'t': '政策', 'known': ['管理员整理后的资料。']}]}


def note_body():
    return {'projectKey': KEY, 'sectionIndex': 0, 'sectionTitle': '政策',
            'baseReportVersion': None, 'sourceIndex': None, 'sourceItem': None,
            'editId': None, 'expectedRevision': 0, 'resetGen': None,
            'text': '并发提交的独立修订应长期保留。'}


class AdminMaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'state.json'
        self.path.write_text(json.dumps(state()))
        self.factory = lambda: file_session(str(self.path), lambda: None)
        self.auth = patch.object(kb_admin, 'require_session', return_value=ADMIN)
        self.auth.start(); self.addCleanup(self.auth.stop)

    def read(self):
        return json.loads(self.path.read_text())

    def test_clean_keeps_other_committed_state(self):
        before = self.read()
        status, result = request(self.factory, clean_body())
        self.assertEqual(status, 200); self.assertEqual(result, {'ok': True, 'total': 1})
        saved = self.read()
        self.assertEqual(saved['PROJECTS'][KEY]['kb'], clean_body()['kb'])
        self.assertEqual(saved['KB_EDITS'], before['KB_EDITS'])
        self.assertEqual(saved['UPLOADS'], before['UPLOADS'])

    def test_snapshot_and_rollback_keep_protocol_and_other_state(self):
        before = self.read()
        self.assertEqual(request(self.factory, {'city': '测试市', 'label': '第一版'}, operation='version')[1],
                         {'ok': True, 'ver': 1, 'versions': 1})
        request(self.factory, clean_body())
        status, result = request(self.factory, {'projectKey': KEY, 'action': 'rollback', 'ver': 1}, operation='version')
        self.assertEqual(status, 200); self.assertEqual(result, {'ok': True, 'restored': 1})
        saved = self.read()
        self.assertEqual(saved['PROJECTS'][KEY]['kb'], before['PROJECTS'][KEY]['kb'])
        self.assertEqual(saved['KB_EDITS'], before['KB_EDITS'])
        self.assertEqual(saved['UPLOADS'], before['UPLOADS'])

    def test_more_than_ten_snapshots_have_unique_monotonic_versions(self):
        for number in range(1, 14):
            result = request(self.factory, {'projectKey': KEY}, operation='version')[1]
            self.assertEqual(result['ver'], number)
        self.assertEqual([v['ver'] for v in self.read()['PROJECTS'][KEY]['kbVersions']], list(range(4, 14)))

    def test_invalid_operation_does_not_write(self):
        for operation, body in [('clean', {'projectKey': KEY, 'kb': None}),
                                ('version', {'projectKey': KEY, 'action': 'invalid'}),
                                ('version', {'projectKey': KEY, 'action': 'rollback', 'ver': 99})]:
            before = self.path.read_bytes()
            self.assertFalse(request(self.factory, body, operation=operation)[1]['ok'])
            self.assertEqual(self.path.read_bytes(), before)

    def test_actual_file_replace_failure_refuses_success_and_retains_old_state(self):
        before = self.path.read_bytes()
        with patch('backend.sync_transaction.os.replace', side_effect=OSError('private detail')):
            status, result = request(self.factory, clean_body())
        self.assertEqual(status, 503); self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'storage_unavailable')
        self.assertEqual(self.path.read_bytes(), before)
        self.assertNotIn('private detail', json.dumps(result))

    def test_commit_failure_snapshot_does_not_report_a_version(self):
        @contextmanager
        def failing():
            with self.factory() as session:
                session.write = lambda _: False
                yield session
        status, result = request(failing, {'projectKey': KEY}, operation='version')
        self.assertEqual(status, 503); self.assertFalse(result['ok'])
        self.assertNotIn('kbVersions', self.read()['PROJECTS'][KEY])

    def test_auth_is_rechecked_inside_transaction(self):
        before = self.path.read_bytes()
        with patch.object(kb_admin, 'require_session', side_effect=AuthError(401, 'auth_required', '请登录')):
            status, result = request(self.factory, clean_body())
        self.assertEqual(status, 401); self.assertFalse(result['ok'])
        self.assertEqual(self.path.read_bytes(), before)
        with patch.object(kb_admin, 'require_session', return_value=MEMBER):
            self.assertEqual(request(self.factory, clean_body())[0], 403)

    def test_invalid_body_and_cross_origin_do_not_open_storage(self):
        for raw, headers in [(b'[]', {}), (b'{', {}), (b'NaN', {}),
                             (b'{}', {'Sec-Fetch-Site': 'cross-site'})]:
            h = handler(); h.headers = headers; factory = Mock()
            kb_admin.handle_kb_admin(h, raw, factory, operation='clean')
            factory.assert_not_called()
            self.assertFalse(json.loads(h.wfile.getvalue())['ok'])

    def test_concurrent_note_and_each_admin_operation_keep_both_writes(self):
        for operation, body in [('clean', clean_body()), ('version', {'projectKey': KEY})]:
            with self.subTest(operation=operation):
                self.path.write_text(json.dumps(state()))
                self.assert_serialized_note(self.factory, operation, body, self.read)

    def assert_serialized_note(self, factory, operation, body, read):
        locked = threading.Event(); release = threading.Event()
        @contextmanager
        def paused_admin():
            with factory() as session:
                original_read = session.read
                def read_locked():
                    value = original_read(); locked.set()
                    if not release.wait(3):
                        raise TimeoutError('test lock timed out')
                    return value
                session.read = read_locked
                yield session
        def save_note():
            h = handler()
            with patch.object(kb_edits, 'require_session', return_value=MEMBER):
                kb_edits.handle_kb_edit(h, json.dumps(note_body()).encode(), factory)
            return json.loads(h.wfile.getvalue())
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            admin = pool.submit(request, paused_admin, body, operation=operation)
            self.assertTrue(locked.wait(3))
            note = pool.submit(save_note)
            release.set()
            self.assertTrue(admin.result(timeout=5)[1]['ok'])
            saved_note = note.result(timeout=5)
            self.assertTrue(saved_note['ok'])
        saved = read()
        self.assertIn(saved_note['record']['id'], saved['KB_EDITS'][KEY])
        self.assertIn('already-saved', saved['KB_EDITS'][KEY])
        self.assertEqual(saved['UPLOADS'], state()['UPLOADS'])
        if operation == 'clean':
            self.assertEqual(saved['PROJECTS'][KEY]['kb'], body['kb'])
        else:
            self.assertEqual(len(saved['PROJECTS'][KEY]['kbVersions']), 1)


@unittest.skipUnless(os.environ.get('HXZ_TEST_DATABASE_URL'), 'isolated PostgreSQL CI fixture only')
class AdminPostgresTests(unittest.TestCase):
    def setUp(self):
        import psycopg2
        url = os.environ['HXZ_TEST_DATABASE_URL']
        parsed = urlsplit(url)
        self.assertIn(parsed.hostname, ('localhost', '127.0.0.1'))
        self.assertEqual(parsed.path, '/report_ci')
        self.connect = lambda: psycopg2.connect(url)
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute('CREATE TABLE IF NOT EXISTS sync_data(id INTEGER PRIMARY KEY,data TEXT NOT NULL,updated_at TIMESTAMP DEFAULT NOW())')
                cur.execute('INSERT INTO sync_data(id,data) VALUES(1,%s) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data', (json.dumps(state()),))
        self.factory = lambda: PostgresSession(self.connect, lambda cur: None)
        self.auth = patch.object(kb_admin, 'require_session', return_value=ADMIN)
        self.auth.start(); self.addCleanup(self.auth.stop)

    def read(self):
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT data FROM sync_data WHERE id=1')
                return json.loads(cur.fetchone()[0])

    def test_real_postgres_serializes_clean_and_note(self):
        AdminMaintenanceTests.assert_serialized_note(self, self.factory, 'clean', clean_body(), self.read)

    def test_real_postgres_serializes_snapshot_and_note(self):
        AdminMaintenanceTests.assert_serialized_note(self, self.factory, 'version', {'projectKey': KEY}, self.read)

    def test_database_commit_failure_rolls_back_admin_change(self):
        @contextmanager
        def failing():
            with self.factory() as session:
                # Force a real aborted PostgreSQL transaction before commit.
                try:
                    session.cursor.execute('SELECT 1/0')
                except Exception:
                    pass
                yield session
        before = self.read()
        status, result = request(failing, clean_body())
        self.assertEqual(status, 503); self.assertFalse(result['ok'])
        self.assertEqual(self.read(), before)


if __name__ == '__main__':
    unittest.main()
