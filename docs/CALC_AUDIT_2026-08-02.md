# Calculation audit — 2026-08-02 (six-critic adversarial review)

Owner-triggered review of **every displayed calculation in the app**, plus the transaction/rules UX
flow. Six fresh-context hostile critics ran in parallel, read-only, each with a different lens. This
file is the consolidated, deduplicated result.

**Method.** Six read-only critics: (A) /trends + its dashboard card, (B) spending plan / Fixed vs
discretionary / budgets, (C) money *instructions* — cash-needed, forecast, radar, cards, calendar,
(D) long-horizon projections — coach / FI / wealth target / investments / goals, (E) cross-surface
parity (one question, many surfaces), (F) transaction + rules UX. No critic ran the verify gate, a
build, or Playwright, per `a-subagents-green-is-a-hypothesis` (parallelise for FINDING, serialize
for PROVING).

**Verification status.** Every finding marked **VERIFIED** below was reproduced in the main thread
by reading the cited source after the critic reported it. Findings marked **TRACED** are
hand-verified predicate chains that were not executed. Findings marked **HYPOTHESIS** are reasoned
from code and depend on an unconfirmed fact about the owner's live data.

**Not yet done:** no fix is applied, no test written, no gate run. This document is the assessment
only.

---

## The owner's two reported numbers, resolved

The owner reported: *"on pace for 19,713.85 less than last month … we've spent 578.79 on the first
day of the month … 8971.25 makes no sense since our mortgage is ~6200."*

Both numbers are now pinned exactly (`node -e`, verified):

```
57879 cents / 2 days * 31 days = 897125 cents = $8,971.25   (the projection)
897125 + 1971385 = 2868510 cents = $28,685.10               (July actual)
```

So the app took two days of spending, multiplied by 15.5, and published the result as the month's
forecast — on a dashboard card that states no assumption and paints the sentence **green**. The
owner's instinct is right and the mechanism is worse than he could see from the screen: see A-1 and
A-2.

---

## P0 — false money claims, or instructions that can cost real money

### P0-1 · Mid-cycle card payments are never recorded, so a paid bill is demanded again — and double-counted
**VERIFIED.** `CardPayment` has **no production writer anywhere**. Grep for
`cardPayment.(create|createMany|upsert)` across `src/` and `prisma/` returns exactly two hits, both
in `prisma/seed.ts` (`:54` deleteMany, `:76` createMany). No Plaid ingest, no SimpleFIN ingest, no
server action writes one. The schema advertises `source: 'manual' | 'autopay' |
'detected-from-transactions'` (`prisma/schema.prisma:371`) and two of the three have no producer.

Consequence: `paymentsAppliedCents` is `0` forever on real linked cards, so
`remainingDue = statementBalance` (`cash-needed/engine.ts:101`) until the issuer's *next* statement
issues, typically 2–3 weeks later. The two halves of a payment are then accounted asymmetrically —
the checking-side debit *is* seen (the bank reports the lower balance), the card-side credit is not
— so the day-by-day walk subtracts the same money twice, manufacturing a shortfall and a transfer
instruction from a bill the reader already settled.

`engine.ts:15`, `docs/EDGE_CASES.md §B` and `docs/ROADMAP.md` all state that mid-cycle payments
reduce remaining due. That is true of the arithmetic and false of the intake — the
`a-dead-branch-is-a-claim-that-something-is-handled` class at its largest scale.
`docs/STATUS.md:7501` records a narrower version ("in transit … recorded nowhere … conservatively
double-demanded"); three of its four load-bearing words are wrong for the shipped state.

**Fix direction:** write the missing intake — match POSTED card-account inflows dated after
`Statement.cycleEnd` and persist `CardPayment{source:'detected-from-transactions'}`. Until then, no
surface may claim payments are subtracted.

### P0-2 · The dashboard hero can tell the reader to transfer money out of a frozen (or the wrong) account
**VERIFIED.** `src/app/(app)/dashboard/page.tsx:112-117`:

```
data.accounts
  .filter((a) => a.type === 'SAVINGS')
  .sort((a, b) => b.currentBalanceCents - a.currentBalanceCents)
```

Three guards are missing that the radar — ten lines of code away, on the *same page* — applies
(`radar.ts:370-378`): `a.feedDroppedAt == null`, `a.id !== paymentAccountId`, and
`a.currentBalanceCents > 0`. Because a frozen balance stops moving and money mostly *leaves* an
account, a frozen row is systematically high, and sorting by balance descending means it is not
merely eligible but **preferentially chosen**. The hero then prints its dead balance as
"$18,500.00 available" beside an imperative to move money out of it.

This is `failure-direction-is-per-role-not-per-value` on the exact surface the lesson was written
about; the radar was hardened and the hero was never swept. Secondary: with no
`id !== paymentAccountId` guard and `PAYMENT_ACCOUNT_TYPES` including `SAVINGS`, a reader whose
funding account *is* savings can be told to transfer money into itself.

**Fix direction:** delete the local derivation; hand the hero `radar.coverTransfer.sources[0]`.

### P0-3 · /calendar shows each card and loan due exactly once, ever, and prints "0 payments due" for every other month
**VERIFIED.** `calendar/build.ts:115-118` places one event per obligation, gated on the displayed
month's window, and there is exactly one `CardObligation` per card and one `LoanObligation` per loan
("the next payment on/after today", `loans/obligations.ts:82`). Scheduled rows *are* expanded by
cadence (`build.ts:114` via `expandScheduled`), so the grid fills with paychecks and utilities —
which is what makes the zero convincing. The month is a free query param with prev/next links.

For the owner (4+ cards, ~$6,200 mortgage) September understates committed outflow by roughly
$25,000 while printing "0 payments due across 0 dates" under a footnote promising "each due day is
badged here". The radar already synthesizes future cycles (`radar.ts:234-252`); the calendar was
never given it.

### P0-4 · A $6,200 mortgage can be counted twice in the Fixed figure
**VERIFIED (mechanism); HYPOTHESIS (that it is live on the owner's data).** The two halves of the
Fixed union identify a category by two different fields:

- the rollup dedupe key is the **filed** `Transaction.categoryId` (`server/spending-plan.ts:280-288`)
- the series' category is the **merchant normalizer's static guess** at the raw bank string
  (`recurring/detect.ts:377-383`); `countedExpenseSeriesForPlan` never passes `t.categoryId`

`normalize.ts` has **no mortgage pattern at all** — verified: `MORTGAGE` appears once, at `:620`,
inside `SEGMENT_WORDS`, and no `CATEGORY_VOCAB` phrase uses it. So an ordinary mortgage servicer
descriptor normalizes to `uncategorized`, `resolveCategoryIsFixed('uncategorized')` returns `null`
(verified at `spend-class.ts:36-46` — the `Transfers & Other` group returns null), and in
`recurringOutsideFixedCategoryCents` (`plan.ts:483-493`) **only `fixed === false` skips**:

```
if (fixed === false) continue;
if (fixed === true && rollupCategoryIds.has(id)) continue;
sum += rate;              // null falls through
```

The docblock says so out loud: *"Out-of-dial / null ids are added."* So the rollup counts the
mortgage as filed `rent` and the union adds it again as `uncategorized`: **$12,400.00 for a $6,200
mortgage**, under a sentence that explicitly denies it ("plus detected recurring bills that are *not
already in that rollup*").

The existing lock cannot catch this: `tests/unit/fixed-category-amounts.test.ts:265-285` hands the
series the *filed* id, which production never produces for an unrecognised descriptor. The demo seed
is immune because its landlord descriptor *is* in the merchant table (`normalize.ts:241`) — which is
why this survived every session of looking at the demo.

**Note the direction conflict with the owner's report.** He saw a projection that was too *low*.
P0-4 makes Fixed too *high*. Both are real code paths; which one is live on his account is a
measurement, not an argument — see "Next measurement" below.

### P0-5 · "Typical spend" divides by a constant 3 regardless of how many times the bill charged
**VERIFIED.** `fixed-category-amounts.ts:46-69`: the numerator is whatever charges fall in the
three-month window; `denom = monthSet.size` is **always 3**. There is no occurrence count and no
check that the category had activity in each month.

- A mortgage that started in July shows as **$2,066.67/month** — guilt-free is $4,133.33/month too
  generous, with a confident label and no hedge.
- 2026-08-01 is a **Saturday**, so an ACH due the 1st that settles the prior business day posts
  2026-07-31, putting *four* payments in the window: **$8,266.67** for a $6,200 mortgage.

Failure direction on the under-count side is the dangerous one: Fixed too small ⇒ guilt-free too
big ⇒ the reader is *instructed* to spend money the mortgage will take.

### P0-6 · `annualExpenses = expenses6 × 2` halves the FI number, the retirement projection, and the emergency fund
**VERIFIED.** `src/server/coach.ts:247` is `const annualExpenses = cents(expenses6 * 2);` while
`:249`, `:250` and `:333` all divide the same `expenses6` by `Math.max(1, last6.length)` — the file
already knows the right divisor and uses it three times. `:468` even exports
`monthlySavingsMonths: last6.length`, added (per its own docblock at `:68-79`) precisely because the
window is *not* always six; it was threaded only to the wealth-target card.

`annualExpenses` is the root of nearly every long-horizon figure: `fiNumberCents` (`:291`),
`monthsToFI`/`coastFI` (`:292-293`), `/investments`' `annualRetirementSpendingCents`
(`server/investments.ts:174`), and `/goals`' emergency-fund sizing (`goals/page.tsx:49,55`). For a
reader with three complete months on file — the normal state after a new Plaid link, and after a
re-link — every one of those is **exactly half**. Critic D executed it: FI in "15 years 11 months"
against a true 26 years 3 months; `/investments` "Projected to last through age 95" with $2.2M left
over where the true depletion age is 88.

### P0-7 · The zero-spend day: "$0.00 projected by month end", and "$28,685.10 less than last month" in green
**VERIFIED.** `trends.ts:300` abstains only when **both** months are zero:

```
if (spentSoFarCents === 0 && priorMonthCents === 0) return null;
```

The state that needs the abstention is the opposite one — `spentSoFar === 0` with a large prior
month, which is every reader on the 1st, and every reader whose feed has not yet delivered the
month's first rows. The engine then divides 0 by 1, projects `$0.00`, and the dashboard computes
`0 − priorMonth`, a large negative, which `paceUp` reads as good and paints **emerald**.

"We have no data yet this month" and "you are on track to spend nothing this month" produce
byte-identical output, and the copy names the second one. The `/trends` disclosure ("assumes
spending continues at the current daily rate") is *technically true at a rate of zero*, which
certifies the absurdity rather than hedging it.

### P0-8 · The wealth-target card calls an aspirational savings target "what was left after spending"
**TRACED.** `coach-copy.ts:310-324` hard-codes *"what was left after spending, averaged over the N
months of yours Aimplifi has"* — accurate when written, when the contribution was always the
historical surplus. #375 changed the input so the settings savings-% wins whenever
`savingsTargetBps > 0 && plannedSavings > 0` (`discretionary-cuts.ts:100-122`) and never changed the
sentence. The card therefore prints a factual claim about the reader's history that the *next
paragraph falsifies* ("Recent surplus averaged -$450.00/month").

Why this is P0 and not a copy bug: `contributionFloored` tests `rawMonthly <= 0` on the value passed
in (`wealth-target.ts:290`), so a positive *planned* figure means it never fires, the refusal at
`wealth-target-card.tsx:217` is bypassed, and a confident 20-year arrival date is handed to someone
spending more than they earn — six inches below the FI card saying *"Contributions aren't outpacing
spending yet, so a projection date wouldn't be honest."*

---

## P1 — materially misleading figures and unstated assumptions

**Trends / pace**

1. **The projection ignores the bill calendar the app already owns.** `computePace` reads nothing
   but transactions, yet `snap.scheduled` is on the very snapshot `getSpendingTrends` already loads
   (`providers/types.ts:38`; `server/trends.ts:142-145`) — VERIFIED. A household month is a few
   large scheduled outflows plus noise, so a linear rate is biased in a *known* direction: low
   before the bills land, then wildly high on the day they do. Critic A executed the shape for a
   $28,685.10 month with a $6,200 mortgage on the 5th: it reads "$6,200.18 **less** than last month,
   green" for four days, then "$32,239.82 **more**, red" overnight. On the demo's own seed, adding
   back the one bill the model cannot see flips "$826.26 less (green)" to "$973.74 more (red)".
2. **The dashboard card states no assumption and hides the divisor.** `/trends` says "spent in the
   first 2 days" and "a projection, not a prediction"; `spending-insights-card.tsx:30-47` prints
   neither, though `pace.daysElapsed` is on the object. This is the surface the owner landed on.
3. **Green is an evaluative claim on the least reliable figure on the page**, and `> 0` puts the
   exact tie in the green branch ("on pace for $0.00 less than last month").
4. **"Biggest purchases this month" excludes four row classes and the sentence names one.** An
   unfiled row — precisely the triage queue — counts toward the Pace headline and is silently absent
   from the list, while the copy explains the absence with a reason (pending) that does not apply.
5. **The dashboard's "Biggest change" is a July fact under an August headline**, with no window
   label; `/trends` labels the same figure "Jul vs Apr–Jun average".
6. **`baselineLabel` prints a contiguous range for a set that can have holes**, and contradicts the
   balance-move sentence ~40px away, which correctly says "your 2-month average".

**Spending plan / Fixed**

7. **The union treats "this category cannot be designated" as "this is a must-pay cost."** VERIFIED
   at `plan.ts:483-493` (see P0-4). A $450/mo boat-slip draft the merchant table doesn't know enters
   the must-pay bucket at full rate. The rollup already chose the conservative answer for the same
   class (`fixed-category-amounts.ts:59`), and the module header states that rule — which the other
   half then breaks.
8. **The primary Fixed basis states neither its method nor its window**, while its *sibling* median
   branch states both (`row-labels.ts:163`). "Plan uses $2,066.67 (typical)" beside a row named
   "Rent & Mortgage" is unauditable — the exact reconciliation failure that prompted this review.
9. **A one-time non-discretionary purchase becomes a "must-pay Fixed cost" for three months.** A
   $12,000 roof is smoothed to $4,000/mo of standing obligation that does not exist.
10. **A budget *target* on a Fixed category replaces both the actual spend and the detected bill.**
    An intention substituted for a cost model, erring toward overspend.
11. **Income is summed over one account, Fixed over all of them** — `server/spending-plan.ts:100-107`
    vs `:266-273` — and the resulting ratio is printed as a verdict against a 50–60% target band.
    This is `a-shared-filter-is-not-symmetric-across-sign` inverted.
12. **"What this figure can't see" lists only cadence limits and reads as exhaustive**, and there is
    no disclosure at all for Fixed being *over*stated.
13. **A transfer-flagged bill is invisible to both halves of the union and to the census that would
    report it** — three gates read the same flag, and because no series is stored,
    `fixedSeries.uncounted` stays 0 and the note returns null.
14. **The Glass-Box certification cannot fail.** `trace.ts:365-386` computes `income − fixed −
    savings` and checks it against `plan.leftToSpendCents`, which is the same expression — so
    `reconciles` is true for every input, including every defect in this document. The Fixed bucket
    panel checks a one-row sum against a headline copied from the same field (`x === x`). It then
    adds "Every amount is computed from your own data; nothing is invented", which is false when the
    reader typed the figure and when a category is priced from a budget target.
15. **On /budgets the Fixed *list* omits most of what the Fixed *figure* is made of** — a category
    with a real typical amount but no spend *yet this month* contributes to the total and appears
    nowhere in the list, and the recurring-union component has no per-row representation anywhere.

**Instructions**

16. **"Shortfall of $10,001.00 on Aug 10" pairs the whole window's worst dip with the *first* short
    date.** Critic C executed a faithful port of `engine.ts:295-372`: the true Aug 10 shortfall is
    **$1.00**. Four surfaces render it, and the Today-feed `critical` nudge is the worst because
    nothing beside it contradicts the figure. The radar fixed exactly this
    (`radar.ts:388-403`) and the cash-needed engine never received the fix.
17. **/cards prints "You must pay $X by DATE" for next-cycle *estimates* that are in no total**, and
    can promote one to "Do this first" by sort order with no estimate gate. The hero solved this and
    its solution (`paintedHeroCards`) is one import away.
18. **/forecast's headline omits every card payment** and says so only *after* the reader has passed
    every figure it qualifies — contradicting the placement rule its two sibling surfaces enforce
    ("the reader must meet the caveat before the imperative", `cash-needed-card.tsx:254`).
19. **"No day-to-day spending in the last 56 days, so the committed line above is the whole picture"
    is decided by a p80, not a sum.** Executed: with 5+ weekly buckets, one $2,000 spending week
    among silent ones yields p80 = 0, and the card promises nothing is missing from the projection
    the transfer instruction rests on.
20. **The radar's "Clear" verdict and cover transfer never mention the cards the engine could not
    date** — the hero discloses them, the radar (same page, more emphatic) does not.

**Long-horizon**

21. **`goalFIImpact` floors a goal contribution at the reader's whole surplus**, so a goal larger
    than their savings reports a fraction of its real FI delay — executed: 7 months displayed
    against 29 actual.
22. **/goals renders the literal string "null"** — VERIFIED at `goals/page.tsx:145-147`, which
    branches on `=== 0` only, so the third state falls into the template literal: *"Moves your FI
    date back ~null months"*. Line `:71` makes the mirror error with `?? 0`.
23. **The FI slider's caption fires its "you changed it" branch on first paint** for any reader with
    a negative savings rate, and asserts an FI date the card has just refused to give.
24. **A reader whose income the app cannot see is told their rate is "0.0%"**, beside a card in the
    same grid row saying the rate cannot be computed. `fi-card.tsx:94` re-derives inline what
    `savingsRateBps` (`fi.ts:212-216`) correctly returns as `null`.
25. **The wealth-target sensitivity table prints three arrival dates "all at what you're putting away
    today" from a floored $0** the same card just refused to project from.
26. **/investments prints a floored $0 contribution as a stated assumption** without saying it was
    floored or which way it errs.

**Parity**

27. **The Fixed / Guilt-free heading links promise "every matching transaction this month" and the
    destination drops every pending row.** The panel sums pending in (`budgets/page.tsx:76-93`); the
    destination filters on `spendClass`, stamped by a classifier that requires POSTED
    (`spend-class.ts:70` → `insights.ts:48`). Live on the shipped demo seed: **$49.93** of guilt-free
    the linked register cannot display. The existing basis note names only the *Plan* figure, and the
    e2e lock asserts URL params and row classes but never compares a total.
28. **Two figures labelled "spent this month" sit ~200px apart on the dashboard, over different
    windows.** `TopSpendingCard` has no `<= today` guard; the Trends card does. A manual
    future-dated row (nothing rejects one — `manual.ts:73`) makes them disagree, and the qualifier
    that would explain it exists only on `/trends`. The same split lives inside Ask: `merchant_spend`
    applies the guard, `spend_total` / `spend_by_category` / `top_categories` do not.
29. **Ask answers a merchant question about a broader merchant and renames it in the headline.**
    `merchantMatches` (`answer.ts:791-796`) is a bidirectional whole-word prefix, so "costco gas"
    sweeps in "Costco": **$37.38** on /trends against **$195.82** in Ask, answered under the other
    store's name. Known and pinned (TASKS O.10) — but the headline sentence is still false.

---

## P2 — polish, and one test that resists the fix

- The pace projection divides in floating point *before* `roundHalfAwayFromZero`, so the tie branch
  is unreachable for exactly the inputs it was written for: a swept domain found **140 one-cent
  violations** of the repo's stated rounding rule. Fix is `(spentSoFar * dim) / daysElapsed`.
- `daysElapsed` counts the in-progress day as whole, and comes from the server's unpinned local
  clock — the headline drifts upward all day with no new spending.
- **`tests/unit/trends.test.ts:249-251` is a tautology** — it asserts `projectedCents` equals
  `Math.round((spentSoFar / daysElapsed) * daysInMonth)`, i.e. restates the implementation. It
  cannot fail for any model, correct or wrong, and it will actively resist the P1-1 fix. Delete it;
  the golden literals above it are the real lock. Related: **every pace test uses `daysElapsed: 10`**
  — there is no test at day 1, 2 or 3, which is where the figure is worthless.
- A mover row prints a net-refund-clamped `$0.00` as a fact and sorts on a delta derived from it;
  the expander names the clamp, the collapsed row does not.
- Four `/coach` sentences hard-code "6 months" for a window the code computes as `last6.length`.
- Discretionary cut proposals divide by a fixed 3-month window (understates, so cuts look too small).
- The savings streak counts a 0.0% month as "positive", and "personal best **so far**" is computed
  over the last 12 months only.
- `toFIInputs` (`scenario.ts:394-401`) still pairs the nominal return with a present-value target —
  no caller today, so it is a trap rather than a live claim, but its sibling twelve lines down warns
  against exactly this.
- The wealth-target module header still documents the pre-W.2 world and tells the next reader the
  two cards disagree when they now agree.
- /investments calls the reader's observed spending "your planned spending".
- The runway card prints a negative month count as a positive-sounding fact ("-2.3 months of
  expenses in cash", followed by an aphorism about not needing the next paycheck).
- /forecast's frozen disclosure names the account by `payment.name` where the figure above it uses
  `accountLabel(payment)` — a third instance of a drift already recorded twice.
- The whole-cycle total is paired with the *last* due date on both the hero and /cards (the mirror
  of P1-16 — this one under-demands late).
- /calendar's month totals span every account; the transfer instruction inside the same card is one
  account. Neither states its scope.
- /cards' minimum-path interest estimate silently excludes undatable and next-cycle cards.
- The merchant lens reports gross posted charges while the register summary beside it nets refunds
  and includes pending — three figures, one merchant, one screen.

---

## UX — the transaction and rules flow

Critic F read `docs/lessons/the-affordance-existed-and-was-lossy.md` first and grepped every `href=`
rather than working from recall. **Three of the owner's four asks are already built**, which changes
what the work is.

| The owner's words | Verdict |
|---|---|
| "app takes a stab at discretionary or fixed" | **Exists, honestly labelled a guess** (`transactions/page.tsx:146-149`) |
| "and a place to change that" | **Exists twice** — a `<select>` on every register row (`transaction-list.tsx:640`) and on the detail view (`:750-765`) |
| "if i click away to set a rule, should be a button … to return" | **Present but lossy, and often absent** |
| "transaction page … a way to set rules … perhaps as a popup menu" | **The popup menu exists with ten actions and already contains rules**; spend class is the one verb missing |

The real findings:

- **F1 (P1) — the return button exists and returns to the wrong place.** `/rules` renders "Back to
  {label}", but `decodeRegisterReturn` is rooted at the `REGISTER_PATH` literal (`links.ts:28,543`),
  so a *detail* destination is structurally inexpressible: it always lands on the register, never on
  the transaction. And on the default unfiltered register there is nothing to carry, so
  `withRegisterReturn` returns the href unchanged (`links.ts:479-483`) and **no return link renders
  at all**. This is the O.16 lesson one hop deeper — building the literal request would ship a third
  link beside two that point at the wrong place.
- **F2 (P1) — the detail view drops its own context at the second hop.** "Open the whole transaction
  (and undo the split)" is a bare href (`transaction-detail-view.tsx:1011`) while the file's own
  comment 740 lines above states the governing rule.
- **F3 (P1) — four entry points hand the reader a dump, not a return.** The triage inbox, the
  dashboard recents and every breakdown expander link to a bare `/transactions/<id>`, so the back
  link reads "Back to transactions" and discards the queue the reader was working.
- **F4 (P1) — Fixed/Discretionary is the one verb missing from the popup menu.** `actions.ts:389-400`
  lists ten actions; spend class is not one, and is instead the always-on dropdown stamped on all
  fifty rows. This is almost certainly the clunk the owner is naming.
- **F5 (P1) — a per-row control performs a one-gesture, category-wide write.** `setCategoryFixed`
  fires on `onChange` and revalidates five routes; the scope is disclosed only in a `title`
  tooltip — a non-affordance on a phone, as this repo has already recorded. One row above it the
  register's category picker is *deliberately* two-step ("a menu tap selects, it doesn't assert").
- **F6 (P1) — the "Neither" tooltip enumerates three causes; the predicate has at least seven.** A
  pending charge, an excluded row, a refund, and anything filed Cash/Investment/Credit-card-payment
  all show "Neither" under a sentence claiming they are transfers, income or uncategorized.
- **F7 (P1) — a split container gets a live Fixed/Discretionary control** an inch below copy saying
  it is in no total, because `server/transactions.ts:632-645` builds the detail row without
  `isSplitParent`.
- **F8–F13 (P2)** — the register cannot say whether a class is our guess or the reader's own setting
  (the data exists and is rendered on /budgets); the spend-class write bypasses the detail view's
  `afterWriteHref` discipline and can re-raise a false "we could not confirm it" banner; any write
  discards typed text in sibling forms; `/rules` Edit silently destroys a half-written rule; the
  register header's own "Rules" button drops the filter it is standing in; and no rule links to the
  transactions it files.

---

## Next measurement, before any fix

Per `three-sessions-of-hypothesis-one-query-of-evidence`: three sessions of this project have
already shipped a plausible fix for a Fixed-figure symptom without measuring first, and none was the
cause. **P0-4 and P1-13 are two different mechanisms that both explain the owner's report and point
in opposite directions from the pace defect.** One read-only replay against the owner's production
rows settles it: for the mortgage row, print `Transaction.categoryId`, `isTransfer`, and whether a
`RecurringSeries` exists for it. `vercel env pull` + `pg` reaches the live database read-only.

Suggested order once measured: P0-7 and P1-2 first (a guard and a copy change, and they are what the
owner is looking at), then P0-1 and P0-2 (both are money instructions), then the P0-4/P0-5 Fixed
cluster behind the replay.
