# STATUS — known limitations & open items

Living document; updated at each phase boundary and critic cycle.

## ✅ BUILT 2026-07-25 — L.11(C): Safe-to-Spend becomes guilt-free spending (DECISIONS #295/#307)

The owner-decided IWT reframe. New formula: guilt-free = expected income − spending outside
credit cards − upcoming bills (per remaining OCCURRENCE — a biweekly paycheck with two paydays
left counts twice) − card obligations DUE THIS CALENDAR MONTH (the cash-needed engine's own
`perDueDate` rows, month-filtered) − max(goal contributions, the new Settings savings-% target
`User.savingsTargetBps`, nullable additive — the one schema change). Income and expenses BOTH
exclude credit accounts: a card row reaches the plan only through its obligation, so a purchase
is never charged twice and a cashback is never double-benefited. Four disclosure kinds ride the
plan (undated OWING cards / statement-pending cards due this month / both-live duplicate pairs /
frozen cards), resolved against the summed row set, rendered on the dashboard card, /spending-plan
and the Ask answer with every direction word stated for THE FIGURE THE BRANCH RENDERS (the
overspent branch shows the overage, so "lower/higher" flips with it). The Glass-Box trace is a
five-term identity; `cardObligationsEstimated` rides the plan so no surface can claim statement
provenance over the estimate path. The three inverse planners take the target's
`unallocatedSavingsCents` (REQUIRED) and name the reserve instead of declaring "beyond budget"
over money already set aside — claiming only the fraction the reserve actually covers. Parser:
"safe to spend" stays a permanent alias; the new guilt-free alias is gated off past-tense
questions ("Guilt Free Bakery" is a merchant).

**Three critic cycles, all pre-ship.** Cycle 1 (two parallel fresh-context critics: money-math /
copy honesty): FAIL — cross-month double-reservation of a statement; an estimate-path card due
this month excluded from the term AND every disclosure; the solvers double-reserving the savings
target; the demo's biweekly income half-counted (pre-existing, sign-deciding); cashback counted
as income while shrinking the statement; direction-inverted qualifiers on the overspent branch;
false statement provenance; the alias mis-route; an overpaid undated card given the wrong
direction. ALL fixed + 8 REGRESSION_LEDGER rows. Cycle 2 (fresh context, aimed at the fixes):
1 P1 (the Ask answer — the one untraced surface — dropped the estimate flag) + 2 fixable P2s
(dashboard frozen note missing; the reserve sentence overstating coverage), all fixed + 2 more
ledger rows; the window boundary, occurrence math, direction matrix and demo numbers were
hand-verified to the cent and held.

**Decided deliberately: the demo now opens on "Over plan by $2,468.83"** (June-due statements
$5,412.33 vs $4,900 income). The math is hand-verified; the seeded dataset is a realistic
revolver; hiding the state would re-create the exact contradiction this slice removes. The hero
beside it still shows the balance-based question (covered but ~$1,012 short at the worst point) —
different windows, each stated on its surface.

**Gate:** `bash scripts/verify.sh` GREEN; full vitest **275+ files / 4300+ tests** (exact count
in the final verify below); affected e2e serialized (spending-plan, glass-box, ask) **24/24** on
a fresh build, including the five-line reconciliation.

### 🟠 STILL OPEN after L.11(C) — recorded residuals

1. **A loan/mortgage payment with NO detected recurring series is counted ZERO times** in this
   plan (the demo's auto-loan ACH and any real loan whose checking-side series was never
   detected). Where a series IS detected it arrives via `upcomingBillsCents` (the auto-loan
   exception); adding `loanObligations` blindly would double-count those, so the honest fix
   needs series↔obligation matching. Guilt-free is overstated by such payments.
2. **A scheduled "auto-transfer to savings" is a bill until it posts, then nothing** (cycle-2
   F2-8, pre-existing): the posted transfer is excluded as `isTransfer`, so guilt-free jumps by
   the transfer amount the day it clears; and a user who ALSO sets a savings-% target counts the
   same intent twice (the max() dedup covers goals-vs-target only). Real ingest paths cannot
   create such a scheduled row today (the detector drops transfers), so this is seed/manual-row
   territory — recorded, not fixed.
3. **Stale-anchor edges** (cycle-2 F2-5/6, bounded by the recurring refresh that runs on every
   sync): a stale-anchored bill leaves every term; an early-posting biweekly paycheck can count
   once as received and once from its anchor. Documented on `scheduledOccurrencesInWindow`.
4. **The non-credit filter excludes only CREDIT accounts** (cycle-2 F2-9): a positive on a LOAN
   account that the transfer pair-detector misses would count as income; INVESTMENT-account
   dividends counting as income may even be intended. No real-path fixture produced the loan case.
5. **The reserve is this month's income × bps presented beside multi-year monthlies** (cycle-2
   F2-11) — an approximation, mitigated by "Illustration, not advice" and now phrased "of this
   month's income".
6. **The dashboard card's three disclosure notes have no unit/e2e coverage** (the demo has no
   undated/duplicate/frozen card, so the passive gates never render them) — the Ask builder and
   the server disclosures are locked; the card's JSX branches are type-checked only.
7. **At household scope the dashboard hero shows the MERGED cash-needed figure** while this plan
   is personal by construction; coherence is claimed only against the viewer's own rows, and the
   trace basis says so — a household-scope guilt-free view is future work.

## ✅ SHIPPED 2026-07-25 (#313) — L.21: the adversarial pass L.20 owed (critic cycle 1 — FAIL, all fixed)

L.20 shipped verified but **without a hostile-critic pass** (the owner redirected mid-slice). This is
that pass. **Three fresh-context critics ran in parallel** on `3139bfa` with different lenses — copy
honesty; wiring and narrowings; the silent half — and every finding was **reproduced against the
real code before it entered a fix**, per the standing rule that a delegated verdict is a hypothesis.
**Verdict: FAIL — 1 P0 + 8 P1 after dedupe. All fixed and locked.**

**All three critics independently found the same gap.** The `undatable-loan` sentence was
interpolated only into the `reminders.length === 0` branches of the reminders card and the digest.
That is right for a frozen card or a dated loan — each appears in the list when something is due and
qualifies itself — but an undatable loan can **never** be a reminder, which is the row's entire
premise, so the empty branch was the only place it was ever spoken and one unrelated bill silenced
it. The mixed case is the likelier one and the cost is a missed mortgage payment. Only that kind is
repeated in the non-empty branch; the other two stay resolved against printed bullets.

**The deepest finding was a narrowing nobody had listed.** `ReturnMomentRadarInput` is a hand-built
payload over a closed three-field type — exactly the shape L.20 went hunting for — and it dropped
`startingBalanceFrozen`, the field L.20 itself had just added. `kind: 'clear'` is precisely
`firstNegativeDate === null`, which is precisely what a balance frozen HIGH manufactures, so the card
printed **"Your cash flow looks clear — no shortfall ahead on the horizon"** off a projection blind
to its own starting account. It renders **only** for a reader returning after more than a week away:
the population most likely to have had a feed drop while they were gone. Both radar states now carry
the fact, in opposite directions (on `clear` the silence is the point; on `warning` the dip may come
sooner and deeper).

**Two false claims in the copy itself.** The sentence said "we have no due date **or** payment amount
for it" about every undatable row — false whenever only one is absent, and one-absent is the
**commonest** shape a bank sends: a loan reported with a payment and no due date, whose payment the
app prints on /accounts. `missing: 'due-day' | 'payment' | 'both'` now rides the row and rows that
disagree about it cannot share a clause. And it reintroduced the positional **"here"** that L.19 had
removed from this very builder 45 lines above, on a builder one of whose callers is an **email**.
The closing clause was also rewritten to state necessity without sufficiency: while the account is
unshared no due date can arrive — not that reconnecting will produce one, which is false for a loan
the bank simply never dates.

**Three defects in the PDF — the one artifact that cannot correct itself.** (1) Its frozen
disclosure was **clipped off the right edge**: measured **861.6pt against 516pt** of usable width, so
the scope clause and the entire remedy never rendered and the visible half ended mid-word on "still
co". `pdf-lib` does not wrap and `draw()` passed no width. Extracting the copy for testability had
moved the assertion one layer *away* from the artifact — layout is the only failure mode unique to a
PDF, and it was the only one untested. (2) A **MORTGAGE printed as a positive number**, so the
account rows disagreed with the report's own net-worth headline by twice the mortgage; the line
compared against `CREDIT || LOAN` while `netWorthCents` subtracts all four `LIABILITY_TYPES`, both
missing types being user-creatable from the manual-account form. (3) A **superseded predecessor** was
called "still counted in the net worth and trend in this report" three lines under printing it at
`$0.00` — the identical defect already found, fixed and commented in three other files, missed in the
fourth.

**Two more, on the Today feed.** `emptyReason` was computed as `headline ? null : …` while the card
recomputes `headline` client-side over its own session-dismiss filter — so dismissing the last row
restored a bare "Nothing needs you today." over a card the engine had just said it could not date.
It is now composed unconditionally: the engine writes the qualified sentence, the surface decides
whether to show it. And the feed's all-clear knew about undated cards and the frozen funding account
and **no other frozen row**, while the card below it qualified the same claim — `frozenDues` is now a
REQUIRED `NudgeInput` field, built once and handed to both surfaces.

**Gate:** `bash scripts/verify.sh` **GREEN** — tsc 0 / eslint 0 / **4280 unit across 274 files** /
build clean. Full e2e **201/201 serialized** (the parallel run reproduced the documented
load-induced flake — `settings-dials` corrupted-value, `duplicate-connections`, `reconcile` — and all
three pass alone). **Fail-old proven** on the mixed-case fix by mutating it out: exactly one test,
the new one, turns red. **No schema change** — `git diff origin/main..main -- prisma/` is empty.
DECISIONS #306; eight REGRESSION_LEDGER rows.

**Deploy: VERIFIED LIVE.** `dpl_EroVxWej29moLFFoapoLxQCDwsrL` reached `● Ready`, target production,
and carries `www.aimplifi.app` and `aimplifi.app`. Honest limit on the proof, unchanged since L.19:
every route this work touches is auth-gated (`/` and `/dashboard` both answer 307 to sign-in) and the
new copy renders only for a user who actually has a frozen account, so there is no unauthenticated
string unique to this commit to grep — the evidence is the READY state on the aliases plus the local
gate, not a curl of rendered copy.

**The first deploy of this commit FAILED and it is worth recording why.** `dpl_5EsmeYxKdhDkrieXXyXvWXP9BKdZ`
errored with `P1001: Can't reach database server at ep-proud-sound-atpgfoct…neon.tech:5432` during
`prisma db push`. Not a code failure — a plain redeploy of the same commit went green two minutes
later, so the Neon compute was briefly unreachable (a cold start or a short incident). The point to
remember: **the build command runs `prisma db push` on EVERY deploy, whether or not the commit
touches the schema**, so an unreachable database fails the build of a pure-code change. The
production aliases stayed on the previous deployment throughout, so the live site was never broken —
which is also why a push succeeding proves nothing on its own.

### 🟠 STILL OPEN after L.21

1. **The radar, /forecast and /calendar omit an undatable loan from their projections entirely** and
   say nothing — so the radar's cover transfer ("move $X by DATE"), the app's only instruction naming
   an amount to move, is understated by that payment every cycle. Deliberately **not** fixed here:
   it is a pre-existing omission rather than an L.20 regression (an undated loan never entered those
   walks), and the honest fix is a new disclosure on two more engines plus a fourth mechanism
   sentence. Same family as item 2 — they belong in one slice.
2. **A LIVE undatable loan** still reaches no list. Its gap is a different claim with a different
   remedy (the bank is still talking to us; the field may yet arrive), so folding it into the
   `undatable-loan` wording would name the wrong mechanism.
3. **/investments and the debt-payoff path** — figures only; `DebtInput` needs a widened type and
   `getInvestments` does not select `feedDroppedAt`.
4. **The CSV exports** — deliberately unchanged. A two-column machine format has no honest slot for
   prose; whether to add a column or a companion note is a FORMAT decision that belongs with whoever
   owns the export contract.
5. Smaller, carried forward: `frozenCardsNote`'s multi-row form says "N of these cards" on a grid
   that also paints loans; `CardSnapshot.frozenSince` is still optional while `paymentAccount.frozenSince`
   beside it is required; and the same fact can render up to four times on one dashboard (each
   instance correct and attached to its own figure, but never checked page-wide).
   **Corrected here:** L.20's STATUS flagged `frozenFundingNote`/`frozenNoWarningNote` as possibly
   saying "your bank" about a partner's account. A critic **refuted** that with an executed test —
   the funding account is always the viewer's own, enforced by an explicit override at household
   scope. The real residual is narrower: those two builders take no `ownership` argument while every
   sibling does, so the guarantee lives in a call-site comment rather than in the type.

## ✅ SHIPPED 2026-07-25 (#312) — L.20: the narrowings that strip the fact, and the loan nobody could name

Three of the five surfaces L.19 left open, taken together because they are **one disease**:
`feedDroppedAt` rides the money out of the providers and is then dropped at a server-side
**narrowing** — so a figure computed from a balance the bank stopped sending arrives at the reader
with nothing attached.

**(1) The dashboard Today feed** — the sharpest of the three, because it prints the two INSTRUCTIONS
the dashboard gives: “About $X short by DATE” and “A transfer of about $X would cover it”.
`Proposal` gains `fundingFrozen` on the `autopayCents` idiom (verbatim, per-kind, null on every kind
not projected from that balance). The dip takes the **radar’s** starting account and the shortfall
takes `cashNeeded.fundingFrozen` completed with the surface’s own `paymentAccountName` — never each
other’s: the two engines are handed the same account on today’s dashboard and nothing guarantees it,
and a disclosure naming the wrong row is worse than none.

**The half that matters is the silent one.** A balance frozen HIGH reports shortfall $0 and produces
no dip, so *both* builders return null and the feed prints “Nothing needs you today.” over a
projection that cannot see the account it is projecting — the L.19 /calendar P1-1, one surface
along. `NudgeFeed.fundingFrozen` carries it: resolved against `ordered` (what will actually render)
rather than the builder locals, **exclusive** with the per-proposal field so the sentence appears
exactly once, and deliberately **not** gated on the feed being empty — one unrelated opportunity at
the top would otherwise re-open the hole. It reads BOTH sources, because the radar can be walking a
frozen account with no cash-needed result beside it.

**A new sentence, not a borrowed one.** `frozenProjectionNote` opens “This projection starts from…”
and this feed renders no projection — the antecedent-less phrasing L.19 corrected twice.
`frozenNoWarningNote` is about the **absence of a warning**, and may not call the feed empty either.

**(2) An undatable frozen loan can finally reach an all-clear** — the residual the L.19 wiring critic
found. `selectLoanObligations` refuses to date a loan without both a positive payment and a due day
(correctly — the engine never fabricates a date), but nothing carried the refusal out, so it reached
no dues list, no reminder and no all-clear. `selectUndatableFrozenLoans` is its exact complement, and
`FrozenNothingDueRow.kind` gains `'undatable-loan'` — a **third mechanism**, because the loan wording
is false about it twice over: it names a stored payment and due date as merely stale when there is
none, and implies the gap could close on its own when the bank that would send one has stopped
sharing. **Frozen only**, deliberately; the two loan kinds share a dedupe namespace, because one
account claiming both “stale due date” and “no due date at all” is a self-contradiction on one screen.

**(3) The net-worth PDF** — a durable artifact handed to a lender, with no way to correct itself.
`feedDroppedAt` is now REQUIRED on the report payload (so the compiler asks), the row is marked
inline, and the summary names BOTH figures the frozen balance is inside — the headline and the trend
— with `nextStep: 'open-app'`, since a file holds no control. The footer asserted **“Balances reflect
the data source at export time”**, which is affirmatively FALSE about a frozen row; it now declines
to claim a currency it was never checking for, rewritten to be true **unconditionally** rather than
branched. Its copy was extracted into pure exports — money copy inside a binary artifact is otherwise
testable only by grepping compressed PDF bytes, so in practice it would not be tested at all.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **4276 unit across 274 files** / build
clean. New e2e `today-feed-frozen.spec.ts` **4/4** (the quiet case, the instruction case, the
abstention, and the undatable loan). **Fail-old proven in BOTH directions**: silencing every L.20
decision point fails **13** assertions, making them speak unconditionally fails **12**. **No schema
change** — `git diff --stat -- prisma/` is empty, so the live database is untouched. DECISIONS #305;
eight REGRESSION_LEDGER rows.

**This slice does NOT claim a hostile-critic pass** — the owner redirected mid-slice to a new feature
request (the Conscious Spending Plan settings section) before the critic cycle ran. The work is
verified and shipped; the adversarial pass is owed.

### 🟠 STILL OPEN after L.20

1. **/investments and the debt-payoff path** — figures only. `DebtInput` has no frozen field and
   `getInvestments` does not select `feedDroppedAt`, so both need a widened type rather than copy.
2. **The CSV exports** (net worth, transactions) — deliberately not changed. A two-column machine
   format has no honest slot for prose: a leading comment row breaks every parser, and a per-row
   constant column is noise. Whether to add a column or a companion note is a FORMAT decision, not a
   copy one, and it belongs with whoever owns the export contract.
3. **A LIVE undatable loan** reaches no list either. Its gap is a different claim with a different
   remedy (the bank is still talking to us; the field may yet arrive), so folding it into the
   `'undatable-loan'` sentence would name the wrong mechanism — it needs its own.
4. Smaller, carried forward from L.19: `frozenCardsNote`’s multi-row form says “N of these cards” on a
   grid that also paints loans; the calendar’s two banners name one account differently; and
   `CardSnapshot.frozenSince` is still optional while `paymentAccount.frozenSince` beside it is
   required. New here: `frozenFundingNote` and `frozenNoWarningNote` both say “your bank”, which at
   household scope could be a partner’s funding account — consistent with L.18’s existing stance on
   that builder, and worth one ownership pass across all three together rather than a fourth
   one-surface fix.

## ✅ SHIPPED 2026-07-25 (#311) — L.19: /calendar speaks, and a frozen LOAN can finally reach an all-clear

Two of the five surfaces L.18 named open, taken together because they share one primitive: **the set
of frozen DUES a surface prints**, which L.18 built from cards alone.

**The loan gap.** `frozenSince` has ridden `LoanObligation` since L.18 — and then every surface built
its frozen list from `result.cards` + `unknownDueDateCards`. But "You're all caught up" (dashboard)
and "a clear week ahead" (digest) are claims about `reminders`, and `selectPaymentReminders` mixes
loans into that list. A frozen loan's stored `dueDayOfMonth` is precisely the field the bank stopped
confirming, so it is the likeliest reason an all-clear is wrong, and it was the one row that could
never be qualified. `FrozenNothingDueRow.kind` is now REQUIRED, because the two claims describe
different mechanisms and cannot share a sentence: a card's gap is a **statement** that could not
reach us; a loan issues no statement, and its gap is a payment amount and a due day that stopped
being confirmed.

**One builder, because two hand-rolled copies are how one gap opened in two places.** The dashboard
and the digest each built the list inline, near-identically. `frozenNothingDueRows` now builds it
once; the ownership map stays at the call site, because only the caller knows whose scope it read.

**/calendar** — the highest-consequence surface of the five, because it prints a dated amount to pay.
Resolved against the due events the displayed **month** actually paints, so paging to a quiet month
is silent; the title counts **accounts**, not events.

**A pre-existing P1 found while mapping, and fixed because /calendar depends on it:** `frozenLoanNote`
hardcoded "Your bank" and "Check it with your lender before paying", and `payment-reminders-card.tsx`
was **already** calling it on a partner's shared loan — only the next step was ownership-aware.
L.18's critic P1-1 closed exactly this for cards and left the loan branch untouched.

### Critic cycle 1 — FAIL: 3 P1 + 3 P2 + 2 P3, all fixed and locked

Two fresh-context critics ran in parallel (copy honesty; wiring and regressions).

* **P1-1 — the calendar prints one instruction no due row accounts for.** "Projected low: $X —
  transfer $Y by DATE to stay covered" is walked forward from the funding balance. With every card
  and loan live but that balance frozen, the first cut returned `null` and the page disclosed
  **nothing** — and the quiet direction is the expensive one, because a balance frozen HIGH produces
  no dip line at all. `funding` and `shows` are now required arguments.
* **P1-2 — on a calendar the DATE is the product, and it can be one the app manufactured.**
  `buildObligation` clamps an already-passed due date to today, and a frozen card gets no new
  statement to move it back. The card note qualified only the amount; `frozenLoanNote` had made the
  date claim for loans since L.18. New `frozenCardDatesNote`, with the estimate path named
  separately because its date comes from a different stale field.
* **P1-3 — the dashboard dropped what the digest printed.** The frozen qualifier was appended only
  to the clean all-clear, so a reader with an undatable card AND a frozen account was told about one
  gap and not the other, while the email from the same rows said both.
* **P2 —** two identically-named loans rendered two byte-identical sentences (the `nameSet`
  collision rule was bypassed on the loan path) with duplicate React keys; the dedupe key was a bare
  account id shared across kinds; and the all-clear repeated its remedy once per sub-list.

**A fix of mine that a test caught before it shipped.** Tidying that last repetition, `joinClaims`
dropped the trailing clause from every claim but the last — true of the coverage caveat, false of
the **remedy**, which differs per owner. The reader's own claim comes first, so "Open Aimplifi to
see the connection" was deleted outright, leaving a household reader told only that somebody else
could fix somebody else's account. A tidy-up that removes the only actionable sentence is a worse
defect than the verbosity it fixes.

**Two corrections to my own comments, both from reading the engine instead of trusting a neighbouring
comment.** The dedupe was justified by "`result.cards` holds one obligation per statement, so a card
appears twice" — false: `computeCashNeeded` pushes exactly one `buildObligation` per card. The
invariant is still held (a card can paint two due EVENTS in one month) but the stated reason was
wrong, and the test asserting it is now labelled as a helper invariant rather than a live repro. The
multi-row all-clear also said "N of the cards here" on four surfaces that render **no** list — "here"
had no antecedent anywhere, and no test pinned the string.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **4250 unit across 273 files** / build
clean. New e2e `calendar-frozen.spec.ts` **6/6**, including both abstentions and the frozen-funding
case. **Fail-old proven in BOTH directions**: silencing the builders fails **23** assertions, making
them hedge unconditionally fails **9**. **No schema change** — `git diff --stat -- prisma/` is empty,
so the live database is untouched. DECISIONS #304; eight REGRESSION_LEDGER rows.

**E2E note:** the full serialized run was 195 passed / 1 failed (`transactions.spec.ts:145`), which
passes 18/18 in isolation — the documented #287 rotating-victim flake, on a route this slice does not
touch.

### 🟠 STILL OPEN after L.19 — ranked

1. **The dashboard Today-feed nudges** — "About $X short by DATE" / "A transfer of about $X would
   cover it", built from the frozen funding balance. Mitigated: the cash-needed and radar cards
   directly below carry the disclosure. The nudge `Proposal` shape is a closed field set with no
   free-text slot, so wiring it is a real change rather than a call-site edit.
2. **The PDF/CSV export** — `netWorthReportPdf` prints balances from a 5-field payload that drops the
   flag, and its footer asserts "Balances reflect the data source at export time", which is
   affirmatively false for a frozen row. A durable artifact handed to a lender, carrying no way to
   correct itself.
3. **An UNDATABLE frozen loan still cannot reach the all-clear** (new, found by the wiring critic —
   and it is the worst case of L.19's own thesis). `selectLoanObligations` emits nothing when
   `dueDayOfMonth` is null or the payment is ≤ 0, so a loan frozen *before* the bank ever sent a due
   day produces no obligation, no row, and no sentence. Cards carry the exact analogue out through
   `unknownDueDateCards`; loans have no equivalent. Deliberately not fixed here: the fix needs
   `feedDroppedAt` threaded into an account payload that currently drops it — the same plumbing item
   2 above needs, so the two belong in one slice.
4. **/investments** and the **debt-payoff path** — figures only; `DebtInput` has no frozen field, so
   this needs a type widened rather than copy.
5. Smaller, recorded not fixed: `frozenCardsNote`'s multi-row form says "N of these cards" on a grid
   that also paints loans and scheduled bills; the calendar's two banners name one account
   differently (the duplicate banner quotes the event label "Chase Sapphire due (est.)", the frozen
   banner the identity "Chase Sapphire"); and `CardSnapshot.frozenSince` is still optional while
   `paymentAccount.frozenSince` beside it is required (no live gap — the only production constructor
   always sets it).

**Structural note from the wiring critic, worth keeping:** `scripts/verify.sh` runs Playwright only
under `VERIFY_E2E=1`, so a green default verify would have declared this slice done while its own new
e2e was red against a drifted golden. The e2e was run explicitly here; the default gate cannot see
that class of drift.

## ✅ SHIPPED 2026-07-25 (#310) — L.18: the surfaces that printed a figure from a frozen account and said nothing

L.14 taught the app that an account its bank has stopped sharing keeps counting **by design**, and
disclosed that on /accounts and the dashboard. It disclosed the two *dependent* cases — a card's own
obligation and the funding account the whole projection rests on — once, in the cash-needed engine's
`assumptions`, under a comment claiming that array reached "/cards, the dashboard hero, the calendar,
the Ask answer and the weekly digest".

**Two surfaces render that array.** The four it named as covered were four of the ones still
printing "pay $X by DATE", a net worth, an FI projection and a runway from balances that had stopped
moving.

**The fix is structural, not a sentence pasted six times.** `frozenSince` now rides the OBLIGATION
(`CardObligation`, `UnknownDueDateCard`, `LoanObligation`, `PaymentReminder`) and `fundingFrozen`
rides `CashNeededResult` — all REQUIRED, so the fact travels with the money to every consumer with
no new query and no argument a caller can forget. Each surface then states **its own** claim, with
three things as required arguments because guessing any of them has already shipped a defect here:
`role` (a figure the reader weighs vs an instruction they act on), `nextStep` (what this surface can
honestly point at — an email controls no position and holds no button), and `ownership`
(`reader`/`partner`/`unknown`).

Closed: **/cards** (per-row note, a qualifier on the one "Do this first" instruction, the undated
panel's bare balance, and the all-clear headline), the **dashboard payment-reminders card**, the
**reminder email** and **weekly digest**, **web push** (payment-due and the radar alert), **Cash
Flow Radar**, **/forecast**, the **Ask answer** and **both audit traces**, and **/coach**.

**Three corrections came out of re-reading the code rather than the comments:**

1. A frozen card **with a statement** does not derive its figures from the frozen balance — the
   engine reads the statement and never touches `currentBalanceCents`. What is actually missing is
   everything since the drop, *including a payment already made*, which is the claim that covers
   both paths.
2. `requiredCents` never reads the funding balance, so "every figure here is projected from it" named
   a dependency that does not exist. It names the shortfall and the transfer now, which do.
3. **The brief itself was wrong**: L.18 said the frozen balance drives the FI number. It does not —
   `fiNumberCents(annualExpenses, swrBps)` reads no balance at all. A test holds a frozen brokerage
   worth $4,210.55 beside an FI number of $0.00. /coach qualifies the portfolio-derived and
   cash-derived figures and deliberately leaves that one alone.

**And the gap L.14 left open, found by sweeping rather than by reading the brief:** `computeRadar`
withheld a frozen account as a transfer *source* and said nothing about the balance its entire
90-day walk **starts** from — the number that decides whether there is a dip at all, when it lands,
and how large the transfer is. Its frozen-HIGH case produces no alert whatsoever, which is the
quiet, expensive direction. Now disclosed in both states, with a different sentence for each, and
/forecast (structurally the same walk, with nothing else on the page to qualify it) alongside it.

### Critic cycle 1 — FAIL: 2 P0 + 4 P1 + 6 P2/P3, all fixed and locked

Two fresh-context critics ran in parallel. Both P0s are the same mistake this slice exists to
correct, one level down:

* **P0-1** the engine's frozen-card sentence was resolved over every card it was *handed*, so an
  undatable card — in no figure at all, two lines under its own "excluded from every figure here"
  assumption — was announced as the source of "the amount asked for here". Now resolved against the
  rows summed into `requiredCents`.
* **P0-2** `applyReconciliationBoundary` zeroes a superseded predecessor's balance and keeps every
  *other* field, so the Ask answer said a $0.00 row's last figure was "still counted in your net
  worth" — on the panel a reader opens to audit that number. /coach had the guard; the assistant did
  not.

The P1s were all one class — a sentence true on the surface it was written for and false on another:
a **partner's** shared card told the viewer "Your bank … check the card with your bank before
paying" and then "only the household member who owns it can reconnect it"; the digest and dashboard
all-clear built their lists from a **household-scoped** result and used own-scope copy; a frozen
**loan** was told a card's story about payments nothing subtracts; and /cards' all-clear passed the
**raw** card name where every other note passes the painted one, so two cards both called "CREDIT
CARD" were named twice, identically, inches from the headings that tell them apart.

**Found by my own abstention test, not by a critic:** after making the per-row email sentence
partner-safe, the block's title and closing line still said "your bank". The test that asserts what
the copy must **not** say is what caught it.

### Critic cycle 2 — my own fixes broke three things

A third fresh-context critic re-executed every cycle-1 fix and hunted for what they broke. It
confirmed six of them closed (including the superseded guard in both directions and the loan claim
across all three channels) and found that **the P0-1 fix over-shot**: narrowing to the rows summed
into `requiredCents` dropped `upcoming`, and those are the estimate-path obligations whose amount
*is* the frozen balance verbatim — the hero prints them as "est. — next cycle" beside a surviving
assumption that names that figure and calls it "the current balance". Before the fix that card was
named; after it, it was not. It also caught `traceCashNeeded` hardcoding `ownership: 'reader'` on
the strength of a comment (the dashboard hero renders the *merged* result), a mixed own/partner list
re-enabling every reader-only clause, and — in the same pass that fixed the push-ordering demotion
for payment reminders — the identical demotion introduced one branch down on the radar alert.

**This slice does not claim a critic pass.** Two cycles ran; the surfaces below are named open.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **4213 unit / 273 files** / build
clean. New lock `frozen-figure-surfaces.test.ts` drives the real engines end to end plus real Prisma
for /coach; new e2e 2/2. **Fail-old proven in BOTH directions**, because a disclosure can fail by
silence or by false hedging: silencing the builders fails 19 assertions, making them speak
unconditionally fails 6. **No schema change** — `git diff --stat -- prisma/` is empty, so the live
database is untouched by this deploy. DECISIONS #303; six REGRESSION_LEDGER rows.

**E2E note:** the full run reports 186–187 passing with 3–4 failures that are a *different set each
run* (budget-targets, combined-accounts, reconcile, feed-dropped-account). Every one passes
serialized in isolation, and `combined-accounts.spec.ts:84` reproduces **identically on a stashed
clean HEAD** — the documented #287 /accounts DOM-duplication flake. New information for that entry:
isolated and serialized, that one test now fails consistently rather than intermittently.

### 🟠 STILL OPEN — surfaces that still print a balance-derived figure unqualified

Named rather than silently skipped, ranked by money consequence:

1. **/calendar** — the highest-consequence one still silent, because it prints a dated amount to
   pay: `result.cards` (estimates included, i.e. amounts derived straight from the frozen balance)
   and `loanObligations`, both of which now carry `frozenSince`. It already renders the L.15
   duplicate disclosure, so the placement and the plumbing exist.
2. **The dashboard Today-feed nudges** — "About $X short by DATE" and "A transfer of about $X would
   cover it", built from the frozen funding balance, above the fold. Mitigated: the cash-needed card
   and the radar card *directly below them on the same page* both carry the disclosure, so unlike an
   email the reader is not left without it. The nudge `Proposal` shape is a closed field set with no
   free-text note, so wiring it is a real change rather than a call-site edit.
3. **The PDF/CSV export** — `netWorthReportPdf` prints every account's balance from the 5-field
   payload that drops the flag, and its footer asserts "Balances reflect the data source at export
   time", which is affirmatively false for a frozen row. A durable artifact a user hands to a lender,
   and one that carries no way to correct itself.
4. **A frozen LOAN can never reach an all-clear qualifier** — both the digest's and the reminders
   card's frozen lists are built from cards only, and `frozenNothingDueNote` says "of the cards
   here". A loan's stored due day is exactly the field the bank stopped confirming, so "nothing due
   in the next 7 days" is the claim most at risk.
5. **/investments** and the **debt-payoff path** feeding /goals and two Ask answers — both report
   figures. /investments is L.14 F-2's residual: the holdings prune is skipped for a dropped
   brokerage, so its positions still show, and the page never says why.

Also open, from the critics and not fixed here: `CardSnapshot.frozenSince` is optional while
`paymentAccount.frozenSince` beside it is required with the defaulted-argument lesson quoted as the
reason — one file, one argument, two answers (no live gap: the only production constructor always
sets it).

## ✅ SHIPPED 2026-07-25 (#309) — L.15: the six surfaces that rendered a duplicated card and said nothing (and a seventh a critic found)

/cards (#299) and the dashboard hero + reminders list (#306) already disclosed a both-live duplicate.
Six surfaces did not, and the sharpest are the ones with no banner anywhere near them — the reader
acts on them away from the app. All of them now say it, and **not one figure moved anywhere**
(DISCLOSE, NEVER ADJUST — DECISIONS #289, from #192 and #221).

Closed: (a) the cash-flow calendar, (b) the reminder email, (c) the weekly digest, (d) web push,
(e) the Ask cash-needed answer, (f) the Glass-Box trace — **and (g) Cash Flow Radar**, which no one
had enumerated.

**One plumbing point, not seven.** `getCashNeeded` now returns `cardDuplicates` from a shared helper
that always reads the viewer's OWN pre-merge snapshot, so a partner's card cannot pair with the
reader's on any surface. It costs no database query at all for a user with no candidate pair.

**Three decisions worth keeping:**

1. **Detect per run, never a stored flag.** A flag written last week describes connections that may
   since have been deleted, combined, or dismissed as "not duplicates" — and unlike a page, an email
   carries no control to correct itself.
2. **Copy written for a page is false in an inbox.** "the total above" / "no amount below" name a
   position the writer of an email does not control, and the Ask answer prints a count and a total
   but no per-card figure. One sentence per surface, because only the money claim differs.
3. **Push discloses; it does not suppress the second notification.** Suppressing asserts the two rows
   are one card — the claim only the user can make — and its failure direction is a MISSED PAYMENT on
   a genuinely separate card, against one redundant notification for disclosing.

**The critic cycle is the story of this slice.** Two independent fresh-context critics ran against
cycle 1 and it FAILED with three P1s, every one reproduced by execution before anything was changed:

* **The disclosure quoted labels that appear nowhere.** The positional collision breaker — written
  for /cards, where `cardIdentityLabels` paints the ordinal into the heading — ran unconditionally,
  so the email, the push and the Ask answer told readers to compare "1. CREDIT CARD" against
  "2. CREDIT CARD". It fired on the DEFAULT reported shape, because two connections to one real card
  return one provider name. Whether a surface can be pointed at positionally is now a required
  argument, and the indistinguishable case gets its own sentence.
* **The Ask tap-through panel was still silent** — the one the reader opens to AUDIT the figure the
  answer had just qualified, showing both rows under a green check and a penny-perfect
  reconciliation. Both critics found this independently; it was a defaulted argument at one caller.
* **Cash Flow Radar was the seventh surface**, found only by a critic sweeping beyond the brief. It
  repeats every obligation across a 90-day horizon, so the duplicate manufactured a CRITICAL
  "checking may go negative" push that would not otherwise exist and told the owner to move
  **$33,100 instead of $13,050** — the only surface in the app that states a move-this-much figure.

**A third P1 came from the SECOND critic cycle, and it was mine.** The radar fix over-fired: it
resolved the pair against every obligation the engine knows about instead of the rows the projection
actually emits, so a PAID-OFF duplicated pair — in no projected cycle at all — still hedged a genuine
overdraft warning, telling a reader facing a real dip that the amount to move might be inflated when
it was not. That is the dangerous direction, and it is the same read-what-you-guard mistake as the
ordinal defect one level down. Fixed to read the projected dues — and a THIRD cycle falsified that too, with the observation worth
keeping: being in the projection is not what the sentence claims. It claims the dip date may be
earlier and the amount to move larger, and both are fixed by the worst point of the 90-day walk. So
the gate is now the counterfactual the sentence asserts — re-walk without one side of the pair, speak
only if those figures actually move — which also silenced a note that had been promising an earlier
dip date under a header reading "Clear". Locked by a real-engine abstention suite: the pure-builder
test hand-built its row list, so it could never have caught a wiring bug.

**SHIPPED LIVE: `0a496e0`** — deployment `aimplifi-vvikbc0sf-reiforge.vercel.app`, Ready, aliased
`www.aimplifi.app`. Verified by a marker unique to this change rather than a status code: the
same-name sentence "Two entries are both named" (introduced by the critic-F1 fix, absent from
`cc6de58`) is present in the chunk `www.aimplifi.app` serves, and that chunk's md5
(`892c86100b352c6fb5165a86b9ee3480`) is byte-identical to the new deployment's, so the alias is
pointing at this build and not the previous one. **No schema change**, so the live Neon database was
untouched by this deploy.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **4078 unit / 268 files** / build clean.
E2E 28/28 across ask / notifications / cash-needed / glass-box, plus a new calendar-disclosure spec;
`duplicate-connections` 8/8 serialized. No schema change. DECISIONS #300; five REGRESSION_LEDGER
rows; lesson `a-disclosure-written-for-a-page-is-false-in-an-email.md`.

### 🟠 STILL OPEN — recorded from the L.15 critic cycle, not fixed

1. **`personalCardDuplicates`' personal-snapshot rule is a comment, not a type.** It is now EXPORTED
   (the radar needs it), so the old "module-private, therefore unreachable" guarantee no longer
   covers the public API — the module comment says so plainly rather than claiming the immunity it
   lost. Its parameter is a
   plain `FinanceSnapshot`, identical to the household-merged one, so tsc cannot tell them apart —
   the enforcement is a comment at each call site, which is the pattern
   `fence-by-construction-not-per-call-site.md` rejects. A branded `PersonalSnapshot` would make the
   claim true. No known live defect: every current call path passes the pre-merge snapshot, verified
   by execution.
2. **The (e)/(f) test fixture is not shaped as production emits it** — a hand-built
   `CashNeededResult` missing 20 fields the real engine returns. A critic ran the real engine across
   eight states and behaviour matched, so this is coverage debt rather than a latent bug, but there
   is still no real-engine test for the Ask answer / Glass-Box on paid-off, undated, estimated-mixed
   or autopay states.
3. **A name that sanitizes to nothing diverges between channels**: the disclosure prints
   "Unnamed account" (via `renderSafe`) while the plain-text email prints the raw, invisible name —
   so the email names a row the reader cannot see. Narrow (requires a name made only of invisible
   characters) and the same class as the ordinal defect above.
4. **Other surfaces a duplicated card still inflates, from a critic's read-only sweep — UNVERIFIED,
   leads not repros:** the dashboard Today-feed nudge (two anonymous CRITICAL "Payment due" rows,
   plus a `cash_needed_shortfall` row), the /coach Automation Blueprint ("keep $X in checking" twice
   for one card), value receipts, net worth / liabilities in three renderings plus the exported PDF,
   Ask `account_balance`'s "$X across N accounts", and the debt-payoff path feeding /goals and two
   Ask answers. Safe-to-spend and /forecast were checked and are NOT affected. Each needs its own
   repro before it is called a defect.
5. **`getCashFlowRadar` now assembles the cash-needed input twice per call** — once to detect the
   pair, once inside `radarFromSnapshot` — including on the per-user notify cron loop. Correct, but
   wasteful; a single assembly threaded through would fix it.
6. **A second suspected pair is dropped from the radar's PUSH body** (the in-app card keeps both via
   `assumptions`), a deliberate truncation so the dip date and amount are not pushed off a
   notification, documented at the field.
7. **A deploy-window gap (unverified):** a pair whose payment notifications already fired carries no
   push disclosure until the next cycle mints new notification keys.

## ✅ SHIPPED 2026-07-24 (#308) — L.17: the last two paths that still created a duplicate connection

Both were residuals the #307 critics **recorded without executing**, so both were reproduced before
anything was changed. The repro is in PROGRESS.md verbatim; in one line each:

1. **The owner's own banks were the blind spot.** Collision interception selected candidate
   connections by `PlaidItem.institutionId` — null on every item linked before that column shipped
   (#300), which is *all* of his. So the door he asked for was a silent no-op at exactly the
   connections he already had, until an ordinary sync happened to backfill them. A null id was being
   read as "a different bank"; it means "this row has never been asked". It is now asked over the
   wire (`/item/get`) and the answer written back as the sweep would write it — bought at most once
   per connection, only while a link at that bank is in flight, and never again. A candidate that
   cannot answer takes part in no match and the new link is kept.
2. **Two Link sessions at one bank at once both persisted.** The decision read the user's
   connections and then wrote one with nothing in between, so two tabs both saw zero and both
   created an Item: invariant **D1 held by sequence, not by construction.** Now a lease
   (`PlaidLinkClaim`, unique on `(userId, institutionId)`) makes the *decision* exclusive; the loser
   waits, then sees the winner's connection and treats its own link as the refresh it is.

**Not a unique constraint on `PlaidItem`.** Two connections at one bank are legitimate — a spouse's
own login — so what has to be exclusive is the decision, never the outcome.

**The lease fails open, on purpose.** A 4-second wait, and a timeout PROCEEDS UNPROTECTED: this runs
inside one serverless request that has already spent seconds on Plaid calls, and timing it out would
leave a billed Item whose token was never stored — the worst failure on this path (#307). Proceeding
yields at worst a duplicate the app discloses (#306) and can combine (#304). An abandoned claim is
taken over rather than waited on, so a request that dies cannot wall off a bank.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **4006 unit / 264 files** / build
clean; `duplicate-connections` e2e 8/8 at `--workers=1`. Schema is additive: one new model, no
existing table touched. `PlaidLinkClaim` holds a user id and a public `ins_*` id, nothing financial,
cascades on account deletion, and is disclosed in PRIVACY.md. **UNVERIFIED against live Plaid** — no
credentials here; the concurrency repro drives two real `exchangePublicToken` calls against a mocked
Plaid server and real Prisma.

### 🟠 STILL OPEN — the residual this does not close

A link whose institution never resolves takes no lease (there is nothing to be exclusive about, and
the collision check abstains on it anyway), so two simultaneous links at a bank Plaid cannot identify
can still both persist. And a claim leaked by a killed process is reclaimed by the next link at that
bank rather than by a sweep. Both are recorded rather than claimed away.

## ✅ SHIPPED 2026-07-24 (#306) — L.8: the DASHBOARD stops double-counting a duplicate card silently

**The open half #299 recorded.** One real card arriving through TWO live bank connections emits two full
obligations, so the cash-needed hero is inflated by a card the user does not owe twice, and the payment
reminders ask them to pay it twice — same day, same amount, same name. /cards has said so since #299;
the dashboard said nothing, and a reader who never opens /cards met the inflated number and no caveat at
all. This is also the (B) half of the owner's own report in **L.11** — *"Cash needed on main page and safe
to spend make no sense"* — confirmed on his screenshot as **+$6,679.68 of phantom cash-needed**.

**No new query and no new heuristic.** `getDashboardData` has computed `cardDuplicates` since #299 and the
dashboard already called it; only /cards consumed it. This is a CONSUMER.

**What shipped.** Both dashboard surfaces now disclose the pair, reusing the pure
`card-duplicate-view.ts`, which grew two sibling builders rather than a flag — because the only thing that
differs between the three surfaces is *which money claim is true there*, and that is the thing this module
exists to get right:

- the hero's main branch keeps `cardDuplicateView` (this cycle's cash required), rendered below the figure
  and **above the transfer instruction** it qualifies;
- the hero's "due dates missing" branch gets `cardDuplicateBalanceView`, because that branch sums
  **balances**, not cash required — and it states a total only when every balance points the same way, so
  the sentence is conditioned on that same predicate;
- the reminders list gets `cardDuplicateListView`, which makes **no claim about any total** (this card has
  none) and names the duplicated *instruction* instead.

Everything genuinely shared — which pairs are disclosable, what each card is called, the basis — moved into
one `resolvePairs`, so the three can never disagree about who they are talking about.

**Identity came along, necessarily.** The disclosure names cards by the strings the surface paints. The
dashboard painted bare `cardName`, so two duplicate rows painted identically and the sentence would have
named one card twice. `cardIdentityLabels` (#298) now runs once over every card the hero paints — in paint
order: the "Not included" note, the due-date list, then the estimated rows — and once over the reminder
rows. Fourth surface of the #296/#297/#298 cure.

**Rows the surface does not paint are deliberately not named.** A dated card needing $0 is in neither hero
list (the engine's `due` filter drops it), so a pair involving it is dropped here rather than sending the
reader to hunt for an entry that is not on screen. /cards lists it and discloses it there.

**Stance unchanged: DISCLOSE, NEVER SILENTLY ADJUST** (#192 / #221 / DECISIONS #289, #290). The e2e asserts
the headline still equals the SUM of both rows — that assertion exists to catch a future "helpful"
subtraction, which would assert two rows are one card, a thing only the user can confirm.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **3942 unit / 261 files** / build clean.
New e2e `dashboard-duplicate-disclosure.spec.ts` 3/3, including an axe WCAG-AA scan and a no-horizontal-
overflow check at 360/393/430 **with a duplicate actually seeded** — the passive gates load routes as the
demo user, who has no duplicate, so this markup would otherwise never have been scanned (the blind spot
#297 had to close). FAIL-OLD PROVEN: 13/13 new unit assertions fail against the stashed pre-change source.
Empty prisma diff — the live database is untouched.

### 🔴 Found on the way: `main` was RED, and the flake was hiding it

`duplicate-connections.spec.ts` asserted `combine-connections-card` count 0. **#305 changed that
deliberately** — it taught /accounts to render the card and say *why* it cannot combine, precisely so that
"we checked and cannot prove these are one account" stops looking like "we never looked". The assertion was
never updated, so it has been failing since #305.

It shipped because `scripts/verify.sh` skips Playwright unless `VERIFY_E2E=1`. It stayed *invisible*
because the same spec also hits the documented **#287** whole-page DOM duplication under load: the flake
fires first, the run gets written off as "the known flake", and a real stale expectation rides along
underneath. #305's session did the right thing — a stashed clean-tree run — and still mis-scoped it,
because that run reproduced *a* failure and stopped there.

Fixed by re-pointing the assertion at what a user would actually reach: `combine-connections-confirm` count
0 (no one-tap combine is offered for a pair whose either direction strands an account — the L.10 invariant
this test has always been about), plus the blocked reason being visible. The assertion was not deleted.
Lesson updated (`fencing-a-write-path-breaks-the-tests-that-drove-it.md`): read each failure's error
SIGNATURE, and serialize with `--workers=1` to strip the load-induced one.

### 🟠 STILL OPEN — the rest of the class (now enumerated, as TASKS L.15)

A read-only sweep this session enumerated every surface downstream of the same obligations. Beyond the two
fixed here and /cards, **six** render the same doubled rows with no disclosure: the /calendar events
(`engine/calendar/build.ts:90-100`, two events on one due date), the reminder email
(`engine/reminders/select.ts:153-165` → `api/cron/reminders`), the weekly digest email
(`api/cron/digest/route.ts:105-145`), web push (`engine/notify/select.ts:97-115`, two notifications), the
Ask assistant's cash-needed answer (`engine/assistant/answer.ts:644-688`, an inflated card count), and the
Glass-Box trace (`engine/glass-box/trace.ts:58-96`, two rows inside the tapped breakdown). The emails are
the sharpest of these — a user acts on them away from the app, with no /cards banner nearby. Scoped out
deliberately: each needs the detector wired into a different per-user server path (a cron loop, with its
own demo fence and per-request cost), which is a slice, not a footnote.

## ✅ SHIPPED 2026-07-24 (#305) — L.6: when the app will NOT combine two look-alike connections, it now says why

**Owner, on the build shipped an hour earlier: "Not there."** He reloaded /accounts and found no Combine
card at all for his two Chase `····0977` connections. That is a real defect, and it is mine: the feature
rendered a control when it could act and **nothing** when it could not, so "we checked and cannot prove
these are one account" was indistinguishable from "we never looked" — which is exactly what he concluded,
twice. It is the `an-empty-set-is-not-a-fact` rule applied to my own feature: the absence of an offer is a
CONCLUSION, and a conclusion has to be stated.

**Shipped:** a pure `explainUncombinableConnections` keyed off what the READER can see — two live
connections the page shows at one bank, holding accounts with the same last-4 — that reports why no offer
was made, plus the server half for the two reasons only it knows. Six reasons, each with its own sentence
and, where one exists, a one-tap repair:

* **`bank-id-missing`** — the ladder refuses to place two connections at one institution when only one
  carries the bank's own `ins_*` id (a rule added the same day, after a critic showed that matching on the
  bank NAME alone can merge two different banks). A connection linked before that column existed carries
  null until the ordinary sweep fills it in. **This is the leading candidate for the owner's own case**,
  and the card now offers *"Get the bank's ID"*, which runs `syncInstitutions` on demand.
* **`dismissed`** — a pair the user previously marked "not a duplicate" suppresses the offer everywhere,
  which is right, but was permanent and invisible. The card now says so and offers *"Offer it again"*
  (new `reconsiderDuplicatePair` action).
* **`strands`** / **`ambiguous`** / **`different-kind`** / **`different-bank`** / **`unproven`** — stated,
  with the stranded accounts named by their last-4.

Gate: `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **3929 unit / 261 files** / build clean; the new
e2e case drives the blocked path (no Combine button, the reason visible, the repair offered).

**Open, and NOT caused by this change (proved by a stashed clean-tree run):** `duplicate-connections.spec`
→ *"two connections to one bank are told apart"* now fails most runs with the documented **#287 whole-page
DOM-duplication** (`getByTestId('duplicate-accounts-warning') resolved to 2 elements`), an unconfirmed
hydration mismatch on /accounts that predates this work. It reproduces with today's changes stashed, and
the full serialized suite was 173/173 immediately before the fixture grew a fourth account, so the new
fixture appears to make an existing race far more likely to land. Do NOT loosen the locator — that would
hide a real duplicate-render bug. Next session should chase #287 itself.

## ✅ SHIPPED 2026-07-24 (#304, DECISIONS #297) — L.6/L.10: the duplicate card the owner has been staring at can now be combined in one tap

**The owner's question, verbatim, mid-session: "What did you actually fix? I see the same accounts that I
posted earlier."** He was right, and the honest answer was: nothing had removed them. #298/#299 taught
/cards to tell same-named cards apart and to disclose a both-live duplicate; #300/#301 stopped FUTURE
duplicates being created. His two Chase connections both pulling `CREDIT CARD ····0977` were untouched —
**$8,539.09 counted twice** in Liabilities, again in the cash-needed headline, and again in every
transaction total. The shipped Combine flow refuses a both-live pair by design (R3 needs one stale side)
and the candidate detector skipped same-provider pairs outright, so the app had **no path at all**. The
build queue had prevention (L.10 slice 3) ahead of the remedy (layer 3); that ordering was wrong and was
flipped on the spot.

**What shipped.** A pure identity **ladder** (`engine/account/identity.ts`, design §5) answering
same / different / unproven within ONE provider at ONE institution — the only scope where a differing
last-4 is a sound veto, since across providers it is not (SimpleFIN `396` and Plaid `5351` are one real
Schwab account, L.9). It never reads a balance (D4 is structural: the input type has no balance field) and
treats every null as UNKNOWN rather than as a difference. A pure **planner**
(`engine/account/combine-connections.ts`) working at the CONNECTION level, because the only way to make one
side stale is to disconnect a Plaid item and an item can carry several accounts; a direction is offered only
when every account under the dropped connection is proven the same as EXACTLY ONE account under the kept
one, so disconnecting strands nothing. And the **action**: one SERIALIZABLE claim transaction re-derives the
plan, re-applies every suppression the card applies, stamps the bank identity onto the rows, carries autopay
across, and deletes the losing connection row — then, outside it, revokes the token and writes one
reconciliation per pair through the shipped `confirmReconciliationFor`. No new money rule was written: the
boundary engine already knows how to make two rows read as one account.

**Three fresh-context critics ran in parallel (money+boundary / destructive-action safety /
false-merge+copy). Cycle 1: 3 P0, 6 P1, 9 P2 — every one from an executed repro, ALL fixed and
regression-locked (8 REGRESSION_LEDGER entries).** The three that mattered:

* **Two taps destroyed both connections.** The card offers two directions as two live buttons; the plan was
  derived outside any transaction, so two concurrent taps each disconnected a different connection —
  executed 3/3: zero connections, zero links, the duplicate still double-counting, both calls returning
  `ok: true`. Fixed by making the row deletion itself the claim, inside the transaction that reads the plan.
* **The date split deleted real money — in both directions.** First $890 of charges only the SURVIVING feed
  had; after the cutover was moved to fix that, $930 that only the DROPPED feed had. Two LIVE feeds are both
  partial in *different* places, unlike the cross-provider case this machinery was built for. Fixed **not by
  a better cutover but by a proof**: every row the split would drop must have a same-day, same-amount
  survivor on the other side (multiset-matched), or the combine is refused with the amount named and nothing
  changes. An honest gap beats a silent deletion.
* **Autopay was lost with the dropped row**, so /cards would say "move $8,539.09 yourself" while the bank
  still pulled it — a double-payment hazard. Autopay now follows the account, never overwriting the
  survivor's own setting.

**Decided:** the advisory #192 warning steps aside for a pair that has a combine offer (one message per
pair) — and since that warning carried the only "not a duplicate" control, the combine card grew its own,
wired to the same dismissal key, so the offer can never be permanent and undismissable. **Deliberately not
done:** no fuzzy amount/date dedup (its failure direction is silent loss); no automatic action on any
signal (an identical balance prompts, never acts — D4); cross-provider stays user-confirmed forever (L.9).

**Schema:** two nullable additive `Account` columns (`institutionId`, `institutionName`), stamped at
disconnect — deleting the `PlaidItem` was destroying the only record of who a disconnected row banks with,
and that row is exactly the population the ladder works on. `prisma db push` adds them to live Neon on
deploy; existing rows get NULL.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **3924 unit / 261 files** / build clean.
E2E: **the full suite passes 173/173 serialized (`--workers=1`, exit 0, 5.4m)**, including the new
`combine-connections.spec.ts`, which drives the whole flow through the UI — double count visible → arm →
confirm → the card counts once → the un-revoked token disclosed → undo restores both. The 4-worker run
showed 5 failures (budget-targets, and two of the reworked duplicate specs), every one of which passes on
a serialized or isolated rerun: the documented load-induced contention flake
(`docs/lessons/e2e-dials-value-corruption-flake.md`), not a regression. CI is the arbiter.
**UNVERIFIED against live Plaid** (no credentials here): the token revoke and the `/accounts/get` identity
capture ran only against mocked providers and real Prisma.

**Deploy: VERIFIED LIVE on `d0cef99`, production.** Vercel `dpl_5nfVaMB8gCKZdVhypT5qfxZSqLc1`; the build
log shows `prisma db push` reporting *"Your database is now in sync with your Prisma schema"* against the
Neon production database (the two nullable `Account` columns are live, existing rows NULL) and
*"Deployment completed"*. No public marker exists to grep — /accounts is auth-gated and the card renders
only for a user with two Plaid connections at one bank — so the alias was verified by BYTES instead:
`https://www.aimplifi.app/sign-in` is now md5-identical to the new deployment's own URL and differs from
the previous deployment's, i.e. the production domain is serving this build. (The Vercel API's
`readyState` still read `BUILDING` at the time of writing, several minutes after the build log's
"Deployment completed"; the serving bytes are the stronger evidence.)

**Known residuals, recorded rather than silently widened:** a duplicate row's own hand-categorization is
dropped with it when its twin survives (money is unaffected; the category can be re-set); `keepRank` breaks
a tie by link order without measuring which feed is deeper (a wrong guess now costs a refusal, never a row);
and two connections whose stored bank NAMES differ only by whitespace/case still number their ordinals
separately (P3, cosmetic).

## ✅ SHIPPED 2026-07-24 (#303, DECISIONS #296) — L.12 (a)+(b): Plaid's category becomes a one-tap inbox suggestion

The owner's loudest competitive complaint ("321 inbox items… Simplifi/mint never had this problem;
ours is awful by comparison"). Root cause (verified last session): Plaid's own `personal_finance_category`
was mapped at ingest but **never persisted**, and the triage inbox recomputed suggestions **without** it,
so a row Plaid could categorize but our thin ruleset missed showed "Suggestion: none yet".

**(a) Persist the guess.** Two nullable, additive `Transaction` columns — `providerCategoryId` +
`providerCategoryConfidenceBps` — written only by the Plaid ingest path (`prepareIngestedTransaction` →
`base` in plaid.ts). New `mapPlaidProviderCategoryGuess` is a superset of the unchanged auto-file hint
`mapPlaidPersonalFinanceCategory`, sharing one `resolvePfcCategoryId` core, and additionally keeps
LOW-confidence guesses (4000 bps). Demo / SimpleFIN / CSV / manual rows never write these → null → unchanged.

**(b) Surface it.** `getTriageGroups` reads the column; `groupReviewRows` computes a
`providerSuggestedCategoryId` shown as a labelled **"Plaid's guess"** one-tap suggestion — but ONLY as a
fallback when our own pipeline suggestion is null, unanimity-gated among the group's opinionated rows, and
NEVER for an aggregate group (Zelle/checks hide many payees). It is deliberately kept OUT of
`isConfidentGroup` / "Accept all confident" / swipe-right, so it can never be bulk-filed — the explicit,
labelled accept button is the only path, and filing it is an ordinary undoable Correction.

**Honesty boundaries (locked by tests):** auto-file behavior is byte-identical — the LOW guess at 4000 bps
sits below the tuned clamp floor (6500), so it can never auto-file. A fresh-context hostile critic
(categorization routing) found **1 P1 + 2 P3, all fixed + regression-locked**: the **P1** was a missing
#44/F4 sign guard on the surfaced guess — an OUTFLOW that Plaid tagged INCOME would one-tap-book spend as
income (erasing spend, inflating income); now gated in `prepareIngestedTransaction` (outflow never Income;
the inflow→spend refund case kept, matching the pipeline). P3s: the "Swipe right to file" footer clause is
dropped on provider-guess-only cards (swipe-right is confident-only there); and the schema diff means
`prisma db push` adds two nullable columns to live Neon on deploy (existing rows → NULL, golden-safe).

**Deferred (not this session):** (c) the `\bGRILL\b`→"Grille" ruleset boundary + generic-rule widening;
(d) auto-file at PFC MEDIUM with an AI badge. Both are lower-priority whack-a-mole to measure on his corpus
via `eval:categorize`.

Gate: `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **3846 unit / 257 files** / build clean; new e2e
`tests/e2e/triage-provider-suggestion.spec.ts` PASSES. **UNVERIFIED against live Plaid** (no creds here —
mocked providers + real Prisma only; his real inbox's before/after coverage can only be seen after deploy).
**Deploy:** **VERIFIED READY on `57e3576`, production**, aliased to www.aimplifi.app (Vercel dpl_5eurCpui3N6HNYQZbSbHw2ZnJcZZ,
readyState READY) — so the schema `prisma db push` succeeded on Neon (two nullable cols added; existing rows NULL).
No live marker grepped: /triage is auth-gated + client-rendered (same as the L.10 slices), so the evidence is the
READY state tied to this exact SHA + the production alias, plus the local gate + e2e. www.aimplifi.app answers 307
(the auth-gate redirect), confirming the alias serves this deployment.

**Next build (owner sequencing 2026-07-24):** the account-duplicate ROOT CAUSE — make it impossible to
re-pull the same card (L.10 slice 3, collision interception) + a one-tap Combine for both-live duplicates
like the two Chase ····0977 the owner circled on /accounts. He confirmed: finish this inbox work first,
then that.

## ✅ FIXED 2026-07-24 (#302) — savings rate printed "−855105.8%" on real data (TASKS L.11(A))

The owner's dashboard showed "Savings rate · 4-month average of **−855105.8%**". Cause: the card
averaged monthly `(income−expenses)/income` RATIOS, and a month whose paychecks weren't
categorised as income (a near-zero income denominator) exploded to hundreds of thousands of
percent and dominated the mean; the data-driven chart scale then flattened every other bar.

Fixed: new pure `pooledSavingsRateBps` (Σincome−Σexpenses)/Σincome over income-bearing months;
a display floor so anything past −100% renders "below -100%" (headline, average, tooltip); the
"N-month average" line only with ≥2 contributing months; a fixed ±100% chart scale; the 15%
aspiration line only when a month actually saved. A fresh-context critic (Opus — owner is out of
Fable) proved pooling alone still showed the giant number for a single-income-month window; the
floor + ≥2-month gate close it, locked by the exact repros. **Deployed READY on `4e235dc`,
production, `www.aimplifi.app`.** The root input problem (income under-measured because paychecks
aren't categorised as income) is the same gap as L.12; the savings math is now robust regardless.

**OWNER DECISIONS 2026-07-24 (persisted so a /clear doesn't lose them):**
- **Next build = categorisation (L.12)** — the loudest competitive complaint. Root cause verified:
  Plaid's own category is captured but never persisted, the inbox re-guesses without it, and the
  ruleset can't even match "Grille". Fix = persist the hint + surface it as a one-tap suggestion.
- **Safe-to-Spend → "guilt-free spending"** (I Will Teach You to Be Rich / Ramit Sethi): income
  minus fixed bills, this-cycle card obligations, AND a savings-% goal the user sets in Settings
  (a Conscious-Spending-Plan allocation). Spec in TASKS L.11(C).

## 🔴 NEW — owner-reported 2026-07-24, mid-session (TASKS L.11–L.13); (A) now fixed

Three reports about his real linked data. **Nothing below has been reproduced or diagnosed, and
none of it should be guessed at** — rule 0. Full context and the decisions each one needs are in
TASKS L.11 / L.12 / L.13.

1. **"Cash needed on main page and safe to spend make no sense."** Two money headlines on the
   dashboard. No screenshot yet; the first action is to ask for one, because both figures depend
   on his account shape and neither can be judged from here. Note L.8 is still open and sits in
   the same headline: a both-live duplicate card double-counts into cash-needed with no
   disclosure. That may or may not be what he is seeing.
2. **"We added plaid to all accounts. Why do I still have 321 inbox items to review… Simplifi and
   mint never had this problem."** Verified this session: the triage inbox is fed by a CONFIDENCE
   THRESHOLD (`AUTO_FLAGGED_BPS = 7000`, `engine/categorize/pipeline.ts:21`), not by which
   provider supplied the row — so linking Plaid would not empty it, and his "it didn't do a
   thing" is an accurate description of what he sees. 321 is past the point any user will work
   through a queue; this is a calibration/product problem, not only a bug.
3. **"Also the previous items regarding vanguard."** **Recorded as an unresolved reference.** A
   search of `docs/`, `TASKS.md`, `PROGRESS.md` and `REGRESSION_LEDGER.md` this session found no
   open Vanguard item — the only mention is DECISIONS #61, a closed SimpleFIN-era account-type
   fix. Ask him which items rather than inventing a match.

## ✅ SHIPPED 2026-07-24 — account identity, slices 1 and 2 (#300, #301; TASKS L.10)

**Slice 1 — capture what survives a re-link (#300, DECISIONS #292).** Three nullable, additive
columns: `PlaidItem.institutionId` (Plaid's stable `ins_*` id), `Account.subtype` (the provider's
raw subtype, verbatim) and `Account.persistentAccountId`. The app could not tell "one real account
pulled twice" from "two accounts that look alike" because it stored nothing that survives a
re-link: a Plaid row is keyed on `account_id`, which a second Link session re-mints. Nothing reads
the columns yet — no figure, route or copy changed. Deployed and verified READY on `059c490`.

**Slice 2 — Plaid Link update mode (#301, DECISIONS #293).** Every connection on /accounts now
offers **Add or fix accounts**, which reopens Link on the connection that already exists rather
than creating a second one. This is the door whose absence manufactured the duplicates the last
six commits have been detecting and disclosing: until now, "add an account I didn't share" and
"repair a broken login" both had the same only answer — connect the bank again.

Three fresh-context critics, **2 P0 + 6 P1, all fixed in cycle 1 and regression-locked.** The
headline P0 was structural and mine: the update/new discriminator lived in a second localStorage
key written at token-mint time, while /accounts renders this control beside the connect front
door, which pre-mints a token on mount and after every exit — and whose fast path opens Link
without writing at all. In the worst ordering a **completed brand-new bank link was discarded
without being exchanged, and the user was redirected as though it had worked.** Fixed by shape,
not by a bigger fence: one atomic record, stamped by whoever is opening Link.

Two of the P1s were pre-existing and are fixed because the new copy depends on them: a per-item
sync failure was invisible to callers, so the **existing** Sync button told users "no new
transactions" when their bank had refused them; and `removeItem` bought `/accounts/get` to stamp
item linkage and threw the identity away in the same response, leaving every disconnected row
permanently identity-less — precisely the population the Combine flow works on.

### 🟠 Known residuals from this work

- **A deselected account freezes and keeps counting — TASKS L.14, deliberately not fixed here.**
  Update mode ships with account selection, which unticks as well as ticks, and nothing prunes a
  row whose feed stops returning it: it keeps its last balance, keeps counting toward every total,
  and still reads as freshly synced because a Plaid row's freshness comes from its bank's sync
  date (#293). Slice 2 discloses it in the success flash and names the re-tick as the remedy. A
  transient message is not a fix for a permanently wrong figure; the real fix needs a schema shape
  and its own money critic.
- **An unresolvable item is re-swept every run.** The institution sweep now selects items missing
  a name *or* an id, so an item whose `/item/get` permanently fails (revoked at the bank, never
  disconnected in the app) costs one billed call per sweep indefinitely. Accepted rather than
  skipped, because a broken item's identity is exactly what collision interception will need, and
  `/item/get` usually answers even for a login-broken item. `institutionsFailed` is now recorded
  in the cron audit so the cost is visible rather than silent.
- **Update mode is UNVERIFIED against live Plaid.** No live connection exists in this environment;
  every fact about the request shape was read from plaid.com/docs on 2026-07-24 and the flow is
  exercised only against a mocked Plaid server. The Link window itself cannot be browser-tested.

### Deploy verified

Slice 1 → deployment `dpl_H1suyPbp9b8Ehz4Bs5nSB3skJCsA`, **READY on `059c490`**, target production.
Slice 2 → deployment `dpl_H5qo2myka88EBVejZXREgDqznAj9`, **READY on `abc4398`**, target production,
aliased to `www.aimplifi.app`, and the live site answers 200. Slice 1's prisma diff was four
additive nullable lines (columns added, no data touched); slice 2's was empty.

**Stated precisely, because rule 5 asks for a live marker and there is not one to grep here:** both
slices land behind auth, and the new control renders only for a user who has a Plaid connection —
so there is no unauthenticated string on the live site unique to either commit. The evidence is the
READY state on those exact SHAs with the production aliases attached, plus the local gate.

**What the owner will see:** on /accounts, each connected bank's row now carries an **Add or fix
accounts** button beside Sync and Disconnect, and one line under the list explaining when to use
it. Nothing else on any screen changed.

## ✅ CLOSED 2026-07-24 (#299) — a both-live duplicate card was counted twice on /cards, silently

Found by reading the owner's /cards screenshot — the same highest-signal source as the rest of Wave L,
not a failing test.

**What the screen shows.** Two entries both named `CREDIT CARD`, both **$6,679.68** amount due, both
$6,679.68 remaining statement due, both **$66.00** minimum, both due Wed Aug 5 — byte-identical.
That matches the known Chase `····0977` duplicate recorded elsewhere in this file (−$8,475.31 twice,
one real card arriving through two live Plaid connections).

**Precise cause — /cards DOES dedupe, but only the reconciled kind.** `cashNeededFromSnapshot` strips
`supersededAccountIds` from the accounts fed to `assembleCashNeededInput` (`server/finance.ts:157-166`,
Wave 4.6 slice 4 / R4), so a predecessor that was COMBINED into a successor emits no phantom
obligation. A **both-live** duplicate has no reconciliation link at all, so that set is empty for it
and **both rows emit a full obligation**. Separately, the personal duplicate detector
(`SuspectedDuplicatePair`, `duplicate-accounts-warning`) renders only in `accounts-list.tsx`;
`src/app/(app)/cards/page.tsx:87` passes only `householdDuplicates` (the partner-scope check). The
page therefore double-counts **and** stays silent about it.

**Consequences.**
1. The **"Do this first"** headline and the pay-in-full / minimum totals include the duplicate. The
   owner's visible cards sum to $25,258.27, of which **$6,679.68 is phantom** — a real payment
   instruction inflated by one card counted twice.
2. /cards never renders a last-4, so **three** cards named `CREDIT CARD` are indistinguishable — the
   #296/#297 defect on a third surface, and worse here: the user cannot tell which card the
   instruction is even about.

**Not a regression.** Nothing here changed in #296/#297, which fixed /accounts. This surface never
had the defence.

**Design question for whoever builds it:** whether a both-live duplicate should be EXCLUDED from the
headline total or merely disclosed. Excluding it silently is itself a claim (that the two are the
same card) that only the user can confirm — the #192 detector is deliberately advisory and never
auto-deletes, and that stance should not be quietly reversed inside a money headline.

**OWNER-CONFIRMED RESOLVED 2026-07-24 (his data).** He deleted the duplicate row and re-checked:
"No more 2 cc". So the screenshot PREDATED the deletion, the +$6,679.68 phantom is gone, and his
/cards figures are correct. **The code gap below is therefore LATENT, not an active money error** —
do not tell him his totals are wrong.

**Still ACTIVE for him, and the reason L.6 stays open:** the identity half. His screen still shows
THREE cards named `CREDIT CARD` and TWO named `Venture`, with no last-4 and no institution, on the
surface that issues payment instructions. Even with zero duplicates he cannot tell which card a
figure belongs to.

**Interim remedy for a future duplicate (unchanged).** Delete the duplicate row on /accounts, or
combine the pair — either removes it from /cards, since both surfaces read the same Account rows.
Tracked as TASKS L.6 — **now closed by #299 (DECISIONS #290).**

### What #299 shipped

/cards now renders an advisory disclosure directly ABOVE the "Do this first" instruction whenever a
card it lists looks like one real card arriving twice. It names both entries by the exact headings
the page paints, quotes each row's own cash-required figure, states the detector's confidence and
the signals that fired, and says plainly that **no figure was adjusted** — the #192/#221/#289 stance,
never quietly reversed inside a money headline. Detection is #192's, untouched; this was a missing
surface, not a missing engine.

Two fences worth knowing about, both from the fresh-context critic:

1. **"Counted" means inside `headline.requiredCents`, not merely painted in the grid.** The first cut
   read `cashRequiredCents` off every row in `result.cards` and claimed the totals included both. The
   critic ran the engine and falsified it: `requiredCents` sums only `cycleObligations`, and ESTIMATED
   obligations are dropped wholesale as soon as any one card has a real statement
   (`cash-needed/engine.ts:214-223`), then filtered to `cashRequiredCents > 0`. So an estimated — or
   paid-off — duplicated pair is painted with a real-looking figure twice while contributing nothing.
   The old copy would have told a reader with a $217.99 headline that it was inflated by two
   $6,679.68 rows it did not contain, which could have sent them to move cash they do not owe.
2. **Both sides must still be live.** `detectReconciliationCandidates` only ever proposes a pair whose
   sides DIFFER in liveness, and /accounts suppresses its duplicate warning — and therefore its only
   Dismiss control — for any pair that has such a candidate. An unfenced banner here would have been
   permanent and undismissable on the money page: the exact owner complaint that created the
   dismissal feature. Both-live is also precisely the reported defect.

Also fixed a #298 residual found on the way: the two per-section `cardIdentityLabels` passes each
guaranteed distinctness only WITHIN their own list, so a dated `CREDIT CARD` and an undated one with
no last-4 painted identical headings. Now one pass over everything the page displays.

### Deploy verified

Vercel deployment `dpl_J5j8Pc5pBJhpvqjGvUwEbJ8XgkzN` reached **READY on commit `01cd341`**, target
production, aliased to `www.aimplifi.app`. Empty prisma diff, so the live Neon database was untouched.

**Stated precisely, because rule 5 asks for a live marker and there is not one to grep here:** /cards
is behind auth, AND the disclosure is conditional — it renders only when a suspected duplicate exists
among the cards being listed. The owner deleted his duplicate row before this shipped, so on his
screen today this change correctly renders NOTHING. There is therefore no unauthenticated string on
the live site unique to this commit; the deploy evidence is the READY state on that exact SHA with the
production aliases attached, plus the local gate. Do not tell him to go look for a new banner.

### 🟠 STILL OPEN — the DASHBOARD does not disclose it

`cardDuplicates` is computed inside `getDashboardData`, which the dashboard also calls, but only
/cards consumes it. The dashboard's cash-needed headline and its `reminders` are built from the same
`payInFull.cards` that lists both copies, so they remain inflated with **no disclosure at all**.
Scoping to /cards was the deliberate slice boundary, but the gap is real: a reader who never opens
/cards sees the inflated number and nothing about it. The data is already in hand, so the fix is a
consumer, not a query.


## ✅ ANSWERED 2026-07-24 — the issuers DO return card due dates (TASKS L.3); no date is invented

Open since #277 asked what Chase / Capital One actually return. The owner's /cards screenshot settles
it: **eight cards** render real statement figures — amount due, remaining statement due, and a
**distinct** minimum ($92.00, $66.00, $25.00, $40.00, $35.00, not one derived constant) — and one card
carries the post-close-credit disclosure that only a generated statement produces. No card sits in the
honest "no due date yet" panel, so **manual statement entry does not need extending to linked cards**,
which was the only decision L.3 gated.

**On the alarming part — all eight cards read "Due Wed, Aug 5 (in 12 days)".** That is exactly what a
fabricated fallback would look like, so the pipeline was traced rather than assumed. State the result
precisely: **no due date is invented from nothing**, but a due date is not always verbatim either.
- With a statement: the issuer's date verbatim — `dueDate: isoDate(next_payment_due_date)`
  (`plaid-map.ts:241`). `mapPlaidLiabilityToStatement` returns **null**, creating no statement at all,
  when the issuer supplies no due date (`plaid-map.ts:216-222`) — so a statement cannot carry an
  invented date.
- With no statement: the date is **derived** from BOTH `cycleCloseDayOfMonth` and `dueDayOfMonth`
  (`cash-needed/assemble.ts:151`) and flagged `isEstimated`, which the UI badges
  (`cards-breakdown.tsx:152`). The #277 cycle-2 counter-lock refuses a due day without a cycle anchor,
  whose comment records that relaxing it produced a date a month early plus a live "move $850 into
  checking today" instruction. An undatable card stays undatable and says so.
- Both cycle days themselves originate from Plaid (`plaid.ts:924-926`).

So a shared Aug 5 is consistent with several Capital One cards on one customer-chosen due day, and is
**not** evidence of a fabricated default. Per-card truth is readable off the estimate badge. The
relative rendering also checks out: 2026-07-24 + 12 days = 2026-08-05.

Note for future readers: `effectiveDueDate` may differ from the issuer's `dueDate` — it is walked back
to the prior business day and floored to today if already past (`cash-needed/engine.ts:150-161`), and
the UI appends "· issuer date …" when the two differ. That is an adjustment of a real date, not a
derivation.

## ✅ SHIPPED 2026-07-24 — the Combined-accounts card groups by live account (#297)

Closes the last open defect from the owner 2026-07-24 /accounts screenshots, recorded until now as
a known limitation of #296: the **"Combined accounts"** card listed **"Venture (Plaid ····6271)"
twice, identically** — same mask, same "history kept through 2026-07-18" — with two byte-identical
"Undo" buttons. Owner: *"two identical rows I can't tell apart."*

**Verified cause.** `AccountReconciliation.successorAccountId` is deliberately NOT unique
(`prisma/schema.prisma:193` — "one live account may supersede more than one old row"), so TWO
SimpleFIN predecessors folding into ONE live Plaid successor is **valid data**. The card rendered
one flat row per link with no grouping, and never rendered the one field that differs — the
**predecessor's own name**. It rendered `providerMask(predecessor)`, which for two SimpleFIN rows
(no mask column) is the constant string "SimpleFIN". Same disease as #296, one card lower.

**Shipped.** A pure, framework-free view module (`src/components/finance/continued-accounts-view.ts`)
owns every rendered string: it groups by successor (ONE block per live account), names each old
account with an "old account N of M" ordinal that survives byte-identical names, and guarantees no
two Undo controls can tie. **Zero server change, empty prisma diff** — the payload already carried
`predecessor.name` (`transactions.ts:264`); it was simply never rendered.

**Three fresh-context critics, all findings fixed + regression-locked in cycle 1:**
- The `(copy N)` breaker **wrote into the string space it compared**, so a predecessor named
  "Venture (copy 1)" tied with a rewritten "Venture" (executed repro; 39/4000 fuzz seeds). Replaced
  with a card-wide positional **prefix** that is provably unforgeable (a digit is never a '.').
- Distinctness was computed on **raw** strings while the browser paints **collapsed** ones, so
  `"Venture "`, `"Ven<ZWSP>ture"` and `"Venture  "` painted identically. Names are now sanitized once
  at construction, which also strips a U+202E that would reverse a button face.
- **Copy outran the data.** "balance counted on the live connection" is false in a chain Q→P→S
  (each link is emitted with its DIRECT successor, `transactions.ts:525`, while the boundary zeroes
  EVERY predecessor, `reconcile-boundary.ts:419`) and after a successor's bank is disconnected
  (liveness is re-checked nowhere after confirm). Every sentence now states only what is true in
  every state — a fact about the PREDECESSOR — and a mid-chain block says so explicitly. The undo
  toast's "both accounts count on their own again" was false for the same reason and now speaks
  about the old account only.

**Coverage gap closed.** `prisma/seed.ts` creates no reconciliations, so the demo user's /accounts
early-returns this card — meaning the repo's axe scan and mobile-overflow sweep had **never seen
this markup**. The new spec re-runs both gates against a seeded card at 360/393/430.

**Known limitations (deliberate, not defects):**
- Ordinals are POSITIONAL over the payload, so two links created in the same database second have an
  unspecified order, and undoing one RENUMBERS the survivors. Nothing claims a date order, a link
  order, or that the number is durable, and every Undo's accessible name also carries the account
  NAME.
- The card does **not** claim the links are CORRECT. Whether a second predecessor was matched to the
  right live account is owner-only knowledge (rule 0); the card's job is to make that answerable and
  each link separately reversible.
- `tests/e2e/combined-accounts.spec.ts` is exposed to the §OPEN "/accounts DOM duplication" flake
  like every /accounts spec. **Measured this session, three full-suite runs**, rather than assumed:
  with #297 present 6 failed, then 2 failed (both in #296's untouched `duplicate-connections.spec.ts`,
  every #297 test green); with #297 **entirely reverted and rebuilt** the same suite still failed 5,
  including the SAME `reconcile.spec.ts` ×2 and `duplicate-connections.spec.ts` ×2. Paired runs
  showed `reconcile.spec.ts` failing ~1 in 3 alongside **either** the new spec **or** #296's, and
  all of them pass 13/13 at `--workers=1`. The victim rotates run to run; this slice adds EXPOSURE,
  not cause. Do NOT loosen the strict locators to make it pass — that would hide the real bug.

**OPEN, deliberately not widened here (both pre-date #297, both recorded by the copy critic):**
1. **Degenerate claim span.** If a stored cutover predates the predecessor's first transaction
   (reachable — deleting its earliest manual row can move that date), `reconcile-boundary.ts:284-293`
   makes the claim degenerate and BOTH sides keep everything, a real transaction double-count. The
   card still says "history kept through {cutover}", and `transactions.ts:591` suppresses the
   duplicate warning for any effective predecessor — so no surface flags it. Also, the true claim
   end is `min(cutover, last txn)`, not `cutover`.
2. **The persistent card omits two confirm-time disclosures** that remain true forever: inside the
   claim span the predecessor's records REPLACE anything the successor re-imported, and where
   `cutover < last txn` the predecessor's later records stop counting. "History kept through X" reads
   as a clean handoff and never mentions that rows on either side were dropped.

## ✅ SHIPPED 2026-07-24 — duplicate card distinguishes CONNECTIONS (#296)

The owner-reported byte-identical-button defect is closed: two live Plaid connections to the same
bank no longer render two identical "Disconnect U.S. Bank (Plaid ····2927)" controls. Each side of a
pair now carries its connection identity, its account manifest, and a button face with the ordinal
plus the blast radius; a mechanical " (row 1)/(row 2)" breaker makes identical controls impossible
for any input rather than merely unlikely for this data. His two remaining both-live pairs
(Loan - 2927, CREDIT CARD ····0977) are now resolvable from the card.

This also CLOSES the #295 coverage gap recorded as "no e2e for the duplicate-card actions"
(DECISIONS #286): tests/unit/duplicate-card-view.test.ts + tests/e2e/duplicate-connections.spec.ts,
the latter verified to fail against the reverted pre-#296 build.

**Known limitations (deliberate, not defects):**
- Two connections created in the same database second have an unspecified payload ORDER, so which
  one is numbered "connection 1" is unspecified. The numbers are still distinct and the copy claims
  no date and no link order, so nothing false is rendered; the e2e assertions are order-agnostic.
- The e2e cannot drive the real Plaid disconnect: /item/remove decrypts the stored access token and
  a seeded row fails with "Malformed encrypted token". Step 1 is covered by unit tests plus a
  seeded post-disconnect state; only step 2 (the delete) runs against the real server action.
- tests/e2e/duplicate-connections.spec.ts is exposed to the §OPEN "intermittent DOM duplication on
  /accounts" flake below, like every other /accounts spec. Measured this session: run ALONE it
  passes 3/3 (5 tests). Run concurrently with five other /accounts specs it fails ~1-2 tests per
  run with "strict mode violation: resolved to 2 elements". The SAME load on the reverted pre-#296
  build fails 2 of 3 runs with the identical signature on `reconcile-candidates` — a locator this
  slice does not touch — so the cause is the pre-existing page-level issue, not #296. This slice
  adds more /accounts page loads, so it increases EXPOSURE to that bug without being its cause.
- PlaidConnections' own Disconnect confirm now states the two-step truth and names which connection
  it is cutting, and both its destructive controls carry distinct accessible names (critic P2s,
  fixed in this slice). Its earlier copy — "Disconnect? Synced accounts and history are kept." with
  two byte-identical "Disconnect U.S. Bank (Plaid)" aria-labels — would otherwise have been the
  weaker surface for the identical action, contradicting the card one section above it.
- The Combined-accounts card had its own "two identical rows I can't tell apart" report
  (Venture ····6271 twice). **CLOSED 2026-07-24 by #297** — see the section at the top of this
  file; the per-side block established here was indeed the precedent it took.


## 🟠 OPEN — intermittent DOM duplication on /accounts (surfaces as a strict-mode e2e failure)

Found 2026-07-24 (~03:00 local) while gating #279, then narrowed with a temporary probe (deleted).
**NOT DIAGNOSED — do not act on the hypothesis below before running its check.**

**Symptom.** `tests/e2e/reconcile.spec.ts:89` fails with a Playwright strict-mode violation:
`getByTestId('reconcile-candidates')` resolves to 2 elements, one `hidden`.

**Corrected scope — it is NOT reconcile-specific.** The probe showed
`accounts-net-worth-amount` ALSO resolving to two identical `$4,900.00` nodes on the same page.
Both testids have exactly ONE render site in the source (`accounts-list.tsx:79` and `:467`), and
the page mounts `<AccountsList>` once, so this is the whole /accounts content tree existing twice
in the DOM — not a component rendering two cards.

**What is established (each executed):**
1. **Not caused by #278/#279.** `git stash push -- src tests` + rebuild + rerun → fails identically.
2. **Not local database accumulation.** Deleted the e2e SQLite file so global-setup recreated it → still failed.
3. **Not the documented load-contention flake.** Reproduced isolated at `--workers=1`, 3/3.
4. **Not a render-transition artifact.** The duplicate persisted for the full 20s `toBeVisible`
   timeout, and the second copy is hidden (which is why the accessibility snapshot, which prunes
   hidden subtrees, shows only one copy and looks normal).
5. **It IS intermittent, with a long sticky period.** After failing 3/3, the same spec then passed
   3/3 with no code change. It also passed several full `VERIFY_E2E=1` runs earlier the same night.

**Original leading hypothesis — now DISPROVEN for the /accounts markup (2026-07-24 diagnosis).**
The theory was a React hydration mismatch driven by a time-relative string on /accounts
(`lastSyncedAt` / "Not synced yet" / `formatRelativeDays`) diverging between the server render and
client hydration. An explorer trace of the whole /accounts render tree found it is **clock-clean**:
`page.tsx` computes `businessToday()` **once, server-side**, and serializes it into props
(`data.today`, `data.simplefin.health`, per-account `freshness`); every relative-time value on the
client — `freshnessMessage`, the PlaidConnections "last synced" line, ConnectSimplefin — is a
**pure formatter reading a server-computed prop**, and **no client component re-reads the clock**.
So the specific "time-relative string in the /accounts tree" trigger cannot fire.

**Ruled out this session (each checked, not argued):** the **service worker** (`public/sw.js` is
v4 — installability + push only, **no fetch handler**, so it cannot double-serve a document);
**React StrictMode** (absent, and e2e runs a **production `next start` build**, where StrictMode's
dev double-render doesn't apply); the **root layout** (`src/app/layout.tsx` is fully static —
hardcoded `dark` class, `next/font`, no clock, no client-conditional attributes).

**Confirmed structural mechanism for the "hidden" duplicate.** `src/app/(app)/loading.tsx` exists,
so Next.js wraps the entire `(app)` route group — /accounts included — in a **Suspense boundary**.
A Suspense streaming reveal emits the resolved content into a `<div hidden>…</div>` and a script
relocates it; a reveal/hydration that doesn't cleanly complete leaves the server's hidden copy
beside the client render — which is exactly "the whole content tree twice, one copy hidden." This
explains the *shape*; the *trigger* is still unconfirmed.

**Could NOT reproduce (2026-07-24).** Ran a temporary instrumented probe on current HEAD (rebuilt)
that drove /accounts with the seeded reconcile pair and a `page.on('console')`/`pageerror`
listener — **48 iterations total** across two shapes (single reused context, then a faithful
fresh-context-per-iteration against the warm server). **Zero duplications, zero hydration console
errors** (prod React still logs minified #418/#421/#423, so a real mismatch would have shown). The
flake is in its "good" sticky period; ground truth is not obtainable until it re-enters a bad one.

**Armed for next time (shipped this session).** `reconcile.spec.ts` now has a `test.beforeEach`
that prints any React hydration error (incl. the minified #418/#421/#423) and any `pageerror`
straight into the run output. When the flake next fires — in CI or a future local bad period — the
opaque "resolved to 2 elements" strict-mode failure will arrive **already named** with React's own
error and the element it points at. **Do NOT loosen the strict locators to make it pass** — that
would hide a real duplicate-render bug. The temporary probe was deleted (its job was the 48-run
capture above).

**Next step when it recurs:** read the `[reconcile hydration]` / `[reconcile pageerror]` line the
beforeEach prints; it names the mismatching element. Then the fix targets that element's
server/client divergence (or the Suspense boundary), deterministically.

**Not shipped-blocking** (unit suite green; the rest of the e2e suite green; CI is the arbiter).
It nominally guards Wave 4.6's money boundary, but Wave 4.6 is COMPLETE (#275) and 48 clean
renders show the markup is hydration-sound, so this is a flaky-gate hardening item, not a live
money-correctness risk.

## 🔴→✅ Plaid connections showed no bank name — "Connected bank" for every link (#288, 2026-07-23) — owner-reported, FIXED

Owner, with real Chase + a just-added Capital One both linked through Plaid (screenshots):
*"This section needs labels."* Every Plaid connection row on /accounts read **"Plaid: Connected
bank"**, so two linked banks were indistinguishable.

**Verified cause (not the reported surface — the pipeline behind it).** `PlaidItem.institution`
(the schema field), `getAccountsView`'s select (`src/server/transactions.ts:327`), and the
connection row's render (`src/components/finance/plaid-connections.tsx:122` —
`{item.institution ?? 'Connected bank'}`) had ALL supported the name since the field was added —
but **nothing ever WROTE it**. `exchangePublicToken` created the item with no institution, and no
other code set it (`grep institution src/lib/providers/plaid.ts` returned nothing). A
supported-but-unwritten column renders as a permanent blank. Same shape as #277's unwritten cycle
days: a surface promising something the pipeline never filled.

**Shipped.** A server-side resolver `resolveInstitutionName` (`/item/get` → `institution_id`, then
`/institutions/get_by_id` with `country_codes: ['US']` → name) is called (a) at link in
`exchangePublicToken`, stored preserve-on-null so a re-link never nulls a real name; and (b) as a
backfill `syncInstitutions(userId, {itemId?})` for items still lacking a name — idempotent (only
`institution: null` items are looked up, so no billed call once resolved), per-item fault isolation
+ audit (`plaid.institution.resolve.failed`), always user-scoped. It mirrors the #280
`updateWebhooks` backfill EXACTLY and is wired best-effort into the same two places: `syncPlaidNow`
(so the per-bank **Sync** and the one-tap **Sync all accounts** both label banks) and the daily
cron sweep (optional port method + `institutionsUpdated` row/audit, hands-free for a user who never
opens the app). **No schema change** (the field existed) and **no UI change** (already rendered).

**What the owner does:** tap **Sync all accounts** once after this deploys — Chase and Capital One
pick up their names on that pass (or the next daily sweep does it automatically). New links are
named at link time.

Gate: `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0 / eslint 0 / **3541 unit / 243 files** /
build clean (+10 tests, +1 file). E2E not separately run — backend-only, no UI/route change (same
stance as #280). **UNVERIFIED against live Plaid** (no creds in this env): the `/item/get` +
`/institutions/get_by_id` sockets have never run here; mocked-server + real-Prisma tests only.

## 🔴 OWNER ACTION — real duplicates double-counting ~$965K (detector gap FIXED #294; the rows still need deleting)

The owner's /accounts screenshots show **three accounts listed twice** — an old stale row AND the
live Plaid row — **both counting** toward the **−$1,971,653.56** net worth:

| Account | Stale row (has Delete ⇒ disconnected) | Live Plaid row |
|---|---|---|
| Truist mortgage | Truist Mortgage 1192 (1192) — **−$933,367.31** (38d stale) | Mortgage 1192 ····1192 — −$931,306.41 |
| U.S. Bank loan | U.S. Bank Loan - 2927 (2927) — **−$23,787.80** (49d stale) | Loan - 2927 ····2927 — −$23,796.57 |
| Chase card | CREDIT CARD ····0977 — **−$8,475.31** | CREDIT CARD ····0977 — −$8,475.31 (identical) |

**≈$965K of phantom debt**; the true figure is nearer **−$1,006,000**. Owner-actionable NOW: Delete
the stale row of each pair (or Combine). No code change can safely auto-delete — that stays the
user's call (#192 is advisory by design).

**Detection gap to fix (the real work).** The Chase ····0977 pair IS caught (same mask + balance).
The **U.S. Bank loan pair is invisible to the detector**: `distinctiveNameTokens("U.S. Bank Loan -
2927 (2927)")` reduces to **{}** — "bank" and "loan" are stopwords, "2927" is dropped as numeric,
"u"/"s" are 1-char — and the Plaid side "Loan - 2927" likewise; balances differ by $8.77 so the
balance signal misses; SimpleFIN has no mask column. No signal fires.
**FIXED (#294).** A last-4 **embedded in the name** is now a **POSITIVE** match signal (SimpleFIN
"…(2927)" vs Plaid mask **2927** = a confirmed same-account match, high confidence). This is the SAFE
direction and the exact asymmetry critic F3 flagged — a mis-read can only surface a *dismissable*
pair, never hide a real duplicate (which is why the same parsing stays OUT of the veto path, #292).
Both the loan and the mortgage pair now flag `same last-4 (2927)` / `(1192)`; a parenthesized YEAR
("Roth IRA (2021)") is neither matched against a real mask nor suppressed. **Still owner-action:**
the detector is advisory by design (#192) and never auto-deletes — the stale row of each pair has to
be Deleted or Combined by the user.

## ✅ Plaid account rows claimed "not synced" while their bank had synced that morning (#293, 2026-07-24) — FIXED

Owner-reported with screenshots: every Plaid **connection** row read "last synced 2026-07-24" while
the **account** rows under Liabilities read **"Not synced yet"** (Loan - 2927, QuicksilverOne),
**"Last synced 8 days ago"** (Mortgage 1192, Bonvoy Amex), and **"No new data in 15 days — you may
need to reconnect."** (Delta SkyMiles) — a reconnect nudge for a card whose bank synced that morning.
The page contradicted itself.

**Cause.** `getAccountsView` supplied `connectionLastSyncedAt` — the "a sync actually RAN" floor that
`health.ts`/`mostRecentDate` exists to apply so a quiet-but-live feed can't false-alarm — for
**SimpleFIN only**; Plaid passed a hardcoded `null`. So a Plaid account graded entirely on its
**newest transaction date**, which a mortgage or loan never has and a quiet card has rarely.

**Fixed.** Plaid accounts now use their own `PlaidItem.lastSyncedAt`, matched by `Account.plaidItemId`.
**Counter-locked** so it can't paper over a dead connection: a bank whose `lastSyncedAt` is genuinely
old still grades `very_stale` and still shows the reconnect nudge. A pre-#256 row with no
`plaidItemId` keeps the transaction-date fallback and self-heals on its next account sync.

**Also fixed (same report).** The connection rows were a wrapping flex with `justify-between`, so
Sync/Disconnect sat on the right for a short bank name ("Plaid: Chase") but **wrapped onto their own
left-aligned line** for a long one ("Plaid: American Express") — the buttons landed in two different
places down the list. Now a block card: status text flexes in its own column, controls pinned right
identically on every row, armed confirm on its own full-width line.

Gate: `bash scripts/verify.sh` → GREEN — tsc 0 / eslint 0 / **3604 unit / 247 files** / build clean.
No schema change. Locked by `tests/unit/accounts-freshness.test.ts` (4 cases incl. the counter-lock).

## 🟠→✅ Duplicate "Venture" flag was a MIS-MATCH — differing-last-4 rule + dismiss + connection last-4 (#291, refined #292, 2026-07-24) — FIXED

**REFINED (#292, 2026-07-24).** A follow-up owner report on the "Combine accounts" card (his SimpleFIN
"Chase Bank E. LEE (4034)" vs his wife's Plaid "M. LEE ····4927", IDENTICAL balance) surfaced that the
#291 veto was **too blunt**: a different last-4 is a different CARD, not necessarily a different
ACCOUNT — one account can carry a spouse's authorized-user card (different number, one shared balance).
So the veto now disqualifies **only the weak name signal, never the strong identical-non-zero-balance
signal**: the Ventures (different balances, name-only) stay hidden, but the identical-balance Chase pair
is **surfaced** so the owner can Combine (one account) or dismiss. A Fable critic on an explored
name-embedded last-4 extraction found 3 P2 false-negatives (a parenthesized YEAR "Roth IRA (2021)" and
the x in "Amex" mis-read as a last-4 → silent double-count), so that extraction was **removed** — the
mask column + balance-survives handles both owner cases safely. This SUPERSEDES the "accepted trade-off"
recorded below; there is no silent-suppression path now (a differing last-4 with a matching balance is
always surfaced). Gate: verify.sh GREEN — 3600 unit / 246 files, build clean. See DECISIONS #283/#292.

**RESOLVED (#291).** The owner confirmed (Capital One screenshot) he has **two different cards** —
**Venture ····6271** ($10,218.99) and **Venture One ····2689** ($0.00) — and that he aggregates
**both his and his spouse's** cards in one account (so two Capital One connections; her Venture ends
**····0966**). So the "possible duplicate" was a **false positive**: the #192 detector matched two
genuinely-different cards on the shared name "Venture" alone, ignoring the different last-4. Three
fixes shipped (Fable hostile-critic pass; see §DECISIONS #282 / #291):

1. **Logic** — `duplicateSignals` (`duplicates.ts`) gains a NEGATIVE veto: when BOTH accounts carry a
   last-4 and they **differ**, `return null` before any positive signal. One change in the shared
   matcher fixes the duplicate **warning** AND the reconciliation **candidate** path. Fires only when
   both masks are present, so a real Plaid-vs-SimpleFIN duplicate (SimpleFIN carries no mask) still
   evaluates by name/balance.
2. **Identification** — each Plaid connection row now lists its cards (name + last-4) via a new
   `PlaidItemView.accounts`, so two same-bank connections (his Chase vs her Chase) are
   distinguishable and it's clear what a Disconnect removes.
3. **Dismissible** — a "Not a duplicate — dismiss" button persists a per-pair dismissal in the
   `NudgeDismissal` store under a `dup:` namespace (no schema change), filtered out of **both** the
   warning and the reconciliation candidates (critic DUP-DISMISS-1 — an explicit "not a duplicate"
   judgment binds the sister surface too).

**Accepted trade-off (critic F1, recorded).** A single card reissued with a NEW number and re-linked
as two Plaid items carries two different last-4s and is now silently un-warned by the veto — the
direct collateral of the owner's "different last-4 = different card" rule. The common reissue updates
the mask in place on the SAME item (no second row), so the trigger is disconnect+relink / same-bank-
linked-twice only, it's Undo-reversible, and it is never a cross-provider/normalization false-negative
(only Plaid writes masks). Widening this would reintroduce the false positive the owner reported.

Gate: `bash scripts/verify.sh` → GREEN (tsc 0 / eslint 0 / **3597 unit / 246 files** / build clean);
e2e `auth.spec` + `reconcile.spec` 7/7 on mobile-380. No schema change. Original analysis kept below.

---

> **RESOLVED 2026-07-24 by #297** (display half). The card now groups by live account, names
> every old account folded in, and gives each link its own tellable-apart Undo. The
> CORRECTNESS half below — whether both links are right — remains owner-only knowledge, and is
> exactly what the new rendering makes answerable.

Owner, same /accounts screenshots: the **"Combined accounts / Counted once, on the live
connection"** card lists **"Venture (Plaid ····6271)" TWICE, identically** (same mask, same "history
kept through 2026-07-18"); Spark Miles ····5154 and QuicksilverOne ····2079 each appear once.

**Mechanism (verified from code, NOT the reported surface).** `AccountReconciliation` makes
`predecessorAccountId @unique` but leaves `successorAccountId` NON-unique on purpose
(`prisma/schema.prisma:192-193`, comment: "one live account may supersede more than one old row").
The card (`ContinuedAccountsCard`, `accounts-list.tsx` ~592-637) and its assembler
(`getAccountsView`, `transactions.ts` ~479-492) render **one entry per active reconciliation link,
with no grouping/dedup by successor**. So the two Venture rows are **two different SimpleFIN
predecessors both linked to the one Plaid "Venture ····6271" successor**.

**This is NOT the #287 hydration duplication** — only one entry doubles, not the whole tree (net
worth + the other rows appear once).

**Money impact — net worth is NOT double-counted.** Under the reconcile boundary (R1/R2, #272/#273)
every predecessor contributes **0** balance and the live successor's balance counts **once**, so two
predecessors → one successor does not inflate the total. The open risks are (a) the confusing
duplicate display and (b) whether both links are *correct*: if the matcher tied two genuinely
different old cards to one new card, the successor wrongly absorbs both histories.

**Owner-gated before any fix (rule 0 — cannot see their data):** does the owner actually have **two
separate "Venture" accounts** at Capital One, or one? Two real accounts → the fix is display
grouping (one card per successor, listing its predecessors). One account wrongly matched twice → a
reconciliation-match fix. **Either touches how reconciled balances/history render → Fable critic
when built.** Interim remedy for the owner: **Undo** on the spurious row un-links it (reversible).

**Lifecycle ("hopefully this disappears eventually"):** entries persist while both predecessor and
successor exist and the link is active; one leaves on **Undo**, or when the old SimpleFIN
predecessor is deleted/disconnected (the link goes inert) — but deleting the predecessor discards
its pre-Plaid history, which is the exact thing reconciliation exists to keep. A less-destructive
option (offered to the owner): make the card collapsible / less prominent once confirmed.

## 🔴→✅ No way to sync a Plaid account (#278, 2026-07-23) — owner-reported, FIXED

Owner: *"Is there a way to (force) sync accounts in app? Some of my accounts haven't been synced
for almost a week"*, then *"I want one button sync of all accounts. And individual syncing if
required."*

**Verified cause.** SimpleFIN has had an on-demand `syncSimplefinNow` **and** auto-sync on every
full page load since #91. Plaid had **neither**: its only ingest was the one-shot pull inside
`linkPlaidAccount`, and the nightly cron resolves through `getProvider()`, a no-op unless
`DATA_PROVIDER === 'plaid'`. So a Plaid account synced once, at link, and then went stale — the
/accounts row printed "last synced …" next to a Disconnect button and nothing else. Two providers,
two completely different behaviours for the same user action.

**Shipped.** A single **Sync all accounts** button at the top of the connections block on
/accounts (`sync-all` testid) that covers every connected provider; a per-bank **Sync** on each
Plaid connection row (`plaid-sync`); SimpleFIN keeps its existing button; and Plaid now
participates in auto-sync-on-load, throttled to 15 minutes against SimpleFIN's 10 seconds because
production Plaid calls are billed per request and this fires on every full page load.
`syncAllAccounts` composes the two per-provider actions rather than reimplementing them, isolates
each provider (one bank's expired login must not cost the other's fresh data), reports partial
success as success with the failure **named**, and always states the outcome — including "No new
transactions", so a sync that did nothing cannot be mistaken for one that never ran.
`DataProvider.syncTransactions`' vestigial `cursor?: string` parameter (no caller ever passed it)
became an options bag carrying `itemId`; the same scoping was added to `syncLiabilities`, always
user-scoped so a foreign `itemId` matches nothing rather than syncing a stranger's bank.

Gate: `VERIFY_E2E=1 bash scripts/verify.sh` → **VERIFY GREEN** — 3504 unit / 241 files, 162 e2e.
No schema change. **UNVERIFIED:** the buttons have not been exercised against a live Plaid
connection — only against mocked providers and the demo/e2e fences.

## 🔴→✅ Cards said "nothing due" while cards were owed (#277, 2026-07-23) — owner-reported, FIXED

Owner, verbatim, with real Chase/Capital One cards linked through Plaid: *"cards: no card
payments are due this cycle…this isn't true"*, and separately that **/cards listed no cards at
all** while /accounts showed them with balances.

**Two independent root causes, both confirmed by execution.**

1. **Engine → UI.** `buildObligation` returns null for a card with no generated statement AND no
   cycle days — its own comment says "nothing knowable about this card" — and the caller
   discarded that null. So a card whose issuer sent no liabilities was indistinguishable from a
   paid-off card, and the resulting EMPTY set was rendered as a positive money claim on **eight**
   surfaces. A Plaid card reaches this state by construction: the liabilities sync writes a
   Statement or nothing, and the only writer of `cycleCloseDayOfMonth` is the user's own
   manual-card form — so the advertised "estimate path" fallback could never fire for a linked card.
2. **Data.** `syncLiabilities` — the only writer of card statements, due dates and minimum
   payments — had exactly ONE production caller (`linkPlaidAccount`, inside a try/catch that
   swallows the error) and **no cron**. Due dates were fetched once, best-effort, at link time and
   never refreshed; a fresh item Plaid wasn't ready to answer for failed silently forever, and a
   successful pull went stale the next cycle. Compounding it, the nightly sweep resolves through
   `getProvider()`, a documented no-op unless `DATA_PROVIDER === 'plaid'`, so a linked user could
   stop syncing entirely while *linking* is deliberately provider-independent.

**Shipped.** `CashNeededResult.unknownDueDateCards` carries the undatable cards out of the engine,
excluded from every total, projection and trace (a figure we cannot support is never invented) and
disclosed in `assumptions`. The dashboard hero, `/cards` (including its "No credit cards yet"
empty-state guard, which had excluded undatable cards from the definition of "cards"), the Ask
assistant, the weekly digest **email** and the payment-reminders card now separate "nothing is due"
from "we don't know" — in the mixed branch as well as the empty one. New `src/server/plaid-sync.ts`
sweeps Plaid-linked users daily for liabilities **regardless of DATA_PROVIDER**;
`PlaidProvider.syncLiabilities` returns counts so a silent total failure is reportable, and its
credit branch now records whichever cycle days Plaid reports.

**Three hostile-critic cycles, all findings executed rather than argued.** Cycle 1 (FAIL, 7 P1):
the identical false claim was still standing on six surfaces the first pass never touched — the
#221 widened-data-class lesson exactly. Cycle 2 (FAIL, 1 P0 + 2 P1): the P0 was **self-inflicted** —
an attempt to rescue Plaid cards by dating them from a due day alone produced a due date a month
early, an $842.67 shortfall and a live "move $850 into checking today" instruction, with the guess
disclosed as the issuer's own date. **Reverted and counter-locked**: an undatable card stays
undatable. Cycle 2 also proved the new "Add statement" instruction was unfollowable — that control
exists only for manually-added cards — so it was removed rather than reworded.

**Deliberate non-fixes (recorded):** dating a card from a due day with no cycle anchor (see the
P0 above). ~~The nudge feed's "Nothing needs you today"; `cash-needed-card` takes no
`accountOwnerLabel`; a depository-only Plaid item audits `liabilities: 'failed'` daily; `plaidError`
returned but not audited.~~ **→ All four (plus the missing mixed-branch coverage) CLOSED by TASKS
L.4 / #289 (2026-07-23); see §L.4 close-out below.**

**Still true and NOT fixed by this work:** if the owner's issuers return no liabilities at all,
these cards stay in the honest "no due date yet" panel. What changed is that the app now says so
instead of claiming nothing is owed, and re-checks every day instead of never. Confirming which
applies needs the `plaid.liabilities.failed` / `sync.cron.plaid` audit rows from a real run —
**UNVERIFIED against the owner's live data.**

Gate: `VERIFY_E2E=1 bash scripts/verify.sh` → **VERIFY GREEN** — 3500 unit / 241 files,
**162 e2e**. Cycle-3 critic verification of the three cycle-2 items: see PROGRESS.md.

## ✅ Wave 4.3 — Plaid `/investments/holdings` parity with SimpleFIN (#290, 2026-07-23)

Plaid investment accounts now sync their positions into `Holding` with the same correctness
guarantees the SimpleFIN path already had. Built + hostile-criticized on Fable.

**Shipped.** A new pure mapper `src/lib/providers/plaid-holdings.ts` joins Plaid's split
`holdings[]`→`securities[]` (by `security_id`), maps dollars→integer cents, keeps
`institution_value` as the authoritative `marketValueCents` and DERIVES the per-share
`priceCents = round(total/shares)` (not Plaid's own `institution_price`) so the
derived-vs-authoritative model matches SimpleFIN exactly (#129); withholds non-USD lots (no FX),
drops cash sweeps, skips shorts/over-ceiling/un-keyable rows. `PlaidProvider.syncHoldings` +
`reconcilePlaidHoldings` write `source='plaid'` rows and prune sold ones, with **source
isolation generalized** — a feed touches ONLY its own `source` rows, so a manual (or any other
provider's) position is off-limits to both upsert and delete. `investments` was added to the
link-token `required_if_supported_products` (a depository-only bank still links; an item without
the product reports `unsupported`, never `failed`). **Cost guard** (production Plaid is billed per
request): a user with no INVESTMENT account makes ZERO holdings calls, and a checking/credit-only
bank is never asked, via the `Account.plaidItemId → PlaidItem.itemId` linkage. Wired best-effort
into `linkPlaidAccount`, `syncPlaidNow` (per-bank + Sync-all), and the daily cron sweep (with
`holdings*` counts in the `sync.cron.plaid` audit). Net worth is unaffected — holdings are a
within-account breakdown; the account balance stays authoritative — and cross-provider
reconciliation needs no new work (`getInvestments` already filters superseded predecessors, #273).

**Hostile-critic Workflow — 3 fresh-context lenses, each finding adversarially verified: 1 P2 +
3 P3, ALL fixed + regression-locked.** (P2) `rawHoldings ?? []` read a malformed/missing `holdings`
array on a 200 as "sold everything" and wiped positions — the #128 `transactions:null` hazard the
SimpleFIN sibling guards with `Array.isArray`; now guarded (leave rows intact + audit
`plaid.holdings.malformed`). (P3) a truncated `securities[]` pruned still-held un-joinable
positions — now prune only on a CLEAN run (`skipped===0`). (P3) the sweep dropped `syncHoldings`
`itemsFailed`, so a total holdings failure read as a clean run — now surfaces
`holdingsAttempted`/`holdingsFailed` + a total-failure error.

**Known limitation — deliberate non-fix (recorded; a follow-up, not this slice).** When Plaid
reports `cost_basis: null` (common), the mapper stores `costBasisCents = 0`, and /investments then
shows the position's unrealized *dollar* gain as its full market value (a green "+$X"); the gain
*percent* is correctly suppressed (null). This is **identical to the shipped SimpleFIN path** — not
introduced here — and it is confined to the per-position /investments display (never net worth, FI,
coach, or any total). An honest fix ("gain unknown" when basis is absent) needs a **nullable
`costBasisCents`** to tell "unknown basis" from a genuine $0 basis — a schema + engine + UI +
SimpleFIN + manual-entry change across the whole investments path, out of scope for a Plaid parity
slice. Recorded here so it isn't rediscovered as new.

Gate: `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0 / eslint 0 / **3591 unit / 246 files** /
build clean (+38 tests, +2 files). E2E (from the earlier `VERIFY_E2E=1` run): **163 passed, 1
failed = the documented load-contention flake** (a different spec each run — `phase4-features goals`
then `settings-dials money-dials` — both proven to pass clean in isolation; §`e2e-dials` lesson).
CI is the arbiter. **UNVERIFIED against live Plaid** (no sandbox creds here): the
`/investments/holdings/get` socket has never run; mapping + reconcile tested against mocked
providers + real Prisma only. Existing items linked BEFORE this change don't carry the
`investments` product, so their holdings sync returns `PRODUCTS_NOT_SUPPORTED` (→ `unsupported`,
not `failed`) until re-linked — a forward-looking gate, no app bug.

## ✅ TASKS L.4 close-out — the five #277-critic P2s + a critic-found copy inconsistency (#289, 2026-07-23)

Built on Opus (ultracode; owner out of Fable credits). The five recorded #277 P2s are closed, and a
hostile-critic Workflow (3 fresh-context lens critics → each finding adversarially verified) then
found a coherent defect the five did not, which is closed in the same change.

**The five P2s.** (1) The nudge feed's empty `emptyReason` ("Nothing needs you today.") now names
the gap when balance-carrying undatable cards exist — it was a false all-clear while a real card
balance was outstanding. (2) `CashNeededCard` gains an `accountOwnerLabel` prop and owner-attributes
a partner's undatable card at household scope (byte-identical at `mine` — empty map → bare name;
key-space verified: `unknownDueDateCards[].cardId === account.id === accountOwnerLabel` key). (3)
`LiabilitySyncResult`/`PlaidSweepRow` gain `itemsUnsupported`: `syncLiabilities` classifies
`PRODUCTS_NOT_SUPPORTED` / `NO_LIABILITY_ACCOUNTS` (a depository-only item's own "no liability data
here" — expected) as unsupported, audited `plaid.liabilities.unsupported`, and the sweep +
`syncPlaidNow` "failed" predicate excludes unsupported — so a checking-only user is no longer audited
`failed` every night forever. (4) A user-initiated transaction-sync total failure now audits
`plaid.sync.transactions.failed` instead of being returned to the UI and recorded nowhere. (5) The
dashboard mixed branch gains e2e coverage.

**The critic finding (4 confirmed / 3 refuted, one root cause).** The cash-needed engine carries
**every** undatable card in `unknownDueDateCards` — including a $0 paid-off card, which is correct
because `/cards` still lists it (a connected card is never invisible, #277). But only the hero-null
branch and the new nudge fenced on `currentBalanceCents !== 0`; the cash-needed **number/mixed
branch**, the **payment-reminders count** and the **weekly digest count** read the raw list. So a $0
paid-off card retracted "pay all N cards in full", was named as a withheld balance, and made the
reminders card + digest claim "a card has no due date yet, so it isn't included" — **while the hero
and nudge on the same dashboard showed the plain all-clear.** The 3 refuted findings were all the
negative-balance variant, correctly refuted: a credit/overpaid card genuinely can't be dated, so
"not included" stays honest (matching the hero panel's own threshold).

**Fix.** ONE shared `undatedCardsWithBalance()` in `cash-needed/types.ts`, read by all five surfaces
(hero-null, number/mixed branch, nudge, reminders count, digest count) — three inline copies of the
`!== 0` filter were exactly the drift the critic caught. `/cards` deliberately NOT fenced (#277
visibility — filtering would regress the "No credit cards yet" empty-state for a user whose only card
is a $0 one). Negative (credit) balances deliberately kept.

**Gotcha (recorded).** The e2e `webServer` runs `next start` with **no** `next build` +
`reuseExistingServer` locally, so a direct `playwright` run after a source edit tests the **stale**
`.next`. The $0-card e2e first "failed" on the pre-fence build; a rebuild made it pass. Rebuild (or
run through `verify.sh`) before trusting a local e2e after an edit.

Gate: `VERIFY_E2E=1 bash scripts/verify.sh` → tsc 0 / eslint 0 / **3553 unit / 244 files** / build
clean. E2E 163 passed, 1 failed = the documented **#287 /accounts DOM-duplication flake**
(`reconcile.spec.ts:108`, "reconcile-candidates resolved to 2 elements, one hidden" — §top), which
passed **2/2 in isolation** and touches none of this diff. CI is the arbiter. **UNVERIFIED against
live Plaid** (no creds here): the liabilities classification + `txError` audit ran only against
mocked providers.

## Wave M.3 close-out — the tap-reachable overflow class (#276, 2026-07-23) — M.3 COMPLETE

The M.3 items deferred as "no clipped figure" were **measured** rather than read off the brief,
with a temporary per-element probe (deleted before commit) that opened the controls the M.1
sweep structurally cannot reach — it only loads routes passively — at 360/393/430.

**One real defect, fixed.** The triage quick-pick `grid-cols-3` put "Household & Home"
(min-content 108px) in a ~102px track; the shadcn Button base is `whitespace-nowrap shrink-0`
and a grid item's `min-width:auto` floors the track at min-content, so the category name painted
outside its own cell — and a longer user-created category name would run off the edge entirely.
A category name is the label on a control that files money. Fix: `h-auto min-w-0 py-1.5
leading-tight whitespace-normal` on those Buttons (wraps in place; the `.tap-target` 44px floor
still applies — measured height 46px).

**Why the existing gate could not have caught it:** the bleed lands in the 16px shell gutter, so
document `scrollWidth` never exceeds the viewport. The lock is therefore a per-BUTTON
`scrollWidth <= clientWidth` assertion at all three widths in both `mobile-380` and
`mobile-webkit`. Fail-old was executed against pre-fix code (108 > 102).

**Fixture independence (a real bug in the first version of the test):** it drove the shared DEMO
triage queue, passed in isolation, and then failed under the full suite with an empty inbox
because `phase2-triage` files that queue first. It now signs up a throwaway user and seeds its
own `needsReview` row, and asserts the long name is actually present so the lock cannot degrade
into measuring only short labels.

**Three brief items CORRECTED as stale (the §c / #248 class), deliberately NOT "fixed":** the
money-dials and retirement what-if `grid-cols-3` number grids, and every §d fixed-width input
(custom-category-manager `w-40`/`w-44`, household-card `max-w-40`/`max-w-60`, triage
`w-40`/`w-44`/`w-24`) measured CLEAN at all three widths — they sit in `flex flex-wrap`
containers that wrap or `minmax(0,1fr)` tracks that shrink. **Moved to M.4:** the 2 inline
category-chips (transaction-list:374, shared-transaction-list:154).

**E2E flake note (not a regression):** the first two full-suite runs on this tree failed on
`phase4-features goals` then `pwa-offline` — the two documented load-induced contention specs, a
different one each run. Settled per the lesson: clean HEAD ran 159/159, this tree then ran
161/161, and the final gate ran green. CI remains the arbiter.

Gate: `VERIFY_E2E=1 bash scripts/verify.sh` → **VERIFY GREEN** — 3465 unit / 238 files,
**161 e2e** (+2, the new lock in both engines). Layout-only; no money/authz/routing, so no
Fable critic (same lane as M.1/M.2).

**Shipped and verified live:** pushed as `9c13f57`; Vercel deployment
`dpl_GzCBKc68LHixjj55Es6wpSiv7igr` reached **READY** with `githubCommitSha 9c13f57` and
`www.aimplifi.app` in its alias list, and the production alias now serves HTML byte-identical
(md5 `db1f148907b8`) to that deployment's own URL. No schema diff, so the Neon database was
untouched. A code-marker grep of the live HTML is not possible here — the changed component is
behind auth and its chunk is not referenced by any public page (same limitation noted at #271);
the alias/deployment identity above is the substitute proof.

## Wave 4.6 slice 6 — full-surface hostile critic (#275, 2026-07-22) — WAVE 4.6 COMPLETE

Three parallel fresh-context critics (money core + §6 straddle lead target / lifecycle-authz /
downstream surfaces + copy honesty) over R1–R10. **8 P1s found, all fixed + regression-locked in
the same session; zero P0.** Headlines: the boundary engine composed DIRECT links only, so a
chain A→B→C double-counted the terminal successor's deep backfill inside the original
predecessor's claim and doubled A↔C same-date snapshots (executed $-repros) — claims and
snapshot collisions now compose transitively, sibling statement re-keys dedupe, a pre-first-txn
cutover goes claim-inert, non-monotone racing chains are inert at read; the register, CSV
export, budgets, triage, and recurring detection were still Prisma-direct (register summary
80% inflated vs the dashboard on one screenload, executed) — all five now share ONE R1 closure
(`getReconciliationTxnKeep`); manual/CSV writes to a superseded predecessor vanished from every
sum — now refused and hidden from pickers; the assistant answered a predecessor query "$0.00" —
now folds onto the terminal successor with an inline disclosure; getAccountsView returned the
raw `paymentAccountId`, re-offered an already-linked predecessor (silent re-target on one tap),
and defaulted the cutover to `today` against spec §6 — all fixed; #192 now catches same-bank
re-linked through a new PlaidItem; confirm runs SERIALIZABLE (closes the two Postgres races)
and audit-logs the direction-conflict auto-undo.

**§6 straddle resolved (was the §11 open question):** accept-and-disclose across all three
skew windows — trailing double (b), leading-edge mirror (b′, critic A-F3), user-shortened-
cutover zero-count (b″, critic A-F2) — because an amount-match dedup's false-positive
direction is a silently dropped transaction, worse than a visible double. Mitigations shipped:
UI default cutover = predecessor's last transaction (spec §6), honest claim-span + skew
disclosure in the confirm card, EDGE_CASES residuals.

**Deliberate non-fixes (recorded, DECISIONS #275):** sibling-predecessor transaction/snapshot
overlap stays residual (c) (advisory-covered; the link model cannot express it); B-F6 UTC
business-today = platform #58; B-F7 broken-item-counts-live is the safe refusal direction
(commented in code); household duplicate detectors keep the blanket same-provider skip.
**Remaining e2e gaps (unit-locked, not e2e-driven):** credit-card reconciled pair, 3-account
cluster flows.

Gate: `VERIFY_E2E=1 bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0 / eslint 0 /
**3465 unit / 238 files** / build clean / **e2e 159/159** (both engines; the documented goals
teardown flake did not occur this run). 5 REGRESSION_LEDGER entries; EDGE_CASES
§Reconciliation-Boundary slice-6 sections; spec marked BUILT, §11 resolved.

## 🔴 OPEN — owner-reported 2026-07-21: "the password isn't being remembered" (START HERE NEXT SESSION)

Owner, verbatim, at the end of the #260 session: *"There's a problem with the
password saves that we need to fix next session. It used to work. We did lots of
things in env variables today and now it's just not remembering the password I
entered earlier."*

**NOT DIAGNOSED — do not act on any theory below before its check.** The symptom
sentence has at least three readings (the browser isn't saving/filling it; sign-in
rejects a password that used to work; the session drops and it asks again), and
they have different fixes.

**Verified facts, read-only, this session (these are evidence, not guesses):**
1. **No env var can invalidate a stored password.** `src/lib/auth/password.ts`
   stores `scrypt$<salt>$<key>` with the per-password salt INSIDE the stored
   string; verification re-derives from that salt alone. Today's env work cannot
   have made a correct password stop matching. (Env DOES affect reset links: their
   hashes are salted with `RESET_TOKEN_SALT ?? AUTH_SECRET ?? dev-fallback`, so a
   changed `AUTH_SECRET` kills outstanding reset links — not stored passwords.)
2. **Sessions are JWTs** (`src/auth.config.ts`: `session: { strategy: 'jwt' }`)
   carrying a `sessionEpoch` re-checked server-side; a completed password reset
   bumps it and signs out every existing session BY DESIGN (#257).
3. **The one thing that changed about the password FIELD today is #258.** Git
   confirms the `autoComplete` attributes (`email`, `current-password` /
   `new-password`) have been there since the original auth commit `c665ae6` and
   were not touched; `src/components/auth/password-input.tsx` — the show/hide
   viewer whose `type` attribute flips between `password` and `text` — was created
   today in `0deda04` (#258) and wired into sign-in, sign-up AND reset-password.

**CORRECTION, 2026-07-21 (#261): the #258 hypothesis is DEAD for the deployed
app.** Production was running commit `9e3e56f` (#257) — verified against the
Vercel deployment list, `githubCommitSha` on every production deployment — while
local `main` sat **8 commits ahead, unpushed**. #258 (the show/hide viewer) was
therefore *never live on www.aimplifi.app*, so a `type`-flip on the deployed site
cannot have caused anything the owner saw there. It remains a possible cause only
if the owner was testing against a local dev server. The restoration below is
still correct and still shipped; it is just no longer the leading explanation.
(The owner reported the same session that they could not see the reveal at all —
that observation is fully explained by the same unpushed-branch fact.)

**Also corrected: the repo is PRIVATE** (`githubRepoVisibility: "private"` on
every production deployment record), which de-escalates the secrets item below
from "publicly exposed" to "committed where it should not be".

**New leading hypothesis (LABELLED — unconfirmed) + its check.** What WAS newly
live on the deployed app is #257, the reset flow, and it has two verified
properties that compose into exactly the reported sentence: a completed reset
bumps `sessionEpoch` and signs out every session by design, and the reset form
does *not* sign the user in afterwards — it links them to /sign-in. So after
resetting, the browser meets a sign-in form and autofills the **old** saved
password, because nothing ever offered to save the new one. "It's just not
remembering the password I entered earlier" is a precise description of that.
**Check:** have the owner open their browser's saved-passwords list and compare
the stored entry for aimplifi.app against the password they most recently set. If
the stored one is stale, the fix is on the reset form (make the browser offer to
update the credential), not on the sign-in field.

**Superseded hypothesis, kept for the record:** a password manager can stop
offering to save a credential when the field's `type` flips away from `password`,
which is what #258 introduced on all three forms.

**Shipped 2026-07-21 (#261) — a precautionary RESTORATION, not a claimed
diagnosis.** Per CLAUDE.md rule 0 ("when the app is broken, restore a known-good
state first"), `PasswordInput` now re-hides itself in a capture-phase `submit`
listener on its own form, so the form the browser inspects at submission carries a
real `type="password"` field exactly as it did before the viewer existed — while
keeping the viewer the owner asked for. Locked by `auth.spec.ts` "a visible
password is hidden again before the form submits" (toggle to `text` → submit →
assert `type` is `password` and `aria-pressed` is `false`).
**What this does and does not establish:** it removes #258 as a *possible* cause
by construction, and the DOM state is executed-and-verified. Whether the browser
now offers to save again is **UNVERIFIED** — no password manager runs in this
environment, and only the owner can confirm it on the real device.

**Still ask the owner (never describe a screen we haven't seen):**
(a) a screenshot of where it fails; (b) whether the prompt that's missing is the
BROWSER's "save password?" or the APP's sign-in rejecting it; (c) the exact
on-screen message, if any; (d) which browser/device; (e) which env vars were
changed today (names only, never values) — **(e) is now the highest-value
question**: `AUTH_SECRET` is the JWT signing key, so *rotating it signs every
device out at once*, which reads exactly like "it stopped remembering me". That
mechanism is env-caused and entirely separate from the field-`type` one above,
and the two have different fixes.

## 🟠 OPEN — two real secrets are committed to git (repo confirmed PRIVATE; owner: decide on rotation)

`docs/DEPLOY.md:54–55` carries literal generated values for `AUTH_SECRET` and
`DATA_ENCRYPTION_KEY` ("provided for you"), committed in `ca23eac` (2026-06-21)
and never removed, on a branch pushed to `github.com/meleesciony/Aimplifi`.
Verified by `git log --all -S`: one commit introduced them, none removed them, so
they are still in HEAD *and* in history.

**RESOLVED, same session:** the repo is **private** — every production deployment
record carries `githubRepoVisibility: "private"`. So this is not a public
exposure. It is still a real hygiene failure (a secret in version control is
readable by every current and future collaborator, every CI integration granted
repo access, and anyone who ever clones it), and the values should be treated as
burned. Still unknown from here: whether the deployed project actually uses these
exact values — DECISIONS #198 records only that Production already had the
variables set, not what they were set to.

**If the values match production**, anyone with repo access can forge a
signed session JWT for any account. Rotation order matters and each step has a
visible cost, so it is owner-gated:
1. Rotating `AUTH_SECRET` signs every device out (expected, harmless) and kills
   outstanding password-reset links (`RESET_TOKEN_SALT ?? AUTH_SECRET`).
2. Rotating `DATA_ENCRYPTION_KEY` makes every stored Plaid/SimpleFIN token
   undecryptable (`src/lib/crypto.ts` AES-256-GCM), so connected banks must be
   re-linked. Do not rotate this one casually.
3. Removing the values from `docs/DEPLOY.md` fixes HEAD but not history; the
   values must be treated as burned regardless.


## ⚠️ OPEN — Ask parser/vocab, remaining items (post-2.7)

The #226 escalation is fully **RESOLVED**: TASKS 2.6 shipped 2026-07-12 (#229) and TASKS 2.7
shipped 2026-07-14 (#230; §Wave 2.7 below) — escalation items 3 (largest merchant scope) and
4 (bare-year/numeric-date windows) now earn real answers. Still open, each honest-but-
unanswered (no wrong number is ever shown):

1. **The weekly vocab re-check cannot distinguish the classifier answering "none" (a real
   disagreement) from a network fault**; both mean "no opinion, no change", so a rule the
   resolver now considers unanswerable keeps serving. (Escalation item 5, unchanged.)
2. **Tier-1 synonyms inside store names — ATTEMPTED as TASKS 2.8 (#231), found
   MERCHANT-DB-BLOCKED, and REVERTED (tree back at #230).** "at travel lodge" → the Travel
   group, "at total wine" → alcohol, "at 24 hour fitness" → fitness: a curated synonym inside a
   store name outranks the merchant reading and answers the whole CATEGORY. Note the failure
   class: the category is a **superset** of the store, so this is a nonzero, wrong-SCOPE figure
   — never a $0. The 2.8 slice tried to route these to `merchant_spend` by detecting a
   "distinctive" store token adjacent to the synonym (a `resolveSpendTarget` guard aligned with
   `extractSpendMerchant`, span-based synonym coverage, curated tail/modifier sets). **Three
   fresh-context Fable critic cycles proved the approach unsound.** The decisive finding:
   "SHELL gas station" (a brand) and "FANCY gas station" (an adjective) are structurally
   identical `[X][synonym][tail]`, and **no lexicon or structural rule separates a brand token
   from a generic modifier — that IS the merchant-identification problem** (the same dependency
   as item 3). Worse, the precision fix **regressed common, currently-correct category
   phrasings into confident $0 fabrications**: "at gas stations" (plural) → "No spending at Gas
   Stations", "at the fancy/big/old/neighborhood coffee shop" → $0. Trading a common
   correct answer for a confident $0 to win a rarer store answer is a net-negative trade
   (cardinal-sin direction), so the slice was reverted rather than shipped. **CONCLUSION: this
   is the SAME class as item 3 below — closable only with a merchant database.** Until one
   exists, the safe category-superset answer stands (nonzero, directionally-correct, never a
   $0). A future *narrow* slice could soundly fix only the un-ambiguous sub-cases — possessives
   ("gold's gym") and digit-bearing names ("24 hour fitness") — but every headline name
   ("travel lodge", "total wine", "shell gas station") is in the ambiguous class. Full evidence:
   DECISIONS #231; the three critic reports are summarized there.
3. **A residual licence gap by construction (now the umbrella for item 2's class too):** a
   store whose name we cannot distinguish from category/reserved words without a merchant
   database. Two instances: (a) a store spelled entirely in licence-consumed tokens ("Do It
   Best") can license the total in fronted order — the one real case is fixed and locked; (b)
   a store name that is `[brand-or-adjective][category-synonym][place-tail]` ("shell gas
   station" vs "fancy gas station") — item 2's reverted 2.8 investigation. Both need a
   merchant database; the conservative bias means new instances cost an honest redirect or a
   category-superset figure, never a wrong $0.
4. **Recorded 2.7 trades and limits** (each an honest redirect or a disclosed coarsening,
   never a wrong figure; see EDGE_CASES §Ask Timeframes / §Largest Merchant Scope): fronted
   largest objects ("At Costco, what was my biggest purchase?") redirect rather than scope;
   attributive merchants ("biggest costco purchase") redirect — resolving them needs a
   merchant database; single idiom-word stores ("at Max") cede to the idiom/total reading;
   "at Bank of America" redirects (account words joined the #168 set); verb-order "at do it
   best" still truncates to merchant "do" ('it' is a phrase-ending total word — pre-existing);
   day-granular windows ("on 3/5" as a DAY) deferred — `Timeframe` is month-granular, and the
   widening ripples through `SpendingBreakdown`/trends parity; category-scoped largest
   ("biggest grocery purchase") redirects — no engine computes it.

## Wave M.4 — mobile visual polish, slice 1 (foundation) (2026-07-22) — #268

First slice of the "beauty half" the owner asked for ("more functional and
beautiful than Simplifi/Mint"). Deliberately **restrained** — a foundation, not a
big-bang restyle (the M.4 row forbids big-bang), judged against **real rendered
before/after mobile screenshots at 393px** rather than imagination (CLAUDE.md rule 0).

Changes (all className-only; no logic, no money text):
- **Shell mobile gutter 12→16px** — `(app)/layout.tsx` `px-3→px-4`, header `-mx-3→-mx-4`,
  skip-link `left-3→left-4`. This is the shell padding the M.4 row flagged; it shifts
  **every** route, so the full suite was re-run. (Bonus: `px-4` = a 16px each-side gutter,
  which is exactly what the existing `max-w-[calc(100vw-2rem)]` dropdown guards were
  already sized for — the gutter and that guard are now aligned.)
- **Vertical rhythm** `space-y-4→space-y-5` on /dashboard + /accounts page roots (and the
  two dashboard card-pair grids `gap-4→gap-5`, so the mobile single-column stack spacing
  stays uniform with the page rhythm).
- **Page-title scale** — /accounts `<h1>` `text-xl→text-2xl font-semibold tracking-tight`.
  (/dashboard keeps its `sr-only` H1 — answer-first is deliberate; the hero card is the
  visual anchor.)
- **Hero numerals** — the two biggest figures (`cash-needed-amount`, `accounts-net-worth-amount`)
  gain `font-semibold tracking-tight`. `formatCents` output is **byte-identical**; only
  font weight/letter-spacing changed, so no copy test moves and no new figure adjacency was
  created (no rendered-copy test required).

Deliberately **did NOT** invent new CSS tokens: "extend the token system" is satisfied by
applying the existing Tailwind v4 scale + oklch vars consistently; adding a parallel token
system would violate surgical-changes. The **`frontend-design` skill was not available in
this environment** (no `.claude/skills/` or `/mnt/skills/`), so the pass leaned on the M.4
row's own encoded constraints; noted so a future session with the skill can calibrate further.

No money/authz/routing touched → no Fable critic (per the M.4 row). Gate (real output):
`VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**, tsc/eslint clean,
**3352 unit / 230 files**, build clean, **157 e2e** (1.4m) — every `mobile-overflow` spec
green in BOTH the Chromium `mobile-380` and iOS-Safari `mobile-webkit` projects at
360/393/430, confirming the wider gutter added zero horizontal overflow. Detail: DECISIONS #268.

**Remaining M.4 (multi-session):** the four hand-rolled `TrackedActedLink` "link cards"
(Ask / SafeToSpend / TopSpending / SpendingInsights / RecurringSummary) hard-code
`rounded-2xl border bg-card p-4 shadow-sm` and so will DRIFT from any future `Card` retune —
a candidate for one shared `.surface-card` utility (dedup-lesson: unify by construction).
Then route-by-route beyond the two done here. The owner should eyeball the before/after
direction before the remaining routes get the same treatment.

## Wave M.1 — mobile test-net completion (2026-07-22) — #267

Closed the deferred half of M.1: the mobile e2e safety net now covers **every**
authenticated content route, so the coverage hole that let the owner's /accounts
overflow ship is gone on all 19 content routes, in both engines.

- **Overflow structural sweep** (`tests/e2e/mobile-overflow.spec.ts`): grew from 4
  routes to all **17** authenticated content routes (every route except /accounts,
  which keeps its 3 dedicated content-scaled tests), each asserting
  `scrollWidth <= clientWidth + 1` at 360/393/430 in BOTH the Chromium `mobile-380`
  and the iOS-Safari `mobile-webkit` projects.
- **Axe WCAG-AA scan** (`tests/e2e/phase5-a11y.spec.ts`): grew from 10 to **19**
  routes, adding the 9 content routes that had no accessibility floor: /transactions,
  /recurring, /forecast, /reports, /investments, /spending-plan, /ask, /trends, /trust.
- Each route waits on an **unconditional** demo-rendered anchor testid (`recurring-hero`
  not the occurrence-gated `coming-up`; `forecast-hero`; `cushion-is-a-goal` because
  demo seeds no goals; `accuracy-card` because the demo triage inbox is empty), so the
  ready-wait can't hang on an empty state.

**No route overflowed at demo scale** — none failed-old — exactly as
`MOBILE_UI_BRIEF` predicted: demo data is modest, so these are regression **locks**
for future fixed-width/overflow regressions, not fail-old fixes. The known
M.3-deferred defect classes (the click-only `w-72` category dropdown, the `w-40`/`w-44`
fixed inputs, the 2 inline category-chips) don't overflow a passively-loaded page at
demo scale and stay with M.4's per-route pass.

**Two test-infra hardening moves were needed to keep the local full-suite gate green
(both diagnosed at the boundary, not by correlation):**
1. **Consolidated** the per-route tests into ONE demo sign-in per sweep. As separate
   tests, 34 (overflow ×2 projects) + 9 (axe) demo sign-ins on the shared demo User
   row added enough concurrent SQLite write contention to tip the reload-bearing
   `pwa-offline` budget-clear mutation spec into the documented load-flake (it passes
   solo — confirmed by an isolated re-run). Looping keeps full coverage at a fraction
   of the load; the per-route label preserves failure attribution.
2. **Rewrote `assertFitsEveryWidth` to poll the SETTLED width** (`toPass`) instead of
   measuring once after a fixed 50ms. Under full-suite load a Recharts
   `ResponsiveContainer` reflows its SVG via a ResizeObserver that can lag past 50ms,
   producing a transient `/reports @360 scrollWidth 397`. A WebKit probe proved this
   false — a fresh 360px load (what a real user gets) fits at `scrollWidth 360`, and
   even a 430→360 shrink settles to 360. A real synchronous overflow (the original
   /accounts clip) persists across every retry and is still caught; persistence is
   exactly what separates a wrong-width figure from an async reflow.

No `src/` or `prisma/` change — no product code touched, so the deployed app is
behaviorally identical and there is no regression-ledger entry (nothing failed-old to
lock). Gate (real output): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**,
tsc/eslint clean, **3352 unit / 230 files**, build clean, **157 e2e** (1.5m). Detail:
DECISIONS #267.

## Wave M.2 — mobile tap-target floor (2026-07-22) — #264

Shipped the app-wide 44px tap-target floor. ONE shared primitive — `.tap-target` in
`globals.css` (min-height 44px under `@media (pointer: coarse)`, mirroring the line-60
font-size floor so desktop stays compact). Added to the shadcn Button base
(`button.tsx` — covers triage-inbox's ~18 Buttons and every Button app-wide) and swept
onto every hand-rolled control: accounts-list ×12 (the owner's worst-offender file),
the shared `ConfirmPrompt` (all 6 destructive-confirm surfaces at once),
transaction-list ×10, shared-transaction-list ×3, triage-inbox's 1 plain `<button>`.
Min-height only — never display/justify (the `flex w-full justify-between` option rows
would collapse) and never width (a 44px width would widen rows into M.3's horizontal
overflow). Validated the coarse-pointer scoping empirically before the full gate: the
shadcn Button (demo-sign-in, 32px base) and hand-rolled /accounts add buttons both
measure ≥44px in the Pixel-5 emulator. Gate: `VERIFY_E2E=1 bash scripts/verify.sh` →
VERIFY GREEN, 3352 unit / 230 files, 152 e2e (+2, `tests/e2e/tap-targets.spec.ts`).

Corrections/deferrals recorded (DECISIONS #264): MOBILE_UI_BRIEF over-counted —
`recurring-view.tsx` and `payment-reminders-card.tsx` have ZERO interactive controls
(their tiny elements are display badges), left untouched. Deferred to M.3: the 2 inline
category-chips (transaction-list:374, shared:154) — a 44px floor distorts the dense
register row baseline, so they need the row restructured into flex first. Layout-only:
no money/copy/authz/routing touched, so no Fable critic.

## Agent-Review Follow-up Slice 2 (2026-07-21) — #260: redundancy wave B + UX A5–A6

Closed every remaining non-owner-gated candidate from the same-day agent review
(§2026-07-21 below). No behaviour changes except the two named at the end.

**Extractions (B).** Five LLM modules had copied the same provider selection and
round-trip — key precedence, both request shapes, the 7s abort, text extraction —
differing only in `max_tokens` and the prompt; they now share
`src/server/llm-provider.ts`, which also drops the non-null-asserted Anthropic key
three of the five had drifted into (B2). The three at-rest hash salts (reset token,
invite code, deletion ref) share `src/lib/auth/token-salt.ts` (B3). Six local
month-key slices and five prev/next-month wrappers became `monthKey` +
`addMonthsToMonthKey` in `dates.ts`, and five median copies became
`src/lib/stats.ts` (B4). `household-actions.ts` uses the shared `isDemoUser` (B6).
The two-tap confirm on six surfaces now shares one state machine, `useConfirmArm`,
plus `ConfirmPrompt` for the three plain-button rows (B1). The auth-form field
class is one constant across sign-in / forgot / reset (B5, partial).

**The median rounding, on the record.** The five copies had DRIFTED: three floored
the even-count case, one rounded, one returned the raw average. The shared
`medianOfSorted` returns the EXACT median and each engine states its rounding at
its own call site, so every figure is byte-identical to before (full unit suite,
unchanged counts). Whether those three conventions SHOULD converge is an open
money-math question with a 1-cent blast radius per engine — a redundancy cleanup
was the wrong place to decide it silently.

**Two behaviour changes, both deliberate.** Escape now disarms an armed
destructive control on all six confirm surfaces (before, nothing did — the only
exit was finding Cancel); locked in `transactions.spec.ts`. And `/trust` joins the
nav's Discover group (A6), having been reachable only from a card inside
`/settings`; locked in `mobile-nav.spec.ts`. A5 (380px) shipped as one bordered
card per bank in `PlaidConnections`, and the shared `ConfirmPrompt` carries
`flex-wrap`, which fixes the same narrow-viewport overflow on the account-delete
rows too.

**Declined on evidence, not skipped.**
1. A6 "onboarding time promises drift" does not reproduce. "(30 seconds)" and
   "Make this yours in 30 seconds" both describe naming the card-funding account;
   "takes about a minute" describes connecting a bank; "a few weeks of spending"
   is EmptyCoach describing how much history Coach needs. Four claims about four
   different things.
2. B5's "provider-configured checks scattered" is not harmful duplication:
   `plaid-actions.ts` additionally requires `DATA_ENCRYPTION_KEY` because it
   stores tokens, while `providers/demo.ts` and `providers/plaid.ts` throw with
   their own operator-facing messages. The checks differ on purpose.
3. B5's remaining sub-items (error/success `<p>` styling → shadcn `Alert`,
   `revalidatePath` path-list drift) are cosmetic churn across many action files
   with no drift risk; left alone.

**A real regression found and fixed on the way (not from this slice).** The first
FULL e2e run since #259 caught that its A3 gate — the zero-account first-run empty
on /triage — replaces the whole page including the toolbar, so the Backfill
("Re-run categorizer") button was unreachable for every brand-new signup;
`backfill.spec` had been timing out on it. The spec now provisions one manual
asset past the gate (its review pile is still empty, so the assertion is
unchanged) and asserts `triage-first-run-empty` is absent BEFORE clicking, so a
future gate move fails with its cause instead of a button timeout. Ledger entry
filed. Worth noting for the next slice: #259 ran targeted specs, not the full
suite — a route-level gate is a fence, and fences need the whole suite.

**Open for the owner (from A6, re-filed as a product question).** "Safe to spend"
(the /spending-plan hero and a dashboard card) and "Cash needed" (cards) are two
different numbers shown on the same dashboard, and — verified in
`src/server/spending-plan.ts` — safe-to-spend subtracts `snap.scheduled` bills but
NOT card statement dues, so a card payment that isn't a scheduled flow is absent
from it. Any sentence reconciling the two would be a money claim the code does not
currently support (the #221 false-copy class), and renaming either is a product
decision. Recorded, not guessed at.

Detail: DECISIONS #260.

## Agent-Review Follow-up Slice 1 (2026-07-21) — #259: docs C1–C5 + UX A1–A3

Applied the top candidates from the same-day agent review (§2026-07-21 below), in the
review's own priority order. Docs: README's Plaid row now states the sandbox-verified
truth (ROADMAP #1 DONE 2026-06-17) instead of "not implemented"; the seed-pinned
measurements (3.60% review rate, triage interaction count) are de-hardcoded to
target + the asserting test — they had NO canonical doc home, and the executable
assertions (`tests/unit/categorize.test.ts:170`, `tests/e2e/phase2-triage.spec.ts:374`)
print the live values; .env.example rebranded to Aimplifi; DEPLOY.md env table gained
`AUTH_URL` (verified fail-closed semantics from `password-reset-actions.ts`); CLAUDE.md's
build-queue pointer corrected to root `TASKS.md` (never existed at docs/, per git log).
UX: /cards no-cards empty embeds the real Plaid connect button + manual/CSV button-links
(A1); the settings Bank-connections card is live, not decorative (A2); /triage gains the
zero-account gate + `EmptyTriage` route empty, testid `triage-first-run-empty` — NOT
`triage-empty`, which is TriageInbox's inbox-zero state (A3). **A4 declined:** the
onboarding step numbering is itself a recorded critic decision (step-indicator.tsx
header comment) — reopening it is the owner's call. SimpleFIN connect deliberately not
embedded on /cards or /settings (its UI takes a connected-state prop those surfaces
can't honestly supply; /accounts renders real state). Locks: auth.spec route-empties
sweep + new `connect-affordances.spec.ts` on the guarded `--usd-only` fixture.
Detail: DECISIONS #259.

**Still-open review candidates (owner prioritization):** ~~A5, A6, B1–B6~~ — all
closed by slice 2 (#260, section above), some applied and some declined on
evidence. The ONLY remaining item is D (Plaid merge-into-existing-account), which
**awaits explicit owner approval**: the cutover deletes transaction rows.

## Forgot Password / Reset Flow (2026-07-21) — #257, owner request

Owner locked out of the deployed app. Full reset flow shipped engine-first: pure
`engine/auth/reset.ts` (32-byte tokens, sha256-at-rest, lazy live/used/expired) +
guarded core `server/password-reset.ts` (atomic single-use claim + password rewrite +
sessionEpoch bump in ONE transaction; demo fence; enumeration-neutral; fail-closed
origin — no AUTH_URL off-Vercel means NO email, never a poisonable link) + rate-limited
actions + /forgot-password + /reset-password + the sign-in link. Security critic cycle 1
PASS 0 P0/P1 (2 P2 hardening: timing-oracle floor 750ms, CWE-640 fail-closed origin —
both fixed + critic-re-verified by executed re-repro). Recorded policy: a Google-only
user can reset and gains a password credential (mailbox owns the account). Detail:
DECISIONS #257.

**Recorded residuals (#257):**
1. An email send slower than the 750ms response floor still leaks a timing signal on
   the request action (message/shape are neutral regardless).
2. The per-email limiter counting unknown emails (the anti-counting-oracle property)
   is code-true but unlockable in vitest (action layer requires request headers);
   e2e-coverable later with a seeded known user.
3. Reset emails are plain text (the repo has no HTML template pattern yet).

## Plaid Disconnect & Account Deletion + Sandbox Disclosure (2026-07-21) — #256, owner request

Owner hit both live: Plaid Link rejected their real phone number, and /accounts had
no way to disconnect specific accounts. (1) The phone rejection is Plaid's own
sandbox Link UI — we pass no phone/identity config at all (`linkTokenParams`); with
sandbox keys, Link accepts only Plaid test input. The connect button now shows an
inline sandbox notice (`plaid-sandbox-notice`) whenever the minted token came from a
non-production `PLAID_ENV`, naming test credentials and the production-keys
requirement for real banks. (2) Shipped the per-bank Plaid **Disconnect**
(`disconnectPlaidItem` → provider `removeItem`: best-effort account→item stamping,
revoke at Plaid, delete `PlaidItem`, audit) + per-account **Delete** for Plaid rows
once their owning connection is gone — closing #253's recorded limitation 1. The
refusal/affordance rule is ONE shared predicate (`syncedDeleteBlockReason`, read by
both `getAccountsView` and inside the delete transaction): simplefin = connection
gone; plaid with `Account.plaidItemId` linkage (additive column, stamped on every
sync) = THAT item gone; plaid without linkage = conservative all-items-gone.
Integration-locked 14/14 (`account-delete-server.test.ts` — old 6 + P1–P4 Plaid
contract + predicate matrix); account-deletion e2e 4/4; connection-health e2e 3/3.
Detail: DECISIONS #256.

**Recorded limitations (#256):**
1. Disconnect granularity is per-BANK (Plaid item), not per-account — Plaid revokes
   at item level; a per-account "stop syncing" flag would need schema + sync-filter
   work and was not requested.
2. The sandbox notice names `user_good`/`pass_good` but deliberately not a sandbox
   test PHONE number — Plaid's test values are theirs to document, and pinning one
   we cannot verify risks shipping a wrong "fact" (no-fabrication rule); the notice
   points at Plaid's Sandbox docs.
3. Unstamped legacy rows (never re-synced since `plaidItemId` shipped) use the
   conservative all-items-gone rule; one successful sync or a disconnect back-fills.

## Scenario Coherence Engine (2026-07-21) — #255, AI plan §Later #13 slice 1

Owner-chosen at the #252 fork (preempted twice by #253/#254 interjects, resumed on
"continue"). The pure snapshot-coherence engine `engine/scenario/scenario.ts` — one
canonical state + knob deltas (income/expense percent+absolute, extra debt) applied to
BOTH representations (coach aggregates AND scheduled flows) or not at all with a
disclosed note; net-vs-investible split resolves the ratio-vs-cents hazard; adapters
preserve each downstream engine's conventions verbatim. Decision-comparison half
permanently dropped (plan §4). Engine only — the what-if UI + sensitivity band are
later slices. Hostile critic cycle 1 FAIL (1 P1 / 2 P2) → all fixed in-cycle →
critic re-verified by executed re-repro → PASS 0 P0/P1. Detail: DECISIONS #255,
EDGE_CASES §Scenario Coherence (S1–S16).

**Recorded residuals (#255, both critic-accepted P3):**
1. Adapter overflow guard relies on coach-shaped bases: `toFIInputs`/`scaleRowAmount`
   could throw only at ~$900B-scale inputs no coach derivation can produce.
2. `state.debts`/`state.dials` share references with the base (rows are copied);
   no mutation path exists today — posture inconsistency only.

## Habit Streaks (2026-07-21) — #254, AI plan §Later #17 streaks half

Owner's "continue" at the #253 fork. Board reconciliation (lesson #26 applied): the plan's
lone "build-now" §1.2 Cash Flow Radar was already shipped at #172 (stale authoring-time
verdict); §Later's remainder is blocked (#13 XL behind a snapshot-coherence engine, #15
vision-blocked, #21 superseded by #222/#230) except #17's streaks half, whose split verdict
says the groundable streaks ship build-now. Shipped: two pure engines (NO LLM, NO
persistence, no schema change) + one /coach Habit Streaks card.

- **Card cleared-in-full streak** (`engine/cards/cleared-streak.ts`): resolved = due date
  strictly past + not estimated; cleared = balance ≤ 0 or payments dated ≤ dueDate cover
  it (the interest boundary, stated inline); month qualifies when every resolved statement
  cleared; walk covers FULL months only (critic F2) descending from the latest full signal
  month; `formingThisMonth` covers the only-partial-month-history user. Demo: 17 months
  across 4 cards / 59 statements through May 2026 (seed-locked; June dues unresolved at
  the pinned demo today 2026-06-10).
- **No-subscription-creep streak** (`engine/recurring/creep-streak.ts`): universe =
  detected `isSubscription` series; creep = a price INCREASE at ym(priceChangedAt)
  (decreases never break); full-month walk capped at a disclosed 12; abstains (null) with
  zero subscriptions. Demo: 3 full months, brokeOn Netflix $15.49 → $17.99 in Feb 2026
  (facts inline via an exact-locked rendered string).
- The savings-rate streak (#205) stays on the SavingsRateCard — one surface per fact. The
  drift-loop half of #17 stays gated on the transfer-pair engine (unchanged verdict).

**Hostile critic (fresh-context, 14 adversarial executions + independent hand math): PASS
0 P0/0 P1, 4 P2 — ALL fixed in-cycle** (F1 copy now discloses the statement count so a
gap-heavy span reads honestly; F2 partial-month statements excluded from the walk + forming
state, locked C10–C12; F3 the demo snapshot now currency-filters statements/cardPayments at
the source — the streak engine was the first join-free statements consumer; F4 the creep
seed-lock predicate aligned with the real coach predicate).

**Recorded limitations (#254):**
1. **The creep streak sees only what the detector retains**: a series with two price
   increases (3 plateaus) drops out of detection entirely, and a cancel-then-resubscribe-
   higher pattern reads as a new series, not an increase. The copy scopes the claim to
   "tracked subscriptions" with the steady-amount basis line — honest, but the horizon is
   the detector's, not the user's billing history.
2. **New subscriptions don't break the no-creep streak** (adding a service isn't a price
   increase; series first-seen dates aren't in the detector's output). A future slice could
   widen "creep" to subscription-count growth if the first-seen date is surfaced.
3. **A user who habitually pays a few days late sees a 0 streak** — by design (the by-due-
   date basis is the interest boundary and is stated inline), but it reads strict; the
   month self-heals only if a covering payment lands by the due date, never retroactively.

## Synced-Account Deletion (2026-07-21) — #253, owner request

Owner hit the gap live ("i'm trying to delete the simplefin accounts"): the SimpleFIN
disconnect message told users to "delete any you don't want counted from the lists
above," but the Delete control was manual-only — a #221-class live claim promising a
control that didn't exist. Shipped: SimpleFIN-synced accounts are deletable on
/accounts once the bank is disconnected (two-tap confirm; cascade removes the
account's transactions/statements/snapshots/holdings/scheduled; `paymentAccountId`
cleared in the same transaction when it pointed at the deleted row). Deletion is
REFUSED while the connection is live — sync pass 1 re-creates any feed account it
doesn't find by providerRef, so a connected "delete" would silently resurrect.
Guarded core in authz-free `server/account-delete.ts` (demo fence in the core, by
construction); action wrapper carries audit + revalidates. Integration-locked 6/6
(`account-delete-server.test.ts`), e2e demo-absence lock, accounts sweep 51/51 incl.
WCAG AA (the sweep exercises the NO-affordance state only — e2e cannot mint a
SimpleFIN account, so the two-tap cluster itself is locked by the integration test
plus code-reviewed aria-labels, not by axe). Full detail: DECISIONS #253.

**Hostile critic (1 fresh-context cycle, executed repros: PASS 0 P0/0 P1, 6 P2 —
3 fixed in-cycle):** F2 TOCTOU (conn check now INSIDE the delete transaction — a
reconnect landing mid-gap can no longer delete-then-resurrect); F3 stale recurring
series (core now runs `refreshRecurringForUser` post-delete — with the connection
disconnected no sync remained to ever recompute; pruning locked in test 2+3); F6
cascade breadth (statement + snapshot cascade now asserted, not schema-trusted).
F5's actionable half fixed (per-account aria-labels; STATUS wording above made
honest).

**Recorded limitations & residuals (#253):**
1. ~~**Plaid accounts still have no delete path**~~ — **CLOSED by #256** (the Plaid
   item-disconnect action this limitation named now exists; see §Plaid Disconnect &
   Account Deletion above).
2. **Reconnecting the same bank re-syncs a deleted account** (by design — the feed
   is authoritative while connected; deletion is honest only for disconnected
   history).
3. **(critic F1, P2)** Ghost analytics rows survive by design: `CategoryPrediction`
   / `Correction` keep dangling `transactionId` strings (matches the Plaid
   removed-path precedent) and an account-scoped `CategorizationRule` can outlive
   its account. No money surface reads them; `getReturnMoment`'s auto-filed count
   can overcount after a delete (pre-existing class).
4. **(critic F4, P2)** A withheld non-USD SimpleFIN account never renders on
   /accounts (currency guard), so it is undeletable through the UI even when
   disconnected — needs its own disclosure-surface decision.
5. **(critic F2 residue)** A sync already in flight at disconnect time can still
   re-create the row post-delete (self-healing: the affordance re-renders and a
   second delete sticks); serializing refreshes per user is the #251-recorded
   infrastructure fix.

## Money Signature (2026-07-21) — #252, AI plan §Later #11 shipped per its rework verdict

Owner's "continue" at the #251 fork. Board reconciliation (lesson #26 applied): Threaded Ask
#21 was superseded by #222/#230; double-bill stays timestamp-blocked; #17's drift loop needs
the net-new transfer-pair engine; #13 Scenario Studio is XL behind a snapshot-coherence
engine; the PROGRESS #173–176 backfill flagged "outstanding" in old entries was already done
(PROGRESS:3617–3660). #11 was the last M-size groundable item, and its "needs-rework" verdict
IS the resolved design decision — hysteresis before any axis label change, stable axes
decoupled from responsive weather, habits not personality.

- **Engine.** `engine/fi/signature.ts` (pure, NO LLM, NO persistence): hysteresis is a
  retrospective walk (`resolveConfirmedLabel`) over the monthly series — dead-zone bands
  plus a 3-consecutive-month persistence gate on flips (no-signal months reset the run;
  first banded signal initializes immediately), so labels are a deterministic function of
  history with no stored state to leak, race, or migrate. Axis 1 saving habit: share of
  trailing ≤12 eligible months saved (steady ≥ 75%, variable ≤ 50%, ≥6 eligible else
  forming). Axis 2 spending steadiness: MAD/median spread over exactly the trailing 6 full
  months' expenses (steady ≤ 10%, variable ≥ 25%; radar integer median convention).
  Commitment-load was REJECTED as an axis: it would apply today's recurring-series
  membership backward onto historical months. Gap months materialize as $0/null-rate
  (creep's convention); the partial current month is dropped inside the engine. Weather
  (responsive by design, "this month"): strained (runway < 1) / tight (runway < 3 or a
  negative latest month) / bright (personal-best via computeSavingsStreak, reused) / calm.
  Hand-verified EDGE_CASES §Money Signature (S1–S5, H1–H5, D1–D6, W1–W10).
- **Copy.** COACH_COPY templates only (the guardrail scan covers every variant): facts-first
  habit lines, the persistence rule disclosed inline, weather cushion basis inline
  ("cash ÷ your 6-month average expenses"), and an identity-framing lexicon BAN locked by
  money-signature-copy.test.ts (#250 precedent) — "you are a", personality/archetype nouns,
  saver/spender-as-noun all banned; forming and mixed (dead-zone) states get their own
  honest lines rather than a mislabel.
- **UI.** One server-component card on /coach (weather + two habit lines + basis);
  getCoachData grows `signature`, computed from ALL flows so the habit window sees full
  history, not the 12-month display slice. No writes, so no demo fence needed.
- **Seed.** Untouched — zero ripple. Seed lock pins steady/steady/calm with hand math
  (12/12 months saved; steadiness window med 390166¢, mad 11550¢ → spread 296 bps = 3.0%)
  plus an independent no-engine-code re-aggregation cross-check inside the test.
- **Hostile critic (1 fresh-context Fable cycle, empirical mandate: FAIL 2 P1 / 4 P2 →
  ALL fixed → critic re-verified each fix by executed re-repro → PASS 0 P0/P1).** The
  engine mechanics survived both rounds untouched (prefix-stable hysteresis, integer math,
  weather table, purity all held); every finding was a copy/branch honesty defect. F1 (P1):
  the card rendered the hysteresis-lagged label as a present-tense claim contradicted by its
  own inline facts ("steady habit … has held" beside 5/12 saved) — fixed with engine
  `latestContrary` (latest banded raw opposite the confirmed label; dead-zone never flags)
  driving lag-honest "had been … recent months look different" copy variants, both axes,
  both directions. F2 (P1): "your last N full months" was false across no-income months the
  eligible window skips — every month-count line now reads "full months with income". P2
  fixes: null-spread with abundant history now says "no recorded spending", never "needs 6
  months of history" (`hasFullWindow`); trailing gap months now materialize to ym(today)−1
  (creep's anchor) so the weather never cites a stale month as "this month"; the seed-lock
  cross-check's naive negative-sum is now licensed by an explicit no-refund-rows
  precondition; "1 months" pluralization. 2 REGRESSION_LEDGER rows; locks mirror the
  critic's executed repros.
- **Recorded residual (#252 critic, P2-grade, by design):** during a trailing no-income gap
  the saving axis re-emits its frozen window's banded signal each empty month, so a contrary
  persistence run can complete across months that carry no new income evidence (steadiness
  is structurally protected — its zero-median months emit null raws and reset runs). The
  rendered copy stays true (counts are qualified "full months with income") and the
  income-pause radar owns lapsed-income news; a future slice could require an eligible month
  to advance a contrary run.

## Income-Pause Radar (2026-07-21) — #251, AI plan §Later #20's one groundable signature

Owner's "continue" at the #250 fork. Picked per STATUS #248's own menu: the last
unblocked groundable §Later sub-slice (streaks core #205 and the outlier radar #249
both shipped; its #249-recorded deferral — "FI-mutation plumbing + a seeded income
pause that ripples the demo narrative" — was scope, not a blocker). §20's verdict
implemented in full: the lapsed-`isIncome` signature as its own narrow engine, the
`projectedIncome = 0` mutation confirmation-gated, the other signatures (new
dependent, relocation) still hard-gated on no-ground-truth.

- **Engine.** `engine/income/pause.ts` (pure, NO LLM): lapse = `nextDate(lastSeenAt,
  cadence)` vs today — deliberately NOT `nextExpectedAt`, which detect.ts
  forward-steps past missed occurrences (it structurally hides lapses). Precision-
  first gates (the #231 failure-direction lesson): income series, cadence W/BW/M
  (ANNUAL excluded), occurrences ≥4, ≥$100 typical, aggregates excluded (shared
  case-insensitive guard), grace {W:5, BW:7, M:10} days late. TWO predicates share
  the one lapse computation: `lapsedIncomeSeries` (no staleness cap — drives the
  projection exclusion) and `detectIncomePauses` (+60-day news cap — drives the
  nudge); `incomePausesForFeed` composes confirmations (a CONFIRMED row ignores the
  news cap: the feed discloses the exclusion for as long as it is in force).
  Hand-verified EDGE_CASES §Income-Pause Radar (P1–P12).
- **Nudge.** New kind `income_pause`, ACTION tier, never pushed, never CRITICAL (a
  late paycheck may be a payroll hiccup). Dismissal keys to the missed occurrence
  (`income_pause:<merchant>:<missedSince>` — a new miss is a new fact). Verbatim
  context (merchant, occurrences basis, cadence) + `runwayMonths` passthrough
  (non-finite → null, ∞ unrepresentable). Copy: "the expected deposit that hasn't
  arrived" (never "at stake"), cadence basis inline ("based on N deposits"), runway
  "about" + formula inline; no-shame (a planned pause is the offered outcome).
- **Mutation (confirmation-gated).** `IncomePauseConfirmation` (unique
  user+merchant, demo-fenced like nudge dismissal). Confirm → the series is excluded
  from `toScheduledTransactions` projections and the blueprint's paycheck anchor
  WHILE still lapsed (lapse recomputed each refresh — the row is consent, not
  evidence); the feed row flips to quiet HANDLED state carrying the Undo. A resumed
  deposit auto-restores projections and deletes the stale confirmation (future
  pauses re-ask). Integration-locked (`income-pause-server.test.ts`, 5/5 against the
  real refreshRecurringForUser).
- **Seed (demo-first).** Engineered pause: `STRIPE PAYOUT ETSY SHOP` ("Stripe
  Payout", side-income) +$380×4 monthly on acct-savings, silent since asOf−2mo —
  deliberately NOT the payment account, so cash-needed/§Seed-headline arithmetic is
  untouched by construction. Exactly-one seed lock. Recorded ripple: exactly 3
  insights.test.ts income locks re-hand-verified (two-payday months 2×245000+38000
  = 528000). Demo sees the ACTION nudge but no confirm control (fence).
- **Latent a11y bug fixed en route.** /recurring's "No longer charging" section
  (`opacity-70` over muted-foreground → 4.0:1 < AA 4.5:1) had never rendered on the
  demo until this slice's inactive row; fixed in recurring-view (muted title only),
  caught by recurring.spec's axe gate.
- **Gate (real output 2026-07-21, pre-critic):** unit suite green post-slice
  (income-pause 17, income-pause-server 5, nudge-select/copy extended, insights
  re-verified); `today-feed.spec` 8/8 (demo pinned copy + axe AA + throwaway
  confirm→HANDLED→undo loop), `recurring/phase3-coach/ask/return-moment/trends`
  green. `bash scripts/verify.sh` → ✅ VERIFY GREEN.
- **Hostile critic (1 fresh-context Fable cycle, empirical mandate: FAIL 2 P1 /
  6 P2 → ALL fixed → re-verified).** The engine math survived (critic
  independently recomputed every EDGE_CASES P-case, reproduced the seed lock, and
  swept 45 asOf dates: 0 organic false positives). **F1 (P1, executed repro):**
  "resumption" was inferred from ¬lapsed, so a routine provider row-removal
  (occurrences 4→3, below the ALARM floor) deleted the user's consent row and
  re-projected phantom income with no feed row — fixed with
  `confirmedPauseState` (paused/resumed/inert): only a DATE-FRESH deposit
  retires consent, gates govern the alarm only, and the exclusion + the HANDLED
  disclosure ride the same predicate; regression-locked (P14a–d + server 2b) and
  ledgered. **F2 (P1):** the confirmed row's "Why am I seeing this?" said
  "Autopay covers this" — per-kind `tierRule` override in the copy module,
  unit-locked, ledgered. P2 fixes: F3 dev.db lacked the new table (db:push run);
  F4 coach detected recurring over ALL account types while the exclusion reads
  spending-only — universes aligned; F5 dismiss-then-confirm hid the undo home —
  confirmed rows key to their own `income_pause_confirmed:` namespace; F6
  negative runway rendered "covers about −0.5 months" — non-positive figures
  nulled; F7 month-end clamp shrank the MONTHLY grace to 7 for 31st paydays —
  `missedSinceOf` expects the END of the next month for month-end series
  (precision-safe direction, P13); F8 undo now enforces the same input cap as
  confirm.
- **Recorded residual (#251 critic, correct-direction, not fixed here):** a
  concurrent provider sync's `refreshRecurringForUser` can race the confirm
  action's refresh (last-writer-wins between two full-replace transactions), so
  a just-confirmed pause can transiently re-project until the next refresh;
  self-healing, conservative-adjacent (a later refresh re-applies the
  exclusion), and bounded by the sync cadence. Durable fix: serialize refreshes
  per user (advisory lock or queued job) — an infrastructure class, out of this
  slice's scope.

## Merchant Pattern Lens (2026-07-21) — #250, AI plan §Later #19

Owner's "continue" at the #249 fork. Shipped per the plan's own reshape verdict —
deterministic profile + templated narration, generative-LLM framing dropped. Chosen as
the last unblocked §Later item (§3.1–3.4 shipped; double-bill, streaks drift, income-pause,
and Scenario Studio all remain on their recorded blockers; Threaded Ask superseded by
#222/#230).

- **Engine.** `engine/merchant/profile.ts` (pure, NO LLM): per-merchant profile over
  qualifying charges (the exact anomaly-engine inclusion rule) — count, total, first/last
  seen, median typical (shared §Unusual Charge Radar convention; a seed lock asserts the
  lens and the radar report the SAME typical/count for demo Blue Bottle: 1156¢ / 19), and
  a 3-full-months recent-vs-prior trend (partial month never averaged; windows render only
  when the relationship spans them; hand-verified EDGE_CASES §Merchant Pattern Lens).
  Abstentions: aggregate pseudo-merchants → no lens; <3 charges → facts only.
- **Narration.** Pure template `lens-copy.ts` — descriptive never advisory, "about" on
  divided figures, basis disclosed inline, guardrail test bans time-of-day/day-of-week
  pattern vocabulary (date-only data cannot ground them — the §19 verdict's flagship hole).
  Cadence line only from an ACTIVE non-IRREGULAR detectRecurring series.
- **Surface.** Register merchant names link to a new exact-match `?merchant=` filter
  (never substring); lens card renders above the filtered rows; viewer-only (household
  shared list untouched — "Your pattern" is always the true subject). No nav icon, no
  schema change, read-only (no demo fence needed).
- **Gate (real output 2026-07-21, pre-critic):** `bash scripts/verify.sh` → ✅ VERIFY
  GREEN — 3059 unit / 216 files, tsc+eslint+build clean; merchant-lens.spec +
  transactions.spec e2e 22/22 green (pinned demo copy incl. axe WCAG-AA on the lens page).
- **Hostile critic (1 fresh-context Fable cycle: FAIL 2 P1 / 3 P2 → all fixed →
  re-verified).** The engine math survived (critic independently recomputed every
  EDGE_CASES L-case, boundary dates, unicode/metacharacter names, locale casing, float
  discipline — none landed). Both P1s were in the COMPOSED cadence line: F1 rendered the
  SIGNED recurring amount ("typically −$1,800.00" contradicting the typical line on the
  same card — masked by a positive-only unit fixture); F2 fed PENDING rows into
  detectRecurring while /recurring is POSTED-only (a pending charge moved "typically" and
  manufactured a phantom price change). Fixed: copy renders magnitude (sign-independent,
  locked with the production negative fixture), server filters POSTED + skips income
  series, and a new integration lock (`merchant-lens-server.test.ts`) drives the real
  getTransactions with 6 posted + 1 larger pending charge. P2 fixes: aggregate guard now
  case-insensitive for ALL callers (rules/radar/lens — F3); always-on card scope note
  ("covers every posted charge … not only the rows listed below" — F5, the card renders
  above filtered/paginated lists by design); the "can never disagree" wording scoped (F4).
- **Recorded residual (#250 critic F4, correct-direction, not fixed here):** the lens
  groups by the row's STORED merchant canonical (what the register shows) while the
  radar re-normalizes rawDescriptor — identical universes today, but a stored canonical
  minted before a KNOWN_MERCHANTS edit is never re-normalized (`merchant.upsert` with
  empty update), so the two can drift apart after a table edit until a re-sync remints
  rows. Durable fix: re-normalize stored merchant canonicals on KNOWN_MERCHANTS
  migrations (a data-migration class, out of this slice's scope).

Owner's "continue" at the #248 owner-gated fork. Pick per the plan's own reshape verdict:
"ship the per-merchant outlier detector after seeding 1-2 engineered anomalies; defer the
duplicate detector until timestamps are captured." (Income-pause/runway deferred: FI-mutation
plumbing + a seeded income pause that ripples the whole demo narrative. Reconciliation note per
the plan-verdicts lesson: #248's menu line listed "streaks" as buildable, but the groundable
streaks core shipped at #205 — only the drift loop remains, still transfer-pair-blocked.)

- **Engine.** `engine/anomaly/detect.ts` (pure, NO LLM anywhere): per-merchant median+MAD over
  the user's own charge history — POSTED/non-transfer/non-split outflows grouped by
  `normalizeMerchant().canonical`, aggregate pseudo-merchants (ATM/checks/Zelle) excluded.
  Integer-cent conventions documented + hand-verified (EDGE_CASES §Unusual Charge Radar).
  Flag rule tuned for precision (the #231 failure-direction lesson: a false positive shouts,
  a false negative stays quiet): baseline ≥6 charges, flag window 45 days, deviation
  (above-median only) strictly > 4·MAD + $40 floor (so MAD=0 subscriptions need a real spike —
  a $2.50 Netflix bump never flags), ≤1/merchant, ≤3 overall, deterministic total order.
- **Seed (demo-first).** Exactly ONE engineered anomaly — the plan's marketed "$214 coffee":
  −$214.36 `SQ *BLUE BOTTLE 0042 OAK` on Sapphire, asOf−8d (2026-06-02). Current PARTIAL month
  (coach full-month aggregates untouched), fixed amount (RNG stream byte-identical). Seed lock
  asserts it is the demo's only flag. Three seed-pinned tests re-verified by hand (trends pace
  73929+21436=95365 / round→286095; largest lists; Ask's biggest-purchase headline now cites
  the same charge the radar flags — Ask and radar agree by construction).
- **Feed.** New fixed ProposalKind `unusual_charge`, ACTION tier (decision, no deadline; never
  competes with CRITICAL; dismissable), dismissal fact-keyed to the transaction
  (`unusual_charge:<txnId>`), `nudge:unusual_charge` in ENGAGEMENT_SUBJECT_KEYS, three verbatim
  display-context fields on Proposal (merchant/typicalCents/typicalCount, null elsewhere), copy
  disclosing the basis inline ("larger than the typical $7.50 there (median of N charges)"),
  no-shame dismiss-if-expected framing. Deliberately NOT pushed (notify/select untouched).
- **Deferred (unchanged blockers):** double-bill detection (date-only `Transaction.date`);
  income-pause/runway radar; the streaks drift loop (transfer-pair engine).
- **Gate (real output 2026-07-20/21):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — 3035 unit /
  214 files, tsc+eslint+build clean; today-feed.spec e2e 6/6 green against the fresh build
  (incl. the new #249 case: $214.36 at ACTION tier with median basis + axe WCAG-AA).
  New locks: `anomaly-detect.test.ts` (20 incl. the exactly-one seed lock), nudge-select
  unusual_charge block, nudge-feed-copy cases, engagement vocab.
- **Hostile critic (1 fresh-context Fable cycle: FAIL 1 P1 / 5 P2 → fixed → re-verified).**
  The engine survived every math/precision/determinism attack (critic independently
  recomputed the EDGE_CASES hand math and swept 42 seed asOf dates: 0 organic false
  positives). P1-1: the seed change left `ask.spec.ts` stale-red (2 tests still pinned
  Costco $158.44 as June's biggest purchase; verify.sh skips Playwright, and only
  today-feed.spec was run — the exact fencing-a-write-path lesson class again) — fixed
  to the new seed truth and re-run green. P2 fixes: window-boundary docstring corrected
  (age 0–44); `whyInputs` now says "a $214.36 charge", never "at stake", for an
  already-spent charge; SEED_SPEC documents the default-asOf dependency of the anomaly's
  organic baseline (critic counterexample: asOf 2026-06-20 → 5 samples → no flag).
- **Recorded residuals (#249 critic P2-3/P2-5, correct-direction, not fixed here):**
  (a) the dismissal fact-key uses coach.ts's txn id with an array-index FALLBACK for
  id-less provider rows — both live providers return Prisma ids so the fallback is
  unreachable today, but adding `id` to the provider transaction contract is the durable
  fix before this persisted key class hardens; (b) at `?scope=household` the feed mixes
  household reminders with viewer-only unusualCharges (same asymmetry opportunities
  already have) — a partner's anomaly is quietly absent, never a false claim.

## AI Trust Center per-touchpoint track record (2026-07-20) — #248, AI plan §3.2 completion

Owner's "continue" at the #247 owner-gated fork. **A code-vs-plan reconciliation is the headline
finding: the AI differentiation plan §3.1–§3.4 are ALL shipped** (§3.1 Why-This-Category #238/#239,
§3.2 Trust Center #242, §3.3 Doc Extractor #247, §3.4 Subscription Radar #246); §3.5 Receipt
Splitter stays vision-blocked (no OCR pipeline exists). The plan doc's per-section adversarial
verdicts still read "build-later"/"needs-rework" and were never updated post-ship — that stale text
misread §3.1/§3.2 as unbuilt during scoping. The plan doc is now un-staled (each shipped section
tagged), and STATUS remains the source of truth for what's shipped.

The one genuine remaining §3.2 gap: the "Where AI runs" table listed the six touchpoints with
static May/Never contract copy but **no measured counts**. This slice adds a per-touchpoint,
all-time track record — how often each surface was asked about your data and how often its guardrail
discarded the reply (§3.2's own trust signal) — 100% count-of-persisted-rows, no model, demo-safe.

- **Engine.** `engine/ai-audit/describe.ts`: new pure `tallyTouchpoints(AiActionCount[]) →
  AiTouchpointStats[]` (one entry per touchpoint incl. zeros, in `AI_TOUCHPOINTS` order; unparseable,
  negative, and fractional counts dropped — never guessed into a count); new `describeTouchpointStats`
  copy; new shared `parseAiAction` action-grammar helper that `parseAiAuditRow` was refactored onto
  (anti-drift: ledger and tally accept the exact same actions).
- **Server.** `getAiTouchpointCounts` (prisma `groupBy` by action, `userId`-scoped) — all-time,
  distinct from `getAiTrail`'s most-recent-50 window; demo persists no trail so it returns [].
- **UI.** `/trust` renders the measured count line under each touchpoint's May/Never.
- **Hostile critic (1 fresh-context Fable cycle: FAIL → all fixed → PASS 0 P0/P1).** P1-1: the first
  copy ("Ran N times") folded provider-`unavailable` (no-reply) attempts into "runs", collapsing the
  three-way split the rest of the page keeps — a 40-call outage read "Ran 40 times · 0 discarded".
  Fixed exactly as prescribed: "Asked N times · M discarded by the guardrail · K got no reply" (the
  no-reply clause only when unavailable>0, so replied = total − rejected − noReply stays honest).
  P2s: stale-red trust.spec touchpoint count (asserted 5 while #247 made 6 — verify.sh skips
  Playwright so it went unseen) now derived from `AI_TOUCHPOINTS.length`; over-broad "identical
  grammar" claim scoped to the action axis; populated-state copy now exercised end-to-end through the
  real-DB recorder test.
- **Gate (real output 2026-07-20):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — 3008 unit / 213
  files, tsc+eslint+build clean (rebuilt after the P1 copy fix); trust.spec e2e 1/1 green against the
  fresh build (6 touchpoints, per-touchpoint count line, axe WCAG-AA). New locks in
  `ai-audit-describe.test.ts` (tally totality + copy) and `ai-audit-recorder.test.ts` (groupBy read +
  populated-line end-to-end). EDGE_CASES §AI Trust Center audit trail extended.
- **Next (owner-gated): the AI plan is complete bar §3.5 (vision-blocked). Remaining menu is the
  plan's "Later"/Wave-4 items (each carries a named blocker; groundable build-now sub-slices exist:
  streaks, income-pause/runway radar, per-merchant outlier detector — these are new money/safety
  engines the model routing sends to Fable), or non-AI-plan competitive-gap work.**

## Doc Extractor v1 — text-only card-statement extractor (2026-07-20) — #247, AI plan §3.3 reshaped

Owner said "continue" at the #246 owner-gated fork; §3.3-reshaped was the determined pick
(§3.5 needs a vision pipeline that doesn't exist; every "Later" item carries a named
blocker; the reshape — text-only card statement, no schema change, worst PII avoided — is
written into the plan's own adversarial verdict). The user pastes statement text into the
existing manual-card-statement form; the LLM is a **span-pointer with no value channel**
({field, sourceSpan, confidence} over a closed 5-field set); code verifies each span exists
verbatim in the scrubbed text the model saw, derives every value from the span
deterministically, and prefills the form — the only write path remains human-confirmed
`setManualCardStatement` through the byte-identical `parseManualStatement` gate, so
"AI-originated dollar figures: 0" holds **by construction**.

- **Engine.** `engine/doc-extract/statement.ts` (pure): validator (closed field set,
  label-required spans, confidence capped 9900 bps, duplicate claims dropped entirely),
  `scrubAccountNumbers` (digit runs ≥9, up-to-2 whitespace/dash separators — masked before
  any egress), grounding + exactly-one-candidate derivation (cross-tier money ambiguity,
  recognized negative forms, malformed money, 2-digit years, non-calendar dates, multi-date
  spans all → abstain; cycleEnd-only range rule). EDGE_CASES §Doc Extractor v1
  (hand-verified, abstention tests the majority).
- **Server.** `llm-statement-extract.ts` (7s abort, null-on-failure, outcome sink);
  `statementExtractFor` fencing constructor — the ONE way to the LLM (demo → null no-op,
  zero egress, executed lock); new `extract` Trust Center touchpoint (count-only meta);
  `extractStatementDraft` read-only action, 16KB cap, `statement-extract:{userId}` 10/min
  durable rate limit before any egress.
- **UI.** Paste panel in the statement form: disclosure BEFORE egress (best-effort scrub
  named), per-field quoted-span + confidence receipts, "Enter by hand" gap list, inputs +
  Save disabled while extracting, `role="status"`/`role="alert"` states.
- **Hostile critic (2 fresh-context Fable cycles: FAIL → all 8 fixed → PASS 0 P0/P1).**
  Cycle-1 P1s: privacy policy falsified by the new egress (policy + ask-view re-scoped,
  3 substring locks added); scrubber weaker than its UI promise (double-space/newline PANs
  leaked — regex widened, copy softened to name the residual); credit-sign loss on
  `($45.00)`/`$45.00 CR`/unicode-minus (all recognized forms now abstain); no rate limit.
  Cycle-2 verified every fix genuinely fixed by executing the shipped code; its 2 new P2s
  (trailing-minus/CR-prefix sign forms; policy best-effort qualifier) fixed same session.
- **Gate (real output 2026-07-20):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — 2999 unit
  / 213 files, tsc+eslint+build clean (final re-verify after the P2 fixes below); e2e
  manual-card-statement.spec 2/2 green incl. the new #247 test (disclosure, keyless
  honest-failure, manual path survives) against a fresh production build. New locks: `doc-extract-statement.test.ts` (48),
  `statement-extract-server.test.ts` (14), 3 privacy-policy substring locks.
- **Recorded residuals (deliberate):** scrub is best-effort and disclosed as such (3+
  space separators pass; the disclosure tells users to paste only the summary section);
  textual sign prefixes ("Credit balance: $45.00") not recognized — the quoted span
  carries the words for the confirming human; live prefill happy-path is locked in unit
  (mocked provider) not e2e (e2e is hermetic/keyless by design). Deferred per plan
  verdict: paystub, 401k, vision/photos, fee watchdog. DECISIONS #247.
- **Next (owner-gated): §3.5 remains vision-blocked; the plan's "Later" section, or
  non-AI-plan work.**

## Subscription Radar — upcoming renewals (2026-07-20) — #246, AI plan §3.4 deterministic slice

Owner picked §3.4. The explorer map showed the radar ~70% shipped (two-plateau price-hike
detection + 5 surfaces, fitness-scoped possiblyUnused, per-row next-date), so the slice built
exactly the missing differentiator: a **forward renewal schedule** — every ACTIVE expense
series expanded from `nextExpectedAt` by cadence over a 90-day inclusive window, predicted
amount = the magnitude of the last REAL charge copied verbatim (post-increase = the NEW
price), nested 7/30/90-day horizon buckets, surfaced as a "Coming up" section on /recurring
(tiles + next-30-days list + inline "estimates, not bills" disclosure). 100% deterministic —
no LLM, no persistence, read-only (no demo fence needed).

- **Engine.** `engine/recurring/renewals.ts` (`upcomingRenewals`, `renewalsWithin`) reuses
  upstream truth by construction: `active` from `summarizeRecurring`, cadence stepping is
  detect.ts's own `nextDate` (export-only change), the increase badge carries
  `increasedFromCents` via `priceChangeBadge`. ANNUAL appears only when genuinely detected
  (≥3 occurrences ⇒ ~3yr history — the plan's ≥2yr caveat holds by construction). Income,
  lapsed, and IRREGULAR series never emit. EDGE_CASES §Upcoming renewals (hand-verified).
- **Hostile critic (1 fresh-context Fable cycle): PASS — 0 P0/P1, 4 P2, 3 fixed same
  session:** P2-1 "recently went up" was a time claim the detector doesn't record → now
  "↑ was $15.49" (the row badge's honest form, magnitude carried through the engine);
  P2-2 the engine invented a monthly schedule for IRREGULAR input → explicit skip, locked;
  P2-3 tile-count vs list-rows were parallel predicates → one shared `renewalsWithin`.
  P2-4 (a redundant not-assertion in the e2e) resolved by the P2-1 rewrite. Critic verified
  cross-surface date honesty (row "next ~" vs schedule: zero mismatches on seed), clamp-drift
  chain, leap-Feb stepping, 380px overflow 0px, axe WCAG AA clean, dashboard/assistant
  consumers byte-identical (29/29 assistant goldens re-run).
- **Gate (real output 2026-07-20):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — 2934 unit /
  211 files, tsc+eslint+build clean; recurring.spec e2e 3/3 (incl. the new #246 test:
  horizon tiles, Netflix predicted at $17.99 with "↑ was $15.49", disclosure, axe) against a
  fresh production build. New locks: `tests/unit/recurring-renewals.test.ts` (21 tests,
  hand-verified boundaries + seed-grounded block).
- **Recorded residuals (not built, deliberate):** live-detected series still never reach
  /calendar for demo/SimpleFIN-less users (pre-existing; the schedule now covers the JTBD on
  /recurring); renewal-based nudge kinds deferred (alert surface = its own Fable-gated
  slice); negotiation drafter deferred (free-form LLM prose over money facts — unsafe per
  plan verdict + the #240 finding). DECISIONS #246.
- **Next (owner-gated): §3.3 Doc Extractor v1 / §3.5 Receipt Splitter, or the plan's
  "Later" section.**

## Demo manual-entry fence (2026-07-16) — #243 owner follow-up, typed/uploaded leg closed

The owner confirmed the scope (demo is read-only for visitor-BROUGHT data; playing with the
seeded fake data stays open), closing the open follow-up below. The four manual-entry actions —
`addManualAccount`, `createManualTransaction`, `importTransactionsCsv`, `addHolding` — now
return their typed failure shape with `DEMO_ENTRY_BLOCKED` for `user-demo` immediately after
`requireUserId()`, before any DB lookup/write or provider call. With `addManualAccount` fenced,
the manual update/delete paths are unreachable for demo by construction (the seed creates no
`provider='manual'` accounts and `ownedManualAccount` requires one). `removeHolding` and the
delete paths stay open (remove data, never ingest — remediation, like `disconnectSimplefin`).

- **Hostile critic (2 fresh-context Fable cycles: FAIL → fixes → PASS 0 P0/P1).** Cycle 2
  re-verified every cycle-1 finding genuinely fixed (e2e migrations preserve each spec's
  original regression intent — #170 is now *stronger*; the destroy fence is correctly ordered
  and caught-by-executed-test; docs state exactly the invariant that holds; the fence test's
  zero-row deltas are load-bearing against the real seed). Cycle-2 P2-1 (delete-side
  `accounts-empty` assertion) fixed and re-run green; P2-2 (DEMO_DESTROY_BLOCKED string
  unreachable in prod — UI hides the forms, direct POST sees Next's redacted error) accepted
  as documented. Cycle 1
  verified the four fences themselves clean (correct order, key-independent, inline error
  rendering; the by-construction closure of update/delete manual paths confirmed — bonus: the
  same construction closes `setManualCardStatement` too) but returned FAIL: (P1-1) five
  transactions.spec e2e tests drove the fenced actions as demo and broke — migrated to
  throwaway signup users (the manual-card-statement.spec isolation pattern), plus a new
  demo-refusal e2e; (P1-2) the first draft of this section claimed "remaining demo writes are
  edits to seeded rows", which `createGoal` (free-text name + real target figures) and
  `createCustomCategory`/`rename` (visitor-typed names in every later visitor's pickers)
  falsify — see the accepted-residual bullet below; (P1-3, pre-existing) `deleteMyData` let one
  visitor irreversibly wipe the shared demo for everyone (and `revokeOtherSessions` sign every
  concurrent visitor out) — owner chose to fence: both actions now throw `DEMO_DESTROY_BLOCKED`
  for demo, the settings UI renders honest shared-account notes instead of the controls, and
  `demo-destroy-fence.test.ts` + a reworked `account-deletion.spec.ts` lock it.
- **Owner-accepted residual (2026-07-16, explicit):** demo visitors can still bring their own
  text/figures via `createGoal` (goal name + target/monthly cents), custom category
  names, money dials (including a real hourly wage rendered by the life-energy view), budget
  amounts, and Ask questions (persisted scrubbed, never rendered/mined). Accepted to keep the
  demo explorable — trying goals/categories IS the demo. Recorded here so no future claim
  reads "the demo row can hold no visitor input"; the honest claim is: **bank connections,
  manual/CSV/holding entry, and account destruction are fenced; playful feature input is not.**
- **Gate (real output 2026-07-16):** `bash scripts/verify.sh` → ✅ VERIFY GREEN (unit counts in
  the PASS/FAIL contract); e2e transactions.spec + account-deletion.spec pass with the
  migrated throwaway-user specs + the two new fence specs. New locks:
  `manual-entry-demo-fence.test.ts` (all four actions refuse demo with zero DB row-count delta
  — real seed ids, so the deltas are load-bearing — and zero fetch on a KEYED deployment; real
  user passes), `demo-destroy-fence.test.ts`. EDGE_CASES §Demo manual-entry fence;
  REGRESSION_LEDGER 2 rows; DECISIONS #244/#245.
- **Next (owner-gated): §3.3 Doc Extractor v1 / §3.4 Subscription Radar / §3.5 Receipt
  Splitter, or the plan's "Later" section.**

## Demo bank-connect fence (2026-07-16) — #242 owner follow-up, privacy hole closed

The shared demo account (`user-demo`) could link a real bank (Plaid/SimpleFIN) into the one row
every anonymous visitor logs into — one visitor's real financial data would then be visible to the
next. Now fenced at every ingest entrypoint. Same shared-account leak class as household seat (#210)
and learned vocabulary (#226); lesson `shared-demo-account-must-not-learn` extended.

- **The fence.** `createPlaidLinkToken`, `linkPlaidAccount`, `connectSimplefin`, `syncSimplefinNow`
  return `{ok:false, DEMO_CONNECT_BLOCKED}` for the demo user immediately after `requireUserId()` —
  BEFORE any provider call. The two CONNECT actions are load-bearing: no connection row can be
  created for demo, so cron/webhook/sync have nothing to act on by construction. `isDemoUser` +
  `DEMO_CONNECT_BLOCKED` live in the auth-free `@/lib/demo-user` (the #220-safe home).
- **Residual/remediation paths.** A connection created BEFORE this fix is the bug's residual: the
  cron sweep now excludes demo at the query (no sync, no `sync.cron` audit row) and the Plaid webhook
  skips a demo-owned item. `disconnectSimplefin` is intentionally left open (removes data, never
  ingests) so a visitor can clean up any pre-fence breach.
- **Gate (real output 2026-07-16):** `bash scripts/verify.sh` → **✅ VERIFY GREEN — 2904 unit /
  208 files**, tsc/eslint/next build clean. New locks: `connect-demo-fence.test.ts` (4 ingest actions
  refuse demo, zero provider calls, keyed deployment; real user passes) + `cron-sync-demo-skip.test.ts`.
  EDGE_CASES §Demo bank-connect fence; REGRESSION_LEDGER 2 rows; DECISIONS #243.
- **Hostile critic (1 fresh-context Fable cycle):** the bank-connect fence itself is CLEAN — zero
  P0/P1 bypass (all four ingest actions, cron exclusion, webhook skip verified complete; demo id can't
  differ by env; no ordering bug; no fifth automated ingest path). The one P1 was a **docs-accuracy**
  gap in the first commit — the claim was worded too broadly and the residual list named only "CSV
  import" when four typed/uploaded paths are open — **corrected in the follow-up docs commit** (narrowed
  claim + full four-path residual above). Under the narrowed reading the critic reports zero P0/P1.
- **Open follow-up (owner-gated) — RESOLVED 2026-07-16 (Demo manual-entry fence section above,
  DECISIONS #244) — the TYPED/UPLOADED leg of the same rule, flagged by the #243
  hostile critic.** This slice fenced only the *connected* leg. Four manual-entry actions still let a
  demo visitor write their REAL figures into the shared `user-demo` row, where the next visitor sees
  them — the identical leak class, unfenced: `addManualAccount` (real balance/net-worth),
  `createManualTransaction` (real amount + raw descriptor + date), `importTransactionsCsv` (bulk real
  statement rows), `addHolding` (real ticker/quantity/cost basis; the demo seeds a brokerage account,
  so it's reachable). The critic found the bank-connect fence itself CLEAN (zero P0/P1 bypass) but
  correctly falsified any BROAD "no real data can land in the demo row" claim — hence the narrowed
  wording throughout this section ("a real *bank's* data via a *connection*"). Not fixed here because
  it is a larger slice ("make the demo read-only for ALL visitor-brought input") that also carries a
  demo-UX product question: is hands-on manual entry an INTENDED demo affordance (the seed is complete
  without it), or an oversight? **Recommended smallest close (owner to confirm scope): one shared
  early-return applied to all four actions + a test that each refuses demo, mirroring
  `connect-demo-fence.test.ts`.**

## AI Trust Center & Audit Ledger (#242, 2026-07-16) — AI plan §3.2 complete

The new /trust page (linked from the Settings AI-trust card, no new nav icon) states the
adjudication-narrowed invariant — **"Dollar figures the AI has authored: 0"** with the model's
confidence disclosed as the one AI-originated number — over three grounded panels: the reused
accuracy/Brier scorecard (sample size inline), a static code-authored table of every place a model
runs and its may/never limits, and an audit ledger of model calls INCLUDING the ones whose reply
the guardrail discarded (rejection logging is itself the trust signal).

- **The sink contract.** All four `*ViaLLM` modules report exactly once per ATTEMPTED provider
  call — replied / rejected / unavailable — with closed-set meta only (a pinned categoryId+bps, a
  pinned intent kind, a count; the balance-move draft persists NOTHING because its strings are
  still model-authored at that point). No key → no call → no row; a sink/DB fault never breaks the
  answer path (fire-walled twice, regression-locked). `parseAiAuditRow` re-pins everything at
  render, so an unknown row drops rather than guesses.
- **The demo fence is now by construction.** Three Fable critic cycles (FAIL/FAIL/PASS 0 P0/P1):
  cycle 1 caught the demo /trust copy claiming keylessness a keyed deployment falsifies (demo Ask
  questions actually egressed, invisibly); cycle 2 caught the per-call-site fence pattern missing
  the two INGEST sites (a demo-connected bank would egress descriptors forever). Fix: ONE
  constructor — `categorizeSuggestFor(userId)` — is the only way any of the five categorize paths
  obtains a suggest function (demo → null no-op ≡ keyless), plus fences at assistant/coach; cycle
  3's exhaustive call-path audit found no bypass. Demo copy now states an ENFORCED invariant.
  Side effect: #241's "badge-absent e2e assumes a keyless environment" P2 is retired — the demo
  recap is floor-stable on any deployment.
- **'use server' removed from llm-categorize/assistant-llm** (pre-existing exposed-action-endpoint
  hole: any client could invoke them and burn provider credits). `AuditLog` gained
  `@@index([userId, createdAt])` for the ledger read.
- **Gate (real output 2026-07-16):** `bash scripts/verify.sh` → **✅ VERIFY GREEN — 2898 unit /
  206 files**, tsc/eslint/next build clean; e2e trust.spec 1/1 mobile-380 (headline, scorecard,
  5 touchpoints, honestly-empty demo ledger, axe AA), ask.spec 20/20, phase3-coach 1/1.
  EDGE_CASES §AI Trust Center; REGRESSION_LEDGER 3 rows; DECISIONS #242.
- **Open P2s (recorded, accepted):** vocab-recheck rows can dominate the 50-row ledger window
  (copy claims only "Last N events" — honest; per-touchpoint filter later); the populated ledger
  state is never axe-scanned (demo is empty by construction; same Card components). **Owner
  follow-up (its own small slice) — RESOLVED 2026-07-16 (Demo bank-connect fence section below):**
  demo visitors could CONNECT a real bank into the shared demo account, landing one visitor's real
  bank data in the all-visitors demo row; the connect/ingest actions are now fenced for
  `DEMO_USER_ID`. **Next (owner-gated): §3.3 Doc Extractor v1 / §3.4 Subscription Radar /
  §3.5 Receipt Splitter, or the plan's "Later" section.**

## Monthly Money Review (#241, 2026-07-16) — AI plan §2.4 complete (Wave 2 done)

The /coach Monthly Money Review is now a closed candidate-insight set with an optional key-gated
LLM that only SELECTS and ORDERS candidate ids — it cannot author a line, a number, or an id
outside the frozen set. Every rendered line is a verbatim, already-guardrail-scanned COACH_COPY
string with engine cents substituted in code, so this surface adds ZERO generated prose (a
deliberately stronger boundary than the §2.4 writeup's number-allowlist idea).

- **Deterministic floor = today's recap, byte-for-byte.** `selectReview(candidates, null)`
  reproduces `generateMoneyReview` exactly (locked by test), so demo/zero-key is unchanged.
  `generateMoneyReview` and the 3-field `MoneyReview` object are untouched — the digest email,
  dashboard, and return-moment keep their consumer contract (#221 fence).
- **The LLM can reorder, never delete.** One line per role (improvement/watch/action); the
  material cash-needed action is pinned (overrides any non-material pick, survives truncation);
  every role the floor shows is backfilled, so a hostile/vacuous reply can never shrink the recap
  below the zero-key baseline. The ordering call is gated to /coach (`{orderReview: true}`) —
  dashboard, goals, investments, assistant, and the per-user digest cron get the floor with no
  model call and no data egress.
- **Two Fable hostile-critic cycles.** Cycle 1 FAIL (0 P0, 2 P1: the unconditional LLM await
  fanned out to all six `getCoachData` callers; a valid-vocabulary reply naming an absent id
  produced an EMPTY recap under a "Personalized" badge) → cycle 2 **PASS (0 P0/P1)**, both fixes
  re-verified closed. Open P2s (recorded, accepted): P2-A — a fully-inapplicable in-vocab reply
  still reorders the floor and lights the badge (content safe; fix sketched in the cycle-2 report);
  wrapper fetch-plumbing untested (every failure mode → null → floor); the e2e badge-absent
  assertion assumes a keyless environment; with a key set, /coach TTFB can absorb up to the 7s
  provider timeout before falling back.
- **Gate (real output 2026-07-16):** `bash scripts/verify.sh` → **✅ VERIFY GREEN — 2854 unit /
  202 files**, tsc/eslint/next build clean; `phase3-coach.spec.ts` 1/1 on mobile-380 (recap renders
  the deterministic role lines; no "Personalized" badge in demo). REGRESSION_LEDGER 2 entries;
  EDGE_CASES §Monthly Money Review; deferred: cross-month lead-dedup + per-month caching (needs
  net-new persistence — MONEY_REVIEW_PLAN.md). Vitest now stubs `server-only` (the real
  client-leak guard is `next build`). **Wave 2 of the AI plan is complete (§2.1–§2.4). Wave 1 was
  already complete — §1.1's owner-set goal-type sequence (debt #125 / savings #126 / retire-at-age
  #131) and §1.2 Cash Flow Radar (#172) — and §3.1 shipped as #238/#239. Next (owner-gated): the
  Wave 3 remainder (§3.2 Trust Center, §3.3 Document Extractor, §3.4 Subscription Radar,
  §3.5 Receipt Splitter) or the plan's "Later" section.**

## Balance-Move Explainer (#240, 2026-07-16) — AI plan §2.3 complete

The `/trends` "What changed" section now leads with a grounded, descriptive one-liner. This is the
codebase's FIRST surface where an LLM generates user-facing PROSE, so the whole slice is the
hardening of that boundary.

- **The LLM authors STRUCTURE, never a fact.** It returns `{primaryDriverId, template}` where the
  template is ATOMIC placeholders — `{primary}`/`{second}` each substitute "Label, up $240.00
  (+40%)" (label fused to its own figure) and `{window}` substitutes "compared with your 3-month
  average" — joined only by purely-ADDITIVE connectives. The engine substitutes every figure and
  label, so a number cannot be fabricated, swapped between categories, or flipped. Deterministic
  template is the floor (and always in demo / zero-key); the LLM path is a bounded, key-gated polish.
- **Four Fable hostile-critic cycles on the prose surface.** cycle 1 FAIL (3 P0/3 P1 — a
  fresh-context critic defeated the initial free-prose validator with 20/20 attack strings) → cycle 2
  FAIL (1 P0: placeholder-reorder = figure swap; 2 P1) → cycle 3 FAIL (0 P0; 2 P1: relational
  connectives asserting a false flow, foreign-category scan false-suppressing benign labels) → cycle
  4 **PASS (0 P0/P1)**. The design moved free-prose → placeholder → ATOMIC placeholder + additive
  grammar; the vestigial foreign-category scan was removed (the atomic grammar makes model
  category-injection impossible). 5 P2s recorded (DECISIONS #240 / cycle-4 report); the one that
  false-suppressed common digit labels ("401k") was fixed (label tokens masked before stray-number).
- **Gate (real output 2026-07-16):** `bash scripts/verify.sh` → **✅ VERIFY GREEN — 2833 unit / 201
  files**, tsc/eslint/next build clean; `balance-move.spec.ts` 2/2 (demo shows the deterministic
  template with no "AI-worded" badge; the explainer's money figure appears in the movers list —
  grounding; axe WCAG-AA) + trends specs unregressed. REGRESSION_LEDGER 5 entries; EDGE_CASES
  §Balance-Move. The mobile-380 flake still blocks a full local `VERIFY_E2E` exit-0 (unchanged since
  #175). **Next AI-plan slice (owner-gated): §2.4 Monthly Money Review reuses this validator, or the
  next owner pick.**

## Why-This-Category slice 2: register badge + AI-guess confirm (#239, 2026-07-16) — §3.1 complete

Slice 2 ships the UI (WHY_THIS_CATEGORY_PLAN.md criteria 6–9): every register row now
carries a provenance badge naming who decided its category, and an `ai-guess` row shows a
one-tap **Confirm** that reuses the correction path and flips it to "You set this".

- **Server-computed, rendered verbatim.** `getTransactions` computes each row's
  `ProvenanceVerdict` once (one extra `CategoryPrediction` findMany, Map-joined) from the RAW
  stored facts, so slice-1's P1-3 divergence guard fires on true DB values; the pure
  `provenanceBadgeView` copies the label verbatim and derives tone/confirm from `needsConfirm`
  alone — the badge can never disagree with the resolver (no display-only re-derivation).
- **Confirm = the existing correction path.** `confirmGuess` files the row's current category
  (== predicted for an ai-guess) via `recategorize({scope:'one'})` → `applyCategory`, which
  stamps `labeledAt` → the row reads `user-set` on reload. No rule minted (confirming one charge
  is not "always"). Deterministic rows show no confirm control.
- **Scope = register only** (recorded, DECISIONS #239): ai-guess rows are auto-filed (LLM overlay
  files ≥ AUTO_SILENT_BPS) so they live in the register, not the review queue; triage suggestions
  are a different (live-pipeline) provenance path; and provenance never enters the partner
  `SharedTxnRow` (the #221 second-person-copy fence). Triage-badge enrichment is the noted next
  increment, not this slice.
- **Demo fixture — the notable decision.** Criterion 8 needs one demonstrable ai-guess row. The
  demo has NO auto-filed unknown-merchant row (every real-category row is a KNOWN merchant →
  merchant-default, which beats the LLM), so relabeling one's `source` to 'llm' would FABRICATE an
  impossible origin — the exact dishonesty this feature prevents (Fable critic P2-1 caught this as
  a real fall-through in the first draft). The seed instead PROMOTES one uncategorized,
  unknown-merchant review row to an llm-resolved row (the authentic overlay path). This moves ONE
  row out of uncategorized/review — the slice's one deliberate golden change — and it broke ZERO
  money/accuracy/e2e goldens.

**Fresh-context Fable hostile critic: cycle 1 PASS, 0 P0/P1** (cardinal rule upheld — no AI guess
shown as fact, no fabricated origin/confidence, partner path clean). P2-1 (demo honesty) FIXED
(row-promotion + a seed-contract test pinning the fixture to an ambiguous merchant); P2-4 (Confirm
a11y name) FIXED; P2-3 (e2e retry-idempotency on the shared demo DB) mitigated (skip-when-consumed);
P2-2 (confirm records a same-category Correction) ACCEPTED — identical to existing register
recategorization.

Gate (real output 2026-07-16): `bash scripts/verify.sh` → **✅ VERIFY GREEN — 2801 unit / 200
files**, tsc/eslint/next build clean; `why-this-category.spec.ts` 2/2 (badge truthfulness, exactly
one confirmable ai-guess, axe WCAG-AA, confirm→"You set this" flip) run directly, plus 23/23 on the
register + triage specs unregressed (the mobile-380 flake still blocks a full local `VERIFY_E2E`
exit-0, unchanged since #175). REGRESSION_LEDGER 1 entry; EDGE_CASES §Why-This-Category slice-2
note. **Next: AI plan §3.1 is complete; the triage provenance badge is a documented follow-up. Per
COMPETITIVE_GAP_PLAN model-routing, the next AI-plan slice picks up on a fresh session.**

## Why-This-Category slice 1: provenance engine + persistence (#238, 2026-07-16)

AI plan §3.1 (rank #3, Wave 3 lead) build-loop step 1 (WHY_THIS_CATEGORY_PLAN.md) → slice 1
shipped: the ENGINE + PERSISTENCE that make category origin (deterministic rule / merchant /
provider / LLM guess / user) a durable, honestly-classifiable fact. **No UI yet** (slice 2).

Pure `categorize/provenance.ts` `describeProvenance` maps stored facts to a display kind over a
total exhaustive switch; `ai-guess` (the only `needsConfirm`) is reachable ONLY from a persisted
`source:'llm'` on a non-drifted, unlabeled row — origin is never inferred from confidence or
category. Additive nullable `CategoryPrediction.source` (db push; forward-only, NULL →
`not-recorded`) threaded through the `logCategoryPredictions` choke point + all four live
write paths (plaid, simplefin, transaction-actions manual+CSV) + the `assistUnsureRows` overlay
(stamps `'llm'`) + seed. Demo golden-safe (every demo prediction carries a real source, none
`'llm'`/`not-recorded`; accuracy/tuning goldens byte-identical).

**Two Fable hostile critic cycles** (trust/data-integrity surface): cycle 1 FAIL (1 P0, 2 P1) →
cycle 2 PASS (0 P0/P1, all fixes re-traced closed). **P0-1** LLM conf 1.0 → 10000 collided with
the user-dictated sentinel → dropped from the log and shown as "You set this" (a model guess as
a human fact) — fixed by capping LLM confidence at 9900. **P1-3** the create-only prediction is
the FIRST verdict but the category moves (backfill/sync/partner) → a stale source would name a
false origin — fixed by a predicted-vs-current divergence guard → `not-recorded`. **P1-2** CSV
correlated provenance by `createManyAndReturn` index (no ordering contract) — fixed by
pre-assigned `randomUUID()` ids. Accepted/deferred (each honest, never a false origin):
EDGE_CASES §Why-This-Category lists P2-4/5/7 + cycle-2 P2-1 (backfill LLM re-file → not-recorded)
and P2-2 (partner same-category re-confirm).

Gate (real output 2026-07-16): `bash scripts/verify.sh` → **✅ VERIFY GREEN — 2790 unit / 199
files**, tsc/eslint/next build clean; no e2e (no UI in slice 1). DECISIONS #238; REGRESSION_LEDGER
3 entries. **Next: slice 2 (= UI) — join `source` into `TxnView`, render the provenance badge on
register + triage rows, the "AI guessed — confirm?" affordance reusing the correction path, seed
one `ai-guess` demo row so the flow is demonstrable with zero credentials; e2e + axe. Per the
plan and the project model-routing, slice 2 is an Opus 4.8 build (UI), Fable critic on the
copy-truthfulness surface.**

## Nudge slice 2: dashboard "Today" feed + dismissal store (#237, 2026-07-15)

Slice 2 wires the slice-1 engine into the UI (NUDGE_PLAN.md). The dashboard RSC builds
`buildNudgeFeed` from the SAME source rows the cards below already show and renders a
`TodayFeedCard` under the cash-needed headline: the top proposal + a collapsed rest,
a "why am I seeing this" disclosure (tier rule + verbatim inputs), a "show everything"
control (re-invokes the engine with an empty dismissedKeys set), and a Dismiss control on
ACTION/OPPORTUNITY only — a CRITICAL warning is never given a hide button and is never
suppressed by the engine (never buried). Copy is owner-neutral and per-kind-correct.

**Store (schema change, reconciled):** the plan's slice-2 "no schema change" bullet was
written before #236's P1-1 finding forced a DEDICATED suppression store (dismiss-keys
embed merchant+cents, which EngagementEvent's closed-set no-money contract can't hold,
and no generic dismissal table existed). Resolved with an additive `NudgeDismissal`
model (portable, reversible). The shared demo user never writes AND never reads it
(double fence, independently tested) — dismissal is session-only for `user-demo`.

**Three Fable critic cycles** (money/data-integrity surface): cycle 1 FAIL (3 P1) → cycle
2 FAIL (2 P1) → cycle 3 PASS (0 P0/P1). All five P1s were false-money-copy or write-path
hygiene; all fixed and locked. Accepted-and-recorded residuals: EngagementEvent writes
for the demo user stay unfenced in v1 (pre-existing 3.1 behavior; slice 3 enforces the
read-side learning fence per NUDGE_PLAN criterion 8); the payment_due dismiss key carries
no amount (a dismissed estimated due survives a large revision until it resurfaces
CRITICAL at ≤3 days — bounded, reminders card never hides it); `NudgeDismissal.createdAt`
doubles as last-dismissed-at.

Gate (real output 2026-07-15): `bash scripts/verify.sh` → **✅ VERIFY GREEN — 2763 unit /
197 files** (full e2e suite 120/120), tsc/eslint/build clean; today-feed e2e **5/5** (headline present, critical
never dismissable, dismiss→show-everything round trip, honest "Up $2.50/mo" + "Payment
due" copy, axe WCAG-AA with the disclosure open). **Next: NUDGE slice 3 (= TASKS 3.5) —
cadence adaptation, deferred until real `EngagementEvent` behavioral data exists (audit §4
constitution + demo read-fence).**

## Glass-Box slice 3: derivation "formula + inputs" panels (#235, 2026-07-15) — GLASSBOX_PLAN complete

Slice 3 closes GLASSBOX_PLAN (AI plan §2.1): the three derivation figures Ask can honestly explain —
net_worth, cash_needed, savings_rate — are now tappable, opening a "formula + inputs" panel whose
displayed lines provably produce the displayed number. No fake row-sum: these are formula results.

**Engine (`assistant/derivation.ts`, pure):** a new `DerivationTrace` variant on `AnswerTrace`, built
under the glass-box cardinal rule — reshape the engine result, never recompute from raw inputs.
net_worth: one signed line per account, side by the canonical `isLiabilityType` (an overdrawn checking
is a negative-contribution asset, never sign-inferred; −0 normalized). cash_needed: rows REUSED from
the dashboard glass-box trace (the engine's own `perDueDate` partition — the real-statements-else-
estimated due-selection is never re-implemented; "(autopay)" markers carried for /cards parity);
reconciled also binds `byDate`. savings_rate: income/expenses lines summing to saved, the rate
recomputed via the same `savingsRateBps` and gated against the coach's STORED bps — the canary that
fires if the coach's definition ever drifts from the formula shown.

**The gate is triple + local:** builders declare their OWN figure (`headlineCents` widened to
net_worth/cash_needed; new `headlineBps` for savings_rate) so line sum ≡ engine figure ≡ builder
figure at build time; a pure `derivationView` (trace-view.ts) re-runs the whole chain client-side
(re-sum, per-kind formula re-run, every-row integer-cents guard, empty-rows guard) before the UI
offers anything under a ✓. No figure (zero-due, null rate, zero accounts) → no trace → no tap.
Untraced derivation kinds (forecast, safe_to_spend, …) stay a plain `<p>` — pinned by e2e. One
formatter per claim: `bpsToPct1dp` shared by headline+panel; `humanDate` exported so the "Needed by"
footer and row dates restate the headline's date claim in its own format.

**Two fresh-context Fable critic cycles, both PASS 0 P0/P1; 9 P2s found and ALL FIXED** (cycle 1: basis
copy misstating manual accounts/OTHER_LIABILITY, overpaid-card double negative, footer ISO mismatch,
dead export, autopay parity, empty-accounts hollow tap; cycle 2 verified those fixes + found: 380px
truncation could clip the disclosure markers, raw-ISO row dates, integer-guard asymmetry). Both cycles
hand-verified the three formulas on paper and re-ran every gate themselves. 2 REGRESSION_LEDGER
entries; DECISIONS #235.

Gate (real output 2026-07-15): `bash scripts/verify.sh` → **✅ VERIFY GREEN — 2714 unit / 194 files**
(+42/+2: assistant-derivation 26, assistant-derivation-view 16), tsc/eslint/build clean; ask e2e
**20/20** (3 new tappable-formula specs re-running the arithmetic off the DOM at 380px — owned−owed,
card rows re-sum + same-format footer date, income−expenses=kept + panel rate === headline rate — plus
the untraced safe_to_spend pin; axe WCAG-AA with the formula panel open). **Next: AI plan Wave-2 §2.2
(Smart Notification & Nudge Engine, rank #7) — needs its own scoping decision first.**

## Glass-Box slice 2b: per-fact taps + the one-tap correction chip (#234, 2026-07-15)

Slice 2b completes the read surface and ships the first Ask WRITE path (GLASSBOX_PLAN §2b).

**Per-fact tappability (read):** builders now TAG their category facts — `AssistantFact.traceKey`
(categoryId) + `.cents` (the builder's own figure) — so no display string is ever matched back to
a trace group (the slice-1 fragility). A pure `factView` gate (trace-view.ts) opens a per-fact
panel only when the full chain reconciles: reconciled trace → tagged fact → group exists → group
rows sum to the group amount → group amount equals the fact's own cents (the per-fact analog of
`expectedHeadlineCents` — builder and trace compute independently, so the equality is a real
drift gate). Any break → plain text, never a dead tap or an unbacked ✓. `top_categories`' non-top
facts are now individually tappable — exactly what 2a's headline panel honestly refused to show.

**Correction chip (write, money-adjacent — Maker/Checker):** spend-family trace rows carry
`txnId` (`TraceTxn.id` is REQUIRED — the slice-1 optional-meta lesson applied to ids); "Fix
category" on a row → "This should be <category>" → `correctFromAsk` delegates the write to
triage's `applyCategory` VERBATIM (ownership-scoped serializable tx, append-only Correction,
audit) — zero drift with every other recategorization surface — then re-dispatches the
re-validated intent through the same module-private compose pipeline (`composeAnswer`, kept
unexported from the 'use server' file deliberately), so the user watches the figure move,
LLM-free by construction. Undo reuses `undoCorrections` (idempotent, restores to review — the
copy says so). Scope: CORRECTABLE_KINDS only (spend_total / spend_by_category / top_categories —
where the correction visibly moves the tapped figure); merchant/income/largest rows carry no
txnId and no chip. **Ask never passes `always` → no durable rule is ever minted from Ask** — the
shared-demo-account fence that matters: the correction itself is a reseedable category pick
(triage parity, no typed input → vocab's `learningDisabled` fence doesn't apply), but a demo
visitor durably teaching the shared account is fenced off by construction.

**Committed-write honesty (critic-driven):** a recompute failure AFTER the committed write
returns `{ answer: null, correctionId }` — never a false "try again" — and the client enters a
stale state that closes AND withholds every reconciliation tap (a ✓ must never be reachable over
rows the write just moved), disclosing "ask again to see the new numbers" with Undo still live.

**Two fresh-context Fable critic cycles, both PASS 0 P0/P1, 4 P2s found and FIXED:** cycle 1 —
committed-write-as-false-failure (fault-injection-locked), undo copy hiding the review-queue
return; cycle 2 — stale states left taps live over pre-write rows, `run()` missing the
`correcting` race guard. Accepted P3s (recorded in DECISIONS #234): single-undo-depth on /ask;
hidden-category `toCategoryId` parity with /triage; single-member umbrella tags stay inert
(pinned by test — the headline reconciles the same figure). Cycle 2 independently re-ran
tsc/eslint/vitest AND the 17-spec ask e2e, and re-executed the factView mutation repro.

Gate (real output 2026-07-15): `bash scripts/verify.sh` → **✅ VERIFY GREEN — 2672 unit / 192
files** (+2 files: assistant-fact-view 18, ask-correction-action 4 incl. the fault-injected
committed-write lock), tsc/eslint/build clean; ask e2e **17/17** (2 new specs: a non-top fact's
rows re-summed off the DOM to its own figure; chip render-only — editor open/cancel, no apply
click against the shared demo DB per the #182 precedent — and merchant rows proven chip-free),
axe WCAG-AA clean with the fact panel and the editor open. 2 REGRESSION_LEDGER entries,
DECISIONS #234. (Slice 3 shipped 2026-07-15 — §above.)

## Glass-Box slice 2a: the trace UI — tappable numbers + reconciliation panel (#233, 2026-07-15)

Slice 2a wires the slice-1 engine into Ask (GLASSBOX_PLAN §Sequencing): a row-sum answer's
headline number is now tappable → an inline, non-modal disclosure panel shows the exact
transaction rows behind it, reconciled to the penny, with the engine's basis lines (what's
included/excluded). Derivation figures (net worth, forecast, safe-to-spend, …) carry no trace
and stay a plain, untappable `<p>` — the UI never offers a reconciliation it can't honor.

Wiring: the server computes `traceAnswer` immediately after `buildAnswer` on the SAME snapshot +
meta and attaches `trace` + `headlineCents` to the answer payload (eager — the panel always
reconciles the number on screen, and no client holds raw transactions). `headlineCents` is set by
each row-sum builder from its OWN figure and passed as `expectedHeadlineCents`, so the trace's
drift check is a real equality gate, not a self-comparison. Presentation honesty is enforced by a
pure `reconciledView` (trace-view.ts): the panel shows the per-category group breakdown ONLY when
the groups sum to the tapped figure — `spend_total` / umbrella `spend_by_category` (groups ARE the
headline's breakdown) render hierarchically; `top_categories` (headline = top category, groups =
all top-N) renders the flat top-category rows.

Two fresh-context Fable critic cycles. **Cycle 1 FAIL — 1 P1**: the top_categories panel
green-checked "N transactions add up to $X" folding the row count across ALL listed categories
while $X was the top category only, and rendered non-top rows under the ✓ — a reconciliation
endorsing a number it couldn't stand behind, the exact trust-primitive failure this feature exists
to prevent. Fixed via `reconciledView`; regression-locked (unit: real-engine top vs total; e2e:
`ask-trace-group` count 0 for top_categories). **Cycle 2 PASS — 0 P0/P1** (critic independently
re-ran tsc/eslint/vitest; confirmed no client-bundle engine leak, drift-guard + rowCount honesty,
and that reports.ts dropping ≤0 categories makes the groups-sum equality airtight). Gate:
`bash scripts/verify.sh` → **VERIFY GREEN — 2650 unit / 190 files** (+15: the headlineCents
contract + the reconciledView presentation guard), tsc/eslint/build clean; ask e2e 15/15 (2 new
Glass-Box cases + the top_categories regression, all axe WCAG-AA clean with the panel open).
REGRESSION_LEDGER entry, DECISIONS #233.

**SCOPE SPLIT (honest).** 2a = headline tap + read-only panel (shipped). **2b (next):** per-FACT
tappability — needs builder-tagged trace keys, since matching a fact's display string back to a
trace group is the fragility the slice-1 critic flagged — and the one-tap correction chip ("this
should be <category>"), a money-adjacent WRITE path with the shared-demo-account learning fence,
which deserves its own Maker/Checker slice. **Next: slice 2b**, then slice 3 (derivation-chain
"show the formula + inputs" for cash_needed / net_worth / savings_rate).

## Glass-Box slice 1: the row-sum trace engine (#232, 2026-07-15)

The Wave-2 lead (AI_DIFFERENTIATION_PLAN §2.1, plan: docs/GLASSBOX_PLAN.md) is engine-complete:
`src/lib/engine/assistant/trace.ts` traces the 6 ROW-SUM intents (spend_total hierarchical,
spend_by_category, top_categories, merchant_spend gross, income, largest_purchases single-row)
to the exact transaction rows behind the headline, reconciled to the penny at runtime — fail
loud in both directions, never a wrong number under a green check. Lockstep by construction:
the engines' own row predicates were extracted and shared (`isSpendRow`/`spendRowCategoryId`/
`spendContributionCents` from reports.ts, `isIncomeFlowRow` from insights.ts, `toPurchaseRows`
into answer.ts), each extraction pinned byte-identical. The 12 derivation-chain intents return
`not_row_sum` (`ROW_SUM_KINDS` drives UI tappability) — no fake row-sum is ever offered.

Two fresh-context Fable critic cycles: **cycle 1 FAIL — 2 P1** (optional `meta` silently
mis-bucketed custom categories: a wrong figure stamped reconciled; no answer→tap drift check:
a sync between answer and tap green-checked a different number than tapped), 1 P2, 2 P3 — P1s
fixed (`meta` required; `expectedHeadlineCents` folded into `reconciled`), P2 tested, P3s
recorded as binding slice-2 constraints in GLASSBOX_PLAN §Sequencing. **Cycle 2 PASS — 0 P0/P1**
(both repros re-executed independently incl. tsc-level rejection; independent 400-iteration
fuzz clean; cycle 1 had already fuzzed the extractions old-vs-new 4000 iterations clean). Its
3 P3s: dead cast removed; expectedHeadlineCents-optional trap → slice-2 constraint (consider
required when the first real caller lands); custom-Income-group categories are refund-netted
by income while merged-meta spending excludes them as Income — pre-existing, both surfaces
agree (lockstep holds), revisit if custom categories ever join the Income group. Gate:
`bash scripts/verify.sh` → VERIFY GREEN — **2635 unit / 188 files** (41 trace tests), tsc/
eslint/build clean. 2 REGRESSION_LEDGER entries, DECISIONS #232. **Next: slice 2 (UI)** —
tappable row-sum figures + trace drawer + correction chip in ask-view.tsx, honoring the
recorded per-figure tappability constraints.

## Wave 2.7: timeframe follow-up + largest merchant scope (#230, 2026-07-14)

The 2.6 escalation's last two items now earn real answers — and the slice fixed
CONFIRMED live cardinal-sin bugs, not just abstains: "groceries in 2025" answered the
unhedged THIS-MONTH Groceries figure, "since 2024" / "between 2024 and 2025" the
this-month total, "since march" a March-only window, and every scoped-largest question
the GLOBAL biggest purchase.

**(a) Timeframes:** bare years ("in 2025"; current year → "2026 so far"), "since
<year|month|last month|last year>", year ranges (a range ending in the current year is
labeled "since <lo>" so frame staleness re-labeling covers it), numeric dates ("3/5" US
M/D → the containing MONTH window, the shipped worded-"on March 5" rule). Future
years/months are never windows. **(b)** New guard `unresolvedDateShape`: a date shape the
parser could not window ("in 2027", "on 13/5", "fy2025", "2025/26") abstains every
timeframe-carrying route — parser, `intentFromKind`, and the conversation frame — instead
of the silent this-month default. **(c)** The #229 licence consumes exactly what the
parser windows (shared recognizers + `today`). **(d)** `largest_purchases` gains an
optional merchant (at/with/from) via shared `largestScope`, abstaining on fronted
stores, payment methods (#168, now incl. account words), unreadable names, and
category/unknown attributive modifiers; the frame carries the merchant on window swaps
and re-scopes on "what about at X?" (supersedes #223 P2-5). **(e)** New shared
`isLicensedIdiomPhrase`: "at the moment" / "at the end of last month" are idioms, not
stores — fixing pre-existing "No spending at Moment" confident-wrong answers in
merchant_spend too.

Two fresh-context Fable hostile-critic cycles: **cycle 1 FAIL — 4 P1** (licensed idioms
became merchants; attributive/"from" merchants answered the global ranking; month+future-
year escaped every refusal; the frame silently dropped unresolvable dates), 3 P2, 2 P3 —
all fixed in-cycle. **Cycle 2 PASS — all 9 closed by re-executed repros, 0 P0/P1**; its 2
new P2s (account-word merchants, "item" noun) also fixed and locked; N-2/N-4 recorded as
deliberate trades (§OPEN item 4, EDGE_CASES). Gate: `bash scripts/verify.sh` → VERIFY
GREEN — **2594 unit / 187 files**, tsc/eslint/build clean; `npx playwright test
tests/e2e/ask.spec.ts` → **12/12** incl. the new year-window + scoped-largest flow.
5 REGRESSION_LEDGER entries, DECISIONS #230.

## Wave 2.6: `spend_total` earns its answer — the inversion (#229, 2026-07-12)

The spend-family sink now requires a **positive licence**: no unconsumed at/with/on/in object
anywhere in the question (shared primitive `unconsumedSpendObject`, enforced identically in
the parser sink, `intentFromKind` — so neither the LLM nor a learned vocab rule can re-answer
what the parser abstained on — and the conversation frame). Fronted objects ("At Costco, how
much did I spend?"), sentence breaks, "@"/"in" phrasings and punctuation glue all abstain
instead of answering the user's entire spending. Bundled fixes: "at home depot"/"at
homegoods"/"at home and garden" are merchants, never the Home group (word-bounded,
extension-checked tier-3 fallback); "at - costco"/"at... costco" resolve merchant "costco";
non-ASCII custom categories ("Café") are reachable by exact object equality — tail included,
so "at café in 星巴克 town" still abstains; the frame BLOCKS a guard-refused object ("with
amex in june", "income in june") instead of silently answering the carried question's window
swap, while pronouns ("that in june") still carry.

Two fresh-context Fable hostile-critic cycles: **cycle 1 FAIL — 2 P0** (the licence's first
consumed token licensed the whole object: "at Best Buy / Top Golf / All Saints / 5 Guys / 76"
still took the total through every route at once), **1 P1** (the frame's on/for silent drop),
2 P2, 2 P3 — all fixed in-cycle. **Cycle 2 PASS — all 7 closed by re-executed repros, 0
P0/P1**; its 2 new P2s ("Do It Best", carve-out prefix-equality) also fixed and locked.
Gate: `bash scripts/verify.sh` → VERIFY GREEN — **2537 unit / 185 files**, tsc/eslint/build
clean; `npx playwright test tests/e2e/ask.spec.ts` → **11/11**. 6 REGRESSION_LEDGER entries.

## Wave 2.3: Learned vocabulary — the weekly mining loop (#225/#226)

The parser now gets smarter every week with no deploy. When a user asks the same
question several times, the deterministic parser can't route it, and an independent
resolver keeps agreeing on what it means, the weekly cron learns that phrasing. New
additive `VocabEntry` + pure `src/lib/engine/vocab/vocab.ts` + Prisma-only
`src/server/vocab.ts` + `/api/cron/vocab` (Mon 16:00).

The one property everything else rests on: **a learned entry supplies an intent KIND
and nothing else.** Every timeframe, category, merchant, amount and age is re-derived
from the asker's own words by `intentFromKind` and re-validated by `validateIntent` —
byte-for-byte the contract the LLM classifier has lived under since #75. So the vocab
layer is exactly as powerful as the model route it replaces, minus the model call: a
wrong entry can route to a wrong kind, and can never inject a figure, a window, or a
category. Routing order is parser → frame → vocab → LLM, consulted only on a
parser-`unknown`, so every existing route is byte-identical. Because it is deterministic
and free, it also keeps working with **no LLM key at all** — no 7-second timeout, no
rate limit, no provider outage.

The ladder (audit §4.2 loop 2): **shadow** (minted from ≥3 unanimous independent
rescues; not served, accruing held-out evidence) → **flagged** (≥2 held-out agreements,
zero disagreements; served, carrying the same "I interpreted your question" hedge an LLM
answer carries) → **active** (≥2 disclosed serves, no rejection; served, disclosed as
learned) → **retired** (terminal tombstone). The loop cannot confirm itself: rows its own
entries resolved are tagged `vocab:<kind>` and count only as `served`, never as evidence,
and `frame:`-tagged rows (#222) make a phrase permanently ineligible. Every count is
recomputed from the ledger each run, never incremented. Undo is one click on the answer
("Not what I meant") or on Settings → AI trust ("Forget this"), and it is terminal — the
miner can never re-mint a phrase from the evidence the user just rejected.

Vocabulary is **per user**, a deliberate deviation from the audit's "≥N distinct users"
clustering (DECISIONS #225): a phrase is user-authored text that has been PII-scrubbed,
not anonymized, so pooling it would copy one person's words into another's routing table
and onto their screen.

Three fresh-context Fable hostile critics in parallel (routing/money · the learning loop ·
authz+privacy), cycle 1: **FAIL — 0 P0, 5 P1, 11 P2 — all P1s and every actionable P2
fixed in-cycle and regression-locked** (cycle 1 of the 4-cap). The routing critic confirmed
the kind-only claim held under every injection attack it could build; the other two then
found what it couldn't see — the loop's *back half* was where the design leaked. **The
shared demo account learned**, so one anonymous visitor's typed question would have been
mined and rendered in the next visitor's settings (fixed: the demo user never learns —
the second instance of the #210 rule that anything accumulating a user's own INPUT must
fence the shared demo login off). **A user's "Forget this" landing mid-mining-run was
silently reverted** by the miner's stale write, and the rejection lives nowhere else, so
it was gone for good (fixed: a tombstone always wins the race). **A served entry became
unmonitorable** — it short-circuits the LLM, so no independent evidence about it could
ever be written again, and flagged→active promoted on the entry's own serves (fixed: the
weekly cron now replays every served phrase against the classifier that never sees the
rule, and retires it on disagreement — audit constitution (e), restored). `VocabEntry`
was an undisclosed store (fixed in PRIVACY.md). And a **pre-existing** cardinal-sin bug in
the parser: "how much did I spend at 星巴克 last month" answered the ALL-SPENDING TOTAL
with no hedge, because both #166 abstain guards are ASCII-only (fixed: abstain before the
tokenizer sees it).

Cycle 2 (fresh context, every cycle-1 repro re-executed): **all 11 cycle-1 findings confirmed
CLOSED — and 1 NEW P1, inside the cycle-1 fix itself.** The non-ASCII abstention guard read the
first token after the preposition, but the merchant tokenizer skips leading articles first — so
guard and tokenizer disagreed about where the merchant starts, and the cardinal sin was one
article away: "how much did I spend at **the** 星巴克 last month" still answered the all-spending
total. Both now walk one shared token stream, so a guard can never inspect different input than
its subject. That fix also closed a P2 the cycle-1 guard had *caused*: a curly apostrophe (the
iOS keyboard default) is non-ASCII but meaningless, so "at mcdonald’s" had started abstaining —
silently breaking every phone-typed possessive store name. Two more P2s fixed: an audit-initiated
retire is no longer silent (`vocab.retired.recheck`), and PRIVACY.md now actually describes the AI
routing service it had been promising to describe — the raw-question send had never been disclosed
at all, since #75.

Gate (real 2026-07-12, post-cycle-2): `bash scripts/verify.sh` → **✅ VERIFY GREEN, exit 0** —
tsc clean · eslint clean · `npx vitest run` **2505 unit / 184 files** (+71 this slice) ·
`npx next build` clean. `npx playwright test tests/e2e/ask.spec.ts` → **11/11**, including
a new flow that signs up a real account, mints and promotes a rule through the REAL miner
(3 independent rescues → shadow; 2 held-out → flagged), answers an unroutable phrasing with
it, and forgets it. 7 REGRESSION_LEDGER entries (2026-07-12).

Accepted limitations (recorded, not fixed): an **audit-retire is terminal**, like a user's
rejection, so one stochastic misclassification permanently forecloses a phrase — the cost is that
the question returns to the route it had before it was ever learned (no user-visible harm), and the
asymmetry against a false PROMOTE justifies the bias; it is visible in the audit trail rather than
silent. Retired tombstones and the demo user's `UnknownQuestion` ledger both grow without bound
(storage hygiene only — nothing is rendered from either). **`status` is a durable ratchet** — an entry
whose supporting rows age out of the 2000-row mining window keeps serving with counts
recomputed to zero. Deliberate: a rule that passed its gates should not be un-learned
because the ledger scrolled, and it stays safe because every DOWNWARD path remains open
forever on no evidence budget at all (user rejection, held-out disagreement, a `frame:`
row, and the weekly independent re-check can each retire a serving entry at any time).
The **key is a whole scrubbed question**, not the audit's n-gram cluster, so only phrasings
a user actually repeats are learned — an n-gram rule can fire on a question it was never
mined from, which is the audit's own named failure mode, and there is no real ledger data
yet to tune a clustering threshold against. A **flagged** route seeds the next turn's frame,
and a follow-up fragment resolved against it carries no hedge of its own (the user saw the
disclosure on the anchor turn). `merchant_spend` sits in `LLM_ROUTABLE_KINDS` but
`intentFromKind` cannot produce it, so it can never be served — harmless today, and the
round-trip guard would abstain anyway.

## Wave 2.1: Ask conversation frame — deterministic ellipsis resolution (#222/#223)

The assistant no longer has amnesia. A follow-up fragment — "what about last month?",
"and groceries?", "at Costco?" — is now answered against the question it follows, with
no LLM and no new number. New pure engine `src/lib/engine/assistant/frame.ts`:
`frameFromIntent` distils the previous turn's RESOLVED intent into a slot frame
(`{kind, timeframe, target, merchant, limit}`), and `resolveEllipsis` rebuilds that same
intent with the one slot the fragment names swapped.

Three structural properties make it safe rather than clever:
**(1) It is consulted only on a parser-`unknown`.** A question that routes on its own is
never re-interpreted, so every pre-existing Ask route is byte-identical whether a frame is
present or not. **(2) It originates nothing.** Every slot comes from the already-validated
frame or from the user's own words through the parser's OWN helpers — `parseTimeframe` was
split into `parseExplicitTimeframe` (null when no window is named) plus the this-month
default, and the merchant tokenizer + the #168 payment-method guard are now exported and
shared rather than re-implemented. **(3) Session state lives in the answer, not the
server.** `AssistantAnswer.intent` is echoed to the client and handed back on the next ask
— no table, no session store, no cross-tab coupling — and because that value returns as
untrusted client input, it passes through the same `validateIntent` gate the LLM's
proposals do before it becomes a frame. Routing order is parser → frame → LLM, so a
deterministic answer always beats a model call.

Frame-resolved asks are written to the UnknownQuestion ledger tagged `frame:<kind>`: the
phrasing is context-DEPENDENT, so the TASKS 2.3 vocab miner must exclude the prefix (a
context-free rule for "what about last month?" would be a bug), while a mis-resolution
still leaves a trail instead of vanishing.

Fresh-context Fable hostile critic, cycle 1: **FAIL — 0 P0, 3 P1, 4 P2 — all fixed and
regression-locked in-cycle** (cycle 1 of the 4-cap). Every P1 was the same disease, the one
this slice exists to prevent: the frame answering a question the user did not ask. A
timeframe-FIRST fragment ("and this month at costco?") silently dropped the merchant and
answered the carried category; negation was unmodelled, so "restaurants not groceries"
answered GROCERIES (the synonym table is first-match-wins); and the assistant's own
vocabulary became merchant probes — "what about income?" → "No spending at Income" — which
also stole the question from the LLM classifier that routes it correctly. Fixed: merchant
search anywhere in the fragment; negation and question-word guards that abstain the whole
fragment before ANY slot extraction; an intent-noun/pronoun guard on the merchant path;
`largest_purchases` removed from the spend family (no engine computes "the biggest purchase
at Costco", so abstaining beats silently answering a merchant total); `validateIntent` now
bounds month (01–12), label (≤40) and merchant (≤64), having never been a client-facing
boundary before this slice; and a CARRIED deictic window is re-labelled against today, since
"this month" framed in June is a false name in July (the window itself never moves). Every
guard fails SAFE — a false hit abstains to the honest `unknown` and the LLM rescue still gets
its turn.

Cycle 2 (same critic, every repro re-executed against the fixed tree): **PASS — 0 P0, 0 P1.**
All seven cycle-1 findings confirmed closed, and a 19-case sweep found no legitimate ellipsis
broken by the new guards. It found two more P2s, both fixed: `validateIntent` derived nothing
about `target.label`, so a client-echoed frame could label the TRAVEL group "Groceries" and put
a true figure under a false name in a money headline — labels are now RE-DERIVED from the
target's own identity (`canonicalTargetLabel`), never trusted; and a stray "at" manufactured
merchants ("at least", "at work"). Two P3s fixed with them: "save"/"cut"/"back" left the
question-word guard (redundant against the interrogatives, and real store-name words — "and at
Save Mart?" must resolve), and a carried TRAILING window is re-named once today leaves it ("the
last 3 months" → "April 2026 – June 2026").

Gate (real 2026-07-12, post-cycle-2): `bash scripts/verify.sh` → **✅ VERIFY GREEN, exit 0** —
tsc clean · eslint clean · `npx vitest run` **2434 unit / 181 files** (+43 this slice) ·
`npx next build` clean. `npx playwright test tests/e2e/ask.spec.ts` → **10/10**, including a new
flow that drives the real UI through two chained ellipses (window swap, then category swap). 9
REGRESSION_LEDGER entries (2026-07-12).

Accepted limitations (recorded, not fixed): memory is ONE turn — an intervening `unknown`
answer carries no intent, so a typo'd follow-up clears the frame. No comparison intent
exists, so "compared to last month?" answers a lone figure rather than a comparison. The
open-vocabulary merchant tail survives: "what about my 401k?" still reads as a merchant and
answers "No spending at 401k this month" — a self-disclosing $0, never a wrong figure, and
byte-identical to what the shipped parser already does for "how much did I spend at 401k". A
denylist can only cover what someone thought of; the honest fix (require the merchant to exist
in the user's own transactions) would put a data read inside a pure engine, so it waits for a
deliberate design. It is at least observable now — the ledger records it as
`frame:merchant_spend` instead of swallowing it. "same for Amex" deliberately abstains: #168
established that payment methods are not merchants, and the frame reuses that guard rather than
contradicting it.

## Wave 4.2 slice 8: full-surface household hostile critic (#221) — HOUSEHOLD MVP COMPLETE

Three FRESH-CONTEXT Fable critics ran in parallel over T1–T12 (A: membership/authz state
machine; B: read-visibility + mutation boundary with an exhaustive fetcher/action inventory;
C: money surfaces with hand-verified fixture arithmetic). Verdict: **0 P0, 7 P1, 10 P2** —
every P1 and every actionable P2 fixed and regression-locked in one cycle (cycle 1 of the
4-cap). The authz state machine and the mutation boundary survived every attack (TOCTOU,
double-accept, enumeration, repair races — critic A found zero P0/P1); the money math itself
was hand-verified correct. The P1s all lived at the COMPOSITION boundary: household scope
bolted onto surfaces whose copy/disclosure assumed "everything on screen is yours" — the
disease slice 7 cured in the digest email only. Fixed: in-app partner dues now render
owner-attributed on the reminders card and /cards (new HOUSEHOLD_COPY keys, exhaustive-scanned
+ partner-due-banned); the household headline reads "across <household>" (a partner's autopay
drafts THEIR account — attribution fixed, number deliberately untouched, DECISIONS #221);
digest `sharedAccountCount` ends the loan-only "no accounts are shared" false disclosure;
interactive household scope now DISCLOSES currency-withheld partner accounts (#135 stance)
and filters their orphan dependent rows from the merge; the calendar owner-labels partner
events; the cron digest degrades household→personal atomically and audited, never to silence.

Inherited F5 CLOSED (T9(b)): same-real-account-connected-twice is now DETECTED
(`detectHouseholdDuplicateAccounts` — #192 signals with the same-provider skip relaxed to
same-provider-AND-same-owner) and DISCLOSED on the scope toggle (dashboard/cards/calendar)
and in the joint digest. Advisory by decision: figures are NOT auto-adjusted (heuristic false
positives; silently dropping a real account is worse than a disclosed double-count) — a
fail-old test locks the merged snapshot still containing both twins. Hardening: T8 export
lock added (the promised household fixture existed for every invariant but this one);
T10's visibility half now asserted, not assumed; deleteMyData reaps a now-memberless
household (ghost-household invite redemption closed); deleteCustomCategory's re-file is
owner-scoped (defense in depth); empty-string display names can no longer strand a partner
account unlabeled (`name || email` / `|| 'Partner'`); sanctioned share-predicate sites
indexed in household-authz.ts.

Gate (real 2026-07-12): `bash scripts/verify.sh` with `VERIFY_E2E=1` → **✅ VERIFY GREEN,
exit 0**: tsc clean · eslint clean · `npx vitest run` **2391 unit / 180 files** (+36 this
slice) · `npx next build` clean · Playwright **104/104 passed at the configured 4 workers**
(the local contention flake did not fire this run). 8 REGRESSION_LEDGER entries (2026-07-12).

Accepted limitations (recorded, not fixed): the household-scope shortfall/transfer
recommendation still projects every merged due against the viewer's own funding account —
the §4.4 v1 model, now disclosed by the extended scopeAssumptions autopay sentence; a
deeper per-owner projection is future work. An invite from a member who later departs stays
redeemable into the household (standard team-invite semantics; the code factor still gates —
critic A-F3, recorded in DECISIONS #221). The cross-owner identical-balance duplicate signal
can false-positive on two genuinely different same-balance accounts — tolerable because the
disclosure is advisory and self-explaining. Component-level headline attribution (F-3) is
wired but has no component test (no React test harness in this repo); covered by copy scan +
tsc + build.

## Wave 4.2 slice 7: joint household digest (#220)

A household member with a LIVE partner now receives ONE household-scope weekly
digest instead of the personal one (owner decision #201(b)): dues computed at
household scope through the slice-4 merge, a shared-account movement summary, and
the §4.4 assumptions copy inline. New pure engine `src/lib/engine/household/digest.ts`
(`summarizeSharedMovement` — inclusive window; excludes transfers, split parents and
PENDING, the same exclusion set as coach/radar, so a shared total can never disagree
with the register). New Prisma-only server read `src/server/household-digest.ts`
(keeps NextAuth out of the cron import graph, the `household-finance.ts` precedent).
`buildWeeklyDigest` takes an optional `household` field; without it the personal
digest is byte-identical to pre-slice-7 (T6, deep-equality locked). The household
copy guardrail scan is now EXHAUSTIVE over `HOUSEHOLD_COPY`'s keys, so no household
string can ship unscanned. Dedup key deliberately unchanged (`weekly_digest:<monday>`),
so a household join/leave mid-week can never produce a second digest that week.

Deliberate DEVIATION from a literal reading of #201(b) (DECISIONS #220): the joint
email is composed PER RECIPIENT rather than as one byte-identical message. Household
scope is viewer-relative by §4.4's own definition ("your accounts + accounts your
partner has shared"), so one identical email could only be built by leaking a
partner's unshared accounts (T1) or by dropping the personal Money Review entirely.
The one genuinely symmetric section — shared-account movement — IS identical in both
inboxes.

Fresh-context Fable hostile critic (independent agent): cycle 1 **FAIL — 1 P1 + 6 P2**,
all addressed. The P1 was real and is the reason this slice needed a critic: joint dues
rendered a PARTNER's card through the personal, second-person `reminderLine` — "B Shared
Card: $600.00 due — you'll pay $600.00 yourself", and in the autopay variant "just keep
the funds in your account" (the wrong account entirely). It told one partner they must
personally pay the other's bill and invited a double payment. Partner-owned dues now
render through `HOUSEHOLD_COPY.digestPartnerDue`: owner-attributed, stating whose account
it sits on, ending with "Aimplifi doesn't decide who pays". The owner-label map covers
shared accounts of EVERY type (a shared LOAN reaches the digest via `loanObligations` and
would otherwise have fallen through the same false line). `reminderLine` now documents its
precondition (it may only render an account the RECIPIENT owns), and the banned phrasings
are locked by `PARTNER_DUE_BANNED` in the copy guardrail. P2s fixed: a currency-withheld
shared account is now COUNTED and DISCLOSED rather than silently dropped (#135 stance);
EDGE_CASES gained a §Household Digest Movement block with the hand-verified fixtures; the
#220 rationale was corrected where it overstated its own case (private-card *reminders*
have independent coverage via the reminders cron — the binding constraint is the Money
Review, not missed payments).

Gate (real 2026-07-12): `npx tsc --noEmit` clean · `npx eslint .` clean · `npx vitest run`
**2355 unit / 180 files** (+36 this slice) · `npx next build` clean · `npx playwright test
--workers=1` → **104/104 passed**. Every gate component is green on this tree. The one
caveat, stated plainly: e2e is green at ONE worker; at the configured 4 workers this machine
is oversubscribed and fails one or two rotating tests per run — including on clean HEAD with
this slice stashed. See the flake note below.

Known limitations (accepted): "both partners receive it" is a default, not a guarantee —
a member owning ZERO accounts is skipped by the sweep's no-accounts guard (resolvePaymentAccount
throws on an empty snapshot), and a member with no review and nothing due gets no email that
week (household movement is deliberately never a send trigger, parity with the receipts
tally). Inherited and NOT fixed here (critic F5, routed to slice 8): if two partners each
connect the SAME real bank account via different providers and both share it, nothing dedupes
it — the #192 detector's input is each owner's OWN account set — so movement and dues
double-count, and the digest is the first surface to mail that doubled number.

## E2E gate: local 4-worker contention, 2026-07-12 (NOT a slice-7 regression) — DIAGNOSED

At the configured `workers: 4`, the full local e2e step fails one or two DIFFERENT tests per
run on this machine, rotating across `settings-dials`, `budget-targets` and `phase4-features`
(goals) — the last two are the very tests named in `docs/lessons/ci-e2e-timing-flake.md`.

Root cause, proven: **`npx playwright test --workers=1` → 104/104 green** on this exact tree,
same machine, minutes later. Four Chromium workers on a desktop that also has the user's
browser open oversubscribes the box; pages hydrate late and whichever test touches a slow page
that run is the victim. Two further controls: a full `verify.sh` on **clean HEAD with slice 7
stashed** ALSO failed (`phase4-features.spec.ts:33` goals, 60s `locator.click` timeout), and a
standalone 4-worker run on the slice-7 tree passed 104/104 once. Nothing in the slice-7 diff
(cron digest route, digest engine, household copy, reminders docstring) imports or renders any
of those pages.

`playwright.config.ts` keeps `workers: 4` deliberately (single-writer SQLite harness), so no
config change was made — `--workers=1` is the local diagnostic, and CI's runner is unaffected.

One symptom deserves naming because it looks like a data bug: `settings-dials` failed twice
with a CORRUPTED persisted value (`Travel, Dining Out, ClimbingTravel`) that survived a
reload. Under contention Playwright's `fill()` lands mid-hydration; on a navigation assertion
that surfaces as a timeout, on a form it surfaces as a mangled value. Same cause, different
symptom — see `docs/lessons/e2e-dials-value-corruption-flake.md`. If that spec ever fails
with the same signature at ONE worker, or while clean HEAD passes, it stops being contention
and becomes a real `mutation-form-recipe.md`-family bug worth diagnosing.

CI (GitHub Actions) remains the arbiter for e2e per the lessons ledger. `gh` is not
authenticated in this session, so the CI verify run for commit `dbb2914` is UNCONFIRMED here
and is the one thing worth an owner glance.

## Wave 4.2 slice 6: partner categorization on shared accounts (#219)

`recategorizeSharedTransaction` (`src/server/household-actions.ts`) is the
entire partner-write surface on shared data (HOUSEHOLD_ARCHITECTURE §6.1,
owner decision #201): one-off only (no scope param), system categories only
(never a custom, either side's), no "Always" rule, no batch, Correction
attributed to the acting user, `CategoryPrediction.labeledAt` never touched
(per-user Brier tuning #190 stays single-teacher). Authorization is re-derived
from a live DB read inside the serializable transaction rather than trusted
from the pre-transaction `requireViewer()` snapshot, closing a TOCTOU window
on a concurrently-removed viewer. `SharedTransactionList` is now interactive
(one-off recategorize picker, system categories only) instead of read-only.

Fresh-context Fable hostile critic (dispatched as an independent agent): cycle
1 FAIL — 2 P1 + 7 P2, all fixed before re-verify. P1s: (1) Plaid's
pending→posted correction-transplant `where` clauses (4 sites) were scoped by
the syncing owner's userId, so a partner's correction was silently stranded on
the deleted predecessor id and reverted by the next re-sync — fixed by scoping
the transplant to `transactionId` only; (2) the action accepted non-scalar
input and audit-logged the raw input rather than the in-tx-resolved row — both
now guarded. P2s: `ensureCategories()` FK-safety call; the
`needsReview`/`confidenceBps`/`reviewPinned` write is now explicitly
documented as intentional parity with the owner's `applyCategory`; audit meta
carries `accountId`/`ownerUserId`; `undoCorrections` now checks transaction
ownership before writing an inverse Correction (closes a latent "reverted"
audit-lie for a shared-account correction — unreachable via any UI today, but
now structurally closed); the T3 grep-lock counts `correction.createMany` too
and the component is banned from importing `@/server/triage-actions` at all.

Gate (real 2026-07-12): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — tsc/eslint clean, **2319 unit / 179 files**, build clean, **104
e2e**. Known limitations (accepted): no two-browser partner-recategorize e2e
(same accepted gap as slice 2/3 — a single Playwright session has no second
signed-in identity to invite/accept within one run); behavior is proven at the
integration level instead (`tests/unit/household-shared-txns.test.ts`,
`tests/unit/learn-loader.test.ts`, `tests/unit/sync-preserves-corrections.test.ts`).

## Wave 4.2 slice 5: cards/calendar household scope + copy audit (#218)

`/cards` and `/calendar` now accept the same `?scope=mine|household` contract
as `/dashboard` (TASKS 4.2 slice 5): `getDashboardData`/`getCashNeeded` both
resolve the viewer's household unconditionally and return `household`/`scope`
so a page can decide whether to offer `HouseholdScopeToggle` — generalized
with a `basePath` + `extraParams` prop (calendar carries `month` through both
scope links, so paging months no longer silently resets scope to `mine`).
Card ownership: a `cardId → ownerLabel` map is built server-side in
`getDashboardData` from each partner's pre-merge slice (no owner field added
to `CardObligation` — the engine stays free of any user concept);
`CardsBreakdown` badges partner cards with it. Cross-app copy audit: every
household disclosure/consent string across settings, `household-card`,
`household-sharing-card`, `shared-transaction-list`, and the scope toggle was
extracted verbatim (no wording changed) into `src/lib/copy/household-copy.ts`
and is now scanned by `tests/unit/household-copy.test.ts` against the same
guardrails as `coach-copy.test.ts` (zero shame language, every disclosure
states what is/isn't shared) — previously this copy was inline JSX and never
guardrail-scanned. All existing strings passed unchanged.

Gate (real 2026-07-12): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — tsc/eslint clean, **2305 unit / 179 files**, build clean, **104
e2e** (+1: slice-5 T6 golden-safety lock on `/cards` + `/calendar`).

## Wave S: S.3 docs-lint script (#217)

`scripts/docs-lint.ts` — zero-model-call check over every tracked `*.md` file for
unallowlisted "Pulse" mentions, hardcoded test-count claims outside docs/STATUS.md,
missing `> HISTORICAL` archive banners, and stale verify-command phrasing. Ledgers
(DECISIONS/DECISIONS_INDEX/STATUS/PROGRESS/REGRESSION_LEDGER/TASKS) and anything
already bannered HISTORICAL are exempt (frozen records). `npm run docs:lint`; a
non-gating `continue-on-error: true` step runs it in CI alongside (not inside) the
required verify job.

Gate (real 2026-07-11): `bash scripts/verify.sh` → **VERIFY GREEN** —
tsc/eslint clean, **2285 unit / 178 files**, build clean. `docs:lint` itself: 0
findings across 49 markdown files (confirms S.2 D1–D8 holds). Known limitations
(accepted): warning-only by design (see DECISIONS #217 rationale); allowlists are
named per-file/per-string rather than a general heuristic, so a genuinely new
leak in an unlisted file would still be caught, but a new *legitimate* historical
reference in a not-yet-exempted doc will false-positive once and need a one-line
allowlist addition.

## Wave 4.2 slice 3: Shared transactions in the register (#213)

`getSharedTransactionsView()` SEPARATE from `getTransactions` (§4.5); scoped
`categoryNamesByIds` (never a `getCategoryMeta` widening — F3); read-only
`SharedTransactionList` on /transactions (owner badge, no triage affordances);
consent copy updated. Locks T1/T2/T3/T4/T6 + F3 + personal-register isolation.

Gate (real 2026-07-10): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2271 unit / 177 files**, build clean. Targeted e2e
household.spec **4/4** (demo golden-safety on settings/accounts/transactions +
member-state share round-trip + axe). Known limitations (accepted): shared
section capped at 100 most-recent (truncation disclosed; no pagination yet);
shared rows not filterable via the personal register filters; no member-state
e2e for the shared-txn DOM (integration covers the data path; two-browser
partner round-trip deferred).

## Wave 4.2 slice 2: Household account sharing (#212)

`partnerIdsOf`/`partnerSharedAccountsWhere`/`visibleAccountsWhere` in authz.ts
(§4.3 central helpers; EXACT `{ userId }` degeneracy deep-equality-locked, T6);
`getAccountSharingView()` as a SEPARATE query path from `getAccountsView`
(#192/T9 detector-input constraint, unit-locked with a provably trip-worthy
twin); `setAccountShared` (owner-only row scope, self-guarding ON-write,
audited); `HouseholdSharingCard` on /accounts (member-only render).

Fresh-context Fable critic cycle 1 FAIL (1 P1 + 3 P2) → all fixed in-cycle +
re-verified. P1: setAccountShared(ON) vs leave/remove race could strand a
consentless flag that would auto-share into the user's NEXT household — fixed
both sides (membership re-checked inside the ON-write's own where; join paths
reset the joiner's flags atomically; both locked by tests). P2s: consent copy
states the full disclosure; owner's toggle list not currency-filtered (consent
must always be visible/revocable); member-state e2e (real signup → household →
share round-trip → axe AA at 380px). Known limitations (accepted, DECISIONS
#212): partner account ids ship to the client (all actions userId-scoped);
no rate limit on the toggle (matches declineInvite; self-scoped); slice-3+
surfaces composing `partnerSharedAccountsWhere` must replicate the currency
guard where money aggregation demands it (partner-side /accounts display does).

Gate (real 2026-07-10, post-critic): `bash scripts/verify.sh` → **✅ VERIFY
GREEN** — tsc/eslint clean, **2263 unit / 176 files**, build clean. Targeted
e2e household.spec **3/3** (demo golden-safety absence + member-state real
share round-trip + axe WCAG-AA).

## Wave 3.2: weekly self-audit Critic (#211, TASKS 3.2)

Additive `SelfAuditSnapshot` + pure bps rates + `/api/cron/audit` (Mon 15:00)
+ AI-trust `SelfAuditMetrics`. Review = triage queue snapshot; unknown =
UnknownQuestion window; alert act = NotificationSent vs engagement proxy
(radar/connection). No money fields.

Gate (real 2026-07-10): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2248 unit / 175 files**, build clean (incl. `/api/cron/audit`).
Known limitations (accepted): (1) alert act-rate is a proxy until 3.5; (2)
unknown denominator is parser-unknown attempts only; (3) empty until first cron
fire (demo shows empty-state copy).

## Wave 4.2 slice 1: Household membership core (#210)

Schema (3 tables + inert `Account.sharedToHousehold`), pure membership engine,
`requireViewer()` lazy-repair self-heal, the 7 actions, /settings Household card.
Fresh-context Fable critic cycle 1 FAIL (1 P1 + 3 P2) → all fixed in-cycle +
re-verified (demo-user guard; enumeration-safe gate order; serializable accept
claim; sticky declines). Known limitations (accepted, documented in DECISIONS
#210): dev-fallback invite-code salt when AUTH_SECRET is absent (demo-mode
zero-env rule; real deploys always have AUTH_SECRET); T11 concurrency locked by
determinism units + scoped-updateMany construction, not a true concurrent probe;
invite-existence timing oracle (cuid ids unguessable); ghost-household edge via
acceptInvite after a lost double-leave reap race (harmless — flags already
reset, accepter promoted at next read, still lazily reapable). Sharing UI +
`visibleAccountsWhere` are slice 2 — the flag exists but NOTHING reads it yet.

## Wave 3.1: EngagementEvent capture (#209, TASKS 3.1)

Additive `EngagementEvent` + closed-set validator + dashboard hooks
(viewed/dismissed/expanded/acted). First-party only; PRIVACY.md + Settings
AI-trust disclosure. **No read path** — layout unchanged until Wave 3.3.

Gate (real 2026-07-10): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2195 unit / 171 files**, build clean. Known limitations
(accepted): (1) deletion-preview counts omit these rows (ledger precedent);
(2) demo dashboard CTA taps append rows (inert for goldens); (3) `viewed` only
on return-moment (not every card mount — avoids write amplification).

## Wave 2.2: UnknownQuestion ledger (#208, TASKS 2.2)

Additive `UnknownQuestion` + pure `scrubQuestionText` + `recordUnknownQuestion`
on every parser-`unknown` Ask (rescued or not). Deterministic routes write
nothing. Money engines never read the table → golden-safe. PRIVACY.md discloses
scrubbed storage.

Gate (real 2026-07-10): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2189 unit / 169 files**, build clean. Known limitations
(accepted): (1) deletion-preview counts omit these rows (NotificationSent/
ValueReceipt precedent; cascade itself is complete); (2) demo Ask of gibberish
will append rows in the shared demo DB — not consumed by goldens; (3) no prune
cron yet (Wave 2.3 mining can add retention).

## Wave 1.7: personalized triage alternatives (#207, TASKS 1.7)

Soft hints for swipe-left: pure `deriveCorrectionHints` (same signature +
latest-wins + #44 sign guard as learned rules; threshold = 1; conflicts → no
hint). `suggestAlternatives(txn, { personalized })` merges base → personalized
→ generic (cap 3). Server: `loadCorrectionInputs` shared with learned rules;
`getTriageItems` / `getTriageGroups` pass hints. Demo/zero corrections → [] →
byte-identical golden. No schema. Numbered #207 because #206 was claimed by
value-receipts in a parallel session.

Gate (real 2026-07-10): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
**2179 unit**. Known-answer tests in `suggest-alternatives.test.ts`.

**Known limitations (accepted):** one consistent correction is enough to hint
(earlier than LEARN_THRESHOLD=2 auto-rules); conflicting categories for a
signature suppress the hint entirely (no majority vote).

## Wave 1.3: value-receipts ledger — "What Aimplifi caught" (#206, TASKS 1.3)

Append-only `ValueReceipt` (additive; `@@unique([userId,key])`) + pure
`engine/receipts`: amounts copied verbatim at catch time (reminder →
cashRequiredCents; radar → the alert's own coverTransfer amount; price
increase → monthlyCents). Minting: reminder/radar receipts ONLY on real
delivery (reminders/notify crons; channel-agnostic `payment_due` keys →
email+push mint one receipt per catch; ESTIMATED reminders mint nothing);
price receipts keyed on the PRICE TRANSITION
(`price_increase:merchant:from>to`, from/to/changedAt threaded onto
price-increase Opportunities) and minted where the flag is actually surfaced
(/coach render; digest cron only after a real send). Surfaces: /coach
`value-receipts-card` (hidden until the first catch) + a digest tally via the
SHARED `receiptLines`; the digest null-rule is unchanged (a tally alone never
triggers a send). Honesty is structural: the summary is per-kind counts/totals
only (no cross-kind dollar field exists in the type) and a coach-copy test
bans "saved you / earned you" phrasing — the tally counts what was SURFACED,
never outcomes.

**Hostile critic (fresh-context Fable, refute-by-default): cycle 1 = 0 P0/P1,
4 P2 — all fixed in-cycle:** digest price-mint was not delivery-gated (now
mints only after a real send); price keys were detection-date-anchored and
re-mintable under re-import churn (now transition-anchored); estimated
reminder amounts entered the permanent tally unmarked and could double-mint
when the real statement's due date differed (estimates now mint nothing —
undercount-safe); PRIVACY.md omitted the new table (now discloses ValueReceipt
AND the pre-existing NotificationSent). P3 fixes: seed→opportunity threading
lock in insights.test; redundant `@@index([userId])` dropped.

**Known limitations (accepted, documented):** (1) radar catches count only on
actual push delivery — a user with no push subscription accrues none even if
the dashboard showed the warning (honest: nothing was proactively delivered);
(2) the mocked-provider unit cron tests sweep every user in the vitest DB, so
its demo user can accrue receipt rows — test-DB residue only, reseed clears,
the e2e golden DB untouched; (3) receipts are append-only history — later
renames don't rewrite recorded labels (by design); (4) deletion-preview counts
omit receipt rows (NotificationSent precedent; the cascade itself is complete);
(5) a non-P2002 receipt-write error in the notify loop defers that user's
remaining pushes to the next sweep (contained by the per-user try).

Gate (real 2026-07-10, post-critic): `bash scripts/verify.sh` → **✅ VERIFY
GREEN** — tsc/eslint clean, **2170 unit / 166 files** (receipts engine 17 +
receipts-server integration 7 + digest/coach-copy/cron/insights additions),
build clean. Targeted e2e: phase3-coach (incl. new "1 catch … $2.50/mo" demo
assertions + reload idempotency) **1/1**, payment-reminders + notifications
**6/6**, phase5-a11y + auth **10/10** (critic-run, WCAG-AA with the new card).

## Wave 1.4: savings-rate streaks + celebration copy (#205, TASKS 1.4)

Pure `computeSavingsStreak` over existing `MonthlyFlow[]` (bps, no floats).
COACH_COPY `savingsStreak` / `savingsPersonalBest` guardrail-registered.
`SavingsRateCard` shows streak (≥2 months) and personal-best lines.
Gate: verify ✅ (unit + coach-copy); phase3 e2e asserts streak or PB visible.

## Wave 0.3: Resend domain verified (#204) — 2026-07-10

Owner verified `aimplifi.app` in Resend (Vercel DNS) and confirmed a Delivered
test to `michael.lee.p@gmail.com`. Email + digest env path is live. Cron *fire*
still UNVERIFIED. Sentry remains deferred (#203).

## Wave 1.6: Glass-Box shareable snapshot (#202, TASKS 1.6)

Client-only redacted share from the open reconciled Cash-Needed Glass-Box
panel. Pure `redactTraceForShare` / `formatShareText` (amounts unchanged;
card names → Card N; notes stripped). UI copies text (+ best-effort PNG via
Canvas 2D, no html2canvas) — no network. Share hidden when `!reconciles`.
Gate: verify ✅ **2117 unit / 163 files** (+4/+1); glass-box.spec share case.

**Privacy note:** Opus privacy review still recommended (TASKS routing) —
inline check: no server path, share-target excludes live labels, clipboard
fallback downloads .txt only.

## Wave 4.1: household architecture spike — decision doc landed (#200) — 2026-07-10

`docs/HOUSEHOLD_ARCHITECTURE.md` (DECISIONS #200): household entity + explicit
membership (one household per user in v1) + per-account, owner-consented,
**read-only** sharing (`Account.sharedToHousehold Boolean @default(false)`), NOT
a tenant layer. No existing action's authz changes; one central
`visibleAccountsWhere` helper; joint cash-needed via query-scoped
`getSharedSnapshotSlice` + pure `mergeSnapshots` (engine untouched); deterministic
lazy-repair lifecycle; invite = hashed out-of-band code + DB-row email match.
Docs-only — **no schema/product code shipped**; three tables + one Boolean are
DESIGNED, not pushed. Fresh-context Fable hostile critic: cycle 1 **FAIL (5 P1,
5 P2, 1 P3)** — all confirmed real (deletion-transaction promotion structurally
impossible; Household orphan on owner deletion; `getCategoryMeta` widening
contaminating six personal surfaces; invite trust on unverified email + dormant
allowlist; merge filtering a full cross-user snapshot in memory) — all fixed in
the doc, cycle-2 self-check no open P0/P1. Invariants T1–T12 each mapped to a
future locking test; 6-slice MVP plan recorded in TASKS 4.2.

Owner answered all three open questions same day (DECISIONS #201): partner
categorization YES (slice 6, single-teacher boundary — one-off recategorize,
acting-user corrections, no partner rules, no prediction labeling, Fable
critic); ONE joint household digest (slice 7); naming "Household". Slice plan
is now 8 slices; design fully unblocked for TASKS 4.2.

Gate (real 2026-07-10, docs-only — no source touched): `bash scripts/verify.sh`
→ **✅ VERIFY GREEN** — tsc/eslint clean, **2113 unit / 162 files**, build clean.

## Wave 1.5: route-specific empty states (#199, TASKS 1.5)

Zero-account coach/goals/calendar no longer show the shared dashboard welcome.
Extracted `ConnectOnboardingPanel` (same SimpleFIN/Plaid/CSV/manual testids);
`EmptyCoach` / `EmptyGoals` / `EmptyCalendar` keep route `<h1>` + dashed card
framing. Dashboard/cards/etc. still use `EmptyDashboard`. Gate: verify ✅
**2113 unit / 162 files**; auth.spec 3/3 + guided-onboarding 1/1.

## Wave 0.3: production env activation (partial, #198) — 2026-07-10

Linked local checkout to existing Vercel project `reiforge/aimplifi`
(`prj_Zr3x9TKUklr2LRswwc1rqZR4lcRO`); prod already live at https://aimplifi.app
(Neon `DATABASE_URL` + `AUTH_SECRET` + `DATA_ENCRYPTION_KEY` + Plaid + `XAI_API_KEY`
were already set — this was never a greenfield deploy).

**Added to Production (2026-07-10) and redeployed** (`dpl_7h8vU7LeEWoiUPjzLEH3N7aJGd9T`,
READY, aliased to www.aimplifi.app):
- `SIGNUP_ALLOWLIST=michael.lee.p@gmail.com` (owners still always allowed via
  baked `OWNER_ALLOWLIST` incl. lizysuh55@gmail.com — DECISIONS #60)
- `CRON_SECRET` (generated)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT=mailto:michael.lee.p@gmail.com`

**Still missing (owner keys — cannot invent):**
- ~~`RESEND_API_KEY`~~ **SET 2026-07-10** (redeployed). Default From =
  `Aimplifi <reminders@aimplifi.app>` — confirm that domain/sender is verified
  in the Resend dashboard or mail will fail at send time.
- ~~`SENTRY_DSN`~~ **DEFERRED by owner (#203, 2026-07-10)** — personal/family
  app; paid error tracking not wanted for now. Dormant client stays in place;
  activate later only if needed.

**Seed recommendation: DO NOT run `prisma db seed` / `--force-prod`.** Owner
account is already active on the live Neon DB; seed deletes every row.

**Cron fire verification:** schedule is in `vercel.json` (4 jobs); bearer secret
now set. Actual Vercel Cron invocations = UNVERIFIED until a scheduled run is
observed in Vercel logs (or a manual bearer-authenticated probe). Requires
Vercel Pro for weekly digest + 4-cron count (Hobby is daily-only / 2-cron).

See DECISIONS #198.

## Wave 1.2: contextual Ask follow-up chips (#197, TASKS 1.2)

After every non-unknown Ask answer, up to 3 contextual follow-up chips
(static intent→full-NL-question map). Pure `engine/assistant/follow-ups.ts`
(`followUpQuestions`); server merges onto `answer.suggestions`; UI reuses
existing chip plumbing (`ask-follow-up`). No new parsing — every chip is a
complete question the existing parser already routes. `unknown` keeps
`ASSISTANT_SUGGESTIONS` from `answerUnknown`.

Gate (real 2026-07-09): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2113 unit / 162 files** (+4/+1: assistant-follow-ups),
build clean. Targeted e2e `ask.spec.ts` **9/9** (incl. new follow-up chips
re-ask → Costco biggest-purchase). See DECISIONS #197.

## Wave 1.1: return-moment "Since you were away" greeting (#195, TASKS 1.1)

First Wave-1 (return-loop) slice and the audit's highest-impact idea (idea 3,
impact 9): a returning user after a >7-day gap is greeted with a short story of
what happened while away, instead of being punished with a backlog (audit
persona E). Composes FOUR already-computed pieces and originates no number.

Pure composer `engine/return-moment/build.ts` (`buildReturnMoment`), mirroring
`buildWeeklyDigest`: takes `daysSinceLastSeen` + the four pieces and returns a
structured `ReturnMoment | null`. Null for a first-ever visit
(`daysSinceLastSeen === null`) or a gap of ≤ 7 days; a quiet return still greets
honestly (radar `clear`, zero counts) — the reassurance is the point. Every
value is copied verbatim: radar clear/warning from the tested `RadarResult`,
auto-filed count from a userId-scoped `CategoryPrediction` query, price bumps
from `findOpportunities` (`kind:'price-increase'`), and one guardrail-scanned
sentence from `MoneyReview.improvement`. No cents are formatted in the engine
(formatCents stays a UI-boundary concern).

Additive nullable schema `User.lastSeenDate String?` — a CALENDAR DATE (the
provider's "today"), not a timestamp, per the date-discipline rule, so the gap
is TZ-free and lives in the same civil-date domain as every other business date.
Thin server `server/return-moment.ts` reads the stored date, measures the
civil-day gap (`daysBetween`), stamps today (only when changed → no write
amplification; short-circuits the count query below the threshold), and — on a
real return — counts silently auto-filed predictions (`confidenceBps >=
AUTO_SILENT_BPS`, `createdAt >=` the previous visit's midnight-UTC) then calls
the engine with the page's ALREADY-fetched `coach.review` / `coach.opportunities`
/ `radar.radar` (no re-fetch, no new money math). The dismissable
`ReturnMomentCard` (which also self-retires once the visit stamps today) renders
directly under THE cash-needed answer.

Golden/demo-safe by construction: no engine reads `lastSeenDate`, and the
fixed-today demo user's every stamp equals the last → gap always 0 → no card.
Maker→Checker (proportionate inline pass — display-only surface + a benign
last-seen write; no money/authz/routing): no P0/P1. Accepted P2s (documented):
the auto-filed `since` boundary is midnight-UTC-approximate (a count, not money —
errs toward inclusion); the card's own copy is not yet in the guardrail-scan set
(trends-copy precedent); and the positive card RENDER is not browser-tested —
proven by the engine + integration tests, since the shared fixed-today demo user
can't seed a >7-day gap without racing the auto-stamp (the #192/#183 "positive
path by integration, demo shows nothing by e2e" precedent).

Gate (real 2026-07-09): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — tsc/eslint clean, **2109 unit / 161 files** (+17/+2: 9 known-answer
engine — gate boundary, verbatim copy, honest-empty, no-mutation — and 8
real-`getReturnMoment` integration — first-visit/active/7-day-boundary/10-day
return/no-double-greet/silent-band count/price-increase filter/radar warning),
build clean, **95 e2e** (+1: demo golden-safety — dashboard renders, no greeting,
holds across a reload).

## Wave 0.1: CI arbiter confirmed GREEN (owner-verified, 2026-07-09)

GitHub Actions had been **disabled** for the repo — which is why no run appeared for
#181 (the `.github/workflows/verify.yml` file was correct and pushed all along; #193
diagnosed this). The owner enabled Actions; the `verify` workflow run **#15**, triggered
by the #194 push, was **owner-confirmed GREEN** on the clean `ubuntu-latest` runner —
the first confirmed CI pass of `scripts/verify.sh` (typecheck + lint + unit + build +
full e2e). Significance: CI is now a real arbiter, the single-machine-loss risk (TASKS
0.1) is retired, and because a headless Linux runner has no OS display scaling, a green
CI e2e also independently confirms the mobile-380 viewport artifact is Windows-local
(not an app bug). Any future red CI e2e is therefore a real failure, not the flake.

## Wave 0.5: operator activation-checklist panel on /settings (#194, TASKS 0.5)

An operator-facing "Activation checklist" card on /settings that reads env-var
**presence** only (never values) and shows which dormant systems are live vs dormant,
with the exact env-var **names** still needed for each dormant one. Answers "on this
deployment, is email/push/digest/Sentry/cron actually going to fire?" at a glance.

Pure engine `engine/ops/activation.ts` (`buildActivationChecklist` + `activationSummary`):
takes four presence booleans (cronSecret / email / push / errorTracking) and returns a
fixed-order 7-row map — base capabilities (error-tracking, email, web-push,
scheduled-jobs) then the composed delivery jobs (payment-reminders, weekly-digest,
push-notifications). "Live" is honest about **compound** gates: a delivery job is live
only when BOTH its `CRON_SECRET` bearer AND its provider are present — the same two-part
gate the cron routes encode. The engine reads no `process.env` (booleans in), so it is
deterministic, unit-testable, and cannot leak a value.

The server component (`/settings/page.tsx`, an RSC) supplies the booleans via the three
existing `*Configured()` helpers (`emailProviderConfigured`/`pushProviderConfigured`/
`errorTrackingConfigured`) plus an inline `!!process.env.CRON_SECRET`, and renders the
derived rows inline — only booleans and env-var **names** cross into the markup; no secret
value ever reaches the client (Next inlines only `NEXT_PUBLIC_*`). Shown to all signed-in
users (invite-only app, no admin role) — acceptable operational transparency, no value
disclosed. Maker→Checker (proportionate: display-only, no writes/money/schema): no secret
path, compound gates correct, a11y status conveyed by text not color, no P0/P1.

Gate (real 2026-07-09): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2092 unit / 159 files** (+7 known-answer: all-off/all-on/partial
compound + secret-free-names invariant + summary counts), build clean, **94 e2e passed**
(+1: renders all 7 rows, engine↔UI coherence — summary count equals Live badges — dormant
rows advertise only known env names, axe WCAG-AA scoped to the card). The e2e asserts
coherence, not a hard "0 of 7", so it holds both in CI (all dormant) and locally where
`.env.local` may set some keys.

## Wave 0.2: local full-e2e unblocked — the "mobile-380 flake" was a masked deterministic bug (#193)

Task 0.2 was scoped as "quarantine the mobile-380 viewport flake so local `VERIFY_E2E=1`
can exit 0." Investigation found the premise was wrong: the recurring "full e2e can't
exit 0 on this Windows machine" (reported across #183/#186/#187) was **not** the viewport
flake — it was a **deterministic** `auth.spec.ts` failure hiding behind that attribution.

Root cause: #182 ("Sign out of all devices" / multi-device session revocation) added a
button (`revoke-sessions-submit`) on /settings whose accessible name **contains** "Sign
out". `auth.spec.ts` ends its nav loop on /settings, then clicked a bare
`getByRole('button', { name: 'Sign out' })` → Playwright **strict-mode violation** (2
matches), on **every** run. #182 landed after auth.spec's last edit (#175) and never
updated the now-ambiguous locator; the red gate was then written off as the known flake
in three subsequent sessions. Fix: scope the click to the header form
(`getByTestId('sign-out-form').getByRole('button', { name: 'Sign out' })`) — a **test-only**
one-line change (the revoke button keeps its own render coverage in
`account-deletion.spec.ts`; no product code touched).

**No quarantine was needed.** Across three full `mobile-380` suite runs this session the
viewport-interception flake did not reproduce (0 `intercepts pointer events` failures) —
likely defused by the #187 nav redesign and/or Playwright 1.60.0. The lesson file is kept
(intermittent flakes can recur) but annotated with this correction and a "read the error
signature before blaming the flake" rule. Standing assumption is now: **full e2e exits 0
here.** Maker→Checker: test-only, no golden/money/schema surface; verified no other spec
carries the same bare `Sign out` locator (grep: only auth.spec, now scoped).

Gate (real 2026-07-09): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2085 unit / 158 files**, build clean, **93 e2e passed** (first time the
full gate incl. Playwright exits 0 on this machine). Two prior full runs same session: one
green, one green-but-for the deterministic auth failure this fixes (0 viewport failures in
either).

## Wave 1.8: cross-provider duplicate-account guard (#192, DECISIONS #192)

Answering the owner's "is running both Plaid and SimpleFIN redundant?" surfaced a real
data-integrity gap: the app has **no cross-provider dedup**. Plaid, SimpleFIN, and manual
entry each mint their own `Account` row, and transaction dedup is
`@@unique([accountId, providerRef])` — scoped to one account and one provider's id scheme.
So the SAME real account connected through two providers is stored twice and its
balance/transactions double-count in net worth, spending, and cash-needed (verified against
the ingest + `netWorthSeries` paths — no code matches a Plaid account to a SimpleFIN one).

Shipped an **advisory** guard: pure `engine/account/duplicates.ts` (`detectDuplicateAccounts`)
flags cross-provider pairs sharing account `type` + `currency` with ≥1 signal — matching
last-4 (high), identical non-zero balance (high), or a shared distinctive name token (medium);
`demo`/seed rows never compared; zero-balance token-less pairs never flagged. Surfaced as a
**display-only** amber `role="alert"` card on /accounts (`duplicate-accounts-warning`) — it
never auto-deletes (which side to keep is the user's call; they disconnect via existing flows),
computed over the currency-guarded `supported` set so it never references a hidden row.
Matching is heuristic by necessity (SimpleFIN carries no mask → no exact cross-provider key).

Maker→Checker self-review (data-integrity display surface, non-destructive — proportionate to
an inline hostile pass, not a multi-agent workflow): confirmed golden-safety (demo user is
single-provider → zero pairs, integration-tested); no false positive on same-provider pairs
(Plaid dedups within itself), different type/currency, or zero-balance empties; advisory-only
so a false positive costs a dismissible card, never data loss. Accepted limitation (documented):
purely heuristic — a user with two genuinely different accounts at the same bank with a shared
name token gets a `medium` false-positive warning (safe: advisory, and the reason string shows
exactly why); and two same-institution accounts renamed with no shared token + different
balances would be missed (`low`-signal false negative). Both are acceptable for a warning.

Gate (real 2026-07-09): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — tsc/eslint clean,
**2085 unit / 158 files** (+14/+1: 12 known-answer engine + 2 real-`getAccountsView`
integration incl. the demo-user=0 golden-safety control), build clean. No new Playwright spec
(the demo user shows no warning by design; the positive path needs throwaway cross-provider
rows, which the integration test drives against the real server view — the account-deletion
precedent for a destructive/data-shaped flow proven by integration rather than browser e2e).

## Wave 0.4: live provider spot-checks — Plaid VERIFIED, SimpleFIN re-confirmed (#191)

Ran the two provider validators live from the dev machine (egress to the providers
is open here; sandbox creds are in `.env.local`).

- **Plaid sandbox** (`npm run plaid:validate`): `✅ VALIDATION PASSED` — 12 accounts
  (2 credit), 50 transactions with correct signs (5 outflow / 1 inflow in the newest-6
  sample), 1 statement from `/liabilities/get`; encrypted `PlaidItem` token stored
  (len 110); item + temp user cleaned up. Flipped `docs/PLAID_WALKTHROUGH.md` from
  **UNVERIFIED → LIVE-PATH VERIFIED** for the exchange / `/accounts` /
  `/transactions/sync` / `/liabilities/get` paths. Still UNVERIFIED (need a
  human/hosted step, not the headless validator): the browser Link UI and the live
  webhook round-trip.
- **SimpleFIN demo** (`npm run simplefin:validate <accessUrl>`): re-confirmed the
  `fetchSimplefinAccounts` → map path — 3 accounts, `"114125.51"` → `11412551` cents,
  Groceries categorized, outflow signs preserved. Already VERIFIED (2026-06-22); this
  re-confirms it. **Finding + fix:** the public demo *setup token* is single-use and
  was permanently consumed by the first claim (re-POST → `403 Forbidden (was it already
  claimed?)`), so `scripts/simplefin-validate.ts` now also accepts an already-claimed
  access URL directly (dev-script-only change; the claim step stays covered by the
  mocked-server unit test). Pass `https://demo:demo@beta-bridge.simplefin.org/simplefin`
  to re-run against the free demo.

Docs/dev-script only — no app/engine/money/schema code touched, so no golden moves and
no critic cycle (docs-only precedent #185). Gate below.

**Blocked in this environment (owner-only, credentials):** Wave 0.3 (Vercel + Neon env
vars, Sentry DSN — no `VERCEL_TOKEN`/`NEON_API_KEY`/CLI/`.vercel` link, `gh` unauth,
prod secrets in the Drive crash-backup folder) and Wave 0.6 (Neon scheduled backups —
Neon dashboard/ops). The code/config side of 0.3 is confirmed ready: `vercel.json` wires
all four crons (`sync`/`reminders`/`notify`/`digest`); `docs/DEPLOY.md` is complete.

## Post-Phase-5: Bounded per-user threshold tuning + live prediction log (#190, TASKS 3.6)

Pure engine (`categorize/tuning.ts`): per-user Brier over user-labeled predictions nudges
the AUTO_FLAGGED boundary ±500bps around 7000, ≥20 committed samples, recomputed from
scratch, one-sided auto-revert on recent-window regression; can never create a silent
filing (aiBadge stays pinned to the global AUTO_SILENT). Disclosed on the Settings
AI-trust panel. Critic F1 fixed in-cycle: live ingest never wrote CategoryPrediction
rows (seed-only), so the #177 accuracy panel and this loop were demo-ware — now all 4
ingest paths log the pipeline's verdict and predictions follow Plaid id churn like
Corrections. **Known limitations:** live committed labels are corrections-biased
(miss-heavy), so live tuning mostly tightens (safe direction) until an explicit
confirm surface gives it positive evidence; rows ingested before #190 have no
prediction rows (going-forward data only). Gate (real 2026-07-09):
`bash scripts/verify.sh` → **✅ VERIFY GREEN** — **2071 unit / 157 files** (+24:
tuning engine + pipeline opts 17, labeledAt lifecycle 3, live ingest log 4); build
clean. E2e (real, mobile-380): settings-dials + phase2-triage 8/8, transactions 16/16.

## Post-Phase-5: Prod error tracking — dormant Sentry (#189, Gap 6 §2)

Thin `lib/errors.ts` envelope client + `instrumentation.ts` `onRequestError` +
error-boundary capture. Dormant without `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`
(same stance as email/push). CSP widens ingest only when configured. Owner
activates by setting the DSN in Vercel (DEPLOY.md). Gate (real 2026-07-09):
`bash scripts/verify.sh` → **✅ VERIFY GREEN** — **2047 unit / 154 files**
(+8 errors.test); build clean. **Remaining Gap 6:** §4 Neon backups (owner/ops).

## Post-Phase-5: Desktop header Settings/Sign-out overlap (#188)

Owner report after #187: on desktop, Settings overlapped Sign out. Cause: nav
`flex-1` + 13 text links expanded into the Sign-out sibling. Fix: wrap +
`shrink-0` Sign out; e2e bbox lock at 1280×800. Gate evidence in the #188 commit.

## Post-Phase-5: Mobile More-sheet nav (DECISIONS #187, Competitive-Gap Gap 3 §2)

Owner authorized the long-gated mobile secondary-nav redesign. Phones no longer
show 8 unlabeled top icons — header is brand + labelled **More** + Sign out;
More opens a bottom sheet with a 2-col labelled grid (Plan/Reports/Accounts/
Investments/Activity/Goals/Spending/Settings) plus Explore (Ask/Trends/Recurring/
Forecast). Five primary bottom tabs unchanged (`bottom-nav-*` e2e intact).
Desktop text nav unchanged. Gate (real 2026-07-09): `bash scripts/verify.sh` →
**✅ VERIFY GREEN** — tsc/eslint clean, **2039 unit / 153 files**, build clean.
Targeted e2e (mobile-nav + spending-plan + reports + investments + phase4 +
not-found) **18/18**. Full `VERIFY_E2E=1` still can't exit 0 on this Windows
machine (mobile-380 flake — unrelated; new More path uses mid-header clicks).

**Remaining after #187:** env-gated live Plaid/SimpleFIN spot-checks; ~~Gap 6 §2
error tracking~~ **DONE #189**; Gap 6 §4 Neon backups; Gap 5 benchmark line;
mobile-380 Playwright infra fix. Mobile-nav redesign is **done**.

## Post-Phase-5: ROADMAP ALSO CONSIDER UX/a11y burn-down (DECISIONS #186)

Resumed on "push, then continue" after the #171–#185 stack landed on `origin/main`
(`cd77bad`). Opus/Sonnet-lane per COMPETITIVE_GAP_PLAN §3. A read-only audit found
six of the ten ALSO CONSIDER items already built (#81/#89/#90/#166) and left stale
in the plan — same hazard as #185. Shipped the four genuine remaining items
(display/copy only, no engine/schema/money math):

1. Spending-plan allocation legend (`spending-plan-legend`) under the four-segment bar.
2. Dashboard overspent reframe: header "Over plan" + amount "Over plan by $X".
3. Empty-register no-data vs no-match (`hasFilters` → branched `txn-empty` copy).
4. Budgets no-target first-run hint (`budget-no-targets-hint` when `budgets.length === 0`).

Docs reconciled (ROADMAP ALSO CONSIDER + COMPETITIVE_GAP_PLAN §2 + this file).
E2E: legend labels; impossible-filter empty copy; hint visible→gone on budget set.
No critic cycle (UI-only, #81/#175 class). Gate (real 2026-07-09):
`bash scripts/verify.sh` → **✅ VERIFY GREEN** — tsc/eslint clean, **2039 unit /
153 files**, build clean. Targeted e2e (spending-plan + transactions register +
budget-targets) **4/4**. Full `VERIFY_E2E=1` still can't exit 0 on this Windows
machine (mobile-380 flake — unrelated).

**Remaining after #186:** ~~owner-design-gated mobile secondary-nav redesign~~
**DONE #187**; env-gated live Plaid/SimpleFIN spot-checks + Gap 6 §2 error
tracking + Gap 6 §4 Neon backups; Gap 5 benchmark line (market-data feed +
holdings history); mobile-380 Playwright infra fix.

## Post-Phase-5 reconciliation: Gap 3 §1 is already built (DECISIONS #185, Competitive-Gap Gap 3 §1)

Resumed on "continue" (Fable lane, #184 handoff). The plan §2 still listed "Gap 3 §1
loading skeletons + destructive-delete confirms" as unblocked-and-in-session-verifiable.
A read-only file:line audit found the whole 2026-06-24 ROADMAP "DO NEXT" backlog is
**already built** — the note was stale (the "written without noticing already-built" hazard
§2 exists to catch). Verified-built: `(app)/loading.tsx` (#81); recategorize-popover Escape +
outside-click dismissal (`transaction-list.tsx:315-323` / `:106-117`); `<title>` template
(`layout.tsx:17`) + `global-error.tsx`; empty states on reports/coach/life-energy/cards/
investments; `CardTitle` real heading (`ui/card.tsx:36-54`); Investments nav (#176-era);
inline goal/budget validation returns field errors, never throws (`goal-actions.ts:31-67` #166,
`parseBudgetTargetCents` #30); and every destructive **Delete** already confirms — account-data
typed-phrase (`engine/account/deletion.ts:16`), goal (#83), manual-account
(`accounts-list.tsx:509-517`), custom-category two-step.

**Budget-`Clear` adjudicated a non-gap (not a missing confirm).** The audit flagged
`clear-budget-button.tsx` one-tap "Clear" as missing confirmation by grouping it with the
Deletes. But the app follows a coherent, documented convention: *Delete a persistent entity*
→ confirm; *Clear a reversible attribute* → one-tap. Budget-`Clear` removes a display-only
per-category target (#30, restorable in seconds, no money/history loss); its true sibling is
manual-statement `Clear`, whose one-tap behavior is an EXPLICIT decision (STATUS
§manual-card-statements, "reversible, no money/history loss"). A confirm would make it
inconsistent with that sibling and fail the backlog's own "only change if markedly better" bar.

DOCS-ONLY reconciliation (no app-code/schema/engine/test change; #181/#184 precedent — no
critic cycle). No source touched → tsc/eslint/vitest/build unchanged from #184's green.
Gate (real output 2026-07-08): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — typecheck/lint
clean, **2039 unit / 153 files**, build clean (see evidence in the commit).

**Fable-lane in-session-verifiable backlog is now exhausted.** ALSO CONSIDER mechanical
UX/a11y list was the remaining Opus/Sonnet-lane work — **burned down in #186** (four
genuine gaps shipped; six already-built items struck in ROADMAP). Remaining: env-gated
(live Plaid/SimpleFIN spot-checks, Gap 6 §2 error-tracking DSN, Gap 6 §4 Neon backups)
and the owner-design-gated mobile-nav redesign.

## Post-Phase-5 refinement: proactive-cron scheduling (DECISIONS #184, Competitive-Gap Gap 2 §2/§3)

The notify (Web Push) and digest (weekly email) sweeps were fully built,
`CRON_SECRET`-guarded, and unit-tested (`cron-notify.test.ts`/`cron-digest.test.ts`)
but were absent from `vercel.json` crons, so the entire proactive/stickiness layer
never fired even with keys set (the plan's "genuine remaining gap"). Added both
schedules (`/api/cron/notify` daily 13:00 UTC, `/api/cron/digest` Mon 14:00 UTC) and
a bidirectional coherence regression (`tests/unit/cron-wiring.test.ts`): every
`api/cron/<name>/route.ts` must be scheduled AND every scheduled path must resolve to a
route — so neither "built-but-unscheduled" nor "scheduled-but-404" can reappear.
Delivery stays dormant without `VAPID_*`/`RESEND_API_KEY` (safe no-op, records nothing),
so wiring perturbs no golden and is inert until an operator sets keys. Deploy caveat
(documented, not a code defect): the weekly schedule + 4-cron count need Vercel **Pro**
(Hobby is daily-only, 2-cron max).

Gate (real output 2026-07-08): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
typecheck/lint clean, **2039 unit / 153 files** (+3/+1, the wiring test), build clean
(all four `/api/cron/*` routes compile as functions). No new e2e: a `vercel.json` cron
is a platform trigger with no locally-drivable runtime surface, and the handlers
themselves are already integration-tested against their real GET (consistent with the
reminders/sync cron precedent — scheduling is an operator deploy step).

## Post-Phase-5 refinement: sync-failure surfacing (DECISIONS #183, Competitive-Gap Gap 1 §4)

The connection-health engine graded data *recency* (#171/#179) but by design never
claimed a connection was "broken" — there was no persisted sync-error signal to observe.
This slice creates that signal and surfaces it as a dashboard reconnect alert. Nullable
`lastSyncAttemptAt` + `lastSyncError` on `SimpleFinConnection`/`PlaidItem` (PlaidItem also
gains `lastSyncedAt`); providers persist a SANITIZED reason (`safeSyncErrorReason` →
allow-listed `{auth,timeout,network,server,unknown}`, never the raw error, which can carry
the credentialed access URL — #5) on a caught sync failure and clear it on every success.
Pure `classifyConnectionHealth`/`selectConnectionAlerts` grade `broken` IFF `lastSyncError
!= null` — never inferred from recency — and `ConnectionAlertsCard` renders the reconnect
prompt (message never echoes the recorded reason). Golden/demo-safe by construction (the
demo user has no connection rows → zero alerts).

Gate (real output 2026-07-08): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
typecheck/lint clean, **2036 unit / 152 files** (+26/+2), build clean; `connection-health`
e2e **3/3** (broken-connection render + axe WCAG-AA + the demo count-0 negative). Full
`VERIFY_E2E=1` still can't exit 0 on this Windows machine: the 4 failures are ALL the
documented mobile-380 bottom-nav viewport flake (item #16 / lesson file), on flows where
this card renders `null` (zero DOM added) — not a regression.

Hostile Critic (fresh-context, refute-by-default): could not break claims 1–8
(honesty/no-false-positive, no-credential-leak, recovery, non-masking, refactor-safety,
golden-safety, multi-item-Plaid isolation, ownership). **1 P2 confirmed + FIXED:** the
SimpleFIN success bookkeeping write sat inside the failure-catch, so a transient DB blip on
that final write (after ingest committed) could persist a false "broken" alert
(self-healing, but a false fact) → relocated the success write OUTSIDE the try, so only a
real ingest failure can set the signal. **Accepted P2 (documented):** Plaid's per-item
success write keeps the same merged-write shape; the identical self-healing edge is left
as-is because the Plaid live path is UNVERIFIED (no sandbox creds) and adding control-flow
to that untested loop for a self-healing edge is disproportionate — the SimpleFIN
(verifiable) path is airtight.

## Phase 1 (complete — critic cycle 2 green)

Hostile Critic cycle 1 verdict: FAIL (2× P1). Both fixed in cycle 2; the
critic's adversarial probes are kept permanently in
`tests/unit/critic-scenarios.test.ts`:

- **P1-1 fixed:** transfer recommendation could be dated in the past when the
  first short date was today/overdue. Now clamped to `today`
  (`engine.ts`, regression: probes S3/S9).
- **P1-2 fixed:** the assembler dropped a delinquent (past-due, unpaid)
  statement into the estimate path, mislabeling real debt. Current-statement
  selection now also matches any statement with an unpaid remainder
  (`assemble.ts`, regression: probe S4).
- P2s addressed: future-dated balance snapshot (seed now dates the current
  month's snapshot at asOf), scenario toggle semantics (segmented buttons with
  `aria-pressed` + `aria-live` summary), tabular-nums on headline amounts,
  PHASES.md recommendation wording aligned with EDGE_CASES, this file created.

## Phase 2 (complete — critic cycle 2 green)

Critic cycle 1 verdict: FAIL (1 P0, 6 P1). All fixed in cycle 2; the critic's
probes live on as regressions in `tests/unit/critic2-*.test.ts`:

- **F1 (P0) fixed:** splitting a transaction double-counted it (parent +
  children) in the cash-needed pending projection and flow aggregates. Splits
  now mark the parent `isSplitParent`; every aggregation excludes parents and
  counts children (schema field + assemble/insights/transfers updates).
- **F2 fixed:** split validation now rejects mixed signs, zero parts,
  re-splitting parents, and splitting children; multi-writes run in
  `prisma.$transaction`.
- **F3 fixed:** batch apply no longer creates a silent durable rule — the same
  one-tap "Always / Just this once" consent prompt follows batches, and undo
  removes a consented rule via `becameRuleId`.
- **F4 fixed:** transfer descriptor patterns are anchored/word-bounded and
  transfer detection consumes the normalizer's verdict (one decision path) —
  "T-MOBILE PREPAY", "GIFT CARD PAYMENT", "GEICO AUTOPAY" no longer vanish.
- **F5 fixed:** the band-gap→review rule honors account/day scoping.
- **F6 fixed:** triage actions roll back the optimistic UI and surface an
  error banner on failure; corrections are never silently lost.
- **F7 fixed:** tree green (`npx vitest run` → 321/321).
- F8/F9 partials: `previousAmountCents` + `possiblyUnused` now persisted on
  RecurringSeries; whitespace descriptors get an "Unknown Merchant" fallback;
  `undoSplit` guards non-split rows; split input parses via
  `centsFromDollarString`. Remaining accepted P2s listed below.

## Phase 3 (complete — critic cycle 2 green)

Cycle 1 verdict: FAIL (1 P1). All hand-verified math passed (8/8 anchors to
the cent). Fixed in cycle 2:

- **P1-1 fixed:** the FI number now states its expense basis inline on the FI
  card ("…on $X/yr of spending — estimated from your last 6 full months × 2").
- P2s fixed: split parents excluded from life-energy list and recurring
  detection input; runway "Infinity" rendered as "no expenses yet"; negative
  savings-rate headline has honest copy; slider state clamped to its range;
  Money Review fallback no longer claims an improvement it didn't measure
  ("What held steady…"); opportunity projections state the assumed return rate.
- Phase 2 cycle-2 hardening from the same review: integer-cents split
  validation, one-action-at-a-time guard on triage gestures, empty-batch
  prompt guard.

## Phase 5 / final full-app critic: **PASS** (zero P0/P1)

Financial correctness 10/10 (30 hand-verified assertions incl. 6 brand-new
adversarial cash-needed scenarios, all exact to the cent), edge-case coverage
10/10. Findings, all P2:
- **P2-1 CSV formula injection — FIXED post-review**: `csvField` now prefixes
  `= + - @` / tab / CR-leading fields with an apostrophe; the critic's evidence
  probes were flipped to safe-behavior regressions (critic5-surface.test.ts).
- P2-2 rate limiter is in-memory/single-instance — accepted for v1, documented
  in authz.ts and ROADMAP #8.
- P2-3 cosmetic Recharts width(-1) console warning during headless e2e.

## Post-Phase-5 refinement: Spending Trends / insights (DECISIONS #74, surpass feature #7)

The "what changed & what to look at" surface (Copilot/Cleo/Monarch lead with it)
that the category/recurring/forecast views never exposed. Pure engine
`engine/trends/trends.ts` — a thin, exact layer over the tested
`spendingByCategory` (one spend definition, integer cents, no model calls):
pace projection for the in-progress month, completed-month category movers (last
month vs a ≤3-month average, ≥$20 AND ≥20%), largest purchases, and new merchants
(vs the prior 6 months). Non-actionable money movement ('Transfers & Other':
cash/transfer/cc-payment/uncategorized) is kept out of movers/largest/new and
aggregate pseudo-merchants out of new-merchants; pace alone keeps the full reports
total so the headline matches /reports & /spending-plan. `getSpendingTrends`
reads the same ownership-scoped snapshot; `/trends` page + a dashboard
`SpendingInsightsCard` + a reciprocal /reports link, NO 8th nav icon (380px bar
full at 7, #71).

Gate (real output 2026-06-23): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, **807 unit / 65 files** (+16: hand-
derived synthetic + a real-seed pinned run + an integrated normalize→engine test),
build clean, **46 e2e** (+3: discovery, render incl. Costco as the seed's biggest
June buy, WCAG-AA axe). One e2e iteration first caught a real dark-mode contrast
miss (an `opacity-80` on the % label, 4.42 vs 4.5:1) — FIXED before sign-off.

Hostile Critic (4 dimension critics + adversarial verification of every P0/P1):
financial 7 / edge-case 7 / security 9 / UX-a11y 8. **1 P1 confirmed + RESOLVED:**
"Store Card Purchase" surfaced as a new merchant — traced to a docstring
OVER-CLAIM, not a code bug. This codebase deliberately treats "Store Card
Purchase" as a real, rule-eligible merchant (`assign.ts isRuleEligibleMerchant`
+ the triage flow assert `rule-always` for it), so flagging it aggregate would
have broken that tested decision; fixed by correcting the doc + adding an
INTEGRATED test (derives the aggregate flag via `normalizeMerchant` like the
server does, proves genuine aggregates Zelle/Check ARE excluded while Store Card
legitimately appears). P2s FIXED: deterministic largest tie-break
(amount→date→merchant), no-history-vs-steady empty-state copy, pace `h2` for
heading order, reciprocal /reports→/trends link, new-merchant amount doc clarified.
Accepted P2s (documented, by design): (1) pace counts money-movement to MATCH
/reports & /spending-plan (movers exclude it for actionability — a deliberate,
documented split, not a third spend definition); (2) largest excludes
uncategorized to avoid Unknown-Merchant noise (consistent with movers); (3)
refunds are not netted from the new-merchant total (a brand-new merchant rarely
has a same-month return; netting would risk a confusing negative line); (4) the
day-1/2 pace projection is volatile but explicitly caveated ("a projection, not a
prediction"); (5) the mover baseline averages over months-with-any-spend — a true
calendar-monthly average including $0 months; (6) trends copy is hand-verified
against the coaching guardrails but isn't yet in the automated guardrail-scan set.

## Post-Phase-5 refinement: Money Dials settings/onboarding (DECISIONS #28)

The five per-user dials the engines read (payment account, SWR, expected return,
hourly wage, money dials) were seed-only with no editing path. Added the
credential-free half of ROADMAP #2:
- Pure validation engine `src/lib/engine/settings/dials.ts` (string-only parse,
  all-fields-at-once errors, bounds that keep the FI engine defined — SWR
  rejected ≤ 0 because `fiNumberCents` divides by it). `tests/unit/settings-dials.test.ts`
  (70 cases) + hand-verified parse table in EDGE_CASES §Money-Dials.
- Thin ownership-scoped `updateMoneyDials` server action (validate → persist →
  audit → revalidate dashboard/coach/cards/accounts/settings).
- `MoneyDialsForm` (useActionState, inline per-field errors + ARIA, assumptions
  in copy) on `/settings`; dashboard onboarding nudge gated on `paymentAccountId
  == null` (dormant in demo, activates for real new users post-auth).
- E2e `tests/e2e/settings-dials.spec.ts`: one sequential test (mutates only
  `moneyDials`, the dial with no golden coupling, and restores it) — proves
  pre-population, validation-without-persist, and a DB round-trip, golden-safe
  under fullyParallel.

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green (27 files), build
clean, **24 e2e** green (was 23 + the new dials flow).

Hostile Critic (multi-agent workflow, 4 dimension critics + adversarial
verification of every P0/P1): **PASS** — scorecard financial 9 / security 9 /
UX-a11y 8 / code-tests 8, **0 P0/P1** (the lone P1 candidate — a stale
`paymentAccountId` silently falling back — was independently verified to P2:
no account-deletion path exists anywhere in the codebase, so it is latent /
forward-looking). P2s fixed in this pass: centralized the triplicated
`JSON.parse(moneyDials)` into a malformed-safe `parseStoredDials`/`encodeDials`
engine boundary (used by coach/settings/budgets/action); made `needsOnboarding`
existence-aware (a dangling/ineligible saved id re-fires the nudge instead of a
silent fallback) and removed the redundant 3rd dashboard user-read (single
source via `DashboardData.paymentAccountId`); added a `role="status"` live region
for the "saved" confirmation (WCAG SC 4.1.3); code-point-aware dial length;
zero-eligible-account empty state; tightened the nudge copy (money dials don't
move the headline); `autoComplete="off"` on the numeric inputs. Deferred P2s
(documented, not fixed): per-action rate limit (consistent with the codebase's
other mutations — DECISIONS/ROADMAP #8), focus-to-first-error + error summary,
and light-theme error/success contrast (light theme is unreachable today).

NOTE (env, not a code defect): the first e2e run failed with `ChunkLoadError`
because a stale `next start` (the desktop launcher app) held port 3100 and
Playwright's `reuseExistingServer` reused it after the rebuild overwrote its
chunks. Stopping that process and re-running clean was green. If e2e ever shows
chunk-load / 400-on-`_next/static` errors, check for a stray server on 3100
(`netstat -ano | grep :3100`).

## Post-Phase-5 refinement: average-daily-balance interest (DECISIONS #29, ROADMAP #3)

Minimum-path interest moved from the labeled v1 simple-monthly approximation
(carried × APR/12) to the **average-daily-balance method**: per card not paid in
full, interest = round(DPR × Σ daily balances) over the next cycle
[close → close+1mo], DPR = APR/10000/365, balance = full statement until the
minimum posts on the due date then carried after; grace-gated (paid in full → $0).
New pure primitive `averageDailyBalanceInterestCents` in money.ts (own known-answer
tests incl. a fail-loud overflow guard); engine derives cycleDays/daysUntilDue from
the statement close+due dates. The retired `mulBps` (its sole caller) was removed.
Every pinned value recomputed BY HAND and updated with its test + doc (EDGE_CASES
§I/§Seed-headline: §I $61.08, the 06-01-cycle §I anchor $58.81, seed $65.76→$67.36,
S8 $12.23, N6 $19.17/$18.74).

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green (27 files), build
clean, 24 e2e green. (One full-run failure was a confirmed environment flake —
`net::ERR_NETWORK_IO_SUSPENDED` from the machine suspending network I/O mid-run;
the 3 affected specs, all on pages untouched by this change, passed on a clean
re-run, and the subsequent full verify was green.)

Hostile Critic (multi-agent, adversarial verification): **PASS** — financial 9 /
regression 9 / code-tests 9, **0 P0/P1**, 0 refuted; all three critics
independently hand-derived every pinned ADB value and each matched exactly, and
confirmed PAY_IN_FULL + all non-interest golden values are unchanged. Critic P2s
fixed: removed dead `mulBps` + its fossil test, overflow guard, citation #5/#21→#29,
type-comment + assumption-string transparency (mid-cycle payment timing). Accepted
P2s: theoretical float-half fragility and the latent estimate-path clamp (unreached;
estimates are excluded from MINIMUM interest whenever a real statement exists).

## Post-Phase-5 refinement: budget-targets UI (DECISIONS #30, ROADMAP #7)

Set/clear a per-category monthly target against actuals on `/budgets`. Pure engine
`engine/budgets/status.ts` (summarizeBudgets over the union of spent+target
categories; netSpendByCategory nets refunds; isBudgetable; parseBudgetTargetCents),
22 unit cases. `setBudget` is an atomic `prisma.budget.upsert` on a new
`@@unique([userId, categoryId])` (applied via `prisma db push`); `clearBudget` is
ownership-scoped. Budget targets are display-only — they feed nothing but /budgets
(not cash-needed/FI/net-worth) — so writes perturb no golden value.

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green, build clean, e2e green
(incl. the new budget-targets flow: set → axe scan → atomic overwrite → clear).

Hostile Critic (multi-agent, adversarial verification): **PASS after fixes** —
correctness 8 / security 9 / ux-tests 7. Two P1s found and FIXED before sign-off:
(1) budget actuals ignored refunds → a net-under-target category could show a false
"over target" bar — fixed by netting refunds in the budgets spend calc (scoped to
the display; income/savings-rate aggregations stay gross per the documented
convention, ROADMAP #4); (2) the overwrite path was untested with no DB uniqueness
guard → fixed with `@@unique` + `upsert` (structurally one row, no race) + an e2e
overwrite step. P2s fixed: non-spendable categories no longer selectable (shared
`isBudgetable` allow-list on picker AND server), progress bar gained
`role="progressbar"` + aria, and the e2e now runs axe on the target-bearing DOM.
Accepted P2s (consistent with the codebase): action throws on invalid input like the
sibling `createGoal` (no error boundary app-wide), per-action rate limit deferred
(ROADMAP #8), and the pre-existing exact-name money-dial match.

## Post-Phase-5 refinement: account-deletion UI (DECISIONS #31, ROADMAP #10)

Settings → "Delete my data": typed-confirmation gate → ownership-scoped
`prisma.user.delete` (cascades every user-owned row; shared Merchant/Category
left intact) → best-effort Plaid revoke → signOut. Idempotent (existence guard
skips audit+delete on an already-gone row, still signs out). Pure gate/summary
engine (`engine/account/deletion.ts`) + an integration test that drives the REAL
`deleteMyData` against throwaway users (gate-reject → no deletion; exact phrase →
scoped wipe + signOut; idempotent re-run). `(app)/error.tsx` added so a
post-deletion no-accounts render (or any action throw) degrades gracefully.

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green, build clean, e2e green
(incl. the gate/summary flow; the destructive execution is deliberately not e2e'd
against the shared demo — proven by the integration test instead).

Hostile Critic (multi-agent, adversarial verification): **PASS after fixes** —
security 7 / correctness 8 / ux-tests 6; cascade correctness verified down to live
`PRAGMA foreign_keys`. Four P1s found and FIXED: (1) the action had zero execution
coverage → action-level integration test; (2)+(4) non-idempotent crash (P2003/P2025)
on an absent/double-submitted row → existence guard; (3) post-deletion demo
re-sign-in 500 with no error boundary → `(app)/error.tsx`. P2s fixed: honest
summary catch-all, permanence warning moved above the form + `aria-describedby`,
form suppressed in the no-data state, de-flaked the integration test (unique ids).
Accepted P2s (real-auth release): multi-device JWT session invalidation and a
non-cascading compliance deletion-record (documented in PRIVACY.md §Deletion).

## Post-Phase-5 refinement: offline PWA service worker (DECISIONS #32, ROADMAP #5)

`public/sw.js` + a precached self-contained `/offline` shell + production-only
registration (`sw-register.tsx`, wired into the root layout). Conservative by
design: navigations network-first (online always fresh, never cached → no stale/
cross-user data), icon/manifest cache-first with a `res.ok` guard, hashed
`/_next/static/*` passthrough (bounded SW storage — no per-deploy accumulation).
Middleware excludes `/sw.js` + `/offline` (anchored so prefix collisions can't
skip auth).

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green, build clean, e2e green
(new pwa-offline spec: SW registers + an offline reload serves the shell; existing
PWA-manifest + security-header specs unaffected — network-first means online specs
always hit the network).

Hostile Critic (multi-agent, adversarial verification): **PASS** — suite-safety 8 /
correctness 9 / privacy-robustness 7, **0 P0/P1** (the 3 review-phase "P1"s —
fixed cache name, atomic-precache-swallow, cache-first-stale-offline — were all
adversarially downgraded to P2: no online stale-serving, no leak, no suite
destabilization). P2s fixed proactively: `res.ok` cache guard, resilient per-asset
precache, network-first `/offline`, self-contained inline-styled shell, anchored
middleware matcher. Deferred P2s (documented): a build-stamped cache name and an
in-app "update available" affordance — unneeded while hashed assets are passthrough
and online navigations are network-first.

## Post-Phase-5 refinement: app-wide refund netting (DECISIONS #33, ROADMAP #4)

`monthlyFlows` (the single income/expense classifier feeding savings rate + FI)
now nets refunds: a positive transaction in a non-income category reduces that
month's expenses instead of counting as income (payroll/income unaffected;
ambiguous no-category positives stay income; a month's spend is floored at 0). The
demo's lone refund (+$50 AMZN return, May) now reduces shopping spend rather than
inflating May income — a small, correct shift (no pinned golden value depended on
it). Verified by 4 known-answer fixture tests in insights.test.ts; the only
in-app income path is `monthlyFlows` (`incomeExcludingTransfers` is test-only), so
the change is consistent. Reviewed by a focused self-check (income-detection edge
cases + single-path confirmation) rather than the full multi-agent critic, given
the 6-line, well-tested, single-path scope. `VERIFY_E2E=1 bash scripts/verify.sh`
→ **✅ VERIFY GREEN** (585 unit / 29 files, 27 e2e, clean typecheck/lint/build).

## Post-Phase-5 refinement: production hardening (DECISIONS #48, ROADMAP #8 + #9)

Closed two deferred launch-gating items. (#9) The `splitTransaction` double-split race
— it read `isSplitParent` before its transaction, so two concurrent splits could each
create children (doubling the txn in every aggregate). Now the parent is CLAIMED
atomically inside the transaction (conditional `updateMany`; a racing loser aborts before
creating children). (#8) The in-memory rate limiter was a per-instance no-op on
serverless; replaced with a durable, DB-backed `rateLimitDurable` (new `RateLimit` table,
applied via `prisma db push`) on the export route + a new per-account sign-in throttle.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **698 unit / 51 files**, build clean, **35 e2e** (existing
split + export flows unaffected).

Hostile Critic (4 parallel dimension critics + adversarial verification): the split fix
scored 10/10 (proven 20/20; the loser is rejected by the claim, not the pre-read). But it
found **3 P1s in the limiter, all FIXED**: (CONC-1/SEC-1) the reset branch returned `true`
UNCONDITIONALLY, so a concurrent burst of N first-hits ALL bypassed (50/50 at limit 8) —
fully defeating the brute-force throttle; fixed by deciding from an atomic
increment-or-create's returned count (regression: a 12-call burst at limit 4 allows exactly
4). (OPS-1) the `RateLimit` table grew unboundedly (no prune/index, attacker-controlled
`signin:<email>` keys, CWE-770); fixed with `@@index([resetAt])` + a self-pruning
`pruneExpiredRateLimits()` (≤1/min/instance, no cron needed). P2s fixed: export 401/429
tests, undo→resplit test, honest dead-code comment, explicit fail-closed comments. Deferred
P2s (documented): email-keyed sign-in throttle allows a bounded ≤60s account lockout
(IP-scoping is the next step); the limiter is two Prisma statements vs a single raw
ON-CONFLICT (a Postgres-only optimization); the Always/Undo orphan-rule race (STATUS #10).

## Post-Phase-5 refinement: payment reminders (DECISIONS #47, ROADMAP #6)

The calendar badged due days but nothing delivered a reminder. Added the MECHANISM:
a pure `engine/reminders/select.ts` (selection + email text) shared by an in-app
dashboard "Payment reminders" card and a `CRON_SECRET`-guarded `/api/cron/reminders`
sweep. Email dispatch (`lib/email.ts`) is DORMANT by default — no `RESEND_API_KEY` →
nothing sent, no network call (zero-credential demo, fetch-spy tested); set a Resend
key to switch on. Both surfaces derive from the same Cash-Needed obligations so they
can't disagree.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **686 unit / 48 files**, build clean, **35 e2e**
(dashboard reminders panel + no-duplicate-card assertion + reminder-cron-secret 401).

Hostile Critic (4 parallel dimension critics + adversarial verification): **2 P1s found
+ FIXED** before sign-off. (F1) both callers spread `[...result.cards, ...result.upcoming]`,
but the engine's `cards` already includes `upcoming` (a subset) → estimated obligations
double-counted (demo showed "Store Card" twice) → pass `cards` only + made the selector
idempotent under overlap (dedup) + an e2e uniqueness check. (PR6-001) the partial-autopay
(top-up) case dropped the autopay portion in the email/card against the larger headline
→ added the both-portions disclosure + a known-answer fixture. P2s fixed: shared
constant-time cron compare (now used by sync too), keyed-send cron test, tomorrow/soon-
boundary coverage, long email dates, stale calendar-footer copy. Deferred P2s
(documented): scheduling is an operator deploy step (`vercel.json` crons + `CRON_SECRET`),
consistent with the sync cron; the cron response lists userIds to the secret-holder only.

NOTE (deploy): to actually fire, add `{ "crons": [{ "path": "/api/cron/reminders",
"schedule": "0 13 * * *" }, { "path": "/api/cron/sync", "schedule": "0 * * * *" }] }` to
`vercel.json` and set `CRON_SECRET` (+ `RESEND_API_KEY` to send email). Dormant otherwise.

## Post-Phase-5 refinement: manual card statements (DECISIONS #46, extends #45)

A manual CREDIT card was treated as a card by the Cash-Needed Engine but, lacking a
Statement and cycle days, `buildObligation` returned null (engine.ts:83) → it was
DROPPED from "how much do I need & when", counting only toward net worth. Now a user
attaches a statement (+ optional APR + autopay) on `/accounts` so the card runs the
PRECISE path. No schema change (Statement/AutopayConfig already exist; the snapshot
already loads all of them). Pure parser `engine/cards/manual-statement.ts`, atomic
manual+CREDIT-guarded `card-actions.ts` (ARRAY-form `$transaction` — the interactive
form timed out under parallel SQLite), `getAccountsView` billing + `/accounts` UI.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **666 unit / 44 files**, build clean, **33 e2e**
(new manual-card-statement flow: add card → add $0 statement [headline-neutral] →
FIXED_AMOUNT autopay re-hydrates on edit → clear → delete-revert).

Hostile Critic (4 parallel dimension critics + adversarial verification of every
P0/P1): **0 P0/P1** — all three P0/P1 candidates reproduced then downgraded to P2
(parse failure returns before any DB write → no data loss; clear error surfaced in
the role=alert banner; narrow blast radius). Scorecard: security 9–10, code/tests
6–9, UX/a11y 6–9. P2s FIXED: FIXED_AMOUNT autopay round-trip on edit (billing now
carries the amount), blank-APR inline disclosure, `role="group"` on the form, an
aria-live `role="status"` success confirmation, + 3 missing tests (FIXED_AMOUNT split,
idempotent clear, APR-wipe). Accepted/deferred P2s (documented): manual estimate path
uses the user-entered balance for the next cycle; input-prefill `toFixed` (consistent
with existing prefill code); read-then-write single-statement race (STATUS #10 /
ROADMAP #9); one-tap Clear without confirm (consistent with the more-destructive
sibling `manual-delete`, reversible, no money/history loss).

## Post-Phase-5 refinement: real-clock "today" for real users (DECISIONS #58)

Found while prepping the multi-user deploy: the app resolved "today" as
`DEMO_TODAY ?? DEFAULT_AS_OF('2026-06-10')`, so a production deploy with
`DEMO_TODAY` unset would FREEZE every real user's "today" at the seed date —
wrong days-until-due, reminders, and net-worth "today" point. Fixed with one
sanctioned wall-clock read (`src/lib/business-today.ts` `businessToday(userId?)`):
DEMO_TODAY pin → demo user pinned to the seed date → real users get the real
clock. Threaded `userId` through `DataProvider.today(userId?)` and all call sites
(finance/coach/budgets/layout/new-txn/accounts/simplefin/plaid + the reminders
cron via getCashNeeded). Golden-safe by construction: tests set DEMO_TODAY, the
demo path still resolves to 2026-06-10.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — **753 unit / 60 files** (+4 known-answer: DEMO_TODAY-wins, demo-pinned,
real-user-real-clock, no-userId-real-clock), build clean, **37 e2e**.

## Post-Phase-5 refinement: invite-only signup (DECISIONS #57, ROADMAP #2)

The user needs the app for themselves + spouse + chosen testers, not the public.
Real multi-user auth already existed (DECISIONS #43) and its data isolation is
tested (re-confirmed live: `auth-actions`/`auth-password` → 10 passed, incl. the
two-user isolation check). What was missing was a way to keep signup private. Added
a pure env-driven allowlist (`src/lib/auth/allowlist.ts`) wired into
`signUpWithPassword` before any DB write. DORMANT by default (`SIGNUP_ALLOWLIST`
unset → open, so demo/local/tests are unchanged); set it → invite-only (exact
emails and/or whole `@domains`, case-insensitive). Gates creation only; existing
logins are unaffected.

Inline hostile-critic (proportionate to a ~45-line pure gate), 0 P0/P1: rejected
domain-suffix spoofing (`@team.com` ≠ `evilteam.com` / `team.com.attacker.net`),
multi-`@`/malformed (regex gate runs first + independent no-local/no-domain guard),
typo'd entries fail closed, no eval/SQL. KNOWN OPERATIONAL RISK (documented, bold in
docs/DEPLOY.md, not a code defect): forget to set `SIGNUP_ALLOWLIST` on deploy →
open signup.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **749 unit / 59 files** (+9: 8 known-answer allowlist
+ 1 action-level gate test), build clean, **37 e2e**. New deploy runbook docs/DEPLOY.md.

## Post-Phase-5 refinement: SimpleFIN aggregator (DECISIONS #56, ROADMAP)

A user hit Plaid's approval/cost wall and asked for an aggregator. Answer: don't
clone Plaid — wire SimpleFIN, a read-only documented protocol with no business
gate. Split like Plaid (#26): a TESTED pure mapper (`simplefin-map.ts` — signs,
cents, dates, account-type, dedup) + an UNVERIFIED network layer (`simplefin.ts`).
A `SimpleFinConnection` row stores ONLY the AES-256-GCM-encrypted access URL.
Re-sync is idempotent + race-safe on a new `@@unique([accountId, providerRef])`
(seed/Plaid goldens unaffected — providerRef nullable), 5-day overlap, then
cross-account transfer pairing (Plaid parity). SimpleFIN amounts are
outflow-NEGATIVE like Pulse, so — unlike Plaid — the sign is NOT flipped.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **740 unit / 58 files**, build clean, **37 e2e**.
20 new SimpleFIN tests (mapper fixtures + real connect/sync actions vs a mocked
server: encrypted-at-rest, correct signs/categories, idempotent re-sync, SSRF
rejection incl. an internal access URL returned BY the claim server, IPv6 internal
tokens, malformed-row skip).

Hostile Critic (4 parallel dimension critics + adversarial verification of every
P0/P1): **5 P1s confirmed and FIXED + tested** — (1) SSRF redirect-follow bypass →
`safeFetch` re-validates every hop + drops Authorization on cross-host redirect;
(2) IPv6 private/ULA/link-local not blocked → added (`::`, fc00::/7, fe80::/10,
::ffff: mapped); (3) `posted:0` pending sentinel → 1970-01-01 → falls back to
`transacted_at` then sync date; (4) ambiguous account + negative balance could
INVERT net-worth sign → classified as liability + UI notice; (5) action errors
echoed `e.message` (could leak the credentialed URL) → fixed strings. P2s fixed:
amount parser tolerant of thousands-separators + >2 decimals (integer math, no
float); malformed-row skip not fatal.

**UNVERIFIED (honest, documented — docs/SIMPLEFIN_WALKTHROUGH.md):** the live
network path has NEVER run against a real SimpleFIN server here (no token in env).
The ledger-corrupting logic is unit-tested; the socket isn't. Confirm field shapes
vs the current spec before trusting real money data. Like Plaid, a real bank
linking to the *deployed* app also waits on real multi-user auth (ROADMAP #2) —
linking to the shared demo user would leak data. DNS-rebinding (pin-resolved-IP)
and scheduled auto-sync are deferred follow-ups.

## Phase 4 (complete — see commit)

Calendar/goals/budgets/exports/PWA/cron/security headers + dormant Plaid
provider (UNVERIFIED — docs/PLAID_WALKTHROUGH.md has the validation
checklist). Unauthenticated API requests now return 401 JSON (middleware).

## Known limitations (accepted, by design or deferred)

1. **Statement balances in seed history are plausible PRNG values**, not exact
   sums of that cycle's card transactions (DECISIONS #14). Likewise the
   checking account's posted balance is not reconciled against its full
   transaction history. No engine math depends on this reconciliation.
2. **Minimum-path interest uses the average-daily-balance method** (DECISIONS #29,
   supersedes the v1 simple-monthly approximation): APR÷365 × the cycle's average
   balance (full statement until the minimum posts, carried after), grace-gated so
   paid-in-full cards show $0. New purchases are not projected (a stated
   assumption); the minimum is modeled as posting on the due date, and any
   mid-cycle payment already made is treated as reducing the balance from the
   statement's close date (its exact posting date is not modeled — a conservative,
   user-favorable simplification). Two §I anchors in EDGE_CASES differ purely by
   cycle dates ($61.08 vs $58.81) — expected, both pinned.
3. **Demo auth is one-click** (anyone can open the demo user). Real auth
   (magic link / Google) plus the security pass land in Phase 4 (DECISIONS #13).
4. **`getDashboardData` loads the full snapshot per render** — fine at seed
   scale; pagination/caching is a Phase 4/5 concern.
5. **A card payment in transit that is recorded nowhere** (neither CardPayment
   row nor pending debit) is conservatively double-demanded (full statement +
   money still in checking). Documented behavior (critic scenario S2).
6. WCAG AA: axe (wcag2a/aa + wcag21a/aa tags) passes on all core pages plus a
   keyboard-only flow (tests/e2e/phase5-a11y.spec.ts); a full manual audit
   (screen readers, zoom, cognitive review) has not been performed.
7. **Recurring-detection fragilities (critic F8, P2):** ~~a refund+rebill inside a
   series drops it for the period~~ — **FIXED** (DECISIONS #34, ROADMAP #4): the
   detector analyzes only the dominant sign per merchant, so a refund (the minority
   sign) no longer breaks amount-stability or flips a series to "income"; the two
   critic2-recurring probes now assert the survived behavior. Still open: annual
   subscriptions need 3 occurrences (2+ years of history); `possiblyUnused` is a
   fitness-category proxy (usage is not observable in transaction data —
   DECISIONS #18) and is always phrased as a question in the UI.
8. **Refunds are NETTED against spend** (DECISIONS #33, ROADMAP #4 — supersedes the
   prior "refunds count as inflows" stance): a positive transaction in a non-income
   category reduces that month's expenses in `monthlyFlows` rather than counting as
   income, so savings rate and FI inputs reflect net spend. Payroll (category
   `income`) still counts as income; a positive with no/unknown category stays
   income (ambiguous inflow not netted). The /budgets view already did this locally
   (DECISIONS #30); this makes it consistent engine-wide.
9. **Equal-priority rules tie-break by creation order** (stable sort) — documented
   here rather than enforced.
10. **Concurrency races:** ~~two concurrent splits could double-split~~ — **FIXED**
    (DECISIONS #48: `splitTransaction` claims its parent atomically inside the tx).
    ~~"Always" racing "Undo" can orphan a rule~~ — **FIXED** (DECISIONS #49:
    `undoCorrections` deletes the rule only WHERE `createdFrom` still points back to
    this correction; regression-tested). ~~The `alreadyUndone` pre-read TOCTOU lets two
    concurrent undos of the same correction write a duplicate inverse~~ — **FIXED**
    (DECISIONS #50: the inverse correction carries `undoesId` with a `@@unique`, so the
    racing loser's insert violates the unique and rolls back; regression-tested with two
    concurrent undos → exactly one inverse). **All of #10 is now closed.**
11. ~~**Unknown billers containing a word-bounded "EPAY"** (e.g. "DUKE ENERGY
    EPAY") classify as transfers~~ — **FIXED** (DECISIONS #55): a utility-token +
    biller-payment-token pattern now wins before the transfer pattern, so utility
    e-payments are categorized as `utilities` (real spend) instead of being dropped
    as transfers — without affecting card payments. Surfaced by the adversarial
    categorization eval (`npm run eval:categorize`) + regression-tested.
12. **Plaid integration is IMPLEMENTED but UNVERIFIED** (no sandbox credentials
    in the build environment). The pure mapping layer (sign flip, account-type,
    liability→statement, per-row categorization) is unit-tested
    (tests/unit/plaid-map.test.ts, 18 cases); the network orchestration in
    plaid.ts (accounts/transactions-sync/liabilities/webhook/item-remove, with a
    dedicated `PlaidItem` token+cursor table) is real code that has never run
    against a live sandbox. Webhook JWT verification — **DONE** (DECISIONS #52:
    ES256 + body-SHA-256 + freshness, unit-tested with a real keypair; the live
    key fetch is the only UNVERIFIED part). Recurring/scheduled refresh after ingest
    — **DONE** (DECISIONS #53: `refreshRecurringForUser`, unit-tested). The only thing
    still UNVERIFIED is the live Plaid NETWORK orchestration itself (no sandbox creds
    here); production OAuth (ROADMAP #1d) is the remaining gap. Validation checklist in
    docs/PLAID_WALKTHROUGH.md §5.
13. **Coast-FI with a 0-month target** and `detectLifestyleCreep(windowMonths=1)`
    are degenerate for out-of-range inputs — unreachable from the app
    (constants fixed), noted for API consumers.

## Post-Phase-5 refinement: Ask Aimplifi — grounded NL assistant (DECISIONS #75, surpass feature #8)

The conversational surface the app is named for, built on the no-fabrication soul:
the LLM never originates a fact. A pure rule-based parser (`engine/assistant/intent.ts`,
no model call — LOOP #5) maps a question to a typed intent; the server answers it from
the SAME tested engines/read-paths the dedicated views use (`spendingByCategory` == /reports,
spending-plan, cash-needed, recurring, forecast, `monthlyFlows`, `netWorthCents`, coach),
rendered by pure formatters via `formatCents`. The LLM is an optional, key-gated,
7s-timeout-bounded, per-user-rate-limited fallback that ONLY classifies an unknown question
into a kind (can abstain via "none"); params are re-derived deterministically + re-validated
before any data is touched, and answers flag `interpreted` so a guess is never silent.
Zero-key demo fully functional. Dashboard `AskAimplifiCard` + `/ask` (no 8th nav icon, #71/#74).

Gate (real output 2026-06-24): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN** —
typecheck/lint clean, **900 unit / 70 files** (+93), build clean, **51 e2e** (+5; the off-topic
case at 7.0s confirms the LLM-timeout → deterministic-fallback path), axe WCAG-AA green.

Hostile Critic (2 cycles, 16 agents, adversarial verification): cycle 1 financial 7 / security 8 /
code 6 / UX 8 — **6 P1s confirmed + FIXED**, each regression-locked: (1) net-worth used a truncated
liability set → canonical `isLiabilityType` (incl. MORTGAGE/OTHER_LIABILITY), facts reconcile to the
headline; (2) income/savings dropped `categoryId`+`isSplitParent` → income now `monthlyFlows(snap.transactions)`
(full rows; refunds net, splits excluded — F3 synthetic regression) and savings_rate delegates to
`getCoachData` (byte-identical to /coach); (3) largest omitted the POSTED filter → POSTED-only, grounding
test pins top-5 == /trends `computeLargest`; (4) off-topic could be silently misrouted when a key is set →
LLM `none` abstention + per-user `rateLimitDurable` + visible `interpreted` note. Confirmation cycle
(financial 93 / security 95 / code 88 / UX 88) confirmed all six and surfaced **1 further P1** — largest
diverged from /trends on the `<= today` guard + locale-vs-code-point tie-break — now FIXED to mirror
`computeLargest` exactly, with a non-tautological test (future-dated exclusion + code-point tie).
P2s FIXED: dead `answerUnknown` source line, third-party disclosure footnote (gated on `assistEnabled`),
no-flicker re-ask (prior answer dimmed while pending), dashboard card examples no longer fake-interactive,
500-char question clamp. Accepted/deferred P2s (documented): a shared `toFlowTxns`/`isPurchaseRow`/month-name
extraction across coach/trends/assistant (future DRY refactor); the pre-existing `monthlyFlows` income rule
(positive = income only for category null/'income', else nets) is unchanged.

## 2026-06-24 — SimpleFIN test flake hardened (DECISIONS #76)

A post-restart `verify` once failed `tests/unit/simplefin.test.ts` as "expected 0 to
be 2". Root cause: the parallel unit suite shares ONE rollback-journal SQLite dev.db
across worker processes; under an I/O spike (the codegraph daemon re-indexing) a write
was starved past the 15s busy_timeout → SQLITE_BUSY, which connectSimplefin's
intentional credential-safe catch masks as `added:0`. The code was never wrong (23+
clean full-suite reruns). Fix is TEST-ONLY (prod is Postgres): a vitest globalSetup
puts dev.db in WAL (concurrent readers + one writer no longer block), the SimpleFIN
test now asserts no swallowed error, and a regression test locks WAL on. Proven
fail-before/pass-after; verify GREEN (901 unit / 71 files), e2e 51 passed, 10/10
consecutive full-suite reruns clean.

## Coach Principles (Wave 1 + P0.4 + P0.5 + Wave 3) — M7 hostile-critic PASS (DECISIONS #92–98)

Embedded 7/9 finance-book principles into the Coach + app: Wave-1 captions
(Housel/Sethi/Ramsey framings), the P0.4 Conscious-Spending bucket lens, the
P0.5 Automation blueprint, and the Wave-3 Debt Freedom planner + Ask `debt_payoff`
intent — engine-first, each milestone verify-green and committed (#92–97).

**M7 hostile-critic review** (8 read-only dimension reviewers, opus, + adversarial
verification): **6 P1s confirmed and FIXED, each regression-locked** (full detail
in DECISIONS #98):
- **DEBT (P1):** the negative-amortization guard tested the *portfolio total*, so a
  single never-amortizing debt reported ALL debts — even ones steadily clearing —
  as never-paid-off (reachable with the seed's own estimated card minimums). Now a
  **per-debt** progress guard + a $1B overflow valve + a $0-budget short-circuit;
  pinned by new mixed-portfolio + zero-budget known-answer tests (EDGE_CASES §D/F/G).
- **AUTOMATION (P1):** the blueprint presented *estimated* next-cycle card
  obligations (the demo Store Card) as firm "set autopay" instructions → the engine
  now drops `isEstimated` cards, matching the cash-needed headline.
- **GUARDRAILS (P1):** `debtTradeoff` was a projection flagged `isProjection:false`
  (bypassing the assumption scan) → inline assumption added + flag corrected.
- **ASK (P1×2):** "pay off my credit card debt" was poached into `debt_payoff` (now
  stays cash_needed); "owe"/"out of debt"/"pay down" debt questions were missed (now
  routed) — both directions regression-tested.
- **MIGRATION (P1):** README's `prisma migrate deploy` builds a column-short DB —
  the single init migration is broadly stale (the migrations dir is vestigial;
  schema.prisma + `db push` are the real source of truth) → README + deploy step
  aligned to `prisma db push`.

P2s fixed: two `Math.round`/`*0.01` float-on-cents smells → `roundHalfAwayFromZero`;
conscious-strip bar widths normalized to sum 100% (overspent no longer overflows);
value CardTitles `as="div"` (#88); strategy toggle `aria-pressed`; sliders
`aria-valuetext`; debt-row truncation; trends mover-icon label. Deferred-with-rationale
P2s: Plaid LOAN minimum unmodeled (connector dormant); the conscious fixed-bucket
caveat already conveyed by the "bills and spending" copy; marginal small-text contrast
(axe-PASSING).

Gate (real output 2026-06-25): core `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
typecheck/lint clean, **1008 unit / 77 files**, build clean. A11y-focused e2e
**16/16 pass** (coach/goals/budgets/trends/ask axe WCAG-AA — all four new surfaces).

**Book coverage completed to 9/9 (DECISIONS #99).** On "continue", the two books the
recommended scope left invisible were surfaced as content lines (the plan §2 line-69
owner option): C11 Kiyosaki — assets-vs-liabilities caption on /accounts; C16
Aliche/Sethi — a "Your money rules" strip on /coach (reads the existing moneyDials, no
new storage). Pure content, guardrail-scanned, no engine/schema change. The remaining
Wave-4 items (income-lever slider, mortgage early-payoff what-if, memory-dividend
reflection, PAW lens, the heavier stored My-Money-Rules feature, new Ask intents) stay
deferred as genuine polish below the plan's "markedly better" stop bar (§7 + #80). Gate:
core verify GREEN (**1014 unit / 77 files**), axe e2e for /accounts + /coach 2/2.

NOTE (env, not a code defect): a full `VERIFY_E2E=1` run's lone failure is
`phase2-triage` "a full review session completes in <15 interactions" — it times out
on a `disabled`-while-`pending` accept button under SQLite write contention (1/4 pass
in isolation). This is the OneDrive/SQLite `SQLITE_BUSY` flake class already recorded
in item #16 below; it occurs on a page this work never touched (the entire Coach
Principles delta since the pre-work commit is a nullable `Account.minimumPaymentCents`
column + its nullable seed field — zero triage/transaction/provider code), so it is
not a regression. The documented bigger fix (move the test DB to %TEMP%) remains the
deferred infra item in #16.

Accepted P2s (independent hostile Checker, 0 P0/P1):
14. The WAL regression test catches an unwired globalSetup on a fresh/CI checkout
    (dev.db created in rollback mode) but NOT on a dev machine whose dev.db is already
    persistently WAL — an accepted blind spot (the pipeline path is covered).
15. The e2e global-setup does not separately enforce WAL; e2e is low-contention and
    inherits the persistent-WAL file in practice.
16. OneDrive (the repo lives under OneDrive\) can hold a transient OS lock on dev.db /
    -wal / -shm that WAL cannot prevent; a future transient SQLITE_BUSY there is NOT a
    WAL regression. Deferred bigger fix: move the test DB out of the synced tree (%TEMP%).
    **PARTIALLY RESOLVED 2026-06-27 (#120):** the unit + e2e SQLite DBs now live under
    the OS temp dir, off the synced tree (tests/setup/test-db.ts). This FULLY fixes the
    UNIT SQLITE_BUSY flake (the SimpleFIN "expected 0 to be 2"; unit suite green + fast,
    reliably). The e2e flake is reduced but NOT eliminated — see the dated section below.

## 2026-06-26 (resumed session) — REC-2 income-raise fix + prod HSTS + privacy-doc accuracy (DECISIONS #118–119)

Picked up the actionable items from the 2026-06-26 handoff (the Plaid questionnaire is user-action). Shipped:
- **REC-2 (#118):** recurring INCOME raises no longer render as red "price increase" warnings — engine `!isIncome`
  at summary.ts (`priceIncreases`) + insights.ts (`findOpportunities`), and the per-row badge tone extracted to a
  pure `priceChangeBadge()` and unit-locked. Seed payroll is flat → golden-safe. New
  tests/unit/recurring-income-raise.test.ts (proven to fail without the fix).
- **HSTS + privacy doc (#119):** production-gated `Strict-Transport-Security: max-age=63072000; includeSubDomains`
  (no preload) in next.config.ts, asserted in the phase4 e2e (prod build); PRIVACY.md rate-limiter line corrected to
  the durable DB-backed limiter (RateLimit table; export + per-IP/per-account auth throttle, STATUS #48) + CSP
  wording softened (Plaid origin allowlisted). NOT pushed — deploy + the 2-year HSTS commitment are the owner's call.

Hostile critic wf_1ba761ed (4 dims → adversarial verify): **0 P0 / 0 P1, 2 P2 (both FIXED)**. Gate:
`bash scripts/verify.sh` → ✅ GREEN (1140 unit / 93 files, +7 over baseline; typecheck/lint/build clean).

17. **E2E throughput flake reaffirmed (NOT a regression).** The changed surfaces pass every run (HSTS phase4:79;
    recurring:14/:20), but `phase2-triage:82` ("a full review session in <15 interactions") still times out under
    the OneDrive/SQLITE_BUSY contention of item #16. It is a CUMULATIVE-throughput test (~15 sequential accept→DB
    writes inside a 60s budget), so unlike a single-action flake it cannot be cleared by `--retries=2` (the shorter
    triage:29 did go flaky→pass). The page is untouched by this diff. Durable fix = the #16 item (e2e DB off the
    OneDrive-synced tree) or developing on a plain local disk per CLAUDE.md.
    **UPDATE 2026-06-27 (#120):** the e2e DB is now off the synced tree (+ WAL), but this did NOT eliminate the
    e2e flake — measured 3/5 full-suite runs green, and the failures were wall-clock timeouts of DIFFERENT correct
    tests run-to-run (phase2-triage throughput AND transactions register-search), not just one page. Root cause is
    broader than the DB: the `next start` server, the `.next` build, and the app files all still live on OneDrive,
    so its sync I/O contends with the server's synchronous better-sqlite3 round-trips. The COMPLETE e2e fix is the
    OTHER half of the #16 disjunction — relocate the whole working copy off OneDrive (CLAUDE.md), the owner's
    environment call. The e2e flakes are correct tests timing out under load, clearable by re-run, not code defects.

## 2026-06-27 (resumed) — Test/e2e DB relocated off the OneDrive tree (durable #16/#17 fix, DECISIONS #120)

Picked up the deferred durable fix for the SQLITE_BUSY flake class (the only un-gated engineering item left in the
handoff). The unit (vitest) and e2e (playwright) suites resolved DATABASE_URL to the repo-root `file:./dev.db`, under
OneDrive; the sync client's external OS locks on .db/-wal/-shm starved SQLite writers (masked as the SimpleFIN
"expected 0 to be 2"; aggravating the e2e phase2-triage throughput timeout). In-process mitigations (WAL,
busy_timeout, fileParallelism:false) can't wait out an external lock.

**Fix:** `tests/setup/test-db.ts` points the unit + e2e SQLite files at the OS temp dir (TEST_DB_DIR override,
mkdir'd; per-checkout hash so this OneDrive copy and the stale C:\dev copy don't share one file). vitest +
playwright configs set DATABASE_URL to it; both global-setups `db push` → WAL → `db seed` the off-tree file (e2e
WAL is set by a tsx child `scripts/set-sqlite-wal.ts` — the generated Prisma client is CJS and can't import into
Playwright's ESM config loader). Locked by `tests/unit/test-db-location.test.ts`. NO production surface (db-adapter
/ next.config untouched; `npm run dev` keeps the repo-root dev.db; prod = Postgres #35); nothing ships in the bundle.

**Outcome (honest):** the UNIT SQLITE_BUSY flake is FIXED — core `bash scripts/verify.sh` GREEN and FAST across
many runs (1142 unit / 94 files, +2 regression tests). The e2e suite is improved (DB off-tree + WAL) but STILL
flakes ~2/5 under load — the residual cause is the whole working tree on OneDrive (server/.next/app I/O), not the
DB. Documented at #16/#17; complete fix = relocate the working copy.

**Hostile critic** wf_d9503a9a (4 dims → adversarial verify): **0 P0 / 0 P1, 10 P2.** Applied 5: location test
honors TEST_DB_DIR (else the documented /dev/shm CI example would go red); mkdir the TEST_DB_DIR; per-checkout
hashed filename; accurate re-seed wording (RateLimit isn't wiped but its tests are key-isolated); documented the
reuseExistingServer/port-3100 assumption. Accepted P2s: same-checkout CONCURRENT runs (vitest --watch + verify)
still share a file (set TEST_DB_DIR); a server squatting on 3100 started from the repo would bypass the relocation
(verify 3100 free; CI spawns fresh).

## 2026-06-27 (resumed) — working tree relocated off OneDrive → C:\dev\Aimplifi (completes the #16/#17 e2e half) + transactions:145 hardened

The owner approved the #16/#17 COMPLETE fix (relocate the whole working copy off the synced tree). Done
non-destructively: robocopy'd the active checkout → `C:\dev\Aimplifi` (excluding regenerable node_modules/.next/
.codegraph + test artifacts; INCLUDING .git with the unpushed commits + all secrets .env*/keys/dev.db), then a fresh
`npm ci` (788 pkgs + prisma generate) on local disk. The OneDrive copy is retained as a reversible fallback.

**Measured at the new location:** core `verify.sh` GREEN (1142 unit/94 files); `VERIFY_E2E=1` full suite **54/54**.
The #16 e2e residual (phase2-triage:82 throughput timeout that no in-tree mitigation could clear) now runs in
14-24s and passed on EVERY run — confirming #120's finding that the residual was whole-tree OneDrive sync I/O
contention. Items #16/#17 are RESOLVED for the new checkout (the OneDrive copy is abandoned, not repaired).

**transactions:145 (inline recat) latent race — FIXED** (DECISIONS #121, REGRESSION_LEDGER 2026-06-27): the positive
assert matched the in-flight 'File as Groceries?' confirm prompt on the whole row → passed before persistence, so the
negative `not.toContainText('Dining Out')` raced `router.refresh()` on a 5s budget. App verified correct; the
assertion now targets the category-chip with a 20s budget on both sides. **4/4 consecutive full-suite runs green
post-fix.**

**Process caveat:** future sessions MUST run from `C:\dev\Aimplifi`; if work happens in the OneDrive copy out of
habit, the two repos diverge. CLAUDE.md's canonical-path note is updated to prevent this.

## Post-Phase-5 refinement: Plan in Words — debt-free-by-date (DECISIONS #125)

The first AI-differentiation build from `docs/AI_DIFFERENTIATION_PLAN.md` §5 (owner-chosen):
an INVERSE debt planner. State a goal date and the app SOLVES the tested debt engine for
the minimal extra/mo, with honest feasibility. New pure `engine/solve/debt-free-by-date.ts`
`solveDebtFreeByDate` bisects the monotone `planDebtPayoff` (the shipped `coastFI` idiom —
no new debt math); the answer is a share of real `getSpendingPlan` safe-to-spend. New Ask
intent `debt_free_by_date` (a deterministic `parseTargetDate` owns date extraction zero-key;
the LLM, if it routes here, supplies only the kind). "Confirm & save as goal" via
`saveDebtFreeGoal` re-solves server-side (never trusts a client number) and tags
`Goal.kind='debt_free'` (new nullable column) so /goals renders it with the solver's date,
not the savings-goal timeline. Engine-first; the LLM never originates a number or a date.

Gate (real output 2026-06-28): `bash scripts/verify.sh` core → **✅ VERIFY GREEN** —
typecheck/lint clean, **1281 unit / 102 files**, build clean. Full `VERIFY_E2E=1`: **55/57
passed** (+1 new debt-free-by-date e2e), with the ONE documented `phase2-triage:82`
throughput flake (triage-accept button stuck `disabled` mid-write → 60s `locator.click`
timeout) — an untouched page, machine saturated by this session's heavy runs; identical
symptom to STATUS #16/#17 + DECISIONS #88/#99/#120/#121; confirmed it on isolated rerun, NOT
a regression. All changed surfaces pass every run: ask.spec **6/6** (incl. the new inverse-
planner flow + axe AA), phase4-features goals + phase5-a11y goals green (the debt-aware
goals card did not regress the savings-goal renderer).

Hostile critic (wf_8faca37d, 5 dimension critics + adversarial verification): all dims 7/10,
**0 P0, 3 confirmed P1 — ALL FIXED + regression-locked**, then a confirmation cycle
(wf_ab686016) re-verified the fixes:
- **P1 goal render/drift** — the saved goal rendered via the generic savings card (flat
  `remaining/extra` ETA contradicting the solver, "moves your FI date back" framing,
  `targetDate` never shown, on-track→$0→"add a contribution") → debt-aware `Goal.kind` card
  showing the date + the suggested extra (or "on track … no extra needed"), bypassing
  `goalFIImpact`; savings goals render unchanged.
- **P1 parse misroute** — a month mentioned in passing + "by `<year>`" ("…loan in March …
  debt-free by 2028") parsed to March 2028 → the bare-year deadline is now resolved BEFORE
  the month loop and the global "any year in the string" fallback dropped (adjacent-year
  only); "by December 2027" still resolves correctly. Regression-locked.
- **P1 overspent fake-yes** — safe-to-spend ≤ 0 returns `withinSafeToSpend:null`, and the
  formatter's `=== false` check skipped the warning → an honest "budget you don't have yet"
  branch for the overspent cohort (real figure shown, no fake affordable framing).

P2s fixed: `hi` grows past one month's interest (no false "unreachable" at pathological APR),
de-doubled the over-budget clause, past-date copy ("already behind us"), Save button disabled
while a question is in flight + kept mounted on save (focus preserved, no nested `role=status`),
"in N → end of month", "by next/this month" + "done with my debt" routing, and new tests
(non-divisible share rounding, snowball + tighter monotonicity, high-APR reachable, overspent
formatter, non-zero server re-solve). Accepted P2s (documented): a bare credit-card question
stays `cash_needed` even with a date (DECISIONS #98 convention, pinned); the /goals debt-card
render + Save success/error states are display-layer, covered by inspection (the save
persistence is integration-tested; can't e2e without mutating the shared demo's goals).

## Post-Phase-5 refinement: Plan in Words — savings-goal-by-date (DECISIONS #126)

The second AI-differentiation slice (after #125's debt-free-by-date): state an amount + a
date ("save $20,000 by December 2028") and the app SOLVES for the minimal monthly
contribution, with honest feasibility (share of safe-to-spend, within-budget flag). New pure
`engine/solve/savings-goal-by-date.ts` `solveSavingsGoalByDate` — funding is LINEAR (no
investment growth; closed-form `ceil(remaining/targetMonths)`, NOT a bisection, because
savings doesn't amortize). The funding-months formula is extracted to one shared
`goals.ts::goalFundingMonths` used by BOTH the solver and the /goals `goalFIImpact` card, so a
saved goal renders a byte-identical timeline (the #125 card-vs-solver P1 designed out — no new
`Goal.kind` needed). The user-stated AMOUNT is extracted deterministically by a new
`parseTargetAmount` (the LLM supplies only the kind; the amount/date are re-derived in code);
a date with no amount → an "ask for the amount" answer. `saveSavingsGoal` re-solves the monthly
server-side (the client passes only the stated amount + date; the contribution is never trusted).

Gate (real, measured 2026-06-28): core `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
typecheck/lint/build clean, **1328 unit / 105 files** (+46). ask.spec e2e **7/7** (new
savings-by-date flow + axe WCAG-AA + debt sibling no-regression).

Hostile critic (wf_3de855be, 5 dims → adversarial verify): **0 refuted; 1 P0 + 1 P1 confirmed,
both FIXED + regression-locked**, then a confirmation critic (wf_99a99d0d) re-verified the fixes:
- **P0 (parseTargetAmount truncation):** an ungrouped 4+ digit `$` amount truncated to its first
  3 digits — "$20000"→$200 (regex alternation matched the first branch without backtracking), a
  100×-wrong figure persisted on Save → fixed by requiring ≥1 comma-group (`+` not `*`).
  REGRESSION_LEDGER 2026-06-28.
- **P1 (canonical phrasing missed):** "have $X **saved** by <date>" routed to unknown because
  `saveVerb` didn't match the past participle → added "saved".
- **3 P2 mis-routes FIXED:** past/status review poached into the "ask" path; a per-period RATE
  ("$500 a month") misread as the lump total; a comma-grouped NON-money quantity ("10,000 steps")
  read as $10,000.
- **Confirmation round caught my P2 guards OVER-blocking** (the broad rate/past guards blocked
  the feature's own canonical demo-mode ask "how much per month to save $20,000 by 2027", and
  amount-bearing forward goals) → fixed by making the rate-guard PRECISE (a rate only when a
  period cue is adjacent to a dollar figure) and applying the past guard ONLY to the amount-free
  path; locked + an 18-case routing probe (real output) green.

Accepted P2s (documented, by design):
1. **Two-amount sentences pick the leftmost amount** — "I have $20,000 saved, goal of $50,000 by
   2028" plans for the stated $20,000, not the $50,000 goal (`parseTargetAmount` returns the
   leftmost match). It is a *mis-role of a number the user actually typed* (surfaced in the
   answer), NOT a fabrication, and needs an uncommon two-amount phrasing; full disambiguation is
   deferred. The save path re-solves the (mis-roled-but-user-stated) amount, so no app-originated
   figure is ever persisted.
2. **A contrived income question embedding "saving $X by <year>"** can be poached by the savings
   block (it sits before the income intent). Low likelihood; `savings_rate` (the common collision)
   is correctly NOT poached.
3. The /goals savings-card target-date line + the Ask "Save as a goal" success/error states are
   display-layer, covered by inspection (save persistence is integration-tested; can't e2e
   without mutating the shared demo's goals).

NOTE (env, not a code defect): an e2e `phase4-features.spec.ts:32` ("goals: creating a goal")
failed repeatedly in this session's degraded environment — but it fails IDENTICALLY at baseline
HEAD with a clean rebuild (proven by stash + rebuild), the delete persists to the DB correctly
(verified), and `router.refresh()` simply isn't dropping the card here even at a 20s budget. It
passed in #124 (56/56) and #125. This is the documented OneDrive/long-session e2e-flake class
(STATUS #16/#17), on a page this feature does not touch; NOT a regression from #126.

## Live provider ingest — contract audit + first fixes (DECISIONS #127)

**Framing correction (important).** The owner runs the app in PRODUCTION with REAL aggregator
credentials: Plaid is on `PLAID_ENV=production` (Vercel env) and SimpleFIN Bridge has all their
accounts linked (the encrypted access URL lives in the `SimpleFinConnection` DB row, by design —
DECISIONS #56 — so there is no SimpleFIN env var). The repeated "Plaid/SimpleFIN live path is
UNVERIFIED (no token in env)" notes elsewhere in this doc and in the mapper headers describe the
CI/TEST SUITE (which has no creds and runs against mocks), NOT the owner's deployment. Those paths
DO run on real money data every sync. The mappers' ledger math is unit/mock-tested; what CI never
exercised is the live socket + the providers' real field shapes — which the owner's accounts now do.

Because real data flows through code written against mocks, ran an adversarial CONTRACT AUDIT
(wf_6eade83c, 5 reviewers vs the official Plaid/SimpleFIN response schemas → adversarial verify of
every P0/P1). Result: **1 P0 (downgraded P1 on verify) + 10 P1 + 9 P2 confirmed.**

**FIXED now (DECISIONS #127, two clusters, hand-verified + regression-locked):**
- **SimpleFIN balance SIGN + TYPE (audit #1/#2/#8/#9):** `mapSimplefinAccount` did `Math.abs(balance)`
  on every account, so an OVERDRAWN deposit account was stored as a positive ASSET (net-worth sign
  inverted), and a keyword-less liability (HELOC, a loan under a servicer name, a no-keyword card like
  "Active Cash") defaulted to CHECKING and only the negative-balance rescue saved it — so a
  positive-principal loan booked as an asset. Fix: store the SIGNED balance for assets (overdraft
  stays negative) and `|amount owed|` for liabilities (SimpleFIN gives NO liability sign convention —
  a card may report owed-negative, a loan positive-principal — so the magnitude is the robust owed
  value); broadened `inferAccountType` with no-keyword card products + a non-card-liability branch
  (heloc/home-equity/line-of-credit/servicers) checked BEFORE the generic "credit" rule. Net-worth
  contribution hand-verified per case in `tests/unit/simplefin-map.test.ts`. KNOWN EDGE (documented in
  code): a genuine OVERPAID card credit balance is indistinguishable from owed-reported-positive, so
  it's treated as a small owed amount (rare).
- **Plaid APR (audit #7):** `aprs[]` was never mapped, so EVERY live Plaid card carried `aprBps`
  null/0 → the debt-payoff + cash-needed engines computed ZERO interest on real cards (corrupting the
  just-shipped debt-free-by-date + cash-needed figures). Fix: new pure `pickPlaidAprBps` (purchase APR
  → bps, fallback highest non-special, integer-rounded ×100 so no float drift) wired into the
  `/liabilities/get` loop to set `Account.aprBps` (even when no statement has generated yet). Locked by
  `tests/unit/plaid-map.test.ts`. (SimpleFIN has no APR field in its protocol, so SimpleFIN cards keep
  a user-entered/blank rate — expected.)

**TRACKED backlog (confirmed real, NOT yet fixed — prioritized for follow-up increments):**
1. **(P1, audit #4) SimpleFIN pending never reconciled** — ✅ **DONE (DECISIONS #128, 2026-06-28)** — see
   the dedicated section directly below. A pending that never posts lingered forever, and a
   pending→posted `id` change double-counted. Fixed with a two-pass `reconcilePendingTransactions`
   (in-window absence reconcile + an age-out backstop).
2. **(P1, audit #5) SimpleFIN holdings per-share round-trip** — ✅ **DONE (DECISIONS #129, 2026-06-28)**.
   Persisted the feed's authoritative TOTAL as a new nullable `Holding.marketValueCents`; `valuePosition`
   uses it verbatim when present, else derives round(qty×price). A penny lot no longer renders $0; the VOO
   −1¢ drift is gone. Net worth untouched (only the /investments breakdown). Hostile critic: 1 P1 FIXED —
   the new Int column is Postgres 32-bit ($21.4M/position ceiling); an over-ceiling total would overflow +
   be silently swallowed by the reconcile catch → mapper now bounds every persisted cents value to
   MAX_DB_CENTS (skip+count, not silent vanish). 3 P2 FIXED (engine self-validation; "≈" approximate
   per-share display; softened addHolding comment). **Residual / accepted (documented):** a single position
   over $21,474,836.47 is skipped+counted (out of model scope; widening these total columns to BigInt is the
   follow-up if such positions come into scope — the cost-basis column has always had the same Int ceiling).
   A hand-edited fed symbol keeps `source='simplefin'` so a later sync may re-ingest it (pre-existing #124).
3. **(P1, audit #6) Plaid investment/loan balances freeze at link time** — only refreshed on link, not
   on sync, so net worth goes stale. Fix: call `syncAccountsForItem` (or `/accounts/balance/get`) each
   sync.
4. **(P1, audit #3/#10) Currency never read** (both providers) — a non-USD or zero-decimal (JPY/KRW)
   balance is summed into net worth at a fake 1:1 / 100×-off rate. Almost certainly N/A for a US-only
   user, but unguarded. Fix: read `currency`/`iso_currency_code`; exclude-or-FX non-USD at the
   net-worth boundary (a withheld figure beats a silently wrong one).
5. **P2s (9):** epoch→date UTC-day-boundary (evening txn can land a day off); SimpleFIN symbol regex
   drops options/crypto/slash share-class tickers; all-unmappable-holdings → `[]` is treated as
   "sold everything" and deletes synced rows; Plaid null `balances.current`→0; Plaid
   `last_statement_balance` run through abs() (a statement CREDIT flips to owed); Plaid null
   `minimum_payment_amount`→$0 (worse than the estimate path); Plaid `liabilities.mortgage[]` /
   `student[]` dropped (only `credit[]` read). Each carries a suggested fix in the audit output.

Recommendation: tackle the backlog in small, individually-verified increments (each its own DECISIONS
entry + regression test), highest-money-impact first (pending reconcile, then holdings total, then the
Plaid balance refresh), rather than one large risky change.

## SimpleFIN pending reconcile — backlog #4 DONE ✅ (DECISIONS #128)

Closed the highest-money-impact live-ingest backlog item. `reconcilePendingTransactions` runs after the
Pass-2 transaction upsert in `syncFromSimplefin`, in two passes: (1) IN-WINDOW — per account synced this
run, delete feed-owned PENDING rows (date >= startDate) the snapshot no longer reports; (2) AGE-OUT —
delete feed-owned PENDING on the user's SimpleFIN accounts older than `PENDING_MAX_AGE_DAYS = 32`,
excluding anything the current snapshot still reports as pending. Kills both #127-audit failure modes: a
pending that never posts (lingered, overstated the cash-needed sum) and a pending re-posting under a new
id (double-count). Safety rails on the deleteMany: `status:'PENDING'` (POSTED never touched),
`providerRef:{not:null}` (manual/seed rows never touched), `isSplitParent:false` (no orphaned split),
passes date-disjoint. Golden-safe (demo never connects SimpleFIN; `SyncResult.removed` has no UI consumer).

Gate (real 2026-06-28): `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1343 unit / 106 files** (+11
known-answer, proven fail-before/pass-after), typecheck/lint/build clean. Hostile critic wf_35ef0562 (3
dims + adversarial verify): 0 refuted, **2 P1 confirmed + FIXED** (age-out for aged-pending drift past the
fetch window; `!acct.transactions` null guard replacing a `=== undefined` regression that let
`transactions: null` abort the whole sync), each regression-locked.

Accepted residuals (P2, documented in code + DECISIONS #128):
- A multi-day hold that drifts past the 5-day overlap then re-posts under a NEW id can briefly double-count
  until it ages out (≤ 32 days, self-healing). Eliminating it needs a wider per-sync fetch window, which
  would expand the existing re-sync re-categorization churn + bandwidth for a rare, self-correcting case.
- An account entirely ABSENT from a sync response isn't in-window-reconciled (its aged pendings are still
  swept by the age-out pass).
- The delete can orphan a Correction / CategoryPrediction analytics-log row (linked by id-string, no FK) —
  harmless and consistent with the Plaid `removed[]` path.

REMAINING live-ingest backlog: ~~**#5** SimpleFIN holdings per-share round-trip~~ ✅ DONE (DECISIONS #129);
~~**#6** Plaid investment/loan balance refresh each sync~~ ✅ DONE (DECISIONS #130); plus the currency
(#3/#10) + 9 P2 items from the #127 audit.

## Plaid per-sync balance refresh — backlog #6 DONE ✅ (DECISIONS #130)

Closed the last named live-ingest P1 from the #127 audit. `PlaidProvider.syncTransactions` refreshed an
account's balance only when `/transactions/sync` echoed it in its `accounts` array — i.e. depository/credit
accounts with transaction activity. INVESTMENT and LOAN accounts carry no Transactions product, so they were
re-fetched ONLY at link (`exchangePublicToken` → `syncAccountsForItem`) and their `currentBalanceCents` —
hence the owner's net worth — froze afterward. Fix: call the already-tested `syncAccountsForItem`
(`/accounts/get`, which returns EVERY account on the item) once per item at the start of each sync, before
the cursor loop; the loop's `page.accounts` echo still wins (fresher-or-equal) for active accounts.
Best-effort + audited (`plaid.accounts.refresh.failed`) so a refresh failure never blocks transaction ingest.
Reuses `/accounts/get` (cached, no per-call fee) over the billable real-time `/accounts/balance/get`, as the
audit recommended. Golden-safe (the demo never uses PlaidProvider). This also adds the FIRST mocked-server
integration test of the Plaid network orchestration; the live socket stays UNVERIFIED, consistent with the
existing labeling.

Gate (real 2026-06-28): `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1369 unit / 107 files** (+5 across one
new file, proven fail-before/pass-after), typecheck/lint/build clean. No e2e surface (server-only sync; the
demo never connects Plaid → the mocked-server integration is the labeled end-to-end, per #124/#128/#129).

Hostile critic wf_25be9884 (3 lenses + adversarial verify): **0 P0, 1 P1 confirmed + FIXED + regression-locked.**
The P1: now that investment/loan balances refresh every sync, a `/accounts/get` reporting a null
`balances.current` (documented-nullable) ran through the mapper's `?? 0` and would OVERWRITE a real balance
with $0 — silently cratering net worth until a later non-null sync self-heals. Fix = map a null `current` →
null (UNKNOWN, not 0) and OMIT `currentBalanceCents` from the UPDATE data when null so Prisma preserves the
last-known-good value (CREATE falls back to 0 — no prior to preserve); fixing it in the shared
`upsertPlaidAccounts` ALSO closes the same pre-existing hole on the depository/credit echo path. Independent
confirmation checker: SHIP, 0 P0/P1 (and confirmed the fix is robust to either `/accounts/get` or the
`/transactions/sync` echo writing null — last-writer preserves).

Accepted residuals (P2, documented in DECISIONS #130):
- Per-sync audit-log noise: a `plaid.account.skipped` row each sync for a permanently-unmappable account, and
  double rows (`refresh.failed` + `item.sync.failed`) on a full item outage — cosmetic, zero ledger/net-worth
  impact.
- The access token is decrypted twice + the item re-fetched per item per sync (the sync loop has the token,
  but `syncAccountsForItem` re-derives it) — negligible at hourly cadence; kept surgical rather than widen the
  method signature.
- `availableBalanceCents`/`creditLimitCents` still write through a null value (both nullable by design and
  non-net-worth; null is a legitimate state for them, unlike `current` where a balance always exists).

## 2026-06-29 — Plan-in-Words slice 3: retire-at-age inverse planner (DECISIONS #131)

The final Plan-in-Words slice (after debt #125 + savings #126), completing the owner-sequenced trilogy. "Can I
retire at 60?" → `solveRetireAtAge` bisects the boolean `projectRetirement(...).outcome==='sustained'` (the #122
decumulation engine, via the same `buildRetirementInputs` the /investments outlook uses — no new compounding math)
for the minimal monthly contribution that makes the portfolio last, framed as an honest share of real safe-to-spend.
Grounded: every figure from `getCoachData.fi` + the User planning dials (?? the documented defaults) + `getSpendingPlan`;
the LLM supplies only the intent kind, the age is deterministic (`parseTargetAge`). "Save as my plan" persists the age
to the existing `User.retirementAge` dial (not a flat Goal, which would contradict the compounding engine). Read-only
Ask path + demo planning columns null → byte-identical to #122/#123 (golden-safe). Hostile critic wf_c5d22775 (4 dims +
adversarial verify): **0 P0 / 0 P1**; 1 P1 candidate downgraded to P2 + 2 more P2 all FIXED + regression-locked
(inflection coverage "retiring"/"retired"; the age==endAge answer-vs-save inconsistency; "saving"→"savings"). Gate:
`bash scripts/verify.sh` → ✅ VERIFY GREEN (1409 unit/110 files, +40; typecheck/lint/build clean); ask.spec e2e 8/8 incl.
the new retire-at-age flow + axe AA.

Accepted P2 (documented, by design):
- **The solver fails LOUD on a structurally-invalid PLANNING age** (currentAge ≥ endAge, non-integer, out of [0,120]) —
  those reach `projectRetirement` and throw, rather than returning a clean `unreachable`. The solver only guards the
  USER-facing `targetAge` (age-in-past / age-after-end / cannot-sustain); the planning ages are always app-validated
  (User columns through the dials validator, or the documented defaults), so this throw is unreachable from the app and
  fail-loud on a programming error is correct (matches the #122 / STATUS #13 API-consumer precedent).
- **E2E throughput flake reaffirmed (NOT a regression).** The phase's own e2e (ask.spec, all 8 incl. retire-at-age,
  `:107` ✓ 6.6s) passes reliably, but a full-suite run during this heavy session failed `phase2-triage:82` (the
  ~15-sequential-accept-in-60s throughput test) with the documented symptom — the triage accept/`rule-always` button
  stuck `disabled` mid-write → `locator.click` timeout, under SQLite single-writer contention. It reproduced in
  isolation too because the machine was still write-saturated from this session's many back-to-back verify/critic/e2e
  runs (the #122/#123 finding: re-running only worsens it). The page is UNTOUCHED by #131 (retire-at-age → /coach is a
  one-way edge; zero triage/transaction/provider code in the diff). Same class as STATUS #16/#17, DECISIONS
  #88/#99/#120/#121/#122/#123 — clears on a settled machine, not a code defect.

## 2026-06-29 — Plaid credit-liability statement-field correctness (DECISIONS #132, live-ingest backlog)

Resumed on "continue" with the Plan-in-Words trilogy (debt #125 / savings #126 / retire-at-age #131)
complete + deployed; owner chose the LIVE-MONEY CORRECTNESS backlog over the next feature (Cash Flow
Radar). Picked up the highest-money-impact remaining items from the #127 live-ingest audit — both in the
Plaid credit-liability → statement mapper, both corrupting the cash-needed headline on the owner's REAL
connected Plaid cards:
- **abs() flip:** `mapPlaidLiabilityToStatement` mapped `last_statement_balance` through
  `plaidDollarsToPositiveCents` (abs), so a statement CREDIT / overpayment (negative balance) flipped to
  an amount OWED → a card the holder overpaid would DEMAND cash it doesn't owe. Fix: sign-preserving
  `plaidSignedDollarsToCents`; the engine's `floorAtZero` then yields a correct $0 obligation.
- **null/zero minimum → $0:** a null (or literal 0) `minimum_payment_amount` collapsed to a $0 minimum,
  understating the MINIMUM-path cash needed below the engine's own no-statement estimate. Fix: when no
  usable (>0) minimum is reported on a positive balance, mirror the engine's exact estimate by reusing a
  now-exported `estimateMinimumPayment` (max $35 / 1% of balance) — one definition, no drift.

Golden-safe by construction (common positive-balance + provided-positive-min path byte-identical; demo
never connects Plaid). Gate (real, measured): `bash scripts/verify.sh` → ✅ VERIFY GREEN, typecheck/lint/
build clean, **1417 unit / 110 files** (+8, proven fail-before/pass-after). No e2e surface (server-only
mapper; the labeled unit + mapper→cash-needed ENGINE end-to-end is the coverage, per #124/#128/#129/#130).

Hostile critic wf_edd3d8f3 (4 dimension critics → adversarial verification of every P0/P1): **0 P0 / 0 P1.**
Two P2s FIXED + regression-locked: (a) a PROVIDED 0 (or sub-cent) minimum on a positive balance reproduced
the same understatement → a "usable" minimum is now >0 (a reported ≤0 falls through to the estimate); (b)
the $0 guarantee for CONTRADICTORY feed data (a credit balance reported with a positive minimum) was
unpinned → pinned with a mapper known-answer + a mapper→computeCashNeeded e2e under both scenarios.

ACCEPTED/DEFERRED P2 (documented): an estimated minimum is presented with `isEstimated:false` and no
per-card "minimum estimated" disclosure. Honoring the cardinal "assumptions inline" rule here would need a
PERSISTED `Statement.minimumIsEstimated` column threaded through the sacred cash-needed engine + types
(the assemble layer reads stored Statement rows and cannot re-derive whether a minimum was synthesized) —
disproportionate to the rare trigger (Plaid omitting the minimum on a card that HAS a generated statement).
The estimate is conservative and equals the engine's own no-statement formula; in the MINIMUM scenario it
only ever errs toward funding more (paying ≥ an estimated minimum is always safe).

REMAINING #127 live-ingest backlog (confirmed-real, NOT yet fixed): the currency guard (audit #3/#10,
likely N/A for a US-only user but unguarded) + the rest of the audit's P2 cluster — Plaid
`liabilities.mortgage[]`/`student[]` dropped (only `credit[]` read), all-unmappable-holdings `[]` treated
as "sold everything" (deletes synced rows), epoch→date UTC-day-boundary, SimpleFIN symbol regex dropping
options/crypto/slash tickers. Tackle in small individually-verified increments, highest-money-impact first.

## 2026-06-29 — SimpleFIN all-unmappable-holdings data-loss guard (DECISIONS #133, live-ingest backlog)

Second live-money backlog increment this session (after #132). Closed the #127 audit P2 where a SimpleFIN
sync could WIPE the owner's synced /investments breakdown. `syncFromSimplefin`'s INVESTMENT branch
reconciled holdings whenever `acct.holdings !== undefined`; since `mapSimplefinHoldings` skips un-mappable
positions, a NON-EMPTY feed whose positions ALL fail to map returned `holdings:[]`, and the reconcile's
empty-set branch (`deleteMany({accountId, source:'simplefin'})`) deleted every synced row — mistaking a
format glitch / all-unsupported-types feed for a sell-all.

Fix: reconcile only when `holdings.length > 0 || acct.holdings.length === 0` (positions to write, OR an
EXPLICITLY empty feed = a genuine sell-all); a non-empty feed mapping to zero leaves existing rows intact
(counted as skipped) and self-heals on the next sync that maps any position — the same conservative stance
as the OMITTED-field guard (#124 P2). NET WORTH UNAFFECTED (account.currentBalanceCents stays authoritative;
holdings are a within-account breakdown). GOLDEN-SAFE (demo never connects SimpleFIN).

Hostile critic wf_8a9d99dc (2 dims → adversarial verify; one dim hit a mid-response API error, the other
returned the finding): **0 P0 / 0 P1**; **1 P2 FIXED + regression-locked** — the outer guard tested
`!== undefined`, so an untrusted feed sending `holdings: null` (not omitted) reached `mapSimplefinHoldings(null)`
→ "null is not iterable" → ABORTED the whole sync (the `transactions: null` failure class fixed in #128),
and a `holdings: ""` would even wipe via `.length`. Changed the guard to `Array.isArray(acct.holdings)` so
undefined/null/any-non-array all route to "leave rows intact".

Gate (real, measured): `bash scripts/verify.sh` → ✅ VERIFY GREEN, typecheck/lint/build clean, **1419 unit /
110 files** (+2, proven fail-before/pass-after). No e2e surface (server-only sync; the mocked-server
integration is the labeled end-to-end, per #124/#128/#129/#130).

REMAINING #127 live-ingest backlog (confirmed-real, NOT yet fixed): Plaid `liabilities.mortgage[]`/`student[]`
dropped (only `credit[]` read — these loans get no statement/due-date in cash-needed/calendar; net worth is
correct via the account balance) — the biggest remaining item, needs a small design call on how loan due
dates surface; currency guard (audit #3/#10, likely N/A for a US-only user); epoch→date UTC-day-boundary;
SimpleFIN symbol regex dropping options/crypto/slash tickers (coupled to the addHolding ticker rule, so a
wider change). Tackle in small individually-verified increments.

---

## #134 — Plaid mortgage/student loans → calendar + reminders (2026-06-30)

Biggest remaining #127 live-ingest item, SHIPPED (owner picked the surface = "Calendar + reminders", NOT the
cash-needed dollar headline). `syncLiabilities` now ingests `liabilities.mortgage[]`/`student[]` → populates
each loan Account's aprBps + minimumPaymentCents + dueDayOfMonth (preserve-on-null #130; mortgage subtype →
MORTGAGE, excluded from the snowball; student/other → LOAN). A new pure `selectLoanObligations` engine
surfaces the next loan payment on the calendar (`loan-due` event) + reminders ONLY — the cash-needed engine is
untouched. Seed `sched-autoloan` stand-in removed (loan now first-class). Gate: VERIFY GREEN, 1444→ unit /
113 files; e2e calendar/reminders/a11y 15/15 clean.

Hostile critic wf_d388bf4b (3 lenses → adversarial verify): **0 confirmed P0/P1.** 2 mapper money-bugs FIXED
+ regression-locked: (F1) `> 0` checked on the PRE-rounded value, so a sub-cent payment / sub-bps rate wrote a
fabricated 0 (zeroing a stored value) → now round-FIRST then `> 0`; (F2) a huge finite payment threw via
cents()'s safe-integer assert (aborting the item's whole liability sweep) despite the "non-throwing" comment →
now magnitude-bounded to the Postgres Int ceiling BEFORE rounding, returns null.

### KNOWN LIMITATIONS / NEXT (owner-gated de-dup design)
A loan payment is representable two ways — a recurring-detected/scheduled cash outflow (existing) AND the new
loan-due obligation — and #134 does not de-duplicate between them. Two consequences, both documented, neither a
confirmed P0/P1:
1. **Demo /forecast inconsistency:** `getCashFlowForecast` reads `snap.scheduled`; removing `sched-autoloan`
   dropped the demo's only scheduled loan row, so the demo forecast over-projects checking by $385/mo and is
   inconsistent with its own calendar/reminders (which DO show the loan). Real users are unaffected here (their
   loan ACH is still recurring-detected into `snap.scheduled`). Negligible ($385 on $340k) but a visible demo
   gap.
2. **Real-user calendar double-display (narrow):** a connected MORTGAGE/STUDENT loan whose monthly payment is
   ALSO recurring-detected as a NON-transfer checking outflow would show twice on the calendar (recurring
   outflow + loan-due) and double-count in totalOut. Does NOT affect an AUTO loan (not a Plaid liability → no
   loan-due) nor a payment categorized as a transfer (recurring detection skips it, detect.ts:85).
3. **Reported-$0 payment preserve (F1a, accepted):** a forbearance/IDR loan reporting `minimum_payment_amount:0`
   is treated like "not reported" (preserve prior), conservatively matching #132 — a later increment could read
   `loan_status` to clear a genuinely-$0 obligation.

NEXT (owner-gated): decide the CANONICAL loan source and de-duplicate — e.g. exclude loan-categorized
recurring/scheduled rows from the calendar+forecast when a loanObligation exists for that loan, OR feed
loanObligations into the forecast and suppress the recurring row. Requires threading a loan-account link or
categoryId through the scheduled pipeline; a focused follow-up, not bolted onto this increment.

**RESOLVED 2026-07-02 (DECISIONS #151, owner "do all recommended"):** the understand workflow proved there
is NO structural key linking a checking scheduled row to a loan Account, so a cross-source de-dup would need
heuristic money-matching (house-rejected). Chose **Option D** — feed loan obligations into the /forecast
balance projection from their one safe source (the loan Account) via `loanObligationsToScheduledFlows`; this
fixes the demo $385/mo under-count (consequence 1) with no heuristic and no golden movement. Checker
wf_1a6616ee 0 P0/P1. **Accepted residuals (documented, not fixed — no safe automatic fix exists):**
- **Consequence 2 (calendar + now forecast) unchanged:** a loan whose ACH is ALSO recurring-detected as a
  non-transfer checking row double-counts (folding loan-due into the forecast extends this to the forecast
  for that SAME already-broken population — no new victims). A future non-heuristic link (a
  loan-account/categoryId on the scheduled pipeline) would enable de-dup; pinned by a regression test that
  documents the limitation.
- **Day-31 clamp (checker P2-B):** a loan due on day 31 anchored in a short month expands a day early (e.g.
  06-30 → 07-30, 08-30 not 07-31/08-31) — a pre-existing `expandScheduled` MONTHLY property, now reachable
  via the loan fold; not demo-reachable (demo loan is day 5), ≤1-day shift, no golden moves.
- **Companion carve-out (detect.ts:83-85 `'auto-loan'`) DECLINED as out of scope:** `refreshRecurringForUser`
  runs only on real provider sync, never for the seeded demo, so the "latent post-refresh double-count" is
  not demo-reachable; removing the carve-out would churn ~8 recurring goldens for zero demo benefit. Optional
  owner-gated follow-up.

## 2026-06-30 — Currency guard: withhold non-USD accounts (DECISIONS #135, live-ingest audit #3/#10)

Closed the #127 live-ingest "currency never read" item. The app does no FX, so a non-USD feed
balance was summed into net worth at a fabricated 1:1. Persisted a nullable `Account.currency`
(null = legacy/demo/manual = assumed USD → golden-safe) set by both mappers; withhold non-USD
accounts AND all their child rows at every account-scoped read (snapshot accounts/transactions/
scheduled/snapshots; getAccountsView; getInvestments; register; triage; /budgets; the recurring
refresh; and all ~15 first-run empty-state gates). Pure `src/lib/providers/currency.ts`
(`canonicalizeCurrency`/`resolvePlaidCurrency`/`isSupportedCurrency`); the DB reads mirror it as
`OR:[{currency:null},{currency:'USD'}]`.

**Two hostile-critic cycles.** Cycle 1 (wf_74fc0808, 4 dims → adversarial verify): **4 P1 bypasses
+ 1 P2, all FIXED + regression-locked** — getInvestments roll-up (P1-A); the count-gates-vs-snapshot
invariant break → all-non-USD user throws + export 500 (P1-B); the transaction leak into
reports/trends/coach/register (P1-C ×2); and `resolvePlaidCurrency('','BTC')` failing open (P2).
Confirmation (wf_bda5c45a, 3 lenses): 2 lenses fixes-hold, the completeness lens found **2 more
direct transaction reads of the same class — `/budgets` spend + `refreshRecurringForUser` — both
FIXED + locked** (a foreign subscription would otherwise persist a scheduled row on the USD payment
account at 1:1). Gate (real 2026-06-30): `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1465 unit /
115 files** (+21), typecheck/lint/build clean.

### Accepted / deferred P2 residuals (documented, by design or follow-up)
18. **No excluded-account disclosure.** A withheld non-USD account vanishes from /accounts + the net
    worth headline with no "N accounts excluded — no FX yet" note; for a LIABILITY the withhold
    flatters net worth ("a withheld figure beats a silently wrong one" — but the direction is
    optimistic). **Highest-value follow-up:** a disclosure banner on the dashboard + /accounts.
19. **Cosmetic non-figure surfaces still touch foreign rows:** the transactions-CSV export lists a
    foreign account's rows (faithful raw dump, no summed figure); the account pickers (settings
    payment-account selector, /transactions/new, /transactions/import) may list a non-USD account
    (a foreign payment-account choice falls back to a USD account); the categorization backfill +
    the settings transaction-COUNT still process foreign rows. None is a wrong money figure.
20. **SimpleFIN HOLDING-level currency unread.** The guard is account-level; a non-USD position
    inside a SUPPORTED (USD) brokerage rolls into the /investments breakdown at 1:1. Net worth uses
    the authoritative account balance, so bounded to the breakdown; a deeper follow-up.
21. **Numeric ISO codes withheld, not mapped** (e.g. '840'=USD) — fail-safe; neither Plaid nor
    SimpleFIN emits numeric codes.
22. **All-non-USD user is a fail-SAFE edge** (unreachable for the invite-only US base; every real
    user has ≥1 USD account). The gates now render EmptyDashboard for it; the remaining pages that
    don't throw render zero-data safely.

REMAINING #127 live-ingest backlog: SimpleFIN symbol regex (options/crypto/slash tickers, coupled to
the addHolding ticker rule) + epoch→date UTC-day-boundary — both P2, lower money-impact.
**RESOLVED 2026-07-02 (DECISIONS #152):** (a) symbol regex — extracted ONE shared `parseTicker`/`TICKER_RE`
(kills the mapper/addHolding drift the audit flagged) and widened to accept "/" so BRK/B, BTC/USD are kept
(space-bearing OCC option symbols stay a documented skip); (b) epoch→date — inherently tz-ambiguous with no
feed timezone, so the UTC-calendar-day convention is now documented + boundary-tested (no logic change; no
money figure depends on the exact day). Checker 0 P0/P1/P2; verify GREEN 1570/124. Remaining #127 item:
residual 20 (SimpleFIN HOLDING-level currency unread — the guard is account-level).
**residual 20 CLOSED 2026-07-03 (DECISIONS #156):** `mapSimplefinHoldings` now reads each position's
`currency` and withholds non-USD lots before aggregation (account-consistent predicate — same
`isSupportedCurrency` rule as the account guard — with a distinct `withheldNonUsd` counter), so a non-USD
holding inside a USD account no longer sums into `/investments` at a fabricated 1:1. See the dated section below.

## 2026-07-01 — Triage write-in custom categories (DECISIONS #136, owner request #1)
Shipped increment 1 of the owner's sweep: "+ New category" in the triage picker (create + file in one
step) and the LIVE manual-entry custom-id bug fix. Hostile critic wf_e4584600: 2 confirmed P1 FIXED +
e2e-locked (error-boundary escape on a rejected create; stale open form crossing cards via batch/undo);
4 P2 fixed (overlay prune, IME Enter guard, name normalization parity, Escape). **0 open P0/P1.**

Accepted P2 residuals:
1. PRE-EXISTING: applyCategory creates its Correction row before the FK-guarded transaction update,
   non-atomically — a deleteCustomCategory race can orphan a Correction string ref (delete already
   remaps corrections; window is milliseconds; same class as the deferred alreadyUndone TOCTOU).
2. Partial-success recovery: if the create succeeds but the filing fails, retrying via the form shows
   "You already have a category with that name" — the category IS in every picker (discoverable path);
   custom copy plumbing for a rare double-failure judged disproportionate.
3. Focus is not restored to a specific control when the mini-form closes (axe AA passes).
4. The Settings manager has the same IME Enter-composition gap (pre-existing, same class as the
   triage one fixed here).

**ENVIRONMENTAL ESCALATION of #16/#17 (evidence-backed):** the phase2-triage full-review throughput
test now fails on THIS MACHINE even isolated on a fresh temp DB, at THREE code points: the #136 tree,
the pre-change HEAD (dd08f2e), and #131 (6a63729 — the commit where it measured green isolated on
2026-06-29). Symptom unchanged (accept/batch/undo stuck disabled ≥60s mid-write); stall position
varies run-to-run (15 remaining, 7 remaining). Conclusion: machine-level SQLite write-throughput
degradation TODAY — not a code regression at any point (3-point A/B), not OneDrive (the #121
relocation stands). Blast radius: ONLY the rapid-sequential-write loop — the other 58 e2e passed the
same day, and the three triage specs run in 0.8–4.1s when the box isn't saturated. Follow-up
(owner-gated): retest after a reboot; consider Windows Defender exclusions for the repo and
%TEMP%\aimplifi-test-*; if it persists, serialize that one spec's writes or give the throughput test
a dedicated DB.

## 2026-07-01 — #136 increment 2: searchable triage picker (Checker 2 P1 fixed) + stall diagnosis CORRECTED
Replaced the unsearchable ~84-option native <select> in triage alternatives with a search input +
scrollable option list over the pure `filterCategoryOptions` (assign.ts, 11 unit tests). Focused
Checker (wf_634e20c6): **2 confirmed P1, both FIXED + locked** — (1) search matched category NAMES
only while GROUP labels are visible in the list ("bills" → false "no match" → nudged the user to
create a DUPLICATE category; fix: a group-label match keeps the whole group); (2) keyboard access
regressed vs the native select (~86 tab stops to reach search, dead Enter; fix: the panel takes focus
on open (tabIndex -1 container — child buttons can be disabled mid-action, a container focus can't
silently no-op), Enter files the single visible match, Escape clears/closes). P2 fixed: stale search
query no longer survives batchApply/undoLast card changes (same class as the P1 form fix). e2e locks
added for all of it (focus-on-open, group-label search, Enter-files, empty-query-after-undo).

**STALL DIAGNOSIS CORRECTED (supersedes this morning's "SQLite write-throughput" wording):** a direct
Prisma write probe against the SAME e2e DB file ran 60×(create+update+delete) at **min 0 / p50 1 /
p95 1 / max 22 ms** while browser-driven server actions stalled ≥60s — the storage layer is HEALTHY;
the stall lives in the request/server layer (`next start` action POST handling) under RAPID
SEQUENTIAL actions. Switching the test loopback localhost→127.0.0.1 stabilized the lighter specs this
session but did NOT cure the full-review rapid-write stall (still reproduces, stall position varies).
Still environmental-not-code (3-point A/B incl. #131 stands). Runtime versions for future comparison:
node v24.16.0, playwright 1.60.0, next 15.5.19 — a system Node/OS update since 2026-06-29 (when this
test last measured green) is the prime suspect. Owner follow-ups: reboot + rerun; if persistent, try
pinning the Node version the 6/29 run used, or instrument the action route latency server-side.

## 2026-07-01 — #136 increment 3: register write-in (Checker 1 P1 fixed) — sweep COMPLETE
"+ New category" inside the register's category-menu → hands off to the existing once/always confirm
(#121); shared group-label search (#137) replaces the menu's name-only filter; drop-up menu on low rows.
Checker P1 FIXED + locked: `chosen` is now ROW-BOUND (rowId) — a create resolving after a row switch can
no longer put the one-tap confirm (incl. merchant-wide + durable-rule) on the wrong row. Race lock GREEN
×4 on the final tree. Accepted P2s: one-shot dropUp measurement (no scroll/resize re-measure; stale side
after scrolling with the menu open); write-in form inside the pre-existing role=listbox (SR
discoverability — fold into the shared-CategoryPicker follow-up); drop-up top-clipping on very short
viewports; the happy-path spec's full pass on the FINAL tree is UNVERIFIED (witnessed green through the
confirm pane ×3; the tail stalls on the machine's documented action-apply stall) — rerun after reboot.
Root-cause note for #16/#17: the ≥60s stalls are the ACTION-RESPONSE REVALIDATION APPLY (server actions
carrying 9-route revalidations hold the client transition — and every disabled={pending} button — until
the payload lands); storage proven healthy (p50=1ms probe). Environmental TODAY per the 3-point A/B.

## 2026-07-01 — #139 write-in prefill from the search query (owner request; Checker 2 P1 fixed)
Owner (testing #136-#138 in prod): "consolidate the new category into that search box so user doesn't
have to retype a field." Shipped: both write-in mini-forms prefill their name from the picker's live
search query at open (still editable; submit normalizes as before); triage Enter on a zero-match query
opens the prefilled form. Register search gains no Enter semantics (has none today — shared-
CategoryPicker follow-up). Checker wf_e902ad02 (3 lenses → adversarial verify): 2 P1 FIXED + locked —
(1) missing !newCatOpen let a second zero-match Enter silently clobber the edited draft (name/group/
discretionary) since the search box stays interactive beside the open form; (2) HELD-Enter auto-repeat
chained through the name input's autoFocus into an instant create+file with never-reviewed defaults →
e.repeat guards both Enter handlers. The pre-guard bundle DEMONSTRATED (2) in a stale-build e2e run
(rule prompt offering the typo category) — see process lock below. Test-adequacy P2 fixed (guards now
pinned: multi-match no-op, repeat no-op, draft survival).

Accepted residuals: two DISCRETE rapid Enters still create+file (indistinguishable from intent; filing
undoable, category deletable, rule prompt consensual); register keyboard parity deferred (pre-existing).

**PROCESS LOCK (cost ~40 min today):** playwright webServer = `next start -p 3100` with
reuseExistingServer — it serves whatever .next holds. NEVER run e2e concurrently with scripts/verify.sh
(its `next build` races/lags the spec edits): the first "P1 reproduction" run was the PREVIOUS bundle.
Sequence is always: verify green FIRST, then e2e.

Gate (real 2026-07-01): verify.sh → ✅ GREEN 1476 unit/116 files, tsc/eslint/build clean. E2E on the
final tree: triage write-in spec (all 5 new locks) GREEN 7.9s; register race lock GREEN; register happy
path witnessed green through prefill assert + confirm pane ×3 — its once-click tail is the documented
environmental action-apply stall (re-A/B'd at HEAD this session: fails at spec line 230 pre-change) —
full pass UNVERIFIED until the owner reboot (#16/#17 protocol; one triage stall occurrence also hit
line 106 mid-session then passed 7.9s on retry, consistent with "position varies").

## 2026-07-01 — #140 iOS focus-zoom fix (owner report)
Owner on #139 in prod: the dropdown "zooms in" — iOS Safari force-zoom on <16px focused controls; ALL
raw inputs here are text-sm (14px) and the register menu autofocuses its search. Fixed at the root:
globals.css (pointer:coarse) floors input/select/textarea at 1rem ([class] specificity trick, no
!important; checkbox/radio excluded; desktop unchanged). Register menu w-56→w-72 + max-w viewport clamp.
e2e locks assert computed ≥16px on both surfaces in the touch-emulated project (proved the media query
matches under Playwright's Pixel-5 emulation). Gate: verify GREEN 1476/116; triage write-in 7.7s GREEN
(incl. zoom locks); register race 4.6s GREEN; register happy-path tail = the documented environmental
stall (unchanged label). Residual: real-device (physical iPhone) confirmation is the owner's — emulation
proves the CSS applies, not Safari's zoom behavior itself.

## 2026-07-02 — #141 currency-disclosure banner (#135 residual 18) — Checker 1 P1 + 10 P2 confirmed, P1 + 7 P2 fixed
Resumed from stash `wip-135-disclosure` (banner + pure summarizer + getAccountsView.withheld +
getWithheldAccountSummary + dashboard//accounts wiring). Completed the pending pieces: integration
tests on the existing currency-guard fixture, the guarded scripts/e2e-add-foreign-account.ts (refuses
unless DATABASE_URL === E2E_DB_URL exactly AND the email is an @aimplifi.test throwaway; idempotent
via delete-own-rows-first), and tests/e2e/currency-disclosure.spec.ts (negative: all-USD demo user, no
banner; positive: ad-hoc signup user + helper → banner on dashboard + /accounts, withheld names absent,
axe AA with the banner present — the demo user never renders it, so the phase-5 pass can't cover it).

**Hostile Checker (wf_de889cf4, 4 lenses → adversarial verifier): 17 raw → 11 CONFIRMED (1 P1, 10 P2),
6 refuted.** Fixed:
- **P1 (tests): vacuous dashboard zero-render lock** — the negative spec anchored on `demo-banner`,
  which the LAYOUT flushes before the route-group Suspense resolves, so `toHaveCount(0)` passed
  against the loading skeleton. Re-anchored on `net-worth-card` (page content below the boundary).
- P2 copy sweep, all grammar now built by the PURE `withheldBannerCopy()` and branch-locked in unit
  tests: singular+opaque folds to "another currency" (was ungrammatical "an account in other
  currencies"); title now "not in U.S. dollars" (was "foreign currency" — mislabels crypto/BTC, a
  first-class withheld case); display tokens = letters 3–5 only, uppercased + deduped ('840', 'US',
  'doge' no longer pasted into copy; case-variant dedupe can't fake "and others").
- P2: all-foreign /accounts contradiction (banner "Nothing is deleted" above "No accounts yet / Add
  your first account") — AccountsEmptyState gets a withheld-aware copy variant; zero-account users
  byte-identical.
- P2: spec `.first()` removed (strict mode now locks single-render); helper made idempotent.

**Accepted residuals (documented, not fixed):**
23. Disclosure covers dashboard + /accounts only (the residual-18 scope as recorded). The register,
    /investments, /triage, /recurring, /reports, /coach still withhold silently — register is the
    page a user hunts a missing account on, /investments is one click from the disclosed /accounts.
    Follow-up: reuse getWithheldAccountSummary there (checker recommends /investments first). Note:
    every sign-in lands on /dashboard, whose banner reads app-wide ("every total, trend, and
    projection shown"), so the vanish is no longer fully silent anywhere.
    [UPDATE 2026-07-02: /investments covered — DECISIONS #145 (banner + withheld-aware empty
    state + e2e both paths). Remaining silent surfaces: register, /triage, /recurring, /reports,
    /coach; residual 25 (projection-assumption copy) unchanged.]
    [UPDATE 2026-07-02 (later) — **CLOSED**: register/triage/recurring/reports/coach all covered
    (DECISIONS #149; inline mount on the 3 server pages after each EmptyDashboard gate, `withheld`
    threaded into RecurringView/ReportsView for byte-identity). EVERY money surface now discloses
    withheld non-USD accounts; only residual 25 (inline per-projection assumption copy) remains,
    though the banner now surfaces that assumption at the top of /coach + /reports.]
24. The supported-currency predicate stays hand-duplicated across ~4 page gates + the DB complement
    in getWithheldAccountSummary; only the summary side is invariance-tested. Refactor candidate
    (single exported Prisma where-fragment), not a live defect.
25. Coach/reports projections don't state the currency-exclusion assumption inline (guardrail
    tension flagged by the checker; same scope decision as 23).
    [UPDATE 2026-07-02 — **CLOSED** (DECISIONS #150): pure `withheldInlineNote()` states the
    assumption inline at the /coach FI card + the /reports spending total (gated on withheld > 0,
    byte-identical otherwise), matching the app's per-projection "assuming X%" style. Accurate —
    the currency guard filters transactions/accounts/investments to USD-only in the shared
    snapshot. Unit + e2e locked; focused checker 0 P0/P1/P2.]
Refuted (verifier): CSV-export marker claim (accepted residual 19 covers it), backfill-count
disagreement, all-foreign dashboard P1 (gates to EmptyDashboard = accepted 22), banner salience,
reassurance-copy coupling, execSync cwd fragility.

**Gate (real, 2026-07-02):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — **1492 unit / 116 files**
(+16 this session: 6 stash + 2 integration + 8 checker locks), tsc/eslint/build clean.
E2E on the final tree: currency-disclosure 2/2 GREEN (2.7s/4.0–4.8s incl. axe) ×3 runs;
auth.spec 3/3 GREEN (one non-reproducing single failure in the first post-build parallel run —
isolated rerun 2.6s + full-file rerun 3/3 green; classed environmental per the #16/#17 protocol and
the CLAUDE.md cold-start-flake rule).

## 2026-07-02 — Phase 3 (3d+3a+3b+3c) shipped; environmental notes
Rebuild increments all verify-green + committed: resync clobber guard (regression-locked), merchant
identity (eval 60%→23.3% review on messy data, precision 100%), group engine/server (trust-on-repeat
locked end-to-end), group-first UI + adapted e2e. Two environmental findings today (evidence-backed):
(1) phase5-a11y "keyboard-only /cards" fails TODAY at THREE code points incl. 69a335b (witnessed green
60/61 on 2026-07-01) — identical $2,135 toggle assertion, focus+Enter racing hydration on the degraded
box; 3-point A/B ⇒ NOT a regression from today's code; retest after the owner-gated reboot.
(2) The new throughput e2e passed isolated ×2 (14s) + in-suite once; one serial run hit the documented
#16/#17 pending-stall (button disabled >120s, position varies). Same cure.
Accepted 3c residuals: the "Always/Just once" prompt is now reachable only via one-by-one mode on
multi-row rule-eligible groups (group cards carry consent in copy — #143/#144); positive e2e coverage
of that prompt needs a multi-row real-merchant fixture (demo has none) — Phase-4 item with the messy
corpus; rule-prompt makeRuleFromCorrection machinery unchanged and unit-covered.

## 2026-07-02 — Phase-3 Checker cycle 1 (wf_908cf9a8: 35 confirmed — 3×P0 one root cause, 12 P1, 20 P2)
FIXED this cycle (all locked, verify green): the merchantless mass-misfile P0 (scope + groupKey unified);
sync-guard check-then-act race → atomic tx w/ fresh in-tx reads; guard predicate v2 (split parents never
resurrected; undone rows take fresh verdicts; isTransfer preserved as verdict); Plaid pending→posted
transplant via pending_transaction_id (corrections follow the row); fileMerchantGroup fetch-in-tx +
needsReview re-assert + rule dedupe + spending-type/currency parity with the card; demo ACH patterns
name-bound (`.*RENT` convergence sink); badge/queue merchantless-key unification; singles-mode leak;
empty-state undo double-tap; "Always"-tap error escape; week-slice non-vacuity canary.
ACCEPTED/DEFERRED (P2s + structural, with rationale): SimpleFIN pending-id churn has NO linkage field —
correction transplant impossible without heuristics; residual documented (correct a pending row that
re-posts under a new id within days → reverts; rare, and the new one-tap group flow re-teaches cheaply).
3a canonical-migration gap (pre-3a rules on re-canonicalized brands stop matching; one live invite-only
user; one-tap re-teach; backfill re-point queued as follow-up). Prediction stamping no-op for live rows
(pre-existing #37 scope). Venmo/aggregate per-descriptor degeneracy on noisy feeds. City-strip multi-word
-city partials. LIGHT-token false-positive surface (requires biller token too). Singles-list a11y polish.
Server-level undo-of-group-reformation lock. Group-count-vs-late-sync drift note in consent copy.
ENVIRONMENTAL (worsening through the day, reboot-gated): the throughput e2e went green×3 (14-25s,
incl. isolated ×2 + in-suite) mid-day, then stuck-pending ≥120s across serial AND isolated runs late-day
— alongside the a11y keyboard test failing at 69a335b (yesterday's witnessed-green commit, 3-point A/B).
No surfaced error (a Prisma tx timeout would error fast + re-enable) → request-layer stall, #16/#17.
OWNER: reboot, then `VERIFY_E2E=1 bash scripts/verify.sh` re-witnesses both.

## 2026-07-02 — Checker CYCLE 2 on the rebuild (wf pre-/clear, 23 agents): 20 raw → 20 CONFIRMED, 0 refuted → ALL FIXED (DECISIONS #146)
Distinct defects after dedupe across the three lenses (fixes-hold / new-paths / gates):
- **P0 transplant × split (3 findings)**: split PENDING parent posting under a new id → parent deleted
  (isSplitParent dropped), children dangling, NEW full-amount row → spending double-counted. FIXED:
  transplant carries the split (container re-created, children re-pointed + posted, corrections follow)
  or DISSOLVES it to review on amount drift; removed[] cascades children of canceled split charges;
  same-id drift dissolves in BOTH providers; preserved splits post their children. 6 regression locks,
  5 proven fail-old by stash-run.
- **P1 isolation class (5 findings)**: every check-then-act guard assumed SQLite serialization; prod
  Postgres = READ COMMITTED. FIXED: serializableTx (SERIALIZABLE + bounded P2034 retry) at all five
  sites; the transplant's predecessor read moved INSIDE its tx; recategorize's target fetch moved
  in-tx. **HONESTY NOTE: the PG interleavings are unreproducible on the single-writer SQLite test
  env — closure rests on documented Postgres semantics (write-write first-updater-wins detects
  conflicts even against READ COMMITTED writers; SSI predicate locking covers the dedupe insert race
  between two serializable txs) + the helper-contract locks (serializable-tx.test.ts). Status:
  UNVERIFIED-on-PG until a Postgres integration env exists. The failure mode of a WRONG argument here
  is bounded: P2034 storms (visible, fail-loud) or the original clobber (no worse than pre-fix).**
- **P1 singles leak (3 findings)**: groupEmptied side-effected inside the setGroups updater — reset
  no-oped whenever React deferred the updater (deterministic on the write-in path). FIXED: derived
  before dispatch from committed state; e2e lock drains a group one-by-one and files the last row via
  the write-in (fail-old by mechanism inspection only — the eager-bailout skip is not deterministically
  reproducible under Playwright timing; the checker's React-19.1 trace stands as the pre-fix witness).
- **P2 batch**: merchantless scope pins merchantId:null (raw: card ≡ its action; aggregates stay
  descriptor-only BY DESIGN — one agg: card mixes CSV + synced rows of the same text); SimpleFIN (and
  Plaid, same shape) create/create race → P2002-catch → guarded-update fallback (CQ-2 restored without
  losing the verdict guard); removed[] buffered per item until all pages applied; rule dedupe requires
  the five condition columns null via the shared ensureUnconditionalRule (recategorize now dedupes too);
  gate gaps closed (same-canonical separation lock — prophylactic, passes old code by design; conditional
  -rule mint lock).
Residuals accepted (rationale): duplicate rules from two concurrent group-files remain possible only if
BOTH sessions race the SSI window AND retries interleave identically (bounded, self-healing on next
dedupe pass); Correction rows on a bank-canceled charge keep their dead transactionId (append-only audit
tolerates dead refs; the transplant re-points the live cases); SimpleFIN children of a DISSOLVED split
lose child-level corrections' target rows (charge no longer exists at that shape — audit rows retained).

## 2026-07-02 — Checker CYCLE 3 (wf_55f3cc23, 20 agents over the cycle-2 fix commit): 16 raw → 16 CONFIRMED, 1 refuted → ALL FIXED (DECISIONS #147)
The confirmation pass did its job twice over: it found the cycle-2 invariant claimed more than it
covered, and empirically proved a gate gap by stripping the fix and watching the suite stay green.
Deduped defects and their fixes:
- **P0 SimpleFIN new-id churn** (2 findings): stale pending split parents were IMMORTAL (reconcile
  excluded them in BOTH passes; children shielded by providerRef not-null) → the re-posted charge
  double-counted PERMANENTLY. FIXED: reconcile dissolves stale/aged pending split parents WITH
  children, read-in-tx, both passes. Locks: sf_new_id_churn + aged_out_split (fail-old proven).
- **P1 silent dissolve** (3): dissolve inherited the pipeline verdict → a user rule auto-filed the
  drifted charge, no triage card (checker probed it mechanically). FIXED: needsReview:true +
  confidenceBps:null forced at all 3 sites; the rule still supplies the SUGGESTION. Locks ×2 providers.
- **P1 sixth writer** (2): applyCategory (singles fileRow + recategorize 'one') was four bare
  statements. FIXED: one serializableTx, fresh in-tx reads, shared mint. makeRuleFromCorrection too.
- **P1 stale-rule-wins** (1): unconditional rule to a DIFFERENT category was never retired; the
  stable-sort tie-break let the OLD rule drive every future ingest (probed). FIXED: supersede in
  ensureUnconditionalRule; all four mint surfaces share it. Lock: stale_rule_wins_recategorize.
- **P1 gate** (1): NO lock pinned the serializableTx wiring (sed-strip stayed green). FIXED:
  serializable-wiring.test.ts — spy over the four triage actions + provider source pin.
- **P2s**: cascade read in-tx; P2025 → skip-deleted-row (was: whole SimpleFIN pass-2 abort);
  rule.create vs rule.reuse audit honesty; ledger counts corrected in place.
Residuals accepted (rationale): applyToAllSimilar keeps its old shape — no UI caller imports it
(verified by the checker); a retired rule is not resurrected by undo (re-mint is one tap); SimpleFIN
new-id churn LOSES the split decision by design (no id link — heuristic matching rejected, would
misfile real money; the fresh row lands in review when the pipeline is unsure, or files under the
user's own rule).
Fail-old proof (stash-run): exactly the 9 new locks red on pre-fix code, green on fixed.

### 2026-07-02 (late) — transactions:191 register-write-in e2e: 3-point A/B → ENVIRONMENTAL
During the cycle-3 gate, `register write-in: create a category inside the picker and refile (#136)`
failed reproducibly (isolated ×2): recat-once clicked, chip never flips within 20s, NO server error.
Discriminators run: (1) NEW unit lock drives the EXACT server path (createCustomCategory →
recategorize scope:'one' → custom id on a manual merchantless row) through the REAL actions → GREEN
(custom-category-lifecycle.test.ts); (2) sibling e2e :145 (same chip→picker→recat-once component,
same action, system category) → GREEN 7.0s same run; (3) **3-point A/B, fresh `next build` each:
HEAD=FAIL, bbda775 (cycle-2)=FAIL, e51d6fe (PRE-cycle-2, old recategorize/applyCategory)=FAIL.**
The failure predates every categorization change in the unpushed stack; the spec was green in prior
sessions. Same class as yesterday's a11y 3-point A/B (day-long machine degradation, unrebooted since
Jun 30): the action response/revalidation apply stalls, UI never re-renders. The write-in+refile
combination does TWO server actions back-to-back — the heaviest single-row flow — which is why it
trips before its siblings. Cure = reboot; re-witness gated on the standing owner NEXT.

## 2026-07-02 — Checker CYCLE 4 (wf_4cb0ba46, FINAL under the 4-cycle cap): 9 confirmed (1 P1 + 8 P2), 1 refuted → HARD STOP, OPEN FINDINGS
Per the build-loop rule (4 critic cycles per phase, then STOP and ask the human), these are recorded
OPEN, not fixed. The cycle-4 checker's verification was unusually rigorous: the P1 was empirically
probed twice (finder + independent verifier), and three P2s were proven by revert-stays-green runs in
scratch copies.

**OPEN P1 — forced-review dissolve is clobbered by the NEXT sync.** The dissolve writes
needsReview:true + confidenceBps:null but leaves NO durable marker; the preserve predicate
(corrected && !needsReview) is structurally false for a dissolved row, so the 5-day-overlap re-send
(daily cron) re-applies the rule verdict: needsReview:false/9900 — the triage card vanishes within
one cron interval and the full drifted amount silently auto-files. EMPIRICALLY PROVEN (probe:
sync N = review/true; sync N+1 = auto-filed/false). Plaid's dissolve sites share the hole on
modified[] re-sends. Root cause: a dissolved row is representationally identical to an UNDONE row,
and the cycle-1 rule ("an undone row takes the fresh verdict") correctly wins. Proposed fix (needs
owner sign-off — SCHEMA CHANGE): a `reviewPinned Boolean @default(false)` on Transaction — set by
every dissolve, respected by the preserve predicate (preserve = isSplitParent || reviewPinned ||
(corrected && !needsReview)), cleared by every user filing action; plus multi-sync locks (assert
review SURVIVES a second identical re-send) at all three dissolve sites. Mitigation until then:
the defect needs {pending split + amount drift + merchant rule} AND is in the UNPUSHED stack only —
production is unaffected today.

**OPEN P2s (8):**
26. Reconcile dissolve fires on FALSE staleness — a per-row parse failure (garbled amount) drops the
    ref from the corroboration set, dissolving a still-reported split. Cheap fix: record txn.id into
    the returned-ref set in the parse-catch arm (skip-ingest must never imply dissolve).
27. Same-id transient absence (one flaky snapshot) dissolves a still-real pending split immediately in
    pass 1. Design alternative the checker validated: split parents dissolve only in the pass-2
    age-out (≤32d bounded double count — the SAME residual bound #128 already accepts) — the
    immortality P0 stays closed. Owner taste call: immediate-dissolve (current) vs age-out-only.
28. Plaid same-id split-drift dissolve (plaid.ts:404) has NO lock — proven: reverting it runs
    1546/1546 green in a scratch worktree. Fix: clone the transplant-drift test with a modified[]
    same-id payload.
29. Wiring lock pins call-presence only; triage-actions.ts has no source pin (partial re-strip of
    applyCategory's tx stays green). Harden: extend the pin with a 3-site interactive allowlist.
30. Wiring source pin is comment-satisfiable and misses non-async interactive callbacks — both
    evasions demonstrated on scratch copies. Harden: count non-comment lines; drop the async literal.
31. Supersede leaves Correction.becameRuleId dangling at the deleted rule; makeRuleFromCorrection's
    early return can report a dead ruleId without minting (UI can't reach it today). Fix: existence
    check in the early return (also covers future dangling sources).
32. P2025 skip-on-null + rule.create/rule.reuse audit gating have no locks (revert-stays-green
    proven, 1547/1547). Cheap locks via the '@/lib/db' mock seam + an audit-action assertion.
33. reconcilePendingTransactions' function-header Safety doc still states the PRE-#147 invariant
    ("split parents are excluded") — actively argues for restoring the P0. One-line doc fix.
Refuted (1): the becameRuleId-liveness variant that claimed UI reachability (duplicate of 31's
unreachable half).

## 2026-07-02 — CYCLE 5 (owner-authorized fix round): the open P1 + P2s 26-33 CLOSED (DECISIONS #148)
Owner authorized one more maker/checker round + ratified age-out-only split sweeping (#27).
FIXED: **the P1** via Transaction.reviewPinned (set on every dissolve, respected by the preserve
predicates, carried across id churn, cleared by every user filing action) — multi-sync locks now
assert the review SURVIVES identical re-sends and releases only on the user's decision, both
providers + the churn path; **#26** raw-id corroboration (a garbled row never reads as absence);
**#27** in-window reconcile never touches split parents (age-out dissolves, bounded ≤32d — same
residual class as #128); **#28** Plaid same-id dissolve locked (multi-sync); **#29/#30** wiring pin
hardened (non-comment lines only; any-shape $transaction ban in providers; triage-actions pinned
with an exact-4 interactive allowlist); **#31** dead becameRuleId falls through to a fresh mint
(lineage re-pointed); **#32** deleted-in-window + audit-provenance locks added; **#33** Safety
docstring rewritten to the real contract. Items 26-33 and the cycle-4 P1 are CLOSED.
Fail-old (stash-run): exactly the 8 new/rewritten behavioral locks red on pre-fix code.

### 2026-07-02 — Cycle-5 SCOPED confirmation (wf_eed966ba): 4 confirmed (1 P1 + 3 P2, 0 refuted) → FIXED same session
The confirmation caught the pin's remaining blind spots:
- **P1 backfill (the SEVENTH writer, found by both lenses)**: the /triage backfill button re-ran the
  user's own rules over a dissolve-pinned row — silently auto-filed it AND left the contradictory
  pinned-but-filed shape (never in triage → no surface could clear the pin; a later churn popped it
  BACK into review). FIXED: `reviewPinned: false` in backfill's select AND its compare-and-set
  re-assert (a row pinned inside the read→write window is skipped). Lock: backfill_respects_pin.
- **P2 sweep laundering**: a dissolve converts a sweep-protected split parent into a plain PENDING
  row; one flaky snapshot deleted it and the re-report re-created it on the rule verdict — pin
  laundered. FIXED: the in-window sweep excludes pinned rows (age-out stays the backstop). Lock:
  sweep_launders_pin.
- **P2 comment-stripping**: trailing comments / block-comment interiors could still satisfy the
  wiring pin. FIXED: block comments removed globally + trailing ` //` stripped (string URLs kept).
Both behavioral locks fail-old-proven by stash-run (exactly the 2 new locks red pre-fix).
HONESTY: these confirmation fixes are lock-proven but have NOT had a further adversarial round —
the owner authorization covered one fix round + one scoped confirmation, both now spent.

## 2026-07-02 — Currency disclosure extended to the final 5 surfaces (#149) — residual 23 CLOSED
Picked up the top backlog item (STATUS residual 23) while reboot + push of the unpushed stack stay
owner-gated. Extended the shipped currency-exclusion banner (#141/#145) from dashboard//accounts//investments
to register (`/transactions`), `/triage`, `/recurring`, `/reports`, `/coach`. Purely additive UI wiring:
each server page fetches `getWithheldAccountSummary(userId)` and mounts `<CurrencyExclusionBanner>`, which
SELF-NULLS at count 0 → all-USD users (incl. the seeded demo user) render zero banner DOM → demo/golden
byte-identical. Mount style per the #141/#145 convention: inline in the 3 inline-JSX server pages (after each
page's zero-account `EmptyDashboard` gate — auth.spec's onboarding contract untouched), `withheld` threaded
into `RecurringView`/`ReportsView` for the 2 view-backed pages (no redundant wrapper).

**Focused Checker (wf_a7eaf280, 3 lenses → adversarial verify): 0 P0/P1**, 2 P2 CONFIRMED + FIXED before
commit — (P2-a) axe covered only /recurring in the positive path → folded a per-surface axe A/AA scan into a
unified 5-surface loop (phase5-a11y's triage/coach pins run on the all-USD demo user, where the banner
self-nulls, so they never exercise it); (P2-b) the first /recurring + /reports page wrappers duplicated the
view's own `max-w` root (an inert extra `<div>`, so NOT strictly byte-identical) → re-threaded `withheld` into
both views, wrapper removed. 8 candidates refuted (self-null; gates preserved; `role="status"` overrides
Alert's default; single-mount; RSC boundary valid; anchors non-vacuous; copy matches; pure-all-foreign→EmptyDashboard
is a PRE-EXISTING documented residual). The verifier also independently re-ran `tsc`/`eslint` clean on the diff.

**Gate (real, measured 2026-07-02):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — **1554 unit / 122 files**
(no new unit tests — the mechanism is already unit-locked; this increment's locks are e2e, the #145 precedent),
tsc/eslint/build clean. Targeted e2e `currency-disclosure.spec` **3/3 GREEN** (19.2s, no stall): negative
zero-render on all 5 new surfaces for the demo user (anchored on below-Suspense page content per the #141 rule),
positive banner-present + `'EUR, GBP'` + per-surface axe A/AA on all 5 for the withheld fx user, + the unchanged
byte-identity lock. Full-suite serial e2e re-witness stays reboot-gated (standing owner NEXT; the environmental
disabled-pending stall is untouched by this read-only change).

**Accepted residual (pre-existing, not introduced):** a user with ONLY non-USD accounts (zero USD) still hits
`EmptyDashboard` on the 4 gated pages (dashboard/recurring/reports/coach) before the banner — the same gate
asymmetry #141/#145 documented (accepted-22 pattern); such a user still sees the disclosure on /accounts,
/transactions, /triage (ungated). Residual 25 (inline per-projection assumption copy on /coach + /reports) also
remains, though the banner now surfaces that assumption at the top of both pages.

**State:** working tree has the #149 change (7 files: 5 pages + 2 views + the spec) — committed below. Local main
was HEAD `d6d87f3` (18 unpushed); this adds one more functional commit. Production unaffected until the owner
pushes (the whole categorization stack + #149 ship together on the next push — owner's call).

## 2026-07-03 (session "aimplifi") — Plaid PFC passthrough (#155) — DONE ✅ (verify green, hostile Checker 0 P0/P1)

Wired Plaid's per-transaction `personal_finance_category` (ingested but previously ignored) into the shared
categorizer as a DETERMINISTIC rescue signal — see DECISIONS #155 for the full design. Highlights / honest limits:

- **Rescue-only, never override.** The hint fills in ONLY a row our own normalization would send to review; a user
  rule, a transfer, a confident merchant match, an amount-banded ambiguity, and a deliberate aggregate
  (Zelle/Venmo/Check) all win over it. Confidence is capped in `[7000, 9000)` so a PFC-filed row auto-files with the
  visible AI badge — a correctable guess, never silent.
- **Transfer-safe (critic F4).** The mapper NEVER emits `transfer`: every Plaid TRANSFER_IN/OUT taxonomy value → no
  hint, and the pipeline re-guards non-transfer. Spend can't be silently erased by a Plaid guess.
- **Sign-guarded (#44).** Inflow → an Income-group category only; outflow → never income; `$0` → never rescued.
- **Golden-safe (#22).** demo / CSV / SimpleFIN / seed never set the hint → `categorize()` byte-identical, zero
  golden movement. **The live Plaid network path remains dormant + UNVERIFIED** (no sandbox creds here, consistent
  with STATUS #12) — the PFC LOGIC is fully unit-tested (categorize.test.ts + plaid-map.test.ts, +27 tests incl. a
  map-integrity guard over all ~102 targets), but whether real Plaid rows carry the field / confidence we expect
  needs the owner's live sandbox run (docs/PLAID_WALKTHROUGH.md §5).

Hostile Checker (wf_677df90e-922; 6 dimension reviewers — golden-safety / transfer-safety / sign-guard /
rescue-ordering / taxonomy / robustness — + 2 adversarial verifiers per finding; 8 agents / 745k tokens / 130 tool
calls): **0 P0/P1**. The lone P1 candidate ("the 102-entry map is under-tested") was refuted to P2 by BOTH
verifiers (every target independently re-confirmed to exist and be non-transfer; the taxonomy/sign invariants are
enforced at runtime). 6 P2 hardening fixes applied pre-commit: the map-integrity guard test; `$0`-amount,
amount-band-ordering, and Venmo/Check aggregate tests; an income-inflow success e2e; a malformed-field-type
non-throwing test; and a SEWAGE_AND_WASTE_MANAGEMENT → `water` remap (matches our own normalizer's SEWER/SEWAGE →
water and the "Water & Sewer" leaf name). Accepted P2 (documented): GENERAL_SERVICES_POSTAGE_AND_SHIPPING → `business`
is KEPT — it matches our own normalize.ts (FEDEX/UPS STORE/USPS → business), not a defect.

Gate (real, measured 2026-07-03): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — typecheck/lint clean,
**1656 unit / 125 files** (+27), build clean. E2E: not applicable (the Plaid path is dormant — no e2e surface;
demo/seed are byte-identical, so the existing suite is unperturbed). No schema change.

## 2026-07-03 — SimpleFIN holding-level currency guard (DECISIONS #156, residual 20 CLOSED)

The account-level currency guard (#135/#141/#149/#150) withholds non-USD ACCOUNTS from the USD read
paths, but `mapSimplefinHoldings` received each position's `currency` and never read it — so a non-USD
lot inside a USD-labeled brokerage summed into `/investments` at a fabricated 1:1 (the guard only fires
on the whole account). Fix (engine-first, no schema change): the mapper now WITHHOLDS confidently-non-USD
positions before aggregation and counts them in a new `withheldNonUsd` field kept DISTINCT from `skipped`
(a foreign lot is working-as-intended, not an un-mappable glitch). Threaded through `syncFromSimplefin` →
`SyncResult.holdings` (types.ts) → `SimplefinResult.holdings` (simplefin-actions.ts).

- **Predicate = account-consistent** (not a divergent second rule): `!isSupportedCurrency(canonicalizeCurrency(h.currency))`
  — null/omitted → USD (golden-safe: demo/CSV/manual carry no currency), `'usd'/'USD'` → USD, any non-USD
  ISO code / crypto-or-non-ISO URL / opaque token → withheld. Deliberately REJECTED the "understand"
  workflow's NARROW recommendation (withhold only a clean 3-letter ISO ≠ USD, keep URLs/opaque as USD):
  SimpleFIN expresses crypto/non-ISO currencies as a URL, so narrow would LEAK exactly those at a wrong
  1:1 — the silent corruption the guard exists to prevent — contradicting the app-wide "a withheld figure
  beats a silently wrong one" philosophy. A false-withhold is visible + recoverable (data preserved); a
  1:1 leak is invisible. The Checker independently confirmed the aggressive call SOUND (under the SimpleFIN
  protocol USD is always `'USD'` or omitted, so aggressive CANNOT false-withhold a real USD lot).
- **Gate refinement** (simplefin.ts ~475): `|| (withheldNonUsd > 0 && skipped === 0)` so a CLEANLY-interpreted
  all-foreign feed reconciles (prunes stale USD rows) while a MIXED foreign+glitch feed still preserves rows
  (#133 intact — the `skipped === 0` qualifier is a Checker P2, fail-old-proven).
- **Golden-safe / net-worth-neutral:** SimpleFIN is the only currency-bearing ingress; net worth uses account
  balances (holdings are a within-account breakdown). The live SimpleFIN path is dormant/UNVERIFIED → unit-tested
  only.

Hostile Checker (wf_1ac2c779; 4 dimension reviewers — money-semantics / golden-safety / sync-orchestration /
test-coverage — → refute-by-default verification of each P0/P1): **0 P0/P1**; scorecard money 9 / golden 9 /
sync 8 / tests 8. **2 P2 FIXED pre-commit + fail-old-proven:** (1) the gate opener was too coarse — `|| withheldNonUsd > 0`
alone reconciled a mixed foreign+glitch feed and pruned its held rows, silently widening the #133 guarantee →
added the `&& skipped === 0` qualifier; (2) a mixed-case regression test (proven red against the coarse gate).
Accepted/deferred P2s (documented): numeric ISO `'840'` would be false-withheld (SimpleFIN never emits numeric
currency codes; byte-consistent with the account guard); per-account `withheldNonUsd` accumulation is trivially
correct by inspection (a two-brokerage test is a deferred nicety). The predicate can be flipped to narrow in one
line if a live sandbox run ever shows `holding.currency` carrying a security identifier.

Gate (real, measured 2026-07-03): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — typecheck/lint clean,
**1666 unit / 125 files** (+10: 7 mapper cases + 3 sync cases), build clean. No schema change; demo/golden
byte-identical (the demo seed's 5 holdings carry no currency and never pass through the mapper).

**DEPLOYED ✅ (owner: "push")** — `git push origin main` → `5a110c5..7764871` (origin was at #155, so this also
shipped the previously-unpushed #155 deploy-record doc commit `7958a0c`). Deploy VERIFIED READY: Vercel
commit-status for `7764871` = **success** ("Deployment has completed", deployment `D9gjiaVn2GRHn43As6VL6AwHK8WL`,
team reiforge / project aimplifi; queried via GitHub's commit-status API with the stored git credential — no
Vercel MCP this session), corroborated by `www.aimplifi.app/sign-in` → HTTP 200 + HSTS
(`max-age=63072000; includeSubDomains`). #156 is LIVE.

## 2026-07-03 — Root 404 / not-found chrome (#157, ROADMAP prod-readiness)

The error chrome had global-error.tsx (root-layout crash) + (app)/error.tsx (in-shell render throw)
but no not-found.tsx, so an unmatched URL rendered Next's unstyled default 404. Added a branded root
`src/app/not-found.tsx` — a lean server component rendered INSIDE the root layout (Tailwind + the dark
theme + buttonVariants, like (app)/error.tsx): an Aimplifi wordmark, one `<h1>` "Page not found", muted
copy, one recovery Link to /dashboard. `metadata:{title:'Page not found'}` flows through the root
`title.template` → "Page not found · Aimplifi" (confirmed applied by the e2e). Zero notFound() callers
→ an unmatched URL is the only 404 path (resolves OUTSIDE the (app) group), so one root not-found.tsx
is exactly right; no (app)/not-found.tsx (YAGNI). NO schema change; purely additive → demo/golden
byte-identical (a static page touches no financial data).

Scope note: chose this over the higher-visibility "Investments in nav" item — the latter needs an 8th
phone nav icon (SECONDARY renders as 7 icons on the phone top bar, app-nav.tsx), exactly the #71 "bar
full at 7" constraint prior sessions honored, so it belongs to the owner-scoped mobile-nav redesign.
The 404 is additive, golden-neutral, and fully verifiable WITHOUT the reboot-gated action-apply e2e
stall (a 404 is a pure GET — no server action).

Hostile Checker (wf_f412b291-329, 4 lenses → double refute-by-default verification): **0 P0/P1**. All
lenses clean (service worker passes 404s through, no cache-masking; emerald-500 ~7.8:1 +
muted-foreground ~7.6:1 on the dark bg both clear AA; the title is locked by a real e2e assertion so a
metadata regression fails CI not silently; the e2e is a genuine non-vacuous fail-old lock —
`data-testid="not-found"` + the exact h1 + title distinguish it from Next's default 404). 3 P2:
- FIXED: the not-found.tsx + spec docstrings overclaimed "authenticated-only" — middleware's UNANCHORED
  icon/manifest/favicon.ico exclusions let those prefixes skip auth and render the 404 with no session.
  Corrected both docstrings AND added the intended-boundary lock (unauthenticated unmatched → /sign-in)
  as a robust second e2e test. (Also caught a self-inflicted build break pre-commit: the first docstring
  edit put a comment-terminator inside the block comment — verify went red, fixed by rephrasing. The
  gate did its job.)
- ACCEPTED (documented): (a) an unauthenticated typo'd URL → /sign-in rather than a friendly public 404
  — pre-existing middleware behavior, defensible for a fully auth-gated app; (b) single "Go to dashboard"
  recovery with no "Sign in" link — a second CTA would confuse the common (authed) reacher (unlike
  (app)/error.tsx, whose case is auth-adjacent), and the expired-session path already redirects
  gracefully — a deliberate single-CTA choice.

OBSERVED (pre-existing, NOT fixed — out of scope, no data exposure): middleware.ts's unanchored
icon/manifest/favicon.ico exclusions let /iconzzz, /manifestfoo, /favicon.icoX skip the auth matcher.
They all 404 anyway (no route/asset), so nothing protected is served — the only effect is they render
the branded 404 without a redirect. Tightening the auth-boundary matcher (anchoring those prefixes)
risks the auth boundary and deserves its own careful increment; flagged for the owner, not changed here.

Gate (real, measured 2026-07-03): `bash scripts/verify.sh` → ✅ VERIFY GREEN — typecheck/lint clean,
**1666 unit / 125 files** (no unit delta — UI chrome is e2e-locked per the #145/#156 precedent), build
clean. E2E `not-found.spec.ts` **2/2 GREEN** (authed 404+recovery 2.7s; unauth→sign-in boundary 336ms).

**DEPLOYED ✅ (owner: "push it")** — `git push origin main` → `2046fd5..ed72acf` (origin was at #156;
now 0 ahead/0 behind on the functional commit). Deploy VERIFIED: Vercel commit-status for `ed72acf` =
**success** ("Deployment has completed", deployment `EPSeh5KcqMHvaTc16EWodXxbYsoB`, team reiforge /
project aimplifi; via GitHub's commit-status API with the stored git credential — gh was unauthenticated,
no Vercel MCP this session). Stronger-than-usual live corroboration: `www.aimplifi.app/sign-in` → HTTP
200 + HSTS (`max-age=63072000; includeSubDomains`), AND the #157 change itself confirmed serving live —
`www.aimplifi.app/iconzzz` (an unmatched path that skips the auth matcher via its unanchored icon-prefix)
→ **HTTP 404** with the branded page in the response body (`data-testid="not-found"`, the "Page not found"
h1, the "Aim<span>" wordmark, the "Go to dashboard" recovery). #157 is LIVE. This deploy-record doc line
is committed local-only (intentionally UNPUSHED to avoid a redundant identical rebuild — rides out with
the next functional change, per the #154/#155 precedent).

## 2026-07-03 — Register recategorize-picker Escape / outside-click dismissal (#158, ROADMAP prod-readiness)

The inline category picker on /transactions (transaction-list.tsx, single-controller openId model) only
closed by re-tapping the chip — no Escape, no outside-click. A real keyboard-operability + usability gap
on the app's most-used flow. Added (client-only, no server/engine touch):
- A useEffect scoped to an open menu that adds a document mousedown outside-click listener closing the
  picker (ref on the open row's chip+menu wrapper), gated on !pending so a stray click can't abandon an
  in-flight create/refile.
- A container-level Escape (onKeyDown) that closes and RETURNS focus to the chip (WCAG 2.4.3).
- close() promoted to useCallback (stable effect dep).
- Two-level Escape preserved + hardened: the "+ New category" sub-form's Escape closes ONLY the
  sub-form, now handled on the sub-form CONTAINER so Escape from ANY sub-form control (not just the name
  input) steps back one level.
Escape is deliberately NOT gated on pending (only the outside-click is) so it stays a keyboard escape
hatch even if a server action stalls (#16/#17) — a false-lock trap is worse than a rare orphan category.
Golden byte-identical.

Hostile Checker (wf_1e6176e9-763, 4 lenses -> double refute-by-default): 0 P0/P1 (lone a11y P1 candidate
double-refuted). Independently confirmed menuRef containment (recat confirm pane + sub-form clicks count
as inside -> recat/write-in/row-switch flows intact), no listener leak, stable close(), robust
outside-click target, genuine fail-old locks, non-vacuous focus-return assertion, and that the write-in
test failure is the environmental #16/#17 stall not a #158 regression. 2 P2 FIXED pre-commit: (a)
two-level Escape worked only from the name input -> moved to the sub-form container + a fail-old
group-select test; (b) outside-click could orphan a category mid-create -> pending gate. Accepted P2s
(documented, low value): a listener-leak double-cycle test and an Escape-from-option-button test
(cleanup correct by construction; Escape scope is container-level, covered by the search-input test).

Gate (real, measured 2026-07-03): bash scripts/verify.sh -> VERIFY GREEN — typecheck/lint clean,
1666 unit / 125 files (no unit delta — client UI, e2e-locked per the #145/#156/#157 precedent), build
clean. E2E: the 4 new #158 tests in transactions.spec.ts PASS (Escape+focus-return 3.3s; outside-click
3.4s; sub-form name-input Escape 3.6s; sub-form group-select Escape 3.7s). Pre-existing action-heavy
register tests (recat #36, write-in #136) hit the documented environmental #16/#17 action-apply stall on
this unrebooted machine (recat FAILED-then-PASSED on retry -> non-deterministic; write-in fails only at
its post-server-action persistence assertion, AFTER the full menu interaction completed) — NOT a #158
regression; reboot-gated re-witness.

**DEPLOYED (owner: "push")** — git push origin main -> ed72acf..be5707a (shipped #158 + the #157
deploy-record doc commit; origin now 0/0). Deploy VERIFIED: Vercel commit-status for be5707a = success
("Deployment has completed", deployment E3roppmuNgvymGe1seY6kfMF9UnY, team reiforge / project aimplifi;
via GitHub's commit-status API + the stored git credential). Live health: www.aimplifi.app/sign-in ->
HTTP 200 + HSTS; /iconzzz -> HTTP 404 branded ("Page not found") — confirms #157 still live + the deploy
serves latest. #158's client-side dismissal is behind auth + browser interaction so not curl-verifiable —
proven by the 4 passing #158 e2e tests pre-deploy. #158 is LIVE. This deploy-record doc line is committed
local-only (UNPUSHED to avoid a redundant identical rebuild; rides with the next functional change).

## Investments discoverability — INVESTMENT rows link to /investments (DECISIONS #159)

The portfolio view (holdings, TWR/XIRR, retirement outlook) was reachable only via a tiny
top-of-page "View investments ->" text link on /accounts; a linked brokerage's own row
dead-ended at its transaction ledger. Now an INVESTMENT-type `LinkedRow` navigates to
`/investments` and shows an inline "· View holdings ->" cue (inherits the AA
`text-muted-foreground` token — no new color, axe-clean). Surgical + a11y-safe: `LinkedRow`
is a lone `<Link>`, so a type-conditional href introduces no nested-interactive element; the
action-bearing `ManualRow` (a manual INVESTMENT is a typed balance with no holdings) is left
untouched, and `/investments` is portfolio-wide (no account param) so the link is plain.
Client/nav-only — golden + demo byte-identical, no engine/schema change.

Gate (real, measured 2026-07-03): core `bash scripts/verify.sh` -> **VERIFY GREEN** —
typecheck/lint clean, **1666 unit / 125 files** (no unit delta — client UI, e2e-locked per
#145/#156/#157/#158), build clean. E2E: the new #159 test in investments.spec.ts PASSES (click
the seeded "Brokerage" account-row -> /investments + $142,000.00 portfolio + "View holdings"
cue, 3.5s); the non-investment row -> /transactions path stays green (transactions.spec.ts:29);
/accounts stays WCAG-AA (transactions.spec.ts:313 axe scan passed WITH the cue span live).

Hostile Checker (wf_af042228-cf6, 3 lenses + refute-by-default verify): **0 P0/P1**. 3 P3, none
blocking (see DECISIONS #159): (a) a dedicated per-page /accounts+/investments axe scan would lock
the guardrail the Checker flagged — though transactions.spec.ts:313 already covers /accounts and
passed; (b) with multiple INVESTMENT accounts the per-row cue lands at the aggregate top, not that
account's card (right for the single-brokerage seed); (c) the brokerage's transaction ledger is now
one hop further (via the /transactions Account filter) — a no-op for the demo (the seed brokerage
has zero transactions).

FULL VERIFY_E2E on this unrebooted machine still surfaces the pre-existing environmental #16/#17
server-action-stall flakes on write-heavy pages this change never touches (/budgets set-target,
/calendar next-month, /triage accept, transactions write-in/filter). The failing SUBSET is
non-deterministic across reruns (parallel: transactions:76; serial: transactions:191; phase4 went
1->2 fails in isolation) — the signature of the documented stall, NOT a #159 regression. The #159
blast radius is exactly `LinkedRow` on /accounts + one /investments test; it is disjoint from every
failing spec. Reboot-gated re-witness, consistent with the #158 sign-off.

**DEPLOYED (owner: "push")** — `git push origin main` -> be5707a..f17b0d0 (shipped #159 +
the #158-deploy-record + #159-decision doc commits; origin now 0/0). Deploy VERIFIED: Vercel
production deployment dpl_A9YGDCGmhPwkkLzexsq8i1F4VfmY (commit f17b0d0) reached READY in ~64s and
holds every production alias (www.aimplifi.app, aimplifi.app, aimplifi-git-main-reiforge.vercel.app),
aliasError null. Live health: www.aimplifi.app -> HTTP 200 via Vercel (iad1) with full security
headers intact (HSTS max-age=63072000, CSP, X-Frame-Options DENY, nosniff); the sign-in page renders
(demo-sign-in present); an unauth bogus path rewrites to /sign-in (x-matched-path=/sign-in) — the
documented #157 unauth boundary. #159's investment row-link is behind auth + browser interaction so
not curl-verifiable — proven by the passing #159 e2e pre-deploy. #159 is LIVE. This deploy-record
doc line is committed local-only (UNPUSHED to avoid a redundant identical rebuild; rides with the
next functional change).

## /investments account scoping — ?account narrows to one account (DECISIONS #160)

The #159 follow-up (P3-b the owner named in the #159 NEXT list). INVESTMENT /accounts rows now link
to `/investments?account=<id>` (LinkedRow carries the id), and /investments narrows its per-account
holdings list to that account for a real MULTI-brokerage user (the owner's Plaid+SimpleFIN production
case) with a "Show all accounts →" reset; the single-brokerage demo is the golden-safe test vehicle.
Built VIEW-LAYER (pure `resolveInvestmentScope` in src/lib/engine/investments/scope.ts) — `getInvestments()`
/ net worth / retirement UNCHANGED; the portfolio-wide summary card (the pinned $142k golden) reads
`data.overall` exclusively. Golden-safety keystone = the ≤1-account INERTNESS rule: the demo renders
byte-identical with or without `?account`, so no pinned golden (portfolio value, allocation, net worth,
retirement) can move; scoping activates only with >1 investment account. Unknown / matched-but-empty /
array `?account` → full-view fallback (never empty or broken).

Gate (real 2026-07-03): core `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1674 unit / 126 files** (+8:
scope resolver known-answers), tsc/eslint/build clean; investments e2e 6/6 (incl. #159 ?account
inert-demo + #160 unknown-id fallback + axe WCAG-AA); transactions:29 (non-investment row → /transactions)
+ :313 (/accounts axe) PASS. All pure-nav/render/unit → sidesteps the #16 stall entirely.

Hostile Checker (wf_13d4c3fc-c44, 4 dimensions → refute-by-default verify of every P0/P1): **0 P0/P1** —
correctness 10/10 (summary card structurally reads data.overall only; inertness holds; no golden moves),
security 9/10 (ownership unbreakable — the view filters already-ownership-scoped data, a foreign id just
matches nothing → full view; searchParams type-safe; no XSS). All 3 P1 candidates (test-adequacy: the
active multi-account scope path isn't e2e-tested) REFUTED to P2 — adding a 2nd seed brokerage would move
the very goldens #160 must hold, so the narrowing LOGIC is unit-locked (the 8 known-answers ARE the
"filtering-applied vs param-ignored" distinction) + a thin view consumer + e2e wiring, matching the #123
retirement-what-if precedent (repo has no RTL/jsdom; environment:'node'). 1 P2 FIXED: chip copy "Showing
<name> holdings" (scope clarity). Accepted P2s (documented, app-consistent): the reset link uses the shared
muted+hover:underline+arrow pattern (axe-passing, transactions:313); no bespoke focus-restore (consistent
app-wide — #81 skip-link + focusable <main>); `?account` unencoded matches the shipped /transactions
sibling (cuid URL-safe); no axe-on-scoped-view (the demo can't render one — inert). Ledger: DECISIONS #160;
PROGRESS 2026-07-03 #160 + handoff. Committed, NOT pushed (push owner-gated).

## #161 — Categorization learns from repeated corrections (passive learning) — DONE ✅

Owner ask: "the categorization should learn from users' inputs; the user shouldn't have to recreate
the wheel each time." Before this, a `Correction` was per-transaction and consulted by NOTHING at
categorize time — it only helped future rows if the user manually promoted it to an explicit "Always"
rule (easy to miss, blocked for aggregates), so "credit card paid" / "check paid" -> transfer, re-filed
every sync, never stuck. Now pure `deriveLearnedRules()` (src/lib/engine/categorize/learn.ts) turns the
undoable Correction HISTORY into synthetic `RuleLike[]` appended (in src/server/rules.ts `loadUserRules`)
to the same `rules[]` array `categorize()` already applies at every ingest + backfill path. Learned rules
key on an IDENTITY-PRESERVING descriptor signature (src/lib/engine/categorize/signature.ts): dates + money
amounts stripped, account/phone/check numbers KEPT — so two occurrences of the same payee share one key
while two different payees never do. Earned by repetition: same category >= 2 times across distinct
transactions, zero conflicts, #44 sign guard at derive AND match time, a distinguishing-token guard for
payee-less residues. Computed on the fly — no schema change, no DB writes — so the demo (0 corrections)
derives 0 learned rules and every golden is byte-identical; undo re-derives. A learned rule auto-files at
8500 (FLAGGED band) with the visible AI badge, a correctable guess rather than the silent 9900 an explicit
"Always" earns. Also shipped: Google One -> software, Round1 -> entertainment (owner-reported normalize misses).

Gate (real 2026-07-04): `bash scripts/verify.sh` -> ✅ VERIFY GREEN, **1704 unit / 128 files** (+30 over the
1674/126 baseline: learn.test.ts known-answer canaries + hostile-critic regressions; learn-loader.test.ts
drives the real recategorize -> loadUserRules -> categorize chain on a throwaway user), tsc/eslint/next build
clean; adversarial `eval:categorize` 100% auto-file precision / 0 confidently-wrong (Google One + Round1 now
auto-file). Engine-first: the whole learner is a pure unit-tested function on flat primitive inputs.

Hostile Checker — FOUR cycles (Workflow maker/checker, dimension critics -> refute-by-default verify of every
P0/P1), **0 P0/P1 at sign-off**. c1: 6 P0/P1 over-generalization (enumeration defeated by numeric payees;
unguarded canonical; no match-time sign guard) -> adopted the identity-preserving signature + distinguishing-token
+ match-time sign guard. c2: 2 (fragile SEND/MONEY/BANKING; HMSHOST bucket canonical) -> REMOVED canonical mode
entirely (distinct payees structurally un-mergeable). c3: 1 P1 (payee-less generic mechanism labels DIRECT DEBIT /
POINT OF SALE / SERVICE CHARGE / LOAN PAYMENT) -> extended NOISE_TOKENS + AI-badge backstop so any missed label
is visible, not silent. c4 (final): the confidence/AI-badge ripple dimension came back CLEAN (0 findings), and
1 P1 was reproduced end-to-end — bare payment-frequency / card-entry labels ("AUTOMATIC PAYMENT <date>",
SCHEDULED/REGULAR/PERIODIC/GENERAL PAYMENT, PIN PURCHASE) are a payee-less-AND-number-less residue with no number
to keep billers apart -> FIXED by extending NOISE_TOKENS with 11 payment-frequency adjectives + card-entry modes,
each verified brand-safe (GENERAL MOTORS->MOTORS, AUTOMATIC DATA PROCESSING->DATA, SIGNATURE PROPERTIES->PROPERTIES).

Accepted residual (documented): the payee-less-AND-number-less class is closed enumeratively for every common
US-bank autopay label; any RARE unlisted bare label is bounded to P2 by the AI-badge backstop (auto-files as a
visible correctable guess at 8500, strictly no worse than the app's existing provider-hint / low-confidence
merchant guesses). Two accepted P2s: (a) a named payee whose descriptor carries a VARYING confirmation number
never repeats a signature, so it stays in review — a money-safe false negative; explicit "Always" remains the
merchant-wide tool. (b) learnedSignOk is inert for a custom/unknown-group category (returns true), gated instead
by the derive-time consistency + distinguishing-token guards. Owner's headline cases: "CREDIT CARD PAID" learns
(date-fragmented; CREDIT is its distinguishing token; a card payment IS a transfer); "CHECK PAID" correctly
REFUSES (payee-less + ambiguous — the safe default). Ledger: DECISIONS #161; REGRESSION_LEDGER 2026-07-04;
PROGRESS 2026-07-04 #161 + handoff. Committed, NOT pushed (push owner-gated).

## #162 — "Accept all confident": one-tap triage-pile drain — DONE ✅

Owner "drain the pile" queue-UX pick. SUBSYSTEM-MAP FINDING (surfaced to the owner before building):
the handoff's premise was STALE — `/triage` already groups the review pile by merchant and files a
whole group in one action (`fileMerchantGroup`, #143). So this adds the missing accelerant on TOP of
the existing carousel, it does NOT rebuild it.

**What shipped (engine-first, surgical — reuses the tested #143/#146/#147 filing path):**
- `src/lib/engine/categorize/group.ts` (+3 pure fns) — `isConfidentGroup` (suggestedCategoryId !== null =
  the exact swipe-right bar; groupReviewRows only sets it when EVERY row agrees, never a guess),
  `selectConfidentGroups`, `summarizeConfident`. ONE predicate → client button + server action can't drift.
- `src/server/triage-actions.ts` `acceptAllConfident()` — re-derives the confident set server-side from
  getTriageGroups(userId) (client list never trusted), loops the EXISTING `fileMerchantGroup` per group
  (per-group serializable-tx commit, rule mint/reuse, aggregates no rule #23), collects all correctionIds
  into ONE undo batch (existing `undoCorrections` reverts the lot + removes ONLY minted rules). Per-group
  commits (a drain is incremental + independently undoable); catch-per-group = graceful partial; total
  wipeout throws a stable user-safe message (fail-loud, no raw-error leak); no-op early-return (0 confident
  → no audit/revalidate).
- `src/components/triage/triage-inbox.tsx` — bulk-accept banner shown only when `mode==='idle'` AND ≥2
  confident (never mid-pick → never discards an in-progress recategorization; 1 is just a swipe), optimistic
  drop-then-reconcile with the authoritative returned queue, focus handoff to the aria-live count (SC 2.4.3),
  one undo entry ("N transactions in M merchants").

**Golden-safe by construction:** the demo's 12 review groups are ALL ambiguous (Zelle payees / checks /
Store Card → 0 confident) → banner provably inert → every golden byte-identical; it acts only on a click.

**Gate (real 2026-07-04):** `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1716 unit / 129 files** (+12:
pure selection; drain files-confident/leaves-ambiguous; mint-vs-reuse; undo round-trip removing ONLY minted
rules; ownership isolation; no-op; partial-failure-skips-and-requeues; total-failure-fail-loud; non-vacuous
demo-0-confident golden lock), tsc/eslint/next build clean. Read-only e2e green: banner absent on the
all-ambiguous demo (3.0s) + the existing gesture/filing/undo flow unregressed (4.6s).

**Hostile Checker (Workflow, 5 dimension critics → refute-by-default adversarial verify of every P0/P1):**
scorecards correctness 8 / security 8 / golden 9 / ux-a11y 7 / coverage 6, **0 confirmed P0/P1** (the lone
P1 candidate — the untested partial-failure branch — was self-DOWNGRADED to P2 by its verifier: "shipped
code is correct, a pure coverage gap"). Fixed the high-value P2/P3s before sign-off: partial + total-failure
tests + demo-0-confident golden lock; no-op early-return; clean fail-loud message; banner gated to idle;
focus handoff; "the ambiguous rest stay for you to review" copy + unit-bearing undo label. Accepted/
documented P2/P3s: partial failure is signalled by the failed groups visibly reappearing in the queue (rare
error path; no new toast channel); fileMerchantGroup's post-commit auditLog-throw un-undoable edge is a
pre-existing property of that path; no per-action rate limit (consistent app-wide, ROADMAP #8); the active
client handler is e2e-inert on the all-ambiguous demo so it is server-boundary + pure-unit locked (the
#160/#123 no-RTL precedent); #161 learned rules re-confidencing a still-queued group is the learner working.
Ledger: DECISIONS #162; REGRESSION_LEDGER 2026-07-04; PROGRESS 2026-07-04 #162 + handoff. Committed, NOT
pushed (push owner-gated).

## 2026-07-04 — #163 open finding: phase2-triage e2e stall (PRE-EXISTING, roaming — not #163)
One phase2-triage spec per run times out (60s) on a triage button stuck disabled mid-flow (`pending`
never settles — a server action that neither errors nor returns; the manually-captured `next start` log
shows NOTHING). PROVEN pre-existing and tree-independent by controlled A/B runs (all with fresh builds,
killed 3100 servers):
  • pre-#163 tree, :109 SOLO run → FAILS;  post-#163 tree, :109 in full-suite → passes.
  • post-#163 tree, :239 solo → passes;  :239 after 2+ specs in sequence → FAILS (×3).
  • pre-#163 tree, SAME full spec file in sequence → FAILS at :239 IDENTICALLY.
The failure roams between specs and trees and correlates with SEQUENCE LENGTH / machine load, matching
the flake already documented in tests/setup/test-db.ts and tests/e2e/global-setup.ts ("an accept/triage
write can stall past the click timeout and hang the disabled-while-pending button — the phase2-triage
flake"): a SQLite writer starved under load. WAL mitigated but did not eliminate it. Secondary note: the
dev machine's `.env.local` carries a real `XAI_API_KEY` (84 chars) so e2e triage-adjacent actions CAN make
live LLM calls — worth removing from the e2e server env regardless. Suggested for a future session:
(a) blank XAI_API_KEY/ANTHROPIC_API_KEY in playwright webServer.env; (b) add a busy_timeout / bounded
retry probe around the triage write path with instrumentation to catch the stall in the act; (c) consider
per-spec DB reseed. Not fixed in #163 — pre-existing infrastructure, out of scope.

## 2026-07-05 — #164 phase2-triage stall ROOT-CAUSED AND FIXED (the STATUS 2026-07-04 open finding)
The "server action that neither errors nor returns" stall was NOT the SQLite writer and NOT the live
LLM key. Boundary probes (client POST send/headers/body-fin events + server action entry/exit logs +
piped server stdout) showed every triage write committing in ~5ms and even net-FINISHING — while
`useTransition.pending` stayed true forever. Mechanism: under rapid sequential dispatch Next aborts a
superseded action's response stream (`net::ERR_ABORTED` on the action POST) and leaves the router's
flight-data application unresolved; React ENTANGLES transition lanes, so the wedged lane froze
`pending` for every later action too — all triage buttons disabled until reload. The old evidence
(roams specs/trees, correlates with load) had pattern-matched to the known SQLite flake; the probes
split the layers honestly.

**Shipped (DECISIONS #164):**
- triage-inbox busy state = explicit `useState`, NOT `useTransition` (immune to the wedged lane);
  every awaited action bounded by `withDeadline` (15s, `action-deadline.ts`); deadline recovery
  re-syncs via the new read-only `refreshTriageQueue` action (never rollback — the write usually
  COMMITTED; only the confirmation was lost).
- Hermetic e2e: XAI/ANTHROPIC keys blanked at playwright.config module scope (the dev `.env.local`
  carries real keys; e2e must never make live LLM calls).
- `llm-categorize.ts` fetches now carry the same 7s AbortController bound as assistant-llm.ts (an
  unbounded hung provider fetch stalls the calling server action — the same UX signature in
  production; locked fail-old-proven).
- The stall had MASKED two deterministic e2e ordering bugs behind its failure point ("did not run"
  for weeks): the write-in test net-files the demo's ONLY multi-row group (its mid-test reload
  discards the undo stack) starving the singles-mode test, and the read-only #162 banner lock ran
  AFTER the review-cost test drained the whole queue. Fixed by ordering, documented as the
  SERIAL-RESIDUE CONTRACT comment in the spec.

**Witness (real, 2026-07-05):** pre-fix 4/4 full-file runs failed (60s stall); post-fix phase2-triage
6/6 × 3 consecutive runs (~31s each); `bash scripts/verify.sh` → ✅ VERIFY GREEN; FULL e2e suite
**75/75 passed (55.0s)** — first fully green full-suite run since the flake was first documented
(STATUS #16/#17).

**Accepted / follow-ups:** other useTransition surfaces (transaction-list, backfill-button, settings
managers, etc.) are single-action per interaction — the wedge needs OVERLAPPING sequential dispatches —
so they keep useTransition (exposure noted, not changed). A Next patch upgrade (15.5.19 → latest) may
fix the underlying abort race upstream — worth taking with the next dependency pass. The e2e reseed-
per-spec idea (STATUS 2026-07-04 suggestion c) is superseded by the residue contract for now.

## 2026-07-05 — #165 transfer pair FILING: "a transfer is never in review" (owner pick: transfer-pairing for "credit card paid")
Premise re-checked before building (the #162 stale-premise lesson): pairing already existed
(detectTransfers, DECISIONS #22) — the real defect was add-flag-only persistence. A pair whose
descriptor the normalizer doesn't know (probe, real output: normalizeMerchant('CREDIT CARD PAID')
→ uncategorized/5000 → needsReview:true, while detectTransfers pairs both sides) got isTransfer:true
(excluded from every sum) yet stayed WEDGED in the triage queue under a wrong guess — the exact prod
symptom the #161 learned rule worked around. Demo-inert (every seeded pair descriptor is
normalizer-recognized), which is why it only ever bit in prod.

**Shipped (full detail: DECISIONS #165):** pure planTransferUpdates() flag-vs-file split (file only
needsReview && !reviewPinned && POSTED && supported-currency; heals legacy wedges; pair filings at
8500 FLAGGED band — visible AI provenance); ONE shared refreshTransferFlags(userId) helper replacing
the two drifting provider copies (FK-guarded by ensureCategories, #65); structural queue guards —
getTriageItems/getTriageGroups/getReviewCount/review-scoped batch all carry
OR:[{isTransfer:false},{reviewPinned:true}] (PIN WINS; register scope still re-files transfers, #36);
backfill excludes isTransfer in read AND re-asserted write; categorize-assist refuses 'transfer' in
BOTH directions (the #155/#163 stance, previously contradicted by an inflow allowance); undo of a
transfer-flagged row PINS it (undoCorrections + undoSplit).

**Hostile Critic cycle 1 (fresh-context, 8-axis):** 2 P1 (undo-vanish + batch-scope drift), 3 P2
(provisional/currency/confidence filing; assist-transfer; coverage), 1 P3 — all fixed with locks.
**Cycle 2 (fresh-context re-verify):** F1–F4 CONFIRMED FIXED; caught 1 NEW P1 — the filing write's
where was bare `id IN (...)`, no read-guard re-assertion (the backfill cycle-5 class): a user
decision landing in the read→write window was clobbered, or an undo-pin raced into the unclearable
pinned-but-filed wedge. Fixed (write re-asserts every guard; helper returns the guarded writes' REAL
counts) + deterministically locked by mocking ensureCategories to perform the mid-window action
(transfer-refresh-race.test.ts, fail-old by construction). REGRESSION_LEDGER ×2 (2026-07-05).

**Gate (real, 2026-07-05):** `bash scripts/verify.sh` → ✅ VERIFY GREEN; units **1798/1798, 133
files** (+20/+2 over #164); phase2-triage e2e 6/6 twice (30–31s); FULL e2e **75/75 (53.4s)** on a
fresh build. Full-suite runs under heavy machine load dropped 1–2 roaming specs
(transactions:145/:191, phase4:13) — PROVEN pre-existing by controlled A/B: the stashed pre-#165
tree fails the SAME :191 plus a DIFFERENT spec on a fresh build, both trees pass the specs solo.
Same load-correlated class STATUS 2026-07-04 documents; not a #165 regression.

**Accepted (documented in DECISIONS #165):** LLM-key users can still have assist file ONE side of an
unrecognized pair to a non-transfer category at ingest (assist runs pre-persist; sums stay correct
via the flag; register-correctable; a deterministic-first reorder needs the assist interface to
carry account/date — deferred). Provider re-send transient reset healed by end-of-sync re-filing
(untested lifecycle). Pair matching itself stays loose (any 2 accounts, ±3d) — tightening is a
separate increment.

## 2026-07-05 — #166 SEAMLESSNESS PASS (owner directive: "too many things don't work seamless")

Full detail in DECISIONS #166 + REGRESSION_LEDGER (3 entries). Headlines:
- **P0 FIXED:** real users' payroll ('paycheck' leaf since #163) was classified as a refund by
  `monthlyFlows` — prod income $0, savings rate/FI/coach garbage; goldens stayed green because the
  demo's payroll matches a merchant rule mapping to the old 'income' id. Group-aware
  `isIncomeCategoryId` now used by monthlyFlows + isBudgetable ('Paycheck' was the DEFAULT
  budget-target option). 'refund' leaf still nets (critic F1).
- **Next 15.5.19 → 16.2.10:** fixes the deterministic client flight-application bug that killed
  calendar month-paging (the misread "phase4:13 flake") and /transactions filters/pagination/Import
  (probes: 5/7 fail → 7/7 commit; 4/4 fail → 8/8 work).
- **Mutation reliability:** post-action page application was ~50% roulette in plain-paced probes on
  BOTH Next versions (the #164 class beyond triage; almost certainly the old #16/#17 "stall flakes"
  and a big share of the owner's prod complaint). Budgets/goals mutations now use direct invocation +
  own busy flag + withDeadline(8s, form-deadline.ts) + full reload on success — probes 5/5
  deterministic. MoneyDialsForm converted too (its useActionState "saved" confirmation failed the
  same way mid-gate): direct invocation, inline confirmation from OWN awaited state (no reload —
  nothing else on the page derives from dials), reload only on a severed confirmation. Typos get
  inline field errors with fields preserved ("$500"/"1,000" now parse; "abc" never crashes the page).
- **SW v3 (installability only):** the v1/v2 fetch listener amplified aborted action streams for
  near-zero value; offline shell retired; existing installs self-heal on update. pwa-offline.spec.ts
  now regression-tests a server action under a CONTROLLING SW.
- **Ask honesty:** unresolved "spent at X" abstains (deterministic + LLM fallback); "afford $X by
  <future date>" solves the savings goal (with current-month/rate/bill guards); subscriptions answer
  no longer attributes rent/loans to "subscriptions" (~7× overstatement fixed, dashboard card too).
- **Polish:** overspent safe-to-spend reframe; recurring next-dates un-truncated; year shown in
  register/triage dates; reports Uncategorized → Inbox link; aimplifi-* export filenames; nav
  prefetch=false (revalidate prefetch-storm removed).

**Gate (real, 2026-07-05):** `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint
clean, **1816 unit / 133 files** (+18 over #165), build clean, **FULL e2e 75/75 (59.7s)** with the
new e2e `workers: 4` cap (the shared-SQLite harness at default workers severed action-confirmation
streams under load — the same single-writer reason the unit suite serializes; prod is Postgres).
Deterministic probe witnesses in scripts/audit-probes/ (budget mutation 5/5 consecutive runs,
calendar 7/7 months, transactions first-action 8/8, invalid-input fields-preserved).

**OPEN / follow-ups (#166):** (a) apply the reliable-mutation pattern to remaining plain form
actions (accounts add/edit/delete, settings managers, register recategorize feedback) — the register
chip staleness agent-1 flagged is this same class; owner corroboration from prod welcome; (b)
merchant-spend Ask intent; (c) category month-over-month drill-down; (d) #71 nav redesign +
settings reorganization (owner-scoped); (e) Recharts pinned-on-load tooltip + width(-1) warning;
(f) triage accuracy-metric drops when filing ambiguous groups + doesn't restore on undo (agent-1
P2-1); (g) two adjacent "Connect a bank" buttons need clearer labels (owner uses BOTH providers).

## 2026-07-05 — #167 reliable-mutation pattern app-wide + e2e golden isolation

(#166 NEXT items 0+1.) The five surfaces still on useTransition+router.refresh()
(register recategorize, accounts manual mutations, backfill, settings custom-category
CRUD, settings visibility toggles) converted to the #166 recipe; the
manual-card-statement e2e moved onto a throwaway user (no demo-golden coupling).
Before-witness: recategorize probe lost 0/2 rounds on the old wiring at plain pacing
(the transactions.spec:145 flake reproduced 2× the same session); after: 2/2, all
probes green (recategorize/accounts/backfill/budget/first-action). New flash.ts
carries text confirmations (backfill count, "Statement saved") across the confirming
reload — set strictly after res.ok; unit-tested.

Hostile Critic (fresh-context): 1 P1 FIXED (post-reload pre-hydration clicks drop —
state-aware click-and-verify retries in the spec; re-witnessed 3/3 on the exact
failing mix), coverage P2 FIXED (flash unit tests + a throwaway-user backfill e2e).
**Accepted P2 (documented, inherent to the recipe since #166):** reload-on-success
aborts a sibling component's queued action (Next serializes action POSTs per tab;
pending flags are per-component) — visible and recoverable, one-round-trip window;
follow-up: page-scoped shared pending that disables sibling mutation surfaces while
a reload-bearing mutation is in flight.

Gate (real output 2026-07-05): VERIFY_E2E=1 bash scripts/verify.sh → ✅ VERIFY GREEN
(1816 unit / 133 files, FULL e2e 75/75 at 52.2s). Post-critic-fix changes were
test-only; the targeted 17-spec mix ran 3/3 green but a FULL 76-spec rerun was not
executed (session ended on owner request) — re-witness with `npx playwright test`.

Remaining same-class surfaces (old pattern, lower traffic): add-transaction form
(plain <form action>), import-csv form (useActionState, inline-result shaped),
delete-my-data form, auth forms (navigation class), connect-simplefin. Next
increments list otherwise unchanged from #166 (merchant-spend Ask intent, category
drill-down, #71 mobile-nav, Recharts polish).

## 2026-07-05 — #168 merchant-spend Ask intent

(#166/#167 top-queued NEXT item, resumed on "continue".) "How much did I spend at
Costco?" now answers a per-merchant total instead of abstaining. New `merchant_spend`
intent: pure `merchantSpend()` aggregator + `answerMerchantSpend()` formatter, server
`buildAnswer` case reusing a factored `toPurchaseRows()` shared with `largest_purchases`
(same POSTED-only, `isPurchaseRow`-filtered universe — can't drift). The merchant name
is derived from the DATA (canonical with the largest matched total), never the user's
typed string; every dollar traces to a real transaction.

**Precedence + preposition split (the design crux):** `resolveSpendTarget` runs first,
so category synonyms keep precedence ("on coffee"/"on groceries" stay `spend_by_category`;
Starbucks→coffee / Amazon→shopping undisturbed). Only an **at/with** object that didn't
resolve to a category routes to `merchant_spend`; a bare unresolved **"on X"** ("on golf",
"on average") keeps ABSTAINING to the honest unknown redirect — never the all-spending
total (the #166 P1 invariant, re-locked). The split made assistant-custom-category's
"spend on golf → unknown" test pass unchanged.

**Hostile Critic (fresh-context):** 1 P1 + 2 P2 + 2 P3. P1 FIXED — apostrophe/possessive
false-negative ("mcdonalds"/"trader joes"/"lowes" missed the apostrophe'd canonical →
confident-wrong "No spending"): symmetric punctuation folding (`merchantKey`), unit +
seed-grounded locks. P2 FIXED — payment-method phrasings ("with my card/venmo") fabricated
"No spending at Card": a tender stop-set abstains. P2 ACCEPTED (documented) — GROSS by
design (matches /trends `largest` + the /transactions activity list it links to; keeps the
headline reconcilable against the listed facts), where `spend_by_category` reads net. P3
left: "at A and B" reports only A (uncommon); "at home"-class short terms already caught by
the GROUPS-substring category precedence.

**Gate (real, 2026-07-05):** `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN —
tsc/eslint clean, **1843 unit / 135 files** (+27 over #167), build clean, **FULL e2e 76/76**
incl. a new read-only "at Costco" ask.spec assertion. (Diagnostic: the first ask.spec run
failed all 8 — a straggler `next start` on port 3100 served a stale build under
`reuseExistingServer`; killed → fresh spawn 8/8. Stale-3100 trap is in playwright.config.ts.)

**OPEN / follow-ups (unchanged from #166/#167 minus this item):** (a) remaining lower-traffic
reliable-mutation surfaces (add-transaction/import-csv/delete-my-data/auth/connect-simplefin);
(b) category month-over-month drill-down (Mint-parity); (c) #71 nav redesign + settings
reorganization (owner-scoped); (d) Recharts pinned-on-load tooltip + width(-1) warning; (e)
triage accuracy-metric drops when filing ambiguous groups + doesn't restore on undo (agent-1
P2-1); (f) two adjacent "Connect a bank" buttons need clearer labels (owner uses BOTH
providers); (g) #168 P3s: multi-merchant "at A and B", and page-scoped shared pending (the
#167 accepted-P2 follow-up).

## 2026-07-07 — #169 triage accuracy metric recovers on undo (was #168 open follow-up (e)) — DONE

The /triage categorization-accuracy card (DECISIONS #37) dropped when you filed an ambiguous
group but never recovered when you undid the filing. Filing stamps
`CategoryPrediction.actualCategoryId` = the chosen category (ground truth), so a mis-guess scores
as a miss and drops the displayed accuracy; `undoCorrections` restored the transaction to review
+ removed any minted rule but NEVER cleared `actualCategoryId`, so `getCategorizationAccuracy`
(counts predictions WHERE actualCategoryId is not null) kept counting a decision the user took
back. Reachable in the seed's own drain flow.

**Shipped:** one write inside the existing per-correction `$transaction` in `undoCorrections`
(`src/server/triage-actions.ts`) — null `categoryPrediction.actualCategoryId` for the restored
transaction, atomic with the inverse-correction insert + restore + transfer-pin + rule cleanup.
Invariant now symmetric with the four filing writes (applyCategory / applyToAllSimilar /
fileMerchantGroup / recategorize): a `needsReview` row carries no confirmed label. `undoSplit`
deliberately unchanged — `splitTransaction` sets categoryId=null and never labels a prediction.

**Fresh-context hostile Critic (adversarial, refute-by-default): 0 P0/P1/P2** — scoping
(transactionId @unique -> at most one row; userId session-trusted), over-revert (null is the ONLY
consistent label for a restored review row; restoring a prior label would be the bug), undoSplit,
undo-funnel completeness (recategorize/applyToAllSimilar have no undo path bypassing
undoCorrections), idempotency/atomicity, golden-safety, and metric-honesty all acquitted with
evidence.

**Gate (real output 2026-07-07):** `VERIFY_E2E=1 bash scripts/verify.sh` -> VERIFY GREEN —
tsc/eslint clean, **1845 unit / 136 files** (+2/+1 over #168: tests/unit/accuracy-undo.test.ts),
build clean, **FULL e2e 76/76 (47.7s)** incl. the existing "accuracy card shows a measured value
(DECISIONS #37)" spec. Fail-old/pass-new PROVEN by stash-run (2/2 fail without the fix, incl. the
un-nulled sample leaking into the sibling test's count; 2/2 pass restored). Committed. Ledgers:
DECISIONS #169, REGRESSION_LEDGER 2026-07-07, PROGRESS 2026-07-07.

**OPEN / follow-ups (unchanged from #168 minus this item (e)):** (a) remaining lower-traffic
reliable-mutation surfaces (add-transaction/import-csv/delete-my-data/connect-simplefin); (b)
category month-over-month drill-down (Mint-parity); (c) #71 nav redesign + settings
reorganization (owner-scoped); (d) Recharts pinned-on-load tooltip + width(-1) warning; (e) two
adjacent "Connect a bank" buttons need clearer labels (owner uses BOTH providers); (f) #168 P3s:
multi-merchant "at A and B", and page-scoped shared pending (the #167 accepted-P2 follow-up).

## 2026-07-07 — #170 reliable-mutation pass finished (last four surfaces)

(#166/#167 top-queued NEXT item (a), resumed on "continue".) The four remaining lower-traffic
mutation surfaces, each treated on its merits rather than force-fitting the recipe:

- **connect-simplefin** — the only TRUE stale-UI defect (useTransition + `router.refresh()`, the
  coin-flip #166/#167 retired, on a same-page mutation). Converted to the reload + `setFlash('accounts')`
  recipe; a failure shows a red inline error and does NOT reload. No `withDeadline` (a SimpleFIN action
  is a single-shot NETWORK call that can outlast the 8s form deadline; no severed-stream case). The
  connect/sync SUCCESS branch is dormant/UNVERIFIED (no creds) — inspection-verified only; the dormant
  form-opens e2e stays green.
- **add-transaction** — a plain `<form action>` whose action THREW on reachable bad input (non-numeric /
  zero / negative amount) to the app error boundary. Converted to the proven GoalForm onSubmit recipe
  (own busy + `withDeadline` + inline errors + `window.location.assign('/transactions')` on success; the
  action returns `AddTxnResult`, no longer redirects). **First tried useActionState and the new e2e caught
  React 19's form-reset silently reverting the account `<select>` to the first option (critic P1 — a
  wrong-account mis-file); onSubmit avoids the reset entirely (the #166 lesson, re-confirmed).**
- **delete-my-data** — added a `useFormStatus` "Deleting…" busy state (native form + signOut redirect
  unchanged) so the irreversible action gives feedback and blocks a double-submit.
- **import-csv — LEFT AS-IS (by design):** it already satisfies the invariant — a self-contained inline
  imported/skipped/per-row-error report with no same-page stale list. flash+reload would REGRESS that
  per-row report. Documented, not converted.

**Hostile Critic (2 fresh-context passes — find + confirm):** find pass scored the money math clean and
found **1 P1 + 2 P2, all FIXED**: (P1) the useActionState form-reset account revert → onSubmit recipe +
an e2e that selects a non-default account and asserts it survives the error; (P2) "Connected, but first
sync failed" flashed GREEN → success-framed copy; (P2) a bare `catch` mislabeled any DB error as
"category not found" → narrowed to the exact `'Choose a valid category'` throw. **Confirm pass: PASS,
0 P0/P1** (all three verified resolved with code evidence, no new P0/P1). Accepted P2s: the onSubmit
non-deadline catch now surfaces the error (tighter than GoalForm); one combined `role="alert"` rather
than per-field wiring (the errors aren't field-keyed); two harmless dead `redirect` mocks in test files.

**Gate (real output 2026-07-07):** `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint
clean, **1848 unit / 137 files** (+3 over #169: tests/unit/manual-txn-validation.test.ts), build clean,
**FULL e2e 77/77** (+1: the error-path-with-account-preservation spec). Fail-old PROVEN both ways: the
validation lock 3/3 fail when the try/catch is defeated (engine throw propagates); the P1 account-revert
was witnessed failing the full gate on the useActionState attempt (`expect(account).toHaveValue(chosen)`).

**OPEN / follow-ups (unchanged from #169 minus item (a)):** (a) category month-over-month drill-down
(Mint-parity); (b) #71 nav redesign + settings reorganization (owner-scoped); (c) Recharts pinned-on-load
tooltip + width(-1) warning; (d) two adjacent "Connect a bank" buttons need clearer labels (owner uses
BOTH providers); (e) #168 P3s: multi-merchant "at A and B", and page-scoped shared pending (the #167
accepted-P2 follow-up); (f) NEW: import-csv's own account `<select>` shares the latent useActionState
reset (milder — rows are filed server-side with the correct account BEFORE the reset, so no mis-file),
left as pre-existing; (g) NEW: connect-simplefin's network success branch remains UNVERIFIED (dormant).

## Post-Phase-5 refinement: connection-health / data-staleness (#171, Competitive-Gap plan Gap 1 §3–4)

First increment executing docs/COMPETITIVE_GAP_PLAN.md (written 2026-07-07). The #166–#170
seamlessness/reliable-mutation thread finished at #170; "continue" picks up the plan's top
NON-owner-gated slice of Gap 1 (live-data reliability): a pure staleness classifier + its
surfacing. Live Plaid/SimpleFIN sync + reconnect (Gap 1 §1–2) stay owner-gated (need tokens).

Pure engine `src/lib/engine/sync/health.ts` grades a linked feed fresh/stale/very_stale/unknown
by whole-day recency (FRESH_THROUGH_DAYS=3, STALE_THROUGH_DAYS=13, exported + boundary-pinned).
Copy states data is OLD but NEVER asserts a connection is "broken" — there is no persisted
sync-error signal to observe, so a "broken" claim would fabricate (no-fabrication rule at product
scope). Surfaces: /accounts SimpleFIN connected row → "Synced N days ago" / amber "…you may need
to reconnect" (from the existing SimpleFinConnection.lastSyncedAt; getAccountsView gains
simplefin.health, no new query); dashboard StaleDataBanner (from getDataFreshness in
server/connection-health.ts). No schema change; the network layer is untouched.

Golden-safe: linked = provider in {plaid,simplefin}; demo accounts are all provider 'demo' → no
linked feed → banner self-nulls and /accounts is unchanged (hostile critic proved the demo
byte-identical). getDataFreshness grades the MOST RECENT of {lastSyncedAt, newest linked
transaction}, so a healthy-but-quiet linked feed can't trip a false "sync may have stopped".

Gate (real output 2026-07-07): `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN —
tsc/eslint clean, **1869 unit / 138 files** (+21: tests/unit/sync-health.test.ts), build clean,
**FULL e2e 79/79** (+2: connection-health.spec.ts negative demo-lock + positive throwaway fixture
via scripts/e2e-add-stale-linked-account.ts, incl. axe AA on the banner).

Hostile Critic (fresh-context, refute-by-default): **0 P0/P1**. Honesty, golden-safety (proven),
classifier boundaries (recomputed), ownership, perf (2 indexed queries), e2e rigor, and isoDate
crash-safety all PASS. One P2 FIXED: the dashboard graded newest-transaction while /accounts graded
lastSyncedAt → a quiet-but-healthy feed could show a banner contradicting its own /accounts row;
now both reconcile through the most-recent-reference rule (unit-locked). Accepted (documented): a
single portfolio banner can't say WHICH of several linked feeds stalled (per-account last-activity
on /accounts is the next slice); live sync/reconnect stays owner-gated.

## Post-Phase-5: Cash Flow Radar (#172, Competitive-Gap plan Gap 2 §1 — AI plan §1.2, adjudicated build-now)

The strategic proactive-layer build, engine-first (LOOP #5), Fable lane per plan §3. New pure
engine `src/lib/engine/radar/`: `burn.ts` (day-to-day discretionary checking pace — WEEKLY
nearest-rank p50/p80 ÷ 7, clamped to real account history; selection excludes transfers, split
parents, pending, and committed merchants) and `radar.ts` (`projectCardDues` — cash-needed
obligations + synthesized future cycles from each card's raw due date at the FULL statement
basis, always `isEstimated`; `computeRadar` — one committed-only walk via `computeForecast`
merging /forecast's exact scheduled+loan events with the card dues, first-negative + lowest
point, colliding-card attribution + dip-day events, minimum timed cover-transfer, burn band).
Server `radarFromSnapshot` (pure, seed-groundable) + `getCashFlowRadar`; dashboard
`CashFlowRadarCard`; e2e `cash-flow-radar.spec.ts` (demo: alert on 2026-06-24 after the Jun-15
Platinum+Sapphire dues, cover $6,950.00 by Tue Jun 23 from High-Yield Savings, axe AA).

All three adjudicated conditions are engine-enforced and test-pinned: (1) status derives from
the committed line only — the burn band can raise at most `watch`, never `alert`; (2) transfer
sources are CHECKING/SAVINGS only, never the payment account or the demo's $142k brokerage;
(3) every synthesized future cycle is labeled estimated, including in the colliding-card
sentence. `pushWorthy` (committed dip ≤ 7 days) is the Gap 2 §2 notification hook, unused yet.

Hostile Critic cycle 1 (fresh-context, refute-by-default): FAIL — 2 P1 + 4 P2 + 5 P3, both P1s
proven by execution. P1-1 FIXED: future cycles repeated the post-mid-cycle-payment RESIDUAL
(seed Freedom: $600 instead of the $1,000 statement) — optimistic bias on the alarm line; now
`cycleBasisCents` (full statement balance) drives synthesis, a fully-paid card still projects
its future cycles, demo cover corrected $6,150 → $6,950 (exactly the predicted +$800). P1-2
FIXED: the daily-percentile burn collapsed to a false $0/day on sparse-but-real spend (~$966 in
the demo window) and the fallback copy asserted a falsehood — replaced with the weekly
estimator (demo now 1400¢/3051¢ per day) and a literally-true zero-spend sentence. P2s: cover
copy now says what the amount buys ("the whole 90 days"); estimated label added to the
colliding sentence; the #134 loan-ACH double-count (which the radar promotes from chart wobble
to alarm input) now detected and disclosed as a hedged "counted twice → conservative"
assumption (no heuristic dedupe — STATUS #134 stands); DECISIONS #172 written. Confirmation
Checker (independent seed probe): **PASS, 0 open P0/P1**, no new defects from the fixes.

Accepted / follow-ups (documented, non-gating): mortgage/unbranded-loan overlap disclosure gap
(normalize.ts has no mortgage category, so only auto-loan overlaps are detectable — same
accepted-residual class as #134); CD/money-market map to SAVINGS and are within condition 2's
letter as transfer sources (liquidity caveat); the dashboard now runs a 9th parallel snapshot +
a detectRecurring pass per load (pre-existing pattern, grounding-over-perf); cover amount is
sized to the whole-horizon worst dip (estimate-dominated when future cycles drive it) — the
copy states this basis. NEXT radar increments: wire `pushWorthy` into notifications (Gap 2 §2),
a sparkline of the three lines on /forecast, per-card "what if I pay early" interaction.

Gate (real output 2026-07-08): `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN —
tsc/eslint clean, **1908 unit / 141 files** (+39/+3 over #171: radar.test.ts,
radar-burn.test.ts, radar-grounding.test.ts), build clean, **FULL e2e 80/80** (54.4s, +1:
cash-flow-radar.spec.ts). EDGE_CASES §Cash Flow Radar added (hand-verified cases A–F).

## Post-Phase-5: Notification delivery (#173, Competitive-Gap plan Gap 2 §2 — the proactive stickiness layer)

The delivery half of the proactive layer, wiring #172's dormant `pushWorthy` hook to a real
channel. Engine-first (LOOP #5): a PURE `engine/notify/select.ts` (`selectNotifications`) unifies
imminent payment reminders + a pushWorthy radar dip into one material, deduped, most-urgent-first
list. Materiality = actionability + urgency (NO dollar floor): a payment surfaces only when
`userActionCents > 0` (autopay-fully-covered → suppressed; partial-autopay with a remainder →
surfaced at the user-action amount) AND due ≤ 3 days; a radar alert only when `radar.pushWorthy`
(committed dip ≤ 7d). No fabrication: every amount is copied verbatim from the source engine, so a
push can't disagree with the in-app card.

Delivery is Web Push behind the SAME dormant contract as email (#47): `lib/push.ts` no-ops
(`{sent:false,reason:'no-provider'}`, no crypto/network) unless all three `VAPID_*` vars are set,
never throws, and reports `{gone:true}` on 404/410 to prune a dead subscription. New
`/api/cron/notify` (CRON_SECRET-guarded) runs the engine per user and delivers via the standard
`web-push` lib. Golden-safe by construction: a `NotificationSent` dedup row is written ONLY after a
real delivery to ≥1 live device, so no-VAPID / zero-subs / all-gone writes NOTHING and a later
opt-in still fires. The seeded demo (provider 'demo', zero subs, no VAPID) is a pure no-op that
reports what it WOULD send — the settings opt-in card is hidden (gated on `getVapidPublicKey()`).
Two SQLite-portable models (`PushSubscription`, `NotificationSent`), both `onDelete: Cascade` so
deletion #31 still fully wipes. SW v4 gains `push` + `notificationclick` (still NO fetch handler).

Fresh-context Fable hostile critic (refute-by-default, money/data-integrity lane): **PASS — 0 P0 /
0 P1** (financial 10 / security 8 / correctness 8 / data-integrity 9); the dedup matrix (dormant /
0-subs / all-410 / partial-410 / DB-race), no-fabrication, dormancy byte-identity, materiality
(incl. partial-autopay), auth-scoping, and cascade all survived attack. 2 P2 + substantive P3s
FIXED same session, each test-locked: SSRF (`isAllowedPushEndpoint` — https-only, rejects all
IP literals + localhost, WHATWG-canonicalized; enforced at subscribe AND re-checked before send);
P2-1 radar dip-date wobble → `radarAlertOnCooldown` (4-day recency, engine-applied) so one episode
pushes ~once; P2-2 unbounded subs → cap 20, oldest-evicted; P3-2 dedup catch narrowed to P2002;
P3-3 NotificationSent pruned at 120d; P3-4 notificationclick pathname-match; P3-6 `'Notification'
in window` guard.

Gate (real output 2026-07-08): `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint
clean, **1938 unit / 145 files** (+30/+4 over #172: notify-select, push, push-subscriptions,
cron-notify), build clean, **FULL e2e 83/83** (+3: notifications.spec — cron 401, subscribe-
unauthed 401, demo-settings-shows-no-card). EDGE_CASES §Notifications added.

**Accepted / follow-ups (documented, non-gating):** email *activation* (set `RESEND_API_KEY`) and
wiring `/api/cron/notify` + `VAPID_*` into `vercel.json`/env are pure operator steps (DEPLOY.md),
consistent with the reminders/sync crons — the mechanism is dormant until then, so live push
delivery (real VAPID + a real push service) is proven at unit/integration level, not e2e (same
stance as the SimpleFIN/Plaid network-dormant precedent). The **weekly digest** (plan §3) is the
next Gap-2 increment. P3s left (critic backlog, non-gating): once-per-subject is per-USER not
per-device (a transient per-device failure with another device succeeding still records — a
deliberate anti-retry-storm choice, comment corrected); `disable()` doesn't check `res.ok` (self-
heals via the next 410-prune); a payment `dueDate` correction mid-cycle is a rare wobble the radar
cooldown doesn't cover (payment keys are otherwise stable).

## Post-Phase-5: Weekly digest email (#174, Competitive-Gap plan Gap 2 §3 — completes the proactive layer)

The last Gap-2 increment and the plan's "cheapest retention win": a weekly email that brings the
user back without a new surface. Mostly COMPOSITION over tested engines — pure
`engine/digest/build.ts` (`buildWeeklyDigest`) renders the Monthly Money Review (the SAME `review`
object /coach shows, via `getCoachData`) + the upcoming week's dues (`selectPaymentReminders` within
7 days) as plain text. No fabrication: the builder touches no number — it passes the already-formatted
MoneyReview strings through verbatim and renders each due via the SHARED `reminderLine` (extracted
from `buildReminderEmail` as a byte-identical pure move), so the digest reconciles with /coach and the
reminder surface by construction.

Delivery reuses the dormant email path (#47): new `/api/cron/digest` (CRON_SECRET-guarded), dormant
without RESEND_API_KEY. Once-per-ISO-week dedup reuses #173's `NotificationSent` keyed on the week's
Monday, recorded ONLY after a real send (dormant week records nothing → activation later still
delivers; race-safe via @@unique + P2002-scoped catch). New digest copy (5 COACH_COPY strings) + the
shared reminderLine variants are in coach-copy.test.ts ALL_STRINGS so the shame/ticker/projection
guardrails scan them.

Fresh-context Opus hostile critic (refute-by-default, routine-cycle lane — no new money math/schema/
security): **PASS — 0 P0 / 0 P1** (financial 9 / correctness 9 / data-integrity 10 / copy-safety 7);
proved the reminderLine extraction byte-identical, the Monday math correct for every weekday, no
key-namespace collision, and the prune-induced-resend attack FAILED. **1 P2 FIXED** — an inherited
/coach bug the digest would have EMAILED: a first-week user (checking account, zero transactions) →
`monthsOfRunway=Infinity` → the runway copy rendered the literal "Infinity months". Both
`COACH_COPY.runway` and `reviewImprovementRunway` (unguarded on /coach too) now branch on
`Number.isFinite`, fixed at the copy SOURCE so /coach and the digest are both correct; locked by a
no-"Infinity" empty-flows test.

Gate (real output 2026-07-08): `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint
clean, **1969 unit / 147 files** (+31/+2 over #173: digest, cron-digest + coach-copy guardrail
additions + the reminders reminderLine refactor), build clean, **FULL e2e 84/84** (+1: digest cron
401 gate). EDGE_CASES §Weekly Digest added.

**Accepted / follow-ups (documented, non-gating):** concurrent-sweep double-send (same accepted #173
TOCTOU; Vercel cron doesn't overlap; one duplicate weekly email at worst); the getCoachData +
getCashNeeded double snapshot load per user (fine for a weekly cron; each surface is internally
consistent); `weekly_digest:` keys pruned only by the #173 notify cron's global 120-day prune
(negligible ~52 rows/user/yr, indexed, if notify isn't scheduled). Digest/email *activation* (set
`RESEND_API_KEY`, wire `/api/cron/digest` weekly in `vercel.json`) is a pure operator step (DEPLOY.md).
**This completes Gap 2** (radar #172 + notifications #173 + digest #174). Gap 3 (onboarding + mobile
polish) is next.

## Post-Phase-5: Gap 3 §1 — production-readiness backlog burn-down (#175)

Started Gap 3 (onboarding + mobile polish) with its first, smallest slice: the 2026-06-24 UX/
production-readiness audit's "DO NEXT" list (7 items — loading skeleton, empty states, heading
structure, per-page titles, delete confirmations, popover dismissal, an Investments nav entry). An
explorer survey against the current codebase found **5 of the 7 already done** by prior sessions
without ever being checked off the backlog: `(app)/loading.tsx` skeleton exists and covers every
route; every one of the 19 routes already sets `metadata.title` through the existing `%s · Aimplifi`
template, and `global-error.tsx` is already branded; `CardTitle` already renders a real `<h2>` (via
an `as` override for deeper nesting) and every spot-checked page already carries its own `<h1>`;
both the manual-account delete and the goal delete already use an inline two-step "Delete? Yes /
Cancel" confirm; the recategorize popover already dismisses on outside-click AND Escape. That left
3 genuine gaps, all additive UI-only fixes (no engine/schema touch, so no critic cycle — routine
lane):

1. **Heading structure, the real miss.** `EmptyDashboard` — the entire page for a brand-new,
   zero-account user, rendered as the early return on 13 different routes (dashboard, cards, ask,
   forecast, goals, coach, budgets, calendar, investments, recurring, reports, spending-plan,
   trends) — used `CardTitle`'s default `<h2>` as its ONLY heading. A first-run user's very first
   screen, on every one of those routes, had no `<h1>` at all. Fixed with one line
   (`<CardTitle as="h1">`) since the primitive already supported the override; fixes all 13 routes
   at once.
2. **Empty states.** `LifeEnergyCard` (coach) rendered a silently blank `<ul>` for a user with no
   large purchases in the last 90 days; the coach `opportunities-card` did the same for zero
   detected savings opportunities. Both now guard with the same empty-state pattern already used in
   `reports-view.tsx`. (The forecast `AreaChart` the survey flagged as "unguarded" turned out to be
   a non-issue on inspection — `f.days` is built by a `for (d=0; d<=horizonDays; d++)` loop, so it
   always has at least 1 entry; no true-empty case exists, so no guard was added — LOOP rule 2.)
3. **Investments nav entry.** `/investments` (#78) was fully built but reachable only via an inline
   "View investments →" link on /accounts or by clicking an INVESTMENT-type account row — not from
   either app nav. Added as an 8th `SECONDARY` nav entry (`LineChart` icon) between Accounts and
   Activity.

New/extended e2e locks (no new spec files needed — the natural fixtures already existed):
`auth.spec.ts`'s fresh-signup test gained an `<h1>` count/text assertion at the exact point
`empty-dashboard` first renders; its "sparse dashboard" test (one manual asset, zero
transactions — already the zero-opportunities/zero-life-energy fixture) gained assertions that both
new empty states render and the old list testids are absent; `investments.spec.ts` gained a
nav-click-through test.

**A pre-existing, unrelated e2e infra issue was found and root-caused, not fixed, while running the
gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → tsc/eslint/vitest (**1969/1969 unchanged**, no
engine touched)/build all clean, but Playwright reported **75 passed, 5 failed**, all 5 on the
`[mobile-380]` project. `git stash`-ing this entire diff and rerunning the same spec files against
clean `main` HEAD reproduced the identical 5 failures (confirmed again with `--workers` reduced
4→2→1) — proving this predates and is unrelated to this session's changes. A throwaway diagnostic
spec (written, run, then deleted) found the root cause: on this machine, the `mobile-380` Playwright
project (configured `viewport: {width:380,height:800}`) actually renders the page at
`window.innerWidth/innerHeight` ≈ **425×895** — an ~11.8% mismatch. The app's CSS is not at fault
(the fixed bottom-nav bar's `boundingBox()` correctly sits flush with the REAL 895px-tall viewport
bottom); this is a Chromium/Playwright viewport-emulation-vs-OS-display-scaling artifact on this
Windows machine, and it makes clicks on the fixed bottom-nav bar (and other edge-of-viewport
elements) land on unrelated page content instead. Documented as
`docs/lessons/mobile-380-viewport-scaling-flake.md` (with the git-stash A/B control recipe for the
next session that hits it) rather than silently patched — mutating shared Playwright device config
inside an unrelated backlog session would be a silent side-fix, not a scoped one. Every one of THIS
session's own new/modified e2e assertions passed (none of the 3 files touched are in the 5 failing
tests); the `[desktop]` project (no fixed bottom nav) passed in full on every run.

**Honest gate:** `npx tsc --noEmit` clean; `npx eslint . --max-warnings=0` clean; `npx vitest run` →
**1969/1969** (147 files); `npx next build` clean; `VERIFY_E2E=1 bash scripts/verify.sh` →
75 passed / 5 failed (pre-existing, root-caused, unrelated — see above) — `scripts/verify.sh` cannot
currently exit 0 on this machine for any diff until the viewport-scaling issue is separately
investigated. NEXT Gap 3 increments: §2 mobile secondary-nav redesign (7→8 icons now, still
"scope with owner" per the plan), §3 guided first-run connect flow.

## Post-Phase-5: Guided first-run connect flow (#176, Competitive-Gap Gap 3 §3)

Bank → confirm payment account → see your Cash-Needed number, with zero navigation for Step 1
(SimpleFIN/Plaid connect widgets now render INLINE on `EmptyDashboard`, not linked out to
/accounts) and the Step-2/Step-3 badges tied to the existing `showOnboarding` gate. Pure UI
composition — reuses `ConnectSimplefin`, `ConnectAccountsButton`, `needsOnboarding()`, and
`MoneyDialsForm` verbatim; no schema/server-action/engine change.

Numbering follows the app's ACTUAL top-to-bottom reveal (connect → an instant best-guess
Cash-Needed number → confirm the account to lock it in), not the plan doc's literal prose order —
a hostile critic caught that numbering the confirm nudge "Step 2" below a "Step 3" cash-needed
badge above it read backwards on the one page showing both; fixed by renumbering (2↔3) to match
the deliberately payoff-first dashboard layout rather than moving the card. A `boundingBox().y`
DOM-order assertion in `tests/e2e/guided-onboarding.spec.ts` locks this.

Second critic P1: `ConnectAccountsButton` is no longer /accounts-only — it now renders on all 13
zero-account routes via `EmptyDashboard` — but `/plaid-oauth`'s post-OAuth resume was hardcoded
to `router.replace('/accounts')`. A user starting a big OAuth bank (Chase/BofA) from the
dashboard's Step 1 would land on /accounts instead of back on the guided flow. Fixed with a new
origin-path stash/read/clear trio in `lib/plaid-oauth.ts` (same lifecycle as the existing
link-token storage), 2 new unit tests.

Also closes the #175 loose end: `ConnectAccountsButton`'s label now reads "+ Connect a bank or
brokerage (Plaid)", matching SimpleFIN's existing "(SimpleFIN)" suffix.

Gate (real, 2026-07-08): `VERIFY_E2E=1 bash scripts/verify.sh` → tsc/eslint clean, **1971/1971**
unit (147 files, +2), build clean, **77 passed / 4 failed / 5 did not run** on `[mobile-380]`.
Confirmed pre-existing and unrelated via a `git stash` + fresh `next build` A/B control run
TWICE (once quick, once with the port-3100 server killed and rebuilt from scratch): identical
4-failed/5-did-not-run pattern on clean `main` HEAD, matching 4 of the 5 documented symptoms in
`docs/lessons/mobile-380-viewport-scaling-flake.md`; only this session's own new test flips
fail→pass between the two runs. `scripts/verify.sh` still can't exit 0 on this machine for any
diff (unchanged from #175) until that viewport issue is separately investigated as its own task.

**Ledger gap, not this session's:** PROGRESS.md was not updated across #173 (notifications),
#174 (weekly digest), or #175 (production-readiness backlog) — those sessions' work is fully
recorded in DECISIONS.md/STATUS.md/git history, just not in the resume log. Flagged rather than
silently backfilled (reconstructing after the fact risks inventing detail nobody actually
recorded live); the next session doing routine ledger cleanup should backfill three short
one-paragraph PROGRESS.md entries from the existing DECISIONS #173–175 rows.

**NEXT Gap 3 increments:** §2 mobile secondary-nav redesign (still "scope with owner" per the
plan — a genuine product/design decision, not a mechanical slice); §3's remaining piece (this
increment covers the connect/confirm/reveal wiring; a literal "3-step wizard page" with its own
progress UI was considered and rejected in favor of reusing the existing surfaces — see
DECISIONS #176 rationale). Gap 1 §1–2 live Plaid/SimpleFIN walkthroughs + sync cron (owner-gated,
needs tokens) remain the only fully-blocked items in the whole plan.

## Post-Phase-5: AI-trust accuracy panel in Settings (#177, Competitive-Gap plan Gap 4 §2)

Gap 4 ("make the trust moat visible") §2: surface the already-instrumented categorization
accuracy on a Settings panel — the plan's "data exists, UI is thin". Pure COMPOSITION, no new
engine, no schema, no money math (routine/Opus lane): the accuracy math
(engine/accuracy/score.ts), the ownership-scoped read (getCategorizationAccuracy), and a triage
AccuracyCard have existed since DECISIONS #37 — the only gap was that Settings never showed it.
Extracted a presentational `AccuracyMetrics` from accuracy-card.tsx (the triage AccuracyCard now
wraps it, byte-identical output + same testids) so the new Settings "AI trust" card reuses the
SAME guardrail-safe copy from one source instead of duplicating it. The panel adds one plain
sentence stating the no-fabrication promise ("never invents a figure — every number is computed
from your own transactions"). Golden-safe: read-only, no writes; the seeded demo's labeled
predictions (n>0) render a real percentage, identical to the triage card.

Gate (real output 2026-07-08): `npx tsc --noEmit` clean; `npx eslint . --max-warnings=0` clean;
`npx vitest run` → **1971/1971 (147 files, unchanged** — the refactor is presentational, no
engine touched); `npx next build` clean. New e2e in settings-dials.spec.ts (read-only: panel
visible, shows "Categorization accuracy" + a %, states "never invents", card-scoped axe WCAG-AA
clean) → PASS on [mobile-380], alongside the existing mutating dials test. The refactored
component is directly exercised and proven correct by that passing Settings render.

Known env flake (NOT this change): phase2-triage "accuracy card shows a measured value" fails at
its `signInToTriage` helper (line 42, a `bottom-nav-triage` click) — the documented mobile-380
viewport-scaling flake (docs/lessons/mobile-380-viewport-scaling-flake.md). It dies at navigation
before /triage renders, a code path this change does not touch; the accuracy component itself
renders fine (proven by the passing Settings e2e). Only the [mobile-380] Playwright project is
currently configured, so a [desktop] isolation run wasn't available; `verify.sh` still can't exit
0 on this machine for any diff until that issue is separately investigated (unchanged #175/#176).

NEXT: Gap 4 §1 (Glass-Box "tap any number → the rows it's made of, reconciled to the penny") is
the flagship trust-moat build — a **Fable-lane** feature (data-integrity critic), and the natural
/clear + model-switch point. Gap 3 §2 (mobile secondary-nav redesign) and Gap 1 §1–2 (live-sync
token walkthroughs) remain owner-gated. PROGRESS.md backfill for #173–176 still outstanding
(flagged in #176).

## Post-Phase-5: Glass-Box reconciled numbers (#178, Competitive-Gap Gap 4 §1)

The flagship trust-moat build, run in the Fable lane per the plan §3: tap the dashboard
Cash-Needed headline → a panel of the exact rows it's made of, reconciled to the penny; and
/spending-plan's "How we got there" breakdown re-sourced from a tested trace engine with an
explicit reconciliation line. The AI plan §2.1 adversarial verdict had flagged the sharp failure
mode (a trace module drifting from the engine and stamping "can't reconcile" on a CORRECT number)
— answered architecturally: `engine/glass-box/trace.ts` never recomputes anything from raw
inputs, it only reshapes the engine result it is handed (`traceCashNeeded` flattens `perDueDate`,
the same `due` set engine.ts:199 summed into the headline; `traceSafeToSpend` carries the
income−spent−bills−savings identity as SIGNED rows so plain summation IS the headline). The one
computed value — the row sum — makes `reconciles` a real check; a doctored result reports the
mismatch with the true sum (fail-loud), locked by G7/S4. Safe-to-spend's proof lives on
/spending-plan, not the dashboard card, because that card is deliberately a whole-card Link
(no nested interactive elements). Upcoming (estimated next-cycle) cards stay excluded and are
disclosed in the panel's basis notes.

Gate (real output 2026-07-08): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — tsc/eslint clean,
**1987 unit / 148 files** (+16/+1: glass-box trace suite, G1–G7 + S1–S4 hand-verified in
EDGE_CASES §Glass-Box), build clean. Targeted e2e (full-suite exit 0 still blocked by the
documented mobile-380 viewport flake, unchanged #175–#177): **14/14** across glass-box.spec.ts
(NEW — parses the RENDERED row amounts off the DOM, sums them, compares to the rendered headline:
271233+210000+60000=541233; scoped axe WCAG-AA on the expanded panel; disclosure toggle
round-trip) + phase1-cash-needed + spending-plan + phase5-a11y + not-found (every pre-existing
lock on the touched surfaces, incl. the pinned `$5,412.33` headline text on the moved testid).

Fresh-context hostile critic (Fable lane, refute-by-default, ran the suites itself): **PASS —
0 P0/P1, 7 P2** (financial 9 / data-integrity 9 / copy 8 / UX-a11y 8 / tests 8). It independently
re-derived every pinned value, verified every `due` obligation lands in exactly one `perDueDate`
point, and FAILED to construct any honest engine input where rows ≠ headline (attacked past-due
clamp, weekend walk-back, FIXED_AMOUNT>remaining, $0 cards, MINIMUM+autopay max(), pending, −0).
P2s fixed before sign-off: tautological invariant test → S4 doctored-plan fail-loud test;
/spending-plan renders `trace.basis` (and the old spec's case-insensitive substring locators,
newly ambiguous, tightened to `exact: true`); rendered sign now derives from the value ($0 keeps
role sign) so displayed lines can never contradict the sum; aria-label on the disclosure button;
host-coupled mismatch copy dropped; `autopayCents` rendered as "(autopay)"; position-hardened row
ids. Accepted P2s: duplicate-cardId notes join (unreachable — DB primary keys) and no
component-render test for the mismatch branches (no component harness exists; the trace-level
doctored tests lock the contract).

**Ledger note:** DECISIONS had no #177 row (that session committed without writing it) — backfilled
minimally this session, pointing at STATUS #177 as the authoritative record. PROGRESS.md backfill
for #173–175 remains outstanding (flagged in #176).

NEXT: Gap 5 (investments provenance tag, benchmark-vs-index line) and Gap 6 §1 (CI verify.sh in
GitHub Actions) are the largest unblocked increments — both Opus/routine lane. Owner-gated
(unchanged): the push (#171–#178 ride together), Gap 1 §1–2 live-sync walkthroughs, Gap 3 §2
mobile secondary-nav redesign, the mobile-380 Playwright viewport fix.

## Post-Phase-5: Per-account data freshness on /accounts (#179, Competitive-Gap Gap 1 §3 follow-up)

The "per-account last-activity on /accounts" slice #171 deferred as "the next slice". #171 shipped
connection-health at the whole-connection level (one dashboard banner + one SimpleFIN connected-row
status); #179 brings it to EACH linked row, so a user with several linked banks can see WHICH feed
went quiet, not just that "something" is stale.

Reuses the tested engine verbatim (no new classification). New pure
`perAccountFreshness(accounts, today)` in `src/lib/engine/sync/health.ts` → id→`FreshnessResult|null`:
`null` for accounts with no sync concept (non-linked provider {manual,demo}, or type INVESTMENT —
holdings-valued, not a transaction feed); else
`classifyFreshness(mostRecentDate(newestTxnDate, connectionLastSyncedAt), today)`. The `mostRecentDate`
floor is #171's quiet-account guard applied per-row: a SimpleFIN account's per-user connection
`lastSyncedAt` floors its reference date, so a quiet-but-live feed reads fresh instead of a false
"reconnect" nudge. `getAccountsView` adds ONE `prisma.transaction.groupBy({by:['accountId'],_max:{date}})`
to the existing `Promise.all` (no extra round-trip), sets `connectionLastSyncedAt` only for simplefin
rows, and assigns each `AccountView.freshness` (new optional field). `LinkedRow` renders a
`data-testid="account-freshness"` sub-line via the existing `freshnessMessage` (amber on very_stale,
matching the shipped ConnectSimplefin stale hint on the same page).

GOLDEN-SAFE BY CONSTRUCTION: demo accounts are provider 'demo' → isLinkedFeed false → no line → the
demo /accounts page is byte-identical (locked by an `account-freshness` count-0 assertion in the demo
e2e). Proportionate adversarial self-review (display-only, single-path, reuses tested classification):
consistency with the banner + connection status verified on the month-old e2e fixture; no double-count
(`_max`, not a sum); non-USD withheld accounts excluded; deterministic (isoDate + integer day math).
One gap found + FIXED: the amber very_stale line was only reachable in the linked-stale state, which
phase5-a11y (demo-only) never covers → added a full-page axe WCAG-AA scan of /accounts in the stale
e2e.

KNOWN LIMITATION (documented, latent-only): a quiet **Plaid** account has no per-connection sync
timestamp available (PlaidItem carries only a cursor), so it grades by transaction recency alone and a
genuinely quiet Plaid feed could read stale. No live impact — Plaid is dormant/UNVERIFIED (item #12).

Gate (real output 2026-07-08): `bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint clean,
**1994 unit / 148 files** (+7: `perAccountFreshness` cases in tests/unit/sync-health.test.ts), build
clean. Targeted `connection-health.spec.ts` 2/2 (demo count-0 golden lock + stale positive per-row
reconnect line + /accounts axe AA). 30 other /accounts-touching e2e pass; the lone `auth.spec.ts`
sign-out failure was PROVEN pre-existing (mobile-380 viewport flake, docs/lessons/
mobile-380-viewport-scaling-flake.md) via a git-stash A/B control (identical 1-fail/2-pass on the clean
tree). Full VERIFY_E2E exit-0 remains blocked by that documented flake, unchanged since #175.

NEXT: Gap 5 (investments provenance tag, benchmark-vs-index line) and Gap 6 §1 (CI verify.sh in
GitHub Actions) are the largest unblocked increments — both Opus/routine lane. Owner-gated (unchanged):
the push (#171–#179 ride together), Gap 1 §1–2 live-sync walkthroughs, Gap 3 §2 mobile secondary-nav
redesign, the mobile-380 Playwright viewport fix.

## 2026-07-08 — #180 Holding provenance badge on /investments (Competitive-Gap Gap 5 §1) + benchmark line blocked

Resumed on "continue" in the Fable lane per the #179 handoff. Shipped Gap 5's first
item — a per-holding provenance badge on /investments — and recorded Gap 5's second
item (benchmark-vs-index line) as blocked rather than faking it.

- **Provenance badge (SHIPPED):** the `Holding.source` column already existed
  (`String @default("manual")`; `reconcileSimplefinHoldings` sets `'simplefin'`).
  Engine-first, display-only: optional `source?` passthrough on `Holding`/`PositionValuation`
  (alongside the existing display-only `name?`, zero weight in any math), a pure
  `holdingProvenance(source)` in `portfolio.ts` (manual/absent → no badge; any real feed
  → "Synced"), `getInvestments` selects + threads `source`, and `investments-view.tsx`
  renders a `<Badge data-testid="holding-provenance">Synced</Badge>` only for feed rows.
  GOLDEN-SAFE by construction: the demo's 5 holdings are all `manual` → no badge → demo
  /investments byte-identical (locked by a `holding-provenance` count-0 e2e assertion).
- **Benchmark-vs-index line (BLOCKED — owner-gated, not faked):** an honest portfolio-vs-index
  comparison needs (a) a per-holding valuation history / acquisition dates — the app stores
  only a current snapshot + cost basis, so the portfolio's own period return is uncomputable
  (the `timeWeightedReturn`/`xirr` engines have no dated series) — and (b) an index
  market-data source (none configured; the bash network allowlist has no market-data host).
  Shipping it now would mean inventing both the period and the index return, a no-fabrication
  violation. Needs a market-data feed + a schema addition (purchase dates or periodic holding
  snapshots) before it can be built honestly. See DECISIONS #180.

Proportionate adversarial self-review (display-only single-path passthrough, reuses tested
classification — #33/#57/#179 precedent, not a multi-agent workflow): golden-safety structural
+ e2e-locked; money values proven inert by the passthrough unit test; existing valuation tests
assert per-field so `source:undefined` on manual rows breaks nothing; axe WCAG-AA green on the
(badge-free) demo panel.

Gate (real output 2026-07-08): `bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint clean,
build clean; targeted `tests/unit/investments.test.ts` + `investments-server.test.ts` 47/47
(+6: `holdingProvenance` cases + a source-passthrough + a getInvestments source-flow test);
`VERIFY_E2E=1 investments.spec.ts` 7/7 (incl. the count-0 golden lock + the WCAG-AA axe scan).
Full `VERIFY_E2E=1` still can't exit 0 on this machine (documented mobile-380 viewport flake,
docs/lessons/mobile-380-viewport-scaling-flake.md) — the investments spec is run directly.
Committing as #180; NOT pushed (push owner-gated; #171–#180 ride together).

## 2026-07-08 — #181 CI: verify.sh in GitHub Actions (Competitive-Gap Gap 6 §1)

Resumed on "continue" per the #180 handoff, which named Gap 6 §1 (CI) as one of the two
largest UNBLOCKED increments. Added `.github/workflows/verify.yml` — config only, ZERO
app-code/schema/engine change (so no critic cycle; the YAML is outside the tsc/eslint/vitest
globs). Runs on every push + PR.

**What it does:** `ubuntu-latest`, Node 20 (matches `@types/node ^20`; no `engines` field in
the repo) → `npm ci` (postinstall runs `prisma generate`) → `npx prisma db push --accept-data-loss`
(materializes `file:./dev.db` so `next build` has a valid DB) → `npx playwright install --with-deps
chromium` (the sole `mobile-380` Playwright project is a Pixel 5 = chromium) → `VERIFY_E2E=1 bash
scripts/verify.sh` → upload `playwright-report/` + `test-results/` on failure. `concurrency` cancels
a superseded run per ref; 30-min timeout.

**Env:** the local `.env` is gitignored (`.env*`), so the workflow supplies the same dev-only,
non-secret values (`DATA_PROVIDER=demo`, `DATABASE_URL=file:./dev.db`, a throwaway CI `AUTH_SECRET`,
`DEMO_TODAY=2026-06-10`). Those feed `next build` ONLY — the unit + e2e suites relocate their own
SQLite DBs under `os.tmpdir()` via `tests/setup/test-db.ts` (cross-platform; `/tmp` on the runner),
and the seed's destructive-wipe guard is Postgres-only, so a `file:` CI DB seeds freely. GitHub
Actions sets `CI=true`, so `playwright.config`'s `reuseExistingServer` is false → it spawns a fresh
`next start` against the seeded e2e DB.

**WHY CI MATTERS HERE SPECIFICALLY:** a full `VERIFY_E2E=1` run cannot exit 0 on the maintainer's
Windows machine because of the documented mobile-380 Playwright viewport-scaling artifact
(`docs/lessons/mobile-380-viewport-scaling-flake.md`) — a Chromium-vs-OS-display-scaling mismatch
that is Windows-display-specific. A headless Linux runner has no OS display scaling, so **CI is
expected to produce the first GREEN full e2e run this machine structurally can't**, and becomes the
authoritative full-suite gate. A mobile-380 failure on CI would be a real regression, not the flake.

**VERIFIED locally** (proportionate to a config-only add): YAML parses (pyyaml `safe_load` OK); the
one novel step `npx prisma db push --accept-data-loss` runs and honors the `DATABASE_URL` env
override (real output: `Datasource "db": SQLite database "dev.db" … The database is already in sync`);
Prisma 7 dropped `--skip-generate` (my first draft used it; `unknown or unexpected option` → switched
to `--accept-data-loss`, the flag e2e global-setup already uses); all referenced paths exist
(`package-lock.json` for `npm ci`, `scripts/set-sqlite-wal.ts`, `prisma/seed.ts`); DB harness is
`os.tmpdir()`-based.

**UNVERIFIED (honest):** the workflow has never executed on GitHub Actions from here — the actual
run only happens on push, which is owner-gated (#171–#181 ride together). Like the Plaid/SimpleFIN
network paths, every command it wraps is locally proven but the orchestration itself is untested until
it runs on Actions. No app source changed this session, so tsc/eslint/vitest/build are unchanged from
#180's green (1994 unit / 148 files).

**NEXT (unblocked):** Gap 6 §2 (prod error tracking — Sentry/Vercel monitoring) and Gap 6 §3–4
(deferred auth/compliance items, Neon backups) are the remaining Gap 6 slices; the outstanding
PROGRESS.md backfill for #173–176 (flagged in #176) is still open. Owner-gated (unchanged): the push,
Gap 1 §1–2 live-sync token walkthroughs, Gap 3 §2 mobile secondary-nav redesign, the mobile-380
viewport fix. **Once the owner pushes, the FIRST thing to confirm is the Actions run: if it's green,
flip #181 from UNVERIFIED to verified and note the first-ever clean full-suite e2e; if mobile-380
fails, that's real.**

## Post-Phase-5 refinement: multi-device session invalidation + PII-free deletion record (DECISIONS #182, Competitive-Gap Gap 6 §3)

Closed the two items PRIVACY.md §Deletion had listed as deferred "real-auth release"
limitations. Resumed on "continue" (Fable lane); a full-codebase reconciliation first
found COMPETITIVE_GAP_PLAN stale (Cash Flow Radar, web push, and the weekly digest were
already BUILT — the plan's §2 now carries a dated reconciliation banner so no future
session rebuilds them), leaving Gap 6 §3 as the highest-value UNBLOCKED, rule-3 slice.

- **Mechanism:** `User.sessionEpoch` (Int @default(0), golden-safe) stamped into the JWT
  at sign-in and re-checked on every Node-side session resolution. Pure core
  `isSessionCurrent` + `hashUserRef` in `engine/auth/session.ts` (unit-pinned, fail-closed);
  Node enforcement in `server/session-guard.ts` called from a Node `session`-callback
  override (auth.ts) that strips `user` on a stale/absent epoch → `requireUserId` throws on
  every device. Edge middleware stays Prisma-free (coarse gate; all data access re-resolves
  through the enforced Node callback, so a stale token that passes middleware leaks nothing).
- **Triggers:** `revokeOtherSessions()` (Settings → "Sign out of all devices", bumps the
  epoch, signs out this device too — honest "everywhere"); account deletion (user gone →
  existence check fails everywhere, no extra code).
- **Deletion record:** `DeletionRecord` (no User relation → survives the cascade), only
  `hashUserRef(id)` + timestamp, written ATOMICALLY with `user.delete` (array-form
  `$transaction`) so it exists IFF the deletion committed. Keyed by a SECRET salt
  (AUTH_SECRET) so low-entropy ids (a Google id embeds an email) aren't enumerable.

**Hostile Critic (fresh-context Fable, refute-by-default): cycle 1 FAIL — 1 P0, 2 P1, all
FIXED + re-verified.**
- **P0-1 (serious):** demo + Google tokens were minted at a hardcoded epoch 0, so one
  "sign out of all devices" would BRICK those accounts (fresh sign-in re-minted 0 ≠ bumped
  DB epoch → infinite redirect; violates CLAUDE.md rule 4). FIXED: removed the
  edge/authorize stamp; a Node `jwt` override now stamps `token.epoch` from the DB
  (`currentSessionEpoch`) at sign-in for EVERY provider, so re-sign-in reads the current
  epoch. Regression-locked (round-trip test: revoke → old token dead → fresh stamp == bumped
  epoch → valid).
- **P1-1:** deletion record + delete were non-atomic → wrapped in `$transaction`.
- **P1-2 (coverage):** the stamp↔check seam was untested → added the round-trip regression
  (mechanically catches P0-1).
- **P2s FIXED:** hash keyed by AUTH_SECRET (was public-salt-enumerable); overclaimed
  "non-enumerable" comments softened to honest "pseudonymous unless secret salt". **Accepted
  P2s (documented):** one indexed-PK findUnique per Node `auth()` (negligible beside the
  per-render snapshot load; React `cache()` dedupe is a possible future trim); `db push`
  convention means a Postgres deploy must push before the new code runs, else the password
  authorize / session guard 500 on a column-short DB.

Gate (real output 2026-07-08): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — tsc/eslint
clean, **2010 unit / 150 files** (+2 files: `session-lifecycle` 8 pure + `session-invalidation`
real-DB revoke/delete/round-trip), build clean. Touched e2e `account-deletion.spec.ts` 2/2 (a
render-only Sessions-control assertion — never clicks revoke, which would bump the shared demo
epoch and sign every parallel spec out; the real bump + rejection is proven by the integration
test). Full `VERIFY_E2E=1` still cannot exit 0 on this Windows machine (documented mobile-380
viewport flake, docs/lessons/mobile-380-viewport-scaling-flake.md — unrelated). Committing as
#182; NOT pushed (push owner-gated, #171–#182 ride together).

---

## 2026-07-21 — Owner-requested agent review: UX/flow, redundancy, docs (ASSESSMENT ONLY — no fixes applied)

Five read-only explorer agents swept the codebase and docs at the owner's request ("study the
logic, the flow and user experience — can anything be done better?"). Findings below are
**candidates awaiting owner prioritization**, recorded with the agents' file:line evidence;
each fix slice re-verifies its claim before changing code. Same session shipped #258
(password show/hide viewer; see git log) — that is the only code change.

**Resolution (2026-07-21, #259 — see §Agent-Review Follow-up Slice 1 near the top):**
C1–C5 and A1–A3 shipped; A4 declined (the numbering is a recorded critic decision);
A5–A6, all of B, and D remain open — D gated on explicit owner approval.

**Resolution 2 (2026-07-21, #260 — see §Agent-Review Follow-up Slice 2 near the
top):** A5, A6 and B1–B6 all closed — B1/B2/B3/B4/B6 and B5-in-part extracted, A5
and A6 applied; A6's "time promise drift", A6's "Safe to Spend" rename and B5's
"provider-configured checks" declined with the evidence that they don't reproduce
(or are the owner's product call). D is the only item still open.

### A. Product flow / UX (highest user impact first)
1. **/cards empty state dead-ends** — tells the user to go to /accounts but offers no inline
   connect/add affordance (`src/app/(app)/cards/page.tsx:38-39`). Add the connect button inline.
2. **Settings "Bank connections" card is decorative** — explains linking happens elsewhere,
   links nothing (`src/app/(app)/settings/page.tsx:158-169`). Link or embed the real buttons.
3. **/triage has no first-run empty state** — renders a bare empty inbox for zero-account
   users while every sibling route has a branded empty (`src/app/(app)/triage/page.tsx:14-44`).
4. **Dashboard onboarding step numbers read out of visual order** (a previously critic-flagged
   compromise, `src/app/(app)/dashboard/page.tsx:131-146`) — drop numerals or reorder.
5. **PlaidConnections row wraps badly at 380px**, confirm state hardest hit
   (`src/components/finance/plaid-connections.tsx:58-111`) — card-per-item layout.
6. Onboarding footnote promises drift across surfaces ("30 seconds" vs "a few weeks");
   /trust is discoverable only via Settings; "Safe to Spend" vs "Cash Needed" naming could
   confuse revisiting users.

### B. Code redundancy (worth a cleanup slice, no behavior change)
1. **Two-tap confirm pattern hand-rolled on 5+ surfaces** (accounts-list ×2,
   plaid-connections, custom-category-manager, household-card) — extract one `<ConfirmAction>`.
2. **LLM provider-key precedence (xAI→Anthropic) duplicated across ~6 server modules**
   (assistant-llm, balance-move-llm, llm-categorize, llm-statement-extract, money-review-llm,
   assistant) — one `provider-select` helper.
3. **Token-salt idiom duplicated** (password-reset.ts:41-43 vs household-actions.ts:59-61) —
   the #257 "household-invite idiom" was copy-pasted, not shared; extract.
4. **Engine micro-utils duplicated:** `ym()` month-key in 4 engines, `medianOfSorted()` in 3,
   prev/next-month wrappers in 3 — belong in dates.ts / a stats util per CLAUDE.md rule 3.
5. Input-class Tailwind constants redefined per file under 3 names; error/success `<p>` styling
   copy-pasted instead of the existing shadcn Alert; revalidatePath path-lists drift per action
   file; provider-configured checks scattered (plaidConfigured vs inline env reads).
6. `household-actions.ts:68-70` re-implements `isDemoUser()` locally despite the shared one.

### C. Docs staleness / hygiene
1. **README.md:80 claims Plaid transaction-sync/liabilities are "not implemented"** — ROADMAP
   §1 records them VERIFIED 2026-06-17. Actively misleading; fix first.
2. **.env.example still says "Pulse Finance"** (lines 1, 2, 72) — rename leftovers.
3. **DEPLOY.md omits AUTH_URL** even though #257 made it required for self-hosted password
   reset (fail-closed: no email sent without it). Add to the env table as the canonical list.
4. README hardcodes seed-pinned measurements (3.60% review rate, interaction counts) that the
   one-status-home rule routes to STATUS/EDGE_CASES; ROADMAP duplicates one of them.
5. **CLAUDE.md references docs/TASKS.md as the build queue but the file does not exist** —
   either recreate it or drop the reference (found this session, not by the agents).

### D. Plaid-attach-to-existing-accounts (merge) — assessment for the owner's question
**Not possible today; buildable.** Evidence: SimpleFIN disconnect deletes only the connection
row — the accounts and full history remain (`src/server/simplefin-actions.ts:84-94`); Plaid
sync matches accounts strictly by `{provider:'plaid', providerRef}`
(`src/lib/providers/plaid.ts:260-262`), so linking Plaid now creates parallel NEW rows and
never touches the ex-SimpleFIN ones. Transactions dedupe per-provider via
`@@unique([accountId, providerRef])` — no cross-provider key exists, so Plaid's backfill would
double-count any overlap with SimpleFIN-era history if naively merged.
**Recommended design (next slice, if approved):** post-link "merge into existing account"
action that, in ONE transaction, re-stamps the old Account row to the Plaid identity
(provider/providerRef/plaidItemId), transplants any post-cutover transactions from the
freshly-created Plaid twin, deletes the twin, and drops backfill rows dated ≤ the old
account's last synced transaction date (deterministic date-fence cutover — NO fuzzy
date+amount+merchant matching, per the precision-fix lesson). Residual: SimpleFIN-era gaps
stay gaps; balances become Plaid-managed after merge. UNVERIFIED until built: whether the
merge can run before Plaid's first sync (skipping twin creation entirely) — check the link
callback ordering in the build slice.

## 2026-07-25 — L.14 an unshared account stops claiming to be fresh (critic cycle 1: 2 P0 + 6 P1, 4 P1s OPEN)

**Shipped (commit a16f9e4).** Plaid Link update mode ships with `account_selection_enabled`, so a
user can untick an account. Nothing pruned the row, so it kept its last balance, kept counting
toward net worth / cash-needed / /cards, and kept reading as freshly synced because its BANK was
still syncing (#293) — and it could not be deleted, since the refusal's premise ("the next sync
would bring it back") is false for a row the feed no longer sends.

Additive `Account.feedDroppedAt`, stamped by a pure `reconcileFeedPresence` from a complete
`/accounts/get` census only. Never from the `/transactions/sync` echo (it carries only accounts
with transaction activity, so absence there would have frozen every quiet loan, card and brokerage
on the first sync after deploy), never on an empty or unreadable list, never re-stamped, cleared
when the account returns. New `not_shared` freshness level graded from the drop; Delete permitted;
disclosure on /accounts and the dashboard.

**Two fresh-context critics ran in parallel and both broke it.** Cycle 1 verdict: FAIL. Both P0s
and 4 of the 6 P1s are fixed and locked by executed tests (see PROGRESS.md and DECISIONS #302).
The deepest finding, reached independently by both: the "keep counting, just say so" stance had
been argued over LIABILITIES only, and the user's own PAYMENT account can be frozen, where the
direction inverts — a balance frozen high reports shortfall $0 while the real account cannot cover
the autopay.

### OPEN — 4 P1s, tracked as TASKS L.18. This slice does NOT claim a critic pass.

A feed-dropped account keeps counting by design. That is now disclosed on /accounts, in the
dashboard banner, and in the cash-needed engine's `assumptions`. These surfaces still print
figures derived from a frozen balance with nothing said, ranked by money consequence:

1. **/cards** — `finance.ts` builds the dashboard accounts payload as an explicit 5-field list
   that drops `feedDroppedAt`, and /cards renders no assumptions block, so a frozen card can print
   "pay $X by DATE" from a stale statement-substitute.
2. **The weekly digest email, the reminder email and web push** — each composes its own body from
   figures derived from frozen balances, and per the L.15 lesson a channel that composes its own
   body inherits nothing from an `assumptions` array.
3. **The Ask assistant** — quotes the balance bare, and `traceNetWorthDerivation` green-checks it
   in the panel a reader opens specifically to audit the number.
4. **/coach** — a frozen balance drives the FI number, years-to-FI and runway months behind only
   the currency banner.

Deliberately not bulk-patched: pasting one sentence onto four surfaces is the L.15 failure
verbatim. Each needs copy true for what that surface can point at, plus a lock that drives the
real engine rather than a pure builder.

### Also recorded

Residuals that fail toward the pre-existing behaviour, never toward a false drop: a row whose
`plaidItemId` predates #256 is out of scope (it cannot be proven to belong to the connection), and
SimpleFIN is unwired. **UNVERIFIED against live Plaid** — no credentials in this environment;
every request shape runs against a mocked Plaid server with real Prisma.

## 2026-07-25 — L.7 rename an account (critic cycle 1: 1 P0 + 5 P1, all fixed and locked)

**Owner-requested 2026-07-24:** *"there should be a way to edit name of accounts myself. Similar
to simplifi.com."* His screen carries three cards the feed calls `CREDIT CARD` and two called
`Venture`. Three prior slices (#296/#297/#298) taught surfaces to tell same-named rows apart; none
could improve the data. He can.

Additive nullable `Account.displayName`, written by one new server action and by no ingest path,
so a rename survives every sync. One pure rule decides which string a surface prints
(`accountLabel`), and the DEFAULT points at the feed: a display site nobody updated reads stale
rather than wrong, and a comparison nobody updated still compares what the bank sent. Resolution
happens once per boundary — `assemble.ts` for the ~20 surfaces downstream of cash-needed (the
`feedDroppedAt` precedent), then each server mapper. The control is on both row kinds of
/accounts; a renamed linked row also prints its synced name.

**Two fresh-context critics ran in parallel and both broke it. Cycle 1 verdict: FAIL — 1 P0 and 5
P1s, every one fixed and locked by an executed test (6 REGRESSION_LEDGER rows, DECISIONS #308).**
The P0: `buildCombineInputs` handed the combine planner the LABEL, the planner sorts by name and
its direction is order-dependent, so a cosmetic rename inverted which Plaid connection the card
recommended disconnecting — and confirming that revokes a Plaid item. The sharpest P1, found
independently by both critics: a partner's private nickname printed to the other household member
on the dashboard, /cards, /calendar and in the weekly digest email, because the label was resolved
in engines that sit downstream of the household merge. Fixed at the one boundary that owns it (an
explicit `select` that omits the column), not with per-surface fences.

### Withdrawn deliberately, each with the prerequisite it is waiting on

1. **`accountEvidenceLabel`** — appending *(your bank calls this "X")* to identity-card labels.
   Stacked two parentheticals inside prompts and aria labels, asserted a bank for MANUAL rows,
   and attributed to the bank a SimpleFIN string this app composes itself. Returns if a surface
   needs provenance in a form that is true for every provider.
2. **`accountSearchNames`** — letting Ask match the nickname as well as the feed name. The branch
   it feeds sums every match with no `isLiabilityType` handling, so a second short user-chosen
   string could turn one right answer into a total that ADDS money owed to money held (the critic
   executed it: "$6,348.11 across 2 accounts"). **Prerequisite: fix that mixed-kind total** — a
   pre-existing defect, now written down.

### STILL OPEN after L.7

1. **The combine-connections card prints the feed's name**, because the planner must be fed it.
   The honest fix post-maps the planner's OUTPUT by account id; recorded, not done.
2. **The `· synced as X` note has no e2e**: it renders only on a LINKED row, and the rename spec
   drives a throwaway user who has none. The owner's own motivating case is unit-covered only.
3. **A nickname may still impersonate `Unnamed account`** (P3, self-inflicted only).
4. **No inline error in the rename form** — a refusal renders in the page-level banner, which on a
   380px screen is above the fold (P3; the box now enforces the length cap client-side).

