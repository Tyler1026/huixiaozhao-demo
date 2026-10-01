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
