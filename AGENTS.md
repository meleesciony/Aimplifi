# AGENTS.md — Aimplifi (read this first, every session)

This repo's agent instructions are canonical in three files. They were written for Claude
Code, but their substance is tool-agnostic: **the name `CLAUDE.md` is historical — its
contents bind every agent working in this repo** (Cursor/Grok, Claude Code, anything else).
Before any work:

1. Read `LOOP_ENGINEERING.md` — the working method: no-fabrication prime directive, the 12
   discipline rules, decisiveness / scope / autonomy / reporting rules, the self-healing
   loop, and the PASS/FAIL contract that ends every substantive turn.
2. Read `CLAUDE.md` — the project: mission, non-negotiables (integer-cents money math, demo
   mode, engine-before-UI, Definition of Done), the per-phase build loop, and conventions.
3. Skim `docs/lessons/INDEX.md` — accumulated cross-session lessons; open the lesson files
   relevant to your task.

Durable state lives in ledgers, not chat history: `PROGRESS.md` (status + checkpoints),
`docs/DECISIONS.md` (decisions + rationale), `REGRESSION_LEDGER.md` (every fix + its
locking test), `docs/lessons/` (how-to-work lessons). Resume from these; write to them.

## Ground rules that must survive even if the reading is skipped

- **No fabrication.** Never report a pass, build, or working feature you did not actually
  run this session with real output shown. Unverifiable ⇒ `UNVERIFIED` / `BLOCKED`, never a
  confident guess.
- **Money is integer cents** (`number`, or `bigint` where sums could overflow) — never
  floats. Business dates are calendar dates (`YYYY-MM-DD`) via `src/lib/dates.ts` — never
  timezone-carrying timestamps. Currency formatting only at the UI boundary via
  `formatCents()`.
- **`bash scripts/verify.sh` is the single source of truth** before declaring anything done
  (`tsc --noEmit`, `eslint`, `vitest run`, `next build` all green, output pasted real and
  unedited).
- **Surgical, minimal changes.** Touch only what the task requires: no drive-by refactors,
  no speculative abstractions, no error handling for scenarios that cannot happen, no
  feature flags or compatibility shims when the code can just be changed.
- Never weaken or delete a test to go green. Every fix ships a regression test plus a line
  in `REGRESSION_LEDGER.md`.
- End every substantive turn with the PASS/FAIL contract from `LOOP_ENGINEERING.md`.

## Tool-specific translations (for agents that are not Claude Code)

Parts of the canon reference Claude Code machinery. Map them as follows; everything else
applies unchanged regardless of model or IDE.

- The Haiku `explorer` subagent and model-routing rules (LOOP_ENGINEERING.md "Token
  discipline" §1 and §5) — Claude Code-only. In Cursor, use the built-in codebase search /
  semantic search for heavy reads instead of pasting many whole files into chat.
- The `NEXT MODEL:` handoff line (CLAUDE.md "Model handoff line") — Claude Code-only; omit
  it.
- `/compact` and `/clear` — Claude Code session commands. In Cursor, start a new chat when
  beginning genuinely new work, and rely on the ledgers above as the durable state.
- Skills and hooks (LOOP_ENGINEERING.md rules 11–12) — apply only if your tool has an
  equivalent; otherwise ignore.

## Cursor Cloud specific instructions

The Cloud Agent startup script (`npm ci` under Node 24) already installs dependencies;
`postinstall` runs `prisma generate`. The notes below are the non-obvious caveats — the
standard commands live in `README.md` and `package.json` scripts.

- **Node 24 is required — the VM default is not it.** Native modules (`better-sqlite3`)
  are compiled for Node 24 (`NODE_MODULE_VERSION 137`) and `jsdom`/`undici@8` need Node
  ≥ 22.19, so the whole toolchain (vitest, prisma, `next build`, dev server) must run on
  Node 24. The base VM ships Node 22.14 at `/exec-daemon/node`, which errors with
  `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` mismatch. The startup script self-heals this
  by symlinking Node 24 into `/usr/local/cargo/bin` (first on `PATH`), so plain
  `bash -c`, login shells, and tmux `-l` sessions all resolve Node 24 automatically. If a
  shell ever reports Node 22, run `nvm use 24` (nvm default is already `24`) or re-point
  the symlink at `$(nvm which 24)`.
- **A gitignored `.env` supplies demo-mode dev values.** It is NOT committed (`.env*` is
  gitignored) but persists in the VM snapshot. The Prisma CLI loads `.env` via
  `dotenv/config` (NOT `.env.local`), so without it `prisma db push` fails with
  "The datasource.url property is required". If `.env` is missing, recreate it with the
  same non-secret values CI uses:

  ```
  DATA_PROVIDER=demo
  DATABASE_URL="file:./dev.db"
  AUTH_SECRET="dev-local-secret-not-used-in-production"
  DEMO_TODAY=2026-06-10
  ```

- **The SQLite `dev.db` must exist before `next build` or `npm run dev`.** It is gitignored
  but persists in the snapshot. If missing/stale, run `npx prisma db push` (creates it) then
  `npx prisma db seed` (loads the deterministic demo dataset — 9 accounts, 847 transactions,
  pinned to `asOf 2026-06-10`). These are session-start steps, deliberately kept OUT of the
  startup script (they are schema-sync/seed, not dependency refresh).
- **Demo mode needs zero credentials.** `npm run dev` serves on `http://localhost:3000`;
  `/` redirects to `/sign-in` → click "Explore the demo" to enter the seeded dataset.
- **Verification:** `bash scripts/verify.sh` (typecheck + lint + unit + build) is the
  Definition-of-Done gate (README). The e2e suite is opt-in (`VERIFY_E2E=1`) and needs
  Playwright browsers first: `npx playwright install --with-deps chromium webkit`.
