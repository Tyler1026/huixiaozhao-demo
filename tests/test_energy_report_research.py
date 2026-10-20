"""Whole-source, branch-balanced retrieval for the compound energy direction."""
import hashlib
import unittest

from backend.topic_research import research_topic, search_plan, select_source_paragraphs
from test_topic_research import FakeSearch


TOPIC = '氢基能源与长时储能装备补链'


class BranchedSearch(FakeSearch):
    def _search(self, query, count):
        self.calls.append(query)
        branch = 'hydrogen' if '氢能 制氢' in query else 'storage'
        term = '储氢设备' if branch == 'hydrogen' else '液流电池'
        if '现有企业' in query:
            paragraphs = [f'本地{term}制造企业已形成第{i}类产品的生产和交付能力，并披露了适用条件和客户验证记录。' for i in range(3)]
            rows = [{'url': f'https://www.shanghai.gov.cn/{branch}-supply-{index}',
                     'title': f'闵行区{term}企业资料', 'publishedDate': '2026-05-01',
                     'text': '\n\n'.join(paragraphs).replace('第0类', f'第{index}类')}
                    for index in range(5)]
        else:
            role, text = ('constraint', f'{term}当前仍存在材料成本偏高和产品验证周期较长的问题，不同应用场景的适配条件存在差异。') if '成本 效率' in query else (
                ('demand', f'当地{term}项目已公开采购需求，产品规格、应用方式和交付条件需要根据实际项目进一步对接。') if '项目 应用' in query else
                ('planning', f'闵行区产业规划提出发展{term}制造和应用服务，支持相关企业完善产品验证体系并开展示范项目。'))
            rows = [{'url': f'https://www.shanghai.gov.cn/{branch}-{role}',
                     'title': f'闵行区{term}资料', 'publishedDate': '2026-05-01', 'text': text}]
        return {'results': rows}


class EnergyReportResearchTests(unittest.TestCase):
    def test_queries_split_technical_branches_and_roles_without_private_input(self):
        queries = search_plan('闵行区', TOPIC, 'full')
        self.assertEqual(len(queries), 8)
        self.assertTrue(all(TOPIC not in query for query in queries))
        self.assertEqual(sum('氢能 制氢' in query for query in queries), 4)
        self.assertEqual(sum('长时储能 液流电池' in query for query in queries), 4)
        for role in ('现有企业', '成本 效率', '项目 应用', '产业规划'):
            self.assertEqual(sum(role in query for query in queries), 2)
        self.assertTrue(all('闵行区' not in query for query in queries if '成本 效率' in query))
        self.assertTrue(all('闵行区' in query for query in queries if '现有企业' in query or '产业规划' in query))

    def test_complete_material_constraint_uses_specific_research_title_context(self):
        quote = '非氟离子膜的长期化学稳定性仍需大量工程实践验证。'
        rows = select_source_paragraphs(quote, TOPIC, source_title='液流电池关键材料发展研究')
        self.assertEqual([row['quote'] for row in rows], [quote])
        self.assertEqual(rows[0]['research_branches'], ['long_duration'])
        self.assertEqual(rows[0]['topic_context'], 'source_title')
        self.assertEqual(select_source_paragraphs(quote, TOPIC, source_title='无关材料研究'), [])

    def test_later_constraints_demand_and_plans_survive_supply_saturation(self):
        provider = BranchedSearch()
        result = research_topic('闵行区', TOPIC, mode='full', provider=provider,
                                questions=['私人客户报价与联系电话'], basis=['保密材料'])
        self.assertEqual(result['status'], 'ready')
        self.assertLessEqual(len(result['evidence']), 20)
        self.assertEqual(len(provider.calls), 8)
        self.assertTrue(all('私人' not in query and '保密' not in query for query in provider.calls))
        for branch in ('hydrogen', 'long_duration'):
            rows = [row for row in result['evidence'] if branch in row['research_branches']]
            for role in ('supply', 'constraint', 'demand', 'planning'):
                self.assertTrue(any(role in row['research_roles'] for row in rows), (branch, role))
        for row in result['evidence']:
            original = result['sources'][row['source_id']]
            self.assertIn(row['quote'], original['fulltext'])
            self.assertEqual(original['fulltext_sha256'], hashlib.sha256(original['fulltext'].encode()).hexdigest())
            self.assertEqual(row['published_at'], '2026-05-01')

    def test_generic_lithium_battery_paragraph_does_not_become_long_duration_evidence(self):
        lithium = '该储能锂离子电池企业已完成电芯扩产，新能源汽车动力电池销量保持增长，产品主要用于乘用车。'
        hydrogen = '闵行区储氢设备企业已完成新产品验证，并披露适用条件、客户应用场景和后续产品升级方向。'
        storage = '长时储能液流电池采用不同的电解液和电堆系统，当前已开展材料稳定性及工程应用条件验证。'
        rows = select_source_paragraphs('\n\n'.join((lithium, hydrogen, storage)), TOPIC)
        self.assertNotIn(lithium, [row['quote'] for row in rows])
        self.assertEqual({row['quote'] for row in rows}, {hydrogen, storage})

    def test_original_research_is_accepted_but_arbitrary_edu_and_media_are_not(self):
        quote = '液流电池非氟离子交换膜的长期化学稳定性仍需工程实践验证，相关产品需与实际运行工况结合开展研究。'
        rows = [
            {'url': 'https://www.engineering.org.cn/sscae/CN/10.15302/J-SSCAE-2025.10.021',
             'title': '液流电池关键材料发展研究', 'text': quote},
            {'url': 'https://unverified.edu.cn/article', 'title': '未经核对的转载', 'text': quote},
            {'url': 'https://news.example.com/article', 'title': '媒体转载', 'text': quote},
        ]
        result = research_topic('闵行区', TOPIC, mode='full', provider=FakeSearch(rows))
        self.assertEqual(len(result['evidence']), 1)
        self.assertEqual(result['evidence'][0]['source_type'], 'research')
        self.assertIn('engineering.org.cn', result['evidence'][0]['url'])


if __name__ == '__main__': unittest.main()
