import io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock
class HistoryTests(unittest.TestCase):
    def test_file_history_list_and_fetch(self):
        from backend.history_route import history
        with tempfile.TemporaryDirectory() as d:
            path=str(Path(d)/'sync.json');Path(path+'.bak.123').write_text(json.dumps({'PROJECTS':{'p':{'city':'synthetic'}},'USER_PROFILES':{'old':{'pwd':'private'}}}))
            h=Mock();h.path='/api/sync-history';h.wfile=io.BytesIO()
            history(h,False,None,path)
            self.assertEqual(json.loads(h.wfile.getvalue())['count'],1)
            h.path='/api/sync-history?ts=123';h.wfile=io.BytesIO()
            history(h,False,None,path)
            saved=json.loads(json.loads(h.wfile.getvalue())['data'])
            self.assertEqual(saved['PROJECTS']['p']['city'],'synthetic')
            self.assertNotIn('private',h.wfile.getvalue().decode())
    def test_database_scope_uses_injected_connection(self):
        from backend.history_route import history
        c=Mock();c.cursor.return_value.fetchall.return_value=[(123,9,'date')]
        h=Mock();h.path='/api/sync-history';h.wfile=io.BytesIO()
        history(h,True,lambda:c,'unused')
        self.assertEqual(json.loads(h.wfile.getvalue())['count'],1)
        c.close.assert_called_once()
