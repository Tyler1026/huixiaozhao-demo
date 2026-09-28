# Identity foundations — local implementation, not production cutover

## Scope and actual status

Implemented offline migration preview, isolated SQLite identity/state adapter and a loopback-only HTTP integration harness. Existing server.py, Dockerfile and both production HTML pages are unchanged. No production database migration or authentication cutover has occurred.

This is a tested foundation, NOT completed phase 2. It is deliberately not deployed: SQLite, loopback cookies, local account bootstrap and the new state format are not substitutes for production PostgreSQL integration, existing UI/pipeline migration or full route authorization.

## Modules

- identity/migration.py: deterministic hashed account references; one organization proposal per normalized account; direct unique project ownership only; rejects malformed sources, flags conflicts, shared/dangling/unassigned projects. Never copies a password/contact field to output. Account hashes are pseudonyms, not guaranteed anonymous data. CLI output remains private.
- identity/store.py: PBKDF2-HMAC-SHA256 (600,000 iterations, independent random salt), hashed opaque session and CSRF tokens, expiry/revocation, explicit single dedicated admin, independent customer organizations, optimistic state version update. Database file permissions 0600. Application code passes only authenticated principals to scoped storage.
- identity/http.py: loopback-only synthetic integration API. Host/Origin checks, HttpOnly SameSite cookie, CSRF on mutations, request size limit, socket timeout, per-process login throttling. Never expose it publicly; Secure cookies and proxy-aware persistent rate controls are required for hosted integration.

## Commands

From the project root:

```sh
python -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/test_demand_submit.cjs
python scripts/check_inline_js.py ops.html index.html
python -m identity.migration /absolute/path/to/synthetic-snapshot.json
python -m identity.migration /absolute/path/to/synthetic-snapshot.json --builtin /absolute/path/to/synthetic-builtins.json
python -m identity.http --db /absolute/path/to/synthetic.sqlite --port 5062
```

The server creates an empty local database only; it has no default user/password. Tests provision synthetic accounts through Store.create_customer and Store.bootstrap_admin. No HTTP public registration or admin elevation route exists.

## Verification record

Eight identity/migration tests first failed because the new modules did not exist, then passed after implementation. Three real HTTP integration tests first failed for missing identity.http, then passed. Tests cover hash-only storage, wrong passwords, duplicate normalized accounts, independent administrator, session expiry/logout, CSRF, explicit ownership conflict, tenant denial, unknown legacy route denial, origin rejection, optimistic conflict and login throttling. HTTP tests start and stop a real loopback server with temporary synthetic SQLite files.

## Required next implementation before phase 2 completion

1. PostgreSQL adapter is now implemented in identity/postgres.py and three real tests passed in the dedicated hxz_identity_test database on staging (concurrent version race, duplicate-account rollback, isolation/persistence/revocation). Tests live in tests/test_identity_postgres.py and require explicit HXZ_TEST_DATABASE_URL with that exact database name. Production schema migration and rollback plan are still pending; no existing web process was changed.
2. Membership model and controlled multiple-member organizations; disabled/revoked users; recovery/bootstrap workflow. Current foundation intentionally has one account per org and one admin only.
3. Tenant compatibility adapter for existing uppercase state keys and all server routes; current lower-case state contract is isolated and NOT connected to old HTML.
4. Migration handling for related records, parent/child project links and cycles. Preview currently resolves direct bindings only; it must not be used to import related private data automatically.
5. Existing frontend login integration, safe cache transition, password migration and dedicated production admin initialization.
6. Restricted service identities for the five external pipeline callers. No auth-bypass legacy route may remain open in enforced mode.
7. Persistent/routed rate limiting, Secure cookies, TLS deployment, full request validation and resource controls.
8. Independent security review and browser end-to-end tests; full two-tenant endpoint matrix from phase2 design.

No account or project ownership is inferred from city. Production's unresolved ownership decisions and administrator initialization still require confirmation before cutover.
