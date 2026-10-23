"""Administrator KB maintenance using the same locked transaction as edits."""
import copy
import json
import time

from .auth import AuthError, require_session
from .auth_routes import check_origin, error_response, require_admin, respond


MAX_REQUEST_BYTES = 50 * 1024 * 1024


def _valid_kb(value):
    return (isinstance(value, list)
            and all(isinstance(section, dict)
                    and isinstance(section.get('known', []), list)
                    for section in value))


def _count(kb):
    return sum(len(section.get('known', [])) for section in kb)


def maintain_kb(state, body, operation):
    """Apply only KB maintenance fields to the latest locked state.

    Keep the existing success and domain-error response shapes so old admin
    clients can continue using snapshot, rollback and clean without changes.
    """
    projects = state.get('PROJECTS') or {}
    if not isinstance(projects, dict):
        raise AuthError(503, 'storage_unavailable', '材料存储暂不可用，请稍后重试')
    key = body.get('projectKey', '')
    if not isinstance(key, str):
        raise AuthError(400, 'invalid_input', '工作区标识不正确')
    if operation == 'version' and key not in projects:
        city = body.get('city', '')
        key = next((k for k, value in projects.items()
                    if isinstance(value, dict) and value.get('city') == city), None)
    if key not in projects or not isinstance(projects[key], dict):
        return {'ok': False, 'error': 'project not found'}
    project = projects[key]
    if operation == 'clean':
        kb = body.get('kb')
        if not isinstance(kb, list):
            return {'ok': False, 'error': 'kb must be a list'}
        if not _valid_kb(kb):
            return {'ok': False, 'error': 'kb contains invalid sections'}
        project['kb'] = copy.deepcopy(kb)
        return {'ok': True, 'total': _count(kb)}
    if operation != 'version':
        raise AuthError(400, 'invalid_input', '材料维护操作不正确')
    action = body.get('action', 'snapshot')
    versions = project.get('kbVersions', [])
    if not isinstance(versions, list) or any(not isinstance(v, dict) for v in versions):
        raise AuthError(503, 'storage_unavailable', '材料版本暂不可用，请稍后重试')
    if action == 'snapshot':
        kb = project.get('kb') or []
        if not _valid_kb(kb):
            raise AuthError(503, 'storage_unavailable', '材料存储暂不可用，请稍后重试')
        # List length stops growing at ten; use saved version numbers so later
        # snapshots remain uniquely addressable by the existing integer API.
        version = max((v['ver'] for v in versions
                       if type(v.get('ver')) is int and v['ver'] > 0), default=0) + 1
        versions = versions + [{'ver': version, 'ts': int(time.time() * 1000),
                                'label': body.get('label', ''), 'chunks': _count(kb),
                                'kb': copy.deepcopy(kb)}]
        project['kbVersions'] = versions[-10:]
        return {'ok': True, 'ver': version, 'versions': len(project['kbVersions'])}
    if action == 'rollback':
        version = body.get('ver')
        target = next((v for v in versions if type(version) is int and v.get('ver') == version), None)
        if target is None:
            return {'ok': False, 'error': 'version not found'}
        if not _valid_kb(target.get('kb')):
            raise AuthError(503, 'storage_unavailable', '材料版本暂不可用，请稍后重试')
        project['kb'] = copy.deepcopy(target['kb'])
        project['kbInitTs'] = int(time.time() * 1000)
        return {'ok': True, 'restored': version}
    return {'ok': False, 'error': 'unknown action'}


def handle_kb_admin(handler, raw, session_factory, admin_config=None, *, operation):
    """Re-authenticate under lock and acknowledge only a committed write."""
    try:
        check_origin(handler.headers)
        if len(raw) > MAX_REQUEST_BYTES:
            raise AuthError(413, 'request_too_large', '请求内容过大')
        try:
            body = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        except (ValueError, UnicodeError, RecursionError):
            raise AuthError(400, 'invalid_json', '请求格式不正确') from None
        if not isinstance(body, dict):
            raise AuthError(400, 'invalid_json', '请求格式不正确')
        with session_factory() as session:
            state = json.loads(session.read())
            if not isinstance(state, dict):
                raise AuthError(503, 'storage_unavailable', '材料存储暂不可用，请稍后重试')
            require_admin(require_session(handler.headers, state, admin_config=admin_config))
            result = maintain_kb(state, body, operation)
            if result['ok'] and not session.write(json.dumps(state, ensure_ascii=False, allow_nan=False)):
                raise AuthError(503, 'storage_unavailable', '材料尚未保存，请重试')
        return respond(handler, 200, result)
    except AuthError as error:
        return error_response(handler, error)
    except Exception:
        return error_response(handler, AuthError(503, 'storage_unavailable', '材料尚未保存，请重试'))
