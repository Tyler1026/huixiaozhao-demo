"""Interactive chain-map schema stays distinct from legacy chain research."""
import json
import unittest

from backend.evidence_grounding import evidence_catalog
import test_interactive_evidence_boundary as boundary


class InteractiveChainContractTests(unittest.TestCase):
    setUp = boundary.StreamBoundaryTests.setUp

    def _request(self, model, purpose='chain_map'):
        # This is current-direction evidence, not a generic enterprise-library
        # row from the base city report.
        saved=self.h.state()
        saved['PROJECTS']['a']['kb'][0]['t']='液体火箭'
        self.h.replace(saved)
        self.h.ns['SYSTEM_RESEARCH_CHAIN']='LEGACY_CHAIN_OBJECT_PROMPT: return {chain,segments:[{name}]}'
        self.h.ns['DS_OPENER'].open.return_value=boundary.FakeResponse(json.dumps({'choices':[{'message':{'content':json.dumps(model)},'finish_reason':'stop'}]}).encode())
        body={'question':'整理当前证据产业链','mode':'chain','projectKey':'a','topic':'液体火箭','reportRequestId':'r1','stream':True}
        if purpose:
            body['purpose']=purpose
        status,_,raw=self.h.request('POST','/api/kb-chat',body,cookie=self.cookie)
        payload=json.loads(self.h.ns['DS_OPENER'].open.call_args.args[0].data)
        return status,raw.decode(),payload

    def test_map_payload_uses_array_contract_and_validated_result_completes(self):
        ref=next(x for x in evidence_catalog(boundary.context()['chunks']) if '星河' in x['quote'])
        model=[{'seg':'上游','nodes':[{'name':'液氧煤油发动机','level':'strong','local_leaders':['星河动力公司'],'evidence_ids':[ref['id']]}]}]
        status,text,payload=self._request(model)
        self.assertEqual(status,200)
        system=payload['messages'][0]['content']
        self.assertIn('顶层 JSON 数组',system)
        self.assertIn('"seg":"上游"',system)
        self.assertNotIn('LEGACY_CHAIN_OBJECT_PROMPT',system)
        self.assertFalse(payload['stream'])
        self.assertEqual(payload['max_tokens'],self.h.ns['MAX_TOKENS_CHAIN'])
        self.assertIn('[DONE]',text)
        event=json.loads(next(line[6:] for line in text.splitlines() if line.startswith('data: {')))
        result=json.loads(event['choices'][0]['delta']['content'])
        self.assertIsInstance(result,list)
        node=result[0]['nodes'][0]
        self.assertEqual(node['level'],'unknown')
        self.assertEqual(node['local_leaders'],[])
        self.assertEqual(node['urls'],['https://official.example/engine'])
        self.assertEqual(self.audits[-1]['outcome'],'completed')
        self.assertEqual(self.h.ns['DS_OPENER'].open.call_count,1)

    def test_empty_array_completes_as_three_material_gaps(self):
        status,text,_=self._request([])
        self.assertEqual(status,200)
        self.assertIn('[DONE]',text)
        event=json.loads(next(line[6:] for line in text.splitlines() if line.startswith('data: {')))
        result=json.loads(event['choices'][0]['delta']['content'])
        self.assertEqual(result,[{'seg':name,'nodes':[]} for name in ('上游','中游','下游')])
        self.assertEqual(self.audits[-1]['outcome'],'completed')

    def test_legacy_object_or_malformed_segments_stay_fail_closed(self):
        for bad in ({'chain':'液体火箭','segments':[]},[{'seg':'上游','nodes':'not-a-list'}]):
            status,text,_=self._request(bad)
            self.assertEqual(status,502)
            self.assertNotIn('[DONE]',text)
            self.assertEqual(self.audits[-1]['outcome'],'failed')

    def test_legacy_chain_prompt_remains_unchanged(self):
        self.h.ns['SYSTEM_RESEARCH_CHAIN']='LEGACY_CHAIN_OBJECT_PROMPT: return {chain,segments:[{name}]}'
        self.h.ns['DS_OPENER'].open.return_value=boundary.FakeResponse(b'data: {"choices":[{"delta":{"content":"legacy"},"finish_reason":"stop"}]}\n\n')
        status,_,_=self.h.request('POST','/api/kb-chat',{'question':'legacy research','mode':'chain','stream':True},cookie=self.cookie)
        self.assertEqual(status,200)
        payload=json.loads(self.h.ns['DS_OPENER'].open.call_args.args[0].data)
        self.assertEqual(payload['messages'][0]['content'],'LEGACY_CHAIN_OBJECT_PROMPT: return {chain,segments:[{name}]}')
        self.assertTrue(payload['stream'])


if __name__=='__main__': unittest.main()
