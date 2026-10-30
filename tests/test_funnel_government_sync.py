"""Actual admin push -> durable HTTP state -> government sync -> production UI.

All accounts, business records and URLs below are isolated test fixtures. No
production credentials, external model, or real government data is accessed.
"""
import copy
import json
import subprocess
import unittest
from pathlib import Path

from backend.evidence_grounding import project_context, ground_funnel, funnel_demand_anchors
from backend.funnel_research import originals_catalog, seal_catalog
from test_auth_http import HttpFixture, PASSWORD

ROOT=Path(__file__).resolve().parents[1]


class FunnelGovernmentSyncTests(unittest.TestCase):
    def test_signed_funnel_push_survives_stale_sync_fresh_login_and_government_render(self):
        with HttpFixture() as h:
            admin=h.admin()
            gov,_=h.register('funnel-gov-owner')
            foreign,_=h.register('other-city-owner','TEAM_B')
            def submit(title,request_id):
                body={'mode':'direct','projectKey':'project-a','requestId':request_id,
                      'demand':{'title':title,'description':'寻找具备量产交付能力的新能源专用汽车电驱动系统企业，具体合作计划需要进一步洽谈。',
                                'conditions':'需核对电驱系统规格和专用汽车适配条件'}}
                status,_,raw=h.request('POST','/api/industry-demand',body,cookie=gov)
                self.assertEqual(status,200,raw)
                return json.loads(raw)['projectKey']
            key=submit('新能源专用车电驱系统配套','funnel-sync:target')
            sibling=submit('另一项专用车配套需求','funnel-sync:sibling')
            state=h.state();project=state['PROJECTS'][key]
            body={'projectKey':key,'topic':project['topic'],
                  'reportRequestId':'demand:'+project['directRequestFingerprint']}
            ctx=project_context(body,state)
            name='隔离测试甲电驱科技有限公司'
            quote=name+'研发生产新能源专用汽车电驱动系统，提供产品适配及测试服务；实际可供型号、产能与合作安排需要进一步核验。'
            catalog=originals_catalog([{'url':'https://official.example/isolated-products','text':quote}],ctx['topic'])
            self.assertEqual(len(catalog),1)
            funnel=ground_funnel({'companies':[{'name':name,'evidence_ids':[catalog[0]['id']]}]},catalog,ctx)
            funnel['researchEvidence']=seal_catalog(catalog,ctx)
            state['PROJECTS'][key]['funnel']=funnel
            h.replace(state)
            status,_,raw=h.request('GET','/api/sync',cookie=gov)
            self.assertEqual(status,200);stale=json.loads(raw)
            anchor=funnel_demand_anchors(ctx)[0]
            push=dict(body,names=[name],reviews=[{'name':name,'confirmed':True,
                'product':{'evidenceId':catalog[0]['id'],'quote':quote},
                'demand':{'anchorId':anchor['id'],'quote':anchor['quote']},
                'reason':'对照电驱产品原文和本项专用车适配需求，后续继续核实产品规格及供货资质'}])
            status,_,raw=h.request('POST','/api/funnel-review-push',push,cookie=admin)
            self.assertEqual(status,200,raw);self.assertEqual(json.loads(raw)['added'],[name])
            self.assertEqual(len(h.state()['PROJECTS'][key]['clues']),1)
            status,_,raw=h.request('POST','/api/funnel-review-push',push,cookie=admin)
            self.assertEqual(status,200);self.assertEqual(json.loads(raw)['added'],[])
            status,_,raw=h.request('POST','/api/sync',{'PROJECTS':stale['PROJECTS']},cookie=gov)
            self.assertEqual(status,200,raw)
            status,headers,raw=h.request('POST','/api/auth/login',
                {'username':'funnel-gov-owner','password':PASSWORD})
            self.assertEqual(status,200,raw)
            fresh=headers['Set-Cookie'].split(';',1)[0]
            status,_,raw=h.request('GET','/api/sync',cookie=fresh)
            self.assertEqual(status,200);view=json.loads(raw)
            clues=view['PROJECTS'][key]['clues']
            self.assertEqual(len(clues),1);self.assertEqual(clues[0]['name'],name)
            self.assertEqual(clues[0]['review']['product']['quote'],quote)
            self.assertEqual(clues[0]['investment_intent'],'unknown')
            self.assertFalse(view['PROJECTS'][sibling].get('clues'))
            status,_,raw=h.request('GET','/api/sync',cookie=foreign)
            self.assertEqual(status,200);self.assertNotIn(key,json.loads(raw)['PROJECTS'])
            rendered=subprocess.run(['node',str(ROOT/'tests/funnel_government_render.cjs')],
                input=json.dumps({'state':view,'key':key,'sibling':sibling,'name':name}),
                cwd=ROOT,encoding='utf-8',capture_output=True,timeout=15)
            self.assertEqual(rendered.returncode,0,rendered.stderr)
            self.assertTrue(json.loads(rendered.stdout)['rendered'])


if __name__=='__main__':unittest.main()
