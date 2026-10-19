"""Summary text accepts structured KB records without leaking their metadata."""
import ast
import copy
from pathlib import Path
import re
import unittest


class SummaryItemTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'server.py').read_text())
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name in {'_clean_kb_text', '_is_junk_item'}]
        cls.functions = {'_re': re}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'real-summary-helpers', 'exec'), cls.functions)

    def test_structured_and_legacy_text_have_the_same_summary(self):
        value = {'text': '闵行区现有装备生产企业，产品配套能力有待进一步核实。来源：https://example.gov.cn/fact',
                 'source': 'original.pdf', 'metadata': {'private': 'do not summarize this'}}
        before = copy.deepcopy(value)
        clean = self.functions['_clean_kb_text']
        self.assertEqual(clean(value), clean(value['text']))
        self.assertNotIn('private', clean(value))
        self.assertFalse(self.functions['_is_junk_item'](clean(value)))
        self.assertEqual(value, before)

    def test_invalid_values_are_empty_and_never_reach_regex(self):
        for value in (None, 12345, [], {}, {'text': {}}, {'text': ['nested']}, {'metadata': 'not text'}):
            with self.subTest(value=value):
                cleaned = self.functions['_clean_kb_text'](value)
                self.assertEqual(cleaned, '')
                self.assertTrue(self.functions['_is_junk_item'](cleaned))
                self.assertTrue(self.functions['_is_junk_item'](value))

    def test_structured_headers_still_use_existing_junk_filter(self):
        cleaned = self.functions['_clean_kb_text']({'text': '2026年经济数据报告'})
        self.assertTrue(self.functions['_is_junk_item'](cleaned))


if __name__ == '__main__':
    unittest.main()
