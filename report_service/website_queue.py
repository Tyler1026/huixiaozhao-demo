"""Internal adapter for the existing website queue and delivery formats.

No new public API, browser token, account or desktop dependency. Only requests
owned by full-v1 are mutated. Old completed/running requests stay intact.
"""
import base64
import copy
import hashlib
import json
import math
import re
import time
from datetime import datetime, timedelta, timezone

from backend.city_workspaces import get_city_workspace, next_month_report_at

TENANT = 'website-report-queue'
ENGINE = 'full-v1'
TOPICS = (
    ('🏭', '主导产业与产业链', ('02_industry_direction.md', '06_supply_chain_gaps.md')),
    ('🏢', '园区与承载条件', ('01a_economy.md', '01b_population.md', '01c_transport_land.md', '01d_life_support.md')),
    ('🏗️', '链主与存量企业', ('05a_target_enterprises_dir1.md', '05b_target_enterprises_dir2.md', '05c_target_enterprises_dir3.md', '07_matching_score.md')),
    ('📜', '政策、规划与领导关注', ('03_competition.md', '04_policy_trends.md')),
)


def report_id(request_id):
    return hashlib.sha256(('full-v1\0' + TENANT + '\0' + request_id).encode()).hexdigest()


def _monthly_request_id(city, project_key, month):
    scope = hashlib.sha256((city + '\0' + project_key).encode()).hexdigest()[:24]
    return 'rrmonthly' + scope + month.replace('-', '')


def _automatic_publication(request):
    """Only the server's deterministic monthly request format may auto-push."""
    month, key = request.get('scheduledMonth'), request.get('projectKey')
    return (request.get('autoPublish') is True and isinstance(key, str) and bool(key)
            and isinstance(month, str) and re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month)
            and request.get('id') == _monthly_request_id(request['city'], key, month))


def _request_version(request):
    # Claim time is server-owned. Browser clocks cannot make a report forever
    # newer than future monthly reports. Old unclaimed fixtures use their ts.
    stamp = request.get('claimTs', request.get('ts', 0))
    if type(stamp) not in (int, float) or not math.isfinite(stamp) or stamp < 0:
        stamp = 0
    return int(stamp), request['id']


def _replace_base_topics(existing, replacement):
    """Refresh the four report sections without discarding customer material."""
    if not isinstance(existing, list):
        raise ValueError('invalid workspace knowledge')
    generated_topics = {topic['t']: topic for topic in replacement}
    pending = dict(generated_topics)
    output = []
    for original in existing:
        if not isinstance(original, dict) or original.get('t') not in generated_topics:
            output.append(copy.deepcopy(original))
            continue
        generated = pending.pop(original['t'], None)
        known = original.get('known', [])
        if not isinstance(known, list):
            raise ValueError('invalid workspace knowledge')
        topic = copy.deepcopy(original)
        topic['known'] = (copy.deepcopy(generated['known']) if generated else []) + [copy.deepcopy(item) for item in known
                         if not isinstance(item, dict) or item.get('nature') != 'base']
        if generated:
            for field in ('icon', 'sub', 'tag', 'calls'):
                topic.setdefault(field, copy.deepcopy(generated[field]))
        output.append(topic)
    output.extend(copy.deepcopy(topic) for topic in replacement if topic['t'] in pending)
    return output


def valid_request(r):
    return (isinstance(r, dict) and isinstance(r.get('id'), str)
            and bool(re.fullmatch(r'rr[A-Za-z0-9_-]{1,64}', r['id']))
            and r.get('mode', 'standard') in ('standard', 'deep')
            and all(isinstance(r.get(k), str) and 0 < len(r[k].strip()) <= 128
                    and not any(ord(c) < 32 or c in '/\\' for c in r[k])
                    for k in ('city', 'province')))


def website_reads_queue(headers):
    """Select the website view, not a credential or an authorization grant.

    Fetch metadata also keeps already-open website tabs compatible. Legacy
    scripts have neither the explicit view header nor browser fetch metadata.
    Engine-owned writes remain fenced regardless of this read-view selector.
    """
    return (headers.get('X-HXZ-Report-Client') == 'website'
            or (headers.get('Sec-Fetch-Site') in ('same-origin', 'same-site')
                and headers.get('Sec-Fetch-Dest') == 'empty'
                and headers.get('Sec-Fetch-Mode') in ('cors', 'same-origin')))


def server_owned_request(request):
    """Reserve unclaimed legacy requests before worker ingestion can race a claim."""
    return (isinstance(request, dict)
            and (request.get('engine') == ENGINE
                 or (request.get('engine') is None and request.get('status') == 'pending'
                     and valid_request(request))))


def legacy_sync_view(state):
    """Keep legacy records and other business fields, hide native worker jobs."""
    if not isinstance(state, dict):
        return state
    value = dict(state)
    rows = value.get('REPORT_REQUESTS')
    if isinstance(rows, list):
        value['REPORT_REQUESTS'] = [r for r in rows if not server_owned_request(r)]
    nested = value.get('huixiaozhao_kb_v1')
    if isinstance(nested, dict):
        value['huixiaozhao_kb_v1'] = legacy_sync_view(nested)
    return value


def fence_updates(raw, state):
    """Server-owned progress cannot be overwritten by old consumers/snapshots.

The browser still submits pending requests and cancels saved requests. All
other sync fields continue through the existing merge policy unchanged.
"""
    incoming = json.loads(raw)
    if not isinstance(incoming, dict) or 'REPORT_REQUESTS' not in incoming:
        return raw
    old = {r.get('id'): r for r in state.get('REPORT_REQUESTS', []) if isinstance(r, dict)}
    rows = []
    for r in incoming.get('REPORT_REQUESTS') or []:
        if not isinstance(r, dict):
            continue
        saved = old.get(r.get('id'))
        if saved and server_owned_request(saved):
            # A legacy claimant must see failure, not a successful no-op.
            # Stale website snapshots and explicit cancellation still work.
            if (r.get('status') == 'running'
                    and (saved.get('status') == 'pending'
                         or ('claimTs' in r and r.get('claimTs') != saved.get('claimTs')))):
                from backend.sync_transaction import SyncWriteConflict
                raise SyncWriteConflict('server-owned report cannot be claimed through sync')
            value = copy.deepcopy(saved)
            value['engine'] = ENGINE
            if r.get('status') == 'cancelled' and saved.get('status') != 'cancelled':
                value.update(status='cancelled', cancelledTs=int(time.time() * 1000))
            rows.append(value)
        elif not saved:
            if not valid_request(r) or r.get('status') != 'pending':
                raise ValueError('new report must be a valid pending request')
            # Never accept client progress, artifacts or a forged completion.
            rows.append({k: r[k] for k in ('id', 'city', 'province', 'mode', 'by', 'ts', 'projectKey') if k in r}
                        | {'status': 'pending', 'engine': ENGINE})
        else:
            rows.append(r)
    incoming['REPORT_REQUESTS'] = rows
    return json.dumps(incoming, ensure_ascii=False).encode()


def _chunks(text, request_id, filename):
    """Keep source URLs and prose together; never fabricate knowledge items."""
    chunks, current = [], []
    size = 0
    for line in text.splitlines():
        if not line.strip():
            continue
        if size + len(line) > 1000 and current:
            chunks.append('\n'.join(current)); current, size = [], 0
        current.append(line); size += len(line) + 1
    if current:
        chunks.append('\n'.join(current))
    return [{'text': value, 'nature': 'base', 'origin': 'report',
             'reportRequestId': request_id, 'sourceFile': filename,
             'cite': filename, 'ts': int(time.time() * 1000)} for value in chunks]


def _balanced_chunks(groups, limit=60):
    """Bound a topic without dropping every chunk of its later source files.

    Allocate available slots evenly, redistribute short files' unused slots,
    sample whole original chunks across each file, then interleave source order.
    Selection depends only on position/count, never generated timestamps/text.
    """
    nonempty = [group for group in groups if group]
    if limit < len(nonempty):
        raise ValueError('knowledge cap cannot cover every source file')
    quotas = [0] * len(nonempty)
    remaining = min(limit, sum(len(group) for group in nonempty))
    while remaining:
        for i, group in enumerate(nonempty):
            if not remaining:
                break
            if quotas[i] < len(group):
                quotas[i] += 1
                remaining -= 1
    sampled = []
    for group, quota in zip(nonempty, quotas):
        indices = ([0] if quota == 1 else
                   [i * (len(group) - 1) // (quota - 1) for i in range(quota)])
        sampled.append([group[i] for i in indices])
    return [group[i] for i in range(max(quotas, default=0))
            for group in sampled if i < len(group)]


def request_publication(handler, raw, session_factory):
    """Same push-request contract, serialized with engine publication writes."""
    def reply(status, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        handler.send_response(status)
        handler.send_header('Content-Type', 'application/json; charset=utf-8')
        handler.send_header('Content-Length', str(len(data)))
        handler.cors(); handler.end_headers(); handler.wfile.write(data)
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeError):
        return reply(400, {'ok': False, 'error': '推送请求格式错误'})
    try:
        if not isinstance(body, dict):
            return reply(400, {'ok': False, 'error': '推送请求必须是对象'})
        city, reqid = body.get('city'), body.get('requestId')
        if (not isinstance(city, str) or not city.strip()
                or ('requestId' in body and (not isinstance(reqid, str) or not reqid.strip()))):
            return reply(400, {'ok': False, 'error': '报告申请参数无效'})
        city = city.strip()
        reqid = reqid.strip() if reqid is not None else None
        with session_factory() as session:
            state = json.loads(session.read())
            if not isinstance(state, dict) or not isinstance(state.get('REPORT_REQUESTS', []), list):
                raise ValueError('invalid report storage')
            rows = [r for r in state.get('REPORT_REQUESTS') or [] if isinstance(r, dict)]
            found = [r for r in rows if r.get('id') == reqid] if reqid else [
                r for r in rows if r.get('city') == city and r.get('status') == 'done']
            if not found or any(r.get('city') != city for r in found):
                return reply(404, {'ok': False, 'error': '未找到对应的报告申请'})
            if len(found) != 1:
                return reply(409, {'ok': False, 'error': '报告申请不唯一，请刷新页面后重试'})
            target = found[0]
            if target.get('status') != 'done':
                return reply(409, {'ok': False, 'error': '该报告申请尚未完成，不能推送'})
            if target.get('engine') != ENGINE and not target.get('pushed'):
                return reply(409, {'ok': False, 'code': 'legacy-report-requires-regeneration',
                                   'error': '历史报告缺少独立发布所需的研究材料，请重新生成后推送'})
            if target.get('publicationSkipped'):
                return reply(200, {'ok': True, 'id': target['id'], 'city': city,
                                   'alreadyRequested': True, 'pushed': False,
                                   'publicationSkipped': target['publicationSkipped']})
            if target.get('pushRequested') or target.get('pushed'):
                return reply(200, {'ok': True, 'id': target['id'], 'city': city,
                                   'alreadyRequested': True, 'pushed': bool(target.get('pushed'))})
            target.update(pushRequested=True, pushed=False, pushRequestedTs=int(time.time() * 1000))
            if not session.write(json.dumps(state, ensure_ascii=False)):
                raise OSError('storage unavailable')
            return reply(200, {'ok': True, 'id': target['id'], 'city': city, 'pushed': False})
    except (BrokenPipeError, ConnectionResetError):
        return
    except Exception:
        return reply(503, {'ok': False, 'error': '保存推送请求失败，请重试'})


class WebsiteQueue:
    def __init__(self, store, session):
        self.store, self.session = store, session

    def _save(self, session, state):
        if not session.write(json.dumps(state, ensure_ascii=False)):
            raise OSError('website storage unavailable')

    def schedule_monthly(self, now=None):
        """Schedule at most one current-month report per canonical workspace.

        The website row lock covers due checks, active-job checks, insertion and
        advancing the calendar. Missed months are never replayed as a backlog.
        A blocked/failed job remains active until explicitly cancelled or done.
        """
        from backend.auth import AuthError
        now = time.time() if now is None else now
        next_at = next_month_report_at(now)
        current = datetime.fromtimestamp(now, timezone(timedelta(hours=8)))
        # An overdue previous month must not make this month's report run
        # before its own release time on the first day at 09:00 Beijing time.
        if now < current.replace(day=1, hour=9, minute=0, second=0, microsecond=0).timestamp():
            return 0
        month = current.strftime('%Y-%m')
        created = 0
        with self.session() as session:
            state = json.loads(session.read())
            registry = state.get('CITY_WORKSPACES', {})
            if not isinstance(registry, dict):
                return 0
            rows = state.setdefault('REPORT_REQUESTS', [])
            if not isinstance(rows, list):
                raise ValueError('invalid report queue')
            changed = False
            for city in registry:
                try:
                    binding = get_city_workspace(state, city)
                except AuthError:
                    continue
                if (not binding or binding['monthlyEnabled'] is not True
                        or binding['nextReportAt'] > now * 1000):
                    continue
                request = {'id': _monthly_request_id(city, binding['projectKey'], month),
                           'city': city, 'province': binding['province'], 'mode': 'standard',
                           'status': 'pending', 'engine': ENGINE, 'ts': int(now * 1000),
                           'projectKey': binding['projectKey'], 'scheduledMonth': month,
                           'autoPublish': True, 'by': '每月自动更新'}
                if not valid_request(request):
                    continue
                if any(isinstance(row, dict) and row.get('city') == city
                       and row.get('status') not in ('done', 'cancelled') for row in rows):
                    continue
                if not any(isinstance(row, dict) and row.get('id') == request['id'] for row in rows):
                    rows.append(request)
                    created += 1
                binding['nextReportAt'] = next_at
                changed = True
            if changed:
                self._save(session, state)
        return created

    def ingest(self):
        """Idempotent queue handoff, never import unfinished legacy artifacts."""
        self.schedule_monthly()
        with self.session() as session:
            state = json.loads(session.read())
            changed = False
            for r in state.get('REPORT_REQUESTS') or []:
                if not valid_request(r):
                    continue
                if r.get('engine') == ENGINE and r.get('status') == 'cancelled':
                    self.store.cancel(TENANT, report_id(r['id']))
                elif r.get('status') == 'pending' and r.get('engine') in (None, ENGINE):
                    job = self.store.create(TENANT, r['province'], r['city'], r['id'],
                                            synthetic=False, mode=r.get('mode', 'standard'))
                    r.update(engine=ENGINE, engineReportId=job['id'], status='running',
                             total=job['stages_total'], done=job['stages_done'])
                    r['claimTs'] = r.get('claimTs') or int(time.time() * 1000)
                    changed = True
            if changed:
                self._save(session, state)

    def mirror(self, *, continue_on_error=False):
        # Heavy artifact reads happen outside the website row lock.
        with self.session() as session:
            rows = copy.deepcopy(json.loads(session.read()).get('REPORT_REQUESTS') or [])
        for r in rows:
            try:
                self._mirror_request(r)
            except Exception:
                if not continue_on_error:
                    raise
                # One undeliverable report must not stop research/other delivery.
                with self.session() as session:
                    state = json.loads(session.read())
                    target = next((x for x in state.get('REPORT_REQUESTS') or []
                                   if x.get('id') == r.get('id') and x.get('engine') == ENGINE), None)
                    if target and target.get('status') != 'cancelled':
                        target.update(deliveryError='delivery_retry', deliveryRetryAt=time.time() + 120)
                        self._save(session, state)

    def _mirror_request(self, r):
        if r.get('engine') != ENGINE or not valid_request(r) or r.get('status') == 'cancelled':
            return
        if r.get('deliveryRetryAt', 0) > time.time():
            return
        wants_publication = r.get('pushRequested') or _automatic_publication(r)
        if (r.get('status') == 'done' and r.get('files')
                and (not wants_publication or r.get('pushed') or r.get('publicationSkipped'))):
            return
        rid = report_id(r['id'])
        job = self.store.get(TENANT, rid)
        if not job or job['synthetic']:
            return
        files = None
        if job['status'] == 'completed':
            deliveries = [('full.docx', 'full', '_招商报告.docx'),
                          ('compact.docx', 'short', '_招商报告_精简版.docx')]
            if any(e['name'] == 'research.zip' for e in job['manifest']['files']):
                deliveries.append(('research.zip', 'research', '_完整研究附件.zip'))
            files = [{'kind': website_kind, 'name': r['city'] + suffix,
                      'b64': base64.b64encode(self.store.artifact(TENANT, rid, name)).decode(),
                      'sha256': next(e['sha256'] for e in job['manifest']['files'] if e['name'] == name)}
                     for name, website_kind, suffix in deliveries]
        with self.session() as session:
            state = json.loads(session.read())
            target = next((x for x in state.get('REPORT_REQUESTS') or []
                           if x.get('id') == r['id'] and x.get('engine') == ENGINE), None)
            if not target or target.get('status') == 'cancelled':
                return
            before = copy.deepcopy(target)
            current = job['current'] or {}
            target.update(done=job['stages_done'], total=job['stages_total'],
                          filesDone=job['stages_done'], filesTotal=job['stages_total'],
                          partsDone=job['parts_done'], partsTotal=job['parts_total'],
                          engineStatus=job['status'], progressAt=job['progress_at'],
                          failureCode=job['failure_code'], retryAt=current.get('next_at'),
                          stage=current.get('stage'), attempts=current.get('attempts', 0))
            target['step'] = ('研究中断，已保存成果，将自动接续' if job['status'] == 'retry_wait'
                              else current.get('part') or '报告交付校验')
            if job['progress_at'] is not None:
                target['progressTs'] = int(job['progress_at'] * 1000)
            target.pop('deliveryError', None)
            target.pop('deliveryRetryAt', None)
            if files:
                target.update(status='done', files=files)
                if not target.get('doneTs'):
                    target['doneTs'] = int(time.time() * 1000)
            elif job['status'] in ('failed', 'cancelled'):
                target['status'] = job['status']
            else:
                target['status'] = 'running'
            if target != before:
                self._save(session, state)
        if files and wants_publication and not r.get('pushed') and not r.get('publicationSkipped'):
            self.publish(r, job)

    def publish(self, request, job):
        """Idempotent, atomic RAG + compact report + receipt publication."""
        if (job['synthetic'] or job['status'] != 'completed' or job['id'] != report_id(request['id'])
                or job['city'] != request['city'] or job['province'] != request['province']):
            raise ValueError('only this completed live report may be published')
        rid, reqid = job['id'], request['id']
        topics = []
        for icon, title, names in TOPICS:
            source_chunks = []
            for name in names:
                text = self.store.artifact(TENANT, rid, name).decode('utf-8')
                if 'SYNTHETIC TEST' in text:
                    raise ValueError('synthetic publication refused')
                source_chunks.append(_chunks(text, reqid, name))
            topics.append({'icon': icon, 't': title, 'sub': '报告来源', 'tag': '报告基础包',
                           'known': _balanced_chunks(source_chunks), 'calls': []})
        total = sum(len(t['known']) for t in topics)
        if total < 40:
            raise ValueError('incomplete knowledge package')
        compact = self.store.artifact(TENANT, rid, '09_compact_report.md').decode('utf-8')
        evidence = json.loads(self.store.artifact(TENANT, rid, 'evidence.json'))
        checks = evidence['stages']['06b_fact_check.md'].get('checks', [])
        score = round(100 * sum(c.get('verdict') in ('一致', '✅一致') for c in checks) / len(checks)) if checks else None
        verdict_counts = {'consistent': 0, 'inconsistent': 0, 'pending': 0, 'unclassified': 0}
        for check in checks:
            verdict = check.get('verdict')
            bucket = ('consistent' if verdict in ('一致', '✅一致') else
                      'inconsistent' if verdict in ('不一致', '❌不一致') else
                      'pending' if verdict in ('待核实', '⚠️待核实', '不可用', '待校核') else 'unclassified')
            verdict_counts[bucket] += 1
        # Free-form verdicts are not automatically reinterpreted as agreement.
        # Preserve the old numeric field, but prevent displaying it as quality.
        score_status = ('unavailable' if not checks else
                        'unclassified' if verdict_counts['unclassified'] else 'classified')
        published_at = int(time.time() * 1000)
        with self.session() as session:
            state = json.loads(session.read())
            target = next((r for r in state.get('REPORT_REQUESTS') or []
                           if r.get('id') == reqid and r.get('engine') == ENGINE), None)
            if (not target or target.get('status') != 'done'
                    or not (target.get('pushRequested') or _automatic_publication(target))):
                return False
            receipts = state.setdefault('REPORT_PUBLICATIONS', {})
            if reqid in receipts:
                return True
            projects = state.setdefault('PROJECTS', {})
            binding = get_city_workspace(state, request['city'])
            key = binding['projectKey'] if binding else 'report_' + reqid
            if _automatic_publication(target) and (not binding or target['projectKey'] != key):
                raise ValueError('monthly report workspace changed')
            version_order = _request_version(target)
            version = {'requestId': reqid, 'requestedAt': version_order[0],
                       'publishedAt': published_at, 'scheduledMonth': target.get('scheduledMonth')}
            if binding:
                project = projects[key]
                previous = project.get('baseReportVersion')
                previous_id = project.get('reportRequestId')
                if isinstance(previous, dict):
                    stamp = previous.get('requestedAt')
                    if type(stamp) not in (int, float) or not math.isfinite(stamp):
                        raise ValueError('invalid previous report version')
                    previous_order = int(stamp), str(previous.get('requestId', ''))
                else:
                    previous_request = next((r for r in state.get('REPORT_REQUESTS') or []
                                             if isinstance(r, dict) and r.get('id') == previous_id), None)
                    previous_order = _request_version(previous_request) if previous_request else None
                if previous_order is not None and version_order < previous_order:
                    target.update(pushed=False, pushRequested=False,
                                  publicationSkipped='newer-report-already-published')
                    receipts[reqid] = {'engineReportId': rid, 'projectKey': key,
                                      'publishedAt': None, 'recordedAt': published_at,
                                      'status': 'superseded', 'version': version,
                                      'manifest': job['manifest']}
                    self._save(session, state)
                    return True
                topic = request['city'] + '产业链招引'
                project['kb'] = _replace_base_topics(project.get('kb', []), topics)
                project.update(reportRequestId=reqid, reportFiles=target['files'],
                               baseReportTopic=topic, baseReportVersion=version)
            else:
                if key in projects:
                    raise ValueError('project publication conflict')
                topic = request['city'] + '产业链招引'
                projects[key] = {'id': key, 'city': request['city'], 'province': request['province'],
                                 'org': '', 'who': '', 'topic': topic,
                                 'stage': 1, 'kb': topics, 'clues': [], 'report': None,
                                 'reportRequestId': reqid, 'reportFiles': target['files']}
            state.setdefault('CITY_BASE_PACKAGES', {})[request['city']] = key
            # The browser deliberately reads by exact topic to avoid showing a
            # different direction's report. Publish the saved compact verbatim
            # under this project's topic as well as the legacy text field.
            report = state.setdefault('REPORTSTATE', {}).setdefault(key, {})
            if not isinstance(report, dict):
                raise ValueError('invalid workspace report')
            report.update({
                'text': compact, 'topic': topic, 'ts': published_at, 'phase': 2,
                'score': score, 'scoreBasis': '核验一致项比例',
                'scoreStatus': score_status, 'checkVerdictCounts': verdict_counts,
                'sourceReportId': reqid})
            for field, value in (('aiReportByTopic', compact), ('phaseByTopic', 2), ('tsByTopic', published_at)):
                if not isinstance(report.setdefault(field, {}), dict):
                    raise ValueError('invalid workspace report topic map')
                report[field][topic] = value
            if binding:
                report['baseReportVersion'] = version
            target.update(pushed=True, pushRequested=False, projectKey=key, chunks=total)
            receipts[reqid] = {'engineReportId': rid, 'projectKey': key,
                              'publishedAt': published_at, 'manifest': job['manifest']}
            if binding:
                receipts[reqid].update(status='published', version=version)
            self._save(session, state)
            return True
