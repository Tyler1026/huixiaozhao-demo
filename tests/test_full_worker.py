import multiprocessing
import hashlib
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from report_service.full_store import FullStore
from report_service.full_worker import run_once, run_loop, _failure_diagnostics
from report_service.full_provider import FullProviderError

STAGES = tuple({'id': f's{i}', 'filename': f'{i}.md', 'parts': ('body',)} for i in range(10))


class TinyContract:
    @staticmethod
    def assemble(stage, parts):
        return {'text': '\n'.join(p['text'] for p in parts), 'metadata': {}}
    @staticmethod
    def validate(stage, text, metadata, synthetic=False):
        return [] if text.strip() else ['empty']


class SlowContract(TinyContract):
    @staticmethod
    def validate(*args, **kwargs):
        time.sleep(2)
        return []


class GoodProvider:
    def run_part(self, stage, part, job, prior):
        return {'text': 'SYNTHETIC TEST ' + stage, 'metadata': {}}


class DeepModeProvider:
    def run_part(self, stage, part, job, prior):
        return {'text': 'OFFLINE mode propagation fixture', 'metadata': {'mode': job.get('mode')}}


class DeepModeContract(TinyContract):
    @staticmethod
    def assemble(stage, parts):
        return {'text': parts[0]['text'], 'metadata': parts[0]['metadata']}
    @staticmethod
    def validate(stage, text, metadata, synthetic=False, mode='standard'):
        return [] if mode == 'deep' and metadata.get('mode') == 'deep' else ['deep mode was lost']


class HungProvider:
    def run_part(self, stage, part, job, prior):
        while True: time.sleep(1)


class CrashProvider:
    def run_part(self, stage, part, job, prior): os._exit(7)


class FailOneProvider:
    def run_part(self, stage, part, job, prior):
        if job['city'] == 'bad': raise PermissionError('do not expose secret123')
        return {'text': 'SYNTHETIC TEST ' + stage, 'metadata': {}}


class ReportFaultProvider:
    def run_part(self, stage, part, job, prior):
        return {'text': 'A secret123 https://stats.gov.cn/report1\nB http://127.0.0.1/secret123',
                'metadata': {'evidence': [
                    {'url': 'http://stats.gov.cn/secret123', 'excerpt': ''},
                    {'url': 'https://stats.gov.cn/report1', 'excerpt': 'retrieved facts'},
                ]}}


class RealValidationContract:
    @staticmethod
    def assemble(stage, parts):
        return {'text': '\n'.join(p['text'] for p in parts), 'metadata': parts[0]['metadata']}
    @staticmethod
    def validate(*args, **kwargs):
        from report_service.full_contract import validate
        return validate(*args, **kwargs)


class ProviderParseFault:
    def run_part(self, *args):
        raise FullProviderError('model JSON unparseable: secret123 https://private.example/key', 'quality')


class ProviderMetricFault:
    def run_part(self, *args):
        error = FullProviderError('part line floor not met', 'quality')
        error.safe_metrics = {'line_count': 59, 'min_lines': 67, 'text_chars': 5500,
                              'literal_newline_count': 0, 'api_key': 'secret123',
                              'text': 'private model body https://private.example/key',
                              'upstream_response': {'Authorization': 'secret123'}}
        raise error


class UnsafeMetricMapping(dict):
    def __getitem__(self, key):
        raise RuntimeError('do not expose custom mapping secret123')


class UnsafeMetricProperty(ValueError):
    @property
    def safe_metrics(self):
        raise RuntimeError('do not expose property secret123')


class ContextFaultContract(TinyContract):
    @staticmethod
    def assemble(*args):
        raise ValueError('saved context contains secret123')


class OutputFaultProvider:
    def run_part(self, *args):
        return {'text': 'SYNTHETIC TEST', 'metadata': {}, 'secret123': b'secret123'}


class BundleFaultContract(TinyContract):
    @staticmethod
    def validate(*args, **kwargs):
        return ['URL host is local/private: http://127.0.0.1/secret123']


class RepairGoodProvider(GoodProvider):
    repair_invalid_checkpoints = True


class FullWorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'test.db'
        self.store = FullStore(self.path, stages=STAGES, backoff=(0, 0))
    def tearDown(self): self.tmp.cleanup()

    def test_hung_child_is_reaped_and_budget_exhausts(self):
        # A deliberately bounded test fixture, never the default service policy.
        self.store = FullStore(self.path, stages=STAGES, backoff=(0, 0), max_attempts=3)
        r = self.store.create('a', 'p', 'hang', 'h', True)
        before = {p.pid for p in multiprocessing.active_children()}
        started = time.monotonic()
        for _ in range(3):
            run_once(self.store, HungProvider(), ttl=1, timeout=.4, contract=TinyContract)
        self.assertLess(time.monotonic() - started, 5)
        self.assertEqual(self.store.get('a', r['id'])['status'], 'failed')
        self.assertEqual(self.store.get('a', r['id'])['failure_code'], 'timeout')
        self.assertEqual({p.pid for p in multiprocessing.active_children()}, before)

    def test_crash_becomes_retry_not_infinite_running(self):
        r = self.store.create('a', 'p', 'crash', 'c', True)
        run_once(self.store, CrashProvider(), ttl=1, timeout=2, contract=TinyContract)
        public = self.store.get('a', r['id'])
        self.assertEqual(public['status'], 'retry_wait')
        self.assertEqual(public['failure_code'], 'worker_crash')

    def test_deep_mode_reaches_spawned_research_and_stage_gate(self):
        report = self.store.create('a', 'p', 'deep', 'deep', False, mode='deep')
        result = run_once(self.store, DeepModeProvider(), synthetic=False, contract=DeepModeContract)
        self.assertEqual(result['status'], 'checkpoint')
        self.assertEqual(self.store.parts(report['id'])['s0'][0]['metadata']['mode'], 'deep')

    def test_restart_keeps_first_eight_stage_bytes(self):
        r = self.store.create('a', 'p', 'resume', 'r', True)
        for _ in range(8):
            run_once(self.store, GoodProvider(), ttl=2, timeout=3, contract=TinyContract)
        first = self.store.parts(r['id'])
        self.assertEqual(len(first), 8)
        reopened = FullStore(self.path, stages=STAGES, backoff=(0, 0))
        run_once(reopened, GoodProvider(), ttl=2, timeout=3, contract=TinyContract)
        after = reopened.parts(r['id'])
        self.assertEqual({k: after[k] for k in first}, first)
        self.assertIn('s8', after)

    def test_loop_continues_after_permanent_job_failure(self):
        bad = self.store.create('a', 'p', 'bad', 'bad', True)
        good = self.store.create('a', 'p', 'good', 'good', True)
        run_loop(self.store, FailOneProvider(), max_steps=2, ttl=2, timeout=3, contract=TinyContract)
        b = self.store.get('a', bad['id'])
        self.assertEqual(b['status'], 'failed')
        self.assertEqual(b['failure_code'], 'configuration')
        self.assertNotIn('secret123', str(b))
        self.assertEqual(self.store.get('a', good['id'])['parts_done'], 1)

    def test_stage_diagnostics_count_saved_and_current_parts_without_content(self):
        stages = ({'id': 'economy', 'filename': 'economy.md', 'parts': ('first', 'last'), 'min_lines': 150},)
        store = FullStore(self.path, stages=stages, backoff=(0, 0))
        report = store.create('a', 'p', 'real', 'diagnostic', False)
        first = run_once(store, ReportFaultProvider(), synthetic=False, contract=RealValidationContract)
        self.assertEqual(first['status'], 'checkpoint')
        result = run_once(store, ReportFaultProvider(), synthetic=False, contract=RealValidationContract)
        self.assertEqual((result['status'], result['code']), ('retry_wait', 'quality'))
        diagnostic = result['diagnostics']
        self.assertEqual((diagnostic['phase'], diagnostic['stage'], diagnostic['part']),
                         ('stage_validation', 'economy', 'last'))
        self.assertEqual(diagnostic['exception_class'], 'ValueError')
        self.assertEqual(diagnostic['issues'], ['evidence_floor', 'evidence_structure', 'line_floor', 'repeated_lines', 'url_policy'])
        self.assertEqual((diagnostic['line_count'], diagnostic['min_lines'], diagnostic['evidence_count']), (4, 150, 2))
        self.assertGreater(diagnostic['error_count'], 0)
        self.assertEqual(diagnostic['parts'], [
            {'part_index': index, 'line_count': 2, 'evidence_count': 2,
             'non_https_evidence_count': 1, 'empty_excerpt_count': 1, 'unsafe_text_url_count': 1}
            for index in (0, 1)])
        self.assertTrue(all(isinstance(value, int) for item in diagnostic['parts'] for value in item.values()))
        self.assertNotIn('secret123', str(result))
        self.assertNotIn('http://', str(diagnostic))
        self.assertNotIn('https://', str(diagnostic))
        self.assertEqual(store.get('a', report['id'])['parts_done'], 1)
        self.assertEqual(store.get('a', report['id'])['current']['attempts'], 1)

    def test_provider_diagnostics_classify_parse_fault_without_raw_message(self):
        self.store.create('a', 'p', 'parse', 'parse', False)
        result = run_once(self.store, ProviderParseFault(), synthetic=False, contract=TinyContract)
        self.assertEqual((result['status'], result['code']), ('retry_wait', 'quality'))
        self.assertEqual(result['diagnostics']['phase'], 'provider')
        self.assertEqual(result['diagnostics']['exception_class'], 'FullProviderError')
        self.assertEqual(result['diagnostics']['issues'], ['json_parse'])
        self.assertNotIn('secret123', str(result))
        self.assertNotIn('http://', str(result))
        self.assertNotIn('https://', str(result))

    def test_spawned_provider_failure_reports_only_allowlisted_numeric_metrics(self):
        self.store.create('a', 'p', 'metrics', 'metrics', False)
        result = run_once(self.store, ProviderMetricFault(), synthetic=False, contract=TinyContract)
        self.assertEqual((result['status'], result['code']), ('retry_wait', 'quality'))
        self.assertEqual(result['diagnostics'], {
            'phase': 'provider', 'stage': 's0', 'part': 'body', 'exception_class': 'FullProviderError',
            'issues': ['line_floor'], 'line_count': 59, 'min_lines': 67,
            'text_chars': 5500, 'literal_newline_count': 0,
        })
        self.assertNotIn('secret123', str(result))
        self.assertNotIn('private model body', str(result))
        self.assertNotIn('https://', str(result))

    def test_provider_metrics_reject_boolean_noninteger_negative_and_oversized_counts(self):
        limits = {'line_count': 10_000, 'min_lines': 10_000,
                  'text_chars': 2_000_000, 'literal_newline_count': 10_000}
        for field, limit in limits.items():
            for value in (True, False, -1, 1.0, '67 secret123', [67], {'secret123': 67}, limit + 1, 10 ** 100):
                with self.subTest(field=field, value=value):
                    error = FullProviderError('part line floor not met', 'quality')
                    error.safe_metrics = {field: value, 'raw': 'secret123'}
                    diagnostic = _failure_diagnostics(error, 'provider', 'policy', '国家产业政策')
                    self.assertNotIn(field, diagnostic)
                    self.assertNotIn('secret123', str(diagnostic))
            for value in (0, limit):
                with self.subTest(field=field, value=value):
                    error.safe_metrics = {field: value}
                    diagnostic = _failure_diagnostics(error, 'provider', 'policy', '国家产业政策')
                    self.assertEqual(diagnostic[field], value)

    def test_provider_metrics_reject_custom_containers_and_failing_attribute(self):
        for metrics in (None, 'secret123', [67], UnsafeMetricMapping(line_count=67)):
            with self.subTest(metrics=type(metrics).__name__):
                error = FullProviderError('part line floor not met', 'quality')
                error.safe_metrics = metrics
                diagnostic = _failure_diagnostics(error, 'provider', 'policy', '国家产业政策')
                self.assertEqual(set(diagnostic), {'phase', 'stage', 'part', 'exception_class', 'issues'})
                self.assertNotIn('secret123', str(diagnostic))
        diagnostic = _failure_diagnostics(UnsafeMetricProperty('part line floor not met'),
                                          'provider', 'policy', '国家产业政策')
        self.assertEqual(diagnostic['exception_class'], 'Exception')
        self.assertNotIn('line_count', diagnostic)
        self.assertNotIn('secret123', str(diagnostic))

    def test_provider_metrics_do_not_escape_other_failure_phases(self):
        error = ValueError('saved context must remain private')
        error.safe_metrics = {'line_count': 59, 'min_lines': 67, 'text_chars': 5500,
                              'literal_newline_count': 10, 'raw': 'secret123'}
        diagnostic = _failure_diagnostics(error, 'context', 'policy', '国家产业政策')
        self.assertEqual(set(diagnostic), {'phase', 'stage', 'part', 'exception_class', 'issues'})

    def test_context_and_output_faults_have_distinct_safe_phases(self):
        stages = ({'id': 's0', 'filename': 'one.md', 'parts': ('first', 'last')},)
        store = FullStore(self.path, stages=stages, backoff=(0, 0))
        store.create('a', 'p', 'context', 'context', True)
        run_once(store, GoodProvider(), contract=TinyContract)
        result = run_once(store, GoodProvider(), contract=ContextFaultContract)
        self.assertEqual(result['diagnostics']['phase'], 'context')
        self.assertEqual(result['diagnostics']['issues'], ['context'])
        self.assertNotIn('secret123', str(result))
        output_store = FullStore(Path(self.tmp.name) / 'output.db', stages=STAGES, backoff=(0, 0))
        output_store.create('a', 'p', 'output', 'output', True)
        result = run_once(output_store, OutputFaultProvider(), contract=TinyContract)
        self.assertEqual(result['diagnostics']['phase'], 'output')
        self.assertEqual(result['diagnostics']['issues'], ['output_serialization'])
        self.assertEqual(result['code'], 'quality')
        self.assertNotIn('secret123', str(result))

    def test_bundle_validation_reports_failing_stage_without_validator_message(self):
        stages = ({'id': 's0', 'filename': 'one.md', 'parts': ('body',), 'min_lines': 5},)
        store = FullStore(self.path, stages=stages, artifact_root=self.tmp.name, backoff=(0, 0))
        report = store.create('a', 'p', 'bundle', 'bundle', True)
        job = store.claim(synthetic=True)
        self.assertTrue(store.finish_part(job['step_id'], job['token'], {'text': 'SYNTHETIC TEST', 'metadata': {}}))
        result = run_once(store, GoodProvider(), contract=BundleFaultContract)
        self.assertEqual((result['status'], result['code']), ('retry_wait', 'quality'))
        self.assertEqual(result['diagnostics']['phase'], 'bundle_validation')
        self.assertEqual(result['diagnostics']['stage'], 's0')
        self.assertEqual(result['diagnostics']['issues'], ['url_policy'])
        self.assertEqual(result['diagnostics']['min_lines'], 5)
        self.assertNotIn('secret123', str(result))
        self.assertNotIn('http://', str(result))
        self.assertNotIn('https://', str(result))
        self.assertEqual(store.get('a', report['id'])['parts_done'], 1)

    def test_live_preflight_archives_retained_bytes_and_revokes_claim_before_provider(self):
        stages = ({'id': 's0', 'filename': 'one.md', 'parts': ('first', 'second', 'third')},)
        store = FullStore(self.path, stages=stages, backoff=(0, 0))
        report = store.create('a', 'p', 'live', 'repair', False)
        first = store.claim(synthetic=False)
        kept = {'text': 'Valid retained research', 'metadata': {'evidence': [
            {'url': 'https://stats.gov.cn/facts', 'excerpt': 'Retrieved factual excerpt'}]}}
        self.assertTrue(store.finish_part(first['step_id'], first['token'], kept))
        second = store.claim(synthetic=False)
        bad = {'text': '历史记录 http://stats.gov.cn/retained', 'metadata': {}}
        self.assertTrue(store.finish_part(second['step_id'], second['token'], bad))
        with store.db() as c:
            original = dict(c.execute('SELECT * FROM full_steps WHERE id=?', (second['step_id'],)).fetchone())
        progress_before = store.get('a', report['id'])['progress_at']
        active = store.claim(synthetic=False)
        provider = Mock(repair_invalid_checkpoints=True)
        provider.run_part.side_effect = AssertionError('preflight must not perform research')
        with patch.object(store, 'claim', return_value=active), patch('multiprocessing.process.BaseProcess.start') as spawn:
            result = run_once(store, provider, synthetic=False, contract=TinyContract)
        self.assertEqual(result['status'], 'checkpoint_repaired')
        provider.run_part.assert_not_called()
        spawn.assert_not_called()
        self.assertFalse(store.finish_part(active['step_id'], active['token'], {'text': 'stale response', 'metadata': {}}))
        self.assertFalse(store.heartbeat(active['step_id'], active['token']))
        with store.db() as c:
            archive = dict(c.execute('SELECT * FROM full_checkpoint_archive WHERE report_id=?', (report['id'],)).fetchone())
            statuses = [dict(row) for row in c.execute('SELECT status,output,attempts,token FROM full_steps WHERE report_id=? ORDER BY ordinal', (report['id'],)).fetchall()]
        self.assertEqual(archive['output'], original['output'])
        self.assertEqual(archive['output_sha256'], hashlib.sha256(original['output'].encode('utf-8')).hexdigest())
        self.assertEqual((archive['attempts'], archive['consumed']), (original['attempts'], original['consumed']))
        self.assertEqual(archive['reason'], 'unsafe_text_url')
        self.assertEqual([row['status'] for row in statuses], ['done', 'pending', 'pending', 'pending'])
        self.assertTrue(all(row['output'] is None and row['token'] is None for row in statuses[1:]))
        self.assertEqual(statuses[1]['attempts'], original['attempts'])
        self.assertEqual(store.parts(report['id'])['s0'], [kept])
        self.assertEqual(store.get('a', report['id'])['progress_at'], progress_before)
        reclaimed = store.claim(synthetic=False)
        self.assertEqual(reclaimed['part'], 'second')
        self.assertNotEqual(reclaimed['token'], active['token'])

    def test_live_preflight_keeps_valid_partial_checkpoint_and_continues_research(self):
        stages = ({'id': 's0', 'filename': 'one.md', 'parts': ('first', 'second'), 'min_lines': 100},)
        store = FullStore(self.path, stages=stages, backoff=(0, 0))
        report = store.create('a', 'p', 'live', 'valid-partial', False)
        first = store.claim(synthetic=False)
        kept = {'text': 'One valid line in a partial stage', 'metadata': {'evidence': [
            {'url': 'https://stats.gov.cn/facts', 'excerpt': 'Retrieved factual excerpt'}]}}
        self.assertTrue(store.finish_part(first['step_id'], first['token'], kept))
        with store.db() as c:
            original = c.execute('SELECT output FROM full_steps WHERE id=?', (first['step_id'],)).fetchone()['output']
        result = run_once(store, RepairGoodProvider(), synthetic=False, contract=TinyContract)
        self.assertEqual((result['status'], result['part']), ('checkpoint', 'second'))
        with store.db() as c:
            self.assertEqual(c.execute('SELECT output FROM full_steps WHERE id=?', (first['step_id'],)).fetchone()['output'], original)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM full_checkpoint_archive').fetchone()[0], 0)
        self.assertEqual(store.get('a', report['id'])['parts_done'], 2)

    def test_synthetic_worker_does_not_run_live_checkpoint_repair(self):
        self.store.create('a', 'p', 'offline', 'skip-repair', True)
        with patch.object(self.store, 'repair_invalid_checkpoints', side_effect=AssertionError('synthetic work is not live repair')) as repair:
            result = run_once(self.store, RepairGoodProvider(), synthetic=True, contract=TinyContract)
        self.assertEqual(result['status'], 'checkpoint')
        repair.assert_not_called()

    def test_synthetic_worker_cannot_execute_live_job(self):
        r = self.store.create('a', 'p', 'live', 'live', False)
        run_once(self.store, GoodProvider(), contract=TinyContract, synthetic=True)
        self.assertEqual(self.store.get('a', r['id'])['status'], 'queued')
        self.assertEqual(self.store.get('a', r['id'])['parts_done'], 0)
        self.assertEqual(self.store.get('a', r['id'])['current']['attempts'], 0)

    def test_slow_validation_is_inside_hard_deadline(self):
        single = FullStore(self.path, stages=({'id':'one','filename':'one.md','parts':('body',)},), backoff=(0,0))
        single.create('a','p','slow','slow',True)
        start = time.monotonic()
        run_once(single, GoodProvider(), ttl=1, timeout=.4, contract=SlowContract)
        self.assertLess(time.monotonic()-start, 1.5)


if __name__ == '__main__': unittest.main()
