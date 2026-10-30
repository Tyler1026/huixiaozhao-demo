import copy
import json
import unittest
from unittest.mock import patch
from backend.funnel_route import serve_funnel
from backend.evidence_grounding import project_context
from backend.funnel_research import seal_catalog
from tests.test_topic_priorities_route import Handler


class FunnelRouteTests(unittest.TestCase):
    def run_route(self,handler,build,stream=True):
        request={'projectKey':'p','topic':handler.data['PROJECTS']['p']['topic'],'stream':stream}
        with patch('backend.funnel_route.require_session',return_value=handler._principal),patch(
                'backend.access_control.scoped_sync_view',side_effect=lambda state,principal:copy.deepcopy(state)):
            serve_funnel(handler,request,complete=lambda *a:None,audit=lambda row:None,build=build)
        raw=handler.wfile.getvalue().decode()
        if not stream:return json.loads(raw)
        return [json.loads(line[6:]) for line in raw.splitlines() if line.startswith('data: {')]

    def output(self,context,*args,**kwargs):
        kwargs['progress']('正在检索全国企业')
        return {'companies':[{'name':'甲公司'}],'evidence_contract':'saved-excerpts-v1',
                'projectKey':context['projectKey'],'topic':context['topic'],
                'reportRequestId':context['reportRequestId'],'status':'completed'}

    def test_progress_precedes_completed_persisted_result(self):
        handler=Handler();events=self.run_route(handler,self.output)
        self.assertEqual(handler.writes,1)
        self.assertEqual(events[0]['type'],'funnel_progress')
        self.assertEqual(events[-1]['choices'][0]['finish_reason'],'stop')
        self.assertEqual(handler.data['PROJECTS']['p']['funnel']['total'],1)

    def test_failure_and_changed_demand_never_overwrite_existing_candidates(self):
        for kind in ('upstream','changed','storage'):
            handler=Handler();handler.data['PROJECTS']['p']['funnel']={'companies':[{'name':'旧企业'}]}
            handler._scoped_state=copy.deepcopy(handler.data)
            before=copy.deepcopy(handler.data['PROJECTS']['p']['funnel'])
            def build(ctx,*args,**kwargs):
                if kind=='upstream':raise ValueError('upstream')
                if kind=='changed':handler.data['PROJECTS']['p']['topic']='另一方向'
                if kind=='storage':handler.write_ok=False
                return self.output(ctx,*args,**kwargs)
            events=self.run_route(handler,build)
            self.assertIn('error',events[-1])
            self.assertEqual(handler.data['PROJECTS']['p']['funnel'],before)

    def test_nonstream_response_has_same_completed_contract(self):
        handler=Handler();result=self.run_route(handler,self.output,stream=False)
        self.assertEqual(result['choices'][0]['finish_reason'],'stop')
        self.assertIn('message',result['choices'][0])

    def test_demand_loads_authorized_parent_city_package_with_parent_version(self):
        handler=Handler()
        handler.data['PROJECTS']['parent']={'city':'闵行区','reportRequestId':'city-r2'}
        handler.data['PROJECTS']['p'].update(workspaceId='parent',city='闵行区')
        handler._scoped_state=copy.deepcopy(handler.data)
        seen=[]
        with patch('backend.funnel_route.require_session',return_value=handler._principal),patch(
                'backend.access_control.scoped_sync_view',side_effect=lambda state,principal:copy.deepcopy(state)):
            serve_funnel(handler,{'projectKey':'p','topic':handler.data['PROJECTS']['p']['topic']},
                complete=lambda *a:None,audit=lambda row:None,build=self.output,
                package_loader=lambda ctx,state:seen.append(ctx) or {'sources':{},'evidence':[]})
        self.assertEqual(seen[0]['projectKey'],'parent')
        self.assertEqual(seen[0]['reportRequestId'],'city-r2')
        self.assertEqual(handler.writes,1)


if __name__=='__main__':unittest.main()
