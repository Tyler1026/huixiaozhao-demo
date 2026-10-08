"""Offline preservation checks for task-specific persisted-fact views."""
import copy
import unittest

from report_service.full_context import scoped_prior


def _evidence(url, excerpt):
    return {'url': url, 'excerpt': excerpt, 'title': 'OFFLINE source fixture',
            'retrieved_at': '2026-10-08T00:00:00Z', 'retrieval': 'exa_fulltext'}


def _prior(count=25):
    directions = [{'id': f'dir{number}', 'name': f'方向{number}',
                   'evidence_ref': f'https://stats.gov.cn/offline/direction/{number}',
                   'full_detail': '完整方向依据' * 500 + 'DIRECTION-TAIL'} for number in (1, 2, 3)]
    prior = {
        'economy': {'text': '经济完整事实' * 30_000 + 'ECONOMY-TAIL',
                    'metadata': {'evidence': [_evidence('https://stats.gov.cn/offline/economy', '经济原文完整摘录')] }},
        'policy': {'text': '政策完整条件' * 30_000 + 'POLICY-TAIL',
                   'metadata': {'evidence': [_evidence('https://gov.cn/offline/policy', '政策原文完整摘录')] }},
        'chain': {'text': '完整产业链断点与风险CHAIN-TAIL', 'metadata': {'evidence': []}},
        'industry': {'text': '企业信号核验不需要复制的产业正文' * 1000,
                     'metadata': {'directions': directions, 'evidence': [
                         _evidence(item['evidence_ref'], '方向检索依据' * 1000 + 'SOURCE-TAIL') for item in directions] + [
                         _evidence('https://stats.gov.cn/offline/unrelated', '无关行业来源')]}},
        'fact_check': {'text': '已完成经济与政策核验全文FACT-CHECK-TAIL',
                       'metadata': {'checks': [{'claim': '完整已核验经济主张' * 500, 'category': 'economic',
                            'source': 'https://stats.gov.cn/offline/economy',
                            'cross_source': 'https://gov.cn/offline/cross'}],
                            'evidence': [_evidence('https://gov.cn/offline/cross', '完整交叉来源')],
                            'high_star_unavailable': False}},
        'scoring': {'text': '已完成当前评分正文SCORING-TAIL',
                    'metadata': {'scores': [{'name': '已评分企业', 'dimensions': {'risk': 3}}]}},
    }
    for number in (1, 2, 3):
        companies, evidence = [], []
        for index in range(count):
            url = f'https://cninfo.com.cn/offline/company/{number}/{index}'
            ref = f'https://gov.cn/offline/project/{number}/{index}'
            companies.append({'name': f'方向{number}精选企业{index}', 'url': url, 'evidence_ref': ref,
                              'landing_status': '已落地', 'expansion_date': '2026-10-08',
                              'expansion_evidence': '完整已保存扩产主张' * 500 + f'SIGNAL-TAIL-{number}-{index}',
                              'rationale': {'raw': ['完整嵌套匹配事实', index]}, 'uncertainty': '保留风险'})
            evidence.extend((_evidence(url, '公司身份完整摘录' * 500 + 'IDENTITY-TAIL'),
                             _evidence(ref, '项目扩产完整摘录' * 500 + 'PROJECT-TAIL')))
        prior[f'enterprises_{number}'] = {'text': '不应复制的完整企业研究正文' * 10_000,
                                         'metadata': {'selected': companies, 'candidates': [{'name': '无关候选'}],
                                                      'evidence': evidence + [_evidence(
                                                          f'https://cninfo.com.cn/offline/unrelated/{number}', '无关企业来源')]}}
    return prior


class FullContextTests(unittest.TestCase):
    def setUp(self):
        self.prior = _prior()

    def test_economic_and_policy_context_keep_complete_isolated_facts_and_current_work(self):
        for part, dependency in (('经济关键数字', 'economy'), ('政策金额', 'policy')):
            with self.subTest(part=part):
                view = scoped_prior(self.prior, 'fact_check', part)
                self.assertEqual(set(view), {dependency, 'fact_check'})
                self.assertEqual(view[dependency], self.prior[dependency])
                self.assertGreater(len(view[dependency]['text']), 120_000)
                self.assertEqual(view['fact_check'], self.prior['fact_check'])
                self.assertIsNot(view[dependency], self.prior[dependency])

    def test_signal_context_keeps_exactly_nine_full_claims_and_only_bound_sources(self):
        # A repeated saved name never displaces the third unique company.
        first = self.prior['enterprises_1']['metadata']['selected'][0]
        self.prior['enterprises_1']['metadata']['selected'].insert(1, copy.deepcopy(first))
        original = copy.deepcopy(self.prior)
        view = scoped_prior(self.prior, 'fact_check', '五星企业信号')
        self.assertEqual(set(view), {'industry', 'enterprises_1', 'enterprises_2', 'enterprises_3', 'fact_check'})
        self.assertEqual(view['industry']['metadata']['directions'], self.prior['industry']['metadata']['directions'])
        self.assertEqual(len(view['industry']['metadata']['evidence']), 3)
        for number in (1, 2, 3):
            stage = view[f'enterprises_{number}']
            self.assertIn(f'dir{number}', stage['text'])
            self.assertIn('前三家', stage['text'])
            self.assertEqual(set(stage['metadata']), {'selected', 'evidence'})
            selected = stage['metadata']['selected']
            self.assertEqual([item['name'] for item in selected], [f'方向{number}精选企业{index}' for index in range(3)])
            self.assertEqual(len(stage['metadata']['evidence']), 6)
            for item in selected:
                saved = next(value for value in self.prior[f'enterprises_{number}']['metadata']['selected']
                             if value['name'] == item['name'])
                self.assertEqual(item, saved)
            refs = {item[key] for item in selected for key in ('url', 'evidence_ref')}
            self.assertEqual({item['url'] for item in stage['metadata']['evidence']}, refs)
        self.assertEqual(view['fact_check'], self.prior['fact_check'])
        self.assertEqual(self.prior, original)

    def test_scoring_halves_cover_all_seventy_five_full_records_without_overlap(self):
        original = copy.deepcopy(self.prior)
        views = [scoped_prior(self.prior, 'scoring', part) for part in ('评分维度与权重', '加权计算')]
        batches = []
        for view in views:
            pairs = []
            for number in (1, 2, 3):
                stage = view[f'enterprises_{number}']
                self.assertNotIn('candidates', stage['metadata'])
                for item in stage['metadata']['selected']:
                    pairs.append((item['name'], f'dir{number}'))
                    saved = next(value for value in self.prior[f'enterprises_{number}']['metadata']['selected']
                                 if value['name'] == item['name'])
                    self.assertEqual(item, saved)
                refs = {item[key] for item in stage['metadata']['selected'] for key in ('url', 'evidence_ref')}
                self.assertEqual({item['url'] for item in stage['metadata']['evidence']}, refs)
                originals = {item['url']: item for item in self.prior[f'enterprises_{number}']['metadata']['evidence']}
                self.assertTrue(all(item == originals[item['url']] for item in stage['metadata']['evidence']))
            batches.append(pairs)
            self.assertEqual(view['chain'], self.prior['chain'])
            self.assertEqual(view['policy'], self.prior['policy'])
            self.assertEqual(view['fact_check']['metadata'], self.prior['fact_check']['metadata'])
            self.assertNotEqual(view['fact_check']['text'], self.prior['fact_check']['text'])
            self.assertEqual(view['scoring'], self.prior['scoring'])
        expected = [(f'方向{number}精选企业{index}', f'dir{number}') for number in (1, 2, 3) for index in range(25)]
        self.assertEqual([len(batch) for batch in batches], [38, 37])
        self.assertEqual(batches[0] + batches[1], expected)
        self.assertFalse(set(batches[0]) & set(batches[1]))
        self.assertEqual(self.prior, original)

    def test_scoring_deduplicates_within_direction_but_preserves_cross_direction_identity(self):
        prior = _prior(2)
        prior['enterprises_1']['metadata']['selected'].insert(0, copy.deepcopy(prior['enterprises_1']['metadata']['selected'][0]))
        prior['enterprises_2']['metadata']['selected'][0]['name'] = prior['enterprises_1']['metadata']['selected'][0]['name']
        pairs = []
        for part in ('评分维度与权重', '加权计算'):
            view = scoped_prior(prior, 'scoring', part)
            pairs.extend((item['name'], f'dir{number}') for number in (1, 2, 3)
                         for item in view[f'enterprises_{number}']['metadata']['selected'])
        self.assertEqual(len(pairs), 6)
        self.assertIn(('方向1精选企业0', 'dir1'), pairs)
        self.assertIn(('方向1精选企业0', 'dir2'), pairs)

    def test_missing_sources_are_not_fabricated_and_views_are_independent(self):
        self.prior['enterprises_1']['metadata']['evidence'] = []
        view = scoped_prior(self.prior, 'fact_check', '五星企业信号')
        self.assertEqual(view['enterprises_1']['metadata']['evidence'], [])
        view['enterprises_1']['metadata']['selected'][0]['rationale']['raw'][0] = 'edited view'
        view['industry']['metadata']['directions'][0]['name'] = 'edited direction'
        view['fact_check']['text'] = 'edited progress'
        self.assertNotEqual(self.prior['enterprises_1']['metadata']['selected'][0]['rationale']['raw'][0], 'edited view')
        self.assertNotEqual(self.prior['industry']['metadata']['directions'][0]['name'], 'edited direction')
        self.assertNotEqual(self.prior['fact_check']['text'], 'edited progress')

    def test_other_stages_pass_through_and_unknown_scoped_parts_fail_explicitly(self):
        self.assertIs(scoped_prior(self.prior, 'competition', '竞对地区'), self.prior)
        self.assertIsNone(scoped_prior(None, 'economy', '经济总量'))
        for stage in ('fact_check', 'scoring'):
            with self.subTest(stage=stage), self.assertRaises(ValueError):
                scoped_prior(self.prior, stage, 'unknown')


if __name__ == '__main__':
    unittest.main()
