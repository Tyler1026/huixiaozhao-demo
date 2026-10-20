"""Keep incomplete evaluation distinguishable from a substantive unknown."""
import copy
import json
import threading
import unittest

from backend.chain_weakness import build_weakness
from tests.test_chain_reasoning import research, CONTEXT, CHAIN, FALLBACK
from tests.test_chain_weakness import candidate, run


class ChainEvaluationLifecycleTests(unittest.TestCase):
    def test_missing_model_node_is_not_reported_as_missing_source_material(self):
        bundle = research(['闵行区支持飞控系统发展，拟建设生产基地。'])
        result = build_weakness(CONTEXT, bundle, CHAIN, FALLBACK, lambda *args: {})
        self.assertEqual(result['node_judgments']['control']['evaluation_state'], 'proposal_incomplete')
        self.assertIn('未完成', result['node_judgments']['control']['reason'])
        self.assertIn('proposal_incomplete', [row.get('code') for row in result['review_diagnostics']])

    def test_failed_review_is_recorded_without_claiming_the_evidence_is_absent(self):
        bundle = research(['闵行区飞控系统生产线已投产，并已实现批量交付。'])
        result, _ = run(bundle, [candidate(bundle)], False)
        row = result['node_judgments']['control']
        self.assertEqual(row['level'], 'unknown')
        self.assertEqual(row['evaluation_state'], 'review_rejected')
        self.assertIn('未通过', row['reason'])
        self.assertTrue(result['review_diagnostics'])

    def test_independent_batches_run_together_but_do_not_invent_a_rating(self):
        bundle = research(['闵行区支持飞控系统发展，拟建设生产基地。'])
        chain = copy.deepcopy(CHAIN)
        chain['chain'] = [{'seg': '中游', 'nodes': [
            {'id': 'node_' + str(i), 'name': '飞控系统', 'evidence_ids': []}
            for i in range(17)]}]
        barrier = threading.Barrier(3)
        calls = []
        def complete(system, prompt, budget):
            data = json.loads(prompt)
            barrier.wait(timeout=3)
            calls.append(data)
            return {'nodes': [{'node_id': row['node_id'], 'level': 'unknown',
                    'missing': ['缺少已运行或已交付的原文']} for row in data['nodes']]}
        result = build_weakness(dict(CONTEXT, _parallel_assessment=True), bundle, chain, FALLBACK, complete)
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(result['node_judgments']), 17)
        self.assertTrue(all(row['level'] == 'unknown' for row in result['node_judgments'].values()))
        self.assertTrue(all(row['evaluation_state'] == 'insufficient_evidence'
                            for row in result['node_judgments'].values()))


if __name__ == '__main__':
    unittest.main()
