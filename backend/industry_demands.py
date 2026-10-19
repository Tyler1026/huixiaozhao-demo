"""Create one atomic, source-bound demand from one saved report priority.

The client chooses a reviewed suggestion and writes the requested action.  It
cannot supply report text, evidence, or a claim that its request is a verified
local shortage.  The source report topic stays separate from the demand title.
"""
from __future__ import annotations

import copy
import hashlib
import json
import time
import uuid
from urllib.parse import urlsplit

from .access_control import authorize_project, scoped_sync_view
from .auth import AuthError, require_session
from .auth_routes import check_origin, error_response, respond
from .chain_identity import chain_input_identity, chain_report_text, identity_json, identity_matches


CONTRACT = 'industry-demand-v1'
_PRIORITY_FIELDS = ('focus', 'scope', 'comparison', 'reason', 'action', 'evidence_ids')
_SCOPES = {'local', 'local_enterprise', 'industry', 'project'}
_PROJECT_FIELDS = ('demandContract', 'demandTitle', 'selectedPriority', 'demandSpec',
                   'sourceProjectKey', 'sourceAnalysisTopic', 'sourcePriorityKey',
                   'sourceReportIdentity', 'sourceReportFingerprint', 'submittedAt',
                   'submittedBy', 'topic', 'workspaceId', 'isDemand')
_DEMAND_FIELDS = ('demandContract', 'projKey', 'topic', 'title', 'demandTitle',
                 'analysisTopic', 'sourceProjectKey', 'sourcePriorityKey',
                 'selectedPriority', 'demandSpec', 'need', 'note', 'domain', 'city', 'gov',
                 'submittedAt', 'submittedBy')


def _fail(code, message, status=409):
    raise AuthError(status, code, message)


def priority_key(priority):
    return json.dumps([priority['scope'], priority['focus']], ensure_ascii=False, separators=(',', ':'))


def _text(value, name, limit):
    if (not isinstance(value, str) or not value.strip() or len(value) > limit
            or any(ord(ch) < 32 and ch not in '\n\r\t' for ch in value)):
        _fail('invalid_demand', name + '格式不正确', 400)
    return value.strip()


def _selected_priority(research, supplied):
    analysis = research.get('analysis')
    if (not isinstance(analysis, dict) or analysis.get('contract') != 'topic-report-analysis-v2'
            or not isinstance(analysis.get('priorities'), list) or not isinstance(supplied, dict)):
        _fail('priority_not_found', '当前报告没有可提交的已复核建议，请刷新后重试')
    if set(supplied) != set(_PRIORITY_FIELDS):
        _fail('invalid_priority', '请提交当前报告中的建议标识，不能自行替换来源', 400)
    matches = [row for row in analysis['priorities'] if isinstance(row, dict)
               and row.get('state') == 'reviewed_inference'
               and isinstance(row.get('focus'), str)
               and row['focus'].strip() == supplied.get('focus') and row.get('scope') == supplied.get('scope')]
    if len(matches) != 1:
        _fail('priority_not_found', '选中的建议不属于当前报告，请刷新后重试')
    row = copy.deepcopy(matches[0])
    ids = row.get('evidence_ids')
    if not isinstance(ids, list) or not ids or any(not isinstance(sid, str) or not sid for sid in ids):
        _fail('priority_not_found', '选中的建议缺少有效来源，暂不能提交')
    # Match the display adapter: trim the label and deduplicate IDs in order.
    # Other analytical text is compared byte for byte, without rewriting it.
    row['focus'] = row['focus'].strip()
    row['evidence_ids'] = list(dict.fromkeys(ids))
    if (row.get('scope') not in _SCOPES or any(
            not isinstance(row.get(field), str) or not row[field].strip()
            for field in ('focus', 'comparison', 'reason', 'action'))
            or any(supplied.get(field) != row.get(field) for field in _PRIORITY_FIELDS)):
        _fail('stale_report', '选中的建议已更新，请刷新并重新确认需求')
    sources = {}
    for source in research.get('sources', []):
        if not isinstance(source, dict) or not isinstance(source.get('id'), str):
            continue
        sid = source['id']
        if sid in sources and any(sources[sid].get(field) != source.get(field) for field in ('url', 'quote')):
            _fail('priority_not_found', '建议的来源编号存在冲突，请重新核验')
        sources[sid] = source
    resolved = []
    for sid in dict.fromkeys(ids):
        source = sources.get(sid)
        if not source or not isinstance(source.get('quote'), str) or not source['quote'].strip():
            _fail('priority_not_found', '建议引用的原文已缺失，请重新核验')
        try:
            url = urlsplit(source.get('url', ''))
            valid = url.scheme == 'https' and bool(url.hostname) and not url.username and not url.password
        except ValueError:
            valid = False
        if not valid:
            _fail('priority_not_found', '建议引用的原文链接无效，请重新核验')
        resolved.append(copy.deepcopy(source))
    return dict(copy.deepcopy(row), sources=resolved)


def _report_snapshot(report, topic, text):
    """Freeze the exact report and its evidence, without copying other topics."""
    stamp = (report.get('tsByTopic') or {}).get(topic, report.get('ts', 0))
    result = {'topic': topic, 'phase': 2, 'text': text, 'ts': stamp,
              'aiReportByTopic': {topic: text}, 'phaseByTopic': {topic: 2},
              'tsByTopic': {topic: stamp}, 'score': None, 'scoreByTopic': {topic: None}}
    for field in ('researchByTopic', 'materialDirectoryByTopic', 'pendingByTopic',
                  'evidenceStatusByTopic', 'userGeneratedTopics'):
        table = report.get(field)
        if isinstance(table, dict) and topic in table:
            result[field] = {topic: copy.deepcopy(table[topic])}
    return result


def create_industry_demand(body, state, principal, *, now=None):
    """Mutate a locked state once; repeated selection returns the original record."""
    if not isinstance(body, dict):
        _fail('invalid_json', '请求格式不正确', 400)
    key, topic = body.get('projectKey'), body.get('topic')
    authorize_project(key, state, principal)
    project = state['PROJECTS'][key]
    if project.get('isDemand') or (project.get('workspaceId') or key) != key:
        _fail('parent_workspace_required', '请在城市产业分析工作区选择要提交的建议')
    if not isinstance(topic, str) or not topic:
        _fail('invalid_topic', '请选择当前报告方向', 400)
    scoped = scoped_sync_view(state, principal)
    identity = chain_input_identity(scoped, key, topic)
    if not identity_matches(body.get('sourceIdentity'), identity):
        _fail('stale_report', '报告或材料已更新，请刷新并重新确认需求')
    report = (scoped.get('REPORTSTATE') or {}).get(key) or {}
    text = chain_report_text(scoped, key, topic)
    phase = (report.get('phaseByTopic') or {}).get(topic)
    if phase is None and report.get('topic') == topic:
        phase = report.get('phase')
    research = (report.get('researchByTopic') or {}).get(topic)
    if (phase != 2 or not isinstance(text, str) or not text.strip()
            or not isinstance(research, dict) or research.get('topic') != topic
            or research.get('reportText') != text):
        _fail('report_required', '请先完成并保存当前方向的完整研判报告')
    if not identity_matches(body.get('reportMetadataIdentity'), research):
        _fail('stale_report', '报告的建议或来源已更新，请刷新并重新确认需求')
    selected = _selected_priority(research, body.get('priority'))
    selected_key = priority_key(selected)
    rows = state.get('DEMANDS')
    if rows is None:
        rows = state['DEMANDS'] = []
    if not isinstance(rows, list):
        _fail('storage_unavailable', '需求列表暂不可用，请稍后重试', 503)
    duplicates = [(pkey, item) for pkey, item in state['PROJECTS'].items()
                  if isinstance(item, dict) and item.get('demandContract') == CONTRACT
                  and item.get('workspaceId') == key and item.get('sourceProjectKey') == key
                  and item.get('sourceAnalysisTopic') == topic and item.get('sourcePriorityKey') == selected_key]
    if len(duplicates) > 1:
        _fail('demand_conflict', '该建议已有多条需求，请先核对现有记录')
    if duplicates:
        saved_key, saved = duplicates[0]
        demands = [row for row in rows if isinstance(row, dict) and row.get('projKey') == saved_key]
        if len(demands) != 1:
            _fail('demand_conflict', '已有需求记录不完整，请联系管理员核对')
        return {'ok': True, 'created': False, 'projectKey': saved_key,
                'project': copy.deepcopy(saved), 'demand': copy.deepcopy(demands[0]),
                'reportState': copy.deepcopy((state.get('REPORTSTATE') or {}).get(saved_key) or {})}
    supplied = body.get('demand')
    if not isinstance(supplied, dict):
        _fail('invalid_demand', '请填写该建议的具体需求', 400)
    title = _text(supplied.get('title'), '需求标题', 120)
    description = _text(supplied.get('description'), '具体诉求', 6000)
    conditions = supplied.get('conditions', '')
    if conditions != '':
        conditions = _text(conditions, '需求条件', 2000)
    spec = {'title': title, 'description': description, 'conditions': conditions,
            'source': 'user_confirmed', 'verificationStatus': 'user_stated'}
    stamp = int(time.time() * 1000) if now is None else now
    child_key = 'proj_' + uuid.uuid4().hex
    fingerprint = hashlib.sha256(identity_json({'input': identity, 'research': research}).encode()).hexdigest()
    frozen = _report_snapshot(report, topic, text)
    child = {'id': child_key, 'workspaceId': key, 'parentProjectKey': key,
             'city': project.get('city', ''), 'org': project.get('org', ''), 'who': project.get('who', ''),
             'topic': topic, 'demandTitle': title, 'stage': 4, 'isDemand': True,
             'submissionState': 'submitted', 'demandContract': CONTRACT,
             'selectedPriority': selected, 'demandSpec': spec,
             'sourceProjectKey': key, 'sourceAnalysisTopic': topic, 'sourcePriorityKey': selected_key,
             'sourceReportIdentity': identity_json(identity), 'sourceReportFingerprint': fingerprint,
             'submittedAt': stamp, 'submittedBy': principal.get('user', ''), 'kb': [], 'report': None,
             'clues': [], 'stageLog': [{'ts': stamp, 'from': 2, 'to': 4,
                 'note': '已按具体研判建议递交招商需求', 'who': principal.get('user', '')}]}
    demand = {'id': 'd_' + uuid.uuid4().hex, 'projKey': child_key, 'demandContract': CONTRACT,
              'city': child['city'], 'gov': child['org'] + '·' + child['who'],
              'topic': title, 'title': title, 'demandTitle': title, 'domain': selected['focus'],
              'analysisTopic': topic, 'sourceProjectKey': key, 'sourcePriorityKey': selected_key,
              'selectedPriority': copy.deepcopy(selected), 'demandSpec': copy.deepcopy(spec),
              'need': description, 'note': conditions, 'submit': '刚刚', 'submittedAt': stamp,
              'submittedBy': principal.get('user', ''), 'res': 'none', 'resLabel': '待核验',
              'clues': 0, 'ai': ''}
    state['PROJECTS'][child_key] = child
    state.setdefault('REPORTSTATE', {})[child_key] = frozen
    rows.append(demand)
    return {'ok': True, 'created': True, 'projectKey': child_key, 'project': copy.deepcopy(child),
            'demand': copy.deepcopy(demand), 'reportState': copy.deepcopy(frozen)}


def preserve_industry_demands(incoming, state):
    """Full-snapshot sync cannot rewrite a submitted suggestion's provenance."""
    old_projects = state.get('PROJECTS') or {}
    projects = incoming.get('PROJECTS') or {}
    if isinstance(projects, dict):
        for key, item in projects.items():
            if not isinstance(item, dict):
                continue
            old = old_projects.get(key) or {}
            if old.get('demandContract') != CONTRACT:
                if item.get('demandContract') == CONTRACT:
                    _fail('server_owned_demand', '请通过具体建议提交招商需求', 403)
                continue
            for field in _PROJECT_FIELDS:
                if field in old:
                    item[field] = copy.deepcopy(old[field])
            reports = incoming.get('REPORTSTATE')
            if isinstance(reports, dict) and key in reports:
                reports[key] = copy.deepcopy((state.get('REPORTSTATE') or {}).get(key) or {})
    # A report-only sync must also preserve immutable child report snapshots.
    reports = incoming.get('REPORTSTATE')
    if isinstance(reports, dict):
        for key in reports:
            if (old_projects.get(key) or {}).get('demandContract') == CONTRACT:
                reports[key] = copy.deepcopy((state.get('REPORTSTATE') or {}).get(key) or {})
    saved_rows = {row.get('id'): row for row in state.get('DEMANDS', []) if isinstance(row, dict)}
    for row in incoming.get('DEMANDS', []) if isinstance(incoming.get('DEMANDS'), list) else []:
        if not isinstance(row, dict):
            continue
        receipt_id = row.get('id')
        old = saved_rows.get(receipt_id, {}) if isinstance(receipt_id, str) else {}
        if old.get('demandContract') != CONTRACT:
            references = [row[field] for field in ('projKey', 'projectKey') if isinstance(row.get(field), str)]
            if not references and isinstance(receipt_id, str):
                references = [receipt_id, receipt_id[1:] if receipt_id.startswith('d') else receipt_id]
            targets = [old_projects.get(reference) or {} for reference in references]
            if row.get('demandContract') == CONTRACT or any(target.get('demandContract') == CONTRACT for target in targets):
                _fail('server_owned_demand', '请通过具体建议提交招商需求', 403)
            continue
        for field in _DEMAND_FIELDS:
            if field in old:
                row[field] = copy.deepcopy(old[field])


def handle_industry_demand(handler, raw, session_factory, admin_config=None):
    """Authenticate again under the shared database/file transaction lock."""
    try:
        check_origin(handler.headers)
        if len(raw) > 8 * 1024 * 1024:
            _fail('request_too_large', '请求内容过大', 413)
        try:
            body = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (ValueError, UnicodeError, RecursionError):
            _fail('invalid_json', '请求格式不正确', 400)
        with session_factory() as session:
            state = json.loads(session.read())
            if not isinstance(state, dict):
                _fail('storage_unavailable', '需求服务暂不可用', 503)
            principal = require_session(handler.headers, state, admin_config=admin_config)
            result = create_industry_demand(body, state, principal)
            if result['created'] and not session.write(json.dumps(state, ensure_ascii=False, allow_nan=False)):
                _fail('storage_unavailable', '需求尚未保存，请重试', 503)
        return respond(handler, 200, result)
    except AuthError as error:
        return error_response(handler, error)
    except Exception:
        return error_response(handler, AuthError(503, 'storage_unavailable', '需求尚未保存，请重试'))
