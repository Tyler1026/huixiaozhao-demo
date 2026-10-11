"""Current-topic chain nodes require an exact saved source sentence."""
import unittest

from backend.evidence_grounding import evidence_catalog, ground_chain


class ChainTopicScopeTests(unittest.TestCase):
    def setUp(self):
        self.context = {'topic': '核电换热设备', 'city': '闵行区'}
        self.catalog = evidence_catalog([
            {'id': 'right', 'topic': '核电换热设备', 'text': '闵行区甲企业从事核级换热器研发，该环节状态待核。来源 https://official.example/nuclear'},
            {'id': 'other', 'topic': '生物医药', 'text': '生物医药出海环节是本地核心优势。来源 https://official.example/biotech'},
            {'id': 'base', 'topic': '企业', 'text': '商业火箭生产服务项目列入研究资料。来源 https://official.example/rocket'},
            {'id': 'no-url', 'topic': '核电换热设备', 'text': '铸锻环节可能需要进一步补充公开资料。'},
        ])

    def node(self, name, source=None):
        return {'name': name, 'level': 'strong', 'local_leaders': ['甲企业'],
                'evidence_ids': [source['id']] if source else []}

    def test_current_topic_exact_sentence_and_url_survives_as_pending(self):
        result = ground_chain([{'seg': '中游', 'nodes': [self.node('核级换热器', self.catalog[0])]}], self.catalog, self.context)
        self.assertEqual([item['seg'] for item in result], ['上游', '中游', '下游'])
        node = result[1]['nodes'][0]
        self.assertEqual(node['name'], '核级换热器')
        self.assertEqual(node['level'], 'unknown')
        self.assertEqual(node['urls'], ['https://official.example/nuclear'])
        self.assertEqual(node['local_leaders'], [])

    def test_other_topic_base_topic_unlinked_or_invented_names_are_removed(self):
        names = [self.node('生物医药出海环节', self.catalog[1]),
                 self.node('商业火箭', self.catalog[2]),
                 self.node('铸锻环节', self.catalog[3]),
                 self.node('高端植介入医疗器械下游终端医疗服务', self.catalog[0])]
        result = ground_chain([{'seg': '上游', 'nodes': names}], self.catalog, self.context)
        self.assertTrue(all(not item['nodes'] for item in result))

    def test_no_id_fallback_cannot_escape_current_topic_filter(self):
        result = ground_chain([{'seg': '上游', 'nodes': [self.node('生物医药出海环节')]}], self.catalog, self.context)
        self.assertTrue(all(not item['nodes'] for item in result))

    def test_empty_is_completed_material_gap_but_invalid_schema_is_rejected(self):
        self.assertEqual(ground_chain([], self.catalog, self.context), [{'seg': name, 'nodes': []} for name in ('上游', '中游', '下游')])
        for bad in ({}, [{'seg': '其他', 'nodes': []}], [{'seg': '上游', 'nodes': 'invalid'}]):
            with self.assertRaises(ValueError):
                ground_chain(bad, self.catalog, self.context)


if __name__ == '__main__':
    unittest.main()
