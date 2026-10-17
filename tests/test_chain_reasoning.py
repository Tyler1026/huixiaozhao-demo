"""Offline evidence binding and independent-review boundaries for v2."""
import copy
import hashlib
import json
import unittest

from backend.chain_reasoning import build_reasoning
from report_service.full_contract import canonical_url

CONTEXT = {'city': '闵行区', 'topic': '低空经济整机配套承接集聚'}
CHAIN = {'chain': [{'nodes': [{'id': 'control', 'name': '飞控系统'}]}], 'unclassified': []}
FALLBACK = {'assessment': {'judgment': {'contract': 'chain-judgment-v1', 'level': 'mid',
            'basis': 'local_plan', 'reason': '已有本地规划依据', 'evidence_ids': []}},
            'node_assessments': {'control': {'judgment': {'contract': 'chain-judgment-v1',
            'level': 'mid', 'basis': 'local_plan', 'reason': '保留既有规划研判', 'evidence_ids': []}}},
            'sources': []}


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def research(quotes, origins=None, titles=None):
    result = {'status': 'ready', 'city': CONTEXT['city'], 'topic': CONTEXT['topic'], 'evidence': [], 'sources': {}}
    for i, quote in enumerate(quotes):
        url = f'https://www.shanghai.gov.cn/reasoning/{i}.html'
        source_id = 'source_' + digest(canonical_url(url) + '\0' + quote)[:20]
        metadata = {'url': url, 'title': titles[i] if titles else '闵行区低空产业调研',
                    'published_at': '2025-10-01', 'retrieved_at': '2026-10-16',
                    'retrieval': 'fetched', 'source_type': 'government', 'status': 'source',
                    'origin_id': origins[i] if origins else 'origin_' + digest(quote)[:20]}
        result['sources'][source_id] = dict(metadata, id=source_id, fulltext=quote, fulltext_sha256=digest(quote))
        result['evidence'].append(dict(metadata, id='tr_' + digest(url + '\0' + quote)[:20],
                                       source_id=source_id, quote=quote))
    return result


def premise(bundle, role, index=0, sentence=0, subject='飞控系统'):
    return {'evidence_id': bundle['evidence'][index]['id'], 'sentence_index': sentence,
            'role': role, 'subject': subject}


def proposal(premises, rule='existing_basis', **changes):
    return dict({'node_id': 'control', 'rule': rule, 'premises': premises,
                 'reason': '原文披露了对应本地基础，可进一步核实配套承接条件。',
                 'limitations': ['仅对应来源记载时期。'], 'action': '核实当前服务范围与可用条件。'}, **changes)


def enterprise_research(*, same_report=True, website=False, business_text=None):
    identity = '公司名称 示例装备股份有限公司。\n注册地址 上海市闵行区示例路1号。\n公司网址 www.example.com。'
    business = business_text or '本公司主要产品包括飞控系统，提供相关产品及技术服务，具体业务由本报告披露。'
    report = 'https://static.cninfo.com.cn/finalpage/2026-04-29/1234567890.PDF'
    urls = [report, 'https://example.com/products/control' if website else report if same_report else
            'https://static.cninfo.com.cn/finalpage/2026-04-29/other-company.PDF']
    bundle = research([identity, business])
    sources = {}
    for i, row in enumerate(bundle['evidence']):
        old = bundle['sources'][row['source_id']]
        url = urls[i]
        source_id = 'source_' + digest(canonical_url(url) + '\0' + old['fulltext'])[:20]
        row.update(url=url, id='tr_' + digest(url + '\0' + row['quote'])[:20], source_id=source_id,
                   source_type='company' if i == 1 and website else 'disclosure')
        sources[source_id] = dict(old, id=source_id, url=url, source_type=row['source_type'])
    bundle['sources'] = sources
    if website:
        proof = bundle['evidence'][0]
        bundle['sources'][bundle['evidence'][1]['source_id']]['website_attestation'] = {
            'domain': 'example.com', 'website_host': 'www.example.com', 'evidence_id': proof['id'],
            'source_id': proof['source_id'], 'url': proof['url'], 'website_text': '公司网址 www.example.com'}
    return bundle


def run(bundle, rows, review=None, chain=None, fallback=None, context=None):
    calls = []
    def complete(system, prompt, tokens):
        calls.append((system, json.loads(prompt), tokens))
        if len(calls) == 1:
            if isinstance(rows, Exception): raise rows
            return {'nodes': rows}
        if isinstance(review, Exception): raise review
        return review if review is not None else {'verdicts': [
            {'node_id': item['node_id'], 'valid': True} for item in calls[-1][1]['proposals']]}
    out = build_reasoning(context or CONTEXT, bundle, chain or CHAIN, fallback or FALLBACK, complete)
    return out, calls


class ChainReasoningTests(unittest.TestCase):
    def test_direct_local_basis_is_bound_and_reviewed_before_acceptance(self):
        quote = '闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。'
        bundle = research([quote])
        out, calls = run(bundle, [proposal([premise(bundle, 'local_basis')])])
        node = out['node_judgments']['control']
        self.assertEqual([call[2] for call in calls], [6500, 3500])
        self.assertEqual(node['contract'], 'chain-judgment-v2')
        self.assertEqual(node['level'], 'strong')
        self.assertEqual(node['method'], 'direct')
        self.assertEqual(node['confidence'], 'medium')
        self.assertEqual(node['premises'][0]['quote'], quote)
        self.assertEqual(node['premises'][0]['source']['quote'], quote)
        self.assertEqual(node['evidence_ids'], [bundle['evidence'][0]['id']])
        self.assertEqual(out['sources'][0]['id'], bundle['evidence'][0]['id'])

    def test_explicit_short_form_mapping_can_be_reviewed_as_inference(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。'])
        chain = {'chain': [{'nodes': [{'id': 'control', 'name': '高精度飞行控制系统'}]}]}
        out, _ = run(bundle, [proposal([premise(bundle, 'local_basis')])], chain=chain)
        node = out['node_judgments']['control']
        self.assertEqual(node['level'], 'strong')
        self.assertEqual(node['method'], 'inference')
        self.assertEqual(node['confidence'], 'low')

    def test_false_entity_or_service_mapping_rejected_by_independent_review(self):
        bundle = research(['闵行区通信载荷测试服务能力不足，相关限制已在原始调研材料中记录。'])
        row = proposal([premise(bundle, 'constraint', subject='通信载荷测试服务')], 'local_constraint')
        out, calls = run(bundle, [row], {'verdicts': [{'node_id': 'control', 'valid': False}]})
        self.assertEqual(len(calls), 2)
        self.assertEqual(out['node_judgments']['control'], FALLBACK['node_assessments']['control']['judgment'])

    def test_plan_is_yellow_and_cannot_be_submitted_as_real_red_constraint(self):
        bundle = research(['闵行区计划建设飞控系统产业配套项目，支持相关关键技术研发。'])
        row = proposal([premise(bundle, 'policy_target')], 'policy_priority')
        out, _ = run(bundle, [row])
        self.assertEqual(out['node_judgments']['control']['level'], 'mid')
        row = proposal([premise(bundle, 'constraint')], 'local_constraint')
        out, calls = run(bundle, [row])
        self.assertEqual(len(calls), 1)
        self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v1')

    def test_national_and_foreign_local_claims_do_not_pass_hard_gate(self):
        for quote in ['全国飞控系统供应不足，行业调研披露了对应的产业发展瓶颈。',
                      '苏州市飞控系统生产线已实现量产，原始资料明确记载其生产地点。']:
            bundle = research([quote])
            role, rule = ('constraint', 'local_constraint') if '不足' in quote else ('local_basis', 'existing_basis')
            out, calls = run(bundle, [proposal([premise(bundle, role)], rule)])
            self.assertEqual(len(calls), 1)
            self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v1')

    def test_negation_and_uncertainty_are_not_direct_constraints(self):
        for qualifier in ['并非', '可能']:
            bundle = research([f'闵行区飞控系统{qualifier}供应不足，相关具体情况由调研材料记录。'])
            out, calls = run(bundle, [proposal([premise(bundle, 'constraint')], 'local_constraint')])
            self.assertEqual(len(calls), 1)
            self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v1')

    def test_demand_and_explicit_constraint_can_support_reviewed_mismatch(self):
        bundle = research(['闵行区飞控系统已有明确订单需求，需要满足相应交付条件。',
                           '闵行区飞控系统现有产能不足，无法满足订单交付需求。'])
        row = proposal([premise(bundle, 'local_demand'), premise(bundle, 'constraint', 1)], 'capacity_mismatch',
                       reason='本地订单需求与材料披露的现有产能存在不匹配，建议优先核实交付约束。')
        out, _ = run(bundle, [row])
        node = out['node_judgments']['control']
        self.assertEqual(node['level'], 'weak')
        self.assertEqual(node['method'], 'inference')
        self.assertEqual(node['confidence'], 'medium')
        self.assertEqual(len(node['evidence_ids']), 2)

    def test_industry_risk_without_local_link_cannot_create_red_or_yellow_inference(self):
        bundle = research(['飞控系统面临行业可靠性验证挑战，相关技术要求仍需行业持续研究。',
                           '闵行区计划支持飞控系统研发，培育低空产业相关配套条件。'])
        risk = premise(bundle, 'industry_requirement')
        for rule in ['capacity_mismatch', 'local_constraint', 'industry_challenge']:
            out, calls = run(bundle, [proposal([risk], rule)])
            self.assertEqual(len(calls), 1)
            self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v1')
        out, _ = run(bundle, [proposal([risk, premise(bundle, 'policy_target', 1)], 'industry_challenge')])
        self.assertEqual(out['node_judgments']['control']['level'], 'mid')

    def test_fake_id_invalid_index_and_nonliteral_subject_are_rejected(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。'])
        good = premise(bundle, 'local_basis')
        changes = [{'evidence_id': 'tr_' + '0'*20}, {'sentence_index': True},
                   {'sentence_index': -1}, {'sentence_index': 9}, {'sentence_index': '0'},
                   {'subject': '不存在的控制设备'}, {'subject': '系统'}]
        for change in changes:
            out, calls = run(bundle, [proposal([dict(good, **change)])])
            self.assertEqual(len(calls), 1)
            self.assertEqual(out['sources'], [])

    def test_bad_archive_hash_prevents_model_call(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。'])
        next(iter(bundle['sources'].values()))['fulltext_sha256'] = '0'*64
        out, calls = run(bundle, [])
        self.assertEqual(calls, [])
        self.assertEqual(out['judgment'], FALLBACK['assessment']['judgment'])

    def test_unsupported_model_number_is_rejected_before_verifier(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。'])
        row = proposal([premise(bundle, 'local_basis')], reason='本地已占有全球90%的飞控系统产能。')
        out, calls = run(bundle, [row])
        self.assertEqual(len(calls), 1)
        self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v1')

    def test_two_model_failures_preserve_existing_judgments_exactly(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。'])
        row = proposal([premise(bundle, 'local_basis')])
        for rows, review in [(RuntimeError('SECRET'), None), ([row], RuntimeError('SECRET'))]:
            out, _ = run(bundle, rows, review)
            self.assertEqual(out['judgment'], FALLBACK['assessment']['judgment'])
            self.assertEqual(out['node_judgments']['control'], FALLBACK['node_assessments']['control']['judgment'])
            self.assertNotIn('SECRET', json.dumps(out))

    def test_verifier_must_return_unambiguous_boolean_acceptance(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。'])
        row = proposal([premise(bundle, 'local_basis')])
        for verdicts in [[{'node_id': 'control', 'valid': 'true'}],
                         [{'node_id': 'control', 'valid': True}, {'node_id': 'control', 'valid': False}],
                         [{'node_id': 'forged', 'valid': True}]]:
            out, _ = run(bundle, [row], {'verdicts': verdicts})
            self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v1')

    def test_republished_origin_does_not_raise_confidence(self):
        quotes = ['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。',
                  '闵行区现有飞控系统生产设施，资料记载其提供相应产品。']
        for origins, expected in [(['same', 'same'], 'medium'), (['one', 'two'], 'high')]:
            bundle = research(quotes, origins=origins)
            row = proposal([premise(bundle, 'local_basis'), premise(bundle, 'local_basis', 1)])
            out, _ = run(bundle, [row])
            self.assertEqual(out['node_judgments']['control']['confidence'], expected)

    def test_model_grades_are_ignored_and_inputs_are_not_mutated(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。'])
        original = copy.deepcopy((bundle, CHAIN, FALLBACK))
        row = proposal([premise(bundle, 'local_basis')], level='weak', confidence='high', score=100)
        out, _ = run(bundle, [row])
        self.assertEqual(out['node_judgments']['control']['level'], 'strong')
        self.assertEqual(out['node_judgments']['control']['confidence'], 'medium')
        self.assertNotIn('score', out['node_judgments']['control'])
        self.assertEqual((bundle, CHAIN, FALLBACK), original)

    def test_later_improvement_plan_does_not_erase_current_constraint(self):
        bundle = research(['闵行区飞控系统目前产能不足，未来计划新建生产线缓解交付压力。'])
        row = proposal([premise(bundle, 'constraint')], 'local_constraint',
                       reason='现有产能约束已被披露，后续扩建计划尚不能证明该问题得到解决。')
        out, calls = run(bundle, [row])
        self.assertEqual(len(calls), 2)
        self.assertEqual(out['node_judgments']['control']['level'], 'weak')

    def test_later_expansion_plan_does_not_erase_completed_basis(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，未来计划扩建新的生产设施。'])
        out, calls = run(bundle, [proposal([premise(bundle, 'local_basis')])])
        self.assertEqual(len(calls), 2)
        self.assertEqual(out['node_judgments']['control']['level'], 'strong')

    def test_future_only_constraint_is_not_current_gap(self):
        bundle = research(['未来如果闵行区飞控系统产能不足，将根据实际需求研究扩建计划。'])
        out, calls = run(bundle, [proposal([premise(bundle, 'constraint')], 'local_constraint')])
        self.assertEqual(len(calls), 1)
        self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v1')

    def test_dependency_exposure_can_prioritize_without_claiming_local_absence(self):
        bundle = research(['闵行区现有飞控系统相关研发与生产企业，原文披露了相应产业基础。',
                           '我国飞控系统部分关键芯片依赖进口，供给自主性面临外部约束。'])
        row = proposal([premise(bundle, 'local_basis'), premise(bundle, 'industry_requirement', 1)],
                       'dependency_exposure', reason='行业进口依赖与本地产业形成关联，建议优先核实供应替代机会。')
        out, calls = run(bundle, [row])
        node = out['node_judgments']['control']
        self.assertEqual(len(calls), 2)
        self.assertEqual(node['level'], 'weak')
        self.assertEqual(node['method'], 'inference')
        self.assertEqual(node['status'], 'provisional')
        self.assertEqual(node['confidence'], 'medium')
        self.assertTrue(any('尚无该节点本地依赖率' in item for item in node['limitations']))
        self.assertEqual(node['premises'][1]['scope'], 'industry')

    def test_dependency_exposure_needs_actual_local_link_not_just_policy_or_generic_risk(self):
        bundle = research(['闵行区计划支持飞控系统研发，培育低空产业相关配套条件。',
                           '我国飞控系统部分关键芯片依赖进口，供给自主性面临外部约束。'])
        row = proposal([premise(bundle, 'policy_target'), premise(bundle, 'industry_requirement', 1)],
                       'dependency_exposure')
        out, calls = run(bundle, [row])
        self.assertEqual(len(calls), 1)
        self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v1')
        bundle = research(['闵行区现有飞控系统相关研发与生产企业，原文披露了相应产业基础。',
                           '飞控系统面临可靠性验证挑战，相关技术要求需要进一步研究。'])
        row = proposal([premise(bundle, 'local_basis'), premise(bundle, 'industry_requirement', 1)],
                       'dependency_exposure')
        _, calls = run(bundle, [row])
        self.assertEqual(len(calls), 1)

    def test_dependency_exposure_must_not_assert_measured_local_dependency(self):
        bundle = research(['闵行区现有飞控系统相关研发与生产企业，原文披露了相应产业基础。',
                           '我国飞控系统部分关键芯片依赖进口，供给自主性面临外部约束。'])
        for reason in ['闵行区飞控系统依赖进口，需补链。', '闵行飞控系统供应不足，需要引入新企业。']:
            row = proposal([premise(bundle, 'local_basis'), premise(bundle, 'industry_requirement', 1)],
                           'dependency_exposure', reason=reason)
            _, calls = run(bundle, [row])
            self.assertEqual(len(calls), 1)

    def test_malformed_unrelated_row_does_not_discard_valid_candidate(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。'])
        good = proposal([premise(bundle, 'local_basis')])
        out, _ = run(bundle, [{'node_id': [], 'rule': []}, good])
        self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v2')

    def test_verifier_receives_deduplicated_complete_original_sources(self):
        quote = '闵行区飞控系统生产线已实现量产，未来计划扩建新的生产设施。'
        bundle = research([quote])
        _, calls = run(bundle, [proposal([premise(bundle, 'local_basis')])])
        review = calls[1][1]
        self.assertEqual(review['sources'][0]['quote'], quote)
        self.assertNotIn('source', review['proposals'][0]['premises'][0])
        self.assertEqual(review['proposals'][0]['premises'][0]['statement'], quote)

    def test_policy_identified_same_subject_bottleneck_is_provisional_red_not_measured_gap(self):
        bundle = research(['闵行区计划补齐火箭发动机产业链短板，支持液氧甲烷发动机批量化生产。'])
        context = dict(CONTEXT, topic='商业火箭卫星配套本地化补链')
        bundle['topic'] = context['topic']
        chain = {'chain': [{'nodes': [{'id': 'control', 'name': '火箭发动机'}]}]}
        row = proposal([premise(bundle, 'policy_target', subject='火箭发动机')], 'policy_bottleneck',
                       reason='政策明确提出该环节补链方向，建议优先核实具体承接需求。')
        out, calls = run(bundle, [row], chain=chain, context=context)
        node = out['node_judgments']['control']
        self.assertEqual(len(calls), 2)
        self.assertEqual((node['level'], node['method'], node['status']), ('weak', 'inference', 'provisional'))
        self.assertIn(node['confidence'], ('low', 'medium'))
        self.assertTrue(any('不等于当前实测缺口' in item for item in node['limitations']))
        descendant = {'chain': [{'nodes': [{'id': 'control', 'name': '液氧甲烷发动机'}]}]}
        _, calls = run(bundle, [row], chain=descendant, context=context)
        self.assertEqual(len(calls), 1)
        ordinary = research(['闵行区计划建设火箭发动机配套项目，培育相关产业基础。'])
        ordinary['topic'] = context['topic']
        row = proposal([premise(ordinary, 'policy_target', subject='火箭发动机')], 'policy_bottleneck')
        _, calls = run(ordinary, [row], chain=chain, context=context)
        self.assertEqual(len(calls), 1)

    def test_policy_testing_bottleneck_can_target_service_but_not_payload(self):
        bundle = research(['闵行区重点解决卫星通信载荷测试服务能力的瓶颈问题，将建设相应测试系统。'])
        context = dict(CONTEXT, topic='商业火箭卫星配套本地化补链')
        bundle['topic'] = context['topic']
        service = {'chain': [{'nodes': [{'id': 'control', 'name': '卫星通信载荷测试服务'}]}]}
        row = proposal([premise(bundle, 'policy_target', subject='卫星通信载荷测试服务')], 'policy_bottleneck')
        out, _ = run(bundle, [row], chain=service, context=context)
        self.assertEqual(out['node_judgments']['control']['level'], 'weak')
        payload = {'chain': [{'nodes': [{'id': 'control', 'name': '卫星通信载荷'}]}]}
        row = proposal([premise(bundle, 'policy_target', subject='卫星通信载荷')], 'policy_bottleneck')
        _, calls = run(bundle, [row], chain=payload, context=context)
        self.assertEqual(len(calls), 1)

    def test_identical_duplicate_is_deduplicated_but_conflicting_duplicate_is_rejected(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。'])
        row = proposal([premise(bundle, 'local_basis')])
        out, calls = run(bundle, [row, copy.deepcopy(row)])
        self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v2')
        self.assertEqual(len(calls[1][1]['proposals']), 1)
        _, calls = run(bundle, [row, dict(row, reason='另一条不同的候选解释。')])
        self.assertEqual(len(calls), 1)

    def test_numeric_substring_cannot_change_a_source_quantity(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原文披露年产3000套的生产能力。'])
        row = proposal([premise(bundle, 'local_basis')], reason='本地飞控系统年产30套，可作为配套基础。')
        out, calls = run(bundle, [row])
        self.assertEqual(len(calls), 1)
        self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v1')

    def test_industry_side_material_does_not_raise_direct_support_confidence(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。',
                           '飞控系统行业可靠性验证面临挑战，相关技术要求需要进一步研究。'])
        row = proposal([premise(bundle, 'local_basis'), premise(bundle, 'industry_requirement', 1)])
        out, _ = run(bundle, [row])
        node = out['node_judgments']['control']
        self.assertEqual((node['method'], node['confidence']), ('direct', 'medium'))
        chain = {'chain': [{'nodes': [{'id': 'control', 'name': '高精度飞行控制系统'}]}]}
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。',
                           '高精度飞行控制系统的可靠性验证面临行业挑战，相关要求需要进一步研究。'])
        row = proposal([premise(bundle, 'local_basis'),
                        premise(bundle, 'industry_requirement', 1, subject='高精度飞行控制系统')])
        out, _ = run(bundle, [row], chain=chain)
        self.assertEqual(out['node_judgments']['control']['method'], 'inference')

    def test_plain_json_fences_are_accepted_and_truncation_preserves_v1(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。'])
        row = proposal([premise(bundle, 'local_basis')])
        answers = [json.dumps({'nodes': [row]}, ensure_ascii=False),
                   json.dumps({'verdicts': [{'node_id': 'control', 'valid': True}]})]
        calls = []
        def fenced(*args):
            calls.append(args)
            return '```\n' + answers[len(calls)-1] + '\n```'
        out = build_reasoning(CONTEXT, bundle, CHAIN, FALLBACK, fenced)
        self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v2')
        out = build_reasoning(CONTEXT, bundle, CHAIN, FALLBACK, lambda *args: '{"nodes":[')
        self.assertEqual(out['node_judgments']['control'], FALLBACK['node_assessments']['control']['judgment'])

    def test_malformed_role_in_one_proposal_does_not_erase_another_valid_one(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。'])
        good = proposal([premise(bundle, 'local_basis')])
        bad = proposal([dict(premise(bundle, 'local_basis'), role=[])])
        out, _ = run(bundle, [bad, good])
        self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v2')

    def test_same_report_identity_and_business_support_only_yellow_enterprise_presence(self):
        bundle = enterprise_research()
        parts = [premise(bundle, 'local_presence', sentence=1, subject='示例装备股份有限公司'),
                 premise(bundle, 'enterprise_capability', index=1)]
        out, calls = run(bundle, [proposal(parts, 'enterprise_presence', reason='具名企业在本地注册，披露了对应产品业务布局。')])
        node = out['node_judgments']['control']
        self.assertEqual(len(calls), 2)
        self.assertEqual((node['level'], node['method']), ('mid', 'inference'))
        self.assertEqual(node['enterprise_links'][0]['relation'], 'same_disclosure')
        self.assertTrue(any('未核实该产品本地生产' in text for text in node['limitations']))
        out, calls = run(bundle, [proposal(parts, 'existing_basis')])
        self.assertEqual(len(calls), 1)
        self.assertEqual(out['node_judgments']['control']['contract'], 'chain-judgment-v1')

    def test_same_report_url_requirement_rejects_cross_company_disclosures(self):
        bundle = enterprise_research(same_report=False)
        row = proposal([premise(bundle, 'local_presence', sentence=1, subject='示例装备股份有限公司'),
                        premise(bundle, 'enterprise_capability', index=1)], 'enterprise_presence')
        _, calls = run(bundle, [row])
        self.assertEqual(len(calls), 1)
        bundle = enterprise_research(business_text='另一设备股份有限公司主要产品包括飞控系统，相关业务由本段介绍。')
        row = proposal([premise(bundle, 'local_presence', sentence=1, subject='示例装备股份有限公司'),
                        premise(bundle, 'enterprise_capability', index=1)], 'enterprise_presence')
        _, calls = run(bundle, [row])
        self.assertEqual(len(calls), 1)

    def test_only_website_attested_by_that_identity_can_supply_business(self):
        bundle = enterprise_research(website=True)
        row = proposal([premise(bundle, 'local_presence', sentence=1, subject='示例装备股份有限公司'),
                        premise(bundle, 'enterprise_capability', index=1)], 'enterprise_presence')
        out, _ = run(bundle, [row])
        self.assertEqual(out['node_judgments']['control']['enterprise_links'][0]['relation'], 'attested_website')
        for field, bad in [('evidence_id', 'forged'), ('source_id', 'forged'), ('domain', 'other.example.com'),
                           ('website_text', '公司网址 forged.example.com')]:
            altered = copy.deepcopy(bundle)
            altered['sources'][altered['evidence'][1]['source_id']]['website_attestation'][field] = bad
            _, calls = run(altered, [row])
            self.assertEqual(len(calls), 1)
        altered = copy.deepcopy(bundle)
        altered['sources'][altered['evidence'][1]['source_id']].pop('website_attestation')
        _, calls = run(altered, [row])
        self.assertEqual(len(calls), 1)

    def test_registration_pair_cannot_assert_local_production(self):
        bundle = enterprise_research()
        parts = [premise(bundle, 'local_presence', sentence=1, subject='示例装备股份有限公司'),
                 premise(bundle, 'enterprise_capability', index=1)]
        row = proposal(parts, 'enterprise_presence', reason='示例装备在闵行区已形成飞控系统本地生产能力。')
        _, calls = run(bundle, [row])
        self.assertEqual(len(calls), 1)

    def test_presence_requires_named_disclosure_identity_and_literal_node_business(self):
        bundle = enterprise_research()
        for subject in ['公司', '注册地址', '不存在企业有限公司']:
            row = proposal([premise(bundle, 'local_presence', sentence=1, subject=subject),
                            premise(bundle, 'enterprise_capability', index=1)], 'enterprise_presence')
            _, calls = run(bundle, [row])
            self.assertEqual(len(calls), 1)
        row = proposal([premise(bundle, 'local_presence', sentence=1, subject='示例装备股份有限公司'),
                        premise(bundle, 'enterprise_capability', index=1, subject='本公司')], 'enterprise_presence')
        _, calls = run(bundle, [row])
        self.assertEqual(len(calls), 1)
        altered = copy.deepcopy(bundle)
        altered['sources'][altered['evidence'][0]['source_id']]['source_type'] = 'company'
        row['premises'][1]['subject'] = '飞控系统'
        _, calls = run(altered, [row])
        self.assertEqual(len(calls), 1)

    def test_verified_enterprise_pair_plus_specific_dependency_is_provisional_risk(self):
        bundle = enterprise_research(website=True)
        extra = research(['我国飞控系统关键芯片依赖进口，相关供给自主性仍受到外部约束。'])
        bundle['sources'].update(extra['sources'])
        bundle['evidence'].extend(extra['evidence'])
        parts = [premise(bundle, 'local_presence', sentence=1, subject='示例装备股份有限公司'),
                 premise(bundle, 'enterprise_capability', index=1),
                 premise(bundle, 'industry_requirement', index=2)]
        row = proposal(parts, 'dependency_exposure', reason='企业业务与行业依赖存在关联，建议优先核实供应替代机会。')
        out, _ = run(bundle, [row])
        node = out['node_judgments']['control']
        self.assertEqual((node['level'], node['method'], node['status']), ('weak', 'inference', 'provisional'))
        self.assertTrue(any('未核实该产品本地生产' in text for text in node['limitations']))
        self.assertTrue(any('尚无该节点本地依赖率' in text for text in node['limitations']))

    def test_enterprise_mapping_still_requires_independent_review(self):
        bundle = enterprise_research()
        row = proposal([premise(bundle, 'local_presence', sentence=1, subject='示例装备股份有限公司'),
                        premise(bundle, 'enterprise_capability', index=1)], 'enterprise_presence')
        out, calls = run(bundle, [row], {'verdicts': [{'node_id': 'control', 'valid': False}]})
        self.assertEqual(len(calls), 2)
        self.assertEqual(out['node_judgments']['control'], FALLBACK['node_assessments']['control']['judgment'])

    def test_technical_target_is_not_confused_with_future_business_plan(self):
        bundle = enterprise_research(website=True,
            business_text='飞控系统作为实现目标控制功能的直接载体，对稳定性和可靠性要求较高。')
        row = proposal([premise(bundle, 'local_presence', sentence=1, subject='示例装备股份有限公司'),
                        premise(bundle, 'enterprise_capability', index=1)], 'enterprise_presence')
        out, _ = run(bundle, [row])
        self.assertEqual(out['node_judgments']['control']['rule'], 'enterprise_presence')
        planned = enterprise_research(website=True,
            business_text='企业计划开发飞控系统，未来将提供相关产品，具体安排仍待落实。')
        row = proposal([premise(planned, 'local_presence', sentence=1, subject='示例装备股份有限公司'),
                        premise(planned, 'enterprise_capability', index=1)], 'enterprise_presence')
        _, calls = run(planned, [row])
        self.assertEqual(len(calls), 1)
        planned = enterprise_research(website=True,
            business_text='未来计划开展新的产品业务。飞控系统包括若干部件，产品设计指标另行公布。')
        row = proposal([premise(planned, 'local_presence', sentence=1, subject='示例装备股份有限公司'),
                        premise(planned, 'enterprise_capability', index=1, sentence=1)], 'enterprise_presence')
        _, calls = run(planned, [row])
        self.assertEqual(len(calls), 1)

    def test_review_rejection_explanation_is_returned_without_overriding_false(self):
        bundle = research(['闵行区飞控系统生产线已实现量产，原始资料保留对应生产情况。'])
        row = proposal([premise(bundle, 'local_basis')])
        out, calls = run(bundle, [row], {'verdicts': [
            {'node_id': 'control', 'valid': False, 'reason': '原文没有证明该节点与被引用产线属于同一对象。'}]})
        self.assertEqual(out['node_judgments']['control'], FALLBACK['node_assessments']['control']['judgment'])
        self.assertFalse(out['review_diagnostics'][0]['valid'])
        self.assertIn('同一对象', out['review_diagnostics'][0]['reason'])
        self.assertIn('不要求项目已实施', calls[1][0])

    def test_real_product_showcase_cannot_establish_local_basis(self):
        quote='其中低空飞行器感知避障系统、LH-002A型低空监视雷达、轻量化惯性卫星组合导航系统、电动飞机电池管理系统、混合电推进供电系统、低空全域电气互连方案以及“中航空管云”低空运行监管服务平台等创新成果，为eVTOL、中大型无人机、通航飞行器安全规模化运行提供全栈支撑。'
        bundle=research([quote],titles=['低空机载产业“旗舰店”上线！全国首个选型中心落户闵行吴泾'])
        names=['低空飞行器感知避障系统','LH-002A型低空监视雷达','低空全域电气互连方案','低空运行监管服务平台']
        chain={'chain':[{'nodes':[{'id':str(i),'name':name} for i,name in enumerate(names)]}]}
        rows=[proposal([premise(bundle,'local_basis',subject=name)],node_id=str(i)) for i,name in enumerate(names)]
        out,calls=run(bundle,rows,chain=chain)
        self.assertEqual(len(calls), 1)
        self.assertTrue(all(j['level'] != 'strong' for j in out['node_judgments'].values()))

    def test_real_established_service_center_is_not_rejected_as_a_showcase(self):
        quote='同时，闵行组建全市首家区级低空飞行服务中心，出台低空经济专项扶持政策，设百亿级产业引导基金，从空域保障、场景开放、资金扶持、人才引育等维度，构建全周期产业支撑体系，持续吸引低空产业链企业集聚。'
        bundle=research([quote],titles=['低空机载产业“旗舰店”上线！全国首个选型中心落户闵行吴泾'])
        row=proposal([premise(bundle,'local_basis',subject='低空飞行服务中心')])
        chain={'chain':[{'nodes':[{'id':'control','name':'低空飞行服务中心'}]}]}
        out,calls=run(bundle,[row],chain=chain)
        self.assertEqual(len(calls),2)
        self.assertEqual(out['node_judgments']['control']['level'],'strong')

    def test_exact_address_subject_normalizes_only_to_unique_disclosure_company(self):
        bundle=enterprise_research(website=True)
        row=proposal([premise(bundle,'local_presence',sentence=1,subject='上海市闵行区示例路1号'),
                      premise(bundle,'enterprise_capability',index=1)],'enterprise_presence')
        out,calls=run(bundle,[row])
        self.assertEqual(len(calls),2)
        node=out['node_judgments']['control']
        self.assertEqual(node['level'],'mid')
        identity=node['premises'][0]
        self.assertEqual(identity['subject'],'示例装备股份有限公司')
        self.assertEqual(identity['original_subject'],'上海市闵行区示例路1号')
        self.assertEqual(identity['subject_normalization'],'unique_disclosure_identity')
        self.assertEqual(node['enterprise_links'][0]['company_subject'],'示例装备股份有限公司')
        self.assertIn('注册地址',identity['statement'])

    def test_address_normalization_rejects_other_or_partial_addresses_and_ambiguous_identity(self):
        bundle=enterprise_research()
        for subject in ['上海市闵行区示例路2号','闵行区示例路1号','另一个公司股份有限公司']:
            row=proposal([premise(bundle,'local_presence',sentence=1,subject=subject),
                          premise(bundle,'enterprise_capability',index=1)],'enterprise_presence')
            _,calls=run(bundle,[row])
            self.assertEqual(len(calls),1)
        identity='公司名称 示例装备股份有限公司。\n公司名称 另一装备股份有限公司。\n注册地址 上海市闵行区示例路1号。\n公司网址 www.example.com。'
        ambiguous=research([identity,'本公司主要产品包括飞控系统，提供相关技术服务。'])
        for source in ambiguous['sources'].values():source['source_type']='disclosure'
        row=proposal([premise(ambiguous,'local_presence',sentence=2,subject='上海市闵行区示例路1号'),
                      premise(ambiguous,'enterprise_capability',index=1)],'enterprise_presence')
        _,calls=run(ambiguous,[row])
        self.assertEqual(len(calls),1)


if __name__ == '__main__':
    unittest.main()
