"""Offline regressions for funnel recall and untrusted historical names."""
import copy
import json
import unittest

from backend.evidence_grounding import (
    bounded_catalog, evidence_catalog, funnel_catalog, funnel_legacy_prompt,
    ground_funnel, project_context,
)
from backend.sync_merge import _merge_map
from tests import test_interactive_evidence_boundary as http_fixture


TOPIC = '生物制药无菌滤器'
COMPANY = '目标过滤设备股份有限公司'
PRODUCT = (COMPANY + '生产生物制药无菌滤器，使用亲水PES滤膜；'
           '只适用于公开规格条件，批次验证及交期仍待核查。来源 https://official.example/filter')


def state_fixture():
    return {'PROJECTS': {
        'p': {'id': 'p', 'workspaceId': 'p', 'city': '测试区', 'topic': TOPIC,
              'reportRequestId': 'r1', 'kb': [{'t': '基础材料', 'known': [
                  {'text': '测试区保存的产业背景材料，企业信息仍待核查。'}]}]},
        'child': {'id': 'child', 'workspaceId': 'p', 'city': '测试区', 'topic': TOPIC},
        'other': {'id': 'other', 'workspaceId': 'other', 'city': '测试区', 'topic': TOPIC,
                  'kb': [{'t': '企业产品', 'known': [
                      {'text': '其他工作区秘密公司生产生物制药无菌滤器。https://private.example/product'}]}],
                  'funnel': {'topic': TOPIC, 'companies': [{'name': '其他工作区秘密公司'}]}}},
        'REPORTSTATE': {}}


def context(state=None, key='p', topic=TOPIC):
    return project_context({'projectKey': key, 'topic': topic}, state or state_fixture())


def catalog_fixture():
    rows = [{'id': 'row_' + str(i), 'quote': '基础经济背景与统计口径说明第%d条。' % i,
             'topic': '基础材料', 'urls': [], 'cite': '已保存材料', 'date': '', 'status': 'pending'}
            for i in range(200)]
    # Row 1 is omitted by the previous first/middle/last sampling algorithm.
    rows[1] = dict(rows[1], quote=PRODUCT, urls=['https://official.example/filter'])
    return rows


class FunnelRecallTests(unittest.TestCase):
    def test_relevant_company_product_omitted_by_position_sampling_is_recalled_whole(self):
        rows = catalog_fixture()
        original = copy.deepcopy(rows)
        self.assertNotIn('row_1', {row['id'] for row in bounded_catalog(rows)})
        selected = funnel_catalog(rows, context())
        self.assertEqual(selected[0], rows[1])
        self.assertEqual(len(selected), 96)
        self.assertEqual(len({row['id'] for row in selected}), 96)
        self.assertLessEqual(sum(len(json.dumps(row, ensure_ascii=False)) for row in selected), 48000)
        self.assertEqual(rows, original)
        result = ground_funnel({'companies': [{'name': COMPANY, 'evidence_ids': ['row_1']}]},
                               selected, context())
        self.assertEqual(result['companies'][0]['evidence'][0]['quote'], PRODUCT)
        self.assertIsNone(result['companies'][0]['score_match'])
        self.assertFalse(result['companies'][0]['push_eligible'])

    def test_specific_demand_product_outranks_generic_industry_and_historical_name(self):
        ctx = context()
        ctx.update(demandContract='industry-demand-v1',
                   demandTitle='生物制药滤器', selectedPriority={'focus': '无菌滤器'},
                   demandSpec={'description': '寻找亲水PES滤膜的生物制药无菌滤器'},
                   legacyTopic=TOPIC, legacyCandidates=[{'name': '历史公司'}])
        rows = evidence_catalog([
            {'id': 'generic', 'topic': '产业',
             'text': '生物医药公司提供制药工业园招商服务，非滤器制造商。https://official.example/park'},
            {'id': 'old', 'topic': '历史',
             'text': '历史公司生产汽车座椅，产品用于整车行业。https://official.example/car'},
            {'id': 'product', 'topic': '企业产品', 'text': PRODUCT},
        ])
        selected = funnel_catalog(rows, ctx, limit=1)
        self.assertEqual(selected[0]['quote'], PRODUCT)
        self.assertEqual(selected[0]['urls'], ['https://official.example/filter'])

    def test_character_budget_skips_oversized_whole_rows_without_clipping(self):
        rows = evidence_catalog([
            {'id': 'large', 'text': COMPANY + '生产生物制药无菌滤器，' * 40 + ' https://official.example/large'},
            {'id': 'small', 'text': PRODUCT},
        ])
        budget = len(json.dumps(rows[1], ensure_ascii=False))
        selected = funnel_catalog(rows, context(), limit=1, char_limit=budget)
        self.assertEqual(selected, [rows[1]])
        self.assertEqual(funnel_catalog(rows, context(), char_limit=1), [])

    def test_city_and_generic_request_words_do_not_create_product_relevance(self):
        ctx = context()
        ctx.update(city='闵行区', topic='闵行区生物制药无菌滤器',
                   demandContract='industry-demand-v1', selectedPriority={},
                   demandSpec={'description': '希望引入闵行区具备相关生产能力、满足要求的企业'})
        rows = evidence_catalog([
            {'id': 'background', 'text': '基础经济背景与统计口径说明，本段资料供查阅。'},
            {'id': 'city', 'text': '闵行公司具备生产能力，现有产品满足相关要求。https://official.example/address'},
        ])
        self.assertEqual(funnel_catalog(rows, ctx, limit=1), bounded_catalog(rows, limit=1))

    def test_no_url_cannot_be_promoted_by_relevance_or_historical_name(self):
        ctx = context()
        ctx.update(legacyTopic=TOPIC, legacyCandidates=[{'name': COMPANY}])
        rows = evidence_catalog([{'id': 'no_url', 'text': COMPANY + '生产生物制药无菌滤器，交付能力待核查。'}])
        selected = funnel_catalog(rows, ctx)
        self.assertEqual(selected[0]['urls'], [])
        with self.assertRaises(ValueError):
            ground_funnel({'companies': [{'name': COMPANY, 'evidence_ids': [selected[0]['id']],
                                          'source': 'https://model-invented.example'}]}, selected, ctx)
        self.assertEqual(ground_funnel({'companies': []}, selected, ctx)['companies'], [])

    def test_other_workspace_material_and_legacy_names_never_enter_retrieval(self):
        state = state_fixture()
        state['PROJECTS']['p']['kb'][0]['known'].append({'text': PRODUCT})
        ctx = context(state)
        selected = funnel_catalog(evidence_catalog(ctx['chunks']), ctx)
        self.assertIn(COMPANY, json.dumps(selected, ensure_ascii=False))
        self.assertNotIn('秘密公司', json.dumps(ctx, ensure_ascii=False))
        self.assertNotIn('private.example', json.dumps(selected, ensure_ascii=False))
        self.assertNotIn('legacyCandidates', ctx)

    def test_unrelated_topic_legacy_name_does_not_drive_priority(self):
        ctx = context()
        rows = evidence_catalog([
            {'id': 'plain', 'text': '基础经济背景与统计口径说明，本段资料供查阅。'},
            {'id': 'old', 'text': '历史公司生产汽车座椅，产品用于整车行业。https://official.example/car'},
        ])
        ctx.update(legacyTopic='汽车零部件', legacyCandidates=[{'name': '历史公司'}])
        self.assertEqual(funnel_catalog(rows, ctx, limit=1), bounded_catalog(rows, limit=1))


class LegacyFunnelTests(unittest.TestCase):
    def test_names_are_normalized_deduplicated_and_bounded_without_other_old_fields(self):
        state = state_fixture()
        old_rows = [{'name': '  ＡＢＣ  公司\n', 'score_match': 99, 'source': 'https://untrusted.example', 'fit': '已签约'},
                    {'name': 'ABC 公司'}, {'name': ''}, {'name': None}, {'name': {}}, {'name': '---'},
                    {'name': '超长' * 200}] + [{'name': '历史公司%d' % i} for i in range(220)]
        state['PROJECTS']['p']['funnel'] = {'topic': '旧方向', 'companies': old_rows}
        before = copy.deepcopy(state)
        ctx = context(state)
        self.assertEqual(ctx['legacyTopic'], '旧方向')
        self.assertEqual(len(ctx['legacyCandidates']), 200)
        self.assertEqual(ctx['legacyCandidates'][0], {'name': 'ABC 公司'})
        self.assertTrue(all(set(row) == {'name'} for row in ctx['legacyCandidates']))
        self.assertNotIn('untrusted.example', json.dumps(ctx, ensure_ascii=False))
        self.assertNotIn('已签约', json.dumps(ctx, ensure_ascii=False))
        self.assertEqual(state, before)

    def test_empty_result_and_later_direction_change_keep_original_untrusted_history(self):
        state = state_fixture()
        state['PROJECTS']['p']['funnel'] = {
            'topic': TOPIC, 'companies': [{'name': COMPANY, 'score_match': 99, 'fit': '投资已确认'}]}
        ctx = context(state)
        result = ground_funnel({'companies': [], 'legacyCandidates': [{'name': '模型伪造公司'}]}, [], ctx)
        self.assertEqual(result['companies'], [])
        self.assertEqual(result['legacyCandidates'], [{'name': COMPANY}])
        self.assertEqual(result['legacyTopic'], TOPIC)
        state['PROJECTS']['p']['funnel'] = result
        state['PROJECTS']['p']['topics'] = [{'label': '核电设备'}]
        after = context(state, topic='核电设备')
        self.assertEqual(after['legacyTopic'], TOPIC)
        self.assertEqual(after['legacyCandidates'], [{'name': COMPANY}])
        again = ground_funnel({'companies': []}, [], after)
        self.assertEqual(again['legacyTopic'], TOPIC)
        self.assertEqual(again['legacyCandidates'], [{'name': COMPANY}])

    def test_same_project_only_parent_and_neighbor_history_are_not_inherited(self):
        state = state_fixture()
        state['PROJECTS']['p']['funnel'] = {'topic': TOPIC, 'companies': [{'name': '父工作区旧公司'}]}
        self.assertNotIn('legacyCandidates', context(state, key='child'))

    def test_current_verified_format_does_not_reclassify_current_candidates_as_history(self):
        state = state_fixture()
        state['PROJECTS']['p']['funnel'] = {
            'evidence_contract': 'saved-excerpts-v1', 'topic': TOPIC, 'companies': [{'name': COMPANY}]}
        self.assertNotIn('legacyCandidates', context(state))

    def test_historical_names_are_separate_prompt_hints_without_evidence_ids(self):
        state = state_fixture()
        state['PROJECTS']['p']['funnel'] = {'topic': TOPIC, 'companies': [
            {'name': COMPANY, 'source': 'https://old-invented.example', 'score_match': 99}]}
        ctx = context(state)
        catalog = evidence_catalog(ctx['chunks'])
        self.assertNotIn(COMPANY, json.dumps(catalog, ensure_ascii=False))
        prompt = funnel_legacy_prompt(ctx)
        self.assertIn(COMPANY, prompt)
        self.assertIn('不是事实或证据', prompt)
        self.assertIn('不得将历史名字用作 evidence_ids', prompt)
        self.assertNotIn('old-invented.example', prompt)
        with self.assertRaises(ValueError):
            ground_funnel({'companies': [{'name': COMPANY, 'evidence_ids': [COMPANY]}]}, catalog, ctx)

    def test_merge_keeps_current_candidate_behavior_without_trusting_client_archive(self):
        old = {'a': {'funnel': {'topic': TOPIC, 'evidence_contract': 'saved-excerpts-v1',
                               'companies': [{'name': '当前候选'}]}}}
        incoming = {'a': {'funnel': {'topic': TOPIC, 'evidence_contract': 'saved-excerpts-v1',
                                    'companies': [{'name': '更新候选'}],
                                    'legacyCandidates': [{'name': '伪造历史'}], 'legacyTopic': '伪造方向'}}}
        merged = _merge_map(old, incoming)
        self.assertEqual(merged['a']['funnel']['companies'], [{'name': '更新候选'}])
        self.assertNotIn('legacyCandidates', merged['a']['funnel'])
        self.assertNotIn('legacyTopic', merged['a']['funnel'])
        new = _merge_map({}, incoming)
        self.assertEqual(new['a']['funnel']['companies'], [{'name': '更新候选'}])
        self.assertNotIn('legacyCandidates', new['a']['funnel'])


class FunnelRecoveryHttpTests(unittest.TestCase):
    setUp = http_fixture.StreamBoundaryTests.setUp
    request = http_fixture.StreamBoundaryTests.request

    def test_real_route_recalls_product_and_preserves_names_on_empty_completion(self):
        state = self.h.state()
        project = state['PROJECTS']['a']
        project.update(topic=TOPIC, funnel={'topic': TOPIC, 'companies': [
            {'name': COMPANY, 'source': 'https://old-invented.example', 'score_match': 99}]})
        project['kb'] = [{'t': '基础材料', 'known': [
            {'text': row['quote']} for row in catalog_fixture()]}]
        state['REPORTSTATE']['a'] = {'topic': TOPIC}
        self.h.replace(state)
        raw = json.dumps({'choices': [{'message': {'content': '{"companies": []}'}, 'finish_reason': 'stop'}]}).encode()
        status, data = self.request(raw, 'funnel', {'topic': TOPIC, 'reportRequestId': 'r1'})
        self.assertEqual(status, 200)
        self.assertIn('[DONE]', data)
        sent = json.loads(self.h.ns['DS_OPENER'].open.call_args.args[0].data)
        message = sent['messages'][-1]['content']
        self.assertIn(PRODUCT, message)
        self.assertIn('历史待核企业名', message)
        self.assertNotIn('old-invented.example', message)
        self.assertNotIn('OTHER_WORKSPACE_SECRET', message)
        result = self.h.state()['PROJECTS']['a']['funnel']
        self.assertEqual(result['companies'], [])
        self.assertEqual(result['legacyCandidates'], [{'name': COMPANY}])
        self.assertEqual(result['legacyTopic'], TOPIC)
        self.assertEqual(result['source_records'], 96)
        self.assertEqual(self.audits[-1]['evidence_records'], 96)
        status, _ = self.request(raw, 'funnel', {'topic': TOPIC, 'reportRequestId': 'r1'})
        self.assertEqual(status, 200)
        repeated = self.h.state()['PROJECTS']['a']['funnel']
        self.assertEqual(repeated['legacyCandidates'], [{'name': COMPANY}])
        self.assertEqual(repeated['legacyTopic'], TOPIC)

    def test_empty_completion_after_direction_change_keeps_original_legacy_topic(self):
        state = self.h.state()
        state['PROJECTS']['a']['funnel'] = {
            'evidence_contract': 'saved-excerpts-v1', 'topic': '核电配套', 'companies': [],
            'legacyTopic': '原有火箭方向', 'legacyCandidates': [{'name': '旧公司'}]}
        self.h.replace(state)
        raw = json.dumps({'choices': [{'message': {'content': '{"companies": []}'}, 'finish_reason': 'stop'}]}).encode()
        status, data = self.request(raw, 'funnel', {'reportRequestId': 'r1'})
        self.assertEqual(status, 200)
        self.assertIn('[DONE]', data)
        result = self.h.state()['PROJECTS']['a']['funnel']
        self.assertEqual(result['topic'], '液体火箭')
        self.assertEqual(result['legacyTopic'], '原有火箭方向')
        self.assertEqual(result['legacyCandidates'], [{'name': '旧公司'}])

    def test_latest_server_history_is_preserved_if_it_changes_during_generation(self):
        state = self.h.state()
        state['PROJECTS']['a']['funnel'] = {'topic': '液体火箭', 'companies': [{'name': '旧公司'}]}
        self.h.replace(state)
        raw = json.dumps({'choices': [{'message': {'content': '{"companies": []}'}, 'finish_reason': 'stop'}]}).encode()

        def complete(*args, **kwargs):
            latest = self.h.state()
            latest['PROJECTS']['a']['funnel']['companies'].append({'name': '后来补充公司'})
            self.h.replace(latest)
            return http_fixture.FakeResponse(raw)

        self.h.ns['DS_OPENER'].open.side_effect = complete
        status, data = self.request(raw, 'funnel', {'reportRequestId': 'r1'})
        self.assertEqual(status, 200)
        self.assertIn('[DONE]', data)
        result = self.h.state()['PROJECTS']['a']['funnel']
        self.assertEqual(result['legacyCandidates'], [{'name': '旧公司'}, {'name': '后来补充公司'}])

    def test_material_change_still_rejects_completion_without_overwriting_old_funnel(self):
        state = self.h.state()
        old_funnel = {'topic': '液体火箭', 'companies': [{'name': '旧公司', 'score_match': 99}]}
        state['PROJECTS']['a']['funnel'] = old_funnel
        self.h.replace(state)
        raw = json.dumps({'choices': [{'message': {'content': '{"companies": []}'}, 'finish_reason': 'stop'}]}).encode()

        def complete(*args, **kwargs):
            latest = self.h.state()
            latest['PROJECTS']['a']['kb'][0]['known'].append({'text': '生成期间新保存的原文改变了证据版本。'})
            self.h.replace(latest)
            return http_fixture.FakeResponse(raw)

        self.h.ns['DS_OPENER'].open.side_effect = complete
        status, data = self.request(raw, 'funnel', {'reportRequestId': 'r1'})
        self.assertEqual(status, 409)
        self.assertIn('evidence_changed', data)
        self.assertEqual(self.h.state()['PROJECTS']['a']['funnel'], old_funnel)

    def test_sync_preserves_server_history_against_missing_empty_and_forged_snapshots(self):
        state = self.h.state()
        state['PROJECTS']['a']['funnel'] = {
            'topic': '当前方向', 'evidence_contract': 'saved-excerpts-v1', 'companies': [],
            'legacyTopic': '原方向', 'legacyCandidates': [{'name': '旧公司'}]}
        other = {'topic': '另一方向', 'companies': [{'name': '异项目公司'}]}
        state['PROJECTS']['b']['funnel'] = other
        self.h.replace(state)
        incoming_values = [
            {},
            {'legacyCandidates': [], 'legacyTopic': ''},
            {'legacyCandidates': None, 'legacyTopic': None},
            {'legacyCandidates': [{'name': '伪造公司', 'score_match': 99}], 'legacyTopic': '伪造方向'},
            {'legacyCandidates': [{'name': '异项目公司'}], 'legacyTopic': '另一方向'},
        ]
        for archive in incoming_values * 2:
            with self.subTest(archive=archive):
                funnel = {'topic': '客户端当前方向', 'evidence_contract': 'saved-excerpts-v1',
                          'companies': [{'name': '允许原有同步的当前候选'}], **archive}
                status, _, data = self.h.request('POST', '/api/sync', {'PROJECTS': {'a': {'funnel': funnel}}}, cookie=self.cookie)
                self.assertEqual(status, 200)
                self.assertTrue(json.loads(data)['ok'])
                saved = self.h.state()['PROJECTS']
                self.assertEqual(saved['a']['funnel']['legacyCandidates'], [{'name': '旧公司'}])
                self.assertEqual(saved['a']['funnel']['legacyTopic'], '原方向')
                self.assertEqual(saved['a']['funnel']['companies'], [{'name': '允许原有同步的当前候选'}])
                self.assertEqual(saved['b']['funnel'], other)
        raw = json.dumps({'choices': [{'message': {'content': '{"companies": []}'}, 'finish_reason': 'stop'}]}).encode()
        status, _ = self.request(raw, 'funnel', {'reportRequestId': 'r1'})
        self.assertEqual(status, 200)
        saved = self.h.state()['PROJECTS']['a']['funnel']
        self.assertEqual(saved['companies'], [])
        self.assertEqual(saved['legacyCandidates'], [{'name': '旧公司'}])
        self.assertEqual(saved['legacyTopic'], '原方向')

    def test_first_sync_archives_old_format_names_before_client_replaces_current_list(self):
        state = self.h.state()
        state['PROJECTS']['a']['funnel'] = {
            'topic': '旧方向', 'companies': [{'name': ' Ａ公司 ', 'score_match': 99, 'source': 'https://old.example'},
                                         {'name': 'A公司'}, {'name': '乙公司'}]}
        self.h.replace(state)
        incoming = {'PROJECTS': {'a': {'funnel': {'topic': '新方向', 'evidence_contract': 'saved-excerpts-v1',
                                                'companies': []}}}}
        for _ in range(2):
            status, _, data = self.h.request('POST', '/api/sync', incoming, cookie=self.cookie)
            self.assertEqual(status, 200)
            self.assertTrue(json.loads(data)['ok'])
            saved = self.h.state()['PROJECTS']['a']['funnel']
            self.assertEqual(saved['legacyCandidates'], [{'name': 'A公司'}, {'name': '乙公司'}])
            self.assertEqual(saved['legacyTopic'], '旧方向')
            self.assertEqual(saved['companies'], [])
        raw = json.dumps({'choices': [{'message': {'content': '{"companies": []}'}, 'finish_reason': 'stop'}]}).encode()
        status, _ = self.request(raw, 'funnel', {'reportRequestId': 'r1'})
        self.assertEqual(status, 200)
        saved = self.h.state()['PROJECTS']['a']['funnel']
        self.assertEqual(saved['legacyCandidates'], [{'name': 'A公司'}, {'name': '乙公司'}])
        self.assertEqual(saved['legacyTopic'], '旧方向')

    def test_empty_or_malformed_whole_funnel_sync_cannot_erase_history(self):
        state = self.h.state()
        state['PROJECTS']['a']['funnel'] = {'topic': '原方向', 'companies': [{'name': '旧公司'}]}
        self.h.replace(state)
        for value in (None, {}, [], '', 'malformed'):
            status, _, data = self.h.request('POST', '/api/sync', {'PROJECTS': {'a': {'funnel': value}}}, cookie=self.cookie)
            self.assertEqual(status, 200)
            self.assertTrue(json.loads(data)['ok'])
            saved = self.h.state()['PROJECTS']['a']['funnel']
            self.assertEqual(saved['legacyCandidates'], [{'name': '旧公司'}])
            self.assertEqual(saved['legacyTopic'], '原方向')
            self.assertEqual(saved['companies'], [{'name': '旧公司'}])


if __name__ == '__main__':
    unittest.main()
