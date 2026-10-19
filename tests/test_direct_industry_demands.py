"""Direct institutional demand intake has no dependency on generated reports."""
import copy
import io
import json
import os
import tempfile
import threading
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from backend.access_control import guard_sync
from backend.auth import AuthError
from backend.industry_demands import CONTRACT, create_industry_demand, handle_industry_demand
from backend.sync_transaction import file_session


PRINCIPAL = {'scope': 'project', 'projectKeys': ['p'], 'projKey': 'p', 'user': 'client'}


def state():
    return {'PROJECTS': {
        'p': {'id': 'p', 'workspaceId': 'p', 'city': '闵行区', 'org': '测试机构', 'who': '负责人'},
        'q': {'id': 'q', 'workspaceId': 'q', 'city': '闵行区'}}, 'DEMANDS': []}


def request():
    return {'mode': 'direct', 'projectKey': 'p', 'requestId': 'direct:once-01',
            'demand': {'title': '生物制药滤器企业招引',
                       'description': '寻找具备量产交付能力的滤器制造企业；实际投资安排另行洽谈。',
                       'conditions': '优先具备医药客户供货记录',
                       'contactName': '测试联系人', 'contactMethod': '仅用于本地流程测试'}}


class Handler:
    def __init__(self):
        self.headers = {}
        self.status = None
        self.wfile = io.BytesIO()
    def send_response(self, status): self.status = status
    def send_header(self, *args): pass
    def end_headers(self): pass
    def cors(self): pass
    def result(self): return json.loads(self.wfile.getvalue())


class DirectIndustryDemandTests(unittest.TestCase):
    def assert_code(self, code, callback):
        with self.assertRaises(AuthError) as raised:
            callback()
        self.assertEqual(raised.exception.code, code)

    def test_submit_without_report_and_keep_user_stated_provenance(self):
        data = state()
        result = create_industry_demand(request(), data, PRINCIPAL, now=1500)
        self.assertTrue(result['created'])
        project, demand = result['project'], result['demand']
        self.assertEqual(project['demandContract'], CONTRACT)
        self.assertEqual(project['demandOrigin'], 'direct')
        self.assertEqual(project['workspaceId'], 'p')
        self.assertEqual(project['parentProjectKey'], 'p')
        self.assertEqual(project['submissionState'], 'submitted')
        self.assertEqual(project['topic'], request()['demand']['title'])
        self.assertEqual(demand['domain'], request()['demand']['title'])
        self.assertEqual(demand['resLabel'], '待受理')
        self.assertEqual(project['submittedAt'], 1500)
        self.assertEqual(project['submittedBy'], 'client')
        self.assertEqual(project['demandSpec']['source'], 'user_direct')
        self.assertEqual(project['demandSpec']['verificationStatus'], 'user_stated')
        self.assertEqual(project['demandSpec']['contactMethod'], '仅用于本地流程测试')
        self.assertEqual(project['clues'], [])
        self.assertEqual(result['reportState'], {})
        self.assertNotIn(result['projectKey'], data.get('REPORTSTATE', {}))
        for record in (project, demand):
            for field in ('selectedPriority', 'sourceProjectKey', 'sourceAnalysisTopic',
                          'sourcePriorityKey', 'sourceReportIdentity', 'sourceReportFingerprint',
                          'analysisTopic'):
                self.assertNotIn(field, record)
        result['project']['demandSpec']['description'] = 'response mutation'
        self.assertNotEqual(data['PROJECTS'][result['projectKey']]['demandSpec']['description'],
                            'response mutation')

    def test_same_request_id_retries_once_without_overwriting_server_state(self):
        data = state(); body = request()
        first = create_industry_demand(body, data, PRINCIPAL, now=1000)
        data['PROJECTS'][first['projectKey']]['intake'] = {'status': 'processing', 'version': 1}
        repeated = create_industry_demand(copy.deepcopy(body), data, PRINCIPAL, now=2000)
        self.assertFalse(repeated['created'])
        self.assertEqual(first['projectKey'], repeated['projectKey'])
        self.assertEqual(repeated['project']['submittedAt'], 1000)
        self.assertEqual(repeated['project']['intake']['status'], 'processing')
        self.assertEqual(len(data['DEMANDS']), 1)

    def test_changed_content_same_request_id_is_conflict(self):
        for field in ('title', 'description', 'conditions', 'contactName', 'contactMethod'):
            data = state(); body = request()
            original = create_industry_demand(body, data, PRINCIPAL)
            body['demand'][field] += '已修改'
            self.assert_code('request_conflict', lambda: create_industry_demand(body, data, PRINCIPAL))
            self.assertEqual(len(data['DEMANDS']), 1)
            self.assertEqual(data['PROJECTS'][original['projectKey']], original['project'])

    def test_new_request_id_can_submit_another_explicit_need(self):
        data = state(); body = request()
        first = create_industry_demand(body, data, PRINCIPAL)
        body['requestId'] = 'direct:second'
        body['demand']['title'] = '色谱填料企业招引'
        second = create_industry_demand(body, data, PRINCIPAL)
        self.assertNotEqual(first['projectKey'], second['projectKey'])
        self.assertEqual(len(data['DEMANDS']), 2)

    def test_optional_contacts_and_conditions_are_empty_strings(self):
        data = state(); body = request()
        for field in ('contactName', 'contactMethod', 'conditions'):
            body['demand'].pop(field)
        result = create_industry_demand(body, data, PRINCIPAL)
        for field in ('contactName', 'contactMethod', 'conditions'):
            self.assertEqual(result['project']['demandSpec'][field], '')

    def test_input_limits_and_control_characters_are_rejected(self):
        invalid = [('title', ''), ('title', 'x' * 121), ('description', ' '),
                   ('description', 'x' * 6001), ('conditions', 'x' * 2001),
                   ('contactName', 'x' * 81), ('contactMethod', 'x' * 241),
                   ('contactMethod', None), ('title', 'a\x00b'), ('description', 'a\x7fb')]
        for field, value in invalid:
            data = state(); body = request(); body['demand'][field] = value
            self.assert_code('invalid_demand', lambda: create_industry_demand(body, data, PRINCIPAL))
            self.assertEqual(data['DEMANDS'], [])

    def test_request_id_required_and_bounded(self):
        for value in (None, '', 'bad request', 'x' * 129, 42, 'a\nb'):
            data = state(); body = request(); body['requestId'] = value
            self.assert_code('invalid_request_id', lambda: create_industry_demand(body, data, PRINCIPAL))

    def test_cannot_supply_generated_provenance_or_extra_fields(self):
        for field, value in (('selectedPriority', {'focus': '伪造'}), ('sourceIdentity', '{}'),
                             ('topic', '外部报告'), ('stage', 7), ('report', '伪造报告')):
            data = state(); body = request(); body[field] = value
            self.assert_code('invalid_demand', lambda: create_industry_demand(body, data, PRINCIPAL))
        data = state(); body = request(); body['demand']['verificationStatus'] = 'verified'
        self.assert_code('invalid_demand', lambda: create_industry_demand(body, data, PRINCIPAL))
        body = request(); body['mode'] = 'fake'
        self.assert_code('invalid_demand_mode', lambda: create_industry_demand(body, data, PRINCIPAL))

    def test_other_workspace_and_child_cannot_receive_direct_submission(self):
        data = state(); body = request(); body['projectKey'] = 'q'
        self.assert_code('workspace_forbidden', lambda: create_industry_demand(body, data, PRINCIPAL))
        data = state(); result = create_industry_demand(request(), data, PRINCIPAL)
        body = request(); body['projectKey'] = result['projectKey']
        self.assert_code('parent_workspace_required', lambda: create_industry_demand(body, data, PRINCIPAL))
        data['PROJECTS']['legacy-child'] = {'parentProjectKey': 'p', 'city': '闵行区'}
        body['projectKey'] = 'legacy-child'
        self.assert_code('parent_workspace_required', lambda: create_industry_demand(body, data, PRINCIPAL))

    def test_deleted_root_cannot_receive_direct_submission(self):
        data = state(); data['DELETED_PROJECTS'] = ['p']
        self.assert_code('parent_workspace_required',
                         lambda: create_industry_demand(request(), data, PRINCIPAL))

    def test_same_id_in_another_authorized_workspace_is_independent(self):
        data = state(); body = request()
        principal = dict(PRINCIPAL, projectKeys=['p', 'q'])
        first = create_industry_demand(body, data, principal)
        body['projectKey'] = 'q'
        second = create_industry_demand(body, data, principal)
        self.assertNotEqual(first['projectKey'], second['projectKey'])
        self.assertEqual(second['project']['workspaceId'], 'q')

    def test_sync_cannot_rewrite_identity_or_add_fabricated_report_fields(self):
        data = state(); result = create_industry_demand(request(), data, PRINCIPAL)
        key = result['projectKey']
        project = dict(result['project'], demandOrigin='report', directRequestId='replaced',
                       directRequestFingerprint='replaced', submissionState='draft',
                       parentProjectKey='q', demandSpec={'source': 'verified'}, report='fake',
                       selectedPriority={'focus': 'fake'}, sourceProjectKey='p',
                       sourceAnalysisTopic='fake', sourcePriorityKey='fake',
                       sourceReportIdentity='fake', sourceReportFingerprint='fake',
                       analysisTopic='fake', reportRequestId='fake', sourceReportId='fake')
        demand = dict(result['demand'], demandOrigin='report', directRequestId='replaced',
                      directRequestFingerprint='replaced', selectedPriority={'focus': 'fake'},
                      analysisTopic='fake', sourceProjectKey='p', sourcePriorityKey='fake',
                      sourceAnalysisTopic='fake', sourceReportIdentity='fake',
                      sourceReportFingerprint='fake', reportRequestId='fake', sourceReportId='fake')
        incoming = {'PROJECTS': {key: project}, 'DEMANDS': [demand],
                    'REPORTSTATE': {key: {'text': 'fabricated report'}}}
        for principal in (PRINCIPAL, {'scope': 'admin', 'user': 'admin'}):
            guarded = json.loads(guard_sync(json.dumps(incoming).encode(), data, principal))
            saved_project = guarded['PROJECTS'][key]
            for field in ('demandOrigin', 'directRequestId', 'directRequestFingerprint',
                          'submissionState', 'parentProjectKey', 'demandSpec', 'report'):
                self.assertEqual(saved_project[field], result['project'][field])
            for field in ('selectedPriority', 'sourceProjectKey', 'sourceAnalysisTopic',
                          'sourcePriorityKey', 'sourceReportIdentity', 'sourceReportFingerprint',
                          'analysisTopic', 'reportRequestId', 'sourceReportId'):
                self.assertNotIn(field, saved_project)
            self.assertEqual(guarded['REPORTSTATE'][key], {})
            for field in ('demandOrigin', 'directRequestId', 'directRequestFingerprint'):
                self.assertEqual(guarded['DEMANDS'][0][field], result['demand'][field])
            for field in ('selectedPriority', 'analysisTopic', 'sourceProjectKey', 'sourcePriorityKey',
                          'sourceAnalysisTopic', 'sourceReportIdentity', 'sourceReportFingerprint',
                          'reportRequestId', 'sourceReportId'):
                self.assertNotIn(field, guarded['DEMANDS'][0])

    def test_sync_cannot_forge_direct_contract_or_duplicate_receipt(self):
        data = state(); body = {'PROJECTS': {'forged': dict(
            workspaceId='p', isDemand=True, demandOrigin='direct', demandContract=CONTRACT)}}
        self.assert_code('server_owned_demand', lambda: guard_sync(json.dumps(body).encode(), data, PRINCIPAL))
        result = create_industry_demand(request(), data, PRINCIPAL)
        row = dict(result['demand'], id='forged-receipt')
        self.assert_code('server_owned_demand', lambda: guard_sync(
            json.dumps({'DEMANDS': [row]}).encode(), data, PRINCIPAL))

    def test_concurrent_retries_commit_one_direct_demand(self):
        data = state(); body = request()
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'state.json')
            with open(path, 'w') as stream: json.dump(data, stream)
            handlers = [Handler() for _ in range(5)]
            def run(handler):
                handle_industry_demand(handler, json.dumps(body).encode(),
                                       lambda: file_session(path, lambda: None))
            with patch('backend.industry_demands.require_session', return_value=PRINCIPAL):
                threads = [threading.Thread(target=run, args=(handler,)) for handler in handlers]
                for thread in threads: thread.start()
                for thread in threads: thread.join()
            self.assertEqual([h.status for h in handlers], [200] * 5)
            self.assertEqual(sum(h.result()['created'] for h in handlers), 1)
            self.assertEqual(len({h.result()['projectKey'] for h in handlers}), 1)
            with open(path) as stream: saved = json.load(stream)
            self.assertEqual(len(saved['DEMANDS']), 1)
            self.assertNotIn('REPORTSTATE', saved)

    def test_write_failure_does_not_acknowledge_a_saved_request(self):
        data = state(); handler = Handler()
        @contextmanager
        def factory():
            class Session:
                def read(self): return json.dumps(data)
                def write(self, value): return False
            yield Session()
        with patch('backend.industry_demands.require_session', return_value=PRINCIPAL):
            handle_industry_demand(handler, json.dumps(request()).encode(), factory)
        self.assertEqual(handler.status, 503)
        self.assertFalse(handler.result()['ok'])
        self.assertEqual(data['DEMANDS'], [])


if __name__ == '__main__':
    unittest.main()
