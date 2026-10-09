"""Tests for the independently-owned report_service.providers module.

These tests never perform live network or cost-budget operations: every HTTP
call goes through an injected transport seam, and the live provider is only
exercised with HXZ_ENABLE_LIVE=1 plus a fake transport.
"""
import ast
import json
import sys
import unittest
from pathlib import Path

import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from report_service import providers  # noqa: E402


class FakeResponse:
    """Minimal response object matching the transport seam contract."""

    def __init__(self, status=200, body=b"", url="https://example.com/"):
        self.status = status
        self._body = body if isinstance(body, bytes) else body.encode("utf-8")
        self.url = url

    def read(self, size=-1):
        return self._body if size < 0 else self._body[:size]

    def close(self):
        pass

    def geturl(self):
        return self.url

    def getcode(self):
        return self.status


class RecordingRouter:
    """Injected transport that routes by URL substring and records requests."""

    def __init__(self, routes):
        # routes: {substring: (status, body_or_str)}
        self.routes = routes
        self.calls = []
        self.timeouts = []

    def __call__(self, request, timeout):
        self.calls.append(request)
        self.timeouts.append(timeout)
        url = request.get_full_url()
        for key, (status, body) in self.routes.items():
            if key in url:
                return FakeResponse(status, body, url)
        raise AssertionError("no route for %r" % url)


def make_provider(**overrides):
    params = dict(
        model_url="https://model.example.com/v1/chat/completions",
        api_key="API_SECRET_123",
        model_name="test-model",
        search_url="https://search.example.com/res/v1/web/search",
        search_key="SEARCH_SECRET_456",
        enabled=True,
        transport=RecordingRouter({}),
        search_count=1,
    )
    params.update(overrides)
    return providers.OpenAIResearchProvider(**params)


class SyntheticProviderTests(unittest.TestCase):
    def setUp(self):
        self.provider = providers.SyntheticProvider()
        self.job = {"city": "杭州", "province": "浙江"}

    def test_output_is_deterministic(self):
        a = self.provider.run("economy", self.job, None)
        b = self.provider.run("economy", self.job, None)
        self.assertEqual(a, b)

    def test_prior_affects_output_deterministically(self):
        a = self.provider.run("report", self.job, {"economy": "A"})
        b = self.provider.run("report", self.job, {"economy": "B"})
        self.assertNotEqual(a, b)

    def test_marker_prominent_and_records_no_real_statistics(self):
        out = self.provider.run("economy", self.job, None)
        self.assertTrue(out.strip().startswith(providers.SYNTHETIC_MARK))
        self.assertIn("SYNTHETIC TEST", out)
        self.assertIn("NOT RESEARCH", out)
        self.assertIn("不包含任何真实统计", out)

    def test_uses_job_city_and_province(self):
        out = self.provider.run("industry", self.job, None)
        self.assertIn("杭州", out)
        self.assertIn("浙江", out)

    def test_unknown_stage_rejected(self):
        with self.assertRaises(ValueError):
            self.provider.run("bogus", self.job, None)


class EndpointValidationTests(unittest.TestCase):
    def test_accepts_public_https(self):
        url = "https://example.com/v1/chat/completions"
        self.assertEqual(providers.validate_https_url(url), url)

    def test_rejects_non_https(self):
        with self.assertRaises(ValueError):
            providers.validate_https_url("http://example.com/x")

    def test_rejects_private_and_local_hosts(self):
        for bad in (
            "https://127.0.0.1/x",
            "https://localhost/x",
            "https://10.0.0.1/x",
            "https://192.168.1.10/x",
            "https://[::1]/x",
        ):
            with self.assertRaises(ValueError, msg=bad):
                providers.validate_https_url(bad)

    def test_allow_private_flag(self):
        providers.validate_https_url("https://127.0.0.1/x", allow_private=True)

    def test_enabled_provider_rejects_bad_endpoint(self):
        with self.assertRaises(ValueError):
            providers.OpenAIResearchProvider(
                model_url="http://127.0.0.1/x",
                api_key="k", model_name="m",
                search_url="https://search.example.com/x",
                search_key="s", enabled=True,
            )


class LiveGateTests(unittest.TestCase):
    def test_from_env_enabled_only_when_gate_is_1(self):
        env = {
            "HXZ_ENABLE_LIVE": "1",
            "HXZ_MODEL_URL": "https://model.example.com/v1/chat/completions",
            "HXZ_MODEL_KEY": "k",
            "HXZ_MODEL_NAME": "my-model",
            "HXZ_SEARCH_URL": "https://search.example.com/x",
            "HXZ_SEARCH_KEY": "sk",
        }
        on = providers.OpenAIResearchProvider.from_env(env)
        self.assertTrue(on.enabled)
        self.assertEqual(on.model_name, "my-model")

        off = providers.OpenAIResearchProvider.from_env({k: v for k, v in env.items() if k != "HXZ_ENABLE_LIVE"})
        self.assertFalse(off.enabled)

        off2 = providers.OpenAIResearchProvider.from_env({**env, "HXZ_ENABLE_LIVE": "0"})
        self.assertFalse(off2.enabled)

    def test_disabled_provider_fails_closed_without_network(self):
        class Explode:
            def __call__(self, request, timeout):
                raise AssertionError("transport must not be called when disabled")

        p = providers.OpenAIResearchProvider(
            model_url="", api_key="", model_name="",
            search_url="", search_key="", enabled=False, transport=Explode(),
        )
        with self.assertRaises(providers.ProviderError):
            p.run("economy", {"city": "杭州"}, None)


class PayloadTests(unittest.TestCase):
    def _router(self):
        chat = {"choices": [{"message": {"content": "结论，来源 https://a.example.com"}}]}
        search = {"web": {"results": [{"title": "t", "url": "https://a.example.com", "description": "d"}]}}
        return RecordingRouter({
            "chat/completions": (200, json.dumps(chat)),
            "search": (200, json.dumps(search)),
        })

    def test_chat_payload_and_auth_headers(self):
        router = self._router()
        p = make_provider(transport=router, search_count=1)
        out = p.run("economy", {"city": "杭州", "province": "浙江"}, None)
        self.assertIn("结论", out)

        chat_req = next(r for r in router.calls if "chat/completions" in r.get_full_url())
        payload = json.loads(chat_req.data.decode("utf-8"))
        self.assertEqual(payload["model"], "test-model")
        self.assertIsInstance(payload["messages"], list)
        self.assertNotIn("response_format", payload)
        self.assertLessEqual(payload.get("max_tokens", 0), providers.MAX_OUTPUT_TOKENS)
        user_content = payload["messages"][-1]["content"]
        self.assertIn("杭州", user_content)
        self.assertIn("https://a.example.com", user_content)  # evidence URL cited
        self.assertEqual(chat_req.get_header("Authorization"), "Bearer API_SECRET_123")

    def test_search_request_uses_subscription_token(self):
        router = self._router()
        p = make_provider(transport=router, search_count=1)
        p.run("economy", {"city": "杭州"}, None)
        search_req = next(r for r in router.calls if "search" in r.get_full_url())
        self.assertEqual(dict((k.lower(), v) for k, v in search_req.header_items()).get("x-subscription-token"), "SEARCH_SECRET_456")
        self.assertIn("q=", search_req.get_full_url())

    def test_brave_search_and_chat_use_separate_default_timeouts(self):
        router = self._router()
        make_provider(transport=router).run("economy", {"city": "杭州"}, None)
        requests = dict(zip((r.get_method() for r in router.calls), router.timeouts))
        self.assertEqual(requests["GET"], 30.0)
        self.assertEqual(requests["POST"], 90.0)

    def test_chat_timeout_override_does_not_change_search_timeout(self):
        router = self._router()
        make_provider(transport=router, chat_timeout=110).run("economy", {"city": "杭州"}, None)
        self.assertEqual(router.timeouts, [30.0, 110.0])

    def test_chat_request_tokens_are_capped_at_doubled_limit(self):
        router = self._router()
        provider = make_provider(transport=router, max_output_tokens=99999)
        self.assertEqual(provider.max_output_tokens, 16000)
        provider._chat([{"role": "user", "content": "offline fixture"}], 99999)
        self.assertEqual(json.loads(router.calls[0].data)["max_tokens"], 16000)

    def test_json_chat_mode_explicitly_requests_json_object(self):
        router = self._router()
        provider = make_provider(transport=router)
        messages = [{"role": "user", "content": 'Return JSON only, e.g. {"ok": true}.'}]
        provider._chat(messages, 16000, json_mode=True)
        payload = json.loads(router.calls[0].data)
        self.assertEqual(payload["response_format"], {"type": "json_object"})
        self.assertEqual(payload["messages"], messages)
        self.assertEqual(payload["max_tokens"], 16000)
        self.assertEqual(router.timeouts, [90.0])

    def test_report_stage_does_not_require_search(self):
        chat = {"choices": [{"message": {"content": "报告内容"}}]}
        router = RecordingRouter({"chat/completions": (200, json.dumps(chat))})
        p = make_provider(transport=router)
        out = p.run("report", {"city": "杭州"}, {"economy": "e", "industry": "i"})
        self.assertIn("报告内容", out)
        self.assertTrue(all("search" not in r.get_full_url() for r in router.calls))


class FailClosedTests(unittest.TestCase):
    def test_research_stage_fails_closed_on_empty_evidence(self):
        router = RecordingRouter({"search": (200, json.dumps({"web": {"results": []}}))})
        p = make_provider(transport=router, search_count=1)
        with self.assertRaises(providers.ProviderError):
            p.run("economy", {"city": "杭州"}, None)
        # chat must never be reached
        self.assertTrue(all("chat" not in r.get_full_url() for r in router.calls))

    def test_upstream_http_error_is_sanitized(self):
        router = RecordingRouter({"search": (500, "boom API_SECRET_123 SEARCH_SECRET_456")})
        p = make_provider(transport=router)
        with self.assertRaises(providers.ProviderError) as ctx:
            p.run("economy", {"city": "杭州"}, None)
        msg = str(ctx.exception)
        self.assertNotIn("API_SECRET_123", msg)
        self.assertNotIn("SEARCH_SECRET_456", msg)

    def test_transport_exception_is_sanitized(self):
        def boom(request, timeout):
            raise OSError("connect failed SEARCH_SECRET_456")

        p = make_provider(transport=boom)
        with self.assertRaises(providers.ProviderError) as ctx:
            p.run("economy", {"city": "杭州"}, None)
        self.assertNotIn("SEARCH_SECRET_456", str(ctx.exception))

    def test_non_json_response_fails_clean(self):
        router = RecordingRouter({"search": (200, "not json")})
        p = make_provider(transport=router)
        with self.assertRaises(providers.ProviderError):
            p.run("economy", {"city": "杭州"}, None)


class RedirectGuardTests(unittest.TestCase):
    def test_cross_host_redirect_strips_auth_headers(self):
        handler = providers._GuardedRedirectHandler()
        req = urllib.request.Request("https://a.example.com/start")
        req.add_header("Authorization", "Bearer API_SECRET_123")
        req.add_header("X-Subscription-Token", "SEARCH_SECRET_456")
        new = handler.redirect_request(req, None, 302, "Found", {}, "https://b.example.com/other")
        self.assertIsNotNone(new)
        self.assertIsNone(new.get_header("Authorization"))
        self.assertIsNone(new.get_header("X-Subscription-Token"))

    def test_same_host_redirect_keeps_auth_headers(self):
        handler = providers._GuardedRedirectHandler()
        req = urllib.request.Request("https://a.example.com/start")
        req.add_header("Authorization", "Bearer API_SECRET_123")
        new = handler.redirect_request(req, None, 302, "Found", {}, "https://a.example.com/other")
        self.assertIsNotNone(new)
        self.assertEqual(new.get_header("Authorization"), "Bearer API_SECRET_123")


class DependencyTests(unittest.TestCase):
    def test_stdlib_only_no_violoop_or_http_clients(self):
        src = (ROOT / "report_service" / "providers.py").read_text()
        tree = ast.parse(src)
        forbidden = {
            "requests", "openai", "httpx", "aiohttp", "urllib3", "violoop",
            "anthropic", "brave", "dotenv", "pydantic",
        }
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    imported.add(node.module.split(".")[0])
        overlap = imported & forbidden
        self.assertEqual(overlap, set(), msg="forbidden imports: %s" % overlap)
        self.assertIn("urllib", imported, msg="must use stdlib urllib transport seam")


if __name__ == "__main__":
    unittest.main()
