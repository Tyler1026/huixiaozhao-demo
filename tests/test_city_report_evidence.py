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
from test_topic_report_pipeline import Handler


def document(city='随州市'):
    return {'city':city,'synthetic':False,'stages':{'06_supply_chain_gaps.md':{'evidence':[
        {'url':'https://www.suizhou.gov.cn/example','title':'随州市产业原文',
         'retrieval':'exa_fulltext','retrieved_at':'2026-10-23T00:00:00Z',
         'excerpt':'随州市专汽产业建设专用车供应链数据库，汇聚产品质量与企业信用信息，为企业提供供应链协同服务。'},
        {'url':'https://www.suizhou.gov.cn/mushroom','title':'随州市香菇原文',
         'retrieval':'exa_fulltext','retrieved_at':'2026-10-23T00:00:00Z',
         'excerpt':'随州市香菇产业开展食用菌菌种研发和菌棒生产，培养基料的具体供需规模尚需另行核实。'}]}}}


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

    def test_foreign_source_and_search_snippet_are_not_evidence(self):
        data=document();rows=data['stages']['06_supply_chain_gaps.md']['evidence']
        rows[0]['excerpt']=rows[0]['excerpt'].replace('随州市','武汉市')
        rows[1]['retrieval']='snippet'
        with self.assertRaises(TopicReportError):package_research(data,'随州','专用车','r1')
