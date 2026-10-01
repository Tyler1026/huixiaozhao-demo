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

    def test_min_lines_match_design(self):
        expected = {
            "economy": 150, "population": 150, "transport": 180, "life": 150,
            "industry": 180, "competition": 180, "policy": 200, "chain": 250,
            "enterprises_1": 250, "enterprises_2": 250, "enterprises_3": 250,
            "fact_check": 60, "scoring": 100, "action": 150, "summary": 80,
            "compact": 200,
        }
        for s in fc.STAGES:
            self.assertEqual(s["min_lines"], expected[s["id"]], s["id"])

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


if __name__ == "__main__":
    unittest.main()
