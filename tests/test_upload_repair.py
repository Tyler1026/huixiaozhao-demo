"""Legacy excerpt upgrades use only saved original bytes and fenced writes."""
import concurrent.futures
from contextlib import contextmanager
import copy
import json
import os
import threading
import unittest
from unittest.mock import Mock
from urllib.parse import urlsplit

from backend import upload_originals as uploads
from backend import upload_repair as repair
from backend.sync_transaction import PostgresSession


class PendingLegacyUploadTests(unittest.TestCase):
    def state(self):
        return {'PROJECTS': {'root': {'workspaceId': 'root', 'city': '同城'},
                             'child': {'workspaceId': 'root', 'city': '同城'},
                             'foreign': {'workspaceId': 'foreign', 'city': '同城'}},
                'UPLOADS': {'root': [{'name': '父工作区.txt', 'originalId': 'a' * 32}],
                            'child': [{'name': '当前工作区.txt', 'originalId': 'b' * 32}],
                            'foreign': [{'name': '其他工作区.txt', 'originalId': 'c' * 32}]}}

    def test_gate_reads_current_and_accessible_parent_without_same_city_neighbors(self):
        state = self.state(); before = copy.deepcopy(state)
        rows = repair.pending_legacy_uploads(state, 'child')
        self.assertEqual({row['projectKey'] for row in rows}, {'root', 'child'})
        self.assertEqual({row['originalId'] for row in rows}, {'a' * 32, 'b' * 32})
        self.assertEqual(state, before)
        rows[0]['name'] = 'caller change'
        self.assertEqual(state, before)

    def test_scoped_state_does_not_require_inaccessible_parent(self):
        state = self.state(); state['PROJECTS'].pop('root')
        self.assertEqual([row['projectKey'] for row in repair.pending_legacy_uploads(state, 'child')], ['child'])

    def test_completed_current_version_and_permanent_failure_do_not_block(self):
        state = self.state()
        state['UPLOADS']['root'][0]['chunkVersion'] = uploads.CHUNK_VERSION
        state['UPLOADS']['child'][0]['chunkRepair'] = {
            'version': uploads.CHUNK_VERSION, 'status': 'failed', 'code': 'original_not_found'}
        self.assertEqual(repair.pending_legacy_uploads(state, 'child'), [])
        state['UPLOADS']['child'][0]['chunkRepair']['version'] = uploads.CHUNK_VERSION - 1
        self.assertEqual(len(repair.pending_legacy_uploads(state, 'child')), 1)

    def test_running_lease_and_expired_lease_both_wait_for_committed_repair(self):
        state = self.state()
        state['UPLOADS']['root'][0]['chunkRepair'] = {'version': uploads.CHUNK_VERSION,
                                                       'status': 'running', 'leaseUntil': 10**20}
        state['UPLOADS']['child'][0]['chunkRepair'] = {'version': uploads.CHUNK_VERSION,
                                                        'status': 'running', 'leaseUntil': 1}
        self.assertEqual(len(repair.pending_legacy_uploads(state, 'child')), 2)

    def test_missing_invalid_or_inactive_originals_cannot_block_forever(self):
        for change in ({'originalId': None}, {'originalId': 'bad'}, {'originalId': 'A' * 32},
                       {'originalId': 1}, {'deleted': True}, {'pending': True},
                       {'parseFailed': True}, {'projectKey': 'foreign'}):
            with self.subTest(change=change):
                state = self.state()
                state['UPLOADS']['root'] = []
                state['UPLOADS']['child'][0].update(change)
                self.assertEqual(repair.pending_legacy_uploads(state, 'child'), [])
        state = self.state()
        state['UPLOADS']['root'] = []
        state['UPLOAD_TOMBS'] = {'child::当前工作区.txt': 1}
        self.assertEqual(repair.pending_legacy_uploads(state, 'child'), [])

    def test_duplicate_receipts_are_reported_once_per_project_and_original(self):
        state = self.state()
        state['UPLOADS']['child'].append(copy.deepcopy(state['UPLOADS']['child'][0]))
        self.assertEqual(len(repair.pending_legacy_uploads(state, 'child')), 2)


@unittest.skipUnless(os.environ.get('HXZ_TEST_DATABASE_URL'), 'isolated PostgreSQL CI fixture only')
class LegacyRepairPostgresTests(unittest.TestCase):
    def setUp(self):
        import psycopg2
        url = os.environ['HXZ_TEST_DATABASE_URL']
        parsed = urlsplit(url)
        self.assertIn(parsed.hostname, ('localhost', '127.0.0.1'))
        self.assertEqual(parsed.path, '/report_ci')
        self.connect = lambda: psycopg2.connect(url)
        self.factory = lambda: PostgresSession(self.connect, lambda cursor: None)
        self.text = '旧材料中原先遗漏的背景' * 120 + '尾部纠正：白鹭专项额度842万元。\n\n'
        self.text += '\n\n'.join('白鹭材料第%d段：签约条件和年度产值核实。' % i for i in range(70))
        self.text += '\n\n最后一段必须保留：2026年目标28家。'
        self.payload = self.text.encode()
        self.original = {'id': 'a' * 32, 'filename': '历史材料.txt', 'payload': self.payload,
                         'content_type': 'text/plain', 'size_bytes': len(self.payload),
                         'sha256': __import__('hashlib').sha256(self.payload).hexdigest()}
        self.key = 'workspace-test'
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute('CREATE TABLE IF NOT EXISTS sync_data(id INTEGER PRIMARY KEY,data TEXT NOT NULL,updated_at TIMESTAMP DEFAULT NOW())')
                uploads.initialize(cur)
                cur.execute('TRUNCATE upload_originals,sync_data')
        self.seed()

    def seed(self, *, admin=False):
        record = uploads.file_record(self.original, self.key, {'topic': '白鹭设备'}, 'member', 1)
        record.pop('chunkVersion')
        value = {'RESET_GEN': 'g1', 'PROJECTS': {self.key: {'city': '测试市', 'topic': '白鹭设备', 'kb': []}},
                 'UPLOADS': {self.key: [record]}, 'KB_FILE_CHUNKS': {self.key: [
                     {'id': 'old:0', 'originalId': self.original['id'], 'cite': self.original['filename'],
                      'text': self.text[:300], 'topic': '白鹭设备'}]}}
        if admin:
            value['KB_FILE_CHUNKS'] = {}
            value['PROJECTS'][self.key]['kbUploads'] = [{'originalId': self.original['id'], 'chunks': 1}]
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM upload_originals')
                uploads.save_original(cur, self.original, self.key, 'member')
                cur.execute('INSERT INTO sync_data(id,data) VALUES(1,%s) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',
                            (json.dumps(value),))
        return value

    def read(self):
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT data FROM sync_data WHERE id=1')
                return json.loads(cur.fetchone()[0])

    def test_full_original_rebuild_is_persisted_once_and_recovers_all_tail_text(self):
        parser = Mock(side_effect=lambda name, data: (data.decode(), None))
        result = repair.repair_legacy_uploads(self.factory, parser)
        self.assertEqual(result['repaired'], 1)
        saved = self.read()
        chunks = saved['KB_FILE_CHUNKS'][self.key]
        self.assertEqual(''.join(''.join(c['text'] for c in chunks).split()), ''.join(self.text.split()))
        self.assertTrue(any('目标28家' in c['text'] for c in chunks))
        self.assertEqual(saved['UPLOADS'][self.key][0]['chunkVersion'], uploads.CHUNK_VERSION)
        self.assertEqual(saved['UPLOADS'][self.key][0]['chunkRepair']['status'], 'ready')
        self.assertEqual(repair.repair_legacy_uploads(self.factory, parser)['claimed'], 0)
        parser.assert_called_once_with(self.original['filename'], self.payload)

    def test_admin_original_without_old_file_chunks_is_rebuilt(self):
        self.seed(admin=True)
        result = repair.repair_legacy_uploads(self.factory, lambda name, data: (data.decode(), None))
        self.assertEqual(result['repaired'], 1)
        saved = self.read()
        self.assertTrue(all(c['origin'] == 'admin' for c in saved['KB_FILE_CHUNKS'][self.key]))
        self.assertTrue(any('目标28家' in c['text'] for c in saved['KB_FILE_CHUNKS'][self.key]))
        self.assertEqual(saved['PROJECTS'][self.key]['kbUploads'][0]['chunks'], len(saved['KB_FILE_CHUNKS'][self.key]))

    def test_missing_original_is_reported_without_inventing_replacement_text(self):
        old = self.read()['KB_FILE_CHUNKS']
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM upload_originals')
        parser = Mock()
        self.assertEqual(repair.repair_legacy_uploads(self.factory, parser)['failed'], 1)
        parser.assert_not_called()
        saved = self.read()
        self.assertEqual(saved['KB_FILE_CHUNKS'], old)
        self.assertEqual(saved['UPLOADS'][self.key][0]['chunkRepair']['code'], 'original_not_found')

    def test_text_only_legacy_upload_has_no_bytes_to_recover(self):
        with self.factory() as session:
            value = json.loads(session.read())
            value['UPLOADS'][self.key][0].pop('originalId')
            self.assertTrue(session.write(json.dumps(value)))
        old = self.read()
        parser = Mock()
        self.assertEqual(repair.repair_legacy_uploads(self.factory, parser)['claimed'], 0)
        parser.assert_not_called()
        self.assertEqual(self.read(), old)

    def test_batch_claim_and_finish_use_two_transactions_for_multiple_files(self):
        with self.factory() as session:
            value = json.loads(session.read())
            second = dict(self.original, id='b' * 32)
            uploads.save_original(session.cursor, second, self.key, 'member')
            receipt = dict(value['UPLOADS'][self.key][0], originalId=second['id'])
            value['UPLOADS'][self.key].append(receipt)
            self.assertTrue(session.write(json.dumps(value)))
        transaction_count = 0
        @contextmanager
        def counted():
            nonlocal transaction_count
            transaction_count += 1
            with self.factory() as session:
                yield session
        result = repair.repair_legacy_uploads(counted, lambda name, data: (data.decode(), None))
        self.assertEqual(result['repaired'], 2)
        self.assertEqual(transaction_count, 2)

    def test_extraction_failure_keeps_old_chunks_visible_and_does_not_repeat(self):
        old = self.read()['KB_FILE_CHUNKS']
        parser = Mock(return_value=('', 'private parser diagnostics'))
        result = repair.repair_legacy_uploads(self.factory, parser)
        self.assertEqual(result['failed'], 1)
        saved = self.read()
        self.assertEqual(saved['KB_FILE_CHUNKS'], old)
        self.assertEqual(saved['UPLOADS'][self.key][0]['chunkRepair']['status'], 'failed')
        self.assertNotIn('private parser diagnostics', json.dumps(saved))
        repair.repair_legacy_uploads(self.factory, parser)
        parser.assert_called_once()
        self.assertEqual(repair.repair_legacy_uploads(self.factory, lambda name, data: (data.decode(), None),
                                                    retry_failed=True)['repaired'], 1)

    def test_bad_original_checksum_never_replaces_old_material(self):
        old = self.read()['KB_FILE_CHUNKS']
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute('UPDATE upload_originals SET sha256=%s', ('0' * 64,))
        parser = Mock()
        self.assertEqual(repair.repair_legacy_uploads(self.factory, parser)['failed'], 1)
        parser.assert_not_called()
        saved = self.read()
        self.assertEqual(saved['KB_FILE_CHUNKS'], old)
        self.assertEqual(saved['UPLOADS'][self.key][0]['chunkRepair']['code'], 'original_integrity_failed')

    def test_deleted_or_reset_during_extraction_is_not_resurrected(self):
        for change in ('delete', 'reset'):
            with self.subTest(change=change):
                self.seed()
                def parser(name, data):
                    with self.factory() as session:
                        current = json.loads(session.read())
                        if change == 'delete':
                            current['UPLOADS'][self.key] = []
                            current['KB_FILE_CHUNKS'][self.key] = []
                        else:
                            current['RESET_GEN'] = 'g2'
                        self.assertTrue(session.write(json.dumps(current)))
                    return data.decode(), None
                self.assertEqual(repair.repair_legacy_uploads(self.factory, parser)['skipped'], 1)
                saved = self.read()
                if change == 'delete':
                    self.assertEqual(saved['UPLOADS'][self.key], [])
                    self.assertEqual(saved['KB_FILE_CHUNKS'][self.key], [])
                else:
                    self.assertNotIn('目标28家', json.dumps(saved['KB_FILE_CHUNKS'], ensure_ascii=False))

    def test_expired_claim_is_retried_after_crash(self):
        candidates, waiting = repair._claim(self.factory, 4, 1000, False)
        self.assertEqual(len(candidates), 1)
        parser = Mock(side_effect=lambda name, data: (data.decode(), None))
        result = repair.repair_legacy_uploads(self.factory, parser, now_ms=1001)
        self.assertEqual(result['claimed'], 0); self.assertEqual(result['waiting'], 1)
        parser.assert_not_called()
        self.assertEqual(repair.repair_legacy_uploads(self.factory, parser, now_ms=1001 + repair.LEASE_MS)['repaired'], 1)

    def test_two_process_equivalent_workers_extract_only_once(self):
        entered = threading.Event(); release = threading.Event()
        def parser(name, data):
            entered.set()
            self.assertTrue(release.wait(3))
            return data.decode(), None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(repair.repair_legacy_uploads, self.factory, parser)
            self.assertTrue(entered.wait(3))
            second = repair.repair_legacy_uploads(self.factory, Mock())
            self.assertEqual(second['claimed'], 0)
            release.set()
            self.assertEqual(first.result(timeout=5)['repaired'], 1)

    def test_failed_completion_keeps_old_chunks_and_can_retry_expired_lease(self):
        old = self.read()['KB_FILE_CHUNKS']
        calls = 0
        @contextmanager
        def failing():
            nonlocal calls
            calls += 1
            with self.factory() as session:
                if calls == 2:
                    session.write = lambda _: False
                yield session
        with self.assertRaises(OSError):
            repair.repair_legacy_uploads(failing, lambda name, data: (data.decode(), None), now_ms=1000)
        self.assertEqual(self.read()['KB_FILE_CHUNKS'], old)
        self.assertEqual(repair.repair_legacy_uploads(self.factory, lambda name, data: (data.decode(), None),
                                                    now_ms=1001 + repair.LEASE_MS)['repaired'], 1)


if __name__ == '__main__':
    unittest.main()
