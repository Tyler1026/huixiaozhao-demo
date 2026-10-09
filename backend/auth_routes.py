"""Small HTTP boundary for server-owned accounts, sessions and invitations."""
import json
from http.cookies import SimpleCookie
from urllib.parse import urlsplit

from .auth import (AuthError, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS,
                   handle_auth, require_session)
from .admin_invites import manage_invite, remove_member


def respond(handler, status, value, *, cookie=None):
    data = json.dumps(value, ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(data)))
    handler.send_header('Cache-Control', 'no-store')
    handler.send_header('Vary', 'Cookie, X-HXZ-Report-Client, Sec-Fetch-Site, Sec-Fetch-Dest, Sec-Fetch-Mode')
    if cookie:
        handler.send_header('Set-Cookie', cookie)
    handler.cors()
    handler.end_headers()
    handler.wfile.write(data)


def error_response(handler, error):
    return respond(handler, error.status,
                   {'ok': False, 'error': error.code, 'message': error.message})


def check_origin(headers):
    if headers.get('Sec-Fetch-Site', '').lower() == 'cross-site':
        raise AuthError(403, 'cross_site_request', '请从本站页面提交')
    origin = headers.get('Origin')
    if origin:
        try:
            parsed = urlsplit(origin)
        except ValueError:
            raise AuthError(403, 'cross_site_request', '请从本站页面提交') from None
        if (parsed.scheme not in ('http', 'https') or parsed.username or parsed.password
                or parsed.netloc.lower() != headers.get('Host', '').lower()
                or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            raise AuthError(403, 'cross_site_request', '请从本站页面提交')


def parse_body(raw):
    if len(raw) > 64 * 1024:
        raise AuthError(413, 'request_too_large', '请求内容过大')
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeError):
        raise AuthError(400, 'invalid_json', '请求格式不正确') from None
    if not isinstance(body, dict):
        raise AuthError(400, 'invalid_json', '请求格式不正确')
    return body


def session_cookie(token='', *, secure=True, clear=False):
    cookie = SimpleCookie()
    cookie[SESSION_COOKIE_NAME] = token
    item = cookie[SESSION_COOKIE_NAME]
    item['path'] = '/'
    item['httponly'] = True
    item['samesite'] = 'Strict'
    item['max-age'] = 0 if clear else SESSION_TTL_SECONDS
    if secure:
        item['secure'] = True
    return item.OutputString()


def load_state(use_database, read, file_path):
    try:
        if use_database:
            raw = read()
            if raw is None:
                raise OSError()
        else:
            try:
                with open(file_path, encoding='utf-8') as source:
                    raw = source.read()
            except FileNotFoundError:
                raw = '{}'
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except Exception:
        raise AuthError(503, 'storage_unavailable', '账户服务暂不可用，请稍后重试') from None


_OPERATIONS = {
    ('GET', '/api/auth/session'): 'session',
    ('POST', '/api/auth/login'): 'login',
    ('POST', '/api/auth/register'): 'register',
    ('POST', '/api/auth/logout'): 'logout',
    ('POST', '/api/auth/invite/validate'): 'validate_invite',
    ('POST', '/api/auth/join'): 'join',
    ('POST', '/api/auth/workspace'): 'switch_workspace',
}


def dispatch_auth(handler, method, path, raw, session_factory, *, admin_config=None, secure=True):
    """Return True for handled auth/admin requests, including safe failures."""
    operation = _OPERATIONS.get((method, path))
    admin_action = method == 'POST' and path in ('/api/admin/invites', '/api/auth/members')
    if operation is None and not admin_action:
        if path.startswith('/api/auth/') or path == '/api/admin/invites':
            respond(handler, 405, {'ok': False, 'error': 'method_not_allowed', 'message': '请求方式不支持'})
            return True
        return False
    try:
        if method == 'POST':
            check_origin(handler.headers)
        body = parse_body(raw) if method == 'POST' else {}
        if admin_action:
            try:
                with session_factory() as session:
                    action = manage_invite if path == '/api/admin/invites' else remove_member
                    result = action(body, session, headers=handler.headers, admin_config=admin_config)
            except AuthError:
                raise
            except Exception:
                raise AuthError(503, 'storage_unavailable', '尚未保存，请稍后重试') from None
        else:
            result = handle_auth(operation, body, session_factory, headers=handler.headers,
                                 admin_config=admin_config)
        result = dict(result)
        token = result.pop('session_token', None)
        result.pop('expires_at', None)
        if 'auth' in result:
            result['authenticated'] = True
        cookie = (session_cookie(clear=True, secure=secure) if operation == 'logout' else
                  session_cookie(token, secure=secure) if token else None)
        respond(handler, 200, result, cookie=cookie)
    except AuthError as error:
        error_response(handler, error)
    return True


def require_admin(principal):
    if principal.get('scope') != 'admin':
        raise AuthError(403, 'admin_required', '此操作需要管理端权限')


def sync_guard(headers, admin_config, access_guard, report_guard):
    """Recheck the live session inside the same lock used to merge the snapshot."""
    def guard(raw, state):
        principal = require_session(headers, state, admin_config=admin_config)
        return report_guard(access_guard(raw, state, principal), state)
    return guard
