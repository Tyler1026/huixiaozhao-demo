"""Regression tests for the real five-card retrieval failure modes, offline."""
import copy
import json
import unittest

from backend.auth import AuthError
from backend.kb_edits import save_edit
from backend.topic_evidence import topic_report_context, topic_evidence_prompt


KEY = 'minhang'
TOPIC = '聚变能源前沿赛道培育招商'


def fixture(topic=TOPIC):
    return {'PROJECTS': {KEY: {'workspaceId': KEY, 'city': '闵行区', 'topic': topic,
                              'reportRequestId': 'r1', 'kb': []}},
            'REPORTSTATE': {KEY: {'topic': topic,
                                  'text': '聚变能源伪造的当前报告不能成为新的证据。',
                                  'aiReportByTopic': {topic: '聚变能源伪造的当前报告不能成为新的证据。'}}}}


def known(state, text, *, source='02_industry.md', **values):
    state['PROJECTS'][KEY]['kb'].append({'t': '主导产业与产业链', 'known': [
        dict({'text': text, 'origin': 'report', 'nature': 'base', 'sourceFile': source, 'cite': source}, **values)]})


def read(state, topic=TOPIC, **kwargs):
    return topic_report_context({'projectKey': KEY, 'topic': topic, 'reportRequestId': 'r1'}, state, **kwargs)


class TopicEvidenceTests(unittest.TestCase):
    def test_five_cards_require_specific_industry_terms(self):
        cases = [
            ('商业火箭卫星配套本地化补链', '闵行商业航天火箭卫星供应链待核实。', '生物医药上游过滤耗材的国产替代情况。'),
            ('生物医药上游耗材国产替代招引', '生物制药过滤膜和色谱填料企业尚待核实。', '航天宏图遥感卫星的扩产项目在北京。'),
            ('氢基能源与长时储能装备补链', '电解槽制氢及液流电池储能企业需要调查。', '象屿铝业商业火箭材料供货规模提高。'),
            ('低空经济整机配套承接集聚', '低空无人机整机企业和适航资质尚需核查。', '闵行航天火箭卫星链主已经公布基地。'),
            (TOPIC, '聚变装置高温超导磁体与偏滤器需要验证。', '泰林生物制药设备出现监管警示函。'),
        ]
        for topic, relevant, wrong in cases:
            with self.subTest(topic=topic):
                state = fixture(topic)
                # In the failed run these distinct industries shared a long KB chunk.
                known(state, relevant + '\n' + wrong)
                rows = read(state, topic)['chunks']
                self.assertEqual([r['text'] for r in rows], [relevant])

    def test_generic_city_terms_never_force_a_hit(self):
        state = fixture('低空经济整机配套承接集聚')
        known(state, '闵行区产业链补链招商承接项目企业培育，促进产业经济发展。')
        result = read(state, '低空经济整机配套承接集聚')
        self.assertEqual(result['chunks'], [])
        self.assertEqual(result['relevantChunkCount'], 0)
        self.assertIn('未命中', topic_evidence_prompt(result))

    def test_rocket_vertical_landing_is_not_low_altitude_evidence(self):
        topic = '低空经济整机配套承接集聚'
        state = fixture(topic)
        known(state, '运载火箭完成十公里级垂直起降飞行试验。')
        self.assertEqual(read(state, topic)['chunks'], [])

    def test_nonanswers_and_interview_questions_are_not_industry_facts(self):
        state = fixture()
        known(state, '【聚变能源】产业基础情况如何？\n答：不知道', nature='interview')
        self.assertEqual(read(state)['chunks'], [])

    def test_substantive_interview_keeps_its_user_statement_boundary(self):
        state = fixture()
        known(state, '【聚变能源】项目承载条件是什么？\n答：只能承接研发中心，没有新增工业用地。')
        state['PROJECTS'][KEY]['kb'][0]['known'][0]['nature'] = 'interview'
        row = read(state)['chunks'][0]
        self.assertIn('用户访谈陈述（未核实）', row['text'])
        self.assertIn('没有新增工业用地', row['text'])

    def test_custom_topic_uses_specific_phrase_without_single_character_overlap(self):
        state = fixture('高端陶瓷基板配套招引')
        known(state, '陶瓷基板加工企业具备量产能力，具体产能待核实。\n高端园区招引产业配套企业发展。')
        rows = read(state, '高端陶瓷基板配套招引')['chunks']
        self.assertEqual(len(rows), 1)
        self.assertIn('陶瓷基板', rows[0]['text'])

    def test_current_draft_and_old_report_are_not_reingested(self):
        state = fixture()
        known(state, '聚变能源基础材料来自已保存研究，仍须核实。')
        result = read(state)
        self.assertEqual(len(result['chunks']), 1)
        self.assertNotIn('伪造', topic_evidence_prompt(result))
        changed = copy.deepcopy(state)
        changed['REPORTSTATE'][KEY]['text'] = '聚变能源新一轮回答及待确认事项。'
        changed['REPORTSTATE'][KEY]['aiReportByTopic'][TOPIC] = '聚变能源新一轮回答及待确认事项。'
        self.assertEqual(result['sourceFingerprint'], read(changed)['sourceFingerprint'])

    def test_preserves_filename_and_never_resolves_ambiguous_local_reference(self):
        state = fixture()
        known(state, '聚变能源主体规模需核实（来源[3]）。', source='industry.md')
        known(state, '聚变能源政策适用范围需核实（来源[3]）。', source='policy.md')
        rows = read(state)['chunks']
        self.assertEqual({r['cite'] for r in rows}, {'industry.md', 'policy.md'})
        self.assertEqual({r['sourceFile'] for r in rows}, {'industry.md', 'policy.md'})
        self.assertEqual(len({r['sourceId'] for r in rows}), 2)
        self.assertTrue(all(r['urls'] == [] and r['sourceStatus'] == 'source_missing' for r in rows))
        self.assertTrue(all(r['status'] == 'unverified' for r in rows))

    def test_same_text_in_independent_documents_keeps_provenance(self):
        state = fixture()
        known(state, '聚变能源主体规模需要独立核实。', source='alpha.md')
        known(state, '聚变能源主体规模需要独立核实。', source='beta.md')
        rows = read(state)['chunks']
        self.assertEqual(len(rows), 2)
        self.assertEqual(len({r['id'] for r in rows}), 2)

    def test_url_on_another_company_line_is_not_borrowed(self):
        state = fixture('生物医药上游耗材国产替代招引')
        known(state, '甲公司生产过滤膜，产能暂未核实。\n乙公司生产过滤膜，资料 https://company.test/yi')
        rows = read(state, '生物医药上游耗材国产替代招引')['chunks']
        alpha = next(r for r in rows if '甲公司' in r['text'])
        beta = next(r for r in rows if '乙公司' in r['text'])
        self.assertEqual(alpha['urls'], [])
        self.assertEqual(beta['urls'], ['https://company.test/yi'])
        self.assertEqual(beta['status'], 'unverified', 'A URL is not a factual endorsement')

    def test_explicit_url_metadata_is_preserved_and_invalid_urls_rejected(self):
        state = fixture()
        known(state, '聚变能源装置的公开材料，尚需核验。',
              urls=['https://authority.test/fusion', 'javascript:alert(1)', 'https://user:pass@site.test/'])
        row = read(state)['chunks'][0]
        self.assertEqual(row['urls'], ['https://authority.test/fusion'])
        self.assertEqual(row['sourceKind'], 'saved_report_excerpt')

    def test_linked_relevant_excerpt_is_not_buried_by_repeated_summary_terms(self):
        state = fixture()
        known(state, '聚变能源托卡马克高温超导磁体第一壁偏滤器信息均待核实。')
        known(state, '聚变装置已经交付，原文 https://authority.test/observation', source='source.md')
        rows = read(state, limit=1)['chunks']
        self.assertEqual(rows[0]['urls'], ['https://authority.test/observation'])

    def test_upload_original_text_is_included_not_just_receipt(self):
        state = fixture()
        state['UPLOADS'] = {KEY: [{'name': '聚变材料.txt', 'originalId': 'original-a', 'projectKey': KEY}]}
        state['KB_FILE_CHUNKS'] = {KEY: [{'originalId': 'original-a', 'cite': '聚变材料.txt',
                                         'text': '聚变高温超导材料测试结果有待核查。'}]}
        rows = read(state)['chunks']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['sourceKind'], 'uploaded_excerpt')
        self.assertEqual(rows[0]['originalId'], 'original-a')
        self.assertEqual(rows[0]['sourceFile'], '聚变材料.txt')

    def test_deleted_pending_failed_and_orphan_uploads_do_not_reappear(self):
        for change in ('tomb', 'pending', 'parseFailed', 'orphan'):
            with self.subTest(change=change):
                state = fixture()
                record = {'name': '聚变.txt', 'originalId': 'orig'}
                state['UPLOADS'] = {KEY: [record]}
                state['KB_FILE_CHUNKS'] = {KEY: [{'originalId': 'orig', 'cite': '聚变.txt',
                                                 'text': '聚变能源上传正文不应复活。'}]}
                if change == 'tomb':
                    state['UPLOAD_TOMBS'] = {KEY + '::聚变.txt': 1}
                elif change == 'orphan':
                    state['UPLOADS'][KEY] = []
                else:
                    record[change] = True
                self.assertEqual(read(state)['chunks'], [])

    def test_legacy_upload_receipt_with_extracted_text_is_read(self):
        state = fixture()
        state['UPLOADS'] = {KEY: [{'name': '聚变.txt', 'extractedText': '聚变能源供应链原文，包含完整限制条件。'}]}
        self.assertIn('完整限制条件', read(state)['chunks'][0]['text'])

    def test_child_uses_only_its_parent_workspace_not_same_city(self):
        state = fixture()
        known(state, '聚变能源父工作区材料可以使用。')
        state['PROJECTS']['child'] = {'workspaceId': KEY, 'city': '闵行区', 'topic': TOPIC}
        state['PROJECTS']['foreign'] = {'workspaceId': 'foreign', 'city': '闵行区', 'topic': TOPIC,
                                        'kb': [{'t': '产业', 'known': ['聚变能源其他账号秘密。']}]}
        result = topic_report_context({'projectKey': 'child', 'topic': TOPIC}, state)
        text = topic_evidence_prompt(result)
        self.assertIn('父工作区', text)
        self.assertNotIn('秘密', text)
        with self.assertRaises(AuthError):
            topic_report_context({'projectKey': 'missing', 'topic': TOPIC}, state)

    def test_changed_material_url_or_preference_invalidates_fingerprint(self):
        state = fixture()
        known(state, '聚变能源原文限制条件需要保留。', url='https://authority.test/a')
        baseline = read(state)['sourceFingerprint']
        for field, value in [('text', '聚变能源原文条件已经变更。'), ('url', 'https://authority.test/b')]:
            changed = copy.deepcopy(state)
            changed['PROJECTS'][KEY]['kb'][0]['known'][0][field] = value
            self.assertNotEqual(baseline, read(changed)['sourceFingerprint'])
        state['PROJECTS'][KEY]['onboarding'] = {'capacity': ['无新增用地']}
        self.assertNotEqual(baseline, read(state)['sourceFingerprint'])

    def test_source_bound_revision_is_used_without_reintroducing_original(self):
        state = fixture()
        state['RESET_GEN'] = 'reset-1'
        known(state, '聚变能源原始说法：已经批准，尚需核实。')
        original = copy.deepcopy(state['PROJECTS'][KEY]['kb'][0]['known'][0])
        baseline = read(state)['sourceFingerprint']
        request = {'projectKey': KEY, 'sectionIndex': 0, 'sectionTitle': '主导产业与产业链',
                   'baseReportVersion': None, 'sourceIndex': 0, 'sourceItem': original,
                   'editId': None, 'expectedRevision': 0, 'resetGen': 'reset-1',
                   'text': '聚变能源修订说法：尚未批准，只有研究意向。'}
        save_edit(request, state, {'scope': 'admin', 'user': 'reviewer'}, now_ms=1000)
        result = read(state)
        self.assertNotEqual(result['sourceFingerprint'], baseline)
        self.assertIn('尚未批准', topic_evidence_prompt(result))
        self.assertNotIn('已经批准', topic_evidence_prompt(result))
        self.assertEqual(result['chunks'][0]['sourceFile'], '02_industry.md')

    def test_orphaned_foreign_project_upload_is_not_read(self):
        state = fixture()
        state['UPLOADS'] = {KEY: [{'name': '聚变.txt', 'originalId': 'a', 'projectKey': 'foreign'}]}
        state['KB_FILE_CHUNKS'] = {KEY: [{'text': '聚变能源跨项目秘密材料。', 'originalId': 'a', 'cite': '聚变.txt'}]}
        self.assertEqual(read(state)['chunks'], [])

    def test_fingerprint_stable_under_snapshot_serialization(self):
        state = fixture()
        known(state, '聚变能源原文限制条件需要保留。')
        one = read(state)
        two = read(json.loads(json.dumps(state, sort_keys=True)))
        self.assertEqual(one['sourceFingerprint'], two['sourceFingerprint'])
        self.assertEqual(one['chunks'][0]['id'], two['chunks'][0]['id'])

    def test_whole_conditions_are_not_truncated_to_fit_budget(self):
        state = fixture()
        text = '聚变能源专项政策适用条件：' + '必须满足完整条件，' * 30 + '到期后不得再申请。'
        known(state, text)
        self.assertEqual(read(state)['chunks'][0]['text'], text)
        self.assertEqual(read(state, char_limit=100)['chunks'], [])

    def test_client_corpus_city_and_old_version_cannot_override(self):
        state = fixture()
        known(state, '聚变能源原文来自闵行当前工作区。')
        result = topic_report_context({'projectKey': KEY, 'topic': TOPIC, 'city': '假城',
                                       'chunks': [{'text': '聚变能源伪造数据'}]}, state)
        self.assertEqual(result['city'], '闵行区')
        self.assertNotIn('伪造数据', topic_evidence_prompt(result))
        with self.assertRaises(AuthError):
            topic_report_context({'projectKey': KEY, 'topic': TOPIC, 'reportRequestId': 'stale'}, state)


if __name__ == '__main__':
    unittest.main()
