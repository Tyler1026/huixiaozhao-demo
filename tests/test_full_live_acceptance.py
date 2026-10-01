"""Live-protocol tests with a completely offline HTTP transport, NOT real research."""
import hashlib
import json
import re
import unittest
from report_service.providers import OpenAIResearchProvider
from report_service.full_provider import FullLiveProvider, FullProviderError
from report_service.full_contract import STAGES, get_stage, assemble, validate, SCORE_DIMENSIONS


class Response:
    def __init__(self, url, payload, status=200):
        self.url=url; self.status=status; self.body=json.dumps(payload, ensure_ascii=False).encode()
    def read(self, n=-1): return self.body if n < 0 else self.body[:n]
    def geturl(self): return self.url
    def close(self): pass


class StructuredTransport:
    def __init__(self): self.sources=[]; self.calls=[]
    def __call__(self, request, timeout):
        url=request.full_url; payload=json.loads(request.data); self.calls.append((url,payload))
        if url.endswith('/search'):
            digest=hashlib.sha256(payload['query'].encode()).hexdigest()[:12]
            results=[]
            for i in range(8):
                source=f'https://stats.gov.cn/fixture/{digest}/{i}'
                results.append({'url':source,'title':'OFFLINE FIXTURE','text':'OFFLINE FIXTURE '+ ' '.join(f'测试企业{n}' for n in range(25))+' 经济政策扩产资料；不是事实。','publishedDate':'2026-09-01'})
                self.sources.append(source)
            return Response(url, {'results':results})
        text=payload['messages'][-1]['content']
        stage=re.search(r'当前阶段：([^\n]+)',text).group(1)
        part=re.search(r'当前子章节：([^\n]+)',text).group(1)
        refs=list(dict.fromkeys(self.sources))[-8:]
        data={'text':'\n'.join(f'OFFLINE FIXTURE {stage}/{part} 分析条目{i}，不是实际研究。' for i in range(100))+'\n'+'\n'.join(refs)}
        if stage.startswith('enterprises'):
            # Small entity batches exercise real parsing, accumulation and evidence references.
            suffix=re.search(r'(\d+)$',part); batch=int(suffix.group(1))-1 if suffix else 0
            if part.startswith('候选池'):
                data['candidates']=[self.company(n,refs[n%len(refs)]) for n in range(batch*5,min(batch*5+5,25))]
            if part.startswith('扩产信号'):
                data['selected']=[self.company(n,refs[n%len(refs)]) for n in range(batch*5,min(batch*5+5,15))]
        elif stage=='fact_check':
            count,category=(5,'economic') if part=='经济关键数字' else ((3,'policy') if part=='政策金额' else (9,'high_star'))
            data['checks']=[{'claim':f'{category}离线测试{i}','source':refs[i%8],'cross_source':refs[(i+1)%8],'year':'2026','verdict':'待核实','category':category,'direction':f'dir{i//3+1}' if category=='high_star' else None} for i in range(count)]
        elif stage=='scoring':
            data['scores']=[{'name':f'测试企业{i}','direction':'dir1','dimensions':{d: (10 if d!='risk' else i%10) for d in SCORE_DIMENSIONS}} for i in range(15)]
        return Response(url, {'choices':[{'finish_reason':'stop','message':{'content':json.dumps(data,ensure_ascii=False)}}]})
    @staticmethod
    def company(n,url):
        return {'name':f'测试企业{n}','url':url,'evidence_ref':url,'landing_status':'待核实','segment':'离线测试环节','reason':'测试理由','expansion_evidence':'待核实','expansion_date':'2026-09-01','rationale':'测试匹配','uncertainty':'OFFLINE FIXTURE'}


def provider(transport):
    return FullLiveProvider(OpenAIResearchProvider(model_url='https://model.test-provider.cn/chat',api_key='not-real',model_name='test',search_provider='exa',search_url='https://api.exa.ai/search',search_key='not-real',enabled=True,search_count=8,transport=transport))


class LiveProtocolAcceptance(unittest.TestCase):
    def test_small_batches_can_assemble_complete_enterprise_contract(self):
        router=StructuredTransport(); p=provider(router); parts=[]; prior={}
        for part in get_stage('enterprises_1')['parts']:
            parts.append(p.run_part('enterprises_1',part,{'city':'测试城'},prior))
            prior['enterprises_1']=assemble('enterprises_1',parts)
        out=assemble('enterprises_1',parts)
        self.assertEqual(validate('enterprises_1',out['text'],out['metadata']),[])
        self.assertGreaterEqual(len(out['metadata']['candidates']),25)
        self.assertGreaterEqual(len(out['metadata']['selected']),15)

    def test_independent_check_parts_are_not_empty_metadata(self):
        router=StructuredTransport(); p=provider(router); parts=[]
        for part in get_stage('fact_check')['parts']:
            parts.append(p.run_part('fact_check',part,{'city':'测试城'},{}))
        out=assemble('fact_check',parts)
        self.assertEqual(validate('fact_check',out['text'],out['metadata']),[])
        self.assertEqual(len(out['metadata']['checks']),17)

    def test_full_dependency_text_is_not_truncated_at_six_thousand(self):
        p=provider(StructuredTransport())
        text='真实结构长度测试-'*1500+'TAIL-MUST-REMAIN'
        rendered=p._render_prior({'industry':{'text':text,'metadata':{}}},'enterprises_1')
        self.assertIn('TAIL-MUST-REMAIN',rendered)

    def test_model_scores_are_recomputed_with_inverted_risk(self):
        p=provider(StructuredTransport())
        out=p.run_part('scoring',get_stage('scoring')['parts'][0],{'city':'测试城'}, {})
        scores=out['metadata']['scores']
        self.assertEqual(scores[0]['weighted_score'],10)
        self.assertGreater(scores[0]['weighted_score'],scores[-1]['weighted_score'])

    def test_auth_errors_are_permanent_and_sanitized(self):
        class Unauthorized:
            def __call__(self,req,timeout): return Response(req.full_url,{'error':'not-real secret'},401)
        with self.assertRaises(FullProviderError) as caught:
            provider(Unauthorized()).run_part('economy','经济总量',{'city':'测试城'},None)
        self.assertEqual(caught.exception.failure_code,'configuration')
        self.assertNotIn('secret',str(caught.exception))


if __name__=='__main__': unittest.main()
