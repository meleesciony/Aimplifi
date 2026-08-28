## §Glass-Box (DECISIONS #178 — Gap 4 §1, `traceCashNeeded` / `traceSafeToSpend`)

A trace never recomputes a number: it reshapes the engine result's OWN rows and computes their
plain sum, so `reconciles` (sum === headline, integer cents) is a check on the engine's INTERNAL
consistency — a drift alarm (a formula term added to one side only fails it), never a
certification that the figures are RIGHT: it compares two readings of the same plan fields, so
no wrong input or price can fail it (audit P1-14 / C.11). Pinned in
`tests/unit/glass-box.test.ts`; e2e reconciliation in `tests/e2e/glass-box.spec.ts` parses the
RENDERED row amounts off the DOM and sums them.

`dataDerived` is the separate PROVENANCE claim ("Every amount is computed from your own data;
nothing is invented"), and the panel prints it only when it is true. Hand-verified cases
(mirrored in `tests/unit/glass-box.test.ts` S8 and `tests/unit/conscious-trace.test.ts`):

| Reader state | safe-to-spend flag | Fixed panel | Savings panel |
|---|---|---|---|
| median income, median/series fixed, no goals/targets/overrides | **true** | true | false ($0 asserts nothing; >$0 is chosen) |
| income override (`incomeBasis: 'user-set'`) | false | still **true** — the fixed term is untouched | false |
| fixed override (`fixedBasis: 'user-set'`) | false | false | false |
| goal $500.00 or savings-% target yielding > $0 | false | true | false |
| category-designations + a budget target priced any Fixed category | false | false | false |
| category-designations, all typical spend (`hasReaderInput` false) | **true** | true | false |
| category-designations, flag ABSENT (unknown) | false — never certify on a guess | false | false |
| empty reader (no income pattern, no fixed, $0 terms) | **true** | true | false |
| cash-needed off feed cards (statements, autopay configs, observed balances) | **true** | — | — |
| cash-needed including a reader-ADDED card — its statement balance/minimum or its estimated-from balance are typed figures (critic cycle 2 P0-1) | false | — | — |

A one-row panel prints NO penny-match at all — "This amount is the whole figure." and nothing
more: one amount beside the figure it IS certifies nothing, whatever `reconciles` says, and no
completeness claim follows it because the single row may itself be an aggregate (the Fixed term
is a rollup union — critic cycle 2 P1-1). `reconciles` and `dataDerived` are independent — a
reader-typed figure still sums.

### G. Cash-Needed rows (today 2026-06-10, PAY_IN_FULL unless noted)
- **G1** Amex $2,100.00 (autopay STATEMENT_BALANCE) + Chase $2,712.33, both due 06-15:
  rows [210000, 271233], sum **481233** = headline (the §A anchor). Amex row carries the
  engine's "Autopay handles this payment" note; Chase has none. Basis empty.
- **G2** same cards, MINIMUM: Amex cash = max(min $35, autopay $2,100) = **210000**;
  Chase = min **3500**; sum **213500** = headline. The autopay-max path reconciles.
- **G3** estimated-only (no statement anywhere; balance $500, next due 06-20): one row,
  `isEstimated`, sum **50000** = headline; basis states the statement-not-generated estimate.
- **G4** real Chase + estimated Store: rows = [Chase 271233] only; the estimated card is
  `upcoming` (next cycle), EXCLUDED from the headline and disclosed in basis — sum **271233**.
- **G5** past-due (due 06-05 → clamped today) and weekend (Sat 06-13 → Fri 06-12) rows carry the
  EFFECTIVE date and still reconcile.
- **G6** no cards ⇒ 0 rows, $0, vacuously reconciled; a fully-paid card ($1,000 statement,
  $1,000 applied) contributes NO row and the rest still reconcile.
- **G7 (fail-loud)** a doctored result (headline +1¢) ⇒ `reconciles=false`, `sumCents` keeps the
  TRUE row sum 481233 — the mismatch is reported, never clamped.

### S. Safe-to-spend rows (signed identity: +income −spent −bills −savings)
- **S1** +500000 −123456 −78900 −50000 = **247644** = `leftToSpendCents` (500000−252356).
- **S2** overspent: +100000 −150000 = **−50000** = headline (negative reconciles).
- **S3** empty month: four $0 rows, 0 = 0. UI signs are by ROLE (income '+', others '−') so a
  $0 row never flips to "+ $0.00".
