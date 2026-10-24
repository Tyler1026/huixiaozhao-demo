"""Operator CLI exercises the real SQLite state machine without live services."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from report_service import hosted
from report_service.full_store import FullStore
from report_service.website_queue import ENGINE, TENANT, report_id


class Clock:
    def __init__(self): self.now = 1000.0
    def __call__(self): return self.now


class ExecutionPolicyCLITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.clock = Clock()
        self.path = Path(self.tmp.name) / 'operator.db'
        self.store = FullStore(self.path, clock=self.clock, backoff=(0,),
                               stages=[{'id': 'one', 'filename': 'one.md', 'parts': ['a', 'b']}])
        self.request = 'rrOfflinePolicyCli'
        self.rid = report_id(self.request)
        self.store.create(TENANT, '测试省', '测试市', self.request, synthetic=False)

    def tearDown(self): self.tmp.cleanup()

    def run_cli(self, arguments, *, env=None, store=None):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.dict('os.environ', {'DATABASE_URL': 'offline-secret-dsn'} if env is None else env, clear=True), \
             patch('report_service.full_postgres.PostgresFullStore', return_value=store or self.store) as constructor, \
             patch('report_service.full_provider.FullLiveProvider.from_env', side_effect=AssertionError('provider must not run')), \
             contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = hosted.main(arguments)
        output = stdout.getvalue()
        self.assertNotIn('offline-secret-dsn', output + stderr.getvalue())
        self.assertEqual(stderr.getvalue(), '')
        return code, json.loads(output), constructor.call_count

    def action(self, kind, version, key='operation-1', **grants):
        args = [kind, self.request, '--expected-version', str(version),
                '--idempotency-key', key, '--actor', 'operator-fixture', '--reason', 'manual test']
        for name, value in grants.items():
            args.extend(['--' + name.replace('_', '-'), str(value)])
        return args

    def snapshot(self):
        with self.store.db() as connection:
            return {table: [tuple(row) for row in connection.execute('SELECT * FROM ' + table)]
                    for table in ('full_reports', 'full_steps', 'full_events',
                                  'full_execution_policies', 'full_execution_actions')}

    def test_status_uses_real_select_without_recovery_or_worker(self):
        job = self.store.claim(synthetic=False, ttl=2)
        self.clock.now += 20  # expired lease must not be recovered by observation
        before = self.snapshot()
        with patch.object(self.store, 'get', side_effect=AssertionError('get is not read-only')), \
             patch.object(self.store, '_recover', side_effect=AssertionError('no recovery')), \
             patch.object(self.store, 'claim', side_effect=AssertionError('no claim')):
            code, output, calls = self.run_cli(['--policy-status', self.request])
        self.assertEqual((code, calls), (0, 1))
        self.assertEqual(output['report_id'], self.rid)
        self.assertEqual(output['status'], 'running')
        self.assertEqual(output['policy_projection']['usage']['attempts_total'], 1)
        self.assertEqual(output['policy_projection']['current_step_id'], job['step_id'])
        self.assertFalse(output['policy_projection']['money_hard_limit'])
        self.assertEqual(self.snapshot(), before)
        self.assertNotIn(job['token'], json.dumps(output))

    def test_pause_and_continue_preserve_checkpoint_attempts_and_work(self):
        first = self.store.claim(synthetic=False)
        self.clock.now += 3
        self.store.finish_part(first['step_id'], first['token'], {'text': '原始检查点', 'metadata': {}})
        before = self.snapshot()['full_steps'][0]
        version = self.store.policy_status(TENANT, self.rid)['policy_projection']['version']
        code, paused, _ = self.run_cli(self.action('--pause-request', version))
        self.assertEqual(code, 0)
        self.assertEqual(paused['status'], 'paused')
        code, resumed, _ = self.run_cli(self.action('--continue-request', paused['policy_projection']['version'], 'continue-1'))
        self.assertEqual(code, 0)
        self.assertEqual(resumed['status'], 'queued')
        self.assertEqual(resumed['policy_projection']['usage']['attempts_total'], 1)
        self.assertEqual(resumed['policy_projection']['usage']['work_seconds'], 3)
        self.assertEqual(self.snapshot()['full_steps'][0], before)

    def test_running_pause_is_step_boundary_and_settles_once(self):
        job = self.store.claim(synthetic=False)
        self.clock.now += 4
        version = self.store.policy_status(TENANT, self.rid)['policy_projection']['version']
        code, paused, _ = self.run_cli(self.action('--pause-request', version))
        self.assertEqual((code, paused['status']), (0, 'pause_requested'))
        self.assertFalse(paused['policy_projection']['can_continue'])
        self.assertTrue(self.store.finish_part(job['step_id'], job['token'], {'text': '已完成原件', 'metadata': {}}))
        settled = self.store.policy_status(TENANT, self.rid)
        self.assertEqual(settled['status'], 'paused')
        self.assertEqual(settled['policy_projection']['usage']['work_seconds'], 4)
        self.assertFalse(self.store.finish_part(job['step_id'], job['token'], {'text': '迟到覆盖', 'metadata': {}}))
        self.assertEqual(self.store.policy_status(TENANT, self.rid)['policy_projection']['usage']['work_seconds'], 4)

    def test_finite_grant_retains_old_usage_and_limits_one_more_start(self):
        for _ in range(3):
            job = self.store.claim(synthetic=False)
            self.clock.now += 1
            self.store.fail_part(job['step_id'], job['token'], 'upstream')
        before = self.store.policy_status(TENANT, self.rid)
        self.assertEqual(before['status'], 'paused')
        version = before['policy_projection']['version']
        code, error, _ = self.run_cli(self.action('--continue-request', version))
        self.assertEqual((code, error['report_engine']), (4, 'policy_conflict'))
        code, output, _ = self.run_cli(self.action('--continue-request', version, 'grant-1', extra_attempts=1))
        self.assertEqual(code, 0)
        self.assertEqual(output['policy_projection']['usage']['attempts_total'], 3)
        self.assertEqual(output['policy_projection']['usage']['work_seconds'], 3)
        self.assertEqual(output['policy_projection']['remaining']['step_attempts'], 1)
        self.store = FullStore(self.path, clock=self.clock, backoff=(0,))
        fourth = self.store.claim(synthetic=False)
        self.assertEqual(fourth['attempts'], 4)
        self.store.fail_part(fourth['step_id'], fourth['token'], 'upstream')
        self.assertIsNone(self.store.claim(synthetic=False))
        self.assertEqual(self.store.policy_status(TENANT, self.rid)['status'], 'paused')

    def test_idempotency_replay_does_not_repeat_action_and_conflict_is_safe(self):
        args = self.action('--pause-request', 1)
        first = self.run_cli(args)
        before = self.snapshot()
        second = self.run_cli(args)
        self.assertEqual(first[:2], second[:2])
        self.assertEqual(before, self.snapshot())
        changed = list(args); changed[-1] = 'postgres://private@host/password'
        code, error, _ = self.run_cli(changed)
        self.assertEqual((code, error), (4, {'report_engine': 'policy_conflict'}))
        self.assertNotIn('password', json.dumps(error))

    def test_finite_time_grants_keep_units_and_exact_idempotency(self):
        _, paused, _ = self.run_cli(self.action('--pause-request', 1))
        args = self.action('--continue-request', paused['policy_projection']['version'], 'time-grant',
                           extra_task_seconds=0.5, extra_stage_seconds=1.5, extra_wall_seconds=2.5,
                           extra_retries=1, extra_attempts=1)
        first = self.run_cli(args)
        self.assertEqual(first[0], 0)
        limits = first[1]['policy_projection']['limits']
        self.assertEqual(limits['task_work_seconds'], 14400.5)
        self.assertEqual(limits['stage_work_seconds'], 3601.5)
        self.assertEqual(limits['wall_seconds'], 86402.5)
        self.assertEqual(limits['report_max_retries'], 25)
        self.assertEqual(limits['step_max_attempts'], 4)
        self.assertEqual(first, self.run_cli(args))

    def test_stale_version_rejected_without_mutation(self):
        self.run_cli(self.action('--pause-request', 1))
        before = self.snapshot()
        code, result, _ = self.run_cli(self.action('--continue-request', 1, 'stale'))
        self.assertEqual((code, result['report_engine']), (4, 'policy_conflict'))
        self.assertEqual(self.snapshot(), before)

    def test_legacy_completed_cancelled_and_other_tenant_cannot_be_resumed(self):
        for case in ('legacy', 'completed', 'cancelled', 'other-tenant'):
            with self.subTest(case=case):
                request = 'rrCase' + case.replace('-', '')
                tenant = 'another-tenant' if case == 'other-tenant' else TENANT
                self.store.create(tenant, '测试省', '测试市', request, synthetic=case == 'legacy')
                rid = report_id(request)
                if case in ('completed', 'cancelled'):
                    with self.store.db() as c:
                        c.execute('UPDATE full_reports SET status=? WHERE id=?', (case, rid))
                before = self.snapshot()
                for action in ('--pause-request', '--continue-request'):
                    args = self.action(action, 1); args[1] = request
                    code, output, _ = self.run_cli(args)
                    self.assertEqual((code, output['report_engine']), (4, 'policy_conflict'))
                self.assertEqual(self.snapshot(), before)

    def test_legacy_status_is_honest_and_missing_is_not_found(self):
        request = 'rrLegacyStatus'; self.store.create(TENANT, '省', '市', request, synthetic=True)
        code, output, _ = self.run_cli(['--policy-status', request])
        self.assertEqual(code, 0)
        self.assertEqual(output['policy_projection']['state'], 'legacy')
        self.assertIsNone(output['policy_projection']['limits'])
        self.assertFalse(output['policy_projection']['can_pause'])
        code, output, _ = self.run_cli(['--policy-status', 'rrMissing'])
        self.assertEqual((code, output), (3, {'report_engine': 'policy_not_found'}))

    def test_invalid_mutual_flags_and_missing_operation_fields_open_no_store(self):
        full = self.action('--continue-request', 1)
        cases = [[], ['--check'], ['--resume-request', self.request]]
        # Control-only arguments cannot silently launch the worker or legacy resume.
        invalid = [base + ['--actor', 'operator'] for base in cases]
        invalid.extend([['--policy-status', self.request, '--pause-request', self.request],
                        ['--policy-status', self.request, '--check'],
                        ['--policy-status', self.request, '--expected-version', '1'],
                        ['--pause-request', self.request],
                        ['--continue-request', self.request],
                        ['--database-url', 'postgres://private@host/password'],
                        ['--policy-status', 'bad id']])
        for flag in ('--expected-version', '--idempotency-key', '--actor', '--reason'):
            index = full.index(flag); invalid.append(full[:index] + full[index + 2:])
        for args in invalid:
            with self.subTest(args=args):
                code, output, calls = self.run_cli(args)
                self.assertEqual((code, output, calls), (2, {'report_engine': 'policy_arguments_invalid'}, 0))

    def test_grant_bounds_nan_negative_and_incomplete_values_open_no_store(self):
        bad = [('extra_attempts', '-1'), ('extra_attempts', '4'), ('extra_attempts', '1.5'),
               ('extra_retries', '25'), ('extra_task_seconds', 'nan'), ('extra_task_seconds', 'inf'),
               ('extra_task_seconds', '-1'), ('extra_task_seconds', '14400.1'),
               ('extra_stage_seconds', '3601'), ('extra_wall_seconds', '86401')]
        for field, value in bad:
            with self.subTest(field=field, value=value):
                code, out, calls = self.run_cli(self.action('--continue-request', 1, **{field: value}))
                self.assertEqual((code, out, calls), (2, {'report_engine': 'policy_arguments_invalid'}, 0))
        for args in (self.action('--continue-request', 0),
                     self.action('--continue-request', 1) + ['--extra-attempts'],
                     self.action('--pause-request', 1, extra_attempts=0)):
            code, out, calls = self.run_cli(args)
            self.assertEqual((code, out, calls), (2, {'report_engine': 'policy_arguments_invalid'}, 0))

    def test_actor_reason_and_all_operation_flag_combinations_are_validated(self):
        flags = ['--check', '--resume-request', '--policy-status', '--pause-request', '--continue-request']
        for index, one in enumerate(flags):
            for two in flags[index + 1:]:
                args = [one] + ([] if one == '--check' else [self.request])
                args += [two] + ([] if two == '--check' else [self.request])
                with self.subTest(one=one, two=two):
                    self.assertEqual(self.run_cli(args),
                                     (2, {'report_engine': 'policy_arguments_invalid'}, 0))
        for flag, value in [('--actor', ''), ('--actor', ' '), ('--actor', 'bad\nactor'),
                            ('--actor', 'a' * 129), ('--reason', ''), ('--reason', 'r' * 1001),
                            ('--idempotency-key', 'bad\tkey')]:
            args = self.action('--pause-request', 1)
            args[args.index(flag) + 1] = value
            with self.subTest(flag=flag, value_length=len(value)):
                self.assertEqual(self.run_cli(args),
                                 (2, {'report_engine': 'policy_arguments_invalid'}, 0))

    def test_database_requirement_never_requires_model_or_search_credentials(self):
        code, out, calls = self.run_cli(['--policy-status', self.request], env={})
        self.assertEqual((code, calls), (2, 0))
        self.assertEqual(out, {'report_engine': 'policy_configuration_required', 'missing': ['DATABASE_URL']})
        self.assertEqual(self.run_cli(['--policy-status', self.request])[0], 0)

    def test_output_whitelist_and_storage_exception_never_echo_payloads(self):
        result = self.store.policy_status(TENANT, self.rid)
        result['prompt'] = 'private report'; result['policy_projection']['reason'] = 'private operator reason'
        self.assertNotIn('private', json.dumps(hosted._policy_projection(result)))
        with patch('report_service.full_postgres.PostgresFullStore', side_effect=OSError('postgres://secret')):
            out = io.StringIO()
            with patch.dict('os.environ', {'DATABASE_URL': 'secret'}, clear=True), contextlib.redirect_stdout(out):
                self.assertEqual(hosted.main(['--policy-status', self.request]), 1)
            self.assertEqual(json.loads(out.getvalue()), {'report_engine': 'policy_storage_unavailable'})

    def test_existing_configuration_resume_uses_original_path_and_preserves_usage(self):
        # This legacy task has no policy row; the old configuration recovery is
        # deliberately separate from v1 pause/continue and its control metadata.
        request = 'rrLegacyConfiguration'; rid = report_id(request)
        self.store.create(TENANT, '测试省', '测试市', request, synthetic=True)
        self.store.cancel(TENANT, self.rid)
        job = self.store.claim(synthetic=True)
        self.clock.now += 2
        self.store.fail_part(job['step_id'], job['token'], 'configuration', False)
        data = {'REPORT_REQUESTS': [{'id': request, 'engine': ENGINE, 'province': '测试省',
                                     'city': '测试市', 'status': 'running'}]}
        class Session:
            def read(self): return json.dumps(data)
            def write(self, value): data.update(json.loads(value)); return True
        @contextlib.contextmanager
        def session(): yield Session()
        env = {'DATABASE_URL': 'offline-secret-dsn', 'HXZ_ENABLE_LIVE': '1',
               'HXZ_MODEL_KEY': 'offline-key', 'HXZ_MODEL_URL': 'https://example.org/chat',
               'HXZ_MODEL_NAME': 'offline', 'HXZ_SEARCH_KEY': 'offline-search'}
        stdout = io.StringIO()
        with patch.dict('os.environ', env, clear=True), \
             patch('report_service.full_postgres.PostgresFullStore', return_value=self.store), \
             patch('report_service.full_provider.FullLiveProvider.from_env', return_value=object()), \
             patch('backend.sync_transaction.postgres_session', session), contextlib.redirect_stdout(stdout):
            self.assertEqual(hosted.main(['--resume-request', request]), 0)
        self.assertEqual(json.loads(stdout.getvalue()), {'report_engine': 'configuration_resumed'})
        actual = self.store.get(TENANT, rid)
        self.assertEqual(actual['status'], 'queued')
        policy = self.store.policy_status(TENANT, rid)['policy_projection']
        self.assertEqual(policy['state'], 'legacy')
        with self.store.db() as c:
            row = c.execute('SELECT attempts,consumed FROM full_steps WHERE id=?', (job['step_id'],)).fetchone()
            self.assertEqual(tuple(row), (1, 2))


if __name__ == '__main__': unittest.main()
