import concurrent.futures
import json
import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path

from report_service.full_store import Conflict, FullStore, SCHEMA
from report_service import full_execution_policy as policy


STAGES = ({'id': 'one', 'filename': 'one.md', 'parts': ('a', 'b')},
          {'id': 'two', 'filename': 'two.md', 'parts': ('c',)})
OUTPUT = {'text': 'retained real checkpoint', 'metadata': {}}


class Clock:
    def __init__(self): self.now = 1000.
    def __call__(self): return self.now
    def advance(self, value): self.now += value


class ExecutionPolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'queue.sqlite'
        self.clock = Clock()
        self.store = FullStore(self.path, stages=STAGES, clock=self.clock, backoff=(0,))
        self.report = self.store.create('t', 'p', 'c', 'new', False)
        self.rid = self.report['id']

    def tearDown(self): self.tmp.cleanup()

    def status(self): return self.store.policy_status('t', self.rid)

    def control(self, action, key, **kwargs):
        return getattr(self.store, action + '_report')(
            't', self.rid, expected_version=self.status()['policy_projection']['version'],
            idempotency_key=key, actor='operator', reason='reviewed', **kwargs)

    def fail_attempt(self, code='upstream', **kwargs):
        job = self.store.claim(**kwargs)
        self.assertIsNotNone(job)
        self.clock.advance(1)
        self.assertTrue(self.store.fail_part(job['step_id'], job['token'], code))
        return job

    def test_snapshot_applies_only_new_standard_live(self):
        p = self.status()['policy_projection']
        self.assertEqual(p['policy_version'], 'standard-live-v1')
        self.assertEqual(p['limits'], policy.DEFAULT_LIMITS)
        self.assertFalse(p['money_hard_limit'] or p['token_hard_limit'] or p['search_hard_limit'])
        for key, synthetic, mode in [('s', True, 'standard'), ('d', False, 'deep')]:
            result = self.store.create('t', 'p', 'c', key, synthetic, mode=mode)
            self.assertEqual(result['policy_projection']['state'], 'legacy')
            self.assertEqual(result['policy_projection']['applicability'], 'not_applied')

    def test_schema_only_creates_does_not_backfill(self):
        with self.store.db() as c:
            c.execute('DELETE FROM full_execution_policies WHERE report_id=?', (self.rid,))
        reopened = FullStore(self.path, stages=STAGES, clock=self.clock)
        self.assertEqual(reopened.create('t', 'p', 'c', 'new', False)['policy_projection']['state'], 'legacy')
        with self.assertRaises(Conflict):
            self.store.pause_report('t', self.rid, expected_version=1, idempotency_key='old', actor='a', reason='r')
        self.assertNotIn('ALTER TABLE', SCHEMA)

    def test_persisted_policy_independent_of_runtime_limits(self):
        reopened = FullStore(self.path, stages=STAGES, clock=self.clock, max_attempts=1, task_budget=1, stage_budget=1, backoff=(0,))
        job = reopened.claim(timeout=999)
        self.assertEqual(job['deadline'] - self.clock(), 300)
        self.clock.advance(2)
        self.assertTrue(reopened.fail_part(job['step_id'], job['token'], 'timeout'))
        self.assertEqual(reopened.claim()['attempts'], 2)

    def test_read_only_status_does_not_recover_any_report(self):
        first = self.store.claim(ttl=1)
        self.clock.advance(2)
        before = self.status()
        self.assertEqual(before['status'], 'running')
        self.assertEqual(before['policy_projection']['usage']['work_seconds'], 2)
        self.assertEqual(self.status(), before)
        self.assertIsNone(self.store.policy_status('other', self.rid))
        with self.store.db() as c:
            self.assertEqual(c.execute('SELECT status FROM full_steps WHERE id=?', (first['step_id'],)).fetchone()[0], 'running')
            self.assertEqual(c.execute('SELECT consumed FROM full_steps WHERE id=?', (first['step_id'],)).fetchone()[0], 0)

    def test_pending_manual_pause_blocks_claim_and_zero_grant_continues(self):
        p = self.control('pause', 'p')
        self.assertEqual(p['status'], 'paused')
        self.assertIsNone(self.store.claim())
        c = self.control('continue', 'c')
        self.assertEqual(c['status'], 'queued')
        self.assertIsNotNone(self.store.claim())

    def test_inflight_pause_allows_checkpoint_but_not_next_claim(self):
        job = self.store.claim()
        self.clock.advance(4)
        result = self.control('pause', 'p')
        self.assertEqual(result['status'], 'pause_requested')
        self.assertTrue(self.store.heartbeat(job['step_id'], job['token']))
        with self.assertRaises(Conflict): self.control('continue', 'too-soon')
        self.assertTrue(self.store.finish_part(job['step_id'], job['token'], OUTPUT))
        self.assertEqual(self.status()['status'], 'paused')
        self.assertIsNone(self.store.claim())
        self.assertEqual(self.store.parts(self.rid)['one'], [OUTPUT])
        self.assertEqual(self.status()['policy_projection']['usage']['work_seconds'], 4)
        self.control('continue', 'resume')
        self.assertEqual(self.store.claim()['part'], 'b')

    def test_inflight_failure_honors_pause_and_settles_once(self):
        job = self.store.claim()
        self.control('pause', 'p')
        self.clock.advance(5)
        self.assertTrue(self.store.fail_part(job['step_id'], job['token'], 'upstream'))
        self.assertEqual(self.status()['status'], 'paused')
        self.assertFalse(self.store.fail_part(job['step_id'], job['token'], 'upstream'))
        self.assertEqual(self.status()['policy_projection']['usage']['work_seconds'], 5)

    def test_crash_recovery_preserves_pause_and_fences_stale_worker(self):
        job = self.store.claim(ttl=2, timeout=30)
        self.control('pause', 'p')
        self.clock.advance(3)
        reopened = FullStore(self.path, stages=STAGES, clock=self.clock, backoff=(0,))
        self.assertEqual(reopened.get('t', self.rid)['status'], 'paused')
        self.assertFalse(reopened.finish_part(job['step_id'], job['token'], OUTPUT))
        self.assertEqual(reopened.get('t', self.rid)['policy_projection']['usage']['work_seconds'], 3)
        self.assertEqual(reopened.get('t', self.rid)['policy_projection']['usage']['work_seconds'], 3)

    def test_deadline_recovery_caps_elapsed(self):
        job = self.store.claim(ttl=1000, timeout=1000)
        self.clock.advance(500)
        self.assertFalse(self.store.finish_part(job['step_id'], job['token'], OUTPUT))
        result = self.store.get('t', self.rid)
        self.assertEqual(result['policy_projection']['usage']['work_seconds'], 300)
        self.assertEqual(result['current']['failure_code'], 'timeout')

    def test_cancel_settles_once_and_cannot_revive(self):
        job = self.store.claim()
        self.clock.advance(7)
        self.assertTrue(self.store.cancel('t', self.rid))
        self.assertFalse(self.store.cancel('t', self.rid))
        self.assertFalse(self.store.finish_part(job['step_id'], job['token'], OUTPUT))
        self.assertEqual(self.status()['policy_projection']['usage']['work_seconds'], 7)
        self.assertFalse(self.status()['policy_projection']['can_continue'])
        with self.assertRaises(Conflict): self.control('continue', 'cancelled')

    def test_legacy_cancel_keeps_original_accounting_behavior(self):
        self.store.cancel('t', self.rid)
        legacy = self.store.create('t', 'p', 'c', 'legacy', True)
        job = self.store.claim()
        self.clock.advance(7)
        self.assertTrue(self.store.cancel('t', legacy['id']))
        with self.store.db() as c:
            self.assertEqual(c.execute('SELECT consumed FROM full_steps WHERE id=?', (job['step_id'],)).fetchone()[0], 0)

    def test_quality_twice_pauses_coarse_and_ack_keeps_total(self):
        self.fail_attempt('quality'); self.fail_attempt('quality')
        p = self.status()['policy_projection']
        self.assertEqual((p['state'], p['pause_reason']), ('paused', 'quality_repeated'))
        self.assertEqual((p['usage']['quality_failures'], p['usage']['quality_since_ack']), (2, 2))
        self.assertIsNone(self.store.claim())
        self.control('continue', 'ack')
        p = self.status()['policy_projection']
        self.assertEqual((p['usage']['quality_failures'], p['usage']['quality_since_ack']), (2, 0))
        self.assertEqual(self.store.claim()['attempts'], 3)

    def test_other_failure_breaks_consecutive_quality_window_without_erasing_total(self):
        self.fail_attempt('quality'); self.fail_attempt('upstream'); self.fail_attempt('quality')
        p = self.status()['policy_projection']
        self.assertEqual(p['pause_reason'], 'step_attempts_exhausted')
        self.assertEqual((p['usage']['quality_failures'], p['usage']['quality_since_ack']), (2, 1))

    def test_attempt_cap_requires_finite_grant_preserves_attempts(self):
        for _ in range(3): self.fail_attempt()
        self.assertEqual(self.status()['policy_projection']['pause_reason'], 'step_attempts_exhausted')
        with self.assertRaises(Conflict): self.control('continue', 'no-allowance')
        self.control('continue', 'grant', grant={'extra_attempts': 1})
        self.assertEqual(self.store.claim()['attempts'], 4)

    def test_permanent_failure_pauses_and_explicit_resume_only(self):
        job = self.store.claim()
        self.assertTrue(self.store.fail_part(job['step_id'], job['token'], 'configuration', False))
        self.assertEqual(self.status()['policy_projection']['pause_reason'], 'configuration')
        self.assertFalse(self.store.resume_configuration('t', self.rid))
        self.control('continue', 'operator-fix')
        self.assertIsNotNone(self.store.claim())

    def test_control_idempotency_exact_original_response_and_conflicts(self):
        args = dict(expected_version=1, idempotency_key='same', actor='a', reason='r')
        original = self.store.pause_report('t', self.rid, **args)
        self.control('continue', 'resume')
        self.assertEqual(self.store.pause_report('t', self.rid, **args), original)
        with self.assertRaises(Conflict): self.store.pause_report('t', self.rid, **dict(args, reason='other'))
        with self.assertRaises(Conflict): self.store.pause_report('t', self.rid, **dict(args, idempotency_key='stale'))
        with self.store.db() as c:
            rows = c.execute('SELECT request_json FROM full_execution_actions WHERE report_id=?', (self.rid,)).fetchall()
        self.assertEqual(len(rows), 2)
        self.assertTrue(any(json.loads(row[0])['actor'] == 'a' for row in rows))

    def test_tenant_control_isolation(self):
        with self.assertRaises(Conflict):
            self.store.pause_report('other', self.rid, expected_version=1, idempotency_key='x', actor='a', reason='r')
        self.assertEqual(self.status()['policy_projection']['version'], 1)

    def test_invalid_finite_grants_rejected(self):
        self.control('pause', 'p')
        for grant in ({'extra_attempts': True}, {'extra_attempts': 1.5}, {'extra_retries': 25},
                      {'extra_wall_seconds': float('inf')}, {'extra_task_seconds': float('nan')},
                      {'extra_stage_seconds': -1}, {'arbitrary': 1}, {'extra_attempts': 4}):
            with self.subTest(grant=grant), self.assertRaises(ValueError): self.control('continue', 'invalid', grant=grant)
        self.assertEqual(self.status()['policy_projection']['state'], 'paused')

    def test_work_deadline_clips_and_backoff_not_work(self):
        with self.store.db() as c:
            c.execute('UPDATE full_steps SET consumed=3599 WHERE report_id=? AND ordinal=0', (self.rid,))
        job = self.store.claim(timeout=300)
        self.assertEqual(job['deadline'] - self.clock(), 1)
        self.clock.advance(2)
        p = self.store.get('t', self.rid)['policy_projection']
        self.assertEqual(p['pause_reason'], 'stage_work_exhausted')
        self.assertEqual(p['usage']['work_seconds'], 3600)
        self.clock.advance(100)
        self.assertEqual(self.status()['policy_projection']['usage']['work_seconds'], 3600)
        self.control('continue', 'stage-grant', grant={'extra_stage_seconds': 10})
        self.assertEqual(self.store.claim(timeout=300)['deadline'] - self.clock(), 10)

    def test_task_and_wall_budgets_are_independent(self):
        with self.store.db() as c:
            c.execute('UPDATE full_steps SET consumed=14400 WHERE report_id=? AND ordinal=2', (self.rid,))
        self.assertIsNone(self.store.claim())
        self.assertEqual(self.status()['policy_projection']['pause_reason'], 'task_work_exhausted')
        self.control('continue', 'task', grant={'extra_task_seconds': 1})
        self.assertEqual(self.store.claim()['deadline'] - self.clock(), 1)

    def test_idle_wall_expiry_and_insufficient_grant_remains_paused(self):
        self.clock.advance(200000)
        self.assertIsNone(self.store.claim())
        self.assertEqual(self.status()['policy_projection']['pause_reason'], 'wall_time_exhausted')
        result = self.control('continue', 'small', grant={'extra_wall_seconds': 1})
        self.assertEqual(result['status'], 'paused')
        self.assertEqual(result['policy_projection']['limits']['wall_seconds'], 86401)
        self.assertIsNone(self.store.claim())

    def test_wall_remaining_clips_current_deadline(self):
        self.clock.advance(86399)
        job = self.store.claim(timeout=300)
        self.assertEqual(job['deadline'] - self.clock(), 1)

    def test_bundle_retry_is_in_global_sum_and_cap_blocks_only_retries(self):
        many = FullStore(Path(self.tmp.name) / 'many.db', clock=self.clock, backoff=(0,),
                         stages=({'id': 'many', 'filename': 'm.md', 'parts': tuple(str(i) for i in range(24))},))
        rid = many.create('t', 'p', 'c', 'many', False)['id']
        for _ in range(24):
            job = many.claim(); self.assertTrue(many.fail_part(job['step_id'], job['token'], 'upstream'))
            retry = many.claim(); self.assertEqual(retry['attempts'], 2)
            self.assertTrue(many.finish_part(retry['step_id'], retry['token'], OUTPUT))
        bundle = many.claim()
        self.assertEqual(bundle['stage'], '__bundle__')
        self.assertTrue(many.fail_part(bundle['step_id'], bundle['token'], 'artifact'))
        self.assertIsNone(many.claim())
        p = many.policy_status('t', rid)['policy_projection']
        self.assertEqual(p['usage']['retries'], 24)
        self.assertEqual(p['pause_reason'], 'report_retries_exhausted')

    def test_concurrent_claims_have_single_owner(self):
        barrier = threading.Barrier(2)
        def claim():
            store = FullStore(self.path, clock=self.clock, stages=STAGES)
            barrier.wait()
            return store.claim()
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda _: claim(), range(2)))
        self.assertEqual(sum(r is not None for r in results), 1)
        self.assertEqual(self.status()['policy_projection']['usage']['attempts_total'], 1)

    def test_concurrent_same_version_actions_only_one_commits(self):
        barrier = threading.Barrier(2)
        def pause(index):
            store = FullStore(self.path, clock=self.clock, stages=STAGES)
            barrier.wait()
            try:
                store.pause_report('t', self.rid, expected_version=1, idempotency_key=str(index), actor='a', reason='r')
                return True
            except Conflict:
                return False
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            self.assertEqual(sum(pool.map(pause, range(2))), 1)

    def test_real_wall_clock_settlement_is_positive_and_not_double_counted(self):
        actual = FullStore(Path(self.tmp.name) / 'actual.db', stages=STAGES, backoff=(0,))
        rid = actual.create('t', 'p', 'c', 'actual', False)['id']
        job = actual.claim()
        time.sleep(.02)
        self.assertTrue(actual.fail_part(job['step_id'], job['token'], 'upstream'))
        first = actual.policy_status('t', rid)['policy_projection']['usage']['work_seconds']
        time.sleep(.01)
        second = actual.policy_status('t', rid)['policy_projection']['usage']['work_seconds']
        self.assertGreater(first, .01)
        self.assertEqual(first, second)

    def test_terminal_completed_cannot_resume_or_pause(self):
        with self.store.db() as c:
            c.execute("UPDATE full_reports SET status='completed' WHERE id=?", (self.rid,))
        with self.assertRaises(Conflict): self.control('pause', 'p')
        with self.assertRaises(Conflict): self.control('continue', 'c')
        self.assertFalse(self.status()['policy_projection']['can_pause'])

    def test_valid_bundle_can_finish_after_pause_request_without_revival(self):
        from report_service.full_artifacts import REQUIRED_FILES, build_bundle
        self.store.artifact_root = Path(self.tmp.name).resolve() / 'bundles'
        for _ in range(3):
            job = self.store.claim()
            self.assertTrue(self.store.finish_part(job['step_id'], job['token'], OUTPUT))
        job = self.store.claim()
        self.assertEqual(job['stage'], '__bundle__')
        self.control('pause', 'bundle-pause')
        outputs = {name: {'text': '# Local test\nArtifact validation only', 'metadata': {}}
                   for name in REQUIRED_FILES}
        manifest = build_bundle(self.store.artifact_root, self.rid, 'c', outputs, False)
        self.clock.advance(2)
        self.assertTrue(self.store.complete(job['step_id'], job['token'], manifest))
        self.assertEqual(self.status()['status'], 'completed')
        self.assertEqual(self.status()['policy_projection']['usage']['work_seconds'], 2)
        self.assertFalse(self.status()['policy_projection']['can_continue'])
        self.assertIsNone(self.store.claim())
        with self.assertRaises(Conflict): self.control('continue', 'never-revive')

    def test_step_grant_does_not_apply_to_next_part(self):
        for _ in range(3): self.fail_attempt()
        self.control('continue', 'grant-one-step', grant={'extra_attempts': 1})
        job = self.store.claim()
        self.assertTrue(self.store.finish_part(job['step_id'], job['token'], OUTPUT))
        self.assertEqual(self.status()['policy_projection']['limits']['step_max_attempts'], 3)

    def test_pause_and_checkpoint_race_cannot_lose_pause_intent(self):
        job = self.store.claim()
        barrier = threading.Barrier(2)
        def pause():
            barrier.wait()
            return self.store.pause_report('t', self.rid, expected_version=1,
                                          idempotency_key='race', actor='a', reason='r')
        def finish():
            barrier.wait()
            return self.store.finish_part(job['step_id'], job['token'], OUTPUT)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            a, b = pool.submit(pause), pool.submit(finish)
            a.result(); self.assertTrue(b.result())
        self.assertEqual(self.status()['status'], 'paused')
        self.assertIsNone(self.store.claim())

    def test_quality_audit_and_grants_survive_restart(self):
        self.fail_attempt('quality'); self.fail_attempt('quality')
        result = self.control('continue', 'review-quality', grant={'extra_retries': 2})
        self.store = FullStore(self.path, stages=STAGES, clock=self.clock)
        self.assertEqual(self.status(), result)
        with self.store.db() as c:
            quality = json.loads(c.execute('SELECT quality_json FROM full_execution_policies WHERE report_id=?', (self.rid,)).fetchone()[0])
            self.assertEqual(next(iter(quality.values())), {'total': 2, 'ack': 2})
            action = json.loads(c.execute('SELECT request_json FROM full_execution_actions WHERE report_id=?', (self.rid,)).fetchone()[0])
            self.assertEqual(action['reason'], 'reviewed')
            self.assertEqual(action['grant']['extra_retries'], 2)

    def test_failed_action_audit_insert_rolls_back_policy_and_state(self):
        with self.store.db() as c:
            c.execute("""CREATE TRIGGER fail_action BEFORE INSERT ON full_execution_actions
                BEGIN SELECT RAISE(ABORT, 'local fault injection'); END""")
        with self.assertRaises(sqlite3.IntegrityError): self.control('pause', 'rollback')
        self.assertEqual(self.status()['status'], 'queued')
        self.assertEqual(self.status()['policy_projection']['version'], 1)
        with self.store.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM full_execution_actions').fetchone()[0], 0)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM full_events').fetchone()[0], 1)
            c.execute('DROP TRIGGER fail_action')
        self.assertEqual(self.control('pause', 'rollback')['status'], 'paused')

    def test_checkpoint_transaction_fault_does_not_double_settle(self):
        job = self.store.claim()
        self.clock.advance(2)
        with self.store.db() as c:
            c.execute("""CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON full_reports
                WHEN NEW.status='queued' BEGIN SELECT RAISE(ABORT, 'local fault injection'); END""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.finish_part(job['step_id'], job['token'], OUTPUT)
        with self.store.db() as c:
            row = c.execute('SELECT status,consumed,output FROM full_steps WHERE id=?', (job['step_id'],)).fetchone()
            self.assertEqual(tuple(row), ('running', 0, None))
            c.execute('DROP TRIGGER fail_checkpoint')
        self.assertTrue(self.store.finish_part(job['step_id'], job['token'], OUTPUT))
        self.assertEqual(self.status()['policy_projection']['usage']['work_seconds'], 2)

    def test_city_hold_blocks_new_standard_but_preserves_same_key_idempotency(self):
        self.control('pause', 'hold')
        with self.assertRaises(Conflict): self.store.create('t', 'p', 'c', 'second', False)
        self.assertFalse(self.store.create('t', 'p', 'c', 'new', False)['created'])
        self.assertEqual(self.store.policy_status('t', self.rid)['status'], 'paused')
        with self.store.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM full_reports').fetchone()[0], 1)

    def test_city_hold_does_not_change_synthetic_deep_or_other_scopes(self):
        self.control('pause', 'hold')
        cases = [('t', 'p', 'c', 'synthetic', True, 'standard'),
                 ('t', 'p', 'c', 'deep', False, 'deep'),
                 ('other', 'p', 'c', 'tenant', False, 'standard'),
                 ('t', 'other', 'c', 'province', False, 'standard'),
                 ('t', 'p', 'other', 'city', False, 'standard')]
        ids = set()
        for tenant, province, city, key, synthetic, mode in cases:
            ids.add(self.store.create(tenant, province, city, key, synthetic, mode=mode)['id'])
        for _ in cases:
            job = self.store.claim()
            self.assertIn(job['report_id'], ids)
            ids.remove(job['report_id'])
            self.store.cancel(job['tenant'], job['report_id'])
        self.assertEqual(ids, set())

    def test_city_hold_blocks_preexisting_queued_v1_without_spending_attempt(self):
        second = self.store.create('t', 'p', 'c', 'second', False)
        self.control('pause', 'hold')
        self.assertIsNone(self.store.claim())
        self.assertEqual(self.store.policy_status('t', second['id'])['policy_projection']['usage']['attempts_total'], 0)
        self.assertEqual(self.store.policy_status('t', second['id'])['status'], 'queued')
        self.store.cancel('t', self.rid)
        self.assertEqual(self.store.claim()['report_id'], second['id'])

    def test_pause_requested_blocks_create_and_preexisting_queued(self):
        active = self.store.claim()
        second = self.store.create('t', 'p', 'c', 'second', False)
        self.assertEqual(self.control('pause', 'hold')['status'], 'pause_requested')
        with self.assertRaises(Conflict): self.store.create('t', 'p', 'c', 'third', False)
        self.assertIsNone(self.store.claim())
        self.assertTrue(self.store.finish_part(active['step_id'], active['token'], OUTPUT))
        self.assertIsNone(self.store.claim())
        self.assertEqual(self.store.policy_status('t', second['id'])['policy_projection']['usage']['attempts_total'], 0)

    def test_concurrent_pause_and_create_linearize_and_never_claim_second_after_hold(self):
        barrier = threading.Barrier(2)
        def pause():
            other = FullStore(self.path, stages=STAGES, clock=self.clock)
            barrier.wait()
            other.pause_report('t', self.rid, expected_version=1, idempotency_key='race-hold', actor='a', reason='r')
        def create():
            other = FullStore(self.path, stages=STAGES, clock=self.clock)
            barrier.wait()
            try:
                return other.create('t', 'p', 'c', 'racing-second', False)
            except Conflict:
                return None
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            pausing, creating = pool.submit(pause), pool.submit(create)
            pausing.result(); second = creating.result()
        self.assertIsNone(self.store.claim())
        if second is not None:
            self.assertEqual(self.store.policy_status('t', second['id'])['policy_projection']['usage']['attempts_total'], 0)

    def test_continued_report_does_not_block_itself(self):
        self.control('pause', 'p')
        self.control('continue', 'c')
        self.assertEqual(self.store.claim()['report_id'], self.rid)


if __name__ == '__main__':
    unittest.main()
