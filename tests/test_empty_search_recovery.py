"""Offline HTTP fixtures for successful searches with no usable evidence."""
import copy
import json
import threading
import unittest

from report_service import full_contract as contract
from report_service import full_provider as provider
from report_service import full_worker as worker
from report_service import providers
import test_population_evidence_recovery as fixtures
import test_full_provider as full_fixtures


def result(number, scheme='https', text=None, host='stats.gov.cn'):
    return {'url': f'{scheme}://{host}/offline/recovery/{number}',
            'text': f'OFFLINE source {number}' if text is None else text}


class Router:
    def __init__(self, search, chat_texts=None):
        self.search = search
        self.searches = []
        self.chats = []
        self.timeouts = []
        self.lock = threading.Lock()
        self.chat_texts = iter(chat_texts) if chat_texts is not None else None

    def __call__(self, request, timeout):
        payload = json.loads(request.data)
        with self.lock:
            self.timeouts.append((request.full_url, timeout))
            if request.full_url == 'https://api.exa.ai/search':
                self.searches.append(payload)
                call = len(self.searches)
            else:
                call = None
        if call is not None:
            value = self.search(payload, call)
            if isinstance(value, Exception):
                raise value
            if isinstance(value, tuple):
                return fixtures.Response(value[1], value[0])
            return fixtures.Response({'results': value[:payload['numResults']]})
        if request.full_url == 'https://model.test/chat/completions':
            self.chats.append(payload)
            text = next(self.chat_texts) if self.chat_texts is not None else fixtures.lines('transport', 36)
            return fixtures.Response({'choices': [{'finish_reason': 'stop', 'message': {
                'content': json.dumps({'text': text})}}]})
        raise AssertionError('unexpected fixture endpoint')


class EmptySearchRecoveryTests(unittest.TestCase):
    def run_part(self, router, prior=None, stage='transport', part='交通网络', mode='standard'):
        return fixtures.live(router).run_part(stage, part, {'city': 'OFFLINE测试城', 'mode': mode},
                                              {} if prior is None else prior)

    def test_expanded_original_query_recovers_seventh_https_result_in_one_parallel_wave(self):
        barrier = threading.Barrier(3, timeout=2)
        original = 'OFFLINE测试城 交通 铁路 高速公路 机场 港口'
        def search(payload, call):
            if call > 1:
                barrier.wait()
            records = [result(i, 'http') for i in range(6)]
            if payload['query'] == original:
                records.append(result(6))
            return records
        router = Router(search)
        output = self.run_part(router)
        self.assertEqual([p['numResults'] for p in router.searches], [5, 8, 8, 8])
        self.assertEqual(sum(p['query'] == original for p in router.searches), 2)
        self.assertEqual(len(router.chats), 1)
        self.assertEqual([e['url'] for e in output['metadata']['evidence']], [result(6)['url']])
        self.assertEqual(output['metadata']['evidence'][0]['excerpt'], result(6)['text'])
        self.assertNotIn('https://stats.gov.cn/offline/recovery/0', json.dumps(output))

    def test_complementary_topic_can_recover_without_rewriting_http_sources(self):
        def search(payload, call):
            if '基础设施 专项规划' in payload['query']:
                return [result(20)]
            return [result(0, 'http')]
        router = Router(search)
        output = self.run_part(router)
        self.assertEqual(len(router.searches), 4)
        self.assertTrue(all('OFFLINE测试城' in p['query'] for p in router.searches))
        complementary = [p for p in router.searches[1:]
                         if p['query'] != router.searches[0]['query']]
        self.assertEqual(len(complementary), 2)
        self.assertTrue(all('交通网络' in p['query'] for p in complementary))
        self.assertEqual([e['url'] for e in output['metadata']['evidence']], [result(20)['url']])

    def test_all_http_results_fail_closed_with_safe_reason_counts(self):
        router = Router(lambda payload, call: [result(i, 'http') for i in range(5)])
        with self.assertRaises(provider.FullProviderError) as caught:
            self.run_part(router)
        diagnostic = worker._failure_diagnostics(caught.exception, 'provider', 'transport', '交通网络')
        self.assertEqual(caught.exception.failure_code, 'quality')
        self.assertEqual(diagnostic['issues'], ['no_usable_search_evidence'])
        self.assertEqual(diagnostic['operation'], 'search')
        self.assertEqual(diagnostic['query_count'], 4)
        self.assertEqual(diagnostic['normalized_result_count'], 20)
        self.assertEqual(diagnostic['non_https_result_count'], 20)
        self.assertEqual(diagnostic['rejected_result_count'], 20)
        self.assertEqual(diagnostic['usable_result_count'], 0)
        self.assertEqual(diagnostic['evidence_count'], 0)
        self.assertEqual(router.chats, [])
        self.assertNotIn('stats.gov.cn', json.dumps(diagnostic))
        self.assertNotIn('OFFLINE source', json.dumps(diagnostic))

    def test_rejection_counts_distinguish_empty_excerpt_and_unsafe_url(self):
        records = [result(0, 'http'), result(1, text=''), result(2, host='127.0.0.1'),
                   {'url': 'invalid-url', 'text': 'OFFLINE invalid'}]
        router = Router(lambda payload, call: records)
        with self.assertRaises(provider.FullProviderError) as caught:
            self.run_part(router)
        metrics = caught.exception.safe_metrics
        self.assertEqual(metrics['normalized_result_count'], 16)
        self.assertEqual(metrics['non_https_result_count'], 4)
        self.assertEqual(metrics['empty_excerpt_count'], 4)
        self.assertEqual(metrics['invalid_url_count'], 8)
        self.assertEqual(metrics['other_rejected_result_count'], 0)
        self.assertEqual(router.chats, [])

    def test_empty_normalized_results_are_bounded_and_do_not_call_chat(self):
        router = Router(lambda payload, call: [])
        with self.assertRaises(provider.FullProviderError) as caught:
            self.run_part(router)
        self.assertEqual(caught.exception.diagnostic_reason, 'no_usable_search_evidence')
        self.assertEqual(caught.exception.safe_metrics['normalized_result_count'], 0)
        self.assertEqual(len(router.searches), 4)
        self.assertEqual(router.chats, [])

    def test_initial_transport_failures_keep_their_classification_without_recovery(self):
        faults = [((401, {}), 'configuration'), ((403, {}), 'configuration'),
                  ((429, {}), 'rate_limit'), ((503, {}), 'upstream'),
                  (TimeoutError('OFFLINE timeout'), 'timeout')]
        for fault, code in faults:
            with self.subTest(code=code, fault=type(fault).__name__):
                router = Router(lambda payload, call: fault)
                with self.assertRaises(provider.FullProviderError) as caught:
                    self.run_part(router)
                self.assertEqual(caught.exception.failure_code, code)
                self.assertIsNone(caught.exception.diagnostic_reason)
                self.assertEqual(len(router.searches), 1)
                self.assertEqual(router.chats, [])

    def test_recovery_faults_are_not_disguised_as_no_usable_evidence(self):
        for fault, code in [((429, {}), 'rate_limit'), ((503, {}), 'upstream'),
                            (TimeoutError('OFFLINE timeout'), 'timeout')]:
            with self.subTest(code=code):
                def search(payload, call):
                    if call == 1:
                        return [result(0, 'http')]
                    if '基础设施 专项规划' in payload['query']:
                        return fault
                    return [result(0, 'http')]
                router = Router(search)
                with self.assertRaises(provider.FullProviderError) as caught:
                    self.run_part(router)
                self.assertEqual(caught.exception.failure_code, code)
                self.assertIsNone(caught.exception.diagnostic_reason)
                self.assertEqual(len(router.searches), 4)
                self.assertEqual(router.chats, [])

    def test_same_stage_saved_evidence_skips_recovery_but_other_stages_do_not(self):
        saved = {'transport': {'text': '', 'metadata': {'evidence': [fixtures.evidence(50)]}}}
        before = copy.deepcopy(saved)
        router = Router(lambda payload, call: [result(0, 'http')])
        output = self.run_part(router, saved)
        self.assertEqual(len(router.searches), 1)
        self.assertEqual(saved, before)
        self.assertEqual(output['metadata']['evidence'][0]['url'], fixtures.evidence(50)['url'])
        router = Router(lambda payload, call: [result(0, 'http')])
        with self.assertRaises(provider.FullProviderError):
            self.run_part(router, {'economy': saved['transport']})
        self.assertEqual(len(router.searches), 4)
        self.assertEqual(router.chats, [])

    def test_deep_enterprise_and_fact_check_searches_do_not_gain_recovery(self):
        for stage, part, mode, expected in [('transport', '交通网络', 'deep', 1),
                                           ('enterprises_1', '候选池', 'standard', 2),
                                           ('fact_check', '经济关键数字', 'standard', 2)]:
            with self.subTest(stage=stage):
                router = Router(lambda payload, call: [result(0, 'http')])
                evidence = fixtures.live(router)._gather_evidence(
                    stage, part, 'OFFLINE测试城', full_fixtures.DirectionSerializationTests._prior(), mode=mode)
                self.assertEqual(evidence, [])
                self.assertEqual(len(router.searches), expected)
                self.assertTrue(all(p['numResults'] == 5 for p in router.searches))

    def test_final_population_retains_only_its_existing_completion_wave(self):
        router = Router(lambda payload, call: [result(0, 'http')])
        with self.assertRaises(provider.FullProviderError) as caught:
            self.run_part(router, stage='population', part='人才与劳动力')
        self.assertEqual(len(router.searches), 5)
        self.assertTrue(all(p['numResults'] == 8 for p in router.searches))
        self.assertEqual(caught.exception.diagnostic_reason, 'no_usable_search_evidence')
        self.assertEqual(router.chats, [])

    def test_final_ordinary_part_uses_one_recovery_wave_and_unchanged_stage_gate(self):
        prior = {'transport': {'text': fixtures.lines('saved transport', 60), 'metadata': {'evidence': []}}}
        before = copy.deepcopy(prior)
        router = Router(lambda payload, call: [result(i) for i in range(5)]
                        if '基础设施 专项规划' in payload['query'] else [result(0, 'http')])
        output = self.run_part(router, prior, part='园区载体')
        merged = contract.assemble('transport', [prior['transport'], output])
        self.assertEqual(contract.validate('transport', merged['text'], merged['metadata'], mode='standard'), [])
        self.assertEqual(len(router.searches), 4)
        self.assertEqual(prior, before)
        self.assertEqual(contract.minimum_evidence_urls('standard'), 5)
        self.assertEqual(contract.minimum_evidence_urls('deep'), 8)

    def test_repetition_rewrite_does_not_trigger_another_search_wave(self):
        router = Router(lambda payload, call: [result(20)] if call > 1 else [result(0, 'http')],
                        chat_texts=['\n'.join(['OFFLINE repeated'] * 36), fixtures.lines('corrected', 36)])
        self.run_part(router)
        self.assertEqual(len(router.searches), 4)
        self.assertEqual(len(router.chats), 2)
        self.assertEqual([timeout for url, timeout in router.timeouts if 'model.test' in url], [90, 90])

    def test_diagnostic_reason_and_counts_are_strictly_sanitized(self):
        for reason in ['https://secret.test/token', {}, None]:
            error = provider.FullProviderError('OFFLINE secret', 'quality', diagnostic_reason=reason,
                                              safe_metrics={'normalized_result_count': 'secret',
                                                            'non_https_result_count': 10001,
                                                            'empty_excerpt_count': 2})
            diagnostic = worker._failure_diagnostics(error, 'provider', 'transport', '交通网络')
            self.assertEqual(diagnostic['issues'], ['other_provider'])
            self.assertEqual(diagnostic['empty_excerpt_count'], 2)
            self.assertNotIn('secret', json.dumps(diagnostic))
            self.assertNotIn('non_https_result_count', diagnostic)


if __name__ == '__main__':
    unittest.main()
