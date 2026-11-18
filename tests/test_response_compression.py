"""HTTP response compression retains exact state and explicit client preferences."""
import gzip
import io
import json
import unittest
from unittest.mock import Mock

from backend.auth_routes import respond


class ResponseCompressionTests(unittest.TestCase):
    def test_large_workspace_is_lossless_and_small_replies_stay_plain(self):
        for payload in ({'ok': True}, {'PROJECTS': {'p': {'text': '原文及各项限定条件应完整保留。' * 10000}}}):
            handler = Mock()
            handler.headers = {'Accept-Encoding': 'gzip, deflate, br'}
            handler.wfile = io.BytesIO()
            respond(handler, 200, payload)
            headers = dict(call.args for call in handler.send_header.call_args_list)
            body = handler.wfile.getvalue()
            self.assertEqual(int(headers['Content-Length']), len(body))
            self.assertIn('Accept-Encoding', headers['Vary'])
            if headers.get('Content-Encoding') == 'gzip':
                self.assertLess(len(body), len(json.dumps(payload, ensure_ascii=False).encode()) // 2)
                body = gzip.decompress(body)
            self.assertEqual(json.loads(body), payload)

    def test_explicit_refusal_and_bad_quality_never_enable_compression(self):
        payload = {'value': 'body' * 1000}
        for accepted in ('identity', 'gzip;q=0, *;q=1', 'gzip;q=NaN', 'gzip;q=bogus', 'gzip;q=-1'):
            handler = Mock()
            handler.headers = {'Accept-Encoding': accepted}
            handler.wfile = io.BytesIO()
            respond(handler, 200, payload)
            headers = dict(call.args for call in handler.send_header.call_args_list)
            self.assertNotIn('Content-Encoding', headers)
            self.assertEqual(json.loads(handler.wfile.getvalue()), payload)

    def test_a_lost_receiver_does_not_receive_a_second_response(self):
        handler = Mock()
        handler.headers = {'Accept-Encoding': 'gzip'}
        handler.wfile.write.side_effect = BrokenPipeError()
        respond(handler, 200, {'value': 'large state' * 1000})
        handler.send_response.assert_called_once_with(200)
        handler.wfile.write.assert_called_once()
