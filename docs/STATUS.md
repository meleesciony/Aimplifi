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

