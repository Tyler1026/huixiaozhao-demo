import base64
import io
import json
import unittest
from unittest.mock import Mock
from backend.report_route import report_file


class ReportDownloadReliabilityTests(unittest.TestCase):
    def fetch(self, data, query='requestId=old&city=A&kind=full'):
        h = Mock(); h.path = '/api/report-file?' + query; h.wfile = io.BytesIO()
        report_file(h, True, lambda: json.dumps(data) if data is not None else None, 'unused')
        return h.send_response.call_args.args[0], h.wfile.getvalue()

    def records(self):
        return {'REPORT_REQUESTS': [
            {'id': 'old', 'city': 'A', 'status': 'done', 'files': [{'kind': 'full', 'b64': base64.b64encode(b'old bytes').decode()}]},
            {'id': 'new', 'city': 'A', 'status': 'done', 'files': [{'kind': 'full', 'b64': base64.b64encode(b'new bytes').decode()}]},
        ]}

    def test_exact_historical_request_returns_its_original_bytes(self):
        self.assertEqual(self.fetch(self.records()), (200, b'old bytes'))

    def test_missing_request_never_falls_back_to_another_report_or_project(self):
        data = self.records(); data['PROJECTS'] = {'p': {'city': 'A', 'reportFiles': data['REPORT_REQUESTS'][1]['files']}}
        self.assertEqual(self.fetch(data, 'requestId=missing&city=A')[0], 404)

    def test_city_mismatch_and_unfinished_report_refuse_download(self):
        data = self.records()
        self.assertEqual(self.fetch(data, 'requestId=old&city=B')[0], 404)
        data['REPORT_REQUESTS'][0]['status'] = 'running'
        self.assertEqual(self.fetch(data)[0], 409)

    def test_unavailable_storage_returns_retryable_error(self):
        status, body = self.fetch(None)
        self.assertEqual(status, 503); self.assertFalse(json.loads(body)['ok'])

    def test_corrupt_or_empty_artifact_does_not_return_success(self):
        for invalid in ('bad!', ''):
            data = self.records(); data['REPORT_REQUESTS'][0]['files'][0]['b64'] = invalid
            self.assertNotEqual(self.fetch(data)[0], 200)

    def test_requested_kind_does_not_silently_download_a_different_file(self):
        self.assertEqual(self.fetch(self.records(), 'requestId=old&city=A&kind=short')[0], 404)

    def test_legacy_city_link_keeps_latest_completed_report_behavior(self):
        data = self.records(); data['REPORT_REQUESTS'].append({'id': 'unfinished', 'city': 'A', 'status': 'running', 'files': [{'kind': 'full', 'b64': 'eA=='}]})
        self.assertEqual(self.fetch(data, 'city=A&kind=full'), (200, b'new bytes'))


if __name__ == '__main__': unittest.main()
