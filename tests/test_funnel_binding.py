import copy
import json
import unittest
from backend.auth import AuthError
from backend.evidence_grounding import (project_context,evidence_catalog,ground_funnel,
    funnel_demand_anchors,review_and_push)
from backend.funnel_research import seal_catalog
from backend.industry_demands import create_industry_demand
from tests.test_industry_demands import state,request,PRINCIPAL


def bound_fixture():
    data=state()
    data['PROJECTS']['p']['kb']=[{'t':'企业原文','known':[{'text':
        '甲公司生产生物制药滤器，提供产品适配及测试服务，资质仍需另外核实。来源 https://official.example/product'}]}]
    first,second=[create_industry_demand(request(data,i),data,PRINCIPAL) for i in (0,1)]
    key=first['projectKey'];body={'projectKey':key,'topic':'生物医药','reportRequestId':''}
    ctx=project_context(body,data);catalog=evidence_catalog(ctx['chunks'])
    ref=next(r for r in catalog if '甲公司' in r['quote'])
    funnel=ground_funnel({'companies':[{'name':'甲公司','evidence_ids':[ref['id']]}]},catalog,ctx)
    funnel['researchEvidence']=seal_catalog([ref],ctx)
    data['PROJECTS'][key]['funnel']=funnel
    anchor=funnel_demand_anchors(ctx)[0]
    body.update(names=['甲公司'],reviews=[{'name':'甲公司','confirmed':True,
        'product':{'evidenceId':ref['id'],'quote':ref['quote']},
        'demand':{'anchorId':anchor['id'],'quote':anchor['quote']},
        'reason':'逐项对照该企业滤器产品与当前具体需求，后续核验规格与供货资质'}])
    return data,body,ctx,second['projectKey']


class FunnelBindingTests(unittest.TestCase):
    def test_readonly_redaction_preserves_business_identity_but_removes_real_secrets(self):
        from backend.access_control import _redact,scoped_sync_view
        data,body,ctx,_=bound_fixture()
        scoped=scoped_sync_view(data,{'scope':'admin','user':'test-admin'})
        self.assertEqual(scoped['PROJECTS'][body['projectKey']]['sourcePriorityKey'],ctx['sourcePriorityKey'])
        self.assertEqual(scoped['PROJECTS'][body['projectKey']]['funnel']['researchEvidence'],
                         data['PROJECTS'][body['projectKey']]['funnel']['researchEvidence'])
        public='["industry","滤器"]'
        self.assertEqual(_redact(public),public)
        private='{"password":"do-not-leak","business":"公开内容"}'
        self.assertEqual(json.loads(_redact(private)),{'business':'公开内容'})

    def test_legacy_redaction_spacing_does_not_break_exact_demand_signature(self):
        data,body,ctx,_=bound_fixture();fn=data['PROJECTS'][body['projectKey']]['funnel']
        legacy_ctx=dict(ctx,sourcePriorityKey=json.dumps(json.loads(ctx['sourcePriorityKey']),ensure_ascii=False))
        self.assertNotEqual(legacy_ctx['sourcePriorityKey'],ctx['sourcePriorityKey'])
        fn['sourcePriorityKey']=legacy_ctx['sourcePriorityKey']
        fn['researchEvidence']=seal_catalog(fn['researchEvidence']['catalog'],legacy_ctx)
        self.assertEqual(review_and_push(body,data,'admin')['added'],['甲公司'])
        self.assertEqual(fn['sourcePriorityKey'],ctx['sourcePriorityKey'])

    def test_missing_display_binding_recovers_only_from_exact_signed_demand_scope(self):
        for city in ('随州市','闵行区','成都市'):
            data,body,ctx,sibling=bound_fixture()
            # Generate the fixture afresh for each city; do not relabel a signed scope.
            for key in ('p',body['projectKey'],sibling):data['PROJECTS'][key]['city']=city
            ctx=project_context(body,data);fn=data['PROJECTS'][body['projectKey']]['funnel']
            fn['researchEvidence']=seal_catalog(fn['researchEvidence']['catalog'],ctx)
            fn.pop('sourcePriorityKey')
            result=review_and_push(body,data,'admin')
            self.assertEqual(result['added'],['甲公司'])
            self.assertEqual(fn['sourcePriorityKey'],ctx['sourcePriorityKey'])
            self.assertEqual(fn['binding_contract'],'demand-funnel-binding-v1')
            self.assertEqual(data['PROJECTS'][sibling]['clues'],[])

    def test_unsigned_mismatched_or_tampered_scope_never_repairs(self):
        for case in ('unsigned','project','city','priority','signature'):
            data,body,ctx,sibling=bound_fixture();fn=data['PROJECTS'][body['projectKey']]['funnel']
            fn.pop('sourcePriorityKey')
            if case=='unsigned':fn.pop('researchEvidence')
            elif case=='signature':fn['researchEvidence']['signature']='0'*64
            else:
                changed=dict(ctx,**({'projectKey':sibling} if case=='project' else {'city':'别的城市'} if case=='city' else {'sourcePriorityKey':'other'}))
                fn['researchEvidence']=seal_catalog(fn['researchEvidence']['catalog'],changed)
            before=copy.deepcopy(data)
            with self.assertRaises(AuthError) as caught:review_and_push(body,data,'admin')
            self.assertEqual(caught.exception.code,'funnel_stale')
            self.assertIn('并非核对项漏填',str(caught.exception))
            self.assertEqual(data,before)

    def test_invalid_form_does_not_partially_repair_binding(self):
        data,body,ctx,_=bound_fixture();fn=data['PROJECTS'][body['projectKey']]['funnel']
        fn.pop('sourcePriorityKey');body['reviews'][0]['reason']='太短'
        before=copy.deepcopy(data)
        with self.assertRaises(AuthError) as caught:review_and_push(body,data,'admin')
        self.assertEqual(caught.exception.code,'review_required')
        self.assertEqual(data,before)


if __name__=='__main__':unittest.main()
