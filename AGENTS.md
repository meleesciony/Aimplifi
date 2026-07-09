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
