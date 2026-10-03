"""Real file concurrency and PostgreSQL transaction acknowledgement gates."""
import concurrent.futures
import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from backend.sync_route import SyncDependencies
from backend.sync_transaction import PostgresSession, file_session, handle_sync_serialized


def responder():
    h = Mock(); h.wfile = io.BytesIO(); return h


class SyncTransactionTests(unittest.TestCase):
    def test_concurrent_report_and_project_updates_are_all_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'state.json')
            deps = SyncDependencies(False, None, None, path, lambda: None, lambda x: x)
            def update(number):
                h = responder()
                raw = json.dumps({'PROJECTS': {str(number): {'city': str(number)}},
                                  'REPORT_REQUESTS': [{'id': 'rr' + str(number), 'status': 'pending', 'ts': number}]}).encode()
                handle_sync_serialized(h, raw, deps)
                return json.loads(h.wfile.getvalue())['ok']
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
                self.assertTrue(all(pool.map(update, range(20))))
            saved = json.loads(Path(path).read_text())
            self.assertEqual(len(saved['PROJECTS']), 20)
            self.assertEqual(len(saved['REPORT_REQUESTS']), 20)

    def test_file_replace_failure_keeps_old_complete_bytes_and_refuses_success(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'; original = '{"PROJECTS":{"old":{"city":"A"}}}'
            path.write_text(original)
            deps = SyncDependencies(False, None, None, str(path), lambda: None, lambda x: x)
            h = responder()
            with patch('backend.sync_transaction.os.replace', side_effect=OSError('fault injection')):
                handle_sync_serialized(h, b'{"PROJECTS":{"new":{"city":"B"}}}', deps)
            self.assertFalse(json.loads(h.wfile.getvalue())['ok'])
            self.assertEqual(path.read_text(), original)
            self.assertEqual({p.name for p in Path(directory).iterdir()}, {'state.json', 'state.json.lock'})

    def test_snapshot_is_of_old_state_and_invalid_input_releases_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'; path.write_text('{"PROJECTS":{"old":{}}}')
            snapshots = []
            deps = SyncDependencies(False, None, None, str(path), lambda: snapshots.append(path.read_text()), lambda x: x)
            h = responder(); handle_sync_serialized(h, b'{bad', deps)
            self.assertFalse(json.loads(h.wfile.getvalue())['ok'])
            handle_sync_serialized(responder(), b'{"PROJECTS":{"new":{}}}', deps)
            self.assertEqual(list(json.loads(snapshots[0])['PROJECTS']), ['old'])

    def test_cancelled_status_and_existing_report_files_survive_stale_write(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            old = {'REPORT_REQUESTS': [{'id': 'rr1', 'status': 'cancelled', 'files': [{'b64': 'eA=='}]}]}
            path.write_text(json.dumps(old))
            deps = SyncDependencies(False, None, None, str(path), lambda: None, lambda x: x)
            handle_sync_serialized(responder(), b'{"REPORT_REQUESTS":[{"id":"rr1","status":"running"}]}', deps)
            self.assertEqual(json.loads(path.read_text())['REPORT_REQUESTS'], old['REPORT_REQUESTS'])

    def test_postgres_commit_precedes_http_acknowledgement_and_resources_close(self):
        connection = Mock(); cursor = connection.cursor.return_value
        cursor.fetchone.return_value = ('{}',)
        h = responder(); events = []
        connection.commit.side_effect = lambda: events.append('commit')
        h.send_response.side_effect = lambda status: events.append('http')
        deps = SyncDependencies(True, None, None, 'unused', None, lambda x: x)
        handle_sync_serialized(h, b'{"PROJECTS":{"new":{}}}', deps,
                               transaction=lambda: PostgresSession(lambda: connection, lambda c: None))
        self.assertEqual(events, ['commit', 'http'])
        self.assertTrue(json.loads(h.wfile.getvalue())['ok'])
        sql = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertTrue(any('FOR UPDATE' in s for s in sql))
        connection.rollback.assert_not_called(); cursor.close.assert_called_once(); connection.close.assert_called_once()

    def test_commit_failure_rolls_back_and_does_not_acknowledge_success(self):
        connection = Mock(); connection.cursor.return_value.fetchone.return_value = ('{}',)
        connection.commit.side_effect = OSError('credential-shaped private detail')
        h = responder(); deps = SyncDependencies(True, None, None, 'unused', None, lambda x: x)
        handle_sync_serialized(h, b'{"PROJECTS":{"new":{}}}', deps,
                               transaction=lambda: PostgresSession(lambda: connection, lambda c: None))
        self.assertFalse(json.loads(h.wfile.getvalue())['ok'])
        self.assertNotIn(b'private detail', h.wfile.getvalue())
        connection.rollback.assert_called_once(); connection.close.assert_called_once()

    def test_lock_failure_closes_connection_and_returns_safe_error(self):
        connection = Mock(); connection.cursor.return_value.execute.side_effect = OSError('private detail')
        h = responder(); deps = SyncDependencies(True, None, None, 'unused', None, lambda x: x)
        handle_sync_serialized(h, b'{}', deps, transaction=lambda: PostgresSession(lambda: connection, lambda c: None))
        self.assertFalse(json.loads(h.wfile.getvalue())['ok'])
        self.assertNotIn(b'private detail', h.wfile.getvalue())
        connection.close.assert_called_once()

    def test_disconnected_browser_does_not_undo_a_committed_request(self):
        connection = Mock(); connection.cursor.return_value.fetchone.return_value = ('{}',)
        h = responder(); h.send_response.side_effect = BrokenPipeError()
        deps = SyncDependencies(True, None, None, 'unused', None, lambda x: x)
        handle_sync_serialized(h, b'{"REPORT_REQUESTS":[{"id":"rr1","status":"pending"}]}', deps,
                               transaction=lambda: PostgresSession(lambda: connection, lambda c: None))
        connection.commit.assert_called_once(); connection.rollback.assert_not_called()

    def test_bounded_read_preserves_json_and_closes_resources(self):
        from backend import storage
        from backend.sync_transaction import read_sync_bounded
        driver = Mock(); connection = driver.connect.return_value
        connection.cursor.return_value.fetchone.return_value = ('{"REPORT_REQUESTS":[]}',)
        with patch.object(storage, 'psycopg2', driver, create=True):
            self.assertEqual(read_sync_bounded(), '{"REPORT_REQUESTS":[]}')
        self.assertEqual(driver.connect.call_args.kwargs['connect_timeout'], 10)
        connection.cursor.return_value.close.assert_called_once(); connection.close.assert_called_once()

    def test_bounded_read_failure_is_not_empty_success_and_does_not_leak_connection(self):
        from backend import storage
        from backend.sync_transaction import read_sync_bounded
        driver = Mock(); connection = driver.connect.return_value
        connection.cursor.return_value.execute.side_effect = OSError('private detail')
        with patch.object(storage, 'psycopg2', driver, create=True):
            self.assertIsNone(read_sync_bounded())
        connection.close.assert_called_once()


@unittest.skipUnless(os.environ.get('HXZ_TEST_DATABASE_URL'), 'isolated PostgreSQL CI fixture only')
class PostgresConcurrencyTests(unittest.TestCase):
    def test_twenty_concurrent_real_postgres_syncs_preserve_every_report(self):
        import psycopg2
        url = os.environ['HXZ_TEST_DATABASE_URL']
        # Never use DATABASE_URL or inherited production credentials in tests.
        from urllib.parse import urlsplit
        parsed = urlsplit(url)
        self.assertIn(parsed.hostname, ('localhost', '127.0.0.1'))
        self.assertEqual(parsed.path, '/report_ci')
        with psycopg2.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute('CREATE TABLE IF NOT EXISTS sync_data(id INTEGER PRIMARY KEY,data TEXT NOT NULL,updated_at TIMESTAMP DEFAULT NOW())')
                cur.execute("INSERT INTO sync_data VALUES(1,'{}',NOW()) ON CONFLICT(id) DO UPDATE SET data='{}'")
        deps = SyncDependencies(True, None, None, 'unused', None, lambda x: x)
        def update(n):
            h = responder()
            raw = json.dumps({'REPORT_REQUESTS': [{'id': 'rr' + str(n), 'status': 'pending', 'ts': n}]}).encode()
            handle_sync_serialized(h, raw, deps,
                                   transaction=lambda: PostgresSession(lambda: psycopg2.connect(url, connect_timeout=3), lambda c: None))
            return json.loads(h.wfile.getvalue())['ok']
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            self.assertTrue(all(pool.map(update, range(20))))
        with psycopg2.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT data FROM sync_data WHERE id=1')
                self.assertEqual(len(json.loads(cur.fetchone()[0])['REPORT_REQUESTS']), 20)


if __name__ == '__main__': unittest.main()
