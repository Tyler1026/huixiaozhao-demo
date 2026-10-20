"""Evidence and counterevidence boundaries for useful interactive reports."""
import copy
import hashlib
import json
import unittest
from datetime import date
from unittest.mock import patch

from backend.report_analysis import policy_context, review_priorities
from backend.topic_reports import build_report, evidence_catalog, normalize_plan, TopicReportError


def bundle(rows, topic='生物医药上游耗材国产替代', city='闵行区'):
    sources, evidence = {}, []
    for i, row in enumerate(rows):
        row = dict(row)
        text = row.pop('fulltext', row['quote'])
        source_id = 'source_' + str(i)
        url = row.pop('url', 'https://www.example.gov.cn/source-'+str(i))
        eid = 'tr_' + hashlib.sha256((url+'\0'+row['quote']).encode()).hexdigest()[:20]
        source = dict(id=source_id,url=url,fulltext=text,fulltext_sha256=hashlib.sha256(text.encode()).hexdigest(),
                      source_type=row.get('source_type','government'),retrieval='fetched')
        if row.get('website_attestation'):
            source['website_attestation']=row['website_attestation']
        sources[source_id]=source
        evidence.append(dict(id=eid,source_id=source_id,url=url,status='source',retrieval='fetched',
                             published_at='2026-04-29',**row))
    return dict(status='ready',city=city,topic=topic,sources=sources,evidence=evidence)


def corporate_bundle():
    # Real wording, reduced to the relevant annual-report/product paragraphs.
    b=bundle([
        {'title':'东富龙年度报告：公司信息','source_type':'disclosure','url':'https://static.cninfo.com.cn/annual.PDF',
         'quote':'公司的中文名称 东富龙科技集团股份有限公司\n公司的中文简称 东富龙\n注册地址 上海市闵行区都会路1509号\n公司网址 www.tofflon.com'},
        {'title':'东富龙年度报告：业务','source_type':'disclosure','url':'https://static.cninfo.com.cn/annual.PDF',
         'quote':'本公司生物工艺板块主要产品是一次性无菌袋、培养基类生物试剂、层析填料、滤器等。'},
        {'title':'东富龙一次性无菌袋','source_type':'company','url':'https://www.tofflon.com/api/products?id=584',
         'quote':'一次性生物反应袋作为细胞生长并生成目标产物的直接载体。东富龙采用进口膜材，所有产品均经过完整性测试，两个工厂合计年产85万套生物反应袋的产能。'},
        {'title':'松江生物材料','quote':'乐纯生物已推出完全国产化生物工艺薄膜，实现自主配方、自主生产，为本土生物制药企业提供关键材料。'},
    ])
    identity=b['evidence'][0]['id']
    for value in (b['evidence'][2],b['sources']['source_2']):
        value['website_attestation']={'evidence_id':identity,'domain':'tofflon.com'}
    return b


def skeleton(b):
    return {'basis':[b['evidence'][0]['id']],'chain':[],'companies':[],'priorities':[],'questions':[]}


class ReportAnalysisTests(unittest.TestCase):
    def test_pdf_wrapped_demand_uses_a_view_without_changing_the_archived_quote(self):
        q='生物制药滤器为核心耗材。下游对生物制药滤器有明确的产品\n需求。'
        for extension,expected in [('PDF',1),('html',0)]:
            b=bundle([{'quote':q,'url':'https://www.example.gov.cn/file.'+extension}]);sid=b['evidence'][0]['id'];p=skeleton(b)
            p['priorities']=[{'focus':'生物制药滤器','scope':'industry','demand_ids':[sid],
              'comparison':'仅依据全国行业需求说明应用背景。','reason':'该耗材存在原文披露的需求，本地采购量仍需核实。','action':'核对本地药企的规格与用量。'}]
            old=copy.deepcopy(b);out=normalize_plan(p,b,b)
            self.assertEqual(len(out['analytical_priorities']),expected)
            self.assertEqual(b,old)

    def test_explicit_low_domestic_rate_is_a_benchmark_but_number_alone_is_not(self):
        for q,expected in [('全国生物制药滤器市场国产化率偏低，低于上游整体水平。',1),
                           ('全国生物制药滤器市场国产化率为29.6%，原文列示该指标。',0)]:
            b=bundle([{'quote':q}]);sid=b['evidence'][0]['id'];p=skeleton(b)
            p['priorities']=[{'focus':'生物制药滤器','scope':'industry','constraint_ids':[sid],
              'comparison':'比较全国滤器与整体上游产业的国产化水平。','reason':'仅说明行业比较，不据此判断本地短板。','action':'核实本地实际采购后再判断替代方向。'}]
            self.assertEqual(len(normalize_plan(p,b,b)['analytical_priorities']),expected)

    def test_real_source_reselection_keeps_a_safe_membrane_analysis(self):
        from backend.public_research import enrich_public_research
        b=enrich_public_research({'status':'ready','sources':{},'evidence':[]},'闵行区','生物医药上游耗材国产替代')
        sid='tr_d352a8c49df4fedef999';identity='tr_b67afeefed4cc22f24cf'
        p={'basis':[sid],'companies':[{'name':'东富龙科技集团股份有限公司','product':'生物反应袋','evidence_ids':[sid],'identity_ids':[identity]}],
           'priorities':[{'focus':'一次性无菌袋','scope':'local_enterprise','supply_ids':[sid], 'constraint_ids':[sid],
             'comparison':'产品生产能力与进口原料依赖需区分。','reason':'应先核查原料的具体依赖。','action':'核实替代材料的适配验证要求。'}]}
        corrected={'focus':'膜材','scope':'local_enterprise','supply_ids':[sid],'demand_ids':[],'constraint_ids':[sid],'counter_ids':[],
          'comparison':'按该企业所披露的反应袋生产与输入来源比较，产品已有生产能力，但采用进口膜材；现有材料未给出国产替代验证结果。',
          'reason':'进口膜材是该企业反应袋产品已披露的输入依赖，可优先核实替代材料的适配与验证条件，不代表闵行全区缺少供给。',
          'action':'核实膜材牌号、来源、验证及更换条件，并寻找具备同类产品验证资料的候选供方。'}
        calls=[]
        def complete(system,prompt,budget):
            calls.append(json.loads(prompt))
            if len(calls)==1:return p
            if len(calls)==2:return {'companies':[],'priorities':[corrected]}
            return {'verdicts':[{'index':0,'valid':True,'reason':'依赖对象来自同企业原文，范围限定且无本地缺失推断。'}]}
        # This test isolates evidence reselection; writing/review has its own
        # strict-response integration tests in test_topic_composition.py.
        with patch('backend.topic_reports.compose_report', return_value={
                'status':'limited','chapters':[],'diagnostics':[],'calls':0}):
            out=build_report({'city':'闵行区','topic':b['topic'] if 'topic' in b else '生物医药上游耗材国产替代'},b,2,complete)
        self.assertEqual(len(calls),3)
        self.assertEqual([r['focus'] for r in out['analysis']['priorities']],['膜材'])
        feedback=calls[1]['selection_feedback']['rejected'][0]
        self.assertIn('对象',feedback['reason'])
        self.assertTrue(any('采用进口膜材' in r['analysis_sentence'] for r in feedback['actual_premise_passages']))
        self.assertTrue(all('match_text' in r and 'view' not in r for r in feedback['actual_premise_passages']))
        self.assertEqual(evidence_catalog(b)[sid]['quote'],next(r for r in b['evidence'] if r['id']==sid)['quote'])
        # Exercise the actual whole metadata shape, including rejected-choice
        # diagnostics and source attestations, through authorization + merge.
        from backend.access_control import guard_sync
        from backend.auth import AuthError
        from backend.sync_route import SyncDependencies, handle_sync
        from unittest.mock import Mock
        import io
        topic='生物医药上游耗材国产替代'
        state={'PROJECTS':{'p':{'workspaceId':'p','city':'闵行区','topic':topic}},'REPORTSTATE':{}}
        principal={'scope':'project','projKey':'p','projectKeys':['p'],'user':'member'}
        metadata={'sources':out['sources'],'checks':[],'issues':[],'status':'unreviewed',
            'researchStatus':b['status'],'verificationStatus':'single_source','runId':'fixture-run',
            'queries':[],'errors':[],'analysis':out['analysis'],'publicResearch':b['public_research'],
            'researchCoverage':out['researchCoverage']}
        report={'topic':topic,'phase':2,'ts':100,'text':out['text'],'aiReportByTopic':{topic:out['text']},
            'phaseByTopic':{topic:2},'tsByTopic':{topic:100},'researchByTopic':{topic:metadata}}
        payload={'PROJECTS':copy.deepcopy(state['PROJECTS']),'REPORTSTATE':{'p':report}}
        guarded=guard_sync(json.dumps(payload).encode(),state,principal)
        writes=[];responder=Mock();responder.wfile=io.BytesIO()
        handle_sync(responder,guarded,SyncDependencies(True,lambda:json.dumps(state),
                    lambda value:writes.append(value) or True,'unused',lambda:None,lambda value:value))
        self.assertTrue(json.loads(responder.wfile.getvalue())['ok'])
        saved=json.loads(writes[-1])['REPORTSTATE']['p']['researchByTopic'][topic]
        self.assertEqual(saved,metadata)
        for protected in ('view','auth'):
            invalid=copy.deepcopy(payload)
            invalid['REPORTSTATE']['p']['researchByTopic'][topic]['analysis']['invalid']={protected:'forbidden'}
            with self.subTest(protected=protected),self.assertRaises(AuthError):
                guard_sync(json.dumps(invalid).encode(),state,principal)

    def test_partial_research_with_valid_originals_is_a_disclosed_bounded_result(self):
        b=corporate_bundle();b['status']='pending';b['errors']=[{'code':'research_search_failed','query':'产业政策','message':'公开检索未完成'}]
        b['evidence'][0]['archived']=True;b['sources']['source_0']['archived']=True
        before=copy.deepcopy(b);out=build_report({'city':b['city'],'topic':b['topic']},b,2,lambda *a:skeleton(b))
        self.assertEqual(b,before)
        self.assertFalse(out['researchCoverage']['complete'])
        self.assertEqual(out['researchCoverage']['status'],'pending')
        self.assertIn('不代表完整的产业普查',out['text'])
        self.assertNotIn('本轮检索未完全完成',out['text'])
        self.assertNotIn('归档抓取时间沿用原记录',out['text'])
        self.assertEqual(out['researchCoverage']['errors'],b['errors'])

    def test_partial_research_without_hash_bound_originals_still_fails(self):
        for kind in ['missing_archive','bad_hash']:
            b=bundle([{'quote':'闵行区材料产业资料原文，仅供当前方向的证据核查。'}]);b['status']='pending'
            if kind=='missing_archive':b.pop('sources')
            else:b['sources']['source_0']['fulltext_sha256']='0'*64
            with self.subTest(kind=kind),self.assertRaises(TopicReportError):
                build_report({'city':b['city'],'topic':b['topic']},b,2,lambda *a:skeleton(b))

    def test_one_literal_reselection_preserves_valid_profiles_and_same_catalogue(self):
        b=bundle([{'quote':'甲材料有限公司研发聚变磁体，形成相关产品线。'},
                  {'quote':'乙设备有限公司研发真空腔室，形成相关产品线。'}],topic='聚变能源')
        ids=[r['id'] for r in b['evidence']];p=skeleton(b)
        p['companies']=[{'name':'甲材料有限公司','product':'聚变磁体','evidence_ids':[ids[0]]},
                        {'name':'乙设备有限公司','product':'真空腔室产品','evidence_ids':[ids[1]]}]
        correction={'companies':[{'name':'乙设备有限公司','product':'真空腔室','evidence_ids':[ids[1]]}],'priorities':[]}
        calls=[]
        def complete(system,prompt,budget):
            calls.append(json.loads(prompt))
            if '补充可执行' in system:
                return {'priorities': []}
            return p if len(calls)==1 else correction
        out=build_report({'city':b['city'],'topic':b['topic']},b,2,complete)
        self.assertEqual(len(calls),3)
        self.assertEqual(len(out['analysis']['company_profiles']),2)
        self.assertEqual(calls[0]['evidence'],calls[1]['evidence'])
        self.assertIn('selection_feedback',calls[1])
        self.assertTrue(out['analysis']['selection_diagnostics']['retried'])
        self.assertTrue(out['analysis']['direction_generation']['attempted'])

    def test_reselection_does_not_relax_literal_binding_or_loop(self):
        b=bundle([{'quote':'甲材料有限公司研发聚变磁体，形成相关产品线。'}],topic='聚变能源');p=skeleton(b)
        p['companies']=[{'name':'甲材料有限公司','product':'不存在的产品','evidence_ids':[b['evidence'][0]['id']]}]
        calls=[];out=build_report({'city':b['city'],'topic':b['topic']},b,2,lambda *a:calls.append(a) or p)
        self.assertEqual(len(calls),2)
        self.assertEqual(out['analysis']['company_profiles'],[])

    def test_factory_name_is_an_actual_subject_not_a_reason_to_discard_profile(self):
        b=bundle([{'quote':'储热系统设备：上海锅炉厂承制的冷熔盐罐，已用于该储能项目。'}],topic='氢基能源与长时储能装备补链');p=skeleton(b)
        p['companies']=[{'name':'上海锅炉厂','product':'冷熔盐罐','evidence_ids':[b['evidence'][0]['id']]}]
        out=normalize_plan(p,b,b)
        self.assertEqual(len(out['companies']),1)
        self.assertEqual(out['companies'][0]['scope'],'external_enterprise')

    def test_named_enterprise_export_is_delivery_without_local_factory_claim(self):
        q='3月12日，闵行企业上海氢枫能源技术有限公司首批镁基固态储氢产品从上海外高桥港区四期码头装船完成出口交付，正式发运至马来西亚客户。'
        b=bundle([{'quote':q}],topic='氢基能源与长时储能装备补链');p=skeleton(b)
        p['companies']=[{'name':'上海氢枫能源技术有限公司','product':'镁基固态储氢产品','evidence_ids':[b['evidence'][0]['id']]}]
        r=normalize_plan(p,b,b)['companies'][0]
        self.assertEqual(r['stage'],'已交付/运行');self.assertEqual(r['scope'],'local_enterprise')
        self.assertIn('不据此确认本地工厂',r['scope_label'])

    def test_unique_legal_name_and_its_product_catalogue_can_form_a_profile(self):
        q='随后，一行人来到上海沃兰特航空技术有限公司参观。沃兰特航空是一家专业从事电动垂直起降飞行器研制的高科技公司，其主力产品VE25-100型航空器的技术参数与性能居于行业领先水平。'
        b=bundle([{'quote':q}],topic='低空经济适航与场景服务');p=skeleton(b)
        p['companies']=[{'name':'上海沃兰特航空技术有限公司','product':'VE25-100型航空器','evidence_ids':[b['evidence'][0]['id']]}]
        self.assertEqual(len(normalize_plan(p,b,b)['companies']),1)

    def test_regular_news_does_not_become_policy_due_to_planning_word(self):
        q='企业完成产品出口交付，相关设备已经发运至海外客户。'
        self.assertIsNone(policy_context({'title':'企业出口新进展','quote':q,'source_excerpt':'园区规划面积不断优化。'+q}))

    def test_issuer_identity_cannot_claim_another_subjects_product(self):
        for quote in ['乙材料有限公司生产聚变磁体，已经完成产品研发。',
                      '赛默飞生产聚变磁体，已经完成产品研发。',
                      '本公司主要产品是其他材料。赛默飞生产聚变磁体。',
                      '本公司介绍赛默飞生产聚变磁体，相关工作已经完成。',
                      '本公司的竞争对手赛默飞生产聚变磁体，提供多种产品规格。',
                      '本公司主要产品是其他材料。赛默飞聚变磁体市场份额领先。',
                      '本公司主要产品是其他材料，赛默飞聚变磁体市场份额领先。',
                      '本公司对聚变磁体感兴趣，业务投资方向尚在研究中。',
                      '本公司采购聚变磁体，采购工作已经完成。',
                      '本公司主要产品不包括聚变磁体，仅有其他材料。']:
            with self.subTest(quote=quote):
                b=bundle([{'source_type':'disclosure','url':'https://static.cninfo.com.cn/a.PDF',
                           'quote':'公司名称 甲材料有限公司\n注册地址 上海市闵行区一号路1号'},
                          {'source_type':'disclosure','url':'https://static.cninfo.com.cn/a.PDF','quote':quote}],topic='聚变能源')
                p=skeleton(b);p['companies']=[{'name':'甲材料有限公司','product':'聚变磁体',
                  'evidence_ids':[b['evidence'][1]['id']],'identity_ids':[b['evidence'][0]['id']]}]
                self.assertEqual(normalize_plan(p,b,b)['companies'],[])

    def test_product_stage_does_not_inherit_another_products_delivery(self):
        for quote in ['甲材料有限公司研发聚变磁体，形成相关产品线。该公司的工业水泵已完成交付并正式运行。',
                      '甲材料有限公司研发聚变磁体，工业水泵已完成交付并正式运行。',
                      '甲材料有限公司研发聚变磁体并已交付工业水泵。',
                      '甲材料有限公司研发聚变磁体、生产工业水泵并完成批量交付。',
                      '甲材料有限公司研发聚变磁体。乙科技有限公司的聚变磁体已完成交付。']:
            with self.subTest(quote=quote):
                b=bundle([{'quote':quote}],topic='聚变能源');p=skeleton(b)
                p['companies']=[{'name':'甲材料有限公司','product':'聚变磁体','evidence_ids':[b['evidence'][0]['id']]}]
                profile=normalize_plan(p,b,b)['companies'][0]
                self.assertEqual(profile['stage'],'披露研发/研制业务，成熟度待核')
                self.assertTrue(all('聚变磁体' in c['quote'] and c['quote'] in quote for c in profile['product_claims']))
                self.assertFalse(any(c['stage']=='delivered' for c in profile['product_claims']))

    def test_plain_manufactured_by_does_not_imply_an_unfinished_research_stage(self):
        q='该空气透平由上海汽轮机厂研制，设备已用于投入运行的储能示范项目。'
        b=bundle([{'quote':q}],topic='氢基能源与长时储能装备补链');p=skeleton(b)
        p['companies']=[{'name':'上海汽轮机厂','product':'空气透平','evidence_ids':[b['evidence'][0]['id']]}]
        r=normalize_plan(p,b,b)['companies'][0]
        self.assertEqual(r['stage'],'披露研发/研制业务，成熟度待核')
        self.assertNotEqual(r['stage'],'研发/试验阶段')

    def test_explicit_ongoing_research_remains_a_research_stage(self):
        b=bundle([{'quote':'甲材料有限公司正在研发聚变磁体，相关试验工作按计划推进。'}],topic='聚变能源');p=skeleton(b)
        p['companies']=[{'name':'甲材料有限公司','product':'聚变磁体','evidence_ids':[b['evidence'][0]['id']]}]
        r=normalize_plan(p,b,b)['companies'][0]
        self.assertEqual(r['stage'],'研发/试验阶段')

    def test_exhibition_venue_and_departed_address_are_not_local_identity(self):
        for quote in ['甲材料有限公司研发聚变磁体，并在闵行区参加展会。',
                      '甲材料有限公司研发聚变磁体，注册地址已从闵行区迁往苏州。',
                      '甲材料有限公司研发聚变磁体，总部不在闵行区。',
                      '甲材料有限公司研发聚变磁体。客户总部位于闵行区。',
                      '甲材料有限公司研发聚变磁体，其供应商总部位于闵行区。',
                      '甲材料有限公司研发聚变磁体。合作方办公地址位于闵行区。']:
            with self.subTest(quote=quote):
                b=bundle([{'quote':quote}],topic='聚变能源');p=skeleton(b)
                p['companies']=[{'name':'甲材料有限公司','product':'聚变磁体','evidence_ids':[b['evidence'][0]['id']]}]
                self.assertEqual(normalize_plan(p,b,b)['companies'][0]['scope'],'external_enterprise')

    def test_registered_identity_and_unambiguous_company_pronoun_keep_local_scope(self):
        for quote in ['甲材料有限公司研发聚变磁体。该公司总部位于闵行区。',
                      '甲材料有限公司研发聚变磁体，其总部位于闵行区。']:
            with self.subTest(quote=quote):
                b=bundle([{'quote':quote}],topic='聚变能源');p=skeleton(b)
                p['companies']=[{'name':'甲材料有限公司','product':'聚变磁体','evidence_ids':[b['evidence'][0]['id']]}]
                self.assertEqual(normalize_plan(p,b,b)['companies'][0]['scope'],'local_enterprise')

    def test_real_culture_medium_solved_dependency_is_not_a_current_constraint(self):
        from backend.public_research import enrich_public_research
        b=enrich_public_research({'status':'ready','sources':{},'evidence':[]},'闵行区','生物医药上游耗材国产替代')
        sid='tr_8c77a0bd76c9e341e9a9';p=skeleton(b)
        p['companies']=[{'name':'东富龙科技集团股份有限公司','product':'培养基',
          'evidence_ids':[sid],'identity_ids':['tr_b67afeefed4cc22f24cf']}]
        p['priorities']=[{'focus':'培养基','scope':'local_enterprise','supply_ids':[sid],'constraint_ids':[sid],
          'comparison':'企业培养基仍受进口约束。','reason':'该企业培养基存在进口依赖，建议优先解决。','action':'开展进口替代验证。'}]
        self.assertEqual(normalize_plan(p,b,{'city':'闵行区','topic':'生物医药上游耗材国产替代'})['analytical_priorities'],[])

    def test_conflicting_duplicate_review_indices_never_override_a_rejection(self):
        proposal={'focus':'材料','evidence_ids':[]}
        replies={'verdicts':[{'index':0,'valid':False,'reason':'存在实际反证。'},
                             {'index':0,'valid':True,'reason':'仍可采用该分析。'}]}
        accepted,diagnostics=review_priorities([proposal],{}, {},lambda *a:replies)
        self.assertEqual(accepted,[])
        self.assertIn('重复序号',diagnostics[0]['reason'])

    def test_real_archived_product_profiles_keep_capacity_distinct_from_output(self):
        from backend.public_research import enrich_public_research
        b=enrich_public_research({'status':'ready','sources':{},'evidence':[]},'闵行区','生物医药上游耗材国产替代')
        rows=[('一次性无菌袋','tr_417122a2f06affeac575'),('生物反应袋','tr_d352a8c49df4fedef999'),('培养基','tr_8c77a0bd76c9e341e9a9')]
        p={'basis':[rows[0][1]],'companies':[{'name':'东富龙科技集团股份有限公司','product':product,
          'evidence_ids':[eid],'identity_ids':['tr_b67afeefed4cc22f24cf']} for product,eid in rows]}
        out=normalize_plan(p,b,{'city':'闵行区','topic':'生物医药上游耗材国产替代'})
        self.assertEqual(len(out['companies']),3)
        self.assertEqual(out['companies'][1]['stage'],'已披露生产/供货能力，实际产量待核')
        self.assertEqual(out['companies'][2]['stage'],'已披露生产/供货能力，实际产量待核')
        self.assertTrue(all(r['scope']=='local_enterprise' for r in out['companies']))
        self.assertTrue(all('不据此确认本地工厂' in r['scope_label'] for r in out['companies']))

    def test_an_unrelated_local_identity_cannot_localize_a_company(self):
        b=bundle([{'quote':'甲材料有限公司研发聚变磁体，提供聚变装置所需的高温超导产品。'},
                  {'quote':'乙科技有限公司注册地址位于上海闵行区，主营汽车零部件及其他设备。'}],topic='聚变能源')
        p=skeleton(b);p['companies']=[{'name':'甲材料有限公司','product':'聚变磁体',
          'evidence_ids':[b['evidence'][0]['id']],'identity_ids':[b['evidence'][1]['id']]}]
        profile=normalize_plan(p,b,b)['companies'][0]
        self.assertEqual(profile['scope'],'external_enterprise')
        self.assertEqual(profile['identity_ids'],[])
        b['evidence'][1]['quote']='中国甲材料有限公司注册地址位于上海闵行区，主营汽车零部件及其他设备。'
        b['sources']['source_1']['fulltext']=b['evidence'][1]['quote']
        b['sources']['source_1']['fulltext_sha256']=hashlib.sha256(b['evidence'][1]['quote'].encode()).hexdigest()
        self.assertEqual(normalize_plan(p,b,b)['companies'][0]['scope'],'external_enterprise')

    def test_ambiguous_filing_with_multiple_issuers_cannot_bind_pronoun_products(self):
        b=corporate_bundle();b['evidence'][0]['quote']+='\n公司名称 其他科技股份有限公司'
        b['sources']['source_0']['fulltext']=b['evidence'][0]['quote']
        b['sources']['source_0']['fulltext_sha256']=hashlib.sha256(b['evidence'][0]['quote'].encode()).hexdigest()
        p=skeleton(b);p['companies']=[{'name':'东富龙科技集团股份有限公司','product':'一次性无菌袋',
          'evidence_ids':[b['evidence'][1]['id']],'identity_ids':[b['evidence'][0]['id']]}]
        self.assertEqual(normalize_plan(p,b,b)['companies'],[])

    def test_real_filing_and_attested_website_form_scoped_product_profile(self):
        b=corporate_bundle();p=skeleton(b)
        p['companies']=[{'name':'东富龙科技集团股份有限公司','product':'一次性无菌袋',
                         'evidence_ids':[b['evidence'][1]['id']], 'identity_ids':[b['evidence'][0]['id']]}]
        out=build_report({'city':b['city'],'topic':b['topic']},b,2,lambda *a:p)
        profile=out['analysis']['company_profiles'][0]
        self.assertEqual(profile['scope'],'local_enterprise')
        self.assertEqual(profile['relationship'],'same_issuer_disclosure')
        self.assertIn('不据此确认本地工厂',out['text'])
        self.assertIn('披露产品业务，产销规模待核',out['text'])
        self.assertNotIn('闵行工厂年产85万',out['text'])

    def test_other_company_products_and_false_filing_identity_are_rejected(self):
        b=corporate_bundle();p=skeleton(b)
        p['companies']=[{'name':'甲生物有限公司','product':'一次性无菌袋',
                         'evidence_ids':[b['evidence'][1]['id']], 'identity_ids':[b['evidence'][0]['id']]}]
        self.assertEqual(normalize_plan(p,b,b)['companies'],[])
        # A sibling company's capability at another URL is not an issuer join.
        b['evidence'][1]['url']='https://static.cninfo.com.cn/another.PDF'
        b['sources']['source_1']['url']=b['evidence'][1]['url']
        p['companies'][0]['name']='东富龙科技集团股份有限公司'
        self.assertEqual(normalize_plan(p,b,b)['companies'],[])

    def test_unique_actor_completed_facility_is_a_profile_not_a_production_claim(self):
        b=bundle([{'quote':'来自闵行的上海穹窿科技有限公司CEO介绍，公司建成卫星激光通信终端产线，具体年产量未披露。'}],topic='商业火箭卫星配套')
        p=skeleton(b);p['companies']=[{'name':'上海穹窿科技有限公司','product':'卫星激光通信终端','evidence_ids':[b['evidence'][0]['id']]}]
        self.assertEqual(len(normalize_plan(p,b,b)['companies']),1)

    def test_compared_dependency_is_reviewed_with_domestic_counterevidence(self):
        b=corporate_bundle();ids=[r['id'] for r in b['evidence']];p=skeleton(b)
        p['companies']=[{'name':'东富龙科技集团股份有限公司','product':'生物反应袋','evidence_ids':[ids[2]],'identity_ids':[ids[0]]}]
        p['priorities']=[{'focus':'膜材','scope':'local_enterprise','supply_ids':[ids[2]],'demand_ids':[],
                         'constraint_ids':[ids[2]],'counter_ids':[ids[3]],
                         'comparison':'比较企业进口膜材依赖与国内已披露的同类膜材供给，二者尚无采购验证关系。',
                         'reason':'该企业原料存在外购依赖，国内同类产品可作为替代验证线索，不能断言已经替代。',
                         'action':'核对膜材规格、相容性和客户变更验证要求，再组织材料供方对接。'}]
        calls=[]
        def complete(system, prompt, budget):
            calls.append((system,json.loads(prompt)))
            return p if len(calls)==1 else {'verdicts':[{'index':0,'valid':True,'reason':'引用包含企业原料依赖及国内反证，范围限定正确。'}]}
        out=build_report({'city':b['city'],'topic':b['topic']},b,2,complete)
        self.assertEqual(len(out['analysis']['priorities']),1)
        self.assertEqual(out['analysis']['priorities'][0]['state'],'reviewed_inference')
        self.assertIn(b['evidence'][3]['quote'],out['text'])
        self.assertIn('不能断言已经替代',out['text'])
        reviewed={r['id'] for r in calls[1][1]['sources']}
        self.assertTrue(set(ids).issubset(reviewed))

    def test_national_rate_does_not_establish_local_enterprise_import_dependence(self):
        b=corporate_bundle();ids=[r['id'] for r in b['evidence']]
        b['evidence'][3]['quote']='我国生物制药膜材市场国产化率较低，仍依赖进口，缺少本地企业采购数据。'
        b['sources']['source_3']['fulltext']=b['evidence'][3]['quote']
        b['sources']['source_3']['fulltext_sha256']=hashlib.sha256(b['evidence'][3]['quote'].encode()).hexdigest()
        p=skeleton(b);p['companies']=[{'name':'东富龙科技集团股份有限公司','product':'一次性无菌袋','evidence_ids':[ids[1]],'identity_ids':[ids[0]]}]
        p['priorities']=[{'focus':'膜材','scope':'local_enterprise','supply_ids':[ids[1]],'constraint_ids':[ids[3]],
                         'comparison':'本地企业进口膜材依赖很高。','reason':'全国国产化率低意味着本地企业依赖进口。','action':'组织替代。'}]
        self.assertEqual(normalize_plan(p,b,b)['analytical_priorities'],[])

    def test_new_unquoted_number_and_policy_only_priority_are_rejected(self):
        b=bundle([{'title':'生物医药行动计划','quote':'鼓励发展生物制药膜材，推动产业链补链，支持企业研发和规模化生产。'}]);sid=b['evidence'][0]['id'];p=skeleton(b)
        p['priorities']=[{'focus':'膜材','scope':'local','constraint_ids':[sid],
                         'reason':'产业缺口达90%。','comparison':'对比国外成熟产业。','action':'承诺采购。'}]
        self.assertEqual(normalize_plan(p,b,b)['analytical_priorities'],[])

    def test_constraint_cannot_move_from_bags_to_reaction_systems(self):
        b=corporate_bundle();p=skeleton(b);ids=[r['id'] for r in b['evidence']]
        p['priorities']=[{'focus':'一次性反应系统','scope':'local_enterprise','supply_ids':[ids[1]],
          'constraint_ids':[ids[2]],'comparison':'系统与膜材供给之间有差异。','reason':'系统因此依赖进口。','action':'联系供方开展替代。'}]
        self.assertEqual(normalize_plan(p,b,b)['analytical_priorities'],[])

    def test_plan_denial_and_successful_substitution_are_not_actual_constraints(self):
        for quote in ['目前计划解决膜材进口依赖，推动生物制药产业升级。',
                      '膜材已实现进口替代，产品的自主供应能力得到提升。',
                      '膜材不再依赖进口，经过验证已实现稳定供应。']:
            with self.subTest(quote=quote):
                b=bundle([{'quote':quote}]);sid=b['evidence'][0]['id'];p=skeleton(b)
                p['priorities']=[{'focus':'膜材','scope':'industry','constraint_ids':[sid],
                  'comparison':'进口产品与国产材料存在差异。','reason':'仍存在进口依赖。','action':'优先开展材料替代验证。'}]
                self.assertEqual(normalize_plan(p,b,b)['analytical_priorities'],[])

    def test_actual_maturity_constraint_is_not_lost_as_a_negated_operation(self):
        b=bundle([{'quote':'聚变发电尚未实现商业化，装置目前仍处于工程验证阶段。'}],topic='聚变能源');sid=b['evidence'][0]['id'];p=skeleton(b)
        p['priorities']=[{'focus':'聚变发电','scope':'industry','constraint_ids':[sid],
          'comparison':'工程验证与商业运营有阶段差异。','reason':'仅能研判共性工程成熟度，不能据此认定本地供给缺口。','action':'跟踪装置工程验证进展。'}]
        self.assertEqual(len(normalize_plan(p,b,b)['analytical_priorities']),1)

    def test_invalid_review_never_publishes_analysis_but_preserves_facts(self):
        b=bundle([{'quote':'闵行区目前膜材供应不足，生物制药企业存在持续采购需求。'}]);sid=b['evidence'][0]['id'];p=skeleton(b)
        p['priorities']=[{'focus':'膜材','scope':'local','demand_ids':[sid],'constraint_ids':[sid],
                         'reason':'该环节有直接本地供需约束，应优先开展供应商对接。','comparison':'比较当前本地供应与持续采购需求，未给出同口径数量。','action':'访谈需求方确认规格与用量，收集供方交付记录。'}]
        replies=iter([p,{'verdicts':[{'index':0,'valid':False,'reason':'仍缺少可以比较的实际需求量。'}]}])
        out=build_report({'city':b['city'],'topic':b['topic']},b,2,lambda *a:next(replies))
        self.assertEqual(out['analysis']['priorities'],[])
        self.assertIn(b['evidence'][0]['quote'],out['text'])
        self.assertNotIn('该环节有直接本地供需约束，应优先',out['text'])

    def test_draft_and_full_policy_conditions_are_shown_without_current_validity_guess(self):
        q='采购双方应无投资等关联，按实际采购金额的10%比例支持，每年最高1000万元。'
        full='本细则适用于本区企业。\n申报条件\n采购产业链上游产品和服务的企业。\n'+q+'\n3.申报材料\n采购合同及付款凭证。\n无关联证明。\n本意见自2025年7月1日起施行，有效期至2030年6月30日，同一项目不得重复享受。'
        b=bundle([{'title':'生物医药支持政策（征求意见稿）','quote':q,'fulltext':full}]);p=skeleton(b)
        out=build_report({'city':b['city'],'topic':b['topic']},b,1,lambda *a:p)
        self.assertIn('征求意见/草案，不能作为现行兑现依据',out['text'])
        self.assertIn('2030年6月30日',out['text'])
        self.assertIn('采购合同及付款凭证',out['text'])
        self.assertNotIn('已生效',out['text'])

    def test_adjacent_policy_requirements_do_not_leak_into_current_subsection(self):
        q='采购双方应无投资等关联，按实际采购金额的10%比例给予支持，每年最高1000万元。'
        full='生物医药实施细则\n（八）重大项目\n1.申报条件\n获得重大项目支持的企业。\n2.支持标准\n按项目给予支持。\n3.申报材料\n重大项目立项材料。\n（九）采购\n1.申报条件\n采购产业链上游产品和服务的企业。\n2.支持标准\n'+q+'\n3.申报材料\n（1）采购合同及付款凭证。\n（2）无关联证明。\n（十）其他项目\n1.申报条件\n建设其他平台的企业。\n本细则自2021年10月31日起施行，有效期至2024年10月30日。'
        r=policy_context({'title':'政府网站','quote':q,'source_excerpt':full},as_of=date(2026,10,17))
        conditions='\n'.join(r['conditions'])
        self.assertIn('采购合同及付款凭证',conditions)
        self.assertIn('采购产业链上游',conditions)
        self.assertNotIn('重大项目立项',conditions)
        self.assertNotIn('建设其他平台',conditions)
        self.assertEqual(r['status'],'expired')

    def test_different_research_projects_applicability_never_leaks_into_conditions(self):
        q='研究内容：研究阻氚涂层的长期服役可靠性，研制耐蚀阻氚涂层材料，开展性能评价。'
        full=q+'\n\n'+'通用目录说明。'*100+'\n另一航空材料适用于700K高温环境和5dB噪声控制。\n另一医用材料适用于冠心病支架。'
        result=policy_context({'title':'科技项目申报指南','quote':q,'source_excerpt':full})
        self.assertFalse(any('700K' in x or '冠心病' in x for x in result['conditions']))

    def test_forged_archive_cannot_enter_report_catalog(self):
        b=corporate_bundle();b['sources']['source_0']['fulltext']+='篡改'
        self.assertNotIn(b['evidence'][0]['id'],evidence_catalog(b))

    def test_verified_original_hash_is_projected_over_any_row_hash(self):
        b=corporate_bundle();row=b['evidence'][0]
        row['fulltext_sha256']='0'*64
        projected=evidence_catalog(b)[row['id']]
        self.assertEqual(projected['fulltext_sha256'],b['sources'][row['source_id']]['fulltext_sha256'])


if __name__=='__main__':unittest.main()
