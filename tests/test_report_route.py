import io,json,unittest
from unittest.mock import Mock
class ReportRouteTests(unittest.TestCase):
    def test_research_download_wraps_legacy_original_without_mutating_receipt(self):
        from backend.report_route import report_file
        from zipfile import ZipFile
        h=Mock();h.path='/api/report-file?city=city&kind=research&requestId=rr1';h.wfile=io.BytesIO()
        data={'REPORT_REQUESTS':[{'id':'rr1','city':'city','status':'done','files':[{'kind':'full','name':'report.docx','b64':'eA=='}]}]}
        original=json.dumps(data)
        report_file(h,True,lambda:json.dumps(data),'unused')
        h.send_response.assert_called_once_with(200)
        h.send_header.assert_any_call('Content-Type','application/zip')
        with ZipFile(io.BytesIO(h.wfile.getvalue())) as z:
            self.assertEqual(z.namelist(),['original_full_report.docx'])
            self.assertEqual(z.read('original_full_report.docx'),b'x')
        self.assertEqual(json.dumps(data),original)
    def test_research_request_never_uses_different_report_or_unknown_kind(self):
        from backend.report_route import report_file
        for path,expected in [('/api/report-file?city=city&kind=research&requestId=missing',404),('/api/report-file?city=city&kind=bad',400)]:
            h=Mock();h.path=path;h.wfile=io.BytesIO()
            data={'REPORT_REQUESTS':[{'id':'other','city':'city','status':'done','files':[{'kind':'full','b64':'eA=='}]}]}
            report_file(h,True,lambda:json.dumps(data),'unused')
            h.send_response.assert_called_once_with(expected)
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
