> Sessions from 2026-06/2026-07 were moved verbatim to
> `docs/archive/PROGRESS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04. Only 2026-08
> sessions live here; append new sessions at the top as before.

## 2026-08-26 — C14 Education goal preset on /goals (DECISIONS #522)

**Picked up.** Owner: "continue." #521 closed and named this as next:
the College/education leftover. It is the last C14 item.

**Closed (registry + /goals form).** One preset became an ordered
registry; the contract is unchanged — a preset is a name, never an
amount. Name is `Education` (the taxonomy's label, read not typed),
not `College`, which would narrow the envelope and invent a word the
taxonomy lacks. The hint claims no reports lens (Giving has one, #520;
education has none), names no 529/tax treatment, ranks nothing against
retirement, and sends a student loan to the debt planner that owns it.
Intro renamed `goalPresetIntro` — it heads every chip now. Giving left
byte-identical: the #521 live probe greps four of its phrases.

**Critic (fresh context): cycle 1 PASS — 0 P0, 0 P1.** It reproduced
all gates itself and verified the reports-lens premise instead of
accepting it. Its one **P2 was fixed before ship**: the rendered chip
label was pinned by nothing — swapping the form's two `label:` entries
renders Education as "Giving" with every test and the probe still
green, because they all read the name input, which comes from the
registry. Locked now by exact-text assertions on each chip in both e2e
specs and the live probe (EP6). Residual P3s: chip click overwrites a
typed name (unchanged #521 behaviour); both hints always render.

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN
(tsc 0, probes tsc 0, eslint 0, `next build` clean). Unit **7,836
passed + 1 expected fail + 1 skipped / 475 files + 1 skipped**. E2E
education 1/1 and giving 1/1. No `prisma/` diff.

**Next.** C14 is closed. C2 / C5 / C13 remain partial. Wave 0 ops
remain owner-blocked. Match % still uncollected.

## 2026-08-26 — C14 Giving goal preset on /goals (DECISIONS #521)

**Picked up.** Owner: "continue." #520 closed. Ranked next was the
Giving goal preset leftover of C14.

**Closed (engine + /goals form).** A preset is a name, never an
amount. Chip fills `Giving`; the reader types the dollars on the
existing `createGoal` path (`kind` null). No 10%, no tithe, no
Coast-FI gate (that framing stays on the FI card). College/education
deferred. Ask deferred. Live probe does not submit (shared demo).

**Critic (fresh context): cycle 1 FAIL 1 P1** (e2e locator also
matched the chip/hint; create+delete could not lock). Locator scoped
to `goals-list` + exact heading. Intro no longer claims a catalog.
Focus moves to the empty target. Hint uses taxonomy labels.
**Cycle 2 PASS — 0 P0, 0 P1.** Residual P2s: ungated vs Conflict C;
savings-envelope FI-delay; duplicate names; placeholder 10000;
intro fragment; fill not announced.

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN
(tsc 0, probes tsc 0, eslint 0, `next build` clean). Unit **7,821
passed + 1 expected fail + 1 skipped / 474 files + 1 skipped**.
E2E giving-goal-preset 1/1 after a fresh `next build`. No `prisma/`
diff.

**Gate read.** Pushed `54ad51b6`. CI run **33019457590** = SUCCESS
(~13m25s, first attempt). Vercel `dpl_EqmWqnoFprAUky9NEcvKp3cP7df3`
READY on that sha. Live proof **14/14 PASS**
(`scripts/p21-live-deploy-check.mjs`). `bash scripts/ci-status.sh`
could not find `gh` on the Git bash PATH this session; the
equivalent `gh run watch 33019457590 --exit-status` was SUCCESS.

**Next.** College/education goal preset. Wave 0 ops remain
owner-blocked. Match % still uncollected.

## 2026-08-26 — C14 Giving YTD on /reports (DECISIONS #520)

**Picked up.** Owner: "consume all readme files and continue to build."
#519 closed. Ranked next was "C11 assets-vs-liabilities caption or C14
Giving category." C11 is already shipped (DECISIONS #99 —
`COACH_COPY.assetsVsLiabilities` on /accounts
`data-testid="assets-vs-liabilities"`). This slice is the C14 leftover:
surface Giving on /reports.

**Closed (engine + /reports).** Same spend basis and calendar YTD as
interest-and-fees. Two system leaves only (`gifts`, `charity`). Null
when nothing is filed. No opportunity illustration. Empty title is
the lens name; empty body names the two leaves. Ask deferred. Demo
empty. C11 left alone (already on /accounts). Giving goal preset
deferred.

**Critic (fresh context): cycle 1 FAIL 2 P1; cycle 2 PASS — 0 P0,
0 P1.**

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN
(tsc 0, probes tsc 0, eslint 0, `next build` clean). Unit **7,809
passed + 1 expected fail + 1 skipped / 473 files + 1 skipped**.
E2E reports 1/1. No `prisma/` diff.

**Gate read.** Pushed `b3a1bb8e`. CI run **33009312696** = SUCCESS
(~13m23s, first attempt). Vercel `dpl_5voxdV1BojFqiYJuScnXqGHAdJP1`
READY on that sha. Live proof **13/13 PASS**
(`scripts/p20-live-deploy-check.mjs`).

**Next.** Giving goal preset. Wave 0 ops remain owner-blocked.
Match % still uncollected.

## 2026-08-26 — Idle cash past a 6-month cushion (DECISIONS #519)

**Picked up.** Owner: "read all required files and continue."
#518 closed. Ranked next: high-yield note when idle cash far exceeds runway.

**Closed (engine + mine-scope /dashboard).** Checking+savings vs a
6-month cushion (same liquid and last-N expenses as runway). Surplus
named only when the extra is at least one month of expenses. No
invented yield. Title is the lens name. Household omitted. Not on
/accounts. Ask deferred. Demo idle.

**Critic (fresh context): cycle 1 FAIL 3 P1; cycle 2 FAIL 1 P1;
cycle 3 PASS — 0 P0, 0 P1.**

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN
(tsc 0, probes tsc 0, eslint 0, `next build` clean). Unit **7,779
passed + 1 expected fail + 1 skipped / 471 files + 1 skipped**.
E2E idle-cash 1/1. No `prisma/` diff.

**Gate read.** Pushed `958d449b`. CI run **32994917230** = SUCCESS
(13m9s, first attempt). Vercel `dpl_CzovDyrTBqCFR6UR6nVJcf1nJj8p`
READY on that sha. Live proof **11/11 PASS**
(`scripts/p19-live-deploy-check.mjs`).

**Next.** C11 assets-vs-liabilities caption or C14 Giving category.
Wave 0 ops remain owner-blocked. Match % still uncollected.

## 2026-08-25 — PAW expected-NW lens (DECISIONS #518)

**Picked up.** Owner: "consume all readme files and continue."
#517 closed. Ranked next: PAW expected-NW lens.

**Closed (engine + mine-scope /dashboard).**
`age × yearly income ÷ 10` vs on-file net worth. Yearly income is
the FI card's monthly average × 12. Unknown age/income is not $0
expected. Household dashboard omitted (two sets). Not on /accounts
(`getCoachData` throws with zero accounts). Age not stored. Ask
deferred. Demo idle.

**Critic (fresh context): cycle 1 PASS — 0 P0, 0 P1.**

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN
(tsc 0, probes tsc 0, eslint 0, `next build` clean). Unit **7,746
passed + 1 expected fail + 1 skipped / 469 files + 1 skipped**.
E2E paw-lens 1/1 + add-asset 1/1. No `prisma/` diff.

**Gate read.** Pushed `7d7a2c15`. CI run **32881961927** = FAILURE
(/accounts `add-asset-btn`: `getCoachData` throws with zero accounts).
Fix: card on mine-scope /dashboard only. Pushed `1781d3ee`. CI run
**32886192868** = SUCCESS. Vercel `dpl_DHRj3vN2pkxfvhvBe8Gp9o7jhFKp`
READY on that sha. Live proof **11/11 PASS**
(`scripts/p18-live-deploy-check.mjs`).

**Next.** High-yield note when idle cash far exceeds runway. Wave 0
ops remain owner-blocked.

## 2026-08-25 — Mortgage extra-principal (DECISIONS #517)

**Picked up.** Owner: "consume all readme files and continue building
this out." #516 closed (CI fix `5e4d797b`). Ranked next: mortgage
early-payoff.

**Closed (engine + /accounts).** Two `planDebtPayoff` legs on one
`MORTGAGE`. Unknown APR is not 0%. Saved figures only when both legs
clear. Cash-due minimum named as unsplit. Card after the accounts list.
Ask deferred. Demo empty.

**Critic (fresh context): cycle 1 FAIL 1 P1** (escrow/add-on silent).
**Cycle 2 PASS — 0 P0, 0 P1.**

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0,
probes tsc 0, eslint 0, `next build` clean). Unit **7,712 passed + 1
expected fail + 1 skipped / 467 files + 1 skipped**. E2E mortgage 1/1
(empty + debt planner + not 0%). No `prisma/` diff.

**Gate read.** Pushed `d8947b10`. CI run **32877068082** = SUCCESS
(12m49s, first attempt). Vercel `dpl_4vGF6F53pMGuEDN8iFmU9WjgdZxW`
READY on that sha. Live proof **10/10 PASS**
(`scripts/p17-live-deploy-check.mjs`).

**Next.** PAW expected-NW lens. Wave 0 ops remain owner-blocked.

## 2026-08-25 — Reports interest & fees YTD (DECISIONS #516)

**Picked up.** Owner: "consume all readme files and continue building
this out." #515 closed P1.5. Ranked next: Reports interest & fees YTD.

**Closed (engine + /reports).** Pure `interestFeesYtd`: existing spend
basis, four fee/interest leaves, YTD window Jan→today. Illustration =
YTD paid as one year's amount (`/12` × 360), today's money. Copy names
only contributing leaves. Demo empty. Ask deferred.

**Critic (fresh context): cycle 1 FAIL 1 P1** (all four leaves after
the dollars). **Cycle 2 PASS — 0 P0, 0 P1.**

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0,
probes tsc 0, eslint 0, `next build` clean). Unit **7,664 passed + 1
expected fail + 1 skipped / 464 files + 1 skipped**. E2E reports 1/1
(interest-fees-ytd-card + empty + four names + year). No `prisma/`
diff.

**Gate read.** Pushed `75a1c181`. CI run **32871751508** = FAILURE
(13m13s): `[mobile-380] category-drilldown` "tapping the category BAR"
timed out — the YTD tile sat between the chart and the category list
and pushed the first bar behind the 380px bottom nav. Fix: tile after
the pair + `scrollIntoViewIfNeeded` before the bar `mouse.click`.
Local re-proof (fresh server, `CI=1`): category-drilldown:232 1/1;
reports.spec 1/1. Fix pushed `5e4d797b`. CI run **32874042910** =
SUCCESS (~15m13s). Vercel `dpl_Fs2tdRutPQPawSNxyTFeotGJj9HC` READY.
Live proof **14/14 PASS** (`scripts/p16-live-deploy-check.mjs`).

**Next.** Mortgage early-payoff; PAW. Wave 0 ops remain owner-blocked.

## 2026-08-25 — P1.5 investing ladder + fee-drag (DECISIONS #515)

**Picked up.** Owner: "consume all readme files and continue. we are
trying to ship this product. all gaps from simplifi and mint should be
closed." #514 closed P1.4. Ranked next: P1.5 fee-drag / investing ladder.

**Closed (engine + /coach).** Pure `feeDrag`: 1% of today's portfolio as
a level monthly leak for 30 years; `opportunityFVCents` +
`opportunityValueTodayCents`. Ladder is a lens (match unknown). Copy
names monthly leak, grow-then-deflate, and trails-contributions.
`InvestingLadderCard` after next-dollar. Ask deferred. Demo $68,822.18.

**Critic (fresh context): cycle 1 FAIL 2 P1** (trails unexplained;
mechanism unnamed). **Cycle 2 PASS — 0 P0, 0 P1.**

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0,
probes tsc 0, eslint 0, `next build` clean). Unit **7,624 passed + 1
expected fail + 1 skipped / 462 files + 1 skipped**. E2E phase3-coach
1/1 (investing-ladder-card + $68,822.18 + $118.33/mo + grow-then-deflate).
No `prisma/` diff.

**Gate read.** Pushed `6dda7ed6`. CI run **32866291224** = SUCCESS
(13m41s, first attempt). Vercel `dpl_s4hLu1aadKH8rcq7j9mTCvn2PWUB`
READY on that sha. Live proof **17/17 PASS**
(`scripts/p15-live-deploy-check.mjs`).

**Next.** Reports interest & fees YTD; mortgage early-payoff; PAW.
Wave 0 ops remain owner-blocked.

## 2026-08-25 — P1.4 income lever (DECISIONS #514)

**Picked up.** Owner: "continue." #513 closed W.6(c). Ranked next: P1.4
raise → FI delta slider (Sethi income side).

**Closed (engine + /coach FI card).** Pure `incomeLever`: annual raise →
monthly via `roundHalfAwayFromZero(/12)`; extra savings = current
`savingsRateBps` × monthly raise; same `monthsToFI` walk and real rate as
the FI card; FI target unchanged. Non-positive rate saves $0 of the raise.
`COACH_COPY.incomeLever` names the hybrid and the N-month average rate.
Slider default $10,000/yr. Ask deferred.

**Critic (fresh context): cycle 1 FAIL 2 P1** (lifestyle-frozen overclaim;
"current" vs savings slider). **Cycle 2 PASS — 0 P0, 0 P1.**

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0,
probes tsc 0, eslint 0, `next build` clean). Unit **7,585 passed + 1
expected fail + 1 skipped / 460 files + 1 skipped**. E2E phase3-coach
1/1 (income-lever slider + $10k sooner + idle at $0). No `prisma/` diff.

**Gate read.** Pushed `12767fff`. CI run **32853208505** = SUCCESS
(14m53s, first attempt). Vercel `dpl_FbPCBtWKEJfaShGqZQu15FZJBjmk`
READY on that sha. Live proof **13/13 PASS**
(`scripts/p14-live-deploy-check.mjs`).

**Next.** P1.5 investing ladder / fee-drag; Reports interest & fees YTD;
mortgage early-payoff; PAW. Wave 0 ops remain owner-blocked.

## 2026-08-24 — W.6(c) category fulfillment curve (DECISIONS #513)

**Picked up.** Owner: "consume all readme files and continue. we want to get
the app to production." #512 closed W.6(d). Ranked next: W.6(c) YMOYL
fulfillment — life-energy per category over time.

**Closed (engine + /coach).** Pure `fulfillmentByCategory`: discretionary
outflows across complete months → hours via `hoursOfWork`; top 5 by spend;
`categoryCount` for honest truncation; trend = creep's median half-split on
cents. `COACH_COPY.fulfillment*` owns subtitle/row/spark/omitted/footnote.
`/coach` `FulfillmentCard` beside LifeEnergyCard. Ask deferred.

**Critic (fresh context): cycle 1 FAIL 3 P1** (subtitle "each" over-claim;
aria-hidden unlabeled spark; unstated median trend). **Cycle 2 PASS —
0 P0, 0 P1.** P2 polish: omitted-line wording + unconditional F7 truncation
lock.

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0,
probes tsc 0, eslint 0, `next build` clean). Unit **7,550 passed + 1
expected fail + 1 skipped / 458 files + 1 skipped**. E2E phase3-coach
1/1. No `prisma/` diff.

**Gate read.** Pushed `60b77891`. CI run **32807185604** = SUCCESS
(13m10s, first attempt). Vercel `dpl_E36kPYRxae3rgGT2eqaX5Pr9MQct`
READY on that sha. Live proof **13/13 PASS**
(`scripts/w6c-live-deploy-check.mjs`).

**Next.** P1.4 / P1.5 / Reports interest & fees YTD. Wave 0 ops (Sentry,
cron fire, Neon PITR, Plaid institution registration) remain
owner-blocked.

## 2026-08-24 — W.6(d) drawdown on FI date (DECISIONS #512)

**Picked up.** Owner: "read all readme files and continue." #511 closed W.6(b)
Ask P1. Ranked next: W.6(d) Housel volatility line — what a 30% portfolio
drop does to the FI date (sibling to W.1 return sensitivity, not Ask this
slice).

**Closed (engine + /coach).** Pure `drawdownCounterfactual`: one-time 30%
portfolio shock, same `monthsToFI` walk and real `projectionReturnBps`
as the FI card. `COACH_COPY.drawdownCounterfactual` owns the sentence;
honest null when nothing moves. `/coach` FI card: `<details
data-testid="fi-drawdown">` beside the behavioral volatility note. Demo:
$142k brokerage shocked → monthsLater **45** (baseline 484 → shocked 529).

**Critic (Bugbot, fresh context): PASS — 0 P0, 0 P1.**

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0,
probes tsc 0, eslint 0, `next build` clean). Unit **7,519 passed + 1
expected fail + 1 skipped / 456 files + 1 skipped**. E2E phase3-coach
1/1 (drawdown disclosure). No `prisma/` diff.

**Gate read.** Pushed `44540eeb` to `origin/main`. GitHub Actions
`verify` = **SUCCESS** (run **32804014980**, first attempt). Vercel:
Production deployment `dpl_jA8MrZtwSGx4a2nAwiJgDKGttbge`, READY, sha
`44540eeb`. Live proof `node scripts/w6d-live-deploy-check.mjs` →
**9/9 PASS**: `fi-drawdown` on www.aimplifi.app/coach; 30% sentence
("about 2 years 1 month later" on production `today`).

**Next.** W.6(c) category fulfillment curve; P1.4 / P1.5; Reports interest
& fees YTD.

## 2026-08-24 — W.6(b) Ask P1: `should I` is not the ranking proxy (DECISIONS #511)

**Picked up.** Owner: "continue" after #510's human gate. Recorded P1:
`"How much should I pay off my cards before I can invest?"` routed
`next_dollar` because `\bshould i\b` + `\bbefore\b` was the ranking
frame. Money engine not reopened.

**Closed (Ask routing).** `hasNextDollarContrast` is constituency-aware:
quantity/horizon stems (`how much` / `how long` / `when will`) refuse
all contrast; purpose (`before I can` / `I'm able` / `so I can` / `so I
could` / `so that I can`) vs `or`/`vs`/`instead of` is by index (op
before purpose = ranking; op after = purpose object); bare `before
investing` stays ranking. `next_dollar` runs before `fi_status`;
retirement inside a purpose adjunct is not the FI date. Canonical
`"Should I pay off debt or invest?"` / `"Do I need to pay off debt or
invest?"` stay ranking.

**Critic (4 cycles this slice): FAIL — 0 P0.** C1: 2 P1 (quantity+`or`;
`I'm able`). C2: 1 P1 (`or` inside purpose). C3: 2 P1 (matrix `or`
before purpose; `retire` adjunct → `fi_status`). C4: 3 P1 (FI still
stole declined-ranking+retire; `do I need to` over-fired on ranking;
`so I could` / `so that I can`). All eight executed and locked. No 5th
critic (budget). Not certified as a critic pass.

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0,
probes tsc 0, eslint 0, `next build` clean). Unit **7,502 passed + 1
expected fail + 1 skipped / 454 files + 1 skipped**. E2E Ask
next-dollar + P1 string 2/2 (`npx playwright test tests/e2e/ask.spec.ts
-g "next dollar|before I can invest"`). No `prisma/` diff.

**Gate read.** Pushed `10638c4d` + `7a96ae96` to `origin/main`. GitHub
Actions `verify` = **SUCCESS** (run **32796272090**, first attempt, job
15m43s, https://github.com/meleesciony/Aimplifi/actions/runs/32796272090).
Vercel: Production deployment `6074409688`, "Deployment has completed",
sha `7a96ae96`. Live proof `node scripts/w6b-live-deploy-check.mjs` →
**9/9 PASS**: Coach + Ask ranking share "Next extra dollar: investing"
(Auto Loan 6.49%, default 7.00% nominal); P1 string on a fresh Ask turn
is cash-needed (`You need $5,412.33 by Jun 15, 2026 to pay your cards
in full`) and is not the ranking — a pre-#511 deploy cannot satisfy
that discriminator.

**Next.** W.6(d) drawdown / W.6(c) fulfillment / P1.4 / P1.5.

## 2026-08-24 — W.6(b) next extra dollar, ranked from rates on file (DECISIONS #510)

**Picked up.** Owner: "continue after reading all readme files." P.1
closed at #508. Ranked leftover: W.6(b) marginal-dollar order.

**Closed (engine + /coach + canonical Ask).** Pure `nextDollar`: revolving
APR > nominal return → uncaptured match → runway < 3 months → installment
APR > return → invest. Null APR skipped. CREDIT revolving only if past
due. Demo: investing, Auto Loan 6.49% under our default 7.00%.

**Critic (4 cycles): FAIL — 0 P0, 1 P1 open, budget exhausted.** Money
ranking had 0 P0. Residual Ask P1: "How much should I pay off my cards
before I can invest?" still routes `next_dollar`. Human gate. Recorded
in STATUS.

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0,
probes tsc 0, eslint 0, `next build` clean). Unit **7,497 passed + 1
expected fail + 1 skipped / 454 files + 1 skipped**. E2E Coach + Ask
green (`npx playwright test tests/e2e/phase3-coach.spec.ts tests/e2e/ask.spec.ts`).
No `prisma/` diff.

**Gate read.** Shipped in the same push as #511 (`10638c4d` + `7a96ae96`).
GitHub Actions `verify` SUCCESS (run **32796272090**). Vercel production
`6074409688` completed. Live proof 9/9 (ranking + P1).

**Next.** Human gate on the Ask P1 closed in #511. Then W.6(d) drawdown /
W.6(c) fulfillment / P1.4 / P1.5. Match % collection is a later settings
slice.

## 2026-08-24 — /coach-card radiation of the cut FI + radar sentences (DECISIONS #508)

**Picked up.** Owner: "continue. read all readme files including graph."
#507 shipped the radar half. Remaining on P.1: put the same sentences on
the /coach opportunities card.

**Closed (P.1 row).** `getCoachData({ cutImpact: true })` computes both
engine results (FI at `projectionReturnBps`, radar re-walk, no
`cardDuplicates`) and attaches them. /coach and Ask both render through
`COACH_COPY`. Ask no longer walks locally. Dashboard/digest omit the flag.
Demo: FI sentence present ($23,661.00 / about $78.87 a month, part
estimated); radar silent.

**Critic (fresh context, read-only): PASS — 0 P0, 0 P1, 4 P2 carried.**
Radar grounding names Home's Cash flow radar; list title vs unique-merchant
count; positive radar paint on /coach untested (demo never moves); Card
overflow-hidden vs document overflow gate.

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0,
probes tsc 0, eslint 0, `next build` clean). Unit **7,421 passed + 1
expected fail + 1 skipped / 451 files + 1 skipped**. E2E **365 passed + 1
flaky-on-retry** (`combine-connections.spec.ts:67`, pre-existing, untouched;
the P.1 phase3-coach + ask.spec + empty-coach auth assertions in the
passing set). `VERIFY_E2E` did not reach bash from this PowerShell env;
Playwright was run as `npx playwright test` after the green verify build.
No `prisma/` diff.

**Gate read.** Owner standing #509: commit + push at every slice end.
Pushed `43abed40` + `4a2a0f63` (the #509 standing-rule + live-check
extension) to `origin/main`. GitHub Actions `verify` = **SUCCESS** (run
**32777002267**, first attempt, job 13m17s,
https://github.com/meleesciony/Aimplifi/actions/runs/32777002267). Vercel:
Production deployment `6071341859`, "Deployment has completed", sha
`4a2a0f63`. Live proof `node scripts/ask-what-to-cut-live-check.mjs` →
**13/13 PASS**: Ask still lists LA Fitness $34.99 first, FI movement
present with pinned dollars ($23,661.00 / about $78.87 a month, part
estimated, 12 months sooner on production `today`), honest-null radar
absent on Ask AND on /coach, #507 bundle marker present, AND
`opportunities-cut-fi` is on the live /coach card with the same pinned
dollars — the discriminator a pre-#508 deploy cannot satisfy.

**Next.** Ranked lane: W.6(b) marginal-dollar order, W.6(d) drawdown on FI
date, W.6(c) category fulfillment curve, P1.4 income lever, P1.5 fee-drag
FV, Reports interest & fees YTD, mortgage early-payoff, PAW. Spending-plan
cut re-projection is deferred (named in #508, not this row).

## 2026-08-24 — Ask "what should I cut?" radar/cash-dip re-walk (DECISIONS #507)

**Picked up.** Owner: "read readme files and continue." #506 shipped the FI
half. This is P.1's remaining engine piece: filter the cut series' scheduled
rows out of `radarFromSnapshot`, speak only if the dip/cover moves.

**Closed (Ask radar half).** New pure `src/lib/engine/radar/cut-counterfactual.ts`:
`applyCutsToScheduled` (per-merchant MAX, income skipped, `negotiable-bill`
scaled onto cadence so a $20/mo estimate cannot cancel a weekly series) +
`cutRadarCounterfactual` (improvement-only on dip date and rounded cover).
`COACH_COPY.cutRadarCounterfactual` owns the sentence AND the honest null.
Wired in the `what_to_cut` server case as two `radarFromSnapshot` walks on
the same snapshot. Demo: the four opportunities are card-billed, checking
scheduled is payroll/rent/savings — the walk does not move, and the sentence
stays off. A checking series that does match is locked in the unit harness.

**Critic (fresh context, read-only): cycle 1 FAIL 2 P1; cycle 2 PASS — 0 P0,
0 P1, 7 P2 carried.** P1-1 weekly $20 cancel and P1-2 "stop hitting" executed
in-slice.

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0,
probes tsc 0, eslint 0, `next build` clean). Unit **7,416 passed + 1 expected
fail + 1 skipped / 450 files + 1 skipped**. E2E **366 passed** (`npx
playwright test` this session, 4.0m; P.1 ask.spec in the 29/29 Ask file).
No `prisma/` diff.

**Gate read.** Commit `f66debf9` → pushed → GitHub Actions `verify` =
**SUCCESS** (run **32771238086**, first attempt, job 12m38s,
https://github.com/meleesciony/Aimplifi/actions/runs/32771238086). Vercel:
Production deployment `6070344963`, "Deployment has completed", sha
`f66debf9`. Live proof `node scripts/ask-what-to-cut-live-check.mjs` →
**9/9 PASS**: demo Ask still lists LA Fitness $34.99 first, FI movement
present with pinned dollars ($23,661.00 / about $78.87 a month, part
estimated, 12 months sooner on production `today`), no "this card"/"below",
honest-null radar sentence absent on the demo answer, AND the #507
assumption copy ("an estimated saving only shrinks it") is in the live
/coach client bundles (1 chunk) — the discriminator a pre-#507 deploy
cannot satisfy. First live-check attempt failed the Ask hydration wait
(value never stuck in 6×500ms); the probe now waits `load` and retries 12
times.

**Next.** /coach-card radiation of the FI + radar sentences, or the ranked
lane: W.6(b)(c)(d), P1.4/P1.5, Reports interest & fees YTD, mortgage
early-payoff, PAW.

## 2026-08-24 — Ask "what should I cut?" FI counterfactual (DECISIONS #506)

**Picked up.** The coach lane's top-ranked leftover (P.1's counterfactual
half), with Flash-lane content exhausted at #505. Explorer pass first: the
re-walk precedent lives in `src/server/radar.ts` (filter the input array,
re-call the pure engine); the FI counterfactual needs no harness —
`monthsToFI` takes the changed scalars directly; `Opportunity` carries no
series identity, so the cut sum dedupes per merchant by its largest row.

**Closed (Ask half).** New pure `src/lib/engine/fi/counterfactual.ts`:
`cutCounterfactual` re-runs the standing `monthsToFI` walk at
`coach.fi.projectionReturnBps` (the W.2 real-rate rule) with the cut applied
to BOTH sides — the FI target drops (spending that stops leaves the expense
basis; $1/mo = $300 at 4%) and the pace rises by the cut. Honest null lives
in the copy's one author (`COACH_COPY.cutCounterfactual` → null when nothing
moves); `newlyReachable` is its own qualitative branch (a null baseline has
no date to subtract). Demo: all 4 opportunities, about $78.87/mo (part
estimated) → FI about 11 months sooner, the number $23,661.00 lower.
`test_regression__p1_cut_does_not_invent_fi_movement` REPLACED (contract
change the task row mandates) by movement-from-the-engine + two
honest-silence locks.

**Critic (fresh context, read-only): PASS — 0 P0, 0 P1, 6 P2.** Hand-verified
the 0% anchors on paper AND re-simulated a 5%-real case independently — exact
match. F1 permanence clause, F3 years+months phrasing, F4 estimate-qualified
total, F6 unique-merchant count executed in-slice; F2 ledger drift fixed; F5
(facts remainder sum vs deduped total) recorded open with rationale in #506.

**Gate (final tree).** `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY
GREEN (tsc 0, probes tsc 0, eslint 0, `next build` clean). Unit **7,376
passed + 1 expected fail + 1 skipped / 449 files + 1 skipped**. E2E **365
passed + 1 flaky-on-retry** (`category-rename.spec.ts:110`, rotating load
flake, passed on retry; the P.1 ask.spec test in the passing set). Two red
gates en route, both mine and both recorded: a tsc error in the new
span-phrasing test (missing arg — vitest doesn't typecheck), and the e2e
asserting the pre-fix copy's capitalization (the fix-edge re-gate caught it —
REGRESSION_LEDGER row). No `prisma/` diff.

**Gate read.** Commit `97619d48` → pushed → GitHub Actions `verify` =
**SUCCESS** (run **32756202009**, first attempt,
https://github.com/meleesciony/Aimplifi/actions/runs/32756202009). Vercel:
READY, production, aliased to `www.aimplifi.app`
(`dpl_HcFkABKoHjHQEK7zhuzwxRYGoip5`, created 2026-08-24 13:21:59 EDT — the
push instant). Live proof `node scripts/ask-what-to-cut-live-check.mjs` →
**7/7 PASS**: demo Ask still lists LA Fitness $34.99 first, the movement
sentence is present with the pinned dollars ($23,661.00 / about $78.87 a
month, part of it estimated), assumptions inline, no "this card"/"below".
The first live run failed the month-span pin: local seed (asOf 2026-06-10)
is **11** months sooner (wiring test: baseline 297 → cut 286); production
printed **12** (`today` is not the seed asOf). The probe now matches the
e2e regex for the span and pins only the seed-stable dollar figures.

**Next.** P.1's remaining piece: the radar/cash-dip re-walk ("your July dip
disappears") — filter the cut series' scheduled rows out of
`radarFromSnapshot`'s input and speak only if the dip/cover moves. Then the
ranked lane: W.6(b) marginal-dollar order, W.6(d) drawdown on FI date,
W.6(c) category fulfillment curve, P1.4 income lever, P1.5 fee-drag FV,
Reports interest & fees YTD, mortgage early-payoff, PAW expected-NW lens.

## 2026-08-23 — Ask `rich_life` intent (DECISIONS #505)

**Picked up.** The plan's Ask row last gate, unblocked by #504 the same day.
Scope from the explorer pass: stay_wealthy is the intent-slice template; the
Ask copy bans ("this card"/"below") are load-bearing; the follow-ups
`sampleIntent` switch has no default (a new kind without a case breaks the
suite — the hard gate); `validateIntent`'s default-null silently kills the
LLM path if the case is forgotten (the silent trap).

**Closed.** Registered like stay_wealthy: kind union + kinds list,
deterministic guard (the possessive "my" required — bare "rich life" is
advice-shaped; same amount/date/store abstentions so "save $X for my rich
life" stays wealth_target), parseAssistantQuery wiring after the
single-signal routes, validateIntent closed kind, LLM bullet + intentFromKind
case, server case via getCoachData (the #504 read-leg fence gives the demo
the honest not-written branch), follow-ups chips that all parse non-unknown,
suggestion + capability copy. `answerRichLife` echoes the stored value
verbatim (never a second author; the /coach one-author rule), not-written
branch names the empty state and points at Settings (the retire-at-age
precedent, not answerUnknown).

**Locked.** `assistant-rich-life.test.ts` 11 tests (routing, abstention
majority, validateIntent, intentFromKind, both answer branches, copy bans);
assistant-intent routing rows; follow-ups sampleIntent case; suggestions
17→18 lock. Ask e2e: demo asks "What is my rich life?" → not-written branch
+ /settings source + copy bans.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0,
probes tsc 0, eslint 0, build). Unit **7,342 passed + 1 expected fail + 1
skipped / 448 files + 1 skipped**. E2E **365 passed + 1 flaky-on-retry**
(transactions.spec.ts:295 — documented K.10 class, untouched). No `prisma/`
diff. No critic: intent-slice lane precedent — the abstention suite + the
follow-ups hard gate are the verifier.

**Gate read.** Commit `05943a99` → pushed → GitHub Actions `verify` =
**SUCCESS** (run **32620513291**, first attempt). Vercel: success,
"Deployment has completed" (`7K3cbTDcHMMoqWFD1iSMuXVXV9LK`). Live proof
`node scripts/ask-rich-life-live-check.mjs` → **5/5 PASS**: demo asks the
question, gets the rich_life not-written branch (headline "I don't have your
Rich Life line yet."), Settings source, no "this card"/"below", and —
anti-vacuity — the answer is NOT the pre-#505 unknown answer (server-only
copy cannot be bundle-probed; the answer itself is the discriminator).
One docs-chain gate DID catch me: the record commit `ed0700be` ran red on
eslint — the DOM-side discriminator replacement orphaned the MARKER const
in the live-check script (an edit made AFTER the last local gate). Fixed in
a follow-up commit; the run id 32621037595 + the one finding (unused
variable at scripts/ask-rich-life-live-check.mjs:23) are recorded here.

**Next.** With the Ask row fully closed, the coach lane's ranked leftovers are
the Opus + hostile-critic items: P.1 counterfactual re-projection,
W.6(b) marginal-dollar order, W.6(d) drawdown on FI date, W.6(c) category
fulfillment curve, mortgage early-payoff, Reports interest & fees YTD,
P1.4 income lever, P1.5 fee-drag FV, PAW expected-NW lens. Flash-lane coach
content is exhausted.

## 2026-08-23 — P1.3 "My Rich Life" vision line (DECISIONS #504)

**Picked up.** Resume from the C14 close: gate read, Vercel READY, live proof
5/5 recorded and shipped (`0f551b09`, docs-chain CI success 32617479692).
Then the next ranked Flash-lane leftover: P1.3 Rich Life one-liner.

**Shipped.** `User.richLifeVision String?` (additive nullable), /settings card
("My Rich Life", one freeform line, shared-account note on demo), echo atop
/coach (`RichLifeEcho`, only when set), `COACH_COPY.richLifeHeader` registered
in ALL_STRINGS, Ask `rich_life` intent LEFT OUT (its own slice, per the plan
row). Copy differences from the plan row are decisioned in #504: the sentence
is scoped to "every number about your money below" (the bare template was
falsified by the value-receipts tally — critic F2), input has NO maxLength so
the over-cap reject is reachable (F1), and `hasVision` keys the success message
so a clear doesn't claim the coach opens with the line (F5).

**Two fences, both legs.** Write: `updateRichLife` refuses demo first thing
(DEMO_ENTRY_BLOCKED); settings hides the form for demo. Read: `getCoachData`
returns null for the demo even when the column holds a value (no single
load-bearing call site — the #226 shape); locked by planting a value on the
demo row in `ai-demo-fence.test.ts` (restored after), plus a
`shared-demo-fences` action lock. Pure normalize (`rich-life.ts`): separators
REPLACED with a space (never dropped — dropping joins the words), trim,
empty→null, 120-char REJECT with named limit; `/\p{Cc}\p{Zl}\p{Zp}/gu`.

**Critic (fresh context, read-only): 0 P0, 3 P1, 5 P2 — all executed.**
F1 maxLength dead-path; F2 unscoped claim; F3 write-leg-only fence (the P1s);
F4 break-words at 380px; F5 message state keys; F6 U+2028/29/85 + replace-not-
drop; F7 role="status"; F8 fence lock rows. Added lesson
(`file-tools-unescape-backslash-u.md`): Write/Edit decoded backslash-u escapes
into literal NUL/U+2028 bytes twice this slice — fixed via ASCII-only property
escapes + byte probes.

**Gate (final tree).** `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN
(tsc 0, probes tsc 0, eslint 0, `next build` clean). Unit **7,329 passed + 1
expected fail + 1 skipped / 447 files + 1 skipped**. E2E **365 passed, 0 flaky
(5.0m)** — includes `rich-life.spec.ts` 2/2 (real-user write path then demo
fence). Circle 1 gate (pre-critic) was 7,325 / 361+4-flaky. `prisma/` diff on
push = this one additive nullable column (deploy runs `prisma db push` by
design; existing rows unaffected: null).

**Gate read.** Commit `87bdbca1` → pushed → GitHub Actions `verify` =
**SUCCESS** (run **32619400742**, first attempt, exit 0 via
`scripts/ci-status.sh`). Vercel: success, "Deployment has completed"
(`6dUGsKaymtcAE2w8vkt6xtSqGPgw`, aliased to `www.aimplifi.app`). Live proof
`node scripts/p13-live-deploy-check.mjs` → **5/5 PASS**: demo settings shows
the My Rich Life card + shared-account note, no input, no /coach echo, and the
scoped P1.3 sentence found in the live /coach client bundles (a pre-#504
deploy has the string nowhere). Live-check script hardened: the demo button
is type="submit", so a pre-hydration click natively submits to /sign-in (seen
twice today — C14 and P1.3 runs); `signInDemo` now retries through '/'.

**Next.** Ask `rich_life` intent (now unblocked — reads the same
`getCoachData` path). Opus+critic lane: P.1 counterfactual, W.6(b)(c)(d),
P1.4, P1.5, Reports interest & fees YTD.

## 2026-08-23 — C14 past-enough Coast-FI framing on the FI card (DECISIONS #503)

**Picked up.** Owner: continue. #502 shipped. Ranked Flash-lane
leftovers: #1 P1.1 dialTag note (or skip), #2 Coast past-enough
give/spend copy.

**Closed.** P1.1 closed as a **skip with evidence** — badge
("Your biggest lever" under the #1 opportunity), `dialTag` on /trends
movers, and the `moneyDials` "spend there proudly; the engine only hunts
savings everywhere else" note on the /coach opportunities header are all
shipped; the "note" delta is the same rule already stated at list level.
Then the C14 framing: new `COACH_COPY.pastEnoughCoast` — "Past enough,
many people turn the dial toward experiences and giving — the
compounding is already doing the work. A lens, not a judgment." —
rendered under the Coast line only when `coastIsCoast`. The plan's
"We surface that the same as any spending" was deliberately NOT said
(giving categories are per-user visible; a claim about app surfacing
would be false for a reader who hides them).

**Left alone.** P1.3 Rich Life (needs a stored string); P.1
counterfactual; W.6(b)(c)(d); P1.4/P1.5; Reports interest & fees YTD.

**Locked.** `tests/unit/past-enough-coast-render.test.tsx` (shows on
coastIsCoast; silent when not — with and without a coast pace). e2e
`phase3-coach.spec.ts` locks the demo's not-coast branch: line absent
AND coast line names the monthly pace (one predicate, two assertions).

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN (tsc 0, probes tsc 0,
eslint 0, `next build` clean). Unit **7,314 passed + 1 expected fail +
1 skipped / 445 files + 1 skipped**. Coach e2e **1/1 (12.0s)**. No
`prisma/` diff. First full-suite run was red on 8 tests / 7 files
(`database is locked`/`disk I/O error` cascade — all files pass isolated
95/95; rerun green; lesson +
`docs/lessons/unit-suite-sqlite-cascade-flake.md`); eslint had caught one
unused const in the new live-check script (now used).

**Gate read.** GitHub Actions `verify` on `ccac7a24` = **SUCCESS** (push
run **32616862626**, exit 0 via `scripts/ci-status.sh`). Vercel:
success, "Deployment has completed"
(`3G2nr7Wk4uDv3jhVUXq47xnbWjZi`, aliased to `www.aimplifi.app`). Live
proof `node scripts/c14-past-enough-live-check.mjs` → **5/5 PASS**:
demo sign-in, #502 reflection still renders, demo's not-coast branch
(pace line names, past-enough absent), and the C14 sentence found in
the live /coach client bundles — a pre-#503 deploy has the string
nowhere, so this proves the sha, not just a 200. First live-check run
tripped a pre-hydration click on the submit-type demo button (native
POST → /sign-in); rerun clean — harness, not product.

**Next.** Owner review; P1.3 Rich Life one-liner (or route P.1 /
W.6(b)(c)(d) to Opus + hostile critic).

## 2026-08-23 — P2.2 memory-dividend line on the life-energy card (DECISIONS #502)

**Picked up.** Owner: continue. #500 shipped. P.1 remaining half and
W.6(b)(c)(d) are new money engines (off this lane). P2.2 (memory-dividend
line on LifeEnergyCard, buys outside the dials only) was the queued
content leftover.

**Closed.** `COACH_COPY.lifeEnergyReflection` under the life-energy
list, rendered only when at least one listed purchase is outside the
declared money dials. `src/server/coach.ts` flags each item with the
same `categoryMatchesMoneyDial` helper W.6(a) uses (uncategorized =
outside, never silently blessed); an all-dial list stays silent.
Registered in the hand-maintained ALL_STRINGS guardrail scan (#92 rule).

**Left alone.** P.1 counterfactual; W.6(b)(c)(d); P1.3/P1.4/P1.5; P1.1
dialTag note.

**Locked.** `tests/unit/life-energy-reflection-render.test.tsx` (shows
on a non-dial buy among dials; silent when all are dials; silent on
empty). e2e `phase3-coach.spec.ts` asserts the line on demo — rent is
not a travel/dining dial.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN (tsc 0, eslint 0,
`next build` clean). Unit **7,309 passed + 1 expected fail + 1 skipped /
444 files + 1 skipped** (`npx vitest run`). Coach e2e **1/1**
(`npx playwright test tests/e2e/phase3-coach.spec.ts`). No `prisma/` diff.
First e2e attempt failed on a stale `.next` — `next start` serves the
last build; the rebuild in the gate was the fix.

**Gate read.** GitHub Actions `verify` on `4831db81` = SUCCESS (push run
**32614787763**). Vercel production `dpl_A33DYuVT7StVHvxRNBoAj3iw4LWP`
READY, created on the push, aliased to `www.aimplifi.app`. Live proof
`node scripts/p22-live-deploy-check.mjs` → **4/4 PASS**: demo `/coach`
prints the reflection (the element cannot exist on a pre-#502 build).
Commit/push were done by the owner mid-session (`cea4e081` #501 +
`4831db81` #502); the "Gate read: NOT DONE" line this replaces was
written before that.

**Next.** P1.1 dialTag note (or leave as skip), Coast past-enough copy,
or P.1 / W.6(b)(c)(d) with a hostile critic.

## 2026-08-22 — Build docs reframed as graph engineering (DECISIONS #501)

**Picked up.** Owner task file: rewrite README + all build/instruction/agent files
around graph engineering, elevating the loop discipline rather than discarding it.

**Closed.** New `GRAPH.md` (build-graph contract: node vocabulary, edge payloads,
ledger state schema, per-slice topology, gate semantics, CLI success criteria,
observability, migration note). New `GRAPH_ENGINEERING.md` (generic method, sits
above LOOP). `LOOP_ENGINEERING.md` rewritten as the node-internal discipline (12
rules, self-healing loop, PASS/FAIL all kept, graph roles annotated). `CLAUDE.md`
build loop → build graph (same steps; 4-cycle cap = retry budget on the critic edge;
model handoff → per-node-type model routing). `AGENTS.md` canon now GRAPH_ENGINEERING
→ LOOP → GRAPH → CLAUDE. README gains a build-graph section + repo-map rows. Framing
edits: CRITIC_RUBRIC (verifier node), PHASES intro, STATUS preamble, verify.sh
header, TASKS header. DECISIONS #501 recorded; index reindexed via ledger.ts.

**Left alone.** All product code, tests, gates, ledgers' historical entries, SPEC.md
(historical), docs/DEPLOY.md (operational runbook — no loop content to reframe).

**Locked.** N/A — docs-only slice, no behavior to lock.

**Gate.** `npx tsx scripts/docs-lint.ts` → zero findings in any created/rewritten
file (findings exist only in stale `.claude/worktrees/agent-*` copies, pre-existing).
Full `bash scripts/verify.sh` NOT run — docs-only change on an unchanged tree;
recorded as not-run, not claimed. No push; nothing shipped.

**Next.** Owner review of the reframe; the stale `.claude/worktrees/agent-*` dirs
tripping docs-lint may want pruning.

**Addendum (same session).** Owner directive: token efficiency is paramount — graphs
ramp token usage. Encoded as GRAPH_ENGINEERING.md principle 10 + a fan-out rule
(no node without a job a cheaper shape can't do; fan-out only when cheaper-tier /
context-offload / wall-clock math pays; sequential loop is the default shape);
GRAPH.md §4/§8 fan-out clauses tightened to match; CLAUDE.md model-routing section
gained the fan-out-vs-budget rule; AGENTS.md canon notes the reading cost (GRAPH.md
§4–§5 are the operational core on repeat sessions). docs-lint re-run: clean.

## 2026-08-21 — P1.2 staying-wealthy row composes three Coach signals (DECISIONS #500)

**Picked up.** Owner: continue. #499 shipped. P.1 remaining half and
W.6(b)(c)(d) are new money engines (off this lane). P1.2 (compose
runway + card-cleared + creep) was the queued leftover.

**Closed.** Compact `/coach` row under the FI grid. Same three engines
the habit-streaks / runway / creep cards already run.
`composeStayingWealthy` — each checkmark is that signal. Framing does
not list all three as true. Ask `stay_wealthy` phrases the same row.
Copy does not say "this card" or "below". Named store/category is
`unknown`; amount declines; a calendar window is `unknown`. Single-signal
questions stay their routes.

**Left alone.** P.1 counterfactual; W.6(b)(c)(d); P1.3/P1.4/P1.5; P1.1
dialTag; P2.2.

**Locked.** `staying-wealthy.test.ts` + `assistant-stay-wealthy.test.ts`
regressions; e2e Ask vs Coach row; coach page vs runway/creep titles.

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0, eslint 0, unit
**7,304 passed + 1 expected fail + 1 skipped / 443 files + 1 skipped**,
`next build` clean. Ask stay-wealthy e2e **1/1**; coach page e2e **1/1**.
No `prisma/` diff.

**Gate read.** GitHub Actions `verify` on `1ccd03ea` = SUCCESS
(push run **32549680184**, attempt 1, job **12m45s**, full
`VERIFY_E2E`). Vercel production `dpl_CKBqBMT7ifJo6KPGKyPbFv6RnfGh`
READY on the same sha, aliased to `www.aimplifi.app`. Live Coach
(demo) shows the staying-wealthy row (cards clear / 5.7-month cushion /
spending outpaced income). Live Ask shows the chip "Am I staying
wealthy?" and answers with source `/coach`.

**Next.** P1.1 dialTag note, P2.2 memory-dividend line, or P.1 / W.6(b)(c)(d)
with a hostile critic.

## 2026-08-21 — P.2 reconciled; Ask phrases the conscious-spending buckets (DECISIONS #499)

**Picked up.** Owner: continue. #497 shipped; #498 (runway) landed on
main during this slice. P.1 remaining half and W.6(b)(c)(d) are new
money engines (off this lane). P.2 (stale coach-principles plan) was
the queued audit.

**Closed.** Plan §0 overlay. Ask `conscious_spending` phrases the
`/budgets` strip (`mapToConsciousBuckets` + `COACH_COPY.consciousSpending`).
Copy does not say "this card" or "below". Named store/category is
`unknown`; amount declines; a calendar other than "this month" is
`unknown`. Guilt-free leftover dollars stay `safe_to_spend`.

**Left alone.** P.1 counterfactual; W.6(b)(c)(d); P1.2/P1.3/P1.4/P1.5.

**Locked.** `assistant-conscious-spending.test.ts` four regressions;
e2e Ask vs Spending caption.

**Gate.** Rebased onto #498 (`55a0c937`). `bash scripts/verify.sh` →
tsc 0, probes tsc 0, eslint 0, unit **7,260 passed + 1 expected fail +
1 skipped / 441 files + 1 skipped**, `next build` clean. Ask buckets
e2e **1/1**; runway e2e still **1/1**. No `prisma/` diff.

**Gate read.** GitHub Actions `verify` on `1fc1e57a` = SUCCESS
(push run **32547061845**, attempt 1, job **11m7s**, full
`VERIFY_E2E`). Vercel production `dpl_ALJomEGGR1dZ3y67wxET1DkXfq9p`
READY on the same sha, aliased to `www.aimplifi.app`. Live Ask
(demo) shows the chip "How are my spending buckets?" and answers
with source `/budgets`.

**Next.** P1.2 stay-wealthy row (copy over existing signals), or P.1
counterfactual / W.6(b)(c)(d) with a hostile critic.

## 2026-08-21 — Ask "how many months of runway?" uses the Coach room-for-error card (DECISIONS #498)

**Picked up.** Owner: continue + /remote-control. Queue empty. #497 shipped.
P.1 remaining half and W.6(b)(c)(d) are new money engines (off this lane).
Highest-leverage unblocked item: Housel's room-for-error is the cash
cushion the long game needs, and "how many months of runway do I have?"
was unknown while `/coach` already prints the months.

**Closed.** `runway` intent. Parser + LLM share `runwayFromQuestion`.
Answer phrases `getCoachData().runwayMonths` via shared `runwayTitle` +
`COACH_COPY.runway` (same three title states as the Coach card). Copy
does not say "this card" or "below". Named store/category is `unknown`;
amount declines; a calendar window is `unknown`. Radar "run out of
money" stays `cash_flow_radar`. Dated/amount emergency-fund goals stay
those planners.

**Left alone.** P.1 counterfactual; W.6(b)(c)(d); P.2 (closed #499).

**Locked.** `assistant-runway.test.ts` four regressions; e2e Ask vs
Coach `runway-months`.

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0, eslint 0, unit
**7,247 passed + 1 expected fail + 1 skipped / 440 files + 1 skipped**,
`next build` clean. Ask runway e2e **1/1**. No `prisma/` diff.

**Shipped.** Branch `cursor/ask-runway-coach-card-ba65`, PR #13.
GitHub Actions `verify` SUCCESS on `a68689eb` (push **32535935837**
12m45s; PR **32535938709** 12m55s). Vercel Preview failed in 1s with
an empty preview URL — not a product-build failure (UNVERIFIED
rejection text). Production is unchanged until merge to `main`.

**Next.** P.2 closed in #499. P.1 remaining half (money-math / hostile critic) or W.6(b)(c)(d).

## 2026-08-21 — Ask "is my lifestyle creeping?" uses the Coach creep card (DECISIONS #497)

**Picked up.** Owner: continue; previous slice (#496) was committed, not
pushed (push blocked without an explicit request). P.1 remaining half and
W.6(b)(c)(d) are new money engines (off this lane). Highest-leverage
unblocked item: lifestyle inflation is the silent FI killer, and "is my
lifestyle creeping?" was unknown while `/coach` already prints the verdict.

**Closed.** `lifestyle_creep` intent. Parser + LLM share
`lifestyleCreepFromQuestion`. Answer phrases `getCoachData().creep` via
`COACH_COPY.creepCard` (same title/body as the Coach card). Copy does not
say "this card" or "below". Named store/category is `unknown`; amount
declines; a calendar window is `unknown`. Price-creep language stays
`what_to_cut`. `\boutpac(?:e|ed|ing)\b` so "outpacing" does not fall
through to `\bmy income\b`.

**Left alone.** P.1 counterfactual; W.6(b)(c)(d); P.2 audit; #496 push.

**Locked.** `assistant-lifestyle-creep.test.ts` four regressions; e2e Ask vs
Coach creep card.

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0, eslint 0, unit
**7,229 passed + 1 expected fail + 1 skipped / 439 files + 1 skipped**,
`next build` clean. Ask creep e2e **1/1**. No `prisma/` diff.

**Shipped and proven live.** Pushed as `4f8682db` (also carried #496
`4a956b39`). CI run **32528630622** `success` (12m31s, attempt 1).
Vercel: `READY` (`dpl_BvA3X2A9qs82Fkk5aKAHZS1QiJVF` /
`aimplifi-a3vuqyjo7`), same sha, aliased to `www.aimplifi.app`.
Production `/`, `/ask`, `/coach`, `/dashboard` 307; `/sign-in` 200.
No public HTML marker. No `prisma/` diff.

**Next.** P.1 remaining half is money-math (hostile critic). W.6(b)(c)(d)
need rate data / new engines. Or P.2 audit of the stale coach-principles
plan.

## 2026-08-21 — Ask "when can I retire?" uses the Coach FI card (DECISIONS #496)

**Picked up.** Owner: continue; previous slice (#495) was shipped, not
blocked. P.1 remaining half and W.6(b)(c)(d) are new money engines (off
this lane). Highest-leverage unblocked item: the long game is FI, and
"when can I retire?" with no age was unknown while `/coach` already
prints the date.

**Closed.** `fi_status` intent. Parser + LLM share `fiStatusFromQuestion`.
Answer phrases `getCoachData().fi` (same cents/months as the FI card).
Copy does not say "this card" or "below". Named age stays `retire_at_age`;
amount declines; a calendar window / `in N years` is `unknown`.

**Left alone.** P.1 counterfactual; W.6(b)(c)(d); P.2 audit; owner types
40 in Settings.

**Locked.** `assistant-fi-status.test.ts` four regressions; e2e Ask vs
Coach FI card.

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0, eslint 0, unit
**7,215 passed + 1 expected fail + 1 skipped / 438 files + 1 skipped**,
`next build` clean. Ask FI e2e **1/1**. No `prisma/` diff.

**Shipped and proven live.** Pushed with #497 as `4a956b39`. CI + Vercel
recorded on tip `4f8682db` (run **32528630622**, Vercel
`dpl_BvA3X2A9qs82Fkk5aKAHZS1QiJVF`).

**Next.** P.1 remaining half is money-math (hostile critic). W.6(b)(c)(d)
need rate data / new engines. Or P.2 audit of the stale coach-principles
plan.

## 2026-08-21 — Coach/Ask cuts skip money dials (DECISIONS #495)

**Picked up.** Owner: continue; previous slice (#494) was shipped, not
blocked. W.3 reports bars already open their rows (O.20). Highest-leverage
unblocked item in this lane: the differentiator is protecting spending that
buys happiness. `findOpportunities` still ranked a fitness unused-sub as a
cut even when Fitness is a money dial; Ask then phrased that list. W.6(a)
already does this for wealth-target proposals. Same helper, same list
Coach and Ask share. No FI re-projection. Demo dials are travel/dining, so
seed cents stay byte-identical.

**Closed.** `findOpportunities` takes required `moneyDialIds`. A series
in a Settings money dial is skipped for every opportunity kind. Coach
passes the same resolved ids as the wealth-target card; Ask phrases that
array. Demo travel/dining: ranking byte-identical. Fitness dial: LA
Fitness dropped (fail-old proven).

**Left alone.** P.1 counterfactual; W.6(b)(c)(d); W.3 (already O.20);
O.20j converse leak / H.7b; U.15(b); Plaid.

**Locked.** `insights.test.ts` `test_regression__w6a_opportunities_skip_money_dial_categories`;
`assistant-what-to-cut.test.ts` `test_regression__w6a_ask_cut_list_omits_a_money_dial_merchant`.

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0, eslint 0, unit
**7,197 passed + 1 expected fail + 1 skipped / 437 files + 1 skipped**,
`next build` clean. Ask P.1 e2e **1/1**. No `prisma/` diff.

**Shipped and proven live.** Pushed as `e8175868`. CI run **32485233922**
`success` (12m31s, attempt 1). Vercel: `READY`, same sha, aliased to
`www.aimplifi.app`. Production `/`, `/ask`, `/coach`, `/dashboard` 307;
`/sign-in` 200. No public HTML marker. No `prisma/` diff.

**Next.** P.1 remaining half is money-math (hostile critic). W.6(b)(c)(d)
need rate data / new engines. Or owner types 40 in Settings.

## 2026-08-20 — Ask "what should I cut?" (DECISIONS #494)

**Picked up.** Owner: continue and make this the best personal finance app
of its kind. Last slice was #493. Highest-leverage unblocked slice in
Grok's lane: P.1 first half — standing Ask answer from engines that exist.

**Closed.** `what_to_cut` intent. Parser + LLM share `whatToCutFromQuestion`.
Answer phrases `getCoachData().opportunities` (byte-identical monthly cents
to `/coach`). Abstentions: named store/category, amount; a calendar window
is `unknown` (fail-old: last month used to answer the standing list). No
FI re-projection.

**Left alone.** P.1 counterfactual harness; W.6(b)(c)(d); O.20j converse
leak / H.7b; U.15(b); Plaid; draft PR #12.

**Locked.** `assistant-what-to-cut.test.ts` four regressions.

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0, eslint 0, unit
**7,195 passed + 1 expected fail + 1 skipped / 437 files + 1 skipped**,
`next build` clean. Ask P.1 e2e **1/1**. No `prisma/` diff.

**Shipped and proven live.** Pushed as `461d5c42`. CI run **32443129831**
`success` (12m35s, attempt 1). Vercel: `READY`, same sha, aliased to
`www.aimplifi.app`. Production `/`, `/ask`, `/coach`, `/dashboard` 307;
`/sign-in` 200. Ask is behind sign-in; CI e2e asserted the route on this
sha. No public HTML marker. No `prisma/` diff.

**Next.** P.1 remaining half is money-math (hostile critic). Or owner
types 40 in Settings.

## 2026-08-20 — Ideal savings % is the Settings dial (DECISIONS #493)

**Picked up.** Owner: continue work; hardcoded 40% on draft PR #12 is a Grok
error. Ideal savings percent is a setting; 40% is his goal.

**Closed.** `savingsDisplayBandBps` / `savingsRateReferenceBps` read
`User.savingsTargetBps`. Book 15–20% / 15% stay when unset. Caption and
dashed line name Settings when set. No 40% product constant.

**Left alone.** Kids-save Path2College/Trump/529 placeholders (owner
vehicles, not product defaults). Draft PR #12 must not merge as written.

**Locked.** `conscious.test.ts` two #493 regressions.

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0, eslint 0, unit
**7,179 passed + 1 expected fail + 1 skipped / 436 files + 1 skipped**,
`next build` clean. No `prisma/` diff.

**Shipped and proven live.** Pushed as `fd2d3889`. CI run **32429873260**
`success` (12m57s, attempt 1). Vercel: `READY`, same sha, aliased to
`www.aimplifi.app`. Production `/`, `/settings`, `/dashboard`, `/coach`
307; `/sign-in` 200. Dial is behind sign-in. No `prisma/` diff.

**Next.** Owner types 40 in Settings → `/settings` savings target.

## 2026-08-20 — Header Sign out mutation-form recipe (DECISIONS #492)

**Picked up.** Leftover `#164/#166/#167` anti-pattern after #489 demo CTA:
app-layout Sign out was still `<form action={serverFn}>`. Out of scope: H.7b,
U.15, login flake, Plaid, converse-leak, O.10a, applyCategory, demo CTA,
O.20c, graph, secrets, merge.

**Closed.** `doSignOut` in `auth-actions.ts` (`redirect: false` → `{ ok: true }`);
client `SignOutButton` onSubmit + withDeadline + assign `/sign-in`. Layout
drops the inline `'use server'`. Source lock against layout form-action.

**Left alone.** delete-data / sign-out-everywhere (intentional native redirect);
Google/password/import-csv (different products / already scoped).

**Locked.** `sign-out.test.ts` three regressions.

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0, eslint 0, unit
**7,172 passed + 1 expected fail + 1 skipped / 436 files + 1 skipped**,
`next build` clean. Draft PR only — do not merge.

**Still open.** None for this class in signed-in chrome.

## 2026-08-20 — O.20j: applyCategory stamps isTransfer on Transfer (DECISIONS #491)

**Picked up.** User-facing leftover of the O.20j wave: hand-file to Transfer
did not stamp `isTransfer`. Out of scope: H.7b, U.15, login flake, Plaid,
converse-leak flip, demo CTA, O.10a, O.20c, sign-out, graph, secrets, merge.

**Closed.** `applyCategory` + twins (`applyToAllSimilar`, `fileMerchantGroup`,
merchant `recategorize`, household `recategorizeSharedTransaction`) set
`isTransfer: true` when `categoryId === 'transfer'`. Filing away does not
clear — #428 keeps H.7b as the only clear path.

**Locked.** `apply-category-transfer-stamp.test.ts` five regressions; fail-old
proven (empty stamp helper ⇒ flag stays false).

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0, eslint 0, unit
**7,169 passed + 1 expected fail + 1 skipped / 435 files + 1 skipped**,
`next build` clean. Draft PR only — do not merge.

**Still open.** O.20j converse leak sizing / H.7b.

## 2026-08-20 — Ask run-out ≡ Cash flow radar (DECISIONS #488)

**Picked up.** Owner trust blocker: live demo Ask / radar / cash-needed
disagreed on Everyday Checking. Out of scope: H.7b, U.15, login, Plaid,
converse-leak flip, graph engineering, secrets, merge.

**Closed.** Split Ask intent so “will I run out / go negative” uses
`getCashFlowRadar` (same dollars as the dashboard card). Recurring-only
forecast kept for projected-balance asks with card-payment disclosure.
Verified seed cents: radar −694399 / cover 695000; forecast end 1249500;
cash-needed rec 105000.

**Locked.** `ask-runout-radar-agreement.test.ts` three regressions.

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0, eslint 0,
unit **7,158 passed + 1 expected fail + 1 skipped / 433 files + 1
skipped**, `next build` clean. Draft PR only — do not merge.

**Next.** Owner review of draft PR. O.20j converse leak / H.7b still open.

## 2026-08-17 — W.4: route a wealth target through Ask (DECISIONS #484)

**Picked up from the queue** (W.8 shipped; U.15(b) is the owner's
call; U.1 stays "eventually"; O.20j/h/c stay off this model).

**Closed — fourth plan-in-words intent.** `wealth_target` routes
"save up to 10 mil" / "$10M" / "ten million" through W.1's
compounding planner. Dated save questions stay linear. Copy
reused. Abstentions are the majority of the new tests.

**Locked.** assistant-wealth-target `test_regression__w4_*`.

**Critic (self, 1 cycle):** 0 P0 / 0 P1. Engine unchanged.

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0,
eslint 0, unit **7,142 passed + 1 expected fail + 1 skipped
/ 432 files + 1 skipped**, `next build` clean. Ask W.4 e2e
**1/1**. No `prisma/` diff.

**Shipped and proven live.** Pushed as `55107fd0`. CI run
**32062765141** `success` (12m22s, attempt 1). Vercel:
`READY`, same sha, aliased to `www.aimplifi.app`.
Production `/`, `/accounts`, `/dashboard`, `/ask` 307;
`/sign-in` 200. Ask is behind sign-in; CI e2e asserted
the route on this sha. No public HTML marker. No
`prisma/` diff.

**Next.** U.15(b) is the owner's call. U.1 stays
"eventually." O.20j / O.20h / O.20c stay off this model.

## 2026-08-17 — W.8: every COACH_COPY key enters the guardrail scan (DECISIONS #483)

**Picked up from the queue** (O.17a shipped; U.15(b) is the owner's
call; U.1 stays "eventually"; O.20j/h/c stay off this model).

**Closed — register by name, empty the pin.** Seven keys now have
`ALL_STRINGS` rows (digest singular+plural; transfer frozen+live).
Copy unchanged; sweeps passed. `KNOWN_UNSCANNED` is `[]`.

**Locked.** coach-copy `test_regression__w8_every_coach_copy_key_is_scanned`.

**Critic (self, 1 cycle):** 0 P0 / 0 P1. No string changed.

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0,
eslint 0, unit **7,121 passed + 1 expected fail + 1 skipped
/ 431 files + 1 skipped**, `next build` clean. No e2e (no
UI). No `prisma/` diff.

**Shipped and proven live.** Pushed as `3859bd59`. CI run
**32050235581** `success` (13m50s). Vercel: `READY`, same
sha, aliased to `www.aimplifi.app`. Production `/`,
`/accounts`, `/dashboard` 307; `/sign-in` 200. No UI
marker (scan-table only). No `prisma/` diff.

**Next.** U.15(b) is the owner's call. U.1 stays
"eventually." O.20j / O.20h / O.20c stay off this model.

## 2026-08-16 — O.17a: money dials key by category id (DECISIONS #482)

**Picked up from the queue** (G.2 shipped; U.15(b) is the owner's
call; U.1 stays "eventually"; O.20j/h/c stay off this model).

**Closed — same column, ids on write, names resolve on read.**
Picker posts `moneyDialId`. Ambiguous leftover names are dropped,
never guessed. Cuts and gauges match ids; coach copy still names
the categories.

**Locked.** o17a-money-dial-ids `test_regression__o17a_*`.

**Critic (self, 1 cycle):** 0 P0 / 0 P1.

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0,
eslint 0, unit **7,101 passed + 1 expected fail + 1 skipped
/ 431 files + 1 skipped**, `next build` clean. settings-dials
e2e **4/4**. No `prisma/` diff.

**Shipped and proven live.** Pushed as `7fdd7d9` (O.17a) +
`5b179045` (always-commit-push rule). First CI attempt
cancelled at the 30m job cap; rerun of **31984900659**
`success` (12m29s). Vercel: `success`, "Deployment has
completed", same sha. Production `/`, `/accounts`,
`/dashboard`, `/settings` 307; `/sign-in` 200. Picker is
behind sign-in; CI e2e asserted it on this sha. No
`prisma/` diff.

**Next.** U.15(b) is the owner's call. U.1 stays
"eventually." O.20j / O.20h / O.20c stay off this model.

## 2026-08-16 — G.2: audit probes compile under the verify gate (DECISIONS #481)

**Picked up from the queue** (C.22 shipped; U.15(b) is the
owner's call; U.1 stays "eventually").

**Closed — a dedicated compile set, not the root include.**
`tsconfig.probes.json` + `verify.sh` probes stage. First
compile found `income-replay` `.filter(countsInFlows)` —
index as `excludedFlowIds`. Stale types triaged. Cited
production output UNVERIFIED (no prod env).

**Locked.** g2-probes-compile-set.

**Critic (self, 1 cycle):** 0 P0.

**Gate.** `bash scripts/verify.sh` → tsc 0, probes tsc 0,
eslint 0, unit **7,093 passed + 1 expected fail + 1 skipped
/ 430 files + 1 skipped**, `next build` clean. No e2e (no
UI). No `prisma/` diff. Production re-runs UNVERIFIED.

**Shipped and proven live.** Pushed as `feda1fdc`. CI run
31980832609 `success` (12m11s). Vercel: `success`,
"Deployment has completed", same sha. Production `/`,
`/accounts`, `/dashboard` 307; `/sign-in` 200. No UI
marker (compile-set only). No `prisma/` diff. Production
probe re-runs UNVERIFIED (no prod env).

**Next.** U.15(b) is the owner's call. U.1 stays
"eventually."

## 2026-08-15 — C.22: detect each payment-account feed, then union (DECISIONS #480)

**Picked up from the queue** (named next after C.20; direction was
not established).

**Closed — detection and burn sums are different questions.**
The prescribed descriptor-merge is the income concatenate
(9 → 4). Each payment-component account is detected on its
own; canonicals are unioned. Burn remaps and collapses the
handover day. `terminalOf` rides on the snapshot.

**Locked.** radar-committed C.22 regressions.

**Critic (self, 1 cycle):** 0 P0.

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit
**7,090 passed + 1 expected fail + 1 skipped / 429 files + 1
skipped**, `next build` clean. Radar e2e **1/1** on that
build. No `prisma/` diff. Live probe UNVERIFIED (no prod env).

**Shipped and proven live.** Pushed as `6978360e`. CI run
31916908467 `success`. Vercel: `success`, "Deployment has
completed", same sha. Production `/`, `/accounts`,
`/dashboard` 307; `/sign-in` 200. Copy is behind sign-in;
CI e2e asserted the radar card on this sha. No `prisma/`
diff. Live income-replay C.22 block UNVERIFIED (no prod env).

**Next.** U.15(b) is the owner's call. U.1 stays
"eventually."

## 2026-08-15 — C.20: pace credit shares the month total's category nets (DECISIONS #479)

**Picked up from the queue** (named next after C.21; H.9 was an
owner interrupt and is shipped).

**Closed — still-due and the rate credit are different
questions.** Credit attributes through the surviving category
nets from the same `spendingByCategory` call as
`spentSoFarCents`. Exclusive categories first. Branch B says
"already posted". Figure moves only when a healthy-category
bill sat next to a dropped-category one (old guard took no
credit).

**Locked.** trends-pace-bills C.20 regressions; labels branch B.

**Critic (self, 1 cycle):** 0 P0. P1 "already counted" executed.

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit
**7,085 passed + 1 expected fail + 1 skipped / 428 files + 1
skipped**, `next build` clean. Trends e2e **5/5** on that
build. No `prisma/` diff.

**Shipped and proven live.** Pushed as `fc932b4d`. CI run
31915690732 `success`. Vercel: `success`, "Deployment has
completed", same sha. Production `/`, `/accounts`, `/trends`
307; `/sign-in` 200. Copy is behind sign-in; CI e2e asserted
the trends pace surfaces on this sha. No `prisma/` diff.

**Next.** C.22 stays open (direction not established).
U.15(b) is the owner's call. U.1 stays "eventually."

## 2026-08-15 — H.9: reader-chosen payee on a loan/mortgage (DECISIONS #478)

**Picked up from the queue** (owner: mortgage click shows nothing; build
the payment history). Stash `ORPHANED V.1 start` was not applied;
schema rewritten as H.9.

**Closed — the reader names the payee; the panel lists register-axis
activity.** `Account.paymentMerchantId` (SetNull). Never inferred.
LOAN/MORTGAGE only. Demo fenced. Null = ASK (hidden on demo). Linked
+ zero names the activity-list zero. Rows include transfers and
hand-entered charges with no `merchantId`.

**Locked.** loan-payment-history; account-detail-panel H.9;
account-payment-merchant-actions; e2e no-dead-ends 16/16 incl. H.9.

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit
**7,082 passed + 1 expected fail + 1 skipped / 428 files + 1
skipped**, `next build` clean. no-dead-ends e2e **16/16** on
that build. `prisma/` schema diff (additive FK).

**Critic (self, 1 cycle):** 0 P0 / 0 P1. P2: panel loads the
full register on open; role line still says the mortgage
itself has no activity feed (true of the servicer).

**Shipped and proven live.** Pushed as `74783729`. CI run
31904520152 `success` (12m). Vercel: Ready, aliases
www.aimplifi.app, created with the push. Production
`/accounts` 307; `/sign-in` 200. Copy is behind sign-in;
CI e2e asserted the choose-payee list on this sha.
`prisma/` additive FK — Neon `db push` ran on deploy.

**Next.** Open the mortgage on Accounts and choose the
servicer name as it appears in activity.

## 2026-08-15 — C.21: pace assumption names which zero when no bill was admitted (DECISIONS #477)

**Picked up from the queue** (Wave U leftovers an agent can
close are done; U.15(b) is the owner's call; U.1 stays
"eventually"). C.21 is the next agent-workable leftover from
the owner's original /trends complaint.

**Closed — a required count selects a fourth branch.**
`billsRefusedCount` = expected entries that failed admission.
The sentence does not print N. Refused-all: "This projection
does not add scheduled outflows." plus the empty-calendar
daily-rate sentence. Figure unchanged. Demo seed count 2.

**Critic: 4 cycles; cycle-4 P1 executed in-place.**

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit
**7,062 passed + 1 expected fail + 1 skipped / 426 files + 1
skipped**, `next build` clean. Trends e2e **4/4** on that
build. No `prisma/` diff.

**Shipped and proven live.** Pushed as `5de9fe03`. CI run
31901717873 `success` on first attempt. Vercel: `success`,
"Deployment has completed", same sha. Production `/`,
`/accounts`, `/ask` 307; `/sign-in` 200. Copy is behind
sign-in; CI e2e asserted the refused-all sentence on this sha.

**Next.** C.20 (pace credit vs month-total basis — money math,
changes a test that explains itself). C.22 stays open
(direction not established). U.15(b) is the owner's call.
U.1 stays "eventually."

## 2026-08-15 — U.14: last-4 veto reads a 4-digit non-year name embedding (DECISIONS #476)

**Picked up from the queue** (named next after the U.11 leftover).
The column-only veto was inert for SimpleFIN. The 2026-08-12
widening (every advertised 2+ digit group) was reverted: it hid
the genuine Roth 396/5351 Combine and collapsed an L.9 ambiguity.

**Closed — last-4 only, not advertised numbers.**
`last4ForNameVeto` = mask column, else `maskFromName` minus
`looksLikeYear`. Name signal only. E.LEE 4034 vs M.LEE 4927
(different balances) hidden. Roth 396/5351 still offered. A
2-digit plan code stays a name-only candidate (U.15 owns
confirmed ones). Offer-guard on `accountNumbersConflict`
rejected — that pair conflicts and is the same account.

**Locked.** U.14 blocks in account-duplicates +
account-reconciliation-candidates; e2e reconcile U.14 LEE
absence + existing L.9 Roth offer.

**Critic (2 cycles): PASS — 0 P0, 0 P1.** Cycle 1: P1-1
unproven leftover Combine, P1-2 year-shaped mask column; both
executed. Cycle 2: PASS; P2 `maskFromName` docblock executed.

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit
**7,059 passed + 1 expected fail + 1 skipped / 426 files + 1
skipped**, `next build` clean. Consumer e2e on that build:
reconcile **5/5** (incl. L.9 Roth + U.14 LEE),
duplicate-connections **10/10**, combined-accounts **4/4**.
No `prisma/` diff.

**Shipped and proven live.** Pushed as `f98ff36c`. CI run
31893667276 `success` on first attempt. Vercel: `success`,
"Deployment has completed", same sha. Production `/`,
`/accounts`, `/ask` 307; `/sign-in` 200. Combine withhold is
behind sign-in; CI e2e asserted it on this sha.

**Next.** U.15 (b) is the owner's call (undo the nine wrong
links). U.1 stays "eventually."

## 2026-08-15 — U.11 leftover: retitle the refused lock

**Picked up from the queue** (named next after U.17). U.11 closed
2026-08-12 as measured-and-refused; the `it.fails` title still
read as a pending defect.

**Closed — title and comment only.** The lock is now `U.11
REFUSED: same-account-twice would count once; span-dedup is the
silent-loss direction`. Still `it.fails` on −$50.00 so a later
span-dedup is an unexpected pass. Expect unchanged.

**Shipped and proven live.** Pushed as `1ad4066`. CI run
31890507052 `success` on first attempt. Vercel: `success`,
"Deployment has completed", same sha. Production `/`,
`/accounts`, `/ask` 307; `/sign-in` 200. Title-only.

**Next.** U.14 (RE-OPEN): veto inert when one side lacks a mask
column. Decided approach: do not remove candidates; make the
offer/ambiguity guard read conflicts directly (no set-size
change). Run every consumer e2e locally before shipping.

## 2026-08-15 — U.17: a dormant last-used day is still released (DECISIONS #475)

**Picked up from the queue** (named next after U.7). A quiet
predecessor's last-used day was filed as a false handover day.

**Closed — rule measured and refused; copy executed after critic.**
Production: 25 effective links, 16 coincident, 0 dormant, 0 dragged.
Inclusive-at-last and claimEnd=cutover both rejected. Last-used
stays released. Long authors locate the keep-rule, not a
connection-change. Combined accounts prints no date. Combine's
exception is a separate sentence.

**Locked.** U.17 money: 2025-03-15 / 2026-07-21 keeps both
−$1,200.00, unique succ −$25.00, and the gap. U.16: every long
author contains the locator and refuses "changing connections".

**Critic (4 cycles): PASS — 0 P0, 0 P1.** Cycles 1–3 each found
copy P1s; all executed. Residual: naming the released day on
Combine / Combined accounts needs a claimEnd payload.

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit **7,049
passed + 1 expected fail + 1 skipped / 426 files + 1 skipped**,
`next build` clean. Playwright (that build): handover-day-disclosure
**7/7**. No `prisma/` diff.

**Shipped and proven live.** Pushed as `d51724be`. CI run
31889492355 `success` on first attempt. Vercel: `success`,
"Deployment has completed", same sha. Production `/`,
`/accounts`, `/ask` 307; `/sign-in` 200. No figure or copy
moved on the public surface.

## 2026-08-15 — U.7: the winning observation carries its own class (DECISIONS #474)

**Picked up from the queue** (named next after U.8). A reconciled
pair's collision winner was filed as deciding that date's sign.

**Closed — measured and refused, not built.** Production: 16
colliding dates, 0 class disagreements, all 55 snapshots NULL.
Prefer-successor and refuse-the-date both rejected. Class rides
with the winning row.

**Locked.** U.7 block: covering CHECKING winner `+$5,000.00`;
genuine CREDIT over CHECKING echo `−$4,800.00`; NULL+NULL stays
liability either winner.

**Critic (read-only): PASS — 0 P0, 0 P1.** Four P2s executed in
the decision note / lock comment.

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit **7,047
passed + 1 expected fail + 1 skipped / 426 files + 1 skipped**,
`next build` clean. E2e skipped (no UI). No `prisma/` diff.

**Shipped and proven live.** Pushed as `f741ef4`. CI run 31886671146
`success` on first attempt. Vercel: `success`, "Deployment has
completed", same sha. Production `/`, `/accounts`, `/ask` 307;
`/sign-in` 200. No figure or copy moved.

## 2026-08-15 — U.8: spending rows can open the same detail panel (DECISIONS #473)

**Picked up from the queue** (named next after U.10). The detail
panel never rendered for CHECKING / SAVINGS / CREDIT.

**Shipped.** Sibling Details affordance. Primary click stays the
register. Spending role line points at Transactions. Loan sentence
byte-identical. INVESTMENT still excluded.

**Locked.** Role-line unit + checking panel render + destinations
e2e + U.8 sibling open/close e2e.

**Critic (read-only): PASS — 0 P0, 0 P1.** Two P2 JSDocs executed.

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit **7,044
passed + 1 expected fail + 1 skipped / 426 files + 1 skipped**,
`next build` clean. Playwright (fresh build): **352 passed, 2
flaky-passed-on-retry** (`category-rename.spec.ts:110`,
`transactions.spec.ts:610` — K.10, untouched). No `prisma/` diff.

**Shipped and proven live.** Pushed as `4b79f95`. CI run 31881967472
`success` on first attempt. Vercel: `success`, "Deployment has
completed", same sha. Production `/`, `/accounts`, `/ask` 307;
`/sign-in` 200. Affordance is behind sign-in; CI e2e asserted it
on this sha.

## 2026-08-15 — U.10: today's snapshot is not the live point (DECISIONS #472)

**Picked up from the queue** (named next after U.2). A snapshot
dated today was marked counted while the chart overwrites that
bucket with live balances.

**Shipped.** Mark, do not yield. `replacedByLive` on a kept
today-row; `countsInNetWorth` stays the boundary verdict. Copy
concedes matching cents and names a same-day class flip. PDF
heading `Trend`.

**Locked.** U.10 server block: live constituent `−$1,500.00` not
recorded `−$1,000.00`; dropped today-row stays combine. Copy
refuses "not from this recording" / "Tomorrow". Demo Auto Loan
e2e. PDF heading lock.

**Critic (read-only, two cycles): PASS — 0 P0, 0 P1.** Cycle 1
3 P1 all executed.

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit **7,041
passed + 1 expected fail + 1 skipped / 426 files + 1 skipped**,
`next build` clean. Playwright (fresh build): **350 passed, 3
flaky-passed-on-retry** (`category-rename.spec.ts:110`,
`merchant-lens.spec.ts:77`, `transactions.spec.ts:1014` —
documented K.10 class, untouched by this diff). No `prisma/` diff.

**Shipped and proven live.** Pushed as `817a7f5`. CI run 31864595352
`success` on first attempt. Vercel: `success`, "Deployment has
completed", same sha. Production `/`, `/accounts`, `/ask` 307;
`/sign-in` 200. Marker is behind sign-in; CI e2e asserted it on
this sha.

## 2026-08-14 — U.2: semantic status-color tokens (DECISIONS #471)

**Picked up from the queue** (named next after U.37). Hue-named
`emerald-*` / `amber-*` classes encoded brand chrome and status with
the same vocabulary.

**Shipped.** `brand` and `positive` alias Tailwind emerald; `warning`
aliases amber. Every `src/` call site migrated in one slice. Shades
unchanged. Chrome (nav, wordmark, focus, connect CTAs, accent sliders)
→ `brand`; money/success → `positive`; every amber → `warning`.

**Locked.** `tests/unit/u2-semantic-color-tokens.test.ts`: zero
`emerald-N` / `amber-N` under `src/` except the token file.

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit **7,032
passed + 1 expected fail + 1 skipped / 426 files + 1 skipped**,
`next build` clean. Playwright (fresh build): **350 passed, 3
flaky-passed-on-retry** (`category-rename.spec.ts:110`,
`transactions.spec.ts:638`, `transactions.spec.ts:735` — documented
K.10 class, untouched by this diff). Built CSS: `.text-brand-500` /
`.text-positive-500` resolve to `var(--color-emerald-500)`;
`.text-warning-500` to `var(--color-amber-500)`. No `prisma/` diff.

**Shipped and proven live.** Pushed as `d3cc8a8`. CI run 31842635038
`success` on first attempt. Vercel: `success`, "Deployment has
completed", same sha. Production `/`, `/accounts`, `/ask` 307;
`/sign-in` 200 with live `text-brand-500` (3) and zero
`text-emerald-500`.

## 2026-08-14 — U.37: genuineness outranks U.9's tier order (DECISIONS #470)

**Picked up from the queue** (U.12 critic residual). U.12 only compared
echoes inside the covering tier, so a covering predecessor's monthly
echo still beat the live successor's real reading, and a later-cutover
echo still beat an earlier-cutover genuine reading when the terminal
had no row.

**Shipped.** Genuineness compared first, then existing U.9 tiers.
Both-genuine / both-echo fall through, so U.9 is unchanged when both
sides read. Lone observation still never dropped.

**Locked.** U.37 block: common pair succ / $5,000.00; both-genuine pred
still wins; closed-tier inverse; covering-echo vs closed-genuine;
terminal-echo vs closed-genuine; equal-cutover ancestor; CREDIT
−$5,000.00; lone echo kept.

**Critic (read-only, fresh context): PASS — 0 P0, 0 P1, 6 P2.** P2
locks added in-slice. `#469` not-in-scope updated.

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit **7,026 passed
+ 1 expected fail + 1 skipped / 425 files + 1 skipped**, `next build`
clean. Extra critic locks added after that run (targeted U.37: 9 passed).
Playwright (fresh build): **351 passed, 2 flaky-passed-on-retry**
(`budget-targets.spec.ts:61`, `transactions.spec.ts:1014` — documented
K.10 class, untouched by this diff). Local wrapper exited 1 on a worker
teardown hang after the suite, not a failing spec. No `prisma/` diff.

**Shipped and proven live.** Pushed as `457879c`. CI run 31838082196 `success`
on first attempt. Vercel: `success`, "Deployment has completed", same sha.
Production `/`, `/accounts`, `/ask` all 307. No demo-visible marker
(K.4 shape — seed writes no combined pairs).

## 2026-08-14 — U.12: a genuine reading outranks a carried-forward repeat (DECISIONS #469)

**Picked up from the queue** (U.9 critic residual; named next after U.36).
A quiet feed's monthly echo could beat another record's real balance for
the same date because the snapshot winner was ranked by cutover alone.

**Shipped.** Covering-tier genuineness: genuine reading outranks
carried-forward repeat, then existing cutover / depth / id.
`BoundaryAccountWithFeed.feedDroppedAt` required. Shared
`isCarriedForwardSnapshot` with the panel. Did not invert U.9's tier
order (covering still beats the live terminal).

**Locked.** `tests/unit/reconcile-boundary.test.ts` U.12 block: named
defect s2 / $5,000.00; both-genuine still s1; drop-date / lone-echo /
both-echo controls; equal-cutover; chain; CREDIT −$5,000.00.

**Critic (read-only, fresh context): PASS — 0 P0, 0 P1, 7 P2.** Residuals
filed as **U.37** (covering-pred vs genuine successor; closed-tier
inverse).

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit **7,018 passed
+ 1 expected fail + 1 skipped / 425 files + 1 skipped**, `next build`
clean. Three critic locks added after that run (targeted file green).
Playwright (fresh build): **350 passed, 3 flaky-passed-on-retry**
(`category-rename.spec.ts:110`, `pwa-offline.spec.ts:51`,
`transactions.spec.ts:735` — documented K.10 class, untouched by this
diff). No `prisma/` diff.

**Shipped and proven live.** Pushed as `7826260`. CI run 31833191365 `success`
on first attempt. Vercel: `success`, "Deployment has completed", same sha.
Production `/`, `/accounts`, `/ask` all 307. No demo-visible marker
(K.4 shape — seed writes no combined pairs).

## 2026-08-14 — U.36: composed Ask intents skip the unused composer boundary (DECISIONS #468)

**Picked up from the queue** (U.34 critic residual). Five Ask intents fetched
the composer boundary (unused) then `getSpendingPlan` / `getCoachData`
fetched their own.

**Shipped.** Skip the composer `getReconciliationBoundary` for
`safe_to_spend` / `debt_free_by_date` / `savings_goal_by_date` /
`retire_at_age` / `savings_rate`. Empty required views passed into
`buildAnswer`. Direct intents still fetch eagerly (#466). Did not thread
into loaders or emit `terminalOf` on the snapshot.

**Locked.** `tests/unit/reconciliation-boundary-shared-read.test.ts` U.36
block: spyOn counts 3 / 2 / 4 / 4 / 3 with `kind` asserted. U.34
`spend_total` stays at 2.

**Critic (read-only, fresh context): PASS — 0 P0, 0 P1, 6 P2.** P2-5
(#466 present tense) fixed in-slice. Remaining P2s accepted: unused
boundary on three snapshot-only delegates; aggregate counts; weak
headline companion; empty-args future hazard; unused composer snapshot.

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit **7,012 passed
+ 1 expected fail + 1 skipped / 425 files + 1 skipped**, `next build`
clean. Playwright (fresh build): **353 passed**. No `prisma/` diff.

**Shipped and proven live.** Pushed as `58b0cf8`. CI run 31827303937 `success`
on first attempt. Vercel: `success`, "Deployment has completed", same sha.
Production `/`, `/ask`, `/spending-plan`, `/coach` all 307. No demo-visible
marker (K.4 shape, unchanged fact).

## 2026-08-14 — U.35: the snapshot emits the handover keys it already paid for (DECISIONS #467)

**Picked up from the queue** (U.34 critic residual). `/reports`, `/trends`, and
`/coach` each held a snapshot that had already read the link table for the keep,
then fetched `getReconciliationHandoverKeys` independently.

**Shipped.** Inverse of the #466 parked shape: `applyReconciliationBoundary`
returns `handoverKeys` from the same `txnSpan` as the keep; `FinanceSnapshot`
carries them as a required field; the three loaders read `snap.handoverKeys`.
`getReconciliationHandoverKeys` deleted (zero production callers).

**Locked.** `tests/unit/reconciliation-boundary-shared-read.test.ts` U.35 block:
spyOn count === 1 for each loader; `getReports` `totalCents === 5300` and
`countedOnHandoverDays > 0` on an ACTIVE-link fixture with a cutover-day grocery.
U.31 block: snapshot keys === boundary keys on the CREDIT-pair fixture.

**Critic (read-only, fresh context): PASS — 0 P0, 0 P1, 6 P2.** P2-4 (count
locks did not prove disclosure) fixed in the same slice. Remaining P2s accepted:
spending-only spans (these pages list no brokerage/loan rows); `/budgets` is the
U.34-accepted snapshot+boundary shape; Ask two-read window is U.36; household
merge keeping viewer keys is unreachable (personal loaders); empty-keys comments
are pre-existing.

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit **7,007 passed + 1
expected fail + 1 skipped / 425 files + 1 skipped**, `next build` clean.
Playwright (fresh build): **352 passed, 1 flaky-passed-on-retry**
(`budget-targets.spec.ts:61`, documented K.10 class, untouched by this diff).
No `prisma/` diff.

**Shipped and proven live.** Pushed as `dca4b48`. CI run 31822001737 `success`
on first attempt. Vercel: `success`, "Deployment has completed", same sha.
Production `/`, `/reports`, `/trends`, `/coach` all 307. No demo-visible
marker (K.4 shape, unchanged fact).

## 2026-08-14 — U.34: one link-table snapshot per rendered plan and per Ask answer (DECISIONS #466)

**Picked up from the queue** (U.33 residual). `getSpendingPlan` read `activeTerminalSuccessorMap`
twice for one plan (income scope, then expense scope). `askAssistant` fetched handover keys in
four spend cases, the links again for account_balance, and the keys a fifth time for the
Glass-Box trace.

**Shipped.** One `getReconciliationBoundary` per loader, views passed as REQUIRED parameters.
`activeTerminalSuccessorMap` deleted (zero production callers; U.33 F-2). L.26 audit probes
updated to take `terminalOf` off the boundary.

**Locked.** `tests/unit/reconciliation-boundary-shared-read.test.ts` U.34 block: spyOn count
plan === 2, spend_total Ask === 2, both on an ACTIVE-link fixture; Ask asserts headline $42.00.

**Critic (read-only, fresh context): PASS — 0 P0, 0 P1, 4 P2 accepted.** Residuals filed as
U.35 (reports/trends/coach still pair snapshot + keys) and U.36 (composed Ask pays twice).

**Gate.** `bash scripts/verify.sh` → tsc 0, eslint 0, unit **7,003 passed + 1 expected fail +
1 skipped / 426 files**, `next build` clean. Playwright (fresh build): **352 passed, 1
flaky-passed-on-retry** (`transactions.spec.ts:610`, documented CSV-wedge / K.10 class,
untouched by this diff). No `prisma/` diff.

**Shipped and proven live.** Pushed as `aab0bfb`. CI run 31808886866 `success` on first
attempt. Vercel: `success`, "Deployment has completed", same sha. Production `/`,
`/spending-plan`, `/ask` all 307. No demo-visible marker (K.4 shape, unchanged fact).

## 2026-08-13 — U.32: /calendar's per-day marker was gated on money, not the fact (DECISIONS #464)

**Picked up from the queue** (opened by both U.24 critics, same family as U.30/U.31). The day
tile's flat counts have no released-day awareness, and the only per-day changeover marker was
gated on the money-scoped `countedOnHandoverDays` — so a released day whose only duplicated rows
were transfers/excluded/$0 doubled a count silently, with no changeover vocabulary anywhere.

**Shipped.** New `handoverRowCount` (raw, type-unaware) widens the marker's gate — safe since the
marker's claim is unconditionally true regardless of money movement. Closing basis caption gained
an unconditional released-day clause matching its own always-shown-rule voice. Month sentence
deliberately left money-scoped and silent on a transfer-only day — correct, not a residual.

**Locked.** Unit: two existing tests extended, proving the two counts genuinely differ (3 vs 0 on
a transfer/excluded/$0 fixture). E2E: new fixture + test (a released transfer-only day shows BOTH
`cal-posted-nonmoney` and the marker, month sentence stays silent, caption clause present); the
control test gained a positive assertion that the caption clause is unconditional.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**: e2e **349 passed, 4
flaky-passed-on-retry** (all documented K.10 contention-class members — `action-menu.spec.ts:391`,
`category-rename.spec.ts:110`, `transactions.spec.ts:735`, `transactions.spec.ts:1014` — none
touching calendar/reconciliation code). tsc 0, eslint 0, unit 6,995 passed. No `prisma/` diff.

**Shipped and proven live.** Pushed as `7768ff9`. CI run 31732435392 `success` on first attempt.
Vercel: `success`, "Deployment has completed", same sha. Production `/`, `/calendar` both 307.
New e2e fixture ran inside CI's full suite against this exact commit. No demo-visible marker
(K.4 shape, unchanged fact).

## 2026-08-13 — U.31: the reconciliation link table's double-read, at six sites not two (DECISIONS #463)

**Picked up from the queue** (opened by the U.24 critic; U.31 was the next small, non-money-labeled
item, though the money-adjacent shape of the fix earned it a critic pass anyway). `getReconciliationTxnKeep`
and `getReconciliationHandoverKeys` each independently re-read the link table, accounts and spans —
the exact shape `getAccountsView` already argued against in writing. The row named two call sites;
there were four by the time this session started (U.30 added a third, this session's own read found
a fourth, `getTransactionDetail`).

**Shipped.** `getReconciliationBoundary(userId)` — one shared fetch, both outputs together — via a
new private `loadReconciliationBoundaryInputs`. Converted at all four known sites plus, per the
fresh-context critic's own grep of every consumer (not trusting the row's "single-value elsewhere"
claim), two MORE sequential-pair sites it missed: `budgets/page.tsx` and `api/export/route.ts`. Six
total.

**Critic: 0 P0, 2 P1 (the two extra sites, fixed), 1 P2 (orphaned comment, fixed).** Filed rather
than fixed: **U.33** — `recurring.ts`/`tax.ts` pair `getReconciliationTxnKeep` with a DIFFERENT
sibling (`getReconciliationHandoverDates`, unscoped, its own fetch), feeding PERSISTED
`RecurringSeries` rows and the tax export. Needs its own shared function, not a mechanical reuse of
this slice's fix — filed as its own small/money-persisted row.

**Locked.** New `tests/unit/reconciliation-boundary-shared-read.test.ts` proves row-by-row
behavioral equivalence with the old two-call shape (not just "returns a value"), the
(account, day)-scoping shape, and the no-links fast path. Full unit suite (6,995 tests) unchanged.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**: tsc 0, eslint 0, e2e **350
passed, 2 flaky-passed-on-retry** (`category-rename.spec.ts:110`, documented pre-existing;
`triage-write-in.spec.ts:129`, a `SQLITE_BUSY_SNAPSHOT` contention hit absorbed by the K.10 retry
config, spec untouched by this diff). No `prisma/` diff.

**Shipped and proven live.** Pushed as `c061050`. CI run 31727687546 `success` on first attempt.
Vercel: `success`, "Deployment has completed", same sha. Production `/`, `/budgets`,
`/transactions` all 307 (expected). Behavior-preserving refactor — no new user-visible surface, so
correctness rests on the full existing e2e/unit suite running green against this exact commit.

## 2026-08-13 — U.30: the dashboard's Recent transactions card discloses the released handover day (DECISIONS #462)

**Picked up from the queue** (U.24's own critic residual, filed rather than fixed as P1). Of the
seven surfaces that read a transaction reconciled across a combined-account cutover, only the home
dashboard's "Recent transactions" strip carried zero reconciliation vocabulary — and it is the
first screen a reader lands on. `TxnView.onHandoverDay`'s docblock names the account name as the
reader's fallback clue when no marker exists; this card does not even print an account name.

**Shipped, sixth reuse of the marker.** `onHandoverDay` REQUIRED on `DashboardRecentTxn`
(`src/server/dashboard-recent.ts`), resolved via `getReconciliationHandoverKeys` fetched alongside
the existing `getReconciliationTxnKeep` in the same `Promise.all`, keyed
`handoverKeys.has(handoverKey(t.accountId, t.date))` — byte-identical shape to U.24's
`getPostedCalendarRows`. `RecentTransactionsCard` renders the same `(connection changeover)` span
used on /transactions, /reports, Ask and /calendar; no new note sentence needed since this strip
carries no aggregate total to qualify.

**Fresh-context hostile critic (money-visible) — 0 P0/P1, one P2 accepted in place**: the merchant
name and the marker share one `truncate` element, so a long merchant name could in principle clip
the marker — a pattern already shipped and critic-passed on `ask-view.tsx`, not new to this slice.

**Locked.** New unit test `tests/unit/dashboard-recent.test.ts` (byte-for-byte match of U.24's
(account, day)-scoping fixture). New e2e test in `tests/e2e/handover-day-disclosure.spec.ts`
(/dashboard prints 3 rows, exactly 2 marked) plus the matching zero-count assertion added to the
existing no-combined-accounts control test.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**: tsc 0, eslint 0, unit tests
green, `next build` clean, e2e **350 passed, 2 flaky-passed-on-retry** (`category-rename.spec.ts:110`,
`merchant-lens.spec.ts:22` — both named members of the pre-existing load-induced local flake class
in `docs/lessons/ci-e2e-timing-flake.md`). No `prisma/` diff.

**Shipped and proven live.** Pushed as `cf102d0`. CI run 31720492510 FAILED attempt 1 on
`transactions.spec.ts:638`/`:735` — the documented pre-existing "CSV wedge" contention class
(STATUS.md:483/:548/:596), untouched by this push's diff. `gh run rerun --failed` → attempt 2
`success`. Vercel: `success`, "Deployment has completed", same sha. Production `/` and `/dashboard`
both 307 (expected unauthenticated redirect). No demo-visible marker, declared not skipped (K.4
shape — `grep AccountReconciliation prisma/seed.ts` zero hits, unchanged).

## 2026-08-12 — U.16: the panel was not silent, it was CERTIFYING — and the compiler found the surfaces the ticket did not

**Picked up from the queue** (U.13's own residual, filed by its rendered-claims critic as P1-6 with executed
evidence). U.13 released the single handover day to both sides of a combined pair and priced that at
"9 rows / $374.40 of VISIBLE duplication". The visibility did not exist. Every spending surface counted
those rows in silence, and the glass-box drilldown did worse than stay quiet: it listed both copies of one
charge and printed "matched to the penny" beneath them. A reader opens that panel precisely to AUDIT a
figure, so the tick reads as confirmation that both lines belong. `BREAKDOWN_BASIS` stayed literally true
the whole time — both rows ARE counted, the panel DOES list both — which is exactly why silence was not
survivable: nothing was false, and nothing said the one thing that mattered.

**The compiler did the sweep, and it was bigger than the ticket.** The row named the glass-box drilldown,
/reports, /budgets and Ask. Making `onHandoverDay` a REQUIRED field on `BreakdownRow` turned `tsc` into the
enumerator, and it named three more transaction panels nobody had listed — the /reports chart's month-flow
panels, the lifestyle-creep bars on /coach, and /trends' new-merchant panels — each listing transactions
under the same penny-match line. A fourth Ask answer (`top_categories`) that prints a period total came out
of the critic pass. Seven surfaces, one authored sentence. The three genuinely non-transaction panels
(allocation holdings, forecast projections, net-worth constituents) answer `false` by construction with the
reason on the field, because six months from now a stub and a true answer look identical.

**One author for the fact, two for the sentence.** `breakdownHandoverDayCopy` serves every panel so two
drilldowns cannot state one rule two ways. Ask needed its own: the panel sentence says "N rows here", "the
figure above", and reassures about a tally the reader can see — every clause of which is false in an answer
that prints one number and nothing else.

**Three critic findings, all executed, all false statements about money that would have shipped:**

- **A count summed before a filter the figure applies after.** `spendingByCategory` drops any category whose
  net is `<= 0` and `totalCents` sums only the survivors, so a handover-day purchase more than cancelled by
  a refund left the figure entirely while still being counted in the sentence beside it — Ask qualified a
  **$20.00 total containing no released row at all** with "2 … fall on a day…". This is the same false-scope
  defect the slice was already guarding against per category, one level up. Now summed off `byCategory`.
- **"Charge" is false of a refund.** A refund can land on a handover day, and a duplicated refund pushes a
  spending figure DOWN — so the noun was wrong about the kind of row AND the direction of the error. Three
  sites now say "transaction".
- **A pointer to a page that cannot serve the reader.** The Ask note ended "Spending in Reports lists those
  rows and marks them." /reports' category table is ALWAYS the current month, while an Ask timeframe is
  whatever the reader said — so it was false for every answer about last month or last quarter. Removed and
  locked by a test asserting the word cannot come back.

**Fail-old proven four ways, not asserted:** blanking the row flag reddens 2 locks; deleting the panel
sentence reddens 1; widening the Ask count to breakdown scope reddens exactly the scoping lock; and the e2e
was sabotaged against a REBUILT server, because a Playwright run tests the last `next build` and not the
working tree (`e2e-runs-a-stale-build`). The e2e seeds a real combined pair whose handover day carries a
genuine duplicate and asserts **3 rows, not 4** — 4 would mean de-duplication stopped, 2 would mean the
engine started silently dropping a real row, which is the direction U.13 measured and rejected.


**A SECOND critic cycle, and it found more than the first.** Two fresh-context critics ran against the
post-cycle-1 tree and returned 2 P0 + 8 P1/P2 between them, with executed evidence. Four mattered:

- **The marker was scoped to a DATE, not to the pair.** Every consumer tested `handoverDates.has(t.date)`,
  and a released day is an ordinary shopping day on every other account the reader owns. Measured: six
  grocery rows on the handover day, two of them from the pair, and the panel marked **all six** and said
  "6 rows here fall on a day one of your combined accounts was changing connections". The set came from
  `getReconciliationHandoverDates`, built for the tax export — which has no account column and is right to
  be unscoped. Inheriting a helper inherits its SCOPE. Now `handoverKey(accountId, date)`, and
  `toTrendTxns` had to start carrying `accountId` at all, without which /trends silently marked nothing.
- **"A released day can only make a figure too high" — my own comment, and false.** The release is a rule
  about a date, not a sign, so a RETURN both feeds reported subtracts twice. Executed: one $100 purchase
  and one real $30 return doubled renders **"You spent $40.00" against a true $70.00**, with the only
  sentence beside it saying the figure may be too high. A disclosure naming the wrong direction is worse
  than silence — it steers a reader auditing a low number away from the cause. Both sentences and the tax
  export now name both directions.
- **Ask's own drilldown, four lines under the slice's own new sentence.** "Tap to see the transactions
  behind this number" opens a trace that listed the two identical rows unmarked under "✓ 3 transactions
  add up to $130.00". `assistant/trace.ts` was untouched: the slice threaded the ANSWER path and left the
  TRACE path, a second selector over the same rows, with its own un-fed call. Both critics found it
  independently.
- **The tally clause claimed a tally the panel had declined to print.** At exactly one row `BreakdownPanel`
  says "This amount is the whole figure." and suppresses the penny-match, while the basis asserted "These
  rows still add up" — plural, over one row, and with an antecedent that read as *the marked rows alone*
  sum to the figure. The gate is now `statesATally` (`reconciles && rows.length > 1`) at all four call
  sites.

Also executed: the tax CSV still said "both … counted twice", the sentence this slice's own test declares
false at multiplicity ≥ 3; and `combineSuccessFlash`'s PARTIAL branch still promised "count once" eight
lines below the success branch U.13 had already requalified.

**Filed rather than fixed, with the critics' evidence: U.19** (the transactions CSV ships the double
silently while the tax CSV discloses it), **U.20** (Ask's `merchant_spend` and the register's own in/out/net
totals), **U.21** (a doubled RETURN can hold a category at $0.00, and the zero branches then print "No
spending recorded" — closing it needs a second, raw count that survives the category drop), **U.22**
(/reports' page-level total).

**Gate:** `bash scripts/verify.sh` with `VERIFY_E2E=1` GREEN. No `prisma/` diff — read-path and copy only,
so the live Neon database is untouched.


**SHIPPED AND PROVEN LIVE (2026-08-12).** `bash scripts/verify.sh` with `VERIFY_E2E=1` GREEN on the
shipped tree — tsc 0 / eslint 0 / **6,901 passed + 1 expected fail + 1 skipped / 420 files** / build clean
/ **342 e2e passed, 5 flaky-but-passed on retry** (all in `phase5-a11y`, `register-return` and
`transactions` — files this slice does not touch, and the load-induced local flake class the lessons
already record). Committed `0e3d665` → pushed → **CI gate `success`, run 31650606917, attempt 1**, read to
conclusion via `scripts/ci-status.sh` — the full `VERIFY_E2E=1` suite on the Linux runner, which is where
`handover-day-disclosure.spec.ts` actually discriminates the build. Vercel reports `success` on that exact
sha (deployment `FRsWtyzFUFDQa425jkp95aigkSGc`). No `prisma/` diff.

**Live proof: `node scripts/u16-live-deploy-check.mjs` → 13 PASS / 0 FAIL / 4 declared SKIP.** It states up
front that it CANNOT discriminate this deployment and why (no `AccountReconciliation` rows in the seed → no
combined pair → no released day → no demo-visible string differs), and asserts instead the half that
carries the real risk: this slice edited `spendingByCategory`, the selector behind /reports' table, the
dashboard's top-spending card and three Ask answers, and every edit must be INERT for a reader with no
combined accounts. The demo is that reader, and its figures are unmoved (`$299.93` on /reports, `$4,900.00`
on /budgets, `$2,763.00` on /coach), with the new marker and the new sentence correctly ABSENT everywhere.
**U.13's own proof re-run against the same deployment: 6 PASS / 0 FAIL / 3 SKIP** — this money-core change
regressed neither.

**Two bugs in the live check itself, found by running it rather than by reading it.** It first asserted a
`reports-total` testid the app does not have, and then read `body.innerText()` after `domcontentloaded` —
which returns before the client render finishes, so it reported "/budgets renders money: FAIL (none)"
against a page that renders money perfectly well, and reported it *inconsistently between runs*, which is
the tell. A check that races the app is testing the harness. Both fixed (`paintedText()` polls to a
deadline and still fails an genuinely empty page); the corrected script is what produced the 13/13 above.

**Residual filed:** the register (`transaction-list.tsx`) still carries no reconciliation vocabulary, so a
reader scrolling their activity list sees both rows with only the account name to separate them. Different
surface, different question — a list of events rather than a certified total — and it needs its own decision
about whether a per-row marker there informs or just adds noise to every row of a busy day.

---

## 2026-08-12 — U.13: the invariant was the defect, and both critics found real money inside my own fix

**Picked up from the queue** (U.11's measurement session filed it): replaying the shipped
`reconciliationTxnKeepFilter` over the owner's real corpus, of 709 rows the R1 rule drops, 706 were true
duplicates and one was a genuine **+$2,086.40 "Deposit Mobile Banking"** dated exactly the cutover, which
no surviving row replaced — gone from the register, budgets, reports AND the tax export. Reproduced this
session before touching anything, and confirmed with the engine out of the way (`u11i`): the retired
Schwab feed's LAST day IS the cutover 2026-07-21 and it reported one row that day (a −$11.00 Venmo); the
live Plaid feed reported that same Venmo AND the deposit; the retired side holds no row of that amount on
any date.

**The row's prescribed fix was refused on evidence, and the root cause is deeper than the row states.**
The row prescribed "drop a row only when a counterpart is PROVEN on the claiming side, exact amount ±3
days". Measured (`u13a`, new): at ±1 day the corpus has **zero** mid-span losses — the two other rows the
original probe flagged (PGA TOUR SUPERSTORE, DICK'S) are true duplicates the two feeds posted a day apart,
an artifact of its exact-date test. **Every true loss is on the handover day.** The counterpart machinery
addresses a problem the data does not have, and it is not expressible where the rule lives anyway: the
filter is an `(accountId, date)` predicate with ~20 call sites across 13 files, several applying it to
WINDOWED row sets that never hold the claiming side's rows. The real cause is that R1's own invariant —
"exactly one side owns each date, no overlap, no gap" — is unachievable: a handover is an instant INSIDE
a day, and a business date here carries no time.

**Both whole-day awards lose real money** (`u13b`, new): predecessor-owns **$2,086.40**; successor-owns —
the direction the shape suggests, since the live feed is the one still reporting — **$25,574.13 across 24
rows**, because 8 links have a successor that reported NOTHING that day while the retired feed posted its
final trades. Releasing the day to both loses nothing and costs **9 rows / $374.40** of visible
duplication. Ten times the money rides on the direction that looks obvious. Shipped as one comparison:
the claim is half-open at both ends, `[first, claimEnd)`. A refinement (release only when the claim end IS
the feed's last day) was measured and rejected — on all 9 cases those dates coincide, so it avoided zero
duplicates and bought only a branch. Fail-old proven by reverting that comparison; the deposit vanishes
from the output entirely.

**I found one P0 in my own change before the critics did, by asking what ELSE re-implements the rule.**
`combine-connections.ts` computes the claim window twice for its pre-flight guard, and neither copy moved
with the engine — a guard whose own docblock forbids "a window of its own invention" and cites an earlier
critic P0 for exactly that drift. With the inclusive window it over-predicts loss on the handover day and
**refuses the combine outright**, naming a figure: *"1 charge totalling $2,086.40 appears on only one of
them, and combining would stop it being counted."* It would have blocked the very case U.13 exists to
protect. The two sides now need DIFFERENT predicates (`succLoses` exclusive, `predKeeps` inclusive) —
that asymmetry IS U.13. Locked, fail-old proven.

**Two fresh-context Opus 5 critics returned 2 P0 + 10 P1 with executed evidence. The money one is why
this slice is not a one-liner:**

- **P0 (money):** the released duplicate injects a **0-day gap** into `detectRecurring`, which infers
  cadence from gaps. Executed against the real detector: two monthly sightings plus one duplicate became a
  fabricated BIWEEKLY series; a real QUARTERLY bill was **destroyed** (gaps [90, 91, 0] fail the every-gap
  band); a BIWEEKLY $3,000.00 paycheck became **WEEKLY income**, which *understates* the shortfall — the
  direction this codebase names as the expensive one. Those series PERSIST as ScheduledTransaction rows
  into forecast, cash-needed and the calendar. Fixed with `collapseHandoverDuplicates`: on a handover
  date, the same amount from DIFFERENT accounts of one component is one occurrence, for DETECTION only.
  Two rows on the SAME account are never collapsed — a transaction is a FLOW, and two $5.00 coffees in a
  day are ordinary (the U.11 reasoning). Nothing is lost, because a cadence is not a total.
- **P0 (rendered):** the tax CSV — the one artifact that LEAVES the app, and it carries no account column
  — held a doubled deduction under a disclosure block enumerating five reasons a total is too LOW and none
  that it is too HIGH. That silence reads as a completeness claim. The released dates now reach it through
  `getReconciliationHandoverDates`, and the block names the count and says outright that this is its one
  sentence about a total being too high.
- **The P1 the critic proved by mutation, and the one I most needed:** my updated sibling test had gone
  HOLLOW. Both predecessors held one day of history, so post-U.13 both claims were empty and **either link
  could be deleted with the test still passing** — it no longer tested sibling composition at all.
  Refixtured so one sibling has multi-day history whose interior is still de-duplicated.
- Also executed: **multiplicity is not always two.** A chain sharing one cutover releases the date at
  every generation — one $999.99 charge measured at **$3,999.96** — and a predecessor with exactly one day
  of history de-duplicates nothing at all. Both are degenerate shapes where every generation genuinely
  handed over inside that day, so the release stands, but my docblock and EDGE_CASES said "the only date
  that may be counted twice", which is simply false. Corrected in both.
- **Copy:** the "Combined accounts" card headline read **"Counted once per date"**, unqualified, on the
  one surface a reader visits after noticing a double — now "One balance per date", the half that is still
  true (F3 snapshots are untouched). The success flash re-promised "counts once" ten lines from the
  qualification. The span disclosure conflated two windows in one preposition, and asserted a CAUSE
  ("that's the day one connection stopped") that is false whenever the reader drags the cutover input, and
  false by sixteen months for a dormant feed — replaced with "neither connection can be shown to have
  covered the whole of that day", which holds in every shape.

**Verified unbroken rather than assumed:** net worth reads only snapshots and `currentBalanceCents` — no
transaction input at all, so the double cannot reach it (checked myself; the critic independently
confirmed). All three of cash-needed's direct transaction paths are keyed by `accountId`, which the
duplicate does not share. Snapshots, statements, `paymentAccountId` and `supersededAccountIds` are
untouched. The row-count delta reconciles exactly: 10 successor rows sit on a boundary day, 9 are now kept
and **1 is still correctly dropped**, being one predecessor's handover day but STRICTLY INSIDE a sibling's
claim (`u13c`).

**Residuals filed with their evidence rather than papered over:** **U.16** (the glass-box drilldown lists
both rows and green-ticks `reconciles`, and no spending surface — /reports, /budgets, Ask — discloses the
double; the repo already built `cardDuplicateTraceBasis` for this exact shape), **U.17** (a dormant
predecessor's released day can be months before the handover), **U.18** (three docblocks still promise
"counted once", and one describes a `refreshRecurringForUser` exclusion that does not exist in the query).

**SHIPPED AND PROVEN (2026-08-12).** `bash scripts/verify.sh` with `VERIFY_E2E=1` GREEN on the shipped
tree — tsc 0 / eslint 0 / **6,879 passed + 1 expected fail + 1 skipped / 418 files** / build clean /
**345 e2e passed, 0 failed**. Committed `411ff49` → pushed → **CI gate `success`, run 31638502577 on
`411ff496`, attempt 1**, read to conclusion — the full `VERIFY_E2E=1` suite, which is the layer that
caught U.14 and the one a shared-predicate change must never skip. Vercel reports success on that sha
(`HRx8PMDj4v7iZ4T9fFtwu1G7rTMv`). No `prisma/` diff: read-path and copy only, the live Neon database is
untouched.

**Two e2e fixtures had to be repaired, and both for the same honest reason** — they seeded the successor
with a row ON the predecessor's last day, so post-U.13 that connection genuinely OWNS the handover day and
the state each test was named for ('counted-elsewhere' / 'No history of its own') was no longer reachable.
Moved the successor's rows strictly inside the claim so each tests its stated property again, and locked
the new state separately rather than deleting the old one. The register e2e moved $150.00 → **$220.00** on
an unchanged fixture: $150.00 is the de-duplicated figure and the extra $70.00 is the single handover day,
which is the slice's cost rendered on a real screen.

**Live proof:** `node scripts/u13-live-deploy-check.mjs` against production → **6 PASS / 0 FAIL / 3
declared SKIP**. It states up front that it CANNOT discriminate this deployment — the demo seed writes no
`AccountReconciliation` rows, so no combined pair, and therefore no handover day, can render as the demo
user (the same limit U.5, U.9 and U.15 recorded). What it does prove is the half that carries the real
risk: with no effective links the boundary returns its inputs by reference, so the demo must be unmoved by
a claim-span change — register rows, reports figures and account balances all intact, and no combined or
handover copy anywhere on a user who has no linked pair.

**Production replay after the change** (`u11c`, the probe that found the defect): the **$2,086.40 deposit
is kept**, and silent loss on the corpus goes to **zero** — the two rows it still flags are the ±1-day
duplicates decision 3 identifies, not losses. Kept 1517 → 1526, and `u13c` accounts for all nine.

## 2026-08-12 — U.14 SHIPPED AND REVERTED THE SAME SESSION (2 P0s, one caught by CI); U.15(a) audit built on top of the reverted evidence

**The owner asked for the re-audit screen** ("yes please do that", after being offered the undo or
the screen). Read as the screen — the durable option, and the non-destructive one. **No production
data was changed at any point this session.**

**U.14 first, because the screen would otherwise be a half-truth:** today's detector refuses only 4
of the 9 wrong links, so the audit would have stayed silent on 5. The cause was clean —
`masksDiffer`, the veto disqualifying the weak NAME signal when two rows carry different last-4s,
read the `mask` COLUMN, which SimpleFIN never populates, so it was inert across exactly the
SimpleFIN→Plaid migration the feature exists for. MEASURED before writing
(`u11k-which-veto-catches-which.mts`): the row's own prescription (widen to `matchableMask`) catches
5 of 9, not 9 — `maskFromName` reads FOUR digits and these names carry three. A rule reading account
numbers the way feeds render them catches 9 of 9 with 0 of 8 genuine links suppressed. A third rule
(bare `\d{3,}` sweep) matched that score by reading "529" out of "Schwab 529 Plan" — right by
accident, rejected.

**Shipped `bc7ca79` on a local green, and both P0s were found within the hour.**

* **P0-1 (fresh-context Opus critic, executed):** the widened parser reintroduced exactly the
  direction `#292` and dup-veto critics F1/F2 removed — and worse, it read TWO digits where the
  banned `maskFromName` reads four. `Roth IRA (2021)` yields "2021", so a genuine duplicate against a
  real mask stopped being flagged AT ALL: a hidden duplicate is a silent double-count, the direction
  this file exists to avoid. The comment forbidding it was three lines above the new code.
* **P0-2 (the critic AND, independently, the CI gate):** the scope claim was TRUE of the boolean and
  false of the consequence. `duplicateSignals` also feeds `detectReconciliationCandidates`, where
  suppressing ONE candidate collapses a withheld L.9 ambiguity into `list.length === 1` — which
  renders a **one-click Combine** for the survivor. `tests/e2e/reconcile.spec.ts:237` ("a Roth is
  never offered against a Traditional — the wrong pair is vetoed, the right one offered") FAILED in
  **CI run 31627590689**.
* **P1-5:** the critic's mutation test survived **5 of 8** mutations to the new regex, including
  deleting the entire `[•·*#]` class. The locks were nearly as weak as the code.

**Reverted in `b95d905`.** `masksDiffer` restored to the mask column byte-for-byte. The MEASUREMENT
was never the problem — its POSITION was: evidence too dangerous to GATE on is not too dangerous to
SHOW. The repaired parser (parenthesized years excluded, prefix as well as suffix correspondence for
names this app's own 80-char `mapSimplefinAccount` truncation cuts, whitespace after bullet masks)
now feeds ONLY the U.15 advisory audit, where a wrong flag is a visible sentence beside an Undo the
reader already had.

**The process failure, recorded because it is the repeatable part:** `scripts/verify.sh` skips
Playwright without `VERIFY_E2E=1`. It returned green (6,858) and that was reported as shipped; CI
runs the full gate and caught it. Rule 5 already says the CI conclusion is the SHIP gate. A change to
a predicate with more than one consumer is the LAST change that should ever be called shipped on a
local green. Lesson filed: `a-vetos-blast-radius-is-not-the-booleans-scope.md`.

**U.15(a) BUILT (not yet gated in CI at the time of writing).** `auditConfirmedLinks`
(`src/lib/engine/account/link-audit.ts`) re-audits every confirmed supersession. It stands on two
independent grounds — the shipped detector's refusal, and the repaired conflict evidence — and it is
careful about what it may claim: `not-checkable` for the detector's ABSTENTION (two rows in one
provider connection, which it does not judge), `inert` for a missing side, and never an assertion
that the accounts differ, because the user confirmed the pair and may know what no feed carries. The
rendered line lives in `continued-accounts-view.ts` as pure copy (a rule in a `.tsx` cannot be
locked) and appears inside the EXISTING "Combined accounts" card next to the Undo that was already
there — the affordance existed; what was missing was the evidence. Validated against production:
flags exactly **9 of 27**, agreeing exactly with the independent per-link method in `u11e`.

**Gate + live (rule 5 / K.8).** `bash scripts/verify.sh` GREEN on the reverted tree — **6,869 passed
/ 1 expected fail / 1 skipped / 418 files**, build clean, tsc 0, eslint 0. **CI run 31629656208 on
the revert `b95d905` = SUCCESS**, and **CI run 31630929344 on `dc3ae5c` (U.15(a) + its e2e) =
SUCCESS, attempt 1** — the full `VERIFY_E2E=1` gate, which is the layer that caught U.14 and the one
a shared-predicate change must never skip. Vercel reports success on `dc3ae5c`
(`83ZHAY8QZy2RB5RSStL3R6nAdQPN`); live: `/sign-in` 200, `/accounts` 307 to the auth gate as designed.
No `prisma/` diff — read-path and copy only, the live Neon database untouched.

**What the live check CANNOT show, stated rather than dressed up.** The audit flag needs a confirmed
`AccountReconciliation` between two accounts whose evidence conflicts, and the demo seed writes NO
reconciliation rows at all — so no combined card, and therefore no flag, can render as the demo user.
The same limitation U.5 and U.9 recorded. The behaviour is proven instead by `combined-accounts.spec.ts`
in a real browser at 380px on a throwaway user seeded with a flagged pair AND a clean control, and its
fail-old was proven RED by emptying the conflict evidence — **but only after a rebuild**: the first
sabotage run came back green because Playwright reuses the running server and tests the last
`next build` (`docs/lessons/e2e-runs-a-stale-build.md`, this repo's own lesson, walked into anyway).

**e2e:** `combined-accounts.spec.ts` 4/4 and `reconcile.spec.ts` 4/4 on a fresh build, including
`:237` "a Roth is never offered against a Traditional", the test that caught U.14's P0-2.

## 2026-08-12 — U.11 MEASURED, NOT BUILT: the task row's premise has zero true instances in production, and the scary number it implied is not real

**Nothing shipped this session. Six read-only production probes, no code change, no push.** U.11's
row demands the failure direction be decided "on evidence — how often two feeds of one account
actually disagree within an overlap — not inherit it". The evidence says the row's own fix would
have destroyed real accounts, and the alarming figure it implies collapses to $990.49 once checked.

**1. The sibling shape exists — and not one instance is what U.11 assumed.**
`u11-sibling-overlap-census.mts`: 27 live links, 17 components, **5 successors carrying more than
one live predecessor**. U.11 describes these as "one real account connected twice". They are not.
Every genuine one-account-two-feeds pair in the same database agrees **98–100%** on transactions
inside the overlap (Venture 6271 338/338, Chase Sapphire 54/54, Delta 7/7, Investor Checking
171/172); every sibling pair agrees **0%** (Vanguard Roth 5351 × Schwab Rollover 584: 0 of 14;
Chase M.LEE × Chase E.LEE: 0 of 12). Three distinct Schwab 529 plans sit under one Vanguard 401k;
three distinct Schwab IRAs under one Vanguard Roth IRA. **De-duplicating siblings by claim span —
U.11's prescribed fix — would have silently deleted 100% of the losing side's rows in every
instance that exists.** The direction is therefore decided and now measured: proven match, never
claim span. Today's sibling behaviour (they do not de-duplicate each other) is correct.

**2. The $468,840.29 does not exist, and finding that out took one more probe.** Nine stored links
pair rows advertising different account numbers, and R2 zeroes a predecessor's balance, so the
arithmetic said $468,840.29 had been removed from net worth. `u11h-does-the-money-already-count.mts`
falsifies it: **$467,849.80 of that is already counted through the correct live Plaid twin** —
"Schwab US Rollover IRA ...584" ($61,762.92) is zeroed while Plaid's "Rollover IRA" 0584
($54,699.42) counts, and so on for every IRA and 529. The stale row *should* stop counting; the
wrong link reaches the right total by the wrong reasoning. **Genuinely missing: $990.49** — Chase
E. LEE (4034), a real separate card with no twin anywhere, whose balance is a CREDIT liability, so
net worth is overstated by that much. (An earlier probe run classified links by
`matchSignal`/`confidence` and printed $1,379,513.62; that bucket mixes genuine pairs with wrong
ones and the number is void. A third draft called a genuine $898,889.99 brokerage pair WRONG because
Schwab renders "...383" where Plaid's mask is "7383" — suffix, not equality. Both errors were caught
by inspection before anything was reported, and both are recorded here rather than quietly dropped.)

**3. A real silent loss, and it is the CHAIN rule, not U.11.** `u11c-silent-loss-today.mts` replays
the shipped `reconciliationTxnKeepFilter` over the owner's real corpus: of **709 rows it drops, 706
are true duplicates** — the rule works — but **one is a genuine $2,086.40 "Deposit Mobile Banking"
on Investor Checking dated exactly the cutover**, which the predecessor never reported and which no
surviving row replaces. It is gone from the register, budgets, reports and the tax export. (Two more
flagged rows are the same purchases posted a day apart by the two feeds — PGA TOUR SUPERSTORE 06-12
vs 06-13 — so they are covered, and they are why a match rule needs a ±3-day tolerance.) This
violates the engine's own stated failure direction, quoted at `reconcile-boundary.ts:329-331`: "a
visible, advisory-covered double, never a silent loss."

**4. The proposer still offers 15 wrong pairs today.** `u11f` / `u11g`: of the 9 provably-wrong
stored links, **4 today's detector now refuses** (the registration veto shipped after the owner's
2026-07-24 report) and **5 it would still propose** — three Schwab 529 plans matched to a Vanguard
401k on the single shared token **"plan"**, and two cards matched on **"lee"**. `masksDiffer` already
disqualifies the weak name signal on its own, but reads the `mask` COLUMN, which SimpleFIN never
populates — so the veto is structurally inert across exactly the SimpleFIN→Plaid migration this
feature exists for. Widening it to the `matchableMask` the positive path already uses suppresses
**15 of 85** proposed pairs, every one of them a different account, including the owner's + spouse's
Ventures that `duplicates.ts:189-191` already promises stay hidden. Nothing re-examines a stored
link, so the 4 the app would now refuse keep being honoured — `prevention-is-not-a-remedy` exactly.

**5. A fifth claim of my own, tested and falsified before it could mislead the next session.** The
first draft of TASKS U.15 asserted the net-worth TREND could plot an unrelated account's balance,
since post-U.9 exactly one snapshot survives per (component, date) and these components hold up to
five unrelated accounts. `u11j-which-snapshot-wins.mts` runs the real boundary over the real rows:
in **every** mis-paired component the survivor is the LIVE terminal successor — $368,665.83, $24.00,
$15.71, $974.49 — never a stale sibling, because every cutover is already in the past so no stale
side is still covering and the tier order reaches the right row. The claim is struck from the row.
**The remaining harm from the 9 links is ATTRIBUTION, not arithmetic:** the owner's Schwab IRA and
529 history hangs off the wrong account and the app asserts an identity that is not true.

**Probes committed (all read-only, every statement a SELECT):** `u11-sibling-overlap-census.mts`,
`u11b-sibling-pairing-truth.mts`, `u11c-silent-loss-today.mts`, `u11d-networth-cost-of-mispairs.mts`
(superseded by u11e/u11h — kept with its method named as the proxy error it was),
`u11e-per-link-verdict.mts`, `u11f-would-today-propose-these.mts`, `u11g-measure-the-number-veto.mts`,
`u11h-does-the-money-already-count.mts`.

**Gate (rule 5 / K.8).** No app code changed all session — docs, task rows, a lesson, and ten
read-only probes — so there is no slice to call shipped. Static checks run locally: `npx tsc
--noEmit` 0, `npx eslint .` 0. Pushed `62cd821`; **CI run 31624210105 = SUCCESS, attempt 1**,
read to conclusion (job `verify`, the full `VERIFY_E2E=1` gate). The earlier run 31623667389 on
the intermediate sha `8c56925` shows `cancelled` — this session's own later push superseded it
under `cancel-in-progress: true`, which is rule 5's documented "re-run against the newest sha",
and 62cd821 is that newest sha. No `prisma/` diff — the live Neon database is untouched.

**NEXT:** three slices, ranked — (a) the $2,086.40 chain-rule silent loss (drop a row only when a
counterpart is proven, ±3 days, exact |amount|); (b) the widened last-4 veto on the weak name signal,
measured above; (c) the owner-only decision on the 9 stored links, which is data, reversible via
R9, and his to make. U.11 as filed should be CLOSED as measured-and-refused, not built.

## 2026-08-11 — O.20b SHIPPED: /reports payload measured on the heavy real account — 13.2× carry measured (not ~6×), both prescribed fixes falsified, the one dead weight was /dashboard's 89%

**The queued task measured first, per its own instruction.** New read-only probe `scripts/audit-probes/o20b-reports-payload.mts` (the o20a pattern: raw `pg` against production, the shipped engine functions composed exactly as `getReports` assembles them — with the merchant JOIN `registerDisplayName` reads, because byte size depends on the label; every statement a SELECT). **Real user, 6-month window: 316.9 KB payload, `monthFlows` 282.6 KB (89%) — 1,415 rows across 12 bars, largest bar 305 rows.** 12-month 403.4 KB, 24-month 508.7 KB. The one-month baseline (the shape the feature predates) is 21.4 KB ⇒ **the six-month carry is 13.2×, not the row's guessed ~6×** — complete trailing months hold more rows than the asOf-clamped current month. Both prescribed fixes falsified on evidence: the per-bar fetch breaks the same-array guarantee (the row's own framing — a re-query can sum to a different number than the painted bar); `rawDescriptor` is a RENDERED panel line (breakdown-panel.tsx:256-263) on 86% of the real user's rows — trimming deletes a displayed feature to save ~44.5 KB (14%). The /reports six-month carry IS the O.20 feature and stays (decision, not default).

**The one measured dead weight was /dashboard:** it pays 282.6 KB (89% of its reports payload) for rows no surface on the page renders — its call reads exactly four fields (`breakdown`, `breakdowns`, `ym`, `notCountedYetCents` — TopSpendingCard's props). Shipped: `getReports(userId, months, { includeMonthFlows: false })`. ONE assembler stays one author for both callers — a second lean function would be a second copy of this composition, the drift shape the repo's panels exist to prevent; /reports always ships the rows, the dashboard's figures are byte-identical by construction. Two new locks in `tests/unit/spend-window-parity.test.ts` (opt-out yields `monthFlows: {}` while every dashboard-read field equals the full payload; the default payload's June expense bar row count locked). **Fail-old proven by mutation:** deleting the opt-out from `server/reports.ts` turns the lock red at `expect(lean.monthFlows).toEqual({})` — 1 failed / 1 passed / 23 skipped; reverted, 2 passed. All decisions and the measured table in DECISIONS #448; ledger reindexed.

**Gate:** tsc 0 (probe type-checks under the one-off `.mts` `--project` check — O.20k mechanism, temp tsconfig deleted before commit; the same check surfaces 21 pre-existing probe errors, the documented Wave G class) / eslint 0 / parity suite 25/25 / ledger test 16/16. Full `bash scripts/verify.sh` and the CI read recorded once they land. No `prisma/` diff — live Neon untouched.

## 2026-08-11 — O.20k SHIPPED: the O.20g probe's boundary bug fixed, its magnitudes re-verified, the record corrected

**The residual O.20a filed.** `scripts/audit-probes/o20g-creep-income-refunds.mts:152` called the keep closure as `keep({accountId, date})` — a single object — while `reconciliationTxnKeepFilter` returns `(accountId: string, date: string) => boolean` (reconcile-boundary.ts:383). Silent no-op: the object fails every keyed lookup and the closure returns `true` for every row, so every probe-computed magnitude in DECISIONS #445 / TASKS O.20g / STATUS §O.20g / EDGE_CASES.md / the O.20g lesson double-counted reconciled predecessor/successor pairs. Fixed (one line), re-ran against production. **Result: the first-half income median $10,604.95 → $0.08 reproduces exactly and the verdict state is unchanged** — O.20g's direction and shipped engine fix confirmed; the rest of the magnitudes were tainted: refused positives 67/$38,619.68 → **42/$28,673.90**, shipped income growth 70,470,525% → **40,607,025.0%**, spend growth ~153% → ~59.7% (approx meta), "seven orders of magnitude" → five. The boundary's effect landed entirely in the second half (implied $56,376.42 → $32,485.70 median). Also fixed: the probe's latent `.mts`-invisible type error (`Acc` missing `currentBalanceCents`, the O.20a critic's exact class) — the one-off `--project` compile now exits 0. Swept all nine boundary-using probes: every other call site already uses the two-arg form. Record corrected at all five sites; ledger row added; the `.mts`-invisible-to-tsc class stays OPEN as Wave G.

**Gate:** see STATUS.md §O.20k for the full record, CI run id, and evidence.

## 2026-08-10 — O.18g SHIPPED: the conscious-buckets e2e binds its savings else-branch

**The task (carried from O.18f):** the demo dataset can never reach the state where a working savings figure renders WITHOUT the adjacent "Set a savings target" control — the demo's savings is provably always $0 (no seed target/goals; the settings dial is demo-fenced) — so the else branch was unit-locked only and the demo test passed vacuously over it. **Direction:** keep the branch (it is real L.29 behavior for unset-$0 users, plan-row-labels.ts:579-587) and bind it in the e2e. The demo test pins its provable $0 with a binding control assertion (fixture fact, cross-referencing the throwaway test); a new throwaway-user test (the trends-caps / reports-total idiom) seeds the working state by construction — a checking account, two complete POSTED paycheck months ($5,000.00 × 2 under the pinned DEMO_TODAY=2026-06-10), `savingsTargetBps=2000` → pattern $5,000.00 → $1,000.00 planned savings — with an anti-vacuity chain (strip visible, savings > $0, panel penny-match, reconciled clause) that must prove the state binds before the `toHaveCount(0)` control assertion. Spec 2/2 green on first run (25.5s; the new test 2.9s). Full gate RED on ONE documented K.8 flaky member (`transactions:735` — isolation-proven pre-existing, passes on retry in isolation, diff-untouched), 4 flaky absorbed; shipped with the failure named per K.8 (records in STATUS.md §O.18g, DECISIONS #443).

## 2026-08-10 — K.7 SHIPPED: the obligation owns a loan payment — one engine, three surfaces, two executed critic P1s fixed

**The ownership rule (DECISIONS #437).** `splitLoanCarriedScheduled`
(`src/lib/engine/loans/duplicate-projection.ts`) — one pure function, consumed by
/calendar, /forecast and /radar — splits scheduled rows into kept/suppressed: a
detected row C.25 has PROVEN to be a loan obligation's own payment is not projected
a second time. Suppression is capped 1:1 and never free-standing: a row drops only
when a C.25 fact names a loan account that is in THIS call's obligation list at THIS
row's amount, and at most as many rows as facts cover the (canonical|amount) key
(each fact proves ONE carried payment per month — a canonical shared by two loans
can never lose the undatable one's payment, #400's failure direction). The radar's
`loanOverlap` disclosure was re-derived to ask the honest question — does a
SURVIVING outflow match an obligation's amount? — so a proven overlap stays silent
and an unproven one is still counted twice, disclosed.

**Hostile critic (Opus, fresh context): FAIL, 2 executed P1s → fixed, each
sabotage-proven RED on its own lock.** F1: the rule was INERT on the real pipeline
chain — C.25 mints its fact canonical from the RAW ACH descriptor via a
KNOWN_MERCHANTS pattern (`ACH WITHDRAWAL CARMAX AUTO FIN 4421` → `CarMax Auto
Finance`), the detector persists that canonical as the series description, and
re-deriving `normalizeMerchant('CarMax Auto Finance')` falls back to title-casing
(`Carmax Auto Finance`) — exact-string keying could never meet. Both sides now
normalize before keying. F2: (canonical|amount) suppression had no per-row
attribution — two loans sharing one canonical (Nelnet) with one undatable lost BOTH
payments; the covered-count cap fixes it. F3 (P2): the /calendar wiring line was
unwitnessed — a page-render test (jsdom, mocked auth + getCashNeeded, real prisma)
now locks it; sabotage-deleting the split reproduced the defect in markup (Jul 2
`Auto Loan due` −$385.00 AND Jul 5 `CARMAX AUTO FINANCE` −$385.00). F4 (P2)
recorded residual: the radar disclosure fires on amount-equality alone, hedged,
over-hedge-safe. F5: DECISIONS count corrected (13 engine / 24 across the four K.7
files).

**Gate:** tsc 0 / eslint 0 / **6,575 unit + 1 skipped / 398 files** / build clean
(the first `verify.sh` invocation failed once on a cold start and passed on the
rerun — the documented environment-flake class, not a code defect); e2e
payment-reminders + forecast + calendar-posted **9/9** on a fresh build, including
the `Auto Loan due` July lock (business-day-adjusted 07-02). Regression ledger row
added; TASKS K.7 → DONE; STATUS §K.5 amended. Production's stale demo dataset
(no obligation, detected series only) remains owner-only (TASKS 0.3).

**CI stop-and-fix (K.8, run 31357353819, sha 324c717):** the first CI read on the
shipped K.7 slice FAILED the new forecast lock — `expected length 3 but got 6` at
`tests/unit/forecast-server.test.ts:126`. Root cause (reproduced 1:1 by the full
local suite): the recurring detector pollutes the shared demo — an earlier file
(`simplefin-history-backfill-server.test.ts:522` syncs `user-demo`, and
`simplefin.ts:768` `refreshRecurringForUser` persists the detector's learned rows)
— so user-demo's snapshot already held ONE detected `CarMax Auto Finance` −38500
row when the K.7 fixture appended its own. The engine's 1:1 fact cap correctly
suppressed one of two rows; the survivor expanded 3× over the 90-day horizon (6
events). The engine is correct; the FIXTURE was not deterministic under suite
state. Fixed in `e4721d4`: the armed overlay now drops any pre-existing scheduled
row with the same (normalized canonical | amount) key before appending its own.
Re-verified: isolated file 4/4, full suite 6,575 passed / 0 failed, FAIL-OLD
probe re-proven (deleting the `splitLoanCarriedScheduled` call in `forecast.ts`
still yields 6). **CI run 31359227811 on e4721d4: SUCCESS.** Deploy on e4721d4
(deployment 5826860369, `aimplifi-jnsomw6rl`) READY; `k7-live-deploy-check.mjs`
**7/7 PASS** — build-id discriminator (www serves the new build
`vT9FUQGbmotASmvKpenJ3`, old deployment serves `cpo-kt9TVyQCT2weegly6`), demo
sign-in, /calendar passthrough paints the detected series, abstention (no `Auto
Loan due`, nothing suppressed), zero client errors. Final push `d45a969` (deploy
script only, same app code).

**Post-ship flake chain and resolution (K.8):** five consecutive failed gate
reads after 31359227811 — runs 31360315737 (transactions.spec.ts:638 ×2
attempts, then SUCCESS), 31362750997 (transactions.spec.ts:638), 31363585943
(category-rename.spec.ts:110 + mobile-overflow.spec.ts:386 ×2), 31366324555
(recurring-verdict.spec.ts:61), 31367228157 (transactions.spec.ts:638 at a NEW
line, second-import >90s stall). Every failure: a test NOT touched by its push
(each push's touched test passed in that run), on an app tree byte-identical
to the 06:05 pass, in the documented harness classes (≥60s server-action
stalls under 4-worker shared-SQLite, WebKit reflow timing). Four targeted
e2e-window hardenings shipped: transactions 30s→90s + 240s budget (29b5a0d),
mobile-overflow fit-sweep poll 4s→8s (09d7fad), recurring-verdict navigation
20s→90s + 240s budget (ba60293), transactions second block 90s→180s + 480s
budget (b8dbe8b) — each fixed its test on the next run. **CI run 31368294618
on b8dbe8b: SUCCESS** — the gate is green again; full ledger in STATUS.md.
Deploy on b8dbe8b (`aimplifi-jd98id3yp`) READY; `k7-live-deploy-check.mjs`
**7/7 PASS** — www serves the new build `E6idweuWQNx4uX5Iyb6Bc` (old
deployment serves `vT9FUQGbmotASmvKpenJ3`), demo passthrough + abstention
intact, zero client errors. No app code changed all morning; the K.7 engine
and its three surfaces shipped in 324c717/e4721d4 and never moved.

**K.8 close-out, run 31369410049 (sha c884f32, docs-only): CLOSED PER §K.8.**
Two tests failed in one run — `combine-connections.spec.ts:67` @ :108
(confirm-click server action → net-worth re-render never arrived in 20s;
stable pre-click `-$2,000.00`, severed-flight class, no retry structure on
the click) and `transactions.spec.ts:638` @ the second-import toPass (same
mode as 31367228157, exceeding even the 180s window — the ≥60s documented
stall class is unbounded under runner load). Both tests are untouched by the
docs-only push and passed BOTH full green gates (06:05, 08:00) on the
byte-identical app tree — proven pre-existing per the §K.8 clause, so the
slice closes with the record (full ledger in STATUS.md). No further window
raising: the stall exceeded 90s AND 180s, so the harness itself is the open
issue — worker-isolated e2e DBs or workflow-level retries is the follow-up
(TASKS candidate), not more windows. K.7 status stands: engine + three
surfaces shipped in 324c717/e4721d4, gate green at 31359227811 +
31368294618, deploy proven live 7/7, critic-clean (Opus pass completed
pre-ship per the record above).

## 2026-08-09 — K.7 diagnosis: BOTH candidate causes were wrong, and the real one is a double-charged loan payment

**Decided by execution, not inspection, exactly as the K.7 row demands.** The row offered two
candidates — (a) `selectLoanObligations` yields nothing for the demo loan and a detected series
stands in silently, or (b) the obligation exists and /calendar is not receiving it. **Neither is
the defect.** Four probes, all committed under `scripts/audit-probes/`:

1. **On a FRESHLY SEEDED database the demo is correct** (`k7-loan-due-probe.mts`, fresh temp DB):
   the snapshot holds `acct-autoloan` with `minimumPaymentCents=38500, dueDayOfMonth=5`,
   `getCashNeeded` returns one obligation (raw `2026-07-05`, effective `2026-07-02`), and
   /calendar's engine paints `Auto Loan due` in every month from the anchor forward (Jul 2026 →
   Mar 2027 swept, 1 `loan-due` each). The current month (Jun, today=2026-06-10) correctly paints
   none: the June 5 payment already passed and the engine never back-dates an obligation. There
   is no scheduled auto-loan row at all — `seed/build.ts:550` is honored.
2. **Production reproduces the owner-visible symptom exactly** (`k7-live-probe.mjs`, read-only,
   signed into the shared demo): Jul/Aug/Sep/Oct/Nov 2026 each paint `Auto loan — CarMax` with
   the **scheduled** badge and **zero** `loan-due` rows — the 2026-08-06 observation, re-executed
   2026-08-09 against the current deploy.
3. **Production holds NO dateable obligation** (`k7-live-obligation-probe.mjs`): /accounts shows
   the account (`Auto Loan · Loan ····6619 · −$14,300`), /dashboard names it nowhere, and
   /forecast names it as `Auto loan — CarMax` — the SCHEDULED row's description, not the
   obligation's `Auto Loan` label. Same code as (1), opposite result ⇒ **the difference is DATA.**
   Production's shared demo dataset predates `c3a329b` (#96, which added `minimumPaymentCents`
   to `acct-autoloan`) and `859ab29` (#134, which deleted the hand-authored `sched-autoloan`
   row). It has been seeded once and never reseeded.
4. **THE REAL DEFECT** (`k7-double-count-probe.mts`, throwaway DB, guarded on `DATABASE_URL`
   containing `probe`): `server/radar.ts` already documents an accepted #134 residual — "a loan
   whose bank ACH was ALSO recurring-detected as a checking scheduled row counts twice (no
   structural key links them; heuristic money-matching rejected)". **It had never been
   executed, because neither state in this repo exhibits it**: the seeded demo has an obligation
   and no detected series, production has a detected series and no obligation. Writing ONE
   `ScheduledTransaction` shaped exactly as `server/recurring.ts` persists a detected series
   (source `recurring`, description = merchant canonical, on the payment account) produces:
   **/calendar July: 2 rows at $385.00** (`loan-due Auto Loan due` on the 2nd + `outflow CARMAX
   AUTO FINANCE` on the 5th); **/forecast: 6 events at $385.00 over 90 days instead of 3**,
   total outflow `-231000` cents instead of `-115500`, **ending balance $12,495.00 → $11,340.00.**
   A balance projection that prints "dips below $0 on DATE" is subtracting the same contractual
   payment twice every month.

**Why this is reachable for a real user and not just a fixture:** `classifySeriesProjection`
(`recurring/detect.ts:665`) has no loan-payment gate, so a monthly loan ACH on the payment
account is `counted` and persisted as a scheduled row; a Plaid mortgage/student/auto loan
independently carries `minimumPaymentCents` + `dueDayOfMonth` from `/liabilities/get` (#134),
which is exactly the obligation. Both fire together on the normal shape. /forecast's own comment
("a LOAN/MORTGAGE payment ... is NOT in `snap.scheduled`") is a demo-seed fact stated as a
general one.

**The structural key #134 said did not exist has since been built.** C.25 (DECISIONS #403,
`engine/categorize/loan-payment-flows.ts`) links a checking merchant canonical to ONE specific
loan account by ≥2 distinct calendar months of ±3-day same-|amount| pairs, refuses aggregate
canonicals, requires a dateable obligation, and requires exact amount equality — and the app
already stakes the user's SPENDING TOTALS on that link being real (those charges are removed
from flows precisely because they are "carried elsewhere — the committed / forecast / calendar
line"). A link trusted to delete a charge from spending is trusted to stop projecting it twice.

**NEXT:** build the ownership rule — the obligation owns a loan payment; a detected scheduled
row that C.25 has already proven to be that same payment is not projected a second time — as one
pure engine function used by the three surfaces that combine both sources (calendar page,
forecast, radar), plus the coverage K.7 asks for (a `loan-due` lock on /calendar). The radar's
`loanOverlap` disclosure must then describe only the REMAINING unlinked overlap, or it will warn
about a double-count that no longer happens. **BLOCKED (owner-only):** production's stale demo
dataset — reseeding a shared production dataset is destructive and TASKS 0.3 says "Do not seed",
so it is the owner's call, not this session's.

## 2026-08-07 — H.6 diagnosis: the 730-day link is not missing, it is being DISCARDED

Owner, verbatim: *"Unacceptable we don't have at least plaid maximal dates."* He is right about the
data and the cause is ours, not Plaid's.

**Established this session, each by reading the code or Plaid's own reference — no inference:**

1. **Plaid's ceiling is 730 days and the window is frozen at Item birth.** `/link/token/create`
   → `transactions.days_requested`: *"Once Transactions has been added to an Item, this value
   cannot be updated"* (plaid.com/docs/api/link/, fetched 2026-08-07). The documented remedy is
   `/item/remove` plus a fresh trip through Link. Update mode cannot widen it.
2. **We already ask for the maximum on every NEW link.** `PLAID_DAYS_REQUESTED = 730`
   (`plaid.ts:189`), sent at `plaid.ts:293`, bound-locked in `tests/unit/plaid-oauth.test.ts`.
3. **The owner's 13 items were all created 2026-07-23/24**, a week before that shipped
   (2026-07-31), so every one carries Plaid's 90-day default. The measured floor —
   oldest Plaid row anywhere `2026-04-24` (K.2, re-measured live 2026-08-06) — is exactly
   `2026-07-23 − 90d`. The arithmetic closes; there is no missing data to find.
4. **The date-ranged `/transactions/get` backfill cannot rescue them.** `backfillItemHistory`
   asks the full 730-day window (`plaid.ts:1774`) and returned `added: 0` on all of them,
   because Plaid holds nothing outside the window the Item was born with.

**The finding that turns this from an owner-click gap into a code defect:** the owner cannot
fix it himself, because the app refuses the link that would. A fresh Chase link returns only
accounts he already has, so `classifyNewItem` marks it `whollyRedundant` and
`decideAndPersistItem` hands the new Item straight back to Plaid via `/item/remove`
(`plaid.ts:505-522`) — keeping the 90-day connection and destroying the 730-day one. That
branch is L.10 layer 2 working exactly as designed for the case it was built for (*"when I try
to link same account again, it just refreshes"*, owner 2026-07-24). A deliberate re-link for
DEPTH is the one case where "it just refreshes" is the wrong answer, and nothing today can tell
the two apart.

**Everything downstream of that branch already exists and is critic-hardened**, which is why the
fix is small rather than the 90k rebuild TASKS H.6 budgeted:

* `combineDuplicateConnections` (`src/server/combine-connections.ts`) already combines two LIVE
  connections at one bank, drops the loser, revokes it, and records one reconciliation per
  proven account pair.
* `applyReconciliationBoundary` already makes the pair read as one account — and it already
  decides this exact case in the right direction: the successor keeps rows OUTSIDE the
  predecessor's claim span, so *"the successor's deeper backfill is NEVER dropped"*
  (`reconcile-boundary.ts:17-23`, critic cycle-1 F2). The deep history survives the combine.
* The pairing is user-confirmed and reversible (`AccountReconciliation.undoneAt`, R9).

**Decision (DECISIONS #424): thread one explicit owner intent through the front door.** A link
started from a new "get the full two years" affordance is exempt from the wholly-redundant
discard; the ordinary front door keeps refusing exactly as it does today, so L.10's promise to
the owner does not regress. Failure direction is the safe one by construction — a spoofed or
mistaken intent yields a duplicate the app already discloses (#299/#306), can combine (#304),
and can undo (R9), never a revoked credential, which is the asymmetry
`plaid-link-collision-wiring.test.ts` was written around.

**BUILT AND GATED (verify green: tsc 0 / eslint 0 / 6,232 unit + 1 skipped / 379 files / build
clean; e2e 2/2 new + 12/12 adjacent).** One explicit owner intent, carried from a new /accounts
door through the OAuth round-trip into the provider, exempts that link from the discard and
nothing else. Two sabotages: removing the exemption kills exactly its own lock; leaking it to
every link fires 9 of L.10's tests.

**Caught by the existing suite, not by me:** gating the new outcome on redundancy alone told an
owner whose REVOKE had merely failed that he had connected a bank "on purpose" — a claim about a
decision nobody made. The branch is gated on the intent, not the shape.

**Fresh-context critic (isolated, had not seen this reasoning): 0 P0, 4 P1.** Three fixed in
cycle 1, one split out because its fix is a money-adjacent planner change that needs its own
critic:

* **F5 (fixed) — the flash promised a remedy that can refuse.** `whollyRedundant` only requires
  the NEW login to reach nothing new; the OLD connection may reach more, and combine offers a
  direction only when dropping that side strands nothing. Critic executed it: with old =
  ····0977 + ····1234 and new = ····0977, the ONLY offered direction drops the new connection.
  The outcome now carries `combinable` (computed against the connection the collision NAMED, from
  what it answered `/accounts/get` with a moment ago, not from its stored rows) and the copy has
  two closing sentences instead of one.
* **F6 (fixed) — "combine now" raced Plaid's background historical pull.** The deep window
  arrives on later syncs, and combining REVOKES the Item fetching it. The copy now says to wait
  until the older transactions are visible. Locked on both branches.
* **F4 (fixed) — the three lines that actually CARRY the intent had zero coverage.** Deleting the
  `{ deepenHistory }` argument left every other test in the slice green while the feature
  silently reverted. New jsdom spec `tests/unit/deepen-history-wiring.test.tsx`; two sabotages,
  each killing exactly its own pair (drop the server argument → 2 red; drop the stash argument →
  2 red).
* **F2 (disclosed, fix split to H.6b) — the explainer promised the owner's hand-filed work would
  survive, and the critic executed the combine and disproved it.** `handoverDate` clamps the
  cutover to the predecessor's FIRST transaction whenever the successor reaches further back,
  which is what a successful deepen guarantees, so the old side keeps one day and its categories,
  notes and splits stop being applied. That sentence is now an amber caveat stating the cost,
  e2e-locked as its own element so it cannot be lost in an edit to the paragraph above it.
* **F1 (mitigated, fix split to H.6c) — the combine card's PRIMARY button drops the deep
  connection.** `keepRank` ties on health and same-day sync, falls through to "linked first
  wins", and the recommended button renders first as `variant="default"`. The flash now names the
  ordinal to keep and what the other choice costs — copy overriding a wrong default, which is a
  mitigation and not a fix.
* **F3 (recorded, H.6b(b)) — one split on the old connection makes the combine refuse** with a
  false diagnosis, because the guard compares split CHILDREN against the successor's PARENT.
  Refuses safely; a blocked remedy, not data loss. The owner has splits.

**Suite flake observed and measured, NOT diagnosed:** one full run failed 2 tests in
`cron-notify.test.ts` (delivery counted 0, then a `pushSubscription.create` conflict); the same
tree re-run passed 6,227, the file passes alone, and the stashed clean tree at `ddd7682` passed
6,224. Same code, different verdicts ⇒ non-determinism in that file, outside this diff.

## 2026-08-06 — H.8 critic cycle 1: the merchant-batch writers were the door the slice left open

**Fresh-context critic (isolated worktree): FAIL — 1 P1 (executed), 1 P2, 4 P3.
P1 + P3s fixed and locked same cycle; P2 recorded (STATUS residuals).**

**P1-1, executed by the critic's own probe:** the group card is keep-filtered
(said "File all 2") but `fileMerchantGroup` was not — one tap filed 3, writing
the disowned duplicate `needsReview: false` and minting a Correction with no
`sourceRuleId`, i.e. a hand decision the user never made, feeding the
deliberately-unfiltered learned-rule evidence with newly GENERATED duplicates.
Same hole in `applyToAllSimilar`, `recategorize scope:'merchant'`, and triage's
`similarCount`. All four now carry the keep filter — the identical idiom the
spend-class twin of this gesture (#397 `setMerchantSpendClass`) has had since it
shipped; `similarCount` shares the queue's own keep fetch so count and write set
cannot drift.

**P3s fixed:** excludedReason reworded to claim ABSENCE, not a counted twin
(true for a superseded predecessor's own post-cutover row); the matchableHistory
race comment now states both directions; a fail-open lock added (inert
cross-type link → ALL readers revert together to pre-H.8 behavior).

**Locks now 10; sabotages now SEVEN** (the three slice filters + the four
cycle-1 sites), each executed RED against exactly its own lock, each restored,
residue grep 0. Adjacent suites 128/128. Re-gate: see below.

## 2026-08-06 — H.8: three unboundaried readers measured live; three fixed, three cleared (verify green)

**MEASURED FIRST** (read-only probe `scripts/audit-probes/h8-boundary-readers.mts`
against the production DB, owner's corpus, 26 active links, full output in the
session log): **[1] spending-plan loan inflows — delta 0**, merchant sets
byte-identical with and without the boundary, so the sharpest hypothesized reader
is clean on this corpus and untouched; **[2] household digest — n/a** (no
household exists, and the code already excludes superseded predecessors);
**[3] self-audit — 75/2456 shipped vs 7/1332 boundaried**, a rendered
contradiction on /settings against the triage queue it audits; **[4] keyword
rules — 2,456 matchable vs 1,332 owned** ($271,467.59 on 1,124 invisible rows):
inflated preview count AND an apply that wrote categories to rows no register
shows; **[5] backfill — 75 vs 7 unresolved**: ~10× LLM fan-out over invisible
rows, stamped `needsReview: false` so an undone combine would return them
silently pre-filed; **[6] corrections — 146 of 827 on disowned rows**:
deliberately NOT filtered (H.7 P1-3 — a correction is the user's decision about
a payee; blinding the rule-learner to evidence is the known failure shape).

**Fixed (3, one idiom):** `gatherSelfAuditCounts`, `matchableHistory`
(keyword-rules — one site covers preview + all four writes, preserving "the
number shown IS the population written"), and `runBackfillForUser` now apply
`getReconciliationTxnKeep`, the same R1 rule as register/triage. Plus the
`getRuleSourceTransaction` mirror: a `/rules?from=` link to a disowned duplicate
names the reason instead of contradicting the count.

**Locks:** `tests/unit/h8-boundary-readers.test.ts` — 5 tests over a real
reconciled pair; fail-old proven by three executed sabotages (each filter
deleted → 1–2 tests RED), all restored, residue grep = 0.

**Next:** verify gate, fresh-context critic, commit/push/deploy proof.

## 2026-08-05 — H.7 critic cycle 2: identity is not a money question (DECISIONS #415)

**One fresh-context critic, FAIL: 2 P1, 3 P2, 3 P3. Both P1s fixed and locked.**

**P1-1:** the identity map was built from `effectiveReconciliationLinks`, which
fails OPEN on an ambiguous link shape — correct for a reader (a visible double),
wrong for this writer (a silent exclusion). Four inert shapes executed, each
restoring the duplicate-pairing artifact, and reachable on an ORDINARY sync
because both providers rewrite `Account.type` unconditionally. New sibling
primitive `accountIdentityMap` reads every live link with only the cycle guard.
Measured live: 26 vs 26 — no inert links today, so this is protection against
drift, not a repair.

**P1-2:** the evidence bar was per-ROW, so a pair could be half-actioned — a
$5,000 cash advance whose inflow descriptor was transfer-known left income while
the CREDIT outflow stayed in spending, minting a $5,000 expense that had not
existed before this slice. Descriptor evidence now carries across a matched pair.

Also fixed: `'INVESTMENT'` as a SENDER was completely unlocked (the fixture put
the investment account on the inflow side); two of the file write's four
re-assertions were deletable with the suite green.

**Gate:** verify GREEN — tsc 0 / eslint 0 / **6103 unit / 369 files** / build
clean. Six sabotages, all RED, restored in a `finally` — the cycle-1 harness had
crashed mid-run and left one applied, which is now its own ledger entry.

**Next:** the owner decision on repairing the 53 rows / $29,848.84 (and clearing
`isTransfer`, which nothing in the app can do today); TASKS H.8.

## 2026-08-05 — H.7 critic cycle 1: the mechanism changed twice (DECISIONS #415)

**Two fresh-context critics, isolated worktrees, both FAIL: 1 P0, 5 P1, 4 P2, 1 P3
— all fixed and locked.** The two that changed the design rather than patching it:

**(1) The gate never fired on the shape a row arrives in (P0).** Every synced row
is born `needsReview`, so gating only the SETTLED case let the coincidence win on
the first sweep — and `fileIds` is the heavier write, stamping 'transfer' and
clearing `needsReview`, so the row never reached triage either. The evidence bar
is now ONE bar over every write. Fixing it surfaced a defect of my own: gating
filing while still FLAGGING would have recreated the pre-#165 wedge, because a
flagged `needsReview` row is hidden from triage AND excluded from every total. An
unevidenced pair now gets no action at all.

**(2) Filtering the READ made the writer blind to a leg its readers count (P1).**
The R1 rule disowns a successor row inside the predecessor's claim; when that is
the only copy of a paying leg, the sweep stopped seeing it while the counterpart
on an unlinked card was still counted — executed: a $123.45 card payment read as
negative spending, a month's expenses $200.00 -> $76.55. The reconciliation
boundary is therefore out of the INPUT and into the MATCHING rule: rows carry
their confirmed account identity and two rows on one real account never pair.

Also fixed: LOAN/MORTGAGE can send (a $20,000 HELOC draw filed as Income was
staying Income — including in the tax export); the overturn write re-asserts its
premise (`undoCorrections` falsifies "can only become more settled"); one exported
constant feeds both the engine predicate and the SQL mirror; one pair+normalizer
walk instead of two (+86% measured); and `overturned` is returned separately.

**Gate:** verify GREEN — tsc 0 / eslint 0 / **6096 unit / 369 files** / build
clean. Five sabotages executed, all RED, all restored with residue checks. Live
re-measure with the shipped code: 114 flags + 39 overturns justified from scratch;
unrepaired set 53 rows / $29,848.84.

**Next:** critic cycle 2 on these fixes; the owner decision on repairing the 53;
TASKS H.8 (five other unboundaried readers, sharpest `spending-plan.ts:198`).

## 2026-08-05 — H.7: the transfer sweep stops silently reversing settled rows (DECISIONS #415)

**Done:** the flag branch of `planTransferUpdates` inherits the protection the file
branch has had since #148 — a pair-only guess may SUPPLY a verdict, never silently
REVERSE one. Two causes, two scopes: `refreshTransferFlags` now applies
`getReconciliationTxnKeep` (it did not, so it paired rows against their own
reconciled duplicates), and a settled
substantively-categorized row is overturned only by a directionally coherent pair —
one whose SENDING leg is an account money can actually leave. `flagIds` and
`overturnIds` are planned separately because only the first can have its premise
change under it, and the first re-asserts that premise in its write.

**Found (live, read-only probes over 3,065 real rows, replaying the real engine):**
92 settled rows were withholding $21,411.05 of inflow and $181,281.51 of outflow
from every total; 73 stood on nothing but a pair (45 duplicate-account artifacts,
12 brokerage funding, 9 card/loan payments, 7 pure coincidence). The critic's repro
was live and bidirectional: a $500.00 fund distribution settled at 9900 bps and a
$500.00 Zelle payment to a landscaper cancelled each other out, so a real income row
and a real expense row both disappeared. Boundary alone removes 53 of 73; +direction leaves 16
by that replica measure. Re-measured afterwards with the SHIPPED
`planTransferUpdates` (`h7-shipped-plan.mts`, which supersedes it): 66 flags + 29
endorsed overturns, 28 of them correct and one false (a $0.07 interest row); the
unrepaired set is 63 rows / $49,008.13.

**Rejected after measuring:** an age gate (refuses the corrections a backfill exists
to make) and a confidence gate (useless — genuine and false both sit at 9000-9900).

**A fixture that lied, caught before it shipped:** the first boundary test passed
against the UNFIXED code, because `txnKeepRule` treats a cutover predating the
predecessor's first row as a DEGENERATE claim and keeps everything (A-F8) — the
fixture had built the one shape where the boundary drops nothing. It now carries a
pre-cutover anchor row with the reason inline.

**Gate:** verify GREEN — tsc 0 / eslint 0 / **6090 unit / 369 files** / build clean.
No schema change, no prisma diff, no UI surface. Three sabotages executed and
restored (residue-checked): the gate, the boundary filter, the write's premise
re-assertion — each fails its own lock.

**Next:** a hostile-critic cycle on this slice (owed — money-visible + data
integrity); then the repair question for the 45 flags already written; H.1(b) the
"earliest data" surface; H.2 CSV backfill; H.6 fresh-Link route.

## 2026-08-05 — the Plaid deep-history backfill mirror (H.5's open Plaid P1 → closed; DECISIONS #414)

**Done:** `backfillItemHistory` now refuses superseded predecessors, runs
oldest-first capped 2000/chunked 250 (assist per chunk), gates every markDone on
a COMPLETE fetch, skips malformed rows without aborting or charging the cap, and
both server-performed un-supersede events (explicit undo + direction-conflict
auto-undo) re-arm both providers' backfills through one author
(`rearmHistoryBackfills`). 9 server tests driving the real `syncTransactions`
against a mocked Plaid server; 10 sabotages executed across two cycles, all
caught by the final suite.

**Found (live, read-only probe `scripts/audit-probes/plaid-backfill-exposure.mts`):**
no harm occurred — all 12 owner items backfilled 2026-08-04 with `added: 0`
(probe output verbatim in the session; key lines: every item
`backfilledAt=2026-08-04`, every audit row `"added":0`, depth plaid
`[2026-04-24..2026-08-05]` n=1381, simplefin `[2026-03-25..2026-07-21]` n=1684,
26 active reconciliations of which 24 have simplefin predecessors, and NO
SimpleFinConnection row exists). H.6's gate is thereby answered (`added≈0` ⇒
fresh Link is the only deeper-Plaid route) and H.1(a) is measured.

**Critics:** two fresh-context, isolated worktrees. 0 P0 / 4 P1 / 6 P2 combined;
three P1s fixed + locked same cycle (auto-undo re-arm, fixture-weak oldest-first
lock, unlocked one-time guard), the fourth — the transfer sweep's settled-row
pair-flip, a STANDING shared-sweep defect both providers whose H.5 "fix" was
only a one-sync deferral — recorded as TASKS H.7 with the executed repro, not
patched (shared machinery, semantics decision, own measured slice).

**Gate:** verify GREEN cycle 1 (**6076 unit / 368 files**, tsc 0, eslint 0,
build clean) and re-gated after cycle-2 fixes. No schema change, no prisma
diff, no UI surface (deploy proof = sha-match, C.9 precedent).

**Next:** H.1(b) the "earliest data" surface; H.2 CSV backfill; H.6 fresh-Link
route (now unblocked); H.7 the sweep semantics (Fable).

## 2026-08-04 — C.13: half shipped, half reverted with its findings (audit P1-27 / P1-28, DECISIONS #409)

**P1-27, shipped.** The audit blamed a POSTED-only classifier for $49.93 the linked
register could not show. #397 had already fixed that on 2026-08-03; measured first,
and the demo divergence is zero. The parity claim survived through a different
mechanism: `getTransactions` applies the shared R1 reconciliation keep before it
stamps `spendClass`, `/budgets` applied that keep to `spendRows` and gave the
Fixed/Discretionary panel the raw month query — so after a confirmed provider
migration the heading a reader clicks double-counted every post-cutover purchase.
`summarizeSpendClassCategories` now takes `keepsReconciled` as a required parameter
(the predicate, not pre-filtered rows: `spendRows` also carries `isSpendRow`, which
drops the C.25 loan-payment exclusions the register still lists).

Critic cycle 1, fresh context, executed rather than argued: with the panel now
provably equal to the register, /budgets prints one category at two figures four
inches apart, and the sentence explaining it lived under the lower one only.
`spendClassLoanPaymentNote` states the direction beside the split.

**P1-28, built and reverted the same session.** The two "spent this month" figures on
the dashboard genuinely disagree, and the fix looked small — `spentAsOf` applied to
the array in `getReports` and the three Ask category intents, matching the clamp
`merchantSpend` has carried since O.7. It went verify-green. A second fresh-context
critic then produced five P1s, all executed: the clamped /reports figure links to an
UNCLAMPED register ($120.00 clicked → $520.00 of rows), /budgets stays unclamped and
links to the same href so two pages would print two numbers for one category, income
clamped on /reports but not in Ask, the shared Glass-Box basis sentence is rendered by
both surfaces and cannot describe two windows, and — mutation-proven — removing the
clamp from both server files left 59 and 45 tests green, because the parity test
re-derived the call-site expression instead of calling `getReports`/`buildAnswer`.

Reverted rather than patched: making it correct means the register link window must
follow the figure, which is a decision about `categoryMonthRegisterHref` and about
whether /budgets' allowance figure clamps too — a materially larger slice than the
task row scoped. Filed as **C.26** with all five findings recorded verbatim.

Gate at ship: `bash scripts/verify.sh` GREEN — tsc 0, eslint 0, **5952 unit / 361
files**, build clean. Targeted e2e 10/10 serially. Empty `prisma/` diff.

**Deploy-verified 2026-08-04 (this session):** pushed `50dd586`; Vercel production
`dpl_7JrxXnVQbdxb8vU4keajvze2LShq` (`aimplifi-8bcqylg18-reiforge.vercel.app`) status
**Ready** on that exact SHA, aliased to www.aimplifi.app. `scripts/c13-live-deploy-check.mjs`
(script only, not in the app build) signs into the shared demo and reads the real
pages: **7/7 PASS**.

**Stated rather than papered over: both behaviours are invisible on the demo, and
that was measured.** The shared demo carries zero `AccountReconciliation` rows and
zero loan-payment flow exclusions, so the keep is the R8 constant-true fast path and
the new disclosure has nothing to say — no rendered figure differs between the old
build and this one on this dataset. The freshness proof is therefore a CLIENT-BUNDLE
literal: `spend-class-panel.tsx` is a client component, so the new
`spend-class-loan-payment-basis` testid is compiled into a served chunk that the
previous deployment cannot produce. The remaining checks execute the slice's own
claim on live data — Fixed panel 54264 vs register 54264, Discretionary 15381 vs
15381 — which the old build would also have passed here, and which is reported as
confirmation that the shipped page works, not as a discriminator.

**Two notes on this session's tree.** A fresh-context critic ran `git checkout` on
`trace.ts` mid-audit and clobbered an edit, reconstructing it in different wording —
caught by reading the diff rather than by the tests, which its reconstruction happened
to satisfy (`a-subagents-green-is-a-hypothesis`, again). And `TASKS.md` carries a
concurrent session's Wave H rows plus its archiving of the completed Wave C rows; that
work is in this commit because it is in this file, and it is not mine.

## 2026-08-04 — C.10: the wealth-target pace line names the plan as a plan, and refuses it when the history doesn't back it (audit P0-8, DECISIONS #406)

The last open P0 of the calc audit. #375 made the years dial compound the settings
savings-% target whenever one is set, but the pace line kept saying "what was left
after spending, averaged over the N months", and the refusal tested only the figure
the dial was handed — a positive PLAN cleared it, so an overspender with a savings %
set got a confident 20-year arrival beside the FI card refusing one.

- **Decision moved out of the card**: `COACH_COPY.wealthTargetPaceLine` (pure
  selector, node-env-locked) branches on the contribution basis. `recent-surplus`
  routing byte-identical to the old card logic (locked); `settings-savings-pct`
  gated on the OBSERVED surplus (`wealthTargetPlanUnproven`, one exported predicate).
- **New copy**: `wealthTargetAtPlannedPace` ("what your plan has you setting aside"
  — no window claim, and not "your settings savings rate": the planned figure can be
  goal-driven) and `wealthTargetPlanNotSaving` (zero complete months = absence; a
  real window says "nothing has been left over after spending" — accurate at an
  exact tie, phrased in the surplus line's own words).
- **Critic cycle 1 caught the sibling**: a refused plan still SEEDED the horizon
  slider ("your current pace lands it" under the refusal). The same predicate now
  gates the seed — fallback to the unchosen 25-year default, like a floored surplus.
- Engine (`solveWealthTarget`) untouched; card routes through the selector.

Gate at ship: `bash scripts/verify.sh` GREEN (tsc 0, eslint 0, **5909 unit / 360
files**, build clean); `wealth-target.spec.ts` 2/2 serially on that build (demo seed
carries no savingsTargetBps → e2e exercises the byte-identical surplus branch; the
settings branch is unit-locked only). Two P2 residuals in DECISIONS #406.

## 2026-08-04 — history-windows: 3y SimpleFIN pull, Plaid deep-history backfill, period presets (commit 18b6ad6)

Owner request 2026-08-04: "why are we only pulling 6 months of data, can we get
at least 2-3 years," and a way to view last month / last quarter / last year.

- **SimpleFIN:** first pull + new-account backfill widen 90d → 1095d
  (`SIMPLEFIN_INITIAL_LOOKBACK_DAYS`); the institution caps what actually comes back.
- **Plaid:** one-time ADD-ONLY deep-history backfill for items linked before
  `days_requested=730` shipped (they carry Plaid's 90-day default) —
  `/transactions/get` over the 730-day window through the exact ingest pipeline;
  pure planner (`plaid-history-backfill.ts`) skips pending/existing/unmapped rows;
  `PlaidItem.historyBackfilledAt` flags done items (new links set it at creation);
  audit-logged. Schema change is additive nullable.
- **Register:** period-preset dropdown (this/last month, past 3 months, last quarter,
  past 12 months, YTD, last year, all time) committing from/to; pure tested windows
  (`engine/transactions/presets.ts`); "history available from" disclosure via the
  oldest visible transaction date.
- **Reports:** income-vs-spending chart range picker (6/12/24 months), vocabulary in
  `engine/reports/chart-range.ts` (client+server shared).

Gate at ship: `bash scripts/verify.sh` GREEN (tsc 0, eslint 0, unit green, build
clean); new locks in `tests/unit/period-presets.test.ts` and
`tests/unit/plaid-history-backfill.test.ts`.

**Deploy-verified 2026-08-04 (this session):** pushed `18b6ad6`; Vercel production
deployment `dpl_5oTaPtB6PvrjQGa5ek48vJoZptZP`
(`aimplifi-jopk2ralw-reiforge.vercel.app`) readyState **READY**, created 15:37:37
EDT — four seconds after the commit (15:37:33), no commit since, alias
www.aimplifi.app. The buildCommand chains `prisma db push` BEFORE `next build`, so
the READY build proves `PlaidItem.historyBackfilledAt` reached the live Neon
database. www answers: /transactions 307 → /sign-in (auth gate, as designed),
/sign-in 200. No content-match grep possible: both new surfaces (register presets,
reports range picker) sit behind the login — the changed behaviour is locked by the
unit tests above against the real engine, and the demo seed's server paths are
unchanged.

## 2026-08-04 — C.8: the calendar shows every due, every month (audit P0-3)

Owner's audit opened with "the trends makes no sense"; P0-3 was its calendar
sibling — /calendar window-gated the single obligation the engines emit per
card/loan, so every month but the due one printed "0 payments due across 0 dates"
under a footnote promising each due day is badged. For the owner September
understated committed outflow by ~$25,000. Fix: the engine now synthesizes future
cycles inside the month window — cards repeat monthly from the RAW issuer due date
(business-day re-adjusted per occurrence, priced at the statement basis, always
"(est.)", the radar's projectCardDues rule for rule); loans repeat their fixed
issuer payment from the same raw anchor /forecast expands. Required `today` +
`holidays` params. Current-month events untouched (fail-old locked).

A hostile critic broke the first cut (FAIL, 1 P1 + 4 P2). The P1 was the sharpest:
the synthesized events reused the boolean `isEstimated`, and the frozen disclosure
keyed its amount sentence off it — so a frozen card WITH a statement was told, in
every later month, that its figure was "worked out from the last balance we saw"
while the grid printed the statement basis. Fixed by carrying WHERE THE AMOUNT
COMES FROM (`statement | repeated-statement | balance | loan-terms`) on the event,
computed once in the engine, branched in the disclosure; `FrozenCardRow.isEstimated`
replaced by `amountSource` and the six current-cycle call sites mapped through one
helper. A scoped follow-up critic then caught the source logic keying on the
page-injected `cycleBasisCents` alone — a bare statement card would have mislabeled
as balance — now keyed on the obligation's own estimate path. The calendar-frozen
quiet-month e2e was rewritten to the new truth: later months paint, the frozen fact
rides the synthesized money, only a pre-due month is silent.

Gate: `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **5849 unit across 358
files** / build clean. Targeted calendar e2e 21/21 serially. Three unrelated
mobile-380 e2e (auth:82, today-feed-frozen:220/238) fail identically on clean HEAD
— stash-verified pre-existing, recorded OPEN in STATUS.

## 2026-08-04 — Ledgers archived (docs only, no code)

PROGRESS.md, docs/STATUS.md, REGRESSION_LEDGER.md and the completed TASKS.md
rows moved verbatim to `docs/archive/`; the live files hold 2026-08 onward and
the open queue. Losslessness was PROVEN, not assumed: for each pair, every
non-blank line removed from the live file was checked for presence in
live+archive by set difference — 7065 / 8483 / 434 / 117 removed lines, zero
missing. The single apparent miss was a byte-order-mark copy of a heading that
survives without the mark. Also: README's Deploy section now points at
docs/DEPLOY.md rather than keeping a second, drifting copy of the steps, and
two lesson files that had never been listed
(check-provider-production-requirements-before-saying-no-setup,
cloud-synced-folders) are now in docs/lessons/INDEX.md — found by diffing the
lessons directory against the index, and pre-existing, not caused by this move.

Gate: `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **5798 unit across
354 files** / build clean. No schema, code or test change.

**Shipped:** `443f3bd` pushed; GitHub deployment 5738259394 **success**
(sha-matched); https://www.aimplifi.app/sign-in serves 200 and still renders
the Aimplifi sign-in form.

## 2026-08-03 - "Not counted" says why (owner asked what it meant)

Owner screenshot: an `Interest Paid +$0.10` row read "Not counted" and nothing
in the app said what that meant - the SECOND time this chip was renamed rather
than explained ("Neither" -> #397 -> now). Two defects, not one: ten different
facts printed one label, and the explanation lived in a `title` attribute that a
phone cannot open. Fix: `outOfScopeReason` names the row's own fact (Money in /
Own accounts / Cash out / No class yet / You excluded / ...), the chip is a real
button, and the panel says what the row is NOT part of ("Not part of Fixed or
Discretionary") plus where it still counts. Labels are pinned against
`PROVENANCE_LABELS` after a screenshot caught the first cut printing "Transfer"
three times on one row; the panel is clamped to the viewport after it overflowed
first the right edge and then the left. verify GREEN (5798).

## 2026-08-03 - Pending at top + Fixed/Discretionary dial on pending

Owner: pending (Hair Capital etc.) showed Not counted with no dial, and sat
under their auth date instead of at the top like Mint/Simplifi. Fix:
classifySpendClass admits PENDING categorized outflows; register sort pins
pending first under one Pending sticky section. verify GREEN (5756).
Shipped: `c3fcb7d`.
## 2026-08-03 ? #399 ? Rules Fixed/Discretionary + Return to place

Owner: Rules needed Fixed/Discretionary with algorithmic guess (recurring seed);
Check what this matches follows; baseline stamp; same-month extras keep guessing;
Return so Rules does not lose Activity place.

Shipped: `CategorizationRule.setSpendClass`, spend-class-action engine, preview +
UI, apply/ingest stamp. Return clarified same day: `?from=` is prefill only;
`?back=` (sentinel when unfiltered) restores Activity; `via=row` from detail
makes primary Return that transaction, with Activity always also offered.
Detail page has a top Return to Activity. `bash scripts/verify.sh` GREEN
(5754 unit / 351 files); e2e `register-return` 4/4. Schema additive
(`setSpendClass`).

**Shipped:** `3a61ac0` pushed; Vercel production `aimplifi-21xy3ojlk` Ready;
GitHub deployment 5734309451 **success** (sha-matched). No schema change in
the return-nav follow-up.

# PROGRESS.md — session resume log

## 2026-08-03 ? #398 ? Spend-class dial asks scope: this one, or all of the payee's

Owner: marking "Chuns Martial $4.45" fixed should ask whether to apply it to
all matching transactions. The dial now asks when the payee has >1 row:
"Just this one" (​setTransactionSpendClass) vs "All N <payee>" (new
setMerchantSpendClass — the register’s similarTransactionsWhere merchant
scope, reconciliation-keep filtered, per-row agreement→NULL, out-of-scope
rows skipped, aggregate/merchantless falls back to single, no rule minted).
Register count rides TxnView.merchantCount; the detail page counts on the
action’s own basis. Locks: 3 merchant-wide cases in
tests/unit/transaction-spend-class-actions.test.ts.

### Gate

`bash scripts/verify.sh` → **VERIFY GREEN** (tsc, eslint, next build clean);
full suite **5742 unit / 350 files**; targeted e2e
`txn-spend-class.spec.ts` + `spend-class.spec.ts` **2/2**.

**Shipped:** `75fe7ba` pushed; Vercel production deployment
`aimplifi-fcctk0mzq` — **success** ("Deployment has completed"),
sha-matched via GitHub deployment status (id 5733291424). No schema
change in this slice.


## 2026-08-03 — #397 — Fixed/Discretionary is per transaction (supersedes the #396 category channel)

Owner correction hours after #396 shipped: the class is individual — "not
all hair and beauty is fixed; when I switch one transaction in this
category, they all do." Reworked the same-day restoration into a per-row
verdict: `Transaction.spendClassOverride` ('fixed'/'guilt-free'/NULL),
`classifySpendClass` reads verdict → recurring-bill merchant guess (one
server set, `getRecurringBillMerchantCanonicals` = stored outflow series +
BILL − NOT_BILL, overrideKey-keyed) → category taxonomy flag; a dial choice
matching the guess stores NULL. `setTransactionSpendClass` lives in
transaction-flags-actions (demo-fenced, audit-logged). Plan math classifies
per row (median, rollup with fixed-share pre-filter, union covered set; the
union's category test is suggestion-only so a flipped-discretionary series
leaves Fixed). The /budgets panel splits mixed categories across both lists
(Mark buttons gone again — category-level controls are the rejected model);
the register/detail dial copy says "this transaction only".
`CategoryFixedOverride` dropped (its only rows were the owner's disowned
test flips); the custom-category Discretionary checkbox stays (it feeds the
fallback guess). mortgage-replay probe mirrors the new path.

### Gate

`bash scripts/verify.sh` → **VERIFY GREEN** (tsc, eslint, next build clean);
full suite **5739 unit / 350 files**; targeted e2e
`txn-spend-class.spec.ts` + `spend-class.spec.ts` **2/2** (demo dining
row still guesses guilt-free — no demo dining merchant is a detected
series; groceries fixed; the panel carries no category-level control).

**Shipped:** `88bddd7` pushed; Vercel production deployment
`aimplifi-1te95vw4n` — **success** ("Deployment has completed"),
sha-matched via GitHub deployment status (id 5733003138). The build’s
`prisma db push` added `Transaction.spendClassOverride` and dropped the
empty `CategoryFixedOverride` table on Neon.


## 2026-08-03 — #396 — Fixed/Discretionary dial restored in transactions (#395 reversed — the directive was never given)

Owner correction, same day: he never gave the #395 "never typed in" directive
and wants the dial back, directly in transactions. Restored the pre-#395
implementation from `ad23e40^`: the `CategoryFixedOverride` table (db push —
additive, no data loss; the rows #395 deleted are gone, so the dial starts
fresh), `setCategoryFixed` + `getCategoryFixedOverrides` (demo fence,
ownership assertion, audit log, revalidates intact), the override params back
on `classifySpendClass` / `resolveCategoryIsFixed` /
`monthlyNonDiscretionaryCents` / `fixedSpendCategoryIdsInMonths` /
`resolveFixedCategoryAmounts` (default empty — pure-engine callers unchanged),
threading in getSpendingPlan, the register list, the detail view, and the
/budgets rollup, and `SpendClassSelect` on the register row + the detail
"For your Plan" section (demo-fenced via `canEditSpendClass`). The
out-of-scope label is renamed "Neither" → "Not counted". Owner follow-up
the same day reversed the rest of #395 too: the /budgets Mark fixed /
Mark guilt-free buttons + "you set this" markers are back (demo-fenced),
and the Discretionary checkbox returned to all three custom-category
create forms (settings manager, register write-in, triage write-in).
`summarizeSpendClassCategories` takes the override map again (a $0
overridden category stays visible so it can be undone). The
deterministic classifier remains the default — a dial choice matching
the suggestion deletes the override row.

### Gate

`bash scripts/verify.sh` → **VERIFY GREEN** after the widened restore (tsc
clean, eslint clean, `next build` clean); full suite re-run standalone —
**5733 unit tests / 350 files** (the +1 is the restored $0-override
visibility case). Playwright `txn-spend-class.spec.ts` +
`spend-class.spec.ts` — **2/2** (register rows carry the class with the
demo fence intact; /budgets shows the demo note, move buttons fenced off
the demo).

**Shipped:** `0a10f04` pushed; Vercel production deployment
`aimplifi-kx55wvmr1` — **success** ("Deployment has completed"),
sha-matched via GitHub deployment status (id 5732218938). The build's
`prisma db push` recreated `CategoryFixedOverride` on Neon (additive).

## 2026-08-03 — #395 — Spend class is deterministic and algorithmic, never typed in

Owner directive mid-session: "none of this should be typed in — make it all
deterministic and algorithmic." REVERSES the manual half of #376/#378 (the
owner's ask from two days prior): the per-user `CategoryFixedOverride` table,
the `setCategoryFixed` action + loader, the register/detail `<select>`, the
/budgets Mark buttons + "you set this" markers, and the Discretionary checkbox
on all three custom-category create forms are REMOVED.

### Done

Classification is a pure function of the filed category (taxonomy
`discretionary`, meta-resolved for customs): `classifySpendClass` /
`resolveCategoryIsFixed` / `summarizeSpendClassCategories` /
`monthlyNonDiscretionaryCents` / `fixedSpendCategoryIdsInMonths` /
`resolveFixedCategoryAmounts` lost their `overrides` params; Plan's
`categoryIsFixed` binding, the Fixed rollup, median, and union read the same
classifier (`hasReaderInput` now keys off budget targets alone). Register +
detail render a display-only `SpendClassBadge`; the /budgets panel keeps both
computed lists, display-only. The reader changes a row's class by refiling it
— "never permanent" holds with zero designation UI. New custom categories
take the column default; stored flags honored as data (nothing rewritten).
Also same-session, superseded: the morning's dial-gate widening
(`TxnView.categoryFixed` + `spendClassDialEditable`) — removed with the dial.

### Gate

`bash scripts/verify.sh` → **VERIFY GREEN**: tsc 0, eslint 0, **5730 unit /
349 files** (one index-lock red until #395 was registered in
DECISIONS_INDEX.md), next build clean. Targeted e2e spend-class +
txn-spend-class + spend-class-drilldown **4/4** — an earlier 4/4 fail was a
harness clash (Playwright `next start` serving `.next` while verify.sh's
`next build` rewrote it), rerun clean after the build finished.

## 2026-08-03 — #394 — C.24: the transfer-flagged mortgage counts once, at its full monthly rate

Session opened on `continue` with `main` clean at `52cf346` (the C.24 fix
direction recorded, owner-confirmed). Built it.

### Done

`loanPaymentMerchantCanonicals` (transfers.ts) — the class is STRUCTURAL: a
transfer-flagged cash outflow whose ±3-day same-|amount| pair sits on a linked
LOAN/MORTGAGE account; per-merchant; aggregate canonicals refused. Detection
keeps the flagged rows (`RecurringTxn.loanPayment`, the auto-loan precedent).
Rollup + trailing median + covered-ids exclude only the UNIONED set (the
exactness invariant — excluded ⇔ unioned). The union adds the series at its
monthly rate unconditionally except the NEVER set and reader-priced (budget)
categories. Loan-side rows via a targeted POSTED/USD prisma query (the
snapshot withholds loan accounts, #62). /budgets reads
`plan.loanPaymentRollupExclusions` — one basis on both surfaces.

### Gate

`bash scripts/verify.sh` → **VERIFY GREEN**: tsc 0, eslint 0, **5731 unit /
350 files**, next build clean. Targeted e2e spending-plan + budgets-basis
**2/2** (demo unchanged — the seed's loan account has no transactions).
Production replay (`mortgage-replay.mts`, read-only): structural set =
exactly {Truist Mortg Olb Mtgpmt}; rollup $9,785.24 → $7,712.88; union
+$6,217.07; **Fixed $9,785.24 → $13,929.95**; trace MATCH.

### Critic

Cycle 1 (fresh-context subagent) FAIL — 4 P1: F1 exclusion unconditional
while re-entry depends on detection (escrow adjustment → the bill VANISHES);
F2 budget-priced category double-priced by the unconditional leg; F3 one
coincidental pair strips an aggregate canonical's every payee; F5 loan-side
query unguarded (pending, non-USD). All four fixed and locked (21 pure + 3
real-server tests, controls pin the fail-old shapes; the integration lock was
mutation-proven live — a mid-fix run printed exactly the fail-old 221,876).
Cycle 2 self-critic PASS — the fresh-context subagent died on an account
quota 403, recorded here rather than dressed up as an independent pass.

### Not this slice

TASKS C.25 (radar / stored-series refresh / calendar / census stay blind to
the bill the plan now reserves; unflagged months still feed discretionary
burn; month totals still lumpy). C.22, C.23, C.19 unchanged.

### Deploy

`217147d` pushed 2026-08-03; Vercel `aimplifi-ptgrkst2j` (dpl_3cmiqAtB6Rh6cfLjUvaCxei6u218)
**READY**, **sha-matched** via the GitHub deployment status on the exact commit
(state `success`, environment_url = the same deployment), `www.aimplifi.app`
aliased. No UI marker exists for this slice by construction — the demo figures
are deliberately unchanged (the seed's loan account has no transactions), so
the sha-match IS the live proof. Production's money moves only for linked-loan
users: the owner's replay predicts Fixed $9,785.24 → $13,929.95.

## 2026-08-02 — #387 — C.3 dashboard Trends card names divisor / assumption / mover window

Session opened on `continue` with `main` clean and level with `origin/main`.
Wave C had just been scoped: Grok takes C.3 (not C.1/C.2). Owner's reply to the
audit was that nothing looked fixed — C.3 does not move the $8,971.25 (that is
C.2) but it is what makes the existing figure readable on the surface he lands
on.

### Done

Shared pure helpers in `src/lib/engine/trends/labels.ts` (`paceDaysPhrase`,
`paceDeltaRelation`, `PACE_ASSUMPTION`, `moverWindowLabel`, `baselineLabel`).
Dashboard card + `/trends` both consume them. Card now prints day count,
assumption, muted pace comparison (tie → "on pace with last month"), and
`(May '26 vs Feb '26–Apr '26 average)`-style window on Biggest change.

### Gate

`bash scripts/verify.sh` → **VERIFY GREEN**: tsc 0, eslint 0, **5636 unit /
345 files**, next build clean. Targeted e2e `trends.spec.ts` **3/3**. Empty
`prisma/` diff.

### Not this slice

C.1 (zero-spend abstention), C.2 (bill-calendar pace model), `/trends` pace
colour, ledger.ts multi-line argv truncation (still OPEN in STATUS).

### Deploy

`8511e9d` → `aimplifi-nklnbw1pe` **READY** on that exact SHA, `www.aimplifi.app`
aliased. Live demo /dashboard (Playwright demo-sign-in): pace days =
"in the first 10 days · on pace for $1,469.34 less than last month", assumption
contains "a projection, not a prediction", mover window =
"(May '26 vs Feb '26–Apr '26 average)", pace line class is muted (no rose/emerald).

## 2026-08-02 — #386 — reindex reads both formats and cannot delete; #384 deploy-verified

Session opened on `continue` with `main` clean and level with `origin/main`. Two
things were owed: #384 had shipped without the deploy-verified record every other
commit in the run carries, and `docs/STATUS.md`'s top item was an OPEN warning
telling readers not to run one of the repo's own scripts.

### #384's missing deploy record

`npx vercel ls aimplifi --meta githubCommitSha=9b665d42…` → `aimplifi-9ssolqjp8`
**READY**, Production, and `vercel inspect` shows `www.aimplifi.app` among its
aliases. **Limit, stated rather than papered over:** #384 is engine math on the
trailing-median Fixed fallback with no new user-visible string, so there is no
marker to grep the live HTML for. This is SHA-and-alias verification, not
behavioural confirmation on live data — that branch needs an account whose
history actually reaches it.

### #386 — the script that destroyed the decisions index

Measured before touching anything: 329 table rows + 46 headings = 375 decisions
in `DECISIONS.md`, 341 rows in the index, **34 absent** (#338–#373 less the
#353/#360 numbering gaps), no duplicates, no orphans. Exactly what STATUS said.

The fix is in two parts and the second is the one that matters.
`scripts/ledger-parse.ts` (pure, no `fs`, unit-testable) teaches the parser the
heading era, including the bare `## #354` shape whose summary comes from its
first bold body line, and the rule that only a LEADING parenthetical is a phase.
Then `reindex` diffs the numbers it is about to write against the numbers the
index already carries and **refuses to write if any would disappear** — throws,
names every one, touches nothing.

Part 1 repairs the format I know about. Part 2 is why this does not recur: the
next format the parser fails to understand fails in the terminal instead of in
the file. Proven by mutation rather than argued — the heading parser was reverted
to its blind state, `reindex` refused, named all 46, exited 1, and the index was
byte-identical afterward.

Found in the same read and repaired: `nextDecisionNumber` counted only table
rows, so the next `ledger.ts decision` would have returned **338**, a number
#338 has held since 2026-07-31, and appended a duplicate under it.

Filed rather than fixed: `decision` still appends a legacy TABLE row while
sessions hand-write heading sections. The number it picks is now right; the shape
it writes is not.

Deliberate loss recorded: regenerating replaced the hand-written summaries for
#374–#385 with their headings' own titles. Nothing left `DECISIONS.md`, and the
index has one author again instead of two.

### A third defect, found by using the tool

Writing this entry through `tsx scripts/ledger.ts progress "<title>" "<body>"`
**silently truncated the body to its first line** — everything above was lost and
the command reported success. Same family as the bug this session came to fix: a
ledger script losing content and saying it wrote it. Not diagnosed further here
(the entry was repaired directly with an editor); filed in STATUS as OPEN, since
the safe workaround — do not push multi-line prose through a shell argument on
Windows — is exactly what `docs/lessons/windows-codegen-via-shell.md` already
says, and the script offers no other way in.

### Gate

`bash scripts/verify.sh` → **VERIFY GREEN**: tsc 0, eslint 0, **5626 unit / 344
files**, next build clean. Run twice — once before the ledger/STATUS edits, once
after. The new `tests/unit/ledger-decisions-index.test.ts` failed-old on the
completeness assertion and named all 34 missing decisions before the fix; 16/16
after. Empty `prisma/` diff, and no `src/` change at all — the deployed app is
behaviourally identical.

### Deploy

`df10a84` → `aimplifi-asgx1ieni` **READY** on that exact SHA, `www.aimplifi.app`
aliased, `/sign-in` 200. **No marker grep is possible for this change** and none
is claimed: it touches `scripts/`, `tests/` and docs only, so nothing it does can
appear in the live HTML. The honest proof is the SHA, the alias, and the fact
that the app still serves.

## 2026-08-01 — #384 median Fixed fallback union (critic on #382) DONE

P0: Math.max(median, recurring) dropped complementary Fixed. Fix: same union
as rollup path + median-month covered ids (`fixedSpendCategoryIdsInMonths`).

Work was stashed in Cursor (`stash@{0}` / `cursor/cloud-agent-1785640921945-a5pb8`)
and never reached main; cherry-picked onto `3dc0f82`. Source files landed
byte-identical to the Cursor changeset.

**Gate caught a P0 the draft carried.** #384 as written also routed the
`detected-series` last-resort branch through the designation-aware sum; `fitness`
is discretionary, so a $45 gym bill autopaid from savings went $4500 → $0 and
L.25/L.26 failed (2 tests). That branch is reverted to `recurringFixedCents` —
it is not a designation judgement. New lock
`test_regression__detected_series_fallback_counts_discretionary_recurring`
verified fails-old (0) / passes-new (4500).

**Also repaired:** the changeset deleted #374–#382 from `docs/DECISIONS_INDEX.md`.
Root cause is `scripts/ledger.ts reindex` itself — it parses only the pipe-table
rows (#1–#337) and is blind to the 46 heading-style sections (#338–#385), so the
regenerate command the file's own header prescribes DESTROYS 46 entries. Index
restored from main and #383/#384/#385 added by hand (net +3, zero deletions).
**Open:** 34 decisions (#338–#373) remain unindexed and the script is still
unsafe to run — see docs/STATUS.md.

Gate: tsc 0, eslint 0, **5610 unit / 343 files**, next build clean. Empty
`prisma/` diff (live Neon untouched).

## 2026-08-01 — Income half/one-paycheck regression (#385) DONE

Owner: Plan income ~$10k / one paycheck; pay is steady higher. Cause: #370
earned-only when any paycheck leaf exists dropped sibling still on Income.
Fix: earned + generic Income (not MM/interest/tax-refund). Shipped `5553725`;
Vercel READY `aimplifi-adzthrksf`.

## 2026-08-01 — W.7 Fixed/Guilt-free heading → transactions (#383) DONE

Owner: click aggregate headings (Fixed expenses) → every txn under that class.
Register `?spendClass=` + Class select; headings on /budgets composition /
Conscious / Fixed-vs-guilt-free panel + Plan legend. Plan $ stays unlinked
(budget|typical ≠ month outflows); register basis note says so. Review Fixed
hash (`#spend-class`) kept for designation panel. verify: tsc/eslint green;
5606 unit; e2e drilldown + conscious-buckets. Shipped `e74ef28`; Vercel READY
`aimplifi-96f1pdn0x`; live Class=Fixed + basis note + Fixed rows on register.

## 2026-08-01 — Wave B Fixed union covered-ids fix (#382) DONE

Critic FAIL on #381: auto-loan isTransfer dropped when rollup active.
Shipped `6ece059`; Vercel READY `aimplifi-os9257med`; live copy names
auto-loan ACH + "not already in that rollup".

## 2026-08-01 — Wave B Fixed = purchases ∪ uncovered recurring (#381) DONE

Owner: card bills ≠ expenses; Fixed = Fixed-category purchases (incl. CREDIT).
Union (not max) + never credit-card-payment; retire "card holds Fixed" copy.
Shipped `8263eff`; Vercel READY `aimplifi-filpliwpa` (P0 residual → #382).

## 2026-08-01 — Always-on Fixed category rollup (#380) DONE (B.1)

Plan Fixed = max(category budget|typical, recurring floor) whenever rollup > 0;
no reader-input gate. Copy names the floor. verify GREEN 5595; e2e spend-class +
spending-plan 2/2. Deploy READY `aimplifi-q3962vvqu` on `73010be`; live
`budgeting-fixed-basis` + Plan Fixed label. Wave B open: fuller hostile critic.

## 2026-08-01 — Sethi Fixed band + widened-numerator copy (#379) DONE (B.3)

Kept 50–60% / 15–20% / 20–35%. `CONSCIOUS_BUCKET_COUNTS` + `consciousSpending`
name must-pay Fixed (groceries/utilities / Spending designations). Closes W.5.
verify GREEN 5594; e2e spend-class 1/1. Deploy READY `aimplifi-gfoe2pej6` on
`164176f`; live `/budgets` caption names groceries + 50–60%. Wave B open:
hostile critic on B.1; always-on category Fixed term (vs gated).

## 2026-08-01 — Register Fixed / Discretionary labels (#378) DONE (B.1)

Owner: categorize/label every transaction Fixed vs discretionary with a selector
when wrong. `TxnView.spendClass` + `SpendClassSelect` on register and detail;
edits go through `setCategoryFixed` (category-wide, same as /budgets). Demo
label-only. verify GREEN 5592; e2e txn-spend-class 1/1. Deploy READY
`aimplifi-9wuz5ui0y` on `b29c576`; live demo `/transactions`: 100×
`txn-spend-class` (mixed fixed/guilt-free/out-of-scope) + standing copy.

## 2026-08-01 — Budgeting composition + Fixed amounts (#377) DONE (B.2)

Owner continue: income / savings % / fixed / guilt-free on one page; set fixed
amounts. `/budgets` composition card + PlanFiguresForm; per-category
budget|typical; Plan `category-designations` when reader input. verify GREEN
5592 tests; e2e spend-class 1/1. First deploy Error (Neon P1001 flake); redeploy
READY `aimplifi-k3is4kh67` on `8606a74`; live `budgeting-composition` +
`budgeting-guilt-free`. Open: hostile critic; B.3 band.

## 2026-08-01 — Fixed vs guilt-free by category (#376) PARTIAL (B.1 start)

Owner: budgeting is a start; missing sections to set fixed expenses; start by
categorizing every transaction into fixed or not fixed. Shipped: `classifySpendClass`,
`CategoryFixedOverride`, meta-aware Plan median, `/budgets` Fixed vs guilt-free panel
(demo read-only). `bash scripts/verify.sh` GREEN; e2e spend-class 1/1. Deploy READY
`aimplifi-4j8jsw0su` on `eedaf1b`; Neon `prisma db push` synced; live marker
`spend-class-panel` on www `/budgets`. Open: per-category amount term from budget
target; B.2 one-page composition; hostile critic.

## 2026-08-01 — Wealth dial + savings% + cut proposals (#375) DONE

Owner: interactive years dial; use settings savings % as new-money flow; $/mo + %
income; propose cutting non-dial discretionary. Deploy READY on `edac76a` (feature
`f7dd208`); live markers: horizon +/−, contribution-basis, cuts when gap > 0.

## 2026-08-01 — Inbox skip + unclear charges (#374) DONE

Owner: next without filing; unsure what old charges are. Skip rotates queue;
detail link + age + masked heading; One-by-one row chips (O.12e/O.12f).
`bash scripts/verify.sh` GREEN; e2e skip passed. Deploy READY on `1ce4b9b`
(`aimplifi-odlfxgf2h`); live markers `triage-skip` + `triage-open-detail`.

## 2026-08-01 — Intention vs slide (#373) DONE

Owner: set savings %; income/fixed from categories; lock only as intention; data ≠ lock
= slide / overspend, not a rewrite. Engine `incomeSlideCents`/`fixedSlideCents`/`hasSlide`;
Plan form + `plan-slide` notice. `bash scripts/verify.sh` GREEN. Deploy READY
`dpl_HX1RShALuRj6CmD3fsWkbdgrFqHn` on `1fc8e4b`; live demo `plan-figures-form` present
(demo read-only; slide notice only when a real account locks + data differs).

## 2026-08-01 — Fixed non-discretionary (#371) + Plan figure overrides (#372) DONE

Owner: income − savings% − non-disc fixed = guilt-free; dining/golf discretionary;
savings is not; set figures by hand. Deploy READY `dpl_Cc9d117sbWMqYaWK4pZXDx32j9i5`
on `ae2803e`; live demo Plan markers + guilt-free ~$2,124 (was ~$15k+). Schema pushed
(planIncomeOverrideCents / planFixedOverrideCents).

## 2026-08-01 — Guilt-free income scope (#370) + Home charts restored DONE

Owner: ~$23k guilt-free impossible; don't count MM / already-saved; restore charts (not
verbose instructions); move categorize coaching off Home. Done: payment-account income
scope + earned-pay preference (paycheck over mobile-deposit/interest/investment);
Home charts back; “Using Aim·plifi” on Plan. Prod probe (read-only Neon): pattern median
~$21,177 earned pay (was ~$56k all non-credit). Deploy READY
`dpl_73bhYNjkLSkMaDxKnCpa4ig6aRZR` on `481ecfe`; live demo markers: charts + how-to-use +
earned-pay copy; directive sentence gone from Home.

## 2026-08-01 — Home polish + guilt-free without card pay (#369) DONE

Owner: Mint/Simplifi polish baseline — too many words; transactions buried; Plan math
broken (card pay as fixed). Done: formula = income − fixed − savings; Home reorder with
recent transactions + needs-file; clutter cards demoted to their routes. Deploy READY
`dpl_5Hn8UXcy64hpzsaFeYfYxcAkyWNJ` on `2e3bf72`; live demo markers verified. Next open:
propose which categories are “fixed” for the dials / Plan.

## 2026-08-01 — W.12 DONE (#368) — FI card names the real rate once; payoff above the fold

Deferred from W.2 through W.10/W.11/W.13. Headline / Coast / payoff no longer restate
4.50%; they defer with "under this card's return assumptions". Payoff moved above
`fi-projection-basis`. Gate: verify GREEN — 5549 unit / 335 files; phase3-coach 1/1.
Empty prisma diff. Deploy READY `dpl_5USJrJk5WskcN1NJbKV9Pm1rHSpo` on `cd46ef1`
(code `716e529`); live demo 6/6 markers. Next open in Wave W: W.3 / W.4 / W.5 /
W.6 / W.7 / W.8 (and Wave B).

## 2026-08-01 — O.20: every bar on the /reports chart opens the rows behind it

Session opened on the W.10 queue and was redirected TWICE by the owner, mid-turn.
Both redirections are recorded as waves rather than absorbed into this slice:

1. *"fixed expenses are things that aren't discretionary…build a budgeting
   section"* → **Wave B** (B.1–B.3). Not built this session.
2. *"every single bar and collection of categories needs to be immediately
   available…why is this so hard"* → **Wave O.20**, built here.

W.10 was abandoned before any code was written (tree was clean), so nothing is
half-finished.

### The finding that set the scope

The complaint reads as "you haven't done it", and the honest accounting is that
TWELVE surfaces already drill into transactions — every category row on /reports,
/trends and /budgets (name, figure and inline bar) plus the O.18 panels. The gap
was the CHART, which is the first thing on /reports and had no click handler at
all. W.3 had filed the charts as a deliberate refusal, and **its enumeration was
itself incomplete**: it named four Recharts files; `grep` finds seven, plus six
more surfaces drawing hand-rolled bars. A refusal scoped to an incomplete list is
what "you haven't done it" feels like from the outside.

### What shipped

`buildMonthFlowBreakdowns` (pure, `engine/glass-box/`) selects rows through
`monthlyFlows`' own exported predicates — `countsInFlows` newly exported,
`isIncomeFlowRow` already was — so a bar and the rows under it cannot describe
different sets. `getReports` hands BOTH breakdown families one `named` array.
`CategoryBreakdownPanel`'s body became a generic `BreakdownPanel`; a critic
diffed it attribute-by-attribute against `HEAD` and the five pre-existing
drill-down e2e passed untouched, which is the real proof the four existing
surfaces are unchanged.

No `type=expense` link: that filter drops the refunds the bar netted and keeps
the pending rows it never saw, so `monthRegisterHref` claims only a WINDOW and
its label says so.

### Critic cycle — two fresh-context critics, both FAIL

Convergence on two findings, independently:

- The clamp sentence printed **"outran purchases by −$80.00"**, a double negative
  asserting the opposite of the truth. `clampedByNetRefund` is only true when
  `sumCents < 0`, so the label was ALWAYS negative — and my unit test fed the
  copy a POSITIVE literal the sole call site can never emit. Fixed by making the
  function take CENTS and do its own `Math.abs`: a fence, not a correct argument
  at one call site.
- Three positional claims pointed the wrong way ("the basis above" renders below;
  "the rows below" are above).

The deepest finding was the flow SPLIT, and the two critics **disagreed about
it** — one said an unfiled deposit counts as income, the other said it nets
against spending. Executing the predicate settled it: both were half right.
`isIncomeFlowRow` admits a positive row with NO category as income, while one
filed to `uncategorized` (group 'Transfers & Other') is not income and nets
against SPENDING, and a NEGATIVE row in an income category is spending. Two
unfiled deposits that look identical to a reader land on opposite sides. My first
fix believed one critic without executing anything and shipped a NEW falsehood
for about four minutes — the lesson is that a delegated finding is a hypothesis
exactly like a delegated green.

### Measured, not assumed

/reports prints one month's spending twice on two bases. Queried the demo
directly: **3 pending non-transfer rows worth $299.93** in the current month, so
the chart bar (posted-only) and the category card (pending included) genuinely
disagree, and this drill-down is what invites a reader to notice. The disclosure
is gated on the COUNTERFACTUAL — it speaks only when the two painted figures
differ — states the DIRECTION, and names NO mechanism, because a critic falsified
the "pending charges" explanation in both directions (at least five rules
separate the two figures, and the gap can run either way).

### Gate

`bash scripts/verify.sh` → **VERIFY GREEN**: tsc 0, eslint 0, **5481 unit / 333
files** (from 5455/331), build clean. Affected e2e run serially: 10/10
(month-flow 4, category-drilldown 5, reports 1), mobile-overflow 14/14.

One self-inflicted regression caught by the gate: the new sentence quotes
"Spending by category", which made `reports.spec.ts`'s bare text locator
strict-mode ambiguous — the Wave 0.2 "Sign out" class. Re-scoped to the heading.

### Residuals filed

O.20a (two bases on one page), O.20b (the /reports payload is now ~6× — six
months of rows instead of one, unmeasured against a heavy real account), O.20c
(what an unidentified inflow IS), O.20d (the bars still not drillable: /coach's
strip, /trends "New this month", /recurring, and the three charts that are not
transaction sets and want a constituents panel rather than a filter).

---

## 2026-08-01 — W.11 shipped (DECISIONS #364)

W.10 was already live (`db2a5e1`). Next open item from that session's handoff: W.11.
Root cause as filed: hard `max={7000}` + `Math.min(7000, currentRateBps)` initial made an
85% saver's first paint take `sliderCaption`'s Lowering branch. Fix: shared
`fi-slider-bounds.ts` (`max = Math.max(7000, current)`, initial = current pace). Rejected
touched-flag-with-hard-ceiling (rate label would still lie at 70% beside "current pace
85%"). Locks in `tests/unit/fi-slider-bounds.test.ts` + e2e first-paint assertion.
Gate: `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **5511 unit / 334 files** /
build clean; phase3-coach e2e 1/1. Empty prisma diff. Shipped `b1f9600`; Vercel
`dpl_847yTgBW9j1VFh3vCyRrU9vw6CEC` READY, www aliased; live demo first paint is
"current pace (23.4%)", no Lowering/Raising.

## 2026-08-01 — W.10 resumed + shipped (DECISIONS #363)

Prior session implemented W.10 in the working tree (engine + copy + tests +
DECISIONS #363) but left it uncommitted: STATUS pointed at a missing section,
TASKS still OPEN, no REGRESSION_LEDGER rows, no verify output, no push.

This resume: filled STATUS §W.10, marked TASKS W.10 done, filed residual W.13,
appended 4 REGRESSION_LEDGER rows. Gate: `bash scripts/verify.sh` GREEN —
tsc 0 / eslint 0 / **5504 unit / 333 files** / build clean (first vitest pass
under verify hit 6 SQLite `database is locked` flakes; isolated + clean re-run
both green). E2E phase3-coach + auth 7/7. Code was already at the
critic-approved conservative model (nominal grow → deflate); no arithmetic
change in this resume. Shipped `db2a5e1`; Vercel
`dpl_9qp3dkEUNLRs1W7httzq4P58JMUV` READY on that SHA, www aliased; live /coach
(demo) shows `$20,350.61 in today's money over 30 years`, no `"future wealth"`.

## W.10a — the trailing sentence is gated on the arithmetic (2026-08-01, DECISIONS #365)

Follow-on to W.10, made after that slice had already been committed and deployed by a
concurrent session in this checkout.

### What was wrong on production

The opportunity list's basis paragraph carries a sentence for readers whose figures land below
the money they hand over — without it, a total under the contributions reads as a bug. It was
gated on `inflationBps >= nominalBps`, a rule about the two dials. Executing the sweep instead
of trusting the rule:

- **1,579 horizon-cases** (return 0–15.00% x inflation 0–10.00%, 25bps steps, three horizons)
  have inflation strictly BELOW the return assumption and still trail the contributions.
  10.25% against 10.00% trails by 62% at thirty years, with the sentence silent.
- **149 dial pairs** trail at ten or twenty years but not at thirty, so "every figure" and "the
  shorter horizons" are two claims, not one with a soft edge.

Each annuity dollar is invested for less than the whole horizon while the deflator runs all of
it, so break-even sits well above equal dials and moves with the horizon.

### The fix

`opportunityValueTrailsContributions` computes the relation from the same engine the figures
come from, asked once per horizon; the copy has three branches. Amount-independent, so one
card-level sentence stands for every row — proven over the whole grid at three amounts rather
than asserted. `OPPORTUNITY_HORIZON_MONTHS` gains one author so the sentence cannot describe a
different set of horizons than the rows print.

"at or below" rather than "below" is load-bearing: the predicate is exact and the display is
rounded, so at 14.00%/8.00% over ten years a $2.50/mo row trails by under a cent and prints as
exactly what was paid in. The sweep caught the tie; reading the sentence would not have.

### Gate

`bash scripts/verify.sh` → **VERIFY GREEN**: tsc 0, eslint 0, **5513 unit / 334 files**, build
clean. Affected e2e serially on the fresh build: 21/21 (phase3-coach, auth, mobile-overflow).

### Honest status of the critic requirement

Two fresh-context cycle-2 critics were launched and **both died on a platform session limit**
before returning findings. Everything above came from running their assignment by hand, which
is weaker than an independent pass because the checks were chosen by the author of the code.
W.10 has had one full critic cycle (#363's two critics, both FAIL, converging independently on
two P1s); W.10a has had none. A second pass over `opportunityBasis`'s branches is owed and is
filed, not waived.

## 2026-08-01 — W.10a's owed critic cycle, run (DECISIONS #366)

Fresh-context adversarial pass over `opportunityBasis`, the thing #365 filed as owed rather
than waived. Its branches all held under execution (the `trails` array is a PREFIX in 0/2,501
counterexamples, so the mixed branch's unproven "the shorter horizons" is true; "at or below"
survives the rounded display at $0.01/mo with 12 exact ties; the sentence is gated on the same
rate pair `findOpportunities` received).

**The P1 was one function above.** `COACH_COPY.opportunity` still ended every row "compounding
does the work, not willpower" guarded by `nominalReturnBps === 0`, because #363 had recorded
that the zero dial was "the only degenerate input" — a claim W.10a's own sweep disproved without
the neighbouring decision being re-read. 1,275 of 2,400 non-zero dial pairs put every printed
figure at or below the dollars handed over; at 10.25%/10.00% a $50/mo row printed $6,833.08
against $18,000 paid in, and 7.00%/3.75% reaches it from the default return dial.

Fixed with `opportunityRowTrailsContributions`, reading the row's PRINTED integers rather than
re-deriving from the dials, `<=` (a sub-cent trail prints as exactly what was paid in) and ANY
of the three (one sentence enumerates all three). The trailing branch drops the payoff and adds
nothing — the paragraph that explains it renders under the identical gate.

An existing test was certifying the defect ("…and the ordinary branch still says it") on a
fixture whose 10-year figure was below its own contributions; fixture corrected. #363's
falsified sentence amended in place rather than left to lapse.

Gate: `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **5518 unit / 334 files** / build
clean; `phase3-coach.spec.ts` 1/1 serially with a new render-site assertion for the
non-trailing direction. Both locks mutation-proven both ways (disabled kills 2, forced-on
kills 3).

One verify invocation out of five failed at the build step with "Turbopack build failed with 2
errors" and I did not capture the error text before rerunning; three runs before it and the
full-capture run after it were green on the same tree. That matches the cold-start flake
CLAUDE.md documents, but since the text is gone I am recording it as unexplained rather than
diagnosed.

## 2026-08-01 — W.13 shipped: the return dial is no longer called the reader's (DECISIONS #367)

The residual W.10 filed. `User.expectedReturnBps` is `Int @default(700)` and **not** nullable,
and the /settings field is required and pre-filled, so a reader who has never opened that page
carries the app's own 7.00% in a row indistinguishable from one who typed it — and six sentences
across three cards called it "your 7.00% return assumption". The wealth card said it outright:
"7.00% return is your setting; 2.50% inflation is Aimplifi's default, which you haven't changed",
one sentence attributing one dial honestly and the other falsely, live on the demo.

Attributed by VALUE (`returnIsAppDefault`), not by the nullable column the task row suggested:
every row already in the database holds 700, so "null means never chosen" would have described
none of them. The copy says "our default 7.00% return assumption" and no longer says "which you
haven't changed" — provable for the nullable inflation column, unprovable for this one. Both
flags travel as one `DialOwnership` object, because two adjacent positional booleans are a swap
that puts each dial's possessive on the other dial's rate.

Surfaces: FI card basis, opportunity basis, wealth card basis / dials / sensitivity intro /
required contribution, /investments retirement outlook, plus a new "The 7% here is our default."
beside the /settings input so the page /coach links to says what /coach says. Enumerated and
deliberately unchanged, with reasons in STATUS: /goals ×3 + the Goals empty state, the /settings
prose, and `opportunity`'s zero-return branch.

### Gate

`bash scripts/verify.sh` → **VERIFY GREEN**: tsc 0, eslint 0, **5549 unit / 335 files**, build
clean. Affected e2e serially on the fresh build: **10/10** (phase3-coach, wealth-target,
investments). Empty prisma diff — no schema change, so the live database is untouched.

### Mutation proof

Server flag forced `false` → the new W.13 unit test dies; forced `true` → W.2's inflation test
dies. Constant drifted to 750 → the schema-parity test dies. `/investments` forced `false`,
**rebuilt**, → the rendered outlook assertion dies; restored, rebuilt, passes. The rebuild was
paid because that clause reads a field three components away and `next start` serves the last
build, not the edit (`e2e-runs-a-stale-build`).

### Critic pass — what ran, and what did not

Self-critic against `docs/CRITIC_RUBRIC.md`, not a fresh-context subagent. Two findings on my
own work, both fixed: the retirement-outlook clause had no rendered lock at all (only a server
field assertion), and three scan-table rows paired an inflation rate with an ownership flag
production cannot produce — under a comment I had just written claiming the opposite. The
surface sweep was re-derived by grepping the rendered strings rather than from my own
enumeration, which is what turned up /goals and the /settings prose.

### Deploy-verified on production

Shipped `d3268b9`; Vercel `aimplifi-d9fu4jn7r` **READY** on that exact SHA
(`vercel ls --meta githubCommitSha=d3268b9a4ce...`), www aliased. `/coach`,
`/investments` and `/settings` are auth-gated, so a `curl | grep` gets a 307 and proves
nothing — `scripts/w13-live-deploy-check.mjs` signs into the shared demo and reads the real
pages: **15 passed / 0 failed**. Every check is a pair (new possessive present AND old one
absent) on an element asserted to exist first, and the demo row is the exact case W.13 is
about, so the old build cannot pass a single line of it. Live text now reads *"Both rates are
Aimplifi's defaults — 7.00% return and 2.50% inflation"* where it read *"7.00% return is your
setting"*.

## 2026-08-02 — Calculation audit: six-critic adversarial review (assessment only, no code changed)

Owner asked for "a multi agent adversarial review of every displayed calculation in this app",
triggered by /trends telling him he was **"on pace for $19,713.85 less than last month"** on the
2nd, having spent $578.79 — *"8971.25 makes no sense since our mortgage is ~6200"*.

**Deliverable: `docs/CALC_AUDIT_2026-08-02.md`. Queue: TASKS.md Wave C (C.0–C.17).** This session
wrote no source. `git diff --stat` was empty before the commit — checked deliberately, because a
critic has left a mutation in this tree twice (`a-subagents-green-is-a-hypothesis`, O.17c and the
L.31 expander slice).

### Both owner numbers resolved exactly, before any critic ran

`57879 / 2 days * 31 = 897125c = $8,971.25`, and `897125 + 1971385 = $28,685.10` = July actual.
So the projection is `(spentSoFar / daysElapsed) * daysInMonth` over 48 hours, multiplied by 15.5,
published as the month's forecast on a card that states no assumption and paints it green.
Resolving the arithmetic first is what made the critic briefs specific enough to be useful.

### Method

Six parallel read-only critics, each a different lens: (A) /trends + dashboard card, (B) spending
plan / Fixed vs discretionary / budgets, (C) money INSTRUCTIONS — cash-needed, forecast, radar,
cards, calendar, (D) long-horizon — coach / FI / wealth target / investments / goals, (E)
cross-surface parity, (F) transaction + rules UX. Each was told: no edits, no `verify.sh`, no
build, no Playwright (parallelise for FINDING, serialize for PROVING), `node -e` arithmetic only,
label anything unexecuted `HYPOTHESIS`, and end with "what I could not break".

**Result: 8 P0, 29 P1, ~20 P2, plus 7 UX P1.** Seven of the eight P0s were reproduced in the main
thread against source before being written down.

### The P0s (see the audit doc for evidence per finding)

1. **`CardPayment` has no production writer** — only `prisma/seed.ts`. So on real linked cards a
   paid bill is demanded again AND double-counted, because the checking debit is seen and the card
   credit is not. `engine.ts:15`, `EDGE_CASES.md §B` and `ROADMAP.md` all claim it works.
2. **Dashboard hero can name a FROZEN account as the transfer source** — `dashboard/page.tsx:112-117`
   filters only `type === 'SAVINGS'`, sorted by balance desc, missing the three guards
   `radar.ts:370-378` applies on the same page. A frozen balance reads high, so it is chosen
   *preferentially*. `failure-direction-is-per-role-not-per-value`, on the surface that lesson was
   written about, never swept.
3. **/calendar places each card/loan due exactly once, ever** — busy grid, "0 payments due".
4. **Fixed union double-counts a mortgage** — the rollup dedupes on the filed `categoryId`, the
   series on the normalizer's guess, and there is no mortgage pattern in `normalize.ts`, so it
   resolves `uncategorized` → null → added ("Out-of-dial / null ids are added", `plan.ts:475`).
5. **"Typical spend" divides by a constant 3** regardless of occurrences.
6. **`annualExpenses = expenses6 * 2`** (`coach.ts:247`) while the three lines around it divide by
   `last6.length` — every long-horizon figure exactly half at 3 months of history.
7. **Pace abstains on an AND** (`trends.ts:300`), so a zero-spend day renders "$0.00 projected by
   month end" + a green "$28,685.10 less than last month".
8. **Wealth-target card calls an aspirational target "what was left after spending"**, and the
   floored-contribution refusal is bypassed because the flag tests the passed-in value.

Also worth flagging on its own: **the Glass-Box "matched to the penny" certification cannot fail**
(`trace.ts:365-386` checks an expression against itself), so it returns green for every defect
above and then adds "nothing is invented". That is the app's designated trust surface.

### Two things this session deliberately did NOT do

- **No fix.** The owner asked for a review; LOOP_ENGINEERING's assessment-vs-fix rule makes the
  findings the deliverable.
- **No guess at the Fixed cause.** C.4/C.5 move Fixed in the OPPOSITE direction from the pace
  defect the owner actually reported. Three prior sessions each shipped a plausible Fixed-figure
  fix without measuring and none was the cause
  (`three-sessions-of-hypothesis-one-query-of-evidence`), so C.0 — a read-only production replay of
  the owner's mortgage row — gates that cluster.

### Method notes worth keeping

- Resolving the reported numbers arithmetically BEFORE dispatching critics turned a vague brief
  into an anchored one, and it killed the comfortable reading (the figure is not noise, it is a
  correct computation of the wrong model).
- The six lenses earned their cost in the NON-overlap: A found the zero-spend P0 the owner had not
  hit yet, B found the double-count pointing the opposite way from the reported symptom, C found
  the missing `CardPayment` writer, F found that **three of the owner's four UX asks already
  exist** — which changed the UX work from "build affordances" to "the return link is rooted at
  the wrong path literal and the spend-class control is in the wrong place".
- `tests/unit/trends.test.ts:249-251` asserts `projectedCents` equals its own formula. It cannot
  fail for any model and will resist C.2 — delete it before touching the projection.

### Gate

**Not run, and not applicable.** No source file was changed; the only edits are
`docs/CALC_AUDIT_2026-08-02.md`, this entry, and TASKS.md Wave C. `tsc`/`eslint`/`vitest`/`next
build` cannot be affected by a markdown file, so a green gate here would prove nothing about the
findings — every P0 above is UNFIXED and the suite is expected to pass with all of them present.
Empty prisma diff; the live database is untouched.

### Owner's response to the audit, same session — READ THIS BEFORE STARTING ANYTHING

*"doesn't seem like it's fixed at all"*, then a `/clear`. He is right and it is the correct
reaction: this session shipped a document, and the $8,971.25 he reported is still on his screen.

**The next session's job is SHIPPING FIXES, not more analysis.** The audit is done; do not
re-review, do not re-derive the findings, do not open a second critic wave. `docs/CALC_AUDIT_2026-08-02.md`
plus TASKS.md Wave C already hold every mechanism with file:line evidence — start from those and
write code.

**Start with the number he actually reported**, not with C.0. My earlier "C.0 first" ordering was
right about the FIXED cluster and wrong as an overall plan — C.0 is a database measurement that
gates C.4/C.5 only, and it produces nothing the owner can see. Correct order:

1. **C.1 + C.3 + C.2, as one slice on /trends** — the zero-spend abstention, the dashboard card's
   missing day-count/assumption/horizon and its false green, and the projection model itself.
   That is his complaint end to end, and C.1/C.3 are small and verified.
   Delete `tests/unit/trends.test.ts:249-251` FIRST — it asserts the formula against itself and
   will pass for whatever C.2 does, correct or not.
2. **C.7** (frozen transfer source) — small, verified, and the fix is deleting a local derivation
   in favour of `radar.coverTransfer.sources[0]` that already exists.
3. **C.0**, then the C.4/C.5 Fixed cluster.
4. C.6 (`CardPayment` intake) is the largest money defect and deserves its own session.

Design note already gathered for C.2, so it need not be rediscovered: `snap.scheduled`
(`providers/types.ts:38`) is on the snapshot `getSpendingTrends` already loads, and
`expandScheduled` (`forecast/forecast.ts:71-116`) already expands cadences into dated
occurrences — so the pieces exist. The correctness hazard is **double-counting a scheduled bill
that has ALREADY posted this month**: any projection of the form
`spentSoFar + remaining scheduled` must exclude occurrences dated on or before `today`, and must
not re-add a bill whose transaction is already inside `spentSoFarCents`. Decide that dedupe rule
explicitly and lock it, or the fix trades an understatement for an overstatement.

## #388 — C.1: the pace card abstains on a month with nothing counted (2026-08-02)

**Shipped and deploy-verified.** `computePace` returned a projection whenever LAST
month had spending, so a reader whose feed had not yet delivered a row for the
in-progress month saw "$0.00 projected by month end" beside a green "on pace for
$28,685.10 less than last month". The guard is now the single condition
`spentSoFarCents === 0`, and the abstention speaks instead of the card vanishing:
`PACE_NO_SPEND_YET` is authored once in `engine/trends/labels.ts` and rendered by
both the dashboard card and /trends.

The copy change is not cosmetic. The dashboard's old fallback — "Not enough
activity yet to spot trends" — was only ever reachable when the reader had no
history at all; C.1 makes it common on the first days of a month, where the
biggest-change row directly beneath it is naming a completed-month fact. The
sentence had to move with the branch (`a-fix-that-cannot-fail-a-test-is-a-hypothesis`:
making an old path newly reachable means owning its latent defects).

### Gate
`bash scripts/verify.sh` → **VERIFY GREEN**: tsc clean, eslint clean, **5643 unit
tests / 345 files**, `next build` clean. `trends.spec.ts` 3/3 (the positive path is
untouched on demo data) and the new `trends-pace-abstain.spec.ts` 1/1.

### Mutation proof (both layers)
Reverting the guard to `spentSoFarCents === 0 && priorMonthCents === 0`:
- 4 unit locks fail — days 1/2/3 and the netted-to-zero month.
- The e2e fails **through a fresh `next build`** (`e2e-runs-a-stale-build`), and it
  fails at the right assertion: the fixture's hard case (the mover row proving the
  reader HAS history) passes first, then the abstention is absent.
The false-abstention control (a single day-1 charge still projects, $578.79 × 30)
passes on both old and new code, which is what makes it a control.

### Deploy
`8c52d04` → `aimplifi-dcaszq901` **● Ready** Production, confirmed by
`vercel ls aimplifi --meta githubCommitSha=8c52d04663…`. Empty prisma diff — the
live database is untouched. **No live-HTML marker exists for this change and none
was faked:** both surfaces are server components, so the new sentence ships in no
client chunk, and its branch cannot render on the public demo (847 seeded
transactions in the current month). The commit sha on a READY production
deployment is the verification here.

### Owner-visible effect
On his account this changes nothing *today* — his August has spending, so his card
still reads the C.3 wording. It removes the false green from the shape he will hit
on the 1st of September, and any morning a sync is behind.

## #389 — /coach savings-rate bars expand into the rows behind them (2026-08-02)

**Shipped and deploy-verified.** Owner: *"again, make all charts and summaries,
expandable … if i want to know why and where cash come from that caused greater
savings for a specific month, i should be able to click on the graph itself"*.

**First, what was already true** (`a-repeated-request-is-about-the-gesture`
says to establish this before building): /reports' income-vs-spending chart has
had exactly this gesture since O.20 — tap a bar, the month's transactions open
in place. So the request was not for a capability the app lacks; it was for a
chart that lacked it. The savings-rate chart on /coach — the headline metric of
the page — was twelve inert `<div>`s carrying a `title` tooltip, which is a
hover affordance and therefore nothing at all on the phone he uses.

**Design point worth carrying to C.18:** a savings rate is a RATIO and has no
rows. Its two inputs do. So a bar opens two panels — the income counted that
month and the spending counted that month — rather than one panel pretending to
be "the rows behind the rate". Every remaining chart gets asked the same
question first, and the retirement-outlook chart is the one where the answer is
"this figure has no rows at all, so refuse".

### Gate
`bash scripts/verify.sh` → **VERIFY GREEN**: tsc clean, eslint clean, **5647 unit
tests / 346 files**, `next build` clean. e2e: `savings-rate-drilldown` 2/2 (new),
and `phase5-a11y` + `phase3-coach` + `mobile-overflow` **24/24** together — the
a11y run matters because the bars stopped being decorative divs and the
container's `role="img"` had to go (an image may not contain interactive
children).

### Mutation proof
- Keying fewer months than the chart draws (`flows.slice(0,1)`) → all 4 unit
  locks fail.
- Drifting a headline by one cent → exactly the reconciliation lock fails, and
  only that one.

### Deploy
`2383d84` → `aimplifi-dbjv1ckf4` **● Ready** Production, sha-matched via
`vercel ls --meta githubCommitSha=…`. Empty prisma diff. As with #388 there is
no fetchable live marker: /coach is behind auth, so the rendered bars cannot be
curl'd from here; the evidence is the sha on a READY deployment plus the local
e2e against a fresh build.

### Not done, and queued as its own rows
- **C.18** — the other five charts are still inert (net worth, forecast,
  retirement outlook, life energy, cards breakdown), each with its own note on
  what its figure is actually made of.
- **C.19** — the owner's second message, per-transaction Fixed/Discretionary
  with the category-wide setting demoted to an explicit rule. NOT started. It
  reverses DECISIONS #378 and its real work is the money half: every Fixed
  figure is derived at CATEGORY level today, so the sums must move to rows in
  the same slice or /budgets and the plan will disagree.

## #390 — The pace projection reads the bill calendar (C.2, 2026-08-02)

**Shipped.** Owner's report, verbatim: *"'on pace for 19,713.85 less than last
month' how? we've spent 578.79 on the first day of the month... 8971.25 makes no
sense since our mortgage is ~6200."* C.1 (#388) stopped the projection speaking
from zero observations and C.3 (#387) made it name its divisor; neither moved
the figure. This is the one that moves it.

### What was wrong
`computePace` read transactions and nothing else, and extrapolated a single daily
rate to month end. The bill calendar — `snap.scheduled` — was already on the very
snapshot `getSpendingTrends` loads. A household month is a few large dated bills
plus noise, so the uniform-stream model is biased in a direction you can predict:
low before the bills land, then wildly high the morning they do. A critic
executed the same account reading "$6,200.18 less than last month" in green for
four days and "$32,239.82 more" in red overnight.

### The model
    projected = spent so far  +  bills still due  +  discretionary x days left

Spent-so-far is measured. Bills come from the stored calendar, matched to their
own charges by an EXACT merchant key — `toScheduledRow` stores
`series.merchantCanonical` and `toTrendTxns` puts the same normalizer's canonical
on the row, so the link is structural rather than the money-matching heuristic
#134 rejected — and credited at `min(posted, expected)` so a merchant that is both
a bill and a shop ($15 of Prime inside $415 of Amazon) cannot swallow $400 of
discretionary spending. The rate is taken over what is LEFT after the bill money,
which is the only part a daily rate honestly describes.

Two decisions worth carrying:

- **Bills are counted over the whole calendar month, never split at `today`.** The
  first design dated them against today, which is the L.11(D) edge: a mortgage
  dated the 1st that has not posted yet is still to come, and that model answered
  $578.79 for the owner's month — worse than the defect it replaced.
- **Admission: a bill enters only where the app has EVER counted a purchase at
  that merchant, on the basis being compared against.** One rule does three jobs —
  it keeps out the auto-loan ACH (the one `isTransfer` class detection keeps, so
  its money is in neither side of the comparison), the demo's savings sweep, and
  any hand-authored label no merchant can match. Aggregate pseudo-merchants are
  refused as well: "Zelle Payment" is a pattern, not an identity.

### Owner-visible effect
On the fixture built from his own figures, day 2 of the month projects $14,881.85
instead of $8,681.85, and the bill is named on screen: "$6,200.00 of bills still
due: Mr Cooper". Day 10 of the same month projects $14,882.00 — 15 cents apart,
where the old model swung $18,600 overnight. The assumption sentence gained three
branches (no bills / bills still due / bills already charged) because a reader can
no longer divide spent-so-far by the day count and reproduce the figure, and it
states what it cannot see: bills charged to a credit card produce no scheduled row
at all, so the copy says card-charged and unspotted bills are NOT in the total.

Also in this slice, same field: /trends still tinted an exact tie green off a bare
`> 0`. C.3 fixed that on the dashboard card only; both surfaces now read
`paceDeltaRelation`.

### Gate
`bash scripts/verify.sh` -> **VERIFY GREEN**: tsc clean, eslint clean, **5669 unit
tests / 347 files** (was 5647/346), `next build` clean. e2e: `trends.spec`,
`trends-pace-abstain.spec` and the new `trends-pace-bills.spec` **5/5** together,
serialized, against a fresh build.

### Mutation proof (six, each killed a lock)
- bills never counted -> 5 locks fail (incl. the intake test)
- credit uncapped -> the Prime-inside-Amazon lock fails
- admission rule dropped -> the three-refusal lock AND the demo-seed pin fail
- aggregate guard dropped -> the aggregate refusal fails
- admission scoped to this month (the bug I shipped and caught mid-slice) -> 3 fail
- bill money left inside the daily rate -> 2 fail

### Not done
The demo seed admits no bills — its scheduled rows are hand-authored labels
("Rent — Peachtree Properties") plus payroll, which is the correct outcome and is
now PINNED so the demo cannot stop exercising the feature silently. It does mean
the public demo's pace is unchanged; the e2e proves the bill path on a throwaway
user with a real `ScheduledTransaction` row.

### Deploy (#390)
`4007534` -> `aimplifi-6k7acc7b3` **● Ready** Production, sha-matched via
`npx vercel ls aimplifi --meta githubCommitSha=4007534...`. Empty prisma diff, so
the live Neon database is untouched. As with #388/#389 there is no fetchable live
marker — /trends and the dashboard are behind auth, so the rendered bills line
cannot be curl'd from here; the evidence is the commit sha on a READY production
deployment plus the local e2e against a fresh build.

## #391 — The owed C.2 hostile-critic cycle, and C.7 (2026-08-02)

**Two things shipped: the critic cycle #390 never got, and the frozen-transfer-source P0.**

### Why this session existed
#390 shipped C.2 and its two hostile critics both died on an API session limit
before reporting. `a-rate-and-its-target-must-share-a-unit` is explicit that a
critic that did not run is not a pass, so the cycle was re-run before anything
new was built on top of the pace work. Both critics were read-only (no Edit/Write
tools) so neither could leave a mutation in the tree — the failure recorded twice
in `a-subagents-green-is-a-hypothesis` and `a-repeated-request-is-about-the-gesture`.

### Cycle 1 result: FAIL from both critics, independently
Money-math lens: 2 P1 + 2 P2. Copy/claims lens: 1 P0 + 4 P1 + 3 P2. They
overlapped on nothing, which is the argument for running two lenses.

**P0 — branch B claimed completeness.** "The bills we can see for this month have
already been charged" was the only branch that declares the projection finished
and the only one carrying no limitation. It is false by scope: the engine refuses
scheduled rows it can plainly see (an aggregate "Zelle Payment" landlord, a
hand-authored label, a transfer-paid obligation), and **/calendar renders those
same refused rows as bills still due, one click away, off the same array**.
Branch A's hedge was no better — an enumeration of two exclusions where at least
five classes exist. Both now carry one positively-stated coverage clause: *only
bills we can match to a merchant you have spent at are counted*. A positive rule
cannot decay as an exclusion list does; every refusal added later is covered by
construction.

**P1 — a future-dated row could admit a bill.** `counted.add` sat above the
`date > today` guard, so a transaction the app says has not happened could put a
$500 bill into the projection while contributing $0 to the month total. Fixed by
moving one line; `aggregateMerchant` deliberately stays outside the guard because
it only ever refuses.

**P1 — the clamp deleted real money.** `Math.max(0, spentSoFar − credited)`
absorbed a basis crossing (the month total nets refunds by CATEGORY, the credit
sums per MERCHANT) by wiping the daily rate: a genuine $30/day of dining became
$0/day and the month flat-lined, reading as "on pace to spend less". Now the
crossing is detected and no credit is taken, which errs toward tightening.

### C.7 — the dashboard could tell you to move money you do not have
`dashboard/page.tsx` derived its own funding source with `type === 'SAVINGS'`
sorted by balance — none of the four guards `radar.ts` applies to the same
account array on the same page. A frozen balance is stale and reads HIGH, so it
sorted FIRST. The mutation run printed the defect in full: **"Transfer $8,500.00
from Rainy Day Reserve ($50,000.00 available) by Wed, Jun 24"** on an account
frozen since May 20. The rule now lives in `eligibleTransferSources` and both
surfaces obtain it there; `sufficient` stays at the radar call site because it is
a claim about that engine's own figure.

Nothing on the seeded demo moves: High-Yield Savings still wins and the payment
account is correctly excluded.

### Gate
`bash scripts/verify.sh` → **VERIFY GREEN**: tsc clean, eslint clean, **5685 unit
tests / 348 files** (was 5669/347), `next build` clean. e2e serialized against
that build: `trends`, `trends-pace-abstain`, `trends-pace-bills`,
`transfer-source-frozen`, `phase1-cash-needed` — **8/8**.

### Mutation proof (five, each killed its own lock and only its own)
- old branch-B sentence restored → 3 label locks fail
- admission line order restored → the future-dated lock fails
- `Math.max(0, …)` restored → the net-refund lock fails, discretionary 0 where $30.00 belongs
- frozen guard dropped from the selector → 2 of the 9 selector locks fail
- local derivation restored in `page.tsx`, **through a full rebuild** → the e2e fails and renders the P0 verbatim

One lock failed honestly on first write: the future-dated fixture reused a
merchant whose prior-month charge admitted the bill legitimately, so it passed on
the old code. The fixture was doing the work, not the guard — caught by running
it before believing it.

### Not done, queued
- **C.20 (new)** — the two bases are prevented from crossing destructively, not
  unified. `spentSoFarCents` nets by category; the bill credit sums by merchant.
  The real fix attributes the credit through the same netting.
- **Branch C still says nothing about bills.** It fires when NO bill was admitted,
  which conflates "you have no bills" with "we matched none of yours" — the
  `a-zero-is-a-claim-and-must-name-which-zero` shape. It needs a refused-count
  fact from the engine, so it is C.21 rather than a copy tweak.
- The critic's rendered-coverage finding (branches B and C never render in a
  test) is **partly declined on purpose**: both surfaces call `paceAssumption(pace)`
  unconditionally and the branch is chosen inside the pure function, so the
  existing rendered lock proves the call site and the unit goldens prove all
  three branches. What is genuinely uncovered is a rendered branch-B string, and
  that is noted rather than claimed.

## #392 — "First of all the monthly income is wrong" (2026-08-02)

**Owner-reported mid-session, and it was real: /spending-plan showed $10,681.30
where the median of his three complete months is $30,937.91.**

### The session started somewhere else
The queue said C.0 next (the read-only mortgage replay gating C.4/C.5). That work
had got as far as pulling production env and confirming the C.4 mechanism in
source — `detectRecurring` groups on `normalizeMerchant(rawDescriptor).categoryId`
(the normalizer's GUESS) while the Fixed rollup keys on `Transaction.categoryId`
(the FILED category), so the two halves of the union genuinely dedupe on
different fields. Then the owner reported the income figure and that outranked
it. C.0 is still open; the env pull and the mechanism confirmation carry over.

### Measured before touching anything
`scripts/audit-probes/income-replay.mts` — read-only, reproduces the consumer's
whole scope clause by clause and runs the REAL engine functions over the real
rows. It found the cause in one run:

- 26 active reconciliation links. Link #24: his SimpleFIN Schwab checking is the
  PREDECESSOR of the Plaid "Investor Checking", cutover **2026-07-21** — and the
  successor is his payment account.
- `applyReconciliationBoundary` decides which side OWNS a date. It does **not**
  re-key transactions, so pre-cutover paychecks keep the predecessor's id.
- The income scope is `{paymentAccountId}`. Every row before 07-21 fell outside
  it: **3 positive rows in scope, one complete month**, so the "median of up to 3
  complete months" was a median of one part-month.
- Counterfactual in the same run: scope + successor re-key gives
  May $30,937.91 / Jun $21,117.48 / Jul $31,408.61, median **$30,937.91** —
  identical to "every CHECKING", and July sums the two feeds without
  double-counting because the boundary had already dropped 96 overlap rows.

### The fix, and why it is one line
The two sibling paths in the same file already do this. The boundary re-keys
`snap.scheduled` itself (F6 — its comment literally says "so the successor's
payment-account filter finds them") and `countedExpenseSeriesForPlan` remaps
detected series 280 lines below. The income transactions were the one scoped
path that never inherited the rule. `getSpendingPlan` now reads each row's
account through `activeTerminalSuccessorMap` before testing the scope.

Demo is byte-identical by construction: no links → empty map → same id.

### Gate + mutation proof
`bash scripts/verify.sh` → **VERIFY GREEN**: tsc clean, eslint clean,
**5688 unit tests / 349 files** (was 5685/348), `next build` clean.
`spending-plan.spec` + `spending-plan-month-edge.spec` 3/3 serialized.
Mutation: reverting the filter yields `[400000]` — a single part-month, the
production defect in miniature — and kills all three new locks.

### The sibling, and the assumption the probe killed
`radar.ts:145` narrows POSTED rows the same structural way (183 rows against 402)
to detect the committed merchants it excludes from discretionary burn. I wrote
down that this "overstates burn" and then measured it: `detectRecurring` finds
**9** series as shipped and **4** with the re-key, because one merchant arriving
under two feeds' descriptors loses the gap regularity each feed had alone. The
naive remap would have moved five merchants INTO burn. Queued as **C.22** needing
a descriptor-level merge, not an id remap — direction not yet established.

### Ship
Pushed `e1b0241`; no `prisma/` diff, so the live database is untouched.
Vercel **● Ready** on production, sha-matched via `--meta githubCommitSha`.
/spending-plan is behind auth so the rendered figure cannot be curl'd from here —
the evidence is the sha-matched READY deployment plus the local e2e against a
fresh build. The figure is computed at READ time, so a page reload shows it; no
sync or cron is involved.

## #393 — C.0: the mortgage replay (2026-08-02)

**The read-only measurement that gates C.4/C.5 ran
(`scripts/audit-probes/mortgage-replay.mts` + `mortgage-pair-check.mts`), and it
settles the audit's central question: the owner's Fixed figure is dominated by
P1-13 (a transfer-flagged bill invisible to both halves of the union), not by
P0-4's double-count — though P0-4 is ALSO live, at $296.40/mo in the opposite
direction.**

### The mortgage row, answered exactly as the audit asked
- `TRUIST MORTG OLB MTGPMT`, $6,217.07 monthly, four occurrences Apr 20 → Jul 20.
- `Transaction.categoryId` = `rent` on ALL four rows (the normalizer's guess is
  `uncategorized` — no mortgage pattern, as P0-4 predicted — but the rows were
  FILED correctly).
- `isTransfer` is **mixed: May and June true, April and July false.** The pair
  detector matched each payment against the linked Plaid mortgage account
  ("Mortgage 1192"), which posts the same $6,217.07 as a `Payment` INFLOW. May
  settled 2 days apart (paired), June 2 days (paired), July 4 days (outside the
  ±3-day window — NOT paired), April had no mortgage-side row at all.
- **No stored `RecurringSeries` exists for it, and live detect finds nothing**:
  `detectRecurring` drops transfer rows at intake unless the normalizer guesses
  `auto-loan`, so the group keeps only Apr 20 and Jul 20 — 91 days apart, no
  cadence. The app's own mechanism for "loan payment tagged as transfer" (the
  union's documented auto-loan case) fails on mortgages purely because
  `normalize.ts` cannot say "mortgage".

### What the plan actually computes for him (replayed with the real functions)
- Rollup `resolveFixedCategoryAmounts` = **$7,941.10**, of which `rent` is
  **$2,072.36** — July's single counted payment ÷ 3, because the flagged May and
  June rows fail `countsInFlows`. The mortgage alone under-counts Fixed by
  ~$4,144.71/mo, the dangerous direction, and matches the owner's report.
- Union `recurringOutsideFixedCategoryCents` = **+$296.40**, and both rows are
  REAL double-counts (P0-4 live): Principal life insurance $146.40 (series id
  `uncategorized`, rows filed `life-insurance`, which is IN the rollup) and
  Zelle house cleaning $150.00 (series id `uncategorized`, rows filed
  `home-services`, in the rollup). Suggested Fixed = $8,237.50; no fixed
  override set, so this IS the term he sees.
- C.5's constant divisor, measured per category: Mathnasium (`education`,
  detected MONTHLY, first charge July) prints $197.67 where $593.00 is true —
  the July-start-mortgage shape the audit predicted. BUT the same table shows
  the prescription "divide by months with a charge" is wrong for long-cadence
  bills: `auto-insurance` $1,553.00 charged once in the window is CORRECTLY
  smoothed to $517.67 by ÷3; months-with-charge would triple it. The honest
  divisor is "months the category could have been observed", not "months it
  charged".

### Queued / carried
- **C.4 and C.5 are UNBLOCKED** — mechanism and magnitude both measured.
- **P1-13 gets its own row (C.24)**: the mortgage's Fixed starvation is the
  transfer-pair flag (timing-luck inconsistent month to month) plus the
  normalizer's missing mortgage vocabulary plus the union's category-level
  dedupe, and none of C.4/C.5 as specified repairs it. Direction question
  included: paying a linked mortgage IS an own-account transfer for cash-flow
  purposes, and is ALSO the owner's largest fixed cost — the fix must decide
  where that money is represented, not just unflag it.
- Also seen in passing (not acted on): July's `CAPITAL ONE CRCARDPMT` is filed
  `transfer` where its six siblings are `credit-card-payment`; a `fuel`-filed
  ±$5.4k reversal pair in May/June nets to a plausible-looking $166.78/mo.

### C.4 + C.5 shipped in the same session (DECISIONS #393)
- **C.4:** a counted series' category now resolves from its own rows' FILED ids
  (`filedCategoryByMerchant`: outflow cents, rollup-window first, all-time
  fallback, recency tie) in `countedExpenseSeriesForPlan`. The task row's
  "null → skip" was deliberately NOT shipped (unfiled rows are in no rollup
  category, so adding them cannot double-count; skipping would open a new
  under-count) — see DECISIONS #393.
- **C.5:** the typical divisor is now the months the category could have been
  observed, numerator sharing the same basis; `typicalMonths` rides the row and
  the /budgets label states method + window (`fixedAmountBasisClause`).
- **Three hostile-critic cycles, all fresh-context and read-only.** Cycle 1
  (two lenses, both FAIL, 3 P0 + 4 P1 money, 3 P1 copy): all-time row-count
  modal reopened the double-count via stale filings; aggregate canonicals mixed
  payees; a remap could enter `PLAN_FIXED_NEVER` and drop the CarMax-class
  obligation; a pre-first-charge refund diluted the average to a false "$50.00
  (typical)"; the "since its first charge" label was falsified (the clock is
  COUNTED outflows, the register can show excluded charges). Cycle 2 (FAIL, 1
  P0): the blanket aggregate refusal preserved the original double-count for a
  fully-filed aggregate → supermajority rule. Cycle 3 (FAIL, 0 P0 + 2 P1): a
  bare supermajority swallowed a minority UNFILED payee → any unfiled remainder
  refuses; 89/91 boundary + threshold-value locks added. Every fix
  mutation-proven (8 mutations total, each killing exactly its own lock).
- **Stale e2e goldens repaired in the same slice:** glass-box.spec's `>= 4`
  plan-row counts dated from the pre-2026-08-01 4-row trace (9087d26 removed
  the card row; verify.sh never runs Playwright by default, the
  `fencing-a-write-path-breaks-the-tests-that-drove-it` gap).

### Gate + ship
`bash scripts/verify.sh` → **VERIFY GREEN**: tsc clean, eslint clean,
**5707 unit tests / 349 files** (was 5688/349), `next build` clean. Affected
e2e serialized against the final build: spend-class, spend-class-drilldown,
txn-spend-class, spending-plan, spending-plan-month-edge, budget-targets,
budgets-basis, glass-box, conscious-buckets — **14/14 + glass-box 4/4**.
Production replay with the shipped code mirrored: union **$0.00** (was
+$296.40), suggested Fixed **$9,785.24** (was $8,237.50; education now
$593.00). The remaining gap to the owner's ~$12.4k truth is the mortgage
(C.24).

**Shipped:** `8ff5208` pushed; no `prisma/` diff (live database untouched).
Vercel production deployment `aimplifi-lh27qquvc` — **● Ready**, sha-matched
via `vercel ls --meta githubCommitSha=8ff5208…`, aliased to www.aimplifi.app.
Fixed is computed at read time, so a page reload shows the new basis; no sync
or cron involved.


## #400 — C.25 measured, attempted, and reverted (2026-08-03)

**The mortgage really does count as spending in half the owner's months and not
the others. The fix that removes it from the other half was built, passed the
whole gate, and was reverted: a fresh-context critic found five P0s and three
reproduced by execution. Nothing shipped; the evidence and the corrected
direction did.**

### Measured first (read-only, `scripts/audit-probes/c25-who-sees-the-mortgage.mts`)
- `countsInFlows` is **true in April and July, false in May and June** for the
  same $6,217.07 charge — the pair lands 2 days out in May/June, 4 days in July,
  and April has no counterpart row at all. Residual (2) confirmed live.
- **Residual (1) is refuted.** `Mortgage 1192` carries `minimumPaymentCents` and
  `dueDayOfMonth`, so `selectLoanObligations` dates it and the radar / /forecast
  / /calendar already expand three $6,217.07 committed events per 90-day window.
  The `loanPayment` keep C.25 asked for would have DOUBLED the bill on the
  committed line, and the #134 disclosure could not have fired (it keys on an
  `auto-loan` normalizer verdict; this descriptor normalizes to `uncategorized`).
- Residual (1)'s burn half: real mechanism, **$0.00 today** — typical $235.59/day
  and heavy $401.54/day are identical with and without the merchant excluded,
  because only one mortgage week sits inside the 8-week window and neither the
  median nor the p80 rank reaches it.

### Built, gated, then reverted
`planTransferUpdates(txns, accountTypeById)` swept every payment-account outflow
of a `loanPaymentMerchantCanonicals` merchant at the one production writer of
`isTransfer`. Gate was green — tsc, eslint, **5772 unit / 352 files**,
`next build`, and budgets-basis + reports-total-reconciles + spend-class +
transactions e2e **25/25** — with 16 locks and 4 mutations each killing exactly
its own lock. The critic still found it unsafe, and three findings reproduce in
`scripts/audit-probes/c25-critic-repro.mts`:
1. `m.aggregate` is a six-name list, so `ONLINE PAYMENT` / `BILL PAY` / `ACH
   DEBIT` are ordinary canonicals: on a bank that stamps every ACH alike, one
   $450 auto-loan payment flagged AND auto-filed rent, electric and internet —
   $2,215.00/mo of real bills deleted from every total.
2. One coincidental amount match classifies a payee forever at every amount (a
   roofing invoice equal to a mortgage payment took its own later $1,250 bill
   with it).
3. It defeats C.24's exactness invariant: `classifySpendClass` returns
   `out-of-scope` for a transfer row, so in the no-series branch Fixed loses the
   whole bill and nothing re-enters it — the dangerous direction, and the exact
   defect C.24 existed to fix.

### The error worth keeping
The reverted draft claimed `resolveFixedCategoryAmounts` and
`monthlyNonDiscretionaryCents` "never read `isTransfer`". They reach it through
`countsInFlows` and `classifySpendClass`. The claim came from grepping the
literal string in two files instead of following the call chain — rule 0's own
failure mode, and the reason the change looked safe enough to gate.

### Left in the tree
Both probes (they are the evidence), DECISIONS #400, the requeued C.25 with the
corrected direction, and C.26. No source file changed; `git status` shows docs
and probes only.

**Shipped:** `672b9d1` pushed; no `prisma/` diff (live database untouched).
Vercel production deployment `aimplifi-jgng5xg3v` — **● Ready**, sha-matched via
`vercel ls --meta githubCommitSha=672b9d1…`; www.aimplifi.app answers 200. This
commit changes no source file, so there is no rendered marker to grep for — the
deploy check here is the sha match and the Ready state, not a page assertion.


## #403 — C.25 built: the mortgage leaves the spending totals in every month (2026-08-04)

**The slice the #400 revert pointed at, built the way #400 said to.** Nothing
stored is written: the exclusion is a read-time fact computed ONCE in the
snapshot assembler and inherited by every flow-summing surface through the
shared predicates (optional row-id set; omitted = today's behaviour). The
four gates, in `src/lib/engine/categorize/loan-payment-flows.ts`: the row
would otherwise have counted; its canonical is linked to one loan account by
≥2 distinct pair-months re-derived from the raw rows (the stored flag is not
an input, so it cannot be consulted); that account has a dateable obligation;
the amount equals an obligation payment. Attribution is per edge after critic
P1-3 — an unpaired month leaves only when EVERY linked account can project,
so SimpleFIN and undatable loans keep their money visible (#400's
failure-direction rule, now enforced at row level, not just merchant level).

**Measured before and after.** Replay probe
(`scripts/audit-probes/c25-read-side-exclusion.mts`, first run executed this
session; a re-run for row identities was permission-blocked afterwards —
recorded, not hidden): one merchant edge on the owner's data (Truist →
Mortgage 1192 @ $6,217.07); April −$6,217.07 and July −$12,434.14 leave the
monthly totals, flagged months unchanged. The month-to-month flip is gone.

**Critic cycle 1: FAIL, five P1s — all fixed and locked.** Pace read the
payment through one half of its basis (the bill credit kept admitting it; the
fix drops the excluded merchant from both halves — hand-computed locks in
`trends-pace-loan-exclusion.test.ts`); Ask merchant_spend answered on the old
basis; covered amounts were keyed by canonical only (the two-loans-one-name
shape laundered an undatable loan's payments); the register link invariant
(links refused now for categories whose figure dropped excluded rows); coach
figures moved with zero disclosure (they name it now, FI number included).
Cycle 2 FAILed with three P1s — fixed by the carry CAPACITY cap (at most the
carried count leaves per canonical/month/amount), all-partner eligibility for
attributed rows, and Ask disclosure (lender branch + basis sentence on the
total intents; largest rankings drop excluded rows). Cycle 3 FAILed with one
P1 — disclosure facts now derive from ACTUAL exclusions, never eligibility,
and split/reader-excluded rows can no longer classify a merchant. Cycle 3's
P2 residuals (aggregate-branch clause, pending wording, window-independent
sentence, new-merchant surface) are recorded in STATUS, not fixed.

**Gate:** `bash scripts/verify.sh` → VERIFY GREEN — tsc 0, eslint 0, **5828
unit** (30 new: gates, attribution/capacity shapes, phantom locks, pace
locks, merchant_spend basis, assembler wiring on a throwaway user + the
demo-golden lock). Targeted e2e **39/41** — the two `dashboard-duplicate-disclosure`
mobile failures reproduce identically on clean HEAD (stash-verified), so they
predate this slice and are tracked in STATUS.

**Left in the tree:** the probe, DECISIONS #403, the STATUS entry. The
demo/golden dataset cannot exercise the wiring by construction (the seed's
loan account has no transactions) — the assembler lock on the real client is
the standing guard for it.

## #410 — C.26 built: one window for "spent this month", and the link follows the figure (2026-08-05)

**The slice the C.13 session split out (audit P1-28), built the way its own
revert said to.** `computePace` stopped at today and `spendingByCategory` did
not, so the dashboard's top-spending card and the pace card one inch away
answered "this month" over two windows; Ask carried the same split
(`merchant_spend` has clamped since O.7, the three category intents had not).
The first attempt clamped the figures and was killed by a fresh-context critic
with five executed P1s. All five are addressed here.

**The window is now a value a figure HAS, not a month key two authors expand
separately.** `SpendWindow { fromYm, toYm, asOf? }` in the reports engine, with
named authors (`spentSoFarWindow`, `wholeMonthWindow`, `asOfWindow`) and one
translation to register dates (`spendWindowRegisterDates`).
`categoryMonthRegisterHref` became `categoryWindowRegisterHref` and takes the
window itself, so a caller cannot clamp the figure and not the link without
constructing a second object on purpose. `buildCategoryBreakdowns` takes it too
— a panel rebuilt from the month key would have listed a row its own figure
dropped and turned `reconciles` false on a correct number.

**Decided, not left open (critic P1-2): /budgets keeps the whole month.**
/reports says "you spent" (money already gone ⇒ stop at today); /budgets tracks
an allowance a charge dated for the 20th has already consumed, and clamping
would raise "left to spend" — the generous direction on the one figure that
exists to restrain. Each page equals its OWN register; that is the invariant,
not that the two pages equal each other.

**Income clamps with spending (critic P1-3)**, on /reports' chart and Ask's
`income` intent — the two places a current-month income figure is printed
(/coach filters to complete months, so nothing there moves).

**The basis sentence stayed true (critic P1-4)** by not being stretched:
`BREAKDOWN_BASIS` still claims a complete enumeration and is still complete for
the unclamped surfaces; the clamp gets its own sentence, gated on
`notCountedYetCents > 0` — a fact about this reader's rows, not a restatement of
config — and computed in the engine so no surface can forget it.

**Locks, mutation-proven (critic P1-5, the finding that killed the first
attempt).** `tests/unit/spend-window-parity.test.ts` drives the REAL loaders
(`getReports`, `askAssistant` through the real parser) on a throwaway user with
a future-dated row, plus the O.5 link execution and a CONTROL that lands the
$520.00. Executed: removing the reports window kills 5, removing the income
filter kills 1, removing all four Ask clamps kills 6.

**Gate:** `bash scripts/verify.sh` → VERIFY GREEN — tsc 0, eslint 0, **5964
unit / 362 files**, build clean.


### Critic cycles (C.26)

**Cycle 1: FAIL, 6 P1s, all executed, all fixed.** (1) The /reports view could
still reintroduce the measured $120→$520 defect with the whole suite green, so
the href moved into `getReports` and the view names no window. (2) The new
disclosure was asserted nowhere — basis composition moved out of the .tsx into
`categoryPanelBasis`/`monthFlowPanelBasis`. (3) The CHART panel had the clamp
without its disclosure and printed "Returns in June 2026 outran purchases",
blaming the reader's refunds for money the date rule removed. (4) It could also
print "No posted spending in June 2026" over $400.00 of posted June spending;
`buildMonthFlowBreakdowns` takes `asOf` itself now, carries `notCountedYetCents`
per bar, and `windowLabelSoFar` narrows the label every sentence interpolates.
(5) A category the clamp emptied disclosed nothing anywhere — added a page-level
figure. (6) Ask's basis read as the complete rule while omitting the newest
exclusion.

**Cycle 2: FAIL, 3 P1s, all fixed.** (F1) The page-level figure was
`wholeMonthSum − clampedSum`, and `spendingByCategory` floors each category at
zero independently in each window — so a later-dated refund in one category
cancelled a later-dated purchase in another, the page fell silent, and the panel
directly beneath it still disclosed $400.00. There is now ONE computation,
`notCountedYetByCategory`, feeding both the panels and the page. (F2) The
component layer was still unlockable: the critic deleted every render-site fix
in one pass with 5972/5972 green. Closed by installing a component-render
harness (`@testing-library/react` + `jsdom`, `.tsx` in the vitest include, opted
in per file) — `tests/unit/spend-window-render.test.tsx`. (F3) The dashboard's
top-spending card had inherited the clamp and none of the disclosure.

**Worth keeping:** the F1 fix was written wrong the first time — the total
summed the RAW per-category nets, which re-created the same cancellation one
level up — and the lock written alongside it caught that before the critic did.
That is the difference between a test that asserts the fix and a test that
asserts the property.

**Gate after cycle 2:** VERIFY GREEN — tsc 0, eslint 0, **5983 unit / 363
files**, build clean.


## C.23 / H.4 — reserves are a first-class Fixed kind (2026-08-05, BUILT, critic pass owed)

**What shipped.** The owner's third source of committed money — *"money being
reserved every month for home repair"*, *"yearly membership dues… divide by 12
and put that cash aside"* — now has a model. A reserve is a `Goal` row with
`kind = 'reserve'`, storing the TRUE COST and its rhythm in `targetCents` +
a new additive nullable `Goal.cadence`; the app does the division
(`resolveReserves` → `monthlyRateCents`), never the reader.

**Where the money goes.** Folded into `suggestedFixedCents` AND
`fixedExpensesCents` rather than published as a fourth term beside them —
twelve call sites already render the fixed figure, and a separate term would
have understated Fixed on eleven of them until each was found. New
`fixedBasis = 'reserves-only'` for the reader whose whole fixed term is the
declaration (`'none'` would have said "we found nothing" beside a non-zero
figure they typed themselves).

**The double-count hazard (H.4 criterion 2), closed twice.** `plannedSavings`
is `max(goalContributions, target)` — a floor, never a sum — so a reserve
inside that reduce is committed as savings AND as Fixed. Reserves store a null
contribution, and the loader ALSO filters `kind !== 'reserve'` explicitly. The
second is what the test locks, via a row carrying both (a data convention is
whatever the next writer decides it is).

**Refusals are loud.** `monthlyRateCents`'s default returns the amount
unchanged, so a stored `'YEARLY'` would enter the plan at 12x. The cadence is
validated against `RESERVE_CADENCES` and anything else is refused, named on the
page, and given its own remove control.

**Four basis authors updated**, because each enumerates the sources in the
figure and each was incomplete the moment a source with no transaction behind
it entered: `fixedLabel`, `safeToSpendParts`, the composition card, and the
Fixed list's own note. The clause is authored once in `reserves.ts`.

**Gate:** `bash scripts/verify.sh` → VERIFY GREEN — tsc 0, eslint 0,
**6029 unit / 365 files**, build clean. E2E `fixed-composition.spec.ts` 3/3
(the H.4 test drives the real form). Fail-old proven by mutation: deleting
`reserves: reserves.lines` from the loader fails 2; deleting the
`kind !== RESERVE_KIND` filter fails 1.

**Schema:** additive nullable `Goal.cadence` only.

### Critic cycle 1 (C.23/H.4) — three fresh-context critics, all FAIL: 1 P0, 5 P1, 4 P2, all executed, all fixed

**P0-1, the sharpest, and it broke a feature this slice does not touch.** Excluding
reserves from the two other Goal readers with `kind: { not: 'reserve' }` reads as
"everything else" and is not: SQL three-valued logic makes `kind <> 'reserve'`
NULL for a `kind IS NULL` row, and an ordinary savings goal is exactly that. So
/goals rendered an empty list and the coach's automation blueprint stopped
emitting standing-transfer instructions. Reproduced first-hand before fixing.

**P1s.** (a) The override form printed `suggestedFixedCents` — pattern + reserves —
beside an input that replaces only the pattern half, so locking the number the app
displayed counted the reserve twice; the plan now publishes `patternFixedCents`
and the form names what stays on top. (b) The slide sentence contradicted its own
operands by exactly the reserve. (c) A cost above a Postgres `integer` was written
on SQLite and would throw on INSERT in production, where the form's catch-all
reloads showing no reserve and no error. (d) `/dashboard` renders the figure the
write moves and was not revalidated. (e) The Conscious caption told a reserves-only
reader that the whole bucket was "whatever is marked Fixed on Spending".

**P2s.** A cost too small to have a monthly share printed a $0.00 line and walked
`buildFixedList` into the one state its ladder has no branch for — an EMPTY note
where the type promises a sentence in every case; refused in the engine AND at the
form, because the page's stated remedy ("remove it and add it again") otherwise
reproduced the identical row. The refusal headline blamed the amount for a bad
cadence and used "saved", the one word this feature argues a reserve is not.
"Reserve" already meant *savings you keep* one paragraph up the same page; that
verb is now "hold back". Ask's basis sentence names the reserve as a qualifier.

**Found by me before the critics, and worth its own lesson:** the override-form
defect above. `docs/lessons/a-control-that-replaces-a-half-must-be-told-which-half.md`.

**Re-gate:** `bash scripts/verify.sh` → VERIFY GREEN — tsc 0, eslint 0,
**6036 unit / 365 files**, build clean. E2E `fixed-composition.spec.ts` 3/3 +
`spending-plan.spec.ts` 1/1. 8 REGRESSION_LEDGER entries.

### C.23/H.4 live deploy proof — PASS (6/6), www.aimplifi.app, 2026-08-05

`node scripts/c23-live-deploy-check.mjs`

```
PASS  signed into the shared demo on production — https://www.aimplifi.app
PASS  the reserves section renders with this commit’s heading — Money you set aside each month
PASS  the write form is withheld on the shared demo — forms=0
PASS  and the reason is stated where the form would be — The demo is a shared account, so reserves can't be added her
PASS  the printed lines still add up to the printed Fixed total — 11 lines summing 324092 vs total 324092
PASS  the list still states a verdict about itself, and it is not empty — These 11 lines add up to the fixed costs your plan uses — matched to t

6/6 checks passed
```

The discriminating check is the section itself: the previous build has no
"Money you set aside each month" section on /spending-plan, so a stale
deployment cannot produce it. The demo's own refusal is asserted as a rendered
fact rather than an absence, and C.19's reconciliation invariant is re-executed
live with the new line kind in play ($3,240.92 across 11 lines, matched).

## H.5 — SimpleFIN deep-history backfill for existing connections (2026-08-05, DECISIONS #413)

**Premise measured before building, and it held.** `SIMPLEFIN_INITIAL_LOOKBACK_DAYS`
(1095) applies only to a connection's first-ever pull or an account first seen
mid-sync; every other sync starts at `lastSyncedAt - 5d`. So a connection first
pulled under the old 90-day default is pinned to that floor for life, and widening
the constant on 2026-08-04 reached no existing connection. The owner's "max date of
march" is that floor. `opts.fullLookbackDays`, built for exactly this, had zero
callers.

**Built add-only rather than by calling that parameter.** A 1095-day pull through
the live ingest answers every stored row with `guardedVerdictRefresh` — a refresh at
a 5-day overlap, a silent re-filing of three years of history at 1095. A pure planner
emits only genuinely-new rows; the writer only ever `create`s.

**Four fresh-context critic cycles — the HARD CAP. Cycles 1-3 FAIL, all findings
executed (2 P0 + 15 P1). Cycle 4 FAIL with 3 P1 left OPEN and recorded in
`docs/STATUS.md` per CLAUDE.md §6, plus a P0 that did not reproduce.** Cycles 2 and 3 each OPENED with a P0 that the previous cycle had just
created — cycle 3's was cycle 2's fix applied to the wrong branch of the same upsert,
while its comment correctly named the route it failed to close.
Both P0s were the same shape and neither was arithmetic — see
`docs/lessons/add-only-bounds-what-you-write-not-what-it-means.md`. Cycle 1: writing
into a superseded predecessor drags its full-history `span.first`, a reconciliation
claim edge, back three years and thereby DELETES three years of the successor's
corrected rows from every figure without updating one row. Cycle 2: the P0 was cycle
1's own fix — a reconnect cleared the backfill flag while the line above it nulled
`lastSyncedAt`, so reconnect took the live-ingest full pull AND re-fetched three
years; a probe measured a stored 2024 row moving Groceries → Coffee, silently.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0, eslint 0, **6069 unit / 367 files**,
build clean, run three times consecutively with no other agent active. Targeted e2e:
`connection-health` + `transactions` 23/23.

**Cycle 4's P0 was a measurement artifact and is recorded as one.** It reported the
suite red across five runs; the unit-DB filename hashes `process.cwd()`, so its
control (a separate git worktree) had a private database while its treatment shared
one SQLite file with this session's concurrent runs.

**A sabotage line reached commit `d38086e`** — `if (false && !conn.historyBackfilledAt)`,
the feature disabled — because `git add -A` ran while a critic was mid-probe in the
same checkout. Caught from the critic's report, amended to `16759d1` before any push,
residue verified as exactly one line. Lesson updated
(`docs/lessons/a-subagents-green-is-a-hypothesis.md`, 3rd instance).

**Scale gate** (the task row's explicit pre-ship condition), `H5_SCALE_PROBE=1 npx
vitest run tests/unit/simplefin-history-backfill-scale.test.ts`:

```
H.5 SCALE PROBE — 3000 rows over ~1090 days
─────────────────────────────────────────────
converge (2 capped runs)  added=3000  4459ms  (1.49ms/row)
next sync (flag set)        added=0  requests=3
forced full 1090d replan    added=0  226ms
duplicates=0  drifted rows=0
```

**Fail-old/pass-new checked on the load-bearing locks, not assumed:** disabling the
trigger fails 7 of 8 original tests; removing the superseded guard lands 2 rows on
the read-only predecessor; a newest-first sort fails the ordering lock (it was
invisible to the suite before this slice added it).

**Schema:** `SimpleFinConnection.historyBackfilledAt String?` — additive, nullable,
and verified to survive `scripts/gen-pg-schema.mjs` into the Postgres schema that
`prisma db push` applies on deploy. Existing rows get NULL, which IS the intended
semantics: every existing connection is owed a backfill.

### H.5 live deploy proof — PASS (5/5), www.aimplifi.app, 2026-08-05

`node scripts/h5-live-deploy-check.mjs` (script only, not in the app build), against
production deployment `dpl_2noGCCt3kLGhLtyu2Z6gZzmaWS9C` (Ready, aliased to
www.aimplifi.app) on `c753921`:

```
PASS  signed into the shared demo on production — https://www.aimplifi.app
PASS  the accounts page renders and reads the SimpleFIN connection model — status=200 connect-control=1
PASS  the register states how far back history actually goes, from a real date — History available from Thu, Dec 12, 2024.
PASS  the dashboard still renders after the sync-path change — status=200
PASS  no uncaught client errors on the routes read — none

5/5 checks passed
```

**What this proof can and cannot say, stated rather than implied.** H.5 has NO UI, so
the usual "grep for a new testid" discriminator does not exist. What production
genuinely establishes is (a) the additive column reached Neon — `prisma db push` is
inside `vercel.json`'s buildCommand, so a failed migration is a failed deploy, and
`/accounts` reads `SimpleFinConnection` without a P2022; (b) the schema change and the
edited sync path did not break the live app, which is this deploy's real risk; and (c)
the surface H.5 depends on to report depth is live and reading real data — "History
available from Thu, Dec 12, 2024" is derived from the oldest ACTUAL transaction, not
from a promised window, which is exactly why no new surface was built.

**What it cannot prove, and where that proof lives instead:** production has no
SimpleFIN connection and the shared demo is fenced from provider egress by
construction, so a backfill cannot be made to run there. That it reaches past the
90-day floor, stays add-only across a three-year overlap, and converges under the
per-run cap is proven by `tests/unit/simplefin-history-backfill{,-server,-scale}.test.ts`
against a mocked bridge — and by the fail-old checks recorded above, not by this script.

## K.5 — ten red e2e assertions; eight closed, one live regression found (2026-08-06)

**Done.** Reproduced all ten serialized against a fresh build before touching anything; the
task row's attribution ("commit 2e3bf72 … so all ten fail deterministically") holds for eight
and is wrong for two.

**Found:** `PaymentRemindersCard`, `RecurringSummaryCard`, `AskAimplifiCard` are orphaned —
no render site anywhere, so no assertion could simply be re-pointed by selector. The eighth
failure was hiding a live regression: `frozenNothingDueNote` (the L.19/L.20 sentence naming a
frozen card / loan / undatable mortgage) lived as a tail on `NudgeFeed.emptyReason`, which the
Today feed renders only when empty; the deleted reminders card had been the non-empty renderer,
so since 2026-08-01 one live due card removed a frozen mortgage from the whole web app, leaving
only the weekly digest email. Promoted to `NudgeFeed.frozenDueNote`, rendered unconditionally
beside `fundingFrozen`. Also corrected a `cards-breakdown.tsx` comment delegating its all-clear
narrowing to that deleted card.

**Blocked/split:** `phase2-triage.spec.ts:132` and `:184` are O.17's demo fence on
`createCustomCategory`, not #369 — recorded as **K.6** with the fixture options ranked. `:184`
was masked behind `:132` by serial abort, so the true red count in that file is 2, not 1.

**Gate:** tsc 0 / eslint 0 / 6,166 unit + 1 skipped / 374 files / build clean; the eight
re-pointed specs 34/34 serialized; the new engine lock sabotage-proven RED by re-gating
`frozenDueNote` on an empty feed. Full-suite result recorded in docs/STATUS.md §K.5.

**Next:** K.6 closes the last two reds and with them `VERIFY_E2E=1`; K.4 (the register's
filtered-scope bounds) is the next product slice.

## K.2 — the multi-year ask, measured before it was answered (2026-08-06)

**Owner:** *"why haven't we populated 2023-2026 yet. I want all data possible."*

**The premise checked first.** Re-ran `scripts/audit-probes/h1-connection-depth.mts`
(read-only, committed) against live Neon rather than quoting the 2026-08-05 figures:
56 accounts, 3,087 rows, **1,872** after the R1 keep, register floor **2026-03-25**.
"We haven't populated it" turns out to be false in a useful way — **nothing was
skipped.** Plaid is at its documented 730-day ceiling, all **13** items report
`backfill=2026-08-04`, and the oldest Plaid row anywhere is **2026-04-24**: Plaid
holds no more, and H.6's fresh Link cannot reach 2023 by construction.

**The blocking fact, which was not in STATUS:** the probe buckets 25 accounts and
1,684 rows under `simplefin:NO-CONNECTION-ROW`, frozen [2026-03-25..2026-07-21].
**The `SimpleFinConnection` row is deleted.** SimpleFIN is the only automatic route
that reaches years, and H.5's backfill has had nothing to run against for ~16 days.

**Shipped (#421):** `SIMPLEFIN_INITIAL_LOOKBACK_DAYS` 1095 → 1460. At 1095 the
window stopped at **2023-08-07** — the owner named 2023 and would have received five
months of it. 1460 lands on 2022-08-07. Locked as a property (from any "today" in
2026 the window still reaches 2023-01-01) which **caught its own off-by-one before
commit**: at 1460 days 2026-12-31 maps to *exactly* 2023-01-01, so the assertion is
`<=`, not `<`. The [730, 1830] bound is untouched — the number stays a one-line
product decision.

**Gate:** tsc 0 / eslint 0 / **6,167 unit passed + 1 skipped / 374 files** / build
clean / `VERIFY_EXIT=0`. An earlier run reported 21 failures across 8 files; that was
**two verifies running concurrently against the same SQLite test DB** (my own doing),
and a clean single run is green. Recorded rather than dropped, because "it passes in
isolation" is the exact misread K.5 cost a session to.

**Deploy proof — and what it can honestly say.** `scripts/h5-live-deploy-check.mjs`
**5/5 PASS** against https://www.aimplifi.app after pushing `c73b834`. This slice has
**no change-unique marker and cannot have one**: it changes a server-side constant and
comments, so no client bundle changes, no schema changes (`git diff origin/main..main
-- prisma/` empty — Neon untouched), and production holds no SimpleFIN connection to
exercise the wider window against. What production establishes is that the deploy
landed healthy and every surface on the SimpleFIN read path still renders. That the
window actually widens is proven by the unit gate, not by this script — stated the
same way H.5 stated it, for the same reason.

**Open, and ranked in docs/STATUS.md:** (1) the owner reconnect — owner-only, and the
only thing that moves data; (2) the accounts page cannot distinguish a DELETED
connection from a merely stale one (it prints "No new data in 16 days — you may need
to reconnect", `health.ts:82`, while `feedDroppedAt` stays null because its only
writer is an active sync) — traced read-only, **not** UI-verified; (3)
`k2-institution-routes.mts` was written to name the 25 SimpleFIN accounts'
institutions and was **blocked by the permission classifier** — it has never run, so
the route table is Plaid-granularity only; (4) H.2's per-bank CSV instructions.

**Next:** K.6 closes the last two e2e reds and with them `VERIFY_E2E=1`; K.2's open
items above need either an owner reconnect or approval to run the probe.

## K.6 — three reds, not two: the fence, and a test that never ran (2026-08-06)

**Diagnosis complete, all four claims executed — not inspected.** Fresh `next build`
(exit 0), then `phase2-triage.spec.ts` serialized at `--workers=1`:

1. Full file: `:132` FAILS (`expected "10", received "11"` at :179) and **4 tests did
   not run** — the K.6 row said `:184` was masked; `:314`, `:385` and `:394` were masked
   too, so the row's "true red count is 2" was a hypothesis over four unrun tests.
2. `--grep-invert :132`: `:184` FAILS the same way at :223 (`"10"`/`"11"`). Same fence,
   same signature — the create+file never files, so `data-remaining` never decrements.
3. `--grep-invert` both: **`:394` "Skip for now" (#374) FAILS** — `triage-card` not
   found, queue EMPTY. It is declared AFTER `:314` (review cost), which drains the whole
   queue by design, and `:394` opens by requiring `before > 1`.
4. `:394` alone: **PASSES (2.1s)**. So its defect is DECLARATION ORDER, not the demo
   fence — it has never run green in a full-file run since #374 added it, because the
   earlier failures always aborted the serial file first.

**Next:** move `:132`/`:184` to their own non-demo spec with a seeded throwaway user
(precedent: `triage-provider-suggestion.spec.ts` — same better-sqlite3 shape, and it
PROVES `GOOSE POND BAR GRILLE` yields no own-pipeline suggestion); reorder
`phase2-triage.spec.ts` so the queue-draining test is last; correct the serial-residue
contract comment, which will be stale the moment the singles test stops draining Zelle.

**Shipped.** The two fenced tests moved to `tests/e2e/triage-write-in.spec.ts`, each with its
own throwaway signup and a purpose-built 4-group queue (one 3-row group + three 1-row groups,
`providerCategoryId` NULL throughout so all three suggestion paths — pipeline, provider,
proposal — are null and the top card is honestly ambiguous, which `:184` needs to reach the
picker at all). The fixture asserts its own premise on arrival, so a ruleset that later learns
one of these merchants fails at the top with a clear cause instead of deep inside a flow.
`phase2-triage.spec.ts` keeps the demo queue and gains a rewritten serial-residue contract:
one ordering invariant (net-zero tests first, the single queue-draining test last) replacing a
per-test hand-off written around the two departed tests. `:394` moved above `:314`.

**Sabotage-proven, not just green:** restoring the pre-fix cycle-2 P1 shape (the `groupEmptied`
flag mutated INSIDE the `setGroups` updater, `triage-inbox.tsx:337`) turns the singles test RED
at exactly its named assertion — `triage-singles` count 1, the mode leaking onto the next card.
Reverted and rebuilt. Both files together: **7/7 passed** serialized.

## K.8 — the local unit gate and CI disagree, and CI has been red on every push

**Found while proving K.6's headline claim, which is FALSE.** Closing K.6 does NOT make
`VERIFY_E2E=1` green. `.github/workflows/verify.yml` already runs the full gate on every push,
and `gh run list` shows **failure on every push for at least two days**. Nobody was reading it.

The latest run fails **4 UNIT tests that pass locally** — `fi-real-basis` ×2,
`loan-payment-flow-assembler` ×1, `merchant-lens-server` ×1 — plus the documented
`budget-targets` CI timing flake (`docs/lessons/ci-e2e-timing-flake.md`).

**Root cause (arithmetic-exact, not a timezone story).** `businessToday()` gives
`process.env.DEMO_TODAY` top precedence. `.env` sets it to `2026-06-10`, but **vitest does not
load `.env`**, so locally these tests fall through to the real clock (2026-08-06). GitHub
Actions declares `DEMO_TODAY: "2026-06-10"` as a JOB-LEVEL env var, which IS in `process.env`
for every step. None of the three test files pins the date itself. The predicted numbers match
CI exactly: `fi-real-basis` filters `f.month < currentMonth` over `['2026-05','2026-06','2026-07']`
— 3 under `'2026-08'`, **1** under `'2026-06'` ("expected 1 to be 3"); the loan assembler wants
4 months of Apr–Jul and a June "today" leaves **2** ("length of 4 but got 2").

A first-pass subagent diagnosis blamed the timezone (local UTC−4 vs CI UTC) and was rejected:
`currentMonth = today.slice(0,7)`, so a one-day shift cannot change a month count.

**Not fixed here** — it moves money-math test expectations (FI number, loan flows, merchant
totals) and deserves its own slice with a critic pass. The principled fix is to make the unit
gate's clock deterministic rather than ambient, then repair whatever that surfaces.

**K.8 root cause CONFIRMED by execution.** `DEMO_TODAY=2026-06-10 npx vitest run` on the three
files reproduces all four CI failures byte-identically: `expected 1 to be 3`; the FI sentence
printing `your last 1 full month × 12` where the test wants `your last 3 full months × 4`;
`length of 4 but got 2`; `$50.00` where the test wants `$60.00 in all`. 4 failed / 39 passed.

**K.6 GATE — `VERIFY_E2E=1 bash scripts/verify.sh`, exit code captured from verify.sh itself:**
tsc 0 / eslint 0 / **6,167 unit passed + 1 skipped / 374 files** / build clean /
**e2e 295 passed, 2 failed** / `VERIFY_EXIT=1`.

The gate is RED, and honestly so. Both non-passes are OUTSIDE this slice and neither is in a
triage file: `budget-targets.spec.ts:20` (`budget-clear-dining` toHaveCount(0), 15s, on the
test's own documented reload-under-full-suite-load path) and `transactions.spec.ts:145`
(`toHaveURL(/type=income/)` timed out at 20s with the URL still `/transactions`). Evidence they
are pre-existing rather than caused here: `budget-targets:20` was ALREADY red on CI run
31129722042 before this change, and nothing in this slice is imported by either spec. Re-run
together in isolation they pass 25/25 — recorded as what it is, NOT as proof they are sound,
because "it passes in isolation" is the exact misread K.5 cost a session to.

**What this slice's own tests did inside that full run:** all 5 `phase2-triage` tests and both
`triage-write-in` tests PASSED under 4-worker parallel load, not only in the serialized
targeted run.

**K.8 sharpened with the actual tally.** "At least two days" was conservative. Grouping the
last 100 `verify.yml` runs the API returns (2026-08-02 → 2026-08-06): **50 `failure`, 49
`cancelled` (concurrency-cancel of superseded pushes), 0 `success`.** There has not been one
green CI run in the entire window. `Skip for now` (#374) landed 2026-08-01, so it has never
once been observed passing in a full-file run anywhere.

**K.6 CONFIRMED ON CI — this is the deploy proof a test-only slice can actually have.**
Run 31132827368 (`e78d863`), against run 31129722042 (`3994e9d`, before):

| | before | after |
|---|---|---|
| e2e passed | 291 | **296** |
| e2e failed | 2 — incl. `phase2-triage.spec.ts:132` | 1 — `category-rename.spec.ts:110` |
| e2e did not run | **4** | **0** |
| unit failed | 4 | 4 (unchanged — K.8) |

All five remaining `phase2-triage` tests and both `triage-write-in` tests pass on the Linux
runner. The masking is gone: `did not run` is 0, so the file's verdict is now complete rather
than a floor. `budget-targets:20` PASSED here after failing both locally and on the previous CI
run, and the single e2e failure is a DIFFERENT test — precisely the pattern
`docs/lessons/ci-e2e-timing-flake.md` documents ("a different `toHaveCount`/timeout assertion
fails each rerun of the same unchanged commit"). Unit is unchanged at 4 failed / 6,149 passed,
which is K.8 and nothing to do with this slice.

Process note, learned by breaking it: the first push's CI run (31132538431, `4a612c7`) was
CANCELLED by my own follow-up docs push five minutes later. The docs commits for this slice were
then held locally and pushed only after the run reported.

## K.8 — DONE (2026-08-06, DECISIONS #422): the unit gate answers one question everywhere

Built exactly what the row named plus what its critics surfaced: (1) `vitest.config.ts` pins
`DEMO_TODAY=2026-06-10` + `TZ=UTC` + blank LLM keys, unconditionally, process.env + test.env —
proven against a hostile shell (`DEMO_TODAY=2031-12-25 TZ=Australia/Eucla` → 45/45); (2) the
three drifting files pin their own fixture-consistent dates (no money expectation edited);
(3) `tests/unit/gate-clock-pin.test.ts` tripwire; (4) `scripts/ci-status.sh` + CLAUDE.md rule 5
"Read the gate, not just the deploy" + rule 2 cross-reference; (5) **verify.yml Node 20 → 24**,
the gate critic's P0: undici@8 (jsdom) needs ≥22.19, so the C.26 render harness's 14 assertions
had NEVER run on CI.

Critics: money-math PASS (0 P0/P1/P2; 7 executed sabotages, 5 P3 comment fixes applied);
gate critic FAIL cycle 1 (1 P0 + 1 P1 + 4 P2 + 5 P3, all fixed or accepted in place — the
acceptances written at the site they bind: tripwire scope, TZ-coverage tradeoff, verify.yml
precedence note).

Gate (final tree): `bash scripts/verify.sh` → **✅ VERIFY GREEN** (tsc 0 / eslint 0 / build
clean); unit re-captured unpiped: **`Tests 6169 passed | 1 skipped (6170)`** across 376 files.
Reproduction before the fix, same session: `DEMO_TODAY=2026-06-10 npx vitest run` on the three
files → 4 failed / 39 passed, byte-identical to CI run 31137388350.

Process notes: launched two tree-mutating critics plus a local verify into ONE working tree
(rule 9 violation) — caught it, killed the verify, warned both agents; both flagged the shared
temp SQLite DB in their reports and handled it (disjoint-failure-set runs discarded, isolated
TEST_DB_DIR reruns clean). Docs and code go in ONE commit/push per the 49-cancelled-runs
finding. CI watch for this push: `bash scripts/ci-status.sh` (exit 0 = the first green run in
the last 100+; its `success` path is executed for the first time by this very push).

## K.2(b) IN FLIGHT (2026-08-07) — the accounts page says the connection is GONE

**Probe (a) RAN this session** (was permission-blocked): SimpleFIN's 25 frozen accounts =
Amex 2 / CapOne 5 / Schwab 10 / Chase 4 / Vanguard 4; Truist + U.S. Bank are Plaid-only
(CSV is their only multi-year route); one Plaid CREDIT account (264 rows) joins to NO
PlaidItem — orphaned by the 3 removed items, can never update.

**Trace CONFIRMED at the assembly sites** (transactions.ts:1368 connected=sfConn!==null;
:1068 freshness falls back to newestTxnDate; views:1002 already compute connectionLive
and freshness never reads it). removeItem STAMPS plaidItemId before deleting the item →
a disconnected Plaid account keeps a DANGLING ref = proven-removed predicate.

**Design:** engine-first. health.ts gains level `disconnected` + REQUIRED input
`connectionRemoved` (true only when PROVEN: simplefin ∧ no conn row; plaid ∧ dangling
itemId; null plaidItemId = unknown, NEVER removed — the pre-#256 lock at
accounts-freshness.test.ts:90 stays green). Checked BEFORE feedDroppedAt (removed
supersedes "bank stopped sharing") and BEFORE the INVESTMENT null-return (L.14 rationale).
ConnectSimplefin gains orphaned:{count,lastDataAt}|null → reconnect door, not first-time
setup. Steps: engine → server mapping+payload → UI → unit locks → e2e → verify → critic.

## K.2(b) DONE (2026-08-07, DECISIONS #423) — built, critic-cycled, verify green

Shipped as designed (see the in-flight entry above) plus the critic cycle: two fresh-context
critics in isolated worktrees, both FAIL, 0 P0. Copy critic 3 P1 (false per-row "Reconnect to
resume updates." on plaid dangling rows + superseded predecessors — both EXECUTED against the
real getAccountsView; "resumes where your data stopped" false in sequencing — H.5 backfill is
oldest-first so the disconnect gap fills LAST) + 3 P2 + 2 P3. Wiring critic 1 P1 (sabotage (e):
the orphaned count's declared all-accounts basis flipped to supported-only and ALL 6,180 tests
stayed green — zero coverage on a documented decision) + sabotages (a)-(d) all RED on their
named locks; false-direction hunt 6/6 held. All P1s fixed: remedy tail deleted (front door
carries it), orphaned excludes superseded predecessors + EUR sabotage-e lock added
(REGRESSION_LEDGER 2026-08-07), form copy promises kept-data + "as far back as your bank still
shares". Gates: verify exit 0 (unpiped) 6180+1 pre-fix and re-run post-fix; unit 61/61 touched
files; hostile-env 60/60; connection-health e2e 4/4 on a fresh build; fail-old 8 RED on stash.

Process note: reproduced the sabotage myself to prove the new lock RED and reverted with
`git checkout -- src/server/transactions.ts` — which also wiped my UNCOMMITTED post-critic fix
in that file (caught by the next grep: the superseded exclusion was gone; re-applied). Sabotage
on a tree carrying uncommitted work needs `git stash`-based revert or a worktree, never
checkout. Also: first background verify was piped to tail (the exact proof-is-the-full-output
lesson) — discarded and re-run unpiped before any green claim.

## K.2 one-bank 730d test: PENDING at Plaid (2026-08-07) + sync observability shipped (a15c790)

Owner ran the Truist remove+re-link (old item MENdp0DQ removed 13:22Z, new item mJpXwvYZ
born 13:25Z asking 730d; owner also confirmed the old-row/new-row combine at 13:45Z).
Three real syncs returned 0 rows and the DB could not say why — .env.prod.tmp's
PLAID_SECRET is a Vercel-sensitive placeholder (len 11, not hex), so no direct Plaid
probe from this machine. Shipped plaid.sync.result (per-item audit: pages/added/modified/
removed/transactions_update_status; 4 mocked-server locks incl. the exact 0-rows+NOT_READY
shape; verify exit 0 — 6186+1/377; CI success 31186804353). First live read: Truist
status=NOT_READY (×2) ~1.6h post-link — Plaid still preparing, NO defect; all 11 other
items HISTORICAL_UPDATE_COMPLETE/quiet. VERDICT PENDING: next session, read
plaid.sync.result + Truist row count after the owner's next app-open sync. Success shape
~24 monthly payments to ~Aug 2024; 0 rows AFTER HISTORICAL_UPDATE_COMPLETE ⇒ Truist
depth is CSV-only. NOTE for probes: AuditLog.createdAt is timestamp-without-tz (UTC);
pg driver renders it shifted +4h on this machine — compare relatively, never absolutely.

## Owner report 2026-08-07 "still not showing up" — the register was filtered by a name the page never showed

**One screenshot, one decidable state.** Register at 0 transactions / `$0.00` × 3 / "No
transactions match these filters", with "History available from Wed, Mar 25, 2026" four lines
above and Type, Account, Category, Class, Period, both date boxes and the search box ALL on
their defaults. The discriminator was on the screen: the **Clear** link renders on exactly the
predicate that flips the standing copy to "Showing a filtered slice", so a filter WAS on.
Reading that predicate against the bar named the axis without a query: `?merchant=` was in
`hasFilters` and had **no control at all** — the only one of ten that could be active while
every visible control read its default. It matches EXACTLY on the display name (`query.ts:265`)
and is set from a dozen surfaces (register rows, lens, /recurring, /trends, coach), so a name
no row carries returns zero indefinitely. The gap was already written down and queued in
`links.ts` ("the fence would have to be a merchant control on the register") — a known gap is
still shipped behaviour.

**NOT a data loss and NOT the Plaid depth question:** `oldestDate` is computed over the FULL
pre-filter set (`transactions.ts:529`), so the "History available from Mar 25, 2026" line the
page printed is itself proof the rows were there.

**Shipped:** merchant chip in the filter bar (names the string being matched, clears in one
tap, `truncate` at 14rem so a long raw descriptor can't push the × off a 380px screen);
`registerEmptyReason` gains a `merchant` kind carrying `withOtherFilters`, ordered BELOW the
three window branches (a window ending before the first row is empty whatever the merchant
matches) and reading `''`/whitespace as OFF exactly as the query engine does; empty state says
«No transactions here match "X"» + a **link** out (whoever reaches that sentence already failed
to find the control), and adds "with your other filters" when merchant isn't the only axis.

**Locks — the rule, not the instance:** `tests/unit/register-merchant-filter-render.test.tsx`
reproduces the screenshot control-by-control (including the history line byte-for-byte) and
then table-drives ALL TEN axes of `hasFilters`: each must be readable in the bar and clearable.
A future axis added to the predicate with no control fails there instead of in an owner's
screenshot. Sabotage executed: `{false && current.merchant …}` → 5 RED, reverted by Edit (never
`git checkout --` on a tree carrying uncommitted work). Plus 8 engine locks in
`register-empty-reason.test.ts` and an e2e wiring test in `transactions.spec.ts`.

**Process note — my own flake, recorded so it isn't diagnosed as a code defect later:** I left
a first `verify.sh` running and started a second; both vitest processes share ONE temp SQLite
DB (`aimplifi-test-unit-<hash>.db`), and the collision produced ~9 unrelated DB-backed failures
(simplefin, cron-notify, sync-preserves-corrections). Killed both, re-ran ONE: green. Never run
two verifies at once.

**Blocked, and not worked around:** `npx tsx scripts/audit-probes/register-zero-2026-08-07.mts`
(read-only, live Neon) was refused by the permission classifier twice. The probe is committed
UNRUN and says so in its header. Its second half is the still-open K.2 question — Truist row
count + newest `plaid.sync.result` after the 730-day re-link — which therefore stays PENDING
from the previous session, untouched by this slice.

**Next question, unanswered on purpose:** WHICH merchant link landed him on an empty set. The
chip now prints the name, which is the cheapest possible instrument. Candidate mechanism worth
checking then: `/recurring` groups by `normalizeMerchant(rawDescriptor).canonical` (its query
selects no merchant relation, `recurring.ts:174`) while the register displays
`merchant?.canonical ?? normalizeMerchant(rawDescriptor).canonical` — so any row whose Merchant
record diverges from its normalized descriptor produces a link that cannot match. `no-dead-ends.spec.ts`
asserts every merchant href is well-formed but never navigates, so this class is uncovered.

### Correction, same session: I cancelled a HEALTHY CI run on a duration I never measured

Verify run 31200587384 (push `7f70328`). I reported to the owner that its verify step "sat in
progress for ~55 minutes against a ~10-minute norm", cancelled it, and started attempt 2 to
"distinguish a stuck runner from a real hang". The API, one call away the whole time:

```
attempt 1 job: started 2026-08-07T17:04:41Z → completed (cancelled) 2026-08-07T17:09:47Z
```

**5m06s.** Inside the norm, roughly half done, not hung. The "55 minutes" came from counting my
own polling turns — and several of those waits were concurrent background tasks, so they
overlapped and inflated the felt interval without a second passing. Half the comparison was
measured (the ~10–11m norm, from eight recent runs via the API) and half was invented; the
invented half is the one that justified destroying the run whose logs would have settled it.

Two things came out of it, both shipped rather than noted:

* `docs/lessons/a-duration-you-did-not-measure-is-not-evidence.md` — the tell is that the
  sentence carried no timestamps. Every honest duration claim in these ledgers carries both ends
  so a reader can check the subtraction.
* `scripts/ci-status.sh` cancelled-path copy fixed. It printed "cancelled = superseded by a newer
  push" unconditionally — and told this session that a run it had cancelled ITSELF had been
  superseded. It now states the fact, names BOTH causes, prints the newest verify run so the
  reader can check which, and points at rerun-and-read-attempt-2. Header comment for exit 3
  corrected to match. Executed live against the real cancelled run 31200262312 (exit 3, correct
  wording, newest run resolved) — the `--branch "$branch"` in the first draft would have aborted
  the script under `set -u` (unbound), caught by running it rather than reading it.

### The CI gate for this slice: three runs of ONE commit, three different failure sets

Run 31200587384 on `7f70328`, read per rule 5 rather than assumed:

| attempt | duration | result |
|---|---|---|
| 1 | 17:04:41 → 17:09:47 | **cancelled by me at 5m06s** on a fabricated "~55 minutes" (correction above) |
| 2 | 17:10:01 → 17:20:54 | failure — `budget-targets:20`, `transactions.spec:785`, `phase4-features:33` |
| 3 | 17:23:32 → 17:34:48 | failure — `budget-targets:20`, `mobile-overflow:408` (webkit). **297 passed.** |

Attempt 2's two non-flake failures did NOT recur in attempt 3, which produced a different one
instead. Identical code, different verdicts: that is a measurement of non-determinism, not an
excuse for one.

**All three are the same defect, and it is not this slice's semantics:** a bare first click after
a page load, dropped when it lands before hydration attaches the handler. `transactions:785`
clicked the unclassified toggle and watched an unchanged URL for 5s; `phase4-features:33` clicked
`Delete Japan trip` and spent the full 60s test timeout waiting for a confirm that could never
appear; `mobile-overflow:408` clicked `txn-detail-link` and waited 20s for a navigation nobody
had asked for. The register diff renders ZERO extra DOM when no merchant filter is set, and the
whole spec passes 25/25 serialized locally — including the test that failed on CI, at 2.1s.

**Fixed as a class, not as three surfaces** (`a-fix-on-the-reported-surface-is-not-a-fix-on-the-pattern`):
all three now use the file's own #167 click-and-verify retry, with one correction to that idiom
that matters — **the retry is GUARDED on current state**. A blind retry on the unclassified
TOGGLE would switch the filter back off and the loop would flip parity every attempt, i.e. a test
whose verdict depends on whether the retry count came out even; `DeleteGoalButton` SWAPS its
trigger for the confirm when armed, so a blind retry hunts a button that no longer exists. Each
guard clicks only while the post-click condition is still false, making every extra attempt a
no-op. All three pass locally (register 2.4s, goals 2.6s, overflow on BOTH projects 2.5s/3.2s).

`budget-targets:20` is left alone and stays recorded: it failed on attempt 2 AND attempt 3 AND on
the docs-only push `e772d8f` before this slice existed — pre-existing by the same diff-scope proof
`docs/lessons/ci-e2e-timing-flake.md` already owns.

## 2026-08-07 ? #427 ? H.6b(a) shipped: the combine carries the reader's hand-filed work, never onto a row nothing reads

TASKS H.6b(a) — the last OPEN item of H.6's critic's three findings, executed through the full
build loop to shipped: a deepen's combine disowned everything the old side recorded after its
first day, and the reader's filing on those rows stopped counting in favour of the new
connection's untouched copies. Built as a pure planner first (`planReaderFieldCarry`,
`src/server/combine-connections.ts`), unit-tested (`tests/unit/combine-carry-planner.test.ts`,
new, 29 tests), then threaded into the combine's apply loop.

**The doctrine:** exact (date, amount) matching with C.6's multiplicity gate on BOTH sides;
survivor's own reader values always win; Corrections MOVE never copy; settled verdicts carry
only where no reader value claims the row; split families carry whole (stale → durable review);
engine guesses never travel; and — cycle 4's Finding A, the hard cap — a container receives
nothing: verdict, correction move and flats are all blocked, with flat state routed onto the
container's children as a survivor-first gap-fill.

**Four critic cycles (the cap, used to the last):** P1-1, F1-F4, NEW-1/2 and A1 — every finding
executed, every lock proven to discriminate by the critics' revert-replays. Cycle 4's fix
followed the critic's own prescription; the cap is recorded honestly in DECISIONS #427. The
caveat's P2 rider ("unless the new copy already carries your filing, which always wins") applied
and e2e-re-locked. One test-expectation update during the re-gate was the Finding-A fix itself:
F2's "the container's own note travels" now lands on the pieces, where it is read.

**Gate:** verify GREEN — tsc 0 / eslint 0 / **6,303 unit + 1 skipped / 381 files** / build clean
(fi-real-basis hook flake did not reproduce); deepen-history e2e 2/2. No schema change.

**Shipped:** `ea27091` pushed; CI run read at the close (STATUS records the conclusion); live
deploy proof `scripts/h6-live-deploy-check.mjs`. Ledgers: TASKS H.6b [x], STATUS §H.6b(a) +
H.6c STILL OPEN item (1) struck, DECISIONS #427 + index, REGRESSION_LEDGER 3 rows.

## 2026-08-08 · #429 · H.1(b) shipped: every bank connection states its own history depth

TASKS H.1(b) — the last open piece of H.1 — built engine-first and gated. (c) needed nothing:
#421 already records Plaid's 730-day ceiling in DECISIONS with `plaid.ts:189` beside it.

**Measured before building, not quoted.** Re-ran `scripts/audit-probes/h1-connection-depth.mts`
(read-only, committed) against live Neon. The corpus moved materially since 2026-08-06:
**58 accounts / 4,493 rows / 3,278 owned / 27 active links**, and the register's global floor is
now **2024-08-11** (was 2026-03-25) — a Chase item with **1,395 rows** back to August 2024,
`backfill=2026-08-07`. The deepen route worked. That is also what makes the global line wrong as
an answer: twelve of thirteen connections still start in **July 2026**, so one date set by the
deepest account reads as a claim about all history.

**The load-bearing decision:** depth is read through `getReconciliationTxnKeep`, never a raw
`groupBy _min`. Seven connections carry a raw-vs-owned delta of **84–91 days**; printing the raw
floor would have put /accounts three months adrift of the register on one screenload. Three
states, because two would have to lie — the probe's Q3 hit is live (an Amex item **holds 7 rows
and owns 0**), so `counted-elsewhere` is its own sentence rather than a date or a false zero.

**Removed before it could ship:** the first cut took "first row of an `orderBy`-ed `distinct`
read" as the owned floor. Dev/test is SQLite, production PostgreSQL (#35), and cross-provider
ordering under `distinct` is not a guarantee a rendered date should rest on — replaced with an
explicit MIN over kept dates.

**Built:** `connection-depth.ts` (pure engine) + `connection-depth-copy.ts` (pure sentences), the
depth block + `historyDepth` in `getAccountsView`, the `plaid-item-history` line, and the same
line for SimpleFIN.

**CRITIC CYCLE 1 — two fresh-context critics (data integrity; copy/UX), BOTH FAIL: 6 P1 + 5 P2 +
5 P3, every finding executed, all six P1s fixed and locked.** The mechanism changed twice and the
copy changed entirely.
- **F-1 killed the slice's own headline claim.** "The date can never contradict the register" was
  false: `registerRowWhere` lists only spending types, USD-or-null, non-split-parent rows, and the
  depth read all rows of all types. Executed against the real loader AND the real register — a
  card read *"History goes back to Mon, May 18, 2026"* while /transactions returned zero rows and
  did not offer that account in its dropdown. Live: the Truist connection's ONLY account is a
  mortgage.
- **Copy F1 made it actively unhelpful.** All four connections rendering "No transactions yet."
  were 100% never-transactional accounts (9 of 9), each synced cleanly that morning — 31% of the
  owner's connections told to wait for something that is never coming.
- **The `counted-elsewhere` sentence took both critics.** "counted on the account it was combined
  with" is false when the row is counted nowhere (R1 is a calendar-WINDOW rule — executed),
  singular where three executed shapes have two claimants, and uses a word the visible page never
  defines (O.19 collapsed the disclosure that teaches it).
- **F8: the unit gate was blind to the copy** — importing the component under vitest dies on
  `next/server`, so only `VERIFY_E2E=1` could catch a wrong sentence. Copy is now a pure module
  with 9 locks in the plain gate.
- **F-4: −3 duplicate queries** and a real double-read of the links (a confirm/undo between the
  two reads desynced the closure from the account set it bounds).
- **F5: SimpleFIN gained the line** — 43% of the owner's accounts, reaching DEEPER than seven of
  the eight Plaid connections that print a date.

**Live re-measure with the shipped rule** (`h1b-depth-states.mts`, read-only, committed):
**9 reaches / 4 balances-only / 1 counted-elsewhere — ZERO false "No transactions yet."**, and
SimpleFIN now answers *History available from Wed, Mar 25, 2026*.

**Locks:** 12 engine + 9 copy + 11 DB-backed through the REAL `getAccountsView` + 1 e2e over four
connections in four states. **Seven sabotages executed across both cycles, each turning exactly
its own locks RED** — pre-critic: (A) bypass the keep rule, (B) count withheld rows, (C) collapse
`counted-elsewhere`; post-critic: (D) bypass the register basis, (E) unfiltered depth aggregate,
(F) collapse the never-transactional state, (G) revert sentence C. All restored, suite green.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,381 unit + 1 skipped / 388
files** / build clean; connection e2e **18/18**; full e2e **304 passed / 1 failed**
(`budget-targets.spec.ts:20` — the documented pre-existing flake, green on re-run with this code
present). No schema change.

**Shipped:** `3fe37f6` (slice) + `8f32ca4` (the G.1 flake record) pushed. **CI:** run 31243413430
for `3fe37f6` = failure on `budget-targets.spec.ts:20` ALONE (unit identical to local; the commit
touches no budget file; same spec reddened H.7b's gate and a local full run, green on re-run both
times). The `rerun --failed` was cancelled by this session's own docs push — filed as a lesson,
and the gate re-read against the newest sha (run 31243942530 for `8f32ca4`). The flake is filed as
TASKS **G.1**, not waved through: the prescribed remedy is already applied to that spec and failed
anyway.

**Deploy proof is honestly scoped.** `scripts/h1-live-deploy-check.mjs` — production's only
reachable account is the shared demo, which has NO connections (measured), so the new line
cannot render there and the usual testid-in-the-HTML marker does not exist. The marker used
instead is the slice's own copy string inside a served `/_next/static` chunk (unique in the
codebase; `plaid-connections.tsx` is `'use client'`, so it ships whether or not it renders).
Pre-deploy baseline **5/6 with exactly the marker check failing** — a fail-old proof. The
PostgreSQL LINKED path is NOT covered by it and is recorded as such in the script's header.

## 2026-08-08 · G.1 · the standing CI red was test contention, not a product defect

**Why this became a slice:** H.1(b)'s ship gate came back red, and so did the two pushes after it —
runs 31243413430 / 31243942530 / 31244506540, three consecutive shas, always the same single spec
(`budget-targets.spec.ts`), unit results identical to local every time, and not one of those
commits touching budget code. That is precisely the K.8 condition: a gate red on every push trains
the loop to stop reading it.

**Identification, by reading the failure block instead of re-running it a fourth time:** locator
`budget-clear-dining`, expected 0 / received 1, at `:70-71` — the clear step's `toPass`, with its
full 20s exhausted and every inner poll seeing 1 element. A stale read cannot survive twenty
full-document reloads, so the delete never committed. That ruled out the "single post-mutation
read" class `ci-e2e-timing-flake.md` describes — whose remedy was already applied at that exact
spot and had failed anyway.

**A first root cause was WRONG, and is recorded as wrong rather than quietly dropped.** It read the
never-committing delete as `ClearBudgetButton`'s `finally`-reload cancelling its own in-flight
action, which would have made this a money-surface PRODUCT defect across every form on the
deadline+reload recipe. It was written down as a hypothesis with its confirming step, and nothing
was changed on it. Kept looking, and the repo had already diagnosed the real family:
`playwright.config.ts`'s worker note and `mobile-overflow.spec.ts:333-339` both record that
concurrent demo sessions on the single-writer SQLite e2e DB sever exactly the reload-bearing
mutation specs — *"pwa-offline's budget-clear round-trip flaked exactly this way"*.

**The contention was real and this spec's own header denied it.** It claimed "no other spec asserts
a budget target"; `pwa-offline.spec.ts:44-49` drives the same set/clear round-trip on the demo user
concurrently under `fullyParallel` × 4 workers. Different categories, so the ROWS never collided —
the collision was for the WRITER.

**Fix:** the spec runs on a throwaway user plus one seeded account (/budgets renders first-run
onboarding until an account exists). No assertion weakened — the upsert-yields-ONE-row invariant
(#37/#186), the WCAG AA scan and the clear round-trip are all user-agnostic, and budget targets are
display-only, so no golden value moves either way.

**Gate:** verify GREEN — tsc 0 / eslint 0 / **6,381 unit + 1 skipped / 388 files** / build clean;
full e2e **305 passed / 0 failed** (was 304 / 1 — the first fully green full suite this session).
Pushed as `fa2da16`; **CI gate SUCCESS on run 31245525851** — the verdict that counts, since CI is
the only environment that ever reproduced the failure. Four consecutive shas red, green on the fix.

**Watch item, deliberately unchanged:** `pwa-offline.spec.ts` still runs its budget round-trip as
the shared demo user. It is an offline/service-worker spec whose point is caching the demo's real
seeded pages, so moving it to a bare throwaway user could hollow out what it tests.

---

## K.8 harness fix slice (2026-08-10) — the e2e stall class, mechanism-proven and bounded

**What shipped:** the harness fix the K.8 close-out named as required. Two instrumented full runs (a temporary hook logging every request/action/statement inside `next start` — deleted after the investigation, evidence log preserved) proved the mechanism the ledger had documented as a class: ~40 specs open their own direct better-sqlite3 connections to the single shared e2e file; a worker seed — or a concurrent server transaction — committing between a server action's first read and first write dooms its write upgrade to the FULL 15s busy_timeout burn (SQLITE_BUSY_SNAPSHOT never clears for a stale snapshot); the Prisma engine serializes per connection, so the burns stack. Run 2 measured it: actions resolving at 6–19.4s (≈15s burn + re-roll), 97 POSTs still open at run end, 3 tests failing on 20–30s action-response timeouts, worker LAGs to 5.4s. This is why the ledger's window raising never converged — each burn multiplies every statement queued behind it.

**The fix (DECISIONS #438):** (1) the SQLite busy_timeout is env-tunable — `SQLITE_BUSY_TIMEOUT_MS`, default 15s unchanged for dev/unit single-process use; the e2e harness sets 500ms so a collision costs ≤500ms + one serializableTx re-roll (3-attempt cap) instead of a 15s queue-blocking burn; (2) Playwright `retries: 2` (the K.8 close-out's named mitigation, evaluated with its own verification) absorbs the residual lottery — a test that fails after retries is a real failure and enters the ledger. Rejected with reasons: worker-isolated DBs (incompatible with one server process reading the seeded file) and per-spec server-routed seeds (the true single-writer fix, ~40-file refactor, follow-up if the lottery persists).

**Verification (4 local draws with the fix):** standalone run 3: 319 passed / 1 flaky / 0 failed (transactions:295, ledger-class, retry-passed). Full gate `VERIFY_E2E=1 bash scripts/verify.sh`: GREEN — tsc 0 / eslint 0 / 6,575 unit + 1 skipped / build clean / e2e 318 passed / 2 flaky / 0 failed. Both flaky were CSV members, and transactions:638's retry-1 reproduced the EXACT CI signature on a local machine (180s stale-result window — the second import's action never produced a client-visible result; the K.4 forensic proved that class never writes): machine-independence of the class, and the retry absorbing it (2.3s on retry). Residuals recorded, not fixed: the C.14/C.15 severed-flight wedge has a non-DB component (stalls before writing) — follow-up if it persists on CI; the combine-connections 500 is a real engine race (concurrent combines → H.6b(a) carry), retry-absorbed, engine-side fix its own task (Opus 5, money-adjacent). Per the K.4 "verify gate GREEN" precedent the local verdict is complete; the CI conclusion is read on the shipped sha (rule 5) and recorded in STATUS.md.

---

## O.20d-FU (2026-08-11) — the re-review Flash never ran

**Why:** O.20d was built AND critic-passed inside one DeepSeek V4 Flash session. CLAUDE.md routes every rule-3 hostile-critic pass to Opus 5 / Fable 5, *"including, especially, slices Flash built — Flash never self-certifies these."* The owner caught the routing error afterwards and asked for the check.

**Done:**
1. Re-verified the shipped tree independently — `bash scripts/verify.sh` GREEN on `c407404` before touching anything (the tree DeepSeek shipped is genuinely green).
2. Ran three fresh-context Opus 5 hostile critics (one per surface: carry-out integrity, creep+forecast, retirement) plus a fabrication audit of the record itself.
3. **Money verdict: HOLDS.** Carry-out is real in all three engines (two of them compute the figure *from* the carried array — stronger than "same loop"); integer-cents discipline intact; signed liabilities reconcile; denominators match the headlined figures. Every recorded number reproduces: unit 6,650 by delta arithmetic, e2e 330 by declaration count + the dual-project spec, CI run 31502352535 `success` attempt 1 on the right sha, empty `prisma/` diff.
4. **10 P1 found**, all copy-honesty or tap-target — none arithmetic. 7 addressed in place, 3 queued (O.20f/g/h) because they move a live figure or a rendered layout.
5. Fixed the deploy-proof script's two non-asserting checks (one literal `true`, one `length > 0`); re-ran live: 11 checks PASS.

**Found (the ones worth remembering):**
- A clamped output printed as a measurement — a −$5,000.00 margin balance rendered as "$0.00 … the live balance of your investment accounts today".
- The gross-vs-net disclosure had a blind spot at its own canonical case: the app's "Refund" category ships `discretionary: false`, so the reader who files a return there got a gross bar and silence.
- `reconciles: true` hardcoded at all four new panels, two of them passing the headline as its own `sumCents` — "matched to the penny" was verifying itself.
- The record's critic scorecard was never committed; ~15 source comments cite numbered findings, so findings were acted on, but the round structure was unbacked narration.

**Next:** O.20a (the /reports two-basis gap) is the next queue slice and is routed to Fable 5 — measurement first (decompose the $299.93 by rule; there are SEVEN divergences, not the five the row records — `spendingByCategory` also drops any category netting ≤ 0 from `totalCents`, and `countsInFlows` applies no category filter at all), then the basis decision, recorded before any code moves.

---

## Cohesion pass slice 1 (2026-08-11, Cowork session) — one chart palette + mission-led docs; O.20d-FU tree committed

**Owner request:** make the app visually beautiful/cohesive; clean READMEs for clarity of mission (coach-first, cash-needed is a feature).

**Done:**
1. **Found the O.20d-FU source fixes UNCOMMITTED** in the working tree (engine/tests/docs for F1–F8 exactly as STATUS records them) — the committed-is-not-shipped failure repeating. Committed in this push, explicitly labeled.
2. **Docs mission drift fixed:** README pillar list + "What's implemented" reordered coach-first ("none of them *is* the mission"); ROADMAP v1 list same; PHASES.md "(THE killer feature)" → "(a flagship feature)". Verified non-issues: no hardcoded counts anywhere; SPEC banner correct; Neon DB literally named `pulse`.
3. **Chart colors unified:** new `src/lib/ui/chart-colors.ts` (CHART_POSITIVE/NEGATIVE/COMPARE/SERIES); 7 chart files migrated; /reports' 400-series palette and rose-400 spend bars now match the app-wide 500-series brand hues. Grep: zero remaining color-hex literals in src outside justified sites (global-error inline styles, PWA themeColor, canvas export).
4. **Queued U.2** (TASKS.md): semantic brand/positive/warning class-token migration — 172 emerald/amber literals / 51 files — must land whole; spec'd for a Flash session. Empty states inspected, left alone (deliberate per-surface copy).

**Verification, honestly:** Cowork Linux sandbox, fresh Linux `npm install`: `tsc --noEmit` exit 0, `eslint .` exit 0. vitest (global-setup `prisma db push` → CDN-blocked schema engine) and `next build` (Google Fonts fetch blocked) COULD NOT run in the sandbox — no schema diff, TS-only changes; the CI conclusion on this push is the slice's gate per rule 5/K.8.

**SHIP STATE (2026-08-11, end of Cowork session): `1adc826` was PUSHED by the owner (origin/main confirmed at 1adc826); this docs commit may still be local. The Cowork sandbox could not read the CI gate (no GitHub credentials). NEXT SESSION: push any remaining docs commit, then `bash scripts/ci-status.sh` on 1adc826's run and read the gate to CONCLUSION before starting anything new — the slice may not be called SHIPPED-green until that conclusion is read (rule 5/K.8).**

**STATUS 2026-08-11 — SHIPPED AND PROVEN LIVE (superseding the hold below).** `bash scripts/verify.sh` exited 0 on this tree (tsc 0 / eslint 0 / **6,660 passed + 1 skipped** / build clean; no `prisma/` diff). While this session was recording a hold, the parallel Cowork session committed the same tree — carrying these O.20d-FU source fixes with its own chart-palette work — and the owner pushed it as `1adc826`. That commit's own message hands off the gate read, which this session then performed:

- **CI gate: `success`, run 31517105602 on `1adc826`, attempt 1** — the full `VERIFY_E2E=1` suite, so this slice's changed e2e assertion passed in a real browser. (The Cowork sandbox could only run tsc + eslint; vitest/build/CI were env-blocked there. The unit + build evidence above is this session's, on the same tree.)
- **Live: `node scripts/o20d-live-deploy-check.mjs` → 14 checks PASS** against production (13 live + 1 documented SKIP). The retirement check as shipped was NOT discriminating — `/current portfolio|live balance/` matches the PRE-FU sentence too, so it could not tell the builds apart (the documented wrong-instrument class). Three discriminating checks were added and pass live: the new "combined balance of your investment accounts" wording, the F3 reconciliation sentence against the page's "Portfolio value", and the ABSENCE of the old "live balance of your investment accounts" claim.

**The hold that was recorded (kept for the record, now moot):** a process outside this session created `src/lib/ui/chart-colors.ts` (UNTRACKED) and rewrote nine files this session never touched — `README.md`, `docs/ROADMAP.md`, `docs/PHASES.md`, and the chart components `accounts-list`, `net-worth-card`, `reports-view`, `top-spending-card`, plus (overlapping this slice) `forecast-view`, `retirement-outlook-card`, `allocation-drilldown`. It is a coherent chart-color token consolidation, but it is unreviewed here and has had no critic pass. Three components this slice edited now import `@/lib/ui/chart-colors`, so the two bodies of work cannot be committed separately without either carrying that refactor or breaking the build on an untracked module. The owner chose to hold rather than ship another session's in-flight work to `main` (which auto-deploys to production).

**One earlier build failure was a RACE, not a defect:** a `next build` read `net-worth-card.tsx` while it was being rewritten and reported `Cannot find name 'CHART_POSITIVE'` at line 86 with the import present at line 16. A clean re-run after the writes settled is green. Do not chase it as a bug.

**To resume:** let the other session commit its chart-colors refactor, then re-run `bash scripts/verify.sh`, commit this slice (message drafted at the O.20d-FU record in STATUS.md), push, read `bash scripts/ci-status.sh`, and re-run `node scripts/o20d-live-deploy-check.mjs` against production (11 checks, all asserting live content since this slice replaced the two that did not).

---

## O.20a DONE (2026-08-11, Fable 5 session, DECISIONS #446) — the real gap is dominated by a different, bigger bug than the task row named

**Picking up PROGRESS.md's own pointer above** ("Next: O.20a … measurement first … then the basis decision, recorded before any code moves"). Wrote `scripts/audit-probes/o20a-reports-basis-gap.mts` (new, read-only, calls the shipped `countsInFlows`/`isIncomeFlowRow`/`monthlyFlows` and `isSpendRow`/`spendingByCategory`/`spendRowCategoryId`/`spendContributionCents`/`spentSoFarWindow`/`wholeMonthWindow` directly — no rule re-derived except a clearly-labeled `unflooredCardTotals` that reuses the same three per-row primitives minus the one-line `≤0` floor, to isolate that floor's own effect).

**Measured (real production run, not fabricated):** the demo's $299.93 is fully explained by three seeded PENDING rows (verified against `src/lib/seed/build.ts:539-541`: $250.00+$6.75+$43.18=$299.93 exactly) — a clean instance of the one rule ("pending") the row already knew about. The ONE real production user's CURRENT month gap is **$4,301.23**, and the trailing 6 complete months run **$1,226 to $10,040 EVERY month** — one to two orders of magnitude bigger than the number the task row was written against. Row-level attribution (tagging every divergent row against 6 source-traced mechanisms, R1-R6, full definitions + file:line citations in the probe's docblock) shows the dominant driver is NOT pending at all: it's rows filed to `categoryId==='transfer'` (Venmo payments, "AUTOMATIC PAYMENT" card autopay, brokerage funding) whose `isTransfer` BOOLEAN is false — `countsInFlows` has no category check at all and admits them, `isSpendRow` explicitly excludes `id==='transfer'` and doesn't — dominant Feb/Mar/Apr/May/Jun, in the thousands. July is dominated instead by a "Fees & Charges"-categorized "Overdraft Transfer from Brokerage" row ($15,585.94, also `isTransfer:false`, confirmed by direct query) that the card's per-category ≤0 floor drops entirely while the chart nets it down like a refund. R3 (refund-leaf, Amazon returns) is present every month but small ($13-$112). R2/R4 never fired in 6 months on this corpus.

**Working conclusion (NOT YET DECIDED — sent to a fresh-context Opus 5 critic before committing):** the real divergence is a transfer-`isTransfer`-reliability / inconsistent-categorization problem, not "two reasonable definitions of spending disagreeing." `countsInFlows` (insights.ts) lacks the category-based transfer exclusion `isSpendRow` (reports.ts) already has, but both predicates are shared FAR beyond /reports (need the critic's confirmed consumer list — believed to include /coach, /dashboard, the spending-plan engine, and O.20g's just-shipped income-credibility rule), so a "one-line fix" there is not safely scoped to this slice. Leaning toward: no basis change in O.20a itself, disclosure stays as-is (measurement now backs its restraint), record the real numbers, and file the transfer-reliability finding as its own critic-gated task.

**Critic returned with a P0.** `reconciliationTxnKeepFilter(accountId, date)` — two positional args — was called with a single object; a silent no-op (proven with a controlled fixture) that inflated 3 of 6 historical months by up to 4.6x. Fixed, independently re-run, numbers reproduce the critic's own corrected table exactly. Also caught: two latent `tsc` errors invisible to the normal gate (`.mts` files aren't in `tsconfig.json`'s compile set — confirmed via `tsc --listFiles`), fixed via a manual `--project` check; and the demo was never actually measured (the probe skipped it for lacking `DEMO_TODAY`, which `docs/DEPLOY.md:91` says must never be set in production) — fixed to resolve the demo's `today` via `DEFAULT_AS_OF`, matching `businessToday()`'s real production rule, and re-run: the demo's $299.93 is now ENGINE-VERIFIED as 100% pending (R1), with every trailing complete month at a clean $0.00. The critic also corrected one claim in my own draft reasoning (O.20g's creep detector would NOT be affected by a `countsInFlows` transfer-category fix — traced and confirmed) and refined the R1-R6 tagging logic (R3's sign guard, both halves of the R6 floor now measured).

**Closed out:** DECISIONS #446 written with the corrected, twice-independently-reproduced numbers; TASKS.md's O.20a row → DONE; two new rows filed — **O.20j** (the transfer-`isTransfer`-reliability finding, its own critic-gated slice) and **O.20k** (the inherited reconciliation-boundary bug in the already-shipped `o20g-creep-income-refunds.mts`, meaning DECISIONS #445's specific dollar figures are unverified against this user's reconciliation links). STATUS.md §O.20a records the measurement.

**SHIPPED.** `bash scripts/verify.sh` GREEN (tsc 0 / eslint 0 / 6,710 unit + 1 skipped / build clean, no prisma diff) → committed `e7f7906` → pushed → CI run **31539275068 = SUCCESS, first attempt**, read via `scripts/ci-status.sh` to conclusion. Docs-chain gate for the record commit `0a4de26`: CI run 31540258999 CANCELLED on attempt 1 (not superseded by a newer push) → `gh run rerun` → attempt 2 SUCCESS. No live-deploy check (no user-facing behavior changed — a measurement, a decision, and docs). This O.20a slice is DONE end to end.

---

## U.4 DONE (2026-08-12, Opus 5 xhigh session, DECISIONS #450) — the writer was easy; what reads the rows decided its shape

**Picked up from the queue** (U.3's own finding): only `prisma/seed.ts` had ever written a `BalanceSnapshot`, so every live account's detail panel read "No balance history recorded" permanently and every real user's net-worth trend was a single point.

**The design was settled by evidence, not preference.** Two facts in the existing code decided it before any line was written: `netWorthSeries` sums a date BUCKET (so an account missing from a bucket is an understated money figure, not a shorter list), and `reconcile-boundary.keepsSnapshot` de-duplicates a reconciled pair ONLY on an exact-date collision — while a reconciled pair here is cross-provider by definition. Both force the same answer: ONE pass per USER, ONE date, EVERY account, stamped the day the balance was read. A per-provider writer — the obvious shape, and the one the task row's wording suggested — would have made every historical point a partial sum AND silently double-counted every re-linked account.

**Shipped:** `src/lib/engine/networth/snapshot-plan.ts` (pure planner + the trend read window), `src/server/balance-history.ts` (writer, demo-fenced by construction), called from the nightly cron sweep and both sync actions; idempotent within the calendar month.

**Two fresh-context hostile critics (money/data-integrity + rendered-claims) returned 1 P0 + 7 P1 + P2s, all executed.** The two that mattered:
- The **P0** was a fabricated figure, not a wrong one: a quiet feed's carried-forward rows printed as dated observations directly beneath the note saying nothing had been read since. The fact now rides the row.
- The **P1** I could not have found by reading my own diff: the net-worth delta subtracts two points that can cover different account sets. Pre-U.4 a live user had ONE point, so that figure never rendered — the slice created the surface it broke. Add an account mid-month and it printed −$251,200.00, or +$50,000.00 in green depending only on arrival order.

**Lesson worth keeping (written to docs/lessons/):** a slice that makes a previously-unreachable surface reachable owns that surface's correctness, and a coverage change is not a wealth change.

**Residuals split out, not papered over:** U.5 (panel reads snapshots raw, chart reads them through the reconciliation boundary) and U.6 (a stored row is signed by the account's CURRENT mutable `type`, which every sync rewrites).

**Verification:** three sabotage proofs, each reverted; `bash scripts/verify.sh` green; full `VERIFY_E2E=1` and the CI conclusion recorded in STATUS.md §U.4. `prisma/` diff is comment-only — no column, index or constraint changed, so the live Neon database is untouched.

---

## U.6 DONE (2026-08-12, Fable 5 session, DECISIONS #451) — the fix was easy; the critics reversed the part I was most confident about

**Picked up from the queue** (U.4's own residual): `netWorthSeries` signed each STORED snapshot by the account's CURRENT `Account.type`, and this repo states in its own code that both providers rewrite that on every ordinary sync — so one reclassification across the asset/liability line rewrote the sign of all recorded history for that account, silently.

**Three things checked rather than assumed, each of which changed the design:**
- Storing the observed TYPE beat storing the derived SIGN: `isLiabilityType` stays the single author, so a later correction to the classification rule still reaches history instead of being frozen out of it.
- A stored balance's sign cannot recover its class. SimpleFIN `abs()`es a liability, Plaid keeps its own sign (negative for an overpaid card), and an overdrawn checking or margin account is a genuinely negative ASSET. The "negative means liability" shortcut this slice nearly used is unsound both ways — so the class is carried explicitly on every constituent.
- Making history truthful CREATES a disagreement the old code could not produce: two points, same accounts, different classes. The delta would print 2× a balance as a month's earnings, so it refuses — and the slice owns that surface because it created it.

**Two fresh-context Opus 5 critics (money/data-integrity, rendered claims): 3 P0 + 11 P1, all executed.** The one that mattered most reversed a decision I was confident in. The slice shipped a backfill for pre-U.6 NULL rows, verified on a scratch DB (36 filled, 0 remaining, idempotent). A critic proved it wrong through the real engine — a **$40,000.00 swing** — with an argument I had not considered: an un-backfilled NULL row **self-heals** when a misclassification is corrected, because it is re-signed by the corrected type, while a stamped row never can. It also stamped a class it could disprove from its own table, and could not have run against Neon at all (the generated client is built from the sqlite schema), and with `DATABASE_URL` unset would have written to the local dev DB while printing success. Deleted, not fixed.

The other seven: a note asserting the trend counts "every balance the way it was recorded" (false for the NULL rows sitting right under it); carried-forward rows described as balances that "were read", four lines beneath the note saying nothing had been read; copy asserting a classification the app cannot validate (a re-classing feed may be CORRECTING itself) with no remedy to point at, since nothing anywhere edits an account's type; a **false refusal** deleting a true +$2,000.00 over a $0.00 account changing sides; the unexplained chart cliff (both delta call sites compare only the last two points); the fact carried all the way to the drilldown render and dropped there; and the new engine field being optional, so a `select` could revert a surface with a green gate.

**Verification:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,808 unit + 1 skipped / 415 files** / build clean. Full local `npx playwright test`: **342 passed / 1 flaky / 0 failed** (exit 0). Five sabotage proofs, each reverted. `scripts/u6-live-deploy-check.mjs` run against production BEFORE deploying returned 8/12 — the four discriminating checks failing is its own fail-old proof.

**The `prisma/` diff is a REAL schema change this time** (U.4's was comment-only): one nullable column. `prisma db push` adding it destroys nothing, and until a sync writes new rows every existing row is NULL and reads byte-identically to pre-U.6.

**Residuals filed:** U.7 (a reconciled pair's collision winner now decides that date's sign — **CLOSED 2026-08-15, #474, measured and refused**) and U.8 (the detail panel never renders for CHECKING/SAVINGS/CREDIT — **SHIPPED 2026-08-15, #473**).

**SHIPPED AND PROVEN LIVE.** Committed `e60f9b1` → pushed → **CI run 31605655317 = SUCCESS, first attempt**, read to conclusion via `scripts/ci-status.sh` (the full `VERIFY_E2E=1` gate, so every new assertion passed in a real browser). Vercel deployment `aimplifi-72gcqqn12` reached production in ~5m against the usual ~1m — consistent with `prisma db push` actually adding the column to Neon. `node scripts/u6-live-deploy-check.mjs` → **13/13 PASS** (plus 4 declared SKIPs), where the same script returned **9/13 before the deploy** with exactly the four discriminating checks failing. The demo delta is byte-identical live at `+$1,667.46 vs last month-end`: the new class-change refusal does not misfire on stable classes, which was this slice's main live risk.

---

## U.9 DONE (2026-08-12, Fable 5 session, DECISIONS #453) — the rule was a category error, and the tiebreak was where the money actually moved

**Picked up from the queue** (U.5's own residual, reproduced and filed rather than fixed at the time): two stale rows continued onto ONE live account — the shape `successorAccountId`'s non-uniqueness exists for — both survived every date on or before both cutovers, so one real $5,000.00 savings account contributed $10,000.00 to the net-worth trend, while U.5's panel note on the same screen said "so the same account is not counted twice".

**The diagnosis was a category error, not a missing case.** A link asserts "these two rows are the same real account". That is an EQUIVALENCE — transitive — and the rule was written as two directional walks (`upstreamsOf`/`downstreamsOf`), which model an ORDER. Siblings are neither walk to each other, so each was compared against the successor (which it correctly beat) and never against its twin. Any rule expressed that way is blind to everything related but not ordered, and the tell was already in the file: the statements rule had hit the identical blind spot, solved it locally for statements, and nobody generalised it. De-duplication is now per connected COMPONENT: exactly one snapshot per (component, date), chosen only among rows that EXIST on that date so a lone observation is still never dropped.

**Both fresh-context Opus 5 critics INDEPENDENTLY found the same P0, and it was in the tiebreak, not the rule.** Ranking went tier → cutover → account id. When a chain's two cutovers are EQUAL — valid write-path data, since the confirm action refuses only a *strictly earlier* downstream cutover and `handoverDate` returns today for a successor with no transactions — the mid-chain account's window `(cut..cut]` is empty, so the upstream owns the date. The comparator had no notion of chain position and fell through to the id: identical data produced a **$4,000.00 or a $9,000.00** trend point depending only on how two opaque cuids sorted. Chain `depth` now breaks that tie first. Two further critic findings executed: an **out-degree guard** (a forked predecessor silently broke the component key — `chainMaps` keeps only the last edge — and reproduced the double-count through another door; unreachable from the schema, but the fix had made that borrowed invariant load-bearing for money), and **four false clauses in one panel sentence** plus the drilldown's "a pair you have combined" on the surface that shows the money, the combine card's "a date is never counted twice", and a plural-subject/singular-verb fold note in the assistant.

**The lesson worth keeping (written to docs/lessons/):** my own exhaustive probe — 210,120 cases, union-find grouping, confirmed discriminating at 43,648 violations against the old engine — reported `INVARIANT HOLDS` on the exact shape that was broken, because it asserted how MANY rows survive and never WHICH. Every pre-existing chain fixture also used distinct cutovers. An invariant probe is only as strong as the property it names.

**Residuals filed, not papered over:** **U.11** — the identical sibling blindness on TRANSACTIONS, measured at −$100.00 for one real −$50.00 purchase, reaching every spending surface. Deliberately not fixed here: a snapshot is a STOCK (a second row for one date is provably a duplicate) while a transaction is a FLOW (two $50.00 charges in a day are ordinary), and de-duplicating by claim span would silently delete a row only one feed ever saw — inverting this engine's stated failure direction. Locked as `it.fails` asserting the CORRECT number, so fixing it turns the test into an unexpected pass. **U.12** — a quiet feed's carried-forward repeat can outrank a genuine reading for the same date.

**Verification:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,848 passed + 1 expected fail + 1 skipped / 417 files** / build clean. `npx playwright test tests/e2e/no-dead-ends.spec.ts` → 14 passed (includes the combined-account panel with the corrected copy). Sabotage proof: reverting only the engine reddens all three real-Prisma sibling locks. No `prisma/` diff — read-path only, the live database is untouched.

**A live check that says what it cannot prove:** `scripts/u9-live-deploy-check.mjs` states up front that it CANNOT discriminate this deployment — the demo seed writes no `AccountReconciliation` rows, so no demo page can render a combined pair, let alone a sibling one, and there is no demo-visible string that differs between builds. It asserts only the half that carries the real risk (the R8 golden path: the trend, the panel's recorded history, and the absence of any combine/uncounted claim on a no-link surface) and declares the rest as explicit SKIPs. 18/18 pre-deploy, which is the point — nothing on the demo may move. The discriminating proof is the CI gate, which runs the real-Prisma SIBLINGS tests.

**SHIPPED AND PROVEN LIVE (2026-08-12).** Committed `494a7ee` → pushed → **CI gate `success`, run 31620484428, attempt 1**, read to conclusion via `scripts/ci-status.sh` — the full `VERIFY_E2E=1` suite, so the new real-Prisma SIBLINGS tests passed in a real environment. Vercel production deployment `5873718071` = `success` on that exact sha (the deployment record is what ties production to this commit, since U.9's own live check deliberately cannot discriminate builds). Live proof re-run after the deploy: **U.9 18/18, U.5 12/12, U.6 13/13** — the two earlier slices' proofs still pass, so this money-core change regressed neither.

**Queue from here:** U.10 (a snapshot dated today is marked counted while the chart replaces today's bucket with live balances), **U.11** (the transaction-level sibling double-count this slice measured at −$100.00 for one real −$50.00 purchase and deliberately did not fix — it needs the silent-loss-vs-visible-double decision made on evidence), U.12 (a carried-forward repeat outranking a genuine reading), U.8, U.2.

---

## U.19/U.20/U.21/U.22 IN PROGRESS (2026-08-12, session resumed after PowerShell window died)

**Recovered state (working tree, uncommitted, 9 files / ~417 insertions):** the four U.16 residuals
are being closed as one slice, since all four consume the same account-scoped
`getReconciliationHandoverKeys` set.
- U.19 (transactions CSV): DONE in tree — `changeover_day` column (unconditional), trailing
  rectangular note row (conditional), account-scoped keys in `api/export/route.ts`.
- U.20 (merchant_spend + register): merchant_spend engine/answer/trace DONE in tree
  (`countedOnHandoverDays` REQUIRED on result, flag rides items, trace reads engine rows).
  Register half NOT started: `TxnView.onHandoverDay` + `TxnSummary.countedOnHandoverDays` added
  as REQUIRED, but `server/transactions.ts` (2 sites: ~420, ~811) does not set the row flag and
  `transaction-list.tsx` renders neither the totals disclosure nor a per-row marker (form
  decision still open).
- U.21 (zero branches): engine DONE in tree — `uncountedOnHandoverDays` on SpendingBreakdown
  filled from the same drop loop; `handoverDayNoFigureNote` third author; wired into
  answerSpendTotal/answerSpendByCategory/answerTopCategories zero branches + /reports empty state.
- U.22 (/reports page total): DONE in tree — `reports-handover-total` note above the breakdown.

**Not done:** server/transactions.ts wiring, transaction-list.tsx UI, ALL test-fixture updates
(tsc currently enumerates them), ALL new locks, verify, critic cycles, ship. tsc output = the
authoritative worklist.

**Resumed session progress (same day):**
- server/transactions.ts wired (both TxnView builders set `onHandoverDay` from the account-scoped
  key set); transaction-list.tsx renders the per-row `(connection changeover)` marker + the totals
  caption sentence (`handoverDayRegisterTotalsNote`, a fourth author — the register prints THREE
  tiles, so both sibling authors' "this figure" clauses are false there);
  transaction-detail-view.tsx renders the marker (the row flag was already being set for it).
- TRACE mirror for U.21 zero branches (`noFigureBasis` via the answer's own exported
  `uncountedFor`) — the U.16 answer-path/trace-path lesson, applied before a critic found it.
- server/reports.ts local `handoverDates` renamed `handoverKeys` (it held account-scoped keys).
- All test fixtures updated (subagent, 13 files); two old expectations updated to the new
  contract (phase4 CSV header, merchant_spend result shape) — their failure against the new code
  is fail-old evidence for those two surfaces.
- NEW LOCKS: tests/unit/u19-u21-handover-surfaces.test.ts (25 tests) + e2e third scenario in
  handover-day-disclosure.spec.ts (register marker+caption, /reports total note, CSV yes-column +
  note, and the no-pair control extended to all three). e2e 3/3 green on a fresh build.
- FOUR sabotage proofs run and reverted, each reddening exactly its own locks:
  (1) drop-loop stops recording → 7 U.21 locks red; (2) merchantSpend predicate forced false →
  4 U.20 locks red; (3) summary count gated off → 1 register lock red; (4) CSV note suppressed →
  2 U.19 locks red.
- tsc 0 / eslint 0 / full unit suite green (6,926 passed after expectation updates).

**Next:** two fresh-context hostile critics (money + rendered-claims), fix cycle, verify.sh
VERIFY_E2E=1, docs (DECISIONS/STATUS/TASKS), ship per rule 5.

**Critic cycle (2 fresh contexts, 2 P1 + 8 P1/P2, all executed) — fixed in place:**
P1 money: uncounted note rescoped from zero-only to fact-gated (positive figures, group exhibit,
traces, /reports). P1 claims: negative-net merchant branches get direction-free
`handoverDayAmountsNote` (old direction clause executed INVERTED). Zero-gated trace mirror was
dead code (traces attach only on headlineCents) — ungating P1 made it real. $0 hold excluded
from merchant flag+count and register summary count. Register note enumeration → "whichever of
these totals its amount feeds" (deposits). Note referent-free ("Spending figures leave out").
Detail marker → Badge + on-page `handoverDayDetailNote`. FILED: U.23 (pre-existing export
split/currency parity, executed 4 rows/−$299.00 vs register 2/−$100.00), U.24 (calendar lean
shape can't carry the flag). One u16 lock updated to the rescoped contract (silence → uncounted
note, with comment). Locks now 56 across both files + new regression tests. Full unit suite
6,935 green, lint green. Lesson written:
a-disclosure-gated-to-the-loudest-branch-misses-the-reachable-one. DECISIONS #456 + addendum,
TASKS rows U.23/U.24 filed. verify.sh VERIFY_E2E=1 running in background → then STATUS entry,
archive U.19–U.22 task rows, ship (commit/push/CI gate/deploy/live check 17-17 expected).

**U.19–U.22 SHIPPED AND PROVEN LIVE (2026-08-12).** Commit `2629e7d` → pushed → CI gate
`success`, run 31660421048, attempt 1, read to conclusion via scripts/ci-status.sh. Live:
`node scripts/u19-live-deploy-check.mjs` → **17 PASS / 0 FAIL / 4 declared SKIP**, where the
same script scored 16/1 pre-deploy with exactly the discriminating CSV-header check failing —
this slice's live check can discriminate the build (first in the family), and it did. U.16's
proof re-run: 13/13. U.13's: 6/6. Neither predecessor regressed.

## U.23 — the transactions CSV exports the register's basis (2026-08-12, this session)

**Task:** TASKS U.23, filed by the U.19–U.22 money critic with executed evidence: the export
route's own where-clause double-counted every split (parent AND children) and shipped non-USD
rows the register withholds. Measured 4 rows / −$299.00 exported vs the register's 2 / −$100.00.

**Decision (the one the task row left open — whether non-USD rows should export with a currency
column instead of vanishing): they do NOT get a column; the file adopts the register's clause
whole and DISCLOSES the withhold instead.** Rationale: DECISIONS #135 withholds non-USD accounts
from every money surface because the app does no FX, and #141/#150 already built the disclosure
family for exactly that withhold (banner + inline note). A currency column would make this file
the ONE surface that shows unconverted foreign money, contradicting #135; and a second
where-clause is how a reader starts disagreeing with the register (H.8). So: one author for the
rows (`registerRowWhere`), one more author for the copy, no new column, header unchanged — which
also keeps U.19's live-deploy header check valid unmodified.

**Done in tree:**
- `route.ts`: `where: registerRowWhere(userId)`; the stale hand-built clause and its now-unused
  `SPENDING_ACCOUNT_TYPES` import are gone; `getWithheldRegisterAccountSummary` feeds the note.
- `server/transactions.ts`: `getWithheldRegisterAccountSummary` — the literal complement of
  `registerAccountWhere`'s currency clause (destructured and negated, never retyped), scoped to
  spending accounts that actually hold an exportable row.
- `currency.ts`: `withheldExportNote` — a fourth author, because the siblings say a FIGURE
  excludes accounts and this surface must say the transactions are not IN THE FILE.
- `export.ts`: second parameter REQUIRED (the U.19 `onHandoverDay` precedent); two notes can
  ride one file, fixed order, each rectangular.
- Fixtures updated at all 8 call sites tsc enumerated (4 test files).
- NEW LOCKS: `tests/unit/u23-export-register-parity.test.ts` 17/17, incl. parity asserted BY
  CONSTRUCTION against `getTransactions` and the brokerage-scope trap; `transaction-detail.spec.ts`
  extends the existing UI split with the exported file.
- REGRESSION_LEDGER row appended.
- SABOTAGE PROOFS run and reverted: old where-clause → 5 red with the exact 4-rows/−$299.00
  shape; suppressed note → 4 red.

**Next:** read the two fresh-context critics (money + rendered claims), fix, then verify.sh
VERIFY_E2E=1 (running), docs (DECISIONS/STATUS/TASKS), ship per rule 5.

**U.23 SHIPPED AND PROVEN LIVE (2026-08-12).** Commit `adbba2f` → pushed → CI gate `success`,
run 31664067318, attempt 1, read to conclusion via scripts/ci-status.sh. Vercel: success,
"Deployment has completed", same sha. Live: `node scripts/u23-live-deploy-check.mjs` →
**10 PASS / 0 FAIL / 2 declared SKIP**, including the parity claim measured against production
data (842 exported rows = 842 the register states). No demo-visible marker exists for this slice
by construction (the seed writes no split and no non-USD account — the K.4 situation, declared).
Predecessors re-run: U.19 17/17, U.16 13/13, U.13 6/6 — none regressed. Residuals filed with
executed evidence as U.25 (the file names one of four reasons it is incomplete), U.26 (MEASURED:
3 rows summing −$3,300.00 exported where the register reports $100.00 of money out) and U.27
(currency copy drift).

## U.25 + U.26 — the exported file states its basis and carries the register's two flags (2026-08-13)

**Why one slice:** U.26's task row prescribes "the U.19 shape (unconditional columns + a
conditional note), which pairs naturally with U.25's basis decision" — both are the same
question about the same file (what does a reader who has ONLY this file know about it), and
both land in the same two functions. Splitting them would ship the note order twice.

**Verified before writing anything (rule 0):**
- `summarizeTransactions` (engine/transactions/query.ts:409-439) skips transfers ENTIRELY
  (416) and drops excluded rows from the money sums after counting them (415/419) — so the
  register's inflow/outflow/net exclude both, which is the U.26 measurement's mechanism.
- `isExcludedFromTotals` (engine/transactions/exclude.ts:44) is a plain `=== true` read of
  `Transaction.excludeFromTotals`; its docblock records where the exclusion deliberately does
  NOT apply — account balances, net worth, cash-needed, recurring detection, tax export. So a
  note claiming these rows leave "every figure" would be FALSE. Copy says spending/income/net
  totals, and says balances still count them.
- `getTransactions` (server/transactions.ts:363) reads `registerRowWhere` + `keepsReconciled`
  with no date window and `filter = {}` by default — the same two the export route uses since
  U.23 — so "the rows the Transactions page lists when no filter is applied" is true BY
  CONSTRUCTION, not by coincidence.
- The demo seed DOES write transfers on spending accounts (seed/build.ts:320,321,326,446 —
  checking→savings, CarMax ACH, card payments), and writes NO `excludeFromTotals: true` row.
  So this slice has a demo-visible live marker (transfer column + the transfer-only note
  shape) — not the K.4 situation U.23 had.

**Decision (#458, to be recorded):** basis note UNCONDITIONAL in the file, two new
unconditional columns, one conditional totals note assembled from the flags actually present.

**Done in tree (before critics):**
- `export.ts`: `ExportTxn.excludeFromTotals` + `.isTransfer` REQUIRED; header appends
  `excluded_from_totals,transfer` (appended, never inserted — a reader's script indexes by
  position); `BASIS_CSV_NOTE` unconditional; `excludedTransferCsvNote` conditional and
  assembled from the flags actually present; note padding derived from the header so the
  schema and the padding cannot drift; note order stated as a rule (basis → column notes in
  column order → the one note about rows that are NOT here).
- `route.ts`: both flags read straight off the Prisma row.
- The U.19 byte-identity docblock, the U.23 file docblock, 4 unit expectations and both
  predecessors' live-check assertions updated rather than left to rot — including
  `u23-live-deploy-check.mjs`, whose header equality would otherwise have failed the moment
  this deployed.
- NEW LOCKS: `tests/unit/u25-u26-export-basis-and-flags.test.ts` 19/19 (incl. the critic's
  measurement rebuilt on a real Prisma DB, and every row's mark asserted BY CONSTRUCTION
  against `getTransactions`); a new e2e in `action-menu.spec.ts` that drives the exclusion
  through the real action menu and measures the file's unmarked rows against the register's
  own tile ($85.00 → $45.00); `scripts/u25-live-deploy-check.mjs`.
- FOUR SABOTAGE PROOFS run and reverted: columns unmarked → 2 red; basis note suppressed →
  10 red; note AND-gated over both flags → 5 red; direction clause + "every figure" restored
  → 2 red.
- tsc 0 / eslint 0 / FULL unit suite 6,973 passed (1 expected fail, 1 skipped) / the three
  affected e2e specs 16/16 after fixing the handover control's second CSV block.
- DECISIONS #458 + index row; REGRESSION_LEDGER row appended.

**Next:** read the two fresh-context critics (money + rendered claims), fix, then verify.sh
VERIFY_E2E=1, STATUS/TASKS, ship per rule 5.

**U.25 + U.26 SHIPPED AND PROVEN LIVE (2026-08-13).** Commit `58b19dc` → pushed → CI gate
`success`, run 31669131578, read to conclusion via `scripts/ci-status.sh`. Vercel: success,
"Deployment has completed", same sha. Live: `node scripts/u25-live-deploy-check.mjs` →
**20 PASS / 0 FAIL / 2 declared SKIP**, and unlike U.23's this slice has real demo markers:
842 exported rows, 170 of them marked `transfer,yes`, and the central claim MEASURED on
production — the file's unmarked rows sum to **7,114,385 cents against the register's outflow
tile of 7,114,385 cents**, with the gap the flags explain (16,199,723 over every row) real
rather than cosmetic. Predecessors re-run: U.23 10/10, U.19 17/17, U.16 13/13, U.13 6/6 —
none regressed, and both U.19's and U.23's header assertions were updated in this slice
because they would otherwise have failed the moment it deployed.

One live-check FAIL on the first run was diagnosed rather than assumed: "the caption still
carries its pre-U.20 basis sentence". Probed directly against production — the sentence is
intact ("Totals include pending charges and exclude transfers between your own accounts.
Showing 1–100.") and paints ~3s AFTER the outflow tile, so the script's single body read
taken at tile-paint was the defect. The check now polls; 20/20 on the re-run. U.19's copy of
the same assertion passed throughout, which is what made the timing explanation testable
rather than a guess.

**Queue from here:** U.27 (the currency copy drift this family keeps accreting — four extra
authors of "US dollars" against #141's "U.S. dollars", plus `formatWithheldCurrencies`'
"EUR and others"), U.24 (/calendar cannot carry the handover flag), then the older money
queue: U.11 (the transaction-level sibling double-count, MEASURED at −$100.00 for one real
−$50.00 purchase), U.10, U.12, U.8, U.2.

## U.27 — the currency family's standard has five authors, not one, and a shared phrase misparsed its own noun (2026-08-13)

**Picked up from the queue** (named next by both STATUS.md's and PROGRESS.md's own U.25/U.26
entries). Opened 2026-08-12 by the U.23 rendered-claims critic (P2-6, P2-8).

**Verified before writing anything (rule 0).** Ran an explorer subagent first to map every
site, then re-verified its two most consequential claims myself before trusting them
(`a-subagents-green-is-a-hypothesis`): a direct, case-sensitive grep of all of `src/` for
the bare `US dollar(s)` found exactly 4 sites, not the 4 the task row named — two overlap
(`household-copy.ts:109,175`, `keyword-rules.ts:1378`) but the row's other two,
`connection-depth-copy.ts:57` and `accounts-list.tsx:216`, already read "U.S. dollars" with
the correct punctuation. The 4th real site, a `money.ts` docblock, is not one the row named
at all. Grepped `tests/` for the exact old strings first (`US dollar`, `and others`) and
found zero locks on the informal forms — only `currency.test.ts`'s two `formatWithheldCurrencies`
assertions and the shipped `currency-disclosure.spec.ts` e2e assertions on the CORRECT
"U.S. dollars" phrasing, which stay untouched.

**(a) Fixed the 3 rendered sites + 1 comment.** `household-copy.ts:109,175` → "U.S. dollars".
`keyword-rules.ts:1378` → "U.S.-dollar accounts" — the hyphenated adjectival form, not the
noun form the other three use, because that exact form is already shipped and locked
(`currency-disclosure.spec.ts:119`: "No U.S.-dollar investment holdings yet"), and a slice
whose whole point is stamping out a second spelling should not introduce a third.
`money.ts:139`'s `formatCents` docblock fixed too (zero risk, no test references docblock
prose, and it's what the next author reads before writing the next string).

**(b) Fixed `formatWithheldCurrencies`'s "EUR and others" → "EUR and other currencies".**
Every sentence this string feeds already talks about accounts ("an account in {label} is
left out", `currency.ts:130`), so the bare "and others" read as "and other ACCOUNTS" one
word away. The string is shared with the SHIPPED #141 banner and U.23's export note (both
locked in `currency.test.ts`) — not a drive-by, so both were re-verified directly, not
assumed to inherit the fix.

**(c) Recorded, not fixed, per the row's own "also record."** `getWithheldRegisterAccountSummary`
(`server/transactions.ts:1986`) models the register's basis but not the R1 reconciliation
keep — unlike `getTransactions`, which fetches raw rows and filters them through
`getReconciliationTxnKeep` afterward, because the keep is a per-row `(accountId, date)`
function and can't join a Prisma `where` clause the way the rest of this function is built.
A non-USD account that's ALSO a fully-disowned reconciliation predecessor is still counted
as withheld-by-currency. No sentence becomes false — the export note's count only ever
over-discloses — and the condition is doubly rare (non-USD AND a disowned predecessor) and
unreachable on the demo seed (K.4), so no live-check angle exists either way. Filed as
**U.28** in TASKS.md rather than left as a comment only, so the fact survives past this
session.

**Locked as a sweep, not a per-site list.** New file `tests/unit/u27-currency-copy-drift.test.ts`:
one `describe` walks every `.ts`/`.tsx` file under `src/` for the bare, word-boundaried
`\bUS dollars?\b` (mirrors `source-hygiene.test.ts`'s control-byte walk, applied to a copy
standard instead of a byte class — the periods in "U.S." break the `\bUS\b` token, so it can
never false-positive on the correct form); the other asserts `withheldBannerCopy` and
`withheldExportNote` both render "and other currencies" directly, not just the underlying
function. `currency.test.ts`'s two locked "EUR and others" assertions updated to the new
phrase.

**Fail-old proven by direct sabotage, not asserted.** Reverted `household-copy.ts`'s fix →
the sweep test reddened exactly (1 file named). Restored, then reverted `currency.ts`'s fix
→ 3 assertions reddened across the sweep file and `currency.test.ts`'s own describe block,
including the two-consumer assertion catching that the fix genuinely reaches both the banner
and the export note rather than one. Restored; both confirmed passing again before the full
gate.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh`:

```
════ TYPECHECK (tsc --noEmit) ════

════ LINT (eslint) ════

════ UNIT TESTS (vitest) ════
 Test Files  423 passed | 1 skipped (424)
      Tests  6980 passed | 1 expected fail | 1 skipped (6982)

════ BUILD (next build) ════
✓ Compiled successfully in 9.1s

════ E2E (playwright) ════
347 passed (4.9m)
  2 flaky (passed on retry): merchant-lens.spec.ts, transactions.spec.ts CSV import —
  both pre-existing members of the recorded load-induced local flake class, in specs
  this slice does not touch (no currency/copy code in either path)

✅ VERIFY GREEN
```

tsc and eslint printed nothing between their headers — zero errors, zero warnings. No
`prisma/` diff (confirmed against `origin/main` before push): copy-only change to three
rendered strings and two comments, plus the new locking test file. DECISIONS #459 +
index row; REGRESSION_LEDGER row appended; TASKS.md U.27 marked done, U.28 filed.

**SHIPPED AND PROVEN LIVE (2026-08-13).** Commit `eef777b` → pushed → CI gate `success`,
run 31690491184, read to conclusion via `scripts/ci-status.sh` (exit 0). Vercel commit
status: success, "Deployment has completed", same sha. Production responds correctly
(`curl -I https://www.aimplifi.app/` → 307 to `/sign-in`; `/dashboard` unauthenticated →
307 — both expected, not a 500).

**No demo-visible marker, and none is possible — declared, not skipped.** Every changed
string sits behind either the currency guard (a non-USD account) or a household-scoped
non-USD share, and the demo seed writes neither (the K.4 fact U.23/U.25/U.26 already
established — not re-derived here, just re-applies). Unlike U.23, which still had ONE
computational claim to check live (the export route running the register's own clause),
U.27 is pure copy with zero engine logic and no `prisma/` diff, so there is no figure or
row count a production probe could compare either. What stands in for a live check: CI's
full e2e suite ran against a genuine build of this exact commit, including
`currency-disclosure.spec.ts`'s existing locks on the correct family phrasing family-wide,
plus the fail-old/pass-new sabotage proofs on the new sweep test. Writing a bespoke
`u27-live-deploy-check.mjs` for a slice with no reachable content to probe would be
verification theater — asserting the deployment exists, which the gate reads above already
prove more precisely.

---

## ✅ BUILT 2026-08-13 — U.24: the calendar's released day is counted out loud (DECISIONS #461)

The last spending surface that counted U.13's released handover day in silence. /calendar reuses
the register's where-clause and R1 keep (the K.1 gate), so a day both a retiring feed and its
replacement reported has always shown BOTH copies in its tiles — one real $50.00 purchase printing
$100.00 of money out — while the page carried no handover vocabulary at all.

**The fact was dropped at a narrowing, and the narrowing was documented as a design.**
`PostedTxnLike` is a lean row shape ("exactly what the shared summarize needs"), and
`TotalableTxn.onHandoverDay` was OPTIONAL with a docblock naming that very shape as its
justification — so `summarizeTransactions` read the absent value as "not released" and returned 0
forever. Fixed by making the flag REQUIRED on the calendar's own row type (the compiler then
enumerated every builder: exactly one in production, one test helper) and resolving it in
`getPostedCalendarRows`, the layer that holds `accountId`, so the unit of the claim stays the
(account, day) PAIR rather than the bare date. `countedOnHandoverDays` on the day and the month
come off the SAME `summarizeTransactions` calls the tiles and totals are summed from.

**Copy: the sixth existing author reused, not a seventh written.** This surface lists no
transaction rows (each day links out to Activity) and prints an in AND an out, so
`breakdownHandoverDayCopy` ("N rows here"), `handoverDayRegisterTotalsNote` ("it is listed") and
`handoverDayAnswerNote` (one direction: "too high / too LOW") are each false here in a different
way. `handoverDayAmountsNote` states the counting rule and claims neither.

**Two fresh-context critics, 2 P1 — each found BOTH, independently.** (1) The per-day marker
asserted the double as FACT ("counted on both connections' records") four lines under this slice's
own comment saying it deliberately makes no such claim; the keys are minted per link from the
cutover alone, so a released day on which only ONE connection reported is marked too, and there the
flat claim is false beside a specific amount. Restated to the unconditionally-true keep. (2) The
note was placed below the projected "Expected" line, whose figures are built from scheduled series
and card dues and hold no released row — so "these amounts" qualified the two figures it is not
about. Moved directly under the posted totals, locked by DOM ORDER. Residuals filed as U.30 (the
home screen's Recent transactions card, still silent and without even an account name), U.31 (two
independent reads of the link table in one loader) and U.32 (the day tile's row COUNTS and the
closing basis caption).

**Nothing about the money changed** — no filter added, no sum touched. Both copies are still
counted, as U.13 intended and the K.1 gate requires. The failure closed is silence.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN** (exit 0). E2E **349 passed,
2 flaky-passed-on-retry** (`action-menu.spec.ts`, `merchant-lens.spec.ts` — both pre-existing
members of the recorded load-induced local flake class, in specs this slice does not touch).
Independently this session: `npx tsc --noEmit` 0 errors, `npx eslint .` 0 output, `npx vitest run`
**423 files / 6991 tests passed** (1 expected-fail, 1 skipped), `npx next build` clean. No
`prisma/` diff — read-path and copy only, so the live Neon database is untouched.

**SHIPPED AND PROVEN LIVE (2026-08-13).** Commits `c46ef6c` (slice) + `0db1041` (the hypothesis
refutation) → pushed → CI gate **`success`**, run 31716116407, read to conclusion via
`scripts/ci-status.sh` (exit 0). Vercel commit status: `success`, "Deployment has completed", same
sha. Production responds correctly: `https://www.aimplifi.app/` → 307 and `/calendar` → 307, the
expected unauthenticated redirect to sign-in, not a 500.

**No demo-visible marker, and none is possible — declared, not skipped (the K.4 shape).** Re-verified
this session rather than inherited: `grep AccountReconciliation prisma/seed.ts` → **zero hits**, so
the demo dataset contains no combined-account pair, no cutover, and therefore no released handover
day for this disclosure to fire on. Every string and count this slice adds sits behind
`countedOnHandoverDays > 0`, which is unreachable for the demo user by construction. What stands in
for a live probe: CI's full `VERIFY_E2E=1` suite ran against a genuine build of this exact commit,
including the new /calendar e2e test, which drives a REAL seeded combined-account handover pair
(a SimpleFIN predecessor and its Plaid successor, one $30.00 control charge de-duplicated and one
$50.00 charge released to both sides) through the browser and asserts the $100.00 tile, the note's
text, its DOM position above the projected line, and the day marker's exact wording — plus the
no-combined-accounts control asserting /calendar stays silent. A bespoke production probe would
assert only that the deployment exists, which the two gate reads above already prove more precisely.

---

## ✅ BUILT 2026-08-13 — U.33: the boundary's last two hand-rolled reads, and a link table read four times inside one write (DECISIONS #465)

The last two views of the reconciliation boundary that U.31 did not consolidate. `refreshRecurringForUser`
read the `accountReconciliation` table FOUR times per run — not the two the row named — and fed three of
those reads into a SINGLE `collapseHandoverDuplicates` call whose output is `detectRecurring`'s input and
is PERSISTED as `RecurringSeries` + `ScheduledTransaction` rows driving forecast, the calendar, the
spending plan and the Cash-Needed Engine. `getTaxExport` read it twice for one file that leaves the app.

**The row's scope was short by two reads, and the measurement came before the code.** The two the U.31
critic named were the keep and the released dates. The two it missed were both `activeTerminalSuccessorMap`
— once as the third argument of that same `collapseHandoverDuplicates` call, and again fifty lines later
where `new Set(terminalOf.keys())` decides which accounts are in scope for the rows the function WRITES,
with detection and merchant resolution running in between. Second consecutive slice in this family whose
row under-counted itself (#463 was the first).

**Neither shape the row offered was built.** It proposed a parallel `getReconciliationDatesBoundary` or a
shared signature covering both; a second boundary function is a second place for the fetch to drift, which
is the defect this family exists to remove. `getReconciliationBoundary` instead returns FOUR views from one
read — `keepsReconciled`, `handoverKeys`, `handoverDates`, `terminalOf` — every one the same derivation
from the same two inputs, all four empty/constant-true on the no-links fast path, all pure O(links) work
over arrays already in memory (so the three pre-existing callers pay no query for the two new views).
`getReconciliationHandoverDates`, which held the LAST hand-rolled copy of the links+accounts+spans triple,
now routes through the shared fetch like its siblings. `taxRows` takes the keep as a REQUIRED parameter —
an optional one with a fallback is exactly how a second read survives a consolidation unnoticed.

**The one real risk was checked, not assumed.** `terminalOf` reaches `terminalSuccessorMap` through a
differently-ordered array than `activeTerminalSuccessorMap` used (`getActiveReconciliations` sorts by
`confirmedByUserAt`; the standalone query has no `orderBy`), and order could matter because `chainMaps`
builds `succOf` with `new Map`, where a repeated predecessor key means the last edge wins. It is
unreachable twice over: `effectiveReconciliationLinks`' out-degree guard drops every link out of a
two-successor predecessor before `chainMaps` sees it (U.9 critic finding 3, written for this exact hazard),
and `AccountReconciliation.predecessorAccountId` is `@unique`, so the database cannot hold the shape
either. Recorded in the code beside the line it justifies.

**Locked by a COUNT, because equivalence would pass against four separate reads.**
`tests/unit/reconciliation-boundary-shared-read.test.ts` (U.31's file, extended by 6 tests): equivalence of
`handoverDates`/`terminalOf` against their standalone functions, dates-vs-keys proven DIFFERENT sets (1
date, 2 keys — a bare date is not a key and a key is not a bare date), the all-four-empty fast path, and a
`vi.spyOn(prisma.accountReconciliation, 'findMany')` count asserting `getTaxExport` and
`refreshRecurringForUser` each read the table EXACTLY ONCE (the tax case also asserting the export really
assembled, $125.00 — a read count over a file that produced nothing proves nothing). **Both counts proven
fail-old by sabotage, not asserted:** restoring tax.ts's concurrent pair reddened at "expected 1, got 2";
restoring recurring.ts's second `activeTerminalSuccessorMap` read reddened at "expected 1, got 2". Both
sabotages reverted and re-verified green.

**Hostile critic (fresh context, Opus 5): PASS — 0 P0, 0 P1, five P2.** It proved behavior preservation
the way I had not thought to: a fixture with a real mid-stream cutover, a subscription doubled on the
released day, income straddling it and a tax-tagged charge on both sides — then dumped every persisted
`RecurringSeries` and `ScheduledTransaction` field plus the whole tax export, reverted `src/` to HEAD,
re-ran, and `diff`ed. **Identical, twice.** Netflix still MONTHLY (the collapse worked), the series still
re-keyed onto the successor, tax total 55000 with both copies kept. It also CORRECTED my own reasoning:
I justified the ordering safety on the out-degree guard AND the `@unique` constraint; the constraint is
not load-bearing and must not be leaned on, since this file's doctrine is to re-check at read time what
the writer refuses — so it built the out-degree-2 shape that defeats *my* argument and showed the output
identical anyway, because the guard caught it. Three P2s executed (the zero-caller export deleted, the
tautological assertion replaced, the count fixture given a real link — which moved recurring's fail-old
count from 2 to **4**); one accepted with its measurement recorded (the effectiveness walk now runs 4×
per boundary call: +0.155ms at 20 links, noise at real counts); one filed as U.34.

**Gate (final tree, quiet — see the process note below).** `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** (exit 0): tsc 0, eslint 0, unit **7,001 passed + 1 expected fail + 1 skipped / 426
files**, `next build` clean, e2e **349 passed, 4 flaky-passed-on-retry** (`category-rename.spec.ts:110`,
`pwa-offline.spec.ts:51`, `transactions.spec.ts:610`, `transactions.spec.ts:1014` — all members of the
documented K.10 / `ci-e2e-timing-flake.md` shared-SQLite contention class, none touching reconciliation,
recurring or tax code). No `prisma/` diff: read-path only, so the live Neon database is untouched.

**Process note worth keeping: I ran the gate while the critic subagent was working in the SAME directory,
and it reddened seven tests that were not defects.** The critic reverted `src/` to HEAD twice to measure
the old code (~15s each) and added three scratch files under `tests/unit/`, which vitest globs, on the
shared SQLite test database. That is LOOP_ENGINEERING rule 9 — one agent, one directory — and I broke it
myself. The failing run was discarded and the gate re-run on a quiet tree. The lesson is not "subagents
are risky": it is that a verification gate and a mutating agent cannot share a working tree, and a red
gate under that condition proves nothing in either direction.

**Residual filed as U.34, not fixed:** `getSpendingPlan` reads `activeTerminalSuccessorMap` at
spending-plan.ts:186 for the income scope and again at :667 (via `countedExpenseSeriesForPlan`) for the
expense scope — one rendered plan, two snapshots of one table. Same class, different file, RENDERED rather
than persisted, so it is a separate slice.

**Also this session: an ORPHANED uncommitted schema edit was found in the working tree and filed rather
than shipped or discarded.** `prisma/schema.prisma` carried an un-committed `Account.paymentMerchantId`
column (a debt-payment-history bridge, labelled "V.1" in its own comments — an id already owned by Wave V)
with no task row, no code, no test and no ledger entry anywhere. A schema change runs `prisma db push`
against live Neon on deploy, and a column no code reads is exactly the dangling migration rule 5 exists to
prevent. Stashed (`git stash list` → the entry beginning `ORPHANED V.1 start`), the Prisma client
regenerated from the tracked schema, and the whole design recorded as **TASKS H.9** so the one decision it
had already made — the link is chosen by the reader and NEVER inferred from name similarity — is not
re-derived by whoever picks it up.

**SHIPPED AND PROVEN LIVE (2026-08-13).** Commit `fb4be1e` → pushed → CI gate **`success`**, run
31754057887, read to conclusion via `scripts/ci-status.sh` (exit 0, first attempt). Vercel commit
status: `success`, "Deployment has completed", same sha. Production `/`, `/recurring`, `/calendar` and
`/spending-plan` all 307; `/api/export` 401 — the expected unauthenticated responses, not 500s. No
`prisma/` diff. No demo-visible marker and none possible: `grep -c accountReconciliation prisma/seed.ts`
→ 0 (re-verified, K.4), and the slice adds no rendered surface at all — its claim is a query count,
which is unobservable from outside. The critic's byte-identical persisted-output diff is the stronger
substitute.
