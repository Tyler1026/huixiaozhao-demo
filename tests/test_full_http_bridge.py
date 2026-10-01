import io
import json
import subprocess
import sys
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from report_service.full_api import make_handler, ThreadingHTTPServer
from report_service.full_store import FullStore
from report_service.full_bridge import FullReportBridge, TenantCredential, BridgeError
from report_service.full_client import HTTPReportClient


class HTTPBridgeTests(unittest.TestCase):
    def test_real_http_submission_generation_download_and_revocation(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve(); token='synthetic-bridge-'+ 'x'*40
            store=FullStore(root/'db',artifact_root=root/'files')
            server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(store,{token:'org-a'}))
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            valid={'session':True}; csrf=object()
            def auth(session,project,action):
                return {'org_id':'org-a','user_id':'user-a'} if session=='session' and project=='project' and valid['session'] else None
            client=HTTPReportClient(f'http://127.0.0.1:{server.server_port}',allow_loopback_http=True)
            bridge=FullReportBridge(root/'bridge.db',authorize=auth,tenants={'org-a':TenantCredential('org-a',token)},client=client,validate_csrf=lambda s,c:c is csrf,enabled=True)
            try:
                r=bridge.create('session','project',{'province':'合成省','city':'合成区','synthetic':True},'one',csrf_context=csrf)
                remote=store.list_reports('org-a')[0]['id']
                proc=subprocess.run([sys.executable,'-m','report_service.full_cli','worker','--db',str(root/'db'),'--artifacts',str(root/'files'),'--provider','synthetic','--until-id',remote,'--tenant','org-a','--run-limit','60'],cwd=Path(__file__).resolve().parents[1],capture_output=True,text=True,timeout=70)
                self.assertEqual(proc.returncode,0,proc.stdout+proc.stderr)
                status=bridge.get('session','project',r['id'])
                self.assertEqual(status['status'],'completed')
                body=bridge.artifact('session','project',r['id'],'full.docx')
                self.assertTrue(zipfile.is_zipfile(io.BytesIO(body)))
                self.assertNotIn(token,str(status))
                valid['session']=False
                with self.assertRaises(BridgeError) as caught: bridge.get('session','project',r['id'])
                self.assertEqual(caught.exception.status,404)
            finally: server.shutdown();server.server_close();thread.join()

    def test_client_rejects_insecure_remote_endpoint(self):
        with self.assertRaises(ValueError):HTTPReportClient('http://some-host.com')
        with self.assertRaises(ValueError):HTTPReportClient('http://127.0.0.1')


if __name__=='__main__':unittest.main()
