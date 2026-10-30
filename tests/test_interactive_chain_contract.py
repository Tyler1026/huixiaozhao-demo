"""Interactive chain-map schema stays distinct from legacy chain research."""
import json
import unittest

from backend.evidence_grounding import evidence_catalog
import test_interactive_evidence_boundary as boundary


class InteractiveChainContractTests(unittest.TestCase):
    setUp = boundary.StreamBoundaryTests.setUp

    def _request(self, model, broken_archive=False):
        from unittest.mock import patch
        from backend import topic_chain_route
        from test_topic_chain import research
        bundle = research(['同城区计划建设液体火箭总装测试平台，拟在规划期内按程序推进相关工作。'], topic='液体火箭')
        bundle['city'] = '同城区'
        if broken_archive:
            next(iter(bundle['sources'].values()))['fulltext'] = '不匹配的正文'
        self.h.ns['_complete_topic_plan'] = lambda *args: model(bundle) if callable(model) else model
        original = topic_chain_route.serve_topic_chain
        def routed(*args, **kwargs):
            kwargs['research'] = lambda *args, **kwargs: bundle
            kwargs['package_loader'] = None  # This fixture supplies its own source bundle.
            return original(*args, **kwargs)
        body={'question':'整理当前证据产业链','mode':'chain','purpose':'chain_map',
              'projectKey':'a','topic':'液体火箭','reportRequestId':'r1','stream':True}
        with patch.object(topic_chain_route, 'serve_topic_chain', routed), \
             patch('backend.public_research.enrich_public_research', side_effect=lambda findings,*args:findings):
            status,_,raw=self.h.request('POST','/api/kb-chat',body,cookie=self.cookie)
        return status,raw.decode()

    def test_map_is_source_bound_and_saved_on_server_before_success(self):
        status,text=self._request(lambda b: {'nodes':[{'name':'液体火箭总装测试','evidence_ids':[b['evidence'][0]['id']]}]})
        self.assertEqual(status,200)
        event=next(json.loads(line[6:]) for line in text.splitlines() if line.startswith('data: {') and json.loads(line[6:]).get('type')=='chain.result')
        self.assertEqual(event['evidence']['contract'],'source-bound-chain-v2')
        self.assertTrue(event['saved']);self.assertIn('[DONE]',text)
        node=event['chain'][1]['nodes'][0]
        self.assertEqual(node['level'],'unknown');self.assertEqual(node['local_leaders'],[])
        self.assertEqual(node['status'],'planned')
        self.assertEqual(self.h.state()['REPORTSTATE']['a']['chainByTopic']['液体火箭'],event['chain'])
        self.assertEqual(self.h.ns['DS_OPENER'].open.call_count,0)

    def test_empty_model_nodes_recover_literals_without_full_coverage(self):
        status,text=self._request({'nodes':[]})
        self.assertEqual(status,200)
        event=next(json.loads(line[6:]) for line in text.splitlines() if line.startswith('data: {') and json.loads(line[6:]).get('type')=='chain.result')
        self.assertEqual(event['status'],'partial')
        self.assertIn('上游',event['coverage']['missing_lanes'])
        self.assertIn('下游',event['coverage']['missing_lanes'])
        node=event['chain'][1]['nodes'][0]
        self.assertEqual(node['name'],'液体火箭总装测试平台')
        self.assertIn(node['name'],node['sources'][0]['quote'])
        self.assertIn('[DONE]',text)

    def test_bad_model_plan_keeps_only_source_bound_literal_nodes(self):
        for bad in ({'chain':'液体火箭','segments':[]}, [{'seg':'上游','nodes':[]}]):
            status,text=self._request(bad)
            self.assertEqual(status,200)
            event=next(json.loads(line[6:]) for line in text.splitlines() if line.startswith('data: {') and json.loads(line[6:]).get('type')=='chain.result')
            self.assertEqual(event['status'],'partial')
            self.assertEqual(event['evidence']['generation']['mode'],'source_only')
            self.assertTrue(event['saved'])
            node=event['chain'][1]['nodes'][0]
            self.assertEqual(node['name'],'液体火箭总装测试平台')
            self.assertEqual(node['level'],'unknown')
            self.assertIn(node['name'],node['sources'][0]['quote'])

    def test_unbound_archive_cannot_complete_even_when_model_fails(self):
        for bad in ({'chain':'液体火箭','segments':[]}, {'nodes':[]}):
            status,text=self._request(bad,True)
            self.assertEqual(status,200)
            self.assertNotIn('[DONE]',text);self.assertNotIn('chain.result',text)
            self.assertEqual(self.audits[-1]['outcome'],'incomplete')

    def test_legacy_chain_prompt_remains_unchanged(self):
        self.h.ns['SYSTEM_RESEARCH_CHAIN']='LEGACY_CHAIN_OBJECT_PROMPT: return {chain,segments:[{name}]}'
        self.h.ns['DS_OPENER'].open.return_value=boundary.FakeResponse(b'data: {"choices":[{"delta":{"content":"legacy"},"finish_reason":"stop"}]}\n\n')
        status,_,_=self.h.request('POST','/api/kb-chat',{'question':'legacy research','mode':'chain','stream':True},cookie=self.cookie)
        self.assertEqual(status,200)
        payload=json.loads(self.h.ns['DS_OPENER'].open.call_args.args[0].data)
        self.assertEqual(payload['messages'][0]['content'],'LEGACY_CHAIN_OBJECT_PROMPT: return {chain,segments:[{name}]}')
        self.assertTrue(payload['stream'])


if __name__=='__main__': unittest.main()
