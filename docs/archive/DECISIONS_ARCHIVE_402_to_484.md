> **HISTORICAL** — archived 2026-08-28 from `docs/DECISIONS.md` (verbatim moves, not rewrites).
> Point-in-time decision log; do not update. Live entries (#485 onward) remain in `docs/DECISIONS.md`.

# DECISIONS archive — entries #402 through #484

---

## #402 — The register chip that has no Fixed/Discretionary side NAMES ITS REASON; renaming it a third time was refused

**The owner asked, twice, what one word meant.** #395 shipped "Neither" on the
register's spend-class chip. The owner asked what "Neither" meant, so #397 renamed it
"Not counted". On 2026-08-03 the owner sent a screenshot of an `Interest Paid +$0.10`
row and asked what "Not counted" meant. Two renames, same question — so the defect is
not the word.

**Two separate failures were behind it, and a third rename would have fixed neither.**

1. **One pixel stood for ten different facts.** `classifySpendClass` returns
   `out-of-scope` for a split container, a transfer, any inflow, a reader-excluded row,
   an unsettled row, an unfiled row, a card payment, cash out, an investment transfer,
   and any non-budgetable category — and all ten printed the same chip. This is exactly
   the identical-pixel failure `row-labels.ts` exists to prevent ("Card payments due
   this month — $0.00" true for three different readers), applied to the register.
2. **The explanation existed and was unreachable.** It lived in a `title` attribute, so
   it opened on hover — and the owner is on a phone. There was no way, anywhere in the
   app, to find out what the chip meant. A tooltip only a mouse can open is not a
   disclosure.

**Also: "not counted" named no SCOPE.** It reads as "this money is ignored", when the
row still moves the balance, still counts as income, and is absent from exactly one
thing. Every explanation now sits under one heading — "Not part of Fixed or
Discretionary" — and says where the row *does* still count.

**Decision 1 — `outOfScopeReason` takes the class AS GIVEN, and never re-derives it.**
The verdict is computed once on the server WITH the reader's custom-category meta and
recurring-bill merchant set. A UI calling `classifySpendClass` again would run it
without either, and a custom category missing from the client's static map resolves to
`out-of-scope` — so the chip would have explained away a dial the server had granted.
Locked by a test that classifies `cus_horse_feed` as out-of-scope on a bare re-derive
and still returns `null` when the server says guilt-free.

**Decision 2 — every chip label is a word the row does not already print.** Caught by
screenshot, not by reading the source: the first cut labelled a transfer "Transfer",
and that row already carries the provenance pill "Transfer" (`PROVENANCE_LABELS`)
beside the category name "Transfer" — the fix for one confusing chip printed the same
word three times on one row. Same collision existed for the unfiled case against
provenance's "Needs a category", and the excluded case against the amber "Excluded from
totals" badge. Now: "Own accounts", "No class yet", "You excluded". Locked by a unit
test asserting no chip label appears in `PROVENANCE_LABELS` — which is why that map is
now exported rather than copied into the test.

**Decision 3 — the panel is CLAMPED to the viewport, not anchored to the chip.**
Measured failing twice, both times only visible in a screenshot: left-anchored it ran
off the right edge of the 380px register; flipped to right-anchored it ran off the LEFT
edge by 55px, because the panel is wider than the space either side of a chip near an
edge. The chip's x position is not fixed — it follows however wide the merchant name and
the Details / Rule… links ahead of it happen to be. `panelOffset` is pure and pinned
across every chip position from 0 to 380px.

**Decision 4 — the demo fence is untouched.** Only the out-of-scope chip becomes a
button; a Fixed / Discretionary badge stays an inert span. What the demo is fenced away
from is WRITING the class, and there is nothing to explain about a working dial. The
disclosure button carries its own testid inside the labelled span, so the e2e lock
("the demo's Groceries row has no `button[data-testid="txn-spend-class"]`") still holds.

**Decision 5 — the detail view stops describing a control that isn't there.** Its "For
your Plan" paragraph said "Change the selector if the guess is wrong" beside rows that
have no selector. Out-of-scope rows get the reason sentence instead.

---

## #403 — C.25 requeued: the exclusion is a READ-TIME fact with four gates, computed ONCE in the snapshot assembler (built, wired, critic-cycled)

**The defect in one line:** `countsInFlows` keys off the stored `isTransfer`, and the
stored flag is the product of a ±3-day same-amount coincidence at SYNC time — so the
owner's $6,217.07 mortgage flips in and out of every spending total by settlement
timing (TRUE Apr/Jul, FALSE May/Jun; measured, `c25-who-sees-the-mortgage.mts`).

**Why the exclusion moves to read time (DECISIONS #400 stood up).** A sync-time write
to `isTransfer` cannot check the only two facts that make removal safe — whether the
plan unioned the series, whether the loan side can project — is applied to every
consumer at once, and has no undo. Read time can check, applies per surface, and is
recomputed on every read (nothing persists that a later month could contradict).

**The invariant, per #400:** money leaves a flow sum only where "it is carried
elsewhere" is CHECKED. The carried-elsewhere surface for a loan payment is the
committed/forecast/calendar line, which exists exactly when `selectLoanObligations`
can date the loan (LOAN/MORTGAGE + `minimumPaymentCents>0` + `dueDayOfMonth`). 
SimpleFIN loans write neither field (verified: `simplefin-map.ts:163-195`); undatable
Plaid loans fail the same gate — for both, the rows STAY in the flows (visible beats
vanished; #400's failure-direction rule).

**The four eligibility gates (ALL must hold for a row to leave the flow sums):**
1. The row is an outflow on a CHECKING/SAVINGS account, POSTED, not a split parent,
   not reader-excluded — i.e. it would otherwise have been counted.
2. Its merchant canonical is linked to a specific LOAN/MORTGAGE account by **≥2
   distinct calendar months** of ±3-day same-|amount| pairs, re-derived at read time
   from the raw rows (the stored flag is never consulted — it is the unstable thing).
   One coincidence (the reverted attempt's P0-2: the roofing invoice) never qualifies;
   a recurring payment does. Aggregate canonicals (Zelle/Venmo/Check/Cash App/Apple
   Cash/PayPal) are refused outright (the C.4 doctrine, C.24's F3).
3. That linked loan account has a DATEABLE obligation in `selectLoanObligations`.
4. The row's |amount| equals one of that account's obligation `paymentCents`.
   Gate 4 is the P0-1 killer: on a bank that stamps every ACH `ONLINE PAYMENT`, only
   rows at the obligation's own amount leave — rent/electric/internet at their own
   amounts stay, whatever the descriptor says.

**Measured consequence (owner data):** every $6,217.07 Truist row leaves the flow
sums in every month — Apr/Jul (the months the flag missed) included — while an
escrow-adjusted month at a different amount stays visible. The mortgage is counted
on the committed line (`selectLoanObligations` already expands it, verified #400),
so removal is double-count prevention, not deletion: no month loses money the app
does not show somewhere else.

**Computed ONCE, in the shared assembler** (`getFinanceSnapshot`, the one both
providers route through — plaid.ts:2174-2177 delegates to demo.ts:39): one targeted
query (POSTED/USD inflows on LOAN/MORTGAGE accounts, the C.24 loanSideInflows shape)
plus the snapshot's own accounts and rows, yielding `excludeIds` (row ids) + the
disclosure facts. Every flow surface inherits the same set; "a disclosure a call
site has to remember is one a call site can forget" (month-flow-breakdown's own
doctrine). Engine predicates take an OPTIONAL id-set; omitted = today's behaviour,
so every untouched call site and the demo golden are unchanged by construction.

**Surfaces wired:** reports bars + category table (`monthlyFlows`,
`spendingByCategory` — which trends, pace and budgets-row-basis reuse), Glass-Box
month-flow panel, coach (savings rate, lifestyle creep, discretionary avg), Ask
(`assistant.ts` monthlyFlows), /budgets (ids passed through the spending-plan
result, since budgets queries the db directly). NOT wired: the register and its
summary (rows stay visible there; a filtered view sums what it shows), tax export,
reimbursement, cash-needed (already loan-aware), and the plan's own Fixed basis
(C.24's union + exactness invariant already govern it — this slice never touches
`isTransfer`, `RecurringSeries`, or any stored row).

**What /reports shows a reader whose largest outflow leaves spending:** totals
without the repayment, plus an engine-authored basis sentence naming what moved and
where it is counted instead (the committed line) — assumptions-style, per the
cash-needed/radar house pattern. Silence is reserved for readers with no eligible
merchant (empty set = no sentence, never a claim about an absence).

**Income side needs no exclusion:** #62 withholds loan-account activity from the
snapshot, and budgets' db query is spending-accounts-only, so no loan inflow ever
reaches a flow sum; the exclusion is outflow-only by construction.

## #404 — C.8: the calendar places each card and loan due in EVERY month — synthesis at the calendar boundary, radar's rules, provenance carried on the event (built, critic-cycled)

**The defect in one line (audit P0-3):** `buildCashFlowCalendar` window-gated the
ONE obligation the engines emit per card/loan ("the next payment on/after today"),
so every month but the due month printed "0 payments due across 0 dates" under a
footnote promising "each due day is badged here". For the owner (4+ cards, ~$6,200
mortgage) September understated committed outflow by ~$25,000.

**Where the synthesis lives and why.** Inside `buildCashFlowCalendar` — pure,
unit-testable, and the ONE place the month window exists. Required new params
`today` + `holidays` (the L.15 lesson: a caller that forgets them gets silence at
exactly the wrong moment, so they are required, not defaulted). Cards repeat
monthly from the RAW issuer due date, re-adjusted to the prior business day per
occurrence, priced at `cycleBasisCents ?? cashRequiredCents`, ALWAYS labeled
`(est.)` — the radar's `projectCardDues` rule for rule (adjudicated condition 3).
Loans repeat their fixed issuer-reported payment, never `(est.)`, stepping from the
same raw anchor /forecast expands (`loanObligationsToScheduledFlows`); the two
surfaces share anchor and cadence while their DISPLAY conventions differ by design
(calendar rolls back to business days, forecast prints raw — critic F-2 corrected an
earlier comment that overclaimed "one date"). Deliberately NOT re-derived from
day-of-month for loans: a clamped anchor would then disagree with /forecast even on
the anchor; unifying expanders is a separate slice.

**What stays true:** the current-month events are untouched (fail-old locked);
iteration is bounded for far-past and far-future months alike (a `last + 7 days`
raw-limit provably covers the longest US weekend+holiday roll-back of 3 days); a
stale anchor skips occurrences on/before today (radar's guard verbatim — recorded
residual critic F-4: a 1+month-overdue card whose k=1 lands exactly on today drops
that occurrence, parity-preserving, needs delinquency); a credit-balance statement
never recurs.

**The critic's P1 (F-1) and its shape.** Cycle 1 FAIL, 1 P1 + 4 P2. The P1: the
synthesized events reused the boolean `isEstimated`, and the frozen-account
disclosure keyed its amount sentence off it — so a frozen card WITH a statement was
told, in every later month, that its figure was "worked out from the last balance
we saw" while the grid printed the statement basis: a false PROVENANCE for money on
the surface L.19 calls highest-consequence (the exact defect class L.18's
correction #2 paid to remove, back through a new door). Fix: a closed provenance
set — `DueAmountSource = 'statement' | 'repeated-statement' | 'balance' |
'loan-terms'` — computed ONCE in the engine where the fact is known (which branch
painted the event), carried on `CalendarEvent.amountSource`, mapped verbatim by the
page into `FrozenCalendarRow`, branched in `frozenCardsNote` (three sentences) and
`frozenCardDatesNote` (a repeated statement still derives its DATE from the
statement, so it groups with `'statement'` there). `FrozenCardRow.isEstimated` was
REPLACED by `amountSource`; the six current-cycle call sites map through one
`currentCycleAmountSource()` so they cannot drift. The source logic keys on the
obligation's own estimate path, NOT merely on the page-injected `cycleBasisCents`
(the follow-up caught that a bare statement card would have mislabeled as balance).
The P2s: the overclaimed "one date" comment (F-2), the footnote's estimate-path
imprecision (F-3), the F-4 residual recorded in-source, and phase4.test.ts's
`[...cards, ...upcoming]` double-list — harmless pre-C.8, a double-synthesis trap
after — now `result.cards` alone (F-5).

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **5849 unit across
358 files** / build clean. Targeted calendar e2e 21/21 serially; the
calendar-frozen spec's quiet-month lock was REWRITTEN to the new truth (later
months now paint; the frozen fact rides the synthesized money; only a pre-due month
is silent). Three unrelated mobile-380 e2e (auth:82, today-feed-frozen:220/238)
fail IDENTICALLY on clean HEAD — stash-verified, recorded OPEN, not caused here.

## #405 — C.9: annual spending scales by the REAL window, never ×2 — and every sentence that names the window carries it (built, critic-cycled)

**The defect in one line (audit P0-6):** `getCoachData` computed
`annualExpenses = expenses6 * 2` while the savings/income averages divided by
`Math.max(1, last6.length)` — so a reader three months in got an annual figure
that was exactly HALF their true spending, and the FI number, the FI date,
Coast, the runway-adjacent emergency-fund example on /goals and every scenario
seeded from `annualExpensesCents` halved with it.

**The fix.** One line of money math, in the server that owns the window:
`annualExpenses = roundHalfAwayFromZero(expenses6 * 12 / Math.max(1, last6.length))`.
For a full six-month window this is byte-identical to the old value (×12/6 = ×2,
exact integer — no rounding drift); for N < 6 it is the true year. The divisor
guard matches the two averages beside it, so N = 0 stays $0, as before.

**The copy rule (the checkable sentence must stay checkable).** Five surfaces
hardcoded "6": the FI sentence ("last 6 full months × 2"), the slider caption +
context ("average over 6 months" / "6-month average pace"), the share-of-income
sentence, and the runway cushion on BOTH the signature weather line and the
dashboard's income-pause line. Each now receives the window — the server's
existing `monthlySavingsMonths` field (documented as ALSO the annual-expense
window; one array, one divisor, one count) for the /coach cards, and a new
REQUIRED `NudgeInput.runwayWindowMonths` riding onto `Proposal` for the
income-pause line (required, not defaulted — the defaulted-parameter-fails-silent
lesson). Full-window renderings are byte-identical; short windows say "your last
3 full months × 4", "3-month average pace", etc.; zero history gets a named-zero
branch ("no complete month of spending is on record yet") instead of "0 months".

**What was NOT changed (recorded, not silent).** (1) `scenario.ts` still calls
its verbatim coach inputs "6-month averages" in one note and two doc comments —
a pre-existing falsity (the divisor was real before C.9) on a separate engine
with its own input contract; deferred to its own slice. (2) The emergency-fund
line on /goals says "(6 months of expenses)" — TRUE by construction
(annual ÷ 2 = six months of annualized spending) regardless of window.

**Locks.** fi-real-basis.test.ts grew a 3-month-history Prisma lock: window
carried as 3, annual = the true $36,000, FI = $900,000, with fail-old pins
against the $18,000/$450,000 half-values, plus the FI sentence naming
"your last 3 full months × 4". Copy locks pin the N=3/1/0 branches and the
byte-identical N=6 forms. Verify green; phase3-coach e2e passes with the demo's
six-month window (pinned strings unchanged).

## #406 — C.10: the pace line branches on the contribution's BASIS, and a plan the history doesn't back refuses the date — the decision lives in the pure copy module, the gate is ONE exported predicate (built, critic-cycled, 2 cycles)

**Context.** CALC_AUDIT_2026-08-02 P0-8. #375 made the years dial compound the
settings savings-% target whenever one is set (`wealthContributionBasis`), but the
pace line kept calling the figure "what was left after spending, averaged over the
N months" — a claim about history the line beneath falsifies ("Recent surplus
averaged −$450.00/month"). Worse: the refusal tested `contributionFloored` only —
the figure the dial was HANDED — and a positive plan clears that by construction,
so a reader overspending in every month on record got a confident 20-year arrival
beside the FI card refusing to give one.

**Decision.**
1. The pace-line DECISION — which sentence, and whether one is printed at all —
   moved from the card into `COACH_COPY.wealthTargetPaceLine`, a pure selector over
   (basis, contribution, contributionFloored, observed surplus, window, arrival,
   real rate). On `recent-surplus` the routing is byte-for-byte the old card logic
   (locked as such); on `settings-savings-pct` the OBSERVED surplus gates the date.
2. New strings: `wealthTargetAtPlannedPace` — "what your plan has you setting
   aside", same two assumptions inline, NO window (no window produced the figure),
   and deliberately NOT "your settings savings rate": `plannedSavingsCents =
   max(goalContributions, target)` can be goal-driven while the rate names a
   smaller number. And `wealthTargetPlanNotSaving` — two branches keeping the
   `wealthTargetNotSaving` split: zero complete months is an ABSENCE, not
   behaviour; a real window says "nothing has been left over after spending"
   (accurate across the whole ≤0 set — "spending is ahead" overclaims an exact
   tie — and phrased in the surplus pace line's own words so it is checkable).
3. The gate is ONE exported predicate, `wealthTargetPlanUnproven(basis,
   historicalCents)` = settings basis ∧ surplus ≤ 0, read by BOTH sites: the
   selector's refusal and the horizon seed. Critic cycle 1 found the seed defect:
   a refused plan still seeded the slider (`contributionFloored` was false), and
   the caption said "your current pace lands it" one line under the refusal. Now
   `contributionFloored || planUnproven` falls back to the unchosen 25-year
   default exactly the way a floored surplus does.

**Residuals (P2, noted, not fixed).** (1) `wealthTargetBeyondHorizon`'s "At
what's going in now" is now reachable on the settings basis via the
positive-history route — the shared string also serves the surplus basis;
rewrite out of scope. (2) The seed OR line sits in the card memo without a
node-env lock (repo has no RTL); both inputs are locked (predicate tests + the
pre-existing `seededHorizon` refusal pins).

**Locks.** coach-copy.test.ts: byte-identical surplus pace and refusal routing
through the selector; planned-line naming (no "left after spending", no window);
settings + negative history → refusal; exact zero refuses; the zero-month refusal
names absence, not overspending; beyond-horizon under both bases; the predicate
locked in all five directions; new strings + a selector row registered in the
guardrail sweep. Wealth-target engine untouched.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN (tsc 0, eslint 0, **5909 unit /
360 files** (+1 predicate lock), build clean). `wealth-target.spec.ts` 2/2
serially on that build — the demo seed carries no `savingsTargetBps`, so e2e
exercises the byte-identical surplus branch; the settings branch is unit-locked only.

## #407 — C.11: the Glass-Box certification is split into the claim it can stand behind and the one it can't — `reconciles` stays a drift alarm, `dataDerived` gates the provenance sentence, one-row panels print no penny-match (built, critic-cycled, 2 cycles)

**Context.** CALC_AUDIT_2026-08-02 P1-14, the audit's trust-surface finding.
Every Glass-Box panel ended with "…matched to the penny. Every amount is
computed from your own data; nothing is invented." Both halves were overclaims.
(1) `assembleSafeToSpend` compared `income − fixed − savings` against
`plan.leftToSpendCents` — the SAME expression (`plan.ts:707` computes it from
the same three fields), so `reconciles` was true for every input, including
every defect in the audit; the Fixed/Savings bucket panels compared a one-row
sum against a headline `conscious.ts` copies from the identical field. The
code comments called these "real cross-module checks" — disproved by reading
both modules: neither side derives anything the other does not hand it. What
the check CAN still catch is one-sided FORMULA drift (a term added to
`leftToSpendCents` or to a bucket without its trace row), which is real but
narrow, and is not what the copy claimed. (2) "Every amount is computed from
your own data; nothing is invented" is false whenever a figure is reader-typed:
an income/fixed override, a savings goal or savings-% target above $0, or a
Fixed category priced from a budget target (the rollup's `hasReaderInput`).
The same two sentences also lived in the share snapshot (`redact.ts`).

**Decision.**
1. `NumberTrace` gains `dataDerived: boolean` — REQUIRED, no default (the L.15
   lesson): true iff every amount in the panel was computed by the app from
   observed account data. Builders set it per panel, because the panels show
   different row sets. Cash-needed is true iff NO row comes from a
   reader-added card — critic cycle 2 P0-1 refuted the first cut's hardcoded
   `true` (it had checked ScheduledTransaction, the wrong source: a manual
   card's statement balance/minimum are figures the reader TYPES via
   `setManualCardStatement`, and its estimate path derives from the typed
   balance). The fact now rides `Account.provider` → `AccountLike.provider` →
   `CardSnapshot.manual` → `CardObligation.isManual` (REQUIRED, the
   frozenSince rationale) → the trace. The fixed bucket answers for the fixed
   TERM alone (`fixedTermDataDerived`: false on a `'user-set'` basis or a
   budget-priced category — an income override leaves it true); the savings
   bucket is NEVER true (above $0 the figure is chosen, at $0 no reader-set
   AMOUNT is printed); the full identity and the guilt-free panel require all
   three terms clean.
2. Unknown is conservative: the budget-pricing fact arrives as
   `SpendingPlanInput.categoryFixedHasReaderInput` (the rollup's
   `hasReaderInput`, plumbed by the server); ABSENT ⇒ treated as reader-priced
   — never certify on a guess. Only the server caller passes the measured flag.
3. Copy: one-row panels print "This amount is the whole figure." and NO
   penny-match and NO completeness claim (one amount beside the figure it IS
   certifies nothing; cycle 2 P1-1 killed "nothing else is inside it" — the
   one row may itself be an aggregate, and the Fixed row's own label and basis
   say "sum of … plus …"); the same one-row rule now applies in
   breakdown-panel.tsx too. Multi-row panels keep the arithmetic sentence (the
   reader can check it on screen, and the mismatch branch still fails loud on
   drift); the provenance clause renders only under `dataDerived` in all four
   authors — panel, share text, and the /spending-plan page's fused sentence
   ("matched to the penny from your own data" splits on the flag). The
   zero-income basis sentence states the APP's state only ("no income has been
   detected") — cycle 2 P2-1 killed a rewrite that claimed no income had
   POSTED, which the app cannot know — and Ask's two copies of the retired
   "nothing here is invented" wording were scrubbed to match.
4. The overclaim comments were rewritten where they lived: `trace.ts` header
   (reconciles is internal-consistency, not correctness), the conscious-bucket
   builder ("drift alarm, not a certification"), the test-suite headers, and
   EDGE_CASES §Glass-Box (which carries the hand-verified gate table).

**Locks.** S8 in glass-box.test.ts (flag cases: overrides, goal, target,
budget-priced/typical/unknown rollup, empty reader, cash-needed feed-true /
manual-false on BOTH the statement path and the estimate path plus the mixed
case, and the reconciles/dataDerived independence case); the conscious-trace
per-bucket suite (fixed flag ignores income overrides; savings never;
guilt-free mirrors; share text follows the panel); redact locks for the
one-row sentence and both provenance branches. E2e: conscious-buckets asserts
the one-row panels print no penny-match and the savings panel no clause,
guilt-free still does. Mutation-proven in BOTH directions, four mutations:
deleting the savings condition kills 5; flipping the unknown-default kills 2;
forcing the flag off kills 4; forcing `fixedTermDataDerived` true kills 5. All
reverted green.

**Critic cycles.** Cycle 1: two fresh-context critics (copy-truthfulness +
engine-gate). Engine lens: P0-1 — the cash-needed flag hardcoded true was
refuted by `setManualCardStatement`/manual accounts (fixed per decision 1;
the S8 test that had locked the falsehood was rewritten the same cycle). Copy
lens: P1-1 — the one-row replacement's completeness claim falsified by the
composite Fixed term (fixed per decision 3); P2-1 the zero-income rewrite
overreached (fixed); P2-2 the breakdown-panel one-row tautology + this
entry's residual (3) overclaim (both fixed); engine P2-3 the $0-savings
comment overclaim (fixed). Zero P0/P1 remain open.

**Honest residuals.** (1) The component copy branches (clause rendered when the
flag is true, withheld when false) have no RTL in this repo — the engine flag
is locked both directions; the false-branch RENDER is e2e-covered only for the
savings panel (demo reaches it), not for an override/budget/manual-card reader
(unit-locked flag only — the seed has no manual accounts). (2) The month-flow /
category-breakdown panels keep their multi-row penny-match: their rows are the
figure's own input transactions, so their check is the SAME drift-alarm shape
this change de-certified for traces (the module docblock says so) — retained
as product behaviour, not re-certified as independent verification; their
one-row case now prints the same one-row sentence. (3) `AccountLike.provider`
is optional: a future snapshot producer that omits it would mark its manual
cards non-manual — the demo provider (the only one) emits full Prisma rows.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, eslint 0, **5930
unit / 360 files**, build clean. E2e run serially on that build:
glass-box.spec.ts, conscious-buckets.spec.ts, spending-plan-month-edge.spec.ts,
month-flow-drilldown.spec.ts, category-breakdown.spec.ts.

**Deploy-verified 2026-08-04.** Pushed `4b5c43c` (no prisma diff → database
untouched); deployment `aimplifi-53qi3p5bv` ● Ready, aliased to
www.aimplifi.app; `scripts/c11-live-deploy-check.mjs` → DEPLOY PROOF: PASS
(7/7) — the Fixed panel renders the new one-row sentence with the clause, no
penny-match; Savings withholds the clause; guilt-free keeps the arithmetic
sentence; the served client bundle carries the C.11-only literal.

## #408 — C.12: an instruction and the figure it qualifies must come from the SAME selection — the shortfall split is offered only when the walk proves it sound (built, critic-cycled, 2 cycles)

**Context.** CALC_AUDIT_2026-08-02 P1-16/17/18/20, one slice, one root: four
instructions had drifted from the figures they qualify. (a) "Shortfall of
$10,001.00 on Aug 10" paired the window's worst dip with the FIRST short date
(true Aug 10 figure: $1.00) on four surfaces — hero, a `critical` Today-feed
nudge, Ask, and the calendar dip cell — while `radar.ts` had already fixed the
identical pairing in the sibling engine (L.23). (b) /cards' "Do this first"
promoted a next-cycle ESTIMATE excluded from the total beside it. (c)
/forecast's card-payment omission note sat after every figure it qualified.
(d) The radar's "Clear" verdict and cover transfer never mentioned
balance-carrying cards the engine cannot date; the hero on the same page did.

**Decision.**
1. `CashNeededResult.headline` gains `firstShortCents` (transfer step covering
   the first short date, rounded UP to $50), `worstDipDate`, and
   `shortfallDateBalanceCents`. The hero title pairs the window figure with
   the worst dip's OWN date; the nudge's `centsAtStake` is the first date's
   step figure; Ask and the calendar cell pair each amount with its own date.
2. **The two-step split is offered only when provably sound (critic cycle 1
   P1-1).** The first cut's sentence — "the rest covers the low point on
   Jun 10, so it can be moved in two steps" — re-introduced the very
   decoupling it fixed: with an intermediate day deeper than step 1 covers
   (rent between a $1 dip and a later lump), the second step is needed BEFORE
   the named low point. Both engines now test every day in
   [firstNegativeDate, worstDipDate) against `balance + firstStep >= 0` and
   withhold the split (`firstShortCents = 0`) when it fails — every consumer
   gates on `> 0`, so all surfaces fall back to the single sufficient
   instruction with no per-surface branching. The gate uses the ROUNDED step
   (the plan printed is the plan tested). The radar twin got the same gate —
   the slice's own lesson (a fix on the reported surface is not a fix on the
   pattern) required it.
3. Split copy says "covers", never "is needed" (cycle 1 P2-2: the step
   figure rounds UP; sufficiency is all it can claim), and is cause-neutral —
   "the rest is for the low point on …" (P2-3: the card-name join read
   exhaustive beside scheduled flows on the same day; the radar keeps its
   single-event naming, the obviously-partial precedent). New shape:
   "Two steps work: $50.00 by Jun 3 covers the first short day — the rest is
   for the low point on Jun 10."
4. (b) `firstCountedActionCard(result, ordered)` in card-duplicate-view.ts —
   the banner's membership test is `paintedHeroCards`, the same perDueDate
   selection the hero uses and the same set `requiredCents` sums; the urgency
   comparator is exported (`compareCardUrgency`) so grid order and selection
   cannot drift. All-estimates state (thisCycleIsKnown=false) still promotes
   estimates — they ARE the cycle. Uncounted estimate rows read
   "Estimated — next cycle", keyed on `upcoming` membership (cycle 1 P2-6:
   paintedHeroCards absence would mislabel a $0 this-cycle estimate).
5. (c) The /forecast note moved to the top of the hero (first node, before
   every figure) with `forecast-scope-note` and a DOM-order e2e lock.
6. (d) `RadarInput.undatableCards` is REQUIRED at the boundary (the
   `feedDroppedAt` precedent — no caller can forget), plumbed from
   `undatedCardsWithBalance(cashNeeded)` (the #277/L.4 fence, so the count
   matches the hero's note); the result passthrough is optional for stub
   legality. The header note renders in all three statuses before the
   cover-transfer imperative; the assumption names the verdict ON SCREEN
   (cycle-1 P2-4 / money P2-1: "not the Clear verdict" under a Heads-up chip
   names an absent claim).
7. The destructive hero alert's "Projected balance dips to…" line was removed
   (cycle-1 P2-5): with the title on `worstDipDate` it duplicated the title in
   every state. The covered alert's low-point line is untouched.

**Accepted residuals.** (i) Nudge stake precision is bimodal (money critic
P2-2, withdrawn on disposition): split case carries the $50-rounded step —
exactly the figure the hero's split line prints for the same event — while the
unsplit case carries raw `shortfallCents` beside its own (worst) date; the raw
per-date alternative would print $1 against the hero's $50 step for the same
day, a real contradiction. (ii) "The rest is for the low point on D2" carries
no one-business-day buffer on the second step (same-day posting reliance),
pre-existing in the radar wording. (iii) The verdict-name mapping duplicates
the chip strings across engine and card, coupled by comment only. (iv) The
hero split line leaves "the first short day" unnamed (its date lives in the
nudge and the calendar cell; the actionable byDate is named).

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, eslint 0, **5945
unit / 360 files** (from 5930/360), build clean. New locks: cash-needed H2
(split fields, split assumption, single-event zero, P1-1 withhold), nudge
pairing (per-date stake, single-event fallback), Ask two-step (present/absent),
firstCountedActionCard (estimate-first trap, all-estimates promote, null
banner), radar undatable (ok/alert/none), radar P1-1 withhold, forecast
DOM-order e2e. Mutation-proven both directions per the critics' revert checks.
Lesson: docs/lessons/a-fix-on-the-reported-surface-is-not-a-fix-on-the-pattern.md.

**Deploy-verified 2026-08-04.** Pushed `29d3b86` (no prisma diff → database
untouched); `scripts/c12-live-deploy-check.mjs` → DEPLOY PROOF: PASS (5/5) —
the demo sign-in on production renders `forecast-scope-note` with the
card-payment omission ABOVE the hero figure (DOM-order checked; the old build
has no such testid), and the served client bundle carries the literal. The
hero/radar/cards copy is server-rendered (RSC), so bundle-literal freshness
rides on the one client-component marker — a lesson from the first script
draft, which searched chunks for RSC strings that can never appear there.
E2e note: three mobile-380 specs (today-feed-frozen ×2,
frozen-figure-surfaces:92) failed in this session but reproduce IDENTICALLY
on clean HEAD `fec663a` via stash/run/pop — pre-existing spec/component
drift, recorded in STATUS, not caused by C.12.

## #409 — C.13 (P1-27): the Fixed/Discretionary heading and the register it opens read one row set — the reconciliation keep is a REQUIRED argument, not a call-site habit (built, critic-cycled)

**The audit's stated cause was already dead.** P1-27 blamed a classifier requiring
POSTED (`spend-class.ts:70` → `insights.ts:48`) for $49.93 of guilt-free the linked
register could not display. #397 (2026-08-03) had already admitted PENDING into
`classifySpendClass` for a different reason — the owner's pending Hair Capital row
showing "Not counted" with no dial — and the module doc says so in as many words.
Executed against the shipped demo: zero divergence from status, because there is none.

**The parity claim survived anyway, through a mechanism nobody had written down.**
`getTransactions` applies the shared R1 reconciliation ownership rule
(`getReconciliationTxnKeep`) to every row before it stamps `spendClass`, so a reader
who has confirmed a provider migration sees each real purchase once on the register.
`/budgets` applied that same keep to `spendRows` — and handed the Fixed/Discretionary
panel the RAW month query. So the heading a reader clicks summed the predecessor's
copy of every post-cutover purchase twice, and the destination showed it once.

**Fix: the predicate is a required parameter of the engine, not a filter at the call
site.** `summarizeSpendClassCategories(rows, meta, fixedMerchants, nameOf,
keepsReconciled)`. Taking the PREDICATE rather than pre-filtered rows is deliberate:
`spendRows` has also had `isSpendRow` run over it, which drops the C.25 loan-payment
exclusions the register still lists, so feeding that array here would have traded one
mismatch with the destination for another.

**Critic P1 (fresh context, executed): the page prints one category twice.** With
the panel now provably equal to the register, /budgets shows Housing at $1,800.00
under "By category" (C.25 excludes a loan payment carried on its loan, so THAT figure
matches ITS link) and $4,200.00 under "Fixed expenses" (which keeps it, so THAT link
matches) — four inches apart, with the C.25 disclosure rendered inside the lower card
only. Both figures are right for their own link and the reader had no way to know it.
`spendClassLoanPaymentNote` now states the direction beside the split: the payment IS
counted here, is counted on the loan under By category, and the two lists differ by
that amount. The sentence names the direction rather than merely disclosing an
exclusion, because "not counted" printed above a figure that counts it is worse than
silence.

**Locked** in `tests/unit/spend-class-link-parity.test.ts`: both sides run over one
fixture whose rows exercise both directions of R1 (a successor backfill inside the
predecessor's claim window, and a predecessor row still reporting past the cutover),
plus PENDING, a per-row override, a refund, an excluded row and a settlement
category. The CONTROL executes the old behaviour — an always-true keep — and shows
the heading promising $3,880.00 against a destination summing $1,960.00.

**Residual, recorded not waived:** nothing in the repo tests `/budgets/page.tsx`
itself, so the required parameter is load-bearing by TYPE only — a future edit could
satisfy it with `() => true` and no test would fail. The cheapest real lock is a
server-level test over a seeded reconciled pair comparing `getTransactions().summary`
to the page's panel total; filed rather than built here.


## #410 — C.26 (P1-28): a spending figure's WINDOW is a value it carries, and its register link is built from that same value (built, critic-cycled)

**The defect, confirmed before anything was touched.** `computePace` filters to
`t.date <= today` (`trends.ts:571`); `spendingByCategory` filtered by month key
only. So the dashboard printed "$X this month" (TopSpendingCard, from
`getReports`) an inch from "$Y spent this month" (the pace card) over two
windows. Ask carried the same split in a sharper form: `merchant_spend` has
clamped since O.7 **with the reasoning written out at the call site** — "'You
spent' is a claim about money already gone" — while `spend_total`,
`spend_by_category` and `top_categories` did not. Two answers to "how much did I
spend at Whole Foods" and "how much did I spend on groceries" could disagree by
a row neither reader could see.

**The direction is /reports', not /budgets'.** A figure labelled "you spent"
counts money already gone. The repo had already decided this once, in O.7, on
one intent; C.26 finishes it rather than re-litigating it.

**Why the first attempt died, and what replaced it.** A `spentAsOf` clamp on the
array in `getReports` plus the three Ask intents was verify-green and killed by
a fresh-context critic with five executed P1s. The sharpest: the clamped figure
linked to an UNCLAMPED register, because `categoryMonthRegisterHref` derived
`to` from `monthWindow(month)` — measured, $120.00 clicked landing on $520.00 of
rows. That breaks the O.5/O.6 link invariant, which this repo treats as more
serious than the divergence being fixed (`check-what-the-fix-breaks-before-what-
it-fixes`, the C.13 lesson from the session before).

The fix is not a second clamp at the link. It is removing the second author:

  - `SpendWindow { fromYm, toYm, asOf? }` — the window a figure was summed over.
  - Named authors: `spentSoFarWindow(month, today)`, `wholeMonthWindow(month)`,
    `asOfWindow(range, today)`. `isoDate` validates at the boundary, so a
    malformed date throws instead of silently filtering every row out and
    printing "$0.00 spent" — the failure direction a string comparison takes.
  - `spendWindowRegisterDates(w)` — the ONE translation to inclusive day
    boundaries; `to` is the earlier of the month end and `asOf`, so every past
    month emits the byte-identical link it always did.
  - `categoryMonthRegisterHref` → `categoryWindowRegisterHref`, taking the
    window. A caller cannot clamp the figure and not its destination without
    deliberately constructing a second window.
  - `buildCategoryBreakdowns` takes the window too: a panel rebuilt from a month
    key would list a row its own figure dropped, turning `reconciles` false on a
    figure that is right.

`asOf` is optional rather than required, and that is a departure from #409's
"make the caller answer" construction, chosen deliberately. The property that
protects money here is different: the link derives from the SAME object the sum
used, so an omitted `asOf` cannot desynchronise a figure from its destination —
it can only mean "this figure covers the whole month", which is what /budgets
means. The residual risk (a surface that should clamp and forgets) is not a type
problem; it is locked by server-level tests, which is the only thing that would
have caught it.

**P1-2, decided rather than left open: /budgets keeps the whole month.**
/reports answers "what have you spent". /budgets tracks an allowance, and a
charge the reader dated for the 20th has already consumed part of it; dropping
it would raise "left to spend" — the generous direction on the one figure that
exists to restrain. The two pages therefore print different numbers for one
category in the rare month holding a future-dated row, and **each equals its own
register**. That is the invariant; not that the two pages equal each other.

**P1-3: income clamps with spending.** /reports' chart takes `happened` (rows
`<= today`) so the current-month income bar and expense bar answer one window,
and its bar-panels are built from the same array. Ask's `income` intent applies
the same narrowing (`monthlyFlows` has no window parameter). Verified blast
radius before choosing: /coach filters to complete months (`f.month <
currentMonth`), so no current-month figure there moves, and the only two
printed current-month income figures in the app are these two.

**P1-4: the basis sentence stayed true by not being stretched.**
`BREAKDOWN_BASIS` claims a COMPLETE enumeration of `isSpendRow`, and C.26 gave
that predicate a sixth clause — but the constant is rendered by /budgets too,
where the clause would be false. So the clamp gets its own sentence,
`breakdownNotCountedYetCopy`, gated on `CategoryBreakdown.notCountedYetCents > 0`
— a fact about this reader's rows (the C.11 `dataDerived` gate), computed in the
engine from the same pass that collects the rows, so no surface can ship a panel
without it. It counts only rows the clamp ALONE excluded; a row already dropped
as a transfer or an excluded flow is described by the existing sentence and
attributing it here would double-count somebody else's exclusion. Negative nets
(a later-dated refund) clamp to zero rather than promising the reader that a
scheduled return is spending waiting to land.

**P1-5: the locks are real, and proven so by mutation.** The critic killed the
first attempt by deleting the clamp and watching 59 then 45 tests stay green.
`tests/unit/spend-window-parity.test.ts` drives `getReports` and `askAssistant`
(through the real parser, real auth mock, real Prisma, DEMO_TODAY pinned) on a
throwaway user holding a future-dated row, executes the register link through
`filterTransactions`, and carries a CONTROL that lands the $520.00. Executed
this session: removing the reports window → 5 red; removing the income filter →
1 red; removing all four Ask clamps → 6 red.

**Gate:** VERIFY GREEN — tsc 0, eslint 0, 5964 unit / 362 files, build clean.
Targeted e2e 13/13 (reports-total-reconciles, budgets-basis, category-breakdown,
category-drilldown — the last of which is the link-parity spec on /reports,
/trends and /budgets).

### C.26 critic cycles — what four passes actually found

Three FAILing cycles, eleven P1s, every one executed rather than argued. They
are recorded because the pattern is the value, not the individual bugs.

**Cycle 1 (6 P1s).** The fix was correct in the engine and unfinished
everywhere a reader stands. The /reports VIEW could still reintroduce the
measured $120→$520 defect with the whole suite green (so the href moved into
`getReports` and the view names no window); the new disclosure was asserted
nowhere (so basis composition moved out of the .tsx into the engine); the CHART
panel on the same page had inherited the clamp WITHOUT its disclosure and
printed two false sentences — "Returns in June 2026 outran purchases", blaming
the reader's refunds for money the date rule removed, and "No posted spending in
June 2026" over $400.00 of posted June spending; a category the clamp emptied
disclosed nothing anywhere; and Ask's basis line read as the complete rule while
omitting the newest exclusion.

**Cycle 2 (3 P1s).** The page-level figure was `wholeMonthSum − clampedSum`, and
`spendingByCategory` floors each category at zero INDEPENDENTLY IN EACH WINDOW —
so a later-dated refund in one category cancelled a later-dated purchase in
another, the page fell silent, and the panel beneath it still disclosed $400.00.
One computation, `notCountedYetByCategory`, now feeds both. The component layer
was still unlockable — the critic deleted every render-site fix in one pass with
5972/5972 green — which is why this slice installs a component-render harness
(`@testing-library/react` + `jsdom`, `.tsx` in the vitest include, opted in per
file with a pragma). And the dashboard's top-spending card had inherited the
clamp and none of the disclosure.

**Cycle 3 (2 P1s).** Both were caused by the cycle-2 fixes. The card narrowed
the window label with the PAGE's amount and handed it to panels that narrow with
their OWN, printing "Jun 2026 so far so far" and labelling a category that held
nothing back "so far"; the card passes the plain month now, and the property
"a panel's label describes its own figure's window" holds again on every
surface. And the new harness rendered three components but not `ReportsView` —
the page the finding is about — so all four of its render decisions were still
deletable with the suite green. It renders it now.

**The lesson worth keeping:** every cycle after the first found a defect
introduced by the previous cycle's FIX, and each one was a disclosure rather
than a number. A clamp is easy; telling the truth about a clamp on every surface
that inherits it is the work.

**Cycle 4: SIGN-OFF — zero P0, zero P1**, with the cycle-3 fixes re-executed
(no "so far so far"; a category holding nothing back gets the plain label on a
page that held $400 back elsewhere; a single-decision strip of the aria-label
narrowing fails exactly one render test, so the lock is per-decision rather than
per-file) and the F1 invariant re-verified across transfer-flagged,
excluded-from-totals, split-parent, `transfer`-categorised, Income-clawback and
pending rows all dated ahead: PAGE >= max(panel) holds on all three fixtures.

**Accepted residuals, recorded not waived:**
- Ask's date-rule clause is UNCONDITIONAL, so on a purely past timeframe it is
  vacuous ("…anything dated after today isn't counted yet" under "You spent
  $120.00 last month"). Vacuous, not false. The `dataDerived` gate (C.11/#407)
  applies to sentences naming an AMOUNT — a claim about this reader's rows — and
  this one names a rule, like every other clause in the same sentence. Gating it
  would thread `today` into two answer builders and turn two trace basis
  constants into functions for no gain in truth.
- The page-level figure can name money no panel decomposes: when the clamp
  empties a category completely, `spendingByCategory` drops it, so it has no
  panel — which is exactly why the page-level sentence exists, and also the
  limit of it.
- `notCountedYetByCategory` runs twice per `getReports` (once inside
  `buildCategoryBreakdowns`, once for the page total), alongside the added
  `getLinkableCategoryIds` query — on /reports and on every dashboard load. One
  pass over the snapshot each; not measured as a problem, recorded as known.
- Two panels on one page may label their windows differently ("June 2026 so far"
  for a category holding money back, "June 2026" for one that is not). Each is
  true of its own figure, which is the property cycle 3 restored.

**R3 (added at sign-off) — one seam the render harness cannot reach: the
dashboard page's prop wiring.** Mutation-proven by the critic: changing
`dashboard/page.tsx` to pass `notCountedYetCents={0}` instead of
`reports.notCountedYetCents` restores the F3 defect ("$0.00 this month", "No
spending yet this month.", no disclosure) with 5989/5989 green. Not a live
defect and not a P1 — the code is correct today, the component itself is locked,
the prop is REQUIRED so an omission fails `tsc`, and the value has exactly one
plausible source. Recorded because it is the last unlocked link in this chain:
an async server component is not renderable by the jsdom harness, so only an
e2e on /dashboard with a seeded future-dated row would close it.

## #411 — C.19/H.3: a Fixed TOTAL its list cannot account for — the union emits the rows it summed, and each line states its own basis (built, critic-cycled)

**The task row was stale and building from it would have rewritten live code.**
C.19 was authored 2026-08-02 asking for per-transaction Fixed/Discretionary with
`Transaction.spendClassOverride`, a recurrence-first default, and Fixed sums
re-derived from ROWS. DECISIONS #397 shipped all three on 2026-08-03 — the column
exists, `classifySpendClass` already resolves row override → recurring-bill
merchant → taxonomy, and `resolveFixedCategoryAmounts` already pre-filters to
fixed-CLASSIFIED rows before averaging. Measured first, per
`sharing-a-basis-is-not-sharing-a-scope` ("a task row's premise is a hypothesis").

**What was actually broken is what the owner actually said.** He has asked
"where is mortgage?" four times, and the word is LIST, not total. C.24 (#394) put
the mortgage in the Fixed FIGURE at its full $6,217.07 monthly rate. It was in no
list, structurally: C.24's exactness invariant removes a structural loan
payment's rows from the category rollup — the only half that produces lines —
and re-adds the money through `recurringOutsideFixedCategoryCents`, which
returned a bare `number`. `tests/unit/loan-payment-fixed-union.test.ts:206`
asserts the resulting `rows: []` as CORRECT, so no test in the repo could see the
hole. The list showed nothing; the total showed $6,217.07.

**The fix is structural, not a disclosure.** `recurringOutsideFixedCategoryRows`
emits the rows it sums and `...Cents` is implemented in terms of it, so a printed
line and the figure above it cannot disagree by construction (the L.30 idiom).
`recurringPlanExpenseRows` does the same for the detected-series basis. A new
`buildFixedList` assembles both halves and REFUSES to certify when they cannot
meet; `/spending-plan` — which itemized nothing at all — renders the verdict and
computes nothing, because C.26's critic proved a view can reintroduce exactly
this defect with the suite green.

**No figure moves.** `suggestedFixedCents` is byte-identical before and after;
only its composition becomes sayable. No schema change.

**Two defects caught in my own code before the critics ran:** two series sharing
one merchant canonical collided on a single key (both are counted, so both must
render), and under a reader-set override the section printed a total its own
lines contradicted. The printed total is now ALWAYS the sum of the printed lines,
with `planFixedCents` published beside it whenever they differ — a figure
directly above a list is read as that list's total, so it has to be one.

**Copy critic (fresh context): FAIL — 4 P1 + 2 P2, all EXECUTED, all fixed.**
Every one shared a shape: a sentence written against one basis, printed above
rows produced by another.
- P1-1: the intro sentence claimed repeating bills are listed at their monthly
  share. False twice — a non-loan series whose category is already in the rollup
  is deduped away and never appears, and a category line for a quarterly premium
  first charged mid-window renders its WHOLE charge (`averageMonthlySpendByCategory`'s
  own documented over-reserve). The sentence is DELETED, not narrowed; the basis
  now travels on the row.
- P1-2: a budget-priced category line rendered pixel-identical to a measured
  average, dropping the provenance clause `/budgets` is REQUIRED to print beside
  the same figure (audit P1-8, regressed onto a new surface).
  `fixedAmountBasisClause` is now the line's own `basisNote`.
- P1-3: the `user-set` branch returned before the completeness test, so an
  override over the MEDIAN basis said "these lines are what your data shows"
  while the majority of that data structurally cannot have lines. Two
  independent facts, now composed rather than nested.
- P1-4: the empty paragraph asserted "it does not mean your fixed costs are
  zero" in two states where they ARE zero (including a reader who TYPED zero and
  was argued with), and named "until a repeating bill is detected" as the remedy
  on the `detected-series` basis — where bills WERE detected and the app could
  name them. Both fixed: the empty note names WHICH zero, and that basis now
  publishes its rows (and therefore reconciles exactly).
- P2-5/P2-6: the chip repeated its own label on the unnamed path; `cadence` was
  documented as a required disclosure and never rendered.

**Money critic (fresh context): FAIL — 2 P1 + 4 P2, all EXECUTED, all fixed.**
Its attacks on the arithmetic itself all came back clean: `sum(rows) ===
totalCents` always (a row with `amountCents <= 0` is unconstructible),
`...Cents` parity holds across every cadence and skip set, every override
refuses to certify, and the demo reader's list reconciles to the penny by hand.
What it found is that "matched to the penny" is a claim about a SUM, printed as
if it were a claim about the COMPOSITION.
- P1-1 (the deep one): `reconciles` tests a sum, never DISJOINTNESS. C.24 keeps
  a unioned bill out of the rollup by merchant canonical, so if the payee's
  wording changes mid-window the old rows stay in the rollup while the series
  unions at full rate — the critic executed a mortgage appearing as its own
  $6,217.07 line AND as $2,072.36 inside Rent & Mortgage, with the sum balancing
  and the page certifying it. The app cannot tell two canonicals are one payee;
  what it can do is refuse to certify when a bill is filed to a category that
  also has a line. Costs nothing on the intended C.24 path (the merchant's rows
  have left the rollup); fires only on the ambiguous overlap.
- P1-2: the empty-list branch built a SECOND note ladder that dropped the
  `user-set` disclosure for a non-zero override, telling a reader who had typed
  $5,000 it "comes from their monthly spending pattern". The ladder is now
  reused, not re-derived.
- P2-1: a median of zero left `unaccountedCents === 0`, so the page printed
  "$300.00" and "your plan uses $300.00" stacked under a sentence about a gap
  that did not exist. The "rest" sentence and the second figure row are now
  gated on a NON-ZERO remainder.
- P2-2: `unionedLoanMerchants` was derived from every loan-payment row BEFORE
  the union's own skips ran, so a series the union dropped had still had its
  rows stripped — the money left Fixed while the list certified the remainder
  exact. The exclusion is now derived from `plan.fixedLineItems` (what was
  actually kept), making "excluded ⇔ unioned" true rather than stated.
- P2-3: "These 1 line adds up" → "This line adds up".
- P2-4: two lines can render one identical label (keys are distinct, labels are
  not). Not live — `detectRecurring` emits one series per canonical — recorded
  as a residual for a future caller supplying its own `scheduledFixed`.

**Deliberately NOT in this slice:** reserves / sinking funds (the owner's third
Fixed source — "money set aside every month for home repair", yearly dues ÷ 12)
have no model in the app and remain C.23/H.4.

## #412 — C.23/H.4: a reserve is a Fixed cost the reader declares, and the app does the division (built, critic pass in progress)

**The owner's model, in his words, has three sources of Fixed and the app modelled
two.** A bill that leaves this month; a longer-rhythm bill smoothed to a monthly
rate (`monthlyRateCents` — his ÷12 and the engine's are the same arithmetic); and
*"money being reserved every month for home repair"* — a sinking fund with no
merchant, no series and no history behind it. The third is discoverable from
nothing, so it must be DECLARED.

**Fixed, not savings — a distinction, not a reversal.** `plan.ts:446` records the
owner's 2026-08-01 rule that savings/investing is never a Plan Fixed class, and
that rule stands untouched: a reserve pre-funds a known EXPENSE (a bill deferred),
savings builds a balance the reader keeps. `investment` is still never Fixed.

**Carrier: a `Goal` row with `kind = 'reserve'` and a new additive nullable
`Goal.cadence`.** `targetCents` holds the TRUE COST once per cadence and the app
divides — a stored monthly figure would lose the fact that $100 is a twelfth of
something, which is the only way the line can explain itself beside a real bill.

**The double-count hazard, closed twice by construction.** `plannedSavingsCents`
is `max(goalContributions, savingsTarget)` — "a floor, never a sum" — so a reserve
inside that reduce is committed once as savings and again as Fixed, and
`leftToSpend` understates by the reserve. Reserves store a null contribution AND
the loader filters `kind !== 'reserve'` explicitly. The second is what is locked,
via a row carrying both: a data convention is whatever the next writer decides it
is, and a defence that cannot fail a test gets deleted as dead code.

**Folded INTO the existing figure, not published beside it.** Twelve call sites
render `fixedExpensesCents`; a fourth term would have understated Fixed on eleven
of them until each was found — `one-loader-is-not-one-reader`, shipped on purpose.
So `suggestedFixedCents` and `fixedExpensesCents` both include reserves, and the
lines travel with them so the composition stays sayable.

**A typed fixed override does not cancel the declaration.** The override (#372) is
a number typed over a figure derived from SPENDING PATTERNS; a reserve is a
separate statement made on a different screen. Dropping it would let the reader's
own two statements silently cancel. Failure direction decides the tie: counting it
over-commits (conservative, and visible in the list); dropping it hands back money
already promised elsewhere.

**New `fixedBasis = 'reserves-only'`,** because `'none'` is read by four label
authors as "we could not find fixed costs", which is false beside a non-zero
figure the reader typed themselves — and it is not `'user-set'` either.

**Four basis authors updated,** each of which ENUMERATES the sources in the figure
and each of which was incomplete the moment a source with no transaction behind it
entered it: `fixedLabel`, `safeToSpendParts`, the composition card, and the Fixed
list's own note. The clause is authored once in `reserves.ts`, per L.30's lesson
about two surfaces hand-rolling one list.

**An unrecognised cadence is refused, never treated as monthly.**
`monthlyRateCents`'s `default` returns the amount unchanged — correct for a
detected series whose cadence the detector left null, catastrophic for a stored
`'YEARLY'`, which would enter the plan at TWELVE TIMES its truth in the direction
that eats the whole guilt-free line. Refusals leave `resolveReserves` as data, are
named on the page, and keep their own remove control.

## #413 — H.5: history is a property of the CONNECTION ROW, and a re-pull is not a refresh at a different size (built, critic-cycled)

**The owner's report:** *"why aren't they showing, i see a max date of march this year"*.

**Measured cause, not guessed.** `SIMPLEFIN_INITIAL_LOOKBACK_DAYS` (1095) is applied on
exactly two paths: a connection's first-ever pull, and an account first seen mid-sync
(DECISIONS #73). Every other sync starts at `lastSyncedAt - 5d`. So a connection whose
first pull ran under the old 90-day default carries that floor for the rest of its life,
and widening the constant — which #18b6ad6 did on 2026-08-04 — reaches no connection that
already exists. The `opts.fullLookbackDays` escape hatch built for this had **zero callers**
(grepped). March is ~90 days before the owner's first connect.

**The decision: the backfill is ADD-ONLY BY CONSTRUCTION, not by calling the existing
force-full parameter.** `syncFromSimplefin(userId, today, { fullLookbackDays: 1095 })` was
the obvious implementation and is wrong. The live ingest answers an already-stored row with
`guardedVerdictRefresh`, which rewrites `categoryId` / `needsReview` / `isTransfer` on every
row carrying no explicit `Correction`. Over the incremental path's 5-day overlap that is a
refresh; over 1095 days it is a silent re-filing of the user's entire history against
today's rules — every report total moves, with no user action behind it and no audit trail.
It would also widen the #128 pending reconcile's in-window pass from 5 days to 3 years.
**The same code means something different at a different overlap width.** So a pure planner
(`simplefin-history-backfill.ts`) decides what is genuinely new and the writer creates only
that, mirroring the Plaid precedent (`plaid-history-backfill.ts`, #18b6ad6).

**What "add-only" does and does not cover — the finding that cost cycle 1 a P0 and a P1.**
It bounds what you WRITE. It does not bound what your write MEANS to something derived from
it:

* **P0 — a superseded predecessor.** The reconciliation boundary claims the window
  `[predecessor.span.first, cutover]` from that predecessor's FULL-HISTORY minimum date and
  DROPS every successor row inside it (`reconcile-boundary.ts` `txnKeepRule`). Backfilling
  three years onto a predecessor drags `span.first` back three years and therefore deletes
  three years of the *successor's* rows — the ones carrying the reader's corrections and
  splits — from every figure, **without updating a single row**. `refuseManualWriteToSuperseded`
  already declares these accounts read-only for manual entry and CSV; this is that rule for a
  feed write. Not writing is the only defence; add-only is not one.
* **P1 — a derived pass.** `refreshTransferFlags` writes `isTransfer` onto ALREADY-STORED
  rows when a newly added row supplies a missing counterpart, on a coincidence rule (equal
  magnitude, opposite sign, ±3 days) that a three-year backfill hands three extra years of
  chances — silently removing settled rows from every spending total. It is therefore NOT
  run here; transfer pairing stays on the next ordinary sync where the reader can attribute
  it. `refreshRecurringForUser` IS run: it writes only derived RecurringSeries rows, never a
  Transaction, and re-deriving cadence is the entire reason more history is worth having.

**An empty plan is not proof the history is complete.** A 200 carrying `errors`, or a
partial response omitting `transactions`, produces the identical empty plan — and the planner
deliberately refuses to read a missing array as "no transactions". Marking done on that would
deny the reader the fix permanently: the flag gates the only trigger and no surface can ask
for a retry. A run counts as done only when a mapped account actually reported an array;
`data.errors` is now read (nothing consumed it before). Exception: zero mapped accounts is a
real "nothing to do", not a bad response, and marks done rather than refetching forever.

**Never record that work is done on the strength of work that has not run.** Setting
`historyBackfilledAt` at connect looked free — a fresh connection already pulls the full
window. But a first sync that *succeeds and returns nothing* still writes `lastSyncedAt:
today`, pinning every later sync to a 5-day window while the pre-set flag blocks the only
mechanism that could widen it again: the reported defect, made permanent by its own fix. The
flag is set only by the backfill's own completion. A RECONNECT clears it — a new credential
may reach history the old one could not, and re-running an add-only pass is cheap insurance.

**Bounded per run, because a timeout is not catchable.** The LLM assist (`assistUnsureRows`)
fans out one concurrent call per distinct unsure descriptor with no internal cap; its only
prior bound was that the live sync feeds it a 5-day window. Running it over the whole plan
before the first `create` meant a killed run committed **nothing** and the retry repeated the
identical work forever. The ingest is now chunked (250) and capped (2000/run), oldest-first
so a partial run extends the span downward rather than holing the middle, and `markDone` runs
only when the whole plan is consumed. `syncSimplefinNow` also gained the repo's standard
`rateLimitDurable` — AutoSync's only other brake is a per-TAB `sessionStorage` throttle, so
three tabs meant three concurrent three-year fetches.

**Measured, not asserted** (`tests/unit/simplefin-history-backfill-scale.test.ts`, gated
behind `H5_SCALE_PROBE=1`): 3000 rows over ~1090 days converge in 2 capped runs at
1.55 ms/row, and a forced full re-plan against an entirely-stored history adds 0 rows,
creates 0 duplicates and drifts 0 columns.

**Critic cycle 2 — FAIL (1 P0 + 3 P1), all executed, and the P0 was cycle 1's own fix.**
Cycle 1 made a reconnect CLEAR `historyBackfilledAt`, and the line above it had been
setting `lastSyncedAt: null` since long before this slice. Together they made a reconnect
take the full-pull branch through the LIVE ingest *and* then fetch three years a second
time. Measured on a probe: a stored 2024 row moved Groceries → Coffee, silently, with no
audit row — the exact harm this slice routes around everywhere else, on the one path
nobody had tested. `Disconnect` deliberately KEEPS the history and the UI hints at
"reconnect", so it is a shipped route, not a corner. Fixed by NOT nulling `lastSyncedAt`:
the incremental sync covers recent activity and the add-only backfill delivers the depth.
The other three: rows that fail to prepare were charged to the per-run cap though they can
never be stored, so one bad-format bridge could pin the cap forever and the backfill would
never converge (the cap now rations only what CAN be prepared); `accountIdByRef.size === 0`
marked done even when every account had been EXCLUDED as superseded, which is reversible
via `undoneAt`, so undoing a combination left the history unwidenable forever; and the
oldest-first ordering that the cap's whole safety argument rests on was asserted by
nothing — a newest-first sort left the suite green while the owner's March floor survived
every run. A planner skip for undatable rows (`posted: 0`, no `transacted_at`) was added in
the same pass: the date fallback is TODAY, which is sane at a 5-day window and mints
three-year-old charges into the current month at 1095.

**Critic cycle 3 — FAIL (1 P0 + 3 P1), and the P0 was cycle 2's fix, again.** Cycle 2's
comment named `disconnect → connect` as the route it was closing, and closed the upsert's
`update:` branch — but `disconnectSimplefin` DELETES the connection row, so that route
takes `create:`, where a null `lastSyncedAt` still meant a 1095-day pull through the live
ingest over the rows the disconnect deliberately KEPT. Measured again: Groceries → Coffee.
A connection created for a user who still holds SimpleFIN history is now given today's
date, so the sync goes incremental and the add-only backfill supplies the depth (no data
is lost to the narrower window: anything the gap contains is unstored, so the backfill
adds it). Cycle 2's superseded-retry was also wrong in the other direction — it traded a
permanent trap for a permanent LOOP (a 1095-day fetch, a full providerRef scan and an
audit row on every sync, forever). Reversibility is now handled as an EVENT:
`undoReconciliationFor` clears `historyBackfilledAt`, which makes marking the state done
safe. Two tests carrying cycle-2 finding numbers were proven no-ops by sabotage and
rewritten to cross the limits they name.

**Surface:** none built, and none needed — `transaction-filters.tsx` already prints "History
available from <date>" derived from the OLDEST ACTUAL TRANSACTION, never from a promised
window, so it states what came back and moves back on its own when the backfill lands. A
critic flagged this as missing; it was verified present instead of rebuilt.

## #414 — the Plaid deep-history backfill mirrors H.5, and every server-performed un-supersede re-arms both providers' backfills

**2026-08-05 · Fable 5 session · commits `29d08be` + the cycle-2 fix commit**

**The decision:** the Plaid deep-history backfill (`backfillItemHistory`) adopts the
critic-tested SimpleFIN H.5 shape wholesale rather than receiving a minimal
supersession patch, and backfill re-arming becomes ONE authored event
(`rearmHistoryBackfills` in reconciliation.ts) invoked by BOTH server-performed
un-supersede paths — the explicit `undoReconciliationFor` and
`confirmReconciliationFor`'s direction-conflict auto-undo, after its SERIALIZABLE
transaction commits.

**Why the full mirror and not the one-line filter:** the shipped Plaid path carried
four more of the exact defects H.5's critics had rated P1 on the twin — the LLM
assist fanned out over the WHOLE plan before any commit (a killed serverless run
made no progress and repeated forever), a truncated fetch marked done (an empty
page with `total_transactions` still ahead read as "history complete", permanently,
because the flag gates the only trigger), one malformed row aborted the entire run
(`plan.rows.map(prepare)` — one throw, nothing lands, `.failed` forever), and no
ordering/cap existed at all. Fixing only the reported defect would have shipped the
known-fixed shape four more times (`a-fix-on-the-reported-surface-is-not-a-fix-on-the-pattern`).

**Measured live BEFORE building** (`scripts/audit-probes/plaid-backfill-exposure.mts`,
read-only, executed): no harm had occurred — all 12 items backfilled 2026-08-04 with
`added: 0`; the sole plaid→plaid reconciliation's predecessor hangs off a
disconnected item no live fetch can map. Prevention, not repair. The probe also
answered H.6's gate (`added≈0` ⇒ fresh Link is the only deeper-history route) and
found the owner's SimpleFinConnection row deleted (H.5's backfill awaits a
reconnect).

**Critics (two fresh-context, isolated worktrees — the H.5 sabotage-in-commit rule):
0 P0, 4 P1, 6 P2 combined.** Critic B's three P1s fixed + locked same cycle: the
auto-undo re-arm (executed: the fix-the-direction repair flow stranded the skipped
history behind a set flag); the oldest-first lock that a pre-sorted fixture made
vacuous (deleting the sort passed — the fixture is now served newest-first, the
order a real feed uses); and the unlocked one-time guard (removing it passed 81
tests while re-fetching 730 billed days on every sync — a second-sync
zero-`/transactions/get` assertion now locks it). Critic B's P2-4 (race-loser catch
exercised by nothing) locked via P2002 injection. Critic A's P1 — the transfer
sweep's settled-row pair-flip, with the sharpened fact that H.5's dropped refresh
was only a ONE-SYNC deferral — is a standing shared-sweep defect on every sync
source, recorded as **TASKS H.7** (a measured semantics decision on
`planTransferUpdates`, not patchable from the backfill).

**Accepted residuals, recorded not fixed:** (a) TOCTOU — the superseded snapshot is
read once per run; a reconciliation confirmed mid-run (requires an unstamped legacy
predecessor or an item deleted mid-run to pass confirm's liveness refusals) can
still receive rows; mirrored shape in the twin; the chunk-time re-read is the fix if
it ever fires. (b) One undo re-arms EVERY item + the SimpleFIN connection
(12×730d + 1×1095d fetches on the next sync) — the H.5 cycle-4 P2 stance, kept for
one-author simplicity; add-only makes it cost, not corruption. (c) A backfill that
dies mid-run reports `added: 0` while its committed chunks are real — cosmetic,
converges next sync. (d) HYPOTHESIS: offset-pagination row-skip under server-side
deletion between pages can complete while missing one row — inherent to
`/transactions/get` offset paging, unprovable without a live drifting server.
(e) The un-supersede paths NO write performs (successor deletion; feed-driven
type/currency drift) still do not re-arm — the H.5 OPEN P1, now explicitly covering
`PlaidItem.historyBackfilledAt`, still owed the state-derived redesign.

## #415 — a pair-only transfer guess may not silently overturn a settled verdict, and the sweep reads what the boundary owns

**2026-08-05 · Fable 5 session · TASKS H.7**

**The decision, in one line:** `isTransfer` is a categorization verdict wearing a
different column, so the flag branch inherits the protection the file branch has had
since #148 — a heuristic pair may SUPPLY a verdict, never silently REVERSE one — and
`refreshTransferFlags` stops being the one read surface in the app that ignores the
reconciliation boundary.

**Why it was not an age gate or a confidence gate, both of which were measured and
rejected.** An AGE gate would have refused exactly the corrections a deep-history
backfill exists to make (a genuine counterpart surfacing years later is the case the
sweep is FOR). A CONFIDENCE gate was measured useless on the owner's corpus: the
genuine brokerage fundings and the false coincidences both sit at 9000-9900 bps, so
no threshold separates them. What DID separate them was evidence about the pair
itself, which is why the rule is evidentiary rather than chronological.

**Measured first, decided second** (`scripts/audit-probes/h7-*.mts`, read-only against
production, replaying the real engine over 3,065 real rows rather than a replica):
92 settled rows carried `isTransfer: true` under a non-transfer category, withholding
$21,411.05 of inflow and $181,281.51 of outflow from every figure; 73 stood on nothing
but a pair. Splitting those 73 by the evidence they actually had: 45 were
duplicate-account artifacts, 12 brokerage funding, 9 card/loan payments, 7 nothing but
an equal amount within 3 days. The critic's repro was found LIVE and twice over — a
$500.00 "CEF I CEF IV PPD" distribution settled at 9900 bps, cancelled by a $500.00
Zelle payment to a landscaper two days earlier, with BOTH the real income and the real
expense vanishing from their totals.

**Two causes, two scopes, deliberately not merged.**

*The boundary (universal).* The dominant cause was not the gate at all: the sweep read
every row, while the register, CSV export, budgets, recurring detection and triage all
filter through `getReconciliationTxnKeep`. (An earlier draft of this entry called the
sweep the ONLY reader skipping that filter; that is false — `backfill.ts`, `rules.ts`,
`keyword-rules.ts`, `self-audit.ts` and `household-digest.ts` skip it too, recorded as
TASKS H.8. The sweep is the only one that matches rows against EACH OTHER, which is why
a duplicate manufactures a transfer here rather than merely doubling a figure.) With 26 active links, 1,215 of 3,065 rows
were not the sweep's to read, and it was pairing rows against their own duplicates —
the same-account case `transfers.ts` already declares invalid. Applying the app's own
keep-rule removed 53 of the 73. This is a CORRECTNESS fix and applies to every row: it
restores an existing guard that duplicate accounts defeated, and it is exact, because
the link exists only on an explicit user confirm.

*The direction gate (overturns only).* An OUTFLOW on a credit line is a purchase, not
money leaving for another account, so it cannot be a transfer's sending leg — which is
what the last 4 false overturns had in common (a $500 KALSHI charge, a $7.00 Tesla
Supercharger, a $100 AT&T bill). But this one is a HEURISTIC with real counterexamples:
a balance transfer debits the receiving card, and a cash advance genuinely sends from a
card. So it is scoped to the overturn decision alone and never suppresses detection
generally. The asymmetry is the whole argument: refusing to overturn leaves the row
exactly as its owner filed it and visible in every total — a state they can see and
correct — whereas a silent exclusion is one they cannot. The heuristic's failure mode
is therefore inaction, never a rewrite.

**What the two together leave standing** (the point of the measurement, not a claim of
perfection): replaying the SHIPPED rule from scratch over the boundary-owned rows
(`h7-shipped-plan.mts`, which supersedes the replica-based figures the design was
chosen on) yields 66 flags and 29 settled verdicts it still endorses reversing. 28 of
those 29 are the genuinely correct ones — the "Funds Transfer to Brokerage" fundings,
the Capital One and Chase autopays, two Truist mortgage payments — and ONE is a
residual false positive: a $0.07 "Interest Paid" inflow matched to a $0.07 Vanguard
money-market row. Chasing it would mean inventing an amount floor with a magic number,
which the evidence does not support; it is recorded in STATUS as an open residual
instead. A second, unmeasured residual is named there too: a settled CASH outflow can
still be overturned by a coincidental cash inflow, because direction-coherence cannot
distinguish that from a real checking-to-savings transfer.

**What was NOT done, and why.** No retroactive repair: flags stay add-only, so the 45
existing bad flags are not swept away by this change. Un-flagging is itself a silent
rewrite in the opposite direction, on money figures the owner has already seen, and it
belongs to an owner-visible decision rather than a sync-path fix. No re-filing of an
overturned row's category either — #148 stands, so a row the user filed as "Rent" keeps
saying Rent even when the flag now excludes it.

**A discovery the fixture forced.** The first boundary test PASSED against the unfixed
code: `txnKeepRule` treats a cutover predating the predecessor's first row as a
DEGENERATE claim and keeps everything (critic A-F8 — never erase a whole history that
has no successor copies), and the fixture had no pre-cutover history, so it had built
the one shape in which the boundary deliberately drops nothing. The fixture now carries
a pre-cutover anchor row and the reason inline. This also means some real duplicates
legitimately survive the boundary; the live measurement already reflects that, because
it ran the shipped rule rather than a description of it.

**REVISED after critic cycle 1 (same day, same slice).** Two fresh-context critics
in isolated worktrees returned 1 P0, 5 P1, 4 P2, 1 P3, and two of those changed the
design rather than patching it.

*The evidence bar is one bar, over every write.* The P0: every synced row is BORN
`needsReview`, so gating only the SETTLED case let the coincidence win on the very
first sweep — and `fileIds`, untouched by the first cut, is the HEAVIER write,
since it also stamps `categoryId: 'transfer'` and clears `needsReview`, removing
the row from triage. The critic executed this slice's own live repro end to end
and the $500 still vanished. Fixing it exposed a second defect of mine: gating
filing while still FLAGGING would have recreated the pre-#165 wedge, because a
flagged `needsReview` row is hidden from the triage queue by its own transfer
guard AND excluded from every total. So an unevidenced pair now receives no action
at all — not a weaker one.

*The reconciliation boundary belongs in the matching rule, not the input.* The
sharpest P1: `getReconciliationTxnKeep` disowns a successor row dated inside the
predecessor's claim, so when that row is the only copy of a transfer's paying leg,
the sweep — a WRITER — went blind to it while every reader still counted its
counterpart on the unlinked side. Executed: a $123.45 card payment read as
negative spending, taking a month's expenses from $200.00 to $76.55. The general
rule this yields, and the reason the mechanism was replaced rather than patched:
**a writer that guards a flag must see at least everything its readers see.** Rows
now carry a confirmed account IDENTITY (`activeTerminalSuccessorMap`) and the pair
rule refuses two rows on the same real account — the same protection, with nothing
removed from the sweep's view.

*Three smaller reversals of my own reasoning.* `LOAN` and `MORTGAGE` joined
`CAN_SEND_ACCOUNT_TYPES` after a critic executed a $20,000 HELOC draw the owner
had filed as Income and watched it stay Income — in the income bars, the FI
savings rate and the tax export; my claim that refusing to overturn is "always the
safe direction" is false whenever the recorded verdict is itself the wrong one.
The overturn write gained the premise re-assertion I had argued it could not need
("a row can only become MORE settled inside the window" — `undoCorrections`
falsifies it). And the SQL mirror of `hasCompetingVerdict` now reads one exported
constant, after a critic deleted `'uncategorized'` from the hand-typed copy and
the whole suite stayed green.

*Re-measured with the shipped code* (`h7-shipped-plan.mts`): all 3,065 rows read,
114 flags and 39 overturns justified from scratch, two residual false ones (the
$0.07 interest rows). Unrepaired set: 53 rows / $29,848.84. Cycle 2 is owed — the
fixes are sabotage-locked and re-gated, not yet adversarially reviewed.

## #416 — a reader that describes or writes what a register shows must apply the register's own ownership rule

**2026-08-06 · Fable 5 session · TASKS H.8**

**The decision, in one line:** the R1 reconciliation keep (`getReconciliationTxnKeep`)
is not a property of the register — it is the definition of which transaction rows the
user OWNS on a screen — so every count rendered about those rows and every batch write
aimed at them applies it, through one post-fetch filter site per reader, while a
pure EVIDENCE reader (corrections feeding learned rules) deliberately does not.

**Measured first, fixed second** (`scripts/audit-probes/h8-boundary-readers.mts`,
read-only against production, 26 active links): of the six unboundaried readers H.8
enumerated, two were clean (spending-plan loan inflows — delta 0, merchant sets
byte-identical; household digest — structurally protected) and three reached rendered
numbers or write sets: self-audit rendered "75 of 2,456 needed sorting" against a
triage queue holding 7 of 1,332; the keyword-rule preview counted 1,124 invisible rows
($271,467.59) and its Apply wrote categories onto them; the backfill scanned 75 where
the register owns 7, spending the LLM ~10× and stamping `needsReview: false` on rows
an undo would resurrect silently pre-filed.

**Why corrections stay unfiltered.** A correction on a disowned row is the user's
decision about a payee, and H.7 P1-3 is the standing lesson: filtering an evidence
read blinds the learner to decisions its outputs still act on. The asymmetry is
deliberate and now recorded in the reader itself: counts and writes take the filter,
evidence does not. The critic's cycle-1 P2 sharpens this: the real hazard was never
READING old corrections on disowned rows — it was WRITERS still minting new ones
there, which the cycle-1 fix ends.

**Critic cycle 1 (fresh context, isolated worktree): FAIL — 1 P1 (executed), fixed
same cycle.** The merchant-batch writers (`fileMerchantGroup`, `applyToAllSimilar`,
`recategorize scope:'merchant'`) and triage's `similarCount` were never swept: the
keep-filtered group card said "File all 2" and the tap filed 3, minting a
no-`sourceRuleId` Correction on the invisible row — a hand decision the user never
made, feeding the unfiltered learner. All four sites now carry the filter the
spend-class twin (#397) has had since it shipped. Also from the critic: the
`excludedReason` sentence claims absence rather than a counted twin (true for a
predecessor's own post-cutover row); the race comment states both directions; a
fail-open lock proves an inert link reverts ALL readers together to pre-H.8 behavior.

**Locks:** `tests/unit/h8-boundary-readers.test.ts`, 10 tests; fail-old proven by
seven executed sabotages (each filter deleted → exactly its own lock RED), residue
grep 0. Gate: verify GREEN twice; no schema change; no prisma diff.

## #417 — a zero is a claim on the register too: the empty state names WHICH zero, from the bounds the page already printed

**2026-08-06 · Fable 5 session · TASKS K.3 (owner report, LIVE)**

**The decision, in one line:** when a surface already holds the fact that explains its
own emptiness, the empty state must be computed FROM that fact — so `/transactions`
answers a zero by comparing the reader's own window against the history bounds it just
rendered, instead of branching on a boolean that can only ever say "filters".

**The report.** The owner set a custom window of Aug 6 2024 → Aug 6 2025. His register's
history starts Mar 25 2026. The page printed, in this order: "History available from Wed,
Mar 25, 2026." · Money in $0.00 / Money out $0.00 / Net $0.00 · "0 transactions." · "No
transactions match these filters." Every sentence was true and the screen was still
incoherent — one line held the reason, another asserted a different one, and nothing
joined them. His conclusion, verbatim: *"we have no trailing data in transactions."* He
was right about the data and could not have known it from this screen.

**Why the boolean could not have got this right.** `hasFilters` (#186) answers "is a
filter on?", which has exactly two outcomes: "no data yet" and "filters matched nothing".
The register's zeros have at least four causes — no rows at all, a window ending before
the first row, a window starting after the last, and a genuine empty match inside the
span — and the middle two are the only ones the reader cannot diagnose by looking. This
is `a-zero-is-a-claim-and-must-name-which-zero` (four facts rendering one `− $0.00`),
reached from the opposite direction: there, the figure was unnamed; here, the naming
sentence existed and the wrong surface was doing the talking.

**The shape.** A pure `registerEmptyReason` returns a discriminated
`RegisterEmptyReason`, and each window kind carries BOTH dates it compared, so the copy
states a comparison ("history starts X, this window ends Y") rather than asserting a
bare bound. The two new kinds are tested FIRST because they are the certain ones —
decided against the register's own loaded set — and everything else falls through to
#186's answer verbatim, including the empty-register-with-a-filter case, which is
deliberately left alone as a separate decision.

**Agreement is the property, not the sentence.** The bounds come from the single scan
that produces `oldestDate` (now `newestDate` too), which is the same value the filter
bar prints as "History available from …". The e2e asserts the two name the SAME date by
reading the printed one off the DOM and requiring the empty state to contain it — the
defect was two surfaces disagreeing, so "a date rendered" would not have been a lock.

**Failure direction, chosen deliberately.** `from`/`to` come off the URL and NOTHING
upstream validates them (`str(sp.to)` is `''` when unset, and `?to=banana` is reachable),
while `isoDate()` throws. A bare cast here would have converted a cosmetic empty state
into a thrown page on a route that renders fine today — caught in this session by reading
`isoDate`, not by a test. An unparseable bound is therefore treated as ABSENT and the
reader falls through to #186.

**What this does NOT do:** it does not add a second way to clear the window (Clear is
already on screen), and it does not make the data reach further back. The owner's real
ask — three trailing years — is TASKS K.2, and no copy change can satisfy it.

**Gate:** verify GREEN — tsc 0 / eslint 0 / **6126 unit across 371 files** / build clean;
`transactions.spec` 21/21. Fail-old proven by four executed sabotages, each restored and
residue-checked: each window branch deleted fails only its own locks (3 red, then 1 red),
removing the total-parse guard fails the two URL-input locks, and blanking the page wiring
fails the e2e after a rebuild. No schema change, no prisma diff.

### #417 critic cycle 1 — FAIL, 4 P1 + 5 P2 + 2 P3; all four P1s executed and locked

A fresh-context critic in a separate context returned **FAIL**. The four P1s, and
what each one actually was:

* **F1 — the remedy was refused for the reader it shipped to.** The
  `before-history` sentence offered "Import a CSV from your bank", and
  `transaction-actions.ts` refuses `importTransactionsCsv` for the demo user —
  who, on production, is *every anonymous visitor*. The slice's own e2e drove
  that exact path and asserted only the date beside it. The remedy is now gated
  on `canImportCsv`, and the e2e asserts its ABSENCE for the demo.
* **F2 — the zero was named below the zeros.** The owner's report named four
  figures: `$0.00 / $0.00 / $0.00` and "0 transactions." The first version
  explained the emptiness in a box underneath all of them, which is the lesson's
  own counter-example ("say which zero it is WHERE the zero is"). The count line
  now carries the naming clause; `isWindowExplainedZero` is the shared predicate
  so the box and the line can never disagree about whether a window explains it.
* **F3 — an inverted window got a false cause AND a false remedy.** `from` after
  `to` is two clicks away (the date inputs carry no `min`/`max`) and fell into
  `before-history`: the reader was told to import older data for a window that is
  empty by construction, so they would import it and still see zero. New
  `inverted-window` kind, decided FIRST and without consulting the bounds at all
  — locked by a test asserting the verdict is identical with and without history.
* **F4 — `newestDate` and the whole `after-history` path had no lock.** The
  critic's sabotage (`r.date > newestDate` → `<`) collapses the two bounds and
  stayed green across 6,126 tests. New `register-history-bounds-server.test.ts`
  drives the real loader; that sabotage now turns 3 of its 5 red.

**P2s fixed with them:** the copy says "history here", not "your history" (the
bound is read off a set narrowed to spending types and USD and NOT re-narrowed by
the reader's account filter — F6/F9); `after-history` drops "yet" and points at
`/accounts`, because its realistic cause is a feed that stopped and telling that
reader to wait is the opposite of the right move (F7/F11).

**F5 is the one worth recording on its own**, because the critic disproved a
claim in this file's first version. The docblock justified `asBound`'s tolerance
with "a bare `isoDate()` would throw a route that renders fine today" —
`/transactions?to=banana` was **already a 500**: `filterTransactions` casts the
same value with an unguarded `isoDate` and runs first. So the tolerant branch was
unreachable and its comment asserted a defect did not exist
(`a-dead-branch-is-a-claim-that-something-is-handled`). Fixed at the boundary
instead: the page drops an unreadable bound before building the filter, which
closes a live 500 on the reported surface and makes the engine's guard the
second of two agreeing validations rather than dead code.

**Open, recorded rather than fixed (TASKS K.4):** the owner's exact pair survives
one filter away — a reader narrowed to a card connected last month who picks
"Last year" gets `to` inside the GLOBAL span, falls through to `filters`, and
sees "No transactions match these filters" under "History available from …"
again. The real fix is to compute the printed bound at the filtered scope too,
which changes the shipped filter-bar line as well; narrowing one without the
other would re-create the disagreement this slice removed.

**Re-gate:** verify GREEN — tsc 0 / eslint 0 / **6137 unit across 372 files** /
build clean; `transactions.spec` **24/24**. Seven executed sabotages across the
cycle, each restored and residue-checked.

## #418 — the app's purpose is the FI-coach mission, not the cash-needed question

**2026-08-06 · Fable 5 session · owner-directed (synthesized per his instruction — he
gave a stream-of-consciousness statement and asked for a cohesive summary, explicitly
not a verbatim record)**

**The decision, in one line:** whenever the app is described — to the owner, in the
README, in app copy, in docs — the answer to "what is this app for" is the
conscious-spending / financial-independence mission, and the Cash-Needed Engine is named
as a feature that serves it, never as the definition.

**The purpose, synthesized:** Aimplifi exists to make its users deliberately wealthier —
a financial coach with a bank feed, not a bank feed with charts. It combines
Mint/Simplifi-grade aggregation with the practical personal-finance canon (*I Will Teach
You to Be Rich*, *The Psychology of Money*, and the rest of SPEC.md Differentiator #3)
expressed as AI-driven product behavior: organize the complete financial picture, show
where money actually goes, cut the expenses that don't buy happiness while protecting
the spending that does (money dials), and keep the long game — financial independence,
retirement, the user's own goals — visible and on track. "How much money do I need and
when" is the Cash-Needed Engine's job: a flagship feature and a design element, not the
app's identity.

**Why this needed a decision at all:** the recorded framing had drifted. README opened
with "built around one killer question" and CLAUDE.md's build loop carries the
under-10-seconds cash-needed benchmark, so every fresh session (and every AI answer to
"what does this app do") led with the feature. Meanwhile SPEC.md's Differentiator #3
already encodes exactly the mission the owner restated — Sethi's money dials, Psychology
of Money principles, savings rate as the headline metric, big wins not latte shame — so
this is a framing correction, not a spec change. It is also the same signal as Wave W
(2026-07-31, "parity is the baseline… building in principles from personal finance
books"): the differentiator half is the half the owner actually bought.

**What changed (docs only, no code):** CLAUDE.md gains a "Purpose" section directly
under the project header carrying the synthesized statement; README's opening now leads
with the mission and lists the Cash-Needed Engine, disappearing categorization, and the
FI Coach as the three features that carry it. The cash-needed UX benchmark in the build
loop stays — it is a fine benchmark for a flow; it is just not the app's identity.

**Standing consequence for prioritization:** ties between parity work and
differentiator work (Waves W/P — coach intelligence, dials, wealth targets) break
toward the differentiator, per this statement and Wave W's.

## #419 — K.1: the past half of /calendar is recorded fact, totaled by the register's own math; the future half is labeled the projection it is

**2026-08-06 · Fable 5 session · TASKS K.1 (owner report, LIVE: "Calendar makes no
sense. I have forward data but not trailing?")**

**The decision, in one line:** a calendar day on or before today shows what the
banks actually reported for that day — read through the register's own basis and
totaled by the register's own `summarizeTransactions`, so the two surfaces cannot
disagree on a total by construction — and every event after today is a labeled
projection, never something that reads like data.

**The design.** New pure `buildPostedCalendarMonth` (engine/calendar/posted.ts)
takes lean rows from `getPostedCalendarRows`, which reuses the register's exact
where-clause (extracted once as `registerRowWhere`) plus the R1 reconciliation
keep — the K.1 gate is not a test target, it is the shape: one where-clause, one
keep, one summarize (`summarizeTransactions`'s signature widened to the minimal
`TotalableTxn`, so the register's own function totals both surfaces). Each posted
day paints Money in / Money out / count and links to
`/transactions?from=D&to=D`, carrying its window so the drill-down describes the
same basis (the O.16 borrowed-total lesson). Scheduled-series expansion in
`buildCashFlowCalendar` now starts AT today — the replay of a series onto dates
the bank already reported was exactly what the owner mistook for trailing data —
while due events are untouched (an unpaid current-cycle due in the past is fact,
not replay). Zeros follow K.3's rule with the bound inside the reason
(no-history / before-history / after-history / quiet, discriminated union), the
history floor and the trailing lag edge are named where the gap is, and the
posted half is viewer-only at household scope by design (a partner shares
scheduled flows and dues, never transaction rows) with the scope said on the page.

**Two fresh-context critics, run in parallel — BOTH FAIL: 2 P1 (wiring) + 3 P1
(copy, one shared with wiring) + 12 P2, all P1s and 8 P2s fixed and locked.**
The converged P1: the header said "Posted" over PENDING money — the demo's own
pinned month holds three pending rows inside the figure, a live hold can be
repriced or vanish, and the aggregate erased the status badge the register shows
per row. The money stays (the register's summary counts pending too — the gate
demands it) but the words now carry it: "Posted + pending", per-day "(N
pending)", footer states pending can change. The second wiring P1 was an
off-by-one against the engine: the first clamp started projections at today+1
while the cash-needed assembler expands `>= today` and can recommend a transfer
FOR today — so a bill expected today painted nowhere on its most actionable day,
and a projection going short TODAY on an already-low balance could lose the dip
paragraph entirely while the frozen notice still claimed it was on the page (the
day list now keeps the shortfall day unconditionally). The third: the
before-history sentence declared reconstruction impossible while the register's
own empty state offers the CSV import one click away — the sentence now states
the floor and the page offers the same remedy, demo-fenced with the register's
own predicate. P2s fixed with them: "the register" renamed to words this page
actually uses; the after-history remedy link now renders in the header case (a
stopped feed's future dues keep the grid non-empty, which is exactly when the
link used to vanish); transfer/excluded-only days say what their zero is made of;
past-day nets are labeled "net (recorded)" when a due sits beneath them and the
footer names the two net semantics; "Scheduled:" became "Expected:" with already-
due payments counted out loud; a fully empty month names its zero once, not
twice; the household scope note no longer hides exactly when the viewer has zero
rows; bank attribution dropped from sentences that cover manual rows. Residuals
RECORDED, not fixed: the duplicate/frozen banners' "money-out total above" clause
is ambiguous now that two out-figures sit above (their copy lives in two
critic-cycled modules — own slice); a frozen non-card feed silently thins recent
posted days (parity with the register today; belongs with the L.19 family); two
full-history loads per calendar view (register precedent, ROADMAP #8).

**Two process finds worth their own lines.** (1) The full-suite verify exposed
THREE e2e failures that exist on clean main — proven by stashing this slice and
rerunning — because O.16's `?back=` return-context param broke
transaction-status.spec's URL regexes, which pinned detail URLs to end at the id;
that session evidently never ran this spec. Repaired here (regexes tolerate the
query; lookaheads still exclude /new and /import). (2) A background verify's
`| tail` masked its exit code and nearly recorded a false "baseline passed" —
the pipe returns tail's status, not verify's. Capture `$?` from the command
itself, never from a pipeline over it.

**Gate:** `npx tsc --noEmit` 0 · eslint 0 · **6,161 unit + 1 skipped across 374
files** · `next build` clean (all from `VERIFY_E2E=1 bash scripts/verify.sh`,
exit captured directly). New unit: calendar-posted (25) + calendar-posted-server
(3, real loaders, register-equality asserted with hand-verified values). New e2e
calendar-posted 3/3 incl. a DOM-to-DOM gate check (a day's painted out-figure
equals the register's painted summary after following the day's own link);
calendar-frozen 6/6 unchanged. Full-suite e2e serialized: **283/297** — and the
14 non-passing (10 failed + 4 not-run behind them) are PROVEN pre-existing, not
flake and not this slice: the IDENTICAL set fails on a stashed pre-K.1 tree,
serialized. Three were O.16's `?back=` breakage (repaired this session); the
other ten assert the dashboard that commit 2e3bf72 (#369 "Home polish", Aug 1)
restructured — the recurring-total and payment-reminders cards were removed from
Home and their specs (auth:82, recurring:15, payment-reminders:14,
dashboard-duplicate-disclosure ×2, frozen-figure-surfaces:92, card-unknown-due:226,
phase2-triage:132, today-feed-frozen ×2) were never updated, because that session
did not run the full suite. Recorded as **TASKS K.5** — repairing them means
re-pointing each assertion at where #369 moved the surface, which needs that
commit's intent read first, not a mechanical regex pass. I initially misread two
truncated outputs as "passes in isolation" and called this flake — same lesson
as the masked exit code: proof is the command's own `$?` and the FULL failure
list, never a trimmed tail.

## #420 — K.5: a qualifier exclusive with an all-clear becomes a field, not a substring (2026-08-06)

**Context.** K.5 said ten e2e assertions "assert a dashboard that no longer exists" after
#369 orphaned `PaymentRemindersCard`, `RecurringSummaryCard` and `AskAimplifiCard`. Eight do.
Two (`phase2-triage:132`, and `:184` masked behind it by serial abort) are O.17's demo fence
on `createCustomCategory` and have no dashboard dependency — split out as **K.6**. Reproducing
before inheriting the diagnosis is what separated them; #419's own entry above records the
same lesson one step earlier.

**Decision 1 — `NudgeFeed.frozenDueNote` is its own field.** `frozenNothingDueNote` composes
the L.19/L.20 sentence for rows an all-clear cannot cover (frozen card, frozen dated loan,
undatable frozen loan). It was spliced onto the end of `emptyReason`, which the Today feed
renders only in its empty branch — safe only because the reminders card rendered the same
sentence in its list branch. #369 deleted that card, so a single live due card removed a
frozen mortgage from every page of the web app, leaving the weekly digest email as the sole
carrier. The rule adopted: **a qualifier that is owed to the reader whether or not the
all-clear is shown may not live inside the all-clear's own sentence.** `fundingFrozen` — the
other half of this disclosure — had already been a separate ungated field since L.20; this
half stayed a substring only because a second renderer happened to exist. The two are not
symmetric and the type now says why: `fundingFrozen` is exclusive with a proposal carrying the
same fact, while nothing on the feed can ever carry a frozen DUE row's fact, because a row we
cannot date produces no proposal to attach it to.

**Decision 2 — the eight re-points are judged by claim, not by selector.** Nothing "moved":
the components are orphaned. /cards took the duplicate disclosure and the undated section;
/calendar took named card AND loan dues, because the Today feed's `payment_due` row names no
account at all (`Proposal.merchant` is null for that kind); the Today feed took the frozen
note and the zero-balance-undated fence; `dashboard-recent-empty` took the sparse-card
invariant from the card that replaced the recurring one in that slot. `recurring.spec`'s
dashboard test was DELETED with a note in its place — Home deliberately no longer claims a
recurring total, so there is no surface to re-point at and no coverage lost.

**Decision 3 — the cross-surface consistency tests were re-established, not dropped**, per the
K.5 row's own instruction. "The hero and the reminders name the same card the same way" now
spans /dashboard ↔ /cards, which run SEPARATE identity passes over separately-ordered lists —
making the #299 residual more available than when both were on one page, not less. It passes.

**Corrected en route.** `cards-breakdown.tsx` narrowed its all-clear to cards because "the two
surfaces whose all-clear covers both are the dashboard reminders card and the weekly digest" —
a delegation to a surface deleted five days earlier, and a cross-file invariant nothing
enforced. True again now, and the comment says why it once wasn't.

**Two of my own re-points were wrong and the tests caught them first:** /cards makes the
total-claim rather than the reminders card's instruction-claim (correct — it prints
`scenario-required` immediately above the box, satisfying L.15's "where is the reader
standing" rule), and the demo Auto Loan has no due in the pinned month, so the calendar
assertion steps to the next month rather than asserting a loan the fixture cannot show.

**Why nothing caught the regression:** the nudge engine had ZERO `frozenDues` coverage — the
field appeared only as `frozenDues: []` in a fixture builder — so the composition was asserted
nowhere and its only renderer could be deleted in silence. Five locks now exist; the
regression one is sabotage-proven RED by re-gating the field on an empty feed. Lesson filed as
`docs/lessons/deleting-a-surface-deletes-the-claims-it-carried.md`.

## #421 — "all data possible" moved the SimpleFIN window from a comparison window to a calendar the owner named (2026-08-06)

**Owner instruction, verbatim:** *"why haven't we populated 2023-2026 yet. I want all data
possible."*

**The measurement that has to come first, because the question contains a premise worth
checking.** Re-ran `scripts/audit-probes/h1-connection-depth.mts` (read-only, committed) against
the live Neon corpus this session rather than quoting the 2026-08-05 figures:

```
USER michael.lee.p@gmail.com
accounts=56 (supported=56)  rows=3087  ownedRows=1872  activeLinks=26 (effective=26)
Q1  register global earliest: 2026-03-25  ← Capital One Venture (0966) [simplefin]
    Chase (item 0MLMzax8…)        raw=[2026-04-24..2026-08-05] n=295  backfill=2026-08-04
    …13 Plaid items, ALL backfilled 2026-08-04…
    simplefin:NO-CONNECTION-ROW   accts=25  raw=[2026-03-25..2026-07-21] n=1684
```

**So "we haven't populated it" is false in a specific and useful way: nothing was skipped —
both automatic routes were already asked for their maximum and both answered.** Plaid's
`days_requested` is at its documented ceiling of 730 (`plaid.ts:189`), the one-time deep-history
backfill ran on all 13 items on 2026-08-04, and it added nothing older than 2026-04-24. Plaid
holds no more. The SimpleFIN accounts hold 1684 rows reaching 2026-03-25 — that floor is the
90-day default their first pull ran under, before H.5 — and **the `SimpleFinConnection` row is
gone** (bucket `NO-CONNECTION-ROW`), so the mechanism built to widen exactly that floor has had
nothing to run against since ~2026-07-21.

**Decision — widen `SIMPLEFIN_INITIAL_LOOKBACK_DAYS` 1095 → 1460 (three years → four).** The
three-year value was chosen on 2026-08-04 against the app's own comparison windows ("beyond
every comparison the app makes — the longest engine window is 12 months, the widest chart 24"),
which is a defensible reason for a number and the wrong axis entirely for this ask. Measured
with `addDays`, not by hand: 1095 days before today is **2023-08-07**, so the previous constant
would have left **January–July 2023 permanently unreachable** through the only automatic route
that reaches multi-year at all — the owner names 2023, and the app would have quietly returned
five months of it. 1460 lands on **2022-08-07**: the whole stated range plus a year of margin,
so the answer does not decay as "2023" recedes.

**Not "all of time" (start-date 0), and the reason is now a cost rather than a taste.** A
too-wide ask does not fail loudly; it spends more capped `BACKFILL_MAX_ROWS_PER_RUN` runs (2000
rows apiece, oldest-first) before a connection converges, and a few bridges stall on absurd
windows. Four years is the widest window with a named reason behind it; the test bounds the
constant to [730, 1830] rather than pinning it, so the owner can move it in one line.

**The lock is a property, not a restatement.** `simplefin.test.ts` keeps its hand-verified
DEMO_TODAY instance (1460 days before 2026-06-10 is 2022-06-11 — the window crosses the 2024
leap day, which is what makes it the 11th) and gains a second test asserting the thing that
motivated the change: from any "today" in 2026, the window still reaches 2023-01-01. That test
found its own off-by-one before it was committed — at 1460 days, 2026-12-31 maps to **exactly**
2023-01-01, so the assertion is `<=`, not `<`; a window is inclusive of its own start, and `<`
would have failed a constant that satisfies the ask precisely at the year's last day. That
one-day margin is also why the constant is not trimmed below 1460.

**What this change does NOT do, stated because the gap is the whole point.** It moves no data
by itself. It sets the size of the ask that the deep-history backfill will make **the next time
a SimpleFIN connection exists to make it**. Reconnecting is an owner action (a setup token from
his SimpleFIN account), and `connectSimplefin` is already correct for it: a reconnect after a
disconnect takes the `create:` branch with `lastSyncedAt = today` (because 1684 rows are
retained, so this is not a first-ever pull and must not re-file them through the live ingest),
leaving `historyBackfilledAt` null — which arms the add-only backfill to supply the depth on the
next sync. Nothing in the app is blocking; the credential is.

**And the ceiling is the bank's, not ours.** Asking 1460 days does not mean receiving them —
SimpleFIN returns what the institution provides, which for some banks is ~90 days. Per-bank CSV
import (`/transactions/import`, shipped) remains the only route for institutions that cap short,
and it is the only route to 2023 for the Plaid-only banks at all. TASKS K.2 carries the
per-institution routing.

## #422

**K.8 — the unit gate's clock is pinned at the config, CI's Node is pinned to the local major,
and reading CI is now part of rule 5 (2026-08-06, Fable).**

**The defect (reproduced, not inferred):** `businessToday()` gives `process.env.DEMO_TODAY` top
precedence; `.env` sets it but vitest does not load `.env`, so the local unit gate ran on the
ambient wall clock while GitHub Actions supplied the pin as job-level env. Four money-math tests
(fi-real-basis ×2, loan-payment-flow-assembler, merchant-lens-server) passed locally and failed
on every CI push for days — `DEMO_TODAY=2026-06-10 npx vitest run` on the three files reproduced
all four byte-identically before the fix.

**Decision 1 — pin at the gate, not per-test-file-by-convention.** `vitest.config.ts` now sets
`DEMO_TODAY=2026-06-10` and `TZ=UTC` UNCONDITIONALLY (process.env + test.env, so forked workers
inherit at spawn and a shell-exported value cannot change the unit verdict — executed against
`DEMO_TODAY=2031-12-25 TZ=Australia/Eucla`, 45/45). The alternative — requiring every test that
reads the clock to pin its own — was rejected as a convention with no enforcement: the three
broken files are what that convention produces. Tests that need a different date still win via
`vi.stubEnv`. Tripwire: `tests/unit/gate-clock-pin.test.ts` (critic-proven non-vacuous; scope
honestly documented — it cannot see the deletion of just ONE of the two redundant mechanisms).

**Decision 2 — the three repairs pin the date their fixtures were written for; no hand-verified
money expectation changed.** fi-real-basis C.9 and the loan assembler stub `2026-08-15` (their
fixtures' months need an August+ today); merchant-lens-server derives its fixture dates FROM the
pin instead of a raw `new Date()` (fixture and engine can no longer disagree by construction).
Critic-executed fail-old on all three: the expenses6×2 sabotage, the C.25-disabled sabotage and
the POSTED-filter sabotage each turn the repaired tests RED.

**Decision 3 — CI's Node goes to 24 (the local major); no `engines` field.** The gate critic
found a FIFTH CI-red cause the clock work did not touch: verify.yml ran Node 20, and jsdom's
undici dependency requires ≥22.19, so the repo's only jsdom file (spend-window-render.test.tsx,
14 render-copy assertions) had NEVER executed on CI — an unhandled worker error on every run.
`node-version: "24"` matches the maintainer's v24.16. A `package.json` `engines` field was
considered and REJECTED this slice: Vercel reads `engines.node` to select the production
runtime, so adding it silently changes the deploy — bigger blast radius than a test-gate fix.

**Decision 4 — LLM keys are blanked in the unit gate.** The ambient machine carries a real
`XAI_API_KEY` (.env.local) that reached every vitest worker; CI has none. Same parity treatment
playwright.config.ts already applies: blank both keys at the config, tests simulate configured
providers with stubs. Executed: the three LLM-gated test files pass identically.

**Decision 5 — reading CI is part of shipping.** `scripts/ci-status.sh` (5 distinct exit codes;
short-sha resolution via git; gh auth failure reported as UNKNOWN, never as "no run";
cancelled = superseded, its own code) + CLAUDE.md rule 5 "Read the gate, not just the deploy"
+ rule 2 cross-reference (verify.sh = LOCAL done; CI conclusion = SHIP gate). Four of five exit
paths executed against real runs; `success` was unverifiable at decision time because no green
run existed in the last 100 — this slice's own push is the first candidate.

**Critic verdicts:** money-math critic PASS (0 P0/P1/P2, 5 P3 comment corrections, all applied);
gate critic FAIL cycle 1 (1 P0 = the Node finding, 1 P1 = the rule's self-contradiction, 4 P2,
5 P3 — all fixed or explicitly accepted with the acceptance written at the site).

## #423

**K.2(b) — a deleted connection stops impersonating a stale one: /accounts states the proven
fact, and the front door becomes a reconnect (2026-08-07, Fable).**

**The state (measured live, K.2/#421):** the owner's `SimpleFinConnection` row was DELETED
~2026-07-21; 25 accounts sat frozen 16 days printing "No new data in 16 days — you may need to
reconnect" — a stale-feed HEDGE over a connection that provably no longer existed — while the
connect button read "+ Connect a bank (SimpleFIN)", i.e. first-time setup. The fact was in hand
(views already computed `connectionLive`) and freshness never read it.

**Decision 1 — "removed" is claimed only when PROVEN, and unknown is never removed.** New
freshness level `disconnected` + REQUIRED `AccountFreshnessInput.connectionRemoved` (the L.14
required-argument rule). Proof shapes: a simplefin account with no connection row (single-
connection model — the row IS the connection, deleted only by `disconnectSimplefin`); a plaid
account whose STAMPED `plaidItemId` matches no live item (`removeItem` stamps linkage before
deleting, so a dangling ref only arises via a delete path). `plaidItemId: null` (pre-#256) stays
on the fallback: claiming "removed" over a live-but-unstamped feed is the catastrophic
direction. Deliberate asymmetry with the delete affordance's `connectionLive` (unknown ⇒ false
there) — deleting an unlinked row is safe, telling its owner the connection is gone is not.
`disconnected` outranks `not_shared` ("your bank stopped sharing" presumes a live connection)
and the INVESTMENT early-return (a disconnected brokerage keeps counting toward net worth).

**Decision 2 — the per-row line carries NO remedy; the front door carries it (critic cycle).**
Both fresh-context critics returned FAIL (0 P0; copy lens 3 P1 + 3 P2 + 2 P3, wiring lens 1 P1 +
1 P2 + 2 P3); all P1s fixed same-session. The per-row "Reconnect to resume updates." was FALSE
in two reachable states the copy critic executed: a Plaid re-link mints new account ids and can
never resume the old row (the probe's own orphaned card, 264 rows), and a reconciliation
predecessor is frozen by design. The row now states only the fact ("Bank connection removed —
last transaction N days ago" — transaction-precise, because balances can move on paths that
reference never sees); the SimpleFIN front-door notice, on the same page, carries the reconnect
instruction for the one provider where it is true. `orphaned` excludes active superseded
predecessors (K.1 P0-1 precedent): a user who migrated away on purpose gets the plain door, not
a permanent amber nag. "Resumes where your data stopped" was cut from the form copy — the H.5
backfill is oldest-first in capped batches, so the disconnect gap fills LAST; the copy now
promises kept data + background reach-back "as far back as your bank still shares".

**Decision 3 — the count's basis is ALL simplefin accounts (minus superseded), and it is now
sabotage-locked.** The wiring critic's sabotage (e) flipped the basis to the currency-supported
subset and the ENTIRE suite stayed green — the declared decision had zero coverage
(REGRESSION_LEDGER 2026-08-07). Locked with a EUR-holds-the-newer-transaction fixture that
makes the rejected basis fail on both fields.

**Also this session:** the K.2(a) probe ran (was permission-blocked): SimpleFIN's 25 accounts =
Amex 2 / CapOne 5 / Schwab 10 / Chase 4 / Vanguard 4; Truist + U.S. Bank are Plaid-only (CSV is
their only multi-year route); one orphaned Plaid card (264 rows, item removed) — which this
slice now names on /accounts by construction.

**Open residuals (recorded in STATUS §K.2b):** dashboard banner still hedges ("a sync may have
stopped") over the proven fact — portfolio-scope surface, own slice; H.5 backfill fills the
recent gap LAST (oldest-first batches) while rows read "Synced today" — machinery, own slice;
pending-at-disconnect rows that post backdated can fall between the 5-day live window and an
already-stamped backfill; SimpleFIN account-id stability across bridges UNVERIFIED.

## #424 — H.6: a deliberate re-link for DEPTH is not the duplicate L.10 refuses (2026-08-07)

**Owner instruction, verbatim:** *"Unacceptable we don't have at least plaid maximal dates."*

**He is right, and the cause is ours.** Plaid freezes an Item's transaction window at birth —
*"Once Transactions has been added to an Item, this value cannot be updated"*
(plaid.com/docs/api/link/, fetched this session), with `/item/remove` plus a fresh trip through
Link as the documented remedy. We ask for the 730-day maximum on every new link already
(`PLAID_DAYS_REQUESTED`, `plaid.ts:189/293`), but the owner's 13 items were created
2026-07-23/24, a week before that shipped, so every one carries the 90-day default. The live
floor measured under K.2 — oldest Plaid row `2026-04-24` — is exactly `2026-07-23 − 90d`, and
`backfillItemHistory` returned `added: 0` on all of them because Plaid holds nothing outside an
Item's birth window. There is no missing data to go and find.

**The defect: the owner cannot perform the documented remedy, because the app undoes it.** A
fresh link at a bank he already has returns only accounts he already has, so `classifyNewItem`
marks the new Item `whollyRedundant` and `decideAndPersistItem` hands it straight back to Plaid
(`plaid.ts:505-522`) — discarding the 730-day connection and keeping the 90-day one. That branch
is L.10 layer 2 doing exactly its job for the case it was built for (*"when I try to link same
account again, it just refreshes"* — owner, 2026-07-24). Re-linking for DEPTH is the one case
where "it just refreshes" is the wrong answer, and the two are indistinguishable from the
accounts alone: both return an identical account set. The difference is not in the data, it is
in what the owner asked for.

**Decision: carry the owner's intent, and exempt only that.** A link started from the new
"get the full two years" affordance is exempt from the wholly-redundant discard; the ordinary
front door keeps refusing exactly as today, so L.10's promise does not regress. Rejected
alternatives, and why:

* **Infer it — keep any link that would bring deeper history than the one it duplicates.** Needs
  no owner input and is true by construction, but it fires on EVERY re-link, including the
  repair re-link that is the commonest reason anyone re-runs Link. Most items have shallow
  history, so this quietly turns L.10's refusal off for nearly everyone.
* **Do it automatically — remove the shallow Item and re-link it ourselves.** `/item/remove` is
  irreversible and re-linking needs the owner's bank credentials regardless; a failed re-link
  after an automatic remove leaves him disconnected with nothing gained
  (`docs/lessons/irreversible-acts-need-live-proof.md`). Link first, drop second, owner's click
  at both ends.
* **Extend the existing Item.** Not offered by Plaid; verified above rather than assumed.

**Why an intent parameter is safe even though it is client-supplied.** The failure direction is
the one this whole path was designed around: a spoofed or mistaken intent produces a duplicate
connection, which the app discloses at the moment it is created (#299/#306), can combine (#304),
and can undo (R9). A wrong discard hands a live credential back to Plaid and cannot be undone.
`plaid-link-collision-wiring.test.ts` states that asymmetry as the reason most of its tests
assert the app did NOT act; this decision keeps the app on the same side of it.

**Nothing new is needed downstream, and that is the finding that shrank this slice from TASKS
H.6's 90k estimate.** Two live connections at one bank already combine
(`combineDuplicateConnections`), and `applyReconciliationBoundary` already resolves this exact
shape in the right direction: the successor keeps rows OUTSIDE the predecessor's claim span, so
*"the successor's deeper backfill is NEVER dropped"* (`reconcile-boundary.ts:17-23`, critic
cycle-1 F2). The owner's categories, splits and corrections live on the predecessor's rows and
survive untouched — the boundary re-points nothing.

**The owner's sequence, per institution:** link the bank again from the new affordance → the app
keeps both and says so → combine them, keeping the NEW connection → the old one is revoked and
its rows become the pre-cutover history of one continuous account. Two years, one account, no
data lost.

## #425 — H.6c + H.6b(b): the combine's default keeps the deeper connection, and a hand-split row stops blocking it (2026-08-07)

**Two follow-ups the H.6 critic proved by execution, both in the combine machinery the deepen
flow ends in. H.6's value is only realised if the last step goes the right way; before this,
it defaulted the wrong way and one split made it refuse outright.**

**H.6c — the ranking.** `keepRank` broke the both-directions-safe tie with "linked first wins".
Rules 1–2 (sync error; `lastSyncedAt` recency) TIE in the deepen flow's normal end state,
because both connections are healthy and `lastSyncedAt` is a calendar day — so the /accounts
card's PRIMARY button (`variant="default"`, rendered first) proposed keeping the 90-day
connection and irreversibly revoking the 730-day one the owner had just fetched
(critic-executed: `RECOMMENDED keep=old drop=new`). **Decision: depth is now rule 3, ahead of
linked-first — the connection whose OLDEST STORED transaction is older is preferred.** Ranked
on stored rows only, never on a promise about what a feed might deliver: a connection with no
rows yet is no evidence of depth and never beats a dated side, so mid-pull (before Plaid's
background historical fetch lands) the tie still falls to the old side — which is exactly the
window the deepen flash's "wait until you can see them" instruction already covers, and that
sentence is retained as the reader's protection in that window. Sync error and staleness still
outrank depth: a broken connection is not kept for its history, because the no-loss guard —
not the ranking — is what protects rows from being dropped. The depth evidence is threaded as
a per-account earliest-txn map into `buildCombineInputs`, which folds it to a per-connection
minimum in the one shared place, so the card and the action cannot compute it two different
ways; the /accounts site derives it from the span groupBy the view already runs (zero new
queries), and the action re-reads it inside its SERIALIZABLE transaction like everything else
its plan derives from. Sabotage-proven in both directions: deleting the rule reddens exactly
the two depth locks; starving the view's map reddens the server lock.

**H.6b(b) — the false refusal.** The no-loss guard fetched both sides' rows filtered
`isSplitParent: false`, so a predecessor the owner had hand-split presented split CHILDREN
(−$60.00/−$40.00) where the successor presents the bank's PARENT (−$100.00), and the multiset
match refused the whole combine with a false diagnosis ("2 charges totalling $100.00 appear on
only one of them … delete the copy you don't want") — a blocked remedy at any bank with one
split row. **Decision: the guard compares rows AS THE BANK DELIVERED THEM** — split parents
and unsplit rows (`OR: [{isSplitParent: true}, {splitParentId: null}]`), never children — on
BOTH sides. Sound because a split is the reader's re-labelling of one bank charge:
`splitTransaction` validates that children share the parent's date and sum exactly to its
amount, so the parent is the row the other feed can be expected to hold a copy of, and
comparing bank shapes is comparing money. What a combine does to the split STRUCTURE remains
a separate, disclosed fact (H.6b(a), the amber caveat on the deepen door — still OPEN). The
guard's strictness is locked in both directions: the split repro now combines, and a split
parent the successor genuinely lacks still refuses, naming the bank's $100.00.

**Scope deliberately untouched:** H.6b(a) (carrying hand-filed categories/notes/splits onto
successor rows) is not built here; the deepen door's caveat continues to disclose it. The
deepen flash's ordinal-naming sentence stays, comment updated from "until H.6c lands" to the
mid-pull window it still covers.

### #425 critic cycle 1 (addendum) — two fresh-context critics, both FAIL (1 P0, 5 P1, 3 P2); every finding executed, all fixed same cycle (2026-08-07)

**The P0 (split-guard critic): the bank-shape premise was unsound against the sync's own
behavior.** "Children share the parent's date" is false after the ordinary pending→posted sync —
both Plaid writers (the preserve branch and the id-churn transplant) move the PARENT to the
posted date and leave the children at the pending date — and with the guard's window then
computed from the bank-shape subset, a drifted split let the combine pass while the boundary's
claim severed the family: every copy of a real $100.00 charge stopped counting behind an
`ok: true` (executed on real Prisma; the mirror shape double-counts instead). **Fix, three
parts:** the guard now fetches ALL rows and computes the window exactly as the boundary does
(`[predFirst, min(cutover, predLast)]` over all stored rows, `txnKeepRule`'s own spans); a split
family the window would SEVER refuses the whole combine first (`splitFamilySevered`, fail
closed, message names the split and the undo remedy); and a dangling child whose parent row no
longer exists counts as itself in the multiset (`splitParentId` has no FK — the critic executed
$60.00 of counted money vanishing). The false-refusal fix survives: a same-date split combines,
on EITHER side (the successor side was previously unlocked — the critic reverted it alone with
33 tests green).

**The depth critic's P1s.** (1) Depth read ANY stored row, so one hand-typed or CSV-imported
backdated row flipped which connection the irreversible combine proposes to keep — onto a
direction the no-loss guard then refuses with advice that was permanently false there ("sync and
try again") or destructive ("delete the copy you don't want"). Depth is now FEED depth
(`providerRef` non-null) at both fetch sites, and the refusal, when every missing charge sits on
the dropped connection and the opposite direction is offered, names the true remedy: combine the
other way round. (2) Mid-pull, the partially-landed new connection has a RECENT stored floor —
not null — so rule 3 itself prefers the old side and the prominent button proposes revoking the
connection still downloading; no surface at the point of the tap said anything about depth. The
card now renders `combineDepthNote` beside each direction (engine carries
`keep/dropEarliestTxnDate`), warning when a choice would drop the deeper side or a side that has
stored nothing yet — jsdom-locked, since the card was the untested hop. (3) The per-connection
fold across multiple accounts was unlocked (min→max inversion stayed green on 90 tests, because
every fixture gave a connection one account) — now locked with a two-account fixture.

**Corrections to #425's own record (depth critic P2s, both executed):** the original entry's
"the action re-reads it inside its SERIALIZABLE transaction like everything else its plan
derives from" OVERCLAIMED — the action's depth data cannot change accept/refuse
(`requestedDirection` matches either offerable direction by id; the ranking only orders the
card's buttons), and an empty map fed to the action passed the full 6,246-test suite. The fetch
is KEPT, with a comment stating exactly what it can and cannot change, so the shared mapper's
inputs stay truthful at both sites. Likewise the first ledger row's "sabotage-proven both
directions" covered the view's map only; the action's is unfalsifiable by construction. And the
flash comment's "the tie falls through to linked-first" named the wrong mechanism — mid-pull,
the depth rule itself decides (null or a recent floor loses to the dated/older side).

**Re-gate:** five executed sabotages on the reworked code — successor-side bank shape, orphan
arm, severed check, fold direction, view-site feed filter — each turning exactly its own lock
RED, each restored. Full verify re-run after the fixes (numbers in STATUS).

## #426 — O.19: the /accounts combine machinery goes behind a tap, and its claim about the money does not (2026-08-07)

**Owner, verbatim, right after closing H.6c: *"Can we get rid of all the combine accounts on
accounts page. Looks like a beta website. Perhaps do[n']t delete that if we ever need to come
back to it. Maybe hide it for now. It's ugly."* Five cards — combine offers and their blocked
reasons, reconciliation candidates, reconciliation ambiguities, the combined-accounts card with
its Undo, and the #192 advisory duplicate warning — rendered as one contiguous run ABOVE the
reader's own accounts. Each is correct alone; stacked, on a corpus with several connections at
one bank, they are a wall.**

**The rule that bounded the hiding.** `deleting-a-surface-deletes-the-claims-it-carried` (K.5)
says putting a surface out of view removes every claim it was the only renderer of, and the
engine that composes those claims stays green while it happens. Two of these five are not
offers: the #192 warning says a balance may be counted TWICE, which is a claim that the net
worth printed directly above it may be overstated; and the combined-accounts card is the only
explanation for an account that is missing from the list because it was folded into another. So
the decision is not "hide five cards" but **hide the machinery, keep the claim**: the collapsed
state still prints one sentence, and that sentence is chosen by money consequence.

`connectionMattersSummary` (pure, `connection-matters-view.ts`) takes the six counts and returns
a constant heading plus one detail clause, leading with the strongest thing true of this reader
— a balance that may be double-counted, else an offered combine, else a candidate, else an
already-combined account, else the two kinds that only explain why nothing was offered — with
everything else collapsed to "· N more". The order is the FAILURE DIRECTION, not the data
model's order (L.30's idiom): the clause a reader most needs when they are NOT going to tap.
Total zero returns null, so a tidy reader gets no line at all, exactly as the five cards each
returned null.

**Collapsed by default, always — no auto-expand.** The task row floated auto-expanding while a
deepen-shaped pair exists (constraint (b): the deepen flow's closing step IS combine). Rejected:
the reader whose screen prompted this would be the one it auto-expanded for, which is the
complaint restated. The deepen path is served instead by copy — every sentence that sends a
reader back to the Combine control now NAMES the section, importing `ACCOUNT_CLEANUP_HEADING`
rather than retyping it. Four such sentences existed ("the Combine option is on this page"), all
written when the card was the first thing on the page; behind a tap that is a scavenger hunt,
the L.14 F-4 defect where a remedy names a control the reader cannot find. One of them lived
inline in the page's JSX, outside every copy lock, and was moved into the copy module
(`duplicateReconsideredFlash`) so the locking test's claim — *every* sentence that sends a
reader back names the section — is true rather than nearly true.

**One filter, not two.** The summary must count exactly what is behind the tap, so the card's
`kind !== 'already-linked'` predicate moved into the shared `visibleBlockedReasons` and the card
now imports it (`a-guard-must-read-what-it-guards`, at UI scale): two copies could let the line
promise a block that is not there. Verified by reading the other four builders that they are
1:1 with their inputs — `duplicateCardView` and `continuedAccountsView` both map without
dropping — so no count can exceed what renders, and the section can never open onto nothing.

**The open state is sticky for the session.** The reliable-mutation recipe on this page confirms
with a FULL reload (#167), and these remedies are deliberately two-step (#192: disconnect the
bank, THEN delete the copy it leaves). A section that shut on every reload would make the reader
re-find it mid-remedy — the O.16 complaint, which this repo already has a lesson about. So the
open flag rides sessionStorage the way the flash beside it does; best-effort, degrading to
closed rather than crashing when storage throws.

**No guard moved.** Nothing about visibility reaches an action: `suppressCombineProposals` and
every server-side validation are byte-identical, and the cards remain mounted in the DOM (hidden,
never unmounted), so armed two-step confirm state survives a collapse.

**CRITIC CYCLE 1 (two fresh-context critics, both FAIL — 1 P0 + 4 P1 + 4 P2, every finding
executed, all fixed same cycle).** They converged independently on the dead `role="alert"`, and
the P0 is the one this slice existed to prevent.

**P0-1 — the money claim went to the WEAKER evidence.** `transactions.ts:1352` filters out of
`duplicates` every pair that has a combine offer, a candidate or a reconciliation, so the
advisory set is the RESIDUE — the pairs with no proven remedy — while two live connections
pulling one account is the case the app is certain about (`combineEvidence`: the balance "counts
twice everywhere this app adds your accounts up"). The first cut gave "N balances may be counted
twice" to the residue and a purely procedural "N duplicate connections can be combined" to the
certain one. Critic executed it on this slice's own fixture: net worth **$2,000.00 for $1,000.00
of real money**, and the word "twice" nowhere on the page — the exact claim-loss the slice's
governing lesson is about, shipped by the slice written to avoid it. Worse, the slice's own e2e
asserted `toContainText('can be combined')`, so the test RATIFIED the weakened claim. Fixed by
ordering on certainty (offers lead) and giving every kind that describes a double count the
consequence, not the remedy; the e2e now asserts the sentence with "twice" in it.

**P1-1 — the top clause printed a PAIR count as a BALANCE count.** `detectDuplicateAccounts` is
an all-pairs loop with no transitive collapse (`duplicates.ts:268`), so three copies of one
account emit three pairs: the line read "3 balances may be counted twice" directly above a card
headed "One account may be counted twice". The summary now counts DISTINCT ROWS and says
"entries", which cannot overstate for any N.

**P1-3 — "an account is missing from your list" survived only when it happened to be loudest.**
The predecessor row is removed from the groups, so the combined card is its only explanation, and
`combined` sat 4th of 6 where anything louder collapsed it into "· N more" (three reachable mixes
executed). It is exclusive with whatever leads, so per the lesson's own rule 2 it now gets its own
clause rather than a place in the queue.

**P1-4 — the rule was applied to 4 sentences and skipped on 11**, including one an EMAIL reader
sees, who cannot be sent hunting around a page. `src/lib` may not import from `src/components`,
so the heading moved to `src/lib/engine/account/account-cleanup.ts` and is re-exported; the
disclosures in `card-duplicate-view.ts` (/cards, /calendar, dashboard, digest + reminder emails)
and `row-labels.ts` now name the section. Deliberately NOT changed: "Open Accounts and tap Sync
on that bank" — Sync is not in this section, and naming it there would be the same defect
inverted.

**P2 — the dead `role="alert"`.** The #192 card is now born inside a collapsed `<details>`, so it
mounts already hidden; a live region whose content was never visible does not announce, and
expanding does not reliably re-announce it. The role is removed rather than left as a promise the
platform will not keep — the claim it made on load is now in the summary line, which is visible
and in document order.

**Sabotage:** restoring the procedural offers clause turns FOUR locks red at once; reverted and
re-gated. **Left open, recorded not fixed:** the section paints closed on first render after every
mutation reload (`useState(false)` + post-hydration read), so there is a brief layout shift; a
session cookie read server-side would remove it and also close a theoretical pre-hydration toggle
race. Both are P2 and neither can print a wrong figure.
## #427 — H.6b(a): the combine carries the reader's hand-filed work onto the successor's copies, never onto a row nothing reads (2026-08-07)

**Closes TASKS H.6b(a)** — the last OPEN item of H.6's critic's three findings, and the
highest-ranked OPEN P1 in STATUS. When the successor connection reaches further back — the
defining property of a successful deepen — the boundary keeps the old side's first day and
disowns everything after it, so the reader's filing on those rows (categoryId with its
Correction, note, taxClass, excludeFromTotals, split families) stopped counting in favour of
the new connection's untouched copies. `combineDuplicateConnectionsFor` carried only
`AutopayConfig` + `displayName`. The fix is a pure planner, `planReaderFieldCarry`
(`src/server/combine-connections.ts`), unit-tested first (`tests/unit/combine-carry-planner.test.ts`,
29 tests) and then threaded into the combine's apply loop; the deepen door's caveat now
promises the carry, not everything.

**Matching (C.6's lesson, applied deliberately):** a reader-owned field moves only onto a
successor row with the EXACT same date and amount, and only when exactly one disowned row and
exactly one successor row hold the key — a loose pair rule once credited 11 refunds as
payments, and the multiplicity gate now runs on BOTH sides (two identical old pieces must not
both write the same survivor). Drifted copies and ambiguous duplicates stop being applied,
which is what the caveat says. Every data condition skips its row or family, never throws — a
carry can never refuse a combine.

**Never-clobber doctrine:** the survivor's own reader values always win. Corrections MOVE
(`updateMany transactionId`), never copy. A settled verdict (`hasCorrection && !needsReview`)
carries only where no reader value claims the row: blocked by the survivor's own correction,
its review pin, a split-child shape (the pieces are the reader's own allocation — P1-1's child
rule, extended to sources by F4), a stale pred family (destroyed decisions re-decide, per the
transplant's dissolve precedent — forced into DURABLE review), and — the cycle-4 Finding — a
survivor that is itself a split CONTAINER, from any source. The engine's own guesses
(confidenceBps, engine-filed categories without a Correction) never travel: no Correction = no
reader decision.

**Finding A (critic cycle 4, the hard cap):** the planner's per-row write targeted the
survivor's container — a row NO surface reads (the register lists only children, the tax
report leaves containers out entirely via TAX_BLOCKED_SPLIT_PARENT, the reimbursement line
skips them). A verdict + Correction landing there would feed the learner evidence
contradicting the reader's own pieces; the pred row's LIVE flats (exclusion, claim,
tag, note) would stop applying — an excluded charge reinstated into every total, a
money-owed claim vanished, a tag gone from the export. Fix, per the critic's own prescription:
containers never receive a verdict, a correction move, or flats; the flats route onto the
container's CHILDREN as a survivor-first gap-fill (each piece's own value wins), the same
inheritance the NEW-1 finding already applied to the survivor's own flags in branch A.
F2's "the container's own note travels" now lands on the pieces, where it is read.

**Four critic cycles — the hard cap, used to the last.** Cycles 1–3: P1-1 (refiled old piece
never replaces a survivor piece's own category), NEW-1 (survivor's own flats follow the money
onto re-created pieces — inherited, because `outstandingReimbursements` reads children so O.15
P1-2's refusal rationale is defused), NEW-2 (caveat copy promised more than the carry does —
reworded to promise the carry, not everything), F1 (an un-filed parent — splitting never mints
a Correction — no longer gates its pieces' flats), F2 (pred-side multiplicity), F3 (a stale
family never pins an intact dangling-child allocation into durable review). Cycle 4 (the cap):
Finding A above. No fifth fresh-context critic ran — per the cap clause in
docs/CRITIC_RUBRIC.md, the fix followed the critic's OWN prescription and was locked with the
critic's demanded A1 test (plus the updated F2/F4/P1-1 expectations); the ledger and this
decision record the cap honestly, as O.19/H.6c/H.7 did.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,303 unit + 1 skipped / 381
passed files (382)** / build clean; deepen-history e2e **2/2** (re-run after the caveat's
P2 rider). No schema change — `git diff --stat -- prisma/` empty. Full CI gate read at the
close; conclusion recorded in STATUS.

**Left open, recorded not fixed (P3):** (1) a succ-side DISOWNED row (in the deepen shape,
the pred's own claim day) still loses its filing — there is no reverse carry onto the pred
side, and the boundary is the existing R1 rule, not this slice's to change; (2) the carry's
null-check cannot distinguish a reader's deliberate blank (clearing a tag) from an untouched
copy, so a deliberate blank on the survivor still wins over the pred's value — same direction,
never a clobber; (3) sequential combines are order-dependent (a second combine sees the first
one's carried state); (4) after a branch-A carry, `findOffsettingInflow` cannot match a
whole-charge refund to the re-created pieces — display-time only, sums unaffected. H.6c's
STILL OPEN item (2) (excludeFromTotals/isTransfer parity between copies is unmeasured) stands.

## #428 — H.7b: the wrongly-written transfer flags get an owner-triggered, undoable repair; clearing a flag is a disclosed act, never a sweep's (2026-08-08)

**Decision.** The 53-row / $29,848.84 class H.7 recorded (STATUS §STILL OPEN after H.7,
residual 1 — settled rows the pre-H.7 coincidence rule flagged, which the shipped rule
declines, still withheld from every total) is repaired by an explicit owner action on
/settings, not by any sync path. `planTransferFlagRepair` (pure, beside the sweep's own
engine) replays the SHIPPED `planTransferUpdates` from scratch over the sweep's own read
(`loadTransferSweepRows`, extracted unchanged) — one rule, so a cleared row cannot bounce
back on the next sweep unless genuinely new evidence arrives, and the h7-shipped-plan.mts
probe's method is now the tested engine rather than a script. Scope: flagged + settled
substantive verdict (`hasCompetingVerdict`, the overturn gate's own predicate) + un-pinned +
POSTED + USD-counted + not reader-excluded. The clear writes `isTransfer: false` and NOTHING
else — the category is the settled verdict the flag was wrongly withholding. Preview states
the change first (rows, dollars by direction, the income count); the apply re-asserts its
whole premise per row and records a `TransferFlagRepairRun` (additive table: the only record
that can distinguish a repaired row from a never-flagged one); undo is atomic, newest-run-only,
and skips any row the reader re-decided (their value wins — the H.6b(a) doctrine). This is
deliberately the app's ONLY `isTransfer: false` write path (residual 4's gap), scoped to
declined flags, never a general un-flagger. Demo fenced both sides.

**Critic cycle 1 — two fresh-context critics in isolated worktrees, both FAIL: 6 P1
(3 money + 3 copy/wiring), 5 P2, 9 P3; every finding executed, all but one fixed same
cycle.** The money critic's sharpest: (P1-1) a GENUINE cash advance — the one class
CAN_SEND_ACCOUNT_TYPES cannot see — would be actively un-flagged and, because repair and
sweep share one rule, the sweep can never re-fix it; H.7's residual 2 recorded a REFUSAL,
this converts it to an act. Smallest fix applied per the critic: the preview names the class
and the remedy before the button ("leave it marked and file it as Transfer instead"); the
fuller fix (per-row selection) is recorded OPEN in STATUS, and zero such rows exist on the
live corpus (h7-sender-types.mts). (P1-2) undo was not atomic — a mid-loop failure stranded
a half-restored state behind a refused retry; claim+restores now one transaction, locked by
a corrupt-payload rollback test. (P1-3) the apply premise — the slice's central safety
claim — was deletable with the suite green; now locked by a stale-read interleave test, and
the sabotage was re-executed RED. The copy critic's: the money claim was false for rows
non-USD/excludeFromTotals gates still withhold (now out of scope, dollars never claimed,
class named in the disclosure); "Nothing needs repair" was false whenever declined
out-of-scope marks existed (three zeros now three sentences); the confirmation could be
dated TOMORROW (UTC label at a US evening — no rendered line makes a day claim now). Also
fixed: partition drift (a pinned-but-endorsed flag vanished from every count), pluralization
in the disclosure tail (the test had locked the broken string), "1 of it is categorised as
income", a silent all-skipped apply (now an inline outcome, no reload into silence),
partial-apply narrowing (skippedCount stored and disclosed), undo's misleading cross-user
message, and card-local strings moved under test (jsdom render spec). Recorded, not fixed:
`inflowCents/outflowCents Int` shares the repo-wide int4 ceiling convention.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,345 unit + 1 skipped /
385 passed files (386)** / build clean; e2e **4/4** (`transfer-flag-repair.spec.ts` full
apply→undo round trip through the rendered page + DB, and all three `settings-dials`
specs); three sabotages executed RED and restored with a residue check (86/86 across the
repair + adjacent H.7 suites). Schema: additive `TransferFlagRepairRun` only — no existing
column or row changes; deploy runs `prisma db push` (CLAUDE.md rule 5 checked).

## #429 — H.1(b): every bank connection states its own history depth, through the app's own ownership rule (2026-08-08)

**Closes TASKS H.1(b)** — the last open piece of H.1. (a) was measured on 2026-08-05 and
(c) was recorded inside #421, which already puts Plaid's 730-day ceiling in this file with
`plaid.ts:189` beside it; nothing was left to re-litigate there.

**The premise, re-measured before building rather than quoted.** Re-ran the probe this row's
own design questions were written for (`scripts/audit-probes/h1-connection-depth.mts`,
read-only, committed) against live Neon. It has moved materially since 2026-08-06: the corpus
is now **58 accounts / 4,493 rows / 3,278 owned / 27 active links**, and the register's global
floor is **2024-08-11** (was 2026-03-25) — a Chase Plaid item holding **1,395 rows** back to
August 2024, `backfill=2026-08-07`. The deepen route worked; two years of history is live.

**Which is exactly why a global line is no longer the right answer.** /transactions prints one
"History available from <date>", and that date is set by whichever single account reaches
furthest. So it now reads as a claim about ALL history while twelve of the owner's thirteen
connections start in **July 2026**. The per-connection line is the honest version of the same
fact, and it is what H.1(b) asked for.

**The decision that carries the risk: depth is read through `getReconciliationTxnKeep`, never
off a `groupBy _min`.** The R1 keep rule is WINDOWED — an account loses exactly the rows inside
each transitive upstream predecessor's claim, a PREFIX of its history — so a raw minimum is
frequently a row no register shows. Measured, not feared: **seven** connections carry a
raw-vs-owned delta of **84–91 days**. Printing the raw floor would have put a /accounts date
three months adrift of the register on the same screenload — the H.8 defect one surface on, in
a slice whose entire purpose is telling the owner the truth about depth.

**Three states, because two would have to lie.** The probe's Q3 hit is live: an American
Express item **holds 7 rows and owns 0** (all inside its predecessor's claim). A date there is
a fabrication; "no transactions yet" is false in the other direction. So `counted-elsewhere` is
its own state, rendered as a sentence that says where the rows went. The third state,
`no-rows`, is the genuinely empty connection — Vanguard, Truist, U.S. Bank and one Schwab item
hold no transactions at all.

**Deliberately NOT done.** No remedy tail after the date ("re-link for more") — K.2b's critic
executed that exact false-tail defect one surface over: the true remedy differs per connection
(a fresh Link caps at 730 days; a superseded predecessor has no remedy at all), so a generic
one would be wrong more often than right. No new date format either: the line uses
`formatISODate(_, 'long')`, the same helper and the same shape as the register's own history
line, weekday included — two lines making the same kind of claim must not print dates
differently. No SimpleFIN depth line: the owner's `SimpleFinConnection` row does not exist
(#421), so there is no connection card to hang one on, and K.2b already names that state.

**Ordering assumption removed before it could ship.** The first cut took "the first row of an
`orderBy`-ed `distinct` read" as each account's earliest owned date. Dev/test is SQLite and
production is PostgreSQL (#35), and how a provider orders rows underneath a `distinct` is not
a guarantee a rendered date should rest on. Replaced with an explicit MIN over the kept dates —
one line, true on both engines, no cross-provider assumption left in the path.

**CRITIC CYCLE 1 — two fresh-context critics, BOTH FAIL: 6 P1 + 5 P2 + 5 P3, every finding
executed, all six P1s fixed and locked this cycle.** The mechanism changed twice and the copy
changed entirely.

**The P1 that broke the slice's own headline claim (data-integrity critic F-1).** "The rendered
date can never contradict the register" was FALSE as built. `registerRowWhere` lists only
SPENDING_ACCOUNT_TYPES, USD-or-null, non-split-parent rows — so a MORTGAGE's, LOAN's,
INVESTMENT's and a withheld non-USD account's transactions are real rows /transactions will
never show, and the depth read all of them. Executed against the real loader AND the real
register: a connection rendered *"History goes back to Mon, May 18, 2026"* while /transactions
returned zero rows and did not even offer that account in its filter dropdown. Live: a mortgage
account already holds three rows, and the Truist connection's ONLY account is a mortgage — one
sync from printing a date the register denies. **The basis is now the register's own predicate,
shared and not restated.**

**The P1 that made the slice actively unhelpful (copy critic F1).** On the live corpus, ALL FOUR
connections rendering "No transactions yet." were 100% never-transactional accounts — U.S. Bank
×2 LOAN, Vanguard ×4 INVESTMENT, Schwab ×2 IRA, Truist ×1 MORTGAGE, 9 of 9 accounts — every one
of them synced cleanly that same morning. There is no `/investments/transactions` ingest
anywhere in this app, and both providers say so in their own words. So a slice built to answer
"why haven't we populated 2023–2026 yet" was answering "keep waiting" for something that is
never coming, on 31% of the owner's connections. **"Yet" is a promise, and it now appears only
where something can actually arrive.**

**Five states, because each smaller set forces one of them to lie.** `reaches`,
`counted-elsewhere`, `balances-only` (never-transactional types), `not-counted` (currency
withheld — it must not be called empty when the card NAMES the account one line above), and a
`no-rows` that finally means what it says. **Live re-measure with the shipped rule**
(`h1b-depth-states.mts`, read-only): 9 reaches / 4 balances-only / 1 counted-elsewhere, and
**zero** false "No transactions yet."

**The sentence that took both critics to get right.** "…its transactions are counted on the
account it was combined with" was wrong three ways: R1 is a calendar-WINDOW rule, so a dropped
row need not have a counterpart and the data-integrity critic executed the case where the
register showed it on NEITHER account (claiming it is "counted" there is simply false); the
copy critic executed three shapes with two or more claimants (a mid-chain account whose rows go
in opposite directions, two sibling predecessors, a multi-account connection) where a singular
referent is wrong; and "combined" is a word the VISIBLE page never defines, because O.19 put
the disclosure that teaches it inside a collapsed `<details>`. Now: *"No history of its own —
every date it covers belongs to another account. See "Account cleanup" on this page."*

**Also fixed:** the copy moved to a pure module (`connection-depth-copy.ts`) because importing
the component under vitest fails on `next/server`, so while the sentences lived in the `.tsx`
the entire ~6,000-test unit gate was blind to a wrong one and only `VERIFY_E2E=1` could catch it
— nine copy locks now run in the plain gate; `getReconciliationTxnKeep` replaced by the pure
closure over rows already in hand (−3 duplicate queries, and it removes a real double-read of
the links where a confirm/undo between the two reads desynced the closure from the account set
it bounds — proven identical across 22 probes); and SimpleFIN gained the same line, since it is
43% of the owner's accounts and reaches DEEPER (2026-03-25) than seven of the eight Plaid
connections that print a date — /accounts was answering for the shallow half and going silent
for the deep one.

**Accepted, not fixed:** the depth line is the third identically-styled muted line on each card
(+11% card height at 380px, no overflow) — prominence is a P2 the critic itself marked optional,
and recorded in STATUS rather than churned.

**Cost.** One register-basis aggregate, plus — only for accounts that appear in a link — one
row-level read. `distinct` is NOT a database bound here: Prisma dedupes client-side and emits no
DISTINCT on either datasource (the critic captured the SQL on SQLite and on Neon), so that read
is row-sized and grows with history depth; it is skipped entirely for any user who has never
combined two accounts. Net against the first cut: three queries fewer.

## #430 — H.2: the CSV backfill dedupe is a multiset difference, its check-then-act is serializable, and file-internal repeats are surfaced, never silent (2026-08-08)

Closes TASKS H.2 (last open wave-H task). Design decisions, in the order a hostile critic forced them:

**The dedupe key is (date, signed amount) on the same account, as a MULTISET difference** — for
each key the file offers M rows and the account holds N, create max(0, M − N) in file order.
Descriptor is excluded BY DESIGN: bank-export text ("GOOSE POND BAR GRILLE") never equals the
provider's rawDescriptor ("SQ *GOOSE POND"), so requiring it would double-import the whole
provider-overlap window (H.6's prescription). The multiset shape is exactly right for the two
shipping cases — re-import (M == N → all dropped) and provider overlap (the provider's copy is
inside N) — and never drops a key the account does not hold. Split parents sit in the match set
(a whole-charge row whose charge is already represented as pieces is dropped), and the R1 keep is
applied to the MATCH SET, so a reconciliation-disowned row never suppresses a visible re-add
(H.8: a writer sees what its readers see).

**Two reads by design — the check-then-act is atomic, the egress is not.** A planning snapshot
(span fetch, index-backed) decides which rows pay for prepare + LLM assist, so a re-import never
calls the LLM. The authoritative re-plan runs inside `serializableTx` (the app's P2034-retried
wrapper, db.ts) right before `createMany`; the tx fn is DB-only, prepare/assist ran outside, and
the predictions log happens after commit. A concurrent double-import (double-click, two tabs)
that Postgres READ COMMITTED would let mint duplicate rows now surfaces as a serialization
conflict and retries against fresh state. The store only ever grows, so the in-tx re-plan can
only SUBTRACT from the planning plan — no import is ever missed, and the reused engine function
keeps the multiset contract under the existing test suite.

**File-internal repeats are surfaced, never silent (critic P1-1).** `planCsvDedupe` counts kept
rows whose key occurs ≥2 times in the FILE itself and returns them as `repeatedRows`; the form
shows an amber warning ("the file contains N identical rows — this usually means two overlapping
exports were pasted together"), the audit meta carries the count, and the page copy no longer
claims "always safe". Warn, never block: two genuine same-day same-amount charges are
legitimate, and the key cannot tell them apart — the count is the honest hint. The multiset
semantics are untouched; the classic shape (two overlapping exports pasted together) was
previously a silent double-import corrupting every total.

**The import picker is the register's own basis (critic P2-2).** Only `SPENDING_ACCOUNT_TYPES`
(CHECKING/SAVINGS/CREDIT) accounts are offered — an imported row is a POSTED register row, so an
investment/loan target would hide the imported history from every register surface. Same
constant the register, `/api/export` and the engines use.

**Accepted, tracked:** (P2-1) nothing dedupes a provider sync against rows the user IMPORTED —
the mirror of the overlap dedupe; a real fix must make the sync ingest's uniqueness check
provider-agnostic, bigger than this slice. (P2-6) the depth-floor query fetches all account
rows to find the minimum; correct at household scale, could be `orderBy take: 1` later. Both
recorded in STATUS.

## #431 — C.23 guided half: the Fixed-costs setup section PROPOSES series the reader confirms into bills or reserves, and one figure names the holding account (designed 2026-08-08, SHIPPED — see the DONE addendum at the end)

**What remained in C.23 after #412 shipped the reserve MODEL.** The settings section
that IS the app's Fixed basis — not a second one — where the reader confirms and
edits the detected recurring lines instead of typing a list, adds the reserves no
transaction implies, and sees ONE "move this much to reserves this month" figure
with a reader-named holding account.

**The proposal source is the same array the union counted — one authority, not a
second detection.** `countedExpenseSeriesForPlan` (`spending-plan.ts:544-631`)
already produces exactly the `PlanScheduledItem[]` (negative amounts, resolved
categoryId, loanPayment mark, canonical) that `recurringOutsideFixedCategoryRows`
consumes. The setup planner runs THE SAME union builder over that array and marks
each series by its row key: `inBasis` (a union row exists) or `refusedReason`
(`discretionary` | `covered` | `settlement` — the union's own three skips).
"Proposed" and "counted" cannot disagree by construction, and `getSpendingPlan`
gains one additive return field — `fixedSetup: FixedSetupProposal` (the
`proposeFixedSetup` planner's output, computed with the loader's own arrays and
sets: the same `scheduledFixed`, the same `categoryIsFixed` closure, the same
rollup/budget/reserve inputs) — so the settings card reads the loader, never a
re-derived copy.

**The convert lever is reserve + NOT_BILL, and the money is conserved by
construction, not by luck.** "Turn this into a monthly reserve" writes two things:
a reserve row (true cost = the series' typical per-cadence amount, cadence = the
series' cadence — the app divides, exactly the owner's ÷12) and a
`RecurringOverride NOT_BILL`, which `detectRecurring` honors with `continue`
(`detect.ts:399-403`: "Not a bill wins over everything, including evidence…
every consumer of this function loses the series at once"). The union therefore
loses the series' monthly rate while the reserve enters it at the SAME
`monthlyRateCents` figure — the Fixed total does not move a cent. That is the
owner's yearly-dues case: the app detected it as a bill (smoothed), the reader
wants it as set-aside money; the kind flips, the money stands. Reversible both
ways (deleteReserve; the /recurring override undo restores detection).

**What the lever is NOT offered on.** A MONTHLY series is a bill — converting it
is a rename with no new meaning, so `convertibleToReserve` requires
QUARTERLY/SEMIANNUAL/ANNUAL. Settlement-category series (`PLAN_FIXED_NEVER` —
credit-card-payment/cash/investment, the owner's 2026-08-01 rule) are never
proposed at all: a settlement series converted to a reserve would ADD money to
Fixed for a flow the owner ruled out of Fixed in words. Covered series
(money already in the rollup) render no proposal row — the money is in the
figure, proposing it again is noise.

**The holding account is a User column and a NAME, never a transfer.**
`User.reserveHoldingAccountId String?` mirrors `paymentAccountId` (schema:30) —
the same additive-nullable shape, the same `PAYMENT_ACCOUNT_TYPES` eligibility
(CHECKING/SAVINGS, not superseded), the same demo fence. The "move this much to
reserves this month" figure is `reserveMonthlyCents` — the SAME reduce the plan
already runs (`plan.ts:933`) — and the account names where the money sits. The
app never moves money for the reader (no transfer writes; the CSV/register flows
are the money movers); the account is the reader's own statement of where the
set-aside lives. A reserve whose monthly share rounds to zero is refused exactly
as #412 refuses it.

**The double-count hazard needs no new closure.** The convert lever creates the
reserve through the same write #412 shipped (`monthlyContributionCents: null` +
the loader's `kind !== 'reserve'` filter), so a converted reserve is inside the
`plannedSavingsCents` max only by the same impossible route the H.4 locks already
deny. The H.4 identity (income − fixed − savings = leftToSpend, to the cent) is
re-run across the convert.

**Schema: one additive nullable User column.** `prisma db push` will run against
the live Neon database on deploy (per the push rule); additive-nullable is safe —
existing rows are NULL, the demo is untouched, and golden figures cannot move.

**CRITIC ROUND 1 (fresh-context Opus, 2026-08-08): FAIL — 2 P1 + 1 P2 + 3 P3,
both P1s executed against the real engine/DB, all fixed and locked. The major
guarantees survived: conservation holds on every basis (probe-verified on the
last-resort one too), one-authority is real, the lever's scoping held, the H.4
identity held across the convert, the holding account is write-free.**

- **P1-1 — the pair-integrity guard covered only half the undo.** The convert's
  demotion (`NOT_BILL`) could be silently overwritten by `setRecurringOverride`
  with `decision: 'BILL'` — reachable from the transaction-detail declaration
  the moment the next charge posts — while the linked reserve still counted the
  money: the same payee twice in Fixed, with `ok: true`. Executed repro showed
  `fixedExpensesCents` up by exactly the reserve's rate. Fixed by mirroring the
  clear-side refusal (`hasLinkedReserve`, one shared helper for both halves —
  `recurring-overrides.ts`): a BILL re-declaration on a converted payee is
  refused with the same named remedy, and the lock asserts the refusal AND
  that the NOT_BILL still stands.
- **P1-2 — the proposal's inBasis oracle disagreed with the plan on the
  last-resort basis.** `detected-series` counts every non-settlement series,
  discretionary class included (`plan.ts:901-918`), while the proposal's verdict
  used the union, which skips taxonomy-discretionary series — so a series the
  plan counted rendered "not in your fixed costs" with a convert lever whose
  advertised +rate delta was zero (money conserved, disclosure false, on the
  same card that listed the payee as counted). Fixed structurally: the proposal
  takes the plan's own `fixedBasis` and switches its oracle to
  `recurringPlanExpenseRows` — the very function the plan summed — on the
  `detected-series` basis; the union stays the oracle for the bases that add it
  and for `user-set`. Locked both directions (basis switch + union control).
- **P2-1 — `deleteGoal` had no kind filter.** A reserve id handed to it (no UI
  reaches that today — the goals page excludes reserves) would delete the row
  and orphan the NOT_BILL: the bill leaves every figure. Now refused with the
  `OR: [{kind: null}, {kind: {not: RESERVE_KIND}}]` form — the #412 P0 lesson
  (`kind <> 'reserve'` is NULL for a NULL kind) — and the lock asserts the pair
  stays intact.
- **P3s recorded, not fixed:** (a) the convert prefill is re-derived from a
  FRESH plan at click time, so a series whose typical changed between render
  and click is written at the new figure — conservation still holds (both sides
  from the same fresh plan); (b) /settings now loads the full plan per render
  with no failure boundary; (c) a superseded holding account keeps printing its
  label (the picker can no longer save it). All three are graceful directions,
  none moves a figure wrongly.

**DONE 2026-08-08 (shipped, verify green, critic-cycled).** Gate evidence in
STATUS.md + TASKS.md C.23 row; the two P1s and the P2 have locking tests
(`fixed-setup-proposals.test.ts` P1-2 block; `reserve-convert-server.test.ts`
P1-1/P2-1). Schema on deploy: additive nullable `User.reserveHoldingAccountId`
and `Goal.merchantCanonical` (the convert pair link — `prisma db push` on push,
existing rows NULL). Live proof: `scripts/c23-live-deploy-check.mjs` against
production.

## #432 — C.14: the goals card names its third FI state instead of printing "~null months", and a goal pledge beyond the reader's savings is charged in FULL against their FI date (2026-08-08)

**The two defects, both from CALC_AUDIT_2026-08-02 (#21, #22), both executed by
the audit against the real engine.**

**#22 — the literal "null".** `goalFIImpact.fiDelayMonths` has THREE states: 0
(no measurable effect), a positive delay, and **null** — the FI date, with or
without the goal, sits past the engine's 1200-month cap. The card branched on
`=== 0` only, so the null state fell into the template and printed the literal
string *"Moves your FI date back ~null months"*. The worked example mirrored it
with `?? 0` — a fabricated "~0 months". Both are now the same three-state
clause, and the refusal reuses the coach's established beyond-horizon language
(`COACH_COPY.goalFiBeyondHorizon`, copy-locked in the coach-copy sweep): the
goal's timeline is still stated ("Funded in ~N months") while its FI effect
gets no number.

**#21 — the floored pledge.** The FI simulation reduced savings during goal
funding by `floorAtZero(savings − contribution)` — a pledge larger than the
reader's surplus was silently forgiven for the over-portion, and the delay
reported a fraction of its real cost. Executed in the audit: **7 months
displayed against 29 actual** (re-executed here with integer cents and locked:
savings $1,000/mo, pledge $4,100/mo, goal $28,700 → monthsToGoal 7, delay 29,
0% return, hand-verified month by month). The fix is one line: the FULL pledge
comes out of savings while funding — negative allowed — and the simulation
carries the honest negative and recovers it. A goal the reader committed to
cannot cost the app's figures less than it costs them. `monthsToGoal` is
unchanged (the goal fund fills at the pledge); the delay is what changed, and
the locked case in `critic5-fi-goals.test.ts` moved 24 → 36 with the hand-work
in its comment (funding 24 months at −$500/mo → −$12,000, then 132 months to
recover → delay 36).

**Scope of the change:** `src/lib/engine/goals.ts` (the floor removed),
`src/app/(app)/goals/page.tsx` (both clauses), `coach-copy.ts` (one new
string). The C ≤ S path is byte-identical to before (floorAtZero is the
identity for non-negative inputs) — every existing lock on the sane case
passed unchanged; only the C > S lock moved, with its hand-work restated.
No schema change. No demo data change (the demo's goals are within the
surplus). Verify gate and CI conclusion recorded in STATUS.md.

## #433 — C.15: the return affordance one hop deeper — a transaction or a named page as the destination (2026-08-08)

**The audit finding (CALC_AUDIT_2026-08-02 F1/F2/F3, owner: "user experience
also seems quite clunky").** O.16 built the return affordance ("Back to Needs a
category") on the register filter, and nothing else was expressible: a figure
drilled on /triage, /dashboard, /budgets, /reports or /trends opened a
transaction detail whose way back said "Activity" — the reader's place was
structurally inexpressible (F1: a detail destination could not be expressed at
all; F2: the split-parent link on a split child's page was bare; F3: all four
entry points handed the detail page no context).

**The decision: extend the O.16 construction verbatim, one hop deeper.** The
same shape that made `?back=` safe — *the path is a LITERAL, only the query
comes from the caller* — now admits two more literal-path families:

- **A transaction destination.** `decodeTransactionReturn` is rooted at the
  `/transactions/<id>` literal; the caller's ONLY input is the id, admitted
  only through `TRANSACTION_ID_PATTERN` (`^[a-z0-9][a-z0-9-]{0,63}$`). The
  pattern is deliberately NOT pinned to Prisma's `cuid()` — the demo seed
  mints readable `txn-00001` ids and BOTH shapes sit in the same database
  (verified against `dev.db`: a real row is `cmqvrv3hd0025j0cu9gvo2zor`, a
  demo row `txn-00001`); a pattern that rejected one would silently dead-link
  the other. What the pattern guarantees instead is path-escape-freedom: no
  `/`, `?`, `#`, `.`, `\`, `%`, no uppercase. The open-redirect class is
  closed by construction, one hop deeper: `?back=https://evil.example`,
  `?back=../../settings`, `?back=javascript:…` all fail the charset.
- **A named page.** `PAGE_RETURNS` is a closed table (triage, dashboard,
  budgets, reports, trends → literal path + honest label); `decodeNamedPageReturn`
  admits ONLY a table token, with the page's own query appended to the literal.
  `_activity` is deliberately NOT a row — it is the register's sentinel, so
  the two vocabularies stay disjoint.
- **The three encodings are mutually disjoint by construction** (register
  queries carry `=` pairs / the sentinel starts with `_`; named tokens start
  with `_`; transaction ids admit only `[a-z0-9-]`), so decode order can never
  launder a caller-supplied path.

**F2 — the split-parent link carries the CHILD's place, not the child's id.**
The alternative (forwarding the parent's id) loses the register view at the
second hop: P→C would return to "the transaction" even though the reader came
from "Needs a category". The parent now receives this page's own forwardable
context, so the undo screen offers the same way back this one did. The bare-id
decoder still ships as F1's "structurally expressible" requirement, locked by
unit tests, with no writer in this slice.

**`forwardableBack` is the O.16 waypoint discipline, made a predicate.** A
second-hop link may carry the reader's place ONLY when the value decodes to
one of this module's destinations; everything else — including the hostile
set — collapses to the Activity sentinel. This REPLACES the returnTo.href
round-trip at the detail page: a register encoding survives decode → href →
query, but a named-page token and a transaction id are consumed into the
href's PATH and cannot be recovered from it, so the raw `?back=` has to be the
source, gated here. `withForwardedReturn` is the sibling encoder (verbatim
attach, fragment-safe, byte-identical to `withRegisterReturn` for the register
encodings they share).

**One mechanical lesson, recorded:** `{/* */}` brace comments between JSX
attributes are invalid TypeScript (TS1005) — the braces make the comment look
like a child; bare `/* */` or `//` parse there. Four such comments were
written, rejected by tsc with a bisected minimal repro, and rewritten bare.
No schema change, no demo data change. Verify gate and CI conclusion recorded
in STATUS.md.

## #434 — C.16: Fixed/Discretionary moves into the action menu — the register dial is gone, and a row can say whether its class is ours or the reader's (2026-08-08)

**The audit finding (CALC_AUDIT_2026-08-02 F4–F8), lead with the owner's own
words: "the always-on dial on every register row is a clunk."** Every row of
the register carried its own live Fixed/Discretionary `<select>` — eleven
times more controls than write opportunities. F4 named that clunk; F5
demanded a confirm step before the write; F6 named a tooltip that blamed
three causes for a predicate with seven; F7 found a split container with a
LIVE class control an inch below copy saying the row is in no total; F8 asked
whether the register can say if a class is our guess or the reader's own
setting, when /budgets already renders exactly that.

**The decision: the class becomes a BADGE everywhere, and the write becomes
a VERB in the one action menu.** The engine's availability list (the same
`txnActionAvailability` every surface renders) grows an eleventh verb —
"Change spending class…", carrying no state in its label (the `markRecurring`
precedent — the picker the verb opens shows what is in force). The old
`SpendClassSelect` is deleted; `SpendClassBadge` is now the ONLY rendering of
the class, on the register row and the detail's For-your-Plan block alike,
keeping the shared testid/data attributes so a surface can assert the class
without caring which control rendered it.

**The confirm step lives INSIDE the menu** (the pick replaces the list — one
menu renders at a time, so the step state is a content-only component's local
state and can never multiply per-row hooks). Tapping the verb opens the same
two choices the dial offered, `menuitemradio` buttons with `aria-checked` on
the current class; a payee with more than one row adds the same scope
question the dial asked — "Make X for: Just this one / All N \<payee\>". The
no-op rule is the dial's own, kept: picking the class already in force closes
the flow instead of writing the same value back. The write itself stays on
each surface's existing discipline (register: deadline + reload preserving
scroll; detail: `runFlag` + `afterWriteHref` so the page keeps its place).

**F5 is satisfied in spirit, not by decree.** TASKS.md's grok note allowed the
slice to skip a MANDATORY confirm step; the scope ask stays conditional on a
bulk write (the `#397`/`#398` behavior — a single-row flip was the owner's own
flow, and the old dial's single-row path never asked either). The menu adds
the two deliberate gestures the dial lacked — open the verb, pick the class —
which is the confirm-step's actual job: nobody changes a class by brushing
past a row.

**F6 was already closed** by `#397`/`#398` (the 10-cause out-of-scope badge
replaced the tooltip); nothing in this slice.

**F7's root cause was a missing field, now found and locked.** The detail
view's map fed `classifySpendClass` a `TxnLike` WITHOUT `isSplitParent`, so a
split container fell through to its reader override or guess there — while
the block's reason chip, built from `outOfScopeReason`, said 'split-parent'.
That is the F7 screenshot: a live class control an inch below copy saying the
row is in no total. The map now passes the flag; a container classifies
out-of-scope on the detail page exactly as everywhere else, the menu verb is
disabled with `SPEND_CLASS_BLOCKED_OUT_OF_SCOPE` — a constant IMPORTED by
both the availability engine and the server action, so a disabled menu row
and a refused write can never say different things (the module invariant,
kept in its testable form by the unit suite) — and the For-your-Plan block is
display-only: badge and explanation, no control.

**F8 needed no schema change — it needed a provenance proof.** The only
writers of `spendClassOverride` are the reader: the dial's write, and the
reader's own explicit (non-learned) rule stamps (`keyword-rules.ts` and the
pipeline pass `spendClassStamp` through untouched, and it is non-null ONLY
for explicit non-learned rules that file). No machine guess ever lands there,
so `spendClassOverride !== null` ⇔ the READER set this row's class — derived
as `spendClassReaderSet` on every view, and the register badge appends
"· you set this" (with a `data-spend-class-reader-set` attribute), while the
detail block says "You set this to X — change it anytime from the actions
menu" against the guess's "We guess recurring bills as Fixed and everything
else from its category." The marker is display-only: availability never reads
it, so the undo direction can never be locked.

**The demo fence moved with the write.** `canEditSpendClass` is checked
FIRST in the availability rule — matching the wire, which fences the demo
before it checks the row — so even an out-of-scope demo row refuses with the
demo sentence, never the row's. The e2e locks it: the demo's Groceries menu
shows the verb disabled with 'shared account'.

No schema change (the prisma diff against origin/main is empty). Verify gate
and CI conclusion recorded in STATUS.md.

## #435 — C.17: the audit P2 sweep — the pace rate divides by fractional elapsed time, and every "$0.00 is a claim" figure names its zero (2026-08-09)

**The audit's P2 list (CALC_AUDIT_2026-08-02) closed in two classes of
decision: one about the pace projection's DIVISOR, one about every figure
that reads as a measurement but is actually a claim.**

**The pace headline divides by REAL elapsed time, not the calendar day.**
`businessToday` gained its sanctioned time-of-day sibling
`businessDayFraction` in the SAME module and with the SAME precedence
(DEMO_TODAY or the seeded demo user → 0.5, noon — one fixed neutral point
for a static asOf; real users → the real fraction of their local day). The
pace projection divides by `daysElapsed − 1 + fraction` instead of counting
the in-progress day as whole — the old divisor sat the headline flat all day
and stepped at midnight. The integer `daysElapsed` stays the DISPLAY figure
("in the first N days" names the N calendar days whose rows are counted); the
fraction is the MATH figure. The divisor is floored at 1: the day-1
known-answer lock already defines that figure, and the floor keeps the
divisor from vanishing at 00:00:00. The engine parameter defaults to 1 —
the pre-fix behavior exactly — so every existing known-answer test passed
unchanged.

**The "zero" disclosures — four surfaces, one rule: a zero that isn't a
measurement must say which claim it is.** (1) The mover row's $0.00 is a
NET-REFUND CLAMP (rows were filed; refunds netted them away), and it printed
as a fact and sorted on it — the engine now carries `currentNetted` (a raw-net
pass reusing the reports engine's OWN exported predicates and id rule — the
glass-box rule; the collapsed row renders "net $0.00 after refunds vs $X
usual", the same clamp the expander already explained, and the `aria-label`
stays in lockstep). (2) The runway sentence printed "covers about −2.3
months" — negative runway is cash BELOW zero, and it now reads "your cash on
hand is below zero — about N months of typical spending short". (3) The
savings streak counted a 1–4 bps month (positive!) as a streak month while
rendering its rate as "0.0%" — the display lied, not the engine: the engine's
default floor is now EXCLUSIVE of zero (a 0-bps month saved nothing and
breaks the streak; positive mins keep inclusive `>=`), and 1–4 bps renders
"under 0.1%" with exact zero staying "0.0%". (4) The personal-best "so far"
was computed over the 12-month CHART slice — the server now computes it over
FULL history (`fullFlows`) and passes it down; a revert to the slice would
fail the 15-month fixture where the older months beat the recent window.

**The scope statements — three surfaces that said "this" without saying
"which set".** /calendar's posted line states "Posted + pending across all
your accounts", the expected line "Expected across all accounts", and the
transfer instruction names the DESTINATION via `input.paymentAccount.name` —
the same expression the frozen disclosure uses — where the old copy could
read as one account's instruction. /cards' minimum-interest sentence names
the covered set and its exclusions (cards with no statement date, next-cycle
cards) via an engine-carried `minimumPathInterestCardsCount` — the component
never re-derives a count the engine already knows. The merchant lens's
always-shown note states the GROSS-POSTED basis ("refunds not netted, nothing
pending") and names the register summary below as the different set (it nets
refunds and includes pending) — the three-figures-one-screen reconciliation
the audit demanded.

**The engine fixes.** `baselineLabel` prints a GAPPED set as "N months
through Newest" — the balance-move sentence's own form — instead of a
contiguous range that claims months with no spend were averaged.
`averageDiscretionaryCategorySpend` divides by the months that ACTUALLY have
data, not the full requested window — a new user's one month of history is
not divided by 3 into cut proposals a third of the truth. The cash-needed
headline's "by DATE" is now the FIRST due date (the earliest payment draws
first); the derivation trace restates that same figure while its
reconciliation check still spans the WHOLE cycle (last row = last due).
/forecast's frozen note takes `accountLabel(payment)` — a reader's rename
wins — where `payment.name` could name the account differently from the
figure 40px above it.

**toFIInputs is deleted, not fixed.** The scenario adapter paired the
NOMINAL return dial with a PRESENT-VALUE FI target — the mixed-base trap its
sibling adapter warns against — and had no production caller. The sanctioned
path to `monthsToFI` is the real return derived by `buildRetirementInputs`
(W.2 / #361), exactly as the /coach server does. The wealth-target module's
NOTE was rewritten to claim the SHARED basis the two /coach cards now
actually rest on — same real-return rate, different DESTINATION, rendered by
`COACH_COPY.wealthTargetVsFiCard` — retiring the audit's P2 note that
documented a divergence W.2 already closed.

No schema change (the prisma diff against origin/main is empty). Verify gate
and CI conclusion recorded in STATUS.md.

**Hostile-critic follow-up (Opus 5, one P1 + four P2s — all closed).** The
critic's P1 was the sharpest catch of the slice: the savings-rate CARD
computes streak + personal-best over FULL history, but the /coach recap's
`buildReviewCandidates` re-derived them over the 12-month chart slice — so a
key-gated recap could print "personal best so far" that an older month
already beat, and the two surfaces contradicted each other on the same claim
(the exact divergence class this sweep exists to kill). The recap now takes
the SAME `SavingsStreakResult` the card computes over `fullFlows` — one
helper, one basis, divergence impossible by construction. That unification
also superseded the recap's stricter private gate on a single measurable
month: "X is a personal best so far" is literally true with one data point
(the card already shipped that), so the recap now agrees instead of
abstaining. F3: `computeSavingsStreak.isPersonalBest` gained a positivity
gate — an all-negative history's least-bad month would otherwise render
"-0.0%", the exact "a zero is a claim" rule the slice applies to the positive
band. F4: the /trends comment now states the truth — the date and the day
fraction are two reads of the same sanctioned clock, milliseconds apart, a
midnight straddle bounded by the engine's floor. F5: the minimum-interest
note drops its count clause for a paid-in-full cycle ("every card is paid in
full") and counts only positive-required estimated cards in the next-cycle
exclusion. F2: the today-feed's negative-runway branch was dead code — the
nudge engine clamps non-positive runway to null, so the surface abstains
(which the audit allows); the dead branch was removed and the record here
corrected to say the negative-runway naming lives on the coach surfaces.

## #436 — K.4: the register's history bounds are scoped by the SET-DEFINING axes — account, category, unclassified — and both bound surfaces move together by construction (2026-08-09)

The F10 defect shape from the K.3 critic, made concrete before deciding: a
reader picks the "Last year" preset — window [2025-01-01..2025-12-31] — and
narrows to the card whose history starts INSIDE that window (2026-07-01). The
register's global oldest (a 2024 row on a different card) prints as "History
available from Sun, Aug 11, 2024" above an empty box, and the before-history
branch of `registerEmptyReason` CANNOT fire: `to` (2025-12-31) sits after the
global bound, so the window looks in-range even though the browsed card has
no row inside it. Both sentences were true and neither was about the view —
the K.3 pair broken one filter away, by the exact K.3 branch that was meant
to name this zero.

**Decision: scope the bound by the SET-DEFINING axes only — account,
category, unclassified — the axes that change WHICH ROWS EXIST.** One new
pure helper, `scopedDateBounds` (`query.ts`), narrows the register's own
pre-filter set by those axes and is wired into `getTransactions`, replacing
the global scan; the printed filter-bar line and the empty-state reason
inputs receive THE SAME scoped bound, so K.3's pair-equality holds by
construction instead of by coincidence. The scope is sound: the scoped set is
a superset of every further-narrowed subset, so its oldest is a lower bound
on any of them — when before-history fires on the scoped bound it is true of
the view, and when the window does contain scoped-set rows the empty box
correctly falls through to the filters branch (the match axis is what killed
them, and that is what the branch says). The MATCH axes — type, class,
search, merchant, reimbursement, the window itself — never move the line:
they select WITHIN the set, and a depth line that jumped on every toggle
would mislead in the other direction.

**Rejected alternatives.** (a) Scope only the printed line, leave the
empty-state inputs global: the pair re-breaks — the bar would say the card's
depth while the box explained against a different bound. (b) Scope by ALL
axes: the line flip-flops on every type/class/search toggle and the
before-history trigger becomes right only by luck. (c) Keep the global bound
and patch only the branch: both sentences stay true-but-not-about-the-view,
which is the original owner-report defect. The demo seed cannot exhibit F10
(all demo accounts share one depth), so the e2e uses the throwaway-user
pattern: two accounts with different oldest rows, the unfiltered line, and
the account-narrowed + last-year window asserting BOTH surfaces name the
card's own bound and the box shows `txn-empty-before-history` — a state the
unscoped code cannot reach.

## #437 — K.7: the OBLIGATION owns a loan payment — the C.25-proven detected row yields, and the radar's overlap disclosure names only what survives (2026-08-10)

**Decided by execution, as the K.7 row demands.** The row's two candidate causes were
both wrong (PROGRESS 2026-08-09); executing the #134 residual on a fixture holding BOTH
sources produced the real defect: a loan payment projected twice. The obligation derives
from the issuer's own terms (`selectLoanObligations`: `minimumPaymentCents` +
`dueDayOfMonth` from Plaid `/liabilities/get`), and the recurring detector learns the
ACH that pays it as a scheduled row with no loan gate (`classifySeriesProjection`
counts it; `server/recurring.ts` persists it). Both fire on the ordinary shape, and the
three surfaces that combine the sources — /calendar, /forecast, /radar — debited the
payment twice a month ($1,155.00 of phantom outflow over the demo's 90-day horizon).

**The structural key #134 said did not exist has since been built, so the ownership
question has a C.25 answer instead of a heuristic.** `loanPaymentFlowExclusions` links a
checking merchant canonical to ONE specific loan account by ≥2 distinct months of ±3-day
same-|amount| pairs against a dateable obligation at the row's own amount, and the app
already stakes the reader's SPENDING TOTALS on that link (those charges leave flows
because they are "carried elsewhere — the committed / forecast / calendar line"). A link
trusted to delete a charge from spending is trusted to stop projecting the same charge
twice.

**Decision: the obligation owns the payment; a detected scheduled row C.25 has proven is
that payment yields — and nothing else does.** One pure function,
`splitLoanCarriedScheduled` (`engine/loans/duplicate-projection.ts`), consumed by all
three surfaces, splits scheduled rows into kept/suppressed. Suppression is 1:1 and never
free-standing: a row drops only when a C.25 fact names a loan account that is in THIS
call's obligation list at THIS row's amount. Four reasons the obligation wins: it is the
issuer's contract (amount AND due day), it carries `accountId` (the frozen disclosure,
duplicate view and reminders key off it), C.25 already named it THE carried-elsewhere
surface (suppressing it would delete the line that justifies removing those charges from
spending), and it repeats on the contract's cadence while a detected series' anchor
drifts with the bank's posting dates. Refusals, all locked: outflows only (an inflow at
the obligation amount is never that payment), aggregate canonicals never consumed (the
C.4 doctrine), an obligation filtered out upstream (a superseded predecessor, R4) never
takes a scheduled row with it, and an off-amount row stays visible — the #400
failure-direction rule kept intact: a duplicate the reader can see and weigh beats a
real payment silently deleted.

**The radar's disclosure follows the split.** The old `loanOverlap` sentence warned
whenever a scheduled row carried categoryId 'auto-loan' — one loan kind, and now stale
where C.25 proved the overlap. It asks the honest question instead: does a SURVIVING
outflow match an obligation's own payment? Deliberately not gated on "anything was
suppressed" — a reader with two loans can have one proven and one not, and the unproven
one is still counted twice.

**Coverage (the K.7 row's "no coverage on any surface"):** the engine lock (13 unit
cases after cycle 1 below, fail-old both directions — deleting the rule reddens the
suppression case, widening it reddens the keep cases); the WIRING locks (radar 5,
forecast 1, calendar page 2 — each sabotaged red: radar/forecast 3→6 events with the
stale disclosure re-firing, the page markup growing the second −$385.00 row); and the
e2e `Auto Loan due` lock on /calendar July — the loan-due half the K.5 re-point could
not assert while the demo painted a detected series.

**Cycle 1 (hostile critic, Opus, fresh context) — FAIL, 2 P1s executed → fixed and
sabotage-proven.** The critic ran the engine on the REAL pipeline chain and on a
two-loan fixture, not the round-trip fixtures:

- **F1 (P1, executed): the rule was INERT on the ordinary shape.** C.25 mints its fact
  canonical from the RAW descriptor via a KNOWN_MERCHANTS pattern (`ACH WITHDRAWAL
  CARMAX AUTO FIN 4421` → `CarMax Auto Finance`); the detector persists that canonical
  as the series description; and re-deriving `normalizeMerchant('CarMax Auto
  Finance')` falls back to title-casing (`Carmax Auto Finance`) — the pattern only
  matches the raw ACH form. Exact-string keying of the two could never meet. **Fix:**
  both sides pass through the same `normalizeMerchant` before keying — sound because
  the canonical IS the merchant identity (two names of one merchant agree; two
  merchants cannot collide). Locked by a REAL-chain test; sabotage-proven (raw fact
  keying reddens exactly that test).
- **F2 (P1, executed): suppression had no per-row attribution.** The `(canonical|amount)`
  key deleted EVERY row under it — two loans sharing one canonical (Nelnet, the
  generic-servicer rule collapses them) with only one dateable lost BOTH payments, the
  undatable loan's leaving the projection entirely. **Fix:** the split carries a
  covered COUNT per key (one fact = one loan account C.25 proved = at most that many
  payments a month), and suppresses only while the count isn't exhausted. Locked by
  both directions (one fact → one of two rows stays, visibly; two facts → both may
  go); sabotage-proven (cap removed reddens exactly those two tests).
- **F3 (P2, fixed): the /calendar wiring was unwitnessed** — deleting the
  `splitLoanCarriedScheduled` call kept every test green. **Fix:** a page-render test
  (jsdom, mocked `auth` + `getCashNeeded`, real prisma + register read) asserts the
  proven row does NOT paint (`Auto Loan due` yes, `CARMAX AUTO FINANCE` absent) and
  the unproven duplicate DOES paint (both rows visible — #400's failure direction).
  Sabotage-proven: with the split deleted, the markup shows Jul 2 `Auto Loan due`
  −$385.00 AND Jul 5 `CARMAX AUTO FINANCE` −$385.00.
- **F4 (P2, recorded residual, unchanged): the radar disclosure fires on
  amount-equality alone** ($385 rent == a $385 mortgage payment). It is hedged ("may
  be the same loan — counted twice"), the over-hedge direction is safe for a
  projection, and the class predates K.7 (the old categoryId check had the same
  breadth); tightening it needs a per-row attribution the split deliberately does not
  export. Recorded, not changed.
- **F5 (P3): "10 unit cases" was miscounted** — the engine file holds 13 after F1/F2
  (10 original + the real-chain test + two cap tests); the four K.7 files carry 24
  tests (engine 13, radar 5, forecast 4, calendar page 2).

**Still blocked, owner-only:** production's shared demo dataset predates the terms and
carries the stale detected series; reseeding is destructive and TASKS 0.3 says "Do not
seed", so the owner's call, not the engine's.

## #438 — K.8 harness fix: the e2e stall class is cross-process SQLite write contention — the busy burn shrinks 15s→500ms and `retries: 2` absorbs the residual (2026-08-10)

**Context:** the K.8 close-out (STATUS.md) named the e2e harness as the open issue — 12 failed CI reads across 8 tests on a byte-identical twice-green tree, all in the documented 4-worker shared-SQLite classes, all with server actions whose confirmation streams severed (≥60s unbounded stalls). Direction: worker-isolated e2e DBs or workflow-level retries, with `retries` evaluated inside the slice under its own verification.

**Mechanism (proven by instrumentation, not inferred):** two instrumented full runs (request-level log inside `next start`: method/route/Next-Action header/status/duration/event-loop-lag, plus direct-statement timing) showed: ~40 spec files open their OWN better-sqlite3 connections (15s busy_timeout) to the single shared e2e file. A worker seed — or a concurrent server transaction — committing between a server-action transaction's first read and first write makes the write upgrade burn the FULL busy_timeout on a doomed stale-snapshot wait (SQLITE_BUSY_SNAPSHOT never clears for that snapshot). The Prisma engine serializes per connection, so concurrent burns STACK: run 2 measured actions resolving at 6–19.4s (≈15s burn + re-roll), 97 POSTs still open at run end (handlers queued behind burns), and 3 tests failing on 20–30s action-response timeouts; run 1 showed 2 POSTs that never finished while the loop stayed healthy. The 15s timeout was chosen "so a lock wait resolves within the test budget" (db-adapter.ts) — it amplifies instead: each burn multiplies every statement queued behind it, which is why no window raising converged.

**Decision:** (1) the SQLite busy_timeout becomes env-tunable — `SQLITE_BUSY_TIMEOUT_MS`, default 15s unchanged (dev/unit, single-process contention) — and the e2e harness sets it to 500ms, so a collision costs ≤500ms + one serializableTx re-roll (3-attempt cap) instead of a 15s queue-blocking burn; (2) Playwright `retries: 2` absorbs the residual lottery — each retry is a fresh page/signup/unique seed, and a test that fails after retries is a REAL failure that enters the ledger (the retry cannot paper over a regression, only the harness class).

**Alternatives rejected:** worker-isolated e2e DBs (K.8's other candidate) — incompatible with ONE server process: the server's connection must read the same file the specs seed, so per-worker files would break its reads; routing every seed through a test-only server endpoint is the true single-writer fix but a ~40-file refactor, recorded as the follow-up if the lottery persists; raising test windows — the close-out already ruled this out ("window raising has hit its limit").

**Verification (4 independent local draws with the fix):** run 3: 319 passed / 1 flaky / 0 failed (transactions:295, a ledger-class member, passed on retry); full gate `VERIFY_E2E=1 bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / 6,575 unit + 1 skipped / build clean / e2e 318 passed / 2 flaky / 0 failed. The 2 flaky were BOTH CSV members — transactions:638's retry-1 reproduced the exact CI signature (180s stale-result window, "Imported 2" panel text never updating — the second import's action never produced a client-visible result, and the K.4 forensic proved that class never writes) and passed in 2.3s on retry: proof the class is machine-independent (it is the harness, not GitHub-hosted runners) and that the retry absorbs it. Residual recorded, not fixed: the C.14/C.15 severed-flight wedge has a non-DB component (the action stalls before writing; the 500ms burn cannot touch it) — ~1 draw in 4 locally, absorbed by retries, follow-up open.

**Also recorded:** the combine-connections 500 (two concurrent combine actions racing at combine-connections.ts:1042, "H.6b(a) carry" throw) is a REAL engine robustness gap, not harness noise — now surfaced fast (ms) and absorbed by retries; a named follow-up for an engine-side serialization/idempotency fix (money-adjacent → Opus territory, not this slice).

## #439 — O.18c: the /recurring rows panel carries the detector's own charges, and its contract is the INVERSE of the glass-box "rows add up to this figure" claim (2026-08-10)

**Context:** the last holdout of the owner's every-table-expandable ask (Wave O.18 — "what exactly is the system classifying as a bill"). A series row prints `typicalAmountCents` — the most recent stable amount, a median, not a total — so the standard panel contract ("these rows add up to exactly the figure above, matched to the penny") would be FALSE here, and `RecurringSeriesResult.occurrences` was a count only: the detector had the rows in scope but did not carry them out.

**Decision:** (1) `RecurringSeriesResult` gains a required `occurrenceRows: readonly RecurringOccurrence[]` — `{date, amountCents (signed), descriptor}` — built in `buildSeries` (the ONE constructor both detected and declared series funnel through) from the same `sorted` array the cadence/amount/count were read from, oldest first. Purpose-built shape rather than raw `RecurringTxn`: the panel is evidence display, and the type admits nothing the panel does not show. Required, not optional — the compiler makes every constructor state what evidence it carries (the O.13f `declaredByUser` precedent); six hand-built fixtures in other unit suites state `occurrenceRows: []`. (2) The panel contract is the inverse of the glass-box one and says so plainly: "the $X above is this payee's most recent charge — the typical amount, not the total of N charges in the series." NO total is rendered — a cumulative sum of N months of charges invites the wrong reading ("$1,400 of Netflix?!") and the row's figure is a rate, not a sum. There is deliberately no `reconciles` line: the figure above is NOT the sum of the rows, and the sentence naming that is the honest fail-loud. (3) The copy is composed in the engine (`recurring/panel.ts`) as pure functions, with the row's RENDERED figure passed in as a string — the categoryPanelBasis lesson (a rule in a .tsx cannot be locked), and the exact-verbatim-embed is what lets the e2e fail if the sentence ever disagrees with the row. The composer returns a non-empty tuple so a surface cannot ship a money panel with no disclosure. (4) Declared series get their own rhythm sentence (O.13f — "the rhythm is yours, not detected from your history"); the price-change sentence exists only for detected plateaus (declared series carry nulls by construction); income series read "deposit"/"amount" throughout — a raise is not a price change. (5) The interaction (toggle with visible label, aria-expanded/controls, rows mounted on first open) is borrowed wholesale from `BreakdownPanel` — the O.18 idiom, not a new pattern. Per-row transaction links deliberately NOT added: the row's merchant link already opens the register view of exactly these charges, the snapshot path's transaction `id` is an index (plumbing real ids would be a second slice), and the question the panel answers is "is this bucket right?" — answered in place.

**Verification:** 8 new unit tests (copy contract + carry) + 1 new e2e (Netflix panel: charges listed newest-first with signed amounts, the sentence embeds the row's own $17.99, price-change sentence, deposit wording on the payroll row, collapse, WCAG AA after expand). Full gate + CI readout in the STATUS.md record. **Hostile critic (Opus 5) FAIL → one P1 executed (the count-1 "not the total" falsehood — the sentence now says "the only charge in the series" at count 1), one P2 executed (the price-change sentence now dates the FIRST charge at the new price, not a change date the detector doesn't record), one P2 measured unreachable (legacy declared-sign: ZERO BILL overrides on the live corpus — probe kept as instrument), one P2 accepted (signed rows vs unsigned rate — deliberate, documented here).** Re-review after the fix gate, full cycle in STATUS.md.

## #440 — O.18e: the /trends "New this month" row expands into a merchant-keyed panel whose rows ARE the figure, and the basis names the in-progress window (2026-08-10)

**Context:** the owner's every-table-expandable ask (Wave O.18) reaches the /trends "New this month" list. Those rows are aggregates — a merchant's month — so they can carry a panel, but neither existing builder fits: `buildCategoryBreakdowns` keys on category, and this card's figure sums the in-progress month THROUGH the as-of date, so its basis must state that window (a bare "$80.00" beside the movers, which compare COMPLETE months, would read as the whole month — C.26's stop-at-today lesson). Requires a merchant-keyed sibling builder, not a new argument on the category one. **Premise correction made mid-slice (critic F1):** this is NOT "a third basis /reports does not share" — /reports has stopped at today since C.26 (`snap.transactions.filter(t => t.date <= today)`, reports.ts:154) and /budgets sums the whole month (`wholeMonthWindow`, budgets/page.tsx:176); the real contrast is intra-page: this in-progress aggregate beside the complete-month movers. The false premise had been written into the slice's own comments and deploy-check header; all corrected.

**Decision:** (1) `NewMerchant` gains required `rows: readonly BreakdownRow[]` (oldest first) and `futureDatedCents`, both built in pass 2 of `computeSpendingTrends` — the SAME loop that sums the figure (DECISIONS #439's carry-out construction: rows and figure cannot disagree by construction). Money dated after today never enters the totals; it is totaled separately (`futureDatedCents`, netting within itself, floored at 0) so the basis can disclose it instead of it silently missing from a panel that claims "these are the rows". `merchantBreakdownRow` is the sibling shaper: label fallback merchantName → rawDescriptor → 'No description'; key `${merchantKey}:${index}:${date}` (unique per merchant+date); `rawDescriptor` null when equal to the label OR whitespace-only — the category builder's exact rule; signed integer cents; pending marked. (2) The panel contract here is the GLASS-BOX one — unlike O.18c's median, this figure IS the sum of its rows — so `reconciles` renders ("These N rows add up to exactly $X — matched to the penny."), computed in the view from the carried rows (`sum === headline`). (3) The basis is composed in the engine (`newMerchantPanelBasis`, trends/labels.ts — non-empty tuple, RENDERED figure/month/through-date embedded, the O.18c contract): S1 names the window ("The $80.00 above is this merchant's spending in Jun '26 through Wed, Jun 10, 2026." — the date rendered, never the word "today", because demo and e2e pin DEMO_TODAY); S2 discloses future-dated money via the shared C.26 not-counted-yet sentence but ONLY when `futureDatedCents > 0`; S3 is the shared BREAKDOWN_BASIS. (4) The register footer reuses the row's existing merchant link (scope discipline — the row's link already exists; no merchant+window link variant invented) with a label that says what it opens: "Open {merchant} in your activity list…" — the merchant's whole history is a superset of the panel's rows, so the label names it rather than the default "Open these" (critic F4). Per-row transaction links deliberately not added (the O.18c precedent — the panel answers "is this bucket right?", answered in place).

**Verification:** 15 new unit tests (11 engine: carry-out rows exact/ordered/signed + sum invariant on the O.8a measured case, pending/refund marking, per-merchant keying + uniqueness, transactionId passthrough, label fallback incl. whitespace-descriptor → null, future-dated exclusion from rows AND figure, zero-when-none, future-net-within-itself, floor, dropped net-≤-0 merchant; 4 composer: golden S1 + BREAKDOWN_BASIS, S2 conditional, zero/negative never disclosed, source-scan lock) + 1 new e2e (throwaway user, seeded ALPHA CAFE rows incl. a FUTURE-dated charge → figure $70.00, 4 rows, not-counted-yet disclosure, collapse/re-expand round-trip, axe WCAG AA). Full gate + critic + CI + live readouts in the STATUS.md record. **Hostile critic (Opus 5, fresh context): PASS on first pass — 0 P0 / 0 P1**, the carry-out/reconcile construction verified sound (same loop, integer arithmetic, keys unique, `reconciles` cannot silently disagree). Six P2s: F1 (false "/reports applies no clamp" premise — EXECUTED, see Context), F4 (windowless register link over-promising "Open these" — EXECUTED via the honest label), F6 (whitespace-only descriptor shipped `''` instead of the sibling builder's null — EXECUTED + locked), F2 (S2's word "today" beside S1's rendered date — ACCEPTED: the shared C.26 sentence is /reports' and /budgets' locked wording, and it is true in every reachable state, the engine clock's today IS the as-of date), F3 (a C.25 flow-excluded loan payment can be listed in this panel as "spending" while the pace card says "loan payments are not spending" — ACCEPTED + recorded with the executed scenario: a new auto loan's lender absent from the prior 6 months; the figure behavior is pre-existing documented Ask-parity and the critic's own direction is "copy, not money", but the C.25 sentence is shared by FIVE surfaces with their own locks — the fix is a future slice, see TASKS.md O.18e-FU), F5 (net-floored future disclosure can silently omit a future charge fully offset by a future refund — ACCEPTED, the C.26 per-category precedent, S1 always names the through-date).

## #441 — O.18e-FU: the C.25 loan-payment basis sentence is scoped per surface — one composer, five scopes, the universal "loan payments are not spending" removed (2026-08-10)

**Context:** O.18e's critic F3 (accepted + recorded there, fixed here as its own slice — TASKS.md O.18e-FU). The C.25 sentence ended in the universal "loan payments are not spending", printed by FIVE surfaces, and it was FALSE wherever a surface lists the rows the exclusion moved. O.18e executed exactly that: on /trends the pace card printed the universal while the page's own "New this month" panel listed the same payment as spending — the deliberate register basis (pass 2 sums what the activity list shows; it never takes `excludedFlowIds`, a pre-existing documented decision). Reachability, executed: a loan merchant with old pairing evidence (C.25 gate 2 re-derives from ALL rows, whenever they happened — ≥2 distinct months of ±3-day same-|amount| pairs) and a 6+ month gap; the gap clears NEW_MERCHANT_LOOKBACK_MONTHS, so the resumed payment NAMES the merchant "new" this month, while the old pairs still make the row flow-excluded. The Opus critic's own direction was "copy, not money" — the sentence was overbroad, the figure behavior is register-basis — so the fix is the copy, scoped per surface.

**Decision:** (1) Copy route, per the critic's direction — the money behavior is UNTOUCHED: pace, movers and largest keep dropping the row; pass 2 keeps counting it. The divergence is now locked as DELIBERATE in tests (trends-f3-regression), so a future slice that excludes the flow set from pass 2 is a conscious figure change, never a silent one. (2) One composer, `loanPaymentBasisSentence(fact, scope)` in `src/server/loan-payment-basis.ts` (the existing one-definition facts module — its docblock already promised "one definition so /reports, /trends and /budgets cannot phrase the same fact three different ways"; the promise now includes the sentence, not just the facts). Five scopes — 'pace-figure' (/trends — the pace figure the sentence sits under), 'figures' (/coach), 'cards' (/dashboard), 'this-list' (/budgets — the By-category list), 'page-figures' (/reports — keeping the escrow-change boundary "A payment at another amount (an escrow change, say) counts normally."). Every sentence names the figures the claim actually covers — "not in this pace figure", "not in these cards", … — so a surface that counts the rows can coexist with a sentence that never claimed they vanished. The amount is rendered once in the composer (`formatCents`), so every surface prints the same string for the same payment. (3) All five surfaces now call the composer: /dashboard's and /budgets' hand-rolled copies are deleted (the old /dashboard comment "Same words /coach uses (one helper)" was a lie — two hand-rolled copies; it is now true), /reports-view is a 'use client' component importing the pure composer (verified safe — the module imports only engine modules and money utilities), and /trends' comment records why the claim is scoped to the pace figure: the movers and biggest purchases drop the same rows, but the page's own "New this month" panel lists them — it follows the register, which shows the charge — so a universal claim would contradict the card below it. (4) The panel's own "this merchant's spending" basis was deliberately NOT flagged by the critic and is out of scope — the panel lists rows the register shows; that basis is true.

**Verification:** 8 new unit/render tests. `loan-payment-basis.test.ts` — the verbatim contract for all five scopes (golden strings, e.g. "Payments to Mr Cooper at $6,217.07/mo are counted on Mortgage, not in this pace figure. A payment at another amount counts normally."), the F3 regression negative (NO scope contains "not spending" or matches /loan payments are not/i — the C.26 lesson: a string no test asserts may as well not exist, and the reverse: a FALSE string no test forbids will ship), and the amount-format lock ($6,217.07/mo in every scope). `trends-f3-regression.test.ts` — the engine divergence locked as deliberate (the same excluded row: out of pace + largest, IN the new-merchant panel with its exact transactionId carried; anti-vacuity: without the exclusion the payment is in the pace total). `trends-f3-render.test.tsx` (jsdom + RTL, the spend-window-render precedent) — the /trends page prints the pace-figure scope verbatim, the universal exists nowhere on the page (the F3 coexistence: scoped sentence + the panel listing the same payment), and the panel opens to the honest "this merchant's spending" basis. Gate: first run RED on this slice's own code — tsc (the test's `as keyof typeof EXPECTED` cast yielded `string`, not `LoanPaymentBasisScope`) + eslint (dashboard/page.tsx still imported `cents`/`formatCents` — the composer renders the amount now); both fixed, run 2 + full `VERIFY_E2E=1` run GREEN (6,616 unit + 1 skipped / 403 files, e2e 320 passed with the documented flaky pair absorbed by K.8 retries). Full gate + CI + live readouts in STATUS.md §O.18e-FU. **Opus re-review (fresh context on the shipped tree): PASS on first pass — 0 P0 / 0 P1**, scope truth verified per surface by direct trace. One P2 executed: the /dashboard scope's "not in these cards" was falsified by a literal reading (the same-page recent-transactions card lists the payment row) — the scope now reads "the figures on these cards" (aggregates drop the rows; the recent card shows raw amounts, not figures), lock updated, its own green gate + CI + live. Three P2s accepted + recorded: P2-1 (all-excluded silence on /reports + /trends — the figure-gated sentence never renders for a dedicated mortgage account; the naive array-gate fix is false copy since the scoped claim names an absent figure — queued as TASKS.md O.18e-FU2), P2-3 (the /ask answers' "counted on the loan, not as spending" — a sixth surface outside F3's five, pre-existing C.25 P1-C — queued as O.18e-FU3), P2-4 (/coach reimbursement card copy vs the figures sentence under a contrived "awaiting reimbursement" mark on a loan payment — pre-existing, recorded only).

## #442 — O.18e-FU3: the /ask loan-payment answer copy loses the universal — the three cited sites plus the fourth one the record missed, scoped to the answer's own figures (2026-08-10)

**Context:** O.18e-FU's Opus re-review P2-3 (accepted, queued as TASKS.md O.18e-FU3): the /ask answers still carried the universal at one remove — "counted on the loan, not as spending" — at answer.ts:989, plus the branch details at 1037 and 1058. A SIXTH surface outside F3's five; the slice's commit message ("the universal removed") was true only for F3's scope. The record cited three sites; grep found a FOURTH the record missed: `src/server/assistant.ts` appended a hand-rolled sentence — its own sixth copy of the universal — to five /ask intents (spend_total, spend_by_category, top_categories, income, savings_rate) whenever `loanPaymentBasisFacts` was non-empty. The F3 lesson again: a fix on the reported surface is not a fix on the pattern.

**Decision:** (1) The engine's three sites are scoped to the answer's own figures. The appended clause (`excludedLoanClause`, ~989) now says "counted on the loan, not in these figures." — true wherever it renders: all four call sites (1071/1088/1107/1108) have visible figures on the answer surface. The count-0 branches (~1037/1058 — the answers that abstain, e.g. "No purchases at {merchant} {month}") end "— counted on the loan instead." and deliberately do NOT claim "not in these figures": those answers render NO figure, and a claim about an absent figure is the same class of falsehood FU2 is queued against — "instead" points back at the unchanged headline ("Payments to {merchant} aren't counted as spending {month}"), which already scopes the claim to this month. (2) The server append (assistant.ts:302) now calls the composer with a NEW scope, 'answer' — "not in this answer." The word holds in both states: with figures (spend_total etc., which drop the rows) AND in the abstain states, where the appended sentence sits beside "No spending recorded this month" and is then the only sign money moved — "not in this answer" names the claim it accompanies, never an absent figure. The composer's structural lock extends automatically: the test's `Record<LoanPaymentBasisScope, string>` forces a golden verbatim for the new scope, and `SCOPES` derives from `Object.keys`, so the F3 negative (no scope contains "not spending") covers it without a test edit. (3) The hand-rolled server copy is deleted; the import of `cents`/`formatCents` in assistant.ts died with it (the composer renders the amount).

**Verification:** 2 new unit tests + 1 strengthened, in `loan-payment-flow-exclusion.test.ts` (a `row()` fixture: merchant "Truist Mortg Olb Mtgpmt", categoryId null): the refunds-only branch asserts headline "No purchases at Truist Mortg Olb Mtgpmt July 2026." and detail contains "$6,217.07 in a payment to this lender is counted on the loan, not in these figures."; the purchases branch (2 excluded payments + 1 purchase) asserts "You spent $100.00 at Truist Mortg Olb Mtgpmt July 2026." and detail contains "$12,434.14 in 2 payments to this lender are counted on the loan, not in these figures."; both assert `not.toContain("not as spending")`; the pre-existing P1-C test's detail is tightened to the exact new string "…went there — counted on the loan instead." with the same negative. `loan-payment-basis.test.ts` gains the 'answer' golden. Repo-wide grep after the slice: ZERO runtime "not as spending" strings remain (only history-describing comments and the negative test locks). Gate: tsc 0 / eslint 0 / **6,618 unit + 1 skipped** (was 6,616 — the 2 new tests) / build clean, `bash scripts/verify.sh` GREEN (e2e skipped locally — the `VERIFY_E2E=1` gate runs in CI on push, read via scripts/ci-status.sh). Full gate + CI + live records in STATUS.md §O.18e-FU3.

## #443 — O.18g: the conscious-buckets e2e binds its savings else-branch — a throwaway user whose working $1,000.00 savings figure renders no control (2026-08-10)

**Context:** The O.18g task (carried from O.18f): the branch where a working savings figure carries NO adjacent control was unit-locked only. The demo's savings is PROVABLY always $0 — the seed creates no savings target and no goals, and the settings dial is demo-fenced (settings-actions.ts:44) — so the e2e passed vacuously over the else state, and an unreachable branch is a claim that something is handled. The task offered two directions: seed a throwaway user where the branch provably binds (the trends-caps / reports-total idiom) or delete the branch.

**Decision:** (1) KEEP the branch — it is real product behavior: `savingsLabel` authors the "Set a savings target" action (href /settings) ONLY for the unset-$0 row (`savingsSource !== 'target' && plannedSavingsCents === 0 && savingsTargetBps == null`, plan-row-labels.ts:579-587); deleting the branch would delete that control for every real user without a target. (2) The demo test is pinned to its provable $0 state with a BINDING control assertion (the $0 pin is a fixture fact, never a vacuous pass), explicitly cross-referencing the throwaway test so neither branch can drift back to vacuity unnoticed. (3) The working-figure state is exercised by a new throwaway-user test: signup via the UI, then direct better-sqlite3 seeding — a manual checking account, two POSTED paycheck months (2026-04-05 / 2026-05-05, $5,000.00 each — complete months under the pinned DEMO_TODAY=2026-06-10), and `savingsTargetBps = 2000` — the exact state the plan's income median (server/spending-plan.ts:161-195) and savings target (plan.ts:824-826, :973) read: pattern income $5,000.00 → `Math.round(500000 * 2000 / 10000)` = $1,000.00 planned savings, a working non-zero figure with NO control beside it. (4) Anti-vacuity chain: the fixture must PROVABLY bind before the `toHaveCount(0)` control assertion can pass — strip visible, savings toggle > $0, panel penny-match, reconciled clause — so a degrading fixture (pattern null, savings $0) fails loudly first.

**Verification:** 2/2 spec green on first run (25.5s; the new test 2.9s). Full `VERIFY_E2E=1` gate: tsc 0 / eslint 0 / 6,626 unit + 1 skipped / build clean / **e2e 318 passed, 1 failed, 4 flaky (7.6m)** — named per K.8: the ONE failure is `transactions.spec.ts:735` (CSV double-paste warning test), a documented flaky-ledger member (recorded with the CSV family in STATUS.md on 2026-08-10), PROVEN pre-existing on this commit: the push's diff is only `tests/e2e/conscious-buckets.spec.ts` (the failing file is untouched), an isolation run passes it on a fresh attempt (1 flaky — passed retry #1), and all three full-run failures are the documented severed-confirmation-flight class (the 90s toPass windows expired on the stale first-import panel — the class the test's own comments describe at :755-757/:780-781). The 4 flaky (merchant-lens:22, register-scroll:162, transactions:295, transactions:610 — all documented members) passed on retry. Gate + CI + live records in STATUS.md §O.18g.

## #444 — O.20d-FU: the re-review Flash never ran — what a fix pass may correct in place, and what has to become its own critic-gated slice (2026-08-11)

**Context:** O.20d was built AND critic-passed inside a single DeepSeek V4 Flash session, whose record claims an "Opus fresh-context hostile pass (round 1 FAIL 2 P1s → round 2 PASS)". CLAUDE.md routes every rule-3 hostile-critic pass to Opus 5 / Fable 5 "including, especially, slices Flash built — Flash never self-certifies these", so the gate the record claimed was never actually met. The owner caught the routing error after the fact. Three fresh-context Opus 5 critics (one per surface) plus a fabrication audit of the record were re-run against `c407404`. Result: the central money claim HOLDS by trace (carry-out real in all three engines, integer cents intact, signed liabilities reconcile) and every recorded number reproduces exactly — but ten P1s across copy honesty and tap-target accessibility, none of which the self-certified pass had found.

**Decision (1) — the split.** A fix pass may correct a sentence, a clamp disclosure, an aria contract, or a self-verifying assertion in place, because none of those move a figure. It may NOT change what a figure counts. So the seven copy/contract P1s and three P2s shipped here, and the three findings that would move live money or a rendered layout were queued as their own rows with their own critic requirement: **O.20f** (WCAG 2.5.8 tap targets — UI, no money math, routed to Flash), **O.20g** (the creep detector counting merchandise returns as income), **O.20h** (the two definitions of "discretionary"). Riding a money-semantics change on a fix pass would be the same self-certification error one level down.

**Decision (2) — the refund disclosure fires on the branch that decides netting, not on a proxy, and is not widened past it.** The flag now also fires for the `refund` leaf (`{group: 'Income', discretionary: false}`) — the canonical case a reader reaches by picking "Refund" in the picker, which the old `discretionary`-only test missed entirely. It is deliberately NOT extended to every non-income positive: a return filed to `groceries` neither enters the discretionary bar nor is withheld from it, so disclosing it would explain a divergence that does not exist on that figure; and an uncategorized inflow may be a deposit rather than a return, which the sentence must not assert (the same class as #442's "no claim about an absent figure"). The sentence itself now says "a credit posted", never "a refund you filed", because the same branch catches a bike sold and filed to `shopping` and a category the app guessed rather than one the reader chose.

**Decision (3) — the loan-payment sentence is REMOVED from the creep panel rather than rescoped.** Two independent reasons, either sufficient: it was window-wide (`loanPaymentsExcluded` means "the caller handed me a non-empty set", so a July payment printed the exclusion on the February bar), and it was vacuous regardless — `loan-payment` is `discretionary: false`, so an excluded loan payment could never have entered a discretionary figure. Rescoping it per-month would have bought a correctly-scoped sentence that still cannot move the number it sits under. The C.25 disclosure stays on the surfaces whose figures it actually changes.

**Decision (4) — O.20h is mitigated by disclosure, not left silent, until it can be fixed properly.** "Discretionary" is the category taxonomy flag here and the Fixed/Discretionary spend class in the register and /budgets, which honours the reader's own override (#397). O.20d's panel now LISTS the contradicting row — a gym membership labelled "Fixed · you set this" in the register, counted here — beside a footer link inviting a re-file that cannot move the number. Unifying the definitions moves a live figure on three surfaces and needs its own critic, so the panel states the divergence outright in the meantime. The alternative (ship neither the fix nor the admission) was rejected: the slice made the contradiction visible, so the slice owes the reader the explanation.

**Decision (5) — `reconciles` is computed at every call site, never asserted.** All four new panels hardcoded `true`, and two passed the headline as its own `sumCents`, so "matched to the penny" verified itself and BreakdownPanel's documented mismatch branch was dead code at exactly the four newest row lists. The invariant genuinely holds today in all three engines — which is why this graded P2, not P0 — but the guard exists for the future filter, cap, or row-level change, and a guard derived from the thing it checks is not a guard.

**Verification:** gate + live records in STATUS.md §O.20d-FU. The deploy-proof script's own two non-asserting checks (one literal `true`, one `length > 0`) were replaced with assertions on rendered live content and re-run against production: 11 checks PASS.

## #445 — O.20g: what makes an income baseline credible enough to divide by, and why a count of covered months is not it (2026-08-11)

**Context:** TASKS O.20g reported that `detectLifestyleCreep` added EVERY positive row to its income series — so a merchandise return counted as a raise, which both inflated the printed "income grew ~X%" and, because `flagged` is a DIFFERENCE, could silence the very warning the detector exists to raise. The row prescribed the fix: gate the accumulator with `isIncomeFlowRow`, the predicate `monthlyFlows` already uses on the same page (#166).

**Decision (0) — measure before assuming direction, and the measurement falsified the prescription.** A read-only production probe (`scripts/audit-probes/o20g-creep-income-refunds.mts`, the C.19 pattern) replayed the engine per real user. The gating alone made the owner's own figure **worse**: 42 positives totalling $28,673.90 left the income series, and the first-half income median fell from **$10,604.95 to $0.08** (one interest credit; the month before it carried 59 rows and zero income rows). Income growth went from 592% (old rule; itself computed with the pre-fix rule) to **40,607,025.0%** — which never printed, because that sentence only renders when flagged, but which silenced the flag while the reader's discretionary spending grew ~59.7% (approx meta). So the prescribed fix, shipped alone, would have left a false "no lifestyle drift detected" on the owner's live coach page and made the underlying number five orders of magnitude worse. The gating is still correct and still shipped; it is simply not sufficient on its own. **(Correction, 2026-08-11, O.20k:** the probe's first run carried a silent reconciliation-boundary bug — `keep({accountId, date})` passed a single object where `reconciliationTxnKeepFilter` returns a two-positional-arg closure — so every probe-computed magnitude above was tainted; the fixed probe confirms the **first-half median $10,604.95 → $0.08 exactly** and the refusal state, and supersedes the rest with the figures as written here; the old-rule growth figures (592%, ~153%) are not reproducible from the corrected probe and are quoted only as direction.)

**Decision (1) — a zero that is a refusal is named, and the card grows a third verdict.** `halfGrowth` returns 0 both for a genuinely flat series and when there is nothing to divide by, and every consumer read `flagged` as a BINARY over income: false rendered "Tracking income" / "no lifestyle drift detected" / "See the income in your activity". So a reader the app cannot measure was given a false all-clear. `CreepResult` now carries `incomeMeasured`, `spendMeasured` and the two first-half baselines; `flagged` requires both sides measured (a comparative claim cannot be made about an income the app cannot see); and `COACH_COPY.creepCard` composes title, body and link together in the engine, because a three-way rule in a `.tsx` cannot be locked by a test and those three must never disagree about which state the reader is in.

**Decision (2) — the refusal rule is self-referential, not a count of covered months, and not a threshold in dollars.** THE RULE: the first-half income median must be positive AND at least the first-half discretionary median. The argument is that this card compares exactly these two series — if the income visible over the baseline months is smaller than the discretionary spending it is being compared with, the app is not seeing the income that paid for that spending, so one side is incomplete and no ratio over it means anything.

The first implementation used COVERAGE — refuse when any window month carries no income row — and two independent fresh-context critics broke it from opposite sides, which is why it is recorded here as rejected rather than quietly replaced. It was **too weak**: `interest-income` is Income-group, so 8 cents of monthly savings interest satisfies a month count while the reader's payroll account is unlinked, and the card then asserted "income was flat" — the same fabrication class as the bug being fixed. And it was **too strong**: a median of three is unmoved by ONE missing month, so vetoing on a single gap silences a correct figure for an entire occupational population (anyone paid ten months a year has one gap in each half, both medians untouched). The median's robustness is the reason the rule must be about the BASELINE, not about attendance.

**Decision (3) — the refusal prints its inputs, never the figure it is refusing.** The body states the growth of the measured side only, then the two baselines verbatim ("$0.08 a month of income against $6,046.67 a month of discretionary spending"), then the likely cause without asserting it ("pay is landing somewhere the app isn't reading yet … not that you earned nothing"). A first draft printed the unmeasured side's growth too, which produced a card headed "Can't compare yet" opening with "Typical income grew ~6,249,900.0%" — a refusal that refutes itself.

**Decision (4) — the link label may not assert a definition its destination does not implement.** The refusal's control is the income register, but `matchesType(t, 'income')` is a SIGN filter (`!isTransfer && amountCents > 0`), not `isIncomeFlowRow` — so a credit this engine refuses still appears there. A label reading "Check what the app counts as income" would land the reader on the very row the sentence above calls "no income". It reads "See the money coming in on your activity" instead: the link describes what it opens, and the body carries the definition.

**Decision (5) — one growth figure, one verb, everywhere.** `growthPhrase` renders a figure with the verb matching its sign, because `flagged` is a difference and a spend figure that FELL can still flag (income falling faster) — which printed "grew ~-10.0%". An EXACT zero reads "was flat"; a ROUNDED zero (|bps| < 5, which `pct1` prints as "0.0%") reads "barely moved", because neither a direction nor a flatness claim is supported there. `reviewCreepSpending` was rewritten to take the whole result: it had taken the spend figure alone and hard-coded "while income is flat", a clause with no input behind it, printing beside a card that said income fell 50%.

**Decision (6) — the panel disclosure loses the clause the fix made false, and is not replaced by its inverse.** `creepPanelBasis` explained the gross bar by naming where the credit went ("counts as money in"), which is false the moment `isIncomeFlowRow` refuses it. It is NOT replaced by "it isn't counted as income either", which is false in the other direction for the other row the same branch catches: the branch triggers on the RESOLVED category (stored-or-pipeline) while the income accumulator reads the STORED one, so an UNCATEGORIZED credit the pipeline files to a discretionary category is still admitted as income (the F7 argument — an inflow the reader never labelled may be a deposit). The sentence now asserts only what holds for every row that reaches it: this figure is not reduced.

**Verification:** three fresh-context hostile critics (money/engine, copy honesty, wiring/test-validity), all three returning FAIL on the first pass — 2 P0 + 6 P1 between them, every one executed rather than argued. The wiring critic proved by MUTATION that the slice's original locks did not bind: a one-month refund fixture cannot move a three-month median, so both "fail-old" tests passed against the old engine. Every lock was rebuilt and the whole set re-proven by an eleven-mutation battery (each fix reverted in turn; all eleven now go red). Full gate + live record in STATUS.md §O.20g.

## #446 — O.20a: measured before deciding, and the measurement found a different, bigger bug than the one the row named (2026-08-11)

**Context:** TASKS O.20a: /reports prints one month's spending on two bases — the income/expense CHART (`monthlyFlows` → `countsInFlows`, insights.ts) and the "Spending by category" CARD (`spendingByCategory` → `isSpendRow`, reports.ts) — measured at $299.93 on the demo, with an existing disclosure sentence (`reports-view.tsx:407-414`) that deliberately names the DIRECTION of the gap and no mechanism, because a critic had already falsified "it's pending charges" in both directions. The row asked whether to unify the bases, give the card the chart's basis, or leave the disclosure. PROGRESS.md carried the row forward with a correction: "SEVEN divergences, not the five the row records."

**Decision (0) — measure first, per the row's own prescription and the O.20g precedent.** Wrote `scripts/audit-probes/o20a-reports-basis-gap.mts` (new, read-only, `.env.prod.tmp`/pg pattern): it calls the SHIPPED functions directly (`countsInFlows`, `isIncomeFlowRow`, `monthlyFlows`, `isSpendRow`, `spendingByCategory`, `spendRowCategoryId`, `spendContributionCents`, `spentSoFarWindow`, `wholeMonthWindow`) rather than re-deriving any rule, reproduces `reports-view.tsx`'s own `basisGapCents` formula exactly, and tags every divergent row against six source-traced mechanisms (R1 pending, R2 uncategorized→income, R3 refund-leaf, R4 income-group outflow, R5 transfer-leaf category, R6 the floor granularity mismatch — full definitions with file:line citations in the probe's docblock).

**The self-correction that happened before this was recorded:** a fresh-context Opus critic reviewed the probe against real source before any number here was trusted, and found a P0 — `reconciliationTxnKeepFilter` returns `(accountId, date) => boolean`, TWO positional arguments (`reconcile-boundary.ts:382-383`), and the first draft called it with a single object, which is a silent no-op (the object fails every `.get()` lookup keyed on it, both branches that need a real `date` never run, the closure falls through to `return true` for every row). Proven with a controlled fixture, not inferred. On this user's 27 active reconciliation links, that inflated three of six historical months by up to 4.6x. Fixed (one line: `keep(t.accountId, t.date)`), independently re-run, and the corrected numbers below reproduce the critic's own corrected table exactly. **The identical bug is inherited in `scripts/audit-probes/o20g-creep-income-refunds.mts:152` (#445) — filed as its own row (TASKS O.20k, this wave) rather than fixed here, since re-verifying O.20g's specific dollar figures against this account's reconciliation links is a separate investigation; O.20g's DIRECTION and its engine fix are not in question, only the probe-computed magnitudes ($10,604.95→$0.08, 592%→70,470,525%).** **RESOLVED 2026-08-11 (O.20k):** the one-line fix shipped and the probe re-ran — the first-half median **$10,604.95 → $0.08 reproduces exactly**; the other magnitudes were tainted and corrected (42 rows / $28,673.90 refused positives; shipped income growth 40,607,025.0%; spend growth ~59.7% approx meta) — full record in STATUS.md §O.20k. The critic also caught that `.mts` probes are invisible to `npx tsc --noEmit` (`tsconfig.json`'s `**/*.ts` glob does not match `.mts`; confirmed via `tsc --listFiles`, 13 `.ts` probes compile, none of the 32 `.mts` probes do) — this probe's own two latent type errors (a missing `currentBalanceCents` field, an overly-loose `discretionary: boolean | null`) were caught only by a manual `--project` check built for the purpose, and are fixed; the class itself is filed as its own row (Wave G).

**The measurement, corrected and independently reproduced twice (by the critic, then by this session against the fixed probe):**

The demo's $299.93 is **100% explained by R1 (pending) alone** — three rows (a $250.00 Zelle payment, a $43.18 Amazon charge, a $6.75 coffee charge; the exact seed rows at `src/lib/seed/build.ts:539-541`), and **every one of the six trailing COMPLETE months shows a $0.00 gap, to the penny** — the two bases agree perfectly once a month's charges finish posting. The demo is a clean, single-mechanism, textbook case of exactly the one rule the shipped disclosure's history already knew about.

The ONE real production user shows a completely different shape. The current month's on-screen gap is **$4,301.23** (48% of the smaller of the two figures). The trailing six complete months run **$1,286.72 to $10,039.57, every month, in both directions** — R1 (pending) **never fires once**; this user has zero PENDING rows in the entire snapshot. The dominant mechanisms instead:

- **R5 (transfer-leaf category), the largest driver in 5 of 7 months, in the thousands of dollars:** rows filed to `categoryId === 'transfer'` — Venmo payments, "AUTOMATIC PAYMENT - THANK[YOU]" card autopay, "Funds Transfer to Brokerage" — whose `isTransfer` BOOLEAN is `false` (confirmed by direct query), so `countsInFlows` (no category check at all) freely admits them into the chart's income/expense pool while `isSpendRow`'s explicit `categoryId !== 'transfer'` check excludes them from the card. Corpus-wide: **76 rows are `categoryId='transfer'` with `isTransfer=false`** (the leak) against **132 that are `transfer` with `isTransfer=true`** (correctly excluded by both).
- **R6 (the per-category floor), dominant in July:** a $7,792.97 row named "Overdraft Transfer from Brokerage -7383", also `isTransfer: false`, categorized to **Fees & Charges** rather than `transfer` — the categorizer guessed differently for the same underlying sweep depending on account/descriptor variant. Its size flips that category's net negative, so the card DROPS the whole category (real fee spend, if any existed that month, would vanish silently with it), while the chart nets the same row DOWN against the whole month like a refund. On 2026-07-06, eight rows share one account, one date, and the identical descriptor: **seven carry `isTransfer: true`, one — the $7,792.97 — carries `false`.**
- R3 (refund-leaf, Amazon returns filed to `refund`) is present every month and small ($6.52-$56.28) — the one mechanism that matches the row's original expectation in both size and shape.
- R2 and R4 never fire — confirmed against raw SQL as a fact about this corpus (zero `categoryId IS NULL` rows of any sign, zero negative Income-group rows), not a probe artifact; both remain structurally reachable.
- **The converse leak, invisible to this measurement BY CONSTRUCTION:** rows with `isTransfer=true` filed under 15 real spending categories — entertainment (5), rent (4), subscriptions (3), transport (3), fuel, internet, lawn-garden, home-services, auto-maintenance. `isTransfer=true` excludes a row from BOTH bases identically (`countsInFlows` on the flag alone; `isSpendRow`'s very first check), so a false-positive transfer match on real spending under-counts income/expense AND the card's category total together, with no gap between the two bases to surface it. Named here because a measurement built to find disagreements cannot see agreement on a shared wrong answer.

**Decision (1) — no basis change in O.20a itself.** The real driver is not "two reasonable definitions of spending disagreeing" — it is `isTransfer` sitting unreliably on rows that are unambiguously transfers, categorized inconsistently (`transfer` vs `Fees & Charges` vs, per the converse leak, ordinary spending categories) depending on account/descriptor variant. `countsInFlows` lacks the category-based transfer exclusion `isSpendRow` already has, and a naive one-line fix there is tempting, but `countsInFlows`/`isIncomeFlowRow`/`monthlyFlows` are shared well beyond /reports' chart: `/coach`'s savings rate and Money Review (`server/coach.ts:287`), Ask's income/expense answers (`server/assistant.ts:541`, `assistant/trace.ts:391,511`), and `glass-box/month-flow-breakdown.ts` (by design — it exists to track the divergence). A critic traced the specific change against O.20g's `detectLifestyleCreep` and confirmed it would be **unaffected** (a `transfer`-category row is never income nor discretionary, so it enters neither of that engine's accumulators today or after the change) — that surface is NOT a reason to hold back, contrary to this decision's first draft, and is corrected here rather than left standing. But three genuinely money-visible surfaces beyond /reports still are reasons: unifying either predicate here would silently move figures on pages this slice never critic-reviewed. Per `check-what-the-fix-breaks-before-what-it-fixes` and `a-link-on-a-figure-asserts-two-engines-agree`, that is not a safe drive-by. **The disclosure sentence stays exactly as shipped** — it already deliberately names no mechanism, and the measurement now proves that restraint was correct twice over: the demo and the one real account are dominated by entirely different mechanisms, and even within the real account the dominant mechanism changes month to month (R5 in five months, R6 in one).

**Decision (2) — the transfer-`isTransfer`-reliability finding is filed as its own task (TASKS O.20j), not bundled here.** It is a distinct, larger, higher-value bug than O.20a's basis question — it corrupts income, expense, and savings-rate figures on `/reports`, `/coach`, and `/ask` simultaneously, in both directions (leaks INTO spend totals via R5/R6, and disappears FROM them via the converse leak), and fixing it requires inventorying every `isTransfer`/`categoryId==='transfer'` consumer before either predicate changes — its own critic-gated slice, per this repo's established split discipline (O.20g → O.20i, O.20d-FU → O.20f/g/h).

**Verification:** no product code changed (a measurement + decision, not a fix). The probe is new (`scripts/audit-probes/o20a-reports-basis-gap.mts`), independently corrected after a fresh-context critic found and proved its P0, then re-run and its numbers reproduced exactly by this session. `bash scripts/verify.sh` run for the Definition of Done despite no `src/` diff (new script under `scripts/`); full gate + CI record in STATUS.md §O.20a.


## #447 — O.20f: the tap-target floor ships on all five O.20d controls, and each same-file P2's open choice is decided here (2026-08-11)

**Context:** TASKS O.20f (filed by the O.20d-FU critics' independent tap-target findings, plus six same-file P2s) — WCAG 2.2 AA 2.5.8, in the Definition of Done: none of the five O.20d controls carried the repo's own 44px `.tap-target` floor. The allocation segment's BUTTON was the 10px painted bar; the retirement strip gave up to 103 bars ~4.7px each. Routed to DeepSeek V4 Flash (UI, no money math) — the P2s were already prescribed by critics, but each left one implementation choice, recorded here rather than left in code comments alone.

**Decision (1) — the allocation LEGEND entries become the buttons; the bar stays a picture.** The task row prescribed it: the legend already carries symbol + swatch + percent + index, and a segment painted to its weight is rarely finger-sized (a 2% position draws ~2px — the affordance missing in miniature). The bar becomes `role="img"` with a composed aria-label naming every symbol and percent, so the data is not lost to sighted or screen-reader users; colors stay stable by segment index. The `investments-allocation` testid remains on the wrapper so the existing o20d-bars locator pattern (`[data-testid^="allocation-segment-"]`) still resolves the new legend buttons. The alternative — inflating the painted bar to a 44px floor — was rejected: it would misrepresent every small position's weight on the drawing.

**Decision (2) — the retirement strip scrolls (overflow-x-auto) with a 24px minimum bar width.** The task row prescribed `overflow-x-auto` + 24px (the WCAG floor); the bars keep their full 64px height, so a 24×64px target is still landable. The alternative (`.tap-target`'s 44px on every bar) would make the strip so wide that at 103 bars only ~7 fit on a 380px phone — the strip becomes unusable in the other direction.

**Decision (3) — constituents sort by NAME (accountId tiebreak), not signed balance.** The row offered "sort by name or signed balance". Name wins: it is stable against a reader re-filing a row (a balance-based sort would reorder the "Apr 30" and "Today" panels when a transaction changes a balance — the exact cross-panel comparison the sort exists to serve), and it reads as an address book rather than a ranked list. Sorting happens in the engine's final map so both surfaces get it by construction; Σ is order-invariant, so no figure can move.

**Decision (4) — the chip strip caps at the card's documented 18-month window, tail-sliced with the live point always last.** The row's "chart's useful window" = the card's own "18-month trend" framing; 18 pills already wrap to three rows on 380px. The cap binds only when the series outgrows it (the demo sits exactly at 18 — unchanged behavior). The chart still draws full history; only the tap affordance window narrows. A "show all" expansion was considered and rejected as scope creep: the chart itself is the full-history view.

**Decision (5) — the month-end basis derives from the date itself (`isMonthEnd`), keeping the `back === 0` snapshot.** The row offered "derive the wording or drop the redundant snapshot". Deriving is strictly better: dropping the snapshot would change the seeded dataset (snapshot count 162 → 153, every seed test/golden that counts snapshots, and the /accounts trend's current-month point for a non-default `--asOf` run). The composer now says "month-end balance on <date>" exactly when the date is a month-end, "balance on <date>" otherwise — and the seed's `back === 0` docblock documents the invocation (`--asOf 2026-05-15` + DEMO_TODAY 2026-06-10) that makes the mid-month case reachable. The known coupling is broken at the source: the sentence's safety no longer depends on a coincidence about what snapshot writers do.

**Decision (6) — the focus-restore hook is a shared `usePanelToggleFocus`, wired at all five call sites, e2e-locked per surface.** P2-d named four call sites (the O.20d-FU record); the creep chart is the fifth — the record's "four" predated its own list, and the hook lands there too. One hook instead of five inline refs because the unmount mechanism is identical everywhere and a shared implementation is testable in one place. The e2e asserts focus on the opener after an inner-Hide on every surface, not just one — wiring is per-component and a single assertion would let the other four regress silently.

**Verification:** full gate + e2e + CI record in STATUS.md §O.20f. No money math touched; the task row's Flash routing stands (the two percent-formatting P2s (a/b) are display formatting of engine-weights, decided on the rounded side and unit-locked; zero can only render "0" — a $0.00 position IS 0%).

## #448 — O.20b: the /reports payload measured — the rows are the feature, the dashboard was the only dead weight, and both "fixes" the row offered were falsified (2026-08-11)

**Context:** TASKS O.20b — `monthFlows` ships the transaction rows behind every bar of the income-vs-spending chart (six months at the default window), "unmeasured against a heavy real account". The row prescribed: measure first, then choose between a per-bar fetch (which would break the same-array guarantee) and trimming `rawDescriptor` from chart panels. Routed to DeepSeek V4 Flash as a measurement slice (no money math; the decision is payload size).

**The measurement** (new read-only probe `scripts/audit-probes/o20b-reports-payload.mts`, the o20a pattern: raw `pg` against production, the shipped engines composed exactly as `getReports` assembles them, merchant JOIN included because `registerDisplayName` decides label bytes — the one thing o20a did not need and byte fidelity does):

- **The one real user (the heavy account):** 2,498 spend rows. At the 6-month default: **payload 316.9 KB, of which monthFlows is 282.6 KB (89%)** — 1,415 rows across 12 bars, the largest single bar 305 rows. 12 months: 403.4 KB; 24 months: 508.7 KB (both shipped reader choices — `?months=`).
- **The one-month baseline** (the pre-feature shape the row's "~6×" refers to): 21.4 KB. The six-month carry measures **13.2×**, not ~6× — complete trailing months hold more rows than the asOf-clamped current month the baseline is drawn from.
- **Demo:** 49.9 KB at 6 months, 213 rows — the feature is cheap on the shared demo; the heavy account is the case that matters.

**Decision (1) — the per-bar fetch stays REJECTED, on the row's own framing.** Panels must reconcile against the painted bar; a re-query can sum to a different number than the figure the reader clicked (data can move between load and fetch). The measurement does not change that calculus — and it was never the leak: the payload is dominated by rows that ARE the feature.

**Decision (2) — the `rawDescriptor` trim is REJECTED, falsified by reading the consumer.** The row's "trimming rawDescriptor from chart panels is enough" assumed a spare field. It is a RENDERED line (`breakdown-panel.tsx:256-263` — "the bank's own text, when the payee name has cleaned it up … the line the question is actually about: it is what the categorizer read before deciding on this bucket"), present on **86% of the real user's rows (1,217/1,415)**, and already deduped at build (shipped only when it differs from the label). Trimming would delete a displayed feature to save 44.5 KB (14%). It is also the field the O.20 panels were built to show — the categorizer's input for the row it filed.

**Decision (3) — the six-month carry on /reports itself is KEPT.** The rows are the O.20 feature (the owner's "every single bar and collection of categories needs to be immediately available"); 316.9 KB is the cost of that page's reason for existing on the heaviest account. The 12/24-month sizes (403/509 KB) are recorded here so the owner has them; those windows were his explicit reader choices.

**Decision (4) — the measured dead weight was one caller: /dashboard pays 282.6 KB (89% of its reports payload) for rows no surface on the page renders.** `getReports`' only other caller (`dashboard/page.tsx:69`) reads exactly four fields — `breakdown`, `breakdowns`, `ym`, `notCountedYetCents` (TopSpendingCard's props) — and the landing page has paid the full six-month row carry on every load since the panels shipped. Fix, shipped this slice: `getReports(userId, months, { includeMonthFlows = false })`. One assembler stays ONE author for both callers — a second lean function would be a second copy of this composition, the exact drift shape the panels exist to prevent; the option skips only `buildMonthFlowBreakdowns` (the row assembly), `series` still ships as `months` (six headline objects, 0.4 KB). /reports always takes the default. The dashboard's figures are byte-identical by construction — same engines, same data, one boolean; locked by the anti-drift assertions (`lean.breakdown/window/breakdowns/notCountedYetCents` equal `full`'s), fail-old proven by mutation (deleting the opt-out turns the lock red at `expect(lean.monthFlows).toEqual({})`).

**Verification:** the probe type-checks clean under the one-off `.mts` `--project` check (the O.20k mechanism — a temp `tsconfig.probes.json`, deleted before commit; the full check surfaces 21 pre-existing errors across 11 other probes, all in the documented Wave G.2 class, untouched here). eslint 0 on every touched file; the parity suite is 25/25 including the two new locks. Full gate + CI record in STATUS.md §O.20b. No `prisma/` diff — the live Neon database is untouched.

## #449 — U.3: account clicks land somewhere true — the mortgage dead-end, its whole class, and one critic cycle (2026-08-11)

**Context:** Owner, verbatim: *"make app entirely cohesive from end to end all clicks should make sense. For instance, when i click on my mortgage in accounts, why does it bring me to a completely empty transaction page?"* The screenshot: `/transactions?account=<mortgageId>`, every control on its default, $0.00 tiles, "No transactions match these filters." The register's basis is `SPENDING_ACCOUNT_TYPES` (#62), so 8 of the 11 account types linked from /accounts to a page empty BY CONSTRUCTION, the dropdown (built from rows-present) could not display the active filter, and the empty state prescribed a remedy — change the controls — that provably cannot work.

**Decisions:**

1. **Where a row's click goes is ONE author over the register's own type set** — new `accountRowDestination` imports `SPENDING_ACCOUNT_TYPES` rather than restating it (a-guard-must-read-what-it-guards): spending → `/transactions?account=`, INVESTMENT → `/investments?account=` (#159 kept), everything else — LOAN, MORTGAGE, REAL_ESTATE, VEHICLE, CASH, OTHER_* — expands an **in-place detail panel** on /accounts. In place, not a new `/accounts/[id]` route: the owner's documented gesture preference is expand-in-place (a-repeated-request-is-about-the-gesture), and a route would re-open the O.16 back-link fidelity class for no added content.
2. **The expand state is the URL** (`/accounts?detail=<id>`, server-rendered, `scroll:false`): reload-safe, back-button collapses, e2e-trivial, and only the OPEN account's history is serialized to the client (the O.20b dead-weight rule — the DB already reads every snapshot for the trend; the client payload is what the lazy load protects).
3. **The panel renders only facts the app holds:** the account's net-worth role, loan terms when the feed supplied them (`aprBps`/`minimumPaymentCents`/`dueDayOfMonth` — all three on the demo Auto Loan, typically absent on SimpleFIN), and recorded `BalanceSnapshot` history painted with the row's own liability sign. **Only the seed writes snapshots today**, so a live account truthfully renders "No balance history recorded" — the copy promises no history no writer produces, and **TASKS U.4** (snapshot writer at sync time, all account types) is queued as its own data-write slice rather than folded in. The recurring-payment linkage was deliberately EXCLUDED: `RecurringSeriesResult.accountId` is the account the charges POST on (the checking account), not the liability being paid down — wiring it in would have been the subagent-hypothesis-as-fact failure.
4. **The register answers `?account=` it cannot show by naming WHICH zero** (`registerEmptyReason`, decided ABOVE the window branches — the set is empty whatever the dates): `account-not-here` (with a type discriminator: a spending TYPE wearing not-here can only mean the #135 currency guard, so the copy says currency, never the self-contradiction), `account-empty` (in-basis, zero rows — the same dead end one type-class over), `account-unknown` ("isn't one of your own" — deletion is a cause the page cannot establish, and a partner's id lands here too). The count line names the account zeros beside the $0.00 tiles (the K.3/F2 rule extended).
5. **The account dropdown lists the FILTERABLE SET** (Account table through `registerAccountWhere`, one author with the row query): zero-row spending accounts included (their register view now names itself), active superseded predecessors excluded on the same basis /transactions/new, /rules and /import already use. An active filter the options don't hold is **injected into the select itself** — one control per axis; a separate chip (the first draft) would have left the select painting "All accounts" over an active filter and made "All accounts" a silent no-op escape.
6. **The standing copy stops overclaiming:** /transactions unfiltered greeting and nav description now say "spending accounts"; /accounts subtitle and nav description say "Tap an account to open it" — true of every row, because **manual rows open too** (critic P1: `MANUAL_LIABILITY_TYPES` includes MORTGAGE and the Add-liability placeholder is literally "e.g. Mortgage" — a hand-added mortgage is this app's modal mortgage). One override there: a manual INVESTMENT opens the panel, never `/investments`, whose scope silently falls back to the whole portfolio for an account with no holdings (#160); the not-here INVESTMENT empty state likewise claims "holdings for investment accounts live on Investments", not "ITS holdings".
7. **Critic cycle (fresh-context, adversarial): 4 P1 / 8 P2, all executed** — manual rows (P1#1), account-empty kind (P1#2), the real-user panel lock (P1#3 — unit render of the no-snapshot no-facts shape + a throwaway-signup e2e driving a hand-added mortgage), server-level authz locks (P1#4 — a stranger's account id resolves 'unknown'/null; delete `userId` from either where and they go red), currency discriminator (#5), injected option (#6), count-line zeros (#7), superseded predecessors + the stale reconciliation comment (#8), the possessive holdings claim (#9), the softened unknown copy (#10), the corrected lazy-load rationale (#11), `aria-controls` + panel `id` (#12). The panel moved to its own module (`account-detail-panel.tsx`) so the P1#3 lock could render it without accounts-list's server-action import graph.

**Falsifiable claims → locks:** register links ⊆ the register's own type set (`account-row-destination.test.ts`, asserted against the import); precedence + all five account-axis engine outcomes (`register-empty-reason.test.ts`); select-truth + every new empty-state sentence (`register-merchant-filter-render.test.tsx`); the real-user panel shape + liability sign (`account-detail-panel.test.tsx`); authz + dropdown membership (`register-account-filter-server.test.ts`); the three journeys in the browser (`no-dead-ends.spec.ts`: demo loan expands, hand-added mortgage expands with the real-user shape, zero-row card names its own zero, deep link names the account in the select with a live escape).

## #450 — U.4: a live account gets balance history, and the shape of that history is decided by what reads it (2026-08-12)

**Context:** U.3 shipped the /accounts detail panel and it truthfully read *"No balance history recorded"* for every real account forever, because **only `prisma/seed.ts` had ever written a `BalanceSnapshot` row** — no Plaid or SimpleFIN path did. The task row asked for a writer at sync time, "one row per account per calendar month, month-end or first-sync-of-month basis decided in the slice".

**Decisions:**

1. **The unit of work is the USER, not the provider sync — and this is a money decision, not a tidiness one.** `netWorthSeries` sums a date BUCKET, so a bucket missing an account is not a shorter list, it is an understated net-worth figure rendered on /dashboard and /accounts. A per-provider writer would stamp SimpleFIN accounts on one date and Plaid accounts on another (on the owner's live corpus, 25 accounts against 13), making every historical point a partial sum. Worse, `reconcile-boundary.keepsSnapshot` de-duplicates a reconciled pair ONLY on an exact-date collision, and a reconciled pair here is cross-provider by definition (a SimpleFIN account re-linked through Plaid) — different dates would defeat the shipped de-duplication and count one real account twice. So: one pass per user, one date, every account. Locked by `networth-snapshot-plan.test.ts`, whose FAIL-OLD case runs the two accounts through the real boundary on split dates and shows the double presence.
2. **Every account, including manual rows and quiet feeds.** The live "today" point sums them all, and an account with `feedDroppedAt` keeps counting everywhere by documented decision (L.14). Recording only what a sync refreshed would drop a hand-added mortgage — U.3's own case — and every frozen liability from all history, making the past look BETTER than it was.
3. **The date is the day the balance was read, never a synthesized month-end.** A month-end stamp would either write a future-dated row (invisible until the month closes, then asserting as month-end a figure observed weeks earlier) or force the row to be rewritten all month. `netWorthPointBasis` already derives its wording from the date (O.20f P2-g), so a mid-month row reads "balance on <date>". The schema comment that defined the model as month-end — the definition every later writer would have read — is corrected.
4. **Triggered from the nightly cron AND both sync actions.** The cron reaches every user, including one with no connected bank (`AutoSync` is gated on a live connection). The writer is idempotent within the month and demo-fenced BY CONSTRUCTION inside itself, so extra triggers cost one indexed read and a missed trigger costs at most a month's row — never a wrong figure.

**What the two fresh-context critics changed (1 P0 + 7 P1 across two lenses, all executed):**

- **P0 — a frozen feed's carried-forward rows were printed as dated observations.** U.4 records a quiet account monthly (decision 2), so its panel filled with identical dated figures **directly beneath** the amber note saying the bank stopped sharing it and the balance "has not changed since". A monthly column of identical readings is evidence the app has been checking all along — the inverse of the truth, in the reassuring direction. Fixed by carrying `feedDroppedAt` into `AccountDetailView` and marking each row after it "carried forward", plus a note naming the last date anything was actually read. The fact rides the ROW, not a sentence elsewhere on the page.
- **P1 — the delta under the net-worth headline compared two points built from DIFFERENT account sets.** Pre-U.4 a live user had one point, so `prev` was null and the figure never rendered; this slice brought it into existence. Sign up Jun 3 with checking+savings, type the mortgage on Jun 20 into a month the writer has already claimed, and the subtraction prints **−$251,200.00**; reverse the arrival order and it prints **+$50,000.00 in green**. Replaced the label helper with `netWorthDelta`, which compares the constituent sets already carried out of the same loop and, when they differ, returns no figure and names the reason ("No comparison — 1 account joined since …"). Deleting an account cascades its snapshots and lands in the same branch.
- **P1 — copy that asserted a shape or a completeness the code no longer had:** the chart footnote ("Trend uses month-end balances across all accounts" — replaced by ONE shared positive admission rule now rendered on BOTH surfaces, /accounts previously having none at all), the drilldown's "sum of every account's balance" (a point can be missing an account the next line already admits), the live basis's "not a month-end snapshot", the "vs last month-end" delta label (now claimed only for a month-end that is the immediately preceding month — a cron-only user can carry a gap), and **the Net Worth PDF's "Trend (month-end)" heading**, the one artifact that leaves the app and is handed to a third party.
- **P2 — both trend reads were unwindowed** and now grow ~accounts × 12 rows a year into the page payload (the O.20b dead-weight class). Bounded to 19 months, one more than the 18 points the chip strip renders, so nothing a reader can reach is dropped.

**Recorded, not fixed (their own rows):** **U.5** — the detail panel reads snapshots RAW while the trend reads them through the reconciliation boundary, so a reconciled pair's panel can name a balance the chart does not count. **U.6** — `netWorthSeries` signs a stored row by the account's CURRENT, mutable `type`, and both providers rewrite `type` on every sync, so a reclassification across the asset/liability line retroactively flips the sign of history already recorded.

**Verification:** `bash scripts/verify.sh` green on the shipped tree; three sabotage proofs, each reverted (a "snapshot only what the feed refreshed" writer turns the completeness lock red; a same-day-only guard turns the calendar-month lock red; deleting the cron's call turns the wiring lock red). Full `VERIFY_E2E=1` result and the CI conclusion are recorded in STATUS.md §U.4. The `prisma/` diff is a COMMENT ONLY — no column, index, or constraint changed.

## #451 — U.6: a recorded balance keeps the class it was read under, and the guess we chose not to write down (2026-08-12)

**Context:** U.4's data-integrity critic found that `BalanceSnapshot` stored only a magnitude, and whether it ADDED to or SUBTRACTED from net worth was decided at read time from the account's CURRENT `Account.type` — which this repo states in its own code (`reconcile-boundary.ts`) that both providers rewrite on every ordinary sync. One reclassification across the asset/liability line therefore rewrote the sign of every past point for that account, silently. The task row prescribed either storing the liability sense on the row or pinning the sign in the planner, and preferred the schema change.

**Decisions:**

1. **Store the observed TYPE, not the derived sign.** `isLiabilityType` stays the single sign author, applied to the row's own recorded value. Pinning a boolean would freeze the app's classification RULE into every stored row, so a later correction to that rule — a type wrongly classed as an asset — could never reach history. What must not change under the app's feet is the observed fact; classifying it is the app's own job to get right, and a bug fix there should reach the past. Storing the type costs the same and keeps the historical class available to any future reader.
2. **A stored balance's SIGN cannot be read backwards to recover its class**, so the class is carried explicitly on every `NetWorthConstituent`. Verified rather than assumed: `simplefin-map.ts` `abs()`es a liability, while `plaid-map.ts` keeps the provider's sign (negative for an overpaid card or an overdrawn account), and an overdrawn checking or a margin account is a genuinely negative ASSET. The cheap "negative means liability" heuristic this slice was about to use is unsound in both directions.
3. **Making history truthful CREATES a disagreement the old code could not produce**, and this slice owns it: two points covering the same accounts, counted under different classes. Pre-U.6 a reclassification re-signed both points together — history was wrong but the subtraction between two equally-wrong points still came out clean. `netWorthDelta` now refuses and names it, the same rule U.4 established for a changed account SET, one level down.
4. **The pre-U.6 rows are deliberately NOT backfilled — this is the decision the critics changed.** The slice shipped a backfill script, verified against a scratch database (36 rows filled, 0 remaining, idempotent on rerun). Both critics attacked it and one demonstrated why it was wrong: a backfill can only copy the class an account carries TODAY, every surface renders a non-null value as an OBSERVATION ("counted as checking"), and for an account reclassified BEFORE U.6 it stamps the wrong class permanently and unmarkably. The critic executed the difference through the real engine — a $40,000.00 swing — and named the property that settles it: **an un-backfilled NULL row SELF-HEALS when a misclassification is corrected, because it is re-signed by the corrected type; a stamped row never can.** NULL is the only evidence the app has that it does not know, and converting it into an assertion indistinguishable from an observation is what `a-zero-is-a-claim` forbids. The script was deleted, not fixed. (It was also, as shipped, unable to run against Neon at all — the generated client is built from the sqlite schema — and with `DATABASE_URL` unset it would have silently targeted the local dev database while reporting success.)
5. **The engine's new field is REQUIRED, not optional.** A caller's `select` could otherwise drop `accountType: true` and revert that surface to signing history by the current type, with `tsc` clean and every test green. A caller must SAY null; it cannot omit the question.

**What the two fresh-context critics changed (3 P0 + 11 P1 across two lenses, all executed):**

- **P0 — the panel's note asserted an absolute the same slice's fallback falsifies.** "Your net worth trend counts every balance the way it was recorded" is false for a NULL row, which is counted by what the account is today — and the note rendered exactly where NULL rows are most likely mis-signed. This is the `every account` overclaim `netWorthPointBasis` was rewritten to avoid, re-introduced two files away. The absolute is gone, and rows with no recorded class are named — but only beside a known reclassification, since every live account's rows are NULL until U.6 has been deployed a month, and an unconditional note would fire on essentially every real panel: note-blindness that hides the ones that matter.
- **P0 — "carried forward" and "recorded" asserted opposite things about the same rows.** The note counted carried-forward rows as balances that "were read", four lines under the note saying nothing had been read since a date. The count now covers only rows the app actually read; the row keeps its marker, because its SIGN still needs explaining.
- **P1 — the copy stated as fact a classification the app cannot validate.** A feed that re-classes an account may be CORRECTING itself, so "money you owned at the time" asserts the very thing in doubt, and the panel's own top line said "money you owe" six lines above. The note now says what Aimplifi DID and names who could settle it. There is no control anywhere to change an existing account's type, so it points at no remedy that does not exist.
- **P1 — a false refusal that deletes a true figure.** `netWorthDelta` refused over ANY class change, including a paid-off card at $0.00 that a feed moved CREDIT → OTHER_ASSET, throwing away a correct +$2,000.00 and handing the reader a warning instead. The distorting term is exactly 2 × the PREVIOUS balance, so at $0.00 there is nothing to distort; the guard now asks whether the change MOVES the figure.
- **P1 — the cliff nobody explains.** Both delta call sites compare only `trend[len-2]` vs `trend[len-1]`, so a reclassification further back refuses nothing while the chart carries a permanent step of twice the balance. `NET_WORTH_TREND_BASIS` named ONE reason a point can differ (a missing account); U.6 created a second and the sentence now names it — opening a gap grows the disclosure that enumerates them, the inverse of the closing-a-gap lesson.
- **P1 — the fact was carried all the way to the render and dropped there.** The trend drilldown mapped `label: c.name` and ignored `isLiability`, so a credit card appeared positive inside a sum whose basis sentence calls it "assets minus liabilities". The live point already carries every account's CURRENT class, so the disagreement is nameable with no new prop and no second query.
- **P1 — the exported PDF signs its account list by the current class and its trend by the recorded one**, in the one artifact handed to a lender with no way to correct itself. The trend rows are the U.6-correct half; the divergence is real and is carried into the residuals rather than papered over.
- **P2s executed:** two adjacent markers concatenating into one token for a screen reader ("carried forwardrecorded as checking"), `text-amber-500` at `text-xs` replaced with the repo's own compliant `amber-600 dark:amber-400`, an unrecognised type rendering a raw enum at the reader, `''` treated as absence alongside null (the column is free-text that raw SQL writes — the e2e does), duplicate constituents counted as distinct accounts where the sibling checks use Sets, and the slice's own e2e rewritten rather than left to ratify the copy it asserted.

**Residuals, split out rather than papered over:** **U.7** — a reconciled pair's collision winner now decides that date's sign (**CLOSED 2026-08-15, #474 — measured and refused**). **U.8** — the detail panel, the only per-row explanation, never renders for CHECKING/SAVINGS/CREDIT accounts, which are the likelier reclassification targets; the drilldown marker is the mitigation and is locked for every account in the trend (**SHIPPED 2026-08-15, #473**).

**Verification:** `bash scripts/verify.sh` green. Five sabotage proofs, each reverted (the series sign rule reddens 2 locks; the delta refusal 2; the panel's per-row sign 1; the drilldown marker 1). The `prisma/` diff is ONE nullable column plus comments — `prisma db push` adding it destroys nothing, and until a sync writes new rows every NULL reads byte-identically to pre-U.6. Demo/golden output is unchanged by construction: seeded types never move, so every seeded sign is what it was.

## #452 — U.5: the panel and the chart are decided by ONE engine, and the input set is part of that engine (2026-08-12)

**Context:** U.4's data-integrity critic recorded that `getAccountDetail` read `BalanceSnapshot` RAW while the net-worth trend on the SAME page read it through `applyReconciliationBoundary`, so a combined pair's panel could name a balance the chart does not count. U.4 writes both sides of a combined pair at ONE date — the property that lets the boundary de-duplicate them — so the collision is monthly and permanent, not exotic.

**Decisions:**

1. **The reachability filed in the task row was wrong, and checking it first changed the whole slice.** The row's example was the PREDECESSOR's panel; `filterGroup` folds a superseded predecessor out of both account groups and the panel renders only for a row in a group, so `?detail=<predecessorId>` renders nothing. Its currency clause is unreachable for the same reason (`getAccountsView` builds rows from the currency-supported set alone). Both were verified by reading the gates, not inferred. The defect is real on the SUCCESSOR's panel — a live row whose own snapshots are dropped for every date on or before the cutover — so that is what was built and locked. A fix aimed at the row as filed would have been a dead branch with a passing test.

2. **Show the dropped row, marked — never hide it, never let it claim counting.** Hiding it would delete a balance the bank really did send for this account; printing it unmarked was the defect. Which rows are dropped is decided by the trend's own boundary, called with the same account set and the same currency withhold, so the panel and the chart cannot disagree by construction (the #274 precedent, applied to the last read that still bypassed it).

3. **The counted balance rides the ROW, not the note.** Each dropped date has its own counterpart figure — the two sides of a combined pair disagree, which is why one has to win — so one sentence covering several dates would either pick a figure wrong for the others or state none. This also removed an aggregation that could name one date's owner for another's, and made a chain's unnameable case a per-row null instead of a whole-panel one.

4. **THE P0, and it was introduced by an optimisation, not by the original bug.** Scoping the boundary's snapshot input to the account's DIRECT counterparts is wrong because `keepsSnapshot` walks `upstreamsOf`/`downstreamsOf` TRANSITIVELY: in a chain A->B->C a row of C's can be dropped in favour of A's, and the truncated input hid A, returning a wrong verdict AND a wrong counterpart figure. The input is now every account in an effective link plus self — exactly the `linkedIds` set the boundary builds internally. Reusing an engine is not enough; the input set is part of the algorithm, and narrowing it re-implements the traversal by accident.

5. **A row's SIGN is not a counting claim.** The first fix gated the U.6 class marker on `countsInNetWorth`, which left a positive figure inside a liability account's history with no explanation — re-opening the exact defect U.6 shipped to close. The marker stays on an uncounted row and says "recorded as" rather than "counted as". The slice's own test had asserted the deletion, so the lock ratified the defect: a test written from the fix, not from the behaviour.

6. **An account the currency guard withholds gets `null`, not a verdict.** It is in no net-worth figure at all and its panel cannot render, so `true` claims a counting that never happens and `false` gets explained by a combine that never happened — both were written and both were caught. The view describes accounts this page counts; for one it does not, the honest answer is the one a stale or foreign id already gets.

7. **The copy is a pure module (`balance-history-view.ts`), following `feed-dropped-view.ts`.** The inline draft shipped a singular/plural defect in the branch the component test did not cover, which is the repo's own stated reason for the rule.

8. **Two disclosures that state the rule were corrected with it.** `NET_WORTH_TREND_BASIS` and `netWorthPointBasis` claimed the only account missing from a point is one with no balance for that date; the reconciliation drop is the exclusion that sentence excluded. The reconciliation cards' "only ever count the live one" / "Counted once, on the live connection" are false for every date on or before the cutover, where the boundary counts the RETIRED side — corrected to counted once PER DATE. U.6's clauses in the shared sentence survive verbatim, asserted in the live check.

**Residuals, split out rather than papered over:** **U.9** — sibling predecessors (two stale rows continued onto ONE live account) are de-duplicated against the successor but never against each other; a critic reproduced one $5,000 account counting as $10,000 on every date on or before both cutovers. Pre-existing in the Wave 4.6 boundary and money-visible. **U.10** — a snapshot dated exactly today is marked counted while `netWorthSeries` replaces today's bucket with live balances. Plus: `getAccountDetail` re-reads accounts and links that `getAccountsView` already loaded on the same request.

**Verification:** `bash scripts/verify.sh` green — tsc 0 / eslint 0 / 6,831 unit + 1 skipped / 417 files / build clean. Six sabotage proofs, each reverted (the raw read reddens 3 server locks; the direct-counterparts input reddens the chain lock; deleting the class marker from uncounted rows reddens 1; widening either note's count reddens 1 each). No `prisma/` diff — read-path only.


## #453 — U.9: a link's "same account" claim is transitive, so the unit of de-duplication is the component (2026-08-12)

**Context:** the U.5 money critic reproduced, and STATUS recorded rather than fixed, a double-count in the net-worth trend: two stale rows continued onto ONE live account (the shape `AccountReconciliation.successorAccountId`'s non-uniqueness exists for — "one live account may supersede more than one old row", schema line 285) both survived every date on or before both cutovers, so one real $5,000.00 savings account contributed $10,000.00. Pre-existing in the Wave 4.6 boundary, money-visible, and it falsified U.5's own panel note on the same screen.

**Decisions:**

1. **The component, not the chain, is the unit.** `keepsSnapshot` decided collisions by walking `upstreamsOf` and `downstreamsOf`. Siblings are neither to each other, so each was compared against the successor — which it correctly beat — and never against its twin. But a link asserts "these two rows are the same real account", and that assertion is TRANSITIVE: `s1` ≡ `live` and `s2` ≡ `live` gives `s1` ≡ `s2`. Any rule expressed as two directional walks silently excludes every node that is *related but not ordered*. Exactly one snapshot now survives per (connected component, date). The statements rule (A-F6) had already hit this exact blind spot and solved it locally for its own case; nothing generalised it, so three other rules kept it.

2. **Chosen only among rows that EXIST on the date.** A snapshot is a STOCK: one account has at most one balance on a date, so a second row for that date is *provably* a duplicate. But dropping a row nothing else covers would put a hole in the trend where the app genuinely has a reading, so the winner is picked from the rows present, never from the accounts present. Verified exhaustively rather than argued: `scripts/audit-probes/u9-component-invariant.mts` enumerates every link shape over 4 accounts × every snapshot-presence subset (210,120 cases) and finds zero dates with two survivors, zero with none, and zero order-dependence — grouping by UNION-FIND over the undirected edges, which shares no logic with the engine. A critic ran a wider 750,000-case sweep to the same conclusion. The probe is also confirmed DISCRIMINATING: against the pre-fix engine it reports 43,648 violations.

3. **THE P0, found INDEPENDENTLY BY BOTH CRITICS, was in the tiebreak.** Ranking went tier → cutover → account id. When a chain's two cutovers are EQUAL the mid-chain account's ownership window `(cut..cut]` is empty, so the upstream owns the date outright — but the comparator had no notion of chain position and fell through to the id, handing the date to whichever cuid sorted first. Measured on identical data: a $4,000.00 point or a $9,000.00 point depending only on the ids. Reachable, not crafted — the confirm action refuses only a *strictly earlier* downstream cutover, the read-time monotonicity backstop likewise passes equality, and `handoverDate` returns today for a successor with no transactions, so two same-day combines produce it. `depth` (links to the terminal) now breaks the tie before the id: greater depth wins before a cutover, lesser after, and the id decides only true siblings, which are symmetric and offer no fact to prefer one by. **A tiebreak inside a money rule is part of the rule** — ranking by an identifier the user cannot see makes the figure nondeterministic across users holding identical data.

4. **The probe that "proved" the fix could not have caught its own P0.** It asserted cardinality (one survivor, never zero) and order-independence, never WHICH row wins — so it reported HOLDS on the equal-cutover shape. Recorded because the lesson generalises: an invariant probe is only as strong as the property it names, and "exactly one survived" is strictly weaker than "the right one survived". Every pre-existing chain fixture also used distinct cutovers, so no test could see it either.

5. **A guard the fix made load-bearing was still borrowed from the schema.** The component key is `remapToTerminal`, whose soundness needs out-degree <= 1. `predecessorAccountId @unique` provides that, and `chainMaps` builds `succOf` with `new Map`, so a forked predecessor would silently let the LAST edge win while the other successor keyed its own component — two survivors for one account, the same defect through another door. This file already re-checks cycles and monotonicity at read time although both are refused at write time; out-degree was the only invariant left borrowed, and it is now guarded with the same failure direction (inert — everything counts fully).

6. **The transaction half was measured and deliberately NOT fixed (filed as U.11).** The identical sibling blind spot makes one real −$50.00 purchase contribute −$100.00 to every spending surface. It is not fixed here because the snapshot rule is fixable with a proof and the transaction rule is not: a transaction is a FLOW, two $50.00 charges on one day are ordinary, so same-date presence establishes nothing, and de-duplicating by CLAIM SPAN instead would silently delete a row only one feed ever saw — inverting this engine's stated failure direction (a visible, advisory-covered double, never a silent loss). That choice needs its own evidence and its own critic. The test is written as `it.fails` asserting the CORRECT number, not as a characterization asserting the wrong one, so that fixing U.11 turns it into an unexpected pass and forces someone back to it.

7. **Copy: a disclosure inherits the scope of the rule it explains, and the sweep must leave the file you already opened.** The panel note was four wrong claims in one sentence (a pair that "both recorded"; a singular "another one" and "The combination" where a live account may continue several; a dangling "one of them" whose nearest antecedent was the *uncounted* balances; and an unqualified "the same ACCOUNT is not counted twice" that certifies spending, which U.11 measures as still double). The first repair then overshot into a modal — "more than one row CAN describe" — answering a question about an event with a statement of possibility. Beyond that file: the trend drilldown still said "a pair you have combined" on the surface that shows the money, the combine card promised "a date is never counted twice", and the assistant's fold note read "X and Y **was** combined". One causal correction to the record: the "both sides" clause was ALREADY false for chains when U.5 shipped — U.9 widened the rule and added the sibling shape but did not create that defect, and the first draft of the ledger row wrongly said it did.

**Residuals, split out rather than papered over:** **U.11** (transactions, above) and **U.12** — the winner is ranked by cutover alone, so a quiet feed's carried-forward REPEAT can outrank another record's genuine reading for the same date; `feedDroppedAt` already travels one layer up and the ranking ignores it. **Closed as #469 / U.12** (covering-tier genuineness). Leftovers of that scope filed as **U.37**.

**Verification:** `bash scripts/verify.sh` green; the 210,120-case invariant probe (discriminating — 43,648 violations pre-fix); a sabotage proof reverting only the engine, reddening all three real-Prisma sibling locks; `tests/unit/account-detail-reconciled.test.ts` › SIBLINGS asserting the trend's own constituents through real Prisma; and `scripts/u9-live-deploy-check.mjs`, which declares outright that it CANNOT discriminate this deployment (the demo seed writes no reconciliation rows, so no combined pair can render) and asserts only the R8 golden path that must not move. No `prisma/` diff — read-path only.

## #454 — U.13: no side owns the handover day, because the handover happens inside it (2026-08-12)

**Context:** U.11's measurement session filed U.13 as a MEASURED silent loss: replaying the shipped `reconciliationTxnKeepFilter` over the owner's real corpus, of 709 rows the R1 rule drops, 706 were true duplicates and one was a genuine +$2,086.40 "Deposit Mobile Banking" on Investor Checking, dated exactly the cutover, which no surviving row replaced — gone from the register, budgets, reports AND the tax export. Independently confirmed with the engine out of the way (`u11i`): the retired Schwab feed's LAST day IS the cutover 2026-07-21 and it reported one row that day (−$11.00 Venmo); the live Plaid feed reported that same Venmo AND the deposit; the retired side holds no row of that amount on any date. This violates the direction the file states about itself at `reconcile-boundary.ts` ("a visible, advisory-covered double, never a silent loss").

**Decisions:**

1. **The invariant was the defect, not a missing case.** R1 said "exactly one side owns each date — no overlap, no gap", and that is unachievable at day granularity. A handover is an instant INSIDE a day: the retiring feed stops partway through while the live one covers all of it, and every business date in this app is a calendar date with no time component. So neither side's silence on that day proves anything, and any whole-day award deletes whatever only the other side saw. The claim span is now half-open at BOTH ends — `[first, min(cutover, last))` — and the handover day is released to both sides. One character of code; the argument is the deliverable.

2. **Both directions were measured, not argued, and the obvious alternative is far worse.** `u13a-where-the-loss-lives.mts` and `u13b-the-boundary-day-itself.mts`, read-only against production: predecessor-owns (what shipped) silently loses **1 row / $2,086.40**; successor-owns — the fix the shape suggests, since the live feed is the one still reporting — would silently lose **24 rows / $25,574.13**, because 8 links have a successor that reported NOTHING on the handover day while the retired feed posted its final trades (12 of them on one Schwab community-property account). Releasing the day to both loses nothing and costs **9 rows / $374.40** of visible duplication. Ten times the money rides on the direction that looks obvious.

3. **The task row's prescribed fix was refused on evidence, and could not have been built as written.** The row prescribed "drop a row only when a counterpart is PROVEN on the claiming side — exact |amount| with a ±3-day tolerance". Measured (`u13a`): with a ±1-day tolerance the corpus has **zero** mid-span losses — the two other rows u11c flagged (PGA TOUR SUPERSTORE, DICK'S) are true duplicates the two feeds posted a day apart, an artifact of the exact-date test, not a loss. Every real loss is on the handover day, so the counterpart machinery addresses a problem the data does not have. It is also not expressible where the rule lives: `reconciliationTxnKeepFilter` returns an `(accountId, date)` predicate with ~20 call sites across 13 files, several of which apply it to WINDOWED row sets that do not contain the claiming side's rows at all — so an amount-matching rule would have to be handed every caller's full predecessor history and would answer differently per surface (`docs/lessons/one-question-one-basis-and-the-invariant-sets-the-scope.md`). A span change stays one rule with one answer.

4. **A refinement was measured and rejected.** Release the day only when the predecessor's claim end IS its last reported date — i.e. the feed demonstrably stopped there — rather than always. On all 9 real cases those two dates coincide, because the cutover is derived from the handover, so it avoided zero duplicates and bought a second branch plus a weaker soundness argument ("the feed was alive, so it saw everything").

5. **The overlap is bounded, and sibling composition still de-duplicates.** Every date strictly inside a claim still drops, so the doubling is at most one day per predecessor. Measured directly (`u13c-which-rows-moved.mts`): of the 10 successor rows sitting on a boundary day, 9 are now kept and **1 is still correctly dropped** — a $111.99 Chase autopay that is one predecessor's handover day but sits STRICTLY INSIDE a sibling predecessor's claim. That reconciles the observed count change exactly (kept 1517 → 1526).

6. **Copy owns the trade it creates.** A visible double is only acceptable if it is actually visible AND explained. The combine card's outcome promised the old copies "stop being counted twice" and the span disclosure said records are kept "through {claimEnd}" and "replace anything re-imported" inside that window — both now false on exactly one day. Each is qualified where it is rendered, in the app's own register (no jargon, the reason stated, and the fact that it is deliberate rather than a bug).

**Verification:** fail-old proven by reverting the single comparison — `test_regression__u13_handover_day_never_silently_drops_a_row` goes red on the deposit assertion, the row absent from the output entirely. The R1 union test was rewritten to lock the NEW invariant and is stronger than the one it replaced: no gap ever (every input date survives somewhere) plus the doubled date set equals exactly `['2026-06-30']`, which would catch a release that widened past the handover day. Production replay after the change: the $2,086.40 row is kept, silent loss on the corpus goes to zero (the 2 remaining u11c flags are the ±1-day duplicates of decision 3).

## #455 — U.16: the panel that certifies a figure must disclose the one thing it cannot see (2026-08-12)

**Context:** U.13 (#454) released the single handover day between a retired feed and the live one that replaced it to BOTH sides, because a handover is an instant inside a day and a business date here carries no time. That is a deliberate, measured over-count — releasing the day loses nothing where either whole-day award silently lost real money — and its stated price was "9 rows / $374.40 of VISIBLE duplication". The visibility was the part that did not exist. Every spending surface counted those rows in silence, and the glass-box drilldown did worse than stay quiet: it listed both copies of one charge and printed "matched to the penny" underneath, which a reader who opened the panel to AUDIT the figure reads as confirmation that both belong. `BREAKDOWN_BASIS` stayed literally true throughout — both rows are counted, and the panel does list both — which is exactly why silence was not survivable. The repo had already answered this shape once for card payments (`cardDuplicateTraceBasis`, whose own comment says "two rows for one card therefore read as CONFIRMATION"); there was no handover-day equivalent. Filed by the U.13 rendered-claims critic as P1-6, with its evidence.

**Decisions:**

1. **The sweep is defined by "which figures can contain this?", never by the ticket's list.** The task row named the glass-box drilldown, /reports, /budgets and Ask. Making `onHandoverDay` a REQUIRED field on `BreakdownRow` turned the compiler into the enumerator, and it found three more transaction panels the row never mentioned — the /reports chart's month-flow panels, the lifestyle-creep bars, and /trends' new-merchant panels — each listing transactions under the same penny-match line, and one further Ask answer (`top_categories`) that prints a period total. All four now carry the same sentence. The three genuinely non-transaction panels (allocation holdings, forecast projections, net-worth constituents) answer `false` by construction with the reason recorded on the field, because a stub and a true answer look identical six months later.

2. **One author for the fact, two authors for the sentence.** `breakdownHandoverDayCopy` serves every panel, so a reader comparing two drilldowns cannot meet two accounts of one rule. But Ask states a figure with no rows beneath it, and the panel sentence's "N rows here", "the figure above" and its reassurance about the tally are all false there — a qualifying sentence carries an implicit claim about where the reader is standing (`a-disclosure-written-for-a-page-is-false-in-an-email`). `handoverDayAnswerNote` is the no-row-list variant, exactly as `cardDuplicateAnswerNote` is the no-row-list variant of `cardDuplicateTraceBasis`.

3. **The copy was written against specific ways of being false, and three of them are U.13's own corrections.** It never says "twice" (a chain sharing one cutover releases the date at every generation — U.13 measured one $999.99 charge at $3,999.96 — and EDGE_CASES already records "the only date that may be counted twice" as a false sentence); it states the doubling as a CONDITION, because whether both feeds reported a given charge is not knowable from the dates and `buildTaxExport` records why guessing from the rows cannot settle it; and it asserts no CAUSE for the date, reusing U.13's proven-in-every-shape clause "neither can be shown to have covered the whole of it" rather than "that's the day one connection stopped", which is false whenever the reader drags the cutover and false by sixteen months for a dormant feed (U.17).

4. **The tally clause is gated on `reconciles`, which is the whole point of the slice.** The reader opened the panel to audit a figure, the rows tally to the penny, and that tally reads as CONFIRMATION. Saying so is honest only while it holds — on a panel already reporting a mismatch, "these still add up" would be the false sentence — so `reconciles` is a required argument rather than a default, and the fact itself survives either branch.

5. **A per-row marker, because the two lines are identical by construction.** Same date, same payee, same amount. A sentence saying "2 rows here" without saying WHICH leaves the reader scanning a bucket. `(connection changeover)` is a fact about the row's DATE and deliberately not a claim that the row is the duplicate — a handover day with only one connection reporting is marked too, which is the same reason the sentence is conditional.

**Three critic findings, each executed against the real engine, each a false statement about money that would have shipped:**

- **The count was summed before a filter the figure applies after.** `spendingByCategory` drops any category whose net is `<= 0`, and `totalCents` sums only the survivors — so a handover-day purchase more than cancelled by a refund left the figure entirely while still being counted in the sentence beside it. Ask qualified a $20.00 total containing no released row at all with "2 … fall on a day…". The count now comes off `byCategory`, the same array the total is summed from. This is the false-scope defect one level up from the one the slice was already guarding against, and the per-category counts (which the same critic pass confirmed are correctly scoped, since a dropped category has no entry to attach one to) are what made it survivable at all.
- **"Charge" is false of a refund.** A refund can fall on a handover day, and a duplicated refund pushes a spending figure DOWN — so the noun was wrong about the kind of row and about the direction of the error, and a reader would hunt for a purchase that is not there. "Transaction" is true of every row that can reach the sentence; it is now the noun in all three places, including the tally clause's "two lines are one transaction".
- **The Ask note promised a destination it had not checked.** It ended "Spending in Reports lists those rows and marks them." /reports' category table is ALWAYS the current month (`spentSoFarWindow`; the page's only URL parameter sets the CHART range), while an Ask timeframe is whatever the reader said — "last month", "last quarter". The pointer was false for every answer that was not about this month. Replaced with the always-true no-adjustment clause, and locked by a test asserting the word "Reports" does not appear.

**Verification:** `bash scripts/verify.sh` with `VERIFY_E2E=1` green. Three unit sabotages (the row flag blanked, the panel sentence deleted, the Ask count widened to breakdown scope) each redden exactly their own locks and nothing else; the e2e sabotage was proven on a REBUILT server, since a Playwright run tests the last `next build` rather than the working tree (`e2e-runs-a-stale-build`). No `prisma/` diff — read-path and copy only, so the live Neon database is untouched.

**Critic cycle 2 — two fresh contexts against the fixed tree, 2 P0 + 8 P1/P2, four of which changed the design:**

6. **A fact inherited from another feature inherits its SCOPE.** Every consumer tested `handoverDates.has(t.date)` — a bare date. The set came from `getReconciliationHandoverDates`, which U.13 built for the tax export, where unscoped dates are exactly right (the CSV has no account column) and for cadence detection, which folds by component. For a per-row MARKER it is wrong: a released day is an ordinary shopping day on every other account the reader owns. Executed — six grocery rows on the handover day, two from the pair, and the panel marked all six under "6 rows here fall on a day one of your combined accounts was changing connections". The unit of the claim is `(account, day)`, so the engine now emits `handoverKey(accountId, date)` for both sides of each effective link, `ReportTxn` carries `accountId`, and `toTrendTxns` — a hand-built payload — had to start carrying it at all, without which /trends marked nothing and no test could see it (`the-narrowing-you-did-not-list`).

7. **The slice's stated premise was false, and it was in a comment I wrote.** "A released day can only make a figure too high" justified leaving the zero branches uncovered. The release is a rule about a DATE, not a sign: `spendContributionCents` negates, so a RETURN both feeds reported subtracts twice. Executed — one $100 purchase and one real $30 return doubled renders "You spent $40.00" against a true $70.00, with the only sentence beside it pointing the reader the wrong way. Both sentences and the tax export now name both directions. The remaining half — a return that cancels its category out of the figure entirely, after which Ask prints "No spending recorded" — is filed as U.21, because closing it needs a SECOND count (raw, pre-drop) and its own sentence: a claim about a figure that does not exist cannot reuse one written about a figure that does.

8. **A trace is a second selector over the same rows, and it prints the check.** Both critics independently found that Ask's own drilldown — reached by "Tap to see the transactions behind this number", four lines under this slice's new disclosure — listed the two identical rows unmarked under "✓ 3 transactions add up to $130.00". The slice had threaded `server/assistant.ts`'s ANSWER path and left `assistant/trace.ts` with its own un-fed `spendingByCategory` call. `TraceRow.onHandoverDay`, a `handoverBasis()` on all three spend traces, and the marker in `ask-view.tsx` close it.

9. **A clause about what a surface PRINTS must be gated on whether it prints it.** At exactly one row `BreakdownPanel` says "This amount is the whole figure." and deliberately suppresses the penny-match, while the basis asserted "These rows still add up to the figure above" — plural over one row, and with an antecedent that read as *the marked rows alone* summing to the figure. The parameter is now `statesATally` (`reconciles && rows.length > 1`) at all four panel call sites, and the clause names "The rows in this panel".

Two shipped sentences were also corrected rather than left inconsistent with the rule this slice wrote down: the tax CSV still said "both … counted twice" (false at multiplicity ≥ 3, in the artifact that reaches a preparer), and `combineSuccessFlash`'s PARTIAL branch still promised "count once" eight lines below the success branch U.13 had already requalified — the branch a reader reaches when something has already gone wrong.

**Residuals, filed with their evidence rather than papered over — U.19** (the transactions CSV ships the double silently while the tax CSV discloses it), **U.20** (Ask's `merchant_spend` answer, and the register's in/out/net totals under a basis line that enumerates what moves them and omits this), **U.21** (a doubled return holding a category at $0.00, after which the zero branches state an affirmative falsehood), **U.22** (/reports' page-level total). And the one this slice deliberately leaves open: the register (`transaction-list.tsx`) still contains no reconciliation vocabulary at all, so a reader scrolling their activity list sees both rows with only the account name to tell them apart. That is a different surface with a different question (a list of events, not a certified total) and it needs its own decision about whether a per-row marker there helps or just adds noise to every row of a busy day.

## #456 — U.19–U.22: the last silent surfaces of the released day, closed as one slice because they share one set (2026-08-12)

**Context.** U.16 (#455) ended with four residuals, each a surface that counts the released
handover day and says nothing: the transactions CSV (U.19), Ask's `merchant_spend` and the
register's own totals (U.20), the zero branches a doubled RETURN can produce (U.21), and
/reports' page-level total (U.22). All four consume the same account-scoped
`getReconciliationHandoverKeys` set, so they were built and critic-gated together; the previous
session's window died mid-slice and this one resumed from the working tree plus PROGRESS.md.

**U.19 — a CSV discloses in a column, not a paragraph.** The tax export opens with prose rows
because a preparer reads it top to bottom; this file's first line IS its header and the reader's
first act is to sort or pivot it, which a leading prose block breaks. So: a `changeover_day`
column that is UNCONDITIONAL (a schema that changes shape per reader breaks automation silently,
and only for some readers — an always-empty column costs one character per row), `yes` on
released rows only, and a trailing note row emitted only when the file actually contains one,
kept RECTANGULAR (prose in field 1, seven empty fields) so a table parser sees a row of the
declared width rather than a ragged tail. The note reuses U.13's cause-free clause and U.16's
"once for each" multiplicity rule.

**U.20 — the register is the surface where the two identical lines are actually adjacent.** The
per-row marker is the panels' own `(connection changeover)` — same vocabulary, same rule: a fact
about the row's DATE, never a claim that this row is the duplicate. The totals caption gets a
FOURTH sentence author, `handoverDayRegisterTotalsNote`, because both siblings' implicit claims
are false here: the register prints THREE tiles (a doubled purchase and a doubled return move
different ones), so "this figure … too high/too LOW" cannot be said; the sentence names the
tiles instead ("in Money out when they are purchases, in Money in when they are returns"). Its
count is `TxnSummary.countedOnHandoverDays`, counted AFTER the transfer and excluded-row gates —
exactly the rows the tiles are summed from — while the row marker stays a date fact on every
listed row of the pair; the sentence therefore says "rows counted in these totals", which is the
antecedent lesson from #455's `statesATally` finding applied prospectively. `merchant_spend` gets
`countedOnHandoverDays` REQUIRED on its result (U.16's make-the-compiler-enumerate move), counted
from `matched` — the array every figure is summed from — via the same predicate that flags
`items[].onHandoverDay`, so the trace, a second selector by construction, reads the flags off the
engine's own rows instead of re-deriving them. A row with no `accountId` answers FALSE: an
unprovable claim about money is not made, and the row stays counted in the figure either way.
The detail page renders the marker too — a page reached from a marked row must not drop the one
fact that explains its twin.

**U.21 — a claim about a figure that does not exist cannot reuse a sentence written about one
that does.** `SpendingBreakdown.uncountedOnHandoverDays` records the categories the net<=0 drop
removed that still hold released rows — filled inside the SAME loop that drops them, never by a
second derivation — and deliberately carries NO amount: its net is <=0 by construction, and a
money field on a "what the figure is missing" record is an invitation to add it back into a
total. The record carries its own `group` because a dropped category is absent from `byGroup`
too, so Ask's group target would otherwise have nothing to resolve against. The third sentence
author, `handoverDayNoFigureNote`, states the full causal chain (release → a doubled return
subtracts once for each → the category lands at <=0 → the figure drops it) and claims only that
the figure MAY be hiding spending — an ordinary refunded purchase produces the same zero, and
asserting the doubling would be the fabrication `buildTaxExport` refuses. Scoping is the
answer's: `uncountedFor(breakdown, target?)`, exported so the TRACE mirrors the note through the
identical predicate under the identical gates (`noFigureBasis`) — the answer-path/trace-path
split from #455, closed before a critic had to find it this time.

**U.22** rides the same plumbing: the /reports page total (the figure a reader reads FIRST) gets
`handoverDayAnswerNote` — the ANSWER author, because no rows sit beside that total and no
penny-match is printed under it — and the empty state gets the no-figure note, since "No
spending this month yet." is the same affirmative claim Ask's zero branches make.

Also: `server/reports.ts`'s local `handoverDates` renamed `handoverKeys` — it has held
account-scoped keys since #455's cycle 2, and a name that says "dates" invites the next reader
to treat it as the unscoped set.

**#456 critic cycle — two fresh contexts, 2 P1 + 8 P1/P2, every finding executed. The two P1s
interlocked, and fixing one resurrected the other's dead code:**

1. **P1 (money): the disclosure regime shipped with its most reachable shape missing.** The
   uncounted note was gated to the ZERO branches, and the critic executed the miss: dining
   $50.00 surviving plus groceries dropped by a doubled released return rendered "You spent
   $50.00 on Food & Dining this month." — an UNDERSTATED figure, the direction this repo names
   as the one that costs money — with no note anywhere, while the engine's own
   `uncountedOnHandoverDays` held the fact. A partial cancellation is strictly more reachable
   than one that empties the whole breakdown. The note now prints wherever the scoped uncounted
   set is non-empty — zero and positive figures alike, in the three answers, the three traces,
   and /reports.
2. **P1 (claims): `handoverDayAnswerNote`'s direction clause was INVERTED on the merchant
   negative-net branches.** Executed: two copies of one $50.00 return rendered "$100.00 came
   back in refunds" — too HIGH — under "returns make this figure too LOW". Those branches print
   gross magnitudes a doubling can only inflate, plus an exceedance net a doubled purchase
   deflates; no single direction claim covers them, so their new author
   (`handoverDayAmountsNote`) states the counting rule and no direction — the register's
   fourth-author resolution, applied where it had been skipped.
3. **The U.21 trace mirror was dead code narrating a screen the app never renders.** Traces
   attach only where an answer states a figure (`headlineCents`), and every zero branch sets
   none — so the zero-gated `noFigureBasis` never fired, and its docstring described a drawer
   that could not exist. Fixing P1 above is what made the mirror REAL: ungated, the reachable
   case is precisely the positive figure over a partially-cancelled breakdown.
4. **A $0 verification hold fired money-direction disclosures beside figures it cannot move**
   (both critics, independently) — and the engine comment CLAIMED the exclusion existed while
   the predicate lacked it. Zero contributions are now excluded from the merchant flag+count
   (one predicate, so the marks and the sentence still cannot disagree) and from the register
   summary's count.
5. **The register note's tile enumeration missed doubled DEPOSITS** — the register is the one
   surface that counts income, and "in Money out when they are purchases, in Money in when they
   are returns" read as exhaustive while a doubled paycheck was neither. Replaced with
   "in whichever of these totals its amount feeds", exhaustive by construction.
6. **"This figure" had no referent** under Ask's "No spending recorded" (and a wrong one beside
   the rescoped positive totals) → the note is now referent-free ("Spending figures leave out
   any category that lands there"). And **the detail-page marker stood unexplained** for a
   deep-linked reader → it is a Badge among its neighbors now, with its own on-page sentence
   (`handoverDayDetailNote`), since "the reader just came from the register" is a standing
   assumption a bookmark breaks.

**Filed rather than fixed, with the critics' executed evidence: U.23** (pre-existing, found on
the surface U.19 certifies: the transactions CSV export builds its own where-clause, so it
double-counts every split — parent AND children — and ships non-USD rows the register
withholds; measured at 4 rows/−$299.00 exported for a register showing 2 rows/−$100.00) and
**U.24** (/calendar sums both released copies through a lean row shape that cannot carry the
flag, so its `countedOnHandoverDays` is a structural zero — the "next row-building path
reintroduces the silence" the TxnView docstring warns about, already shipped).

## #457 — U.23: a claim of parity is a claim about an expression, and a withhold is not the end of the obligation (2026-08-12)

**Context.** U.19 certified the transactions CSV as disclosing the one deliberate double it can
contain (the released changeover day) — and the U.19–U.22 money critic then found, executed
against a real database, that the same file shipped a larger, silent double: 4 rows summing
−$299.00 out of a ledger the register shows as 2 rows / −$100.00. The route built its OWN
where-clause three lines above a comment claiming "the exported ledger must match the in-app
register". It was missing `isSplitParent: false`, so the split PARENT — the row the schema calls
"excluded from ALL sums" — exported beside the children that carry the real amounts; and missing
the #135 currency guard, so rows the register withholds for having no exchange rate shipped
unlabelled in a column of dollars.

**The rows: the register's own clause, not a copy of it.** `where: registerRowWhere(userId)`.
Both defects were one expression apart, and the fix is not "add the two missing keys" but "stop
having a second clause": a copy is how a reader starts disagreeing with the register (H.8), and
the parity comment was true as an intention and false as code. The export's remaining filter —
the R1 reconciliation keep — was already shared, which is exactly why it did not drift.

**The currency question the task row left open — a column, or the guard?** The task filed it
undecided: should non-USD rows export with a currency column instead of vanishing? Decided:
**they do not export.** #135 withholds non-USD accounts from every money surface because the app
does no FX, and a currency column would make this file the one place unconverted foreign money
appears, contradicting the decision it would be implementing. The header therefore does not move
— which also keeps U.19's live-deploy header check valid, unedited.

**But a withhold that reaches a file must be disclosed IN the file.** #141 and #150 already
established that this guard may not act silently on screen (banner, inline note). A file leaves
the app entirely: the reader sums its amount column in a spreadsheet and the app never sees the
figure that produces, so it is the last place the silence is affordable. Hence
`withheldExportNote` — its own author, because both siblings say a FIGURE excludes some accounts,
and a reader holding that sentence over a file of rows can conclude their rows are present and
merely un-summarised. This one says the transactions are not in the file, in those words.

**Its input is scoped to the file, and the disclosure is built as the withhold's literal
complement.** `getWithheldRegisterAccountSummary` destructures `registerAccountWhere`'s own
currency clause and negates it — never retypes it — and passes the rest of the basis in WHOLE as
one `AND` member, so a key that clause later gains cannot be silently shadowed by the negation
written beside it. Scoped to spending accounts holding an exportable row, because a set carries
the scope it was built for: the dashboard's summary counts a euro brokerage too, and a brokerage
row is out of this file for a reason that has nothing to do with currency (#62). An empty euro
account produces no note at all — the U.19 byte-identity rule in the other direction.

**Two critics, two fresh contexts, and they found the same P1 independently.** The note's count
is FILE-scoped while one of its clauses claimed the APP: "an account in EUR is left out of every
total the app shows" is false for a reader who also owns a yen brokerage, whose screens correctly
say "2 accounts" — the disclosure family's own non-disagreement rule (#141), broken inside the
author written to honour it, and locked in by the slice's own test. Fixed by making the totals
sentence a RULE carrying no number ("Accounts that aren't in U.S. dollars are left out of
Aimplifi's totals for the same reason") while every counted clause names this file;
`regression__u23_totals_clause_states_a_rule_not_a_count` asserts the rule sentence contains no
digit. Also executed: "stay saved" now names Aimplifi (in a downloaded file, an unplaced promise
of persistence acquires the file as a second referent); the currency codes moved to a
parenthetical the opaque case simply omits; one account is named once, definitely; "counting
them" became "counting those transactions in a column of dollars".

**Filed with executed evidence, not fixed here.** **U.25** — the file names one of the four
reasons it is incomplete; a basis clause bolted onto the currency note would gate a fact true for
every reader behind the rare condition of owning a non-USD account, which is last session's
`a-disclosure-gated-to-the-loudest-branch` defect exactly, so where the basis belongs needs
deciding first. **U.26** — MEASURED this session: one purchase, one reader-excluded row and one
transfer export as 3 rows summing −$3,300.00 while the register reports $100.00 of money out for
the same three rows, because the file carries no `excluded` and no `transfer` column; row-set
parity is intact, so this is the column's legibility, not U.23's clause. **U.27** — currency copy
drift and the shared "EUR and others" phrase.

**Gate.** `bash scripts/verify.sh` with `VERIFY_E2E=1`; 19 new locks in
`tests/unit/u23-export-register-parity.test.ts`, both halves proven fail-old by sabotage (old
clause → 5 red at the exact 4-rows/−$299.00 shape; suppressed note → 4 red), plus the existing UI
split e2e extended to sum the exported file.

## #458 — U.25/U.26: a file that leaves the app carries its own basis, and the reasons its numbers differ from the app's (2026-08-13)

**Context.** U.23 made the transactions CSV export the register's exact row set, and its two
critics immediately found what row-set parity does not buy. The money critic MEASURED, against
a real database: one $100.00 purchase, one $1,200.00 row the reader had marked "not my
spending", and one $2,000.00 transfer whose offsetting leg lands on a mortgage account the file
cannot carry — **3 rows summing −$3,300.00** in the file, against the register's own
`TxnSummary` over those same three rows reporting **$100.00 of money out** and `excludedCount: 1`
printed on screen. The rendered-claims critic found the other half: the file's first line is its
header, so it stated its basis nowhere, while U.23's new note named exactly ONE of the four
reasons it is incomplete — and only for the rare reader who owns a non-USD account.

**Why they are one decision.** Both answer the same question — what does a reader holding only
this file know about it — and both are answered in the same two functions. Splitting them would
have decided the note order twice.

**U.26: the two flags become data on the row.** `summarizeTransactions` keeps a row out of the
register's in/out/net tiles for exactly two reasons (`query.ts:415-419`): the reader's own
`excludeFromTotals`, and `isTransfer`. Both were stored columns the file simply did not carry,
so the one act the file exists for — summing the amount column — could not reproduce any figure
in the app, and nothing in the file said why. `excluded_from_totals` and `transfer` are now
columns, read straight off the Prisma row so nothing re-derives which rows count (the H.8
divergence U.23 had just finished removing from this route's where-clause), and REQUIRED on
`ExportTxn` on the U.19/U.23 precedent: a default would let the next export path ship the
silence back in.

**Appended, never inserted.** They read more naturally beside `amount`. They are at the end
because a reader's saved script indexes this file by POSITION, and inserting a column mid-row
silently re-points every one of those indexes at the wrong field. Appending can only add.

**U.25: the basis note is unconditional, and it is a rule with no list in it.** Two things
follow from the fact being true of every file. It is gated on nothing — bolting a basis clause
onto the currency note was the cheap move and would have gated a truth about every reader behind
owning a euro account, the exact defect `a-disclosure-gated-to-the-loudest-branch-misses-the-reachable-one`
distilled one session earlier. And it names the register rather than enumerating the four
omissions, because an enumeration is a promise of completeness that goes stale the next time the
basis moves (`closing-a-gap-shrinks-the-disclosure-that-described-it`); naming the register is
exact AND self-maintaining, since since U.23 this route and `getTransactions` share
`registerRowWhere` and the same R1 keep, with no date window and no default filter on either
side.

**What that cost, knowingly.** U.19's "a reader with no combined accounts gets a byte-identical
file" property is retired: every file now ends with a note. That property was a statement about
churn; this is a statement about what the file is. Every docblock, unit expectation and
live-check assertion that encoded the old property was updated rather than left to rot —
including `getWithheldRegisterAccountSummary`'s (`server/transactions.ts`), which the
rendered-claims critic caught still asserting it after the first pass had claimed the sweep was
complete; and the U.23 live check's header assertion was re-scoped to the claim it still owns
(no CURRENCY column was added) rather than deleted. (#456's own note-row description — "prose in
field 1, seven empty fields" — describes the eight-column file of its day; it is ten columns and
nine empty fields from here.)

**The critic cycle, and what it changed.** Two fresh-context critics (money/data-integrity and
rendered claims) ran against the finished slice. Neither found a defect in the columns, the
arithmetic, the padding, the append-only position or the gate logic — the money critic scored
financial correctness 9/10 and structural integrity 10/10 after emitting all 16 note branches
with an adversarial account name and finding zero ragged rows. Every P1 either raised was in the
COPY, and the two of them independently executed the same one. All are fixed above and locked:

1. **The basis note asserted facts about the reader's data.** Its closing clauses — "It does not
cover every account you hold, and it is not every transaction row Aimplifi has stored" — are
false for a reader holding only spending accounts (measured: 2 accounts of 2, 3 rows of 3) and
false for the production demo's own file, where all 847 stored rows export. Unconditional is
right for a rule and wrong for a claim about a reader; the clauses are now rules ("whether or
not you hold one").
2. **"Left out of the spending, income and net totals it shows" was false, live, on the demo.**
An auto-loan ACH carries `isTransfer`, `recurring/detect.ts:416` deliberately keeps it, and
/spending-plan prints "CarMax Auto Finance $385.00/mo" inside a $3,096.72 Fixed figure — 18 rows
this file marks `transfer,yes`. The tax export is the same shape on the excluded side. The
sentence now names the three register tiles `summarizeTransactions` actually gates and nothing
wider, which also removes the "net"/net-worth ambiguity.
3. **The transfer clause promised a counterpart that need not exist.** `isTransfer` is set by
descriptor evidence alone, so a reader who never added their car loan owns no other account for
the money to have moved to — and was being told the matching row was out there somewhere. The
flag is the app's judgement about a row, so the sentence says so.
4. **"Account balances count every row either way" is false for a hand-entered row** — a manual
entry never rewrites a provider-authoritative balance (`transactions/manual.ts:7`), and the
register invites hand entry. Replaced with the reassurance the clause was for, without vouching
for a figure the file cannot see.
5. **The excluded clause was not sign-neutral and did not use the control's own words.**
Excluding is not gated on sign and drops the row from INFLOW too, so "you told Aimplifi this was
not your spending" is wrong about an excluded refund. The file now quotes the app's own label.
6. Smaller: the equality clause is scoped to "those accounts" and "every page" (the Transactions
page also renders a household member's shared rows, ungated by filters, and paginates at 100);
"spending accounts" is glossed for the accountant who cannot open the app; the live check's
direction regex is scoped to the note rows rather than run over the reader's own descriptors.

Each is locked by a named regression test, and the whole first draft was restored as a sabotage
proof: it reddens nine of them.

**What the U.26 note may not say.** It is conditional and assembled from the flags actually
PRESENT, so a reader who has never excluded a row is not sent down a column of blanks looking
for a marker. It states no DIRECTION — the flagged rows carry signed amounts, so "your sum will
be too high" is false for a reader whose excluded rows are refunds, the same inverted clause the
U.19–U.22 critic caught executing backwards on negative-net merchants; "includes money those
totals leave out" is true whatever the signs are and true even when they cancel. It promises no
EQUALITY — `changeover_day` can still double a row in the same file, and a claim that two
engines agree must be earned (`a-link-on-a-figure-asserts-two-engines-agree`). And it does not
say "every figure": `engine/transactions/exclude.ts` records that account balances, net worth,
cash-needed and the tax export all deliberately KEEP excluded rows, and a transfer moves a real
balance, so the note ends by saying the balances count every row either way — a reader must not
conclude the money is fictional.

**Note order, as a rule rather than an arrangement.** The file-wide basis first; then the notes
explaining a marked column, in the order those columns appear; then the currency note last,
because it alone describes rows that are NOT in the file. The rectangular padding is now derived
from the header, so the schema and the padding cannot drift apart.

## #459 — U.27: the currency family's standard has five authors, not one, and a shared phrase misparsed its own noun (2026-08-13)

**Context.** Opened 2026-08-12 by the U.23 rendered-claims critic (P2-6, P2-8). DECISIONS #141
made "not in U.S. dollars" the family's standard specifically because a withheld crypto account
is a first-class case and not "foreign" — but the standard lives in the string, not in a shared
constant every caller goes through, so nothing stopped another author from writing the same fact
in the app's informal spoken form instead.

**(a) Four more authors of "US dollars," not the two the row named.** `household-copy.ts:109`
(`scopeUnsupportedCurrency`) and `:175` (`digestUnsupportedCurrency`) both said "Aimplifi handles
US dollars today"; `keyword-rules.ts:1378`'s per-row rule-exclusion reason said "Rules apply to
your US dollar accounts." A fourth, `money.ts:139`'s `formatCents` docblock, was a comment rather
than rendered copy but stated the same fact in the same wrong form, so it is fixed too — a
docblock is what the next author reads before writing the next string.

The row also named `connection-depth-copy.ts:57` and `accounts-list.tsx:216`; both already read
"U.S. dollars" with the correct punctuation, so those two are not drift — either already fixed
between the row's filing and this session, or the original P2's grep matched loosely. Re-verified
by grepping all of `src/` for the literal, case-sensitive `US dollar(s)` (word-boundaried so it
cannot match "U.S. dollars" — the periods break the token): exactly the four sites above, now
fixed. `keyword-rules.ts` took the hyphenated adjectival form ("U.S.-dollar accounts") rather
than the noun form the other three use, because that form is already shipped and locked —
`currency-disclosure.spec.ts:119` asserts "No U.S.-dollar investment holdings yet" — and a slice
whose whole point is stamping out a second spelling should not introduce a third.

**Locked as a sweep, not a list of sites.** `tests/unit/u27-currency-copy-drift.test.ts` walks
every `.ts`/`.tsx` file under `src/` and fails on the bare pattern, the same shape
`source-hygiene.test.ts` uses for control bytes — so the NEXT author who writes "US dollars"
instead of reusing the family's copy fails a test naming exactly what they did, rather than
waiting for a sixth critic to find it by hand. Fail-old proven directly: reverting either fixed
site independently reddens this lock (not a mutation-tested proxy).

**(b) `formatWithheldCurrencies`'s "EUR and others" parsed as "EUR, and other ACCOUNTS."** Every
sentence this string feeds already talks about accounts ("an account in {label} is left out" —
`currency.ts:130`), so the bare "and others" sits one word away from a plausible misreading it
never intended. Fixed to "and other currencies," spelling out the noun the list is actually a
list of. Not a drive-by: the string is shared by the SHIPPED #141 banner (`withheldBannerCopy`)
and U.23's export note (`withheldExportNote`), both locked in `currency.test.ts`, both updated
here, plus the new sweep test asserts the fix reaches both call sites directly rather than
trusting that a shared function fix propagates. Fail-old proven: reverting the one-line change
reddens 3 locks across `currency.test.ts` and the new file. No e2e or other test locked the old
phrase (grepped for it repo-wide before touching the string).

**(c) Recorded, not fixed — `getWithheldRegisterAccountSummary`'s count is generous, never
false.** The row's own instruction was "also record." `getWithheldRegisterAccountSummary`
(`server/transactions.ts:1986`) models the register's basis (`registerAccountWhere` +
`isSplitParent: false`) but not the R1 reconciliation keep — unlike `getTransactions`, which
fetches raw rows and filters them through `getReconciliationTxnKeep(userId)` afterward, because
the keep is a per-row `(accountId, date)` function, not a static Prisma predicate, and cannot be
expressed as a `where` clause the way the rest of this function is. So a non-USD account that is
ALSO a fully-disowned reconciliation predecessor — every one of its rows dropped by R1, none of
them destined for the export file regardless of currency — is still counted as "withheld by
currency" here, overstating the U.23 export note's count by the number of such accounts. **Why
recorded rather than fixed in this slice:** the fix is a query-shape change (fetch candidate
withheld accounts' transaction dates, filter each through the same per-row keep function
`getTransactions` already calls, then count only accounts with a surviving row) rather than a
copy edit, which is the entire rest of this slice; and the condition it corrects requires a
single account to be BOTH non-USD AND a reconciled predecessor with zero surviving rows — doubly
rare, and unreachable in the demo seed (K.4: the seed writes neither a non-USD account nor a
reconciled pair), so there is no live-check angle either way. Crucially: **no sentence becomes
false.** The export note says "this file leaves out N accounts that aren't in U.S. dollars," and
an over-generous N still leaves out no fewer accounts than it claims — the note undercounts risk
in the safe direction (over-disclosure), the opposite of the U.23/U.26 family's actual failure
mode (a disclosure understating what it excludes). Filed as **U.28** in TASKS.md for whichever
session next touches this function, so the fact is not lost the way an inline comment alone would
risk.

**Gate.** `bash scripts/verify.sh` with `VERIFY_E2E=1` — full output in `PROGRESS.md`. Copy-only
change to three rendered strings + one comment; no `prisma/` diff, no schema, no engine logic
touched outside the two locking test files. Two new `describe` blocks lock (a) and (b); (c) is
DECISIONS + TASKS only, per the row's own instruction.

## #460 — U.29: the Fixed / Guilt-free split now discloses the one released day it was already
counting twice (2026-08-13)

**Context.** Opened 2026-08-13 by U.18 while correcting `spend-class.ts`'s own docblock claim
that a reader "sees each real purchase ONCE" on this panel — false since U.13 deliberately
released the single handover day per reconciliation link to BOTH the predecessor and successor
account (DECISIONS #454). U.16 (#455) threaded `handoverKeys` and `breakdownHandoverDayCopy`
through the four surfaces that summarize a category's rows (category breakdowns, /reports,
lifestyle-creep, new-merchant) — but `summarizeSpendClassCategories`, the engine behind /budgets'
Fixed vs. guilt-free split, predates that wiring pass and was never touched: it read
`keepsReconciled` (which correctly keeps both released rows) but no `handoverKeys` (so it never
said so), the exact gap the four other families closed.

**What shipped.** `summarizeSpendClassCategories` gained a sixth parameter,
`handoverKeys: ReadonlySet<string> = new Set()` — same default as `buildCategoryBreakdowns`, the
truth for every reader with no combined accounts — and its return type gained
`countedOnHandoverDays: number`, incremented once per row that (a) survives `keepsReconciled`,
(b) classifies as `fixed` or `guilt-free` (never `out-of-scope` — a transfer or excluded row on a
handover date must not inflate a count about the Fixed/Discretionary split it never joins), and
(c) whose `handoverKey(accountId, date)` is a released day. `budgets/page.tsx` passes the same
`handoverKeys` it already fetches for `buildCategoryBreakdowns` two calls above — one boundary
read, one set, both callers — and builds the disclosure via `breakdownHandoverDayCopy(count,
false)`: `false` because this panel has no per-transaction row list, only category subtotals, so
unlike the panel `buildCategoryBreakdowns` feeds, there is no "these rows still add up to the
figure above" tally a reader could check by eye. `SpendClassPanel` gained a required
`handoverNote: string | null` prop (required for the same reason `loanPaymentNotes` is — an
optional prop reads as "nothing to disclose" at exactly the caller that forgot to compute it),
rendered as a single sentence above the two lists when either carries a released row this month.

**Nothing about the money changed.** The subtotal arithmetic (`cur[cls] += -t.amountCents`) is
untouched — the released rows were already both counted, correctly, by U.13's boundary; this
slice adds a side-counter and a sentence, never a filter. The failure this closes is silence, not
a wrong figure — same shape as U.16, applied to the one family it missed.

**Hostile critic pass (money-visible, per the row's own instruction).** One fresh-context
adversarial review against the real source (not the change summary), tracing: the loop order
(handover check runs only after both the `keepsReconciled` and `out-of-scope` `continue`s, so a
disqualified row can never inflate the count — proven by a direct unit test seeding an unrelated
account and an out-of-scope transfer on the same handover date, both asserting 0); the
`statesATally: false` claim against the actual rendered component (`SpendClassRow` prints one
`<li>` per category subtotal, never a per-transaction list — the claim holds); that
`handoverKeys`/`keepsReconciled` are fetched once and fed into the one call this slice touches,
not a stale parallel computation; that the summation line itself is byte-identical in the diff;
that the new optional 6th parameter doesn't break `spend-class-link-parity.test.ts`'s existing
5-arg positional call (`tsc --noEmit` clean, 23/23 unit tests including that file pass); and that
the new e2e test is non-vacuous — the pre-fix component had no `handoverNote` prop or
`spend-class-handover-note` testid at all, so the assertion on it could not have passed against
the old code. Zero defects found across all nine checks run.

**Locked.** `tests/unit/spend-class.test.ts` — four new tests: the pre-U.29 5-arg call shape still
defaults `countedOnHandoverDays` to 0; a released handover day is counted and the subtotal is
untouched by the marker (both rows still sum in, as they did pre-U.29); an unrelated account on
the same date and an out-of-scope transfer on the handover date are both excluded from the count.
`tests/e2e/handover-day-disclosure.spec.ts` — a new test reusing the file's existing
`seedHandoverDayDuplicate` fixture (a real combined SimpleFIN→Plaid pair, one $30.00 control
charge de-duplicated to its predecessor's copy, one $50.00 charge released to both sides) drives
`/budgets`, asserts the Fixed groceries row prints $130.00 (30 + 50 + 50 — the double is still
counted, exactly as before this slice), the handover note is visible with the engine's exact
sentence, and the note does NOT claim a row-by-row tally the panel cannot show; the file's
existing no-combined-accounts control test gained an assertion that `/budgets` shows no note
either, closing the same `dataDerived`-gate shape U.16 established elsewhere.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**: tsc 0, eslint 0, unit tests
green (spend-class suite 23/23), `next build` clean, e2e **349 passed, 1 flaky-passed-on-retry**
(`transactions.spec.ts` CSV import — the pre-existing load-induced local flake class recorded in
`docs/lessons/ci-e2e-timing-flake.md`, not a spec this slice touches). No `prisma/` diff.

## #461 — U.24: the calendar was the last surface counting the released day in silence, and the
marker it first drew stated the one thing the whole family refuses to state (2026-08-13)

**Context.** U.13 (#454) released the single handover day per reconciliation link to BOTH sides of
a combined pair, because a handover is an instant inside a day and a business date here carries no
time. U.16 (#455) then disclosed that release on the four surfaces summarizing a category's rows,
U.19-U.22 (#456) on the CSV, the register totals and /reports, and U.29 (#460) on /budgets' Fixed
vs. guilt-free split. /calendar counted it correctly throughout — `getPostedCalendarRows` reuses the
register's where-clause AND the R1 keep, which is the K.1 gate — and said nothing, because
`PostedTxnLike` carried no flag and `summarizeTransactions` therefore read its optional-field
default of 0 forever. The optionality was not an oversight: `TotalableTxn.onHandoverDay`'s docblock
named the calendar's lean row shape as its justification, so the silence was documented as a design.

**What shipped.** `onHandoverDay` on `PostedTxnLike` as a REQUIRED field, and
`countedOnHandoverDays` on both `PostedCalendarDay` and `PostedCalendarMonth`, each read off the
SAME `summarizeTransactions` call the tiles and the month totals are summed from — so the sentence
and the figures it qualifies can never describe different row sets (the U.16 critic finding: a count
summed before a filter the figure applies after is a disclosure about money that did not move).
The flag is resolved in `getPostedCalendarRows`, the layer that holds `accountId`, keeping the unit
of the claim the (account, day) PAIR rather than the bare date — U.16's critic cycle 6 executed that
difference and found six ordinary grocery rows marked on one released day.

**Required, not optional, and the compiler was the argument.** An optional flag defaulting to "not
released" is precisely how this surface stayed silent through three slices that each threaded the
fact somewhere else. Making it required cost exactly one site — the unit test's `row()` helper —
which is the measurement that settled it: `tsc` enumerated every builder and there was only one in
production. `TotalableTxn.onHandoverDay` stays optional, now genuinely as the structural minimum
(both production callers pass it as a required field on their own row type), and its docblock was
corrected rather than left asserting a reason U.24 had just falsified.

**Copy: the sixth author was reused, and the reasoning is the surface's claim shape.** /calendar
lists no transaction rows — each day links OUT to Activity — so `breakdownHandoverDayCopy`'s "N rows
here" and `handoverDayRegisterTotalsNote`'s "it is listed" are both false where this reader stands.
It prints an in AND an out, which a doubled purchase and a doubled return move in opposite
directions, so `handoverDayAnswerNote`'s single "this figure ... too high / too LOW" would be wrong
about one of them. `handoverDayAmountsNote` states the counting rule and claims neither, which is
why it exists — a seventh author would have been a seventh account of one rule.

**Two fresh-context critics, different lenses, 2 P1 — and both critics found BOTH independently,
which is the signal they were real:**

1. **The day marker asserted the double as a FACT.** It read "Connection changeover — counted on
   both connections' records", four lines under this slice's own comment saying the marker is
   deliberately *not* a claim that any row is a duplicate. The keys are minted per link from the
   cutover date alone (`reconcile-boundary.ts`), so a released day on which only ONE connection
   reported anything is marked too — and on that day the flat claim is false, beside a specific
   amount, in the direction that makes a reader distrust a figure that is correct. All six sentence
   authors keep the doubling CONDITIONAL because whether both feeds reported a given charge is not
   knowable from the dates (#455 decision 3), and every sibling marker in the repo is the claim-free
   `(connection changeover)`. Corrected to state the KEEP, which is unconditionally true: "both
   connections' records are kept for this day". The first draft of the e2e could not have caught it
   — it asserted the testid was VISIBLE and never read its text.
2. **"These amounts" had the wrong nearest antecedent.** The note was drafted as the first child of
   `CardContent`, below `cal-scheduled-line` — the Expected/projected totals, built from scheduled
   series and card dues, holding no transaction row and therefore no released one. The sentence
   qualified the two figures it is not about. `partialPast` makes that line render on nearly every
   day of the current month, so this was the ordinary rendering, not an edge case. Moved up into
   `CardDescription`, directly under the posted totals and above the projected line, and locked by
   asserting DOM ORDER rather than by eye.

**Nothing about the money changed.** No filter was added and no sum was touched: both released
copies are still counted, exactly as U.13's boundary intended and as the K.1 gate requires. The
failure this closes is silence.

**Locked.** 8 new unit tests: the released row counted per day and per month with the figures
asserted UNCHANGED; the no-release control; transfers, reader-excluded and $0 rows excluded from the
count while still listed; a released INFLOW (the doubling is a rule about a date, not a sign —
U.16's critic finding 7); the posted-window clamp; and the wholly-future month. Plus 2 server-level
tests proving the (account, day) scoping against a real reconciled pair with a THIRD account holding
a row on the very same date, and asserting the calendar's count equals the REGISTER's for the same
window — the K.1 gate extended to the new field. Fail-old proven by four sabotages: the engine count
zeroed (3 red), the server flag forced false (2 red), the scoping regressed to a bare-date match
(2 red — both the scoping control AND the register-parity gate catch it), and the rendered note
suppressed on a REBUILT server (the e2e red, since Playwright tests the last `next build`).

**One critic hypothesis REFUTED with evidence rather than filed.** The copy critic flagged, as
uninvestigated, whether a doubled released row could propagate into the PROJECTED figures via
recurring-series detection — which would have opened a sixth silent figure and undercut the
placement decision above (the note sits directly beneath the posted totals precisely because the
Expected line holds no released row). Traced to source: it cannot. `server/recurring.ts` runs
`collapseHandoverDuplicates` over the kept rows BEFORE `detectRecurring`, so the detector sees one
occurrence per handover day and the scheduled amounts are minted from the deduplicated series;
`applyReconciliationBoundary` re-keys those rows without re-duplicating them. Card obligations take
their amount from the Statement row or `Account.currentBalanceCents`, and loan obligations from
`Account.minimumPaymentCents` / `dueDayOfMonth` — neither channel reads an individual transaction
at all. The projected half is structurally independent of transaction row COUNTS, so no queue item
was filed for it.

**Residuals filed with their evidence rather than papered over — U.30** (the home screen's Recent
transactions card, which shows both copies with no marker and not even the account name that
`TxnView.onHandoverDay`'s docblock calls the reader's only clue), **U.31** (two independent reads of
the link table in one loader, the shape `transactions.ts:1336` already rejects in writing — a
confirm/undo landing between them desyncs disclosure from figures), and **U.32** (the day tile's row
COUNTS and the page's closing basis caption, both of which still omit the released day).

## #462 — U.30: the FIRST screen a reader sees was also the last one saying nothing about the
released day (2026-08-13)

**Context.** U.24 (#461) closed /calendar, the last of six spending surfaces to disclose U.13's
released handover day — but its own critic cycle found a seventh, filed rather than fixed: the
home dashboard's "Recent transactions" strip. `dashboard-recent.ts` already filters through
`keepsReconciled` (correctly keeping both copies of a released row), then hand-builds a closed
`DashboardRecentTxn` shape with no slot for the flag, and `RecentTransactionsCard` prints merchant,
date, category and amount only — no reconciliation vocabulary at all. `TxnView.onHandoverDay`'s own
docblock justifies the field's existence with "the reader's only clue that two lines were one
purchase was the account name" (query.ts); this card does not even show the account name, and
unlike every other surface in the family it is the first thing a reader sees after signing in.

**What shipped.** `onHandoverDay` added to `DashboardRecentTxn` as a REQUIRED field (the same
compiler-enumerates-every-builder argument #461 made — `tsc` found exactly one production builder
and no test helper constructs this shape directly), resolved in `getDashboardRecent` by fetching
`getReconciliationHandoverKeys` alongside the existing `getReconciliationTxnKeep` call inside the
SAME `Promise.all` (concurrent, not sequential — narrower race window against U.31 than the
precedent's sequential awaits, not wider), and keyed the same way as every prior surface:
`handoverKeys.has(handoverKey(t.accountId, t.date))` against the Prisma row's own `accountId`/`date`,
never a bare date. `RecentTransactionsCard` renders the SAME `(connection changeover)` span used on
/transactions, /reports, Ask and /calendar — the sixth reuse of that exact string, not a seventh
authored sentence, because this card carries no aggregate total of its own to qualify (it is a
six-row strip with an "All activity" link out, not a category or month summary) — so unlike
/calendar or /budgets, no accompanying note sentence was needed or added.

**Fresh-context hostile critic (money-visible per this row) — PASS, zero P0/P1.** One P2 accepted in
place: the merchant name and the marker share one `truncate` `<p>`, so a sufficiently long merchant
name could clip the marker past the ellipsis — the identical pattern already shipped and
critic-passed on `ask-view.tsx` (U.16), where `transaction-list.tsx` and `breakdown-panel.tsx`
instead give the marker its own non-truncating slot. Not raised as a new defect this slice
introduced; worth revisiting the two remaining truncate-together sites together, someday.

**Locked.** `tests/unit/dashboard-recent.test.ts` — a byte-for-byte match of #461's own fixture
shape (predecessor/successor/unrelated-account trio, same cutover, same scoping controls): flags
both released copies, not the unrelated account's row on the identical date, not a pair-account row
off the cutover date. `tests/e2e/handover-day-disclosure.spec.ts` gains a test reusing the file's
`seedHandoverDayDuplicate` fixture — /dashboard prints 3 rows (the control pair de-duplicated to
one, the handover day keeping both), exactly 2 carry `dashboard-recent-handover-row`; the existing
no-combined-accounts control test gained the matching zero-count assertion.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**: tsc 0, eslint 0, unit tests
green (2 new dashboard-recent locks), `next build` clean, e2e **350 passed, 2 flaky-passed-on-
retry** (`category-rename.spec.ts:110`, `merchant-lens.spec.ts:22` — both named members of the
pre-existing load-induced local flake class in `docs/lessons/ci-e2e-timing-flake.md`, neither a
spec this slice touches). No `prisma/` diff — read-path and copy only.

## #463 — U.31: six loaders read the reconciliation link table twice, not two — the row's own
scope claim was incomplete, and the critic that checked it found the rest (2026-08-13)

**Context.** `getReconciliationTxnKeep` and `getReconciliationHandoverKeys` (`server/reconciliation.ts`)
each independently called `getActiveReconciliations` plus their own identical Prisma queries for
accounts and predecessor transaction spans — the exact "two independent reads of the same link
table" shape `getAccountsView` (`transactions.ts`, critic F-4) already argued against in writing: a
confirm/undo committing between the two separate awaits can desync whatever each read derives from
the link table (the row's own hypothesis, never reproduced but the two-read shape verified real).
The row named two call sites needing the fix (`getPostedCalendarRows`, `getTransactions`); by the
time this slice started there were four, U.30 having added a third (`getDashboardRecent`) the row
predates, and this session's own read finding a fourth (`getTransactionDetail`, same file).

**What shipped.** A private `loadReconciliationBoundaryInputs` in `reconciliation.ts` does the
shared fetch — links, currency-filtered accounts, predecessor spans — ONCE. A new exported
`getReconciliationBoundary(userId)` calls it once and returns `{ keepsReconciled, handoverKeys }`
together; `getReconciliationTxnKeep` and `getReconciliationHandoverKeys` were refactored to call the
same shared loader internally (byte-for-byte reassembly of their old bodies — same `where`, same
`select`, same `groupBy`, same currency filter, same null guard) so their five remaining single-value
callers (assistant.ts, coach.ts, reports.ts, backfill.ts, keyword-rules.ts, etc.) are unaffected. All
four dual-read call sites now call `getReconciliationBoundary` once.

**Fresh-context hostile critic — 0 P0, 2 P1, executed and fixed, not filed.** The critic proved the
row's own "these are the call sites" claim false by grepping every consumer: `src/app/(app)/budgets/page.tsx`
and `src/app/api/export/route.ts` both paired `getReconciliationTxnKeep` + `getReconciliationHandoverKeys`
sequentially in one loader — the identical shape, unnoticed because the row's background text asserted
(without checking) that every other caller used only one function. Both converted to
`getReconciliationBoundary`, bringing the total fixed sites to six. One P2 (an orphaned docblock
paragraph left over a deleted line in `getTransactionDetail`) fixed alongside.

**Filed, not fixed — U.33.** The critic also found `getReconciliationTxnKeep` paired with a THIRD
sibling function, `getReconciliationHandoverDates` (unscoped by account, a distinct engine call with
its own triplicated fetch, never touched by this slice), inside `recurring.ts` (feeding
`collapseHandoverDuplicates` → `detectRecurring`, whose output is PERSISTED as `RecurringSeries` +
`ScheduledTransaction` rows driving forecast and the Cash-Needed Engine) and `tax.ts`'s `getTaxExport`
(a `Promise.all` pairing, concurrent rather than sequential, but still two independent reads backing
one combined figure). Both are money-persisted or money-exported surfaces the critic called "arguably
more sensitive" than the ones this slice fixed, and both need a *different* shared function
(`getReconciliationHandoverDates` has its own signature and its own triplicated fetch) — a real,
undecided design question rather than a mechanical swap, so filed as its own row rather than expanding
this one's scope.

**Residual, accepted in place.** `loadReconciliationBoundaryInputs` still performs three sequential
`await`s (links → accounts → spans) rather than one atomic read, so a narrower race — a mutation
landing between the links read and the accounts/spans reads — can still desync those from each other,
though `keepsReconciled` and `handoverKeys` can no longer desync from EACH OTHER, which is the part
this row exists to fix. `getAccountsView`'s own pattern is strictly better (it derives its boundary
from data already fetched earlier in the same function rather than re-reading links at all) but
re-deriving from an in-hand read at all six of these call sites was judged out of this row's scope.

**Locked.** `tests/unit/reconciliation-boundary-shared-read.test.ts` (new) — the combined function's
two outputs proven to agree row-by-row with what the two standalone functions independently compute
over an identical fixture (not merely "returns a value"); the (account, day)-scoping shape locked
alongside; the no-active-links fast path locked. The full existing suite (6,995 unit tests) proves no
behavior changed at any of the six converted call sites.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**: tsc 0, eslint 0, unit
**6,995 passed + 1 skipped / 426 files** (3 new locks), `next build` clean, e2e **350 passed, 2
flaky-passed-on-retry** (`category-rename.spec.ts:110`, a documented pre-existing flake-class
member; `triage-write-in.spec.ts:129`, a `SQLITE_BUSY_SNAPSHOT` contention hit — the K.10-documented
e2e-harness class the configured retries exist to absorb, in a spec this slice does not touch). No
`prisma/` diff — read-path refactor only.

## #464 — U.32: /calendar's per-day marker was gated on the money it moved, not the fact it
stated (2026-08-13)

**Context.** Opened by both U.24 critics, converging: (a) the day tile's "N transactions in
Activity →" link and "N transfers / N rows you excluded" tally are flat counts with no
released-day awareness, while `cal-posted-handover-day` — the page's ONLY source of changeover
vocabulary per day — was gated on `countedOnHandoverDays`, a count scoped to rows the MONEY
figures sum from (transfers, excluded and $0 rows excluded by design, same as the register's own
gate). So a released day whose only duplicated rows were transfers, reader-excluded or $0 printed
a doubled count with no changeover vocabulary anywhere on the page — not a false sentence (there
really are two rows), but a silent doubling on a surface that had just told the reader it
discloses this rule. (b) The closing basis caption enumerates the recorded half's counting rules
and omitted the released-day one entirely — the same `closing-a-gap-shrinks-the-disclosure-that-
described-it` shape U.20 fixed on the register's caption.

**What shipped.** (a) A new `PostedCalendarDay.handoverRowCount` — the RAW count of released rows
on a day, transfers/excluded/$0 included, computed the same way `transferCount` already is
(`dayRows.filter(r => r.onHandoverDay).length`), deliberately NOT derived from
`countedOnHandoverDays`. The per-day marker's gate widened from `countedOnHandoverDays > 0` to
`handoverRowCount > 0`. Safe to widen because the marker's own claim ("both connections' records
are kept for this day") is unconditionally true regardless of whether the released rows moved a
tile — U.24's second critic cycle had already established that exact wording for this reason —
so nothing about the wider gate makes the sentence less true, only makes it fire where it was
silently owed. The two-sibling markers (`cal-posted-nonmoney`, explaining a $0 net; the handover
marker, explaining a doubled count) are no longer mutually exclusive by construction, and don't
need to be — they answer different questions and can both be true of one day. (b) The closing
basis caption gained an unconditional clause stating the released-day keep rule, matching the
paragraph's own established voice: every other clause there (pending charges, due badges, card
estimates) states a RULE, not whether it currently applies to the reader — this is the first
caption in the family without a `dataDerived` gate, and that is by design, not an oversight,
since it sits in a policy-explainer paragraph rather than a per-instance fact.

**The money-scoped month sentence (`cal-handover-note`) was deliberately left unchanged.** It
states "these amounts count it once for each" — an inherently money claim — so widening it to
fire on transfer-only released days would make it false about a day where no amount moved. The
core defect this row opened with ("no changeover vocabulary anywhere on the page") is closed by
the per-day marker and the caption; the month sentence staying silent on a transfer-only day is
correct, not a residual.

**Locked.** `tests/unit/calendar-posted.test.ts` — two existing tests extended with
`handoverRowCount` assertions: money-visible released rows land in both counts, and a fixture of
transfer/excluded/$0 released rows lands in `handoverRowCount` (3) while `countedOnHandoverDays`
stays 0 — the two counts are proven genuinely different, not one renamed. `tests/e2e/handover-day-
disclosure.spec.ts` gains a new fixture (`seedHandoverDayTransferOnly`, a released transfer pair
on two SAVINGS accounts) and test: the day tile shows `cal-posted-nonmoney` ($0 net, 2 transfers)
AND `cal-posted-handover-day` (the marker, now firing) together, `cal-handover-note` stays absent
(money-scoped, correctly silent), and the caption's new clause is present. The existing
no-combined-accounts control test gained an assertion that the caption clause is visible even
there — proving it is genuinely unconditional, not merely untested for the negative case.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**: tsc 0, eslint 0, unit
**6,995 passed + 1 skipped / 426 files**, `next build` clean, e2e **349 passed, 4
flaky-passed-on-retry** (`action-menu.spec.ts:391`, `category-rename.spec.ts:110`,
`transactions.spec.ts:735`, `transactions.spec.ts:1014` — all members of the documented
K.10/`ci-e2e-timing-flake.md` shared-SQLite contention class on reload-bearing mutation specs,
none touching calendar or reconciliation code). No `prisma/` diff.


## #465 — U.33: the boundary's last two hand-rolled reads, and a link table read four times
inside one write (2026-08-13)

**Context.** U.31 consolidated the reconciliation link table's double read at six loaders and
left two views out of the consolidated helper. The U.31 critic filed the remainder as U.33 and
named two call sites: `refreshRecurringForUser` (recurring.ts), which awaited
`getReconciliationTxnKeep` and then, in a separate `Promise.all`, `getReconciliationHandoverDates`
— both feeding ONE `collapseHandoverDuplicates` call whose output is `detectRecurring`'s input and
is PERSISTED as `RecurringSeries` + `ScheduledTransaction` rows driving forecast, the calendar, the
spending plan and the Cash-Needed Engine — and `getTaxExport` (tax.ts), which paired
`taxRows(userId)` with `getReconciliationHandoverDates(userId)` in one `Promise.all` while
`taxRows` fetched the keep for itself, so a file that leaves the app entirely was assembled from
two independent snapshots of the same table.

**The row's scope was short by two reads, and the measurement found them before any code moved.**
`refreshRecurringForUser` reads `accountReconciliation` FOUR times, not two: the keep, the dates,
`activeTerminalSuccessorMap` at the collapse (the third argument of that same
`collapseHandoverDuplicates` call), and `activeTerminalSuccessorMap` AGAIN fifty lines later,
where `new Set(terminalOf.keys())` decides which accounts are in scope for the rows this function
writes. That second terminal read is the same function with the same argument as the first, with
detection and merchant resolution running in between. This is the second consecutive slice in this
family whose row under-counted its own scope (#463 was the first), which is now enough of a
pattern to state plainly: a row that names "two reads" is naming the two someone noticed, and the
count is worth re-measuring before trusting it.

**Decision: FOUR views from one read, not a second parallel helper.** The row offered a
`getReconciliationDatesBoundary`-shaped sibling or a shared signature covering both. Neither: a
second boundary function is a second place for the fetch to drift, which is the defect this family
exists to remove. `getReconciliationBoundary` instead returns `keepsReconciled`, `handoverKeys`,
`handoverDates` and `terminalOf` — every one of them the same derivation from the same two inputs
(`effectiveReconciliationLinks(accounts, links)`, plus predecessor spans where a date is needed).
That is not a grab bag: it is everything the boundary says about one user, resolved from one
snapshot. All four are pure O(links) computations over arrays already in memory, so a caller
destructuring two pays no query for the other two, and with no active links every view is the
empty / constant-true fast path. `getReconciliationHandoverDates` — which held the LAST hand-rolled
copy of the links + accounts + spans triple, written out a third time after U.31 consolidated the
other two — now routes through the shared fetch like its three siblings. The single-output wrappers
stay for the callers that need exactly one view (assistant, coach, reports, backfill, keyword-rules,
triage, and `getTaxYears`): a second read there is real but is not a DESYNC risk, because nothing
downstream compares it against a second independently fetched value.

**`taxRows` takes the keep as a REQUIRED parameter, not an optional one with a fallback.** An
optional parameter defaulting to its own fetch is exactly how a second read survives a
consolidation unnoticed — the call site keeps compiling, and the drift comes back silently. Making
it required let the compiler enumerate both callers: `getTaxExport` resolves it from the boundary
alongside the dates it also needs, and `getTaxYears` keeps the single-output wrapper because a year
list names no dates.

**What was traded, stated rather than buried.** `getTaxExport` was two reads run CONCURRENTLY and
is now one read awaited before the row query starts — one sequential round trip bought back, against
three fewer queries and a file that can no longer contradict itself. `refreshRecurringForUser` loses
nothing: its terminal map was already read before the collapse, so reusing that value moves no await
earlier, it only stops a second one from happening later.

**The direction of the consistency fix is the safe one.** In every case the new code resolves one
snapshot of the links and uses it throughout, where the old code could resolve two. There is no
shape in which the old behavior was preferable: a confirm or an undo landing between two awaits
produced a collapse decided on one set of links and an account scope decided on another, and in
`refreshRecurringForUser` that disagreement was not rendered, it was written to the database.

**Locked, and the lock is a COUNT.** `tests/unit/reconciliation-boundary-shared-read.test.ts`
(U.31's file, extended) proves equivalence — `handoverDates` and `terminalOf` from the boundary
equal what `getReconciliationHandoverDates` and `activeTerminalSuccessorMap` compute standalone
over the same fixture, dates and keys are proven DIFFERENT sets rather than one output renamed
(1 date, 2 keys; a bare date is not a key and a key is not a bare date), and the no-links path
returns all four empty. But equivalence tests would pass just as well against four separate reads,
so the regression lock is a `vi.spyOn(prisma.accountReconciliation, 'findMany')` call count:
`getTaxExport` and `refreshRecurringForUser` each read the link table EXACTLY ONCE. Both were
proven fail-old by sabotage, not asserted: restoring tax.ts's concurrent pair reddened its count
test at "expected 1, got 2", and restoring recurring.ts's second `activeTerminalSuccessorMap` read
reddened its own at "expected 1, got 2". The tax count test also asserts the export really
assembled ($125.00 total) — a read count over a file that produced nothing proves nothing.

**Residual filed, not fixed (U.34).** `getSpendingPlan` (spending-plan.ts:186) reads
`activeTerminalSuccessorMap` for the income median's account scope, then calls
`countedExpenseSeriesForPlan` (:243), which reads it AGAIN (:667) for the expense scope — one
rendered plan, two independent reads of one table. Same defect class, different file, and RENDERED
rather than persisted, so it is a separate slice rather than a widening of this one.

**Hostile critic (fresh context, Opus 5): PASS — 0 P0, 0 P1, five P2.** It earned the clean bill by
execution rather than reading, and the decisive artifact is one I had not thought to build: it seeded a
fixture with a real mid-stream cutover (predecessor owns rows ≤ 2026-04-15, successor after), a monthly
subscription straddling it and DOUBLED on the released day, biweekly income straddling it, and a
tax-tagged charge reported by both sides — then ran `refreshRecurringForUser` + `getTaxExport` +
`getTaxYears`, dumped every persisted `RecurringSeries` and `ScheduledTransaction` field plus the whole
export, reverted `src/` to HEAD, and re-ran the identical fixture. `diff` → **identical, on two
independent runs**. The dump exercises the machinery that matters: Netflix still detected MONTHLY (the
collapse worked, so the released-day duplicate did not distort cadence), the series still re-keyed onto
the successor (L.26), income BIWEEKLY, tax total 55000 with both $125.00 copies kept per U.13. Measured
query counts with links present: `getTaxExport` 6 → 3, `refreshRecurringForUser` 11 → 4 (the link table
itself 4 → 1).

**It also corrected the Maker's own reasoning on the one real risk.** I had justified `terminalOf`'s
order-independence on two grounds — the engine's out-degree guard AND `predecessorAccountId @unique`.
The critic's correction: the schema constraint is not load-bearing and must not be leaned on, because
this file's whole doctrine is to re-check at READ time what the writer already refuses
(`a-guard-must-read-what-it-guards`) — resting the claim on the constraint rests it on the half that
does not run here. It then built the out-degree-2 shape that would be the counterexample to my argument
and showed the output identical anyway, because the engine guard caught it. It permuted every ordering
of six link shapes (chain, fan-in, cycle, non-monotone chain, out-degree-2, cross-type inert) against
all four views: identical every time. One residue it surfaced that I had missed: `chainMaps`' `predsOf`
LISTS genuinely are order-dependent, so `upstreamsOf` returns a differently-ordered array — harmless,
because `txnKeepRule` consumes it order-independently and `recurring.ts` reads the map only through
`.get()` and `new Set(terminalOf.keys())`. The comment now leads with the guard and names the
constraint as explicitly NOT the argument.

**P2 dispositions — three executed, one accepted, one filed.**
*Executed:* P2-2, the zero-caller export — `getReconciliationHandoverDates` had no production caller
left and the docblock still named it as a wrapper callers keep, so the function is DELETED and the
sentence now names only the two wrappers that are really used. P2-3, the tautological assertion — the
dates test compared the boundary against `getReconciliationHandoverDates`, which after the
consolidation ran the same two lines (f(x) vs f(x)); it now asserts the values themselves, with the
real old-vs-new parity recorded as having been executed by the critic against a verbatim copy of the
pre-U.33 body. P2-4, the thin fixture — the two read-count tests ran on a user with NO links, i.e. the
`links.length === 0` fast path, the one branch that reads once however you ask; the fixture now carries
a real active link and a predecessor row, which moved the fail-old count for `refreshRecurringForUser`
from 2 to **4** and put the lock on the branch that actually costs the queries.
*Accepted with the measurement recorded:* P2-1, `effectiveReconciliationLinks` now derived four times
per boundary call instead of two, eagerly, at all six call sites. Measured: no delta at 5 links,
+0.155ms at 20, +4.2ms at 100, +119ms at 500. Real users hold a handful — the owner's own production
data, the largest ever measured here, holds 19 — and the alternative (threading a precomputed `eff`
into four engine functions) would put a second author on the effectiveness rule to save a fraction of
a millisecond. Recorded in the docblock with the numbers and the trigger for revisiting it.
*Filed:* P2-5 became U.34, widened by the critic's measurement from one site to two.

## #466 — U.34: one link-table snapshot per rendered plan and per Ask answer (2026-08-14)

**Context.** U.33 consolidated the reconciliation link table to one read per persisted
artifact (`refreshRecurringForUser`, `getTaxExport`) and filed the two RENDERED leftovers
as U.34. `getSpendingPlan` read `activeTerminalSuccessorMap` for the income median's
account scope, then `countedExpenseSeriesForPlan` read it again for expenses — one plan,
two snapshots, with a `detectRecurring` pass between them, and the guilt-free figure is
the difference of the two. `assistant.ts` fetched handover keys in four spend cases, the
links again for `account_balance`, and the keys a fifth time for the Glass-Box trace, so
a `spend_total`'s disclosure and the tick behind it could resolve against two snapshots
of the same table.

**Decision: hoist the existing four-view boundary, pass the views down as REQUIRED
parameters. Do not add a fifth view or a second helper.** U.33 already returns
`terminalOf` and `handoverKeys`. `getSpendingPlan` fetches the boundary once (in
parallel with the snapshot) and hands `terminalOf` to `countedExpenseSeriesForPlan` as
a required argument. `composeAnswer` fetches the boundary once (in parallel with the
snapshot) and hands `handoverKeys` + `terminalOf` to `buildAnswer` as required
arguments; the trace attach uses the same `handoverKeys`. An optional parameter that
falls back to its own fetch is how the second read survives a consolidation unnoticed
(U.33). The snapshot's own link-table read is a different artifact and stays — the
claim is that each loader adds exactly one more.

**`activeTerminalSuccessorMap` is deleted.** U.34 consumed its last two production
callers. An exported function with no caller is a claim about this file that stops
being true the moment someone reads it (U.33 critic F-2). The two L.26 audit probes
that imported it now take `terminalOf` off the boundary. The U.33 equivalence test
that compared the boundary against the standalone function is replaced by a value
assertion (predecessor → successor, size 1) — comparing against a wrapper of the
same two lines would be f(x) vs f(x) (U.33 critic F-3).

**What was traded.** `composeAnswer` fetched the boundary for every intent,
including `net_worth` which never needed a view. Same eager stance U.33 accepted
for the four views: a handful of links is noise, and a per-intent fetch is how a
second spend case reintroduces the desync. **#468 (U.36) narrows this:** the five
intents that only delegate no longer fetch the composer boundary; every intent
that uses a view still does. `account_balance` now folds through
`boundary.terminalOf` (effectiveness over the boundary's currency-filtered accounts)
instead of `terminalSuccessorMap(snapshotAccounts, freshlyFetchedLinks)`. Effectiveness
reads type and presence, not balance, so a boundary-zeroed predecessor does not
change the map; the win is that the fold and every spend disclosure share one
snapshot of the links.

**Locked by a COUNT, on a fixture with a real ACTIVE link.**
`tests/unit/reconciliation-boundary-shared-read.test.ts` (U.34 block):
`getSpendingPlan` reads `accountReconciliation` exactly twice (snapshot + boundary)
and returns a numeric `leftToSpendCents`; `askAssistant('how much did I spend this
month')` reads exactly twice and returns `headlineCents === 4200` for the fixture's
June grocery. The pre-U.34 counts (U.33 critic measurement for the plan; call-site
construction for Ask) were 3 and 3.

**Not in scope.** Passing the boundary into `getFinanceSnapshot` so a page is one
read total — that is a provider-shaped change, not a loader hoist. Ask intents that
delegate to `getSpendingPlan` still paid the plan's own snapshot + boundary on top
of the composer's (closed as **#468 / U.36**). Single-view wrappers
(`getReconciliationTxnKeep`; `getReconciliationHandoverKeys` deleted in #467)
stay for callers that need exactly one view.

## #467 — U.35: the snapshot emits the handover keys it already paid for (2026-08-14)

**Context.** U.34's critic filed `/reports`, `/trends`, and `/coach`: each already
holds a `getFinanceSnapshot` (which reads `accountReconciliation` and applies the
keep) and then fetched `getReconciliationHandoverKeys` independently — keep from
one snapshot, disclosure from a later read. #466 parked passing a pre-fetched
boundary *into* the assembler as a provider-shaped change.

**Decision: emit the keys *out* of the assembler, from the same links and the
same predecessor spans the keep just used. Do not change the provider
signature.** `applyReconciliationBoundary` returns `handoverKeys` as a required
field (empty set on the no-links fast path). `FinanceSnapshot.handoverKeys` is
required so a page that already holds the snapshot cannot re-fetch the keys.
`getReports` / `getSpendingTrends` / `getCoachData` read `snap.handoverKeys`.
`getReconciliationHandoverKeys` is deleted — U.35 consumed its last three
callers, and an exported function with no caller is a false claim (U.33 F-2).

Passing the boundary *in* would have made every snapshot caller fetch first
(or grown an optional parameter that falls back to its own fetch — the U.33
shape that lets a second read survive). Emitting *out* keeps the provider
contract "give me a snapshot" and makes keep-vs-disclosure agreement true by
construction: one `findMany`, one `txnSpan`, both views.

**Span source.** The assembler's spans are the snapshot's spending-account
transactions (the same rows the keep filters). The deleted wrapper's spans
were a `groupBy` over every predecessor transaction regardless of account
type. For a CHECKING/SAVINGS/CREDIT predecessor those sets are the same
row set. An INVESTMENT/LOAN predecessor has no spending rows in the
snapshot, so it contributes no key — and these three pages list no such
row to mark. Locked by comparing `getFinanceSnapshot().handoverKeys` to
`getReconciliationBoundary().handoverKeys` on the U.31 CREDIT-pair fixture.

**Not in scope.** Threading `terminalOf` onto the snapshot so
`getSpendingPlan` can drop its extra boundary fetch (still open). The
Ask half of that residual closed as **#468 / U.36** by skipping the
unused composer fetch, not by putting `terminalOf` on the snapshot.
Household merge does not carry the keys — `/reports` `/trends`
`/coach` are personal loaders.

**Locked by a COUNT**, on a fixture with a real ACTIVE link and a
cutover-day grocery in the pinned month (`breakdown.totalCents === 5300`
and `countedOnHandoverDays > 0` — the figure lock without the count
would still pass if keys were dropped; both rows are kept). Each of
`getReports`, `getSpendingTrends`, `getCoachData` issues exactly one
`accountReconciliation.findMany`. Pre-U.35 those were 2.

## #468 — U.36: composed Ask intents skip the unused composer boundary (2026-08-14)

**Context.** U.34's critic filed five Ask intents that pay the reconciliation
link table twice for one answer: `composeAnswer` fetched the boundary (U.34's
eager-every-intent stance), then `getSpendingPlan` fetched its own, or
`getCoachData` fetched a snapshot that already carries the keys (U.35). The
composer views are unused on those paths. Waste, not a desync — each artifact
is internally consistent.

**Decision: skip the composer boundary for the five named delegates. Do not
thread the boundary into the loaders, and do not emit `terminalOf` on the
snapshot.** Threading would be an optional parameter that falls back to its
own fetch (the U.33 shape that lets a second read survive) or a required
argument every page caller does not have. Emitting `terminalOf` on the
snapshot would re-litigate #466's `account_balance` fold, which uses the
boundary's currency-filtered accounts, not the snapshot's. The skip is the
named defect and nothing else.

The skip set is those five kinds, not "every intent that does not read a
view." #466's eager fetch stays for every kind that uses `handoverKeys` or
`terminalOf` (and for `net_worth` / `unknown` / `cash_needed`, which use the
snapshot). A per-intent "does this spend case need keys?" inversion is how a
second spend case reintroduces the window. Empty views are passed into
`buildAnswer` as the required arguments so the signature cannot grow an
optional fallback; today no skipped case reads them.

**Not in scope.** Skipping the unused composer *snapshot* for the four
plan-delegates (#466: composed answers reuse the shipped read-paths).
`debt_payoff` / `subscriptions` / `forecast` still pay an unused composer
boundary — they never paid it *twice* (their loaders are snapshot-only).
Threading `terminalOf` onto the snapshot so `getSpendingPlan` can drop its
extra fetch remains a provider-shaped change.

**Locked by a COUNT**, on a fixture with a real ACTIVE link.
`tests/unit/reconciliation-boundary-shared-read.test.ts` (U.36 block):
`safe_to_spend` 3, `savings_rate` 2, `retire_at_age` 4, `debt_free_by_date` 4,
`savings_goal_by_date` 3. Pre-U.36 those were 4 / 3 / 5 / 5 / 4. U.34's
`spend_total` lock stays at 2. Each test asserts `kind` so a mis-route cannot
satisfy another kind's count.

## #469 — U.12: a genuine reading outranks a carried-forward repeat (2026-08-14)

**Context.** U.9 ranks same-date snapshot collisions by ownership window:
covering (earliest cutover), then the live terminal, then closed (latest
cutover), then depth, then id. U.4 writes a monthly `BalanceSnapshot` for
every account, including a quiet feed whose later rows repeat the last
balance the bank actually sent. `feedDroppedAt` already travelled with the
account one layer up; the ranker ignored it. So two stale records of one
account could let a dead feed's echo beat another record's real reading
for the same date (s1 dropped 2026-01-15 / cutover 2026-02-28 vs s2 live
through June / cutover 2026-06-30, collision on 2026-01-31).

**Decision: within the covering tier, a genuine reading outranks a
carried-forward repeat. Then the existing cutover / depth / id order.**
Genuine means `feedDroppedAt == null || date <= feedDroppedAt` — the same
predicate the account-detail panel already used (`date > dropped`, not
`>=`; the drop date itself is a reading). Shared as
`isCarriedForwardSnapshot` so the marker and the ranker cannot drift.

`feedDroppedAt` is REQUIRED on `BoundaryAccountWithFeed`, which is the
snapshot-collision input. `effectiveReconciliationLinks` stays on
`BoundaryAccountLike` — it does not rank snapshots and must not be forced
to fetch a field it cannot use. A lone observation is still never dropped
(U.9: never a fabricated dip). Both genuine or both repeats fall through
to earliest cutover, so U.9 is unchanged when both sides read.

**Not in scope (closed as #470 / U.37).** Genuineness originally did not
invert U.9's *tier* order. U.37 lifts genuineness above tier: a covering
echo now loses to a genuine live successor, and a later-cutover echo
loses to an earlier-cutover genuine reading when the terminal has no row.
Making `AccountView.feedDroppedAt` required (it stays optional; the
accounts-page mapper normalizes with `?? null`) is the surviving U.33
door, accepted.

**Locked.** `tests/unit/reconcile-boundary.test.ts` U.12 block: named
defect s2 / $5,000.00 (order-independent, `netWorthCents === 500_000`);
both-genuine still s1; drop-date is a reading; lone echo kept;
both-echoes fall to earliest cutover; equal-cutover genuineness outranks
the id tiebreak; quiet ancestor loses to a genuine mid-chain reading;
CREDIT sibling wins and the series subtracts (−$5,000.00). Pre-U.12 the
named fixture returned s1 / $4,000.00.

## #470 — U.37: genuineness outranks U.9's tier order (2026-08-14)

**Context.** U.12 ranked a genuine reading above a carried-forward repeat
only inside the covering tier. The U.12 critic executed two leftovers of
that scope: (1) the common one-pred/one-succ pair — a covering
predecessor's monthly echo still beat the live successor's real reading
because the terminal is always tier 1; (2) the closed-tier inverse — when
the terminal has no row for a historical date, latest-cutover ranking
kept a later-cutover echo over an earlier-cutover genuine reading.

**Decision: genuineness outranks tier.** A repeat is not an observation,
so it must not win on window tightness. Both genuine or both repeats
fall through to the existing U.9 order (covering / terminal / closed /
depth / id), so U.9 is unchanged when both sides read. A lone
observation is still never dropped.

**Not in scope.** Making `AccountView.feedDroppedAt` required (U.12
accepted residual).

**Locked.** `tests/unit/reconcile-boundary.test.ts` U.37 block: covering
echo pred loses to genuine succ ($5,000.00); both-genuine covering pred
still wins; closed genuine s1 beats later-cutover echo s2; both-closed
genuine still latest-cutover; covering echo loses to closed genuine;
terminal echo loses to closed genuine; equal-cutover genuine ancestor
outranks echo mid; CREDIT common-pair −$5,000.00; lone covering echo
kept. Pre-U.37 the common pair returned pred / $4,000.00.

## #471 — U.2: semantic status-color tokens replace hue-named classes (2026-08-14)

**Context.** ~172 `emerald-*` / `amber-*` Tailwind classes across 51 files
encoded two roles by raw hue: brand chrome (nav, logo, focus rings) and
status (positive money, warnings). Chart hexes were already unified
(`chart-colors.ts`); the class vocabulary was not. A partial rename
would split the palette, so every call site moves in one slice.

**Decision: three scales, same pixels.** `brand` and `positive` alias
Tailwind emerald; `warning` aliases amber. Defined in `globals.css`
`@theme` so a later palette change cannot leave a stray hue class
painting the old color. Shades are not re-judged — `emerald-600` became
`positive-600`, `amber-700` became `warning-700`. Role split: chrome
(nav / wordmark / focus / connect CTAs / accent sliders) → `brand`;
evaluative money and success → `positive`; every amber → `warning`.

**Not in scope.** Rose/red money-out classes (already a third hue with
one job). The PWA `themeColor` hex `#10b981` (same pixel, not a class).

**Locked.** `tests/unit/u2-semantic-color-tokens.test.ts`: no
`emerald-N` / `amber-N` literal under `src/` except the token file;
token file aliases brand/positive → emerald and warning → amber.

## #472 — U.10: a today-dated snapshot is not the live point (2026-08-15)

**Context.** `netWorthSeries` overwrites today's snapshot bucket with
live `currentBalanceCents` so the latest point matches the headline.
U.4's first sync of the month stamps that day, so a kept today-row
was marked `countsInNetWorth` while the chart did not read it.
Reachable after a later same-day sync changes the balance.

**Decision: mark, do not yield.** Making the live point yield would
break the locked "today matches headline" invariant and the existing
`replaces a same-dated snapshot with the live current value` test.
`countsInNetWorth` stays the boundary verdict (the account IS in
today's net worth). `replacedByLive` is a required third fact: a
kept row dated today. The combine note must not fire (no counterpart;
the account counts). A dropped today-row stays the combine mark.

Copy states the mechanism and concedes the matching-cents case
(demo `back === 0` equals live; first sync of the month does too).
No "tomorrow" clause: demo / `DEMO_TODAY` pins today, and a later
combine can drop the recording after the clock moves. A same-day
A/L reclass gets its own sentence naming the CURRENT class the
live point uses. PDF trend heading is `Trend` — U.4's comment
already said it should claim nothing; "(recorded balances)" was
false of the live last row.

**Not in scope.** Making live yield. Passing `getAccountsView`'s
accounts+links into `getAccountDetail` (page `Promise.all`s them;
React `cache()` is unused here and process-lifetime-unsafe in
vitest). CSV last-row label. Quiet-feed "live" stacked on
"nothing has been read".

**Locked.** Server: today-row `replacedByLive` + chart constituent
is live $1,500.00 not recorded $1,000.00; dropped today-row stays
combine; historical dates unmarked. Copy: marker / note / class
note; note must not contain "not from this recording" or
"Tomorrow". Panel + e2e on the demo Auto Loan. PDF heading
`Trend`, no "recorded" / "month-end".

## #473 — U.8: spending rows open the detail panel from a sibling (2026-08-15)

**Context.** `accountRowDestination` sends CHECKING / SAVINGS /
CREDIT to the register and INVESTMENT to holdings. The in-place
panel — the only per-row explanation of a reclassified snapshot —
rendered only for `dest.kind === 'detail'`. A feed re-classing a
card or checking account is the likelier U.6 event, and a reader
who opened the register saw no explanation.

**Decision: sibling affordance, do not steal the click.** U.3 made
the spending-row click the register; putting history on the
register header answers a different question. `accountRowDestination`
kinds stay unchanged. INVESTMENT stays excluded (`kind === 'holdings'`).
The panel intro's second clause is type-dependent: spending accounts
say "Day-to-day activity is in Transactions" and must not claim they
are tracked "instead of an activity feed". The non-spending sentence
stays byte-identical.

**Not in scope.** Register-header history. Changing primary-click
kinds. A brokerage panel.

**Locked.** `accountDetailRoleLine` both variants; checking panel
render; destinations e2e (checking href unchanged, no Brokerage
Details); U.8 e2e sibling open/close.

## #474 — U.7: the winning observation carries its own class (2026-08-15)

**Context.** The U.6 critic filed a shape: after a snapshot carries
its own class, `keepsSnapshot` drops one side of an exact-date
collision and the survivor's recorded class signs that date. Pre-U.6
both sides were signed from today's type, and
`effectiveReconciliationLinks` only requires today's types to match.
A pair that once disagreed across the asset/liability line, then
healed, would make the point's sign depend on who won. The row asked
to prefer the successor's class or refuse the date.

**Measured, not inferred** (`scripts/audit-probes/u7-collision-sign.mts`
against the owner's live Neon, 2026-08-15): 27 live links, 25
effective, 16 colliding (component, date) pairs, **0 class
disagreements**, 0 even same-class type disagreements (CREDIT vs
LOAN). All 55 snapshots still have NULL `accountType` — U.6
deliberately refused the backfill, and August was already claimed
before the column existed. NULL falls back to the account's current
type; an effective link already requires those to match; so the
filed shape cannot fire on any row that exists today.

**Decision: refuse both prescribed fixes.** The class rides with the
winning observation, the same way the cents do. Preferring the
successor's class would mix the winner's cents with a class that
row was not read under — U.6 inverted. Refusing the date would drop
a real observation and understate that bucket (U.4: a missing
account is not a shorter list). "Sign depends on who won" is not a
new defect: it is the collision ranking doing the job U.9 / U.37
already do for the magnitude. Pre-U.6 both sides signed identically
because both used current type — that was the U.6 bug, not a
property to restore.

**Not in scope.** Stamping `accountType` onto the already-claimed
August rows (that is the backfill U.6 deleted). A later month will
write typed rows; if a healed cross-class collision then appears,
the locks below say what the engine must do. No new disclosure for
that future shape: U.5 already names the dropped counterpart's
cents and U.6 already marks a recorded class that differs from
today. The 0-disagreement count is tautological while every row is
NULL — the locks, not that count, are what close the row.

**Locked.** `tests/unit/reconcile-boundary.test.ts` U.7 block:
CHECKING-recorded covering winner against CREDIT-recorded loser is
`+$5,000.00` (prefer-successor would be `−$5,000.00`; refuse-date
would drop the point); genuine CREDIT beating a CHECKING echo is
`−$4,800.00`; NULL+NULL both CREDIT today stay a liability
whichever side wins.

## #475 — U.17: a dormant last-used day is still released (2026-08-15)

**Context.** The U.13 money critic filed a shape: `claimEnd =
min(cutover, predecessor last)`, so a feed that stayed connected
but unused releases its last-USED day as the handover day. The
filed example was last used 2025-03-15, cutover 2026-07-21, a
$1,200.00 charge doubled sixteen months before the reconnect. The
row asked to stop releasing that day, or to move claimEnd to the
cutover. U.13 had already replaced the false cause ("the day one
connection stopped") with "neither connection can be shown to have
covered the whole of that day."

**Measured, not inferred** (`scripts/audit-probes/u17-dormant-handover.mts`
against the owner's live Neon, 2026-08-15): 25 effective links, **16
coincident** (last === cutover), **0 dormant**, **0 dragged**, 9 with
no predecessor rows (no claim). Both prescribed fixes produce $0
change on any row that exists today. The filed 16-month pair is
gone — every live cutover equals that predecessor's last row, which
is how confirm defaults.

**Decision: refuse both prescribed fixes.** The last-used day stays
released, the same one-day overlap U.13 already chose. Making it
inclusive when last < cutover (fix A) reintroduces the U.13 silent
loss the moment a pair goes quiet — a successor-only row on that
day has no counterpart and would vanish. Setting claimEnd to the
cutover (fix B) is F4 inverted: the predecessor would claim a gap
it never reported and drop the successor's backfill. One rule, no
second branch. "Neither side's absence that day proves anything"
still holds when the feed just went unused; the weaker "handover
happened inside that day" rationale is not a reason to drop money.

**Copy (critic cycle 1 P1, executed).** "Changing connections" /
"changeover" located a connection change on last-used, which is
false when the user (or H.6) sets cutover past last — reachable
today; the date picker allows it and confirm does not refuse it.
Every long author now locates the RULE (`HANDOVER_DAY_LOCATOR`:
both connections' records are kept, because neither can be shown
to have covered the whole of it). Row markers and the detail
heading say `(both connections kept)` / `Both connections kept`.
The Combined accounts card prints no date (the payload has no
claim span, so cutover is not claimEnd and is not last-used);
it keeps the standing balance clause only. Combine states the
H.6 exclusive-ownership sentence, then a SEPARATE keep-rule
sentence ("any day neither can be shown to have covered in
full") so the exception is not attached to "the day keep
started pulling". CSV column `changeover_day` is unchanged
(U.19 header).
No `prisma/` diff. No live figure moves.

**Locked.** `tests/unit/reconcile-boundary.test.ts` U.17: last-used
2025-03-15 / cutover 2026-07-21 keeps both −$1,200.00 copies, the
unique successor −$25.00 on that day, and a 2025-06-01 gap row;
handover keys are `pred|2025-03-15` / `succ|2025-03-15`, not the
cutover. Fix A reddens the unique successor row; fix B reddens the
gap. F4 already locks the 14-day version of the same shape.
`tests/unit/u16-handover-disclosure.test.ts` U.17: every long
author contains the locator and refuses "changing connections" /
"changeover" / "stopped". Combined-accounts identity line is the
balance clause only.

**Residual (cycle 4, recorded not built).** Naming the released
day on Combine or Combined accounts needs `claimEnd` / last on
those payloads. This close is copy-only. The confirm form already
names `min(cutover, last)`. CSV column `changeover_day` stays
(U.19). `EDGE_CASES.md` §Combined-accounts still quotes the
retired "history kept through" line (docs only).

## #476 — U.14: the last-4 name-signal veto reads a 4-digit non-year embedding (2026-08-15)

**Context.** `masksDiffer` disqualifies the weak NAME signal when
two sides' last-4s differ. It read the `mask` COLUMN, which
SimpleFIN never populates, so the veto was inert across the
SimpleFIN→Plaid migration the feature exists for. Measured: the
app proposed E.LEE (4034) vs M.LEE ····4927 on "lee" alone, and
three Schwab 529 plans vs a Vanguard 401k on "plan". A 2026-08-12
widening that used every advertised 2+ digit group was reverted
the same session: `Roth IRA (2021)` became last-4 "2021" and hid
a genuine pair (P0-1), and deleting one candidate collapsed an
L.9 ambiguity into a one-click Combine (P0-2). The evidence moved
to the U.15 advisory audit.

**Decision: read a last-4 from the name, not every advertised
number.** `last4ForNameVeto` = mask column, else `maskFromName`
minus `looksLikeYear`. Still gates only the weak name signal.
Identical-balance and mask matches are untouched (E.LEE/M.LEE
with the same balance still surfaces). A 2- or 3-digit SimpleFIN
id is an ABSENCE, not a different last-4: Schwab "...396 (396)"
vs Plaid ····5351 is the same account (owner-confirmed, L.9 e2e)
and `accountNumbersConflict` is true of it. Treating those
shorter ids as a veto is the reverted hide.

**Rejected.** (1) Gate Combine on `accountNumbersConflict` after
grouping, changing no set size. That withholds the genuine Roth
396/5351 offer — the e2e that caught the last attempt. (2) Widen
to advertised 2+ digit groups again. Same hide. (3) Disclose
"numbers don't match" on the Combine card. The view already
refuses to print both numbers side by side because SimpleFIN's
396 and Plaid's 5351 are not comparable.

**Residual.** A 2-digit plan code ("…-01") vs a 401k stays a
name-only candidate. U.15 already shows that evidence on a
confirmed link. A 2-digit gate would reintroduce the Roth hide.

**Locked.** `tests/unit/account-duplicates.test.ts` U.14: E.LEE
4034 vs M.LEE 4927 different balances → hidden; `Roth IRA (2021)`
vs mask 8842 name-only → still flagged; 396 vs 5351 and 529
"…-01" vs 401k → name signal still fires; year-shaped mask
column `2021` vs name `(4034)` stays hidden (P1-2 — do not
`looksLikeYear` the column); household LEE pair hidden.
`tests/unit/account-reconciliation-candidates.test.ts` U.14: no
Combine on the LEE pair; Roth 396/5351 still offered; a 4-digit
conflict removes only that rival (same-last-4 sibling stays the
one offer); a name-only leftover with no last-4 is withheld, not
promoted (P1-1); two name-only rivals with no last-4 on the stale
side stay an ambiguity group. e2e `reconcile.spec.ts` U.14: both
LEE rows visible, no cleanup / Combine / warning. Existing L.9
Roth e2e unchanged.

**Critic cycle 1 (executed).** P1-1: sole name-only leftover
after a 4-digit veto (`Venture (1234)` + mask-null `Venture`) is
withheld — `soleNameOfferIsUnprovenLeftover` (pred has last-4,
succ does not, signal is name). P1-2: year-shaped mask column
lock. P2-1: EDGE_CASES + identical-balance comment rewritten.
P2-2: household LEE lock.

## #477 — C.21: the pace assumption names which zero when no bill was admitted (2026-08-15)

**Context.** `paceAssumption` branch C fired whenever no bill
was admitted and said nothing about bills. "The calendar held
nothing this month" and "the calendar held bills the admission
rule refused" rendered identically. The second reader is the one
whose projection is least complete (an aggregate payee, a
hand-authored label). The engine could not tell the two zeros
apart — a copy tweak would have been a guess.

**Decision: a required refused-count selects a fourth branch;
the sentence does not print N.** `billsThisMonth` returns
`refusedCount` (expected entries that failed `counted` or
`aggregate`). `SpendingPace.billsRefusedCount` is REQUIRED.
Count > 0: "This projection does not add scheduled outflows."
plus the empty-calendar daily-rate sentence, byte-identical.
Count = 0 keeps that daily-rate sentence alone. Income, $0,
and C.25-excluded loan rows never enter `expected`. Critics
refused printing N (no surface lists that set), an admission
qualifier (false of Zelle), a causal "so", "this month", and
"as bills" (a declined role implies the rate is the other
role).

**Rejected.** (1) Name the refused merchants. An aggregate
"Zelle Payment" listed as a bill is a pattern, not an
identity. (2) Mention refused bills on branches A/B. Those
already carry coverage; a refused rival beside an admitted
mortgage is recorded, not a second sentence. (3) Print N in
the sentence. Demo 2 matches neither /calendar nor
seed.scheduled.

**Locked.** `trends-labels.test.ts` C.21: 1 ≡ 3; no digit / so
/ this month / as bills / coverage; tail is `PACE_DAILY_RATE`.
`trends-pace-bills.test.ts`: 3-refusal count 3; Zelle compose;
mixed stays A; income/$0 count 0; demo seed count 2 composed
through `paceAssumption`. e2e `trends.spec.ts` demo: both
surfaces print "This projection does not add scheduled
outflows".

**Critic cycle 1 (executed).** P1-1: "N bills on this month's
calendar" named a different set than the count. P1-2: coverage's
"we have not spotted" is false of rows just named as present.

**Critic cycle 2 (executed).** P1-1: "match to a merchant you
have spent at" is false of an aggregate (Zelle) that matched
and was refused as a pattern — qualifier dropped. P1-2: a
printed N is not a set the reader can count — the engine
count selects the branch; the sentence does not print N.

**Critic cycle 3 (executed).** P1-1: causal "so" read as
converting omitted outflows into the rate. P1-2: "this month"
named a set /calendar will not always show. Refused branch is
a preamble plus the empty-calendar model sentence.

**Critic cycle 4 (hard cap; P1 executed in-place, no fifth
critic).** P1-1: "as bills" assigned a declined role and the
daily-rate sentence became the implied other role. Preamble is
now "This projection does not add scheduled outflows." Residual
P2s: rule-shaped wording; "scheduled outflows" is not a UI
term; ledger drift (this note).

## #478 — H.9: reader-chosen payee on a LOAN/MORTGAGE, register-axis payment history (2026-08-15)

**Context.** A mortgage click shows recorded balances, not the
payments that produced them. Those payments post against the
checking account they left. The feeds send balances only for
loan/mortgage accounts. Inferring the payee from name
similarity would file a wrong history under a real debt.

**Decision: the reader names the payee; the rows are the
register's.** `Account.paymentMerchantId` → `Merchant`
(`onDelete: SetNull`). Set only by `setAccountPaymentMerchant`.
The painted name must already appear on this user's
register-basis kept rows (`resolveRegisterPayee`); the stored
canonical is that painted string so a case-variant POST cannot
mint a second Merchant. History uses `merchantNameEquals` (the
register `?merchant=` predicate), `registerRowWhere`, and
`getReconciliationBoundary`. Transfer-flagged rows stay (they
are the real ACH). Hand-entered rows with no `merchantId` match
via `registerDisplayName`. LOAN + MORTGAGE only
(`LOAN_ACCOUNT_TYPES`). Demo cannot write. Unlinked + cannot
set = hidden (an ASK with no control is a dead end). Linked +
zero rows names the activity-list zero.

**Rejected.** (1) Auto-link from C.24
`loanPaymentMerchantCanonicals` — safe to compute with, not to
write with. (2) Filter `isTransfer: false` — hides the
payments. (3) Match `merchantId` only — drops every manual
row. (4) OTHER_LIABILITY / REAL_ESTATE in v1.

**Locked.** `tests/unit/loan-payment-history.test.ts`;
`account-detail-panel.test.tsx` H.9; `account-payment-merchant-actions.test.ts`;
e2e `no-dead-ends.spec.ts` H.9.

## #479 — C.20: pace credit attributes through the month total's category nets (2026-08-15)

**Context.** `spentSoFarCents` is the sum of surviving category
nets (`spendingByCategory` drops a net-refunded category to
zero). The rate credit was a per-merchant sum of raw rows.
#391 detected when they crossed and took no credit — safe
(over-project) but still two questions. A healthy-category
bill riding next to a dropped-category bill stayed inside the
daily rate.

**Decision: still-due and the rate credit are different
questions.** Still-due stays "did this month's charge land?"
(merchant posted, capped at the bill). The rate credit
attributes through the surviving category nets from the SAME
`spendingByCategory` call that produced `spentSoFarCents`. A
posted bill whose category was netted out is not demanded
again and is not subtracted from a total it is not in.
Exclusive categories are credited before contested ones so a
shop+bill merchant cannot exhaust its cap on a shared leftover.
Per-merchant remaining caps travel across categories so a $15
bill split across two leaves cannot take $30 out of the rate.
The #391 crossing guard stays as a last resort in the same
failure direction (take no credit, never clamp the rate to
zero).

**Copy.** Branch B said matched bills were "already counted".
That claimed they sit in the month total. C.20 makes the
branch reachable when a matched bill's category was dropped.
The sentence now says they have "already posted".

**Rejected.** (1) Keep the crossing guard as the fix — it
zeroes every credit once any merchant raw sum exceeds the
total. (2) `Math.max(0, spent − credited)` — deletes unrelated
spending; under-projecting is this surface's dangerous
direction. (3) Couple still-due to the reduced credit — would
re-add a posted bill the category drop already removed.

**Locked.** `tests/unit/trends-pace-bills.test.ts`
`test_regression__c20_*` (surviving nets; partial refund;
exclusive-before-contested); the rewritten P1-2 fixture now
also locks still-due = 0; `trends-labels.test.ts` branch B
"already posted".

## #480 — C.22: detect each payment-account feed, then union (2026-08-15)

**Context.** After the 2026-07-21 re-link, radar committed-merchant
detection scoped POSTED rows to the live payment id (183 vs 402).
The income fix remaps predecessor rows onto that id and SUMS.
The same remap fed to `detectRecurring` took **9 series to 4**
(income-replay C.22 block): one merchant under two feeds shares
a canonical, and the old feed's irregular dates or extra amounts
poison the new feed's clean series. A reflex income remap would
have moved five merchants INTO discretionary burn.

**Decision: detection and burn sums are different questions.**
Detection runs `detectRecurring` once per account in the payment
component, then unions the canonicals. Neither feed's descriptor
wins. Burn sums and history days use the income remap
(`remappedPaymentRows`) and collapse the released handover day
so one charge is not counted twice. `terminalOf` rides on the
snapshot next to `handoverKeys` (same boundary call).

**Rejected.** (1) Merge the two feeds' canonicals before one
detectRecurring — that IS the concatenate, and it is what
destroys series. (2) Pick a winning descriptor. (3) Detect on
the live id only — keeps the short tail for history days
(25 days after the re-link, below the 28-day burn floor).

**Locked.** `tests/unit/radar-committed.test.ts`
`test_regression__c22_*` (union keeps Netflix; concatenate
dies on three amounts; successor-only without links; card
predecessor excluded; history days 14 → 106; handover day
$50.00 not $100.00).

## #481 — G.2: audit probes compile under the verify gate (2026-08-16)

**Context.** `tsc --noEmit` never compiled `scripts/audit-probes/**/*.mts`
(`tsconfig.json` include is `**/*.ts`). That invisibility shipped two
money-visible probe bugs (O.20g keep-object no-op; O.20a first-draft
same shape). The row's first compile of the dedicated project then
found the sibling: `income-replay.mts` passed `countsInFlows` to
`.filter`, so the array index became `excludedFlowIds`.

**Decision: a dedicated `tsconfig.probes.json`, not the root include.**
Root `tsc` is the Next app. Probes are Node scripts (`node:fs`, `pg`,
top-level await). Mixing them into the app project would couple two
compile jobs and let a probe error look like an app error. `verify.sh`
runs both. Stale type drift (required `currentBalanceCents` /
`feedDroppedAt`, branded `ISODate`, `planTransferUpdates` arity) was
triaged in place. A wrong-call site's cited output is UNVERIFIED until
the probe is re-run against production (no `.env.prod.tmp` this
session). `feedDroppedAt: null` on probes that never selected the
column preserves their original "did not rank by genuineness" meaning.

**Rejected.** Adding `**/*.mts` to the root include. Leaving the
one-off `--project` check as a comment.

**Locked.** `tests/unit/g2-probes-compile-set.test.ts`
`test_regression__g2_*` (include glob; verify.sh invocation;
`keep({…})` and `.filter(countsInFlows)` greps).

## #482 — O.17a: money dials key by category id (2026-08-16)

**Context.** `User.moneyDials` was a JSON `string[]` of free-text names.
Settings was a textarea; /budgets and /trends matched display name or
built-in name (O.17). A rename could still detach the marker, two
categories could share a label, and a typed name could mark a category
the reader never chose. Cut proposals compared those names to
`categoryId` and therefore never protected a dial.

**Decision: same TEXT column; writes store ids; names resolve on read.**
No schema change. The picker posts `moneyDialId` checkboxes; validation
accepts only budgetable catalog ids (cap 12). On read, an exact id
wins; a leftover name maps only when it uniquely matches the current
display name or the built-in name. Ambiguous or unknown tokens are
dropped — never guessed. Coach copy still receives display names;
discretionary cuts and the gauge markers receive ids. Hidden categories
stay eligible so a selected hidden dial can be cleared; the picker
shows a hidden row only when it is already selected. Demo seed stores
`["travel","dining"]`; existing name rows keep working via the read
path.

**Rejected.** Eagerly rewriting stored names to ids (an unknown you can
still fill beats a guess you cannot unfill). A new column. Matching
names on the write path.

**Locked.** `tests/unit/o17a-money-dial-ids.test.ts`
`test_regression__o17a_*` (id survives rename; built-in and current
name map; ambiguous "Travel" dropped; unknown dropped; custom id/name).

## #483 — W.8: every COACH_COPY key enters the guardrail scan (2026-08-17)

**Context.** The completeness test found seven function-valued keys
outside `ALL_STRINGS` (`reviewNextAction`, `reviewPersonalizedBadge`,
`nextActionCancelSub`, `nextActionTransfer`, `nextActionAutomate`,
`digestNothingDueWithUndated`, `digestUndatedAlongsideDues`) and pinned
them in `KNOWN_UNSCANNED`. The shame, projection-assumption, and ticker
sweeps never saw those strings. Four of the seven were already scanned
as composed `nextAction:*` rows whose label prefix is `nextAction`, so
the completeness check could not count them.

**Decision: register the keys by name; empty the pin.** Representative
args include both digest count branches and the frozen-funding transfer
branch (second strings those functions produce). Existing composed
`nextAction:*` rows stay — they still scan the wrapper+inner pair.
Copy is unchanged; the sweeps passed on the existing sentences, so no
string was rewritten.

**Rejected.** Editing copy to "pass" a sweep (none failed). Dropping
the composed rows (they scan a different string). Leaving a non-empty
pin.

**Locked.** `tests/unit/coach-copy.test.ts`
`test_regression__w8_every_coach_copy_key_is_scanned` (`KNOWN_UNSCANNED`
is empty; a new key without a row fails).

## #484 — W.4: route a wealth target through Ask (2026-08-17)

**Context.** W.1 shipped `solveWealthTarget` and the /coach card. The
owner's question ("if I want to save up to 10 mil … what do I need to
do?") is the plan-in-words shape the three sibling solvers already
have. Ask did not route it: `savings_goal_by_date` requires a date and
uses the linear /goals model, which would demand ~$27k/mo for $10M
over 30 years.

**Decision: fourth intent `wealth_target`.** Amount is re-derived by
`parseTargetAmount` (now reads `mil` and a spoken count + magnitude:
"10 mil", "$10M", "ten million"). No date → compounding planner, same
two solves the card runs (open-ended pace, then required monthly at
`seededHorizon`). A named date stays on `savings_goal_by_date`. The
LLM path swaps those two when the model's kind and the words disagree.
Copy is selected from existing `COACH_COPY.wealthTarget*` strings.
Source is `/coach`. No save action.

**Rejected.** Pointing $10M at `solveSavingsGoalByDate` (W.1's reason
for a fourth solver). A dollar-threshold that decides which solver
wins (vocabulary + date vs no-date decides). Inventing a deadline.
Authoring new Ask copy.

**Locked.** `tests/unit/assistant-wealth-target.test.ts`
`test_regression__w4_owner_question_routes_to_wealth_target` plus
abstention majority (compound number-word, fraction, comparison,
negation, unresolved year).

