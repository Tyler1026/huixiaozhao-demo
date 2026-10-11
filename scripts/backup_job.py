"""One-shot encrypted PostgreSQL backup. Credentials are environment-only."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

MAGIC = b'HXZBKUP1'
AAD = b'huixiaozhao-postgres-backup-v1'
TOOL = 'huixiaozhao-postgres-backup'
CHUNK = 1024 * 1024
ID_RE = re.compile(r'^\d{8}T\d{6}Z-[0-9a-f]{12}$')


class BackupError(Exception):
    """Contains only a fixed, non-secret failure code."""


def digest_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(CHUNK), b''):
            h.update(block)
    return h.hexdigest()


def encryption_key(environ):
    try:
        key = base64.b64decode(environ['HXZ_BACKUP_ENCRYPTION_KEY'], validate=True)
    except (KeyError, ValueError):
        raise BackupError('invalid_encryption_key') from None
    if len(key) != 32:
        raise BackupError('invalid_encryption_key')
    return key


def key_fingerprint(key):
    return hashlib.sha256(key).hexdigest()[:16]


def encrypt_file(source, target, key):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    nonce = secrets.token_bytes(12)
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    encryptor.authenticate_additional_data(AAD)
    with open(source, 'rb') as src, open(target, 'xb') as dst:
        os.chmod(target, 0o600)
        dst.write(MAGIC + nonce)
        for block in iter(lambda: src.read(CHUNK), b''):
            dst.write(encryptor.update(block))
        dst.write(encryptor.finalize())
        dst.write(encryptor.tag)


def decrypt_file(source, target, key):
    """Only publish plaintext after GCM authentication; never overwrite a file."""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    target = Path(target)
    if target.exists():
        raise BackupError('plaintext_target_exists')
    tmp = None
    try:
        with open(source, 'rb') as src:
            if src.read(8) != MAGIC:
                raise BackupError('invalid_cipher_format')
            nonce = src.read(12)
            src.seek(0, 2)
            total = src.tell()
            if total < 36:
                raise BackupError('invalid_cipher_format')
            src.seek(total - 16)
            tag = src.read(16)
            decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
            decryptor.authenticate_additional_data(AAD)
            src.seek(20)
            remaining = total - 36
            with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as dst:
                tmp = Path(dst.name)
                os.chmod(tmp, 0o600)
                while remaining:
                    block = src.read(min(CHUNK, remaining))
                    if not block:
                        raise BackupError('truncated_ciphertext')
                    remaining -= len(block)
                    dst.write(decryptor.update(block))
                dst.write(decryptor.finalize())
            # Link is atomic and refuses an existing destination, unlike replace.
            os.link(tmp, target)
    except BackupError:
        raise
    except Exception:
        raise BackupError('decrypt_failed') from None
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


def prefix_from(environ):
    prefix = environ.get('HXZ_BACKUP_PREFIX', 'hxz/production/postgres/v1').strip('/')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9/_-]{0,160}', prefix) or '..' in prefix:
        raise BackupError('invalid_backup_prefix')
    return prefix


def s3_client(environ):
    import boto3
    from botocore.config import Config
    required = ('S3_ENDPOINT_URL', 'S3_BUCKET', 'AWS_DEFAULT_REGION',
                'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY')
    if any(not environ.get(key) for key in required):
        raise BackupError('missing_storage_configuration')
    endpoint = urlsplit(environ['S3_ENDPOINT_URL'])
    if endpoint.scheme != 'https' or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment:
        raise BackupError('invalid_storage_endpoint')
    style = environ.get('S3_ADDRESSING_STYLE', 'virtual')
    if style not in ('virtual', 'path'):
        raise BackupError('invalid_storage_addressing_style')
    return boto3.client('s3', endpoint_url=environ['S3_ENDPOINT_URL'],
                        region_name=environ['AWS_DEFAULT_REGION'],
                        aws_access_key_id=environ['AWS_ACCESS_KEY_ID'],
                        aws_secret_access_key=environ['AWS_SECRET_ACCESS_KEY'],
                        config=Config(signature_version='s3v4', connect_timeout=15,
                                      read_timeout=120, retries={'max_attempts': 3},
                                      s3={'addressing_style': style}))


def dump_database(path, environ):
    url = environ.get('DATABASE_URL', '')
    parsed = urlsplit(url)
    if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname or not parsed.path.strip('/'):
        raise BackupError('invalid_database_configuration')
    child_env = dict(environ)
    child_env['PGDATABASE'] = url  # libpq accepts a URI here; it is never argv.
    try:
        result = subprocess.run(['pg_dump', '--format=custom', '--no-owner', '--no-acl',
                                 '--lock-wait-timeout=30000', '--file', str(path)],
                                env=child_env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                timeout=1800, check=False)
        if result.returncode or not Path(path).is_file() or Path(path).stat().st_size == 0:
            raise BackupError('database_dump_failed')
        check = subprocess.run(['pg_restore', '--list', str(path)], env=child_env,
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.PIPE, timeout=120, check=False)
        if check.returncode:
            raise BackupError('invalid_database_archive')
        os.chmod(path, 0o600)
    except BackupError:
        raise
    except Exception:
        raise BackupError('database_dump_failed') from None


def iso_utc(value):
    return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def validate_manifest(value, prefix, manifest_key):
    """Recognize only exact object pairs produced by this tool under this prefix."""
    try:
        ident = value['backup_id']
        root = prefix + '/backups/' + ident
        if (value['tool'] != TOOL or type(value['manifest_version']) is not int or value['manifest_version'] != 1
                or not isinstance(ident, str) or not ID_RE.fullmatch(ident)
                or manifest_key != root + '.manifest.json'
                or value['object_key'] != root + '.dump.aesgcm'
                or value['cipher_format'] != 'HXZBKUP1-AES-256-GCM'
                or value['format'] != 'postgres-custom'
                or value['schema_version'] != 'hxz-persistence-v1'
                or not re.fullmatch('[0-9a-f]{16}', value['key_fingerprint'])
                or any(not re.fullmatch('[0-9a-f]{64}', value[k]) for k in ('plain_sha256', 'cipher_sha256'))
                or any(type(value[k]) is not int or value[k] <= 0 for k in ('plain_bytes', 'cipher_bytes'))
                or value['cipher_bytes'] != value['plain_bytes'] + 36):
            return None
        created = datetime.fromisoformat(value['created_at'].replace('Z', '+00:00'))
        if created.tzinfo is None or created.utcoffset() != timedelta(0):
            return None
        if created.strftime('%Y%m%dT%H%M%SZ') != ident[:16]:
            return None
        return created
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def read_small_object(client, bucket, key, limit=16384):
    reply = client.get_object(Bucket=bucket, Key=key)
    stream = reply['Body']
    try:
        raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise BackupError('manifest_too_large')
        return raw
    finally:
        stream.close()


def verify_uploaded(client, bucket, object_key, expected_bytes, expected_sha):
    head = client.head_object(Bucket=bucket, Key=object_key)
    if head.get('ContentLength') != expected_bytes:
        raise BackupError('uploaded_size_mismatch')
    reply = client.get_object(Bucket=bucket, Key=object_key)
    stream, digest, total = reply['Body'], hashlib.sha256(), 0
    try:
        for block in iter(lambda: stream.read(CHUNK), b''):
            total += len(block)
            if total > expected_bytes:
                raise BackupError('uploaded_size_mismatch')
            digest.update(block)
    finally:
        stream.close()
    if total != expected_bytes or digest.hexdigest() != expected_sha:
        raise BackupError('uploaded_sha_mismatch')


def retention(client, bucket, prefix, now):
    """Keep 30 days plus the newest successful backup in each of 12 months."""
    records = []
    for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=prefix + '/backups/'):
        for obj in page.get('Contents', []):
            key = obj.get('Key', '')
            if not key.endswith('.manifest.json'):
                continue
            # Invalid or foreign manifests are never deletion candidates.
            try:
                value = json.loads(read_small_object(client, bucket, key))
            except (ValueError, BackupError):
                continue
            created = validate_manifest(value, prefix, key)
            if created is not None and created <= now:
                records.append((created, key, value))
    month_floor = now.year * 12 + now.month - 1 - 11
    monthly = {}
    for created, key, value in records:
        month = created.year * 12 + created.month - 1
        if month >= month_floor and (month not in monthly or created > monthly[month][0]):
            monthly[month] = (created, key)
    keep = {key for _, key in monthly.values()}
    deleted = 0
    for created, key, value in records:
        if created >= now - timedelta(days=30) or key in keep:
            continue
        # Verify the paired payload belongs to the successful manifest before deletion.
        head = client.head_object(Bucket=bucket, Key=value['object_key'])
        if (head.get('ContentLength') != value['cipher_bytes']
                or head.get('Metadata', {}).get('sha256') != value['cipher_sha256']
                or head.get('Metadata', {}).get('tool') != TOOL):
            continue
        client.delete_object(Bucket=bucket, Key=key)
        client.delete_object(Bucket=bucket, Key=value['object_key'])
        deleted += 1
    return deleted


def run(environ=None, *, client=None, now=None, dump=dump_database):
    environ = dict(os.environ if environ is None else environ)
    key = encryption_key(environ)
    prefix = prefix_from(environ)
    client = client or s3_client(environ)
    bucket = environ.get('S3_BUCKET')
    if not bucket:
        raise BackupError('missing_storage_configuration')
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0)
    ident = now.strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(6)
    root = prefix + '/backups/' + ident
    object_key, manifest_key = root + '.dump.aesgcm', root + '.manifest.json'
    with tempfile.TemporaryDirectory(prefix='hxz-backup-') as folder:
        plain, cipher = Path(folder) / 'database.dump', Path(folder) / 'database.dump.aesgcm'
        dump(plain, environ)
        encrypt_file(plain, cipher, key)
        manifest = {'tool': TOOL, 'manifest_version': 1, 'backup_id': ident,
                    'created_at': iso_utc(now), 'format': 'postgres-custom',
                    'schema_version': 'hxz-persistence-v1', 'cipher_format': 'HXZBKUP1-AES-256-GCM',
                    'object_key': object_key, 'plain_sha256': digest_file(plain),
                    'cipher_sha256': digest_file(cipher), 'plain_bytes': plain.stat().st_size,
                    'cipher_bytes': cipher.stat().st_size, 'key_fingerprint': key_fingerprint(key)}
        client.upload_file(str(cipher), bucket, object_key,
                           ExtraArgs={'ContentType': 'application/octet-stream',
                                      'Metadata': {'sha256': manifest['cipher_sha256'], 'tool': TOOL}})
        verify_uploaded(client, bucket, object_key, manifest['cipher_bytes'], manifest['cipher_sha256'])
        encoded = (json.dumps(manifest, sort_keys=True) + '\n').encode()
        client.put_object(Bucket=bucket, Key=manifest_key, Body=encoded, ContentType='application/json')
        if read_small_object(client, bucket, manifest_key) != encoded:
            raise BackupError('manifest_readback_mismatch')
    expired = retention(client, bucket, prefix, now)
    return {'ok': True, 'backup_id': ident, 'plain_bytes': manifest['plain_bytes'],
            'cipher_bytes': manifest['cipher_bytes'], 'expired_backups': expired,
            'manifest_key': manifest_key, 'key_fingerprint': manifest['key_fingerprint']}


def main():
    try:
        print(json.dumps(run(), sort_keys=True))
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, BackupError) else 'backup_operation_failed'
        print(json.dumps({'ok': False, 'code': code}, sort_keys=True))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
