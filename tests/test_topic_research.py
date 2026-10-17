"""Offline contracts for topic research, original sources and fact guards."""
import copy
import json
import threading
import time
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.topic_research import research_topic, search_plan, validate_report, select_source_paragraphs
from report_service.providers import OpenAIResearchProvider


class FakeSearch:
    enabled = True
    search_provider = 'exa'
    search_count = 4
    timeout = 30

    def __init__(self, results=None, error=False, delay=0):
        self.results = results or []
        self.error = error
        self.delay = delay
        self.calls = []
        self.metrics = {'active': 0, 'maximum': 0}
        self.lock = threading.Lock()

    def _validate_endpoints(self):
        pass

    def _search(self, query, count):
        with self.lock:
            self.calls.append(query)
            self.metrics['active'] += 1
            self.metrics['maximum'] = max(self.metrics['active'], self.metrics['maximum'])
        try:
            if self.delay:
                time.sleep(self.delay)
            if self.error:
                raise RuntimeError('SEARCH_SECRET never publish this')
            return {'results': copy.deepcopy(self.results)}
        finally:
            with self.lock:
                self.metrics['active'] -= 1

    _normalize_results = OpenAIResearchProvider._normalize_results


def result(text, url='https://www.shanghai.gov.cn/topic/article.html', title='闵行区统计公报'):
    return {'url': url, 'title': title, 'text': '氢能装备产业。'+text, 'publishedDate': '2026-04-08'}


def research(results, **kwargs):
    return research_topic('闵行区', '氢基能源', provider=FakeSearch(results),
                          now='2026-10-16T05:00:00+00:00', **kwargs)


class TopicResearchTests(unittest.TestCase):
    def test_paragraph_selection_requires_specific_industry_and_never_cuts(self):
        generic = '闵行区经济持续发展，营业收入100亿元。这里仅有地区名字和通用产业词，没有具体方向。'
        policy = '氢能装备政策：对具有自主知识产权、成立不满五年的初创期企业，按研发费用10%给予最高50万元支持。'
        giant = '氢能技术' + '完整内容不能被任意截断' * 200
        picked = select_source_paragraphs('\n\n'.join([generic, policy, giant]), '氢基能源与长时储能装备补链')
        self.assertEqual([p['quote'] for p in picked], [policy])
        self.assertIn('成立不满五年', picked[0]['quote'])
        self.assertTrue(all(len(p['quote']) <= 1600 for p in picked))

    def test_same_url_has_max_three_quotes_and_fulltext_archive(self):
        paragraphs = [f'氢能产业第{i}个完整段落，项目投资{i+1}亿元，相关技术供应链由主管单位逐项研究并保存。' for i in range(7)]
        fulltext = '\n\n'.join(paragraphs)
        out = research([result(fulltext)])
        self.assertEqual(len(out['evidence']), 3)
        self.assertEqual(len(out['sources']), 1)
        self.assertEqual(len({e['origin_id'] for e in out['evidence']}), 1)
        saved = next(iter(out['sources'].values()))['fulltext']
        self.assertIn(paragraphs[-1], saved)
        self.assertTrue(all(e['quote'] in saved for e in out['evidence']))

    def test_oversized_unsegmented_text_is_pending_not_fake_excerpt(self):
        out = research([result('氢能政策' + '很长且无段落分隔的原文' * 200)])
        self.assertFalse(out['evidence'])
        self.assertEqual(out['status'], 'pending')
        self.assertEqual(out['candidates'][0]['reason'], 'no_complete_topic_relevant_paragraph')

    def test_reused_legacy_number_is_not_a_valid_source_id(self):
        out = research([result('2025年闵行区营业收入100亿元。相关数据来自区内企业专项调查且统计范围保持一致。')])
        checked = validate_report('2025年闵行区营业收入100亿元。[1]', out)
        self.assertEqual(checked['issues'][0]['kind'], 'unknown_evidence_reference')

    def test_existing_provider_transport_only_searches_no_model_or_url_download(self):
        requests = []
        class Response:
            status = 200
            def read(self, size):
                return json.dumps({'results': [result('2025年闵行区营业收入100亿元。统计数据按本区统一调查范围核定，发布机构为区统计局。')]}).encode()
            def geturl(self):
                return 'https://api.exa.ai/search'
            def close(self):
                pass
        def transport(request, timeout):
            requests.append(request)
            return Response()
        live = OpenAIResearchProvider(model_url='https://api.deepseek.com/chat/completions',
            api_key='MODEL_SECRET', search_provider='exa', search_key='SEARCH_SECRET',
            enabled=True, transport=transport)
        out = research_topic('闵行区', '氢基能源', provider=live)
        self.assertEqual(out['status'], 'ready')
        self.assertEqual(len(requests), 3)
        self.assertTrue(all(r.full_url == 'https://api.exa.ai/search' for r in requests))
        self.assertTrue(all(json.loads(r.data)['contents']['text'] is True for r in requests))
        self.assertNotIn('SECRET', json.dumps(out))

    def test_plan_never_sends_private_basis_or_answers(self):
        fake = FakeSearch([result('2025年闵行区营业收入100亿元。这里是足够长的官方原文，以便独立核查年份地区与具体指标。')])
        out = research_topic('闵行区', '氢基能源', questions=['内部客户秘密联系电话13800138000'],
                             basis=[{'text': '私密报价利润口径。'}], provider=fake)
        self.assertEqual(len(out['queries']), 3)
        self.assertTrue(fake.calls)
        self.assertNotIn('私密', json.dumps(fake.calls, ensure_ascii=False))
        self.assertNotIn('内部客户', json.dumps(fake.calls, ensure_ascii=False))
        self.assertEqual(out['evidence'][0]['retrieval'], 'fetched')
        self.assertEqual(out['evidence'][0]['status'], 'source')
        self.assertFalse(out['automatic_cross_check'])

    def test_off_by_default_and_errors_are_sanitized(self):
        fake = FakeSearch(error=True)
        out = research_topic('闵行区', '氢基能源', provider=fake)
        self.assertEqual(out['status'], 'unavailable')
        self.assertNotIn('SEARCH_SECRET', json.dumps(out))
        fake.enabled = False
        self.assertEqual(research_topic('闵行区', '氢基能源', provider=fake)['status'], 'unavailable')

    def test_public_label_rejects_urls_and_phone_numbers(self):
        for topic in ['https://private.test', '项目13800138000', '主题\n私密补充']:
            with self.assertRaises(ValueError):
                search_plan('闵行区', topic)

    def test_snippets_are_not_original_evidence(self):
        fake = FakeSearch([{'url': 'https://www.shanghai.gov.cn/topic/a.html',
                            'title': '原文缺失', 'description': '仅仅是搜索引擎摘要，不能假装取回原始正文'}])
        out = research_topic('闵行区', '氢基能源', provider=fake)
        self.assertEqual(out['status'], 'pending')
        self.assertFalse(out['evidence'])
        self.assertEqual(out['candidates'][0]['retrieval'], 'snippet')

    def test_trusted_company_domain_still_requires_safe_url_and_original(self):
        text = '示例装备有限公司的年度报告。公司2025年营业收入100亿元，报告期内生产基地位于上海市闵行区。'
        out = research([result(text, 'https://manufacture.com/annual.html'),
                        result(text, 'https://127.0.0.1/private')],
                       trusted_company_domains=['manufacture.com'])
        self.assertEqual(len(out['evidence']), 1)
        self.assertEqual(out['evidence'][0]['source_type'], 'company')
        self.assertEqual(out['evidence'][0]['published_at'], '2026-04-08')

    def test_progress_concurrency_and_time_budget(self):
        fake = FakeSearch(delay=.06)
        events = []
        start = time.monotonic()
        out = research_topic('闵行区', '氢基能源', mode='full', provider=fake,
                             progress=events.append, deadline_seconds=.015)
        self.assertLess(time.monotonic()-start, .05)
        self.assertTrue(any(x['state'] == 'started' for x in events))
        self.assertTrue(any(x.get('code') == 'research_deadline' for x in events))
        self.assertTrue(any(x['code'] == 'research_deadline' for x in out['errors']))
        time.sleep(.08)  # finish the fixture workers; no actual network exists
        self.assertGreater(fake.metrics['maximum'], 1)
        self.assertLessEqual(fake.metrics['maximum'], 3)
        self.assertEqual(fake.metrics['active'], 0)

    def test_invalid_deadline_and_oversized_report_fail_closed(self):
        for deadline in [0, -1, float('nan'), 'broken']:
            out = research_topic('闵行区', '氢基能源', provider=FakeSearch(), deadline_seconds=deadline)
            self.assertEqual(out['errors'][0]['code'], 'research_deadline')
        self.assertEqual(validate_report('x'*200001, {})['status'], 'unsupported')

    def test_identical_mirrors_do_not_cross_check(self):
        text = '2025年闵行区营业收入100亿元。该项经济数据来自本区企业调查，统计范围和统计年度均有明示。'
        out = research([result(text), result(text, 'https://www.nea.gov.cn/copy.html')])
        a, b = out['evidence']
        self.assertEqual(a['origin_id'], b['origin_id'])
        checked = validate_report(f"2025年闵行区营业收入100亿元。[{a['id']}][{b['id']}]", out)
        self.assertEqual(checked['checks'][0]['support_status'], 'single_source')
        self.assertFalse(checked['verified'])

    def test_distinct_primary_passages_can_cross_check(self):
        out = research([result('2025年闵行区营业收入100亿元。该项经济数据来自本区调查，口径详见统计附表。'),
                        result('年度经济调查显示：2025年闵行区营业收入100亿元，各统计调查程序已经完成审定。',
                               'https://www.nea.gov.cn/economy.html')])
        a, b = out['evidence']
        checked = validate_report(f"2025年闵行区营业收入100亿元。[{a['id']}][{b['id']}]", out)
        self.assertEqual(checked['status'], 'cross_checked')

    def test_wrong_numbers_and_unknown_references_fail(self):
        out = research([result('2025年闵行区营业收入100亿元。该项经济数据来自本区企业调查，统计范围与年度明确。')])
        eid = out['evidence'][0]['id']
        checked = validate_report(f'2025年闵行区营业收入900亿元。[{eid}]', out)
        self.assertEqual(checked['status'], 'unsupported')
        forged = validate_report('2025年闵行区营业收入100亿元。[tr_00000000000000000000]', out)
        self.assertEqual(forged['issues'][0]['kind'], 'unknown_evidence_reference')

    def test_plan_cannot_be_promoted_to_completion(self):
        out = research([result('闵行区项目投资10亿元，计划2025年6月投产。项目具体建设工期仍以主管部门后续通知为准。')])
        eid = out['evidence'][0]['id']
        checked = validate_report(f'闵行区项目投资10亿元，2025年6月投产。[{eid}]', out)
        self.assertEqual(checked['status'], 'unsupported')

    def test_registered_address_is_not_office_address(self):
        out = research([result('示例装备有限公司2025年年度报告\n公司注册地址武汉经济技术开发区高科技园。\n公司办公地址北京市海淀区工业路1号。',
                               title='示例装备有限公司2025年年度报告')])
        eid = out['evidence'][0]['id']
        wrong = validate_report(f'示例装备有限公司注册地北京。[{eid}]', out)
        good = validate_report(f'示例装备有限公司注册地武汉经济技术开发区高科技园。[{eid}]', out)
        self.assertEqual(wrong['status'], 'unsupported')
        self.assertEqual(good['status'], 'single_source')

    def test_missing_and_purchase_assertions_do_not_pass_with_disclaimer(self):
        out = research([result('闵行区加快培育装备企业，拟开展供应商调查。当前订单与本地配套率均待后续核实。')])
        eid = out['evidence'][0]['id']
        wrong = validate_report(f'本地材料缺失，待核实。[{eid}]\n落地即可锁定采购订单，具体金额待核实。[{eid}]', out)
        self.assertEqual(wrong['status'], 'unsupported')
        reasons = {r for c in wrong['checks'] for r in c['reasons']}
        self.assertIn('absence_requires_direct_survey_evidence', reasons)
        self.assertIn('unverified_procurement_or_benefit_promise', reasons)

    def test_policy_condition_is_not_replaced_by_amount_only(self):
        out = research([result('闵科委规发〔2025〕2号\n第五条 对具有自主知识产权、成立不满五年的初创期企业，按照上年度研发经费的10%给予最高50万元奖励。',
                               title='闵科委规发〔2025〕2号')])
        eid = out['evidence'][0]['id']
        checked = validate_report(f'闵科委规发〔2025〕2号第五条对初创期企业给予最高50万元奖励。[{eid}]', out)
        self.assertEqual(checked['status'], 'unsupported')


if __name__ == '__main__':
    unittest.main()
