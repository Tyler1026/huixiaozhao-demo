"""Provider-specific payloads and pre-response DeepSeek fallback."""
import copy
import json
import urllib.request
import urllib.error


def openai_payload(payload):
    data=copy.deepcopy(payload)
    data.pop('thinking',None);data.pop('temperature',None)
    if 'messages' in data:
        if 'max_tokens' in data:data['max_completion_tokens']=data.pop('max_tokens')
        data['reasoning_effort']='low'
    else:
        data['reasoning']={'effort':'low'}
    return data


class PrimaryModelOpener:
    def __init__(self,opener,environ):
        self.opener,self.env=opener,environ
    def open(self,request,timeout=None):
        primary=json.loads(request.data)
        request.data=json.dumps(openai_payload(primary)).encode()
        try:
            return self.opener.open(request,timeout=timeout)
        except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError,OSError):
            key=self.env.get('DEEPSEEK_API_KEY','')
            if not key:raise
            payload=copy.deepcopy(primary)
            payload['model']=self.env.get('HXZ_FALLBACK_MODEL','deepseek-v4-flash')
            responses=request.full_url.endswith('/responses')
            url='https://api.deepseek.com/responses' if responses else 'https://api.deepseek.com/v1/chat/completions'
            if not responses:payload['thinking']={'type':'disabled'}
            fallback=urllib.request.Request(url,data=json.dumps(payload).encode(),method='POST',
                headers={'Content-Type':'application/json','Authorization':'Bearer '+key})
            return self.opener.open(fallback,timeout=timeout)
