"""Evidence-backed directions continue even without a proven local shortage."""
import copy
import json
import unittest
from unittest.mock import patch

from backend.report_analysis import analytical_priority, review_priorities, _unsafe_priority_assertion
from backend.topic_reports import build_priority_analysis, evidence_catalog, normalize_plan
from backend.topic_reports import render_report
from test_report_analysis import bundle, corporate_bundle, skeleton


def capability_case():
    research = corporate_bundle()
    ids = [row['id'] for row in research['evidence']]
    raw = skeleton(research)
    raw['companies'] = [{'name': '东富龙科技集团股份有限公司', 'product': '生物反应袋',
                         'evidence_ids': [ids[2]], 'identity_ids': [ids[0]]}]
    clean = normalize_plan(raw, research, research)
    proposal = {'focus': '生物反应袋', 'entity': '东富龙科技集团股份有限公司',
        'opportunity_type': 'capability_collaboration', 'scope': 'local_enterprise',
        'supply_ids': [ids[2]], 'comparison': '现有产品能力可作为应用交流起点，但具体合作需求及采购安排尚需对接。',
        'reason': '围绕生物反应袋开展技术交流与应用适配，不据此认定本地没有供给或已存在新订单。',
        'action': '与产品主体核对生物反应袋适用工况，再围绕客户验证要求安排技术交流。'}
    return research, raw, clean, proposal


class ReportCollaborationDirectionTests(unittest.TestCase):
    def test_verified_product_supports_capability_discussion_without_a_shortage(self):
        research, _, clean, proposal = capability_case()
        result = analytical_priority(proposal, evidence_catalog(research), research, clean['companies'])
        self.assertIsNotNone(result)
        self.assertEqual(result['entity'], proposal['entity'])
        self.assertEqual(result['opportunity_type'], 'capability_collaboration')
        self.assertEqual(result['constraint_ids'], [])
        self.assertEqual(result['demand_ids'], [])
        self.assertEqual(result['state'], 'pending_review')
        self.assertIn('本地没有', result['reason'], 'A negated overclaim remains a safe boundary')

    def test_product_entity_and_local_factory_cannot_be_swapped(self):
        research, _, clean, proposal = capability_case()
        for change in ({'entity': '虚构科技有限公司'}, {'focus': '非氟离子膜'}, {'scope': 'local'}):
            with self.subTest(change=change):
                row = dict(proposal, **change)
                self.assertIsNone(analytical_priority(row, evidence_catalog(research), research, clean['companies']))

    def test_actual_shortage_or_investment_claim_cannot_hide_in_collaboration(self):
        research, _, clean, proposal = capability_case()
        for text in ('本地没有生物反应袋生产企业，因此必须引进。',
                     '生物反应袋供给不足，需要建立本地工厂。',
                     '公司已确定在当地投资，生物反应袋项目可以落地。'):
            with self.subTest(text=text):
                row = dict(proposal, reason=text)
                self.assertIsNone(analytical_priority(row, evidence_catalog(research), research, clean['companies']))

    def test_negative_boundary_is_preserved_but_double_negation_is_not_a_boundary(self):
        research, _, clean, proposal = capability_case()
        for text in ('生物反应袋可以开展适配交流，不表示本地没有供应商。',
                     '不把行业协同问题说成本地没有检测能力，生物反应袋合作仍需适配。',
                     '不能认定本地不存在供方，生物反应袋验证需具体对接。'):
            with self.subTest(text=text):
                row = dict(proposal, reason=text)
                self.assertIsNotNone(analytical_priority(row, evidence_catalog(research), research, clean['companies']))
        for text in ('不能否认本项目必然获得订单。', '并非不能保证获得订单。'):
            with self.subTest(text=text):
                self.assertTrue(_unsafe_priority_assertion(text))
        for text in ('生物反应袋供给不足不能持续，因此需要建立本地工厂。',
                     '不能否认本地没有生物反应袋供应商。'):
            with self.subTest(text=text):
                self.assertIsNone(analytical_priority(dict(proposal, reason=text),
                    evidence_catalog(research), research, clean['companies']))

    def test_copresent_other_product_does_not_become_the_companys_capability(self):
        research = bundle([{'quote': '甲材料有限公司研发聚变磁体，形成相关产品线。该产品用于聚变装置应用。真空腔室不属于本公司的生产业务。'}], topic='聚变能源')
        sid = research['evidence'][0]['id']
        raw = skeleton(research)
        raw['companies'] = [{'name': '甲材料有限公司', 'product': '聚变磁体', 'evidence_ids': [sid]}]
        clean = normalize_plan(raw, research, research)
        self.assertEqual(len(clean['companies']), 1)
        item = {'focus': '真空腔室', 'entity': '甲材料有限公司', 'scope': 'industry',
                'opportunity_type': 'capability_collaboration', 'supply_ids': [sid],
                'comparison': '已有产品线需要讨论应用条件。', 'reason': '围绕真空腔室交流实际应用。',
                'action': '先对接真空腔室工况，再安排技术交流。'}
        self.assertIsNone(analytical_priority(item, evidence_catalog(research), research, clean['companies']))

    def test_new_named_party_cannot_hide_in_the_action(self):
        research, _, clean, proposal = capability_case()
        for field in ('comparison', 'reason', 'action'):
            item = dict(proposal, **{field: '与虚构科技有限公司开展生物反应袋技术交流和适配验证。'})
            with self.subTest(field=field):
                self.assertIsNone(analytical_priority(item, evidence_catalog(research), research, clean['companies']))

    def test_real_archive_maturity_and_transfer_terms_support_validation_direction(self):
        from backend.public_research import load_public_research
        library = load_public_research()
        source = next(row for row in library['evidence'] if '铁铬液流电池电解液短程清洁制备技术与应用' in row.get('title', '')
                      and '技术成熟度' in row['quote'])
        research = {'city': '闵行区', 'topic': '氢基能源与长时储能装备补链', 'status': 'ready',
                    'evidence': [source], 'sources': library['sources']}
        row = {'focus': '铁铬液流电池电解液', 'opportunity_type': 'validation_collaboration',
               'scope': 'industry', 'validation_ids': [source['id']],
               'comparison': '原文处于中试阶段，技术转让和合作开发仍需明确成果使用条件。',
               'reason': '铁铬液流电池电解液可以围绕中试成果开展技术交流，不等于已完成商业化量产。',
               'action': '先核对铁铬液流电池电解液成果的许可条件和验证指标，再组织技术交流与试验方案比对。'}
        result = analytical_priority(row, evidence_catalog(research), research, [])
        self.assertIsNotNone(result)
        self.assertEqual(result['validation_ids'], [source['id']])
        row['scope'] = 'local'
        self.assertIsNone(analytical_priority(row, evidence_catalog(research), research, []))

    def test_validation_scope_is_bound_to_the_actual_task_sentence(self):
        research = bundle([{'quote': '铁铬液流电池电解液仍需工程验证。闵行区已建成质子交换膜项目。'}],
                          topic='氢基能源与长时储能装备补链')
        sid = research['evidence'][0]['id']
        item = {'focus': '铁铬液流电池电解液', 'opportunity_type': 'validation_collaboration',
                'scope': 'industry', 'validation_ids': [sid],
                'comparison': '原文为工程验证阶段，需要明确测试条件。',
                'reason': '铁铬液流电池电解液可以围绕耐久性验证进行技术交流。',
                'action': '核对铁铬液流电池电解液的验证指标，再对接测试条件。'}
        self.assertIsNotNone(analytical_priority(item, evidence_catalog(research), research, []))
        for scope in ('local', 'project'):
            with self.subTest(scope=scope):
                self.assertIsNone(analytical_priority(dict(item, scope=scope), evidence_catalog(research), research, []))

    def test_future_validation_and_unrelated_supply_do_not_qualify(self):
        for quote in ('铁铬液流电池电解液计划开展工程验证。',
                      '铁铬液流电池电解液将与企业合作开发。'):
            research = bundle([{'quote': quote}], topic='氢基能源与长时储能装备补链')
            sid = research['evidence'][0]['id']
            item = {'focus': '铁铬液流电池电解液', 'opportunity_type': 'validation_collaboration',
                    'scope': 'industry', 'validation_ids': [sid],
                    'comparison': '原文披露了技术合作方向。', 'reason': '铁铬液流电池电解液可交流技术。',
                    'action': '先核对铁铬液流电池电解液合作条件，再开展技术交流。'}
            with self.subTest(quote=quote):
                self.assertIsNone(analytical_priority(item, evidence_catalog(research), research, []))
        research = bundle([{'quote': '铁铬液流电池电解液仍需工程验证。'},
                           {'quote': '另一研究所研制氢燃料电池。'}], topic='氢基能源与长时储能装备补链')
        item.update(validation_ids=[research['evidence'][0]['id']], supply_ids=[research['evidence'][1]['id']])
        self.assertIsNone(analytical_priority(item, evidence_catalog(research), research, []))

    def test_one_targeted_supplement_is_reviewed_without_composing_a_report(self):
        research, raw, _, proposal = capability_case()
        original = copy.deepcopy(research)
        calls = []
        def complete(system, prompt, budget):
            calls.append((system, json.loads(prompt)))
            if '补充可执行' in system:
                return {'priorities': [proposal]}
            if '核验产业报告' in system:
                return {'verdicts': [{'index': 0, 'valid': True, 'reason': '产品主体与应用交流边界明确。'}]}
            return raw
        with patch('backend.topic_reports.compose_report', side_effect=AssertionError('no composition')):
            result = build_priority_analysis(research, research, complete)
        self.assertEqual(len(calls), 3)
        self.assertEqual(result['direction_generation']['status'], 'reviewed')
        self.assertEqual(result['plan']['analytical_priorities'][0]['state'], 'reviewed_inference')
        self.assertEqual(research, original)
        text, sources = render_report(result['plan'], research, research, 2)
        self.assertIn('## 二、产业链关系与机会分析', text)
        self.assertIn('## 三、招引研判方向', text)
        self.assertIn('能力与应用协同方向', text)
        self.assertNotIn('补链优先级清单', text)
        self.assertTrue(set(result['plan']['analytical_priorities'][0]['evidence_ids']) <= {row['id'] for row in sources})

    def test_review_rejection_stays_explained_after_one_supplement(self):
        research, raw, _, proposal = capability_case()
        raw['priorities'] = [proposal]
        calls = []
        def complete(system, prompt, budget):
            calls.append(system)
            if '核验产业报告' in system:
                return {'verdicts': [{'index': 0, 'valid': False, 'reason': '尚未明确具体技术交流步骤。'}]}
            if '补充可执行' in system:
                return {'priorities': [proposal]}
            return raw
        result = build_priority_analysis(research, research, complete)
        self.assertEqual(len(calls), 4)
        self.assertEqual(result['plan']['analytical_priorities'], [])
        self.assertEqual(result['direction_generation']['status'], 'review_rejected')
        self.assertEqual(len(result['review_diagnostics']), 2)

    def test_empty_supplement_never_manufactures_template_directions(self):
        research, raw, _, _ = capability_case()
        calls = []
        def complete(system, prompt, budget):
            calls.append(system)
            return {'priorities': []} if '补充可执行' in system else raw
        result = build_priority_analysis(research, research, complete)
        self.assertEqual(len(calls), 2)
        self.assertEqual(result['plan']['analytical_priorities'], [])
        self.assertEqual(result['direction_generation']['status'], 'no_supported_suggestions')

    def test_existing_approved_direction_and_phase_one_do_not_run_supplement(self):
        research, raw, _, proposal = capability_case()
        raw['priorities'] = [proposal]
        calls = []
        def complete(system, prompt, budget):
            calls.append(system)
            if '核验产业报告' in system:
                return {'verdicts': [{'index': 0, 'valid': True, 'reason': '产品主体及行动明确。'}]}
            return raw
        result = build_priority_analysis(research, research, complete)
        self.assertEqual(len(calls), 2)
        self.assertFalse(result['direction_generation']['attempted'])
        raw['priorities'] = []; calls.clear()
        result = build_priority_analysis(research, research, complete, phase=1)
        self.assertEqual(len(calls), 1)
        self.assertFalse(result['direction_generation']['attempted'])

    def test_supplement_disconnection_stops_and_model_failure_is_explained(self):
        research, raw, _, _ = capability_case()
        for failure in (BrokenPipeError('closed'), RuntimeError('model unavailable')):
            calls = []
            def complete(system, prompt, budget):
                calls.append(system)
                if '补充可执行' in system:
                    raise failure
                return raw
            if isinstance(failure, BrokenPipeError):
                with self.assertRaises(BrokenPipeError):
                    build_priority_analysis(research, research, complete)
            else:
                result = build_priority_analysis(research, research, complete)
                self.assertEqual(result['direction_generation']['status'], 'supplement_unavailable')
            self.assertEqual(len(calls), 2)


if __name__ == '__main__': unittest.main()
