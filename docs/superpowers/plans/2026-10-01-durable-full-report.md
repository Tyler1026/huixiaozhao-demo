# Durable Full Report Implementation Plan

> For agentic workers: execute with test-first, isolated file ownership, and evidence before completion.

**Goal:** Preserve the full 16-file research contract and Word output while moving task control out of Agenda.

**Architecture:** Version full-v1 alongside the existing pilot. Persist each research substep and a fenced bundle-delivery step in separate SQLite tables. Execute provider work in disposable processes with absolute deadlines. Expose authenticated status and verified artifacts without enabling the old site's anonymous sync bridge.

**Tech Stack:** Python stdlib SQLite/multiprocessing/HTTP, existing python-docx exporter.

## Ownership

- Operator full-contract-provider: full_contract.py, full_provider.py and corresponding tests.
- Operator full-artifacts: full_artifacts.py, optional word_export.py and corresponding tests.
- Parent: full_store.py, full_worker.py, full_api.py, full_bridge.py, full CLI integration, deployment templates, acceptance tests and final integration.
- All work under current isolated worktree. Original production and report directories are read-only references.

## Task 1: Research contract and provider

- [ ] Write failing tests for exact16 filenames, distinct source hostnames, duplicate companies, evidence association, synthetic separation.
- [ ] Implement fixed stages and parts, validated outputs, deterministic assembly, synthetic provider and bounded live adapter.
- [ ] Run `python -m unittest discover -s tests -p 'test_full_contract.py' -v` and provider tests.
- [ ] Review candidate25 versus final15, landing checks, independent fact checks, deterministic scores and evidence-qualified pitches.

## Task 2: Artifact packaging

- [ ] Write failing tests for absent files, traversal, symlinks, tampering, idempotent identical bundles and differing-input conflict.
- [ ] Implement atomic task-scoped publication with SHA256 manifest and the original Word formatting.
- [ ] Run `python -m unittest discover -s tests -p 'test_full_artifacts.py' -v`.

## Task 3: Durable execution store

- [ ] Tests first: queued job claim, competing claim, expired lease rejects completion, persisted attempts, due-time backoff, per-stage and report execution budgets.
- [ ] Add isolated full_reports/full_steps/full_events tables. No migrations changing pilot reports.
- [ ] Steps carry stored part order, attempt counts, hard deadline and unforgeable lease; heartbeat cannot extend hard deadline or update progress_at.
- [ ] Persist outcome and safe events atomically; exhausted steps fail explicitly. Bundle completion checks all research steps and verified artifacts.
- [ ] Run `python -m unittest discover -s tests -p 'test_full_store.py' -v`.

## Task 4: Worker process supervision

- [ ] Tests first: child hang terminates, crash retries, report failure does not exit loop, first8 checkpoints survive worker restart.
- [ ] Implement parent process claiming one ready part at a time and passing complete dependency outputs to a child process; no remote calls in synthetic tests.
- [ ] On deadline terminate then kill if necessary, close IPC and reap the child. Fenced writes reject late/duplicate results.
- [ ] Run worker tests and isolated subprocess acceptance.

## Task 5: Authenticated API, bridge and CLI

- [ ] Tests first: anonymous401, cross-tenant404, duplicate POST idempotency, status progress_at, verified artifact download, disabled bridge fail-closed.
- [ ] Implement versioned full-report API and CLI subcommands without changing pilot defaults.
- [ ] Bridge requires trusted principal authorization callback and explicit org credential mapping; no old sync/city/default-tenant fallback. Do not expose service credentials to frontend.
- [ ] Create isolated synthetic browser/API flow and verify download content after server restart.

## Task 6: Integration gates

- [ ] Run all Python tests and Node tests, build checks, diff-check.
- [ ] Build an entire synthetic16-file/2DOCX report; inspect Word XML and manifests independently.
- [ ] Replay transient failures, permanent hang and worker death after8 stages; compare checkpoint hashes before/after.
- [ ] Record exact outstanding production boundaries: single-host SQLite, no customer auth migration, no real model quality validation, no RAG publishing or production switch without confirmation.
- [ ] Report evidence and request production/paid validation approval only after actual isolated acceptance passes.
