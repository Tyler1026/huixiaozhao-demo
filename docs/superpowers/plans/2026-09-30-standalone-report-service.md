# Standalone Report Service Implementation Plan

**Goal:** Run a report job through an independent Python API and worker without Violoop runtime dependencies, with durable checkpoints and isolated acceptance.

**Architecture:** Separate store, HTTP boundary, worker, and provider adapter. SQLite is the explicit single-host pilot storage; production PostgreSQL migration is deferred, not implied complete. The existing website, external scripts and Agenda configuration remain untouched.

**Tech Stack:** Python standard library, sqlite3 transactions, urllib HTTPS, unittest, subprocess acceptance.

## File ownership

- `report_service/store.py`: idempotency, tenant scope, atomic claims, leases, checkpoints, completion.
- `report_service/api.py`: authenticated submission/status endpoints, validation and safe errors.
- `report_service/worker.py` and `__main__.py`: independent CLI and stage orchestration.
- `report_service/providers.py`: explicit synthetic and live model/search adapters.
- `tests/test_report_service_core.py`: state, recovery, HTTP and worker behavior.
- `tests/test_report_service_providers.py`: fake-transport protocol and failure tests.
- `tests/test_report_service_independence.py`: architectural import boundary.
- `tests/test_report_service_acceptance.py`: clean-environment API/worker subprocess completion and API restart persistence.

## Ordered execution and checks

1. Inspect current main and dirty identity work; create isolated worktree from 9776ad0. Do not discard or copy unrelated identity edits.
2. Write contract tests before modules. Run `python -m unittest discover -s tests -p 'test_report_service_core.py' -v` and record missing-feature failure. Independently do the same for provider tests.
3. Implement store/HTTP/worker and provider adapter under nonoverlapping ownership. Default HTTP host must be loopback; no wildcard CORS; API token must come from environment. Live calls require explicit enable and configured endpoints.
4. Run the two focused suites. Failures are not completion; correct code before aggregate tests.
5. Run `python -m unittest discover -s tests -p 'test_report_service_acceptance.py' -v` using shipped synthetic provider, a temporary DB and a stripped environment. It must submit, complete, stop API, restart API and read the exact stored result.
6. Run `python -m unittest discover -s tests -p 'test_*.py' -v` then `node --test tests/test_*.cjs` and `python scripts/build_frontend.py --check`. Keep each command's exit status visible.
7. Review new modules for fencing, retry bounds, tenant checks and secret exposure. Add regression tests before correcting discovered defects. Check tracked diff remains empty for original application paths.
8. Update the runbook with exact implemented CLI flags and evidence counts. Do not commit, push, deploy or run paid research without the applicable confirmation.

## Completed baseline evidence

- Original Python regression suite: 41 passed.
- Original Node suite: 14 passed.
- Generated frontend check passed; no original page modifications.
- Independence tests and subprocess acceptance initially failed because standalone implementation was absent: red phase recorded.

## Required distinctions in delivery

Synthetic completion verifies orchestration, not city research quality. Search snippets are not original-source verification. API/worker separation on one host is not multi-container PostgreSQL acceptance. The original pending Songjiang request is not consumed by this pilot.
