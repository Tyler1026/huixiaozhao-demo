"""Exercise actual Handler over HTTP with synthetic dependencies, never load credentials."""
import ast
import http.client
import json
import threading
import unittest
from types import SimpleNamespace
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from backend import sync_merge

ROOT=Path(__file__).resolve().parents[1]

class CompositionTests(unittest.TestCase):
    def test_pages_health_and_sync_negative_path_over_real_http(self):
        source=ast.parse((ROOT/'server.py').read_text())
        names={'Handler','_clean_sync_data','_is_noise_chunk'}
        nodes=[n for n in source.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in names]
        ns=dict(BaseHTTPRequestHandler=BaseHTTPRequestHandler,json=json,
                os=SimpleNamespace(environ={'HXZ_ADMIN_USERNAME':'offline-admin',
                                             'HXZ_ADMIN_PASSWORD':'offline-test-password-7'}),
                HTML_GOV=str(ROOT/'index.html'),HTML_OPS=str(ROOT/'ops.html'),
                PORT_OPS=-1,MODEL='synthetic',DS_KEY='',_PG_AVAIL=True,
                DATABASE_URL='synthetic',_NOISE_RE=[],_db_get=lambda:'{}',
                SYNC_PATH='unused',_file_snapshot=lambda:None)
        writes=[];state={'raw':'{}'}
        ns['_db_get']=lambda:state['raw']
        def write(value):
            writes.append(value);state['raw']=value;return True
        ns['_db_set']=write
        def replace_business(value):
            value=dict(value)
            value['AUTH_SESSIONS']=json.loads(state['raw']).get('AUTH_SESSIONS',{})
            state['raw']=json.dumps(value)
        from contextlib import contextmanager
        lock=threading.RLock()
        @contextmanager
        def transaction():
            # HTTP composition uses an isolated storage seam; real transaction
            # locking and rollback are exercised by the PostgreSQL CI fixture.
            with lock:
                yield SimpleNamespace(read=lambda: ns['_db_get'](),
                                      write=lambda value: ns['_db_set'](value))
        ns['_sync_transaction'] = transaction
        ns.update({name:getattr(sync_merge,name) for name in dir(sync_merge) if name.startswith('_') and not name.startswith('__')})
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'isolated-handler','exec'),ns)
        server=ThreadingHTTPServer(('127.0.0.1',0),ns['Handler'])
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        cookie=None
        def request(method,path,body=None):
            c=http.client.HTTPConnection(*server.server_address,timeout=3)
            try:
                headers={'Cookie':cookie} if cookie else {}
                c.request(method,path,body,headers);r=c.getresponse()
                return r.status,r.read()
            finally:c.close()
        try:
            for route,name in [('/','index.html'),('/ops','ops.html')]:
                status,body=request('GET',route)
                self.assertEqual(status,200);self.assertEqual(body,(ROOT/name).read_bytes())
            # Exercise the real login/session code. No synthetic principal or
            # authorization bypass is injected into this composition fixture.
            c=http.client.HTTPConnection(*server.server_address,timeout=3)
            try:
                c.request('POST','/api/auth/login',json.dumps({'username':'offline-admin',
                          'password':'offline-test-password-7'}))
                response=c.getresponse();body=response.read()
                self.assertEqual(response.status,200,body)
                cookie=response.getheader('Set-Cookie').split(';',1)[0]
                self.assertEqual(json.loads(body)['auth']['scope'],'admin')
            finally:c.close()
            writes.clear()
            status,body=request('GET','/api/sync');self.assertEqual(status,200);self.assertEqual(json.loads(body),{})
            from backend.documents import _extract_doc_text
            ns['_extract_doc_text']=_extract_doc_text
            status,body=request('POST','/api/extract-text',b'{"filename":"a.txt","fileB64":"eA=="}')
            self.assertEqual(status,200);self.assertEqual(json.loads(body),{'ok':True,'text':'x','chars':1})
            from unittest.mock import Mock
            connection=Mock();connection.cursor.return_value.fetchall.return_value=[(123,9,'synthetic-date')]
            ns['_db_conn']=lambda:connection
            status,body=request('GET','/api/sync-history')
            self.assertEqual(status,200);self.assertEqual(json.loads(body)['count'],1)
            replace_business({'REPORT_REQUESTS':[{'city':'synthetic','files':[{'kind':'full','name':'test.docx','b64':'eA=='}]}]})
            status,body=request('GET','/api/report-file?city=synthetic')
            self.assertEqual(status,200);self.assertEqual(body,b'x')
            status,body=request('GET','/api/report-file?city=missing')
            self.assertEqual(status,404)
            replace_business({})
            status,body=request('GET','/health');self.assertEqual(status,200)
            self.assertFalse(json.loads(body)['key'])
            status,body=request('POST','/api/sync',b'{invalid')
            self.assertEqual(status,403);self.assertFalse(json.loads(body)['ok']);self.assertEqual(writes,[])
            replace_business({'PROJECTS':{'old':{'city':'A'}}})
            status,body=request('POST','/api/sync',b'{"PROJECTS":{"new":{"city":"B"}}}')
            self.assertEqual(status,200);self.assertTrue(json.loads(body)['ok'])
            self.assertEqual(set(json.loads(writes[-1])['PROJECTS']),{'old','new'})
            count=len(writes);ns['_db_get']=lambda:None
            status,body=request('POST','/api/sync',b'{"PROJECTS":{"new":{}}}')
            self.assertEqual(status,503);self.assertFalse(json.loads(body)['ok']);self.assertEqual(len(writes),count)
            ns['_db_get']=lambda:state['raw'];replace_business({});ns['_db_set']=lambda value:False
            status,body=request('POST','/api/sync',b'{"PROJECTS":{"new":{}}}')
            self.assertFalse(json.loads(body)['ok'])
        finally:
            server.shutdown();server.server_close();thread.join()
