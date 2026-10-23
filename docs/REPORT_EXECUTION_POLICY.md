# New standard report execution policy

Only a newly inserted, live (`synthetic=False`) standard report receives the
`standard-live-v1` snapshot. Existing reports without a policy row, deep reports,
and synthetic fixtures keep their prior behavior. Reopening the service or
repeating an existing request key does not migrate a report.

| Default limit | Value |
| --- | ---: |
| Starts of one step, including its first start | 3 |
| Automatic retries across all steps, including bundle | 24 |
| Consecutive coarse `quality` failures on the current step | 2 |
| One attempt deadline | at most 300 seconds |
| Accumulated occupied work for the report | 14,400 seconds |
| Accumulated occupied work for one stage | 3,600 seconds |
| Time since creation, including waiting and pauses | 86,400 seconds |

Retries are `sum(max(attempts - 1, 0))`, so the first start of a new step is not
a retry. The hosted worker supplies a 300-second attempt timeout; callers with
a shorter timeout retain that shorter deadline. The deadline also respects
remaining report, stage, and lifetime allowance. Work is settled once when a
lease finishes, fails, expires, or is cancelled. Reading status includes occupied
in-flight time without changing settled usage.

These limits are **not monetary, token, or search-call caps**. A provider request
may already have incurred charges before local timeout. Review actual provider
billing separately. `quality` is the stored coarse failure class, not a verified
fingerprint of a specific factual root cause. A non-quality failure breaks that
consecutive window; historical quality totals remain stored.

## Pause and explicit continue

An authorized server operator can inspect and control the website report queue
through the existing database-backed hosted CLI. These commands require access
to that environment; they do not create a new public or member control endpoint.
Do not run these examples on a customer report without authority for that action.

```sh
python -m report_service.hosted --policy-status REQUEST_ID
python -m report_service.hosted --pause-request REQUEST_ID \
  --expected-version VERSION --idempotency-key UNIQUE_KEY \
  --actor OPERATOR --reason REVIEWED_REASON
python -m report_service.hosted --continue-request REQUEST_ID \
  --expected-version VERSION --idempotency-key NEW_UNIQUE_KEY \
  --actor OPERATOR --reason REVIEWED_REASON --extra-attempts 1
```

Use the version from a fresh status read. An identical key and payload replay
returns its original receipt; a changed payload or stale version conflicts.
Read status again after a replay because the original receipt can be older than
the current execution state. Audit actor/reason and keys remain private; public
website projections contain static causes and finite counters only.

Pause lets an already running, valid step finish within its existing deadline.
Its checkpoint is retained; no next step is claimed. A crashed worker, service
restart, normal scheduler pass, or old configuration-resume command cannot
silently continue a v1 pause. Website polls read state only. The operator must
explicitly continue after review. Completed and cancelled reports cannot resume.
The report's terminal status takes precedence over an earlier policy pause intent.

Continuing keeps attempts, consumed work, checkpoints, and audit history. It can
acknowledge the quality window and optionally add finite allowance. Per operation:

| Grant flag | Maximum additional allowance |
| --- | ---: |
| `--extra-attempts` | 3 starts on the current step |
| `--extra-retries` | 24 report retries |
| `--extra-task-seconds` | 14,400 report work seconds |
| `--extra-stage-seconds` | 3,600 current-stage work seconds |
| `--extra-wall-seconds` | 86,400 lifetime seconds |

Zero extra allowance is permitted if review alone resolves the pause and the
remaining limits allow work. Adding only an unrelated allowance does not force
execution: the receipt may still say `paused`. There is no automatic grant.
Same-city pauses block another new standard job at the transactional create and
claim boundaries, even when the website mirror lags. Existing report-key
idempotency and unrelated tenants/provinces/cities retain their scope.

`policy_status` uses a consistent read-only transaction and does not recover
leases. Constructing the Store still runs existing schema initialization DDL;
the whole CLI process must not be described as having no DDL.

## Existing reports and failed content

This policy does not rewrite an existing completed report, repair citations,
approve facts, or permit publication of failed content. Historical revision
requires its own reviewed archive, scope, version, downstream invalidation,
budget, and execution authority. Deployment rollback also does not reset usage
or authorize removal of the execution-policy tables.
