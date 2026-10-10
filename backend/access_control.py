"""Pure access rules for the shared website snapshot.

The caller supplies a server-authenticated principal and the locked, complete
snapshot.  ``guard_sync`` is an internal merge input, never a response body: it
retains other workspaces' values for legacy fields that replace whole maps.
No storage, environment, network, or credentials are opened by this module.
"""
from __future__ import annotations

import copy
import json
from collections.abc import Mapping

from .auth import AuthError, _active, _memberships, safe_profile


PROJECT_MAP_FIELDS = frozenset({
    'PROJECTS', 'REPORTSTATE', 'UPLOADS', 'KB_FILE_CHUNKS', 'KB_CONFIRMS',
    'KB_CONFIRM_TOMBS', 'KB_ITEM_TOMBS', 'KB_UNLOCKED', 'PENDING_CONFIRMS',
    'DOCK_LOGS', 'REPORT_HISTORY',
})
COMPOSITE_MAP_FIELDS = frozenset({'UPLOAD_TOMBS', 'KB_CHAT_TOMBS'})
AUTH_TABLES = frozenset({'USER_PROFILES', 'INVITE_CODES', 'CITY_ACCOUNTS'})
PARENT_FIELDS = ('parentKey', 'parentProjKey', 'parentProjectKey', 'parent')
REPORT_REFERENCE_FIELDS = frozenset({'reportRequestId', 'sourceReportId'})
_READONLY_FIELDS = frozenset({'CITY_BASE_PACKAGES', 'OPS_ENT'})
_META_FIELDS = frozenset({'cur', 'view', 'syncTs', 'RESET_GEN', 'clientUser'})
_MEMBER_FIELDS = (PROJECT_MAP_FIELDS | COMPOSITE_MAP_FIELDS | _READONLY_FIELDS
                  | _META_FIELDS | {'KB_CHAT', 'DEMANDS', 'REPORT_REQUESTS',
                                    'DELETED_PROJECTS', 'DELETED_CLUES'})
_STATE_FIELDS = _MEMBER_FIELDS | AUTH_TABLES | {'AUTH_SESSIONS', 'RAG_AUDIT', 'REPORT_PUBLICATIONS'}
_SECRET_NAMES = frozenset({
    'pwd', 'password', 'passwordhash', 'pwdhash', 'token', 'sessiontoken',
    'accesstoken', 'refreshtoken', 'authorization', 'cookie', 'setcookie',
    'apikey', 'secret', 'credentials', 'credentialfingerprint',
    'adminconfigfingerprint', 'adminpassword', 'auth', 'authsessions',
})
_CACHE_NAMES = frozenset({
    'huixiaozhaokbv1', 'hxzauth', 'localstorage', 'sessionstorage',
    'cachedsync', 'syncsnapshot', 'authcache', 'sessioncache',
})


def _deny(code='workspace_forbidden', message='没有该工作区的访问权限'):
    raise AuthError(403, code, message)


def _name(value):
    return ''.join(c for c in str(value).casefold() if c.isalnum())


def _secret(key):
    return (str(key).upper().startswith('AUTH_') or _name(key) in _SECRET_NAMES)


def _key(value):
    return (isinstance(value, str) and bool(value) and value == value.strip()
            and len(value) <= 256 and '::' not in value
            and not any(ord(c) < 32 or ord(c) == 127 for c in value))


def _scope(principal):
    if not isinstance(principal, Mapping) or principal.get('scope') not in ('admin', 'project'):
        _deny('auth_required', '请重新登录')
    return principal['scope']


def _member_roots(principal):
    roots = principal.get('projectKeys', [])
    roots = {key for key in roots if _key(key)} if isinstance(roots, (list, tuple, set)) else set()
    if _key(principal.get('projKey')):
        roots.add(principal['projKey'])
    return roots


def _projects(state):
    value = state.get('PROJECTS', {}) if isinstance(state, Mapping) else {}
    return value if isinstance(value, dict) else {}


def _known_roots(state, principal):
    """Count all known roots, including revoked invitations and other members."""
    roots = set(_member_roots(principal))
    cities = {}

    def add(key, city=None):
        if _key(key):
            roots.add(key)
            if isinstance(city, str) and city.strip():
                cities.setdefault(key, set()).add(city.strip())

    for table in ('INVITE_CODES', 'USER_PROFILES', 'CITY_ACCOUNTS'):
        values = state.get(table, {})
        if not isinstance(values, dict):
            continue
        for record in values.values():
            if not isinstance(record, dict):
                continue
            add(record.get('projKey'), record.get('city'))
            memberships = record.get('memberships')
            if isinstance(memberships, dict):
                for key, membership in memberships.items():
                    add(key, membership.get('city') if isinstance(membership, dict) else None)
    for key, project in _projects(state).items():
        if not isinstance(project, dict):
            continue
        add(project.get('workspaceId'))
        if key in roots:
            add(key, project.get('city'))
    for key in roots:
        project = _projects(state).get(key)
        if isinstance(project, dict):
            add(key, project.get('city'))
    return roots, cities


def _project_roots(state, principal):
    projects = _projects(state)
    known, _ = _known_roots(state, principal)
    resolved = {}

    def resolve(key, visiting=frozenset()):
        if key in resolved:
            return resolved[key]
        if key in visiting:
            return None
        project = projects.get(key)
        if not isinstance(project, dict):
            return key if key in known else None
        if 'workspaceId' in project:
            root = project['workspaceId']
            result = root if _key(root) and root in known else None
            # An invitation root must not point into another workspace.
            if key in known and root != key:
                result = None
        elif key in known:
            result = key
        else:
            parents = [project[name] for name in PARENT_FIELDS if name in project]
            if parents:
                parent_roots = {resolve(parent, visiting | {key}) if _key(parent) else None
                                for parent in parents}
                result = next(iter(parent_roots)) if len(parent_roots) == 1 and None not in parent_roots else None
            else:
                # A city label is not ownership evidence, even if only one
                # invitation currently names that city. New invitations must
                # never adopt pre-existing, unassigned projects or their data.
                result = None
        resolved[key] = result
        return result

    for key in projects:
        resolve(key)
    for root in known:
        if root not in projects:
            resolved[root] = root
    return resolved


def allowed_project_keys(state, principal):
    """Return project IDs authorized by membership, never by a city alone."""
    if _scope(principal) == 'admin':
        return set(_projects(state))
    roots = _member_roots(principal)
    return {key for key, root in _project_roots(state, principal).items() if root in roots}


def authorize_project(key, state, principal):
    """Return an authorized project ID, otherwise raise a safe 403."""
    if not _key(key) or key not in allowed_project_keys(state, principal):
        _deny()
    return key


def _json_container(value):
    if not isinstance(value, str) or len(value) > 2_000_000 or not value.lstrip().startswith(('{', '[')):
        return None
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, (dict, list)) else None
    except (ValueError, TypeError):
        return None


def _redact(value, depth=0):
    if depth > 80:
        return None
    if isinstance(value, dict):
        return {key: _redact(item, depth + 1) for key, item in value.items()
                if not _secret(key) and _name(key) not in _CACHE_NAMES
                and not (depth > 0 and key in _STATE_FIELDS)}
    if isinstance(value, list):
        return [_redact(item, depth + 1) for item in value]
    encoded = _json_container(value)
    if encoded is not None:
        return json.dumps(_redact(encoded, depth + 1), ensure_ascii=False)
    return copy.deepcopy(value)


def _report_refs(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in REPORT_REFERENCE_FIELDS and isinstance(item, str):
                yield item
            elif isinstance(item, (dict, list)):
                yield from _report_refs(item)
    elif isinstance(value, list):
        for item in value:
            yield from _report_refs(item)


def _referenced_reports(state, allowed):
    refs = set()
    for field in ('PROJECTS', 'REPORTSTATE'):
        table = state.get(field, {})
        if isinstance(table, dict):
            for key in allowed:
                refs.update(_report_refs(table.get(key)))
    return refs


def _report_allowed(record, allowed, refs):
    if not isinstance(record, dict):
        return False
    if 'projectKey' in record:
        return _key(record.get('projectKey')) and record['projectKey'] in allowed
    return isinstance(record.get('id'), str) and record['id'] in refs


def _record_project(record, allowed):
    if not isinstance(record, dict):
        return None
    explicit = [record[name] for name in ('projKey', 'projectKey') if name in record]
    if explicit:
        return explicit[0] if all(_key(key) and key in allowed and key == explicit[0] for key in explicit) else None
    key = record.get('id')
    if isinstance(key, str):
        if key in allowed:
            return key
        if key.startswith('d') and key[1:] in allowed:
            return key[1:]
    return None


def _chat_allowed(key, allowed, roots):
    return key in allowed or key in {'workspace:' + root for root in roots}


def _composite_allowed(key, allowed, roots, *, chat=False):
    if not isinstance(key, str) or '::' not in key:
        return False
    owner, suffix = key.split('::', 1)
    return bool(suffix) and (_chat_allowed(owner, allowed, roots) if chat else owner in allowed)


def _member_profiles(state, principal):
    """Project owner roster with only each member's current-root identity.

    Account collisions are omitted as a whole: a legacy username shared by
    both account tables must not select another person's profile implicitly.
    Authentication owns the definition of active and legacy memberships.
    """
    grouped = {}
    for field in ('USER_PROFILES', 'CITY_ACCOUNTS'):
        table = state.get(field)
        if not isinstance(table, dict):
            continue
        for key, record in table.items():
            if isinstance(key, str) and key.strip():
                grouped.setdefault(key.strip().casefold(), []).append(record)
    username = principal.get('user')
    username = username.strip().casefold() if isinstance(username, str) else None
    result = {}
    own = grouped.get(username, [])
    if len(own) == 1 and isinstance(own[0], dict):
        result[username] = safe_profile(own[0], username)
    root = principal.get('projKey')
    if principal.get('role') != 'owner' or not _key(root):
        return result
    for user, records in grouped.items():
        if user == username or len(records) != 1 or not _active(records[0]):
            continue
        record = records[0]
        member = _memberships(record).get(root)
        if member is None:
            continue
        name = record.get('name')
        result[user] = {'user': user, 'name': name if isinstance(name, str) else user,
                        'projKey': root, 'role': member['role']}
    return result


def scoped_sync_view(state, principal):
    """Deep-copy only authorized business data, with credentials always removed."""
    if not isinstance(state, dict):
        _deny('invalid_storage', '数据暂不可用')
    if _scope(principal) == 'admin':
        return _redact(state)
    allowed = allowed_project_keys(state, principal)
    project_roots = _project_roots(state, principal)
    roots = _member_roots(principal)
    result = {}
    for field in PROJECT_MAP_FIELDS:
        value = state.get(field)
        if isinstance(value, dict):
            result[field] = {key: copy.deepcopy(item) for key, item in value.items() if key in allowed}
            if field == 'PROJECTS':
                # The client filters by explicit workspace ownership. Expose
                # the same canonical owner used by the server for authorized
                # legacy projects without changing their stored records.
                for key, projected in result[field].items():
                    if isinstance(projected, dict):
                        projected['workspaceId'] = project_roots[key]
    for field in COMPOSITE_MAP_FIELDS:
        value = state.get(field)
        if isinstance(value, dict):
            result[field] = {key: copy.deepcopy(item) for key, item in value.items()
                             if _composite_allowed(key, allowed, roots, chat=field == 'KB_CHAT_TOMBS')}
    chat = state.get('KB_CHAT')
    if isinstance(chat, dict):
        result['KB_CHAT'] = {key: copy.deepcopy(item) for key, item in chat.items()
                             if _chat_allowed(key, allowed, roots)}
    for field in ('DEMANDS', 'REPORT_REQUESTS'):
        value = state.get(field)
        if isinstance(value, list):
            refs = _referenced_reports(state, allowed)
            result[field] = [copy.deepcopy(item) for item in value
                             if (_report_allowed(item, allowed, refs) if field == 'REPORT_REQUESTS'
                                 else _record_project(item, allowed) is not None)]
    for field in ('DELETED_PROJECTS', 'DELETED_CLUES'):
        value = state.get(field)
        if isinstance(value, list):
            result[field] = [key for key in value if (key in allowed if field == 'DELETED_PROJECTS'
                                                     else _composite_allowed(key, allowed, roots))]
    packages = state.get('CITY_BASE_PACKAGES')
    if isinstance(packages, dict):
        result['CITY_BASE_PACKAGES'] = {city: key for city, key in packages.items() if key in allowed}
    for field in ('view', 'syncTs', 'RESET_GEN'):
        if field in state:
            result[field] = copy.deepcopy(state[field])
    result['cur'] = state.get('cur') if _key(state.get('cur')) and state['cur'] in allowed else principal.get('projKey')
    profiles = _member_profiles(state, principal)
    if profiles:
        result['USER_PROFILES'] = profiles
    return _redact(result)


def _scan_payload(value, depth=0):
    if depth > 80:
        _deny('invalid_sync', '同步数据格式不正确')
    if isinstance(value, dict):
        for key, item in value.items():
            if (key in AUTH_TABLES or _secret(key) or _name(key) in _CACHE_NAMES
                    or key in ('__proto__', 'constructor', 'prototype')
                    or depth > 0 and key in _STATE_FIELDS):
                _deny('protected_field', '账号、邀请码和会话信息只能通过专用接口修改')
            _scan_payload(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _scan_payload(item, depth + 1)
    else:
        encoded = _json_container(value)
        if encoded is not None:
            _scan_payload(encoded, depth + 1)


def _map(value):
    if not isinstance(value, dict):
        _deny('invalid_sync', '同步数据格式不正确')
    return value


def _check_refs(value, allowed_refs):
    if any(ref not in allowed_refs for ref in _report_refs(value)):
        _deny('report_forbidden', '没有该报告的访问权限')


def _orphan_key_in_use(key, state):
    """A new project must not claim old, unassigned data by guessing its ID."""
    for field in (PROJECT_MAP_FIELDS - {'PROJECTS'}) | {'KB_CHAT'}:
        value = state.get(field)
        if isinstance(value, dict) and key in value:
            return True
    for field in COMPOSITE_MAP_FIELDS:
        value = state.get(field)
        if isinstance(value, dict) and any(isinstance(item, str) and item.startswith(key + '::') for item in value):
            return True
    for field in ('DEMANDS', 'REPORT_REQUESTS'):
        value = state.get(field)
        if isinstance(value, list) and any(isinstance(item, dict)
                and (item.get('projKey') == key or item.get('projectKey') == key) for item in value):
            return True
    return False


def _prepare_projects(incoming, state, principal, allowed, project_roots):
    projects = _projects(state)
    values = _map(incoming)
    active = principal.get('projKey')
    roots = _member_roots(principal)
    known, _ = _known_roots(state, principal)
    tombs = state.get('DELETED_PROJECTS', [])
    tombs = set(tombs) if isinstance(tombs, list) else set()
    prepared = {}
    for key, value in values.items():
        if not _key(key) or not isinstance(value, dict):
            _deny('invalid_sync', '项目数据格式不正确')
        if key in projects:
            if key not in allowed:
                _deny()
            root = project_roots.get(key)
        else:
            if (active not in allowed or key in tombs or key in known and key not in roots
                    or key not in allowed and _orphan_key_in_use(key, state)):
                _deny()
            root = active
        if value.get('workspaceId', root) != root:
            _deny('workspace_immutable', '不能更改项目所属工作区')
        if 'id' in value and value['id'] != key:
            _deny('project_immutable', '不能更改项目标识')
        prepared[key] = copy.deepcopy(value)
        prepared[key]['workspaceId'] = root
        if key not in projects:
            prepared[key]['id'] = key
    effective = dict(projects, **prepared)
    effective_roots = dict(project_roots, **{key: value['workspaceId'] for key, value in prepared.items()})
    for key, value in prepared.items():
        for field in PARENT_FIELDS:
            if field in value and (not _key(value[field]) or effective_roots.get(value[field]) != value['workspaceId']):
                _deny('workspace_immutable', '不能更改项目所属工作区')
        old = effective.get(key, {}) if key not in projects else projects[key]
        if isinstance(old, dict) and 'workspaceId' in old and old['workspaceId'] != value['workspaceId']:
            _deny('workspace_immutable', '不能更改项目所属工作区')
    return prepared


def _prepare_requests(incoming, state, principal, allowed, refs):
    if not isinstance(incoming, list):
        _deny('invalid_sync', '报告申请格式不正确')
    saved = {}
    for record in state.get('REPORT_REQUESTS', []) or []:
        if isinstance(record, dict) and isinstance(record.get('id'), str):
            saved.setdefault(record['id'], []).append(record)
    result = []
    seen = set()
    for record in incoming:
        if not isinstance(record, dict) or not isinstance(record.get('id'), str) or record['id'] in seen:
            _deny('invalid_sync', '报告申请格式不正确')
        key = record['id']
        seen.add(key)
        matches = saved.get(key, [])
        if matches:
            if len(matches) != 1 or not _report_allowed(matches[0], allowed, refs):
                _deny('report_forbidden', '没有该报告的访问权限')
            old = matches[0]
            if 'projectKey' in record and record['projectKey'] != old.get('projectKey'):
                _deny('workspace_immutable', '不能更改报告所属工作区')
            value = copy.deepcopy(old)
            if record.get('status') == 'cancelled' and old.get('status') in ('pending', 'running'):
                value['status'] = 'cancelled'
            elif record.get('status', old.get('status')) != old.get('status'):
                _deny('report_immutable', '报告进度由服务器管理')
        else:
            if record.get('status') != 'pending' or principal.get('projKey') not in allowed:
                _deny('report_immutable', '只能提交新的待处理报告申请')
            if record.get('projectKey', principal['projKey']) != principal['projKey']:
                _deny('workspace_immutable', '不能更改报告所属工作区')
            value = {key: copy.deepcopy(record[key]) for key in ('id', 'city', 'province', 'mode', 'ts') if key in record}
            value.update(status='pending', projectKey=principal['projKey'], by=principal.get('user'))
        result.append(value)
    return result


def _prepare_demands(incoming, state, allowed, deleted):
    if not isinstance(incoming, list):
        _deny('invalid_sync', '需求数据格式不正确')
    existing = state.get('DEMANDS', [])
    existing = existing if isinstance(existing, list) else []
    current = {}
    for record in existing:
        if isinstance(record, dict) and isinstance(record.get('id'), str):
            current.setdefault(record['id'], []).append(record)
    updates = {}
    for record in incoming:
        if not isinstance(record, dict) or not _key(record.get('id')) or record['id'] in updates:
            _deny('invalid_sync', '需求数据格式不正确')
        if _record_project(record, allowed) is None:
            _deny()
        matches = current.get(record['id'], [])
        if matches and (len(matches) != 1 or _record_project(matches[0], allowed) is None):
            _deny()
        updates[record['id']] = copy.deepcopy(record)
    result = []
    for record in existing:
        key = record.get('id') if isinstance(record, dict) else None
        replacement = updates.pop(key, record)
        if _record_project(replacement, allowed) not in deleted:
            result.append(copy.deepcopy(replacement))
    result.extend(value for value in updates.values() if _record_project(value, allowed) not in deleted)
    return result


def guard_sync(raw_bytes, state, principal):
    """Authorize a client delta before legacy merge; do not expose its return value."""
    scope = _scope(principal)
    try:
        incoming = json.loads(raw_bytes)
    except (ValueError, TypeError, UnicodeError):
        _deny('invalid_sync', '同步数据格式不正确')
    if not isinstance(incoming, dict) or not isinstance(state, dict):
        _deny('invalid_sync', '同步数据格式不正确')
    _scan_payload(incoming)
    if scope == 'admin':
        for key, value in _map(incoming.get('PROJECTS', {})).items():
            old = _projects(state).get(key)
            if isinstance(old, dict) and isinstance(value, dict) and 'workspaceId' in old and value.get('workspaceId', old['workspaceId']) != old['workspaceId']:
                _deny('workspace_immutable', '不能更改项目所属工作区')
        return json.dumps(incoming, ensure_ascii=False).encode()
    if set(incoming) - _MEMBER_FIELDS:
        _deny('protected_field', '没有修改这些数据的权限')
    allowed = allowed_project_keys(state, principal)
    roots = _member_roots(principal)
    project_roots = _project_roots(state, principal)
    out = {}
    if 'PROJECTS' in incoming:
        out['PROJECTS'] = _prepare_projects(incoming['PROJECTS'], state, principal, allowed, project_roots)
        allowed |= set(out['PROJECTS'])
    refs = _referenced_reports(state, allowed)
    refs |= {record['id'] for record in state.get('REPORT_REQUESTS', []) or []
             if _report_allowed(record, allowed, refs)}
    if 'REPORT_REQUESTS' in incoming:
        out['REPORT_REQUESTS'] = _prepare_requests(incoming['REPORT_REQUESTS'], state, principal, allowed, refs)
        refs |= {record['id'] for record in out['REPORT_REQUESTS']}
    if 'PROJECTS' in out:
        _check_refs(out['PROJECTS'], refs)
    for field in PROJECT_MAP_FIELDS - {'PROJECTS'}:
        if field not in incoming:
            continue
        value = _map(incoming[field])
        if set(value) - allowed:
            _deny()
        if field == 'REPORTSTATE':
            _check_refs(value, refs)
        out[field] = copy.deepcopy(_map(state.get(field, {})))
        out[field].update(copy.deepcopy(value))
    if 'KB_CHAT' in incoming:
        value = _map(incoming['KB_CHAT'])
        if any(not _chat_allowed(key, allowed, roots) for key in value):
            _deny()
        out['KB_CHAT'] = copy.deepcopy(_map(state.get('KB_CHAT', {})))
        out['KB_CHAT'].update(copy.deepcopy(value))
    for field in COMPOSITE_MAP_FIELDS:
        if field not in incoming:
            continue
        value = _map(incoming[field])
        if any(not _composite_allowed(key, allowed, roots, chat=field == 'KB_CHAT_TOMBS') for key in value):
            _deny()
        out[field] = copy.deepcopy(_map(state.get(field, {})))
        out[field].update(copy.deepcopy(value))
    deleted = set()
    for field in ('DELETED_PROJECTS', 'DELETED_CLUES'):
        if field not in incoming:
            continue
        value = incoming[field]
        if not isinstance(value, list) or any(not isinstance(key, str) for key in value):
            _deny('invalid_sync', '删除记录格式不正确')
        if any(not (key in allowed if field == 'DELETED_PROJECTS' else _composite_allowed(key, allowed, roots)) for key in value):
            _deny()
        out[field] = copy.deepcopy(value)
        if field == 'DELETED_PROJECTS':
            deleted.update(value)
    if 'DEMANDS' in incoming:
        out['DEMANDS'] = _prepare_demands(incoming['DEMANDS'], state, allowed, deleted)
    for field in _READONLY_FIELDS:
        if field in incoming and incoming[field] not in ({}, [], None):
            projected = scoped_sync_view(state, principal)
            if incoming[field] != projected.get(field):
                _deny('protected_field', '这些数据只能由管理端修改')
    for field in _META_FIELDS:
        if field not in incoming:
            continue
        value = incoming[field]
        if field == 'cur' and value is not None and (not _key(value) or value not in allowed):
            _deny()
        if field == 'clientUser':
            if value != principal.get('user'):
                _deny('identity_immutable', '不能更改当前账号')
            continue
        if field == 'RESET_GEN' and value != state.get('RESET_GEN'):
            _deny('stale_generation', '数据已更新，请刷新后重试')
        out[field] = copy.deepcopy(value)
    return json.dumps(out, ensure_ascii=False).encode()


__all__ = ['allowed_project_keys', 'authorize_project', 'scoped_sync_view', 'guard_sync']
