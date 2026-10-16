"""Offline local-scope and fact-polarity boundaries for chain assessments."""
import copy
import hashlib
import json
import unittest

from backend.chain_assessment import build_assessment, unavailable_assessment
from report_service.full_contract import canonical_url

CONTEXT = {'city': '闵行区', 'topic': '商业火箭卫星配套本地化补链'}
CHAIN = {'chain': [{'seg':'上游', 'nodes':[{'id':'n-control', 'name':'飞控系统', 'level':'unknown'}]},
                   {'seg':'中游', 'nodes':[{'id':'n-assembly', 'name':'卫星总装测试', 'level':'unknown'}]},
                   {'seg':'下游', 'nodes':[]}], 'unclassified':[]}


def digest(text): return hashlib.sha256(text.encode()).hexdigest()


def research(quotes, titles=None, dates=None, origins=None):
    result = {'status':'ready', 'city':CONTEXT['city'], 'topic':CONTEXT['topic'], 'evidence':[], 'sources':{}}
    for i, quote in enumerate(quotes):
        url = f'https://www.shanghai.gov.cn/assessment/source-{i}.html'
        source_id = 'source_'+digest(canonical_url(url)+'\0'+quote)[:20]
        meta = {'url':url, 'title':titles[i] if titles else '产业调研资料',
                'published_at':dates[i] if dates else '2025-10-01', 'retrieved_at':'2026-10-16',
                'retrieval':'fetched', 'source_type':'government', 'status':'source',
                'origin_id':origins[i] if origins else 'origin_'+digest(quote)[:20],
                'publisher_id':'shanghai.gov.cn'}
        result['sources'][source_id] = dict(meta, id=source_id, fulltext=quote, fulltext_sha256=digest(quote))
        result['evidence'].append(dict(meta, id='tr_'+digest(url+'\0'+quote)[:20], source_id=source_id, quote=quote))
    return result


def selected(bundle, index=0, target='n-control', dimension='supply', kind='gap', quote=None, **extra):
    row = bundle['evidence'][index]
    return dict(target_id=target, dimension=dimension, kind=kind, evidence_id=row['id'],
                quote=row['quote'] if quote is None else quote, scope_label='模型任意声称的城市', **extra)


def assess(bundle, rows):
    return build_assessment(CONTEXT, bundle, CHAIN, lambda *args: {'findings':rows})


class LocalAssessmentTests(unittest.TestCase):
    def test_real_minhang_rocket_supply_and_coordination_diagnosis_is_chain_only(self):
        quote='闵行已集聚航天航空“国家队”龙头企业，初步形成研发、制造、运维全链条布局，但仍存在产业市场竞争力需不断提升、产业链上下游协同机制有待加强、市场应用场景有待进一步培育、产业链基础设施建设有待加快等问题。据此，九三学社区委提交了《关于加快推进闵行航空产业高质量发展的建议》，其中提到“链衔接较松散、配套能力不足、融合度不高”等。'
        bundle=research([quote],titles=['竞逐空天新赛道，闵行如何强链引链补链？他们展开了头脑风暴……'])
        out=assess(bundle,[selected(bundle,target='chain',dimension='supply'),selected(bundle,target='chain',dimension='coordination')])
        dims={row['key']:row['level'] for row in out['assessment']['dimensions']}
        self.assertEqual(dims['supply'],'attention')
        self.assertEqual(dims['coordination'],'attention')
        self.assertTrue(all(node['level']=='unknown' for node in out['node_assessments'].values()))
        self.assertTrue(all(f['scope_label']=='闵行区' for f in out['assessment']['findings']))

    def test_real_bio_title_scope_and_midstage_resource_diagnosis_remain_chain_only(self):
        quote='然而，产业发展并不能一帆风顺。创新主体能力不足、供需对接机制不畅、中试资源与人才短缺等问题，成为制约产业进一步发展的瓶颈。对此，政协委员们立足实际，提出了一系列针对性建议。'
        bundle=research([quote],titles=['从现状剖析到落地行动，多方智慧共绘闵行生物医药新蓝图'])
        context={'city':'闵行区','topic':'生物医药上游耗材国产替代招引'}
        bundle['topic']=context['topic']
        result={'chain':[{'seg':'上游','nodes':[{'id':'n-bio','name':'生物反应器','level':'unknown'}]}]}
        rows=[selected(bundle,target='chain',dimension='capacity'),selected(bundle,target='chain',dimension='coordination')]
        out=build_assessment(context,bundle,result,lambda *args:{'findings':rows})
        dims={row['key']:row['level'] for row in out['assessment']['dimensions']}
        self.assertEqual(dims['capacity'],'attention')
        self.assertEqual(dims['coordination'],'attention')
        self.assertEqual(out['node_assessments']['n-bio']['level'],'unknown')
        self.assertTrue(all(f['quote']==quote for f in out['assessment']['findings']))

    def test_real_low_altitude_common_validation_risk_and_launch_do_not_prove_local_gap_or_capacity(self):
        quote='低空经济腾飞的最大瓶颈之一，在于城市核心区缺乏安全可靠的飞行验证环境。闵行低空测试基地的正式启动，正是破解这一世界级难题的“闵行答案”，标志着上海低空基础设施布局从政策设计迈向实质性建设。'
        bundle=research([quote],titles=['位于吴泾！闵行低空测试基地项目启动'])
        context={'city':'闵行区','topic':'低空经济整机配套承接集聚'}
        bundle['topic']=context['topic']
        result={'chain':[{'seg':'中游','nodes':[{'id':'n-base','name':'低空测试基地','level':'unknown'}]}]}
        rows=[selected(bundle,target='chain',dimension='capacity'),selected(bundle,target='n-base',dimension='capacity',kind='capability')]
        out=build_assessment(context,bundle,result,lambda *args:{'findings':rows})
        self.assertEqual(out['assessment']['level'],'unknown')
        self.assertEqual(out['node_assessments']['n-base']['level'],'unknown')
        self.assertTrue(any(f['scope']=='industry' and f['kind']=='context' for f in out['assessment']['findings']))
        self.assertFalse(any(f['kind'] in ('gap','capability') for f in out['assessment']['findings']))

    def test_bare_shortboard_is_not_supply_and_future_strengthening_is_not_current_coordination_gap(self):
        bundle=research(['闵行区产业宣传存在短板，需要进一步研究传播渠道。'])
        self.assertEqual(assess(bundle,[selected(bundle,target='chain')])['assessment']['level'],'unknown')
        bundle=research(['闵行区计划加强飞控系统上下游协同，具体实施安排另行公布。'])
        self.assertEqual(assess(bundle,[selected(bundle,dimension='coordination')])['assessment']['level'],'unknown')

    def test_clear_local_severe_and_moderate_gaps_have_controlled_labels(self):
        for degree, expected, severity in [('严重', 'weak', 'high'), ('', 'attention', 'moderate')]:
            with self.subTest(degree=degree):
                bundle = research([f'闵行区飞控系统本地供应{degree}不足，相关情况由主管部门在调查资料中披露。'])
                out = assess(bundle, [selected(bundle)])
                node = out['node_assessments']['n-control']
                self.assertEqual(node['level'], expected)
                self.assertEqual(node['findings'][0]['severity'], severity)
                self.assertEqual(node['findings'][0]['scope'], 'local')
                self.assertEqual(node['findings'][0]['scope_label'], '闵行区')
                self.assertEqual(out['assessment']['level'], expected)

    def test_four_dimensions_are_separate_and_no_baseline_score_exists(self):
        quotes = ['闵行区飞控系统目前主要依赖进口，供应来源由本区调查资料说明。',
                  '闵行区飞控系统目前实际产能不足，难以满足现有订单需求。',
                  '闵行区飞控系统目前上下游协同不畅，测试认证周期过长。']
        bundle = research(quotes)
        rows = [selected(bundle, i, dimension=dim) for i, dim in enumerate(('dependency','capacity','coordination'))]
        out = assess(bundle, rows)['node_assessments']['n-control']
        dims = {d['key']:d for d in out['dimensions']}
        self.assertEqual(dims['supply']['level'], 'unknown')
        for dim in ('dependency','capacity','coordination'): self.assertEqual(dims[dim]['level'], 'attention')
        self.assertNotIn('score', json.dumps(out))

    def test_national_and_other_city_data_never_rate_local_weakness(self):
        for quote in ['全国飞控系统供应严重不足，国内产业调查已经记录相关问题。',
                      '苏州市飞控系统供应严重不足，当地主管部门披露相关产业情况。',
                      '上海市飞控系统供应严重不足，相关数据为全市统计并未分区。']:
            with self.subTest(quote=quote):
                bundle = research([quote], titles=['闵行区产业发展资料'])
                node = assess(bundle, [selected(bundle)])['node_assessments']['n-control']
                self.assertEqual(node['level'], 'unknown')
                self.assertTrue(all(f['kind']=='context' and f['scope']=='industry' for f in node['findings']))

    def test_title_scope_requires_explicit_local_context(self):
        for quote, level in [('本区飞控系统供应严重不足，资料披露了具体的供需调查口径。', 'weak'),
                             ('飞控系统供应严重不足，行业研究资料披露了具体调查口径。', 'unknown')]:
            bundle = research([quote], titles=['闵行区产业调研资料'])
            self.assertEqual(assess(bundle,[selected(bundle)])['node_assessments']['n-control']['level'], level)

    def test_a_city_in_an_unrelated_sentence_cannot_reassign_explicit_foreign_problem(self):
        bundle = research(['闵行区开展产业调研。苏州市飞控系统供应严重不足，情况由当地行业调查记录。'])
        self.assertEqual(assess(bundle,[selected(bundle)])['node_assessments']['n-control']['level'], 'unknown')

    def test_office_address_cannot_establish_local_mass_production(self):
        bundle = research(['某公司在苏州生产基地已实现飞控系统量产，注册地址为闵行区。'])
        node = assess(bundle,[selected(bundle,dimension='capacity',kind='capability')])['node_assessments']['n-control']
        self.assertEqual(node['level'], 'unknown')

    def test_company_name_or_inspection_context_does_not_establish_local_factory(self):
        for quote in ['闵行区甲公司已实现飞控系统量产，未注明该产品的生产地点。',
                      '闵行区政府考察苏州基地。该基地飞控系统产能严重不足，影响生产。']:
            bundle=research([quote])
            node=assess(bundle,[selected(bundle,dimension='capacity',kind='capability')])['node_assessments']['n-control']
            self.assertEqual(node['level'],'unknown')

    def test_whole_chain_diagnosis_is_not_copied_to_nodes(self):
        bundle = research(['闵行区产业链总体配套供应严重不足，相关调查记录了整体产业基础问题。'])
        out = assess(bundle,[selected(bundle,target='chain')])
        self.assertEqual(out['assessment']['level'], 'weak')
        self.assertTrue(all(a['level']=='unknown' for a in out['node_assessments'].values()))
        self.assertEqual(assess(bundle,[selected(bundle,target='n-control')])['node_assessments']['n-control']['findings'], [])

    def test_another_node_problem_in_same_paragraph_is_not_transferred(self):
        bundle = research(['闵行区飞控系统已实现量产。卫星总装测试的本地供应严重不足。'])
        node = assess(bundle,[selected(bundle)])['node_assessments']['n-control']
        self.assertEqual(node['level'], 'unknown')
        self.assertFalse(any(f['kind']=='gap' for f in node['findings']))


class ModalityAssessmentTests(unittest.TestCase):
    def test_planned_remedy_does_not_prove_real_gap(self):
        bundle = research(['闵行区计划补齐飞控系统供应短板，具体项目和需求还需进一步研究。'])
        node = assess(bundle,[selected(bundle)])['node_assessments']['n-control']
        self.assertEqual(node['level'], 'unknown')
        self.assertEqual(node['findings'][0]['kind'], 'plan')

    def test_parent_goal_governs_later_apparent_capacity(self):
        quote = '到2027年，闵行区力争形成完整产业体系。飞控系统产能将满足本地需求，达到相关设计目标。'
        bundle = research([quote])
        node = assess(bundle,[selected(bundle,dimension='capacity',kind='capability')])['node_assessments']['n-control']
        self.assertEqual(node['level'], 'unknown')
        self.assertTrue(all(f['kind']=='plan' for f in node['findings']))

    def test_denial_conditional_and_unknown_are_not_gaps(self):
        quotes = ['闵行区飞控系统并非供应严重不足，行业调查没有发现所传问题。',
                  '如果闵行区飞控系统供应严重不足，则需要采取新的供给措施。',
                  '闵行区飞控系统可能供应严重不足，具体供需数据仍有待核实。',
                  '闵行区飞控系统未披露本地供给数据，不能判定是否供应不足。',
                  '闵行区飞控系统没有供应短板，调查资料对此作出明确说明。']
        for quote in quotes:
            with self.subTest(quote=quote):
                bundle=research([quote])
                node=assess(bundle,[selected(bundle)])['node_assessments']['n-control']
                self.assertEqual(node['level'],'unknown')
                self.assertFalse(any(f['kind']=='gap' for f in node['findings']))

    def test_comma_separated_qualifiers_and_resolved_shortage_do_not_rate_gap(self):
        for quote in ['据称，闵行区飞控系统供应严重不足。',
                      '如果需求上升，闵行区飞控系统供应严重不足。',
                      '闵行区飞控系统并无供应不足问题，调查结果已经公布。',
                      '闵行区飞控系统已解决供应不足问题，相关数据另行公布。']:
            bundle=research([quote])
            node=assess(bundle,[selected(bundle)])['node_assessments']['n-control']
            self.assertEqual(node['level'],'unknown')
        bundle=research(['未来，闵行区飞控系统供应不足问题将成为研究重点。'])
        node=assess(bundle,[selected(bundle)])['node_assessments']['n-control']
        self.assertEqual(node['level'],'unknown')
        self.assertEqual(node['findings'][0]['kind'],'plan')

    def test_dependency_percentage_alone_has_no_arbitrary_risk_threshold(self):
        bundle=research(['闵行区飞控系统进口依赖率已下降至5%，资料保留本地统计口径。'])
        node=assess(bundle,[selected(bundle,dimension='dependency')])['node_assessments']['n-control']
        self.assertEqual(node['level'],'unknown')

    def test_fragment_cannot_drop_preceding_denial(self):
        bundle=research(['闵行区飞控系统并非供应严重不足，行业调查没有发现所传问题。'])
        node=assess(bundle,[selected(bundle,quote='供应严重不足')])['node_assessments']['n-control']
        self.assertEqual(node['findings'],[])
        self.assertEqual(node['level'],'unknown')

    def test_selected_sentence_still_inherits_full_paragraph_plan(self):
        sentence='闵行区飞控系统供应不足问题将得到研究。'
        bundle=research(['到2027年，计划建立新型供给体系。'+sentence])
        node=assess(bundle,[selected(bundle,quote=sentence)])['node_assessments']['n-control']
        self.assertEqual(node['findings'][0]['kind'],'plan')
        self.assertEqual(node['findings'][0]['quote'],bundle['evidence'][0]['quote'])

    def test_capability_does_not_cancel_gap_and_construction_is_not_mass_production(self):
        bundle=research(['闵行区飞控系统目前供应严重不足。飞控系统已实现量产，供给规模由相关资料记录。'])
        out=assess(bundle,[selected(bundle),selected(bundle,dimension='capacity',kind='capability')])
        node=out['node_assessments']['n-control']
        self.assertEqual(node['level'],'weak')
        self.assertEqual({f['kind'] for f in node['findings']},{'gap','capability'})
        dimensions={x['key']:x['level'] for x in node['dimensions']}
        self.assertEqual(dimensions['capacity'],'supported')
        self.assertEqual(dimensions['supply'],'weak')
        construction=research(['闵行区飞控系统项目已启动建设，规划产能仍需后续建成投产。'])
        result=assess(construction,[selected(construction,dimension='capacity',kind='capability')])
        self.assertEqual(result['node_assessments']['n-control']['level'],'unknown')

    def test_source_date_is_retained_without_claiming_current_condition(self):
        bundle=research(['闵行区飞控系统供应严重不足，调查材料保留了相关时期的供需口径。'],dates=['2025-01-01'])
        node=assess(bundle,[selected(bundle)])['node_assessments']['n-control']
        self.assertEqual(node['findings'][0]['published_at'],'2025-01-01')
        self.assertEqual(node['findings'][0]['source']['published_at'],'2025-01-01')
        self.assertIn('来源时期',node['summary'])
        self.assertTrue(any('历史披露' in check for check in node['next_checks']))


class IntegrityAssessmentTests(unittest.TestCase):
    def test_mirror_origin_is_single_source_and_different_origins_are_multiple(self):
        quotes=['闵行区飞控系统供应严重不足，原始调研资料记录本地供需口径。',
                '闵行区飞控系统供应严重不足，另一份材料记录了相同产业问题。']
        for origins, expected in [(['origin-1','origin-1'],'single_source'),(['origin-1','origin-2'],'multiple_sources')]:
            bundle=research(quotes,origins=origins)
            node=assess(bundle,[selected(bundle,0),selected(bundle,1)])['node_assessments']['n-control']
            self.assertEqual(node['evidence_strength'],expected)
            self.assertNotIn('cross_checked',json.dumps(node))

    def test_forged_model_score_severity_scope_and_summary_are_ignored(self):
        bundle=research(['全国飞控系统供应不足，相关数据来自全国行业调查并非本地统计。'])
        row=selected(bundle,score=100,severity='high',summary='本地极弱',level='weak')
        out=assess(bundle,[row])
        self.assertEqual(out['node_assessments']['n-control']['level'],'unknown')
        self.assertNotIn('模型任意声称的城市',json.dumps(out,ensure_ascii=False))
        self.assertNotIn('本地极弱',json.dumps(out,ensure_ascii=False))
        self.assertNotIn('score',out['assessment'])

    def test_forged_id_hash_url_or_missing_archive_cannot_rate(self):
        for change in ('id','hash','url','archive'):
            bundle=research(['闵行区飞控系统供应严重不足，相关调查已记录具体材料口径。'])
            row=selected(bundle)
            if change=='id': row['evidence_id']='tr_'+'0'*20
            elif change=='hash': next(iter(bundle['sources'].values()))['fulltext_sha256']='0'*64
            elif change=='url': bundle['evidence'][0]['url']='https://www.shanghai.gov.cn/forged'
            else: bundle['sources']={}
            out=assess(bundle,[row])
            self.assertEqual(out['assessment']['level'],'unknown')
            self.assertEqual(out['sources'],[])

    def test_empty_selection_returns_unknown_with_specific_next_checks(self):
        bundle=research(['闵行区开展飞控系统产业调研，相关供需事实有待后续材料说明。'])
        out=assess(bundle,[])
        self.assertEqual(out['assessment']['state'],'ready')
        self.assertEqual(out['assessment']['level'],'unknown')
        self.assertEqual(len(out['assessment']['dimensions']),4)
        self.assertEqual(len(out['assessment']['next_checks']),4)
        self.assertTrue(all(d['level']=='unknown' for d in out['assessment']['dimensions']))

    def test_model_failure_or_malformed_output_is_nonfatal_and_sanitized(self):
        bundle=research(['闵行区飞控系统供应严重不足，相关资料保留原始调查口径。'])
        for answer in (None,'not-json',{'findings':'invalid'},RuntimeError('SECRET_TOKEN')):
            def complete(*args):
                if isinstance(answer,Exception): raise answer
                return answer
            out=build_assessment(CONTEXT,bundle,CHAIN,complete)
            self.assertEqual(out['assessment']['state'],'unavailable')
            self.assertEqual(out['assessment']['level'],'unknown')
            self.assertNotIn('SECRET_TOKEN',json.dumps(out))
            self.assertTrue(all(a['state']=='unavailable' for a in out['node_assessments'].values()))

    def test_public_unavailable_helper_has_full_contract(self):
        result=unavailable_assessment(CONTEXT)
        self.assertEqual(result['contract'],'chain-assessment-v1')
        self.assertEqual(result['state'],'unavailable')
        self.assertEqual(result['level'],'unknown')
        self.assertEqual(result['evidence_strength'],'insufficient')
        self.assertEqual(len(result['dimensions']),4)

    def test_prompt_does_not_expose_private_material_or_accept_scores(self):
        bundle=research(['闵行区飞控系统供应严重不足，相关资料保留原始调查口径。'])
        calls=[]
        context=dict(CONTEXT,chunks=[{'text':'PRIVATE_NOTE'}])
        def complete(*args): calls.append(args);return {'findings':[]}
        build_assessment(context,bundle,CHAIN,complete)
        self.assertEqual(len(calls),1)
        self.assertNotIn('PRIVATE_NOTE',calls[0][1])
        self.assertIn('最多24条',calls[0][0])
        self.assertTrue(all(n['level']=='unknown' for group in CHAIN['chain'] for n in group['nodes']))


if __name__=='__main__': unittest.main()
