import json
import unittest
import urllib.request
import urllib.error
from unittest.mock import Mock
from report_service.model_routing import openai_payload,PrimaryModelOpener


class ModelRoutingTests(unittest.TestCase):
    def test_primary_payload_is_provider_compatible(self):
        original={'messages':[],'thinking':{'type':'disabled'},'temperature':0,'max_tokens':500}
        result=openai_payload(original)
        self.assertEqual(result['max_completion_tokens'],500)
        self.assertNotIn('thinking',result)
        self.assertIn('thinking',original)
        self.assertEqual(openai_payload({'input':'hello'})['reasoning']['effort'],'low')

    def test_failure_before_response_uses_separate_deepseek_key(self):
        opener=Mock();opener.open.side_effect=[urllib.error.URLError('temporary'),object()]
        router=PrimaryModelOpener(opener,{'DEEPSEEK_API_KEY':'backup-key'})
        req=urllib.request.Request('https://api.openai.com/v1/chat/completions',
            data=json.dumps({'model':'gpt-5.5','messages':[],'max_tokens':100}).encode(),
            headers={'Authorization':'Bearer primary-key'})
        router.open(req,timeout=5)
        fallback=opener.open.call_args.args[0]
        self.assertEqual(fallback.get_header('Authorization'),'Bearer backup-key')
        self.assertIn('api.deepseek.com',fallback.full_url)
        self.assertEqual(json.loads(fallback.data)['model'],'deepseek-v4-flash')
