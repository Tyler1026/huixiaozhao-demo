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
'''


class FullStore:
    def __init__(self, path, *, stages=None, artifact_root=None, clock=time.time,
                 backoff=(30, 120), max_attempts=3, task_budget=7200, stage_budget=900):
        self.path = str(Path(path).absolute())
        self.artifact_root = Path(artifact_root).absolute() if artifact_root else None
        self.stages = stages
        self.clock = clock
        if (isinstance(max_attempts, bool) or not 1 <= max_attempts <= 10 or
                not isinstance(max_attempts, int)):
            raise ValueError('invalid attempt budget')
        for n in (task_budget, stage_budget, *backoff):
            if not isinstance(n, (int, float)) or not math.isfinite(n) or n < 0:
                raise ValueError('invalid time budget')
        if not task_budget or not stage_budget or not backoff:
            raise ValueError('invalid time budget')
        self.backoff = tuple(backoff)
        self.max_attempts = max_attempts
        self.task_budget = task_budget
        self.stage_budget = stage_budget
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

    def create(self, tenant, province, city, key, synthetic=True):
        tenant, province, city, key = map(_text, (tenant, province, city, key))
        if not isinstance(synthetic, bool):
            raise ValueError('synthetic must be boolean')
        rid = hashlib.sha256(('full-v1\0' + tenant + '\0' + key).encode()).hexdigest()
        definition = json.dumps(self._definition(), ensure_ascii=False)
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            old = c.execute('SELECT * FROM full_reports WHERE id=?', (rid,)).fetchone()
            if old:
                if (old['province'], old['city'], bool(old['synthetic'])) != (province, city, synthetic):
                    raise Conflict('idempotency payload mismatch')
            else:
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
                self._event(c, rid, 'created')
        return self.get(tenant, rid) | {'created': not bool(old)}

    def _event(self, c, rid, kind, stage=None, part=None, code=None):
        c.execute('INSERT INTO full_events(report_id,at,kind,stage,part,code) VALUES(?,?,?,?,?,?)',
                  (rid, self.clock(), kind, stage, part, code))

    def _owned(self, c, sid, token):
        return c.execute("SELECT * FROM full_steps WHERE id=? AND token=? AND status='running' AND expires>? AND deadline>?",
                         (sid, token, self.clock(), self.clock())).fetchone()

    def _elapsed(self, row):
        return max(0, min(self.clock(), row['deadline']) - row['started_at'])

    def _fail(self, c, row, code, retryable):
        report = c.execute('SELECT * FROM full_reports WHERE id=?', (row['report_id'],)).fetchone()
        again = retryable and row['attempts'] < min(report['max_attempts'], self.max_attempts)
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

    def claim(self, ttl=120, timeout=180, synthetic=None):
        for x in (ttl, timeout):
            if not isinstance(x, (int, float)) or not math.isfinite(x) or not 0 < x <= 7200:
                raise ValueError('invalid lease/deadline')
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            self._recover(c)
            rows = c.execute("""SELECT s.* FROM full_steps s JOIN full_reports r ON r.id=s.report_id
                WHERE r.status NOT IN ('failed','completed') AND (? IS NULL OR r.synthetic=?) AND s.status IN ('pending','retry_wait')
                AND s.next_at<=? AND NOT EXISTS(SELECT 1 FROM full_steps p
                  WHERE p.report_id=s.report_id AND p.ordinal<s.ordinal AND p.status!='done')
                ORDER BY r.created_at,s.ordinal""", (synthetic, synthetic, self.clock())).fetchall()
            for row in rows:
                report = dict(c.execute('SELECT * FROM full_reports WHERE id=?', (row['report_id'],)).fetchone())
                consumed = c.execute('SELECT COALESCE(SUM(consumed),0) FROM full_steps WHERE report_id=?', (row['report_id'],)).fetchone()[0]
                stage_used = c.execute('SELECT COALESCE(SUM(consumed),0) FROM full_steps WHERE report_id=? AND stage=?', (row['report_id'], row['stage'])).fetchone()[0]
                remaining = min(report['task_budget'], self.task_budget) - consumed
                stage_left = min(report['stage_budget'], self.stage_budget) - stage_used
                if min(remaining, stage_left) <= 0:
                    c.execute("UPDATE full_reports SET status='failed',failure_code='budget_exhausted' WHERE id=?", (row['report_id'],))
                    c.execute("UPDATE full_steps SET status='failed',failure_code='budget_exhausted' WHERE id=?", (row['id'],))
                    self._event(c, row['report_id'], 'failed', row['stage'], row['part'], 'budget_exhausted')
                    continue
                now = self.clock()
                deadline = now + min(timeout, remaining, stage_left)
                token = secrets.token_hex(24)
                c.execute("UPDATE full_steps SET status='running',attempts=attempts+1,token=?,expires=?,deadline=?,started_at=? WHERE id=?",
                          (token, min(now + ttl, deadline), deadline, now, row['id']))
                c.execute("UPDATE full_reports SET status='running',heartbeat_at=?,failure_code=NULL WHERE id=?", (now, row['report_id']))
                self._event(c, row['report_id'], 'started', row['stage'], row['part'])
                return {'report_id': row['report_id'], 'step_id': row['id'], 'stage': row['stage'],
                        'part': row['part'], 'attempts': row['attempts'] + 1, 'token': token,
                        'deadline': deadline, 'tenant': report['tenant'], 'province': report['province'],
                        'city': report['city'], 'synthetic': bool(report['synthetic']),
                        'definition': json.loads(report['definition'])}
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

    def parts(self, rid):
        """Internal worker access only: validated persisted substep outputs."""
        with self.db() as c:
            rows = c.execute("SELECT stage,output FROM full_steps WHERE report_id=? AND status='done' AND stage!='__bundle__' ORDER BY ordinal", (rid,)).fetchall()
            result = {}
            for row in rows:
                result.setdefault(row['stage'], []).append(json.loads(row['output']))
            return result

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
                    'city': row['city'], 'synthetic': bool(row['synthetic']), 'status': row['status'],
                    'created_at': row['created_at'], 'progress_at': row['progress_at'],
                    'heartbeat_at': row['heartbeat_at'], 'parts_done': sum(s['status'] == 'done' for s in research),
                    'parts_total': len(research), 'stages_done': stage_done, 'stages_total': len(stages),
                    'current': current, 'failure_code': row['failure_code'], 'eta_seconds': None,
                    'publication_status': 'unpublished', 'events': [dict(e) for e in events],
                    'manifest': json.loads(row['manifest']) if row['manifest'] else None}

    def list_reports(self, tenant, limit=50):
        limit = max(1, min(int(limit), 100))
        with self.db() as c:
            ids = [r[0] for r in c.execute('SELECT id FROM full_reports WHERE tenant=? ORDER BY created_at DESC LIMIT ?', (tenant, limit))]
        return [self.get(tenant, rid) for rid in ids]
