# Tenant compatibility progress

Local changes after draft PR #2; not yet pushed or deployed.

Implemented identity/compat.py and integrated it into the isolated identity HTTP server. GET/POST /api/sync derives the organization solely from the authenticated principal. A narrow uppercase shape (PROJECTS, REPORTSTATE, KB, DEMANDS) maps onto isolated state storage. Writes require _version and reject unknown global fields. Partial writes preserve omitted fields within the same organization.

Unknown or unsupported legacy data routes are denied; no fallback to production server.py is used. This prevents an auth bypass but is NOT feature parity: reports, knowledge upload/versioning, history, audit and pipelines still need their actual scoped implementation.

identity/client.cjs is browser-loadable and Node-testable. It keeps CSRF in memory, relies on an HttpOnly session cookie, carries the version, reports 401/409 and does not retry conflicts silently. It does not use localStorage or download password tables. A real integration test runs this exact JavaScript client against the real local HTTP server and temporary database: login, save, reload, logout and different-user isolation.

The old production HTML is not wired to this client yet. Its full persist payload contains unsupported global keys; connecting it blindly would break saves. Its startup and cache handling need a deliberate tenant-mode adapter, and unsupported feature controls must not claim availability. Browser reload session/CSRF recovery also needs an explicit endpoint or re-login flow before real UI integration.

Tests added: three compatibility HTTP tests, three client unit tests, one real JS-to-HTTP integration test. Existing HTTP unknown-route assertion now uses /api/not-enabled because /api/sync is deliberately implemented. Avoid double-counting inherited tests; fixtures are borrowed without inheriting test methods.

Remaining phase2 work: memberships and service principals; scoped file/report/AI/knowledge handlers; legacy UI login/startup/cache transition; explicit migration mapping; persistent production security controls; staged end-to-end acceptance. No production or external scheduler change occurred.
