"""Real reminder transactions against isolated file snapshots and a fake clock."""
import concurrent.futures
import contextlib
import copy
import ast
import hashlib
import http.client
import io
import json
import multiprocessing
import tempfile
import threading
import unittest
from datetime import datetime
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from backend import reminders as r
from backend.access_control import guard_sync, scoped_sync_view
from backend.auth import AuthError, SESSION_COOKIE_NAME
from backend.sync_transaction import file_session
from backend.industry_demands import create_industry_demand
from backend.docking_actions import apply_docking_action


def stamp(text):
    return int(datetime.fromisoformat(text).replace(tzinfo=r.SHANGHAI).timestamp() * 1000)


NOW = stamp('2026-10-23T10:00:00')  # Friday, local clock


def fixture():
    return {'PROJECTS': {
        'a': {'id': 'a', 'workspaceId': 'a', 'city': 'City A'},
        'b': {'id': 'b', 'workspaceId': 'b', 'city': 'City B'},
        'd': {'id': 'd', 'workspaceId': 'a', 'isDemand': True, 'stage': 5,
              'demandTitle': 'Offline test demand',
              'demandContract': 'industry-demand-v1',
              'submissionState': 'submitted', 'submittedAt': NOW - 1000,
              'stageLog': [{'ts': NOW - 1000, 'to': 4, 'note': 'Old submission'}]}},
        'USER_PROFILES': {
            'alice': {'password_hash': 'fixture-a', 'ts': 1, 'memberships': {'a': {'role': 'owner'}}},
            'bob': {'password_hash': 'fixture-b', 'ts': 2, 'memberships': {'b': {'role': 'owner'}}}},
        'CITY_ACCOUNTS': {}, 'DOCK_LOGS': {},
        'DEMANDS': [{'id': 'demand-d', 'projKey': 'd', 'demandContract': 'industry-demand-v1'}],
        'UNRELATED': {'preserve': ['unknown', 17]}}


def principal(user='alice', root='a'):
    return {'scope': 'project', 'user': user, 'role': 'owner', 'projKey': root, 'projectKeys': [root]}


def get(state, now=NOW, user='alice', root='a', key=None):
    return r.apply_request({'projectKey': key or root, 'requestId': 'get-1'}, state,
                           principal(user, root), now=now)


def follow(receipt, **fields):
    return dict(projectKey=receipt['projectKey'], requestId='change-1',
                accountEpoch=receipt['accountEpoch'], version=receipt['version'], **fields)


def event(state, *, eid='event-1', ts=NOW + 1, key='d', kind='advance_stage', **fields):
    state.setdefault('DOCK_LOGS', {}).setdefault(key, []).insert(0,
        dict(id=eid, contract='docking-action-v1', ts=ts, kind=kind, note='Recorded update', **fields))


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.state = fixture()

    def test_enrollment_has_no_backfill_and_does_not_touch_business(self):
        before = copy.deepcopy(self.state)
        receipt = get(self.state)
        self.assertEqual(receipt['preferences'], r.DEFAULTS)
        self.assertEqual(receipt['notifications'], [])
        self.assertEqual({k: v for k, v in self.state.items() if k != r.TABLE}, before)
        self.assertNotIn('credential', json.dumps(receipt))
        self.assertNotIn('fixture-a', json.dumps(receipt))

    def test_no_tick_registration_or_write_without_enrolled_account(self):
        before = copy.deepcopy(self.state)
        with Store(self.state) as store:
            r.run_once(store.factory, now=NOW)
            self.assertEqual(store.read(), before)
            self.assertEqual(store.writes, 0)

    def test_all_false_persists_and_is_account_level(self):
        first = get(self.state)
        self.state['USER_PROFILES']['alice']['memberships']['b'] = {'role': 'member'}
        saved = r.apply_request(follow(first, preferences=dict.fromkeys(r.DEFAULTS, False)),
            self.state, principal(), operation='preferences', now=NOW + 1)
        self.assertEqual(saved['version'], 1)
        other = get(self.state, user='alice', root='b')
        self.assertEqual(other['preferences'], dict.fromkeys(r.DEFAULTS, False))
        self.assertEqual(get(self.state, user='bob', root='b')['preferences'], r.DEFAULTS)

    def test_changed_credentials_rotate_epoch_and_preserve_preferences(self):
        first = get(self.state)
        r.apply_request(follow(first, preferences=dict.fromkeys(r.DEFAULTS, False)), self.state,
                        principal(), operation='preferences', now=NOW + 1)
        self.state['USER_PROFILES']['alice']['password_hash'] = 'new-fixture'
        current = get(self.state, now=NOW + 2)
        self.assertNotEqual(first['accountEpoch'], current['accountEpoch'])
        self.assertEqual(current['preferences'], dict.fromkeys(r.DEFAULTS, False))
        with self.assertRaises(AuthError):
            r.apply_request(follow(first, all=True), self.state, principal(), operation='read', now=NOW + 3)

    def test_replaced_account_does_not_inherit_old_settings(self):
        first = get(self.state)
        r.apply_request(follow(first, preferences=dict.fromkeys(r.DEFAULTS, False)), self.state,
                        principal(), operation='preferences', now=NOW + 1)
        self.state['USER_PROFILES']['alice'].update(password_hash='replacement', ts=3)
        self.assertEqual(get(self.state, now=NOW + 2)['preferences'], r.DEFAULTS)

    def test_legacy_missing_or_invalid_creation_time_does_not_prove_identity(self):
        for creation_time in (None, 0, -1, True, 'missing'):
            with self.subTest(creation_time=creation_time):
                state = fixture()
                if creation_time is None:
                    state['USER_PROFILES']['alice'].pop('ts')
                else:
                    state['USER_PROFILES']['alice']['ts'] = creation_time
                first = get(state)
                event(state)
                visible = get(state, now=NOW + 2)
                self.assertEqual(len(visible['notifications']), 1)
                r.apply_request(follow(visible, preferences=dict.fromkeys(r.DEFAULTS, False)), state,
                                principal(), operation='preferences', now=NOW + 3)
                state['USER_PROFILES']['alice']['password_hash'] = 'replacement-with-no-stable-creation-time'
                current = get(state, now=NOW + 4)
                self.assertNotEqual(current['accountEpoch'], first['accountEpoch'])
                self.assertEqual(current['preferences'], r.DEFAULTS)
                self.assertEqual(current['notifications'], [])

    def test_valid_stable_creation_time_retains_preferences_but_not_notifications(self):
        first = get(self.state)
        event(self.state)
        visible = get(self.state, now=NOW + 2)
        self.assertEqual(len(visible['notifications']), 1)
        r.apply_request(follow(visible, preferences=dict.fromkeys(r.DEFAULTS, False)), self.state,
                        principal(), operation='preferences', now=NOW + 3)
        self.state['USER_PROFILES']['alice']['ts'] = 1.0  # Numerically identical legacy serialization.
        self.state['USER_PROFILES']['alice']['password_hash'] = 'changed-credential-same-created-account'
        current = get(self.state, now=NOW + 4)
        self.assertNotEqual(current['accountEpoch'], first['accountEpoch'])
        self.assertEqual(current['preferences'], dict.fromkeys(r.DEFAULTS, False))
        self.assertEqual(current['notifications'], [])

    def test_distinct_fractional_creation_times_do_not_merge_identities(self):
        self.state['USER_PROFILES']['alice']['ts'] = 1.1
        first = get(self.state)
        r.apply_request(follow(first, preferences=dict.fromkeys(r.DEFAULTS, False)), self.state,
                        principal(), operation='preferences', now=NOW + 1)
        self.state['USER_PROFILES']['alice'].update(ts=1.9, password_hash='replaced')
        current = get(self.state, now=NOW + 2)
        self.assertEqual(current['preferences'], r.DEFAULTS)
        self.assertNotEqual(current['accountEpoch'], first['accountEpoch'])
        self.assertEqual(current['notifications'], [])

    def test_submillisecond_creation_time_is_not_stable_positive_identity(self):
        self.state['USER_PROFILES']['alice']['ts'] = 0.1
        first = get(self.state)
        r.apply_request(follow(first, preferences=dict.fromkeys(r.DEFAULTS, False)), self.state,
                        principal(), operation='preferences', now=NOW + 1)
        self.state['USER_PROFILES']['alice']['password_hash'] = 'replaced'
        current = get(self.state, now=NOW + 2)
        self.assertEqual(current['preferences'], r.DEFAULTS)
        self.assertNotEqual(current['accountEpoch'], first['accountEpoch'])
        self.assertEqual(current['notifications'], [])

    def test_collision_revocation_and_unrelated_workspace_are_rejected(self):
        for mutate, actor, key in [
                (lambda s: s['CITY_ACCOUNTS'].update(Alice=copy.deepcopy(s['USER_PROFILES']['alice'])), principal(), 'a'),
                (lambda s: s['USER_PROFILES']['alice'].update(disabled=True), principal(), 'a'),
                (lambda s: None, principal(), 'b')]:
            state = fixture(); mutate(state)
            with self.assertRaises(AuthError):
                r.apply_request({'projectKey': key, 'requestId': 'read'}, state, actor, now=NOW)

    def test_strict_fields_booleans_and_versions(self):
        current = get(self.state)
        valid = follow(current, preferences=copy.deepcopy(r.DEFAULTS))
        bad = [dict(valid, user='bob'), dict(valid, version=True), dict(valid, version=999),
               dict(valid, accountEpoch='wrong'), dict(valid, preferences={'overdue': True}),
               dict(valid, preferences=dict(r.DEFAULTS, overdue=1)), dict(valid, requestId='bad id')]
        for body in bad:
            with self.subTest(body=body), self.assertRaises(AuthError):
                r.apply_request(body, copy.deepcopy(self.state), principal(), operation='preferences', now=NOW + 1)

    def test_actual_event_latest_ts_dedup_and_verification_outcome(self):
        get(self.state)
        event(self.state, eid='newer', ts=NOW + 200, kind='review_verification', status='completed', outcome='not_suitable')
        event(self.state, eid='older', ts=NOW + 100)
        self.state['PROJECTS']['d']['stageLog'].insert(0, {'id': 'older', 'ts': NOW + 100, 'to': 5})
        first = get(self.state, now=NOW + 300)
        self.assertEqual(len(first['notifications']), 2)
        self.assertEqual(first['notifications'][0]['type'], 'verification')
        self.assertEqual(first['notifications'][0]['outcome'], 'not_suitable')
        self.assertIn('核验结论：本次需求不适配', first['notifications'][0]['message'])
        self.assertNotIn('通过', first['notifications'][0]['title'])
        self.assertEqual(first, get(self.state, now=NOW + 301))

    def test_legacy_stage_event_without_id_has_stable_identity(self):
        get(self.state)
        self.state['PROJECTS']['d']['stageLog'].insert(0, {'ts': NOW + 10, 'to': 6, 'note': 'Custom stage'})
        first = get(self.state, now=NOW + 11)
        self.assertEqual(len(first['notifications']), 1)
        self.assertEqual(first['notifications'][0]['title'], 'Offline test demand · 项目阶段已更新')
        self.assertEqual(first, get(self.state, now=NOW + 12))

    def test_future_event_waits_for_real_time_including_at_enrollment(self):
        event(self.state, ts=NOW + 100)
        self.assertEqual(get(self.state)['notifications'], [])
        self.assertEqual(get(self.state, now=NOW + 99)['notifications'], [])
        self.assertEqual(len(get(self.state, now=NOW + 100)['notifications']), 1)

    def test_noncanonical_dock_log_cannot_create_verification_notification(self):
        get(self.state)
        event(self.state, kind='review_verification', status='completed', outcome='further_contact')
        self.state['DOCK_LOGS']['d'][0].pop('contract')
        self.assertEqual(get(self.state, now=NOW + 2)['notifications'], [])

    def test_generic_stage_log_contract_label_is_not_authority(self):
        get(self.state)
        self.state['PROJECTS']['a']['stageLog'] = [
            {'id': 'forged', 'contract': 'docking-action-v1', 'ts': NOW + 1, 'to': 5}]
        self.assertEqual(get(self.state, now=NOW + 2)['notifications'], [])

    def test_latest_timestamp_controls_due_date_not_array_tail(self):
        get(self.state)
        event(self.state, eid='recent', ts=stamp('2026-10-27T10:00:00'))
        event(self.state, eid='older-in-first-position', ts=NOW + 1)
        result = get(self.state, now=stamp('2026-10-28T11:00:00'))
        self.assertFalse(any(n['type'] == 'overdue' for n in result['notifications']))

    def test_unknown_fields_are_preserved_and_reads_do_not_edit_business(self):
        get(self.state)
        account = next(iter(self.state[r.TABLE].values()))
        account['futureField'] = {'preserve': 99}
        account['workspaces']['a']['futureField'] = 'preserve'
        before = {k: copy.deepcopy(v) for k, v in self.state.items() if k != r.TABLE}
        event(self.state)
        before['DOCK_LOGS'] = copy.deepcopy(self.state['DOCK_LOGS'])
        get(self.state, now=NOW + 2)
        self.assertEqual(account['futureField'], {'preserve': 99})
        self.assertEqual(account['workspaces']['a']['futureField'], 'preserve')
        self.assertEqual({k: v for k, v in self.state.items() if k != r.TABLE}, before)

    def test_switch_off_suppresses_new_events_reenable_restores_old_only(self):
        first = get(self.state)
        event(self.state)
        visible = get(self.state, now=NOW + 2)
        off = r.apply_request(follow(visible, preferences=dict(r.DEFAULTS, statusChanges=False)),
                             self.state, principal(), operation='preferences', now=NOW + 3)
        event(self.state, eid='suppressed', ts=NOW + 4)
        self.assertEqual(get(self.state, now=NOW + 5)['notifications'], [])
        on = r.apply_request(follow(off, preferences=r.DEFAULTS), self.state,
                             principal(), operation='preferences', now=NOW + 6)
        self.assertEqual(len(on['notifications']), 1)

    def test_three_business_days_excludes_weekend_not_stage_five(self):
        get(self.state)
        event(self.state, ts=NOW + 1)
        before = get(self.state, now=stamp('2026-10-28T09:59:59'))
        self.assertFalse(any(n['type'] == 'overdue' for n in before['notifications']))
        after = get(self.state, now=stamp('2026-10-28T10:00:01'))
        self.assertEqual(sum(n['type'] == 'overdue' for n in after['notifications']), 1)
        event(self.state, eid='refresh', ts=stamp('2026-10-28T09:00:00'))
        current = get(self.state, now=stamp('2026-10-28T10:01:00'))
        self.assertEqual(sum(n['type'] == 'overdue' for n in current['notifications']), 1)

    def test_no_existing_overdue_backfill_and_closed_project_does_not_generate(self):
        get(self.state)
        self.assertFalse(any(n['type'] == 'overdue' for n in get(self.state, now=NOW + 2 * 86400000)['notifications']))
        self.assertEqual(sum(n['type'] == 'overdue' for n in get(self.state, now=NOW + 10 * 86400000)['notifications']), 1)
        self.state = fixture(); get(self.state)
        self.state['PROJECTS']['d']['closed'] = True
        event(self.state)
        self.assertFalse(get(self.state, now=NOW + 20)['notifications'])

    def test_canonical_submitted_demand_without_timestamp_tracks_from_enrollment(self):
        self.state['PROJECTS']['d'].pop('submittedAt')
        self.state['PROJECTS']['d']['stageLog'] = []
        self.assertEqual(get(self.state)['notifications'], [])
        before = get(self.state, now=stamp('2026-10-28T09:59:59'))
        self.assertFalse(any(n['type'] == 'overdue' for n in before['notifications']))
        after = get(self.state, now=stamp('2026-10-28T10:00:00'))
        self.assertEqual(sum(n['type'] == 'overdue' for n in after['notifications']), 1)
        self.assertIn('自开始跟踪或最近一次已记录进展起', next(n['message'] for n in after['notifications'] if n['type'] == 'overdue'))

    def test_missing_timestamp_unsubmitted_or_noncanonical_demand_is_not_invented(self):
        for mode in ('unsubmitted', 'noncanonical'):
            state = fixture(); project = state['PROJECTS']['d']
            project.pop('submittedAt'); project['stageLog'] = []
            if mode == 'unsubmitted': project['submissionState'] = 'draft'
            else:
                project.pop('demandContract')
                state['DEMANDS'] = []
            get(state)
            result = get(state, now=stamp('2026-10-28T11:00:00'))
            self.assertFalse(any(n['type'] == 'overdue' for n in result['notifications']))

    def test_shanghai_daily_nine_is_once_and_immutable(self):
        get(self.state)
        same_day = get(self.state, now=stamp('2026-10-23T23:59:00'))
        self.assertFalse(any(n['type'] == 'daily' for n in same_day['notifications']))
        before = get(self.state, now=stamp('2026-10-24T08:59:59'))
        self.assertFalse(any(n['type'] == 'daily' for n in before['notifications']))
        first = get(self.state, now=stamp('2026-10-24T09:00:00'))
        digest = [n for n in first['notifications'] if n['type'] == 'daily']
        self.assertEqual(len(digest), 1)
        self.assertIn('Offline test demand；阶段 5；受理状态：已提交', digest[0]['message'])
        self.state['PROJECTS']['d']['demandTitle'] = 'New name after snapshot'
        self.state['PROJECTS']['e'] = dict(self.state['PROJECTS']['d'], id='e')
        again = get(self.state, now=stamp('2026-10-24T20:00:00'))
        self.assertEqual([n for n in again['notifications'] if n['type'] == 'daily'], digest)
        next_day = get(self.state, now=stamp('2026-10-25T09:00:00'))
        self.assertEqual(sum(n['type'] == 'daily' for n in next_day['notifications']), 2)

    def test_daily_snapshot_is_bounded_and_excludes_contact_and_materials(self):
        get(self.state)
        for index in range(30):
            self.state['PROJECTS']['x' + str(index)] = dict(self.state['PROJECTS']['d'],
                id='x' + str(index), demandTitle='Name' * 200,
                demandSpec={'contactName': 'PRIVATE_CONTACT'}, kb=[{'known': ['PRIVATE_MATERIAL']}])
            self.state['DEMANDS'].append({'id': 'demand-x' + str(index), 'projKey': 'x' + str(index),
                                         'demandContract': 'industry-demand-v1'})
        result = get(self.state, now=stamp('2026-10-24T09:00:00'))
        message = next(n['message'] for n in result['notifications'] if n['type'] == 'daily')
        self.assertLess(len(message), 4000)
        self.assertIn('11 项未在此摘要展开', message)
        self.assertNotIn('PRIVATE_', message)

    def test_read_is_account_workspace_scoped_and_idempotent(self):
        get(self.state)
        event(self.state)
        current = get(self.state, now=NOW + 2)
        bob = get(self.state, user='bob', root='b')
        with self.assertRaises(AuthError):
            r.apply_request(follow(bob, ids=[current['notifications'][0]['id']]), self.state,
                            principal('bob', 'b'), operation='read', now=NOW + 3)
        read = r.apply_request(follow(current, all=True), self.state, principal(), operation='read', now=NOW + 4)
        repeat = r.apply_request(follow(read, all=True), self.state, principal(), operation='read', now=NOW + 5)
        self.assertEqual(read['notifications'], repeat['notifications'])

    def test_generic_sync_cannot_read_or_write_server_map_for_either_scope(self):
        get(self.state)
        for actor in (principal(), {'scope': 'admin', 'user': 'admin'}):
            self.assertNotIn(r.TABLE, scoped_sync_view(self.state, actor))
            for incoming in ({r.TABLE: {}}, {'PROJECTS': {'a': {r.TABLE: {}}}}):
                with self.assertRaises(AuthError):
                    guard_sync(json.dumps(incoming).encode(), self.state, actor)


class FormalDemandTests(unittest.TestCase):
    def empty(self):
        state = fixture()
        state['PROJECTS'].pop('d')
        state['DEMANDS'] = []
        return state

    def client_draft(self, state, *, submitted=False, with_time=False, with_row=False):
        project = {'id': 'draft', 'workspaceId': 'a', 'parentProjectKey': 'a',
                   'isDemand': True, 'stage': 4 if submitted else 2, 'topic': 'Client-authored draft'}
        if submitted:
            project['submissionState'] = 'submitted'
        if with_time:
            project['submittedAt'] = NOW + 1
        incoming = {'PROJECTS': {'draft': project}}
        if with_row:
            incoming['DEMANDS'] = [{'id': 'client-row', 'projKey': 'draft', 'topic': project['topic']}]
        approved = json.loads(guard_sync(json.dumps(incoming).encode(), state, principal()))
        state['PROJECTS'].update(approved['PROJECTS'])
        if 'DEMANDS' in approved:
            state['DEMANDS'] = approved['DEMANDS']
        return 'draft'

    def create(self, state):
        result = create_industry_demand({'mode': 'direct', 'projectKey': 'a',
            'requestId': 'formal-direct-1', 'demand': {'title': 'Formal demand',
            'description': 'Offline explicitly submitted requirement', 'conditions': ''}},
            state, principal(), now=NOW + 1)
        return result['projectKey']

    def admin_accept(self, state, key):
        apply_docking_action({'projectKey': key, 'action': 'review_demand',
            'requestId': 'formal-review-1', 'expectedVersion': 0,
            'record': {'status': 'processing', 'owner': 'Offline reviewer',
                       'nextStep': 'Check recorded evidence', 'note': 'Demand received for review'}},
            state, {'scope': 'admin', 'user': 'offline-admin'}, now=NOW + 2)

    def assert_not_counted(self, state):
        result = get(state, now=stamp('2026-10-28T11:00:00'))
        self.assertFalse(any(row['type'] in ('overdue', 'daily') for row in result['notifications']))

    def test_sync_accepted_unsubmitted_drafts_never_enter_overdue_or_digest(self):
        for with_time in (False, True):
            with self.subTest(with_time=with_time):
                state = self.empty(); get(state)
                self.client_draft(state, with_time=with_time)
                self.assertEqual(state['DEMANDS'], [])
                self.assert_not_counted(state)

    def test_client_submitted_flag_and_plain_demand_row_are_not_formal_receipts(self):
        state = self.empty(); get(state)
        self.client_draft(state, submitted=True, with_time=True, with_row=True)
        self.assertEqual(len(state['DEMANDS']), 1)
        self.assert_not_counted(state)

    def test_member_only_canonical_supplement_is_not_admin_acceptance(self):
        state = self.empty(); get(state)
        key = self.client_draft(state, submitted=True, with_time=True, with_row=True)
        apply_docking_action({'projectKey': key, 'action': 'supplement_demand',
            'requestId': 'member-supplement', 'expectedVersion': 0,
            'record': {'note': 'Offline user supplement', 'files': []}},
            state, principal(), now=NOW + 3)
        self.assertEqual(state['PROJECTS'][key]['intake']['contract'], 'docking-action-v1')
        self.assertEqual(state['DOCK_LOGS'][key][0]['actorRole'], 'project')
        self.assert_not_counted(state)

    def test_actual_create_accept_verify_and_custom_stage_remain_active(self):
        state = self.empty(); get(state)
        key = self.create(state); self.admin_accept(state, key)
        state['PROJECTS'][key]['clues'] = [{'id': 'offline-clue', 'name': 'Offline enterprise', 'tone': 'amber'}]
        apply_docking_action({'projectKey': key, 'action': 'request_verification',
            'requestId': 'verify-request', 'clueId': 'offline-clue'}, state, principal(), now=NOW + 3)
        admin = {'scope': 'admin', 'user': 'offline-admin'}
        apply_docking_action({'projectKey': key, 'action': 'review_verification',
            'requestId': 'verify-reply', 'clueId': 'offline-clue', 'expectedVersion': 0,
            'record': {'status': 'completed', 'note': 'Evidence remains insufficient',
                       'outcome': 'insufficient', 'evidence': 'Offline evidence'}}, state, admin, now=NOW + 4)
        apply_docking_action({'projectKey': key, 'action': 'advance_stage',
            'requestId': 'stage-five', 'expectedVersion': 0,
            'record': {'target': 5, 'note': 'Recorded next stage'}}, state, admin, now=NOW + 5)
        state['PROJECTS'][key]['customStages'] = ['Offline custom stage']
        apply_docking_action({'projectKey': key, 'action': 'advance_stage',
            'requestId': 'stage-six', 'expectedVersion': 1,
            'record': {'target': 6, 'note': 'Recorded custom stage'}}, state, admin, now=NOW + 6)
        result = get(state, now=stamp('2026-10-28T11:00:00'))
        self.assertEqual(sum(row['type'] == 'overdue' for row in result['notifications']), 1)
        digest = next(row for row in result['notifications'] if row['type'] == 'daily')
        self.assertIn('Formal demand；阶段 6；受理状态：处理中', digest['message'])
        self.assertIn('依据仍不足', next(row for row in result['notifications']
                                     if row.get('outcome') == 'insufficient')['message'])

    def test_canonical_receipt_supports_legacy_project_without_contract(self):
        state = self.empty(); get(state)
        key = self.create(state)
        state['PROJECTS'][key].pop('demandContract')
        state['PROJECTS'][key].pop('submissionState')
        result = get(state, now=stamp('2026-10-28T11:00:00'))
        self.assertTrue(any(row['type'] == 'overdue' for row in result['notifications']))
        self.assertTrue(any(row['type'] == 'daily' for row in result['notifications']))

    def test_legacy_admin_intake_or_admin_event_proves_handling_without_submission_receipt(self):
        for proof in ('intake', 'event'):
            with self.subTest(proof=proof):
                state = self.empty(); get(state)
                key = self.create(state); self.admin_accept(state, key)
                state['PROJECTS'][key].pop('demandContract')
                state['DEMANDS'] = []
                if proof == 'intake': state['DOCK_LOGS'][key] = []
                else: state['PROJECTS'][key].pop('intake')
                result = get(state, now=stamp('2026-10-28T11:00:00'))
                self.assertTrue(any(row['type'] == 'overdue' for row in result['notifications']))
                self.assertTrue(any(row['type'] == 'daily' for row in result['notifications']))

    def test_proven_legacy_survives_missing_project_activity_timestamps(self):
        for proof in ('receipt', 'intake'):
            with self.subTest(proof=proof):
                state = self.empty(); get(state)
                key = self.create(state); self.admin_accept(state, key)
                state['PROJECTS'][key].pop('demandContract')
                state['PROJECTS'][key].pop('submittedAt')
                state['PROJECTS'][key]['stageLog'] = []
                state['DOCK_LOGS'][key] = []
                if proof == 'intake':
                    state['DEMANDS'] = []
                else:
                    state['DEMANDS'][0].pop('submittedAt')
                    state['PROJECTS'][key].pop('intake')
                result = get(state, now=stamp('2026-10-28T11:00:00'))
                self.assertEqual(sum(row['type'] == 'overdue' for row in result['notifications']), 1)

    def test_legacy_unprotected_project_timestamp_cannot_override_canonical_receipt(self):
        state = self.empty(); get(state)
        key = self.create(state)
        state['PROJECTS'][key].pop('demandContract')
        state['PROJECTS'][key]['stageLog'] = []
        state['PROJECTS'][key]['submittedAt'] = stamp('2026-10-27T10:00:00')
        result = get(state, now=stamp('2026-10-28T11:00:00'))
        self.assertEqual(sum(row['type'] == 'overdue' for row in result['notifications']), 1)

    def test_legacy_protected_admin_reply_resets_progress_clock(self):
        state = self.empty(); get(state)
        key = self.create(state)
        apply_docking_action({'projectKey': key, 'action': 'review_demand',
            'requestId': 'later-admin-review', 'expectedVersion': 0,
            'record': {'status': 'needs_info', 'owner': 'Offline reviewer',
                       'nextStep': '', 'note': 'Requesting missing evidence'}}, state,
            {'scope': 'admin', 'user': 'offline-admin'}, now=stamp('2026-10-27T10:00:00'))
        state['PROJECTS'][key].pop('demandContract')
        state['PROJECTS'][key].pop('submittedAt')
        state['PROJECTS'][key]['stageLog'] = []
        state['DOCK_LOGS'][key] = []
        state['DEMANDS'] = []
        result = get(state, now=stamp('2026-10-28T11:00:00'))
        self.assertFalse(any(row['type'] == 'overdue' for row in result['notifications']))

    def test_duplicate_or_conflicting_receipts_fail_closed_even_with_admin_handling(self):
        for conflict in ('duplicate', 'wrong_binding'):
            with self.subTest(conflict=conflict):
                state = self.empty(); get(state)
                key = self.create(state); self.admin_accept(state, key)
                if conflict == 'duplicate':
                    state['DEMANDS'].append(dict(state['DEMANDS'][0], id='ambiguous-duplicate'))
                else:
                    state['DEMANDS'][0]['projectKey'] = 'b'
                self.assert_not_counted(state)

    def test_nonactive_or_pre_submission_stages_never_count_despite_receipt(self):
        for status in ('draft', 'pending', 'failed', 'cancelled', 'completed', 'closed'):
            state = self.empty(); get(state)
            key = self.create(state); state['PROJECTS'][key]['submissionState'] = status
            self.assert_not_counted(state)
        for flag in ('deleted', 'closed', 'completed', 'cancelled'):
            state = self.empty(); get(state)
            key = self.create(state); state['PROJECTS'][key][flag] = True
            self.assert_not_counted(state)
        state = self.empty(); get(state)
        key = self.create(state); state['PROJECTS'][key]['stage'] = 2
        self.assert_not_counted(state)


class Store:
    def __init__(self, state):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / 'state.json')
        Path(self.path).write_text(json.dumps(state))
        self.writes = 0
        self.fail = False
    def read(self):
        return json.loads(Path(self.path).read_text())
    @contextlib.contextmanager
    def factory(self):
        with file_session(self.path, lambda: None) as session:
            original = session.write
            def write(raw):
                self.writes += 1
                return False if self.fail else original(raw)
            session.write = write
            yield session
    def __enter__(self): return self
    def __exit__(self, *args): self.tmp.cleanup()


class Handler:
    def __init__(self, path='/api/reminders?projectKey=a&requestId=get-1'):
        self.path = path; self.headers = {'Cookie': SESSION_COOKIE_NAME + '=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}
        self.wfile = io.BytesIO(); self.status = None
    def send_response(self, status): self.status = status
    def send_header(self, *args): pass
    def end_headers(self): pass
    def cors(self): pass
    @property
    def result(self): return json.loads(self.wfile.getvalue())


def authenticated(state):
    token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    state['AUTH_SESSIONS'] = {hashlib.sha256(token.encode()).hexdigest(): {
        'user': 'alice', 'source': 'USER_PROFILES', 'active_projKey': 'a',
        'credential_fingerprint': hashlib.sha256(b'fixture-a').hexdigest(),
        'expires_at': (NOW + 30 * 86400000) / 1000}}
    return state


class TransactionTests(unittest.TestCase):
    def test_real_file_persist_relogin_and_idle_ticks_do_not_write(self):
        with Store(authenticated(fixture())) as store:
            handler = Handler()
            r.handle_request(handler, b'', store.factory, now=NOW)
            self.assertEqual(handler.status, 200)
            self.assertEqual(store.writes, 1)
            again = Handler(); r.handle_request(again, b'', store.factory, now=NOW + 1)
            self.assertEqual(handler.result, again.result)
            r.run_once(store.factory, now=NOW + 2)
            self.assertEqual(store.writes, 1)
            current = store.read(); event(current)
            Path(store.path).write_text(json.dumps(current))
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                list(pool.map(lambda _: r.run_once(store.factory, now=NOW + 2), range(3)))
            self.assertEqual(sum(len(a['workspaces']['a']['notifications']) for a in store.read()[r.TABLE].values()), 1)

    def test_storage_failure_returns_503_and_no_success_or_partial_write(self):
        with Store(authenticated(fixture())) as store:
            before = store.read(); store.fail = True
            handler = Handler(); r.handle_request(handler, b'', store.factory, now=NOW)
            self.assertEqual(handler.status, 503)
            self.assertIs(handler.result['ok'], False)
            self.assertEqual(store.read(), before)

    def test_real_file_lock_deduplicates_two_processes(self):
        state = fixture(); get(state); event(state)
        with Store(state) as store:
            processes = [multiprocessing.get_context('fork').Process(target=file_tick, args=(store.path,)) for _ in range(2)]
            for process in processes: process.start()
            for process in processes:
                process.join(5)
                self.assertEqual(process.exitcode, 0)
            notices = next(iter(store.read()[r.TABLE].values()))['workspaces']['a']['notifications']
            self.assertEqual(len(notices), 1)

    def test_tick_write_failure_does_not_consume_event(self):
        state = fixture(); get(state); event(state)
        with Store(state) as store:
            before = store.read(); store.fail = True
            with self.assertRaises(AuthError):
                r.run_once(store.factory, now=NOW + 2)
            self.assertEqual(store.read(), before)
            store.fail = False; r.run_once(store.factory, now=NOW + 2)
            self.assertEqual(len(next(iter(store.read()[r.TABLE].values()))['workspaces']['a']['notifications']), 1)

    def test_unauthenticated_and_cross_origin_requests_do_not_mutate(self):
        with Store(authenticated(fixture())) as store:
            before = store.read()
            handler = Handler(); handler.headers = {}
            r.handle_request(handler, b'', store.factory, now=NOW)
            self.assertEqual(handler.status, 401)
            handler = Handler(); handler.headers['Origin'] = 'https://foreign.invalid'
            handler.headers['Host'] = 'example.invalid'
            r.handle_request(handler, b'{}', store.factory, operation='preferences', now=NOW)
            self.assertEqual(handler.status, 403)
            self.assertEqual(store.read(), before)

    def test_revoked_member_generates_nothing_in_tick(self):
        state = fixture(); get(state); event(state)
        state['USER_PROFILES']['alice']['memberships'] = {}
        with Store(state) as store:
            r.run_once(store.factory, now=NOW + 2)
            self.assertEqual(store.writes, 0)

    def test_worker_stop_and_error_are_observable_without_busy_loop(self):
        stop = threading.Event(); errors = []; called = threading.Event()
        def broken(*args, **kwargs): called.set(); raise OSError('private message')
        with patch.object(r, 'run_once', broken):
            returned, thread = r.start_reminder_loop(lambda: None, interval=60,
                stop_event=stop, on_error=errors.append)
            self.assertTrue(called.wait(1)); stop.set(); thread.join(1)
            self.assertFalse(thread.is_alive()); self.assertIs(returned, stop)
            self.assertEqual(errors, ['reminder_tick_failed'])


def file_tick(path):
    r.run_once(lambda: file_session(path, lambda: None), now=NOW + 2)


def actual_handler(source, store):
    """Compile the real server Handler, without importing server startup/services."""
    tree = ast.parse(source)
    handler_node = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Handler')
    namespace = {'BaseHTTPRequestHandler': BaseHTTPRequestHandler, '_PG_AVAIL': False,
                 'DATABASE_URL': '', 'SYNC_PATH': store.path, '_db_get': lambda: None}
    exec(compile(ast.Module(body=[handler_node], type_ignores=[]), '<real-server-handler>', 'exec'), namespace)
    handler = namespace['Handler']
    handler._account_session = lambda self: store.factory()
    handler._account_config = lambda self: None
    handler._secure_cookie = lambda self: False
    handler.log_message = lambda self, *args: None
    return handler


class HttpRouteTests(unittest.TestCase):
    def test_actual_server_routes_get_preferences_and_read_commit(self):
        state = authenticated(fixture())
        # Use real wall-clock session expiry, but deterministic reminder generation.
        state['AUTH_SESSIONS'][next(iter(state['AUTH_SESSIONS']))]['expires_at'] = 9999999999
        with Store(state) as store, patch.object(r, '_now', return_value=NOW):
            source = (Path(__file__).resolve().parents[1] / 'server.py').read_text()
            server = ThreadingHTTPServer(('127.0.0.1', 0), actual_handler(source, store))
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            connection = http.client.HTTPConnection(*server.server_address, timeout=2)
            headers = {'Cookie': Handler().headers['Cookie'], 'Content-Type': 'application/json'}
            try:
                connection.request('GET', '/api/reminders?projectKey=a&requestId=http-get', headers=headers)
                response = connection.getresponse(); loaded = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(loaded['requestId'], 'http-get')
                connection.request('POST', '/api/reminder-preferences',
                                   json.dumps(follow(loaded, preferences=dict.fromkeys(r.DEFAULTS, False))), headers)
                response = connection.getresponse(); saved = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(saved['preferences'], dict.fromkeys(r.DEFAULTS, False))
                connection.request('POST', '/api/reminders/read', json.dumps(follow(saved, all=True)), headers)
                response = connection.getresponse(); read = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(read['accountId'], 'alice')
                self.assertEqual(next(iter(store.read()[r.TABLE].values()))['preferences'], dict.fromkeys(r.DEFAULTS, False))
            finally:
                connection.close(); server.shutdown(); server.server_close(); thread.join(2)


if __name__ == '__main__':
    unittest.main()
