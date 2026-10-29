import json
import unittest
from unittest.mock import patch
from report_service.providers import OpenAIResearchProvider
from report_service.openai_auxiliary import OpenAIAuxiliarySearch
from report_service.openai_auxiliary import _government_url, _OriginalText


class OpenAIAuxiliaryTests(unittest.TestCase):
    def test_completed_search_sources_survive_incomplete_generated_summary(self):
        def request(req,**kwargs):
            return 200,json.dumps({'status':'incomplete','output':[{'type':'web_search_call',
                'status':'completed','action':{'sources':[{'url':'https://www.gov.cn/a'}]}}]}).encode(),req.full_url
        self.assertEqual(OpenAIAuxiliarySearch('test-key','test-model').discover('公开主题',request),
                         ['https://www.gov.cn/a'])

    def test_discovery_only_accepts_citations_not_generated_text(self):
        seen=[]
        def request(req,**kwargs):
            seen.append(json.loads(req.data))
            return 200,json.dumps({'status':'completed','output':[
                {'type':'message','content':[{'text':'invented prose https://evil.example',
                 'annotations':[{'type':'url_citation','url':'https://www.gov.cn/a'},
                                {'type':'url_citation','url':'http://127.0.0.1/a'}]}]}]}).encode(),req.full_url
        self.assertEqual(OpenAIAuxiliarySearch('test-key','test-model').discover('公开城市主题',request),
                         ['https://www.gov.cn/a'])
        self.assertFalse(seen[0]['store'])
        self.assertEqual(seen[0]['tools'][0]['type'],'web_search')

    def provider(self):
        return OpenAIResearchProvider.from_env({'HXZ_MODEL_URL':'https://api.deepseek.com/v1/chat/completions',
            'HXZ_MODEL_KEY':'primary-key','HXZ_SEARCH_PROVIDER':'exa','HXZ_SEARCH_KEY':'search-key',
            'OPENAI_API_KEY':'aux-key','HXZ_OPENAI_AUX_ENABLED':'1','HXZ_OPENAI_AUX_MODEL':'test-model'})

    def test_original_fetch_and_one_auxiliary_call_preserve_primary(self):
        provider=self.provider()
        with patch.object(provider,'_primary_search',return_value={'results':[{'url':'https://www.gov.cn/old','text':'original'}]}), \
             patch.object(provider._auxiliary,'discover',return_value=['https://www.gov.cn/new']) as discover, \
             patch.object(provider,'_post_search_json',return_value=(200,json.dumps({'results':[
                 {'url':'https://www.gov.cn/new','text':'separately fetched original'},
                 {'url':'https://www.gov.cn/fake','text':'unrequested'}]}).encode(),None)):
            result=provider._search('公开产业主题',3)
            provider._search('第二个主题',3)
        self.assertEqual(discover.call_count,1)
        self.assertEqual(len(result['results']),2)
        self.assertEqual(provider.api_key,'primary-key')

    def test_auxiliary_failure_does_not_change_primary_results(self):
        provider=self.provider();primary={'results':[{'url':'https://www.gov.cn/old'}]}
        with patch.object(provider,'_primary_search',return_value=primary), \
             patch.object(provider._auxiliary,'discover',side_effect=RuntimeError('aux-key')):
            self.assertEqual(provider._search('公开主题',3),primary)

    def test_disabled_by_default(self):
        provider=OpenAIResearchProvider.from_env({})
        self.assertFalse(hasattr(provider,'_auxiliary'))

    def test_original_reader_rejects_private_resolution_and_non_government_host(self):
        with self.assertRaises(ValueError):_government_url('https://example.com/a')
        with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(ValueError):_government_url('https://www.gov.cn/a')
        parser=_OriginalText();parser.feed('<p>original body</p><script>untrusted script</script>')
        self.assertIn('original body',''.join(parser.parts))
        self.assertNotIn('untrusted script',''.join(parser.parts))

    def test_exa_credit_failure_uses_only_separately_fetched_government_text(self):
        provider=self.provider()
        with patch.object(provider,'_primary_search',return_value={'results':[]}), \
             patch.object(provider._auxiliary,'discover',return_value=['https://www.gov.cn/a']), \
             patch.object(provider,'_post_search_json',return_value=(402,b'credits exhausted',None)), \
             patch('report_service.openai_auxiliary.fetch_government_originals',return_value=[
                 {'url':'https://www.gov.cn/a','text':'government original',
                  'retrieval_provider':'openai_discovery_government_original'}]):
            rows=provider._search('public city topic',3)['results']
        self.assertEqual(rows[0]['text'],'government original')
