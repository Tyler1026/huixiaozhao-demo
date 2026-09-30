"""stdlib HTTP server for the standalone report service (localhost pilot).

Threat model in scope:

  * Bearer service token is required (env-configured, >= 32 chars). Tenants map
    from the authenticated credential (token -> tenant), NEVER from a client
    header such as ``X-Tenant``.
  * No CORS headers are ever emitted (not a public/browser API).
  * Body size is bounded; province/city/idempotency_key validated.
  * Health endpoint exposes no secrets/tenants/tokens.
"""

from __future__ import annotations

import hashlib
import hmac
import http.server
import json
import os
import socketserver
import urllib.parse

from .store import Store, StoreConflict

MAX_BODY = 64 * 1024
_TOKEN_MIN = 32


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class ReportServiceHandler(http.server.BaseHTTPRequestHandler):
    """Base handler; bind via make_handler() to inject store + token map."""

    store: Store = None
    token_map: dict = {}
    max_body = MAX_BODY

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    # -- plumbing -----------------------------------------------------------

    def _send(self, status, payload, content_type="application/json; charset=utf-8"):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = self.headers.get("Content-Length")
        if length is None:
            return b""
        try:
            length = int(length)
        except ValueError:
            return None
        if length < 0 or self.headers.get('Transfer-Encoding'):
            return None
        if length > self.max_body:
            raise _BodyTooLarge()
        return self.rfile.read(length)

    def _authenticate(self):
        """Return the tenant bound to the presented bearer token."""
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            raise _Unauthorized()
        token = auth[len("Bearer "):].strip()
        if not token:
            raise _Unauthorized()
        for known, tenant in self.token_map.items():
            if hmac.compare_digest(known, token):
                return tenant
        raise _Unauthorized()

    # -- routing ------------------------------------------------------------

    def do_GET(self):
        try:
            path = urllib.parse.urlsplit(self.path).path
            if path == "/healthz":
                self._send(200, {"ok": True, "status": "ok"})
                return
            if path.startswith("/reports/"):
                rid = path[len("/reports/"):]
                tenant = self._authenticate()
                report = self.store.get_report(tenant, rid)
                if report is None:
                    self._send(404, {"error": "not found"})
                    return
                self._send(200, report)
                return
            self._send(404, {"error": "not found"})
        except _Unauthorized:
            self._send(401, {"error": "unauthorized"})
        except Exception:
            self._send(500, {"error": "internal error"})

    def do_POST(self):
        try:
            path = urllib.parse.urlsplit(self.path).path
            if path.startswith('/reports/') and path.endswith('/retry'):
                tenant = self._authenticate()
                rid = path[len('/reports/'):-len('/retry')]
                try:
                    report = self.store.retry_failed(tenant, rid)
                except StoreConflict:
                    self._send(409, {'error': 'report is not retryable'})
                    return
                self._send(200 if report else 404, report or {'error': 'not found'})
                return
            if path != "/reports":
                self._send(404, {"error": "not found"})
                return
            tenant = self._authenticate()
            raw = self._read_body()
            try:
                body = json.loads(raw or b"null")
            except (ValueError, TypeError):
                self._send(400, {"error": "invalid json"})
                return
            if not isinstance(body, dict):
                self._send(400, {"error": "invalid payload"})
                return
            province = body.get("province")
            city = body.get("city")
            idempotency_key = body.get("idempotency_key")
            try:
                report = self.store.create_report(tenant, province or "", city or "", idempotency_key or "")
            except StoreConflict:
                self._send(409, {"error": "idempotency conflict"})
                return
            except ValueError as exc:
                self._send(400, {"error": str(exc)})
                return
            status = 201 if report.pop("created", False) else 200
            self._send(status, report)
        except _Unauthorized:
            self._send(401, {"error": "unauthorized"})
        except _BodyTooLarge:
            self._send(413, {"error": "body too large"})
        except Exception:
            self._send(500, {"error": "internal error"})


class _Unauthorized(Exception):
    pass


class _BodyTooLarge(Exception):
    pass


def make_handler(store, token_map, max_body=MAX_BODY):
    """Validate config and produce a handler class bound to this store."""
    if not isinstance(store, Store):
        raise ValueError("store must be a report_service.store.Store")
    if not isinstance(token_map, dict) or not token_map:
        raise ValueError("token map must be non-empty")
    for token, tenant in token_map.items():
        if not isinstance(token, str) or len(token) < _TOKEN_MIN:
            raise ValueError("service token must be >= 32 chars")
        if not isinstance(tenant, str) or not tenant.strip():
            raise ValueError("invalid tenant binding")

    class Handler(ReportServiceHandler):
        pass

    Handler.store = store
    Handler.token_map = dict(token_map)
    Handler.max_body = max_body
    return Handler


def config_from_env(env=None):
    """Build the token -> tenant map from the environment.

    HXZ_REPORT_SERVICE_TOKEN may be a JSON object ``{"<token>": "<tenant>"}``
    (multi-tenant) or a plain string (single token). A plain token uses
    HXZ_REPORT_TENANT (default ``default``) as its tenant."""
    env = os.environ if env is None else env
    raw = (env.get("HXZ_REPORT_SERVICE_TOKEN") or "").strip()
    if not raw:
        raise ValueError("HXZ_REPORT_SERVICE_TOKEN is required")
    if raw.startswith("{"):
        token_map = json.loads(raw)
        if not isinstance(token_map, dict):
            raise ValueError("invalid token map")
    else:
        token = raw
        tenant = (env.get("HXZ_REPORT_TENANT") or "default").strip()
        if not tenant:
            raise ValueError("missing tenant")
        token_map = {token: tenant}
    for token in list(token_map):
        if not isinstance(token, str) or len(token) < _TOKEN_MIN:
            raise ValueError("service token must be >= 32 chars")
    return token_map


def serve(store, host, port, token_map=None, max_body=MAX_BODY):
    """Blocking serve until KeyboardInterrupt."""
    if token_map is None:
        token_map = config_from_env()
    handler = make_handler(store, token_map, max_body=max_body)
    server = ThreadingHTTPServer((host, port), handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
