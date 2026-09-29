import base64,io,json,unittest
from unittest.mock import Mock
class ExtractTests(unittest.TestCase):
    def test_parser_is_injected_and_errors_preserved(self):
        from backend.extract_route import extract_text
        h=Mock();h.wfile=io.BytesIO();parser=Mock(return_value=('合成',None))
        extract_text(h,json.dumps({'filename':'a.txt','fileB64':base64.b64encode(b'x').decode()}).encode(),parser)
        self.assertEqual(json.loads(h.wfile.getvalue()),{'ok':True,'text':'合成','chars':2})
        parser.assert_called_once_with('a.txt',b'x')
    def test_missing_content_does_not_call_parser(self):
        from backend.extract_route import extract_text
        h=Mock();h.wfile=io.BytesIO();parser=Mock()
        extract_text(h,b'{}',parser)
        self.assertFalse(json.loads(h.wfile.getvalue())['ok']);parser.assert_not_called()
