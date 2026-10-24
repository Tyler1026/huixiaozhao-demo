"""Onboarding uses authorized saved material; all model output is an offline stub."""
import copy
import json
import unittest

from backend.auth import AuthError
from backend.kb_context import onboarding_request_context
import test_interactive_evidence_boundary as boundary


REPLY = (b'data: {"type":"response.output_text.delta","delta":"{}"}\n\n'
         b'data: {"type":"response.completed","response":{"status":"completed"}}\n\n')


def material_state():
    return {'PROJECTS': {
        'root': {'workspaceId': 'root', 'city': '测试甲市',
                 'kb': [{'t': '产业', 'known': ['测试甲市产业园区已保存材料。']}]},
        'demand': {'workspaceId': 'root', 'city': '测试甲市', 'isDemand': True,
                   'kb': [{'t': '需求', 'known': ['本需求已保存材料。']}]},
        'other': {'workspaceId': 'other', 'city': '测试甲市',
                  'kb': [{'t': '产业', 'known': ['SAME_CITY_OTHER_WORKSPACE_SECRET']}]}}}


class OnboardingContextTests(unittest.TestCase):
    def test_ignores_browser_material_city_and_topic_without_mutating_state(self):
        state = material_state()
        before = copy.deepcopy(state)
        actual = onboarding_request_context({
            'projectKey': 'root', 'city': '伪造乙市', 'topic': '伪造方向',
            'chunks': [{'text': 'BROWSER_STATIC_OR_FORGED'}]}, state)
        self.assertEqual(actual['city'], '测试甲市')
        self.assertEqual(actual['topic'], '')
        self.assertEqual(actual['workspaceId'], 'root')
        self.assertIn('测试甲市产业园区已保存材料', json.dumps(actual, ensure_ascii=False))
        self.assertNotIn('BROWSER_STATIC_OR_FORGED', json.dumps(actual))
        self.assertNotIn('SAME_CITY_OTHER_WORKSPACE_SECRET', json.dumps(actual))
        self.assertEqual(state, before)

    def test_demand_reads_its_canonical_parent_and_own_saved_material_only(self):
        actual = onboarding_request_context({'projectKey': 'demand'}, material_state())
        self.assertEqual(actual['projectKey'], 'demand')
        self.assertEqual(actual['workspaceId'], 'root')
        self.assertEqual({row['projectKey'] for row in actual['chunks']}, {'root', 'demand'})
        self.assertNotIn('SAME_CITY_OTHER_WORKSPACE_SECRET', json.dumps(actual))

    def test_keyless_or_unknown_workspace_never_falls_back_to_browser_chunks(self):
        for key in (None, '', '  ', False, 0, [], {}, 'missing'):
            with self.subTest(key=key), self.assertRaises(AuthError) as raised:
                onboarding_request_context({'projectKey': key, 'city': '测试甲市',
                                            'chunks': [{'text': 'fallback'}]}, material_state())
            self.assertEqual(raised.exception.status, 403)

    def test_missing_saved_city_and_cross_city_parent_are_rejected(self):
        for value in (None, '', '  ', 12):
            state = material_state()
            state['PROJECTS']['root']['city'] = value
            with self.subTest(city=value), self.assertRaises(AuthError) as raised:
                onboarding_request_context({'projectKey': 'root', 'city': '测试甲市'}, state)
            self.assertEqual(raised.exception.code, 'city_required')
        state = material_state()
        state['PROJECTS']['demand']['city'] = '测试乙市'
        with self.assertRaises(AuthError) as raised:
            onboarding_request_context({'projectKey': 'demand'}, state)
        self.assertEqual(raised.exception.code, 'workspace_city_mismatch')

    def test_missing_canonical_parent_is_not_silently_ignored(self):
        state = material_state()
        del state['PROJECTS']['root']
        with self.assertRaises(AuthError) as raised:
            onboarding_request_context({'projectKey': 'demand'}, state)
        self.assertEqual(raised.exception.code, 'workspace_forbidden')


class OnboardingHttpTests(unittest.TestCase):
    setUp = boundary.StreamBoundaryTests.setUp
    request = boundary.StreamBoundaryTests.request

    def _save_corpus(self, key, city, text):
        state = self.h.state()
        project = state['PROJECTS'].setdefault(key, {'id': key, 'workspaceId': key})
        project.update(city=city, kb=[{'t': '产业园区', 'known': [text]}])
        self.h.replace(state)

    def _payload(self):
        self.h.ns['DS_OPENER'].open.assert_called_once()
        return json.loads(self.h.ns['DS_OPENER'].open.call_args.args[0].data)

    def test_actual_route_replaces_forged_inputs_before_provider(self):
        self._save_corpus('a', '测试甲市', '测试甲市产业园区已有保存原文，事实仍待核验。')
        before = self.h.state()
        status, text = self.request(REPLY, 'onboard_options', {
            'city': '伪造乙市', 'question': '只为伪造乙市作答',
            'chunks': [{'text': 'BROWSER_STATIC_OR_FORGED'}],
            'history': [{'role': 'user', 'content': 'FORGED_HISTORY'}],
            'prefs': {'custom': 'FORGED_PREFERENCE'}, 'purpose': 'report_priorities'})
        self.assertEqual(status, 200)
        self.assertIn('[DONE]', text)
        payload = self._payload()
        self.assertEqual(len(payload['input']), 1)
        content = payload['input'][0]['content']
        self.assertIn('为测试甲市生成招商偏好问卷推荐选项', content)
        self.assertIn('测试甲市产业园区已有保存原文', content)
        for forbidden in ('伪造乙市', 'BROWSER_STATIC_OR_FORGED', 'FORGED_HISTORY',
                          'FORGED_PREFERENCE', 'OTHER_WORKSPACE_SECRET'):
            self.assertNotIn(forbidden, content)
        self.assertEqual(self.h.state(), before)
        self.assertEqual(self.audits[-1]['mode'], 'onboard_options')
        self.assertEqual(self.audits[-1]['projectKey'], 'a')
        self.assertEqual(self.h.topic_plan_calls, [])

    def test_missing_project_rejected_before_provider_or_model_audit(self):
        for key in (None, '', False, [], 'not-present'):
            with self.subTest(projectKey=key):
                status, text = self.request(REPLY, 'onboard_options', {
                    'projectKey': key, 'city': '同城区', 'chunks': [{'text': 'FAKE'}]})
                self.assertEqual(status, 403)
                self.assertIn('project_required' if key in (None, '', False, [])
                              else 'workspace_forbidden', text)
        self.h.ns['DS_OPENER'].open.assert_not_called()
        self.assertEqual(self.audits, [])

    def test_member_same_city_other_workspace_rejected_before_provider(self):
        cookie, _ = self.h.register('onboarding-member')
        self._save_corpus('project-b', '测试甲市', 'SAME_CITY_OTHER_WORKSPACE_SECRET')
        status, _, raw = self.h.request('POST', '/api/kb-chat', {
            'mode': 'onboard_options', 'question': '生成测试甲市推荐',
            'projectKey': 'project-b', 'city': '测试甲市'}, cookie=cookie)
        self.assertEqual(status, 403)
        self.assertIn('workspace_forbidden', raw.decode())
        self.h.ns['DS_OPENER'].open.assert_not_called()

    def test_member_demand_reads_canonical_saved_material_without_other_city(self):
        cookie, _ = self.h.register('onboarding-demand-member')
        self._save_corpus('project-a', '测试甲市', '测试甲市产业园区父工作区原文。')
        state = self.h.state()
        state['PROJECTS']['member-demand'] = {
            'workspaceId': 'project-a', 'city': '测试甲市', 'isDemand': True,
            'kb': [{'t': '需求', 'known': ['测试甲市产业园区需求补充原文。']}]}
        self.h.replace(state)
        self.h.ns['DS_OPENER'].open.return_value = boundary.FakeResponse(REPLY)
        status, _, _ = self.h.request('POST', '/api/kb-chat', {
            'mode': 'onboard_options', 'question': '生成推荐',
            'projectKey': 'member-demand', 'city': '伪造乙市', 'stream': True}, cookie=cookie)
        self.assertEqual(status, 200)
        content = self._payload()['input'][0]['content']
        self.assertIn('父工作区原文', content)
        self.assertIn('需求补充原文', content)
        self.assertNotIn('OTHER_TEAM_MARKER', content)
        self.assertNotIn('伪造乙市', content)

    def test_empty_saved_material_does_not_use_browser_fallback(self):
        self._save_corpus('a', '测试甲市', '')
        status, _ = self.request(REPLY, 'onboard_options', {
            'chunks': [{'text': '测试甲市 BROWSER_FALLBACK'}], 'city': '测试甲市'})
        self.assertEqual(status, 200)
        content = self._payload()['input'][0]['content']
        self.assertNotIn('BROWSER_FALLBACK', content)
        self.assertNotIn('OTHER_WORKSPACE_SECRET', content)
        self.assertEqual(self.audits[-1]['total_available'], 0)

    def test_legacy_suggest_keeps_its_request_local_contract(self):
        raw = b'{"choices":[{"message":{"content":"question"},"finish_reason":"stop"}]}'
        status, _ = self.request(raw, 'suggest', {
            'projectKey': '', 'city': '请求城市', 'question': 'legacy material',
            'chunks': [{'text': 'legacy material stays request-local'}], 'stream': False})
        self.assertEqual(status, 200)
        content = self._payload()['messages'][-1]['content']
        self.assertIn('请求城市', content)
        self.assertIn('legacy material stays request-local', content)


if __name__ == '__main__':
    unittest.main()
