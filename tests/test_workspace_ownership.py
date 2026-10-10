"""New invitations cannot adopt unassigned legacy data by a matching city.

This exercises real in-memory admin invitation, registration and login flows.
No network, production snapshot or persistent storage is used.
"""
import copy
import json
import unittest

from backend import admin_invites, auth
from backend.access_control import (
    PROJECT_MAP_FIELDS, allowed_project_keys, authorize_project, guard_sync,
    scoped_sync_view,
)


NOW = 1_900_000_000
PASSWORD = 'offline-ownership-regression-password'
ADMIN_CONFIG = auth.AdminConfig('ownership-operator', PASSWORD)
LEGACY_KEY = 'legacy-minhang'


class MemorySession:
    def __init__(self, state):
        self.raw = json.dumps(state, ensure_ascii=False)

    def read(self):
        return self.raw

    def write(self, raw):
        self.raw = raw
        return True

    @property
    def state(self):
        return json.loads(self.raw)


def legacy_state():
    state = {
        'PROJECTS': {
            LEGACY_KEY: {'id': LEGACY_KEY, 'city': '闵行区',
                         'kb': [{'t': '客户资料', 'known': ['private-legacy-material']}],
                         'reportRequestId': 'legacy-report'},
        },
        'USER_PROFILES': {}, 'CITY_ACCOUNTS': {}, 'INVITE_CODES': {},
        'REPORT_REQUESTS': [
            {'id': 'legacy-report', 'status': 'running', 'projectKey': LEGACY_KEY},
            {'id': 'legacy-exact-reference', 'status': 'done'},
        ],
        'DEMANDS': [{'id': 'legacy-demand', 'projKey': LEGACY_KEY, 'note': 'private-demand'}],
        'KB_CHAT': {LEGACY_KEY: {'messages': ['private-chat']}},
        'UPLOAD_TOMBS': {LEGACY_KEY + '::private-file': 1},
        'KB_CHAT_TOMBS': {LEGACY_KEY + '::private-chat': 1},
        'DELETED_PROJECTS': [LEGACY_KEY],
        'DELETED_CLUES': [LEGACY_KEY + '::private-clue'],
    }
    for field in PROJECT_MAP_FIELDS - {'PROJECTS'}:
        state[field] = {LEGACY_KEY: {'private': field}}
    state['REPORTSTATE'][LEGACY_KEY]['sourceReportId'] = 'legacy-exact-reference'
    return state


class WorkspaceOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.session = MemorySession(legacy_state())
        login = auth.login({'username': ADMIN_CONFIG.username, 'password': PASSWORD},
                           self.session, admin_config=ADMIN_CONFIG, now=NOW)
        self.admin_token = login['session_token']
        self.admin = login['auth']
        created = admin_invites.manage_invite(
            {'action': 'create', 'city': '闵行区'}, self.session,
            token=self.admin_token, admin_config=ADMIN_CONFIG, now=NOW)
        self.code = created['invite']['code']
        self.root = created['invite']['projKey']
        registered = auth.register(
            {'username': 'new-member', 'password': PASSWORD, 'inviteCode': self.code,
             'name': '离线测试成员'}, self.session, admin_config=ADMIN_CONFIG, now=NOW)
        self.member_token = registered['session_token']
        self.member = auth.require_session({}, self.session.state, token=self.member_token,
                                           admin_config=ADMIN_CONFIG, now=NOW)

    def test_first_same_city_invite_exposes_only_its_own_root_and_keeps_admin_legacy_view(self):
        state = self.session.state
        before = copy.deepcopy(state)
        self.assertEqual(allowed_project_keys(state, self.member), {self.root})
        view = scoped_sync_view(state, self.member)
        self.assertEqual(set(view['PROJECTS']), {self.root})
        for field in PROJECT_MAP_FIELDS - {'PROJECTS'}:
            self.assertNotIn(LEGACY_KEY, view.get(field, {}))
        for field in ('DEMANDS', 'REPORT_REQUESTS', 'DELETED_PROJECTS', 'DELETED_CLUES'):
            self.assertEqual(view[field], [])
        for field in ('KB_CHAT', 'UPLOAD_TOMBS', 'KB_CHAT_TOMBS'):
            self.assertEqual(view[field], {})
        self.assertNotIn('private-', json.dumps(view))
        with self.assertRaises(auth.AuthError) as failure:
            authorize_project(LEGACY_KEY, state, self.member)
        self.assertEqual(failure.exception.status, 403)
        admin_view = scoped_sync_view(state, self.admin)
        self.assertEqual(admin_view['PROJECTS'][LEGACY_KEY], state['PROJECTS'][LEGACY_KEY])
        self.assertNotIn('workspaceId', admin_view['PROJECTS'][LEGACY_KEY])
        self.assertEqual(state, before)
        self.assertEqual(self.session.state, before)

    def test_member_cannot_write_legacy_projects_reports_attachments_or_claim_their_references(self):
        state = self.session.state
        before = copy.deepcopy(state)
        payloads = [
            {'PROJECTS': {LEGACY_KEY: {'workspaceId': self.root, 'city': '闵行区'}}},
            {'PROJECTS': {self.root: {'reportRequestId': 'legacy-report'}}},
            {'PROJECTS': {'new-child': {'parentKey': LEGACY_KEY}}},
            {'PROJECTS': {'new-child': {'sourceReportId': 'legacy-exact-reference'}}},
            {'REPORT_REQUESTS': [{'id': 'legacy-report', 'status': 'cancelled'}]},
            {'REPORT_REQUESTS': [{'id': 'legacy-exact-reference', 'status': 'cancelled'}]},
            {'DEMANDS': [{'id': 'legacy-demand', 'projKey': LEGACY_KEY}]},
            {'KB_CHAT': {LEGACY_KEY: {'messages': []}}},
            {'UPLOAD_TOMBS': {LEGACY_KEY + '::private-file': 2}},
            {'KB_CHAT_TOMBS': {LEGACY_KEY + '::private-chat': 2}},
            {'DELETED_PROJECTS': [LEGACY_KEY]},
            {'DELETED_CLUES': [LEGACY_KEY + '::private-clue']},
        ]
        payloads.extend({field: {LEGACY_KEY: {}}}
                        for field in PROJECT_MAP_FIELDS - {'PROJECTS'})
        for payload in payloads:
            with self.subTest(field=next(iter(payload))), self.assertRaises(auth.AuthError) as failure:
                guard_sync(json.dumps(payload).encode(), state, self.member)
            self.assertEqual(failure.exception.status, 403)
            self.assertEqual(state, before)
        self.assertEqual(self.session.state, before)

    def test_member_can_write_own_root_create_bound_child_and_submit_own_report(self):
        state = self.session.state
        before = copy.deepcopy(state)
        delta = {
            'PROJECTS': {self.root: {'topic': '本工作区资料'},
                         'own-child': {'parentKey': self.root, 'city': '闵行区', 'isDemand': True}},
            'UPLOADS': {self.root: [{'name': 'own-material.txt'}]},
            'REPORTSTATE': {'own-child': {'text': 'own-report'}},
            'REPORT_REQUESTS': [{'id': 'own-request', 'city': '闵行区', 'status': 'pending'}],
        }
        guarded = json.loads(guard_sync(json.dumps(delta).encode(), state, self.member))
        for key in (self.root, 'own-child'):
            self.assertEqual(guarded['PROJECTS'][key]['workspaceId'], self.root)
        self.assertEqual(guarded['REPORT_REQUESTS'][0]['projectKey'], self.root)
        self.assertEqual(guarded['REPORT_REQUESTS'][0]['by'], 'new-member')
        self.assertEqual(guarded['UPLOADS'][self.root], delta['UPLOADS'][self.root])
        # This internal merge input preserves foreign rows; it is never returned to the client.
        self.assertEqual(guarded['UPLOADS'][LEGACY_KEY], state['UPLOADS'][LEGACY_KEY])
        self.assertEqual(state, before)

    def test_explicit_legacy_account_root_and_parent_chain_remain_authorized(self):
        state = self.session.state
        state['CITY_ACCOUNTS']['legacy-account'] = {
            'projKey': LEGACY_KEY, 'city': '闵行区', 'pwd': PASSWORD, 'role': 'owner'}
        state['PROJECTS']['legacy-child'] = {'parentKey': LEGACY_KEY, 'city': '另一城市'}
        state['PROJECTS']['legacy-grandchild'] = {'parentProjectKey': 'legacy-child'}
        state['PROJECTS']['explicit-child'] = {'workspaceId': LEGACY_KEY, 'city': '另一城市'}
        state['PROJECTS']['unassigned-neighbor'] = {'city': '闵行区'}
        self.session.write(json.dumps(state))
        login = auth.login({'username': 'legacy-account', 'password': PASSWORD}, self.session,
                           admin_config=ADMIN_CONFIG, now=NOW)
        actor = auth.require_session({}, self.session.state, token=login['session_token'],
                                     admin_config=ADMIN_CONFIG, now=NOW)
        self.assertEqual(allowed_project_keys(self.session.state, actor), {
            LEGACY_KEY, 'legacy-child', 'legacy-grandchild', 'explicit-child'})
        self.assertNotIn('unassigned-neighbor', scoped_sync_view(self.session.state, actor)['PROJECTS'])
        self.assertEqual(allowed_project_keys(self.session.state, self.member), {self.root})
        self.assertIn('unassigned-neighbor', scoped_sync_view(self.session.state, self.admin)['PROJECTS'])


if __name__ == '__main__':
    unittest.main()
