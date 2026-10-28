"""JSON transport compression must preserve exact decoded response bytes."""
import gzip
import io
import json
import unittest
from unittest.mock import Mock

from backend.auth_routes import respond


class JsonCompressionTests(unittest.TestCase):
    def reply(self, value, accept_encoding=None):
        handler = Mock()
        handler.headers = {} if accept_encoding is None else {'Accept-Encoding': accept_encoding}
        handler.wfile = io.BytesIO()
        respond(handler, 200, value)
        return ({call.args[0]: call.args[1] for call in handler.send_header.call_args_list},
                handler.wfile.getvalue())

    def test_large_json_negotiates_gzip_and_roundtrips_exact_bytes(self):
        value = {'city': '随州市', 'report': '产业链证据、方向与企业。' * 1000,
                 'files': [{'kind': 'full', 'b64': 'c2F2ZWQtb3JpZ2luYWw=' * 1000}]}
        plain_headers, plain = self.reply(value)
        headers, compressed = self.reply(value, 'br, gzip, deflate')
        self.assertNotIn('Content-Encoding', plain_headers)
        self.assertEqual(headers['Content-Encoding'], 'gzip')
        self.assertEqual(int(headers['Content-Length']), len(compressed))
        self.assertEqual(gzip.decompress(compressed), plain)
        self.assertEqual(json.loads(gzip.decompress(compressed)), value)
        self.assertLess(len(compressed), len(plain) / 4)
        self.assertIn('Accept-Encoding', headers['Vary'])
        self.assertIn('Accept-Encoding', plain_headers['Vary'])

    def test_small_json_stays_uncompressed(self):
        headers, raw = self.reply({'ok': True, 'monthlyEnabled': False}, 'gzip')
        self.assertNotIn('Content-Encoding', headers)
        self.assertEqual(json.loads(raw), {'ok': True, 'monthlyEnabled': False})
        self.assertEqual(int(headers['Content-Length']), len(raw))

    def test_identity_refusal_wildcard_and_invalid_quality_are_respected(self):
        value = {'report': 'x' * 4096}
        for accepted in ('identity', 'br', 'gzip;q=0', '*;q=1, gzip;q=0',
                         'gzip;q=invalid', 'gzip;q=nan', 'gzip;q=2', '*;q=0',
                         'gzip;q=0.5, gzip;q=0', 'gzip;q=0;q=1',
                         'gzip;q=invalid;q=1', 'gzip;q=-0.1', 'gzip;q=inf'):
            with self.subTest(accepted=accepted):
                headers, raw = self.reply(value, accepted)
                self.assertNotIn('Content-Encoding', headers)
                self.assertEqual(json.loads(raw), value)
        for accepted in ('GZIP', 'gzip;q=0.3', '*;q=1', 'br;q=1, gzip;q=.5'):
            with self.subTest(accepted=accepted):
                headers, raw = self.reply(value, accepted)
                self.assertEqual(headers['Content-Encoding'], 'gzip')
                self.assertEqual(json.loads(gzip.decompress(raw)), value)
