import copy
import unittest

from backend.chain_node_research import select_node_targets, merge_node_research
from backend.topic_research import node_search_plan


class NodeResearchTests(unittest.TestCase):
    def test_balances_server_nodes_and_skips_existing_strength_and_generic_first(self):
        chain = {'chain': [{'seg': seg, 'nodes': [
            {'id': seg + str(i), 'name': name} for i, name in enumerate(names)]}
            for seg, names in [('上游', ['关键原材料', '过滤膜', '培养基']),
                               ('中游', ['生物反应器', '层析系统']),
                               ('下游', ['医药物流', '诊疗服务'])]]}
        ratings = {'node_assessments': {'上游1': {'judgment': {'level': 'strong'}}}}
        targets = select_node_targets(chain, ratings)
        self.assertEqual(len(targets), 6)
        self.assertEqual([row['name'] for row in targets[:3]], ['培养基', '生物反应器', '医药物流'])
        self.assertNotIn('过滤膜', [row['name'] for row in targets])
        self.assertEqual(len(node_search_plan('闵行区', '生物医药', [r['name'] for r in targets])), 12)

    def test_queries_only_use_public_labels_and_bound_targets(self):
        queries = node_search_plan('闵行区', '生物医药', ['过滤膜', '过滤膜'] + ['项目'+str(i) for i in range(10)])
        self.assertEqual(len(queries), 12)
        self.assertTrue(queries[0].startswith('闵行区 过滤膜'))
        self.assertIn('进口依赖', queries[1])
        with self.assertRaises(ValueError):
            node_search_plan('闵行区/SECRET', '生物医药', ['过滤膜'])

    def test_failed_or_wrong_scope_supplement_does_not_drop_original_graph_sources(self):
        base = {'city':'闵行区','topic':'生物医药','evidence':[{'id':'original'}],
                'sources':{'a':{'fulltext':'原始材料'}},'queries':['原始查询'],'status':'ready'}
        out = merge_node_research(base, {'city':'其他地区','topic':'生物医药','evidence':[{'id':'bad'}]}, [])
        self.assertEqual(out['evidence'], base['evidence'])
        self.assertEqual(out['node_research']['status'], 'scope_mismatch')
        self.assertNotIn('node_research', base)
        merged = merge_node_research(base, {'city':'闵行区','topic':'生物医药','evidence':[{'id':'new'}],
                    'sources':{'b':{'fulltext':'补充材料'}},'queries':['补充查询'],'status':'ready'}, [])
        self.assertEqual([r['id'] for r in merged['evidence']], ['original','new'])
        self.assertEqual(set(merged['sources']), {'a','b'})

    def test_prior_failed_batches_are_not_hidden_by_final_ready_batch(self):
        # Shape of the 2026-10-17 regression: three partial searches, one
        # unavailable search, then a successful final batch. No live I/O.
        base = {'city': '测试区', 'topic': '生物医药', 'status': 'ready',
                'evidence': [{'id': 'original'}], 'sources': {}, 'queries': []}
        original = copy.deepcopy(base)
        counts = [5, 4, 6, 7, 0]
        statuses = ['pending', 'pending', 'pending', 'unavailable', 'ready']
        for i, (status, count) in enumerate(zip(statuses, counts)):
            extra = {'city': '测试区', 'topic': '生物医药', 'status': status,
                     'evidence': [] if status == 'unavailable' else [{'id': f'e{i}'}],
                     'queries': [f'查询{i}'],
                     'errors': [{'code': 'research_deadline', 'query': f'查询{i}-{j}'}
                                for j in range(count)]}
            before = copy.deepcopy(extra)
            base = merge_node_research(base, extra, [{'id': f'n{i}', 'name': f'产品{i}'}])
            self.assertEqual(extra, before)
        summary = base['node_research']
        self.assertEqual(summary['status'], 'partial')
        self.assertEqual(len(summary['errors']), 22)
        self.assertEqual([b['status'] for b in summary['batches']], statuses)
        self.assertEqual(len(summary['targets']), 5)
        self.assertEqual(base['queries'], [f'查询{i}' for i in range(5)])
        self.assertEqual(base['status'], 'ready')  # Initial retrieval is separate.
        self.assertNotIn('node_research', original)
        self.assertEqual(summary['truncation']['discarded_evidence_count'], 0)

    def test_all_ready_batches_remain_ready_and_targets_are_deduplicated(self):
        base = {'city': '测试区', 'topic': '储能', 'evidence': [], 'sources': {}, 'queries': []}
        for i in range(2):
            base = merge_node_research(base, {
                'city': '测试区', 'topic': '储能', 'status': 'ready',
                'evidence': [{'id': f'e{i}'}], 'queries': ['共享查询', f'查询{i}']},
                [{'id': 'n', 'name': '液流电池'}])
        summary = base['node_research']
        self.assertEqual(summary['status'], 'ready')
        self.assertEqual(len(summary['targets']), 1)
        self.assertEqual([b['index'] for b in summary['batches']], [1, 2])
        self.assertEqual([b['retained_new_evidence_count'] for b in summary['batches']], [1, 1])
        self.assertEqual(base['queries'], ['共享查询', '查询0', '查询1'])

    def test_scope_failure_stays_recorded_after_success_without_merging_bad_data(self):
        base = {'city': '测试区', 'topic': '储能', 'evidence': [{'id': 'original'}],
                'sources': {}, 'queries': []}
        failed = merge_node_research(base, {
            'city': '其他区', 'topic': '储能', 'status': 'ready',
            'evidence': [{'id': 'wrong'}], 'sources': {'wrong': {}}, 'queries': ['错误范围']}, [])
        self.assertEqual(failed['node_research']['status'], 'scope_mismatch')
        merged = merge_node_research(failed, {
            'city': '测试区', 'topic': '储能', 'status': 'ready',
            'evidence': [{'id': 'valid'}]}, [])
        self.assertEqual(merged['node_research']['status'], 'partial')
        self.assertEqual([b['status'] for b in merged['node_research']['batches']], ['scope_mismatch', 'ready'])
        self.assertEqual([r['id'] for r in merged['evidence']], ['original', 'valid'])
        self.assertNotIn('wrong', merged['sources'])
        self.assertNotIn('错误范围', merged['queries'])

    def test_truncation_is_explicit_and_counted_per_merge(self):
        base = {'city': '测试区', 'topic': '储能',
                'evidence': [{'id': f'e{i}'} for i in range(190)], 'sources': {}, 'queries': []}
        extra = {'city': '测试区', 'topic': '储能', 'status': 'ready',
                 'evidence': [{'id': f'e{i}'} for i in range(190, 200)]}
        merged = merge_node_research(base, extra, [])
        self.assertEqual(len(merged['evidence']), 192)
        summary = merged['node_research']
        self.assertEqual(summary['status'], 'partial')
        self.assertEqual(summary['truncation'], {
            'evidence_limit': 192, 'events': 1, 'discarded_evidence_count': 8})
        self.assertEqual(summary['batches'][0]['received_evidence_count'], 10)
        self.assertEqual(summary['batches'][0]['new_evidence_count'], 10)
        self.assertEqual(summary['batches'][0]['retained_new_evidence_count'], 2)
        # A later duplicate-only success must not erase the earlier loss.
        merged = merge_node_research(merged, dict(extra, evidence=[{'id': 'e191'}]), [])
        self.assertEqual(merged['node_research']['status'], 'partial')
        self.assertEqual(merged['node_research']['truncation']['events'], 1)
        self.assertEqual(merged['node_research']['batches'][-1]['discarded_evidence_count'], 0)

    def test_duplicate_evidence_is_not_counted_as_truncated(self):
        base = {'city': '测试区', 'topic': '储能',
                'evidence': [{'id': f'e{i}'} for i in range(192)], 'sources': {}, 'queries': []}
        merged = merge_node_research(base, {
            'city': '测试区', 'topic': '储能', 'status': 'ready',
            'evidence': [{'id': 'e0'}, {'id': 'e0'}, {'id': 'e191'}]}, [])
        self.assertEqual(merged['node_research']['status'], 'ready')
        self.assertEqual(merged['node_research']['batches'][0]['new_evidence_count'], 0)
        self.assertEqual(merged['node_research']['truncation']['events'], 0)

    def test_legacy_partial_summary_survives_a_successful_new_batch(self):
        base = {'city': '测试区', 'topic': '储能', 'evidence': [], 'sources': {},
                'node_research': {'targets': [{'id': 'old', 'name': '旧目标'}],
                                  'status': 'partial', 'errors': [{'code': 'research_deadline'}]}}
        merged = merge_node_research(base, {'city': '测试区', 'topic': '储能', 'status': 'ready'}, [])
        self.assertEqual(merged['node_research']['status'], 'partial')
        self.assertTrue(merged['node_research']['batches'][0]['legacy_summary'])
        self.assertEqual(merged['node_research']['batches'][1]['index'], 1)
        self.assertNotIn('received_evidence_count', merged['node_research']['batches'][0])
        self.assertEqual(merged['node_research']['errors'], [{'code': 'research_deadline'}])

    def test_ready_status_with_error_cannot_claim_all_batches_succeeded(self):
        merged = merge_node_research({'city': '测试区', 'topic': '储能'}, {
            'city': '测试区', 'topic': '储能', 'status': 'ready',
            'errors': [{'code': 'research_search_failed'}]}, [])
        self.assertEqual(merged['node_research']['status'], 'partial')


if __name__ == '__main__':
    unittest.main()
