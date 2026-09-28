import importlib.util
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class IdentityTests(unittest.TestCase):
    def setUp(self):
        from identity.store import Store
        self.tmp = tempfile.TemporaryDirectory()
        self.s = Store(pathlib.Path(self.tmp.name) / 'test.sqlite')
        self.a = self.s.create_customer('alice', 'correct horse battery A')
        self.b = self.s.create_customer('bob', 'correct horse battery B')

    def tearDown(self):
        self.tmp.cleanup()

    def test_password_and_session_not_stored_plaintext(self):
        token, csrf = self.s.login('alice', 'correct horse battery A')
        raw = pathlib.Path(self.s.path).read_bytes()
        self.assertNotIn(b'correct horse battery A', raw)
        self.assertNotIn(token.encode(), raw)
        self.assertNotIn(csrf.encode(), raw)
        self.assertEqual(self.s.authenticate(token)['org_id'], self.a)

    def test_wrong_password_denied(self):
        with self.assertRaises(PermissionError):
            self.s.login('alice', 'wrong')

    def test_org_isolation_and_conflicts(self):
        a = self.s.authenticate(self.s.login('alice', 'correct horse battery A')[0])
        b = self.s.authenticate(self.s.login('bob', 'correct horse battery B')[0])
        self.s.put_state(a, self.a, {'projects': {'p': {'city': 'same'}}}, 0)
        with self.assertRaises(PermissionError):
            self.s.get_state(b, self.a)
        self.assertEqual(self.s.get_state(b, self.b)['data'], {})
        with self.assertRaises(ValueError):
            self.s.put_state(a, self.a, {}, 0)
        with self.assertRaises(ValueError):
            self.s.put_state(a, self.a, {'roles': ['platform_admin']}, 1)

    def test_logout_and_expiration(self):
        token, _ = self.s.login('alice', 'correct horse battery A')
        self.s.logout(token)
        with self.assertRaises(PermissionError):
            self.s.authenticate(token)
        token, _ = self.s.login('alice', 'correct horse battery A', ttl=-1)
        with self.assertRaises(PermissionError):
            self.s.authenticate(token)

    def test_explicit_admin_separate(self):
        self.s.bootstrap_admin('platform', 'dedicated administrator password')
        admin = self.s.authenticate(self.s.login('platform', 'dedicated administrator password')[0])
        self.assertEqual(admin['role'], 'platform_admin')
        self.assertIsNone(admin['org_id'])
        with self.assertRaises(PermissionError):
            self.s.get_state(admin, self.a)
        with self.assertRaises(ValueError):
            self.s.bootstrap_admin('other', 'another administrator password')

    def test_csrf_and_duplicate_account(self):
        token, csrf = self.s.login('alice', 'correct horse battery A')
        self.s.authenticate(token, csrf=csrf)
        with self.assertRaises(PermissionError):
            self.s.authenticate(token, csrf='fake')
        with self.assertRaises(ValueError):
            self.s.create_customer(' ALICE ', 'duplicate password long')


class MigrationTests(unittest.TestCase):
    def test_deterministic_explicit_only_and_redacted(self):
        from identity.migration import preview
        s = {'USER_PROFILES': {'Alice': {'pwd': 'secret', 'phone': '123', 'projKey': 'p'},
                               'Bob': {'city': 'same'}},
             'PROJECTS': {'p': {'city': 'same'}, 'q': {'city': 'same'}}}
        a = preview(s)
        self.assertEqual(a, preview(s))
        self.assertEqual(len(a['assignments']), 1)
        self.assertEqual(a['unassigned'], ['q'])
        self.assertNotIn('secret', str(a))
        self.assertNotIn('phone', str(a))

    def test_conflict_shared_orphan(self):
        from identity.migration import preview
        s = {'USER_PROFILES': {'a': {'projKey': 'p'}, 'b': {'projKey': 'p'}, 'c': {'projKey': 'missing'}},
             'CITY_ACCOUNTS': {'a': {'projKey': 'q'}}, 'PROJECTS': {'p': {}, 'q': {}}}
        r = preview(s)
        self.assertEqual(r['assignments'], {})
        self.assertEqual(r['unassigned'], ['p', 'q'])
        self.assertTrue(r['issues'])


if __name__ == '__main__':
    unittest.main()
