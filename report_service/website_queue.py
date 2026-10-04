"""Internal adapter for the existing website queue and delivery formats.

No new public API, browser token, account or desktop dependency. Only requests
owned by full-v1 are mutated. Old completed/running requests stay intact.
"""
import base64
import copy
import hashlib
import json
import re
import time

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


def legacy_sync_view(state):
    """Keep legacy records and other business fields, hide native worker jobs."""
    if not isinstance(state, dict):
        return state
    value = dict(state)
    rows = value.get('REPORT_REQUESTS')
    if isinstance(rows, list):
        value['REPORT_REQUESTS'] = [r for r in rows
                                   if not (isinstance(r, dict) and r.get('engine') == ENGINE)]
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
        if saved and saved.get('engine') == ENGINE:
            # A legacy claimant must see failure, not a successful no-op.
            # Stale website snapshots and explicit cancellation still work.
            if (r.get('status') == 'running'
                    and (saved.get('status') == 'pending'
                         or ('claimTs' in r and r.get('claimTs') != saved.get('claimTs')))):
                from backend.sync_transaction import SyncWriteConflict
                raise SyncWriteConflict('server-owned report cannot be claimed through sync')
            value = copy.deepcopy(saved)
            if r.get('status') == 'cancelled' and saved.get('status') != 'cancelled':
                value.update(status='cancelled', cancelledTs=int(time.time() * 1000))
            rows.append(value)
        elif not saved:
            if not valid_request(r) or r.get('status') != 'pending':
                raise ValueError('new report must be a valid pending request')
            # Never accept client progress, artifacts or a forged completion.
            rows.append({k: r[k] for k in ('id', 'city', 'province', 'mode', 'by', 'ts') if k in r}
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
        city, reqid = body.get('city'), body.get('requestId')
        if not isinstance(city, str) or not city.strip() or (reqid is not None and not isinstance(reqid, str)):
            return reply(400, {'ok': False, 'error': '报告申请参数无效'})
        with session_factory() as session:
            state = json.loads(session.read())
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

    def ingest(self):
        """Idempotent queue handoff, never import unfinished legacy artifacts."""
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
        if r.get('status') == 'done' and r.get('files') and (not r.get('pushRequested') or r.get('pushed')):
            return
        rid = report_id(r['id'])
        job = self.store.get(TENANT, rid)
        if not job or job['synthetic']:
            return
        files = None
        if job['status'] == 'completed':
            files = [{'kind': website_kind, 'name': r['city'] + suffix,
                      'b64': base64.b64encode(self.store.artifact(TENANT, rid, kind + '.docx')).decode(),
                      'sha256': next(e['sha256'] for e in job['manifest']['files'] if e['name'] == kind + '.docx')}
                     for kind, website_kind, suffix in [
                         ('full', 'full', '_招商报告.docx'),
                         ('compact', 'short', '_招商报告_精简版.docx')]]
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
        if files and r.get('pushRequested') and not r.get('pushed'):
            self.publish(r, job)

    def publish(self, request, job):
        """Idempotent, atomic RAG + compact report + receipt publication."""
        if (job['synthetic'] or job['status'] != 'completed' or job['id'] != report_id(request['id'])
                or job['city'] != request['city'] or job['province'] != request['province']):
            raise ValueError('only this completed live report may be published')
        rid, reqid = job['id'], request['id']
        topics = []
        for icon, title, names in TOPICS:
            known = []
            for name in names:
                text = self.store.artifact(TENANT, rid, name).decode('utf-8')
                if 'SYNTHETIC TEST' in text:
                    raise ValueError('synthetic publication refused')
                known.extend(_chunks(text, reqid, name))
            topics.append({'icon': icon, 't': title, 'sub': '报告来源', 'tag': '报告基础包', 'known': known[:60], 'calls': []})
        total = sum(len(t['known']) for t in topics)
        if total < 40:
            raise ValueError('incomplete knowledge package')
        compact = self.store.artifact(TENANT, rid, '09_compact_report.md').decode('utf-8')
        evidence = json.loads(self.store.artifact(TENANT, rid, 'evidence.json'))
        checks = evidence['stages']['06b_fact_check.md'].get('checks', [])
        score = round(100 * sum(c.get('verdict') in ('一致', '✅一致') for c in checks) / len(checks)) if checks else None
        key = 'report_' + reqid
        with self.session() as session:
            state = json.loads(session.read())
            target = next((r for r in state.get('REPORT_REQUESTS') or []
                           if r.get('id') == reqid and r.get('engine') == ENGINE), None)
            if not target or target.get('status') != 'done' or not target.get('pushRequested'):
                return False
            receipts = state.setdefault('REPORT_PUBLICATIONS', {})
            if reqid in receipts:
                return True
            projects = state.setdefault('PROJECTS', {})
            if key in projects:
                raise ValueError('project publication conflict')
            projects[key] = {'id': key, 'city': request['city'], 'province': request['province'],
                             'org': '', 'who': '', 'topic': request['city'] + '产业链招引',
                             'stage': 1, 'kb': topics, 'clues': [], 'report': None,
                             'reportRequestId': reqid, 'reportFiles': target['files']}
            state.setdefault('CITY_BASE_PACKAGES', {})[request['city']] = key
            state.setdefault('REPORTSTATE', {})[key] = {'text': compact, 'topic': request['city'] + '产业招商报告',
                'ts': int(time.time() * 1000), 'score': score, 'scoreBasis': '核验一致项比例', 'sourceReportId': reqid}
            target.update(pushed=True, pushRequested=False, projectKey=key, chunks=total)
            receipts[reqid] = {'engineReportId': rid, 'projectKey': key,
                              'publishedAt': int(time.time() * 1000), 'manifest': job['manifest']}
            self._save(session, state)
            return True
