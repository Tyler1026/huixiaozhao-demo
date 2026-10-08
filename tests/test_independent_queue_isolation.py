"""Real HTTP and transaction fences; isolated fixtures never become reports."""
import ast
import copy
import http.client
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch

from backend import sync_merge
from backend.sync_read import read_sync
from backend.sync_route import SyncDependencies
from backend.sync_transaction import PostgresSession, handle_sync_serialized
from report_service import hosted
from report_service.website_queue import ENGINE, fence_updates, legacy_sync_view, website_reads_queue

ROOT = Path(__file__).resolve().parents[1]


def responder():
    handler = Mock()
    handler.wfile = io.BytesIO()
    return handler


def state_fixture():
    return {'PROJECTS': {'existing': {'city': 'offline fixture'}}, 'REPORT_REQUESTS': [
        {'id': 'rrnative', 'city': '离线区', 'province': '离线省',
         'mode': 'deep', 'status': 'pending', 'engine': ENGINE},
        {'id': 'rrlegacy', 'city': '离线旧区', 'province': '离线省', 'status': 'pending'},
        {'id': 'rrlegacyRunning', 'city': '离线在途区', 'province': '离线省',
         'status': 'running', 'done': 8},
        {'id': 'rrdone', 'city': '离线历史区', 'province': '离线省', 'status': 'done',
         'files': [{'kind': 'full', 'name': 'offline.txt', 'b64': 'b2xkIGJ5dGVz'}]},
    ]}


class QueueOwnershipTests(unittest.TestCase):
    def test_legacy_view_hides_all_native_jobs_without_changing_other_state(self):
        state = state_fixture()
        state['REPORT_REQUESTS'] += [dict(state['REPORT_REQUESTS'][0], id='rrnativeDone', status='done')]
        before = copy.deepcopy(state)
        view = legacy_sync_view(state)
        self.assertEqual([r['id'] for r in view['REPORT_REQUESTS']], ['rrlegacyRunning', 'rrdone'])
        self.assertEqual(view['PROJECTS'], state['PROJECTS'])
        self.assertEqual(state, before)
        wrapped = legacy_sync_view({'huixiaozhao_kb_v1': state, 'other': 7})
        self.assertEqual(wrapped['huixiaozhao_kb_v1'], view)
        self.assertEqual(wrapped['other'], 7)

    def test_website_header_and_cached_browser_fetch_metadata_select_full_view(self):
        self.assertTrue(website_reads_queue({'X-HXZ-Report-Client': 'website'}))
        self.assertTrue(website_reads_queue({'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors'}))
        for headers in ({}, {'User-Agent': 'Violoop'}, {'User-Agent': 'Mozilla'},
                        {'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors'}):
            self.assertFalse(website_reads_queue(headers))

    def test_view_failure_does_not_expose_the_unfiltered_queue_or_exception(self):
        h = responder()
        read_sync(h, True, lambda: json.dumps(state_fixture()), 'unused',
                  lambda value: (_ for _ in ()).throw(ValueError('private-detail')),
                  view=legacy_sync_view)
        self.assertEqual(json.loads(h.wfile.getvalue()), {'error': 'sync view unavailable'})

    def test_pending_claim_is_a_conflict_and_rolls_back_postgres_transaction(self):
        state = state_fixture()
        connection = Mock()
        connection.cursor.return_value.fetchone.return_value = (json.dumps(state),)
        h = responder()
        deps = SyncDependencies(True, None, None, 'unused', None, lambda x: x)
        raw = json.dumps({'REPORT_REQUESTS': [{'id': 'rrnative', 'status': 'running', 'claimTs': 123}],
                          'PROJECTS': {'unexpected': {'city': 'offline'}}}).encode()
        snapshot = Mock()
        handle_sync_serialized(h, raw, deps, guard=fence_updates,
            transaction=lambda: PostgresSession(lambda: connection, snapshot))
        h.send_response.assert_called_once_with(409)
        self.assertEqual(json.loads(h.wfile.getvalue())['rejected'], 'server-owned-report')
        connection.commit.assert_not_called()
        connection.rollback.assert_called_once()
        snapshot.assert_not_called()
        self.assertFalse(any(call.args[0].startswith('UPDATE sync_data')
            for call in connection.cursor.return_value.execute.call_args_list))

    def test_managed_guard_never_falls_back_to_an_unlocked_database_write(self):
        h = responder()
        read, write = Mock(), Mock()
        deps = SyncDependencies(True, read, write, 'unused', None, lambda x: x)
        handle_sync_serialized(h, b'{"PROJECTS":{"changed":{}}}', deps, guard=fence_updates)
        self.assertFalse(json.loads(h.wfile.getvalue())['ok'])
        read.assert_not_called(); write.assert_not_called()

    def test_health_tracks_a_real_child_exit_without_credentials_or_network_calls(self):
        env = {'DATABASE_URL': 'offline', 'DEEPSEEK_API_KEY': 'offline-private-fixture',
               'HXZ_SEARCH_KEY': 'offline-search-fixture', 'HXZ_REPORT_ENGINE': 'standalone',
               'HXZ_ENABLE_LIVE': '1'}
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(10)'], env={})
        state = {'thread': Mock(), 'stop': threading.Event(), 'process': child}
        state['thread'].is_alive.return_value = True
        try:
            with patch.object(hosted, '_supervisor_state', state):
                status = hosted.engine_status(env)
                self.assertTrue(status['worker_running'])
                self.assertTrue(status['configured'])
                self.assertNotIn('offline-private-fixture', json.dumps(status))
                self.assertNotIn('offline-search-fixture', json.dumps(status))
                child.terminate(); child.wait(timeout=3)
                self.assertFalse(hosted.engine_status(env)['worker_running'])
                self.assertEqual(hosted.engine_status(env)['scope'], 'process_and_configuration_only')
        finally:
            if child.poll() is None:
                child.kill(); child.wait()


class ActualQueueHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'state.json'
        self.original = state_fixture()
        self.path.write_text(json.dumps(self.original))
        source = ast.parse((ROOT / 'server.py').read_text())
        names = {'Handler', '_clean_sync_data', '_is_noise_chunk'}
        nodes = [n for n in source.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names]
        ns = dict(BaseHTTPRequestHandler=BaseHTTPRequestHandler, json=json, os=os,
            HTML_GOV=str(ROOT/'index.html'), HTML_OPS=str(ROOT/'ops.html'), PORT_OPS=-1,
            MODEL='offline-fixture', DS_KEY='', _PG_AVAIL=False, DATABASE_URL='', _NOISE_RE=[],
            SYNC_PATH=str(self.path), _file_snapshot=lambda: None, _db_get=lambda: None,
            _db_set=lambda value: False)
        ns.update({name: getattr(sync_merge, name) for name in dir(sync_merge)
                   if name.startswith('_') and not name.startswith('__')})
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'isolated-handler', 'exec'), ns)
        self.handler = ns['Handler']
        self.handler.log_message = lambda *args: None
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), self.handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        # Exercise the production default without either opt-in switch or keys.
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.close_server)

    def close_server(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.request(method, path, json.dumps(body) if body is not None else None, headers or {})
            response = connection.getresponse()
            self.response_headers = dict(response.getheaders())
            return response.status, response.read()
        finally:
            connection.close()

    def test_legacy_loop_cannot_discover_or_claim_native_job_but_website_can_cancel(self):
        status, body = self.request('GET', '/api/sync?raw=1')
        self.assertEqual(status, 200)
        self.assertEqual(self.response_headers['Cache-Control'], 'no-store')
        self.assertIn('X-HXZ-Report-Client', self.response_headers['Vary'])
        self.assertIn('Sec-Fetch-Site', self.response_headers['Vary'])
        self.assertNotIn('HXZ_REPORT_ENGINE', os.environ)
        self.assertEqual([r['id'] for r in json.loads(body)['REPORT_REQUESTS']], ['rrlegacyRunning', 'rrdone'])
        for headers in ({'X-HXZ-Report-Client': 'website'},
                        {'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors'}):
            status, body = self.request('GET', '/api/sync?raw=1', headers=headers)
            self.assertEqual([r['id'] for r in json.loads(body)['REPORT_REQUESTS']],
                             ['rrnative', 'rrlegacy', 'rrlegacyRunning', 'rrdone'])
        status, body = self.request('POST', '/api/sync',
            {'REPORT_REQUESTS': [{'id': 'rrnative', 'status': 'running', 'claimTs': 123}]},
            {'X-HXZ-Report-Client': 'website'})
        self.assertEqual(status, 409)
        self.assertFalse(json.loads(body)['ok'])
        self.assertEqual(json.loads(self.path.read_text()), self.original)
        status, body = self.request('POST', '/api/sync',
            {'REPORT_REQUESTS': [{'id': 'rrnative', 'status': 'cancelled'}]})
        self.assertEqual(status, 200); self.assertTrue(json.loads(body)['ok'])
        self.assertEqual(json.loads(self.path.read_text())['REPORT_REQUESTS'][0]['status'], 'cancelled')

    def test_old_requests_and_existing_download_bytes_keep_their_contract(self):
        status, body = self.request('POST', '/api/sync',
            {'REPORT_REQUESTS': [{'id': 'rrlegacyRunning', 'status': 'running', 'done': 9}]})
        self.assertEqual(status, 200); self.assertTrue(json.loads(body)['ok'])
        saved = json.loads(self.path.read_text())
        old = next(r for r in saved['REPORT_REQUESTS'] if r['id'] == 'rrlegacyRunning')
        self.assertEqual((old['status'], old['done']), ('running', 9))
        self.assertNotIn('engine', old)
        self.assertEqual(saved['PROJECTS'], self.original['PROJECTS'])
        query = urllib.parse.urlencode({'requestId': 'rrdone', 'city': '离线历史区', 'kind': 'full'})
        status, body = self.request('GET', '/api/report-file?' + query)
        self.assertEqual(status, 200); self.assertEqual(body, b'old bytes')
        with patch.dict(os.environ, {'HXZ_REPORT_ENGINE': ''}):
            status, body = self.request('GET', '/api/sync')
            self.assertEqual([r['id'] for r in json.loads(body)['REPORT_REQUESTS']],
                             ['rrlegacyRunning', 'rrdone'])
        status, body = self.request('GET', '/health')
        status = json.loads(body)['report_engine']
        self.assertEqual(status['engine'], 'standalone')
        self.assertFalse(status['worker_running'])
        self.assertEqual(status['scope'], 'process_and_configuration_only')

    def test_new_request_is_owned_before_a_worker_starts_and_old_snapshot_cannot_claim(self):
        request = {'id': 'rrnewDefault', 'city': '默认隔离区', 'province': '离线省',
                   'mode': 'deep', 'status': 'pending', 'by': 'offline', 'ts': 1}
        status, body = self.request('POST', '/api/sync', {'REPORT_REQUESTS': [request]},
                                   {'X-HXZ-Report-Client': 'website'})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)['ok'])
        saved = json.loads(self.path.read_text())
        target = next(r for r in saved['REPORT_REQUESTS'] if r['id'] == request['id'])
        self.assertEqual((target['engine'], target['status'], target['mode']),
                         (ENGINE, 'pending', 'deep'))
        status, body = self.request('GET', '/api/sync')
        self.assertNotIn(request['id'], [r['id'] for r in json.loads(body)['REPORT_REQUESTS']])
        status, body = self.request('GET', '/api/sync', headers={'X-HXZ-Report-Client': 'website'})
        self.assertIn(target, json.loads(body)['REPORT_REQUESTS'])
        status, body = self.request('POST', '/api/sync', {'REPORT_REQUESTS': [
            dict(request, status='running', claimTs=123)]})
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(body)['rejected'], 'server-owned-report')
        self.assertEqual(json.loads(self.path.read_text()), saved)

    def test_unmarked_pending_is_reserved_before_ingestion_and_can_be_cancelled(self):
        old_snapshot = copy.deepcopy(self.original['REPORT_REQUESTS'][1])
        self.assertNotIn('engine', old_snapshot)
        status, body = self.request('POST', '/api/sync', {'REPORT_REQUESTS': [
            dict(old_snapshot, status='running', claimTs=123)]})
        self.assertEqual(status, 409)
        self.assertFalse(json.loads(body)['ok'])
        self.assertEqual(json.loads(self.path.read_text()), self.original)
        status, body = self.request('POST', '/api/sync', {'REPORT_REQUESTS': [
            {'id': old_snapshot['id'], 'status': 'cancelled'}]},
            {'X-HXZ-Report-Client': 'website'})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)['ok'])
        cancelled = next(r for r in json.loads(self.path.read_text())['REPORT_REQUESTS']
                         if r['id'] == old_snapshot['id'])
        self.assertEqual((cancelled['engine'], cancelled['status']), (ENGINE, 'cancelled'))
        self.assertGreater(cancelled['cancelledTs'], 0)
        self.assertEqual(cancelled['city'], old_snapshot['city'])

    def test_disabled_or_unconfigured_worker_never_reopens_legacy_queue(self):
        for environment in ({}, {'HXZ_ENABLE_LIVE': '0'},
                            {'HXZ_REPORT_ENGINE': '', 'HXZ_ENABLE_LIVE': '0'},
                            {'HXZ_REPORT_ENGINE': 'legacy', 'HXZ_ENABLE_LIVE': '1'}):
            with self.subTest(environment=environment), patch.dict(os.environ, environment, clear=True):
                status, body = self.request('GET', '/api/sync')
                self.assertEqual(status, 200)
                self.assertEqual([r['id'] for r in json.loads(body)['REPORT_REQUESTS']],
                                 ['rrlegacyRunning', 'rrdone'])
                for request_id in ('rrnative', 'rrlegacy'):
                    status, body = self.request('POST', '/api/sync', {'REPORT_REQUESTS': [
                        {'id': request_id, 'status': 'running', 'claimTs': 123}]})
                    self.assertEqual(status, 409)
                    self.assertFalse(json.loads(body)['ok'])
                self.assertEqual(json.loads(self.path.read_text()), self.original)
                status, body = self.request('GET', '/health')
                self.assertEqual(status, 200)
                engine = json.loads(body)['report_engine']
                self.assertEqual(engine['engine'], 'standalone')
                self.assertFalse(engine['configured'])
                self.assertFalse(engine['worker_running'])
                self.assertIn('DATABASE_URL', engine['missing'])

    def test_running_reclaim_is_rejected_but_stale_snapshot_remains_compatible(self):
        state = copy.deepcopy(self.original)
        state['REPORT_REQUESTS'][0].update(status='running', done=7)
        self.path.write_text(json.dumps(state))
        status, body = self.request('POST', '/api/sync', {'REPORT_REQUESTS': [
            {'id': 'rrnative', 'status': 'running', 'claimTs': 999}]})
        self.assertEqual(status, 409)
        status, body = self.request('POST', '/api/sync', {'REPORT_REQUESTS': [
            {'id': 'rrnative', 'status': 'running', 'done': 1}]})
        self.assertEqual(status, 200); self.assertTrue(json.loads(body)['ok'])
        self.assertEqual(json.loads(self.path.read_text())['REPORT_REQUESTS'][0]['done'], 7)


@unittest.skipUnless(os.environ.get('HXZ_TEST_DATABASE_URL'), 'isolated PostgreSQL CI fixture only')
class ActualPostgresOwnershipTests(unittest.TestCase):
    def test_conflicting_legacy_claim_preserves_database_and_releases_lock(self):
        import psycopg2
        url = os.environ['HXZ_TEST_DATABASE_URL']
        parsed = urllib.parse.urlsplit(url)
        self.assertIn(parsed.hostname, ('localhost', '127.0.0.1'))
        self.assertEqual(parsed.path, '/report_ci')
        original = state_fixture()
        with psycopg2.connect(url) as connection:
            with connection.cursor() as cursor:
                cursor.execute('CREATE TABLE IF NOT EXISTS sync_data(id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at TIMESTAMP DEFAULT NOW())')
                cursor.execute('INSERT INTO sync_data(id,data) VALUES(1,%s) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
                               (json.dumps(original),))
        deps = SyncDependencies(True, None, None, 'unused', None, lambda value: value)
        h = responder()
        handle_sync_serialized(h, json.dumps({'REPORT_REQUESTS': [
            {'id': 'rrnative', 'status': 'running', 'claimTs': 123}]}).encode(), deps,
            guard=fence_updates, transaction=lambda: PostgresSession(
                lambda: psycopg2.connect(url, connect_timeout=3), lambda cursor: None))
        h.send_response.assert_called_once_with(409)
        with psycopg2.connect(url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '1s'")
                cursor.execute('SELECT data FROM sync_data WHERE id=1 FOR UPDATE')
                self.assertEqual(json.loads(cursor.fetchone()[0]), original)


if __name__ == '__main__':
    unittest.main()
