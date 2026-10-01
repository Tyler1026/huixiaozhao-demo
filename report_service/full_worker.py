"""One fenced substep per claim, supervised in a disposable spawn process.

Process liveness never extends the absolute work deadline. Provider exceptions
are converted to safe machine codes. A failed report does not stop the worker.
"""
from __future__ import annotations

import json
import multiprocessing
import os
import threading
import time

MAX_RESULT_BYTES = 2_000_000


def _error_code(error):
    code = getattr(error, 'failure_code', None)
    if code in {'configuration', 'quality', 'upstream', 'rate_limit', 'timeout'}:
        return code
    if isinstance(error, PermissionError):
        return 'configuration'
    if isinstance(error, TimeoutError):
        return 'timeout'
    if isinstance(error, (ValueError, KeyError, TypeError)):
        return 'quality'
    status = getattr(error, 'code', None)
    if status in (401, 403):
        return 'configuration'
    if status == 429:
        return 'rate_limit'
    return 'upstream'


def _child_guard(parent_pid, deadline, stop):
    # If the supervisor is SIGKILLed, its finally block cannot run. The child
    # exits itself on reparenting, independently of the database heartbeat.
    while not stop.wait(.1):
        if os.getppid() != parent_pid:
            os._exit(71)
        if time.time() >= deadline:
            os._exit(72)


def _child(provider, job, db_path, artifact_root, pipe, parent_pid, contract):
    stop = threading.Event()
    threading.Thread(target=_child_guard, args=(parent_pid, job['deadline'], stop), daemon=True).start()
    try:
        if contract is None:
            from . import full_contract as contract
        import sqlite3
        import urllib.parse
        with sqlite3.connect('file:' + urllib.parse.quote(db_path) + '?mode=ro', uri=True) as c:
            rows = c.execute("SELECT stage,output FROM full_steps WHERE report_id=? AND status='done' AND stage!='__bundle__' ORDER BY ordinal", (job['report_id'],)).fetchall()
        parts = {}
        for stage, raw in rows:
            parts.setdefault(stage, []).append(json.loads(raw))
        prior, outputs = _context(parts, job, contract)
        if job['stage'] == '__bundle__':
            if artifact_root is None:
                raise PermissionError('artifact storage is not configured')
            for definition in job['definition']:
                value = outputs.get(definition['filename'])
                if not value or contract.validate(definition['id'], value['text'], value['metadata'], synthetic=job['synthetic']):
                    raise ValueError('full contract failed')
            from .full_artifacts import build_bundle
            result = {'manifest': build_bundle(artifact_root, job['report_id'], job['city'], outputs, job['synthetic'])}
        else:
            safe_job = {k: job[k] for k in ('city', 'province', 'synthetic')}
            safe_job['id'] = job['report_id']
            result = provider.run_part(job['stage'], job['part'], safe_job, prior)
            definition = next(s for s in job['definition'] if s['id'] == job['stage'])
            current = parts.get(job['stage'], []) + [result]
            if len(current) == len(definition['parts']):
                combined = contract.assemble(job['stage'], current)
                if contract.validate(job['stage'], combined['text'], combined['metadata'], synthetic=job['synthetic']):
                    raise ValueError('stage contract failed')
        data = json.dumps({'ok': True, 'result': result}, ensure_ascii=False, allow_nan=False).encode()
        if len(data) > MAX_RESULT_BYTES:
            raise ValueError('provider output exceeds bound')
        pipe.send_bytes(data)
    except BaseException as error:
        try:
            pipe.send_bytes(json.dumps({'ok': False, 'code': _error_code(error)}).encode())
        except (OSError, BrokenPipeError):
            pass
    finally:
        stop.set()
        pipe.close()


def _reap(process):
    if process.is_alive():
        process.terminate()
    process.join(timeout=.5)
    if process.is_alive():
        process.kill()
        process.join(timeout=1)
    if not process.is_alive():
        process.close()


def _context(parts, job, contract):
    prior, outputs = {}, {}
    for stage in job['definition']:
        values = parts.get(stage['id'], [])
        if not values:
            continue
        value = contract.assemble(stage['id'], values)
        # Expose complete preceding stages and the current stage's partial
        # content; the provider does not need to regenerate saved research.
        prior[stage['id']] = value
        if len(values) == len(stage['parts']):
            outputs[stage['filename']] = value
    return prior, outputs


def run_once(store, provider, *, ttl=120, timeout=180, synthetic=True, contract=None):
    job = store.claim(ttl=ttl, timeout=timeout, synthetic=synthetic)
    if job is None:
        return None
    sid, token = job['step_id'], job['token']
    rid = job['report_id']
    if job['synthetic'] != synthetic:
        store.fail_part(sid, token, 'configuration', retryable=False)
        return {'id': rid, 'status': 'failed', 'code': 'configuration'}
    ctx = multiprocessing.get_context('spawn')
    reader, writer = ctx.Pipe(duplex=False)
    process = ctx.Process(target=_child, args=(provider, job, store.path, store.artifact_root, writer, os.getpid(), contract))
    envelope = None
    code = None
    started = False
    next_heartbeat = time.monotonic()
    try:
        process.start()
        started = True
        writer.close()
        while True:
            remaining = job['deadline'] - store.clock()
            if remaining <= 0:
                code = 'timeout'
                break
            if time.monotonic() >= next_heartbeat:
                if not store.heartbeat(sid, token, ttl=ttl):
                    code = 'lost_lease'
                    break
                next_heartbeat = time.monotonic() + min(ttl / 4, 1)
            if reader.poll(min(.05, remaining)):
                try:
                    envelope = json.loads(reader.recv_bytes(MAX_RESULT_BYTES))
                except (EOFError, OSError, ValueError):
                    code = 'worker_crash'
                break
            if not process.is_alive():
                code = 'worker_crash'
                break
    except Exception:
        code = 'configuration' if not started else 'worker_crash'
    finally:
        writer.close()
        reader.close()
        if started:
            _reap(process)

    if code == 'lost_lease':
        return {'id': rid, 'status': 'lost_lease'}
    if envelope and not envelope.get('ok'):
        code = envelope.get('code', 'upstream')
    if not code and envelope:
        try:
            result = envelope['result']
            if job['stage'] == '__bundle__':
                if not store.complete(sid, token, result['manifest']):
                    code = 'artifact'
                else:
                    return {'id': rid, 'status': 'completed'}
            else:
                if store.finish_part(sid, token, result):
                    return {'id': rid, 'status': 'checkpoint', 'stage': job['stage'], 'part': job['part']}
                return {'id': rid, 'status': 'lost_lease'}
        except Exception as error:
            code = _error_code(error)
    code = code or 'worker_crash'
    store.fail_part(sid, token, code, retryable=code != 'configuration')
    # An absolute timeout expires the lease before fail_part. get() recovers it
    # transactionally, charging elapsed work and scheduling the bounded retry.
    state = store.get(job['tenant'], rid)
    return {'id': rid, 'status': state['status'], 'code': state['failure_code'] or code}


def run_loop(store, provider, *, max_steps=None, stop=None, poll=.5, stop_when_idle=False, **kwargs):
    processed = 0
    last = None
    while stop is None or not stop.is_set():
        if max_steps is not None and processed >= max_steps:
            break
        result = run_once(store, provider, **kwargs)
        if result is None:
            if stop_when_idle:
                break
            if stop is not None:
                stop.wait(poll)
            else:
                time.sleep(poll)
            continue
        processed += 1
        last = result
        # Includes failed/retry_wait/lost_lease: none terminate the service.
    return {'processed': processed, 'last': last}
