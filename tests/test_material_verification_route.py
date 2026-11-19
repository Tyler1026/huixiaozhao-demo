"""Real handler dispatch must keep verification out of the full-report route."""
import json
import unittest
import test_interactive_evidence_boundary as boundary
from test_material_verification import sample


class VerificationRouteTests(unittest.TestCase):
    setUp=boundary.StreamBoundaryTests.setUp

    def test_verify_uses_saved_uploads_short_prompt_and_completion_stream(self):
        state=self.h.state()
        for name,value in sample().items():state[name]=value
        self.h.replace(state)
        raw=('data: '+json.dumps({'choices':[{'delta':{'content':'⚠️ GDP：文件写999亿元，统计口径需核实。'}}]})+'\n\n'
             'data: '+json.dumps({'choices':[{'delta':{},'finish_reason':'stop'}]})+'\n\n').encode()
        self.h.ns['DS_OPENER'].open.return_value=boundary.FakeResponse(raw)
        status,_,data=self.h.request('POST','/api/kb-chat',{'mode':'verify','question':'CLIENT_FAKE',
             'projectKey':'a','verifyOriginalIds':['u1'],'stream':True},cookie=self.cookie)
        self.assertEqual(status,200,data)
        self.assertIn('[DONE]',data.decode())
        events=[json.loads(line[6:]) for line in data.decode().splitlines() if line.startswith('data: {')]
        self.assertEqual(events[0]['type'],'kb_sources');self.assertEqual(events[0]['scope']['projectKey'],'a')
        request=self.h.ns['DS_OPENER'].open.call_args.args[0]
        payload=json.loads(request.data)
        self.assertEqual(payload['max_tokens'],4500)
        self.assertNotIn('tools',payload)
        prompt=json.dumps(payload,ensure_ascii=False)
        self.assertIn('27695.1',prompt);self.assertIn('999',prompt)
        self.assertNotIn('CLIENT_FAKE',prompt);self.assertNotIn('OTHER_WORKSPACE_SECRET',prompt)
        self.assertIn('不生成招商报告',payload['messages'][0]['content'])
        self.assertEqual(self.audits[-1]['mode'],'verify')

    def test_missing_upload_returns_actionable_error_before_model_call(self):
        status,_,data=self.h.request('POST','/api/kb-chat',{'mode':'verify','question':'check',
             'projectKey':'a','verifyOriginalIds':['not-saved'],'stream':True},cookie=self.cookie)
        self.assertEqual(status,409)
        problem=json.loads(data)
        self.assertEqual(problem.get('code') or problem.get('error'),'verification_upload_missing')
        self.h.ns['DS_OPENER'].open.assert_not_called()


if __name__=='__main__':unittest.main()
