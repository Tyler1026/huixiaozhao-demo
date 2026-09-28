# Identity browser acceptance — restricted local entry

Implemented page.py extracting only the existing login layout from index.html. It deliberately strips demo credentials and public registration and never serves the old inline application, account tables or cache startup. tenant-page.js uses the real identity client for login, session restoration, scoped project read and internal-note save. Empty organizations show preparation pending, never auto-provision a city. This is a restricted integration view, NOT full production-page migration.

/auth/session restores a stable per-session CSRF value derived from the opaque token. Login and resume use the same derivation so opening another tab does not invalidate the first tab's CSRF. Tokens remain hash-only in storage; response is no-store. Host and supplied Origin checks apply. Local harness is not publicly deployable.

Manual Preview acceptance against tests/manual_identity_server.py:
- Logged in through reused login form as synthetic test-a.
- Displayed synthetic city, changed internal note and clicked Save.
- Snapshot displayed saved confirmation.
- Reloaded page: session restored without password and saved note remained.
- Logged out, logged in as synthetic test-b: different org ID and preparation-pending state; no account A project or note visible.

The manual server creates only a temporary synthetic database. Fixed credentials in this test fixture are synthetic, not application defaults. No production secrets/data used. Existing production server.py/index.html/ops.html are unchanged.

Outstanding: full knowledge/report/upload/AI/management UI and handlers, memberships/service identities, migration import and production deployment controls. The restricted view must not replace the production website. Most legacy endpoints are denied, not fully implemented. New work after d3fae71 is local and not yet reflected in draft PR #2.
