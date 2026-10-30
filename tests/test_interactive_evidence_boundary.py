"""Interactive AI acceptance regressions: isolated saved evidence, no live API."""
import ast
import copy
import io
import json
import time
import unittest
import urllib.request
import urllib.error
import uuid
from pathlib import Path
from unittest.mock import Mock
from backend.auth import AuthError
from backend.evidence_grounding import (project_context, validate_confirmations,
    evidence_catalog, bounded_catalog, ground_funnel, ground_profile, ground_chain, review_and_push,
    enterprise_sources, ground_enterprise_draft)
from test_auth_http import HttpFixture


def sample():
    return {'PROJECTS': {
        'a': {'id': 'a', 'workspaceId': 'a', 'city': '同城区', 'topic': '液体火箭', 'reportRequestId': 'r1', 'kb': [{'t': '企业', 'known': [
            {'text': '星河动力公司从事液氧煤油发动机研发，扩产及本地投资意向待核。来源 https://official.example/engine'},
            {'text': '同城区地区生产总值4268.99亿元，第二排名为自媒体说法待核。来源 https://official.example/gdp'},
            {'text': '未见航空航天专项资金条款，不代表不存在。来源 https://official.example/policy'}]}]},
        'b': {'id': 'b', 'workspaceId': 'b', 'city': '同城区', 'topic': '液体火箭', 'kb': [{'t': '机密', 'known': ['OTHER_WORKSPACE_SECRET']}]},
        'child': {'id': 'child', 'workspaceId': 'a', 'city': '同城区', 'topic': '液体火箭', 'reportRequestId': 'r1'}},
        'REPORTSTATE': {'a': {'topic': '液体火箭', 'text': '当前版本报告独有内容：重点引入液氧煤油发动机研发和生产企业。', 'phaseByTopic': {'液体火箭': 1}, 'pendingByTopic': {'液体火箭': [{'text': '核实投资门槛', 'status': 'confirmed'}]}}}}


def review_fixture(ref):
    return {'name': '星河动力公司', 'product': {'evidenceId': ref['id'], 'quote': ref['quote']},
            'demand': {'anchorId': 'report:0', 'quote': '当前版本报告独有内容：重点引入液氧煤油发动机研发和生产企业。'},
            'reason': '已核查官方产品记录与液体火箭业务适配', 'confirmed': True}


def context():
    return project_context({'projectKey': 'a', 'topic': '液体火箭', 'reportRequestId': 'r1'}, sample())


class EvidenceTests(unittest.TestCase):
    def test_bounded_catalog_reaches_tail_and_keeps_whole_conditions(self):
        rows=[{'id':str(i),'topic':str(i%3),'quote':'必须满足30亿元门槛才可申请补助 '+str(i)} for i in range(300)]
        kept=bounded_catalog(rows,limit=15,char_limit=3000)
        self.assertEqual(len(kept),15)
        self.assertIn('299',{r['id'] for r in kept})
        self.assertTrue(all('30亿元门槛' in r['quote'] for r in kept))

    def test_exact_workspace_does_not_merge_same_city(self):
        c = context()
        self.assertNotIn('OTHER_WORKSPACE_SECRET', json.dumps(c, ensure_ascii=False))
        self.assertIn('当前版本报告独有内容', json.dumps(c, ensure_ascii=False))
        c = project_context({'projectKey': 'child', 'topic': '液体火箭'}, sample())
        self.assertEqual(c['workspaceId'], 'a')
        self.assertIn('星河', json.dumps(c, ensure_ascii=False))

    def test_scoped_state_cannot_be_overridden_by_request(self):
        state = sample(); del state['PROJECTS']['b']
        with self.assertRaises(AuthError):
            project_context({'projectKey': 'b', 'city': '同城区', 'chunks': [{'text':'forged'}]}, state)
        with self.assertRaises(AuthError):
            project_context({'projectKey': 'a', 'reportRequestId': 'old'}, state)
        with self.assertRaises(AuthError):
            project_context({'projectKey': 'a', 'topic': '异地产业'}, state)

    def test_confirmation_exact_saved_topic_and_status(self):
        c = context()
        validate_confirmations({'confirmations': [{'text':'核实投资门槛','status':'confirmed'}]}, c)
        for records in ([], [{'text':'核实投资门槛','status':'pending'}], [{'text':'另一个问题','status':'confirmed'}], [{'text':'核实投资门槛','status':'edited','editedText':''}]):
            with self.assertRaises(AuthError):
                validate_confirmations({'confirmations': records}, c)

    def test_fuel_mismatch_and_unsupported_investment_are_not_published(self):
        c=context(); cat=evidence_catalog(c['chunks']); ref=next(x for x in cat if '星河' in x['quote'])
        obj={'total_scanned':46,'companies':[{'name':'星河动力公司','kind':'液氧甲烷发动机','fit':'已承诺到同城区投资','score_relocate':30,'score_match':40,'signal':'已签约','evidence_ids':[ref['id']]}, {'name':'星河动力公司'}, {'name':'虚构企业','source':'https://evil.example'}]}
        result=ground_funnel(obj,cat,c)
        self.assertEqual(result['total_scanned'],1)
        company=result['companies'][0]
        self.assertEqual(company['kind'],'')
        self.assertIn('液氧煤油',company['fit'])
        self.assertNotIn('已承诺',company['fit'])
        self.assertIsNone(company['score_relocate'])
        self.assertEqual(company['investment_intent'],'unknown')
        self.assertEqual(company['signal'],'')
        self.assertEqual(company['source'],'https://official.example/engine')

    def test_catalog_never_borrows_another_line_company_source(self):
        c=context()
        cat=evidence_catalog([{'id':'multi','text':'甲公司计划开展液体火箭相关研发，实际业务及投资意向待核。\n乙公司从事液氧煤油发动机研发，来源 https://official.example/yi'}])
        unlinked=next(x for x in cat if '甲公司' in x['quote'])
        linked=next(x for x in cat if '乙公司' in x['quote'])
        self.assertEqual(unlinked['urls'],[])
        self.assertEqual(unlinked['status'],'pending')
        with self.assertRaises(ValueError):
            ground_funnel({'companies':[{'name':'甲公司','evidence_ids':[unlinked['id']]}]},cat,c)
        result=ground_funnel({'companies':[{'name':'乙公司','evidence_ids':[linked['id']]}]},cat,c)
        self.assertEqual(result['companies'][0]['source'],'https://official.example/yi')

    def test_profile_does_not_upgrade_uncertainty_or_missing_policy(self):
        c=context(); cat=evidence_catalog(c['chunks']); rank=next(x for x in cat if '排名' in x['quote']); policy=next(x for x in cat if '未见' in x['quote'])
        obj={'summary':'全国第二，航空航天政策缺位','objective':{'economy':[{'label':'排名','value':'全国第二','evidence_ids':[rank['id']]}], 'park':[{'label':'政策缺位','value':'没有专项政策','evidence_ids':[policy['id']]}]}, 'strength':['全国第二'], 'weakness':['没有政策'], 'charts':{'growth':[{'value':99}]}, 'preference':{'industry':{'source':'stated','items':['甲烷发动机']}}}
        out=ground_profile(obj,cat,c)
        self.assertNotIn('政策缺位',out['summary'])
        self.assertIn('自媒体说法待核',out['summary'])
        self.assertIn('不代表不存在',json.dumps(out,ensure_ascii=False))
        self.assertEqual(out['charts'],{})
        self.assertEqual(out['strength'],[])
        self.assertEqual(out['preference']['industry']['source'],'unknown')
        self.assertTrue(out['objective']['economy'])

    def test_stated_preference_must_be_saved_not_client_or_model(self):
        c=context();c['onboarding']={'industry':['高端装备']}
        out=ground_profile({},evidence_catalog(c['chunks']),c)
        self.assertEqual(out['preference']['industry']['items'],['高端装备'])
        self.assertEqual(out['preference']['industry']['source'],'stated')

    def test_legacy_chain_cannot_create_nodes_or_upgrade_strength_or_enterprises(self):
        c=context();c['city']='甲区'
        cat=evidence_catalog([{'id':'mixed','topic':c['topic'],'text':'液氧煤油发动机并非本地核心优势；甲区甲企业未从事发动机研发。来源 https://official.example/industry'}])
        for payload in ([], [{'seg':'上游','nodes':[{'name':'液氧煤油发动机','level':'strong','local_leaders':['甲企业'],'evidence_ids':[cat[0]['id']]}]}]):
            with self.assertRaisesRegex(ValueError, 'legacy_chain_disabled'):
                ground_chain(payload,cat,c)

    def test_review_rechecks_current_evidence_and_deduplicates_pending_clue(self):
        s=sample();s['REPORTSTATE']['a']['phaseByTopic']['液体火箭']=2
        c=context();cat=evidence_catalog(c['chunks']);ref=next(x for x in cat if '星河' in x['quote'])
        fn=ground_funnel({'companies':[{'name':'星河动力公司','evidence_ids':[ref['id']]}]},cat,c)
        s['PROJECTS']['a']['funnel']=fn
        body={'projectKey':'a','topic':'液体火箭','reportRequestId':'r1','names':['星河动力公司'],'reviews':[review_fixture(ref)]}
        first=review_and_push(body,s,'authenticated-admin')
        self.assertEqual(first['added'],['星河动力公司'])
        self.assertEqual(review_and_push(body,s,'authenticated-admin')['added'],[])
        clue=s['PROJECTS']['a']['clues'][0]
        self.assertEqual(clue['status'],'ops_rec')
        self.assertFalse(clue['hasMoveSignal'])
        self.assertEqual(clue['review']['actor'],'authenticated-admin')
        changed=copy.deepcopy(s);changed['PROJECTS']['a']['kb'][0]['known'][0]['text']='不同资料'
        with self.assertRaises(AuthError): review_and_push(body,changed,'admin')
        with self.assertRaises(AuthError): review_and_push(dict(body,reviews=[]),s,'admin')

    def test_push_reprojects_all_mutable_candidate_fields_from_current_sources(self):
        s=sample();s['REPORTSTATE']['a']['phaseByTopic']['液体火箭']=2
        c=context();cat=evidence_catalog(c['chunks']);ref=next(x for x in cat if '星河' in x['quote'])
        fn=ground_funnel({'companies':[{'name':'星河动力公司','kind':'液氧煤油发动机','evidence_ids':[ref['id']]}]},cat,c)
        forged=fn['companies'][0]
        forged.update(kind='液氧甲烷发动机',region='甲区',fit='星河动力公司已承诺在甲区投资10亿元',source='https://unrelated.example/forged',signal='已签约',hasMoveSignal=True,score_relocate=100)
        s['PROJECTS']['a']['funnel']=fn
        result=review_and_push({'projectKey':'a','topic':'液体火箭','reportRequestId':'r1','names':['星河动力公司'],'reviews':[review_fixture(ref)]},s,'admin')
        self.assertEqual(result['added'],['星河动力公司'])
        clue=s['PROJECTS']['a']['clues'][0]
        self.assertEqual(clue['kind'],'')
        self.assertEqual(clue['region'],'')
        self.assertEqual(clue['source'],'https://official.example/engine')
        self.assertIn('液氧煤油',clue['fit'])
        self.assertNotIn('已承诺',clue['fit'])
        self.assertNotIn('unrelated.example',json.dumps(clue,ensure_ascii=False))
        self.assertFalse(clue['hasMoveSignal'])
        self.assertEqual(clue['investment_intent'],'unknown')

    def test_enterprise_model_sources_never_self_certify_or_create_intent(self):
        obj={'kind':'火箭发动机','revenue':'10亿元','signal':'已签约甲区','sources':['https://forged.example']}
        self.assertEqual(enterprise_sources({'text':json.dumps(obj)}),[])
        unlinked=ground_enterprise_draft(obj,[],'甲企业')
        self.assertEqual(unlinked['kind'],'');self.assertEqual(unlinked['revenue'],'')
        citations=enterprise_sources({'type':'response.output_text.annotation.added','annotation':{'type':'url_citation','url':'https://official.example/company','title':'企业资料'}})
        linked=ground_enterprise_draft(obj,citations,'甲企业')
        self.assertEqual(linked['kind'],'火箭发动机')
        self.assertEqual(linked['field_status']['revenue'],'draft_unverified')
        self.assertEqual(linked['sources'][0]['url'],'https://official.example/company')
        self.assertNotIn('forged.example',json.dumps(linked))
        self.assertEqual(linked['signal'],'');self.assertFalse(linked['hasMoveSignal'])
        self.assertEqual(linked['investment_intent'],'unknown')


class FakeResponse(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self,*args): self.close()


class StreamBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.h=HttpFixture().__enter__();self.addCleanup(self.h.__exit__)
        self.cookie=self.h.admin()
        src=ast.parse((Path(__file__).parents[1]/'server.py').read_text())
        names={'_chunk_text','_tokenize','_retrieve_chunks','_is_upload_chunk','_chat_token_budget'}
        nodes=[n for n in src.body if isinstance(n,ast.FunctionDef) and n.name in names]
        import re
        ns=self.h.ns
        ns.update(time=time,uuid=uuid,hashlib=__import__('hashlib'),urllib=urllib,_re=re,_STOP=set(),_CHAT_SIMPLE_HINTS=(),_CHAT_ANALYTIC_HINTS=(),DS_URL='https://offline.invalid/chat',DS_RESP_URL='https://offline.invalid/responses',MODEL_CHAT='offline',DS_OPENER=Mock(),audit_log=lambda e:self.audits.append(e))
        for mode in ('SUGGEST','CHAT','DRAFT','RESEARCH','RESEARCH_CHAIN','TOPICS','FUNNEL','ONBOARD','CITY_PROFILE','FULL'):
            ns['SYSTEM_'+mode]='offline prompt'
        for mode in ('CHAT','CHAT_SIMPLE','CHAT_ANALYTIC','DRAFT','RESEARCH','CHAIN','FULL'):
            ns['MAX_TOKENS_'+mode]=100
        self.audits=[]
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'helpers','exec'),ns)
        saved=self.h.state();saved.update(sample());self.h.replace(saved)

    def request(self,raw,mode='research',extra=None):
        # These generic stream tests cover the legacy completion adapter.
        # draft/full now belong to the dedicated, source-bound report route.
        self.h.ns['DS_OPENER'].open.return_value=FakeResponse(raw)
        body={'question':'测试证据','mode':mode,'chunks':[],'stream':True,'projectKey':'a','topic':'液体火箭'}
        body.update(extra or {})
        status,_,data=self.h.request('POST','/api/kb-chat',body,cookie=self.cookie)
        return status,data.decode()

    def test_chat_completion_stop_is_explicit_success(self):
        raw=b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        status,data=self.request(raw)
        self.assertEqual(status,200);self.assertIn('[DONE]',data)
        self.assertEqual(self.audits[-1]['outcome'],'completed')
        self.assertIn('elapsed_ms',self.audits[-1])

    def test_eof_and_length_never_emit_success_done(self):
        for ending in ('', 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'):
            status,data=self.request(('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'+ending).encode())
            self.assertEqual(status,200);self.assertNotIn('[DONE]',data);self.assertIn('"error"',data)
            self.assertEqual(self.audits[-1]['outcome'],'incomplete')

    def test_responses_failed_and_incomplete_never_emit_done(self):
        for kind in ('response.failed','response.incomplete'):
            status,data=self.request(('data: '+json.dumps({'type':kind})+'\n\n').encode(),mode='chat')
            self.assertNotIn('[DONE]',data);self.assertIn('"error"',data)
        _,data=self.request(b'data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',mode='chat')
        self.assertIn('[DONE]',data)

    def test_structured_output_guard_runs_before_sse_publishes(self):
        cat=evidence_catalog(context()['chunks']);ref=next(x for x in cat if '星河' in x['quote'])
        obj={'companies':[{'name':'星河动力公司','kind':'液氧甲烷','evidence_ids':[ref['id']]}]}
        self.h.funnel_build_override=lambda ctx:ground_funnel(obj,evidence_catalog(ctx['chunks']),ctx)
        raw=json.dumps({'choices':[{'message':{'content':json.dumps(obj,ensure_ascii=False)},'finish_reason':'stop'}]}).encode()
        status,data=self.request(raw,'funnel',{'projectKey':'a','topic':'液体火箭','reportRequestId':'r1'})
        self.assertEqual(status,200);self.assertIn('saved-excerpts-v1',data);self.assertNotIn('液氧甲烷',data)
        supplied=json.dumps(self.h.funnel_build_calls[0],ensure_ascii=False)
        self.assertIn('液氧煤油',supplied);self.assertNotIn('OTHER_WORKSPACE_SECRET',supplied)
        self.h.ns['DS_OPENER'].open.assert_not_called()

    def test_funnel_search_failure_is_explicit_and_never_empty_success(self):
        raw=json.dumps({'choices':[{'message':{'content':'{"companies": []}'},'finish_reason':'stop'}]}).encode()
        status,data=self.request(raw,'funnel',{'projectKey':'a','topic':'液体火箭','reportRequestId':'r1'})
        self.assertEqual(status,200)
        event=json.loads(next(line[6:] for line in data.splitlines() if line.startswith('data: {')))
        self.assertIn('error',event)
        self.assertIn('原候选清单已保留',event['error']['message'])
        self.assertNotIn('funnel',self.h.state()['PROJECTS']['a'])
        self.assertIn('[DONE]',data)
        self.assertEqual(len(self.h.funnel_build_calls),1)
        self.h.ns['DS_OPENER'].open.assert_not_called()

    def test_full_gate_rejects_unconfirmed_before_upstream_call(self):
        status,data=self.request(b'',mode='full',extra={'purpose':'topic_full','projectKey':'a','topic':'液体火箭','reportRequestId':'r1','confirmations':[]})
        self.assertEqual(status,409);self.assertEqual(json.loads(data)['error'],'confirmation_required')
        self.h.ns['DS_OPENER'].open.assert_not_called()
        self.assertEqual(self.h.topic_research_calls,[]);self.assertEqual(self.h.topic_plan_calls,[])

    def test_full_without_purpose_cannot_bypass_confirmation(self):
        status,data=self.request(b'',mode='full',extra={'reportRequestId':'r1','confirmations':[]})
        self.assertEqual(status,409);self.assertEqual(json.loads(data)['error'],'confirmation_required')
        self.h.ns['DS_OPENER'].open.assert_not_called()
        self.assertEqual(self.h.topic_research_calls,[]);self.assertEqual(self.h.topic_plan_calls,[])

    def test_http_fixture_blocks_real_draft_research_without_faking_success(self):
        status,data=self.request(b'',mode='draft',extra={'reportRequestId':'r1'})
        self.assertEqual(status,200)
        self.assertIn('"error"',data);self.assertNotIn('[DONE]',data)
        self.assertEqual(len(self.h.topic_research_calls),1)
        self.assertEqual(self.h.topic_plan_calls,[])
        self.h.ns['DS_OPENER'].open.assert_not_called()

    def test_enterprise_endpoint_forces_admin_search_draft_not_report_mode(self):
        self.h.ns['DS_OPENER'].open.return_value=FakeResponse(b'data: {"type":"response.output_text.delta","delta":"{}"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n')
        status,_,raw=self.h.request('POST','/api/enterprise-enrich',{'entityName':'测试企业','question':'arbitrary report instructions','mode':'full'},cookie=self.cookie)
        self.assertEqual(status,200)
        sent=json.loads(self.h.ns['DS_OPENER'].open.call_args.args[0].data)
        self.assertIn('tools',sent)
        self.assertNotIn('arbitrary report instructions',json.dumps(sent))
        self.assertIn('企业资料待核草稿',sent['input'][-1]['content'])

    def test_enterprise_endpoint_buffers_and_labels_unverified_draft(self):
        model={'kind':'火箭发动机','revenue':'10亿元','signal':'已签约甲区','sources':['https://forged.example']}
        events=[{'type':'response.output_text.delta','delta':json.dumps(model,ensure_ascii=False)},
                {'type':'response.output_text.annotation.added','annotation':{'type':'url_citation','url':'https://official.example/company','title':'企业资料'}},
                {'type':'response.completed','response':{'status':'completed'}}]
        self.h.ns['DS_OPENER'].open.return_value=FakeResponse(''.join('data: '+json.dumps(e)+'\n\n' for e in events).encode())
        status,_,raw=self.h.request('POST','/api/enterprise-enrich',{'entityName':'甲企业'},cookie=self.cookie)
        self.assertEqual(status,200)
        text=raw.decode();self.assertIn('enterprise-draft-v1',text)
        self.assertNotIn('已签约',text);self.assertNotIn('forged.example',text)
        self.assertIn('draft_unverified',text);self.assertIn('https://official.example/company',text)
        events[-1]={'type':'response.incomplete'}
        self.h.ns['DS_OPENER'].open.return_value=FakeResponse(''.join('data: '+json.dumps(e)+'\n\n' for e in events).encode())
        _,_,raw=self.h.request('POST','/api/enterprise-enrich',{'entityName':'甲企业'},cookie=self.cookie)
        self.assertNotIn('火箭发动机',raw.decode());self.assertNotIn('[DONE]',raw.decode())

    def test_push_endpoint_admin_only_and_atomic(self):
        cookie,_=self.h.register('member')
        status,_,raw=self.h.request('POST','/api/funnel-review-push',{'projectKey':'a'},cookie=cookie)
        self.assertEqual(status,403)

if __name__=='__main__': unittest.main()
