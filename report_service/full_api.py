"""Service-to-service full-v1 API. Never use the legacy browser sync identity.

Credentials explicitly map to organizations. Cookie/Origin requests are refused;
public websites must use an authenticated server adapter, not expose bearer keys.
"""
import hmac
import http.server
import json
import re
import socketserver
import urllib.parse

from .full_store import Conflict

MAX_BODY = 65536
RID = re.compile(r'^[0-9a-f]{64}$')


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def validate_tokens(tokens):
    if not isinstance(tokens, dict) or not tokens:
        raise ValueError('explicit tenant credentials required')
    for token, tenant in tokens.items():
        if (not isinstance(token, str) or len(token) < 32 or not isinstance(tenant, str)
                or not tenant.strip() or tenant == 'default' or len(tenant) > 128
                or any(ord(c) < 32 for c in token + tenant)):
            raise ValueError('invalid tenant credentials')
    return dict(tokens)


def make_handler(store, token_map, *, allow_live=False):
    tokens = validate_tokens(token_map)

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = 'FullReport/1'

        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def log_message(self, fmt, *args):
            # Tokens, request bodies and private reports must not enter access logs.
            pass

        def send(self, status, value, *, media='application/json; charset=utf-8', name=None):
            body = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', media)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            if name:
                self.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + urllib.parse.quote(name, safe=''))
            self.end_headers()
            self.wfile.write(body)

        def authenticate(self):
            if self.headers.get('Origin') or self.headers.get('Cookie'):
                self.send(403, {'error': 'browser credentials not accepted'})
                return None
            auth = self.headers.get('Authorization', '')
            token = auth[7:] if auth.startswith('Bearer ') else ''
            for known, tenant in tokens.items():
                if hmac.compare_digest(token, known):
                    return tenant
            self.send(401, {'error': 'unauthorized'})
            return None

        def do_GET(self):
            try:
                path = urllib.parse.urlsplit(self.path).path
                if path == '/healthz':
                    self.send(200, {'ok': True, 'version': 'full-v1', 'meaning': 'api process only'})
                    return
                tenant = self.authenticate()
                if tenant is None:
                    return
                if path == '/v1/reports':
                    self.send(200, {'reports': store.list_reports(tenant)})
                    return
                segments = path.strip('/').split('/')
                if len(segments) not in (3, 5) or segments[:2] != ['v1', 'reports'] or not RID.fullmatch(segments[2]):
                    self.send(404, {'error': 'not found'})
                    return
                rid = segments[2]
                report = store.get(tenant, rid)
                if report is None:
                    self.send(404, {'error': 'not found'})
                    return
                if len(segments) == 3:
                    self.send(200, report)
                    return
                name = urllib.parse.unquote(segments[4])
                if segments[3] != 'artifacts' or '/' in name or '\\' in name or name in ('.', '..'):
                    self.send(404, {'error': 'not found'})
                    return
                if report['status'] != 'completed':
                    self.send(409, {'error': 'report not completed'})
                    return
                from .full_artifacts import read_artifact
                try:
                    payload = read_artifact(store.artifact_root, rid, name, report['manifest'])
                    item = next(x for x in report['manifest']['files'] if x['name'] == name)
                except (OSError, ValueError, KeyError, TypeError, StopIteration):
                    self.send(404, {'error': 'artifact unavailable or invalid'})
                    return
                self.send(200, payload, media=item['media_type'], name=name)
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception:
                self.send(503, {'error': 'service unavailable'})

        def do_POST(self):
            try:
                tenant = self.authenticate()
                if tenant is None:
                    return
                if urllib.parse.urlsplit(self.path).path != '/v1/reports':
                    self.send(404, {'error': 'not found'})
                    return
                try:
                    length = int(self.headers.get('Content-Length', '-1'))
                    if self.headers.get('Transfer-Encoding') or length < 0:
                        raise ValueError()
                    if length > MAX_BODY:
                        self.send(413, {'error': 'body too large'})
                        self.close_connection = True
                        return
                    body = json.loads(self.rfile.read(length))
                    allowed = {'province', 'city', 'idempotency_key', 'synthetic'}
                    if not isinstance(body, dict) or set(body) != allowed:
                        raise ValueError()
                    if not isinstance(body['synthetic'], bool):
                        raise ValueError()
                    if not body['synthetic'] and not allow_live:
                        self.send(403, {'error': 'live reports disabled'})
                        return
                    report = store.create(tenant, body['province'], body['city'], body['idempotency_key'], body['synthetic'])
                except Conflict:
                    self.send(409, {'error': 'idempotency payload mismatch'})
                    return
                except (ValueError, TypeError, KeyError, UnicodeDecodeError):
                    self.send(400, {'error': 'invalid report request'})
                    return
                self.send(201 if report['created'] else 200, report)
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception:
                self.send(503, {'error': 'service unavailable'})

    return Handler
