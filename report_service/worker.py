"""Report worker: claim a job, run the static stage pipeline with heartbeat
and per-stage checkpoint/resume, then complete or fail with a safe code.

Provider contract (owned by a sibling agent, imported lazily at worker runtime):

    report_service.providers.SyntheticProvider()          # clearly-not-real output
    report_service.providers.OpenAIResearchProvider.from_env()

A provider must be callable as ``provider.run(stage: str, job: dict, prior: dict)
-> str`` where ``job`` carries at least ``city`` and ``province`` and ``prior``
maps earlier stage names to their outputs. ``synthetic`` output must prominently
label itself as not real (the provider's responsibility).
"""

from __future__ import annotations

import importlib
import json
import os
import threading
import time

from . import MAX_ATTEMPTS, STAGES
from .store import Store

_LIVE_ENABLE_VAR = "HXZ_ENABLE_LIVE"


class WorkerError(RuntimeError):
    pass


def load_provider(name, env=None):
    """Resolve a provider lazily. Supports:

    * ``synthetic`` -> SyntheticProvider() (other agent's module)
    * ``live``       -> OpenAIResearchProvider.from_env(); fails closed unless
                        HXZ_ENABLE_LIVE == "1" (and from_env() succeeds).
    * ``module:func``-> a dotted import path returning a provider (for tests).
    """
    env = os.environ if env is None else env
    if name == "synthetic":
        from report_service.providers import SyntheticProvider  # lazy

        return SyntheticProvider()
    if name == "live":
        if env.get(_LIVE_ENABLE_VAR) != "1":
            raise WorkerError("live provider disabled (HXZ_ENABLE_LIVE != 1)")
        from report_service.providers import OpenAIResearchProvider  # lazy

        return OpenAIResearchProvider.from_env(env)
    if ":" in name:
        mod_name, _, func_name = name.partition(":")
        if not mod_name or not func_name:
            raise ValueError("invalid provider spec")
        module = importlib.import_module(mod_name)
        return getattr(module, func_name)()
    raise ValueError(f"unknown provider: {name!r}")


def _heartbeat_thread(store, report_id, lease, ttl, stop):
    interval = max(0.001, ttl / 4.0)
    while not stop.wait(interval):
        try:
            if not store.heartbeat(report_id, lease, ttl):
                return
        except Exception:
            return  # Subsequent fenced writes must still prove lease ownership.


def run_once(store, provider, ttl=120.0):
    """Claim one job and run it to a terminal state. Returns a summary dict, or
    None when there is nothing to claim."""
    if not isinstance(store, Store):
        raise WorkerError("store must be a report_service.store.Store")

    job = store.claim(ttl=ttl)
    if not job:
        return None

    rid = job["id"]
    lease = job["lease"]
    prior = dict(job["checkpoints"])

    summary = {"id": rid, "status": "running"}

    try:
        for stage in STAGES:
            if stage in job["checkpoints"]:
                continue  # resume: already persisted by a previous attempt
            if not store.heartbeat(rid, lease, ttl):
                return {'id': rid, 'status': 'lost_lease'}
            stop = threading.Event()
            beat = threading.Thread(
                target=_heartbeat_thread, args=(store, rid, lease, ttl, stop), daemon=True
            )
            beat.start()
            try:
                output = provider.run(stage, job, prior)
            finally:
                stop.set()
                beat.join(timeout=ttl)
            if not isinstance(output, str) or not output.strip():
                raise WorkerError(f"provider returned empty output for stage {stage}")
            if not store.checkpoint(rid, lease, stage, output):
                summary = {"id": rid, "status": "lost_lease"}
                return summary
            prior[stage] = output

        if store.complete(rid, lease, prior[STAGES[-1]]):
            summary = {"id": rid, "status": "completed"}
        else:
            summary = {"id": rid, "status": "lost_lease"}
    except Exception:
        # Never leak raw exceptions or secrets into the public failure surface.
        marked = store.fail(rid, lease, "provider_error", "provider stage failed")
        summary = {"id": rid, "status": "failed" if marked else "lost_lease"}
    return summary


def run_loop(store, provider, ttl=120.0, once=False, poll_interval=1.0):
    """Claim and process jobs until interrupted (or once)."""
    if once:
        return run_once(store, provider, ttl=ttl)
    processed = 0
    while True:
        summary = run_once(store, provider, ttl=ttl)
        if summary is None:
            time.sleep(poll_interval)
            continue
        processed += 1
        if summary["status"] != "completed":
            # Surface terminal failures once; stop on fatal outcomes.
            return summary
    return {"processed": processed}
