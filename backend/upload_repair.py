"""Rebuild legacy truncated excerpts from durable originals, never from guesses.

Small batches use one claim transaction and one completion transaction. Actual
parsing runs outside the shared-state lock. A persisted lease survives crashes;
successful and failed attempts are not repeated on every page read or restart.
"""
import copy
import hashlib
import json
import math
import re
import threading
import time
import uuid

from .auth import AuthError
from .upload_originals import CHUNK_VERSION, user_chunks


LEASE_MS = 10 * 60 * 1000
_worker_lock = threading.Lock()
_worker = None


def _active(state, key, record):
    return (isinstance((state.get('PROJECTS') or {}).get(key), dict)
            and record.get('projectKey', key) == key
            and not record.get('deleted') and not record.get('pending')
            and not record.get('parseFailed')
            and not (state.get('UPLOAD_TOMBS') or {}).get(key + '::' + str(record.get('name', ''))))


def pending_legacy_uploads(state, project_key):
    """Read-only gate before freezing a report's workspace input snapshot.

    Active leases are still pending: extraction has not committed full chunks
    yet. Permanent failures for this algorithm version and text-only legacy
    uploads cannot improve by waiting, so they never block a report forever.
    The caller supplies its authorized state, as for saved_materials().
    """
    from .kb_context import workspace_keys
    pending, seen = [], set()
    for key in workspace_keys(state, project_key):
        records = (state.get('UPLOADS') or {}).get(key, [])
        for record in records if isinstance(records, list) else []:
            if not isinstance(record, dict) or not _active(state, key, record):
                continue
            original_id = record.get('originalId')
            if not isinstance(original_id, str) or not re.fullmatch('[a-f0-9]{32}', original_id):
                continue
            if type(record.get('chunkVersion')) is int and record['chunkVersion'] >= CHUNK_VERSION:
                continue
            repair = record.get('chunkRepair') or {}
            if (isinstance(repair, dict) and repair.get('version') == CHUNK_VERSION
                    and repair.get('status') == 'failed'):
                continue
            identity = (key, original_id)
            if identity in seen:
                continue
            seen.add(identity)
            pending.append({'projectKey': key, 'originalId': original_id,
                            'name': record.get('name', ''),
                            'status': repair.get('status', 'pending') if isinstance(repair, dict) else 'pending'})
    return pending


def _leased(repair, now):
    expiry = repair.get('leaseUntil', 0) if isinstance(repair, dict) else 0
    return (isinstance(repair, dict) and repair.get('status') == 'running'
            and repair.get('version') == CHUNK_VERSION
            and type(expiry) in (int, float) and math.isfinite(expiry) and expiry > now)


def _due(record, now, retry_failed):
    if type(record.get('chunkVersion')) is int and record['chunkVersion'] >= CHUNK_VERSION:
        return False
    repair = record.get('chunkRepair') or {}
    if not isinstance(repair, dict) or repair.get('version') != CHUNK_VERSION:
        return True
    if _leased(repair, now):
        return False
    if repair.get('status') == 'failed' and not retry_failed:
        return False
    return True


def _claim(session_factory, limit, now, retry_failed):
    with session_factory() as session:
        if not hasattr(session, 'cursor'):
            return [], 0
        state = json.loads(session.read())
        candidates, seen, waiting = [], set(), 0
        for key, records in (state.get('UPLOADS') or {}).items():
            if not isinstance(key, str) or not isinstance(records, list):
                continue
            for record in records:
                if not isinstance(record, dict) or not _active(state, key, record):
                    continue
                original_id = record.get('originalId')
                if not isinstance(original_id, str) or not re.fullmatch('[a-f0-9]{32}', original_id):
                    continue  # Historical text-only uploads have no bytes to recover.
                identity = (key, original_id)
                repair = record.get('chunkRepair') or {}
                if _leased(repair, now):
                    waiting += 1
                if identity in seen or not _due(record, now, retry_failed) or len(candidates) >= limit:
                    continue
                seen.add(identity)
                attempt = uuid.uuid4().hex
                record['chunkRepair'] = {'version': CHUNK_VERSION, 'status': 'running',
                                         'attemptId': attempt, 'startedAt': now, 'leaseUntil': now + LEASE_MS}
                candidates.append({'key': key, 'record': copy.deepcopy(record), 'attemptId': attempt,
                                   'resetGen': copy.deepcopy(state.get('RESET_GEN'))})
        if not candidates:
            return [], waiting
        session.cursor.execute('''SELECT upload_id,project_key,filename,size_bytes,sha256,payload
                                  FROM upload_originals WHERE upload_id = ANY(%s)''',
                               ([item['record']['originalId'] for item in candidates],))
        originals = {row[0]: row for row in session.cursor.fetchall()}
        for item in candidates:
            item['original'] = originals.get(item['record']['originalId'])
        if not session.write(json.dumps(state, ensure_ascii=False)):
            raise OSError('upload repair claim not committed')
        return candidates, waiting


def _extract(item, parser):
    record, original = item['record'], item['original']
    if original is None:
        return {'error': 'original_not_found'}
    original_id, key, filename, size, digest, raw = original
    payload = bytes(raw)
    if (key != item['key'] or filename != record.get('name')
            or record.get('originalSha256') not in (None, '', digest)
            or record.get('size') not in (None, size)
            or len(payload) != size or hashlib.sha256(payload).hexdigest() != digest):
        return {'error': 'original_integrity_failed'}
    try:
        text, error = parser(filename, payload)
        if error or not isinstance(text, str) or not text.strip():
            return {'error': 'extraction_failed'}
        chunks = user_chunks(text, filename, record.get('topic') or '上传材料', original_id)
        if not chunks:
            return {'error': 'extraction_failed'}
        return {'chunks': chunks, 'sha256': digest}
    except AuthError as error:
        return {'error': error.code if error.code in ('text_too_large', 'too_many_chunks') else 'extraction_failed'}
    except Exception:
        return {'error': 'extraction_failed'}


def _finish(session_factory, candidates, results, now):
    counts = {'repaired': 0, 'failed': 0, 'skipped': 0}
    with session_factory() as session:
        state = json.loads(session.read())
        changed = False
        for item, result in zip(candidates, results):
            key, original_id = item['key'], item['record']['originalId']
            matches = [record for record in (state.get('UPLOADS') or {}).get(key, [])
                       if isinstance(record, dict) and record.get('originalId') == original_id
                       and isinstance(record.get('chunkRepair'), dict)
                       and record['chunkRepair'].get('attemptId') == item['attemptId']]
            if (state.get('RESET_GEN') != item['resetGen'] or not matches
                    or not all(_active(state, key, record) for record in matches)
                    or any(any(record.get(field) != item['record'].get(field)
                               for field in ('name', 'size', 'originalSha256')) for record in matches)):
                counts['skipped'] += 1
                continue
            if result.get('error'):
                message = {'original_not_found': '未找到对应原件，无法补全；已保留原有片段。',
                           'original_integrity_failed': '原件校验未通过，无法补全；已保留原有片段。'}.get(
                               result['error'], '原件仍已保存，片段补全失败；已保留原有片段。')
                for record in matches:
                    record['chunkRepair'] = {'version': CHUNK_VERSION, 'status': 'failed',
                                             'attemptedAt': now, 'code': result['error'],
                                             'message': message}
                counts['failed'] += 1
            else:
                chunks = result['chunks']
                record = matches[0]
                audits = [audit for audit in ((state.get('PROJECTS') or {}).get(key, {}).get('kbUploads') or [])
                          if isinstance(audit, dict) and audit.get('originalId') == original_id]
                for chunk in chunks:
                    chunk.update(projectKey=key, account=record.get('account', ''), ts=record.get('ts', now),
                                 originalSha256=result['sha256'])
                    if audits:
                        chunk.update(origin='admin', nature='support', materialId=original_id)
                current = state.setdefault('KB_FILE_CHUNKS', {}).setdefault(key, [])
                state['KB_FILE_CHUNKS'][key] = [chunk for chunk in current
                                                if not isinstance(chunk, dict) or chunk.get('originalId') != original_id] + chunks
                for record in matches:
                    record.update(chunkVersion=CHUNK_VERSION, chunks=len(chunks),
                                  originalSha256=result['sha256'],
                                  chunkRepair={'version': CHUNK_VERSION, 'status': 'ready', 'completedAt': now})
                for audit in audits:
                    audit['chunks'] = len(chunks)
                counts['repaired'] += 1
            changed = True
        if changed and not session.write(json.dumps(state, ensure_ascii=False)):
            raise OSError('upload repair completion not committed')
    return counts


def repair_legacy_uploads(session_factory, parser, *, batch_size=4, retry_failed=False, now_ms=None):
    """Repair at most one small batch. Explicit retry_failed retries prior errors."""
    if type(batch_size) is not int or not 1 <= batch_size <= 8:
        raise ValueError('repair batch size must be between one and eight')
    now = int(time.time() * 1000) if now_ms is None else now_ms
    candidates, waiting = _claim(session_factory, batch_size, now, retry_failed)
    counts = {'claimed': len(candidates), 'waiting': waiting, 'repaired': 0, 'failed': 0, 'skipped': 0}
    if candidates:
        results = [_extract(item, parser) for item in candidates]
        finished = int(time.time() * 1000) if now_ms is None else now_ms
        counts.update(_finish(session_factory, candidates, results, finished))
    return counts


def start_legacy_upload_repair(session_factory, parser):
    """Start one bounded-batch background upgrade per web process; no AI calls."""
    global _worker
    with _worker_lock:
        if _worker is not None and _worker.is_alive():
            return _worker

        def run():
            while True:
                try:
                    counts = repair_legacy_uploads(session_factory, parser)
                    if counts['claimed']:
                        print(json.dumps({'upload_repair': counts}), flush=True)
                        continue
                    if counts['waiting']:
                        time.sleep(30)
                        continue
                except Exception:
                    print('{"upload_repair":"storage_unavailable"}', flush=True)
                return

        _worker = threading.Thread(target=run, name='legacy-upload-repair', daemon=True)
        _worker.start()
        return _worker
