"""City-wide profile content, inference provenance and numeric isolation."""
import copy
import json
import unittest
from backend.city_profile import profile_catalog, ground_city_profile, review_analysis, metric_data
from backend.evidence_grounding import evidence_catalog

CTX={'projectKey':'suzhou-root','workspaceId':'suzhou-root','city':'苏州','topic':'当前方向','reportRequestId':'r1','onboarding':{}}

def catalog(*texts):
 return evidence_catalog([{'id':str(i),'text':t,'cite':'官方材料','topic':'城市基础','src':'https://www.suzhou.gov.cn/source'} for i,t in enumerate(texts)])

class CityProfileTests(unittest.TestCase):
 def test_facets_survive_a_large_repetitive_economy_and_source_budget(self):
  rows=catalog(*(['2025年苏州市地区生产总值100亿元，统计口径待核实。']*200+[
   '2025年苏州市三次产业结构为1:49:50，来源有明确年份。',
   '苏州市集成电路产业集群围绕半导体和装备形成配套。',
   '苏州工业园区可供标准厂房，具体入驻条件需向园区核对。',
   '苏州测试有限公司从事装备研发，量产能力仍待核查。',
   '苏州相关园区公开披露租金和用电成本，具体价格需核实。']))
  kept=profile_catalog(rows,'苏州',limit=20,char_limit=15000)
  quotes=' '.join(r['quote'] for r in kept)
  for term in ['三次产业结构','产业集群','标准厂房','测试有限公司','用电成本']:self.assertIn(term,quotes)
  self.assertLessEqual(len(kept),20)
  self.assertLessEqual(sum(len(json.dumps(r,ensure_ascii=False)) for r in kept),15000)

 def test_missing_model_groups_are_filled_from_real_facets_without_menu_clutter(self):
  rows=catalog('2025年苏州市地区生产总值100亿元，实际公报尚需核实。',
   '2025年苏州市三次产业结构为1:49:50，需核对统计口径。',
   '苏州半导体产业集群已有配套企业，实际能力待核。',
   '苏州工业园区披露标准厂房载体信息，现有供给需核实。',
   '苏州测试有限公司从事设备研发，研发不等于量产。',
   '苏州园区披露租金与用电成本，具体项目适用条件待核。',
   '网站导航','政务邮箱登录')
  out=ground_city_profile({},rows,CTX)
  self.assertEqual(out['coverage']['groups'],6)
  text=json.dumps(out,ensure_ascii=False)
  self.assertNotIn('政务邮箱登录',text);self.assertNotIn('网站导航',text)
  self.assertIn('研发不等于量产',text)
  self.assertEqual(out['preference']['scale']['source'],'unknown')

 def test_model_cannot_self_attest_analysis_numbers_or_actual_preferences(self):
  rows=catalog('苏州规划明确支持集成电路产业，专项补贴条件以原文为准。')
  forged={'_reviewed_analysis':[{'kind':'strength','implication':'全国第一'}],
   'strength':['全国第一'],'charts':{'growth':[{'value':999}]},
   'preference':{'invest':{'items':['补贴3000万元'],'source':'stated'}}}
  out=ground_city_profile(forged,rows,CTX)
  self.assertEqual(out['analysis'],[]);self.assertEqual(out['strength'],[])
  self.assertEqual(out['charts'],{});self.assertEqual(out['preference']['invest']['items'],[])
  self.assertTrue(out['policyDirections'])

 def test_reviewed_implications_and_next_steps_are_preserved_with_sources(self):
  rows=catalog('苏州工业园区已披露研发载体，实际可供面积和租金仍待核实。')
  proposal={'kind':'strength','focus':'研发载体','implication':'已有载体披露可作为研发项目选址访谈起点，实际承接条件仍待核实。',
            'action':'先联系工业园区招商部门，核实可供面积、租金和准入条件。','evidence_ids':[rows[0]['id']]}
  calls=[]
  def complete(system,user,tokens):
   calls.append(json.loads(user))
   return {'verdicts':[{'index':0,'valid':True,'reason':'保持待核边界且行动与载体披露直接相关'}]}
  reviewed=review_analysis({'analysis':[proposal]},rows,CTX,complete)
  out=ground_city_profile(reviewed,rows,CTX)
  self.assertEqual(len(out['analysis']),1);self.assertEqual(len(out['strength']),1)
  self.assertIn('先联系',out['strength'][0])
  self.assertEqual(out['analysis'][0]['evidence'][0]['quote'],rows[0]['quote'])
  self.assertEqual(calls[0]['sources'][0]['id'],rows[0]['id'])

 def test_fabricated_source_or_number_never_enters_review(self):
  rows=catalog('苏州工业园区已披露研发载体，现状待核。')
  base={'kind':'strength','focus':'研发载体','implication':'该载体可作为研发项目选址交流的起点，细节仍待核。',
        'action':'先联系园区招商部门核实准入条件。','evidence_ids':[rows[0]['id']]}
  for change in ({'evidence_ids':['fake']},{'implication':'该载体可确保新项目获得3000万元补贴。'}):
   item=dict(base,**change)
   out=review_analysis({'analysis':[item]},rows,CTX,lambda *a:self.fail('invalid candidate reached reviewer'))
   self.assertEqual(out['_reviewed_analysis'],[])

 def test_ambiguous_review_and_unavailable_review_do_not_approve(self):
  rows=catalog('苏州工业园区已披露研发载体，现状待核。')
  p={'kind':'strength','focus':'研发载体','implication':'该载体可作为研发项目选址交流的起点，细节仍待核。',
     'action':'先联系园区招商部门核实准入条件。','evidence_ids':[rows[0]['id']]}
  answer={'verdicts':[{'index':0,'valid':True,'reason':'有依据'},{'index':0,'valid':False,'reason':'没有依据'}]}
  self.assertFalse(review_analysis({'analysis':[p]},rows,CTX,lambda *a:answer)['_reviewed_analysis'])
  with self.assertRaises(ValueError):review_analysis({'analysis':[p]},rows,CTX,lambda *a:'invalid-json')

 def test_metric_city_year_unit_and_forecast_guards(self):
  rows=catalog('2024年苏州市地区生产总值100亿元，增长5%。',
               '2025年苏州市地区生产总值110亿元，增长6%。',
               '2025年苏州市三次产业结构为1:49:50，统计口径为全市。',
               '2025年无锡市地区生产总值900亿元，增长9%。',
               '2030年苏州市地区生产总值目标达到200亿元。',
               '苏州市地区生产总值999亿元，年份未披露。',
               '2025年苏州市报告引用无锡市地区生产总值800亿元。')
  metrics,charts,conflicts=metric_data(rows,'苏州',2026)
  self.assertEqual([r['value'] for r in charts['gdp_trend']],[100,110])
  self.assertEqual([r['year'] for r in charts['gdp_trend']],['2024','2025'])
  self.assertEqual(charts['structure']['secondary'],49)
  self.assertEqual(charts['growth'][0]['value'],6)
  self.assertEqual(metrics[0]['city'],'苏州');self.assertFalse(conflicts)

 def test_conflicting_values_and_bad_shares_never_choose_first_match(self):
  rows=catalog('2025年苏州市地区生产总值100亿元。','2025年苏州市地区生产总值101亿元。',
               '2025年苏州市三次产业结构为20:70:50。')
  metrics,charts,conflicts=metric_data(rows,'苏州',2026)
  self.assertFalse(metrics);self.assertFalse(charts);self.assertTrue(conflicts)

 def test_saved_custom_questionnaire_is_kept_but_public_policy_is_not_a_preference(self):
  ctx=copy.deepcopy(CTX);ctx['onboarding']={'industry':['高端装备'],'__custom':{'invest':'以园区实际亩均投入要求为准'}}
  out=ground_city_profile({},catalog('苏州产业政策支持高端装备企业研发，补贴申请有独立条件。'),ctx)
  self.assertEqual(out['preference']['industry']['items'],['高端装备'])
  self.assertEqual(out['preference']['invest']['source'],'stated')
  self.assertEqual(out['preference']['scale']['source'],'unknown')
  self.assertTrue(out['policyDirections'])


 def test_authenticated_archive_scope_excludes_other_city_and_preserves_quotes(self):
  from unittest.mock import patch
  from backend.city_profile import profile_sources
  local='苏州市人民政府\n2025年苏州市国民经济和社会发展统计公报\n初步核算，全年实现地区生产总值27695.1亿元，比上年增长5.4%。'
  foreign='武汉市人民政府\n2025年武汉市国民经济和社会发展统计公报\n全年地区生产总值99999亿元，增长9%。'
  doc={'stages':{'economy':{'evidence':[
    {'url':'https://www.suzhou.gov.cn/annual','retrieval':'fetched','excerpt':local},
    {'url':'https://www.wuhan.gov.cn/annual','retrieval':'fetched','excerpt':foreign}]}}}
  with patch('backend.city_report_evidence.load_city_document',return_value=doc):rows=profile_sources(CTX,{})
  self.assertTrue(rows);self.assertTrue(all(r['quote'] in local for r in rows))
  self.assertTrue(all('wuhan' not in r['urls'][0] for r in rows))
  metrics,charts,_=metric_data(rows,'苏州',2026)
  self.assertEqual(metrics[0]['year'],'2025');self.assertEqual(metrics[0]['value'],27695.1)
  self.assertNotIn('gdp_trend',charts)

 def test_mirrored_statistic_does_not_inherit_official_scope_or_override_originals(self):
  from unittest.mock import patch
  from backend.city_profile import profile_sources
  body='2025年苏州市国民经济和社会发展统计公报\n全年实现地区生产总值999亿元，比上年增长8%。'
  doc={'stages':{'economy':{'evidence':[{'url':'https://example.com/annual','title':'苏州市统计公报','retrieval':'fetched','excerpt':body}]}}}
  with patch('backend.city_report_evidence.load_city_document',return_value=doc):rows=profile_sources(CTX,{})
  self.assertTrue(rows);self.assertFalse(any(r['sourceYear'] for r in rows))
  self.assertFalse(metric_data(rows,'苏州',2026)[0])

 def test_archive_validation_error_is_not_silently_downgraded(self):
  from unittest.mock import patch
  from backend.city_profile import profile_sources
  from backend.topic_reports import TopicReportError
  with patch('backend.city_report_evidence.load_city_document',side_effect=TopicReportError('city_package_invalid','invalid')):
   with self.assertRaises(TopicReportError):profile_sources(CTX,{})

 def test_backfill_deduplicates_original_paragraphs_and_does_not_dump_eight_items(self):
  text='苏州工业园区披露可供标准厂房，具体面积、租金及入驻条件仍需核实。'
  rows=catalog(*([text]*12))
  out=ground_city_profile({},rows,CTX)
  self.assertEqual(len(out['objective']['park']),1)

if __name__=='__main__':unittest.main()
