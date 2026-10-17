"""Regression cases from the isolated five-topic run of 2026-10-17."""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from backend.chain_weakness import _candidate, _literal_record, build_weakness
from backend.public_research import _companion_index, _city_terms
from tests.test_chain_reasoning import CONTEXT, FALLBACK, research, premise, enterprise_research
from tests.test_chain_weakness import candidate


FIXTURE = json.loads((Path(__file__).parent / 'fixtures/chain_weakness_audit_20261017.json').read_text())


def live_case(topic, name):
    case = FIXTURE[topic]
    row = next(p for p in case['proposals'] if p['name'] == name)
    context = dict(case['context'], _entity_index=_companion_index(
        list(case['catalog'].values()), _city_terms(case['context']['city'])))
    context['_fact_refs'] = [p for node in case['proposals'] for p in node['premises']]
    return copy.deepcopy(row), {row['node_id']: name}, case['catalog'], context


class OriginalFactBindingTests(unittest.TestCase):
    def test_real_national_medium_share_is_not_one_enterprises_dependency(self):
        args = live_case('bio', '细胞培养基')
        self.assertIsNone(_candidate(*args))

    def test_real_bag_membrane_dependency_does_not_transfer_to_reaction_system(self):
        self.assertIsNone(_candidate(*live_case('bio', '一次性反应系统')))
        valid = _candidate(*live_case('bio', '生物反应袋'))
        self.assertIsNotNone(valid)
        self.assertEqual(valid['scope'], 'local_enterprise')
        self.assertTrue(any('进口膜材' in p['statement'] for p in valid['premises']))

    def test_real_industry_constraint_keeps_specific_local_business_boundary(self):
        row, names, catalog, context = live_case('bio', '培养基')
        valid = _candidate(row, names, catalog, context)
        self.assertIsNotNone(valid)
        self.assertEqual(valid['scope'], 'industry_shared')
        row['scope'] = 'local_enterprise'
        self.assertIsNone(_candidate(row, names, catalog, context))

    def test_real_electrolyzer_proposal_has_no_specific_local_activity(self):
        self.assertIsNone(_candidate(*live_case('energy', '电解槽')))

    def test_real_same_company_delivery_and_local_project_application_stay_valid(self):
        for name, scope in [('镁基固态储氢产品', 'local_enterprise'), ('全钒液流电池', 'local')]:
            with self.subTest(name=name):
                valid = _candidate(*live_case('energy', name))
                self.assertIsNotNone(valid)
                self.assertEqual(valid['scope'], scope)

    def test_real_test_base_is_not_citywide_verification_environment_shortage(self):
        self.assertIsNone(_candidate(*live_case('lowair', '闵行试飞基地')))

    def test_real_test_base_operating_fact_survives_invalid_proposal(self):
        row, names, catalog, context = live_case('lowair', '闵行试飞基地')
        calls = []
        def complete(system, payload, budget):
            data = json.loads(payload)
            calls.append(data)
            if 'proposals' not in data:
                return {'nodes': [row]}
            self.assertEqual(data['proposals'][0]['proposal_kind'], 'actual_support_baseline')
            self.assertNotIn('尚未形成成熟验证能力', data['proposals'][0]['reason'])
            return {'verdicts': [{'node_id': row['node_id'], 'valid': True, 'reason': '同一基地明确落地运营。'}]}
        chain = {'chain': [{'nodes': [{'id': row['node_id'], 'name': row['name']}]}]}
        with patch('backend.chain_weakness.chain_source_catalog', return_value=catalog):
            result = build_weakness(context, {}, chain, FALLBACK, complete)
        judgment = result['node_judgments'][row['node_id']]
        self.assertEqual(judgment['level'], 'strong')
        self.assertEqual(judgment['scope'], 'local')
        self.assertTrue(any('这一基地的落地运营' in p['statement'] for p in judgment['premises']))
        self.assertEqual(len(calls), 2)

    def test_market_background_in_same_disclosure_is_not_enterprise_capability(self):
        bundle = enterprise_research(business_text='我国飞控系统市场主要依赖进口，国外厂商占据较高市场份额。')
        from backend.topic_chain import chain_source_catalog
        catalog = chain_source_catalog(bundle, CONTEXT)
        self.assertIsNone(_literal_record(premise(bundle, 'enterprise_capability', 1), catalog, CONTEXT))

    def test_dependency_on_different_named_product_same_sentence_is_not_inherited(self):
        from backend.topic_chain import chain_source_catalog
        bundle = enterprise_research(business_text='飞控系统已经投产，航空电机采用进口材料。')
        catalog = chain_source_catalog(bundle, CONTEXT)
        row = candidate(bundle, 'mid', [premise(bundle, 'local_presence', subject='示例装备股份有限公司'),
            premise(bundle, 'enterprise_capability', 1), premise(bundle, 'dependency', 1)])
        row['scope'] = 'local_enterprise'
        self.assertIsNone(_candidate(row, {'control': '飞控系统', 'other': '航空电机'}, catalog, CONTEXT))
        # The other product need not already be a displayed graph node.
        self.assertIsNone(_candidate(row, {'control': '飞控系统'}, catalog, CONTEXT))

    def test_test_service_constraint_is_not_product_constraint(self):
        from backend.topic_chain import chain_source_catalog
        bundle = research(['闵行区飞控系统测试服务能力不足。'])
        row = candidate(bundle, 'mid', [premise(bundle, 'constraint')])
        self.assertIsNone(_candidate(row, {'control': '飞控系统'}, chain_source_catalog(bundle, CONTEXT), CONTEXT))

    def test_unselected_orders_cannot_be_written_into_reason(self):
        from backend.topic_chain import chain_source_catalog
        bundle = research(['闵行区飞控系统当前仍处于样机验证阶段。', '闵行区飞控系统已获得订单。'])
        row = candidate(bundle, 'mid', [premise(bundle, 'maturity')])
        row['reason'] = '飞控系统已有订单，但处于样机验证阶段。'
        self.assertIsNone(_candidate(row, {'control': '飞控系统'}, chain_source_catalog(bundle, CONTEXT), CONTEXT))


class ReviewRecoveryTests(unittest.TestCase):
    def run_recovery(self, second_verdict=True):
        bundle = research(['闵行区飞控系统测试基地已正式投运，相关测试服务已经运行。',
                           '闵行区飞控系统目前存在配套能力不足，部分测试须外协。'])
        row = candidate(bundle, 'mid', [premise(bundle, 'operation'), premise(bundle, 'constraint', 1)])
        calls = []
        def complete(system, payload, budget):
            data = json.loads(payload); calls.append(data)
            if 'proposals' not in data: return {'nodes': [row]}
            return {'verdicts': [{'node_id': 'control', 'valid': second_verdict if len(calls) == 3 else False,
                                 'reason': '仅独立审核给定范围内的运行基础。'}]}
        from tests.test_chain_reasoning import CHAIN
        return build_weakness(CONTEXT, bundle, CHAIN, FALLBACK, complete), calls

    def test_rejected_weakness_can_review_new_limited_operational_baseline(self):
        result, calls = self.run_recovery()
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[1]['proposals'][0]['level'], 'mid')
        self.assertEqual(calls[2]['proposals'][0]['proposal_kind'], 'actual_support_baseline')
        self.assertNotIn('配套能力不足', calls[2]['proposals'][0]['reason'])
        # Opposing material is still visible on the second review.
        self.assertTrue(any('配套能力不足' in source['quote'] for source in calls[2]['sources']))
        self.assertEqual(result['node_judgments']['control']['level'], 'strong')
        self.assertEqual([d['stage'] for d in result['review_diagnostics']], ['primary', 'limited_basis'])

    def test_rejected_baseline_is_never_promoted_without_review(self):
        result, calls = self.run_recovery(False)
        self.assertEqual(len(calls), 3)
        self.assertEqual(result['node_judgments']['control']['level'], 'unknown')

    def test_multiple_actual_names_in_one_sentence_are_available_as_separate_facts(self):
        context = dict(CONTEXT, topic='聚变能源前沿赛道培育招商')
        bundle = research(['全球目前正运行的全超导装置仅4台，我国科创企业能量奇点自主研制的“洪荒70”，是其中唯一一台全高温超导材质建造的托卡马克。'])
        bundle['topic'] = context['topic']
        chain = {'chain': [{'nodes': [{'id': 'device', 'name': '洪荒70'}, {'id': 'kind', 'name': '托卡马克'}]}]}
        calls = []
        def complete(system, payload, budget):
            data = json.loads(payload); calls.append(data)
            return {'nodes': [{'node_id': n['node_id'], 'level': 'unknown'} for n in data['nodes']]}
        result = build_weakness(context, bundle, chain, FALLBACK, complete)
        facts = [f for e in calls[0]['evidence'] for s in e['sentences'] for f in s['facts']]
        subjects = {f['subject'] for f in facts if f['role'] == 'operation'}
        self.assertEqual(subjects, {'洪荒70', '托卡马克'})
        # A national device is still not local production or local participation.
        self.assertTrue(all(j['level'] == 'unknown' for j in result['node_judgments'].values()))


if __name__ == '__main__':
    unittest.main()
