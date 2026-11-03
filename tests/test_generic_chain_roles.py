import unittest,hashlib
from backend.topic_chain import normalize_chain_plan,chain_prompt,_retained_selection,chain_source_catalog
class GenericChainTests(unittest.TestCase):
 def fixture(self,city,topic):
  quote=city+'披露：高精度传感器、应急装备集成、应急救援服务均为规划方向，尚未完成建设。'
  from test_topic_chain import research
  bundle=research([quote],topic=topic);bundle['city']=city
  return bundle,bundle['evidence'][0]['id']
 def test_cross_city_industry_matrix(self):
  for city in ['随州市','闵行区','苏州市','成都市']:
   for topic in ['应急装备独立环节培育','纺织服装','电子信息','新材料','文旅产业']:
    with self.subTest(city=city,topic=topic):
     research,sid=self.fixture(city,topic);context={'city':city,'topic':topic}
     raw={'nodes':[{'name':n,'evidence_ids':[sid],'lane':lane,'role_basis':basis} for n,lane,basis in [('高精度传感器','上游','作为当前产品的感知输入部件供给'),('应急装备集成','中游','承担当前产业产品的制造集成角色'),('应急救援服务','下游','承担产品交付后的终端应用服务')]]}
     result=normalize_chain_plan(raw,research,context)
     self.assertEqual([len(g['nodes']) for g in result['chain']],[1,1,1])
     baseline=normalize_chain_plan({'nodes':[dict(n,lane=None,role_basis=None) for n in raw['nodes']]},research,context)
     prior={n['name']:n['status'] for n in baseline['unclassified']}
     self.assertTrue(all(n['status']==prior[n['name']] for g in result['chain'] for n in g['nodes']))
     again=normalize_chain_plan({'nodes':_retained_selection(result)},research,context)
     self.assertEqual([len(g['nodes']) for g in again['chain']],[1,1,1])
     self.assertFalse(chain_source_catalog(research,dict(context,city='其他城市')))
 def test_invalid_roles_and_invented_nodes_rejected(self):
  r,sid=self.fixture('随州市','应急装备独立环节培育');c={'city':'随州市','topic':r['topic']}
  for lane,basis,ids in [('上游','', [sid]),('其他','说明当前产业角色的分析',[sid]),('上游','说明当前产业角色的分析',['bad'])]:
   out=normalize_chain_plan({'nodes':[{'name':'高精度传感器','lane':lane,'role_basis':basis,'evidence_ids':ids}]},r,c)
   self.assertFalse(any(g['nodes'] for g in out['chain']))
  out=normalize_chain_plan({'nodes':[{'name':'不存在的工厂','lane':'中游','role_basis':'说明当前产业角色的分析','evidence_ids':[sid]}]},r,c)
  self.assertEqual(out['coverage']['node_count'],0)
class EmptyChainGuardTests(unittest.TestCase):
 def test_all_unclassified_not_saved(self):
  import test_topic_chain_route as fixture
  h=fixture.Handler(fixture.state())
  def empty(*args):
   result=fixture.diagram()
   result['unclassified']=result['chain'][1]['nodes']
   result['chain'][1]['nodes']=[]
   return result
  output,audits=fixture.ChainRouteTests().run_route(h,build=empty)
  self.assertEqual(h.writes,0)
  self.assertNotIn('chain.result',output)
  self.assertIn('chain_classification_unavailable',output)
if __name__=='__main__':unittest.main()
