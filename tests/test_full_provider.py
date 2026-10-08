"""TDD tests for report_service.full_provider.

The full provider exposes the part-scoped contract consumed by the durable
worker:

    FullSyntheticProvider().run_part(stage_id, part, job, prior) -> dict
    FullLiveProvider.from_env(env).run_part(stage_id, part, job, prior) -> dict

The live provider composes the existing ``OpenAIResearchProvider`` (search +
chat transport seam, Exa/Brave protocol and output bounds) without modifying
``providers.py``.  All live-provider tests here are offline: they inject a fake
transport, so no network or paid-model call is made.

The synthetic provider must always label itself as synthetic; the live provider
must fail closed when disabled and must be picklable (multiprocessing "spawn"
compatible) so the worker can run it in a child process.
"""

import json
import pickle
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from report_service import full_provider as fp  # noqa: E402
from report_service import full_contract as fc  # noqa: E402
from report_service import providers  # noqa: E402


class FakeResponse:
    def __init__(self, status=200, body=b"", url="https://api.exa.ai/search"):
        self.status = status
        self._body = body if isinstance(body, bytes) else body.encode("utf-8")
        self.url = url

    def read(self, size=-1):
        return self._body if size < 0 else self._body[:size]

    def geturl(self):
        return self.url

    def getcode(self):
        return self.status

    def close(self):
        pass


class RecordingRouter:
    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def __call__(self, request, timeout):
        self.calls.append(request)
        url = request.get_full_url()
        for key, (status, body) in self.routes.items():
            if key in url:
                if callable(body):
                    body = body(request)
                return FakeResponse(status, body, url)
        raise AssertionError("no route for %r" % url)


def _live_env(search_provider="exa"):
    return {
        "HXZ_ENABLE_LIVE": "1",
        "HXZ_MODEL_URL": "https://api.deepseek.com/chat/completions",
        "HXZ_MODEL_KEY": "MODEL_SECRET",
        "HXZ_MODEL_NAME": "deepseek-chat",
        "HXZ_SEARCH_PROVIDER": search_provider,
        "HXZ_SEARCH_URL": "https://api.exa.ai/search",
        "HXZ_SEARCH_KEY": "SEARCH_SECRET",
    }


class FakeRouterResult:
    pass  # keep imports tidy; real router built inline per-test


class SyntheticProviderTests(unittest.TestCase):
    def test_run_part_returns_dict_with_marker(self):
        p = fp.FullSyntheticProvider()
        out = p.run_part("economy", "经济总量", {"city": "杭州", "province": "浙江"}, None)
        self.assertIn("text", out)
        self.assertIn("metadata", out)
        self.assertIn(fc.SYNTHETIC_MARK, out["text"])

    def test_run_part_deterministic(self):
        p = fp.FullSyntheticProvider()
        a = p.run_part("economy", "经济总量", {"city": "杭州"}, None)
        b = p.run_part("economy", "经济总量", {"city": "杭州"}, None)
        self.assertEqual(a, b)

    def test_run_part_unknown_stage(self):
        p = fp.FullSyntheticProvider()
        with self.assertRaises(KeyError):
            p.run_part("bogus", "p", {}, None)

    def test_run_part_unknown_part(self):
        p = fp.FullSyntheticProvider()
        with self.assertRaises(ValueError):
            p.run_part("economy", "不存在的部分", {}, None)

    def test_synthetic_round_trips_through_assemble(self):
        p = fp.FullSyntheticProvider()
        parts = [p.run_part("economy", "经济总量", {"city": "杭州"}, None)]
        out = fc.assemble("economy", parts)
        self.assertIn(fc.SYNTHETIC_MARK, out["text"])
        self.assertEqual(fc.validate("economy", out["text"], out["metadata"], synthetic=True), [])


class LiveProviderEnvTests(unittest.TestCase):
    def test_from_env_builds_disabled_when_gate_off(self):
        p = fp.FullLiveProvider.from_env({})
        self.assertFalse(p.enabled)

    def test_from_env_builds_enabled_when_gate_on(self):
        p = fp.FullLiveProvider.from_env(_live_env())
        self.assertTrue(p.enabled)

    def test_from_env_preserves_search_provider_exa(self):
        p = fp.FullLiveProvider.from_env(_live_env("exa"))
        self.assertEqual(p.search_provider, "exa")

    def test_only_live_provider_allows_invalid_checkpoint_repair(self):
        self.assertTrue(fp.FullLiveProvider.repair_invalid_checkpoints)
        self.assertFalse(getattr(fp.FullSyntheticProvider(), 'repair_invalid_checkpoints', False))


class LiveProviderRuntimeTests(unittest.TestCase):
    def _provider(self, routes):
        p = fp.FullLiveProvider.from_env(_live_env())
        # Replace the composed live provider's transport with a fake router.
        p._live = providers.OpenAIResearchProvider(
            model_url="https://api.deepseek.com/chat/completions",
            api_key="MODEL_SECRET", model_name="deepseek-chat",
            search_provider="exa", search_url="https://api.exa.ai/search",
            search_key="SEARCH_SECRET", enabled=True,
            transport=routes, search_count=12,
        )
        p._live.enabled = True
        return p

    def test_disabled_fails_closed_without_network(self):
        p = fp.FullLiveProvider.from_env({})
        with self.assertRaises(providers.ProviderError):
            p.run_part("economy", "经济总量", {"city": "杭州"}, None)

    def test_research_part_searches_and_chats_with_evidence_metadata(self):
        # Offline protocol fixtures: no fetched pages or actual statistical claims.
        search = {"results": [{"title": f"Offline fixture {i}",
                               "url": f"https://stats.gov.cn/offline-fixture/{i}",
                               "text": f"Offline test excerpt {i}: source association only, not real statistics.",
                               "publishedDate": "2024-01-01"} for i in range(12)]}
        text = "\n".join(
            [f"{r['text']} Source: {r['url']}" for r in search["results"]]
            + [f"Offline analysis {i}: protocol/schema test only." for i in range(160)])
        chat = {"choices": [{"message": {"content": json.dumps({"text": text})}}]}
        # Each real query gets six results, respecting the transport normalizer
        # cap of eight; the two economy queries together retrieve all 12.
        batches = iter((search["results"][:6], search["results"][6:]))
        router = RecordingRouter({
            "chat/completions": (200, json.dumps(chat)),
            "exa.ai/search": (200, lambda request: json.dumps({"results": next(batches)})),
        })
        p = self._provider(router)
        out = p.run_part("economy", "经济总量", {"city": "杭州"}, None)
        self.assertIn("text", out)
        self.assertIn("metadata", out)
        self.assertTrue(out["metadata"].get("evidence"))
        self.assertEqual(out["metadata"]["evidence"][0]["url"], "https://stats.gov.cn/offline-fixture/0")
        self.assertEqual(len(out["metadata"]["evidence"]), 12)
        self.assertEqual(fc.validate("economy", out["text"], out["metadata"]), [])
        # search + chat both happened
        self.assertTrue(any("exa.ai" in r.get_full_url() for r in router.calls))
        self.assertTrue(any("chat/completions" in r.get_full_url() for r in router.calls))

    def test_non_research_part_skips_search(self):
        text = "\n".join(f"Offline summary item {i}: not an actual research claim." for i in range(80))
        chat = {"choices": [{"message": {"content": json.dumps({"text": text})}}]}
        router = RecordingRouter({"chat/completions": (200, json.dumps(chat))})
        p = self._provider(router)
        out = p.run_part("summary", "执行摘要", {"city": "杭州"},
                          {"economy": {"text": "e", "metadata": {}}})
        self.assertIn("text", out)
        self.assertEqual(fc.validate("summary", out["text"], out["metadata"]), [])
        self.assertTrue(all("exa.ai" not in r.get_full_url() for r in router.calls))

    def test_empty_search_fails_closed_on_research_part(self):
        router = RecordingRouter({"exa.ai/search": (200, json.dumps({"results": []}))})
        p = self._provider(router)
        with self.assertRaises(providers.ProviderError):
            p.run_part("economy", "经济总量", {"city": "杭州"}, None)

    def test_unknown_stage_rejected(self):
        p = self._provider(RecordingRouter({}))
        with self.assertRaises(KeyError):
            p.run_part("bogus", "p", {}, None)

    def test_unknown_part_rejected(self):
        p = self._provider(RecordingRouter({}))
        with self.assertRaises(ValueError):
            p.run_part("economy", "不存在的部分", {}, None)

    def test_search_key_and_model_key_do_not_leak(self):
        with self.assertRaises(providers.ProviderError) as ctx:
            p = self._provider(RecordingRouter({"exa.ai/search": (401, "bad SEARCH_SECRET")}))
            p.run_part("economy", "经济总量", {"city": "杭州"}, None)
        self.assertNotIn("SEARCH_SECRET", str(ctx.exception))

    def test_invalid_search_results_are_filtered_without_upgrading_http(self):
        urls = ['http://stats.gov.cn/insecure', 'https://127.0.0.1/private',
                'https://example.com/placeholder', 'https://evil.cn/gov.cn/fake',
                'https://stats.gov.cn/empty', 'https://stats.gov.cn/link-only',
                'https://stats.gov.cn/valid', 'https://mof.gov.cn/valid']
        entries = [{'url': url, 'text': 'OFFLINE evidence excerpt'} for url in urls]
        entries[4]['text'] = ''
        entries[5]['text'] = urls[5]
        router = RecordingRouter({'exa.ai/search': (200, json.dumps({'results': entries}))})
        out = self._provider(router)._gather_evidence('economy', '经济总量', '测试城')
        self.assertEqual([item['url'] for item in out], urls[-2:])
        self.assertNotIn('https://stats.gov.cn/insecure', [item['url'] for item in out])

    def test_all_unusable_search_results_fail_closed_without_chat(self):
        router = RecordingRouter({'exa.ai/search': (200, json.dumps({'results': [
            {'url': 'http://stats.gov.cn/insecure', 'text': 'OFFLINE excerpt'},
            {'url': 'https://stats.gov.cn/empty', 'text': ''}]}))})
        with self.assertRaises(fp.FullProviderError) as caught:
            self._provider(router).run_part('economy', '经济总量', {'city': '测试城'}, {})
        self.assertEqual(caught.exception.failure_code, 'quality')
        self.assertTrue(all('exa.ai/search' in call.full_url for call in router.calls))

    def test_final_part_floor_compensates_saved_short_parts_and_keeps_prior(self):
        prior_text = '\n'.join(f'已保存分析{i}' for i in range(81)) + '\n\n---\n\nTAIL-MUST-REMAIN'
        # Tail is a substantive line; separator and blank lines are excluded.
        prior = {'economy': {'text': prior_text, 'metadata': {}}}
        text = '\n'.join(f'当前分析{i}' for i in range(68))
        router = RecordingRouter({
            'exa.ai/search': (200, json.dumps({'results': [
                {'url': f'https://stats.gov.cn/offline/{i}', 'text': f'OFFLINE excerpt {i}'}
                for i in range(8)]})),
            'chat/completions': (200, json.dumps({'choices': [{'message': {'content': json.dumps({'text': text})}}]})),
        })
        p = self._provider(router)
        self.assertEqual(p._part_floor('economy', '区域定位', prior), 68)
        p.run_part('economy', '区域定位', {'city': '测试城'}, prior)
        chat = next(call for call in router.calls if 'chat/completions' in call.full_url)
        prompt = json.loads(chat.data)['messages'][-1]['content']
        self.assertIn('至少68行', prompt)
        self.assertIn(prior_text, prompt)
        self.assertIn('不代表已阅读完整原文', prompt)

    def test_short_final_part_is_rejected_before_checkpoint(self):
        p = self._provider(RecordingRouter({
            'exa.ai/search': (200, json.dumps({'results': [
                {'url': f'https://stats.gov.cn/offline/{i}', 'text': f'OFFLINE excerpt {i}'}
                for i in range(8)]})),
            'chat/completions': (200, json.dumps({'choices': [{'message': {'content': json.dumps({
                'text': '\n'.join(f'当前分析{i}' for i in range(38))})}}]})),
        }))
        prior = {'economy': {'text': '\n'.join(f'已保存分析{i}' for i in range(81)), 'metadata': {}}}
        with self.assertRaises(fp.FullProviderError) as caught:
            p.run_part('economy', '区域定位', {'city': '测试城'}, prior)
        self.assertEqual(caught.exception.failure_code, 'quality')
        self.assertEqual(str(caught.exception), 'part line floor not met')

    def test_new_part_checks_urls_and_filler_before_checkpoint(self):
        p = self._provider(RecordingRouter({}))
        for bad in ('http://stats.gov.cn/insecure', 'https://127.0.0.1/private',
                    'https://example.com/placeholder', 'https://evil.cn/gov.cn/fake'):
            with self.subTest(url=bad), self.assertRaises(fp.FullProviderError):
                p._validate_part_text('\n'.join(f'独立分析{i}' for i in range(38)) + '\n' + bad, 38)
        with self.assertRaises(fp.FullProviderError):
            p._validate_part_text('\n'.join(['重复分析'] * 30 + [f'独立分析{i}' for i in range(8)]), 38)

    def test_intermediate_and_deep_floors_preserve_original_stage_totals(self):
        p = self._provider(RecordingRouter({}))
        prior = {'economy': {'text': '\n'.join(f'已保存{i}' for i in range(20))}}
        self.assertEqual(p._part_floor('economy', '增长态势', prior), 54)
        self.assertEqual(p._part_floor('economy', '经济总量', {}), 38)
        self.assertEqual(p._part_floor('enterprises_1', '候选池', {}, 'deep'), 16)


class SelectedCompanyFactCheckTests(unittest.TestCase):
    _provider = LiveProviderRuntimeTests._provider
    @staticmethod
    def _prior():
        prior = {}
        for number in (1, 2, 3):
            selected, evidence = [], []
            for index in range(4):
                url = f'https://cninfo.com.cn/offline-company/{number}/{index}'
                selected.append({'name': f'方向{number}精选企业{index}', 'evidence_ref': url,
                                 'expansion_evidence': f'已保存扩产信号{number}-{index}'})
                evidence.append({'url': url, 'excerpt': f'OFFLINE saved disclosure {number}-{index}',
                                 'source': 'cninfo.com.cn', 'retrieval': 'exa_fulltext'})
            prior[f'enterprises_{number}'] = {'text': f'方向{number}前序完整报告',
                'metadata': {'selected': selected, 'evidence': evidence}}
        return prior

    def test_retrieval_targets_three_saved_companies_per_direction_and_two_source_types(self):
        def search(request):
            query = json.loads(request.data)['query']
            marker = query.split()[0]
            family = 'disclosure' if '公司公告' in query else 'annual-report'
            return json.dumps({'results': [
                {'url': 'http://cninfo.com.cn/insecure', 'text': 'OFFLINE insecure'},
                {'url': 'https://example.com/placeholder', 'text': 'OFFLINE placeholder'},
            ] + [
                {'url': f'https://cninfo.com.cn/offline/{marker}/{family}/{i}',
                 'text': f'OFFLINE {marker} excerpt {family}/{i}'} for i in range(4)]})
        router = RecordingRouter({'exa.ai/search': (200, search)})
        p = self._provider(router)
        out = p._gather_evidence('fact_check', '五星企业信号', '上海市松江区', self._prior())
        queries = [json.loads(call.data)['query'] for call in router.calls]
        expected = [f'方向{direction}精选企业{index}' for direction in (1, 2, 3) for index in range(3)]
        self.assertEqual([query.split()[0] for query in queries[::2]], expected)
        self.assertEqual([query.split()[0] for query in queries[1::2]], expected)
        self.assertTrue(all('公司公告' in query for query in queries[::2]))
        self.assertTrue(all('年度报告' in query for query in queries[1::2]))
        self.assertTrue(all('已保存扩产信号' in query for query in queries))
        self.assertTrue(all('五星级' not in query and '认定 名单' not in query for query in queries))
        self.assertEqual(len(out), 36)

    def test_saved_selection_grounding_remains_available_only_for_fact_check(self):
        saved = self._prior()
        source = saved['enterprises_1']['metadata']['evidence'][0]['url']
        cross = 'https://stats.gov.cn/offline-new/cross'
        text = '\n'.join(f'核验分析{i}' for i in range(80))
        payload = {'text': text, 'checks': [
            {'claim': '方向1精选企业0扩产信号', 'source': source, 'cross_source': cross,
             'category': 'high_star', 'direction': 'dir1', 'verdict': '待核实'},
            {'claim': '同一网页不能交叉核验', 'source': source, 'cross_source': source,
             'category': 'high_star', 'direction': 'dir1'},
        ]}
        router = RecordingRouter({
            'exa.ai/search': (200, json.dumps({'results': [{'url': cross, 'text': 'OFFLINE cross excerpt'}]})),
            'chat/completions': (200, json.dumps({'choices': [{'message': {'content': json.dumps(payload)}}]})),
        })
        p = self._provider(router)
        out = p.run_part('fact_check', '五星企业信号', {'city': '测试城'}, saved)
        self.assertEqual(len(out['metadata']['checks']), 1)
        self.assertEqual(out['metadata']['checks'][0]['direction'], 'dir1')
        self.assertEqual(out['metadata']['checks'][0]['source'], source)
        chat = next(call for call in router.calls if 'chat/completions' in call.full_url)
        prompt = json.loads(chat.data)['messages'][-1]['content']
        self.assertIn('前序enterprises_1/2/3各方向已精选企业', prompt)
        self.assertIn('OFFLINE saved disclosure 1-0', prompt)
        self.assertEqual(len(p._selected_evidence(saved)), 9)
        # Other stages do not gain unrelated enterprise evidence.
        other = p.run_part('economy', '经济总量', {'city': '测试城'}, saved)
        self.assertEqual([e['url'] for e in other['metadata']['evidence']], [cross])

    def test_invalid_saved_sources_cannot_ground_checks(self):
        saved = self._prior()
        saved['enterprises_1']['metadata']['evidence'][0]['excerpt'] = ''
        saved['enterprises_2']['metadata']['evidence'][0]['url'] = 'http://cninfo.com.cn/insecure'
        out = self._provider(RecordingRouter({}))._selected_evidence(saved)
        self.assertEqual(len(out), 7)
        self.assertTrue(all(e['excerpt'] and e['url'].startswith('https://') for e in out))

    def test_selected_signal_and_full_prior_are_not_truncated(self):
        saved = self._prior()
        signal = '完整信号内容' * 100 + 'TAIL-SIGNAL-MUST-REMAIN'
        saved['enterprises_1']['metadata']['selected'][0]['expansion_evidence'] = signal
        p = self._provider(RecordingRouter({}))
        self.assertIn(signal, p._company_check_queries(saved, '测试城')[0])
        self.assertIn(signal, p._render_prior(saved, 'fact_check'))


class SerializationTests(unittest.TestCase):
    def test_synthetic_provider_pickle_round_trip(self):
        p = fp.FullSyntheticProvider()
        p2 = pickle.loads(pickle.dumps(p))
        self.assertEqual(p.run_part("economy", "经济总量", {"city": "杭州"}, None),
                         p2.run_part("economy", "经济总量", {"city": "杭州"}, None))

    def test_live_provider_pickle_round_trip(self):
        p = fp.FullLiveProvider.from_env(_live_env())
        data = pickle.dumps(p)
        p2 = pickle.loads(data)
        self.assertEqual(p2.enabled, p.enabled)
        self.assertEqual(p2.search_provider, p.search_provider)

    def test_synthetic_provider_importable_for_spawn(self):
        # spawn requires the class be importable from the module, not a closure.
        self.assertTrue(hasattr(fp, "FullSyntheticProvider"))
        self.assertTrue(hasattr(fp, "FullLiveProvider"))
        self.assertTrue(fp.FullSyntheticProvider.__module__.endswith("full_provider"))


if __name__ == "__main__":
    unittest.main()
