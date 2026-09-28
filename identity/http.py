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
            if mutating and self.headers.get('Origin') != 'http://' + expected_host:
                return self.reply(403, {'error': 'invalid origin'})
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
            if self.path == '/auth/me' and self.command == 'GET':
                return self.reply(200, principal)
            if self.path == '/auth/logout' and self.command == 'POST':
                store.logout(token)
                return self.reply(200, {'ok': True},
                                  'hxz_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
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
