"""Facts survive absent judgments without inventing capability or identity."""
import copy
import unittest

from backend.chain_facts import attach_source_statements
from backend.topic_chain import normalize_chain_plan
from test_topic_chain import CONTEXT, research, plan, nodes


class ChainFactsTests(unittest.TestCase):
    def fixture(self):
        old = research(['闵行区计划推进商业火箭总装测试平台建设，相关项目建设条件仍需逐项核实。'])
        result = normalize_chain_plan(plan(old, ['商业火箭总装测试']), old, CONTEXT)
        return old, result

    def test_later_original_survives_unknown_without_changing_status(self):
        old, result = self.fixture()
        extra = research([old['evidence'][0]['quote'],
                          '商业火箭总装测试平台已经建成，原文尚未披露该平台的实际产量与具体生产企业。'])
        before = copy.deepcopy(nodes(result)[0])
        attach_source_statements(result, extra, CONTEXT)
        node = nodes(result)[0]
        self.assertEqual(node['status'], before['status'])
        self.assertEqual(node['level'], 'unknown')
        self.assertEqual(node['local_leaders'], [])
        self.assertEqual(len(node['facts']), 2)
        self.assertEqual({f['statement'] for f in node['facts']}, {r['quote'] for r in extra['evidence']})
        self.assertEqual(len(node['sources']), 2)
        self.assertEqual(len(result['sources']), 2)
        self.assertTrue(all(f['scope'] == 'source_statement_only' for f in node['facts']))
        self.assertEqual(node['facts'][0]['published_at'], extra['evidence'][0]['published_at'])

    def test_no_hash_no_fact_and_supplied_fact_text_is_removed(self):
        original, result = self.fixture()
        nodes(result)[0]['facts'] = [{'statement': '此地已经量产，全球领先'}]
        original['sources'] = {}
        attach_source_statements(result, original, CONTEXT)
        self.assertEqual(nodes(result)[0]['facts'], [])

    def test_wrong_topic_or_place_cannot_attach(self):
        original, result = self.fixture()
        original['city'] = '其他区'
        attach_source_statements(result, original, CONTEXT)
        self.assertEqual(nodes(result)[0]['facts'], [])

    def test_counterevidence_and_plan_stay_literal_without_becoming_a_rating(self):
        _, result = self.fixture()
        original = research(['商业火箭总装测试平台尚未建成，计划何时落实仍待确认，不能视为现有生产能力。'])
        attach_source_statements(result, original, CONTEXT)
        node = nodes(result)[0]
        self.assertEqual(node['facts'][0]['statement'], original['evidence'][0]['quote'])
        self.assertEqual(node['level'], 'unknown')
        self.assertEqual(result['edges'], [])

    def test_unrelated_domain_does_not_borrow_a_shared_component(self):
        bundle = research(['商业火箭使用传感器进行测量，具体供货企业和产能信息尚未披露。'])
        result = normalize_chain_plan(plan(bundle, ['传感器']), bundle, CONTEXT)
        extra = research(['生物医药生产设备使用传感器进行测量，具体产品规格及企业信息尚未披露。'])
        attach_source_statements(result, extra, CONTEXT)
        self.assertEqual(nodes(result)[0]['facts'], [])

    def test_typographic_matching_keeps_original_text(self):
        bundle = research(['低空航空器的 eVTOL 系统开展测试，尚未披露量产与交付结果。'], topic='低空经济')
        context = dict(CONTEXT, topic='低空经济')
        result = normalize_chain_plan(plan(bundle, ['eVTOL']), bundle, context)
        attach_source_statements(result, bundle, context)
        self.assertEqual(nodes(result)[0]['facts'][0]['statement'], bundle['evidence'][0]['quote'])


if __name__ == '__main__':
    unittest.main()
