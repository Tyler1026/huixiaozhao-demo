import copy
import json
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from backend.funnel_research import (build_funnel, search_queries, seal_catalog, company_key,
    verified_catalog, originals_catalog)
from backend.evidence_grounding import project_context, review_and_push
from tests.test_funnel_match_review import fixture


def context(city='随州市'):
    return {'projectKey':'p','workspaceId':'p','city':city,'topic':'液流电池隔膜补链',
            'reportRequestId':'r1','chunks':[], 'onboarding':{}, 'reportState':{}}


def source_rows(count=65):
    return [{'url':f'https://official.example/{i}',
             'text':f'第{i}号科技有限公司研发生产液流电池隔膜产品，提供电堆接口适配及测试服务，具体采购资质需要进一步核验。'} for i in range(count)]


def complete(system, user, tokens):
    if tokens==700:
        return {'terms':['液流电池','隔膜']}
    data=json.loads(user)
    return {'companies':[{'name':r['quote'].split('研发')[0], 'kind':'液流电池隔膜产品',
        'evidence_ids':[r['id']], 'product_quote':r['quote'],
        'match_points':40+int(r['quote'].split('号')[0].removeprefix('第'))%21,
        'specificity_points':20, 'delivery_points':10,
        'reason':'已披露隔膜产品及测试服务，与当前隔膜需求可开展参数核对',
        'gaps':'仍需核验材料耐久性及具体产品参数'} for r in data['sources']]}


class FunnelResearchTests(unittest.TestCase):
    def test_group_suffix_variants_merge_but_locations_and_branches_remain_distinct(self):
        self.assertEqual(company_key('辽宁三友农业生物科技集团有限公司'),company_key('辽宁三友农业生物科技有限公司'))
        self.assertNotEqual(company_key('湖北三友科技有限公司'),company_key('辽宁三友科技有限公司'))
        self.assertNotEqual(company_key('湖北三友科技有限公司'),company_key('湖北三友科技有限公司武汉分公司'))

    def test_stale_client_snapshot_does_not_erase_server_ranked_funnel(self):
        from backend.sync_merge import _merge_map
        result=self.build()
        projects={'p':{'funnel':result,'topic':context()['topic']}}
        merged=_merge_map(projects,{'p':{'funnel':{'companies':[],'ts':9999999999999}}})
        self.assertEqual(len(merged['p']['funnel']['companies']),50)
        self.assertEqual(merged['p']['funnel'],result)

    def build(self,ctx=None,**kwargs):
        return build_funnel(ctx or context(),complete,
            provider=SimpleNamespace(enabled=True,timeout=1),
            retrieve=lambda q,p:(source_rows(),[]),**kwargs)

    def test_multicity_recall_fifty_deduplicated_ranked_source_backed_companies(self):
        for city in ('随州市','闵行区','成都市'):
            with self.subTest(city=city):
                ctx=context(city); result=self.build(ctx)
                self.assertEqual(len(result['companies']),50)
                self.assertEqual(len({c['name'] for c in result['companies']}),50)
                self.assertEqual([c['rank'] for c in result['companies']],list(range(1,51)))
                scores=[c['ranking_score'] for c in result['companies']]
                self.assertEqual(scores,sorted(scores,reverse=True))
                self.assertEqual(result['shortfall'],0)
                self.assertEqual(result['total_scanned'],65)
                self.assertTrue(verified_catalog(result,ctx))
                for company in result['companies']:
                    self.assertIsNone(company['score_relocate'])
                    self.assertIsNone(company['score_strength'])
                    self.assertFalse(company['push_eligible'])

    def test_search_is_nationwide_and_uses_specific_focus_without_private_demand(self):
        ctx=context('闵行区'); ctx.update(selectedPriority={'focus':'隔膜'},
            demandContract='industry-demand-v1',demandSpec={'description':'保密联系人13812345678'},
            sourcePriorityKey='x',demandTitle='隔膜合作')
        calls=[]
        build_funnel(ctx,complete,provider=SimpleNamespace(enabled=True,timeout=1),
            retrieve=lambda q,p:(calls.append(q) or source_rows(),[]))
        self.assertTrue(calls)
        self.assertTrue(all('隔膜' in q and '13812345678' not in q and '闵行' not in q for q in calls))
        queries=search_queries(context(),['凭空扩展企业','隔膜'])
        self.assertTrue(all('凭空扩展' not in q for q in queries))

    def test_signed_web_sources_reject_tampering_and_cross_city_or_demand_replay(self):
        ctx=context();result=self.build(ctx)
        for field,value in [('city','武汉市'),('projectKey','other'),('reportRequestId','r2'),('demandSpec',{'description':'另一项需求'})]:
            changed=dict(ctx,**{field:value})
            self.assertEqual(verified_catalog(result,changed),[])
        broken=copy.deepcopy(result);broken['researchEvidence']['catalog'][0]['quote']+='篡改'
        self.assertEqual(verified_catalog(broken,ctx),[])

    def test_search_failure_is_not_saved_as_empty_success(self):
        with self.assertRaisesRegex(ValueError,'company_originals_unavailable'):
            build_funnel(context(),complete,provider=SimpleNamespace(enabled=True,timeout=1),
                         retrieve=lambda q,p:([],['upstream_failed']))

    def test_malformed_or_hallucinated_company_analysis_fails(self):
        def invalid(*args):
            if args[-1]==700:return {'terms':[]}
            return {'companies':[{'name':'虚构企业','product_quote':'无来源','evidence_ids':['fake']}]}
        with self.assertRaisesRegex(ValueError,'company_candidates_insufficient'):
            build_funnel(context(),invalid,provider=SimpleNamespace(enabled=True,timeout=1),
                         retrieve=lambda q,p:(source_rows(1),[]))

    def test_adjacent_original_lines_preserve_company_product_linkage(self):
        body='甲科技有限公司\n主营产品\n生产液流电池隔膜，提供测试验证服务和产品研发，具体参数需进一步核验。'
        rows=originals_catalog([{'url':'https://official.example/products','text':body}],context()['topic'])
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['quote'],body)
        self.assertFalse(originals_catalog([{'url':'http://127.0.0.1/','text':body}],context()['topic']))

    def test_signed_web_source_survives_individual_manual_review_but_tampering_fails(self):
        state,body,reviews=fixture()
        ctx=project_context(body,state)
        fn=state['PROJECTS']['p']['funnel']
        refs=copy.deepcopy([r for c in fn['companies'] for r in c['evidence']])
        for row in refs:row['id']='web_'+row['id']
        fn['researchEvidence']=seal_catalog(refs,ctx)
        for c in fn['companies']:
            for ref in c['evidence']:ref['id']='web_'+ref['id']
        for r in body['reviews']:r['product']['evidenceId']='web_'+r['product']['evidenceId']
        result=review_and_push(body,state,'admin')
        self.assertTrue(result)
        state2,body2,_=fixture();ctx2=project_context(body2,state2)
        fn2=state2['PROJECTS']['p']['funnel'];fn2['researchEvidence']=seal_catalog(refs,ctx2)
        fn2['companies'][0]['evidence'][0]['id']='web_'+fn2['companies'][0]['evidence'][0]['id']
        fn2['researchEvidence']['catalog'][0]['quote']+='篡改'
        with self.assertRaises(Exception):review_and_push(body2,state2,'admin')


if __name__=='__main__':unittest.main()
