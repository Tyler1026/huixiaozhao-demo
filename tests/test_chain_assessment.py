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


def indexed(bundle, sentence_index, **kwargs):
    row = selected(bundle, **kwargs)
    row.pop('quote')
    row.pop('scope_label')
    row['sentence_index'] = sentence_index
    return row


class SentenceIndexAssessmentTests(unittest.TestCase):
    def test_index_selects_archived_sentence_and_retains_full_plan_qualification(self):
        quote = '到2027年，计划建立新型供给体系。闵行区飞控系统供应不足问题将得到研究。'
        bundle = research([quote])
        before = copy.deepcopy(bundle)
        node = assess(bundle, [indexed(bundle, 1)])['node_assessments']['n-control']
        self.assertEqual(node['level'], 'unknown')
        self.assertEqual(node['findings'][0]['kind'], 'plan')
        self.assertEqual(node['findings'][0]['quote'], quote)
        self.assertEqual(node['findings'][0]['source']['quote'], quote)
        self.assertEqual(bundle, before)

    def test_index_is_bound_to_selected_evidence_not_another_source(self):
        bundle = research(['闵行区开展产业调研。闵行区飞控系统供应严重不足。',
                           '闵行区飞控系统供应充足，资料未披露其他情况。'])
        self.assertEqual(assess(bundle, [indexed(bundle, 1, index=0)])['assessment']['level'], 'weak')
        out = assess(bundle, [indexed(bundle, 1, index=1)])
        self.assertEqual(out['assessment']['findings'], [])
        self.assertEqual(out['sources'], [])

    def test_invalid_indices_and_forged_id_never_fall_back_to_quote(self):
        bundle = research(['闵行区飞控系统供应严重不足，调查资料保留相关口径。'])
        for index in (-1, 1, True, False, '0', 0.0, None, [], {}):
            with self.subTest(index=index):
                row = selected(bundle, sentence_index=index)
                self.assertEqual(assess(bundle, [row])['assessment']['findings'], [])
        row = indexed(bundle, 0)
        row['evidence_id'] = 'tr_' + '0' * 20
        self.assertEqual(assess(bundle, [row])['assessment']['findings'], [])

    def test_both_selection_forms_must_agree(self):
        first = '闵行区飞控系统供应严重不足。'
        second = '闵行区飞控系统已实现量产。'
        bundle = research([first + second])
        matching = selected(bundle, quote=first, sentence_index=0)
        self.assertEqual(assess(bundle, [matching])['assessment']['level'], 'weak')
        for conflicting in (second, first + second, '供应严重不足'):
            with self.subTest(quote=conflicting):
                row = selected(bundle, quote=conflicting, sentence_index=0)
                self.assertEqual(assess(bundle, [row])['assessment']['findings'], [])

    def test_prompt_uses_compact_sentence_catalog_and_selection_output(self):
        quote = '闵行区开展产业调研。闵行区飞控系统供应严重不足。'
        bundle = research([quote])
        calls = []
        def complete(*args):
            calls.append(args)
            return {'findings': [indexed(bundle, 1)]}
        out = build_assessment(CONTEXT, bundle, CHAIN, complete)
        system, prompt, max_tokens = calls[0]
        evidence = json.loads(prompt)['evidence'][0]
        self.assertEqual(set(evidence), {'id', 'title', 'published_at', 'sentences'})
        self.assertEqual(evidence['id'], bundle['evidence'][0]['id'])
        self.assertEqual(evidence['sentences'], [
            {'index': 0, 'text': '闵行区开展产业调研。'},
            {'index': 1, 'text': '闵行区飞控系统供应严重不足。'}])
        self.assertIn('sentence_index', system)
        self.assertNotIn('"quote":', system)
        self.assertIn('先检查整链四个维度', system)
        self.assertIn('同一原句支持两个维度时可各选一条', system)
        self.assertEqual(max_tokens, 3000)
        self.assertEqual(out['assessment']['level'], 'weak')


class ExplanationAssessmentTests(unittest.TestCase):
    def evaluate(self, topic, quotes, titles, rows, nodes=()):
        bundle = research(quotes, titles=titles)
        bundle['topic'] = topic
        chain = {'chain': [{'nodes': [{'id': key, 'name': name} for key, name in nodes]}]}
        # Use archived source indices, not generated quotes, like production.
        selections = [indexed(bundle, sentence, index=index, target=target, dimension=dimension)
                      for index, target, dimension, sentence in rows]
        return build_assessment(dict(CONTEXT, topic=topic), bundle, chain,
                                lambda *args: {'findings': selections})

    def test_low_altitude_common_validation_constraint_is_visible_industry_context(self):
        quote = '低空经济腾飞的最大瓶颈之一，在于城市核心区缺乏安全可靠的飞行验证环境。闵行低空测试基地的正式启动，正是破解这一世界级难题的“闵行答案”，标志着上海低空基础设施布局从政策设计迈向实质性建设。'
        out = self.evaluate('低空经济整机配套承接集聚', [quote],
            ['位于吴泾！闵行低空测试基地项目启动'], [(0, 'chain', 'coordination', 0)])
        findings = out['assessment']['findings']
        self.assertTrue(findings)
        self.assertTrue(all(f['scope'] == 'industry' and f['kind'] == 'context' for f in findings))
        self.assertEqual(findings[0]['quote'], quote)
        self.assertEqual(out['assessment']['level'], 'unknown')

    def test_fusion_material_challenge_binds_same_sentence_node_without_local_rating(self):
        quote = '翌曦科技董事长金之俭表示，聚变装置内壁材料不仅需要耐受高温，更面临高能量中子的轰击，材料研发目前仍是严峻挑战。传统材料研发依赖大量实验试错，周期长、成本高。'
        out = self.evaluate('聚变能源前沿赛道培育招商', [quote],
            ['聚变能源迎来“加速时刻”——上海国投三年“织就”完整产业链'],
            [(0, 'wall', 'capacity', 0), (0, 'unrelated', 'capacity', 0)],
            [('wall', '聚变装置内壁材料'), ('unrelated', '高温超导带材')])
        node = out['node_assessments']['wall']
        self.assertEqual(node['level'], 'unknown')
        self.assertTrue(node['findings'])
        self.assertTrue(all(f['scope'] == 'industry' and f['kind'] == 'context' for f in node['findings']))
        self.assertEqual(out['node_assessments']['unrelated']['findings'], [])

    def test_fusion_scientific_problem_and_maturity_are_visible_without_local_rating(self):
        quote = '中国聚变公司总工程师钟武律介绍，托卡马克这一主流路线可分为聚变堆主机与运行、燃料生产与循环、核安全体系、数字托卡马克四大技术领域，包含19个技术方向、50项关键技术和346项技术细目。目前，11项技术成熟度较低，30项技术成熟度中等，9项技术成熟度较高。他将这些挑战提炼为等离子体稳态自持燃烧、聚变堆结构材料、氚增殖与自持循环三大科学问题，以及大型强场磁体技术、等离子体运行与控制、热量传导与转化三大工程技术。'
        out = self.evaluate('聚变能源前沿赛道培育招商', [quote],
            ['“聚变生态联盟”在沪成立 国资引领打造 核聚变能高地'],
            [(0, 'chain', 'capacity', 1), (0, 'material', 'capacity', 2)],
            [('material', '聚变堆结构材料')])
        self.assertTrue(out['assessment']['findings'])
        self.assertTrue(out['node_assessments']['material']['findings'])
        self.assertTrue(all(f['scope'] == 'industry' and f['kind'] == 'context'
                            for f in out['assessment']['findings']))
        self.assertEqual(out['assessment']['level'], 'unknown')

    def test_energy_shortboard_remedy_and_supply_channel_expansion_are_plans(self):
        quotes = ['吸引绿氢制备、储氢设备、加氢站建设、氢能应用场景运营等企业集聚，补全产业链短板。',
                  '针对氢基能源制储输加用、聚变能源实验研发、长时储能装备生产等场景，压实企业责任；支持企业拓展供应渠道、推动关键原材料自主研制。']
        out = self.evaluate('氢基能源与长时储能装备补链', quotes,
            ['闵行区推进先进能源装备及绿色低碳产业高质量发展“十五五”规划'] * 2,
            [(0, 'chain', 'supply', 0), (1, 'chain', 'dependency', 0)])
        findings = out['assessment']['findings']
        self.assertEqual({f['dimension'] for f in findings if f['kind'] == 'plan'}, {'supply', 'dependency'})
        self.assertFalse(any(f['kind'] in ('gap', 'capability') for f in findings))
        self.assertEqual(out['assessment']['level'], 'unknown')

    def test_explanation_language_never_promotes_local_severity_or_foreign_topic(self):
        out = self.evaluate('聚变能源前沿赛道培育招商', ['闵行区聚变材料研发目前仍面临严峻挑战，相关研究正在推进。'],
            ['闵行区聚变产业调研'], [(0, 'chain', 'capacity', 0)])
        self.assertTrue(out['assessment']['findings'])
        self.assertEqual(out['assessment']['level'], 'unknown')
        self.assertTrue(all(f['severity'] is None for f in out['assessment']['findings']))
        foreign = self.evaluate('低空经济整机配套承接集聚', ['聚变装置材料研发目前仍面临严峻挑战，相关研究正在推进。'],
            ['闵行低空产业调研'], [(0, 'chain', 'capacity', 0)])
        self.assertEqual(foreign['assessment']['findings'], [])

    def test_same_original_sentence_can_explain_two_dimensions_without_rating(self):
        out = self.evaluate('低空经济整机配套承接集聚',
            ['低空经济腾飞的瓶颈之一，在于城市核心区缺乏安全可靠的飞行验证环境。'],
            ['闵行低空产业调研'], [(0, 'chain', 'coordination', 0), (0, 'chain', 'capacity', 0)])
        self.assertEqual({f['dimension'] for f in out['assessment']['findings']}, {'coordination', 'capacity'})
        self.assertEqual(out['assessment']['level'], 'unknown')


class NodeJudgmentTests(unittest.TestCase):
    def run_node(self, quote, name='飞控系统', title='闵行区产业调研资料', topic=None, model=None):
        bundle = research([quote], titles=[title])
        context = dict(CONTEXT, topic=topic or CONTEXT['topic'])
        bundle['topic'] = context['topic']
        node = {'id': 'node', 'name': name, 'status': 'planned', 'level': 'unknown',
                'evidence_ids': [bundle['evidence'][0]['id']]}
        graph = {'chain': [{'nodes': [node]}], 'unclassified': []}
        out = build_assessment(context, bundle, graph, model or (lambda *args: {'findings': []}))
        return out, out['node_assessments']['node']

    def assert_bound(self, assessment):
        ids = {f['evidence_id'] for f in assessment['findings']}
        self.assertTrue(set(assessment['judgment']['evidence_ids']) <= ids)

    def test_local_plan_is_yellow_without_changing_fact_level(self):
        quote = '加快研制飞控系统，培育低空航空器关键配套，具体建设计划另行安排。'
        out, node = self.run_node(quote, title='闵行区低空产业行动计划', topic='低空经济整机配套承接集聚')
        self.assertEqual(node['judgment']['level'], 'mid')
        self.assertEqual(node['judgment']['basis'], 'local_plan')
        self.assertEqual(node['level'], 'unknown')
        self.assertEqual(node['findings'][0]['kind'], 'plan')
        self.assertEqual(node['findings'][0]['quote'], quote)
        self.assert_bound(node)
        self.assertIn('重点培育1项', out['assessment']['judgment']['reason'])

    def test_local_completed_production_is_green(self):
        _, node = self.run_node('闵行区飞控系统产线已建成并实现量产，相关生产情况由原始资料披露。')
        self.assertEqual(node['level'], 'supported')
        self.assertEqual(node['judgment']['level'], 'strong')
        self.assertEqual(node['judgment']['basis'], 'local_capability')
        self.assert_bound(node)

    def test_real_local_industry_inventory_supports_existing_basis_not_competitive_advantage(self):
        quote = '作为上海生物医药先导产业核心承载区，闵行已形成“北部研发总部、东部高端制造、南部创新策源”的“3+X”产业格局，全区集聚生物医药企业900余家，其中高新技术企业273家，覆盖原料药供应、医疗器械、生物药、中药及医药全链条服务。'
        _, node = self.run_node(quote, name='原料药供应', title='聚焦生物医药，闵行探索产业生态圈党建', topic='生物医药上游耗材国产替代招引')
        self.assertEqual(node['judgment']['level'], 'strong')
        self.assertEqual(node['level'], 'supported')
        self.assertEqual(node['findings'][0]['scope'], 'local')
        self.assertNotIn('优势', node['judgment']['reason'])

    def test_real_service_center_established_before_later_plan_is_existing_basis(self):
        quote = '同时，闵行组建全市首家区级低空飞行服务中心，出台低空经济专项扶持政策，设百亿级产业引导基金，从空域保障、场景开放、资金扶持、人才引育等维度，构建全周期产业支撑体系，持续吸引低空产业链企业集聚。'
        _, node = self.run_node(quote, name='低空飞行服务中心', title='低空机载产业“旗舰店”上线！全国首个选型中心落户闵行吴泾', topic='低空经济整机配套承接集聚')
        self.assertEqual(node['judgment']['level'], 'strong')
        self.assertEqual(node['findings'][0]['kind'], 'capability')
        self.assertNotIn('量产', node['judgment']['reason'])

    def test_local_gap_is_red_but_existing_fact_level_remains_attention(self):
        _, node = self.run_node('闵行区飞控系统本地供应不足，现有调查披露了具体供应约束。')
        self.assertEqual(node['judgment']['level'], 'weak')
        self.assertEqual(node['judgment']['basis'], 'local_gap')
        self.assertEqual(node['level'], 'attention')
        self.assert_bound(node)

    def test_industry_challenge_is_yellow_without_local_gap(self):
        _, node = self.run_node('聚变装置内壁材料需要耐受高温和中子轰击，材料研发目前仍是严峻挑战。',
            name='聚变装置内壁材料', title='聚变能源技术研究', topic='聚变能源前沿赛道培育招商')
        self.assertEqual(node['judgment']['level'], 'mid')
        self.assertEqual(node['judgment']['basis'], 'industry_risk')
        self.assertEqual(node['level'], 'unknown')

    def test_definition_without_production_or_plan_remains_unknown(self):
        _, node = self.run_node('高端医疗器械主要包括智能医疗机器人、高端影像设备和体外诊断仪器。',
            name='智能医疗机器人', title='闵行区生物医药产业说明', topic='生物医药上游耗材国产替代招引')
        self.assertEqual(node['judgment']['level'], 'unknown')
        self.assertEqual(node['judgment']['basis'], 'insufficient')

    def test_negation_and_foreign_factory_never_become_local_green_or_red(self):
        for quote in ['闵行区尚未建成飞控系统生产线，项目仍处于论证阶段，具体情况待核。',
                      '闵行区飞控系统并非供应不足，调查报告并未发现所传缺口。',
                      '苏州市飞控系统生产线已建成并实现量产，相关资料明确生产基地在苏州。',
                      '某公司总部位于闵行区，在苏州工厂已实现飞控系统量产，生产地点不在闵行。']:
            with self.subTest(quote=quote):
                _, node = self.run_node(quote)
                self.assertNotIn(node['judgment']['level'], ('strong', 'weak'))

    def test_whole_chain_problem_is_never_copied_to_named_nodes(self):
        _, node = self.run_node('闵行区产业链总体供应不足，飞控系统被列为本次调研的参考方向。')
        self.assertEqual(node['findings'], [])
        self.assertEqual(node['judgment']['level'], 'unknown')

    def test_typographic_parentheses_match_but_semantic_near_names_do_not(self):
        _, node = self.run_node('闵行区计划发展合同研发生产组织(CMO)，具体项目建设安排仍需后续落实。',
            name='合同研发生产组织（CMO）', title='闵行区生物医药行动计划', topic='生物医药上游耗材国产替代招引')
        self.assertEqual(node['judgment']['level'], 'mid')
        self.assertEqual(node['findings'][0]['matched_name'], '合同研发生产组织(CMO)')
        for name, quote in [('聚变堆材料', '闵行区计划发展聚变堆结构材料，具体建设项目需要后续落实。'),
                            ('飞控系统', '闵行区计划发展飞控系统芯片，具体项目建设需要后续落实。')]:
            _, node = self.run_node(quote, name=name)
            self.assertEqual(node['judgment']['level'], 'unknown')

    def test_direct_node_evidence_does_not_depend_on_model_selection_or_status(self):
        def failed(*args): raise RuntimeError('selection failed')
        out, node = self.run_node('闵行区飞控系统生产线已实现量产，原始材料披露了已完成的生产设施。', model=failed)
        self.assertEqual(node['judgment']['level'], 'strong')
        self.assertEqual(out['assessment']['state'], 'ready')
        self.assertTrue(node['findings'])

    def test_local_cluster_plan_inherits_into_same_sentence_product_list(self):
        _, node = self.run_node('重点集聚航电系统、飞控系统、起落架系统等机载系统，以及主控芯片、核心传感器等基础元器件。',
            name='核心传感器', title='上海市闵行区人民政府网站', topic='低空经济整机配套承接集聚')
        self.assertEqual(node['judgment']['level'], 'mid')
        self.assertEqual(node['judgment']['basis'], 'local_plan')

    def test_parent_shortboard_does_not_make_child_planned_product_red(self):
        _, node = self.run_node('闵行区补齐火箭发动机产业链短板，支持液氧甲烷发动机批量化生产，逐步培育相关配套。',
            name='液氧甲烷发动机')
        self.assertEqual(node['judgment']['level'], 'mid')
        self.assertFalse(any(f['kind'] == 'gap' for f in node['findings']))
        self.assertEqual(node['level'], 'unknown')

    def test_national_policy_does_not_become_local_plan(self):
        _, node = self.run_node('全国计划加强飞控系统关键技术研发，具体建设内容另行安排。',
            title='闵行区转载全国航空产业政策')
        self.assertEqual(node['judgment']['level'], 'unknown')
        self.assertFalse(any(f['scope'] == 'local' for f in node['findings']))


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
    def test_limit_applies_after_validation_and_input_scan_is_bounded(self):
        bundle=research([f'闵行区飞控系统供应不足，编号{i}的原始调查披露了本地供需问题。' for i in range(25)])
        bad=dict(indexed(bundle,0),evidence_id='tr_'+'0'*20)
        out=assess(bundle,[bad]*24+[indexed(bundle,0)])
        self.assertEqual(len(out['assessment']['findings']),1)
        valid=[indexed(bundle,0,index=i) for i in range(25)]
        self.assertEqual(len(assess(bundle,valid)['assessment']['findings']),24)
        self.assertEqual(assess(bundle,[bad]*96+[indexed(bundle,0)])['assessment']['findings'],[])

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

    def test_unfinished_evaluation_does_not_claim_evidence_is_insufficient(self):
        unavailable=unavailable_assessment(CONTEXT)
        self.assertEqual(unavailable['summary'],'本次评价未完成，已保留图谱；请重试评价或补充原始材料。')
        bundle=research(['闵行区开展飞控系统产业调研，相关供需事实有待后续材料说明。'])
        ready=assess(bundle,[])['assessment']
        self.assertEqual(ready['state'],'ready')
        self.assertEqual(ready['level'],'unknown')
        self.assertIn('现有材料不足以评价',ready['summary'])
        self.assertNotEqual(ready['summary'],unavailable['summary'])

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
