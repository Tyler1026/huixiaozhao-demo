# Phase 2 current status (supersedes historical progress notes)

Implemented in the draft branch: local/PG identity adapters, member addition/revocation, session recovery, tenant-scoped sync, knowledge read/edit, stored report read, machine report-delivery credential, idempotent delivery receipt, bounded pipeline client and restricted browser entry.

Verification: 46 Python tests and 15 Node tests pass locally. Six PostgreSQL tests pass independently on synthetic hxz_identity_test, including concurrent duplicate delivery returning the same receipt. Full local discovery skips these six unless explicitly configured. PostgreSQL test setup refuses another database name. Production data and restore databases were not read or modified.

Actual browser acceptance covers login, refresh restoration, internal note persistence, knowledge/report reading, logout and switching organization. Direct foreign-project requests return 404. This does NOT cover the original complete application.

Still unimplemented or incomplete: complete legacy frontend integration, document storage/parsing permissions, AI/job lifecycle integration, restricted migration of the five external production scripts, production-grade hosted HTTP/security configuration, actual old-account migration, administrator bootstrap and customer ownership resolution, invitation/questionnaire/city-package readiness. The restricted browser entry must not replace production. Existing production server/index/ops/Dockerfile remain unchanged.

Draft PR remains unmerged. Follow-up changes will be pushed after user approval; no automatic production deployment is authorized by this document. Historical notes saying specific local files were not pushed refer to their point in time, not this current branch state.
