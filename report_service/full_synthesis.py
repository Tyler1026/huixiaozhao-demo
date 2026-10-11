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


def _legacy_synthesis_issues(text, prior):
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


# The following projection operates only on the current, uncommitted response.
# Evidence and prior checkpoints are never changed or combined into new quotes.
_DOCUMENT = re.compile(r'[\u4e00-\u9fff]{1,18}[〔\[]\d{4}[〕\]]\s*\d+号')
_ARTICLE = re.compile(r'第([一二三四五六七八九十百\d]+)条|(?m:^\s*)(\d+)[.．、]')
_METRICS = (
    ('地区生产总值', ('地区生产总值', 'GDP', '经济总量')),
    ('固定资产投资', ('固定资产投资',)),
    ('房地产开发投资', ('房地产开发投资',)),
    ('工业增加值', ('工业增加值',)),
    ('建筑业增加值', ('建筑业增加值',)),
    ('政府债务余额', ('政府债务余额', '地方政府债务余额')),
    ('财政收入', ('财政收入',)),
    ('研发投入比重', ('研发投入比重', '研发经费投入强度', '研发经费支出占', '研究与试验发展')),
    ('外贸进出口', ('外贸进出口', '进出口总额', '货物进出口')),
    ('常住人口', ('常住人口',)),
    ('市场主体', ('市场主体',)),
    ('一般公共预算收入', ('一般公共预算收入',)),
    ('一般公共预算支出', ('一般公共预算支出',)),
    ('工业总产值', ('工业总产值',)),
    ('社会消费品零售总额', ('社会消费品零售总额',)),
    ('营业收入', ('营业收入', '营收')),
    ('投资', ('总投资', '项目投资', '投资额', '工程投资')),
    ('产能', ('产能', '年产')),
    ('研发', ('研发经费', '研发投入')),
)
_FOOTER = re.compile(r'(?im)^\s*(?:版权所有|网站地图|网站标识码|沪ICP备|京ICP备|Copyright\b|主办单位[：:]|承办单位[：:])')
_ADDRESS = re.compile(r'[\u4e00-\u9fffA-Za-z0-9·-]{2,35}(?:路|街|道|巷)\s*\d+(?:-\d+)?号(?:\d+幢)?')


def _compact(value):
    return re.sub(r'\s+', '', value or '')


def evidence_observations(prior=None, evidence=None):
    """Return separate original observations with immutable provenance."""
    import hashlib
    from .full_contract import _evidence_observations
    entries = []
    if evidence is not None:
        entries.extend(('', item) for item in evidence if isinstance(item, dict))
    else:
        for stage, value in (prior or {}).items():
            if isinstance(value, dict) and isinstance(value.get('metadata'), dict):
                entries.extend((stage, item) for item in value['metadata'].get('evidence', [])
                               if isinstance(item, dict))
    output, seen = [], set()
    for stage, item in entries:
        if not isinstance(item.get('excerpt'), str) or not item.get('url'):
            continue
        for metadata, excerpt in _evidence_observations(item):
            key = (item['url'], excerpt)
            if key in seen:
                continue
            seen.add(key)
            output.append({'url': item['url'], 'canonical_url': canonical_url(item['url']),
                           'stage': stage, 'text': excerpt, 'title': metadata.get('title', ''),
                           'sha256': hashlib.sha256(excerpt.encode()).hexdigest()})
    return output


def _article_number(value):
    if value.isdigit():
        return str(int(value))
    digits = dict(zip('一二三四五六七八九', range(1, 10)))
    if value == '十':
        return '10'
    if '十' in value:
        left, right = value.split('十', 1)
        return str(digits.get(left, 1) * 10 + digits.get(right, 0))
    return str(digits.get(value, value))


def policy_clauses(prior):
    """Extract complete recipient/benefit sentences, never stitch observations."""
    records = []
    for observation in evidence_observations(prior):
        raw = observation['text']
        documents = list(dict.fromkeys(_DOCUMENT.findall(raw + '\n' + observation['title'])))
        if len(documents) != 1:
            continue
        articles = list(_ARTICLE.finditer(raw))
        for i, article in enumerate(articles):
            end = articles[i + 1].start() if i + 1 < len(articles) else len(raw)
            body = raw[article.end():end]
            # A semicolon joins independent benefits, not a single combined cap.
            for match in re.finditer(r'(?:对|支持)([^。；;\n]{3,600}?(?:企业|主体|项目|机构))\s*[，,]\s*(?:按(?:照)?|给予)([^。；;\n]{3,600})', body):
                condition, benefit = match.group(1).strip(), match.group(2).strip()
                full = match.group(0).strip()
                amounts = _quantities(benefit)
                if not amounts:
                    continue
                records.append({**observation, 'document': documents[0],
                                'article': _article_number(article.group(1) or article.group(2)),
                                'condition': condition, 'benefit': benefit, 'clause': full,
                                'amounts': amounts,
                                'offset': article.end() + match.start()})
    unique = {}
    for record in records:
        key = (record['document'], record['article'], _compact(record['clause']))
        unique.setdefault(key, record)
    return list(unique.values())


def _policy_matches(line, clauses):
    documents = {_compact(value) for value in _DOCUMENT.findall(line)}
    articles = {_article_number(m.group(1) or m.group(2)) for m in _ARTICLE.finditer(line)}
    refs = {canonical_url(url.rstrip('.,;')) for url in _URL.findall(line)}
    quantities = _quantities(_URL.sub('', line))
    matches = []
    for record in clauses:
        identity = _compact(record['document']) in documents or record['canonical_url'] in refs
        if not identity or record['article'] not in articles:
            continue
        money = {q for q in record['amounts'] if q[0] == 'money'}
        # Match this particular benefit's cap; percentages in another benefit
        # cannot disable the condition check or select the wrong recipient.
        if money and not money <= quantities:
            continue
        if not money and not record['amounts'] <= quantities:
            continue
        matches.append(record)
    return matches


def _claim_years(claim):
    clean = re.sub(r'(?:发布年份|发布日期|发布于|发布时间)[：:]?[^。；;）)]*', '', claim)
    return set(re.findall(r'(?<!\d)(20\d{2})年', _URL.sub('', clean)))


def _metric_groups(claim):
    return [(label, aliases) for label, aliases in _METRICS
            if any(alias.lower() in claim.lower() for alias in aliases)]


def _eligible_body(text):
    footer = _FOOTER.search(text)
    return text[:footer.start()] if footer else text



def _attribution_prefix(claim):
    # “经济增长” is a fact, not an attribution introduced by “经”.
    match = re.search(r'[，,]由(?=[^。；;]{0,180}(?:报道|公报|发布会|来源|印证|核验|确认))', claim)
    return claim[:match.start()] if match else claim


def _claim_regions(claim):
    regions = set()
    for match in re.finditer(r'(?:(?<=[\d年省市，。；：:\s在于])|^)((?!年)[\u4e00-\u9fff]{2,6}?[省市区县])', claim):
        value = match.group(1)
        if value not in {'地区', '城市', '全市', '本市', '本区', '全区'} and not value.endswith(('地区', '园区', '社区', '小区', '全市', '本市', '全区', '本区', '全省', '本省')):
            regions.add(value)
    return regions


def _claim_companies(claim):
    # Exact disclosed names only. We do not invent aliases for the final prose.
    return set(re.findall(r'(?:(?<=[\d年，。；：:\s])|^)((?!年)[\u4e00-\u9fffA-Za-z]{1,35}?(?:股份有限公司|有限责任公司|有限公司|公司|集团))', claim))


def _claim_spans(text):
    """Keep adjacent continuation clauses, split when their factual identity changes."""
    output = []
    empty_identity = lambda: {'subjects': set(), 'regions': set(), 'years': set(), 'metrics': set()}
    for paragraph in re.split(r'\n\s*\n|[。！？]', text):
        start, end, identity, quantities = None, 0, empty_identity(), set()
        for match in re.finditer(r'[^，,；;]+', paragraph):
            clause = match.group()
            if not clause.strip():
                continue
            next_identity = {'subjects': _claim_companies(clause), 'regions': _claim_regions(clause),
                             'years': _claim_years(clause), 'metrics': {key for key, _ in _metric_groups(clause)}}
            incoming_quantities = _quantities(_compact(clause))
            changed = any(identity[key] and values and not values <= identity[key]
                          for key, values in next_identity.items())
            # A second monetary/physical amount is not interchangeable with
            # the first metric merely because its label was not in our list.
            changed = changed or any(kind in {'money', 'mass', 'area'} and other_kind == kind and value != other_value
                                     for kind, value in quantities for other_kind, other_value in incoming_quantities)
            if changed and start is not None:
                output.append(paragraph[start:end].strip())
                start, identity, quantities = None, empty_identity(), set()
            if start is None:
                start = match.start()
            end = match.end()
            for key, values in next_identity.items():
                identity[key].update(values)
            quantities.update(incoming_quantities)
        if start is not None:
            output.append(paragraph[start:end].strip())
    return output


def source_support(claim, observations, url, *, quote='', year=None, region='', metric=''):
    """Conservative same-span quantity/metric/year/region binding for one URL.

    An exact quote can narrow the span; it cannot substitute for its contents.
    A document's explicit statistical title supplies its reporting year, but
    its publication date does not. Two URLs are evaluated independently.
    """
    if not isinstance(claim, str) or not isinstance(url, str) or not isinstance(quote, str):
        return {'supported': False, 'reason': 'invalid_claim_or_reference'}
    region = region if isinstance(region, str) else ''
    metric = metric if isinstance(metric, str) else ''
    claim = _attribution_prefix(claim)
    quantities = _quantities(_compact(_URL.sub('', claim)))
    groups = _metric_groups(claim) + [g for g in _metric_groups(metric) if g not in _metric_groups(claim)]
    years = _claim_years(claim)
    regions = _claim_regions(claim)
    if region:
        regions.add(region)
    subjects = _claim_companies(claim)
    if isinstance(year, (str, int)) and re.fullmatch(r'20\d{2}', str(year)):
        years.add(str(year))
    candidates = [o for o in observations if o['canonical_url'] == canonical_url(url)]
    if not candidates:
        return {'supported': False, 'reason': 'source_not_saved'}
    for observation in candidates:
        body = _eligible_body(observation['text'])
        if quote:
            if _compact(quote) not in _compact(body):
                continue
            spans = _claim_spans(quote)
        else:
            # A paragraph, not the entire page or a union of different snippets.
            spans = [p for p in _claim_spans(body) if len(p) <= 3000]
        title_context = observation['title'] + '\n' + body[:350]
        statistic_years = set(re.findall(r'(20\d{2})年[^。]{0,45}(?:统计公报|统计年鉴)', _compact(title_context)))
        claim_documents = set(_DOCUMENT.findall(claim))
        if claim_documents.intersection(_DOCUMENT.findall(body + observation['title'])):
            statistic_years.update(re.search(r'20\d{2}', document).group() for document in claim_documents)
        for span in spans:
            dense = _compact(span)
            if quantities and not quantities <= _quantities(dense):
                continue
            if groups and not all(any(alias.lower() in dense.lower() for alias in aliases) for _, aliases in groups):
                continue
            if not groups and _compact(claim).rstrip('。') not in dense:
                continue
            span_years = set(re.findall(r'(20\d{2})年', dense))
            if years and ((span_years and not years <= span_years) or not years <= (span_years | statistic_years)):
                continue
            if regions:
                named_places = _claim_regions(span)
                district_claims = {r for r in regions if r.endswith(('区', '县'))}
                district_span = {r for r in named_places if r.endswith(('区', '县'))}
                if district_span and district_claims and not district_claims <= district_span:
                    continue
                if not all(_compact(r) in _compact(span + '\n' + title_context) for r in regions):
                    continue
            if subjects and not all(_compact(subject) in _compact(span) for subject in subjects):
                continue
            return {'supported': True, 'reason': 'exact_observation_span', 'quote': span,
                    'source_sha256': observation['sha256']}
    return {'supported': False, 'reason': 'claim_not_supported_by_same_span'}


def _target_region(place):
    values = re.findall(r'[^省市区县\s]+[省市区县]', place or '')
    return values[-1] if values else ''


def ground_audit_check(item, evidence, *, place=""):
    """Keep the audit entry while making single-source/unsupported status explicit."""
    observations = evidence_observations(evidence=evidence)
    claim = item.get('claim', '').strip() if isinstance(item.get('claim'), str) else ''
    original_claim = claim
    item = dict(item)
    policy_gap = ''
    if item.get('category') == 'policy' and _DOCUMENT.search(claim) and _ARTICLE.search(claim):
        matches = _policy_matches(claim, policy_clauses({'current': {'metadata': {'evidence': evidence}}}))
        incomplete = [record for record in matches if _compact(record['condition']).replace('，', '').replace('、', '')
                      not in _compact(claim).replace('，', '').replace('、', '')]
        if len(matches) == 1 and incomplete:
            record = matches[0]
            claim = record['document'] + '第' + record['article'] + '条：' + record['clause']
            item['source'] = record['url']
            item['source_quote'] = record['clause']
            item['year'] = re.search(r'20\d{2}', record['document']).group()
        elif not matches or incomplete:
            policy_gap = '该文号条款的完整受益对象与门槛无法唯一定位，金额不得直接作为适用结论。'
    source = item.get('source') if isinstance(item.get('source'), str) else ''
    cross = item.get('cross_source') if isinstance(item.get('cross_source'), str) else ''
    supplied_region = item.get('region') if isinstance(item.get('region'), str) else ''
    region = supplied_region or (_target_region(place) if item.get('category') == 'economic' and not _claim_regions(claim) else '')
    primary = source_support(claim, observations, source, quote=item.get('source_quote') or '',
                             year=item.get('year'), region=region, metric=item.get('metric') or '')
    secondary = source_support(claim, observations, cross, quote=item.get('cross_source_quote') or '',
                               year=item.get('year'), region=region, metric=item.get('metric') or '')
    if item.get('category') == 'economic' and not _claim_years(claim) and not re.fullmatch(r'20\d{2}', str(item.get('year', ''))):
        primary = {'supported': False, 'reason': 'reporting_year_unspecified'}
        secondary = {'supported': False, 'reason': 'reporting_year_unspecified'}
    if policy_gap:
        primary = {'supported': False, 'reason': 'policy_condition_unresolved'}
        secondary = {'supported': False, 'reason': 'policy_condition_unresolved'}
    # Equal excerpts on mirrors demonstrate version consistency, not independent reporting.
    independent = canonical_url(source) != canonical_url(cross)
    if primary['supported'] and secondary['supported']:
        independent = independent and _compact(primary['quote']) != _compact(secondary['quote'])
    if primary['supported'] and secondary['supported'] and independent:
        status, verdict, gap = 'corroborated', '两份不同原文均支持此项主张', ''
    elif primary['supported'] or secondary['supported']:
        if not primary['supported']:
            source, cross, primary, secondary = cross, source, secondary, primary
        status, verdict = 'single_source', '单源支持；尚未获得独立交叉核验'
        gap = '第二来源未同时支持该指标、数值、统计年份及地区，或仅为相同原文镜像。'
    else:
        status, verdict = 'pending', '待核实：现有来源未支持该项完整主张'
        gap = policy_gap or '须取得同一指标、数值、统计年份及地区对应的原文；现有链接只作为待复核线索。'
    known = {o['canonical_url'] for o in observations}
    source = source if canonical_url(source) in known else ''
    cross = cross if canonical_url(cross) in known and canonical_url(cross) != canonical_url(source) else ''
    return {'claim': claim, 'source': source, 'cross_source': cross,
            'year': item.get('year') or '年份未知', 'category': item['category'], 'direction': None,
            'verdict': verdict, 'support_status': status, 'support_gap': gap,
            'source_support': primary, 'cross_source_support': secondary,
            'source_quote': primary.get('quote', ''), 'cross_source_quote': secondary.get('quote', ''),
            'original_verdict': item.get('verdict') or '待核实', 'region': region, 'metric': item.get('metric') or '',
            'original_claim': original_claim if original_claim != claim else '', 'policy_gap': policy_gap}


def _pending_line(line, reason):
    # Keep a concrete subject/metric, not the unsupported number presented as fact.
    prefix = re.match(r'\s*(?:\d+[.、]\s*|[-*]\s*)', line)
    label = _URL.sub('', line)
    label = _QUANTITY.sub('', label)
    label = re.sub(r'\([^)]*\)|（[^）]*）', '', label)
    label = re.sub(r'^\s*(?:\d+[.、]\s*|[-*]\s*)', '', label)
    subject = re.split(r'[，,。；;：:]', label, 1)[0][:90].strip()
    return (prefix.group() if prefix else '') + '待核事项：' + (subject or '该项数据') + '；' + reason


def project_decision_text(text, prior, *, place='', previous_text=''):
    """Restore uniquely located policy clauses; project unbound claims to tasks.

    This is a deterministic last gate, not a new reason to retry the same model.
    It preserves the original rejected line only in returned audit metadata.
    """
    observations, clauses = evidence_observations(prior), policy_clauses(prior)
    by_url = {}
    for observation in observations:
        by_url.setdefault(observation['canonical_url'], []).append(observation)
    legacy = _legacy_synthesis_issues(text, prior)
    legacy_by_line = {}
    for issue in legacy:
        legacy_by_line.setdefault(issue['line'], []).append(issue)
    audits, output = [], []
    # Deduplicate only links this projection would add. Original model links
    # remain byte-for-byte, even if they themselves fail the existing URL gate.
    known_citations = {canonical_url(url.rstrip('.,;')): 'original'
                       for url in _URL.findall(previous_text + '\n' + text)}

    def policy_citation(record, line):
        urls = _URL.findall(line)
        canonical = record['canonical_url']
        same = [url for url in urls if canonical_url(url.rstrip('.,;')) == canonical]
        if same:
            citation = '来源：' + '；'.join(same)
        elif canonical in known_citations:
            citation = ('原文见本节同文号前项链接' if known_citations[canonical] == 'projected'
                        else '原文沿用本节同文号已列来源链接')
        else:
            known_citations[canonical] = 'projected'
            citation = '来源：' + record['url']
        other = [url for url in urls if url not in same]
        if other:
            citation += '；原始引用待复核：' + '；'.join(other)
        return citation

    for index, line in enumerate(text.splitlines(), 1):
        result, reasons = line, []
        matches = _policy_matches(line, clauses)
        if matches:
            incomplete = [r for r in matches if _compact(r['condition']).replace('，', '').replace('、', '')
                          not in _compact(line).replace('，', '').replace('、', '')]
            if len(matches) == 1:
                record = matches[0]
                # Restore the complete original formula as well as conditions.
                # A matching cap cannot legitimize a changed reimbursement rate.
                original_quantities = _quantities(_compact(record['clause']))
                if (_compact(record['clause']) not in _compact(line)
                        or _quantities(_compact(_URL.sub('', line))) != original_quantities):
                    prefix = re.match(r'\s*(?:\d+[.、]\s*|[-*]\s*)', line)
                    result = (prefix.group() if prefix else '') + record['document'] + '第' + record['article'] + '条：' + record['clause'] + '。' + policy_citation(record, line)
                    reasons.append('policy_condition_restored' if incomplete else 'policy_benefit_restored')
            elif incomplete or not all(_compact(r['clause']) in _compact(line) for r in matches):
                result = _pending_line(line, '同条款存在多个受益对象，须分别核对完整资格、比例与上限；不得合并适用。')
                reasons.append('ambiguous_policy_benefit')
        elif _DOCUMENT.search(line) and _quantities(line) and _ARTICLE.search(line):
            result = _pending_line(line, '须核对该文号及条款的完整适用对象、门槛和金额；现有摘录不能唯一定位。')
            reasons.append('unresolved_policy_clause')
        if result == line and not matches and _quantities(_compact(_URL.sub('', line))):
            refs = list(dict.fromkeys(canonical_url(url.rstrip('.,;')) for url in _URL.findall(line)))
            supported = []
            if not refs:
                anchor_claim = _attribution_prefix(line)
                anchors = _claim_regions(anchor_claim) or _claim_companies(anchor_claim)
                inferred_region = '' if _claim_regions(anchor_claim) else _target_region(place)
                if not anchors and not (_metric_groups(anchor_claim) and inferred_region):
                    result = _pending_line(line, '缺少可唯一定位的地区、企业主体或来源，须核对具体对象及原文。')
                    reasons.append('unbound_numeric_subject')
                    audits.append({'line': index, 'reasons': reasons, 'original': line, 'projected': result})
                    output.append(result)
                    continue
                quantities = _quantities(_compact(_URL.sub('', line)))
                refs = [ref for ref, records in by_url.items() if any(quantities <= _quantities(_compact(record['text'])) for record in records)]
            for ref in refs:
                explicit_regions = _claim_regions(_attribution_prefix(line))
                target = '' if explicit_regions or _claim_companies(line) else _target_region(place)
                check = source_support(line, by_url.get(ref, []), ref, region=target)
                if check['supported']:
                    supported.append((ref, check))
            if not supported and not matches:
                result = _pending_line(line, '现有摘录未绑定同一指标、数值、统计年份与地区，需补齐原文后再采用。')
                reasons.append('unbound_numeric_claim')
            elif supported and not matches:
                independent_quotes = {_compact(check['quote']) for _, check in supported}
                # Never preserve the model's attribution to sources we did not
                # bind, even when another saved source supports the number.
                factual = re.split(r'(?:来源|据此已获双源)[：:]', _attribution_prefix(line), maxsplit=1)[0]
                factual = re.sub(r'已?[双两]源(?:交叉)?(?:印证|核验|确认)|交叉(?:印证|核验|确认)', '', factual).rstrip('。； ')
                result = factual + '。来源：' + supported[0][0]
                if len(independent_quotes) < 2:
                    result += '〔单源支持，独立交叉核验待补〕'
                    reasons.append('single_source_disclosed')
                else:
                    result += '；另有原文支持：' + next(ref for ref, check in supported if _compact(check['quote']) != _compact(supported[0][1]['quote']))
                    result += '〔两份原文支持，发布主体独立性仍须核对〕'
                    reasons.append('source_attribution_bound')
        for issue in legacy_by_line.get(index, []):
            if issue['kind'] == 'rank_uncertainty_lost' and _RANK.search(result):
                result = result.rstrip('。') + '；该排名尚未获得原文核验，保留待核。'
                reasons.append('rank_uncertainty_restored')
            if issue['kind'] == 'policy_condition_lost' and result == line:
                result = _pending_line(line, '适用对象尚未完整绑定原政策条款，核实前不作申报适用结论。')
                reasons.append('unresolved_policy_condition')
        if result != line:
            audits.append({'line': index, 'reasons': reasons, 'original': line, 'projected': result})
        output.append(result)
    return '\n'.join(output), audits


def synthesis_issues(text, prior):
    """Compatibility diagnostic plus evidence-derived clause omissions."""
    issues = _legacy_synthesis_issues(text, prior)
    clauses = policy_clauses(prior)
    for index, line in enumerate(text.splitlines(), 1):
        for record in _policy_matches(line, clauses):
            if _compact(record['condition']).replace('，', '').replace('、', '') not in _compact(line).replace('，', '').replace('、', ''):
                issues.append({'line': index, 'kind': 'policy_condition_lost',
                               'article': record['article'], 'required_condition': record['condition'],
                               'sources': [record['canonical_url']]})
    return issues


def _addresses(text):
    return [re.sub(r'^(?:公司)?(?:注册地址|注册地|地址|位于)', '', address) for address in _ADDRESS.findall(text)]


def company_location_support(name, evidence, *, place='', address='', status=''):
    """Require named issuer/body evidence for positive target-location claims.

    A known URL, site footer, a city-only address or a company name containing
    a place cannot establish that a project landed in the target district.
    Absence of a hit also cannot establish a negative landing claim.
    """
    region = _target_region(place)
    if status == '未落地':
        return {'supported': False, 'reason': 'absence_is_not_evidence_of_no_landing'}
    observations = evidence_observations(evidence=evidence)
    subject = _compact(name)
    for observation in observations:
        body = _eligible_body(observation['text'])
        # Only a named issuer in the first heading can supply a document-wide
        # subject. A navigation/footer mention is insufficient.
        first_heading = next((line.strip().lstrip('#').strip() for line in body.splitlines() if line.strip()), '')
        issuer = bool(re.fullmatch(re.escape(subject) + r'(?:20\d{2}年)?(?:年度报告|半年度报告|年报|招股说明书|公司公告|注册信息)', _compact(first_heading)))
        for paragraph in re.split(r'\n\s*\n|[。！？，,；;]', body):
            dense = _compact(paragraph)
            if subject not in dense and (not issuer or not re.match(r'(?:公司|本公司)?(?:注册(?:地址|地)|住所|总部|位于)', dense)):
                continue
            if address and _compact(address) not in dense:
                continue
            if region and region not in dense:
                continue
            if not address and not re.search(r'注册(?:地址|地)|住所|总部|位于|坐落|落地|投产|开工|奠基|基地|园区|选址', dense):
                continue
            if status in ('已落地', '区域已布局') and re.search(r'计划|拟建|拟落地|有意|意向|预计|将于', dense):
                continue
            return {'supported': True, 'quote': paragraph.strip(), 'source_sha256': observation['sha256']}
    return {'supported': False, 'reason': 'no_named_target_location_body_span'}


def project_company_record(entry, evidence, *, place=''):
    """Project new company fields only; names and old checkpoint keys stay intact."""
    import copy
    result = copy.deepcopy(entry)
    rejected = {}
    ref = entry.get('evidence_ref') or entry.get('url') or ''
    bound = [e for e in evidence if isinstance(e, dict) and canonical_url(e.get('url')) == canonical_url(ref)]
    status = entry.get('landing_status')
    if status in {'已落地', '区域已布局', '布局中', '拟落地', '未落地'}:
        support = company_location_support(entry['name'], bound, place=place, status=status)
        if not support['supported']:
            rejected['landing_status'] = status
            result['landing_status'] = '待核实'
            result['location_gap'] = '尚无该主体在目标地区的项目落位原文；须核对注册主体、项目地址和进度。'
        else:
            result['location_support'] = support
    for key in ('reason', 'rationale', 'expansion_evidence', 'uncertainty'):
        value = result.get(key)
        if not isinstance(value, str):
            continue
        addresses = _addresses(value)
        local_claim = re.search(r'已落地|本(?:区|地|市)存量|注册(?:地|地址).{0,15}[区县]', value)
        bad_address = any(not company_location_support(entry['name'], bound, place='', address=address)['supported']
                          for address in addresses)
        bad_local = local_claim and not company_location_support(entry['name'], bound, place=place)['supported']
        if bad_address or bad_local:
            rejected[key] = value
            result[key] = entry['name'] + '：地址及目标地区落位待核，须取得包含同一主体和项目地址的正文原句；网页页脚不作为依据。'
    if rejected:
        result['location_projection'] = {'original_fields': rejected, 'reason': 'missing_subject_location_span'}
    return result


def project_location_prose(text, companies, evidence, *, place=''):
    """Keep unsupported addresses/local-stock classifications out of new prose."""
    output, audits = [], []
    for index, line in enumerate(text.splitlines(), 1):
        result = line
        addresses = _addresses(line)
        names = [c['name'] for c in companies if isinstance(c, dict) and isinstance(c.get('name'), str)
                 and c['name'] in line]
        status_claim = re.search(r'注册(?:地|地址).{0,15}[区县]|已在.{0,12}落地', line)
        # A plan to service or verify local businesses is not a claim that a
        # particular company is already local. Keep those actionable lines.
        if names and re.search(r'本(?:市|区|地)存量企业', line) and not re.search(r'核查|核验|确认是否|建议|应先|走访|计划|梳理|分组', line):
            status_claim = True
        unbound = addresses and (not names or any(not company_location_support(name, evidence, address=address)['supported']
                                                for name in names for address in addresses))
        if status_claim and (not names or any(not company_location_support(name, evidence, place=place)['supported'] for name in names)):
            unbound = True
        if unbound:
            prefix = re.match(r'\s*(?:\d+[.、]\s*|[-*]\s*)', line)
            result = (prefix.group() if prefix else '') + '待核事项：' + ('、'.join(names) if names else '本条企业线索') + '的注册主体、项目地址及目标地区落位须逐项核对；城市级记录和网站页脚不能证明区级落位。'
            audits.append({'line': index, 'original': line, 'projected': result, 'reason': 'unbound_company_location'})
        output.append(result)
    return '\n'.join(output), audits


def incomplete_audit_is_grounded(item, evidence):
    """Recheck explicit incomplete records at the contract trust boundary."""
    if (not isinstance(item, dict) or not isinstance(item.get('support_status'), str)
            or item.get('support_status') not in {'single_source', 'pending'}):
        return False
    actual = ground_audit_check(item, evidence)
    return actual['support_status'] == item['support_status']
