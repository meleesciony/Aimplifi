# STATUS archive — BUILT entry 2026-09-18

> HISTORICAL
> Rotated verbatim from `docs/STATUS.md` on 2026-09-18 (ledger ceiling): the BUILT
> entry for DECISIONS #750 (O.20j residual 5, present-null does not inherit the
> stamp). Live counts in this entry are historical; the current counts live only
> in the newest BUILT entry of `docs/STATUS.md`.

## ✅ BUILT 2026-09-18 — O.20j residual (5): a present PlaidItem with null `ins_*` does not inherit the stamp (DECISIONS #750)

**The hole.** #749 critic P2-1: `Map.get` + `??` treated a present-null PlaidItem like a missing key, so a stale Account stamp became the live id and #748's fail-closed rule never ran. Matching stale stamps then folded on last-4.

**Shipped.** `resolveLiveInstitutionId` uses `Map.has`. Present null stays null; missing key still uses the stamp (disconnect). Live 0977 unchanged. Money identity only; `isTransfer` add-only; H.7b not auto-run. No schema change.

**Critic (fresh context, `/tmp/_critic_o20j_r5`): cycle 1 PASS 0 P0 / 0 P1 / 6 P2.** Independently: tsc 0, 87/87, FAIL-OLD **3 failed | 84 passed**, ignore-map **7 failed | 80 passed**, Map.has always-true **1 failed | 86 passed**. Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8544 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**. Playwright mobile-380 `transfer-flag-repair` **1/1**.

**CI + live.** `261cbddb` on `origin/main` (PR #29). No `prisma/` diff — database untouched. **CI verify run 35370637485 = SUCCESS** on `261cbddb` (`main`, full `VERIFY_E2E=1`, 15m15s, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_GNBd6UC2ZYJhcFz6iHXgK4hRenkp` **READY** on `261cbddb`, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. The join is server-only (no new UI copy); `raw.githubusercontent.com` on that sha finds `institutionByItem.has(plaidItemId)` in `transfers.ts` vs the prior production sha `0b89152e` still carrying `fromItem ?? accountStamp ?? null`. H.7b not auto-run. Live 0977 re-measure in this VM is **UNVERIFIED** (no `DATABASE_URL`).

**Still open / residuals.** (1) Mixed-type over-veto (cycle-4 lock still refuses CREDIT≡CHECKING). (2) Third Plaid-null copy poisons a group (#748 P2-1). (3) Dismissal `take: 500`. (4) ~~**Critic P2-1:** combine-connections and `/accounts` still inline `??`~~ — **CLOSED 2026-09-18 (DECISIONS #752):** both call `resolveLiveInstitutionId`. (5) **P2-2:** `plaidItemId` is not trimmed (carried as #752 P2-2). (6) **P2-3:** empty-string `plaidItemId` skips the map (carried). (7) **P2-4:** present map value `''` returns `''`; present `null` returns `null`. (8) **P2-5:** disconnect stamp-fallback has no fold/filing lock (helper golden only). (9) **P2-6:** mixed live `ins_56` + live-null fail-closes through the helper but is not in the shipped suite. (10) `anyPairBlocked` O(n²). (11) Raw `provider === 'plaid'`. (12) The 8 existing `$237.08` flags stay until H.7b. Wave 0 ops owner-executed. M.4 owner-deferred.
