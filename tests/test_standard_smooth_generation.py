"""Offline checks for standard report latency and evidence fallback boundaries."""
import copy
import json
import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from report_service import full_contract as contract
from report_service import full_provider, providers
import test_full_provider as fixtures


def evidence(number):
    return {'url': f'https://stats.gov.cn/offline/{number}',
            'excerpt': f'OFFLINE source {number}; not a research claim.'}


def response(request, records):
    return fixtures.FakeResponse(200, json.dumps({'results': [
        {'url': item['url'], 'text': item['excerpt']} for item in records]}), request.full_url)


def provider(transport):
    return full_provider.FullLiveProvider(providers.OpenAIResearchProvider(
        model_url='https://api.deepseek.com/chat/completions', api_key='OFFLINE_MODEL',
        search_url='https://api.exa.ai/search', search_key='OFFLINE_SEARCH',
        search_provider='exa', enabled=True, transport=transport))


class StandardSmoothGenerationTests(unittest.TestCase):
    def test_five_company_searches_share_three_bounded_workers_in_stable_order(self):
        barrier = threading.Barrier(3)
        lock = threading.Lock()
        active = maximum = 0

        def search(request, timeout):
            nonlocal active, maximum
            name = json.loads(request.data)['query'].split()[0]
            with lock:
                active += 1
                maximum = max(maximum, active)
            try:
                if name in {'TARGET0', 'TARGET1', 'TARGET2'}:
                    barrier.wait(timeout=3)
                return response(request, [evidence(name)])
            finally:
                with lock:
                    active -= 1

        prior = fixtures.DirectionSerializationTests._prior()
        prior['enterprises_1'] = {'metadata': {'candidates': [
            {'name': f'TARGET{i}'} for i in range(5)]}}
        out = provider(search)._gather_evidence('enterprises_1', '落地情况', '测试城', prior, mode='standard')
        self.assertEqual(maximum, 3)
        self.assertEqual([item['url'] for item in out], [evidence(f'TARGET{i}')['url'] for i in range(5)])

    def test_standard_signal_searches_keep_one_stable_company_and_two_source_types_per_direction(self):
        prior = {f'enterprises_{direction}': {'metadata': {'selected': [
            {'name': f'D{direction}COMPANY{i}', 'expansion_evidence': 'OFFLINE signal'}
            for i in range(3)]}} for direction in (1, 2, 3)}
        saved = copy.deepcopy(prior)
        live = provider(lambda request, timeout: response(request, []))
        queries = live._company_check_queries(prior, '测试城', mode='standard')
        self.assertEqual(len(queries), 6)
        for direction in (1, 2, 3):
            batch = queries[(direction - 1) * 2:direction * 2]
            self.assertTrue(all(query.startswith(f'D{direction}COMPANY0 ') for query in batch))
            self.assertIn('公司公告', batch[0])
            self.assertIn('年度报告', batch[1])
        self.assertEqual(len(live._company_check_queries(prior, '测试城', mode='deep')), 18)
        self.assertEqual(prior, saved)

    def test_configuration_and_rate_limit_cannot_fall_back_even_when_message_contains_timeout(self):
        prior = {'economy': {'metadata': {'evidence': [evidence(i) for i in range(5)]}}}
        for status, code in ((401, 'configuration'), (403, 'configuration'), (429, 'rate_limit')):
            with self.subTest(status=status):
                def fail(request, timeout):
                    raise providers.ProviderError(f'upstream search HTTP {status}: timeout')
                with self.assertRaises(full_provider.FullProviderError) as caught:
                    provider(fail)._gather_evidence('economy', '经济总量', '测试城', prior, mode='standard')
                self.assertEqual(caught.exception.failure_code, code)
                self.assertEqual(caught.exception.safe_metrics['operation'], 'search')
                self.assertEqual(caught.exception.safe_metrics['http_status'], status)

    def test_temporary_lookup_failure_can_reuse_valid_saved_sources_without_mutating_them(self):
        prior = {'population': {'metadata': {'evidence': [evidence(i) for i in range(5)]}}}
        saved = copy.deepcopy(prior)
        def fail(request, timeout):
            raise TimeoutError('OFFLINE timeout')
        out = provider(fail)._gather_evidence('population', '人口规模', '测试城', prior, mode='standard')
        self.assertEqual([item['url'] for item in out], [evidence(i)['url'] for i in range(5)])
        self.assertEqual(prior, saved)
        with self.assertRaises(full_provider.FullProviderError):
            provider(fail)._gather_evidence('population', '人口规模', '测试城', prior, mode='deep')

    def test_new_candidate_discovery_never_uses_cached_sources_after_all_searches_fail(self):
        prior = fixtures.DirectionSerializationTests._prior()
        prior['enterprises_1'] = {'metadata': {'candidates': [], 'evidence': [evidence(i) for i in range(5)]}}
        def fail(request, timeout):
            raise TimeoutError('OFFLINE timeout')
        with self.assertRaises(full_provider.FullProviderError) as caught:
            provider(fail)._gather_evidence('enterprises_1', '候选池', '测试城', prior, mode='standard')
        self.assertEqual(caught.exception.failure_code, 'timeout')

    def test_other_research_final_parts_keep_one_complementary_search_for_short_coverage(self):
        for stage in ('economy', 'transport', 'life', 'industry', 'competition', 'policy', 'chain'):
            with self.subTest(stage=stage):
                queries = []
                counts = []
                def search(request, timeout):
                    payload = json.loads(request.data)
                    query = payload['query']
                    queries.append(query)
                    counts.append(payload['numResults'])
                    return response(request, [evidence(4 if '补充资料' in query else 3)])
                prior = {stage: {'metadata': {'evidence': [evidence(i) for i in range(3)]}}}
                saved = copy.deepcopy(prior)
                part = contract.get_stage(stage, mode='standard')['parts'][-1]
                out = provider(search)._gather_evidence(stage, part, '测试城', prior, mode='standard')
                all_sources = prior[stage]['metadata']['evidence'] + out
                self.assertEqual(queries, [full_provider._queries_for(stage, part, '测试城')[0],
                                          f'测试城 {part} 补充资料 统计公报 官方发布 年度报告'])
                self.assertEqual(counts, [providers.DEFAULT_SEARCH_COUNT] * 2)
                self.assertEqual(len({contract.canonical_url(item['url']) for item in all_sources}), 5)
                self.assertEqual(prior, saved)

    def test_population_final_part_uses_bounded_topic_batch_and_retrieves_later_source(self):
        queries = []
        counts = []
        expected = [
            '测试城 人才引进 就业 劳动力',
            '测试城 人才与劳动力 补充资料 统计公报 官方发布 年度报告',
            '测试城 人力资源 社会保障 事业发展 统计公报 就业 技能人才',
            '测试城 第七次人口普查 受教育程度 劳动年龄人口',
            '测试城 统计年鉴 从业人员 职业教育 毕业生',
        ]
        def search(request, timeout):
            payload = json.loads(request.data)
            query = payload['query']
            queries.append(query)
            counts.append(payload['numResults'])
            # Only the seventh result of a complementary topic supplies a
            # new canonical URL. The old five-result request loses it.
            records = [evidence(3)]
            if query == expected[2]:
                records = [evidence(3)] * 6 + [evidence(4)]
            return response(request, records[:payload['numResults']])
        prior = {'population': {'metadata': {'evidence': [evidence(i) for i in range(3)]}}}
        saved = copy.deepcopy(prior)
        out = provider(search)._gather_evidence('population', '人才与劳动力', '测试城', prior, mode='standard')
        self.assertEqual(queries[0], expected[0])
        # The four requests share one concurrent batch, so arrival order is
        # not part of the contract. There must be no extra or missing query.
        self.assertCountEqual(queries[1:], expected[1:])
        self.assertEqual(counts, [providers.MAX_SEARCH_COUNT] * 5)
        all_sources = prior['population']['metadata']['evidence'] + out
        self.assertEqual({contract.canonical_url(item['url']) for item in all_sources},
                         {evidence(i)['url'] for i in range(5)})
        new_sources = [item for item in out if item['url'] == evidence(4)['url']]
        self.assertEqual(len(new_sources), 1)
        self.assertEqual(new_sources[0]['search_query'], expected[2])
        self.assertEqual(prior, saved)


if __name__ == '__main__':
    unittest.main()
