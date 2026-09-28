"""Explicit report delivery adapter; never reads or uploads a global snapshot."""
import json
import urllib.error
import urllib.parse
import urllib.request


def deliver(base_url, token, project_id, text, version, delivery_id, timeout=30):
    parsed = urllib.parse.urlsplit(base_url)
    if (parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname == '127.0.0.1')):
        raise ValueError('HTTPS required outside loopback')
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('base URL must be an origin')
    if not token or not delivery_id:
        raise ValueError('explicit credential and delivery id required')
    payload = json.dumps({'project_id': project_id, 'text': text, 'version': version,
                          'delivery_id': delivery_id}).encode()
    request = urllib.request.Request(base_url.rstrip('/') + '/service/report-delivery', data=payload,
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None  # Never forward a credential to a redirected host.
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=timeout) as response:
            result = json.load(response)
    except urllib.error.HTTPError as e:
        raise RuntimeError('report delivery HTTP ' + str(e.code)) from None
    except urllib.error.URLError:
        raise RuntimeError('report delivery network failure; retry the same delivery id') from None
    if not isinstance(result, dict) or result.get('ok') is not True or type(result.get('version')) is not int:
        raise RuntimeError('report delivery not confirmed')
    return result
