"""Account-owned, durable in-site reminders; no model calls or external delivery.

Only an authenticated GET enrolls an account/workspace. Enrollment takes a
watermark, so deploying this module never backfills old business events. The
small worker and HTTP handlers use the existing snapshot transaction lock.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

from .access_control import authorize_project, _project_roots
from .auth import (AuthError, _active, _credential_fingerprint, _memberships,
                   _principal, require_session)
from .auth_routes import check_origin, error_response, parse_body, respond

TABLE = 'REMINDER_ACCOUNTS'
DEFAULTS = {'statusChanges': True, 'overdue': True, 'dailyDigest': True}
SHANGHAI = timezone(timedelta(hours=8), 'Asia/Shanghai')
_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z')


def _fail(code, message, status=400):
    raise AuthError(status, code, message)


def _stamp(value):
    return (int(value) if type(value) in (int, float) and math.isfinite(value)
            and 0 < value < 10 ** 15 else None)


def _now(now=None):
    value = int(time.time() * 1000) if now is None else _stamp(now)
    if value is None:
        _fail('storage_unavailable', '提醒服务时间异常', 503)
    return value


def _identity(state, username):
    """Legacy names colliding in either account table fail closed."""
    if not isinstance(username, str) or not username.strip():
        _fail('auth_required', '请重新登录', 401)
    name = username.strip().casefold()
    matches = [(source, key, row) for source in ('USER_PROFILES', 'CITY_ACCOUNTS')
               for key, row in (state.get(source) or {}).items()
               if isinstance(key, str) and key.strip().casefold() == name]
    if len(matches) != 1 or not _active(matches[0][2]):
        _fail('account_ambiguous', '账号身份已变化，请联系管理员', 403)
    source, user, record = matches[0]
    credential = _credential_fingerprint(record)
    if not credential:
        _fail('auth_required', '请重新登录', 401)
    key = hashlib.sha256((source + '\0' + name).encode()).hexdigest()
    return key, source, user, record, credential


def _table(state, create=False):
    value = state.get(TABLE)
    if value is None and create:
        value = state[TABLE] = {}
    if value is None:
        return {}
    if not isinstance(value, dict):
        _fail('storage_unavailable', '提醒记录暂不可用', 503)
    return value


def _validate_account(account):
    if (not isinstance(account, dict) or not isinstance(account.get('epoch'), str)
            or type(account.get('version')) is not int or account['version'] < 0
            or not isinstance(account.get('preferences'), dict)
            or set(account['preferences']) != set(DEFAULTS)
            or any(type(v) is not bool for v in account['preferences'].values())
            or not isinstance(account.get('workspaces'), dict)):
        _fail('storage_unavailable', '提醒记录暂不可用', 503)


def _events(state, keys):
    """Use explicit timestamps and stable IDs, never list position."""
    events = {}
    logs = state.get('DOCK_LOGS') or {}
    projects = state.get('PROJECTS') or {}
    for key in sorted(keys):
        project = projects.get(key)
        if not isinstance(project, dict):
            continue
        dock_ids = set()
        rows = logs.get(key, []) if isinstance(logs, dict) else []
        if not isinstance(rows, list):
            _fail('storage_unavailable', '对接事件暂不可用', 503)
        for row in rows:
            if not isinstance(row, dict) or _stamp(row.get('ts')) is None:
                continue
            rid, kind = row.get('id'), row.get('kind')
            if (row.get('contract') != 'docking-action-v1'
                    or not isinstance(rid, str) or not rid or kind not in {
                    'advance_stage', 'review_demand', 'supplement_demand',
                    'verification_request', 'review_verification', 'contact_log'}):
                continue
            dock_ids.add(rid)
            identity = key + ':dock:' + rid
            event = dict(row, projectKey=key, sourceId=identity)
            if identity in events and events[identity] != event:
                _fail('event_conflict', '对接事件标识冲突', 503)
            events[identity] = event
        rows = project.get('stageLog') or []
        if not isinstance(rows, list):
            _fail('storage_unavailable', '阶段事件暂不可用', 503)
        for row in rows:
            if not isinstance(row, dict) or _stamp(row.get('ts')) is None:
                continue
            # A contract label on a generic, client-editable stageLog is not
            # authority. Submitted demand stage logs are protected by sync;
            # their later canonical changes also have a DOCK_LOGS receipt.
            if not (project.get('demandContract') == 'industry-demand-v1'
                    and project.get('submissionState') == 'submitted'):
                continue
            if row.get('id') in dock_ids:
                continue
            rid = row.get('id')
            if not isinstance(rid, str) or not rid:
                rid = hashlib.sha256(json.dumps(row, sort_keys=True,
                     ensure_ascii=False, allow_nan=False).encode()).hexdigest()
            identity = key + ':stage:' + rid
            event = dict(row, projectKey=key, sourceId=identity, kind='advance_stage')
            if identity in events and events[identity] != event:
                _fail('event_conflict', '阶段事件标识冲突', 503)
            events[identity] = event
    return events


def _workspace_keys(state, principal, root):
    roots = _project_roots(state, principal)
    return {key for key, owner in roots.items() if owner == root
            and key in (state.get('PROJECTS') or {})}


def _active_project(state, key):
    project = (state.get('PROJECTS') or {}).get(key)
    if not isinstance(project, dict) or key in (state.get('DELETED_PROJECTS') or []):
        return False
    return not (any(project.get(flag) is True for flag in ('deleted', 'cancelled', 'closed', 'completed'))
                or project.get('submissionState') in ('draft', 'pending', 'failed', 'cancelled', 'closed', 'completed'))


def _formal_demand_keys(state, keys, root):
    """Require protected submission or admin handling, never client flags alone.

    A unique canonical DEMANDS receipt supports older project shapes too.
    Legacy rows without that receipt need a protected admin reply/operation;
    an ordinary user's canonical note, verification request or supplement is
    not evidence of formal intake. Unproven/ambiguous legacy data is excluded.
    """
    rows = state.get('DEMANDS', [])
    if not isinstance(rows, list):
        return set()
    by_project, id_counts = {}, {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        identifier = row.get('id')
        if isinstance(identifier, str):
            id_counts[identifier] = id_counts.get(identifier, 0) + 1
        project_key = row.get('projKey')
        if isinstance(project_key, str) and project_key in keys:
            by_project.setdefault(project_key, []).append(row)
    result = set()
    for key in keys:
        project = state['PROJECTS'][key]
        stage = project.get('stage')
        if (key == root or not _active_project(state, key) or project.get('isDemand') is not True
                or type(stage) not in (int, float) or not math.isfinite(stage) or stage < 4
                or project.get('submissionState') not in (None, 'submitted')):
            continue
        receipts = by_project.get(key, [])
        if len(receipts) > 1:
            continue
        receipt = receipts[0] if receipts else None
        if receipt is not None:
            identifier = receipt.get('id')
            if (not isinstance(identifier, str) or not identifier
                    or id_counts[identifier] != 1
                    or any(field in receipt and receipt[field] != expected for field, expected in (
                        ('projectKey', key), ('workspaceId', root), ('sourceProjectKey', root)))):
                continue
            if receipt.get('demandContract') == 'industry-demand-v1':
                result.add(key)
                continue
        intake = project.get('intake')
        admin_reply = (isinstance(intake, dict) and intake.get('contract') == 'docking-action-v1'
            and type(intake.get('version')) is int and intake['version'] > 0
            and _stamp(intake.get('repliedAt')) is not None
            and isinstance(intake.get('repliedBy'), str) and bool(intake['repliedBy'].strip())
            and isinstance(intake.get('reply'), str) and bool(intake['reply'].strip())
            and intake.get('status') in ('submitted', 'processing', 'needs_info', 'feedback'))
        logs = (state.get('DOCK_LOGS') or {}).get(key, [])
        admin_event = any(isinstance(row, dict) and row.get('contract') == 'docking-action-v1'
            and row.get('projectKey') == key and row.get('actorRole') == 'admin'
            and row.get('kind') in ('review_demand', 'review_verification', 'advance_stage')
            and isinstance(row.get('id'), str) and bool(row['id'])
            and isinstance(row.get('actor'), str) and bool(row['actor'].strip())
            and isinstance(row.get('requestId'), str) and _ID.fullmatch(row['requestId'])
            and isinstance(row.get('requestFingerprint'), str)
            and re.fullmatch(r'[0-9a-f]{64}', row['requestFingerprint'])
            and _stamp(row.get('ts')) is not None for row in logs) if isinstance(logs, list) else False
        if admin_reply or admin_event:
            result.add(key)
    return result


def _due_at(stamp):
    """Same local clock time after three Mon-Fri days; no holiday inference."""
    day = datetime.fromtimestamp(stamp / 1000, SHANGHAI)
    remaining = 3
    while remaining:
        day += timedelta(days=1)
        if day.weekday() < 5:
            remaining -= 1
    return int(day.timestamp() * 1000)


def _notice(account, workspace, source_id, kind, title, message, stamp, key, **fields):
    identity = hashlib.sha256((account['epoch'] + '\0' + source_id).encode()).hexdigest()
    workspace['notifications'].setdefault(identity, dict(
        id=identity, sourceId=source_id, type=kind, title=title, message=message,
        createdAt=stamp, readAt=None, projectKey=key, workspaceId=workspace['root'], **fields))


def _digest_message(state, keys, date):
    """Freeze a small status-only snapshot; never read materials or contacts."""
    status_labels = {'submitted': '已提交', 'processing': '处理中',
                     'needs_info': '待补充', 'feedback': '已反馈'}
    lines = [date + ' 09:00后汇总：当前有 ' + str(len(keys)) + ' 个进行中的需求项目。']
    for key in sorted(keys)[:20]:
        project = state['PROJECTS'][key]
        title = project.get('demandTitle') or project.get('topic') or '未命名需求'
        title = ' '.join(str(title).split())[:100]
        stage = project.get('stage')
        stage_label = str(stage) if type(stage) is int and 0 <= stage <= 1000 else '未记录'
        intake = project.get('intake')
        status = intake.get('status') if isinstance(intake, dict) else project.get('submissionState')
        lines.append('• ' + title + '；阶段 ' + stage_label + '；受理状态：' + status_labels.get(status, '未记录'))
    if len(keys) > 20:
        lines.append('另有 ' + str(len(keys) - 20) + ' 项未在此摘要展开，请查看项目列表。')
    return '\n'.join(lines)


def _generate(state, principal, account, root, now):
    workspace = account['workspaces'][root]
    if (not isinstance(workspace, dict) or not isinstance(workspace.get('seen'), dict)
            or not isinstance(workspace.get('notifications'), dict)):
        _fail('storage_unavailable', '提醒记录暂不可用', 503)
    keys = _workspace_keys(state, principal, root)
    formal_keys = _formal_demand_keys(state, keys, root)
    events = _events(state, keys)
    preferences = account['preferences']
    for identity, event in sorted(events.items(), key=lambda item: (item[1]['ts'], item[0])):
        if identity in workspace['seen'] or event['ts'] > now:
            continue
        workspace['seen'][identity] = True
        if (event['ts'] <= workspace['joinedAt']
                or not preferences['statusChanges'] or event['projectKey'] not in formal_keys):
            continue
        kind = event['kind']
        title = ('核验结果已更新' if kind == 'review_verification' else
                 '核验申请已记录' if kind == 'verification_request' else
                 '需求受理状态已更新' if kind == 'review_demand' else
                 '补充材料已记录' if kind == 'supplement_demand' else
                 '对接记录已更新' if kind == 'contact_log' else '项目阶段已更新')
        project = state['PROJECTS'][event['projectKey']]
        project_title = project.get('demandTitle') or project.get('topic')
        if isinstance(project_title, str) and project_title.strip():
            title = ' '.join(project_title.split())[:100] + ' · ' + title
        message = str(event.get('note') or title)[:10000]
        if kind == 'review_verification' and event.get('status') == 'completed':
            outcome_label = {'further_contact': '建议进一步对接', 'not_suitable': '本次需求不适配',
                             'insufficient': '依据仍不足'}.get(event.get('outcome'), '未提供结论')
            message = message[:9500] + '\n核验结论：' + outcome_label
        _notice(account, workspace, identity, 'verification' if 'verification' in kind else 'status',
                title, message, event['ts'], event['projectKey'],
                status=str(event.get('status') or ''), outcome=str(event.get('outcome') or ''))
    if preferences['overdue']:
        receipt_times = {row['projKey']: _stamp(row.get('submittedAt'))
                         for row in state.get('DEMANDS', []) if isinstance(row, dict)
                         and isinstance(row.get('projKey'), str) and row['projKey'] in formal_keys
                         and row.get('demandContract') == 'industry-demand-v1'}
        for key in sorted(formal_keys):
            project = state['PROJECTS'][key]
            candidates = [event['ts'] for event in events.values() if event['projectKey'] == key and event['ts'] <= now]
            intake = project.get('intake')
            # Legacy project fields remain client-editable. Only canonical
            # project/submission receipts and protected replies are timestamps.
            stamps = [receipt_times.get(key)]
            if project.get('demandContract') == 'industry-demand-v1':
                stamps.append(_stamp(project.get('submittedAt')))
            if isinstance(intake, dict) and intake.get('contract') == 'docking-action-v1':
                stamps.append(_stamp(intake.get('repliedAt')))
            candidates.extend(stamp for stamp in stamps if stamp and stamp <= now)
            latest = max(candidates) if candidates else workspace['joinedAt']
            # Existing projects begin a fresh three-business-day tracking window.
            tracking_since = max(workspace['joinedAt'], latest)
            if now < _due_at(tracking_since):
                continue
            _notice(account, workspace, key + ':overdue:' + str(tracking_since), 'overdue',
                    (' '.join(str(project.get('demandTitle') or project.get('topic') or '项目').split())[:100]
                     + ' · 待跟进'), '自开始跟踪或最近一次已记录进展起已满3个周一至周五工作日，请查看项目。',
                    _due_at(tracking_since), key)
    local = datetime.fromtimestamp(now / 1000, SHANGHAI)
    date = local.date().isoformat()
    if preferences['dailyDigest'] and local.hour >= 9 and date >= workspace['firstDigestDate']:
        # Source ID ensures a fixed daily snapshot, even if later events arrive.
        active = sorted(formal_keys)
        if active:
            _notice(account, workspace, root + ':daily:' + date, 'daily', '每日项目摘要',
                    _digest_message(state, active, date),
                    now, root)


def _enroll(state, principal, now):
    if principal.get('scope') != 'project':
        _fail('member_required', '请使用城市工作区账号', 403)
    key, source, user, record, credential = _identity(state, principal.get('user'))
    table = _table(state, True)
    account = table.get(key)
    if account is not None:
        _validate_account(account)
    if account is None or account.get('credential') != credential:
        created_at = _stamp(record.get('ts'))
        previous_created_at = _stamp(account.get('accountCreatedAt')) if account is not None else None
        preferences = (copy.deepcopy(account['preferences']) if account is not None
                       and created_at is not None and created_at > 0
                       and previous_created_at is not None and previous_created_at > 0
                       and account.get('accountCreatedAt') == record.get('ts') else copy.deepcopy(DEFAULTS))
        unknown = copy.deepcopy(account or {})
        unknown.update(source=source, user=user, credential=credential,
                       accountCreatedAt=record.get('ts'), epoch=uuid.uuid4().hex,
                       version=0, preferences=preferences, workspaces={})
        account = table[key] = unknown
    return account


def _request(body, operation):
    required = {'projectKey', 'requestId'}
    if operation != 'get':
        required |= {'accountEpoch', 'version'}
    allowed = required | ({'preferences'} if operation == 'preferences' else {'ids', 'all'} if operation == 'read' else set())
    if not isinstance(body, dict) or set(body) - allowed or not required <= set(body):
        _fail('invalid_request', '提醒请求格式不正确')
    if not isinstance(body.get('requestId'), str) or not _ID.fullmatch(body['requestId']):
        _fail('invalid_request_id', '提醒请求标识不正确')
    if operation == 'preferences':
        values = body.get('preferences')
        if not isinstance(values, dict) or set(values) != set(DEFAULTS) or any(type(v) is not bool for v in values.values()):
            _fail('invalid_preferences', '请提交完整的提醒选项')
    if operation == 'read':
        if body.get('all') is True and 'ids' not in body:
            pass
        elif 'all' not in body and isinstance(body.get('ids'), list) and 0 < len(body['ids']) <= 1000 and all(isinstance(i, str) and _ID.fullmatch(i) for i in body['ids']):
            pass
        else:
            _fail('invalid_notifications', '请选择有效的提醒')


def apply_request(body, state, principal, *, operation='get', now=None):
    """Pure mutation of a private snapshot; caller commits only after success."""
    _request(body, operation)
    now = _now(now)
    key = authorize_project(body['projectKey'], state, principal)
    roots = _project_roots(state, principal)
    root = roots.get(key)
    if root not in _memberships(_identity(state, principal.get('user'))[3]):
        _fail('workspace_forbidden', '没有该工作区的访问权限', 403)
    account = _enroll(state, principal, now)
    if operation != 'get':
        if (body.get('accountEpoch') != account['epoch'] or type(body.get('version')) is not int
                or body['version'] != account['version']):
            _fail('version_conflict', '提醒设置已变化，请刷新后重试', 409)
        if root not in account['workspaces']:
            _fail('subscription_required', '请先加载当前工作区提醒', 409)
    if root not in account['workspaces']:
        account['workspaces'][root] = {'root': root, 'joinedAt': now,
            'firstDigestDate': (datetime.fromtimestamp(now / 1000, SHANGHAI).date() + timedelta(days=1)).isoformat(),
            'seen': {eid: True for eid, event in _events(state, _workspace_keys(state, principal, root)).items()
                     if event['ts'] <= now},
            'notifications': {}}
    _generate(state, principal, account, root, now)
    if operation == 'preferences':
        if account['preferences'] != body['preferences']:
            account['preferences'] = copy.deepcopy(body['preferences'])
            account['version'] += 1
    workspace = account['workspaces'][root]
    if operation == 'read':
        ids = list(workspace['notifications']) if body.get('all') else body['ids']
        if any(identity not in workspace['notifications'] for identity in ids):
            _fail('notification_not_found', '提醒已变化，请刷新后重试', 409)
        for identity in ids:
            workspace['notifications'][identity]['readAt'] = workspace['notifications'][identity]['readAt'] or now
    prefs = account['preferences']
    enabled = {'status': prefs['statusChanges'], 'verification': prefs['statusChanges'],
               'overdue': prefs['overdue'], 'daily': prefs['dailyDigest']}
    notifications = [copy.deepcopy(row) for row in workspace['notifications'].values()
                     if enabled.get(row['type']) and row['projectKey'] in _workspace_keys(state, principal, root)]
    notifications.sort(key=lambda row: (row['createdAt'], row['id']), reverse=True)
    return {'ok': True, 'requestId': body['requestId'], 'accountId': principal['user'],
            'accountEpoch': account['epoch'], 'projectKey': key, 'workspaceId': root,
            'version': account['version'], 'preferences': copy.deepcopy(prefs),
            'notifications': notifications}


def handle_request(handler, raw, session_factory, admin_config=None, *, operation='get', now=None):
    try:
        if operation == 'get':
            query = parse_qs(urlsplit(handler.path).query, keep_blank_values=True)
            if any(len(values) != 1 for values in query.values()):
                _fail('invalid_request', '提醒请求格式不正确')
            body = {key: values[0] for key, values in query.items()}
        else:
            check_origin(handler.headers)
            body = parse_body(raw)
        with session_factory() as session:
            state = json.loads(session.read())
            if not isinstance(state, dict):
                _fail('storage_unavailable', '提醒记录暂不可用', 503)
            principal = require_session(handler.headers, state, admin_config=admin_config,
                                        now=None if now is None else now / 1000)
            before = copy.deepcopy(state)
            result = apply_request(body, state, principal, operation=operation, now=now)
            if state != before and not session.write(json.dumps(state, ensure_ascii=False, allow_nan=False)):
                _fail('storage_unavailable', '尚未保存，请稍后重试', 503)
        respond(handler, 200, result)
    except AuthError as error:
        error_response(handler, error)
    except Exception:
        error_response(handler, AuthError(503, 'storage_unavailable', '提醒服务暂不可用，请稍后重试'))


def run_once(session_factory, *, now=None):
    """One locked tick. No registration or writes for un-enrolled accounts."""
    now = _now(now)
    with session_factory() as session:
        state = json.loads(session.read())
        before = copy.deepcopy(state)
        for account in _table(state).values():
            _validate_account(account)
            try:
                _, source, user, record, credential = _identity(state, account.get('user'))
                if source != account.get('source') or credential != account.get('credential'):
                    continue
                memberships = _memberships(record)
                if not memberships:
                    continue
                principal = _principal(user, record, next(iter(memberships)))
                for root in list(account['workspaces']):
                    if root in memberships:
                        _generate(state, principal, account, root, now)
            except AuthError as error:
                if error.status < 500:
                    continue
                raise
        if state != before and not session.write(json.dumps(state, ensure_ascii=False, allow_nan=False)):
            _fail('storage_unavailable', '提醒尚未保存', 503)


def start_reminder_loop(session_factory, *, interval=60, stop_event=None, on_error=None):
    """Stop-aware daemon; failures remain failures and are retried next tick."""
    stop = stop_event if stop_event is not None else threading.Event()
    def run():
        while not stop.is_set():
            try:
                run_once(session_factory)
            except Exception:
                if on_error:
                    on_error('reminder_tick_failed')
            stop.wait(interval)
    thread = threading.Thread(target=run, name='in-site-reminders', daemon=True)
    thread.start()
    return stop, thread
