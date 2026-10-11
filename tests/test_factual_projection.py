"""Offline regressions from the immutable Minhang report; no provider calls."""
import copy
import json
import pathlib
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from report_service.full_synthesis import (policy_clauses, project_decision_text, ground_audit_check,
    source_support, evidence_observations, project_company_record, project_location_prose)
from report_service.full_provider import FullLiveProvider
from report_service.full_contract import _validate_checks, merge_evidence_records

FIXTURE = json.loads((pathlib.Path(__file__).parent / 'fixtures/minhang_factual_guard.json').read_text())


class PolicyClauseRegressionTests(unittest.TestCase):
    def setUp(self):
        records = FIXTURE['evidence']
        self.prior = {'policy': {'text': '', 'metadata': {'evidence': [records['startup_policy']]}},
                      'enterprises_1': {'metadata': {'evidence': [records['energy_policy']]}}}

    def test_real_separate_benefits_and_non_policy_stage_evidence(self):
        clauses = policy_clauses(self.prior)
        startup = [c for c in clauses if c['document'] == '闵科委规发〔2025〕2号' and c['article'] == '5']
        self.assertEqual(len(startup), 2)
        self.assertIn('成立不满五年', startup[0]['condition'])
        self.assertNotIn('15%', startup[0]['condition'])
        self.assertIn('营收复合增长率不低于15%', startup[1]['condition'])
        self.assertTrue(any('持续开展研发创新' in c['condition'] for c in clauses))

    def test_real_no_inline_url_clauses_restored_without_other_benefit(self):
        before = copy.deepcopy(self.prior)
        for line in FIXTURE['compact_lines'][2:]:
            if '第5条是唯一' not in line and '第2条适用对象' not in line:
                continue
            result, audit = project_decision_text(line, self.prior)
            self.assertTrue(audit)
            if '第5条是唯一' in line:
                self.assertIn('成立不满五年', result)
                self.assertIn('自主知识产权', result)
                self.assertNotIn('200万元', result)
            else:
                self.assertIn('自主知识产权', result)
                self.assertIn('持续开展研发创新', result)
                self.assertIn('研发投入强度不低于10%', result)
        self.assertEqual(self.prior, before)

    def test_structured_policy_audit_restores_same_complete_clause(self):
        record = FIXTURE['evidence']['energy_policy']
        item = {'claim': '闵经委规发〔2026〕3号第2条对研发投入强度不低于10%的企业给予最高200万元。',
                'category': 'policy', 'source': record['url'], 'cross_source': '', 'year': '2026'}
        got = ground_audit_check(item, [record])
        self.assertIn('持续开展研发创新', got['claim'])
        self.assertIn('自主知识产权', got['claim'])
        self.assertEqual(got['original_claim'], item['claim'])
        self.assertEqual(got['support_status'], 'single_source')

    def test_matching_cap_cannot_hide_changed_benefit_rate(self):
        clause = next(c for c in policy_clauses(self.prior) if c['article'] == '5' and '初创期' in c['condition'])
        wrong = clause['document'] + '第5条：' + clause['clause'].replace('10%', '90%') + '。来源：' + clause['url']
        result, audit = project_decision_text(wrong, self.prior)
        self.assertNotIn('90%', result)
        self.assertIn('10%', result)
        self.assertTrue(audit)
        correct = clause['document'] + '第5条：' + clause['clause']
        result, _ = project_decision_text(correct, self.prior)
        self.assertNotIn('待核事项', result)
        self.assertIn(clause['clause'], result)

    def test_five_restored_clauses_do_not_create_repeated_url_failure(self):
        url = 'https://www.gov.cn/offline-policy'
        evidence = '测试规发〔2026〕1号\n' + '\n'.join(
            f'第{i}条 对具有条件{i}的企业，按照研发经费10%给予最高{i}万元。' for i in range(1, 6))
        prior = {'policy': {'metadata': {'evidence': [{'url': url, 'excerpt': evidence}]}}}
        lines = [f'测试规发〔2026〕1号第{i}条给予最高{i}万元。' for i in range(1, 6)]
        text = '\n'.join(lines + [f'独立核查{i}' for i in range(75)])
        out, _ = project_decision_text(text, prior)
        FullLiveProvider(object())._validate_part_text(out, 80)
        self.assertEqual(out.count(url), 1)
        self.assertIn('前项链接', out)
        existing = lines[0] + ' 来源：' + url
        preserved, _ = project_decision_text(existing, prior)
        self.assertIn(url, preserved)
        original_double = existing + ' ' + url
        double_out, _ = project_decision_text(original_double, prior)
        self.assertEqual(double_out.count(url), 2)
        # Existing bad repetition remains visible to the original guard.
        repeated = '\n'.join(line + ' 来源：' + url for line in lines)
        repeated += '\n' + '\n'.join(f'独立事项{i}' for i in range(75))
        out, _ = project_decision_text(repeated, prior)
        self.assertEqual(out.count(url), 5)
        from report_service.full_provider import FullProviderError
        with self.assertRaises(FullProviderError):
            FullLiveProvider(object())._validate_part_text(out, 80)

    def test_ambiguous_or_different_document_is_not_guessed(self):
        result, audit = project_decision_text('闵科委规发〔2025〕2号第5条补贴50万元或200万元。', self.prior)
        self.assertIn('待核事项', result)
        self.assertNotIn('200万元', result)
        result, _ = project_decision_text('闵科委规发〔2024〕9号第5条补贴50万元。', self.prior)
        self.assertIn('不能唯一定位', result)
        self.assertNotIn('成立不满五年', result)

    def test_clipped_observations_are_not_stitched_into_a_clause(self):
        records = merge_evidence_records([
            {'url': 'https://gov.cn/policy', 'excerpt': '闵科委规发〔2025〕2号\n第五条\n对具有自主知识产权'},
            {'url': 'https://gov.cn/policy', 'excerpt': '的企业，按照研发经费10%给予最高50万元。'}])
        self.assertEqual(policy_clauses({'policy': {'metadata': {'evidence': records}}}), [])


class PerSourceGroundingTests(unittest.TestCase):
    A, B = 'https://stats.gov.cn/a', 'https://gov.cn/b'
    def evidence(self, second=None):
        return [{'url': self.A, 'excerpt': '2025年闵行区统计公报\n\n全年地区生产总值4268.99亿元，比上年增长4.6%。'},
                {'url': self.B, 'excerpt': second or '闵行区2025年地区生产总值为4268.99亿元，增速4.6%。'}]
    def item(self, **kw):
        return dict({'claim': '2025年闵行区地区生产总值4268.99亿元，增长4.6%。',
                     'source': self.A, 'cross_source': self.B, 'year': '2025', 'region': '闵行区',
                     'metric': '地区生产总值', 'category': 'economic', 'verdict': '已印证'}, **kw)

    def test_two_actual_supporting_spans(self):
        got = ground_audit_check(self.item(), self.evidence())
        self.assertEqual(got['support_status'], 'corroborated')
        self.assertTrue(got['source_support']['supported'])
        self.assertTrue(got['cross_source_support']['supported'])

    def test_wrong_year_region_metric_or_precision_cannot_corroborate(self):
        for wrong in ['闵行区2024年地区生产总值4268.99亿元，增长4.6%。',
                      '松江区2025年地区生产总值4268.99亿元，增长4.6%。',
                      '闵行区2025年固定资产投资4268.99亿元，增长4.6%。',
                      '闵行区2025年地区生产总值4269亿元，增长4.6%。']:
            with self.subTest(wrong=wrong):
                got = ground_audit_check(self.item(), self.evidence(wrong))
                self.assertEqual(got['support_status'], 'single_source')
                self.assertEqual(got['claim'], self.item()['claim'])
                self.assertIn('单源', got['verdict'])

    def test_header_cannot_override_conflicting_year_or_district_in_actual_span(self):
        for wrong in ['2025年闵行区统计公报\n\n2024年地区生产总值4268.99亿元，增长4.6%。',
                      '2025年闵行区统计公报\n\n2025年松江区地区生产总值4268.99亿元，增长4.6%。']:
            got = ground_audit_check(self.item(), self.evidence(wrong))
            self.assertEqual(got['support_status'], 'single_source')

    def test_identical_mirrors_are_not_independent(self):
        evidence = self.evidence()
        evidence[1]['excerpt'] = evidence[0]['excerpt']
        self.assertEqual(ground_audit_check(self.item(), evidence)['support_status'], 'single_source')

    def test_missing_second_source_does_not_fabricate_it(self):
        got = ground_audit_check(self.item(cross_source=''), self.evidence())
        self.assertEqual(got['cross_source'], '')
        self.assertEqual(got['support_status'], 'single_source')

    def test_zero_support_keeps_pending_entry_and_original_claim(self):
        got = ground_audit_check(self.item(claim='2025年闵行区地区生产总值9999亿元。'), self.evidence())
        self.assertEqual(got['support_status'], 'pending')
        self.assertIn('待核实', got['verdict'])
        self.assertIn('9999', got['claim'])
        self.assertFalse(got['source_support']['supported'])

    def test_exact_quote_cannot_forge_joined_observations(self):
        records = merge_evidence_records([{'url': self.A, 'excerpt': '总投资'},
                                         {'url': self.A, 'excerpt': '560000万元。'}])
        got = source_support('总投资56亿元。', evidence_observations(evidence=records), self.A,
                             quote='总投资560000万元。')
        self.assertFalse(got['supported'])

    def test_money_conversion_is_preserved(self):
        got = source_support('总投资56亿元。', evidence_observations(evidence=[
            {'url': self.A, 'excerpt': '项目总投资560000万元。'}]), self.A)
        self.assertTrue(got['supported'])

    def test_real_gdp_primary_source_is_preserved_and_false_cross_is_removed(self):
        primary = FIXTURE['evidence']['gdp_primary']
        false_cross = FIXTURE['evidence']['gdp_wrong_cross']
        got = ground_audit_check(self.item(source=primary['url'], cross_source=false_cross['url']), [primary, false_cross])
        self.assertEqual(got['support_status'], 'single_source')
        prior = {'economy': {'metadata': {'evidence': [primary, false_cross]}}}
        result, audit = project_decision_text(FIXTURE['compact_lines'][0], prior)
        self.assertIn('4268.99亿元', result)
        self.assertIn('单源支持', result)
        self.assertNotIn('与上海市政府', result)
        self.assertIn(primary['url'], result)
        self.assertTrue(audit)

    def test_no_reference_never_borrows_other_district_or_company_same_number(self):
        for claim, source in [('2025年闵行区GDP4268.99亿元，增长4.6%。', '2025年松江区GDP4268.99亿元，增长4.6%。'),
                              ('甲公司营业收入100亿元。', '乙公司营业收入100亿元。')]:
            prior = {'economy': {'metadata': {'evidence': [{'url': self.A, 'excerpt': source}]}}}
            result, _ = project_decision_text(claim, prior, place='上海市闵行区')
            self.assertIn('待核事项', result)
            self.assertNotIn('亿元', result)

    def test_economic_growth_is_not_cut_as_attribution(self):
        prior = {'economy': {'metadata': {'evidence': [{'url': self.A, 'excerpt': '2025年闵行区GDP4268.99亿元，经济增长4.6%。'}]}}}
        result, _ = project_decision_text('2025年闵行区GDP4268.99亿元，经济增长999%。', prior, place='上海市闵行区')
        self.assertIn('待核事项', result)
        self.assertNotIn('999', result)

    def test_numeric_projection_does_not_hide_rank_uncertainty(self):
        prior = {'economy': {'text': '经济总量位居全市第二：仅自媒体说法，待核实。',
                 'metadata': {'evidence': [{'url': self.A,
                     'excerpt': '2025年闵行区GDP4268.99亿元，位居全市第二，此排名为自媒体说法待核实。'}]}}}
        result, _ = project_decision_text('2025年闵行区GDP4268.99亿元，位居全市第二。', prior, place='上海市闵行区')
        self.assertIn('4268.99亿元', result)
        self.assertIn('该排名尚未获得原文核验', result)

    def test_values_cannot_cross_subject_region_or_year_inside_one_sentence(self):
        cases = [('甲公司营业收入100亿元。', '甲公司营业收入10亿元，乙公司营业收入100亿元。'),
                 ('2025年闵行区GDP100亿元。', '2025年闵行区GDP10亿元，松江区GDP100亿元。'),
                 ('2025年闵行区GDP100亿元。', '2024年闵行区GDP100亿元，2025年闵行区GDP10亿元。'),
                 ('2025年闵行区GDP100亿元。', '2025年闵行区GDP10亿元，固定资产投资100亿元。'),
                 ('2025年闵行区GDP90亿元。', '2025年闵行区GDP100亿元，其中第三产业增加值90亿元。'),
                 ('甲公司营业收入90亿元。', '甲公司营业收入100亿元，其中出口收入90亿元。')]
        for claim, excerpt in cases:
            with self.subTest(excerpt=excerpt):
                observed = evidence_observations(evidence=[{'url': self.A, 'excerpt': excerpt}])
                self.assertFalse(source_support(claim, observed, self.A)['supported'])
        observed = evidence_observations(evidence=[{'url': self.A, 'excerpt': '2025年闵行区GDP100亿元，增长4.6%。'}])
        self.assertTrue(source_support('2025年闵行区GDP100亿元，增长4.6%。', observed, self.A)['supported'])

    def test_no_inline_reference_does_not_bypass_missing_numeric_evidence(self):
        result, _ = project_decision_text('9. 2025年闵行区地区生产总值9999亿元。', {})
        self.assertIn('待核事项', result)
        self.assertNotIn('9999', result)
        self.assertEqual(len(result.splitlines()), 1)


class CompanyLocationTests(unittest.TestCase):
    URL = 'https://issuer.example/report'
    def company(self, **kwargs):
        return dict({'name': '东富龙科技集团股份有限公司', 'url': self.URL, 'evidence_ref': self.URL,
                     'landing_status': '已落地', 'reason': '注册地址普陀区中山北路900号。'}, **kwargs)

    def test_footer_and_another_subject_address_do_not_ground_company(self):
        for excerpt in ['东富龙科技集团股份有限公司年度报告\n\n正文谈业务。\n版权所有\n地址：普陀区中山北路900号。',
                        '东富龙科技集团股份有限公司年度报告\n\n乙公司注册地址普陀区中山北路900号。']:
            got = project_company_record(self.company(), [{'url': self.URL, 'excerpt': excerpt}], place='上海市闵行区')
            self.assertEqual(got['landing_status'], '待核实')
            self.assertNotIn('中山北路900号', got['reason'])
            self.assertIn('original_fields', got['location_projection'])

    def test_named_registration_body_is_accepted_city_presence_is_not_district_presence(self):
        evidence = [{'url': self.URL, 'excerpt': '东富龙科技集团股份有限公司年度报告\n\n公司注册地址：上海市闵行区都会路1509号4幢。'}]
        got = project_company_record(self.company(reason='注册地址上海市闵行区都会路1509号4幢。'), evidence, place='上海市闵行区')
        self.assertEqual(got['landing_status'], '已落地')
        self.assertNotIn('location_projection', got)
        evidence = [{'url': self.URL, 'excerpt': '东富龙科技集团股份有限公司总部位于上海市。'}]
        self.assertEqual(project_company_record(self.company(), evidence, place='上海市闵行区')['landing_status'], '待核实')

    def test_news_mention_cannot_lend_issuer_identity_to_unattributed_address(self):
        evidence = [{'url': self.URL, 'excerpt': '新闻介绍东富龙科技集团股份有限公司和乙公司合作情况\n\n公司注册地址：闵行区都会路1509号。'}]
        got = project_company_record(self.company(reason='注册地址闵行区都会路1509号。'), evidence, place='上海市闵行区')
        self.assertEqual(got['landing_status'], '待核实')
        self.assertNotIn('都会路1509号', got['reason'])

    def test_another_company_in_same_sentence_cannot_lend_its_address(self):
        evidence = [{'url': self.URL, 'excerpt': '东富龙科技集团股份有限公司与乙公司合作，乙公司注册地址：上海市闵行区都会路1509号4幢。'}]
        got = project_company_record(self.company(reason='注册地址上海市闵行区都会路1509号4幢。'), evidence, place='上海市闵行区')
        self.assertEqual(got['landing_status'], '待核实')
        self.assertNotIn('都会路1509号', got['reason'])

    def test_generic_local_business_action_plan_is_not_a_landing_assertion(self):
        line = '100. 建议梳理本市存量企业，逐家核查其注册主体、项目地址与服务需求。'
        result, audit = project_location_prose(line, [], [], place='上海市闵行区')
        self.assertEqual(result, line)
        self.assertEqual(audit, [])

    def test_unknown_and_intent_are_not_confirmed_as_landed(self):
        evidence = [{'url': self.URL, 'excerpt': '东富龙科技集团股份有限公司计划在闵行区新建基地。'}]
        self.assertEqual(project_company_record(self.company(), evidence, place='上海市闵行区')['landing_status'], '待核实')
        self.assertEqual(project_company_record(self.company(landing_status='拟落地'), evidence, place='上海市闵行区')['landing_status'], '拟落地')
        self.assertEqual(project_company_record(self.company(landing_status='未落地'), evidence, place='上海市闵行区')['landing_status'], '待核实')

    def test_unbound_freeform_location_is_removed_not_appended_with_disclaimer(self):
        result, audit = project_location_prose('本市存量企业服务：东富龙注册地在普陀区。', [], [], place='上海市闵行区')
        self.assertNotIn('普陀区', result)
        self.assertIn('待核事项', result)
        self.assertTrue(audit)


class IncompleteAuditContractTests(PerSourceGroundingTests):
    def errors(self, entry, evidence):
        metadata = {'checks': [entry], 'evidence': evidence, 'high_star_unavailable': True}
        return [error for error in _validate_checks('fact_check', metadata, False)
                if 'missing cross_source' in error]

    def test_explicit_single_source_and_pending_allow_empty_second_but_not_forgery(self):
        evidence = self.evidence()
        good = ground_audit_check(self.item(cross_source=''), evidence)
        self.assertEqual(self.errors(good, evidence), [])
        pending = ground_audit_check(self.item(claim='地区生产总值9999亿元。', cross_source=''), evidence)
        self.assertEqual(self.errors(pending, evidence), [])
        for bad in [dict(good, support_status='passed'), dict(good, support_status={}), dict(good, support_gap=''),
                    dict(good, category='high_star'), dict(good, source=''),
                    dict(good, claim='地区生产总值9999亿元。'),
                    dict(good, source_support={'supported': 'true', 'quote': 'fake'})]:
            self.assertTrue(self.errors(bad, evidence))

    def test_deep_never_accepts_incomplete_status(self):
        from report_service.full_contract import _validate_checks
        evidence = self.evidence()
        good = ground_audit_check(self.item(cross_source=''), evidence)
        errors = _validate_checks('fact_check', {'checks': [good], 'evidence': evidence}, False, mode='deep')
        self.assertTrue(any('missing cross_source' in e for e in errors))
        self.assertTrue(any('requires two grounded' in e for e in errors))
        provider = FullLiveProvider(object())
        self.assertEqual(provider._ground_checks('fact_check', [self.item(cross_source='')], evidence, mode='deep'), [])
        self.assertEqual(len(provider._ground_checks('fact_check', [self.item()], evidence, mode='deep')), 1)


class ProviderProjectionBoundaryTests(unittest.TestCase):
    def test_distinct_reporting_years_remain_distinct_pending_work(self):
        lines = [f'{year}年甲公司营业收入{year - 1900}亿元。' for year in range(2000, 2025)]
        lines += [f'独立核查事项{i}。' for i in range(55)]
        provider = FullLiveProvider(SimpleNamespace(enabled=True, _validate_endpoints=lambda: None))
        provider._chat_part = Mock(return_value=json.dumps({'text': '\n'.join(lines)}))
        provider._gather_evidence = Mock(side_effect=AssertionError('no search'))
        out = provider.run_part('compact', '精简报告', {'city': '测试区'}, {})
        self.assertEqual(provider._chat_part.call_count, 1)
        self.assertEqual(len(set(out['text'].splitlines())), 80)
        self.assertIn('2000年甲公司', out['text'])
        self.assertIn('2024年甲公司', out['text'])
        self.assertNotIn('100亿元', out['text'])

    def test_existing_one_correction_does_not_loop_and_prior_stays_immutable(self):
        text = '经济总量居全市第二。\n' + '\n'.join(f'独立核查事项{i}。' for i in range(79))
        provider = FullLiveProvider(SimpleNamespace(enabled=True, _validate_endpoints=lambda: None))
        provider._chat_part = Mock(return_value=json.dumps({'text': text}))
        provider._gather_evidence = Mock(side_effect=AssertionError('no extra search'))
        prior = {'economy': {'text': '全市第二来自自媒体，待核实。', 'metadata': {}}}
        before = copy.deepcopy(prior)
        out = provider.run_part('compact', '精简报告', {'city': '测试区'}, prior)
        self.assertEqual(provider._chat_part.call_count, 2)
        provider._gather_evidence.assert_not_called()
        self.assertEqual(prior, before)
        self.assertIn('尚未获得原文核验', out['text'])
        self.assertEqual(len(out['text'].splitlines()), 80)
        self.assertIn('factual_projection', out['metadata'])
