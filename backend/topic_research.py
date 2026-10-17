"""Bounded public research for interactive topic reports.

Only the public city/topic labels leave this module. Questions and saved basis
are checked locally; they are never appended to an external search query.
Search transport, response limits and URL guards belong to the existing live
report provider. This module neither downloads arbitrary URLs nor calls a model.

``ready`` means original excerpts were retrieved, not that a report is true.
Report checks distinguish cross_checked, single_source and unsupported. Even a
cross check proves only support by these saved passages, not exhaustive truth.
"""
from __future__ import annotations

import datetime as dt
import copy
import hashlib
import json
import os
import math
import re
import time
import threading
import unicodedata
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from urllib.parse import urlsplit

from report_service import full_contract as contract
from report_service import full_synthesis as grounding
from report_service import providers
from report_service.hosted import configured_environment
from report_service.full_provider import FullLiveProvider

MAX_SOURCES = 20
MAX_CHAIN_SOURCES = 48
MAX_CHAIN_QUOTES_PER_URL = 12
MAX_CHAIN_EVIDENCE_CHARS = 40000
MAX_EXCERPT_CHARS = 1600
MAX_FULLTEXT_CHARS = 120000
MAX_CHECKS = 80
_REF = re.compile(r'\[(tr_[a-f0-9]{20})\]')
_ANY_SOURCE_REF = re.compile(r'\[((?:tr_)[A-Za-z0-9_]+|\d+|[Ee]\d+)\]')
_URL = re.compile(r'https?://[^\s<>\[\]（）()，。；;、"\']+')
_NUMBER = re.compile(r'\d[\d,.]*(?:\s*(?:%|％|亿元|万元|元|吨|亩|平方公里|平方米|公里|家|项|个|发|颗|年|月|日))')
_UNCERTAIN = re.compile(r'待核|未核|未披露|未显示|未检索|无证据|无法确认|不能确认|尚不明确|可能|推断|建议|拟议')
_PLAN = re.compile(r'拟(?:建|于|在|投资)|计划|预计|将于|力争|到20\d{2}年|目标')
_COMPLETE = re.compile(r'启用|投产|建成|竣工|落地|交付|已形成|已布局|已签')
_PROMISE = re.compile(r'(?:落地即|即可|必将|保证|确保|锁定).{0,35}(?:订单|采购|收益|补贴|营收)')
_ABSENCE = re.compile(r'❌\s*(?:\*\*)?\s*缺失|本地.{0,12}(?:不存在|缺失|空白)|全部外购|零布局')
_LOCATION = re.compile(r'(?P<name>[\u3400-\u9fffA-Za-z0-9（）()·]{2,50}?(?:股份有限公司|有限责任公司|有限公司|公司|集团))\s*(?:的)?\s*(?P<kind>注册地址|注册地|住所|办公地址|总部)\s*(?:为|在|位于|：|:)?\s*(?P<place>[^，。；;\n]{2,55})')
_CHAIN_ASSESSMENT = re.compile(
    r'薄弱|短板|不足|短缺|缺乏|瓶颈|卡脖子|外部依赖|进口依赖|依赖进口|对外依存|'
    r'供需对接|供应缺口|供给缺口|配套能力|协同机制|中试资源|技术成熟度|成熟(?:产品|机载|配套)|'
    r'已(?:形成|建成|投产|具备|集聚|实现)|量产|批量(?:化)?生产|产能|研发能力|'
    r'研发平台|中试平台|供应体系|配套体系|完善的产业生态')
_CHAIN_BASE = re.compile(r'已(?:经)?(?:形成|建成|投产|具备|集聚|实现|交付)|组建|量产|批量(?:化)?生产|现有.{0,12}(?:企业|供应|产能)|覆盖.{0,12}(?:研发|生产|供应)')
_CHAIN_CONSTRAINT = re.compile(r'不足|短缺|缺乏|短板|瓶颈|不畅|脱节|受制|受限|进口依赖|依赖进口|对外依存')
# Only used when a diagnostic paragraph borrows its industry context from the
# source title. A city name or a generic government-site title is insufficient.
_INDUSTRY_CONTEXT_TERMS = (
    '低空', '航空', '航天', '火箭', '卫星', '生物医药', '医药', '制药', '医疗',
    '能源', '储能', '氢能', '聚变', '半导体', '芯片', '集成电路', '汽车',
    '钢铁', '农业', '房地产', '文旅', '旅游', '教育')


def _digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def _clean(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value or ''))


def _public_label(value, limit):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= limit:
        raise ValueError('invalid_public_label')
    value = value.strip()
    if (re.search(r'[\x00-\x1f@/:\\<>]|\d{7,}', value)
            or not re.fullmatch(r'[\u3400-\u9fffA-Za-z0-9（）()·、， ,+\-]+', value)):
        raise ValueError('invalid_public_label')
    return value


def _document_title(title, fulltext):
    """Recover a displayed document heading when search only returns site chrome."""
    if not re.search(r'人民政府(?:网站)?$|政府网站$|门户网站$|^首页$|^无标题$', title or ''):
        return title
    for line in fulltext[:1500].splitlines()[:12]:
        heading = line.strip().lstrip('#').strip()
        if (12 <= len(heading) <= 140 and heading.startswith('《') and heading.endswith('》')
                and re.search(r'方案|规划|意见|办法|通知', heading)):
            return heading
    return title


def search_plan(city, topic, mode='draft'):
    """No questionnaire answers, materials, company secrets or model text."""
    city, topic = _public_label(city, 40), _public_label(topic, 100)
    if mode not in ('draft', 'full', 'chain'):
        raise ValueError('invalid_mode')
    common = f'{city} {topic}'
    if mode == 'chain':
        from .topic_chain import research_facets
        facets = research_facets(topic)
        # Intent words otherwise bias every query toward future action plans.
        # These two shorter queries explicitly look for existing local supply.
        subject = re.sub(r'本地化|国产替代|前沿赛道|补链|强链|招引|招商|承接|集聚|培育', '', topic).strip() or topic
        return [f'{common} 产业链 上游 材料 关键部件 '+ ' '.join(facets['上游'][:5]),
                f'{common} 产业链 中游 研制 制造 总装 测试 '+ ' '.join(facets['中游'][:5]),
                f'{common} 产业链 下游 运营 应用 服务 '+ ' '.join(facets['下游'][:5]),
                f'{common} 产业链 行动方案 全文 site:gov.cn',
                f'{common} 产业链 规划 建成 投产 原文',
                f'{common} 本地产业链 短板 配套不足 供应缺口 外部依赖 原文',
                f'{common} 本地产能 研发中试 量产 协同配套 现状 原文',
                f'{city} {subject} 现有企业 生产基地 已投产 已交付',
                f'{city} {subject} 上下游 配套产品 研发制造 已形成']
    queries = [f'{common} 产业基础 重点企业 官方发布',
               f'{common} 产业政策 行动方案 适用条件 site:gov.cn',
               f'{common} 企业官网 年度报告 项目建设']
    if mode == 'full':
        queries += [f'{common} 注册地址 生产基地 公司公告',
                    f'{common} 开工 投产 项目进度 官方 核实']
    return queries


def node_search_plan(city, topic, node_targets):
    """Public server-selected node labels only; never private questionnaire text."""
    city = _public_label(city, 40)
    _public_label(topic, 100)
    names = []
    for value in node_targets:
        if not isinstance(value, str):
            continue
        value = re.sub(r'[^\u3400-\u9fffA-Za-z0-9（）()·、， ,+\-]', ' ', value).strip()
        if value and len(value) <= 100 and value not in names:
            names.append(_public_label(value, 100))
        if len(names) == 6:
            break
    return [query for name in names for query in (
        f'{city} {name} 企业 产品 产线 供应 需求 已投产',
        f'{name} 国产化 进口依赖 技术瓶颈 年度报告')]


def _publisher(url):
    host = (urlsplit(url).hostname or '').lower()
    parts = host.split('.')
    # Conservative comparison only, not a URL validation or routing primitive.
    return '.'.join(parts[-3:] if host.endswith(('.gov.cn', '.com.cn', '.org.cn')) else parts[-2:])


def _primary_type(url, trusted_company_domains):
    host = (urlsplit(url).hostname or '').lower()
    kind = contract.classify_source_type(host)
    if kind in ('government', 'disclosure'):
        return kind
    for domain in trusted_company_domains:
        if host == domain or host.endswith('.' + domain):
            return 'company'
    return ''


def _grams(text):
    dense = re.sub(r'[^\w\u3400-\u9fff]', '', text.lower())
    return {dense[i:i+9] for i in range(max(0, len(dense)-8))}


def _same_origin(a, b):
    if contract.canonical_url(a['url']) == contract.canonical_url(b['url']):
        return True
    aa, bb = _grams(a['quote']), _grams(b['quote'])
    # Same press release hosted elsewhere is not an independent witness.
    return bool(aa and bb and len(aa & bb) / min(len(aa), len(bb)) >= .82)


def _balanced_chain_rows(candidates, limit, char_limit=None):
    """Keep whole diagnostic excerpts alongside the three industrial lanes."""
    selected, seen, size = [], set(), 0
    buckets = {lane: [row for row in candidates if lane in row.get('chain_facets', [])]
               for lane in ('约束', '基础', '评价', '上游', '中游', '下游')}
    def key(row):
        return row.get('id') or row['quote']
    def accept(row):
        nonlocal size
        seen.add(key(row))
        cost = len(json.dumps(row, ensure_ascii=False))
        if char_limit is not None and size + cost > char_limit:
            return
        selected.append(row); size += cost
    while any(buckets.values()) and len(selected) < limit:
        for lane in buckets:
            while buckets[lane] and key(buckets[lane][0]) in seen:
                buckets[lane].pop(0)
            if buckets[lane] and len(selected) < limit:
                row = buckets[lane].pop(0)
                accept(row)
    for row in candidates:
        if len(selected) >= limit:
            break
        if key(row) not in seen:
            accept(row)
    return selected


def select_source_paragraphs(text, topic, *, limit=None, mode='draft', source_title=''):
    """Relevant whole source paragraphs; never split a sentence to fit.

    A long, unsegmented page yields no quote instead of a misleading fragment.
    City names alone do not create relevance. Reuse the saved-evidence topic
    vocabulary so the online and local retrieval boundaries agree.
    """
    from .topic_evidence import topic_terms
    if not isinstance(text, str):
        return []
    limit = (MAX_CHAIN_QUOTES_PER_URL if mode == 'chain' else 3) if limit is None else limit
    terms = topic_terms(topic)
    from .topic_chain import research_facets
    facets = research_facets(topic) if mode == 'chain' else {}
    title_matches = ([term for term in terms if term.casefold() in source_title.casefold()]
                     if mode == 'chain' and isinstance(source_title, str) else [])
    own_context = {word for word in _INDUSTRY_CONTEXT_TERMS
                   if any(word in term for term in terms)}
    max_chars = 5000 if mode == 'chain' else MAX_EXCERPT_CHARS
    if not terms:
        return []
    body = grounding._eligible_body(text).strip()
    blocks = re.split(r'\n\s*\n', body)
    candidates, seen = [], set()
    for block in blocks:
        # Newlines already supplied by the source are valid boundaries. An
        # oversized single line is omitted, not cut at an arbitrary character.
        lines = block.splitlines() if len(block) > max_chars else [block]
        for paragraph in lines:
            paragraph = paragraph.strip()
            if not 35 <= len(paragraph) <= max_chars or paragraph in seen:
                continue
            matches = [term for term in terms if term.casefold() in paragraph.casefold()]
            facet_matches = {lane: [term for term in vocabulary if term.casefold() in paragraph.casefold()]
                             for lane, vocabulary in facets.items()}
            assessment = mode == 'chain' and bool(_CHAIN_ASSESSMENT.search(paragraph))
            foreign_context = any(word in paragraph and word not in own_context
                                  for word in _INDUSTRY_CONTEXT_TERMS)
            from_title = assessment and bool(title_matches) and not foreign_context
            if not matches and not any(facet_matches.values()) and not from_title:
                continue
            seen.add(paragraph)
            candidate = {'quote': paragraph, 'match_terms': matches,
                         'relevance_score': sum(min(8, len(t)) for t in matches)}
            if facets:
                candidate['chain_facets'] = [lane for lane, found in facet_matches.items() if found]
                if assessment:
                    candidate['chain_facets'].append('评价')
                if _CHAIN_BASE.search(paragraph):
                    candidate['chain_facets'].append('基础')
                if _CHAIN_CONSTRAINT.search(paragraph):
                    candidate['chain_facets'].append('约束')
                if from_title and not matches:
                    candidate['topic_context'] = 'source_title'
                    candidate['title_match_terms'] = title_matches
            candidates.append(candidate)
    candidates.sort(key=lambda entry: -entry['relevance_score'])
    if facets:
        # Select whole paragraphs across all four roles before repeated high
        # keyword-score passages can consume one page's entire allowance.
        return _balanced_chain_rows(candidates, limit)
    return candidates[:limit]


def research_topic(city, topic, *, mode='draft', questions=(), basis=(), provider=None,
                   trusted_company_domains=(), now=None, progress=None, deadline_seconds=None,
                   node_targets=()):
    """Search public sources and return an auditable, JSON-serializable bundle.

    ``trusted_company_domains`` must be derived by the server from established
    source metadata, not from an arbitrary client field or a search title.
    Brave description-only hits are pending: they cannot establish original
    passage support. Exa full text uses the existing bounded search transport.
    """
    output = {'status': 'unavailable', 'evidence': [], 'sources': {}, 'checks': [], 'queries': [], 'candidates': [],
              'errors': [], 'city': city, 'topic': topic, 'mode': mode,
              'automatic_research': False, 'automatic_cross_check': False}
    try:
        queries = node_search_plan(city, topic, node_targets) if node_targets else search_plan(city, topic, mode)
        live = copy.copy(provider) if provider is not None else providers.OpenAIResearchProvider.from_env(configured_environment(os.environ))
        if not live.enabled:
            raise ValueError('research_disabled')
        live._validate_endpoints()
        domains = []
        for domain in trusted_company_domains:
            providers.validate_https_url('https://' + domain)
            if urlsplit('https://' + domain).hostname != domain:
                raise ValueError('invalid_company_domain')
            domains.append(domain.lower())
    except (ValueError, TypeError, AttributeError):
        output['errors'] = [{'code': 'research_configuration', 'message': '公开调研服务未配置或公开检索范围无效'}]
        return output
    stamp = now or dt.datetime.now(dt.timezone.utc).isoformat()
    try:
        budget = float((85 if mode == 'draft' else 115) if deadline_seconds is None else deadline_seconds)
    except (ValueError, TypeError):
        budget = 0
    if not math.isfinite(budget) or budget <= 0:
        output['errors'] = [{'code': 'research_deadline', 'message': '公开调研时间预算不足'}]
        return output
    budget = min(budget, 115)
    # The existing transport receives the reduced timeout on this private copy.
    live.timeout = min(float(getattr(live, 'timeout', 30)), 30, budget)
    deadline = time.monotonic() + budget
    output['queries'] = queries
    closed = threading.Event()

    def emit(state, query, **extra):
        if callable(progress) and not closed.is_set():
            try:
                progress({'state': state, 'query': query,
                          'message': {'started': '正在检索公开原文', 'completed': '公开检索完成',
                                      'failed': '本项公开检索未完成'}[state], **extra})
            except Exception:
                pass  # A disconnected progress consumer cannot change evidence.

    def retrieve(query):
        if time.monotonic() >= deadline:
            raise FutureTimeout()
        emit('started', query)
        payload = live._search(query, min(live.search_count, 5))
        normalized = live._normalize_results(payload)
        raw = payload.get('results') if isinstance(payload, dict) else []
        texts = {x.get('url'): x.get('text') for x in raw or [] if isinstance(x, dict)}
        emit('completed', query, result_count=len(normalized))
        return query, normalized, texts

    evidence, seen, per_url = [], set(), {}
    source_limit = MAX_CHAIN_SOURCES if mode == 'chain' else MAX_SOURCES
    per_url_limit = MAX_CHAIN_QUOTES_PER_URL if mode == 'chain' else 3
    # Keep a bounded candidate pool until all public lane queries return. The
    # final 48-row output is balanced globally, not filled by the first query.
    candidate_limit = len(queries) * 5 * per_url_limit if mode == 'chain' else source_limit
    executor = ThreadPoolExecutor(max_workers=3)
    try:
        pending = [executor.submit(retrieve, query) for query in queries]
        for query, future in zip(queries, pending):
            try:
                _, results, texts = future.result(timeout=max(0, deadline-time.monotonic()))
            except FutureTimeout:
                future.cancel()
                emit('failed', query, code='research_deadline')
                output['errors'].append({'code': 'research_deadline', 'query': query,
                                         'message': '公开检索达到时间预算，未完成的部分保留待核'})
                continue
            except Exception:
                # Do not copy upstream exception bodies/keys into persisted UI data.
                output['errors'].append({'code': 'research_search_failed', 'query': query,
                                         'message': '公开检索未完成'})
                emit('failed', query, code='research_search_failed')
                continue
            for item in results:
                url = item.get('url', '')
                try:
                    providers.validate_https_url(url)
                except (ValueError, TypeError):
                    continue
                if (per_url.get(contract.canonical_url(url), 0) >= per_url_limit
                        or len(evidence) >= candidate_limit):
                    continue
                kind = _primary_type(url, domains)
                raw_text = texts.get(url)
                if not kind or not isinstance(raw_text, str) or not raw_text.strip():
                    if kind and len(output['candidates']) < MAX_SOURCES:
                        output['candidates'].append({'url': url, 'title': item.get('title', ''),
                                                     'retrieval': 'snippet', 'status': 'pending'})
                    continue
                fulltext = grounding._eligible_body(raw_text).strip()
                if len(fulltext) > MAX_FULLTEXT_CHARS:
                    continue
                source_title = _document_title(item.get('title', ''), fulltext)
                paragraphs = select_source_paragraphs(fulltext, topic, limit=per_url_limit,
                                                      mode=mode, source_title=source_title)
                canonical = contract.canonical_url(url)
                if not paragraphs:
                    if len(output['candidates']) < MAX_SOURCES:
                        output['candidates'].append({'url': url, 'title': item.get('title', ''),
                            'retrieval': 'fetched', 'status': 'pending',
                            'reason': 'no_complete_topic_relevant_paragraph'})
                    continue
                source_id = 'source_' + _digest(canonical+'\0'+fulltext)[:20]
                metadata = {'url': url, 'title': source_title,
                         'published_at': item.get('published', '发布日期未知'),
                         'published': item.get('published', '发布日期未知'), 'retrieved_at': stamp,
                         'retrieval': 'fetched', 'retrieval_provider': live.search_provider,
                         'source_type': kind, 'source': urlsplit(url).hostname,
                         'search_query': query, 'search_place': city, 'status': 'source',
                         'publisher_id': _publisher(url)}
                source_probe = {'url': url, 'quote': fulltext}
                origin = next((s['origin_id'] for s in output['sources'].values()
                               if _same_origin(source_probe, {'url': s['url'], 'quote': s['fulltext']})), None)
                origin = origin or 'origin_' + _digest(fulltext)[:20]
                for paragraph in paragraphs:
                    if per_url.get(canonical, 0) >= per_url_limit or len(evidence) >= candidate_limit:
                        break
                    quote = paragraph['quote']
                    entry = dict(metadata, **paragraph, excerpt=quote, source_id=source_id,
                                 origin_id=origin, id='tr_' + _digest(url+'\0'+quote)[:20])
                    if entry['id'] in seen or not FullLiveProvider._usable_evidence([entry]):
                        continue
                    seen.add(entry['id'])
                    per_url[canonical] = per_url.get(canonical, 0) + 1
                    evidence.append(entry)
                    output['sources'].setdefault(source_id,
                        dict(metadata, id=source_id, origin_id=origin, fulltext=fulltext,
                             fulltext_sha256=_digest(fulltext)))
    finally:
        closed.set()
        executor.shutdown(wait=False, cancel_futures=True)
    if mode == 'chain':
        evidence = _balanced_chain_rows(evidence, source_limit, MAX_CHAIN_EVIDENCE_CHARS)
        used_sources = {entry['source_id'] for entry in evidence}
        output['sources'] = {key: value for key, value in output['sources'].items() if key in used_sources}
    output['evidence'] = evidence[:source_limit]
    if not evidence:
        output['errors'].append({'code': 'original_evidence_missing', 'message': '未取得可核查的官方或企业原始正文'})
        output['status'] = 'pending' if not output['errors'][:-1] else 'unavailable'
        return output
    output['automatic_research'] = True
    output['status'] = 'pending' if output['errors'] else 'ready'
    # No private input is sent to retrieve(); it is only checked after retrieval.
    local_texts = []
    bases = [basis] if isinstance(basis, str) else list(basis or ())
    asks = [questions] if isinstance(questions, str) else list(questions or ())
    for item in bases[:MAX_CHECKS] + asks[:MAX_CHECKS]:
        value = item if isinstance(item, str) else (item.get('text') or item.get('quote') or '') if isinstance(item, dict) else ''
        if isinstance(value, str):
            local_texts.append(value)
    checked = validate_report('\n'.join(local_texts), output, require_citations=False)
    output['checks'] = checked['checks']
    output['automatic_cross_check'] = any(c['support_status'] == 'cross_checked' for c in checked['checks'])
    return output


def _statements(text):
    for line_number, line in enumerate((text or '').splitlines(), 1):
        line = re.sub(r'^[\s#>*\-]+', '', line).strip()
        if not line or re.fullmatch(r'[|\-:\s]+', line):
            continue
        # References commonly follow sentence punctuation. Keep the complete
        # line so those references and all qualifications remain bound.
        parts = [line]
        for part in parts:
            part = part.strip()
            if part and (_NUMBER.search(part) or _LOCATION.search(part) or _COMPLETE.search(part)
                         or _PROMISE.search(part) or _ABSENCE.search(part) or '排他性' in part):
                yield line_number, part


def _stripped(statement):
    return _REF.sub('', re.sub(r'\*\*|`', '', statement)).strip()


def _location_support(statement, evidence):
    match = _LOCATION.search(_stripped(statement))
    if not match:
        return None
    name, kind, place = match.group('name', 'kind', 'place')
    place = _URL.sub('', place).split('[')[0].strip(' ：:|')
    field = r'注册(?:地址|地)|住所' if kind in ('注册地址', '注册地', '住所') else r'办公地址|总部'
    for entry in evidence:
        body = grounding._eligible_body(entry['quote'])
        issuer = name in entry.get('title', '') or name in body.splitlines()[0]
        for paragraph in re.split(r'\n|[。；;]', body):
            if not (name in paragraph or issuer):
                continue
            for found in re.finditer(r'(?:' + field + r')\s*(?:为|在|位于|：|:)?\s*([^，。；;\n]+)', paragraph):
                if _clean(place) in _clean(found.group(1)):
                    return {'supported': True, 'quote': paragraph, 'source_sha256': _digest(paragraph)}
    return {'supported': False, 'reason': 'same_entity_and_address_field_not_supported'}


def _support(statement, entry):
    clean = _stripped(statement)
    original = entry.get('source_excerpt') or entry.get('excerpt') or entry.get('quote', '')
    if entry.get('_has_archive') and _clean(entry.get('quote', '')) not in _clean(original):
        return {'supported': False, 'reason': 'quote_not_in_archived_source'}
    location = _location_support(clean, [entry])
    if location is not None:
        return location
    policy_entry = dict(entry, excerpt=entry.get('source_excerpt') or entry.get('excerpt') or entry.get('quote', ''))
    policy_issues = grounding.synthesis_issues(clean, {'current': {'metadata': {'evidence': [policy_entry]}}})
    if any(issue['kind'] == 'policy_condition_lost' for issue in policy_issues):
        return {'supported': False, 'reason': 'policy_condition_lost'}
    # An unchanged complete source excerpt supports that quotation directly.
    # This is source support, not an assertion that the publisher is infallible.
    if _clean(clean) == _clean(entry.get('quote', '')):
        return {'supported': True, 'quote': entry['quote'], 'source_sha256': _digest(entry['quote'])}
    observations = grounding.evidence_observations(evidence=[entry])
    result = grounding.source_support(clean, observations, entry['url'])
    if not result.get('supported'):
        return result
    quote = result.get('quote', '')
    if _COMPLETE.search(clean) and not _PLAN.search(clean) and _PLAN.search(quote):
        return {'supported': False, 'reason': 'plan_does_not_prove_completion'}
    # The shared verifier normalizes financial quantities; additionally protect
    # counts, area and time values it deliberately does not model.
    values = {_clean(x.group()) for x in _NUMBER.finditer(clean) if not x.group().endswith('年')}
    source_values = {_clean(x.group()) for x in _NUMBER.finditer(quote)}
    nonfinancial = {v for v in values if not re.search(r'亿元|万元|元|吨|亩|%|％', v)}
    if not nonfinancial <= source_values:
        return {'supported': False, 'reason': 'count_area_or_date_not_in_same_span'}
    return result


def validate_report(text, research_result, *, require_citations=True):
    """Check saved original spans, not a model's self-reported verdict.

    Unsupported claims remain explicit; this function never silently repairs a
    report or upgrades user confirmation into verified evidence.
    """
    if not isinstance(text, str) or len(text) > 200000:
        return {'status': 'unsupported', 'verified': False, 'checks': [],
                'issues': [{'kind': 'invalid_or_oversized_report'}], 'scope': 'saved_original_passages_only'}
    evidence = research_result.get('evidence', []) if isinstance(research_result, dict) else []
    archives = research_result.get('sources', {}) if isinstance(research_result, dict) else {}
    evidence = [dict(e, source_excerpt=archives.get(e.get('source_id'), {}).get('fulltext', e.get('excerpt') or e.get('quote', '')),
                         _has_archive=e.get('source_id') in archives)
                for e in evidence if isinstance(e, dict)]
    by_id = {e['id']: e for e in evidence if isinstance(e, dict) and e.get('id')}
    checks, issues = [], []
    reference_pattern = _ANY_SOURCE_REF if require_citations else _REF
    unknown_refs = set(reference_pattern.findall(text or '')) - set(by_id)
    for ref in sorted(unknown_refs):
        issues.append({'kind': 'unknown_evidence_reference', 'evidence_id': ref})
    for line, statement in list(_statements(text))[:MAX_CHECKS]:
        declared = _REF.findall(statement)
        urls = _URL.findall(statement)
        selected = [e for e in evidence if e.get('id') in declared or e.get('url') in urls]
        if not require_citations:
            selected = evidence
        reasons = []
        negative_promise = re.search(r'(?:不得|不能|不应|不要|无法).{0,8}(?:承诺|保证|锁定)', statement)
        if _PROMISE.search(statement) and not negative_promise:
            reasons.append('unverified_procurement_or_benefit_promise')
        if _ABSENCE.search(statement):
            reasons.append('absence_requires_direct_survey_evidence')
        if '排他性' in statement:
            reasons.append('exclusivity_requires_comparative_evidence')
        if require_citations and not selected and not _UNCERTAIN.search(statement):
            reasons.append('missing_original_evidence_reference')
        supports = []
        for entry in selected:
            support = _support(statement, entry)
            if support.get('supported'):
                supports.append({'evidence_id': entry['id'], 'url': entry['url'],
                                 'origin_id': entry['origin_id'], 'publisher_id': entry['publisher_id'],
                                 'quote': support.get('quote', ''), 'source_sha256': support.get('source_sha256', '')})
        independent = any(a['origin_id'] != b['origin_id'] and a['publisher_id'] != b['publisher_id']
                          for i, a in enumerate(supports) for b in supports[i+1:])
        status = 'cross_checked' if independent else 'single_source' if supports else 'unsupported'
        if reasons:
            status = 'unsupported'
        if not supports and not reasons:
            reasons = ['claim_not_supported_by_original_span']
        checks.append({'line': line, 'claim': statement, 'support_status': status,
                       'sources': supports, 'reasons': reasons,
                       'explicitly_uncertain': bool(_UNCERTAIN.search(statement))})
    if len(list(_statements(text))) > MAX_CHECKS:
        issues.append({'kind': 'claim_limit_exceeded', 'limit': MAX_CHECKS})
    status = ('cross_checked' if checks and all(c['support_status'] == 'cross_checked' for c in checks)
              else 'single_source' if checks and all(c['support_status'] != 'unsupported' for c in checks)
              else 'unsupported')
    if issues:
        status = 'unsupported'
    return {'status': status, 'verified': status == 'cross_checked', 'checks': checks, 'issues': issues,
            'scope': 'saved_original_passages_only'}
