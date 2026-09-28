import tempfile
import unittest
from pathlib import Path
from identity.store import Store


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = Store(Path(self.tmp.name) / 'test.db')
        self.org = self.s.create_customer('a', 'synthetic password A')
        self.s.bootstrap_admin('platform', 'synthetic admin password')
        self.admin = self.s.authenticate(self.s.login('platform', 'synthetic admin password')[0])
        self.user = self.s.authenticate(self.s.login('a', 'synthetic password A')[0])
        self.s.put_state(self.user, self.org, {'projects': {'p': {}}}, 0)

    def tearDown(self):
        self.tmp.cleanup()

    def test_only_live_platform_admin_can_issue_and_revoke(self):
        with self.assertRaises(PermissionError):
            self.s.issue_service(self.user, self.org, 'p')
        token = self.s.issue_service(self.admin, self.org, 'p')
        self.assertNotIn(token.encode(), Path(self.s.path).read_bytes())
        principal = self.s.authenticate_service(token)
        self.assertEqual(principal['org_id'], self.org)
        self.assertEqual(principal['project_id'], 'p')
        self.s.revoke_service(self.admin, token)
        with self.assertRaises(PermissionError):
            self.s.authenticate_service(token)

    def test_service_cannot_use_customer_state_or_forge_project(self):
        token = self.s.issue_service(self.admin, self.org, 'p')
        principal = self.s.authenticate_service(token)
        with self.assertRaises(PermissionError):
            self.s.get_state(principal, self.org)
        self.s.deliver_report(token, 'p', 'synthetic report', 1)
        self.assertEqual(self.s.get_state(self.user, self.org)['data']['reports']['p']['text'], 'synthetic report')
        with self.assertRaises(PermissionError):
            self.s.deliver_report(token, 'foreign', 'wrong', 2)
        with self.assertRaises(ValueError):
            self.s.deliver_report(token, 'p', 'stale', 1)

    def test_delivery_replay_idempotent_and_payload_conflict(self):
        token = self.s.issue_service(self.admin, self.org, 'p')
        first = self.s.deliver_report(token, 'p', 'once', 1, delivery_id='job-1')
        second = self.s.deliver_report(token, 'p', 'once', 1, delivery_id='job-1')
        self.assertEqual(first, second)
        self.assertEqual(self.s.get_state(self.user, self.org)['version'], 2)
        with self.assertRaises(ValueError):
            self.s.deliver_report(token, 'p', 'different', 1, delivery_id='job-1')
        self.s.revoke_service(self.admin, token)
        with self.assertRaises(PermissionError):
            self.s.deliver_report(token, 'p', 'once', 1, delivery_id='job-1')

    def test_missing_project_and_expired_credentials_denied(self):
        with self.assertRaises(ValueError):
            self.s.issue_service(self.admin, self.org, 'missing')
        token = self.s.issue_service(self.admin, self.org, 'p', ttl=-1)
        with self.assertRaises(PermissionError):
            self.s.deliver_report(token, 'p', 'report', 1)


if __name__ == '__main__':
    unittest.main()
