import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
class ResponseTests(unittest.TestCase):
    def test_html_bytes_headers_and_file_close(self):
        from backend.http_responses import serve_html
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'page.html';path.write_bytes(b'<h1>unchanged</h1>')
            handler=Mock();handler.wfile=io.BytesIO()
            serve_html(handler,path)
            self.assertEqual(handler.wfile.getvalue(),path.read_bytes())
            handler.send_response.assert_called_once_with(200)
            handler.send_header.assert_any_call('Cache-Control','no-cache, no-store, must-revalidate')
            handler.send_header.assert_any_call('Content-Length',str(path.stat().st_size))
    def test_file_is_closed_before_any_response_and_io_errors_propagate(self):
        from unittest.mock import patch
        from backend.http_responses import serve_html
        handle=io.BytesIO(b'exact bytes')
        handler=Mock();handler.wfile=io.BytesIO()
        handler.send_response.side_effect=lambda status:self.assertTrue(handle.closed)
        with patch('builtins.open',return_value=handle):
            serve_html(handler,'synthetic.html')
        self.assertEqual(handler.wfile.getvalue(),b'exact bytes')
        denied=Mock()
        with patch('builtins.open',side_effect=PermissionError('synthetic denied')):
            with self.assertRaises(PermissionError):serve_html(denied,'synthetic.html')
        denied.send_response.assert_not_called()

    def test_missing_file_keeps_404(self):
        from backend.http_responses import serve_html
        handler=Mock()
        serve_html(handler,'/nonexistent-synthetic-file/page.html')
        handler.send_error.assert_called_once_with(404,'HTML not found')
