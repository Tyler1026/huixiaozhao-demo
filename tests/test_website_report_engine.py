"""Isolated website handoff, recovery, cancellation and publication tests.

All data lives in disposable local files and is explicitly an offline fixture.
No model/search calls or customer storage are used.
"""
import copy
import hashlib
import json
import tempfile
import multiprocessing
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from backend.sync_transaction import file_session, handle_sync_serialized
from backend.sync_route import SyncDependencies
from report_service import hosted
from report_service.hosted import configured_environment, readiness, start_supervisor
from report_service.website_queue import ENGINE, TENANT, TOPICS, WebsiteQueue, _balanced_chunks, _chunks, fence_updates, report_id, request_publication


class MemoryStore:
    def __init__(self):
        self.jobs, self.calls, self.cancelled = {}, [], []
        self.payloads = {'full.docx': b'offline full delivery fixture',
                         'compact.docx': b'offline compact delivery fixture',
                         '09_compact_report.md': 'OFFLINE FIXTURE — NOT REAL RESEARCH'.encode(),
                         'evidence.json': json.dumps({'stages': {'06b_fact_check.md': {'checks': [{'verdict':'一致'}]}}}).encode()}
        for _, _, names in TOPICS:
            for name in names:
                self.payloads[name] = ('\n'.join('OFFLINE FIXTURE — NOT REAL RESEARCH ' + str(n) + '。' * 100 for n in range(150))).encode()

    def create(self, tenant, province, city, key, synthetic, *, mode='standard'):
        self.calls.append((tenant, key, synthetic))
        rid = report_id(key)
        self.jobs.setdefault(rid, {'id': rid, 'city': city, 'province': province, 'synthetic': synthetic,
            'status': 'queued', 'mode': mode, 'stages_done': 0, 'stages_total': 16,
            'parts_done': 0, 'parts_total': 80, 'progress_at': None, 'failure_code': None,
            'current': {'stage': 'economy', 'attempts': 0, 'next_at': 0},
            'manifest': {'files': [{'name': n, 'sha256': hashlib.sha256(v).hexdigest(), 'bytes': len(v)} for n,v in self.payloads.items()]}})
        return copy.deepcopy(self.jobs[rid])

    def get(self, tenant, rid):
        return copy.deepcopy(self.jobs.get(rid))

    def cancel(self, tenant, rid):
        self.cancelled.append(rid)

    def artifact(self, tenant, rid, name):
        return self.payloads[name]


class WaitingProvider:
    def run_part(self, *args):
        time.sleep(10)
        return {'text':'OFFLINE late fixture','metadata':{}}


class WebsiteEngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'website.json'
        self.store = MemoryStore()
        self.queue = WebsiteQueue(self.store, lambda: file_session(str(self.path), lambda: None))
        self.request = {'id':'rrfixture', 'city':'隔离测试区', 'province':'隔离测试省', 'status':'pending', 'ts':1}
        self.write({'REPORT_REQUESTS': [self.request], 'PROJECTS': {'old': {'city':'旧报告', 'kb':[]}}})

    def write(self, state): self.path.write_text(json.dumps(state, ensure_ascii=False))
    def read(self): return json.loads(self.path.read_text())

    def completed(self):
        self.queue.ingest()
        self.store.jobs[report_id('rrfixture')].update(status='completed', stages_done=16, parts_done=80, current=None)
        self.queue.mirror()

    def test_repeated_handoff_uses_same_live_job_and_leaves_legacy_running_done_intact(self):
        state = self.read()
        legacy = [{'id':'rrlegacy','city':'原地区','province':'原省','status':'running','done':8},
                  {'id':'rrdone','city':'原地区','province':'原省','status':'done','files':[{'b64':'eA=='}]}]
        state['REPORT_REQUESTS'] += legacy; self.write(state)
        self.queue.ingest(); self.queue.ingest()
        self.assertEqual(self.store.calls, [(TENANT,'rrfixture',False)])
        self.assertEqual(self.read()['REPORT_REQUESTS'][1:], legacy)

    def test_management_deep_request_is_handed_off_without_downgrade(self):
        state = self.read(); state['REPORT_REQUESTS'][0]['mode'] = 'deep'; self.write(state)
        self.queue.ingest()
        self.assertEqual(self.store.jobs[report_id('rrfixture')]['mode'], 'deep')
        self.assertEqual(self.read()['REPORT_REQUESTS'][0]['mode'], 'deep')
        forged = dict(self.request, mode='unknown')
        with self.assertRaises(ValueError):
            fence_updates(json.dumps({'REPORT_REQUESTS': [forged]}).encode(), {})

    def test_handoff_commit_failure_recovers_idempotently(self):
        with patch('backend.sync_transaction.os.replace', side_effect=OSError('offline injected failure')):
            with self.assertRaises(OSError): self.queue.ingest()
        self.assertEqual(self.read()['REPORT_REQUESTS'][0]['status'], 'pending')
        self.queue.ingest()
        self.assertEqual(len(self.store.jobs), 1)
        self.assertEqual(self.read()['REPORT_REQUESTS'][0]['status'], 'running')

    def test_retrieval_failure_stays_running_with_checkpoint_and_retry_details(self):
        self.queue.ingest()
        self.store.jobs[report_id('rrfixture')].update(status='retry_wait', stages_done=8, parts_done=35,
            failure_code='upstream', progress_at=123, current={'stage':'enterprises_1','attempts':3,'next_at':999})
        self.queue.mirror()
        r = self.read()['REPORT_REQUESTS'][0]
        self.assertEqual((r['status'],r['done'],r['retryAt']),('running',8,999))
        self.assertNotIn('files',r)

    def test_browser_cancel_revokes_internal_job_and_late_completion_is_not_acknowledged(self):
        self.queue.ingest()
        state=self.read(); state['REPORT_REQUESTS'][0]['status']='cancelled'; self.write(state)
        self.store.jobs[report_id('rrfixture')]['status']='completed'
        self.queue.ingest(); self.queue.mirror()
        self.assertEqual(self.store.cancelled,[report_id('rrfixture')])
        self.assertEqual(self.read()['REPORT_REQUESTS'][0]['status'],'cancelled')
        self.assertNotIn('files',self.read()['REPORT_REQUESTS'][0])

    def test_delivery_failure_does_not_claim_done_and_recovers_without_research(self):
        self.queue.ingest(); self.store.jobs[report_id('rrfixture')]['status']='completed'
        with patch.object(self.store,'artifact',side_effect=OSError('offline disk failure')):
            with self.assertRaises(OSError): self.queue.mirror()
        self.assertEqual(self.read()['REPORT_REQUESTS'][0]['status'],'running')
        self.queue.mirror()
        self.assertEqual(self.read()['REPORT_REQUESTS'][0]['status'],'done')
        self.assertEqual(len(self.store.calls),1)

    def test_publication_is_atomic_idempotent_and_preserves_existing_projects(self):
        self.completed(); state=self.read(); state['REPORT_REQUESTS'][0]['pushRequested']=True; self.write(state)
        old=copy.deepcopy(state['PROJECTS']['old'])
        with patch('backend.sync_transaction.os.replace',side_effect=OSError('offline publication failure')):
            with self.assertRaises(OSError): self.queue.mirror()
        self.assertNotIn('REPORT_PUBLICATIONS',self.read())
        self.queue.mirror(); once=self.path.read_bytes(); self.queue.mirror()
        self.assertEqual(self.path.read_bytes(),once)
        final=self.read(); self.assertEqual(final['PROJECTS']['old'],old)
        self.assertTrue(final['REPORT_REQUESTS'][0]['pushed'])
        self.assertEqual(len(final['REPORT_PUBLICATIONS']),1)
        self.assertNotIn('CITY_ACCOUNTS',final)
        self.assertEqual(final['CITY_BASE_PACKAGES']['隔离测试区'],'report_rrfixture')

    def test_existing_download_buttons_return_correct_full_and_short_bytes(self):
        from backend.report_route import report_file
        import io
        import urllib.parse
        self.completed()
        self.assertEqual([f['kind'] for f in self.read()['REPORT_REQUESTS'][0]['files']],
                         ['full', 'short'])
        for kind, artifact in [('full', 'full.docx'), ('short', 'compact.docx')]:
            for exact in (False, True):
                query = {'city': self.request['city'], 'kind': kind}
                if exact:
                    query['requestId'] = self.request['id']
                handler = Mock(); handler.wfile = io.BytesIO()
                handler.path = '/api/report-file?' + urllib.parse.urlencode(query)
                report_file(handler, False, None, str(self.path))
                handler.send_response.assert_called_once_with(200)
                self.assertEqual(handler.wfile.getvalue(), self.store.payloads[artifact])

    def test_native_publication_binds_saved_body_to_exact_frontend_topic(self):
        self.completed()
        state = self.read(); state['REPORT_REQUESTS'][0]['pushRequested'] = True; self.write(state)
        self.queue.mirror()
        final = self.read(); key = 'report_rrfixture'
        project, report = final['PROJECTS'][key], final['REPORTSTATE'][key]
        topic = project['topic']
        body = self.store.payloads['09_compact_report.md'].decode()
        self.assertEqual(report['topic'], topic)
        self.assertEqual(report['text'], body)
        self.assertEqual(report['aiReportByTopic'], {topic: body})
        self.assertEqual(report['phase'], 2)
        self.assertEqual(report['phaseByTopic'], {topic: 2})
        self.assertEqual(report['tsByTopic'], {topic: report['ts']})
        self.assertEqual(report['scoreBasis'], '核验一致项比例')
        self.assertEqual(report['sourceReportId'], project['reportRequestId'])
        self.assertEqual(project['clues'], [])

    def test_native_publication_keeps_true_zero_check_ratio(self):
        self.completed()
        state = self.read(); state['REPORT_REQUESTS'][0]['pushRequested'] = True; self.write(state)
        self.store.payloads['evidence.json'] = json.dumps({'stages': {
            '06b_fact_check.md': {'checks': [{'verdict': '不可用'}, {'verdict': '不一致'}]}}}).encode()
        self.queue.mirror()
        report = self.read()['REPORTSTATE']['report_rrfixture']
        self.assertEqual(report['score'], 0)
        self.assertEqual(report['scoreStatus'], 'classified')
        self.assertEqual(report['checkVerdictCounts'], {'consistent': 0, 'inconsistent': 1, 'pending': 1, 'unclassified': 0})

    def test_free_form_check_verdict_is_unclassified_without_inflating_agreement(self):
        self.completed()
        state = self.read(); state['REPORT_REQUESTS'][0]['pushRequested'] = True; self.write(state)
        self.store.payloads['evidence.json'] = json.dumps({'stages': {
            '06b_fact_check.md': {'checks': [{'verdict': '多来源印证但松江落地待核实'}, {'verdict': '一致'}]}}}).encode()
        self.queue.mirror()
        report = self.read()['REPORTSTATE']['report_rrfixture']
        self.assertEqual(report['score'], 50)
        self.assertEqual(report['scoreStatus'], 'unclassified')
        self.assertEqual(report['checkVerdictCounts']['unclassified'], 1)
        self.assertEqual(report['checkVerdictCounts']['consistent'], 1)

    def test_topic_cap_balances_original_chunks_and_keeps_each_file_boundaries(self):
        groups = [[{'text': f'OFFLINE file{f} chunk{i}', 'sourceFile': f'file{f}.md', 'ts': i}
                   for i in range(n)] for f, n in enumerate((74, 78, 84, 30))]
        original = copy.deepcopy(groups)
        selected = _balanced_chunks(groups)
        self.assertEqual(len(selected), 60)
        self.assertEqual(groups, original)
        for group in groups:
            picked = [row for row in selected if row['sourceFile'] == group[0]['sourceFile']]
            self.assertEqual(len(picked), 15)
            self.assertIs(picked[0], group[0])
            self.assertIs(picked[-1], group[-1])
            self.assertIs(picked[7], group[(len(group) - 1) // 2])
            for row in picked:
                self.assertTrue(any(row is original_row for original_row in group))
        self.assertEqual([row['sourceFile'] for row in selected[:4]], [group[0]['sourceFile'] for group in groups])
        altered = copy.deepcopy(groups)
        for group in altered:
            for row in group: row['ts'] += 90000
        self.assertEqual([row['text'] for row in selected], [row['text'] for row in _balanced_chunks(altered)])

    def test_topic_cap_redistributes_short_files_without_duplicates_or_fabrication(self):
        groups = [[], [{'text': 'only short source'}], [{'text': f'long source {i}'} for i in range(100)]]
        selected = _balanced_chunks(groups)
        self.assertEqual(len(selected), 60)
        self.assertIs(selected[0], groups[1][0])
        self.assertIs(selected[1], groups[2][0])
        self.assertIs(selected[-1], groups[2][-1])
        self.assertEqual(len({id(row) for row in selected}), 60)
        self.assertEqual(_balanced_chunks([[], []]), [])
        small = [[{'text': 'a'}, {'text': 'b'}], [{'text': 'c'}]]
        self.assertEqual(_balanced_chunks(small), [small[0][0], small[1][0], small[0][1]])

    def test_native_publication_topic_cap_keeps_all_source_files_and_only_whole_original_text(self):
        self.completed()
        state = self.read(); state['REPORT_REQUESTS'][0]['pushRequested'] = True; self.write(state)
        self.queue.mirror()
        topics = self.read()['PROJECTS']['report_rrfixture']['kb']
        for topic, (_, _, names) in zip(topics, TOPICS):
            known = topic['known']
            self.assertLessEqual(len(known), 60)
            self.assertEqual({row['sourceFile'] for row in known}, set(names))
            for name in names:
                originals = _chunks(self.store.payloads[name].decode(), 'rrfixture', name)
                source = [row for row in known if row['sourceFile'] == name]
                self.assertEqual(source[0]['text'], originals[0]['text'])
                self.assertEqual(source[-1]['text'], originals[-1]['text'])
                self.assertTrue(all(row['text'] in {chunk['text'] for chunk in originals} for row in source))
        self.assertGreaterEqual(sum(len(topic['known']) for topic in topics), 40)

    def test_incomplete_or_synthetic_package_never_enters_rag(self):
        self.completed(); state=self.read(); state['REPORT_REQUESTS'][0]['pushRequested']=True; self.write(state)
        for _,_,names in TOPICS:
            for n in names: self.store.payloads[n]=b'OFFLINE incomplete fixture'
        with self.assertRaises(ValueError): self.queue.mirror()
        self.assertNotIn('REPORT_PUBLICATIONS',self.read())
        self.store.jobs[report_id('rrfixture')]['synthetic']=True
        self.queue.mirror()
        self.assertNotIn('REPORT_PUBLICATIONS',self.read())

    def test_old_consumer_and_stale_browser_cannot_rewrite_engine_outputs(self):
        self.queue.ingest(); state=self.read(); old=copy.deepcopy(state['REPORT_REQUESTS'][0])
        raw=json.dumps({'PROJECTS':{'other':{}},'REPORT_REQUESTS':[dict(old,status='done',city='wrong',files=[{'b64':'bad'}])]}).encode()
        guarded=json.loads(fence_updates(raw,state))
        self.assertEqual(guarded['REPORT_REQUESTS'][0],old)
        self.assertEqual(guarded['PROJECTS'],{'other':{}})
        cancelled=json.loads(fence_updates(json.dumps({'REPORT_REQUESTS':[dict(old,status='cancelled')]}).encode(),state))
        self.assertEqual(cancelled['REPORT_REQUESTS'][0]['status'],'cancelled')

    def test_locked_sync_fence_rejects_forged_new_completion_and_keeps_request_contract(self):
        self.write({})
        deps=SyncDependencies(False,None,None,str(self.path),lambda:None,lambda x:x)
        import io
        handler=Mock();handler.wfile=io.BytesIO()
        handle_sync_serialized(handler,json.dumps({'REPORT_REQUESTS':[dict(self.request,status='done')]}).encode(),deps,guard=fence_updates)
        self.assertFalse(json.loads(handler.wfile.getvalue())['ok'])
        self.assertEqual(self.read(),{})
        handler.wfile=io.BytesIO()
        handle_sync_serialized(handler,json.dumps({'REPORT_REQUESTS':[self.request]}).encode(),deps,guard=fence_updates)
        self.assertTrue(json.loads(handler.wfile.getvalue())['ok'])
        self.assertEqual(self.read()['REPORT_REQUESTS'][0]['engine'],ENGINE)

    def test_configuration_requires_real_search_and_never_starts_synthetic_worker(self):
        env={'DATABASE_URL':'offline-test-only','DEEPSEEK_API_KEY':'offline-fixture',
             'HXZ_ENABLE_LIVE':'1'}
        result=readiness(env);self.assertFalse(result['ready']);self.assertEqual(result['missing'],['HXZ_SEARCH_KEY'])
        self.assertEqual(configured_environment(env)['HXZ_MODEL_NAME'],'deepseek-chat')
        self.assertNotIn('offline-fixture',json.dumps(result))
        self.assertTrue(readiness(dict(env, HXZ_SEARCH_KEY='offline-search-fixture'))['ready'])

    def test_default_supervisor_waits_without_spawning_when_switches_or_configuration_are_missing(self):
        configured = {'DATABASE_URL': 'offline-test-only',
                      'DEEPSEEK_API_KEY': 'offline-fixture',
                      'HXZ_SEARCH_KEY': 'offline-search-fixture'}
        environments = ({}, configured,
                        {'DATABASE_URL': 'offline-test-only', 'DEEPSEEK_API_KEY': 'offline-fixture',
                         'HXZ_ENABLE_LIVE': '1'})
        real_readiness = hosted.readiness
        for environment in environments:
            with self.subTest(environment_names=sorted(environment)):
                checked = threading.Event()
                def check_configuration(env):
                    result = real_readiness(env)
                    checked.set()
                    return result
                with patch.object(hosted, '_supervisor_state', None), \
                     patch.object(hosted, 'readiness', side_effect=check_configuration), \
                     patch.object(hosted.subprocess, 'Popen') as spawn, patch('builtins.print'):
                    stop = start_supervisor(environment)
                    state = hosted._supervisor_state
                    try:
                        self.assertTrue(checked.wait(timeout=2), 'supervisor did not check configuration')
                        self.assertTrue(state['thread'].is_alive())
                        status = hosted.engine_status(environment)
                        self.assertEqual(status['engine'], 'standalone')
                        self.assertFalse(status['configured'])
                        self.assertTrue(status['supervisor_running'])
                        self.assertFalse(status['worker_running'])
                        self.assertNotIn('HXZ_REPORT_ENGINE=standalone', status['missing'])
                        if 'HXZ_ENABLE_LIVE' not in environment:
                            self.assertIn('HXZ_ENABLE_LIVE=1', status['missing'])
                        else:
                            self.assertIn('HXZ_SEARCH_KEY', status['missing'])
                    finally:
                        stop.set()
                        state['thread'].join(timeout=2)
                    self.assertFalse(state['thread'].is_alive())
                    spawn.assert_not_called()

    def test_one_failed_delivery_does_not_block_other_reports_and_retry_is_bounded(self):
        state=self.read(); state['REPORT_REQUESTS'].append(dict(self.request,id='rrother'));self.write(state)
        self.queue.ingest()
        for job in self.store.jobs.values():job['status']='completed'
        original=self.store.artifact
        def fail_one(tenant,rid,name):
            if rid==report_id('rrfixture'):raise OSError('offline injected storage failure')
            return original(tenant,rid,name)
        with patch.object(self.store,'artifact',side_effect=fail_one) as artifact:
            self.queue.mirror(continue_on_error=True)
            state=self.read();self.assertEqual(state['REPORT_REQUESTS'][1]['status'],'done')
            self.assertEqual(state['REPORT_REQUESTS'][0]['deliveryError'],'delivery_retry')
            calls=artifact.call_count;self.queue.mirror(continue_on_error=True)
            # Settled delivery is not re-downloaded; broken delivery is deferred.
            self.assertEqual(artifact.call_count-calls,0)

    def test_push_request_and_publication_share_transaction_and_exact_request_target(self):
        import io
        self.completed()
        handler=Mock();handler.wfile=io.BytesIO()
        factory=lambda:file_session(str(self.path),lambda:None)
        request_publication(handler,json.dumps({'city':'隔离测试区','requestId':'rrfixture'}).encode(),factory)
        self.assertTrue(json.loads(handler.wfile.getvalue())['ok'])
        self.queue.mirror()
        saved=self.path.read_bytes()
        handler.wfile=io.BytesIO()
        request_publication(handler,json.dumps({'city':'隔离测试区','requestId':'rrfixture'}).encode(),factory)
        self.assertTrue(json.loads(handler.wfile.getvalue())['pushed'])
        self.assertEqual(self.path.read_bytes(),saved)
        handler.wfile=io.BytesIO()
        request_publication(handler,json.dumps({'city':'另一测试区','requestId':'rrfixture'}).encode(),factory)
        self.assertFalse(json.loads(handler.wfile.getvalue())['ok'])
        self.assertEqual(self.path.read_bytes(),saved)

    def test_configuration_resume_preserves_completed_research_and_cannot_revive_cancelled(self):
        from report_service.full_store import FullStore
        stages=({'id':'one','filename':'one.md','parts':('first','second')},)
        store=FullStore(Path(self.temp.name)/'queue.db',stages=stages)
        r=store.create('offline','测试省','测试区','resume',False)
        lease=store.claim(synthetic=False)
        store.finish_part(lease['step_id'],lease['token'],{'text':'OFFLINE committed checkpoint','metadata':{}})
        lease=store.claim(synthetic=False);store.fail_part(lease['step_id'],lease['token'],'configuration',False)
        self.assertTrue(store.resume_configuration('offline',r['id']))
        self.assertEqual(store.get('offline',r['id'])['parts_done'],1)
        store.cancel('offline',r['id'])
        self.assertFalse(store.resume_configuration('offline',r['id']))

    def test_cancel_before_spawn_never_calls_provider(self):
        from report_service.full_store import FullStore
        from report_service.full_worker import run_once
        store=FullStore(Path(self.temp.name)/'cancel-before.db',stages=({'id':'one','filename':'one.md','parts':('first',)},))
        job=store.create('offline','测试省','测试区','cancel-before',False)
        before={p.pid for p in multiprocessing.active_children()}
        result=run_once(store,WaitingProvider(),synthetic=False,stop_job=lambda job:True)
        self.assertEqual(result['status'],'cancelled')
        self.assertEqual(store.get('offline',job['id'])['parts_done'],0)
        self.assertEqual({p.pid for p in multiprocessing.active_children()},before)

    def test_cancel_during_provider_call_reaps_child_and_keeps_report_cancelled(self):
        from report_service.full_store import FullStore
        from report_service.full_worker import run_once
        store=FullStore(Path(self.temp.name)/'cancel-during.db',stages=({'id':'one','filename':'one.md','parts':('first',)},))
        job=store.create('offline','测试省','测试区','cancel-during',False)
        before={p.pid for p in multiprocessing.active_children()};started=time.monotonic()
        run_once(store,WaitingProvider(),synthetic=False,ttl=1,timeout=3,
                 stop_job=lambda job:time.monotonic()-started>.2)
        self.assertLess(time.monotonic()-started,2)
        self.assertEqual(store.get('offline',job['id'])['status'],'cancelled')
        self.assertEqual({p.pid for p in multiprocessing.active_children()},before)


if __name__=='__main__': unittest.main()
