"""Offline account, authorization and serialized-storage regression tests."""
import concurrent.futures
import contextlib
import copy
import hashlib
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from backend import auth
from backend.sync_transaction import PostgresSession, file_session


PASSWORD = 'offline-test-password-7'
NOW = 1_900_000_000


def initial_state():
    return {
        'INVITE_CODES': {
            'TEAM_A': {'city': '测试甲市', 'projKey': 'project-a', 'role': 'member', 'usedBy': []},
            'TEAM_B': {'city': '测试乙市', 'projKey': 'project-b', 'role': 'owner', 'usedBy': []},
            'TEAM_C': {'city': '测试丙市', 'projKey': 'project-c', 'usedBy': []},
            'REVOKED': {'city': '已作废市', 'projKey': 'private-project', 'revoked': True},
        },
        'PROJECTS': {'project-a': {'city': '测试甲市', 'keep': [1, 2]}},
        'USER_PROFILES': {}, 'CITY_ACCOUNTS': {}, 'UNRELATED': {'keep': True},
    }


class MemoryStore:
    def __init__(self, state=None):
        self.raw = json.dumps(initial_state() if state is None else state)
        self.lock = threading.RLock()
        self.fail = False
        self.raise_write = False
        self.writes = 0

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
                    store.writes += 1
                    if store.raise_write:
                        raise OSError('OFFLINE secret-shaped storage detail')
                    if store.fail:
                        return False
                    store.raw = raw
                    return True

            yield Session()


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore()

    def call(self, operation, body=None, *, token=None, **kwargs):
        return auth.handle_auth(operation, body or {}, self.store.factory,
                                token=token, now=kwargs.pop('now', NOW), **kwargs)

    def register(self, username='alice', **kwargs):
        body = {'username': username, 'password': PASSWORD, 'inviteCode': 'TEAM_A', 'name': '测试用户'}
        body.update(kwargs)
        return self.call('register', body)

    def login(self, username='alice', password=PASSWORD, **kwargs):
        return self.call('login', {'username': username, 'password': password}, **kwargs)

    def assert_error(self, status, code, function, *args, **kwargs):
        with self.assertRaises(auth.AuthError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.status, status)
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    def test_validate_invite_returns_only_bound_city_and_does_not_modify_state(self):
        before = self.store.raw
        self.assertEqual(self.call('validate_invite', {'inviteCode': ' team_a '}),
                         {'ok': True, 'city': '测试甲市'})
        self.assertEqual(self.store.raw, before)
        self.assertEqual(self.store.writes, 0)
        for code in ('unknown', 'REVOKED', ''):
            self.assert_error(400, 'invalid_invite', self.call, 'validate_invite', {'code': code})

    def test_registration_hashes_password_and_stores_only_token_digest(self):
        result = self.register(role='admin', scope='admin', projKey='attacker',
                               memberships={'attacker': {'role': 'owner'}})
        self.assertEqual(result['auth']['scope'], 'project')
        self.assertEqual(result['auth']['role'], 'member')
        self.assertEqual(result['auth']['projKey'], 'project-a')
        self.assertEqual(result['auth']['projectKeys'], ['project-a'])
        record = self.store.state['USER_PROFILES']['alice']
        self.assertTrue(auth.verify_password(PASSWORD, record['password_hash']))
        self.assertNotIn('pwd', record)
        self.assertNotIn(PASSWORD, self.store.raw)
        self.assertNotIn(result['session_token'], self.store.raw)
        digest = hashlib.sha256(result['session_token'].encode()).hexdigest()
        stored = self.store.state['AUTH_SESSIONS'][digest]
        self.assertEqual(stored['active_projKey'], 'project-a')
        self.assertEqual(stored['expires_at'], NOW + 7 * 24 * 3600)
        self.assertEqual(self.store.state['INVITE_CODES']['TEAM_A']['usedBy'], [{'user': 'alice', 'ts': NOW * 1000}])
        self.assertEqual(self.store.state['PROJECTS'], initial_state()['PROJECTS'])
        self.assertNotIn('inviteCode', json.dumps(result['profile']))
        self.assertNotIn('password', json.dumps(result['profile']))

    def test_password_hash_uses_random_salt_and_rejects_wrong_or_malformed_hash(self):
        first, second = auth.hash_password(PASSWORD), auth.hash_password(PASSWORD)
        self.assertNotEqual(first, second)
        self.assertTrue(auth.verify_password(PASSWORD, first))
        self.assertFalse(auth.verify_password('incorrect', first))
        for malformed in ('plain', first.replace('$600000$', '$999999999$'), None, 'pbkdf2_sha256$0$a$b'):
            self.assertFalse(auth.verify_password(PASSWORD, malformed))

    def test_unknown_revoked_unbound_and_expired_invites_cannot_register(self):
        state = self.store.state
        state['INVITE_CODES']['UNBOUND'] = {'city': '测试市'}
        state['INVITE_CODES']['EXPIRED'] = {'city': '测试市', 'projKey': 'old', 'expires_at': NOW}
        self.store.replace(state)
        before = self.store.raw
        for code in ('UNKNOWN', 'REVOKED', 'UNBOUND', 'EXPIRED'):
            self.assert_error(400, 'invalid_invite', self.register, inviteCode=code)
        self.assertEqual(self.store.raw, before)

    def test_new_password_requires_eight_characters_but_legacy_login_keeps_old_password(self):
        self.assert_error(400, 'weak_password', self.register, password='short')
        state = self.store.state
        state['USER_PROFILES']['old'] = {'pwd': 'old', 'projKey': 'project-a'}
        self.store.replace(state)
        self.assertTrue(self.login('old', 'old')['ok'])

    def test_malformed_registration_fields_are_client_errors_without_writes(self):
        for username in ('', 'two words', 'invisible\u200bname', '\ud800', None):
            self.assert_error(400, 'invalid_username', self.register, username)
        self.assert_error(400, 'invalid_password', self.register, password='bad\ud800password')
        self.assert_error(400, 'invalid_profile', self.register, name={'pwd': PASSWORD})
        self.assertEqual(self.store.writes, 0)

    def test_legacy_password_migrates_once_only_after_success_and_invite_revocation_is_irrelevant(self):
        state = self.store.state
        state['USER_PROFILES']['Alice'] = {'pwd': PASSWORD, 'name': '旧用户', 'projKey': 'project-a',
                                          'city': '测试甲市', 'role': 'member', 'inviteCode': 'REVOKED'}
        self.store.replace(state)
        before = self.store.raw
        self.assert_error(401, 'invalid_credentials', self.login, 'alice', 'wrong')
        self.assertEqual(self.store.raw, before)
        first = self.login('ALICE')
        migrated = self.store.state['USER_PROFILES']['Alice']
        first_hash = migrated['password_hash']
        self.assertNotIn('pwd', migrated)
        self.assertEqual(list(migrated['memberships']), ['project-a'])
        self.assertEqual(first['auth']['user'], 'alice')
        self.assertTrue(self.login()['ok'])
        self.assertEqual(self.store.state['USER_PROFILES']['Alice']['password_hash'], first_hash)

    def test_city_account_legacy_login_is_scoped_to_its_current_project(self):
        state = self.store.state
        state['CITY_ACCOUNTS']['legacy-city'] = {'pwd': PASSWORD, 'city': '测试甲市', 'projKey': 'project-a', 'who': '驻地用户'}
        self.store.replace(state)
        result = self.login('legacy-city')
        self.assertEqual(result['auth']['projectKeys'], ['project-a'])
        self.assertEqual(result['auth']['role'], 'owner')
        self.assertEqual(result['auth']['scope'], 'project')
        self.assertTrue(result['auth']['resident'])
        self.assertNotIn('pwd', self.store.state['CITY_ACCOUNTS']['legacy-city'])

    def test_hash_failure_never_falls_back_to_stale_plaintext(self):
        state = self.store.state
        state['USER_PROFILES']['alice'] = {'password_hash': 'corrupt', 'pwd': PASSWORD, 'projKey': 'project-a'}
        self.store.replace(state)
        self.assert_error(401, 'invalid_credentials', self.login)
        self.assertNotIn('AUTH_SESSIONS', self.store.state)

    def test_public_default_accounts_never_authorize_and_admin_is_reserved(self):
        state = self.store.state
        state['ACCOUNTS'] = {'admin': {'pwd': 'admin', 'role': 'admin'}, 'public': {'pwd': PASSWORD, 'role': 'owner'}}
        self.store.replace(state)
        self.assert_error(401, 'invalid_credentials', self.login, 'admin', 'admin')
        self.assert_error(401, 'invalid_credentials', self.login, 'public')
        self.assert_error(409, 'username_exists', self.register, 'admin')

    def test_admin_is_configuration_only_and_credentials_changes_invalidate_session(self):
        config = auth.admin_config_from_env({'HXZ_ADMIN_USERNAME': 'Operator', 'HXZ_ADMIN_PASSWORD': PASSWORD})
        self.assertNotIn(PASSWORD, repr(config))
        self.assertIsNone(auth.admin_config_from_env({'HXZ_ADMIN_USERNAME': 'Operator'}))
        self.assert_error(401, 'invalid_credentials', self.login, 'operator')
        self.assert_error(409, 'username_exists', self.call, 'register',
                          {'username': 'operator', 'password': PASSWORD, 'inviteCode': 'TEAM_A'}, admin_config=config)
        result = self.login('operator', admin_config=config)
        self.assertEqual(result['auth']['scope'], 'admin')
        self.assertEqual(result['auth']['projectKeys'], [])
        self.assertEqual(self.store.state['USER_PROFILES'], {})
        token = result['session_token']
        self.assertEqual(auth.resolve_principal(None, self.store.state, config, token=token, now=NOW)['role'], 'admin')
        self.assertIsNone(auth.resolve_principal(None, self.store.state, None, token=token, now=NOW))
        changed = auth.AdminConfig('operator', 'a-different-password')
        self.assertIsNone(auth.resolve_principal(None, self.store.state, changed, token=token, now=NOW))

    def test_cookie_expiry_boundary_unknown_cookie_and_forged_headers(self):
        result = self.register()
        token = result['session_token']
        headers = {'Cookie': f'other=x; hxz_session={token}', 'X-Role': 'admin', 'X-Project': 'attacker'}
        principal = auth.resolve_principal(headers, self.store.state, now=NOW)
        self.assertEqual(principal['role'], 'member')
        self.assertEqual(principal['projKey'], 'project-a')
        self.assertIsNotNone(auth.resolve_principal(headers, self.store.state, now=NOW + auth.SESSION_TTL_SECONDS - 1))
        self.assertIsNone(auth.resolve_principal(headers, self.store.state, now=NOW + auth.SESSION_TTL_SECONDS))
        for invalid in (None, 'x', 'a' * 43, token + '\n'):
            self.assertIsNone(auth.resolve_principal(None, self.store.state, token=invalid, now=NOW))
        self.assert_error(401, 'auth_required', auth.require_session, None, self.store.state, now=NOW)

    def test_malformed_membership_and_active_session_fields_cannot_grant_access(self):
        token = self.register()['session_token']
        state = self.store.state
        stored = next(iter(state['AUTH_SESSIONS'].values()))
        stored['active_projKey'] = []
        self.assertIsNone(auth.resolve_principal(None, state, token=token, now=NOW))
        stored['active_projKey'] = None
        state['USER_PROFILES']['alice']['memberships'] = {None: {'role': 'owner'}}
        principal = auth.resolve_principal(None, state, token=token, now=NOW)
        self.assertEqual(principal['projectKeys'], [])
        self.assertEqual(principal['role'], 'member')

    def test_permissions_are_reread_and_fake_session_role_and_project_are_ignored(self):
        result = self.register()
        state = self.store.state
        stored = next(iter(state['AUTH_SESSIONS'].values()))
        stored.update(role='admin', scope='admin', projKey='attacker', projectKeys=['attacker'])
        profile = state['USER_PROFILES']['alice']
        profile['role'] = 'admin'
        self.assertEqual(auth.resolve_principal(None, state, token=result['session_token'], now=NOW)['role'], 'member')
        profile['memberships']['project-a']['role'] = 'owner'
        updated = auth.resolve_principal(None, state, token=result['session_token'], now=NOW)
        self.assertEqual((updated['role'], updated['scope']), ('owner', 'project'))
        stored['active_projKey'] = 'attacker'
        self.assertIsNone(auth.resolve_principal(None, state, token=result['session_token'], now=NOW))

    def test_profile_removal_disable_and_password_change_invalidate_sessions(self):
        result = self.register()
        original = self.store.state
        for change in ('remove', 'disabled', 'inactive', 'status', 'password'):
            with self.subTest(change=change):
                state = copy.deepcopy(original)
                record = state['USER_PROFILES']['alice']
                if change == 'remove':
                    del state['USER_PROFILES']['alice']
                    state['CITY_ACCOUNTS']['alice'] = record
                elif change == 'disabled':record['disabled'] = True
                elif change == 'inactive':record['active'] = False
                elif change == 'status':record['status'] = 'Deleted'
                else:record['password_hash'] = auth.hash_password('different-password')
                self.assertIsNone(auth.resolve_principal(None, state, token=result['session_token'], now=NOW))

    def test_empty_or_revoked_memberships_never_restore_legacy_default(self):
        result = self.register()
        state = self.store.state
        state['USER_PROFILES']['alice']['memberships'] = {}
        self.assertIsNone(auth.resolve_principal(None, state, token=result['session_token'], now=NOW))
        self.store.replace(state)
        fresh = self.login()
        self.assertEqual(fresh['auth']['projectKeys'], [])
        self.assertIsNone(fresh['auth']['projKey'])

    def test_join_preserves_old_membership_and_default_and_is_idempotent(self):
        first = self.register()
        token = first['session_token']
        result = self.call('join', {'inviteCode': 'TEAM_B', 'role': 'admin', 'projKey': 'attacker'}, token=token)
        self.assertEqual(result['auth']['projectKeys'], ['project-a', 'project-b'])
        self.assertEqual((result['auth']['projKey'], result['auth']['city'], result['auth']['role']),
                         ('project-b', '测试乙市', 'owner'))
        record = self.store.state['USER_PROFILES']['alice']
        self.assertEqual(record['projKey'], 'project-a')
        self.assertEqual(record['city'], '测试甲市')
        before_member = record['memberships']['project-b']
        self.call('join', {'inviteCode': 'TEAM_B'}, token=token, now=NOW + 10)
        self.assertEqual(self.store.state['USER_PROFILES']['alice']['memberships']['project-b'], before_member)
        self.assertEqual(len(self.store.state['INVITE_CODES']['TEAM_B']['usedBy']), 1)
        fresh = self.login()
        self.assertEqual(fresh['auth']['projKey'], 'project-a')
        self.assertEqual(fresh['auth']['projectKeys'], ['project-a', 'project-b'])

    def test_switch_workspace_checks_current_membership_without_changing_default(self):
        token = self.register()['session_token']
        self.call('join', {'inviteCode': 'TEAM_B'}, token=token)
        result = self.call('switch_workspace', {'projKey': 'project-a', 'role': 'admin'}, token=token)
        self.assertEqual((result['auth']['projKey'], result['auth']['role']), ('project-a', 'member'))
        self.assert_error(403, 'workspace_forbidden', self.call, 'switch_workspace', {'projKey': 'private-project'}, token=token)
        self.assertEqual(self.store.state['USER_PROFILES']['alice']['projKey'], 'project-a')

    def test_join_requires_member_session_and_live_invitation(self):
        self.assert_error(401, 'auth_required', self.call, 'join', {'inviteCode': 'TEAM_B'})
        token = self.register()['session_token']
        before = self.store.raw
        self.assert_error(400, 'invalid_invite', self.call, 'join', {'inviteCode': 'REVOKED'}, token=token)
        self.assertEqual(self.store.raw, before)
        config = auth.AdminConfig('operator', PASSWORD)
        admin = self.login('operator', admin_config=config)
        self.assert_error(403, 'member_required', self.call, 'join', {'inviteCode': 'TEAM_B'},
                          token=admin['session_token'], admin_config=config)

    def test_join_another_workspace_preserves_disabled_membership_tombstone(self):
        token = self.register()['session_token']
        state = self.store.state
        state['USER_PROFILES']['alice']['memberships']['project-b'] = {'role': 'owner', 'disabled': True}
        self.store.replace(state)
        self.call('join', {'inviteCode': 'TEAM_C'}, token=token)
        self.assertTrue(self.store.state['USER_PROFILES']['alice']['memberships']['project-b']['disabled'])
        self.assert_error(403, 'membership_disabled', self.call, 'join', {'inviteCode': 'TEAM_B'}, token=token)

    def test_logout_revokes_server_session_and_is_idempotent(self):
        token = self.register()['session_token']
        self.assertTrue(self.call('logout', token=token)['ok'])
        self.assertEqual(self.store.state['AUTH_SESSIONS'], {})
        self.assertIsNone(auth.resolve_principal(None, self.store.state, token=token, now=NOW))
        self.assertTrue(self.call('logout', token=token)['ok'])

    def test_failed_logout_commit_does_not_claim_server_session_revoked(self):
        token = self.register()['session_token']
        self.store.fail = True
        self.assert_error(503, 'storage_unavailable', self.call, 'logout', token=token)
        self.assertIsNotNone(auth.resolve_principal(None, self.store.state, token=token, now=NOW))

    def test_token_collision_does_not_overwrite_existing_session(self):
        token = self.register()['session_token']
        before = self.store.raw
        with patch('backend.auth.secrets.token_urlsafe', return_value=token):
            self.assert_error(503, 'session_unavailable', self.login)
        self.assertEqual(self.store.raw, before)
        self.assertIsNotNone(auth.resolve_principal(None, self.store.state, token=token, now=NOW))

    def test_failed_commit_never_acknowledges_registration_or_returns_session(self):
        before = self.store.raw
        self.store.fail = True
        error = self.assert_error(503, 'storage_unavailable', self.register)
        self.assertEqual(self.store.raw, before)
        self.assertNotIn('session', error.as_dict())
        self.assertNotIn(PASSWORD, str(error))

    def test_failed_login_commit_does_not_persist_plaintext_migration(self):
        state = self.store.state
        state['USER_PROFILES']['old'] = {'pwd': PASSWORD, 'projKey': 'project-a'}
        self.store.replace(state)
        before = self.store.raw
        self.store.fail = True
        self.assert_error(503, 'storage_unavailable', self.login, 'old')
        self.assertEqual(self.store.raw, before)

    def test_failed_join_commit_preserves_memberships_and_active_session(self):
        token = self.register()['session_token']
        before = self.store.raw
        self.store.fail = True
        self.assert_error(503, 'storage_unavailable', self.call, 'join', {'inviteCode': 'TEAM_B'}, token=token)
        self.assertEqual(self.store.raw, before)

    def test_storage_faults_never_leak_internal_error_or_credentials(self):
        self.store.raise_write = True
        error = self.assert_error(503, 'storage_unavailable', self.register)
        self.assertNotIn('secret-shaped', json.dumps(error.as_dict()))
        self.store.raw = '{bad stored secret'
        error = self.assert_error(503, 'storage_unavailable', self.login)
        self.assertNotIn('secret', str(error))

    def test_safe_profile_never_exposes_nested_or_legacy_credentials(self):
        profile = {'name': {'pwd': PASSWORD}, 'pwd': PASSWORD, 'password_hash': 'secret-hash',
                   'projKey': 'project-a', 'role': 'admin', 'inviteCode': 'TEAM_A',
                   'memberships': {'project-a': {'role': 'admin', 'inviteCode': 'TEAM_A',
                                                 'password_hash': 'nested-secret'}}}
        safe = auth.safe_profile(profile, 'alice')
        encoded = json.dumps(safe)
        for forbidden in ('pwd', 'password', 'secret', 'TEAM_A'):
            self.assertNotIn(forbidden, encoded)
        self.assertEqual(safe['memberships']['project-a']['role'], 'member')

    def test_persisted_admin_role_cannot_create_admin_scope(self):
        state = self.store.state
        state['USER_PROFILES']['not-admin'] = {'pwd': PASSWORD, 'projKey': 'project-a', 'role': 'admin'}
        self.store.replace(state)
        result = self.login('not-admin')
        self.assertEqual((result['auth']['scope'], result['auth']['role']), ('project', 'member'))

    def test_duplicate_case_variants_never_fall_back_to_a_city_account(self):
        state = self.store.state
        state['USER_PROFILES'] = {'Alice': {'pwd': PASSWORD}, 'ALICE': {'pwd': PASSWORD}}
        state['CITY_ACCOUNTS']['alice'] = {'pwd': PASSWORD, 'projKey': 'project-a'}
        self.store.replace(state)
        self.assert_error(401, 'invalid_credentials', self.login)

    def test_low_level_operations_and_me_share_the_same_committed_session(self):
        with self.store.factory() as session:
            result = auth.register({'user': 'alice', 'pwd': PASSWORD, 'code': 'TEAM_A'}, session, now=NOW)
        me = self.call('me', token=result['session_token'])
        self.assertEqual(me['auth'], result['auth'])
        self.assertNotIn('session_token', me)


class RealSerializedRegistrationTests(unittest.TestCase):
    def _run_file(self, names):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            path.write_text(json.dumps(initial_state()))
            barrier = threading.Barrier(len(names))
            def register(name):
                barrier.wait()
                try:
                    return auth.handle_auth('register', {'username': name, 'password': PASSWORD, 'inviteCode': 'TEAM_A'},
                        lambda: file_session(str(path), lambda: None), now=NOW)
                except auth.AuthError as error:
                    return error.as_dict()
            with concurrent.futures.ThreadPoolExecutor(max_workers=len(names)) as pool:
                results = list(pool.map(register, names))
            return results, json.loads(path.read_text())

    def test_two_concurrent_accounts_are_both_committed_without_overwrite(self):
        results, state = self._run_file(['alice', 'bob'])
        self.assertTrue(all(result['ok'] for result in results))
        self.assertEqual(set(state['USER_PROFILES']), {'alice', 'bob'})
        self.assertEqual(len(state['AUTH_SESSIONS']), 2)
        self.assertEqual({row['user'] for row in state['INVITE_CODES']['TEAM_A']['usedBy']}, {'alice', 'bob'})
        self.assertEqual(state['UNRELATED'], {'keep': True})

    def test_concurrent_duplicate_username_commits_exactly_once(self):
        results, state = self._run_file(['Alice', 'alice'])
        self.assertEqual(sum(result['ok'] for result in results), 1)
        self.assertEqual([result['code'] for result in results if not result['ok']], ['username_exists'])
        self.assertEqual(len(state['USER_PROFILES']), 1)
        self.assertEqual(len(state['AUTH_SESSIONS']), 1)
        self.assertEqual(len(state['INVITE_CODES']['TEAM_A']['usedBy']), 1)

    def test_atomic_file_publication_failure_does_not_issue_success(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            original = json.dumps(initial_state())
            path.write_text(original)
            with patch('backend.sync_transaction.os.replace', side_effect=OSError('offline failure')):
                with self.assertRaises(auth.AuthError) as failure:
                    auth.handle_auth('register', {'username': 'alice', 'password': PASSWORD, 'inviteCode': 'TEAM_A'},
                                     lambda: file_session(str(path), lambda: None), now=NOW)
            self.assertEqual(failure.exception.status, 503)
            self.assertEqual(path.read_text(), original)

    def test_postgres_session_locks_and_commits_before_returning_token(self):
        connection = Mock()
        cursor = connection.cursor.return_value
        cursor.fetchone.return_value = (json.dumps(initial_state()),)
        events = []
        connection.commit.side_effect = lambda: events.append('commit')
        result = auth.handle_auth('register', {'username': 'alice', 'password': PASSWORD, 'inviteCode': 'TEAM_A'},
                                  lambda: PostgresSession(lambda: connection, lambda _: None), now=NOW)
        events.append('returned')
        self.assertEqual(events, ['commit', 'returned'])
        self.assertTrue(result['session_token'])
        statements = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertTrue(any('FOR UPDATE' in sql for sql in statements))
        connection.rollback.assert_not_called()
        cursor.close.assert_called_once()
        connection.close.assert_called_once()

    def test_postgres_failed_commit_rolls_back_and_does_not_return_token(self):
        connection = Mock()
        connection.cursor.return_value.fetchone.return_value = (json.dumps(initial_state()),)
        connection.commit.side_effect = OSError('OFFLINE private database detail')
        with self.assertRaises(auth.AuthError) as failure:
            auth.handle_auth('register', {'username': 'alice', 'password': PASSWORD, 'inviteCode': 'TEAM_A'},
                             lambda: PostgresSession(lambda: connection, lambda _: None), now=NOW)
        self.assertEqual(failure.exception.status, 503)
        self.assertNotIn('private database', str(failure.exception))
        connection.rollback.assert_called_once()
        connection.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
