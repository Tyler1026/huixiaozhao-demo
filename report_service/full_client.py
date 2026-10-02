"""Bounded server-only HTTP adapter for FullReportBridge.

No credentials enter browser responses. Redirects are refused entirely. HTTP
loopback is opt-in for isolated acceptance; deployed endpoints require HTTPS.
"""
import hashlib
import hmac
import ipaddress
import json
import urllib.error
import urllib.parse
import urllib.request


class ClientError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HTTPReportClient:
    def __init__(self, base_url, *, timeout=20, allow_loopback_http=False):
        u = urllib.parse.urlsplit(base_url)
        if not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
            raise ValueError('invalid service endpoint')
        loopback = False
        try: loopback = ipaddress.ip_address(u.hostname).is_loopback
        except ValueError: pass
        if u.scheme != 'https' and not (u.scheme == 'http' and loopback and allow_loopback_http):
            raise ValueError('HTTPS required')
        if not 0 < timeout <= 60:
            raise ValueError('invalid timeout')
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        handlers = [NoRedirect()]
        if loopback:
            handlers.append(urllib.request.ProxyHandler({}))
        self.opener = urllib.request.build_opener(*handlers)

    def _request(self, path, credential, payload=None, *, binary=False):
        request = urllib.request.Request(self.base_url + path,
            data=json.dumps(payload, ensure_ascii=False, allow_nan=False).encode() if payload is not None else None,
            headers={'Authorization': 'Bearer ' + credential, 'Content-Type': 'application/json'})
        limit = 32_000_000 if binary else 2_000_000
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                if response.status not in (200, 201):
                    raise ClientError('report service unavailable')
                data = response.read(limit + 1)
                if len(data) > limit:
                    raise ClientError('report service response too large')
            return data if binary else json.loads(data)
        except (OSError, ValueError, urllib.error.URLError):
            raise ClientError('report service unavailable') from None

    def _report(self, rid, credential):
        if not isinstance(rid, str) or len(rid) != 64 or any(c not in '0123456789abcdef' for c in rid):
            raise ClientError('invalid report id')
        result = self._request('/v1/reports/' + rid, credential)
        if not isinstance(result, dict) or result.get('id') != rid:
            raise ClientError('invalid report response')
        return result

    def __call__(self, action, *, tenant_id, credential, **kwargs):
        if not isinstance(tenant_id, str) or not tenant_id or tenant_id == 'default' or not isinstance(credential, str) or len(credential) < 32:
            raise ClientError('explicit organization credential required')
        if action == 'create':
            payload = dict(kwargs['payload'])
            if set(payload) != {'province', 'city', 'synthetic'}:
                raise ClientError('invalid create payload')
            payload['idempotency_key'] = kwargs['idempotency_key']
            result = self._request('/v1/reports', credential, payload)
            return {'id': result['id']}
        if action not in ('get', 'artifact'):
            raise ClientError('unsupported action')
        rid = kwargs['report_id']
        report = self._report(rid, credential)
        manifest = report.get('manifest') or {}
        entries = manifest.get('files', [])
        if not isinstance(entries, list):
            raise ClientError('invalid manifest')
        if action == 'get':
            return {'status': report['status'], 'artifacts': [x['name'] for x in entries],
                    **{k: report.get(k) for k in ('progress_at','stages_done','stages_total','parts_done','parts_total','failure_code','current')}}
        name = kwargs['name']
        if report['status'] != 'completed' or not isinstance(name, str) or '/' in name or '\\' in name or '..' in name:
            raise ClientError('artifact unavailable')
        matches = [x for x in entries if x.get('name') == name]
        if len(matches) != 1:
            raise ClientError('artifact unavailable')
        item = matches[0]
        data = self._request('/v1/reports/' + rid + '/artifacts/' + urllib.parse.quote(name, safe=''), credential, binary=True)
        if len(data) != item['bytes'] or not hmac.compare_digest(hashlib.sha256(data).hexdigest(), item['sha256']):
            raise ClientError('artifact integrity failure')
        return data
