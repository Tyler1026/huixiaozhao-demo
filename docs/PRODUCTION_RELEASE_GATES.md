# Production release gates — first reliability batch

## Current scope

Development is isolated in `/Users/ryan/projects/huixiaozhao-reliability`, branch `production/reliability-baseline`, based on `3a8ca6ee86d9b5cfb70044a1caadf041161a5a30`.

No production database, credentials, deployed service or external pipeline script is changed by this batch. No deployment or repository push is authorized as part of local verification.

## Local verification

From the isolated repository run:

```sh
python -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/test_demand_submit.cjs
python scripts/check_inline_js.py ops.html index.html
git diff --check
```

Python regression tests must not initialize the production server or resolve real service credentials. Frontend tests use synthetic browser state and controlled network responses. These are not browser end-to-end or load tests.

## Before any deployment

- Identify the actual deployed commit and confirm whether Railway auto-deploys the main branch. Do not assume local HEAD equals production.
- Provision a separate staging deployment, database and file storage; use synthetic or approved de-identified data.
- Export a consistent production backup using an approved secure destination; test restoration to the isolated database and record counts, relationships and file readability.
- Verify successful and failed requests in a real browser, including refresh, duplicate clicks and retries.
- Verify external pipeline callers handle error responses without marking incomplete jobs successful.
- Record a rollback revision. This batch introduces no schema migration, but restoration must not overwrite legitimate customer writes.
- Obtain explicit approval before deployment, credential rotation or production data operations.

## External pipeline dependencies

Read-only inspection on 2026-09-28 found `/api/sync` callers under `/Users/ryan/outputs/huixiaozhao/system`:

| File | Contract |
| --- | --- |
| check_requests.py | reads snapshot and updates REPORT_REQUESTS |
| sync_to_kb.py | writes PROJECTS, REPORTSTATE, CITY_ACCOUNTS and completion metadata |
| push_requests.py | reads completed reports needing publication |
| progress_reporter.py | reads and writes report progress |
| activity_feed.py | reads and writes activity |

These scripts are not in this repository. Scheduling, live execution, credentials and production compatibility are not verified. The future auth migration needs explicit service identities and coordinated endpoint transition.

## Still blocking general customer distribution

- Server-side login, password migration and organization authorization.
- Organization isolation for files, reports, chat, workspaces and jobs.
- Questionnaire → package generation → review → invitation workflow.
- Transactional/versioned business writes instead of whole-store snapshots.
- Verified backups, restoration, monitoring and capacity limits.
- Coordinated SSE failure handling across all browser consumers; do not assume emitting an error event alone makes existing clients fail visibly.

The single JSON row, existing merge semantics and permissive endpoints are not made production-safe by these local bug fixes. Do not describe this batch as a completed production migration.
