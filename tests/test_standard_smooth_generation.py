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

    def test_final_part_adds_one_complementary_search_when_real_source_coverage_is_short(self):
        queries = []
        def search(request, timeout):
            query = json.loads(request.data)['query']
            queries.append(query)
            return response(request, [evidence(4 if '补充资料' in query else 3)])
        prior = {'population': {'metadata': {'evidence': [evidence(i) for i in range(3)]}}}
        out = provider(search)._gather_evidence('population', '人才与劳动力', '测试城', prior, mode='standard')
        all_sources = prior['population']['metadata']['evidence'] + out
        self.assertEqual(len(queries), 2)
        self.assertIn('补充资料', queries[-1])
        self.assertEqual(len({contract.canonical_url(item['url']) for item in all_sources}), 5)


if __name__ == '__main__':
    unittest.main()
