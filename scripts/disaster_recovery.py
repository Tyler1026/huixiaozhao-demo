#!/usr/bin/env python3
"""Private PostgreSQL dump and isolated restore drill through Railway SSH.

The default action is a read-only inspection. ``drill`` explicitly creates and
drops only a fresh hxz_drill_* database; it never starts the application.
Database credentials remain in the existing containers' environment.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import inspect
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import subprocess
import sys


PRIVATE_ROOT = Path.home() / '.codex/private/huixiaozhao'
TARGET_PATTERN = re.compile(r'hxz_drill_[a-z0-9_]{8,48}\Z')


def stable_sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':')).encode()).hexdigest()


def check_state(state):
    """Return counts and issue codes only; never export account or invite data."""
    issues = {}

    def issue(code):
        issues[code] = issues.get(code, 0) + 1

    if not isinstance(state, dict):
        return {'counts': {}, 'issues': {'invalid_state': 1}}
    fields = ('PROJECTS', 'INVITE_CODES', 'CITY_WORKSPACES', 'USER_PROFILES',
              'CITY_ACCOUNTS', 'AUTH_SESSIONS', 'REPORT_REQUESTS', 'REPORT_PUBLICATIONS', 'UPLOADS')
    counts = {name: len(state.get(name, {})) for name in fields
              if isinstance(state.get(name, {}), (dict, list))}
    projects = state.get('PROJECTS') or {}
    invites = state.get('INVITE_CODES') or {}
    profiles = dict(state.get('CITY_ACCOUNTS') or {})
    profiles.update(state.get('USER_PROFILES') or {})
    if not all(isinstance(value, dict) for value in (projects, invites, profiles)):
        return {'counts': counts, 'issues': {'invalid_registry': 1}}
    normalized_profiles = {key.casefold(): value for key, value in profiles.items()
                           if isinstance(key, str) and isinstance(value, dict)}
    for project in projects.values():
        if not isinstance(project, dict):
            issue('invalid_project')
            continue
        key = project.get('workspaceId')
        if key and key not in projects:
            issue('project_missing_workspace')
    for record in invites.values():
        if not isinstance(record, dict) or record.get('projKey') not in projects:
            issue('invite_missing_project')
    for city, record in (state.get('CITY_WORKSPACES') or {}).items():
        if not isinstance(record, dict):
            issue('invalid_city_workspace')
            continue
        project = projects.get(record.get('projectKey')) or {}
        invite = invites.get(record.get('inviteCode')) or {}
        if project.get('city') != city or project.get('workspaceId') != record.get('projectKey'):
            issue('city_project_binding')
        if invite.get('city') != city or invite.get('projKey') != record.get('projectKey'):
            issue('city_invite_binding')
        owner = record.get('ownerUser')
        if owner:
            profile = normalized_profiles.get(str(owner).casefold())
            memberships = profile.get('memberships') if profile else None
            if not isinstance(memberships, dict) or record.get('projectKey') not in memberships:
                issue('city_owner_membership')
    for profile in profiles.values():
        if not isinstance(profile, dict):
            issue('invalid_profile')
            continue
        memberships = profile.get('memberships')
        if isinstance(memberships, dict):
            for key, member in memberships.items():
                if (isinstance(member, dict) and not any(member.get(flag) for flag in
                        ('disabled', 'deleted', 'revoked')) and member.get('active') is not False
                        and key not in projects):
                    issue('active_membership_missing_project')
        elif profile.get('projKey') and profile['projKey'] not in projects:
            issue('profile_missing_project')
    return {'counts': counts, 'issues': issues}


def binary_check(data, recorded_sha, recorded_size=None):
    data = bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    return digest, len(data), digest == recorded_sha and (recorded_size is None or len(data) == recorded_size)


def check_report_links(state, engine_status):
    requests = {row.get('id'): row for row in state.get('REPORT_REQUESTS', [])
                if isinstance(row, dict) and isinstance(row.get('id'), str)}
    counts = dict(completed_requests=0, publication_receipts=0, missing_engine=0,
                  engine_not_complete=0, missing_request=0, missing_project=0,
                  publication_engine_mismatch=0)
    for request_id, request in requests.items():
        if request.get('engine') == 'full-v1' and request.get('status') == 'done':
            counts['completed_requests'] += 1
            expected = hashlib.sha256(('full-v1\0website-report-queue\0' + request_id).encode()).hexdigest()
            if expected not in engine_status:
                counts['missing_engine'] += 1
            elif engine_status[expected] != 'completed':
                counts['engine_not_complete'] += 1
    for request_id, receipt in (state.get('REPORT_PUBLICATIONS') or {}).items():
        counts['publication_receipts'] += 1
        if request_id not in requests:
            counts['missing_request'] += 1
        if not isinstance(receipt, dict):
            counts['publication_engine_mismatch'] += 1
            continue
        expected = hashlib.sha256(('full-v1\0website-report-queue\0' + request_id).encode()).hexdigest()
        if receipt.get('engineReportId') != expected:
            counts['publication_engine_mismatch'] += 1
        if receipt.get('projectKey') not in (state.get('PROJECTS') or {}):
            counts['missing_project'] += 1
    return counts


def stream_rows(connection, statement):
    # Some legacy history rows and BYTEA values are large. Never materialize an
    # entire table in the application container just to calculate a checksum.
    with connection.cursor(name='hxz_disaster_recovery_rows') as cursor:
        cursor.itersize = 1
        cursor.execute(statement)
        yield from cursor


def check_upload_references(state, stored):
    groups = list((state.get('UPLOADS') or {}).items())
    groups.extend((key, project.get('kbUploads', [])) for key, project in
                  (state.get('PROJECTS') or {}).items() if isinstance(project, dict))
    result = dict(missing_reference=0, reference_mismatch=0, historical_text_only_references=0)
    for project_key, uploads in groups:
        for upload in uploads if isinstance(uploads, list) else []:
            if not isinstance(upload, dict):
                continue
            original = upload.get('originalId') or upload.get('uploadId')
            if not original:
                result['historical_text_only_references'] += 1
                continue
            payload = stored.get((project_key, original))
            if payload is None:
                result['missing_reference'] += 1
            elif (upload.get('originalSha256') not in (None, payload[0])
                    or upload.get('size') not in (None, payload[1])):
                result['reference_mismatch'] += 1
    return result


def inspect_database(database=None):
    """Inspect a single repeatable-read snapshot, including every public byte."""
    import psycopg2
    from psycopg2 import sql
    conn = psycopg2.connect(os.environ['DATABASE_URL'], dbname=database,
                            connect_timeout=15) if database else psycopg2.connect(
                                os.environ['DATABASE_URL'], connect_timeout=15)
    conn.set_session(isolation_level='REPEATABLE READ', readonly=True)
    result = {'read_only': True, 'tables': {}, 'binary': {}, 'relationships': {}}
    try:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = '180s'")
            cur.execute("SELECT current_setting('server_version_num')")
            result['postgres_version_num'] = int(cur.fetchone()[0])
            cur.execute("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN "
                        "('pg_catalog','information_schema') ORDER BY 1,2")
            tables = cur.fetchall()
            cur.execute("SELECT table_schema,table_name,column_name,ordinal_position,column_default,"
                        "is_nullable,data_type,udt_schema,udt_name FROM information_schema.columns "
                        "WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,4")
            columns = cur.fetchall()
            cur.execute("SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE "
                        "schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3")
            indexes = cur.fetchall()
            cur.execute("SELECT n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) "
                        "FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid "
                        "JOIN pg_namespace n ON n.oid=c.relnamespace "
                        "WHERE n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3")
            constraints = cur.fetchall()
            result['schema_sha256'] = stable_sha([columns, indexes, constraints])
            cur.execute("SELECT schemaname,sequencename,data_type,start_value,min_value,max_value,"
                        "increment_by,cycle,cache_size,last_value FROM pg_sequences WHERE schemaname "
                        "NOT IN ('pg_catalog','information_schema') ORDER BY 1,2")
            sequences = cur.fetchall()
            result['sequences'] = {'count': len(sequences), 'state_sha256': stable_sha(sequences)}
            for schema, table in tables:
                query = sql.SQL('SELECT row_to_json(t)::text FROM {}.{} t').format(
                    sql.Identifier(schema), sql.Identifier(table))
                hashes = sorted(hashlib.sha256(row[0].encode()).hexdigest()
                                for row in stream_rows(conn, query))
                result['tables'][schema + '.' + table] = {
                    'count': len(hashes), 'content_sha256': stable_sha(hashes)}
            available = {table for schema, table in tables if schema == 'public'}
            expected = {'sync_data', 'sync_history', 'full_reports', 'full_steps', 'full_events',
                        'full_artifact_bytes', 'full_checkpoint_archive'}
            result['relationships']['required_tables_missing'] = len(expected - available)
            state = {}
            if 'sync_data' in available:
                cur.execute('SELECT data FROM public.sync_data WHERE id=1')
                row = cur.fetchone()
                state = json.loads(row[0]) if row else {}
                result['relationships']['app_state'] = check_state(state)
            if 'full_reports' in available:
                cur.execute('SELECT id,status FROM public.full_reports')
                result['relationships']['report_links'] = check_report_links(state, dict(cur.fetchall()))
            if 'full_artifact_bytes' in available:
                checked = byte_count = bad = 0
                identities = []
                artifacts = {}
                for report_id, name, recorded_sha, data in stream_rows(conn,
                        'SELECT report_id,name,sha256,data FROM public.full_artifact_bytes ORDER BY report_id,name'):
                    digest, size, ok = binary_check(data, recorded_sha)
                    checked += 1; byte_count += size; bad += not ok
                    artifacts[(report_id, name)] = (digest, size)
                    identities.append([report_id, name, digest, size])
                result['binary']['report_artifacts'] = dict(count=checked, bytes=byte_count,
                    invalid=bad, content_sha256=stable_sha(identities))
                if 'full_reports' in available:
                    cur.execute('SELECT id,manifest FROM public.full_reports WHERE status=%s', ('completed',))
                    missing = mismatch = entries = 0
                    for report_id, raw in cur:
                        try:
                            manifest = json.loads(raw) if isinstance(raw, str) else raw
                            files = manifest['files']
                            if not isinstance(files, list):
                                raise ValueError()
                        except (ValueError, TypeError, KeyError):
                            mismatch += 1
                            continue
                        for entry in files:
                            entries += 1
                            saved = artifacts.get((report_id, entry.get('name')))
                            if saved is None:
                                missing += 1
                            elif saved != (entry.get('sha256'), entry.get('bytes')):
                                mismatch += 1
                    result['relationships']['completed_report_files'] = dict(entries=entries,
                        missing=missing, mismatch=mismatch)
            if 'upload_originals' in available:
                checked = byte_count = bad = missing_project = 0
                identities = []; stored = {}
                for upload_id, project_key, recorded_sha, recorded_size, data in stream_rows(conn,
                        'SELECT upload_id,project_key,sha256,size_bytes,payload '
                        'FROM public.upload_originals ORDER BY upload_id'):
                    digest, size, ok = binary_check(data, recorded_sha, recorded_size)
                    checked += 1; byte_count += size; bad += not ok
                    missing_project += project_key not in (state.get('PROJECTS') or {})
                    identities.append([upload_id, project_key, digest, size]); stored[(project_key, upload_id)] = (digest, size)
                result['binary']['upload_originals'] = dict(count=checked, bytes=byte_count,
                    invalid=bad, content_sha256=stable_sha(identities))
                result['relationships']['upload_originals'] = dict(missing_project=missing_project,
                                                                  **check_upload_references(state, stored))
            for child in ('full_steps', 'full_events', 'full_artifact_bytes', 'full_checkpoint_archive'):
                if child in available and 'full_reports' in available:
                    cur.execute(sql.SQL('SELECT count(*) FROM public.{} t LEFT JOIN public.full_reports r '
                                        'ON r.id=t.report_id WHERE r.id IS NULL').format(sql.Identifier(child)))
                    result['relationships'][child + '_report_orphans'] = cur.fetchone()[0]
        return result
    finally:
        conn.rollback(); conn.close()


def inspection_definitions():
    return '\n\n'.join(inspect.getsource(function) for function in
                       (stable_sha, check_state, binary_check, check_report_links, stream_rows,
                        check_upload_references, inspect_database))


def inspection_program(database=None):
    return ('import os,json,hashlib\n' + inspection_definitions() + '\nprint("HXZ_SAFE_JSON:" + json.dumps('
            'inspect_database(' + repr(database) + '), sort_keys=True))\n')


def restore_bucket_backup(manifest_key):
    """Run inside the backup container; no application imports or AI calls."""
    import datetime
    import importlib
    from pathlib import Path
    import re
    import secrets
    import subprocess
    import tempfile
    import psycopg2
    from psycopg2 import sql
    from psycopg2.extensions import parse_dsn
    try:
        job = importlib.import_module('scripts.backup_job')
    except ModuleNotFoundError:
        job = importlib.import_module('backup_job')
    output = {'action': 'bucket-drill', 'production_mutated': False, 'application_started': False,
              'restore_complete': False, 'cleanup_complete': False,
              'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    connection = None
    created = False
    stage = 'configuration'
    target = 'hxz_drill_' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S') + '_' + secrets.token_hex(4)
    try:
        client = job.s3_client(os.environ)
        bucket = os.environ['S3_BUCKET']
        prefix = job.prefix_from(os.environ)
        # Validate a caller-selected immutable backup pair before any download.
        if not re.fullmatch(re.escape(prefix) + r'/backups/\d{8}T\d{6}Z-[0-9a-f]{12}\.manifest\.json', manifest_key):
            raise ValueError('manifest_key')
        key = job.encryption_key(os.environ)
        stage = 'manifest_validation'
        manifest = json.loads(job.read_small_object(client, bucket, manifest_key))
        if (job.validate_manifest(manifest, prefix, manifest_key) is None
                or manifest['key_fingerprint'] != job.key_fingerprint(key)):
            raise ValueError('manifest')
        output['backup'] = {field: manifest[field] for field in (
            'backup_id', 'created_at', 'plain_sha256', 'plain_bytes', 'cipher_sha256', 'cipher_bytes')}
        output['manifest_key'] = manifest_key
        with tempfile.TemporaryDirectory(prefix='hxz-restore-drill-') as folder:
            cipher, plain = Path(folder) / 'backup.aesgcm', Path(folder) / 'database.dump'
            stage = 'cipher_download'
            response = client.get_object(Bucket=bucket, Key=manifest['object_key'])
            stream = response['Body']
            try:
                with cipher.open('xb') as handle:
                    os.chmod(cipher, 0o600)
                    size = 0
                    for block in iter(lambda: stream.read(1024 * 1024), b''):
                        size += len(block)
                        if size > manifest['cipher_bytes']:
                            raise ValueError('cipher_size')
                        handle.write(block)
            finally:
                stream.close()
            if cipher.stat().st_size != manifest['cipher_bytes'] or job.digest_file(cipher) != manifest['cipher_sha256']:
                raise ValueError('cipher_integrity')
            output['cipher_verified'] = True
            stage = 'decrypt_and_verify'
            job.decrypt_file(cipher, plain, key)
            if plain.stat().st_size != manifest['plain_bytes'] or job.digest_file(plain) != manifest['plain_sha256']:
                raise ValueError('plain_integrity')
            with plain.open('rb') as handle:
                if handle.read(5) != b'PGDMP':
                    raise ValueError('archive_format')
            output['plaintext_verified'] = True
            stage = 'create_isolated_database'
            connection = psycopg2.connect(os.environ['DATABASE_URL'], connect_timeout=15)
            connection.autocommit = True
            if connection.get_dsn_parameters()['dbname'] == target:
                raise ValueError('source_target_equal')
            with connection.cursor() as cursor:
                cursor.execute(sql.SQL('CREATE DATABASE {} TEMPLATE template0').format(sql.Identifier(target)))
            created = True
            output['target_database'] = target
            stage = 'restore_archive'
            child_env = dict(os.environ)
            parameters = parse_dsn(os.environ['DATABASE_URL'])
            for parameter, variable in (('host', 'PGHOST'), ('hostaddr', 'PGHOSTADDR'),
                    ('port', 'PGPORT'), ('user', 'PGUSER'), ('password', 'PGPASSWORD'),
                    ('sslmode', 'PGSSLMODE'), ('sslrootcert', 'PGSSLROOTCERT'),
                    ('sslcert', 'PGSSLCERT'), ('sslkey', 'PGSSLKEY'),
                    ('connect_timeout', 'PGCONNECT_TIMEOUT'), ('options', 'PGOPTIONS')):
                if parameter in parameters:
                    child_env[variable] = parameters[parameter]
            child_env['PGDATABASE'] = target
            restore = subprocess.run(['pg_restore', '--exit-on-error', '--no-owner', '--no-acl',
                                      '--dbname', target, str(plain)], env=child_env,
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.PIPE, timeout=1800, check=False)
            if restore.returncode:
                raise ValueError('restore_failed')
            output['restore_complete'] = True
            stage = 'read_only_integrity'
            output['inspection'] = inspect_database(target)
            output['integrity_issue_count'] = issue_count(output['inspection'])
            output['integrity_passed'] = output['integrity_issue_count'] == 0
    except Exception:
        output['error_code'] = stage + '_failed'
    finally:
        if connection is not None:
            try:
                if created:
                    with connection.cursor() as cursor:
                        cursor.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(target)))
                output['cleanup_complete'] = True
            except Exception:
                output['cleanup_error_code'] = 'temporary_database_cleanup_failed'
            finally:
                connection.close()
        else:
            output['cleanup_complete'] = not created
        output['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return output


def bucket_drill_program(manifest_key):
    definitions = '\n\n'.join((inspection_definitions(), inspect.getsource(issue_count),
                               inspect.getsource(restore_bucket_backup)))
    return ('import os,json,hashlib\n' + definitions + '\nprint("HXZ_SAFE_JSON:" + json.dumps('
            'restore_bucket_backup(' + repr(manifest_key) + '), sort_keys=True))\n')


def validate_target(target):
    if not isinstance(target, str) or not TARGET_PATTERN.fullmatch(target):
        raise ValueError('restore target must be a fresh hxz_drill_* database')
    return target


def private_directory(value):
    path = Path(value).expanduser().resolve()
    root = PRIVATE_ROOT.resolve()
    if path == root or root not in path.parents:
        raise ValueError('backup directory must be inside ~/.codex/private/huixiaozhao')
    path.mkdir(mode=0o700, parents=True, exist_ok=False)
    path.chmod(0o700)
    return path


class Railway:
    def __init__(self, args):
        self.args = args

    def ssh(self, service, command, timeout=900):
        args = [self.args.railway, 'ssh', '--project', self.args.project,
                '--environment', self.args.environment, '--service', service, '--', *command]
        result = subprocess.run(args, capture_output=True, timeout=timeout)
        if result.returncode:
            # Railway / libpq errors can include credentials; never echo either stream.
            raise RuntimeError('Railway operation failed; raw output withheld')
        return result.stdout

    def inspect(self, database=None):
        encoded = base64.b64encode(inspection_program(database).encode()).decode()
        output = self.ssh(self.args.app_service, ['python', '-c',
                          'import base64;exec(base64.b64decode(' + repr(encoded) + '))'])
        rows = [line.partition(b'HXZ_SAFE_JSON:')[2] for line in output.splitlines()
                if b'HXZ_SAFE_JSON:' in line]
        if len(rows) != 1:
            raise RuntimeError('inspection did not return a unique safe receipt')
        return json.loads(rows[0])

    def bucket_drill(self, manifest_key):
        encoded = base64.b64encode(bucket_drill_program(manifest_key).encode()).decode()
        output = self.ssh(self.args.backup_service, ['python3', '-c',
                          'import base64;exec(base64.b64decode(' + repr(encoded) + '))'], timeout=2400)
        rows = [line.partition(b'HXZ_SAFE_JSON:')[2] for line in output.splitlines()
                if b'HXZ_SAFE_JSON:' in line]
        if len(rows) != 1:
            raise RuntimeError('restore drill did not return a unique safe receipt')
        return json.loads(rows[0])

    def pg(self, command):
        prefix = ('set -eu; umask 077; '
                  'export PGHOST=127.0.0.1 PGPORT="${PGPORT:-5432}" '
                  'PGUSER="${PGUSER:-${POSTGRES_USER:-postgres}}" '
                  'PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-railway}}" '
                  'PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"; ')
        return self.ssh(self.args.database_service, ['sh', '-c', prefix + command])

    def dump(self, remote, destination):
        output = self.pg('pg_dump --format=custom --compress=6 --no-owner --no-acl --file=' +
                         shlex.quote(remote) + '; printf "HXZ_DUMP_BEGIN\\n"; base64 ' +
                         shlex.quote(remote) + '; printf "HXZ_DUMP_END\\n"')
        try:
            encoded = output.split(b'HXZ_DUMP_BEGIN\n', 1)[1].split(b'HXZ_DUMP_END', 1)[0]
            data = base64.b64decode(b''.join(encoded.split()), validate=True)
        except (IndexError, ValueError):
            raise RuntimeError('dump transfer failed; raw output withheld') from None
        if not data.startswith(b'PGDMP'):
            raise RuntimeError('dump is not PostgreSQL custom format')
        with destination.open('xb') as handle:
            os.chmod(destination, 0o600); handle.write(data)
        return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                'format': 'postgresql-custom', 'consistent_snapshot': 'pg_dump MVCC'}

    def cleanup(self, remote, target=None):
        command = 'rm -f -- ' + shlex.quote(remote)
        if target:
            target = validate_target(target)
            command += '; test "$PGDATABASE" != ' + shlex.quote(target) + '; dropdb --if-exists ' + shlex.quote(target)
        self.pg(command)


def issue_count(inspection):
    total = sum(item.get('invalid', 0) for item in inspection.get('binary', {}).values())
    for value in inspection.get('relationships', {}).values():
        if isinstance(value, int):
            total += value
        elif isinstance(value, dict) and 'issues' in value:
            total += sum(value['issues'].values())
        elif isinstance(value, dict):
            total += sum(value.get(key, 0) for key in ('missing', 'mismatch', 'missing_project', 'missing_reference',
                'reference_mismatch', 'missing_engine', 'engine_not_complete', 'missing_request', 'publication_engine_mismatch'))
    return total


def run(args):
    railway = Railway(args)
    if args.action == 'inspect':
        return {'action': 'inspect', 'inspection': railway.inspect(), 'production_mutated': False}
    if args.action == 'bucket-drill':
        if not args.backup_service or not args.manifest_key:
            raise ValueError('bucket-drill requires backup service and exact manifest key')
        return railway.bucket_drill(args.manifest_key)
    target = validate_target(args.target_database or ('hxz_drill_' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d%H%M%S') + '_' + secrets.token_hex(4)))
    directory = private_directory(args.directory or str(PRIVATE_ROOT / 'backups' / target))
    remote = '/tmp/hxz-dr-' + secrets.token_hex(16) + '.dump'
    result = {'action': 'drill', 'started_at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'production_mutated': False, 'application_started': False, 'target_database': target,
              'restore_complete': False, 'cleanup_complete': False}
    created = False
    try:
        result['backup'] = railway.dump(remote, directory / 'database.dump')
        # A failed CREATE cannot authorize deleting an existing database. Check
        # existence separately, then mark ownership only after CREATE succeeds.
        railway.pg('test "$PGDATABASE" != ' + shlex.quote(target) + '; createdb --template=template0 ' + shlex.quote(target))
        created = True
        railway.pg('pg_restore --exit-on-error --no-owner --no-acl --dbname=' +
                   shlex.quote(target) + ' ' + shlex.quote(remote))
        result['restore_complete'] = True
        result['inspection'] = railway.inspect(target)
        result['integrity_issue_count'] = issue_count(result['inspection'])
        result['integrity_passed'] = result['integrity_issue_count'] == 0
    finally:
        try:
            railway.cleanup(remote, target if created else None)
            result['cleanup_complete'] = True
        finally:
            result['finished_at'] = dt.datetime.now(dt.timezone.utc).isoformat()
            manifest = directory / 'manifest.json'
            manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
            manifest.chmod(0o600)
    return result


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument('action', nargs='?', choices=('inspect', 'drill', 'bucket-drill'), default='inspect')
    value.add_argument('--railway', default='railway')
    value.add_argument('--project', default=os.environ.get('HXZ_DR_PROJECT_ID'), required=not os.environ.get('HXZ_DR_PROJECT_ID'))
    value.add_argument('--environment', default=os.environ.get('HXZ_DR_ENVIRONMENT_ID'), required=not os.environ.get('HXZ_DR_ENVIRONMENT_ID'))
    value.add_argument('--app-service', default=os.environ.get('HXZ_DR_APP_SERVICE_ID'), required=not os.environ.get('HXZ_DR_APP_SERVICE_ID'))
    value.add_argument('--database-service', default=os.environ.get('HXZ_DR_DATABASE_SERVICE_ID'), required=not os.environ.get('HXZ_DR_DATABASE_SERVICE_ID'))
    value.add_argument('--directory', help='New private backup directory; must be beneath ~/.codex/private/huixiaozhao')
    value.add_argument('--target-database', help='Fresh hxz_drill_* name; never an existing or production database')
    value.add_argument('--backup-service', help='Existing Railway backup container with PostgreSQL clients and S3 environment')
    value.add_argument('--manifest-key', help='Exact successful encrypted backup manifest in the configured private Bucket')
    value.add_argument('--receipt', help='Optional safe counts/hash receipt; never contains credentials or row values')
    return value


def main():
    args = parser().parse_args()
    try:
        result = run(args)
    except Exception:
        print('Disaster recovery operation failed; private manifest may contain partial safe progress. Raw errors withheld.', file=sys.stderr)
        return 1
    text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.receipt:
        Path(args.receipt).write_text(text)
    print(text, end='')
    return 0 if args.action == 'inspect' or result.get('integrity_passed') and result.get('cleanup_complete') else 2


if __name__ == '__main__':
    raise SystemExit(main())
