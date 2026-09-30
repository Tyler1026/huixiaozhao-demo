import io
import json
import unittest
import urllib.request
from report_service import providers as p


class ProviderSafety(unittest.TestCase):
    def provider(self, transport=None, **kwargs):
        config = dict(model_url='https://model.example.com/chat', api_key='model-secret',
                      search_key='search-secret', enabled=True, transport=transport)
        config.update(kwargs)
        return p.OpenAIResearchProvider(**config)

    def test_cross_origin_redirect_removes_normalized_headers(self):
        req = urllib.request.Request('https://model.example.com/start', headers={
            'Authorization': 'model-secret', 'X-Subscription-Token': 'search-secret'})
        new = p._GuardedRedirectHandler().redirect_request(
            req, None, 302, 'Found', {}, 'https://other.example.com/end')
        headers = {k.lower(): v for k, v in new.header_items()}
        self.assertNotIn('authorization', headers)
        self.assertNotIn('x-subscription-token', headers)

    def test_redirect_rejects_downgrade_and_private_target(self):
        req = urllib.request.Request('https://model.example.com/start')
        for url in ['http://model.example.com/end', 'https://127.0.0.1/end']:
            with self.assertRaises(ValueError):
                p._GuardedRedirectHandler().redirect_request(req, None, 302, 'Found', {}, url)

    def test_missing_credentials_fail_before_transport(self):
        with self.assertRaises(ValueError):
            self.provider(api_key='')
        with self.assertRaises(ValueError):
            self.provider(search_key='')

    def test_response_is_bounded_and_closed(self):
        class Response(io.BytesIO):
            status = 200
            def read(self, size=-1):
                if size < 0:
                    raise AssertionError('unbounded response read')
                return super().read(size)
            def geturl(self):
                return 'https://model.example.com/chat'
        response = Response(b'x' * 1_100_000)
        provider = self.provider(transport=lambda request, timeout: response)
        with self.assertRaises(p.ProviderError):
            provider._request(urllib.request.Request('https://model.example.com/chat'))
        self.assertTrue(response.closed)

    def test_prior_budget_does_not_drop_chain_and_enterprises(self):
        text = p._render_prior({'economy': 'e' * 10000, 'chain': 'CHAIN_CRITICAL',
                                'enterprises': 'ENTERPRISE_CRITICAL'})
        self.assertIn('CHAIN_CRITICAL', text)
        self.assertIn('ENTERPRISE_CRITICAL', text)

    def test_length_truncated_model_output_is_not_completed(self):
        with self.assertRaises(p.ProviderError):
            self.provider()._extract_text({'choices': [{'finish_reason': 'length',
                                      'message': {'content': 'partial'}}]})
