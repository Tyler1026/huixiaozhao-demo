"""Durable original uploads. Bytes and their scoped JSON references commit together.

No I/O at import. PostgreSQL is required for originals; extraction-only remains
available separately. The public route never trusts an upload id as authority.
"""
from __future__ import annotations
import base64
import hashlib
import json
import re
import time
import uuid
from urllib.parse import parse_qs, quote, urlsplit
from .auth import AuthError, require_session
from .auth_routes import error_response, require_admin, respond
from .access_control import authorize_project

MAX_FILE_BYTES = 20 * 1024 * 1024
MIME = {'.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json'}
SCHEMA = """
CREATE TABLE IF NOT EXISTS upload_originals (
    upload_id TEXT PRIMARY KEY CHECK (upload_id ~ '^[a-f0-9]{32}$'),
    project_key TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
    sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    uploaded_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload BYTEA NOT NULL,
    CHECK (octet_length(payload) = size_bytes)
);
CREATE INDEX IF NOT EXISTS upload_originals_project ON upload_originals(project_key);
"""


def initialize(cursor):
    cursor.execute(SCHEMA)


def prepare_file(body):
    name = body.get('filename')
    if (not isinstance(name, str) or not name.strip() or len(name) > 255
            or '/' in name or '\\' in name or any(ord(c) < 32 or ord(c) == 127 for c in name)):
        raise AuthError(400, 'invalid_filename', '文件名不正确')
    suffix = '.' + name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    if suffix not in MIME:
        raise AuthError(400, 'unsupported_file', '支持 PDF、DOCX、TXT、MD、CSV 和 JSON')
    encoded = body.get('fileB64')
    if not isinstance(encoded, str) or not encoded:
        raise AuthError(400, 'missing_file', '缺少文件内容')
    if len(encoded) > 4 * ((MAX_FILE_BYTES + 2) // 3):
        raise AuthError(413, 'file_too_large', '单个文件不能超过 20MB')
    try:
        payload = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        raise AuthError(400, 'invalid_base64', '文件内容编码不正确') from None
    if not payload:
        raise AuthError(400, 'empty_file', '不能上传空文件')
    if len(payload) > MAX_FILE_BYTES:
        raise AuthError(413, 'file_too_large', '单个文件不能超过 20MB')
    upload_id = body.get('uploadId') or uuid.uuid4().hex
    if not isinstance(upload_id, str) or not re.fullmatch(r'[a-f0-9]{32}', upload_id):
        raise AuthError(400, 'invalid_upload_id', '上传标识不正确')
    return {'id': upload_id, 'filename': name, 'payload': payload,
            'content_type': MIME[suffix], 'size_bytes': len(payload),
            'sha256': hashlib.sha256(payload).hexdigest()}


def save_original(cursor, original, key, actor):
    cursor.execute("""SELECT project_key,filename,content_type,size_bytes,sha256
                       FROM upload_originals WHERE upload_id=%s""", (original['id'],))
    existing = cursor.fetchone()
    expected = (key, original['filename'], original['content_type'], original['size_bytes'], original['sha256'])
    if existing is not None:
        if tuple(existing) != expected:
            raise AuthError(409, 'upload_conflict', '上传标识已使用，请重新选择文件')
        return False
    cursor.execute("""INSERT INTO upload_originals
        (upload_id,project_key,filename,content_type,size_bytes,sha256,uploaded_by,payload)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        (original['id'], *expected, actor, original['payload']))
    return True


def file_record(original, key, body, actor, chunks):
    return {'name': original['filename'], 'size': original['size_bytes'],
            'originalId': original['id'], 'originalSha256': original['sha256'],
            'contentType': original['content_type'], 'projectKey': key,
            'ts': int(time.time() * 1000), 'chunks': chunks,
            'kbIdx': body.get('kbIdx'), 'topic': body.get('topic', ''),
            'mode': body.get('mode', 'append'), 'account': actor}


def user_chunks(text, filename, topic, original_id):
    chunks, buf = [], ''
    for para in re.split(r'\n{2,}', text.replace('\r\n', '\n').strip()):
        para = para.strip()
        if not para:
            continue
        buf += (' ' if buf else '') + para
        if len(buf) >= 120:
            chunks.append(buf[:300]); buf = ''
    if buf:
        chunks.append(buf[:300])
    return [{'id': 'upload:' + original_id + ':' + str(i), 'topic': topic,
             'tags': ['上传', filename.rsplit('.', 1)[0]], 'text': value,
             'cite': filename, 'originalId': original_id}
            for i, value in enumerate(chunks[:30])]


def mutate_admin(state, body, actor, noise_filter):
    key = body['projectKey']
    projects = state['PROJECTS']
    filename = body.get('filename', '上传文档')
    topic = body.get('topic', '')
    mode = body.get('mode', 'append')
    text = body.get('text', '')
    p = projects[key]
    if not isinstance(p.get('kb'), list):
        p['kb'] = []
    # origin: admin(管理员) / user(前端用户)；nature: support(佐证) / fix(修正/修改) / confirm(确认)
    origin = body.get('origin', 'admin')
    nature = body.get('nature', 'support')   # 默认佐证
    # 【2026-09-29】by 此前只写进 p.kbUploads[] 审计日志（整批上传的元信息），
    # 没有落到每条 chunk/annotation 本身，导致前端逐条渲染时读不到"是谁上传的"，
    # 徽标只能显示笼统的"管理员/用户"。现在把它也带进每条记录，字段名对齐前端
    # ragOriginStyle() 读取的 account。
    by_account = actor
    import time as _tt
    _ts = int(_tt.time() * 1000)
    # 切分文档为结构化 chunks（每条带来源标记，前端据此着色）
    import re as _re
    parts = [x.strip() for x in _re.split(r'\n\s*\n', text) if len(x.strip()) >= 20]
    chunks = []
    for para in parts:
        para = _re.sub(r'\s+', ' ', para)[:420]
        if noise_filter(para):   # 过滤附注/免责/页码等无价值模板话
            continue
        chunks.append({'text': para, 'origin': origin, 'nature': nature,
                       'src': filename, 'ts': _ts, 'account': by_account})
    # 找/建目标主题
    tp = next((t for t in p['kb'] if t.get('t') == topic), None)
    if not tp:
        tp = {'icon': '📎', 't': topic or '管理员补充资料',
              'sub': '', 'tag': '', 'known': [], 'calls': []}
        p['kb'].append(tp)
    # 就地匹配：新 chunk 与已有条目相似度高 → 在已有条目上打标注，不新增
    def _strip_tag(s):
        # 剥掉结构化导入的 [对象ID|状态] 前缀，避免稀释相似度
        return _re.sub(r'^\s*[\[【][^\]】]{0,50}[\]】]\s*', '', str(s or ''))
    def _norm(s):
        return _re.sub(r'[\s，,。、；;：:（）()【】\[\]|—\-]+', '', _strip_tag(s))
    def _chunk_text(k):
        return k.get('text', '') if isinstance(k, dict) else str(k)
    def _sal_nums(s):
        # 显著数字：带小数点 / 百分数 / ≥3位非年份——用于"同一指标同一数值"佐证通道
        out = set()
        for m in _re.findall(r'\d+(?:\.\d+)?%?', _strip_tag(s)):
            if m.endswith('%') or '.' in m:
                out.add(m.rstrip('%') + ('%' if m.endswith('%') else ''))
            elif len(m) >= 3 and not (1900 <= int(m) <= 2100):
                out.add(m)
        return out
    def _similar(a, b):
        a, b = _norm(a), _norm(b)
        if not a or not b:
            return 0.0
        # 双向包含 or 字符级重叠比例
        if a in b or b in a:
            return 0.9
        short, long = (a, b) if len(a) <= len(b) else (b, a)
        # 滑窗取 short 的若干 8-gram 命中率
        grams = [short[x:x+8] for x in range(0, max(1, len(short) - 7), 4)] or [short]
        hit = sum(1 for g in grams if g and g in long)
        return hit / len(grams)
    _IND_WORDS = ('生产总值', 'GDP', '增加值', '产值', '产量', '增速', '增长',
                  '配套率', '城镇化率', '常住人口', '进出口', '进口', '出口',
                  '财政收入', '投资', '用电', '客运', '货运', '面积', '营收',
                  '利润', '税收', '就业', '工资', '房价', '地价')
    def _ind_hit(a, b):
        # 指标核心词共现：两段文本含同一个指标词才允许数字佐证通道生效
        return any(w in a and w in b for w in _IND_WORDS)
    def _is_strong_num(n):
        # 高精度数字（1502.81 / 75287）撞上即近乎必为同一事实；
        # 低精度（2.6 / 10% / 100）必须再过指标词门禁
        d = n.rstrip('%').replace('.', '')
        return ('.' in n and len(d) >= 4) or ('.' not in n and not n.endswith('%') and len(d) >= 5)

    matched_ct = 0
    if mode == 'replace':
        base = [k for k in (tp.get('known') or [])
                if isinstance(k, str) or (isinstance(k, dict) and k.get('origin') == 'ai')]
        tp['known'] = base + chunks
    else:
        # 跨主题匹配：原文（如GDP在园区主题、产业事实在产业链主题）分布在
        # 不同主题，佐证应挂到全库任何一条命中原文上；未命中才追加到目标主题
        norm_known = []
        for _tpc in p['kb']:
            _kn = _tpc.get('known') or []
            for _i, _k in enumerate(_kn):
                if not isinstance(_k, dict):
                    _kn[_i] = {'text': _k, 'origin': 'ai', 'nature': 'base'}
            _tpc['known'] = _kn
            norm_known.extend(_kn)
        leftover = []
        for nc in chunks:
            best, best_score = None, 0.55   # 相似度阈值
            nc_nums = _sal_nums(nc['text'])
            for ek in norm_known:
                et = ek.get('text', '')
                sc = _similar(nc['text'], et)
                # 数字佐证通道：同一显著数值 → 视为佐证同一事实
                if sc <= best_score and nc_nums:
                    # 数字佐证：高精度数字撞上直接挂；低精度数字须指标词共现，
                    # 防止碰巧同数值的不同指标误挂（增速10% vs 占有率10%、2.6亿 vs 2.6万亿）
                    shared = nc_nums & _sal_nums(et)
                    if shared:
                        if any(_is_strong_num(n) for n in shared):
                            sc = max(sc, 0.8)   # 高精度数值（如1502.81、75287）
                        elif _ind_hit(nc['text'], et):
                            sc = max(sc, 0.7)   # 低精度数值+指标词命中
                if sc > best_score:
                    best, best_score = ek, sc
            if best is not None:
                # 就地标注到已有条目
                best.setdefault('annotations', []).append({
                    'origin': origin, 'nature': nature, 'src': filename,
                    'text': nc['text'], 'ts': _ts, 'account': by_account})
                matched_ct += 1
            else:
                leftover.append(nc)
        tp['known'] = (tp.get('known') or []) + leftover
    # 记录上传审计
    p.setdefault('kbUploads', []).append({
        'filename': filename, 'topic': topic, 'mode': mode,
        'chunks': len(chunks), 'ts': int(__import__('time').time() * 1000),
        'by': actor,
        'source': body.get('source', 'file')})

    return {'ok': True, 'chunks': len(chunks), 'matched': matched_ct,
            'chars': len(text), 'topic': tp['t'], 'total': len(tp['known'])}


def handle_upload(handler, raw, session_factory, parser, admin_config, noise_filter, *, admin=False):
    try:
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise AuthError(400, 'invalid_json', '请求格式不正确')
        original = prepare_file(body) if 'fileB64' in body or body.get('source') == 'file' or not admin else None
        if original:
            text, error = parser(original['filename'], original['payload'])
            if error or not isinstance(text, str) or not text.strip():
                raise AuthError(422, 'extraction_failed', error or '文件没有可解析的正文')
            body['text'] = text
        elif not isinstance(body.get('text', ''), str):
            raise AuthError(400, 'invalid_text', '正文格式不正确')
        with session_factory() as session:
            state = json.loads(session.read())
            principal = require_session(handler.headers, state, admin_config=admin_config)
            if admin:
                require_admin(principal)
            key = authorize_project(body.get('projectKey'), state, principal)
            actor = principal.get('user', '')
            if original:
                if not hasattr(session, 'cursor'):
                    raise AuthError(503, 'original_storage_unavailable', '原件存储暂不可用，文件尚未保存')
                inserted = save_original(session.cursor, original, key, actor)
                if not inserted:
                    records = state.get('UPLOADS', {}).get(key, [])
                    record = next((r for r in records if r.get('originalId') == original['id']), None)
                    if record is None or any(record.get(k) != body.get(k, d) for k, d in
                        (('topic', ''), ('mode', 'append'), ('kbIdx', None))):
                        raise AuthError(409, 'upload_conflict', '上传记录不一致，请重新选择文件')
                    return respond(handler, 200, {'ok': True, 'replayed': True, 'upload': record,
                        'original': {'id': original['id'], 'sha256': original['sha256'], 'size': original['size_bytes']},
                        'chunks': record['chunks'], 'fileChunks': [c for c in state.get('KB_FILE_CHUNKS', {}).get(key, [])
                                                               if c.get('originalId') == original['id']]})
            if admin:
                result = mutate_admin(state, body, actor, noise_filter)
                chunks = []
            else:
                project = state['PROJECTS'][key]
                idx = body.get('kbIdx')
                kb = project.get('kb') or []
                if idx is not None and (type(idx) is not int or idx < 0 or idx >= len(kb)):
                    raise AuthError(400, 'invalid_topic', '主题已变化，请刷新后重新上传')
                topic = kb[idx]['t'] if idx is not None else '上传材料'
                chunks = user_chunks(body['text'], original['filename'], topic, original['id'])
                if not chunks:
                    raise AuthError(422, 'extraction_failed', '文件没有可解析的正文')
                state.setdefault('KB_FILE_CHUNKS', {}).setdefault(key, []).extend(chunks)
                if idx is not None:
                    entry = '📎 ' + original['filename'] + ' 已解析（' + str(len(chunks)) + ' 片段）'
                    if entry not in kb[idx].setdefault('known', []):
                        kb[idx]['known'].append(entry)
                    kb[idx]['tag'] = '已补充材料'
                result = {'ok': True, 'chunks': len(chunks), 'chars': len(body['text']), 'fileChunks': chunks}
            if original:
                record = file_record(original, key, body, actor, result['chunks'])
                records = state.setdefault('UPLOADS', {}).setdefault(key, [])
                # Legacy sync merges use name+timestamp. Keep even concurrent
                # same-name originals distinct without changing that protocol.
                prior_stamps = [r.get('ts', 0) for r in records if r.get('name') == record['name'] and type(r.get('ts')) is int]
                if prior_stamps:
                    record['ts'] = max(record['ts'], max(prior_stamps) + 1)
                records.append(record)
                state.setdefault('UPLOAD_TOMBS', {}).pop(key + '::' + original['filename'], None)
                if admin:
                    state['PROJECTS'][key]['kbUploads'][-1]['originalId'] = original['id']
                result.update(upload=record, original={'id': original['id'], 'sha256': original['sha256'], 'size': original['size_bytes']})
            if not session.write(json.dumps(state, ensure_ascii=False)):
                raise AuthError(503, 'storage_unavailable', '文件尚未保存，请重试')
        return respond(handler, 200, result)
    except AuthError as error:
        return error_response(handler, error)
    except (ValueError, TypeError, UnicodeError):
        return error_response(handler, AuthError(400, 'invalid_json', '请求格式不正确'))
    except Exception:
        return error_response(handler, AuthError(503, 'storage_unavailable', '文件尚未保存，请重试'))


def download_upload(handler, session_factory, admin_config):
    try:
        query = parse_qs(urlsplit(handler.path).query)
        if len(query.get('projectKey', [])) != 1 or len(query.get('uploadId', [])) != 1:
            raise AuthError(400, 'invalid_upload', '文件标识不正确')
        key, upload_id = query['projectKey'][0], query['uploadId'][0]
        if not re.fullmatch(r'[a-f0-9]{32}', upload_id):
            raise AuthError(400, 'invalid_upload', '文件标识不正确')
        with session_factory() as session:
            state = json.loads(session.read())
            principal = require_session(handler.headers, state, admin_config=admin_config)
            authorize_project(key, state, principal)
            if not hasattr(session, 'cursor'):
                raise AuthError(503, 'original_storage_unavailable', '原件存储暂不可用')
            session.cursor.execute("""SELECT filename,content_type,size_bytes,sha256,payload
                                      FROM upload_originals WHERE project_key=%s AND upload_id=%s""", (key, upload_id))
            row = session.cursor.fetchone()
        if row is None:
            raise AuthError(404, 'original_not_found', '未保存该文件原件；历史材料需重新上传')
        name, content_type, size, digest, payload = row
        payload = bytes(payload)
        if len(payload) != size or hashlib.sha256(payload).hexdigest() != digest:
            raise AuthError(503, 'original_integrity_failed', '原件校验失败，暂不能下载')
        handler.send_response(200)
        handler.send_header('Content-Type', content_type)
        handler.send_header('Content-Disposition', "attachment; filename=upload; filename*=UTF-8''" + quote(name, safe=''))
        handler.send_header('Content-Length', str(size))
        handler.send_header('Cache-Control', 'private, no-store')
        handler.send_header('X-Content-Type-Options', 'nosniff')
        handler.send_header('Vary', 'Cookie')
        handler.cors(); handler.end_headers(); handler.wfile.write(payload)
    except AuthError as error:
        return error_response(handler, error)
    except Exception:
        return error_response(handler, AuthError(503, 'storage_unavailable', '原件暂不可用，请重试'))
