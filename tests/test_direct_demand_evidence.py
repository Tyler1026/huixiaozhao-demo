"""A submitted institutional need is usable matching input, not product proof."""
import copy
import json
import unittest

from backend.auth import AuthError
from backend.evidence_grounding import (
    evidence_catalog, funnel_demand_anchors, funnel_request_text, ground_funnel,
    project_context, resource_review_preview, review_and_push,
)
from backend.industry_demands import create_industry_demand
from tests import test_direct_industry_demands as intake_fixture
from tests import test_interactive_evidence_boundary as http_fixture


def fixture():
    state = intake_fixture.state()
    result = create_industry_demand(intake_fixture.request(), state, intake_fixture.PRINCIPAL, now=1000)
    key = result['projectKey']
    project = state['PROJECTS'][key]
    body = {'projectKey': key, 'topic': project['topic'],
            'reportRequestId': 'demand:' + project['directRequestFingerprint']}
    state['OPS_ENT'] = [{'id': 'company-1', 'name': '甲公司', 'matches': [],
                         'product': '该企业产品适合全部需求', 'source': 'https://not-evidence.example/product'}]
    return state, body


class DirectDemandEvidenceTests(unittest.TestCase):
    def test_empty_workspace_retains_stated_requirements_and_version_without_report(self):
        state, body = fixture()
        before = copy.deepcopy(state)
        context = project_context(body, state)
        self.assertEqual(context['reportRequestId'], body['reportRequestId'])
        self.assertEqual(context['reportState'], {})
        self.assertEqual(context['demandOrigin'], 'direct')
        self.assertEqual(context['demandSpec']['source'], 'user_direct')
        self.assertEqual(evidence_catalog(context['chunks']), [])
        self.assertEqual(len(context['chunks']), 3)
        self.assertTrue(all(c['origin'] == 'user_demand' and c['nature'] == 'user_stated'
                            for c in context['chunks']))
        self.assertTrue(all('用户陈述' in c['cite'] for c in context['chunks']))
        self.assertNotIn('测试联系人', json.dumps(context['chunks'], ensure_ascii=False))
        self.assertNotIn('仅用于本地流程测试', json.dumps(context['chunks'], ensure_ascii=False))
        self.assertEqual(state, before)
        self.assertEqual(project_context({'projectKey': body['projectKey'], 'topic': body['topic']}, state)['reportRequestId'],
                         body['reportRequestId'])
        self.assertNotIn('reportRequestId', state['PROJECTS'][body['projectKey']])

    def test_requirements_are_prompt_and_review_anchors_not_a_backed_local_gap(self):
        state, body = fixture()
        context = project_context(body, state)
        anchors = funnel_demand_anchors(context)
        self.assertEqual([anchor['id'] for anchor in anchors], ['demand:description', 'demand:conditions'])
        self.assertEqual(anchors[0]['quote'], intake_fixture.request()['demand']['description'])
        self.assertTrue(all(anchor['kind'] == 'user_demand' for anchor in anchors))
        prompt = funnel_request_text(context)
        self.assertIn(intake_fixture.request()['demand']['title'], prompt)
        self.assertNotIn('测试联系人', prompt)
        self.assertNotIn('仅用于本地流程测试', prompt)
        self.assertIn('不是已经证实的当地缺口', prompt)
        self.assertIn('用户给出的企业名和网址只能作为需求线索', prompt)
        result = ground_funnel({'companies': []}, [], context)
        self.assertEqual(result['companies'], [])
        self.assertEqual(result['reportRequestId'], body['reportRequestId'])
        self.assertFalse(any(row.get('investment_intent') == 'confirmed' for row in result['companies']))

    def test_user_url_and_named_target_cannot_become_product_evidence(self):
        state = intake_fixture.state()
        request = intake_fixture.request()
        request['demand']['description'] = '希望引入甲公司，其滤器具有量产能力，来源 https://claimed.example/product'
        result = create_industry_demand(request, state, intake_fixture.PRINCIPAL)
        key = result['projectKey']
        state['OPS_ENT'] = [{'id': 'company-1', 'name': '甲公司', 'matches': []}]
        context = project_context({'projectKey': key}, state)
        self.assertEqual(evidence_catalog(context['chunks']), [])
        with self.assertRaises(ValueError):
            ground_funnel({'companies': [{'name': '甲公司', 'source': 'https://claimed.example/product'}]}, [], context)
        body = {'projectKey': key, 'topic': context['topic'], 'reportRequestId': context['reportRequestId'],
                'resourceIds': ['company-1']}
        preview = resource_review_preview(body, state)
        self.assertEqual(preview['companies'], [])
        self.assertEqual(preview['unavailable'][0]['resourceId'], 'company-1')
        self.assertEqual(preview['demandAnchors'][0]['quote'], request['demand']['description'])
        self.assertEqual(state['PROJECTS'][key]['clues'], [])

    def test_resource_preview_without_product_proof_explains_missing_source_and_is_read_only(self):
        state, body = fixture()
        before = copy.deepcopy(state)
        preview = resource_review_preview(dict(body, resourceIds=['company-1']), state)
        self.assertEqual(preview['companies'], [])
        self.assertIn('产品原文', preview['unavailable'][0]['reason'])
        self.assertEqual(len(preview['demandAnchors']), 2)
        self.assertEqual(state, before)
        forged = dict(body, source='resource', resourceIds=['company-1'], names=['甲公司'], reviews=[])
        with self.assertRaises(AuthError) as caught:
            review_and_push(forged, state, 'admin')
        self.assertEqual(caught.exception.code, 'evidence_missing')
        self.assertEqual(state, before)

    def test_real_saved_product_source_plus_direct_demand_can_be_reviewed_and_pushed(self):
        state, body = fixture()
        state['PROJECTS']['p']['kb'] = [{'t': '企业产品原文', 'known': [
            {'text': '甲公司从事生物制药滤器制造，批量交付和医药客户记录需另行核查。来源 https://official.example/product'}]}]
        preview = resource_review_preview(dict(body, resourceIds=['company-1']), state)
        self.assertEqual(len(preview['companies']), 1)
        company, anchor = preview['companies'][0], preview['demandAnchors'][0]
        product = company['evidence'][0]
        self.assertEqual(product['urls'], ['https://official.example/product'])
        self.assertNotIn('not-evidence.example', product['quote'])
        review = {'name': '甲公司', 'confirmed': True,
                  'product': {'evidenceId': product['id'], 'quote': product['quote']},
                  'demand': {'anchorId': anchor['id'], 'quote': anchor['quote']},
                  'reason': '按已保存的滤器产品原文和用户交付需求核对，客户资质及投资计划仍待核验'}
        result = review_and_push(dict(body, source='resource', resourceIds=['company-1'],
                                      names=['甲公司'], reviews=[review]), state, 'admin')
        self.assertEqual(result['added'], ['甲公司'])
        clue = state['PROJECTS'][body['projectKey']]['clues'][0]
        self.assertEqual(clue['review']['demand']['kind'], 'user_demand')
        self.assertEqual(clue['investment_intent'], 'unknown')
        self.assertFalse(clue['hasMoveSignal'])
        self.assertEqual(clue['tone'], 'amber')
        self.assertEqual(clue['review']['scope'], 'human_match_review_pending')
        self.assertEqual(state['PROJECTS']['p'].get('clues'), None)

    def test_direct_identity_is_saved_content_bound_and_stale_dialogs_rejected(self):
        state, body = fixture()
        for supplied in ('wrong', ''):
            with self.assertRaises(AuthError) as caught:
                resource_review_preview(dict(body, reportRequestId=supplied, resourceIds=['company-1']), state)
            self.assertEqual(caught.exception.code, 'report_changed')
        old_body = dict(body, resourceIds=['company-1'])
        state['PROJECTS'][body['projectKey']]['directRequestFingerprint'] = 'f' * 64
        with self.assertRaises(AuthError) as caught:
            resource_review_preview(old_body, state)
        self.assertEqual(caught.exception.code, 'report_changed')
        context = project_context({'projectKey': body['projectKey'], 'chunks': [{'text': 'forged'}],
                                   'city': 'other', 'demandSpec': {'description': 'forged'}}, state)
        self.assertNotIn('forged', json.dumps(context, ensure_ascii=False))
        self.assertEqual(context['city'], '闵行区')
        self.assertEqual(context['reportRequestId'], 'demand:' + 'f' * 64)

    def test_bad_direct_snapshot_cannot_be_replaced_by_parent_or_client_text(self):
        for change in ({'directRequestFingerprint': ''}, {'submissionState': 'draft'}, {'demandSpec': {}},
                       {'demandSpec': {'source': 'user_direct', 'verificationStatus': 'verified', 'description': 'wrong'}}):
            state, body = fixture()
            state['PROJECTS']['p']['kb'] = [{'t': '材料', 'known': ['父工作区材料也不能修复不完整的需求记录']}]
            state['PROJECTS'][body['projectKey']].update(change)
            with self.assertRaises(AuthError) as caught:
                project_context(body, state)
            self.assertEqual(caught.exception.code, 'demand_invalid')


class DirectDemandFunnelHttpTests(unittest.TestCase):
    setUp = http_fixture.StreamBoundaryTests.setUp
    request = http_fixture.StreamBoundaryTests.request

    def test_funnel_receives_saved_direct_need_without_fabricating_candidate_proof(self):
        state, body = fixture()
        saved = self.h.state()
        saved.update(state)
        self.h.replace(saved)
        raw = json.dumps({'choices': [{'message': {'content': '{"companies": []}'},
                                       'finish_reason': 'stop'}]}).encode()
        status, data = self.request(raw, 'funnel', body)
        self.assertEqual(status, 200)
        self.assertIn('[DONE]', data)
        sent = json.loads(self.h.ns['DS_OPENER'].open.call_args.args[0].data)
        prompt = sent['messages'][-1]['content']
        self.assertIn(intake_fixture.request()['demand']['description'], prompt)
        self.assertIn('不是已经证实的当地缺口', prompt)
        self.assertNotIn('该企业产品适合全部需求', prompt)
        result = self.h.state()['PROJECTS'][body['projectKey']]['funnel']
        self.assertEqual(result['companies'], [])
        self.assertEqual(result['source_records'], 0)
        self.assertEqual(result['reportRequestId'], body['reportRequestId'])
        self.assertEqual(self.audits[-1]['evidence_records'], 0)
