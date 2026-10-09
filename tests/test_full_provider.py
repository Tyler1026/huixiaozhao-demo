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
import datetime
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

    def test_output_budget_tracks_actual_line_floor_and_respects_global_cap(self):
        for stage, floor, configured, expected in (
                ('economy', 38, 3500, 6000), ('economy', 60, 3500, 8000),
                ('economy', 59, 3500, 6000), ('policy', 67, 3500, 8000),
                ('chain', 84, 3500, 8000), ('action', 75, 3500, 8000),
                ('summary', 80, 3500, 8000), ('scoring', 50, 3500, 8000),
                ('compact', 200, 3500, 8000), ('economy', 38, 100_000, 8000)):
            with self.subTest(stage=stage, floor=floor, configured=configured):
                router = RecordingRouter({'chat/completions': (200, json.dumps({
                    'choices': [{'message': {'content': '{"text":"OFFLINE fixture"}'}}]}))})
                p = self._provider(router)
                p._live.max_output_tokens = configured
                p._chat_part(stage, fc.get_stage(stage)['parts'][0], '测试城', '', [], min_lines=floor)
                self.assertEqual(json.loads(router.calls[0].data)['max_tokens'], expected)
                self.assertLessEqual(expected, providers.MAX_OUTPUT_TOKENS)

    def test_intermediate_and_deep_floors_preserve_original_stage_totals(self):
        p = self._provider(RecordingRouter({}))
        prior = {'economy': {'text': '\n'.join(f'已保存{i}' for i in range(20))}}
        self.assertEqual(p._part_floor('economy', '增长态势', prior), 54)
        self.assertEqual(p._part_floor('economy', '经济总量', {}), 38)
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
        self.assertEqual(chat['max_tokens'], 6000)
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
        self.assertEqual(chat['max_tokens'], 8000)
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
                self.assertEqual(chat['max_tokens'], 6000)
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

    def _run(self, scores, prior=None):
        payload = {'text': '\n'.join(f'OFFLINE当前评分分析{i}' for i in range(100)), 'scores': scores}
        router = RecordingRouter({'chat/completions': (200, json.dumps({
            'choices': [{'message': {'content': json.dumps(payload)}}]}))})
        out = self._provider(router).run_part('scoring', '评分维度与权重',
            {'city': '测试城', 'mode': 'deep'}, self._prior() if prior is None else prior)
        return out, router

    def test_scoring_accepts_saved_identities_from_all_directions_without_full_pool_quota(self):
        out, router = self._run([self._score(number, 24) for number in (1, 2, 3)])
        self.assertEqual(len(out['metadata']['scores']), 3)
        self.assertEqual([entry['direction'] for entry in out['metadata']['scores']], ['dir1', 'dir2', 'dir3'])
        self.assertEqual([entry['weighted_score'] for entry in out['metadata']['scores']], [10, 10, 10])
        self.assertEqual([entry['rank'] for entry in out['metadata']['scores']], [1, 2, 3])
        prompt = json.loads(router.calls[0].data)['messages'][-1]['content']
        self.assertIn('评分身份允许名单仅来自前序enterprises_1/2/3的selected', prompt)

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
        p.run_part('policy', '国家产业政策', {'city': '松江区', 'province': '上海市'},
                   DirectionSerializationTests._prior())
        chat = json.loads(next(call for call in router.calls if 'chat/completions' in call.full_url).data)
        self.assertEqual(chat['max_tokens'], 8000)
        prompt = chat['messages'][-1]['content']
        for requirement in ('实证政策卡', '发布机构', '文号', '适用产业链环节', '支持工具', '有效期',
                            '申报入口', '限制条款', '落地适配', '核查动作', '反复写同一句“待核实”',
                            '实际独立非空信息行数不少于67行', '不能依赖界面自动折行'):
            self.assertIn(requirement, prompt)

    def test_other_stage_gets_actual_floor_self_check_without_extra_calls_or_token_change(self):
        router = self._router({'text': '\n'.join(f'OFFLINE经济事实{i}' for i in range(38))})
        self._provider(router).run_part('economy', '经济总量', {'city': '测试城'}, {})
        searches = [call for call in router.calls if 'exa.ai/search' in call.full_url]
        self.assertEqual(len(searches), len(fp._queries_for('economy', '经济总量', '测试城')))
        chat = json.loads(next(call for call in router.calls if 'chat/completions' in call.full_url).data)
        self.assertEqual(chat['max_tokens'], 6000)
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
