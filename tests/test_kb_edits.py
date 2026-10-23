"""Source-bound KB edits: actual transactions and HTTP, no production services."""
import ast
import concurrent.futures
import copy
from contextlib import contextmanager
import http.client
import io
import json
import re
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from backend import kb_edits, sync_merge
from backend.access_control import guard_sync, scoped_sync_view
from backend.auth import AuthError
from backend.evidence_grounding import project_context
from backend.sync_route import SyncDependencies, handle_sync
from backend.sync_transaction import file_session


KEY = 'team-a'
PRINCIPAL = {'scope': 'project', 'user': 'alice', 'projKey': KEY, 'projectKeys': [KEY]}
ROOT = Path(__file__).resolve().parents[1]


def state():
    return {'RESET_GEN': 'generation-a', 'PROJECTS': {
        KEY: {'id': KEY, 'workspaceId': KEY, 'city': '测试市', 'topic': '招引方向',
              'baseReportVersion': {'requestId': 'report-a', 'version': 1},
              'kb': [{'t': '政策', 'known': [
                  {'text': '⚠️ 原报告政策条件待核实。来源：https://example.invalid/policy',
                   'nature': 'base', 'origin': 'report', 'source': 'policy.md', 'ts': 1,
                   'metadata': {'flag': True, 'number': 1}},
                  '第二条原始资料。']}, {'t': '产业', 'known': []}]},
        'team-b': {'id': 'team-b', 'workspaceId': 'team-b', 'city': '测试市', 'kb': []}},
        'INVITE_CODES': {'TEAM_A': {'city': '测试市', 'projKey': KEY, 'usedBy': []}},
        'USER_PROFILES': {}, 'CITY_ACCOUNTS': {}}


def body(current=None, **changes):
    current = current or state()
    project = current['PROJECTS'][KEY]
    result = {'projectKey': KEY, 'sectionIndex': 0, 'sectionTitle': '政策',
              'baseReportVersion': copy.deepcopy(project['baseReportVersion']),
              'sourceIndex': 0, 'sourceItem': copy.deepcopy(project['kb'][0]['known'][0]),
              'editId': None, 'expectedRevision': 0,
              'text': '⚠️ 修订后的政策条件仍需核实。来源：https://example.invalid/policy',
              'resetGen': 'generation-a'}
    result.update(changes)
    return result


def follow(record, **changes):
    result = {'projectKey': KEY, 'sectionIndex': record['sectionIndex'],
              'sectionTitle': record['sectionTitle'], 'baseReportVersion': record['baseReportVersion'],
              'sourceIndex': record['sourceIndex'], 'sourceItem': record['sourceItem'],
              'editId': record['id'], 'expectedRevision': record['revision'],
              'text': record['text'], 'resetGen': 'generation-a'}
    result.update(changes)
    return result


class EditContractTests(unittest.TestCase):
    def setUp(self):
        self.state = state()

    def save(self, data=None):
        return kb_edits.save_edit(data or body(self.state), self.state, PRINCIPAL, now_ms=1000)['record']

    def assert_rejected(self, request, code=None, status=None):
        original = copy.deepcopy(self.state)
        with self.assertRaises(AuthError) as caught:
            self.save(request)
        if code:
            self.assertEqual(caught.exception.code, code)
        if status:
            self.assertEqual(caught.exception.status, status)
        self.assertEqual(self.state, original)

    def test_save_does_not_change_source_or_confirmation_status(self):
        original = copy.deepcopy(self.state)
        request = body(self.state)
        record = self.save(request)
        self.assertEqual(self.state['PROJECTS'], original['PROJECTS'])
        self.assertNotIn('KB_CONFIRMS', self.state)
        self.assertEqual(record['revision'], 1)
        self.assertEqual(record['account'], 'alice')
        self.assertEqual(record['text'], request['text'])
        self.assertFalse(record['deleted'])
        request['sourceItem']['metadata']['flag'] = False
        record['sourceItem']['metadata']['flag'] = False
        saved = self.state['KB_EDITS'][KEY][record['id']]
        self.assertIs(saved['sourceItem']['metadata']['flag'], True)

    def test_effective_body_keeps_source_metadata_and_pending_status(self):
        self.save()
        before = copy.deepcopy(self.state)
        items = kb_edits.effective_known(self.state, KEY, 0)
        self.assertTrue(items[0]['text'].startswith('⚠️'))
        self.assertEqual(items[0]['source'], 'policy.md')
        self.assertEqual(items[0]['origin'], 'user')
        self.assertEqual(items[0]['nature'], 'fix')
        self.assertTrue(items[0]['_kbUserEdited'])
        self.assertEqual(items[0]['_kbRevision'], 1)
        items[0]['metadata']['flag'] = False
        self.assertEqual(before, self.state)

    def test_effective_text_does_not_auto_confirm(self):
        record = self.save(body(text='✅ 修订文字'))
        self.assertEqual(record['text'], '✅ 修订文字')
        self.assertEqual(kb_edits.effective_known(self.state, KEY, 0)[0]['text'], '修订文字')

    def test_exact_source_boolean_number_and_string_are_distinct(self):
        for value in (1, 1.0, 'true'):
            request = body()
            request['sourceItem']['metadata']['flag'] = value
            self.assert_rejected(request, 'source_changed')
        request = body()
        request['sourceItem'] = dict(reversed(list(request['sourceItem'].items())))
        self.assertEqual(self.save(request)['revision'], 1)

    def test_browser_integral_float_equivalence_preserves_boolean_distinction(self):
        self.state['PROJECTS'][KEY]['kb'][0]['known'][0]['metadata']['array'] = [1.0, {'n': 2.0}]
        request = body(self.state)
        request['sourceItem']['metadata']['number'] = 1.0
        request['sourceItem']['metadata']['array'] = [1, {'n': 2}]
        request['baseReportVersion']['version'] = 1.0
        record = self.save(request)
        self.assertEqual(kb_edits.effective_known(self.state, KEY, 0)[0]['_kbEditId'], record['id'])
        for left, right in ((True, 1), (False, 0.0), ({'n': [True]}, {'n': [1]}),
                            (float('nan'), float('nan')), (float('inf'), float('inf'))):
            with self.subTest(left=left, right=right):
                self.assertFalse(kb_edits._same(left, right))

    def test_report_source_section_and_reset_changes_fail_closed(self):
        for changes, code in (({'baseReportVersion': {'requestId': 'old'}}, 'report_changed'),
                              ({'sourceIndex': 1}, 'source_changed'),
                              ({'sectionTitle': '其他分区'}, 'section_changed'),
                              ({'sectionIndex': 9}, 'section_changed'),
                              ({'resetGen': 'old'}, 'stale_generation')):
            with self.subTest(code=code):
                self.assert_rejected(body(**changes), code)

    def test_other_workspace_same_city_is_not_authorized(self):
        self.assert_rejected(body(projectKey='team-b'), 'workspace_forbidden', 403)

    def test_invalid_fields_and_types_cannot_write(self):
        for changes in ({'sectionIndex': True}, {'sourceIndex': False}, {'expectedRevision': True},
                        {'editId': ''}, {'text': ''}, {'text': 3}, {'text': ' \n'},
                        {'sectionTitle': ''}, {'unexpected': 1}, {'action': 'arbitrary'}):
            with self.subTest(changes=changes):
                self.assert_rejected(body(**changes))
        request = body(); del request['sourceItem']
        self.assert_rejected(request)
        self.assert_rejected(body(text='x' * (kb_edits.MAX_TEXT_CHARS + 1)), status=413)

    def test_existing_source_requires_revision_and_cannot_duplicate(self):
        record = self.save()
        self.assert_rejected(body(), 'edit_conflict')
        self.assert_rejected(follow(record, expectedRevision=0), 'edit_conflict')
        newer = self.save(follow(record, text='新的修订'))
        self.assertEqual(newer['id'], record['id'])
        self.assertEqual(newer['revision'], 2)
        self.assert_rejected(follow(record, text='迟到的旧标签'), 'edit_conflict')
        self.assertEqual(kb_edits.effective_known(self.state, KEY, 0)[0]['text'], '新的修订')

    def test_existing_record_cannot_rebind_to_other_source_or_section(self):
        record = self.save()
        self.assert_rejected(follow(record, sourceIndex=1, sourceItem='第二条原始资料。'), 'edit_conflict')
        self.assert_rejected(follow(record, sectionIndex=1, sectionTitle='产业', sourceIndex=None,
                                    sourceItem=None, baseReportVersion=None), 'edit_conflict')

    def test_notes_order_and_monthly_survival(self):
        first = self.save(body(sourceIndex=None, sourceItem=None, baseReportVersion=None, text='第一条补充'))
        second = self.save(body(sourceIndex=None, sourceItem=None, baseReportVersion=None, text='第二条补充'))
        revision = self.save(body())
        self.state['PROJECTS'][KEY]['baseReportVersion'] = {'requestId': 'report-b'}
        self.state['PROJECTS'][KEY]['kb'].reverse()
        notes = kb_edits.effective_known(self.state, KEY, 1)
        self.assertEqual(notes[0], self.state['PROJECTS'][KEY]['kb'][1]['known'][0])
        independent_notes = [note for note in notes[2:] if not note.get('correction')]
        self.assertEqual({note['_kbEditId'] for note in independent_notes}, {first['id'], second['id']})
        self.assertEqual([note['_kbEditId'] for note in independent_notes], sorted([first['id'], second['id']]))
        retained = [note for note in notes[2:] if note.get('correction')]
        self.assertEqual([note['_kbEditId'] for note in retained], [revision['id']])
        self.assertEqual(retained[0]['correction']['status'], 'needs_review')

    def test_source_change_invalidates_saved_overlay_without_losing_record(self):
        record = self.save()
        self.state['PROJECTS'][KEY]['kb'][0]['known'][0]['text'] = '新原文'
        self.assertEqual(kb_edits.effective_known(self.state, KEY, 0)[0]['text'], '新原文')
        self.assertIn(record['id'], self.state['KB_EDITS'][KEY])

    def test_note_cannot_claim_report_source(self):
        self.assert_rejected(body(sourceIndex=None, sourceItem=None), 'invalid_input')
        self.assert_rejected(body(sourceIndex=None, baseReportVersion=None), 'invalid_input')

    def test_note_requires_unique_section_title_on_save_and_read(self):
        note = self.save(body(sourceIndex=None, sourceItem=None, baseReportVersion=None))
        self.state['PROJECTS'][KEY]['kb'].append({'t': '政策', 'known': []})
        self.assert_rejected(body(sourceIndex=None, sourceItem=None, baseReportVersion=None), 'section_changed')
        self.assert_rejected(follow(note, text='不能确定分区'), 'section_changed')
        self.assertEqual(len(kb_edits.effective_known(self.state, KEY, 0)), 2)
        self.assertEqual(kb_edits.effective_known(self.state, KEY, 2), [])

    def test_delete_restores_original_and_deleted_revision_prevents_replay(self):
        record = self.save()
        request = follow(record, action='delete'); del request['text']
        deleted = self.save(request)
        self.assertTrue(deleted['deleted']); self.assertEqual(deleted['revision'], 2)
        self.assertEqual(kb_edits.effective_known(self.state, KEY, 0), self.state['PROJECTS'][KEY]['kb'][0]['known'])
        self.assert_rejected(body(), 'edit_conflict')
        self.assert_rejected(follow(record), 'edit_conflict')
        restored = self.save(follow(deleted, text='恢复修订'))
        self.assertFalse(restored['deleted']); self.assertEqual(restored['revision'], 3)

    def test_note_delete_hides_note_and_cannot_delete_base_source(self):
        self.assert_rejected(body(action='delete'), 'edit_conflict')
        note = self.save(body(sourceIndex=None, sourceItem=None, baseReportVersion=None))
        self.assertEqual(len(kb_edits.effective_known(self.state, KEY, 0)), 3)
        self.save(follow(note, action='delete'))
        self.assertEqual(len(kb_edits.effective_known(self.state, KEY, 0)), 2)

    def test_deleted_note_can_be_managed_after_section_moves(self):
        note = self.save(body(sourceIndex=None, sourceItem=None, baseReportVersion=None))
        self.state['PROJECTS'][KEY]['kb'].reverse()
        newer = self.save(follow(note, sectionIndex=1, text='移动分区后更新'))
        self.assertEqual(newer['sectionIndex'], 0)
        self.assertEqual(kb_edits.effective_known(self.state, KEY, 1)[-1]['text'], '移动分区后更新')

    def test_server_evidence_uses_effective_materials_without_altering_source(self):
        record = self.save()
        context = project_context({'projectKey': KEY, 'topic': '招引方向'}, self.state)
        texts = [chunk['text'] for chunk in context['chunks']]
        self.assertIn(record['text'], texts)
        self.assertNotIn(record['sourceItem']['text'], texts)
        self.assertEqual(self.state['PROJECTS'][KEY]['kb'][0]['known'][0], record['sourceItem'])

    def test_effective_source_revision_does_not_reintroduce_old_report_fact(self):
        self.state['PROJECTS'][KEY]['kb'][0]['known'][0]['text'] = '原政策补贴上限100万元。'
        report = {'aiReportByTopic': {'招引方向': '原政策补贴上限100万元。\n\n其他报告段落。'}}
        self.state['REPORTSTATE'] = {KEY: report}
        record = self.save(body(self.state, text='修订政策补贴上限200万元，仍须核验原文件。'))
        before = copy.deepcopy(self.state)
        context = project_context({'projectKey': KEY, 'topic': '招引方向'}, self.state)
        joined = '\n'.join(chunk['text'] for chunk in context['chunks'])
        self.assertIn('上限200万元', joined)
        self.assertNotIn('上限100万元', joined)
        self.assertNotIn('其他报告段落', joined)
        self.assertEqual(context['reportState'], report)
        self.assertEqual(before, self.state)
        self.save(follow(record, action='delete'))
        restored = project_context({'projectKey': KEY, 'topic': '招引方向'}, self.state)
        self.assertIn('其他报告段落。', [chunk['text'] for chunk in restored['chunks']])
        self.assertIn('原政策补贴上限100万元。', [chunk['text'] for chunk in restored['chunks']])

    def test_new_note_does_not_suppress_original_report(self):
        self.state['REPORTSTATE'] = {KEY: {'aiReportByTopic': {'招引方向': '报告政策上限100万元。'}}}
        self.save(body(sourceIndex=None, sourceItem=None, baseReportVersion=None,
                       text='新增一条尚待确认的独立补充。'))
        texts = [chunk['text'] for chunk in project_context({'projectKey': KEY, 'topic': '招引方向'}, self.state)['chunks']]
        self.assertIn('报告政策上限100万元。', texts)
        self.assertIn('新增一条尚待确认的独立补充。', texts)

    def test_inactive_source_revision_does_not_suppress_new_report(self):
        self.save()
        self.state['PROJECTS'][KEY]['baseReportVersion'] = {'requestId': 'report-b'}
        self.state['REPORTSTATE'] = {KEY: {'aiReportByTopic': {'招引方向': '新一月正式报告正文。'}}}
        texts = [chunk['text'] for chunk in project_context({'projectKey': KEY, 'topic': '招引方向'}, self.state)['chunks']]
        self.assertIn('新一月正式报告正文。', texts)

    def test_sync_cannot_write_records_even_as_admin_and_scoped_get_isolated(self):
        record = self.save()
        self.state['KB_EDITS']['team-b'] = {'secret': dict(record, text='OTHER_TEAM_ONLY')}
        for principal in (PRINCIPAL, {'scope': 'admin', 'user': 'admin'}):
            for value in ({}, {KEY: {}}, None):
                with self.subTest(principal=principal, value=value), self.assertRaises(AuthError):
                    guard_sync(json.dumps({'KB_EDITS': value}).encode(), self.state, principal)
        scoped = scoped_sync_view(self.state, PRINCIPAL)
        self.assertEqual(set(scoped['KB_EDITS']), {KEY})
        self.assertNotIn('OTHER_TEAM_ONLY', json.dumps(scoped))

    def test_old_generic_sync_without_edit_table_cannot_erase_revision(self):
        record = self.save()
        store = {'raw': json.dumps(self.state)}
        handler = Mock(); handler.wfile = io.BytesIO()
        deps = SyncDependencies(True, lambda: store['raw'], lambda raw: store.update(raw=raw) or True,
                                'unused', lambda: None, lambda value: value)
        handle_sync(handler, json.dumps({'PROJECTS': state()['PROJECTS'], 'RESET_GEN': 'generation-a'}).encode(), deps)
        self.assertTrue(json.loads(handler.wfile.getvalue())['ok'])
        self.assertEqual(json.loads(store['raw'])['KB_EDITS'][KEY][record['id']], record)

    def test_malformed_duplicate_and_foreign_records_do_not_become_effective(self):
        record = self.save()
        self.state['KB_EDITS'][KEY]['duplicate'] = dict(record, id='duplicate')
        self.state['KB_EDITS'][KEY]['malformed'] = {'text': 'not a revision'}
        self.assertEqual(kb_edits.effective_known(self.state, KEY, 0), self.state['PROJECTS'][KEY]['kb'][0]['known'])
        self.assertEqual(kb_edits.effective_known(self.state, KEY, True), [])


class TransactionTests(unittest.TestCase):
    def handle(self, current=None, request=None, write_ok=True, principal=PRINCIPAL):
        current = current or state(); writes = []
        @contextmanager
        def factory():
            yield SimpleNamespace(read=lambda: json.dumps(current), write=lambda raw: writes.append(raw) or write_ok)
        handler = Mock(); handler.headers = {}; handler.wfile = io.BytesIO()
        with patch.object(kb_edits, 'require_session', return_value=principal) as auth:
            kb_edits.handle_kb_edit(handler, json.dumps(request or body()).encode(), factory)
        return handler, json.loads(handler.wfile.getvalue()), writes, auth

    def test_only_acknowledges_successful_commit(self):
        handler, result, writes, auth = self.handle()
        self.assertEqual(handler.send_response.call_args.args[0], 200)
        self.assertEqual(json.loads(writes[0])['KB_EDITS'][KEY][result['record']['id']], result['record'])
        auth.assert_called_once()

    def test_storage_failure_and_auth_revocation_leave_no_success(self):
        handler, result, writes, _ = self.handle(write_ok=False)
        self.assertEqual(handler.send_response.call_args.args[0], 503)
        self.assertFalse(result['ok'])
        with patch.object(kb_edits, 'require_session', side_effect=AuthError(401, 'session_expired', '请登录')):
            handler = Mock(); handler.headers = {}; handler.wfile = io.BytesIO()
            write = Mock()
            @contextmanager
            def factory():
                yield SimpleNamespace(read=lambda: json.dumps(state()), write=write)
            kb_edits.handle_kb_edit(handler, json.dumps(body()).encode(), factory)
            write.assert_not_called()
            self.assertEqual(handler.send_response.call_args.args[0], 401)

    def test_bad_json_large_body_and_cross_origin_do_not_open_storage(self):
        for raw, headers, status in ((b'{', {}, 400), (b'NaN', {}, 400),
                (b'x' * (kb_edits.MAX_REQUEST_BYTES + 1), {}, 413),
                (b'{}', {'Sec-Fetch-Site': 'cross-site'}, 403)):
            factory = Mock(); handler = Mock(); handler.headers = headers; handler.wfile = io.BytesIO()
            kb_edits.handle_kb_edit(handler, raw, factory)
            factory.assert_not_called()
            self.assertEqual(handler.send_response.call_args.args[0], status)

    def test_file_transaction_concurrent_cas_has_one_winner_and_durable_readback(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'; path.write_text(json.dumps(state()))
            def edit(text):
                handler = Mock(); handler.headers = {}; handler.wfile = io.BytesIO()
                kb_edits.handle_kb_edit(handler, json.dumps(body(text=text)).encode(),
                                       lambda: file_session(str(path), lambda: None))
                return json.loads(handler.wfile.getvalue())
            with patch.object(kb_edits, 'require_session', return_value=PRINCIPAL):
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                    results = list(executor.map(edit, ('第一个写入', '第二个写入')))
            self.assertEqual(sum(result['ok'] for result in results), 1)
            self.assertEqual(next(result for result in results if not result['ok'])['error'], 'edit_conflict')
            saved = json.loads(path.read_text())
            record = next(result['record'] for result in results if result['ok'])
            self.assertEqual(kb_edits.effective_known(saved, KEY, 0)[0]['text'], record['text'])


class HttpIntegrationTests(unittest.TestCase):
    def test_real_handler_login_save_refresh_conflict_and_delete(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sync.json'; path.write_text(json.dumps(state()))
            tree = ast.parse((ROOT / 'server.py').read_text())
            nodes = [node for node in tree.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))
                     and node.name in ('Handler', '_clean_sync_data', '_is_noise_chunk', '_clean_kb_text', '_is_junk_item')]
            namespace = dict(BaseHTTPRequestHandler=__import__('http.server', fromlist=['BaseHTTPRequestHandler']).BaseHTTPRequestHandler,
                json=json, os=SimpleNamespace(environ={}), _PG_AVAIL=False, DATABASE_URL='',
                SYNC_PATH=str(path), _file_snapshot=lambda: None, _db_get=lambda: None, _db_set=lambda value: False,
                _NOISE_RE=[], PORT_OPS=-1, _re=re)
            namespace.update({name: getattr(sync_merge, name) for name in dir(sync_merge)
                              if name.startswith('_') and not name.startswith('__')})
            exec(compile(ast.Module(body=nodes, type_ignores=[]), 'isolated-kb-edit-handler', 'exec'), namespace)
            namespace['Handler'].log_message = lambda *args: None
            server = __import__('http.server', fromlist=['ThreadingHTTPServer']).ThreadingHTTPServer(('127.0.0.1', 0), namespace['Handler'])
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            cookie = None
            def request(method, route, value=None, extra=None):
                connection = http.client.HTTPConnection(*server.server_address, timeout=5)
                headers = {'Content-Type': 'application/json'}
                if cookie: headers['Cookie'] = cookie
                headers.update(extra or {})
                try:
                    connection.request(method, route, json.dumps(value).encode() if value is not None else None, headers)
                    response = connection.getresponse(); raw = response.read()
                    return response.status, dict(response.getheaders()), json.loads(raw)
                finally:
                    connection.close()
            try:
                status, headers, _ = request('POST', '/api/auth/register', {
                    'username': 'alice', 'password': 'offline-http-password-7', 'inviteCode': 'TEAM_A'})
                self.assertEqual(status, 200); cookie = headers['Set-Cookie'].split(';')[0]
                status, _, result = request('POST', '/api/kb-edit', body())
                self.assertEqual(status, 200); record = result['record']
                status, _, refreshed = request('GET', '/api/sync')
                self.assertEqual(status, 200)
                self.assertEqual(refreshed['KB_EDITS'][KEY][record['id']], record)
                self.assertEqual(refreshed['PROJECTS'][KEY]['kb'], state()['PROJECTS'][KEY]['kb'])
                summary_inputs = []
                namespace['_classify_and_summarize'] = lambda city, sections, texts: summary_inputs.extend(texts)
                status, _, summary = request('GET', '/api/kb-summary')
                self.assertEqual(status, 200); self.assertTrue(summary['ok'])
                self.assertIn(namespace['_clean_kb_text'](record['text']), summary_inputs)
                self.assertNotIn(namespace['_clean_kb_text'](record['sourceItem']['text']), summary_inputs)
                self.assertTrue(all(isinstance(item, str) for item in summary_inputs))
                self.assertNotIn('metadata', ' '.join(summary_inputs))
                status, _, result = request('POST', '/api/kb-edit', body())
                self.assertEqual(status, 409); self.assertEqual(result['error'], 'edit_conflict')
                status, _, result = request('POST', '/api/sync', {'KB_EDITS': {}})
                self.assertEqual(status, 403)
                status, _, result = request('POST', '/api/kb-edit', follow(record, action='delete'))
                self.assertEqual(status, 200); self.assertTrue(result['record']['deleted'])
                before = path.read_text()
                status, _, _ = request('POST', '/api/kb-edit', body(), {'Content-Length': str(1024 * 1024 + 1)})
                self.assertEqual(status, 413); self.assertEqual(path.read_text(), before)
                status, _, _ = request('POST', '/api/auth/logout', {})
                self.assertEqual(status, 200)
                status, _, _ = request('POST', '/api/kb-edit', body())
                self.assertEqual(status, 401)
            finally:
                server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
