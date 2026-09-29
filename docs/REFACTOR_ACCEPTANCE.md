# Refactor acceptance and remaining risks

Baseline: 21baa54c943d5b04d654aafe6ab5a06a323376cd. This is a verified incremental refactor, not certification that the whole legacy system is production-ready.

## Boundary evidence

- Static HTML responder: explicit path and responder dependencies only. Symbol-table test rejects hidden application globals. Missing file remains 404; permission errors propagate; file is closed before response starts. Real HTTP verifies government/admin exact bytes.
- Four frontend helpers: explicit parameters and JavaScript built-ins only, AST identifier gate prevents undeclared dependencies. Independent VM tests cover null, whitespace, normalization, truncation, identifier patterns and coercion. Manifest inserts original definitions at original positions, preserving output bytes and evaluation order.
- Document parser and storage/merge functions: baseline AST comparisons pass. These are relocations, not redesigns; storage still reads environment configuration at module scope. Storage tests preserve snapshot-before-overwrite, single commit, error return semantics.
- Integration: actual Handler over loopback HTTP with synthetic dependencies covers pages, health, malformed sync, merge success, failed reads and failed writes. No server top-level credential lookup or production I/O performed.

## Reproducible checks (latest run)

python -m unittest discover -s tests -q — 28 passed.
node --test tests/test_*.cjs — 14 passed.
python scripts/build_frontend.py --check — both pages exact baseline bytes.
python scripts/check_inline_js.py ops.html index.html — passed.
git diff --check — passed.

Expected negative-test logs are not application failures. Original file-handle ResourceWarning was removed by the explicit responder boundary.

## Complete inventory of remaining categories

1. HTTP business routes remain in Handler and depend on module globals; detailed scopes/global names in backend-dependency-inventory.json.
2. Frontend effects/state remain shared across AUTH, PROJECTS, cur, view, report and knowledge maps. sections.json is a source organization inventory, not proof of isolated runtime modules.
3. Storage environment injection, connection cleanup on exceptions, transaction contention and file-store concurrency remain unchanged. PostgreSQL execution was not tested in this refactor increment.
4. Security exceptions remain: browser-side password checks, legacy unauthenticated sync, health credential metadata, document-parser sandbox limitations. A byte-preserving refactor does not fix or endorse these.
5. Runtime dependencies are unpinned in the original Docker build. Pinning needs a separately verified runtime baseline, not arbitrary versions from the local machine.
6. Container build is unverified: no docker executable available on this Mac. Docker COPY/build gates were inspected and tested structurally, not executed in a container. Do not deploy without a real build.
7. Full business/browser/external-script compatibility has not been replayed. Unchanged HTML bytes provide strong frontend-output evidence but do not prove the entire deployed stack.
8. Remote production drift since baseline was not checked. No push, main merge, production deployment or customer-data migration performed.

## Work preservation

All work is in /Users/ryan/projects/huixiaozhao-refactor on refactor/behavior-preserving. The earlier identity worktree was not reset/stashed/discarded. Extracted original source fragments remain available, and root delivery HTML is unchanged.

## Decision

The explicitly extracted boundaries have passed local acceptance. Overall mature-architecture goal remains incomplete because business HTTP/stateful frontend boundaries and deployment validation remain open. Do not describe this increment as all productionization work completed.
