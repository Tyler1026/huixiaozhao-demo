"""Review scope and independent-source accounting regressions, without I/O."""
import copy
import json
import unittest

from backend.chain_weakness import _judgment, build_weakness, _planned_fact, _usable_roles
from tests.test_chain_reasoning import research, premise, CONTEXT, FALLBACK


def result_for_sources(sources):
    candidate = {
        'level': 'strong', 'dimension': 'supply', 'scope': 'local',
        'reason': '已有运行基础。', 'comparison': '仅核对实际运行。',
        'action': '复核持续运行情况。', 'missing': [], 'limitations': [],
        'enterprise_links': [], 'counter_evidence': [],
        'premises': [{'source': source, 'evidence_id': 'e_' + str(index)}
                     for index, source in enumerate(sources)],
    }
    return _judgment(candidate)


class SourceIndependenceTests(unittest.TestCase):
    def source(self, url, origin, source_id):
        return {'url': url, 'origin_id': origin, 'source_id': source_id}

    def test_same_article_different_extract_hashes_remains_single_source(self):
        rows = [self.source('https://example.com/article', 'hash-a', 'a'),
                self.source('https://example.com/article', 'hash-b', 'b')]
        self.assertEqual(result_for_sources(rows)['confidence'], 'low')

    def test_canonical_url_variants_do_not_create_independent_sources(self):
        rows = [self.source('https://example.com/article?from=one', 'hash-a', 'a'),
                self.source('https://example.com/article?from=two#part', 'hash-b', 'b')]
        self.assertEqual(result_for_sources(rows)['confidence'], 'low')

    def test_reprints_with_same_origin_remain_single_source(self):
        rows = [self.source('https://example.com/original', 'same-origin', 'a'),
                self.source('https://another.example.com/reprint', 'same-origin', 'b')]
        self.assertEqual(result_for_sources(rows)['confidence'], 'low')

    def test_url_and_origin_links_are_transitive(self):
        rows = [self.source('https://example.com/original', 'origin-a', 'a'),
                self.source('https://another.example.com/reprint', 'origin-b', 'b'),
                self.source('https://example.com/original', 'origin-b', 'c')]
        for order in (rows, rows[::-1], [rows[1], rows[2], rows[0]]):
            self.assertEqual(result_for_sources(order)['confidence'], 'low')

    def test_distinct_urls_and_origins_keep_multiple_source_confidence(self):
        rows = [self.source('https://example.com/a', 'origin-a', 'a'),
                self.source('https://another.example.com/b', 'origin-b', 'b')]
        self.assertEqual(result_for_sources(rows)['confidence'], 'medium')


class TechnicalProductContextTests(unittest.TestCase):
    def test_target_product_is_not_a_future_production_target(self):
        description = '一次性生物反应袋是细胞生长并生成目标产物的载体。'
        activity = '企业采用进口膜材，在生产环境下进行生产和验证。'
        source = {'quote': description + activity, 'title': '一次性生物反应袋', 'source_type': 'company'}
        self.assertFalse(_planned_fact(description, source))
        self.assertFalse(_planned_fact(activity, source))
        self.assertIn('industry_fact', _usable_roles(description, source, CONTEXT))
        self.assertNotIn('operation', _usable_roles(description, source, CONTEXT))
        self.assertIn('dependency', _usable_roles(activity, source, CONTEXT))

    def test_real_capacity_target_remains_planned(self):
        sentence = '目标在未来形成生物反应袋生产能力，计划采用国产膜材。'
        source = {'quote': sentence, 'title': '建设计划', 'source_type': 'company'}
        self.assertTrue(_planned_fact(sentence, source))
        self.assertNotIn('industry_fact', _usable_roles(sentence, source, CONTEXT))


class ReviewScopeTests(unittest.TestCase):
    def run_review(self, verdict):
        name = '飞控系统产线'
        bundle = research(['闵行区企业青松科技有限公司已建成飞控系统产线，相关设施情况由该企业披露。'])
        chain = {'chain': [{'nodes': [{'id': 'line', 'name': name}]}], 'unclassified': []}
        row = {'node_id': 'line', 'level': 'strong', 'dimension': 'maturity', 'scope': 'local_enterprise',
               'premises': [premise(bundle, 'operation', subject=name),
                            premise(bundle, 'local_affiliation', subject='青松科技有限公司')],
               'counter_evidence': [], 'reason': '同主体原文披露该产线已建成，仅说明企业已有设施基础。',
               'comparison': '以该设施是否建成为基准，不认定已量产或稳定交付。',
               'action': '核实产线运行状态。', 'missing': [], 'limitations': ['未确认工厂实际所在地或投产情况。']}
        calls = []
        def complete(system, payload, tokens):
            data = json.loads(payload)
            calls.append((system, data))
            if 'proposals' not in data:
                return {'nodes': [row]}
            return {'verdicts': [{'node_id': 'line', 'valid': verdict,
                                  'reason': '独立核对同一企业与设施建成的有限主张。'}]}
        result = build_weakness(CONTEXT, bundle, chain, copy.deepcopy(FALLBACK), complete)
        return result, calls

    def test_facility_support_review_distinguishes_enterprise_from_factory_location(self):
        result, calls = self.run_review(True)
        self.assertEqual(len(calls), 2)
        prompt, payload = calls[1]
        self.assertIn('不要求其生产设施位于本地', prompt)
        self.assertIn('不表示供需充足', prompt)
        self.assertIn('不能由建成推导', prompt)
        self.assertIn('另一企业的量产材料不能补作该企业证据', prompt)
        self.assertEqual(payload['proposals'][0]['scope'], 'local_enterprise')
        self.assertEqual(payload['proposals'][0]['dimension'], 'maturity')
        self.assertEqual(result['node_judgments']['line']['level'], 'strong')
        self.assertEqual(result['node_judgments']['line']['scope'], 'local_enterprise')

    def test_independent_rejection_is_still_respected(self):
        result, calls = self.run_review(False)
        self.assertEqual(len(calls), 2)
        self.assertEqual(result['node_judgments']['line']['level'], 'unknown')
        self.assertFalse(result['review_diagnostics'][0]['valid'])


if __name__ == '__main__':
    unittest.main()
