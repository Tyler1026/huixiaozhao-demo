"""Offline regressions for abbreviations before new candidate checkpoints."""
import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from report_service.company_identity import candidate_identity, company_identity
from report_service.full_context import scoring_prior_batches
from report_service.full_contract import SCORING_WEIGHTS, assemble
from report_service.full_provider import FullLiveProvider, FullProviderError


BASE = '无锡雪浪数制科技有限公司'
OTHER = '无锡飞而康快速制造科技有限责任公司'
URL = 'https://www.gov.cn/offline-company-source'


def company(name):
    return {'name': name, 'url': URL, 'landing_status': '待核实',
            'expansion_evidence': '待核实', 'reason': 'OFFLINE identity fixture'}


class CandidateAbbreviationIdentityTests(unittest.TestCase):
    def test_actual_full_legal_names_and_abbreviations_compare_equal(self):
        for base, abbreviation in ((BASE, '雪浪数制'), (OTHER, '飞而康')):
            plain, annotated = company(base), company(base + '（' + abbreviation + '）')
            for known in ([plain, annotated], [annotated, plain]):
                before = copy.deepcopy(known)
                self.assertEqual(candidate_identity(plain, known), base)
                self.assertEqual(candidate_identity(annotated, known), base)
                self.assertEqual(known, before)
                self.assertNotEqual(company_identity(annotated, known), base)

    def test_labelled_abbreviation_and_nfkc_are_explicit(self):
        for note in ('简称：雪浪数制', '以下简称“雪浪数制”', '简称 "雪浪数制"'):
            self.assertEqual(candidate_identity(company(BASE + '（' + note + '）')), BASE)

    def test_unlabelled_fragment_without_known_exact_base_stays_separate(self):
        annotated = company(BASE + '（雪浪数制）')
        self.assertEqual(candidate_identity(annotated, [annotated]), company_identity(annotated))

    def test_geography_units_ownership_stock_and_unrelated_aliases_stay_separate(self):
        names = [
            '甲科技（上海）有限公司', '甲科技（北京）有限公司',
            BASE + '（上海）', BASE + '（江苏省）', BASE + '（苏州市）',
            BASE + '（内蒙古）', BASE + '（核电业务）', BASE + '（数制事业部）',
            BASE + '（上海子公司）', BASE + '（上海分公司）',
            BASE + '（母公司）', BASE + '（隶属中材科技）',
            BASE + '（新能源）', BASE + '（601399）', BASE + '（603259.SH）',
            BASE + '（完全不同品牌）', BASE + '（简称：核电业务）',
        ]
        known = [company(BASE)] + [company(name) for name in names]
        for record in known[1:]:
            with self.subTest(name=record['name']):
                self.assertEqual(candidate_identity(record, known), company_identity(record, known))

    def test_ambiguous_short_word_needs_own_source_explicit_declaration(self):
        base = '上海甲乙科技有限公司'
        record = company(base + '（甲乙）')
        known = [company(base), record]
        source = {'url': URL, 'excerpt': base + '（以下简称“甲乙”）发布公告。'}
        self.assertEqual(candidate_identity(record, known), company_identity(record, known))
        self.assertEqual(candidate_identity(record, known, [source]), base)
        self.assertEqual(candidate_identity(record, known, [dict(source, url=URL + '/other')]),
                         company_identity(record, known))
        self.assertEqual(candidate_identity(record, known, [{'url': URL}]), company_identity(record, known))

    def test_actual_geographic_and_business_fragments_are_not_used_as_plain_aliases(self):
        for base, note in (
                ('上海雪浪科技有限公司', '上海'),
                ('江苏省苏州市雪浪科技有限公司', '苏州市'),
                ('无锡新能源科技有限公司', '新能源'),
                ('无锡智能制造科技有限公司', '智能制造'),
                ('无锡飞而康制造中心有限公司', '制造中心')):
            record = company(base + '（' + note + '）')
            known = [company(base), record]
            self.assertEqual(candidate_identity(record, known), company_identity(record, known))

    def test_existing_record_note_and_bound_business_identity_are_preserved(self):
        record = company('上海电气（聚变装备业务）')
        record['rationale'] = '业务主体为上海电气集团。'
        known = [company('上海电气集团'), record]
        self.assertEqual(candidate_identity(record, known), company_identity(record, known))
        record = company(BASE + '（融资交叉核验记录）')
        self.assertEqual(candidate_identity(record), company_identity(record))


class CandidateAbbreviationProviderTests(unittest.TestCase):
    def provider(self, initial, supplement=()):
        p = FullLiveProvider(SimpleNamespace(enabled=True, _validate_endpoints=lambda: None))
        sources = [{'url': URL, 'excerpt': 'OFFLINE完整企业身份检索资料，仅用于离线测试。'}]
        p._gather_evidence = Mock(return_value=sources)
        p._chat_part = Mock(side_effect=[json.dumps({
            'text': '\n'.join(f'首次完整独立候选研究事项{i}' for i in range(100)),
            'candidates': initial, 'selected': [],
        }, ensure_ascii=False), json.dumps({
            'text': '\n'.join(f'补充独立候选身份研究事项{i}' for i in range(100)),
            'candidates': list(supplement), 'selected': [],
        }, ensure_ascii=False)])
        return p, sources

    def test_saved_plain_names_trigger_one_bounded_supplement_for_both_real_aliases(self):
        saved = [company(BASE), company(OTHER)]
        initial = [company(BASE + '（雪浪数制）'), company(OTHER + '（飞而康）')]
        new = [company(f'离线独立候选{i}有限公司') for i in range(5)]
        initial += new[:3]
        p, sources = self.provider(initial, new[3:])
        prior = {'enterprises_1': {'text': '既存企业研究保留不动。',
                 'metadata': {'candidates': saved, 'selected': copy.deepcopy(saved),
                              'evidence': sources}}}
        before = copy.deepcopy(prior)
        out = p.run_part('enterprises_1', '候选池2', {'city': '测试区', 'mode': 'standard'}, prior)
        self.assertEqual([c['name'] for c in out['metadata']['candidates']],
                         [c['name'] for c in new])
        self.assertEqual(out['metadata']['candidates'][0]['reason'], initial[2]['reason'])
        self.assertEqual(prior, before)
        self.assertEqual(p._chat_part.call_count, 2)
        self.assertEqual(p._gather_evidence.call_count, 2)
        self.assertEqual(p._gather_evidence.call_args.kwargs['candidate_missing'], 2)
        self.assertEqual(out['metadata']['selected'], [])

    def test_reverse_saved_alias_and_new_plain_name_is_also_rejected(self):
        saved = [company(BASE + '（雪浪数制）')]
        initial = [company(BASE)] + [company(f'独立候选{i}有限公司') for i in range(4)]
        p, sources = self.provider(initial, [company('补足独立候选有限公司')])
        prior = {'enterprises_1': {'metadata': {'candidates': saved, 'evidence': sources}}}
        out = p.run_part('enterprises_1', '候选池2', {'city': '测试区'}, prior)
        self.assertNotIn(BASE, [c['name'] for c in out['metadata']['candidates']])
        self.assertEqual(p._gather_evidence.call_args.kwargs['candidate_missing'], 1)

    def test_same_batch_alias_gets_replaced_without_renaming_accepted_first_record(self):
        annotated = company(BASE + '（雪浪数制）')
        initial = [annotated, company(BASE)] + [company(f'独立候选{i}有限公司') for i in range(3)]
        p, _ = self.provider(initial, [company('补足独立候选有限公司')])
        out = p.run_part('enterprises_1', '候选池', {'city': '测试区'}, {})
        self.assertEqual(out['metadata']['candidates'][0]['name'], annotated['name'])
        self.assertEqual(len(out['metadata']['candidates']), 5)
        self.assertEqual(p._chat_part.call_count, 2)

    def test_duplicate_supplement_is_still_rejected_by_original_new_company_gate(self):
        initial = [company(BASE), company(BASE + '（雪浪数制）')]
        initial += [company(f'独立候选{i}有限公司') for i in range(3)]
        p, _ = self.provider(initial, [company(BASE + '（简称：雪浪数制）')])
        with self.assertRaisesRegex(FullProviderError, 'five new grounded companies'):
            p.run_part('enterprises_1', '候选池', {'city': '测试区'}, {})
        self.assertEqual(p._chat_part.call_count, 2)
        self.assertEqual(p._gather_evidence.call_count, 2)

    def test_missing_source_does_not_trigger_supplement_or_bypass_original_guard(self):
        initial = [company(BASE), company(BASE + '（雪浪数制）')]
        initial += [company(f'独立候选{i}有限公司') for i in range(3)]
        initial[0]['url'] = 'https://unretrieved.invalid/company'
        p, _ = self.provider(initial)
        with self.assertRaisesRegex(FullProviderError, 'retrieved source URL'):
            p.run_part('enterprises_1', '候选池', {'city': '测试区'}, {})
        self.assertEqual(p._chat_part.call_count, 1)

    def test_existing_selection_assembly_and_scoring_keep_all_original_identities(self):
        names = [BASE, BASE + '（雪浪数制）', OTHER, OTHER + '（飞而康）']
        names += [f'既存独立企业{i}有限公司' for i in range(11)]
        selected = [company(name) for name in names]
        prior = {f'enterprises_{d}': {'metadata': {'candidates': copy.deepcopy(selected),
                                                 'selected': copy.deepcopy(selected)}}
                 for d in (1, 2, 3)}
        before = copy.deepcopy(prior)
        assembled = assemble('enterprises_1', [prior['enterprises_1']])
        self.assertEqual([c['name'] for c in assembled['metadata']['selected']], names)
        p, _ = self.provider([])
        records = [{'name': name, 'direction': f'dir{d}',
                    'dimensions': {key: 5 for key in SCORING_WEIGHTS}}
                   for d in (1, 2, 3) for name in names]
        self.assertEqual(len(p._compute_scores('scoring', records, [], prior)), 45)
        targets = []
        for part in ('评分维度与权重', '加权计算'):
            for view in scoring_prior_batches(prior, part):
                targets += [(c['name'], f'dir{d}') for d in (1, 2, 3)
                            for c in view[f'enterprises_{d}']['metadata']['selected']]
        self.assertEqual(set(targets), {(r['name'], r['direction']) for r in records})
        self.assertEqual(len(targets), 45)
        self.assertEqual(prior, before)

    def test_saved_target_expansion_does_not_apply_new_candidate_identity_rule(self):
        selected = [company(BASE), company(BASE + '（雪浪数制）')]
        selected += [company(f'既存企业{i}有限公司') for i in range(3)]
        p, sources = self.provider([])
        meta = {'candidates': copy.deepcopy(selected), 'selected': copy.deepcopy(selected),
                'evidence': sources}
        before = copy.deepcopy(meta)
        p._validate_company_part('扩产信号', meta, {'metadata': {'candidates': selected}})
        self.assertEqual(meta, before)


if __name__ == '__main__':
    unittest.main()
