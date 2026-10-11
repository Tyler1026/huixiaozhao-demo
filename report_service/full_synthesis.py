"""Auditable checks on new standard decision prose, using saved evidence only.

These checks catch mechanically demonstrable attribution/qualification loss;
they do not claim to verify every business judgement or replace human review.
"""
import re
from decimal import Decimal
from .full_contract import canonical_url

_QUANTITY = re.compile(r'(?<![\d.])(\d[\d,]*(?:\.\d+)?)\s*(亿元|万元|元|万吨|吨|万亩|亩|%|％)')
_RANK = re.compile(r'(?:全市|全省|全国|市内|省内)(?:排名|位居|位列|第|总量居|稳居|居)*(?:第)?[一二三四五六七八九十\d]+')
_UNCERTAIN = re.compile(r'待核|未核|未经|自媒体|无法确认|尚未确认|待.*复核')
_URL = re.compile(r'https://[^\s<>（()）\[\]，。；、“”\"]+')


def _quantities(text):
    scale = {'亿元': ('money', Decimal(100000000)), '万元': ('money', Decimal(10000)),
             '元': ('money', Decimal(1)), '万吨': ('mass', Decimal(10000)),
             '吨': ('mass', Decimal(1)), '万亩': ('area', Decimal(10000)),
             '亩': ('area', Decimal(1)), '%': ('percent', Decimal(1)), '％': ('percent', Decimal(1))}
    return {(scale[unit][0], Decimal(number.replace(',', '')) * scale[unit][1])
            for number, unit in _QUANTITY.findall(text)}


def _text(prior, stage):
    value = (prior or {}).get(stage, {})
    return value.get('text', '') if isinstance(value, dict) else str(value)


def evidence_by_url(prior):
    sources = {}
    for value in (prior or {}).values():
        if not isinstance(value, dict):
            continue
        for item in value.get('metadata', {}).get('evidence', []):
            if isinstance(item, dict) and item.get('url') and item.get('excerpt'):
                from .full_contract import _evidence_observations
                for _, excerpt in _evidence_observations(item):
                    sources.setdefault(canonical_url(item['url']), []).append(excerpt)
    return {url: '\n'.join(dict.fromkeys(excerpts)) for url, excerpts in sources.items()}


def synthesis_issues(text, prior):
    """Return only proven local mismatches; preserve unit conversions.

    A number with an explicit source must occur in that source's saved
    excerpts (normalizing money/mass/area units). Different saved excerpts
    for the same URL are combined, not overwritten by the last retrieval.
    A rank already explicitly uncertain in the economic/check prose must
    keep a qualification in the sentence that states the rank. Policy
    eligibility clauses are copied intact when their numbered monetary
    provision is repeated; a global disclaimer cannot stand in for them.
    """
    sources = evidence_by_url(prior)
    uncertain_ranks = set()
    for line in (_text(prior, 'economy') + '\n' + _text(prior, 'fact_check')).splitlines():
        if _UNCERTAIN.search(line):
            uncertain_ranks.update(_RANK.findall(line))
    policy_requirements = []
    for line in _text(prior, 'policy').splitlines():
        article = re.search(r'第[一二三四五六七八九十\d]+条', line)
        eligibility = re.search(r'对([^。；：:]*?(?:企业|主体))，按', line)
        if article and eligibility and _quantities(line):
            anchors = tuple(re.findall(r'[“"]([^”"]{2,30})[”"]', line[:eligibility.start()]))
            requirement = (article.group(), eligibility.group(1), _quantities(line), anchors)
            if requirement not in policy_requirements:
                policy_requirements.append(requirement)
    issues = []
    for index, line in enumerate(text.splitlines(), 1):
        refs = [canonical_url(url.rstrip('.,;')) for url in _URL.findall(line)]
        quantities = _quantities(_URL.sub('', line))
        if refs and quantities:
            supported = set().union(*(_quantities(sources.get(ref, '')) for ref in refs))
            missing = quantities - supported
            # Accept explicit arithmetic only when its operands are both in
            # this sentence and in the cited evidence. A generic “calculated”
            # label must not bypass source checks on unrelated invented data.
            operands = quantities & supported
            if re.search(r'合计|之和|差额|差值|计算', line):
                derivable = {(ka, a + b) for ka, a in operands for kb, b in operands if ka == kb}
                derivable |= {(ka, abs(a - b)) for ka, a in operands for kb, b in operands if ka == kb}
                missing -= derivable
            if missing:
                issues.append({'line': index, 'kind': 'numeric_source_mismatch',
                               'sources': refs, 'unsupported': sorted((kind, str(value)) for kind, value in missing)})
        if uncertain_ranks and not _UNCERTAIN.search(line):
            if any(rank in line for rank in uncertain_ranks):
                issues.append({'line': index, 'kind': 'rank_uncertainty_lost'})
        for article, condition, amounts, anchors in policy_requirements:
            same_provision = any(anchor in line for anchor in anchors) if anchors else amounts <= quantities
            if article in line and quantities & amounts and same_provision:
                compact = lambda value: re.sub(r'[\s“”"‘’]', '', value)
                if compact(condition) not in compact(line):
                    issues.append({'line': index, 'kind': 'policy_condition_lost',
                                   'article': article, 'required_condition': condition})
    return issues


def correction_context(issues, prior):
    """Only cited saved excerpts are needed to repair source mismatches."""
    sources = evidence_by_url(prior)
    refs = {ref for issue in issues for ref in issue.get('sources', [])}
    return {'kind': 'synthesis_grounding', 'issues': issues,
            'cited_source_excerpts': {ref: sources[ref] for ref in sorted(refs) if ref in sources}}
