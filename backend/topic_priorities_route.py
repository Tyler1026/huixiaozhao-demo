"""Refresh actionable directions for a saved report without rewriting it."""
from __future__ import annotations

import copy
import hashlib
import json
import threading
import time
import uuid

from .access_control import authorize_project, scoped_sync_view
from .auth import AuthError, require_session
from .auth_routes import error_response, respond
from .chain_identity import chain_input_identity, chain_report_text, identity_json, identity_matches
from .topic_evidence import topic_report_context
from .topic_research import research_topic, validate_report
from .topic_reports import TopicReportError, evidence_catalog


def _saved_report(state, body):
    context = topic_report_context(body, state)
    key, topic = context['projectKey'], context['topic']
    if (state.get('PROJECTS') or {}).get(key, {}).get('isDemand'):
        raise AuthError(409, 'submitted_demand', '已提交需求保留原报告快照，请回到城市工作区更新研判方向')
    record = (state.get('REPORTSTATE') or {}).get(key) or {}
    text = chain_report_text(state, key, topic)
    phase = (record.get('phaseByTopic') or {}).get(topic)
    if phase is None and record.get('topic') == topic:
        phase = record.get('phase')
    if phase != 2 or not isinstance(text, str) or not text.strip():
        raise AuthError(409, 'report_required', '请先完成当前方向的产业报告')
    identity = chain_input_identity(state, key, topic)
    if not identity_matches(body.get('sourceIdentity'), identity):
        raise AuthError(409, 'evidence_changed', '报告或材料已更新，请刷新后重试')
    metadata = (record.get('researchByTopic') or {}).get(topic)
    if not identity_matches(body.get('reportMetadataIdentity'), metadata):
        raise AuthError(409, 'report_changed', '报告的来源或建议已更新，请刷新后重试')
    return context, text, identity, metadata


def _merge_directions(metadata, text, topic, result, findings, verification, run_id):
    """Keep old publication references intact; rename only new ID collisions."""
    saved = copy.deepcopy(metadata) if isinstance(metadata, dict) else {}
    sources = saved.get('sources')
    if not isinstance(sources, list):
        sources = []
    sources = copy.deepcopy(sources)
    by_id = {row.get('id'): row for row in sources if isinstance(row, dict)}
    catalog = evidence_catalog(findings)
    priorities = copy.deepcopy(result['plan'].get('analytical_priorities') or [])
    ids = list(dict.fromkeys(sid for row in priorities for sid in row.get('evidence_ids', [])))
    remap = {}
    for sid in ids:
        original = catalog.get(sid)
        if original is None:
            raise TopicReportError('evidence_validation_failed', '建议引用的原文不完整，已有报告已保留')
        source = {key: value for key, value in original.items() if not key.startswith('_')}
        target = sid
        existing = [row for row in sources if isinstance(row, dict) and row.get('id') == target]
        if any(any(row.get(field) != source.get(field) for field in ('url', 'quote')) for row in existing):
            target = 'dir_' + hashlib.sha256((source['url'] + '\0' + source['quote']).encode()).hexdigest()[:24]
            collision = by_id.get(target)
            if collision and any(collision.get(field) != source.get(field) for field in ('url', 'quote')):
                target = 'dir_' + hashlib.sha256((run_id + sid).encode()).hexdigest()[:24]
        remap[sid] = target
        if target not in by_id:
            source.update(id=target, label='', cited_in_report=False)
            matches = [check for check in verification.get('checks', [])
                       if sid in {row.get('evidence_id') for row in check.get('sources', [])}]
            source['support_status'] = ('cross_checked' if matches and all(
                row.get('support_status') == 'cross_checked' for row in matches)
                else 'single_source' if matches else 'unverified')
            sources.append(source)
            by_id[target] = source
    for row in priorities:
        for key, value in list(row.items()):
            if key.endswith('_ids') and isinstance(value, list):
                row[key] = [remap.get(sid, sid) for sid in value]
    analysis = copy.deepcopy(saved.get('analysis')) if isinstance(saved.get('analysis'), dict) else {}
    analysis.update(contract='topic-report-analysis-v2', priorities=priorities,
                    status='supported_analysis',
                    review_diagnostics=copy.deepcopy(result.get('review_diagnostics') or []),
                    selection_diagnostics=copy.deepcopy(result.get('selection_diagnostics') or {}),
                    direction_generation=copy.deepcopy(result.get('direction_generation') or {}))
    saved.update(topic=topic, reportText=text, sources=sources, analysis=analysis)
    saved['directionRefresh'] = {'runId': run_id, 'generatedAt': int(time.time() * 1000),
                                'researchStatus': findings.get('status'),
                                'queries': findings.get('queries', []),
                                'publicResearch': findings.get('public_research', {}),
                                'count': len(priorities)}
    return saved


def serve_topic_priorities(handler, body, *, complete, audit, research=research_topic,
                           build=None, enrich=None, clock=time.monotonic,
                           total_seconds=330, model_seconds=65):
    """One explicit request; public research and review precede atomic saving."""
    if build is None:
        from .topic_reports import build_priority_analysis
        build = build_priority_analysis
    if enrich is None:
        from .public_research import enrich_public_research
        enrich = enrich_public_research
    started, run_id = clock(), uuid.uuid4().hex
    try:
        context, text, identity, metadata = _saved_report(handler._scoped_state, body)
        key, topic = context['projectKey'], context['topic']

        def bounded_complete(*args):
            remaining = total_seconds - (clock() - started)
            if remaining <= 0:
                raise TopicReportError('direction_timeout', '本轮方向研判超时，已有结果已保留')
            done, outcome = threading.Event(), {}
            def request():
                try:
                    outcome['result'] = complete(*args)
                except Exception as error:
                    outcome['error'] = error
                finally:
                    done.set()
            threading.Thread(target=request, daemon=True, name='report-directions-model').start()
            if not done.wait(min(model_seconds, remaining)):
                raise TopicReportError('direction_timeout', '本轮方向研判超时，已有结果已保留')
            if 'error' in outcome:
                raise outcome['error']
            return outcome.get('result')

        # Regenerate only the source-bound directions. A saved empty analysis
        # or legacy missing metadata does not require another full report.
        findings = research(context['city'], topic, mode='full', basis=context['chunks'],
                            questions=(), deadline_seconds=min(70, total_seconds))
        findings = enrich(findings, context['city'], topic)
        if not evidence_catalog(findings):
            raise TopicReportError('research_unavailable', '本次未取得可核查原文，已有报告已保留；也可直接填写明确需求')
        result = build(context, findings, bounded_complete, phase=2)
        priorities = result['plan'].get('analytical_priorities') or []
        selected = evidence_catalog(findings)
        ids = {sid for row in priorities for sid in row.get('evidence_ids', [])}
        factual_text = '\n'.join(selected[sid]['quote'].replace('\n', ' ') + ' [' + sid + ']'
                                 for sid in ids if sid in selected)
        verification = validate_report(factual_text, findings, require_citations=False)
        if verification.get('issues') or any(row.get('support_status') == 'unsupported'
                                             for row in verification.get('checks', [])):
            raise TopicReportError('evidence_validation_failed', '本轮建议的原文核对未通过，已有结果已保留')
        if clock() - started > total_seconds:
            raise TopicReportError('direction_timeout', '本轮方向研判超时，已有结果已保留')
        updated = bool(priorities)
        next_metadata = (_merge_directions(metadata, text, topic, result, findings, verification, run_id)
                         if updated else copy.deepcopy(metadata))
        with handler._account_session() as session:
            live = json.loads(session.read())
            principal = require_session(handler.headers, live, admin_config=handler._account_config())
            authorize_project(key, live, principal)
            current_context, current_text, current_identity, current_metadata = _saved_report(
                scoped_sync_view(live, principal), body)
            if (current_text != text or current_identity != identity
                    or current_metadata != metadata
                    or current_context['sourceFingerprint'] != context['sourceFingerprint']):
                raise AuthError(409, 'report_changed', '研判期间报告或材料已更新，旧结果未写入')
            if updated:
                record = live.setdefault('REPORTSTATE', {}).setdefault(key, {})
                if not isinstance(record.get('researchByTopic'), dict):
                    record['researchByTopic'] = {}
                record['researchByTopic'][topic] = next_metadata
                if not session.write(json.dumps(live, ensure_ascii=False, allow_nan=False)):
                    raise AuthError(503, 'storage_unavailable', '研判方向尚未保存，已有结果已保留')
        audit({'purpose': 'report_priorities', 'runId': run_id, 'projectKey': key,
               'topic': topic, 'outcome': 'updated' if updated else 'no_supported_direction',
               'direction_count': len(priorities), 'elapsed_ms': round((clock()-started)*1000)})
        return respond(handler, 200, {'ok': True, 'updated': updated, 'projectKey': key,
                       'topic': topic, 'sourceIdentity': identity_json(identity),
                       'reportResearch': next_metadata,
                       'message': ('已补充 ' + str(len(priorities)) + ' 项研判方向' if updated else
                                   '本轮尚未形成可复核的建议，已保留原结果；可以填写明确需求继续推进')})
    except (AuthError, TopicReportError) as error:
        return error_response(handler, error if isinstance(error, AuthError) else
                              AuthError(422, error.code, error.message))
    except (BrokenPipeError, ConnectionResetError):
        return
    except Exception:
        return error_response(handler, AuthError(502, 'direction_generation_failed',
                                                '本轮方向研判未完成，已有报告已保留，请稍后重试'))
