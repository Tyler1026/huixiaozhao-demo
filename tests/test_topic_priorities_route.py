"""A saved report can acquire reviewed directions without replacing its text."""
import copy
import hashlib
import io
import json
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from backend.auth import AuthError
from backend.chain_identity import chain_input_identity, identity_json
from backend.topic_priorities_route import serve_topic_priorities
from backend.sync_merge import _merge_report_state


TOPIC = '氢基能源与长时储能装备补链'
QUOTE = '某公司研制液流电池隔膜并完成中试验证，可与系统厂商开展接口适配。'


def state():
    return {'PROJECTS': {'p': {'workspaceId': 'p', 'city': '闵行区', 'topic': TOPIC, 'kb': []}},
            'REPORTSTATE': {'p': {'topic': TOPIC, 'phaseByTopic': {TOPIC: 2},
                'aiReportByTopic': {TOPIC: '保留的报告正文 [1]', '其他': '其他报告'},
                'researchByTopic': {TOPIC: {'topic': TOPIC, 'reportText': '保留的报告正文 [1]',
                    'sources': [{'id': 'S1', 'url': 'https://www.shanghai.gov.cn/old',
                                 'quote': '旧报告使用的原文，必须原样保留。', 'label': '1'}],
                    'analysis': {'contract': 'topic-report-analysis-v2', 'priorities': [],
                                 'composition': {'status': 'reviewed'}}}}}}}


def findings():
    url = 'https://www.shanghai.gov.cn/new'
    return {'city': '闵行区', 'topic': TOPIC, 'status': 'ready',
            'evidence': [{'id': 'S1', 'source_id': 'a', 'url': url, 'quote': QUOTE, 'status': 'source'}],
            'sources': {'a': {'url': url, 'fulltext': QUOTE,
                             'fulltext_sha256': hashlib.sha256(QUOTE.encode()).hexdigest()}},
            'queries': ['公开研究'], 'errors': []}


def plan(*args, **kwargs):
    return {'plan': {'analytical_priorities': [{'focus': '液流电池隔膜', 'scope': 'industry',
        'opportunity_type': 'validation_collaboration', 'comparison': '原文披露已完成中试验证',
        'reason': '可进行系统适配研究，不表示已存在采购需求', 'action': '联系系统厂商讨论接口验证',
        'evidence_ids': ['S1'], 'supply_ids': ['S1'], 'application_ids': ['S1'],
        'state': 'reviewed_inference'}]}, 'review_diagnostics': [],
        'selection_diagnostics': {}, 'direction_generation': {'status': 'supported'}}


class Handler:
    def __init__(self, data=None):
        self.data = copy.deepcopy(data or state())
        self._scoped_state = copy.deepcopy(self.data)
        self._principal = {'user': 'local', 'scope': 'project', 'projectKeys': ['p']}
        self.headers = {}; self.wfile = io.BytesIO(); self.status = None
        self.writes = 0; self.write_ok = True
    def _account_config(self): return {}
    def send_response(self, status): self.status = status
    def send_header(self, *args): pass
    def end_headers(self): pass
    def cors(self): pass
    @contextmanager
    def _account_session(self):
        owner = self
        class Session:
            def read(self): return json.dumps(owner.data)
            def write(self, value):
                owner.writes += 1
                if owner.write_ok: owner.data = json.loads(value)
                return owner.write_ok
        yield Session()


def body(handler):
    metadata = handler._scoped_state['REPORTSTATE']['p'].get('researchByTopic', {}).get(TOPIC)
    return {'projectKey': 'p', 'topic': TOPIC, 'purpose': 'report_priorities',
        'mode': 'research', 'stream': False,
        'sourceIdentity': identity_json(chain_input_identity(handler._scoped_state, 'p', TOPIC)),
        'reportMetadataIdentity': json.dumps(metadata, ensure_ascii=False)}


class PriorityRefreshTests(unittest.TestCase):
    def test_review_outage_is_not_reported_as_no_business_opportunity(self):
        handler=Handler();before=copy.deepcopy(handler.data)
        result,_=self.run_route(handler,build=lambda *a,**k:{'plan':{'analytical_priorities':[]},
            'review_diagnostics':[{'code':'review_unavailable'}]})
        self.assertEqual(handler.status,422)
        self.assertEqual(result['error'],'direction_generation_incomplete')
        self.assertEqual(handler.writes,0)
        self.assertEqual(handler.data,before)

    def run_route(self, handler, *, request=None, build=plan, research=None, **options):
        audit = []
        with patch('backend.topic_priorities_route.require_session', return_value=handler._principal):
            serve_topic_priorities(handler, request or body(handler), complete=lambda *args: {},
                audit=audit.append, research=research or (lambda *args, **kwargs: findings()),
                build=build, enrich=lambda result, *args: result, **options)
        return json.loads(handler.wfile.getvalue()), audit

    def test_only_directions_change_and_original_citations_survive_id_collisions(self):
        handler = Handler(); before = copy.deepcopy(handler.data)
        result, audit = self.run_route(handler)
        self.assertEqual(handler.status, 200); self.assertTrue(result['updated'])
        self.assertEqual(handler.writes, 1)
        old = before['REPORTSTATE']['p']; new = handler.data['REPORTSTATE']['p']
        self.assertEqual(new['aiReportByTopic'], old['aiReportByTopic'])
        self.assertEqual(new['phaseByTopic'], old['phaseByTopic'])
        saved = new['researchByTopic'][TOPIC]
        self.assertEqual(saved['reportText'], old['aiReportByTopic'][TOPIC])
        self.assertEqual(saved['analysis']['composition'], {'status': 'reviewed'})
        self.assertEqual(saved['sources'][0], old['researchByTopic'][TOPIC]['sources'][0])
        row = saved['analysis']['priorities'][0]
        self.assertNotEqual(row['evidence_ids'], ['S1'])
        self.assertEqual(row['application_ids'], row['evidence_ids'])
        self.assertEqual(saved['sources'][1]['id'], row['evidence_ids'][0])
        self.assertEqual(saved['sources'][1]['quote'], QUOTE)
        self.assertEqual(audit[-1]['outcome'], 'updated')

    def test_empty_review_does_not_overwrite_a_previous_direction(self):
        handler = Handler(); before = copy.deepcopy(handler.data)
        result, _ = self.run_route(handler, build=lambda *a, **k: {'plan': {'analytical_priorities': []}})
        self.assertFalse(result['updated']); self.assertEqual(handler.writes, 0)
        self.assertEqual(handler.data, before)
        self.assertIn('明确需求', result['message'])

    def test_repeated_refresh_reuses_the_same_colliding_source(self):
        handler = Handler(); self.run_route(handler)
        first = copy.deepcopy(handler.data['REPORTSTATE']['p']['researchByTopic'][TOPIC])
        handler._scoped_state = copy.deepcopy(handler.data)
        handler.wfile = io.BytesIO()
        self.run_route(handler)
        second = handler.data['REPORTSTATE']['p']['researchByTopic'][TOPIC]
        self.assertEqual(second['sources'], first['sources'])
        self.assertEqual(second['analysis']['priorities'], first['analysis']['priorities'])

    def test_legacy_report_without_research_can_acquire_scoped_metadata(self):
        handler = Handler(); del handler.data['REPORTSTATE']['p']['researchByTopic']
        handler._scoped_state = copy.deepcopy(handler.data)
        result, _ = self.run_route(handler)
        self.assertTrue(result['updated'])
        self.assertEqual(result['reportResearch']['topic'], TOPIC)
        self.assertEqual(result['reportResearch']['reportText'], '保留的报告正文 [1]')

    def test_source_hash_mismatch_is_rejected_before_model(self):
        broken = findings(); broken['sources']['a']['fulltext_sha256'] = 'wrong'
        called = []
        handler = Handler()
        result, _ = self.run_route(handler, research=lambda *a, **k: broken,
                                  build=lambda *a, **k: called.append(True))
        self.assertEqual(handler.status, 422); self.assertEqual(called, [])
        self.assertEqual(handler.writes, 0)

    def test_changed_report_materials_metadata_or_access_cannot_save_stale_result(self):
        for kind in ('text', 'metadata', 'materials', 'access'):
            with self.subTest(kind=kind):
                handler = Handler()
                def changed(*args, **kwargs):
                    if kind == 'text': handler.data['REPORTSTATE']['p']['aiReportByTopic'][TOPIC] = '新正文'
                    if kind == 'metadata': handler.data['REPORTSTATE']['p']['researchByTopic'][TOPIC]['sources'] = []
                    if kind == 'materials': handler.data['PROJECTS']['p']['kb'] = [{'text': '修改材料'}]
                    if kind == 'access': handler._principal['projectKeys'] = []
                    return plan()
                result, _ = self.run_route(handler, build=changed)
                self.assertIn(handler.status, (403, 409)); self.assertFalse(result['ok'])
                self.assertEqual(handler.writes, 0)

    def test_submitted_demand_is_an_immutable_source_snapshot(self):
        handler = Handler(); handler.data['PROJECTS']['p']['isDemand'] = True
        handler._scoped_state = copy.deepcopy(handler.data)
        result, _ = self.run_route(handler)
        self.assertEqual(handler.status, 409); self.assertEqual(result['error'], 'submitted_demand')
        self.assertEqual(handler.writes, 0)

    def test_storage_failure_is_not_acknowledged_as_success(self):
        handler = Handler(); handler.write_ok = False; before = copy.deepcopy(handler.data)
        result, _ = self.run_route(handler)
        self.assertEqual(handler.status, 503); self.assertFalse(result['ok'])
        self.assertEqual(handler.data, before)

    def test_wrong_metadata_identity_stops_before_research(self):
        handler = Handler(); request = body(handler); request['reportMetadataIdentity'] = '{}'
        called = []
        result, _ = self.run_route(handler, request=request, research=lambda *a, **k: called.append(True))
        self.assertEqual(handler.status, 409); self.assertEqual(called, [])

    def test_provider_error_is_sanitized_and_report_is_untouched(self):
        handler = Handler(); before = copy.deepcopy(handler.data)
        def fail(*args, **kwargs): raise RuntimeError('private-api-key')
        result, _ = self.run_route(handler, build=fail)
        self.assertEqual(handler.status, 502); self.assertNotIn('private-api-key', json.dumps(result))
        self.assertEqual(handler.data, before)

    def test_stale_client_sync_does_not_remove_authoritative_direction_refresh(self):
        handler = Handler(); old_client = copy.deepcopy(handler.data['REPORTSTATE']['p'])
        self.run_route(handler)
        current = handler.data['REPORTSTATE']['p']
        merged = _merge_report_state(current, old_client)
        self.assertEqual(merged['researchByTopic'][TOPIC], current['researchByTopic'][TOPIC])
        self.assertEqual(len(merged['researchByTopic'][TOPIC]['analysis']['priorities']), 1)

    def test_newer_full_report_does_not_inherit_directions_from_previous_text(self):
        handler = Handler(); self.run_route(handler)
        current = handler.data['REPORTSTATE']['p']; incoming = copy.deepcopy(current)
        incoming['tsByTopic'] = {TOPIC: 100}
        incoming['aiReportByTopic'][TOPIC] = '独立新报告'
        incoming['researchByTopic'][TOPIC] = {'topic': TOPIC, 'reportText': '独立新报告',
                                             'sources': [], 'analysis': {'priorities': []}}
        merged = _merge_report_state(current, incoming)
        self.assertEqual(merged['researchByTopic'][TOPIC]['analysis']['priorities'], [])
        self.assertNotIn('directionRefresh', merged['researchByTopic'][TOPIC])


if __name__ == '__main__': unittest.main()
