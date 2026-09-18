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
> (rotated 2026-09-18); only current-wave BUILT entries and OPEN/FOUND/DECIDED
> items remain here.
>
> Entries from 2026-06/2026-07 (BUILT/CLOSED history) were moved verbatim to
> `docs/archive/STATUS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04, and the 2026-08
> BUILT/CLOSED history to `docs/archive/STATUS_ARCHIVE_2026-08.md` on 2026-08-27, to
> keep this file loadable. Only OPEN/DECIDED/record items live here, plus the newest
> BUILT entry, which stays as the home of the current live counts.

## ✅ BUILT 2026-09-18 — O.20j residual (8): trim plaidItemId before the live institution join (DECISIONS #754)

**The hole.** #753 critic P2-1 / P2-2: a padded `plaidItemId` missed `Map.has` and inherited the stamp.

**Shipped.** Shared helper trims the lookup key. Empty / whitespace-only still uses the stamp. Live 0977 unchanged. Money identity only; `isTransfer` add-only; H.7b not auto-run. No schema change.

**Critic (fresh context, `/tmp/_critic_o20j_r8`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, eslint 0, 111/111, FAIL-OLD **3 failed | 108 skipped**, kill-call value-trim **3 failed | 108 passed**. Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8562 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**. Playwright mobile-380 `combine-connections` **2/2**.

**CI + live.** `09d51409` on `origin/main` (PR #34 merged). No `prisma/` diff. **CI verify run 35389703386 = SUCCESS** on `09d51409` (`main`, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_FJgPcT7MpweCoEEuW9Ps5bWiuyaz` **READY** on that sha, target production, aliases include `aimplifi-git-main-reiforge.vercel.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. Marker: `raw.githubusercontent.com` on `09d51409` finds `const key = plaidItemId?.trim() ?? ''`; `71ee2c3a` still has `liveByItem.has(plaidItemId)`. H.7b not auto-run.

**Still open / residuals.** (1) Mixed-type over-veto. (2) Third Plaid-null poison. (3) Dismissal `take: 500`. (4) **This-cycle P2-1:** map keys are raw `itemId` (trim inversion if the stored key is also padded). (5) **P2-2:** present map value `''` returns `''`. (6) **P2-3:** sibling `plaidItemId ===` sites (`accountsOf`, `sameIngestConnection`, `isAccountLive`) stay untrimmed. (7) `detectDuplicateAccounts` still flags on last-4 + balance without institution ids. (8) Disconnect stamp-fallback fold/filing lock still helper-golden only. (9) Mixed live `ins_56` + live-null not in the transfer suite. (10) `anyPairBlocked` O(n²). (11) Raw `provider === 'plaid'`. (12) The 8 existing `$237.08` flags stay until H.7b. Wave 0 ops owner-executed (`docs/OPS_WALKTHROUGH.md`). M.4 owner-deferred.

## ✅ BUILT 2026-09-18 — O.20j residual (7): present-null institution name does not inherit the stamp (DECISIONS #753)

**The hole.** #752 critic P2-1: `buildCombineInputs` and `/accounts` `identityOf` still inlined `item?.institution ?? stamp`. A present-null live PlaidItem inherited the account name stamp, so the identity ladder's both-null name fallback could prove SAME and offer an irreversible continue while the live bank is unknown.

**Shipped.** Both surfaces call `resolveLiveInstitutionName` (same `Map.has` join as the id helper). Present null stays null; missing item still uses the stamp. Live 0977 unchanged. Money identity only; `isTransfer` add-only; H.7b not auto-run. No schema change.

**Critic (fresh context, `/tmp/_critic_o20j_r7`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, eslint 0, 130/130, FAIL-OLD **3 failed | 1 passed | 103 skipped**, kill-call stamp-only **4 failed | 126 passed**. Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8558 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**. Playwright mobile-380 `combine-connections` **2/2** (`AUTH_SECRET` + `DEMO_TODAY` CI values).

**CI + live.** `0324a0be` on `origin/main`. No `prisma/` diff. **CI verify run 35385735109 = SUCCESS** on `0324a0be` (`main`, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_6CuNCMKgGskRonBeFbDCpvxvfGE9` **READY**, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. Marker: `combine-connections.ts` and `transactions.ts` on that sha call `resolveLiveInstitutionName(...)`; `205d1bc9` still has `item?.institution ?? a.institutionName ?? null`. H.7b not auto-run.

**Still open / residuals.** (1) Mixed-type over-veto. (2) Third Plaid-null poison. (3) Dismissal `take: 500`. (4) ~~**This-cycle P2-1:** `plaidItemId` is not trimmed~~ — **CLOSED 2026-09-18 (DECISIONS #754):** helper trims the lookup key. (5) ~~**P2-2:** empty-string `plaidItemId` skips the map~~ — **CLOSED #754:** empty / whitespace-only is missing (stamp). (6) **P2-3:** present map value `''` returns `''` (carried as #754 P2-2). (7) `detectDuplicateAccounts` still flags on last-4 + balance without institution ids. (8) Disconnect stamp-fallback fold/filing lock still helper-golden only. (9) Mixed live `ins_56` + live-null not in the transfer suite. (10) `anyPairBlocked` O(n²). (11) Raw `provider === 'plaid'`. (12) The 8 existing `$237.08` flags stay until H.7b. Wave 0 ops owner-executed (`docs/OPS_WALKTHROUGH.md`). M.4 owner-deferred.

## ✅ BUILT 2026-09-18 — O.20j residual (6): combine and /accounts use the Map.has institution join (DECISIONS #752)

**The hole.** #750 critic P2-1: `buildCombineInputs` and `/accounts` `identityOf` inlined `item?.institutionId ?? stamp`, so a present-null live item inherited the stamp and the identity ladder could prove SAME / offer a combine while the transfer writer fail-closed.

**Shipped.** Both surfaces call `resolveLiveInstitutionId` (Map.has). Present null stays null; missing item still uses the stamp. Live 0977 unchanged. Money identity only; `isTransfer` add-only; H.7b not auto-run. No schema change.

**Critic (fresh context, `/tmp/_critic_o20j_r6`): cycle 1 PASS 0 P0 / 0 P1 / 4 P2.** Independently: tsc 0, eslint 0, 98/98, FAIL-OLD **3 failed | 95 skipped**, kill-call stamp-only **5 failed**. Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8549 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**. Playwright mobile-380 `combine-connections` **2/2**.

**CI + live.** `40cd842f` on `origin/main`. No `prisma/` diff. **CI verify run 35382534980 = SUCCESS** on `40cd842f` (`main`, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_35bium7tBfWZg4EECtTKuZA5C1Fj` **READY**, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`. Marker: `combine-connections.ts` on that sha calls `resolveLiveInstitutionId(...)`; `d7d014e4` still has `item?.institutionId ?? a.institutionId ?? null`. H.7b not auto-run.

**Still open / residuals.** (1) Mixed-type over-veto. (2) Third Plaid-null poison. (3) Dismissal `take: 500`. (4) ~~**This-cycle P2-1:** `institutionName` still uses `item?.institution ?? stamp`~~ — **CLOSED 2026-09-18 (DECISIONS #753):** both call `resolveLiveInstitutionName`. (5) **P2-2 / #750 P2-2–P2-3:** `plaidItemId` not trimmed; `''` skips the map (carried as #753 P2-1/P2-2). (6) **P2-3:** `detectDuplicateAccounts` still flags on last-4 + balance without institution ids. (7) Disconnect stamp-fallback fold/filing lock still helper-golden only. (8) Mixed live `ins_56` + live-null not in the transfer suite. (9) `anyPairBlocked` O(n²). (10) Raw `provider === 'plaid'`. (11) The 8 existing `$237.08` flags stay until H.7b. Wave 0 ops owner-executed (`docs/OPS_WALKTHROUGH.md`). M.4 owner-deferred.

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

## ✅ BUILT 2026-09-18 — O.20j residual (5): a present PlaidItem with null `ins_*` does not inherit the stamp (DECISIONS #750)

**The hole.** #749 critic P2-1: `Map.get` + `??` treated a present-null PlaidItem like a missing key, so a stale Account stamp became the live id and #748's fail-closed rule never ran. Matching stale stamps then folded on last-4.

**Shipped.** `resolveLiveInstitutionId` uses `Map.has`. Present null stays null; missing key still uses the stamp (disconnect). Live 0977 unchanged. Money identity only; `isTransfer` add-only; H.7b not auto-run. No schema change.

**Critic (fresh context, `/tmp/_critic_o20j_r5`): cycle 1 PASS 0 P0 / 0 P1 / 6 P2.** Independently: tsc 0, 87/87, FAIL-OLD **3 failed | 84 passed**, ignore-map **7 failed | 80 passed**, Map.has always-true **1 failed | 86 passed**. Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8544 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**. Playwright mobile-380 `transfer-flag-repair` **1/1**.

**CI + live.** `261cbddb` on `origin/main` (PR #29). No `prisma/` diff — database untouched. **CI verify run 35370637485 = SUCCESS** on `261cbddb` (`main`, full `VERIFY_E2E=1`, 15m15s, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_GNBd6UC2ZYJhcFz6iHXgK4hRenkp` **READY** on `261cbddb`, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. The join is server-only (no new UI copy); `raw.githubusercontent.com` on that sha finds `institutionByItem.has(plaidItemId)` in `transfers.ts` vs the prior production sha `0b89152e` still carrying `fromItem ?? accountStamp ?? null`. H.7b not auto-run. Live 0977 re-measure in this VM is **UNVERIFIED** (no `DATABASE_URL`).

**Still open / residuals.** (1) Mixed-type over-veto (cycle-4 lock still refuses CREDIT≡CHECKING). (2) Third Plaid-null copy poisons a group (#748 P2-1). (3) Dismissal `take: 500`. (4) ~~**Critic P2-1:** combine-connections and `/accounts` still inline `??`~~ — **CLOSED 2026-09-18 (DECISIONS #752):** both call `resolveLiveInstitutionId`. (5) **P2-2:** `plaidItemId` is not trimmed (carried as #752 P2-2). (6) **P2-3:** empty-string `plaidItemId` skips the map (carried). (7) **P2-4:** present map value `''` returns `''`; present `null` returns `null`. (8) **P2-5:** disconnect stamp-fallback has no fold/filing lock (helper golden only). (9) **P2-6:** mixed live `ins_56` + live-null fail-closes through the helper but is not in the shipped suite. (10) `anyPairBlocked` O(n²). (11) Raw `provider === 'plaid'`. (12) The 8 existing `$237.08` flags stay until H.7b. Wave 0 ops owner-executed. M.4 owner-deferred.

## ✅ BUILT 2026-09-18 — O.20j residual (4): the live 0977 fold reads PlaidItem `ins_*`, not the null stamp (DECISIONS #749)

**The hole.** #748's critic P2-2: the filing lock stamped `Account.institutionId` and never created a `PlaidItem`. Live 0977 is stamp NULL + item `ins_56`. A join regression to stamp-only stayed green and would refuse the live fold.

**Shipped.** `resolveLiveInstitutionId` (item ?? stamp). `loadTransferSweepRows` calls it. Filing fixture is the measured shape. Money identity only; `isTransfer` add-only; H.7b not auto-run. No schema change.

**Critic (fresh context, `/tmp/_critic_o20j_r4`): cycle 1 PASS 0 P0 / 0 P1 / 4 P2.** Independently: tsc 0, 84/84, FAIL-OLD **2 failed | 82 passed**, ignore-map **4 failed | 80 passed**. Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8541 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**. Playwright mobile-380 `transfer-flag-repair` **1/1**.

**CI + live.** `439d0650` on `origin/main` (PR #27). No `prisma/` diff — database untouched. **CI verify run 35356213456 = SUCCESS** on `439d0650` (`main`, full `VERIFY_E2E=1`, 10m58s). Vercel Production `dpl_2pmQnGNBYKyqfJi8kaLdhtBeCGZN` **READY** on `439d0650`, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. The join is server-only (no new UI copy); `raw.githubusercontent.com` on that sha finds `export function resolveLiveInstitutionId(` in `transfers.ts` vs **0 hits** on prior production sha `bd989510`. H.7b not auto-run. Live 0977 re-measure in this VM is **UNVERIFIED** (no `DATABASE_URL`).

**Still open / residuals.** (1) Mixed-type over-veto (cycle-4 lock still refuses CREDIT≡CHECKING). (2) Third Plaid-null copy poisons a group (#748 P2-1). (3) Dismissal `take: 500`. (4) ~~**Cycle-1 P2-1:** a *present* map entry whose value is `null` falls through to the stamp (`??`)~~ — **CLOSED 2026-09-18 (DECISIONS #750):** `Map.has`. (5) **P2-2:** combine-connections and `/accounts` still inline the same `??` join (carried as #750 P2-1). (6) **P2-3:** live `''` does not fall through; live `null` does (carried as #750 P2-4). (7) **P2-4:** empty `plaidItemId` skips the map; whitespace looks up and misses (carried as #750 P2-2/P2-3). (8) `anyPairBlocked` O(n²). (9) Raw `provider === 'plaid'`. (10) The 8 existing `$237.08` flags stay until H.7b. Wave 0 ops owner-blocked. M.4 owner-deferred.

## ✅ BUILT 2026-09-17 — O.20j residual (2): a Plaid side without `ins_*` does not fold on last-4 (DECISIONS #748)

**The hole.** #744 folded unconfirmed same-type copies on a MASK COLUMN ≥4. `institutionsConflict` only vetoed when both `ins_*` ids were present and different, so two pre-backfill Plaid items with null ids still folded on last-4 — Chase vs Ally with no id was one account, and a $2,000 transfer vanished.

**Shipped.** A Plaid side that lacks `ins_*` (null / blank / whitespace) fails closed against ANY counterpart. Both ids present ⇒ conflict iff they differ (unchanged). Plaid-with-id + SimpleFIN null still folds (0977). Money identity only; `isTransfer` add-only; H.7b not auto-run. No schema change.

**Measured.** `scripts/audit-probes/o20j-0977-institution-ids.mts` (read-only): 2 CREDIT `0977` Plaid items, both live, both `PlaidItem.institutionId = ins_56`, both Account stamp NULL → join presents `ins_56`. Prevention fold is ON for the live pair.

**Critic (fresh context, `C:\dev\_critic_o20j_r2`): cycle 1 FAIL 0 P0 / 2 P1 → cycle 2 PASS 0 P0 / 0 P1 / 2 P2.** Cycle 1: unmeasured live premise; Plaid(null)+SimpleFIN still folded. Cycle 2 independently: tsc 0, 77/77, FAIL-OLD **5 failed | 72 passed**, both-Plaid mutation killed the two P1-2 locks, re-measured live 0977.

**Gate.** `bash scripts/verify.sh` (post-cycle-2) → ✅ VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8534 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, `next build` clean. Playwright mobile-380 `transfer-flag-repair.spec.ts` **1/1** (no UI change). FAIL-OLD vs pre-slice function: **5 failed | 72 passed**.

**CI + live.** `2f2f3e23` on `origin/main`. No `prisma/` diff — database untouched. **CI verify run 35312463045 = SUCCESS** on `2f2f3e23` (`main`, full `VERIFY_E2E=1`, 14m57s, watched via `gh run watch`; `scripts/ci-status.sh` exits 4 under WSL bash because `gh` is not on that PATH). Vercel Production `dpl_EWXhQSiTdZkkWiFhKn8dUdngvYjx` **READY** on `2f2f3e23`, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in` (auth). The fail-closed identity is server-only (no new UI copy); `raw.githubusercontent.com` on that sha finds `a Plaid side that lacks` in `transfers.ts`. H.7b not auto-run.

**Still open / residuals.** (1) Mixed-type over-veto (carried from #744). (2) **Cycle-2 P2-1:** a third Plaid-null copy in the same (type, mask) component vetoes the whole group, so two proven `ins_56` copies do not fold while a straggler remains (fail-closed; not live on 0977, n=2). (3) Dismissal `take: 500`. (4) ~~**Cycle-2 P2-2:** the filing 0977 lock stamps `Account.institutionId` (no `PlaidItem` row)~~ — **CLOSED 2026-09-18 (DECISIONS #749):** live-shape fixture + `resolveLiveInstitutionId`. (5) `anyPairBlocked` O(component²). (6) Raw `provider === 'plaid'` case (carried). (7) The 8 existing `$237.08` flags stay until the owner taps H.7b. Wave 0 ops owner-blocked. M.4 owner-deferred.

## ✅ BUILT 2026-09-17 — The saved debt-free goal card names the extra / on-track line the same frozen save computed (L.19 residual 1 follow-up, DECISIONS #747)

**The gap.** #746's critic P2-4: after save, the /goals card printed "Suggested: about $X/mo" or "On track at your current payments — no extra needed" from the solver's extra over the same frozen balances, and the note was scoped to the total only. A wider claim on `frozenAtSave` would be false once the reader typed a monthly.

**Shipped.** Additive nullable `Goal.frozenExtraAtSave` (same save-day date as `frozenAtSave`). `updateGoalMonthly` clears it on a CHANGED monthly and keeps it on a no-op re-save of the pre-filled string; `clearGoalMonthly` always clears it. `frozenSavedDebtGoalNote` names every still-stamped figure; extra/on-track arms say "worked out from" (a monthly does not contain a balance); total-only keeps "includes". Pronoun-free ("here", never "it"/"its" bound to the bank). Pre-#747 rows stay total-only. Money untouched. **Schema change:** one more nullable column on `Goal`; `prisma db push` on deploy is additive; demo seed byte-identical.

**Critic (fresh context, isolated worktree `C:\dev\_critic_l19e`): cycle 1 FAIL 1 P1 → cycle 2 FAIL 1 P1 → cycle 3 FAIL 1 P1 → cycle 4 PASS 0 P0 / 0 P1.** Cycle 1: extra-only on-track "its" bound to the bank. Cycle 2: extra>0 "it suggests" same binding. Cycle 3: extra/on-track reused "includes". Cycle 4 independently rendered all five arms, FAIL-OLD'd four mutations, reproduced tsc 0 / eslint 0 / full vitest 8529.

**Gate.** `bash scripts/verify.sh` (post-cycle-3 copy, settled tree) → ✅ VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8529 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, `next build` clean. FAIL-OLD: extra-stamp monthly/clear writes stripped → **2 failed | 15 passed**. Playwright mobile-380 `debt-plan-frozen.spec.ts` **2/2** on the pre-verb-change pin; the "worked out from" pin is re-run this ship turn.

**CI + live.** `e7b8b20d` on `origin/main` (rebased onto the #746 ship-gate docs `c5b96ccb`). **Schema:** `prisma/` diff present — additive `Goal.frozenExtraAtSave`; `prisma db push` on this deploy. **CI verify run 35281568662 = SUCCESS** on `e7b8b20d` (full VERIFY_E2E=1, 14m22s, watched to conclusion via `gh run watch`; `scripts/ci-status.sh` exits 4 under WSL bash because `gh` is not on that PATH). Vercel Production `dpl_HurMKFK3JwStCo2J7UkPfNhqdcrQ` **READY** on `e7b8b20d`, aliases include `www.aimplifi.app`. Live `/goals` → 307 `/sign-in` (auth). The note is a server component, so it is not in public JS; demo has no frozen debts, so even a demo session would abstain. Speaking branch is `debt-plan-frozen.spec.ts` (local 2/2 on the "worked out from" pin + this CI run) and `git grep` on `e7b8b20d` finds `the suggested extra here was worked out from`.

**Still open / residuals.** (1) **Cycle-4 P2-3:** no unit test pairs the card's `extra > 0` "Suggested:" line with the note's arm — a threshold drift would desynchronize them with the suite green; the e2e only walks extra=0. (2) Combined arm prints `frozenAtSave`'s date and discards `extra.stamp`'s (safe today: both written from one `today`). (3) Malformed stamp → "undefined NaN" (unreachable; single writer stores provider `today`; same class as #746). (4) `/coach` still restates the extra bare. (5) The card's target **date** is solver-projected and has no stamp. (6) "Suggested:" / "On track" labels still print over a typed or cleared monthly (pre-existing; the extra stamp going quiet leaves the label standing alone). (7) Server-local save date (#58; Vercel `TZ` UNVERIFIED). (8) `text-xs` muted contrast unmeasured. Wave 0 ops owner-blocked. M.4 owner-deferred.

## ✅ BUILT 2026-09-17 — The saved debt-free goal card names the frozen balance its total was computed from (L.19 residual 1, DECISIONS #746)

**The gap.** #742's critic named it (P2-6): `saveDebtFreeGoal` — the only writer of `kind: 'debt_free'`, reached from the planner's save button and Ask's `save_debt_free_goal` action — persisted the solver's `totalBalanceCents` as `Goal.targetCents`, and the /goals card printed "$23,300.00 of debt" from that row forever after with nothing said, even when a debt behind it carried `feedDroppedAt` at the save. `Goal` has no `createdAt`, so the fact could not be judged at render time (a re-resolve against today's stamps over-claims for a debt that froze after the save).

**Shipped.** Additive nullable `Goal.frozenAtSave` (YYYY-MM-DD, the provider's `today` handed to the solver), stamped iff any row of the solver's INPUT `debts` carries `frozenSince`; null = no fact recorded (every pre-existing row renders nothing). `updateGoalTarget` clears it when the hand-typed total CHANGES and keeps it when the pre-filled total is re-saved unchanged; date/monthly/name edits never touch it. New `frozenSavedDebtGoalNote` — one no-direction sentence, no bank, no remedy of its own (the card's "Re-check in Ask Aimplifi" line is the remedy) — rendered inside `goal-debt-free` as `goal-debt-free-frozen`. Money untouched. Audit meta carries the stamp. **Schema change:** one nullable column on `Goal`; `prisma db push` on deploy is additive; demo seed byte-identical.

**Critic (fresh context, isolated worktree `/tmp/_critic_l19sg`): cycle 1 PASS 0 P0 / 0 P1 / 6 P2 — four fixed same-session** (ledgers; page-wiring unit lock; unchanged re-save cleared a true note; audit meta). The critic independently reproduced tsc 0, eslint 0, 37/37 on the touched files, FAIL-OLD 2|8, and killed 5 of 6 mutations (the survivor is now locked).

**Gate.** `bash scripts/verify.sh` (pre-critic) → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8520 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, `next build` clean. Post-critic gate (settled tree) → ✅ VERIFY GREEN: unit **8521 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, `next build` clean (the current live count). FAIL-OLD: pre-slice writer **2 failed | 8 passed**; pre-slice page vs the wiring lock **1 failed**; unconditional clear **1 failed | 10 passed**. Playwright mobile-380 `debt-plan-frozen.spec.ts` **2/2** (both walks now run through the save).

**CI + live.** PR #25 merged to `main` the same turn as **`956e6492`** (DECISIONS #636). `prisma/` diff = the one additive nullable `Goal.frozenAtSave` column; the Vercel build log shows `prisma db push` against the live Neon database succeed ("Your database is now in sync with your Prisma schema. Done in 517ms") — no existing row touched. **CI verify run 35273843014 = SUCCESS on `956e6492`** (`main`, full `VERIFY_E2E=1`, 14m59s, `scripts/ci-status.sh` exit 0; the branch sha `cc77ef9b` was also green on 35272299484 push + 35272352630 pull_request). Vercel Production `dpl_7qq56Da5dQG6WSc2Yiv5px1xcHZi` **READY** on `956e6492`, aliases include `www.aimplifi.app`. Live probe (Playwright demo session on production): `/goals` renders 200 with 30 `goal-*` elements, `goal-debt-free` count 0 (the demo has no saved debt-free goal) and **`goal-debt-free-frozen` count 0** — the ABSTENTION, the only branch production can show without writing a goal into the shared demo row. `git grep frozenAtSave 956e6492 -- src prisma` = 15 hits vs 0 on the prior production sha `07800184`. The speaking branch is proven by `debt-plan-frozen.spec.ts` (local + CI); its live render is **UNVERIFIED** by construction.

**Still open / residuals.** (1) ~~**Critic P2-4:** the card's "Suggested: about $X/mo" is solved over the same frozen balances and the note is scoped to the total only~~ — **CLOSED 2026-09-17 (DECISIONS #747):** `Goal.frozenExtraAtSave`. (2) **Critic P2-6:** "saved on <date>" is `businessToday`'s server-local calendar date (inherited from #58, shared by every "today"; Vercel `TZ` UNVERIFIED). (3) `text-xs` muted contrast unmeasured (pre-existing token). Wave 0 ops owner-blocked. M.4 owner-deferred.

## ✅ BUILT 2026-09-17 — O.20j converse-leak identity: mask COLUMN + detector prereqs (DECISIONS #744)

**The leak.** Two Plaid items of CREDIT last-4 `0977` still paired a real purchase with a filed `TRAVEL CREDIT` on the other copy. H.7 confirmed links already equated some copies; unconfirmed same-mask copies did not. Reader-side "count converse as spend" was killed (~$180k of real transfers). Writer-side identity is the remaining prevention.

**Shipped.** `unionSameMaskColumnIdentity` folds unconfirmed same-type copies that share a MASK COLUMN (≥4) across different ingest connections into the H.7 map `planTransferUpdates` already reads. A mask-group union is skipped when any pair in the current `root()` component is dismissed, same-connection, mixed-type, both `institutionId`s present and different, different currency (null = USD), or `registrationsConflict`. Missing records fail closed. Group keys sorted by `type|mask`. Live Plaid `institutionId` is the item's, falling back to the account stamp (same join as combine-connections). `isTransfer` add-only. H.7b not auto-run.

**Critic (fresh context, isolated worktree): new-budget cycle 1 FAIL 0 P0 + 3 P1 → cycle 2 PASS 0 P0 / 0 P1.** Cycle 1: last-4-only wider than the detector; unordered `findMany`; stale `$237.08` claim. Cycle 2 independently closed all three plus the cycle-4 confirmed-map back door (probes fail on `71d22d54`, pass at `3022f696`), reproduced VERIFY GREEN **8477 passed + 1 expected fail + 1 skipped / 631 files**, FAIL-OLD **12 failed | 22 passed**, and a 4,000-corpus shuffle fuzz.

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8477 passed + 1 expected fail + 1 skipped / 631 files**, `next build` clean. FAIL-OLD vs `71d22d54`: **12 failed | 22 passed**. Playwright `transfer-flag-repair.spec.ts` mobile-380 **1/1** (maker; critic left UNVERIFIED because the spec drives the repair card). Identity+filing files **72 passed**.

**CI + live.** `c3ff71b26` on `main` (PR #24 merged the same turn). CI verify **35188955926 = SUCCESS** on `c3ff71b26` (full VERIFY_E2E=1, 11m48s). Vercel Production `dpl_CNL5qQfa7GigLhjvMPhbxWQzgFEW` READY, aliases include `www.aimplifi.app`. Live: unsigned `/settings` 307 → `/sign-in` 200 (expected); HTML build id `NF8UtGOD-t1u8ZqGcKsw9`. The identity union is server-only (no new UI copy); `git grep` on that sha finds `unionSameMaskColumnIdentity` in `transfers.ts` and `transfer-refresh.ts`. H.7b not auto-run.

**Do not treat the cycle-3 8-flag / `$237.08` number as this function's live result.** Mixed-type over-veto can refuse the 0977 fold when a confirmed terminal has a different type.

**Still open / residuals (critic cycle 2 P2s, none blocking).** (1) Mixed-type over-veto, above. (2) ~~Two Plaid items with null `institutionId` (pre-backfill) still fold on last-4 alone~~ — **CLOSED 2026-09-17 (DECISIONS #748):** a Plaid side that lacks `ins_*` fails closed against any counterpart; live 0977 items carry `PlaidItem.institutionId = ins_56`. (3) Dismissal read `take: 500`. (4) ~~No shipped test locks the `PlaidItem` → `institutionId` join~~ — **CLOSED 2026-09-18 (DECISIONS #749).** (5) `anyPairBlocked` is O(component²) per group; benign at realistic sizes, 1s at 120 accounts in one component. (6) Raw `provider === 'plaid'` matches `evaluatePair`. (7) The 8 existing `$237.08` flags stay until the owner taps H.7b. Wave 0 ops owner-blocked. M.4 owner-deferred.

## ⛔ HUMAN GATE 2026-09-16 — O.20j converse-leak identity (critic budget exhausted, DECISIONS #743) — SUPERSEDED by #744

**Superseded 2026-09-17.** The named close landed; critic cycle 2 of the new budget PASS 0 P0 / 0 P1. See BUILT #744 above.

**What is measured and must not be forgotten.** Live converse: 94 rows, $180,466.86 outflow / $37,949.79 inflow withheld. 61 FLAG RIGHT (~$205k genuine transfers, stale category). 33 FLAG WRONG / $12,878. H.7b never run (0 runs); would clear 25 today. 8 remaining WRONG ($237.08, CREDIT CARD last-4 `0977`, two Plaid items vs a filed `TRAVEL CREDIT`) are the prevention target — existing flags stay until the owner taps H.7b. Demo 0 converse. Reader-side "count converse as spend" is killed (would dump ~$180k of real transfers into spending). `countsInFlows` / `isSpendRow` / auto-run H.7b were correctly left untouched.

**Cycle history (first budget, all four spent).** C1: HIGH detector as money identity (year-in-name, balance-only spouse cards) — fixed. C2: dismissal edge-skip, fail-OPEN dismissals, same-item edge-skip — fixed as *component* vetoes + `'unavailable'` fail-closed. C3: same-connection still an edge skip via a third copy — fixed as group veto. C4: confirmed-map back door — closed on the #744 tree.

**Ledger on `main` at the stop.** `d2e146d1` / `72acec47` (docs only — the identity union was not in that tree). CI verify **35151281286 = SUCCESS** (full VERIFY_E2E=1). That heading is superseded by #744 above.

## ✅ BUILT 2026-09-16 — The debt-payoff path names a balance the bank stopped sharing (L.19 surface 5, DECISIONS #742)

**The gap.** TASKS L.19 (5) — the one surface DECISIONS #305 left open: `loadDebtAccounts` narrowed each liability to the engine's `DebtInput` and dropped `feedDroppedAt`, so /goals' Debt Freedom planner ("Debt-free by Jan 2034" + total interest) and both Ask debt answers (a payoff month; an extra-per-month toward a chosen date) amortised a frozen balance with nothing said — and each is one save button from a persisted goal target.

**Shipped.** `DebtAccount extends DebtInput` (`kind`, `frozenSince`) is what the read path returns and the planner + both Ask answers accept; `planDebtPayoff` / `solveDebtFreeByDate` still take `DebtInput` and never read the stamp (byte-identity locked). New `frozenDebtPlanNote` in `feed-dropped-view.ts`: card → "may be higher or lower"; loan → NO direction ("nothing about this loan has been confirmed since"); mixed → two claims, ONE Accounts remedy; `figureLabel` names what each surface prints (the by-date unreachable branch names only `the total debt`). Rendered above the save control on /goals; appended to both Ask answers' `detail`. DISCLOSE, ADJUST NOTHING — figures and the save action untouched. No schema change.

**Critic (fresh context, separate node): cycle 1 FAIL 1 P1 + 8 P2 → cycle 2 ZERO P0/P1.** (A second, independent cycle-1 critic finished after the merge and converged on the same P1 and the same P2 set; its two new items — a false justification in the builder's header comment and an absence-only abstention pin — were fixed in the follow-up commit, and its coach read-path residual is (5) below.) The P1: the first cut's loan sentence said the real balance "may be lower" — false for Plaid's revolving `line of credit` / `home equity`, which `plaid-map.ts` folds into `LOAN` (a draw pushes the balance UP), and for accrued interest; the understating direction is the dangerous one. Fixed to claim no direction (the `frozenLoanNote` precedent) and pinned negatively. P2s fixed: repeated remedy in the mixed note; by-date label naming an extra the unreachable branch does not print; the planner's source-grep "test" replaced by a jsdom render lock (fail-old: pre-slice component → 1 failed | 1 passed; filter inversion → 2 failed); a float-derived expectation replaced by the integer-cents literal `162_923` (critic verified minimal: `162_922` → 13 months). Cycle 2 independently reproduced the gates, the mutation probes, the "Jan 2034" figure and the DECISIONS rotation (63 lines verbatim).

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN, exit 0: tsc 0, probes tsc 0, eslint 0, unit **8,439 passed + 1 expected fail + 1 skipped / 630 files**, `next build` clean. Playwright mobile-380 on the fresh build: `debt-plan-frozen` + `frozen-figure-surfaces` + `ask` = **35 passed**. (One local e2e run hung first: Playwright's `reuseExistingServer` attached to a `next start` whose `.next` the gate's build had replaced underneath it — a stale-server flake, not a code defect; killed by PID and re-run clean.)

**CI + live.** `19152a3d` on `main` (PR #23 fast-forwarded the same turn). CI verify **35115110437 = SUCCESS on `main`** (full VERIFY_E2E=1; the same sha was also green on the branch push 35113323242 and the PR run 35113236398). Vercel Production 6484384476 = success. Live probe 7/7 (demo session): /goals planner abstains (nothing frozen on the demo); the /goals client chunks carry the new loan sentence and not the retracted one; Ask's debt-free answer carries no frozen note.

**CI on the follow-up push `82f59146` (comment correction + abstention pin + STATUS residual) — run 35118629557 = failure, PRE-EXISTING, recorded per the ship-gate rule.** 1 failed / 390 passed: `tests/e2e/transactions.spec.ts:638 "CSV import (H.2): re-importing the same file adds nothing"` red through both retries (`import-result` toContainText predicate timeout) — the same recurring flake recorded above for run 34667973958 and in the 2026-08 archive; `:735` and `:1014` flaked once each and passed on retry. The push touched a comment in `feed-dropped-view.ts`, a unit-test literal, and this file; none of it runs in that spec, and the identical source was green on 35113323242 / 35113236398 / 35115110437 the same hour. Vercel Production on `82f59146` = success. **Re-read on the next push `7f88e5a6` (docs only): run 35121407928 = SUCCESS** (full VERIFY_E2E=1) — same source, green; the red was the flake.

**Ledger cut.** `docs/DECISIONS.md` was 44.6 KB; #724–#736 rotated verbatim to `docs/archive/DECISIONS_ARCHIVE_724_to_736.md` (now 36 KB; index regenerated, 729 entries).

**Still open / residuals.** (1) ~~**Saved debt-free goal is silent after save**~~ — **CLOSED 2026-09-17 (DECISIONS #746, BUILT entry above; `Goal.frozenAtSave`)**. Original finding (critic P2-6): `saveDebtFreeGoal` persists `totalBalanceCents` from `loadDebtAccounts` as the target and the /goals goal card prints it with no frozen note — the same shape as #305's PDF finding, one hop later; the planner note above the save control is the only warning. Fix needs the goal card to know the target's basis (a `frozenAtSave` or a re-resolve against current `feedDroppedAt`). (2) `stoppedSharing` says "Your banks" for two frozen rows at one institution — inherited from the L.18 builders. (3) The `perDebt` resolution in the planner and `answerDebtPayoff` is the identity today (the engine echoes every row) — kept as the L.15 resolution point. (4) `text-xs` muted contrast unmeasured (UNVERIFIED, pre-existing token). (5) ~~A second debt read path still strips the fact~~ — **CLOSED 2026-09-17 (DECISIONS #745, BUILT entry above)**: `coach.ts` now carries `feedDroppedAt` onto both the loans and the past-due cards of the next-dollar ranking, and the card + Ask answer name the frozen debt they point at. **Fact learned about (1), recorded so it is not re-derived:** `Goal` has no `createdAt` column, so "this target was computed from a frozen balance" cannot be judged at render time — a re-resolve against today's `feedDroppedAt` would over-claim for a debt that froze AFTER the save. The honest close needs an additive column (`Goal.frozenAtSave` or `createdAt`), i.e. a `prisma db push` on deploy; existing rows would carry no fact and must render no note. Wave 0 ops owner-blocked. M.4 owner-deferred. Wave 2/3/4 rows per TASKS.md.

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

