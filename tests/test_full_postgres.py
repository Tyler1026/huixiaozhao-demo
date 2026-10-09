"""Real PostgreSQL CI fixture: concurrency, leases and durable report bytes."""
import concurrent.futures
import hashlib
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import Mock, patch

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

    def test_deep_request_mode_survives_postgres_checkpoint_restart(self):
        report = self.store.create('offline-test', '测试省', '测试区', 'deep', True, mode='deep')
        first = self.store.claim(synthetic=True)
        self.assertEqual(first['mode'], 'deep')
        self.store.finish_part(first['step_id'], first['token'], {'text':'OFFLINE committed checkpoint', 'metadata':{}})
        reopened = PostgresFullStore(self.url, artifact_root=self.root, backoff=(0,0))
        self.assertEqual(reopened.get('offline-test', report['id'])['mode'], 'deep')
        self.assertEqual(reopened.claim(synthetic=True)['mode'], 'deep')
        self.assertEqual(reopened.parts(report['id'])['one'][0]['text'], 'OFFLINE committed checkpoint')

    def test_live_worker_repairs_committed_suffix_atomically_and_archive_survives_restart(self):
        stages = ({'id': 'one', 'filename': 'one.md', 'parts': ('first', 'second', 'third', 'fourth')},)
        store = PostgresFullStore(self.url, artifact_root=self.root, stages=stages, backoff=(0, 0))
        report = store.create('offline-test', '测试省', '测试区', 'repair-live-fixture', False)
        # These are explicitly offline fixture bytes; synthetic=False exercises
        # the production preflight branch without any provider/API work.
        retained = {'text': 'OFFLINE retained prefix', 'metadata': {'evidence': [
            {'url': 'https://stats.gov.cn/offline-fixture', 'excerpt': 'OFFLINE retrieved excerpt'}]}}
        outputs = [retained,
                   {'text': 'OFFLINE defective checkpoint http://stats.gov.cn/历史', 'metadata': {}},
                   {'text': 'OFFLINE dependent suffix', 'metadata': {}}]
        committed = []
        for value in outputs:
            job = store.claim(synthetic=False)
            self.assertTrue(store.finish_part(job['step_id'], job['token'], value))
            with store.db() as c:
                committed.append(dict(c.execute('SELECT * FROM full_steps WHERE id=?', (job['step_id'],)).fetchone()))
        progress_before = store.get('offline-test', report['id'])['progress_at']
        active = store.claim(synthetic=False)
        provider = Mock(repair_invalid_checkpoints=True)
        provider.run_part.side_effect = AssertionError('repair cannot perform provider work')
        with patch.object(store, 'claim', return_value=active), patch('multiprocessing.process.BaseProcess.start') as spawn:
            result = run_once(store, provider, synthetic=False, contract=TinyContract)
        self.assertEqual(result['status'], 'checkpoint_repaired')
        provider.run_part.assert_not_called()
        spawn.assert_not_called()
        self.assertFalse(store.finish_part(active['step_id'], active['token'], {'text': 'OFFLINE stale', 'metadata': {}}))
        self.assertFalse(store.heartbeat(active['step_id'], active['token']))
        reopened = PostgresFullStore(self.url, artifact_root=self.root, stages=stages, backoff=(0, 0))
        with reopened.db() as c:
            archived = [dict(row) for row in c.execute('SELECT * FROM full_checkpoint_archive WHERE report_id=? ORDER BY ordinal', (report['id'],)).fetchall()]
            current = [dict(row) for row in c.execute('SELECT status,attempts,output,token FROM full_steps WHERE report_id=? ORDER BY ordinal', (report['id'],)).fetchall()]
        self.assertEqual(len(archived), 2)
        for old, saved in zip(committed[1:], archived):
            self.assertEqual(saved['output'], old['output'])
            self.assertEqual(saved['output_sha256'], hashlib.sha256(old['output'].encode('utf-8')).hexdigest())
            self.assertEqual((saved['attempts'], saved['consumed']), (old['attempts'], old['consumed']))
            self.assertEqual(saved['reason'], 'unsafe_text_url')
        self.assertEqual([row['status'] for row in current], ['done', 'pending', 'pending', 'pending', 'pending'])
        self.assertTrue(all(row['output'] is None and row['token'] is None for row in current[1:]))
        self.assertEqual([row['attempts'] for row in current[:3]], [row['attempts'] for row in committed])
        self.assertEqual(reopened.parts(report['id'])['one'], [retained])
        self.assertEqual(reopened.get('offline-test', report['id'])['progress_at'], progress_before)
        new = reopened.claim(synthetic=False)
        self.assertEqual(new['part'], 'second')
        self.assertNotEqual(new['token'], active['token'])
        self.assertTrue(reopened.finish_part(new['step_id'], new['token'], {'text': 'OFFLINE repaired checkpoint', 'metadata': {}}))
        self.assertEqual(reopened.get('offline-test', report['id'])['parts_done'], 2)

    def _policy_checkpoint_case(self, policy_count=0, economic_count=12):
        stages = ({'id': 'fact_check', 'filename': 'checks.md',
                   'parts': ('经济关键数字', '政策金额', '五星企业信号')},)
        store = PostgresFullStore(self.url, artifact_root=self.root, stages=stages, backoff=(0, 0))
        report = store.create('offline-test', '测试省', '测试区', 'policy-cache-fixture', False)
        for category, count in (('economic', economic_count), ('policy', policy_count), ('high_star', 3)):
            output = {'text': 'OFFLINE FIXTURE — NOT REAL RESEARCH ' + category,
                      'metadata': {'checks': [
                          {'claim': f'OFFLINE {category} {i}', 'category': category,
                           'direction': f'dir{i + 1}' if category == 'high_star' else None}
                          for i in range(count)], 'evidence': [
                              {'url': 'https://stats.gov.cn/offline-source', 'excerpt': 'OFFLINE source excerpt'}]}}
            job = store.claim(synthetic=False)
            self.assertTrue(store.finish_part(job['step_id'], job['token'], output))
        return store, report, store.claim(synthetic=False)

    @staticmethod
    def _policy_snapshot(store, report_id):
        with store.db() as c:
            return {
                'report': dict(c.execute('SELECT * FROM full_reports WHERE id=?', (report_id,)).fetchone()),
                'steps': [dict(row) for row in c.execute('SELECT * FROM full_steps WHERE report_id=? ORDER BY ordinal', (report_id,)).fetchall()],
                'archive': [dict(row) for row in c.execute('SELECT * FROM full_checkpoint_archive WHERE report_id=? ORDER BY ordinal', (report_id,)).fetchall()],
                'events': [dict(row) for row in c.execute('SELECT * FROM full_events WHERE report_id=? ORDER BY id', (report_id,)).fetchall()],
            }

    def test_zero_policy_checkpoint_is_repaired_by_inherited_postgres_transaction(self):
        store, report, active = self._policy_checkpoint_case()
        before = self._policy_snapshot(store, report['id'])
        provider = Mock(repair_invalid_checkpoints=True)
        provider.run_part.side_effect = AssertionError('repair cannot perform provider work')
        with patch.object(store, 'claim', return_value=active), patch('multiprocessing.process.BaseProcess.start') as spawn:
            result = run_once(store, provider, synthetic=False, contract=TinyContract)
        self.assertEqual(result['status'], 'checkpoint_repaired')
        provider.run_part.assert_not_called()
        spawn.assert_not_called()
        reopened = PostgresFullStore(self.url, artifact_root=self.root, stages=store.stages, backoff=(0, 0))
        after = self._policy_snapshot(reopened, report['id'])
        self.assertEqual(after['steps'][0], before['steps'][0])
        self.assertEqual(after['report']['progress_at'], before['report']['progress_at'])
        self.assertEqual(after['report']['definition'], before['report']['definition'])
        self.assertEqual(after['report']['status'], 'queued')
        self.assertEqual([row['ordinal'] for row in after['archive']], [1, 2])
        for archived, original in zip(after['archive'], before['steps'][1:3]):
            self.assertEqual(archived['output'], original['output'])
            self.assertEqual(archived['output_sha256'], hashlib.sha256(original['output'].encode('utf-8')).hexdigest())
            self.assertEqual((archived['attempts'], archived['consumed']), (original['attempts'], original['consumed']))
            self.assertEqual(archived['reason'], 'checkpoint_policy_checks_missing')
        self.assertEqual([row['status'] for row in after['steps']], ['done', 'pending', 'pending', 'pending'])
        for repaired, original in zip(after['steps'][1:], before['steps'][1:]):
            self.assertEqual(repaired['attempts'], original['attempts'])
            for field in ('output', 'token', 'expires', 'deadline', 'started_at'):
                self.assertIsNone(repaired[field])
        self.assertEqual([row['consumed'] for row in after['steps'][:3]], [row['consumed'] for row in before['steps'][:3]])
        self.assertGreaterEqual(after['steps'][-1]['consumed'], before['steps'][-1]['consumed'])
        self.assertFalse(store.finish_part(active['step_id'], active['token'], {'text': 'OFFLINE stale', 'metadata': {}}))
        self.assertFalse(reopened.repair_invalid_checkpoints(active['step_id'], active['token']))
        replacement = reopened.claim(synthetic=False)
        self.assertEqual(replacement['part'], '政策金额')
        self.assertEqual(replacement['attempts'], before['steps'][1]['attempts'] + 1)
        self.assertNotEqual(replacement['token'], active['token'])

    def test_three_policy_and_legacy_five_economic_checks_survive_postgres_repair(self):
        store, report, active = self._policy_checkpoint_case(policy_count=3, economic_count=5)
        before = self._policy_snapshot(store, report['id'])
        self.assertFalse(store.repair_invalid_checkpoints(active['step_id'], active['token']))
        self.assertEqual(self._policy_snapshot(store, report['id']), before)

    def test_policy_postgres_recovery_rejects_stale_tokens_and_terminal_reports(self):
        store, report, active = self._policy_checkpoint_case()
        before = self._policy_snapshot(store, report['id'])
        self.assertFalse(store.repair_invalid_checkpoints(active['step_id'], 'stale-token'))
        self.assertEqual(self._policy_snapshot(store, report['id']), before)
        for status in ('cancelled', 'completed', 'failed'):
            with self.subTest(status=status):
                with store.db() as c:
                    c.execute('UPDATE full_reports SET status=? WHERE id=?', (status, report['id']))
                before = self._policy_snapshot(store, report['id'])
                self.assertFalse(store.repair_invalid_checkpoints(active['step_id'], active['token']))
                self.assertEqual(self._policy_snapshot(store, report['id']), before)

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
