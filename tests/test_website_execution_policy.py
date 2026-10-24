"""Offline real SQLite/website handoff tests; no provider or production data."""
import copy
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from backend.sync_transaction import file_session
from report_service.full_store import FullStore
from report_service.website_queue import (
    ENGINE, TENANT, WebsiteQueue, _execution_policy_view, fence_updates, report_id,
)


class LocalArtifactStore(FullStore):
    """SQLite queue fixture serving actual immutable files, never mock bytes."""
    def artifact(self, tenant, rid, name):
        from report_service.full_artifacts import read_artifact
        report = self.get(tenant, rid)
        if not report or report['status'] != 'completed':
            raise ValueError('report is not complete')
        return read_artifact(self.artifact_root, rid, name, report['manifest'])


class WebsitePolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root / 'website.json'
        self.now = 1000.
        self.store = LocalArtifactStore(self.root / 'queue.sqlite', clock=lambda: self.now,
                                        stages=({'id': 'one', 'filename': 'one.md', 'parts': ('a', 'b')},))
        self.queue = WebsiteQueue(self.store, lambda: file_session(str(self.path), lambda: None))
        self.request = dict(id='rrpolicy', city='离线市', province='离线省', status='pending', ts=1)
        self.write({'REPORT_REQUESTS': [self.request]})
        self.queue.ingest()
        self.rid = report_id(self.request['id'])

    def read(self): return json.loads(self.path.read_text())
    def write(self, state): self.path.write_text(json.dumps(state, ensure_ascii=False))
    def row(self): return self.read()['REPORT_REQUESTS'][0]
    def control(self, method, key, **extra):
        return getattr(self.store, method + '_report')(
            TENANT, self.rid, expected_version=self.store.policy_status(TENANT, self.rid)['policy_projection']['version'],
            idempotency_key=key, actor='private-operator', reason='private-audit-reason', **extra)

    def test_inflight_pause_mirrors_and_continue_preserves_checkpoint_and_usage(self):
        job = self.store.claim(timeout=300)
        self.now += 7
        self.control('pause', 'pause')
        self.queue.mirror()
        row = self.row()
        self.assertEqual((row['status'], row['retryAt']), ('pause_requested', None))
        self.assertNotIn('private-', json.dumps(row))
        self.assertTrue(self.store.finish_part(job['step_id'], job['token'], {'text': 'OFFLINE retained part', 'metadata': {}}))
        self.queue.mirror()
        paused = self.row()
        self.assertEqual(paused['status'], 'paused')
        self.assertEqual(paused['executionPolicy']['usage']['work_seconds'], 7)
        self.assertIsNone(self.store.claim())
        self.control('continue', 'resume')
        self.queue.mirror()
        resumed = self.row()
        self.assertEqual(resumed['status'], 'running')
        self.assertGreater(resumed['executionPolicy']['version'], paused['executionPolicy']['version'])
        self.assertEqual(resumed['executionPolicy']['usage']['attempts_total'], 1)
        self.assertEqual(self.store.parts(self.rid)['one'][0]['text'], 'OFFLINE retained part')
        self.assertEqual(self.store.claim()['part'], 'b')

    def test_stale_website_running_cannot_start_second_city_job(self):
        self.control('pause', 'pause')
        self.assertEqual(self.row()['status'], 'running')  # intentional mirror lag
        state = self.read()
        state['REPORT_REQUESTS'].append(dict(self.request, id='rrsecond'))
        self.write(state)
        self.queue.ingest()
        self.assertIsNone(self.store.policy_status(TENANT, report_id('rrsecond')))
        self.assertEqual(self.read()['REPORT_REQUESTS'][1]['step'], '同城已有暂停报告，请先处理原任务')
        self.assertIsNone(self.store.claim())

    def test_pause_between_authoritative_read_and_create_is_atomically_held(self):
        state = self.read()
        state['REPORT_REQUESTS'].append(dict(self.request, id='rrracing'))
        self.write(state)
        read_status = self.store.policy_status
        paused = []
        def pause_after_read(tenant, rid):
            result = read_status(tenant, rid)
            if rid == self.rid and not paused:
                paused.append(True)
                self.store.pause_report(TENANT, rid,
                    expected_version=result['policy_projection']['version'], idempotency_key='race',
                    actor='fixture', reason='fixture')
            return result
        self.store.policy_status = pause_after_read
        self.queue.ingest()
        self.assertIsNone(read_status(TENANT, report_id('rrracing')))
        self.assertIsNone(self.store.claim())
        self.assertEqual(self.read()['REPORT_REQUESTS'][1]['status'], 'pending')

    def test_fence_retains_server_pause_and_rejects_duplicate_while_cancel_is_allowed(self):
        self.control('pause', 'pause'); self.queue.mirror()
        state = self.read()
        stale = dict(self.row(), status='running', executionPolicy={'state': 'active', 'version': 999})
        result = json.loads(fence_updates(json.dumps({'REPORT_REQUESTS': [stale]}), state))['REPORT_REQUESTS'][0]
        self.assertEqual(result, self.row())
        with self.assertRaises(ValueError):
            fence_updates(json.dumps({'REPORT_REQUESTS': [dict(self.request, id='rrnew')]}), state)
        cancelled = json.loads(fence_updates(json.dumps({'REPORT_REQUESTS': [dict(self.row(), status='cancelled')]}), state))['REPORT_REQUESTS'][0]
        self.assertEqual(cancelled['status'], 'cancelled')
        state['REPORT_REQUESTS'] = [cancelled]; self.write(state); self.queue.ingest()
        self.assertEqual(self.store.policy_status(TENANT, self.rid)['status'], 'cancelled')

    def test_terminal_delivery_cannot_be_cancelled_by_stale_page(self):
        done = dict(self.row(), status='done', engineStatus='completed', files=[{'kind': 'full'}])
        result = json.loads(fence_updates(json.dumps({'REPORT_REQUESTS': [dict(done, status='cancelled')]}), {'REPORT_REQUESTS': [done]}))
        self.assertEqual(result['REPORT_REQUESTS'][0], done)

    def _offline_bundle(self):
        from report_service.full_artifacts import REQUIRED_FILES, build_bundle
        self.store.artifact_root = self.root.resolve() / 'bundles'
        for _ in range(2):
            part = self.store.claim(synthetic=False)
            self.assertTrue(self.store.finish_part(part['step_id'], part['token'],
                                                  {'text': 'OFFLINE retained checkpoint', 'metadata': {}}))
        job = self.store.claim(synthetic=False)
        self.assertEqual(job['stage'], '__bundle__')
        outputs = {name: {'text': '# OFFLINE review\nLocal artifact fixture only', 'metadata': {}}
                   for name in REQUIRED_FILES}
        manifest = build_bundle(self.store.artifact_root, self.rid, self.request['city'], outputs, False)
        return job, manifest

    def test_native_completion_before_stale_cancel_keeps_both_downloads(self):
        job, manifest = self._offline_bundle()
        self.assertTrue(self.store.complete(job['step_id'], job['token'], manifest))
        before = self.store.policy_status(TENANT, self.rid)
        state = self.read()
        self.assertEqual(state['REPORT_REQUESTS'][0]['status'], 'running')
        incoming = {'REPORT_REQUESTS': [dict(state['REPORT_REQUESTS'][0], status='cancelled')]}
        self.write(json.loads(fence_updates(json.dumps(incoming), state)))
        self.queue.ingest()
        self.assertEqual(self.store.policy_status(TENANT, self.rid)['status'], 'completed')
        self.queue.mirror()
        delivered = self.row()
        self.assertEqual(delivered['status'], 'done')
        files = {entry['kind']: entry for entry in delivered['files']}
        for kind, original in (('full', 'full.docx'), ('short', 'compact.docx')):
            self.assertIn(kind, files)
            data = base64.b64decode(files[kind]['b64'], validate=True)
            self.assertEqual(data, self.store.artifact(TENANT, self.rid, original))
            self.assertEqual(hashlib.sha256(data).hexdigest(), files[kind]['sha256'])
        self.assertEqual(self.store.policy_status(TENANT, self.rid), before)

    def test_native_cancel_wins_before_bundle_completion_and_never_revives(self):
        job, manifest = self._offline_bundle()
        state = self.read()
        incoming = {'REPORT_REQUESTS': [dict(state['REPORT_REQUESTS'][0], status='cancelled')]}
        self.write(json.loads(fence_updates(json.dumps(incoming), state)))
        self.queue.ingest()
        self.assertEqual(self.store.policy_status(TENANT, self.rid)['status'], 'cancelled')
        self.assertFalse(self.store.complete(job['step_id'], job['token'], manifest))
        self.queue.mirror()
        self.assertEqual(self.row()['status'], 'cancelled')
        self.assertNotIn('files', self.row())

    def test_public_projection_is_finite_allowlist_and_terminal_wins(self):
        projection = self.store.policy_status(TENANT, self.rid)['policy_projection']
        projection.update(actor='secret', reason='secret', pause_reason='arbitrary-secret', state='pause_requested')
        projection['usage'].update(work_seconds=float('nan'), attempts_total=True, internal='secret')
        value = _execution_policy_view({'status': 'completed', 'policy_projection': projection})
        self.assertEqual(value['state'], 'completed')
        self.assertIsNone(value['pause_reason'])
        self.assertNotIn('secret', json.dumps(value))
        self.assertNotIn('work_seconds', value['usage'])
        self.assertNotIn('attempts_total', value['usage'])
        for policy in ({'policy_version': None}, {'policy_version': 'standard-live-v1', 'version': True}):
            self.assertIsNone(_execution_policy_view({'policy_projection': policy}))

    def test_legacy_snapshot_does_not_gain_policy_on_mirror(self):
        with self.store.db() as conn:
            conn.execute('DELETE FROM full_execution_policies WHERE report_id=?', (self.rid,))
        self.queue.mirror()
        self.assertNotIn('executionPolicy', self.row())


if __name__ == '__main__': unittest.main()
