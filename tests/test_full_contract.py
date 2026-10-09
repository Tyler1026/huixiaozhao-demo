"""TDD contract tests for report_service.full_contract.

The full 16-stage pipeline contract is the durable, versioned definition of
what "a complete city report" means.  This module tests:

* the exact ``STAGES`` table (16 stages, ids, filenames, min_lines, research
  flag, structural parts);
* ``validate`` accepting well-formed outputs and rejecting structural gaps,
  fake/placeholder URLs, ``gov.cn`` path impersonation, repeated filler URLs,
  link-only evidence and under-specified company/check metadata;
* ``make_synthetic_part`` (deterministic, clearly labelled);
* ``assemble`` (deterministic, merges metadata lists and dedupes).

Everything is offline: no network, no model, no store.
"""

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from report_service import full_contract as fc  # noqa: E402


def _fixture_text(evidence):
    lines = ["# Offline test fixture only; no real-world factual claims"]
    lines += [f"[{i}] {e['excerpt']} Source: {e['url']}" for i, e in enumerate(evidence, 1)]
    lines += [f"Offline analysis item {i}: schema and source association test only." for i in range(300)]
    return "\n".join(lines)


def _good_evidence(url="https://stats.gov.cn/offline-fixture/0", more_lines=0):
    urls = [url] + [f"https://stats.gov.cn/offline-fixture/{i}" for i in range(1, 12)]
    evidence = [{"url": u, "title": f"Offline fixture {i}",
                 "excerpt": f"Offline test excerpt {i}: source association only, not actual statistics.",
                 "source": "Offline fixture", "published": "2024-03-01"}
                for i, u in enumerate(urls)]
    return _fixture_text(evidence), {"evidence": evidence}


class StageTableTests(unittest.TestCase):
    def test_exactly_sixteen_stages(self):
        self.assertEqual(len(fc.STAGES), 16)
        self.assertEqual([s["id"] for s in fc.STAGES], [
            "economy", "population", "transport", "life", "industry", "competition",
            "policy", "chain", "enterprises_1", "enterprises_2", "enterprises_3",
            "fact_check", "scoring", "action", "summary", "compact",
        ])

    def test_every_stage_has_contract_shape(self):
        for s in fc.STAGES:
            self.assertEqual(set(s.keys()), {"id", "filename", "min_lines", "research", "parts"})
            self.assertIsInstance(s["id"], str)
            self.assertIsInstance(s["filename"], str)
            self.assertIsInstance(s["min_lines"], int)
            self.assertGreater(s["min_lines"], 0)
            self.assertIsInstance(s["research"], bool)
            self.assertIsInstance(s["parts"], tuple)
            self.assertGreater(len(s["parts"]), 0)
            for p in s["parts"]:
                self.assertIsInstance(p, str)

    def test_filenames_match_design(self):
        expected = {
            "economy": "01a_economy.md",
            "population": "01b_population.md",
            "transport": "01c_transport_land.md",
            "life": "01d_life_support.md",
            "industry": "02_industry_direction.md",
            "competition": "03_competition.md",
            "policy": "04_policy_trends.md",
            "chain": "06_supply_chain_gaps.md",
            "enterprises_1": "05a_target_enterprises_dir1.md",
            "enterprises_2": "05b_target_enterprises_dir2.md",
            "enterprises_3": "05c_target_enterprises_dir3.md",
            "fact_check": "06b_fact_check.md",
            "scoring": "07_matching_score.md",
            "action": "08_action_plan.md",
            "summary": "00_executive_summary.md",
            "compact": "09_compact_report.md",
        }
        for s in fc.STAGES:
            self.assertEqual(s["filename"], expected[s["id"]], s["id"])

    def test_standard_min_lines_use_medium_profile(self):
        expected = {
            "economy": 80, "population": 80, "transport": 90, "life": 80,
            "industry": 100, "competition": 90, "policy": 100, "chain": 120,
            "enterprises_1": 150, "enterprises_2": 150, "enterprises_3": 150,
            "fact_check": 60, "scoring": 60, "action": 80, "summary": 40,
            "compact": 80,
        }
        for s in fc.STAGES:
            self.assertEqual(s["min_lines"], expected[s["id"]], s["id"])
            self.assertEqual(fc.get_stage(s['id'], mode='standard'), s)

    def test_deep_mode_keeps_original_floors_and_structure(self):
        expected = {
            "economy": 150, "population": 150, "transport": 180, "life": 150,
            "industry": 180, "competition": 180, "policy": 200, "chain": 250,
            "enterprises_1": 250, "enterprises_2": 250, "enterprises_3": 250,
            "fact_check": 60, "scoring": 100, "action": 150, "summary": 80,
            "compact": 80,
        }
        for s in fc.STAGES:
            deep = fc.get_stage(s['id'], mode='deep')
            self.assertEqual(deep["min_lines"], expected[s["id"]], s["id"])
            self.assertEqual(deep['filename'], s['filename'])
            self.assertEqual(deep['research'], s['research'])
            parts = s['parts']
            if s['id'].startswith('enterprises_'):
                parts = parts[:-1] + ('扩产信号4', '扩产信号5', parts[-1])
            self.assertEqual(deep['parts'], parts)

    def test_research_flag_coverage(self):
        research = {s["id"] for s in fc.STAGES if s["research"]}
        self.assertEqual(research, {
            "economy", "population", "transport", "life", "industry",
            "competition", "policy", "chain", "enterprises_1", "enterprises_2",
            "enterprises_3", "fact_check",
        })

    def test_get_stage(self):
        self.assertEqual(fc.get_stage("economy")["filename"], "01a_economy.md")

    def test_get_stage_unknown_raises_key_error(self):
        with self.assertRaises(KeyError):
            fc.get_stage("bogus")


class ValidateBasicsTests(unittest.TestCase):
    def test_valid_stage_passes(self):
        text, meta = _good_evidence()
        self.assertEqual(fc.validate("economy", text, meta), [])

    def test_unknown_stage_error(self):
        errs = fc.validate("bogus", "x", {})
        self.assertTrue(any("unknown" in e.lower() for e in errs))

    def test_empty_text_error(self):
        errs = fc.validate("economy", "", {})
        self.assertTrue(errs)

    def test_too_few_lines_error(self):
        errs = fc.validate("economy", "short\nbody\n", {})
        self.assertTrue(any("line" in e.lower() for e in errs))

    def test_synthetic_requires_marker(self):
        text, meta = _good_evidence()
        errs = fc.validate("economy", text, meta, synthetic=True)
        self.assertTrue(any("marker" in e.lower() or "synthetic" in e.lower() for e in errs))

    def test_synthetic_with_marker_passes(self):
        text, meta = _good_evidence()
        text = fc.SYNTHETIC_MARK + "\n" + text + "\n" + "占位\n" * 200
        self.assertEqual(fc.validate("economy", text, meta, synthetic=True), [])


class MediumProfileBoundaryTests(unittest.TestCase):
    def test_each_general_chapter_exact_floor_and_one_line_below_in_both_modes(self):
        _, metadata = _good_evidence()
        for stage in ('economy', 'population', 'transport', 'life',
                      'competition', 'policy', 'chain', 'action', 'summary'):
            for mode in ('standard', 'deep'):
                with self.subTest(stage=stage, mode=mode):
                    floor = fc.get_stage(stage, mode=mode)['min_lines']
                    text = '\n'.join(f'OFFLINE {stage} source-backed analysis fixture {i}'
                                     for i in range(floor))
                    self.assertEqual(fc.validate(stage, text, metadata, mode=mode), [])
                    errors = fc.validate(stage, '\n'.join(text.splitlines()[:-1]), metadata, mode=mode)
                    self.assertEqual(errors, [f"stage {stage!r} line count {floor - 1} < min_lines {floor}"])

    def test_standard_policy_length_does_not_satisfy_deep_mode(self):
        _, metadata = _good_evidence()
        text = '\n'.join(f'OFFLINE current policy clause analysis {i}' for i in range(100))
        self.assertEqual(fc.validate('policy', text, metadata), [])
        self.assertEqual(fc.validate('policy', text, metadata, mode='deep'), [
            "stage 'policy' line count 100 < min_lines 200"])

    def test_source_floor_exact_boundary_for_each_mode(self):
        _, metadata = _good_evidence()
        for mode, floor in (('standard', 5), ('deep', 8)):
            with self.subTest(mode=mode):
                self.assertEqual(fc.minimum_evidence_urls(mode), floor)
                enough = {'evidence': metadata['evidence'][:floor]}
                self.assertEqual(fc.validate('population', _fixture_text(enough['evidence']), enough, mode=mode), [])
                short = {'evidence': metadata['evidence'][:floor - 1]}
                errors = fc.validate('population', _fixture_text(short['evidence']), short, mode=mode)
                self.assertEqual(errors, [f"live research stage 'population' cites only {floor - 1} distinct source URL(s) < {floor}"])
        self.assertEqual(fc.minimum_evidence_urls(), 5)
        with self.assertRaises(ValueError):
            fc.minimum_evidence_urls('unknown')

    def test_private_evidence_helper_retains_legacy_deep_default(self):
        _, metadata = _good_evidence()
        metadata['evidence'] = metadata['evidence'][:5]
        self.assertEqual(fc._validate_evidence(True, metadata, False, 'economy'), [
            "live research stage 'economy' cites only 5 distinct source URL(s) < 8"])
        self.assertEqual(fc._validate_evidence(True, metadata, False, 'economy', mode='standard'), [])

    def test_query_variants_still_cannot_fill_standard_source_floor(self):
        evidence = [{'url': f'https://stats.gov.cn/offline-one-source?query={i}',
                     'excerpt': f'OFFLINE retrieval excerpt {i}'} for i in range(5)]
        errors = fc.validate('economy', _fixture_text(evidence), {'evidence': evidence})
        self.assertIn("live research stage 'economy' cites only 1 distinct source URL(s) < 5", errors)

    def test_smaller_source_floor_preserves_validity_excerpt_and_url_filler_guards(self):
        _, metadata = _good_evidence()
        for mode in ('standard', 'deep'):
            for defect in ('http', 'empty_excerpt', 'link_only_excerpt'):
                with self.subTest(mode=mode, defect=defect):
                    evidence = copy.deepcopy(metadata['evidence'][:fc.minimum_evidence_urls(mode)])
                    if defect == 'http':
                        evidence[0]['url'] = evidence[0]['url'].replace('https:', 'http:')
                    else:
                        evidence[0]['excerpt'] = '' if defect == 'empty_excerpt' else evidence[0]['url']
                    errors = fc.validate('economy', _fixture_text(evidence), {'evidence': evidence}, mode=mode)
                    self.assertTrue(any(('https' if defect == 'http' else 'excerpt') in e.lower()
                                        for e in errors), errors)
        evidence = metadata['evidence'][:5]
        repeated_url = '\n'.join(f'OFFLINE distinct statement {i} cites {evidence[0]["url"]}' for i in range(5))
        errors = fc.validate('economy', _fixture_text(evidence) + '\n' + repeated_url, {'evidence': evidence})
        self.assertTrue(any('URL repeated' in e for e in errors), errors)

    def test_medium_scoring_keeps_all_dimensions_and_computed_score_checks(self):
        scores = fc.rank_scores([{'name': f'OFFLINE company {i}', 'direction': 'dir1',
                                 'dimensions': {key: 6 for key in fc.SCORE_DIMENSIONS}}
                                for i in range(15)])
        text = '\n'.join(f'OFFLINE score justification {i}' for i in range(60))
        self.assertEqual(fc.validate('scoring', text, {'scores': scores}), [])
        missing_dimension = copy.deepcopy(scores)
        del missing_dimension[0]['dimensions']['risk']
        self.assertTrue(fc.validate('scoring', text, {'scores': missing_dimension}))
        incorrect_total = copy.deepcopy(scores)
        incorrect_total[0]['weighted_score'] = 0
        self.assertTrue(fc.validate('scoring', text, {'scores': incorrect_total}))


class ConciseCompactTests(unittest.TestCase):
    def test_compact_exact_floor_and_one_line_below_in_both_modes(self):
        for mode in ('standard', 'deep'):
            with self.subTest(mode=mode):
                metadata = {'presentation_note': '原始研究和全部评分保留在前序产物'}
                text = '\n'.join(f'OFFLINE精简版具体依据、风险及行动{index}' for index in range(80))
                original = copy.deepcopy(metadata)
                self.assertEqual(fc.validate('compact', text, metadata, mode=mode), [])
                short = '\n'.join(text.splitlines()[:-1])
                self.assertEqual(fc.validate('compact', short, metadata, mode=mode), [
                    "stage 'compact' line count 79 < min_lines 80"])
                self.assertEqual(metadata, original)

    def test_concise_output_still_rejects_repeated_filler_and_unsafe_urls(self):
        for mode in ('standard', 'deep'):
            with self.subTest(mode=mode):
                repeated = '\n'.join(['重复通用说明'] * 80)
                self.assertIn('repeated filler exceeds 20 percent of substantive lines',
                              fc.validate('compact', repeated, {}, mode=mode))
                text = '\n'.join(f'OFFLINE精简版具体行动{index}' for index in range(79))
                self.assertTrue(any('https' in error.lower() for error in
                                    fc.validate('compact', text + '\nhttp://stats.gov.cn/offline', {}, mode=mode)))


class ValidateUrlTests(unittest.TestCase):
    def test_rejects_fake_path_gov_cn(self):
        text, meta = _good_evidence(url="https://example.invalid/gov.cn/fake")
        errs = fc.validate("economy", text, meta)
        self.assertTrue(any("gov.cn" in e for e in errs), errs)

    def test_rejects_placeholder_host(self):
        text, meta = _good_evidence(url="https://example.com/stats")
        errs = fc.validate("economy", text, meta)
        self.assertTrue(any("placeholder" in e.lower() or "trusted" in e.lower() or "host" in e.lower() for e in errs), errs)

    def test_rejects_non_https(self):
        text = "来源 http://stats.gov.cn/a\n" + "\n" * 200
        errs = fc.validate("economy", text, {})
        self.assertTrue(any("https" in e.lower() for e in errs), errs)

    def test_rejects_repeated_filler_url(self):
        url = "https://stats.gov.cn/tjgb/2024"
        text = (url + "\n") * 12 + "\n" * 200
        errs = fc.validate("economy", text, {})
        self.assertTrue(any("filler" in e.lower() and url in e or "repeat" in e.lower() for e in errs), errs)

    def test_accepts_trusted_gov_domain(self):
        text, meta = _good_evidence(url="https://www.gov.cn/zhengce/2024")
        self.assertEqual(fc.validate("economy", text, meta), [])


class ValidateMetadataTests(unittest.TestCase):
    def test_evidence_link_only_rejected(self):
        text = "# 概况\n" + "来源 https://stats.gov.cn/tjgb\n" + "\n" * 200
        meta = {"evidence": [{"url": "https://stats.gov.cn/tjgb", "excerpt": ""}]}
        errs = fc.validate("economy", text, meta)
        self.assertTrue(any("excerpt" in e.lower() or "link" in e.lower() for e in errs), errs)

    def test_evidence_excerpt_must_not_be_just_url(self):
        text = ("# 概况\n" + "\n" * 200)
        url = "https://stats.gov.cn/tjgb"
        meta = {"evidence": [{"url": url, "excerpt": url}]}
        errs = fc.validate("economy", text, meta)
        self.assertTrue(any("excerpt" in e.lower() for e in errs), errs)

    def test_evidence_untrusted_host_rejected(self):
        text = ("# 概况\n" + "\n" * 200)
        meta = {"evidence": [{"url": "https://example.invalid/x", "excerpt": "stuff",
                              "source": "假"}]}
        errs = fc.validate("economy", text, meta)
        self.assertTrue(errs)

    def test_research_evidence_absent_rejected(self):
        text, meta = _good_evidence()
        self.assertEqual(fc.validate("economy", text, meta), [])
        for absent in (None, {}, {"evidence": []}):
            with self.subTest(metadata=absent):
                errs = fc.validate("economy", text, absent)
                self.assertTrue(any("evidence" in e.lower() or "source" in e.lower() for e in errs), errs)

    def test_metadata_may_be_absent(self):
        text = fc.SYNTHETIC_MARK + "\n" + "# 概况\n" + "占位\n" * 200
        # non-research synthesis stage with no metadata requirement
        self.assertEqual(fc.validate("summary", text, None, synthetic=True), [])


class ValidateCompanyTests(unittest.TestCase):
    def _companies(self, n=25, n_sel=15):
        cands = []
        for i in range(n):
            cands.append({"name": f"离线测试候选{i}", "url": f"https://cninfo.com.cn/offline-fixture/c{i}",
                          "evidence_ref": f"https://cninfo.com.cn/offline-fixture/c{i}",
                          "landing_status": "待核实", "segment": "环节", "reason": "r"})
        sel = []
        for i in range(n_sel):
            sel.append({"name": f"离线测试候选{i}", "url": f"https://cninfo.com.cn/offline-fixture/c{i}",
                          "evidence_ref": f"https://cninfo.com.cn/offline-fixture/c{i}",
                        "landing_status": "已落地", "segment": "环节",
                        "expansion_evidence": "离线测试扩产字段，不构成真实企业公告",
                        "expansion_date": "2024-06-01",
                        "rationale": "匹配", "uncertainty": "仅测试夹具"})
        return cands, sel

    def _fixture(self, cands, sel):
        evidence = [{"url": c["url"], "title": c["name"],
                     "excerpt": f"离线测试：{c['name']}的落地及扩产字段，仅用于契约测试。",
                     "source": "Offline disclosure fixture", "published": "2024-06-01"}
                    for c in cands]
        return _fixture_text(evidence), {"evidence": evidence, "candidates": cands, "selected": sel}

    def test_invalid_corporate_evidence_ref_rejected(self):
        for kind in ("candidates", "selected"):
            with self.subTest(kind=kind):
                cands, sel = self._companies()
                text, meta = self._fixture(cands, sel)
                self.assertEqual(fc.validate("enterprises_1", text, meta), [])
                meta[kind][0]["landing_status"] = "已落地"
                meta[kind][0]["evidence_ref"] = "https://cninfo.com.cn/offline-fixture/unretrieved"
                errs = fc.validate("enterprises_1", text, meta)
                self.assertTrue(any("evidence_ref" in e for e in errs), errs)

    def test_valid_enterprise_stage_passes(self):
        cands, sel = self._companies()
        text, meta = self._fixture(cands, sel)
        self.assertEqual(fc.validate("enterprises_1", text, meta), [])

    def test_medium_enterprise_body_preserves_selection_identity_and_factual_binding(self):
        cands, selected = self._companies()
        text, metadata = self._fixture(cands, selected)
        text = '\n'.join(text.splitlines()[:150])
        self.assertEqual(fc.validate('enterprises_1', text, metadata), [])
        for defect in ('unretrieved_identity', 'absent_from_pool', 'unbound_landing'):
            with self.subTest(defect=defect):
                invalid = copy.deepcopy(metadata)
                item = invalid['selected'][0]
                if defect == 'unretrieved_identity':
                    item['url'] = 'https://company.cn/offline-unretrieved'
                    expected = 'company identity needs a retrieved source URL'
                elif defect == 'absent_from_pool':
                    item['name'] = 'OFFLINE absent company'
                    expected = 'selected company is absent from candidate pool'
                else:
                    del item['evidence_ref']
                    expected = 'requires an'
                errors = fc.validate('enterprises_1', text, invalid)
                self.assertTrue(any(expected in e for e in errors), errors)

    def test_deep_mode_requires_twenty_five_distinct_final_companies(self):
        for count in (15, 24):
            cands, sel = self._companies(n_sel=count)
            text, meta = self._fixture(cands, sel)
            self.assertEqual(fc.validate('enterprises_1', text, meta), [])
            errors = fc.validate('enterprises_1', text, meta, mode='deep')
            self.assertTrue(any('final companies' in e and '< 25' in e for e in errors), errors)
        cands, sel = self._companies(n_sel=25)
        text, meta = self._fixture(cands, sel)
        self.assertEqual(fc.validate('enterprises_1', text, meta, mode='deep'), [])
        self.assertEqual(fc.validate('enterprises_1', text, meta, mode='unknown'), ['invalid report mode'])

    def test_candidate_pool_below_25_rejected(self):
        cands, sel = self._companies(n=24)
        text, meta = self._fixture(cands, sel)
        errs = fc.validate("enterprises_1", text, meta)
        self.assertTrue(any("25" in e or "candidate" in e.lower() for e in errs), errs)

    def test_final_below_15_unique_rejected(self):
        cands, sel = self._companies(n=25, n_sel=14)
        text, meta = self._fixture(cands, sel)
        errs = fc.validate("enterprises_1", text, meta)
        self.assertTrue(any("15" in e or "select" in e.lower() for e in errs), errs)

    def test_duplicate_selected_names_do_not_count_towards_15(self):
        cands, _ = self._companies()
        duplicated = [{"name": "同一家", "landing_status": "已落地", "segment": "s"} for _ in range(15)]
        text, meta = self._fixture(cands, duplicated)
        errs = fc.validate("enterprises_1", text, meta)
        self.assertTrue(any("15" in e or "select" in e.lower() for e in errs), errs)

    def test_missing_landing_status_rejected(self):
        cands, sel = self._companies()
        del sel[0]["landing_status"]
        text, meta = self._fixture(cands, sel)
        errs = fc.validate("enterprises_1", text, meta)
        self.assertTrue(any("landing" in e.lower() for e in errs), errs)

    def test_missing_expansion_evidence_rejected(self):
        cands, sel = self._companies()
        del sel[0]["expansion_evidence"]
        text, meta = self._fixture(cands, sel)
        errs = fc.validate("enterprises_1", text, meta)
        self.assertTrue(any("expansion" in e.lower() for e in errs), errs)


class ValidateFactCheckTests(unittest.TestCase):
    def _build(self, n_econ=5, n_policy=3, n_star=9):
        categories = ([('economic', None)] * n_econ + [('policy', None)] * n_policy
                      + [('high_star', f'dir{i % 3 + 1}') for i in range(n_star)])
        return [{"claim": f"Offline test claim {i}; not a real-world assertion", "category": cat,
                 "direction": direction, "source": f"https://stats.gov.cn/offline-fixture/check/{i}",
                 "cross_source": f"https://www.gov.cn/offline-fixture/check/{i}",
                 "year": "2024", "verdict": "测试一致"}
                for i, (cat, direction) in enumerate(categories)]

    def _fixture(self, checks):
        evidence = [{"url": c[key], "title": c["claim"],
                     "excerpt": c["claim"] + "; offline cross-check schema fixture only.",
                     "source": "Offline fixture", "published": "2024-01-01"}
                    for c in checks for key in ("source", "cross_source")]
        return _fixture_text(evidence), {"evidence": evidence, "checks": checks}

    def test_valid_fact_check_passes(self):
        text, meta = self._fixture(self._build())
        self.assertEqual(fc.validate("fact_check", text, meta), [])

    def test_below_12_checks_rejected(self):
        text, meta = self._fixture(self._build(n_econ=4, n_policy=2, n_star=1))
        errs = fc.validate("fact_check", text, meta)
        self.assertTrue(any("12" in e for e in errs), errs)

    def test_economic_coverage_below_5_rejected(self):
        text, meta = self._fixture(self._build(n_econ=4, n_policy=5))
        errs = fc.validate("fact_check", text, meta)
        self.assertTrue(any("economic" in e.lower() and "4" in e for e in errs), errs)

    def test_duplicate_checks_do_not_count(self):
        text, meta = self._fixture(self._build())
        self.assertEqual(fc.validate("fact_check", text, meta), [])
        checks = meta["checks"]
        meta["checks"] = [dict(checks[0]) for _ in range(5)] + checks[5:]
        errs = fc.validate("fact_check", text, meta)
        self.assertTrue(any("economic" in e.lower() or "duplicate" in e.lower()
                            or "unique" in e.lower() for e in errs), errs)

    def test_unavailable_high_star_flag_gracefully_accepted(self):
        text, meta = self._fixture(self._build(n_econ=6, n_policy=6, n_star=0))
        meta.update(high_star_unavailable=True,
                    high_star_note="离线测试情景：未提供可核实的五星企业信号，不编造信号。")
        self.assertEqual(fc.validate("fact_check", text, meta), [])


class SyntheticAndAssembleTests(unittest.TestCase):
    def test_make_synthetic_part_returns_dict_and_marker(self):
        out = fc.make_synthetic_part("economy", "经济总量", {"city": "杭州", "province": "浙江"}, None)
        self.assertIn("text", out)
        self.assertIn("metadata", out)
        self.assertIn(fc.SYNTHETIC_MARK, out["text"])
        self.assertIsInstance(out["metadata"], dict)
        self.assertIn("evidence", out["metadata"])

    def test_make_synthetic_part_deterministic(self):
        job = {"city": "杭州", "province": "浙江"}
        a = fc.make_synthetic_part("economy", "经济总量", job, None)
        b = fc.make_synthetic_part("economy", "经济总量", job, None)
        self.assertEqual(a, b)

    def test_make_synthetic_part_unknown_stage(self):
        with self.assertRaises(KeyError):
            fc.make_synthetic_part("bogus", "p", {}, None)

    def test_make_synthetic_part_unknown_part(self):
        with self.assertRaises(ValueError):
            fc.make_synthetic_part("economy", "不存在的部分", {}, None)

    def test_assemble_produces_text_and_metadata(self):
        parts = [
            fc.make_synthetic_part("economy", "经济总量", {"city": "杭州"}, None),
            fc.make_synthetic_part("economy", "增长态势", {"city": "杭州"}, None),
        ]
        out = fc.assemble("economy", parts)
        self.assertIn("text", out)
        self.assertIn("metadata", out)
        self.assertIn(fc.SYNTHETIC_MARK, out["text"])

    def test_assemble_deterministic_merge(self):
        parts = [fc.make_synthetic_part("economy", "经济总量", {"city": "杭州"}, None)]
        a = fc.assemble("economy", parts)
        b = fc.assemble("economy", parts)
        self.assertEqual(a, b)

    def test_assemble_merges_and_dedupes_evidence(self):
        e = {"url": "https://stats.gov.cn/t", "title": "t", "excerpt": "e",
             "source": "s", "published": "2024"}
        p1 = {"text": "A\n" + fc.SYNTHETIC_MARK, "metadata": {"evidence": [dict(e)]}}
        p2 = {"text": "B\n" + fc.SYNTHETIC_MARK, "metadata": {"evidence": [dict(e), dict(e, url="https://stats.gov.cn/t2")]}}
        out = fc.assemble("summary", [p1, p2])
        urls = [x["url"] for x in out["metadata"]["evidence"]]
        self.assertEqual(urls, ["https://stats.gov.cn/t", "https://stats.gov.cn/t2"])


class EvidenceObservationMergeTests(unittest.TestCase):
    url = 'https://cninfo.com.cn/offline/source'

    def record(self, excerpt, **metadata):
        return {'url': self.url, 'title': 'OFFLINE source', 'excerpt': excerpt,
                'published': '2026-01-01', 'retrieved_at': '2026-10-09T01:00:00Z',
                'retrieval': 'exa_fulltext', 'source_type': 'disclosure', **metadata}

    @staticmethod
    def recover(record):
        if 'observations' not in record:
            return [record]
        return [dict(observation['metadata'], excerpt=record['excerpt'][
            observation['excerpt_offset']:observation['excerpt_offset'] + observation['excerpt_length']])
                for observation in record['observations']]

    def test_cross_part_same_url_keeps_each_excerpt_metadata_and_inputs(self):
        old = self.record('首轮摘录仅含企业甲', custom={'original': ['字段保留']})
        new = self.record('补轮摘录新增企业乙', title='补检标题', published='2026-09-01',
                          retrieved_at='2026-10-09T02:00:00Z', retrieval='brave_snippet')
        parts = [{'text': '首次完整正文', 'metadata': {'evidence': [old]}},
                 {'text': '补齐完整正文', 'metadata': {'evidence': [new],
                  'candidates': [{'name': '企业乙', 'url': self.url}]}}]
        original = copy.deepcopy(parts)
        out = fc.assemble('enterprises_1', parts)
        self.assertEqual(parts, original)
        self.assertEqual(len(out['metadata']['evidence']), 1)
        record = out['metadata']['evidence'][0]
        self.assertEqual(record['url'], self.url)
        self.assertEqual(record['excerpt'], old['excerpt'] + '\n\n' + new['excerpt'])
        self.assertEqual(self.recover(record), [old, new])
        self.assertEqual(out['metadata']['candidates'][0]['url'], self.url)

    def test_complete_query_urls_remain_recoverable_in_same_part(self):
        first = self.record('实际查询一摘录', url=self.url + '?query=first')
        second = self.record('实际查询二摘录', url=self.url + '?query=second')
        result = fc.assemble('summary', [{'text': '正文', 'metadata': {
            'evidence': [first, second, dict(first)]}}])
        self.assertEqual(result['metadata']['evidence'], [first, second])
        self.assertEqual(len({fc.canonical_url(item['url']) for item in result['metadata']['evidence']}), 1)

    def test_same_excerpt_is_stored_once_with_all_original_observations(self):
        first = self.record('一次存储的完整摘录' * 100)
        second = self.record(first['excerpt'], title='不同标题', published='发布日期未知',
                             retrieved_at='2026-10-09T02:00:00Z', retrieval='brave_snippet', extra='原未知字段')
        result = fc.merge_evidence_records([first, second, first])[0]
        self.assertEqual(result['excerpt'], first['excerpt'])
        self.assertEqual(self.recover(result), [first, second])
        self.assertEqual([observation['excerpt_offset'] for observation in result['observations']], [0, 0])
        self.assertTrue(all('excerpt' not in observation['metadata'] for observation in result['observations']))

    def test_repeated_assembly_is_idempotent_without_nested_or_growing_history(self):
        first = self.record('首检原摘录' * 200)
        second = self.record('补检原摘录' * 200, retrieved_at='2026-10-09T02:00:00Z')
        part = {'text': '原正文', 'metadata': {'evidence': [first, second]}}
        assembled = fc.assemble('summary', [part])
        original = copy.deepcopy(assembled)
        expected = json.dumps(assembled['metadata'], ensure_ascii=False, sort_keys=True)
        for _ in range(20):
            assembled = fc.assemble('summary', [assembled, part])
            self.assertEqual(json.dumps(assembled['metadata'], ensure_ascii=False, sort_keys=True), expected)
        self.assertEqual(fc.merge_evidence_records(original['metadata']['evidence']), original['metadata']['evidence'])
        self.assertEqual(self.recover(assembled['metadata']['evidence'][0]), [first, second])
        self.assertTrue(all('observations' not in item['metadata']
                            for item in assembled['metadata']['evidence'][0]['observations']))

    def test_query_variants_do_not_relax_distinct_source_or_two_source_gates(self):
        records = fc.merge_evidence_records([
            self.record('真实来源一摘录', url=self.url + '?query=first'),
            self.record('同来源查询二摘录', url=self.url + '?query=second')])
        metadata = {'evidence': records, 'checks': [{
            'claim': 'OFFLINE核验主张', 'category': 'economic', 'year': '2026',
            'source': records[0]['url'], 'cross_source': records[1]['url'], 'verdict': '待核实'}]}
        self.assertTrue(any('distinct source URL' in error
                            for error in fc._validate_evidence(True, metadata, False, 'economy')))
        self.assertTrue(any('not independent' in error
                            for error in fc._validate_checks('fact_check', metadata, False)))

    def test_invalid_evidence_is_not_hidden_by_a_valid_same_url_record(self):
        valid = self.record('有效原摘录')
        invalid = self.record('')
        records = fc.merge_evidence_records([valid, invalid])
        self.assertEqual(records, [valid, invalid])
        self.assertTrue(fc._validate_evidence(True, {'evidence': records}, True, 'economy'))


class CompanyMetadataMergeTests(unittest.TestCase):
    @staticmethod
    def evidence(url):
        return {'url': url, 'excerpt': 'OFFLINE source association fixture'}

    @staticmethod
    def company(name='离线企业甲', url='https://cninfo.com.cn/offline/initial', **fields):
        return {'name': name, 'url': url, 'landing_status': '待核实',
                'expansion_evidence': '待核实', 'expansion_date': '发布日期未知',
                'reason': '保留初筛理由', 'rationale': '待核实',
                'uncertainty': '保留已有风险说明', **fields}

    def test_grounded_update_improves_unknown_fields_without_reordering_or_mutation(self):
        old_url = 'https://cninfo.com.cn/offline/initial'
        new_url = 'https://cninfo.com.cn/offline/verified'
        b_url, c_url = 'https://cninfo.com.cn/offline/b', 'https://cninfo.com.cn/offline/c'
        for key in ('candidates', 'selected'):
            with self.subTest(key=key):
                initial = self.company()
                verified = self.company(url=new_url, evidence_ref=new_url, landing_status='已落地',
                                        expansion_evidence='OFFLINE 后续研究扩产证据', expansion_date='2026-10-08',
                                        rationale='OFFLINE 后续匹配理由', reason='', uncertainty='待核实')
                parts = [
                    {'text': 'OFFLINE 初筛', 'metadata': {'evidence': [self.evidence(old_url), self.evidence(b_url)],
                                                        key: [initial, self.company('离线企业乙', b_url)]}},
                    # Company arrays preceding evidence exercise JSON key-order independence.
                    {'text': 'OFFLINE 后续核验', 'metadata': {key: [verified, self.company('离线企业丙', c_url)],
                                                            'evidence': [self.evidence(new_url), self.evidence(c_url)]}},
                ]
                original = copy.deepcopy(parts)
                output = fc.assemble('enterprises_1', parts)
                self.assertEqual([item['name'] for item in output['metadata'][key]],
                                 ['离线企业甲', '离线企业乙', '离线企业丙'])
                updated = output['metadata'][key][0]
                for field in ('url', 'evidence_ref', 'landing_status', 'expansion_evidence', 'expansion_date', 'rationale'):
                    self.assertEqual(updated[field], verified[field])
                self.assertEqual(updated['reason'], initial['reason'])
                self.assertEqual(updated['uncertainty'], initial['uncertainty'])
                self.assertEqual(output, fc.assemble('enterprises_1', parts))
                self.assertEqual(parts, original)

    def test_later_unknown_does_not_erase_grounded_landing_signal_date_or_notes(self):
        first_url = 'https://cninfo.com.cn/offline/verified'
        next_url = 'https://cninfo.com.cn/offline/later'
        known = self.company(url=first_url, evidence_ref=first_url, landing_status='区域已布局',
                             expansion_evidence='OFFLINE 已保存扩产信号', expansion_date='2026-09-01',
                             rationale='OFFLINE 已保存匹配理由')
        unknown = self.company(url=next_url, evidence_ref=next_url, expansion_date='unknown',
                               reason='   ', rationale='', uncertainty='年份未知')
        for key in ('candidates', 'selected'):
            with self.subTest(key=key):
                parts = [
                    {'text': 'OFFLINE 已核验', 'metadata': {'evidence': [self.evidence(first_url)], key: [known]}},
                    {'text': 'OFFLINE 未获得更多结论', 'metadata': {'evidence': [self.evidence(next_url)], key: [unknown]}},
                ]
                merged = fc.assemble('enterprises_1', parts)['metadata'][key][0]
                self.assertEqual(merged['url'], next_url)
                for field in ('landing_status', 'evidence_ref', 'expansion_evidence', 'expansion_date',
                              'reason', 'rationale', 'uncertainty'):
                    self.assertEqual(merged[field], known[field])

    def test_later_retrieved_identity_corrects_unretrieved_company_homepage(self):
        source = 'https://cninfo.com.cn/offline/verified'
        old = self.company(url='https://company.cn/unretrieved-homepage')
        corrected = self.company(url=source, evidence_ref=source)
        parts = [
            {'text': 'OFFLINE 旧身份链接', 'metadata': {'candidates': [old], 'selected': [old]}},
            {'text': 'OFFLINE 检索身份来源', 'metadata': {'candidates': [corrected], 'selected': [corrected],
                                                      'evidence': [self.evidence(source)]}},
        ]
        metadata = fc.assemble('enterprises_1', parts)['metadata']
        for key in ('candidates', 'selected'):
            self.assertEqual(len(metadata[key]), 1)
            self.assertEqual(metadata[key][0]['url'], source)
            self.assertEqual(metadata[key][0]['evidence_ref'], source)
        self.assertFalse(any('company identity' in error
                             for error in fc._validate_companies('enterprises_1', metadata, False)))

    def test_unretrieved_or_empty_source_cannot_replace_established_fields(self):
        source = 'https://cninfo.com.cn/offline/verified'
        next_url = 'https://cninfo.com.cn/offline/unretrieved'
        known = self.company(url=source, evidence_ref=source, landing_status='已落地',
                             expansion_evidence='OFFLINE 已保存扩产信号', expansion_date='2026-09-01')
        claimed = self.company(url=next_url, evidence_ref=next_url, landing_status='未落地',
                               expansion_evidence='OFFLINE 未检索到的新主张', expansion_date='2026-10-08')
        for evidence in ([], [{'url': next_url, 'excerpt': ''}]):
            with self.subTest(evidence=evidence):
                parts = [
                    {'text': 'OFFLINE 已有事实', 'metadata': {'evidence': [self.evidence(source)], 'selected': [known]}},
                    {'text': 'OFFLINE 未有依据的后续主张', 'metadata': {'evidence': evidence, 'selected': [claimed]}},
                ]
                self.assertEqual(fc.assemble('enterprises_1', parts)['metadata']['selected'][0], known)

    def test_landing_update_cannot_borrow_earlier_reference_to_ground_a_new_claim(self):
        source = 'https://cninfo.com.cn/offline/verified'
        original = self.company(url=source, evidence_ref=source)
        claimed = self.company(url=source, landing_status='已落地')
        parts = [
            {'text': 'OFFLINE 初筛', 'metadata': {'evidence': [self.evidence(source)], 'candidates': [original]}},
            {'text': 'OFFLINE 没有绑定来源的新落地结论', 'metadata': {'candidates': [claimed]}},
        ]
        merged = fc.assemble('enterprises_1', parts)['metadata']['candidates'][0]
        self.assertEqual(merged['landing_status'], '待核实')


if __name__ == "__main__":
    unittest.main()
