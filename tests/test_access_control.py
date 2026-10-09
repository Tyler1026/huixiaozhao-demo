"""Offline workspace authorization and legacy-merge regression coverage."""
import copy
import io
import json
import unittest
from unittest.mock import Mock

from backend.access_control import (
    allowed_project_keys, authorize_project, guard_sync, scoped_sync_view,
)
from backend.auth import AuthError
from backend.sync_route import SyncDependencies, handle_sync


def principal(root='a', *, user='alice', role='member', roots=None):
    return {'scope': 'project', 'user': user, 'role': role, 'projKey': root,
            'projectKeys': list(roots or [root]), 'city': '同名市'}


ADMIN = {'scope': 'admin', 'user': 'operator', 'role': 'admin', 'projKey': None, 'projectKeys': []}


def fixture():
    return {
        'PROJECTS': {
            'a': {'id': 'a', 'city': '同名市', 'workspaceId': 'a', 'reportRequestId': 'rrlegacy'},
            'b': {'id': 'b', 'city': '同名市', 'workspaceId': 'b'},
            'a_child': {'id': 'a_child', 'city': '同名市', 'workspaceId': 'a', 'isDemand': True},
            'a_parented': {'id': 'a_parented', 'city': '同名市', 'parentKey': 'a'},
            'b_child': {'id': 'b_child', 'city': '同名市', 'workspaceId': 'b'},
            'ambiguous': {'id': 'ambiguous', 'city': '同名市', 'isDemand': True},
            'c': {'id': 'c', 'city': '唯一市'},
            'c_legacy': {'id': 'c_legacy', 'city': '唯一市', 'isDemand': True},
        },
        'INVITE_CODES': {
            'FIXTURE_A': {'projKey': 'a', 'city': '同名市', 'role': 'member'},
            'FIXTURE_B': {'projKey': 'b', 'city': '同名市', 'role': 'member', 'revoked': True},
            'FIXTURE_C': {'projKey': 'c', 'city': '唯一市', 'role': 'member'},
        },
        'USER_PROFILES': {
            'alice': {'name': 'Alice', 'phone': 'private-alice', 'projKey': 'a', 'role': 'member',
                      'pwd': 'private-plaintext', 'password_hash': 'private-hash'},
            'bob': {'name': 'Bob', 'phone': 'private-bob', 'projKey': 'b', 'role': 'owner'},
        },
        'CITY_ACCOUNTS': {'old': {'projKey': 'c', 'pwd': 'private-old'}},
        'AUTH_SESSIONS': {'private-token': {'user': 'alice', 'token': 'private-cookie'}},
        'REPORTSTATE': {'a_child': {'sourceReportId': 'rrstate', 'text': 'own report'},
                        'b': {'text': 'other report'}},
        'REPORT_REQUESTS': [
            {'id': 'rrown', 'city': '同名市', 'province': '省', 'status': 'pending',
             'projectKey': 'a', 'by': 'alice', 'engine': 'full-v1'},
            {'id': 'rrforeign', 'city': '同名市', 'status': 'done', 'projectKey': 'b'},
            {'id': 'rrlegacy', 'city': '同名市', 'status': 'done', 'files': []},
            {'id': 'rrstate', 'city': '同名市', 'status': 'done'},
            {'id': 'rrunbound', 'city': '同名市', 'status': 'done', 'by': 'alice'},
        ],
        'DEMANDS': [{'id': 'da', 'projKey': 'a_child', 'note': 'own'},
                    {'id': 'db', 'projKey': 'b_child', 'note': 'other'},
                    {'id': 'ambiguous-demand', 'city': '同名市'}],
        'KB_CHAT': {'workspace:a': {'sessions': [{'id': 'own', 'messages': []}]},
                    'workspace:b': {'sessions': [{'id': 'other', 'messages': []}]},
                    'a_child': {'sessions': []}, 'city:同名市': {'sessions': [{'id': 'ambiguous'}]}},
        'KB_CHAT_TOMBS': {'workspace:a::old': 1, 'workspace:b::other': 2, 'city:同名市::x': 3},
        'UPLOAD_TOMBS': {'a_child::own.docx': 1, 'b_child::other.docx': 2},
        'DELETED_PROJECTS': [], 'DELETED_CLUES': ['a_child::old', 'b_child::other'],
        'CITY_BASE_PACKAGES': {'同名市': 'b', '唯一市': 'c'},
        'OPS_ENT': [{'id': 'private-enterprise'}],
        'RAG_AUDIT': [{'question': 'private-other-question'}],
        'cur': 'b', 'view': 'home', 'syncTs': 123, 'RESET_GEN': 'generation-fixture',
        'unrelated_server_state': {'preserve': True},
    }


class AccessControlTests(unittest.TestCase):
    def setUp(self):
        self.state = fixture()
        self.actor = principal()

    def guard(self, payload, actor=None):
        return json.loads(guard_sync(json.dumps(payload).encode(), self.state, actor or self.actor))

    def denied(self, payload, actor=None):
        with self.assertRaises(AuthError) as failure:
            self.guard(payload, actor)
        self.assertEqual(failure.exception.status, 403)
        return failure.exception

    def test_same_city_different_invites_and_ambiguous_children_remain_isolated(self):
        self.assertEqual(allowed_project_keys(self.state, self.actor), {'a', 'a_child', 'a_parented'})
        view = scoped_sync_view(self.state, self.actor)
        self.assertEqual(set(view['PROJECTS']), {'a', 'a_child', 'a_parented'})
        self.assertEqual(view['cur'], 'a')
        self.assertEqual(authorize_project('a_child', self.state, self.actor), 'a_child')
        for key in ('b', 'b_child', 'ambiguous', 'missing'):
            with self.subTest(key=key), self.assertRaises(AuthError):
                authorize_project(key, self.state, self.actor)

    def test_unique_city_legacy_child_and_explicit_parent_chain_remain_compatible(self):
        actor = principal('c', user='carol')
        self.assertEqual(allowed_project_keys(self.state, actor), {'c', 'c_legacy'})
        self.state['PROJECTS']['grandchild'] = {'parentProjectKey': 'a_parented'}
        self.assertIn('grandchild', allowed_project_keys(self.state, self.actor))
        self.state['PROJECTS']['conflict'] = {'parentKey': 'a', 'parentProjKey': 'b'}
        self.state['PROJECTS']['cycle1'] = {'parentKey': 'cycle2'}
        self.state['PROJECTS']['cycle2'] = {'parentKey': 'cycle1'}
        self.assertTrue({'conflict', 'cycle1', 'cycle2'}.isdisjoint(allowed_project_keys(self.state, self.actor)))

    def test_member_project_projection_adds_canonical_legacy_owner_without_storage_mutation(self):
        self.state['PROJECTS']['grandchild'] = {'parentProjectKey': 'a_parented', 'topic': 'child topic'}
        original = copy.deepcopy(self.state)
        parent_view = scoped_sync_view(self.state, self.actor)
        for key in ('a', 'a_child', 'a_parented', 'grandchild'):
            self.assertEqual(parent_view['PROJECTS'][key]['workspaceId'], 'a')
        self.assertEqual(parent_view['PROJECTS']['grandchild']['topic'], 'child topic')
        unique_view = scoped_sync_view(self.state, principal('c', user='carol'))
        self.assertEqual(unique_view['PROJECTS']['c']['workspaceId'], 'c')
        self.assertEqual(unique_view['PROJECTS']['c_legacy']['workspaceId'], 'c')
        self.assertEqual(self.state, original)
        admin_view = scoped_sync_view(self.state, ADMIN)
        self.assertNotIn('workspaceId', admin_view['PROJECTS']['a_parented'])
        self.assertNotIn('workspaceId', admin_view['PROJECTS']['c_legacy'])

    def test_canonical_projection_does_not_assign_ambiguous_or_foreign_legacy_projects(self):
        self.state['PROJECTS']['cross-parent'] = {'parentKey': 'a', 'parentProjKey': 'b'}
        self.state['PROJECTS']['wrong-explicit-owner'] = {'city': '唯一市', 'workspaceId': 'b'}
        for actor in (self.actor, principal('c', user='carol')):
            view = scoped_sync_view(self.state, actor)
            self.assertTrue({'ambiguous', 'cross-parent', 'wrong-explicit-owner'}.isdisjoint(view['PROJECTS']))
            for project in view['PROJECTS'].values():
                self.assertIn(project['workspaceId'], actor['projectKeys'])

    def test_explicit_foreign_or_invalid_workspace_never_falls_back_to_city(self):
        self.state['PROJECTS']['c_wrong'] = {'city': '唯一市', 'workspaceId': 'b'}
        self.state['PROJECTS']['c_broken'] = {'city': '唯一市', 'workspaceId': 'missing-root'}
        self.state['PROJECTS']['a']['workspaceId'] = 'b'
        self.assertNotIn('a', allowed_project_keys(self.state, self.actor))
        self.assertTrue({'c_wrong', 'c_broken'}.isdisjoint(allowed_project_keys(self.state, principal('c'))))
        self.denied({'PROJECTS': {'new': {}}})
        self.denied({'REPORT_REQUESTS': [{'id': 'rrnew', 'status': 'pending'}]})

    def test_role_claim_does_not_grant_global_admin(self):
        spoofed = principal(role='admin')
        self.assertNotIn('b', allowed_project_keys(self.state, spoofed))
        self.denied({'PROJECTS': {'b': {'topic': 'changed'}}}, spoofed)
        self.denied({'role': 'admin'})
        self.denied({'scope': 'admin'})
        self.denied({'projectKeys': ['a', 'b']})

    def test_view_is_deep_copy_and_never_returns_credentials_or_other_members(self):
        original = copy.deepcopy(self.state)
        self.state['PROJECTS']['a']['nested'] = {
            'password': 'private-nested', 'access_token': 'private-access',
            'safe': 'kept', 'cachedSync': {'USER_PROFILES': self.state['USER_PROFILES']},
        }
        original = copy.deepcopy(self.state)
        view = scoped_sync_view(self.state, self.actor)
        encoded = json.dumps(view)
        for secret in ('private-plaintext', 'private-hash', 'private-cookie', 'private-nested',
                       'private-access', 'private-bob', 'private-other-question'):
            self.assertNotIn(secret, encoded)
        self.assertNotIn('INVITE_CODES', view)
        self.assertNotIn('CITY_ACCOUNTS', view)
        self.assertNotIn('AUTH_SESSIONS', view)
        self.assertEqual(set(view['USER_PROFILES']), {'alice'})
        self.assertEqual(view['PROJECTS']['a']['nested'], {'safe': 'kept'})
        view['PROJECTS']['a']['city'] = 'modified-view'
        self.assertEqual(self.state, original)

    def test_admin_view_retains_business_data_but_removes_nested_secrets_and_caches(self):
        self.state['extra'] = {'passwordHash': 'private-hash2', 'token': 'private-token2', 'normal': 7}
        self.state['jsonCache'] = json.dumps({'password_hash': 'private-hash3', 'normal': 8})
        view = scoped_sync_view(self.state, ADMIN)
        self.assertEqual(set(view['PROJECTS']), set(self.state['PROJECTS']))
        self.assertIn('INVITE_CODES', view)
        self.assertEqual(view['extra'], {'normal': 7})
        self.assertEqual(json.loads(view['jsonCache']), {'normal': 8})
        self.assertNotIn('AUTH_SESSIONS', view)
        self.assertNotIn('private-hash', json.dumps(view))
        self.assertNotIn('private-old', json.dumps(view))

    def test_owner_sees_minimal_current_root_roster_and_keeps_own_safe_profile(self):
        self.state['USER_PROFILES']['alice']['memberships'] = {
            'a': {'role': 'owner'}, 'b': {'role': 'member'}}
        self.state['USER_PROFILES']['colleague'] = {
            'name': 'Colleague', 'phone': 'private-colleague-phone', 'wechat': 'private-wechat',
            'password_hash': 'private-colleague-hash', 'projKey': 'b',
            'memberships': {'a': {'role': 'member', 'inviteCode': 'private-code'},
                            'b': {'role': 'owner'}},
        }
        self.state['CITY_ACCOUNTS'][' Resident '] = {
            'name': 'Legacy resident', 'projKey': 'a', 'role': 'owner',
            'pwd': 'private-resident-password', 'phone': 'private-resident-phone',
        }
        original = copy.deepcopy(self.state)
        view = scoped_sync_view(self.state, principal(role='owner', roots=['a', 'b']))
        profiles = view['USER_PROFILES']
        self.assertEqual(set(profiles), {'alice', 'colleague', 'resident'})
        self.assertEqual(profiles['colleague'], {
            'user': 'colleague', 'name': 'Colleague', 'projKey': 'a', 'role': 'member'})
        self.assertEqual(profiles['resident'], {
            'user': 'resident', 'name': 'Legacy resident', 'projKey': 'a', 'role': 'owner'})
        self.assertEqual(set(profiles['alice']['memberships']), {'a', 'b'})
        self.assertEqual(profiles['alice']['phone'], 'private-alice')
        self.assertNotIn('CITY_ACCOUNTS', view)
        for secret in ('private-colleague-phone', 'private-wechat', 'private-colleague-hash',
                       'private-code', 'private-resident-phone', 'private-resident-password'):
            self.assertNotIn(secret, json.dumps(view))
        profiles['colleague']['name'] = 'changed locally'
        self.assertEqual(self.state, original)

    def test_owner_roster_hides_other_roots_disabled_and_explicitly_empty_memberships(self):
        records = self.state['USER_PROFILES']
        records['other-root'] = {'projKey': 'b', 'city': '同名市', 'memberships': {'b': {'role': 'member'}}}
        records['empty'] = {'projKey': 'a', 'memberships': {}}
        records['removed'] = {'projKey': 'a', 'memberships': {'a': {'role': 'member', 'active': False}}}
        records['disabled-account'] = {'projKey': 'a', 'disabled': True,
                                       'memberships': {'a': {'role': 'member'}}}
        records['inactive-account'] = {'projKey': 'a', 'status': 'inactive',
                                       'memberships': {'a': {'role': 'owner'}}}
        records['legacy-same-city'] = {'projKey': 'b', 'city': '同名市'}
        profiles = scoped_sync_view(self.state, principal(role='owner', roots=['a', 'b']))['USER_PROFILES']
        self.assertEqual(set(profiles), {'alice'})

    def test_member_cannot_view_roster_when_owner_of_an_inactive_other_root(self):
        self.state['USER_PROFILES']['colleague'] = {'projKey': 'a', 'role': 'member'}
        self.state['USER_PROFILES']['alice']['memberships'] = {
            'a': {'role': 'member'}, 'b': {'role': 'owner'}}
        view = scoped_sync_view(self.state, principal(role='member', roots=['a', 'b']))
        self.assertEqual(set(view['USER_PROFILES']), {'alice'})

    def test_ambiguous_account_names_are_not_merged_or_projected(self):
        self.state['USER_PROFILES']['coworker'] = {'name': 'first-private', 'projKey': 'a'}
        self.state['CITY_ACCOUNTS'][' COWORKER '] = {'name': 'second-private', 'projKey': 'b'}
        self.state['CITY_ACCOUNTS'][' ALICE '] = {'name': 'different-private-alice', 'projKey': 'b'}
        profiles = scoped_sync_view(self.state, principal(role='owner')).get('USER_PROFILES', {})
        self.assertNotIn('coworker', profiles)
        self.assertNotIn('alice', profiles)
        self.assertNotIn('private', json.dumps(profiles))

    def test_project_owner_roster_is_still_readonly_under_generic_sync(self):
        self.denied({'USER_PROFILES': {'colleague': {'projKey': 'a', 'role': 'member'}}},
                    principal(role='owner'))

    def test_only_workspace_chats_and_their_tombstones_are_visible(self):
        view = scoped_sync_view(self.state, self.actor)
        self.assertEqual(set(view['KB_CHAT']), {'workspace:a', 'a_child'})
        self.assertEqual(view['KB_CHAT_TOMBS'], {'workspace:a::old': 1})
        self.denied({'KB_CHAT': {'city:同名市': {'sessions': []}}})
        self.denied({'KB_CHAT_TOMBS': {'city:同名市::anything': 1}})

    def test_report_visibility_requires_binding_or_exact_reference_not_city_or_author(self):
        view = scoped_sync_view(self.state, self.actor)
        self.assertEqual({r['id'] for r in view['REPORT_REQUESTS']}, {'rrown', 'rrlegacy', 'rrstate'})
        self.state['PROJECTS']['a']['reportRequestId'] = 'rrforeign'
        view = scoped_sync_view(self.state, self.actor)
        self.assertNotIn('rrforeign', {r['id'] for r in view['REPORT_REQUESTS']})
        self.denied({'REPORT_REQUESTS': [{'id': 'rrforeign', 'status': 'cancelled'}]})

    def test_new_project_is_bound_by_server_and_does_not_mutate_state(self):
        original = copy.deepcopy(self.state)
        value = self.guard({'PROJECTS': {'new': {'city': '同名市', 'isDemand': True}},
                            'REPORTSTATE': {'new': {'text': 'own'}}, 'cur': 'new'})
        self.assertEqual(value['PROJECTS']['new']['workspaceId'], 'a')
        self.assertEqual(value['PROJECTS']['new']['id'], 'new')
        self.assertEqual(value['REPORTSTATE']['new'], {'text': 'own'})
        self.assertEqual(self.state, original)

    def test_workspace_is_immutable_even_for_a_user_in_both_roots(self):
        actor = principal(roots=['a', 'b'])
        self.denied({'PROJECTS': {'a_child': {'workspaceId': 'b'}}}, actor)
        self.denied({'PROJECTS': {'new': {'workspaceId': 'b'}}}, actor)
        self.denied({'PROJECTS': {'new': {'parentKey': 'b'}}}, actor)
        self.denied({'PROJECTS': {'a': {'workspaceId': 'b'}}}, ADMIN)
        self.denied({'PROJECTS': {'a_child': {'id': 'b_child'}}})

    def test_client_cannot_claim_foreign_missing_or_tombstoned_project_ids(self):
        self.denied({'PROJECTS': {'b': {'city': '同名市'}}})
        self.state['INVITE_CODES']['RESERVED'] = {'projKey': 'reserved', 'city': '另市'}
        self.denied({'PROJECTS': {'reserved': {'city': '同名市'}}})
        self.state['DELETED_PROJECTS'] = ['deleted']
        self.denied({'PROJECTS': {'deleted': {'city': '同名市'}}})

    def test_new_project_cannot_claim_orphaned_report_or_upload_ids(self):
        self.state['REPORTSTATE']['orphan'] = {'text': 'unassigned private report',
                                                'sourceReportId': 'rrunbound'}
        self.denied({'PROJECTS': {'orphan': {'city': '同名市'}}})
        self.state['UPLOADS'] = {'orphan_upload': [{'text': 'unassigned upload'}]}
        self.denied({'PROJECTS': {'orphan_upload': {'city': '同名市'}}})
        self.state['REPORT_REQUESTS'].append({'id': 'rrorphan', 'projectKey': 'missing_project'})
        self.denied({'PROJECTS': {'missing_project': {'city': '同名市'}}})
        # A real membership may repair its own missing root without gaining others.
        del self.state['PROJECTS']['a']
        self.assertEqual(self.guard({'PROJECTS': {'a': {'city': '同名市'}}})['PROJECTS']['a']['workspaceId'], 'a')

    def test_new_child_parent_must_belong_to_the_same_workspace(self):
        result = self.guard({'PROJECTS': {'new': {'parentKey': 'a_child'}}})
        self.assertEqual(result['PROJECTS']['new']['workspaceId'], 'a')
        self.denied({'PROJECTS': {'new': {'parentKey': 'b_child'}}})
        self.denied({'PROJECTS': {'new': {'parentKey': []}}})

    def test_new_report_is_bound_to_active_root_and_author_is_server_supplied(self):
        result = self.guard({'REPORT_REQUESTS': [{'id': 'rrnew', 'status': 'pending',
                              'city': '同名市', 'province': '省', 'by': 'forged'}]})
        self.assertEqual(result['REPORT_REQUESTS'][0]['projectKey'], 'a')
        self.assertEqual(result['REPORT_REQUESTS'][0]['by'], 'alice')
        self.denied({'REPORT_REQUESTS': [{'id': 'rrnew', 'status': 'pending', 'projectKey': 'b'}]})
        self.denied({'REPORT_REQUESTS': [{'id': 'rrnew', 'status': 'done'}]})

    def test_member_can_cancel_own_report_but_cannot_forge_progress_or_delivery(self):
        result = self.guard({'REPORT_REQUESTS': [{'id': 'rrown', 'status': 'cancelled',
                                                 'files': [{'b64': 'fake'}], 'by': 'forged'}]})
        row = result['REPORT_REQUESTS'][0]
        self.assertEqual(row['status'], 'cancelled')
        self.assertEqual(row['by'], 'alice')
        self.assertNotIn('files', row)
        self.denied({'REPORT_REQUESTS': [{'id': 'rrown', 'status': 'done'}]})
        self.denied({'REPORT_REQUESTS': [{'id': 'rrown', 'status': 'pending', 'projectKey': 'b'}]})

    def test_changing_report_references_cannot_create_access_to_another_report(self):
        self.denied({'PROJECTS': {'a': {'reportRequestId': 'rrforeign'}}})
        self.denied({'REPORTSTATE': {'a_child': {'sourceReportId': 'rrunbound'}}})
        self.denied({'PROJECTS': {'new': {'reportRequestId': 'rrforeign'}}})
        result = self.guard({'PROJECTS': {'new': {'reportRequestId': 'rrnew'}},
                             'REPORT_REQUESTS': [{'id': 'rrnew', 'status': 'pending',
                                                  'city': '同名市', 'province': '省'}]})
        self.assertEqual(result['PROJECTS']['new']['reportRequestId'], 'rrnew')

    def test_account_invitation_and_session_fields_are_forbidden_for_all_roles(self):
        payloads = [{'USER_PROFILES': {}}, {'INVITE_CODES': {}}, {'CITY_ACCOUNTS': {}},
                    {'AUTH_SESSIONS': {}}, {'AUTH_USERS': {}},
                    {'PROJECTS': {'a': {'password_hash': 'private'}}},
                    {'PROJECTS': {'a': {'cache': {'token': 'private'}}}},
                    {'PROJECTS': {'a': {'cache': json.dumps({'pwd': 'private'})}}}]
        for actor in (self.actor, ADMIN):
            for payload in payloads:
                with self.subTest(scope=actor['scope'], payload=payload):
                    self.assertEqual(self.denied(payload, actor).code, 'protected_field')

    def test_nested_legacy_wrapper_and_nested_server_snapshot_are_rejected(self):
        for actor in (self.actor, ADMIN):
            for payload in ({'huixiaozhao_kb_v1': {'PROJECTS': {}}},
                            {'PROJECTS': {'a': {'nested': {'PROJECTS': {'b': {}}}}}}):
                with self.subTest(scope=actor['scope']):
                    self.denied(payload, actor)

    def test_authorized_maps_and_composite_tombstones_preserve_foreign_entries(self):
        for field in ('UPLOADS', 'KB_FILE_CHUNKS', 'KB_CONFIRMS', 'KB_CONFIRM_TOMBS',
                      'KB_ITEM_TOMBS', 'KB_UNLOCKED', 'PENDING_CONFIRMS', 'DOCK_LOGS', 'REPORT_HISTORY'):
            self.state[field] = {'a_child': {'old': 1}, 'b_child': {'foreign': 2}}
        payload = {field: {'a_child': {'new': 3}} for field in (
            'UPLOADS', 'KB_FILE_CHUNKS', 'KB_CONFIRMS', 'KB_CONFIRM_TOMBS', 'KB_ITEM_TOMBS',
            'KB_UNLOCKED', 'PENDING_CONFIRMS', 'DOCK_LOGS', 'REPORT_HISTORY')}
        payload.update(UPLOAD_TOMBS={'a_child::new.docx': 3},
                       KB_CHAT_TOMBS={'workspace:a::new': 3},
                       DELETED_CLUES=['a_child::new'])
        result = self.guard(payload)
        for field in payload.keys() - {'DELETED_CLUES', 'UPLOAD_TOMBS', 'KB_CHAT_TOMBS'}:
            self.assertEqual(result[field]['b_child'], {'foreign': 2})
            self.assertEqual(result[field]['a_child'], {'new': 3})
        self.assertEqual(result['UPLOAD_TOMBS']['b_child::other.docx'], 2)
        self.assertEqual(result['KB_CHAT_TOMBS']['workspace:b::other'], 2)
        self.denied({'DOCK_LOGS': {'b_child': []}})
        self.denied({'UPLOAD_TOMBS': {'b_child::file': 1}})
        self.denied({'DELETED_PROJECTS': ['b_child']})

    def test_demand_ids_cannot_be_stolen_and_omission_does_not_delete_foreign_or_own_rows(self):
        result = self.guard({'DEMANDS': [{'id': 'newdemand', 'projKey': 'a_child', 'note': 'new'}]})
        self.assertEqual({r['id'] for r in result['DEMANDS']}, {'da', 'db', 'ambiguous-demand', 'newdemand'})
        self.denied({'DEMANDS': [{'id': 'db', 'projKey': 'a_child'}]})
        self.denied({'DEMANDS': [{'id': 'new', 'projKey': 'b_child'}]})
        self.denied({'DEMANDS': [{'id': 'new', 'city': '同名市'}]})
        self.denied({'DEMANDS': [{'id': 'new', 'projKey': []}]})

    def test_explicit_authorized_project_deletion_removes_only_its_own_demands(self):
        result = self.guard({'DELETED_PROJECTS': ['a_child'], 'DEMANDS': []})
        self.assertEqual({r['id'] for r in result['DEMANDS']}, {'db', 'ambiguous-demand'})

    def test_foreign_server_state_survives_the_actual_legacy_sync_merge(self):
        self.state['DOCK_LOGS'] = {'b_child': [{'note': 'keep foreign'}]}
        self.state['KB_CONFIRMS'] = {'b': {'keep': True}}
        payload = {'PROJECTS': {'a_child': {'topic': 'updated'}},
                   'DOCK_LOGS': {'a_child': [{'note': 'own'}]},
                   'KB_CONFIRMS': {'a_child': {'confirmed': True}},
                   'DEMANDS': [{'id': 'da', 'projKey': 'a_child', 'note': 'updated'}],
                   'RESET_GEN': 'generation-fixture'}
        guarded = guard_sync(json.dumps(payload).encode(), self.state, self.actor)
        write = Mock(return_value=True)
        handler = Mock()
        handler.wfile = io.BytesIO()
        deps = SyncDependencies(True, lambda: json.dumps(self.state), write, '', lambda: None, lambda value: value)
        handle_sync(handler, guarded, deps)
        self.assertTrue(json.loads(handler.wfile.getvalue())['ok'])
        saved = json.loads(write.call_args.args[0])
        self.assertEqual(saved['DOCK_LOGS']['b_child'], [{'note': 'keep foreign'}])
        self.assertEqual(saved['KB_CONFIRMS']['b'], {'keep': True})
        self.assertEqual(saved['USER_PROFILES'], self.state['USER_PROFILES'])
        self.assertEqual(saved['AUTH_SESSIONS'], self.state['AUTH_SESSIONS'])
        self.assertEqual(saved['unrelated_server_state'], {'preserve': True})
        self.assertEqual(saved['DEMANDS'][1], self.state['DEMANDS'][1])

    def test_readonly_global_echoes_are_ignored_but_mutations_are_refused(self):
        result = self.guard({'OPS_ENT': [], 'CITY_BASE_PACKAGES': {}, 'clientUser': 'alice'})
        self.assertEqual(result, {})
        self.denied({'OPS_ENT': [{'id': 'forged'}]})
        self.denied({'CITY_BASE_PACKAGES': {'同名市': 'a'}})
        self.denied({'clientUser': 'bob'})
        self.denied({'cur': 'b'})
        self.denied({'cur': []})
        self.denied({'RESET_GEN': 'forged'})

    def test_admin_business_delta_is_compatible_and_unknown_principals_are_refused(self):
        delta = {'PROJECTS': {'b': {'topic': 'operator change'}}, 'OPS_ENT': [],
                 'operator_business_setting': {'enabled': True}}
        self.assertEqual(self.guard(delta, ADMIN), delta)
        self.assertEqual(allowed_project_keys(self.state, ADMIN), set(self.state['PROJECTS']))
        for actor in ({}, {'scope': 'owner'}, {'scope': 'project', 'role': 'admin', 'projectKeys': []}):
            with self.subTest(actor=actor), self.assertRaises(AuthError):
                guard_sync(b'{"PROJECTS":{"new":{}}}', self.state, actor)


if __name__ == '__main__':
    unittest.main()
