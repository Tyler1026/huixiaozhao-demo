"""Durable full-report contract: the versioned definition of a complete report.

This module owns the static, ordered, versioned pipeline contract for the full
16-stage city report. It is intentionally independent of the store, the worker,
the API and the website; it depends only on the Python standard library so it
can be imported anywhere (including a multiprocessing-spawned child) without a
network call, a model call or a database handle.

The contract describes *what* a complete report is, not *how* each stage is
produced:

* :data:`STAGES` — an ordered tuple of 16 stage descriptors.  Each descriptor is
  a plain ``dict`` with the exact keys ``id`` (str), ``filename`` (str, the
  required Markdown artifact name matching the design), ``min_lines`` (int, the
  structural line floor), ``research`` (bool, whether the stage requires
  retrieved source evidence rather than pure synthesis), and ``parts`` (a
  non-empty tuple of structural sub-section ids that split a long stage across
  multiple bounded model calls so a single 8000-token budget never silently
  truncates a required artifact).

* :func:`get_stage` — look up a stage descriptor by id.

* :func:`validate` — a *structural* gate, deliberately separate from content
  truth.  It returns a list of human-readable error strings (empty means the
  artifact passes).  It checks line floors, the synthetic marker, URL hygiene
  (https-only, canonical unique URLs, hostname parsing, no ``gov.cn`` path
  impersonation, no repeated filler URL, a minimum distinct-source floor for
  live research), and the shape/grounding of the explicit ``evidence`` /
  ``companies`` / ``checks`` / ``scores`` metadata (candidate pool >= 25,
  >= 15 standard / 25 deep unique final companies per direction with grounded ``landing_status``
  and dated ``expansion_evidence``; >= 12 independent fact checks covering
  economic / policy / high-star signals; Python-computed weighted scores and
  ranks).

* :func:`make_synthetic_part` — deterministic, offline, always-labelled
  synthetic part used to prove pipeline connectivity (not research quality).

* :func:`assemble` — deterministically merge a stage's parts into a single
  ``{'text', 'metadata'}`` result, merging and dedup-ing the metadata lists.

Metadata shapes (see docstrings of ``validate`` and ``make_synthetic_part``):

* ``evidence``: list of ``{"url", "title", "excerpt", "source", "published",
  "retrieval", "source_type"}``.  ``retrieval`` is ``exa_fulltext`` when the
  search provider returned original page text, ``brave_snippet`` otherwise.
  ``source_type`` is ``government`` / ``official_media`` / ``disclosure`` /
  ``company`` — company-official URLs are permitted as evidence about *that
  company* but are never elevated to government authority. When one complete
  URL has multiple retrieval records, ``observations`` retains their original
  metadata and each excerpt's character offset/length in the merged excerpt;
  query variants stay separate while source floors still count canonical URLs.

* ``companies`` (candidate pool): list of ``{"name", "url", "landing_status",
  "segment", "reason", "evidence_ref"}``.  ``evidence_ref`` binds the entity to
  a retrieved evidence source (a canonical URL); it is required whenever
  ``landing_status`` makes a factual claim (landed / not-landed / laid-out /
  planned), but is optional for the honest ``待核实`` / ``待招引`` statuses.

* ``selected`` (final per-direction companies): list of ``{"name", "url",
  "landing_status", "segment", "expansion_evidence", "expansion_date",
  "rationale", "uncertainty", "evidence_ref"}``.

* ``checks`` (fact-check): list of ``{"claim", "source", "cross_source",
  "year", "verdict", "category", "direction"}`` where ``category`` is one of
  ``economic`` / ``policy`` / ``high_star`` and ``source``/``cross_source`` are
  *independent* (distinct canonical) evidence URLs.

* ``scores`` (scoring): list of ``{"name", "direction", "dimensions",
  "weighted_score", "rank"}``.  ``dimensions`` is the model's per-candidate
  0-10 sub-scores (never the weighted total); ``weighted_score`` / ``rank`` are
  computed *in Python* via :func:`compute_weighted_score` / :func:`rank_scores`.
  Risk is inverted (higher risk reduces the score).

Source-count / line floors are structural hygiene only, never a truth
certification.  Missing or unavailable evidence must be flagged
(``landing_status="待核实"`` or ``high_star_unavailable=True``), never invented
to satisfy a numeric floor.
"""

from __future__ import annotations

import copy
import hashlib
import ipaddress
import re
import urllib.parse
from collections import Counter

# A prominent, required marker on every synthetic output.  Kept equal to
# report_service.providers.SYNTHETIC_MARK so a synthetic report is recognisable
# regardless of which module produced it.
SYNTHETIC_MARK = "SYNTHETIC TEST — NOT RESEARCH"

# Numeric floors that encode the original research requirements (audit D).
MIN_CANDIDATES = 25
MIN_FINAL_COMPANIES = 15
MIN_DEEP_FINAL_COMPANIES = 25
MIN_CHECKS = 12
MIN_ECONOMIC_CHECKS = 5
MIN_POLICY_CHECKS = 3
EXPECTED_HIGH_STAR_DIRECTIONS = 3

# Live research stages must cite at least this many distinct canonical source
# URLs; a single trusted URL repeated is not independent research.
MIN_DISTINCT_EVIDENCE_URLS = 8

# Official press / statistics domains.  Company-official domains are *not* in
# this set intentionally: a company's own site is evidence about that company,
# never general government authority.
TRUSTED_DOMAINS = frozenset({
    "gov.cn", "stats.gov.cn", "mof.gov.cn", "miit.gov.cn", "ndrc.gov.cn",
    "people.com.cn", "xinhuanet.com", "china.com.cn", "ce.cn", "stcn.com",
})

# Listed-company disclosure portals (annual reports / announcements).
DISCLOSURE_DOMAINS = frozenset({"cninfo.com.cn", "eastmoney.com"})

# Grounded landing_status vocabulary.  A company's status must be one of these
# short, auditable labels rather than free-form prose.
#
# * ``已落地`` — confirmed landed in the region (needs evidence).
# * ``区域已布局`` — already has a presence/layout in the region (needs evidence).
# * ``布局中`` — actively laying out in the region (needs evidence).
# * ``拟落地`` — announced intent to land (needs evidence).
# * ``未落地`` — confirmed *not* landed (needs counter-evidence).
# * ``待招引`` — identified as a recruitment target, not yet in the region.
# * ``待核实`` — unknown / unverifiable; explicitly flagged, never invented.
LANDING_STATUSES = frozenset({
    "已落地", "区域已布局", "布局中", "拟落地", "未落地", "待招引", "待核实",
})

# Statuses that assert a factual claim about landing and therefore require a
# binding ``evidence_ref`` to retrieved evidence.  ``待招引`` / ``待核实`` are
# honest "we do not have this fact" states and never fabricate a landing claim.
FACTUAL_LANDING_STATUSES = frozenset({
    "已落地", "区域已布局", "布局中", "拟落地", "未落地",
})

# Exact scoring weights.  Sums to 1.0.  ``risk`` is a riskiness sub-score
# (0 = none, 10 = extreme) and is *subtracted* (inverted) in the weighted total.
SCORING_WEIGHTS = {
    "attractiveness": 0.20,
    "industry_fit": 0.20,
    "policy_support": 0.15,
    "landing_feasibility": 0.15,
    "supply_chain_fit": 0.15,
    "competitive_position": 0.10,
    "risk": 0.05,
}
SCORE_DIMENSIONS = frozenset(SCORING_WEIGHTS)
SCORE_MAX = 10.0  # each dimension is a 0..10 sub-score

# Hostnames (or suffixes) that are never acceptable evidence sources.
_PLACEHOLDER_SUFFIXES = (".invalid", ".localhost", ".local", ".test")
_PLACEHOLDER_DOMAINS = frozenset({
    "example.com", "example.org", "example.net", "example.invalid",
    "localhost", "fake.com", "test.com",
})

# Ordered structural parts for every stage.  A long stage is split across these
# fixed sub-sections so its output is bounded and checkpointable instead of
# depending on one oversized model completion.
_STAGE_PARTS = {
    "economy": ("经济总量", "增长态势", "财政与投资", "区域定位"),
    "population": ("人口规模", "人口结构", "人才与劳动力"),
    "transport": ("交通网络", "土地资源", "园区载体"),
    "life": ("居住与住房", "教育资源", "医疗卫生", "商业与生活配套"),
    "industry": ("主导产业", "产业集群与园区", "上下游关联"),
    "competition": ("竞对地区", "比较优势", "短板与风险"),
    "policy": ("国家产业政策", "省市政策", "区级政策"),
    "chain": ("产业链环节分布", "断点与卡点", "补链强链方向"),
    **{f'enterprises_{direction}': (
        '候选池', '候选池2', '候选池3', '候选池4', '候选池5',
        '落地情况', '落地情况2', '落地情况3', '落地情况4', '落地情况5',
        '扩产信号', '扩产信号2', '扩产信号3', '匹配理由与风险'
    ) for direction in (1, 2, 3)},
    "fact_check": ("经济关键数字", "政策金额", "五星企业信号"),
    "scoring": ("评分维度与权重", "加权计算"),
    "action": ("行动清单", "优先级与里程碑"),
    "summary": ("执行摘要",),
    "compact": ("精简报告",),
}

# research==True stages require retrieved, cited source evidence.  fact_check is
# a research stage because its independent cross-checks must cite sources.
_RESEARCH_STAGE_IDS = frozenset({
    "economy", "population", "transport", "life", "industry", "competition",
    "policy", "chain", "enterprises_1", "enterprises_2", "enterprises_3",
    "fact_check",
})

# filename and minimum line floor, matching the design's 16-artifact table.
_STAGE_FILENAMES = {
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
_STAGE_MIN_LINES = {
    "economy": 150, "population": 150, "transport": 180, "life": 150,
    "industry": 180, "competition": 180, "policy": 200, "chain": 250,
    "enterprises_1": 250, "enterprises_2": 250, "enterprises_3": 250,
    "fact_check": 60, "scoring": 100, "action": 150, "summary": 80, "compact": 200,
}

_STAGE_ORDER = (
    "economy", "population", "transport", "life", "industry", "competition",
    "policy", "chain", "enterprises_1", "enterprises_2", "enterprises_3",
    "fact_check", "scoring", "action", "summary", "compact",
)

STAGES = tuple(
    {
        "id": sid,
        "filename": _STAGE_FILENAMES[sid],
        "min_lines": _STAGE_MIN_LINES[sid],
        "research": sid in _RESEARCH_STAGE_IDS,
        "parts": _STAGE_PARTS[sid],
    }
    for sid in _STAGE_ORDER
)

_STAGE_INDEX = {s["id"]: s for s in STAGES}

_URL_RE = re.compile(r"https?://[^\s\"'<>()\[\]{}\uFF0C\uFF01\uFF1F\uFF1B\uFF1A\u3001]+")


def get_stage(stage_id: str, *, mode='standard') -> dict:
    """Return the immutable mode-specific plan (raises ``KeyError`` on unknown ID).

    Deep mode keeps calls bounded to five companies and adds two expansion
    parts per direction, instead of enlarging a single provider completion.
    """
    stage = _STAGE_INDEX[stage_id]
    if mode not in ('standard', 'deep'):
        raise ValueError('invalid report mode')
    if mode == 'deep' and stage_id.startswith('enterprises_'):
        return dict(stage, parts=stage['parts'][:-1] + ('扩产信号4', '扩产信号5', stage['parts'][-1]))
    return stage


def _stage_ids() -> tuple:
    return _STAGE_ORDER


# --- URL hygiene helpers ------------------------------------------------------

def _is_private_or_local_host(host: str) -> bool:
    host = (host or "").strip("[]").lower()
    if not host:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        return (
            ip.is_loopback or ip.is_private or ip.is_link_local
            or ip.is_reserved or ip.is_multicast or ip.is_unspecified
        )
    return False


def _is_placeholder_host(host: str) -> bool:
    host = (host or "").lower().strip(".")
    if host in _PLACEHOLDER_DOMAINS:
        return True
    if any(host.endswith(sfx) for sfx in _PLACEHOLDER_SUFFIXES):
        return True
    # A registrable-like hostname must contain a dot with a 2+ char TLD.
    if "." not in host:
        return True
    tld = host.rsplit(".", 1)[1]
    if len(tld) < 2:
        return True
    return False


def is_government_host(host: str) -> bool:
    """True when ``host`` is a ``gov.cn`` (sub)domain."""
    host = (host or "").lower().strip(".")
    return host == "gov.cn" or host.endswith(".gov.cn")


def is_trusted_host(host: str) -> bool:
    """True when ``host`` is a gov.cn domain or in :data:`TRUSTED_DOMAINS`."""
    host = (host or "").lower().strip(".")
    if not host:
        return False
    if is_government_host(host):
        return True
    return any(host == d or host.endswith("." + d) for d in TRUSTED_DOMAINS)


def regulardomain(host: str) -> str:
    """Return the best-effort registrable domain of ``host`` for comparison.

    Strips a leading ``www.`` and returns a lowercase canonical hostname; this is
    a heuristic (no public-suffix list) used only to compare source association,
    not as a security or routing primitive.
    """
    host = (host or "").lower().strip(".")
    parts = [p for p in host.split(".") if p]
    if len(parts) >= 3 and parts[0] == "www":
        parts = parts[1:]
    return ".".join(parts)


def classify_source_type(host: str) -> str:
    """Classify an evidence hostname into an honest authority tier.

    ``government`` for gov.cn, ``official_media`` for the press/statistics
    domains, ``disclosure`` for listed-company disclosure portals, and
    ``company``/``other`` for everything else.  Company-official URLs are valid
    evidence about *that company* but are never elevated to government
    authority.
    """
    host = (host or "").lower().strip(".")
    if is_government_host(host):
        return "government"
    for d in DISCLOSURE_DOMAINS:
        if host == d or host.endswith("." + d):
            return "disclosure"
    for d in TRUSTED_DOMAINS:
        if host == d or host.endswith("." + d):
            return "official_media"
    return "other"


def normalize_url(url: str):
    """Return a canonical ``(scheme, host, path)`` tuple or None.

    Strips the query/fragment so the same page is not counted twice, and
    lowercases scheme+host.  ``None`` means "not a usable source URL".
    """
    if not isinstance(url, str) or not url.strip():
        return None
    try:
        parsed = urllib.parse.urlsplit(url.strip())
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.hostname or "").lower().strip(".")
    if not host:
        return None
    path = parsed.path or "/"
    return (parsed.scheme, host, path)


def canonical_url(url: str) -> str:
    """A stable string form of :func:`normalize_url` for identity comparison."""
    norm = normalize_url(url)
    if norm is None:
        return ""
    scheme, host, path = norm
    return f"{scheme}://{host}{path}"


def extract_urls(text) -> list:
    return _URL_RE.findall(text or "")


# --- scoring computation (pure Python, never the model) -----------------------

def compute_weighted_score(dimensions: dict) -> float:
    """Compute a weighted score from 0-10 sub-scores using exact Python weights.

    ``risk`` is a riskiness sub-score that is *inverted* (subtracted): a higher
    risk lowers the total.  The model only supplies sub-scores; it never performs
    arithmetic.
    """
    from decimal import Decimal, ROUND_HALF_UP
    import math
    if not isinstance(dimensions, dict) or set(dimensions) != set(SCORING_WEIGHTS):
        raise ValueError('all seven score dimensions are required')
    total = Decimal('0')
    for dim, weight in SCORING_WEIGHTS.items():
        val = dimensions[dim]
        if isinstance(val, bool) or not isinstance(val, (int, float)) or not math.isfinite(val) or not 0 <= val <= SCORE_MAX:
            raise ValueError('score dimensions must be finite numbers within 0..10')
        value = Decimal(str(val))
        if dim == 'risk':
            value = Decimal('10') - value
        total += Decimal(str(weight)) * value
    return float(total.quantize(Decimal('.001'), rounding=ROUND_HALF_UP))


def rank_scores(records):
    """Attach ``weighted_score`` (Python-computed) and a 1-based ``rank``.

    ``records`` is a list of dicts carrying ``dimensions``.  Ranking is exact:
    highest weighted score ranks first; ties keep input order and are assigned
    distinct ranks (stable).  Returns a new list; inputs are not mutated.
    """
    out = []
    for record in records:
        record = dict(record) if isinstance(record, dict) else {}
        dims = record.get("dimensions") if isinstance(record.get("dimensions"), dict) else {}
        out.append({**record, "weighted_score": compute_weighted_score(dims), "rank": None})
    out.sort(key=lambda x: -x["weighted_score"])
    for i, record in enumerate(out):
        record["rank"] = i + 1
    return out


# --- validation ---------------------------------------------------------------

def validate(stage_id, text, metadata=None, synthetic=False, *, mode='standard'):
    """Return a list of error strings; empty list means the artifact passes.

    Checks, in order of importance:

    1. ``stage_id`` is a known stage.
    2. ``text`` is a non-empty string.
    3. line count meets the stage's ``min_lines`` structural floor.
    4. when ``synthetic`` is set, the output carries :data:`SYNTHETIC_MARK`.
    5. URL hygiene: every URL in ``text`` must be https, have a real,
       non-placeholder, non-private hostname; a ``gov.cn`` in the *path* of a
       non-gov.cn host is rejected as impersonation; URLs are canonicalized and
       deduplicated; a single URL repeated as filler is rejected.
    6. live research stages require a metadata ``evidence`` list with at least
       :data:`MIN_DISTINCT_EVIDENCE_URLS` distinct canonical source URLs, each
       with a non-link-only excerpt.  Synthetic stages relax this.
    7. company stages: candidate pool >= 25 (unique names) and >= 15 standard /
       25 deep unique final
       companies, each with a grounded ``landing_status``, a binding
       ``evidence_ref`` for factual landing statuses, and an
       ``expansion_evidence`` note (explicit ``待核实`` is allowed, never silent).
    8. fact_check stage: >= 12 checks, >= 5 economic, >= 3 policy, high-star
       coverage across the three directions (or explicit
       ``high_star_unavailable``), each check citing two *independent* (distinct
       canonical) evidence sources.
    9. scoring stage: ``scores`` carry Python-computed ``weighted_score`` /
       ``rank`` consistent with :data:`SCORING_WEIGHTS` and stable ranking.

    ``metadata`` may be ``None`` for synthetic / synthesis stages; live research
    stages require it (source association and evidence are mandatory for real
    research, never optional).
    """
    errors = []
    if mode not in ('standard', 'deep'):
        return ['invalid report mode']
    if stage_id not in _STAGE_INDEX:
        return ["unknown stage: %r" % (stage_id,)]

    if not isinstance(text, str) or not text.strip():
        errors.append("text must be a non-empty string")
        text = text or ""

    stage = _STAGE_INDEX[stage_id]
    content_lines = [line.strip() for line in text.splitlines() if line.strip()]
    nlines = len(content_lines)
    if not synthetic and content_lines:
        repeated = sum(n - 1 for n in Counter(content_lines).values() if n > 1)
        if repeated > len(content_lines) * .2:
            errors.append('repeated filler exceeds 20 percent of substantive lines')
    if nlines < stage["min_lines"]:
        errors.append(
            f"stage {stage_id!r} line count {nlines} < min_lines {stage['min_lines']}"
        )

    if synthetic and SYNTHETIC_MARK not in text:
        errors.append(f"synthetic output missing marker {SYNTHETIC_MARK!r}")

    errors.extend(_validate_urls(text))

    meta = metadata if isinstance(metadata, dict) else {}
    errors.extend(_validate_evidence(stage["research"], meta, synthetic, stage_id))

    if stage_id == 'industry':
        from .full_directions import normalise_directions
        try:
            normalise_directions(meta.get('directions'), meta.get('evidence', []))
        except ValueError as exc:
            errors.append(str(exc))
    if stage_id in ("enterprises_1", "enterprises_2", "enterprises_3"):
        errors.extend(_validate_companies(stage_id, meta, synthetic, mode))
    elif stage_id == "fact_check":
        errors.extend(_validate_checks(stage_id, meta, synthetic))
    elif stage_id == "scoring":
        errors.extend(_validate_scores(stage_id, meta))

    return errors


def _validate_urls(text):
    errors = []
    urls = extract_urls(text)
    seen = Counter()
    for url in urls:
        norm = normalize_url(url)
        if norm is None:
            errors.append(f"invalid source URL: {url}")
            continue
        scheme, host, path = norm
        if scheme != "https":
            errors.append(f"URL scheme must be https: {url}")
        if _is_private_or_local_host(host):
            errors.append(f"URL host is local/private: {url}")
        if _is_placeholder_host(host):
            errors.append(f"URL host is a placeholder/not trusted: {url}")
        if ("gov.cn" in path) and not is_government_host(host):
            errors.append(f"URL impersonates gov.cn in path: {url}")
        # Canonical identity (scheme+host+path) so http/https or trailing-slash
        # variants are not counted as independent sources.
        seen[canonical_url(url)] += 1

    for canonical, count in seen.items():
        if count >= 5 and len(seen) < MIN_DISTINCT_EVIDENCE_URLS:
            errors.append(f"URL repeated {count} times as filler: {canonical}")
    return errors


def _validate_evidence(research, meta, synthetic, stage_id):
    errors = []
    evidence = meta.get("evidence")
    if not research:
        return errors
    if evidence is None:
        if not synthetic:
            errors.append(
                f"stage {stage_id!r} is a live research stage and requires "
                "'evidence' metadata (source association is mandatory)"
            )
        return errors
    if not isinstance(evidence, list):
        errors.append("metadata 'evidence' must be a list")
        return errors

    canonical_seen = set()
    for i, item in enumerate(evidence):
        if not isinstance(item, dict):
            errors.append(f"evidence[{i}] is not an object")
            continue
        url = item.get("url")
        excerpt = item.get("excerpt")
        if not isinstance(url, str) or not url.strip():
            errors.append(f"evidence[{i}] missing url")
            continue
        norm = normalize_url(url)
        if norm is None:
            errors.append(f"evidence[{i}] invalid url: {url}")
            continue
        scheme, host, _ = norm
        if scheme != "https":
            errors.append(f"evidence[{i}] url must be https: {url}")
        if _is_private_or_local_host(host):
            errors.append(f"evidence[{i}] url host is local/private: {url}")
        if _is_placeholder_host(host):
            errors.append(f"evidence[{i}] url host is not trusted: {url}")
        if not isinstance(excerpt, str) or not excerpt.strip():
            errors.append(f"evidence[{i}] has no excerpt (link only)")
        elif excerpt.strip() == url.strip():
            errors.append(f"evidence[{i}] excerpt is just the link")
        canonical_seen.add(canonical_url(url))

    if not synthetic and len(canonical_seen) < MIN_DISTINCT_EVIDENCE_URLS:
        errors.append(
            f"live research stage {stage_id!r} cites only {len(canonical_seen)} "
            f"distinct source URL(s) < {MIN_DISTINCT_EVIDENCE_URLS}"
        )
    return errors


def _evidence_canonicals(meta):
    evidence = meta.get("evidence") if isinstance(meta, dict) else None
    if not isinstance(evidence, list):
        return set()
    out = set()
    for item in evidence:
        if isinstance(item, dict):
            out.add(canonical_url(item.get("url")))
    return out


def _validate_companies(stage_id, meta, synthetic, mode='standard'):
    errors = []
    candidates = meta.get("candidates")
    selected = meta.get("selected")

    if not isinstance(candidates, list):
        errors.append(f"{stage_id} metadata 'candidates' must be a list")
        candidates = []
    if not isinstance(selected, list):
        errors.append(f"{stage_id} metadata 'selected' must be a list")
        selected = []

    cand_names = [c.get("name") for c in candidates if isinstance(c, dict) and c.get("name")]
    cand_unique = len(set(cand_names))
    if cand_unique < MIN_CANDIDATES:
        errors.append(
            f"{stage_id} candidate pool {cand_unique} < {MIN_CANDIDATES}"
        )

    sel = [s for s in selected if isinstance(s, dict)]
    sel_names = [s.get("name") for s in sel if s.get("name")]
    sel_unique = len(set(sel_names))
    minimum = MIN_DEEP_FINAL_COMPANIES if mode == 'deep' else MIN_FINAL_COMPANIES
    if sel_unique < minimum:
        errors.append(
            f"{stage_id} final companies {sel_unique} unique < {minimum}"
        )

    evidence_refs = _evidence_canonicals(meta) if not synthetic else set()
    if not synthetic:
        for item in candidates + sel:
            if not isinstance(item, dict) or canonical_url(item.get('url')) not in evidence_refs:
                errors.append(f'{stage_id} company identity needs a retrieved source URL')
        for item in sel:
            if item.get('name') not in cand_names:
                errors.append(f'{stage_id} selected company is absent from candidate pool')

    for i, s in enumerate(sel):
        if not s.get("name"):
            errors.append(f"{stage_id} selected[{i}] missing name")
        ls = s.get("landing_status")
        if not ls:
            errors.append(f"{stage_id} selected[{i}] missing landing_status")
        elif ls not in LANDING_STATUSES:
            errors.append(
                f"{stage_id} selected[{i}] landing_status {ls!r} not in {sorted(LANDING_STATUSES)}"
            )
        if "expansion_evidence" not in s or not str(s.get("expansion_evidence") or "").strip():
            errors.append(f"{stage_id} selected[{i}] missing expansion_evidence")

    # Grounding: a factual landing status must be bound to retrieved evidence by
    # canonical URL; "待招引"/"待核实" are honest and need no fabricated claim.
    for kind, items in (("selected", sel), ("candidates", candidates)):
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            ls = item.get("landing_status")
            if ls not in FACTUAL_LANDING_STATUSES:
                continue
            ref = item.get("evidence_ref")
            if not isinstance(ref, str) or not ref.strip():
                errors.append(
                    f"{stage_id} {kind}[{i}] landing_status {ls!r} requires an "
                    "'evidence_ref' bound to retrieved evidence"
                )
                continue
            if not synthetic and canonical_url(ref) not in evidence_refs:
                errors.append(
                    f"{stage_id} {kind}[{i}] evidence_ref {ref!r} does not match "
                    "any retrieved evidence source"
                )
    return errors


def _validate_checks(stage_id, meta, synthetic):
    errors = []
    checks = meta.get("checks")
    if not isinstance(checks, list):
        errors.append(f"{stage_id} metadata 'checks' must be a list")
        return errors

    identities = set()
    distinct = []
    for entry in checks:
        identity = (str(entry.get('claim', '')).strip(), entry.get('category'), entry.get('direction')) if isinstance(entry, dict) else None
        if identity in identities:
            errors.append('duplicate fact check cannot count twice')
            continue
        identities.add(identity)
        distinct.append(entry)
    checks = distinct
    total = len(checks)
    if total < MIN_CHECKS:
        errors.append(f"{stage_id} has {total} checks < {MIN_CHECKS}")

    categories = Counter()
    directions = set()
    evidence_refs = _evidence_canonicals(meta) if not synthetic else set()
    for i, c in enumerate(checks):
        if not isinstance(c, dict):
            errors.append(f"{stage_id} checks[{i}] is not an object")
            continue
        cat = c.get("category")
        categories[cat] += 1
        if cat == "high_star" and c.get("direction"):
            directions.add(c["direction"])
        source = c.get("source")
        cross = c.get("cross_source")
        if not isinstance(source, str) or not source.strip():
            errors.append(f"{stage_id} checks[{i}] missing source")
        if not isinstance(cross, str) or not cross.strip():
            errors.append(f"{stage_id} checks[{i}] missing cross_source")
        if source and cross and canonical_url(source) == canonical_url(cross):
            errors.append(
                f"{stage_id} checks[{i}] source and cross_source are not independent"
            )
        if not synthetic:
            for label, url in (("source", source), ("cross_source", cross)):
                if not isinstance(url, str) or not url.strip():
                    continue
                if canonical_url(url) not in evidence_refs:
                    errors.append(
                        f"{stage_id} checks[{i}] {label} {url!r} does not match any "
                        "retrieved evidence source"
                    )

    if categories.get("economic", 0) < MIN_ECONOMIC_CHECKS:
        errors.append(
            f"{stage_id} economic checks {categories.get('economic', 0)} < {MIN_ECONOMIC_CHECKS}"
        )
    if categories.get("policy", 0) < MIN_POLICY_CHECKS:
        errors.append(
            f"{stage_id} policy checks {categories.get('policy', 0)} < {MIN_POLICY_CHECKS}"
        )

    covered_directions = len(directions)
    if covered_directions < EXPECTED_HIGH_STAR_DIRECTIONS and not meta.get("high_star_unavailable"):
        errors.append(
            f"{stage_id} high-star coverage {covered_directions} < {EXPECTED_HIGH_STAR_DIRECTIONS} "
            "and no high_star_unavailable flag"
        )
    return errors


def _validate_scores(stage_id, meta):
    errors = []
    scores = meta.get("scores")
    if not isinstance(scores, list) or len(scores) < MIN_FINAL_COMPANIES:
        return ['scoring requires at least 15 structured company scores']
    ranks = []
    for i, s in enumerate(scores):
        if not isinstance(s, dict):
            errors.append(f"{stage_id} scores[{i}] is not an object")
            continue
        ws = s.get("weighted_score")
        rank = s.get("rank")
        if not isinstance(ws, (int, float)):
            errors.append(f"{stage_id} scores[{i}] missing Python-computed weighted_score")
        try:
            if ws != compute_weighted_score(s.get('dimensions')):
                errors.append(f'{stage_id} score does not match deterministic calculation')
        except ValueError:
            errors.append(f'{stage_id} score dimensions incomplete or invalid')
        if not isinstance(rank, int) or rank < 1:
            errors.append(f"{stage_id} scores[{i}] missing positive integer rank")
        else:
            ranks.append(rank)
    if ranks and sorted(ranks) != list(range(1, len(ranks) + 1)):
        errors.append(f"{stage_id} ranks are not a contiguous 1..N permutation: {ranks}")
    return errors


# --- synthetic parts ----------------------------------------------------------

def make_synthetic_part(stage_id, part, job, prior):
    """Build one deterministic, clearly-labelled synthetic part.

    Returns ``{'text': str, 'metadata': dict}``.  The text is a pure function of
    ``(stage_id, part, job, prior)`` and always opens with :data:`SYNTHETIC_MARK`.
    The metadata carries *explicitly placeholder* shapes (one evidence entry, or
    a candidate/check/score entry for the company/check/scoring stages) so an
    assembled synthetic stage can still satisfy the structural gate without
    making any real factual claim.

    Raises ``KeyError`` for an unknown stage and ``ValueError`` for an unknown
    part.
    """
    stage = get_stage(stage_id)
    if part not in stage["parts"]:
        raise ValueError(f"unknown part {part!r} for stage {stage_id!r}")

    place = _place(job)
    prior_digest = _prior_digest(prior)
    digest = hashlib.sha256(
        "\x00".join((stage_id, part, place, prior_digest)).encode("utf-8")
    ).hexdigest()[:16]

    lines = [
        SYNTHETIC_MARK,
        "",
        "本内容为确定性模拟输出，不含任何真实统计数据或事实主张。",
        "",
        f"阶段：{stage_id}",
        f"子章节：{part}",
        f"地区：{place}",
        f"追踪标识：{digest}",
    ]
    # Pad so a single part can clear the largest structural line floor (compact
    # = 200 lines), guaranteeing an assembled synthetic stage always passes the
    # structural gate and a synthetic full task yields all 16 valid artifacts.
    body = [f"{part} 占位段落 {i}。此处无真实结论，仅用于流程与持久化验证。" for i in range(220)]
    text = "\n".join(lines + ["", ""] + body) + "\n"

    metadata = _synthetic_metadata(stage_id, part, place, digest)
    return {"text": text, "metadata": metadata}


def _synthetic_metadata(stage_id, part, place, digest):
    url_host = "stats.gov.cn"
    url = f"https://{url_host}/synthetic/{digest}"
    evidence = [{
        "url": url, "title": f"合成占位来源 {part}", "excerpt": "合成占位摘录，不构成真实事实主张。",
        "source": "SYNTHETIC", "published": "发布日期未知",
        "retrieval": "synthetic", "source_type": "synthetic",
    }]
    if stage_id in ("enterprises_1", "enterprises_2", "enterprises_3"):
        candidates = [
            {"name": f"合成候选{i}", "url": f"https://cninfo.com.cn/syn/{digest}/c{i}",
             "landing_status": "待核实", "segment": "占位环节", "reason": "合成占位理由"}
            for i in range(MIN_CANDIDATES)
        ]
        selected = [
            {"name": f"合成候选{i}", "url": f"https://cninfo.com.cn/syn/{digest}/c{i}",
             "landing_status": "待核实", "segment": "占位环节",
             "expansion_evidence": "待核实", "expansion_date": "发布日期未知",
             "rationale": "合成占位匹配理由", "uncertainty": "合成，无真实结论"}
            for i in range(MIN_FINAL_COMPANIES)
        ]
        return {"evidence": evidence, "candidates": candidates, "selected": selected}
    if stage_id == 'industry':
        return {'evidence': evidence, 'directions': [
            {'id': f'dir{i+1}', 'name': f'合成产业方向{i+1}', 'evidence_ref': evidence[i % len(evidence)]['url']}
            for i in range(3)]}
    if stage_id == "fact_check":
        checks = []
        for i in range(MIN_ECONOMIC_CHECKS):
            checks.append(_synthetic_check("economic", None, digest, i))
        for i in range(MIN_POLICY_CHECKS):
            checks.append(_synthetic_check("policy", None, digest, i))
        for d in ("dir1", "dir2", "dir3"):
            for i in range(3):
                checks.append(_synthetic_check("high_star", d, digest, i))
        return {"evidence": evidence, "checks": checks}
    if stage_id == "scoring":
        scores = []
        for i in range(MIN_FINAL_COMPANIES):
            scores.append({
                "name": f"合成候选{i}", "direction": "dir1",
                "dimensions": {d: 0 for d in SCORE_DIMENSIONS},
            })
        return {"evidence": evidence, "scores": rank_scores(scores)}
    return {"evidence": evidence}


def _synthetic_check(category, direction, digest, i):
    return {
        "claim": f"合成待核实声明 {category}/{direction or 'all'}/{i}",
        "source": f"https://stats.gov.cn/synthetic/{digest}/{i}",
        "cross_source": f"https://stats.gov.cn/synthetic/{digest}/{i}x",
        "year": "发布日期未知", "verdict": "待核实",
        "category": category, "direction": direction,
    }


def _place(job):
    job = job or {}
    city = (job.get("city") or "").strip()
    province = (job.get("province") or "").strip()
    if province and city:
        return f"{province}{city}"
    return city or province or "目标地区"


def _prior_digest(prior):
    if prior is None:
        return ""
    if isinstance(prior, dict):
        text = "".join(f"{k}:" + (str(v)[:200] if v else "") for k, v in prior.items())
        return hashlib.sha256(text.encode("utf-8")).hexdigest()
    return hashlib.sha256(str(prior).encode("utf-8")).hexdigest()


# --- assembly -----------------------------------------------------------------

def assemble(stage_id, parts):
    """Deterministically merge a stage's ``parts`` into one result dict.

    ``parts`` is a list of ``{'text', 'metadata'}`` dicts in stage order.  The
    text is concatenated with clear section separators; the metadata lists are
    merged preserving first-appearance order and deduplicated:

    * ``evidence`` merged by the complete retrieved ``url``, retaining each
      original excerpt and retrieval observation; source floors still count
      canonical URLs;
    * ``candidates`` / ``selected`` deduped by ``name``; later grounded
      research can improve existing fields without erasing known facts with
      unknown/empty placeholders;
    * ``checks`` deduped by ``claim``;
    * ``scores`` deduped by ``name`` (then re-ranked in Python so ranks stay a
      contiguous 1..N permutation after dedup).

    Returns ``{'text': str, 'metadata': dict}``.  Result is a pure function of
    the input list (same input -> same output).
    """
    get_stage(stage_id)  # validates the id
    parts = list(parts or [])
    chunks = []
    merged = {}
    for p in parts:
        if not isinstance(p, dict):
            continue
        text = p.get("text")
        if isinstance(text, str) and text.strip():
            chunks.append(text.rstrip())
        metadata = p.get("metadata") or {}
        # A part's evidence may occur after its company arrays in the JSON.
        # Ground updates against all preceding/current retrieved excerpts,
        # independently of dictionary insertion order.
        company_sources = _company_source_urls(
            list(merged.get('evidence') or []) + list(metadata.get('evidence') or []))
        for key, value in metadata.items():
            if key not in merged:
                merged[key] = []
            _merge_list(merged, key, value, company_sources)

    # Re-rank scores after cross-part dedup so rank remains a stable 1..N.
    if "scores" in merged and isinstance(merged["scores"], list) and merged["scores"]:
        merged["scores"] = rank_scores(merged["scores"])

    text = ("\n\n---\n\n").join(chunks) if chunks else ""
    return {"text": text, "metadata": merged}


def _company_source_urls(evidence):
    sources = set()
    for item in evidence:
        if not isinstance(item, dict):
            continue
        url, excerpt = item.get('url'), item.get('excerpt')
        if (not isinstance(url, str) or not isinstance(excerpt, str)
                or not excerpt.strip() or excerpt.strip() == url.strip()):
            continue
        if normalize_url(url) is not None and not _validate_urls(url):
            sources.add(canonical_url(url))
    return sources


def _known_company_value(value):
    if not isinstance(value, str) or not value.strip():
        return False
    return value.strip().lower() not in {
        '待核实', '待招引', '未知', '年份未知', '发布日期未知', '未核实',
        '未披露', '不详', '暂无', '无', 'n/a', 'unknown',
    }


def _merge_company(previous, incoming, sources):
    """Apply a later grounded version while retaining established facts.

    Landing status and its source form a pair: a later unknown landing must
    not replace the source that supports an established factual status. Other
    real fields can still improve independently, using the incoming retrieved
    identity source. The original checkpoint dictionaries are never mutated.
    """
    if canonical_url(incoming.get('url')) not in sources:
        return previous
    result = dict(previous)
    result['url'] = incoming['url']
    old_landing = (previous.get('landing_status') in FACTUAL_LANDING_STATUSES
                   and canonical_url(previous.get('evidence_ref')) in sources)
    new_status = incoming.get('landing_status')
    new_ref = incoming.get('evidence_ref')
    grounded_ref = canonical_url(new_ref) in sources
    if new_status in FACTUAL_LANDING_STATUSES and grounded_ref:
        result['landing_status'] = new_status
        result['evidence_ref'] = new_ref
    elif not old_landing:
        if new_status in LANDING_STATUSES and new_status not in FACTUAL_LANDING_STATUSES:
            result['landing_status'] = new_status
        if grounded_ref:
            result['evidence_ref'] = new_ref
    for field, value in incoming.items():
        if field in {'name', 'url', 'landing_status', 'evidence_ref'}:
            continue
        if _known_company_value(value):
            result[field] = value
        elif field not in result or not str(result.get(field) or '').strip():
            if isinstance(value, str) and value.strip():
                result[field] = value
    return result


def _merge_list(merged, key, value, company_sources=None):
    if not isinstance(value, list):
        merged[key] = value
        return
    if key == 'evidence':
        merged[key] = merge_evidence_records(
            list(merged[key]) + value if isinstance(merged[key], list) else value)
        return
    if key in ('candidates', 'selected'):
        out = list(merged[key]) if isinstance(merged[key], list) else []
        positions = {_dedupe_key(key, item): index for index, item in enumerate(out)
                     if _dedupe_key(key, item) is not None}
        for item in value:
            identity = _dedupe_key(key, item)
            if identity is not None and identity in positions:
                index = positions[identity]
                out[index] = _merge_company(out[index], item, company_sources or set())
                continue
            out.append(item)
            if identity is not None:
                positions[identity] = len(out) - 1
        merged[key] = out
        return
    seen = set()
    for item in merged[key] if isinstance(merged[key], list) else []:
        seen.add(_dedupe_key(key, item))
    out = list(merged[key]) if isinstance(merged[key], list) else []
    for item in value:
        k = _dedupe_key(key, item)
        if k is not None and k in seen:
            continue
        out.append(item)
        if k is not None:
            seen.add(k)
    merged[key] = out


def _evidence_observations(item):
    """Recover original records from a merged excerpt without copying history."""
    excerpt = item['excerpt']
    observations = item.get('observations')
    if isinstance(observations, list) and observations:
        recovered = []
        for observation in observations:
            if not isinstance(observation, dict):
                break
            metadata = observation.get('metadata')
            offset, length = observation.get('excerpt_offset'), observation.get('excerpt_length')
            if (not isinstance(metadata, dict) or 'excerpt' in metadata
                    or metadata.get('url') != item['url']
                    or type(offset) is not int or type(length) is not int
                    or offset < 0 or length <= 0 or offset + length > len(excerpt)):
                break
            recovered.append((copy.deepcopy(metadata), excerpt[offset:offset + length]))
        else:
            original_excerpts = list(dict.fromkeys(value for _, value in recovered))
            if '\n\n'.join(original_excerpts) == excerpt:
                return recovered
    # An unrecognized observations field is original metadata, not generated
    # history. Keep it just like any other unknown field.
    return [(copy.deepcopy({key: value for key, value in item.items() if key != 'excerpt'}), excerpt)]


def merge_evidence_records(items):
    """Preserve excerpts and original metadata for each complete retrieved URL.

    Query variants remain separate records. For one URL, each distinct excerpt
    occurs once in the main ``excerpt``. ``observations`` stores the original
    metadata and character offset/length needed to recover every original
    excerpt, including different publication/retrieval fields. It never stores
    another copy of the excerpt or nests previously generated observations.
    Reassembling already merged evidence is idempotent and leaves inputs intact.
    Invalid evidence remains visible to the existing contract validators.
    """
    groups, order = {}, []
    for item in items:
        url = item.get('url') if isinstance(item, dict) else None
        excerpt = item.get('excerpt') if isinstance(item, dict) else None
        if (not isinstance(url, str) or not isinstance(excerpt, str)
                or not excerpt.strip() or excerpt.strip() == url.strip()
                or normalize_url(url) is None or _validate_urls(url)):
            order.append((False, copy.deepcopy(item)))
            continue
        if url not in groups:
            groups[url] = []
            order.append((True, url))
        for observation in _evidence_observations(item):
            if observation not in groups[url]:
                groups[url].append(observation)

    out = []
    for is_group, entry in order:
        if not is_group:
            out.append(entry)
            continue
        records = groups[entry]
        excerpts, offsets, length = [], {}, 0
        for _, excerpt in records:
            if excerpt not in offsets:
                if excerpts:
                    length += 2  # The separator is not part of either source excerpt.
                offsets[excerpt] = length
                excerpts.append(excerpt)
                length += len(excerpt)
        merged = copy.deepcopy(records[0][0])
        merged['excerpt'] = '\n\n'.join(excerpts)
        if len(records) > 1:
            merged['observations'] = [
                {'metadata': metadata, 'excerpt_offset': offsets[excerpt],
                 'excerpt_length': len(excerpt)} for metadata, excerpt in records]
        out.append(merged)
    return out


def _dedupe_key(key, item):
    if not isinstance(item, dict):
        return None
    if key == "evidence":
        return canonical_url(item.get("url")) or item.get("url")
    if key == 'directions':
        return item.get('id')
    if key in ("candidates", "selected", "scores"):
        return item.get("name")
    if key == "checks":
        return item.get("claim")
    return None


__all__ = [
    "STAGES",
    "SYNTHETIC_MARK",
    "MIN_CANDIDATES",
    "MIN_FINAL_COMPANIES",
    "MIN_CHECKS",
    "MIN_ECONOMIC_CHECKS",
    "MIN_POLICY_CHECKS",
    "EXPECTED_HIGH_STAR_DIRECTIONS",
    "MIN_DISTINCT_EVIDENCE_URLS",
    "LANDING_STATUSES",
    "FACTUAL_LANDING_STATUSES",
    "TRUSTED_DOMAINS",
    "DISCLOSURE_DOMAINS",
    "SCORING_WEIGHTS",
    "SCORE_DIMENSIONS",
    "SCORE_MAX",
    "get_stage",
    "validate",
    "make_synthetic_part",
    "assemble",
    "merge_evidence_records",
    "extract_urls",
    "normalize_url",
    "canonical_url",
    "regulardomain",
    "classify_source_type",
    "is_trusted_host",
    "is_government_host",
    "compute_weighted_score",
    "rank_scores",
]
