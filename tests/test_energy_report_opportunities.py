"""Actual engineering constraints and explicitly separate planning opportunities."""
import copy
import json
import unittest

from backend.report_analysis import analytical_priority, policy_context, review_priorities
from backend.topic_reports import evidence_catalog
from test_report_analysis import bundle


TOPIC = '氢基能源与长时储能装备补链'


def proposal(focus, sid, **extra):
    return dict({'focus': focus, 'scope': 'industry', 'constraint_ids': [sid],
        'comparison': '比较公开披露的产品运行条件与实际应用要求，不外推为本地缺失。',
        'reason': f'{focus}的具体技术条件影响应用验证，可以在该范围内开展产品研究。',
        'action': f'围绕{focus}明确技术指标，再开展实际工况验证和产品对接。'}, **extra)


class EnergyConstraintTests(unittest.TestCase):
    def test_archived_paper_validation_constraint_keeps_substitution_counterevidence_and_industry_scope(self):
        from backend.public_research import load_public_research
        library = load_public_research()
        rows = [row for row in library['evidence'] if row.get('archive_file') == 'energy-demand-and-validation.json']
        if not rows:
            rows = [row for row in library['evidence'] if '液流电池关键材料发展研究' in row.get('title', '')]
        original = next(row for row in rows if '非氟离子膜的长期化学稳定性仍需大量工程实践验证' in row['quote'])
        counter = next(row for row in rows if '超过80%的国产化替代' in row['quote'])
        research = {'status': 'ready', 'city': '闵行区', 'topic': TOPIC,
                    'evidence': [original, counter], 'sources': library['sources']}
        catalog = evidence_catalog(research)
        row = proposal('非氟离子膜', original['id'], counter_ids=[counter['id']])
        accepted = analytical_priority(row, catalog, research, [])
        self.assertIsNotNone(accepted)
        self.assertEqual(accepted['counter_ids'], [counter['id']])
        self.assertEqual(accepted['scope'], 'industry')
        self.assertEqual(catalog[original['id']]['quote'], original['quote'])
        row['scope'] = 'local'
        self.assertIsNone(analytical_priority(row, catalog, research, []))

    def test_paper_material_stability_requires_engineering_validation(self):
        quote = '非氟离子膜的长期化学稳定性仍需大量工程实践验证。'
        research = bundle([{'title': '液流电池关键材料发展研究', 'source_type': 'research',
            'quote': quote, 'url': 'https://www.engineering.org.cn/sscae/CN/10.15302/J-SSCAE-2025.10.021'}], topic=TOPIC)
        sid = research['evidence'][0]['id']
        result = analytical_priority(proposal('非氟离子膜', sid), evidence_catalog(research), research, [])
        self.assertIsNotNone(result)
        self.assertEqual(result['scope'], 'industry')
        self.assertEqual(result['opportunity_type'], 'constraint')
        research['evidence'][0]['quote'] = '计划开展非氟离子膜的长期化学稳定性工程实践验证。'
        self.assertIsNone(analytical_priority(proposal('非氟离子膜', sid), {sid: research['evidence'][0]}, research, []))

    def test_current_condition_survives_later_future_or_support_clause(self):
        cases = [
            ('氢气压缩机', '氢气压缩机目前交付周期较长并支持客户使用备用设备，以维持现有业务运行。'),
            ('液流电池', '液流电池目前存在材料稳定性不足，后续计划开展长期运行条件验证。'),
            ('液流电池', '液流电池当前材料成本偏高并计划进一步优化，相关研究尚在持续开展。'),
            ('储能系统', '储能系统电网接入手续复杂、并网进度慢，当前已按要求开展专项协调。'),
            ('液流电池', '液流电池循环效率偏低，相关企业已披露工程运行条件和应用场景。'),
        ]
        for focus, quote in cases:
            research = bundle([{'quote': quote}], topic=TOPIC)
            sid = research['evidence'][0]['id']
            with self.subTest(quote=quote):
                result = analytical_priority(proposal(focus, sid), evidence_catalog(research), research, [])
                self.assertIsNotNone(result)
                self.assertEqual(result['opportunity_type'], 'constraint')

    def test_actual_demand_is_not_deleted_by_functional_support_word(self):
        research = bundle([{'quote': '电解槽当前存在实际采购需求，以支持绿氢项目运行，企业正在开展设备性能评估。'}], topic=TOPIC)
        sid = research['evidence'][0]['id']
        result = analytical_priority(proposal('电解槽', sid, constraint_ids=[], demand_ids=[sid]), evidence_catalog(research), research, [])
        self.assertIsNotNone(result)

    def test_plans_denials_and_solved_constraints_are_still_not_actual_gaps(self):
        for quote in ('未来两年，液流电池将存在较大的采购需求，需要进一步开展产品布局。',
                      '目前计划解决液流电池材料稳定性不足，相关工程工作正在按计划推进。',
                      '液流电池材料稳定性不足的问题已得到解决，产品现在已完成长期验证。',
                      '支持液流电池企业解决材料稳定性不足，推动关键技术攻关和工程应用。'):
            research = bundle([{'quote': quote}], topic=TOPIC)
            sid = research['evidence'][0]['id']
            with self.subTest(quote=quote):
                self.assertIsNone(analytical_priority(proposal('液流电池', sid), evidence_catalog(research), research, []))

    def test_resolution_of_the_same_problem_is_retained_but_another_problem_does_not_erase_constraint(self):
        cases = [
            ('液流电池材料稳定性不足，但这一问题已得到解决，现已完成连续运行验证。', False),
            ('液流电池材料稳定性不足，电解槽的交付问题已得到解决，相关项目继续运行。', True),
        ]
        for quote, accepted in cases:
            research = bundle([{'quote': quote}], topic=TOPIC); sid = research['evidence'][0]['id']
            with self.subTest(quote=quote):
                self.assertEqual(analytical_priority(proposal('液流电池', sid), evidence_catalog(research), research, []) is not None, accepted)


class PlanningOpportunityTests(unittest.TestCase):
    def data(self):
        research = bundle([{'title': '闵行区先进能源装备产业发展规划',
            'quote': '闵行区重点发展绿氢制备，吸引储氢设备制造和氢能应用场景运营企业集聚，完善产业配套。'}], topic=TOPIC)
        sid = research['evidence'][0]['id']
        plan = proposal('储氢设备', sid, scope='local', opportunity_type='planned_development', constraint_ids=[],
            policy_ids=[sid], comparison='本地产业规划明确培育储氢设备，对照现有资料，不据此认定本地已有产业缺口。',
            reason='储氢设备是正式规划中的具体培育方向，可以结合承接条件研究项目机会。',
            action='围绕储氢设备，先梳理载体条件与产品验证要求，再对接潜在项目。')
        return research, sid, plan

    def test_local_official_plan_supports_a_distinct_reviewable_opportunity(self):
        research, sid, plan = self.data(); original = copy.deepcopy(research)
        catalog = evidence_catalog(research)
        result = analytical_priority(plan, catalog, research, [])
        self.assertIsNotNone(result)
        self.assertEqual(result['policy_ids'], [sid])
        self.assertEqual(result['constraint_ids'], [])
        self.assertEqual(result['demand_ids'], [])
        self.assertEqual(result['state'], 'pending_review')
        calls = []
        approved, _ = review_priorities([result], catalog, research,
            lambda system, payload, budget: calls.append((system, json.loads(payload))) or
            {'verdicts': [{'index': 0, 'valid': True, 'reason': '该正式规划支持有边界的培育建议。'}]})
        self.assertEqual(approved[0]['state'], 'reviewed_inference')
        self.assertIn('仅指规划辖区', calls[0][0])
        self.assertEqual(research, original)

    def test_missing_draft_foreign_company_and_generic_policy_are_rejected(self):
        research, sid, plan = self.data()
        variants = [('missing', lambda r, p: p.update(policy_ids=[])),
                    ('draft', lambda r, p: r['evidence'][0].update(title='闵行区能源产业发展规划（征求意见稿）')),
                    ('foreign', lambda r, p: r['evidence'][0].update(title='松江区产业规划', quote=r['evidence'][0]['quote'].replace('闵行区', '松江区'))),
                    ('company', lambda r, p: r['evidence'][0].update(source_type='company')),
                    ('generic', lambda r, p: p.update(focus='关键原材料'))]
        for name, change in variants:
            copy_research, copy_plan = copy.deepcopy(research), copy.deepcopy(plan)
            change(copy_research, copy_plan)
            # Keep this unit focused on policy meaning, not archived-hash validation.
            catalog = {sid: dict(evidence_catalog(research)[sid], **copy_research['evidence'][0])}
            with self.subTest(name=name):
                self.assertIsNone(analytical_priority(copy_plan, catalog, copy_research, []))

    def test_planning_cannot_claim_an_actual_local_shortage(self):
        research, _, plan = self.data()
        for reason in ('储氢设备是规划方向，因此本地储氢设备供应不足，必须优先引进生产企业。',
                       '储氢设备是规划发展方向，本区没有储氢设备供应商，应建立生产能力。'):
            plan['reason'] = reason
            with self.subTest(reason=reason):
                self.assertIsNone(analytical_priority(plan, evidence_catalog(research), research, []))

    def test_reviewer_rejection_cannot_publish_the_planning_opportunity(self):
        research, _, plan = self.data(); catalog = evidence_catalog(research)
        row = analytical_priority(plan, catalog, research, [])
        approved, diagnostics = review_priorities([row], catalog, research,
            lambda *args: {'verdicts': [{'index': 0, 'valid': False, 'reason': '承接条件分析不足。'}]})
        self.assertEqual(approved, [])
        self.assertFalse(diagnostics[0]['valid'])

    def test_ended_plan_period_is_historical_but_current_plan_is_usable(self):
        from datetime import date
        research, sid, plan = self.data()
        for period, expected in [('2021—2025年', False), ('十四五', False), ('十三五', False),
                                 ('十五五', True), ('2026-2030年', True)]:
            row = dict(evidence_catalog(research)[sid], title=f'闵行区{period}先进能源装备产业发展规划')
            with self.subTest(period=period):
                policy = policy_context(row, as_of=date(2026, 10, 20))
                self.assertEqual(policy['status'] != 'expired', expected)
                self.assertEqual(analytical_priority(plan, {sid: row}, research, []) is not None, expected)
                self.assertIn('储氢设备', row['quote'], 'Historical source text remains untouched')

    def test_industrial_planning_does_not_invent_missing_subsidy_documents(self):
        research, sid, _ = self.data(); context = policy_context(evidence_catalog(research)[sid])
        self.assertEqual(context['kind'], 'industrial_plan')
        self.assertEqual(context['limitations'], [])
        grant = policy_context({'title': '闵行区产业扶持政策',
            'quote': '对符合条件的企业给予最高100万元补助，具体申报按实施细则执行。'})
        self.assertEqual(grant['kind'], 'support_policy')
        self.assertTrue(grant['limitations'])


if __name__ == '__main__': unittest.main()
