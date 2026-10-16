"""Client sync cannot write server-owned graphs, even with valid metadata."""
import copy
import io
import json
import time
import unittest
from unittest.mock import Mock

from backend.access_control import guard_sync, scoped_sync_view
from backend.auth import AuthError
from backend.sync_merge import _CHAIN_MAPS, _chain_source_matches, _merge_map
from backend.sync_route import SyncDependencies, handle_sync
from test_access_control import ADMIN, fixture, principal

TOPIC = '核电换热设备'
TEXT = '已保存完整报告正文'


def identity(projects, report, topic=TOPIC, key='p'):
    project = projects[key]
    root = project.get('workspaceId') or key
    keys = [key] if root == key else [root, key]
    return json.dumps({'workspace': root, 'city': project.get('city') or '', 'topic': topic,
        'selectedTopic': project.get('topic') or '',
        'requestId': project.get('reportRequestId') or report.get('reportRequestId') or '',
        'kb': [(projects.get(k) or {}).get('kb') or [] for k in keys],
        'onboarding': project.get('onboarding') or {},
        'report': (report.get('aiReportByTopic') or {}).get(topic)
                  or (report.get('text') if report.get('topic') == topic else '') or ''},
        ensure_ascii=False)


def graph(version, name='核级换热器', topic=TOPIC, text=TEXT):
    return {
        'topic': topic, 'text': text, 'ts': 100,
        'aiReportByTopic': {topic: text},
        'chainByTopic': {topic: [{'seg': s, 'nodes': ([{'name': name}] if s == '中游' and name else [])}
                                for s in ('上游', '中游', '下游')]},
        'chainEvidenceByTopic': {topic: {'contract': 'saved-excerpts-v1', 'scope': 'current-topic-v1',
            'topic': topic, 'generatedAt': version, 'reportText': text, 'requestId': '',
            'sourceIdentity': identity({'p': {'topic': topic}}, {'topic': topic, 'text': text}, topic)}},
        'chainStatusByTopic': {topic: 'ready'},
        'chainUnclassifiedByTopic': {topic: [{'name': '待分类的原文环节'}]},
    }


class ServerOwnedChainSyncTests(unittest.TestCase):
    def setUp(self):
        self.now = int(time.time() * 1000)
        self.current = graph(self.now - 20, '服务端图谱')
        self.incoming = graph(self.now - 10, '客户端伪造图谱')

    def route(self, stored, incoming, actor=None):
        original = copy.deepcopy(stored)
        raw = json.dumps(incoming).encode()
        if actor is not None:
            raw = guard_sync(raw, stored, actor)
        writes = []
        deps = SyncDependencies(True, lambda: json.dumps(stored),
                                lambda value: writes.append(value) or True,
                                'unused', lambda: None, lambda value: value)
        responder = Mock()
        responder.wfile = io.BytesIO()
        handle_sync(responder, raw, deps)
        self.assertTrue(json.loads(responder.wfile.getvalue())['ok'])
        self.assertEqual(stored, original, 'guard/merge must not mutate the supplied locked state')
        return json.loads(writes[-1])

    def assert_server_fields(self, actual, expected):
        for field in _CHAIN_MAPS:
            with self.subTest(field=field):
                self.assertEqual(field in actual, field in expected)
                self.assertEqual(actual.get(field), expected.get(field))

    def test_well_formed_newer_or_equal_identity_cannot_authorize_client_graph(self):
        for version in (self.now - 30, self.now - 20, self.now, self.now + 600000):
            with self.subTest(version=version):
                incoming = graph(version, '伪造节点')
                actual = _merge_map({'p': self.current}, {'p': incoming},
                                    chain_projects={'p': {'topic': TOPIC}})['p']
                self.assert_server_fields(actual, self.current)

    def test_every_client_value_is_ignored_and_ordinary_fields_still_update(self):
        for value in (None, {}, [], [None], 'forged', {TOPIC: None}, {TOPIC: [{'nodes': [None]}]}):
            with self.subTest(value=value):
                delta = dict.fromkeys(_CHAIN_MAPS, value)
                delta['score'] = 81
                actual = _merge_map({'p': self.current}, {'p': delta})['p']
                self.assert_server_fields(actual, self.current)
                self.assertEqual(actual['score'], 81)

    def test_new_report_record_drops_all_client_graph_fields(self):
        incoming = copy.deepcopy(self.incoming)
        incoming['chainErrorByTopic'] = {TOPIC: 'client-only error'}
        actual = _merge_map({}, {'p': incoming})['p']
        self.assertFalse(set(_CHAIN_MAPS) & set(actual))
        self.assertEqual(actual['text'], TEXT)
        self.assertEqual(actual['aiReportByTopic'], {TOPIC: TEXT})

    def test_null_or_non_object_report_cannot_erase_a_saved_graph(self):
        for value in (None, [], ['replacement'], 'replacement', False):
            with self.subTest(value=value):
                actual = self.route({'REPORTSTATE': {'p': self.current}}, {'REPORTSTATE': {'p': value}})
                self.assertEqual(actual['REPORTSTATE']['p'], self.current)

    def test_legacy_and_malformed_server_graph_fields_are_not_replaced_by_client(self):
        for old in ({'chainByTopic': None}, {'chainStatusByTopic': 'legacy'},
                    {'chainUnclassifiedByTopic': {TOPIC: []}}, {'chainErrorByTopic': {TOPIC: 'old'}}):
            with self.subTest(old=old):
                actual = _merge_map({'p': old}, {'p': self.incoming})['p']
                self.assert_server_fields(actual, old)

    def test_another_topic_cannot_be_added_through_client_sync(self):
        incoming = graph(self.now, topic='另一方向', text='另一份完整报告')
        actual = _merge_map({'p': self.current}, {'p': incoming})['p']
        self.assert_server_fields(actual, self.current)
        self.assertIn('另一方向', actual['aiReportByTopic'])

    def test_latest_server_generation_survives_late_full_snapshot(self):
        latest = graph(self.now, '服务器刚保存的新图')
        state = {'PROJECTS': {'p': {'topic': TOPIC}}, 'REPORTSTATE': {'p': latest}}
        actual = self.route(state, {'PROJECTS': state['PROJECTS'], 'REPORTSTATE': {'p': self.current}})
        self.assert_server_fields(actual['REPORTSTATE']['p'], latest)

    def test_guard_then_real_route_ignores_forged_null_nodes_for_member_and_admin(self):
        for actor in (principal(), ADMIN):
            with self.subTest(scope=actor['scope']):
                state = fixture()
                state['REPORTSTATE']['a_child'] = copy.deepcopy(self.current)
                fake = copy.deepcopy(self.incoming)
                fake['chainByTopic'][TOPIC][1]['nodes'] = [None, {
                    'name': '伪造已落地强势企业', 'level': 'strong',
                    'sources': [{'quote': '保证采购', 'sourceReportId': 'rrforeign',
                                 'AUTH_SESSIONS': {'not': 'a real session'}}]}]
                fake['chainErrorByTopic'] = {TOPIC: {'sourceReportId': 'rrforeign'}}
                fake['score'] = 81
                payload = {'PROJECTS': {'a_child': state['PROJECTS']['a_child']},
                           'REPORTSTATE': {'a_child': fake}, 'RESET_GEN': state['RESET_GEN']}
                actual = self.route(state, payload, actor)
                self.assert_server_fields(actual['REPORTSTATE']['a_child'], self.current)
                self.assertEqual(actual['REPORTSTATE']['a_child']['score'], 81)
                self.assertEqual(actual['REPORTSTATE']['b'], state['REPORTSTATE']['b'])
                self.assertNotIn('伪造已落地强势企业', json.dumps(actual, ensure_ascii=False))

    def test_guard_drops_graph_fields_from_new_records_and_top_level(self):
        for actor in (principal(), ADMIN):
            with self.subTest(scope=actor['scope']):
                state = fixture()
                payload = {'PROJECTS': {'new': {'city': '同名市', 'workspaceId': 'a'}},
                           'REPORTSTATE': {'new': dict(self.incoming)},
                           'RESET_GEN': state['RESET_GEN']}
                payload.update(dict.fromkeys(_CHAIN_MAPS, {'forged': True}))
                actual = self.route(state, payload, actor)
                self.assertFalse(set(_CHAIN_MAPS) & set(actual['REPORTSTATE']['new']))
                self.assertFalse(set(_CHAIN_MAPS) & set(actual))

    def test_authorized_full_snapshot_echo_remains_successful(self):
        for actor in (principal(), ADMIN):
            with self.subTest(scope=actor['scope']):
                state = fixture()
                state['REPORTSTATE']['a_child'] = copy.deepcopy(self.current)
                payload = {'PROJECTS': scoped_sync_view(state, actor)['PROJECTS'],
                           'REPORTSTATE': scoped_sync_view(state, actor)['REPORTSTATE'],
                           'RESET_GEN': state['RESET_GEN']}
                actual = self.route(state, payload, actor)
                self.assert_server_fields(actual['REPORTSTATE']['a_child'], self.current)

    def test_foreign_workspace_authorization_is_still_enforced(self):
        state = fixture()
        with self.assertRaises(AuthError):
            guard_sync(json.dumps({'REPORTSTATE': {'b': self.incoming}}).encode(), state, principal())

    def test_project_tombstone_still_removes_report_and_graph(self):
        state = fixture()
        state['REPORTSTATE']['a_child'] = copy.deepcopy(self.current)
        actual = self.route(state, {'DELETED_PROJECTS': ['a_child'],
                                   'PROJECTS': {'a_child': state['PROJECTS']['a_child']},
                                   'REPORTSTATE': {'a_child': self.incoming},
                                   'RESET_GEN': state['RESET_GEN']}, principal())
        self.assertNotIn('a_child', actual['PROJECTS'])
        self.assertNotIn('a_child', actual['REPORTSTATE'])
        self.assertEqual(actual['REPORTSTATE']['b'], state['REPORTSTATE']['b'])

    def test_source_identity_remains_legacy_metadata_only(self):
        project = {'topic': TOPIC, 'onboarding': {'count': 1.0, 'label': '材料'}}
        incoming = copy.deepcopy(self.incoming)
        incoming['chainEvidenceByTopic'][TOPIC]['sourceIdentity'] = identity({'p': project}, incoming)
        self.assertTrue(_chain_source_matches(incoming['chainEvidenceByTopic'][TOPIC], TOPIC,
                                              incoming, {'p': project}, 'p'))
        actual = _merge_map({'p': self.current}, {'p': incoming}, chain_projects={'p': project})['p']
        self.assert_server_fields(actual, self.current)

    def test_unrelated_merge_behavior_remains(self):
        actual = _merge_map({'p': {'text': 'long report', 'stage': 3, 'customStages': ['a']}},
                            {'p': {'text': 'x', 'stage': 1, 'customStages': ['b']}})['p']
        self.assertEqual(actual, {'text': 'long report', 'stage': 3, 'customStages': ['a', 'b']})


if __name__ == '__main__':
    unittest.main()
