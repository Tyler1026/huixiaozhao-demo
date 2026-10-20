"""Single-topic writing is publishable only after complete independent review."""
import copy
import json
import unittest
from unittest.mock import patch

from backend.topic_composition import (CHAPTERS, MAX_INPUT_CHARS, MAX_INPUT_SOURCES,
                                       compose_report, _normalize_chapters, _bounded_catalog)
from backend.topic_reports import build_report, evidence_catalog, render_report
from test_report_analysis import corporate_bundle, skeleton


def fixture():
    research = corporate_bundle()
    catalog = evidence_catalog(research)
    ids = [row['id'] for row in research['evidence']]
    plan = skeleton(research)
    plan['chain'] = [ids[2]]
    plan['companies'] = [{'name': '东富龙科技集团股份有限公司', 'product': '生物反应袋',
                         'evidence_ids': [ids[2]], 'all_evidence_ids': [ids[2], ids[0]],
                         'stage': '已披露生产/供货能力，实际产量待核',
                         'scope_label': '本地关联企业业务；不据此确认本地工厂'}]
    plan['analytical_priorities'] = [{'state': 'reviewed_inference', 'focus': '膜材',
        'scope': 'local_enterprise', 'evidence_ids': [ids[2], ids[3], ids[0]],
        'comparison': '比较企业进口膜材与国内已披露供给，不代表供应关系已经建立。',
        'reason': '膜材具备具体产品依据，应先开展应用验证。',
        'action': '联系需求方明确规格，再组织供方开展相容性验证。',
        'supply_ids': [ids[2]], 'demand_ids': [], 'constraint_ids': [ids[2]],
        'counter_ids': [ids[3]], 'identity_ids': [ids[0]]}]
    context = {'city': '闵行区', 'topic': research['topic']}

    def paragraph(kind, text, refs):
        return {'kind': kind, 'text': text, 'evidence_ids': refs}

    chapters = {
        'basis': {'id': 'basis', 'paragraphs': [
            paragraph('fact', catalog[ids[0]]['quote'].splitlines()[0], [ids[0]]),
            paragraph('analysis', '闵行区已具有相关企业登记基础，但登记地址不等于具体产品生产场所。', [ids[0]])]},
        'chain': {'id': 'chain', 'paragraphs': [
            paragraph('fact', catalog[ids[2]]['quote'], [ids[2]]),
            paragraph('analysis', '进口膜材与国内同类供给需要区分，国产化产品的存在不代表已完成相容性验证。', [ids[2], ids[3]])]},
        'priorities': {'id': 'priorities', 'paragraphs': [
            paragraph('analysis', '膜材方向有明确的企业使用依据和国内供给线索，可优先开展产品适配研究；不得由此判断全区缺少供给。', [ids[2], ids[3]])]},
        'companies': {'id': 'companies', 'paragraphs': [
            paragraph('fact', catalog[ids[1]]['quote'], [ids[1]]),
            paragraph('analysis', '东富龙科技集团股份有限公司的生物反应袋可作为产品沟通对象；其闵行区注册地址不能证明该产品工厂在本区。', [ids[0], ids[2]])]},
        'actions': {'id': 'actions', 'paragraphs': [
            paragraph('recommendation', '先与生物反应袋需求方明确膜材规格及验证要求，再比较国内供方的相容性资料；具备应用验证条件后安排联合试验。', [ids[2], ids[3]])]},
    }
    return research, catalog, plan, context, chapters


def approve(chapters):
    return {'chapters': [{'id': chapter['id'], 'valid': True, 'reason': '内容符合本章要求且有完整依据。',
                         'paragraphs': [{'index': index, 'valid': True, 'reason': '主体范围与原文条件一致。'}
                                        for index, _ in enumerate(chapter['paragraphs'])]}
                        for chapter in chapters]}


class TopicCompositionTests(unittest.TestCase):
    def test_three_writing_batches_and_a_separate_complete_review(self):
        research, catalog, plan, context, chapters = fixture()
        original = copy.deepcopy((catalog, plan, context))
        calls, events = [], []
        def complete(system, prompt, budget):
            payload = json.loads(prompt); calls.append((system, payload, budget))
            if 'requested_chapters' in payload:
                return {'chapters': [chapters[cid] for cid in payload['requested_chapters']]}
            return approve(payload['chapters'])
        result = compose_report(plan, context, catalog, complete, on_progress=events.append)
        self.assertEqual(result['status'], 'reviewed')
        self.assertEqual(result['calls'], 4)
        ready = dict(plan, composition=result)
        text, _ = render_report(ready, context, research, 2)
        self.assertIn('## 二、产业链关系与机会分析', text)
        self.assertIn('## 三、招引研判方向', text)
        self.assertEqual([row['id'] for row in result['chapters']], list(CHAPTERS))
        self.assertEqual([call[1].get('requested_chapters') for call in calls[:3]],
                         [['basis', 'chain'], ['priorities', 'companies'], ['actions']])
        self.assertIn('独立产业研究审稿人', calls[-1][0])
        self.assertEqual((catalog, plan, context), original)
        self.assertEqual(events[-1]['stage'], 'editorial_review')

    def test_insufficient_analysis_is_a_draft_without_extra_model_calls(self):
        _, catalog, plan, context, _ = fixture()
        plan['analytical_priorities'] = []
        result = compose_report(plan, context, catalog, lambda *args: self.fail('model called'))
        self.assertEqual(result['status'], 'limited')
        self.assertEqual(result['calls'], 0)
        self.assertTrue(any(row['chapter'] == 'priorities' for row in result['diagnostics']))

    def test_new_number_triggers_one_targeted_repair_and_full_rereview(self):
        _, catalog, plan, context, chapters = fixture()
        bad = copy.deepcopy(chapters)
        bad['priorities']['paragraphs'][0]['text'] += '可带来999亿元收益。'
        calls = []
        def complete(system, prompt, budget):
            payload = json.loads(prompt); calls.append(payload)
            if 'requested_chapters' in payload:
                selected = chapters if 'revision_feedback' in payload else bad
                return {'chapters': [selected[cid] for cid in payload['requested_chapters']]}
            return approve(payload['chapters'])
        result = compose_report(plan, context, catalog, complete)
        self.assertEqual(result['status'], 'reviewed')
        self.assertEqual(result['calls'], 6)
        self.assertTrue(result['revised'])
        self.assertEqual(calls[4]['requested_chapters'], ['priorities'])
        self.assertIn('number_not_in_cited_original', str(calls[4]['revision_feedback']))
        self.assertNotIn('999', json.dumps(result['chapters'], ensure_ascii=False))

    def test_missing_or_rejected_paragraph_verdict_never_becomes_a_final(self):
        _, catalog, plan, context, chapters = fixture()
        def complete(system, prompt, budget):
            payload = json.loads(prompt)
            if 'requested_chapters' in payload:
                return {'chapters': [chapters[cid] for cid in payload['requested_chapters']]}
            answer = approve(payload['chapters'])
            answer['chapters'][0]['paragraphs'].pop()
            return answer
        result = compose_report(plan, context, catalog, complete)
        self.assertEqual(result['status'], 'limited')
        self.assertEqual(result['calls'], 6)
        self.assertEqual(result['chapters'], [])

    def test_source_ids_html_external_links_and_process_prose_are_not_publishable(self):
        _, catalog, plan, _, chapters = fixture()
        changes = [
            {'evidence_ids': ['invented']},
            {'text': '本地企业可以获得<script>收益</script>。'},
            {'text': '相关产品已经完成验证，详情见https://fake.invalid。'},
            {'text': '沿用前文原始证据，同一材料不重复计作新的独立来源。'},
        ]
        for change in changes:
            chapter = copy.deepcopy(chapters['priorities'])
            chapter['paragraphs'][0].update(change)
            with self.subTest(change=change):
                normalized, errors = _normalize_chapters({'chapters': [chapter]}, ['priorities'], catalog, plan)
                self.assertFalse(normalized)
                self.assertTrue(errors)

    def test_fact_cannot_remove_a_plan_qualifier(self):
        _, catalog, plan, _, chapters = fixture()
        sid = next(iter(catalog))
        catalog[sid]['quote'] = '公司计划于2027年建成生物反应袋产线，项目尚未投产。'
        chapter = copy.deepcopy(chapters['basis'])
        chapter['paragraphs'][0] = {'kind': 'fact', 'text': '2027年建成生物反应袋产线，项目尚未投产。', 'evidence_ids': [sid]}
        normalized, errors = _normalize_chapters({'chapters': [chapter]}, ['basis'], catalog, plan)
        self.assertFalse(normalized)
        self.assertIn('complete_original_span', str(errors))

    def test_fact_cannot_reorder_or_join_separate_original_sources(self):
        _, catalog, plan, _, chapters = fixture()
        ids = list(catalog)
        catalog[ids[0]]['quote'] = '公司已开展生物材料研究。项目目前仍在验证阶段。'
        catalog[ids[1]]['quote'] = '相关企业已公布具体材料技术路线。'
        for text in ('项目目前仍在验证阶段。公司已开展生物材料研究。',
                     '公司已开展生物材料研究。相关企业已公布具体材料技术路线。'):
            chapter = copy.deepcopy(chapters['basis'])
            chapter['paragraphs'][0] = {'kind': 'fact', 'text': text, 'evidence_ids': ids[:2]}
            with self.subTest(text=text):
                normalized, errors = _normalize_chapters({'chapters': [chapter]}, ['basis'], catalog, plan)
                self.assertFalse(normalized)
                self.assertIn('complete_original_span', str(errors))

    def test_analysis_cannot_attach_a_new_company_to_an_existing_source(self):
        _, catalog, plan, _, chapters = fixture()
        chapter = copy.deepcopy(chapters['priorities'])
        chapter['paragraphs'][0]['text'] = '新造公司有限公司可以作为膜材供给方，并安排本地合作项目。'
        normalized, errors = _normalize_chapters({'chapters': [chapter]}, ['priorities'], catalog, plan)
        self.assertFalse(normalized)
        self.assertIn('entity_not_in_cited_original', str(errors))

    def test_narrative_prefix_keeps_a_grounded_complete_legal_name(self):
        _, catalog, plan, _, chapters = fixture()
        ids = list(catalog)
        for prefix in ('建议联系', '围绕'):
            chapter = copy.deepcopy(chapters['priorities'])
            chapter['paragraphs'][0].update(
                text=prefix+'东富龙科技集团股份有限公司开展生物反应袋产品对接。',
                evidence_ids=[ids[0], ids[2]])
            with self.subTest(prefix=prefix):
                normalized, errors = _normalize_chapters({'chapters': [chapter]}, ['priorities'], catalog, plan)
                self.assertTrue(normalized)
                self.assertFalse(errors)

    def test_policy_benefit_requires_full_conditions_in_same_chapter(self):
        _, catalog, plan, _, chapters = fixture()
        sid = next(iter(catalog))
        catalog[sid]['quote'] = '本区注册企业可申请资助，比例为10%。'
        chapter = copy.deepcopy(chapters['basis'])
        chapter['paragraphs'] = [
            {'kind': 'fact', 'text': catalog[sid]['quote'], 'evidence_ids': [sid]},
            {'kind': 'analysis', 'text': '该项资助比例为10%，可以用于本区符合要求企业的申报安排。', 'evidence_ids': [sid]}]
        policy = {'validity': ['有效期至2027年。'], 'conditions': ['须提供经审计研发支出。']}
        with patch('backend.topic_composition.policy_context', return_value=policy):
            normalized, errors = _normalize_chapters({'chapters': [chapter]}, ['basis'], catalog, plan)
        self.assertFalse(normalized)
        self.assertIn('policy_conditions_incomplete', str(errors))

    def test_draft_and_expired_policy_status_cannot_disappear_in_composed_text(self):
        _, catalog, plan, _, chapters = fixture()
        sid = next(iter(catalog))
        catalog[sid]['quote'] = '本区注册企业可申请资助，比例为10%。'
        for status, marker in (('draft', '该文件为征求意见稿，不能作为现行兑现依据。'),
                               ('expired', '该文件有效期已届满，不能作为现行兑现依据。')):
            chapter = copy.deepcopy(chapters['basis'])
            chapter['paragraphs'] = [
                {'kind': 'fact', 'text': catalog[sid]['quote'], 'evidence_ids': [sid]},
                {'kind': 'analysis', 'text': '该项资助涉及本区注册企业，应区别政策文字与项目实际适用。', 'evidence_ids': [sid]}]
            policy = {'status': status, 'validity': [], 'conditions': []}
            with self.subTest(status=status), patch('backend.topic_composition.policy_context', return_value=policy):
                normalized, errors = _normalize_chapters({'chapters': [chapter]}, ['basis'], catalog, plan)
                self.assertFalse(normalized)
                self.assertIn(status+'_policy_status_missing', str(errors))
                chapter['paragraphs'][1]['text'] = marker
                normalized, errors = _normalize_chapters({'chapters': [chapter]}, ['basis'], catalog, plan)
                self.assertTrue(normalized)
                self.assertFalse(errors)

    def test_model_failure_returns_limited_without_retry_loop(self):
        _, catalog, plan, context, _ = fixture()
        def fail(*args): raise RuntimeError('upstream secret should not leave diagnostics')
        result = compose_report(plan, context, catalog, fail)
        self.assertEqual(result['status'], 'limited')
        self.assertEqual(result['calls'], 1)
        self.assertNotIn('secret', str(result))

    def test_client_disconnection_propagates_without_further_generation(self):
        _, catalog, plan, context, _ = fixture()
        calls = []
        def disconnected(*args):
            calls.append(args)
            raise BrokenPipeError('client closed')
        with self.assertRaises(BrokenPipeError):
            compose_report(plan, context, catalog, disconnected)
        self.assertEqual(len(calls), 1)

    def test_context_keeps_required_whole_sources_and_bounds_extra_material(self):
        _, catalog, plan, _, _ = fixture()
        for index in range(200):
            catalog['extra_'+str(index)] = {'quote': ('该行业仍需研究具体的产品特点和应用范围。' * 70),
                'title': '额外材料', 'url': 'https://official.example/document-'+str(index)}
        selected = _bounded_catalog(catalog, plan)
        from backend.topic_composition import _source_view
        self.assertLessEqual(len(selected), MAX_INPUT_SOURCES)
        self.assertLessEqual(sum(len(json.dumps(row, ensure_ascii=False)) for row in _source_view(selected)), MAX_INPUT_CHARS)
        self.assertTrue(set(plan['basis'] + plan['chain']).issubset(selected))
        for sid, row in selected.items():
            self.assertEqual(row['quote'], catalog[sid]['quote'])

    def test_required_sources_over_budget_are_not_truncated_or_silently_dropped(self):
        _, catalog, plan, context, _ = fixture()
        for index in range(12):
            sid = 'large_'+str(index)
            catalog[sid] = {'quote': '闵行区生物医药材料的公开研究记录。' * 240,
                           'title': '长原文', 'url': 'https://official.example/large-'+str(index)}
            plan['basis'].append(sid)
        result = compose_report(plan, context, catalog, lambda *args: self.fail('model called'))
        self.assertEqual(result['status'], 'limited')
        self.assertEqual(result['diagnostics'][0]['code'], 'required_source_context_exceeds_bound')

    def test_partial_research_never_receives_a_reviewed_final_title(self):
        research, _, _, context, chapters = fixture()
        research['status'] = 'pending'
        research['errors'] = [{'code': 'search_timeout'}]
        with patch('backend.topic_reports.compose_report', return_value={
                'status': 'reviewed', 'chapters': list(chapters.values()), 'diagnostics': []}):
            result = build_report(context, research, 2, lambda *args: skeleton(research))
        self.assertEqual(result['analysis']['composition']['status'], 'limited')
        self.assertEqual(result['analysis']['composition']['review_status'], 'passed')
        self.assertEqual(result['analysis']['composition']['diagnostics'][0]['code'], 'research_incomplete')
        self.assertIn('产业研判稿', result['text'])
        self.assertNotIn('产业研判报告', result['text'])
        self.assertIn(chapters['actions']['paragraphs'][0]['text'], result['text'])
        self.assertIn('不代表完整产业普查', result['text'])

    def test_reviewed_composition_survives_second_render_with_all_cited_sources(self):
        research, catalog, plan, context, chapters = fixture()
        plan['composition'] = {'status': 'reviewed', 'chapters': list(chapters.values())}
        first, sources = render_report(plan, context, research, 2)
        second, other_sources = render_report(plan, context, research, 2)
        self.assertEqual(first, second)
        self.assertEqual(sources, other_sources)
        self.assertIn('产业研判报告', first)
        self.assertIn(chapters['actions']['paragraphs'][0]['text'], first)
        self.assertTrue(all(row['id'] in {source['id'] for source in sources}
                            for row in research['evidence']))

    def test_final_bibliography_contains_only_cited_documents_in_citation_order(self):
        research, catalog, plan, context, chapters = fixture()
        unused = dict(research['evidence'][0], id='unused-source', source_id='unused-document',
                      url='https://official.example/unused', quote='本条未被最终正文引用，不应列入最终参考文献。')
        import hashlib
        research['evidence'].append(unused)
        research['sources']['unused-document'] = {'url': unused['url'], 'fulltext': unused['quote'],
            'fulltext_sha256': hashlib.sha256(unused['quote'].encode()).hexdigest()}
        plan['chain'].append(unused['id'])
        plan['composition'] = {'status': 'reviewed', 'chapters': list(chapters.values())}
        text, sources = render_report(plan, context, research, 2)
        self.assertNotIn('https://official.example/unused', text)
        self.assertIn('unused-source', {source['id'] for source in sources})
        self.assertFalse(next(source for source in sources if source['id'] == 'unused-source')['cited_in_report'])
        expected = list(dict.fromkeys(sid for chapter in chapters.values()
                                     for paragraph in chapter['paragraphs'] for sid in paragraph['evidence_ids']))
        cited = {source['id']: source for source in sources if source['cited_in_report']}
        self.assertEqual(set(cited), set(expected))
        # Two excerpts belong to the same original filing.
        self.assertEqual([cited[sid]['label'] for sid in expected], ['1', '2', '3', '1'])

    def test_build_report_attaches_review_and_limited_title_is_honest(self):
        research, _, _, context, chapters = fixture()
        raw = skeleton(research)
        with patch('backend.topic_reports.compose_report', return_value={
                'status': 'reviewed', 'chapters': list(chapters.values()), 'diagnostics': []}):
            result = build_report(context, research, 2, lambda *args: raw)
        self.assertEqual(result['analysis']['composition']['status'], 'reviewed')
        self.assertEqual(result['plan']['composition'], result['analysis']['composition'])
        self.assertIn('产业研判报告', result['text'])
        result = build_report(context, research, 2, lambda *args: raw)
        self.assertEqual(result['analysis']['composition']['status'], 'limited')
        self.assertIn('产业研判稿', result['text'])
        self.assertNotIn('产业研判报告', result['text'])

    def test_full_build_keeps_composition_only_source_and_rerenders_without_new_calls(self):
        research, _, plan, context, chapters = fixture()
        ids = [row['id'] for row in research['evidence']]
        raw = {'basis': plan['basis'], 'chain': plan['chain'],
               'companies': [{'name': plan['companies'][0]['name'], 'product': '生物反应袋',
                              'evidence_ids': [ids[2]], 'identity_ids': [ids[0]]}],
               'priorities': [plan['analytical_priorities'][0]], 'questions': []}
        calls = []
        def complete(system, prompt, budget):
            payload = json.loads(prompt); calls.append(payload)
            if 'requested_chapters' in payload:
                return {'chapters': [chapters[cid] for cid in payload['requested_chapters']]}
            if 'chapters' in payload:
                return approve(payload['chapters'])
            if 'proposals' in payload:
                return {'verdicts': [{'index': 0, 'valid': True, 'reason': '原文支持有边界的产品分析。'}]}
            return raw
        result = build_report(context, research, 2, complete)
        self.assertEqual(result['analysis']['composition']['status'], 'reviewed')
        self.assertEqual(len(calls), 6)
        self.assertIn(ids[1], {row['id'] for row in result['sources']})
        rendered, sources = render_report(result['plan'], context, research, 2)
        self.assertEqual(rendered, result['text'])
        self.assertEqual(sources, result['sources'])
        self.assertEqual(len(calls), 6)


if __name__ == '__main__': unittest.main()
