"""Final deliverables separate cited analysis from the confirmation workflow."""
import copy
import unittest

from backend.topic_reports import build_report, normalize_plan, render_report
from test_topic_report_pipeline import bundle, plan


class FinalReportPresentationTests(unittest.TestCase):
    def test_final_omits_workflow_sections_but_preserves_questions_in_plan(self):
        context = {'city': '闵行区', 'topic': '氢能', 'confirmations': [
            {'text': '用户填写的未核实声明：已经确定采购订单', 'status': 'confirmed'}]}
        result = build_report(context, bundle(), 2, lambda *args: plan())
        for phrase in ('沿用前文原始证据', '同一材料不重复', '本轮确认输入',
                       '证据与核验边界', '待确认事项', '- ⚠️', '用户填写的未核实声明'):
            self.assertNotIn(phrase, result['text'])
        self.assertIn('## 五、实施建议', result['text'])
        self.assertIn('组织供需对接', result['text'])
        self.assertEqual(len(result['plan']['questions']), 3)
        self.assertTrue(result['sources'])

    def test_draft_keeps_the_original_confirmation_workflow(self):
        result = build_report({'city': '闵行区', 'topic': '氢能'}, bundle(), 1,
                              lambda *args: plan())
        self.assertIn('## 三、待确认事项', result['text'])
        self.assertEqual(result['text'].count('- ⚠️ '), 3)
        self.assertIn('[来源 S1]', result['text'])

    def test_reused_passage_is_printed_once_with_a_stable_document_reference(self):
        research = bundle()
        raw = plan()
        raw['chain'] = raw['basis'][:]
        original = copy.deepcopy(research)
        result = build_report({'city': '闵行区', 'topic': '氢能'}, research, 2,
                              lambda *args: raw)
        quote = research['evidence'][0]['quote']
        self.assertEqual(result['text'].count(quote), 1)
        self.assertGreaterEqual(result['text'].count('[1](https://www.shanghai.gov.cn/energy)'), 2)
        self.assertEqual(research, original)
        self.assertEqual(result['sources'][0]['quote'], quote)
        self.assertEqual(result['sources'][0]['label'], '1')

    def test_different_passages_in_one_document_share_one_bibliography_item(self):
        research = bundle()
        research['evidence'][1]['url'] = research['evidence'][0]['url'] + '#page=2'
        result = build_report({'city': '闵行区', 'topic': '氢能'}, research, 2,
                              lambda *args: plan())
        bibliography = result['text'].split('## 参考文献', 1)[1]
        self.assertEqual(bibliography.count('[1]'), 1)
        self.assertNotIn('[2]', bibliography)
        self.assertEqual({row['label'] for row in result['sources']}, {'1'})
        for row in research['evidence']:
            self.assertIn(row['quote'], result['text'])

    def test_verified_inference_is_the_action_and_keeps_its_scope(self):
        research = bundle()
        cleaned = normalize_plan(plan(), research)
        ids = [row['id'] for row in research['evidence']]
        cleaned['analytical_priorities'] = [{
            'state': 'reviewed_inference', 'scope': 'industry', 'focus': '储氢材料',
            'evidence_ids': ids, 'comparison': '研究计划与实际供给有阶段差异。',
            'reason': '仅能说明研究方向，不能认定本地供应不足。',
            'action': '围绕材料验证条件组织研发对接。', 'supply_ids': [ids[0]],
            'demand_ids': [], 'constraint_ids': [], 'counter_ids': [ids[1]],
        }]
        text, sources = render_report(cleaned, {'city': '闵行区', 'topic': '氢能'}, research, 2)
        self.assertIn('行业共性，非本地缺失', text)
        self.assertIn('围绕材料验证条件组织研发对接。', text.split('## 五、实施建议')[1])
        self.assertIn('不能认定本地供应不足', text)
        self.assertEqual(len(sources), 2)

    def test_unknown_source_status_is_not_promoted_by_final_presentation(self):
        research = bundle()
        for row in research['evidence']:
            row['support_status'] = 'single_source'
        result = build_report({'city': '闵行区', 'topic': '氢能'}, research, 2,
                              lambda *args: plan())
        self.assertEqual({row['support_status'] for row in result['sources']}, {'single_source'})
        self.assertNotIn('已独立核实', result['text'])


if __name__ == '__main__':
    unittest.main()
