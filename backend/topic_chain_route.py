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


def _keep_existing_chain(report, topic, identity, result):
    """A failed model retry must not replace a richer current saved graph."""
    if (result.get('generation') or {}).get('mode') != 'source_only':
        return False
    def value(field):
        table = report.get(field)
        return table.get(topic) if isinstance(table, dict) else None

    meta = value('chainEvidenceByTopic')
    if (not isinstance(meta, dict) or meta.get('contract') != 'source-bound-chain-v2'
            or meta.get('scope') != 'current-topic-v2' or meta.get('topic') != topic
            or not identity_matches(meta.get('sourceIdentity'), identity)):
        return False

    def nodes(chain, extra):
        return [node for group in chain if isinstance(group, dict)
                and isinstance(group.get('nodes'), list)
                for node in group['nodes'] if isinstance(node, dict)] + [
                    node for node in extra if isinstance(node, dict)]

    old_chain = value('chainByTopic')
    old_extra = value('chainUnclassifiedByTopic') or []
    if not isinstance(old_chain, list) or not isinstance(old_extra, list):
        return False
    previous = nodes(old_chain, old_extra)
    incoming = nodes(result.get('chain', []), result.get('unclassified', []))
    def identities(items):
        return {node.get('id') or node.get('name') for node in items
                if isinstance(node.get('id') or node.get('name'), str)}
    rated = any(isinstance(node.get('assessment'), dict)
                and isinstance(node['assessment'].get('judgment'), dict)
                and node['assessment']['judgment'].get('level') in ('strong', 'mid', 'weak')
                for node in previous)
    return (len(previous) > len(incoming) or rated
            or not identities(previous).issubset(identities(incoming)))


def serve_topic_chain(handler, body, *, complete, audit, research=research_topic,
                      build=None, assessment_builder=None, reasoning_builder=None,
                      clock=time.monotonic, heartbeat_seconds=15, model_timeout_seconds=65,
                      package_loader=None):
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
        context = dict(context, _prefer_assessment=True, _parallel_assessment=True)
    except AuthError as error:
        return error_response(handler, error)

    run_id, started = uuid.uuid4().hex, clock()
    stream, headers_sent, persisted = body.get('stream', True), False, False
    lock = threading.Lock()
    heartbeat_stop = threading.Event()
    heartbeat_thread = None
    generation_errors = []
    model_timed_out = False

    def bounded_complete(*args):
        nonlocal model_timed_out
        # Production model requests have a 65 s transport timeout. Stop
        # starting optional calls while there is still enough time to finish
        # that request, validate originals and save before the client deadline.
        if model_timed_out or clock() - started >= 355:
            if not generation_errors:
                generation_errors.append({'code': 'chain_model_budget_exhausted',
                    'message': '本轮模型整理已达到时间预算，保留已核验的原文及已完成结果。'})
            raise TopicChainError('chain_model_budget_exhausted', '本轮模型整理已达到时间预算。')
        finished, outcome = threading.Event(), {}
        def request():
            try:
                outcome['result'] = complete(*args)
            except BaseException as error:
                outcome['error'] = error
            finally:
                finished.set()
        # Socket timeouts reset on each received chunk. Bound the complete
        # model call as well, so a slow provider cannot hold the graph request
        # beyond its wall-clock budget. Late output is never saved or rated.
        threading.Thread(target=request, name='chain-model-request', daemon=True).start()
        if not finished.wait(min(model_timeout_seconds, max(0, 420 - (clock() - started)))):
            model_timed_out = True
            generation_errors.append({'code': 'chain_model_timeout',
                'message': '本轮模型响应超时，已停止后续模型调用，仅保留已完成的原文整理。'})
            raise TopicChainError('chain_model_timeout', '本轮模型响应超时。')
        if 'error' in outcome:
            raise outcome['error']
        return outcome.get('result')

    def heartbeat():
        while not heartbeat_stop.wait(heartbeat_seconds):
            try:
                # SSE comments preserve the connection without reporting new
                # research progress or triggering a frontend re-render.
                with lock:
                    if heartbeat_stop.is_set():
                        return
                    handler.wfile.write(b': keep-alive\n\n')
                    handler.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                heartbeat_stop.set()

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
            heartbeat_thread = threading.Thread(target=heartbeat, name='chain-stream-heartbeat', daemon=True)
            heartbeat_thread.start()
        event('research.status', stage='retrieval', message=('正在读取当前城市材料包中的产业链原文'
              if package_loader else '正在分别检索上游、中游和下游的公开原文'))
        try:
            if package_loader is not None:
                findings = package_loader(dict(context, _researchMode='chain'), handler._scoped_state)
            else:
                findings = research(context['city'], topic, mode='chain', basis=context['chunks'], deadline_seconds=80,
                                    progress=lambda progress: event('research.status', **progress))
        except TopicReportError:
            raise
        except Exception:
            findings = {'city': context['city'], 'topic': topic, 'status': 'unavailable',
                        'evidence': [], 'sources': {}, 'queries': [],
                        'errors': [{'code': 'chain_research_failed',
                                    'message': '本轮公开检索未完成；如有已核验归档原文，将明确按归档资料整理。'}]}
        # Validate incoming retrieval before enrichment. A valid archive must
        # not hide a corrupted live source behind an otherwise empty graph.
        for row in findings.get('evidence', []):
            original = (findings.get('sources') or {}).get(row.get('source_id')) or {}
            fulltext, quote = original.get('fulltext'), row.get('quote')
            if (not isinstance(fulltext, str) or not isinstance(quote, str) or not quote.strip()
                    or row.get('url') != original.get('url')
                    or original.get('fulltext_sha256') != hashlib.sha256(fulltext.encode()).hexdigest()
                    or re.sub(r'\s+', '', quote) not in re.sub(r'\s+', '', fulltext)):
                raise TopicReportError('evidence_validation_failed', '图谱原文与检索归档不一致，结果未保存')
        from .public_research import enrich_public_research
        if package_loader is None:
            findings = enrich_public_research(findings, context['city'], topic)
        event('research.status', stage='classification', message='正在核对原文、环节归类和规划状态')
        result = build(context, findings, bounded_complete)
        generation = result.get('generation') or {}
        source_only = generation.get('mode') == 'source_only'
        from .chain_assessment import build_assessment, unavailable_assessment
        event('research.status', stage='assessment', message=('模型整理未完成，本轮只保留原文环节，不判定薄弱程度'
              if source_only else '正在逐环节研判已有基础、培育方向与补链短板'))
        try:
            if source_only:
                raise TopicChainError('chain_model_selection_unavailable', '本轮仅完成原文环节整理。')
            assessment_result = (assessment_builder or build_assessment)(context, findings, result, bounded_complete)
        except Exception:
            # A failed evaluation must remain visibly unevaluated; it must not
            # turn into a weak rating or discard a valid source-bound diagram.
            assessment_result = {'assessment': unavailable_assessment(context),
                                 'node_assessments': {}, 'sources': []}
        from .chain_node_research import select_node_targets, merge_node_research
        # Search missing comparisons, not every already-supported node. Leave
        # most of the request window for the actual comparison and review.
        targets = select_node_targets(result, assessment_result, limit=12, include_supported=False)
        batches = ([targets[i:i+6] for i in range(0, len(targets), 6)]
                   if package_loader is None else [])
        for batch_index, batch in enumerate(batches):
            budget = min(20, max(0, 140 - (clock() - started)))
            if budget < 5:
                remaining = [node for pending in batches[batch_index:] for node in pending]
                findings = merge_node_research(findings, {
                    'city': context['city'], 'topic': topic, 'status': 'pending',
                    'errors': [{'code': 'node_research_budget_exhausted',
                                'message': '补查时间预算已用尽，剩余环节尚未完成检索。'}]}, remaining)
                break
            event('research.status', stage='node_research', message=f'正在核验实际供给与约束：第{batch_index+1}/{len(batches)}组')
            try:
                extra = research(context['city'], topic, mode='chain',
                                 node_targets=[node['name'] for node in batch], deadline_seconds=budget,
                                 progress=lambda progress: event('research.status', **progress))
                findings = merge_node_research(findings, extra, batch)
                # Supplemental originals can fill a previously empty lane.
                # Reuse the strict literal fallback; do not fabricate nodes
                # or leave new evidence disconnected from the displayed map.
                if result.get('coverage', {}).get('missing_lanes'):
                    from .topic_chain import _literal_fallback, _retained_selection, normalize_chain_plan
                    additions = _literal_fallback(context, findings, result['coverage']['missing_lanes'])
                    if additions:
                        methods = {n['id']: n.get('extraction_method') for g in result['chain']
                                   for n in g['nodes'] if n.get('extraction_method')}
                        result = normalize_chain_plan({'nodes': _retained_selection(result) + additions}, findings, context)
                        added = {n['name'] for n in additions}
                        for group in result['chain']:
                            for node in group['nodes']:
                                if node['name'] in added:
                                    node['extraction_method'] = 'supplemental_literal'
                                elif node['id'] in methods:
                                    node['extraction_method'] = methods[node['id']]
            except Exception:
                # An optional public supplement never discards the original graph.
                findings = merge_node_research(findings, {
                    'city': context['city'], 'topic': topic, 'status': 'unavailable',
                    'errors': [{'code': 'node_research_failed',
                                'message': '本组补查未完成，保留此前已取得的原文。'}]}, batch)
        # Every usable original can be inspected even if it does not support a
        # strength comparison. This also reconnects later research to existing
        # nodes when all three lanes were already populated.
        from .chain_facts import attach_source_statements
        attach_source_statements(result, findings, context)
        event('research.status', stage='reasoning', message=('正在保存原文及未完成复核的状态'
              if source_only else '正在对比本地基础与产业要求，并交叉核对补链判断'))
        try:
            if source_only:
                raise TopicChainError('chain_model_selection_unavailable', '本轮未完成薄弱程度复核。')
            from .chain_weakness import build_weakness
            reasoned = (reasoning_builder or build_weakness)(context, findings, result, assessment_result, bounded_complete)
            if reasoned.get('judgment'):
                assessment_result['assessment']['judgment'] = reasoned['judgment']
            for node_id, judgment in (reasoned.get('node_judgments') or {}).items():
                assessment_result.setdefault('node_assessments', {}).setdefault(node_id, unavailable_assessment(context))['judgment'] = judgment
            assessment_result['sources'] = list(assessment_result.get('sources') or []) + list(reasoned.get('sources') or [])
            assessment_result['review_diagnostics'] = reasoned.get('review_diagnostics', [])
        except Exception:
            from .chain_weakness import unknown
            assessment_result['assessment']['judgment'] = unknown('本次实际薄弱程度复核未完成，保留事实材料。')
            for node in [n for group in result['chain'] for n in group['nodes']] + result.get('unclassified', []):
                assessment_result.setdefault('node_assessments', {}).setdefault(node['id'], unavailable_assessment(context))['judgment'] = unknown()
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
            if _keep_existing_chain(rs, topic, current_identity, result):
                raise AuthError(409, 'chain_existing_result_preserved',
                                '本轮模型复核未完成，新结果未完整保留现有环节或评价，已保留原图谱。')
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
                    'queries': findings.get('queries', []),
                    'errors': list(findings.get('errors') or []) + list(generation.get('errors') or []) + generation_errors,
                    'generation': generation,
                    'taxonomy': result.get('taxonomy', {}), 'coverage': result.get('coverage', {}),
                    'assessment': result['assessment'],
                    'reviewDiagnostics': assessment_result.get('review_diagnostics', []),
                    'nodeResearch': findings.get('node_research', {}),
                    'publicResearch': findings.get('public_research', {}),
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
        heartbeat_stop.set()
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
        heartbeat_stop.set()
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
    finally:
        heartbeat_stop.set()
        if heartbeat_thread is not None:
            heartbeat_thread.join(timeout=0.2)
