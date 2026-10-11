import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock


SOURCE = Path(__file__).resolve().parents[1] / 'scripts' / 'disaster_recovery.py'
SPEC = importlib.util.spec_from_file_location('disaster_recovery', SOURCE)
dr = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dr)


class DisasterRecoveryTests(unittest.TestCase):
    def test_default_is_inspection(self):
        args = dr.parser().parse_args(['--project', 'p', '--environment', 'e',
                                     '--app-service', 'app', '--database-service', 'pg'])
        self.assertEqual(args.action, 'inspect')
        with mock.patch.object(dr, 'Railway') as factory:
            factory.return_value.inspect.return_value = {'read_only': True}
            result = dr.run(args)
        factory.return_value.pg.assert_not_called()
        factory.return_value.dump.assert_not_called()
        self.assertFalse(result['production_mutated'])

    def test_restore_names_cannot_target_production_or_inject_sql(self):
        for value in ('railway', 'postgres', 'hxz_drill_a', 'hxz_drill_12345678;DROP DATABASE railway',
                      'hxz_drill_ABCdefgh', '../hxz_drill_12345678', '', None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                dr.validate_target(value)
        self.assertEqual(dr.validate_target('hxz_drill_20261011_abcd'), 'hxz_drill_20261011_abcd')

    def test_private_backup_directory_refuses_other_paths_and_existing_target(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'private'
            root.mkdir()
            with mock.patch.object(dr, 'PRIVATE_ROOT', root):
                with self.assertRaises(ValueError):
                    dr.private_directory(Path(temp) / 'public')
                with self.assertRaises(ValueError):
                    dr.private_directory(root)
                result = dr.private_directory(root / 'backup')
                self.assertEqual(result.stat().st_mode & 0o777, 0o700)
                with self.assertRaises(FileExistsError):
                    dr.private_directory(result)

    def test_binary_corruption_detected_including_length_and_nul_bytes(self):
        payload = b'PK\x00\xffsecret original bytes'
        digest, size, valid = dr.binary_check(payload, dr.hashlib.sha256(payload).hexdigest(), len(payload))
        self.assertTrue(valid)
        self.assertEqual(size, len(payload))
        self.assertFalse(dr.binary_check(payload + b'x', digest, size)[2])
        self.assertFalse(dr.binary_check(payload, digest, size + 1)[2])

    def test_relationship_check_has_only_safe_counts(self):
        state = {
            'PROJECTS': {'p': {'city': 'Secret City', 'workspaceId': 'p'}},
            'INVITE_CODES': {'SECRET_CODE': {'city': 'Secret City', 'projKey': 'p'}},
            'CITY_WORKSPACES': {'Secret City': {'projectKey': 'p', 'inviteCode': 'SECRET_CODE', 'ownerUser': 'secretuser'}},
            'USER_PROFILES': {'secretuser': {'passwordHash': 'secret_hash', 'memberships': {'p': {'role': 'owner'}}}},
        }
        result = dr.check_state(state)
        self.assertEqual(result['issues'], {})
        serialized = json.dumps(result)
        for secret in ('Secret City', 'SECRET_CODE', 'secretuser', 'secret_hash'):
            self.assertNotIn(secret, serialized)
        state['INVITE_CODES']['SECRET_CODE']['projKey'] = 'missing'
        state['PROJECTS']['p']['workspaceId'] = 'missing'
        self.assertEqual(dr.check_state(state)['issues'], {
            'project_missing_workspace': 1, 'invite_missing_project': 1,
            'city_project_binding': 1, 'city_invite_binding': 1})

    def test_removed_membership_does_not_count_as_missing_active_project(self):
        state = {'USER_PROFILES': {'u': {'memberships': {
            'removed': {'active': False}, 'deleted': {'deleted': True}}}}}
        self.assertEqual(dr.check_state(state)['issues'], {})

    def test_report_request_engine_and_publication_bindings(self):
        rid = 'request1'
        engine = dr.hashlib.sha256(('full-v1\0website-report-queue\0' + rid).encode()).hexdigest()
        state = {'PROJECTS': {'p': {}}, 'REPORT_REQUESTS': [
            {'id': rid, 'engine': 'full-v1', 'status': 'done'},
            {'id': 'queued', 'engine': 'full-v1', 'status': 'pending'}],
            'REPORT_PUBLICATIONS': {rid: {'projectKey': 'p', 'engineReportId': engine}}}
        good = dr.check_report_links(state, {engine: 'completed'})
        self.assertEqual(dr.issue_count({'relationships': {'report_links': good}}), 0)
        state['REPORT_PUBLICATIONS'][rid] = {'projectKey': 'missing', 'engineReportId': 'wrong'}
        bad = dr.check_report_links(state, {})
        self.assertEqual(bad['missing_engine'], 1)
        self.assertEqual(bad['missing_project'], 1)
        self.assertEqual(bad['publication_engine_mismatch'], 1)

    def test_upload_references_check_metadata_without_treating_legacy_as_lost_backup(self):
        state = {'UPLOADS': {'p': [{'name': 'old document'},
            {'originalId': 'good', 'originalSha256': 'abc', 'size': 3},
            {'originalId': 'wrong', 'originalSha256': 'bad'}, {'originalId': 'missing'}]},
            'PROJECTS': {'p': {'kbUploads': [{'originalId': 'good', 'size': 3}]}}}
        result = dr.check_upload_references(state, {('p', 'good'): ('abc', 3), ('p', 'wrong'): ('abc', 3)})
        self.assertEqual(result, dict(missing_reference=1, reference_mismatch=1, historical_text_only_references=1))
        self.assertEqual(dr.issue_count({'relationships': {'upload_originals': result}}), 2)

    def test_integrity_issues_do_not_count_object_counts_or_bytes(self):
        self.assertEqual(dr.issue_count({'binary': {'a': {'count': 19, 'bytes': 900, 'invalid': 0}},
            'relationships': {'app_state': {'counts': {'users': 5}, 'issues': {}},
                              'completed_report_files': {'entries': 19, 'missing': 0, 'mismatch': 0}}}), 0)
        self.assertEqual(dr.issue_count({'binary': {'a': {'invalid': 1}}, 'relationships': {
            'app_state': {'issues': {'orphan': 2}}, 'x_report_orphans': 3,
            'upload_originals': {'missing_reference': 4, 'missing_project': 5}}}), 15)

    def test_inspector_source_is_standalone_and_read_only(self):
        code = dr.inspection_program('hxz_drill_20261011_abcd')
        compile(code, '<remote-inspection>', 'exec')
        self.assertIn("readonly=True", code)
        self.assertIn("isolation_level='REPEATABLE READ'", code)
        self.assertNotIn('FullStore', code)
        for mutation in ('INSERT INTO', 'UPDATE public.', 'DELETE FROM', 'CREATE TABLE'):
            self.assertNotIn(mutation, code)
        compile(dr.bucket_drill_program('hxz/production/postgres/v1/backups/20261011T010000Z-123456789abc.manifest.json'),
                '<remote-bucket-drill>', 'exec')

    def _bucket_fixture(self, *, restore_returncode=0):
        data = b'PGDMP\x00fake complete database'
        manifest = dict(backup_id='20261011T010000Z-123456789abc', created_at='2026-10-11T01:00:00Z',
            plain_sha256=dr.hashlib.sha256(data).hexdigest(), plain_bytes=len(data),
            cipher_sha256=dr.hashlib.sha256(data).hexdigest(), cipher_bytes=len(data),
            object_key='cipher', key_fingerprint='key-fingerprint')
        job = mock.MagicMock()
        job.prefix_from.return_value = 'hxz/production/postgres/v1'
        job.read_small_object.return_value = json.dumps(manifest).encode()
        job.key_fingerprint.return_value = 'key-fingerprint'
        job.validate_manifest.return_value = object()
        job.s3_client.return_value.get_object.return_value = {'Body': io.BytesIO(data)}
        job.digest_file.side_effect = lambda path: dr.hashlib.sha256(Path(path).read_bytes()).hexdigest()
        job.decrypt_file.side_effect = lambda source, target, key: Path(target).write_bytes(Path(source).read_bytes())
        pg = mock.MagicMock()
        connection = pg.connect.return_value
        connection.get_dsn_parameters.return_value = {'dbname': 'railway'}
        extensions = types.SimpleNamespace(parse_dsn=lambda value: dict(
            host='db.internal', port='5432', user='backup-user', password='never-log-this'))
        patches = contextlib.ExitStack()
        patches.enter_context(mock.patch.dict('sys.modules', {'psycopg2': pg, 'psycopg2.extensions': extensions}))
        patches.enter_context(mock.patch('importlib.import_module', return_value=job))
        patches.enter_context(mock.patch.dict(dr.os.environ, {'DATABASE_URL': 'private-url', 'S3_BUCKET': 'bucket'}))
        process = patches.enter_context(mock.patch.object(dr.subprocess, 'run',
            return_value=argparse.Namespace(returncode=restore_returncode)))
        patches.enter_context(mock.patch.object(dr, 'inspect_database', return_value={
            'tables': {'public.upload_originals': {'count': 1}}, 'binary': {}, 'relationships': {}}))
        self.addCleanup(patches.close)
        return job, pg, process

    def test_bucket_drill_verifies_download_and_keeps_credentials_out_of_arguments(self):
        job, pg, process = self._bucket_fixture()
        result = dr.restore_bucket_backup('hxz/production/postgres/v1/backups/20261011T010000Z-123456789abc.manifest.json')
        self.assertTrue(result['cipher_verified'])
        self.assertTrue(result['plaintext_verified'])
        self.assertTrue(result['integrity_passed'])
        self.assertTrue(result['cleanup_complete'])
        self.assertEqual(pg.connect.return_value.cursor.return_value.__enter__.return_value.execute.call_count, 2)
        command = process.call_args.args[0]
        self.assertNotIn('never-log-this', ' '.join(command))
        self.assertEqual(process.call_args.kwargs['env']['PGPASSWORD'], 'never-log-this')
        self.assertRegex(process.call_args.kwargs['env']['PGDATABASE'], r'^hxz_drill_')
        self.assertNotIn('never-log-this', json.dumps(result))

    def test_bucket_drill_rejects_cipher_before_creating_database(self):
        job, pg, process = self._bucket_fixture()
        job.digest_file.return_value = 'bad'
        job.digest_file.side_effect = None
        result = dr.restore_bucket_backup('hxz/production/postgres/v1/backups/20261011T010000Z-123456789abc.manifest.json')
        self.assertEqual(result['error_code'], 'cipher_download_failed')
        self.assertFalse(result['restore_complete'])
        pg.connect.assert_not_called()
        process.assert_not_called()

    def test_bucket_drill_drops_only_owned_temporary_database_after_restore_failure(self):
        job, pg, process = self._bucket_fixture(restore_returncode=1)
        result = dr.restore_bucket_backup('hxz/production/postgres/v1/backups/20261011T010000Z-123456789abc.manifest.json')
        self.assertEqual(result['error_code'], 'restore_archive_failed')
        self.assertTrue(result['cleanup_complete'])
        self.assertFalse(result['restore_complete'])
        self.assertEqual(pg.connect.return_value.cursor.return_value.__enter__.return_value.execute.call_count, 2)

    def test_bucket_drill_invalid_manifest_never_creates_database(self):
        job, pg, process = self._bucket_fixture()
        job.validate_manifest.return_value = None
        result = dr.restore_bucket_backup('hxz/production/postgres/v1/backups/20261011T010000Z-123456789abc.manifest.json')
        self.assertEqual(result['error_code'], 'manifest_validation_failed')
        pg.connect.assert_not_called()
        process.assert_not_called()

    def test_ssh_error_never_echoes_credentials(self):
        args = argparse.Namespace(railway='railway', project='p', environment='e')
        with mock.patch.object(dr.subprocess, 'run', return_value=argparse.Namespace(
                returncode=1, stdout=b'postgres://secret_password', stderr=b'API_TOKEN=secret')):
            with self.assertRaises(RuntimeError) as raised:
                dr.Railway(args).ssh('pg', ['psql'])
        self.assertNotIn('secret', str(raised.exception))

    def test_dump_requires_custom_format_and_sets_private_permissions(self):
        with tempfile.TemporaryDirectory() as temp:
            args = argparse.Namespace()
            railway = dr.Railway(args)
            good = b'PGDMP\x00binary\xff'
            with mock.patch.object(railway, 'pg', return_value=b'notice\nHXZ_DUMP_BEGIN\n' +
                    dr.base64.b64encode(good) + b'\nHXZ_DUMP_END\n'):
                path = Path(temp) / 'db.dump'
                result = railway.dump('/tmp/a', path)
                self.assertEqual(path.read_bytes(), good)
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(result['sha256'], dr.hashlib.sha256(good).hexdigest())
            with mock.patch.object(railway, 'pg', return_value=b'HXZ_DUMP_BEGIN\nYWJj\nHXZ_DUMP_END\n'):
                with self.assertRaises(RuntimeError):
                    railway.dump('/tmp/a', Path(temp) / 'bad.dump')

    def _args(self, path):
        return argparse.Namespace(action='drill', target_database='hxz_drill_20261011_abcd', directory=str(path))

    def test_failed_create_never_drops_preexisting_database(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / 'backup'
            directory.mkdir()
            with mock.patch.object(dr, 'private_directory', return_value=directory), mock.patch.object(dr, 'Railway') as factory:
                instance = factory.return_value
                instance.dump.return_value = {'sha256': 'hash'}
                instance.pg.side_effect = RuntimeError('failed')
                with self.assertRaises(RuntimeError):
                    dr.run(self._args(directory))
                instance.cleanup.assert_called_once()
                self.assertIsNone(instance.cleanup.call_args.args[1])
            self.assertFalse(json.loads((directory / 'manifest.json').read_text())['restore_complete'])

    def test_successful_drill_cleans_owned_target_and_persists_safe_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / 'backup'; directory.mkdir()
            with mock.patch.object(dr, 'private_directory', return_value=directory), mock.patch.object(dr, 'Railway') as factory:
                instance = factory.return_value
                instance.dump.return_value = {'sha256': 'hash', 'bytes': 10}
                instance.inspect.return_value = {'binary': {}, 'relationships': {}, 'tables': {'public.t': {'count': 2}}}
                result = dr.run(self._args(directory))
                self.assertTrue(result['integrity_passed'])
                self.assertTrue(result['cleanup_complete'])
                self.assertFalse(result['application_started'])
                instance.cleanup.assert_called_once_with(mock.ANY, 'hxz_drill_20261011_abcd')
                self.assertEqual(instance.pg.call_count, 2)
                self.assertEqual(json.loads((directory / 'manifest.json').read_text()), result)


if __name__ == '__main__':
    unittest.main()
