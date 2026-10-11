"""Real sync-route regression for a versioned graph cache, no model calls."""
import copy
import io
import json
import time
import unittest
from unittest.mock import Mock

from backend.sync_merge import _merge_map
from backend.sync_route import SyncDependencies, handle_sync

TOPIC = '核电换热设备'
TEXT = '已保存完整报告正文'


def identity(projects, report, topic=TOPIC, key='p'):
    project=projects[key];root=project.get('workspaceId') or key
    keys=[key] if root==key else [root,key]
    return json.dumps({'workspace':root,'city':project.get('city') or '', 'topic':topic,
        'selectedTopic':project.get('topic') or '', 'requestId':project.get('reportRequestId') or report.get('reportRequestId') or '',
        'kb':[(projects.get(k) or {}).get('kb') or [] for k in keys], 'onboarding':project.get('onboarding') or {},
        'report':(report.get('aiReportByTopic') or {}).get(topic) or (report.get('text') if report.get('topic')==topic else '') or ''},ensure_ascii=False)


def graph(version, name='核级换热器', topic=TOPIC, text=TEXT):
    return {
        'topic': topic, 'text': text, 'ts': 100,
        'aiReportByTopic': {topic: text},
        'chainByTopic': {topic: [{'seg': s, 'nodes': ([{'name': name}] if s == '中游' and name else [])}
                                for s in ('上游', '中游', '下游')]},
        'chainEvidenceByTopic': {topic: {'contract': 'saved-excerpts-v1', 'scope': 'current-topic-v1',
                                       'topic': topic, 'generatedAt': version, 'reportText': text,
                                       'requestId': '', 'sourceIdentity': identity({'p': {'topic': topic}}, {'topic':topic,'text':text},topic)}},
        'chainStatusByTopic': {topic: 'ready'},
    }


class ChainCacheSyncTests(unittest.TestCase):
    def setUp(self):
        self.now = int(time.time() * 1000)
        self.old = graph(self.now - 20, '旧图')
        self.new = graph(self.now - 10, '新图')

    def merge(self, old, new):
        return _merge_map({'p': copy.deepcopy(old)}, {'p': copy.deepcopy(new)}, chain_projects={'p': {'topic':new.get('topic') or old.get('topic') or TOPIC}})['p']

    def route(self, stored, incoming):
        writes = []
        deps = SyncDependencies(True, lambda: json.dumps(stored), lambda value: writes.append(value) or True,
                                'unused', lambda: None, lambda value: value)
        responder = Mock()
        responder.wfile = io.BytesIO()
        handle_sync(responder, json.dumps(incoming).encode(), deps)
        self.assertTrue(json.loads(responder.wfile.getvalue())['ok'])
        return json.loads(writes[-1])

    def test_route_same_report_timestamp_new_graph_survives_late_old_nonempty_snapshot(self):
        state = {'PROJECTS': {'p': {'topic': TOPIC}}, 'REPORTSTATE': {'p': self.old}}
        state = self.route(state, {'PROJECTS': {'p': {'topic': TOPIC}}, 'REPORTSTATE': {'p': self.new}})
        state = self.route(state, {'PROJECTS': {'p': {'topic': TOPIC}}, 'REPORTSTATE': {'p': self.old}})
        self.assertEqual(state['REPORTSTATE']['p'], self.new)

    def test_route_absent_graph_or_empty_maps_do_not_erase_saved_bundle(self):
        for incoming in [{'ts': 100}, {'ts': 100, 'chainByTopic': {}, 'chainEvidenceByTopic': {}, 'chainStatusByTopic': {}}]:
            state = self.route({'PROJECTS': {'p': {}}, 'REPORTSTATE': {'p': self.new}},
                               {'PROJECTS': {'p': {}}, 'REPORTSTATE': {'p': incoming}})
            self.assertEqual(state['REPORTSTATE']['p'], self.new)

    def test_equal_version_conflict_keeps_complete_server_bundle(self):
        incoming = graph(self.now - 10, '不同图')
        incoming['chainStatusByTopic'][TOPIC] = 'ready'
        self.assertEqual(self.merge(self.new, incoming), self.new)

    def test_legacy_or_partial_maps_cannot_replace_any_new_field(self):
        mutations = [lambda x: x['chainEvidenceByTopic'][TOPIC].pop('generatedAt'),
                     lambda x: x['chainEvidenceByTopic'][TOPIC].pop('topic'),
                     lambda x: x['chainEvidenceByTopic'][TOPIC].update(scope='workspace'),
                     lambda x: x.pop('chainEvidenceByTopic'),
                     lambda x: x.pop('chainByTopic'),
                     lambda x: x['chainStatusByTopic'].update({TOPIC: 'loading'})]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                incoming = graph(self.now, '不完整图')
                mutate(incoming)
                result = self.merge(self.new, incoming)
                for key in ('chainByTopic', 'chainEvidenceByTopic', 'chainStatusByTopic'):
                    self.assertEqual(result[key], self.new[key])

    def test_invalid_versions_are_not_accepted(self):
        for value in [None, 0, -1, True, float('nan'), float('inf'), '1', self.now + 600000]:
            with self.subTest(value=value):
                incoming = graph(value, '不合法版本')
                self.assertEqual(self.merge(self.new, incoming), self.new)

    def test_different_body_or_topic_cannot_claim_existing_report(self):
        incoming = graph(self.now)
        incoming['chainEvidenceByTopic'][TOPIC]['reportText'] = '另一个正文'
        self.assertEqual(self.merge(self.new, incoming), self.new)
        incoming = graph(self.now)
        incoming['chainEvidenceByTopic'][TOPIC]['topic'] = '另一方向'
        self.assertEqual(self.merge(self.new, incoming), self.new)

    def test_valid_three_empty_groups_are_saved(self):
        incoming = graph(self.now, '')
        result = self.merge(self.old, incoming)
        self.assertEqual(result, incoming)
        self.assertEqual([s['nodes'] for s in result['chainByTopic'][TOPIC]], [[], [], []])

    def test_other_topic_graphs_are_preserved_independently(self):
        other = graph(self.now, '另一方向环节', topic='其他方向', text='另一个报告')
        incoming = copy.deepcopy(other)
        incoming['aiReportByTopic'] = {TOPIC: TEXT, '其他方向': '另一个报告'}
        result = self.merge(self.new, incoming)
        for key in ('chainByTopic', 'chainEvidenceByTopic', 'chainStatusByTopic'):
            self.assertEqual(result[key][TOPIC], self.new[key][TOPIC])
            self.assertEqual(result[key]['其他方向'], other[key]['其他方向'])
        stale = graph(self.now - 1, '落后其他图', topic='其他方向', text='另一个报告')
        stale['aiReportByTopic'] = dict(result['aiReportByTopic'])
        late = self.merge(result, stale)
        for key in ('chainByTopic', 'chainEvidenceByTopic', 'chainStatusByTopic'):
            self.assertEqual(late[key], result[key])

    def test_graph_does_not_create_missing_topic_body(self):
        incoming = graph(self.now)
        incoming.pop('aiReportByTopic')
        incoming.pop('text')
        incoming.pop('topic')
        result = self.merge({'aiReportByTopic': {'other': '另一个正文'}}, incoming)
        self.assertNotIn(TOPIC, result.get('chainByTopic', {}))
        self.assertNotIn(TOPIC, result['aiReportByTopic'])

    def test_project_tombstone_still_removes_report_and_cache(self):
        result = self.route({'PROJECTS': {'p': {'topic': TOPIC}}, 'REPORTSTATE': {'p': self.new}},
                            {'PROJECTS': {'p': {'topic': TOPIC}}, 'REPORTSTATE': {'p': self.new}, 'DELETED_PROJECTS': ['p']})
        self.assertNotIn('p', result.get('PROJECTS', {}))
        self.assertNotIn('p', result.get('REPORTSTATE', {}))

    def test_member_partial_save_keeps_auth_scope_and_other_city_workspace(self):
        from backend.access_control import guard_sync
        from test_access_control import fixture, principal
        from backend.auth import AuthError
        state = fixture()
        state['PROJECTS']['a_child'].update(topic=TOPIC, reportRequestId='rrstate')
        state['REPORTSTATE']['a_child'] = graph(self.now - 20)
        for current in (state['REPORTSTATE']['a_child'],):
            current['chainEvidenceByTopic'][TOPIC]['requestId'] = 'rrstate'
            current['chainEvidenceByTopic'][TOPIC]['sourceIdentity'] = identity(state['PROJECTS'], current, key='a_child')
        incoming = graph(self.now - 10)
        incoming['chainEvidenceByTopic'][TOPIC]['requestId'] = 'rrstate'
        incoming['chainEvidenceByTopic'][TOPIC]['sourceIdentity'] = identity(state['PROJECTS'], incoming, key='a_child')
        delta = {'RESET_GEN': state.get('RESET_GEN'), 'clientUser': 'alice', 'PROJECTS': {'a_child': {'id': 'a_child', 'workspaceId': 'a', 'city': '同名市', 'isDemand': True}},
                 'REPORTSTATE': {'a_child': {key: incoming[key] for key in ('chainByTopic', 'chainEvidenceByTopic', 'chainStatusByTopic')}}}
        authorized = json.loads(guard_sync(json.dumps(delta).encode(), state, principal()))
        final = self.route(state, authorized)
        self.assertEqual(final['REPORTSTATE']['a_child']['chainEvidenceByTopic'][TOPIC]['generatedAt'], self.now - 10)
        self.assertEqual(final['PROJECTS']['b'], state['PROJECTS']['b'])
        self.assertEqual(final['REPORTSTATE']['b'], state['REPORTSTATE']['b'])
        foreign = copy.deepcopy(delta)
        foreign['PROJECTS'] = {'b': {'id': 'b', 'workspaceId': 'b'}}
        foreign['REPORTSTATE'] = {'b': foreign['REPORTSTATE']['a_child']}
        with self.assertRaises(AuthError):
            guard_sync(json.dumps(foreign).encode(), state, principal())

    def test_new_record_does_not_accept_unbacked_graph_or_future_version(self):
        for bad in (graph(self.now + 600000), {'chainByTopic': graph(self.now)['chainByTopic']}):
            result = _merge_map({}, {'p': bad})['p']
            self.assertNotIn('chainByTopic', result)

    def test_final_project_materials_are_used_in_either_json_field_order(self):
        old_project = {'id': 'p', 'topic': TOPIC, 'kb': [{'known': ['old material']}]}
        new_project = {'id': 'p', 'topic': TOPIC, 'kb': [{'known': ['new material']}]}
        base = copy.deepcopy(self.old)
        base['chainEvidenceByTopic'][TOPIC]['sourceIdentity'] = identity({'p': old_project}, base)
        fresh = copy.deepcopy(self.new)
        fresh['chainEvidenceByTopic'][TOPIC]['sourceIdentity'] = identity({'p': new_project}, fresh)
        state = {'PROJECTS': {'p': old_project}, 'REPORTSTATE': {'p': base}}
        results = []
        for keys in [('PROJECTS', 'REPORTSTATE'), ('REPORTSTATE', 'PROJECTS')]:
            data = {'PROJECTS': {'p': new_project}, 'REPORTSTATE': {'p': fresh}}
            result = self.route(state, {key: data[key] for key in keys})
            results.append(result)
            self.assertEqual(result['REPORTSTATE']['p']['chainByTopic'], fresh['chainByTopic'])
        self.assertEqual(results[0], results[1])

    def test_newer_version_with_old_root_material_or_request_is_rejected(self):
        project = {'id': 'p', 'topic': TOPIC, 'workspaceId': 'root', 'reportRequestId': 'r1'}
        projects = {'p': project, 'root': {'kb': [{'known': ['current root source']}]}}
        current = copy.deepcopy(self.old)
        current['chainEvidenceByTopic'][TOPIC].update(requestId='r1', sourceIdentity=identity(projects, current))
        for change in ('root', 'request'):
            outdated = copy.deepcopy(projects)
            if change == 'root':
                outdated['root']['kb'] = [{'known': ['old root source']}]
            else:
                outdated['p']['reportRequestId'] = 'old-request'
            incoming = copy.deepcopy(self.new)
            incoming['chainEvidenceByTopic'][TOPIC].update(requestId=outdated['p']['reportRequestId'], sourceIdentity=identity(outdated, incoming))
            result = self.route({'PROJECTS': projects, 'REPORTSTATE': {'p': current}},
                                {'PROJECTS': {'p': {'id': 'p'}}, 'REPORTSTATE': {'p': incoming}})
            self.assertEqual(result['REPORTSTATE']['p']['chainByTopic'], current['chainByTopic'])

    def test_identity_uses_json_values_not_key_order_unicode_or_number_spelling(self):
        project = {'topic': TOPIC, 'onboarding': {'count': 1.0, 'label': '材料'}}
        current = copy.deepcopy(self.old)
        fresh = copy.deepcopy(self.new)
        parsed = json.loads(identity({'p': project}, fresh))
        parsed['onboarding']['count'] = 1
        fresh['chainEvidenceByTopic'][TOPIC]['sourceIdentity'] = json.dumps(dict(reversed(list(parsed.items()))), ensure_ascii=True)
        result = _merge_map({'p': current}, {'p': fresh}, chain_projects={'p': project})['p']
        self.assertEqual(result['chainByTopic'], fresh['chainByTopic'])
        for invalid in ('true', '[]', 'null', '{"x":NaN}', json.dumps(dict(parsed, onboarding={'count': True, 'label': '材料'}))):
            bad = copy.deepcopy(fresh)
            bad['chainEvidenceByTopic'][TOPIC]['sourceIdentity'] = invalid
            bad['chainEvidenceByTopic'][TOPIC]['generatedAt'] += 1
            rejected = _merge_map({'p': result}, {'p': bad}, chain_projects={'p': project})['p']
            self.assertEqual(rejected['chainByTopic'], result['chainByTopic'])

    def test_malformed_source_context_rejects_without_breaking_merge(self):
        from backend.sync_merge import _chain_source_matches
        meta = self.new['chainEvidenceByTopic'][TOPIC]
        for report, projects in [({'aiReportByTopic': ['bad']}, {'p': {'topic': TOPIC}}),
                                 (self.new, {'p': {'workspaceId': 'root'}, 'root': ['bad']}),
                                 (self.new, {'p': {'workspaceId': ['bad']}})]:
            self.assertFalse(_chain_source_matches(meta, TOPIC, report, projects, 'p'))
        project = {'topic': TOPIC, 'onboarding': {'large': 10 ** 400}}
        current = copy.deepcopy(self.new)
        current['chainEvidenceByTopic'][TOPIC]['sourceIdentity'] = identity({'p': project}, current)
        self.assertTrue(_chain_source_matches(current['chainEvidenceByTopic'][TOPIC], TOPIC, current, {'p': project}, 'p'))
        data = json.loads(current['chainEvidenceByTopic'][TOPIC]['sourceIdentity'])
        data['onboarding']['large'] = float('inf')
        current['chainEvidenceByTopic'][TOPIC]['sourceIdentity'] = json.dumps(data)
        self.assertFalse(_chain_source_matches(current['chainEvidenceByTopic'][TOPIC], TOPIC, current, {'p': project}, 'p'))

    def test_unrelated_merge_behavior_remains(self):
        result = _merge_map({'p': {'text': 'long report', 'stage': 3, 'customStages': ['a']}},
                            {'p': {'text': 'x', 'stage': 1, 'customStages': ['b']}})['p']
        self.assertEqual(result, {'text': 'long report', 'stage': 3, 'customStages': ['a', 'b']})

if __name__ == '__main__':
    unittest.main()
