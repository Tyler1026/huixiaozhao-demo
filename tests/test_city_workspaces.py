"""Canonical city membership and stale-sync regressions; no live services."""
import concurrent.futures
import contextlib
import copy
import io
import json
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock
from pathlib import Path

from backend import admin_invites, auth
from backend.access_control import allowed_project_keys, guard_sync, scoped_sync_view
from backend.city_workspaces import get_city_workspace, next_month_report_at
from backend.sync_route import SyncDependencies, handle_sync
from backend.sync_transaction import file_session


NOW = 1_900_000_000
PASSWORD = 'offline-canonical-city-password'
ADMIN = auth.AdminConfig('city-test-admin', PASSWORD)


class Store:
    def __init__(self):
        self.raw = json.dumps({'PROJECTS': {}, 'INVITE_CODES': {}, 'USER_PROFILES': {},
                               'CITY_ACCOUNTS': {}, 'RESET_GEN': 'current-generation'})
        self.lock = threading.RLock()
        self.fail = False

    @property
    def state(self):
        return json.loads(self.raw)

    def replace(self, state):
        self.raw = json.dumps(state)

    @contextlib.contextmanager
    def factory(self):
        with self.lock:
            store = self
            class Session:
                def read(self):
                    return store.raw
                def write(self, raw):
                    if store.fail:
                        return False
                    store.raw = raw
                    return True
            yield Session()


class CityWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        self.admin = self.call('login', {'username': ADMIN.username, 'password': PASSWORD})

    def call(self, operation, body=None, token=None):
        return auth.handle_auth(operation, body or {}, self.store.factory, token=token,
                                now=NOW, admin_config=ADMIN)

    def create(self, city='Exact City', **kwargs):
        with self.store.factory() as session:
            return admin_invites.manage_invite(dict(action='create', city=city, **kwargs), session,
                                               token=self.admin['session_token'], now=NOW, admin_config=ADMIN)

    def revoke(self, code):
        with self.store.factory() as session:
            return admin_invites.manage_invite({'action': 'revoke', 'code': code}, session,
                                               token=self.admin['session_token'], now=NOW, admin_config=ADMIN)

    def register(self, code, username):
        return self.call('register', {'username': username, 'password': PASSWORD, 'inviteCode': code,
                                     'role': 'owner', 'projKey': 'untrusted-root'})

    def assert_denied(self, operation):
        before = self.store.raw
        with self.assertRaises(auth.AuthError):
            operation()
        self.assertEqual(self.store.raw, before)

    def test_create_is_exact_city_idempotent_and_does_not_change_saved_fields(self):
        first = self.create(province='Original Province', distributedEmail='first@example.invalid')
        before = self.store.raw
        again = self.create(city=' Exact City ', province='Another Province', distributedEmail='second@example.invalid')
        self.assertTrue(again['reused'])
        self.assertEqual(first['project'], again['project'])
        self.assertEqual(first['invite'], again['invite'])
        self.assertEqual(first['cityWorkspace'], again['cityWorkspace'])
        self.assertEqual(self.store.raw, before)
        different = self.create(city='Exact City District')
        self.assertNotEqual(first['invite']['projKey'], different['invite']['projKey'])
        self.assertEqual(set(self.store.state['CITY_WORKSPACES']), {'Exact City', 'Exact City District'})

    def test_concurrent_create_commits_one_root_and_one_active_code(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: self.create(province='Province'), range(6)))
        self.assertEqual(len({r['invite']['code'] for r in results}), 1)
        self.assertEqual(len({r['project']['id'] for r in results}), 1)
        self.assertEqual(sum(not r['reused'] for r in results), 1)
        self.assertEqual(len(self.store.state['PROJECTS']), 1)
        self.assertEqual(len(self.store.state['INVITE_CODES']), 1)

    def test_real_file_transactions_serialize_city_creation_and_first_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            path.write_text(self.store.raw)
            factory = lambda: file_session(str(path), lambda: None)
            def create(_):
                with factory() as session:
                    return admin_invites.manage_invite({'action': 'create', 'city': 'File City'}, session,
                        token=self.admin['session_token'], now=NOW, admin_config=ADMIN)
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(create, range(4)))
            self.assertEqual(len({r['invite']['code'] for r in results}), 1)
            code = results[0]['invite']['code']
            def register(number):
                return auth.handle_auth('register', {'username': 'file-' + str(number),
                    'password': PASSWORD, 'inviteCode': code}, factory, now=NOW, admin_config=ADMIN)
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                members = list(pool.map(register, range(4)))
            state = json.loads(path.read_text())
            self.assertEqual(len(state['PROJECTS']), 1)
            self.assertEqual(sum(r['auth']['role'] == 'owner' for r in members), 1)
            self.assertEqual(len(state['USER_PROFILES']), 4)
            self.assertIn(state['CITY_WORKSPACES']['File City']['ownerUser'], state['USER_PROFILES'])

    def test_concurrent_registration_claims_one_owner_and_keeps_other_members(self):
        created = self.create()
        code, key = created['invite']['code'], created['project']['id']
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda i: self.register(code, 'member-' + str(i)), range(6)))
        owners = [r for r in results if r['auth']['role'] == 'owner']
        self.assertEqual(len(owners), 1)
        self.assertEqual(self.store.state['CITY_WORKSPACES']['Exact City']['ownerUser'], owners[0]['auth']['user'])
        for result in results:
            self.assertEqual(result['auth']['projectKeys'], [key])
            self.assertEqual(allowed_project_keys(self.store.state, result['auth']), {key})
        first_owner = owners[0]['auth']['user']
        self.register(code, 'late-member')
        self.assertEqual(self.store.state['CITY_WORKSPACES']['Exact City']['ownerUser'], first_owner)

    def test_first_join_can_claim_owner_without_changing_old_default_membership(self):
        legacy = self.store.state
        legacy['INVITE_CODES']['OLD'] = {'city': 'Old City', 'projKey': 'old-root', 'role': 'member'}
        legacy['PROJECTS']['old-root'] = {'city': 'Old City', 'workspaceId': 'old-root'}
        self.store.replace(legacy)
        member = self.register('OLD', 'existing-member')
        created = self.create()
        joined = self.call('join', {'inviteCode': created['invite']['code']}, member['session_token'])
        self.assertEqual(joined['auth']['role'], 'owner')
        self.assertEqual(self.store.state['USER_PROFILES']['existing-member']['projKey'], 'old-root')
        admin_view = scoped_sync_view(self.store.state, self.admin['auth'])
        profile = admin_view['USER_PROFILES']['existing-member']
        self.assertEqual(set(profile['projectKeys']), {'old-root', created['project']['id']})
        self.assertNotIn('password_hash', profile)
        self.assertNotIn('inviteCode', json.dumps(profile))
        inactive = self.store.state
        inactive['USER_PROFILES']['existing-member']['memberships']['old-root']['active'] = False
        self.assertEqual(scoped_sync_view(inactive, self.admin['auth'])['USER_PROFILES']
                         ['existing-member']['projectKeys'], [created['project']['id']])
        again = self.call('join', {'inviteCode': created['invite']['code']}, member['session_token'])
        self.assertEqual(again['auth']['role'], 'owner')
        self.assertEqual(len(self.store.state['INVITE_CODES'][created['invite']['code']]['usedBy']), 1)

    def test_revoke_and_create_rotate_code_without_moving_owner_root_or_data(self):
        first = self.create(province='Province')
        owner = self.register(first['invite']['code'], 'owner')
        state = self.store.state
        state['PROJECTS'][first['project']['id']]['clues'] = [{'id': 'keep'}]
        self.store.replace(state)
        self.revoke(first['invite']['code'])
        before = self.store.state
        second = self.create(province='Ignored Province')
        self.assertTrue(second['reused'])
        self.assertEqual(second['project'], before['PROJECTS'][first['project']['id']])
        self.assertNotEqual(first['invite']['code'], second['invite']['code'])
        self.assertEqual(second['cityWorkspace']['ownerUser'], 'owner')
        self.assertEqual(second['cityWorkspace']['province'], 'Province')
        self.assert_denied(lambda: self.register(first['invite']['code'], 'blocked'))
        self.assertEqual(self.call('login', {'username': 'owner', 'password': PASSWORD})['auth']['role'], 'owner')
        self.assertEqual(self.register(second['invite']['code'], 'new-member')['auth']['role'], 'member')

    def test_canonical_activation_blocks_old_invite_without_adopting_old_project(self):
        state = self.store.state
        state['INVITE_CODES']['LEGACY'] = {'city': 'Exact City', 'projKey': 'legacy-root', 'role': 'owner'}
        state['PROJECTS']['legacy-root'] = {'city': 'Exact City', 'workspaceId': 'legacy-root'}
        self.store.replace(state)
        old = self.register('LEGACY', 'old-owner')
        created = self.create()
        self.assertNotEqual(created['project']['id'], 'legacy-root')
        self.assert_denied(lambda: self.register('LEGACY', 'late-legacy'))
        self.assert_denied(lambda: self.call('join', {'inviteCode': 'LEGACY'}, old['session_token']))
        restored = self.call('login', {'username': 'old-owner', 'password': PASSWORD})
        self.assertEqual(allowed_project_keys(self.store.state, restored['auth']), {'legacy-root'})

    def test_failed_commit_does_not_claim_owner_or_issue_new_city(self):
        self.store.fail = True
        self.assert_denied(lambda: self.create())
        self.store.fail = False
        created = self.create()
        self.store.fail = True
        self.assert_denied(lambda: self.register(created['invite']['code'], 'failed-owner'))
        self.store.fail = False
        self.assertIsNone(self.store.state['CITY_WORKSPACES']['Exact City']['ownerUser'])
        self.assertEqual(self.register(created['invite']['code'], 'real-owner')['auth']['role'], 'owner')

    def test_member_projection_contains_only_bound_city_and_no_invite(self):
        first, second = self.create(), self.create('Other City')
        member = self.register(first['invite']['code'], 'owner')
        view = scoped_sync_view(self.store.state, member['auth'])
        self.assertEqual(set(view['CITY_WORKSPACES']), {'Exact City'})
        self.assertNotIn('inviteCode', view['CITY_WORKSPACES']['Exact City'])
        self.assertNotIn(second['project']['id'], view['PROJECTS'])
        admin_view = scoped_sync_view(self.store.state, self.admin['auth'])
        self.assertEqual(admin_view['CITY_WORKSPACES']['Exact City']['inviteCode'], first['invite']['code'])

    def test_invalid_province_and_corrupt_registry_fail_without_writes(self):
        self.assert_denied(lambda: self.create(province='<invalid>'))
        self.assert_denied(lambda: self.create(province=5))
        state = self.store.state
        state['CITY_WORKSPACES'] = []
        self.store.replace(state)
        self.assert_denied(lambda: self.create())
        for malformed in (None, {}, {'projectKey': 'missing', 'inviteCode': 'BAD'}):
            state = self.store.state
            state['CITY_WORKSPACES'] = {'Exact City': malformed}
            self.store.replace(state)
            self.assert_denied(lambda: self.create())

    def test_sync_rejects_registry_forgery_stale_generation_and_root_adoption(self):
        created = self.create()
        member = self.register(created['invite']['code'], 'owner')
        state = self.store.state
        key = created['project']['id']
        for actor in (self.admin['auth'], member['auth']):
            for payload in ({'CITY_WORKSPACES': {}}, {'RESET_GEN': 'old', 'PROJECTS': {}},
                            {'PROJECTS': {}}, {'DELETED_PROJECTS': [key]},
                            {'PROJECTS': {key: {'city': 'Changed City'}}},
                            {'PROJECTS': {key: None}}, {'REPORTSTATE': {key: []}},
                            {'REPORT_PUBLICATIONS': {}}):
                value = dict(payload)
                if 'RESET_GEN' not in value and payload != {'PROJECTS': {}}:
                    value['RESET_GEN'] = 'current-generation'
                with self.subTest(actor=actor['scope'], payload=payload), self.assertRaises(auth.AuthError):
                    guard_sync(json.dumps(value).encode(), state, actor)
        self.assertEqual(self.store.state, state)

    def test_sync_preserves_published_base_but_allows_additional_material_and_clues(self):
        created = self.create()
        key = created['project']['id']
        member = self.register(created['invite']['code'], 'owner')
        state = self.store.state
        version = {'requestId': 'rr-new', 'requestedAt': NOW, 'publishedAt': NOW, 'scheduledMonth': '2030-03'}
        project = state['PROJECTS'][key]
        project.update(baseReportVersion=version, baseReportTopic='base topic',
                       reportRequestId='rr-new', reportFiles=[])
        project['kb'][0]['known'] = [{'text': 'published public base', 'nature': 'base'}]
        state['CITY_BASE_PACKAGES'] = {'Exact City': key}
        state['REPORTSTATE'] = {key: {'baseReportVersion': version, 'sourceReportId': 'rr-new',
            'text': 'base body', 'topic': 'base topic', 'aiReportByTopic': {'base topic': 'base body'}}}
        self.store.replace(state)
        changed = copy.deepcopy(project)
        changed['kb'][0]['known'].append({'text': 'private supplement', 'nature': 'support'})
        changed['clues'] = [{'id': 'new-clue'}]
        raw = json.dumps({'PROJECTS': {key: changed}, 'RESET_GEN': 'current-generation'}).encode()
        accepted = json.loads(guard_sync(raw, state, member['auth']))
        self.assertEqual(accepted['PROJECTS'][key]['clues'], [{'id': 'new-clue'}])
        for delta in ({'PROJECTS': {key: {'baseReportVersion': {}}}},
                      {'PROJECTS': {key: {'kb': []}}},
                      {'PROJECTS': {key: {'reportRequestId': 'rr-old'}}},
                      {'PROJECTS': {key: {'baseReportTopic': 'forged topic'}}},
                      {'REPORTSTATE': {key: {'sourceReportId': 'rr-old'}}},
                      {'REPORTSTATE': {key: {'aiReportByTopic': {}}}},
                      {'CITY_BASE_PACKAGES': {'Exact City': 'wrong'}}):
            with self.subTest(delta=delta), self.assertRaises(auth.AuthError):
                guard_sync(json.dumps(dict(delta, RESET_GEN='current-generation')).encode(), state, self.admin['auth'])
        from backend.sync_merge import _kb_item_fp
        fingerprint = _kb_item_fp(project['kb'][0]['known'][0])
        with self.assertRaises(auth.AuthError):
            guard_sync(json.dumps({'KB_ITEM_TOMBS': {key: {'0': {fingerprint: NOW}}},
                                   'RESET_GEN': 'current-generation'}).encode(), state, member['auth'])

    def test_scoped_persist_omits_other_city_package_without_failing(self):
        first, second = self.create(), self.create('Other City')
        member = self.register(first['invite']['code'], 'member')
        state = self.store.state
        own_key, other_key = first['project']['id'], second['project']['id']
        state['CITY_BASE_PACKAGES'] = {'Exact City': own_key, 'Other City': other_key}
        projected = scoped_sync_view(state, member['auth'])
        self.assertEqual(projected['CITY_BASE_PACKAGES'], {'Exact City': own_key})
        payload = {field: projected[field] for field in
                   ('PROJECTS', 'CITY_BASE_PACKAGES', 'RESET_GEN')}
        accepted = json.loads(guard_sync(json.dumps(payload).encode(), state, member['auth']))
        self.assertIn(own_key, accepted['PROJECTS'])
        forged = copy.deepcopy(payload)
        forged['CITY_BASE_PACKAGES']['Other City'] = own_key
        with self.assertRaises(auth.AuthError):
            guard_sync(json.dumps(forged).encode(), state, member['auth'])
        # Even an administrator cannot replace an explicitly supplied binding.
        with self.assertRaises(auth.AuthError):
            guard_sync(json.dumps(forged).encode(), state, self.admin['auth'])

    def test_direction_switch_can_save_display_state_without_replacing_base_slots(self):
        created = self.create()
        member = self.register(created['invite']['code'], 'owner')
        key, base, custom = created['project']['id'], '城市基础方向', '自定义产业方向'
        state = self.store.state
        version = {'requestId': 'rr-new', 'requestedAt': NOW, 'publishedAt': NOW,
                   'scheduledMonth': '2030-03'}
        state['PROJECTS'][key].update(baseReportVersion=version, baseReportTopic=base,
                                     reportRequestId='rr-new', reportFiles=[], topic=base)
        state['REPORT_REQUESTS'] = [{'id': 'rr-new', 'projKey': key}]
        state['REPORTSTATE'] = {key: {'sourceReportId': 'rr-new', 'baseReportVersion': version,
            'text': '原始基础报告', 'topic': base, 'phase': 'done', 'ts': 100,
            'aiReportByTopic': {base: '原始基础报告'}, 'phaseByTopic': {base: 'done'},
            'tsByTopic': {base: 100}}}
        projected = scoped_sync_view(state, member['auth'])
        projected['PROJECTS'][key]['topic'] = custom
        switched = projected['REPORTSTATE'][key]
        switched.update(text='自定义方向新 AI 报告', topic=custom, phase='done', ts=200,
                        score=78, scoreStatus='ready')
        switched['aiReportByTopic'][custom] = switched['text']
        switched['phaseByTopic'][custom] = 'done'
        switched['tsByTopic'][custom] = 200
        payload = {field: projected[field] for field in ('PROJECTS', 'REPORTSTATE', 'RESET_GEN')}
        accepted = json.loads(guard_sync(json.dumps(payload).encode(), state, member['auth']))
        self.assertEqual(accepted['REPORTSTATE'][key]['topic'], custom)
        self.assertEqual(accepted['PROJECTS'][key]['topic'], custom)
        self.assertEqual(accepted['REPORTSTATE'][key]['aiReportByTopic'][base], '原始基础报告')
        # Persist again after the server's current display topic has changed.
        after = copy.deepcopy(state)
        after['PROJECTS'][key] = accepted['PROJECTS'][key]
        after['REPORTSTATE'][key] = accepted['REPORTSTATE'][key]
        guard_sync(json.dumps(payload).encode(), after, member['auth'])
        for field, replacement in (('aiReportByTopic', '篡改基础报告'),
                                   ('phaseByTopic', 'generating'), ('tsByTopic', 999)):
            tampered = copy.deepcopy(payload)
            tampered['REPORTSTATE'][key][field][base] = replacement
            with self.subTest(field=field), self.assertRaises(auth.AuthError):
                guard_sync(json.dumps(tampered).encode(), after, member['auth'])
        for field in ('sourceReportId', 'baseReportVersion'):
            tampered = copy.deepcopy(payload)
            tampered['REPORTSTATE'][key][field] = 'forged'
            with self.subTest(field=field), self.assertRaises(auth.AuthError):
                guard_sync(json.dumps(tampered).encode(), after, member['auth'])

    def test_missing_province_stays_empty_and_schedule_is_recorded(self):
        created = self.create()
        record = created['cityWorkspace']
        self.assertEqual(record['province'], '')
        self.assertTrue(record['monthlyEnabled'])
        self.assertEqual(record['nextReportAt'], next_month_report_at(NOW))
        self.assertEqual(record['createdAt'], NOW * 1000)

    def test_registry_rejects_a_demand_or_foreign_owner_as_primary_root(self):
        created = self.create()
        initial = self.store.state
        for change in ({'isDemand': True}, {'workspaceId': 'other'}, {'city': 'Other City'}):
            state = copy.deepcopy(initial)
            state['PROJECTS'][created['project']['id']].update(change)
            self.store.replace(state)
            self.assert_denied(lambda: self.create())

    def test_unauthed_merge_fallback_refuses_stale_registry_overwrite(self):
        self.create()
        before = self.store.raw
        for payload in ({'CITY_WORKSPACES': {}}, {'PROJECTS': {}, 'RESET_GEN': 'old'}):
            handler = Mock(); handler.wfile = io.BytesIO()
            writes = []
            deps = SyncDependencies(True, lambda: before, lambda raw: writes.append(raw) or True,
                                    '', lambda: None, lambda value: value)
            handle_sync(handler, json.dumps(payload).encode(), deps)
            self.assertFalse(json.loads(handler.wfile.getvalue())['ok'])
            self.assertEqual(writes, [])

    def test_removed_owner_is_not_reassigned_by_later_registration(self):
        created = self.create()
        self.register(created['invite']['code'], 'owner')
        state = self.store.state
        state['USER_PROFILES']['owner']['memberships'][created['project']['id']]['active'] = False
        self.store.replace(state)
        self.assertEqual(self.register(created['invite']['code'], 'member')['auth']['role'], 'member')
        self.assertEqual(self.store.state['CITY_WORKSPACES']['Exact City']['ownerUser'], 'owner')


class MonthlyScheduleTests(unittest.TestCase):
    def test_next_month_is_first_day_nine_oclock_shanghai(self):
        for given, expected in [('2026-12-31T15:59:59+00:00', '2027-01-01T01:00:00+00:00'),
                                ('2028-02-29T04:00:00+00:00', '2028-03-01T01:00:00+00:00'),
                                ('2026-10-01T02:00:00+00:00', '2026-11-01T01:00:00+00:00')]:
            self.assertEqual(next_month_report_at(datetime.fromisoformat(given).timestamp()),
                             int(datetime.fromisoformat(expected).timestamp() * 1000))

    def test_invalid_schedule_clock_is_rejected(self):
        for value in (True, float('nan'), float('inf'), 'now'):
            with self.assertRaises(ValueError):
                next_month_report_at(value)
