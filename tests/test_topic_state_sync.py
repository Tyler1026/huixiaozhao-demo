"""Memory-only reproduction of cross-tab reports and direction lifecycles."""
import copy
import io
import json
import unittest
from unittest.mock import Mock

from backend.sync_route import SyncDependencies, handle_sync
from backend.sync_merge import _REPORT_MAPS

A, B, KEY = '合成测试方向甲', '合成测试方向乙', 'isolated-audit-workspace'


def report(topic=A, ts=100, phase=1):
    text = topic + ('完整报告' if phase == 2 else '新草稿')
    return {'topic': topic, 'text': text, 'phase': phase, 'ts': ts,
            'aiReportByTopic': {topic: text}, 'phaseByTopic': {topic: phase}, 'tsByTopic': {topic: ts},
            'pendingByTopic': {topic: [{'text': '合成待确认条件', 'status': 'pending'}]},
            'researchByTopic': {topic: {'runId': str(ts), 'analysis': {'status': 'evidence_only'}}},
            'materialDirectoryByTopic': {topic: {'version': ts}},
            'evidenceStatusByTopic': {topic: 'unreviewed'}, 'scoreByTopic': {topic: None}}


def snapshot(state=None):
    return {'PROJECTS': {KEY: {'city': '合成验收市', 'topic': A, 'customTopics': [A, B],
                              'stageByTopic': {A: 3, B: 2}, 'stage': 3}},
            'REPORTSTATE': {KEY: state or report()}, 'REPORT_HISTORY': {KEY: []}}


def sync(existing, incoming):
    before = copy.deepcopy(existing)
    writes = []
    deps = SyncDependencies(True, lambda: json.dumps(existing, ensure_ascii=False),
                            lambda value: writes.append(value) or True, 'unused', lambda: None, lambda x: x)
    responder = Mock(); responder.wfile = io.BytesIO()
    handle_sync(responder, json.dumps(incoming, ensure_ascii=False).encode(), deps)
    assert json.loads(responder.wfile.getvalue())['ok'] is True
    assert existing == before
    return json.loads(writes[-1])


class TopicStateSyncTests(unittest.TestCase):
    def test_real_repro_stale_tab_b_does_not_replace_newer_a_bundle(self):
        base = snapshot(); tab_a, tab_b = copy.deepcopy(base), copy.deepcopy(base)
        tab_a['REPORTSTATE'][KEY] = report(A, 300, 2)
        tab_a['REPORTSTATE'][KEY]['pendingByTopic'][A][0]['status'] = 'confirmed'
        other = report(B, 400, 2)
        tab_b['REPORTSTATE'][KEY].update(topic=B, text=other['text'], ts=400, phase=2)
        for field in _REPORT_MAPS + ('pendingByTopic',):
            tab_b['REPORTSTATE'][KEY].setdefault(field, {}).update(other.get(field, {}))
        saved = sync(sync(base, tab_a), tab_b)['REPORTSTATE'][KEY]
        for field in _REPORT_MAPS + ('pendingByTopic',):
            if field in tab_a['REPORTSTATE'][KEY]:
                self.assertEqual(saved[field][A], tab_a['REPORTSTATE'][KEY][field][A], field)
        self.assertEqual(saved['phaseByTopic'][B], 2)

    def test_newer_deliberate_draft_replaces_complete_report_even_when_shorter(self):
        saved = sync(snapshot(report(A, 300, 2)), snapshot(report(A, 500, 1)))['REPORTSTATE'][KEY]
        self.assertEqual(saved['phaseByTopic'][A], 1)
        self.assertEqual(saved['aiReportByTopic'][A], A+'新草稿')
        self.assertEqual(saved['researchByTopic'][A]['runId'], '500')

    def test_confirmation_edits_and_withdrawal_resist_stale_echo(self):
        original = snapshot(); edited = copy.deepcopy(original)
        rs = edited['REPORTSTATE'][KEY]
        rs['pendingByTopic'][A][0].update(status='edited', editedText='完整条件')
        rs['pendingRevisionByTopic'] = {A: 200}; rs['pendingReportTsByTopic'] = {A: 100}
        saved = sync(sync(original, edited), original)
        self.assertEqual(saved['REPORTSTATE'][KEY]['pendingByTopic'][A][0]['editedText'], '完整条件')
        withdrawn = copy.deepcopy(saved); wr = withdrawn['REPORTSTATE'][KEY]
        wr['pendingRevisionByTopic'][A] = 250; wr['pendingByTopic'][A][0]['status'] = 'pending'
        saved = sync(sync(saved, withdrawn), edited)
        self.assertEqual(saved['REPORTSTATE'][KEY]['pendingByTopic'][A][0]['status'], 'pending')
        self.assertEqual(saved['PENDING_CONFIRMS'][KEY][0]['status'], 'pending')

    def test_legacy_confirmation_writes_work_until_explicit_edit_versions_exist(self):
        before = snapshot(); legacy = copy.deepcopy(before)
        legacy['REPORTSTATE'][KEY]['pendingByTopic'][A][0]['status'] = 'confirmed'
        self.assertEqual(sync(before, legacy)['REPORTSTATE'][KEY]['pendingByTopic'][A][0]['status'], 'confirmed')

    def test_later_edit_of_an_old_report_cannot_change_new_report_confirmations(self):
        new = snapshot(report(A, 300, 2)); stale = snapshot()
        stale['REPORTSTATE'][KEY].update(pendingRevisionByTopic={A: 900}, pendingReportTsByTopic={A: 100})
        stale['REPORTSTATE'][KEY]['pendingByTopic'][A][0]['status'] = 'confirmed'
        saved = sync(new, stale)['REPORTSTATE'][KEY]
        self.assertEqual(saved['pendingByTopic'][A][0]['status'], 'pending')
        self.assertEqual(saved['tsByTopic'][A], 300)

    def test_delete_last_direction_clears_every_bucket_and_old_snapshots_stay_deleted(self):
        before = snapshot(report(A, 100, 2)); rs = before['REPORTSTATE'][KEY]
        rs['partialByTopic'] = {A: {'text': 'partial', 'ts': 150}}
        before['REPORT_HISTORY'][KEY] = [{'topic': A, 'ts': 100, 'text': 'old history'}]
        deleted = copy.deepcopy(before)
        deleted['PROJECTS'][KEY].update(topic='', customTopics=[], deletedTopics=[A], topicDeletedAt={A: 300})
        deleted['REPORTSTATE'][KEY] = {'topic': '', 'topicDeletedAt': {A: 300}}
        saved = sync(sync(before, deleted), before)
        state = saved['REPORTSTATE'][KEY]
        for field in _REPORT_MAPS + ('pendingByTopic', 'partialByTopic'):
            self.assertNotIn(A, state.get(field, {}), field)
        self.assertEqual(state['text'], '')
        self.assertEqual(saved['REPORT_HISTORY'][KEY], [])
        self.assertNotIn(A, saved['PROJECTS'][KEY]['stageByTopic'])
        self.assertNotIn(A, saved['PROJECTS'][KEY]['customTopics'])

    def test_readd_is_new_lifecycle_and_never_revives_the_deleted_report(self):
        before = snapshot(report(A, 100, 2))
        deleted = copy.deepcopy(before); deleted['PROJECTS'][KEY].update(topicDeletedAt={A: 300}, deletedTopics=[A])
        saved = sync(before, deleted)
        readded = copy.deepcopy(saved)
        readded['PROJECTS'][KEY].update(topic=A, customTopics=[A], deletedTopics=[], topicCreatedAt={A: 400}, stageByTopic={A: 2})
        saved = sync(sync(saved, readded), before)
        self.assertIn(A, saved['PROJECTS'][KEY]['customTopics'])
        self.assertEqual(saved['PROJECTS'][KEY]['stageByTopic'][A], 2)
        self.assertNotIn(A, saved['REPORTSTATE'][KEY]['aiReportByTopic'])
        fresh = copy.deepcopy(saved); fresh['REPORTSTATE'][KEY] = report(A, 500, 1)
        saved = sync(sync(saved, fresh), deleted)
        self.assertEqual(saved['REPORTSTATE'][KEY]['tsByTopic'][A], 500)

    def test_project_only_deletion_applies_to_report_and_pending_views(self):
        before = snapshot(report(A, 100, 2))
        saved = sync(before, {'PROJECTS': {KEY: {'city': '合成验收市', 'topicDeletedAt': {A: 200}, 'deletedTopics': [A]}}})
        self.assertNotIn(A, saved['REPORTSTATE'][KEY]['aiReportByTopic'])
        self.assertEqual(saved['PENDING_CONFIRMS'][KEY], [])

    def test_history_deletion_tombs_survive_stale_lists_and_empty_history(self):
        before = snapshot(); before['REPORT_HISTORY'][KEY] = [{'topic': A, 'ts': 50, 'text': 'history'}]
        deletion = copy.deepcopy(before); deletion['REPORT_HISTORY'][KEY] = []
        deletion['REPORTSTATE'][KEY]['historyDeletedAt'] = {A+'\0'+str(50): 200}
        saved = sync(sync(before, deletion), before)
        self.assertEqual(saved['REPORT_HISTORY'][KEY], [])

    def test_new_complete_report_removes_old_partial_and_keeps_analysis_metadata(self):
        before = snapshot(); before['REPORTSTATE'][KEY]['partialByTopic'] = {A: {'ts': 150, 'reportTs': 100, 'text': 'half'}}
        saved = sync(before, snapshot(report(A, 300, 2)))['REPORTSTATE'][KEY]
        self.assertNotIn(A, saved['partialByTopic'])
        self.assertEqual(saved['researchByTopic'][A]['analysis']['status'], 'evidence_only')

    def test_manual_finalize_survives_same_version_echo_but_new_draft_is_unlocked(self):
        before = snapshot(report(A, 300, 2)); finalized = copy.deepcopy(before)
        finalized['REPORTSTATE'][KEY]['finalized'] = True
        saved = sync(sync(before, finalized), before)
        self.assertTrue(saved['REPORTSTATE'][KEY]['finalized'])
        omitted = copy.deepcopy(before); omitted['REPORTSTATE'][KEY].pop('finalized', None)
        self.assertTrue(sync(saved, omitted)['REPORTSTATE'][KEY]['finalized'])
        self.assertFalse(sync(saved, snapshot(report(A, 500, 1)))['REPORTSTATE'][KEY]['finalized'])


if __name__ == '__main__':
    unittest.main()
