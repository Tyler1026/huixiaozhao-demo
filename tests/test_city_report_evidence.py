import base64
import hashlib
import io
import json
import unittest
import zipfile
from unittest.mock import patch

from backend.city_report_evidence import load_city_package, package_research
from backend.topic_reports import TopicReportError, evidence_catalog, build_report
from backend.topic_report_route import serve_topic_report
from backend.topic_chain_route import serve_topic_chain
from backend.topic_chain import build_chain, chain_source_catalog
from backend.city_chain_supplement import supplement_city_chain
from test_topic_report_pipeline import Handler


def document(city='随州市'):
    return {'city':city,'synthetic':False,'stages':{'06_supply_chain_gaps.md':{'evidence':[
        {'url':'https://www.suizhou.gov.cn/example','title':'随州市产业原文',
         'retrieval':'exa_fulltext','retrieved_at':'2026-10-23T00:00:00Z',
         'excerpt':'随州市专汽产业建设专用车供应链数据库，汇聚产品质量与企业信用信息，为企业提供供应链协同服务。'},
        {'url':'https://www.suizhou.gov.cn/mushroom','title':'随州市香菇原文',
         'retrieval':'exa_fulltext','retrieved_at':'2026-10-23T00:00:00Z',
         'excerpt':'随州市香菇产业现有环节包括：菌种研发、菌棒生产、香菇加工。培养基料的具体供需规模尚需另行核实。'}]}}}


def fixture():
    data=io.BytesIO()
    with zipfile.ZipFile(data,'w') as archive:
        archive.writestr('evidence.json',json.dumps(document(),ensure_ascii=False))
    payload=data.getvalue()
    context={'projectKey':'p','workspaceId':'p','reportRequestId':'r1',
             'city':'随州','topic':'专用车供应链数据平台补链'}
    state={'PROJECTS':{'p':{'city':'随州','reportRequestId':'r1',
        'baseReportVersion':{'requestId':'r1'},'reportFiles':[{'kind':'research',
        'sha256':hashlib.sha256(payload).hexdigest(),'b64':base64.b64encode(payload).decode()}]}}}
    return context,state


class CityReportEvidenceTests(unittest.TestCase):
    def test_online_supplement_preserves_city_originals_and_rejects_bad_evidence(self):
        context,state=fixture();base=load_city_package(context,state)
        data=document()
        data['stages']['06_supply_chain_gaps.md']['evidence'][0]['url']='https://www.suizhou.gov.cn/new'
        extra=package_research(data,context['city'],context['topic'],'online',mode='chain')
        merged=supplement_city_chain(base,extra,context)
        self.assertEqual(merged['onlineSupplement']['added'],1)
        self.assertTrue(set(base['sources'])<=set(merged['sources']))
        self.assertEqual(len(base['sources']),1)
        bad=json.loads(json.dumps(extra))
        next(iter(bad['sources'].values()))['fulltext']='corrupted original'
        self.assertEqual(supplement_city_chain(base,bad,context)['onlineSupplement']['added'],0)
        extra['city']='其他市'
        self.assertEqual(supplement_city_chain(base,extra,context)['onlineSupplement']['status'],'scope_mismatch')

    def test_online_unavailable_keeps_usable_package(self):
        context,state=fixture();base=load_city_package(context,state)
        merged=supplement_city_chain(base,dict(context,status='unavailable',evidence=[],sources={}),context)
        self.assertEqual(merged['sources'],base['sources'])
        self.assertEqual(merged['evidence'],base['evidence'])

    def test_multi_city_same_pipeline_and_cross_city_delivery_refused(self):
        for city in ('随州市','武汉市','成都市'):
            data=document(city)
            for stage in data['stages'].values():
                for row in stage['evidence']:
                    row['excerpt']=row['excerpt'].replace('随州市',city)
            for topic in ('专用车供应链数据平台补链','香菇菌种与基料供应补链'):
                out=package_research(data,city,topic,'r1',mode='chain')
                context={'city':city,'topic':topic}
                self.assertTrue(chain_source_catalog(out,context))
                graph=build_chain(context,out,lambda *args:{})
                self.assertTrue(any(group['nodes'] for group in graph['chain']) or graph['unclassified'])
                self.assertTrue(all(row['city']==city for row in out['evidence']))
            with self.assertRaises(TopicReportError):
                package_research(data,'其他市','专用车','r1',mode='chain')

    def test_chain_uses_same_published_package_and_saves_before_completion(self):
        from test_topic_chain_route import Handler as ChainHandler
        context,state=fixture();topic=context['topic']
        state['PROJECTS']['p'].update(topic=topic,workspaceId='p')
        state['REPORTSTATE']={'p':{'topic':topic,'aiReportByTopic':{topic:'已生成的当前方向报告'}}}
        handler=ChainHandler(state);audits=[]
        with patch('backend.topic_chain_route.require_session',return_value=handler._principal), \
             patch('backend.public_research.enrich_public_research') as archive:
            serve_topic_chain(handler,dict(context,purpose='chain_map',mode='chain',stream=True),
                complete=lambda *args:{},audit=audits.append,package_loader=load_city_package,
                research=lambda *a,**k:dict(context,status='unavailable',evidence=[],sources={}))
        archive.assert_not_called()
        self.assertEqual(audits[-1]['outcome'],'completed')
        self.assertEqual(handler.writes,1)
        self.assertIn('chain.result',handler.wfile.getvalue().decode())
        self.assertIn('[DONE]',handler.wfile.getvalue().decode())

    def test_route_uses_city_package_without_public_search_or_global_archive(self):
        context,state=fixture()
        state['PROJECTS']['p']['topic']=context['topic']
        handler=Handler(state);audits=[]
        def complete(system,prompt,tokens):
            payload=json.loads(prompt)
            return {'basis':[payload['evidence'][0]['id']], 'chain':[],
                    'priorities':[],'companies':[],'questions':[]}
        with patch('backend.topic_report_route.require_session',return_value={'user':'local-test'}), \
             patch('backend.topic_report_route.scoped_sync_view',side_effect=lambda s,p:s), \
             patch('backend.public_research.enrich_public_research') as archive:
            serve_topic_report(handler,dict(context,mode='draft',stream=True),
                read_state=lambda:state,complete=complete,audit=audits.append,
                research=lambda *a,**k:self.fail('unscoped public search'),package_loader=load_city_package)
        archive.assert_not_called()
        self.assertEqual(audits[-1]['outcome'],'completed')
        self.assertIn('[DONE]',handler.wfile.getvalue().decode())

    def test_published_delivery_and_city_suffix_are_supported(self):
        context,state=fixture()
        out=load_city_package(context,state)
        self.assertTrue(evidence_catalog(out))
        self.assertEqual(len(out['sources']),1)
        self.assertFalse(out['automatic_research'])
        self.assertTrue(all(row['archived'] for row in out['evidence']))

    def test_both_industries_can_build_source_bound_draft(self):
        for topic in ('专用车供应链数据平台补链','香菇菌种与基料供应补链'):
            context,state=fixture();context['topic']=topic
            findings=load_city_package(context,state)
            ids=list(evidence_catalog(findings))
            report=build_report(context,findings,1,lambda *args:{'basis':ids[:1],
                'chain':[],'priorities':[],'companies':[],'questions':[]})
            self.assertTrue(report['text'])
            self.assertTrue(report['sources'])

    def test_other_city_synthetic_and_empty_topic_are_rejected(self):
        for city,synthetic,topic in [('武汉市',False,'专用车'),('随州市',True,'专用车'),
                                      ('随州市',False,'半导体芯片')]:
            data=document(city);data['synthetic']=synthetic
            with self.assertRaises(TopicReportError):
                package_research(data,'随州',topic,'r1')

    def test_checksum_missing_delivery_and_version_mismatch_are_rejected(self):
        for mutation in ('checksum','missing','version'):
            context,state=fixture();p=state['PROJECTS']['p']
            if mutation=='checksum':p['reportFiles'][0]['sha256']='0'*64
            elif mutation=='missing':p['reportFiles']=[]
            else:p['baseReportVersion']['requestId']='other'
            with self.assertRaises(TopicReportError):load_city_package(context,state)

    def test_package_background_is_labelled_and_search_snippet_excluded(self):
        data=document();rows=data['stages']['06_supply_chain_gaps.md']['evidence']
        rows[0]['excerpt']=rows[0]['excerpt'].replace('随州市','武汉市')
        rows[1]['retrieval']='snippet'
        result=package_research(data,'随州','专用车','r1')
        self.assertTrue(all(row['source_scope']=='industry_background' for row in result['evidence']))
        self.assertEqual(len(result['sources']),1)

    def test_empty_model_selection_recovers_fungi_lanes_from_originals(self):
        data=document()
        data['stages']['06_supply_chain_gaps.md']['evidence'][1]['excerpt']=(
            '随州市香菇产业已有菌种培育能力，开展菌棒生产及香菇种植，并形成香菇出口销售渠道。')
        topic='香菇菌种与基料供应补链'
        context={'city':'随州','topic':topic,'reportRequestId':'r1','_prefer_assessment':True}
        research=package_research(data,'随州',topic,'r1',mode='chain')
        graph=build_chain(context,research,lambda *args:{'nodes':[]})
        self.assertTrue(all(group['nodes'] for group in graph['chain']))
        for group in graph['chain']:
            for node in group['nodes']:
                self.assertTrue(any(node['name'] in row['quote'] for row in node['sources']))
