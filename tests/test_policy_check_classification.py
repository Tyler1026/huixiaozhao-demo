"""No-network regressions for new standard policy-check classification."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from report_service.full_policy import (PolicyCheckError, prepare_policy_checks,
                                        attach_policy_bindings)
from report_service.full_provider import FullLiveProvider, FullProviderError
from report_service import full_contract as contract


def fixture(number=1, *, province='测试省', url=None):
    document = f'{province}技术改造奖补办法{number}'
    quote = (f'对在{province}注册的制造业企业，设备投资达到{number}00万元且验收合格的，'
             f'给予不超过{number}0万元补助。本办法自2026年1月1日起施行，有效期至2028年12月31日。')
    source = url or f'https://industry.gov.cn/offline/policy-{number}'
    body = document + '\n' + f'{province}工业和信息化厅\n' + quote
    evidence = {'url': source, 'title': document, 'excerpt': body}
    clause = {'document_name': document, 'quote': quote,
              'issuer': province + '工业和信息化厅', 'beneficiary': f'在{province}注册的制造业企业',
              'benefit': f'给予不超过{number}0万元补助',
              'conditions': f'设备投资达到{number}00万元且验收合格',
              'validity': '自2026年1月1日起施行，有效期至2028年12月31日', 'region': province}
    check = {'claim': quote, 'source': source, 'cross_source': '', 'year': '2026',
             'category': 'policy', 'direction': None, 'verdict': '待核实',
             'region': province, 'metric': '', 'policy_clause': clause}
    return evidence, check


class PolicyClauseBindingTests(unittest.TestCase):
    def test_real_normative_clause_in_other_region_binds_without_mutation(self):
        for region in ('测试省', '沿海市', '西部自治区'):
            with self.subTest(region=region):
                evidence, check = fixture(province=region)
                before = copy.deepcopy((check, evidence))
                prepared, bindings = prepare_policy_checks([check], [evidence])
                self.assertEqual(bindings[0]['classification'], 'normative_clause')
                self.assertEqual(bindings[0]['status'], 'fields_located')
                self.assertEqual(prepared[0]['source_quote'], check['claim'])
                self.assertEqual((check, evidence), before)

    def test_all_five_observed_nonpolicy_classes_cannot_fill_quota(self):
        examples = ['招商签约49个项目，合同额308.31亿元。', '专汽应急产值703亿元，同比增长12.1%。',
                    '工业投资增长23.9%，技改投资增长22.7%。', '企业取得3760万元订单。',
                    '开展47场活动，接待397人次。']
        for text in examples:
            with self.subTest(text=text):
                evidence, check = fixture()
                check['claim'] = text
                check['policy_clause']['quote'] = text
                evidence['excerpt'] += '\n' + text
                with self.assertRaisesRegex(PolicyCheckError, 'not_normative'):
                    prepare_policy_checks([check], [evidence])

    def test_claim_cannot_borrow_a_valid_clause_to_launder_activity(self):
        evidence, check = fixture()
        check['claim'] = '招商签约49个项目，合同额308.31亿元。'
        with self.assertRaisesRegex(PolicyCheckError, 'claim_differs'):
            prepare_policy_checks([check], [evidence])

    def test_past_disbursement_statistics_not_a_new_rule(self):
        evidence, check = fixture()
        text = '累计对企业给予100万元补助，开展47场政策宣传活动。'
        check['claim'] = check['policy_clause']['quote'] = text
        evidence['excerpt'] += '\n' + text
        with self.assertRaisesRegex(PolicyCheckError, 'not_normative'):
            prepare_policy_checks([check], [evidence])

    def test_highest_elsewhere_does_not_excuse_completed_statistics(self):
        for text in ('2026年对制造业企业累计发放补助100万元，最高单笔奖励10万元。',
                     '对全市企业已给予补助100万元，最高获奖企业得到10万元。'):
            with self.subTest(text=text):
                evidence, check = fixture()
                check['claim'] = check['policy_clause']['quote'] = text
                evidence['excerpt'] += '\n' + text
                with self.assertRaisesRegex(PolicyCheckError, 'not_normative'):
                    prepare_policy_checks([check], [evidence])

    def test_cumulative_benefit_ceiling_is_not_misread_as_past_statistics(self):
        evidence, check = fixture()
        check['claim'] = check['policy_clause']['quote'] = '对符合条件的制造业企业，累计给予不超过100万元补助。'
        evidence['excerpt'] = evidence['title'] + '\n' + check['claim']
        for field in ('issuer','beneficiary','benefit','conditions','validity','region'):
            check['policy_clause'][field] = None
        _, bindings = prepare_policy_checks([check], [evidence])
        self.assertEqual(bindings[0]['status'], 'pending')

    def test_official_commentary_is_not_the_normative_original(self):
        evidence, check = fixture()
        evidence['title'] += '政策解读'
        with self.assertRaisesRegex(PolicyCheckError, 'not_in_saved'):
            prepare_policy_checks([check], [evidence])

    def test_same_url_different_observations_must_not_be_stitched(self):
        evidence, check = fixture()
        body = evidence['excerpt']; split = body.index('给予')
        evidence = contract.merge_evidence_records([
            dict(evidence, excerpt=body[:split]), dict(evidence, excerpt=body[split:])])[0]
        with self.assertRaisesRegex(PolicyCheckError, 'not_in_saved'):
            prepare_policy_checks([check], [evidence])

    def test_field_cannot_come_from_other_observation(self):
        evidence, check = fixture()
        check['policy_clause']['conditions'] = '连续经营满三年'
        evidence = contract.merge_evidence_records([
            evidence, dict(evidence, excerpt='其他项目要求连续经营满三年。')])[0]
        with self.assertRaisesRegex(PolicyCheckError, 'same_observation'):
            prepare_policy_checks([check], [evidence])

    def test_condition_cannot_be_truncated_from_a_sentence(self):
        evidence, check = fixture()
        clipped = check['claim'][check['claim'].index('给予'):]
        check['claim'] = check['policy_clause']['quote'] = clipped
        with self.assertRaises(PolicyCheckError):
            prepare_policy_checks([check], [evidence])

    def test_title_does_not_supply_an_absent_clause(self):
        evidence, check = fixture()
        evidence['title'] += check['claim']; evidence['excerpt'] = '新闻只介绍有关政策。'
        with self.assertRaisesRegex(PolicyCheckError, 'not_in_saved'):
            prepare_policy_checks([check], [evidence])

    def test_media_company_http_and_forged_url_cannot_be_official_policy(self):
        for url in ('https://news.example.org/policy', 'https://company.com/policy',
                    'http://industry.gov.cn/offline/policy',
                    'https://industry.gov.cn.evil.org/policy',
                    'https://evil@industry.gov.cn/policy'):
            with self.subTest(url=url):
                evidence, check = fixture(url=url)
                with self.assertRaisesRegex(PolicyCheckError, 'not_in_saved'):
                    prepare_policy_checks([check], [evidence])

    def test_unseen_url_query_is_not_an_actual_supplied_source(self):
        evidence, check = fixture()
        check['source'] += '?invented=true'
        with self.assertRaises(PolicyCheckError):
            prepare_policy_checks([check], [evidence])

    def test_missing_policy_fields_stay_pending_and_are_not_invented(self):
        evidence, check = fixture()
        for field in ('conditions', 'validity', 'issuer'):
            check['policy_clause'][field] = None
        prepared, bindings = prepare_policy_checks([check], [evidence])
        self.assertEqual(bindings[0]['missing_fields'], ['issuer', 'conditions', 'validity'])
        self.assertEqual(bindings[0]['status'], 'pending')
        grounded = [{'claim':check['claim'], 'source':check['source'],
                     'verdict': '单源支持', 'support_gap': '待独立交叉核验'}]
        attach_policy_bindings(grounded, bindings)
        self.assertIn('待核实', grounded[0]['verdict'])
        self.assertIsNone(grounded[0]['policy_clause_validation']['validity'])

    def test_publication_date_cannot_fill_policy_validity(self):
        evidence, check = fixture()
        evidence['excerpt'] += '\n发布时间：2026年1月1日'
        check['policy_clause']['validity'] = '2026年1月1日'
        with self.assertRaisesRegex(PolicyCheckError, 'validity_not_operative'):
            prepare_policy_checks([check], [evidence])

    def test_first_benefit_sentence_cannot_omit_later_paragraph_condition(self):
        evidence, check = fixture()
        quote = check['claim'].split('。')[0] + '。'
        check['claim'] = check['policy_clause']['quote'] = quote
        with self.assertRaisesRegex(PolicyCheckError, 'not_in_saved'):
            prepare_policy_checks([check], [evidence])

    def test_statistical_bulletin_is_not_a_policy_document(self):
        evidence, check = fixture()
        document='测试省2026年政策落实统计公报'
        check['policy_clause']['document_name']=evidence['title']=document
        with self.assertRaisesRegex(PolicyCheckError, 'document_unidentified'):
            prepare_policy_checks([check], [evidence])

    def test_individual_project_approval_is_not_general_policy(self):
        evidence,check=fixture()
        evidence['title']='关于某公司扩建项目节能报告的审查意见'
        with self.assertRaisesRegex(PolicyCheckError, 'not_in_saved'):
            prepare_policy_checks([check],[evidence])

    def test_document_suffix_does_not_establish_complete_document_identity(self):
        evidence,check=fixture()
        check['policy_clause']['document_name']='改造奖补办法1'
        with self.assertRaisesRegex(PolicyCheckError, 'not_in_saved'):
            prepare_policy_checks([check],[evidence])

    def test_downstream_cannot_attach_bound_metadata_to_another_claim(self):
        evidence, check = fixture(); _, bindings = prepare_policy_checks([check], [evidence])
        with self.assertRaisesRegex(PolicyCheckError, 'changed_bound_clause'):
            attach_policy_bindings([{'claim':'另一个政策句子', 'source':check['source']}], bindings)

    def test_model_self_certification_does_not_bypass_binding(self):
        evidence, check = fixture()
        check['policy_clause'].update(classification='normative_clause', status='verified', supported=True)
        check['policy_clause']['beneficiary'] = '任何企业无条件'
        with self.assertRaises(PolicyCheckError):
            prepare_policy_checks([check], [evidence])

    def test_single_character_fields_are_not_identified_elements(self):
        for field, value in (('beneficiary','企'),('conditions','验'),('issuer','厅'),('region','省')):
            with self.subTest(field=field):
                evidence, check = fixture();check['policy_clause'][field]=value
                with self.assertRaisesRegex(PolicyCheckError, 'field_invalid'):
                    prepare_policy_checks([check],[evidence])

    def test_clause_cannot_cross_into_a_different_attachment(self):
        evidence,check=fixture()
        evidence['excerpt']=(evidence['title']+'\n（附件一略）\n附件二：其他企业扶持办法\n'+check['claim'])
        for field in ('issuer','beneficiary','benefit','conditions','validity','region'):
            check['policy_clause'][field]=None
        with self.assertRaisesRegex(PolicyCheckError, 'ownership_ambiguous'):
            prepare_policy_checks([check],[evidence])

    def test_cross_source_must_bind_same_policy_and_fields(self):
        evidence, check = fixture(); second, different = fixture(2)
        check['cross_source'] = second['url']
        check['cross_policy_clause'] = different['policy_clause']
        with self.assertRaisesRegex(PolicyCheckError, 'different_clause'):
            prepare_policy_checks([check], [evidence, second])

    def test_duplicate_clause_different_model_labels_cannot_fill_quota(self):
        evidence, check = fixture(); other = copy.deepcopy(check)
        other['direction'] = 'dir2'; other['verdict'] = '已验证'
        with self.assertRaisesRegex(PolicyCheckError, 'duplicate_clause'):
            prepare_policy_checks([check, other], [evidence])

    def test_invalid_shape_and_bounds_fail_without_untrusted_error_text(self):
        evidence, check = fixture()
        for bad in (None, {}, [None], [dict(check, policy_clause=None)], [check] * 65):
            with self.subTest(bad_type=type(bad).__name__):
                with self.assertRaises(PolicyCheckError) as error:
                    prepare_policy_checks(bad, [evidence])
                self.assertNotIn(check['claim'], str(error.exception))


class FakeLive:
    enabled = True
    search_provider = 'exa'
    def __init__(self, payload): self.payload = payload; self.calls = []
    def _validate_endpoints(self): pass
    def _chat(self, messages, *args, **kwargs):
        self.calls.append(messages)
        return {'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(self.payload)}}]}


class PolicyProductionEntryTests(unittest.TestCase):
    def run_case(self, checks, *, mode='standard', part='政策金额'):
        evidence = [fixture(i)[0] for i in (1, 2, 3)]
        payload = {'text': '\n'.join(f'OFFLINE政策条款{n}的独立待核资料清单' for n in range(40)),
                   'checks': checks}
        live = FakeLive(payload); provider = FullLiveProvider(live)
        provider._gather_evidence = lambda *a, **kw: copy.deepcopy(evidence)
        before = copy.deepcopy(checks)
        try:
            result = provider.run_part('fact_check', part, {'city': '测试市', 'mode': mode}, {})
            return result, live
        finally:
            self.assertEqual(checks, before)

    def test_actual_run_part_rejects_mislabeled_statistics_before_return(self):
        checks = [dict(fixture(i)[1], claim='开展47场活动，接待397人次。') for i in (1, 2, 3)]
        with self.assertRaisesRegex(FullProviderError, 'policy_claim_differs') as failure:
            self.run_case(checks)
        self.assertEqual(failure.exception.failure_code, 'quality')

    def test_actual_run_part_keeps_three_policy_records_and_prompt_schema(self):
        result, live = self.run_case([fixture(i)[1] for i in (1, 2, 3)])
        self.assertEqual(len(result['metadata']['checks']), 3)
        self.assertEqual(contract.fact_check_part_errors('政策金额', result['metadata']), [])
        self.assertTrue(all(x['policy_clause_validation']['classification']=='normative_clause'
                            for x in result['metadata']['checks']))
        prompt = live.calls[0][-1]['content']
        for part in ('policy_clause', 'claim必须逐字等于quote', '活动次数', '有效期', '至少3条'):
            self.assertIn(part, prompt)
        self.assertEqual(len(live.calls), 1)

    def test_two_true_clauses_still_fail_unchanged_three_clause_quota(self):
        with self.assertRaisesRegex(FullProviderError, 'policy checks 2 < 3'):
            self.run_case([fixture(i)[1] for i in (1, 2)])

    def test_missing_fields_visible_pending_in_actual_output(self):
        checks = [fixture(i)[1] for i in (1, 2, 3)]
        for check in checks:check['policy_clause']['validity'] = None
        result, _ = self.run_case(checks)
        self.assertTrue(all('待核实' in x['verdict'] for x in result['metadata']['checks']))
        self.assertTrue(all(x['policy_clause_validation']['status']=='pending'
                            for x in result['metadata']['checks']))

    def test_economic_batch_and_historical_contract_not_reclassified(self):
        provider = FullLiveProvider(FakeLive({}))
        evidence = [fixture()[0]]
        old = {'claim':'开展47场活动，接待397人次。', 'category':'policy',
               'source':evidence[0]['url'], 'year':'2026'}
        meta = provider._build_metadata('fact_check','经济关键数字','测试市',evidence,{'checks':[old]}, {})
        self.assertEqual(len(meta['checks']), 1)
        self.assertNotIn('policy_clause_validation',meta['checks'][0])
        self.assertEqual(contract.fact_check_part_errors('政策金额', {'checks':[
            dict(old,claim=str(i))for i in range(3)]}), [])

    def test_deep_metadata_path_remains_unchanged(self):
        provider=FullLiveProvider(FakeLive({})); evidence,check=fixture()
        old=copy.deepcopy(check);old.pop('policy_clause')
        a=provider._build_metadata('fact_check','政策金额','测试省',[evidence],{'checks':[old]}, {},mode='deep')
        b=provider._build_metadata('fact_check','经济关键数字','测试省',[evidence],{'checks':[old]}, {},mode='deep')
        self.assertEqual(a,b)
        self.assertTrue(all('policy_clause_validation' not in x for x in a['checks']))

    def test_query_count_and_count_budget_unchanged_with_normative_terms(self):
        class SearchOnly:
            search_count=5
            search_provider='exa'
            def __init__(self):self.calls=[]
            def _search(self, query, count):
                self.calls.append((query,count))
                evidence,_=fixture()
                return [{'url':evidence['url'],'title':evidence['title'],'snippet':evidence['excerpt']}]
            def _normalize_results(self,payload):return payload
        live=SearchOnly();provider=FullLiveProvider(live)
        self.assertTrue(provider._gather_evidence('fact_check','政策金额','OFFLINE测试省',{},mode='standard'))
        self.assertEqual(len(live.calls),2)
        self.assertEqual([count for _,count in live.calls],[5,5])
        self.assertTrue(all('site:gov.cn' in query for query,_ in live.calls))
        self.assertTrue(any('规范性文件' in query for query,_ in live.calls))
        self.assertTrue(any('有效期' in query for query,_ in live.calls))
        live.calls.clear()
        provider._gather_evidence('fact_check','政策金额','OFFLINE测试省',{},mode='deep')
        self.assertEqual(len(live.calls),2)
        self.assertTrue(all('site:gov.cn' not in query for query,_ in live.calls))


if __name__ == '__main__': unittest.main()
