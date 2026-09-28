"""Opt-in integration suite: synthetic data only, never production DSN."""
import concurrent.futures
import os
import unittest
import uuid


@unittest.skipUnless(os.environ.get('HXZ_TEST_DATABASE_URL'), 'explicit isolated PostgreSQL DSN required')
class PostgresTests(unittest.TestCase):
    def setUp(self):
        import psycopg2.extensions
        from identity.postgres import PostgresStore
        dsn = os.environ['HXZ_TEST_DATABASE_URL']
        params = psycopg2.extensions.parse_dsn(dsn)
        if params.get('dbname') != 'hxz_identity_test':
            raise RuntimeError('refusing any database other than hxz_identity_test')
        self.store = PostgresStore(dsn)
        self.store.initialize()
        self.name = 'synthetic-' + uuid.uuid4().hex
        self.org = self.store.create_customer(self.name, 'synthetic password for tests')
        self.token, self.csrf = self.store.login(self.name, 'synthetic password for tests')
        self.principal = self.store.authenticate(self.token)

    def test_isolation_persistence_revocation(self):
        other = self.store.create_customer(self.name + '-other', 'another synthetic password')
        self.store.put_state(self.principal, self.org, {'projects': {'p': {'city': 'same'}}}, 0)
        self.assertEqual(self.store.get_state(self.principal, self.org)['version'], 1)
        with self.assertRaises(PermissionError):
            self.store.get_state(self.principal, other)
        self.store.logout(self.token)
        with self.assertRaises(PermissionError):
            self.store.authenticate(self.token)

    def test_concurrent_version_only_one_wins(self):
        def write(i):
            try:
                self.store.put_state(self.principal, self.org, {'projects': {'p': {'n': i}}}, 0)
                return 'saved'
            except ValueError as e:
                self.assertEqual(str(e), 'version conflict')
                return 'conflict'
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(write, [1, 2]))
        self.assertCountEqual(results, ['saved', 'conflict'])
        self.assertEqual(self.store.get_state(self.principal, self.org)['version'], 1)

    def test_member_revoke_and_old_principal_denied(self):
        uid = self.store.add_member(self.principal, self.name + '-member', 'synthetic member password')
        token, _ = self.store.login(self.name + '-member', 'synthetic member password')
        member = self.store.authenticate(token)
        self.store.put_state(member, self.org, {'projects': {'p': {}}}, 0)
        self.store.remove_member(self.principal, uid)
        with self.assertRaises(PermissionError):
            self.store.get_state(member, self.org)

    def test_service_delivery_replay_and_revocation(self):
        import secrets
        import time
        from identity.services import digest
        self.store.put_state(self.principal, self.org, {'projects': {'p': {}}}, 0)
        token = secrets.token_urlsafe(32)
        # Synthetic fixture only; issuance authority is covered by separate tests.
        with self.store.db() as c:
            c.execute('INSERT INTO service_credentials VALUES(?,?,?,?)', (digest(token), self.org, 'p', time.time()+60))
        first = self.store.deliver_report(token, 'p', 'synthetic report', 1, delivery_id='job-1')
        self.assertEqual(first, self.store.deliver_report(token, 'p', 'synthetic report', 1, delivery_id='job-1'))
        with self.store.db() as c:
            c.execute('DELETE FROM service_credentials WHERE token=?', (digest(token),))
        with self.assertRaises(PermissionError):
            self.store.deliver_report(token, 'p', 'synthetic report', 1, delivery_id='job-1')

    def test_concurrent_delivery_same_id_returns_same_result(self):
        import secrets
        import time
        from identity.services import digest
        self.store.put_state(self.principal, self.org, {'projects': {'p': {}}}, 0)
        token = secrets.token_urlsafe(32)
        with self.store.db() as c:
            c.execute('INSERT INTO service_credentials VALUES(?,?,?,?)', (digest(token), self.org, 'p', time.time()+60))
        def send(_):
            return self.store.deliver_report(token, 'p', 'same report', 1, delivery_id='concurrent-job')
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(send, [1, 2]))
        self.assertEqual(results, [{'ok': True, 'version': 2}] * 2)
        self.assertEqual(self.store.get_state(self.principal, self.org)['version'], 2)

    def test_duplicate_rollback(self):
        with self.store.db() as c:
            before = c.execute('SELECT count(*) FROM organizations').fetchone()[0]
        with self.assertRaises(ValueError):
            self.store.create_customer(self.name.upper(), 'duplicate synthetic password')
        with self.store.db() as c:
            after = c.execute('SELECT count(*) FROM organizations').fetchone()[0]
        self.assertEqual(before, after)


if __name__ == '__main__':
    unittest.main()
