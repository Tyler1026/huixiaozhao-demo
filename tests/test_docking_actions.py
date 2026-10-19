import base64
import copy
import io
import json
import os
import tempfile
import threading
import unittest
import zipfile
from contextlib import contextmanager
from unittest.mock import patch

from backend.access_control import guard_sync
from backend.auth import AuthError
from backend.docking_actions import (CONTRACT, MAX_FILE_BYTES, apply_docking_action,
                                     handle_docking_action)
from backend.industry_demands import create_industry_demand
from backend.sync_transaction import file_session
from backend.sync_merge import _merge_map
from tests.test_industry_demands import PRINCIPAL, Handler, request, state


def fixture():
    data = state()
    results = [create_industry_demand(request(data, index), data, PRINCIPAL) for index in (0, 1)]
    for result in results:
        data['PROJECTS'][result['projectKey']]['clues'] = [
            {'id': 'same-clue', 'name': '真实企业', 'tone': 'amber', 'status': 'ops_rec',
             'investment_intent': 'unknown', 'questions': []}]
    return data, [result['projectKey'] for result in results]


def action(key, request_id='operation-1', kind='request_verification', **fields):
    result = {'projectKey': key, 'action': kind, 'requestId': request_id}
    if kind == 'request_verification':
        result['clueId'] = 'same-clue'
    result.update(fields)
    return result


def attached(name='note.txt', content=b'Verified text attachment.', mime='text/plain'):
    return {'name': name, 'size': len(content), 'dataUrl': 'data:' + mime + ';base64,' + base64.b64encode(content).decode()}


class DockingActionTests(unittest.TestCase):
    def assert_code(self, code, callback):
        with self.assertRaises(AuthError) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)

    def test_request_is_saved_event_not_green_approval_or_stage_advance(self):
        data, (key, _) = fixture()
        before = copy.deepcopy(data['PROJECTS'][key])
        result = apply_docking_action(action(key), data, PRINCIPAL, now=1000)
        self.assertTrue(result['created'])
        project = data['PROJECTS'][key]
        self.assertEqual(project['stage'], before['stage'])
        clue = project['clues'][0]
        self.assertEqual(clue['tone'], 'amber')
        self.assertEqual(clue['status'], 'ops_rec')
        self.assertEqual(clue['investment_intent'], 'unknown')
        request_saved = clue['verificationRequest']
        self.assertEqual(request_saved['contract'], CONTRACT)
        self.assertEqual(request_saved['status'], 'requested')
        self.assertEqual(request_saved['requestedBy'], 'tester')
        self.assertEqual(request_saved['requestedAt'], 1000)
        event = result['logs'][0]
        self.assertEqual(event['kind'], 'verification_request')
        self.assertEqual(event['actor'], 'tester')
        self.assertEqual(event['actorRole'], 'project')
        self.assertEqual(event['clueId'], 'same-clue')
        self.assertEqual(event['id'], request_saved['id'])
        result['logs'][0]['note'] = 'client edit'
        self.assertNotEqual(data['DOCK_LOGS'][key][0]['note'], 'client edit')

    def test_idempotent_retries_do_not_add_events_or_change_time(self):
        data, (key, _) = fixture()
        first = apply_docking_action(action(key), data, PRINCIPAL, now=1000)
        second = apply_docking_action(action(key), data, PRINCIPAL, now=2000)
        self.assertFalse(second['created'])
        self.assertEqual(second['logs'], first['logs'])
        self.assertEqual(len(data['DOCK_LOGS'][key]), 1)
        self.assert_code('request_conflict', lambda: apply_docking_action(
            action(key, kind='save_log', record={'type': 'note', 'note': 'different'}), data, PRINCIPAL))
        self.assert_code('verification_already_requested', lambda: apply_docking_action(
            action(key, 'operation-2'), data, PRINCIPAL))
        self.assertEqual(len(data['DOCK_LOGS'][key]), 1)

    def test_identical_clue_id_and_report_never_leak_between_suggestions(self):
        data, (first, second) = fixture()
        apply_docking_action(action(first), data, PRINCIPAL)
        self.assertNotIn('verificationRequest', data['PROJECTS'][second]['clues'][0])
        self.assertNotIn(second, data['DOCK_LOGS'])
        apply_docking_action(action(second), data, PRINCIPAL)
        self.assertNotEqual(data['DOCK_LOGS'][first][0]['id'], data['DOCK_LOGS'][second][0]['id'])

    def test_cross_workspace_and_parent_are_rejected_without_mutation(self):
        data, (key, _) = fixture()
        for target, code in (('q', 'workspace_forbidden'), ('p', 'submitted_demand_required')):
            before = copy.deepcopy(data)
            self.assert_code(code, lambda: apply_docking_action(action(target), data, PRINCIPAL))
            self.assertEqual(data, before)
        foreign = {'scope': 'project', 'projectKeys': ['q'], 'projKey': 'q', 'user': 'elsewhere'}
        self.assert_code('workspace_forbidden', lambda: apply_docking_action(action(key), data, foreign))

    def test_unsubmitted_deleted_or_non_demand_projects_are_rejected(self):
        for change in (lambda p, s, k: p.update(isDemand=False),
                       lambda p, s, k: p.update(submissionState='draft'),
                       lambda p, s, k: p.update(submissionState='cancelled'),
                       lambda p, s, k: (p.pop('submissionState'), p.update(stage=2)),
                       lambda p, s, k: s.update(DELETED_PROJECTS=[k])):
            data, (key, _) = fixture()
            change(data['PROJECTS'][key], data, key)
            before = copy.deepcopy(data)
            self.assert_code('submitted_demand_required', lambda: apply_docking_action(action(key), data, PRINCIPAL))
            self.assertEqual(data, before)

    def test_unknown_deleted_ambiguous_clue_and_no_cross_project_lookup(self):
        for change in (lambda p, s, k: p.update(clues=[]),
                       lambda p, s, k: p['clues'].append(copy.deepcopy(p['clues'][0])),
                       lambda p, s, k: s.update(DELETED_CLUES=[k + '::same-clue']),
                       lambda p, s, k: s.update(DELETED_CLUES=[k + '::@真实企业'])):
            data, (key, _) = fixture()
            change(data['PROJECTS'][key], data, key)
            before = copy.deepcopy(data)
            self.assert_code('clue_not_found', lambda: apply_docking_action(action(key), data, PRINCIPAL))
            self.assertEqual(data, before)

    def test_note_and_attachment_log_preserve_actual_clue_and_demand_state(self):
        data, (key, _) = fixture()
        original = copy.deepcopy(data['PROJECTS'][key])
        receipt = copy.deepcopy(data['DEMANDS'])
        result = apply_docking_action(action(key, kind='save_log', clueId='same-clue',
            record={'type': 'call', 'note': ' 已电话联系，尚待对方答复。 ', 'files': [attached()]}), data, PRINCIPAL, now=3000)
        event = result['logs'][0]
        self.assertEqual(event['kind'], 'contact_log')
        self.assertEqual(event['type'], 'call')
        self.assertEqual(event['note'], '已电话联系，尚待对方答复。')
        self.assertEqual(event['files'][0], attached())
        self.assertEqual(event['clueId'], 'same-clue')
        self.assertEqual(data['PROJECTS'][key], original)
        self.assertEqual(data['DEMANDS'], receipt)

    def test_log_can_be_project_level_or_attachment_only(self):
        data, (key, _) = fixture()
        result = apply_docking_action(action(key, kind='save_log', record={'type': 'material', 'note': '', 'files': [attached()]}), data, PRINCIPAL)
        self.assertNotIn('clueId', result['logs'][0])
        self.assertEqual(result['logs'][0]['note'], '')

    def test_invalid_payloads_do_not_mutate_any_state(self):
        invalid = [({'action': 'approve'}, 'invalid_action'), ({'action': []}, 'invalid_action'),
                   ({'requestId': ''}, 'invalid_request_id'), ({'requestId': '../x'}, 'invalid_request_id'),
                   ({'clueId': None}, 'invalid_clue'), ({'tone': 'teal'}, 'invalid_action')]
        for fields, code in invalid:
            data, (key, _) = fixture(); before = copy.deepcopy(data)
            self.assert_code(code, lambda: apply_docking_action(dict(action(key), **fields), data, PRINCIPAL))
            self.assertEqual(data, before)
        for record in ({}, {'type': []}, {'type': 'call', 'note': ''},
                       {'type': 'note', 'note': '\x00'}, {'type': 'note', 'note': 'x' * 10001},
                       {'type': 'note', 'note': 'text', 'stage': 5}):
            data, (key, _) = fixture(); before = copy.deepcopy(data)
            self.assert_code('invalid_record', lambda: apply_docking_action(
                action(key, kind='save_log', record=record), data, PRINCIPAL))
            self.assertEqual(data, before)

    def test_attachments_reject_name_mime_script_signature_and_size_lies(self):
        bad = [attached('../note.txt'), attached('a.svg', b'<svg/>', 'image/svg+xml'),
               attached('a.html', b'<script>alert(1)</script>', 'text/html'),
               attached('a.txt', b'<script>alert(1)</script>'),
               attached('a.png', b'<svg/>', 'image/png'), attached('a.pdf', b'not a PDF', 'application/pdf'),
               attached('a.txt', b'hi', 'application/pdf'), dict(attached(), size=100),
               dict(attached(), size=True), dict(attached(), dataUrl='data:text/plain;base64,???'),
               attached('a.txt', b'\xff'), attached('a.docx', b'PK\x03\x04bad zip',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document')]
        for item in bad:
            data, (key, _) = fixture(); before = copy.deepcopy(data)
            self.assert_code('invalid_attachments', lambda: apply_docking_action(
                action(key, kind='save_log', record={'type': 'material', 'files': [item]}), data, PRINCIPAL))
            self.assertEqual(data, before)

    def test_attachment_count_per_file_and_total_limit(self):
        for files in ([attached()] * 6, [attached(content=b'a' * (MAX_FILE_BYTES + 1))],
                      [attached(content=b'a' * MAX_FILE_BYTES)] * 3):
            data, (key, _) = fixture()
            self.assert_code('invalid_attachments', lambda: apply_docking_action(
                action(key, kind='save_log', record={'type': 'material', 'files': files}), data, PRINCIPAL))
            self.assertNotIn('DOCK_LOGS', data)

    def test_supported_office_attachment_is_checked_before_saved(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as archive:
            archive.writestr('[Content_Types].xml', '<Types/>')
            archive.writestr('word/document.xml', '<document/>')
        data, (key, _) = fixture()
        document = attached('record.docx', buf.getvalue(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        result = apply_docking_action(action(key, kind='save_log', record={'type': 'material', 'files': [document]}), data, PRINCIPAL)
        self.assertEqual(result['logs'][0]['files'][0], document)

    def test_sync_preserves_receipts_even_when_omitted_changed_or_contract_removed(self):
        data, (key, _) = fixture()
        result = apply_docking_action(action(key), data, PRINCIPAL)
        saved_event = result['logs'][0]
        for rows in ([], [dict(saved_event, note='forged', contract='old')]):
            for principal in (PRINCIPAL, {'scope': 'admin', 'user': 'admin'}):
                updated = copy.deepcopy(result['project'])
                updated['clues'][0].pop('verificationRequest')
                incoming = {'PROJECTS': {key: updated}, 'DOCK_LOGS': {key: rows}}
                guarded = json.loads(guard_sync(json.dumps(incoming).encode(), data, principal))
                self.assertEqual(guarded['DOCK_LOGS'][key], [saved_event])
                self.assertEqual(guarded['PROJECTS'][key]['clues'][0]['verificationRequest'],
                                 result['project']['clues'][0]['verificationRequest'])

    def test_admin_omitting_project_from_log_snapshot_cannot_remove_receipts(self):
        data, (key, other) = fixture()
        result = apply_docking_action(action(key), data, PRINCIPAL)
        guarded = json.loads(guard_sync(json.dumps({'DOCK_LOGS': {other: []}}).encode(), data,
                                        {'scope': 'admin', 'user': 'admin'}))
        self.assertEqual(guarded['DOCK_LOGS'][key], result['logs'])
        self.assert_code('server_owned_docking', lambda: guard_sync(
            json.dumps({'DOCK_LOGS': []}).encode(), data, {'scope': 'admin', 'user': 'admin'}))

    def test_legacy_child_uses_authorized_canonical_parent_without_claiming_verification(self):
        data, (key, _) = fixture()
        project = data['PROJECTS'][key]
        project.pop('workspaceId')
        project.pop('demandContract')
        project.pop('submissionState')
        data['DEMANDS'][0].pop('demandContract')
        result = apply_docking_action(action(key), data, PRINCIPAL)
        self.assertTrue(result['created'])
        self.assertEqual(result['project']['workspaceId'], 'p')
        self.assertEqual(result['project']['clues'][0]['tone'], 'amber')

    def test_sync_rejects_forged_receipts_and_verification_requests(self):
        data, (key, other) = fixture()
        result = apply_docking_action(action(key), data, PRINCIPAL)
        payloads = [{'DOCK_LOGS': {other: result['logs']}},
                    {'DOCK_LOGS': {key: [dict(result['logs'][0], id='forged')]}},
                    {'PROJECTS': {other: dict(data['PROJECTS'][other], clues=[dict(
                        data['PROJECTS'][other]['clues'][0], verificationRequest=result['project']['clues'][0]['verificationRequest'])])}}]
        for incoming in payloads:
            self.assert_code('server_owned_docking', lambda: guard_sync(json.dumps(incoming).encode(), data, PRINCIPAL))

    def test_sync_rejects_fresh_green_approval_but_keeps_existing_legacy_green(self):
        data, (key, _) = fixture()
        for claims in ({'tone': 'teal'}, {'status': '核验通过'}, {'verificationStatus': 'verified'}, {'contactVerified': True}, {'investment_intent': 'confirmed'}, {'hasMoveSignal': True}):
            changed = copy.deepcopy(data['PROJECTS'][key])
            changed['clues'][0].update(claims)
            self.assert_code('verification_required', lambda: guard_sync(
                json.dumps({'PROJECTS': {key: changed}}).encode(), data, PRINCIPAL))
        data['PROJECTS'][key]['clues'][0].update(tone='teal', status='历史核验通过')
        incoming = {'PROJECTS': {key: copy.deepcopy(data['PROJECTS'][key])},
                    'DOCK_LOGS': {key: [{'ts': 1, 'type': 'call', 'note': '历史人工记录'}]}}
        guarded = json.loads(guard_sync(json.dumps(incoming).encode(), data, PRINCIPAL))
        self.assertEqual(guarded['PROJECTS'][key]['clues'][0]['tone'], 'teal')
        self.assertEqual(guarded['DOCK_LOGS'][key][0]['note'], '历史人工记录')

    def test_client_sync_cannot_advance_or_relabel_demand_progress(self):
        data, (key, _) = fixture()
        saved = copy.deepcopy(data['PROJECTS'][key])
        project = dict(saved, stage=6, stageByTopic={'生物医药': 6}, stageLog=[{'note': 'fake progress'}])
        receipt = dict(data['DEMANDS'][0], res='matched', resLabel='已核验', stage=6, clues=99)
        payload = {'PROJECTS': {key: project}, 'DEMANDS': [receipt]}
        guarded = json.loads(guard_sync(json.dumps(payload).encode(), data, PRINCIPAL))
        self.assertEqual(guarded['PROJECTS'][key]['stage'], saved['stage'])
        self.assertEqual(guarded['PROJECTS'][key].get('stageByTopic'), saved.get('stageByTopic'))
        self.assertEqual(guarded['PROJECTS'][key]['stageLog'], saved['stageLog'])
        for field in ('res', 'resLabel', 'stage', 'clues'):
            self.assertEqual(guarded['DEMANDS'][0].get(field), data['DEMANDS'][0].get(field))
        admin = json.loads(guard_sync(json.dumps(payload).encode(), data, {'scope': 'admin', 'user': 'admin'}))
        self.assertEqual(admin['PROJECTS'][key]['stage'], saved['stage'])
        self.assertEqual(admin['DEMANDS'][0]['res'], 'matched')

    def test_member_snapshot_with_other_workspaces_receipts_remains_authorized(self):
        data, (key, _) = fixture()
        foreign_key = 'foreign-demand'
        data['PROJECTS'][foreign_key] = dict(copy.deepcopy(data['PROJECTS'][key]), id=foreign_key,
                                             workspaceId='q', parentProjectKey='q', sourceProjectKey='q')
        foreign = {'scope': 'project', 'projectKeys': ['q'], 'projKey': 'q', 'user': 'foreign-user'}
        apply_docking_action(action(foreign_key), data, foreign)
        own = apply_docking_action(action(key), data, PRINCIPAL)
        guarded = json.loads(guard_sync(json.dumps({'DOCK_LOGS': {key: []}}).encode(), data, PRINCIPAL))
        self.assertEqual(guarded['DOCK_LOGS'][key], own['logs'])
        self.assertEqual(guarded['DOCK_LOGS'][foreign_key], data['DOCK_LOGS'][foreign_key])

    def test_concurrent_duplicate_requests_commit_exactly_once(self):
        data, (key, _) = fixture()
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'state.json')
            with open(path, 'w') as stream: json.dump(data, stream)
            handlers = [Handler() for _ in range(6)]
            def run(handler):
                handle_docking_action(handler, json.dumps(action(key)).encode(), lambda: file_session(path, lambda: None))
            with patch('backend.docking_actions.require_session', return_value=PRINCIPAL):
                threads = [threading.Thread(target=run, args=(handler,)) for handler in handlers]
                for thread in threads: thread.start()
                for thread in threads: thread.join()
            self.assertEqual([h.status for h in handlers], [200] * 6)
            self.assertEqual(sum(h.result()['created'] for h in handlers), 1)
            with open(path) as stream: saved = json.load(stream)
            self.assertEqual(len(saved['DOCK_LOGS'][key]), 1)

    def test_auth_is_checked_inside_transaction_and_failure_never_writes(self):
        data, (key, _) = fixture(); handler = Handler(); entered = []; writes = []
        @contextmanager
        def factory():
            entered.append(True)
            class Session:
                def read(self): return json.dumps(data)
                def write(self, value): writes.append(value); return True
            yield Session()
        def auth(*args, **kwargs):
            self.assertTrue(entered)
            raise AuthError(401, 'login_required', '请登录')
        with patch('backend.docking_actions.require_session', side_effect=auth):
            handle_docking_action(handler, json.dumps(action(key)).encode(), factory)
        self.assertEqual(handler.status, 401)
        self.assertEqual(writes, [])

    def test_write_failure_never_returns_success(self):
        data, (key, _) = fixture(); handler = Handler()
        @contextmanager
        def factory():
            class Session:
                def read(self): return json.dumps(data)
                def write(self, value): return False
            yield Session()
        with patch('backend.docking_actions.require_session', return_value=PRINCIPAL):
            handle_docking_action(handler, json.dumps(action(key)).encode(), factory)
        self.assertEqual(handler.status, 503)
        self.assertEqual(handler.result()['error'], 'storage_unavailable')
        self.assertNotIn('DOCK_LOGS', data)

    def test_malformed_json_does_not_open_transaction(self):
        handler = Handler()
        handle_docking_action(handler, b'{"action": NaN}', lambda: self.fail('must not open'))
        self.assertEqual(handler.status, 400)


ADMIN = {'scope': 'admin', 'user': 'ops-reviewer'}


def workflow(key, kind='review_demand', request_id='workflow-1', version=0, **record):
    return action(key, kind=kind, request_id=request_id, expectedVersion=version, record=record)


class DockingReceivingTests(unittest.TestCase):
    assert_code = DockingActionTests.assert_code

    def test_demand_receiving_reply_and_customer_supplement_roundtrip(self):
        data, (key, _) = fixture()
        body = workflow(key, status='processing', owner='招商一组 / 王经理',
                        nextStep='核对厂房面积和目标企业技术条件', note='已接单，将梳理候选企业。')
        receipt = apply_docking_action(body, data, ADMIN, now=10)
        intake = receipt['project']['intake']
        self.assertEqual(intake, {'contract': CONTRACT, 'version': 1, 'status': 'processing',
            'owner': '招商一组 / 王经理', 'nextStep': '核对厂房面积和目标企业技术条件',
            'reply': '已接单，将梳理候选企业。', 'updatedAt': 10, 'updatedBy': 'ops-reviewer',
            'repliedAt': 10, 'repliedBy': 'ops-reviewer'})
        self.assertEqual(receipt['logs'][0]['kind'], 'review_demand')
        self.assertFalse(apply_docking_action(body, data, ADMIN, now=11)['created'])
        need_info = workflow(key, request_id='workflow-2', version=1, status='needs_info',
                             owner='招商一组 / 王经理', nextStep='等待客户补充', note='请补充厂房净高。')
        apply_docking_action(need_info, data, ADMIN, now=12)
        supplied = workflow(key, 'supplement_demand', 'supplement-1', 2,
                            note='厂房净高 8 米。', files=[attached()])
        result = apply_docking_action(supplied, data, PRINCIPAL, now=13)
        self.assertEqual(result['project']['intake']['status'], 'submitted')
        self.assertEqual(result['project']['intake']['version'], 3)
        self.assertEqual(result['project']['intake']['reply'], '请补充厂房净高。')
        self.assertEqual(result['project']['intake']['repliedAt'], 12)
        self.assertEqual(result['project']['intake']['repliedBy'], 'ops-reviewer')
        self.assertEqual(result['project']['intake']['updatedBy'], 'tester')
        self.assertEqual(result['project']['intake']['owner'], '招商一组 / 王经理')
        self.assertEqual(result['project']['intake']['nextStep'], '待管理端复核补充资料')
        self.assertEqual(result['logs'][0]['files'], [attached()])
        self.assertEqual(result['logs'][0]['kind'], 'supplement_demand')
        response = workflow(key, request_id='workflow-3', version=3, status='feedback',
                            owner='招商一组 / 王经理', nextStep='征求客户对候选方向意见', note='已收到补充资料，初筛意见已返回。')
        final = apply_docking_action(response, data, ADMIN, now=14)
        self.assertEqual(final['project']['intake']['status'], 'feedback')
        self.assertEqual(len(final['logs']), 4)
        self.assertEqual(final['project']['stage'], 4)

    def test_supplement_before_receiving_is_attachment_only_and_not_certification(self):
        data, (key, _) = fixture()
        original = copy.deepcopy(data['PROJECTS'][key]['clues'])
        body = workflow(key, 'supplement_demand', files=[attached()])
        result = apply_docking_action(body, data, PRINCIPAL)
        self.assertEqual(result['project']['intake']['status'], 'submitted')
        self.assertEqual(result['project']['intake']['version'], 1)
        self.assertEqual(result['project']['clues'], original)
        self.assertEqual(result['logs'][0]['note'], '')

    def test_admin_scope_not_payload_or_role_grants_management_authority(self):
        for kind, values in (
            ('review_demand', {'status': 'processing', 'owner': 'ops', 'nextStep': 'review', 'note': 'accepted'}),
            ('review_verification', {'status': 'processing', 'note': 'reviewing'}),
            ('advance_stage', {'target': 5, 'note': 'scheduled by operator'}),
        ):
            data, (key, _) = fixture()
            body = workflow(key, kind, **values)
            if kind == 'review_verification': body['clueId'] = 'same-clue'
            for principal in (PRINCIPAL, dict(PRINCIPAL, role='admin')):
                before = copy.deepcopy(data)
                self.assert_code('admin_required', lambda: apply_docking_action(body, data, principal))
                self.assertEqual(data, before)
            body['actorRole'] = 'admin'
            self.assert_code('invalid_action', lambda: apply_docking_action(body, data, ADMIN))

    def test_management_idempotence_precedes_stale_version_but_not_auth(self):
        data, (key, _) = fixture()
        body = workflow(key, status='processing', owner='ops', nextStep='review', note='accepted')
        apply_docking_action(body, data, ADMIN)
        newer = workflow(key, request_id='workflow-2', version=1, status='feedback', owner='ops', note='reply')
        apply_docking_action(newer, data, ADMIN)
        self.assertFalse(apply_docking_action(body, data, ADMIN)['created'])
        self.assert_code('admin_required', lambda: apply_docking_action(body, data, PRINCIPAL))
        self.assert_code('request_conflict', lambda: apply_docking_action(
            dict(body, record=dict(body['record'], note='different')), data, ADMIN))
        self.assert_code('version_conflict', lambda: apply_docking_action(
            dict(body, requestId='stale-request'), data, ADMIN))
        self.assertEqual(len(data['DOCK_LOGS'][key]), 2)

    def test_version_required_and_stale_supplement_does_not_overwrite_reply(self):
        data, (key, _) = fixture()
        body = workflow(key, status='needs_info', owner='ops', note='need more detail')
        apply_docking_action(body, data, ADMIN)
        for value in (None, -1, True, '1'):
            supplied = workflow(key, 'supplement_demand', request_id='supplement-new', note='detail')
            supplied['expectedVersion'] = value
            self.assert_code('invalid_version', lambda: apply_docking_action(supplied, data, PRINCIPAL))
        before = copy.deepcopy(data)
        self.assert_code('version_conflict', lambda: apply_docking_action(
            workflow(key, 'supplement_demand', request_id='supplement-new', note='detail'), data, PRINCIPAL))
        self.assertEqual(data, before)

    def test_verification_processing_then_result_is_explicit_and_not_green(self):
        data, (key, _) = fixture()
        original = copy.deepcopy(data['PROJECTS'][key]['clues'][0])
        apply_docking_action(action(key), data, PRINCIPAL, now=1)
        process = workflow(key, 'review_verification', 'review-1', status='processing', note='已分配核验人员')
        process['clueId'] = 'same-clue'
        apply_docking_action(process, data, ADMIN, now=2)
        result_body = workflow(key, 'review_verification', 'review-2', 1, status='completed',
                               note='业务负责人同意进一步沟通，尚无投资承诺。', outcome='further_contact',
                               evidence='2026-10-19 电话沟通，联系人确认产品线可覆盖需求。')
        result_body['clueId'] = 'same-clue'
        result = apply_docking_action(result_body, data, ADMIN, now=3)
        clue = result['project']['clues'][0]
        request = clue.pop('verificationRequest')
        self.assertEqual(clue, original)
        self.assertEqual(request['status'], 'completed')
        self.assertEqual(request['outcome'], 'further_contact')
        self.assertEqual(request['version'], 2)
        self.assertEqual(request['requestedAt'], 1)
        self.assertEqual(request['requestedBy'], 'tester')
        self.assertEqual(request['updatedBy'], 'ops-reviewer')
        self.assertEqual(result['project']['stage'], 4)
        self.assertEqual(result['logs'][0]['kind'], 'review_verification')
        self.assertEqual(result['logs'][0]['evidence'], result_body['record']['evidence'])
        self.assertFalse(apply_docking_action(result_body, data, ADMIN, now=4)['created'])

    def test_verification_result_requires_request_and_evidence_and_no_invalid_outcome(self):
        data, (key, _) = fixture()
        body = workflow(key, 'review_verification', status='completed', note='reply', outcome='further_contact', evidence='source')
        body['clueId'] = 'same-clue'
        self.assert_code('verification_request_required', lambda: apply_docking_action(body, data, ADMIN))
        apply_docking_action(action(key), data, PRINCIPAL)
        for record in ({'status': 'completed', 'note': 'reply', 'outcome': 'further_contact'},
                       {'status': 'completed', 'note': 'reply', 'outcome': 'verified', 'evidence': 'source'},
                       {'status': 'processing', 'note': 'reply', 'outcome': 'further_contact'},
                       {'status': 'completed', 'note': '', 'outcome': 'insufficient', 'evidence': 'source'},
                       {'status': 'approved', 'note': 'reply'}, {'status': [], 'note': 'reply'}):
            before = copy.deepcopy(data)
            self.assert_code('invalid_record', lambda: apply_docking_action(dict(body, record=record), data, ADMIN))
            self.assertEqual(data, before)

    def test_verification_needs_info_and_reapplication_versions_never_reuse_old_version(self):
        data, (key, _) = fixture()
        apply_docking_action(action(key), data, PRINCIPAL)
        body = workflow(key, 'review_verification', 'review-1', status='needs_info', note='需要企业联系人资料')
        body['clueId'] = 'same-clue'
        apply_docking_action(body, data, ADMIN)
        self.assert_code('verification_already_requested', lambda: apply_docking_action(action(key, 'request-2'), data, PRINCIPAL))
        body.update(requestId='review-2', expectedVersion=1,
                    record={'status': 'completed', 'note': '现有材料不足', 'outcome': 'insufficient', 'evidence': '未取得企业回复'})
        apply_docking_action(body, data, ADMIN)
        result = apply_docking_action(action(key, 'request-2'), data, PRINCIPAL)
        self.assertEqual(result['project']['clues'][0]['verificationRequest']['version'], 3)
        self.assert_code('version_conflict', lambda: apply_docking_action(
            dict(body, requestId='stale-review', expectedVersion=0), data, ADMIN))

    def test_advance_stage_is_acknowledged_monotonic_and_does_not_resolve_verification(self):
        data, (key, _) = fixture()
        apply_docking_action(action(key), data, PRINCIPAL)
        before_request = copy.deepcopy(data['PROJECTS'][key]['clues'][0]['verificationRequest'])
        body = workflow(key, 'advance_stage', target=5, note='双方已确认首次沟通安排')
        result = apply_docking_action(body, data, ADMIN, now=10)
        self.assertEqual(result['project']['stage'], 5)
        self.assertEqual(result['project']['stageVersion'], 1)
        self.assertEqual(result['project']['stageLog'][0]['who'], 'ops-reviewer')
        self.assertEqual(result['project']['stageLog'][0]['from'], 4)
        self.assertEqual(result['logs'][0]['kind'], 'advance_stage')
        self.assertEqual(result['project']['clues'][0]['verificationRequest'], before_request)
        self.assertFalse(apply_docking_action(body, data, ADMIN)['created'])
        data['PROJECTS'][key]['customStages'] = ['实地考察', '签约']
        follow = workflow(key, 'advance_stage', 'advance-2', 1, target=6, note='已完成现场安排')
        self.assertEqual(apply_docking_action(follow, data, ADMIN)['project']['stage'], 6)
        self.assert_code('version_conflict', lambda: apply_docking_action(
            dict(follow, requestId='stale-advance', expectedVersion=0), data, ADMIN))

    def test_advance_rejects_invalid_target_and_empty_note_without_writes(self):
        for target, note in ((4, 'same'), (3, 'back'), (6, 'not configured'), (True, 'bool'), ('5', 'string'), (5, '')):
            data, (key, _) = fixture()
            before = copy.deepcopy(data)
            code = 'invalid_record' if target == 5 and note == '' else 'invalid_stage'
            self.assert_code(code, lambda: apply_docking_action(
                workflow(key, 'advance_stage', target=target, note=note), data, ADMIN))
            self.assertEqual(data, before)

    def test_all_workflow_fields_survive_generic_admin_and_member_snapshots(self):
        data, (key, _) = fixture()
        stale_project = copy.deepcopy(data['PROJECTS'][key])
        apply_docking_action(workflow(key, status='processing', owner='ops', nextStep='review', note='accepted'), data, ADMIN)
        apply_docking_action(action(key), data, PRINCIPAL)
        process = workflow(key, 'review_verification', 'review-1', status='processing', note='reviewing')
        process['clueId'] = 'same-clue'
        apply_docking_action(process, data, ADMIN)
        apply_docking_action(workflow(key, 'advance_stage', 'advance-1', target=5, note='meeting arranged'), data, ADMIN)
        for principal in (PRINCIPAL, ADMIN):
            incoming = {'PROJECTS': {key: stale_project}, 'DOCK_LOGS': {key: []}}
            guarded = json.loads(guard_sync(json.dumps(incoming).encode(), data, principal))
            for field in ('intake', 'stage', 'stageVersion', 'stageLog'):
                self.assertEqual(guarded['PROJECTS'][key][field], data['PROJECTS'][key][field])
            self.assertEqual(guarded['PROJECTS'][key]['clues'][0]['verificationRequest'],
                             data['PROJECTS'][key]['clues'][0]['verificationRequest'])
            self.assertEqual(guarded['DOCK_LOGS'][key], data['DOCK_LOGS'][key])
        fabricated = dict(stale_project, intake={'status': 'processing', 'owner': 'fabricated'})
        other = copy.deepcopy(data)
        other['PROJECTS'][key].pop('intake')
        for principal in (PRINCIPAL, ADMIN):
            self.assert_code('server_owned_docking', lambda: guard_sync(
                json.dumps({'PROJECTS': {key: fabricated}}).encode(), other, principal))

    def test_concurrent_admin_receiving_checks_version_inside_lock(self):
        data, (key, _) = fixture()
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'state.json')
            with open(path, 'w') as stream: json.dump(data, stream)
            handlers = [Handler(), Handler()]
            payloads = [workflow(key, request_id='concurrent-' + str(i), status='processing',
                                 owner='operator-' + str(i), nextStep='review', note='accepted')
                        for i in range(2)]
            def run(index):
                handle_docking_action(handlers[index], json.dumps(payloads[index]).encode(),
                                      lambda: file_session(path, lambda: None))
            with patch('backend.docking_actions.require_session', return_value=ADMIN):
                threads = [threading.Thread(target=run, args=(index,)) for index in range(2)]
                for thread in threads: thread.start()
                for thread in threads: thread.join()
            self.assertEqual(sorted(handler.status for handler in handlers), [200, 409])
            with open(path) as stream: saved = json.load(stream)
            self.assertEqual(saved['PROJECTS'][key]['intake']['version'], 1)
            self.assertEqual(len(saved['DOCK_LOGS'][key]), 1)
            self.assertEqual(saved['PROJECTS'][key]['intake']['owner'],
                             saved['DOCK_LOGS'][key][0]['owner'])

    def test_submitted_demand_lifecycle_cannot_clear_topic_or_rederive_stage(self):
        for legacy in (False, True):
            for principal in (PRINCIPAL, ADMIN):
                for fields in ('delete', 'recreate', 'legacy_list'):
                    data, (key, _) = fixture()
                    topic = data['PROJECTS'][key]['topic']
                    # Include pre-existing lifecycle metadata: even a benign
                    # later sync must not rederive stage five as stage two.
                    if legacy:
                        data['PROJECTS'][key].pop('submissionState')
                        data['PROJECTS'][key]['topicCreatedAt'] = {topic: 5}
                        data['PROJECTS'][key]['stageByTopic'] = {topic: 2}
                    apply_docking_action(workflow(key, status='processing', owner='ops', nextStep='review', note='accepted'), data, ADMIN)
                    apply_docking_action(workflow(key, 'advance_stage', 'advance-proof', target=5, note='meeting arranged'), data, ADMIN)
                    saved = copy.deepcopy(data['PROJECTS'][key])
                    changed = copy.deepcopy(saved)
                    if fields == 'delete':
                        changed.update(topicDeletedAt={topic: 100}, deletedTopics=[topic], topic='')
                    elif fields == 'recreate':
                        changed.update(topicCreatedAt={topic: 100}, stageByTopic={topic: 2},
                                       customTopics=['unrelated'], aiTopics={'list': [{'label': 'unrelated'}]})
                    else:
                        changed.update(deletedTopics=[topic], topics=['unrelated'])
                    guarded = json.loads(guard_sync(json.dumps({'PROJECTS': {key: changed}}).encode(), data, principal))
                    merged = _merge_map(copy.deepcopy(data['PROJECTS']), guarded['PROJECTS'])
                    for field in ('topic', 'stage', 'intake', 'stageLog', 'stageVersion',
                                  'topicCreatedAt', 'topicDeletedAt', 'stageByTopic', 'customTopics',
                                  'aiTopics', 'topics', 'deletedTopics', 'sourcePriorityKey', 'demandSpec'):
                        self.assertEqual(merged[key].get(field), saved.get(field), (legacy, principal['scope'], fields, field))

    def test_legacy_submission_identity_cannot_be_cleared_to_bypass_lifecycle_guard(self):
        for principal in (PRINCIPAL, ADMIN):
            data, (key, _) = fixture()
            project = data['PROJECTS'][key]
            project.pop('demandContract')
            project.pop('submissionState')
            project.update(stage=5)
            saved = copy.deepcopy(project)
            changed = dict(copy.deepcopy(project), isDemand=False, submissionState='draft', stage=2,
                           parentProjectKey='q', parent='q', topicDeletedAt={project['topic']: 100})
            guarded = json.loads(guard_sync(json.dumps({'PROJECTS': {key: changed}}).encode(), data, principal))
            merged = _merge_map(copy.deepcopy(data['PROJECTS']), guarded['PROJECTS'])
            for field in ('isDemand', 'submissionState', 'stage', 'topic', 'workspaceId',
                          'parentProjectKey', 'parent', 'topicDeletedAt'):
                self.assertEqual(merged[key].get(field), saved.get(field), (principal['scope'], field))

    def test_incoming_city_demand_flag_does_not_skip_saved_city_lifecycle(self):
        for principal in (PRINCIPAL, ADMIN):
            data, _ = fixture()
            root = data['PROJECTS']['p']
            root.update(isDemand=False, stage=2)
            topic = root['topic']
            changed = dict(copy.deepcopy(root), isDemand=True, submissionState='submitted', stage=5,
                           topicDeletedAt={topic: 100}, deletedTopics=[topic])
            guarded = json.loads(guard_sync(json.dumps({'PROJECTS': {'p': changed}}).encode(), data, principal))
            merged = _merge_map(copy.deepcopy(data['PROJECTS']), guarded['PROJECTS'])
            self.assertEqual(merged['p']['topic'], '')
            self.assertEqual(merged['p']['stage'], 2)

    def test_unsubmitted_draft_and_city_topic_lifecycle_remain_editable(self):
        for demand in (False, True):
            data, (key, _) = fixture()
            data['PROJECTS'][key].pop('demandContract')
            data['PROJECTS'][key].update(submissionState='draft', isDemand=demand, stage=2)
            topic = data['PROJECTS'][key]['topic']
            changed = copy.deepcopy(data['PROJECTS'][key])
            changed.update(topicDeletedAt={topic: 100}, deletedTopics=[topic])
            guarded = json.loads(guard_sync(json.dumps({'PROJECTS': {key: changed}}).encode(), data, ADMIN))
            merged = _merge_map(copy.deepcopy(data['PROJECTS']), guarded['PROJECTS'])
            self.assertEqual(merged[key]['topic'], '')
            self.assertEqual(merged[key]['stage'], 2)
            self.assertEqual(merged[key]['topicDeletedAt'], {topic: 100})

    def test_invalid_receiving_records_are_atomic(self):
        for record in ({'status': 'unknown', 'owner': 'ops', 'note': 'reply'},
                       {'status': 'processing', 'owner': '', 'nextStep': 'review', 'note': 'reply'},
                       {'status': 'processing', 'owner': 'ops', 'nextStep': '', 'note': 'reply'},
                       {'status': 'feedback', 'owner': 'ops', 'note': ''},
                       {'status': 'needs_info', 'owner': 'ops', 'note': 'reply', 'approved': True}):
            data, (key, _) = fixture(); before = copy.deepcopy(data)
            self.assert_code('invalid_record', lambda: apply_docking_action(
                workflow(key, **record), data, ADMIN))
            self.assertEqual(data, before)


if __name__ == '__main__':
    unittest.main()
