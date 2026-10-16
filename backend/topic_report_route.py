"""Authenticated, bounded two-stage report execution and SSE contract."""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import uuid
from urllib.parse import urlsplit

from .auth import AuthError, require_session
from .access_control import scoped_sync_view
from .auth_routes import error_response
from .evidence_grounding import validate_confirmations
from .topic_evidence import topic_report_context
from .topic_research import research_topic, validate_report
from .topic_reports import build_report, TopicReportError


def serve_topic_report(handler, body, *, read_state, complete, audit,
                       research=research_topic, clock=time.monotonic):
    """No source or model error can produce a successful finish event."""
    mode = body.get('mode', 'full')
    phase = 1 if mode == 'draft' else 2
    client_fp = body.get('clientMaterialFingerprint', '')
    try:
        if mode not in ('draft', 'full'):
            raise AuthError(400, 'invalid_report_mode', '报告阶段无效')
        if client_fp and (not isinstance(client_fp, str) or not re.fullmatch(r'[a-f0-9]{64}', client_fp)):
            raise AuthError(400, 'invalid_material_fingerprint', '材料版本标识无效')
        context = topic_report_context(body, handler._scoped_state)
        if context['reportRequestId'] and body.get('reportRequestId') != context['reportRequestId']:
            raise AuthError(409, 'report_changed', '请刷新当前报告版本后重试')
        if phase == 2:
            validate_confirmations(body, context)
        context['confirmations'] = body.get('confirmations') or []
    except AuthError as error:
        return error_response(handler, error)

    run_id, start = uuid.uuid4().hex, clock()
    stream, headers_sent = body.get('stream', True), False
    lock = threading.Lock()
    fingerprint = context['sourceFingerprint']
    record = {'runId': run_id, 'projectKey': context['projectKey'], 'topic': context['topic'],
              'city': context['city'], 'reportRequestId': context['reportRequestId'], 'mode': mode,
              'actor': handler._principal.get('user', ''), 'sourceFingerprint': fingerprint,
              'total_available': context['availableChunkCount'], 'total_chunks': len(context['chunks']),
              'selected_evidence_ids': [x['id'] for x in context['chunks']],
              'all_cites': [x.get('sourceFile') or x.get('cite', '') for x in context['chunks']]}

    def send(event):
        with lock:
            handler.wfile.write(('data: '+(event if isinstance(event, str) else json.dumps(event, ensure_ascii=False))+'\n\n').encode())
            handler.wfile.flush()

    def event(kind, **values):
        if stream:
            send(dict(type=kind, runId=run_id, fingerprint=fingerprint,
                      clientMaterialFingerprint=client_fp, **values))

    def progress(value):
        event('research.status', **value)

    def save_audit(outcome, **values):
        audit(dict(record, outcome=outcome, elapsed_ms=round((clock()-start)*1000), **values))

    try:
        if stream:
            handler.send_response(200)
            handler.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            handler.send_header('Cache-Control', 'no-store')
            handler.send_header('X-Accel-Buffering', 'no')
            handler.cors(); handler.end_headers(); headers_sent = True
        event('research.status', message='正在按当前产业读取原始材料并检索公开来源', stage='retrieval',
              local_source_count=len(context['chunks']))
        findings = research(context['city'], context['topic'], mode=mode,
                            basis=context['chunks'], questions=context['confirmations'], progress=progress)
        # Persist only bounded source/check metadata, never provider secrets.
        public_sources = findings.get('evidence') or []
        event('research.evidence', sources=public_sources,
              localSources=context['chunks'], researchStatus=findings.get('status'),
              queries=findings.get('queries', []), errors=findings.get('errors', []))
        audit_sources = []
        for row in public_sources:
            saved = {key: row.get(key) for key in ('id','url','title','quote','published_at','retrieved_at','source_id','origin_id','publisher_id','retrieval')}
            original = (findings.get('sources') or {}).get(row.get('source_id'), {})
            saved['fulltext_sha256'] = original.get('fulltext_sha256')
            audit_sources.append(saved)
        record.update(research_sources=audit_sources, public_source_count=len(public_sources),
                      research_queries=findings.get('queries', []),
                      research_errors=findings.get('errors', []),
                      source_urls=[x.get('url') for x in public_sources],
                      public_evidence_ids=[x.get('id') for x in public_sources])
        event('research.status', message='正在将原文事实与研判建议分开整理', stage='synthesis')
        report = build_report(context, findings, phase, complete)
        event('research.status', message='正在核对数字、原文条件和来源，并检查材料版本', stage='verification')
        # Check actual original excerpts, with one reference per source. No model
        # self-report, generic disclaimer or confirmation click counts as proof.
        factual_text = '\n'.join(x['quote'].replace('\n', ' ')+' ['+x['id']+']' for x in report['sources'])
        verification = validate_report(factual_text, findings, require_citations=False)
        if verification.get('issues') or any(c['support_status']=='unsupported' for c in verification.get('checks', [])):
            raise TopicReportError('evidence_validation_failed', '本次原文包含未通过条件或主张核验的内容，结果未保存，请补充来源后重试。')
        for source in report['sources']:
            checks = [c for c in verification.get('checks', []) if source['id'] in {s.get('evidence_id') for s in c.get('sources', [])}]
            source['support_status'] = ('cross_checked' if checks and all(c['support_status']=='cross_checked' for c in checks)
                                        else 'single_source' if checks else 'unverified')
        # Re-render to expose the verified status instead of promising it in advance.
        from .topic_reports import render_report
        by_id = {s['id']: s for s in report['sources']}
        findings['evidence'] = [by_id.get(s['id'], s) for s in findings['evidence']]
        report['text'], report['sources'] = render_report(report['plan'], context, findings, phase)

        # Material and access checks are performed against a fresh authoritative
        # snapshot immediately before any completed report leaves the server.
        live = read_state()
        principal = require_session(handler.headers, live, admin_config=handler._account_config())
        current = topic_report_context(body, scoped_sync_view(live, principal))
        if current['sourceFingerprint'] != fingerprint:
            raise AuthError(409, 'evidence_changed', '材料已更新，已停止保存旧材料的结果，请重新生成')
        if phase == 2:
            validate_confirmations(body, current)
        record.update(verification_checks=verification.get('checks', []), verification_issues=verification.get('issues', []), verification_status=verification['status'],
                      check_count=len(verification.get('checks', [])),
                      cross_checked_count=sum(c.get('support_status')=='cross_checked' for c in verification.get('checks', [])))
        metadata = {'sources': report['sources'], 'checks': verification.get('checks', []),
                    'issues': verification.get('issues', []), 'status': 'unreviewed', 'researchStatus': findings['status'],
                    'verificationStatus': verification['status'], 'fingerprint': fingerprint,
                    'clientMaterialFingerprint': client_fp, 'runId': run_id,
                    'queries': findings.get('queries', []), 'errors': findings.get('errors', [])}
        if stream:
            event('research.evidence', sources=report['sources'], checks=metadata['checks'],
                  verificationStatus=verification['status'], researchStatus=findings['status'])
            # Only source-projected text is streamed. There is no unverified
            # model prose briefly shown as factual content before validation.
            for block in report['text'].split('\n\n'):
                send({'choices': [{'delta': {'content': block+'\n\n'}}], 'runId': run_id})
            event('research.complete', **{k: v for k, v in metadata.items() if k not in ('runId','fingerprint','clientMaterialFingerprint')})
            send({'choices': [{'delta': {}, 'finish_reason': 'stop'}], 'runId': run_id})
            send('[DONE]')
        else:
            handler.send_response(200); handler.send_header('Content-Type', 'application/json; charset=utf-8')
            handler.send_header('Cache-Control', 'no-store'); handler.cors(); handler.end_headers(); headers_sent=True
            handler.wfile.write(json.dumps({'choices': [{'message': {'content': report['text']}, 'finish_reason': 'stop'}],
                                            'research': metadata, 'runId': run_id}, ensure_ascii=False).encode())
        save_audit('completed', finish_reason='stop')
    except (BrokenPipeError, ConnectionResetError):
        save_audit('client_disconnected')
    except Exception as error:
        if isinstance(error, AuthError):
            code, message, status = error.code, error.message, error.status
        elif isinstance(error, TopicReportError):
            code, message, status = error.code, error.message, 422
        else:
            code, message, status = 'report_generation_failed', '本次调研或报告整理未完成，已有报告已保留，请重试。', 502
        save_audit('incomplete', finish_reason=code, error_code=code)
        if stream and headers_sent:
            try:
                send({'error': {'code': code, 'message': message}, 'runId': run_id,
                      'choices': [{'delta': {}, 'finish_reason': code}]})
            except (BrokenPipeError, ConnectionResetError):
                pass
        elif not headers_sent:
            error_response(handler, AuthError(status, code, message))
