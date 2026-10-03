"""Real PostgreSQL CI fixture: concurrency, leases and durable report bytes."""
import concurrent.futures
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import urlsplit

from report_service.full_postgres import PostgresFullStore
from report_service.full_worker import run_once

TINY = ({'id':'one','filename':'one.md','parts':('first','second')},)


class TinyContract:
    @staticmethod
    def assemble(stage, parts):
        return {'text':'\n'.join(p['text'] for p in parts),'metadata':{}}
    @staticmethod
    def validate(*args, **kwargs): return []


class PgProvider:
    def run_part(self, stage, part, job, prior):
        return {'text':'OFFLINE FIXTURE — NOT REAL RESEARCH '+part,'metadata':{}}


@unittest.skipUnless(os.environ.get('HXZ_TEST_DATABASE_URL'), 'isolated PostgreSQL CI fixture only')
class PostgresReportTests(unittest.TestCase):
    def setUp(self):
        self.url=os.environ['HXZ_TEST_DATABASE_URL']
        parsed=urlsplit(self.url)
        self.assertIn(parsed.hostname,('localhost','127.0.0.1'))
        self.assertEqual(parsed.path,'/report_ci')
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()/'artifacts'
        self.store=PostgresFullStore(self.url,artifact_root=self.root,stages=TINY,backoff=(0,0))
        with self.store.db() as c:
            c.execute('TRUNCATE full_reports,full_steps,full_events,full_artifact_bytes CASCADE')

    def test_twenty_concurrent_creates_and_claims_have_one_effective_lease(self):
        def create(n):return self.store.create('offline-test','测试省','测试区','same',True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            jobs=list(pool.map(create,range(20)))
            claims=list(pool.map(lambda n:self.store.claim(synthetic=True),range(20)))
        self.assertEqual(sum(j['created'] for j in jobs),1)
        self.assertEqual(len({j['id'] for j in jobs}),1)
        self.assertEqual(sum(j is not None for j in claims),1)

    def test_expired_worker_cannot_commit_after_restart_and_checkpoint_is_kept(self):
        report=self.store.create('offline-test','测试省','测试区','recovery',True)
        old=self.store.claim(ttl=.01,timeout=10,synthetic=True)
        time.sleep(.03)
        reopened=PostgresFullStore(self.url,artifact_root=self.root,stages=TINY,backoff=(0,0))
        new=reopened.claim(synthetic=True)
        self.assertNotEqual(old['token'],new['token'])
        self.assertFalse(self.store.finish_part(old['step_id'],old['token'],{'text':'stale','metadata':{}}))
        self.assertTrue(reopened.finish_part(new['step_id'],new['token'],{'text':'checkpoint','metadata':{}}))
        self.assertEqual(reopened.parts(report['id'])['one'][0]['text'],'checkpoint')
        run_once(reopened,PgProvider(),synthetic=True,contract=TinyContract)
        self.assertEqual(reopened.get('offline-test',report['id'])['parts_done'],2)
        self.assertEqual(reopened.parts(report['id'])['one'][0]['text'],'checkpoint')

    def test_cancel_invalidates_active_lease_without_discarding_checkpoints(self):
        report=self.store.create('offline-test','测试省','测试区','cancel',True)
        first=self.store.claim(synthetic=True)
        self.store.finish_part(first['step_id'],first['token'],{'text':'checkpoint','metadata':{}})
        active=self.store.claim(synthetic=True)
        self.assertTrue(self.store.cancel('offline-test',report['id']))
        self.assertFalse(self.store.finish_part(active['step_id'],active['token'],{'text':'late','metadata':{}}))
        self.assertIsNone(self.store.claim(synthetic=True))
        self.assertEqual(self.store.get('offline-test',report['id'])['parts_done'],1)

    def test_all_delivery_bytes_survive_scratch_loss_and_reject_tampering(self):
        from report_service.full_contract import STAGES, make_synthetic_part, assemble
        from report_service.full_artifacts import build_bundle
        store=PostgresFullStore(self.url,artifact_root=self.root,backoff=(0,0))
        report=store.create('offline-test','测试省','测试区','bundle',True)
        prior,outputs={},{}
        for stage in STAGES:
            values=[]
            for part in stage['parts']:
                job=store.claim(synthetic=True)
                self.assertEqual((job['stage'],job['part']),(stage['id'],part))
                value=make_synthetic_part(stage['id'],part,job,prior)
                values.append(value)
                self.assertTrue(store.finish_part(job['step_id'],job['token'],value))
                prior[stage['id']]=assemble(stage['id'],values)
            outputs[stage['filename']]=prior[stage['id']]
        job=store.claim(synthetic=True)
        manifest=build_bundle(self.root,report['id'],'测试区',outputs,True)
        self.assertTrue(store.complete(job['step_id'],job['token'],manifest))
        original=store.artifact('offline-test',report['id'],'full.docx')
        shutil.rmtree(self.root)
        reopened=PostgresFullStore(self.url,artifact_root=self.root)
        for entry in manifest['files']:
            data=reopened.artifact('offline-test',report['id'],entry['name'])
            self.assertEqual(len(data),entry['bytes'])
        self.assertEqual(reopened.artifact('offline-test',report['id'],'full.docx'),original)
        with self.assertRaises(ValueError): reopened.artifact('wrong-tenant',report['id'],'full.docx')
        with self.assertRaises(ValueError): reopened.artifact('offline-test',report['id'],'../outside')
        with reopened.db() as c:
            c.execute("UPDATE full_artifact_bytes SET data=? WHERE report_id=? AND name='full.docx'",(b'offline corruption',report['id']))
        with self.assertRaises(ValueError): reopened.artifact('offline-test',report['id'],'full.docx')

    def test_scalar_website_cancellation_query_handles_owner_cancel_and_reset(self):
        import json
        from unittest.mock import patch
        from backend import storage
        from backend.sync_transaction import report_request_active
        import psycopg2
        with self.store.db() as c:
            c.execute('CREATE TABLE IF NOT EXISTS sync_data(id INTEGER PRIMARY KEY,data TEXT NOT NULL,updated_at TIMESTAMP DEFAULT NOW())')
            data=json.dumps({'REPORT_REQUESTS':[{'id':'rrcancel','engine':'full-v1','status':'running'}]})
            c.execute('INSERT INTO sync_data(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',(data,))
        with patch.object(storage,'DATABASE_URL',self.url),patch.object(storage,'psycopg2',psycopg2,create=True):
            self.assertTrue(report_request_active('rrcancel','full-v1'))
            self.assertFalse(report_request_active('rrcancel','wrong-owner'))
            with self.store.db() as c:
                c.execute('UPDATE sync_data SET data=? WHERE id=1',(data.replace('running','cancelled'),))
            self.assertFalse(report_request_active('rrcancel','full-v1'))
            with self.store.db() as c:
                c.execute("UPDATE sync_data SET data='{}' WHERE id=1")
            self.assertFalse(report_request_active('rrcancel','full-v1'))


if __name__=='__main__':unittest.main()
