<!--
RECONCILED 2026-08-21 (TASKS P.2 / DECISIONS #499). This file was authored
2026-06-24 as PLAN ONLY. Waves 1–4 plus later W.*/Ask work have since shipped.
Do not rebuild items listed SHIPPED / SUPERSEDED in §0. The body below is the
original plan; §0 is the current-state overlay. Next leftovers are ranked there.
-->

# Coach Principles Plan — Embedding 9 Books into Aimplifi

*Source: nine personal-finance books distilled to principles and mapped against the live app. Aimplifi is ~done; this plan is deliberately minimal and high-impact. Every item respects the constitution: engine-first + unit-tested, integer cents, assumptions stated inline, no-shame language, and all new user-facing strings routed through `COACH_COPY` (`src/lib/engine/fi/coach-copy.ts`) so `tests/unit/coach-copy.test.ts` keeps scanning them for guardrail violations.*

---

## 0. Reconciliation (2026-08-21 — P.2)

Authoring-time verdicts in §2–§7 are **not** current build state (lesson:
plan-verdicts-are-authoring-time). Verified against code this session.

**Do not rebuild.** Invisible wealth, room-for-error pill, freedom dividend,
yourEnough, volatility note, conscious strip (3 buckets — investing folded
into savings, stated inline), automation blueprint, biggest-lever badge,
cushion-is-a-goal, assumptions-change, assets-vs-liabilities caption,
app-authored money-rules card, debt freedom planner + Ask `debt_payoff`,
wealth-target + lifestyle creep + signature/streaks, W.6(a) dial-aware
cuts, Ask intents `what_to_cut` / `fi_status` / `lifestyle_creep` /
`wealth_target` / `debt_payoff` / `savings_rate` / `cash_needed` /
`safe_to_spend` / `cash_flow_radar` / `forecast` / `subscriptions`,
#493 Settings savings-goal reference line.

**Clusters now.** C1, C3, C4, C7, C8, C11, C15 **SHIPPED**. C9 **SHIPPED**
(payoff engine; mortgage extra-principal SHIPPED #517). C6 **SHIPPED** as the
adapted 3-bucket lens (book's 4th investing % is the honest fold). C16
**SUPERSEDED** (app-authored rules card, not a Settings freeform list).
C10 **SHIPPED** (P1.5 ladder + fee-drag + don't-time-it; P2.1 volatility;
idle-cash note #519). C12 **SHIPPED** #518 (expected-NW lens). C2 / C5 /
C13 **PARTIAL**. C14 **PARTIAL** (past-enough #503 + Giving YTD
#520 shipped; Giving goal preset still open).

**P0–P2 now.** SHIPPED: P0.1, P0.2, P0.3, P0.5, P1.1, P1.2, P1.4, P1.6, P2.1,
P2.2, P2.4, P2.5. PARTIAL: P0.4 (3 buckets + Ask #499). SUPERSEDED: P2.3
(#493 Settings dial), P2.6 (app-authored card). P1.5 investing ladder /
fee-drag SHIPPED #515 (Ask deferred).
*P1.3 shipped 2026-08-23 (#504): `User.richLifeVision` + the /settings card
(one line, demo-fenced on BOTH legs — write action and coach read —,
normalize-or-reject in a pure module) echoed atop /coach in
`COACH_COPY.richLifeHeader` only when set. The shipped echo's sentence is
SCOPED to "every number about your money below" — the template's bare "every
number below" was falsified by the value-receipts tally (critic F2). The Ask
`rich_life` intent was NOT part of the row — it stays gated in the Ask table
until its own slice.*
*P1.1 closed 2026-08-22 (#503): the badge and tags were already shipped —
"Your biggest lever" under the #1 opportunity on /coach, `dialTag` on
matching /trends movers, and the `moneyDials` note ("spend there proudly…")
on the /coach opportunities header. The verdict's "cuts skip dials"
behavior is the same rule, stated at the list level. No delta left.*

**This slice (#503).** C14 "past enough" Coast-FI framing — new
`COACH_COPY.pastEnoughCoast` line rendered under the Coast line on the FI
card, only when `coastIsCoast` (the engine's own flag; before coast it
would be a nudge the engine hasn't earned). The sentence claims nothing
about app surfacing (giving categories are per-user visible), keeping the
plan's "a lens, never a judgment" without promising a read-path.
#502 reflection and #500 staying-wealthy row stay.

**Still open, ranked.**

Grok / Flash (no new money math): Coast past-enough copy — SHIPPED #503;
P1.3 Rich Life one-liner — SHIPPED #504 (stored string + settings card +
/coach echo; the Ask `rich_life` intent remains, gated in the Ask table).

Opus + hostile critic (new money / money-visible): P.1 counterfactual
re-projection — FI half SHIPPED #506, radar/cash-dip half SHIPPED #507,
/coach-card radiation SHIPPED #508 (P.1 row closed; spending-plan
re-projection deferred); W.6(b) marginal-dollar order — engine + /coach
+ canonical Ask SHIPPED #510, Ask P1 CLOSED #511 (`should I` is not the
ranking proxy; critic 4-of-4 FAIL, findings executed, not certified);
W.6(d) drawdown on FI date SHIPPED #512 (/coach FI disclosure; critic PASS);
P1.4 income lever SHIPPED #514 (raise slider on the FI card; same
`monthsToFI` walk; FI number unchanged; Ask deferred); P1.5 investing
ladder + fee-drag SHIPPED #515 (level 1% leak of today's portfolio,
today's money, Ask deferred); Reports interest & fees YTD SHIPPED #516
(/reports tile; four leaves; demo empty; Ask deferred); mortgage
early-payoff SHIPPED #517 (/accounts extra-principal calculator;
demo empty; Ask deferred); PAW expected-NW lens SHIPPED #518
(mine-scope /dashboard; FI-card income × 12; age not stored; Ask
deferred); idle-cash note SHIPPED #519 (/dashboard; 6-month cushion;
same liquid + expenses as runway; no invented yield; Ask deferred);
Giving YTD SHIPPED #520 (/reports tile; gifts + charity leaves only;
demo empty; no opportunity-cost illustration; Ask deferred; Giving
goal preset still open).

---

## 1. Summary & guiding philosophy

Aimplifi already *is* a books-aligned product. Its constitution — savings-rate-as-hero, big-wins-never-latte-shame, money-dials as protected spending, pay-every-card-in-full, grounded-no-fabrication, "a lens, not a judgment" — is the literal intersection of Housel, Sethi, and Stanley & Danko. So this plan is **less "add features" and more "name the principle the user is already living, and fill the few real gaps"**: debt-payoff *ordering*, a conscious-spending bucket *lens that reuses the existing spend math*, an automation *blueprint* (Aimplifi never moves money), a Rich-Life vision line, and a light "give while you live" framing once Coast-FI is reached.

Guiding rules for everything below:

- **Coach first.** The FI Coach (`/coach`, assembled by `src/server/coach.ts`) is the primary surface; it already feeds `/dashboard`, `/goals`, and Ask Aimplifi. New principle-content lands here first, then radiates lightly outward.
- **Lens, never verdict.** No bucket is colored red for being "over." No peer comparison, ever (this is itself the *Never Enough* / *different games* principle made structural).
- **Engine before copy.** Anything with math (debt payoff ordering, conscious-spending %, raise→FI delta, fee drag, mortgage payoff) ships as a pure, tested module in `src/lib/engine/` before any component renders it.
- **One definition of spend.** No new feature introduces a parallel "what did I spend" calculation. Every spend/income/savings figure is derived from the already-tested read-paths: `computeSpendingPlan` (`src/lib/engine/spending-plan/plan.ts`), `spendingByCategory` / budget summaries, goal contributions, and the FI engine. This is the same discipline DECISIONS #74/#75 enforced — we do not add a third spend definition.
- **Aimplifi reminds; it never moves money.** Sethi/Babylon "automate everything" is honored as a *blueprint to set up at the user's own bank*, stated explicitly — never an executed transfer (`reminders/select.ts` invariant).
- **No new nav icon.** Per the existing #71 rule, new surfaces are reached from existing pages (a `/coach` section, a `/budgets` mode, a liability detail), not an 8th nav slot.

---

## 2. Principle → Feature map (de-duped clusters)

Recurring principles are merged into shared clusters; each is attributed to its books with a present / partial / absent status verified against the live app.

| # | Cluster | Books | One-line | App status |
|---|---------|-------|----------|------------|
| **C1** | **Pay yourself first / savings rate is the hero** | Babylon, Ramsey (BS4), Sethi, Housel | Wealth is the gap you keep; the rate, not returns, moves the date | **Present** — `SavingsRateCard`, `savingsRateBps` (`fi.ts`), the FI slider |
| **C2** | **Wealth is invisible / room-for-error / stay-wealthy** | Housel, Stanley & Danko (PAW), Babylon | Real wealth is unspent money + runway; survival lets compounding run | **Partial** — runway exists; no "invisible wealth" caption, no dashboard pill, no stay-wealthy framing |
| **C3** | **Confounding compounding / time in market / opportunity cost** | Housel, Sethi, Collins | Time does the work; small recurring leaks are decades of wealth (stated in today's money) | **Present** — `opportunityValueTodayCents` 10/20/30yr, in TODAY'S money since W.10 (grown at the return dial, then deflated by the inflation dial); lead with 30yr |
| **C4** | **Big wins, not lattes / tails drive everything** | Sethi, Housel | A handful of large recurring decisions dwarf small-pleasure guilt | **Present** — `findOpportunities`, ranked; "never latte-shame" (`insights.ts:83`) |
| **C5** | **Spend on what you value / money dials / memory dividends** | Sethi, Perkins, Housel (man-in-the-car) | Pour money into the few joys; cut the rest; buy experiences while you can | **Present** (dials) / **Partial** (no "memory dividend" / time-window-of-life framing) |
| **C6** | **Conscious spending plan, not a budget** | Sethi, Ramsey (zero-based, reframed) | See your money across a few buckets / give every dollar a job — as a lens, not a guilt meter | **Partial** — `computeSpendingPlan` (4-part safe-to-spend) + `/budgets` ("conscious-spending style") exist; no Fixed/Investing/Savings/Guilt-free % *lens* over the same data, no plan-to-zero affordance |
| **C7** | **Automate so willpower isn't needed** | Sethi, Babylon, Ramsey | The system runs on a schedule without you | **Partial** — coach *recommends* automation; Aimplifi never moves money |
| **C8** | **Use credit cards but pay in full / debt is expensive** | Sethi, Ramsey | Zero interest is the signature habit; carried interest is the costliest money | **Present** — Cash-Needed Engine + `/cards`; coach's preferred next action |
| **C9** | **Debt elimination — baby steps, snowball/avalanche** | Ramsey | Starter buffer → kill debt smallest-first → 3-6mo fund → invest 15% | **Partial** — `aprBps` already on `Account` and `minimumPaymentCents` already on `Statement`, both consumed by the Cash-Needed engine; the real gap is **payoff ordering** and a per-Account minimum-payment for non-card LOAN liabilities |
| **C10** | **Index-fund simplicity / low cost / don't time it** | Collins, Sethi (mechanics); Housel (behavior) | Buy cheap broad index funds, automate, hold; fees quietly destroy returns | **Present** — P1.5 ladder + fee-drag + don't-time-it (#515); P2.1 volatility price |
| **C11** | **Assets vs liabilities / financial education** | Kiyosaki | Buy assets that produce income; understand the difference | **Partial** — `/accounts` splits assets/liabilities, `/investments` tracks holdings; no explicit "what's an asset" education or income-vs-expense framing |
| **C12** | **Frugality / stealth wealth / PAW vs UAW** | Stanley & Danko | Live below your means; net worth, not income, defines wealth; no Joneses | **Present** (net worth hero, no peer compare, no status nudges) / **Partial** (no expected-net-worth "are you a PAW?" lens) |
| **C13** | **Define "enough" / your Rich Life / freedom buys time** | Sethi, Housel, Perkins | Decide what rich means to *you*; FI buys back your time | **Partial** — FI number anchors to own expenses; no stated Rich-Life vision, no "time becomes yours" reframe |
| **C14** | **Give generously / die with zero / memory dividends** | Ramsey (BS7), Perkins | Past "enough," give while alive and spend down for experiences | **Partial** — Coast-FI exists; no "Giving" surfacing, no past-enough framing |
| **C15** | **Behavior > math / reasonable > rational / 85% solution** | Housel, Ramsey, Sethi | A sustainable plan you'll keep beats an optimal one you'll quit | **Present** — single "one next action", honest "not on track", money-dials tone |
| **C16** | **Financial wholeness (10 components) / write your rules** | Aliche, Sethi (10 money rules) | A short personal rulebook + a holistic checklist of money areas | **Absent** — no money-rules list, no wholeness checklist |

**Book-coverage note (intentional deferral).** Kiyosaki (C11) and Aliche (C16) each map to a single cluster and both sit in Wave 4 ("optional polish"). That means an initial Wave 1+2 (+ Wave 3 debt) ship surfaces **7 of the 9 books**; Kiyosaki and Aliche would not yet appear in the product. This is deliberate given the minimal-by-design intent, but it is a real choice — the owner may want one Wave-1 content line each (e.g., the assets-vs-liabilities caption on `/accounts` for Kiyosaki, and the "My Money Rules" strip for Aliche/Sethi) to keep all nine books visible from the first ship. Flagged here for that decision rather than left implicit.

---

## 3. Coach capabilities (prioritized)

The Coach is the lead surface. Each item lists the cluster(s)/book(s), surface, type (content / mechanic / both), UI/UX, and a concrete `COACH_COPY` prompt or logic snippet. Effort S/M/L, impact high/med/low.

### P0 — highest impact, mostly content or thin mechanics

**P0.1 — "Invisible wealth" caption on the savings-rate card** · C1+C2 · Housel · `src/components/coach/savings-rate-card.tsx` · content · **S / high**
A one-line emerald sub-caption under the headline figure tying the unspent gap to net-worth growth.
```ts
// COACH_COPY.invisibleWealth
invisibleWealth: (savedCents: Cents, monthLabel: string) =>
  `You didn't spend ${formatCents(savedCents)} in ${monthLabel} — that gap, not the things you could have bought, is what your net worth is made of. Wealth is the money you don't see.`,
```

**P0.2 — "Room for error" status pill on the dashboard** · C2 · Housel, Babylon · `/dashboard` (beside `net-worth-card.tsx`) · both · **S / high**
Small pill near net worth reading the existing `monthsOfRunway`; amber under ~3 months, with 3- and 6-month ticks so the user sees where they fall in the classic range (this also satisfies Ramsey BS3). No new math.
```ts
runwayBanded: (months: number, band: 'below' | 'in' | 'above') =>
  `Room for error: ${months} months of expenses in cash — you're ${band === 'below' ? 'approaching' : band === 'in' ? 'inside' : 'past'} the classic 3–6 month range. The richest feeling money buys is not needing the next paycheck.`,
```

**P0.3 — "Years until your time is your own" reframe on the FI card** · C13 · Housel, Sethi, Perkins · `fi-card.tsx` · content · **S / high**
A sibling line under years-to-FI expressing the FI number as freedom funded.
```ts
freedomDividend: (years: number) =>
  `That's about ${years} years until your time becomes fully yours — the highest dividend money pays. Every point of savings rate buys some of it back sooner.`,
```

**P0.4 — Conscious Spending bucket *lens* (reuses existing spend math)** · C6 · Sethi (+ Ramsey zero-based, reframed) · a strip on `/budgets` or `/coach` · both · **M / high**
A read-only re-grouping of the **already-computed** trailing-month figures into Sethi's four buckets — **Fixed / Investing / Savings goals / Guilt-free** — as a % of after-tax income, with his target bands (50–60 / 10 / 5–10 / 20–35) shown as faint range markers. This is **a presentation lens, not a new engine and not a new spend definition.** It is derived entirely from existing tested read-paths:
- *fixed* = recurring-detected outflows already surfaced by `/recurring` + `upcomingBillsCents` from `computeSpendingPlan`;
- *investing* = INVESTMENT inflows / contributions already known to the FI engine;
- *savings goals* = goal monthly contributions (`plannedSavingsCents`, already in `computeSpendingPlan`);
- *guilt-free* = the remainder, i.e. the existing `leftToSpendCents` / discretionary actuals.

**Relationship to existing surfaces (stated, per the one-definition rule):** `/spending-plan` already renders a 4-segment bar (spent / upcoming bills / planned savings / left-to-spend) from `computeSpendingPlan`, and `/budgets` is already "conscious-spending style." This lens does **not** replace or fork either — it relabels the *same* four quantities into Sethi's vocabulary so the user sees the conscious-spending frame without a second calculation. If only a thin mapper is needed, prefer a pure `mapToConsciousBuckets(plan, goals)` helper over the existing `SpendingPlan` output rather than a parallel engine. **Never** color a segment red.
```ts
consciousSpending: (fixedPct: number, investPct: number, savePct: number, funPct: number) =>
  `Last month, roughly ${fixedPct}% went to fixed costs, ${investPct}% to investing, ${savePct}% to goals, and ${funPct}% to guilt-free spending. A common target is 50–60 / 10 / 5–10 / 20–35 — yours is a lens, not a rule.`,
```

**P0.5 — Automation blueprint card** · C7 · Sethi, Babylon, Ramsey · `/coach` · both · **M / high**
Turns paycheck cadence + goal contributions + card due dates into a dated, copy-pasteable list of standing instructions to set up **at the user's bank**. Banner states the invariant explicitly. All from existing engines; no money is moved.
*Engine:* `src/lib/engine/automation/blueprint.ts` (`buildAutomationBlueprint(...) → BlueprintStep[]`), pure + tested.
```ts
automationBlueprintBanner: () =>
  `Set these up once at your bank — Aimplifi reminds, it never moves your money. Then the system runs itself.`,
automationStep: (day: string, amount: Cents, purpose: string) =>
  `On the ${day}: ${formatCents(amount)} → ${purpose}.`,
```

### P1 — fills real gaps, modest effort

**P1.1 — "Big Win" badge + dial tags** · C4+C5 · Sethi, Housel · `/coach`, `/trends` · content · **S / med**
Badge the #1 opportunity "Your biggest lever"; tag any mover/category matching a money dial with a small dial icon + "Spend there proudly."
```ts
biggestLever: () => `Your biggest lever — fix this and the small stuff barely matters.`,
dialTag: (category: string) => `${category} is one of your money dials — spend there proudly; we only hunt savings elsewhere.`,
```

**P1.2 — "Staying wealthy" survival row** · C2 · Housel, Stanley & Danko · `/coach` · content · **M / med**
A compact 3-checkmark row distinct from the FI growth story: *cards clear in full · {n}-month cushion · spending tracking income*. Framed as empowering signals, never scarcity/fear.
```ts
stayingWealthy: (months: number) =>
  `Getting wealthy and staying wealthy are different skills. Your survival signals: every card clears in full, ${months} months of runway, and spending is tracking income. Frugality plus a little room for error is what keeps compounding alive.`,
```

**P1.3 — "My Rich Life" vision line** · C13 · Sethi · onboarding/settings + `/coach` header · both · **S / med** · **DONE 2026-08-23 (#504)**
One freeform stored string ("In one line, what does a rich life look like for you?"), echoed quietly atop `/coach`.
```ts
richLifeHeader: (vision: string) =>
  `Your Rich Life: "${vision}". Every number below is in service of that — not the other way around.`,
```

**P1.4 — Income lever (raise → FI delta) slider** · C1 (income side) · Sethi · `/coach` · both · **M / med** · **DONE 2026-08-25 (#514)**
Mirrors the savings-rate slider: a hypothetical raise, saved at the current rate, recomputes the FI date via the existing `monthsToFI`. Names salary as the biggest big-win Aimplifi has never modeled.
```ts
incomeLever: (raiseCents: Cents, monthsSooner: number) =>
  `A ${formatCents(raiseCents)}/yr raise, saved at your current rate, would move your FI date about ${monthsSooner} months sooner — assuming your expected return holds. Negotiating income is the biggest big win of all.`,
```

**P1.5 — Investing order-of-operations + fee-drag explainer** · C10 · Collins, Sethi (mechanics) · `/coach` (collapsible) · both · **M / med** · **DONE 2026-08-25 (#515)**
Generic, no tickers (honors the no-securities disclaimer): account *types* and order (match → Roth IRA → max 401k → taxable), plus a fee-drag stat reusing `opportunityFVCents` on the user's own portfolio. Pairs with a one-line "don't try to time it." (Mechanics attributed to Collins/Sethi; the behavioral "don't time it / volatility is the price" framing is Housel's and lives in P2.1.)
```ts
investingLadder: () =>
  `Order of operations: 1) capture the full employer 401(k) match (free money), 2) fund a Roth IRA, 3) max the 401(k), 4) taxable. Educational only — we never recommend specific funds.`,
feeDrag: (portfolio: Cents, fvFee: Cents, returnBps: number) =>
  `A 1% yearly fee on ${formatCents(portfolio)} could quietly cost about ${formatCents(fvFee)} over 30 years (assuming ${(returnBps/100).toFixed(2)}% returns). The cheapest broad index funds keep that money compounding for you.`,
```

**P1.6 — "Define your enough" caption on the FI card** · C13 · Housel, Stanley & Danko · `fi-card.tsx` · content · **S / med**
States the FI number is anchored to the user's own life, never anyone else's. No comparison, ever.
```ts
yourEnough: () =>
  `Your FI number is built from your spending, not anyone else's — that's the point. The goalpost stops moving when "enough" is defined by your life, not the feed.`,
```

### P2 — nice-to-have, low effort or low impact

- **P2.1 — Volatility "price of admission" popover** on the return assumption · C10 *(behavioral)* · Housel · `fi-card.tsx` · content · **S / med**: *"Those returns aren't free — the price is volatility along the way. A fee for admission, not a fine."*
- **P2.2 — Life-energy "memory dividend / who notices" reflection** for big discretionary buys **outside** declared dials only · C5 · Perkins, Housel · `life-energy-card.tsx` · content · **M / low**: *"…worth it if it's a money dial or a memory you'll keep — but if it was meant to impress, almost no one notices the thing."*
- **P2.3 — 15%-to-retirement reference line** on the savings-rate sparkline · C9 · Ramsey BS4 · content · **S / med**.
- **P2.4 — "Saving needs no reason" / unallocated cushion is a goal** note on `/goals` · C2 · Housel · content · **S / low**.
- **P2.5 — "Assumptions will change / play your own game"** helper text on settings & goals · Housel · content · **S / low**.
- **P2.6 — My Money Rules** freeform list in settings, shown as a quiet strip on `/coach` · C16 · Sethi, Aliche · content · **S / low**.

---

## 4. App-wide integrations by surface

Light but meaningful touches outside the Coach. All reuse existing engines; all copy routes through `COACH_COPY`.

| Surface | Item | Cluster | Type | Effort/Impact |
|---|---|---|---|---|
| **Dashboard** (`/dashboard`) | Room-for-error pill (P0.2); pair every forecast dip with the runway cushion line ("surprises are what history guarantees; your N-month cushion handles what no forecast sees") | C2, C15 | both | S / high |
| **Budgets** (`/budgets`) | Conscious-spending bucket *lens* (P0.4), reusing `computeSpendingPlan` outputs — see P0.4 for how it relates to the existing segmented bar; an optional "assign to zero" affordance that simply highlights the existing `leftToSpendCents` as *unassigned* and counts it toward $0 (no new math, no parallel budget store) | C6 | both | M / high |
| **Debt** (`/goals` + liability detail) | **Debt Freedom planner** (build below): ordered payoff with snowball **and** avalanche toggle, "Debt-free by {month}" hero, extra-$/mo slider; **$1,000 starter-buffer preset**. Reuses the existing `aprBps` on `Account`; adds only a minimum-payment field for non-card LOAN liabilities | C9 | both | L / high |
| **Net worth** (`/dashboard` `net-worth-card.tsx` + `/accounts`) | Mortgage early-payoff what-if (extra-principal slider) on a mortgage liability; optional "are you a PAW?" expected-net-worth lens (age × income ÷ 10, framed as a lens, no shame); high-yield note when idle cash far exceeds runway | C9, C12, C10 | both | M / med |
| **Automation** (`/coach`) | Automation blueprint card (P0.5) | C7 | both | M / high |
| **Goals** (`/goals`) | "Paying yourself first {sum}/mo across {n} goals" summary feeding the conscious-spending lens; College/education + Giving goal presets; unallocated-cushion-is-a-goal note | C1, C6, C14 | content/mech | S / low–med |
| **Reports** (`/reports`) | "Interest & fees paid YTD" tile (cost-of-debt made visible, no moralizing, with 30yr-FV-if-invested context); surface a "Giving" category in spending-by-category | C8, C9, C14 | content | M / med |
| **Ask Aimplifi** (`/ask`) | Add intents that read the new/existing engines: `debt_payoff` ("when am I debt-free?"), `conscious_spending` ("how are my spending buckets?"), `rich_life`. Each delegates to the **same** tested read-path so `/ask` can't drift from `/coach` or `/budgets`. **2026-08-21:** `debt_payoff` already shipped; `conscious_spending` shipped #499; `stay_wealthy` shipped this slice (#500). **2026-08-23:** `rich_life` SHIPPED (#505) — the stored vision (#504, P1.3) echoed verbatim; when none is written the answer names the empty state and points at Settings. Same read-path as the /coach echo (`getCoachData`), so the demo fence carries across. | C9, C6, C13 | mechanic | M / med |
| **Onboarding/Settings** (`/settings`) | "My Rich Life" field (P1.3); My Money Rules list (P2.6); "assumptions will change" helper | C13, C16, Housel | content | S / low–med |

---

## 5. Conflicts & chosen defaults

Three genuine cross-book conflicts plus two app-philosophy tensions. Each is presented to the **end user as a values choice where appropriate**, with a **recommended default aligned to Aimplifi's low-shame, conscious-spending, pay-every-card-in-full philosophy.**

### Conflict A — Debt snowball (Ramsey) vs avalanche (math-optimal)
- **The tension:** Smallest-balance-first (snowball) wins on motivation/behavior; highest-APR-first (avalanche) wins on interest saved.
- **Presented as a values choice:** a single toggle — *"Quick wins (smallest first)"* vs *"Least interest (highest rate first)"* — with both outcomes shown side by side: months to first payoff and total interest, both assuming the same extra-$/mo and current minimums.
- **Recommended default: Avalanche (least interest), with snowball one tap away.** Why: it costs the user the least real money, and Aimplifi's whole ethos is honest math without shame — we don't need the artificial early win because the planner *shows* the first-payoff date for both, giving the motivational signal without forfeiting interest. We state the trade in plain language and let the user flip to snowball if momentum matters more to them. (This is a deliberate, stated departure from Ramsey's behavior-over-math default.)

### Conflict B — Ramsey total-anti-debt vs Kiyosaki good-debt/leverage
- **The tension:** Ramsey: debt is never a tool, the borrower is slave to the lender. Kiyosaki: "good debt" buys income-producing assets.
- **Presented as a values choice:** an optional one-line framing on the debt planner — *"Some borrowing buys assets that pay you back (Kiyosaki); some just transfers your future income to lenders (Ramsey). The planner helps you clear the second kind first."*
- **Recommended default: pay-in-full on revolving credit (already the product's signature), and prioritize clearing high-interest consumer debt — but stay neutral on responsible leverage.** Why: Aimplifi already assumes responsible credit-card use (it doesn't take Ramsey's cut-up-the-cards stance), and it tracks mortgages as legitimate liabilities rather than emergencies. We surface the *cost* of consumer interest (Reports "Interest & fees YTD") without moralizing, and we offer a mortgage early-payoff what-if **without nudging** the user toward it — leaving the leverage question to their values. We never recommend taking on debt to invest (that would cross the no-advice line).

### Conflict C — Millionaire-Next-Door frugality (Stanley & Danko) vs Die-with-Zero (Perkins)
- **The tension:** Accumulate quietly and live below your means vs. spend it down and give while alive so you don't die with unused wealth.
- **Presented as a values choice:** these are *sequenced*, not opposed — frugality builds the base; "give/spend while alive" applies **past "enough."** Once the user is **Coast FI** (engine already computes this), the Coach gently opens the second framing: experiences and giving are now a *dial you can turn up*, surfaced as spending like any other ("a lens, never a judgment").
- **Recommended default: frugality + PAW-style accumulation until Coast-FI, then a soft "give/spend while you can" prompt — never a directive.** Why: it honors Aimplifi's net-worth-as-hero, no-Joneses base while respecting that the FI number is defined by *enough*, not infinity (the *Never Enough* principle). We never tell a still-accumulating user to spend down, and we never shame a Coast-FI user for continuing to save. Memory-dividend / giving language appears only past-enough and only as protected, celebrated spending.

### Tension D — "Automate everything" (Sethi/Babylon) vs Aimplifi never moves money
- **Resolution (stated, not papered over):** Aimplifi generates an **automation blueprint** to set up once at the user's own bank; it never executes a transfer (`reminders/select.ts` invariant). The card's banner says so explicitly.

### Tension E — Prescriptive % bands & named vehicles vs low-shame, no-advice tone
- **Resolution:** Conscious-spending bands (50–60/10/5–10/20–35) and the investing ladder are presented strictly as **"a lens, not a rule"** through `COACH_COPY`; **no bucket is ever colored red**, and the ladder names account *types* and order only — **never a specific fund or ticker** — so the existing no-securities guardrail holds.

---

## 6. Suggested coach prompts / logic per principle area

Consolidated reference (all destined for `COACH_COPY`; assumptions stated inline; no shame).

**C1 Pay yourself first / savings rate**
> "At your current savings rate you'd reach FI in ~{years}y — the slider holds returns fixed, so what's moving the date is purely how much you keep." *(present; reinforce)*

**C2 Invisible wealth / room for error / stay wealthy**
> "You didn't spend {savedCents} in {month} — that gap is what your net worth is made of." · "Room for error: {n} months in cash — {band} the classic 3–6 month range." · "Survival signals: cards clear in full, {n}-month cushion, spending tracking income."

**C3 Compounding / time / opportunity cost**
> "That {monthly}/mo isn't {monthly} — left to compound it's {fv30} over 30 years at {pct}. Time, not effort, does the heavy lifting." *(present; lead with 30yr)*

**C4 Big wins / tails**
> "A handful of items drive most of your savings. This one is your biggest lever — fix it and the small stuff barely matters."

**C5 Money dials / memory dividends**
> "{category} is one of your money dials — spend there proudly; we only hunt savings elsewhere." · *(outside dials, optional)* "This was {hours} hours of your working life — worth it if it's a memory you'll keep."

**C6 Conscious spending / assign to zero**
> "Last month: ~{fixed}% fixed, {invest}% investing, {save}% goals, {fun}% guilt-free. A common target is 50–60/10/5–10/20–35 — a lens, not a rule." · "You have {unassigned} of expected income still unassigned — giving every dollar a job is the plan, not a verdict." *(both derived from `computeSpendingPlan`, no new spend math)*

**C7 Automate**
> "On payday, {savingsSum}/mo to goals and {investSum}/mo to investing; keep {cardCash} in checking before {dueDate}. Set it once at your bank — Aimplifi reminds, it never moves your money."

**C8/C9 Credit in full / debt elimination**
> "You cleared every card in full — the single most powerful habit here." · "Smallest-first clears {firstName} in ~{m1} months (the early win); by-rate saves ~{interestDelta} but takes longer to a first payoff. Both assume an extra {extra}/mo. Your call — momentum or math."

**C10 Index simplicity / fees**
> "Order of operations: match → Roth IRA → max 401(k) → taxable. Educational only." *(Collins/Sethi)* · "A 1% fee on {portfolio} could cost ~{fvFee} over 30 years at {pct} returns." *(Collins/Sethi)* · "Those returns aren't free — the price is volatility along the way." *(Housel)*

**C11 Assets vs liabilities**
> *(optional `/accounts` education)* "Assets put money in your pocket; liabilities take it out. Your net worth is what's left when the liabilities are subtracted — that's the number we grow."

**C12 Frugality / PAW**
> *(optional, framed as a lens)* "A common benchmark expects net worth ≈ age × income ÷ 10. You're {above/near/below} it — a lens on accumulation, not a grade."

**C13 Enough / Rich Life / freedom**
> "Your Rich Life: '{vision}'. Every number below is in service of that." · "~{years} years until your time becomes fully yours." · "Your FI number is built from your spending, not anyone else's."

**C14 Give / die with zero** *(Coast-FI only)*
> "You're Coast FI — what you've invested should reach your FI number on its own. Past enough, many people turn the dial toward experiences and giving. We surface that the same as any spending: a lens, never a judgment."

**C15 Behavior > math / 85%**
> "Don't optimize — just do this one thing this week: {nextAction}. Starting at 85% today beats a perfect plan you never run." *(present)*

**C16 Money rules / wholeness**
> "Your money rules, in your words: {rules}. The system above is built to keep them automatic."

---

## 7. Prioritized build order (effort × impact)

Sequenced so each step is independently shippable and verifiable (`bash scripts/verify.sh` green + hostile-critic clean per the constitution). Engines land with unit tests before their UI.

### Wave 1 — content-only, near-zero risk (do first)
| Item | Cluster | Effort | Impact |
|---|---|---|---|
| P0.1 Invisible-wealth caption | C1/C2 | S | high |
| P0.2 Room-for-error pill + 3/6-mo band | C2 | S | high |
| P0.3 Time-becomes-yours line | C13 | S | high |
| P1.6 Define-your-enough caption | C13 | S | med |
| P1.1 Big-Win badge + dial tags | C4/C5 | S | med |
| P2.1 Volatility popover · P2.3 15% reference line · P2.4 cushion-is-a-goal · P2.5 assumptions-change | mixed | S | med–low |

*Gate: all new strings in `COACH_COPY`; `coach-copy.test.ts` extended to scan them; no engine change.*

### Wave 2 — thin engines / lenses, high payoff
| Item | Cluster | Effort | Impact |
|---|---|---|---|
| P0.4 Conscious-spending bucket lens (thin mapper over `computeSpendingPlan`, no new spend engine) | C6 | M | high |
| P0.5 Automation blueprint (`blueprint.ts`) | C7 | M | high |
| P1.4 Income-lever slider (reuses `monthsToFI`) — SHIPPED #514 | C1 | M | med |
| P1.3 Rich-Life vision field | C13 | S | med |
| P1.2 Staying-wealthy survival row | C2 | M | med |

*Gate: each engine/mapper pure + known-answer tested against hand-built values in `docs/EDGE_CASES.md`; integer cents throughout; P0.4 asserted to equal the existing `computeSpendingPlan` quantities (no divergent total).*

### Wave 3 — debt & larger mechanics
| Item | Cluster | Effort | Impact |
|---|---|---|---|
| Debt Freedom planner: payoff-ordering engine `src/lib/engine/debt/payoff.ts` (snowball **and** avalanche, extra-$/mo, debt-free date) reusing the existing `aprBps`; add a minimum-payment field on the `Account` model for non-card LOAN liabilities only; $1,000 starter preset | C9 (Conflict A) | L | high |
| P1.5 Investing ladder + fee-drag explainer — SHIPPED #515 | C10 | M | med |
| Reports "Interest & fees YTD" tile — SHIPPED #516 | C8/C9 | M | med |
| Mortgage early-payoff what-if (amortization engine) — SHIPPED #517 | C9 (Conflict B) | L | med |
| "Assign to zero" affordance on `/budgets` (highlights existing `leftToSpendCents`; no new store) | C6 | M | med |

*Gate: debt payoff engine pinned to hand-verified amortization tables; the snowball/avalanche toggle defaults to avalanche per Conflict A; debt-free date proven against EDGE_CASES. No re-adding of `aprBps` or card `minimumPaymentCents` — both already exist and feed the Cash-Needed engine.*

### Wave 4 — optional polish (only if markedly better)
| Item | Cluster | Effort | Impact |
|---|---|---|---|
| C14 Coast-FI "give/spend while you can" framing + Giving category/goal | C14 (Conflict C) | S | low |
| P2.2 Memory-dividend / who-notices reflection | C5 | M | low |
| P2.6 My Money Rules · C11 assets-vs-liabilities education · C12 PAW lens · high-yield note | mixed | S–M | low |
| Ask Aimplifi new intents (debt_payoff, conscious_spending, rich_life) | C9/C6/C13 | M | med | **2026-08-21:** first two SHIPPED; `rich_life` still gated on P1.3 |

**Stop condition.** Aimplifi is ~done; per the project CLAUDE.md "When blocked" / conventions guidance and the owner's #80 "only change if markedly better" directive, do not polish past real value. Ship Wave 1 + the two Wave-2 highs (P0.4, P0.5) and the Wave-3 Debt planner — those close the only genuinely *absent or partial* gaps that matter (C9 payoff ordering, C6 bucket lens, C7 automation) and add the highest-leverage *content* gaps (C2, C13). Everything past that is genuine polish; build only what is "markedly better," then stop. **Note:** Kiyosaki (C11) and Aliche (C16) remain in Wave 4 and will not ship in that scope — surface one Wave-1 content line each only if keeping all nine books visible from the first ship is wanted.
