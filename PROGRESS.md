> Sessions from 2026-06/2026-07 were moved verbatim to
> `docs/archive/PROGRESS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04, and
> sessions from 2026-08-01 through 2026-08-17 to
> `docs/archive/PROGRESS_ARCHIVE_2026-08-01_to_2026-08-17.md` on 2026-08-28.
> Only the current wave (2026-08-20 onward) lives here; append new sessions
> at the top as before.

## 2026-08-28 — Ledger rotation part 3: PROGRESS + ceiling convention (Wave D.1)

**Picked up.** Owner: "continue." Last slice left D.1/D.2 OPEN: the
REGRESSION + TASKS rotations were shipped (`ee5acd72`) but the ~40 KB
ceiling convention, the PROGRESS rotation, and the CLAUDE.md DECISIONS
pointer were not.

**Done (verbatim moves, nothing deleted).** PROGRESS.md 389 KB → 69 KB:
80 sessions dated 2026-08-01..08-17 →
`docs/archive/PROGRESS_ARCHIVE_2026-08-01_to_2026-08-17.md`; the current
wave (2026-08-20 onward, 36 sessions) stays live — same cut as the
REGRESSION rotation. Fidelity: live+archive session bodies
byte-identical to the pre-cut file (sorted-line not needed; concat
round-trip). Reader scan before cutting: `scripts/ledger.ts` prepends
after line 1 (unaffected — it does not read archives); `docs-lint.ts`
exempts `PROGRESS.md` by name and already walks `docs/archive/**`; two
unit comments cite a date, not a line. `tsx scripts/ledger.ts progress`
was not used (argv truncation lesson).

**Convention.** CLAUDE.md conventions now state the ~40 KB live-ledger
ceiling and that rotating older-than-current-wave entries into
`docs/archive/` is part of a slice's close. GRAPH.md §3 and the
DECISIONS_INDEX pointer name the archive layout. Live files still
exceed the ceiling (DECISIONS is D.2; STATUS/TASKS shrink on later
close rotations) — the rule is now written, not yet fully met.

**D.1 closed.** Both named actions (rotate older-than-current-wave,
write the ceiling) are done. D.2 remains OPEN: newest ~50 live and a
strictly one-line index; the CLAUDE.md pointer is now updated.

**Gate.** Docs-only; `docs-lint` is the local check. `verify.sh` not
run locally (same as the 08-27 rotations). CI verify is the ship gate.

## 2026-08-27 — Ledger rotation part 2: REGRESSION_LEDGER + TASKS (owner-approved follow-up)

**Done (verbatim moves, nothing deleted).** REGRESSION_LEDGER.md 244 KB → 33 KB:
rows dated 2026-08-01..08-17 (152 rows) →
`docs/archive/REGRESSION_LEDGER_ARCHIVE_2026-08-01_to_2026-08-17.md`; the current
wave (2026-08-20 onward, 59 rows) stays live. TASKS.md 339 KB → 146 KB: the 88
completed `[x]` table rows → appended verbatim to
`docs/archive/TASKS_DONE_ARCHIVE.md` (with a dated provenance comment), per the
file's own header rule; all 32 wave sections and every open/partial/blocked row
untouched. Wave D rows D.1/D.2 stay OPEN with dated partial-progress notes — the
rotations are done but their ceiling-convention and CLAUDE.md-pointer sub-asks are
not, and claiming [x] would be fabrication. Reader scan BEFORE cutting this time
(last session's lesson): only ledger.ts (appends at END — unaffected) and
docs-lint exemptions reference these files; no parity gate exists for either.
Fidelity: REGRESSION body lines byte-identical across live+archive (sorted-line
diff; only the archive's re-added table header differs); TASKS diff = exactly the
88 row deletions + the header-note line; section count 32 = 32; archive rows
sorted-diff identical.

**Result.** Live ledger set now: DECISIONS 502 KB, PROGRESS ~400 KB, TASKS 146
KB, STATUS 105 KB, REGRESSION 33 KB. docs-lint clean. Docs-only; verify.sh not
run locally (Windows e2e artifact); CI verify is the ship gate.

## 2026-08-27 — Ledger rotation: DECISIONS #1–#401 and STATUS 2026-08 BUILT history archived

**Why.** Owner flagged that coding-CLI sessions are costing noticeably more
tokens. Measurement this session: the mandatory canon stack (AGENTS +
GRAPH_ENGINEERING + LOOP_ENGINEERING + GRAPH + CLAUDE) is ~54 KB before any
code is read, and the five ledgers together were ~3.2 MB (~800k tokens) —
past any context window, so any ritual full-read blows the budget.
DECISIONS.md (1.59 MB, never rotated) and STATUS.md (back to 557 KB two
weeks after its first rotation) were the worst.

**Done (verbatim moves, nothing deleted).** DECISIONS entries #1–#401 →
`docs/archive/DECISIONS_ARCHIVE_1_to_401.md`; #402–#524 stay live (the
#523/#524 table rows keep a re-added table header — scaffolding, not
content). STATUS ✅ BUILT/CLOSED 2026-08 sections →
`docs/archive/STATUS_ARCHIVE_2026-08.md`; all OPEN/DECIDED/record sections
stay live, and the newest BUILT entry stays as the home of the live counts
(the file's stated role). Both live files carry pointer banners matching the
2026-08-04 PROGRESS/STATUS precedent; `> **HISTORICAL**` banners on the
archives per docs-lint check 3. Fidelity proven by byte arithmetic (every
original byte accounted for after LF normalization) and by entry-set diff:
all 512 decision entries present exactly once; all 153 STATUS sections
present exactly once. No code touched — verify.sh not run (docs-only slice);
docs-lint clean. Interleave note: the parallel session committed #524
(6dc9c5a7, a79b84f0) mid-rotation; its STATUS/PROGRESS entries landed
cleanly on the trimmed files and are preserved.

**Result.** DECISIONS.md 1.59 MB → 502 KB; STATUS.md 557 KB → 105 KB;
combined ritual-read risk cut by ~1.54 MB (~385k tokens). REGRESSION_LEDGER
(243 KB) and TASKS.md (339 KB) intentionally left for a future rotation —
this slice was scoped to the two the owner approved.

**Addendum — the rotation broke a gate I didn't know existed, fixed same
session.** `tests/unit/ledger-decisions-index.test.ts` enforces
DECISIONS.md ↔ DECISIONS_INDEX.md parity (the anti-deletion lock built
after a Cursor agent once dropped 46 decisions), and `scripts/ledger.ts`
reindex/next-number read only the live file. CI on the rotation commit
(38b09865) went red: 390 archived numbers read as "dropped". Fix (no test
weakened — the invariant now reads the live+archive UNION, which is the
same no-loss guarantee over the new file layout): `decisionSources()` in
ledger.ts globs `docs/archive/DECISIONS_ARCHIVE_*.md`; the test reads the
union and gains an archive-glob-nonempty guard so a future rename can't
silently weaken it; index header + REGRESSION_LEDGER row updated. Lesson:
AGENTS.md's ledger list does not name DECISIONS_INDEX.md — grep the repo
for readers of a file before restructuring it (`grep -rln 'DECISIONS\.md'
tests/ scripts/` would have caught this pre-push).

## 2026-08-27 — C5 time-window line on the life-energy card (DECISIONS #524)

**Picked up.** Owner: "continue." #523 closed C2 and named this next:
the C5 partial's last named gap — §3's "no … time-window-of-life
framing", the one-line's "buy experiences while you can". An explorer
sweep confirmed the premise: §6's two C5 sentences (dials line,
P2.2 memory-dividend reflection) are both in the tree; P1.1's dial
tags shipped before #503 (which closed P1.1 as a skip); no
"window of life"/"while you can" string exists anywhere in src.

**Closed (engine picker + life-energy card).** Pure
`windowLineFor(itemCount)` returns `COACH_COPY.experiencesWindow()`
only when the life-energy card has a purchase; `0 ⇒ null` — the
empty card's own "No large purchases…" state stays the only claim
(absence rule, as CL4/CL5). Renders under the P2.2 reflection,
`data-testid="life-energy-window"`. Copy word-locked: no reader
age/health claim (none stored, #518), no numerals, no imperative, no
Aimplifi read-path claim, no #503 restatement. Placement = the plan's
own C5 surface (P2.2 row names the card); the opportunities-header
paragraph rejected — savings-cuts card, and dials-gating would hide
the line from every reader who never set a dial while the window is
true of everyone (recorded as alternative (a) in #524).

**Critic (fresh context): cycle 1 PASS — 0 P0, 0 P1** (reproduced all
gates; audit-confirmed premise/placement/copy/gate/tests/regression
independently). Its three P2s fixed before ship: #524 row's P1.1
citation corrected; "Money keeps" → "Money lasts" (first-parse
clarity); rendered-negative locked on the zero-purchase fixture in
`auth.spec.ts` (critic's own suggested line).

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN
(tsc 0, probes tsc 0, eslint 0, `next build` clean). Unit **7,853
passed + 1 expected fail + 1 skipped / 477 files**. E2E: phase3-coach
1/1 + auth sparse-cards 1/1 (rendered-negative) on the fresh build.
EDGE_CASES EW1–EW4 pinned. No `prisma/` diff.

**Gate read.** Pushed `6dc9c5a7`. CI run **33127710694** = SUCCESS
(exit 0 via `scripts/ci-status.sh`). Vercel commit status `success`
on the same sha. Live proof `node scripts/p24-live-deploy-check.mjs`
→ **7/7 PASS** — the window line renders on production demo; the
pre-#524 build lacks the element, so the probe passing is the deploy
proof. Did not submit (shared demo).

**CI note (recorded, not silent).** After this record, the owner's
ledger rotation `38b09865` went to main; its CI ran red (run
33128661995) on exactly the two ledger-index tests — DECISIONS.md
rotated to #402–#524 while DECISIONS_INDEX.md still indexes #1–#401.
A synchronous index rotation belongs to the same owner lane
(docs/archive/ is agent-walled); the reindex guard refuses the drop by
design, so it cannot be papered over by a regeneration.
**Resolved by `a0c390c6`** (owner): decisions-index tooling made
archive-aware (live ∪ archives, no-loss invariant kept); its CI run
33130300577 = SUCCESS, main green.

**Next.** P0.4 "assign to zero" on /budgets (plan marks it optional;
the bucket lens + bands + Ask already shipped; STATUS #524 records it
as the only remaining coach-principles gap). Wave 0 ops remain
owner-blocked. Match % still uncollected.

## 2026-08-27 — C2 cushion line pairs the radar dip on /dashboard (DECISIONS #523)

**Picked up.** Owner: "continue." #522 closed C14; §0 left C2 / C5 / C13
partial. An explorer sweep (fresh code map, not plan verdicts) found the
only unshipped C2 artifact: the §4 Dashboard row's forecast-dip cushion
line — zero code exists (the plan's sentence has no source match; the
pill/invisible-wealth/staying-wealthy/reflection are all shipped). C5's
time-window line and P0.4's assign-to-zero are also open but P2-tier /
plan-optional.

**Closed (engine composer + radar card).** Pure `cushionLineFor(status,
firstNegativeDate, runwayMonths)` — sentence only when the radar prints
a dip (`alert` + date) AND finite positive runway; null for
ok/watch/no-date and for ∞/0/negative/absent. Renders on /dashboard in
the radar card's alert block under the cover box; the today-feed dip row
points at the card ("See Cash Flow Radar below"), so one dip, one
treatment there; /forecast and /calendar are outside the plan's
Dashboard row (scope reading recorded in #523). Same
`coach.runwayMonths` as the pill.

**Critic (fresh context, Opus): cycle 1 FAIL 1 P1; cycle 2 PASS — 0
P0, 0 P1.** The P1: my first draft added "this forecast sees only the
scheduled flows on file" — false of the radar's owned committed walk,
which includes SYNTHESIZED future card cycles (estimated dues,
disclosed one paragraph above). The clause is dropped; plan copy is
near-verbatim. Residual P2s recorded, not re-opens: today-feed row
(adjudicated), cushion basis one card away, ledger row-style.

**Gate (final tree).** `bash scripts/verify.sh` → ✅ VERIFY GREEN
(tsc 0, probes tsc 0, eslint 0, `next build` clean). Unit **7,844
passed + 1 expected fail + 1 skipped / 476 files + 1 skipped**. E2E
cash-flow-radar 1/1 on the fresh build. EDGE_CASES CL1–CL6 pinned. No
`prisma/` diff.

**Gate read.** Pushed `11aefcb8`. CI run **33088573999** = SUCCESS
(~13m14s, first attempt) on that sha. Vercel "Deployment has completed"
on the same sha. Live proof `node scripts/p23-live-deploy-check.mjs`
→ **7/7 PASS** — radar-cushion-line renders on production demo
("…your 5.7-month cushion…"); the pre-#523 build lacks the element, so
the probe passing is the deploy proof. Did not submit (shared demo).

**Process note worth keeping (the p22 clobber).** I wrote my live probe
to `scripts/p22-live-deploy-check.mjs` — a path that was ALREADY a
tracked file: the #502 memory-dividend probe. Write silently replaced
it; the critic flagged it as an "unlisted tree change" and I treated
that as "mine, needs listing" instead of checking `git status` — the
restore came before the commit, but only after the critic's catch. Two
habits worth having always: `git status` before writing to ANY path
that could plausibly exist, and `git log --oneline -- <path>` — or the
probe file is now `p23`.

**Next.** C5 "buy experiences while you can" (P2-tier; the C5 partial's
last named gap). P0.4 assign-to-zero (optional). Wave 0 ops remain
owner-blocked. Match % still uncollected.

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

**Gate read.** Pushed `a589ee21`. CI run **33024387295** = SUCCESS
(~13m51s, first attempt). Vercel `dpl_BcAJZhE7D1bk8kVcGS646Km8GSdv`
Ready on that sha. Live proof **28/28 PASS**
(`scripts/p21-live-deploy-check.mjs`) — the education chip does not
exist in any earlier build, so the probe passing is what proves the
deploy carries this commit. `ci-status.sh` still cannot find `gh` on
the Git bash PATH (same as #521); used `gh run watch` + `gh run view`.

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

