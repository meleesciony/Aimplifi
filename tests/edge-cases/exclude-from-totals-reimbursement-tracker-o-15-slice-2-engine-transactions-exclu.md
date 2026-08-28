## §Exclude-from-totals + Reimbursement tracker (O.15 slice 2 — `engine/transactions/exclude.ts` / `reimbursement.ts`, DECISIONS #342)

Hand-verified expectations locked by `tests/unit/exclude-from-totals.test.ts`,
`tests/unit/reimbursement.test.ts`, and `tests/e2e/action-menu.spec.ts`.

### The exclusion property (one basis, checked by equivalence)

Every summer is tested the same way: the total with a row present-and-excluded
must equal the total with that row physically deleted — exclusion may never
invent a third value. Known answers:

- Reports: rows −21240 (groceries, excluded) + −5000 (dining) → total **5000**,
  byte-equal to the breakdown over the dining row alone.
- Flows: income +500000, spend −21240 excluded → expenses **0**, income
  **500000**; excluding the income row instead → income **0**, expenses 21240.
- Register (e2e, hand-computed): −$40.00 + −$25.00 spend, −$10.00 transfer,
  +$40.00 inflow → Money out **$65.00**; excluding the $40.00 row → **$25.00**;
  row count stays (the badge, not absence, is the disclosure); undo restores
  $65.00 exactly.
- Deliberate NON-appliers, each a reality the reader cannot re-classify away:
  account balances/net worth, cash-needed/statement math, recurring detection,
  tax export (an explicit `taxClass` outranks exclusion — the O.13b silent-
  deduction lesson). Recorded in `exclude.ts`'s header.

### Reimbursement (informational only — no sum ever moves)

- Outstanding line: awaiting outflows only, each once, by |amountCents|:
  12550 + 2450 = **15000**; 'received', inflows, split containers and
  unrecognized states count **0**. An awaiting row that is ALSO excluded still
  counts (cash owed is not a budget figure).
- `monthlyFlows` / `isSpendRow` are byte-identical with and without any
  reimbursement mark (the double-count guard, locked by test).
- Offsetting-inflow match: exact |amount|, POSTED, non-transfer, non-split,
  untracked, on/after the purchase. Window by hand: purchase 2026-06-10 + 90
  days → 2026-09-08 **in**, 2026-09-09 **out**. Earliest wins; same-date ties
  break by id. A match is a SUGGESTION rendered on the detail view — never a
  stored link, never part of a figure.
