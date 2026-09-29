# Batch 1 — frozen behavior-preserving refactor candidate

Base: 21baa54c943d5b04d654aafe6ab5a06a323376cd. GitHub main read through API matches this base (2026-09-29). This is repository drift verification, not a live container inspection.

## Included

- Ordered frontend source assembly, AST-safe responsibility sections and four shared pure helpers. Original delivery HTML remains byte-identical.
- Document parser, storage and pure merge boundaries.
- Explicit dependency adapters for static HTML, GET/POST sync, extract-text, history and report-file.
- Regression, AST equivalence, dependency and real HTTP composition tests.
- Docker packaging and CI build-equivalence gates.

## Acceptance

40 Python and 14 Node tests passed. Real HTTP covers both HTML pages, GET sync, text extraction, history list, report download/missing report, health, sync success, malformed input, read failure and write failure. History database response is synthetic; no real customer database used. Source build hashes remain unchanged. Whitespace check passes.

## Excluded / follow-up batches

Remaining business routes, stateful frontend/global effects, provider configuration, authentication/security modernization, dependency pinning, complete business replay and live PostgreSQL validation. No new UI, new business rules, production migration or model calls.

## Merge gates

Draft PR #3 is published. Initial head d29a1b8 passed CI and Docker build (run 36518462745). The final cleanup candidate must pass again, now including actual server.py entrypoint smoke in a network-disabled container. Local actual-entrypoint smoke passed using only a temporary file store and empty credential environment. Merging main triggers production automation and requires separate confirmation. Prior identity experiments are excluded.

## Security note

The local Git remote URL previously embedded a credential; it was accidentally emitted by a remote inspection command. The remote URL is now credential-free. It must be revoked/rotated and replaced with a credential-helper workflow. Never copy the URL into this PR. Source fragments reproduce existing baseline code; this extraction does not certify that legacy client authentication or embedded baseline configuration is secure.

Commits and PR #3 are published; no merge or production deployment performed. Six unreferenced intermediate frontend copies have been moved outside the repository to a recoverable local archive. Active source files remain governed by frontend/manifest.json; delivery HTML is unchanged.
