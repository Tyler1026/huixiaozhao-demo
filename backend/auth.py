"""Account and workspace authentication over an injected serialized session.

No storage or environment is opened on import. ``handle_auth`` accepts the same
context-manager factory as ``sync_transaction``; low-level operations accept an
already locked session with ``read()`` and committed ``write(json) -> bool``.
Only register/login return ``session_token``. The HTTP adapter must remove that
field from its JSON response and put it in an HttpOnly, Secure, SameSite cookie.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import re
import secrets
import time
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass, field
from http.cookies import CookieError, SimpleCookie

SESSION_COOKIE_NAME = 'hxz_session'
SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
PBKDF2_ITERATIONS = 600_000
_HASH_ALGORITHM = 'pbkdf2_sha256'
_TOKEN_PATTERN = re.compile(r'^[A-Za-z0-9_-]{32,256}$')
_PROFILE_FIELDS = ('name', 'phone', 'wechat', 'org', 'dept', 'title')
_SECRET_FIELDS = ('pwd', 'password', 'password_hash', 'passwordHash', 'pwdHash')


class AuthError(ValueError):
    """A status and static, client-safe error; never contains submitted values."""

    def __init__(self, status, code, message):
        self.status, self.code, self.message = int(status), code, message
        super().__init__(message)

    def as_dict(self):
        return {'ok': False, 'code': self.code, 'error': self.message}


@dataclass(frozen=True)
class AdminConfig:
    username: str
    password: str = field(repr=False)


def _username(value):
    if not isinstance(value, str):
        raise AuthError(400, 'invalid_username', '请填写有效账号名')
    value = value.strip().casefold()
    if not value or len(value) > 128 or any(c.isspace() or unicodedata.category(c).startswith('C') for c in value):
        raise AuthError(400, 'invalid_username', '请填写有效账号名')
    return value


def admin_config_from_env(environ):
    """Explicit injection only; missing/partial configuration disables admin."""
    return _admin_config(environ)


def _admin_config(config):
    if isinstance(config, AdminConfig):
        username, password = config.username, config.password
    elif isinstance(config, Mapping):
        username = config.get('HXZ_ADMIN_USERNAME', config.get('username'))
        password = config.get('HXZ_ADMIN_PASSWORD', config.get('password'))
    else:
        return None
    if not isinstance(password, str) or not password or len(password) > 1024:
        return None
    try:
        username = _username(username)
    except AuthError:
        return None
    return AdminConfig(username, password)


def _password(value, *, registering=False):
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise AuthError(400, 'invalid_password', '请填写有效密码')
    if registering and len(value) < 8:
        raise AuthError(400, 'weak_password', '密码至少需要8位')
    try:
        value.encode('utf-8')
    except UnicodeError:
        raise AuthError(400, 'invalid_password', '请填写有效密码') from None
    return value


def hash_password(password):
    """Versioned PBKDF2 hash with a fresh 128-bit salt, never plaintext."""
    if not isinstance(password, str):
        raise ValueError('password must be text')
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, PBKDF2_ITERATIONS)
    encoded_salt = base64.urlsafe_b64encode(salt).decode().rstrip('=')
    return f'{_HASH_ALGORITHM}${PBKDF2_ITERATIONS}${encoded_salt}${digest.hex()}'


def verify_password(password, encoded):
    if not isinstance(password, str) or not isinstance(encoded, str):
        return False
    try:
        algorithm, count, encoded_salt, expected = encoded.split('$')
        iterations = int(count)
        if algorithm != _HASH_ALGORITHM or not 100_000 <= iterations <= 2_000_000:
            return False
        salt = base64.b64decode(encoded_salt + '=' * (-len(encoded_salt) % 4), altchars=b'-_', validate=True)
        if len(salt) != 16 or not re.fullmatch(r'[0-9a-f]{64}', expected):
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, iterations)
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, TypeError, UnicodeError):
        return False


def _body(body):
    if not isinstance(body, dict):
        raise AuthError(400, 'invalid_body', '请求格式不正确')
    return body


def _now(now):
    value = time.time() if now is None else now
    if type(value) not in (int, float) or not math.isfinite(value):
        raise AuthError(503, 'storage_unavailable', '账户服务暂不可用')
    return float(value)


def _read(session):
    try:
        state = json.loads(session.read())
        if not isinstance(state, dict):
            raise ValueError('invalid stored state')
        return state
    except Exception:
        raise AuthError(503, 'storage_unavailable', '账户服务暂不可用') from None


def _commit(session, state):
    try:
        committed = session.write(json.dumps(state, ensure_ascii=False, separators=(',', ':')))
    except Exception:
        committed = False
    if committed is not True:
        raise AuthError(503, 'storage_unavailable', '账户信息未保存，请重试') from None


def _map(state, key, *, create=False):
    value = state.get(key)
    if value is None and create:
        value = state[key] = {}
    if not isinstance(value, dict):
        if value is None:
            return {}
        raise AuthError(503, 'storage_unavailable', '账户服务暂不可用')
    return value


def _active(record):
    if not isinstance(record, dict):
        return False
    if any(record.get(key) for key in ('disabled', 'deleted', 'revoked')):
        return False
    if record.get('active') is False or record.get('enabled') is False:
        return False
    status = record.get('status')
    return not isinstance(status, str) or status.casefold() not in ('disabled', 'deleted', 'removed', 'revoked', 'inactive')


def _lookup(table, username):
    matches = [(key, value) for key, value in table.items()
               if isinstance(key, str) and key.strip().casefold() == username]
    # Ambiguous old case variants must not select a different account silently.
    return matches[0] if len(matches) == 1 else (None, None)


def _exists(table, username):
    return any(isinstance(key, str) and key.strip().casefold() == username for key in table)


def _role(value):
    return 'owner' if value == 'owner' else 'member'


def _project_key(value):
    return value.strip() if isinstance(value, str) and value.strip() and len(value) <= 256 else None


def _memberships(record):
    """Read current membership authority; never resurrect an explicitly empty map."""
    if 'memberships' not in record:
        key = _project_key(record.get('projKey'))
        return {key: {'role': _role(record.get('role')), 'joinedAt': record.get('ts', 0),
                      'city': record.get('city')}} if key else {}
    raw = record['memberships']
    if not isinstance(raw, dict):
        return {}
    return {key: dict(value, role=_role(value.get('role')))
            for key, value in raw.items()
            if isinstance(key, str) and key and _project_key(key) == key and _active(value)}


def _default_project(record, memberships):
    key = _project_key(record.get('projKey'))
    return key if key in memberships else next(iter(sorted(memberships)), None)


def safe_profile(record, username=None):
    """Allowlist fields only, including sanitized membership descriptions."""
    memberships = _memberships(record)
    result = {key: record[key] for key in _PROFILE_FIELDS
              if isinstance(record.get(key), str)}
    for key in ('city', 'projKey'):
        if isinstance(record.get(key), str):
            result[key] = record[key]
    if type(record.get('ts')) in (int, float) and math.isfinite(record['ts']):
        result['ts'] = record['ts']
    result['resident'] = bool(record.get('resident'))
    result['role'] = _role(record.get('role'))
    result['memberships'] = {
        key: {'role': member['role'], **({'joinedAt': member['joinedAt']}
              if type(member.get('joinedAt')) in (int, float) and math.isfinite(member['joinedAt']) else {})}
        for key, member in memberships.items()}
    if username is not None:
        result['user'] = username
    return result


def _invitation(body, state, now):
    code = body.get('inviteCode', body.get('code'))
    if not isinstance(code, str) or not code.strip() or len(code) > 128:
        raise AuthError(400, 'invalid_invite', '邀请码不存在或已失效')
    code = code.strip().upper()
    invite = _map(state, 'INVITE_CODES').get(code)
    if not _active(invite) or not isinstance(invite.get('city'), str) or not invite['city'].strip():
        raise AuthError(400, 'invalid_invite', '邀请码不存在或已失效')
    if not _project_key(invite.get('projKey')):
        raise AuthError(400, 'invalid_invite', '邀请码不存在或已失效')
    for key, milliseconds in (('expires_at', False), ('expiresAt', True)):
        if key in invite:
            expiry = invite[key]
            if type(expiry) not in (int, float) or not math.isfinite(expiry):
                raise AuthError(400, 'invalid_invite', '邀请码不存在或已失效')
            if (expiry / 1000 if milliseconds else expiry) <= now:
                raise AuthError(400, 'invalid_invite', '邀请码不存在或已失效')
    return code, invite


def validate_invite(body, state, *, now=None):
    _, invite = _invitation(_body(body), state, _now(now))
    return {'ok': True, 'city': invite['city']}


def _record_use(invite, username, now):
    used = invite.setdefault('usedBy', [])
    if not isinstance(used, list):
        raise AuthError(503, 'storage_unavailable', '账户服务暂不可用')
    if not any(isinstance(entry, dict) and isinstance(entry.get('user'), str)
               and entry['user'].strip().casefold() == username for entry in used):
        used.append({'user': username, 'ts': int(now * 1000)})


def _credential_fingerprint(record):
    encoded = record.get('password_hash')
    return hashlib.sha256(encoded.encode()).hexdigest() if isinstance(encoded, str) else None


def _token_digest(token):
    if not isinstance(token, str) or not _TOKEN_PATTERN.fullmatch(token):
        return None
    return hashlib.sha256(token.encode()).hexdigest()


def _cookie_token(headers, token):
    if token is not None:
        return token
    if headers is None:
        return None
    try:
        cookie_header = next((value for key, value in headers.items()
                              if isinstance(key, str) and key.casefold() == 'cookie'), '')
        if not isinstance(cookie_header, str) or len(cookie_header) > 8192:
            return None
        cookies = SimpleCookie()
        cookies.load(cookie_header)
        return cookies[SESSION_COOKIE_NAME].value if SESSION_COOKIE_NAME in cookies else None
    except (AttributeError, CookieError, TypeError, ValueError):
        return None


def _principal(username, record, active_project):
    memberships = _memberships(record)
    member = memberships.get(active_project, {})
    city = member.get('city', record.get('city'))
    name = record.get('name') or record.get('who')
    return {'user': username, 'scope': 'project',
            'role': memberships[active_project]['role'] if active_project in memberships else 'member',
            'projKey': active_project, 'projectKeys': sorted(memberships),
            'city': city if isinstance(city, str) else None,
            'resident': bool(record.get('resident')),
            'who': name if isinstance(name, str) else username,
            'org': record.get('org') if isinstance(record.get('org'), str) else ''}


def _admin_principal(config):
    return {'user': config.username, 'scope': 'admin', 'role': 'admin', 'projKey': None,
            'projectKeys': [], 'city': None, 'resident': False, 'who': config.username, 'org': ''}


def _session_record(headers, state, token, now):
    digest = _token_digest(_cookie_token(headers, token))
    session = _map(state, 'AUTH_SESSIONS').get(digest) if digest else None
    if not isinstance(session, dict):
        return None, None
    expiry = session.get('expires_at')
    if type(expiry) not in (int, float) or not math.isfinite(expiry) or expiry <= now:
        return None, None
    return digest, session


def resolve_principal(headers, state, admin_config=None, *, token=None, now=None):
    """Authenticate opaque cookie against current records, never client claims."""
    _, session = _session_record(headers, state, token, _now(now))
    if session is None:
        return None
    username = session.get('user')
    if not isinstance(username, str):
        return None
    if session.get('source') == 'admin':
        config = _admin_config(admin_config)
        if (config is None or config.username != username or not verify_password(
                config.username + '\0' + config.password, session.get('admin_config_fingerprint'))):
            return None
        return _admin_principal(config)
    source = session.get('source')
    if source not in ('USER_PROFILES', 'CITY_ACCOUNTS'):
        return None
    _, record = _lookup(_map(state, source), username)
    if not _active(record):
        return None
    current_fingerprint = _credential_fingerprint(record)
    saved_fingerprint = session.get('credential_fingerprint')
    if (not current_fingerprint or not isinstance(saved_fingerprint, str)
            or not hmac.compare_digest(current_fingerprint, saved_fingerprint)):
        return None
    memberships = _memberships(record)
    active = session.get('active_projKey')
    if active is not None and not isinstance(active, str):
        return None
    if active not in memberships and (active is not None or memberships):
        return None
    return _principal(username, record, active)


def require_session(headers, state, admin_config=None, *, token=None, now=None):
    principal = resolve_principal(headers, state, admin_config, token=token, now=now)
    if principal is None:
        raise AuthError(401, 'auth_required', '请重新登录')
    return principal


def _new_session(state, username, record, source, now, admin_config=None):
    sessions = _map(state, 'AUTH_SESSIONS', create=True)
    for old, value in list(sessions.items()):
        expiry = value.get('expires_at') if isinstance(value, dict) else None
        if type(expiry) not in (int, float) or not math.isfinite(expiry) or expiry <= now:
            del sessions[old]
    for _ in range(5):
        token = secrets.token_urlsafe(32)
        digest = _token_digest(token)
        if digest is not None and digest not in sessions:
            break
    else:
        raise AuthError(503, 'session_unavailable', '登录服务暂不可用')
    entry = {'user': username, 'source': source, 'created_at': now,
             'expires_at': now + SESSION_TTL_SECONDS}
    if source == 'admin':
        entry['admin_config_fingerprint'] = hash_password(admin_config.username + '\0' + admin_config.password)
        principal = _admin_principal(admin_config)
        profile = {'user': username, 'role': 'admin'}
    else:
        entry['active_projKey'] = _default_project(record, _memberships(record))
        entry['credential_fingerprint'] = _credential_fingerprint(record)
        principal = _principal(username, record, entry['active_projKey'])
        profile = safe_profile(record, username)
    sessions[digest] = entry
    return {'ok': True, 'auth': principal, 'profile': profile,
            'session_token': token, 'expires_at': entry['expires_at']}


def register(body, session, *, admin_config=None, now=None):
    body, now = _body(body), _now(now)
    username = _username(body.get('username', body.get('user')))
    password = _password(body.get('password', body.get('pwd')), registering=True)
    state = _read(session)
    config = _admin_config(admin_config)
    if (username == 'admin' or config is not None and username == config.username
            or _exists(_map(state, 'USER_PROFILES'), username)
            or _exists(_map(state, 'CITY_ACCOUNTS'), username)):
        raise AuthError(409, 'username_exists', '该账号已存在或为保留账号')
    code, invite = _invitation(body, state, now)
    profile = {}
    for key in _PROFILE_FIELDS:
        value = body.get(key, '')
        if not isinstance(value, str) or len(value) > 512:
            raise AuthError(400, 'invalid_profile', '用户资料格式不正确')
        profile[key] = value.strip()
    key = invite['projKey'].strip()
    role = _role(invite.get('role'))
    profile.update(name=profile['name'] or username, city=invite['city'], projKey=key,
                   role=role, resident=False, ts=int(now * 1000), inviteCode=code,
                   password_hash=hash_password(password), memberships={
                       key: {'role': role, 'joinedAt': int(now * 1000), 'inviteCode': code,
                             'city': invite['city']}})
    _map(state, 'USER_PROFILES', create=True)[username] = profile
    _record_use(invite, username, now)
    result = _new_session(state, username, profile, 'USER_PROFILES', now)
    _commit(session, state)
    return result


def _valid_credentials(record, password):
    if 'password_hash' in record:
        return verify_password(password, record['password_hash'])
    legacy = record.get('pwd')
    return isinstance(legacy, str) and hmac.compare_digest(password.encode(), legacy.encode())


def login(body, session, *, admin_config=None, now=None):
    body, now = _body(body), _now(now)
    username = _username(body.get('username', body.get('user')))
    password = _password(body.get('password', body.get('pwd')))
    state = _read(session)
    config = _admin_config(admin_config)
    if config is not None and username == config.username:
        if not hmac.compare_digest(password.encode(), config.password.encode()):
            raise AuthError(401, 'invalid_credentials', '账号或密码错误')
        result = _new_session(state, username, None, 'admin', now, config)
    else:
        profiles = _map(state, 'USER_PROFILES')
        key, record = _lookup(profiles, username)
        source = 'USER_PROFILES'
        if key is None and not _exists(profiles, username):
            key, record = _lookup(_map(state, 'CITY_ACCOUNTS'), username)
            source = 'CITY_ACCOUNTS'
        if username == 'admin' or not _active(record) or not _valid_credentials(record, password):
            raise AuthError(401, 'invalid_credentials', '账号或密码错误')
        if 'password_hash' not in record:
            record['password_hash'] = hash_password(password)
        if source == 'CITY_ACCOUNTS':
            record.setdefault('resident', True)
            record.setdefault('role', 'owner')
        for secret in _SECRET_FIELDS:
            if secret != 'password_hash':
                record.pop(secret, None)
        if 'memberships' not in record:
            record['memberships'] = _memberships(record)
        result = _new_session(state, username, record, source, now)
    _commit(session, state)
    return result


def _member_session(body, session, headers, token, admin_config, now):
    _body(body)
    state = _read(session)
    principal = require_session(headers, state, admin_config, token=token, now=now)
    if principal['scope'] != 'project':
        raise AuthError(403, 'member_required', '请使用成员账号操作')
    digest, stored = _session_record(headers, state, token, now)
    _, record = _lookup(_map(state, stored['source']), stored['user'])
    return state, principal, digest, stored, record


def join(body, session, *, headers=None, token=None, admin_config=None, now=None):
    now = _now(now)
    state, principal, _, stored, record = _member_session(body, session, headers, token, admin_config, now)
    code, invite = _invitation(body, state, now)
    key = invite['projKey'].strip()
    raw = record.get('memberships')
    if isinstance(raw, dict) and key in raw and not _active(raw[key]):
        raise AuthError(403, 'membership_disabled', '当前工作区权限已停用')
    if 'memberships' in record and not isinstance(raw, dict):
        raise AuthError(503, 'storage_unavailable', '账户服务暂不可用')
    # Preserve disabled membership tombstones while adding another workspace.
    memberships = dict(raw) if isinstance(raw, dict) else _memberships(record)
    memberships.setdefault(key, {'role': _role(invite.get('role')), 'joinedAt': int(now * 1000),
                                 'inviteCode': code, 'city': invite['city']})
    record['memberships'] = memberships
    if not _project_key(record.get('projKey')):
        record['projKey'] = key
    stored['active_projKey'] = key
    _record_use(invite, principal['user'], now)
    _commit(session, state)
    return {'ok': True, 'auth': _principal(principal['user'], record, key),
            'profile': safe_profile(record, principal['user'])}


def switch_workspace(body, session, *, headers=None, token=None, admin_config=None, now=None):
    now = _now(now)
    state, principal, _, stored, record = _member_session(body, session, headers, token, admin_config, now)
    key = _project_key(body.get('projKey'))
    if key is None or key not in _memberships(record):
        raise AuthError(403, 'workspace_forbidden', '没有该工作区的访问权限')
    stored['active_projKey'] = key
    _commit(session, state)
    return {'ok': True, 'auth': _principal(principal['user'], record, key),
            'profile': safe_profile(record, principal['user'])}


def logout(body, session, *, headers=None, token=None, admin_config=None, now=None):
    _body(body)
    state = _read(session)
    digest = _token_digest(_cookie_token(headers, token))
    sessions = _map(state, 'AUTH_SESSIONS')
    if digest in sessions:
        del sessions[digest]
        _commit(session, state)
    return {'ok': True}


def handle_auth(operation, body, session_factory, *, headers=None, token=None, admin_config=None, now=None):
    """HTTP-independent transaction boundary; safe errors are raised to adapter."""
    now = _now(now)
    if operation not in {'register', 'login', 'validate_invite', 'validate-invite', 'session', 'me',
                         'logout', 'join', 'switch_workspace', 'switch-workspace'}:
        raise AuthError(404, 'unknown_operation', '请求不存在')
    try:
        with session_factory() as session:
            if operation in ('register', 'login'):
                return {'register': register, 'login': login}[operation](
                    body, session, admin_config=admin_config, now=now)
            if operation in ('validate_invite', 'validate-invite'):
                return validate_invite(body, _read(session), now=now)
            if operation in ('session', 'me'):
                state = _read(session)
                principal = require_session(headers, state, admin_config, token=token, now=now)
                if principal['scope'] == 'admin':
                    profile = {'user': principal['user'], 'role': 'admin'}
                else:
                    _, stored = _session_record(headers, state, token, now)
                    _, record = _lookup(_map(state, stored['source']), stored['user'])
                    profile = safe_profile(record, principal['user'])
                return {'ok': True, 'auth': principal, 'profile': profile}
            function = {'join': join, 'logout': logout, 'switch_workspace': switch_workspace,
                        'switch-workspace': switch_workspace}[operation]
            return function(body, session, headers=headers, token=token, admin_config=admin_config, now=now)
    except AuthError:
        raise
    except Exception:
        raise AuthError(503, 'storage_unavailable', '账户服务暂不可用') from None


__all__ = ['AuthError', 'AdminConfig', 'SESSION_COOKIE_NAME', 'SESSION_TTL_SECONDS',
           'admin_config_from_env', 'hash_password', 'verify_password', 'safe_profile',
           'validate_invite', 'register', 'login', 'resolve_principal', 'require_session',
           'join', 'switch_workspace', 'logout', 'handle_auth']
