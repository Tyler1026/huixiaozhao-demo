"""Exercise actual Handler over HTTP with synthetic dependencies, never load credentials."""
import ast
import http.client
import json
import threading
import unittest
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from backend import sync_merge

ROOT=Path(__file__).resolve().parents[1]

class CompositionTests(unittest.TestCase):
    def test_pages_health_and_sync_negative_path_over_real_http(self):
        source=ast.parse((ROOT/'server.py').read_text())
        names={'Handler','_clean_sync_data','_is_noise_chunk'}
        nodes=[n for n in source.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in names]
        import os
        ns=dict(BaseHTTPRequestHandler=BaseHTTPRequestHandler,json=json,os=os,
                HTML_GOV=str(ROOT/'index.html'),HTML_OPS=str(ROOT/'ops.html'),
                PORT_OPS=-1,MODEL='synthetic',DS_KEY='',_PG_AVAIL=True,
                DATABASE_URL='synthetic',_NOISE_RE=[],_db_get=lambda:'{}',
                SYNC_PATH='unused',_file_snapshot=lambda:None)
        writes=[];ns['_db_set']=lambda value:writes.append(value) or True
        ns.update({name:getattr(sync_merge,name) for name in dir(sync_merge) if name.startswith('_') and not name.startswith('__')})
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'isolated-handler','exec'),ns)
        server=ThreadingHTTPServer(('127.0.0.1',0),ns['Handler'])
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(method,path,body=None):
            c=http.client.HTTPConnection(*server.server_address,timeout=3)
            try:
                c.request(method,path,body);r=c.getresponse();return r.status,r.read()
            finally:c.close()
        try:
            for route,name in [('/','index.html'),('/ops','ops.html')]:
                status,body=request('GET',route)
                self.assertEqual(status,200);self.assertEqual(body,(ROOT/name).read_bytes())
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
            ns['_db_get']=lambda:json.dumps({'REPORT_REQUESTS':[{'city':'synthetic','files':[{'kind':'full','name':'test.docx','b64':'eA=='}]}]})
            status,body=request('GET','/api/report-file?city=synthetic')
            self.assertEqual(status,200);self.assertEqual(body,b'x')
            status,body=request('GET','/api/report-file?city=missing')
            self.assertEqual(status,404)
            ns['_db_get']=lambda:'{}'
            status,body=request('GET','/health');self.assertEqual(status,200)
            self.assertFalse(json.loads(body)['key'])
            status,body=request('POST','/api/sync',b'{invalid')
            self.assertEqual(status,200);self.assertFalse(json.loads(body)['ok']);self.assertEqual(writes,[])
            ns['_db_get']=lambda:'{"PROJECTS":{"old":{"city":"A"}}}'
            status,body=request('POST','/api/sync',b'{"PROJECTS":{"new":{"city":"B"}}}')
            self.assertEqual(status,200);self.assertTrue(json.loads(body)['ok'])
            self.assertEqual(set(json.loads(writes[-1])['PROJECTS']),{'old','new'})
            count=len(writes);ns['_db_get']=lambda:None
            status,body=request('POST','/api/sync',b'{"PROJECTS":{"new":{}}}')
            self.assertFalse(json.loads(body)['ok']);self.assertEqual(len(writes),count)
            ns['_db_get']=lambda:'{}';ns['_db_set']=lambda value:False
            status,body=request('POST','/api/sync',b'{"PROJECTS":{"new":{}}}')
            self.assertFalse(json.loads(body)['ok'])
        finally:
            server.shutdown();server.server_close();thread.join()
