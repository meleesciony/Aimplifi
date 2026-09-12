# STATUS — known limitations & open items

Living document; updated at each phase boundary and critic cycle. In the build graph
(`GRAPH.md` §3) this file is shared state: the open-items field every node reads and
the state-writer edge updates. It is also the only home for live counts (test totals,
rates) — no other doc may restate them.

> Sections through 2026-08-19 live in `docs/archive/STATUS_ARCHIVE_2026-07_to_2026-08-19.md`
> (rotated 2026-09-11); only current-wave BUILT entries and OPEN/FOUND/DECIDED items
> remain here.
>
> Entries from 2026-06/2026-07 (BUILT/CLOSED history) were moved verbatim to
> `docs/archive/STATUS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04, and the 2026-08
> BUILT/CLOSED history to `docs/archive/STATUS_ARCHIVE_2026-08.md` on 2026-08-27, to
> keep this file loadable. Only OPEN/DECIDED/record items live here, plus the newest
> BUILT entry, which stays as the home of the current live counts.

## ✅ BUILT 2026-09-11 — The goals wave closes: behind-pace nudge, seeded demo goals, the 1200-month horizon (DECISIONS #739)

**The report.** Three TASKS Wave GL dead ends closed in one slice: the Today feed now warns about a slipping savings goal (GL.3 `goal_behind_pace`, ACTION tier, `centsAtStake` = the extra monthly needed, dismissal keyed goal+target-month, detail = the goal card's own sentence); the live demo opens with two seeded goals (GL.4 — Vacation Fund on pace/no-date, New Car Fund behind by 24 months with a $300/mo gap) so /goals, Home, and the feed are populated for a first visitor; and the 1200-month planning horizon is a WRITER's rule (GL.5) — the /goals editor refuses a month past Jun 2126 with an inline error naming the ceiling, the month input carries `max` + an always-described hint, and BOTH Ask save writers refuse the same horizon (they previously would have persisted a year-2200 plan computed at the saturated cap).

**Critic (fresh context): cycle 1 FAIL 3 P1 — all fixed same-session; cycle 2 PASS (0 P0, 0 P1).** Cycle-1 P1s: demo plan e2e pinned the pre-seed $0 savings world (glass-box L.29 moved to a throwaway fixture where unset binds; demo pins retargeted to the goal-derived $350 "Planned savings (goals)" with no control; the demo guilt-free panel keeps its penny-match and loses "nothing is invented"); the date-passed row said "behind pace" with a "$0.00/mo more needed" why-line (title + why now branch on pace); Ask save writers bypassed the horizon (shared `isBeyondPlanningHorizon` beside the cap, called before solve/persist).

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,407 passed + 1 expected fail + 1 skipped / 629 files** (seed log counts `goals: 2`), `next build` clean. Playwright mobile-380 on the fresh build: `goal-demo-and-nudge` **2/2** (demo Home "1 of 2 goals needs a look" behind-first, /goals badges + sentences, dashboard nudge row with the card sentence; throwaway user: 2126-08 server-refused inline, 3200-01 client-blocked, 2027-06 saves, cleanup) + glass-box, conscious-buckets, goal-progress, goal-status-ask, education/giving presets, today-feed.

**Ship.** `d8947c89` on `origin/main` (no `prisma/schema.prisma` diff — database untouched; only `prisma/seed.ts`); docs `89594836`. CI verify run 34666301914 **success** on `89594836` (full VERIFY_E2E=1; the slice-only run 34666020736 was cancelled by the docs push). Vercel production **success** (GitHub deployment 6404766880) on `www.aimplifi.app`. Live probe: the demo DB lagged the seed (empty /goals worked example — the O.20e staleness class), closed by the new additive idempotent `scripts/seed-demo-goals-prod.ts` (demo rows only, run by the session against the owner-held prod URL); final probe on production: dashboard `nudge-goal_behind_pace` reads **"New Car Fund is behind pace … $450.00/mo gets you there on time ($300.00/mo more)"**, Home **"1 of 2 goals needs a look"**, /goals **New Car Fund 10% funded · Behind pace** + **Vacation Fund 33% funded · No date yet**.

**Still open.** Wave 0 ops owner-blocked. M.4 visual direction owner-deferred. Wave 2/3/4 rows per TASKS.md.



**The report.** After #737 the /goals card and Home knew pace; Ask could only inverse-plan a new amount + date. A reader with three named goals could not ask about any of them.

**Shipped.** Ask intent `goal_status`. Parser takes the reader's savings-goal names and commits only on a unique or ambiguous `matchGoalName` (none declines). `detail` is the card's own `goalPaceSentence`. Timeframe/`at`/date checks run on leftover tokens outside the matched name, so "June wedding" is askable and "Japan trip this month" still abstains. Demo read-only.

**Critic (fresh context): cycles 1–4 FAIL, all P0/P1 fixed same-session.** Residual P2s in DECISIONS #738. No 5th critic (budget 4).

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,388 passed + 1 expected fail + 1 skipped / 625 files**, `next build` clean. Playwright mobile-380: `goal-status-ask.spec.ts` **1/1**.

**Ship.** `b27986a1` on `origin/main`; CI verify run 34647434237 **success**; Vercel `dpl_2ci7DbwztXw36kq7yfRzzQSK6JWd` READY on `www.aimplifi.app`. Live demo Ask: "how am I doing on my spending last month?" → "You spent $4,587.00 last month." (not unknown). Named on-track questions need a stored row — demo has none (GL.4).

**Still open.** GL.3 behind-pace nudge; GL.4 seeded demo goals (live demo Ask cannot show a match); GL.5 1200-month cap. Wave 0 ops owner-blocked. M.4 visual direction owner-deferred.

## ✅ BUILT 2026-09-11 — Goals: progress + pace on every savings goal, and a Home Goals card (DECISIONS #737)

**The report.** Owner: make the app "extremely user friendly and insightful towards goals." A savings-goal card answered only "how many months at this pledge?"; it never said how far along the reader is or whether the pledge makes the date, and Home never mentioned goals.

**Shipped.** Pure engine `goalProgress()` (integer cents / bps; funded percent FLOORED so 99.99% never reads 100%; the required monthly for a dated goal is `solveSavingsGoalByDate`'s own figure, so the card and Ask state one number; the deadline is month-granular - the form's 1st-of-month and Ask's month-end judge alike). Every /goals savings card: progress bar (role=progressbar) + "N% funded" + a pace badge (Funded / Date passed / Needs a monthly amount / No date yet / On pace / Behind pace) + one sentence naming both inputs ("counting the $X you've marked saved, $Y/mo has this funded by <Month>, N months ahead of / after your <Month> date") and, when behind, the monthly that closes the gap plus the invitation to update what's saved. Home: `GoalsProgressCard` with a headline ("1 of 3 goals needs a look"), the three goals most in need of attention, each with bar + "$X marked saved of $Y · N% funded" + the same sentence, and a link to /goals. Debt-free cards and reserves untouched; no writers added; demo unchanged (no goals → no Home card).

**Critic (fresh context): cycle 1 FAIL 1 P1 — fixed same-session.** P1-1: the verdict leaned on the hand-typed saved figure without naming it (an Ask-saved goal read "Behind pace" one month later with zero reader action). Fixed in copy + Home basis line; GP-M anchor. Residual P2s accepted: `wholeMonthsUntil` caps at 1200 months (a >100-year date overstates the required monthly; the month input has no max); a regex-passing invalid stored date would split the two readers (unreachable through current writers).

**Gate.** `bash scripts/verify.sh` (run 2, after the critic fixes) → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,354 passed + 1 expected fail + 1 skipped / 623 files**, `next build` clean. Playwright mobile-380 on the fresh build: `goal-progress.spec.ts` **1/1** (no-date → on-track → 25% + 3 months ahead → behind with "$375.00/mo gets you there on time ($75.00/mo more)"; Home headline, basis line, row, link), phase4 goals **1/1**.

**Ship.** `e739981a` on `origin/main`; CI verify run 34634294883 **success**; Vercel `dpl_HBj2JyqeXKCCpQpupfKs6YbdHzsC` READY on `www.aimplifi.app`; live /goals lead + a throwaway demo goal's card and Home row read in a demo session, then deleted (demo row restored). Ops note: `scripts/ci-status.sh` exits 4 under WSL bash (`gh: command not found`) - run `gh` from PowerShell until the script resolves the Windows `gh`.

**Still open.** Ask against stored goals ("am I on track for my Japan trip?"); a behind-pace nudge; seeded demo goals. Wave 0 ops owner-blocked. M.4 visual direction owner-deferred.

## ✅ BUILT 2026-09-11 — TASKS.md ledger cut + M.4 slice 4: residual section labels onto the token (DECISIONS #735, #736)

**Ledger cut (#735).** The rotation commit's named next cut: eight fully-closed wave sections (O, O.16, O.12, O.18, O.19 totals, C, G, O.19 accounts — zero status-badged rows, each range re-verified row-by-row; Wave O's owner requests confirmed shipped via the done-row archive + #725) moved verbatim to `docs/archive/TASKS_DONE_ARCHIVE.md` under a dated marker. TASKS.md 143 KB → 126.5 KB; the rest is open rows' live status cells. docs-lint clean; ledger suite 20/20.

**Slice 4 (#736).** The ~13 residual near-twin section-label literals from slice 3's critic now render PAGE_SECTION_LABEL_CLASS across 8 files (budgets/triage/rules/settings category h3 pairs with mb-2 kept; household-card, learned-phrases, household-sharing-card h3s; the spending-plan hero <p> pair with `justify-center`). Charter exclusions named: badge pills, nav/list-group headers, onboarding brand caption.

**Critic (fresh context): cycle 1 FAIL 1 P1 — fixed same-session.** P1-1: the token is a flex row; the spending-plan hero labels lost the parent's text-center effect (flex items pack to start) and left-aligned beside the centered amount on all three hero branches — fixed with the recurring-view `justify-center` precedent. P2-1: the new e2e was tautological on spending-plan (weight was already 500) — replaced with a real alignment lock (justifyContent center + label/amount centers within 1px), which demonstrably fails-old (caught the stale pre-fix build).

**Gate.** bash scripts/verify.sh (run 2, after the P1 fix) → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,315 passed + 1 expected fail + 1 skipped / 623 files**, next build clean. Playwright m4-page-chrome **4/4** against the fresh build (19 routes × 380+1440 no overflow; budgets label weight 500; hero centered).

**Ship.** `692fe505` on `main`, docs state `290e7f78`. GitHub Actions `verify` run **34626408618 = SUCCESS** on the head sha (the slice run was cancelled by the docs push; re-read on the newest sha). Vercel Production **6398151276 = success** (`https://aimplifi-162ibogn8-reiforge.vercel.app`, aliased to `www.aimplifi.app`); live `/sign-in` 200 and its stylesheet carries the token's utilities + `background-attachment:local`.

## ✅ BUILT 2026-09-11 - M.4 slice 3: near-twin section labels + lead-column cap + body-wash scroll fix (DECISIONS #734)

**The report.** The tree held slice 3 interrupted before its gates. Closed the three #724 residual P2s: 7 near-twin section-label literals render PAGE_SECTION_LABEL_CLASS (spend-class-panel's h3 keeps mb-2); PAGE_LEAD_CLASS capped at max-w-md with PAGE_LEAD_WIDE_CLASS re-opening the wide routes (accounts, goals, rules, triage, ask); body gradient background-attachment: local.

**Gate.** bash scripts/verify.sh → ✅ VERIFY GREEN: tsc 0, eslint 0, unit **8,297 passed + 1 expected fail + 1 skipped / 616 files**, next build clean. Playwright mobile-380: m4-page-chrome **3/3** (19 routes × 380+1440, no horizontal overflow) + phase1-cash-needed **2/2**.

**Critic (fresh context): cycle 1 FAIL 1 P1 - fixed same-session.** The P1 was staging: the untracked lock test sat beside the throwaway capture spec + shots/ + scratch logs, so a commit habit could ship the slice without its lock (or ship the throwaway). Scratch deleted; lock staged explicitly. Residual P2s: ~13 near-twin literals outside the 7-file charter (triage/rules h3s, budgets/settings/spending-plan/household cards) - slice 4 candidates; the near-twin lock regex is order-heuristic; gap-1.5→gap-2 micro-deltas on /investments + /recurring accepted and named.

**Rotation.** Four ledgers cut under the 40KB ceiling, verbatim: DECISIONS #485-#723 → DECISIONS_ARCHIVE_485_to_723.md (live = #724+); PROGRESS 2026-08-20..2026-08-31 → PROGRESS_ARCHIVE_2026-08-20_to_2026-08-31.md; STATUS BUILT/records through 2026-08-19 → STATUS_ARCHIVE_2026-07_to_2026-08-19.md (OPEN/FOUND/DECIDED + 2026-09 BUILT stay live); REGRESSION rows 2026-08-20..2026-09-02 → REGRESSION_LEDGER_ARCHIVE_2026-08-20_to_2026-09-02.md. Index regenerated (712 entries); ledger-decisions-index unit test green; docs-lint clean. TASKS.md (139.9KB, no line-level [x] rows) is the named next cut.

**Ship.** Landed `6cf6f3d0` on `main` (rebased over the parallel session's #726-#733 feature commits; my decision renumbered #726 -> #734). GitHub Actions `verify` run **34615048819 = SUCCESS** (full VERIFY_E2E=1 suite on the merged tree). Live `https://www.aimplifi.app/sign-in` 200 and its served stylesheet carries `background-attachment:local` - the slice marker unique to this change.
## ✅ BUILT 2026-09-10 — CI repair: four red e2e specs + Needs-a-category aria-pressed (DECISIONS #725)

**The report.** Slice 2 left CI `verify` run `34511385651` red on four pre-existing e2e + one flaky a11y scan. Those were the next leftover.

**Shipped.** Specs follow the shipped UI. Budget Clear is inside the row editor — open `budget-row-target-*`, then after clear assert the first-run hint and the gone row (a collapsed `budget-clear-*` count-0 does not prove the target left). Failed-sync alert locks `couldn't sync` / `Reconnect it so your numbers stay current` plus in-place SimpleFIN reconnect. Wealth-target dials link is `#coach-money-dials` and that target is on /coach. Needs-a-category chip stays a pre-hydration `<a>`; `aria-current` when on; no `aria-pressed` (axe `aria-allowed-attr`).

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8,288 passed + 1 expected fail + 1 skipped / 614 files + 1 skipped (615)**, `next build` clean. Playwright mobile-380 **17/17** on the repaired specs + phase5-a11y, then **2/2** after the clear-outcome strengthen.

**Critic (fresh context): PASS — 0 P0, 0 P1.** Residual P2s: `aria-current` is not toggle semantics; dials jump is existence-locked not click-tested.

**Ship.** `ad9c0f77` on `main`. GitHub Actions `verify` run `34516971264` = SUCCESS. Vercel Production `dpl_6eQqSWvabbbv1SdV9y9bQRU2bCqn` READY (`https://aimplifi-bupvp09n8-reiforge.vercel.app`, aliased to `www.aimplifi.app`). Live `/sign-in` 200. The repaired chip and reconnect alert are signed-in-only — public HTML marker UNVERIFIED.

**Still open.** M.4 slice 3 (section labels + dashboard/accounts). Ledger rotation (ceiling). Wave 0 ops owner-blocked.

## ✅ BUILT 2026-09-10 — M.4 slice 2: page-chrome tokens, chrome restyle, brand-tinted dark theme (DECISIONS #724)

**Shipped.** Four shared page-chrome tokens (title / lead / stack / section label) in `src/components/finance/page-chrome.ts`, unit-locked; every visible page h1 + lead migrated (16 routes + the new-user welcome card); two byte-identical trends-view section labels onto the token. Shell chrome: sticky translucent header, pill desktop nav, mobile bottom-bar active indicator (shape, not color), demo banner as a pill, sign-in card elevation, rounded-lg auth inputs, surface cards with a 1-ring hairline. `.dark` retinted with brand-green chroma (oklch hue 165) — the app renders hard-coded dark (root layout), so the retint is the identity, not a mode; light `:root` untouched. className/CSS only: no copy, figure, adjacency, testid, or logic change.

**Boundary repairs (own REGRESSION_LEDGER rows).** A 2026-09-08 `core.autocrlf=true` re-smudge had put CRLF on 586 worktree files while the index stayed LF: byte-identical repair + `.gitattributes` `* text=auto eol=lf`. `vercel-build.test.ts` never passed on Windows — `bash` here is WSL (PATH/env do not cross as the test assumed; DATABASE_URL needs WSLENV): made platform-aware, Linux path unchanged. Lesson: `docs/lessons/wsl-is-the-bash-env-and-boundary.md`.

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN (run 5, exit 0, 365s): tsc 0, probes tsc 0, eslint 0, unit **8,288 passed + 1 expected fail + 1 skipped / 614 files + 1 skipped (615)**, `next build` clean.

**Walkthrough.** `tests/e2e/m4-page-chrome.spec.ts` 3/3: 19 (app) routes × 380px+1440px with no horizontal overflow; desktop h1 renders 30px; desktop nav links pill-shaped; demo banner renders as a pill; hero font weight ≥600. Retinted screenshots reviewed: dashboard 380px, accounts 1440px, sign-in — all render coherently.

**Critic (fresh context): cycle 1 FAIL 3 P1 — all fixed same-session.** Junk WSL cmds.log files staged (removed from disk+index); deleted temp spec still staged (replaced by the promoted `m4-page-chrome.spec.ts`); new lessons INDEX line over the 220-char ceiling. Contrast re-check passed (all text pairs AA-preserved). Open P2s for M.4 continuation: 7 near-twin section-label literals (allocation-drilldown, forecast-view, recurring-view, retirement-outlook-card, spend-class-panel, top-spending-card, ask-view); PAGE_LEAD_CLASS `max-w-2xl` dead on `max-w-md` routes (transactions/import, transactions/new, error); `background-attachment: fixed` body gradient (scroll repaints, ignored by iOS Safari).

**Ship.** `795b0dc1` on `main` (pushed 2026-09-10). Live `https://www.aimplifi.app/sign-in` serves the slice marker (`shadow-lg ring-1 ring-foreground/5`, sign-in card elevation) — deployment READY. **CI `verify` run `34511385651` FAILURE — all failures proven pre-existing** at ship time; repaired in #725.

## ✅ BUILT 2026-09-03 — Home recent charges line up; compact direction says Money out (DECISIONS #638)

**The report.** Owner: Home Recent transactions were not lined up, and compact “Out” did not say what it meant. Beauty later, after the feature set.

**Shipped.** 3-column grid (payee / dollars / Open). Meta wraps on a second line. Compact direction uses Money in / Money out, same as detail. Writes stay siblings of the C.15 Open Link. Amounts stay `shrink-0`. Wave M.4 restated, not started.

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN. Unit **8,183 passed + 1 expected fail + 1 skipped / 537 files + 1 skipped**. E2E mobile-380: `transaction-return-c15` 3/3, `phase1-cash-needed` 2/2.

**Critic (fresh context): cycle 1 PASS — 0 P0, 0 P1.** Residual P2s: silent toggle, aria-label vs visible name, demo empty third track, source-string lock only.

**Ship.** `dc74a020` on `main`. CI `33808709791` SUCCESS. Vercel Production `6253396769` SUCCESS (`https://aimplifi-j5b85v6i7-reiforge.vercel.app`). Live `https://www.aimplifi.app/dashboard` → 307 `/sign-in` (auth). The Money out control is signed-in-only, so the public HTML has no `home-recent-direction` marker — that probe is UNVERIFIED without a signed-in session.

## ✅ BUILT 2026-09-03 — Add a card from the Cards page (DECISIONS #637)

**The report.** Standing leftover after #634: Cards empty still sent
“Add a card manually” to Accounts, and a populated Cards page had no
add affordance.

**Shipped.** `CardAddControl` on both Cards empty (`cards-empty-manual`)
and the populated page (`cards-add-open`). Same writer as Accounts
(`addManualAccount`); type locked to CREDIT. Demo not mounted.
Balance still refuses $0. Writer also revalidates `/cards`.

**Does not** add loans or other liabilities from Cards. Does not
collect APR / due day on create (statement add remains #634). Linked
cards still come from Connect.

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0, probes
tsc 0, eslint 0, `next build` clean). Unit **8,182 passed + 1 expected
fail + 1 skipped / 536 files + 1 skipped**. E2E cards-add **1/1**,
connect-affordances **1/1**, cards-statement **1/1** on mobile-380.

**Critic (fresh context): cycle 1 FAIL 2 P1; cycle 2 PASS — 0 P0, 0 P1.**
P1-1: amount unlabeled. P1-2: unknown-due named Accounts / a bank
statement. Residual P2s: empty-state still mentions the plan; household
add does not say “your” card; `$500`/`1,234` still rejected.

**Ship.** `16590072` on `main`. CI `33803882007` SUCCESS. Vercel
Production `6252565100` SUCCESS. Public `/cards` is auth-gated.

## K.2 CORRECTION — Plaid is at the 90-day DEFAULT, not the 730-day ceiling (2026-08-07)

Owner: *"All I want is max plaid data."* The recorded answer was wrong and the new one is
measured, not inferred. Probe: `scripts/audit-probes/plaid-depth-why.mts` (read-only, live Neon).

**What K.2 said:** "Plaid is at its documented 730-day ceiling … Plaid holds no more."
**What is true:** 730 days is two years; the corpus holds ~90 days. The ceiling was never the
binding constraint — our own request was. K.2 read `historyBackfilledAt` set on every item as
"backfilled, therefore exhausted", which the flag cannot mean.

**Measured, all 12 items (not 13 — three of the 15 `plaid.item.link` audit rows were removed):**
every Item was created **2026-07-23/24**, one week before `PLAID_DAYS_REQUESTED = 730` shipped
on 2026-07-31. Plaid applies `days_requested` only where Transactions was not already
initialized, so all twelve are pinned to Plaid's 90-day default permanently. Reach-back from
link date is 67–90 days on every item holding rows.

**The backfill ran and provably bought nothing — this is the important part.** All 12
`plaid.item.history-backfill` audit rows read `windowStart: "2024-08-04"` (a correct 730-day
ask), `added: 0`, and `alreadyExists: N` equal to the rows already held (289 Chase, 392 Capital
One, 189 Schwab, …). So `/transactions/get` over two years returned ONLY the existing 90-day
window and nothing older. That is a clean, complete fetch — not an error.

**Therefore the core assumption in `plaid-history-backfill.ts` is FALSE:** its header claims
`/transactions/get` "DOES return already-delivered rows and, for most institutions, up to about
two years of them." It does not return rows outside the Item's initialized window. That file
flagged itself "UNVERIFIED against a live sandbox"; it is now verified, and it is wrong. The
backfill cannot deepen any existing Item and no amount of syncing will change that.

**The only remaining lever is remove + fresh Link**, which the code already said
(`plaid.ts:280`) and which is now the ONLY route rather than one of two. `disconnectPlaidItem`
is safe for data — it revokes at Plaid and deletes the item row, but keeps accounts and
transactions ("they just won't update"), so the 90 days already held survive the round trip and
the reconciliation boundary handles the overlap when the fresh link lands.

**Do ONE bank first.** `days_requested: 730` has never been exercised against a live bank —
every network path in `plaid.ts` carries the same UNVERIFIED note that just proved wrong once.
Re-link the smallest connection (Truist, 3 rows) and confirm it returns ~730 days before
spending the clicks on the other six institutions.

**Ceiling regardless: 730 days is Plaid's documented maximum.** Even a perfect re-link of every
bank reaches 2024, not 2023. The owner's three-year ask cannot come from Plaid at all — that is
SimpleFIN (connection currently deleted) or per-bank CSV.

