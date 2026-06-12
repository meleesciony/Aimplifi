# Decision Log

Record every non-trivial decision made during the build: what, why, alternatives
considered. Append-only.

| # | Phase | Decision | Rationale |
|---|---|---|---|
| 1 | 0 | Money = integer cents, branded type; round-half-away-from-zero | Auditability; floats forbidden by spec |
| 2 | 0 | Business dates are date-only (YYYY-MM-DD), single dates.ts utility | Timezone bugs are the top fintech date hazard |
| 3 | 0 | Obligation timeline computed on demand, not stored | Single source of truth; avoids cache-invalidation bugs |
| 4 | 0 | Weekend/holiday due dates adjust to PRIOR business day (conservative) | Funds present early is safe; late is not |
| 5 | 0 | v1 minimum-path interest = simple monthly (carried × APR/12), labeled approximate | Hand-verifiable; ADB method is roadmap |
| 6 | 1 | SQLite for local dev/test via Prisma 7 (`prisma-client` generator → `src/generated/prisma`); schema kept Postgres-portable (no SQLite-only features; enums/Json represented as String columns with documented values) | Postgres unavailable in build env; CLAUDE.md explicitly allows SQLite |
| 7 | 1 | Business dates stored as String `YYYY-MM-DD` (not DateTime @db.Date) | SQLite has no DATE type; lexicographic compare works; single dates.ts utility validates |
| 8 | 1 | Added `BalanceSnapshot` model (month-end balance per account) | Drives the net-worth trend chart deterministically from seeded history; additive over the Phase 0 draft shape |
| 9 | 1 | "This cycle" = obligations from GENERATED statements; a not-yet-generated statement (estimate) is next cycle — shown as upcoming, excluded from headline/projection — unless no generated statement exists at all (then the estimate IS the answer) | An un-generated statement closes in the future and is due even later, so it can never bind before current statements; keeps the headline answer and its hand math stable |
| 10 | 1 | Within a projected day: scheduled flows post BEFORE card payments are drawn | ACH credits typically post before card-payment cutoffs; deterministic, tested, surfaced in assumptions |
| 11 | 1 | Seed's engineered intra-period dip placed between the two due dates (rent 06-24, payroll 06-26): endpoints positive, mid-period −$1,012.33 | With checking ≈$3,400 and total due $5,412.33 fixed by SEED_SPEC, a pre-06-15 below-zero dip that fully recovers is arithmetically impossible; this placement is the exact mirror of edge case H (endpoint fine, intra-period negative) |
| 12 | 1 | Demo mode pins "today" via `DEMO_TODAY` env (default = seed asOf 2026-06-10) | Engines take `today` as input; keeps the seeded dataset coherent and e2e deterministic |
| 13 | 1 | Phase 1 auth = Auth.js v5 Credentials "demo sign-in" (one click, demo user only); magic-link/Google land in Phase 4 with the security pass | Demo mode must work with zero secrets; full auth is a Phase 4 acceptance item |
| 14 | 1 | Seed statement history balances are plausible PRNG values, not exact sums of that cycle's card transactions | Reconciliation adds heavy complexity with no Phase 1–3 test value; noted as a known limitation in STATUS |
| 15 | 1 | Transfer recommendation byDate clamped to `today` (critic P1-1) | "Transfer by yesterday" is an impossible instruction; same-day transfer is the correct remedy |
| 16 | 1 | Current statement = most recent with dueDate ≥ today OR an unpaid remainder (critic P1-2) | A delinquent statement is real debt due NOW, never a next-cycle estimate |
| 17 | 2 | Mid-band amounts on a merchant with user amount-banded rules go to review | The user declared the merchant context-dependent; the gap between bands is genuinely ambiguous (EDGE_CASES §Categorization) |
| 18 | 2 | "Possibly unused" subscription heuristic = fitness-category memberships (usage is not observable in transaction data) | Surfaced as a question to the user, never an accusation; consistent with coach guardrails |
