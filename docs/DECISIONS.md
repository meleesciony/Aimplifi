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
