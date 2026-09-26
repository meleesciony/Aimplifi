## §Reimbursement round trip — the payback of a reimbursable expense (O.11c, `engine/fi/insights.ts`)

The O.15 tracker lets a reader mark an expense reimbursable; the `excludeFromTotals` lever
takes the outflow out of the flow figures. This section pins what the returning money —
a positive row filed to the `reimbursement` leaf (auto-filed by `normalize.ts` for
`CONCUR` / `EXPENSIFY` / `EXPENSE REIMB*`) — does to `monthlyFlows` and the glass-box
month-flow panel. The locked decision: **it counts on NEITHER side** (`isReimbursementInflow`,
consumed by both stores), superseding #166's "reimbursements DO count as income" — whose own
rationale ("they aren't offsets of a tracked purchase") is precisely false once the row IS
tracked. `refund`'s spend-netting is untouched; `tax-refund` still counts as income.

Why not mirror `refund` (net against spend): when the outflow was excluded it never entered
the expense pool, so a netting payback would UNDERSTATE real spending — the too-generous
direction. Measured live before the fix (`scripts/audit-probes/o11c-reimbursement-income.mts`,
read-only): 0 reimbursement-categorized inflows corpus-wide today — this is prevention.

Hand-verified expectations (all POSTED, non-transfer; locking tests in
`tests/unit/insights.test.ts` › `the reimbursement round trip` and
`tests/unit/month-flow-breakdown.test.ts` › `test_regression__o11c_*`):

- **(a) The owner's case — excluded round trip.** $100 unrelated spend + a −$800 outflow
  marked `excludeFromTotals` + a +$800 payback filed `reimbursement`, one month →
  income **$0**, expenses **$100.00** (the payback does NOT eat the $100 — pins the
  no-netting decision against the refund-mirror, which would floor it to $0), savings
  rate `null` (income ≤ 0). Net effect of the pair on every figure: **zero**, matching the
  cash truth.
- **(b) Same round trip, exclusion NOT set.** −$800 purchase + $800 payback + $100 own
  spend → income **$0**, expenses **$900.00**. The purchase stays in spending until the
  reader pulls the exclusion lever (the detail view says exactly that); the payback is
  invisible. The stranded-$800 disclosure gap is a recorded P2 (docs/STATUS.md).
- **(c) Categorization is the lever.** Identical +$800 deposit: filed `reimbursement` →
  invisible; filed `refund` → nets spend down (untouched); filed `uncategorized` or left
  unfiled → counts as INCOME (O.20c doctrine: an unlabelled inflow is an ambiguous you-can-fill).
- **(d) Sign gate.** An OUTFLOW (negative) filed `reimbursement` is still spending:
  −$400 alone → expenses **$400.00**, income **$0**. `isReimbursementInflow` is
  positive-only.
- **(e) Dated ahead of `asOf`.** A payback dated after the clamp day lands in NEITHER the
  bar NOR either panel's `notCountedYetCents` (the skip runs before the asOf accumulation,
  `month-flow-breakdown.ts`) — the panel never promises as "not counted yet" money the
  chart will never pay.
- **(f) Cross-month.** −$800 in June (excluded) + payback July: June unchanged, July emits
  **no MonthlyFlow entry** (a month whose only counted row was the payback draws no bar —
  same shape as an all-excluded month; the panel follows by construction).
- **Creep baseline inheritance.** `detectLifestyleCreep`'s income series runs through
  `isIncomeFlowRow`, so a reimbursement no longer pads the income baseline a creep verdict
  is judged against — the O.20g refusal doctrine applied to a new leaf.
