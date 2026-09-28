# Restricted report-service identity

Implemented local service credentials bound to one organization and one project, usable only for report delivery. Credentials are random opaque tokens, stored as SHA256 hashes with expiration, and issued/revoked only by a currently authenticated platform administrator. A service token cannot act as a customer session or read the tenant snapshot.

POST /service/report-delivery uses Bearer authentication, rejects browser cookies/Origin, accepts exactly project_id/text/version and checks the token scope again in the write transaction. Stale versions fail with 409; invalid or revoked credentials fail authentication; foreign project targets fail authorization. No production pipeline scripts have been modified or pointed at this API. Idempotent delivery IDs and job-state transitions remain required before pipeline cutover.

Also corrected an internal authorization gap: Store no longer trusts a caller-provided principal alone. Reads and writes revalidate its session and current database membership; revoked sessions and changed memberships cannot use an old cached principal. Internal session references are stripped from /auth/me and /auth/session responses.

Tests: three initially failing internal-authorization cases, three service-store cases and one real service HTTP flow now pass. Full local verification: 39 Python tests pass, three explicit PostgreSQL integration tests skipped locally; 15 Node tests pass. Current PostgreSQL additions (service_credentials table and revalidation behavior) still need rerunning against the isolated test database before claiming database acceptance.

All changes remain on the development worktree, unmerged, with production runtime files untouched. This is not completion of phase 2: full business UI, file handling, AI handlers, membership management, migration and original five external scripts remain outstanding.
