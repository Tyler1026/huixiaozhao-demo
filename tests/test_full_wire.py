"""Offline round-trip checks for decision-stage model input serialization."""
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from report_service.full_wire import render_structured  # noqa: E402


def _payloads(rendered):
    return [json.loads(line.split(': ', 1)[1]) for line in rendered.splitlines()]


def _recover(payload):
    if 'records' in payload:
        return payload['records']
    return [dict(zip(payload['fields'], row)) for row in payload['rows']]


class FullWireTests(unittest.TestCase):
    def test_uniform_records_round_trip_all_fields_values_and_record_order(self):
        records = [
            {'name': '企业甲', 'direction': 'dir1', 'nullable': None,
             'extra_unknown': {'items': [True, 0, 3.125, '原始值\n尾部']},
             'dimensions': {'risk': 4.5, 'market': 8}},
            {'name': '企业乙', 'direction': 'dir2', 'nullable': '待核实',
             'extra_unknown': {'items': [False, -2, [], {'原字段': '完整'}]},
             'dimensions': {'risk': 9, 'market': 6.5}},
        ]
        original = copy.deepcopy(records)
        payload = _payloads(render_structured({'scores': records}))[0]
        self.assertEqual(payload['fields'], list(records[0]))
        self.assertEqual(_recover(payload), original)
        self.assertEqual(records, original)

    def test_same_field_set_with_different_dict_order_keeps_every_mapping_value(self):
        records = [{'name': '甲', 'unknown': None}, {'unknown': ['原值'], 'name': '乙'}]
        original = copy.deepcopy(records)
        payload = _payloads(render_structured({'selected': records}))[0]
        self.assertIn('fields', payload)
        self.assertEqual(_recover(payload), original)
        self.assertEqual([list(record) for record in records], [list(record) for record in original])

    def test_heterogeneous_records_preserve_missing_versus_null_and_unknown_fields(self):
        records = [{'name': '甲'}, {'name': '乙', 'optional': None},
                   {'name': '丙', 'unknown_extra': {'nested': [1, None]}}]
        payload = _payloads(render_structured({'selected': records}))[0]
        self.assertEqual(payload, {'records': records})
        recovered = _recover(payload)
        self.assertNotIn('optional', recovered[0])
        self.assertIn('optional', recovered[1])
        self.assertIsNone(recovered[1]['optional'])

    def test_non_dictionary_records_use_the_complete_original_list(self):
        records = [{'name': '甲'}, None, ['完整原数组', 2], '原字符串', False, 7]
        payload = _payloads(render_structured({'checks': records}))[0]
        self.assertEqual(payload, {'records': records})

    def test_unicode_quotes_literal_newlines_and_backslashes_are_exact(self):
        records = [{'name': '原企业“甲”', 'value': '真实换行\n尾部; 字面\\n; "引号"; \\路径'}]
        payload = _payloads(render_structured({'candidates': records}))[0]
        self.assertEqual(_recover(payload), records)

    def test_all_entity_lists_and_empty_lists_are_preserved_in_label_order(self):
        metadata = {key: [{'unknown_field': key}] for key in
                    ('scores', 'checks', 'selected', 'candidates', 'directions')}
        original = copy.deepcopy(metadata)
        recovered = [_recover(payload) for payload in _payloads(render_structured(metadata))]
        self.assertEqual(recovered, [metadata[key] for key in
                                    ('directions', 'candidates', 'selected', 'checks', 'scores')])
        self.assertEqual(metadata, original)
        self.assertEqual(_recover(_payloads(render_structured({'selected': []}))[0]), [])
        self.assertEqual(render_structured(None), '')

    def test_complete_seventy_five_company_fixture_saves_at_least_eight_thousand_characters(self):
        records = [{'name': f'OFFLINE企业{index}', 'url': f'https://cninfo.com.cn/offline/{index}',
                    'landing_status': '待核实', 'segment': '完整产业环节',
                    'reason': '完整初筛理由', 'rationale': '完整匹配理由',
                    'expansion_evidence': '完整扩产事实与待核实缺口', 'expansion_date': '2026-09-01',
                    'uncertainty': '完整风险说明', 'evidence_ref': f'https://cninfo.com.cn/offline/source/{index}'}
                   for index in range(75)]
        original = copy.deepcopy(records)
        old = '\n'.join('- 精选企业: ' + json.dumps(record, ensure_ascii=False) for record in records)
        compact = render_structured({'selected': records})
        self.assertEqual(_recover(_payloads(compact)[0]), records)
        self.assertEqual(records, original)
        self.assertGreaterEqual(len(old) - len(compact), 8_000)


if __name__ == '__main__':
    unittest.main()
