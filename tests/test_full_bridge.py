import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from report_service.full_bridge import BridgeError, FullReportBridge, TenantCredential


class FullBridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / 'bridge.sqlite'
        self.session = object()
        self.csrf = object()
        self.principal = {'org_id': 'org-a', 'user_id': 'user-a'}
        self.auth_calls = []
        self.calls = []
        self.remote = {}
        self.fail_after_create = False
        self.maps = {'org-a': TenantCredential('tenant-a', 'private-token-a'),
                     'org-b': TenantCredential('tenant-b', 'private-token-b')}
        self.bridge = self.build(enabled=True)

    def authorize(self, session, project, action):
        self.auth_calls.append((session, project, action))
        return self.principal

    def client(self, action, **kw):
        self.calls.append((action, kw))
        if action == 'create':
            key = (kw['tenant_id'], kw['idempotency_key'])
            self.remote.setdefault(key, 'external-' + str(len(self.remote)))
            if self.fail_after_create:
                self.fail_after_create = False
                raise RuntimeError(kw['credential'])
            return {'id': self.remote[key], 'credential': kw['credential']}
        if action == 'get':
            return {'status': 'completed', 'artifacts': ['report.docx'],
                    'credential': kw['credential'], 'url': 'secret remote URL'}
        return b'synthetic docx bytes'

    def build(self, **kwargs):
        return FullReportBridge(self.db, authorize=self.authorize, tenants=self.maps,
                                client=self.client,
                                validate_csrf=lambda session, context:
                                session is self.session and context is self.csrf, **kwargs)

    def create(self, payload=None, key='key', project='project-a', context=None):
        return self.bridge.create(self.session, project, payload or {'city': 'test'}, key,
                                  csrf_context=self.csrf if context is None else context)

    def error(self, status, fn):
        with self.assertRaises(BridgeError) as caught:
            fn()
        self.assertEqual(status, caught.exception.status)
        self.assertNotIn('private-token', str(caught.exception))

    def test_default_closed_all_operations(self):
        self.bridge = self.build()
        self.error(503, self.create)
        self.error(503, lambda: self.bridge.get(self.session, 'p', 'id'))
        self.error(503, lambda: self.bridge.artifact(self.session, 'p', 'id', 'report.docx'))
        self.assertEqual([], self.calls)
        self.assertEqual([], self.auth_calls)

    def test_every_call_reauthorizes_exact_session_project_action(self):
        report = self.create()['id']
        self.create()
        self.bridge.get(self.session, 'project-a', report)
        self.bridge.artifact(self.session, 'project-a', report, 'report.docx')
        self.assertEqual([(self.session, 'project-a', action)
                          for action in ('create', 'create', 'get', 'artifact')], self.auth_calls)

    def test_cross_org_and_foreign_project_reads_downloads_are_404(self):
        report = self.create()['id']
        for principal, project, report_id in [
                ({'org_id': 'org-b', 'user_id': 'user-b'}, 'project-a', report),
                (self.principal, 'foreign-project', report),
                (self.principal, 'project-a', 'external-0'),
                (self.principal, 'project-a', 'unknown')]:
            self.principal = principal
            before = len(self.calls)
            self.error(404, lambda: self.bridge.get(self.session, project, report_id))
            self.error(404, lambda: self.bridge.artifact(self.session, project, report_id, 'report.docx'))
            self.assertEqual(before, len(self.calls))

    def test_revocation_blocks_reads_downloads_and_idempotent_create(self):
        report = self.create()['id']
        for revoked in (None, False, {}, {'org_id': 'org-a'}, {'org_id': '', 'user_id': 'u'}):
            self.principal = revoked
            self.error(404, lambda: self.bridge.get(self.session, 'project-a', report))
            self.error(404, lambda: self.bridge.artifact(self.session, 'project-a', report, 'report.docx'))
            self.error(404, self.create)
        self.assertEqual(1, len(self.calls))

    def test_authorizer_exception_is_closed(self):
        def revoked(*args):
            raise RuntimeError('private-token-a')
        self.bridge.authorize = revoked
        self.error(404, self.create)
        self.assertEqual([], self.calls)

    def test_csrf_requires_host_evidence_not_browser_boolean(self):
        for context in (True, False, 'true', {'csrf': True}, object()):
            self.error(403, lambda: self.create(context=context))
        self.error(403, lambda: self.bridge.create(self.session, 'project-a', {}, 'k', csrf_context=None))
        self.assertEqual([], self.calls)
        self.create()

    def test_durable_idempotency_payload_project_user_conflicts(self):
        first = self.create({'a': 1, 'b': 2})
        self.bridge = self.build(enabled=True)
        self.assertEqual(first, self.create({'b': 2, 'a': 1}))
        self.error(409, lambda: self.create({'a': 2}))
        self.error(409, lambda: self.create({'a': 1, 'b': 2}, project='other'))
        self.principal = {'org_id': 'org-a', 'user_id': 'other-user'}
        self.error(409, lambda: self.create({'a': 1, 'b': 2}))
        self.assertEqual(1, len(self.calls))
        with sqlite3.connect(self.db) as db:
            self.assertEqual(('org-a', 'project-a', 'user-a', 'external-0'),
                             db.execute('SELECT org,project,user,external FROM bridge_reports').fetchone())
        self.principal = {'org_id': 'org-b', 'user_id': 'user-b'}
        self.assertNotEqual(first, self.create({'a': 1, 'b': 2}))

    def test_uncertain_remote_success_replays_durable_key_after_restart(self):
        self.fail_after_create = True
        self.error(502, self.create)
        self.bridge = self.build(enabled=True)
        self.error(409, lambda: self.create({'different': True}))
        self.create()
        self.assertEqual(1, len(self.remote))
        self.assertEqual(self.calls[0][1]['idempotency_key'], self.calls[1][1]['idempotency_key'])

    def test_missing_mapping_switched_tenant_and_shared_tenant_rejected(self):
        report = self.create()['id']
        for mapping in ({}, {'org-a': TenantCredential('switched', 'private-new')}):
            self.bridge.tenants = mapping
            self.error(404, self.create)
            self.error(404, lambda: self.bridge.get(self.session, 'project-a', report))
            self.error(404, lambda: self.bridge.artifact(self.session, 'project-a', report, 'report.docx'))
        self.principal = {'org_id': 'org-b', 'user_id': 'u'}
        self.bridge.tenants = {'org-b': self.maps['org-a']}
        self.error(404, self.create)
        self.assertEqual(1, len(self.calls))

    def test_browser_outputs_and_errors_exclude_credentials(self):
        created = self.create()
        status = self.bridge.get(self.session, 'project-a', created['id'])
        content = self.bridge.artifact(self.session, 'project-a', created['id'], 'report.docx')
        self.assertNotIn('private-token', json.dumps([created, status]))
        self.assertNotIn(b'private-token', content)
        self.assertEqual({'id', 'status', 'artifacts'}, set(status))
        self.assertNotIn('private-token', repr(self.maps['org-a']))
        self.assertTrue(all(kw['credential'] == 'private-token-a' for _, kw in self.calls))

    def test_manifest_membership_and_path_rejection(self):
        report = self.create()['id']
        for name in ('../secret', '/secret', 'foreign.docx', 'report.docx/../../secret'):
            self.error(404, lambda: self.bridge.artifact(self.session, 'project-a', report, name))
        self.assertFalse(any(action == 'artifact' for action, _ in self.calls))

    def test_credential_in_remote_artifact_is_not_forwarded(self):
        report = self.create()['id']
        original = self.bridge.client
        self.bridge.client = lambda action, **kw: (b'private-token-a' if action == 'artifact'
                                                   else original(action, **kw))
        self.error(502, lambda: self.bridge.artifact(self.session, 'project-a', report, 'report.docx'))


if __name__ == '__main__':
    unittest.main()
