# Reliability Baseline Implementation Plan

> Execute in the isolated worktree. No production deployment, database migration, credential rotation, push, or commit without separate approval.

**Goal:** Make known failure paths fail visibly without changing the deployed system.

**Architecture:** Preserve the existing API and pages during this first batch. Test real handler/function behavior in isolated memory with database/network boundaries replaced. No production module initialization or production data is required.

**Tech Stack:** Python unittest/AST, Node built-in test/vm, existing esprima syntax gate.

## Approved product direction

One hosted website; organizations isolate private data even within the same city. Questionnaire precedes city-package preparation. A reviewed package precedes invitation redemption and workspace access. Organization, workspace, and city are distinct concepts. Future invitation/auth/schema migrations are separate batches.

## Files and tasks

- [x] Verify original repository clean at 3a8ca6ee86d9b5cfb70044a1caadf041161a5a30.
- [x] Create /Users/ryan/projects/huixiaozhao-reliability on production/reliability-baseline.
- [x] Run original Python AST and both inline JavaScript syntax checks: pass.
- [x] tests/test_server_reliability.py: reproduce invalid sync payload persistence, failed database reads, and upload false success before modifying server.py.
- [x] server.py: stop writes after validation/merge/read failure; report failed upload persistence. Preserve success response compatibility.
- [x] tests/test_demand_submit.cjs: exercise submitDemand with pending, failed, rejected, successful and repeated submissions using the real extracted function.
- [x] index.html: await confirmed persistence, show failure, retain recoverable local data and avoid duplicate creation.
- [x] Review SSE consumers before changing terminal AI status semantics. Do not break older consumers with an uncoordinated protocol change.
- [x] Run python -m unittest discover -s tests -p 'test_*.py' -v and node --test tests/test_demand_submit.cjs.
- [x] Run python scripts/check_inline_js.py ops.html index.html and git diff --check.
- [x] Add regression commands to CI; document dependency and deployment gates.

## Verification and release constraints

This batch is not a production-readiness certificate. Tests use synthetic state, not customer data. Hosted staging, restore rehearsal, production revision verification, authentication and tenant isolation remain release gates. A green syntax check is not a business acceptance test.

## External dependency inspection

Read-only inspection confirmed these files under /Users/ryan/outputs/huixiaozhao/system use /api/sync:
- check_requests.py: GET state, POST REPORT_REQUESTS.
- sync_to_kb.py: GET state, POST PROJECTS/REPORTSTATE/CITY_ACCOUNTS and request state.
- push_requests.py: reads completed report requests.
- progress_reporter.py: reads and writes request progress.
- activity_feed.py: reads and writes request activity.

These are external to the Git repository. Their deployed execution/configuration has not been verified. Future API authentication must migrate these service clients together; never just disable their shared endpoint in production.
