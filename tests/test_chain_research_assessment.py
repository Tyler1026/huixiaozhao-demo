"""Original diagnostic passages survive chain research without scope inflation."""
import hashlib
import json
import time
import unittest

from backend.topic_research import (
    _balanced_chain_rows, _document_title, research_topic, search_plan, select_source_paragraphs,
)
from test_topic_research import FakeSearch


TOPIC = '生物医药上游耗材国产替代招引'
BIO_DIAGNOSIS = ('然而，产业发展并不能一帆风顺。创新主体能力不足、供需对接机制不畅、'
                 '中试资源与人才短缺等问题，成为制约产业进一步发展的瓶颈。'
                 '对此，政协委员们立足实际，提出了一系列针对性建议。')
AERO_DIAGNOSIS = ('闵行已集聚航天航空“国家队”龙头企业，初步形成研发、制造、运维全链条布局，'
                  '但仍存在产业市场竞争力需不断提升、产业链上下游协同机制有待加强、'
                  '市场应用场景有待进一步培育、产业链基础设施建设有待加快等问题。'
                  '据此，九三学社区委提交了《关于加快推进闵行航空产业高质量发展的建议》，'
                  '其中提到“链衔接较松散、配套能力不足、融合度不高”等。')


class AssessmentParagraphTests(unittest.TestCase):
    def test_recover_policy_heading_from_generic_government_site_title(self):
        heading = '《关于协同打造商业航天产业集群行动方案（征求意见稿）》'
        self.assertEqual(_document_title('某区人民政府网站', '某区人民政府网站\n\n'+heading+'\n\n正文'), heading)
        self.assertEqual(_document_title('生物医药现状调研', heading), '生物医药现状调研')
        self.assertEqual(_document_title('某区人民政府网站', '正文提到'+heading+'，随后讨论'), '某区人民政府网站')

    def test_chain_queries_cover_existing_supply_and_constraints_without_private_input(self):
        queries = search_plan('闵行区', TOPIC, 'chain')
        self.assertEqual(len(queries), 9)
        self.assertIn('上游', queries[0])
        self.assertIn('中游', queries[1])
        self.assertIn('下游', queries[2])
        self.assertIn('行动方案 全文', queries[3])
        self.assertIn('规划 建成 投产 原文', queries[4])
        self.assertIn('短板 配套不足 供应缺口 外部依赖', queries[5])
        self.assertIn('本地产能 研发中试 量产 协同配套 现状', queries[6])
        self.assertIn('现有企业 生产基地 已投产 已交付', queries[7])
        self.assertNotIn('国产替代招引', queries[7])
        self.assertIn('上下游 配套产品 研发制造 已形成', queries[8])
        self.assertEqual(len(search_plan('闵行区', TOPIC, 'draft')), 3)
        self.assertEqual(len(search_plan('闵行区', TOPIC, 'full')), 5)

    def test_real_local_aerospace_diagnosis_keeps_whole_quote(self):
        rows = select_source_paragraphs(AERO_DIAGNOSIS, '商业火箭卫星配套本地化补链', mode='chain')
        self.assertEqual([r['quote'] for r in rows], [AERO_DIAGNOSIS])
        self.assertIn('评价', rows[0]['chain_facets'])
        self.assertNotIn('level', rows[0])

    def test_existing_supply_survives_a_pool_dominated_by_plans(self):
        plans = [{'id': f'plan-{i}', 'quote': '计划推进培养基项目建设及配套研发，实施进度和当地供给规模仍需要核查。',
                  'chain_facets': ['评价', '上游'], 'relevance_score': 100} for i in range(30)]
        quote = '闵行已形成生物医药产业基础，全区集聚相关企业，产业链覆盖原料药供应和医药研发等环节。'
        foundation = select_source_paragraphs(quote, TOPIC, mode='chain')[0]
        foundation['id'] = 'existing-supply'
        self.assertIn('基础', foundation['chain_facets'])
        picked = _balanced_chain_rows(plans + [foundation], 6, 4000)
        self.assertIn(foundation, picked)
        self.assertEqual(foundation['quote'], quote)

    def test_matching_industry_title_supplies_context_for_real_bio_diagnosis(self):
        rows = select_source_paragraphs(BIO_DIAGNOSIS, TOPIC, mode='chain',
                                        source_title='从现状剖析到落地行动，多方智慧共绘闵行生物医药新蓝图')
        self.assertEqual([r['quote'] for r in rows], [BIO_DIAGNOSIS])
        self.assertEqual(rows[0]['chain_facets'], ['评价', '约束'])
        self.assertEqual(rows[0]['topic_context'], 'source_title')
        self.assertTrue(rows[0]['title_match_terms'])

    def test_generic_or_other_industry_title_cannot_supply_missing_context(self):
        for title in ('上海市闵行区人民政府', '产业发展工作报告', '汽车产业创新发展情况'):
            with self.subTest(title=title):
                self.assertEqual(select_source_paragraphs(BIO_DIAGNOSIS, TOPIC,
                                  mode='chain', source_title=title), [])
        self.assertEqual(select_source_paragraphs(BIO_DIAGNOSIS, TOPIC, mode='full',
                                                  source_title='闵行生物医药产业调研'), [])

    def test_title_context_does_not_admit_explicit_other_industry_diagnosis(self):
        paragraph = '新能源汽车产业创新主体能力不足，关键零部件供给短缺，中试资源与人才短缺，相关部门将进一步研究。'
        self.assertEqual(select_source_paragraphs(paragraph, TOPIC, mode='chain',
                                                  source_title='闵行生物医药产业发展报告'), [])

    def test_title_is_not_enough_without_explicit_diagnostic_or_capability_text(self):
        paragraph = '本次会议围绕有关工作进行了充分交流，与会人员提出相关意见，主管部门将进一步汇总材料并适时公布。'
        self.assertEqual(select_source_paragraphs(paragraph, TOPIC, mode='chain',
                                                  source_title='闵行生物医药产业发展报告'), [])

    def test_capability_and_planning_are_retained_without_strength_verdict(self):
        for paragraph in ('目前已建成中试平台并投入运行，可以提供研发服务，具体开放范围和使用条件由运营方公布。',
                          '计划建设中试平台并逐步扩大产能，项目实施时间和具体服务条件仍须另行审批后公布。'):
            with self.subTest(paragraph=paragraph):
                rows = select_source_paragraphs(paragraph, TOPIC, mode='chain',
                                                source_title='闵行生物医药产业发展报告')
                self.assertEqual(rows[0]['quote'], paragraph)
                self.assertIn('评价', rows[0]['chain_facets'])
                self.assertNotIn('status', rows[0])
                self.assertNotIn('level', rows[0])

    def test_national_diagnosis_keeps_its_scope_instead_of_becoming_local(self):
        paragraph = '全国生物医药产业中试资源短缺，部分关键技术成熟度不足，研究报告未披露任何具体城市的供给情况。'
        rows = select_source_paragraphs(paragraph, TOPIC, mode='chain')
        self.assertEqual(rows[0]['quote'], paragraph)
        self.assertNotIn('local', rows[0])

    def test_four_buckets_reserve_late_diagnosis_under_row_and_character_caps(self):
        rows = []
        for lane in ('上游', '中游', '下游'):
            for i in range(20):
                rows.append({'id': lane + str(i), 'quote': lane * 100,
                             'chain_facets': [lane], 'relevance_score': 100})
        diagnosis = {'id': 'late-diagnosis', 'quote': BIO_DIAGNOSIS,
                     'chain_facets': ['评价', '约束'], 'relevance_score': 0}
        rows.append(diagnosis)
        picked = _balanced_chain_rows(rows, 8, 4000)
        self.assertIn(diagnosis, picked)
        self.assertEqual(len(picked), 8)
        self.assertTrue(all(any(lane in r['chain_facets'] for r in picked)
                            for lane in ('评价', '上游', '中游', '下游')))
        self.assertLessEqual(sum(len(json.dumps(r, ensure_ascii=False)) for r in picked), 4000)


class AssessmentResearchTests(unittest.TestCase):
    def test_end_to_end_title_diagnosis_is_original_and_hash_bound(self):
        provider = FakeSearch([{'url': 'https://www.shanghai.gov.cn/bio.html',
                               'title': '闵行生物医药产业现状调研', 'text': BIO_DIAGNOSIS}])
        result = research_topic('闵行区', TOPIC, mode='chain', provider=provider,
                                basis=['SECRET_PRIVATE_MATERIAL'], questions=['SECRET_ANSWER'])
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(len(provider.calls), 9)
        self.assertNotIn('SECRET', json.dumps(provider.calls))
        self.assertEqual(len(result['evidence']), 1)
        row = result['evidence'][0]
        self.assertEqual(row['quote'], BIO_DIAGNOSIS)
        self.assertEqual(row['chain_facets'], ['评价', '约束'])
        archive = result['sources'][row['source_id']]
        self.assertIn(row['quote'], archive['fulltext'])
        self.assertEqual(archive['fulltext_sha256'], hashlib.sha256(archive['fulltext'].encode()).hexdigest())

    def test_late_assessment_query_survives_full_first_five_query_pool(self):
        queries = search_plan('闵行区', TOPIC, 'chain')
        class SaturatedSearch(FakeSearch):
            search_count = 5
            def _search(self, query, count):
                self.calls.append(query)
                if query in queries[5:]:
                    return {'results': [{'url': 'https://www.shanghai.gov.cn/diagnosis.html',
                        'title': '闵行生物医药产业现状调研', 'text': BIO_DIAGNOSIS}]}
                q = queries.index(query)
                return {'results': [{'url': f'https://www.shanghai.gov.cn/material-{q}-{d}.html',
                    'title': '生物医药产业材料', 'text': '\n\n'.join(
                        f'第{q}-{d}-{i}项生物医药培养基材料列入技术研究方向，相关供应主体、产品参数与实际能力均需要进一步核实。'
                        for i in range(12))} for d in range(5)]}
        result = research_topic('闵行区', TOPIC, mode='chain', provider=SaturatedSearch())
        self.assertEqual(result['status'], 'ready')
        self.assertLessEqual(len(result['evidence']), 48)
        self.assertLessEqual(sum(len(json.dumps(r, ensure_ascii=False)) for r in result['evidence']), 40000)
        self.assertTrue(any(row['quote'] == BIO_DIAGNOSIS for row in result['evidence']))

    def test_nine_queries_share_existing_deadline_and_three_workers(self):
        provider = FakeSearch(delay=.06)
        started = time.monotonic()
        result = research_topic('闵行区', TOPIC, mode='chain', provider=provider,
                                deadline_seconds=.015)
        self.assertLess(time.monotonic()-started, .15)
        self.assertEqual(len(result['queries']), 9)
        self.assertTrue(any(e['code'] == 'research_deadline' for e in result['errors']))
        time.sleep(.08)
        self.assertLessEqual(provider.metrics['maximum'], 3)
        self.assertEqual(provider.metrics['active'], 0)


if __name__ == '__main__':
    unittest.main()
