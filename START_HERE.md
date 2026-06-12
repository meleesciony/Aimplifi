# Pulse Finance — Claude Code Handoff Kit

This zip is a complete handoff package for building **Pulse Finance** with Claude Code
(Fable 5). Phase 0 (architecture & plan) has been completed for you — Claude Code should
start at **Phase 1** and follow the build loop in `CLAUDE.md`.

## How to use this kit

1. Create a fresh repo directory and unzip this package into it:
   ```bash
   mkdir pulse-finance && cd pulse-finance
   unzip ~/Downloads/pulse-finance-handoff.zip -d .
   ```
2. `CLAUDE.md` is already at the repo root — Claude Code reads it automatically as
   project memory. Do not rename it.
3. Launch Claude Code in the repo and kick off with:
   ```
   Read CLAUDE.md, SPEC.md, and everything in docs/. Phase 0 is complete and
   documented in docs/PHASE_0_ARCHITECTURE.md. Begin Phase 1 exactly as specified
   in docs/PHASES.md, following the build loop and Definition of Done in CLAUDE.md.
   Run scripts/verify.sh before declaring any phase complete.
   ```
4. After each phase, ask Claude Code to run the Hostile Critic review per
   `docs/CRITIC_RUBRIC.md` and paste the scorecard before moving on.

## What's in here

| File | Purpose |
|---|---|
| `CLAUDE.md` | Project memory: non-negotiable rules, build loop, Definition of Done |
| `SPEC.md` | The full original product spec (v2 agentic prompt), unmodified |
| `docs/PHASE_0_ARCHITECTURE.md` | Completed Phase 0: repo structure, data model, Prisma schema draft, provider abstraction, security architecture |
| `docs/PHASES.md` | Phase breakdown with testable acceptance criteria per phase |
| `docs/EDGE_CASES.md` | Cash-Needed Engine edge-case inventory with hand-computed expected values for unit tests |
| `docs/SEED_SPEC.md` | Exact specification of the demo-mode seed dataset |
| `docs/CRITIC_RUBRIC.md` | Hostile Critic persona, scoring axes, pass/fail rules |
| `.env.example` | Environment variable template (demo mode works with zero secrets) |
| `scripts/verify.sh` | One-shot verification: typecheck, lint, test, build |

## Recommended Claude Code session strategy

- **One phase per session** (or per `/clear`). Each phase is sized to fit comfortably in
  context. Start each session by re-reading `CLAUDE.md` and the relevant phase section.
- Commit at every green verify (`scripts/verify.sh` passing). Suggested message format:
  `phase-1: cash-needed engine core + 42 unit tests (verify green)`.
- If a phase fails the critic 4 times, **stop** — summarize open findings in
  `docs/STATUS.md` and ask the human for direction. Do not paper over failures.
- Use Plan Mode for the start of each phase (acceptance criteria before code).
