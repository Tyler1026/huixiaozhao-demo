import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from report_service.full_provider import FullLiveProvider, FullProviderError, _synthesis_safe_metrics
from report_service.full_worker import _failure_diagnostics, _safe_provider_metrics


class SynthesisDiagnosticsTests(unittest.TestCase):
    def test_counts_only_fixed_kinds_and_bounded_line_numbers(self):
        metrics = _synthesis_safe_metrics([
            {'kind': 'numeric_source_mismatch', 'line': 8, 'sources': ['https://secret.example'], 'unsupported': ['secret']},
            {'kind': 'numeric_source_mismatch', 'line': 2},
            {'kind': 'rank_uncertainty_lost', 'line': 3, 'raw': 'private report'},
            {'kind': 'policy_condition_lost', 'line': 4, 'required_condition': 'secret condition'},
            {'kind': 'private arbitrary content', 'line': 1},
        ])
        self.assertEqual(metrics, {'synthesis_numeric_source_mismatch_count': 2,
            'synthesis_rank_uncertainty_lost_count': 1, 'synthesis_policy_condition_lost_count': 1,
            'synthesis_issue_count': 4, 'synthesis_first_issue_line': 2})
        self.assertNotIn('secret', json.dumps(metrics))

    def test_malformed_or_unbounded_diagnostics_do_not_escape(self):
        for line in [True, -1, 0, 10001, '12', None]:
            self.assertNotIn('synthesis_first_issue_line', _synthesis_safe_metrics([{'kind': 'policy_condition_lost', 'line': line}]))
        self.assertEqual(_synthesis_safe_metrics([{'kind': {}}, 'bad', None])['synthesis_issue_count'], 0)
        self.assertEqual(_synthesis_safe_metrics([{'kind': 'rank_uncertainty_lost'}] * 10001)['synthesis_issue_count'], 10000)

    def test_worker_allowlist_rejects_content_negative_bool_and_overflow(self):
        error = FullProviderError('safe', 'quality', safe_metrics={
            'synthesis_issue_count': 4, 'synthesis_first_issue_line': 2,
            'synthesis_numeric_source_mismatch_count': True,
            'synthesis_rank_uncertainty_lost_count': -1,
            'synthesis_policy_condition_lost_count': 10001,
            'sources': ['https://secret.example'], 'required_condition': 'secret', 'raw': 'secret'})
        self.assertEqual(_safe_provider_metrics(error), {'synthesis_issue_count': 4, 'synthesis_first_issue_line': 2})

    def test_actual_second_failed_correction_retains_quality_guard_and_sanitized_diagnostics(self):
        provider = FullLiveProvider(SimpleNamespace(enabled=True, _validate_endpoints=lambda: None))
        text = '经济总量居全市第二。\n' + '\n'.join(f'独立核查事项{i}。' for i in range(79))
        provider._chat_part = Mock(return_value=json.dumps({'text': text}))
        provider._gather_evidence = Mock(side_effect=AssertionError('no additional search'))
        prior = {'economy': {'text': '全市第二来自自媒体，待核实。', 'metadata': {}}}
        with self.assertRaises(FullProviderError) as caught:
            provider.run_part('compact', '精简报告', {'city': '测试区'}, prior)
        self.assertEqual(caught.exception.failure_code, 'quality')
        self.assertEqual(provider._chat_part.call_count, 2)
        diagnostics = _failure_diagnostics(caught.exception, 'provider', 'compact', '精简报告')
        self.assertEqual(diagnostics['issues'], ['synthesis_grounding'])
        self.assertEqual(diagnostics['synthesis_rank_uncertainty_lost_count'], 1)
        self.assertEqual(diagnostics['synthesis_first_issue_line'], 1)
        self.assertNotIn('全市第二', json.dumps(diagnostics, ensure_ascii=False))


if __name__ == '__main__':
    unittest.main()
