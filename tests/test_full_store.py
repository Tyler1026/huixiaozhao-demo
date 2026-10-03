import json
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


if __name__ == '__main__': unittest.main()
