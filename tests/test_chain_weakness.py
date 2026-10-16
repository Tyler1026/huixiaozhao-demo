import copy
import unittest

from backend.chain_weakness import build_weakness, _usable_roles, _candidate
from backend.topic_chain import chain_source_catalog
from tests.test_chain_reasoning import research, premise, CONTEXT, CHAIN, FALLBACK


def candidate(bundle, level='strong', roles=None, **changes):
    return dict(node_id='control', level=level, dimension='supply', scope='local',
                premises=roles or [premise(bundle, 'operation')], counter_evidence=[],
                reason='原文披露本地已形成交付支撑。', comparison='按该环节实际供给与交付状态比较。',
                action='继续核对有效供给和订单。', missing=['实际订单覆盖范围'],
                limitations=['不能代表所有规格和所有企业。'], **changes)


def run(bundle, rows, review=True):
    calls = []
    def complete(system, payload, tokens):
        calls.append((system, payload))
        if len(calls) == 1:
            return {'nodes': rows}
        proposals = __import__('json').loads(payload)['proposals']
        return {'verdicts': [{'node_id': row['node_id'], 'valid': review, 'reason': '核对原句与范围。'} for row in proposals]}
    return build_weakness(CONTEXT, bundle, CHAIN, FALLBACK, complete), calls


class WeaknessTests(unittest.TestCase):
    def test_actual_delivery_support_can_be_green_without_changing_factual_assessment(self):
        bundle = research(['闵行区飞控系统生产线已投产，并已实现批量交付，相关产品正在运行。'])
        original = copy.deepcopy(FALLBACK)
        out, calls = run(bundle, [candidate(bundle)])
        self.assertEqual(out['node_judgments']['control']['level'], 'strong')
        self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v3')
        self.assertEqual(len(calls), 2)
        self.assertEqual(FALLBACK, original)

    def test_policy_mentions_never_become_yellow_or_red(self):
        bundle = research(['闵行区支持飞控系统发展，拟建设生产基地，计划形成批量化能力。'])
        for level in ['strong', 'mid', 'weak']:
            out, _ = run(bundle, [candidate(bundle, level)])
            self.assertEqual(out['node_judgments']['control']['level'], 'unknown')

    def test_current_prototype_constraint_is_distinct_from_finished_production(self):
        bundle = research(['闵行区飞控系统当前仍处于样机验证阶段，尚未量产，交付能力受到制约。'])
        out, _ = run(bundle, [candidate(bundle, 'mid', [premise(bundle, 'maturity')])])
        self.assertEqual(out['node_judgments']['control']['level'], 'mid')
        green, _ = run(bundle, [candidate(bundle)])
        self.assertEqual(green['node_judgments']['control']['level'], 'unknown')

    def test_explicit_local_input_dependency_can_be_assessed(self):
        bundle = research(['闵行区飞控系统采用进口芯片，关键输入主要依赖外购，存在供应约束。'])
        out, _ = run(bundle, [candidate(bundle, 'weak', [premise(bundle, 'dependency')])])
        self.assertEqual(out['node_judgments']['control']['level'], 'weak')

    def test_national_dependency_without_local_connection_does_not_rate_local_node(self):
        bundle = research(['全国飞控系统关键芯片主要依赖进口，行业存在供应风险。'], titles=['全国行业报告'])
        out, _ = run(bundle, [candidate(bundle, 'weak', [premise(bundle, 'dependency')])])
        self.assertEqual(out['node_judgments']['control']['level'], 'unknown')

    def test_no_constraint_means_no_mid_or_weak(self):
        bundle = research(['闵行区飞控系统生产线已投产，并已实现批量交付。'])
        for level in ['mid', 'weak']:
            out, _ = run(bundle, [candidate(bundle, level)])
            self.assertEqual(out['node_judgments']['control']['level'], 'strong')
            self.assertNotIn('缺口', out['node_judgments']['control']['reason'])

    def test_denied_dependency_does_not_become_real_constraint(self):
        bundle = research(['闵行区飞控系统并不依赖进口芯片，已形成自主可控方案。'])
        out, _ = run(bundle, [candidate(bundle, 'weak', [premise(bundle, 'dependency')])])
        self.assertEqual(out['node_judgments']['control']['level'], 'unknown')

    def test_counter_evidence_is_passed_to_review_and_kept_in_result(self):
        bundle = research(['闵行区飞控系统生产线已投产，并已实现批量交付。',
                           '闵行区飞控系统当前存在关键测试能力不足，相关项目需复核。'])
        row = candidate(bundle);row['counter_evidence'] = [premise(bundle, 'constraint', 1)]
        out, calls = run(bundle, [row])
        self.assertIn('counter_evidence', calls[1][1])
        self.assertEqual(len(out['node_judgments']['control']['counter_evidence']), 1)
        rejected, _ = run(bundle, [row], False)
        self.assertEqual(rejected['node_judgments']['control']['level'], 'unknown')

    def test_old_policy_fallback_does_not_reappear_on_review_failure(self):
        bundle = research(['闵行区飞控系统生产线已投产，并已实现批量交付。'])
        out, _ = run(bundle, [candidate(bundle)], False)
        self.assertEqual(out['node_judgments']['control']['level'], 'unknown')
        self.assertEqual(out['judgment']['level'], 'unknown')

    def test_unbound_quote_or_invented_number_cannot_pass(self):
        bundle = research(['闵行区飞控系统生产线已投产，并已实现批量交付。'])
        row = candidate(bundle);row['reason'] = '本地实际交付覆盖率为99%。'
        out, _ = run(bundle, [row])
        self.assertIsNone(_candidate(row, {'control': '飞控系统'}, chain_source_catalog(bundle, CONTEXT), CONTEXT))
        self.assertNotIn('99', out['node_judgments']['control']['reason'])
        bundle['evidence'][0]['quote'] += '伪造内容'
        out, _ = run(bundle, [candidate(bundle)])
        self.assertEqual(out['node_judgments']['control']['level'], 'unknown')

    def test_malformed_nodes_cannot_abort_good_node(self):
        bundle = research(['闵行区飞控系统生产线已投产，并已实现批量交付。'])
        out, _ = run(bundle, [{'node_id': []}, candidate(bundle)])
        self.assertEqual(out['node_judgments']['control']['level'], 'strong')

    def test_named_facility_location_can_bind_separate_operating_fact(self):
        bundle = research(['闵行区青松基地的飞控系统测试项目已建成。',
                           '青松基地飞控系统测试项目已投运并服务客户。'])
        row = candidate(bundle, roles=[premise(bundle, 'local_site', subject='青松基地'),
                                      premise(bundle, 'operation', 1)])
        out, _ = run(bundle, [row])
        self.assertEqual(out['node_judgments']['control']['level'], 'strong')
        # A different named site cannot inherit this location.
        row['premises'][0]['subject'] = '测试项目'
        out, _ = run(bundle, [row])
        # Still literal, but this generic label is not an entity anchor.
        self.assertIsNone(_candidate(row, {'control': '飞控系统'}, chain_source_catalog(bundle, CONTEXT), CONTEXT))
        self.assertEqual(out['node_judgments']['control']['level'], 'strong')

    def test_local_enterprise_delivery_abroad_does_not_imply_local_production(self):
        bundle = research(['闵行企业青松公司生产的飞控系统已交付美国客户。'])
        row = candidate(bundle, roles=[premise(bundle, 'local_affiliation', subject='青松公司'),
                                      premise(bundle, 'operation')])
        row['scope'] = 'local_enterprise'
        out, _ = run(bundle, [row])
        self.assertEqual(out['node_judgments']['control']['level'], 'strong')
        self.assertEqual(out['node_judgments']['control']['scope'], 'local_enterprise')
        row['scope'] = 'local'
        out, _ = run(bundle, [row])
        self.assertEqual(out['node_judgments']['control']['level'], 'unknown')

    def test_completed_event_is_not_overridden_by_prior_planning_paragraph(self):
        bundle = research(['全市计划建设一批飞控系统项目。此前闵行区飞控系统测试基地已建成并正式投运。'])
        out, _ = run(bundle, [candidate(bundle, roles=[premise(bundle, 'operation', sentence=1)])])
        self.assertEqual(out['node_judgments']['control']['level'], 'strong')

    def test_planning_sentences_are_removed_from_actual_comparison_input(self):
        source = {'title': '闵行区产业计划', 'quote': '闵行区计划发展飞控系统，推动形成量产能力。'}
        roles = _usable_roles(source['quote'], source, CONTEXT)
        self.assertNotIn('operation', roles)
        self.assertNotIn('maturity', roles)
        self.assertNotIn('constraint', roles)

    def test_model_can_only_select_prebound_fact_ids(self):
        import json
        bundle = research(['闵行区飞控系统生产线已投产，并已实现批量交付。'])
        def complete(system, payload, tokens):
            data = json.loads(payload)
            if 'proposals' in data:
                return {'verdicts': [{'node_id': 'control', 'valid': True}]}
            facts = [f for e in data['evidence'] for s in e['sentences'] for f in s['facts']]
            operation = next(f for f in facts if f['role'] == 'operation')
            row = candidate(bundle)
            row.pop('premises')
            row['premise_ids'] = [operation['id']]
            return {'nodes': [row]}
        out = build_weakness(CONTEXT, bundle, CHAIN, FALLBACK, complete)
        self.assertEqual(out['node_judgments']['control']['level'], 'strong')

    def test_abstention_can_review_actual_support_without_inventing_a_gap(self):
        bundle = research(['闵行区飞控系统生产线已投产，并已实现批量交付。'])
        out, calls = run(bundle, [{'node_id': 'control', 'level': 'unknown', 'missing': ['当前订单']}])
        self.assertEqual(out['node_judgments']['control']['level'], 'strong')
        self.assertEqual(len(calls), 2)
        rejected, _ = run(bundle, [{'node_id': 'control', 'level': 'unknown'}], False)
        self.assertEqual(rejected['node_judgments']['control']['level'], 'unknown')

    def test_other_product_in_same_paragraph_cannot_supply_baseline(self):
        bundle = research(['闵行区飞控系统仍处于样机验证阶段，尚未量产。闵行区航空电机生产线已投产并批量交付。'])
        out, _ = run(bundle, [{'node_id': 'control', 'level': 'unknown'}])
        self.assertEqual(out['node_judgments']['control']['level'], 'unknown')

    def test_explicit_foreign_production_is_not_local_capacity(self):
        for place in ['外地', '外地工厂', '境外工厂']:
            bundle = research(['闵行区青松公司在'+place+'生产的飞控系统已实现批量交付。'])
            row = candidate(bundle)
            self.assertIsNone(_candidate(row, {'control': '飞控系统'}, chain_source_catalog(bundle, CONTEXT), CONTEXT))

    def test_explicit_candidate_cannot_use_another_products_delivery(self):
        bundle = research(['闵行区飞控系统仍处于样机验证阶段，尚未量产。闵行区航空电机生产线已投产并批量交付。'])
        row = candidate(bundle, roles=[premise(bundle, 'maturity'), premise(bundle, 'operation', sentence=1, subject='航空电机')])
        self.assertIsNone(_candidate(row, {'control': '飞控系统'}, chain_source_catalog(bundle, CONTEXT), CONTEXT))

    def test_review_sees_related_counter_source_even_if_proposal_omits_it(self):
        import json
        bundle = research(['闵行区飞控系统生产线已投产并批量交付，相关产品正在运行。',
                           '闵行区飞控系统生产线已停止生产，尚未恢复供货，当前交付存在严重缺口。'])
        out, calls = run(bundle, [candidate(bundle)], False)
        review = json.loads(calls[1][1])
        self.assertEqual(len(review['sources']), 2)
        self.assertIn(bundle['evidence'][1]['id'], review['related_sources_by_node']['control'])
        self.assertEqual(out['node_judgments']['control']['level'], 'unknown')
        baseline, baseline_calls = run(bundle, [{'node_id': 'control', 'level': 'unknown'}])
        self.assertEqual(baseline['node_judgments']['control']['level'], 'unknown')
        self.assertEqual(len(baseline_calls), 1)


if __name__ == '__main__':
    unittest.main()
