import unittest
from backend.chain_node_analysis import analyze_nodes


class NodeAnalysisTests(unittest.TestCase):
    def graph(self):
        return {'chain':[{'nodes':[{'id':'one','name':'菌种','sources':[{'id':'s1','quote':'本地已开展菌种培育','source_scope':'city_related'}]},
                                  {'id':'two','name':'菌棒','sources':[{'id':'s2','quote':'行业菌棒制造','source_scope':'industry_background'}]}]}],
                'unclassified':[{'id':'three','name':'待核服务','sources':[]}]}
    def test_every_node_has_grade_and_background_cannot_be_local_capability(self):
        graph=self.graph()
        result=analyze_nodes({'city':'随州','topic':'香菇'},graph,lambda *args:{'nodes':[
            {'id':'one','grade':'A','reason':'原文披露培育活动','action':'核实产能','evidence_ids':['s1']},
            {'id':'two','grade':'A','reason':'仅行业背景','action':'核实本地','evidence_ids':['s2']}]})
        nodes=graph['chain'][0]['nodes']+graph['unclassified']
        self.assertEqual([n['development_analysis']['grade'] for n in nodes],['A','P','P'])
        self.assertEqual(result['total'],3)
        self.assertEqual(result['analyzed'],2)
    def test_model_failure_and_forged_source_do_not_create_fact_rating(self):
        graph=self.graph()
        analyze_nodes({'city':'随州','topic':'香菇'},graph,lambda *args:{'nodes':[
            {'id':'one','grade':'A','reason':'fake','action':'fake','evidence_ids':['not-allowed']}]})
        self.assertEqual(graph['chain'][0]['nodes'][0]['development_analysis']['grade'],'P')
        self.assertNotIn('assessment',graph['chain'][0]['nodes'][0])
