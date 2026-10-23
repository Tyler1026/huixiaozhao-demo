"""Transactional, source-bound user revisions without changing report originals."""
import copy
import json
import math
import re
import time
import uuid

from .access_control import allowed_project_keys
from .auth import AuthError, require_session
from .auth_routes import check_origin, error_response, respond


MAX_REQUEST_BYTES = 1024 * 1024
MAX_TEXT_CHARS = 200_000
_FIELDS = frozenset({'projectKey', 'sectionIndex', 'sectionTitle', 'baseReportVersion',
                     'sourceIndex', 'sourceItem', 'editId', 'expectedRevision', 'resetGen'})


def _fail(status, code, message):
    raise AuthError(status, code, message)


def _same(left, right, depth=0):
    """Match JSON values as browsers do, without conflating booleans and numbers."""
    if depth > 80:
        return False
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if type(left) in (int, float) or type(right) in (int, float):
        return (type(left) in (int, float) and type(right) in (int, float)
                and not (type(left) is float and not math.isfinite(left))
                and not (type(right) is float and not math.isfinite(right)) and left == right)
    if left is None or right is None:
        return left is right
    if isinstance(left, str) or isinstance(right, str):
        return type(left) is type(right) and left == right
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(_same(a, b, depth + 1) for a, b in zip(left, right))
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(_same(left[key], right[key], depth + 1) for key in left)
    return False


def _unique_title(project, title):
    return sum(isinstance(section, dict) and section.get('t') == title
               for section in project.get('kb') or []) == 1


def _index(value):
    return type(value) is int and value >= 0


def _section(state, key, index, title):
    project = (state.get('PROJECTS') or {}).get(key)
    sections = project.get('kb') if isinstance(project, dict) else None
    if not isinstance(sections, list) or index >= len(sections):
        _fail(409, 'section_changed', '资料分区已更新，请刷新后重试')
    section = sections[index]
    if (not isinstance(section, dict) or section.get('t') != title
            or not isinstance(section.get('known'), list)):
        _fail(409, 'section_changed', '资料分区已更新，请刷新后重试')
    return project, section


def _records(state, key):
    edits = state.get('KB_EDITS', {})
    if not isinstance(edits, dict) or not isinstance(edits.get(key, {}), dict):
        _fail(503, 'storage_unavailable', '资料修订暂不可用，请稍后重试')
    return edits.get(key, {})


def _valid_record(record, identity=None):
    if not isinstance(record, dict) or not {'sourceIndex', 'sourceItem', 'baseReportVersion'} <= set(record):
        return False
    if (not isinstance(record.get('id'), str) or not record['id']
            or identity is not None and record['id'] != identity
            or not _index(record.get('sectionIndex'))
            or not isinstance(record.get('sectionTitle'), str) or not record['sectionTitle'].strip()
            or not isinstance(record.get('text'), str) or not record['text'].strip()
            or len(record['text']) > MAX_TEXT_CHARS
            or not _index(record.get('revision')) or record['revision'] == 0
            or type(record.get('ts')) not in (int, float) or not math.isfinite(record['ts'])
            or record['ts'] < 0 or not isinstance(record.get('account'), str)
            or record.get('status') != 'edited'
            or type(record.get('deleted', False)) is not bool):
        return False
    if record.get('sourceIndex') is None:
        return record.get('sourceItem') is None and record.get('baseReportVersion') is None
    return _index(record['sourceIndex']) and isinstance(record.get('sourceItem'), (str, dict))


def _source_current(record, project, section, index):
    if not _valid_record(record) or record['sectionTitle'] != section.get('t'):
        return False
    source_index = record['sourceIndex']
    if source_index is None:
        # User notes survive monthly publication and section reordering by title.
        return _unique_title(project, record['sectionTitle'])
    known = section.get('known') or []
    return (record['sectionIndex'] == index and source_index < len(known)
            and _same(record['sourceItem'], known[source_index])
            and _same(record.get('baseReportVersion'), project.get('baseReportVersion')))


def _projected_edit(record, original=None, *, needs_review=False, reason=''):
    """A correction stays user testimony, including after its source changes."""
    item = copy.deepcopy(original) if isinstance(original, dict) else {}
    source = record.get('sourceItem')
    source_text = source if isinstance(source, str) else (source or {}).get('text', '')
    correction = {'editId': record['id'], 'revision': record['revision'],
                  'status': 'needs_review' if needs_review else 'active',
                  'sourceText': source_text if isinstance(source_text, str) else '',
                  'sourceVersion': copy.deepcopy(record.get('baseReportVersion')),
                  'sectionTitle': record['sectionTitle'], 'sourceIndex': record['sourceIndex']}
    if reason:
        correction['reason'] = reason
    item.update(text=re.sub(r'^\s*✅\s*', '', record['text']), origin='user', nature='fix',
                ts=record['ts'], account=record['account'], _kbEditId=record['id'],
                _kbRevision=record['revision'], _kbUserEdited=True,
                _kbEditStatus=correction['status'], verificationStatus='user_stated')
    if record['sourceIndex'] is not None:
        item['correction'] = correction
    return item


def retained_corrections(state, key):
    """Return detached corrections without applying them to any newer source.

    Deleted/invalid records never return. The old source is provenance and
    conflict context only; it is not reintroduced as a current factual row.
    """
    project = (state.get('PROJECTS') or {}).get(key)
    if not isinstance(project, dict):
        return []
    sections = project.get('kb') if isinstance(project.get('kb'), list) else []
    result = []
    for identity, record in _records(state, key).items():
        if (not _valid_record(record, identity) or record.get('deleted')
                or record['sourceIndex'] is None):
            continue
        index = record['sectionIndex']
        section = sections[index] if index < len(sections) else None
        if isinstance(section, dict) and _source_current(record, project, section, index):
            continue
        reason = ('base_version_changed' if not _same(record.get('baseReportVersion'), project.get('baseReportVersion'))
                  else 'source_changed')
        result.append(_projected_edit(record, record['sourceItem'], needs_review=True, reason=reason))
    return sorted(result, key=lambda item: (item['ts'], item['_kbEditId']))


def effective_known(state, key, section_index):
    """Clone one section and apply only revisions still bound to its exact source."""
    project = (state.get('PROJECTS') or {}).get(key)
    sections = project.get('kb') if isinstance(project, dict) else None
    if not _index(section_index) or not isinstance(sections, list) or section_index >= len(sections):
        return []
    section = sections[section_index]
    if not isinstance(section, dict) or not isinstance(section.get('known'), list):
        return []
    result = copy.deepcopy(section['known'])
    records = _records(state, key)
    matched = [record for identity, record in records.items()
               if _valid_record(record, identity) and not record.get('deleted', False)
               and _source_current(record, project, section, section_index)]
    # Stable order independent of serialization order. Corrupt duplicate source
    # revisions do not make whichever dictionary entry came last authoritative.
    replacements = {}
    for record in matched:
        if record['sourceIndex'] is not None:
            replacements.setdefault(record['sourceIndex'], []).append(record)
    for source_index, candidates in replacements.items():
        if len(candidates) == 1:
            result[source_index] = _projected_edit(candidates[0], result[source_index])
    for record in sorted((record for record in matched if record['sourceIndex'] is None),
                         key=lambda record: (record['ts'], record['id'])):
        result.append(_projected_edit(record))
    # Preserve detached corrections beside their named section. If the section
    # was removed/renamed, show them once in the first surviving section.
    for item in retained_corrections(state, key):
        title = item['correction']['sectionTitle']
        matching = [i for i, value in enumerate(sections)
                    if isinstance(value, dict) and value.get('t') == title]
        target = matching[0] if matching else next((i for i, value in enumerate(sections)
                                                  if isinstance(value, dict) and isinstance(value.get('known'), list)), None)
        if target == section_index:
            result.append(item)
    return result


def save_edit(body, state, principal, *, now_ms=None):
    """Validate a CAS edit against locked state, then change only KB_EDITS."""
    if (not isinstance(body, dict) or not _FIELDS <= set(body)
            or set(body) - (_FIELDS | {'text', 'action'})):
        _fail(400, 'invalid_input', '修改资料的请求格式不正确')
    action = body.get('action', 'save')
    if action not in ('save', 'delete'):
        _fail(400, 'invalid_input', '修改资料的操作不正确')
    key, index, title = body['projectKey'], body['sectionIndex'], body['sectionTitle']
    if (not isinstance(key, str) or not key or len(key) > 256 or key != key.strip()
            or not _index(index) or not isinstance(title, str) or not title.strip()
            or len(title) > 500 or not _index(body['expectedRevision'])
            or action == 'save' and (not isinstance(body.get('text'), str) or not body['text'].strip())):
        _fail(400, 'invalid_input', '修改资料的请求格式不正确')
    if action == 'save' and len(body['text']) > MAX_TEXT_CHARS:
        _fail(413, 'request_too_large', '修改内容过长，请缩短后重试')
    if key not in allowed_project_keys(state, principal):
        _fail(403, 'workspace_forbidden', '没有该工作区的访问权限')
    if not _same(body['resetGen'], state.get('RESET_GEN')):
        _fail(409, 'stale_generation', '数据已重置，请刷新后重试')
    if action == 'delete':
        # Restoring/hiding a retained correction must remain possible after a
        # monthly publication has replaced or removed its original section.
        edit_id = body['editId']
        previous = _records(state, key).get(edit_id) if isinstance(edit_id, str) else None
        if not _valid_record(previous, edit_id) or previous['revision'] != body['expectedRevision']:
            _fail(409, 'edit_conflict', '修订已更新，请重新打开资料')
        if (previous['sectionTitle'] != title or previous['sourceIndex'] != body['sourceIndex']
                or not _same(previous['sourceItem'], body['sourceItem'])
                or not _same(previous['baseReportVersion'], body['baseReportVersion'])
                or previous['sourceIndex'] is not None and previous['sectionIndex'] != index):
            _fail(409, 'edit_conflict', '修订所对应的资料已变化，请重新打开')
        stamp = int(time.time() * 1000) if now_ms is None else now_ms
        if type(stamp) is not int or stamp < 0:
            _fail(503, 'storage_unavailable', '资料修订暂不可用，请稍后重试')
        record = dict(previous, revision=previous['revision'] + 1, ts=stamp, deleted=True)
        state['KB_EDITS'][key][edit_id] = record
        return {'ok': True, 'record': copy.deepcopy(record)}
    project, section = _section(state, key, index, title)
    source_index, source_item, version = body['sourceIndex'], body['sourceItem'], body['baseReportVersion']
    if source_index is None:
        if source_item is not None or version is not None:
            _fail(400, 'invalid_input', '补充资料不能绑定报告原文')
        if not _unique_title(project, title):
            _fail(409, 'section_changed', '资料分区存在重名，请重新整理分区后补充')
    else:
        if not _index(source_index) or not isinstance(source_item, (str, dict)):
            _fail(400, 'invalid_input', '原资料标识不正确')
        if not _same(version, project.get('baseReportVersion')):
            _fail(409, 'report_changed', '基础报告已更新，请刷新后重试')
        if source_index >= len(section['known']) or not _same(source_item, section['known'][source_index]):
            _fail(409, 'source_changed', '原资料已更新，请刷新后重试')
    records = _records(state, key)
    edit_id = body['editId']
    previous = None
    if edit_id is not None and (not isinstance(edit_id, str) or not edit_id or len(edit_id) > 128):
        _fail(400, 'invalid_input', '修订标识不正确')
    if edit_id is None:
        if body['expectedRevision'] != 0 or action == 'delete':
            _fail(409, 'edit_conflict', '修订已更新，请重新打开资料')
        if source_index is not None and any(
                _valid_record(record, identity) and record['sectionIndex'] == index
                and record['sectionTitle'] == title and record['sourceIndex'] == source_index
                and _same(record['sourceItem'], source_item)
                and _same(record.get('baseReportVersion'), version)
                for identity, record in records.items()):
            _fail(409, 'edit_conflict', '这条资料已有修订，请重新打开后修改')
        edit_id = uuid.uuid4().hex
        if edit_id in records:
            _fail(503, 'storage_unavailable', '尚未保存，请重试')
        revision = 1
    else:
        previous = records.get(edit_id)
        if not _valid_record(previous, edit_id) or previous['revision'] != body['expectedRevision']:
            _fail(409, 'edit_conflict', '修订已更新，请重新打开资料')
        if (previous['sectionTitle'] != title or previous['sourceIndex'] != source_index
                or not _same(previous['sourceItem'], source_item)
                or not _same(previous.get('baseReportVersion'), version)
                or source_index is not None and previous['sectionIndex'] != index):
            _fail(409, 'edit_conflict', '修订所对应的资料已变化，请重新打开')
        revision = previous['revision'] + 1
    stamp = int(time.time() * 1000) if now_ms is None else now_ms
    if type(stamp) is not int or stamp < 0:
        _fail(503, 'storage_unavailable', '资料修订暂不可用，请稍后重试')
    record = {'id': edit_id, 'sectionIndex': previous['sectionIndex'] if previous else index, 'sectionTitle': title,
              'sourceIndex': source_index, 'sourceItem': copy.deepcopy(source_item),
              'baseReportVersion': copy.deepcopy(version), 'text': previous['text'] if action == 'delete' else body['text'],
              'revision': revision, 'ts': stamp, 'account': principal.get('user', ''), 'status': 'edited',
              'deleted': action == 'delete'}
    state.setdefault('KB_EDITS', {}).setdefault(key, {})[edit_id] = record
    return {'ok': True, 'record': copy.deepcopy(record)}


def handle_kb_edit(handler, raw, session_factory, admin_config=None):
    """Commit precedes HTTP success; re-authenticate under the storage lock."""
    try:
        check_origin(handler.headers)
        if len(raw) > MAX_REQUEST_BYTES:
            _fail(413, 'request_too_large', '请求内容过大')
        try:
            body = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        except (ValueError, UnicodeError, RecursionError):
            _fail(400, 'invalid_json', '请求格式不正确')
        with session_factory() as session:
            state = json.loads(session.read())
            if not isinstance(state, dict):
                _fail(503, 'storage_unavailable', '资料修订暂不可用，请稍后重试')
            principal = require_session(handler.headers, state, admin_config=admin_config)
            result = save_edit(body, state, principal)
            if not session.write(json.dumps(state, ensure_ascii=False, allow_nan=False)):
                _fail(503, 'storage_unavailable', '尚未保存，请重试')
        return respond(handler, 200, result)
    except AuthError as error:
        return error_response(handler, error)
    except Exception:
        return error_response(handler, AuthError(503, 'storage_unavailable', '尚未保存，请重试'))
