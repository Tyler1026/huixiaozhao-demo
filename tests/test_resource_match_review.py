"""Resource-library delivery shares the authoritative dual-anchor boundary."""
import copy
import json
import unittest
from backend.auth import AuthError
from backend.evidence_grounding import resource_review_preview, review_and_push
from test_funnel_match_review import fixture
from test_auth_http import HttpFixture


def resource_fixture():
    state, body, reviews = fixture()
    state['OPS_ENT'] = [{'id': 'e1', 'name': '甲公司', 'signal': '客户端声称已投资', 'matches': [
        {'projKey': 'other', 'city': '闵行区', 'pushed': False, 'fit': 99},
        {'projKey': 'p', 'city': '松江区', 'pushed': False}]}, {'id': 'e2', 'name': '深圳深研生物', 'matches': []}]
    body.update(source='resource', resourceIds=['e1'])
    return state, body, reviews


class ResourceMatchTests(unittest.TestCase):
    def test_preview_is_read_only_uses_only_current_saved_sources_not_resource_claims(self):
        state, body, _ = resource_fixture(); before=copy.deepcopy(state)
        out=resource_review_preview(body,state)
        self.assertEqual(state,before)
        self.assertEqual(out['companies'][0]['resourceId'],'e1')
        self.assertEqual(out['companies'][0]['signal'],'')
        self.assertFalse(out['companies'][0]['push_eligible'])
        self.assertIn('核电换热器',out['companies'][0]['fit'])
        self.assertNotIn('客户端声称已投资',json.dumps(out,ensure_ascii=False))
        state['PROJECTS']['p']['kb']=[]
        out=resource_review_preview(body,state)
        self.assertEqual(out['companies'],[])
        self.assertEqual(out['unavailable'][0]['resourceId'],'e1')

    def test_resource_push_revalidates_and_only_marks_exact_successful_delivery(self):
        state,body,_=resource_fixture()
        before_other=copy.deepcopy(state['OPS_ENT'][0]['matches'])
        result=review_and_push(body,state,'admin')
        self.assertEqual(result['added'],['甲公司'])
        clue=state['PROJECTS']['p']['clues'][0]
        self.assertEqual(clue['sourceResourceId'],'e1')
        self.assertFalse(clue['hasMoveSignal'])
        self.assertEqual(clue['investment_intent'],'unknown')
        self.assertEqual(state['OPS_ENT'][0]['matches'][:2],before_other)
        self.assertTrue(state['OPS_ENT'][0]['matches'][2]['pushed'])
        self.assertEqual(state['OPS_ENT'][0]['matches'][2]['projKey'],'p')
        self.assertEqual(review_and_push(body,state,'admin')['added'],[])
        self.assertEqual(len(state['OPS_ENT'][0]['matches']),3)

    def test_missing_or_changed_resource_and_bad_anchor_are_atomic(self):
        for kind in ('deleted','renamed','product','ids','missing_id'):
            state,body,_=resource_fixture()
            if kind=='deleted': state['OPS_ENT']=[]
            if kind=='renamed': state['OPS_ENT'][0]['name']='其他企业'
            if kind=='product': body['reviews'][0]['product']['quote']+='改写'
            if kind=='ids': body['resourceIds']=['e1','e2']
            if kind=='missing_id': body.pop('reportRequestId')
            before=copy.deepcopy(state)
            with self.assertRaises(AuthError):review_and_push(body,state,'admin')
            self.assertEqual(state,before)

    def test_same_name_other_resource_never_inherits_pushed_state(self):
        state,body,_=resource_fixture();review_and_push(body,state,'admin')
        state['OPS_ENT'].append({'id':'different','name':'甲公司','matches':[]})
        body['resourceIds']=['different']
        self.assertEqual(review_and_push(body,state,'admin')['added'],[])
        self.assertEqual(state['OPS_ENT'][-1]['matches'],[])
        body['resourceIds']=['e1','different']
        with self.assertRaises(AuthError):resource_review_preview(body,state)

    def test_tombstone_skip_does_not_mark_resource_pushed(self):
        state,body,_=resource_fixture();state['DELETED_CLUES']=['p::@甲公司']
        out=review_and_push(body,state,'admin')
        self.assertEqual(out['added'],[])
        self.assertTrue(all(not m['pushed'] for m in state['OPS_ENT'][0]['matches']))

    def test_write_requires_explicit_current_request_string(self):
        for value in (None,12,'wrong'):
            state,body,_=fixture();body['reportRequestId']=value
            with self.assertRaises(AuthError):review_and_push(body,state,'admin')
        state,body,_=fixture();body.pop('reportRequestId')
        with self.assertRaises(AuthError):review_and_push(body,state,'admin')
        state,body,_=fixture();state['PROJECTS']['p']['reportRequestId']='';state['PROJECTS']['p']['funnel']['reportRequestId']='';body['reportRequestId']=''
        self.assertEqual(review_and_push(body,state,'admin')['added'],['甲公司'])


class ResourcePreviewHttpTests(unittest.TestCase):
    def setUp(self):
        self.h=HttpFixture().__enter__();self.addCleanup(self.h.__exit__);self.cookie=self.h.admin()
        current=self.h.state();state,self.body,_=resource_fixture();current.update(state);self.h.replace(current)

    def test_admin_preview_does_not_write_and_rejects_anonymous_or_member(self):
        before=self.h.path.read_bytes()
        status,_,raw=self.h.request('POST','/api/funnel-resource-preview',self.body,cookie=self.cookie)
        self.assertEqual(status,200);self.assertEqual(json.loads(raw)['source'],'resource')
        self.assertEqual(self.h.path.read_bytes(),before)
        status,_,_=self.h.request('POST','/api/funnel-resource-preview',self.body)
        self.assertEqual(status,401)
        member,_=self.h.register('preview-member')
        status,_,_=self.h.request('POST','/api/funnel-resource-preview',self.body,cookie=member)
        self.assertEqual(status,403)

    def test_http_push_stale_or_missing_anchor_is_atomic_and_valid_push_pending(self):
        before=self.h.path.read_bytes();bad=copy.deepcopy(self.body);bad['reviews'][0]['demand']['quote']+='伪造'
        status,_,_=self.h.request('POST','/api/funnel-review-push',bad,cookie=self.cookie)
        self.assertEqual(status,409);self.assertEqual(self.h.path.read_bytes(),before)
        status,_,raw=self.h.request('POST','/api/funnel-review-push',self.body,cookie=self.cookie)
        self.assertEqual(status,200);self.assertEqual(json.loads(raw)['status'],'pending_investment_verification')
        self.assertEqual(self.h.state()['PROJECTS']['p']['clues'][0]['investment_intent'],'unknown')


if __name__=='__main__':unittest.main()
