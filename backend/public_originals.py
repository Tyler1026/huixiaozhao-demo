"""Bounded credential-free public HTML source reader for company discovery."""
import ipaddress
import socket
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit
from report_service.providers import validate_https_url
from report_service.openai_auxiliary import _OriginalText


def _public_destination(url):
    validate_https_url(url)
    parsed = urlsplit(url)
    if parsed.port not in (None,443):
        raise ValueError('unexpected_port')
    addresses = socket.getaddrinfo(parsed.hostname,443,type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(r[4][0]).is_global for r in addresses):
        raise ValueError('non_public_destination')


def fetch_public_originals(urls):
    class Redirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            _public_destination(newurl)
            return super().redirect_request(req,fp,code,msg,headers,newurl)
    def fetch(url):
        try:
            _public_destination(url)
            req=urllib.request.Request(url,headers={'User-Agent':'HuixiaozhaoSourceReader/1.0'})
            with urllib.request.build_opener(Redirect()).open(req,timeout=8) as response:
                if response.headers.get_content_type() not in ('text/html','text/plain'):
                    return None
                raw=response.read(1_000_001)
                if len(raw)>1_000_000:
                    return None
                charset=response.headers.get_content_charset()
                if not charset:
                    meta=re.search(br'charset\s*=\s*["\']?\s*([A-Za-z0-9_-]+)',raw[:16000],re.I)
                    charset=meta.group(1).decode('ascii') if meta else 'utf-8'
                if charset.lower() in ('gb2312','gbk'):
                    charset='gb18030'
                text=raw.decode(charset,errors='replace')
            parser=_OriginalText();parser.feed(text)
            original='\n'.join(p.strip() for p in ''.join(parser.parts).splitlines() if p.strip())
            if 40<=len(original)<=120000:
                return {'url':url,'text':original,'retrieval_provider':'public_original'}
        except Exception:
            pass
        return None
    with ThreadPoolExecutor(max_workers=4) as executor:
        return [row for row in executor.map(fetch,list(dict.fromkeys(urls))[:16]) if row]
