import copy
import io
import json
import os
import tempfile
import threading
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from backend.access_control import guard_sync
from backend.auth import AuthError
from backend.chain_identity import chain_input_identity, identity_json
from backend.industry_demands import (CONTRACT, create_industry_demand,
                                      handle_industry_demand, priority_key)
from backend.sync_transaction import file_session
from backend.evidence_grounding import (project_context, funnel_demand_anchors,
                                        funnel_request_text, ground_funnel, evidence_catalog,
                                        review_and_push)


PRINCIPAL = {'scope': 'project', 'projectKeys': ['p'], 'projKey': 'p', 'user': 'tester'}
FIELDS = ('focus', 'scope', 'comparison', 'reason', 'action', 'evidence_ids')


def state():
    topic = '生物医药'
    priorities = [{'focus': focus, 'scope': 'industry', 'comparison': '全国进口依赖，不能据此判断闵行缺失',
                   'reason': focus + '存在替代空间，需核实当地采购', 'action': '访谈需求方核实产品与采购条件',
                   'evidence_ids': ['s' + str(i)], 'state': 'reviewed_inference'}
                  for i, focus in enumerate(('生物制药滤器', '色谱填料'))]
    text = '完整报告原文，涵盖材料事实和两项分析建议。'
    sources = [{'id': 's' + str(i), 'quote': focus + '在全国市场存在进口依赖。',
                'url': 'https://example.org/' + str(i), 'title': focus + '市场披露'}
               for i, focus in enumerate(('生物制药滤器', '色谱填料'))]
    research = {'topic': topic, 'reportText': text, 'sources': sources,
                'analysis': {'contract': 'topic-report-analysis-v2', 'priorities': priorities}}
    return {'PROJECTS': {'p': {'id': 'p', 'workspaceId': 'p', 'city': '闵行区',
                               'org': '招商局', 'who': '负责人', 'topic': topic, 'kb': []},
                         'q': {'id': 'q', 'workspaceId': 'q', 'city': '闵行区', 'topic': topic}},
            'REPORTSTATE': {'p': {'topic': topic, 'phase': 2, 'text': text,
                                  'aiReportByTopic': {topic: text}, 'phaseByTopic': {topic: 2},
                                  'tsByTopic': {topic: 100}, 'researchByTopic': {topic: research}}},
            'DEMANDS': []}


def request(data, index=0):
    project = data['PROJECTS']['p']
    topic = project['topic']
    row = data['REPORTSTATE']['p']['researchByTopic'][topic]['analysis']['priorities'][index]
    return {'projectKey': 'p', 'topic': topic,
            'sourceIdentity': identity_json(chain_input_identity(data, 'p', topic)),
            'reportMetadataIdentity': identity_json(data['REPORTSTATE']['p']['researchByTopic'][topic]),
            'priority': {key: copy.deepcopy(row[key]) for key in FIELDS},
            'demand': {'title': row['focus'] + '企业招引',
                       'description': '寻找' + row['focus'] + '企业，先核验本地客户的适配需求。',
                       'conditions': '须核查实际交付记录；投资规模待洽谈'}}


class Handler:
    def __init__(self):
        self.headers = {}
        self.status = None
        self.wfile = io.BytesIO()
    def send_response(self, status): self.status = status
    def send_header(self, *args): pass
    def end_headers(self): pass
    def cors(self): pass
    def result(self): return json.loads(self.wfile.getvalue())


class IndustryDemandTests(unittest.TestCase):
    def assert_code(self, code, callback):
        with self.assertRaises(AuthError) as raised:
            callback()
        self.assertEqual(raised.exception.code, code)

    def test_two_priorities_produce_separate_specific_demands_and_exact_report_snapshots(self):
        data = state()
        first = create_industry_demand(request(data, 0), data, PRINCIPAL, now=1000)
        second = create_industry_demand(request(data, 1), data, PRINCIPAL, now=1001)
        self.assertNotEqual(first['projectKey'], second['projectKey'])
        self.assertEqual(len(data['DEMANDS']), 2)
        for index, result in enumerate((first, second)):
            source = data['REPORTSTATE']['p']['researchByTopic']['生物医药']['analysis']['priorities'][index]
            self.assertEqual(result['project']['topic'], '生物医药')
            self.assertEqual(result['project']['workspaceId'], 'p')
            self.assertEqual(result['project']['sourcePriorityKey'], priority_key(source))
            self.assertEqual(result['demand']['analysisTopic'], '生物医药')
            self.assertIn(source['focus'], result['demand']['topic'])
            self.assertEqual(result['project']['selectedPriority']['evidence_ids'], source['evidence_ids'])
            self.assertEqual(result['reportState']['text'], data['REPORTSTATE']['p']['text'])
            self.assertEqual(result['project']['demandSpec']['verificationStatus'], 'user_stated')
        first['project']['selectedPriority']['sources'][0]['quote'] = 'response edit'
        self.assertNotEqual(data['PROJECTS'][first['projectKey']]['selectedPriority']['sources'][0]['quote'], 'response edit')

    def test_same_city_another_workspace_is_forbidden(self):
        data = state(); body = request(data)
        body['projectKey'] = 'q'
        self.assert_code('workspace_forbidden', lambda: create_industry_demand(body, data, PRINCIPAL))
        self.assertEqual(len(data['DEMANDS']), 0)

    def test_ui_label_trim_and_ordered_id_dedup_are_accepted(self):
        data = state(); body = request(data)
        row = data['REPORTSTATE']['p']['researchByTopic']['生物医药']['analysis']['priorities'][0]
        row['focus'] = '  生物制药滤器  '; row['evidence_ids'] = ['s0', 's0']
        body['reportMetadataIdentity'] = identity_json(data['REPORTSTATE']['p']['researchByTopic']['生物医药'])
        result = create_industry_demand(body, data, PRINCIPAL)
        self.assertEqual(result['project']['selectedPriority']['focus'], '生物制药滤器')
        self.assertEqual(result['project']['selectedPriority']['evidence_ids'], ['s0'])

    def test_changed_report_or_material_rejects_stale_form(self):
        for mutate in (lambda s: s['REPORTSTATE']['p']['aiReportByTopic'].update({'生物医药': '更新报告'}),
                       lambda s: s['PROJECTS']['p']['kb'].append({'t': '新材料', 'known': ['新原文']})):
            data = state(); body = request(data); mutate(data)
            self.assert_code('stale_report', lambda: create_industry_demand(body, data, PRINCIPAL))
            self.assertEqual(len(data['DEMANDS']), 0)

    def test_tampered_priority_or_client_sources_rejected(self):
        data = state()
        for mutate, code in ((lambda b: b['priority'].update(focus='不存在的建议'), 'priority_not_found'),
                             (lambda b: b['priority'].update(reason='伪造当地已明确采购'), 'stale_report'),
                             (lambda b: b['priority'].update(evidence_ids=['s1']), 'stale_report'),
                             (lambda b: b['priority'].update(sources=[{'quote': '假来源'}]), 'invalid_priority')):
            body = request(data); mutate(body)
            self.assert_code(code, lambda: create_industry_demand(body, data, PRINCIPAL))
        self.assertEqual(len(data['DEMANDS']), 0)

    def test_missing_or_conflicting_source_cannot_be_submitted(self):
        for mutate in (lambda r: r.update(sources=[]),
                       lambda r: r['sources'].append(dict(r['sources'][0], quote='冲突原文')),
                       lambda r: r['sources'][0].update(url='javascript:alert(1)')):
            data = state(); body = request(data)
            mutate(data['REPORTSTATE']['p']['researchByTopic']['生物医药'])
            body['reportMetadataIdentity'] = identity_json(data['REPORTSTATE']['p']['researchByTopic']['生物医药'])
            self.assert_code('priority_not_found', lambda: create_industry_demand(body, data, PRINCIPAL))

    def test_phase_one_unreviewed_or_mismatched_report_cannot_be_submitted(self):
        for mutate, code in ((lambda r: r['phaseByTopic'].update({'生物医药': 1}), 'report_required'),
                             (lambda r: r['researchByTopic']['生物医药'].update(reportText='其他正文'), 'report_required'),
                             (lambda r: r['researchByTopic']['生物医药']['analysis']['priorities'][0].update(state='pending_review'), 'priority_not_found')):
            data = state(); body = request(data); mutate(data['REPORTSTATE']['p'])
            body['reportMetadataIdentity'] = identity_json(data['REPORTSTATE']['p']['researchByTopic']['生物医药'])
            self.assert_code(code, lambda: create_industry_demand(body, data, PRINCIPAL))

    def test_missing_metadata_or_changed_source_rejects_stale_form(self):
        for mutate in (lambda s, b: b.pop('reportMetadataIdentity'),
                       lambda s, b: s['REPORTSTATE']['p']['researchByTopic']['生物医药']['sources'][0].update(quote='已修改的原文'),
                       lambda s, b: s['REPORTSTATE']['p']['researchByTopic']['生物医药']['sources'][0].update(url='https://example.org/replacement')):
            data = state(); body = request(data); mutate(data, body)
            self.assert_code('stale_report', lambda: create_industry_demand(body, data, PRINCIPAL))

    def test_retry_and_later_report_return_existing_without_overwriting(self):
        data = state(); body = request(data)
        first = create_industry_demand(body, data, PRINCIPAL, now=1000)
        body['demand']['title'] = '不能静默覆盖原需求'
        second = create_industry_demand(body, data, PRINCIPAL, now=1001)
        self.assertFalse(second['created']); self.assertEqual(first['projectKey'], second['projectKey'])
        self.assertEqual(first['project'], second['project'])
        report = data['REPORTSTATE']['p']; report['aiReportByTopic']['生物医药'] = '新版本完整报告'
        report['researchByTopic']['生物医药']['reportText'] = '新版本完整报告'
        latest = create_industry_demand(request(data), data, PRINCIPAL)
        self.assertFalse(latest['created'])
        self.assertEqual(latest['reportState']['text'], first['reportState']['text'])

    def test_demand_child_cannot_submit_another_child(self):
        data = state(); result = create_industry_demand(request(data), data, PRINCIPAL)
        body = request(data); body['projectKey'] = result['projectKey']
        self.assert_code('parent_workspace_required', lambda: create_industry_demand(body, data, PRINCIPAL))

    def test_user_input_validation_and_no_source_claim_upgrade(self):
        data = state(); body = request(data)
        for field, value in (('title', ''), ('description', ' '), ('conditions', 'x' * 2001)):
            invalid = copy.deepcopy(body); invalid['demand'][field] = value
            self.assert_code('invalid_demand', lambda: create_industry_demand(invalid, data, PRINCIPAL))
        body['demand']['title'] = '<自填标题>'
        result = create_industry_demand(body, data, PRINCIPAL)
        self.assertEqual(result['project']['selectedPriority']['scope'], 'industry')
        self.assertEqual(result['project']['demandSpec']['source'], 'user_confirmed')

    def test_sync_preserves_selection_report_and_description_for_admin_and_user(self):
        data = state(); result = create_industry_demand(request(data), data, PRINCIPAL)
        key = result['projectKey']
        incoming = {'PROJECTS': {key: dict(result['project'], topic='被覆盖', selectedPriority={'sources': []},
                                         demandSpec={'description': '被覆盖'}, stage=5)},
                    'REPORTSTATE': {key: {'text': '被覆盖'}},
                    'DEMANDS': [dict(result['demand'], need='被覆盖', selectedPriority={}, domain='泛产业', res='checking')]}
        for principal in (PRINCIPAL, {'scope': 'admin', 'user': 'admin'}):
            guarded = json.loads(guard_sync(json.dumps(incoming).encode(), data, principal))
            self.assertEqual(guarded['PROJECTS'][key]['selectedPriority'], result['project']['selectedPriority'])
            self.assertEqual(guarded['PROJECTS'][key]['topic'], '生物医药')
            # Stage changes require the acknowledged docking action endpoint,
            # including for administrators; generic snapshots preserve it.
            self.assertEqual(guarded['PROJECTS'][key]['stage'], result['project']['stage'])
            self.assertEqual(guarded['REPORTSTATE'][key], result['reportState'])
            self.assertEqual(guarded['DEMANDS'][0]['need'], result['demand']['need'])
            self.assertEqual(guarded['DEMANDS'][0]['domain'], result['demand']['domain'])
            self.assertEqual(guarded['DEMANDS'][0]['res'], 'checking' if principal['scope'] == 'admin' else result['demand']['res'])

    def test_sync_cannot_attach_fresh_or_repurposed_legacy_receipt_to_concrete_demand(self):
        data = state(); result = create_industry_demand(request(data), data, PRINCIPAL)
        data['DEMANDS'].append({'id': 'legacy', 'projKey': 'p', 'topic': '历史需求'})
        for receipt_id in ('fresh', 'legacy'):
            row = dict(result['demand'], id=receipt_id)
            del row['demandContract']
            for principal in (PRINCIPAL, {'scope': 'admin', 'user': 'admin'}):
                self.assert_code('server_owned_demand', lambda: guard_sync(
                    json.dumps({'DEMANDS': [row]}).encode(), data, principal))
        for row in ({'id': 'new-alias', 'projectKey': result['projectKey']},
                    {'id': result['projectKey']}, {'id': 'd' + result['projectKey']}):
            self.assert_code('server_owned_demand', lambda: guard_sync(
                json.dumps({'DEMANDS': [row]}).encode(), data, PRINCIPAL))
        repeated = create_industry_demand(request(data), data, PRINCIPAL)
        self.assertFalse(repeated['created'])
        self.assertEqual(repeated['projectKey'], result['projectKey'])

    def test_sync_cannot_create_forged_contract_but_legacy_demands_still_work(self):
        data = state()
        body = {'PROJECTS': {'new': {'workspaceId': 'p', 'isDemand': True, 'demandContract': CONTRACT}}}
        self.assert_code('server_owned_demand', lambda: guard_sync(json.dumps(body).encode(), data, PRINCIPAL))
        body['PROJECTS']['new'].pop('demandContract')
        self.assertIn('new', json.loads(guard_sync(json.dumps(body).encode(), data, PRINCIPAL))['PROJECTS'])

    def test_concurrent_requests_create_once_and_success_follows_atomic_write(self):
        data = state(); body = request(data)
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'state.json')
            with open(path, 'w') as stream: json.dump(data, stream)
            handlers = [Handler() for _ in range(6)]
            def run(handler):
                handle_industry_demand(handler, json.dumps(body).encode(),
                                       lambda: file_session(path, lambda: None))
            with patch('backend.industry_demands.require_session', return_value=PRINCIPAL):
                threads = [threading.Thread(target=run, args=(handler,)) for handler in handlers]
                for thread in threads: thread.start()
                for thread in threads: thread.join()
            self.assertEqual([h.status for h in handlers], [200] * 6)
            self.assertEqual(sum(h.result()['created'] for h in handlers), 1)
            self.assertEqual(len({h.result()['projectKey'] for h in handlers}), 1)
            with open(path) as stream: saved = json.load(stream)
            self.assertEqual(len(saved['DEMANDS']), 1)

    def test_write_failure_never_acknowledges_saved_demand(self):
        data = state(); body = request(data); handler = Handler()
        @contextmanager
        def factory():
            class Session:
                def read(self): return json.dumps(data)
                def write(self, value): return False
            yield Session()
        with patch('backend.industry_demands.require_session', return_value=PRINCIPAL):
            handle_industry_demand(handler, json.dumps(body).encode(), factory)
        self.assertEqual(handler.status, 503)
        self.assertFalse(handler.result()['ok']); self.assertEqual(data['DEMANDS'], [])

    def test_new_demand_review_anchors_are_specific_request_not_industry_report(self):
        data = state()
        results = [create_industry_demand(request(data, index), data, PRINCIPAL) for index in (0, 1)]
        for result in results:
            context = project_context({'projectKey': result['projectKey'], 'topic': '生物医药'}, data)
            anchors = funnel_demand_anchors(context)
            self.assertEqual([row['id'] for row in anchors], ['demand:description', 'demand:conditions'])
            self.assertEqual(anchors[0]['quote'], result['project']['demandSpec']['description'])
            self.assertNotIn('完整报告原文', json.dumps(anchors, ensure_ascii=False))
            prompt = funnel_request_text(context)
            focus = result['project']['selectedPriority']['focus']
            self.assertIn(focus, prompt)
            other = '色谱填料' if focus == '生物制药滤器' else '生物制药滤器'
            self.assertNotIn(other, prompt)
            result = ground_funnel({'companies': []}, evidence_catalog(context['chunks']), context)
            self.assertEqual(result['demandFocus'], focus)
            self.assertEqual(result['sourcePriorityKey'], context['sourcePriorityKey'])

    def test_missing_specific_request_never_falls_back_to_report(self):
        data = state(); result = create_industry_demand(request(data), data, PRINCIPAL)
        data['PROJECTS'][result['projectKey']]['demandSpec'] = {}
        context = project_context({'projectKey': result['projectKey'], 'topic': '生物医药'}, data)
        self.assertEqual(funnel_demand_anchors(context), [])

    def test_review_must_match_specific_request_and_pushes_only_to_that_child(self):
        data = state()
        data['PROJECTS']['p']['kb'] = [{'t': '企业原文', 'known': [
            {'text': '甲公司生产生物制药滤器，具体产品资质须另外核实。来源 https://example.org/company'}]}]
        first, second = [create_industry_demand(request(data, i), data, PRINCIPAL) for i in (0, 1)]
        key = first['projectKey']
        body = {'projectKey': key, 'topic': '生物医药', 'reportRequestId': ''}
        context = project_context(body, data)
        catalog = evidence_catalog(context['chunks'])
        product = next(row for row in catalog if '甲公司' in row['quote'])
        data['PROJECTS'][key]['funnel'] = ground_funnel(
            {'companies': [{'name': '甲公司', 'evidence_ids': [product['id']]}]}, catalog, context)
        review = {'name': '甲公司', 'confirmed': True,
                  'product': {'evidenceId': product['id'], 'quote': product['quote']},
                  'demand': {'anchorId': 'report:0', 'quote': first['reportState']['text']},
                  'reason': '逐项对照该企业产品与生物制药滤器的实际需求，仍待后续核验资质'}
        body.update(names=['甲公司'], reviews=[review])
        self.assert_code('demand_changed', lambda: review_and_push(body, data, 'admin'))
        anchor = funnel_demand_anchors(context)[0]
        review['demand'] = {'anchorId': anchor['id'], 'quote': anchor['quote']}
        result = review_and_push(body, data, 'admin')
        self.assertEqual(result['added'], ['甲公司'])
        self.assertEqual(data['PROJECTS'][key]['clues'][0]['gap'], '生物制药滤器')
        self.assertEqual(data['PROJECTS'][second['projectKey']]['clues'], [])


if __name__ == '__main__':
    unittest.main()
