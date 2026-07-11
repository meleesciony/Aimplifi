# Session Context / Handoff — 2026-06-27 (session "OneDrive relocation")

Self-contained context to resume after a chat clear. Files persist on disk; clearing the
conversation deletes nothing. Point the new session at this file (then PROGRESS.md).

## ⚠️ WHERE TO RESUME — read this first

**Work from `C:\dev\Aimplifi`.** This is now the CANONICAL checkout. The original
`C:\Users\micha\OneDrive\Documents\Pulse Finance` copy AND the older stale
`C:\dev\Pulse Finance` (~#74) are **ABANDONED**. A `_MOVED_TO_C_DEV_AIMPLIFI.txt`
breadcrumb sits in the OneDrive root; the OneDrive `CLAUDE.md`/`PROGRESS.md` carry a
redirect banner. If you find yourself in the OneDrive folder, switch to `C:\dev\Aimplifi`.

## TL;DR

App = **Aimplifi** (formerly "Pulse Finance"). Production is live at **https://aimplifi.app**
(origin/main `551ac97`, READY) — **unchanged this session**. This session executed the
owner-approved **COMPLETE half of the #16/#17/#120 e2e flake fix**: the working tree was
relocated OFF the OneDrive-synced disk to `C:\dev\Aimplifi`.

**Outcome (honest, measured):** the relocation WORKED — core verify GREEN and the full e2e
suite is now reliably 54/54 off OneDrive; the `phase2-triage:82` timeout flake that no
in-tree mitigation could clear is GONE. A separate latent test race (`transactions:145`)
surfaced and was fixed. Committed as `4201d01` (DECISIONS #121) + this handoff commit.

## Git / repo state (at C:\dev\Aimplifi)

- Branch `main`. **Working tree CLEAN.**
- `origin/main` = `551ac97` — the LIVE production deploy (REC-2 #118 + HSTS #119).
- Local `main` is **ahead of origin by 5** (after this handoff commit) — ALL test-infra +
  docs, ZERO production-bundle impact:
  - `<this handoff commit>` docs: 2026-06-27 relocation handoff + PROGRESS pointer
  - `4201d01` chore(dev-env): relocate tree off OneDrive + harden recat e2e (#121)
  - `f958cc5` docs: 2026-06-27 session handoff (#120) + PROGRESS resume pointer
  - `6df4aca` test: relocate unit/e2e SQLite DB off the OneDrive tree (#120)
  - `905da57` docs: record REC-2 + HSTS production deploy (551ac97 READY)
- **Why unpushed:** pushing `main` triggers a Vercel prod build that rebuilds identical
  functional output. Deferred deliberately — push alongside the next FUNCTIONAL change, or
  standalone on request. Pushing now is safe, just a redundant redeploy.

## What this session did

1. **Relocation (non-destructive).** robocopy'd the active checkout → `C:\dev\Aimplifi`,
   excluding regenerable caches (`node_modules`, `.next`, `.codegraph`,
   `test-results`/`playwright-report`) but INCLUDING `.git` (the unpushed commits + the
   correct GitHub origin) and all gitignored secrets (`.env*`, `keys/`, `dev.db`). Fresh
   `npm ci` (788 pkgs + `prisma generate`) on plain local disk. The OneDrive copy is left
   INTACT as a reversible fallback.
2. **`tests/e2e/transactions.spec.ts:145` (inline recat) hardening.** The positive assert
   ran on the WHOLE ROW (`toContainText('Groceries')`) and matched the in-flight
   "File as Groceries?" confirm prompt → passed BEFORE persistence, so the negative
   `not.toContainText('Dining Out')` raced `router.refresh()` on its default 5s budget.
   App verified CORRECT (`commit()` awaits `recategorize()` then `close()`+`router.refresh()`).
   Fix asserts on the category-**chip** element (prompt is a sibling div) with a 20s budget
   on BOTH assertions — stricter, not laxer (DECISIONS #121).

## Verified facts (measured this session — don't re-derive)

- **Core verify GREEN** at `C:\dev\Aimplifi`: **1142 unit / 94 files**, typecheck/lint/build
  clean — across multiple runs.
- **Full e2e 54/54.** `phase2-triage:82` (the un-clearable OneDrive timeout) now runs in
  **14–24s** and passed every run. Post-`:145`-fix: **4/4 consecutive full e2e runs green**
  (~55s each). This confirms #120's prediction: the e2e residual was whole-tree OneDrive
  sync I/O contention, not DB location. (#120 already fixed the UNIT flake; the e2e half is
  fixed now by moving the whole tree.)

## Pending / next steps (all owner-gated)

1. **(Cleanup, optional)** Delete the OneDrive copy and the stale `C:\dev\Pulse Finance`
   (~#74) once you've confirmed `C:\dev\Aimplifi` works for you.
2. **(Optional)** Push the local commits (5 ahead) — redundant prod rebuild only, no
   functional change. Bundle with the next feature, or push standalone.
3. **Otherwise:** the roadmap backlog (`docs/ROADMAP.md`) is owner-gated ("only change if
   markedly better"): investments retirement planner / live brokerage ingest; the UX tail
   (CardTitle-as-heading shared primitive, triage split-flow 2nd category, mobile-nav
   redesign, iOS safe-area). None are forced; pick per priority.

## How to verify quickly (from C:\dev\Aimplifi)

- `bash scripts/verify.sh` — core gate (typecheck + lint + 1142 unit + build). GREEN + fast
  + reliable. **This is the gate to trust.**
- `VERIFY_E2E=1 bash scripts/verify.sh` — adds the 54 e2e. **Now reliably green off OneDrive.**

## Carry-over notes (still true)

- **Do NOT change** the seed RNG string `pulse-finance-seed` or demo email
  `demo@pulse.finance` (`src/lib/seed/build.ts`) — they pin the golden test values.
- "Aimplifi" is everywhere user-facing; "Pulse Finance" survives only in the (old) folder
  name + some docs.
- Vercel: project `aimplifi` (`prj_Zr3x9TKUklr2LRswwc1rqZR4lcRO`), team `reiforge`
  (`team_pk5Bl46h1HAtdlfO5ASqydxE`). Domains: aimplifi.app, www.aimplifi.app.
- This handoff doc + the PROGRESS.md #120/#121 entries are the authoritative state.
  **Safe to /clear.**
