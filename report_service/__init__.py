"""Standalone report service pilot (durable SQLite, explicitly NOT the PG identity prod path).

Ownership: this package targets a self-contained local report-generation pilot.
It depends only on the Python standard library; providers are imported lazily at
worker runtime. No live/network calls originate from importing this package.
"""

__all__ = ["STAGES", "MAX_ATTEMPTS"]

# Static, ordered pipeline. `report` is the final synthesis stage; its output is
# persisted as the public result once the job completes.
STAGES = (
    "economy",
    "industry",
    "competition",
    "policy",
    "chain",
    "enterprises",
    "verification",
    "scoring",
    "action",
    "report",
)

# Bounded retries: a job that repeatedly loses its lease is failed after this
# many attempts rather than retrying forever.
MAX_ATTEMPTS = 3

# Safe machine-readable failure codes (no raw exceptions or secrets).
FAILURE_CODES = {
    "conflict",
    "invalid_payload",
    "lease_exhausted",
    "provider_error",
    "cancelled",
}
