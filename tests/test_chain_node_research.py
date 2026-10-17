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


if __name__ == '__main__':
    unittest.main()
