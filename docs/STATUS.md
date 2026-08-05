# STATUS — known limitations & open items

Living document; updated at each phase boundary and critic cycle.

> Entries from 2026-06/2026-07 (BUILT/CLOSED history) were moved verbatim to
> `docs/archive/STATUS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04 to keep this
> file loadable. Only OPEN/DECIDED items and 2026-08 entries live here.

## ✅ BUILT 2026-08-04 — C.13 P1-27: the Fixed/Discretionary heading and its register read one row set (DECISIONS #409)

The audit's stated cause was already dead — #397 admits PENDING into
`classifySpendClass`, so the $49.93 it cited is gone, verified before anything was
touched. The parity claim survived through a mechanism the audit did not name: the
register applies the shared R1 reconciliation keep before it stamps `spendClass`,
`/budgets` applied that keep to `spendRows` and handed the Fixed/Discretionary panel
the raw month query. `summarizeSpendClassCategories` now takes `keepsReconciled` as a
REQUIRED parameter. Critic P1 (fresh context, executed): with the panel now provably
equal to the register, /budgets prints one category twice — C.25 excludes a loan
payment from By-category so THAT figure matches its link, the split keeps it so ITS
link matches — with the explaining sentence under the lower card only.
`spendClassLoanPaymentNote` now states the direction beside both.

Gate: `bash scripts/verify.sh` GREEN — tsc 0, eslint 0, **5952 unit / 361 files**,
build clean. Targeted e2e 10/10 serially (spend-class, spend-class-drilldown,
budgets-basis, budget-targets, category-drilldown).

**OPEN — `/budgets/page.tsx` has no test of its own.** The new required parameter is
load-bearing by TYPE only: an edit could satisfy it with `() => true` and no test in
the repo would fail (the critic verified this by grep). The real lock is a
server-level test over a seeded reconciled pair comparing `getTransactions().summary`
against the page's panel total. Filed, not built.

**CLOSED 2026-08-05 — C.26 built (DECISIONS #410).** See the entry below.

## ✅ BUILT 2026-08-05 — C.26 (P1-28): one window for "spent this month", and the register link is built from it (DECISIONS #410)

`computePace` stopped at today and `spendingByCategory` did not, so the
dashboard's top-spending card and the pace card an inch away answered "this
month" over two windows; Ask carried the same split (`merchant_spend` has
clamped since O.7, the three category intents had not). The window is now a
value a figure CARRIES — `SpendWindow` — with one translation to register dates,
so a figure and its link cannot be windowed by two authors. /budgets keeps the
whole month deliberately (an allowance a later-dated charge has already
consumed; clamping would raise "left to spend"), and each page equals its OWN
register.

**Critic cycle 1: FAIL, 6 P1s, all executed, all fixed.** The /reports view
could still reintroduce the measured $120→$520 defect with the suite green, so
the href is now built by `getReports` (the view names no window); the new
disclosure was asserted nowhere, so basis composition moved out of the .tsx into
the engine; the CHART panel had the clamp without its disclosure and printed two
false sentences (it blamed the reader's refunds for money the date rule removed,
and said "No posted spending in June 2026" over $400.00 of posted June
spending); a category the clamp emptied disclosed nothing anywhere; and Ask's
basis line read as the complete rule while omitting the newest exclusion.

Gate: `bash scripts/verify.sh` GREEN — tsc 0, eslint 0, **5972 unit / 362
files**, build clean. Targeted e2e 15/15 (reports-total-reconciles,
budgets-basis, category-breakdown, category-drilldown, spend-class-drilldown).

**OPEN — a rule that lives in a `.tsx` still cannot be locked.** This repo has
no component-rendering harness (no testing-library), which is why C.26's fixes
move decisions INTO loaders and engines rather than testing the components. Two
things remain component-level and are guarded only by `tsc` plus e2e on the demo
seed: that `CategoryBreakdownPanel` calls `categoryPanelBasis` at all, and the
/reports page-level sentence. The cheapest real closure is a render harness;
filed, not built.

## ✅ BUILT 2026-08-04 — C.12: an instruction and the figure it qualifies now come from the same selection (audit P1-16/17/18/20, DECISIONS #408)

Four instruction/figure drifts, one root. (a) The cash-needed shortfall paired
the window's worst dip with the FIRST short date on four surfaces ("$10,001.00
on Aug 10" for a $1.00 day, incl. a `critical` nudge) — the exact pairing
radar had already fixed (L.23), unported to the sibling engine. The headline
now carries `firstShortCents` / `worstDipDate` / `shortfallDateBalanceCents`;
the hero title pairs the window figure with the worst dip's own date, the
nudge stakes the first date's own step figure, Ask and the calendar cell pair
each amount with its own date. **Critic cycle 1 (P1) caught the fix itself:**
the two-step sentence re-introduced the decoupling whenever an intermediate
day dipped deeper than step 1 covers — both engines now offer the split only
when the walk proves every day in [firstNegativeDate, worstDipDate) sound,
and withhold it otherwise (the single sufficient transfer always stands).
Wording says "covers", never "is needed" (the step figure rounds UP), and is
cause-neutral ("the rest is for the low point on …"). (b) /cards "Do this
first" is gated by `firstCountedActionCard` — the same `paintedHeroCards`
membership the hero uses and the same set the printed total sums; a next-cycle
estimate can no longer head the page's one imperative, and its row reads
"Estimated — next cycle". (c) /forecast's card-payment caveat moved above the
hero figure (DOM-order e2e lock). (d) `RadarInput.undatableCards` is required
at the boundary (the hero's own #277 fence), the radar card discloses the
count in every status ahead of the cover transfer, and the assumption names
the verdict actually on screen.

**Locks:** cash-needed H2 (split fields, single-event zero, P1-1 withhold),
nudge per-date stake, Ask two-step present/absent, firstCountedActionCard
(estimate-first trap / all-estimates promote / null banner), radar undatable
(ok/alert/none) and P1-1 withhold, forecast DOM-order e2e. Mutation-proven in
both directions per the critics' revert checks. Two fresh-context critics
(money + copy), 2 cycles, zero open P0/P1. Accepted residuals (nudge stake
precision, second-step posting buffer, chip-string duplication, unnamed first
short day on the hero) are recorded in DECISIONS #408. Lesson:
docs/lessons/a-fix-on-the-reported-surface-is-not-a-fix-on-the-pattern.md.

**Deploy-verified 2026-08-04:** `29d3b86` (no prisma diff);
`scripts/c12-live-deploy-check.mjs` against production → DEPLOY PROOF: PASS
(5/5) — `forecast-scope-note` renders above the hero figure (DOM order
checked), and the served client bundle carries the marker. Targeted e2e on
the verify build: 17 passed; the 3 failures reproduce identically on clean
HEAD (pre-existing drift — see the OPEN entry below).

## ✅ BUILT 2026-08-04 — C.11: the Glass-Box certification is split into the claim it can stand behind and the one it can't (audit P1-14, DECISIONS #407)

The audit's trust-surface finding: every Glass-Box panel ended "…matched to
the penny. Every amount is computed from your own data; nothing is invented",
and both halves overclaimed. `reconciles` compared two readings of the SAME
plan fields (`income − fixed − savings` vs `leftToSpendCents`, which
`plan.ts:707` computes from the same three; the bucket panels against
`conscious.ts` copies of the identical fields) — true for every input,
including every defect in the audit, while the comments called it "a real
cross-module check". And the provenance clause was false whenever a figure was
reader-typed: an income/fixed override, a goal or savings-% target above $0,
a budget target pricing a Fixed category — or, found by critic cycle 2, a
reader-ADDED card whose statement or balance is a typed figure. Fix:
`NumberTrace` gains a REQUIRED `dataDerived` flag, per-panel: cash-needed is
true iff no row comes from a manual card (`Account.provider` →
`CardSnapshot.manual` → `CardObligation.isManual`, both statement and estimate
paths); the fixed bucket answers for the fixed term alone; savings never; the
full identity requires all three terms clean, unknown budget-pricing treated
conservatively as reader-set. One-row panels say "This amount is the whole
figure." — no penny-match and no completeness claim (cycle 2 P1-1: the Fixed
row is itself an aggregate); multi-row panels keep the arithmetic sentence and
the fail-loud mismatch branch; the clause renders only under the flag in all
four copy authors (panel, share text, /spending-plan's fused sentence, plus
the zero-income basis and Ask's two copies reworded to the app's state: "no
income has been detected"). `reconciles` is restated everywhere as what it is
— a drift alarm, not a certification. The same one-row rule now applies in
breakdown-panel.tsx.

**Locks:** S8 in glass-box.test.ts (gate cases incl. cash-needed feed-true /
manual-false on both paths + mixed, and the reconciles/dataDerived
independence), per-bucket locks in conscious-trace.test.ts, redact locks for
both branches, and e2e on /budgets (no penny-match on the one-row panels, no
clause on savings). Mutation-proven in both directions: four mutations (delete
savings condition → 5 tests kill it; flip the unknown-default → 2; force flag
off → 4; force the fixed predicate true → 5), all reverted green.

**Critic cycles:** 2 (DECISIONS #407). Cycle 2 (fresh context, two lenses)
refuted the first cut's cash-needed `true` (wrong source checked — manual
cards exist, DECISIONS #45) and the one-row sentence's completeness claim;
both fixed same cycle, the overclaiming test rewritten with them.

**Gate:** `bash scripts/verify.sh` → **VERIFY GREEN** (tsc 0, eslint 0,
**5930 unit / 360 files**, build clean). E2e serially on that build:
glass-box, conscious-buckets, spending-plan-month-edge, month-flow-drilldown,
category-breakdown. Pre-existing red
fixed on the way: DECISIONS_INDEX.md had stopped at #405 while DECISIONS.md
carried #406 — `ledger.ts reindex` regenerated it (395 entries, drop-guarded).

**Deploy-verified 2026-08-04:** pushed `4b5c43c` (no prisma diff → database
untouched). Deployment `aimplifi-53qi3p5bv` ● Ready, aliased to
www.aimplifi.app. Proof is `scripts/c11-live-deploy-check.mjs` → **DEPLOY
PROOF: PASS (7/7)** on the live site: signed into the shared demo, the Fixed
panel (one row) renders the C.11 sentence with the provenance clause (the
demo's Fixed term is data-derived) and NO penny-match; the Savings panel
withholds the clause; the guilt-free panel keeps the arithmetic sentence; the
served client bundle carries the C.11-only literal. (The zero-income sentence
is a server-chunk literal and demo-unreachable — freshness rides the DOM
states, which the old build cannot render.)

**Honest residuals (DECISIONS #407):** the clause-render FALSE branch is
e2e-reached only via the savings panel (the seed has no overrides, budget
targets, or manual accounts); override/budget/manual readers are unit-locked
at the flag only (no RTL in the repo). Month-flow / category-breakdown panels
keep their MULTI-row penny-match as product behaviour — their check is the
same drift-alarm shape (rows are the figure's own input transactions), not a
re-certification. `AccountLike.provider` is optional: only the demo provider
exists, and it emits full Prisma rows.

## ✅ BUILT 2026-08-04 — C.10: the wealth-target pace line branches on the contribution's basis, and a plan the history doesn't back gets no date (audit P0-8, DECISIONS #406)

The last open P0 of the calc audit. #375 made the years dial compound the settings
savings-% target whenever one is set, but the pace line kept calling the figure
"what was left after spending, averaged over the N months" — a history claim the
line beneath falsified ("Recent surplus averaged −$450.00/month") — and the refusal
tested only the figure the dial was HANDED, which a positive plan clears by
construction: an overspender with a savings % set got a confident 20-year arrival
beside the FI card refusing one. Fix: the pace-line decision moved into a pure
selector (`COACH_COPY.wealthTargetPaceLine`) that branches on the basis and gates a
settings contribution on the OBSERVED surplus; new planned-pace sentence ("what your
plan has you setting aside", no window claim); refusal with the
`wealthTargetNotSaving` split (zero complete months = absence, not behaviour;
otherwise "nothing has been left over after spending", accurate at an exact tie).
Critic cycle 1 caught the sibling defect: a refused plan still SEEDED the horizon
slider ("your current pace lands it" under the refusal) — now one exported
predicate (`wealthTargetPlanUnproven`) gates BOTH the refusal and the seed, which
falls back to the unchosen 25-year default like a floored surplus. Surplus-basis
rendering is byte-identical, locked as such.

**Gate:** `bash scripts/verify.sh` → **VERIFY GREEN** (tsc 0, eslint 0, **5909
unit / 360 files** (+1 predicate lock), build clean). `wealth-target.spec.ts` 2/2
serially on that build. **P2 residuals noted in DECISIONS #406** (beyond-horizon
"what's going in now" now reachable on the settings basis; the seed's OR line has
no node-env lock — repo has no RTL — its two inputs are locked).

**Deploy-verified 2026-08-04:** pushed `a243e90` (no prisma diff → database
untouched). Proof is `scripts/c10-live-deploy-check.mjs` → **DEPLOY PROOF: PASS**
on www.aimplifi.app: signed into the shared demo, the pace line renders an arrival
through the new selector ("At $1,239.70/month — what was left after spending,
averaged over the 6 months of …"), and the SERVED client bundle carries both
C.10-only literals ("what your plan has you setting aside", "nothing has been left
over after spending") — the freshness marker the byte-identical demo sentence
cannot provide. A script-only commit `14d4059` followed (not in the app build).

## ✅ BUILT 2026-08-04 — scenario engine speaks the coach's REAL window (closes the C.9 residual)

The C.9 OPEN residual is closed. `ScenarioBase` now carries a REQUIRED
`averageWindowMonths` — verbatim `CoachData.fi.monthlySavingsMonths`, the coach's real
window (≤ 6 full months; 0 = none on record) — and `ScenarioState` carries it through
`applyScenario`. Every copy site that hardcoded "6 months" now interpolates the window
in the coach's C.9 dialect: the standing assumption ("averages over your last N full
month(s)"), both S15 $0-base disclosures ("income/spending over the last N months"),
and the doc comments. Window 0 gets the honest named-zero branch ("no complete months
of history are on record yet" / "your history so far") instead of inventing a window.
No math changed — the aggregates arrive pre-averaged verbatim, and the window is
copy-only by documented contract. There is no scenario UI yet, so no page renders the
copy; the engine contract is what the future what-if surface will read.

**Locks:** scenario.test.ts grew a window-consistency block — the window carried
verbatim for 0..6; the assumption string pinned per N with a no-"6"-unless-N-is-6
guard; singular at 1; the window-0 branches; S15 notes interpolated on BOTH sides;
consistency surviving a fully-knobbed scenario. Full-window (6) rendering stays
byte-identical, so the existing pinned assertions were untouched.

**Gate:** `bash scripts/verify.sh` → **VERIFY GREEN** (tsc 0, eslint 0, unit green,
next build clean).

**Deploy-verified 2026-08-04:** pushed `b902ac9` (no prisma diff → database untouched);
Vercel deployment status **success** on that SHA (deployment id 5751099840,
`aimplifi-73d3kh9nh-reiforge.vercel.app`); www answers (307 → /sign-in, the auth
gate, as designed) and the deployment URL serves 200 at /sign-in. No content-match
grep was possible: the scenario engine has no rendered UI surface yet — the changed
copy lives entirely in the engine contract the unit locks executed.

## ✅ BUILT 2026-08-04 — C.9: annual spending scales by the REAL window, never ×2 (DECISIONS #405, audit P0-6)

`getCoachData` computed `annualExpenses = expenses6 * 2` while the savings/income
averages divided by `Math.max(1, last6.length)` — so a reader three months in got an
annual figure exactly HALF their true spending, and the FI number, the FI date, Coast
and the /goals emergency-fund example halved with it. Fix: one line of money math in
the server that owns the window — `roundHalfAwayFromZero(expenses6 * 12 /
Math.max(1, last6.length))`. For a full six-month window this is byte-identical to the
old value (×12/6 = ×2, exact integer — no rounding drift); for N < 6 it is the true year.

**The copy half of the slice.** Five surfaces hardcoded "6": the FI sentence ("last 6
full months × 2"), the slider caption + context, the share-of-income sentence, and the
runway cushion on BOTH the signature weather line and the dashboard income-pause line.
Each now receives the window — the server's existing `monthlySavingsMonths` (documented
as ALSO the annual-expense window) for the /coach cards; a new REQUIRED
`NudgeInput.runwayWindowMonths` riding onto `Proposal` for the income-pause line
(required, not defaulted). Full-window renderings are byte-identical; short windows say
"your last 3 full months × 4" / "3-month average pace"; zero history gets a named-zero
branch instead of "0 months".

**Critic cycle 1 — zero P0/P1.** One P2 recorded as an OPEN residual below (the
scenario engine's own "6-month averages" note — pre-existing, separate engine).

**Locks:** fi-real-basis.test.ts grew a 3-month-history Prisma lock (window carried as
3; annual = the true $36,000; FI = $900,000; fail-old pins against the $18,000/$450,000
half-values; the FI sentence naming "your last 3 full months × 4" off the REAL server
output). Copy locks pin the N=3/1/0 branches and byte-identical N=6 forms.

**Gate:** `bash scripts/verify.sh` → **VERIFY GREEN** (tsc 0, eslint 0, unit green,
next build clean). Targeted `phase3-coach.spec.ts` e2e 1/1 — the demo seed's six-month
window leaves every pinned string byte-identical.

**Deploy-verified 2026-08-04:** pushed `ba90b3c` (no prisma diff → database untouched);
Vercel status **success** on that SHA (deployment
`reiforge/aimplifi/DX6YxPgg1h3zRhABL8dA3BNvkXJU`); www answers (307 → /sign-in, the
auth gate, as designed). No content-match grep was possible: /coach is behind the login
and the demo's six-month window renders every pinned string byte-identical by
construction — the changed behaviour lives in the short-history branches, which the
3-month Prisma lock executed against the real engine.

## ✅ BUILT 2026-08-04 — C.8: /calendar places each card and loan due in EVERY month (DECISIONS #404, audit P0-3)

`buildCashFlowCalendar` used to window-gate the ONE obligation the engines emit
per card/loan, so every month but the due month printed "0 payments due across 0
dates" under a footnote promising each due day is badged — September understated
the owner's committed outflow by ~$25,000. Now the engine SYNTHESIZES future
cycles inside the month window: cards repeat monthly from the RAW issuer due date,
business-day re-adjusted per occurrence, priced at the statement basis
(`cycleBasisCents ?? cashRequiredCents`), always `(est.)` — the radar's
`projectCardDues` rule for rule; loans repeat their fixed issuer-reported payment,
never `(est.)`, from the same raw anchor /forecast expands. New REQUIRED params
`today` + `holidays`. Current-month events are untouched (fail-old locked).

**Critic cycle 1 — FAIL, 1 P1 + 4 P2, all fixed + locked.** The P1 (F-1): the
synthesized events reused the boolean `isEstimated`, and the frozen disclosure
keyed its amount sentence off it — so a frozen card WITH a statement was told, in
every later month, that its figure was "worked out from the last balance we saw"
while the grid printed the statement basis. Fix: `DueAmountSource`
(`statement | repeated-statement | balance | loan-terms`) computed once in the
engine, carried on `CalendarEvent.amountSource`, mapped verbatim by the page,
branched in `frozenCardsNote` (three sentences) and `frozenCardDatesNote` (a
repeated statement still derives its DATE from the statement).
`FrozenCardRow.isEstimated` replaced by `amountSource`; the six current-cycle call
sites map through one `currentCycleAmountSource()`. Follow-up scoped critic caught
the source logic keying on the page-injected `cycleBasisCents` alone — a bare
statement card would have mislabeled as balance; now keyed on the obligation's own
estimate path. P2s: overclaimed "one date" comment corrected (calendar rolls back
to business days, /forecast prints raw — by design), footnote precision for
estimate-path cards, the F-4 stale-anchor residual recorded in-source, and
phase4.test.ts's `[...cards, ...upcoming]` double-list (a post-C.8
double-synthesis trap) now `result.cards` alone.

**Gate:** `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0,
**5849 unit / 358 files** (21 new: synthesis locks, amountSource locks, the three
F-1 sentence branches + the September real-engine provenance lock), next build
clean. Targeted calendar e2e (calendar-frozen ×6 / duplicate-connections /
phase4-features) **21/21** serially; the calendar-frozen quiet-month lock was
REWRITTEN to the new truth — later months now paint the frozen fact on the
synthesized money; only a PRE-due month is silent. Three unrelated mobile-380 e2e
fail identically on clean HEAD — see the OPEN entry below.

## ✅ BUILT 2026-08-04 — C.25: the mortgage leaves the spending totals in EVERY month, at read time (DECISIONS #403)

The #400 revert direction stood up: nothing stored is written. The exclusion is
computed ONCE in the snapshot assembler (`getFinanceSnapshot`) and inherited by
every flow-summing surface through the shared predicates (`countsInFlows`,
`isSpendRow`, `monthlyFlows`, `spendingByCategory`) via an optional row-id set;
an unwired caller and the demo golden are unchanged by construction.

**The four gates** (`src/lib/engine/categorize/loan-payment-flows.ts`): a row
leaves the flows only when (1) it would otherwise have counted, (2) its
canonical is linked to one loan account by ≥2 DISTINCT pair-months re-derived
at read time (aggregate canonicals refused; the stored flag is not an input,
so it cannot be consulted), (3) that account has a DATEABLE obligation, and
(4) the amount equals an obligation payment. Attribution is PER EDGE (critic
P1-3): a row that paired itself is judged by where its pair lands; an
unpaired month leaves only if EVERY linked account can project — SimpleFIN
and undatable loans keep their money visible.

**Measured on the owner's data** (read-only probe,
`scripts/audit-probes/c25-read-side-exclusion.mts`, first run executed this
session): exactly one merchant edge — Truist Mortg Olb Mtgpmt → Mortgage 1192
@ $6,217.07/mo; April's total drops $6,217.07, July's drops $12,434.14 (two
rows), flagged months unchanged. A row-identity re-run was blocked by a
permissions gate after the first run — recorded, not hidden; the month-level
figures above are the executed evidence.

**Critic cycles 1–3.** Cycle 1 FAIL, five P1s — pace's bill basis dropped the
excluded merchant from BOTH halves, Ask `merchant_spend` joined the one
basis, per-edge attribution, register links REFUSED for categories whose
figure dropped excluded rows (O.5/O.6 link invariant), coach/dashboard name
what left their figures. Cycle 2 FAIL, three P1s — the carry CAPACITY cap
(at most the carried count leaves per canonical/month/amount: the month's
inflows onto eligible accounts or the obligations covering it, whichever is
larger), all-partner eligibility for attributed rows, and Ask disclosure
(engine branch for the lender case + basis sentence on the total intents,
largest-purchase rankings drop excluded rows). Cycle 3 FAIL, one P1 — the
disclosure FACTS now derive from actual exclusions, never eligibility (a
merchant that qualified but kept its rows publishes nothing), and split/
reader-excluded rows can no longer classify a merchant. All locks live in
the three test files below; cycle 3's P2 residuals (aggregate-branch clause,
pending qualifier wording, window-independent Ask sentence, new-merchant
surface) are RECORDED, not fixed.

**Gate:** `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0,
**5828 unit** (30 new: the gates, attribution/capacity shapes, phantom locks,
pace locks, merchant_spend basis, assembler wiring on a throwaway user + the
demo-golden lock), next build clean. Targeted e2e
(reports/reports-total-reconciles/budgets-basis/trends×3/phase3-coach/ask/
spending-plan×2/dashboard-duplicate-disclosure): **39/41** — the two
`dashboard-duplicate-disclosure` mobile-380 failures reproduce IDENTICALLY on
clean HEAD (stash-verified this session), so they predate this slice; see the
OPEN entry below.

**Deploy:** `d4347c6` → GitHub deployment `aimplifi-38lifklki-reiforge`
state `success` (Production), www.aimplifi.app `/sign-in` byte-identical to
the deployment URL this session (cmp). No demo figure moves by construction
(the seed's exclusion set is empty), so the sha-match + content-match is the
live proof, as with C.24.

## ⚠️ OPEN 2026-08-04 — three more mobile-380 e2e fail on clean HEAD (predates C.8)

Found while running C.8's targeted e2e; stash/run/pop on clean HEAD (`87f0f08`)
reproduced all three IDENTICALLY, so the C.8 slice did not cause them:

- `tests/e2e/auth.spec.ts:82` — "first manual account → dashboard explains its
  sparse cards (no bare $0.00)" (mobile-380)
- `tests/e2e/today-feed-frozen.spec.ts:220` — "an UNDATABLE frozen loan finally
  reaches the all-clear" (mobile-380)
- `tests/e2e/today-feed-frozen.spec.ts:238` — "the undatable loan is still named
  when another payment IS due" (mobile-380)

All three pass on desktop projects; `phase4-features.spec.ts:33` also failed once
in a parallel run but passes alone and serially (known parallel-flake class).
Not diagnosed.

**Reproduced again 2026-08-04 (C.12 session), same stash/run/pop method on
clean HEAD (`fec663a`): the two today-feed-frozen tests fail identically, AND
a third spec joined them — `tests/e2e/frozen-figure-surfaces.spec.ts:92` "the
surfaces that print a frozen figure now say so — /cards, Ask and /coach"
(mobile-380).** The failure mode is visible in the page snapshot: the custom
seeds render the feed's copy ("Nothing needs you today. Your bank stopped
sharing Home Mortgage…") but NOT inside the `payment-reminders-card` testid
the specs query, and the copy no longer starts "You're all caught up" — the
feed component drifted from both specs after O.3 (`c336b38`). The drift is
testid-and-copy, not the seeded data (the mortgage is named correctly on
screen). C.12 did not cause any of the three.

## ⚠️ OPEN 2026-08-04 — dashboard-duplicate-disclosure mobile e2e fails on clean HEAD (predates C.25)

`tests/e2e/dashboard-duplicate-disclosure.spec.ts` mobile-380 variants fail
with zero `reminder-row` elements (expected 2) — reproduced on unmodified
`main` (8c5b3fe) this session by stash/run/pop, so the C.25 slice did not
cause them. Desktop variants pass. Not diagnosed; likely a date-window or
mobile-layout drift against the seed's asOf.

## ✅ BUILT 2026-08-03 — C.24: the transfer-flagged mortgage counts once, at its full rate (DECISIONS #394)

Audit P1-13, measured live in C.0/#393: the owner's $6,217.07 Truist mortgage
was transfer-flagged only in months the linked MORTGAGE account's inflow
settled ≤3 days out, so it vanished from both halves of the Fixed union —
rollup fragment "rent $2,072.36", no series, Fixed ~$4,145/mo under.

The class is now STRUCTURAL (`loanPaymentMerchantCanonicals`: flagged cash
outflow whose ±3-day same-|amount| pair sits on a linked LOAN/MORTGAGE
account; per-merchant; aggregate canonicals refused). Detection keeps the
flagged rows (auto-loan precedent); the rollup/median exclusions read only
the UNIONED set (the exactness invariant: excluded ⇔ unioned — a merchant
detection cannot series, e.g. an escrow-adjusted amount, keeps its counted
rows instead of vanishing); the union adds the series at its monthly rate
unconditionally except the settlement-NEVER set and reader-priced (budget)
categories. Loan-side rows come from a targeted POSTED/USD query — the
snapshot keeps withholding loan activity (#62). /budgets reads the plan's
exclusion set, so the two surfaces print one basis.

Production replay (`scripts/audit-probes/mortgage-replay.mts`, read-only):
structural set = exactly {Truist Mortg Olb Mtgpmt}; rollup $9,785.24 →
$7,712.88 (the fragment gone); union +$6,217.07; **suggested Fixed
$9,785.24 → $13,929.95**; per-item trace matches the real function.

Gate: `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0, **5731
unit / 350 files** (21 pure + 3 real-server locks new), next build clean.
Targeted e2e `spending-plan.spec.ts` + `budgets-basis.spec.ts` **2/2** (demo
figures unchanged — the seed's loan account has no transactions, so the
structural set is empty on the golden dataset). Critic cycle 1 FAIL (4 P1 — F1
vanish-on-detection-failure, F2 budget double-price, F3 aggregate strip, F5
query guards), all fixed and locked; cycle 2 self-critic PASS (the
fresh-context subagent died on an account quota 403 — recorded, not hidden).

**Deploy:** `217147d` → Vercel `aimplifi-ptgrkst2j` **READY**, sha-matched via
the GitHub deployment status on the exact commit, www aliased. No UI marker by
construction (demo unchanged); the sha-match is the live proof.

**Residuals → TASKS C.25:** the radar, the stored-series refresh (and with it
/calendar, cash-needed, the L.30 census) still cannot see the bill the plan
now reserves, and the unflagged mortgage months still feed discretionary
burn; the month totals still see a lumpy mortgage (July counts in flows,
May/June don't — same root flag, out of this slice's Fixed scope).

## ✅ BUILT 2026-08-02 — C.3: Dashboard Trends card names divisor, assumption, mover window (DECISIONS #387)

Wave C P1-2 / P1-3 / P1-5. The dashboard card now prints "in the first N days",
the shared `PACE_ASSUMPTION` line, a muted (not green/rose) pace comparison with
a real zero-delta branch, and `(Jul '26 vs Apr '26–Jun '26 average)` on Biggest
change. The projected dollar is unchanged — that is C.2.

**Deliberately left to other rows:** C.1 (zero-spend abstention, Opus), C.2
(bill-calendar pace model, Fable), `/trends` pace colour (task named the
dashboard card).

Gate: `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0, **5636
unit / 345 files**, build clean; `trends.spec.ts` e2e **3/3**. Empty `prisma/`
diff.

**Deploy:** Vercel `aimplifi-nklnbw1pe` **READY** on `8511e9d`, www aliased.
Live demo /dashboard: `dashboard-trends-pace-days` ("in the first 10 days"),
`dashboard-trends-pace-assumption` ("a projection, not a prediction"),
`dashboard-trends-mover-window` ("May '26 vs Feb '26–Apr '26 average"), muted.

## ⚠️ OPEN 2026-08-02 — `ledger.ts` truncates a multi-line body to its FIRST LINE, and reports success

Found by using the tool: writing this session's PROGRESS entry via
`tsx scripts/ledger.ts progress "<title>" "<body>"` wrote **one line** of a
70-line body and printed `PROGRESS.md: prepended "…"`. The entry was repaired
with an editor; nothing is currently lost.

Not a quoting mistake on the caller's side — it is the process boundary. Probe:

```
$ npx tsx -e 'console.log(JSON.stringify(process.argv[1]))' "$(printf 'line one\nline two\n')"
"line one"
```

So every `ledger.ts` subcommand that takes prose as an ARGUMENT (`progress`,
`decision`, `regression`) silently keeps the first line on Windows. Same family
as #386 — a ledger script losing content while reporting that it wrote it —
which is why it is filed the day #386 closed rather than folded into it.

**Until fixed:** append to the ledgers with a heredoc into the file (`cat >> … <<
'EOF'`), which goes through stdin and is unaffected, or use an editor; then run
`tsx scripts/ledger.ts reindex`, which reads files rather than arguments and is
now safe. This is the same class `docs/lessons/windows-codegen-via-shell.md`
already warns about.

**Fix when picked up:** read prose from stdin or a `--file` path instead of
argv, and refuse to write a body that arrives shorter than some floor without
saying so. A script that can write less than it was given must not print success.

## ✅ CLOSED 2026-08-02 — `scripts/ledger.ts reindex` is safe to run (DECISIONS #386)

Was: the script parsed only the legacy pipe-table rows (#1–#337) and was blind to
the `## #N — title` sections every decision since #338 uses, so regenerating wrote
329 rows where 375 belong — and the header it generates prescribes that exact
command, which is how a Cursor agent deleted #374–#382 in good faith during #384.
34 decisions (#338–#373) were still absent when this session measured.

Now: `scripts/ledger-parse.ts` reads both formats (including the bare `## #354`
shape, whose summary comes from its first bold body line), and **regenerating
refuses to write if it would drop any number the index already carries** — it
throws, names every one, and leaves the file untouched. The second half is the
real fix: the next format the parser fails to understand fails in the terminal
instead of in the file. `nextDecisionNumber` was blind the same way and would
have returned 338, a number already used; it now counts both formats.

**376 of 376 decisions indexed, exactly one row each**, asserted against the real
committed files by `tests/unit/ledger-decisions-index.test.ts`. Residual, filed
not waived: `ledger.ts decision` still appends a legacy TABLE row while sessions
hand-write heading sections — the number is right, the shape is not.

## ✅ BUILT 2026-08-01 — Home polish + guilt-free without card pay (DECISIONS #369)

Owner: cluttered Home; Plan math treated card pay as fixed; transactions buried.
Shipped: three-term guilt-free (`income − fixed − savings`); card dues stay on cash-needed
only; Home = guilt-free → cash needed → recent transactions (needs-file) → Today → banners →
Radar → net worth. Ask / top spending / trends / recurring / reminders / savings-rate left
their own routes.

Gate: tsc 0, eslint 0, **5549 unit / 335 files**, next build clean; targeted e2e 25/25
(phase1 + spending-plan-month-edge + ask). Empty `prisma/` diff.

**Deploy:** Vercel `dpl_5Hn8UXcy64hpzsaFeYfYxcAkyWNJ` **READY** on `2e3bf72`, www aliased.
Live demo /dashboard: guilt-free `$2,215.00` with “after fixed costs”, recent strip +
“merchants need filing”, cash-needed `$5,412.33`; top-spending/Ask cards absent.
Live /spending-plan: no “Card payments due this month” row; basis notes card pay is not
subtracted.

## ✅ BUILT 2026-08-01 — W.12: the FI card names the real rate once (DECISIONS #368)

After W.2 the same 4.50% appeared four times in four wordings and the new basis
paragraph pushed the payoff (`freedom-dividend`) past an 800px viewport. Headline,
Coast and payoff now defer with "under this card's return assumptions" (or silence)
and never restate a `xx.xx%`; the payoff sits ABOVE the basis so a scanner sees it
first. `fiProjectionBasis` remains the sole namer of both dials and the derived
real rate. The opt-in volatility disclosure still names both rates — deliberate.

Gate: `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0, **5549 unit /
335 files**, build clean; empty `prisma/` diff. phase3-coach e2e 1/1 (painted order
+ absence of 4.50% outside the basis). Self-review on the money-copy axis; 0 P0/P1.

**Deploy:** Vercel `dpl_5USJrJk5WskcN1NJbKV9Pm1rHSpo` **READY** on `cd46ef1`
(code `716e529`), www aliased. Live demo /coach: years contains "this card's
return assumptions", years/payoff/coast lack 4.50%, basis has 4.50%, payoff
y=430 < basis y=506.

## ✅ BUILT 2026-08-01 — W.13: the return dial is no longer called the reader's (DECISIONS #367)

`User.expectedReturnBps` is `Int @default(700)` and NOT nullable, and the /settings field is
required and pre-filled — so a reader who has never opened that page still carries the app's own
7.00%, and six sentences across three cards called it **"your 7.00% return assumption"**. The
wealth card said it outright: *"7.00% return is your setting; 2.50% inflation is Aimplifi's
default, which you haven't changed"* — one sentence attributing one dial correctly and the other
falsely, shipped for four slices, live on the demo.

**Decided by VALUE, not by a new column.** There is no stored "unset" to read the way
`inflationIsDefault` reads a null column, and making the column nullable would describe none of
the rows already in the database (every one holds 700), so `returnIsAppDefault(bps)` is
`bps === DEFAULT_EXPECTED_RETURN_BPS`. The one reachable error — a reader who deliberately typed
7 is told 7.00% is our default — runs in the safe direction and is pinned in
`tests/unit/return-dial-default.test.ts` so it cannot be re-litigated as a bug. The copy claims
only what the equality proves: **"our default 7.00% return assumption"**, never "which you
haven't changed" (true for the nullable inflation column, unprovable for this one).

Both flags now travel as one `DialOwnership` object rather than two positional booleans, because
`boolean` and `boolean` are indistinguishable to tsc and a swap would put each dial's possessive
on the other dial's rate. Surfaces changed: the FI card's projection basis, the opportunity
list's basis, the wealth card's basis / dials / sensitivity intro / required-contribution, and
/investments' retirement outlook. Each has a RENDERED lock (a unit test on a copy function cannot
see the page handing over the wrong answer); the /investments path was mutation-proven through a
rebuild.

**Deliberately unchanged, enumerated rather than overlooked:** `/goals` (×3) and the Goals
empty state say "assuming your current savings rate and expected return" — no rate is printed
and the phrase means the settings that apply to the reader's plan, so there is no number whose
provenance a reader could question; `money-dials-form` says "your expected return" twice while
the reader is editing that very field, and now carries "The 7% here is our default." beside it so
the page /coach links to says what /coach says. `COACH_COPY.opportunity`'s "your 0.00% return
assumption" is untouched because that branch is `nominalReturnBps === 0` and the app's default is
700 — a possessive kept true by arithmetic, asserted about the constant rather than left in a
comment.

## ✅ BUILT 2026-08-01 — W.11: FI slider first paint is the unchanged branch (DECISIONS #364)

An 85% saver used to see "Lowering your savings rate from 85.0% to 70.0%…" on first paint
because the thumb was hard-clamped to 70% while the caption compared against the real pace.
Ceiling is now `Math.max(7000, currentRateBps)`; initial thumb = current pace; both bounds
share `fi-slider-bounds.ts`. W.12 (rate-copy accretion) shipped — see its section above.

### Critic / locks

Self-review against the money-copy axis (small, mechanical slice — no separate critic
subagent). Fail-old pin of the hard clamp; unit lock that an 85% first paint says "current
pace" and does not leak the mixed year pair; e2e asserts the same on the painted card.
Gate: `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0, **5511 unit / 334
files**, build clean; empty `prisma/` diff. phase3-coach e2e 1/1.

**Deploy:** Vercel `dpl_847yTgBW9j1VFh3vCyRrU9vw6CEC` **READY** on `b1f9600`, www
aliased. Live demo /coach first paint: "This is your current pace (23.4%…)" — no
Lowering/Raising; slider `max` stays 7000 for the demo (pace < 70%).

## ✅ BUILT 2026-08-01 — W.10: the opportunity list is in today's money (DECISIONS #363)

Opened by the W.2 money critic: /coach's "Worth a look" rows printed 30-year
NOMINAL future values ("$X of future wealth … assuming 7.00%") one scroll below
the FI card that had just moved into today's money. At the shipped defaults
$500/mo read as **$609,985.50** where it buys **$290,806.13** of today's goods.

**Decision that took two critic cycles.** Two today's-money figures exist and
differ by ~23%: (A) compound at the REAL rate (level in today's dollars,
$379,693.07) or (B) compound at the NOMINAL dial and deflate the whole total
(level in nominal dollars, $290,806.13). **(A) shipped first and was wrong** —
two independent critics killed it on `negotiable-bill`, a hard-coded flat
$20/mo retention offer, so "the price would have risen" is a claim about a
price that does not exist. (B) is conservative for every kind, and its premise
is the literal sentence beside the figure.

Also fixed: two of four row kinds ran a colon into "is $X" and had never
parsed; a zero-return dial no longer credits compounding with the deposits;
the basis sentence has three branches for the dial edges `validateDials`
permits. Two contribution conventions now coexist on /coach deliberately —
the FI card's monthly figures are level-real; this list is flat-nominal —
each stating its own model.

### OPEN / stated limitations

- **`User.expectedReturnBps` is non-nullable with a DB default of 700**, so the
  copy calls 7.00% "your return assumption" for a reader who has never opened
  /settings. The possessive `inflationIsDefault` exists to prevent this for the
  *other* dial. Pre-existing and identical on two other cards; fixing it here
  alone would make three cards disagree. Filed as **W.13**.
- **W.12** (rate-copy accretion) and **W.11** (slider first paint) both shipped
  2026-08-01 — see their sections above.

### Critic cycle

Two fresh-context critics across two cycles, both FAIL on the first model,
converging independently on the indexed-contribution overstatement and the
floored-real-rate copy lie. All P0/P1 fixed and locked (golden sentence, model
gap pin, e2e golden dollar figure `$20,350.61` for the demo's LA Fitness).
Gate: `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0,
**5504 unit / 333 files**, build clean; empty `prisma/` diff (no schema change).
First vitest pass under the parallel verify run hit 6 SQLite `database is locked`
flakes (known contention class); isolated re-run of those files 522/522, then
full suite alone 5504/5504, then clean verify 5504/5504. E2E golden
`$20,350.61 in today's money over 30 years` locked in `phase3-coach.spec.ts`
(7/7 with auth.spec).

**Deploy:** Vercel `dpl_9qp3dkEUNLRs1W7httzq4P58JMUV` **READY** on
`db2a5e1`, target production, aliased to www.aimplifi.app (GitHub Production
deployment sha `db2a5e1`). Live marker via demo sign-in on /coach:
`$20,350.61 in today's money over 30 years` present; old `"future wealth"`
absent; `data-testid="opportunities-basis"` rendered.

## ✅ BUILT 2026-08-01 — O.20: every bar on the /reports chart opens the rows behind it (DECISIONS #362)

Owner, 2026-08-01: *"every single bar and collection of categories needs to be immediately
available … essentially you are filtering transactions … why is this so hard, you're not
recreating wheel … mint and simplify both do this."*

**What was actually missing.** Twelve surfaces already drilled into transactions (every
category row on /reports, /trends and /budgets — name, figure and inline bar — plus the O.18
expandable panels). The CHART did not, and it is the first thing on the page. W.3 had filed the
charts as a deliberate refusal, and **its own enumeration was incomplete**: it named four
Recharts files when there are seven, plus six more surfaces drawing hand-rolled bars.

Tapping an income or spending bar now opens the transactions that bar is made of, inline, with
the register offered in the footer. Six month buttons under the chart reach the same panels —
the bars are SVG rectangles and cannot be focused, so the buttons are the accessible path and
the bar tap is an accelerator.

**Built on the flows predicate, not the category one.** `buildMonthFlowBreakdowns` selects rows
through `monthlyFlows`' own exported predicates, and `getReports` hands both breakdown families
the same array, so a bar and its rows cannot describe different sets. The register link claims
only a WINDOW: no `type=expense` filter, because that drops the refunds the bar netted and keeps
the pending rows it never saw.

### OPEN / stated limitations

- **/reports prints one month's spending twice, on two bases, and they differ.** The bars are
  posted-only; the "Spending by category" card counts pending charges. Measured on the demo at
  **$299.93** for the current month. Each panel states its own basis and a new sentence names the
  DIRECTION of the gap — but it deliberately names no mechanism, because at least five rules
  separate the two figures and a critic falsified the "pending charges" explanation in both
  directions. Unifying the two bases is a bigger decision, filed as **O.20a**.
- **The /reports payload now carries six months of rows instead of one.** `monthFlows` ships the
  rows behind all twelve bars so the panels can reconcile without a second query. Roughly a 6×
  increase in this route's RSC payload; not measured against a heavy real account. Filed as
  **O.20b**.
- **Two unfiled deposits that look identical land on opposite sides.** A positive row with no
  category counts as income; one filed to `uncategorized` nets against spending. That is
  pre-existing engine behaviour which this panel now makes visible; both basis sentences name it
  rather than pretending there is one rule. Filed as **O.20c**.
- **Still not drillable:** /coach's hand-rolled discretionary bars, /trends "New this month"
  (O.18e), /recurring rows (O.18c), and the three charts that are not transaction sets at all —
  net worth, forecast, and the investments allocation bar, which want a panel showing what they
  ARE made of rather than a transaction filter. Filed as **O.20d**.

### Critic cycle

Two fresh-context critics, **both FAIL** (3 P1 and 4 P1 respectively), converging independently
on two findings: the clamp sentence printed *"outran purchases by −$80.00"* — a double negative
asserting the opposite of the truth — and three positional claims pointed the wrong way. The
deepest was the flow SPLIT: the basis sentence described it as a rule about refunds, and was
falsified by rows rendered inside the panel it described. The two critics disagreed about which
way an unfiled deposit goes, and **executing the predicate settled it** — both were half right.
All P1s fixed and locked; the sign bug is now impossible by construction rather than correct by
argument. Gate: **5481 unit / 333 files**, tsc 0, eslint 0, build clean; 10/10 on the affected
e2e specs, 14/14 mobile-overflow.

## ✅ BUILT 2026-08-01 — W.2 + W.9: the FI card's dates are in today's money (DECISIONS #361)

**Every FI date on /coach used to arrive early, by the whole inflation gap.** The FI number is
built from the reader's own last six complete months of spending — a figure in today's dollars
— and the server grew the portfolio toward it at the NOMINAL return dial. Comparing future
nominal dollars against a present-value target is a unit mismatch, and it errs in one
direction only. At the default dials that is 7.00% against 4.50%: decades on a long horizon.
The projections now compound at the real rate, so **dates move LATER** and /coach carries one
basis instead of two. W.9 landed with it: the Coast line's "25 years" now says the app chose
it, not the reader.

**Two fresh-context hostile critics, both FAIL, seven P1s, converging independently on two.**
All fixed and mutation-proven. The one worth reading twice: `monthsToFI` returns `null` both
for "not saving" and for "saving, but past the 1200-month projection cap", and the card
asserted the first for both — so at a low real rate a reader putting away $500 a month was
told their contributions weren't outpacing their spending. Also fixed: /goals was still
running the identical simulation against the identical target at the nominal rate (181 months
there against 221 on the card the reader had just left); the Coast card's monthly figure had
silently become a today's-dollars instalment that a flat standing order outruns, while new
copy told the reader both cards agreed; and `realReturnBps` was clamped at only one end.

### OPEN / stated limitations

- **One finding deliberately deferred** — W.12 (the same rate is now stated four times in
  four wordings, pushing the payoff line past the fold at 380×800). W.10 and W.11 shipped
  2026-08-01 — see their sections above.
- **The Coast horizon's "reader chose it" branch is unreachable today.** No control sets
  `COAST_TARGET_YEARS`; the flag is a server field rather than a literal so that adding one
  later changes a line instead of a copy branch that has quietly become false. Stated in the
  test so nobody infers a control exists.

### ⚠️ The full e2e gate is RED, and neither failure belongs to this slice

`bash scripts/verify.sh` is GREEN (tsc 0, eslint 0, **5455 unit / 331 files**, build clean).
With `VERIFY_E2E=1` two specs fail, both attributed by execution:

1. **`phase2-triage.spec.ts` "singles mode never leaks onto the next card" — deterministic,
   pre-existing, and probably a LIVE PRODUCT BUG.** It fails alone at `--workers=1` and
   **fails identically on clean HEAD** (verified by `git stash`), so it is on the deployed
   commit. Filing the last row of a singles group through the write-in leaves
   `data-remaining` at 11 when it should read 10 — the group empties but the queue never
   advances, which is exactly the behaviour that spec was written to lock. Filed as **V.4**;
   deliberately NOT fixed here, because it is a state-machine change in the categorization
   path and wants its own diagnosis and critic rather than a ride-along in a money slice.
2. **`category-rename.spec.ts` — the V.1 rotating flake.** Fails in the full parallel run,
   passes alone in 1.4s.

**A process finding filed as V.3, worth more than either.** Three specs failed mid-slice with
/dashboard rendering its "Something went wrong" error boundary — indistinguishable from a P0
in the change under test. The cause was a **leaked `next start` on port 3100**: with
`reuseExistingServer: true`, Playwright served a build predating the fixes, so the fresh
`next build` the gate had just run was ignored. One `taskkill` turned all three green with no
code change. This **contradicts the evidence recorded under V.1**, which reports "nothing is
LISTENING on port 3100 between runs" and treats the leaked-server hypothesis as refuted on
this machine. It is not refuted. `docs/lessons/e2e-runs-a-stale-build.md` has been corrected:
its claim that the full gate is immune because it builds first is false, since building does
not help if the port is occupied.

## 🧭 DECIDED 2026-07-30 — O.15 slice 5 / O.13e: category parity is three questions (DECISIONS #345)

TASKS O.13e bundles three Simplifi capabilities under one row and says to decide
which are real gaps **before** building. This slice is that decision, and the
bundling was the thing to undo — the three share a noun and nothing else.

**(a) Three-level hierarchy — REFUSED, deliberately.** `Category.parentId` has zero
readers and zero writers outside generated Prisma, so nothing is half-built. Six
picker surfaces plus every group-by in reports/trends/budgets/spending-plan render
the 2-level shape, and Simplifi's own example (Auto & Transport -> Registration ->
Registration Fees) is already expressible as a leaf under a group — `auto-registration`
literally is it. Reopens on an owner request naming a distinction two levels cannot
express.

**(b) Explicit Expense/Income type — REAL, DEFERRED, and not a UI toggle.** "Is this
category income?" is answered in **14 places**; only 2 use the shared
`isIncomeCategoryId`. The readers split across two maps — `reports.ts`/`trends.ts`
use the per-user merged meta, the other twelve the static custom-blind
`CATEGORY_BY_ID` — and they agree solely because `NON_CUSTOM_GROUPS` bars a custom
from the Income group. Relaxing that turns `pipeline.ts`'s three #44 sign guards
from a documented exemption into a live defect: an OUTFLOW would file into an income
category, which `isSpendRow` drops from reports/trends/budgets while `monthlyFlows`
still counts it. **This is not hypothetical — it is O.13a critic cycle 1's P0
(`cardone` -> income meeting `CARDONE MGMT FEE -$125.00`), already paid for once.**
Prerequisite: thread per-user meta into `pipeline.ts` and collapse all 14 onto one
custom-aware basis. Weighed against 11 income leaves already shipped, the marginal
capability is small and the blast radius is the auto-filing path.

**(c) Per-category tax flag — REAL, re-routed to rule then-actions (parity row 2).**
Semantics settled on failure direction: a write-time stamp, never a read-time
fallback (which would silently re-tag history a reader may have handed a preparer;
write-time can only under-tag, which is visible). What blocks it as a *category*
column is topology — `applyCategory`, recategorize, keyword-rule apply, backfill,
Plaid and SimpleFIN each write `categoryId` independently, so a per-call-site stamp
is the fence-by-call-site anti-pattern. It belongs on the rule machinery, which
already has counted apply-to-existing and undo.

**Code shipped:** two understated comments corrected in place — `NON_CUSTOM_GROUPS`
now records all 14 dependents across two maps and what breaks in `pipeline.ts` if it
is relaxed; `isIncomeCategoryId`'s "This is THE income test" now says it is one of
fourteen. Behaviour is unchanged by construction.

**Self-correction, recorded:** the first draft of this finding claimed the exclusion
was an unlocked invariant. It is locked fail-old by
`tests/unit/custom-category-lifecycle.test.ts:82` ("refuses the Income and Transfers
groups"). Reading the test is what corrected it; the real defect was the narrower one
that shipped.

Gate: `bash scripts/verify.sh` — tsc 0, eslint 0, build clean, **5038 unit / 316
files**, identical to slice 4's baseline, which is the evidence that nothing
behavioural moved. No `prisma/` diff, so the live database is untouched.

### 🟠 OPEN, carried forward from this decision

1. **The 14 income predicates are still 14.** Consolidation onto one custom-aware
   basis is the named prerequisite for (b) and is not done. Until it is, the
   `NON_CUSTOM_GROUPS` exclusion is what holds reports/trends and the other twelve
   readers in agreement.
2. **Per-category tax defaults do not exist**; the reader still tags every row by
   hand. Now tracked under parity row 2 rather than O.13e.

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

## O.17b — DECIDED: removing a category does not stop the categorizer (2026-07-31, DECISIONS #352)

**No code change.** The behaviour question is closed: "Remove" stays a picker preference, and the
disclosure O.17 added is the resolution rather than a placeholder. Reasons in full in DECISIONS
#352; the short version is that one of the two proposed destinations does not exist
(`Category.parentId` has never been populated; `group` is a string, not an assignable row), and the
other — `uncategorized` — discards knowledge the engine had, asserts a false "we don't know", fills
the triage queue as a *consequence* of the reader asking to see less, and silently merges two
meanings of the needs-review class across four downstream consumers.

**Checked and NOT found while deciding:** the suspected silent mis-file — a `<select>` whose value
is absent from its own options, the #166/#170 shape — is not present. `transaction-detail-view.tsx`
falls back to an explicit "Choose a category…" placeholder when a row's category is hidden, so
saving requires a deliberate choice. Recorded because it was the concrete fear underneath the
question, and it is answered.

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

**Deploy-verified.** `npx vercel ls aimplifi --meta githubCommitSha=926e94c…` returns exactly
one production deployment, `aimplifi-kdwy902zz`, status ● Ready — and `npx vercel inspect` on it
lists `https://www.aimplifi.app` among its aliases. The commit-sha filter is the proof rather
than a 200: an old deployment answers 200 perfectly well.

## W.10a critic cycle — the owed independent pass (2026-08-01, DECISIONS #366)

#365 shipped W.10a and recorded that both cycle-2 critics had died on a platform session limit,
so the findings came from running their assignment by hand and an independent pass was owed.
This is that pass, from a fresh context.

### The branches held

Every claim #365 makes about `opportunityBasis` survives execution over the whole permitted dial
grid (return 0–15.00%, inflation 0–10.00%, 25bps steps):

- The `trails` array is always a **prefix** — 0 of 2,501 pairs trail at a longer horizon without
  trailing at every shorter one. The mixed branch's "the shorter horizons" was an unproven
  monotonicity claim when it shipped, and it is true. Exactly four patterns occur:
  `[F,F,F]` ×1,037, `[T,T,T]` ×1,315, `[T,F,F]` ×84, `[T,T,F]` ×65.
- "at or below" survives the **rounded display**: 0 violations at five amounts down to $0.01/mo,
  with 12 exact ties — the knife-edge #365 predicted.
- The sentence is gated on the same rate pair the rows were computed with, and no other surface
  prints these figures.

### The P1, one function above

`COACH_COPY.opportunity` — the ROW sentence, which prints all three figures — still ended
"compounding does the work, not willpower", guarded only by `nominalReturnBps === 0`. #363 had
recorded the reasoning for that guard explicitly: *"the only degenerate input is the reader's own
0.00% return dial."* W.10a's sweep is a disproof of that sentence, and it was applied to the
paragraph while the claim one function above was left standing.

Of the **2,400 non-zero** dial pairs `validateDials` permits, **1,275 put every printed figure at
or below the dollars handed over** and 149 more put one or two there. At 10.25%/10.00% a $50/mo
row printed **$6,833.08 against $18,000 paid in** and credited compounding with it. Reachable from
the DEFAULT return dial: keep 7.00% and set inflation to 3.75% and the ten-year figure trails; at
4.25% all three do. The card contradicted itself — the row crediting compounding, the paragraph
beneath saying inflation took more than the growth added.

Fixed by `opportunityRowTrailsContributions`, which reads the row's **printed integers** rather
than re-deriving from the dials. The trailing branch drops the payoff and adds nothing in its
place; the paragraph carrying the explanation renders under the identical gate.

A test was certifying the defect: the zero-return test closed with *"…and the ordinary branch
still says it"* on a fixture whose ten-year figure was itself below its own contributions. The
fixture now carries real 7.00%/2.50% figures.

### Gate

`bash scripts/verify.sh` → **VERIFY GREEN**: tsc 0, eslint 0, **5518 unit / 334 files** (from
5513/334), build clean. `phase3-coach.spec.ts` 1/1 serially on that build, with a new render-site
assertion that the demo — a pair where nothing trails — still shows the clause.

Both new locks mutation-proven in both directions: disabling the guard kills two tests, forcing
it to fire always kills three.

### Residual, not fixed

A $0.01/mo row ties its contributions at ten years for 12 dial pairs where the list sentence
stays silent. No opportunity kind can mint a row that small (the smallest is a detected series or
a hard-coded $20.00 retention offer), and a figure equal to the deposits does not read as a bug
the way one below them does.
