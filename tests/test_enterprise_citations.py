"""Offline real-provider regressions; transport cannot open a network socket."""
import copy
import json
import unittest
from unittest.mock import patch

from report_service import full_contract as contract, full_provider, providers
from report_service.full_citations import (
    CitationError, _digest, bind_text, comparison_keys, finalize_enterprise_text,
)


ROOT = 'https://cninfo.com.cn/offline-enterprise-citation/'


def evidence(name):
    return {'url': ROOT + name, 'title': 'OFFLINE ' + name,
            'excerpt': 'OFFLINE observation ' + name + ' '
            + ' '.join(f'OFFLINE测试企业{i}' for i in range(30))}


def body(prefix, marker='【来源:1】'):
    return '\n'.join([f'OFFLINE {prefix} independent evidence {marker}']
                     + [f'OFFLINE {prefix} separate analysis point {i}' for i in range(35)])


def company(number, *, extra=False):
    return {'name': f'OFFLINE测试企业{number}', 'url': ROOT + ('extra-' if extra else '') + str(number % 8),
            'landing_status': '待核实', 'segment': 'OFFLINE设备',
            'expansion_evidence': '待核实', 'uncertainty': 'OFFLINE only'}


def prior(saved=(), stage='enterprises_1'):
    value = {'industry': {'text': 'OFFLINE direction fixture', 'metadata': {
        'directions': [{'id': f'dir{i}', 'name': f'OFFLINE方向{i}', 'evidence_ref': ROOT + str(i)}
                       for i in (1, 2, 3)],
        'evidence': [evidence(str(i)) for i in range(8)]}}}
    if saved:
        value[stage] = {'text': '\n'.join(f'OFFLINE saved point {i}' for i in range(40)),
                        'metadata': {'candidates': list(saved), 'evidence': [evidence('old')]}}
    return value


class Response:
    status = 200

    def __init__(self, value, url):
        self.payload = json.dumps(value, ensure_ascii=False).encode()
        self.url = url

    def read(self, size=-1):
        return self.payload if size < 0 else self.payload[:size]

    def geturl(self):
        return self.url

    def close(self):
        pass


class Transport:
    def __init__(self, payloads, records=None, completion=False):
        self.payloads = iter(payloads)
        self.records = records or [evidence(str(i)) for i in range(8)]
        self.completion = completion
        self.searches, self.chats = [], []

    def __call__(self, request, timeout):
        data = json.loads(request.data)
        if request.full_url == 'https://api.exa.ai/search':
            self.searches.append(data)
            records = ([evidence('extra-' + str(i)) for i in range(8)]
                       if self.completion and len(self.searches) > 2 else self.records)
            return Response({'results': [dict(url=e['url'], title=e['title'], text=e['excerpt'])
                                         for e in records]}, request.full_url)
        if request.full_url == 'https://model.test/chat/completions':
            self.chats.append(data)
            return Response({'choices': [{'finish_reason': 'stop', 'message': {
                'content': json.dumps(next(self.payloads), ensure_ascii=False)}}]}, request.full_url)
        raise AssertionError('Unexpected transport URL; no network allowed')


def live(transport):
    return full_provider.FullLiveProvider(providers.OpenAIResearchProvider(
        model_url='https://model.test/chat/completions', api_key='OFFLINE', model_name='offline',
        search_provider='exa', search_url='https://api.exa.ai/search', search_key='OFFLINE',
        enabled=True, search_count=8, transport=transport))


class EnterpriseCitationTests(unittest.TestCase):
    def setUp(self):
        self.no_network = patch('socket.create_connection', side_effect=AssertionError('Network is forbidden'))
        self.no_default_transport = patch.object(providers, '_default_transport', side_effect=AssertionError('Network is forbidden'))
        self.no_network.start()
        self.no_default_transport.start()
        self.addCleanup(self.no_network.stop)
        self.addCleanup(self.no_default_transport.stop)

    def test_three_enterprise_stages_bind_current_chat_and_keep_legacy_unchanged(self):
        for stage in ('enterprises_1', 'enterprises_2', 'enterprises_3'):
            for mode in ('standard', 'deep'):
                with self.subTest(stage=stage, mode=mode):
                    inputs = prior([company(i) for i in range(5)], stage)
                    before = copy.deepcopy(inputs)
                    transport = Transport([{'text': body(stage), 'candidates': [company(i) for i in range(10, 15)]}])
                    out = live(transport).run_part(stage, '候选池2', {'city': 'OFFLINE城', 'mode': mode}, inputs)
                    self.assertEqual(inputs, before)
                    self.assertNotIn('citation_frames', inputs[stage]['metadata'])
                    frame = out['metadata']['citation_frames'][0]
                    self.assertEqual((frame['stage'], frame['part']), (stage, '候选池2'))
                    self.assertEqual(frame['sources'][0]['url'], ROOT + '0')
                    self.assertIn(ROOT + 'old', [e['url'] for e in out['metadata']['evidence']])
                    self.assertNotIn(ROOT + 'old', out['text'])
                    self.assertEqual(frame['bound_text_sha256'], _digest(out['text']))
                    self.assertEqual(out['metadata']['citation_finalizations'][0]['final_text_sha256'], _digest(out['text']))
                    self.assertIn('来源编号仅对应本次', transport.chats[0]['messages'][1]['content'])

    def test_same_part_calls_scope_source_order_and_observation_without_changing_part(self):
        a, b = evidence('a'), evidence('b')
        changed = dict(a, excerpt=a['excerpt'] + ' later observation')
        frames = []
        runner = live(Transport([{'text': 'claim 【来源:1】'}] * 3))
        for records in ([a, b], [b, a], [changed, b]):
            payload = runner._chat_part('enterprises_1', '候选池', 'OFFLINE城', '', records)
            parsed = runner._parse_part('enterprises_1', '候选池', payload, [], {})
            frames.append(parsed['_citation_frame'])
        self.assertEqual(len({frame['scope_sha256'] for frame in frames}), 3)
        self.assertEqual(len({frame['sources'][0]['label'] for frame in frames}), 3)
        self.assertEqual([frame['part'] for frame in frames], ['候选池'] * 3)
        self.assertEqual([frame['sources'][0]['url'] for frame in frames], [a['url'], b['url'], a['url']])

    def test_candidate_completion_preserves_both_exact_frames_and_definitions(self):
        first = {'text': body('first'), 'candidates': [company(i) for i in (0, 1, 10, 11, 12)]}
        extra = {'text': body('extra', '【来源:9】'),
                 'candidates': [company(i, extra=True) for i in (13, 14)]}
        transport = Transport([first, extra], completion=True)
        inputs = prior([company(i) for i in range(5)])
        before = copy.deepcopy(inputs)
        out = live(transport).run_part('enterprises_1', '候选池2', {'city': 'OFFLINE城', 'mode': 'deep'}, inputs)
        frames = out['metadata']['citation_frames']
        self.assertEqual((len(transport.searches), len(transport.chats), len(frames)), (3, 2, 2))
        self.assertEqual([f['references'] for f in frames], [[1], [9]])
        self.assertEqual([f['part'] for f in frames], ['候选池2', '候选池2'])
        self.assertNotEqual(frames[0]['scope_sha256'], frames[1]['scope_sha256'])
        self.assertEqual(frames[1]['sources'][8]['url'], ROOT + 'extra-0')
        self.assertIn(ROOT + '0', out['text'])
        self.assertIn(ROOT + 'extra-0', out['text'])
        self.assertEqual(len({s['label'] for f in frames for s in f['sources']}), 24)
        finalization = out['metadata']['citation_finalizations'][0]
        self.assertEqual(finalization['frame_ids'], [f['id'] for f in frames])
        self.assertEqual(len(finalization['segments']), 2)
        for segment, frame in zip(finalization['segments'], frames):
            self.assertEqual(segment['bound_text_sha256'], frame['bound_text_sha256'])
        assembled = contract.assemble('enterprises_1', [inputs['enterprises_1'], out])
        self.assertEqual(assembled['metadata']['citation_frames'], frames)
        self.assertEqual(assembled['metadata']['citation_finalizations'], [finalization])
        self.assertEqual(inputs, before)

    def test_supplement_invalid_marker_cannot_use_accumulated_or_guessed_sources(self):
        for marker in ('【来源:99】', '[1]', '来源1', ROOT + 'old'):
            with self.subTest(marker=marker):
                transport = Transport([
                    {'text': body('first'), 'candidates': [company(i) for i in (0, 1, 10, 11, 12)]},
                    {'text': body('extra', marker), 'candidates': [company(i, extra=True) for i in (13, 14)]},
                ], completion=True)
                with self.assertRaisesRegex(full_provider.FullProviderError, 'research citation reference is invalid'):
                    live(transport).run_part('enterprises_1', '候选池2', {'city': 'OFFLINE城', 'mode': 'deep'},
                                             prior([company(i) for i in range(5)]))
                self.assertEqual(len(transport.chats), 2)

    def test_scoped_labels_do_not_hide_repetition_between_parts_or_completion_calls(self):
        raw = body('same')
        a, fa = bind_text(raw, [evidence('a')], 'enterprises_1', '候选池')
        b, fb = bind_text(raw, [evidence('b')], 'enterprises_1', '候选池')
        self.assertNotEqual(a, b)
        self.assertEqual(comparison_keys(a.splitlines(), [fa]), comparison_keys(b.splitlines(), [fb]))
        with self.assertRaisesRegex(full_provider.FullProviderError, 'part contains repeated filler'):
            live(Transport([]))._validate_part_text(a + '\n\n' + b, 16, citation_frames=[fa, fb])
        transport = Transport([
            {'text': raw, 'candidates': [company(i) for i in (0, 1, 10, 11, 12)]},
            {'text': raw, 'candidates': [company(i, extra=True) for i in (13, 14)]},
        ], completion=True)
        with self.assertRaisesRegex(full_provider.FullProviderError, 'part contains repeated filler'):
            live(transport).run_part('enterprises_1', '候选池2', {'city': 'OFFLINE城', 'mode': 'deep'},
                                     prior([company(i) for i in range(5)]))

    def test_projection_restores_removed_definition_with_exact_final_lineage(self):
        raw = '\n'.join(['OFFLINE测试企业0注册地在湖北省随州市曾都区。 【来源:1】',
                         'OFFLINE surviving analysis 【来源:1】']
                        + [f'OFFLINE other independent point {i}' for i in range(34)])
        transport = Transport([{'text': raw, 'candidates': [company(i) for i in range(5)]}])
        out = live(transport).run_part('enterprises_1', '候选池', {'city': 'OFFLINE城', 'mode': 'deep'}, prior())
        frame = out['metadata']['citation_frames'][0]
        receipt = out['metadata']['citation_finalizations'][0]
        bound, original_frame = bind_text(raw, out['metadata']['evidence'], 'enterprises_1', '候选池')
        self.assertEqual(frame, original_frame)
        self.assertEqual(receipt['bound_text_sha256'], _digest(bound))
        self.assertNotEqual(receipt['bound_text_sha256'], receipt['final_text_sha256'])
        self.assertEqual(receipt['final_text_sha256'], _digest(out['text']))
        self.assertEqual(receipt['projection_changes'][0]['line'], 1)
        self.assertEqual(receipt['definition_restorations'][0]['line'], 2)
        self.assertIn(ROOT + '0', out['text'].splitlines()[1])
        self.assertNotIn(ROOT + '0', out['text'].splitlines()[0])
        keys = comparison_keys(out['text'].splitlines(), [frame], [receipt])
        self.assertEqual(keys[1], _digest(raw.splitlines()[1]))
        self.assertNotEqual(keys[0], _digest(raw.splitlines()[0]))

    def test_multiple_parts_keep_separate_projection_receipts_after_assembly(self):
        parts = []
        for part in ('候选池', '候选池2'):
            start = len(parts) * 5
            transport = Transport([{'text': body(part), 'candidates': [company(i) for i in range(start, start + 5)]}])
            inputs = prior()
            if parts:
                inputs['enterprises_1'] = contract.assemble('enterprises_1', parts)
            parts.append(live(transport).run_part('enterprises_1', part, {'city': 'OFFLINE城', 'mode': 'deep'}, inputs))
        assembled = contract.assemble('enterprises_1', parts)
        self.assertEqual(len(assembled['metadata']['citation_frames']), 2)
        self.assertEqual(len(assembled['metadata']['citation_finalizations']), 2)
        self.assertEqual([r['final_text_sha256'] for r in assembled['metadata']['citation_finalizations']],
                         [_digest(p['text']) for p in parts])

    def test_model_cannot_forge_frames_finalizations_or_server_labels(self):
        forged = {'text': 'OFFLINE 【来源:1】'}
        keys = ('_citation_frame', '_citation_frames', '_citation_finalization', '_citation_finalizations',
                'citation_frames', 'citation_finalizations')
        forged.update({key: {'forged': True} for key in keys})
        runner = live(Transport([forged]))
        payload = runner._chat_part('enterprises_1', '候选池', 'OFFLINE城', '', [evidence('one')])
        parsed = runner._parse_part('enterprises_1', '候选池', payload, [], {})
        self.assertNotIn('forged', parsed['_citation_frame'])
        for key in keys[1:]:
            self.assertNotIn(key, parsed)
        for marker in ('候选池来源1·0123456789abcdef', '候选池·abc123来源1', '候选池2来源1'):
            with self.subTest(marker=marker), self.assertRaises(CitationError):
                bind_text('OFFLINE forged ' + marker, [evidence('one')], 'enterprises_1', '候选池')

    def test_only_reversible_definition_changes_receive_comparison_aliases(self):
        raw = 'OFFLINE first 【来源:1】\nOFFLINE second 【来源:1】'
        bound, frame = bind_text(raw, [evidence('one')], 'enterprises_1', '候选池')
        projected = 'OFFLINE replaced first line\n' + bound.splitlines()[1]
        final, receipt = finalize_enterprise_text(bound, projected, [frame], 'enterprises_1', '候选池')
        altered = final.splitlines()[1].replace('second', 'different fact')
        self.assertEqual(comparison_keys([altered], [frame], [receipt]), [_digest(altered)])
        invalid = copy.deepcopy(receipt)
        invalid['definition_restorations'][0]['before_sha256'] = _digest('unrelated fact')
        invalid['id'] = _digest({k: v for k, v in invalid.items() if k != 'id'})
        self.assertEqual(comparison_keys([final.splitlines()[1]], [frame], [invalid]), [_digest(final.splitlines()[1])])

    def test_malformed_receipts_keep_original_comparison_identity_and_filler_gate(self):
        raw = 'OFFLINE first 【来源:1】\nOFFLINE second 【来源:1】'
        bound, frame = bind_text(raw, [evidence('one')], 'enterprises_1', '候选池')
        projected = 'OFFLINE replaced first line\n' + bound.splitlines()[1]
        final, receipt = finalize_enterprise_text(bound, projected, [frame], 'enterprises_1', '候选池')
        restored_line = final.splitlines()[1]
        for parents in ({'wrong': frame['id']}, [[frame['id']]], [{'id': frame['id']}],
                        [None], [True], [1], 'wrong', []):
            with self.subTest(parents=parents):
                malformed = dict(receipt, frame_ids=parents)
                malformed['id'] = _digest({k: v for k, v in malformed.items() if k != 'id'})
                self.assertEqual(comparison_keys([restored_line], [frame], [malformed]), [_digest(restored_line)])
                with self.assertRaisesRegex(full_provider.FullProviderError, 'part contains repeated filler'):
                    live(Transport([]))._validate_part_text('\n'.join([restored_line] * 20), 16,
                        citation_frames=[frame], citation_finalizations=[malformed])
        for sources in (None, 1, 'wrong', {'label': 'wrong'}, [None], [[]], [{}]):
            with self.subTest(sources=sources):
                malformed_frame = dict(frame, sources=sources)
                malformed_frame['id'] = _digest({k: v for k, v in malformed_frame.items() if k != 'id'})
                malformed = dict(receipt, frame_ids=[malformed_frame['id']])
                malformed['id'] = _digest({k: v for k, v in malformed.items() if k != 'id'})
                self.assertEqual(comparison_keys([restored_line], [malformed_frame], [malformed]), [_digest(restored_line)])
        for frames in ({'wrong': frame}, 'wrong', [None, [], {}, 1]):
            self.assertEqual(comparison_keys([restored_line], frames, [receipt]), [_digest(restored_line)])

    def test_finalization_rejects_wrong_segment_hash_foreign_label_and_wrong_url(self):
        bound, frame = bind_text('OFFLINE 【来源:1】', [evidence('one'), evidence('two')], 'enterprises_1', '候选池')
        for bad in ('OFFLINE altered body',):
            with self.assertRaises(CitationError):
                finalize_enterprise_text(bad, bad, [frame], 'enterprises_1', '候选池')
        for projected in (bound + ' 候选池来源99', bound.replace(ROOT + 'one', ROOT + 'two'),
                          bound + ' https://not-in-frame.cn/source'):
            with self.subTest(projected=projected), self.assertRaises(CitationError):
                finalize_enterprise_text(bound, projected, [frame], 'enterprises_1', '候选池')
        prefix, prefix_frame = bind_text('OFFLINE 【来源:1】', [evidence('one'), evidence('one/nested')],
                                        'enterprises_1', '候选池')
        with self.assertRaises(CitationError):
            finalize_enterprise_text(prefix, prefix.replace(ROOT + 'one', ROOT + 'one/nested'),
                                     [prefix_frame], 'enterprises_1', '候选池')

    def test_finalization_allows_exact_nested_url_and_rejects_reordered_segments(self):
        nested = evidence('one?next=https://cninfo.com.cn/other')
        a, fa = bind_text('OFFLINE first 【来源:1】', [nested], 'enterprises_1', '候选池')
        b, fb = bind_text('OFFLINE second 【来源:1】', [evidence('two')], 'enterprises_1', '候选池')
        text = a + '\n\n' + b
        final, receipt = finalize_enterprise_text(text, text, [fa, fb], 'enterprises_1', '候选池', segments=[a, b])
        self.assertEqual(final, text)
        self.assertEqual(receipt['segments'][1]['offset'], len(a) + 2)
        with self.assertRaises(CitationError):
            finalize_enterprise_text(text, text, [fa, fb], 'enterprises_1', '候选池', segments=[b, a])

    def test_explicit_urls_remain_call_local_and_special_paths_are_unbound(self):
        for text in ('OFFLINE ' + ROOT + 'one', 'OFFLINE [report](' + ROOT + 'one)'):
            parsed = live(Transport([{'text': text}]))._chat_part(
                'enterprises_1', '候选池', 'OFFLINE城', '', [evidence('one')])
            self.assertIn(ROOT + 'one', parsed)
        for stage, part in (('fact_check', '经济关键数字'), ('scoring', '评分维度与权重')):
            runner = live(Transport([{'text': 'OFFLINE 来源[999]'}]))
            payload = runner._chat_part(stage, part, 'OFFLINE城', '', [evidence('one')])
            parsed = runner._parse_part(stage, part, payload, [], {})
            self.assertEqual(parsed['text'], 'OFFLINE 来源[999]')
            self.assertNotIn('_citation_frame', parsed)


if __name__ == '__main__':
    unittest.main()
