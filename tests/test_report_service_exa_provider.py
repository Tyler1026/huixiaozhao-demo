"""TDD: Exa search protocol support in OpenAIResearchProvider.

Exa's /search is POST + JSON body + `x-api-key` header, and its response
shape is `{"results": [{"title", "url", "text"/"highlights"}], "requestId"}`
-- structurally different from the Brave GET + query-string + subscription
header contract these tests exercise it against.
"""
import json
import sys
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

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
                return FakeResponse(status, body, url)
        raise AssertionError("no route for %r" % url)


def make_exa_provider(**overrides):
    params = dict(
        model_url="https://api.deepseek.com/chat/completions",
        api_key="MODEL_SECRET",
        model_name="deepseek-chat",
        search_provider="exa",
        search_url="https://api.exa.ai/search",
        search_key="EXA_SECRET",
        enabled=True,
        transport=RecordingRouter({}),
        search_count=1,
    )
    params.update(overrides)
    return providers.OpenAIResearchProvider(**params)


class ExaProtocolTests(unittest.TestCase):
    def _router(self, exa_body):
        chat = {"choices": [{"message": {"content": "结论，来源 https://a.example.com"}}]}
        return RecordingRouter({
            "chat/completions": (200, json.dumps(chat)),
            "exa.ai/search": (200, json.dumps(exa_body)),
        })

    def test_search_request_is_post_json_with_x_api_key_header(self):
        router = self._router({"results": [{"title": "t", "url": "https://a.example.com", "text": "d"}]})
        p = make_exa_provider(transport=router)
        p.run("economy", {"city": "松江区", "province": "上海"}, None)

        search_req = next(r for r in router.calls if "exa.ai" in r.get_full_url())
        self.assertEqual(search_req.get_method(), "POST")
        headers = {k.lower(): v for k, v in search_req.header_items()}
        self.assertEqual(headers.get("x-api-key"), "EXA_SECRET")
        self.assertNotIn("authorization", headers)  # model key must not leak to search
        payload = json.loads(search_req.data.decode("utf-8"))
        self.assertIn("松江区", payload["query"])
        self.assertEqual(payload["numResults"], 1)
        self.assertIn("contents", payload)

    def test_exa_results_normalized_from_text_or_highlights(self):
        router = self._router({"results": [
            {"title": "T1", "url": "https://a.example.com", "text": "long body"},
            {"title": "T2", "url": "https://b.example.com", "highlights": ["short highlight"]},
        ]})
        p = make_exa_provider(transport=router)
        out = p.run("economy", {"city": "松江区"}, None)
        chat_req = next(r for r in router.calls if "chat/completions" in r.get_full_url())
        user_content = json.loads(chat_req.data.decode("utf-8"))["messages"][-1]["content"]
        self.assertIn("https://a.example.com", user_content)
        self.assertIn("https://b.example.com", user_content)
        self.assertIn("结论", out)

    def test_exa_empty_results_fails_closed(self):
        router = self._router({"results": []})
        p = make_exa_provider(transport=router)
        with self.assertRaises(providers.ProviderError):
            p.run("economy", {"city": "松江区"}, None)

    def test_exa_key_sanitized_on_error(self):
        router = RecordingRouter({"exa.ai/search": (401, "unauthorized EXA_SECRET")})
        p = make_exa_provider(transport=router)
        with self.assertRaises(providers.ProviderError) as ctx:
            p.run("economy", {"city": "松江区"}, None)
        self.assertNotIn("EXA_SECRET", str(ctx.exception))

    def test_unknown_search_provider_rejected_at_construction(self):
        with self.assertRaises(ValueError):
            make_exa_provider(search_provider="bing")

    def test_from_env_reads_max_output_tokens_override(self):
        env = {
            "HXZ_ENABLE_LIVE": "1", "HXZ_MODEL_URL": "https://api.deepseek.com/chat/completions",
            "HXZ_MODEL_KEY": "k", "HXZ_MODEL_NAME": "deepseek-chat",
            "HXZ_SEARCH_PROVIDER": "exa", "HXZ_SEARCH_KEY": "sk",
            "HXZ_MODEL_MAX_TOKENS": "2200",
        }
        p = providers.OpenAIResearchProvider.from_env(env)
        self.assertEqual(p.max_output_tokens, 2200)

    def test_from_env_max_output_tokens_falls_back_to_default(self):
        env = {
            "HXZ_ENABLE_LIVE": "1", "HXZ_MODEL_URL": "https://api.deepseek.com/chat/completions",
            "HXZ_MODEL_KEY": "k", "HXZ_MODEL_NAME": "deepseek-chat",
            "HXZ_SEARCH_PROVIDER": "exa", "HXZ_SEARCH_KEY": "sk",
        }
        p = providers.OpenAIResearchProvider.from_env(env)
        self.assertEqual(p.max_output_tokens, providers.DEFAULT_OUTPUT_TOKENS)

    def test_report_stage_uses_larger_token_budget_than_configured_default(self):
        chat = {"choices": [{"message": {"content": "综合报告"}}]}
        router = RecordingRouter({"chat/completions": (200, json.dumps(chat))})
        p = make_exa_provider(transport=router, max_output_tokens=1000)
        p.run("report", {"city": "松江区"}, {"economy": "e"})
        chat_req = next(r for r in router.calls if "chat/completions" in r.get_full_url())
        payload = json.loads(chat_req.data.decode("utf-8"))
        self.assertGreater(payload["max_tokens"], 1000)
        self.assertLessEqual(payload["max_tokens"], providers.MAX_OUTPUT_TOKENS)

    def test_non_report_stage_uses_configured_budget(self):
        chat = {"choices": [{"message": {"content": "结论"}}]}
        router = RecordingRouter({
            "chat/completions": (200, json.dumps(chat)),
            "exa.ai/search": (200, json.dumps({"results": [{"title": "t", "url": "https://a.example.com", "text": "d"}]})),
        })
        p = make_exa_provider(transport=router, max_output_tokens=1000)
        p.run("economy", {"city": "松江区"}, None)
        chat_req = next(r for r in router.calls if "chat/completions" in r.get_full_url())
        payload = json.loads(chat_req.data.decode("utf-8"))
        self.assertEqual(payload["max_tokens"], 1000)

    def test_brave_protocol_still_works_when_selected_explicitly(self):
        chat = {"choices": [{"message": {"content": "ok https://a.example.com"}}]}
        brave_body = {"web": {"results": [{"title": "t", "url": "https://a.example.com", "description": "d"}]}}
        router = RecordingRouter({
            "chat/completions": (200, json.dumps(chat)),
            "search.brave.com": (200, json.dumps(brave_body)),
        })
        p = providers.OpenAIResearchProvider(
            model_url="https://api.deepseek.com/chat/completions", api_key="k",
            model_name="deepseek-chat", search_provider="brave",
            search_url="https://api.search.brave.com/res/v1/web/search",
            search_key="s", enabled=True, transport=router, search_count=1,
        )
        p.run("economy", {"city": "松江区"}, None)
        search_req = next(r for r in router.calls if "brave.com" in r.get_full_url())
        self.assertEqual(search_req.get_method(), "GET")


if __name__ == "__main__":
    unittest.main()
