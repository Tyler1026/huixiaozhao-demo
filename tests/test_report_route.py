import io,json,unittest
from unittest.mock import Mock
class ReportRouteTests(unittest.TestCase):
    def test_existing_report_bytes_and_filename_are_preserved(self):
        from backend.report_route import report_file
        h=Mock();h.path='/api/report-file?city=city&kind=full';h.wfile=io.BytesIO()
        data={'REPORT_REQUESTS':[{'city':'city','files':[{'kind':'full','name':'report.docx','b64':'eA=='}]}]}
        report_file(h,True,lambda:json.dumps(data),'unused')
        self.assertEqual(h.wfile.getvalue(),b'x');h.send_response.assert_called_once_with(200)
        h.send_header.assert_any_call('Content-Disposition',"attachment; filename*=UTF-8''report.docx")
    def test_no_file_remains_404(self):
        from backend.report_route import report_file
        h=Mock();h.path='/api/report-file?city=none';h.wfile=io.BytesIO()
        report_file(h,True,lambda:'{}','unused')
        h.send_response.assert_called_once_with(404)
