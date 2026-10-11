"""Real HTTP + real isolated file transactions; only upstream is mocked."""
import concurrent.futures
import copy
import json
import threading
import unittest
from unittest.mock import patch

from backend.auth import AuthError
from backend.evidence_grounding import evidence_catalog
from backend.sync_transaction import file_session
import test_interactive_evidence_boundary as boundary


class BlockedResponse(boundary.FakeResponse):
    def __init__(self, body, started, release):
        super().__init__(body)
        self.started, self.release = started, release

    def read(self, *args):
        self.started.set()
        if not self.release.wait(3):
            raise RuntimeError('offline test synchronization timeout')
        return super().read(*args)


class ProfileConflictFeedbackTests(unittest.TestCase):
    setUp = boundary.StreamBoundaryTests.setUp

    def _request_during_change(self, change):
        saved = self.h.state()
        old = {'summary':'previous completed profile','__ts':1}
        saved['PROJECTS']['a']['profile'] = old
        self.h.replace(saved)
        ref = next(x for x in evidence_catalog(boundary.context()['chunks']) if '排名' in x['quote'])
        model = {'objective':{'economy':[{'evidence_ids':[ref['id']]}]}}
        data = json.dumps({'choices':[{'message':{'content':json.dumps(model)},'finish_reason':'stop'}]}).encode()
        started, release = threading.Event(), threading.Event()
        self.h.ns['DS_OPENER'].open.return_value = BlockedResponse(data, started, release)
        body = {'question':'offline profile conflict regression','mode':'city_profile','projectKey':'a','topic':'液体火箭','reportRequestId':'r1','stream':True}
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(self.h.request, 'POST', '/api/kb-chat', body, cookie=self.cookie)
            self.assertTrue(started.wait(2))
            try:
                with file_session(str(self.h.path), lambda: None) as transaction:
                    current = json.loads(transaction.read())
                    change(current)
                    self.assertTrue(transaction.write(json.dumps(current)))
            finally:
                release.set()
            status, _, raw = future.result(timeout=4)
        return status, raw.decode(), old

    def test_changed_material_returns_specific_conflict_and_preserves_profile(self):
        def change(state):
            state['PROJECTS']['a']['kb'][0]['known'].append({'text':'新增官方材料记录：当前经济产业信息更新。来源 https://official.example/new'})
        status, raw, old = self._request_during_change(change)
        self.assertEqual(status,409)
        data=json.loads(raw)
        self.assertEqual(data['code'],'evidence_changed')
        self.assertEqual(data['error'],'evidence_changed')
        self.assertIn('旧结果已保留',data['message'])
        self.assertIn('重新生成',data['message'])
        self.assertEqual(self.h.state()['PROJECTS']['a']['profile'],old)
        self.assertEqual(self.audits[-1]['outcome'],'conflict')
        self.assertEqual(self.audits[-1]['error_code'],'evidence_changed')
        self.assertEqual(self.h.ns['DS_OPENER'].open.call_count,1)

    def test_changed_report_version_returns_report_changed_without_overwrite(self):
        status, raw, old = self._request_during_change(lambda state: state['PROJECTS']['a'].update(reportRequestId='r2'))
        self.assertEqual(status,409)
        self.assertEqual(json.loads(raw)['code'],'report_changed')
        self.assertEqual(self.audits[-1]['outcome'],'conflict')
        self.assertEqual(self.h.state()['PROJECTS']['a']['profile'],old)

    def test_changed_topic_returns_topic_mismatch_without_overwrite(self):
        def change(state):
            state['PROJECTS']['a']['topic']='另一个方向'
            state['REPORTSTATE']['a']={'topic':'另一个方向'}
        status, raw, old = self._request_during_change(change)
        self.assertEqual(status,409)
        self.assertEqual(json.loads(raw)['code'],'topic_mismatch')
        self.assertIn('旧结果已保留',json.loads(raw)['message'])
        self.assertEqual(self.h.state()['PROJECTS']['a']['profile'],old)

    def test_unchanged_polling_snapshot_still_saves_successful_profile(self):
        status, raw, _ = self._request_during_change(lambda state: None)
        self.assertEqual(status,200)
        self.assertIn('saved-excerpts-v1',raw)
        self.assertEqual(self.audits[-1]['outcome'],'completed')
        self.assertEqual(self.h.state()['PROJECTS']['a']['profile']['evidence_contract'],'saved-excerpts-v1')

    def test_unknown_auth_and_provider_errors_never_leak_raw_messages(self):
        model={'choices':[{'message':{'content':'{}'},'finish_reason':'stop'}]}
        self.h.ns['DS_OPENER'].open.return_value=boundary.FakeResponse(json.dumps(model).encode())
        body={'question':'offline error contract','mode':'city_profile','projectKey':'a','topic':'液体火箭','reportRequestId':'r1'}
        with patch('backend.evidence_grounding.ground_profile',side_effect=AuthError(409,'unknown_internal','SECRET_INTERNAL_MESSAGE')):
            status,_,raw=self.h.request('POST','/api/kb-chat',body,cookie=self.cookie)
        self.assertEqual(status,409)
        self.assertNotIn('SECRET',raw.decode())
        self.assertEqual(json.loads(raw)['code'],'incomplete')
        self.assertEqual(self.audits[-1]['outcome'],'failed')
        self.h.ns['DS_OPENER'].open.side_effect=RuntimeError('SECRET_PROVIDER_PAYLOAD')
        status,_,raw=self.h.request('POST','/api/kb-chat',body,cookie=self.cookie)
        self.assertEqual(status,502)
        self.assertNotIn('SECRET',raw.decode())
        self.assertEqual(self.audits[-1]['error_code'],'')


if __name__=='__main__': unittest.main()
