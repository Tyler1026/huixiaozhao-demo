import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from report_service.full_store import FullStore, Conflict

STAGES = ({'id': 'one', 'filename': 'one.md', 'parts': ('a', 'b')},
          {'id': 'two', 'filename': 'two.md', 'parts': ('a',)})


class Clock:
    def __init__(self): self.value = 1000.0
    def __call__(self): return self.value
    def advance(self, seconds): self.value += seconds


class FullStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.clock = Clock()
        self.db = Path(self.tmp.name) / 'jobs.db'
        self.store = FullStore(self.db, stages=STAGES, clock=self.clock, backoff=(1, 2), max_attempts=3)
        self.r = self.store.create('org-a', 'province', 'city', 'key', synthetic=True)

    def tearDown(self): self.tmp.cleanup()

    def test_idempotency_conflict_and_tenant_scope(self):
        self.assertFalse(self.store.create('org-a', 'province', 'city', 'key', True)['created'])
        with self.assertRaises(Conflict): self.store.create('org-a', 'province', 'other', 'key', True)
        self.assertIsNone(self.store.get('org-b', self.r['id']))
        self.assertNotEqual(self.store.create('org-b', 'province', 'city', 'key', True)['id'], self.r['id'])

    def test_deep_mode_survives_restart_and_cannot_change_on_retry(self):
        self.assertEqual(self.store.get('org-a', self.r['id'])['mode'], 'standard')
        with self.assertRaises(Conflict):
            self.store.create('org-a', 'province', 'city', 'key', True, mode='deep')
        with self.assertRaises(ValueError):
            self.store.create('org-a', 'province', 'city', 'invalid', True, mode='unknown')
        deep = self.store.create('org-a', 'province', 'deep-city', 'deep', True, mode='deep')
        reopened = FullStore(self.db, clock=self.clock)
        self.assertEqual(reopened.get('org-a', deep['id'])['mode'], 'deep')
        # Claim the earlier standard task before claiming the independent deep job.
        standard = reopened.claim()
        reopened.fail_part(standard['step_id'], standard['token'], 'configuration', False)
        self.assertEqual(reopened.claim()['mode'], 'deep')
        self.assertFalse(reopened.create('org-a', 'province', 'deep-city', 'deep', True, mode='deep')['created'])

    def test_full_deep_research_plan_is_frozen_with_five_batches_per_direction(self):
        path = Path(self.tmp.name) / 'deep-full.db'
        full = FullStore(path)
        deep = full.create('org-a', 'province', 'city', 'deep', False, mode='deep')
        self.assertEqual(deep['parts_total'], 83)
        self.assertEqual(full.create('org-a', 'province', 'city', 'standard', False)['parts_total'], 77)
        reopened = FullStore(path, stages=STAGES)
        claimed = reopened.claim(synthetic=False)
        self.assertEqual(claimed['mode'], 'deep')
        for direction in (1, 2, 3):
            stage = next(s for s in claimed['definition'] if s['id'] == f'enterprises_{direction}')
            self.assertEqual([p for p in stage['parts'] if p.startswith('扩产信号')],
                             ['扩产信号', '扩产信号2', '扩产信号3', '扩产信号4', '扩产信号5'])
        self.assertEqual(reopened.get('org-a', deep['id'])['parts_total'], 83)

    def test_pending_running_request_is_always_reclaimable_after_expiry(self):
        job = self.store.claim(ttl=2, timeout=5)
        self.assertIsNone(self.store.claim(ttl=2, timeout=5))
        self.clock.advance(3)
        self.assertIsNone(self.store.claim(ttl=2, timeout=5))  # persisted backoff
        self.clock.advance(1)
        recovered = self.store.claim(ttl=2, timeout=5)
        self.assertEqual(job['step_id'], recovered['step_id'])
        self.assertEqual(recovered['attempts'], 2)
        self.assertFalse(self.store.finish_part(job['step_id'], job['token'], {'text': 'late', 'metadata': {}}))

    def test_heartbeat_is_not_progress_and_cannot_extend_absolute_deadline(self):
        job = self.store.claim(ttl=2, timeout=3)
        start = self.store.get('org-a', self.r['id'])['progress_at']
        self.clock.advance(1)
        self.assertTrue(self.store.heartbeat(job['step_id'], job['token'], ttl=2))
        self.assertEqual(start, self.store.get('org-a', self.r['id'])['progress_at'])
        self.clock.advance(2.1)
        self.assertFalse(self.store.heartbeat(job['step_id'], job['token'], ttl=2))

    def test_restart_preserves_parts_and_attempt_budget(self):
        job = self.store.claim()
        self.assertTrue(self.store.finish_part(job['step_id'], job['token'], {'text': 'first', 'metadata': {'v': 1}}))
        reopened = FullStore(self.db, stages=STAGES, clock=self.clock, backoff=(1, 2))
        second = reopened.claim()
        self.assertEqual(second['part'], 'b')
        self.assertEqual(reopened.parts(self.r['id'])['one'][0]['text'], 'first')
        self.assertEqual(reopened.get('org-a', self.r['id'])['parts_done'], 1)

    def test_three_attempts_fail_explicitly_and_do_not_reset_after_restart(self):
        for n in range(3):
            job = self.store.claim()
            self.assertEqual(job['attempts'], n + 1)
            self.assertTrue(self.store.fail_part(job['step_id'], job['token'], 'timeout', retryable=True))
            self.clock.advance(3)
            self.store = FullStore(self.db, stages=STAGES, clock=self.clock, backoff=(1, 2))
        report = self.store.get('org-a', self.r['id'])
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(report['failure_code'], 'timeout')
        self.assertIsNone(self.store.claim())
        self.assertTrue(any(e['kind'] == 'failed' for e in report['events']))

    def test_permanent_error_does_not_block_next_report(self):
        job = self.store.claim()
        self.store.fail_part(job['step_id'], job['token'], 'configuration', retryable=False)
        r2 = self.store.create('org-a', 'province', 'other', 'second', True)
        self.assertEqual(self.store.claim()['report_id'], r2['id'])

    def test_part_budget_consumes_real_attempt_time_not_backoff(self):
        store = FullStore(self.db, stages=STAGES, clock=self.clock, task_budget=4, stage_budget=3, backoff=(1, 2))
        job = store.claim(ttl=10, timeout=10)
        self.assertEqual(job['deadline'] - self.clock(), 3)
        self.clock.advance(2)
        store.fail_part(job['step_id'], job['token'], 'upstream', retryable=True)
        self.clock.advance(100)
        next_job = store.claim(ttl=10, timeout=10)
        self.assertEqual(next_job['deadline'] - self.clock(), 1)

    def test_cannot_complete_without_all_parts_and_delivery_lease(self):
        job = self.store.claim()
        self.assertFalse(self.store.complete(job['step_id'], job['token'], {}))
        self.assertNotEqual(self.store.get('org-a', self.r['id'])['status'], 'completed')

    def test_research_parts_must_be_structured_and_nonempty(self):
        job = self.store.claim()
        with self.assertRaises(ValueError): self.store.finish_part(job['step_id'], job['token'], {'text': ' '})
        self.assertEqual(self.store.get('org-a', self.r['id'])['parts_done'], 0)

    def test_api_view_hides_worker_lease_and_internal_outputs(self):
        job = self.store.claim()
        public = json.dumps(self.store.get('org-a', self.r['id']))
        self.assertNotIn(job['token'], public)
        self.assertNotIn('idempotency_key', public)

    def _committed_repair_case(self, defect=None):
        """One valid prefix, an invalid part and its valid dependent output."""
        good = {'text': '保留的真实研究检查点', 'metadata': {'evidence': [
            {'url': 'https://stats.gov.cn/source', 'excerpt': '原文摘录'}]}}
        bad = defect or {'text': '需要重新检索的研究', 'metadata': {'evidence': [
            {'url': 'http://stats.gov.cn/source', 'excerpt': 'HTTP原文摘录'}]}}
        for output in (good, bad, good):
            job = self.store.claim()
            self.clock.advance(1)
            self.assertTrue(self.store.finish_part(job['step_id'], job['token'], output))
        bundle = self.store.claim()
        self.clock.advance(2)
        return bundle

    def _repair_snapshot(self):
        with self.store.db() as c:
            return {
                'report': dict(c.execute('SELECT * FROM full_reports WHERE id=?', (self.r['id'],)).fetchone()),
                'steps': [dict(row) for row in c.execute('SELECT * FROM full_steps WHERE report_id=? ORDER BY ordinal', (self.r['id'],)).fetchall()],
                'archive': [dict(row) for row in c.execute('SELECT * FROM full_checkpoint_archive WHERE report_id=? ORDER BY ordinal', (self.r['id'],)).fetchall()],
                'events': [dict(row) for row in c.execute('SELECT * FROM full_events WHERE report_id=? ORDER BY id', (self.r['id'],)).fetchall()],
            }

    def test_repair_archives_exact_committed_bytes_and_revokes_suffix(self):
        owned = self._committed_repair_case()
        before = self._repair_snapshot()
        self.assertTrue(self.store.repair_invalid_checkpoints(owned['step_id'], owned['token']))
        after = self._repair_snapshot()
        self.assertEqual(after['steps'][0], before['steps'][0])
        self.assertEqual(after['report']['progress_at'], before['report']['progress_at'])
        self.assertEqual(after['report']['definition'], before['report']['definition'])
        self.assertEqual(after['report']['status'], 'queued')
        self.assertEqual([row['ordinal'] for row in after['archive']], [1, 2])
        for archived, original in zip(after['archive'], before['steps'][1:3]):
            raw = original['output'].encode('utf-8')
            self.assertEqual(archived['output'].encode('utf-8'), raw)
            self.assertEqual(archived['output_sha256'], hashlib.sha256(raw).hexdigest())
            self.assertEqual(archived['attempts'], original['attempts'])
            self.assertEqual(archived['consumed'], original['consumed'])
        for reset, original in zip(after['steps'][1:], before['steps'][1:]):
            self.assertEqual(reset['status'], 'pending')
            self.assertEqual(reset['attempts'], original['attempts'])
            self.assertIsNone(reset['output'])
            self.assertIsNone(reset['token'])
            self.assertIsNone(reset['expires'])
            self.assertIsNone(reset['deadline'])
            self.assertIsNone(reset['started_at'])
            self.assertEqual(reset['next_at'], 0)
        self.assertEqual([s['consumed'] for s in after['steps']], [1, 1, 1, 2])
        self.assertFalse(self.store.repair_invalid_checkpoints(owned['step_id'], owned['token']))
        self.assertFalse(self.store.finish_part(owned['step_id'], owned['token'], {'text': 'stale', 'metadata': {}}))
        self.assertFalse(self.store.heartbeat(owned['step_id'], owned['token']))
        self.assertFalse(self.store.complete(owned['step_id'], owned['token'], {}))
        self.assertEqual(self._repair_snapshot(), after)
        replacement = self.store.claim()
        self.assertEqual(replacement['step_id'], before['steps'][1]['id'])
        self.assertEqual(replacement['attempts'], 2)
        self.assertNotEqual(replacement['token'], owned['token'])

    def test_repair_rechecks_empty_excerpts_and_unsafe_text_urls(self):
        defects = (
            {'text': '正文完整', 'metadata': {'evidence': [
                {'url': 'https://stats.gov.cn/source', 'excerpt': '   '}]}},
            {'text': '来源 http://stats.gov.cn/source', 'metadata': {}},
            {'text': '来源 https://127.0.0.1/source', 'metadata': {}},
            {'text': '来源 https://example.invalid/source', 'metadata': {}},
            {'text': '来源 https://press.cn/gov.cn/source', 'metadata': {}},
        )
        for index, defect in enumerate(defects):
            with self.subTest(index=index):
                original_store, original_report = self.store, self.r
                try:
                    self.store = FullStore(Path(self.tmp.name) / f'defect-{index}.db', stages=STAGES, clock=self.clock)
                    self.r = self.store.create('org-a', 'province', 'city', 'key', True)
                    owned = self._committed_repair_case(defect)
                    self.assertTrue(self.store.repair_invalid_checkpoints(owned['step_id'], owned['token']))
                    self.assertEqual(len(self._repair_snapshot()['archive']), 2)
                finally:
                    self.store, self.r = original_store, original_report

    def test_repair_ignores_partial_stage_line_and_source_floors(self):
        short = {'text': '只有一行，来源也仅一条', 'metadata': {'evidence': [
            {'url': 'https://stats.gov.cn/source', 'excerpt': '真实原文摘录'}]}}
        owned = self._committed_repair_case(short)
        before = self._repair_snapshot()
        self.assertFalse(self.store.repair_invalid_checkpoints(owned['step_id'], owned['token']))
        self.assertEqual(self._repair_snapshot(), before)

    def test_repair_rejects_other_tokens_and_expired_leases(self):
        owned = self._committed_repair_case()
        before = self._repair_snapshot()
        self.assertFalse(self.store.repair_invalid_checkpoints(owned['step_id'], 'wrong-token'))
        self.assertEqual(self._repair_snapshot(), before)
        self.clock.advance(121)
        expired = self._repair_snapshot()
        self.assertFalse(self.store.repair_invalid_checkpoints(owned['step_id'], owned['token']))
        self.assertEqual(self._repair_snapshot(), expired)

    def test_repair_cannot_revive_cancelled_completed_or_failed_reports(self):
        owned = self._committed_repair_case()
        for status in ('cancelled', 'completed', 'failed'):
            with self.subTest(status=status):
                # Keep the token deliberately live to exercise the independent
                # terminal-report guard as well as ordinary lease revocation.
                with self.store.db() as c:
                    c.execute('UPDATE full_reports SET status=? WHERE id=?', (status, self.r['id']))
                before = self._repair_snapshot()
                self.assertFalse(self.store.repair_invalid_checkpoints(owned['step_id'], owned['token']))
                self.assertEqual(self._repair_snapshot(), before)

    def test_repair_archive_and_suffix_reset_roll_back_together(self):
        owned = self._committed_repair_case()
        with self.store.db() as c:
            c.executescript('''CREATE TRIGGER reject_repair BEFORE UPDATE OF output ON full_steps
                WHEN OLD.output IS NOT NULL AND NEW.output IS NULL
                BEGIN SELECT RAISE(ABORT, 'isolated repair transaction failure'); END;''')
        before = self._repair_snapshot()
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.repair_invalid_checkpoints(owned['step_id'], owned['token'])
        self.assertEqual(self._repair_snapshot(), before)


if __name__ == '__main__': unittest.main()
