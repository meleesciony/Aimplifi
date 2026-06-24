# LOOP_ENGINEERING.md — how you work (read every turn)

The loop-engineering discipline: *how* the agent works, in any repo. This file is **identical across all
projects.** Pair it with the project's own `CLAUDE.md` — which holds everything specific to THIS app: its
mission, its cardinal sins, its sacred conventions, and any locks / constitution / domain rules. This
file is method; `CLAUDE.md` is the app.

## Prime directive — Loop closure (no fabrication)
Every fact, number, "PASS", and "done" must be produced by code you actually ran, with the command and
real output shown. Never fabricate a result or narrate a simulated run. If something can't be verified,
the status is **BLOCKED / UNVERIFIED** — never a confident guess. Where the app has an AI feature, this
graduates into a product rule: the AI never originates a fact; extracted/computed values carry their
source and uncertainty routes to a human, never a silent fabrication.

## The 12 discipline rules
**Craft (the core four):**
1. **Think before coding** — assumptions + tradeoffs first; ask before guessing on anything touching
   architecture or data; push back when a simpler approach exists.
2. **Simplicity first** — the minimum that solves the problem; no speculative features or single-use
   abstractions.
3. **Surgical changes** — touch only what the task requires; match existing style; don't refactor the
   unbroken.
4. **Goal-driven execution** — define "done" as checkable criteria and loop until verified; don't follow
   a handed-down script of steps.

**Determinism & honesty:**
5. **No model calls for deterministic decisions** — routing, retries, thresholds, status branching live
   in code; if a rule can be written, write it.
6. **Fail loudly or not at all** — never continue past a failed step; a test that doesn't cover the
   behavior is flagged as such; success means verifiable, not reported.

**Control (long sessions, parallel agents):**
7. **Hard token budgets** — every session has a ceiling; at the ceiling without a verified result, write
   findings to a file and stop.
8. **Checkpoint multi-step work** — any task over three steps writes `PROGRESS.md` after each step
   (done / found / next / blocked); a dead session resumes from it, not from step 1.
9. **One agent, one directory** — parallel agents use separate `git worktrees`; no shared filesystem;
   each owns its branch.

**Composition (subagents, skills, hooks):**
10. **Separate researcher from writer** — reading >5 files or >2 sources ⇒ a research subagent returns a
    structured report; implementation starts fresh with only that report.
11. **Unique skill descriptions** — each skill's description matches exactly one job; overlap makes the
    dispatcher load the wrong skill silently.
12. **Scoped hooks only** — every hook has a scope condition (extension / path / session-event); none
    fire unconditionally on every tool call.

## The self-healing loop (run on ANY failure)
**Trace** (ask, action, real error) → **Diagnose** (one root cause + which rule it broke) → **Smallest
fix** (a unified diff; prefer config/data over code) → **Simulate** (predict + the command to prove it) →
**Lock** (a regression test that fails-old / passes-new) → **Approval gate** (show diff + test, then
stop). Every approved fix makes the system harder to break.

## Regression discipline
Each fix ships `test_regression__<slug>` plus one line in `REGRESSION_LEDGER.md`
(`date | symptom | root cause | rule broken | locking test`). Never weaken or delete a test to go green.

## PASS/FAIL contract (end every substantive turn)
```
STATUS:   PASS | FAIL | BLOCKED
RAN:      <exact command(s) executed>
EVIDENCE: <raw counts, or the failing assertion>
CHANGED:  <files touched, or "none">
NEXT:     <one line>
```
Can't fill RAN + EVIDENCE with something actually executed ⇒ **BLOCKED**, not PASS.

## Maker / Checker
For risk-bearing changes (security, privacy, money, data integrity, or the system's core engine), the
Maker proposes, then switches to an adversarial **Checker** whose only job is to break it. Pass only when
it can't. The per-phase **Hostile Critic** is this same stance at phase scope.

## How this composes with the build
The project's `CLAUDE.md` / `SYSTEM_PROMPT.md` defines the per-phase build loop (plan → implement →
verify → simulate → hostile critic → fix; **4-cycle cap, then an honest stop**). Its "verify" step is
loop closure (run the project's verify gate, paste output); its "fix" step is the self-healing loop
above; its "critic" step is the Checker at phase scope. The four craft rules apply inside every step.

## Token discipline (app-agnostic)
1. **Explore in a subagent, not the main thread.** For any structural / "how does this work" / "where is
   X used" / dependency / impact question — or any task that needs more than ~2 files read to answer it —
   delegate to the `explorer` subagent (read-only, Haiku) and work from its summary. Read / grep / glob
   directly in the main thread only for the specific files you are about to edit, or after the explorer
   has narrowed it. The point is to keep large file reads out of the main (Opus/Fable) context, where they
   cost the most and degrade attention.
2. **Consult the map before the files.** If this repo has a generated import graph (e.g. `CODEGRAPH.md`)
   or a code-graph MCP, query it before opening files. If it has neither, do NOT block on one or "confirm
   it's available" — just explore via the subagent. (Code-graph tooling is per-repo and optional, not a
   precondition.)
3. **Compress diagnostics — never the gate proof.** Long logs, stack traces, and command spew → reduce to
   the decision-critical lines plus a pointer to where the full output lives. **Hard exception:** output
   the no-fabrication rule requires verbatim — `scripts/verify.sh` / `npm run verify` / the unittest
   summary, and any proof-of-work a Definition-of-Done gate depends on — is pasted **real and unedited**.
   Never paraphrase, trim, or "summarize" proof-of-work. Compression applies to exploratory noise, not to
   evidence.
4. **State lives in the ledger, not the scrollback.** Decisions → `DECISIONS.md`; status + verification
   evidence → `PROGRESS.md`; fixes → the regression ledger. Once it is written there, it is safe to drop
   from working context. Resume from the checkpoint; do not re-explore what `PROGRESS.md` already records.
   Use `/compact` before auto-compact fires (auto-compact runs at the worst moment in a long session); use
   `/clear` when starting genuinely new work.
5. **Routing is config, not vibes.** Heavy reads, search, and summarization run on Haiku (the `explorer`
   subagent, or the built-in Explore agent). Reserve the main Opus/Fable thread for architecture, §4
   belief-math, and final high-stakes edits. A line in a markdown file cannot switch the running model —
   only the subagent `model:` field (or `CLAUDE_CODE_SUBAGENT_MODEL` / `--model`) does.
6. **Don't re-read what's already loaded.** Before opening a file, check whether its content — or a
   sufficient summary — is already in this session or already captured in `PROGRESS.md`. The cheapest
   token is the one you don't spend twice.
