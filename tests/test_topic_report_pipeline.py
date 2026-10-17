"""Interactive report facts, completion and version guards, without live services."""
import copy
import io
import json
import unittest
from unittest.mock import patch

from backend.topic_reports import build_report, normalize_plan, render_report, TopicReportError
from backend.topic_report_route import serve_topic_report
from backend.topic_evidence import topic_report_context
from backend.auth import AuthError


def bundle():
    return {'status': 'ready', 'evidence': [
        {'id': 'tr_'+'1'*20, 'url': 'https://www.shanghai.gov.cn/energy', 'title': '闵行氢能研发项目',
         'quote': '闵行区氢能研究院计划于2027年建成试验平台，首期重点研究储氢材料。申报单位必须具有独立法人资格。',
         'published_at': '2026-10-01', 'retrieved_at': '2026-10-16', 'status': 'source',
         'origin_id': 'o1', 'publisher_id': 'shanghai.gov.cn', 'source_type': 'government'},
        {'id': 'tr_'+'2'*20, 'url': 'https://www.miit.gov.cn/hydrogen', 'title': '氢能原始资料',
         'quote': '氢能研究院已发布储氢材料研究计划。本次公开资料没有披露采购合同或新增投资承诺。',
         'published_at': '2026-10-02', 'retrieved_at': '2026-10-16', 'status': 'source',
         'origin_id': 'o2', 'publisher_id': 'miit.gov.cn', 'source_type': 'government'}],
        'queries': ['闵行区 氢能 官方'], 'errors': []}


def plan():
    a, b = [x['id'] for x in bundle()['evidence']]
    return {'basis': [a], 'chain': [b],
            'priorities': [{'focus': '储氢材料', 'evidence_ids': [a, b], 'action': 'verify_supply'}],
            'companies': [{'name': '氢能研究院', 'evidence_ids': [a]}],
            'questions': [{'focus':'储氢材料','evidence_ids':[a],'action':'verify_supply'}, {'focus':'试验平台','evidence_ids':[a],'action':'verify_timeline'}, {'focus':'氢能研究院','evidence_ids':[a],'action':'contact_demand'}]}


def state():
    return {'PROJECTS': {'p': {'workspaceId': 'p', 'city': '闵行区', 'topic': '氢能', 'reportRequestId': 'r1',
            'kb': [{'t': '产业', 'known': [{'text': '氢能储氢材料需求仍需调研，不能据此确认已取得采购订单。'}]}]}},
            'REPORTSTATE': {'p': {'phaseByTopic': {'氢能': 1}, 'pendingByTopic': {'氢能': [{'text': '核实需求', 'status': 'confirmed'}]}}}}


class Handler:
    def __init__(self, data):
        self._scoped_state = data
        self._principal = {'user': 'local-test'}
        self.headers = {}
        self.wfile = io.BytesIO()
        self.status = None
        self.response_headers = {}
    def _account_config(self): return {}
    def send_response(self, code): self.status = code
    def send_header(self, k, v): self.response_headers[k] = v
    def end_headers(self): pass
    def cors(self): pass


class TopicProjectionTests(unittest.TestCase):
    def test_facts_preserve_plan_subject_and_complete_policy_conditions(self):
        result = build_report({'city': '闵行区', 'topic': '氢能'}, bundle(), 2, lambda *args: plan())
        self.assertIn('计划于2027年建成', result['text'])
        self.assertIn('必须具有独立法人资格', result['text'])
        self.assertNotIn('于2027年已建成', result['text'])
        self.assertIn('[来源 S1](https://www.shanghai.gov.cn/energy)', result['text'])
        self.assertEqual(result['status'], 'unreviewed')
        for chapter in '一二三四五': self.assertIn('## '+chapter+'、', result['text'])

    def test_arbitrary_model_facts_and_missing_sources_never_enter_report(self):
        p = plan(); p['basis'].append('made-up')
        p['summary'] = '已经完成投资100亿元'
        p['companies'].append({'name': '虚构公司', 'evidence_ids': p['basis']})
        p['priorities'].append({'focus': '储氢材料', 'evidence_ids': p['basis'], 'next_step': '落地即能锁定采购订单。'})
        out = build_report({'city': '闵行区', 'topic': '氢能'}, bundle(), 2, lambda *args: p)['text']
        self.assertNotIn('100亿元', out)
        self.assertNotIn('虚构公司', out)
        self.assertNotIn('落地即能锁定', out)

    def test_no_catalog_no_success_and_truncation_is_not_reassembled(self):
        with self.assertRaises(TopicReportError):
            build_report({'city': '闵行区', 'topic': '氢能'}, {'status': 'ready', 'evidence': []}, 1, lambda *args: plan())
        with self.assertRaises(TopicReportError):
            build_report({'city': '闵行区', 'topic': '氢能'}, bundle(), 1, lambda *args: '{"basis":[')

    def test_selection_json_is_small_and_draft_has_three_confirmable_questions(self):
        seen=[]
        result=build_report({'city': '闵行区', 'topic': '氢能'}, bundle(), 1, lambda *args: seen.append(args) or plan())
        self.assertEqual(seen[0][2],2200)
        self.assertEqual(result['text'].count('- ⚠️ '),3)
        self.assertNotIn('## 五、',result['text'])

    def test_html_and_markdown_from_external_text_are_not_executed(self):
        b=bundle();b['evidence'][0]['quote']+=' <script>alert(1)</script> [x](javascript:bad)'
        out=build_report({'city':'闵行区','topic':'氢能'},b,1,lambda *args:plan())['text']
        self.assertNotIn('<script>',out)
        self.assertIn('&lt;script&gt;',out)
        self.assertIn('\\[x\\]',out)


    def test_unsafe_suggestion_cannot_hide_claims_in_action_prose(self):
        p=plan()
        p['priorities']=[{'focus':'储氢材料','evidence_ids':p['basis'],'next_step':'建议依托甲公司在闵行已投产的基地对接采购'}]
        p['companies']=[{'name':'闵行','evidence_ids':p['basis']}]
        clean=normalize_plan(p,bundle())
        self.assertEqual(clean['priorities'],[])
        self.assertEqual(clean['companies'],[])


    def test_literal_quote_must_match_archived_original_and_source_footnotes_remain_valid(self):
        from backend.topic_research import validate_report
        b=bundle();row=b['evidence'][0];row['source_id']='archive-1'
        b['sources']={'archive-1':{'fulltext':'完全不同的氢能项目计划文字，不能支持被篡改的金额。'}}
        self.assertEqual(validate_report(row['quote']+' ['+row['id']+']',b,require_citations=False)['status'],'unsupported')
        row['quote']+=' 附注[1]为原文脚注。'
        b['sources']['archive-1']['fulltext']=row['quote']
        result=validate_report(row['quote']+' ['+row['id']+']',b,require_citations=False)
        self.assertFalse(result['issues'])
        self.assertNotEqual(result['status'],'unsupported')


    def test_company_needs_direct_product_match_not_shared_news_paragraph(self):
        b=bundle();b['topic']='聚变能源'
        sid=b['evidence'][0]['id']
        b['evidence'][0]['quote']='宁德时代新能源科技股份有限公司设立未来能源创新中心。另一项独立计划研发聚变磁体，与前述项目没有产品关联。'
        p=plan();p['companies']=[{'name':'宁德时代新能源科技股份有限公司','product':'聚变磁体','evidence_ids':[sid]}]
        self.assertEqual(normalize_plan(p,b)['companies'],[])
        b['evidence'][0]['quote']='甲方超导科技股份有限公司研发聚变磁体，提供聚变装置所需的高温超导产品。'
        p['companies']=[{'name':'甲方超导科技股份有限公司','product':'聚变磁体','evidence_ids':[sid]}]
        self.assertEqual(len(normalize_plan(p,b)['companies']),1)

    def test_company_product_binding_rejects_other_subject_negation_and_plans(self):
        b=bundle();b['topic']='聚变能源';sid=b['evidence'][0]['id']
        p=plan();p['companies']=[{'name':'甲材料有限公司','product':'聚变磁体','evidence_ids':[sid]}]
        rejected = [
            '甲材料有限公司生产普通包装材料，乙科技有限公司生产聚变磁体并公开研发计划。',
            '甲材料有限公司与乙科技有限公司共同生产聚变磁体，具体供货主体仍须核查。',
            '甲材料有限公司明确不生产聚变磁体，当前主营普通包装材料。',
            '甲材料有限公司尚未生产聚变磁体，目前仅开展原料分析工作。',
            '甲材料有限公司拟生产聚变磁体，当前项目尚处于研究阶段。',
            '甲材料有限公司计划研发聚变磁体，并准备开展人才招聘。',
            '甲材料有限公司生产的聚变磁体项目计划明年建成，目前没有形成产能。',
            '甲材料有限公司供应商生产聚变磁体，相关合作尚在商谈。',
            '甲材料有限公司提供关于聚变磁体的市场研究报告，主营研究咨询。',
            '甲材料有限公司参观聚变磁体生产基地，并听取设备情况介绍。',
            '甲材料有限公司生产包装材料用于聚变磁体运输，主营塑料制品。',
            '甲材料有限公司生产聚变磁体展示模型，实物磁体由其他主体生产。',
            '报道提及甲材料有限公司，并介绍聚变磁体产业的发展方向。',
        ]
        for quote in rejected:
            with self.subTest(quote=quote):
                b['evidence'][0]['quote']=quote
                self.assertEqual(normalize_plan(p,b)['companies'],[])

    def test_affirmative_company_product_clause_keeps_source_and_is_only_a_lead(self):
        b=bundle();b['topic']='聚变能源';sid=b['evidence'][0]['id']
        quote='甲材料有限公司自主研发聚变磁体，提供聚变装置所需的高温超导产品。'
        b['evidence'][0]['quote']=quote
        p=plan();p['companies']=[{'name':'甲材料有限公司','product':'聚变磁体','evidence_ids':[sid]}]
        clean=normalize_plan(p,b)
        self.assertEqual(len(clean['companies']),1)
        text,_=render_report(clean,{'city':'闵行区','topic':'聚变能源'},b,2)
        self.assertIn(quote,text)
        self.assertIn('待核查产品线索关键词：聚变磁体',text)
        self.assertIn('不构成能力、适配性或投资意向的确认',text)
        self.assertNotIn('原文披露的匹配产品',text)

    def test_product_binding_cannot_shorten_another_company_name(self):
        b=bundle();b['topic']='聚变能源';sid=b['evidence'][0]['id']
        b['evidence'][0]['quote']='中国甲材料有限公司研发聚变磁体，产品正在开展应用验证。'
        p=plan();p['companies']=[{'name':'甲材料有限公司','product':'聚变磁体','evidence_ids':[sid]}]
        self.assertEqual(normalize_plan(p,b)['companies'],[])


class TopicRouteTests(unittest.TestCase):
    def body(self): return {'mode':'full','stream':True,'projectKey':'p','topic':'氢能','reportRequestId':'r1',
                            'confirmations':[{'text':'核实需求','status':'confirmed'}], 'clientMaterialFingerprint':'a'*64}
    def run_route(self, handler, *, current=None, research=None, complete=None):
        audits=[]
        with patch('backend.topic_report_route.require_session', return_value={'user':'local-test'}), \
             patch('backend.topic_report_route.scoped_sync_view', side_effect=lambda data, principal:data):
            serve_topic_report(handler,self.body(),read_state=lambda:current or handler._scoped_state,
                research=research or (lambda *args,**kwargs:bundle()),complete=complete or (lambda *args:plan()),audit=audits.append)
        return handler.wfile.getvalue().decode(),audits

    def test_status_sources_and_explicit_completion_are_present(self):
        h=Handler(state());text,audits=self.run_route(h)
        self.assertEqual(h.status,200)
        self.assertIn('research.status',text)
        self.assertIn('research.evidence',text)
        self.assertIn('research.complete',text)
        self.assertIn('"finish_reason": "stop"',text)
        self.assertIn('[DONE]',text)
        self.assertEqual(audits[-1]['outcome'],'completed')
        self.assertEqual(audits[-1]['sourceFingerprint'],topic_report_context(self.body(),h._scoped_state)['sourceFingerprint'])

    def test_missing_real_research_is_terminal_not_generic_fallback(self):
        h=Handler(state());text,audits=self.run_route(h,research=lambda *args,**kwargs:{'status':'unavailable','evidence':[]})
        self.assertIn('research_unavailable',text)
        self.assertNotIn('"finish_reason": "stop"',text)
        self.assertNotIn('[DONE]',text)
        self.assertEqual(audits[-1]['outcome'],'incomplete')

    def test_material_change_during_generation_rejects_all_final_text(self):
        h=Handler(state());changed=copy.deepcopy(h._scoped_state)
        changed['PROJECTS']['p']['kb'][0]['known'].append({'text':'氢能采购需求更新，需要核对新版本。'})
        text,audits=self.run_route(h,current=changed)
        self.assertIn('evidence_changed',text)
        self.assertNotIn('"finish_reason": "stop"',text)
        events=[json.loads(line[6:]) for line in text.splitlines() if line.startswith('data: {')]
        self.assertFalse(any((choice.get('delta') or {}).get('content') for event in events for choice in event.get('choices',[])))

    def test_model_failure_and_session_revocation_cannot_finish(self):
        h=Handler(state())
        def fail(*args): raise TopicReportError('incomplete_report_plan','未完成')
        text,_=self.run_route(h,complete=fail)
        self.assertNotIn('[DONE]',text)
        h=Handler(state())
        with patch('backend.topic_report_route.require_session',side_effect=AuthError(401,'auth_required','请登录')):
            audits=[]
            serve_topic_report(h,self.body(),read_state=lambda:h._scoped_state,
                research=lambda *a,**kw:bundle(),complete=lambda *a:plan(),audit=audits.append)
        self.assertIn('auth_required',h.wfile.getvalue().decode())
        self.assertNotIn('[DONE]',h.wfile.getvalue().decode())


    def test_explicitly_unsupported_check_blocks_success(self):
        h=Handler(state())
        verdict={'status':'unsupported','checks':[{'support_status':'unsupported','sources':[]}],'issues':[]}
        with patch('backend.topic_report_route.validate_report',return_value=verdict):
            text,_=self.run_route(h)
        self.assertIn('evidence_validation_failed',text)
        self.assertNotIn('[DONE]',text)

    def test_missing_base_version_is_rejected_before_any_research(self):
        h=Handler(state());body=self.body();body.pop('reportRequestId');called=[]
        serve_topic_report(h,body,read_state=lambda:h._scoped_state,complete=lambda *a:called.append(a),
                           research=lambda *a,**kw:called.append(a),audit=lambda x:None)
        self.assertEqual(h.status,409);self.assertEqual(called,[])


if __name__ == '__main__': unittest.main()
