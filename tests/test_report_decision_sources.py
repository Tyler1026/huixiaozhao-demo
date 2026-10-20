"""Bibliography presentation must not remove a submitted decision's proof."""
import unittest

from backend.topic_reports import normalize_plan, render_report, _distinct_priorities
from test_topic_report_pipeline import bundle, plan


class DecisionSourceTests(unittest.TestCase):
    def test_existing_demand_identity_has_one_reviewed_type_without_merging_claims(self):
        planned = {'scope': 'local', 'focus': '储氢设备', 'opportunity_type': 'planned_development',
                   'state': 'reviewed_inference', 'evidence_ids': ['plan']}
        actual = dict(planned, opportunity_type='constraint', evidence_ids=['actual'])
        other = dict(planned, scope='industry', evidence_ids=['industry'])
        selected = _distinct_priorities([planned, actual, other, dict(actual)])
        self.assertEqual(selected, [actual, other])
        self.assertEqual(selected[0]['evidence_ids'], ['actual'])
        self.assertEqual(planned['evidence_ids'], ['plan'])

    def test_uncited_decision_source_is_retained_without_extra_bibliography_entry(self):
        research = bundle()
        selected = normalize_plan(plan(), research)
        first, second = [row['id'] for row in research['evidence']]
        selected['composition'] = {'status': 'reviewed', 'chapters': [
            {'id': cid, 'paragraphs': [{'kind': 'analysis',
              'text': '在原文所述范围内安排具体产品对接。', 'evidence_ids': [first]}]}
            for cid in ('basis', 'chain', 'priorities', 'companies', 'actions')]}
        text, sources = render_report(selected, {'city': '闵行区', 'topic': '氢能'}, research, 2)
        by_id = {row['id']: row for row in sources}
        self.assertIn(second, by_id)
        self.assertEqual(by_id[second]['quote'], research['evidence'][1]['quote'])
        self.assertFalse(by_id[second]['cited_in_report'])
        self.assertNotIn(research['evidence'][1]['url'], text)
        self.assertEqual(text.count('．[原文]('), 1)


if __name__ == '__main__':
    unittest.main()
