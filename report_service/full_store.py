"""Versioned full-report queue. No Agenda, network or legacy-sync dependency.

Each part and bundle step has durable attempts, an absolute deadline and a
fenced lease. Heartbeats are explicitly not evidence of research progress.
SQLite is supported on one host only, never on a shared network filesystem.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import math
import secrets
import sqlite3
import time
from pathlib import Path

from . import full_execution_policy as execution_policy

CODES = frozenset({'timeout', 'worker_crash', 'upstream', 'rate_limit', 'quality',
                   'configuration', 'budget_exhausted', 'artifact', 'cancelled'})


class Conflict(ValueError):
    pass


def _text(value, limit=128):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError('invalid text')
    if any(ord(c) < 32 for c in value):
        raise ValueError('invalid text')
    return value.strip()


SCHEMA = '''
CREATE TABLE IF NOT EXISTS full_reports (
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL, province TEXT NOT NULL,
 city TEXT NOT NULL, request_key TEXT NOT NULL, synthetic INTEGER NOT NULL,
 version TEXT NOT NULL, definition TEXT NOT NULL, status TEXT NOT NULL,
 created_at REAL NOT NULL, progress_at REAL, heartbeat_at REAL,
 failure_code TEXT, manifest TEXT, task_budget REAL NOT NULL,
 stage_budget REAL NOT NULL, max_attempts INTEGER NOT NULL,
 UNIQUE(tenant, request_key)
);
CREATE TABLE IF NOT EXISTS full_steps (
 id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES full_reports(id),
 ordinal INTEGER NOT NULL, stage TEXT NOT NULL, part TEXT NOT NULL,
 status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 token TEXT, expires REAL, deadline REAL, started_at REAL,
 consumed REAL NOT NULL DEFAULT 0, next_at REAL NOT NULL DEFAULT 0,
 output TEXT, failure_code TEXT, UNIQUE(report_id, ordinal)
);
CREATE INDEX IF NOT EXISTS full_step_queue ON full_steps(status, next_at);
CREATE TABLE IF NOT EXISTS full_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, report_id TEXT NOT NULL,
 at REAL NOT NULL, kind TEXT NOT NULL, stage TEXT, part TEXT, code TEXT
);
CREATE TABLE IF NOT EXISTS full_input_context (
 report_id TEXT PRIMARY KEY REFERENCES full_reports(id),
 payload TEXT NOT NULL, sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS full_checkpoint_archive (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 report_id TEXT NOT NULL REFERENCES full_reports(id),
 step_id TEXT NOT NULL REFERENCES full_steps(id),
 ordinal INTEGER NOT NULL, stage TEXT NOT NULL, part TEXT NOT NULL,
 attempts INTEGER NOT NULL, consumed REAL NOT NULL,
 output TEXT NOT NULL, output_sha256 TEXT NOT NULL,
 archived_at REAL NOT NULL, reason TEXT NOT NULL,
 UNIQUE(step_id, attempts, output_sha256)
);
CREATE TABLE IF NOT EXISTS full_execution_policies (
 report_id TEXT PRIMARY KEY REFERENCES full_reports(id),
 policy_version TEXT NOT NULL, control_version INTEGER NOT NULL,
 limits_json TEXT NOT NULL, grants_json TEXT NOT NULL, quality_json TEXT NOT NULL,
 state TEXT NOT NULL, pause_reason TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS full_execution_actions (
 report_id TEXT NOT NULL REFERENCES full_reports(id), idempotency_key TEXT NOT NULL,
 request_json TEXT NOT NULL, result_json TEXT NOT NULL, at REAL NOT NULL,
 PRIMARY KEY(report_id,idempotency_key)
);
'''


def _effective_limit(*values):
    """Zero in persisted policy means no aggregate limit, not zero work."""
    finite = [value for value in values if value > 0]
    return min(finite) if finite else math.inf


def _checkpoint_issue(raw, stage=None, part=None):
    """Identify source defects or a deficient committed policy-check part.

    This deliberately does not run the whole stage contract: a partial stage
    may legitimately have too few sources or lines. Original checkpoint bytes
    remain untouched until the fenced repair transaction archives them.
    """
    from .full_contract import (
        extract_urls, normalize_url, is_government_host,
        _is_private_or_local_host, _is_placeholder_host,
    )

    try:
        output = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(output, dict):
        return None
    text = output.get('text')
    for url in extract_urls(text if isinstance(text, str) else ''):
        norm = normalize_url(url)
        if norm is None:
            return 'unsafe_text_url'
        scheme, host, path = norm
        if (scheme != 'https' or _is_private_or_local_host(host)
                or _is_placeholder_host(host)
                or ('gov.cn' in path and not is_government_host(host))):
            return 'unsafe_text_url'
    metadata = output.get('metadata')
    evidence = metadata.get('evidence') if isinstance(metadata, dict) else None
    for item in evidence if isinstance(evidence, list) else []:
        if not isinstance(item, dict):
            continue
        norm = normalize_url(item.get('url'))
        if norm is not None and norm[0] == 'http':
            return 'http_evidence'
        excerpt = item.get('excerpt')
        if not isinstance(excerpt, str) or not excerpt.strip():
            return 'empty_excerpt'
    # A saved policy part with no valid policy checks cannot be repaired by
    # repeatedly generating the later high-star part. Rewind only that known
    # deficient part; old economic checkpoints keep their original contract.
    if stage == 'fact_check' and part == '政策金额':
        from .full_contract import fact_check_part_errors
        if fact_check_part_errors(part, metadata if isinstance(metadata, dict) else {}):
            return 'checkpoint_policy_checks_missing'
    return None


class FullStore:
    def __init__(self, path, *, stages=None, artifact_root=None, clock=time.time,
                 backoff=(30, 120), max_attempts=None, task_budget=None, stage_budget=None):
        self.path = str(Path(path).absolute())
        self.artifact_root = Path(artifact_root).absolute() if artifact_root else None
        self.stages = stages
        self.clock = clock
        if max_attempts is not None and (isinstance(max_attempts, bool) or not isinstance(max_attempts, int) or max_attempts < 1):
            raise ValueError('invalid attempt limit')
        for value in (task_budget, stage_budget):
            if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0):
                raise ValueError('invalid aggregate time limit')
        if not backoff or any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) or n < 0 for n in backoff):
            raise ValueError('invalid retry delay')
        self.backoff = tuple(backoff)
        self.max_attempts = 0 if max_attempts is None else max_attempts
        self.task_budget = 0 if task_budget is None else task_budget
        self.stage_budget = 0 if stage_budget is None else stage_budget
        with self.db() as c:
            c.executescript(SCHEMA)

    @contextlib.contextmanager
    def db(self):
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA foreign_keys=ON')
        try:
            with c:
                yield c
        finally:
            c.close()

    def _definition(self):
        if self.stages is None:
            from .full_contract import STAGES
            return STAGES
        return self.stages

    def create(self, tenant, province, city, key, synthetic=True, *, mode='standard', input_context=None):
        tenant, province, city, key = map(_text, (tenant, province, city, key))
        if not isinstance(synthetic, bool):
            raise ValueError('synthetic must be boolean')
        if mode not in ('standard', 'deep'):
            raise ValueError('invalid report mode')
        from .user_materials import canonical, validate_snapshot
        input_context = validate_snapshot(input_context)
        if input_context is not None and input_context['city'] != city:
            raise ValueError('workspace materials city does not match report')
        context_payload = canonical(input_context) if input_context is not None else None
        rid = hashlib.sha256(('full-v1\0' + tenant + '\0' + key).encode()).hexdigest()
        stages = self._definition()
        # Store the requested business mode with the immutable task definition;
        # old snapshots without this field remain standard, without a migration.
        if mode == 'deep':
            if self.stages is None:
                from .full_contract import get_stage
                stages = [get_stage(stage['id'], mode=mode) for stage in stages]
            stages = [dict(stage, report_mode=mode) for stage in stages]
        definition = json.dumps(stages, ensure_ascii=False)
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            old = c.execute('SELECT * FROM full_reports WHERE id=?', (rid,)).fetchone()
            if old:
                saved = json.loads(old['definition'])
                saved_mode = saved[0].get('report_mode', 'standard') if saved else 'standard'
                if (old['province'], old['city'], bool(old['synthetic']), saved_mode) != (province, city, synthetic, mode):
                    raise Conflict('idempotency payload mismatch')
            else:
                if not synthetic and mode == 'standard' and self._city_held(c, {
                        'id': rid, 'tenant': tenant, 'province': province, 'city': city}):
                    raise Conflict('city has a paused report')
                c.execute('INSERT INTO full_reports VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                          (rid, tenant, province, city, key, int(synthetic), 'full-v1', definition,
                           'queued', self.clock(), None, None, None, None,
                           self.task_budget, self.stage_budget, self.max_attempts))
                i = 0
                for stage in json.loads(definition):
                    for part in stage['parts']:
                        c.execute('INSERT INTO full_steps(id,report_id,ordinal,stage,part,status) VALUES(?,?,?,?,?,?)',
                                  (f'{rid}:{i}', rid, i, stage['id'], part, 'pending'))
                        i += 1
                c.execute('INSERT INTO full_steps(id,report_id,ordinal,stage,part,status) VALUES(?,?,?,?,?,?)',
                          (f'{rid}:{i}', rid, i, '__bundle__', 'bundle', 'pending'))
                if not synthetic and mode == 'standard':
                    now = self.clock()
                    c.execute('''INSERT INTO full_execution_policies
                        (report_id,policy_version,control_version,limits_json,grants_json,quality_json,
                         state,pause_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)''',
                              (rid, execution_policy.POLICY_VERSION, 1,
                               json.dumps(execution_policy.default_limits()),
                               json.dumps(execution_policy.empty_grants()), '{}',
                               'active', None, now, now))
                self._event(c, rid, 'created')
            if context_payload is not None:
                saved_context = c.execute('SELECT payload FROM full_input_context WHERE report_id=?', (rid,)).fetchone()
                if saved_context is None:
                    started = c.execute('SELECT COUNT(*) FROM full_steps WHERE report_id=? AND attempts>0', (rid,)).fetchone()[0]
                    if started:
                        raise Conflict('cannot attach workspace materials to a started report')
                    c.execute('INSERT INTO full_input_context(report_id,payload,sha256) VALUES(?,?,?)',
                              (rid, context_payload, hashlib.sha256(context_payload.encode()).hexdigest()))
                # A retry after website commit failure keeps the first complete
                # snapshot. Later material edits belong to the next report.
        return self.get(tenant, rid) | {'created': not bool(old)}

    def _event(self, c, rid, kind, stage=None, part=None, code=None):
        c.execute('INSERT INTO full_events(report_id,at,kind,stage,part,code) VALUES(?,?,?,?,?,?)',
                  (rid, self.clock(), kind, stage, part, code))

    def _owned(self, c, sid, token):
        return c.execute("SELECT * FROM full_steps WHERE id=? AND token=? AND status='running' AND expires>? AND deadline>?",
                         (sid, token, self.clock(), self.clock())).fetchone()

    def _elapsed(self, row):
        return max(0, min(self.clock(), row['deadline']) - row['started_at'])

    def _policy(self, c, rid):
        row = c.execute('SELECT * FROM full_execution_policies WHERE report_id=?', (rid,)).fetchone()
        if row is None:
            return None
        result = dict(row)
        for key in ('limits', 'grants', 'quality'):
            result[key] = json.loads(result[key + '_json'])
        return result

    def _city_held(self, c, report):
        """Caller holds the same serialized transaction as create/claim/pause."""
        return c.execute('''SELECT 1 FROM full_reports WHERE tenant=? AND province=? AND city=?
            AND id!=? AND status IN ('paused','pause_requested') LIMIT 1''',
                         (report['tenant'], report['province'], report['city'], report['id'])).fetchone() is not None

    def _save_policy(self, c, policy):
        policy['control_version'] += 1
        c.execute('''UPDATE full_execution_policies SET control_version=?,grants_json=?,quality_json=?,
            state=?,pause_reason=?,updated_at=? WHERE report_id=?''',
                  (policy['control_version'], json.dumps(policy['grants']), json.dumps(policy['quality']),
                   policy['state'], policy['pause_reason'], self.clock(), policy['report_id']))

    def _policy_numbers(self, c, report, policy):
        steps = c.execute('''SELECT id,stage,part,status,attempts,consumed,deadline,started_at
            FROM full_steps WHERE report_id=? ORDER BY ordinal''', (report['id'],)).fetchall()
        current = next((s for s in steps if s['status'] != 'done'), None)
        # Include occupied in-flight time in projections, but only settlement
        # mutates consumed. This avoids double-counting on repeated reads.
        def used(s):
            return s['consumed'] + (self._elapsed(s) if s['status'] == 'running' else 0)
        work = sum(used(s) for s in steps)
        stage = current['stage'] if current else '__bundle__'
        sid = current['id'] if current else ''
        quality = policy['quality'].get(sid, {'total': 0, 'ack': 0})
        limits = execution_policy.effective_limits(policy['limits'], policy['grants'], sid, stage)
        usage = {'attempts_total': sum(s['attempts'] for s in steps),
                 'retries': sum(max(s['attempts'] - 1, 0) for s in steps),
                 'work_seconds': work, 'current_stage_work_seconds': sum(used(s) for s in steps if s['stage'] == stage),
                 'current_step_attempts': current['attempts'] if current else 0,
                 'quality_failures': sum(q['total'] for q in policy['quality'].values()),
                 'quality_since_ack': quality['total'] - quality['ack']}
        reason = execution_policy.stop_reason(
            limits, attempts=usage['current_step_attempts'], retries=usage['retries'],
            task_used=work, stage_used=usage['current_stage_work_seconds'],
            created_at=report['created_at'], now=self.clock(), quality_since_ack=usage['quality_since_ack'])
        return current, limits, usage, reason

    def _policy_projection(self, c, report, policy=None):
        policy = self._policy(c, report['id']) if policy is None else policy
        flags = {'money_hard_limit': False, 'token_hard_limit': False, 'search_hard_limit': False}
        if policy is None:
            mode = (json.loads(report['definition']) or [{}])[0].get('report_mode', 'standard')
            return dict(flags, policy_version=None, version=None, state='legacy', pause_reason=None,
                        applicability='not_applied' if report['synthetic'] or mode == 'deep' else 'legacy',
                        limits=None, usage=None, remaining=None, can_pause=False, can_continue=False)
        current, limits, usage, reason = self._policy_numbers(c, report, policy)
        terminal = report['status'] in ('completed', 'cancelled')
        running = c.execute("SELECT COUNT(*) FROM full_steps WHERE report_id=? AND status='running'", (report['id'],)).fetchone()[0]
        remaining = {'task_seconds': max(0, limits['task_work_seconds'] - usage['work_seconds']),
                     'stage_seconds': max(0, limits['stage_work_seconds'] - usage['current_stage_work_seconds']),
                     'wall_seconds': max(0, report['created_at'] + limits['wall_seconds'] - self.clock()),
                     'step_attempts': max(0, limits['step_max_attempts'] - usage['current_step_attempts']),
                     'retries': max(0, limits['report_max_retries'] - usage['retries'])}
        return dict(flags, policy_version=policy['policy_version'], version=policy['control_version'],
                    state=policy['state'], pause_reason=policy['pause_reason'], applicability='standard_live',
                    limits=limits, usage=usage, remaining=remaining,
                    can_pause=not terminal and policy['state'] == 'active',
                    can_continue=not terminal and policy['state'] == 'paused' and not running,
                    next_claim_blocked_reason=reason, current_step_id=current['id'] if current else None)

    def _pause_policy(self, c, report, policy, reason, *, requested=False):
        state = 'pause_requested' if requested else 'paused'
        policy.update(state=state, pause_reason=reason)
        self._save_policy(c, policy)
        c.execute('UPDATE full_reports SET status=? WHERE id=?', (state, report['id']))
        self._event(c, report['id'], state, code=reason)

    def _after_settlement(self, c, rid):
        policy = self._policy(c, rid)
        if policy is None:
            return
        report = c.execute('SELECT * FROM full_reports WHERE id=?', (rid,)).fetchone()
        if report['status'] in ('cancelled', 'completed'):
            return
        if policy['state'] == 'pause_requested':
            self._pause_policy(c, report, policy, policy['pause_reason'])
        else:
            _, _, _, reason = self._policy_numbers(c, report, policy)
            if reason:
                self._pause_policy(c, report, policy, reason)

    def policy_status(self, tenant, rid):
        """Pure SELECT: observing policy never recovers this or other jobs."""
        with self.db() as c:
            if isinstance(c, sqlite3.Connection):
                c.execute('BEGIN')
            else:
                # The PostgreSQL wrapper passes this through unchanged. SET
                # LOCAL timeouts in db() have not read any application rows.
                c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
            row = c.execute('SELECT * FROM full_reports WHERE id=? AND tenant=?', (rid, tenant)).fetchone()
            if row is None:
                return None
            return {'id': rid, 'status': row['status'], 'policy_projection': self._policy_projection(c, row)}

    def pause_report(self, tenant, rid, *, expected_version, idempotency_key, actor, reason):
        return self._control(tenant, rid, 'pause', expected_version, idempotency_key, actor, reason, None)

    def continue_report(self, tenant, rid, *, expected_version, idempotency_key, actor, reason, grant=None):
        return self._control(tenant, rid, 'continue', expected_version, idempotency_key, actor, reason, grant)

    def _control(self, tenant, rid, action, version, key, actor, reason, grant):
        tenant, rid, key, actor, reason = (_text(tenant), _text(rid), _text(key), _text(actor), _text(reason, 1000))
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise ValueError('invalid expected version')
        grant = execution_policy.validate_grant(grant) if action == 'continue' else None
        request = json.dumps({'action': action, 'expected_version': version, 'actor': actor,
                              'reason': reason, 'grant': grant}, sort_keys=True, allow_nan=False)
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            report = c.execute('SELECT * FROM full_reports WHERE id=? AND tenant=?', (rid, tenant)).fetchone()
            if report is None:
                raise Conflict('report not found')
            saved = c.execute('SELECT request_json,result_json FROM full_execution_actions WHERE report_id=? AND idempotency_key=?', (rid, key)).fetchone()
            if saved:
                if saved['request_json'] != request:
                    raise Conflict('idempotency payload mismatch')
                return json.loads(saved['result_json'])
            policy = self._policy(c, rid)
            if policy is None:
                raise Conflict('legacy or ungoverned report')
            if report['status'] in ('cancelled', 'completed'):
                raise Conflict('terminal report')
            if policy['control_version'] != version:
                raise Conflict('policy version mismatch')
            running = c.execute("SELECT COUNT(*) FROM full_steps WHERE report_id=? AND status='running'", (rid,)).fetchone()[0]
            if action == 'pause':
                if policy['state'] != 'active':
                    raise Conflict('report already paused')
                self._pause_policy(c, report, policy, 'manual', requested=bool(running))
            else:
                if policy['state'] != 'paused' or running:
                    raise Conflict('report is not settled and paused')
                current, _, _, _ = self._policy_numbers(c, report, policy)
                if current is None:
                    raise Conflict('no unfinished step')
                policy['grants'] = execution_policy.apply_grant(policy['grants'], grant, current['id'], current['stage'])
                quality = policy['quality'].setdefault(current['id'], {'total': 0, 'ack': 0})
                quality['ack'] = quality['total']
                _, _, _, blocked = self._policy_numbers(c, report, policy)
                if blocked and not any(grant.values()):
                    raise Conflict('finite additional allowance required: ' + blocked)
                policy.update(state='paused' if blocked else 'active', pause_reason=blocked)
                self._save_policy(c, policy)
                c.execute('UPDATE full_reports SET status=?,failure_code=NULL WHERE id=?', ('paused' if blocked else 'queued', rid))
                self._event(c, rid, 'allowance_granted' if blocked else 'continued', current['stage'], current['part'], blocked)
            report = c.execute('SELECT * FROM full_reports WHERE id=?', (rid,)).fetchone()
            result = {'id': rid, 'status': report['status'], 'policy_projection': self._policy_projection(c, report, policy)}
            c.execute('INSERT INTO full_execution_actions(report_id,idempotency_key,request_json,result_json,at) VALUES(?,?,?,?,?)',
                      (rid, key, request, json.dumps(result, allow_nan=False), self.clock()))
            return result

    def _fail(self, c, row, code, retryable):
        report = c.execute('SELECT * FROM full_reports WHERE id=?', (row['report_id'],)).fetchone()
        policy = self._policy(c, row['report_id'])
        if policy is not None:
            delay = self.backoff[min(max(row['attempts'] - 1, 0), len(self.backoff) - 1)]
            c.execute("UPDATE full_steps SET status='retry_wait',token=NULL,expires=NULL,consumed=consumed+?,next_at=?,failure_code=? WHERE id=?",
                      (self._elapsed(row), self.clock() + delay, code, row['id']))
            quality = policy['quality'].setdefault(row['id'], {'total': 0, 'ack': 0})
            if code == 'quality':
                quality['total'] += 1
            else:
                quality['ack'] = quality['total']
            self._save_policy(c, policy)
            c.execute("UPDATE full_reports SET status='retry_wait',failure_code=? WHERE id=?", (code, row['report_id']))
            self._event(c, row['report_id'], 'retry_wait', row['stage'], row['part'], code)
            if policy['state'] == 'pause_requested':
                self._pause_policy(c, report, policy, policy['pause_reason'])
            elif not retryable:
                self._pause_policy(c, report, policy, code)
            else:
                self._after_settlement(c, row['report_id'])
            return
        again = retryable and row['attempts'] < _effective_limit(report['max_attempts'], self.max_attempts)
        state = 'retry_wait' if again else 'failed'
        delay = self.backoff[min(max(row['attempts'] - 1, 0), len(self.backoff) - 1)] if again else 0
        c.execute('UPDATE full_steps SET status=?,token=NULL,expires=NULL,consumed=consumed+?,next_at=?,failure_code=? WHERE id=?',
                  (state, self._elapsed(row), self.clock() + delay, code, row['id']))
        c.execute('UPDATE full_reports SET status=?,failure_code=? WHERE id=?',
                  (state, code, row['report_id']))
        self._event(c, row['report_id'], state, row['stage'], row['part'], code)

    def _recover(self, c):
        expired = c.execute("SELECT * FROM full_steps WHERE status='running' AND (expires<=? OR deadline<=?)",
                            (self.clock(), self.clock())).fetchall()
        for row in expired:
            self._fail(c, row, 'timeout' if row['deadline'] <= self.clock() else 'worker_crash', True)
        # Waiting/backoff/manual pauses consume wall lifetime, not work time.
        # Do not interrupt a valid in-flight result; its fixed deadline already
        # includes the wall and remaining work limits.
        idle = c.execute("""SELECT r.* FROM full_reports r JOIN full_execution_policies p ON p.report_id=r.id
            WHERE r.status NOT IN ('completed','cancelled') AND p.state='active'
            AND NOT EXISTS(SELECT 1 FROM full_steps s WHERE s.report_id=r.id AND s.status='running')""").fetchall()
        for report in idle:
            self._after_settlement(c, report['id'])

    def claim(self, ttl=120, timeout=180, synthetic=None):
        for x in (ttl, timeout):
            if not isinstance(x, (int, float)) or not math.isfinite(x) or not 0 < x <= 7200:
                raise ValueError('invalid lease/deadline')
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            self._recover(c)
            rows = c.execute("""SELECT s.* FROM full_steps s JOIN full_reports r ON r.id=s.report_id
                WHERE r.status NOT IN ('failed','completed','cancelled','paused','pause_requested') AND (? IS NULL OR r.synthetic=?) AND s.status IN ('pending','retry_wait')
                AND s.next_at<=? AND NOT EXISTS(SELECT 1 FROM full_steps p
                  WHERE p.report_id=s.report_id AND p.ordinal<s.ordinal AND p.status!='done')
                ORDER BY r.created_at,s.ordinal""", (synthetic, synthetic, self.clock())).fetchall()
            for row in rows:
                report = dict(c.execute('SELECT * FROM full_reports WHERE id=?', (row['report_id'],)).fetchone())
                policy = self._policy(c, row['report_id'])
                if policy is not None:
                    if self._city_held(c, report):
                        continue
                    _, limits, usage, reason = self._policy_numbers(c, report, policy)
                    if reason:
                        self._pause_policy(c, report, policy, reason)
                        continue
                    remaining = limits['task_work_seconds'] - usage['work_seconds']
                    stage_left = limits['stage_work_seconds'] - usage['current_stage_work_seconds']
                    wall_left = report['created_at'] + limits['wall_seconds'] - self.clock()
                    attempt_time = min(timeout, limits['attempt_deadline_seconds'], wall_left)
                else:
                    attempt_time = timeout
                    consumed = c.execute('SELECT COALESCE(SUM(consumed),0) FROM full_steps WHERE report_id=?', (row['report_id'],)).fetchone()[0]
                    stage_used = c.execute('SELECT COALESCE(SUM(consumed),0) FROM full_steps WHERE report_id=? AND stage=?', (row['report_id'], row['stage'])).fetchone()[0]
                    remaining = _effective_limit(report['task_budget'], self.task_budget) - consumed
                    stage_left = _effective_limit(report['stage_budget'], self.stage_budget) - stage_used
                if min(remaining, stage_left) <= 0:
                    c.execute("UPDATE full_reports SET status='failed',failure_code='budget_exhausted' WHERE id=?", (row['report_id'],))
                    c.execute("UPDATE full_steps SET status='failed',failure_code='budget_exhausted' WHERE id=?", (row['id'],))
                    self._event(c, row['report_id'], 'failed', row['stage'], row['part'], 'budget_exhausted')
                    continue
                now = self.clock()
                deadline = now + min(attempt_time, remaining, stage_left)
                token = secrets.token_hex(24)
                c.execute("UPDATE full_steps SET status='running',attempts=attempts+1,token=?,expires=?,deadline=?,started_at=? WHERE id=?",
                          (token, min(now + ttl, deadline), deadline, now, row['id']))
                c.execute("UPDATE full_reports SET status='running',heartbeat_at=?,failure_code=NULL WHERE id=?", (now, row['report_id']))
                self._event(c, row['report_id'], 'started', row['stage'], row['part'])
                context_row = c.execute('SELECT payload,sha256 FROM full_input_context WHERE report_id=?', (row['report_id'],)).fetchone()
                input_context = None
                if context_row:
                    try:
                        if hashlib.sha256(context_row['payload'].encode()).hexdigest() != context_row['sha256']:
                            raise ValueError('workspace materials integrity failure')
                        from .user_materials import validate_snapshot
                        input_context = validate_snapshot(json.loads(context_row['payload']))
                    except (ValueError, TypeError):
                        if policy is not None:
                            actual = c.execute('SELECT * FROM full_steps WHERE id=?', (row['id'],)).fetchone()
                            self._fail(c, actual, 'artifact', False)
                        else:
                            c.execute("UPDATE full_reports SET status='failed',failure_code='artifact' WHERE id=?", (row['report_id'],))
                            c.execute("UPDATE full_steps SET status='failed',token=NULL,expires=NULL,failure_code='artifact' WHERE id=?", (row['id'],))
                            self._event(c, row['report_id'], 'failed', row['stage'], row['part'], 'artifact')
                        continue
                return {'report_id': row['report_id'], 'step_id': row['id'], 'stage': row['stage'],
                        'part': row['part'], 'attempts': row['attempts'] + 1, 'token': token,
                        'deadline': deadline, 'tenant': report['tenant'], 'province': report['province'],
                        'city': report['city'], 'synthetic': bool(report['synthetic']),
                        'request_key': report['request_key'],
                        'mode': (json.loads(report['definition']) or [{}])[0].get('report_mode', 'standard'),
                        'definition': json.loads(report['definition']),
                        'input_context': input_context}
        return None

    def heartbeat(self, sid, token, ttl=120):
        if not isinstance(ttl, (int, float)) or not math.isfinite(ttl) or not 0 < ttl <= 7200:
            raise ValueError('invalid ttl')
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            row = self._owned(c, sid, token)
            if not row:
                return False
            c.execute('UPDATE full_steps SET expires=? WHERE id=?',
                      (min(self.clock() + ttl, row['deadline']), sid))
            c.execute('UPDATE full_reports SET heartbeat_at=? WHERE id=?',
                      (self.clock(), row['report_id']))
            return True

    def finish_part(self, sid, token, output):
        if (not isinstance(output, dict) or not isinstance(output.get('text'), str)
                or not output['text'].strip() or not isinstance(output.get('metadata'), dict)):
            raise ValueError('invalid part output')
        raw = json.dumps(output, ensure_ascii=False, allow_nan=False)
        if len(raw.encode()) > 2_000_000:
            raise ValueError('part output too large')
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            row = self._owned(c, sid, token)
            if not row or row['stage'] == '__bundle__':
                return False
            c.execute("UPDATE full_steps SET status='done',output=?,consumed=consumed+?,token=NULL,expires=NULL,failure_code=NULL WHERE id=?",
                      (raw, self._elapsed(row), sid))
            c.execute("UPDATE full_reports SET status='queued',progress_at=?,failure_code=NULL WHERE id=?",
                      (self.clock(), row['report_id']))
            self._event(c, row['report_id'], 'checkpoint', row['stage'], row['part'])
            self._after_settlement(c, row['report_id'])
            return True

    def fail_part(self, sid, token, code, retryable=True):
        if code not in CODES:
            raise ValueError('unsafe failure code')
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            row = self._owned(c, sid, token)
            if not row:
                return False
            self._fail(c, row, code, retryable)
            return True

    def repair_invalid_checkpoints(self, sid, token):
        """Archive a defective committed suffix and revoke it under a live lease.

        The store rechecks committed bytes inside the same serialized
        transaction that performs the rewind. Attempts, consumed work and the
        last real progress timestamp survive; cancellation and stale workers
        cannot revive or overwrite the task.
        """
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            owned = self._owned(c, sid, token)
            if not owned:
                return False
            rid = owned['report_id']
            report = c.execute('SELECT status FROM full_reports WHERE id=?', (rid,)).fetchone()
            if not report or report['status'] in ('failed', 'completed', 'cancelled', 'paused', 'pause_requested'):
                return False
            committed = c.execute("SELECT * FROM full_steps WHERE report_id=? AND status='done' AND stage!='__bundle__' ORDER BY ordinal",
                                  (rid,)).fetchall()
            invalid = None
            for checkpoint in committed:
                reason = _checkpoint_issue(checkpoint['output'], checkpoint['stage'], checkpoint['part'])
                if reason:
                    invalid = checkpoint, reason
                    break
            if invalid is None:
                return False
            checkpoint, reason = invalid
            # An owned claim must follow the committed checkpoint it replaces.
            # Never revoke unrelated or newly committed work ahead of it.
            if checkpoint['ordinal'] >= owned['ordinal']:
                return False
            now = self.clock()
            suffix = c.execute('SELECT * FROM full_steps WHERE report_id=? AND ordinal>=? ORDER BY ordinal',
                               (rid, checkpoint['ordinal'])).fetchall()
            for previous in suffix:
                raw = previous['output']
                if raw is None:
                    continue
                checksum = hashlib.sha256(raw.encode('utf-8')).hexdigest()
                c.execute('''INSERT INTO full_checkpoint_archive
                    (report_id,step_id,ordinal,stage,part,attempts,consumed,output,output_sha256,archived_at,reason)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING''',
                          (rid, previous['id'], previous['ordinal'], previous['stage'], previous['part'],
                           previous['attempts'], previous['consumed'], raw, checksum, now, reason))
            c.execute('UPDATE full_steps SET consumed=consumed+? WHERE id=?',
                      (self._elapsed(owned), sid))
            c.execute("""UPDATE full_steps SET status='pending',output=NULL,token=NULL,expires=NULL,
                deadline=NULL,started_at=NULL,next_at=0,failure_code=NULL
                WHERE report_id=? AND ordinal>=?""", (rid, checkpoint['ordinal']))
            c.execute("UPDATE full_reports SET status='queued',failure_code=NULL WHERE id=?", (rid,))
            self._event(c, rid, 'checkpoint_repaired', checkpoint['stage'], checkpoint['part'], reason)
            self._after_settlement(c, rid)
            return True

    def parts(self, rid):
        """Internal worker access only: validated persisted substep outputs."""
        with self.db() as c:
            rows = c.execute("SELECT stage,output FROM full_steps WHERE report_id=? AND status='done' AND stage!='__bundle__' ORDER BY ordinal", (rid,)).fetchall()
            result = {}
            for row in rows:
                result.setdefault(row['stage'], []).append(json.loads(row['output']))
        return result

    def cancel(self, tenant, rid):
        """Revoke leases immediately, retaining completed research checkpoints."""
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT status FROM full_reports WHERE id=? AND tenant=?', (rid, tenant)).fetchone()
            if not row or row['status'] in ('completed', 'cancelled'):
                return False
            if self._policy(c, rid) is not None:
                active = c.execute("SELECT * FROM full_steps WHERE report_id=? AND status='running'", (rid,)).fetchall()
                for step in active:
                    c.execute('UPDATE full_steps SET consumed=consumed+? WHERE id=?', (self._elapsed(step), step['id']))
            c.execute("UPDATE full_steps SET status='cancelled',token=NULL,expires=NULL WHERE report_id=? AND status!='done'", (rid,))
            c.execute("UPDATE full_reports SET status='cancelled',failure_code='cancelled' WHERE id=?", (rid,))
            self._event(c, rid, 'cancelled', code='cancelled')
            return True

    def resume_configuration(self, tenant, rid):
        """Explicit operator retry after credentials/configuration are repaired."""
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT status,failure_code FROM full_reports WHERE id=? AND tenant=?', (rid, tenant)).fetchone()
            if self._policy(c, rid) is not None:
                return False
            if not row or row['status'] != 'failed' or row['failure_code'] != 'configuration':
                return False
            c.execute("UPDATE full_steps SET status='pending',next_at=0,token=NULL,expires=NULL,failure_code=NULL WHERE report_id=? AND status='failed'", (rid,))
            c.execute("UPDATE full_reports SET status='queued',failure_code=NULL WHERE id=?", (rid,))
            self._event(c, rid, 'configuration_resumed')
            return True

    def complete(self, sid, token, manifest):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            row = self._owned(c, sid, token)
            if not row or row['stage'] != '__bundle__' or self.artifact_root is None:
                return False
            if c.execute("SELECT COUNT(*) FROM full_steps WHERE report_id=? AND stage!='__bundle__' AND status!='done'", (row['report_id'],)).fetchone()[0]:
                return False
            report = c.execute('SELECT synthetic FROM full_reports WHERE id=?', (row['report_id'],)).fetchone()
            if (not isinstance(manifest, dict) or manifest.get('report_id') != row['report_id']
                    or manifest.get('synthetic') is not bool(report['synthetic'])):
                return False
        # Filesystem validation must not hold the database's write lock.
        from .full_artifacts import verify_bundle
        try:
            if not verify_bundle(self.artifact_root, row['report_id'], manifest):
                return False
        except (OSError, ValueError, KeyError, TypeError):
            return False
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            row = self._owned(c, sid, token)
            if not row:
                return False
            c.execute("UPDATE full_steps SET status='done',token=NULL,expires=NULL,consumed=consumed+? WHERE id=?", (self._elapsed(row), sid))
            c.execute("UPDATE full_reports SET status='completed',manifest=?,progress_at=?,failure_code=NULL WHERE id=?", (json.dumps(manifest, ensure_ascii=False), self.clock(), row['report_id']))
            self._event(c, row['report_id'], 'completed')
            return True

    def get(self, tenant, rid):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            self._recover(c)
            row = c.execute('SELECT * FROM full_reports WHERE id=? AND tenant=?', (rid, tenant)).fetchone()
            if not row:
                return None
            steps = c.execute('SELECT stage,part,status,attempts,next_at,failure_code FROM full_steps WHERE report_id=? ORDER BY ordinal', (rid,)).fetchall()
            current = next((dict(s) for s in steps if s['status'] != 'done'), None)
            research = [s for s in steps if s['stage'] != '__bundle__']
            stages = json.loads(row['definition'])
            stage_done = sum(all(s['status'] == 'done' for s in research if s['stage'] == stage['id']) for stage in stages)
            events = c.execute('SELECT at,kind,stage,part,code FROM full_events WHERE report_id=? ORDER BY id DESC LIMIT 30', (rid,)).fetchall()
            return {'id': rid, 'version': row['version'], 'province': row['province'],
                    'mode': (stages or [{}])[0].get('report_mode', 'standard'),
                    'city': row['city'], 'synthetic': bool(row['synthetic']), 'status': row['status'],
                    'created_at': row['created_at'], 'progress_at': row['progress_at'],
                    'heartbeat_at': row['heartbeat_at'], 'parts_done': sum(s['status'] == 'done' for s in research),
                    'parts_total': len(research), 'stages_done': stage_done, 'stages_total': len(stages),
                    'current': current, 'failure_code': row['failure_code'], 'eta_seconds': None,
                    'publication_status': 'unpublished', 'events': [dict(e) for e in events],
                    'manifest': json.loads(row['manifest']) if row['manifest'] else None,
                    'policy_projection': self._policy_projection(c, row)}

    def list_reports(self, tenant, limit=50):
        limit = max(1, min(int(limit), 100))
        with self.db() as c:
            ids = [r[0] for r in c.execute('SELECT id FROM full_reports WHERE tenant=? ORDER BY created_at DESC LIMIT ?', (tenant, limit))]
        return [self.get(tenant, rid) for rid in ids]
