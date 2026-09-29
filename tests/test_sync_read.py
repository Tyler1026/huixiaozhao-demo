import io,json,unittest
from unittest.mock import Mock
class SyncReadTests(unittest.TestCase):
    def test_read_uses_injected_cleaner(self):
        from backend.sync_read import read_sync
        h=Mock();h.wfile=io.BytesIO()
        read_sync(h,True,lambda:'{"value":1}','unused',lambda d:{'value':d['value']+1})
        self.assertEqual(json.loads(h.wfile.getvalue()),{'value':2})
        h.send_response.assert_called_once_with(200)
    def test_legacy_failed_read_retains_empty_object_response(self):
        from backend.sync_read import read_sync
        h=Mock();h.wfile=io.BytesIO()
        read_sync(h,True,lambda:None,'unused',lambda d:d)
        self.assertEqual(json.loads(h.wfile.getvalue()),{})
