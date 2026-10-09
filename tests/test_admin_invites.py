"""Offline invitation transactions and membership authority regressions.

Every privileged operation uses a real server-created authentication session.
The serialized store is in memory; no network or production state is touched.
"""
import contextlib
import copy
import io
import json
import threading
import unittest
from unittest.mock import patch

from backend import admin_invites, auth, auth_routes
from backend.access_control import allowed_project_keys, scoped_sync_view


NOW = 1_900_000_000
PASSWORD = 'offline-invitation-test-password'
ADMIN = auth.AdminConfig('offline-operator', PASSWORD)


class MemoryStore:
    def __init__(self, state):
        self.raw = json.dumps(state, ensure_ascii=False)
        self.lock = threading.RLock()
        self.write_result = True
        self.raise_write = False
        self.writes = 0

    @property
    def state(self):
        return json.loads(self.raw)

    def replace(self, state):
        self.raw = json.dumps(state, ensure_ascii=False)

    @contextlib.contextmanager
    def factory(self):
        with self.lock:
            store = self

            class Session:
                def read(self):
                    return store.raw

                def write(self, raw):
                    store.writes += 1
                    if store.raise_write:
                        raise OSError('offline storage detail must not reach clients')
                    if store.write_result is not True:
                        return store.write_result
                    store.raw = raw
                    return True

            yield Session()


class Handler:
    def __init__(self, token=None):
        self.headers = {'Host': 'demo.test', 'Origin': 'https://demo.test'}
        if token:
            self.headers['Cookie'] = 'hxz_session=' + token
        self.wfile = io.BytesIO()
        self.response_headers = []
        self.status = None

    def send_response(self, status):
        self.status = status

    def send_header(self, key, value):
        self.response_headers.append((key, value))

    def cors(self):
        pass

    def end_headers(self):
        pass

    @property
    def body(self):
        return json.loads(self.wfile.getvalue())


class AdminInvitationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Hash once, but verify credentials and all opaque sessions normally.
        cls.password_hash = auth.hash_password(PASSWORD)

    def setUp(self):
        def account(name, memberships, default='root-a'):
            return {'name': name, 'phone': 'offline-private-phone',
                    'password_hash': self.password_hash, 'city': '同名市',
                    'projKey': default, 'role': 'member',
                    'memberships': {key: {'role': role, 'joinedAt': 10, 'city': '同名市'}
                                    for key, role in memberships.items()}}

        self.store = MemoryStore({
            'PROJECTS': {
                'root-a': {'id': 'root-a', 'workspaceId': 'root-a', 'city': '同名市'},
                'root-b': {'id': 'root-b', 'workspaceId': 'root-b', 'city': '同名市'},
            },
            'INVITE_CODES': {
                'TEAM_A': {'city': '同名市', 'projKey': 'root-a', 'role': 'member',
                           'revoked': False, 'usedBy': []},
                'TEAM_B': {'city': '同名市', 'projKey': 'root-b', 'role': 'member',
                           'revoked': False, 'usedBy': []},
            },
            'USER_PROFILES': {
                'owner-a': account('甲管理员', {'root-a': 'owner', 'root-b': 'member'}),
                'owner-b': account('乙管理员', {'root-b': 'owner'}, 'root-b'),
                'member': account('双团队成员', {'root-a': 'member', 'root-b': 'member'}),
                'member-only': account('单团队成员', {'root-a': 'member'}),
                'ordinary': account('普通成员', {'root-a': 'member'}),
            },
            'CITY_ACCOUNTS': {},
            'UNRELATED_SERVER_STATE': {'preserve': [1, 2, 3]},
        })

    def call_auth(self, operation, body=None, *, token=None, now=NOW):
        return auth.handle_auth(operation, body or {}, self.store.factory,
                                token=token, now=now, admin_config=ADMIN)

    def login(self, username='offline-operator'):
        return self.call_auth('login', {'username': username, 'password': PASSWORD})['session_token']

    def manage(self, body, *, token=None, headers=None, now=NOW, config=ADMIN):
        with self.store.factory() as session:
            return admin_invites.manage_invite(body, session, token=token, headers=headers,
                                               admin_config=config, now=now)

    def remove(self, user, *, key='root-a', token=None):
        with self.store.factory() as session:
            return admin_invites.remove_member({'action': 'remove', 'user': user, 'projKey': key},
                                               session, token=token, admin_config=ADMIN, now=NOW)

    def assert_error(self, status, code, function, *args, **kwargs):
        with self.assertRaises(auth.AuthError) as failure:
            function(*args, **kwargs)
        self.assertEqual((failure.exception.status, failure.exception.code), (status, code))
        return failure.exception

    def http(self, path, body, token):
        handler = Handler(token)
        with patch.object(auth, '_now', return_value=NOW):
            self.assertTrue(auth_routes.dispatch_auth(handler, 'POST', path,
                            json.dumps(body).encode(), self.store.factory, admin_config=ADMIN))
        return handler

    def test_create_requires_a_real_current_admin_session(self):
        ordinary = self.login('ordinary')
        before = self.store.raw
        for token in (None, 'forged-' * 8):
            self.assert_error(401, 'auth_required', self.manage,
                              {'action': 'create', 'city': '新城市'}, token=token)
        self.assert_error(403, 'admin_required', self.manage,
                          {'action': 'create', 'city': '新城市', 'scope': 'admin', 'role': 'admin'},
                          token=ordinary, headers={'X-Role': 'admin'})
        self.assertEqual(self.store.raw, before)

    def test_admin_cookie_create_saves_invite_and_separate_root_atomically(self):
        token = self.login()
        before = self.store.state
        result = self.manage({'action': 'create', 'city': '  同名市  '},
                             headers={'Cookie': 'hxz_session=' + token})
        invite, project = result['invite'], result['project']
        self.assertTrue(result['ok'])
        self.assertRegex(invite['code'], r'^[A-HJ-NP-Z2-9]{10}$')
        self.assertEqual(invite['city'], '同名市')
        self.assertEqual(invite['role'], 'member')
        self.assertEqual(invite['createdBy'], ADMIN.username)
        self.assertEqual(invite['createdAt'], NOW * 1000)
        self.assertEqual((invite['revoked'], invite['distributed'], invite['distributedEmail']),
                         (False, False, ''))
        self.assertEqual(invite['usedBy'], [])
        key = invite['projKey']
        self.assertNotIn(key, before['PROJECTS'])
        self.assertEqual((project['id'], project['workspaceId']), (key, key))
        self.assertEqual(len(project['kb']), 4)
        self.assertEqual(self.store.state['PROJECTS'][key], project)
        self.assertEqual(self.store.state['UNRELATED_SERVER_STATE'], before['UNRELATED_SERVER_STATE'])
        result['invite']['usedBy'].append({'user': 'local-mutation'})
        result['project']['kb'][0]['known'].append('local-mutation')
        self.assertEqual(self.store.state['INVITE_CODES'][invite['code']]['usedBy'], [])
        self.assertEqual(self.store.state['PROJECTS'][key]['kb'][0]['known'], [])

    def test_create_collision_retries_without_overwriting_existing_invite_or_root(self):
        token = self.login()
        state = self.store.state
        state['INVITE_CODES']['AAAAAAAAAA'] = {'city': '保留市', 'projKey': 'p' + 'a' * 24}
        state['PROJECTS']['p' + 'a' * 24] = {'keep': True}
        self.store.replace(state)
        with patch.object(admin_invites.secrets, 'choice', side_effect=list('A' * 10 + 'B' * 10)), \
                patch.object(admin_invites.secrets, 'token_hex', side_effect=['a' * 24, 'b' * 24]):
            result = self.manage({'action': 'create', 'city': '同名市'}, token=token)
        self.assertEqual(result['invite']['code'], 'BBBBBBBBBB')
        self.assertEqual(result['invite']['projKey'], 'p' + 'b' * 24)
        self.assertEqual(self.store.state['INVITE_CODES']['AAAAAAAAAA'], state['INVITE_CODES']['AAAAAAAAAA'])
        self.assertEqual(self.store.state['PROJECTS']['p' + 'a' * 24], {'keep': True})

    def test_same_city_separate_invites_register_into_isolated_workspaces(self):
        token = self.login()
        first = self.manage({'action': 'create', 'city': '同名市'}, token=token)
        second = self.manage({'action': 'create', 'city': '同名市'}, token=token)
        keys = [first['invite']['projKey'], second['invite']['projKey']]
        self.assertNotEqual(*keys)
        for number, result in enumerate((first, second)):
            registered = self.call_auth('register', {'username': 'new-' + str(number),
                'password': PASSWORD, 'inviteCode': result['invite']['code'],
                'role': 'owner', 'projKey': keys[1 - number]})
            actor = registered['auth']
            self.assertEqual(actor['projectKeys'], [keys[number]])
            self.assertEqual(actor['role'], 'member')
            self.assertEqual(allowed_project_keys(self.store.state, actor), {keys[number]})
            view = scoped_sync_view(self.store.state, actor)
            self.assertEqual(set(view['PROJECTS']), {keys[number]})
            self.assertNotIn('INVITE_CODES', view)

    def test_base_package_copies_only_material_into_distinct_root(self):
        token = self.login()
        state = self.store.state
        original = state['PROJECTS']['root-a']
        titles = ['主导产业与产业链', '园区与承载条件', '链主与存量企业', '政策、规划与领导关注']
        original['kb'] = [{'t': title, 'known': [{'text': 'material-' + str(i), 'nature': 'base'}]}
                          for i, title in enumerate(titles)]
        original.update(report='private-report', reportRequestId='private-request', clues=['private-clue'])
        state['CITY_BASE_PACKAGES'] = {'同名市': 'root-a'}
        self.store.replace(state)
        result = self.manage({'action': 'create', 'city': '同名市'}, token=token)
        self.assertEqual([section['t'] for section in result['project']['kb']], titles)
        self.assertEqual([[item['text'] for item in section['known']]
                          for section in result['project']['kb']],
                         [['material-' + str(i)] for i in range(4)])
        self.assertIsNone(result['project']['report'])
        self.assertNotIn('reportRequestId', result['project'])
        self.assertEqual(result['project']['clues'], [])
        self.assertEqual(self.store.state['PROJECTS']['root-a'], original)

    def test_city_base_inheritance_keeps_only_explicit_public_items_in_standard_topics(self):
        token = self.login()
        state = self.store.state
        titles = ['主导产业与产业链', '园区与承载条件', '链主与存量企业', '政策、规划与领导关注']
        sections = []
        for number, title in enumerate(titles):
            sections.append({
                't': title, 'icon': 'private-section-icon', 'sub': 'private-section-summary',
                'tag': 'private-section-tag', 'calls': ['private-section-call'],
                'known': [
                    {'text': 'public-base-' + str(number), 'nature': 'base', 'origin': 'ai',
                     'src': 'https://public.example.test/source-' + str(number),
                     'account': 'private-account', 'uploadId': 'private-upload-id',
                     'filePath': 'private-upload-path', 'annotations': ['private-annotation'],
                     'internal': {'text': 'private-nested-note'}},
                    {'text': 'private-item', 'nature': 'private'},
                    {'text': 'private-interview', 'nature': 'interview', 'src': 'private-interview-source'},
                    {'text': 'private-support', 'nature': 'support', 'src': 'private-support-upload'},
                    {'text': 'private-unclassified'},
                    'private-legacy-string',
                ],
            })
        sections.append({'t': 'private-extra-topic', 'known': [
            {'text': 'private-extra-base-text', 'nature': 'base'}]})
        original = state['PROJECTS']['root-a']
        original['kb'] = sections
        original.update(report='private-report', reportRequestId='private-request',
                        reportFiles=[{'filename': 'private-report-file'}], clues=['private-clue'])
        state['CITY_BASE_PACKAGES'] = {'同名市': 'root-a'}
        self.store.replace(state)
        result = self.manage({'action': 'create', 'city': '同名市'}, token=token)
        project = result['project']
        self.assertEqual([section['t'] for section in project['kb']], titles)
        self.assertEqual([[item['text'] for item in section['known']] for section in project['kb']],
                         [['public-base-' + str(i)] for i in range(4)])
        self.assertTrue(all(item['nature'] == 'base' for section in project['kb'] for item in section['known']))
        for number, section in enumerate(project['kb']):
            self.assertEqual(section['known'], [{
                'text': 'public-base-' + str(number), 'nature': 'base', 'origin': 'ai',
                'src': 'https://public.example.test/source-' + str(number),
            }])
        self.assertNotIn('private-', json.dumps(project, ensure_ascii=False))
        self.assertEqual(self.store.state['PROJECTS'][result['invite']['projKey']], project)
        self.assertEqual(self.store.state['PROJECTS']['root-a'], original)
        registered = self.call_auth('register', {'username': 'new-public-member', 'password': PASSWORD,
                                                'inviteCode': result['invite']['code']})
        view = scoped_sync_view(self.store.state, registered['auth'])
        self.assertEqual(set(view['PROJECTS']), {result['invite']['projKey']})
        self.assertNotIn('private-', json.dumps(view, ensure_ascii=False))

    def test_exactly_four_source_sections_do_not_promote_an_extra_topic_into_public_base(self):
        token = self.login()
        state = self.store.state
        titles = ['主导产业与产业链', '园区与承载条件', '链主与存量企业', '政策、规划与领导关注']
        source = state['PROJECTS']['root-a']
        source['kb'] = [
            {'t': title, 'known': [{'nature': 'base', 'text': 'public-' + str(index)}]}
            for index, title in enumerate(titles[:3])
        ] + [{'t': 'private-extra-topic', 'known': [{'nature': 'base', 'text': 'private-extra-base'}]}]
        state['CITY_BASE_PACKAGES'] = {'同名市': 'root-a'}
        self.store.replace(state)
        result = self.manage({'action': 'create', 'city': '同名市'}, token=token)
        sections = result['project']['kb']
        self.assertEqual([section['t'] for section in sections], titles)
        self.assertEqual([[item['text'] for item in section['known']] for section in sections],
                         [['public-0'], ['public-1'], ['public-2'], []])
        self.assertNotIn('private-', json.dumps(result['project'], ensure_ascii=False))
        self.assertEqual(self.store.state['PROJECTS']['root-a'], source)

    def test_every_failed_create_save_has_no_ack_or_partial_mutation(self):
        token = self.login()
        before = self.store.raw
        for failure_mode in (False, None, 1, 'raise'):
            with self.subTest(failure_mode=failure_mode):
                self.store.raise_write = failure_mode == 'raise'
                self.store.write_result = failure_mode
                response = self.http('/api/admin/invites',
                                     {'action': 'create', 'city': '未保存市'}, token)
                self.assertEqual(response.status, 503)
                self.assertFalse(response.body['ok'])
                self.assertNotIn('invite', response.body)
                self.assertNotIn('project', response.body)
                self.assertNotIn('storage detail', response.wfile.getvalue().decode())
                self.assertEqual(self.store.raw, before)

    def test_create_rejects_invalid_city_and_email_without_writing(self):
        token = self.login()
        before = self.store.raw
        for city in ('', '   ', None, [], '<script>', 'bad\ncity', '城' * 129):
            with self.subTest(city=city):
                self.assert_error(400, 'invalid_input', self.manage,
                                  {'action': 'create', 'city': city}, token=token)
        for email in ('missing-at', 'a@b', 'a b@example.com'):
            self.assert_error(400, 'invalid_email', self.manage,
                              {'action': 'create', 'city': '同名市', 'distributedEmail': email}, token=token)
        self.assertEqual(self.store.raw, before)

    def test_invalid_unicode_city_is_rejected_before_saving_or_serializing_response(self):
        token = self.login()
        before = self.store.raw
        response = self.http('/api/admin/invites', {'action': 'create', 'city': 'bad\ud800city'}, token)
        self.assertEqual(response.status, 400)
        self.assertFalse(response.body['ok'])
        self.assertEqual(self.store.raw, before)

    def test_successful_http_creation_returns_no_authentication_material(self):
        token = self.login()
        response = self.http('/api/admin/invites', {'action': 'create', 'city': '新城市'}, token)
        self.assertEqual(response.status, 200)
        self.assertTrue(response.body['ok'])
        self.assertIn(response.body['invite']['code'], self.store.state['INVITE_CODES'])
        self.assertNotIn(token, response.wfile.getvalue().decode())
        self.assertNotIn(PASSWORD, response.wfile.getvalue().decode())
        self.assertNotIn('Set-Cookie', dict(response.response_headers))

    def test_distribution_change_and_clear_removes_old_email(self):
        token = self.login()
        result = self.manage({'action': 'create', 'city': '同名市',
                              'distributedEmail': 'initial@example.test'}, token=token)
        code = result['invite']['code']
        self.assertTrue(result['invite']['distributed'])
        updated = self.manage({'action': 'distribution', 'code': ' ' + code.lower() + ' ',
                              'distributed': True, 'distributedEmail': 'second@example.test'}, token=token)
        self.assertEqual(updated['invite']['distributedEmail'], 'second@example.test')
        cleared = self.manage({'action': 'distribution', 'code': code, 'distributed': False,
                              'distributedEmail': 'old@example.test'}, token=token)
        self.assertEqual((cleared['invite']['distributed'], cleared['invite']['distributedEmail']), (False, ''))
        self.assertEqual(self.store.state['INVITE_CODES'][code]['distributedEmail'], '')

    def test_distribution_and_revoke_require_admin_and_ack_only_committed_state(self):
        admin, member = self.login(), self.login('ordinary')
        for body in ({'action': 'distribution', 'code': 'TEAM_A', 'distributed': False},
                     {'action': 'revoke', 'code': 'TEAM_A'}):
            with self.subTest(action=body['action']):
                before = self.store.raw
                self.assert_error(403, 'admin_required', self.manage, body, token=member)
                self.store.write_result = False
                self.assert_error(503, 'storage_unavailable', self.manage, body, token=admin)
                self.assertEqual(self.store.raw, before)
                self.store.write_result = True

    def test_distribution_requires_real_boolean_and_valid_email(self):
        token = self.login()
        before = self.store.raw
        for distributed in ('false', 0, 1, None, []):
            self.assert_error(400, 'invalid_input', self.manage,
                              {'action': 'distribution', 'code': 'TEAM_A',
                               'distributed': distributed}, token=token)
        self.assert_error(400, 'invalid_email', self.manage,
                          {'action': 'distribution', 'code': 'TEAM_A', 'distributed': True}, token=token)
        self.assertEqual(self.store.raw, before)

    def test_revocation_blocks_registration_but_preserves_existing_account_session(self):
        admin, existing = self.login(), self.login('member')
        result = self.manage({'action': 'revoke', 'code': ' team_a '}, token=admin)
        self.assertTrue(result['invite']['revoked'])
        self.assert_error(400, 'invalid_invite', self.call_auth, 'register',
                          {'username': 'late-user', 'password': PASSWORD, 'inviteCode': 'TEAM_A'})
        self.assertEqual(self.call_auth('session', token=existing)['auth']['projectKeys'], ['root-a', 'root-b'])
        self.assertTrue(self.manage({'action': 'revoke', 'code': 'TEAM_A'}, token=admin)['ok'])

    def test_disabled_admin_configuration_or_expired_session_cannot_manage_invites(self):
        token = self.login()
        before = self.store.raw
        for config, now in ((None, NOW), (auth.AdminConfig(ADMIN.username, 'changed-password'), NOW),
                            (ADMIN, NOW + auth.SESSION_TTL_SECONDS)):
            self.assert_error(401, 'auth_required', self.manage,
                              {'action': 'revoke', 'code': 'TEAM_A'}, token=token, config=config, now=now)
        self.assertEqual(self.store.raw, before)

    def test_unknown_and_unsupported_invite_operations_do_not_write(self):
        token = self.login()
        before = self.store.raw
        self.assert_error(404, 'invite_not_found', self.manage,
                          {'action': 'revoke', 'code': 'MISSING'}, token=token)
        self.assert_error(400, 'invalid_action', self.manage,
                          {'action': 'delete', 'code': 'TEAM_A'}, token=token)
        self.assert_error(400, 'invalid_input', self.manage, [], token=token)
        self.assertEqual(self.store.raw, before)

    def test_corrupt_storage_or_invitation_maps_fail_closed_without_writes(self):
        token = self.login()
        valid = self.store.state
        for raw in ('not JSON', '[]'):
            self.store.raw = raw
            self.assert_error(503, 'storage_unavailable', self.manage,
                              {'action': 'create', 'city': '新城市'}, token=token)
            self.assertEqual(self.store.raw, raw)
        for field in ('INVITE_CODES', 'PROJECTS'):
            state = copy.deepcopy(valid)
            state[field] = []
            self.store.replace(state)
            before = self.store.raw
            self.assert_error(503, 'storage_unavailable', self.manage,
                              {'action': 'create', 'city': '新城市'}, token=token)
            self.assertEqual(self.store.raw, before)

    def test_owner_removal_preserves_account_other_team_and_unrelated_state(self):
        owner = self.login('owner-a')
        member = self.login('member')
        before = self.store.state
        owner_principal = self.call_auth('session', token=owner)['auth']
        self.assertEqual(scoped_sync_view(before, owner_principal)['USER_PROFILES']['member'],
                         {'user': 'member', 'name': '双团队成员', 'projKey': 'root-a', 'role': 'member'})
        self.assertEqual(self.remove(' MEMBER ', token=owner), {'ok': True})
        after = self.store.state
        record = after['USER_PROFILES']['member']
        self.assertEqual(record['password_hash'], before['USER_PROFILES']['member']['password_hash'])
        self.assertEqual(record['phone'], before['USER_PROFILES']['member']['phone'])
        self.assertEqual(record['memberships']['root-b'], before['USER_PROFILES']['member']['memberships']['root-b'])
        self.assertNotIn('root-a', auth._memberships(record))
        self.assertEqual(after['UNRELATED_SERVER_STATE'], before['UNRELATED_SERVER_STATE'])
        self.assertEqual(after['INVITE_CODES'], before['INVITE_CODES'])
        self.assertEqual(after['PROJECTS'], before['PROJECTS'])
        self.assertNotIn('member', scoped_sync_view(after, owner_principal)['USER_PROFILES'])
        self.assertIsNone(auth.resolve_principal(None, after, ADMIN, token=member, now=NOW))
        resumed = self.call_auth('login', {'username': 'member', 'password': PASSWORD})
        self.assertEqual(resumed['auth']['projectKeys'], ['root-b'])
        self.assertEqual(resumed['auth']['projKey'], 'root-b')

    def test_owner_authority_is_specific_to_target_root_even_with_other_membership(self):
        owner = self.login('owner-a')
        before = self.store.raw
        self.assert_error(403, 'workspace_forbidden', self.remove, 'member', key='root-b', token=owner)
        self.assertEqual(self.store.raw, before)
        self.call_auth('switch_workspace', {'projKey': 'root-b'}, token=owner)
        before = self.store.raw
        self.assert_error(403, 'owner_required', self.remove, 'member', key='root-b', token=owner)
        self.assertEqual(self.store.raw, before)

    def test_ordinary_member_foreign_owner_and_missing_session_cannot_remove(self):
        ordinary, other_owner = self.login('ordinary'), self.login('owner-b')
        before = self.store.raw
        self.assert_error(401, 'auth_required', self.remove, 'member')
        self.assert_error(403, 'owner_required', self.remove, 'member', token=ordinary)
        self.assert_error(403, 'workspace_forbidden', self.remove, 'member', token=other_owner)
        self.assertEqual(self.store.raw, before)

    def test_owner_cannot_remove_self_or_nonmember(self):
        token = self.login('owner-a')
        before = self.store.raw
        self.assert_error(400, 'cannot_remove_self', self.remove, 'OWNER-A', token=token)
        self.assert_error(404, 'member_not_found', self.remove, 'missing', token=token)
        self.assert_error(404, 'member_not_found', self.remove, 'owner-b', token=token)
        self.assertEqual(self.store.raw, before)

    def test_admin_can_remove_members_but_failed_save_does_not_ack(self):
        token = self.login()
        before = self.store.raw
        for failure_mode in (False, None, 1, 'raise'):
            with self.subTest(failure_mode=failure_mode):
                self.store.write_result = failure_mode
                self.store.raise_write = failure_mode == 'raise'
                response = self.http('/api/auth/members',
                                     {'action': 'remove', 'user': 'member', 'projKey': 'root-a'}, token)
                self.assertEqual(response.status, 503)
                self.assertFalse(response.body['ok'])
                self.assertEqual(self.store.raw, before)
        self.store.raise_write = False
        self.store.write_result = True
        self.assertEqual(self.remove('member', key='root-b', token=token), {'ok': True})
        self.assertEqual(set(auth._memberships(self.store.state['USER_PROFILES']['member'])), {'root-a'})

    def test_last_membership_removal_does_not_resurrect_legacy_project_on_login(self):
        owner, removed = self.login('owner-a'), self.login('member-only')
        self.remove('member-only', token=owner)
        record = self.store.state['USER_PROFILES']['member-only']
        self.assertEqual(record['projKey'], 'root-a')
        self.assertEqual(auth._memberships(record), {})
        self.assertIsNone(auth.resolve_principal(None, self.store.state, ADMIN, token=removed, now=NOW))
        fresh = self.call_auth('login', {'username': 'member-only', 'password': PASSWORD})
        self.assertEqual(fresh['auth']['projectKeys'], [])
        self.assertIsNone(fresh['auth']['projKey'])
        self.assertEqual(allowed_project_keys(self.store.state, fresh['auth']), set())
        self.assertEqual(scoped_sync_view(self.store.state, fresh['auth'])['PROJECTS'], {})

    def test_removed_membership_cannot_be_rejoined_with_old_reusable_invite(self):
        owner = self.login('owner-a')
        self.remove('member', token=owner)
        remaining = self.login('member')
        self.assert_error(403, 'membership_disabled', self.call_auth, 'join',
                          {'inviteCode': 'TEAM_A'}, token=remaining)
        self.assertEqual(set(auth._memberships(self.store.state['USER_PROFILES']['member'])), {'root-b'})

    def test_legacy_city_account_is_removed_without_deleting_or_replacing_it(self):
        admin = self.login()
        state = self.store.state
        state['CITY_ACCOUNTS']['legacy-city'] = {'password_hash': self.password_hash,
            'projKey': 'root-a', 'city': '同名市', 'name': '旧驻地账号', 'role': 'member'}
        self.store.replace(state)
        self.remove('LEGACY-CITY', token=admin)
        record = self.store.state['CITY_ACCOUNTS']['legacy-city']
        self.assertEqual(record['password_hash'], self.password_hash)
        self.assertEqual(auth._memberships(record), {})
        self.assertNotIn('legacy-city', self.store.state['USER_PROFILES'])
        result = self.call_auth('login', {'username': 'legacy-city', 'password': PASSWORD})
        self.assertEqual(result['auth']['projectKeys'], [])

    def test_legacy_normalized_account_keys_can_be_removed(self):
        admin = self.login()
        state = self.store.state
        state['USER_PROFILES'][' Legacy-Name '] = state['USER_PROFILES'].pop('member-only')
        self.store.replace(state)
        self.remove('legacy-name', token=admin)
        self.assertEqual(auth._memberships(self.store.state['USER_PROFILES'][' Legacy-Name ']), {})

    def test_ownership_lookup_cannot_switch_away_from_authenticated_account_source(self):
        state = self.store.state
        state['CITY_ACCOUNTS']['city-member'] = copy.deepcopy(state['USER_PROFILES']['ordinary'])
        self.store.replace(state)
        city_token = self.login('city-member')
        state = self.store.state
        # Preexisting duplicate tables must not turn a CITY_ACCOUNTS session
        # into a different USER_PROFILES identity with owner privileges.
        duplicate = copy.deepcopy(state['USER_PROFILES']['owner-a'])
        state['USER_PROFILES']['city-member'] = duplicate
        self.store.replace(state)
        before = self.store.raw
        principal = auth.resolve_principal(None, self.store.state, ADMIN, token=city_token, now=NOW)
        self.assertEqual(principal['role'], 'member')
        self.assert_error(403, 'owner_required', self.remove, 'member-only', token=city_token)
        self.assertEqual(self.store.raw, before)


if __name__ == '__main__':
    unittest.main()
