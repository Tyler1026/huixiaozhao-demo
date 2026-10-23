"""Offline regression: bind each call's source frame before stage assembly."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from docx import Document
from report_service import full_contract as contract
from report_service import full_provider as provider
from report_service import full_worker as worker
from report_service import providers
from report_service.full_citations import CitationError, bind_text, comparison_keys
from report_service.full_store import _checkpoint_issue
from report_service.word_export import CHAPTER_ORDER, md_to_docx, build_compact_docx


ROOT = 'https://stats.gov.cn/offline-citation-fixture/'
PARTS = ('交通网络', '土地资源', '园区载体')


def evidence(name):
    return {'url': ROOT + name, 'title': 'OFFLINE ' + name,
            'excerpt': 'OFFLINE original excerpt ' + name, 'published': '2026-01-01'}


def body(part, citation='来源[1]'):
    return '\n'.join([f'OFFLINE {part} supports this fixture ({citation}).']
                     + [f'OFFLINE {part} independent test point {i}.' for i in range(32)])


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
    def __init__(self, records, texts=None):
        self.records = records
        self.texts = iter(texts) if texts is not None else None
        self.searches, self.chats = [], []

    def __call__(self, request, timeout):
        data = json.loads(request.data)
        if request.full_url == 'https://api.exa.ai/search':
            self.searches.append(data)
            return Response({'results': [dict(url=e['url'], title=e['title'], text=e['excerpt'])
                                         for e in self.records]}, request.full_url)
        if request.full_url == 'https://model.test/chat/completions':
            self.chats.append(data)
            text = next(self.texts) if self.texts is not None else body(PARTS[0])
            return Response({'choices': [{'finish_reason': 'stop', 'message': {
                'content': json.dumps({'text': text, '_citation_frame': {'forged': True}},
                                      ensure_ascii=False)}}]}, request.full_url)
        raise AssertionError('No external transport is permitted')


def live(transport):
    return provider.FullLiveProvider(providers.OpenAIResearchProvider(
        model_url='https://model.test/chat/completions', api_key='OFFLINE_MODEL',
        model_name='offline', search_provider='exa', search_url='https://api.exa.ai/search',
        search_key='OFFLINE_SEARCH', enabled=True, search_count=5, transport=transport))


class ResearchCitationTests(unittest.TestCase):
    def test_real_provider_binds_fresh_source_despite_accumulated_metadata(self):
        previous = {'text': body('old', 'already explicit URL'),
                    'metadata': {'evidence': [evidence('old')]}}
        prior = {'transport': previous}
        original = copy.deepcopy(prior)
        transport = Transport([evidence('fresh')], [body('land')])
        out = live(transport).run_part('transport', '土地资源', {'city': 'OFFLINE城'}, prior)
        self.assertEqual(prior, original)
        self.assertEqual([e['url'] for e in out['metadata']['evidence']], [ROOT + 'old', ROOT + 'fresh'])
        self.assertIn(ROOT + 'fresh', out['text'])
        self.assertNotIn(ROOT + 'old', out['text'])
        self.assertNotIn('来源[1]', out['text'])
        frame = out['metadata']['citation_frames'][0]
        self.assertEqual(frame['sources'][0]['url'], ROOT + 'fresh')
        self.assertEqual(frame['references'], [1])
        self.assertNotIn('forged', frame)
        self.assertIn('[1] OFFLINE fresh — ' + ROOT + 'fresh', transport.chats[0]['messages'][-1]['content'])

    def test_three_parts_assemble_and_full_and_compact_word_keep_bound_sources(self):
        parts = []
        for index, part in enumerate(PARTS):
            records = [evidence(f'old-{i}') for i in range(5)] if index == 0 else [evidence(f'fresh-{index}')]
            out = live(Transport(records, [body(part)])).run_part(
                'transport', part, {'city': 'OFFLINE城'},
                {'transport': contract.assemble('transport', parts)} if parts else {})
            parts.append(out)
        assembled = contract.assemble('transport', parts)
        self.assertEqual(contract.validate('transport', assembled['text'], assembled['metadata']), [])
        self.assertEqual(len(assembled['metadata']['citation_frames']), 3)
        self.assertEqual(len({f['id'] for f in assembled['metadata']['citation_frames']}), 3)
        for url in (ROOT + 'old-0', ROOT + 'fresh-1', ROOT + 'fresh-2'):
            self.assertIn(url, assembled['text'])
        self.assertNotIn('来源[1]', assembled['text'])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in CHAPTER_ORDER:
                (root / name).write_text('OFFLINE fixture only, not a city report.\n')
            (root / '01c_transport_land.md').write_text(assembled['text'])
            (root / '09_compact_report.md').write_text(assembled['text'])
            md_to_docx(root, root / 'full.docx', 'OFFLINE测试城', synthetic=True)
            build_compact_docx('OFFLINE测试城', root, root / 'compact.docx', synthetic=True)
            for name in ('full.docx', 'compact.docx'):
                word = '\n'.join(p.text for p in Document(root / name).paragraphs)
                for url in (ROOT + 'old-0', ROOT + 'fresh-1', ROOT + 'fresh-2'):
                    self.assertIn(url, word)
                self.assertNotIn('来源[1]', word)

    def test_one_repetition_correction_keeps_only_its_own_final_frame(self):
        repeated = '\n'.join(['OFFLINE repeated 来源[1]'] * 33)
        corrected = body('corrected', '【来源:1】')
        transport = Transport([evidence('correction')], [repeated, corrected])
        out = live(transport).run_part('transport', '交通网络', {'city': 'OFFLINE城'}, {})
        self.assertEqual((len(transport.searches), len(transport.chats)), (1, 2))
        frames = out['metadata']['citation_frames']
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0]['references'], [1])
        self.assertEqual(frames[0]['sources'][0]['url'], ROOT + 'correction')
        self.assertIn('corrected', out['text'])

    def test_part_labels_do_not_hide_duplicate_facts_from_provider_or_contract(self):
        raw = '\n'.join(f'OFFLINE same fact {i} 来源[1]' for i in range(33))
        records = [evidence(f'original-{i}') for i in range(5)]
        first = live(Transport(records, [raw])).run_part('transport', PARTS[0], {'city': 'OFFLINE城'}, {})
        transport = Transport([evidence('fresh')], [raw, raw])
        with self.assertRaisesRegex(provider.FullProviderError, 'part contains repeated filler'):
            live(transport).run_part('transport', PARTS[1], {'city': 'OFFLINE城'}, {'transport': first})
        self.assertEqual((len(transport.searches), len(transport.chats)), (1, 2))
        second_text, second_frame = bind_text(raw, [evidence('fresh')], 'transport', PARTS[1])
        self.assertNotEqual(first['text'], second_text)
        self.assertEqual(comparison_keys(first['text'].splitlines(), first['metadata']['citation_frames']),
                         comparison_keys(second_text.splitlines(), [second_frame]))
        combined = contract.assemble('transport', [first, {'text': second_text, 'metadata': {
            'evidence': [evidence('fresh')], 'citation_frames': [second_frame]}}])
        self.assertIn('repeated filler exceeds 20 percent of substantive lines',
                      contract.validate('transport', combined['text'], combined['metadata']))

    def test_lineage_is_exact_and_does_not_erase_changed_facts_or_legacy_text(self):
        raw = 'GDP 100 来源[1]'
        bound, frame = bind_text(raw, [evidence('one')], 'economy', '经济总量')
        self.assertEqual(comparison_keys([bound], [frame]), comparison_keys([raw]))
        changed = bound.replace('GDP 100', 'GDP 200')
        self.assertNotEqual(comparison_keys([changed], [frame]), comparison_keys([raw]))
        forged = copy.deepcopy(frame)
        forged['line_bindings'][0]['model_sha256'] = '0' * 64
        self.assertEqual(comparison_keys([bound], [forged]), comparison_keys([bound]))
        self.assertEqual(raw, 'GDP 100 来源[1]')

    def test_each_call_uses_its_own_order_even_for_same_part(self):
        first, second = evidence('first'), evidence('second')
        runner = live(Transport([], ['claim 来源[1]', 'claim 来源[1]']))
        a = runner._chat_part('transport', '交通网络', 'OFFLINE城', '', [first, second])
        b = runner._chat_part('transport', '交通网络', 'OFFLINE城', '', [second, first])
        a = runner._parse_part('transport', '交通网络', a, [], {})
        b = runner._parse_part('transport', '交通网络', b, [], {})
        fa, fb = a['_citation_frame'], b['_citation_frame']
        self.assertIn(first['url'], a['text'])
        self.assertIn(second['url'], b['text'])
        self.assertNotEqual(fa['id'], fb['id'])

    def test_prompt_frame_is_frozen_before_transport_returns(self):
        records = [evidence('original')]
        original = copy.deepcopy(records)
        class MutatingTransport(Transport):
            def __call__(self, request, timeout):
                if request.full_url == 'https://model.test/chat/completions':
                    records[0]['url'] = ROOT + 'changed-after-prompt'
                return super().__call__(request, timeout)
        runner = live(MutatingTransport([], ['claim 来源[1]']))
        payload = runner._chat_part('transport', '交通网络', 'OFFLINE城', '', records)
        parsed = runner._parse_part('transport', '交通网络', payload, [], {})
        self.assertIn(original[0]['url'], parsed['text'])
        self.assertNotIn(records[0]['url'], parsed['text'])
        self.assertEqual(parsed['_citation_frame']['sources'][0]['url'], original[0]['url'])

    def test_grouped_sources_and_repeated_references_preserve_existing_url_gate(self):
        records = [evidence('one'), evidence('two')]
        text = '\n'.join(f'unique point {i} 来源[1,2]' for i in range(8))
        bound, frame = bind_text(text, records, 'transport', '交通网络')
        self.assertEqual(len(bound.splitlines()), len(text.splitlines()))
        self.assertEqual(bound.count(records[0]['url']), 1)
        self.assertEqual(bound.count(records[1]['url']), 1)
        self.assertEqual(len(frame['references']), 16)
        self.assertEqual(contract._validate_urls(bound), [])
        self.assertEqual(contract.minimum_evidence_urls('standard'), 5)
        self.assertEqual(contract.minimum_evidence_urls('deep'), 8)

    def test_query_variants_keep_exact_urls_without_counting_as_distinct_sources(self):
        a, b = evidence('same?a=1#one'), evidence('same?a=2#two')
        bound, frame = bind_text('claim 【来源:1,2】', [a, b], 'economy', '经济总量')
        self.assertIn(a['url'], bound)
        self.assertIn(b['url'], bound)
        self.assertNotEqual(frame['sources'][0]['id'], frame['sources'][1]['id'])
        self.assertEqual(contract.canonical_url(a['url']), contract.canonical_url(b['url']))

    def test_source_url_cannot_add_lines_or_whitespace_to_bound_prose(self):
        for suffix in ('\nextra line', '\rhidden', ' trailing-space', '\tcolumn'):
            with self.subTest(suffix=repr(suffix)), self.assertRaises(CitationError):
                bind_text('claim 来源[1]', [evidence('source' + suffix)], 'transport', '交通网络')

    def test_ambiguous_unknown_and_malformed_references_fail_safely(self):
        for text in ('claim [1]', '来源[0]', '来源[-1]', '来源[999]', '来源[bad]',
                     '【来源:1-2】', '【来源:unknown】', '【来源999】', '[source 999]',
                     '【来源未知】', '来源[1', '【来源:1', '【来源999', '[1', '[source 999',
                     '来源[' + '9' * 5000 + ']'):
            with self.subTest(text=text), self.assertRaises(CitationError) as caught:
                bind_text(text, [evidence('only')], 'transport', '交通网络')
            self.assertEqual(str(caught.exception), 'research citation reference is invalid')

    def test_real_provider_unknown_reference_is_quality_and_safe_diagnostic(self):
        transport = Transport([evidence('only')], [body('bad', '来源[999] SECRET_TEXT')])
        with self.assertRaises(provider.FullProviderError) as caught:
            live(transport).run_part('transport', '交通网络', {'city': 'OFFLINE城'}, {})
        self.assertEqual(caught.exception.failure_code, 'quality')
        diagnostic = worker._failure_diagnostics(caught.exception, 'provider', 'transport', '交通网络')
        self.assertEqual(diagnostic['issues'], ['citation_reference'])
        self.assertNotIn('SECRET_TEXT', json.dumps(diagnostic))
        self.assertNotIn(ROOT, json.dumps(diagnostic))

    def test_ordinary_prose_explicit_links_and_url_query_brackets_are_not_rewritten(self):
        records = [evidence('doc'), evidence('doc?q=[1]')]
        text = rf'notes [analysis] \[1] [1]({records[0]["url"]}) {records[1]["url"]}'
        bound, frame = bind_text(text, records, 'transport', '交通网络')
        self.assertEqual(bound, text)
        self.assertEqual(frame['references'], [])
        self.assertEqual(frame['explicit_url_references'], [1, 2])

    def test_unknown_urls_and_prior_labels_cannot_become_current_sources(self):
        old, current = evidence('prior'), evidence('current')
        prior_text = f'old claim 交通网络来源1 {old["url"]}'
        for text in (f'claim [1]({old["url"]})', f'claim 来源[1] {old["url"]}',
                     'claim （交通网络来源1）', 'claim （土地资源来源1）'):
            with self.subTest(text=text):
                runner = live(Transport([], [text]))
                with self.assertRaisesRegex(provider.FullProviderError, 'research citation reference is invalid'):
                    runner._chat_part('transport', '土地资源', 'OFFLINE城', prior_text, [current])
        # An explicitly included original record with its excerpt is a real
        # input to this call; prior text by itself was insufficient above.
        transport = Transport([], [f'claim [1]({old["url"]}).'])
        runner = live(transport)
        payload = runner._chat_part('transport', '土地资源', 'OFFLINE城', prior_text, [old, current])
        parsed = runner._parse_part('transport', '土地资源', payload, [], {})
        self.assertEqual(parsed['_citation_frame']['explicit_url_references'], [1])
        prompt = transport.chats[0]['messages'][-1]['content']
        self.assertIn(f'[1] {old["title"]} — {old["url"]}', prompt)
        self.assertIn(old['excerpt'], prompt)
        self.assertIn('不得仅因前序正文出现而沿用', prompt)

    def test_exact_nested_url_is_one_source_and_unknown_uppercase_url_fails(self):
        for suffix in ('one?next=https://stats.gov.cn/x', 'one?source[1]=x'):
            source = evidence(suffix)
            text = f'claim [1]({source["url"]})'
            bound, frame = bind_text(text, [source], 'transport', '交通网络')
            self.assertEqual(bound, text)
            self.assertEqual(frame['explicit_url_references'], [1])
            self.assertEqual(frame['references'], [])
        with self.assertRaises(CitationError):
            bind_text('claim HTTPS://stats.gov.cn/not-in-frame', [source], 'transport', '交通网络')

    def test_non_https_inline_links_fail_and_literal_prose_is_not_rewritten(self):
        for target in ('javascript:alert(1)', 'data:text/plain,untrusted', 'mailto:test@example.test', '#other'):
            with self.subTest(target=target), self.assertRaises(CitationError):
                bind_text(f'[official]({target})', [evidence('one')], 'transport', '交通网络')
        text = r'Literal escaped example: \[official](javascript:example)'
        bound, _ = bind_text(text, [evidence('one')], 'transport', '交通网络')
        self.assertEqual(bound, text)

    def test_legacy_prior_and_checkpoint_bytes_are_not_repaired(self):
        legacy = {'text': body('legacy'), 'metadata': {'evidence': [evidence('old')]}}
        raw = json.dumps(legacy, ensure_ascii=False)
        before = copy.deepcopy(legacy)
        out = live(Transport([evidence('fresh')], [body('new')])).run_part(
            'transport', '土地资源', {'city': 'OFFLINE城'}, {'transport': legacy})
        assembled = contract.assemble('transport', [legacy, out])
        self.assertEqual(legacy, before)
        self.assertIsNone(_checkpoint_issue(raw, 'transport', '交通网络'))
        self.assertIn('来源[1]', assembled['text'])
        self.assertNotIn('citation_frames', legacy['metadata'])

    def test_all_ordinary_stages_bind_in_both_modes_and_special_stages_do_not(self):
        stages = ('economy', 'population', 'transport', 'life', 'industry', 'competition', 'policy', 'chain')
        for stage in stages:
            for mode in ('standard', 'deep'):
                with self.subTest(stage=stage, mode=mode):
                    part = contract.get_stage(stage, mode=mode)['parts'][0]
                    runner = live(Transport([], ['claim 来源[1]']))
                    payload = runner._chat_part(stage, part, 'OFFLINE城', '', [evidence('only')], mode=mode)
                    parsed = runner._parse_part(stage, part, payload, [], {})
                    self.assertIn(ROOT + 'only', parsed['text'])
                    self.assertIn('_citation_frame', parsed)
        for stage, part in (('enterprises_1', '候选池'), ('fact_check', '经济关键数字')):
            with self.subTest(stage=stage):
                runner = live(Transport([], ['claim 来源[999]']))
                payload = runner._chat_part(stage, part, 'OFFLINE城', '', [evidence('only')])
                parsed = runner._parse_part(stage, part, payload, [], {})
                self.assertEqual(parsed['text'], 'claim 来源[999]')
                self.assertNotIn('_citation_frame', parsed)


if __name__ == '__main__':
    unittest.main()
