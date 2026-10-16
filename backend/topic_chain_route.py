"""Research and atomically persist source-bound industrial chain diagrams."""
from __future__ import annotations

import copy
import hashlib
import json
import re
import threading
import time
import uuid

from .auth import AuthError, require_session
from .auth_routes import error_response
from .access_control import authorize_project, scoped_sync_view
from .chain_identity import (chain_input_identity, chain_input_fingerprint,
                             chain_report_text, identity_json, identity_matches)
from .topic_evidence import topic_report_context
from .topic_research import research_topic, validate_report
from .topic_reports import TopicReportError
from .topic_chain import TopicChainError


def serve_topic_chain(handler, body, *, complete, audit, research=research_topic,
                      build=None, assessment_builder=None, clock=time.monotonic):
    if build is None:
        from .topic_chain import build_chain
        build = build_chain
    try:
        context = topic_report_context(body, handler._scoped_state)
        key, topic = context['projectKey'], context['topic']
        if context['reportRequestId'] and body.get('reportRequestId') != context['reportRequestId']:
            raise AuthError(409, 'report_changed', '报告版本已更新，请刷新后重试')
        report_text = chain_report_text(handler._scoped_state, key, topic)
        if not isinstance(report_text, str) or not report_text.strip():
            raise AuthError(409, 'report_required', '请先生成当前方向的产业报告')
        identity = chain_input_identity(handler._scoped_state, key, topic)
        if 'sourceIdentity' in body and not identity_matches(body['sourceIdentity'], identity):
            raise AuthError(409, 'evidence_changed', '材料已更新，请刷新后重新生成图谱')
        fingerprint = chain_input_fingerprint(context, identity)
    except AuthError as error:
        return error_response(handler, error)

    run_id, started = uuid.uuid4().hex, clock()
    stream, headers_sent, persisted = body.get('stream', True), False, False
    lock = threading.Lock()

    def send(value):
        with lock:
            handler.wfile.write(('data: '+(value if isinstance(value, str) else
                                json.dumps(value, ensure_ascii=False))+'\n\n').encode())
            handler.wfile.flush()

    def event(kind, **values):
        if stream:
            send(dict(type=kind, runId=run_id, **values))

    def record(outcome, **values):
        audit(dict(runId=run_id, projectKey=key, topic=topic, purpose='chain_map',
                   actor=handler._principal.get('user', ''), outcome=outcome,
                   elapsed_ms=round((clock()-started)*1000), inputFingerprint=fingerprint,
                   persisted=persisted, **values))

    try:
        if stream:
            handler.send_response(200)
            handler.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            handler.send_header('Cache-Control', 'no-store')
            handler.send_header('X-Accel-Buffering', 'no')
            handler.cors(); handler.end_headers(); headers_sent = True
        event('research.status', stage='retrieval', message='正在分别检索上游、中游和下游的公开原文')
        findings = research(context['city'], topic, mode='chain', basis=context['chunks'],
                            progress=lambda progress: event('research.status', **progress))
        event('research.status', stage='classification', message='正在核对原文、环节归类和规划状态')
        result = build(context, findings, complete)
        from .chain_assessment import build_assessment, unavailable_assessment
        event('research.status', stage='assessment', message='正在逐环节研判已有基础、培育方向与补链短板')
        try:
            assessment_result = (assessment_builder or build_assessment)(context, findings, result, complete)
        except Exception:
            # A failed evaluation must remain visibly unevaluated; it must not
            # turn into a weak rating or discard a valid source-bound diagram.
            assessment_result = {'assessment': unavailable_assessment(context),
                                 'node_assessments': {}, 'sources': []}
        result['assessment'] = assessment_result['assessment']
        node_assessments = assessment_result.get('node_assessments') or {}
        for node in [n for group in result['chain'] for n in group['nodes']] + result.get('unclassified', []):
            if node.get('id') in node_assessments:
                node['assessment'] = node_assessments[node['id']]
        combined_sources = {row['id']: row for row in result.get('sources', [])}
        for row in assessment_result.get('sources', []):
            combined_sources[row['id']] = row
        result['sources'] = list(combined_sources.values())
        # Validate every quote, including qualitative statements that do not
        # trigger the numeric/policy claim checker below.
        retrieved = {row.get('id'): row for row in findings.get('evidence', [])}
        for row in result.get('sources', []):
            original = (findings.get('sources') or {}).get(row.get('source_id')) or {}
            source = retrieved.get(row.get('id')) or {}
            fulltext, quote = original.get('fulltext'), row.get('quote')
            if (not isinstance(fulltext, str) or not isinstance(quote, str) or not quote.strip()
                    or row.get('url') != original.get('url') or row.get('url') != source.get('url')
                    or quote != source.get('quote')
                    or original.get('fulltext_sha256') != hashlib.sha256(fulltext.encode()).hexdigest()
                    or re.sub(r'\s+', '', quote) not in re.sub(r'\s+', '', fulltext)):
                raise TopicReportError('evidence_validation_failed', '图谱原文与检索归档不一致，结果未保存')
        factual_text = '\n'.join(row['quote'].replace('\n', ' ')+' ['+row['id']+']'
                                 for row in result.get('sources', []))
        verification = validate_report(factual_text, findings, require_citations=False)
        if verification.get('issues') or any(row['support_status'] == 'unsupported'
                                             for row in verification.get('checks', [])):
            raise TopicReportError('evidence_validation_failed', '图谱原文未通过核对，请补充来源后重试')
        # Do not upgrade node status from archive matching or model confidence.
        # A source quote is a traceable record, not a finding about local strength.
        status = result.get('status', 'empty')
        if status not in ('ready', 'partial', 'empty'):
            raise TopicReportError('invalid_chain_status', '图谱结构未完成，请重试')
        with handler._account_session() as session:
            live = json.loads(session.read())
            principal = require_session(handler.headers, live, admin_config=handler._account_config())
            authorize_project(key, live, principal)
            scoped = scoped_sync_view(live, principal)
            current = topic_report_context(body, scoped)
            current_identity = chain_input_identity(scoped, key, topic)
            if chain_input_fingerprint(current, current_identity) != fingerprint:
                raise AuthError(409, 'evidence_changed', '生成期间材料或报告已更新，旧图谱未保存，请重新生成')
            rs = live.setdefault('REPORTSTATE', {}).setdefault(key, {})
            previous_map = rs.get('chainEvidenceByTopic')
            previous = previous_map.get(topic) if isinstance(previous_map, dict) else {}
            previous_time = previous.get('generatedAt') if isinstance(previous, dict) else None
            now_ms = int(time.time()*1000)
            if type(previous_time) is not int or not 0 < previous_time <= now_ms + 300000:
                previous_time = 0
            generated = max(now_ms, previous_time + 1)
            meta = {'contract': 'source-bound-chain-v2', 'scope': 'current-topic-v2',
                    'topic': topic, 'requestId': current['reportRequestId'],
                    'reportText': report_text, 'sourceIdentity': identity_json(current_identity),
                    'inputFingerprint': fingerprint, 'generatedAt': generated, 'runId': run_id,
                    'sources': result.get('sources', []), 'checks': verification.get('checks', []),
                    'verificationStatus': 'unreviewed', 'researchStatus': findings.get('status'),
                    'queries': findings.get('queries', []), 'errors': findings.get('errors', []),
                    'taxonomy': result.get('taxonomy', {}), 'coverage': result.get('coverage', {}),
                    'assessment': result['assessment'],
                    'edges': []}
            # Authoritative writes happen only here, after rechecking access and
            # every effective input while holding the normal state transaction.
            for field, value in [('chainByTopic', result['chain']),
                                 ('chainEvidenceByTopic', meta),
                                 ('chainStatusByTopic', status),
                                 ('chainUnclassifiedByTopic', result.get('unclassified', []))]:
                if not isinstance(rs.get(field), dict):
                    rs[field] = {}
                rs[field][topic] = copy.deepcopy(value)
            if not session.write(json.dumps(live, ensure_ascii=False)):
                raise AuthError(503, 'storage_unavailable', '图谱保存未成功，已有结果已保留，请重试')
            persisted = True
        payload = {'chain': result['chain'], 'unclassified': result.get('unclassified', []),
                   'evidence': meta, 'status': status, 'taxonomy': meta['taxonomy'],
                   'coverage': meta['coverage'], 'saved': True}
        payload['assessment'] = meta['assessment']
        if stream:
            event('chain.result', **payload)
            send({'choices': [{'delta': {'content': json.dumps(result['chain'], ensure_ascii=False)},
                               'finish_reason': 'stop'}], 'runId': run_id})
            send('[DONE]')
        else:
            handler.send_response(200); handler.send_header('Content-Type', 'application/json; charset=utf-8')
            handler.send_header('Cache-Control', 'no-store'); handler.cors(); handler.end_headers(); headers_sent = True
            handler.wfile.write(json.dumps(dict(payload, runId=run_id), ensure_ascii=False).encode())
        record('completed', status=status, node_count=sum(len(group['nodes']) for group in result['chain']),
               unclassified_count=len(result.get('unclassified', [])),
               assessment_level=result['assessment'].get('level'),
               assessment_state=result['assessment'].get('state'),
               source_ids=[row['id'] for row in result.get('sources', [])],
               source_hashes=[row.get('fulltext_sha256') for row in result.get('sources', [])])
    except (BrokenPipeError, ConnectionResetError):
        record('client_disconnected')
    except Exception as error:
        if isinstance(error, AuthError):
            code, message, http = error.code, error.message, error.status
        elif isinstance(error, (TopicReportError, TopicChainError)):
            code, message, http = error.code, error.message, 422
        else:
            code, message, http = 'chain_generation_failed', '本次图谱生成未完成，已有结果已保留，请重试', 502
        record('incomplete', error_code=code)
        if stream and headers_sent:
            try:
                send({'error': {'code': code, 'message': message}, 'runId': run_id,
                      'choices': [{'delta': {}, 'finish_reason': code}]})
            except (BrokenPipeError, ConnectionResetError):
                pass
        elif not headers_sent:
            error_response(handler, AuthError(http, code, message))
