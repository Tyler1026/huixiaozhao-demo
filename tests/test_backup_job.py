import base64
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import backup_job as job


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.metadata = {}
        self.deleted = []
        self.corrupt_upload = False
        self.fail_manifest = False
        self.head_wrong = False
    def upload_file(self, path, bucket, key, ExtraArgs):
        self.objects[key] = Path(path).read_bytes()
        if self.corrupt_upload:
            self.objects[key] = self.objects[key][:-1] + bytes([self.objects[key][-1] ^ 1])
        self.metadata[key] = ExtraArgs['Metadata']
    def head_object(self, Bucket, Key):
        return {'ContentLength': len(self.objects[Key]) + int(self.head_wrong),
                'Metadata': self.metadata.get(Key, {})}
    def get_object(self, Bucket, Key):
        return {'Body': io.BytesIO(self.objects[Key])}
    def put_object(self, Bucket, Key, Body, **kwargs):
        if self.fail_manifest:
            raise RuntimeError('SENSITIVE_REMOTE_MESSAGE')
        self.objects[Key] = Body
    def get_paginator(self, name):
        outer = self
        class Pages:
            def paginate(self, Bucket, Prefix):
                yield {'Contents': [{'Key': k} for k in list(outer.objects) if k.startswith(Prefix)]}
        return Pages()
    def delete_object(self, Bucket, Key):
        self.deleted.append(Key)
        del self.objects[Key]


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.key = bytes(range(32))
        self.env = {'HXZ_BACKUP_ENCRYPTION_KEY': base64.b64encode(self.key).decode(), 'S3_BUCKET': 'private'}
        self.now = datetime(2026, 10, 11, 3, tzinfo=timezone.utc)
        self.client = FakeS3()
    def dump(self, path, env):
        Path(path).write_bytes(b'PGDMP-TEST-ARCHIVE\x00' * 80)
    def run_job(self, now=None):
        return job.run(self.env, client=self.client, now=now or self.now, dump=self.dump)
    def manifest(self, created, *, suffix='a' * 12, prefix='hxz/production/postgres/v1'):
        ident = created.strftime('%Y%m%dT%H%M%SZ') + '-' + suffix
        root = prefix + '/backups/' + ident
        data = {'tool': job.TOOL, 'manifest_version': 1, 'backup_id': ident,
                'created_at': job.iso_utc(created), 'format': 'postgres-custom',
                'schema_version': 'hxz-persistence-v1', 'cipher_format': 'HXZBKUP1-AES-256-GCM',
                'object_key': root + '.dump.aesgcm', 'plain_sha256': 'a'*64,
                'cipher_sha256': 'b'*64, 'plain_bytes': 100, 'cipher_bytes': 136,
                'key_fingerprint': job.key_fingerprint(self.key)}
        key = root + '.manifest.json'
        self.client.objects[key] = json.dumps(data).encode()
        self.client.objects[data['object_key']] = b'x' * 136
        self.client.metadata[data['object_key']] = {'tool': job.TOOL, 'sha256': 'b'*64}
        return key, data
    def test_authenticated_roundtrip_random_nonce(self):
        with tempfile.TemporaryDirectory() as d:
            src, a, b, out = [Path(d) / n for n in ('source', 'a', 'b', 'out')]
            src.write_bytes(b'private report' * 10000)
            job.encrypt_file(src, a, self.key)
            job.encrypt_file(src, b, self.key)
            self.assertNotEqual(a.read_bytes(), b.read_bytes())
            self.assertEqual(a.stat().st_size, src.stat().st_size + 36)
            job.decrypt_file(a, out, self.key)
            self.assertEqual(src.read_bytes(), out.read_bytes())
            self.assertEqual(out.stat().st_mode & 0o777, 0o600)
    def test_tampered_or_wrong_key_never_publishes_plaintext(self):
        with tempfile.TemporaryDirectory() as d:
            src, cipher, out = [Path(d) / n for n in ('source','cipher','out')]
            src.write_bytes(b'private')
            job.encrypt_file(src, cipher, self.key)
            with self.assertRaises(job.BackupError):
                job.decrypt_file(cipher, out, b'0'*32)
            self.assertFalse(out.exists())
            raw = bytearray(cipher.read_bytes()); raw[-1] ^= 1; cipher.write_bytes(raw)
            with self.assertRaises(job.BackupError):
                job.decrypt_file(cipher, out, self.key)
            self.assertFalse(out.exists())
            self.assertEqual(sorted(p.name for p in Path(d).iterdir()), ['cipher', 'source'])
    def test_truncated_or_invalid_envelope_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            cipher, out = Path(d)/'cipher', Path(d)/'out'
            for raw in (b'', b'WRONGFMT'+b'x'*40, job.MAGIC+b'x'*15):
                cipher.write_bytes(raw)
                with self.assertRaises(job.BackupError):job.decrypt_file(cipher,out,self.key)
                self.assertFalse(out.exists())
    def test_manifest_identity_and_timestamp_fail_closed(self):
        key,m=self.manifest(self.now)
        for field,value in [('manifest_version',True),('backup_id','../../foreign'),
                            ('created_at','2026-10-10T03:00:00Z'),('key_fingerprint','invalid'),
                            ('cipher_bytes',m['cipher_bytes']+1)]:
            altered=dict(m);altered[field]=value
            self.assertIsNone(job.validate_manifest(altered,job.prefix_from(self.env),key))
    def test_decrypt_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            src, cipher, out = [Path(d) / n for n in ('source','cipher','out')]
            src.write_bytes(b'x'); out.write_bytes(b'keep')
            job.encrypt_file(src,cipher,self.key)
            with self.assertRaises(job.BackupError):job.decrypt_file(cipher,out,self.key)
            self.assertEqual(out.read_bytes(),b'keep')
    def test_manifest_published_only_after_exact_cipher_readback(self):
        result = self.run_job()
        self.assertTrue(result['ok'])
        m = json.loads(self.client.objects[result['manifest_key']])
        self.assertEqual(job.validate_manifest(m,job.prefix_from(self.env),result['manifest_key']),self.now)
        self.assertNotIn(self.env['HXZ_BACKUP_ENCRYPTION_KEY'],json.dumps(m))
        self.assertEqual(m['cipher_sha256'],__import__('hashlib').sha256(self.client.objects[m['object_key']]).hexdigest())
    def test_corrupt_upload_has_no_success_manifest_or_retention(self):
        self.client.corrupt_upload=True
        with self.assertRaises(job.BackupError):self.run_job()
        self.assertFalse(any(k.endswith('.manifest.json') for k in self.client.objects))
        self.assertEqual(self.client.deleted,[])
    def test_wrong_head_size_has_no_success_manifest(self):
        self.client.head_wrong=True
        with self.assertRaises(job.BackupError):self.run_job()
        self.assertFalse(any(k.endswith('.manifest.json') for k in self.client.objects))
    def test_failed_manifest_has_no_retention(self):
        self.client.fail_manifest=True
        with self.assertRaises(RuntimeError):self.run_job()
        self.assertEqual(self.client.deleted,[])
    def test_dump_failure_prevents_storage_mutation(self):
        def fail(path,env):raise job.BackupError('database_dump_failed')
        with self.assertRaises(job.BackupError):job.run(self.env,client=self.client,now=self.now,dump=fail)
        self.assertEqual(self.client.objects,{})
    def test_invalid_key_and_prefix_rejected_before_dump(self):
        for key in ('','notbase64',base64.b64encode(b'short').decode()):
            with self.assertRaises(job.BackupError):job.run(dict(self.env,HXZ_BACKUP_ENCRYPTION_KEY=key),client=self.client,dump=self.dump)
        with self.assertRaises(job.BackupError):job.run(dict(self.env,HXZ_BACKUP_PREFIX='../outside'),client=self.client,dump=self.dump)
        self.assertEqual(self.client.objects,{})
    def test_retention_keeps_daily_and_one_per_month(self):
        old1,_=self.manifest(datetime(2026,5,1,tzinfo=timezone.utc))
        keep_month,_=self.manifest(datetime(2026,5,29,tzinfo=timezone.utc))
        too_old,_=self.manifest(datetime(2025,9,30,tzinfo=timezone.utc))
        daily,_=self.manifest(self.now-timedelta(days=29))
        self.assertEqual(job.retention(self.client,'private',job.prefix_from(self.env),self.now),2)
        self.assertNotIn(old1,self.client.objects);self.assertNotIn(too_old,self.client.objects)
        self.assertIn(keep_month,self.client.objects);self.assertIn(daily,self.client.objects)
    def test_retention_ignores_foreign_malformed_and_cross_prefix(self):
        key,m=self.manifest(datetime(2024,1,1,tzinfo=timezone.utc))
        m['object_key']='another/private/object';self.client.objects[key]=json.dumps(m).encode()
        foreign,_=self.manifest(datetime(2024,1,2,tzinfo=timezone.utc),prefix='foreign')
        bad=job.prefix_from(self.env)+'/backups/invalid.manifest.json';self.client.objects[bad]=b'not json'
        self.assertEqual(job.retention(self.client,'private',job.prefix_from(self.env),self.now),0)
        self.assertIn(key,self.client.objects);self.assertIn(foreign,self.client.objects)
    def test_retention_rejects_unowned_pair_even_with_valid_manifest(self):
        key,m=self.manifest(datetime(2024,1,1,tzinfo=timezone.utc))
        self.client.metadata[m['object_key']]['tool']='someone-else'
        self.assertEqual(job.retention(self.client,'private',job.prefix_from(self.env),self.now),0)
        self.assertIn(key,self.client.objects)
    def test_main_sanitizes_unexpected_error(self):
        with patch.object(job,'run',side_effect=RuntimeError('SECRET_DSN')), patch('sys.stdout',new_callable=io.StringIO) as out:
            self.assertEqual(job.main(),1)
            self.assertNotIn('SECRET',out.getvalue())
            self.assertEqual(json.loads(out.getvalue())['code'],'backup_operation_failed')
    def test_s3_uses_railway_virtual_host_addressing(self):
        config=dict(self.env,S3_ENDPOINT_URL='https://t3.storageapi.dev',
                    AWS_ACCESS_KEY_ID='access',AWS_SECRET_ACCESS_KEY='secret',AWS_DEFAULT_REGION='auto')
        with patch('boto3.client') as make:
            job.s3_client(config)
            self.assertEqual(make.call_args.kwargs['config'].s3['addressing_style'],'virtual')
            self.assertEqual(make.call_args.kwargs['region_name'],'auto')
        with patch('boto3.client') as make:
            job.s3_client(dict(config,S3_ADDRESSING_STYLE='path'))
            self.assertEqual(make.call_args.kwargs['config'].s3['addressing_style'],'path')
        with patch('boto3.client') as make, self.assertRaisesRegex(job.BackupError,'invalid_storage_addressing_style'):
            job.s3_client(dict(config,S3_ADDRESSING_STYLE='invalid'))
        make.assert_not_called()
    def test_database_credentials_are_env_only(self):
        env={'DATABASE_URL':'postgresql://user:SECRET@host:5432/railway'}
        calls=[]
        def command(args,**kwargs):
            calls.append((args,kwargs))
            if args[0]=='pg_dump':Path(args[-1]).write_bytes(b'PGDMP')
            return __import__('subprocess').CompletedProcess(args,0)
        with tempfile.TemporaryDirectory() as d, patch.object(job.subprocess,'run',side_effect=command):
            job.dump_database(Path(d)/'dump',env)
        self.assertEqual(len(calls),2)
        self.assertNotIn('SECRET',repr([x[0] for x in calls]))
        self.assertEqual(calls[0][1]['env']['PGDATABASE'],'railway')
        self.assertEqual(calls[0][1]['env']['PGHOST'],'host')
        self.assertEqual(calls[0][1]['env']['PGPORT'],'5432')
        self.assertEqual(calls[0][1]['env']['PGUSER'],'user')
        self.assertEqual(calls[0][1]['env']['PGPASSWORD'],'SECRET')
    def test_database_url_decodes_credentials_and_preserves_tls_options(self):
        env={'DATABASE_URL':'postgresql://user%40x:s%40fe%2Fkey@db.example:5544/db%20name'
             '?sslmode=verify-full&sslrootcert=%2Fcerts%2Fca.pem&sslcert=%2Fcerts%2Fclient.pem'
             '&sslkey=%2Fcerts%2Fkey.pem&sslcrl=%2Fcerts%2Frevoke.pem'
             '&ssl_min_protocol_version=TLSv1.3&channel_binding=require'
             '&application_name=hxz%20backup&options=-c%20statement_timeout%3D0&connect_timeout=8',
             'PGHOST':'wrong-host','PGPORT':'9999','PGPASSWORD':'wrong-password',
             'PGSERVICE':'wrong-service','PGSERVICEFILE':'/wrong','PGSSLMODE':'disable',
             'PATH':'/bin'}
        actual=job.database_environment(env)
        expected={'PGUSER':'user@x','PGPASSWORD':'s@fe/key','PGHOST':'db.example',
                  'PGPORT':'5544','PGDATABASE':'db name','PGSSLMODE':'verify-full',
                  'PGSSLROOTCERT':'/certs/ca.pem','PGSSLCERT':'/certs/client.pem',
                  'PGSSLKEY':'/certs/key.pem','PGSSLCRL':'/certs/revoke.pem',
                  'PGSSLMINPROTOCOLVERSION':'TLSv1.3','PGCHANNELBINDING':'require',
                  'PGAPPNAME':'hxz backup','PGOPTIONS':'-c statement_timeout=0','PGCONNECT_TIMEOUT':'8'}
        self.assertEqual({k:v for k,v in actual.items() if k.startswith('PG')},expected)
        self.assertEqual(actual['PATH'],'/bin')
    def test_database_unknown_parameter_is_rejected_before_running_client(self):
        # keepalives is valid libpq syntax but has no environment equivalent.
        with patch.object(job.subprocess,'run') as command, tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(job.BackupError,'^unsupported_database_parameter$'):
                job.dump_database(Path(d)/'dump',{'DATABASE_URL':'postgresql://u:p@host/db?keepalives=1'})
        command.assert_not_called()
    def test_database_dump_error_hides_stderr(self):
        r=__import__('subprocess').CompletedProcess([],1,stderr=b'password SECRET')
        with patch.object(job.subprocess,'run',return_value=r), tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(job.BackupError,'^database_dump_failed$'):
                job.dump_database(Path(d)/'dump',{'DATABASE_URL':'postgresql://u:p@host/db'})


if __name__=='__main__':unittest.main()
