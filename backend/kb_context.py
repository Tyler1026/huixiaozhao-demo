"""Request-local context for city knowledge-base conversations.

These records describe material sent to the model, not verified facts. Nothing
here fetches URLs or joins material from another project or a previous request.
"""
import copy
import hashlib
import json
import re
from urllib.parse import urlsplit

from .auth import AuthError


_URL = re.compile(r'https?://[^\s<>\[\]（），。；、"\'`]+', re.I)


def safe_source_url(value):
    """Accept an existing HTTP(S) link without credentials or active content."""
    if not isinstance(value, str):
        return ''
    value = value.strip().rstrip('.,;，。；')
    while value.endswith(')') and value.count(')') > value.count('('):
        value = value[:-1]
    if not value or len(value) > 4096 or re.search(r'[\s\x00-\x20\x7f<>"\'`\\]', value):
        return ''
    try:
        parsed = urlsplit(value)
        if (parsed.scheme.lower() not in ('http', 'https') or not parsed.hostname
                or parsed.username is not None or parsed.password is not None):
            return ''
        parsed.port  # Invalid or out-of-range ports raise ValueError.
    except ValueError:
        return ''
    return value


def _label(value, limit=240):
    return value.strip()[:limit] if isinstance(value, str) else ''


def workspace_keys(state, project_key):
    """Read only the current project and its accessible canonical parent.

    The caller must supply its authenticated, scoped state. A city label is
    never an authorization or a fallback project selector.
    """
    projects = state.get('PROJECTS') or {}
    if not isinstance(project_key, str) or not isinstance(projects.get(project_key), dict):
        raise AuthError(403, 'project_required', '请选择有权限的工作区')
    project = projects[project_key]
    root = project.get('workspaceId') or project_key
    keys = [project_key]
    if root != project_key:
        parent = projects.get(root)
        if isinstance(parent, dict) and (parent.get('workspaceId') or root) == root:
            keys.insert(0, root)
    return keys


def upload_materials(state, key):
    """Live parsed uploads with original identity; no byte/data-URL decoding."""
    tombs = state.get('UPLOAD_TOMBS') or {}
    records, by_id, inactive_names = [], {}, set()
    for record in (state.get('UPLOADS') or {}).get(key, []):
        if not isinstance(record, dict):
            continue
        name = _label(record.get('name'), 1000)
        if (record.get('pending') or record.get('parseFailed') or record.get('deleted')
                or record.get('projectKey', key) != key or tombs.get(key + '::' + name)):
            inactive_names.add(name)
            continue
        records.append(record)
        if record.get('originalId'):
            by_id[record['originalId']] = record
    out = []
    fields = ('id', 'text', 'topic', 'cite', 'sourceFile', 'file', 'src', 'source',
              'url', 'urls', 'sources', 'originalId', 'originalSha256', 'origin', 'nature',
              'account', 'ts', 'materialId')
    for chunk in (state.get('KB_FILE_CHUNKS') or {}).get(key, []):
        if (not isinstance(chunk, dict) or chunk.get('projectKey', key) != key
                or chunk.get('pending') or chunk.get('parseFailed') or chunk.get('deleted')):
            continue
        original_id = chunk.get('originalId') or ''
        receipt = by_id.get(original_id) if original_id else None
        if original_id and receipt is None:
            continue
        name = _label(chunk.get('cite') or chunk.get('file') or chunk.get('source'), 1000)
        if tombs.get(key + '::' + name) or not original_id and name in inactive_names:
            continue
        row = {field: copy.deepcopy(chunk[field]) for field in fields if field in chunk}
        source_hint = row.get('file') or row.get('src')
        if isinstance(source_hint, str) and not safe_source_url(source_hint):
            row.setdefault('sourceFile', source_hint)
        row.setdefault('cite', row.get('sourceFile') or row.get('src') or row.get('topic') or '上传材料')
        if receipt:
            row['sourceFile'] = receipt.get('name', '')
            row['cite'] = receipt.get('name') or row.get('cite', '')
            row['originalSha256'] = receipt.get('originalSha256', '')
            for field in ('account', 'ts', 'materialId'):
                if field in receipt:
                    row.setdefault(field, receipt[field])
        row.update(projectKey=key, sourceKind='uploaded_excerpt', status='unverified')
        row.setdefault('origin', 'user')
        if isinstance(row.get('text'), str) and row['text'].strip():
            out.append(row)
    for record in records:
        for field in ('text', 'extractedText', 'content'):
            if isinstance(record.get(field), str) and record[field].strip():
                row = {'text': record[field], 'cite': record.get('name', ''),
                            'sourceFile': record.get('name', ''), 'topic': record.get('topic', '上传材料'),
                            'originalId': record.get('originalId') or '',
                            'originalSha256': record.get('originalSha256') or '',
                            'projectKey': key, 'sourceKind': 'uploaded_excerpt',
                            'origin': 'user', 'status': 'unverified'}
                for attribute in ('account', 'ts', 'materialId'):
                    if attribute in record:
                        row[attribute] = record[attribute]
                out.append(row)
                break
    return out


def saved_materials(state, project_key):
    """Shared server-owned corpus for chat, profiles, funnels and reports."""
    from .kb_edits import effective_known, retained_corrections
    out = []
    for key in workspace_keys(state, project_key):
        project = state['PROJECTS'][key]
        uploads = upload_materials(state, key)
        original_ids = {row['originalId'] for row in uploads if row.get('originalId')}
        material_ids = {row['materialId'] for row in uploads if row.get('materialId')}
        tombs = state.get('UPLOAD_TOMBS') or {}
        edit_ids = set()

        def canonical_duplicate(row):
            return ((row.get('originalId') and row['originalId'] in original_ids)
                    or (row.get('materialId') and row['materialId'] in material_ids))

        def deleted_upload(row):
            filename = row.get('sourceFile') or row.get('file') or row.get('src') or row.get('cite')
            return isinstance(filename, str) and bool(tombs.get(key + '::' + filename))

        for index, section in enumerate(project.get('kb') or []):
            if not isinstance(section, dict):
                continue
            for item in effective_known(state, key, index):
                row = copy.deepcopy(item) if isinstance(item, dict) else {'text': item}
                if row.get('deleted') or row.get('pending') or row.get('parseFailed'):
                    continue
                if not isinstance(row.get('text'), str) or not row['text'].strip():
                    continue
                row.update(projectKey=key, topic=section.get('t', ''), status='unverified')
                row.setdefault('cite', row.get('src') or row.get('sourceFile') or section.get('t', ''))
                row['sourceKind'] = 'saved_report_excerpt' if row.get('origin') == 'report' else 'saved_note'
                if row.get('_kbEditId'):
                    edit_ids.add(row['_kbEditId'])
                # Old imports attached notes to base rows. Materialize those
                # notes independently; a later package must not erase them.
                for annotation in row.get('annotations') or []:
                    if (not isinstance(annotation, dict) or canonical_duplicate(annotation)
                            or deleted_upload(annotation) or annotation.get('deleted')
                            or annotation.get('pending') or annotation.get('parseFailed')
                            or not isinstance(annotation.get('text'), str) or not annotation['text'].strip()):
                        continue
                    note = copy.deepcopy(annotation)
                    note.update(projectKey=key, topic=section.get('t', ''), status='unverified',
                                sourceKind='saved_note', origin=note.get('origin') or 'admin')
                    note['nature'] = note.get('nature') if note.get('nature') != 'base' else 'support'
                    note.setdefault('cite', note.get('src') or row.get('sourceFile') or row['cite'])
                    note.setdefault('sourceFile', note.get('src') or row.get('sourceFile') or '')
                    reference = {'sourceText': row['text'], 'sourceVersion': copy.deepcopy(project.get('baseReportVersion')),
                                 'sectionTitle': section.get('t', '')}
                    if note.get('nature') == 'fix':
                        note['correction'] = dict(reference, status='needs_review', reason='legacy_annotation')
                    else:
                        note['relatedSource'] = reference
                    out.append(note)
                if (not row.get('correction') and row.get('origin') in ('user', 'admin')
                        and (canonical_duplicate(row) or deleted_upload(row))):
                    continue
                out.append(row)
        # A replaced package can temporarily have no sections at all. The
        # correction remains readable and pending review rather than vanishing.
        for row in retained_corrections(state, key):
            if row['_kbEditId'] in edit_ids:
                continue
            row.update(projectKey=key, topic=row['correction']['sectionTitle'],
                       status='unverified', sourceKind='saved_note')
            row.setdefault('cite', row.get('src') or row.get('sourceFile') or row['topic'])
            out.append(row)
        out.extend(uploads)
    return out


def material_retrieval_text(row):
    """Use a correction's old subject for matching, never as current evidence."""
    if isinstance(row, str):
        return row
    if not isinstance(row, dict):
        return ''
    text = str(row.get('text') or '')
    correction = row.get('correction')
    if isinstance(correction, dict):
        text += '\n' + str(correction.get('sourceText') or '') + '\n' + str(correction.get('sectionTitle') or '')
    elif row.get('sourceKind') == 'uploaded_excerpt':
        # A file explicitly filed under a specific industry retains that scope
        # even when this chunk only contains a short numerical qualification.
        text += '\n' + str(row.get('topic') or '') + '\n' + str(row.get('sourceFile') or '')
    related = row.get('relatedSource')
    if isinstance(related, dict):
        text += '\n' + str(related.get('sourceText') or '')
    return text


def bounded_correction_context(correction, *, query='', max_chars=4000):
    """Bound only old background prose, never clip the user's new correction.

    Source hashes/offsets make the excerpt explicit. The full source remains in
    the persisted edit record and is used for retrieval before this projection.
    """
    result = copy.deepcopy(correction)
    source = result.get('sourceText')
    if isinstance(source, str) and len(source) > max_chars:
        positions = [source.casefold().find(term.casefold()) for term in query.split() if len(term) >= 2]
        positions = [position for position in positions if position >= 0]
        start = max(0, min(positions) - max_chars // 4) if positions else 0
        start = min(start, len(source) - max_chars)
        result.update(sourceText=source[start:start + max_chars], sourceTextTruncated=True,
                      sourceTextChars=len(source), sourceTextStart=start,
                      sourceTextSha256=hashlib.sha256(source.encode()).hexdigest())
    return result


def chat_request_context(body, state):
    """Scoped chats ignore stale/forged client chunks; keyless legacy stays local."""
    key = body.get('projectKey')
    if key is None or key == '':
        return {'projectKey': '', 'workspaceId': '', 'city': body.get('city', ''),
                'topic': body.get('topic', ''), 'chunks': body.get('chunks') or [],
                'onboarding': {}}
    try:
        keys = workspace_keys(state, key)
    except AuthError:
        raise AuthError(403, 'workspace_forbidden', '无权访问该工作区') from None
    project = state['PROJECTS'][key]
    rows = saved_materials(state, key)
    for row in rows:
        if not row.get('id'):
            signature = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
            row['id'] = 'material_' + hashlib.sha256(signature.encode()).hexdigest()[:24]
    return {'projectKey': key, 'workspaceId': keys[0], 'city': project.get('city', ''),
            'topic': body.get('topic') if isinstance(body.get('topic'), str) else '',
            'chunks': rows, 'onboarding': copy.deepcopy(project.get('onboarding') or {})}


def onboarding_request_context(body, state):
    """Require a visible workspace; browser material and city are not evidence."""
    key = body.get('projectKey')
    if not isinstance(key, str) or not key.strip():
        raise AuthError(403, 'project_required', '请选择有权限的工作区')
    try:
        keys = workspace_keys(state, key)
    except AuthError:
        raise AuthError(403, 'workspace_forbidden', '无权访问该工作区') from None
    project = state['PROJECTS'][key]
    # A demand can use its visible canonical parent's materials, but an absent
    # or inconsistent parent must not silently become a different city scope.
    if (project.get('workspaceId') or key) != keys[0]:
        raise AuthError(403, 'workspace_forbidden', '无权访问该工作区')
    city = project.get('city')
    if not isinstance(city, str) or not city.strip():
        raise AuthError(409, 'city_required', '工作区城市信息缺失，请联系管理员核对')
    city = city.strip()
    if any(not isinstance(state['PROJECTS'][item].get('city'), str)
           or state['PROJECTS'][item]['city'].strip() != city for item in keys):
        raise AuthError(409, 'workspace_city_mismatch', '工作区城市信息不一致，请联系管理员核对')
    context = chat_request_context({'projectKey': key}, state)
    context['city'] = city
    return context


def chat_sources(chunks):
    """Project only selected chunks; a valid URL is not a factual endorsement."""
    sources = []
    for chunk in chunks:
        row = chunk if isinstance(chunk, dict) else {}
        text = chunk if isinstance(chunk, str) else row.get('text', '')
        text = text if isinstance(text, str) else str(text or '')
        candidates = _URL.findall(text)
        # Keep provenance already attached to this exact chunk. In particular,
        # never resolve a bare 'source[1]' against another chunk's bibliography.
        for field in ('url', 'source', 'src', 'cite'):
            value = row.get(field)
            if isinstance(value, str):
                candidates.extend(_URL.findall(value))
        for field in ('sources', 'urls'):
            for value in row.get(field, []) if isinstance(row.get(field), list) else []:
                candidates.append(value.get('url') if isinstance(value, dict) else value)
        urls = list(dict.fromkeys(url for value in candidates if (url := safe_source_url(value))))
        source = {
            'id': _label(row.get('id')) or 'chunk_'+hashlib.sha256(text.encode()).hexdigest()[:20],
            'cite': _label(row.get('cite')),
            'topic': _label(row.get('topic')),
            'text': text,
            'urls': urls,
            'traceable': bool(urls),
            'status': 'unverified',
        }
        for field in ('projectKey', 'sourceFile', 'originalId', 'originalSha256', 'sourceKind',
                      'account', 'ts', 'materialId'):
            if field in row:
                source[field] = copy.deepcopy(row[field])
        if isinstance(row.get('correction'), dict):
            source['correction'] = bounded_correction_context(row['correction'])
        if isinstance(row.get('relatedSource'), dict):
            source['relatedSource'] = bounded_correction_context(row['relatedSource'])
        sources.append(source)
    return sources


def chat_context(sources, *, persisted=False):
    """The displayed source records and model evidence use the same text/URLs."""
    prefix = ('存储状态（服务端确认）：以下检索材料已经完成长期保存确认，可在后续新会话使用，无需再次点击保存；它们已保存在当前工作区，并从数据库读取。'
              '未核验或未附外部链接只表示事实缺少独立证据，不表示材料未保存。\n\n') if persisted else ''
    return prefix + '\n\n'.join(
        '[材料%d｜%s｜%s·%s]\n%s%s%s\n原始链接：%s' % (
            index, source['id'], source['cite'], source['topic'], source['text'],
            ('\n用户更正上下文（未核验；旧原文仅用于识别被纠正主张，不能作为当前事实）：' +
             json.dumps(source['correction'], ensure_ascii=False)) if source.get('correction') else '',
            ('\n关联旧材料（只用于理解这条补充的对象，不是已核实事实）：' +
             json.dumps(source['relatedSource'], ensure_ascii=False)) if source.get('relatedSource') else '',
            '；'.join(source['urls']) or '本片段未附可追溯原始链接（仅有来源编号或主题名不构成原始链接）')
        for index, source in enumerate(sources, 1)
    )


def conversation_history(history, question, max_messages=8, max_content=1500):
    """Keep recent user/assistant text, excluding the pending question at tail."""
    if not isinstance(history, list):
        return []
    valid = []
    for item in reversed(history):
        if not isinstance(item, dict) or item.get('role') not in ('user', 'assistant'):
            continue
        content = item.get('content')
        if not isinstance(content, str) or not content.strip():
            continue
        content = content.strip()
        # Older clients append the pending user message before calling us.
        # Remove it before truncation; the final user message is added below.
        if not valid and item['role'] == 'user' and content == question:
            continue
        valid.append({'role': item['role'], 'content': content[:max_content]})
        if len(valid) >= max_messages:
            break
    return list(reversed(valid))
