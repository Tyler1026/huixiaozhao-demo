import copy
import json
import tempfile
import unittest
from pathlib import Path
from test_full_live_acceptance import StructuredTransport, Response, provider
from report_service.full_contract import get_stage, assemble, validate
from report_service.full_provider import FullProviderError
from report_service.full_store import FullStore

NAMES=('商业航天','具身智能','脑机接口')


class DirectionTransport(StructuredTransport):
    def __call__(self,req,timeout):
        response=super().__call__(req,timeout)
        if req.full_url.endswith('/search'):return response
        payload=json.loads(response.body)
        body=json.loads(payload['choices'][0]['message']['content'])
        user=json.loads(req.data)['messages'][-1]['content']
        if '当前阶段：industry\n' in user:
            body['directions']=[{'id':f'dir{i+1}','name':name,'evidence_ref':self.sources[-8+i]} for i,name in enumerate(NAMES)]
        payload['choices'][0]['message']['content']=json.dumps(body,ensure_ascii=False)
        return Response(req.full_url,payload)


class DirectionFlowTests(unittest.TestCase):
    def industry(self):
        transport=DirectionTransport();p=provider(transport);parts=[];prior={}
        for part in get_stage('industry')['parts']:
            parts.append(p.run_part('industry',part,{'city':'闵行区'},prior))
            prior['industry']=assemble('industry',parts)
        return p,transport,parts,prior

    def test_structured_directions_survive_checkpoint_and_route_three_hunters(self):
        p,transport,parts,prior=self.industry()
        output=prior['industry']
        self.assertEqual([x['name'] for x in output['metadata'].get('directions',[])],list(NAMES))
        self.assertEqual(validate('industry',output['text'],output['metadata']),[])
        with tempfile.TemporaryDirectory() as d:
            s=FullStore(Path(d)/'db',stages=(get_stage('industry'),))
            r=s.create('org','上海市','闵行区','directions',False)
            for output in parts:
                job=s.claim(synthetic=False);self.assertTrue(s.finish_part(job['step_id'],job['token'],output))
            restored=FullStore(Path(d)/'db').parts(r['id'])
            prior={'industry':assemble('industry',restored['industry'])}
            for i,name in enumerate(NAMES,1):
                transport.calls.clear()
                p.run_part(f'enterprises_{i}','候选池',{'city':'闵行区'},prior)
                queries=[b['query'] for url,b in transport.calls if url.endswith('/search')]
                self.assertTrue(queries)
                self.assertTrue(all(name in q for q in queries),queries)
                self.assertTrue(all(not any(n in q for n in NAMES if n!=name) for q in queries),queries)

    def test_missing_directions_cannot_fall_back_to_generic_company_search(self):
        t=DirectionTransport()
        with self.assertRaises(FullProviderError):
            provider(t).run_part('enterprises_1','候选池',{'city':'闵行区'},{})
        self.assertEqual(t.calls,[])

    def test_duplicate_names_or_missing_direction_rejected_by_contract(self):
        _,_,_,prior=self.industry();out=prior['industry']
        self.assertIn('directions',out['metadata'])
        for kind in ('duplicate','missing'):
            meta=copy.deepcopy(out['metadata'])
            if kind=='duplicate':meta['directions'][1]['name']=meta['directions'][0]['name']
            else:meta['directions']=meta['directions'][:2]
            self.assertTrue(any('direction' in e.lower() for e in validate('industry',out['text'],meta)),kind)


if __name__=='__main__':unittest.main()
