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


def _contract_issue(error):
    """Reduce internal validator messages to static, non-content issue codes."""
    message = error.lower() if isinstance(error, str) else ''
    if 'line count' in message or 'min_lines' in message:
        return 'line_floor'
    if 'repeated filler' in message:
        return 'repeated_lines'
    if message.startswith(('invalid source url', 'url ')):
        return 'url_policy'
    if 'distinct source url' in message:
        return 'evidence_floor'
    if message.startswith('evidence[') or "'evidence'" in message:
        return 'evidence_structure'
    if 'direction' in message and not message.startswith('fact_check'):
        return 'directions'
    if 'candidate pool' in message or 'final companies' in message:
        return 'company_floor'
    if message.startswith('enterprises_'):
        return 'company_grounding'
    if message.startswith('fact_check'):
        return 'check_floor' if (' < ' in message or 'coverage' in message) else 'check_grounding'
    if 'duplicate fact check' in message:
        return 'check_grounding'
    if message.startswith('scoring'):
        return 'scores'
    return 'other_contract'


def _provider_issue(error):
    # No substring of the exception itself leaves this process. Even parse
    # errors may include raw model text or upstream response material.
    message = str(error).lower()
    if message == 'part line floor not met':
        return 'line_floor'
    if message == 'part contains repeated filler':
        return 'repeated_lines'
    if message == 'part source url policy failed':
        return 'url_policy'
    if message.startswith('prior context for stage'):
        return 'prior_context_bound'
    if message.startswith(('model output is not json', 'model json unparseable')) or 'non-object json' in message:
        return 'json_parse'
    if message.startswith(('upstream chat output incomplete', 'upstream chat response missing text content', 'model returned empty output')) or "missing non-empty 'text'" in message:
        return 'incomplete_output'
    if message.startswith(('direction', 'industry direction')):
        return 'directions'
    return 'other_provider'


def _part_metrics(value):
    """Count structural defects without returning any report/source content."""
    from . import full_contract
    value = value if isinstance(value, dict) else {}
    text = value.get('text') if isinstance(value.get('text'), str) else ''
    metadata = value.get('metadata') if isinstance(value.get('metadata'), dict) else {}
    evidence = metadata.get('evidence') if isinstance(metadata.get('evidence'), list) else []
    distinct, non_https, empty_excerpt = set(), 0, 0
    for item in evidence:
        if not isinstance(item, dict):
            continue
        url = item.get('url')
        canonical = full_contract.canonical_url(url)
        if canonical:
            distinct.add(canonical)
        normalized = full_contract.normalize_url(url)
        if not normalized or normalized[0] != 'https':
            non_https += 1
        excerpt = item.get('excerpt')
        if not isinstance(excerpt, str) or not excerpt.strip() or excerpt.strip() == (url.strip() if isinstance(url, str) else ''):
            empty_excerpt += 1
    unsafe = 0
    for url in full_contract.extract_urls(text):
        normalized = full_contract.normalize_url(url)
        if normalized is None:
            unsafe += 1
            continue
        scheme, host, path = normalized
        if (scheme != 'https' or full_contract._is_private_or_local_host(host)
                or full_contract._is_placeholder_host(host)
                or ('gov.cn' in path and not full_contract.is_government_host(host))):
            unsafe += 1
    return {
        'line_count': sum(bool(line.strip()) for line in text.splitlines()),
        'evidence_count': len(distinct),
        'non_https_evidence_count': non_https,
        'empty_excerpt_count': empty_excerpt,
        'unsafe_text_url_count': unsafe,
    }


def _safe_provider_metrics(error):
    """Accept only bounded primitive counts; reject content and custom types."""
    try:
        metrics = getattr(error, 'safe_metrics', None)
    except Exception:
        return {}
    if type(metrics) is not dict:
        return {}
    limits = {'line_count': 10_000, 'min_lines': 10_000,
              'text_chars': MAX_RESULT_BYTES, 'literal_newline_count': 10_000}
    return {field: metrics[field] for field, limit in limits.items()
            if field in metrics and type(metrics[field]) is int and 0 <= metrics[field] <= limit}


def _failure_diagnostics(error, phase, stage, part, definition=None, value=None, errors=None, current=None):
    # The stage and part come from the persisted static pipeline definition,
    # not from report content or an exception message.
    allowed_classes = {'ValueError', 'KeyError', 'TypeError', 'PermissionError', 'TimeoutError',
                       'FullProviderError', 'ProviderError', 'HTTPError', 'URLError',
                       'OSError', 'RuntimeError', 'JSONDecodeError'}
    exception_class = type(error).__name__
    diagnostic = {'phase': phase, 'stage': stage, 'part': part,
                  'exception_class': exception_class if exception_class in allowed_classes else 'Exception'}
    if phase in {'stage_validation', 'bundle_validation'}:
        errors = errors if isinstance(errors, list) else []
        diagnostic.update(_part_metrics(value))
        diagnostic['min_lines'] = int((definition or {}).get('min_lines', 0))
        diagnostic['error_count'] = len(errors)
        diagnostic['issues'] = sorted({_contract_issue(item) for item in errors}) or ['other_contract']
        if current is not None:
            diagnostic['parts'] = [dict(part_index=index, **_part_metrics(item))
                                   for index, item in enumerate(current)]
    elif phase == 'provider':
        diagnostic['issues'] = [_provider_issue(error)]
        diagnostic.update(_safe_provider_metrics(error))
    elif phase == 'output':
        diagnostic['issues'] = ['output_bound'] if isinstance(error, ValueError) and str(error) == 'provider output exceeds bound' else ['output_serialization']
    else:
        diagnostic['issues'] = ['context']
    return diagnostic


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


def _child(provider, job, db_path, artifact_root, pipe, parent_pid, contract, prepared_parts=None):
    stop = threading.Event()
    threading.Thread(target=_child_guard, args=(parent_pid, job['deadline'], stop), daemon=True).start()
    phase, stage, part = 'context', job['stage'], job['part']
    definition = value = errors = current = None
    try:
        if contract is None:
            from . import full_contract as contract
        validation_options = {'synthetic': job['synthetic']}
        if job.get('mode') == 'deep':
            validation_options['mode'] = 'deep'
        if prepared_parts is None:
            import sqlite3
            import urllib.parse
            with sqlite3.connect('file:' + urllib.parse.quote(db_path) + '?mode=ro', uri=True) as c:
                rows = c.execute("SELECT stage,output FROM full_steps WHERE report_id=? AND status='done' AND stage!='__bundle__' ORDER BY ordinal", (job['report_id'],)).fetchall()
            parts = {}
            for stage, raw in rows:
                parts.setdefault(stage, []).append(json.loads(raw))
        else:
            parts = prepared_parts
        prior, outputs = _context(parts, job, contract)
        if job['stage'] == '__bundle__':
            if artifact_root is None:
                raise PermissionError('artifact storage is not configured')
            for definition in job['definition']:
                phase, stage = 'bundle_validation', definition['id']
                value = outputs.get(definition['filename'])
                errors = (contract.validate(definition['id'], value['text'], value['metadata'], **validation_options)
                          if value else ['text must be a non-empty string'])
                if errors:
                    raise ValueError('full contract failed')
            phase = 'output'
            from .full_artifacts import build_bundle
            result = {'manifest': build_bundle(artifact_root, job['report_id'], job['city'], outputs, job['synthetic'])}
        else:
            safe_job = {k: job[k] for k in ('city', 'province', 'synthetic')}
            safe_job['id'] = job['report_id']
            safe_job['mode'] = job.get('mode', 'standard')
            phase = 'provider'
            result = provider.run_part(job['stage'], job['part'], safe_job, prior)
            definition = next(s for s in job['definition'] if s['id'] == job['stage'])
            current = parts.get(job['stage'], []) + [result]
            if len(current) == len(definition['parts']):
                phase = 'stage_validation'
                value = contract.assemble(job['stage'], current)
                errors = contract.validate(job['stage'], value['text'], value['metadata'], **validation_options)
                if errors:
                    raise ValueError('stage contract failed')
        phase = 'output'
        data = json.dumps({'ok': True, 'result': result}, ensure_ascii=False, allow_nan=False).encode()
        if len(data) > MAX_RESULT_BYTES:
            raise ValueError('provider output exceeds bound')
        pipe.send_bytes(data)
    except BaseException as error:
        try:
            diagnostic = _failure_diagnostics(error, phase, stage, part, definition, value, errors, current)
            pipe.send_bytes(json.dumps({'ok': False, 'code': _error_code(error), 'diagnostics': diagnostic}).encode())
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


def run_once(store, provider, *, ttl=120, timeout=180, synthetic=True, contract=None, stop_job=None):
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
    process = None
    envelope = None
    code = None
    started = False
    inputs_ready = False
    next_heartbeat = time.monotonic()
    try:
        if stop_job is not None and stop_job(job):
            store.cancel(job['tenant'], rid)
            return {'id': rid, 'status': 'cancelled'}
        # Only the live provider opts into this upgrade repair. The store
        # independently checks archived checkpoint bytes under the current
        # lease; no child or client chooses which work to invalidate.
        if (not synthetic and getattr(provider, 'repair_invalid_checkpoints', False)
                and store.repair_invalid_checkpoints(sid, token)):
            return {'id': rid, 'status': 'checkpoint_repaired', 'stage': job['stage']}
        parts = store.worker_parts(rid) if hasattr(store, 'worker_parts') else None
        inputs_ready = True
        process = ctx.Process(target=_child, args=(provider, job, store.path, store.artifact_root, writer, os.getpid(), contract, parts))
        process.start()
        started = True
        writer.close()
        while True:
            remaining = job['deadline'] - store.clock()
            if remaining <= 0:
                code = 'timeout'
                break
            if time.monotonic() >= next_heartbeat:
                if stop_job is not None and stop_job(job):
                    store.cancel(job['tenant'], rid)
                    code = 'lost_lease'
                    break
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
        code = 'upstream' if not inputs_ready else ('configuration' if not started else 'worker_crash')
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
    result = {'id': rid, 'status': state['status'], 'code': state['failure_code'] or code}
    if envelope and not envelope.get('ok') and isinstance(envelope.get('diagnostics'), dict):
        result['diagnostics'] = envelope['diagnostics']
    return result


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
