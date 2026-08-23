# Unit full-suite SQLite cascade flake: one file's disk I/O error becomes locks across the suite

Full `npx vitest run` (verify.sh) can fail with a signature that looks like 7
broken modules when nothing is broken: one suite hits a transient `disk I/O
error` on the shared off-tree temp SQLite DB, leaks a lock, and every later
write anywhere fails — `database is locked`, `SQLITE_BUSY_SNAPSHOT`,
`Operation has timed out` — across sync/triage/reserve suites whose code this
slice never touched. Every file passes isolated; the rerun is green.

**Why.** All unit suites share one off-tree temp DB (per-run path, seeded once
at start). A single unhandled I/O failure mid-write (AV, transient disk
pressure, Windows handle churn) leaves the lock held; `fileParallelism: false`
means the victims are *later files*, not parallel workers — so the failure set
looks like a sweep of unrelated bugs when it is one poisoned file.

**How to apply.** On any full-suite unit failure where the error text is
DB-lock-shaped (`database is locked` / `SQLITE_BUSY_SNAPSHOT` / `disk I/O
error` / `Operation has timed out`) AND the failing suites are not the files
the slice touched: 1) run exactly the failing files isolated — passing
isolated confirms the cascade, 2) rerun the full gate — a clean rerun closes
it, 3) never "fix" the tests, the engine, or the slice to please a lock.
A cold first-run failure that doesn't reproduce is environment, not code
(the cloud-synced-folder lesson's twin; the load-induced e2e flake's unit
cousin). First seen 2026-08-23, DECISIONS #503: 8 tests / 7 files red →
all isolated-pass → full rerun green (7,314 passed).
