# PROGRESS archive — #751 and #752 (rotated 2026-09-20)

Moved verbatim from `PROGRESS.md` so the live ledger stays under the ~40 KB ceiling.

## 2026-09-18 — O.20j residual (6): combine and /accounts use the Map.has institution join (DECISIONS #752)

**Picked up.** Owner: "Continue." Tree even with `origin/main` at `d7d014e4` (#751 ship-gate; CI 35378504138 SUCCESS). Queue scan: Wave 0 ops owner-executed (walkthrough shipped; writes still owner-run). Strongest money-identity residual: #750 critic P2-1 — combine and `/accounts` still inlined `??`.

**Closed.** Both surfaces call `resolveLiveInstitutionId`. Present null stays null; disconnect stamp remains.

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8549 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. FAIL-OLD `??`: **3 failed | 95 skipped**. Playwright mobile-380 `combine-connections` **2/2**.

**Critic (fresh context, `/tmp/_critic_o20j_r6`): cycle 1 PASS 0 P0 / 0 P1 / 4 P2.** Independently: tsc 0, 98/98, FAIL-OLD 3|95, kill-call 5 died. P2s in STATUS.

**Ledgers.** DECISIONS #752 (+ index); REGRESSION_LEDGER one row; STATUS BUILT; TASKS O.20j residual (6).

**Ship.** `40cd842f` on `origin/main`. No `prisma/` schema diff. **CI verify run 35382534980 = SUCCESS** on `40cd842f` (`main`, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_35bium7tBfWZg4EECtTKuZA5C1Fj` **READY** on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`. Marker: `raw.githubusercontent.com` on `40cd842f` finds `resolveLiveInstitutionId(a.plaidItemId, a.institutionId, institutionIdByItem)` in `combine-connections.ts`; prior `d7d014e4` still has `item?.institutionId ?? a.institutionId ?? null`. H.7b not auto-run.

## 2026-09-18 — Owner Yes on ops walkthrough + two live writes (DECISIONS #751)

**Picked up.** Owner: "3. Yes. 4. Yes." after the four optional items. Tree even with `origin/main` at `8a8287fe` (#750 ship-gate).

**Closed (docs).** First-timer walkthrough `docs/OPS_WALKTHROUGH.md` (Neon History window, Vercel Cron Jobs View Logs, Sentry DSN + Redeploy + Activation checklist, Combined-accounts Worth a look Undo, seed-demo-holdings). Pointers in BACKUP_AND_RECOVERY.md + DEPLOY.md. Two writes not executed here: no `DATABASE_URL`. Cron fire still UNVERIFIED (24h `requestPath` group: 0 `/api/cron/*` lines).

**Gate.** `bash scripts/verify.sh` → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8544 passed + 1 expected fail + 1 skipped / 634 files + 1 skipped**, next build clean. Docs-only (no UI/e2e).

**Ledgers.** DECISIONS #751; STATUS DECIDED; TASKS 0.3 / 0.6 / O.20e / U.15 (b). STATUS #741 BUILT rotated verbatim to `docs/archive/STATUS_ARCHIVE_2026-09-14.md` (live file was over the ~40 KB ceiling).

**Ship.** `19fc703e` on `origin/main`. No `prisma/` diff. **CI verify run 35376970883 = SUCCESS** on `19fc703e` (`main`, `scripts/ci-status.sh` exit 0). Vercel Production `dpl_AQAigaAKyGswkes9coT5bhpUqyxU` **READY** on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. Marker: `raw.githubusercontent.com` on `19fc703e` finds `Worth a look:` / `History window` / `SENTRY_DSN` in `docs/OPS_WALKTHROUGH.md`. Two live writes still owner-executed.
