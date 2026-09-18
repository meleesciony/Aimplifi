# STATUS archive — BUILT entry 2026-09-14

> HISTORICAL
> Rotated verbatim from `docs/STATUS.md` on 2026-09-18 (ledger ceiling): the BUILT
> entry for DECISIONS #741 (O.20c). Live counts in this entry are historical; the
> current counts live only in the newest BUILT entry of `docs/STATUS.md`.

## ✅ BUILT 2026-09-14 — One definition of an unidentified inflow: it is income (O.20c, DECISIONS #741)

**The report.** TASKS O.20c (owner-reported, live, P1, money-visible): two unfiled deposits that look identical to a reader landed on OPPOSITE sides of the same figure — a positive stored with no category counted as INCOME, while the same positive sitting in the `uncategorized` placeholder NETTED the month's spending down.

**Shipped.** `isIncomeFlowRow` now admits BOTH stores of "nobody labelled this row" (raw null AND the `'uncategorized'` placeholder) — the app's own sign rule, symmetric with how an unfiled OUTFLOW already counts as spending. `isSpendRow` gained the matching clause, so the "Spending by category" card can no longer count that row as negative spend: one row, one side, both surfaces. `MONTH_FLOW_BASIS` copy re-derived (the expense sentence's now-false clause deleted; the income sentence states the unified rule); `BREAKDOWN_BASIS` gained the clause naming the new drop. `isFallbackGuiltFreeIncomeRow` now delegates to `isIncomeFlowRow` instead of re-stating the rule by hand. A mid-slice regression (a loan-payment answer emptying because its fixture refund was unfiled) was found by the full suite and repaired; the O.18e-FU3 fixture now files its refund.

**Critic (fresh context): cycle 1 FAIL 1 P1 + 2 P2 — all fixed same-session.** The P1 was ledger integrity (a "Locked." pointer naming a nonexistent test id and an untouched file), not code. The critic independently reproduced the probe, the full suite, both typechecks and FAIL-OLD, and swept the whole category domain through both predicates finding no remaining opposite-side disagreement for any positive row.

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,420 passed + 1 expected fail + 1 skipped / 629 files**, `next build` clean. FAIL-OLD (stash-revert): **6 failed | 80 passed** pre-fix. Playwright mobile-380: 7 specs on the changed surfaces, **17 passed**.

**CI + live.** CI verify run **34882946348 = SUCCESS** on `d774c1ef` (full VERIFY_E2E=1, 11m40s); each docs-only push superseded it, and the ship-gate read on the **newest sha is run 34886003435 = SUCCESS on `042751b6`** (full VERIFY_E2E=1, watched to conclusion). The first run (34880225584 on `3918c1f2`) was **failure** on `trends-new-merchant-panel.spec.ts` — this slice's own copy widening; the spec pinned the disclosure sentence verbatim and was re-pointed at the shipped copy (never weakened), recorded in REGRESSION_LEDGER. Vercel production deployment **6443592177 = success** on `3918c1f2`. Live probe (demo session, mobile-380): the `uncategorized` category panel renders "**and an inflow nobody has filed yet are left out**"; the month-flow expense panel renders "**an inflow with no category, or one still sitting in Uncategorized, does not**" with the old false clause gone; the income panel renders "**no category at all or still sits in Uncategorized**".

**Still open.** Wave 0 ops owner-blocked. M.4 owner-deferred. Wave 2/3/4 rows per TASKS.md. Named residuals: the raw-null store is defensive (0 live rows, no writer produces one); the `'refund'` leaf nets the chart's month expenses while the card drops it — a pre-existing divergence the reports page's own basis-gap disclosure covers, not introduced here.
