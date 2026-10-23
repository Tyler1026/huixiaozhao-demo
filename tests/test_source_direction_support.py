"""Offline change-direction regressions; use only immutable saved excerpts."""
import copy
import unittest

from report_service.full_synthesis import (
    evidence_observations, ground_audit_check, source_support,
)


class SourceDirectionSupportTests(unittest.TestCase):
    URL = 'https://stats.example.test/saved'

    def check(self, source, claim, expected, **kwargs):
        evidence = [{'url': self.URL, 'excerpt': source}]
        observations = evidence_observations(evidence=evidence)
        before = copy.deepcopy(observations)
        result = source_support(claim, observations, self.URL, **kwargs)
        self.assertEqual(result['supported'], expected, (source, claim, result))
        self.assertEqual(observations, before)
        if expected:
            self.assertEqual(result['reason'], 'exact_observation_span')
            self.assertIn(result['source_sha256'], {o['sha256'] for o in observations})
        else:
            self.assertEqual(result['reason'], 'claim_not_supported_by_same_span')

    def test_growth_and_decline_are_not_interchangeable(self):
        for actual, wrong in [('增长', '下降'), ('下降', '增长'), ('增加', '减少'), ('下滑', '上升')]:
            with self.subTest(actual=actual):
                source = f'2025年随州市GDP{actual}6.1%。'
                self.check(source, source, True)
                self.check(source, f'2025年随州市GDP{wrong}6.1%。', False)

    def test_value_added_metric_name_is_not_an_increase_action(self):
        for metric in ['规上工业增加值', '工业增加值', '第一产业增加值',
                       '第二产业增加值', '第三产业增加值']:
            for direction, opposite in [('增长', '下降'), ('下降', '增长')]:
                with self.subTest(metric=metric, direction=direction):
                    source = f'2025年随州市{metric}{direction}6.1%。'
                    self.check(source, source, True)
                    self.check(source, f'2025年随州市{metric}{opposite}6.1%。', False)

    def test_absolute_value_added_does_not_supply_an_increment(self):
        from report_service.full_synthesis import _change_relations
        for metric in ['工业增加值', '第一产业增加值', '第二产业增加值', '第三产业增加值']:
            with self.subTest(metric=metric):
                source = f'2025年随州市{metric}100亿元。'
                self.assertEqual(_change_relations(source), ([], False))
                self.check(source, source, True)
                self.check(source, f'2025年随州市{metric}增加100亿元。', False)

    def test_same_number_on_two_metrics_cannot_supply_the_wrong_direction(self):
        source = '2025年随州市GDP增长6.1%而固定资产投资下降6.1%。'
        self.check(source, '2025年随州市GDP增长6.1%。', True)
        self.check(source, '2025年随州市GDP下降6.1%。', False)
        self.check(source, '2025年随州市固定资产投资下降6.1%。', True)
        self.check(source, '2025年随州市固定资产投资增长6.1%。', False)

    def test_multiple_quantities_keep_their_own_directions(self):
        source = '2025年随州市统计公报\n\nGDP增长6.1%，固定资产投资下降3.4%。'
        self.check(source, '2025年随州市GDP下降6.1%。', False)
        self.check(source, '2025年随州市固定资产投资增长3.4%。', False)
        self.check(source, '2025年随州市固定资产投资下降3.4%。', True)

    def test_sales_area_and_value_keep_separate_metric_identity(self):
        source = '2025年随州市统计公报\n\n商品房销售面积增长3.4%而商品房销售额下降3.4%。'
        self.check(source, '2025年随州市商品房销售面积增长3.4%。', True,
                   metric='商品房销售面积')
        self.check(source, '2025年随州市商品房销售面积下降3.4%。', False,
                   metric='商品房销售面积')
        self.check(source, '2025年随州市商品房销售额下降3.4%。', True,
                   metric='商品房销售额')
        self.check(source, '2025年随州市商品房销售额增长3.4%。', False,
                   metric='商品房销售额')

    def test_signed_rates_and_negative_growth(self):
        for rate in ['增速为-6.1%', '增速为−6.1%', '增长-6.1%', '负增长6.1%']:
            with self.subTest(rate=rate):
                source = f'2025年随州市GDP{rate}。'
                self.check(source, '2025年随州市GDP下降6.1%。', True)
                self.check(source, '2025年随州市GDP增长6.1%。', False)
        self.check('2025年随州市GDP增速为+6.1%。', '2025年随州市GDP增长6.1%。', True)
        self.check('2025年随州市GDP下降-6.1%。', '2025年随州市GDP下降6.1%。', False)

    def test_positive_rate_noun_remains_compatible(self):
        for rate in ['增速6.1%', '增长率为6.1%', '增长6.1%']:
            self.check(f'2025年随州市GDP{rate}。', '2025年随州市GDP增长6.1%。', True)
        self.check('2025年随州市GDP为6.1%。', '2025年随州市GDP增长6.1%。', False)

    def test_rate_slowdown_is_not_a_decline_in_the_underlying_metric(self):
        for source in ['2025年随州市GDP增长6.1%，增速回落6.1个百分点。',
                       '2025年随州市GDP增速回落6.1%。']:
            self.check(source, '2025年随州市GDP下降6.1%。', False)
        source = '2025年随州市GDP增长6.1%，增速回落1个百分点。'
        self.check(source, '2025年随州市GDP增长6.1%。', True)
        self.check(source, '2025年随州市GDP增速回落1个百分点。', True)
        self.check(source, '2025年随州市GDP增速提高1个百分点。', False)

    def test_percentage_points_are_not_percent(self):
        self.check('2025年随州市GDP增速回落6.1个百分点。',
                   '2025年随州市GDP增速回落6.1%。', False)
        self.check('2025年随州市GDP增速回落6.1%。',
                   '2025年随州市GDP增速回落6.1个百分点。', False)

    def test_flat_and_zero_are_supported_without_manufacturing_growth(self):
        for source in ['2025年随州市GDP与上年持平。', '2025年随州市GDP零增长。',
                       '2025年随州市GDP增长0%。', '2025年随州市GDP增速为-0.0%。']:
            with self.subTest(source=source):
                self.check(source, '2025年随州市GDP与上年持平。', True)
                self.check(source, '2025年随州市GDP增长0%。', True)
                self.check(source, '2025年随州市GDP增长6.1%。', False)
        self.check('2025年随州市GDP下降6.1%。', '2025年随州市GDP与上年持平。', False)
        self.check('2025年随州市GDP增速持平。', '2025年随州市GDP与上年持平。', False)

    def test_absolute_amount_does_not_supply_an_increment(self):
        self.check('2025年随州市固定资产投资100亿元。',
                   '2025年随州市固定资产投资增加100亿元。', False)
        self.check('2025年随州市固定资产投资增加100亿元。',
                   '2025年随州市固定资产投资减少100亿元。', False)
        self.check('2025年随州市固定资产投资增加100亿元。',
                   '2025年随州市固定资产投资增加1000000万元。', True)

    def test_quote_cannot_borrow_direction_from_outside_its_span(self):
        source = '2025年随州市GDP增长6.1%。固定资产投资下降6.1%。'
        self.check(source, '2025年随州市GDP下降6.1%。', False,
                   quote='2025年随州市GDP增长6.1%。')
        self.check(source, '2025年随州市GDP增长6.1%。', True,
                   quote='2025年随州市GDP增长6.1%。')

    def test_separate_observations_do_not_contribute_a_global_direction_set(self):
        observations = evidence_observations(evidence=[
            {'url': self.URL, 'excerpt': '2025年随州市GDP增长6.1%。'},
            {'url': self.URL, 'excerpt': '2025年随州市固定资产投资下降6.1%。'},
        ])
        self.assertFalse(source_support('2025年随州市GDP下降6.1%。', observations, self.URL)['supported'])

    def test_unaligned_parallel_list_is_pending_not_guessed(self):
        self.check('2025年随州市GDP和固定资产投资分别增长6.1%和下降3.4%。',
                   '2025年随州市固定资产投资增长6.1%。', False)

    def test_unrelated_direction_words_do_not_apply_to_next_quantity(self):
        source = '2025年随州市GDP增长6.1%，固定资产投资100亿元。'
        self.check(source, '2025年随州市固定资产投资增加100亿元。', False)
        self.check('2025年随州市GDP未增长6.1%。', '2025年随州市GDP增长6.1%。', False)

    def test_unrelated_ambiguous_relation_does_not_hide_supported_metric(self):
        source = '2025年随州市GDP增长6.1%而固定资产投资未增长3.4%。'
        self.check(source, '2025年随州市GDP增长6.1%。', True)
        self.check(source, '2025年随州市固定资产投资增长3.4%。', False)

    def test_constant_prices_are_not_a_flat_change(self):
        self.check('2025年随州市GDP按不变价计算增长6.1%。',
                   '2025年随州市GDP增长6.1%。', True)
        self.check('2025年随州市GDP并非持平。', '2025年随州市GDP持平。', False)

    def test_direction_without_a_number_cannot_reverse_the_source(self):
        source = '2025年随州市GDP增长6.1%。'
        self.check(source, '2025年随州市GDP增长。', True)
        self.check(source, '2025年随州市GDP下降。', False)
        self.check('2025年随州市GDP增速回落1个百分点。',
                   '2025年随州市GDP下降。', False)

    def test_negated_growth_does_not_support_positive_growth(self):
        for negation in ['不', '不是', '未', '没有', '并非', '不再']:
            with self.subTest(negation=negation):
                self.check(f'2025年随州市GDP{negation}增长6.1%。',
                           '2025年随州市GDP增长6.1%。', False)
                self.check('2025年随州市GDP增长6.1%。',
                           f'2025年随州市GDP{negation}增长6.1%。', False)

    def test_endpoint_is_not_a_delta(self):
        source = '2025年随州市固定资产投资增加至100亿元。'
        self.check(source, '2025年随州市固定资产投资增加100亿元。', False)
        self.check(source, '2025年随州市固定资产投资增加至100亿元。', True)
        self.check(source, '2025年随州市固定资产投资增加到100亿元。', True)
        self.check('2025年随州市固定资产投资增加100亿元。',
                   '2025年随州市固定资产投资增加至100亿元。', False)

    def test_old_rate_and_endpoint_are_not_current_rate_or_delta(self):
        source = '2025年随州市GDP增速由6.1%回落至3.4%。'
        self.check(source, '2025年随州市GDP增长6.1%。', False)
        self.check(source, '2025年随州市GDP增速6.1%。', False)
        self.check(source, '2025年随州市GDP增速回落3.4%。', False)
        self.check(source, '2025年随州市GDP增速回落至3.4%。', True)
        self.check(source, source, True)
        negative = '2025年随州市GDP增速下降至-6.1%。'
        self.check(negative, negative, True)
        self.check(negative, '2025年随州市GDP增速下降至6.1%。', False)

    def test_ground_audit_keeps_reversed_claim_pending_and_unchanged(self):
        item = {'claim': '2025年随州市GDP下降6.1%。', 'source': self.URL,
                'cross_source': '', 'year': '2025', 'region': '随州市',
                'metric': '地区生产总值', 'category': 'economic', 'verdict': '已印证'}
        before = copy.deepcopy(item)
        got = ground_audit_check(item, [{'url': self.URL, 'excerpt': '2025年随州市GDP增长6.1%。'}])
        self.assertEqual(got['support_status'], 'pending')
        self.assertFalse(got['source_support']['supported'])
        self.assertEqual(got['claim'], item['claim'])
        self.assertEqual(item, before)


if __name__ == '__main__':
    unittest.main()
