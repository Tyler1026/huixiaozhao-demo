"""Persist explicit docking requests and contact notes without inventing progress.

These receipts are server-owned. A request records that an operator asked for
verification; it does not certify the enterprise, contactability or intent.
"""
from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import io
import json
import re
import time
import uuid
import zipfile

from .access_control import authorize_project, scoped_sync_view
from .auth import AuthError, require_session
from .auth_routes import check_origin, error_response, respond
from .sync_merge import _clue_tombstoned

CONTRACT = 'docking-action-v1'
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 10 * 1024 * 1024
MAX_REQUEST_BYTES = 15 * 1024 * 1024
_TYPES = {'call', 'visit', 'email', 'material', 'note'}
_REQUEST_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z')
_FILE_TYPES = {
    '.pdf': ('application/pdf', b'%PDF-'),
    '.png': ('image/png', b'\x89PNG\r\n\x1a\n'),
    '.jpg': ('image/jpeg', b'\xff\xd8\xff'),
    '.jpeg': ('image/jpeg', b'\xff\xd8\xff'),
    '.webp': ('image/webp', b'RIFF'),
    '.txt': ('text/plain', None),
    '.csv': ('text/csv', None),
    '.doc': ('application/msword', b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'),
    '.docx': ('application/vnd.openxmlformats-officedocument.wordprocessingml.document', b'PK\x03\x04'),
    '.xlsx': ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', b'PK\x03\x04'),
    '.pptx': ('application/vnd.openxmlformats-officedocument.presentationml.presentation', b'PK\x03\x04'),
}
_OFFICE_ROOTS = {'.docx': 'word/document.xml', '.xlsx': 'xl/workbook.xml', '.pptx': 'ppt/presentation.xml'}
_UNSAFE_MARKUP = re.compile(r'<\s*(?:!doctype|html|svg|script|iframe|object|embed)\b', re.I)


def _fail(code, message, status=400):
    raise AuthError(status, code, message)


def _text(value, name, limit, *, optional=False):
    if (not isinstance(value, str) or len(value) > limit
            or any(ord(c) < 32 and c not in '\t\r\n' or ord(c) == 127 for c in value)):
        _fail('invalid_record', name + '格式不正确')
    value = value.strip()
    if not value and not optional:
        _fail('invalid_record', name + '不能为空')
    return value


def _safe_office(data, extension):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            names = {entry.filename for entry in entries}
            if (len(entries) > 3000 or '[Content_Types].xml' not in names
                    or _OFFICE_ROOTS[extension] not in names
                    or sum(entry.file_size for entry in entries) > 50 * 1024 * 1024):
                return False
            for entry in entries:
                name = entry.filename.casefold()
                if (entry.flag_bits & 1 or name.startswith('/') or '\\' in name
                        or '..' in name.split('/') or 'vbaproject' in name
                        or name.endswith(('.html', '.htm', '.js', '.svg', '.exe'))):
                    return False
            content_types = archive.read('[Content_Types].xml')
            return (len(content_types) <= 256 * 1024
                    and b'macroenabled' not in content_types.lower())
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, RuntimeError):
        return False


def _attachments(values):
    if not isinstance(values, list) or len(values) > 5:
        _fail('invalid_attachments', '附件最多 5 个')
    result, total = [], 0
    for item in values:
        if not isinstance(item, dict) or set(item) != {'name', 'size', 'dataUrl'}:
            _fail('invalid_attachments', '附件格式不正确')
        name, size, data_url = item.get('name'), item.get('size'), item.get('dataUrl')
        if (not isinstance(name, str) or not name.strip() or name != name.strip() or len(name) > 180
                or name in {'.', '..'} or any(c in name for c in '/\\')
                or any(ord(c) < 32 or ord(c) == 127 for c in name)):
            _fail('invalid_attachments', '附件文件名不正确')
        extension = '.' + name.rsplit('.', 1)[-1].casefold() if '.' in name else ''
        allowed = _FILE_TYPES.get(extension)
        if not allowed:
            _fail('invalid_attachments', '不支持该附件类型')
        if (isinstance(size, bool) or not isinstance(size, int) or size <= 0 or size > MAX_FILE_BYTES
                or not isinstance(data_url, str) or len(data_url) > MAX_FILE_BYTES * 4 // 3 + 256):
            _fail('invalid_attachments', '单个附件不能超过 5 MB')
        match = re.fullmatch(r'data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/]*={0,2})', data_url)
        if not match or match.group(1).lower() != allowed[0]:
            _fail('invalid_attachments', '附件 MIME 类型与文件名不一致')
        try:
            data = base64.b64decode(match.group(2), validate=True)
        except (ValueError, binascii.Error):
            _fail('invalid_attachments', '附件编码不正确')
        if len(data) != size or base64.b64encode(data).decode() != match.group(2):
            _fail('invalid_attachments', '附件大小或编码不正确')
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            _fail('invalid_attachments', '附件总计不能超过 10 MB')
        magic = allowed[1]
        if magic and not data.startswith(magic):
            _fail('invalid_attachments', '附件内容与文件类型不一致')
        if extension == '.webp' and (len(data) < 12 or data[8:12] != b'WEBP'):
            _fail('invalid_attachments', 'WebP 附件内容不正确')
        if extension == '.doc' and len(data) < 512:
            _fail('invalid_attachments', 'Word 附件内容不正确')
        if extension in _OFFICE_ROOTS and not _safe_office(data, extension):
            _fail('invalid_attachments', 'Office 附件内容不正确或含不支持的脚本')
        if not magic:
            try:
                content = data.decode('utf-8-sig')
            except UnicodeDecodeError:
                _fail('invalid_attachments', '文本附件须采用 UTF-8 编码')
            if '\x00' in content or _UNSAFE_MARKUP.search(content):
                _fail('invalid_attachments', '文本附件不能包含 HTML、SVG 或脚本')
        result.append({'name': name, 'size': size,
                       'dataUrl': 'data:' + allowed[0] + ';base64,' + match.group(2)})
    return result


def _clue(project, key, clue_id, state):
    if not isinstance(clue_id, str) or not clue_id or len(clue_id) > 256:
        _fail('invalid_clue', '请选择有效的企业线索')
    tombs = set(x for x in state.get('DELETED_CLUES', []) if isinstance(x, str))
    clues = [item for item in project.get('clues', []) if isinstance(item, dict)
             and item.get('id') == clue_id and not _clue_tombstoned(key, item, tombs)]
    if len(clues) != 1:
        _fail('clue_not_found', '企业线索已删除或发生变化，请刷新后重试', 409)
    return clues[0]


def _response(state, principal, key, created):
    visible = scoped_sync_view(state, principal)
    result = {'ok': True, 'created': created, 'projectKey': key,
              'project': copy.deepcopy(visible['PROJECTS'][key]),
              'logs': copy.deepcopy((visible.get('DOCK_LOGS') or {}).get(key, []))}
    demands = [row for row in visible.get('DEMANDS', []) if isinstance(row, dict) and row.get('projKey') == key]
    if len(demands) == 1:
        result['demand'] = copy.deepcopy(demands[0])
    return result


def _version(value):
    """Legacy records have version zero; malformed versions are not writable."""
    version = value.get('version', 0) if isinstance(value, dict) else 0
    if isinstance(version, bool) or not isinstance(version, int) or version < 0:
        _fail('storage_unavailable', '处理记录版本异常，请刷新后重试', 503)
    return version


def _expected_version(body, current, *, optional=False):
    supplied = body.get('expectedVersion')
    if optional and 'expectedVersion' not in body:
        return
    if isinstance(supplied, bool) or not isinstance(supplied, int) or supplied < 0:
        _fail('invalid_version', '缺少有效的处理记录版本，请刷新后重试')
    if supplied != current:
        _fail('version_conflict', '该需求已被更新，请刷新后查看最新处理结果', 409)


def _admin(principal):
    if principal.get('scope') != 'admin':
        _fail('admin_required', '该操作仅限管理端处理', 403)


def _record(body, allowed):
    record = body.get('record')
    if not isinstance(record, dict) or set(record) - allowed:
        _fail('invalid_record', '处理记录格式不正确')
    return record


def apply_docking_action(body, state, principal, *, now=None):
    """Apply one acknowledged operation under the caller's transaction lock."""
    if not isinstance(body, dict):
        _fail('invalid_json', '请求格式不正确')
    key = body.get('projectKey')
    authorize_project(key, state, principal)
    project = state['PROJECTS'][key]
    canonical = (scoped_sync_view(state, principal).get('PROJECTS') or {}).get(key) or {}
    receipts = [row for row in state.get('DEMANDS', []) if isinstance(row, dict) and row.get('projKey') == key]
    submitted = project.get('submissionState') == 'submitted' or (bool(receipts) and isinstance(project.get('stage'), (int, float)) and project['stage'] >= 4)
    if (project.get('isDemand') is not True or key == (canonical.get('workspaceId') or project.get('workspaceId')
                    or project.get('parentProjectKey') or project.get('parentKey')
                    or project.get('parentProjKey') or project.get('parent') or key)
            or not submitted or key in (state.get('DELETED_PROJECTS') or [])
            or project.get('submissionState') in ('draft', 'cancelled')):
        _fail('submitted_demand_required', '请选择已正式提交的招商需求', 409)
    action, request_id = body.get('action'), body.get('requestId')
    actions = {'request_verification', 'save_log', 'review_demand', 'supplement_demand',
               'review_verification', 'advance_stage'}
    if not isinstance(action, str) or action not in actions:
        _fail('invalid_action', '不支持该对接操作')
    if action in {'review_demand', 'review_verification', 'advance_stage'}:
        _admin(principal)
    if not isinstance(request_id, str) or not _REQUEST_ID.fullmatch(request_id):
        _fail('invalid_request_id', '操作标识不正确，请重新提交')
    allowed_fields = {'projectKey', 'action', 'requestId'}
    if action in {'save_log', 'request_verification', 'review_verification'}:
        allowed_fields.add('clueId')
    if action != 'request_verification':
        allowed_fields.add('record')
    if action in {'review_demand', 'supplement_demand', 'review_verification', 'advance_stage'}:
        allowed_fields.add('expectedVersion')
    if set(body) - allowed_fields:
        _fail('invalid_action', '对接操作包含不支持的字段')
    # Check authorization before replaying a receipt; check replay before version
    # so an acknowledged operation can be recovered after a lost response.
    fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False,
                                           allow_nan=False, separators=(',', ':')).encode()).hexdigest()
    table = state.get('DOCK_LOGS', {})
    if not isinstance(table, dict) or not isinstance(table.get(key, []), list):
        _fail('storage_unavailable', '对接记录暂不可用，请稍后重试', 503)
    logs = table.get(key, [])
    repeated = [row for row in logs if isinstance(row, dict) and row.get('contract') == CONTRACT
                and row.get('requestId') == request_id]
    if repeated:
        if len(repeated) != 1 or repeated[0].get('requestFingerprint') != fingerprint:
            _fail('request_conflict', '该操作标识已用于其他内容，请刷新后重试', 409)
        return _response(state, principal, key, False)
    clue_id, clue = body.get('clueId'), None
    if clue_id is not None or action in {'request_verification', 'review_verification'}:
        clue = _clue(project, key, clue_id, state)
    stamp = int(time.time() * 1000) if now is None else now
    actor = principal.get('user', '')
    event = {'id': 'dock_' + uuid.uuid4().hex, 'contract': CONTRACT,
             'requestId': request_id, 'requestFingerprint': fingerprint, 'projectKey': key,
             'kind': {'request_verification': 'verification_request', 'save_log': 'contact_log'}.get(action, action),
             'actor': actor, 'actorRole': principal.get('scope', ''), 'ts': stamp, 'files': []}
    if clue is not None:
        event['clueId'], event['clueName'] = clue_id, clue.get('name', '')
    updates = {}
    verification = None
    if action == 'save_log':
        record = _record(body, {'type', 'note', 'files'})
        record_type = record.get('type')
        if not isinstance(record_type, str) or record_type not in _TYPES:
            _fail('invalid_record', '请选择有效的记录类型')
        note = _text(record.get('note', ''), '记录内容', 10000, optional=True)
        files = _attachments(record.get('files', []))
        if not note and not files:
            _fail('invalid_record', '请填写对接记录或添加附件')
        event.update(type=record_type, note=note, files=files)
    elif action == 'request_verification':
        old_request = clue.get('verificationRequest')
        if isinstance(old_request, dict) and old_request.get('status') in {'requested', 'processing', 'needs_info'}:
            _fail('verification_already_requested', '这条线索已申请核验，请等待处理或补充对接记录', 409)
        version = _version(old_request) + 1 if isinstance(old_request, dict) and old_request.get('contract') == CONTRACT else 0
        verification = {'id': event['id'], 'contract': CONTRACT, 'requestId': request_id,
                        'requestedAt': stamp, 'requestedBy': actor, 'status': 'requested', 'version': version}
        event.update(type='verification_request', note='已保存核验申请，等待资源团队处理', status='requested', version=version)
    elif action in {'review_demand', 'supplement_demand'}:
        current_intake = project.get('intake')
        if current_intake is not None and (not isinstance(current_intake, dict) or current_intake.get('contract') != CONTRACT):
            _fail('storage_unavailable', '需求受理记录异常，请联系管理员', 503)
        current_version = _version(current_intake)
        _expected_version(body, current_version)
        intake = copy.deepcopy(current_intake or {'contract': CONTRACT, 'status': 'submitted', 'version': 0})
        if action == 'review_demand':
            record = _record(body, {'status', 'owner', 'nextStep', 'note'})
            status = record.get('status')
            if not isinstance(status, str) or status not in {'processing', 'needs_info', 'feedback'}:
                _fail('invalid_record', '请选择有效的需求处理状态')
            owner = _text(record.get('owner', ''), '负责人', 160)
            next_step = _text(record.get('nextStep', ''), '下一步安排', 2000, optional=status != 'processing')
            note = _text(record.get('note', ''), '处理回复', 10000)
            intake.update(status=status, owner=owner, nextStep=next_step, reply=note,
                          repliedAt=stamp, repliedBy=actor)
            event.update(status=status, owner=owner, nextStep=next_step, note=note)
        else:
            record = _record(body, {'note', 'files'})
            note = _text(record.get('note', ''), '补充说明', 10000, optional=True)
            files = _attachments(record.get('files', []))
            if not note and not files:
                _fail('invalid_record', '请填写补充说明或添加附件')
            if intake.get('status') == 'needs_info':
                intake.update(status='submitted', nextStep='待管理端复核补充资料')
            intake.update(lastSupplementAt=stamp, lastSupplementBy=actor)
            event.update(note=note, files=files, status=intake.get('status', 'submitted'))
        intake.update(version=current_version + 1, updatedAt=stamp, updatedBy=actor)
        event['version'] = intake['version']
        updates['intake'] = intake
    elif action == 'review_verification':
        old_request = clue.get('verificationRequest')
        if not isinstance(old_request, dict) or old_request.get('contract') != CONTRACT:
            _fail('verification_request_required', '请先提交该企业的核验申请', 409)
        version = _version(old_request)
        _expected_version(body, version)
        record = _record(body, {'status', 'note', 'outcome', 'evidence'})
        status = record.get('status')
        if not isinstance(status, str) or status not in {'processing', 'needs_info', 'completed'}:
            _fail('invalid_record', '请选择有效的核验处理状态')
        note = _text(record.get('note', ''), '核验回复', 10000)
        evidence = _text(record.get('evidence', ''), '核验依据', 10000, optional=status != 'completed')
        outcome = record.get('outcome')
        if status == 'completed':
            if not isinstance(outcome, str) or outcome not in {'further_contact', 'not_suitable', 'insufficient'}:
                _fail('invalid_record', '请选择核验结论')
        elif outcome not in (None, ''):
            _fail('invalid_record', '核验完成后才能提交结论')
        verification = copy.deepcopy(old_request)
        verification.update(status=status, version=version + 1, reply=note, evidence=evidence,
                            updatedAt=stamp, updatedBy=actor)
        verification.pop('outcome', None)
        if status == 'completed':
            verification['outcome'] = outcome
        event.update(status=status, note=note, evidence=evidence, version=version + 1)
        if status == 'completed':
            event['outcome'] = outcome
    else:  # advance_stage
        record = _record(body, {'target', 'note'})
        target = record.get('target')
        custom = project.get('customStages', [])
        max_stage = 5 + (len(custom) if isinstance(custom, list) else 0)
        current = project.get('stage', 4)
        current = max(current, 4) if isinstance(current, int) and not isinstance(current, bool) else 4
        version = _version({'version': project.get('stageVersion', 0)})
        _expected_version(body, version, optional=True)
        if isinstance(target, bool) or not isinstance(target, int) or not current < target <= max_stage:
            _fail('invalid_stage', '请选择当前阶段之后的有效阶段')
        note = _text(record.get('note', ''), '阶段推进说明', 10000)
        stage_log = project.get('stageLog', [])
        if not isinstance(stage_log, list):
            _fail('storage_unavailable', '阶段记录异常，请刷新后重试', 503)
        updates.update(stage=target, stageVersion=version + 1,
                       stageLog=[{'id': event['id'], 'contract': CONTRACT, 'ts': stamp,
                                  'from': current, 'to': target, 'note': note, 'who': actor}] + copy.deepcopy(stage_log))
        event.update(note=note, **{'from': current, 'to': target, 'version': version + 1})
    # Validation is complete before any state mutation. No action implicitly
    # certifies investment intent, changes match colour, or contacts a company.
    state.setdefault('DOCK_LOGS', {}).setdefault(key, []).insert(0, event)
    project.update(updates)
    if verification is not None:
        clue['verificationRequest'] = verification
    return _response(state, principal, key, True)


def _green_claim(item):
    if not isinstance(item, dict):
        return False
    if item.get('tone') == 'teal':
        return True
    return item.get('hasMoveSignal') is True or any(item.get(field) is True or item.get(field) in ('verified', 'confirmed', 'approved')
               for field in ('contactVerified', 'intentVerified', 'verificationStatus', 'investment_intent')) or any(
        word in str(item.get('status') or '') for word in ('核验通过', '已核验', '可安排', '可沟通'))


def _submitted_demand(project, key, state):
    if (not isinstance(project, dict) or project.get('isDemand') is not True
            or project.get('submissionState') in ('draft', 'pending', 'failed', 'cancelled')):
        return False
    if project.get('submissionState') == 'submitted':
        return True
    stage = project.get('stage')
    return (not isinstance(stage, bool) and isinstance(stage, (int, float)) and stage >= 4
            and any(isinstance(row, dict) and row.get('projKey') == key
                    for row in state.get('DEMANDS', []) or []))


def preserve_docking_actions(incoming, state, principal=None):
    """Do not let generic snapshots manufacture or erase operation receipts."""
    old_projects = state.get('PROJECTS') or {}
    projects = incoming.get('PROJECTS') or {}
    if isinstance(projects, dict):
        for key, project in projects.items():
            if not isinstance(project, dict):
                continue
            old = old_projects.get(key) or {}
            if _submitted_demand(old, key, state):
                # Submitted demands have a fixed source/topic. Topic lifecycle
                # edits must not clear it or re-derive their acknowledged stage.
                for field in ('stage', 'stageByTopic', 'stageLog', 'stageVersion', 'topic',
                              'isDemand', 'submissionState', 'workspaceId', 'id',
                              'parentProjectKey', 'parentKey', 'parentProjKey', 'parent',
                              'topicDeletedAt', 'topicCreatedAt', 'deletedTopics',
                              'customTopics', 'aiTopics', 'topics'):
                    if field in old:
                        project[field] = copy.deepcopy(old[field])
                    else:
                        project.pop(field, None)
            saved_intake = old.get('intake')
            if isinstance(saved_intake, dict) and saved_intake.get('contract') == CONTRACT:
                project['intake'] = copy.deepcopy(saved_intake)
            elif project.get('intake') is not None and project.get('intake') != saved_intake:
                _fail('server_owned_docking', '需求受理记录必须通过专用接口保存', 403)
            old_clues = {str(c.get('id')): c for c in old.get('clues', []) if isinstance(c, dict)}
            clues = project.get('clues')
            if not isinstance(clues, list):
                continue
            for clue in clues:
                if not isinstance(clue, dict):
                    continue
                saved = old_clues.get(str(clue.get('id')), {})
                positive_fields = ('tone', 'status', 'contactVerified', 'intentVerified', 'verificationStatus', 'investment_intent', 'hasMoveSignal')
                if _green_claim(clue) and any(clue.get(field) != saved.get(field) for field in positive_fields):
                    _fail('verification_required', '核验结论不能通过普通同步生成', 403)
                request = clue.get('verificationRequest')
                saved_request = saved.get('verificationRequest')
                if isinstance(saved_request, dict) and saved_request.get('contract') == CONTRACT:
                    clue['verificationRequest'] = copy.deepcopy(saved_request)
                elif request is not None and request != saved_request:
                    _fail('server_owned_docking', '核验申请必须通过专用接口保存', 403)
                if clue.get('contract') == CONTRACT and saved.get('contract') != CONTRACT:
                    _fail('server_owned_docking', '不能伪造对接操作凭据', 403)
    table = incoming.get('DOCK_LOGS')
    old_table = state.get('DOCK_LOGS') or {}
    if 'DOCK_LOGS' in incoming and not isinstance(table, dict) and any(
            isinstance(rows, list) and any(isinstance(row, dict) and row.get('contract') == CONTRACT for row in rows)
            for rows in old_table.values()):
        _fail('server_owned_docking', '不能覆盖对接操作凭据', 403)
    if isinstance(table, dict):
        # Admin full snapshots also replace this table; omitted project keys must
        # not erase their immutable receipts. Member scoping runs after this step.
        for key, old_rows in old_table.items():
            if principal and principal.get('scope') == 'admin' and key not in table and isinstance(old_rows, list):
                protected_rows = [row for row in old_rows if isinstance(row, dict) and row.get('contract') == CONTRACT]
                if protected_rows:
                    table[key] = copy.deepcopy(protected_rows)
        for key, rows in table.items():
            old_rows = (state.get('DOCK_LOGS') or {}).get(key, [])
            protected = {row.get('id'): row for row in old_rows if isinstance(row, dict)
                         and row.get('contract') == CONTRACT} if isinstance(old_rows, list) else {}
            if not isinstance(rows, list):
                if protected or isinstance(rows, dict) and rows.get('contract') == CONTRACT:
                    _fail('server_owned_docking', '不能覆盖对接操作凭据', 403)
                continue  # Retain old non-list shapes without treating them as verified events.
            kept = []
            for row in rows:
                if not isinstance(row, dict):
                    kept.append(row)
                    continue
                if row.get('id') in protected:
                    continue  # Server copy is appended below, including removed contract fields.
                if row.get('contract') == CONTRACT:
                    _fail('server_owned_docking', '不能伪造对接操作凭据', 403)
                kept.append(row)
            table[key] = sorted(kept + copy.deepcopy(list(protected.values())),
                                key=lambda row: row.get('ts', 0) if isinstance(row, dict)
                                and isinstance(row.get('ts', 0), (int, float)) else 0, reverse=True)

    if principal:
        old_demands = {row.get('id'): row for row in state.get('DEMANDS', []) if isinstance(row, dict)}
        for row in incoming.get('DEMANDS', []) if isinstance(incoming.get('DEMANDS'), list) else []:
            if not isinstance(row, dict):
                continue
            old = old_demands.get(row.get('id')) or {}
            project = old_projects.get(old.get('projKey')) or {}
            if project.get('isDemand') is not True:
                continue
            protected_fields = ('res', 'resLabel', 'stage', 'clues') if principal.get('scope') == 'project' else ('stage',)
            for field in protected_fields:
                if field in old:
                    row[field] = copy.deepcopy(old[field])
                else:
                    row.pop(field, None)


def handle_docking_action(handler, raw, session_factory, admin_config=None):
    try:
        check_origin(handler.headers)
        if len(raw) > MAX_REQUEST_BYTES:
            _fail('request_too_large', '对接请求内容过大', 413)
        try:
            body = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (ValueError, UnicodeError, RecursionError):
            _fail('invalid_json', '请求格式不正确')
        with session_factory() as session:
            state = json.loads(session.read())
            if not isinstance(state, dict):
                _fail('storage_unavailable', '对接服务暂不可用', 503)
            principal = require_session(handler.headers, state, admin_config=admin_config)
            result = apply_docking_action(body, state, principal)
            if result['created'] and not session.write(json.dumps(state, ensure_ascii=False, allow_nan=False)):
                _fail('storage_unavailable', '操作尚未保存，请重试', 503)
        return respond(handler, 200, result)
    except AuthError as error:
        return error_response(handler, error)
    except Exception:
        return error_response(handler, AuthError(503, 'storage_unavailable', '操作尚未保存，请重试'))
