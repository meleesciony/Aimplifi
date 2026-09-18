# PROGRESS archive — 2026-09-17 L.19 residual 5

> HISTORICAL
> Rotated verbatim from `PROGRESS.md` on 2026-09-18 (ledger ceiling): the
> DECISIONS #745 session (next-dollar frozen).

## 2026-09-17 — L.19 residual (5): the next-dollar ranking names the frozen debt it points at (DECISIONS #745)

**Picked up.** Owner: "continue building as a world class dev." Tree clean, main even with origin (#744 shipped). Queue scan: Wave 0 ops owner-blocked; M.4 owner-deferred; Wave 2/3/4 strategic. Strongest open money-visible row needing no owner input: the #742 critic's named next cut — `coach.ts` strips `feedDroppedAt` before the next-dollar ranking names a debt to send extra money to. Residual (1) examined and not taken: `Goal` has no `createdAt`, so a frozen-at-save claim needs a schema column (recorded in STATUS).

**Closed.** `NextDollarDebt.frozenSince` required at the boundary; `coach.ts` carries it for loans (`feedDroppedAt`) and past-due cards (`CardObligation.frozenSince`); ranking byte-identical. `frozenNextDollarNote` (kind-split; card = premise may be false; loan = no direction, no rate claim) resolved through `nextDollarNamedDebt` beside the copy it mirrors; rendered after the why on the card and in the Ask detail.

**Gate.** `bash scripts/verify.sh` ×2 (pre- and post-critic) → VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **8510 passed + 1 expected fail + 1 skipped / 633 files + 1 skipped** (8508 before the two critic-fix locks), next build clean. FAIL-OLD (`coach.ts` at `9892cd44`): **2 failed | 23 passed**. Playwright mobile-380 fresh build: `next-dollar-frozen` 2/2, `phase3-coach` 1/1, `ask` 31/31.

**Critic (fresh context, isolated worktree `C:\dev\_critic_l19nd`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2, all fixed same-session** (`''` stamp; investing-branch order; `'partner'` nextStep). Independently reproduced 927/927, tsc 0, eslint 0, FAIL-OLD 2|23; 810-case selector↔copy grid; superseded/estimated/MORTGAGE/demo probes.

**Env note.** Playwright's `webServer` timed out once: WSL's localhost relay had bound Windows port 3100 to an unrelated `~/rakazo-host` process (the owner's other project, started mid-session). Killed the Windows-side relay by PID; left the WSL process alone. Not a code defect.

**Ledgers.** DECISIONS #745; REGRESSION_LEDGER two rows; STATUS BUILT + #742 residual (5) closed with the `createdAt` fact on (1); TASKS L.19 row note. Ceiling cuts: REGRESSION_LEDGER 44.5 → 10 KB, STATUS 42.5 → ~31 KB, DECISIONS 43.2 → 29.7 KB (#737–#739; verbatim archives, HISTORICAL banners, docs-lint clean, index 732 entries, ledger suite 20/20).

**Ship.** `2930799d` + `cc8a8ae6` on `origin/main` (no `prisma/` diff). CI verify **35255710898 = SUCCESS** on `cc8a8ae6` (full VERIFY_E2E=1, 15m09s). Vercel Production `dpl_2BMtVkUCRZD5ZyZPU8KkbRvgb9Dy` READY, aliased to `www.aimplifi.app`. Live demo probe: /coach card order headline → why → skipped → cards → assumptions, `next-dollar-frozen` count 0; Ask next-dollar answer = golden, no "stopped sharing" (the abstention — demo has no frozen rows; the speaking branch is e2e-proven, live render UNVERIFIED by construction).

**Next.** Strongest open money-visible rows: #742 residual (1) (needs `Goal.createdAt`/`frozenAtSave` — a schema change; check the prisma diff rule before pushing); O.20j residual (2) null-`institutionId` Plaid items fold on last-4 alone; H.7 / L.30 critic passes owed. Wave 0 ops owner-blocked; M.4 owner-deferred; Wave 2/3/4 strategic.

