import copy
import unittest
import json
import datetime
from types import SimpleNamespace
from unittest.mock import Mock
from report_service.full_synthesis import synthesis_issues, correction_context
from report_service.company_identity import company_identity


class SynthesisGroundingTests(unittest.TestCase):
    def setUp(self):
        self.url = 'https://www.yixing.gov.cn/doc/2026/01/28/1378477.shtml'
        self.prior = {
            'economy': {'text': '全市第二来自自媒体整理，待官方原文核实。', 'metadata': {}},
            'policy': {'text': '第5条对成立不满五年、具有自主知识产权且在细分领域有较强竞争力产品或服务的初创期企业，按不超过上年度研发经费10%给予最高50万元奖励。', 'metadata': {}},
            'enterprises_1': {'text': '', 'metadata': {'evidence': [
                {'url': self.url, 'excerpt': '江苏银环精密钢管有限公司入选国家高新技术成果产业化试点。'}]}},
        }

    def test_wrong_official_identity_link_cannot_support_new_investment_and_capacity(self):
        text = '江苏银环年产3000吨核级管、工程投资2000万元，来源：' + self.url
        issues = synthesis_issues(text, self.prior)
        self.assertEqual(issues[0]['kind'], 'numeric_source_mismatch')
        self.assertEqual(correction_context(issues, self.prior)['cited_source_excerpts'][self.url],
                         self.prior['enterprises_1']['metadata']['evidence'][0]['excerpt'])

    def test_money_conversion_and_multiple_same_url_excerpts_are_supported(self):
        evidence = self.prior['enterprises_1']['metadata']['evidence']
        evidence.extend([{'url': self.url, 'excerpt': '总投资560000万元。'},
                         {'url': self.url, 'excerpt': '年产3000吨核级管。'}])
        self.assertEqual(synthesis_issues('总投资56亿元，年产0.3万吨，来源：' + self.url, self.prior), [])

    def test_unknown_rank_must_be_qualified_where_it_is_stated(self):
        self.assertTrue(any(x['kind'] == 'rank_uncertainty_lost' for x in
                            synthesis_issues('总量居全市第二。\n以上排名尚待核实。', self.prior)))
        self.assertEqual(synthesis_issues('全市第二为自媒体口径，尚待核实。', self.prior), [])

    def test_policy_disclaimer_cannot_replace_specific_eligibility(self):
        text = '第5条对成立不满五年、具有自主知识产权的初创期企业，按研发经费10%给予最高50万元；条件未知不得推荐。'
        self.assertTrue(any(x['kind'] == 'policy_condition_lost' for x in synthesis_issues(text, self.prior)))
        self.assertEqual(synthesis_issues(self.prior['policy']['text'], self.prior), [])

    def test_checks_are_pure_and_do_not_rewrite_prior(self):
        saved = copy.deepcopy(self.prior)
        synthesis_issues('没有新的数值主张。', self.prior)
        self.assertEqual(saved, self.prior)


class CompanyIdentityTests(unittest.TestCase):
    def test_explicit_financing_record_does_not_create_another_subject(self):
        self.assertEqual(company_identity({'name': '武汉糖智药业有限公司（融资交叉核验记录）'}),
                         company_identity({'name': '武汉糖智药业有限公司'}))

    def test_business_owner_requires_explicit_record_binding(self):
        saved = [{'name': '上海电气集团'}]
        record = {'name': '上海电气（聚变装备业务）', 'rationale': '该业务主体为上海电气集团，补充技术能力。'}
        self.assertEqual(company_identity(record, saved), '上海电气集团')
        self.assertNotEqual(company_identity({'name': record['name']}, saved), '上海电气集团')

    def test_branches_subsidiaries_and_parentheses_are_not_fuzzy_merged(self):
        names = ['上海电气集团', '上海锅炉厂有限公司（隶属上海电气集团）',
                 '甲公司上海分公司', '甲公司北京分公司', '甲公司（上海）有限公司', '甲公司（北京）有限公司']
        self.assertEqual(len({company_identity({'name': name}) for name in names}), len(names))

    def test_provider_candidate_gate_rejects_actual_decorated_duplicate(self):
        from report_service.full_provider import FullLiveProvider, FullProviderError
        p = FullLiveProvider(object())
        url = 'https://www.gov.cn/fixture'
        candidates = [{'name': name, 'url': url} for name in (
            '武汉糖智药业有限公司', '武汉糖智药业有限公司（融资交叉核验记录）', '独立企业甲', '独立企业乙', '独立企业丙')]
        meta = {'candidates': candidates, 'evidence': [{'url': url}]}
        with self.assertRaises(FullProviderError):
            p._validate_company_part('候选池', meta, {})
        candidates[1]['name'] = '武汉糖智药业有限公司上海分公司'
        p._validate_company_part('候选池', meta, {})

    def test_similarly_numbered_other_policy_is_not_wrongly_blocked(self):
        prior = {'policy': {'text': '第5条“拨投结合”对成立不满五年且有较强竞争力的企业，按10%给予最高50万元。'}}
        self.assertEqual(synthesis_issues('其他文件第5条规定技术改造按10%给予最高50万元。', prior), [])


class SynthesisProviderBoundaryTests(unittest.TestCase):
    def provider(self, outputs):
        from report_service.full_provider import FullLiveProvider
        provider = FullLiveProvider(SimpleNamespace(enabled=True, _validate_endpoints=lambda: None))
        provider._chat_part = Mock(side_effect=outputs)
        provider._gather_evidence = Mock(side_effect=AssertionError('synthesis cannot search'))
        return provider

    def text(self, first):
        return first + '\n' + '\n'.join(f'独立核查事项{i}，需记录对应依据与负责人。' for i in range(79))

    def test_one_correction_with_same_saved_facts_and_original_floor(self):
        prior = {'economy': {'text': '全市第二来自自媒体，待核实。', 'metadata': {}}}
        bad = json.dumps({'text': self.text('经济总量居全市第二。')})
        good = json.dumps({'text': self.text('经济总量居全市第二为自媒体口径，待核实。')})
        provider = self.provider([bad, good])
        before = copy.deepcopy(prior)
        out = provider.run_part('compact', '精简报告', {'city': '测试区'}, prior)
        self.assertEqual(out['text'], json.loads(good)['text'])
        self.assertEqual(provider._chat_part.call_count, 2)
        self.assertEqual(provider._chat_part.call_args.kwargs['min_lines'], 80)
        self.assertEqual(provider._chat_part.call_args.kwargs['correction_feedback']['kind'], 'synthesis_grounding')
        self.assertEqual(prior, before)
        provider._gather_evidence.assert_not_called()

    def test_second_bad_result_is_projected_without_more_calls_and_deep_does_not_change(self):
        from report_service.full_provider import FullProviderError
        prior = {'economy': {'text': '全市第二来自自媒体，待核实。', 'metadata': {}}}
        bad = json.dumps({'text': self.text('总量居全市第二。')})
        provider = self.provider([bad, bad])
        result = provider.run_part('compact', '精简报告', {'city': '测试区'}, prior)
        self.assertIn('尚未获得原文核验', result['text'])
        self.assertEqual(len(result['text'].splitlines()), 80)
        self.assertEqual(result['metadata']['factual_projection'][0]['original'], '总量居全市第二。')
        self.assertEqual(provider._chat_part.call_count, 2)
        from report_service.full_worker import _provider_issue
        self.assertEqual(_provider_issue(FullProviderError('decision prose changed source facts or omitted qualifications', 'quality')),
                         'synthesis_grounding')
        provider = self.provider([bad])
        provider.run_part('compact', '精简报告', {'city': '测试区', 'mode': 'deep'}, prior)
        self.assertEqual(provider._chat_part.call_count, 1)

    def test_fatal_json_is_not_rewritten(self):
        from report_service.full_provider import FullProviderError
        provider = self.provider(['{bad'])
        with self.assertRaises(FullProviderError):
            provider.run_part('compact', '精简报告', {'city': '测试区'}, {})
        self.assertEqual(provider._chat_part.call_count, 1)


class ExactResearchReuseTests(unittest.TestCase):
    def test_only_recent_exact_same_place_landing_queries_are_reused(self):
        from report_service.full_provider import FullLiveProvider
        searches = []
        def search(query, count):
            searches.append(query)
            return [{'url': 'https://www.gov.cn/fixture/' + str(len(searches)),
                     'snippet': '离线有效检索原文，不是真实研究。', 'title': 'OFFLINE'}]
        p = FullLiveProvider(SimpleNamespace(enabled=True, search_provider='exa', search_count=5,
                                            _search=search, _normalize_results=lambda result: result))
        prior = {'industry': {'metadata': {'directions': [
            {'id': f'dir{i}', 'name': f'独立产业{i}', 'evidence_ref': f'https://www.gov.cn/dir/{i}'} for i in (1,2,3)],
            'evidence': [{'url': f'https://www.gov.cn/dir/{i}', 'excerpt': '离线产业依据'} for i in (1,2,3)]}},
            'enterprises_1': {'metadata': {'candidates': [{'name': f'独立企业{i}'} for i in range(5)]}}}
        first = p._gather_evidence('enterprises_1', '落地情况', '测试区', prior, mode='standard')
        self.assertEqual(len(searches), 5)
        prior['enterprises_1']['metadata']['evidence'] = first
        saved = copy.deepcopy(prior)
        second = p._gather_evidence('enterprises_1', '扩产信号', '测试区', prior, mode='standard')
        self.assertEqual(len(searches), 5)
        self.assertEqual(second, first)
        self.assertEqual(prior, saved)
        p._gather_evidence('enterprises_1', '扩产信号', '不同区', prior, mode='standard')
        self.assertEqual(len(searches), 10)
        p._gather_evidence('enterprises_1', '扩产信号', '测试区', prior, mode='deep')
        self.assertEqual(len(searches), 15)
        for item in prior['enterprises_1']['metadata']['evidence']:
            item['retrieved_at'] = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2)).isoformat()
        p._gather_evidence('enterprises_1', '扩产信号', '测试区', prior, mode='standard')
        self.assertEqual(len(searches), 20)
