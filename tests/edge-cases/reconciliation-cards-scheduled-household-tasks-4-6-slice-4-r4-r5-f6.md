## §Reconciliation cards / scheduled / household (TASKS 4.6 slice 4 — R4/R5 + F6)

Slice 4 extends the ONE boundary (`applyReconciliationBoundary`) with two more row families and adds a
per-obligation-surface skip; the household read paths (separate, Prisma-direct — they never touch the
assembler) each subtract the superseded predecessor. Locked in `tests/unit/reconcile-boundary.test.ts`
(pure) and `tests/unit/reconcile-slice4.test.ts` (real assembler + household surfaces).

**R4 — a reconciled CREDIT card owes the successor's figure only.** Two effects, distinct consumers:
- **Statements are RE-KEYED to the successor** (critic cycle-2 CLAIM2 — the first draft full-dropped them,
  which under-counts): a predecessor statement survives iff its `cycleEnd` is NEWER than every statement
  the successor already has (or the successor has none), re-keyed onto the successor. Dropping them all is
  wrong when the live successor is on the ESTIMATE path (a fresh Plaid reconnect that hasn't generated a
  statement yet): the predecessor's real CURRENT statement would demote to the successor's next-cycle
  estimate, dropping the owed amount out of the cash-needed headline (`cycleObligations = real ? real :
  estimated`) and the 5-day reminder window. Re-keying hands the live successor its real current statement;
  the `cycleEnd` filter drops the stale OVERLAP statements the live successor authoritatively owns (so the
  coach cleared-streak, which reads `snap.statements` join-free, never double-counts an overlap cycle, and a
  stale statement never overrides the live due). cash-needed picks ONE current statement per card, so
  re-keying never doubles a due. Fixtures: (a) SUCC has a newer own statement (cycleEnd 2026-07-20) than PRED
  (2026-06-20) ⇒ PRED's is dropped, headline 60 000¢. (b) SUCC has NO statement + PRED has a $2000 current
  statement ⇒ PRED's re-keys onto SUCC as a REAL obligation ⇒ headline includes it (`requiredCents` 210 000¢
  with a bystard $100 card, `isEstimated` false), where the full-drop draft showed 100 000¢... i.e. dropped
  the $2000. A bystander card's statement is never touched.
- **Cash-needed + the forecast skip the superseded account from BOTH obligation surfaces** (cards AND
  loans), because the boundary zeros the balance but NOT the card config/autopay or a loan's
  `minimumPaymentCents` — so an estimate/autopay-path card or a LOAN would still emit a phantom.
  `cashNeededFromSnapshot` filters `snap.accounts` by `supersededAccountIds` once and feeds the filtered
  set to both `assembleCashNeededInput` and `selectLoanObligations`; `getCashFlowForecast` applies the
  same filter to its own `selectLoanObligations` call. Fixture: reconciled MORTGAGE emits ONE obligation
  (successor, 200 000¢/mo, due day 10), never the zeroed predecessor's 190 000¢/mo. Byte-identical when
  nothing is superseded (same array reference → R8).

**F6 — the predecessor's scheduled rows re-key onto the terminal successor.** After the payment account
remaps predecessor→successor, forecast/radar/cash-needed all pin their scheduled filter to the successor
id, so a row still keyed to the predecessor silently falls out (a dropped income/bill). The boundary
re-keys each predecessor scheduled row to the terminal successor (following chains, like the payment
remap). Reversible: undo clears the link, re-key vanishes, rows count on the predecessor exactly as
before (a write-time re-key could not be undone without storing the original id). Double-count-safe —
re-derived in L.25, which retired the original reason (rows are no longer full-replaced to a SINGLE
payment account; expenses now come from every cash account). It holds instead because detection groups
by MERCHANT, so one merchant yields one series and at most one row, and because `refreshRecurringForUser`
deletes every detected row for the USER (not per account) before rewriting, leaving no stale sibling for a
re-keyed row to collide with; superseded predecessors are additionally excluded from the writer outright. Fixture: a MONTHLY
Paycheck (+500 000¢) keyed to the stale funding account re-keys to the live one; the forecast (anchored
on the successor) projects `totalInflowCents ≥ 500 000` where without the re-key the income vanished.

**R5 — household visibility follows the successor.** A partner's reconciled pair appears ONCE (the
successor) across every household read; the stale predecessor is never separately shared. The household
paths are SEPARATE from the assembler (Prisma-direct), so SIX shared-set sites subtract
`activeSupersededPredecessorIds` (the relevant members'): `getSharedSnapshotSlice`, `getAccountSharingView`,
`getSharedTransactionsView`, `getHouseholdDigestContext`, `getHouseholdDuplicateCandidates`, and the
slice-6 `recategorizeSharedTransaction` WRITE-guard (critic cycle-2 CLAIM5 — a read surface that HIDES a
predecessor's row while the write guard lets a member MUTATE it is a read/write asymmetry). In
`getSharedSnapshotSlice` the exclusion rides the account list and cascades to every child row via
`supportedIds` — one filter; the currency-withhold count stays currency-only (a superseded predecessor is
not "withheld", it's the owner's stale duplicate). **EXACT assembler parity (critic cycle-2 CLAIM7):** the
helper reuses `effectiveReconciliationLinks` on the SAME currency-supported account set the boundary runs
on, so a link the personal view treats as inert — a deleted/currency-withheld side, a cross-type pair, or a
cycle — is NEVER effective here, so the household view can't hide a predecessor the owner still counts. The
first draft only checked successor existence, so a crafted USD→EUR link (confirm had no currency guard —
now added, refusing it at the source) would vanish the partner's real USD account from household while the
owner still saw it. One integration test drives a real reconciled+shared CHECKING pair (both sides
`sharedToHousehold`, same mask 4321) through all six surfaces + a cross-currency-inert case so a missed
site or a parity gap fails loudly (fence-by-construction lesson). The viewer's OWN /accounts toggle list
still shows every owned account — a superseded predecessor on the viewer's PERSONAL surfaces is slice-5's
F5 pass, not this one.
