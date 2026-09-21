> Sessions from 2026-06/2026-07 were moved verbatim to
> `docs/archive/PROGRESS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04, and
> sessions from 2026-08-01 through 2026-08-17 to
> `docs/archive/PROGRESS_ARCHIVE_2026-08-01_to_2026-08-17.md` on 2026-08-28.
> Sessions 2026-08-20 through 2026-08-31 live in `docs/archive/PROGRESS_ARCHIVE_2026-08-20_to_2026-08-31.md` (rotated 2026-09-11).
> The five 2026-09-03 sessions and the 2026-09-10 M.4 slice 2 session live in
> `docs/archive/PROGRESS_ARCHIVE_2026-09-03_to_2026-09-10.md` (rotated 2026-09-16), and the
> 2026-09-10 CI repair through the 2026-09-11 goals wave (#725, #734-#739) in
> `docs/archive/PROGRESS_ARCHIVE_2026-09-10_to_2026-09-11.md` (rotated 2026-09-17), and the
> 2026-09-17 L.19 residual 5 session (#745) in
> `docs/archive/PROGRESS_ARCHIVE_2026-09-17-745.md` (rotated 2026-09-18).
> the 2026-09-12 O.20h and 2026-09-14 O.20c sessions (#740/#741) in
> `docs/archive/PROGRESS_ARCHIVE_2026-09-12_to_2026-09-14.md` (rotated 2026-09-19),
> and the 2026-09-18 #751/#752 sessions in
> `docs/archive/PROGRESS_ARCHIVE_2026-09-18-751-752.md` (rotated 2026-09-20).
> the 2026-09-16 through 2026-09-17 sessions (#742–#748) in
> `docs/archive/PROGRESS_ARCHIVE_2026-09-16_to_2026-09-17.md` (rotated 2026-09-21).
> Only sessions from 2026-09-18 onward live here; append new sessions at the top as before.

## 2026-09-21 — This month first fold is the extra dollar and the flags (DECISIONS #768)

**Picked up.** Owner: “continue.” #767 shipped at about B+. Strongest leftover the owner can see: Coach This month still dumps creep, hours, and the monthly review under the open chapter.

**Closed.** `coach-month-rest` starts closed after next-dollar and the flags. Lead no longer promises the review on the first fold.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8592 passed + 1 expected fail + 1 skipped / 639 files + 1 skipped**, next build clean. After the summary named room for error: chapter unit 1/1, `next build` clean, Playwright first-fold **1/1** and the runway Ask test **passed** (prior combined run 82/82 before that summary lock).

**Critic (fresh context): cycle 1 FAIL UX 7 / 1 P1. Cycle 2 PASS UX 8 / 0 P0 / 0 P1 / 4 P2.** P1 was runway buried under a summary that did not name room for error.

**Ship.** `f86b2e1b` on `origin/main`. No `prisma/` schema diff. **CI verify run 35654006430 = SUCCESS**. Vercel `dpl_ETE64G8VDPUc5TLKx8wYnGEwr9Yo` **READY**, aliases include `www.aimplifi.app`. Live demo Coach: This month open on “Next extra dollar: investing”; closed summary “Lifestyle creep, room for error, hours, and the monthly review”; Trajectory follows that row. Marker: `coach-month-rest`.

## 2026-09-21 — UX A-grade maker (DECISIONS #767)

**Picked up.** Owner: get the live C / 5.1 review closer to A; do not stop.

**Closed.** Stage money token on the amount button + CardTitle skip for `text-3xl`/`text-4xl`. Plan→Guilt-free, Spending→Budgets (routes kept). Home chip “N to file on Activity.” Home Today omits `payment_due` and unfrozen shortfall. Coach This month leads with next-dollar; household in Habits. Category catalogs start closed. Sign-in leads with Explore the demo.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8592 passed + 1 expected fail + 1 skipped / 639 files + 1 skipped**, next build clean. Playwright: home-stage 2/2 (amount ≥28px), today-feed 8/8, desktop-header 1/1, coach-chapters 6/6, phase5-a11y keyboard 1/1.

**Ship.** `c812a015` on `origin/main`. No `prisma/` schema diff. First CI `35625811096` FAILED (Tab→email). **CI verify run 35628035698 = SUCCESS**. Vercel `dpl_FxkvZkiBfk7bdwyuJneJ7QnAXppg` **READY**. Live cash-needed **36px**. Marker: `omitHomeStageNudges` / `or sign in to your account`.

## 2026-09-21 — UX adversarial review (verifier, no maker)

**Picked up.** Owner: thorough UI/UX adversarial review, show grades, then decide. No implementation.

**Walked.** Live `www.aimplifi.app` demo. Desktop 2074×1166 and emulated 380×800. Routes: `/sign-in`, `/dashboard`, `/coach`, `/cards`, `/spending-plan`, `/budgets`, `/triage`, `/ask`. Evidence = a11y snapshots + CDP computed styles (screenshot pipeline dropped word spaces — not used as type evidence).

**Verdict.** Overall **5.1 / 10 (C)**. **0 P0 / 8 P1 / 6 P2**. Best axis: 10s cash-needed **8** (amount + when + shortfall + transfer, zero clicks). Worst: visual hierarchy / cohesion / cognitive load **3**. Smoking gun: `MONEY_DISPLAY_CLASS` loses to `Card size="sm"` → live `[data-testid=cash-needed-amount]` is **14px / 64.75×20**.

**State.** Findings in canvas (not a slice). No tree change. No DECISION. Owner picks next.

## 2026-09-21 — Clear chapter hold on the next pointerdown (DECISIONS #766)

**Picked up.** Owner: “continue.” Strongest leftover: #765 P2-5 ghost-close after tap-open, plus P2-4 Enter-then-close swallow.

**Closed.** Arm hold on first click-open. `pointerdown` after ready clears it. Same-session: Enter then Playwright click closes; tap-open then `HTMLElement.click()` stays open.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 6/6, home-chapters 6/6 (**12/12**).

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.**

**Ledgers.** DECISIONS #766 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #766.

**Ship.** `41973d94` on `origin/main`. No `prisma/` schema diff. First CI `35559960169` FAILED (leftover after `toBeVisible`). **CI verify run 35561069817 = SUCCESS**. Vercel `dpl_BesMXdeETanZZZpKRnXx2FLej6jA` **READY**. Live leftover click on Picture holds `$144,804.74`. Marker: `clearHoldOpen` / `onPointerDown`.

## 2026-09-20 — Hold first chapter open through the leftover click (DECISIONS #765)

**Picked up.** Owner: “continue.” Strongest leftover the owner can hit: #764 P2-4 leftover click after `readyRef` native-closes (Enter snap-shut).

**Closed.** `holdOpenRef` on `adopt()` + first-open Enter. Leftover click `preventDefault`s. Did not arm first click-open. Did not force-close. Same-session: leftover lock is trusted `summary.click()`; next click still closes.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 6/6, home-chapters 6/6 (**12/12**).

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.** P2-1/P2-2 closed same-session.

**Ledgers.** DECISIONS #765 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #765.

**Ship.** `5b9abc97` on `origin/main`. No `prisma/` schema diff. **CI verify run 35548078940 = SUCCESS**. Vercel Production `dpl_3XaasU1ydKTcRZ52xRW6QBSoTYab` **READY**. Live first-open Enter on Picture holds net-worth `$144,804.74`. Marker: `holdOpenRef` / `armHoldOpen` on that sha.

## 2026-09-20 — UA-first chapter open mounts the body before paint (DECISIONS #764)

**Picked up.** Owner: “continue.” Strongest leftover the owner can hit: #763 P2-1 empty flash when the UA toggles first.

**Closed.** `MutationObserver` on `open` + `toggle` in `useLayoutEffect`; `flushSync` mounts before paint. `readyRef` holds preventDefault until first open. Did not force-close.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 5/5, home-chapters 5/5 (**10/10**).

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.**

**Ledgers.** DECISIONS #764 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #764. STATUS #749/#752 and PROGRESS #751/#752 rotated.

**Ship.** `6b9e5dff` on `origin/main`. No `prisma/` schema diff. **CI verify run 35543058639 = SUCCESS**. Vercel Production `dpl_Dmxn5FSFq4yDckemvucLsEcWJTbT` **READY**. Live Picture open holds net-worth `$144,804.74`. Marker: `flushSync` / `MutationObserver` / `readyRef` on that sha.

## 2026-09-20 — Space/Enter opens a chapter with the body already there (DECISIONS #763)

**Picked up.** Owner: “continue.” Strongest leftover the owner can hit: #762 residual (3) Space/Enter empty-open.

**Closed.** Space/Enter `preventDefault` while unmounted. `onToggle` mounts if a UA already opened. Did not force-close (`el.open = false` crashed the error boundary).

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 5/5, home-chapters 5/5 (**10/10**).

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.**

**Ledgers.** DECISIONS #763 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #763.

**Ship.** `dcc78112` on `origin/main`. No `prisma/` schema diff. **CI verify run 35491937395 = SUCCESS**. Vercel Production `dpl_8PwomDELAYoZ8CG2n16xbRDWh91n` **READY**. Live Space on Picture holds net-worth. Marker: `onKeyDown` / `mountedRef` on that sha.

## 2026-09-19 — Open chapter bodies before the shell (DECISIONS #762)

**Picked up.** Owner: “continue.” Strongest leftover the owner can see: #761 empty-open flash + hidden landmark ring.

**Closed.** First open mounts, then `details.open` in `useLayoutEffect`. First summary click `preventDefault`s until mounted. Nested Coach landmarks no longer use `focus:outline-none`. Home hrefs parse via `new URL`.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 4/4, home-chapters 4/4, phase1 2/2 (**10/10**).

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 7 P2.** #761 P2-3 and P2-4 closed.

**Ledgers.** DECISIONS #762 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #762.

**Ship.** `1d82018f` on `origin/main`. No `prisma/` schema diff. **CI verify run 35486194628 = SUCCESS**. Vercel Production `dpl_Aq99idazihofW8xk9JNC2kA84wVD` **READY**. Live Picture open holds net-worth; money-dials jump lands. Marker: `pendingOpen` on that sha.

## 2026-09-19 — Mount unread chapter bodies after first open (DECISIONS #761)

**Picked up.** Owner: “continue.” Strongest leftover: closed chapters still painted every card into the first HTML.

**Closed.** `{mounted ? children : null}`. Nested Coach hashes open the parent (cycle-1 P1). Daily loop + This month stay mounted.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 4/4, home-chapters 4/4, phase1 2/2 (**10/10**).

**Critic (fresh context): cycle 1 FAIL UX 7 / 1 P1. Cycle 2 PASS UX 9 / 0 P0 / 0 P1 / 7 P2.**

**Ledgers.** DECISIONS #761 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #761.

**Ship.** `c38a2168` on `origin/main`. No `prisma/` schema diff. **CI verify run 35480517482 = SUCCESS**. Vercel Production `dpl_GDwYXPVDFmWpkXq934DJPELyDbZR` **READY**. Live Home: closed Picture/Adjust unmounted. Live Coach: closed Trajectory/Habits unmounted; nested money-dials jump works. Marker: `{mounted ? children : null}` on that sha.

## 2026-09-19 — Home chapter jump nav, focus on open, valid summary lead (DECISIONS #760)

**Picked up.** Owner: “continue.” Strongest leftover the owner can use: #759 residual (6) no Home jump nav, plus focus and valid summary markup.

**Closed.** Nav after radar; reveal focuses the chapter; span leads; painted marker e2e; one `showHomeSetup` flag.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. After same-session P2 polish: tsc 0, eslint touched 0, chapter units 2/2, next rebuild clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 2/2, home-chapters 4/4 (**6/6**).

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 5 P2.** P2-1/P2-2 closed same-session.

**Ledgers.** DECISIONS #760 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #760.

**Ship.** `19dec793` on `origin/main`. No `prisma/` schema diff. **CI verify run 35457883847 = SUCCESS**. Vercel Production `dpl_4gNKGsxYWkhTnvxDLAqQnUx9bt3n` **READY**. Live demo Home 390: chapter nav after radar; chapters closed. Marker: `home-chapter-nav` on that sha.

## 2026-09-19 — Coach chapters: native marker, same-hash re-open, coaching voice (DECISIONS #759)

**Picked up.** Owner: “continue.” Strongest leftover the owner can see: #757 Coach P2s (hidden triangle, dead Trajectory tap, IA-voice leads).

**Closed.** Native marker; click-to-open on same hash; Trajectory/Habits second-person; Home `#home-picture` lock. DECISIONS #742–#748 rotated to `docs/archive/DECISIONS_ARCHIVE_742_to_748.md`.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 2/2, home-chapters 3/3, desktop-header 1/1 (**6/6**).

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 3 P2.**

**Ledgers.** DECISIONS #759 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #759.

**Ship.** `eb4848c3` on `origin/main`. No `prisma/` schema diff. **CI verify run 35453050602 = SUCCESS**. Vercel Production `dpl_2xExX9An6YeS7xbq4VE4kPSYv8Pe` **READY**. Live demo Coach 390: Trajectory/Habits closed; native disclosure marker (`disclosure-closed`). Marker: `getAttribute('href')` on that sha.

## 2026-09-19 — Home chapters: daily loop open, dump closed (DECISIONS #758)

**Picked up.** Owner: “continue” after confirming mobile shipped. Strongest #757 residual: Home below the stage still a dump.

**Closed.** Adjust / Picture / Setup start closed. Return-moment + radar stay in the open loop (cycle-1 P1s). Banners before welcome.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): home-chapters 2/2, home-stage 2/2, phase1 2/2, today-feed 7/7, idle-cash 1/1, paw-lens 1/1 (**16/16**).

**Critic (fresh context): cycle 1 FAIL UX 6 / 2 P1. Cycle 2 PASS UX 9 / 0 P0 / 0 P1 / 4 P2.**

**Ledgers.** DECISIONS #758 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS M.4 #758.

**Ship.** `64173200` on `origin/main`. No `prisma/` schema diff. **CI verify run 35448886067 = SUCCESS**. Vercel Production `dpl_Ebo4UwJRwsQp1YyN5jm24hjoHUAS` **READY**. Live demo Home 390: Adjust / Picture closed. Marker: `home-chapter.tsx` on that sha.

## 2026-09-19 — Visual IA: grouped sidebar, Home stage, Coach chapters (DECISIONS #757)

**Picked up.** Owner: “i agree; keep working on it until worst critic gets to a 9.” After the live UI review (Craft 6 / Identity 4 / Composition 5 / IA 4 / Mobile 7).

**Closed.** Sidebar, Home stage, Coach `<details>` chapters, money tokens, BrandMark. Critic cycle 3 PASS UX 9 / 0 P0 / 0 P1.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8583 passed + 1 expected fail + 1 skipped / 636 files + 1 skipped**, next build clean. Playwright (rebuilt `next start` on 127.0.0.1:3100 + e2e sqlite): home-stage 2/2 (dues closed), phase1 2/2, trends 3/3, mobile-nav 2/2, forecast 3/3, card-unknown-due 3/3, dashboard-duplicate-disclosure 5/5 (**21/21**).

**CI-red on `bec0b32e`.** Run 35424012696: guilt-free past 800 on Linux chrome; `/trends` `What changed` matched sidebar + page. Fix: closed `cash-needed-dues` details; Trends description "Category movers…".

**Ledgers.** DECISIONS #757 (+ index); REGRESSION_LEDGER two rows; STATUS BUILT; TASKS M.4 #757.

**Ship.** `b92219e2` on `origin/main`. No `prisma/` schema diff. **CI verify run 35426137075 = SUCCESS**. Vercel Production `dpl_AKbNTBWUnN3RpydQtKgwabMCiG7w` **READY**, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200 with brand-mark + h1. Demo Home: dues details closed. Marker: raw `b92219e2` has `cash-needed-dues` + `Category movers`.

## 2026-09-19 — O.20j residual (10): trim sibling plaidItemId === so same-item copies stay two accounts (DECISIONS #756)

**Picked up.** Owner: "Continue." Tree even with `origin/main` at `81c93aad` (#755 ship-gate; CI 35404635879 SUCCESS). Queue scan: Wave 0 ops owner-executed (writes still owner-run). Strongest money-identity residual: #755 critic P2-1 — sibling `plaidItemId ===` untrimmed.

**Closed.** `samePlaidItemId` trims both sides; empty / whitespace is not a match. `sameIngestConnection` treats empty after trim as missing (fail-closed). `accountsOf` and both `/accounts` filters use the helper.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8575 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD (no helper): **8 failed | 80 skipped**. Playwright mobile-380 `combine-connections` **2/2**.

**Critic (fresh context, `/tmp/_critic_o20j_r10`): cycle 1 PASS 0 P0 / 0 P1 / 7 P2.** Independently: tsc 0, 88/88, FAIL-OLD 6|82, kill-calls (a) 2|86 (b) 1|87 (c) 1|87. P2s in STATUS.

**Ledgers.** DECISIONS #756 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j residual (10). STATUS L.19 #742/#746/#747 rotated verbatim to `docs/archive/STATUS_ARCHIVE_2026-09-17-l19.md`. PROGRESS #740/#741 rotated to `docs/archive/PROGRESS_ARCHIVE_2026-09-12_to_2026-09-14.md`.

**Ship.** `9490bcc8` on `origin/main` (PR #36 ff-merged). No `prisma/` schema diff. **CI verify run 35417204343 = SUCCESS** on `9490bcc8` (`main`, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_ABSognfcmqoVNXNGRgU958KZCKgZ` **READY** on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. Marker: `raw.githubusercontent.com` on `9490bcc8` finds `export function samePlaidItemId` and ingest `ka === '' || kb === '' || ka === kb`; prior `81c93aad` still has `a.plaidItemId === b.plaidItemId`. H.7b not auto-run.

## 2026-09-18 — O.20j residual (9): trim live-map keys so a padded stored itemId still joins (DECISIONS #755)

**Picked up.** Owner: "Continue." Tree even with `origin/main` at `65b61e52` (#754 ship-gate; CI 35389703386 SUCCESS). Queue scan: Wave 0 ops owner-executed (writes still owner-run). Strongest money-identity residual: #754 critic P2-1 — lookup trimmed, map keys raw.

**Closed.** `liveInstitutionByItem` trims the insert key. Empty / whitespace-only stored ids are not keys. Three join callers use the helper.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8567 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD untrimmed helper: **3 failed | 113 skipped**. Playwright mobile-380 `combine-connections` **2/2**.

**Critic (fresh context, `/tmp/_critic_o20j_r9`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, 116/116, FAIL-OLD 4|1|111, kill-call 1 died. P2s in STATUS.

**Ledgers.** DECISIONS #755 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j residual (9). STATUS #750 BUILT rotated verbatim to `docs/archive/STATUS_ARCHIVE_2026-09-18-750.md`.

**Ship.** `64598fff` on `origin/main` (PR #35 ff-merged). No `prisma/` schema diff. **CI verify run 35404635879 = SUCCESS** on `64598fff` (`main`, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_3PNcfzFNDWx75yh8fddRD8tMccKG` **READY** on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`. Marker: `raw.githubusercontent.com` on `64598fff` finds `liveInstitutionByItem(items, (i) => i.institutionId)` in `combine-connections.ts`; prior `65b61e52` still has `new Map(items.map((i) => [i.itemId, i.institutionId]))`. H.7b not auto-run.

## 2026-09-18 — O.20j residual (8): trim plaidItemId before the live institution join (DECISIONS #754)

**Picked up.** Owner: "Continue." Tree even with `origin/main` at `71ee2c3a` (#753 ship-gate; CI 35385735109 SUCCESS). Queue scan: Wave 0 ops owner-executed (writes still owner-run). Strongest money-identity residual: #753 critic P2-1 / P2-2 — a padded `plaidItemId` missed `Map.has` and inherited the stamp.

**Closed.** Shared helper trims the lookup key. Empty / whitespace-only is missing (stamp). Map keys and sibling `===` stay untrimmed. Present map value `''` still returns `''`.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8562 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD untrimmed `has`: **3 failed | 108 skipped**. Playwright mobile-380 `combine-connections` **2/2**.

**Critic (fresh context, `/tmp/_critic_o20j_r8`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, 111/111, FAIL-OLD 3|108, kill-call value-trim 3 died. P2s in STATUS.

**Ledgers.** DECISIONS #754 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j residual (8).

**Ship.** `09d51409` on `origin/main` (PR #34 ff-merged). No `prisma/` schema diff. **CI verify run 35389703386 = SUCCESS** on `09d51409` (`main`, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_FJgPcT7MpweCoEEuW9Ps5bWiuyaz` **READY** on that sha, target production. Live unsigned `/` → 307 `/sign-in`. Marker: `raw.githubusercontent.com` on `09d51409` finds `const key = plaidItemId?.trim() ?? ''`; prior `71ee2c3a` still has `liveByItem.has(plaidItemId)`. H.7b not auto-run.

## 2026-09-18 — O.20j residual (7): present-null institution name does not inherit the stamp (DECISIONS #753)

**Picked up.** Owner: "Continue." Tree even with `origin/main` at `205d1bc9` (#752 ship-gate; CI 35382534980 SUCCESS). Queue scan: Wave 0 ops owner-executed (writes still owner-run). Strongest money-identity residual: #752 critic P2-1 — combine and `/accounts` still inlined `item?.institution ?? stamp`.

**Closed.** Both surfaces call `resolveLiveInstitutionName` (shared `Map.has` field helper). Present null stays null; disconnect stamp remains.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8558 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD `??`: **3 failed | 1 passed | 103 skipped**. Playwright mobile-380 `combine-connections` **2/2**.

**Critic (fresh context, `/tmp/_critic_o20j_r7`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, 130/130, FAIL-OLD 3|1|103, kill-call 4 died. P2s in STATUS.

**Ledgers.** DECISIONS #753 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j residual (7). STATUS #745 BUILT and this file's #745 session rotated verbatim to `docs/archive/`.

**Ship.** `0324a0be` on `origin/main`. No `prisma/` schema diff. **CI verify run 35385735109 = SUCCESS** on `0324a0be` (`main`, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_6CuNCMKgGskRonBeFbDCpvxvfGE9` **READY** on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`. Marker: `raw.githubusercontent.com` on `0324a0be` finds `resolveLiveInstitutionName(a.plaidItemId, a.institutionName, institutionNameByItem)` in both server files; prior `205d1bc9` still has `item?.institution ?? a.institutionName ?? null`. H.7b not auto-run.

## 2026-09-18 — O.20j residual (5): a present PlaidItem with null `ins_*` does not inherit the stamp (DECISIONS #750)

**Picked up.** Owner: "Continue." Tree even with `origin/main` at `0b89152e` (#749 ship-gate docs). Queue scan: Wave 0 ops owner-blocked; M.4 owner-deferred; Wave 2/3/4 strategic. Mixed-type over-veto stays locked fail-closed by cycle-4. Strongest actionable money-identity row: #749 critic P2-1 — a present map entry whose value is `null` fell through to the stamp.

**Closed.** `resolveLiveInstitutionId` uses `Map.has`; present null stays null; disconnect (no key) still uses the stamp. Live 0977 fold unchanged.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8544 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD `??`: **3 failed | 84 passed**. Playwright mobile-380 `transfer-flag-repair` **1/1**.

**Critic (fresh context, `/tmp/_critic_o20j_r5`): cycle 1 PASS 0 P0 / 0 P1 / 6 P2.** Independently reproduced tsc 0, 87/87, FAIL-OLD 3|84. P2s in STATUS.

**Ledgers.** DECISIONS #750 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j note.

**Ship.** `261cbddb` on `origin/main` (PR #29 rebase-merged; feature-branch shas `bab1c0c6` / `a5df27b8` rewritten as `bb86f15a` / `261cbddb`). No `prisma/` schema diff. CI verify **35370637485 = SUCCESS** on `261cbddb` (`main`, full `VERIFY_E2E=1`, 15m15s, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_GNBd6UC2ZYJhcFz6iHXgK4hRenkp` READY on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. Server-only marker: `raw.githubusercontent.com` on `261cbddb` finds `institutionByItem.has(plaidItemId)` in `transfers.ts`; prior production sha `0b89152e` still has `fromItem ?? accountStamp ?? null`.

## 2026-09-18 — O.20j residual (4): the live 0977 fold reads PlaidItem `ins_*`, not the null stamp (DECISIONS #749)

**Picked up.** Owner: "continue." Tree even with `origin/main` at `bd989510` (#748 shipped). Queue scan: Wave 0 ops owner-blocked; M.4 owner-deferred; Wave 2/3/4 strategic; L.19 stored-figure residuals closed. Mixed-type over-veto (#748 residual 1) is locked fail-closed by cycle-4 (`CREDIT` must not become `CHECKING` via a confirmed terminal). Strongest actionable money-identity row: #748 critic P2-2 — the filing fixture stamped the account and never created a PlaidItem.

**Closed.** `resolveLiveInstitutionId`; `loadTransferSweepRows` calls it; filing fixture is stamp NULL + two `PlaidItem` rows `ins_56`.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8541 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD stamp-only: **2 failed | 82 passed**. Playwright mobile-380 `transfer-flag-repair` **1/1**.

**Critic (fresh context, `/tmp/_critic_o20j_r4`): cycle 1 PASS 0 P0 / 0 P1 / 4 P2.** Independently reproduced tsc 0, 84/84, FAIL-OLD 2|82, ignore-map 4|80. P2s in STATUS.

**Ledgers.** DECISIONS #749 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j note.

**Ship.** `439d0650` on `origin/main` (PR #27 rebase-merged; feature-branch shas `16be7d28` / `0107216c` rewritten). No `prisma/` schema diff. CI verify **35356213456 = SUCCESS** on `439d0650` (`main`, full `VERIFY_E2E=1`, 10m58s, `gh run view` conclusion success). Vercel Production `dpl_2pmQnGNBYKyqfJi8kaLdhtBeCGZN` READY on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. Server-only marker: `raw.githubusercontent.com` on `439d0650` finds `export function resolveLiveInstitutionId(` in `src/lib/engine/categorize/transfers.ts`; **0 hits** on the prior production sha `bd989510`.
