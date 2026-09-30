"""Durable SQLite store for the standalone report service pilot.

This is deliberately a local SQLite adapter, NOT the PostgreSQL production
identity path (identity/store.py). It implements:

  * tenant-scoped idempotency: a report id is sha256(tenant + idempotency_key);
    an existing id with a differing (province, city) payload is a conflict.
  * atomic claim leases with fencing: claim() atomically flips a row to
    ``running`` with a fresh random lease token and expiry; complete()/fail()
    require the *exact* lease to still be ``running`` and *unexpired*.
  * heartbeat: extends the expiry of an owned (and still unexpired) lease.
  * bounded retries and crash-expiry recovery: expired ``running`` rows are
    reclaimable until attempts reach MAX_ATTEMPTS, then failed as
    ``lease_exhausted``.
  * per-stage checkpoint/resume: stage outputs are persisted in a separate
    table and returned on claim so a restarted worker can skip finished stages.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import secrets
import sqlite3
import time

from . import FAILURE_CODES, MAX_ATTEMPTS, STAGES

_TENANT_MAX = 128
_PROVINCE_MAX = 64
_CITY_MAX = 64
_IDEMPOTENCY_MAX = 128


class StoreConflict(ValueError):
    """Same idempotency key for a tenant but a different payload."""


def _report_id(tenant: str, idempotency_key: str) -> str:
    return hashlib.sha256(
        ("report:" + tenant + "\x00" + idempotency_key).encode("utf-8")
    ).hexdigest()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS reports(
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  province TEXT NOT NULL,
  city TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,                 -- queued|running|completed|failed
  result TEXT,                          -- final report text; only when completed
  failure_code TEXT,                    -- safe machine-readable code
  failure_message TEXT,                 -- sanitized, no raw exception/secrets
  lease TEXT,                           -- fence token (opaque secret)
  expires REAL,                         -- unix epoch; lease validity
  attempts INTEGER NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS reports_tenant_key ON reports(tenant, idempotency_key);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status, expires);

CREATE TABLE IF NOT EXISTS stage_checkpoints(
  report_id TEXT NOT NULL REFERENCES reports(id),
  stage TEXT NOT NULL,
  output TEXT NOT NULL,
  PRIMARY KEY(report_id, stage)
);
"""


class Store:
    def __init__(self, path):
        self.path = str(path)
        with self.db() as c:
            c.executescript(_SCHEMA)

    @contextlib.contextmanager
    def db(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    # -- public helpers ------------------------------------------------------

    def create_report(self, tenant, province, city, idempotency_key):
        """Idempotently create a report. Returns a public dict, with
        ``created=True`` for a new row and ``False`` for a replayed request."""
        tenant = _validate_text(tenant, "tenant", _TENANT_MAX)
        province = _validate_text(province, "province", _PROVINCE_MAX)
        city = _validate_text(city, "city", _CITY_MAX)
        idempotency_key = _validate_text(idempotency_key, "idempotency_key", _IDEMPOTENCY_MAX)

        rid = _report_id(tenant, idempotency_key)
        now = time.time()
        with self.db() as c:
            c.execute("BEGIN IMMEDIATE")
            existing = c.execute("SELECT province, city FROM reports WHERE id=?", (rid,)).fetchone()
            if existing:
                if existing["province"] != province or existing["city"] != city:
                    raise StoreConflict("request id conflict")
                row = c.execute("SELECT * FROM reports WHERE id=?", (rid,)).fetchone()
                return _public(dict(row), created=False)

            c.execute(
                "INSERT INTO reports(id, tenant, province, city, idempotency_key, status,"
                " attempts, created_at, updated_at)"
                " VALUES(?,?,?,?,?,'queued',0,?,?)",
                (rid, tenant, province, city, idempotency_key, now, now),
            )
        return self.get_report(tenant, rid) | {"created": True}

    def get_report(self, tenant, report_id):
        """Public view, scoped to ``tenant``. ``result`` is only present when
        completed; failures expose a safe code/message, never raw exceptions."""
        with self.db() as c:
            row = c.execute("SELECT * FROM reports WHERE id=? AND tenant=?", (report_id, tenant)).fetchone()
            if not row:
                return None
            return _public(dict(row))

    # -- worker lease lifecycle ---------------------------------------------

    def claim(self, ttl=120.0):
        """Atomically claim the next eligible job, returning it with a fresh
        lease and any existing checkpoints, or None when nothing is claimable."""
        if not isinstance(ttl, (int, float)) or not 0 < ttl <= 600:
            raise ValueError("invalid lease ttl")
        now = time.time()
        lease = secrets.token_hex(24)
        with self.db() as c:
            # Fail rows whose retries are exhausted and lease lapsed.
            c.execute(
                "UPDATE reports SET status='failed', failure_code='lease_exhausted',"
                " failure_message='worker lease exhausted', lease=NULL,"
                " updated_at=? WHERE status='running' AND expires<? AND attempts>=?",
                (now, now, MAX_ATTEMPTS),
            )
            row = c.execute(
                "SELECT id FROM reports WHERE status='queued'"
                " OR (status='running' AND expires<? AND attempts<?) ORDER BY created_at LIMIT 1",
                (now, MAX_ATTEMPTS),
            ).fetchone()
            if not row:
                return None
            n = c.execute(
                "UPDATE reports SET status='running', lease=?, expires=?,"
                " attempts=attempts+1, updated_at=? WHERE id=? AND"
                " (status='queued' OR (status='running' AND expires<? AND attempts<?))",
                (lease, now + ttl, now, row["id"], now, MAX_ATTEMPTS),
            ).rowcount
            if not n:
                # Lost a race with another claimer.
                return None
            job = dict(c.execute(
                "SELECT * FROM reports WHERE id=?", (row["id"],)
            ).fetchone())
            checkpoints = {
                r["stage"]: r["output"]
                for r in c.execute(
                    "SELECT stage, output FROM stage_checkpoints WHERE report_id=?",
                    (row["id"],),
                ).fetchall()
            }
        return {
            "id": job["id"],
            "tenant": job["tenant"],
            "province": job["province"],
            "city": job["city"],
            "idempotency_key": job["idempotency_key"],
            "lease": lease,
            "attempts": job["attempts"],
            "checkpoints": checkpoints,
        }

    def heartbeat(self, report_id, lease, ttl=120.0):
        """Extend an owned, still-unexpired lease. Requires exact lease match
        and that the lease has not already lapsed (fencing)."""
        if not isinstance(ttl, (int, float)) or not 0 < ttl <= 600:
            raise ValueError("invalid lease ttl")
        now = time.time()
        with self.db() as c:
            n = c.execute(
                "UPDATE reports SET expires=?, updated_at=? WHERE id=? AND lease=?"
                " AND status='running' AND expires>?",
                (now + ttl, now, report_id, lease, now),
            ).rowcount
            return n == 1

    def checkpoint(self, report_id, lease, stage, output):
        """Persist a stage output. Requires a valid unexpired lease; unknown
        stages are rejected. Re-running a stage overwrites its checkpoint."""
        if stage not in STAGES:
            return False
        if not isinstance(output, str) or not output.strip():
            raise ValueError("invalid stage output")
        now = time.time()
        with self.db() as c:
            c.execute("BEGIN IMMEDIATE")
            owned = c.execute(
                "SELECT 1 FROM reports WHERE id=? AND lease=? AND status='running' AND expires>?",
                (report_id, lease, now),
            ).fetchone()
            if not owned:
                return False
            c.execute(
                "INSERT INTO stage_checkpoints(report_id, stage, output) VALUES(?,?,?)"
                " ON CONFLICT(report_id, stage) DO UPDATE SET output=excluded.output",
                (report_id, stage, output),
            )
            c.execute("UPDATE reports SET updated_at=? WHERE id=?", (now, report_id))
            return True

    def complete(self, report_id, lease, result):
        """Mark completed and persist the final report. Fails (returns False)
        unless the lease is exact, still running, and *unexpired*."""
        if not isinstance(result, str) or not result.strip():
            raise ValueError("invalid completed result")
        now = time.time()
        with self.db() as c:
            n = c.execute(
                "UPDATE reports SET status='completed', result=?, lease=NULL,"
                " failure_code=NULL, failure_message=NULL, updated_at=?"
                " WHERE id=? AND lease=? AND status='running' AND expires>?",
                (result, now, report_id, lease, now),
            ).rowcount
            return n == 1

    def fail(self, report_id, lease, code, message):
        """Mark failed with a safe code/message. Same fencing rules as
        complete(): requires exact lease, running, and unexpired."""
        if code not in FAILURE_CODES:
            raise ValueError("invalid failure code")
        if not isinstance(message, str) or not message or len(message) > 500:
            raise ValueError("invalid failure message")
        now = time.time()
        with self.db() as c:
            n = c.execute(
                "UPDATE reports SET status='failed', failure_code=?, failure_message=?,"
                " lease=NULL, updated_at=? WHERE id=? AND lease=? AND status='running' AND expires>?",
                (code, message, now, report_id, lease, now),
            ).rowcount
            return n == 1

    def retry_failed(self, tenant, report_id):
        """Explicit, tenant-scoped retry retaining checkpoints and attempt budget."""
        with self.db() as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute("SELECT * FROM reports WHERE id=? AND tenant=?",
                            (report_id, tenant)).fetchone()
            if row is None:
                return None
            if row['status'] != 'failed' or row['attempts'] >= MAX_ATTEMPTS:
                raise StoreConflict('report is not retryable')
            c.execute("UPDATE reports SET status='queued', failure_code=NULL, "
                      "failure_message=NULL, lease=NULL, expires=NULL, updated_at=? WHERE id=?",
                      (time.time(), report_id))
        return self.get_report(tenant, report_id)


def _public(row, created=None):
    """Project a row to the public result shape."""
    out = {
        "id": row["id"],
        "province": row["province"],
        "city": row["city"],
        "status": row["status"],
        "result": row["result"] if row["status"] == "completed" else None,
        "error": (
            {"code": row["failure_code"], "message": row["failure_message"]}
            if row["status"] == "failed"
            else None
        ),
        "attempts": row["attempts"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    if created is not None:
        out["created"] = created
    return out


def _validate_text(value, field, limit):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"invalid {field}")
    value = value.strip()
    if len(value) > limit:
        raise ValueError(f"invalid {field}")
    return value
