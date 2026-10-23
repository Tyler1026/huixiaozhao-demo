"""User corrections and originals remain scoped, retrievable and unverified."""
import copy
import json
import unittest

from backend.auth import AuthError
from backend.kb_context import (chat_request_context, chat_context, chat_sources,
                                saved_materials, material_retrieval_text)
from backend.kb_edits import effective_known, retained_corrections, save_edit
from backend.evidence_grounding import project_context, evidence_catalog
from backend.topic_evidence import topic_report_context, topic_evidence_prompt


KEY = 'local'
TOPIC = '聚变能源'
PRINCIPAL = {'scope': 'admin', 'user': 'reviewer'}


def fixture():
    return {'RESET_GEN': 'test', 'PROJECTS': {KEY: {
        'workspaceId': KEY, 'city': '测试市', 'topic': TOPIC,
        'baseReportVersion': {'requestId': 'base-1'},
        'kb': [{'t': '产业', 'known': [{'text': '聚变能源甲项目拟建设研发中心。',
                                      'origin': 'report', 'nature': 'base',
                                      'sourceFile': '产业原文.md'}]}]}},
        'REPORTSTATE': {KEY: {}}}


def edit(state, text='该项目已经终止。'):
    p = state['PROJECTS'][KEY]
    body = {'projectKey': KEY, 'sectionIndex': 0, 'sectionTitle': '产业',
            'baseReportVersion': copy.deepcopy(p['baseReportVersion']),
            'sourceIndex': 0, 'sourceItem': copy.deepcopy(p['kb'][0]['known'][0]),
            'editId': None, 'expectedRevision': 0, 'resetGen': 'test', 'text': text}
    return save_edit(body, state, PRINCIPAL, now_ms=1000)['record']


def context(state, **options):
    return topic_report_context({'projectKey': KEY, 'topic': TOPIC}, state, **options)


class MaterialMemoryTests(unittest.TestCase):
    def test_pronoun_correction_matches_original_subject_and_short_text(self):
        state = fixture()
        original = copy.deepcopy(state['PROJECTS'][KEY]['kb'][0]['known'][0])
        record = edit(state, '已终止')
        rows = context(state)['chunks']
        self.assertEqual([r['text'] for r in rows], ['已终止'])
        self.assertEqual(rows[0]['correction']['status'], 'active')
        self.assertEqual(rows[0]['correction']['sourceText'], original['text'])
        self.assertEqual(rows[0]['status'], 'unverified')
        self.assertEqual(rows[0]['sourceStatus'], 'user_correction_unverified')
        self.assertEqual(rows[0]['correction']['editId'], record['id'])
        self.assertEqual(state['PROJECTS'][KEY]['kb'][0]['known'][0], original)
        profile_rows = project_context({'projectKey': KEY, 'topic': TOPIC}, state)['chunks']
        self.assertEqual(evidence_catalog(profile_rows)[0]['quote'], '已终止')
        self.assertEqual(evidence_catalog(profile_rows)[0]['status'], 'pending')

    def test_old_linked_sources_cannot_crowd_out_relevant_correction(self):
        state = fixture()
        record = edit(state)
        state['PROJECTS'][KEY]['kb'][0]['known'] += [
            {'text': f'聚变能源原始来源{i}披露相关研发进展，尚需核实。',
             'url': f'https://authority.test/{i}', 'sourceFile': f'old-{i}.md'} for i in range(30)]
        rows = context(state)['chunks']
        self.assertEqual(len(rows), 16)
        self.assertEqual(rows[0]['correction']['editId'], record['id'])
        self.assertEqual(context(state, limit=1)['chunks'][0]['text'], record['text'])

    def test_long_old_source_context_cannot_crowd_out_short_new_correction(self):
        state = fixture()
        source = '历史背景。' * 12000 + '聚变能源甲项目拟建设。' + '历史备注。' * 500
        state['PROJECTS'][KEY]['kb'][0]['known'][0]['text'] = source
        edit(state)
        rows = context(state)['chunks']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['text'], '该项目已经终止。')
        self.assertIn('聚变能源', rows[0]['correction']['sourceText'])
        self.assertTrue(rows[0]['correction']['sourceTextTruncated'])
        self.assertEqual(rows[0]['correction']['sourceTextChars'], len(source))
        self.assertLessEqual(len(rows[0]['correction']['sourceText']), 4000)

    def test_unrelated_correction_does_not_enter_other_industry(self):
        state = fixture()
        edit(state)
        state['PROJECTS'][KEY]['topic'] = '生物医药'
        rows = topic_report_context({'projectKey': KEY, 'topic': '生物医药'}, state)['chunks']
        self.assertEqual(rows, [])

    def test_monthly_change_retains_independent_pending_correction(self):
        state = fixture()
        record = edit(state)
        old_source = copy.deepcopy(record['sourceItem'])
        state['PROJECTS'][KEY]['baseReportVersion'] = {'requestId': 'base-2'}
        new_source = {'text': '聚变能源甲项目新公告：状态仍需核实。', 'origin': 'report', 'nature': 'base'}
        state['PROJECTS'][KEY]['kb'][0]['known'] = [new_source]
        state['REPORTSTATE'][KEY] = {'aiReportByTopic': {TOPIC: '当前新报告正文。'}}
        rows = effective_known(state, KEY, 0)
        self.assertEqual(rows[0], new_source)
        correction = rows[1]
        self.assertEqual(correction['text'], record['text'])
        self.assertEqual(correction['_kbEditStatus'], 'needs_review')
        self.assertEqual(correction['correction']['sourceText'], old_source['text'])
        self.assertEqual(correction['correction']['sourceVersion'], {'requestId': 'base-1'})
        self.assertEqual(correction['correction']['reason'], 'base_version_changed')
        self.assertEqual(state['PROJECTS'][KEY]['kb'][0]['known'], [new_source])
        selected = context(state)['chunks']
        self.assertEqual(selected[0]['correction']['status'], 'needs_review')
        self.assertIn('needs_review', topic_evidence_prompt(context(state)))
        profile = project_context({'projectKey': KEY, 'topic': TOPIC}, state)
        self.assertIn('当前新报告正文。', [row['text'] for row in profile['chunks']])

    def test_missing_section_and_deleted_revision_have_explicit_behavior(self):
        state = fixture()
        record = edit(state)
        state['PROJECTS'][KEY]['kb'] = []
        self.assertEqual(saved_materials(state, KEY)[0]['correction']['status'], 'needs_review')
        self.assertEqual(context(state)['chunks'][0]['text'], record['text'])
        request = {'projectKey': KEY, 'sectionIndex': record['sectionIndex'],
                   'sectionTitle': record['sectionTitle'], 'sourceIndex': record['sourceIndex'],
                   'sourceItem': record['sourceItem'], 'baseReportVersion': record['baseReportVersion'],
                   'editId': record['id'], 'expectedRevision': record['revision'],
                   'resetGen': 'test', 'action': 'delete'}
        save_edit(request, state, PRINCIPAL, now_ms=2000)
        self.assertEqual(retained_corrections(state, KEY), [])
        self.assertEqual(context(state)['chunks'], [])

    def test_chat_uses_saved_scope_and_rejects_client_material_override(self):
        state = fixture()
        edit(state)
        state['PROJECTS']['foreign'] = {'city': '测试市', 'kb': [{'t': '产业', 'known': ['FOREIGN_SECRET']} ]}
        body = {'projectKey': KEY, 'topic': TOPIC, 'city': '伪造城市',
                'chunks': [{'text': 'CLIENT_STALE_OR_FORGED', 'origin': 'user'}]}
        actual = chat_request_context(body, state)
        self.assertEqual(actual['city'], '测试市')
        self.assertEqual(actual['projectKey'], KEY)
        self.assertNotIn('CLIENT_STALE_OR_FORGED', json.dumps(actual))
        self.assertNotIn('FOREIGN_SECRET', json.dumps(actual))
        self.assertIn('聚变能源甲项目', material_retrieval_text(actual['chunks'][0]))
        prompt = chat_context(chat_sources(actual['chunks']))
        self.assertIn('用户更正上下文', prompt)
        self.assertIn('已经终止', prompt)
        with self.assertRaises(AuthError):
            chat_request_context({'projectKey': 'not-accessible'}, state)
        for invalid_key in (0, False, [], {}):
            with self.subTest(projectKey=invalid_key), self.assertRaises(AuthError):
                chat_request_context({'projectKey': invalid_key, 'chunks': body['chunks']}, state)

    def test_keyless_chat_keeps_explicit_request_only_legacy_corpus(self):
        state = fixture()
        body = {'city': '旧客户端城市', 'chunks': [{'text': '仅本轮旧客户端输入'}]}
        actual = chat_request_context(body, state)
        self.assertEqual(actual['chunks'], body['chunks'])
        self.assertEqual(actual['city'], body['city'])
        self.assertEqual(actual['projectKey'], '')

    def test_profiles_and_chat_read_parent_uploads_with_original_provenance(self):
        state = fixture()
        state['PROJECTS']['child'] = {'workspaceId': KEY, 'city': '测试市', 'topic': TOPIC, 'kb': []}
        state['UPLOADS'] = {KEY: [{'name': '授权说明.txt', 'originalId': 'original-a',
                                  'originalSha256': 'a' * 64, 'projectKey': KEY}]}
        state['KB_FILE_CHUNKS'] = {KEY: [{'text': '聚变能源甲项目已停止建设，用户上传原文待核验。',
                                         'originalId': 'original-a', 'url': 'https://authority.test/a'}]}
        state['UPLOADS']['foreign'] = [{'name': 'foreign.txt', 'originalId': 'foreign'}]
        state['KB_FILE_CHUNKS']['foreign'] = [{'text': 'FOREIGN_UPLOAD', 'originalId': 'foreign'}]
        profile = project_context({'projectKey': 'child', 'topic': TOPIC}, state)
        upload = next(row for row in profile['chunks'] if row.get('originalId') == 'original-a')
        self.assertEqual(upload['sourceFile'], '授权说明.txt')
        self.assertEqual(upload['originalSha256'], 'a' * 64)
        catalog = evidence_catalog([upload])
        self.assertEqual(catalog[0]['status'], 'pending')
        self.assertEqual(catalog[0]['urls'], ['https://authority.test/a'])
        self.assertNotIn('FOREIGN_UPLOAD', json.dumps(profile))
        chat = chat_request_context({'projectKey': 'child'}, state)
        self.assertIn('original-a', json.dumps(chat))
        state['UPLOAD_TOMBS'] = {KEY + '::授权说明.txt': 1}
        self.assertNotIn('original-a', json.dumps(chat_request_context({'projectKey': 'child'}, state)))

    def test_linked_user_correction_is_never_automatically_source_verified(self):
        state = fixture()
        source = state['PROJECTS'][KEY]['kb'][0]['known'][0]
        source['url'] = 'https://authority.test/old'
        edit(state, '聚变能源甲项目状态已改变，尚待原文核验。')
        rows = project_context({'projectKey': KEY, 'topic': TOPIC}, state)['chunks']
        evidence = evidence_catalog(rows)
        self.assertEqual(evidence[0]['status'], 'pending')
        self.assertEqual(evidence[0]['urls'], ['https://authority.test/old'])
        self.assertEqual(evidence[0]['correction']['status'], 'active')

    def test_identical_upload_and_base_quote_keep_distinct_provenance(self):
        state = fixture()
        quote = state['PROJECTS'][KEY]['kb'][0]['known'][0]['text']
        state['UPLOADS'] = {KEY: [{'name': '授权说明.txt', 'originalId': 'original-a'}]}
        state['KB_FILE_CHUNKS'] = {KEY: [{'text': quote, 'originalId': 'original-a'}]}
        rows = project_context({'projectKey': KEY, 'topic': TOPIC}, state)['chunks']
        self.assertEqual(len(rows), 2)
        self.assertEqual(len({row['id'] for row in rows}), 2)
        self.assertEqual(next(row for row in rows if row.get('originalId'))['sourceFile'], '授权说明.txt')

    def test_short_upload_lines_and_admin_text_provenance_survive_all_projections(self):
        state = fixture()
        short = {'id': 'admin-text:1', 'materialId': 'text-1', 'text': '上限28万元',
                 'topic': TOPIC, 'src': '管理端说明', 'origin': 'admin', 'nature': 'support',
                 'account': 'editor', 'ts': 1234}
        combined = {'id': 'admin-text:2', 'materialId': 'text-2',
                    'text': '聚变能源补贴适用条件。\n上限28万元', 'topic': '产业',
                    'src': '补充政策', 'origin': 'admin', 'account': 'editor', 'ts': 1235}
        state['KB_FILE_CHUNKS'] = {KEY: [short, combined]}
        material = next(row for row in saved_materials(state, KEY) if row.get('materialId') == 'text-1')
        self.assertEqual((material['account'], material['ts']), ('editor', 1234))
        rows = context(state)['chunks']
        selected = {row.get('materialId'): row for row in rows if row.get('materialId')}
        self.assertEqual(selected['text-1']['text'], short['text'])
        self.assertEqual(selected['text-2']['text'], combined['text'])
        self.assertEqual(selected['text-1']['sourceFile'], '管理端说明')
        profile = project_context({'projectKey': KEY, 'topic': TOPIC}, state)
        sources = evidence_catalog(profile['chunks'])
        self.assertTrue(any(row['quote'] == '上限28万元' and row.get('materialId') == 'text-1'
                            and row['status'] == 'pending' for row in sources))
        chat = chat_sources(chat_request_context({'projectKey': KEY}, state)['chunks'])
        item = next(row for row in chat if row.get('materialId') == 'text-1')
        self.assertEqual((item['account'], item['ts']), ('editor', 1234))

    def test_legacy_annotation_is_independent_unverified_and_retrievable(self):
        state = fixture()
        original = state['PROJECTS'][KEY]['kb'][0]['known'][0]
        original['annotations'] = [
            {'text': '该项目已经终止。', 'nature': 'fix', 'account': 'old-admin', 'src': '老修订说明'},
            {'text': '上限28万元', 'nature': 'support', 'src': '老补充说明'}]
        materials = saved_materials(state, KEY)
        self.assertEqual(len(materials), 3)
        correction = next(row for row in materials if row.get('correction'))
        self.assertEqual(correction['correction']['status'], 'needs_review')
        self.assertEqual(correction['correction']['reason'], 'legacy_annotation')
        self.assertEqual(correction['account'], 'old-admin')
        rows = context(state)['chunks']
        self.assertIn('该项目已经终止。', [row['text'] for row in rows])
        self.assertIn('上限28万元', [row['text'] for row in rows])
        prompt = chat_context(chat_sources(materials))
        self.assertIn('关联旧材料', prompt)
        self.assertEqual(original['text'], '聚变能源甲项目拟建设研发中心。')

    def test_canonical_chunks_replace_whole_legacy_annotation_even_when_resegmented(self):
        for identity in ('originalId', 'materialId'):
            with self.subTest(identity=identity):
                state = fixture()
                source = state['PROJECTS'][KEY]['kb'][0]['known'][0]
                source['annotations'] = [{'text': '聚变能源旧式长段落第一部分第二部分',
                                           'nature': 'fix', identity: 'same-source'}]
                state['PROJECTS'][KEY]['kb'][0]['known'].append(
                    {'text': '聚变能源旧式独立副本', 'origin': 'admin', identity: 'same-source'})
                chunks = [{'text': '聚变能源第一部分', identity: 'same-source'},
                          {'text': '聚变能源第二部分', identity: 'same-source'}]
                state['KB_FILE_CHUNKS'] = {KEY: chunks}
                if identity == 'originalId':
                    state['UPLOADS'] = {KEY: [{'name': '原文件.txt', identity: 'same-source'}]}
                materials = saved_materials(state, KEY)
                self.assertEqual(len(materials), 3)
                self.assertFalse(any('旧式' in row['text'] for row in materials))
                self.assertEqual(sum(row.get('sourceKind') == 'uploaded_excerpt' for row in materials), 2)

    def test_orphan_pending_failed_uploads_never_enter_any_consumer(self):
        for variant in ('orphan', 'pending', 'parseFailed', 'deleted'):
            with self.subTest(variant=variant):
                state = fixture()
                receipt = {'name': 'bad.txt', 'originalId': 'bad'}
                state['UPLOADS'] = {KEY: [receipt] if variant != 'orphan' else []}
                state['KB_FILE_CHUNKS'] = {KEY: [{'text': '聚变能源BAD_UPLOAD不应被使用。', 'originalId': 'bad'}]}
                if variant != 'orphan':
                    receipt[variant] = True
                self.assertNotIn('BAD_UPLOAD', json.dumps(saved_materials(state, KEY)))


if __name__ == '__main__':
    unittest.main()
