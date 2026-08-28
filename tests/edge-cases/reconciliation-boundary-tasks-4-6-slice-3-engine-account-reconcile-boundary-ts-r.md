## §Reconciliation boundary (TASKS 4.6 slice 3 — `engine/account/reconcile-boundary.ts`, R1/R2/R7/R8)

The money core: applied ONCE in `getFinanceSnapshot` (after the currency guard), so every
downstream engine inherits it. Hand-verified fixture (locked in `tests/unit/reconcile-boundary.test.ts`
and re-proven through the real assembler in `reconcile-boundary-assembler.test.ts`). Rules as REWORKED
by critic cycle 1 (F1–F4 — the first draft's "successor keeps only date > cutover" dropped real money):

Accounts: PRED (CHECKING, stale SimpleFIN, cur 240 000¢ / avail 239 000¢), SUCC (CHECKING, live Plaid,
cur 250 000¢ / avail 251 000¢), OTHER (SAVINGS, 100 000¢). One active link PRED→SUCC, cutover 2026-06-30.

**R1 — transactions: the predecessor is authoritative exactly over its own covered span.** PRED keeps
`date ≤ cutover`; SUCC keeps dates OUTSIDE PRED's claim `[PRED's first txn, min(cutover, PRED's last
txn))` — **half-open at BOTH ends since U.13**. Fixture (PRED txns span 06-29…07-01 ⇒ claim
[06-29, 06-30)): PRED 06-29 (−1000) kept · PRED 06-30 (−2000) **kept — the cutover day belongs to the
predecessor** · PRED 07-01 (−3000) dropped · SUCC 06-30 (−4000) **KEPT — the handover day is released
to both sides** · SUCC 07-01 (−5000) kept. Pair total **−12 000¢**; every date strictly inside the claim
is owned exactly once, and 06-30 is the single date owned twice. **F2:** SUCC's deeper backfill
(2024-11-05 −120 000¢, 2026-03-15 −80 000¢ — before PRED's first row) is KEPT — Plaid's 24-month backfill
must never be dropped against a 90-day SimpleFIN window. **F4 by construction:** a user-set cutover past
PRED's last data claims nothing extra (claim end = min(cutover, last txn)), so the empty tail can't
swallow successor rows.

**U.13 — why the claim end is EXCLUSIVE, decided on production measurement, not preference.** A handover
does not happen at midnight: the retiring feed stops partway through a day while the live one covers all
of it, and a business date here carries no time, so **no assignment of that one day to a single side can
be right**. Both directions were measured against the owner's real corpus
(`scripts/audit-probes/u13a-where-the-loss-lives.mts`, `u13b-the-boundary-day-itself.mts`):

| Rule | Silently lost | Visible duplicates |
|---|---|---|
| Predecessor owns the day (pre-U.13) | **1 row / $2,086.40** | 0 |
| Successor owns the day | **24 rows / $25,574.13** | 0 |
| Neither — released to both (**shipped**) | none | 9 rows / $374.40 |

The lost row was a real "Deposit Mobile Banking" of $2,086.40 on Investor Checking, dated exactly the
cutover, which the retired Schwab feed never reported on any date (`u11i-confirm-the-lost-deposit.mts`)
and which no surviving row replaced — absent from the register, budgets, reports AND the tax export.
Successor-owns fails harder: 8 links have a successor that reported NOTHING on the handover day while
the retired feed posted its final trades. So the day is released, which is the failure direction this
engine already required of itself ("a visible, advisory-covered double, never a silent loss").
Every earlier date still de-duplicates, so the overlap is exactly ONE day per predecessor.

A rejected refinement, also measured: releasing the day only when the predecessor's claim end IS its
last reported date. On all 9 real cases the two dates coincide (the cutover is derived from the
handover), so it avoided zero duplicates and bought only a branch. **Sibling composition holds:** one
predecessor's handover day can be strictly inside a SIBLING predecessor's claim, and is then still
correctly dropped — measured, 1 of the 10 boundary-day rows (`u13c-which-rows-moved.mts`).

**Multiplicity on a handover day is not always two** (U.13 money critic, executed — the first draft of
this section said it was). A CHAIN whose links share one cutover releases that date at every
generation, so A→B→C→D each keep it: one $999.99 charge measured at $3,999.96. Equal cutovers are
legal — the confirm action refuses only a *strictly earlier* downstream cutover, and two same-day
combines produce them. Likewise a predecessor holding exactly ONE day of history has claim `[D, D)` =
empty and de-duplicates nothing. Both are configurations where every generation genuinely handed over
inside the same day, so the release is still the honest answer, but the cost is depth-scaled.

**Cadence detection does NOT read the released duplicate.** A second copy of one charge is a 0-day gap,
and `detectRecurring` infers cadence from gaps — measured by the same critic: a fabricated BIWEEKLY
series from two monthly sightings, a real QUARTERLY bill destroyed, and a BIWEEKLY $3,000.00 paycheck
read as WEEKLY income (which *understates* the shortfall). Those series persist into forecast and
cash-needed, so `collapseHandoverDuplicates` folds same-(component, date, amount) rows from DIFFERENT
accounts to one occurrence for detection only. Two rows on the SAME account are never collapsed — a
transaction is a FLOW, and two $5.00 coffees in a day are ordinary.

**Balance snapshots are STOCKS, not flows (F3).** A lone observation is a correct single contribution —
dropped ONLY on an exact-date collision with the linked counterpart, where the cutover picks the winner
(PRED on/before, SUCC after). Collision fixture: both at 06-30 → PRED's 240 000 wins (≤ cutover), SUCC's
241 000 dropped; both at 07-31 → SUCC's 252 000 wins. No-collision fixture (cutover 06-25): PRED's real
observed 06-30 snapshot (account live until disconnect) is KEPT → series point 240 000¢, where the first
draft fabricated a dip to 0 for the pair.

**R2 — single balance.** PRED contributes 0 (currentBalanceCents AND availableBalanceCents zeroed on a
copy; the ROW stays — removing it would orphan its snapshot history and its account-id joins). Net worth
= 0 + 250 000 + 100 000 = **350 000¢** (pre-fix double-count: 590 000¢). **F1 — funding account:** a
stored `paymentAccountId` pointing at PRED remaps to SUCC (chains follow to the terminal live side), and
the snapshot's `supersededAccountIds` makes every FALLBACK tier (`resolvePaymentAccount`, the forecast
anchor — the stale row sorts first by creation order) skip PRED — pre-fix, an undesignated user's
cash-needed anchored on the $0 predecessor and fabricated an 80 000¢ shortfall (executed critic repro).

**Inertness (R7/R8) — a bad link changes NOTHING (today's behavior, never a dropped figure).** Inert:
either side missing from the account list (deleted or currency-withheld), self-link, cross-type link
(would sign-flip series history — also REFUSED at confirm), and a direction cycle including links
leading INTO one (A→B + B→A active would zero BOTH sides; the confirm action also auto-undoes the
reverse link when it re-proves the successor live, while legitimate chains Q→P survive a P→S confirm —
both locked). Zero effective links ⇒ the exact input references — demo/golden byte-identity is
structural. Chain A→B→C: B owns exactly (claim end of A, cutover B→C]. Two predecessors → one
successor: each claims only its own span; dates neither covers stay with the successor.

**Documented residuals (deliberate, no fuzzy matching — §3/§6; slice 6 re-audited the whole list):**
(a) inside the predecessor's covered span, the predecessor is authoritative — a successor row on a
mid-span date a SPARSE (e.g. manual) predecessor never recorded is dropped (pinned test; mitigation:
choose an early cutover); (b) the ≤1-day pending/posted straddle at the boundary (§6) — a purchase the
predecessor dates ON the cutover and the successor dates after counts once on each side; (b′, slice-6
critic A-F3) the MIRROR skew at the claim's LEADING edge: a purchase near the predecessor's first
synced day that the successor dates one day EARLIER lands before the claim and doubles — same ≤1-day
class, same decision (amount-matching's false-positive direction is a silent LOSS, which is worse);
(b″, slice-6 critic A-F2) with a USER-SHORTENED cutover (earlier than the predecessor's last
transaction), backward skew ACROSS the chosen cutover can count a purchase zero times — eliminated at
the DEFAULT (cutover = predecessor's last transaction, per §6, now also the UI default) and disclosed
inline in the confirm card ("dated differently right at the boundary… can briefly appear twice"); (c)
two stale predecessors of the same successor can still overlap EACH OTHER in transactions/snapshots (a
pre-existing duplicate the links cannot express — advisory warning still covers it; their re-keyed
STATEMENTS however are deduped per (terminal, cycleEnd), latest-cutover source wins, order-independent
— slice-6 critic A-F6); (d) racing opposite-direction confirms are now closed at the source (the
confirm transaction runs SERIALIZABLE — one racer aborts with a retryable message) with the read-time
cycle guard kept as defense in depth.

**Slice-6 rewrite of the chain rules (critics A-F1/A-F4/A-F8, B-F4 — old residual (e) was WRONG):**
claims and snapshot collisions now compose TRANSITIVELY: the terminal successor of A→B→C is excluded by
A's claim (its deep backfill re-imported history A already holds — the direct-only rule double-counted
it, executed repro), and an A↔C same-date snapshot collision keeps exactly one copy (the side the elder
cutover makes authoritative). A cutover stored BEFORE the predecessor's first transaction (reachable by
deleting its earliest manual row post-confirm) goes CLAIM-INERT — the predecessor keeps everything
(visible, advisory-covered double at worst) instead of silently erasing its whole history (A-F8). A
non-monotone chain (downstream cutover < upstream — the racing-commit shape confirm refuses) is now
also INERT at read time: the downstream link drops, both its sides count fully, never a double-window
(B-F4).

**Slice-6 surface sweep (critics B-F1/B-F2, C-1…C-14 — the #221 "fix the data class" lesson):** every
remaining Prisma-direct transaction surface now applies the assembler's EXACT R1 rule via ONE shared
closure (`getReconciliationTxnKeep` → engine `reconciliationTxnKeepFilter`, spans from a full-history
min/max aggregate, never the surface's own windowed rows): the /transactions register (rows AND summary
— pre-fix an 80% outflow inflation, executed repro), transactions-CSV export, budgets month spend,
triage queue/groups/badge, and recurring re-detection. /investments filters superseded predecessors
(stale balance + holdings no longer roll into "Portfolio value"). Manual entry and CSV import REFUSE a
superseded predecessor (and hide it from their pickers): a hand-typed row dated after cutover was
dropped from every sum — money entered, nothing moved (B-F2/C-4). The assistant's account-balance
answer folds a matched predecessor onto its terminal successor with an inline disclosure — pre-fix it
answered "$0.00" for a real funded account and counted one account as two (C-5). `getAccountsView`
returns the boundary-REMAPPED paymentAccountId (A-F7), enriches each candidate with the predecessor's
txn span (cutover default = span end, min = span start, honest claim-span disclosure — C-6/C-12/C-13),
never re-offers a predecessor already in an active link (one tap must not silently re-target a
confirmed decision — C-8), and never warns about a pair involving a folded predecessor. The #192
detector now flags two plaid rows from DIFFERENT PlaidItems (same bank re-linked = new item = new
providerRefs; same-item and simplefin-simplefin stay skipped — C-10).
