import unittest
import tempfile
from pathlib import Path
from identity.store import Store


class AuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / 'test.db')
        self.a = self.store.create_customer('a', 'synthetic password A')
        self.b = self.store.create_customer('b', 'synthetic password B')
        self.token, _ = self.store.login('a', 'synthetic password A')
        self.p = self.store.authenticate(self.token)

    def tearDown(self):
        self.tmp.cleanup()

    def test_forged_principal_cannot_cross_org(self):
        forged = dict(self.p, org_id=self.b)
        with self.assertRaises(PermissionError):
            self.store.get_state(forged, self.b)
        with self.assertRaises(PermissionError):
            self.store.put_state(forged, self.b, {}, 0)

    def test_revoked_session_cannot_reuse_principal(self):
        self.store.logout(self.token)
        with self.assertRaises(PermissionError):
            self.store.get_state(self.p, self.a)
        with self.assertRaises(PermissionError):
            self.store.put_state(self.p, self.a, {}, 0)

    def test_membership_change_cannot_reuse_principal(self):
        with self.store.db() as c:
            c.execute('UPDATE users SET org_id=? WHERE id=?', (self.b, self.p['id']))
        with self.assertRaises(PermissionError):
            self.store.get_state(self.p, self.a)


if __name__ == '__main__':
    unittest.main()
