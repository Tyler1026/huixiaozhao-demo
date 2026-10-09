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

import copy
import json
import pickle
import sys
import unittest
import datetime
import threading
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
        self.assertEqual(p._part_floor('economy', '区域定位', prior, 'deep'), 68)
        p.run_part('economy', '区域定位', {'city': '测试城', 'mode': 'deep'}, prior)
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
            p.run_part('economy', '区域定位', {'city': '测试城', 'mode': 'deep'}, prior)
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

    def test_line_floor_failure_carries_four_numeric_measurements_for_decoded_text(self):
        p = self._provider(RecordingRouter({}))
        text = r'第一条\n第二条'
        with self.assertRaises(fp.FullProviderError) as caught:
            p._validate_part_text(text, 2)
        self.assertEqual(caught.exception.safe_metrics, {
            'line_count': 1, 'min_lines': 2, 'text_chars': len(text),
            'literal_newline_count': 1,
        })
        self.assertTrue(all(isinstance(value, int) for value in caught.exception.safe_metrics.values()))
        with self.assertRaises(fp.FullProviderError) as actual_newline:
            p._validate_part_text('第一条\n第二条\n\n---', 3)
        self.assertEqual(actual_newline.exception.safe_metrics['line_count'], 2)
        self.assertEqual(actual_newline.exception.safe_metrics['literal_newline_count'], 0)

    def test_provider_error_optional_metrics_only_store_given_dictionary(self):
        self.assertEqual(fp.FullProviderError('failure', 'quality').safe_metrics, {})
        self.assertEqual(fp.FullProviderError('failure', 'quality', safe_metrics='untrusted text').safe_metrics, {})
        supplied = {'line_count': 4}
        error = fp.FullProviderError('failure', 'quality', safe_metrics=supplied)
        supplied['line_count'] = 8
        self.assertEqual(error.safe_metrics, {'line_count': 4})

    def test_length_completion_uses_fixed_token_limit_message(self):
        p = self._provider(RecordingRouter({}))
        with self.assertRaises(fp.FullProviderError) as caught:
            p._extract_text({'choices': [{'finish_reason': 'length',
                'message': {'content': 'private partial model body'}}]})
        self.assertEqual(caught.exception.failure_code, 'quality')
        self.assertEqual(str(caught.exception), 'upstream chat output token limit reached')
        self.assertNotIn('private partial', str(caught.exception))

    def test_unknown_completion_reason_never_appears_in_failure_message(self):
        p = self._provider(RecordingRouter({}))
        for reason in ('secret123', 'length secret123', {'secret123': 'hidden'}, ['secret123'], 'LENGTH'):
            with self.subTest(reason=reason), self.assertRaises(fp.FullProviderError) as caught:
                p._extract_text({'choices': [{'finish_reason': reason,
                    'message': {'content': 'private partial model body'}}]})
            self.assertEqual(str(caught.exception), 'upstream chat output incomplete')
            self.assertEqual(caught.exception.failure_code, 'quality')
            self.assertNotIn('secret123', str(caught.exception))
        for reason in (None, 'stop'):
            self.assertEqual(p._extract_text({'choices': [{'finish_reason': reason,
                'message': {'content': 'complete output'}}]}), 'complete output')

    def test_all_chat_parts_use_doubled_output_budget_and_respect_global_cap(self):
        for stage, floor, configured, expected in (
                ('economy', 38, 3500, 16000), ('economy', 60, 3500, 16000),
                ('economy', 59, 3500, 16000), ('policy', 67, 3500, 16000),
                ('chain', 84, 3500, 16000), ('action', 75, 3500, 16000),
                ('summary', 80, 3500, 16000), ('scoring', 50, 3500, 16000),
                ('compact', 200, 3500, 16000), ('economy', 38, 100_000, 16000)):
            with self.subTest(stage=stage, floor=floor, configured=configured):
                router = RecordingRouter({'chat/completions': (200, json.dumps({
                    'choices': [{'message': {'content': '{"text":"OFFLINE fixture"}'}}]}))})
                p = self._provider(router)
                p._live.max_output_tokens = configured
                p._chat_part(stage, fc.get_stage(stage)['parts'][0], '测试城', '', [], min_lines=floor)
                request = json.loads(router.calls[0].data)
                self.assertEqual(request['max_tokens'], expected)
                self.assertEqual(request['response_format'], {'type': 'json_object'})
                self.assertLessEqual(expected, providers.MAX_OUTPUT_TOKENS)

    def test_intermediate_and_deep_floors_preserve_original_stage_totals(self):
        p = self._provider(RecordingRouter({}))
        prior = {'economy': {'text': '\n'.join(f'已保存{i}' for i in range(20))}}
        self.assertEqual(p._part_floor('economy', '增长态势', prior, 'deep'), 54)
        self.assertEqual(p._part_floor('economy', '经济总量', {}, 'deep'), 38)
        self.assertEqual(p._part_floor('enterprises_1', '候选池', {}, 'deep'), 16)

    def test_cross_part_repetition_is_rejected_without_silently_deduplicating(self):
        p = self._provider(RecordingRouter({}))
        previous = '\n'.join(f'已保存事实{i}' for i in range(100))
        repeated = '\n'.join([f'已保存事实{i}' for i in range(50)] + [f'新增分析{i}' for i in range(20)])
        # No individual line repeats inside the new part, but the assembled
        # stage would exceed the unchanged 20% repeated-line threshold.
        p._validate_part_text(repeated, 38)
        with self.assertRaises(fp.FullProviderError) as caught:
            p._validate_part_text(repeated, 38, previous)
        self.assertEqual(str(caught.exception), 'part contains repeated filler')
        self.assertEqual(repeated.count('已保存事实'), 50)
        p._validate_part_text('\n'.join(f'不同新增分析{i}' for i in range(40)), 38, previous)

    def test_full_json_system_prompt_preserves_security_and_date_rules(self):
        when = datetime.datetime(2026, 10, 8, tzinfo=datetime.timezone.utc)
        original = providers._system_prompt(when)
        prompt = fp._full_system_prompt(when)
        self.assertIn('当前日期：2026-10-08', prompt)
        self.assertIn('只输出一个合法JSON对象', prompt)
        self.assertNotIn('你只输出本阶段的文本结论。', prompt)
        self.assertIn('禁止复制前序正文', prompt)
        self.assertEqual(prompt[prompt.index('外部检索内容'):], original[original.index('外部检索内容'):])

    def test_basic_stage_dependencies_keep_relevant_sections_complete(self):
        dependencies = {
            'economy': set(), 'population': {'economy'},
            'transport': {'economy', 'population'}, 'life': {'population', 'transport'},
            'industry': {'economy', 'transport', 'policy'},
            'competition': {'economy', 'transport', 'industry'},
            'policy': {'industry', 'economy'}, 'chain': {'industry', 'transport', 'policy'},
        }
        p = self._provider(RecordingRouter({}))
        prior = {sid: {'text': f'{sid}-FULL-HEAD\n{sid}-FULL-TAIL'} for sid in dependencies}
        for stage, relevant in dependencies.items():
            with self.subTest(stage=stage):
                rendered = p._render_prior(prior, stage)
                for sid in dependencies:
                    self.assertEqual(f'{sid}-FULL-TAIL' in rendered, sid in relevant or sid == stage)
        huge = {'summary': {'text': 'irrelevant' * 30_000},
                'economy': {'text': '经济完整保留TAIL'}}
        self.assertEqual(p._render_prior(huge, 'population'), '【economy】\n经济完整保留TAIL')
        with self.assertRaises(fp.FullProviderError):
            p._render_prior({'economy': {'text': 'x' * 120_001}}, 'population')


class DecisionContextBoundTests(unittest.TestCase):
    _provider = LiveProviderRuntimeTests._provider

    def test_complete_decision_context_has_explicit_bound_without_clipping(self):
        provider = self._provider(RecordingRouter({}))
        complete = '完整事实' * 32_500 + 'TAIL-FACT-MUST-REMAIN'
        for stage in ('action', 'summary', 'compact'):
            with self.subTest(stage=stage):
                rendered = provider._render_prior({'chain': {'text': complete}}, stage)
                self.assertIn(complete, rendered)
                with self.assertRaises(fp.FullProviderError) as caught:
                    provider._render_prior({'chain': {'text': '实' * 180_001}}, stage)
                self.assertIn('exceeds 180000 characters', str(caught.exception))
        with self.assertRaises(fp.FullProviderError) as caught:
            provider._render_prior({'policy': {'text': complete}}, 'scoring')
        self.assertIn('exceeds 120000 characters', str(caught.exception))


class EnterprisePartGateTests(unittest.TestCase):
    _provider = LiveProviderRuntimeTests._provider
    refs = [f'https://cninfo.com.cn/offline-company/{i}' for i in range(8)]

    def _company(self, number):
        return {'name': f'OFFLINE测试企业{number}', 'url': self.refs[number % 8],
                'landing_status': '待核实', 'segment': '离线协议测试环节',
                'expansion_evidence': '待核实', 'uncertainty': 'OFFLINE FIXTURE'}

    def _prior(self, saved=()):
        direction_refs = [f'https://stats.gov.cn/offline-direction/{i}' for i in range(3)]
        prior = {'industry': {'text': 'OFFLINE方向依据，不是实际研究', 'metadata': {
            'directions': [{'id': f'dir{i + 1}', 'name': f'OFFLINE产业{i + 1}',
                            'evidence_ref': ref} for i, ref in enumerate(direction_refs)],
            'evidence': [{'url': ref, 'excerpt': 'OFFLINE方向证据'} for ref in direction_refs]}}}
        if saved:
            prior['enterprises_1'] = {
                'text': '\n'.join(f'前序已保存企业分析{i}' for i in range(250)),
                'metadata': {'candidates': list(saved), 'evidence': [
                    {'url': ref, 'excerpt': 'OFFLINE已保存企业来源'} for ref in self.refs]}}
        return prior

    def _run(self, part, fields, saved=(), mode='deep'):
        text = '\n'.join(f'本批独立企业分析{i}' for i in range(100))
        payload = {'text': text, **fields}
        router = RecordingRouter({
            'exa.ai/search': (200, json.dumps({'results': [
                {'url': ref, 'text': 'OFFLINE企业资料 ' + ' '.join(f'OFFLINE测试企业{i}' for i in range(30))}
                for ref in self.refs]})),
            'chat/completions': (200, json.dumps({'choices': [{'message': {'content': json.dumps(payload)}}]})),
        })
        out = self._provider(router).run_part('enterprises_1', part,
            {'city': '测试城', 'mode': mode}, self._prior(saved))
        return out, router

    def _completion_fixture(self, initial, supplemental, saved=(), *,
                            first_text=None, extra_text=None, search_failure=False,
                            chat_failure=False):
        first_text = first_text if first_text is not None else '\n'.join(
            f'首次完整候选正文要点{i}' for i in range(16))
        extra_text = extra_text if extra_text is not None else '\n'.join(
            f'补齐新增企业正文要点{i}' for i in range(16))
        extra_refs = [f'https://cninfo.com.cn/offline-extra/{i}' for i in range(8)]
        search_calls, chat_calls = [], []

        def search(request):
            search_calls.append(request)
            if len(search_calls) == 3 and search_failure:
                raise providers.ProviderError('upstream search HTTP 503')
            refs = self.refs if len(search_calls) <= 2 else extra_refs
            return json.dumps({'results': [
                {'url': ref, 'text': ('首次身份来源' if len(search_calls) <= 2 else '补齐身份来源')
                 + ' '.join(f'OFFLINE测试企业{i}' for i in range(30))}
                for ref in refs]})

        def chat(request):
            chat_calls.append(request)
            if len(chat_calls) == 2 and chat_failure:
                raise providers.ProviderError('upstream chat HTTP 503')
            if len(chat_calls) > 2:
                raise AssertionError('candidate completion must not call chat a third time')
            data = {'text': first_text if len(chat_calls) == 1 else extra_text,
                    'candidates': initial if len(chat_calls) == 1 else supplemental,
                    'selected': []}
            return json.dumps({'choices': [{'finish_reason': 'stop',
                                           'message': {'content': json.dumps(data)}}]})

        router = RecordingRouter({'exa.ai/search': (200, search),
                                  'chat/completions': (200, chat)})
        return self._provider(router), router, self._prior(saved), first_text, extra_text

    @staticmethod
    def _completion_calls(router):
        return ([call for call in router.calls if 'exa.ai/search' in call.full_url],
                [call for call in router.calls if 'chat/completions' in call.full_url])

    def test_one_candidate_completion_keeps_first_grounded_fields_text_sources_and_prior(self):
        saved = [self._company(i) for i in range(10)]
        initial = [self._company(i) for i in (0, 1, 10, 11, 12)]
        initial[2].update(reason='首次完整理由', rationale={'raw': ['首次完整匹配字段']},
                          uncertainty='首次风险保留', expansion_date='2026-09-01',
                          landing_status='已落地', evidence_ref='https://cninfo.com.cn/offline-extra/0')
        extra = [dict(self._company(i), url=f'https://cninfo.com.cn/offline-extra/{i - 13}')
                 for i in (13, 14)]
        p, router, prior, first_text, extra_text = self._completion_fixture(initial, extra, saved)
        original = copy.deepcopy(prior)
        out = p.run_part('enterprises_1', '候选池3', {'city': '测试城', 'mode': 'deep'}, prior)
        self.assertEqual(prior, original)
        self.assertEqual(out['text'], first_text + '\n\n' + extra_text)
        self.assertEqual([item['name'] for item in out['metadata']['candidates']],
                         [self._company(i)['name'] for i in range(10, 15)])
        first = out['metadata']['candidates'][0]
        for field in ('name', 'url', 'reason', 'rationale', 'uncertainty', 'expansion_date'):
            self.assertEqual(first[field], initial[2][field])
        # A source first retrieved during completion cannot upgrade round one's
        # grounded status or overwrite its original source decision.
        self.assertEqual(first['landing_status'], '待核实')
        self.assertEqual(first['evidence_ref'], '')
        self.assertEqual(out['metadata']['selected'], [])
        refs = {item['url'] for item in out['metadata']['evidence']}
        self.assertEqual(refs, set(self.refs) | {
            f'https://cninfo.com.cn/offline-extra/{i}' for i in range(8)})
        searches, chats = self._completion_calls(router)
        self.assertEqual((len(searches), len(chats)), (3, 2))
        query = json.loads(searches[-1].data)['query']
        prompt = json.loads(chats[-1].data)['messages'][-1]['content']
        for company in saved + initial[2:]:
            self.assertIn(company['name'], query)
            self.assertIn(company['name'], prompt)
        self.assertIn('恰好2家新增企业记录', prompt)
        self.assertIn('至少7行实质内容', prompt)
        self.assertIn('不重写、不回传首次合格企业的任何字段', prompt)
        self.assertIn(first_text, prompt)
        self.assertIn('OFFLINE产业1', query)
        self.assertIn('生产装备与制造设备', query)

    def test_candidate_completion_handles_one_to_four_unique_new_identities(self):
        saved = [self._company(i) for i in range(5)]
        for count in (1, 2, 3, 4):
            with self.subTest(new_count=count):
                accepted = [self._company(i) for i in range(10, 10 + count)]
                initial = accepted + [self._company(0)] * (5 - count)
                extra = [self._company(i) for i in range(10 + count, 15)]
                p, router, prior, _, _ = self._completion_fixture(initial, extra, saved)
                out = p.run_part('enterprises_1', '候选池2', {'city': '测试城', 'mode': 'deep'}, prior)
                self.assertEqual([item['name'] for item in out['metadata']['candidates']],
                                 [self._company(i)['name'] for i in range(10, 15)])
                self.assertEqual(tuple(map(len, self._completion_calls(router))), (3, 2))
        # Repetition within this unsaved batch is the same bounded identity gap.
        initial = [self._company(i) for i in (10, 10, 11, 11, 12)]
        p, router, prior, _, _ = self._completion_fixture(
            initial, [self._company(i) for i in (13, 14)], saved)
        out = p.run_part('enterprises_1', '候选池2', {'city': '测试城', 'mode': 'deep'}, prior)
        self.assertEqual(len({item['name'] for item in out['metadata']['candidates']}), 5)
        self.assertEqual(tuple(map(len, self._completion_calls(router))), (3, 2))

    def test_candidate_completion_is_not_used_for_wrong_count_zero_new_or_unbound_source(self):
        saved = [self._company(i) for i in range(5)]
        invalid_source = [self._company(i) for i in (0, 1, 10, 11, 12)]
        invalid_source[-1]['url'] = 'https://unretrieved-company.cn/'
        cases = [([self._company(i) for i in range(count)], 'candidate part needs five new grounded companies')
                 for count in (0, 4, 6)]
        cases.append(([self._company(i) for i in range(5)], 'candidate part needs five new grounded companies'))
        cases.append((invalid_source, 'company identity needs a retrieved source URL'))
        for initial, message in cases:
            with self.subTest(count=len(initial), message=message):
                p, router, prior, _, _ = self._completion_fixture(initial, [], saved)
                with self.assertRaises(fp.FullProviderError) as caught:
                    p.run_part('enterprises_1', '候选池2', {'city': '测试城', 'mode': 'deep'}, prior)
                self.assertEqual(str(caught.exception), message)
                self.assertEqual(tuple(map(len, self._completion_calls(router))), (2, 1))
        p, router, prior, _, _ = self._completion_fixture(
            [self._company(i) for i in range(10, 15)], [], saved)
        self.assertEqual(len(p.run_part('enterprises_1', '候选池2', {'city': '测试城', 'mode': 'deep'}, prior)
                             ['metadata']['candidates']), 5)
        self.assertEqual(tuple(map(len, self._completion_calls(router))), (2, 1))

    def test_candidate_completion_rejects_insufficient_excess_duplicate_and_unbound_supplements(self):
        saved = [self._company(i) for i in range(5)]
        initial = [self._company(i) for i in (0, 1, 10, 11, 12)]
        supplements = ([self._company(13)], [self._company(i) for i in (13, 14, 15)],
                       [self._company(i) for i in (13, 13)], [self._company(i) for i in (0, 14)],
                       [dict(self._company(10), reason='attempted overwrite'), self._company(14)],
                       [dict(self._company(13), url='https://unretrieved-company.cn/'), self._company(14)])
        for extra in supplements:
            with self.subTest(names=[item['name'] for item in extra]):
                p, router, prior, _, _ = self._completion_fixture(initial, extra, saved)
                original = copy.deepcopy(prior)
                with self.assertRaises(fp.FullProviderError):
                    p.run_part('enterprises_1', '候选池2', {'city': '测试城', 'mode': 'deep'}, prior)
                self.assertEqual(prior, original)
                self.assertEqual(tuple(map(len, self._completion_calls(router))), (3, 2))

    def test_candidate_completion_transport_failures_do_not_retry_internally(self):
        saved = [self._company(i) for i in range(5)]
        initial = [self._company(i) for i in (0, 1, 10, 11, 12)]
        for search_failure, chat_failure, counts in ((True, False, (3, 1)), (False, True, (3, 2))):
            with self.subTest(search_failure=search_failure):
                p, router, prior, _, _ = self._completion_fixture(
                    initial, [self._company(i) for i in (13, 14)], saved,
                    search_failure=search_failure, chat_failure=chat_failure)
                with self.assertRaises(fp.FullProviderError) as caught:
                    p.run_part('enterprises_1', '候选池2', {'city': '测试城', 'mode': 'deep'}, prior)
                self.assertEqual(caught.exception.failure_code, 'upstream')
                self.assertEqual(tuple(map(len, self._completion_calls(router))), counts)

    def test_candidate_completion_preserves_final_text_line_repetition_and_url_gates(self):
        saved = [self._company(i) for i in range(5)]
        initial = [self._company(i) for i in (0, 1, 10, 11, 12)]
        extra = [self._company(i) for i in (13, 14)]
        cases = [('首次一行正文', '补齐一行正文', 'part line floor not met'),
                 ('\n'.join('首次重复正文' for _ in range(16)), '独立补齐正文', 'part contains repeated filler'),
                 ('\n'.join(f'首次安全正文{i}' for i in range(16)),
                  '不安全补齐来源 http://127.0.0.1/private', 'part source URL policy failed')]
        for first_text, extra_text, message in cases:
            with self.subTest(message=message):
                p, router, prior, _, _ = self._completion_fixture(
                    initial, extra, saved, first_text=first_text, extra_text=extra_text)
                with self.assertRaises(fp.FullProviderError) as caught:
                    p.run_part('enterprises_1', '候选池2', {'city': '测试城', 'mode': 'deep'}, prior)
                self.assertEqual(str(caught.exception), message)
                self.assertEqual(tuple(map(len, self._completion_calls(router))), (3, 2))
        # The final floor applies to the complete merged body, without throwing
        # away a short but substantive first response.
        p, _, prior, first_text, extra_text = self._completion_fixture(
            initial, extra, saved, first_text='\n'.join(f'首次要点{i}' for i in range(9)),
            extra_text='\n'.join(f'补齐要点{i}' for i in range(7)))
        out = p.run_part('enterprises_1', '候选池2', {'city': '测试城', 'mode': 'deep'}, prior)
        self.assertEqual(out['text'], first_text + '\n\n' + extra_text)

    def test_candidate_batches_require_five_new_grounded_identities_before_saving(self):
        for count in (0, 4, 6):
            with self.subTest(count=count), self.assertRaises(fp.FullProviderError) as caught:
                self._run('候选池', {'candidates': [self._company(i) for i in range(count)]})
            self.assertEqual(str(caught.exception), 'candidate part needs five new grounded companies')
        out, _ = self._run('候选池', {'candidates': [self._company(i) for i in range(5)],
            'selected': [{'name': 'premature selection', 'url': 'https://example.com/fake'}]})
        self.assertEqual(len(out['metadata']['candidates']), 5)
        self.assertEqual(out['metadata']['selected'], [])

    def test_repeated_candidate_names_and_guessed_homepage_are_rejected(self):
        saved = [self._company(i) for i in range(5)]
        with self.assertRaises(fp.FullProviderError):
            self._run('候选池2', {'candidates': [self._company(i) for i in range(4, 10)]}, saved)
        guessed = [self._company(i) for i in range(5)]
        guessed[0]['url'] = 'https://unretrieved-company.cn/'
        with self.assertRaises(fp.FullProviderError) as caught:
            self._run('候选池', {'candidates': guessed})
        self.assertEqual(str(caught.exception), 'company identity needs a retrieved source URL')

    def test_candidate_queries_cover_five_different_chain_segments_and_company_types(self):
        router = RecordingRouter({'exa.ai/search': (200, json.dumps({'results': [
            {'url': ref, 'text': 'OFFLINE enterprise excerpt'} for ref in self.refs]}))})
        p = self._provider(router)
        for part in ('候选池', '候选池2', '候选池3', '候选池4', '候选池5'):
            p._gather_evidence('enterprises_1', part, '测试城', self._prior())
        queries = [json.loads(call.data)['query'] for call in router.calls]
        self.assertEqual(len(set(queries)), 10)
        for number, (segment, kind) in enumerate(fp._CANDIDATE_BATCH_TOPICS):
            self.assertIn(segment, queries[number * 2])
            self.assertIn(kind, queries[number * 2])
            self.assertIn('OFFLINE产业1', queries[number * 2])

    def test_candidate_retrieval_preserves_same_url_observations_and_query_variants(self):
        common = 'https://cninfo.com.cn/offline/same-source'
        variant = 'https://cninfo.com.cn/offline/query-source'
        queries = []

        def search(request):
            queries.append(json.loads(request.data)['query'])
            number = len(queries)
            return json.dumps({'results': [
                {'url': common, 'title': f'第{number}次原检索标题',
                 'text': f'第{number}次不同企业原摘录', 'publishedDate': f'202{number + 4}-09-01'},
                {'url': variant + f'?document={number}', 'title': f'实际URL变体{number}',
                 'text': f'实际文档{number}完整原摘录', 'publishedDate': f'202{number + 4}-09-02'},
            ]})

        router = RecordingRouter({'exa.ai/search': (200, search),
                                  'chat/completions': (200, json.dumps({'content': '{"text":"OFFLINE"}'}))})
        p = self._provider(router)
        evidence = p._gather_evidence('enterprises_1', '候选池', '测试城', self._prior())
        self.assertEqual(len(queries), 2)
        self.assertEqual([item['url'] for item in evidence],
                         [common, variant + '?document=1', variant + '?document=2'])
        self.assertEqual(len({fc.canonical_url(item['url']) for item in evidence}), 2)
        combined = evidence[0]
        original_excerpts = [combined['excerpt'][item['excerpt_offset']:
                            item['excerpt_offset'] + item['excerpt_length']]
                            for item in combined['observations']]
        self.assertEqual(original_excerpts, ['第1次不同企业原摘录', '第2次不同企业原摘录'])
        self.assertEqual([item['metadata']['title'] for item in combined['observations']],
                         ['第1次原检索标题', '第2次原检索标题'])
        self.assertEqual(p._usable_evidence(evidence + evidence), evidence)
        # Query variants are preserved facts, never two independent sources.
        self.assertEqual(p._ground_checks('fact_check', [{
            'claim': '同canonical不可双源', 'source': variant + '?document=1',
            'cross_source': variant + '?document=2', 'category': 'economic',
        }], evidence), [])
        p._chat_part('enterprises_1', '候选池', '测试城', '', evidence, min_lines=16)
        chat = json.loads(router.calls[-1].data)
        prompt = chat['messages'][-1]['content']
        for excerpt in original_excerpts + ['实际文档1完整原摘录', '实际文档2完整原摘录']:
            self.assertIn(excerpt, prompt)
        self.assertIn('第2次原检索标题', prompt)
        self.assertIn('2026-09-01', prompt)
        self.assertIn('不构成多个独立来源', prompt)

    def test_missing_saved_target_batch_fails_before_search_or_chat(self):
        router = RecordingRouter({})
        p = self._provider(router)
        with self.assertRaises(fp.FullProviderError):
            p.run_part('enterprises_1', '扩产信号5', {'city': '测试城', 'mode': 'deep'},
                       self._prior([self._company(i) for i in range(20)]))
        self.assertEqual(router.calls, [])

    def test_candidate_search_and_prompt_exclude_complete_saved_name_list(self):
        saved = [self._company(i) for i in range(10)]
        chosen = [self._company(i) for i in range(10, 15)]
        out, router = self._run('候选池3', {'candidates': chosen, 'selected': []}, saved)
        self.assertEqual([item['name'] for item in out['metadata']['candidates']],
                         [item['name'] for item in chosen])
        queries = [json.loads(call.data)['query'] for call in router.calls if 'exa.ai/search' in call.full_url]
        self.assertEqual(len(queries), 2)
        for item in saved:
            self.assertIn(item['name'], queries[1])
        self.assertIn('寻找其他真实企业及公司公告', queries[1])
        chat = json.loads(next(call for call in router.calls if 'chat/completions' in call.full_url).data)
        prompt = chat['messages'][-1]['content']
        self.assertIn('已有候选禁止重复名单：' + json.dumps([item['name'] for item in saved], ensure_ascii=False), prompt)
        self.assertIn('不得改用简称或别名算作新增', prompt)
        self.assertIn('不足如实说明，不能补造身份', prompt)
        self.assertEqual(chat['max_tokens'], 16000)
        with self.assertRaises(fp.FullProviderError) as caught:
            self._run('候选池3', {'candidates': [self._company(i) for i in (0, 1, 10, 11, 12)]}, saved)
        self.assertEqual(str(caught.exception), 'candidate part needs five new grounded companies')

    def test_expansion_batches_require_all_five_existing_targets_and_retrieved_urls(self):
        saved = [self._company(i) for i in range(25)]
        with self.assertRaises(fp.FullProviderError):
            self._run('扩产信号2', {'selected': [self._company(i) for i in range(5, 9)]}, saved)
        with self.assertRaises(fp.FullProviderError):
            self._run('扩产信号2', {'selected': [self._company(i) for i in range(4, 9)]}, saved)
        with self.assertRaises(fp.FullProviderError):
            self._run('扩产信号2', {'selected': [self._company(i) for i in (5, 6, 7, 8, 29)]}, saved)
        out, router = self._run('扩产信号2', {'selected': [self._company(i) for i in range(5, 10)]}, saved)
        self.assertEqual([item['name'] for item in out['metadata']['selected']],
                         [f'OFFLINE测试企业{i}' for i in range(5, 10)])
        prompt = json.loads(next(call for call in router.calls if 'chat/completions' in call.full_url).data)['messages'][-1]['content']
        self.assertIn('第6至10家', prompt)
        self.assertIn('禁止复制或重述整份前序正文', prompt)
        self.assertIn('不是猜测的企业官网地址', prompt)

    def test_landing_and_risk_cannot_introduce_unknown_companies(self):
        saved = [self._company(i) for i in range(25)]
        for part in ('落地情况', '匹配理由与风险'):
            with self.subTest(part=part), self.assertRaises(fp.FullProviderError):
                self._run(part, {'candidates': [self._company(29)]}, saved)

    def test_expansion_emits_one_complete_five_company_array_with_full_budget(self):
        saved = [self._company(i) for i in range(25)]
        chosen = [dict(self._company(i), rationale=f'完整核查理由{i}',
                       expansion_date='2026-09-01', evidence_ref=self.refs[i % 8])
                  for i in range(10, 15)]
        out, router = self._run('扩产信号3', {'candidates': [], 'selected': chosen}, saved)
        self.assertEqual(out['metadata']['candidates'], [])
        self.assertEqual([item['name'] for item in out['metadata']['selected']],
                         [item['name'] for item in chosen])
        for actual, expected in zip(out['metadata']['selected'], chosen):
            for key in ('name', 'url', 'evidence_ref', 'rationale', 'expansion_date', 'uncertainty'):
                self.assertEqual(actual[key], expected[key])
        chat = json.loads(next(call for call in router.calls if 'chat/completions' in call.full_url).data)
        self.assertEqual(chat['max_tokens'], 16000)
        prompt = chat['messages'][-1]['content']
        self.assertIn('本次candidates必须为空数组', prompt)
        self.assertIn('不逐字段复述selected记录', prompt)
        self.assertIn('本批唯一目标名单（必须保留精确名称）：' +
                      json.dumps([item['name'] for item in chosen], ensure_ascii=False), prompt)

    def test_landing_and_final_analysis_do_not_repeat_saved_selections(self):
        saved = [self._company(i) for i in range(25)]
        for part, fields, instruction in (
                ('落地情况3', {'candidates': [self._company(i) for i in range(10, 15)], 'selected': []},
                 '本次selected必须为空数组'),
                ('匹配理由与风险', {'candidates': [], 'selected': []},
                 '本次candidates和selected都为空数组')):
            with self.subTest(part=part):
                out, router = self._run(part, fields, saved)
                self.assertEqual(out['metadata']['selected'], [])
                chat = json.loads(next(call for call in router.calls if 'chat/completions' in call.full_url).data)
                self.assertEqual(chat['max_tokens'], 16000)
                self.assertIn(instruction, chat['messages'][-1]['content'])


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
                evidence.append({'url': url, 'excerpt': f'OFFLINE saved disclosure {number}-{index}；'
                                 f'方向{number}精选企业{index}于2026年披露的具体扩产信号；已保存扩产信号{number}-{index}。',
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

    def test_signal_retrieval_query_variants_do_not_consume_independent_source_quota(self):
        query_count = []

        def search(request):
            query_count.append(request)
            root = f'https://cninfo.com.cn/offline-check/{len(query_count)}'
            return json.dumps({'results': [
                {'url': root + '/source?document=1', 'text': '第一个实际查询文档'},
                {'url': root + '/source?document=2', 'text': '第二个实际查询文档，同canonical'},
                {'url': root + '/independent', 'text': '第二条独立canonical来源'},
                {'url': root + '/after-quota', 'text': '原有两来源额度后的额外结果'},
            ]})

        router = RecordingRouter({'exa.ai/search': (200, search)})
        evidence = self._provider(router)._gather_evidence(
            'fact_check', '五星企业信号', '测试城', self._prior())
        self.assertEqual(len(query_count), 18)
        self.assertEqual(len(evidence), 54)
        self.assertEqual(len({fc.canonical_url(item['url']) for item in evidence}), 36)
        self.assertFalse(any('/after-quota' in item['url'] for item in evidence))

    def test_saved_selection_grounding_remains_available_only_for_fact_check(self):
        saved = self._prior()
        source = saved['enterprises_1']['metadata']['evidence'][0]['url']
        cross = 'https://stats.gov.cn/offline-new/cross'
        text = '\n'.join(f'核验分析{i}' for i in range(80))
        payload = {'text': text, 'checks': [
            {'claim': '方向1精选企业0扩产信号', 'source': source, 'cross_source': cross,
             'category': 'high_star', 'direction': 'dir1', 'verdict': '待核实',
             'company_name': '方向1精选企业0',
             'source_quote': '方向1精选企业0于2026年披露的具体扩产信号',
             'cross_source_quote': '方向1精选企业0扩产信号已于2026年披露。'},
            {'claim': '同一网页不能交叉核验', 'source': source, 'cross_source': source,
             'category': 'high_star', 'direction': 'dir1'},
        ]}
        corrected = {'text': '\n'.join(f'核验纠偏后：dir2/dir3缺少企业独立原句，待核实事项{i}' for i in range(80)),
                     'checks': payload['checks'][:1], 'high_star_unavailable': True,
                     'high_star_note': 'dir2/dir3缺少企业独立原句，不能交叉核验。'}
        chat_payloads = iter((payload, corrected, payload))
        router = RecordingRouter({
            'exa.ai/search': (200, json.dumps({'results': [{'url': cross, 'text':
                'OFFLINE cross excerpt；方向1精选企业0扩产信号已于2026年披露。'}]})),
            'chat/completions': (200, lambda request: json.dumps(
                {'choices': [{'message': {'content': json.dumps(next(chat_payloads))}}]})),
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

    def test_signal_check_prompt_bounds_schema_and_keeps_three_complete_two_source_records(self):
        prior = self._prior()
        prior['fact_check'] = {'text': '\n'.join(f'已完成前两批核验要点{i}' for i in range(40)),
                               'metadata': {'checks': [], 'evidence': []}}
        cross = 'https://stats.gov.cn/offline-signal/cross?year=2026&release=annual'
        checks = [{
            'claim': f'方向{number}精选企业0于2026年披露的具体扩产信号',
            'source': prior[f'enterprises_{number}']['metadata']['evidence'][0]['url'],
            'cross_source': cross, 'year': '2026', 'verdict': '两源口径不同，待核实',
            'category': 'high_star', 'direction': f'dir{number}',
            'company_name': f'方向{number}精选企业0',
            'source_quote': f'方向{number}精选企业0于2026年披露的具体扩产信号',
            'cross_source_quote': f'方向{number}精选企业0于2026年披露的具体扩产信号',
        } for number in (1, 2, 3)]
        payload = {'text': '\n'.join(f'本批信号核验简短要点{i}' for i in range(20)),
                   'checks': checks}
        router = RecordingRouter({
            'exa.ai/search': (200, json.dumps({'results': [{'url': cross, 'text':
                'OFFLINE完整交叉核验摘录\n' + '\n'.join(check['cross_source_quote'] for check in checks)}]})),
            'chat/completions': (200, json.dumps({'choices': [{'finish_reason': 'stop',
                'message': {'content': json.dumps(payload)}}]})),
        })
        out = self._provider(router).run_part('fact_check', '五星企业信号', {'city': '测试城'}, prior)
        self.assertEqual(out['metadata']['checks'], checks)
        self.assertEqual(out['text'], payload['text'])
        chat = json.loads(next(call for call in router.calls if 'chat/completions' in call.full_url).data)
        self.assertEqual(chat['max_tokens'], 16000)
        prompt = chat['messages'][-1]['content']
        for instruction in ('本次JSON只含text、checks', '不回传candidates、selected、directions、scores或完整公司档案',
                            'checks每条只核验一项精确主张', 'year缺失写年份未知',
                            'source和cross_source必须保留两条完整的实际检索URL',
                            '每方向优先只核验1条', '最多3条high_star记录', '不逐字段重复checks'):
            self.assertIn(instruction, prompt)

    def test_check_prompt_compression_preserves_unavailable_flags_and_other_part_budgets(self):
        for part, budget in (('五星企业信号', 16000), ('经济关键数字', 16000), ('政策金额', 16000)):
            with self.subTest(part=part):
                category, count = {'经济关键数字': ('economic', 9), '政策金额': ('policy', 3),
                                   '五星企业信号': ('high_star', 0)}[part]
                checks = FactCheckPartCommitGateTests._checks(category, count)
                payload = {'text': '\n'.join(f'缺口核验简短要点{i}' for i in range(20)), 'checks': checks,
                           'high_star_unavailable': True, 'high_star_note': 'dir1/dir2/dir3缺少2026年独立交叉来源'}
                corrected = dict(payload, text='\n'.join(f'纠偏后各方向独立来源缺口待核实事项{i}' for i in range(20)))
                chat_payloads = iter((payload, corrected))
                router = RecordingRouter({
                    'exa.ai/search': (200, json.dumps({'results': [
                        {'url': url, 'text': 'OFFLINE核查摘录；' + '；'.join(c['claim'] for c in checks)}
                        for url in FactCheckPartCommitGateTests.URLS]})),
                    'chat/completions': (200, lambda request: json.dumps(
                        {'choices': [{'message': {'content': json.dumps(next(chat_payloads))}}]})),
                })
                prior = self._prior()
                prior['fact_check'] = {'text': '\n'.join(f'已完成核验要点{i}' for i in range(40)),
                                       'metadata': {'checks': [], 'evidence': []}}
                out = self._provider(router).run_part('fact_check', part, {'city': '测试城'}, prior)
                self.assertIs(out['metadata']['high_star_unavailable'], True)
                self.assertEqual(out['metadata']['high_star_note'], payload['high_star_note'])
                chat = json.loads(next(call for call in router.calls if 'chat/completions' in call.full_url).data)
                self.assertEqual(chat['max_tokens'], budget)
                self.assertIn('本次JSON只含text、checks', chat['messages'][-1]['content'])


class FactCheckPartCommitGateTests(unittest.TestCase):
    _provider = LiveProviderRuntimeTests._provider
    URLS = ('https://stats.gov.cn/offline-check', 'https://www.gov.cn/offline-check')

    @classmethod
    def _checks(cls, category, count):
        return [{'claim': f'OFFLINE不同核验主张{index}', 'category': category,
                 'direction': None, 'source': cls.URLS[0], 'cross_source': cls.URLS[1],
                 'year': '2026', 'verdict': '两源口径不同，待核实'} for index in range(count)]

    def _run(self, part, checks):
        payload = {'text': '\n'.join(f'OFFLINE本批具体核查事项{i}' for i in range(20)), 'checks': checks}
        router = RecordingRouter({
            'exa.ai/search': (200, json.dumps({'results': [
                {'url': url, 'text': 'OFFLINE实际摘录；' + '；'.join(check['claim'] for check in checks)}
                for url in self.URLS]})),
            'chat/completions': (200, json.dumps({'choices': [{'message': {'content': json.dumps(payload)}}]})),
        })
        # A prior batch's records cannot fill the current batch's missing quota.
        prior = {'fact_check': {'text': '\n'.join(f'OFFLINE已保存经济核查事项{i}' for i in range(40)),
                                'metadata': {'checks': self._checks('economic', 12), 'evidence': []}}}
        before = copy.deepcopy(prior)
        try:
            return self._provider(router).run_part('fact_check', part, {'city': 'OFFLINE测试城'}, prior)
        finally:
            self.assertEqual(prior, before)

    def test_minimum_grounded_batches_return_all_original_checks(self):
        for part, category, minimum in (('经济关键数字', 'economic', 9), ('政策金额', 'policy', 3)):
            with self.subTest(part=part):
                checks = self._checks(category, minimum)
                result = self._run(part, checks)
                self.assertEqual(result['metadata']['checks'], checks)
                self.assertEqual(len(result['metadata']['evidence']), 2)

    def test_below_floor_empty_and_wrong_categories_fail_before_return(self):
        for part, category, minimum, wrong in (('经济关键数字', 'economic', 9, 'policy'),
                                              ('政策金额', 'policy', 3, 'economic')):
            for checks in ([], self._checks(category, minimum - 1), self._checks(wrong, 12)):
                with self.subTest(part=part, count=len(checks)):
                    with self.assertRaises(fp.FullProviderError) as failure:
                        self._run(part, checks)
                    self.assertEqual(failure.exception.failure_code, 'quality')
                    self.assertIn(f'fact_check part {category} checks', str(failure.exception))

    def test_duplicate_grounded_checks_cannot_fill_policy_or_economic_floor(self):
        for part, category, minimum in (('经济关键数字', 'economic', 9), ('政策金额', 'policy', 3)):
            with self.subTest(part=part):
                checks = self._checks(category, minimum - 1)
                checks.append(dict(checks[0], claim='  ' + checks[0]['claim'] + '  '))
                with self.assertRaises(fp.FullProviderError) as failure:
                    self._run(part, checks)
                self.assertEqual(failure.exception.failure_code, 'quality')

    def test_unbound_or_same_source_checks_do_not_count_after_grounding(self):
        for part, category, minimum in (('经济关键数字', 'economic', 9), ('政策金额', 'policy', 3)):
            for bad_url in ('https://stats.gov.cn/not-retrieved', self.URLS[0]):
                with self.subTest(part=part, bad_url=bad_url):
                    checks = self._checks(category, minimum)
                    checks[-1]['cross_source'] = bad_url
                    with self.assertRaises(fp.FullProviderError) as failure:
                        self._run(part, checks)
                    self.assertEqual(failure.exception.failure_code, 'quality')


class HighStarEntityQuoteGateTests(unittest.TestCase):
    _provider = LiveProviderRuntimeTests._provider

    @staticmethod
    def _case(name='已精选测试企业', subject=None):
        subject = name if subject is None else subject
        source = 'https://cninfo.com.cn/offline/company-disclosure?document=1'
        cross = 'https://stats.gov.cn/offline/company-project'
        source_quote = f'{subject}于2026年披露新建项目。'
        cross_quote = f'{subject}的新建项目仍需核实实际投产时间。'
        evidence = [{'url': source, 'excerpt': 'OFFLINE原披露：' + source_quote},
                    {'url': cross, 'excerpt': 'OFFLINE独立来源：' + cross_quote}]
        check = {'claim': f'{subject}于2026年披露新建项目，投产时间待核实',
                 'source': source, 'cross_source': cross, 'category': 'high_star',
                 'direction': 'dir1', 'year': '2026', 'verdict': '待核实',
                 'company_name': name, 'source_quote': source_quote,
                 'cross_source_quote': cross_quote}
        prior = {'enterprises_1': {'metadata': {'selected': [{'name': name}]}}}
        return prior, evidence, check

    def _ground(self, prior, evidence, check):
        return self._provider(RecordingRouter({}))._build_metadata(
            'fact_check', '五星企业信号', 'OFFLINE测试城', evidence,
            {'checks': [check]}, prior)['checks']

    def test_exact_selected_entity_and_two_literal_quotes_preserve_support_without_mutation(self):
        prior, evidence, check = self._case()
        original = copy.deepcopy((prior, evidence, check))
        self.assertEqual(self._ground(prior, evidence, check), [check])
        self.assertEqual((prior, evidence, check), original)
        # Literal subject/quote support does not certify the entire claim:
        # the returned verdict deliberately remains honest and unresolved.
        self.assertEqual(self._ground(prior, evidence, check)[0]['verdict'], '待核实')

    def test_missing_or_nonliteral_support_does_not_ground_high_star(self):
        prior, evidence, check = self._case()
        for field in ('company_name', 'source_quote', 'cross_source_quote'):
            with self.subTest(missing=field):
                incomplete = dict(check)
                incomplete.pop(field)
                self.assertEqual(self._ground(prior, evidence, incomplete), [])
        for field in ('source_quote', 'cross_source_quote'):
            with self.subTest(nonliteral=field):
                invented = dict(check, **{field: '已精选测试企业已投产，此句未出现在检索摘录。'})
                self.assertEqual(self._ground(prior, evidence, invented), [])

    def test_unselected_alias_and_wrong_direction_are_not_exact_target_pairs(self):
        prior, evidence, check = self._case()
        for changed in (dict(check, company_name='未精选测试企业'),
                        dict(check, company_name='已精选测试企业简称'),
                        dict(check, direction='dir2')):
            with self.subTest(company=changed['company_name'], direction=changed['direction']):
                self.assertEqual(self._ground(prior, evidence, changed), [])

    def test_actual_aisen_xinhua_cross_entity_mismatch_is_not_grounded(self):
        # Minimal verbatim snippets from the frozen real Suzhou bundle. Both
        # URLs and quotes were retrieved, but the cross source concerns Xinhua.
        name = '江苏艾森半导体材料股份有限公司'
        source = 'https://paper.cnstock.com/html/2026-01/28/content_2174852.htm'
        cross = 'https://www.news.cn/finance/20260227/8b2ca6965c1f4680b426cbdc4ecd9466/c.html'
        source_quote = name + ' 第三届董事会第二十二次会议决议公告'
        wrong_quote = '江苏鑫华半导体科技股份有限公司（简称：鑫华科技）科创板IPO获受理，公司拟募资13.2亿元。'
        evidence = [{'url': source, 'excerpt': source_quote}, {'url': cross, 'excerpt': wrong_quote}]
        check = {'claim': name + '拟在南通市经济技术开发区设立全资子公司投资建设艾森集成电路材料华东制造基地项目，预计项目总投资20亿元',
                 'source': source, 'cross_source': cross, 'category': 'high_star',
                 'direction': 'dir1', 'year': '2026', 'verdict': '待核实',
                 'company_name': name, 'source_quote': source_quote,
                 'cross_source_quote': wrong_quote}
        prior = {'enterprises_1': {'metadata': {'selected': [{'name': name}]}}}
        self.assertNotEqual(fc.canonical_url(source), fc.canonical_url(cross))
        self.assertIn(source_quote, evidence[0]['excerpt'])
        self.assertIn(wrong_quote, evidence[1]['excerpt'])
        self.assertNotIn(name, wrong_quote)
        self.assertEqual(self._ground(prior, evidence, check), [])

    def test_only_trailing_numeric_stock_labels_may_be_omitted_in_quotes(self):
        subject = '已精选测试企业'
        for suffix in ('（688720.SH）', '(000001.SZ)', '(0700.HK)', '(600000)'):
            with self.subTest(stock_label=suffix):
                prior, evidence, check = self._case(subject + suffix, subject)
                self.assertEqual(self._ground(prior, evidence, check), [check])
        prior, evidence, check = self._case(subject + '(Suzhou)', subject)
        self.assertEqual(self._ground(prior, evidence, check), [])
        # A non-stock suffix remains part of the exact entity, and is supported
        # when the claim and both original quotes actually include it.
        prior, evidence, check = self._case(subject + '(Suzhou)')
        self.assertEqual(self._ground(prior, evidence, check), [check])

    def test_query_variant_does_not_displace_actual_source_quote(self):
        prior, evidence, check = self._case()
        variant = {'url': evidence[0]['url'].replace('document=1', 'document=2'),
                   'excerpt': 'OFFLINE另一次查询只摘录其他企业，不能覆盖先前目标引句。'}
        self.assertEqual(fc.canonical_url(variant['url']), fc.canonical_url(evidence[0]['url']))
        evidence.insert(1, variant)
        original = copy.deepcopy(evidence)
        self.assertEqual(self._ground(prior, evidence, check), [check])
        self.assertEqual(evidence, original)

    def test_same_actual_url_merged_observations_preserve_original_quote(self):
        prior, evidence, check = self._case()
        evidence = fc.merge_evidence_records(evidence + [
            {'url': evidence[0]['url'], 'excerpt': 'OFFLINE同实际URL另一次摘录，未重述目标项目。',
             'published': '发布日期未知', 'retrieved_at': '2026-10-09T00:00:00Z'}])
        original = copy.deepcopy(evidence)
        self.assertEqual(self._ground(prior, evidence, check), [check])
        self.assertEqual(evidence, original)

    def test_quote_cannot_be_assembled_across_distinct_original_observations(self):
        prior, evidence, check = self._case()
        source = evidence[0]['url']
        evidence = fc.merge_evidence_records([
            {'url': source, 'excerpt': '已精选测试企业于2026年'},
            {'url': source, 'excerpt': '披露新建项目。'},
            evidence[1],
        ])
        # Whitespace normalization would join these two distinct original
        # snippets into the model's quote, which never appeared in either one.
        self.assertIn(check['source_quote'], evidence[0]['excerpt'].replace('\n', ''))
        self.assertEqual(self._ground(prior, evidence, check), [])

    def test_economic_policy_checks_keep_two_source_support_without_company_quote_fields(self):
        _, evidence, signal = self._case()
        checks = [{key: value for key, value in signal.items()
                   if key not in {'company_name', 'source_quote', 'cross_source_quote'}}
                  for _ in range(2)]
        for check, category in zip(checks, ('economic', 'policy')):
            check.update(category=category, direction=None)
        metadata = self._provider(RecordingRouter({}))._build_metadata(
            'fact_check', '经济关键数字', 'OFFLINE测试城', evidence, {'checks': checks}, {})
        self.assertEqual(metadata['checks'], checks)


class HighStarCorrectionTests(unittest.TestCase):
    _provider = LiveProviderRuntimeTests._provider

    @staticmethod
    def _case(economic_count=12, policy_count=8):
        prior, evidence, checks = {}, [], []
        for number in (1, 2, 3):
            name = f'OFFLINE精选企业{number}'
            source = f'https://cninfo.com.cn/offline-correction/disclosure/{number}'
            cross = f'https://stats.gov.cn/offline-correction/project/{number}'
            source_quote = f'{name}于2026年披露新项目。'
            cross_quote = f'{name}的新项目实际投产时间待核实。'
            sources = [{'url': source, 'excerpt': 'OFFLINE原披露：' + source_quote},
                       {'url': cross, 'excerpt': 'OFFLINE交叉摘录：' + cross_quote}]
            evidence.extend(sources)
            checks.append({'claim': source_quote + '投产时间待核实', 'source': source,
                           'cross_source': cross, 'year': '2026', 'verdict': '待核实',
                           'category': 'high_star', 'direction': f'dir{number}',
                           'company_name': name, 'source_quote': source_quote,
                           'cross_source_quote': cross_quote})
            prior[f'enterprises_{number}'] = {'text': f'OFFLINE方向{number}完整精选记录', 'metadata': {
                'selected': [{'name': name, 'url': source, 'evidence_ref': cross}], 'evidence': sources}}
        old_checks = [{'claim': f'OFFLINE已保存{category}主张{index}', 'source': evidence[0]['url'],
                       'cross_source': evidence[1]['url'], 'year': '2026', 'verdict': '待核实',
                       'category': category, 'direction': None}
                      for category, count in (('economic', economic_count), ('policy', policy_count))
                      for index in range(count)]
        prior['fact_check'] = {'text': '\n'.join(f'OFFLINE已保存独立核验要点{index}' for index in range(40)),
                               'metadata': {'checks': old_checks, 'evidence': evidence}}
        return prior, evidence, checks

    @staticmethod
    def _payload(checks, *, unavailable=False, note='dir1/dir2/dir3缺少企业独立原句，待核实',
                 label='OFFLINE初版核验要点', lines=20):
        payload = {'text': '\n'.join(f'{label}{index}' for index in range(lines)), 'checks': checks}
        if unavailable:
            payload.update(high_star_unavailable=True, high_star_note=note)
        return payload

    def _setup(self, payloads, *, economic_count=12, policy_count=8):
        prior, evidence, checks = self._case(economic_count, policy_count)
        responses = iter(payloads)
        router = RecordingRouter({
            'exa.ai/search': (200, json.dumps({'results': [
                {'url': entry['url'], 'text': entry['excerpt']} for entry in evidence]})),
            'chat/completions': (200, lambda request: json.dumps({'choices': [{'finish_reason': 'stop',
                'message': {'content': json.dumps(next(responses))}}]})),
        })
        timeouts = []
        def transport(request, timeout):
            timeouts.append((request.full_url, timeout))
            return router(request, timeout)
        return self._provider(transport), router, timeouts, prior, evidence, checks

    def _run(self, provider, prior):
        before = copy.deepcopy(prior)
        try:
            return provider.run_part('fact_check', '五星企业信号', {'city': 'OFFLINE测试城'}, prior)
        finally:
            self.assertEqual(prior, before)

    def test_rejected_entity_quotes_get_one_same_evidence_correction_and_honest_unavailable(self):
        _, _, checks = self._case()
        invalid = [dict(check, cross_source_quote='OFFLINE_OTHER_ENTITY_NOT_INCLUDED') for check in checks]
        first = self._payload(invalid, label='OFFLINE初版仍声称双源一致')
        corrected = self._payload([], unavailable=True, label='OFFLINE纠偏后缺少企业原句，待核实要点')
        p, router, timeouts, prior, _, _ = self._setup([first, corrected])
        result = self._run(p, prior)
        self.assertEqual(result['text'], corrected['text'])
        self.assertEqual(result['metadata']['checks'], [])
        self.assertIs(result['metadata']['high_star_unavailable'], True)
        self.assertEqual(result['metadata']['high_star_note'], corrected['high_star_note'])
        calls = [json.loads(call.data) for call in router.calls if 'chat/completions' in call.full_url]
        self.assertEqual(len(calls), 2)
        self.assertEqual(sum('exa.ai/search' in call.full_url for call in router.calls), 6)
        expected = {'submitted_high_star_count': 3, 'grounded_high_star_count': 0,
                    'discarded_high_star_count': 3, 'covered_direction_count': 0,
                    'missing_directions': ['dir1', 'dir2', 'dir3']}
        feedback = json.dumps(expected, ensure_ascii=False, separators=(',', ':'))
        prompt = calls[1]['messages'][-1]['content']
        self.assertIn(feedback, prompt)
        self.assertNotIn('OFFLINE_OTHER_ENTITY_NOT_INCLUDED', prompt)
        self.assertIn('未通过身份或原句绑定的记录不能在正文继续声称已经双源印证', prompt)
        self.assertIn('请重新生成完整text和本批checks', prompt)
        for call in calls:
            self.assertEqual(call['max_tokens'], 16000)
            self.assertEqual(call['response_format'], {'type': 'json_object'})
        self.assertEqual([timeout for url, timeout in timeouts if 'chat/completions' in url], [90, 90])
        # Apart from the appended feedback, both prompts contain the exact
        # same prior/excerpts, and no discarded model prose is replayed.
        self.assertTrue(prompt.startswith(calls[0]['messages'][-1]['content']))
        combined = fc.assemble('fact_check', [prior['fact_check'], result])
        self.assertEqual(fc.validate('fact_check', combined['text'], combined['metadata']), [])
        self.assertEqual(len(combined['metadata']['checks']), 20)

    def test_initial_unavailable_cannot_skip_rewriting_false_double_source_prose(self):
        _, _, checks = self._case()
        invalid = [dict(checks[0], cross_source_quote='其他企业的报道，不支持精选企业')]
        first = self._payload(invalid, unavailable=True, label='OFFLINE初版已flag但仍声称双源一致')
        corrected = self._payload([], unavailable=True, label='OFFLINE改写后全部方向待核实缺口')
        p, router, _, prior, _, _ = self._setup([first, corrected])
        result = self._run(p, prior)
        self.assertEqual(result['text'], corrected['text'])
        self.assertNotIn('双源一致', result['text'])
        self.assertEqual(len([call for call in router.calls if 'chat/completions' in call.full_url]), 2)
        unchanged = dict(first, checks=[])
        p, router, _, prior, _, _ = self._setup([first, unchanged])
        with self.assertRaises(fp.FullProviderError) as failure:
            self._run(p, prior)
        self.assertEqual(failure.exception.failure_code, 'quality')
        self.assertIn('did not rewrite current text', str(failure.exception))
        self.assertEqual(sum('chat/completions' in call.full_url for call in router.calls), 2)

    def test_full_grounded_coverage_skips_correction_but_dropped_extra_does_not(self):
        _, _, checks = self._case()
        valid = self._payload(checks)
        p, router, _, prior, _, _ = self._setup([valid])
        result = self._run(p, prior)
        self.assertEqual(result['metadata']['checks'], checks)
        self.assertNotIn('high_star_unavailable', result['metadata'])
        self.assertEqual(len([call for call in router.calls if 'chat/completions' in call.full_url]), 1)
        first = self._payload(checks + [dict(checks[0], claim=checks[0]['claim'] + '未证实金额',
                                           cross_source_quote='其他企业的摘录')])
        corrected = self._payload(checks, label='OFFLINE纠偏后仅保留原句支持的主张')
        p, router, _, prior, _, _ = self._setup([first, corrected])
        result = self._run(p, prior)
        self.assertEqual(result['metadata']['checks'], checks)
        self.assertNotIn('high_star_unavailable', result['metadata'])
        self.assertEqual(len([call for call in router.calls if 'chat/completions' in call.full_url]), 2)
        prompt = json.loads([call for call in router.calls if 'chat/completions' in call.full_url][-1].data)
        self.assertIn('"missing_directions":[]', prompt['messages'][-1]['content'])

    def test_one_correction_can_restore_real_three_direction_coverage(self):
        _, _, checks = self._case()
        first = self._payload(checks[:1])
        corrected = self._payload(checks, label='OFFLINE纠偏后企业原句支持要点')
        p, router, _, prior, _, _ = self._setup([first, corrected])
        result = self._run(p, prior)
        self.assertEqual(result['metadata']['checks'], checks)
        self.assertNotIn('high_star_unavailable', result['metadata'])
        combined = fc.assemble('fact_check', [prior['fact_check'], result])
        self.assertEqual(fc.validate('fact_check', combined['text'], combined['metadata']), [])
        self.assertEqual(len([call for call in router.calls if 'chat/completions' in call.full_url]), 2)

    def test_second_failure_has_no_third_chat_or_new_search_and_never_infers_flag(self):
        _, _, checks = self._case()
        first = self._payload(checks[:1])
        for corrected in (self._payload(checks[:1], label='OFFLINE仍只有方向1'),
                          self._payload(checks[:1], unavailable=True, note='', label='OFFLINE缺少缺口说明'),
                          self._payload([dict(checks[0], cross_source_quote='其他企业')], unavailable=True,
                                        label='OFFLINE仍夹带未通过原句的记录')):
            with self.subTest(corrected=corrected['text'].splitlines()[0]):
                p, router, _, prior, _, _ = self._setup([first, corrected])
                with self.assertRaises(fp.FullProviderError) as failure:
                    self._run(p, prior)
                self.assertEqual(failure.exception.failure_code, 'quality')
                self.assertEqual(sum('chat/completions' in call.full_url for call in router.calls), 2)
                self.assertEqual(sum('exa.ai/search' in call.full_url for call in router.calls), 6)

    def test_corrected_unavailable_does_not_relax_text_or_whole_stage_policy_floor(self):
        first = self._payload([])
        too_short = self._payload([], unavailable=True, label='OFFLINE仍需核实', lines=1)
        p, router, _, prior, _, _ = self._setup([first, too_short])
        with self.assertRaises(fp.FullProviderError) as failure:
            self._run(p, prior)
        self.assertEqual(failure.exception.failure_code, 'quality')
        self.assertEqual(sum('chat/completions' in call.full_url for call in router.calls), 2)
        corrected = self._payload([], unavailable=True, label='OFFLINE企业全部缺乏双源，待核实')
        p, _, _, prior, _, _ = self._setup([first, corrected], policy_count=0)
        result = self._run(p, prior)
        combined = fc.assemble('fact_check', [prior['fact_check'], result])
        errors = fc.validate('fact_check', combined['text'], combined['metadata'])
        self.assertTrue(any('policy checks 0 < 3' in error for error in errors), errors)


class ScoringIdentityGateTests(unittest.TestCase):
    _provider = LiveProviderRuntimeTests._provider

    @staticmethod
    def _prior():
        return {f'enterprises_{number}': {
            'text': 'OFFLINE persisted company selections, not real research',
            'metadata': {'selected': [{'name': f'方向{number}精选企业{index}'} for index in range(25)]}}
            for number in (1, 2, 3)}

    @staticmethod
    def _score(number=1, index=0):
        return {'name': f'方向{number}精选企业{index}', 'direction': f'dir{number}',
                'dimensions': {key: (0 if key == 'risk' else 10) for key in fc.SCORE_DIMENSIONS},
                'weighted_score': -999, 'rank': 999}

    @staticmethod
    def _request_targets(request):
        prompt = json.loads(request.data)['messages'][-1]['content']
        prefix = '本次评分唯一身份名单（name和direction须逐项精确保留）：'
        targets = json.loads(next(line[len(prefix):] for line in prompt.splitlines() if line.startswith(prefix)))
        return prompt, targets

    def _reply_for_targets(self, request, scores, *, text_prefix='本批评分依据'):
        prompt, targets = self._request_targets(request)
        allowed = {(target['name'], target['direction']) for target in targets}
        records = [record for record in scores if (record['name'], record['direction']) in allowed]
        group = targets[0]['name']
        deep_stage = fc.get_stage('scoring', mode='deep')
        group_floor = (deep_stage['min_lines'] + len(deep_stage['parts']) * 2 - 1) // (len(deep_stage['parts']) * 2)
        payload = {'text': '\n'.join(f'{text_prefix}/{group}具体事实与风险{i}' for i in range(group_floor)), 'scores': records}
        return json.dumps({'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(payload)}}]})

    def _run(self, scores, prior=None):
        payload = {'text': '\n'.join(f'OFFLINE当前评分分析{i}' for i in range(100)), 'scores': scores}
        router = RecordingRouter({'chat/completions': (200, json.dumps({
            'choices': [{'message': {'content': json.dumps(payload)}}]}))})
        if len(scores) == 38:
            router.routes['chat/completions'] = (200, lambda request: self._reply_for_targets(request, scores))
        out = self._provider(router).run_part('scoring', '评分维度与权重',
            {'city': '测试城', 'mode': 'deep'}, self._prior() if prior is None else prior)
        return out, router

    def test_scoring_accepts_complete_saved_identities_for_the_current_part(self):
        scores = [self._score(number, index) for number in (1, 2, 3) for index in range(25)][:38]
        out, router = self._run(scores)
        self.assertEqual(len(out['metadata']['scores']), 38)
        self.assertEqual([entry['direction'] for entry in out['metadata']['scores']],
                         [entry['direction'] for entry in scores])
        self.assertEqual([entry['weighted_score'] for entry in out['metadata']['scores']], [10] * 38)
        self.assertEqual([entry['rank'] for entry in out['metadata']['scores']], list(range(1, 39)))
        prompt = json.loads(router.calls[0].data)['messages'][-1]['content']
        self.assertIn('评分身份允许名单仅来自前序enterprises_1/2/3的selected', prompt)

    def test_compact_scoring_schema_preserves_all_thirty_eight_and_thirty_seven_identities_and_dimensions(self):
        all_scores = [{key: value for key, value in self._score(number, index).items()
                       if key in {'name', 'direction', 'dimensions'}}
                      for number in (1, 2, 3) for index in range(25)]
        prior = self._prior()
        parts = []
        for part, chosen, count in (('评分维度与权重', all_scores[:38], 38), ('加权计算', all_scores[38:], 37)):
            with self.subTest(part=part):
                payload = {'text': '\n'.join(f'{part}本批简短评分依据与风险{i}' for i in range(50)),
                           'scores': chosen}
                router = RecordingRouter({'chat/completions': (200, lambda request: self._reply_for_targets(
                    request, chosen, text_prefix=part))})
                out = self._provider(router).run_part('scoring', part, {'city': '测试城', 'mode': 'deep'}, prior)
                self.assertEqual(len(out['metadata']['scores']), count)
                for actual, expected in zip(out['metadata']['scores'], chosen):
                    for field in ('name', 'direction', 'dimensions'):
                        self.assertEqual(actual[field], expected[field])
                    self.assertEqual(set(actual['dimensions']), fc.SCORE_DIMENSIONS)
                    self.assertEqual(actual['weighted_score'], 10)
                chat = json.loads(router.calls[0].data)
                self.assertEqual(chat['max_tokens'], 16000)
                self.assertEqual(len(router.calls), 2)
                target_groups = [self._request_targets(call)[1] for call in router.calls]
                self.assertEqual(sorted(map(len, target_groups)), [19, 19] if count == 38 else [18, 19])
                self.assertTrue(all('至少25行实质内容' in self._request_targets(call)[0] for call in router.calls))
                prompt = chat['messages'][-1]['content']
                for instruction in ('本次JSON只含text和scores', '完整保留当前本批全部企业的精确name和direction',
                                    '七个键及0到10的有限数值', '正文每行只写一个简短的评分依据或风险',
                                    '不逐字段复述scores', '不能通过减少企业、少报维度或把未知风险写成零'):
                    self.assertIn(instruction, prompt)
                parts.append(out)
                prior['scoring'] = fc.assemble('scoring', parts)
        final = prior['scoring']
        self.assertEqual(len(final['metadata']['scores']), 75)
        self.assertEqual(fc.validate('scoring', final['text'], final['metadata'], mode='deep'), [])

    def test_scoring_requests_overlap_and_reverse_completion_preserves_original_tie_order(self):
        scores = [self._score(number, index) for number in (1, 2, 3) for index in range(25)][:38]
        barrier = threading.Barrier(2)
        second_done = threading.Event()
        finished = []

        def model(request):
            prompt, targets = self._request_targets(request)
            barrier.wait(timeout=3)
            reply = json.loads(self._reply_for_targets(request, scores))
            body = json.loads(reply['choices'][0]['message']['content'])
            body['scores'].reverse()
            reply['choices'][0]['message']['content'] = json.dumps(body)
            if '本次内部评分批：1/2' in prompt:
                self.assertTrue(second_done.wait(timeout=3))
                finished.append(1)
            else:
                finished.append(2)
                second_done.set()
            return json.dumps(reply)

        router = RecordingRouter({'chat/completions': (200, model)})
        prior = self._prior()
        original = copy.deepcopy(prior)
        out = self._provider(router).run_part('scoring', '评分维度与权重', {'city': '测试城', 'mode': 'deep'}, prior)
        self.assertEqual(finished, [2, 1])
        self.assertEqual(prior, original)
        self.assertEqual([record['name'] for record in out['metadata']['scores']], [record['name'] for record in scores])
        self.assertEqual([record['rank'] for record in out['metadata']['scores']], list(range(1, 39)))
        self.assertEqual(len(router.calls), 2)

    def test_scoring_prompts_include_complete_target_source_excerpts_only(self):
        prior = self._prior()
        for number in (1, 2, 3):
            metadata = prior[f'enterprises_{number}']['metadata']
            metadata['evidence'] = []
            for index, company in enumerate(metadata['selected']):
                company['url'] = f'https://cninfo.com.cn/offline-score/{number}/{index}?year=2026'
                metadata['evidence'].append({'url': company['url'], 'title': company['name'],
                    'excerpt': f'EXACT-EXCERPT:{company["name"]}:完整2026年事实及原始风险',
                    'retrieval': 'exa_fulltext', 'published': '2026-09-30'})
            metadata['evidence'].append({'url': f'https://cninfo.com.cn/unrelated/{number}',
                'excerpt': 'UNRELATED-ENTERPRISE-SOURCE', 'retrieval': 'exa_fulltext'})
        prior['policy'] = {'text': 'COMPLETE-POLICY-TEXT', 'metadata': {'evidence': [
            {'url': 'https://gov.cn/offline-policy', 'excerpt': 'UNRELATED-POLICY-EXCERPT',
             'retrieval': 'exa_fulltext'}]}}
        prior['chain'] = {'text': 'COMPLETE-CHAIN-TEXT', 'metadata': {'evidence': [
            {'url': 'https://gov.cn/offline-chain', 'excerpt': 'UNRELATED-CHAIN-EXCERPT',
             'retrieval': 'exa_fulltext'}]}}
        prior['fact_check'] = {'text': '核验正文', 'metadata': {'checks': [
            {'claim': 'COMPLETE-CHECK-CLAIM', 'year': '2026', 'source': 'https://gov.cn/check/a',
             'cross_source': 'https://gov.cn/check/b', 'verdict': '待核实'}]}}
        original = copy.deepcopy(prior)
        scores = [self._score(number, index) for number in (1, 2, 3) for index in range(25)][:38]
        router = RecordingRouter({'chat/completions': (200, lambda request: self._reply_for_targets(request, scores))})
        out = self._provider(router).run_part('scoring', '评分维度与权重', {'city': '测试城', 'mode': 'deep'}, prior)
        self.assertEqual(len(out['metadata']['scores']), 38)
        self.assertEqual(prior, original)
        for request in router.calls:
            prompt, targets = self._request_targets(request)
            names = {target['name'] for target in targets}
            for number in (1, 2, 3):
                for company in prior[f'enterprises_{number}']['metadata']['selected']:
                    excerpt = f'EXACT-EXCERPT:{company["name"]}:完整2026年事实及原始风险'
                    if company['name'] in names:
                        self.assertIn(excerpt, prompt)
                        self.assertIn(company['url'], prompt)
                    else:
                        self.assertNotIn(excerpt, prompt)
            for marker in ('UNRELATED-ENTERPRISE-SOURCE', 'UNRELATED-POLICY-EXCERPT', 'UNRELATED-CHAIN-EXCERPT'):
                self.assertNotIn(marker, prompt)
            for marker in ('COMPLETE-POLICY-TEXT', 'COMPLETE-CHAIN-TEXT', 'COMPLETE-CHECK-CLAIM'):
                self.assertIn(marker, prompt)
            self.assertIn('正文引用来源时使用实际给出的完整URL，不用裸来源编号', prompt)

    def test_scoring_subrequest_rejects_missing_duplicate_foreign_extra_and_invalid_dimensions(self):
        scores = [self._score(number, index) for number in (1, 2, 3) for index in range(25)][:38]
        for defect in ('missing', 'duplicate', 'foreign', 'extra', 'dimensions', 'length', 'short', 'unsafe'):
            with self.subTest(defect=defect):
                def model(request):
                    prompt, targets = self._request_targets(request)
                    reply = json.loads(self._reply_for_targets(request, scores))
                    if '本次内部评分批：2/2' not in prompt:
                        return json.dumps(reply)
                    body = json.loads(reply['choices'][0]['message']['content'])
                    if defect == 'missing':
                        body['scores'].pop()
                    elif defect == 'duplicate':
                        body['scores'][-1] = copy.deepcopy(body['scores'][0])
                    elif defect == 'foreign':
                        body['scores'][0] = scores[0]  # Valid saved company in the other group.
                    elif defect == 'extra':
                        body['scores'].append(scores[0])
                    elif defect == 'dimensions':
                        del body['scores'][0]['dimensions']['risk']
                    elif defect == 'length':
                        reply['choices'][0]['finish_reason'] = 'length'
                    elif defect == 'short':
                        body['text'] = '一行不足'
                    elif defect == 'unsafe':
                        body['text'] += '\nhttp://127.0.0.1/private'
                    reply['choices'][0]['message']['content'] = json.dumps(body)
                    return json.dumps(reply)
                router = RecordingRouter({'chat/completions': (200, model)})
                prior = self._prior()
                original = copy.deepcopy(prior)
                with self.assertRaises(fp.FullProviderError) as caught:
                    self._provider(router).run_part('scoring', '评分维度与权重', {'city': '测试城', 'mode': 'deep'}, prior)
                self.assertEqual(caught.exception.failure_code, 'quality')
                self.assertEqual(prior, original)
                self.assertEqual(len(router.calls), 2)

    def test_scoring_merged_prose_still_rejects_cross_group_repetition(self):
        scores = [self._score(number, index) for number in (1, 2, 3) for index in range(25)][:38]
        def model(request):
            reply = json.loads(self._reply_for_targets(request, scores))
            body = json.loads(reply['choices'][0]['message']['content'])
            body['text'] = '\n'.join(f'两组完全相同通用说明{i}' for i in range(25))
            reply['choices'][0]['message']['content'] = json.dumps(body)
            return json.dumps(reply)
        router = RecordingRouter({'chat/completions': (200, model)})
        with self.assertRaises(fp.FullProviderError) as caught:
            self._provider(router).run_part('scoring', '评分维度与权重', {'city': '测试城', 'mode': 'deep'}, self._prior())
        self.assertEqual(str(caught.exception), 'part contains repeated filler')

    def test_unknown_company_wrong_direction_and_missing_selections_fail_closed(self):
        for changes in ({'name': '未知企业'}, {'direction': 'dir2'}, {'direction': ['dir1']}):
            with self.subTest(changes=changes), self.assertRaises(fp.FullProviderError) as caught:
                self._run([{**self._score(), **changes}])
            self.assertEqual(caught.exception.failure_code, 'quality')
            self.assertEqual(str(caught.exception), 'score identity is absent from saved selections')
        with self.assertRaises(fp.FullProviderError):
            self._run([self._score()], {})

    def test_missing_risk_or_other_dimension_is_rejected_instead_of_filled_with_zero(self):
        for missing in ('risk', 'industry_fit'):
            score = self._score()
            del score['dimensions'][missing]
            with self.subTest(missing=missing), self.assertRaises(fp.FullProviderError) as caught:
                self._run([score])
            self.assertEqual(caught.exception.failure_code, 'quality')
            self.assertEqual(str(caught.exception), 'score dimensions require seven finite values within 0..10')

    def test_out_of_range_nonfinite_boolean_and_extra_dimensions_are_rejected(self):
        for value in (-1, 11, float('nan'), float('inf'), True, '0'):
            score = self._score()
            score['dimensions']['risk'] = value
            with self.subTest(value=value), self.assertRaises(fp.FullProviderError):
                self._run([score])
        score = self._score()
        score['dimensions']['unknown_dimension'] = 0
        with self.assertRaises(fp.FullProviderError):
            self._run([score])


class DirectionSerializationTests(unittest.TestCase):
    _provider = LiveProviderRuntimeTests._provider

    @staticmethod
    def _prior():
        names = ('商业航天产业链', '具身智能与机器人', '脑机接口及医疗器械')
        directions = [{'id': f'dir{number}', 'name': name,
                       'evidence_ref': f'https://stats.gov.cn/offline/direction/{number}?year=2026#scope',
                       'full_detail': {'basis': '完整已保存方向依据' * 500 + f'DIRECTION-TAIL-{number}'}}
                      for number, name in enumerate(names, 1)]
        prior = {'industry': {'text': 'OFFLINE已保存产业正文，后续章节须沿用其方向身份。',
            'metadata': {'directions': directions, 'evidence': [
                {'url': direction['evidence_ref'], 'title': 'OFFLINE saved direction',
                 'excerpt': 'OFFLINE retrieved direction evidence', 'retrieval': 'exa_fulltext'}
                for direction in directions]}}}
        for number in (1, 2, 3):
            prior[f'enterprises_{number}'] = {'text': 'OFFLINE已保存精选正文',
                'metadata': {'selected': [{'name': f'方向{number}精选企业{index}',
                    'expansion_evidence': f'OFFLINE完整保存信号{number}/{index}',
                    'url': f'https://cninfo.com.cn/offline/{number}/{index}'} for index in range(4)]}}
        return prior

    def test_direction_records_are_serialized_complete_with_ids_exact_names_and_refs(self):
        directions = self._prior()['industry']['metadata']['directions']
        text = fp._render_structured({'directions': directions})
        decoded = [json.loads(line.removeprefix('- 已确定产业方向: ')) for line in text.splitlines()]
        self.assertEqual(decoded, directions)
        for number in (1, 2, 3):
            self.assertIn(f'DIRECTION-TAIL-{number}', text)

    def test_saved_directions_reach_continuation_scoped_score_and_signal_prompts_intact(self):
        prior = self._prior()
        directions = prior['industry']['metadata']['directions']
        scenarios = (('industry', '产业集群与园区'), ('scoring', '评分维度与权重'),
                     ('scoring', '加权计算'), ('fact_check', '五星企业信号'))
        for stage, part in scenarios:
            with self.subTest(stage=stage, part=part):
                payload = {'text': '\n'.join(f'OFFLINE {stage}/{part}独立分析{i}' for i in range(130)),
                           'directions': directions, 'checks': [],
                           'high_star_unavailable': True, 'high_star_note': 'OFFLINE fixture only',
                           'scores': []}
                router = RecordingRouter({
                    'exa.ai/search': (200, json.dumps({'results': [
                        {'url': f'https://stats.gov.cn/offline/new/{i}', 'text': f'OFFLINE search excerpt {i}'}
                        for i in range(8)]})),
                    'chat/completions': (200, json.dumps({'choices': [{'message': {'content': json.dumps(payload)}}]})),
                })
                if stage == 'scoring':
                    def scoring_model(request):
                        _, targets = ScoringIdentityGateTests._request_targets(request)
                        body = dict(payload, scores=[dict(target, dimensions={
                            key: (0 if key == 'risk' else 10) for key in fc.SCORE_DIMENSIONS}) for target in targets],
                            text='\n'.join(f'{targets[0]["name"]}本批独立评分依据{i}' for i in range(50)))
                        return json.dumps({'choices': [{'message': {'content': json.dumps(body)}}]})
                    router.routes['chat/completions'] = (200, scoring_model)
                elif stage == 'fact_check':
                    corrected = dict(payload, text='\n'.join(f'OFFLINE纠偏后全部方向缺乏独立原句，待核实事项{i}'
                                                             for i in range(130)),
                                     high_star_note='OFFLINE dir1/dir2/dir3未提供企业独立原句')
                    responses = iter((payload, corrected))
                    router.routes['chat/completions'] = (200, lambda request: json.dumps(
                        {'choices': [{'message': {'content': json.dumps(next(responses))}}]}))
                self._provider(router).run_part(stage, part, {'city': '测试城'}, prior)
                chat = next(call for call in router.calls if 'chat/completions' in call.full_url)
                prompt = json.loads(chat.data)['messages'][-1]['content']
                for direction in directions:
                    self.assertIn('- 已确定产业方向: ' + json.dumps(direction, ensure_ascii=False), prompt)


class PolicyEvidencePlanningTests(unittest.TestCase):
    _provider = LiveProviderRuntimeTests._provider

    def _router(self, chat=None):
        routes = {'exa.ai/search': (200, json.dumps({'results': [
            {'url': f'https://gov.cn/offline-policy/{i}', 'text': f'OFFLINE policy excerpt {i}'}
            for i in range(8)]}))}
        if chat is not None:
            routes['chat/completions'] = (200, json.dumps({'choices': [{
                'message': {'content': json.dumps(chat)}}]}))
        return RecordingRouter(routes)

    def test_national_policy_adds_exact_saved_direction_topics_to_existing_queries(self):
        router = self._router()
        p = self._provider(router)
        prior = DirectionSerializationTests._prior()
        p._gather_evidence('policy', '国家产业政策', '上海市松江区', prior)
        queries = [json.loads(call.data)['query'] for call in router.calls]
        baseline = fp._queries_for('policy', '国家产业政策', '上海市松江区')
        self.assertEqual(queries[:len(baseline)], baseline)
        self.assertEqual(queries[len(baseline):], [
            f"国家 {direction['name']} 产业政策 支持工具 申报条件 适用范围"
            for direction in prior['industry']['metadata']['directions']])

    def test_missing_directions_only_use_original_query_and_local_policy_queries_stay_same(self):
        for part, prior in (('国家产业政策', {}), ('国家产业政策', {'industry': {'metadata': {'directions': []}}}),
                            ('省市政策', DirectionSerializationTests._prior()),
                            ('区级政策', DirectionSerializationTests._prior())):
            with self.subTest(part=part, has_directions=bool(prior)):
                router = self._router()
                self._provider(router)._gather_evidence('policy', part, '上海市松江区', prior)
                self.assertEqual([json.loads(call.data)['query'] for call in router.calls],
                                 fp._queries_for('policy', part, '上海市松江区'))

    def test_policy_prompt_plans_supported_cards_real_newlines_and_keeps_token_budget(self):
        payload = {'text': '\n'.join(f'OFFLINE政策卡独立信息{i}' for i in range(67))}
        router = self._router(payload)
        p = self._provider(router)
        p.run_part('policy', '国家产业政策', {'city': '松江区', 'province': '上海市', 'mode': 'deep'},
                   DirectionSerializationTests._prior())
        chat = json.loads(next(call for call in router.calls if 'chat/completions' in call.full_url).data)
        self.assertEqual(chat['max_tokens'], 16000)
        prompt = chat['messages'][-1]['content']
        for requirement in ('实证政策卡', '发布机构', '文号', '适用产业链环节', '支持工具', '有效期',
                            '申报入口', '限制条款', '落地适配', '核查动作', '反复写同一句“待核实”',
                            '实际独立非空信息行数不少于67行', '不能依赖界面自动折行'):
            self.assertIn(requirement, prompt)

    def test_other_stage_gets_actual_floor_self_check_without_extra_calls_or_token_change(self):
        router = self._router({'text': '\n'.join(f'OFFLINE经济事实{i}' for i in range(38))})
        self._provider(router).run_part('economy', '经济总量', {'city': '测试城', 'mode': 'deep'}, {})
        searches = [call for call in router.calls if 'exa.ai/search' in call.full_url]
        self.assertEqual(len(searches), len(fp._queries_for('economy', '经济总量', '测试城')))
        chat = json.loads(next(call for call in router.calls if 'chat/completions' in call.full_url).data)
        self.assertEqual(chat['max_tokens'], 16000)
        self.assertIn('实际独立非空信息行数不少于38行', chat['messages'][-1]['content'])


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
