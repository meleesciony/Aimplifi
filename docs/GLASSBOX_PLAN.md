# Glass-Box Assistant — build plan (AI_DIFFERENTIATION_PLAN §2.1, Wave-2 lead)

*Scoping + engine design checkpoint. Written 2026-07-15 after a full answer-surface map.
Status: build-loop step 1 (acceptance criteria as testable assertions). Engine NOT yet built.*

## Job-to-be-done
Tap a number in an Ask-Aimplifi answer ("you spent $612 on groceries") → see the actual
transaction rows that add up to it, reconciled to the penny; know fact vs projection; fix a
misread routing in one tap. The LLM does nothing to the number — the drawer is deterministic
code reading the SAME `getFinanceSnapshot` the answer used.

## The scoping decision (the plan's required rework: "tap ANY number" is false for 5+ intents)

The 18 `AssistantIntent` kinds split cleanly. **Slice 1 owns the ROW-SUM family only.**

**ROW-SUM (trace = re-select the contributing rows + assert `sum === headline`):**
`spend_by_category`, `spend_total`, `top_categories`, `merchant_spend`, `income`,
`largest_purchases` (a single cited row, not a sum). These are literal sums of filtered
`snapshot.transactions`; the reconciliation is exact and testable.

**DERIVATION-CHAIN (trace = show the derivation, NOT a fake row-sum) — DEFERRED to slice 2+:**
`net_worth` (assets − liabilities), `account_balance`, `safe_to_spend`, `cash_needed`,
`debt_payoff`, `debt_free_by_date`, `savings_goal_by_date`, `retire_at_age`, `subscriptions`,
`forecast`, `savings_rate`. These are NOT transaction-row sums; a row-sum reconciliation would
be dishonest. They get a separate "here's the formula and its inputs" UX later, or no tap yet.
**Slice 1 must render row-sum numbers as tappable and derivation numbers as NOT tappable** —
never offer a reconciliation we can't honor.

## Engine design — `src/lib/engine/assistant/trace.ts` (pure, no I/O)

### Lockstep is the whole safety story (guard the false-negative)
The plan's sharp failure mode: `trace.ts` drifts from the engine and renders "I can't reconcile
this" on a CORRECT number — the trust feature undermining trust. Cause: `spendingByCategory`
(reports.ts:35) drops categories whose NET is ≤0 (refunds net down, line 54/60), so
`spend_total` ≠ naïve sum of all spend rows. **Fix: do not re-implement the predicate.** Extract
the per-row matcher + contribution from `spendingByCategory` into shared exports and use them in
BOTH places:

```
// reports.ts — additive, behavior byte-identical (lock with an equality test)
export function isSpendRow(t: ReportTxn, range, meta): boolean   // the lines 44–50 filter
export const spendContributionCents = (t: ReportTxn) => -t.amountCents  // line 52/54 (both branches are -amountCents)
```
Refactor `spendingByCategory` to call them (no output change; existing reports tests must stay
green). Then a category's cited rows = `txns.filter(t => isSpendRow(t,range,meta) && t.categoryId===id)`,
and `sum(spendContributionCents) === breakdown.byCategory(id).amountCents` is guaranteed by
construction, not by a re-derivation that can drift.

### Trace shapes per row-sum kind
- `spend_by_category` (category or group target): cite the category's/group's rows; headline =
  `breakdown.byCategory/byGroup(target).amountCents`.
- `spend_total`: HIERARCHICAL — total → per-category (the `byCategory` breakdown IS the
  reconciliation, since net-≤0 categories are dropped from the total) → rows. Do NOT flat-sum all
  spend rows (would include dropped net-refund categories and fail to reconcile).
- `top_categories`: same as spend_by_category per listed category.
- `merchant_spend`: cite the matched purchase rows (`merchantSpend` filter: POSTED, isPurchaseRow,
  whole-word prefix merchant match; GROSS — returns not netted). Reuse `merchantSpend`'s own row
  selection, same lockstep rule.
- `income`: cite the income rows (`monthlyFlows` income filter).
- `largest_purchases`: cite the single row(s) the engine already returns — trivially reconciled.

### Trace result type (sketch)
```
type Trace =
  | { reconciled: true; headlineCents; rows: TraceRow[]; groups?: TraceGroup[]; basis: 'known' }
  | { reconciled: false; reason: string }   // → UI: "I can't fully reconcile this — open /reports"
```
`TraceRow` = { date, merchant (rawDescriptor/normalized), categoryId?, contributionCents }.
`sum(rows.contributionCents) === headlineCents` asserted in the engine; `false` branch is the
honest fallback, never a wrong number.

## Acceptance criteria (write these as tests FIRST — `tests/unit/assistant-trace.test.ts`)
1. For every ROW-SUM intent, on the seed dataset, `trace(intent, snapshot).reconciled === true`
   and `sum(rows.contributionCents) === headlineCents` (the answer's own headline value).
2. `spend_total` reconciles hierarchically: `sum(groups.amountCents) === totalCents`, and each
   group's rows sum to its amount — INCLUDING a seeded category that nets to a refund (must be
   excluded from the total exactly as `spendingByCategory` excludes it).
3. `merchant_spend` cites only POSTED purchase rows for the matched merchant and reconciles gross.
4. A DERIVATION intent (`net_worth`, `forecast`, `cash_needed`, `savings_rate`) is NOT offered a
   row-sum trace (the engine returns a non-row-sum marker / the UI does not make it tappable).
5. False-negative guard: a deliberately drifted predicate makes the equality test FAIL (proving
   the test would catch drift) — i.e. the reconciliation assertion is real, not vacuous.
6. `reports.ts` equality lock: `spendingByCategory` output is byte-identical before/after the
   `isSpendRow` extraction (existing reports tests stay green + a new same-output test).
7. Correction chip (later UI slice): a "this should be <category>" tap dispatches a fully-specified
   intent straight to `buildAnswer`, bypassing the LLM (per plan; deferred to the UI slice).

## Sequencing
- **Slice 1 (engine):** `isSpendRow`/`spendContributionCents` extraction + `trace.ts` for the
  row-sum family + tests (criteria 1–6). Engine before UI. Two fresh-context Fable critic cycles
  (money grounding — the reconciliation must not lie in either direction).
- **Slice 2 (UI):** make row-sum headline/facts tappable in `ask-view.tsx` (plain `<p>`/`<dd>`
  today), a trace drawer, and the one-tap correction chip; derivation numbers stay non-tappable.
  **Binding constraints from critic cycle 1 (2026-07-15, P3s F4/F5):** (a) tappability is
  PER-FIGURE, not per-intent-kind — `answerTopCategories.detail` embeds the period total and
  `answerSpendByCategory.detail` embeds a share-%, neither of which the trace reconciles; detail
  sentences stay non-tappable. (b) `largest_purchases` traces only the headline row; the runner-up
  facts are NOT in the trace — pin them non-tappable (or extend the trace first). (c) The server
  must pass `mergeCategoryMeta(custom)` and the tapped figure's cents (`expectedHeadlineCents`,
  from the answer payload) into `traceAnswer` — both are load-bearing (critic P1s F1/F2, fixed in
  the slice-1 engine API).
- **Slice 3:** derivation-chain "show the formula + inputs" view for `cash_needed` / `net_worth` /
  `savings_rate` (no fake row-sum).

## Readiness notes (from the surface map)
- `AssistantAnswer.intent` already echoes the full resolved intent (incl. timeframe) to the client
  (#222) — no new plumbing to know what to trace.
- `snapshot.transactions` carries date, amountCents, rawDescriptor, status, isTransfer,
  isSplitParent; `categoryId` is cast on at runtime (server/assistant.ts) — thread it into the
  snapshot type the trace reads rather than re-casting.
- Reconciliation source of truth: `spendingByCategory` (reports.ts:35), `merchantSpend`,
  `monthlyFlows`, `largestPurchases`. Match them; never re-filter independently.
