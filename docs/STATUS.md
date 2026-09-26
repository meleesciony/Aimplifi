# STATUS — known limitations & open items

Living document; updated at each phase boundary and critic cycle. In the build graph
(`GRAPH.md` §3) this file is shared state: the open-items field every node reads and
the state-writer edge updates. It is also the only home for live counts (test totals,
rates) — no other doc may restate them.

> Sections through 2026-08-19 live in `docs/archive/STATUS_ARCHIVE_2026-07_to_2026-08-19.md`
> (rotated 2026-09-11) and the BUILT entries 2026-09-03 through 2026-09-11 in
> `docs/archive/STATUS_ARCHIVE_2026-09-03_to_2026-09-11.md` (rotated 2026-09-17), and the BUILT
> entries for #737–#740 (2026-09-11/12) in `docs/archive/STATUS_ARCHIVE_2026-09-11_to_2026-09-12.md`
> (rotated 2026-09-17), the BUILT entry for #741 (2026-09-14) in
> `docs/archive/STATUS_ARCHIVE_2026-09-14.md` (rotated 2026-09-18), and the BUILT
> entry for #745 (2026-09-17) in `docs/archive/STATUS_ARCHIVE_2026-09-17-745.md`
> (rotated 2026-09-18), and the BUILT entry for #750 (2026-09-18) in
> `docs/archive/STATUS_ARCHIVE_2026-09-18-750.md` (rotated 2026-09-18), and the
> BUILT entries for #749/#752 in
> `docs/archive/STATUS_ARCHIVE_2026-09-18-o20j-749-752.md` (rotated 2026-09-20), and the
> BUILT entries for #753–#756 in
> `docs/archive/STATUS_ARCHIVE_2026-09-18-o20j-753-756.md` (rotated 2026-09-22); only
> current-wave BUILT entries and OPEN/FOUND/DECIDED items remain here.
> BUILT #744/#748 and the superseded #743 human gate live in
> `docs/archive/STATUS_ARCHIVE_2026-09-16_to_2026-09-17.md` (rotated 2026-09-21).
>
> Entries from 2026-06/2026-07 (BUILT/CLOSED history) were moved verbatim to
> `docs/archive/STATUS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04, and the 2026-08
> BUILT/CLOSED history to `docs/archive/STATUS_ARCHIVE_2026-08.md` on 2026-08-27, to
> keep this file loadable. Only OPEN/DECIDED/record items live here, plus the newest
> BUILT entry, which stays as the home of the current live counts.

## ✅ BUILT 2026-09-25 — O.11c: the reimbursement round trip (DECISIONS #774)

**The hole.** A positive row filed `reimbursement` (auto-filed for CONCUR/EXPENSIFY/EXPENSE REIMB descriptors) counted as INCOME in `isIncomeFlowRow` while the O.15 tracker + exclude lever had taken the outflow out of spending — the owner's exact workflow (exclude the work expense, the payback lands) fabricated phantom income on the reports chart, the glass-box panel, the coach savings rate, Ask income/savings answers, the creep income baseline and the spending-plan fallback.

**Shipped.** `isReimbursementInflow` — shared, sign-gated, positive-only: the payback counts on NEITHER side, skipped from `monthlyFlows` and the glass-box panel before the asOf accumulation. NOT a `refund` mirror: netting would understate real spend when the outflow was excluded (the too-generous direction). Tracker stays suggestion-only. `tax-refund` income and `refund` netting untouched. Copy re-derived: MONTH_FLOW_BASIS (both sentences), the Ask income trace + month-flow derivation, the income-pattern docblock, the `money-in` chip (no longer claims income), the coach outstanding card + its detail-view sibling (now name the exclusion lever as the mechanism), the `categories.ts` comment. No schema change; demo figures byte-identical (the seed holds zero reimbursement rows — verified).

**Maker gate.** Cycle 1: fail-old **7 failed | 92 passed** → verify GREEN → targeted e2e **10/10** (month-flow-drilldown, reports-total-reconciles, savings-rate-drilldown, o20h-one-definition). Cycle 2 (copy fixes): verify GREEN (FRESH_TSC=1), targeted units **942/942** (5 suites), e2e **17/17** (spend-class/action-menu incl. the reimbursement tracker flow). Final: `bash scripts/verify.sh` FRESH_TSC=1 → ✅ VERIFY GREEN, unit **8611 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped**. Live sizing probe (`scripts/audit-probes/o11c-reimbursement-income.mts`, read-only): **0 reimbursement inflows corpus-wide** — prevention; no live figure moves.

**Critic (fresh context): cycle 1 FAIL 1 P1 + 5 P2 → fixed; cycle 2 PASS — 0 P0 / 0 P1 / 3 delta P2** (all three folded or satisfied by these ledger writes; recorded in DECISIONS #774).

**CI + live.** First push `c9876209` → CI 36208149669 ❌: the ledger tripwire (`ledger-decisions-index.test.ts`) fired — DECISIONS #774 shipped without its `docs/DECISIONS_INDEX.md` line (the state-writer edge wrote DECISIONS.md after the final local verify, so the tripwire only saw the tree that was pushed); index line added in the same-commit rule recorded in REGRESSION_LEDGER → **`36722fca` pushed; CI conclusion on the newest sha: PENDING — this line is updated ONLY when the waiter reads the real conclusion**. Live deployment verified behaviorally (no Vercel token on this VM, so the dashboard label is not readable here): `scripts/o11c-live-deploy-check.mjs` → **DEPLOY PROOF: PASS, 5 checks** on www.aimplifi.app — the production panels render the new O.11c basis clauses ("counts on neither side" / "counts against neither this figure nor the income one"), markers unique to this build, so the deployed bundle IS this slice's; demo flow chart drew 6 months; no page errors. Note: the probe's first five attempts read `innerText`, which hides the collapsed basis text and produced 5 false FAILs while the deployment was already current — the proof now reads each panel element's `textContent`, the same locator strategy the e2e uses.

**Still open / residuals.** (1) The non-excluded round trip strands the purchase in spending with no surface explaining why (deliberate conservative direction; disclosure design work). (2) The Ask income answer enumerates less than its own trace line (no false sentence — defensible depth gap). (3) L.12 P2 residuals carry over (GRILLE non-dining false positives, GRILLS unpinned by a test, the proposal-rung e2e coverage maker-asserted). The O.13b STILL-OPEN sub-items (payee edit, O.13g user-settable status, O.11d tags, attachments, mark-as-recurring) remain open as recorded there.

## ✅ BUILT 2026-09-24 — Dining rule matches Grille; the owner's inbox revives on read (DECISIONS #773)

**The hole.** L.12(c): the owner's screenshot showed "Goose Pond Bar Grille" (8 txns) at "Suggestion: none yet" — the generic dining keyword rule was `\bGRILL\b`, which cannot match GRILLE (no word boundary before the trailing -e).

**Shipped.** One token widened (`GRILLE?S?`). Triage re-runs `categorize()` per row on read, so rows already in the queue get the suggestion with no backfill (O.12d's repair route separately covers pre-L.12 provider hints). The two #303 fixtures that seeded the descriptor as "a ruleset miss" moved to a verified true miss; the e2e became a two-ladder spec. No schema change.

**Maker gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN, unit **8601 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped** (first run red: the #303 plaid-map fixture was caught by the widened rule; moved to a verified true miss, re-run green). Fail-old **4 failed | 115 passed** pre-fix. Playwright triage two-ladder **2/2** (17.2s, mobile-380). `eval:categorize` byte-identical (**480 | 59 | 421 | 410 | 11 | 97.4%**).

**Critic (fresh context): cycle 4 PASS — 0 P0 / 0 P1 / 3 P2** (cycles 1–3 reproduced gates, cut off before a verdict; recorded in DECISIONS #773).

**CI + live.** First push 9f337a06 → CI 36059727655 ❌: the write-in spec's by-design tripwire fired (its seeded "merchant the ruleset must not know" was exactly the merchant this slice teaches it); fixture moved to a verified true miss, spec 2/2 locally → **4f238856 → CI 36063077472 ✓ success (16m14s)**, Vercel **READY** (F1ejGigF4JCNNLEVchs3MAHrxWR7), `scripts/l12c-live-deploy-check.mjs` → **DEPLOY PROOF: PASS, 3 checks** on www.aimplifi.app (demo /triage healthy; the demo seed holds no GRILLE merchant — the behavioral discriminator is the CI e2e on this sha).

**Still open / residuals.** (1) P2-1: rare non-dining GRILLE merchants (BMW GRILLE REPLACEMENT-class) confidently auto-file dining — visible, one-tap re-filable. (2) P2-2: the GRILLS plural is newly matched but unpinned by a test. (3) P2-3: the e2e's proposal-rung coverage is maker-asserted. (4) L.12(d) live-corpus auto-file coverage UNVERIFIED (no Plaid creds). Inbox and Activity remain two queues by design. Mobile header still scrolls.

## ✅ BUILT 2026-09-22 — Month-rest names Monthly Money Review the way the card does (DECISIONS #772)

**The hole.** #771 left the closed rest saying “the monthly review” while the card says “Monthly Money Review”.

**Shipped.** The summary ends with the card’s label, Monthly Money Review, from one shared string the card also renders. No schema change.

**Maker gate.** `bash scripts/verify.sh` → VERIFY GREEN, unit **8596 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped**. After the eight sentences were written as full literals: summary unit 4/4. Playwright coach-chapters **7/7**. Browser on that build, demo Coach: rest closed; summary ends “and Monthly Money Review”; opening the row shows the card label “Monthly Money Review”.

**Critic (fresh context): PASS UX 9 / 0 P0 / 0 P1 / 3 P2.** Mobile 8, a11y 8, code quality 9, coverage 8.

**CI + live.** `d88c7698` on `origin/main`. No `prisma/` diff. **CI verify run 35808922617 = SUCCESS**. Vercel `dpl_EQrvvfKwkFzasTJgy2s49PzuwDdd` **READY** (`www.aimplifi.app`). Live demo Coach: rest closed; summary ends “and Monthly Money Review”; opening it shows the card label “Monthly Money Review”. Marker: `Monthly Money Review`.

**Still open / residuals.** (1) The e2e locks only the all-present sentence. (2) The other rest titles are still hand-copied, so case and “the” can drift from those cards. (3) The shared review lock is a source grep. (4) Rest stays in the HTML when closed. Inbox and Activity remain two queues by design. Mobile header still scrolls.

## ✅ BUILT 2026-09-22 — Month-rest names the life-energy view from the card gates (DECISIONS #771)

**The hole.** #770 named the always-on purchases card “hours” (the toggle) and copied the three optional-card gates beside the cards.

**Shipped.** The summary says “life-energy view”. Automation, life energy by category, and what Aimplifi caught stay named only when those cards render, through the same predicates the cards use. No schema change.

**Maker gate.** `bash scripts/verify.sh` → VERIFY GREEN, unit **8595 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped**. Playwright coach-chapters **7/7**.

**Critic (fresh context): PASS UX 8 / 0 P0 / 0 P1 / 4 P2.**

**CI + live.** `d67cc400` on `origin/main`. No `prisma/` diff. **CI verify run 35803590762 = SUCCESS**. Vercel `dpl_A35q9qMiqmEgXYfHEih6rRbpeV2X` **READY** (`www.aimplifi.app`). Live demo Coach: rest closed; summary “Lifestyle creep, room for error, the automation blueprint, life-energy view, life energy by category, what Aimplifi caught, and the monthly review”; creep hidden. Marker: `life-energy view`.

**Still open / residuals.** (1) ~~Summary says “the monthly review”; the card says “Monthly Money Review” (P2-1)~~ — **CLOSED #772.** (2) The life-energy phrase is not locked against the card source (P2-2). (3) The e2e locks only the all-present sentence (P2-3). (4) The shared-gate lock is a source grep (P2-4). (5) Rest stays in the HTML when closed. Inbox **12** and Activity **17** remain two queues by design. Mobile header still scrolls.

## ✅ BUILT 2026-09-21 — Month-rest summary names every claim it hides (DECISIONS #770)

**The hole.** #769 left the closed rest row naming creep, room for error, hours, and the review, while the automation blueprint, life energy by category, and what Aimplifi caught sat inside unnamed.

**Shipped.** The summary names those three only when that card renders. The four always-present claims stay named. No schema change.

**Maker gate.** `bash scripts/verify.sh` → VERIFY GREEN, unit **8593 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped**. After the page-gate and full-sentence locks: chapter unit 1/1, summary unit 1/1, Playwright first-fold **1/1**. Local demo Coach at 380×800: rest closed; summary is the full sentence; creep stays hidden (`checkVisibility` false) until the row opens.

**Critic (fresh context): PASS UX 8 / 0 P0 / 0 P1 / 4 P2.** Same session closed P2-3 and P2-4. P2-1 and P2-2 remain.

**CI + live.** `33039e2c` on `origin/main`. No `prisma/` diff. **CI verify run 35669406939 = SUCCESS**. Vercel `dpl_HaGw5t5n84TAvafXehRYPpds2Vpc` **READY** (`www.aimplifi.app`). Live demo Coach at 380×800: rest closed; summary “Lifestyle creep, room for error, the automation blueprint, hours, life energy by category, what Aimplifi caught, and the monthly review”; creep hidden. Marker: `coach-month-rest`.

**Still open / residuals.** (1) The three presence booleans are duplicated beside the card null-gates (P2-1). (2) Life energy is still named “hours” (P2-2). (3) Rest stays in the HTML when closed. (4) Inbox **12** and Activity **17** remain two queues by design. Mobile header still scrolls.

## ✅ BUILT 2026-09-21 — This month opens on the destination and the flags (DECISIONS #769)

**The hole.** #768 left why, assumptions, and the FI-date essay on the open fold. The destination was a small title, and the flags sat below goals.

**Shipped.** Headline is the destination at 24px. Why stays. Skipped rungs, cards this cycle, and assumptions start closed, and that summary names them. Flags sit under the destination; goals follow the flags. FI date and the 90-day cash-flow walk, when present, start closed under a summary that names them. No schema change.

**Maker gate.** `bash scripts/verify.sh` → VERIFY GREEN, unit **8592 passed + 1 expected fail + 1 skipped / 639 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100, mobile-380): coach-chapters, phase3, employer-match, tax-advantaged, next-dollar-frozen **14/14**. Browser walk: assumptions open to the order sentence; worked-out opens to the 7.00% basis; biggest lever finishes inside 800.

**Critic (fresh context): cycle 1 FAIL UX 5 / 1 P1. Cycle 2 PASS UX 8 / 0 P0 / 0 P1 / 3 P2.** P1 was the FI-date claim under a provenance-only summary. Same session closed P2-2 and P2-3 (both-branch string; “cash-flow walk”).

**CI + live.** `0045560c` on `origin/main`. No `prisma/` diff. **CI verify run 35662854457 = SUCCESS**. Vercel `dpl_7c6uFDKG1cRLTW62tFq5XHcUoyuf` **READY** (`www.aimplifi.app`). Live demo Coach at 380×800: headline **24px** “Next extra dollar: investing”; closed “What we skipped, cards this cycle, and the assumptions”; closed “What this does to your FI date, and how those amounts were worked out”; biggest-lever bottom **787**. Marker: `next-dollar-more`.

**Still open / residuals.** (1) Month-rest summary does not name automation, fulfillment, or value receipts (P2-1). (2) Rest stays in the HTML when closed. (3) Inbox **12** and Activity **17** remain two queues by design. Mobile header still scrolls.

## ✅ BUILT 2026-09-21 — This month first fold is the extra dollar and the flags (DECISIONS #768)

**The hole.** #767 left Coach This month open on next-dollar, but creep, hours, runway, and the monthly review still painted in that chapter.

**Shipped.** Closed `coach-month-rest` after the extra dollar and the flags. Summary names room for error (Ask’s runway answer lands on `/coach`). Goals stay in their own closed disclosure. Reimbursements and opportunity flags stay on the first fold. No schema change.

**Maker gate.** `bash scripts/verify.sh` → VERIFY GREEN, unit **8592 passed + 1 expected fail + 1 skipped / 639 files + 1 skipped**. After the summary named room for error: chapter unit 1/1, `next build` clean, Playwright first-fold **1/1**.

**Critic (fresh context): cycle 1 FAIL UX 7 / 1 P1. Cycle 2 PASS UX 8 / 0 P0 / 0 P1 / 4 P2.**

**CI + live.** `f86b2e1b` on `origin/main`. No `prisma/` diff. **CI verify run 35654006430 = SUCCESS**. Vercel `dpl_ETE64G8VDPUc5TLKx8wYnGEwr9Yo` **READY** (`www.aimplifi.app`). Live demo Coach: next extra dollar investing; rest summary names room for error and stays closed; Trajectory is the next chapter. Marker: `coach-month-rest`.

**Still open / residuals.** (1) First fold still includes next-dollar’s why/assumptions and the opportunity list. (2) Automation, fulfillment, and value-receipts are in the rest disclosure but not in the first-fold lock. (3) Rest stays in the HTML when closed. (4) Goals disclosure has no test id; the rest helper opens by click. Inbox **12** and Activity **17** remain two queues by design. Mobile header still scrolls.

## ✅ BUILT 2026-09-21 — UX A-grade (DECISIONS #767)

**The hole.** Live review C / 5.1: cash-needed 14px, synonym nav, Plan vs Spending, two filing counts, Today restated the hero, Coach/catalog/sign-in dumps.

**Shipped.** Token on the amount button; CardTitle skips sm when the class is 3xl/4xl. Guilt-free / Budgets labels. Home “N to file on Activity.” Today display-filter. Coach next-dollar first; catalogs closed; demo CTA primary.

**Maker gate.** `bash scripts/verify.sh` → VERIFY GREEN, unit **8592 passed + 1 expected fail + 1 skipped / 639 files + 1 skipped**. Playwright: home-stage 2/2 (amount ≥28px), today-feed 8/8, desktop-header 1/1, coach-chapters 6/6, phase5-a11y keyboard 1/1.

**CI + live.** `c812a015` on `origin/main`. No `prisma/` diff. First CI `35625811096` FAILED (first Tab expected email after demo became primary). **CI verify run 35628035698 = SUCCESS**. Vercel `dpl_FxkvZkiBfk7bdwyuJneJ7QnAXppg` **READY** (`www.aimplifi.app`). Live demo: `[data-testid=cash-needed-amount]` **36px / $5,412.33**; Today has **0** `nudge-payment_due`; nav **Guilt-free / Budgets / Trends**; chip **17 to file on Activity**; sign-in **or sign in to your account**.

**Still open / residuals.** ~~Coach This month still lists creep/hours/review under the open chapter~~ — **CLOSED #768.** Inbox **12** and Activity **17** remain two queues by design. Re-grade vs C/5.1 after #767 was **~8.4 / B+**; the first-fold hole is #768.

## FOUND 2026-09-21 — UX adversarial review (owner: grades first, then decide)

Live demo walk. **5.1 / 10 (C). 0 P0 / 8 P1 / 6 P2.** Closed by #767 maker (re-grade after live walk).

## ✅ BUILT 2026-09-21 — Clear chapter hold on the next pointerdown (DECISIONS #766)

**The hole.** #765 P2-4 / P2-5: tap-open did not arm hold, so a leftover click could native-close; Enter's 500ms hold could swallow a real close.

**Shipped.** First click-open arms `holdOpen`. After ready, `pointerdown` (and Space/Enter-to-close) clears it. 500ms fallback kept. No `el.open = false`. No schema change.

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 6/6, home-chapters 6/6 (**12/12**).

**CI + live.** `41973d94` on `origin/main`. No `prisma/` diff. First CI `35559960169` FAILED (leftover after `toBeVisible`). **CI verify run 35561069817 = SUCCESS**. Vercel `dpl_BesMXdeETanZZZpKRnXx2FLej6jA` **READY** (`www.aimplifi.app`). Live `/` → 307 `/sign-in`. Leftover click on Picture holds `$144,804.74`. Marker: `clearHoldOpen` / `onPointerDown`.

**Still open / residuals.** (1) RSC still serializes chapter children. (2) e2e harness still auto-opens chapters. (3) M.4 route-by-route restyle owner-eyeball-gated. (4) **P2-1:** a leftover that also fires `pointerdown` can still native-close. (5) **P2-2:** 500ms timer still the only backstop for click-only leftovers. (6) **P2-3:** chapter units are source greps.

## ✅ BUILT 2026-09-20 — Hold first chapter open through the leftover click (DECISIONS #765)

**The hole.** #764 P2-4 / P2-2: after `readyRef` flipped, Enter's synthesized click or a UA-first leftover click native-closed the chapter.

**Shipped.** `holdOpenRef` arms on `adopt()` and first-open Enter. Leftover click/keydown `preventDefault`s while armed. First click-open does not arm. No `el.open = false`. No schema change.

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.** P2-1/P2-2 closed same-session (`HTMLElement.click()` leftover + next click closes). Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 6/6, home-chapters 6/6 (**12/12**).

**CI + live.** `5b9abc97` on `origin/main`. No `prisma/` diff. **CI verify run 35548078940 = SUCCESS**. Vercel Production `dpl_3XaasU1ydKTcRZ52xRW6QBSoTYab` **READY**, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. Live demo first-open Enter on Picture holds `net-worth-amount` `$144,804.74` already in the open details. Marker: raw `5b9abc97` has `holdOpenRef` / `armHoldOpen`.

**Still open / residuals.** (1) RSC still serializes chapter children. (2) e2e harness still auto-opens chapters. (3) M.4 route-by-route restyle owner-eyeball-gated. (4) ~~**P2-4:** 500ms hold after Enter can swallow one real close~~ — **CLOSED #766** for pointer/keyboard close. (5) ~~**P2-5:** tap-open then a late ghost click can still native-close~~ — **CLOSED #766** for click-only leftovers. (6) **P2-3:** chapter units are source greps (carried as #766 P2-3).

## ✅ BUILT 2026-09-20 — UA-first chapter open mounts the body before paint (DECISIONS #764)

**The hole.** #763 P2-1 / P2-5: a UA that toggled `<details>` first could paint an empty shell; the `toggle` listener attached after paint.

**Shipped.** `MutationObserver` on `open` + `toggle` in `useLayoutEffect`. `flushSync` mounts children in that microtask. Click/Space/Enter `preventDefault` until `readyRef` after first open. No `el.open = false`. No schema change.

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 5/5, home-chapters 5/5 (**10/10**).

**CI + live.** `6b9e5dff` on `origin/main`. No `prisma/` diff. **CI verify run 35543058639 = SUCCESS**. Vercel Production `dpl_Dmxn5FSFq4yDckemvucLsEcWJTbT` **READY**, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. Live demo Picture open holds `net-worth-amount` `$144,804.74` already in the open details. Marker: raw `6b9e5dff` has `flushSync` / `MutationObserver` / `readyRef`.

**Still open / residuals.** (1) RSC still serializes chapter children. (2) e2e harness still auto-opens chapters. (3) M.4 route-by-route restyle owner-eyeball-gated. (4) ~~**P2-4:** late click after `readyRef` can native-close~~ — **CLOSED #765.** (5) ~~**P2-2:** first-open Enter is coded; e2e locks Space first-open and Enter after a remount~~ — **CLOSED #765.** (6) **P2-3:** chapter units are source greps (carried as #765 P2-3).

## ✅ BUILT 2026-09-20 — Space/Enter opens a chapter with the body already there (DECISIONS #763)

**The hole.** #762 residual (3): Space/Enter could empty-open if a UA toggled `<details>` before click.

**Shipped.** Space/Enter `preventDefault` while unmounted; same mount-then-open as click. `onToggle` mounts children if a UA already opened; does not force-close. No schema change.

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 5/5, home-chapters 5/5 (**10/10**).

**CI + live.** `dcc78112` on `origin/main`. No `prisma/` diff. **CI verify run 35491937395 = SUCCESS**. Vercel Production `dpl_8PwomDELAYoZ8CG2n16xbRDWh91n` **READY**, aliases include `www.aimplifi.app`. Live demo: Space on Picture opens with `net-worth-amount` `$144,804.74` already in the open details. Marker: raw `dcc78112` has `onKeyDown` / `mountedRef`.

**Still open / residuals.** (1) RSC still serializes chapter children. (2) e2e harness still auto-opens chapters. (3) ~~Space/Enter empty-open if a UA toggles before click~~ — **CLOSED #763.** (4) M.4 route-by-route restyle owner-eyeball-gated. (5) ~~**P2-1:** UA-first-toggle empty flash~~ — **CLOSED #764.** (6) **P2-2:** first-open Enter still unproven (carried as #764 P2-2). (7) **P2-3:** chapter units are source greps. (8) **P2-4:** a late click after ready can native-close (carried as #764 P2-4). (9) ~~**P2-5:** `toggle` listener attaches after paint~~ — **CLOSED #764.**

## ✅ BUILT 2026-09-19 — Open chapter bodies before the shell (DECISIONS #762)

**The hole.** #761 first-open flash: empty `<details>` then cards. Nested Coach landmarks hid the land ring.

**Shipped.** Mount, then open in `useLayoutEffect`. First summary click `preventDefault`s until mounted. Landmark wrappers drop `focus:outline-none`. Home hrefs use `new URL`. No schema change.

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 7 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 4/4, home-chapters 4/4, phase1 2/2 (**10/10**).

**CI + live.** `1d82018f` on `origin/main`. No `prisma/` diff. **CI verify run 35486194628 = SUCCESS**. Vercel Production `dpl_Aq99idazihofW8xk9JNC2kA84wVD` **READY**, aliases include `www.aimplifi.app`. Live demo: Picture open already holds `net-worth-amount`. `/coach#coach-money-dials` opens Habits with dials focused and no `outline-none`; Trajectory stays closed. Marker: raw `1d82018f` has `pendingOpen`.

**Still open / residuals.** (1) RSC still serializes chapter children. (2) e2e harness still auto-opens chapters. (3) ~~Space/Enter empty-open if a UA toggles before click~~ — **CLOSED #763.** (4) M.4 route-by-route restyle owner-eyeball-gated.

## ✅ BUILT 2026-09-19 — Mount unread chapter bodies after first open (DECISIONS #761)

**The hole.** Closed Home/Coach chapters still committed every card into first HTML. Cycle 1: `#coach-money-dials` became a dead jump.

**Shipped.** Unread bodies unmount until first open. Nested Coach landmarks reveal the parent. Daily loop + This month stay mounted. No schema change.

**Critic (fresh context): cycle 1 FAIL UX 7 / 1 P1. Cycle 2 PASS UX 9 / 0 P0 / 0 P1 / 7 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 4/4, home-chapters 4/4, phase1 2/2 (**10/10**).

**CI + live.** `c38a2168` on `origin/main`. No `prisma/` diff. **CI verify run 35480517482 = SUCCESS**. Vercel Production `dpl_GDwYXPVDFmWpkXq934DJPELyDbZR` **READY**, aliases include `www.aimplifi.app`. Live demo Home: Picture/Adjust closed; `net-worth-amount` and `home-plan-figures` not in the DOM. Live Coach: Trajectory/Habits closed; `fi-card` / `money-rules-card` / `coach-money-dials` absent until open; Trajectory open mounts `fi-card`; Change your assumptions opens Habits and focuses money-dials. Marker: raw `c38a2168` has `{mounted ? children : null}`.

**Still open / residuals.** (1) RSC still serializes chapter children (not `next/dynamic`). (2) e2e harness still auto-opens chapters. (3) ~~Empty-open flash before children commit~~ — **CLOSED #762.** (4) ~~Nested landmark wrappers use `focus:outline-none`~~ — **CLOSED #762.** (5) M.4 route-by-route restyle owner-eyeball-gated.

## ✅ BUILT 2026-09-19 — Home chapter jump nav, focus on open, valid summary lead (DECISIONS #760)

**The hole.** #759 residuals: no Home jump nav; hash/nav did not move focus; `<p>` in `<summary>`; marker locked by grep only.

**Shipped.** `home-chapter-nav` after radar, before Adjust. Hash/nav open + focus. Span leads. Painted `listStyleType` e2e. One `showHomeSetup` flag. No schema change.

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 5 P2** (P2-1 outline / P2-2 setup flag closed same-session). Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**; after P2 polish: tsc 0, eslint touched 0, chapter units 2/2, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 2/2, home-chapters 4/4 (**6/6**).

**CI + live.** `19dec793` on `origin/main`. No `prisma/` diff. **CI verify run 35457883847 = SUCCESS**. Vercel Production `dpl_4gNKGsxYWkhTnvxDLAqQnUx9bt3n` **READY**, aliases include `www.aimplifi.app`. Live demo Home 390: `home-chapter-nav` after radar; Adjust/Picture closed; links Adjust the plan / The picture / Home setup. Marker: raw `19dec793` has `home-chapter-nav`.

**Still open / residuals.** (1) **P2-3:** `listStyleType` is not a `::marker` visual lock. (2) **P2-4:** nav vs radar is source-order, not a painted y-assert. (3) **P2-5:** nav links are `text-sm` (same as Coach). (4) e2e harness still auto-opens chapters. (5) ~~Coach SSR still ships every card~~ — **CLOSED #761** (DOM/hydration; RSC payload residual remains). (6) M.4 route-by-route restyle owner-eyeball-gated.

## ✅ BUILT 2026-09-19 — Coach chapters: native marker, same-hash re-open, coaching voice (DECISIONS #759)

**The hole.** #757 P2s: hidden Coach triangle, Trajectory tap no-op, IA-voice leads. #758 P2-4: Home hash-open untested.

**Shipped.** Native disclosure marker on Coach. Click on `#id` opens the chapter even when the hash is unchanged. Trajectory/Habits leads are second-person money copy. Home hash `#home-picture` locked. No schema change.

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 3 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 2/2, home-chapters 3/3, desktop-header 1/1 (**6/6**).

**CI + live.** `eb4848c3` on `origin/main`. No `prisma/` diff. **CI verify run 35453050602 = SUCCESS**. Vercel Production `dpl_2xExX9An6YeS7xbq4VE4kPSYv8Pe` **READY**, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`. Demo Coach 390: Trajectory/Habits closed; leads “Your savings rate…” / “Your money dials…”; summary `list-style-type: disclosure-closed`. Marker: raw `eb4848c3` `coach-chapter.tsx` has `getAttribute('href')` and no hide tokens.

**Still open / residuals.** (1) ~~**P2-1:** marker locked by source grep~~ — **CLOSED #760:** e2e `listStyleType` `/disclosure|disc/`. (2) ~~**P2-2:** `<p>` inside `<summary>`~~ — **CLOSED #760:** `<span className="mt-1 block…">`. (3) ~~**P2-3:** hash/nav open does not move focus~~ — **CLOSED #760.** (4) e2e harness still auto-opens chapters. (5) Coach SSR still ships every card. (6) ~~No Home chapter jump nav~~ — **CLOSED #760.** (7) M.4 route-by-route restyle owner-eyeball-gated.

## ✅ BUILT 2026-09-19 — Home chapters: daily loop open, dump closed (DECISIONS #758)

**The hole.** #757 residual (5): Home below the two numbers was still a long stack. Critic cycle 1: UX 6, Welcome back + radar hidden in closed chapters.

**Shipped.** Closed chapters: Adjust (plan figures), Picture (savings / spending / net worth / …), Setup (deepen + push). Open loop: stage, recent, Today, goals, alert banners, onboarding, return-moment, cash-flow radar. Native disclosure marker. No schema change.

**Critic (fresh context): cycle 2 PASS UX 9 / 0 P0 / 0 P1 / 4 P2.** Cycle 1 FAIL 2 P1. Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright: home-chapters 2/2, home-stage 2/2, phase1 2/2, today-feed 7/7, idle-cash 1/1, paw-lens 1/1 (**16/16**).

**CI + live.** `64173200` on `origin/main`. No `prisma/` diff. **CI verify run 35448886067 = SUCCESS**. Vercel Production `dpl_Ebo4UwJRwsQp1YyN5jm24hjoHUAS` **READY**, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`. Demo Home 390: `Adjust the plan` and `The picture` present and closed (`open === false`). Marker: raw `64173200` has `home-chapter.tsx`.

**Still open / residuals.** (1) **P2-3:** default e2e harness opens Home chapters. (2) ~~**P2-4:** hash-open untested~~ — **CLOSED 2026-09-19 (DECISIONS #759):** `#home-picture` e2e; same-hash click-open. No Home jump nav remains. (3) ~~Coach SSR still ships every card~~ — **CLOSED #761.** (4) ~~#757 Coach P2s (chevron / same-hash / Trajectory voice)~~ — **CLOSED #759.** (5) M.4 route-by-route restyle owner-eyeball-gated.

## ✅ BUILT 2026-09-19 — Visual IA: grouped sidebar, Home stage, Coach chapters (DECISIONS #757)

**The hole.** Live www.aimplifi.app review: wrapping 19-pill desktop nav, Home as a feature dump, Coach as a 7,076px essay. Critic cycle 1: UX 5, 4 P1s. Cycle 2: UX 7, 2 P1s (labeled feed; 19 bare nouns).

**Shipped.** Grouped desktop sidebar (4 synonym rows described). Home `home-stage` cash-needed first; pair token; plan form off the fold; cash-needed dues/links/assumptions start closed so guilt-free finishes ≤800 at 380 on CI Linux chrome. Trends nav line starts "Category movers" (not "What changed"). Coach three `<details>` chapters, Now open, others closed until jump. Brand mark + uncolored wordmark; sign-in `<h1>`. Money display/pair/negative tokens. No schema change.

**Critic (fresh context): cycle 3 PASS UX 9 / 0 P0 / 0 P1 / 4 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8583 passed + 1 expected fail + 1 skipped / 636 files + 1 skipped**. Playwright (new build): home-stage 2/2, phase1 2/2, trends 3/3, mobile-nav 2/2, forecast 3/3, card-unknown-due 3/3, dashboard-duplicate-disclosure 5/5 (**21/21**).

**CI + live.** `b92219e2` on `origin/main`. No `prisma/` diff. **CI verify run 35426137075 = SUCCESS** (`main`; prior `bec0b32e` run 35424012696 FAILED on fold + Trends collision). Vercel Production `dpl_AKbNTBWUnN3RpydQtKgwabMCiG7w` **READY** on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200 with brand-mark + h1. Demo Home: `cash-needed-dues` closed, due-date-list hidden, Trends nav "Category movers…". Marker: `raw.githubusercontent.com` on `b92219e2` finds `cash-needed-dues` and `Category movers`; `bec0b32e` Trends description still started with `What changed`.

**Still open / residuals.** (1) ~~**P2-1:** chapter summaries hide the disclosure marker~~ — **CLOSED #759.** (2) ~~**P2-2:** same-hash Trajectory re-click is a no-op~~ — **CLOSED #759.** (3) ~~**P2-3:** Trajectory lead is IA voice~~ — **CLOSED #759.** (4) ~~**P2-4:** Habits collapse and desktop description text are not e2e-locked~~ — **CLOSED #759.** (5) ~~Home below the stage is still a long stack~~ — **CLOSED #758.** (6) ~~Coach SSR still ships every card in the DOM~~ — **CLOSED #761.** (7) M.4 route-by-route restyle remains owner-eyeball-gated.

## DECIDED 2026-09-18 — Owner Yes on ops walkthrough + two live writes (DECISIONS #751)

Owner: **"3. Yes. 4. Yes."** First-timer steps live in `docs/OPS_WALKTHROUGH.md`
(Neon History window, Vercel **Settings → Cron Jobs → View Logs**, Sentry
`SENTRY_DSN` + Redeploy + Settings **Activation checklist**, Combined-accounts
**Worth a look:** Undo only, `npm run seed:demo-holdings`). This VM cannot
execute the two writes (no `DATABASE_URL`; will not decrypt Vercel env). Cron
fire still **UNVERIFIED** (24h production `requestPath` group: zero `/api/cron/*`
lines — Hobby ~1h retention). Do not undo GENUINE/UNTESTABLE links. Do not flip
`DATA_PROVIDER=plaid`. Shipped `19fc703e` on `main`; CI **35376970883 SUCCESS**;
Vercel `dpl_AQAigaAKyGswkes9coT5bhpUqyxU` READY.

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

