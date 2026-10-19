"""Server-owned chain results, authorization and complete-input invalidation."""
import copy
import hashlib
import io
import json
import threading
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from backend.auth import AuthError
from backend.chain_identity import chain_input_identity, identity_json, identity_matches
from backend.topic_chain_route import serve_topic_chain
from backend.access_control import scoped_sync_view


def state():
    return {'PROJECTS': {'p': {'workspaceId': 'p', 'city': '闵行区', 'topic': '商业火箭',
                              'reportRequestId': 'r1', 'kb': [], 'baseReportVersion': 1}},
            'REPORTSTATE': {'p': {'topic': '商业火箭', 'aiReportByTopic': {'商业火箭': '现有报告原文'},
                                 'researchByTopic': {'商业火箭': {'sources': []}}}}}


def findings():
    quote = '闵行区计划推动商业火箭总装测试能力建设，具体项目完成时间仍需核查。'
    return {'status': 'ready', 'evidence': [{'id': 'tr_'+'1'*20, 'url': 'https://www.shanghai.gov.cn/a',
            'quote': quote, 'source_id': 'a', 'status': 'source'}],
            'sources': {'a': {'url': 'https://www.shanghai.gov.cn/a', 'fulltext': quote,
                             'fulltext_sha256': hashlib.sha256(quote.encode()).hexdigest()}},
            'queries': ['闵行区 商业火箭 产业链'], 'errors': []}


def diagram(*args):
    source = dict(findings()['evidence'][0])
    return {'status': 'partial', 'chain': [
        {'seg': '上游', 'nodes': []},
        {'seg': '中游', 'nodes': [{'name': '商业火箭总装测试', 'level': 'unknown',
                                'status': 'planned', 'sources': [source]}]},
        {'seg': '下游', 'nodes': []}], 'unclassified': [], 'sources': [source],
        'taxonomy': {'id': 'test', 'label': '行业分层'}, 'coverage': {'status': 'partial'}}


class Handler:
    def __init__(self, data):
        self.data = copy.deepcopy(data)
        self._scoped_state = copy.deepcopy(data)
        self._principal = {'user': 'local', 'scope': 'project', 'projectKeys': ['p']}
        self.headers = {}; self.wfile = io.BytesIO(); self.status = None
        self.writes = 0; self.write_ok = True
    def _account_config(self): return {}
    def send_response(self, code): self.status = code
    def send_header(self, *args): pass
    def end_headers(self): pass
    def cors(self): pass
    @contextmanager
    def _account_session(self):
        handler = self
        class Session:
            def read(self): return json.dumps(handler.data)
            def write(self, value):
                handler.writes += 1
                if handler.write_ok: handler.data = json.loads(value)
                return handler.write_ok
        yield Session()


class ChainIdentityTests(unittest.TestCase):
    def test_effective_revision_deletion_upload_and_report_change_identity(self):
        base = state(); identity = chain_input_identity(base, 'p', '商业火箭')
        mutations = [lambda s: s.update(KB_EDITS={'p': {'e': {'text': '新材料'}}}),
                     lambda s: s.update(KB_ITEM_TOMBS={'p': {'e': 1}}),
                     lambda s: s.update(UPLOAD_TOMBS={'p::a.pdf': 1}),
                     lambda s: s.update(KB_FILE_CHUNKS={'p': [{'text': '火箭材料'}]}),
                     lambda s: s['REPORTSTATE']['p']['aiReportByTopic'].update({'商业火箭': '已更新'})]
        for change in mutations:
            s = copy.deepcopy(base); change(s)
            self.assertFalse(identity_matches(identity_json(identity), chain_input_identity(s, 'p', '商业火箭')))

    def test_other_topic_graph_and_unrelated_workspace_do_not_invalidate(self):
        s = state(); initial = chain_input_identity(s, 'p', '商业火箭')
        s['PROJECTS']['p']['topic'] = '生物医药'
        s['REPORTSTATE']['p']['chainByTopic'] = {'其他': []}
        s['KB_EDITS'] = {'other': {'x': {'text': '别处'}}}
        self.assertEqual(initial, chain_input_identity(s, 'p', '商业火箭'))

    def test_upload_payload_is_excluded_but_receipt_and_extracted_text_are_not(self):
        s = state(); s['UPLOADS'] = {'p': [{'name': 'a.pdf', 'dataUrl': 'first', 'originalSha256': 'one'}]}
        first = chain_input_identity(s, 'p', '商业火箭')
        s['UPLOADS']['p'][0]['dataUrl'] = 'second'
        self.assertEqual(first, chain_input_identity(s, 'p', '商业火箭'))
        s['UPLOADS']['p'][0]['originalSha256'] = 'two'
        self.assertNotEqual(first, chain_input_identity(s, 'p', '商业火箭'))

    def test_scoped_read_preserves_identity_without_allowing_embedded_snapshots(self):
        s = state(); s['KB_EDITS'] = {'p': {'e': {'text': '火箭项目修订'}}}
        scoped = scoped_sync_view(s, {'scope': 'project', 'projectKeys': ['p']})
        identity = chain_input_identity(scoped, 'p', '商业火箭')
        s['REPORTSTATE']['p']['chainEvidenceByTopic'] = {'商业火箭': {'sourceIdentity': identity_json(identity)}}
        restored = scoped_sync_view(s, {'scope': 'project', 'projectKeys': ['p']})
        encoded = restored['REPORTSTATE']['p']['chainEvidenceByTopic']['商业火箭']['sourceIdentity']
        self.assertTrue(identity_matches(encoded, identity))


class ChainRouteTests(unittest.TestCase):
    def body(self, handler):
        return {'projectKey': 'p', 'topic': '商业火箭', 'reportRequestId': 'r1',
                'sourceIdentity': identity_json(chain_input_identity(handler._scoped_state, 'p', '商业火箭')),
                'purpose': 'chain_map', 'mode': 'chain', 'stream': True}
    def run_route(self, h, research=None, build=diagram, principal=None, body=None, assessment_builder=None, **options):
        audits = []
        with patch('backend.topic_chain_route.require_session', return_value=principal or h._principal):
            serve_topic_chain(h, body or self.body(h), complete=lambda *args: {}, audit=audits.append,
                              research=research or (lambda *args, **kwargs: findings()), build=build,
                              assessment_builder=assessment_builder, **options)
        return h.wfile.getvalue().decode(), audits

    def test_persisted_server_result_precedes_completion_and_uses_v2_contract(self):
        h = Handler(state()); text, audits = self.run_route(h)
        self.assertEqual(h.writes, 1)
        self.assertIn('chain.result', text); self.assertIn('[DONE]', text)
        rs = h.data['REPORTSTATE']['p']
        self.assertEqual(rs['chainStatusByTopic']['商业火箭'], 'partial')
        self.assertEqual(rs['chainEvidenceByTopic']['商业火箭']['contract'], 'source-bound-chain-v2')
        expected = diagram()['chain']
        expected[1]['nodes'][0]['facts'] = []
        self.assertEqual(rs['chainByTopic']['商业火箭'], expected)
        self.assertEqual(audits[-1]['persisted'], True)

    def test_long_research_sends_transport_heartbeat_without_fake_progress(self):
        h = Handler(state())
        received = threading.Event()
        class Stream(io.BytesIO):
            def write(self, value):
                result = super().write(value)
                if value == b': keep-alive\n\n':
                    received.set()
                return result
        h.wfile = Stream()
        def retrieve(*args, **kwargs):
            self.assertTrue(received.wait(1), 'stream must stay alive during a blocking provider call')
            return findings()
        text, _ = self.run_route(h, research=retrieve, heartbeat_seconds=0.005)
        self.assertIn(': keep-alive\n\n', text)
        self.assertLess(text.index(': keep-alive'), text.index('chain.result'))
        self.assertFalse(text.endswith(': keep-alive\n\n'))
        self.assertIn('[DONE]', text)

    def test_model_budget_keeps_completed_graph_and_marks_unfinished_evaluation(self):
        h = Handler(state())
        now, calls = [100.0], []
        def build(context, research, complete):
            complete('system', 'selection', 10)
            now[0] += 356
            return diagram()
        def assessment(context, research, result, complete):
            complete('system', 'late evaluation', 10)
            self.fail('a late model call must be stopped')
        with patch('backend.topic_chain_route.require_session', return_value=h._principal):
            serve_topic_chain(h, self.body(h), complete=lambda *args: calls.append(args) or {},
                audit=lambda row: None, research=lambda *args, **kwargs: findings(), build=build,
                assessment_builder=assessment, clock=lambda: now[0])
        self.assertEqual(len(calls), 1)
        text = h.wfile.getvalue().decode()
        self.assertIn('chain.result', text)
        meta = h.data['REPORTSTATE']['p']['chainEvidenceByTopic']['商业火箭']
        self.assertIn('chain_model_budget_exhausted', [row['code'] for row in meta['errors']])
        self.assertEqual(meta['assessment']['state'], 'unavailable')
        self.assertEqual(h.writes, 1)

    def test_slow_model_is_bounded_and_late_output_cannot_replace_saved_graph(self):
        from test_topic_chain import research as originals
        archive = originals(['闵行区计划建设商业火箭总装测试平台，具体实施条件尚待核实。'], topic='商业火箭')
        release, calls = threading.Event(), []
        def slow(*args):
            calls.append(args)
            release.wait(1)
            return {'nodes': [{'name': '迟到的虚构环节', 'evidence_ids': []}]}
        h = Handler(state())
        try:
            with patch('backend.topic_chain_route.require_session', return_value=h._principal), \
                 patch('backend.public_research.enrich_public_research', side_effect=lambda r,*a:r):
                serve_topic_chain(h, self.body(h), complete=slow, audit=lambda row: None,
                    research=lambda *args, **kwargs: copy.deepcopy(archive), model_timeout_seconds=0.005)
            self.assertEqual(len(calls), 1)
            self.assertIn('[DONE]', h.wfile.getvalue().decode())
            stored = h.data['REPORTSTATE']['p']
            self.assertNotIn('迟到的虚构环节', json.dumps(stored, ensure_ascii=False))
            codes = [row['code'] for row in stored['chainEvidenceByTopic']['商业火箭']['errors']]
            self.assertIn('chain_model_timeout', codes)
        finally:
            release.set()

    def test_supplemental_original_is_saved_even_without_a_strength_judgment(self):
        from test_topic_chain import research as originals, plan
        from backend.topic_chain import normalize_chain_plan
        first = originals(['商业火箭总装测试平台处于规划阶段，具体建设安排仍需要逐项核实。'], topic='商业火箭')
        second = originals(['商业火箭总装测试平台已经建成，尚未披露实际产量及生产企业。'], topic='商业火箭')
        def retrieve(*args, **kwargs):
            return copy.deepcopy(second if kwargs.get('node_targets') else first)
        def build(context, findings, complete):
            return normalize_chain_plan(plan(first, ['商业火箭总装测试']), first, context)
        h = Handler(state())
        with patch('backend.public_research.enrich_public_research', side_effect=lambda r,*a:r):
            text, _ = self.run_route(h, research=retrieve, build=build)
        self.assertIn('chain.result', text)
        rs = h.data['REPORTSTATE']['p']
        node = rs['chainByTopic']['商业火箭'][1]['nodes'][0]
        self.assertEqual(node['level'], 'unknown')
        self.assertEqual(node['status'], 'planned')
        self.assertEqual({f['statement'] for f in node['facts']},
                         {first['evidence'][0]['quote'], second['evidence'][0]['quote']})
        self.assertIn(second['evidence'][0]['id'],
                      [s['id'] for s in rs['chainEvidenceByTopic']['商业火箭']['sources']])

    def test_disabled_live_services_can_save_limited_verified_archive_graph(self):
        from test_topic_chain import research as originals
        archived = originals(['闵行区计划建设商业火箭总装测试平台，实施条件尚待进一步核实。'], topic='商业火箭')
        archived.update(status='unavailable', errors=[{'code': 'research_configuration'}])
        for row in list(archived['sources'].values()) + archived['evidence']:
            row['archived'] = True
        calls = []
        def unavailable(*args):
            calls.append(args)
            raise RuntimeError('provider secret must not escape')
        h = Handler(state())
        with patch('backend.topic_chain_route.require_session', return_value=h._principal), \
             patch('backend.public_research.enrich_public_research', side_effect=lambda r,*a:r):
            serve_topic_chain(h, self.body(h), complete=unavailable, audit=lambda row: None,
                              research=lambda *args, **kwargs: copy.deepcopy(archived))
        self.assertEqual(len(calls), 1)
        self.assertIn('[DONE]', h.wfile.getvalue().decode())
        stored = h.data['REPORTSTATE']['p']
        self.assertEqual(stored['chainStatusByTopic']['商业火箭'], 'partial')
        meta = stored['chainEvidenceByTopic']['商业火箭']
        self.assertEqual(meta['researchStatus'], 'unavailable')
        self.assertEqual(meta['generation']['mode'], 'source_only')
        self.assertEqual(meta['assessment']['level'], 'unknown')
        self.assertEqual(meta['edges'], [])
        self.assertIn('chain_model_selection_unavailable', [row['code'] for row in meta['errors']])
        self.assertNotIn('provider secret', json.dumps(meta))

    def test_source_only_retry_preserves_richer_graph_for_same_material_identity(self):
        h = Handler(state())
        report = h.data['REPORTSTATE']['p']
        report['chainByTopic'] = {'商业火箭': [{'seg': '中游', 'nodes': [
            {'name': '已有环节一'}, {'name': '已有环节二'}]}]}
        report['chainEvidenceByTopic'] = {'商业火箭': {
            'contract': 'source-bound-chain-v2', 'scope': 'current-topic-v2', 'topic': '商业火箭',
            'sourceIdentity': identity_json(chain_input_identity(h.data, 'p', '商业火箭'))}}
        old = copy.deepcopy(report)
        def limited(*args):
            result = diagram()
            result['generation'] = {'mode': 'source_only'}
            result['chain'][1]['nodes'][0]['id'] = 'chn_test'
            return result
        text, _ = self.run_route(h, build=limited)
        self.assertIn('chain_existing_result_preserved', text)
        self.assertNotIn('chain.result', text)
        self.assertEqual(h.writes, 0)
        self.assertEqual(h.data['REPORTSTATE']['p'], old)

    def test_source_only_retry_preserves_existing_completed_evaluation(self):
        h = Handler(state())
        report = h.data['REPORTSTATE']['p']
        report['chainByTopic'] = {'商业火箭': [{'seg': '中游', 'nodes': [
            {'name': '已有环节', 'assessment': {'judgment': {'level': 'strong'}}}]}]}
        report['chainEvidenceByTopic'] = {'商业火箭': {
            'contract': 'source-bound-chain-v2', 'scope': 'current-topic-v2', 'topic': '商业火箭',
            'sourceIdentity': identity_json(chain_input_identity(h.data, 'p', '商业火箭'))}}
        def limited(*args):
            result = dict(diagram(), generation={'mode': 'source_only'})
            result['chain'][1]['nodes'][0]['id'] = 'chn_test'
            return result
        text, _ = self.run_route(h, build=limited)
        self.assertIn('chain_existing_result_preserved', text)
        self.assertEqual(h.writes, 0)

    def test_source_only_retry_cannot_replace_same_count_with_different_nodes(self):
        h = Handler(state())
        report = h.data['REPORTSTATE']['p']
        report['chainByTopic'] = {'商业火箭': [{'seg': '中游', 'nodes': [
            {'id': 'chn_existing', 'name': '已有环节'}]}]}
        report['chainEvidenceByTopic'] = {'商业火箭': {
            'contract': 'source-bound-chain-v2', 'scope': 'current-topic-v2', 'topic': '商业火箭',
            'sourceIdentity': identity_json(chain_input_identity(h.data, 'p', '商业火箭'))}}
        before = copy.deepcopy(report)
        def limited(*args):
            result = dict(diagram(), generation={'mode': 'source_only'})
            result['chain'][1]['nodes'][0]['id'] = 'chn_different'
            return result
        text, _ = self.run_route(h, build=limited)
        self.assertIn('chain_existing_result_preserved', text)
        self.assertNotIn('chain.result', text)
        self.assertEqual(h.writes, 0)
        self.assertEqual(h.data['REPORTSTATE']['p'], before)

    def test_outdated_richer_graph_does_not_block_current_source_only_result(self):
        h = Handler(state())
        report = h.data['REPORTSTATE']['p']
        report['chainByTopic'] = {'商业火箭': [{'seg': '中游', 'nodes': [
            {'name': '旧版环节一'}, {'name': '旧版环节二'}]}]}
        report['chainEvidenceByTopic'] = {'商业火箭': {
            'contract': 'source-bound-chain-v2', 'scope': 'current-topic-v2', 'topic': '商业火箭',
            'sourceIdentity': '{}'}}
        def limited(*args):
            result = dict(diagram(), generation={'mode': 'source_only'})
            result['chain'][1]['nodes'][0]['id'] = 'chn_test'
            return result
        text, _ = self.run_route(h, build=limited)
        self.assertIn('chain.result', text)
        self.assertEqual(h.writes, 1)

    def test_supplement_exception_records_failure_without_discarding_graph(self):
        from test_topic_chain import research as originals, plan
        from backend.topic_chain import normalize_chain_plan
        first = originals(['商业火箭总装测试平台处于规划阶段，具体建设安排仍需要逐项核实。'], topic='商业火箭')
        def retrieve(*args, **kwargs):
            if kwargs.get('node_targets'):
                raise RuntimeError('unavailable provider')
            return copy.deepcopy(first)
        def build(context, findings, complete):
            return normalize_chain_plan(plan(first, ['商业火箭总装测试']), first, context)
        h = Handler(state())
        with patch('backend.public_research.enrich_public_research', side_effect=lambda r,*a:r):
            text, _ = self.run_route(h, research=retrieve, build=build)
        self.assertIn('chain.result', text)
        meta = h.data['REPORTSTATE']['p']['chainEvidenceByTopic']['商业火箭']
        self.assertEqual(meta['nodeResearch']['status'], 'unavailable')
        self.assertEqual(len(meta['nodeResearch']['batches']), 1)
        self.assertEqual(meta['nodeResearch']['errors'][0]['code'], 'node_research_failed')
        self.assertNotIn('unavailable provider', json.dumps(meta))

    def test_preflight_stale_identity_does_not_run_research(self):
        h = Handler(state()); body = self.body(h); body['sourceIdentity'] = '{}'
        def no_research(*args, **kwargs): self.fail('research must not run')
        text, _ = self.run_route(h, research=no_research, body=body)
        self.assertEqual(h.status, 409); self.assertNotIn('chain.result', text); self.assertEqual(h.writes, 0)

    def test_source_edit_during_research_prevents_commit_and_success(self):
        h = Handler(state())
        def changed(*args, **kwargs):
            h.data['KB_EDITS'] = {'p': {'e': {'text': '修改后的材料'}}}
            return findings()
        text, _ = self.run_route(h, research=changed)
        self.assertIn('evidence_changed', text); self.assertNotIn('chain.result', text)
        self.assertNotIn('[DONE]', text); self.assertEqual(h.writes, 0)

    def test_revoked_membership_prevents_commit(self):
        h = Handler(state()); text, _ = self.run_route(h, principal={'scope': 'project', 'projectKeys': ['elsewhere']})
        self.assertIn('workspace_forbidden', text); self.assertEqual(h.writes, 0)
        self.assertNotIn('chain.result', text)

    def test_storage_failure_never_emits_saved_result(self):
        h = Handler(state()); before = copy.deepcopy(h.data); h.write_ok = False
        text, _ = self.run_route(h)
        self.assertIn('storage_unavailable', text); self.assertNotIn('chain.result', text)
        self.assertEqual(h.data, before)

    def test_unavailable_research_keeps_existing_diagram(self):
        h = Handler(state()); h.data['REPORTSTATE']['p']['chainByTopic'] = {'商业火箭': ['old']}
        def fail(*args): raise AuthError(422, 'research_unavailable', '调研未完成')
        text, _ = self.run_route(h, build=fail)
        self.assertIn('research_unavailable', text); self.assertEqual(h.writes, 0)
        self.assertEqual(h.data['REPORTSTATE']['p']['chainByTopic']['商业火箭'], ['old'])

    def test_corrupted_archive_cannot_be_saved(self):
        h = Handler(state())
        def changed(*args, **kwargs):
            f = findings(); f['sources']['a']['fulltext'] = '完全不同的原文'
            return f
        text, _ = self.run_route(h, research=changed)
        self.assertIn('evidence_validation_failed', text); self.assertEqual(h.writes, 0)
        self.assertNotIn('chain.result', text)

    def test_assessment_and_its_additional_sources_are_saved_together(self):
        h = Handler(state())
        extra = findings()
        quote = '闵行区商业火箭产业链上下游协同机制有待加强，配套能力仍不足。'
        source = {'id': 'tr_'+'2'*20, 'source_id': 'b', 'url': 'https://www.shanghai.gov.cn/b',
                  'quote': quote, 'status': 'source'}
        extra['evidence'].append(source)
        extra['sources']['b'] = {'url': source['url'], 'fulltext': quote,
                                 'fulltext_sha256': hashlib.sha256(quote.encode()).hexdigest()}
        assessment = {'contract': 'chain-assessment-v1', 'state': 'ready',
                      'level': 'attention', 'dimensions': [], 'findings': [source]}
        def identified(*args):
            result = diagram(); result['chain'][1]['nodes'][0]['id'] = 'node-1'
            return result
        def evaluate(*args):
            return {'assessment': assessment, 'node_assessments': {'node-1': {'level': 'unknown'}},
                    'sources': [source]}
        text, audits = self.run_route(h, research=lambda *a, **k: extra, build=identified,
                                      assessment_builder=evaluate)
        self.assertIn('[DONE]', text)
        stored = h.data['REPORTSTATE']['p']
        self.assertEqual(stored['chainEvidenceByTopic']['商业火箭']['assessment'], assessment)
        self.assertEqual(len(stored['chainEvidenceByTopic']['商业火箭']['sources']), 2)
        self.assertEqual(stored['chainByTopic']['商业火箭'][1]['nodes'][0]['assessment']['level'], 'unknown')
        self.assertEqual(audits[-1]['assessment_level'], 'attention')

    def test_assessment_source_cannot_bypass_archive_validation(self):
        h = Handler(state())
        def forged(*args):
            source = dict(findings()['evidence'][0], url='https://example.org/forged')
            return {'assessment': {'level': 'weak'}, 'node_assessments': {}, 'sources': [source]}
        text, _ = self.run_route(h, assessment_builder=forged)
        self.assertIn('evidence_validation_failed', text)
        self.assertNotIn('chain.result', text)
        self.assertEqual(h.writes, 0)

    def test_failed_assessment_keeps_valid_diagram_without_rating_it_weak(self):
        h = Handler(state())
        def failed(*args):
            raise ValueError('provider failed')
        text, _ = self.run_route(h, assessment_builder=failed)
        self.assertIn('[DONE]', text)
        assessment = h.data['REPORTSTATE']['p']['chainEvidenceByTopic']['商业火箭']['assessment']
        self.assertEqual(assessment['state'], 'unavailable')
        self.assertEqual(assessment['level'], 'unknown')

    def test_material_change_during_assessment_prevents_saving_old_result(self):
        h = Handler(state())
        def changed(*args):
            h.data['KB_EDITS'] = {'p': {'x': {'text': '新的产业材料'}}}
            return {'assessment': {'level': 'unknown'}, 'node_assessments': {}, 'sources': []}
        text, _ = self.run_route(h, assessment_builder=changed)
        self.assertIn('evidence_changed', text)
        self.assertEqual(h.writes, 0)


if __name__ == '__main__': unittest.main()
