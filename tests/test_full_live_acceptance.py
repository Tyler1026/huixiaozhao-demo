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
                results.append({'url':source,'title':'OFFLINE FIXTURE','text':'OFFLINE FIXTURE '+ ' '.join(f'测试企业{n}' for n in range(25))+' 经济政策扩产资料；不是事实。\n'+
                                '\n'.join(self.signal_quote(n) for n in range(5)), 'publishedDate':'2026-09-01'})
                self.sources.append(source)
            return Response(url, {'results':results})
        text=payload['messages'][-1]['content']
        stage=re.search(r'当前阶段：([^\n]+)',text).group(1)
        part=re.search(r'当前子章节：([^\n]+)',text).group(1)
        refs=list(dict.fromkeys(self.sources))[-8:]
        if stage=='fact_check':
            # Targeted company searches retain only their accepted sources;
            # the offline model must cite URLs actually present in its prompt.
            refs=re.findall(r'^\[\d+\].*? — (https://[^\s（]+)（发布日期：',text,re.MULTILINE)
        data={'text':'\n'.join(f'OFFLINE FIXTURE {stage}/{part} 分析条目{i}，不是实际研究。' for i in range(100))+'\n'+'\n'.join(refs)}
        if stage.startswith('enterprises'):
            # Small entity batches exercise real parsing, accumulation and evidence references.
            suffix=re.search(r'(\d+)$',part); batch=int(suffix.group(1))-1 if suffix else 0
            if part.startswith('候选池'):
                data['candidates']=[self.company(n,refs[n%len(refs)]) for n in range(batch*5,min(batch*5+5,25))]
            if part.startswith('扩产信号'):
                data['selected']=[self.company(n,refs[n%len(refs)]) for n in range(batch*5,min(batch*5+5,15))]
        elif stage=='fact_check':
            count,category=(9,'economic') if part=='经济关键数字' else ((3,'policy') if part=='政策金额' else (5,'high_star'))
            data['checks']=[{'claim':self.signal_quote(i) if category=='high_star' else f'{category}离线测试{i}',
                            'source':refs[i%8],'cross_source':refs[(i+1)%8],'year':'2026','verdict':'待核实',
                            'category':category,'direction':f'dir{i%3+1}' if category=='high_star' else None,
                            **({'company_name':f'测试企业{i}','source_quote':self.signal_quote(i),
                                'cross_source_quote':self.signal_quote(i)} if category=='high_star' else {})}
                           for i in range(count)]
        elif stage=='scoring':
            prefix='本次评分唯一身份名单（name和direction须逐项精确保留）：'
            targets=json.loads(next(line[len(prefix):] for line in text.splitlines() if line.startswith(prefix)))
            batch=re.search(r'本次内部评分批：(\d+)/',text).group(1)
            data['text']='\n'.join(f'OFFLINE评分批{batch}独立依据与风险{i}' for i in range(25))
            data['scores']=[{'name':target['name'],'direction':target['direction'],
                            'dimensions':{d: (10 if d!='risk' else int(target['name'].removeprefix('测试企业'))%10)
                                          for d in SCORE_DIMENSIONS}} for target in targets]
        return Response(url, {'choices':[{'finish_reason':'stop','message':{'content':json.dumps(data,ensure_ascii=False)}}]})
    @staticmethod
    def company(n,url):
        return {'name':f'测试企业{n}','url':url,'evidence_ref':url,'landing_status':'待核实','segment':'离线测试环节','reason':'测试理由','expansion_evidence':'待核实','expansion_date':'2026-09-01','rationale':'测试匹配','uncertainty':'OFFLINE FIXTURE'}
    @staticmethod
    def signal_quote(n):
        return f'测试企业{n}在2026年披露OFFLINE扩产信号{n}；仅供协议测试，不是实际事实。'


def provider(transport):
    return FullLiveProvider(OpenAIResearchProvider(model_url='https://model.test-provider.cn/chat',api_key='not-real',model_name='test',search_provider='exa',search_url='https://api.exa.ai/search',search_key='not-real',enabled=True,search_count=8,transport=transport))


class DeepStructuredTransport(StructuredTransport):
    def __call__(self, request, timeout):
        response = super().__call__(request, timeout)
        if request.full_url.endswith('/search'):
            return response
        user = json.loads(request.data)['messages'][-1]['content']
        if '当前阶段：enterprises_1\n' in user and '当前子章节：扩产信号' in user:
            if '5批共至少25家' not in user:
                raise AssertionError('deep research instruction was downgraded')
            part = re.search(r'当前子章节：([^\n]+)', user).group(1)
            start, end = {'扩产信号': (0, 5), '扩产信号2': (5, 10), '扩产信号3': (10, 15),
                          '扩产信号4': (15, 20), '扩产信号5': (20, 25)}[part]
            refs = list(dict.fromkeys(self.sources))[-8:]
            payload = json.loads(response.body)
            body = json.loads(payload['choices'][0]['message']['content'])
            body['selected'] = [self.company(n, refs[n % len(refs)]) for n in range(start, end)]
            payload['choices'][0]['message']['content'] = json.dumps(body, ensure_ascii=False)
            return Response(request.full_url, payload)
        return response


class LiveProtocolAcceptance(unittest.TestCase):
    def test_deep_batches_retrieve_all_twenty_five_companies_and_pass_original_floor(self):
        router = DeepStructuredTransport(); p = provider(router); parts = []
        refs = [f'https://stats.gov.cn/offline-direction/{i}' for i in range(3)]
        prior = {'industry': {'text': 'OFFLINE FIXTURE: not real research', 'metadata': {
            'directions': [{'id':f'dir{i+1}', 'name':f'测试产业{i+1}', 'evidence_ref':ref} for i, ref in enumerate(refs)],
            'evidence': [{'url':ref, 'excerpt':'OFFLINE direction fixture'} for ref in refs]}}}
        for part in get_stage('enterprises_1', mode='deep')['parts']:
            before = len(router.calls)
            parts.append(p.run_part('enterprises_1', part, {'city':'测试城', 'mode':'deep'}, prior))
            if part.startswith('扩产信号'):
                queries = [payload['query'] for url, payload in router.calls[before:] if url.endswith('/search')]
                expected = {'扩产信号': range(0,5), '扩产信号2': range(5,10), '扩产信号3': range(10,15),
                            '扩产信号4': range(15,20), '扩产信号5': range(20,25)}[part]
                self.assertEqual([q.split()[0] for q in queries], [f'测试企业{n}' for n in expected])
            prior['enterprises_1'] = assemble('enterprises_1', parts)
        output = prior['enterprises_1']
        self.assertEqual(len(output['metadata']['selected']), 25)
        self.assertEqual(validate('enterprises_1', output['text'], output['metadata'], mode='deep'), [])

    def test_small_batches_can_assemble_complete_enterprise_contract(self):
        router=StructuredTransport(); p=provider(router); parts=[]
        direction_refs=[f'https://stats.gov.cn/offline-direction/{i}' for i in range(3)]
        prior={'industry': {'text':'OFFLINE FIXTURE: upstream directions already verified.', 'metadata': {
            'directions':[{'id':f'dir{i+1}','name':f'测试产业{i+1}','evidence_ref':ref} for i,ref in enumerate(direction_refs)],
            'evidence':[{'url':ref,'excerpt':'OFFLINE FIXTURE direction evidence'} for ref in direction_refs]}}}
        for part in get_stage('enterprises_1')['parts']:
            parts.append(p.run_part('enterprises_1',part,{'city':'测试城'},prior))
            prior['enterprises_1']=assemble('enterprises_1',parts)
        out=assemble('enterprises_1',parts)
        self.assertEqual(validate('enterprises_1',out['text'],out['metadata']),[])
        self.assertGreaterEqual(len(out['metadata']['candidates']),25)
        self.assertGreaterEqual(len(out['metadata']['selected']),15)

    def test_independent_check_parts_are_not_empty_metadata(self):
        router=StructuredTransport(); p=provider(router); parts=[]
        prior={f'enterprises_{direction}': {'text': f'OFFLINE方向{direction}已保存精选记录', 'metadata': {
            'selected': [{'name': f'测试企业{i}'} for i in range(5) if i%3+1==direction]}}
            for direction in (1,2,3)}
        for part in get_stage('fact_check')['parts']:
            result=p.run_part('fact_check',part,{'city':'测试城'},prior)
            parts.append(result)
            prior['fact_check']=assemble('fact_check',parts)
            category,minimum={'经济关键数字': ('economic',9),'政策金额': ('policy',3),
                              '五星企业信号': ('high_star',5)}[part]
            self.assertEqual(len(result['metadata']['checks']),minimum)
            self.assertTrue(all(check['category']==category for check in result['metadata']['checks']))
        out=assemble('fact_check',parts)
        self.assertEqual(validate('fact_check',out['text'],out['metadata']),[])
        self.assertEqual(len(out['metadata']['checks']),17)
        self.assertEqual({check['direction'] for check in out['metadata']['checks']
                          if check['category']=='high_star'}, {'dir1','dir2','dir3'})

    def test_full_dependency_text_is_not_truncated_at_six_thousand(self):
        p=provider(StructuredTransport())
        text='真实结构长度测试-'*1500+'TAIL-MUST-REMAIN'
        rendered=p._render_prior({'industry':{'text':text,'metadata':{}}},'enterprises_1')
        self.assertIn('TAIL-MUST-REMAIN',rendered)

    def test_model_scores_are_recomputed_with_inverted_risk(self):
        p=provider(StructuredTransport())
        prior={'enterprises_1': {'text':'OFFLINE saved selections', 'metadata': {
            'selected':[{'name':f'测试企业{i}'} for i in range(15)]}}}
        out=p.run_part('scoring',get_stage('scoring')['parts'][0],{'city':'测试城'}, prior)
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
