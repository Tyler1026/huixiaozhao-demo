"""Upload originals: fail closed, atomic bytes/references and scoped recovery."""
import base64
import concurrent.futures
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urlsplit

from backend import upload_originals as uploads
from backend.auth import AuthError
from backend.sync_transaction import PostgresSession

KEY='workspace-a'
PRINCIPAL={'scope':'project','user':'member','projKey':KEY,'projectKeys':[KEY]}
STATE={'PROJECTS':{KEY:{'workspaceId':KEY,'kb':[{'t':'产业','known':[]}]},
                   'workspace-b':{'workspaceId':'workspace-b','kb':[]}}}
CONTENT='测试原件中的可恢复资料，内容来自用户提交，不能在备份中丢失。\n\n产业材料正文包含具体数据及来源。'.encode()

def body(**changes):
    value={'projectKey':KEY,'filename':'原始资料.txt','fileB64':base64.b64encode(CONTENT).decode(),
           'uploadId':'a'*32,'kbIdx':0}
    value.update(changes)
    return value

def handler(path='/api/upload-file'):
    h=Mock();h.headers={};h.path=path;h.wfile=io.BytesIO()
    return h

def response(h):
    return json.loads(h.wfile.getvalue())

class OriginalValidationTests(unittest.TestCase):
    def test_bytes_identity_mime_and_safe_filename(self):
        r=uploads.prepare_file(body())
        self.assertEqual(r['payload'],CONTENT)
        self.assertEqual(r['sha256'],hashlib.sha256(CONTENT).hexdigest())
        self.assertEqual(r['content_type'],'text/plain')
        for change in ({'filename':'../secret.txt'},{'filename':'bad\r\n.txt'},
                       {'filename':'executable.html'},{'fileB64':'$$$$'},
                       {'fileB64':''},{'uploadId':'bad'}):
            with self.subTest(change=change), self.assertRaises(AuthError):uploads.prepare_file(body(**change))

    def test_size_boundary_rejected_before_decode(self):
        with patch.object(uploads,'MAX_FILE_BYTES',3):
            self.assertEqual(uploads.prepare_file(body(fileB64='YWJj'))['size_bytes'],3)
            with self.assertRaises(AuthError) as caught:uploads.prepare_file(body(fileB64='YWJjZA=='))
            self.assertEqual(caught.exception.status,413)

    def test_extraction_failure_does_not_open_transaction(self):
        h=handler();factory=Mock()
        uploads.handle_upload(h,json.dumps(body()).encode(),factory,lambda *a:('', '扫描件没有正文'),None,lambda t:False)
        factory.assert_not_called();self.assertEqual(response(h)['error'],'extraction_failed')

    def test_invalid_request_and_missing_admin_file_fail_closed(self):
        for raw in (b'[]',b'{',json.dumps(body(fileB64='')).encode()):
            h=handler();factory=Mock()
            uploads.handle_upload(h,raw,factory,Mock(),None,lambda t:False,admin=True)
            self.assertFalse(response(h)['ok']);factory.assert_not_called()

    def test_originals_do_not_fall_back_to_ephemeral_files(self):
        @contextmanager
        def factory():yield SimpleNamespace(read=lambda:json.dumps(STATE),write=Mock())
        h=handler()
        with patch.object(uploads,'require_session',return_value=PRINCIPAL):
            uploads.handle_upload(h,json.dumps(body()).encode(),factory,lambda *a:(CONTENT.decode(),None),None,lambda t:False)
        self.assertEqual(response(h)['error'],'original_storage_unavailable')

    def test_exact_project_authorization_not_city_label(self):
        @contextmanager
        def factory():yield SimpleNamespace(read=lambda:json.dumps(STATE),write=Mock())
        h=handler()
        with patch.object(uploads,'require_session',return_value=PRINCIPAL):
            uploads.handle_upload(h,json.dumps(body(projectKey='workspace-b')).encode(),factory,lambda *a:(CONTENT.decode(),None),None,lambda t:False)
        self.assertEqual(response(h)['error'],'workspace_forbidden')

    def test_user_chunk_ids_are_original_scoped(self):
        a=uploads.user_chunks(CONTENT.decode(),'same.txt','产业','a'*32)
        b=uploads.user_chunks(CONTENT.decode(),'same.txt','产业','b'*32)
        self.assertNotEqual(a[0]['id'],b[0]['id'])
        self.assertEqual(a[0]['originalId'],'a'*32)

    def test_admin_text_confirmation_does_not_claim_original(self):
        written=[]
        @contextmanager
        def factory():yield SimpleNamespace(read=lambda:json.dumps(STATE),write=lambda s:written.append(s) or True)
        h=handler()
        with patch.object(uploads,'require_session',return_value={'scope':'admin','user':'admin'}):
            uploads.handle_upload(h,json.dumps({'projectKey':KEY,'text':CONTENT.decode(),'topic':'产业','source':'chat'}).encode(),factory,Mock(),None,lambda t:False,admin=True)
        self.assertTrue(response(h)['ok']);self.assertNotIn('original',response(h))
        self.assertNotIn('UPLOADS',json.loads(written[0]))


@unittest.skipUnless(os.environ.get('HXZ_TEST_DATABASE_URL'),'isolated PostgreSQL CI fixture only')
class OriginalPostgresTests(unittest.TestCase):
    def setUp(self):
        import psycopg2
        self.url=os.environ['HXZ_TEST_DATABASE_URL']
        parsed=urlsplit(self.url)
        self.assertIn(parsed.hostname,('localhost','127.0.0.1'));self.assertEqual(parsed.path,'/report_ci')
        self.connect=lambda:psycopg2.connect(self.url)
        with self.connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute("CREATE TABLE IF NOT EXISTS sync_data(id INTEGER PRIMARY KEY,data TEXT NOT NULL,updated_at TIMESTAMP DEFAULT NOW())")
                uploads.initialize(cursor)
                cursor.execute('TRUNCATE upload_originals,sync_data')
                cursor.execute('INSERT INTO sync_data(id,data) VALUES(1,%s)',(json.dumps(STATE),))
        self.patch=patch.object(uploads,'require_session',return_value=PRINCIPAL);self.patch.start();self.addCleanup(self.patch.stop)

    def factory(self):return PostgresSession(self.connect,lambda c:None)

    def send(self, value=None, *, factory=None, admin=False):
        h=handler()
        uploads.handle_upload(h,json.dumps(value or body()).encode(),factory or self.factory,
                              lambda name,data:(data.decode(),None),None,lambda t:False,admin=admin)
        return h,response(h)

    def read(self):
        with self.connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute('SELECT data FROM sync_data WHERE id=1');state=json.loads(cursor.fetchone()[0])
                cursor.execute('SELECT upload_id,project_key,sha256,payload FROM upload_originals ORDER BY upload_id');rows=cursor.fetchall()
        return state,rows

    def test_commit_survives_new_connection_and_downloads_exact_bytes(self):
        _,result=self.send();self.assertTrue(result['ok'])
        state,rows=self.read();self.assertEqual(len(rows),1);self.assertEqual(bytes(rows[0][3]),CONTENT)
        self.assertEqual(state['UPLOADS'][KEY][0]['originalId'],'a'*32)
        self.assertNotIn('fileB64',json.dumps(state));self.assertNotIn('dataUrl',json.dumps(state))
        h=handler('/api/upload-file?projectKey='+KEY+'&uploadId='+'a'*32)
        uploads.download_upload(h,self.factory,None)
        self.assertEqual(h.wfile.getvalue(),CONTENT)
        self.assertIn(('Content-Disposition',"attachment; filename=upload; filename*=UTF-8''%E5%8E%9F%E5%A7%8B%E8%B5%84%E6%96%99.txt"),[call.args for call in h.send_header.call_args_list])

    def test_sync_failure_rolls_back_original(self):
        @contextmanager
        def failing():
            with self.factory() as session:
                session.write=lambda value:False
                yield session
        _,result=self.send(factory=failing)
        self.assertFalse(result['ok']);state,rows=self.read();self.assertEqual(rows,[]);self.assertNotIn('UPLOADS',state)

    def test_same_id_retry_is_idempotent_and_different_bytes_conflict(self):
        self.assertTrue(self.send()[1]['ok'])
        result=self.send()[1];self.assertTrue(result['replayed'])
        self.assertEqual(len(self.read()[0]['UPLOADS'][KEY]),1)
        _,conflict=self.send(body(fileB64=base64.b64encode(b'changed').decode()))
        self.assertEqual(conflict['error'],'upload_conflict')
        self.assertEqual(bytes(self.read()[1][0][3]),CONTENT)

    def test_concurrent_different_uploads_keep_both_references_and_bytes(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda x:self.send(body(uploadId=x*32))[1],('a','b')))
        self.assertTrue(all(r['ok'] for r in results));state,rows=self.read()
        self.assertEqual(len(rows),2);self.assertEqual(len(state['UPLOADS'][KEY]),2)
        self.assertEqual(len({c['id'] for c in state['KB_FILE_CHUNKS'][KEY]}),2*len(uploads.user_chunks(CONTENT.decode(),'原始资料.txt','产业','a'*32)))

    def test_other_workspace_cannot_read_original_even_with_correct_id(self):
        self.send()
        h=handler('/api/upload-file?projectKey=workspace-b&uploadId='+'a'*32)
        uploads.download_upload(h,self.factory,None)
        self.assertEqual(response(h)['error'],'workspace_forbidden')
        with patch.object(uploads,'require_session',return_value={'scope':'admin','user':'admin'}):
            h=handler('/api/upload-file?projectKey=workspace-b&uploadId='+'a'*32)
            uploads.download_upload(h,self.factory,None)
            self.assertEqual(response(h)['error'],'original_not_found')

    def test_download_integrity_failure_is_not_served(self):
        self.send()
        with self.connect() as conn:
            with conn.cursor() as cursor:cursor.execute("UPDATE upload_originals SET sha256=%s",('0'*64,))
        h=handler('/api/upload-file?projectKey='+KEY+'&uploadId='+'a'*32)
        uploads.download_upload(h,self.factory,None)
        self.assertEqual(response(h)['error'],'original_integrity_failed')

    def test_revoked_session_is_checked_inside_locked_transaction(self):
        with patch.object(uploads,'require_session',side_effect=AuthError(401,'auth_required','请登录')):
            self.assertEqual(self.send()[1]['error'],'auth_required')
        self.assertEqual(self.read()[1],[])

    def test_admin_original_and_annotation_commit_together(self):
        value=body(source='file',topic='产业',kbIdx=None,by='forged-user')
        with patch.object(uploads,'require_session',return_value={'scope':'admin','user':'actual-admin'}):
            self.assertTrue(self.send(value,admin=True)[1]['ok'])
        state,rows=self.read();audit=state['PROJECTS'][KEY]['kbUploads'][0]
        self.assertEqual(audit['originalId'],rows[0][0]);self.assertEqual(audit['by'],'actual-admin')
        self.assertEqual(state['UPLOADS'][KEY][0]['account'],'actual-admin')

    def test_postgres_copy_backup_restore_recovers_references_and_exact_original(self):
        # Isolated local fixture only: exercise PostgreSQL's real BYTEA export /
        # import roundtrip, not production data and not a mocked restore claim.
        self.assertTrue(self.send()[1]['ok'])
        backups={}
        with self.connect() as conn:
            with conn.cursor() as cursor:
                for table in ('sync_data','upload_originals'):
                    stream=io.StringIO();cursor.copy_expert('COPY '+table+' TO STDOUT WITH CSV',stream)
                    backups[table]=stream.getvalue()
                cursor.execute('TRUNCATE upload_originals,sync_data')
        with self.connect() as conn:
            with conn.cursor() as cursor:
                for table in ('sync_data','upload_originals'):
                    cursor.execute('SELECT count(*) FROM '+table)
                    self.assertEqual(cursor.fetchone()[0],0)
                for table in ('sync_data','upload_originals'):
                    cursor.copy_expert('COPY '+table+' FROM STDIN WITH CSV',io.StringIO(backups[table]))
        restored,rows=self.read()
        self.assertEqual(restored['UPLOADS'][KEY][0]['originalId'],rows[0][0])
        self.assertEqual(restored['UPLOADS'][KEY][0]['originalSha256'],hashlib.sha256(bytes(rows[0][3])).hexdigest())
        h=handler('/api/upload-file?projectKey='+KEY+'&uploadId='+'a'*32)
        uploads.download_upload(h,self.factory,None)
        self.assertEqual(h.wfile.getvalue(),CONTENT)
