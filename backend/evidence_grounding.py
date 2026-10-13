"""Conservative evidence projection for interactive AI features.

The model chooses useful evidence; it cannot create a stronger factual sentence.
Only exact saved excerpts cross the fact boundary. Sources remain hypotheses until
someone checks their primary documents; this module does not certify web truth.
"""
import copy
import hashlib
import json
import re
import unicodedata
from urllib.parse import urlsplit
from .auth import AuthError

_URL = re.compile(r'https?://[^\s<>\]）)"\']+')
_UNCERTAIN = re.compile(r'待核|未核|未见|未检索|未找到|暂无|不详|推断|推测|可能|据称|线索|第三方|自媒体|过期|失效|有效期')
_DATE = re.compile(r'20\d{2}[-年/]\d{1,2}(?:[-月/]\d{1,2}日?)?')


def _text(value):
    if isinstance(value, str):
        return value
    return str(value.get('text') or '') if isinstance(value, dict) else ''


def _url(value):
    if not isinstance(value, str):
        return ''
    try:
        p = urlsplit(value)
        return value if p.scheme in ('http', 'https') and p.netloc and not p.username and not p.password else ''
    except ValueError:
        return ''


def project_context(body, state):
    """Use a previously scoped server snapshot, never client supplied corpus/city."""
    key = body.get('projectKey')
    projects = state.get('PROJECTS') or {}
    if not isinstance(key, str) or not isinstance(projects.get(key), dict):
        raise AuthError(403, 'project_required', '请选择有权限的工作区')
    p = projects[key]
    topic = body.get('topic') or p.get('topic') or ''
    allowed = {p.get('topic', '')}
    for item in p.get('topics') or []:
        allowed.add(item.get('label', '') if isinstance(item, dict) else str(item))
    rs = (state.get('REPORTSTATE') or {}).get(key) or {}
    allowed.update((rs.get('aiReportByTopic') or {}).keys())
    allowed.update((rs.get('pendingByTopic') or {}).keys())
    if not isinstance(topic, str) or not topic or topic not in allowed:
        raise AuthError(409, 'topic_mismatch', '方向与当前工作区不一致，请刷新后重试')
    reqid = p.get('reportRequestId') or rs.get('reportRequestId') or ''
    supplied = body.get('reportRequestId')
    if supplied and supplied != reqid:
        raise AuthError(409, 'report_changed', '报告版本已更新，请刷新后重试')
    root = p.get('workspaceId') or key
    corpus = []
    has_source_revision = False
    # Base knowledge and current direction only; same city is NOT an access key.
    keys = list(dict.fromkeys([root, key]))
    for k in keys:
        project = projects.get(k) or {}
        if k != key and (project.get('workspaceId') or k) != root:
            continue
        from .kb_edits import effective_known
        for section_index, section in enumerate(project.get('kb') or []):
            for item in effective_known(state, k, section_index):
                if isinstance(item, dict) and item.get('_kbEditId'):
                    edits = (state.get('KB_EDITS') or {}).get(k) or {}
                    revision = edits.get(item['_kbEditId'])
                    if isinstance(revision, dict) and revision.get('sourceIndex') is not None:
                        has_source_revision = True
                text = _text(item)
                if text.strip():
                    corpus.append({'text': text, 'cite': (item.get('src') or section.get('t') or '') if isinstance(item, dict) else section.get('t', ''), 'topic': section.get('t', ''), 'origin': item.get('origin', '') if isinstance(item, dict) else '', 'nature': item.get('nature', '') if isinstance(item, dict) else ''})
    by_topic = rs.get('aiReportByTopic') or {}
    report = by_topic.get(topic)
    if not report and topic == (rs.get('topic') or p.get('topic')):
        report = rs.get('text')
    # A saved source revision supersedes passages that may also occur in the
    # archived report. Do not reintroduce its old facts as parallel evidence.
    # Notes alone do not invalidate a report; inactive/deleted edits never
    # carry _kbEditId into effective_known and therefore do not suppress it.
    if report and not has_source_revision:
        for block in re.split(r'\n\s*\n', str(report)):
            if block.strip():
                corpus.append({'text': block, 'cite': '当前报告 / '+topic, 'topic': topic, 'origin': 'report'})
    dedup, positions = [], {}
    for chunk in corpus:
        sig = hashlib.sha256(chunk['text'].encode()).hexdigest()
        chunk['id'] = 'ev_'+sig[:20]
        if sig in positions:
            # Identical report text is still current-topic evidence even if
            # it was encountered first in a generic base knowledge section.
            # Preserve the content-based ID; do not widen a foreign-only row.
            index = positions[sig]
            if chunk.get('topic') == topic and dedup[index].get('topic') != topic:
                dedup[index] = chunk
            continue
        positions[sig] = len(dedup)
        dedup.append(chunk)
    if not dedup:
        raise AuthError(409, 'evidence_missing', '当前工作区尚无可核查材料，请先补充材料')
    return {'projectKey': key, 'workspaceId': root, 'topic': topic, 'city': p.get('city', ''), 'reportRequestId': reqid, 'chunks': dedup, 'onboarding': p.get('onboarding') or {}, 'reportState': rs}


def validate_confirmations(body, context):
    rs, topic = context['reportState'], context['topic']
    saved = (rs.get('pendingByTopic') or {}).get(topic)
    incoming = body.get('confirmations')
    if (rs.get('phaseByTopic') or {}).get(topic) != 1 or not isinstance(saved, list) or not saved:
        raise AuthError(409, 'confirmation_required', '请先生成并确认当前方向草稿')
    if not isinstance(incoming, list) or len(saved) != len(incoming):
        raise AuthError(409, 'confirmation_required', '待确认事项已更新，请刷新后确认')
    def signature(x):
        if not isinstance(x, dict) or not isinstance(x.get('text'), str) or not x['text'].strip():
            return None
        status = x.get('status')
        if status not in ('confirmed', 'edited'):
            return None
        edited = x.get('editedText', '')
        if status == 'edited' and (not isinstance(edited, str) or not edited.strip()):
            return None
        return (x['text'], status, edited)
    if any(signature(a) is None or signature(a) != signature(b) for a, b in zip(saved, incoming)):
        raise AuthError(409, 'confirmation_required', '请先保存并确认全部事项，再生成完整研判')


def evidence_catalog(chunks):
    """Bounded excerpts retain an entire line including qualifications and URLs."""
    out = []
    for chunk in chunks:
        text = _text(chunk)
        for line in text.splitlines():
            line = line.strip()
            if len(line) < 12 or len(line) > 3500:
                continue
            urls = [_url(x.rstrip('.,;，。；')) for x in _URL.findall(line)]
            # A block can contain several unrelated companies. A URL on a
            # different line does not establish provenance for this sentence.
            # Keep unlinked sentences visible as pending, never URL-backed.
            urls = list(dict.fromkeys(x for x in urls if x))[:6]
            sid = 'src_'+hashlib.sha256((chunk.get('id', '')+'\0'+line).encode()).hexdigest()[:20]
            out.append({'id': sid, 'quote': line, 'urls': urls, 'cite': chunk.get('cite', ''), 'date': (_DATE.search(line).group(0) if _DATE.search(line) else ''), 'status': 'pending' if _UNCERTAIN.search(line) or not urls else 'source', 'topic': chunk.get('topic', '')})
    return list({x['id']: x for x in out}.values())


def bounded_catalog(catalog, limit=96, char_limit=48000):
    """Whole excerpts, balanced across source groups and first/middle/last."""
    buckets = {}
    for entry in catalog:
        buckets.setdefault(entry.get('topic', ''), []).append(entry)
    for key, entries in buckets.items():
        order, used = [], set()
        # Dyadic sampling reaches the last third before consuming another
        # introductory paragraph. No excerpt or conditional clause is cut.
        positions = [0, len(entries)//2, len(entries)-1]
        step = 4
        while step <= max(4, 2*len(entries)):
            positions.extend(round((len(entries)-1)*i/step) for i in range(1, step, 2))
            step *= 2
        for index in positions + list(range(len(entries))):
            if index not in used:
                used.add(index); order.append(entries[index])
        buckets[key] = order
    result, size = [], 0
    while buckets and len(result) < limit:
        for key in list(buckets):
            entry = buckets[key].pop(0)
            cost = len(json.dumps(entry, ensure_ascii=False))
            if size+cost <= char_limit:
                result.append(entry); size += cost
            if not buckets[key]:
                del buckets[key]
            if len(result) >= limit:
                break
    return result


def model_catalog(catalog):
    return '\n'.join(json.dumps(x, ensure_ascii=False) for x in catalog)


def _refs(item, catalog, value=''):
    by_id = {x['id']: x for x in catalog}
    ids = item.get('evidence_ids') or []
    if isinstance(ids, str):
        ids = [ids]
    refs = [by_id[x] for x in ids if x in by_id]
    # Compatibility: a literal existing value can locate a source, never its
    # paraphrase, and never a substring as short as a generic industry label.
    if not refs and isinstance(value, str) and len(value.strip()) >= 8:
        refs = [x for x in catalog if value.strip() in x['quote']][:3]
    return refs


def _basis(refs):
    return [{'id': r['id'], 'quote': r['quote'], 'urls': r['urls'], 'date': r['date'], 'status': r['status'], 'cite': r['cite']} for r in refs]


def _key(name):
    return re.sub(r'[\W_]', '', unicodedata.normalize('NFKC', name)).casefold()


def ground_funnel(obj, catalog, context):
    if not isinstance(obj, dict) or not isinstance(obj.get('companies'), list):
        raise ValueError('invalid funnel JSON')
    companies, seen, dropped = [], set(), 0
    for raw in obj['companies']:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get('name') or '').strip()
        key = _key(name)
        refs = [r for r in _refs(raw, catalog, name) if name and name in r['quote'] and r['urls']]
        if not key or key in seen or not refs:
            dropped += 1
            continue
        seen.add(key)
        # Retain the exact saved record, including its caveats. AI business-fit
        # and intent scores cannot become facts via a loosely related citation.
        quotes = '；'.join(r['quote'] for r in refs[:2])
        kind = str(raw.get('kind') or '')
        region = str(raw.get('region') or '')
        def literal(v):
            return v if v and any(v in r['quote'] for r in refs) else ''
        item = {'id': 'f_'+context['projectKey']+'_ev'+hashlib.sha256(key.encode()).hexdigest()[:12], 'name': name, 'kind': literal(kind), 'region': literal(region),
                'fit': '材料记录：'+quotes+'；与当前方向的业务适配仍需核验。',
                'score_match': None, 'score_relocate': None, 'score_strength': None,
                'fit_score': None, 'score_reason': '证据目录仅证明存在所引材料；不据此推算投资意向或企业实力。',
                'signal': '', 'expansion': '', 'faction': '', 'listed': literal(str(raw.get('listed') or '')),
                'source': '；'.join(dict.fromkeys(u for r in refs for u in r['urls'])),
                'evidence': _basis(refs), 'evidence_status': 'pending', 'investment_intent': 'unknown', 'push_eligible': False}
        # Only an exact source sentence explicitly about investment intent may
        # be shown as a signal, and it still does not imply intent in this city.
        signal = str(raw.get('signal') or '')
        if signal and any(signal in r['quote'] for r in refs):
            item['signal'] = signal+'（材料线索，非已核实本地投资意向）'
        companies.append(item)
    if not companies and obj['companies']:
        raise ValueError('没有企业通过来源核对；请补充该方向企业名录或原始链接')
    return {'topic': context['topic'], 'projectKey': context['projectKey'],
            'reportRequestId': context['reportRequestId'], 'total_scanned': len(companies),
            'source_records': len(catalog), 'rejected_count': dropped, 'companies': companies,
            'evidence_contract': 'saved-excerpts-v1',
            'notice': ('当前材料不足以形成有来源的企业候选；不代表现实中不存在相关企业。' if not companies else
                       '当前为材料候选清单，逐条保留来源；业务适配和投资意向未核验，不可直接批量推送。')}


def ground_profile(obj, catalog, context):
    if not isinstance(obj, dict):
        raise ValueError('invalid profile JSON')
    result = {'objective': {}, 'preference': {}, 'strength': [], 'weakness': [], 'conflicts': [], 'gaps': [], 'charts': {}, 'evidence_contract': 'saved-excerpts-v1', 'projectKey': context['projectKey'], 'topic': context['topic'], 'reportRequestId': context['reportRequestId']}
    ledger, seen = [], set()
    for group in ('economy', 'structure', 'industry', 'park', 'anchor', 'cost'):
        rows = []
        for raw in (obj.get('objective') or {}).get(group) or []:
            if not isinstance(raw, dict):
                continue
            refs = _refs(raw, catalog, str(raw.get('value') or ''))
            for ref in refs[:1]:
                if ref['id'] in seen:
                    continue
                seen.add(ref['id']); ledger.append(ref)
                rows.append({'label': {'economy':'经济材料','structure':'结构材料','industry':'产业材料','park':'承载材料','anchor':'企业材料','cost':'成本材料'}[group], 'value': ref['quote'], 'detail': '待核查原始来源；保留材料原有条件、日期和不确定性。', 'cite': '；'.join(ref['urls']) or ref['cite'], 'status': ref['status'], 'evidence': _basis([ref])})
        result['objective'][group] = rows
    # Keep usable evidence even when a legacy model ignored the evidence schema.
    if not ledger:
        for ref in catalog:
            if ref['urls'] and re.search(r'GDP|生产总值|亿元|产业|园区', ref['quote'], re.I):
                ledger.append(ref)
                result['objective']['economy'].append({'label': '材料摘录', 'value': ref['quote'], 'detail': '原始材料摘录，待核查其来源与有效期。', 'cite': '；'.join(ref['urls']), 'status': ref['status'], 'evidence': _basis([ref])})
                if len(ledger) == 8:
                    break
    if not ledger:
        raise ValueError('没有可追溯的画像材料，请补充原始来源')
    result['summary'] = '依据当前工作区材料整理，尚未完成原始来源核验。'+ ' '.join(r['quote'] for r in ledger[:2])
    stated = context.get('onboarding') or {}
    for dimension in ('industry', 'park', 'scale', 'invest', 'capacity'):
        raw = (obj.get('preference') or {}).get(dimension) or {}
        value = stated.get(dimension)
        items = [str(x) for x in value] if isinstance(value, list) else [value] if isinstance(value, str) and value.strip() else []
        if items:
            result['preference'][dimension] = {'items': items, 'source': 'stated', 'confidence': 'high', 'basis': '当前工作区已保存问卷；仅表示填写者的偏好。'}
        else:
            refs = _refs(raw, catalog, str(raw.get('basis') or ''))
            result['preference'][dimension] = {'items': ['待补充'], 'source': 'unknown', 'confidence': 'low', 'basis': '尚无已保存的明确偏好；材料不能替代用户意愿。', 'evidence': _basis(refs[:2])}
    result['engagement'] = {'level': 'low', 'signals': ['偏好以已保存问卷为准；其余维度尚需补充。']}
    result['gaps'] = ['材料中的“未见”“待核”不代表现实中不存在；请核验原始来源、政策期限和适用条件。', '图表需要可追溯的同口径数值，未经核对不绘制。']
    result['evidence'] = _basis(ledger)
    return result


def funnel_demand_anchors(context):
    """Exact current-topic material a human may use for a match review.

    These anchors establish what was reviewed, not whether a product is
    technically suitable. A base-workspace excerpt or another topic is not a
    substitute for the current demand. IDs retain source positions so stale
    dialogs cannot silently bind the same index to changed text.
    """
    rs, topic = context['reportState'], context['topic']
    anchors = []
    for index, item in enumerate((rs.get('pendingByTopic') or {}).get(topic) or []):
        if not isinstance(item, dict) or item.get('status') not in ('confirmed', 'edited'):
            continue
        quote = item.get('editedText') if item.get('status') == 'edited' else item.get('text')
        if isinstance(quote, str) and 12 <= len(quote.strip()) <= 3500:
            anchors.append({'id': 'confirmation:'+str(index), 'kind': 'confirmation', 'quote': quote.strip()})
    phase = (rs.get('phaseByTopic') or {}).get(topic)
    if phase is None and rs.get('topic') == topic:
        phase = rs.get('phase')
    if phase == 2:
        report = (rs.get('aiReportByTopic') or {}).get(topic)
        if not report and rs.get('topic') == topic:
            report = rs.get('text')
        if isinstance(report, str):
            for index, line in enumerate(report.split('\n')):
                quote = line.strip()
                if 12 <= len(quote) <= 3500:
                    anchors.append({'id': 'report:'+str(index), 'kind': 'report', 'quote': quote})
    return anchors


def resource_review_preview(body, state):
    """Read-only projection of saved resource identities into this workspace."""
    context = project_context(body, state)
    if body.get('topic') != context['topic'] or body.get('reportRequestId') != context['reportRequestId']:
        raise AuthError(409, 'report_changed', '请刷新当前方向和报告版本后重试')
    if state['PROJECTS'][context['projectKey']].get('topic') != context['topic']:
        raise AuthError(409, 'topic_changed', '当前方向已切换，请重新选择')
    ids = body.get('resourceIds')
    if not isinstance(ids, list) or not 1 <= len(ids) <= 8 or not all(isinstance(i, str) and i for i in ids) or len(set(ids)) != len(ids):
        raise AuthError(400, 'invalid_selection', '请选择 1 至 8 家有保存编号的资源企业')
    catalog = evidence_catalog(context['chunks'])
    companies, unavailable = [], []
    selected_names = set()
    for rid in ids:
        resources = [r for r in state.get('OPS_ENT', []) if isinstance(r, dict) and str(r.get('id', '')) == rid]
        if len(resources) != 1 or not isinstance(resources[0].get('name'), str) or not resources[0]['name'].strip():
            raise AuthError(409, 'resource_changed', '资源企业编号已变化，请刷新后重新选择')
        name = resources[0]['name'].strip()
        if _key(name) in selected_names:
            raise AuthError(409, 'resource_changed', '所选资源包含同名企业，请选择一个明确的资源编号')
        selected_names.add(_key(name))
        refs = [r for r in catalog if name in r['quote'] and r['urls']]
        if not refs:
            unavailable.append({'resourceId': rid, 'name': name, 'reason': '当前工作区缺少该企业带来源链接的产品原文，请先补充材料'})
            continue
        candidate = ground_funnel({'companies': [{'name': name, 'evidence_ids': [r['id'] for r in refs]}]}, catalog, context)['companies'][0]
        candidate['resourceId'] = rid
        companies.append(candidate)
    return {'projectKey': context['projectKey'], 'topic': context['topic'], 'reportRequestId': context['reportRequestId'],
            'evidence_contract': 'saved-excerpts-v1', 'source': 'resource', 'resourceIds': ids,
            'companies': companies, 'unavailable': unavailable, 'demandAnchors': funnel_demand_anchors(context),
            'notice': '仅按当前工作区原文整理资源企业。请逐家核对产品和需求；未发现来源的企业不能推送。'}


def review_and_push(body, state, actor):
    """Admin attests business fit; committed source-backed clues remain pending.

    This does not certify investment intent. A city name or client-authored
    company body is never sufficient to address or write a workspace.
    """
    context = project_context(body, state)
    if not isinstance(body.get('reportRequestId'), str) or body['reportRequestId'] != context['reportRequestId'] or body.get('topic') != context['topic']:
        raise AuthError(409, 'report_changed', '请明确选择当前方向和报告版本后重新核对')
    key = context['projectKey']
    project = state['PROJECTS'][key]
    if project.get('topic') != context['topic']:
        raise AuthError(409, 'topic_changed', '当前方向已切换，请重新核对')
    resource_mode = body.get('source') == 'resource'
    if body.get('source') not in (None, 'funnel', 'resource'):
        raise AuthError(400, 'invalid_selection', '企业来源不正确')
    funnel = resource_review_preview(body, state) if resource_mode else project.get('funnel') or {}
    if funnel.get('evidence_contract') != 'saved-excerpts-v1' or funnel.get('reportRequestId', '') != context['reportRequestId'] or funnel.get('topic') != context['topic']:
        raise AuthError(409, 'funnel_stale', '候选来源或报告版本已更新，请重新分析')
    names = body.get('names')
    if not isinstance(names, list) or not 1 <= len(names) <= 8 or not all(isinstance(n, str) and n.strip() for n in names) or len(set(names)) != len(names):
        raise AuthError(400, 'invalid_selection', '每次请选择 1 至 8 家不同企业')
    if resource_mode and (len(funnel['companies']) != len(body['resourceIds']) or set(names) != {c['name'] for c in funnel['companies']}):
        raise AuthError(409, 'evidence_missing', '所选资源企业缺少当前工作区的产品原文，不能推送')
    reviews = body.get('reviews')
    if not isinstance(reviews, list) or len(reviews) != len(names) or any(not isinstance(r, dict) for r in reviews):
        raise AuthError(400, 'review_required', '请逐家选择产品来源、当前需求原句并填写适配理由')
    review_by_name = {r.get('name'): r for r in reviews if isinstance(r.get('name'), str)}
    if len(review_by_name) != len(names) or set(review_by_name) != set(names):
        raise AuthError(400, 'review_required', '每家所选企业必须有独立的核对记录')
    demand_anchors = {a['id']: a for a in funnel_demand_anchors(context)}
    candidates = {c.get('name'): c for c in funnel.get('companies', []) if isinstance(c, dict)}
    catalog = {c['id']: c for c in evidence_catalog(context['chunks'])}
    checked = []
    for name in names:
        c = candidates.get(name)
        evidence = c.get('evidence') if c else None
        if not isinstance(evidence, list) or not evidence:
            raise AuthError(409, 'evidence_missing', '所选候选缺少可核查来源')
        for ref in evidence:
            if not isinstance(ref, dict) or not isinstance(ref.get('id'), str):
                raise AuthError(409, 'evidence_changed', '候选来源已变化，请重新分析并核查')
            current = catalog.get(ref['id'])
            if not current or ref.get('quote') != current['quote'] or ref.get('urls') != current['urls'] or name not in current['quote'] or not current['urls']:
                raise AuthError(409, 'evidence_changed', '候选来源已变化，请重新分析并核查')
        review = review_by_name[name]
        note = review.get('reason')
        if review.get('confirmed') is not True or not isinstance(note, str) or not 12 <= len(note.strip()) <= 1200:
            raise AuthError(400, 'review_required', '请逐家确认两份原句并填写至少 12 字的人工适配理由')
        product, demand = review.get('product'), review.get('demand')
        if not isinstance(product, dict) or not isinstance(demand, dict):
            raise AuthError(400, 'review_required', '产品来源与需求原句缺一不可')
        product_id, demand_id = product.get('evidenceId'), demand.get('anchorId')
        if not isinstance(product_id, str) or not isinstance(demand_id, str):
            raise AuthError(400, 'review_required', '请选择有效的产品来源与需求原句')
        source = catalog.get(product_id)
        if (not source or source['id'] not in {r['id'] for r in evidence}
                or product.get('quote') != source['quote'] or name not in source['quote'] or not source['urls']):
            raise AuthError(409, 'evidence_changed', '产品来源原句已变化或不属于该企业，请重新核对')
        anchor = demand_anchors.get(demand_id)
        if not anchor or demand.get('quote') != anchor['quote']:
            raise AuthError(409, 'demand_changed', '当前方向的需求原句已变化或尚未确认，请重新核对')
        # /api/sync can update stored candidates. Their derived description,
        # category, source and scores are not trusted even when evidence is
        # unchanged. Re-project only the verified identity and current refs.
        fresh = ground_funnel({'companies': [{'name': name, 'evidence_ids': [r['id'] for r in evidence]}]}, list(catalog.values()), context)
        item = fresh['companies'][0]
        if resource_mode:
            item['resourceId'] = c['resourceId']
        item['match_review'] = {'reason': note.strip(),
            'product': {'evidenceId': source['id'], 'quote': source['quote'], 'urls': list(source['urls'])},
            'demand': {'anchorId': anchor['id'], 'kind': anchor['kind'], 'quote': anchor['quote']}}
        checked.append(item)
    now = __import__('time').time_ns() // 1_000_000
    clues = project.setdefault('clues', [])
    existing = {_key(c.get('name', '')) for c in clues if isinstance(c, dict)}
    tombs = set(state.get('DELETED_CLUES') or [])
    from .sync_merge import _clue_tombstoned
    added, skipped = [], []
    for c in checked:
        nk = _key(c['name'])
        if nk in existing or _clue_tombstoned(key, c, tombs):
            skipped.append(c['name']); continue
        cid = 'f_review_'+hashlib.sha256((key+'\0'+nk).encode()).hexdigest()[:20]
        review = c['match_review']
        clues.append({'id': cid, 'name': c['name'], 'kind': c.get('kind', ''), 'region': c.get('region', ''),
            'gap': context['topic'], 'status': 'ops_rec', 'tone': 'amber',
            'reason': '人工适配意见（待核验）：'+review['reason'], 'fit': c.get('fit', ''),
            'signal': '投资意向未知，待资源团队核验', 'hasMoveSignal': False,
            'source': c.get('source', ''), 'signalSrc': c.get('source', ''),
            'evidence': copy.deepcopy(c['evidence']), 'investment_intent': 'unknown',
            'questions': ['核实是否有本地区投资意向', '核实业务适配和可供产品', '核实落地条件'],
            'review': {'actor': actor, 'at': now, 'note': review['reason'], 'scope': 'human_match_review_pending',
                       'product': review['product'], 'demand': review['demand']},
            'sourceResourceId': c.get('resourceId'),
            'reportRequestId': context['reportRequestId']})
        existing.add(nk); added.append(c['name'])
    if not resource_mode:
        funnel['pushed'] = bool(added or skipped)
        funnel['pushedAt'] = now
        funnel['pushedNames'] = list(dict.fromkeys((funnel.get('pushedNames') or [])+added))
    else:
        # Record only an actual current-resource delivery (or its exact
        # idempotent predecessor). Name-only duplicates and tombstones cannot
        # upgrade a different resource's delivery status.
        for c in checked:
            delivered = any(_key(clue.get('name', '')) == _key(c['name'])
                            and clue.get('sourceResourceId') == c['resourceId']
                            and clue.get('reportRequestId') == context['reportRequestId']
                            for clue in clues if isinstance(clue, dict))
            if not delivered:
                continue
            resource = next(r for r in state['OPS_ENT'] if isinstance(r, dict) and str(r.get('id', '')) == c['resourceId'])
            matches = resource.setdefault('matches', [])
            exact = [m for m in matches if isinstance(m, dict) and m.get('projKey') == key and (not m.get('city') or m['city'] == context['city'])]
            if exact:
                for match in exact:
                    match['pushed'] = True
            else:
                matches.append({'projKey': key, 'city': context['city'], 'pushed': True, 'evidenceStatus': 'pending'})
    return {'ok': True, 'added': added, 'skipped': skipped, 'projectKey': key, 'status': 'pending_investment_verification'}


def ground_chain(obj, catalog, context):
    if not isinstance(obj, list):
        raise ValueError('invalid chain JSON')
    groups = {name: [] for name in ('上游', '中游', '下游')}
    valid_segments = 0
    for segment in obj:
        if (not isinstance(segment, dict) or segment.get('seg') not in groups
                or not isinstance(segment.get('nodes'), list)):
            continue
        valid_segments += 1
        nodes, seen = groups[segment['seg']], set()
        for raw in segment.get('nodes') or []:
            if not isinstance(raw, dict):
                continue
            name = str(raw.get('name') or '').strip()
            if not name or len(name) > 80 or name in seen:
                continue
            seen.add(name)
            refs = [x for x in _refs(raw, catalog, name)
                    if x.get('topic') == context.get('topic') and context.get('topic')
                    and name in x['quote'] and x['urls']]
            # Unknown is a claim about verification, not permission to add a
            # model-created or another direction's industrial segment.
            if not refs:
                continue
            level = 'unknown'
            if refs:
                # Source wording, never model confidence, determines whether
                # even a provisional strength label may be displayed.
                clauses = [clause for x in refs if not _UNCERTAIN.search(x['quote']) for clause in re.split(r'[，,；;。！？!?\n]', x['quote']) if name in clause]
                unambiguous = [q for q in clauses if not _UNCERTAIN.search(q)]
                strong = any(re.search(r'本地强|优势环节|核心优势', q) for q in unambiguous)
                weak = any(re.search(r'薄弱|短板', q) for q in unambiguous)
                if strong != weak:
                    if strong:
                        level = 'strong'
                    elif weak:
                        level = 'weak'
            leaders = []
            for leader in raw.get('local_leaders') or []:
                # The same short clause must identify the node, company and
                # this city. Mentions elsewhere in a paragraph cannot establish
                # that the company serves this local industrial segment.
                city = context.get('city') or ''
                if isinstance(leader, str) and leader and city and any(leader in q and city in q and name in q and len(q) <= 250 for r in refs if not _UNCERTAIN.search(r['quote']) for q in re.split(r'[，,；;。！？!?\n]', r['quote'])):
                    leaders.append(leader)
            nodes.append({'name': name, 'level': level,
                'note': ('材料原文：'+'；'.join(x['quote'] for x in refs[:2])+'；强弱及落地状态仍待核实。') if refs else '待核节点：当前材料缺少可追溯依据，不能判定本地强弱或现实中不存在。',
                'local_leaders': leaders, 'benchmark': [], 'evidence_ids': [x['id'] for x in refs], 'sourceRecords': _basis(refs), 'urls': list(dict.fromkeys(u for x in refs for u in x['urls']))})
    if obj and not valid_segments:
        raise ValueError('invalid chain segments')
    # Empty current-topic evidence is a completed material-gap result, never
    # a fabricated node or an assertion that this industry does not exist.
    return [{'seg': name, 'nodes': nodes} for name, nodes in groups.items()]


def enterprise_sources(event):
    """Only transport citation/tool metadata counts, never model JSON URLs."""
    found = []
    def visit(value):
        if isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, dict):
            if value.get('type') == 'url_citation':
                url = _url(value.get('url'))
                if url:
                    found.append({'url': url, 'title': str(value.get('title') or '')[:240]})
            if value.get('type') == 'web_search_call':
                for item in (value.get('action') or {}).get('sources') or []:
                    if isinstance(item, dict):
                        url = _url(item.get('url'))
                        if url:
                            found.append({'url': url, 'title': str(item.get('title') or '')[:240]})
            for key, child in value.items():
                # Model output text can contain arbitrary URLs and must never
                # be parsed as trusted transport metadata.
                if key not in ('text', 'delta', 'arguments'):
                    visit(child)
    visit(event)
    return list({item['url']: item for item in found}.values())


def ground_enterprise_draft(obj, sources, name):
    """Public-search suggestions remain an explicitly unverified draft.

    Citations show where to check; they do not verify a model's claim. Never
    derive an investment signal from search or let a model URL certify itself.
    """
    if not isinstance(obj, dict):
        raise ValueError('invalid enterprise draft JSON')
    safe_sources = list({item['url']: {'url': item['url'], 'title': str(item.get('title') or '')[:240]} for item in sources if isinstance(item, dict) and _url(item.get('url'))}.values())
    result = {'entityName': name, 'evidence_contract': 'enterprise-draft-v1',
              'evidence_status': 'unverified', 'investment_intent': 'unknown',
              'hasMoveSignal': False, 'sources': safe_sources, 'signal': '',
              'notice': '搜索建议未经事实核验。请逐条打开来源核对；采纳后仍为待核资料，不代表投资意向。'}
    for field in ('kind', 'region', 'revenue', 'employees', 'gap', 'note'):
        value = obj.get(field)
        result[field] = value.strip()[:1200] if safe_sources and isinstance(value, str) else ''
    result['tags'] = [v.strip()[:80] for v in (obj.get('tags') or []) if isinstance(v, str) and v.strip()][:12] if safe_sources and isinstance(obj.get('tags'), list) else []
    result['faction'] = []
    if safe_sources and isinstance(obj.get('faction'), list):
        for item in obj['faction'][:10]:
            if isinstance(item, dict):
                result['faction'].append({key: str(item.get(key) or '')[:160] for key in ('person', 'label', 'type')})
    result['field_status'] = {key: 'draft_unverified' for key in ('kind', 'region', 'revenue', 'employees', 'gap', 'note', 'tags', 'faction') if result[key]}
    if not safe_sources:
        result['notice'] = '本次未返回可核查搜索来源，未填充企业字段。请补充官方资料后再核验。'
    return result
