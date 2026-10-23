"""Offline regression for ordinary standard chapter evidence completion.

All searches/chats use the injected protocol fixture; no live service or DB.
"""
import copy
import threading
import unittest

from report_service import full_contract as contract
from report_service import full_provider as provider
from report_service import full_worker as worker
from report_service import providers
import test_empty_search_recovery as fixtures


STAGES = ('economy', 'population', 'transport', 'life', 'industry',
          'competition', 'policy', 'chain')


def saved(stage, count=3):
    return {stage: {'text': fixtures.fixtures.lines('saved-' + stage, 70),
                    'metadata': {'evidence': [dict(url=fixtures.result(i)['url'],
                                                  excerpt=fixtures.result(i)['text'])
                                              for i in range(count)]}}}


class StageEvidenceCompletionTests(unittest.TestCase):
    def gather(self, router, stage, prior, mode='standard'):
        part = contract.get_stage(stage, mode=mode)['parts'][-1]
        return fixtures.fixtures.live(router)._gather_evidence(
            stage, part, 'OFFLINE测试城', prior, mode=mode)

    def run_last(self, router, stage, prior):
        return fixtures.fixtures.live(router).run_part(
            stage, contract.get_stage(stage)['parts'][-1],
            {'city': 'OFFLINE测试城', 'mode': 'standard'}, prior)

    def test_all_eight_final_stages_can_close_three_to_five_without_mutating_prior(self):
        for stage in STAGES:
            with self.subTest(stage=stage):
                prior = saved(stage)
                before = copy.deepcopy(prior)
                if stage == 'population':
                    first, second = ('人力资源 社会保障', '第七次人口普查')
                else:
                    first, second = provider._EMPTY_SEARCH_TOPICS[stage]
                def search(payload, call):
                    query = payload['query']
                    if first in query:
                        return [fixtures.result(3)]
                    if second in query:
                        return [fixtures.result(4)]
                    return [fixtures.result(i) for i in range(3)]
                router = fixtures.Router(search)
                found = self.gather(router, stage, prior)
                union = prior[stage]['metadata']['evidence'] + found
                self.assertEqual(len({contract.canonical_url(e['url']) for e in union}), 5)
                self.assertEqual(prior, before)
                self.assertEqual(len(router.searches), 5 if stage == 'population' else 4)
                self.assertTrue(all(p['numResults'] == providers.MAX_SEARCH_COUNT
                                    for p in router.searches))

    def test_all_eight_final_stages_fail_before_chat_when_chapter_stays_at_three(self):
        for stage in STAGES:
            with self.subTest(stage=stage):
                prior = saved(stage)
                before = copy.deepcopy(prior)
                router = fixtures.Router(lambda payload, call: [fixtures.result(i) for i in range(3)])
                with self.assertRaises(provider.FullProviderError) as failure:
                    self.run_last(router, stage, prior)
                self.assertEqual(failure.exception.failure_code, 'quality')
                self.assertEqual(failure.exception.safe_metrics['evidence_count'], 3)
                self.assertEqual(failure.exception.safe_metrics['min_evidence_urls'], 5)
                self.assertEqual(failure.exception.safe_metrics['query_count'], 5 if stage == 'population' else 4)
                diagnostic = worker._failure_diagnostics(
                    failure.exception, 'provider', stage, contract.get_stage(stage)['parts'][-1])
                self.assertEqual(diagnostic['issues'], ['evidence_floor'])
                self.assertNotIn('OFFLINE', str(diagnostic))
                self.assertNotIn('stats.gov.cn', str(diagnostic))
                self.assertEqual(router.chats, [])
                self.assertEqual(prior, before)

    def test_all_eight_sufficient_same_stage_cache_needs_only_initial_lookup(self):
        for stage in STAGES:
            with self.subTest(stage=stage):
                prior = saved(stage, 5)
                router = fixtures.Router(lambda payload, call: [])
                self.assertEqual(len(self.gather(router, stage, prior)), 5)
                self.assertEqual(len(router.searches), 1)
                self.assertEqual(router.searches[0]['numResults'], 8)

    def test_other_stage_sources_and_url_variants_do_not_fill_deficit(self):
        prior = saved('industry')
        prior.update(saved('economy', 8))
        def search(payload, call):
            return [dict(fixtures.result(i), url=fixtures.result(i)['url'] + '?q=' + str(call) + '#tail')
                    for i in range(3)]
        router = fixtures.Router(search)
        with self.assertRaises(provider.FullProviderError) as failure:
            self.run_last(router, 'industry', prior)
        self.assertEqual(failure.exception.safe_metrics['evidence_count'], 3)
        self.assertEqual(len(router.searches), 4)
        self.assertEqual(router.chats, [])

    def test_distinct_actual_hosts_and_paths_can_fill_deficit_but_http_cannot(self):
        prior = saved('industry')
        def search(payload, call):
            return [fixtures.result(3, host='industry.gov.cn'),
                    fixtures.result(4, host='statistics.gov.cn'), fixtures.result(5, 'http')]
        router = fixtures.Router(search)
        result = self.gather(router, 'industry', prior)
        self.assertEqual({e['url'] for e in result},
                         {fixtures.result(3, host='industry.gov.cn')['url'],
                          fixtures.result(4, host='statistics.gov.cn')['url']})
        self.assertEqual(len(router.searches), 1)

    def test_final_initial_lookup_expands_before_requesting_any_supplement(self):
        records = [fixtures.result(i, 'http') for i in range(3)] + [fixtures.result(i) for i in range(3, 8)]
        router = fixtures.Router(lambda payload, call: records)
        result = self.gather(router, 'transport', {})
        self.assertEqual(len(result), 5)
        self.assertEqual([p['numResults'] for p in router.searches], [8])

    def test_zero_recovery_shares_final_batch_and_population_keeps_its_four_queries(self):
        for stage in STAGES:
            with self.subTest(stage=stage):
                router = fixtures.Router(lambda payload, call: [fixtures.result(0, 'http')])
                with self.assertRaises(provider.FullProviderError) as failure:
                    self.run_last(router, stage, {})
                self.assertEqual(failure.exception.failure_code, 'quality')
                self.assertEqual(failure.exception.diagnostic_reason, 'no_usable_search_evidence')
                expected = 5 if stage == 'population' else 4
                self.assertEqual(len(router.searches), expected)
                self.assertEqual(failure.exception.safe_metrics['query_count'], expected)
                self.assertEqual(router.chats, [])

    def test_auth_and_rate_limit_never_pay_for_chat_even_with_other_valid_results(self):
        for fault, code in [((401, {}), 'configuration'), ((403, {}), 'configuration'),
                            ((429, {}), 'rate_limit')]:
            for initial in (False, True):
                with self.subTest(code=code, initial=initial):
                    def search(payload, call):
                        if (initial and call == 1) or (not initial and '工业经济 经信局' in payload['query']):
                            return fault
                        return [fixtures.result(i) for i in range(3)] if call == 1 else [fixtures.result(i) for i in range(3, 6)]
                    router = fixtures.Router(search)
                    with self.assertRaises(provider.FullProviderError) as failure:
                        self.run_last(router, 'industry', saved('industry'))
                    self.assertEqual(failure.exception.failure_code, code)
                    self.assertEqual(len(router.searches), 1 if initial else 4)
                    self.assertEqual(router.chats, [])

    def test_missing_floor_preserves_timeout_and_upstream_classification(self):
        for fault, code in [(TimeoutError('OFFLINE timeout'), 'timeout'),
                            ((503, {}), 'upstream')]:
            with self.subTest(code=code):
                router = fixtures.Router(lambda payload, call: [fixtures.result(0)] if call == 1 else fault)
                with self.assertRaises(provider.FullProviderError) as failure:
                    self.run_last(router, 'industry', saved('industry'))
                self.assertEqual(failure.exception.failure_code, code)
                self.assertEqual(failure.exception.safe_metrics['evidence_count'], 3)
                self.assertEqual(failure.exception.safe_metrics['min_evidence_urls'], 5)
                self.assertEqual(router.chats, [])

    def test_completion_is_one_concurrent_window_even_with_one_text_rewrite(self):
        barrier = threading.Barrier(3, timeout=2)
        prior = saved('transport')
        def search(payload, call):
            if call > 1:
                barrier.wait()
            return [fixtures.result(i) for i in range(5)] if '基础设施 专项规划' in payload['query'] else [fixtures.result(0)]
        router = fixtures.Router(search, chat_texts=[prior['transport']['text'],
                                                   fixtures.fixtures.lines('new-transport', 36)])
        result = self.run_last(router, 'transport', prior)
        self.assertEqual(len(router.searches), 4)
        self.assertEqual(len(router.chats), 2)
        search_timeouts = [timeout for url, timeout in router.timeouts if 'exa.ai' in url]
        chat_timeouts = [timeout for url, timeout in router.timeouts if 'model.test' in url]
        self.assertEqual(search_timeouts, [30] * 4)
        self.assertEqual(chat_timeouts, [90, 90])
        self.assertEqual(2 * max(search_timeouts) + sum(chat_timeouts), 240)
        self.assertEqual(contract.validate('transport',
                         contract.assemble('transport', [prior['transport'], result])['text'],
                         result['metadata'], mode='standard'), [])

    def test_deep_and_intermediate_parts_do_not_gain_the_five_source_gate(self):
        router = fixtures.Router(lambda payload, call: [fixtures.result(0)])
        self.assertEqual(len(self.gather(router, 'industry', {}, mode='deep')), 1)
        self.assertEqual([p['numResults'] for p in router.searches], [5])
        router = fixtures.Router(lambda payload, call: [fixtures.result(0)])
        result = fixtures.fixtures.live(router).run_part('transport', '交通网络',
                                                      {'city': 'OFFLINE测试城', 'mode': 'standard'}, {})
        self.assertEqual(len(router.searches), 1)
        self.assertEqual(len(router.chats), 1)
        self.assertEqual(len(result['metadata']['evidence']), 1)


if __name__ == '__main__':
    unittest.main()
