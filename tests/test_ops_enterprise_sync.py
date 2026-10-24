"""Administrator enterprise changes must survive later browser snapshots."""
import copy
import io
import json
import unittest
from unittest.mock import Mock

from backend.access_control import guard_sync, scoped_sync_view
from backend.auth import AuthError
from backend.sync_route import SyncDependencies, handle_sync


ADMIN = {'scope': 'admin', 'user': 'admin'}
MEMBER = {'scope': 'project', 'user': 'member', 'projKey': 'p', 'projectKeys': ['p']}


class EnterpriseSyncTests(unittest.TestCase):
    def setUp(self):
        self.state = {'PROJECTS': {'p': {'id': 'p', 'city': '测试城市', 'workspaceId': 'p'}},
                      'OPS_ENT': [{'id': 'one', 'name': '企业甲'},
                                  {'id': 'two', 'name': '企业乙'}]}
        self.writes = []

    def sync(self, payload, principal=ADMIN, fail_write=False):
        raw = guard_sync(json.dumps(payload).encode(), self.state, principal)
        def write(value):
            if fail_write:
                return False
            self.writes.append(value)
            self.state = json.loads(value)
            return True
        deps = SyncDependencies(True, lambda: json.dumps(self.state), write,
                                'unused', lambda: None, lambda value: value)
        responder = Mock()
        responder.wfile = io.BytesIO()
        handle_sync(responder, raw, deps)
        return json.loads(responder.wfile.getvalue())

    def test_delete_and_stale_snapshot_do_not_resurrect_enterprise(self):
        stale = copy.deepcopy(self.state)
        self.assertTrue(self.sync({'DELETED_OPS_ENT': ['one']})['ok'])
        self.assertEqual([row['id'] for row in self.state['OPS_ENT']], ['two'])
        self.assertTrue(self.sync(stale)['ok'])
        self.assertEqual([row['id'] for row in self.state['OPS_ENT']], ['two'])
        self.assertEqual(self.state['DELETED_OPS_ENT'], ['one'])

    def test_last_enterprise_deletion_is_an_explicit_nonempty_delta(self):
        self.state['OPS_ENT'] = [{'id': 'last', 'name': '最后一家'}]
        self.assertTrue(self.sync({'DELETED_OPS_ENT': ['last']})['ok'])
        self.assertEqual(self.state['OPS_ENT'], [])
        self.assertEqual(self.state['DELETED_OPS_ENT'], ['last'])

    def test_empty_enterprise_snapshot_retains_existing_guard(self):
        before = copy.deepcopy(self.state)
        result = self.sync({'OPS_ENT': []})
        self.assertEqual(result, {'ok': False, 'rejected': 'empty-payload'})
        self.assertEqual(self.state, before)
        self.assertEqual(self.writes, [])

    def test_legacy_numeric_id_is_deleted_by_its_string_identity(self):
        for identity in (42, 42.0):
            with self.subTest(identity=identity):
                self.state['OPS_ENT'] = [{'id': identity, 'name': '旧数据'}]
                self.assertTrue(self.sync({'DELETED_OPS_ENT': ['42']})['ok'])
                self.assertEqual(self.state['OPS_ENT'], [])

    def test_tombs_are_unioned_and_new_identity_can_reimport_same_name(self):
        self.assertTrue(self.sync({'DELETED_OPS_ENT': ['one']})['ok'])
        self.assertTrue(self.sync({'OPS_ENT': [{'id': 'new', 'name': '企业甲'}],
                                   'DELETED_OPS_ENT': ['two', 'two']})['ok'])
        self.assertEqual(self.state['DELETED_OPS_ENT'], ['one', 'two'])
        self.assertEqual(self.state['OPS_ENT'], [{'id': 'new', 'name': '企业甲'}])

    def test_member_cannot_write_even_an_empty_deletion_list(self):
        for tombs in (['one'], []):
            with self.subTest(tombs=tombs), self.assertRaises(AuthError) as rejected:
                self.sync({'DELETED_OPS_ENT': tombs}, MEMBER)
            self.assertEqual(rejected.exception.status, 403)
        self.assertEqual(self.writes, [])
        self.assertNotIn('DELETED_OPS_ENT', scoped_sync_view(self.state, MEMBER))

    def test_invalid_deletion_payload_refuses_the_whole_write(self):
        for tombs in (None, 'one', {}, [None], [1], [[]], [''], [' one'], ['one\n'], ['a' * 257]):
            with self.subTest(tombs=tombs):
                before = copy.deepcopy(self.state)
                result = self.sync({'OPS_ENT': [{'id': 'new', 'name': '不得写入'}],
                                    'DELETED_OPS_ENT': tombs})
                self.assertFalse(result['ok'])
                self.assertEqual(self.state, before)
        self.assertEqual(self.writes, [])

    def test_enterprise_payload_must_be_a_list_of_objects(self):
        for value in ({'id': 'one'}, 'one', None, [None], ['one']):
            with self.subTest(value=value):
                before = copy.deepcopy(self.state)
                result = self.sync({'OPS_ENT': value, 'DELETED_OPS_ENT': ['one']})
                self.assertFalse(result['ok'])
                self.assertEqual(self.state, before)

    def test_failed_storage_does_not_acknowledge_or_remove_rows(self):
        before = copy.deepcopy(self.state)
        self.assertFalse(self.sync({'DELETED_OPS_ENT': ['one']}, fail_write=True)['ok'])
        self.assertEqual(self.state, before)

    def test_import_snapshot_persists_and_does_not_erase_deletion_history(self):
        self.assertTrue(self.sync({'DELETED_OPS_ENT': ['one']})['ok'])
        self.assertTrue(self.sync({'OPS_ENT': [{'id': 'csv-1', 'name': '导入企业一'},
                                              {'id': 'csv-2', 'name': '导入企业二'}]})['ok'])
        self.assertEqual([row['id'] for row in self.state['OPS_ENT']], ['csv-1', 'csv-2'])
        self.assertEqual(self.state['DELETED_OPS_ENT'], ['one'])


if __name__ == '__main__':
    unittest.main()
