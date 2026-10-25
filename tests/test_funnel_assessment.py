"""Source-bound AI scoring, exercised locally without model/network calls."""
import copy
import json
import unittest

from backend.auth import AuthError
from backend.evidence_grounding import (
    evidence_catalog, funnel_demand_anchors, ground_funnel, project_context, review_and_push,
)
from tests import test_interactive_evidence_boundary as http_fixture


NAME = '星河动力公司'
TOPIC = '液体火箭'
PRODUCT = NAME + '生产液氧煤油发动机，用于液体火箭推进；规格适用范围及客户验证仍须核查。来源 https://official.example/product'
EXPANSION = NAME + '2026年公告计划新建发动机工厂并扩产，项目仍在建设阶段，不代表已经在本地投资。来源 https://official.example/expansion'
STRENGTH = NAME + '2025年营业收入12亿元，研发人员400人，拥有相关发明专利80项；统计口径以年报为准。来源 https://official.example/annual'
DEMAND = '当前方向需要液氧煤油发动机研发和生产企业，具体技术条件与客户验证仍需核对。'


def fixture():
    state = http_fixture.sample()
    state['PROJECTS']['a']['kb'] = [{'t': '企业产品与经营资料', 'known': [
        {'text': PRODUCT}, {'text': EXPANSION}, {'text': STRENGTH},
        {'text': '其他公司生产液氧煤油发动机，已披露新增产能及营业收入。来源 https://official.example/other'},
        {'text': NAME + '生产液氧煤油发动机，但本条没有来源链接。'},
        {'text': NAME + '出席液体火箭行业会议，主办方介绍了最新行业动态。来源 https://official.example/news'},
        {'text': NAME + '生产汽车座椅，具体型号及技术范围见产品手册。来源 https://official.example/seats'},
    ]}]
    state['REPORTSTATE']['a'] = {'topic': TOPIC, 'phaseByTopic': {TOPIC: 2},
                                'aiReportByTopic': {TOPIC: DEMAND}}
    body = {'projectKey': 'a', 'topic': TOPIC, 'reportRequestId': 'r1'}
    context = project_context(body, state)
    catalog = evidence_catalog(context['chunks'])
    refs = {label: next(row for row in catalog if text in row['quote'])
            for label, text in [('product', PRODUCT), ('expansion', EXPANSION), ('strength', STRENGTH),
                                ('other', '其他公司'), ('unlinked', '本条没有来源'),
                                ('news', '出席液体火箭行业会议'), ('seats', '生产汽车座椅')]}
    return state, body, context, catalog, refs


def raw_company(refs):
    return {'name': NAME, 'kind': '液氧煤油发动机', 'evidence_ids': [refs['product']['id']],
            'assessments': {
                'match': {'score': 40, 'reason': '产品原文与当前液氧煤油发动机需求直接对应，实际资质仍需核验。',
                          'evidence_ids': [refs['product']['id']], 'demand_anchor_id': 'report:0'},
                'relocate': {'score': 30, 'reason': '公开扩产计划提示可接洽机会，不等于具有本地投资意向。',
                             'evidence_ids': [refs['expansion']['id']]},
                'strength': {'score': 30, 'reason': '已披露营收、人员及专利，可作为实力研判的依据，统计范围仍需核验。',
                             'evidence_ids': [refs['strength']['id']]}}}


def grounded(raw, context, catalog):
    return ground_funnel({'companies': [raw]}, catalog, context)['companies'][0]


class FunnelAssessmentTests(unittest.TestCase):
    def test_three_dimensions_can_total_100_but_remain_ai_judgments_with_unknown_intent(self):
        _, _, context, catalog, refs = fixture()
        raw = raw_company(refs)
        result = ground_funnel({'companies': [raw]}, catalog, context)
        company = result['companies'][0]
        self.assertEqual(result['scoring_contract'], 'evidence-assessment-v1')
        self.assertEqual(result['rubric_version'], 'funnel-40-30-30-s85-a70-v1')
        self.assertEqual(company['assessment_contract'], 'evidence-assessment-v1')
        self.assertEqual((company['score_match'], company['score_relocate'], company['score_strength']), (40, 30, 30))
        self.assertEqual(company['fit_score'], 100)
        self.assertEqual(company['score_status'], 'complete')
        self.assertEqual(company['assessed_score'], 100)
        self.assertEqual(company['assessed_max'], 100)
        self.assertEqual(company['score_range'], [100, 100])
        self.assertEqual(company['investment_intent'], 'unknown')
        self.assertFalse(company['push_eligible'])
        self.assertIn('AI研判', company['assessment_notice'])
        self.assertIn('不是已核实事实', company['assessment_notice'])
        for dimension, label in [('match', 'product'), ('relocate', 'expansion'), ('strength', 'strength')]:
            assessment = company['assessments'][dimension]
            self.assertEqual(assessment['evidence'][0]['quote'], refs[label]['quote'])
            self.assertEqual(assessment['evidence'][0]['urls'], refs[label]['urls'])
        self.assertEqual(company['assessments']['match']['demand'], funnel_demand_anchors(context)[0])

    def test_partial_score_exposes_range_and_never_pads_unknown_dimension_with_zero(self):
        _, _, context, catalog, refs = fixture()
        raw = raw_company(refs)
        raw['assessments']['strength'] = None
        company = grounded(raw, context, catalog)
        self.assertIsNone(company['fit_score'])
        self.assertEqual(company['score_status'], 'partial')
        self.assertEqual((company['assessed_score'], company['assessed_max']), (70, 70))
        self.assertEqual(company['score_range'], [70, 100])
        self.assertIsNone(company['score_strength'])

    def test_legacy_scores_without_assessments_are_not_upgraded(self):
        _, _, context, catalog, refs = fixture()
        raw = raw_company(refs)
        del raw['assessments']
        raw.update(score_match=40, score_relocate=30, score_strength=30, fit_score=100)
        company = grounded(raw, context, catalog)
        self.assertEqual(company['score_status'], 'unassessed')
        self.assertEqual(company['assessed_score'], 0)
        self.assertEqual(company['assessed_max'], 0)
        self.assertEqual(company['score_range'], [0, 100])
        self.assertIsNone(company['fit_score'])
        self.assertTrue(all(value is None for value in company['assessments'].values()))

    def test_bad_numeric_types_nonfinite_and_out_of_range_scores_become_unknown(self):
        _, _, context, catalog, refs = fixture()
        for value in [True, False, '40', None, {}, [], -1, 41, float('nan'), float('inf'), -float('inf'), 10**1000]:
            with self.subTest(value=str(value)[:60]):
                raw = raw_company(refs)
                raw['assessments']['match']['score'] = value
                company = grounded(raw, context, catalog)
                self.assertIsNone(company['assessments']['match'])
                self.assertIsNone(company['score_match'])
                self.assertIsNone(company['fit_score'])
        for value in [0, 12.5, 40.0]:
            raw = raw_company(refs)
            raw['assessments']['match']['score'] = value
            self.assertEqual(grounded(raw, context, catalog)['score_match'], value)

    def test_each_assessment_requires_bounded_reason_and_every_id_to_be_own_linked_evidence(self):
        _, _, context, catalog, refs = fixture()
        for reason in ['', '  ', None, 5, '超' * 1001]:
            raw = raw_company(refs)
            raw['assessments']['strength']['reason'] = reason
            self.assertIsNone(grounded(raw, context, catalog)['assessments']['strength'])
        for ids in [[], refs['strength']['id'], [None], [[]], ['not-in-current-catalog'],
                    [refs['strength']['id'], refs['other']['id']], [refs['unlinked']['id']],
                    [refs['strength']['id']] * 9]:
            with self.subTest(ids=ids):
                raw = raw_company(refs)
                raw['assessments']['strength']['evidence_ids'] = ids
                company = grounded(raw, context, catalog)
                self.assertIsNone(company['assessments']['strength'])
                self.assertIsNone(company['fit_score'])

    def test_match_requires_current_anchor_and_related_product_not_a_news_mention(self):
        _, _, context, catalog, refs = fixture()
        for anchor in [None, '', [], 'report:99', refs['product']['id']]:
            raw = raw_company(refs)
            raw['assessments']['match']['demand_anchor_id'] = anchor
            self.assertIsNone(grounded(raw, context, catalog)['assessments']['match'])
        for label in ('news', 'seats'):
            raw = raw_company(refs)
            raw['assessments']['match']['evidence_ids'] = [refs[label]['id']]
            self.assertIsNone(grounded(raw, context, catalog)['assessments']['match'])
        changed = copy.deepcopy(context)
        changed['reportState'] = {}
        self.assertIsNone(grounded(raw_company(refs), changed, catalog)['assessments']['match'])

    def test_relocation_and_strength_require_relevant_public_source_content(self):
        _, _, context, catalog, refs = fixture()
        for dimension in ('relocate', 'strength'):
            for label in ('product', 'news'):
                raw = raw_company(refs)
                raw['assessments'][dimension]['evidence_ids'] = [refs[label]['id']]
                self.assertIsNone(grounded(raw, context, catalog)['assessments'][dimension])
        for statement in ['未披露任何扩产、建厂或投资计划', '扩产计划已取消，相关投资尚未确认',
                          '未考虑在闵行设厂', '没有新建工厂计划', '不计划新增生产线',
                          '不投资建厂', '无新增产能', '新增产能计划待确认',
                          '是否扩产仍不明确', '如有投资计划再与园区联系']:
            text = NAME + statement + '。来源 https://official.example/no-plans'
            ref = evidence_catalog([{'id': 'negative', 'text': text}])[0]
            raw = raw_company(refs)
            raw['assessments']['relocate']['evidence_ids'] = [ref['id']]
            self.assertIsNone(grounded(raw, context, catalog + [ref])['assessments']['relocate'])
        text = NAME + '未披露营业收入、员工及产能数据，规模情况仍待核实。来源 https://official.example/no-data'
        ref = evidence_catalog([{'id': 'no-scale', 'text': text}])[0]
        raw = raw_company(refs)
        raw['assessments']['strength']['evidence_ids'] = [ref['id']]
        self.assertIsNone(grounded(raw, context, catalog + [ref])['assessments']['strength'])

    def test_explicit_incompatibility_lack_of_capacity_and_financial_service_are_not_positive_basis(self):
        _, _, context, catalog, refs = fixture()
        cases = [
            ('match', '生产的液氧煤油发动机不适用于本需求所述的液体火箭推进'),
            ('strength', '尚未取得ISO9001认证，也没有任何量产和交付能力'),
            ('strength', '没有披露是否取得ISO9001认证'),
            ('strength', '不具备ISO9001认证'),
            ('strength', 'ISO9001认证已过期'),
            ('relocate', '只是投资管理公司，为客户提供投资咨询服务，没有制造基地'),
        ]
        for dimension, statement in cases:
            with self.subTest(dimension=dimension, statement=statement):
                ref = evidence_catalog([{'id': 'counterexample', 'text': NAME + statement +
                                         '。来源 https://official.example/counterexample'}])[0]
                raw = raw_company(refs)
                raw['assessments'][dimension]['evidence_ids'] = [ref['id']]
                company = grounded(raw, context, catalog + [ref])
                self.assertEqual(company['name'], NAME)
                self.assertIsNone(company['assessments'][dimension])
                self.assertIsNone(company['score_' + dimension])
                self.assertIsNone(company['fit_score'])

    def test_maximum_score_never_bypasses_per_company_review_or_certifies_intent(self):
        state, body, context, catalog, refs = fixture()
        state['PROJECTS']['a']['funnel'] = ground_funnel({'companies': [raw_company(refs)]}, catalog, context)
        with self.assertRaises(AuthError) as error:
            review_and_push(dict(body, names=[NAME]), state, 'admin')
        self.assertEqual(error.exception.code, 'review_required')
        review = {'name': NAME, 'confirmed': True,
                  'product': {'evidenceId': refs['product']['id'], 'quote': refs['product']['quote']},
                  'demand': {'anchorId': 'report:0', 'quote': DEMAND},
                  'reason': '已逐项核对发动机产品与当前液体火箭需求，后续还需核验客户资质和投资计划。'}
        result = review_and_push(dict(body, names=[NAME], reviews=[review]), state, 'admin')
        self.assertEqual(result['added'], [NAME])
        self.assertEqual(state['PROJECTS']['a']['clues'][0]['investment_intent'], 'unknown')
        self.assertFalse(state['PROJECTS']['a']['clues'][0]['hasMoveSignal'])
        self.assertEqual(state['PROJECTS']['a']['funnel']['companies'][0]['fit_score'], 100)


class FunnelAssessmentHttpTests(unittest.TestCase):
    setUp = http_fixture.StreamBoundaryTests.setUp
    request = http_fixture.StreamBoundaryTests.request

    def generate(self, raw_transform=None):
        state, body, _, _, refs = fixture()
        saved = self.h.state()
        saved.update(state)
        self.h.replace(saved)
        company = raw_company(refs)
        if raw_transform:
            raw_transform(company, refs)
        raw = json.dumps({'choices': [{'message': {'content': json.dumps({'companies': [company]})},
                                       'finish_reason': 'stop'}]}).encode()
        status, data = self.request(raw, 'funnel', body)
        self.assertEqual(status, 200)
        event = json.loads(next(line[6:] for line in data.splitlines() if line.startswith('data: {')))
        result = json.loads(event['choices'][0]['delta']['content'])
        self.assertEqual(result, self.h.state()['PROJECTS']['a']['funnel'])
        return result

    def test_real_handler_persists_scoring_receipt_and_separate_demand_anchors(self):
        result = self.generate()
        self.assertEqual(result['companies'][0]['fit_score'], 100)
        sent = json.loads(self.h.ns['DS_OPENER'].open.call_args.args[0].data)
        prompt = sent['messages'][0]['content']
        message = sent['messages'][-1]['content']
        self.assertIn('assessments', prompt)
        self.assertNotIn('不推算适配分数', prompt)
        self.assertIn('当前需求参照', message)
        self.assertIn('report:0', message)
        self.assertIn(DEMAND, message)
        self.assertIn('不是企业事实证据', prompt)
        self.assertEqual(result['companies'][0]['investment_intent'], 'unknown')

    def test_real_handler_keeps_partial_score_unknown_when_source_or_anchor_invalid(self):
        def change(company, refs):
            company['assessments']['match']['demand_anchor_id'] = 'another-workspace:0'
            company['assessments']['relocate']['evidence_ids'] = [refs['other']['id']]
        company = self.generate(change)['companies'][0]
        self.assertIsNone(company['fit_score'])
        self.assertEqual(company['score_status'], 'partial')
        self.assertEqual(company['score_range'], [30, 100])
        self.assertEqual(company['assessed_max'], 30)

    def test_stale_sync_cannot_erase_server_generated_scores(self):
        result = self.generate()
        for incoming in [{'evidence_contract': 'saved-excerpts-v1', 'companies': []},
                         {'scoring_contract': 'evidence-assessment-v1', 'companies': [{'name': '伪造公司', 'fit_score': 100}]}]:
            status, _, raw = self.h.request('POST', '/api/sync', {'PROJECTS': {'a': {'funnel': incoming}}}, cookie=self.cookie)
            self.assertEqual(status, 200)
            self.assertTrue(json.loads(raw)['ok'])
            self.assertEqual(self.h.state()['PROJECTS']['a']['funnel'], result)
        status, _, raw = self.h.request('POST', '/api/sync', {'PROJECTS': {'a': None}}, cookie=self.cookie)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw)['ok'])
        self.assertEqual(self.h.state()['PROJECTS']['a']['funnel'], result)

    def test_real_review_route_still_requires_review_and_can_update_protected_scored_funnel(self):
        original = self.generate()
        body = {'projectKey': 'a', 'topic': TOPIC, 'reportRequestId': 'r1', 'names': [NAME]}
        status, _, raw = self.h.request('POST', '/api/funnel-review-push', body, cookie=self.cookie)
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(raw)['error'], 'review_required')
        product = original['companies'][0]['evidence'][0]
        body['reviews'] = [{'name': NAME, 'confirmed': True,
                            'product': {'evidenceId': product['id'], 'quote': product['quote']},
                            'demand': {'anchorId': 'report:0', 'quote': DEMAND},
                            'reason': '人工已核对所引发动机原文及对应需求，资质和当地投资意向还须核实。'}]
        status, _, raw = self.h.request('POST', '/api/funnel-review-push', body, cookie=self.cookie)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['added'], [NAME])
        expected = self.h.state()['PROJECTS']['a']['funnel']
        self.assertTrue(expected['pushed'])
        self.assertEqual(self.h.state()['PROJECTS']['a']['clues'][0]['investment_intent'], 'unknown')
        status, _, raw = self.h.request('POST', '/api/sync', {'PROJECTS': {'a': {'funnel': original}}}, cookie=self.cookie)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw)['ok'])
        self.assertEqual(self.h.state()['PROJECTS']['a']['funnel'], expected)

    def test_client_cannot_introduce_new_assessment_contract_or_scores_through_sync(self):
        _, _, _, _, refs = fixture()
        candidate = raw_company(refs)
        candidate.update(assessment_contract='evidence-assessment-v1', fit_score=100,
                         assessed_score=100, assessed_max=100, score_status='complete', score_range=[100, 100])
        incoming = {'scoring_contract': 'evidence-assessment-v1', 'rubric_version': 'forged',
                    'evidence_contract': 'saved-excerpts-v1', 'companies': [candidate]}
        status, _, raw = self.h.request('POST', '/api/sync', {'PROJECTS': {'a': {'funnel': incoming}}}, cookie=self.cookie)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw)['ok'])
        saved = self.h.state()['PROJECTS']['a']['funnel']
        self.assertNotIn('scoring_contract', saved)
        self.assertNotIn('rubric_version', saved)
        for field in ('assessment_contract', 'assessments', 'fit_score', 'assessed_score', 'assessed_max', 'score_status', 'score_range'):
            self.assertNotIn(field, saved['companies'][0])

    def test_get_sync_marks_changed_assessment_only_sources_without_writing_archive(self):
        for label, text in [('match', PRODUCT), ('relocate', EXPANSION), ('strength', STRENGTH)]:
            with self.subTest(dimension=label):
                original = self.generate()
                state = self.h.state()
                # The main company.evidence points only at its product source.
                self.assertEqual(len(original['companies'][0]['evidence']), 1)
                state['PROJECTS']['a']['kb'][0]['known'] = [row for row in state['PROJECTS']['a']['kb'][0]['known']
                                                          if row['text'] != text]
                self.h.replace(state)
                before = self.h.path.read_bytes()
                status, _, raw = self.h.request('GET', '/api/sync', cookie=self.cookie)
                self.assertEqual(status, 200)
                company = json.loads(raw)['PROJECTS']['a']['funnel']['companies'][0]
                self.assertTrue(company['assessment_stale'])
                self.assertIn('原文', company['assessment_stale_reason'])
                self.assertEqual(company['fit_score'], 100)
                self.assertEqual(self.h.path.read_bytes(), before)
                self.assertEqual(self.h.state()['PROJECTS']['a']['funnel'], original)

    def test_get_sync_marks_changed_demand_topic_version_or_missing_context_read_only(self):
        for change in ('demand', 'topic', 'version', 'missing'):
            with self.subTest(change=change):
                original = self.generate()
                state = self.h.state()
                if change == 'demand':
                    state['REPORTSTATE']['a']['aiReportByTopic'][TOPIC] = DEMAND + ' 新增不同技术条件。'
                elif change == 'topic':
                    state['PROJECTS']['a']['topic'] = '核电配套'
                elif change == 'version':
                    state['PROJECTS']['a']['reportRequestId'] = 'r2'
                else:
                    state['PROJECTS']['a']['kb'] = []
                    state['REPORTSTATE']['a'] = {}
                self.h.replace(state)
                before = self.h.path.read_bytes()
                status, _, raw = self.h.request('GET', '/api/sync', cookie=self.cookie)
                self.assertEqual(status, 200)
                company = json.loads(raw)['PROJECTS']['a']['funnel']['companies'][0]
                self.assertTrue(company['assessment_stale'])
                self.assertTrue(company['assessment_stale_reason'])
                self.assertEqual(self.h.path.read_bytes(), before)
                self.assertEqual(self.h.state()['PROJECTS']['a']['funnel'], original)

    def test_get_sync_keeps_current_assessments_unmarked_and_does_not_mutate_storage(self):
        original = self.generate()
        before = self.h.path.read_bytes()
        status, _, raw = self.h.request('GET', '/api/sync', cookie=self.cookie)
        self.assertEqual(status, 200)
        company = json.loads(raw)['PROJECTS']['a']['funnel']['companies'][0]
        self.assertNotIn('assessment_stale', company)
        self.assertEqual(company, original['companies'][0])
        self.assertEqual(self.h.path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
