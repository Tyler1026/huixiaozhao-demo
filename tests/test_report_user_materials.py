"""Saved user materials survive city-report handoff and worker scoping."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace

from backend.kb_edits import save_edit
from backend.sync_transaction import file_session
from report_service.full_context import scoped_prior, scoring_prior_batches
from report_service.full_provider import FullLiveProvider
from report_service.full_store import FullStore
from report_service.user_materials import (CONTEXT_KEY, MaterialsPendingRepair,
                                           prompt_context, select, snapshot, validate_snapshot)
from report_service.website_queue import WebsiteQueue, _replace_base_topics


def state():
    return {'RESET_GEN': 'test', 'PROJECTS': {'p': {
        'city': '离线测试市', 'workspaceId': 'p', 'topic': '半导体',
        'onboarding': {'industry': ['半导体'], '__custom': {'task': '优先核验用户纠正'}},
        'baseReportVersion': {'requestId': 'old'},
        'kb': [{'t': '主导产业与产业链', 'known': [
            {'text': '半导体园区2025年产值10亿元。', 'nature': 'base', 'origin': 'report'}]}]},
        'other': {'city': '其他市', 'workspaceId': 'other',
                  'kb': [{'t': '秘密', 'known': ['OTHER_WORKSPACE_SECRET']}]}}}


def corrected():
    s = state()
    save_edit({'projectKey': 'p', 'sectionIndex': 0, 'sectionTitle': '主导产业与产业链',
               'sourceIndex': 0, 'sourceItem': copy.deepcopy(s['PROJECTS']['p']['kb'][0]['known'][0]),
               'baseReportVersion': {'requestId': 'old'}, 'editId': None, 'expectedRevision': 0,
               'resetGen': 'test', 'text': '该园区产值更正为28亿元，白鹭842，尚待核验。'},
              s, {'scope': 'admin', 'user': 'offline'}, now_ms=1000)
    s['UPLOADS'] = {'p': [{'name': '材料.txt', 'originalId': 'file-one', 'projectKey': 'p'}]}
    s['KB_FILE_CHUNKS'] = {'p': [{'text': '半导体上传材料的尾部纠正：批准用地93亩。',
                                'originalId': 'file-one', 'cite': '材料.txt'}]}
    return s


class ReportUserMaterialsTests(unittest.TestCase):
    def test_snapshot_keeps_edits_uploads_preferences_without_other_workspace(self):
        value = snapshot(corrected(), {'projectKey': 'p', 'city': '离线测试市'})
        text = json.dumps(value, ensure_ascii=False)
        self.assertIn('白鹭842', text)
        self.assertIn('批准用地93亩', text)
        self.assertIn('优先核验用户纠正', text)
        self.assertNotIn('OTHER_WORKSPACE_SECRET', text)
        self.assertTrue(all(row['status'] == 'unverified' for row in value['records']))

    def test_snapshot_is_durable_and_retry_does_not_replace_original_inputs(self):
        first = snapshot(corrected(), {'projectKey': 'p', 'city': '离线测试市'})
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'jobs.db'
            store = FullStore(path, stages=[{'id': 'one', 'parts': ['one']}])
            report = store.create('t', '测试省', '离线测试市', 'key', False, input_context=first)
            changed = copy.deepcopy(first)
            changed['records'][0]['text'] = 'LATER_EDIT'
            store.create('t', '测试省', '离线测试市', 'key', False, input_context=changed)
            reopened = FullStore(path, stages=[{'id': 'one', 'parts': ['one']}])
            job = reopened.claim(synthetic=False)
            self.assertEqual(job['report_id'], report['id'])
            self.assertEqual(job['input_context'], first)
            self.assertNotIn('LATER_EDIT', json.dumps(job))

    def test_real_queue_hands_workspace_snapshot_to_durable_store(self):
        s = corrected()
        s['REPORT_REQUESTS'] = [{'id': 'rrmaterials', 'projectKey': 'p', 'city': '离线测试市',
                                 'province': '测试省', 'status': 'pending'}]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'state.json'
            path.write_text(json.dumps(s))
            store = FullStore(Path(folder) / 'jobs.db', stages=[{'id': 'one', 'parts': ['one']}])
            WebsiteQueue(store, lambda: file_session(str(path), lambda: None)).ingest()
            job = store.claim(synthetic=False)
            self.assertIn('白鹭842', json.dumps(job['input_context'], ensure_ascii=False))
            self.assertEqual(json.loads(path.read_text())['REPORT_REQUESTS'][0]['status'], 'running')

    def test_queue_waits_for_repair_without_blocking_other_workspaces(self):
        s = corrected()
        original_id = 'a' * 32
        s['UPLOADS']['p'][0]['originalId'] = original_id
        s['UPLOADS']['p'][0]['chunkRepair'] = {'version': 2, 'status': 'running',
                                              'leaseUntil': 9999999999999}
        s['KB_FILE_CHUNKS']['p'][0].update(originalId=original_id, text='旧的短片段')
        s['REPORT_REQUESTS'] = [
            {'id': 'rrwaiting', 'projectKey': 'p', 'city': '离线测试市',
             'province': '测试省', 'status': 'pending'},
            {'id': 'rrother', 'projectKey': 'other', 'city': '其他市',
             'province': '测试省', 'status': 'pending'}]
        with self.assertRaises(MaterialsPendingRepair):
            snapshot(s, s['REPORT_REQUESTS'][0])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'state.json'
            path.write_text(json.dumps(s))
            store = FullStore(Path(folder) / 'jobs.db', stages=[{'id': 'one', 'parts': ['one']}])
            queue = WebsiteQueue(store, lambda: file_session(str(path), lambda: None))
            queue.ingest()
            saved = json.loads(path.read_text())
            self.assertEqual(saved['REPORT_REQUESTS'][0]['status'], 'pending')
            self.assertIn('补全历史上传材料', saved['REPORT_REQUESTS'][0]['step'])
            self.assertEqual(saved['REPORT_REQUESTS'][1]['status'], 'running')
            self.assertEqual(store.claim(synthetic=False)['city'], '其他市')
            self.assertIsNone(store.claim(synthetic=False))
            saved['UPLOADS']['p'][0].update(chunkVersion=2,
                                          chunkRepair={'version': 2, 'status': 'ready'})
            saved['KB_FILE_CHUNKS']['p'][0]['text'] = '修复后完整尾部：批准用地93亩。'
            path.write_text(json.dumps(saved))
            queue.ingest()
            job = store.claim(synthetic=False)
            self.assertEqual(job['city'], '离线测试市')
            self.assertIn('批准用地93亩', json.dumps(job['input_context'], ensure_ascii=False))
            self.assertNotIn('旧的短片段', json.dumps(job['input_context'], ensure_ascii=False))
            self.assertEqual(json.loads(path.read_text())['REPORT_REQUESTS'][0]['status'], 'running')

    def test_failed_repair_and_text_only_legacy_uploads_do_not_wait_forever(self):
        s = corrected()
        upload = s['UPLOADS']['p'][0]
        upload.update(originalId='b' * 32, chunkRepair={'version': 2, 'status': 'failed'})
        self.assertIsNotNone(snapshot(s, {'projectKey': 'p', 'city': '离线测试市'}))
        upload.pop('originalId')
        upload.pop('chunkRepair')
        self.assertIsNotNone(snapshot(s, {'projectKey': 'p', 'city': '离线测试市'}))

    def test_long_saved_note_is_fully_segmented_before_prompt_selection(self):
        s = state()
        original = '半导体资料。' * 600 + '批准用地93亩，尾部材料937。'
        s['PROJECTS']['p']['kb'][0]['known'].append({'text': original, 'origin': 'user'})
        value = snapshot(s, {'projectKey': 'p', 'city': '离线测试市'})
        self.assertIn('尾部材料937', ''.join(row['text'] for row in value['records']))
        self.assertTrue(all(len(row['text']) <= 600 for row in value['records']))

    def test_all_worker_scopes_keep_explicit_unverified_user_context(self):
        value = snapshot(corrected(), {'projectKey': 'p', 'city': '离线测试市'})
        context = prompt_context(select(value, 'fact_check', '经济关键数字'))
        prior = {CONTEXT_KEY: context}
        provider = FullLiveProvider(SimpleNamespace(enabled=True))
        for stage, part in [('economy', '经济总量'), ('fact_check', '经济关键数字'),
                            ('action', '行动清单'), ('summary', '执行摘要'),
                            ('compact', '精简报告'), ('scoring', '评分维度与权重')]:
            with self.subTest(stage=stage):
                self.assertIn(CONTEXT_KEY, scoped_prior(prior, stage, part))
                text = provider._render_prior(prior, stage, part)
                self.assertIn('白鹭842', text)
                self.assertIn('待核陈述', text)
        for batch in scoring_prior_batches(prior, '评分维度与权重'):
            self.assertIn(CONTEXT_KEY, batch)

    def test_large_original_context_cannot_crowd_out_short_correction(self):
        s = state()
        source = s['PROJECTS']['p']['kb'][0]['known'][0]
        source['text'] = '项目原始背景。' * 6000
        save_edit({'projectKey': 'p', 'sectionIndex': 0, 'sectionTitle': '主导产业与产业链',
                   'sourceIndex': 0, 'sourceItem': copy.deepcopy(source),
                   'baseReportVersion': {'requestId': 'old'}, 'editId': None, 'expectedRevision': 0,
                   'resetGen': 'test', 'text': '该项目已终止，不能继续推荐。'},
                  s, {'scope': 'admin', 'user': 'offline'}, now_ms=1000)
        value = snapshot(s, {'projectKey': 'p', 'city': '离线测试市'})
        self.assertEqual(value['records'][0]['correction']['sourceText'], source['text'])
        selected = select(value, 'industry', '产业方向')
        self.assertEqual(selected['records'][0]['text'], '该项目已终止，不能继续推荐。')
        self.assertTrue(selected['records'][0]['correction']['sourceTextTruncated'])
        self.assertLessEqual(len(selected['records'][0]['correction']['sourceText']), 4000)

    def test_snapshot_without_fingerprint_is_rejected_before_queueing(self):
        value = snapshot(corrected(), {'projectKey': 'p', 'city': '离线测试市'})
        del value['fingerprint']
        with self.assertRaises(ValueError):
            validate_snapshot(value)

    def test_monthly_publication_preserves_legacy_admin_annotations(self):
        old = [{'t': '产业', 'known': [{'nature': 'base', 'text': '旧基础事实',
                'annotations': [{'text': '用户补充28亿元', 'src': '原件.txt', 'nature': 'fix'}]}]}]
        new = [{'t': '产业', 'known': [{'nature': 'base', 'text': '新基础事实'}],
                'icon': '', 'sub': '', 'tag': '', 'calls': []}]
        result = _replace_base_topics(old, new)
        self.assertEqual(len(result[0]['known']), 2)
        self.assertEqual(result[0]['known'][1]['text'], '用户补充28亿元')
        self.assertEqual(_replace_base_topics(result, new), result)

    def test_corrupt_snapshot_fails_one_job_without_blocking_the_queue(self):
        value = snapshot(corrected(), {'projectKey': 'p', 'city': '离线测试市'})
        with tempfile.TemporaryDirectory() as folder:
            store = FullStore(Path(folder) / 'jobs.db', stages=[{'id': 'one', 'parts': ['one']}])
            bad = store.create('t', '省', '离线测试市', 'bad', False, input_context=value)
            # A retained same-city pause deliberately blocks other v1 jobs.
            # The unrelated tenant still progresses without the corrupt job.
            good = store.create('other-tenant', '省', '离线测试市', 'good', False, input_context=value)
            with store.db() as c:
                c.execute('UPDATE full_input_context SET payload=? WHERE report_id=?', ('corrupt', bad['id']))
            self.assertEqual(store.claim(synthetic=False)['report_id'], good['id'])
            self.assertEqual(store.get('t', bad['id'])['status'], 'paused')
            self.assertEqual(store.get('t', bad['id'])['failure_code'], 'artifact')


if __name__ == '__main__':
    unittest.main()
