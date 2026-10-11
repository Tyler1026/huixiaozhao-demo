"""Deterministic dual-anchor review; no live model or production storage."""
import copy
import unittest

from backend.auth import AuthError
from backend.evidence_grounding import (project_context, evidence_catalog, ground_funnel,
    funnel_demand_anchors, review_and_push)


def fixture():
    topic = '核电换热配套'
    state = {'PROJECTS': {'p': {'id': 'p', 'city': '闵行区', 'topic': topic, 'reportRequestId': 'r1',
        'kb': [{'t': '企业', 'known': [
            {'text': '甲公司生产核电换热器耐蚀管材，需要核查合格供应商资质。来源 https://official.example/a'},
            {'text': '深圳深研生物从事病毒载体开发与细胞分离服务。来源 https://official.example/b'}]}]},
        'other': {'id': 'other', 'city': '闵行区', 'topic': topic}},
        'REPORTSTATE': {'p': {'topic': topic, 'phaseByTopic': {topic: 2},
            'aiReportByTopic': {topic: '当前需求是核电换热器耐蚀管材，并须逐项核查产品资质和技术条件。'},
            'pendingByTopic': {topic: [
                {'text': '待确认的额外核电产品技术需求事项', 'status': 'pending'},
                {'text': '原始密封材料要求需要修改后确认', 'status': 'edited', 'editedText': '已确认高温高压密封材料的具体适用范围和检测条件'}]}}}}
    body = {'projectKey': 'p', 'topic': topic, 'reportRequestId': 'r1'}
    ctx = project_context(body, state)
    cat = evidence_catalog(ctx['chunks'])
    raw = [{'name': name, 'evidence_ids': [next(r['id'] for r in cat if name in r['quote'])]}
           for name in ['甲公司', '深圳深研生物']]
    state['PROJECTS']['p']['funnel'] = ground_funnel({'companies': raw}, cat, ctx)
    anchors = funnel_demand_anchors(ctx)
    reviews = []
    for company in state['PROJECTS']['p']['funnel']['companies']:
        ref = company['evidence'][0]
        reviews.append({'name': company['name'], 'product': {'evidenceId': ref['id'], 'quote': ref['quote']},
            'demand': {'anchorId': anchors[-1]['id'], 'quote': anchors[-1]['quote']},
            'reason': '逐项对照所供产品与当前需求的技术范围，后续仍需核验资质', 'confirmed': True})
    return state, dict(body, names=['甲公司'], reviews=reviews[:1]), reviews


class FunnelMatchReviewTests(unittest.TestCase):
    def assert_rejected_unchanged(self, state, body, code=None):
        before = copy.deepcopy(state)
        with self.assertRaises(AuthError) as caught:
            review_and_push(body, state, 'admin')
        if code:
            self.assertEqual(caught.exception.code, code)
        self.assertEqual(state, before, 'all validations must precede any clue/funnel write')

    def test_unrelated_named_material_and_shared_note_cannot_push(self):
        state, body, _ = fixture()
        body.update(names=['深圳深研生物'], reviewNote='已经检查来源因此应该可以推荐给当前项目')
        body.pop('reviews')
        self.assert_rejected_unchanged(state, body, 'review_required')

    def test_positive_two_anchor_review_retains_quotes_and_unknown_intent(self):
        state, body, _ = fixture()
        result = review_and_push(body, state, 'admin')
        self.assertEqual(result['added'], ['甲公司'])
        clue = state['PROJECTS']['p']['clues'][0]
        self.assertEqual(clue['review']['product'], dict(body['reviews'][0]['product'], urls=['https://official.example/a']))
        self.assertEqual(clue['review']['demand']['quote'], body['reviews'][0]['demand']['quote'])
        self.assertEqual(clue['review']['scope'], 'human_match_review_pending')
        self.assertFalse(clue['hasMoveSignal'])
        self.assertEqual(clue['investment_intent'], 'unknown')
        self.assertIn('待核验', clue['reason'])
        self.assertEqual(review_and_push(body, state, 'admin')['added'], [])

    def test_missing_per_company_reason_confirmation_or_anchor_rejected(self):
        for field, bad in [('reason', '已核'), ('confirmed', False), ('product', {}), ('demand', {})]:
            state, body, _ = fixture()
            body['reviews'][0][field] = bad
            self.assert_rejected_unchanged(state, body)

    def test_another_company_source_and_changed_quotes_are_rejected(self):
        for variant in ('other_source', 'changed_product', 'changed_demand', 'pending_confirmation', 'foreign_anchor'):
            state, body, reviews = fixture()
            review = body['reviews'][0]
            if variant == 'other_source': review['product'] = reviews[1]['product']
            if variant == 'changed_product': review['product']['quote'] += '虚构产品'
            if variant == 'changed_demand': review['demand']['quote'] += '修改条件'
            if variant == 'pending_confirmation': review['demand'] = {'anchorId': 'confirmation:0', 'quote': '待确认的额外核电产品技术需求事项'}
            if variant == 'foreign_anchor': review['demand'] = {'anchorId': 'report:99', 'quote': '当前需求是核电换热器耐蚀管材，并须逐项核查产品资质和技术条件。'}
            self.assert_rejected_unchanged(state, body)

    def test_changed_report_or_topic_cannot_reuse_review(self):
        for variant in ('report', 'topic', 'body'):
            state, body, _ = fixture()
            if variant == 'report': state['PROJECTS']['p']['reportRequestId'] = 'r2'
            if variant == 'topic': state['PROJECTS']['p']['topic'] = '另一个仍有历史记录的方向'
            if variant == 'body': state['REPORTSTATE']['p']['aiReportByTopic'][body['topic']] += ' 条件修改'
            self.assert_rejected_unchanged(state, body)

    def test_second_invalid_review_does_not_partially_push_first(self):
        state, body, reviews = fixture()
        body.update(names=['甲公司', '深圳深研生物'], reviews=reviews)
        body['reviews'][1]['reason'] = ''
        self.assert_rejected_unchanged(state, body, 'review_required')

    def test_every_saved_reference_must_still_match_even_when_not_selected(self):
        for bad in ({}, {'id': []}, {'id': 'missing', 'quote': '旧文', 'urls': []}):
            state, body, _ = fixture()
            state['PROJECTS']['p']['funnel']['companies'][0]['evidence'].append(bad)
            self.assert_rejected_unchanged(state, body, 'evidence_changed')
        state, body, _ = fixture()
        state['PROJECTS']['p']['funnel']['companies'][0]['evidence'][0]['quote'] += '客户端篡改'
        self.assert_rejected_unchanged(state, body, 'evidence_changed')

    def test_confirmed_edited_anchor_uses_new_text_not_old(self):
        state, body, _ = fixture()
        ctx = project_context(body, state)
        anchor = next(a for a in funnel_demand_anchors(ctx) if a['id'] == 'confirmation:1')
        body['reviews'][0]['demand'] = {'anchorId': anchor['id'], 'quote': anchor['quote']}
        self.assertEqual(review_and_push(body, state, 'admin')['added'], ['甲公司'])

    def test_duplicate_reviews_malformed_ids_and_no_full_report_rejected(self):
        for variant in ('duplicate', 'product_id', 'demand_id', 'draft'):
            state, body, _ = fixture()
            if variant == 'duplicate': body['reviews'].append(copy.deepcopy(body['reviews'][0]))
            if variant == 'product_id': body['reviews'][0]['product']['evidenceId'] = []
            if variant == 'demand_id': body['reviews'][0]['demand']['anchorId'] = {}
            if variant == 'draft': state['REPORTSTATE']['p']['phaseByTopic'][body['topic']] = 1
            self.assert_rejected_unchanged(state, body)

    def test_empty_funnel_is_completed_but_invalid_nonempty_remains_failure(self):
        state, body, _ = fixture(); ctx=project_context(body,state); cat=evidence_catalog(ctx['chunks'])
        out=ground_funnel({'companies': []},cat,ctx)
        self.assertEqual(out['companies'], [])
        self.assertIn('不代表现实中不存在',out['notice'])
        with self.assertRaises(ValueError): ground_funnel({'companies':[{'name':'编造企业'}]},cat,ctx)
        with self.assertRaises(ValueError): ground_funnel({},cat,ctx)


if __name__ == '__main__': unittest.main()
