import unittest
import test_identity_authorization as fixture

class MemberTests(unittest.TestCase):
    setUp = fixture.AuthorizationTests.setUp
    tearDown = fixture.AuthorizationTests.tearDown

    def test_admin_add_member_same_org_and_revoke(self):
        self.store.add_member(self.p, 'member', 'synthetic member password')
        token, _ = self.store.login('member', 'synthetic member password')
        member = self.store.authenticate(token)
        self.assertEqual(member['org_id'], self.a)
        self.assertEqual(member['role'], 'org_member')
        self.store.put_state(member, self.a, {'projects': {}}, 0)
        with self.assertRaises(PermissionError):
            self.store.add_member(member, 'escalate', 'synthetic password no')
        with self.assertRaises(PermissionError):
            self.store.get_state(member, self.b)
        self.store.remove_member(self.p, member['id'])
        with self.assertRaises(PermissionError):
            self.store.authenticate(token)
        with self.assertRaises(PermissionError):
            self.store.login('member', 'synthetic member password')

    def test_cannot_remove_other_org_or_self(self):
        b = self.store.authenticate(self.store.login('b', 'synthetic password B')[0])
        for uid in [b['id'], self.p['id']]:
            with self.assertRaises(PermissionError):
                self.store.remove_member(self.p, uid)
        self.assertEqual(self.store.get_state(b, self.b)['version'], 0)

    def test_revoked_admin_cannot_add(self):
        self.store.logout(self.token)
        with self.assertRaises(PermissionError):
            self.store.add_member(self.p, 'new', 'synthetic password here')
