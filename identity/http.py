"""Loopback-only identity integration harness, not a production HTTP server."""
import argparse
import json
import re
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from .store import Store


def make_server(store, port=0):
    attempts = {}
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Never log credentials, cookies or request bodies.

        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def reply(self, status, body, cookie=None):
            data = json.dumps(body, allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            if cookie:
                self.send_header('Set-Cookie', cookie)
            self.end_headers()
            self.wfile.write(data)

        def dispatch(self):
            expected_host = '127.0.0.1:' + str(self.server.server_port)
            if self.headers.get('Host') != expected_host:
                return self.reply(403, {'error': 'invalid host'})
            mutating = self.command != 'GET'
            service_route = self.path == '/service/report-delivery' and self.command == 'POST'
            if service_route and (self.headers.get('Cookie') or self.headers.get('Origin')):
                return self.reply(403, {'error': 'machine credentials only'})
            if not service_route and (mutating or self.headers.get('Origin')) and self.headers.get('Origin') != 'http://' + expected_host:
                return self.reply(403, {'error': 'invalid origin'})
            if self.command == 'GET' and self.path in ('/', '/identity/client.js', '/identity/tenant-page.js'):
                from .page import page, ROOT
                if self.path == '/':
                    data, mime = page(), 'text/html; charset=utf-8'
                else:
                    name = 'client.cjs' if self.path.endswith('client.js') else 'tenant-page.js'
                    data, mime = (ROOT / 'identity' / name).read_bytes(), 'application/javascript'
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers(); self.wfile.write(data)
                return
            body = {}
            if mutating:
                if self.headers.get('Transfer-Encoding'):
                    return self.reply(400, {'error': 'unsupported transfer encoding'})
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    return self.reply(415, {'error': 'JSON required'})
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    if length < 0 or length > 1024 * 1024:
                        return self.reply(413, {'error': 'request too large'})
                    body = json.loads(self.rfile.read(length))
                    if not isinstance(body, dict):
                        raise ValueError()
                except (ValueError, TimeoutError):
                    return self.reply(400, {'error': 'invalid JSON'})
            if service_route:
                auth = self.headers.get('Authorization', '')
                if not auth.startswith('Bearer '):
                    return self.reply(401, {'error': 'service credential required'})
                token = auth[7:]
                try:
                    store.authenticate_service(token)
                except PermissionError:
                    return self.reply(401, {'error': 'invalid service credential'})
                if set(body) not in ({'project_id', 'text', 'version'}, {'project_id', 'text', 'version', 'delivery_id'}):
                    return self.reply(400, {'error': 'invalid delivery fields'})
                try:
                    return self.reply(200, store.deliver_report(token, body['project_id'], body['text'], body['version'], body.get('delivery_id')))
                except PermissionError:
                    return self.reply(403, {'error': 'service scope denied'})
                except ValueError as e:
                    return self.reply(409 if str(e) == 'version conflict' else 400, {'error': str(e)})
            if self.path == '/auth/login' and self.command == 'POST':
                ip = self.client_address[0]
                now = time.monotonic()
                with lock:
                    history = [t for t in attempts.get(ip, []) if now - t < 60]
                    if len(history) >= 5:
                        return self.reply(429, {'error': 'retry later'})
                    attempts[ip] = history + [now]
                try:
                    token, csrf = store.login(body.get('login'), body.get('password'))
                except PermissionError:
                    return self.reply(401, {'error': 'invalid credentials'})
                # No Secure only because this harness binds loopback HTTP exclusively.
                return self.reply(200, {'csrf': csrf},
                                  'hxz_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600')
            cookie = SimpleCookie()
            try:
                cookie.load(self.headers.get('Cookie', ''))
                token = cookie['hxz_session'].value if 'hxz_session' in cookie else ''
                principal = store.authenticate(token)
            except Exception:
                return self.reply(401, {'error': 'unauthorized'})
            if mutating:
                csrf = self.headers.get('X-CSRF-Token')
                if not csrf:
                    return self.reply(403, {'error': 'csrf required'})
                try:
                    store.authenticate(token, csrf=csrf)
                except PermissionError:
                    return self.reply(403, {'error': 'invalid csrf'})
            if self.command == 'POST' and self.path in ('/auth/members', '/auth/members/revoke'):
                try:
                    if self.path == '/auth/members':
                        if set(body) != {'login', 'password'}:
                            raise ValueError('invalid member fields')
                        uid = store.add_member(principal, body['login'], body['password'])
                        return self.reply(201, {'ok': True, 'id': uid})
                    if set(body) != {'id'} or not isinstance(body['id'], str):
                        raise ValueError('invalid member id')
                    store.remove_member(principal, body['id'])
                    return self.reply(200, {'ok': True})
                except PermissionError:
                    return self.reply(403, {'error': 'member operation forbidden'})
                except ValueError as e:
                    return self.reply(400, {'error': str(e)})
            if self.path == '/auth/session' and self.command == 'GET':
                return self.reply(200, store.resume(token))
            if self.path == '/auth/me' and self.command == 'GET':
                return self.reply(200, {k: principal[k] for k in ('id', 'role', 'org_id')})
            if self.path == '/auth/logout' and self.command == 'POST':
                store.logout(token)
                return self.reply(200, {'ok': True},
                                  'hxz_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
            from . import compat
            path = self.path.split('?', 1)[0]
            if path in compat.BLOCKED_ROUTES:
                return self.reply(403, {'error': 'route not enabled in tenant mode'})
            if path == '/api/sync':
                if '?' in self.path:
                    return self.reply(400, {'error': 'tenant selectors are not accepted'})
                try:
                    if self.command == 'GET':
                        return self.reply(200, compat.read(store, principal))
                    if self.command == 'POST':
                        return self.reply(200, compat.write(store, principal, body))
                    return self.reply(405, {'error': 'method not allowed'})
                except PermissionError:
                    return self.reply(403, {'error': 'forbidden'})
                except ValueError as e:
                    return self.reply(409 if str(e) == 'version conflict' else 400, {'error': str(e)})
            project_route = re.fullmatch(r'/api/projects/([a-zA-Z0-9_-]+)/(knowledge|report)', path)
            if project_route:
                if '?' in self.path:
                    return self.reply(400, {'error': 'query selectors not accepted'})
                from . import business
                project_id, resource = project_route.groups()
                try:
                    if resource == 'knowledge' and self.command == 'GET':
                        return self.reply(200, business.read_knowledge(store, principal, project_id))
                    if resource == 'knowledge' and self.command == 'PUT':
                        return self.reply(200, business.update_knowledge(store, principal, project_id, body))
                    if resource == 'report' and self.command == 'GET':
                        return self.reply(200, business.read_report(store, principal, project_id))
                    return self.reply(405, {'error': 'method not allowed'})
                except PermissionError:
                    return self.reply(403, {'error': 'forbidden'})
                except LookupError:
                    return self.reply(404, {'error': 'resource not found'})
                except ValueError as e:
                    return self.reply(409 if str(e) == 'version conflict' else 400, {'error': str(e)})
            match = re.fullmatch(r'/orgs/([a-zA-Z0-9_-]+)/state', self.path)
            if match:
                try:
                    if self.command == 'GET':
                        return self.reply(200, store.get_state(principal, match[1]))
                    if self.command == 'PUT':
                        if set(body) != {'data', 'version'}:
                            raise ValueError('invalid request fields')
                        version = store.put_state(principal, match[1], body['data'], body['version'])
                        return self.reply(200, {'ok': True, 'version': version})
                except PermissionError:
                    return self.reply(403, {'error': 'forbidden'})
                except ValueError as e:
                    status = 409 if str(e) == 'version conflict' else 400
                    return self.reply(status, {'error': str(e)})
            return self.reply(404, {'error': 'not found'})

        do_GET = dispatch
        do_POST = dispatch
        do_PUT = dispatch

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True)
    parser.add_argument('--port', type=int, default=5062)
    args = parser.parse_args()
    server = make_server(Store(args.db), args.port)
    print('Local synthetic integration API: http://127.0.0.1:' + str(server.server_port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
