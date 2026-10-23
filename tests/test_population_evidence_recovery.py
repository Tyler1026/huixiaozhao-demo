"""Offline regression for a sparse final population checkpoint.

All URLs, excerpts and model responses are explicit protocol fixtures. The
injected transport never performs a network, search-provider or model call.
"""
import copy
import hashlib
import json
import tempfile
import threading
import unittest
from pathlib import Path

from report_service import full_contract as contract
from report_service import full_provider as provider
from report_service import full_worker as worker
from report_service import providers
from report_service.full_store import FullStore


def lines(label, count):
    return '\n'.join(f'OFFLINE {label} {hashlib.sha256(f"{label}-{i}".encode()).hexdigest()}'
                     for i in range(count))


def evidence(number, suffix=''):
    return {'url': f'https://stats.gov.cn/offline/population/{number}{suffix}',
            'excerpt': f'OFFLINE retrieved population fixture {number}',
            'source': 'stats.gov.cn', 'retrieval': 'exa_fulltext',
            'source_type': 'government'}


def previous_parts(count=4):
    return [
        {'text': lines('population-size', 31), 'metadata': {'evidence': [evidence(0)]}},
        {'text': lines('population-structure', 34),
         'metadata': {'evidence': [evidence(i) for i in range(1, count)]}},
    ]


def prior_for(count=4):
    return {'population': contract.assemble('population', previous_parts(count))}


class Response:
    def __init__(self, body, status=200):
        self.status = status
        self.body = json.dumps(body).encode()

    def read(self, size=-1):
        return self.body if size < 0 else self.body[:size]

    def geturl(self):
        return 'https://api.exa.ai/search'

    def close(self):
        pass


class Router:
    def __init__(self, search_result, text_lines=36, chat_texts=None):
        self.search_result = search_result
        self.text_lines = text_lines
        self.chat_texts = iter(chat_texts) if chat_texts is not None else None
        self.searches = []
        self.chats = []
        self.timeouts = []

    def __call__(self, request, timeout):
        payload = json.loads(request.data)
        self.timeouts.append((request.full_url, timeout))
        if request.full_url == 'https://api.exa.ai/search':
            self.searches.append(payload)
            result = self.search_result(payload['query'], len(self.searches))
            if isinstance(result, Exception):
                raise result
            if isinstance(result, tuple):
                return Response(result[1], status=result[0])
            return Response({'results': result})
        if request.full_url == 'https://model.test/chat/completions':
            self.chats.append(payload)
            return Response({'choices': [{'finish_reason': 'stop', 'message': {
                'content': json.dumps({'text': next(self.chat_texts) if self.chat_texts is not None
                                       else lines('workforce', self.text_lines)})}}]})
        raise AssertionError('unexpected offline transport destination')


def search_items(records):
    return [dict(url=item['url'], text=item['excerpt']) for item in records]


def live(router):
    return provider.FullLiveProvider(providers.OpenAIResearchProvider(
        model_url='https://model.test/chat/completions', api_key='OFFLINE_MODEL_KEY',
        model_name='offline-fixture', search_provider='exa', search_key='OFFLINE_SEARCH_KEY',
        search_url='https://api.exa.ai/search', enabled=True, search_count=5, transport=router))


class PopulationEvidenceRecoveryTests(unittest.TestCase):
    def run_final(self, router, prior=None, mode='standard'):
        return live(router).run_part('population', '人才与劳动力',
                                     {'city': 'OFFLINE测试城', 'mode': mode},
                                     prior_for() if prior is None else prior)

    def test_complementary_query_adds_fifth_source_and_real_stage_contract_passes(self):
        saved = prior_for()
        before = copy.deepcopy(saved)
        aliases = search_items([evidence(i, '?query=latest#section') for i in range(4)])
        def results(query, call):
            if '第七次人口普查' in query:
                return search_items([evidence(4)])
            return aliases
        router = Router(results)
        result = self.run_final(router, saved)
        merged = contract.assemble('population', previous_parts() + [result])
        self.assertEqual(contract.validate('population', merged['text'], merged['metadata'], mode='standard'), [])
        self.assertEqual(len({contract.canonical_url(item['url'])
                              for item in merged['metadata']['evidence']}), 5)
        self.assertEqual(saved, before)
        self.assertEqual(len(router.searches), 5)
        self.assertEqual(len(router.chats), 1)
        self.assertTrue(all(call['numResults'] == providers.MAX_SEARCH_COUNT for call in router.searches))
        self.assertIn(evidence(4)['excerpt'], router.chats[0]['messages'][-1]['content'])
        # The actual observed URL and the saved excerpt survive canonical dedup.
        combined = merged['metadata']['evidence'][0]
        self.assertEqual(combined['url'], evidence(0)['url'])
        self.assertEqual(combined['excerpt'], evidence(0)['excerpt'])
        self.assertIn('?query=latest#section', json.dumps(merged['metadata']['evidence']))

    def test_duplicate_and_invalid_results_fail_before_chat_with_safe_counts(self):
        invalid = [
            {'url': 'http://stats.gov.cn/insecure', 'text': 'OFFLINE'},
            {'url': 'https://stats.gov.cn/empty', 'text': ''},
            {'url': 'https://127.0.0.1/private', 'text': 'OFFLINE'},
            {'url': 'https://stats.gov.cn/link-only', 'text': 'https://stats.gov.cn/link-only'},
        ]
        variants = search_items([evidence(i, f'?query={i}#section') for i in range(4)])
        router = Router(lambda query, call: invalid + variants)
        saved = prior_for()
        before = copy.deepcopy(saved)
        with self.assertRaises(provider.FullProviderError) as failure:
            self.run_final(router, saved)
        error = failure.exception
        self.assertEqual(error.failure_code, 'quality')
        self.assertEqual(len(router.searches), 2 + len(provider._POPULATION_COMPLETION_QUERIES))
        self.assertEqual(router.chats, [])
        self.assertEqual(saved, before)
        diagnostic = worker._failure_diagnostics(error, 'provider', 'population', '人才与劳动力')
        self.assertEqual(diagnostic['issues'], ['evidence_floor'])
        self.assertEqual(diagnostic['evidence_count'], 4)
        self.assertEqual(diagnostic['min_evidence_urls'], 5)
        self.assertNotIn('OFFLINE retrieved', json.dumps(diagnostic))
        self.assertNotIn('stats.gov.cn', json.dumps(diagnostic))

    def test_unrelated_stage_sources_do_not_fill_population_deficit(self):
        saved = prior_for(2)
        saved['economy'] = {'text': lines('economy', 80), 'metadata': {
            'evidence': [evidence(i) for i in range(20, 28)]}}
        router = Router(lambda query, call: search_items([evidence(0), evidence(1)]))
        with self.assertRaises(provider.FullProviderError) as failure:
            self.run_final(router, saved)
        self.assertEqual(failure.exception.safe_metrics['evidence_count'], 2)
        self.assertEqual(router.chats, [])

    def test_existing_five_sources_skip_supplemental_searches(self):
        router = Router(lambda query, call: search_items([evidence(0)]))
        result = self.run_final(router, prior_for(5))
        self.assertEqual(len(result['metadata']['evidence']), 5)
        self.assertEqual(len(router.searches), 1)
        self.assertEqual(len(router.chats), 1)

    def test_deep_and_intermediate_parts_keep_existing_search_behavior_and_floors(self):
        router = Router(lambda query, call: search_items([evidence(0)]), text_lines=90)
        self.run_final(router, mode='deep')
        self.assertEqual(len(router.searches), 1)
        self.assertEqual(router.searches[0]['numResults'], 5)
        router = Router(lambda query, call: search_items([evidence(0)]))
        live(router).run_part('population', '人口规模', {'city': 'OFFLINE测试城'}, {})
        self.assertEqual(len(router.searches), 1)
        self.assertEqual(router.searches[0]['numResults'], 5)
        self.assertEqual(contract.minimum_evidence_urls('standard'), 5)
        self.assertEqual(contract.minimum_evidence_urls('deep'), 8)
        self.assertEqual(contract.get_stage('population', mode='standard')['min_lines'], 80)
        self.assertEqual(contract.get_stage('population', mode='deep')['min_lines'], 150)

    def test_auth_and_rate_limit_fail_closed_after_bounded_batch_without_chat(self):
        for status, code in [(401, 'configuration'), (403, 'configuration'), (429, 'rate_limit')]:
            with self.subTest(status=status):
                def results(query, call):
                    return search_items([evidence(0)]) if call == 1 else (status, {'error': 'OFFLINE unavailable'})
                router = Router(results)
                with self.assertRaises(provider.FullProviderError) as failure:
                    self.run_final(router)
                self.assertEqual(failure.exception.failure_code, code)
                self.assertEqual(len(router.searches), 5)
                self.assertEqual(router.chats, [])

    def test_recovery_is_one_concurrent_timeout_window_even_with_text_correction(self):
        for correction in (False, True):
            with self.subTest(correction=correction):
                # A serial implementation cannot release this barrier. All
                # four bounded supplements must enter the same timeout wave.
                barrier = threading.Barrier(4, timeout=2)
                saved = prior_for()
                def results(query, call):
                    if call > 1:
                        barrier.wait()
                    return search_items([evidence(4)]) if '第七次人口普查' in query else search_items([evidence(0)])
                final_text = lines('workforce', 36)
                chat_texts = [saved['population']['text'], final_text] if correction else [final_text]
                router = Router(results, chat_texts=chat_texts)
                result = self.run_final(router, saved)
                self.assertEqual(result['text'], final_text)
                self.assertEqual(len(router.searches), 5)
                search_timeouts = [timeout for url, timeout in router.timeouts if 'exa.ai' in url]
                chat_timeouts = [timeout for url, timeout in router.timeouts if 'model.test' in url]
                self.assertEqual(search_timeouts, [30] * 5)
                self.assertEqual(chat_timeouts, [90] * (2 if correction else 1))
                # Initial search + concurrent supplements retain the previous
                # two search windows: 150s normally, 240s with the one rewrite.
                budget = 2 * max(search_timeouts) + sum(chat_timeouts)
                self.assertLess(budget, 300 if correction else 180)

    def test_missing_coverage_preserves_actual_transport_error(self):
        for fault, code in [(TimeoutError('OFFLINE timeout'), 'timeout'),
                            (providers.ProviderError('upstream search HTTP 503'), 'upstream')]:
            with self.subTest(code=code):
                router = Router(lambda query, call: search_items([evidence(0)]) if call == 1 else fault)
                with self.assertRaises(provider.FullProviderError) as failure:
                    self.run_final(router)
                self.assertEqual(failure.exception.failure_code, code)
                self.assertEqual(failure.exception.safe_metrics['evidence_count'], 4)
                self.assertEqual(router.chats, [])

    def test_local_retry_keeps_committed_parts_and_commits_only_after_recovery(self):
        with tempfile.TemporaryDirectory() as temp:
            store = FullStore(Path(temp) / 'offline.db', stages=(contract.get_stage('population'),), backoff=(0, 0))
            report = store.create('offline-test', '测试省', 'OFFLINE测试城', 'population-recovery', False)
            for item in previous_parts():
                job = store.claim(synthetic=False)
                self.assertTrue(store.finish_part(job['step_id'], job['token'], item))
            before = store.parts(report['id'])['population']
            prior = {'population': contract.assemble('population', before)}
            job = store.claim(synthetic=False)
            router = Router(lambda query, call: search_items([evidence(0)]))
            with self.assertRaises(provider.FullProviderError) as failure:
                self.run_final(router, prior)
            store.fail_part(job['step_id'], job['token'], failure.exception.failure_code)
            self.assertEqual(store.parts(report['id'])['population'], before)
            self.assertEqual(store.get('offline-test', report['id'])['parts_done'], 2)
            retry = store.claim(synthetic=False)
            self.assertEqual(retry['part'], '人才与劳动力')
            self.assertEqual(retry['attempts'], 2)
            recovered = self.run_final(Router(lambda query, call: search_items([evidence(4)])), prior)
            merged = contract.assemble('population', before + [recovered])
            self.assertEqual(contract.validate('population', merged['text'], merged['metadata'], mode='standard'), [])
            self.assertTrue(store.finish_part(retry['step_id'], retry['token'], recovered))
            self.assertEqual(store.parts(report['id'])['population'][:2], before)
            self.assertEqual(store.get('offline-test', report['id'])['parts_done'], 3)


if __name__ == '__main__':
    unittest.main()
