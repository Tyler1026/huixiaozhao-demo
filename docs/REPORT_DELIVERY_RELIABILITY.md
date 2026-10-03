# Production report submission and delivery reliability

The existing Agenda research pipeline, report content, Word formatting, RAG
mapping, cancellation ordering and completed reports remain in place. This
repair covers submission, synchronization, progress display and downloading.

- A new request is stored separately in a browser outbox before transmission.
  Failed requests and lost responses reuse the same request ID after reload.
  A matching server read-back is required before claiming that it was saved.
  Backoff is 30 seconds followed by 120 seconds, with no overall attempt limit.
  Reconnection triggers a retry; each request has a 20-second network deadline.
  Unsaved requests are displayed separately from the server generation queue.
- A reset-generation mismatch blocks the old submission. It never silently
  replaces the recorded generation or resurrects a request after a reset.
- Sync uses the unchanged field merge rules inside one PostgreSQL row-lock
  transaction. Commit precedes the HTTP acknowledgement. Database connect,
  statement and lock waits are bounded. Local fallback uses a file lock,
  temporary file, fsync and atomic replace. Failed writes preserve old data.
- Polling refreshes progress and publication flags while status remains the
  same. Cancelled reports cannot regress to running. A fixed 40-minute promise
  and unsupported claims of automatic completion have been removed.
- Historical downloads include the exact request ID and city. An explicit
  request cannot fall back to a different report. Incomplete or corrupt files
  cannot return a successful empty download. Legacy city-only links continue
  to select the latest completed report or the existing project artifact.

## Verification

Regression coverage includes disconnected submission, browser reload, lost
acknowledgements, storage rejection, generation resets, network deadlines,
concurrent sync, commit-before-acknowledgement, rollback and artifact selection.
CI uses a disposable PostgreSQL database for real concurrent transaction tests;
its fixture credentials are not production credentials. Existing report files
are compared by SHA256 before and after production deployment.

## Remaining producer boundary

The production generator still runs outside this repository on the legacy
Agenda executor. Its referenced scripts are absent on the connected Leo Mac,
and this task has no Agenda control tool. The standalone full-v1 worker is not
connected to the production site and requires real model/search configuration.
The production service has no HXZ model/search configuration or search key, and
the connected local environment has no corresponding configuration either.
This repair does not activate a synthetic provider or publish test content.

No external-network-dependent research can be guaranteed to finish during an
indefinite outage. Durable queues and checkpoints can preserve work and resume
after recovery; they cannot replace unavailable sources or model credentials.
The new browser outbox resumes while the page is open (including after reload);
closing it cannot upload a request that has not reached the server.

Other legacy endpoints that build and replace a whole JSON snapshot outside
`/api/sync` are not covered by its read/merge/write transaction. Server identity,
tenant isolation and a production generator migration require separate work.
