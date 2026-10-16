"""Offline counterexamples for source binding, semantics and chain coverage."""
import copy
import hashlib
import json
import unittest

from backend.topic_chain import (TopicChainError, build_chain, chain_prompt,
    chain_source_catalog, classify_node, normalize_chain_plan, research_facets)
from backend.topic_research import research_topic, search_plan, select_source_paragraphs
from report_service.full_contract import canonical_url
from report_service.providers import OpenAIResearchProvider

TOPIC = '商业火箭卫星配套本地化补链'
CONTEXT = {'city': '闵行区', 'topic': TOPIC}


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def research(quotes, topic=TOPIC, url='https://www.shanghai.gov.cn/chain/original.html'):
    fulltext = '\n\n'.join(quotes)
    source_id = 'source_' + digest(canonical_url(url)+'\0'+fulltext)[:20]
    metadata = {'url': url, 'title': '原始行动方案', 'published_at': '2026-09-09T00:00:00Z',
                'retrieved_at': '2026-10-16T06:00:00Z', 'retrieval': 'fetched', 'source_type': 'government',
                'publisher_id': 'shanghai.gov.cn', 'origin_id': 'origin_'+digest(fulltext)[:20], 'status': 'source'}
    return {'status': 'ready', 'city': '闵行区', 'topic': topic,
        'evidence': [dict(metadata, id='tr_'+digest(url+'\0'+quote)[:20], source_id=source_id, quote=quote) for quote in quotes],
        'sources': {source_id: dict(metadata, id=source_id, fulltext=fulltext, fulltext_sha256=digest(fulltext))}}


def plan(bundle, names):
    return {'nodes': [{'name': name, 'evidence_ids': [row['id'] for row in bundle['evidence'] if name in row['quote']]} for name in names]}


def nodes(result):
    return [node for group in result['chain'] for node in group['nodes']] + result['unclassified']


class SourceBindingTests(unittest.TestCase):
    def setUp(self):
        self.bundle = research(['闵行区计划推进商业火箭总装测试平台建设，相关项目建设条件仍需逐项核实。'])

    def test_exact_archived_quote_and_metadata_are_returned_unchanged(self):
        output = normalize_chain_plan(plan(self.bundle, ['商业火箭总装测试']), self.bundle, CONTEXT)
        source = output['sources'][0]
        original = self.bundle['evidence'][0]
        for key in ('id', 'source_id', 'url', 'quote', 'published_at', 'retrieved_at'):
            self.assertEqual(source[key], original[key])
        self.assertEqual(source['fulltext_sha256'], next(iter(self.bundle['sources'].values()))['fulltext_sha256'])
        self.assertNotIn('fulltext', source)

    def test_archive_is_required_even_when_source_looks_official(self):
        for mutation in ('no_archive', 'hash_changed', 'quote_changed', 'url_changed', 'wrong_source_id', 'snippet', 'report_origin'):
            with self.subTest(mutation=mutation):
                bundle = copy.deepcopy(self.bundle)
                row = bundle['evidence'][0]
                source = next(iter(bundle['sources'].values()))
                if mutation == 'no_archive': bundle['sources'] = {}
                elif mutation == 'hash_changed': source['fulltext_sha256'] = '0' * 64
                elif mutation == 'quote_changed': row['quote'] = '伪造商业火箭总装测试已完成建设，不在真实的归档原文中。'
                elif mutation == 'url_changed': row['url'] = 'https://www.miit.gov.cn/unrelated'
                elif mutation == 'wrong_source_id': row['id'] = 'tr_' + '0'*20
                elif mutation == 'snippet': row['retrieval'] = 'snippet'
                elif mutation == 'report_origin': source['origin'] = 'generated_report'
                self.assertEqual(chain_source_catalog(bundle, CONTEXT), {})

    def test_topic_or_city_cannot_be_substituted(self):
        for context in ({'city': '苏州市', 'topic': TOPIC}, {'city': '闵行区', 'topic': '生物医药'}):
            self.assertEqual(chain_source_catalog(self.bundle, context), {})

    def test_unavailable_or_unarchived_research_never_calls_model(self):
        calls = []
        for bundle in ({'status': 'unavailable'}, dict(self.bundle, sources={})):
            with self.assertRaises(TopicChainError) as raised:
                build_chain(CONTEXT, bundle, lambda *args: calls.append(args))
            self.assertEqual(raised.exception.code, 'chain_research_unavailable')
        self.assertEqual(calls, [])

    def test_only_ids_whose_original_quote_contains_name_support_node(self):
        bundle = research(['商业火箭总装测试处于方案论证阶段，相关建设安排尚需主管部门逐项核实。',
                           '卫星运营服务计划拓展多元化应用场景，相关项目尚处于研究阶段。'])
        raw = {'nodes': [{'name': '商业火箭总装测试', 'evidence_ids': [bundle['evidence'][1]['id'], 'fake-id']}]}
        self.assertEqual(nodes(normalize_chain_plan(raw, bundle, CONTEXT)), [])

    def test_model_fields_cannot_replace_quote_url_status_or_companies(self):
        raw = plan(self.bundle, ['商业火箭总装测试'])
        raw['nodes'][0].update(seg='下游', level='strong', status='operational',
            quote='已建成', sources=[{'url':'https://evil.example'}], local_leaders=['虚构公司'], benchmark=['虚构公司'])
        raw['edges'] = [{'from': 'A', 'to': 'B'}]
        output = normalize_chain_plan(raw, self.bundle, CONTEXT)
        node = nodes(output)[0]
        self.assertEqual(node['classification']['lane'], '中游')
        self.assertEqual(node['level'], 'unknown')
        self.assertEqual(node['status'], 'planned')
        self.assertEqual(node['local_leaders'], [])
        self.assertEqual(node['benchmark'], [])
        self.assertEqual(output['edges'], [])
        self.assertNotIn('evil.example', json.dumps(output))


class ClassificationTests(unittest.TestCase):
    def test_disclosed_taxonomy_for_each_supported_industry(self):
        cases = [
            (TOPIC, '低成本姿控部件', '上游'), (TOPIC, '商业火箭总装测试', '中游'), (TOPIC, '空间信息应用服务', '下游'),
            (TOPIC, '高功能密度商业卫星', '中游'), (TOPIC, '运载火箭发动机', '上游'),
            ('生物医药上游耗材国产替代招引', '层析介质', '上游'), ('生物医药', '生物药制剂', '中游'), ('生物医药', '终端医疗服务', '下游'),
            ('生物医药', '生物辅料', '上游'), ('生物医药', '关键原材料', '上游'),
            ('氢基能源与长时储能装备补链', '膜电极', '上游'), ('氢基能源', '电解槽', '中游'), ('长时储能', '储能电站', '下游'),
            ('长时储能', '液流电池电解液', '上游'), ('储能装备', '新型储能装备', '中游'),
            ('低空经济整机配套', '飞控系统', '上游'), ('低空经济', '无人机整机制造', '中游'), ('低空经济', '低空物流', '下游'),
            ('聚变能源', '高温超导带材', '上游'), ('聚变能源', '托卡马克', '中游'), ('聚变能源', '聚变电站', '下游'),
        ]
        for topic, name, expected in cases:
            with self.subTest(topic=topic, name=name):
                result = classify_node(name, topic)
                self.assertEqual(result['lane'], expected)
                self.assertEqual(result['kind'], 'analytical_taxonomy')
                self.assertIn('不代表本地', result['reason'])

    def test_ambiguous_or_unrecognized_terms_remain_unclassified(self):
        for topic, name in [(TOPIC, '综合支持平台'), (TOPIC, '发动机总装测试'), ('未知细分行业', '火箭总装'), ('储能装备', '储能项目')]:
            with self.subTest(name=name):
                self.assertEqual(classify_node(name, topic)['lane'], '待归类')

    def test_split_source_enumeration_and_deduplicate_across_model_groups(self):
        bundle = research(['计划推动低成本姿控部件、商业火箭总装测试和卫星运营服务协同发展，具体建设条件需进一步研究。'])
        raw = plan(bundle, ['低成本姿控部件、商业火箭总装测试和卫星运营服务', '商业火箭总装测试', '商业火箭总装测试'])
        output = normalize_chain_plan(raw, bundle, CONTEXT)
        self.assertEqual([n['name'] for n in nodes(output)], ['低成本姿控部件', '商业火箭总装测试', '卫星运营服务'])
        self.assertEqual(output['coverage']['status'], 'complete')
        self.assertEqual(output['coverage']['node_count'], 3)
        self.assertEqual(len({n['id'] for n in nodes(output)}), 3)

    def test_missing_lanes_are_partial_and_not_invented(self):
        bundle = research(['低成本姿控部件属于产业研究范围，具体供应能力与投资需求均有待进一步核实。'])
        output = normalize_chain_plan(plan(bundle, ['低成本姿控部件']), bundle, CONTEXT)
        self.assertEqual(output['coverage']['status'], 'partial')
        self.assertEqual(output['status'], 'partial')
        self.assertEqual(output['coverage']['missing_lanes'], ['中游', '下游'])
        self.assertEqual(output['chain'][1]['nodes'], [])
        self.assertEqual(output['chain'][2]['nodes'], [])

    def test_unclassified_only_is_valid_partial_and_empty_selection_is_empty(self):
        bundle = research(['本次将研究综合支持平台的具体范围和建设条件，规划内容尚未形成实际业务能力。'])
        output = normalize_chain_plan(plan(bundle, ['综合支持平台']), bundle, CONTEXT)
        self.assertEqual(len(output['unclassified']), 1)
        self.assertEqual(output['coverage']['status'], 'partial')
        self.assertEqual(output['status'], 'partial')
        self.assertEqual(normalize_chain_plan({'nodes': []}, bundle, CONTEXT)['coverage']['status'], 'empty')

    def test_company_and_claim_sentences_are_not_industry_nodes(self):
        bundle = research(['上海航天测试有限公司计划开展总装测试，尚未建成任何新增产能，不能据此形成已具备能力的判断。'])
        for name in ['上海航天测试有限公司', '尚未建成任何新增产能', '计划开展总装测试']:
            with self.subTest(name=name):
                output = normalize_chain_plan(plan(bundle, [name]), bundle, CONTEXT)
                self.assertEqual(nodes(output), [])


class SourceSemanticsTests(unittest.TestCase):
    def test_paragraph_deadline_and_goal_govern_following_capacity_sentences(self):
        quote = '到2027年，上海商业航天产业规模力争达到1000亿元左右。标志性产品产业化规模放量，商业火箭总装制造能力每年100发、商业卫星智能制造能力每年1000颗、应用终端批量制造能力每年100万个。'
        bundle = research([quote])
        output = normalize_chain_plan(plan(bundle, ['商业火箭总装制造能力', '商业卫星智能制造能力', '应用终端批量制造能力']), bundle, CONTEXT)
        actual = {n['name']: n for n in nodes(output)}
        self.assertEqual(set(actual), {'商业火箭总装制造', '商业卫星智能制造', '应用终端批量制造'})
        self.assertTrue(all(n['status'] == 'planned' for n in actual.values()))
        self.assertTrue(all('到2027年' in n['qualifiers'] and '力争' in n['qualifiers'] for n in actual.values()))
        self.assertEqual(actual['应用终端批量制造']['classification']['lane'], '下游')
        self.assertIn('终端产品', output['taxonomy']['description'])

    def test_policy_context_and_earlier_research_goal_inherit_across_sentences(self):
        topic = '氢基能源与长时储能装备补链'
        quote = '力争在长时储能领域实现创新突破。关于热储能，研发高温熔盐材料和高热容的耐高温陶瓷、金属氧化物固体材料。攻关催化剂与膜材料等制氢关键技术。'
        bundle = research([quote], topic=topic)
        output = normalize_chain_plan(plan(bundle, ['高温熔盐材料', '高热容的耐高温陶瓷', '金属氧化物固体材料', '催化剂']), bundle, {'city':'闵行区','topic':topic})
        self.assertEqual(len(nodes(output)), 4)
        self.assertTrue(all(n['status'] == 'planned' for n in nodes(output)))
        # A research statement with no goal in its own sentence remains a
        # policy proposal when the archived source title says it is a plan.
        policy = research(['关于热储能，研发高温熔盐材料，以满足相关产业技术研究的需要。'], topic=topic)
        for source in policy['sources'].values(): source['title'] = '先进能源装备产业发展规划'
        self.assertEqual(nodes(normalize_chain_plan(plan(policy, ['高温熔盐材料']), policy, {'city':'闵行区','topic':topic}))[0]['status'], 'planned')

    def test_attract_encourage_support_and_technology_tackling_remain_planned(self):
        topic = '聚变能源前沿赛道培育招商'
        for prefix in ('吸引', '鼓励', '支持'):
            quote = f'围绕聚变能源产业链需求，{prefix}聚变堆材料供应、检测认证服务等上下游企业加速集聚。'
            bundle = research([quote], topic=topic)
            output = normalize_chain_plan(plan(bundle, ['聚变堆材料供应', '检测认证服务']), bundle, {'city':'闵行区','topic':topic})
            self.assertEqual(len(nodes(output)), 2)
            self.assertTrue(all(n['status'] == 'planned' for n in nodes(output)))
        bundle = research(['本阶段攻关高温超导材料关键技术，相关试验结果和实施范围另行公布。'], topic=topic)
        self.assertEqual(nodes(normalize_chain_plan(plan(bundle, ['高温超导材料']), bundle, {'city':'闵行区','topic':topic}))[0]['status'], 'planned')

    def test_explicit_current_completion_is_not_hidden_by_policy_title(self):
        quote = '计划推动卫星服务发展。目前已建成卫星总装测试平台，现有服务条件另行公布。'
        bundle = research([quote])
        node = nodes(normalize_chain_plan(plan(bundle, ['卫星总装测试']), bundle, CONTEXT))[0]
        self.assertEqual(node['status'], 'reported')
        self.assertEqual(node['level'], 'unknown')

    def test_wall_material_head_is_upstream_and_kpis_are_not_nodes(self):
        topic = '聚变能源前沿赛道培育招商'
        quote = '聚变装置内壁材料需要耐受高温和中子轰击，材料研发仍有待进一步研究。'
        bundle = research([quote], topic=topic)
        node = nodes(normalize_chain_plan(plan(bundle, ['聚变装置内壁材料']), bundle, {'city':'闵行区','topic':topic}))[0]
        self.assertEqual(node['classification']['lane'], '上游')
        topic = '氢基能源与长时储能装备补链'
        quote = '着力提升储能模块单体规模与传热效率，拓展应用服务，形成更为完整的产业发展体系。'
        bundle = research([quote], topic=topic)
        output = normalize_chain_plan(plan(bundle, ['储能模块单体规模', '传热效率', '应用服务']), bundle, {'city':'闵行区','topic':topic})
        self.assertEqual(nodes(output), [])

    def test_future_will_verbs_never_become_currently_reported_capability(self):
        for verb in ('研制', '研发', '生产', '制造', '提供', '开展', '投入', '建成', '投产', '进一步研制', '持续提供'):
            with self.subTest(verb=verb):
                quote = f'闵行区将{verb}星载计算单元，具体型号参数和交付时间另行确定。'
                bundle = research([quote])
                node = nodes(normalize_chain_plan(plan(bundle, ['星载计算单元']), bundle, CONTEXT))[0]
                self.assertEqual(node['status'], 'planned')
                self.assertEqual(node['level'], 'unknown')

    def test_aviation_enumeration_cannot_leak_into_rocket_satellite_chain(self):
        quote = '产业强链延链持续加强。形成覆盖发动机、机载系统、关键部件、先进材料的航空产业链以及“箭星网端”一体发展的航天产业链，完善总装测试、火箭海上发射辅助等产业配套能力。'
        bundle = research([quote])
        result = normalize_chain_plan(plan(bundle, ['发动机', '机载系统', '关键部件', '先进材料', '总装测试', '火箭海上发射辅助']), bundle, CONTEXT)
        self.assertEqual({n['name'] for n in nodes(result)}, {'总装测试', '火箭海上发射辅助'})
        good = research(['加快商业火箭研制。支持液氧甲烷可重复使用发动机批量化生产，集聚返回控制系统、复合材料等关键配套。'])
        self.assertEqual(len(nodes(normalize_chain_plan(plan(good, ['液氧甲烷可重复使用发动机', '复合材料']), good, CONTEXT))), 2)

    def test_shared_head_is_not_split_into_orphan_modifier_or_ait_fragment(self):
        quote = '提升火箭总装测试能力，增设北沙港商业航天产业辅助及社会化多用途码头。支持卫星总装集成与测试（AIT）等创新平台建设。'
        bundle = research([quote])
        result = normalize_chain_plan(plan(bundle, ['北沙港商业航天产业辅助及社会化多用途码头', '北沙港商业航天产业辅助', '卫星总装集成与测试（AIT）', '测试（AIT）']), bundle, CONTEXT)
        names = {n['name'] for n in nodes(result)}
        self.assertIn('北沙港商业航天产业辅助及社会化多用途码头', names)
        self.assertIn('卫星总装集成与测试（AIT）', names)
        self.assertNotIn('北沙港商业航天产业辅助', names)
        self.assertNotIn('测试（AIT）', names)

    def test_chemical_state_fragments_and_generic_words_are_not_nodes(self):
        topic = '氢基能源与长时储能装备补链'
        quote = '推动碱性、质子交换膜、固体氧化物等多路径电解水制氢技术。研发高压气态、液态及有机液态、固态储氢、运氢及加氢等关键设备，完善装备体系。'
        bundle = research([quote], topic=topic)
        bad = ['碱性', '高压气态', '液态', '有机液态', '装备', '固体氧化物等多路径电解水制氢技术', '加氢等关键设备']
        self.assertEqual(nodes(normalize_chain_plan(plan(bundle, bad), bundle, {'city':'闵行区','topic':topic})), [])

    def test_fusion_materials_are_upstream_and_shared_technical_scope_keeps_full_name(self):
        topic = '聚变能源前沿赛道培育招商'
        quote = '聚变研究包括聚变堆结构材料、聚变堆材料供应、燃料生产与循环、聚变堆主机与运行等领域。相关技术仍需进一步研究。'
        bundle = research([quote], topic=topic)
        result = normalize_chain_plan(plan(bundle, ['聚变堆结构材料', '聚变堆材料供应', '燃料生产与循环', '聚变堆主机与运行', '运行', '循环']), bundle, {'city':'闵行区','topic':topic})
        names = {n['name']:n for n in nodes(result)}
        self.assertEqual(names['聚变堆结构材料']['classification']['lane'], '上游')
        self.assertEqual(names['聚变堆材料供应']['classification']['lane'], '上游')
        self.assertIn('燃料生产与循环', names)
        self.assertIn('聚变堆主机与运行', names)
        self.assertNotIn('运行', names); self.assertNotIn('循环', names)

    def test_previous_strength_negation_foreign_and_company_counterexamples_stay_unverified(self):
        cases = [
            ('闵行区卫星总装测试并非本地核心优势，相关产业情况由主管部门另行核实。', 'unverified', True),
            ('闵行区卫星总装测试没有短板，本次材料未涉及任何新增建设项目。', 'unverified', True),
            ('闵行区计划将卫星总装测试培育为核心优势，具体安排需经进一步论证。', 'planned', False),
            ('苏州市卫星总装测试是本地核心优势，现有制造企业已有相关服务能力。', 'reported', False),
            ('闵行区甲公司未开展卫星总装测试，该企业未生产相关核心部件。', 'unverified', True),
            ('闵行区已建成卫星总装测试平台，相关服务对象和使用条件由运营单位公布。', 'reported', False),
            ('闵行区已布局卫星总装测试平台，运营单位已开展相关技术服务。', 'reported', False),
        ]
        for quote, status, negated in cases:
            with self.subTest(quote=quote):
                bundle = research([quote])
                node = nodes(normalize_chain_plan(plan(bundle, ['卫星总装测试']), bundle, CONTEXT))[0]
                self.assertEqual(node['level'], 'unknown')
                self.assertEqual(node['status'], status)
                self.assertEqual(node['negated'], negated)
                self.assertEqual(node['local_leaders'], [])
                self.assertEqual(node['sources'][0]['quote'], quote)
                self.assertEqual(node['verification_status'], 'unverified')

    def test_plan_before_comma_governs_source_enumeration(self):
        bundle = research(['未来将加快配套体系布局，发展低成本姿控部件、卫星总装测试和卫星运营服务，实施条件另行明确。'])
        output = normalize_chain_plan(plan(bundle, ['低成本姿控部件', '卫星总装测试', '卫星运营服务']), bundle, CONTEXT)
        self.assertTrue(all(n['status'] == 'planned' for n in nodes(output)))

    def test_conflicting_status_sources_do_not_become_one_completed_claim(self):
        bundle = research(['规划提出卫星总装测试平台，项目实施安排仍须另行论证和公布。',
                           '目前已建成卫星总装测试平台，部分服务对象和服务条件仍由运营单位公布。'])
        node = nodes(normalize_chain_plan(plan(bundle, ['卫星总装测试']), bundle, CONTEXT))[0]
        self.assertEqual(node['status'], 'unverified')
        self.assertEqual(len(node['sources']), 2)


class ChainModelContractTests(unittest.TestCase):
    def test_one_retry_uses_same_catalog_and_only_fills_supported_missing_lanes(self):
        bundle = research(['计划建设商业火箭总装测试平台，具体建设条件另行核实。',
                           '计划研制星载计算单元，发展卫星运营服务，具体安排须进一步论证。'])
        answers = [plan(bundle, ['商业火箭总装测试']), plan(bundle, ['星载计算单元', '卫星运营服务'])]
        calls = []
        def complete(*args):
            calls.append(args)
            return answers[len(calls)-1]
        output = build_chain(CONTEXT, bundle, complete)
        self.assertEqual(len(calls), 2)
        first, second = json.loads(calls[0][1]), json.loads(calls[1][1])
        self.assertEqual(first['evidence'], second['evidence'])
        self.assertEqual(second['missing_lanes'], ['上游', '下游'])
        self.assertEqual(calls[1][2], 2200)
        self.assertTrue(all(group['nodes'] for group in output['chain']))
        self.assertEqual(output['status'], 'ready')

    def test_retry_invalid_json_schema_exception_or_invented_node_keeps_first_partial(self):
        bundle = research(['计划建设商业火箭总装测试平台，具体建设条件另行核实。',
                           '计划研制星载计算单元，具体安排须进一步论证并公开发布。'])
        initial = plan(bundle, ['商业火箭总装测试'])
        expected = normalize_chain_plan(initial, bundle, CONTEXT)
        for bad in ('not-json', None, {'nodes':'invalid'}, RuntimeError('provider failed'),
                    {'nodes':[{'name':'不存在的芯片','evidence_ids':[bundle['evidence'][1]['id']]}]}):
            with self.subTest(bad=repr(bad)):
                calls = []
                def complete(*args):
                    calls.append(args)
                    if len(calls) == 1:
                        return initial
                    if isinstance(bad, Exception):
                        raise bad
                    return bad
                self.assertEqual(build_chain(CONTEXT, bundle, complete), expected)
                self.assertEqual(len(calls), 2)

    def test_retry_rejects_other_lanes_and_caps_each_requested_lane_at_three(self):
        ups = ['星载计算单元', '星载相控阵天线', '低成本姿控部件', '高比冲长寿命电推进器']
        bundle = research(['计划研制'+ '、'.join(ups) + '，建设商业火箭总装测试平台，相关条件另行核实。'])
        calls = []
        def complete(*args):
            calls.append(args)
            return plan(bundle, ['商业火箭总装测试'] if len(calls)==1 else ups+['商业火箭总装测试'])
        output = build_chain(CONTEXT, bundle, complete)
        self.assertEqual(len(output['chain'][0]['nodes']), 3)
        self.assertEqual(len(output['chain'][1]['nodes']), 1)
        self.assertEqual(output['chain'][2]['nodes'], [])
        self.assertEqual(len(calls), 2)

    def test_ninety_raw_noise_entries_cannot_displace_valid_supplement(self):
        bundle = research(['计划建设商业火箭总装测试平台，具体建设条件另行核实。',
                           '计划研制星载计算单元，具体安排须进一步论证并公开发布。'])
        first = plan(bundle, ['商业火箭总装测试'])
        first['nodes'] += [{'name': f'不存在的条目{i}', 'evidence_ids': ['invalid']} for i in range(89)]
        self.assertEqual(len(first['nodes']), 90)
        calls = []
        def complete(*args):
            calls.append(args)
            return first if len(calls) == 1 else plan(bundle, ['星载计算单元'])
        output = build_chain(CONTEXT, bundle, complete)
        self.assertEqual(len(calls), 2)
        self.assertEqual({n['name'] for n in nodes(output)}, {'商业火箭总装测试', '星载计算单元'})
        self.assertEqual(len(output['chain'][0]['nodes']), 1)
        self.assertEqual(len(output['chain'][1]['nodes']), 1)

    def test_complete_first_selection_does_not_retry(self):
        bundle = research(['计划研制星载计算单元，建设商业火箭总装测试平台，发展卫星运营服务，相关条件另行核实。'])
        calls = []
        def complete(*args):
            calls.append(args)
            return plan(bundle, ['星载计算单元','商业火箭总装测试','卫星运营服务'])
        self.assertEqual(build_chain(CONTEXT, bundle, complete)['status'], 'ready')
        self.assertEqual(len(calls), 1)

    def test_partial_research_with_valid_archives_is_usable_but_stays_partial(self):
        bundle = research(['计划推进商业火箭总装测试平台建设，具体实施条件将另行研究并向社会发布。'])
        bundle.update(status='pending', errors=[{'code':'research_search_failed','message':'部分公开检索未完成'}])
        out = build_chain(CONTEXT, bundle, lambda *args: plan(bundle, ['商业火箭总装测试']))
        self.assertEqual(out['status'], 'partial')
        self.assertTrue(out['coverage']['research_partial'])
        self.assertTrue(nodes(out))

    def test_prompt_marks_actual_downstream_evidence_for_model_selection(self):
        quote = '拓展卫星运营服务，发展在轨运维服务，构建卫星数据服务平台，推进空间信息产品的应用。'
        bundle = research([quote])
        _, prompt = chain_prompt(CONTEXT, bundle)
        self.assertEqual(json.loads(prompt)['facet_sources']['下游'], [bundle['evidence'][0]['id']])

    def test_caps_prefer_specific_nodes_and_balance_lanes_not_first_thirty(self):
        ups = [f'第{i}型星载芯片' for i in range(30)]
        mids = [f'第{i}型运载火箭' for i in range(5)]
        downs = [f'第{i}类卫星运营服务' for i in range(5)]
        unclassified = [f'专用技术平台{i}' for i in range(15)]
        names = ups+mids+downs+unclassified
        bundle = research(['商业航天产业研究方向包括'+ '、'.join(names)+'，各项具体建设条件和实施范围仍需另行核实。'])
        out = normalize_chain_plan(plan(bundle, names), bundle, CONTEXT)
        self.assertEqual(len(nodes(out)), 30)
        self.assertLessEqual(len(out['unclassified']), 6)
        self.assertTrue(out['chain'][1]['nodes']); self.assertTrue(out['chain'][2]['nodes'])

    def test_model_gets_only_public_archived_evidence_and_selection_contract(self):
        bundle = research(['计划推进商业火箭总装测试平台建设，具体实施条件将另行研究并向社会发布。'])
        context = dict(CONTEXT, chunks=[{'text': 'SECRET_PRIVATE_NOTE'}], confirmations=['SECRET_CONFIRMATION'])
        system, user = chain_prompt(context, bundle)
        self.assertNotIn('SECRET', user)
        self.assertIn('evidence_ids', system)
        self.assertIn('taxonomy', json.loads(user))
        calls = []
        result = build_chain(context, bundle, lambda *args: calls.append(args) or json.dumps(plan(bundle, ['商业火箭总装测试'])))
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][2], 4800)
        self.assertEqual(result['contract'], 'topic-chain-v1')

    def test_malformed_model_output_fails_not_successful_empty(self):
        bundle = research(['计划推进商业火箭总装测试平台建设，具体实施条件将另行研究并向社会发布。'])
        for raw in ('not-json', {'nodes': 'invalid'}, [], None):
            with self.subTest(raw=raw), self.assertRaises(TopicChainError):
                build_chain(CONTEXT, bundle, lambda *args: raw)


class LiteralFallbackTests(unittest.TestCase):
    topic = '低空经济整机配套承接集聚'

    def generate(self, quote, *, title=None):
        mid = '低空产业计划发展无人机整机制造，相关建设条件由主管单位进一步核实。'
        bundle = research([mid, quote], topic=self.topic)
        if title is not None:
            for source in bundle['sources'].values(): source['title'] = title
        calls = []
        def complete(*args):
            calls.append(args)
            return plan(bundle, ['无人机整机制造']) if len(calls) == 1 else {'nodes': []}
        result = build_chain({'city':'闵行区','topic':self.topic}, bundle, complete)
        return result, calls

    def test_real_flight_control_enumeration_fills_one_from_same_original_catalog(self):
        quote = '面向未来，闵行区将聚力搭建三大核心平台。技术创新平台依托产业联盟、供应链对接会等，聚力突破航电、电机材料、飞控系统等卡脖子技术；场景落地平台打造超大城市低空综合场景示范基地；生态共建平台支持eVTOL产业发展。'
        result, calls = self.generate(quote)
        self.assertEqual(len(calls), 2)
        upstream = result['chain'][0]['nodes']
        self.assertEqual(len(upstream), 1)
        self.assertEqual(upstream[0]['name'], '飞控系统')
        self.assertEqual(upstream[0]['extraction_method'], 'literal_fallback')
        self.assertEqual(upstream[0]['status'], 'planned')
        self.assertEqual(upstream[0]['sources'][0]['quote'], quote)
        self.assertEqual(upstream[0]['level'], 'unknown')
        self.assertEqual(upstream[0]['verification_status'], 'unverified')
        self.assertEqual(upstream[0]['local_leaders'], [])
        self.assertEqual(result['edges'], [])

    def test_general_aviation_without_explicit_low_altitude_scope_stays_empty(self):
        quote = '民用航空研发目录列举航空发动机、飞控系统等技术，重点支持大飞机和干线航空项目。'
        result, calls = self.generate(quote)
        self.assertEqual(result['chain'][0]['nodes'], [])
        self.assertEqual(len(calls), 2)

    def test_flight_control_chip_is_not_shortened_to_whole_flight_control_system(self):
        result, calls = self.generate('低空产业研发目录包括飞控系统芯片，相关研发项目和供需关系需要进一步核实。')
        self.assertEqual(result['chain'][0]['nodes'], [])
        self.assertEqual(len(calls), 2)

    def test_current_domain_in_other_sentence_does_not_override_foreign_medical_clause(self):
        quote = '医疗器械研发目录列有飞控系统等术语。本地区低空发展仍在研究，低空物流服务需求另行调查。'
        result, _ = self.generate(quote)
        self.assertEqual(result['chain'][0]['nodes'], [])

    def test_negation_in_source_is_preserved_without_local_capability_claim(self):
        quote = '低空产业尚未开展航电、飞控系统等部件的研发工作，相关需求仍需要进一步核实。'
        result, _ = self.generate(quote)
        node = result['chain'][0]['nodes'][0]
        self.assertTrue(node['negated'])
        self.assertEqual(node['status'], 'unverified')
        self.assertEqual(node['sources'][0]['quote'], quote)
        self.assertEqual(node['local_leaders'], [])

    def test_only_one_per_missing_lane_even_when_multiple_literals_exist(self):
        result, _ = self.generate('低空产品目录包括航空发动机、飞控系统、动力电池，所有产品研发计划仍须论证。')
        self.assertEqual(len(result['chain'][0]['nodes']), 1)
        self.assertEqual(result['chain'][0]['nodes'][0]['extraction_method'], 'literal_fallback')

    def test_no_original_archive_cannot_trigger_literal_generation(self):
        bundle = research(['低空研发目录包含飞控系统，相关实施条件和研发安排另行明确。'], topic=self.topic)
        bundle['sources'] = {}
        calls = []
        with self.assertRaises(TopicChainError):
            build_chain({'city':'闵行区','topic':self.topic}, bundle, lambda *args: calls.append(args))
        self.assertEqual(calls, [])


class FakeSearch:
    enabled = True
    search_provider = 'exa'
    search_count = 5
    timeout = 30

    def __init__(self, entries): self.entries = entries
    def _validate_endpoints(self): pass
    def _search(self, query, count): return {'results': copy.deepcopy(self.entries)}
    _normalize_results = OpenAIResearchProvider._normalize_results


class ChainResearchCoverageTests(unittest.TestCase):
    def paragraphs(self):
        return [f'第{i}项：航天发动机和低成本姿控部件列入产业链研究范围，相关建设条件需主管部门逐项核实。' for i in range(5)] + [
            '第五项：推动商业火箭总装测试及研制制造，形成符合要求的商业航天研发验证体系。',
            '第六项：推进商业卫星批量化制造，建设航天产业相关的卫星总装和测试平台。',
            '第七项：开展火箭发射服务和测运控服务，具体实施范围仍须依照政策条件核实。',
            '第八项：拓展卫星运营及空间信息应用服务，推动应用终端面向相关服务场景发展。']

    def test_chain_queries_cover_three_lanes_without_changing_report_queries(self):
        self.assertEqual(len(search_plan('闵行区', TOPIC, 'draft')), 3)
        self.assertEqual(len(search_plan('闵行区', TOPIC, 'full')), 5)
        queries = search_plan('闵行区', TOPIC, 'chain')
        self.assertEqual(len(queries), 9)
        self.assertIn('上游', queries[0]); self.assertIn('总装', queries[1]); self.assertIn('下游', queries[2])
        self.assertIn('行动方案 全文', queries[3])
        self.assertTrue(all(research_facets(TOPIC).values()))

    def test_single_action_plan_keeps_more_than_three_balanced_whole_paragraphs(self):
        paragraphs = self.paragraphs()
        body = '\n\n'.join(paragraphs)
        old = select_source_paragraphs(body, TOPIC)
        selected = select_source_paragraphs(body, TOPIC, mode='chain')
        self.assertEqual(len(old), 3)
        self.assertEqual(len(selected), len(paragraphs))
        self.assertTrue(all(p['quote'] in paragraphs for p in selected))
        self.assertTrue(any('第五项' in p['quote'] for p in selected[:4]))
        self.assertTrue(any('第七项' in p['quote'] or '第八项' in p['quote'] for p in selected[:4]))

    def test_research_chain_retains_archive_bound_all_lanes_and_old_limit(self):
        body = '\n\n'.join(self.paragraphs())
        entries = [{'url': 'https://www.shanghai.gov.cn/chain/action.html', 'title': '航天行动方案', 'text': body, 'publishedDate': '2026-09-09'}]
        out = research_topic('闵行区', TOPIC, mode='chain', provider=FakeSearch(entries))
        self.assertEqual(out['status'], 'ready')
        self.assertGreater(len(out['evidence']), 3)
        self.assertLessEqual(len(out['evidence']), 12)
        self.assertEqual(len(chain_source_catalog(out, CONTEXT)), len(out['evidence']))
        self.assertEqual(len(research_topic('闵行区', TOPIC, mode='full', provider=FakeSearch(entries))['evidence']), 3)

    def test_global_cap_does_not_discard_downstream_results_from_late_query(self):
        upstream = [{'url': f'https://www.shanghai.gov.cn/chain/up{doc}.html', 'title': '航天材料原文',
                     'text': '\n\n'.join(f'第{part}项航天发动机与先进材料列入研究方向，原文对建设条件与相关参数作出完整说明。' for part in range(12)),
                     'publishedDate': '2026-09-09'} for doc in range(4)]
        downstream = [{'url': 'https://www.shanghai.gov.cn/chain/down.html', 'title': '卫星运营服务原文',
                     'text': '\n\n'.join(f'第{part}项卫星运营及测运控服务拟覆盖相关领域，实施条件由主管部门另行确认。' for part in range(12)),
                     'publishedDate': '2026-09-09'}]
        class LaneSearch(FakeSearch):
            def _search(self, query, count):
                return {'results': copy.deepcopy(downstream if '下游' in query else upstream)}
        out = research_topic('闵行区', TOPIC, mode='chain', provider=LaneSearch([]))
        self.assertEqual(len(out['evidence']), 48)
        self.assertTrue(any('down.html' in row['url'] for row in out['evidence']))
        self.assertLessEqual(max(sum(row['url'] == url for row in out['evidence']) for url in {r['url'] for r in out['evidence']}), 12)

    def test_long_complete_paragraph_allowed_for_chain_not_truncated(self):
        paragraph = '卫星运营服务计划和空间信息应用服务说明。' + '原始资料应完整保留相关限定条件和实施范围。' * 95
        self.assertGreater(len(paragraph), 1600)
        self.assertEqual(select_source_paragraphs(paragraph, TOPIC), [])
        self.assertEqual(select_source_paragraphs(paragraph, TOPIC, mode='chain')[0]['quote'], paragraph)

    def test_long_archives_keep_total_prompt_bounded_without_cutting_quotes(self):
        entries = []
        originals = set()
        for doc in range(5):
            paragraphs = [f'第{part}项卫星运营服务。'+ ('完整原文条件应保留。'*120) for part in range(12)]
            originals.update(paragraphs)
            entries.append({'url': f'https://www.shanghai.gov.cn/chain/long{doc}.html',
                'title': '卫星运营原文', 'text': '\n\n'.join(paragraphs), 'publishedDate': '2026-09-09'})
        out = research_topic('闵行区', TOPIC, mode='chain', provider=FakeSearch(entries))
        self.assertLessEqual(sum(len(json.dumps(row, ensure_ascii=False)) for row in out['evidence']), 40000)
        self.assertTrue(out['evidence'])
        self.assertTrue(all(row['quote'] in originals for row in out['evidence']))


if __name__ == '__main__': unittest.main()
