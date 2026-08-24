# AGENTS.md — Aimplifi (read this first, every session)

This repo's agent instructions are canonical in four files. They were written for Claude
Code, but their substance is tool-agnostic: **the name `CLAUDE.md` is historical — its
contents bind every agent working in this repo** (Cursor/Grok, Claude Code, anything else).
Before any work:

1. Read `GRAPH_ENGINEERING.md` — the top-level working method: how work is decomposed into
   nodes, connected by edges with named payloads, routed by deterministic gates, and
   verified by separate-context verifiers. No-fabrication prime directive, graph-scoped.
   **Token efficiency is principle 10**: no node without a job a cheaper shape can't do,
   fan-out only when the token math pays, edge payloads are summaries not file dumps.
2. Read `LOOP_ENGINEERING.md` — the node-internal discipline: the 12 rules, decisiveness /
   scope / autonomy / reporting rules, the self-healing retry loop, and the PASS/FAIL
   contract that ends every substantive turn (the exit artifact of every node).
3. Read `GRAPH.md` — this repo's build-graph contract: the standing topology, the shared
   state schema (the ledgers), gate semantics, and the CLI/script success criteria.
   Reading-cost note: the method files are deliberately short; on repeat sessions, GRAPH.md
   §4–§5 (topology + gate semantics) are the operational core — read the rest when doing
   work that touches it, not ritually.
4. Read `CLAUDE.md` — the project: mission, non-negotiables (integer-cents money math, demo
   mode, engine-before-UI, Definition of Done as gate semantics), the per-phase build
   graph, model routing per node type, and conventions.
5. Skim `docs/lessons/INDEX.md` — accumulated cross-session lessons; open the lesson files
   relevant to your task.

Durable state lives in ledgers, not chat history — these files are the graph's shared
state (`GRAPH.md` §3): `PROGRESS.md` (graph position + gate evidence), `docs/DECISIONS.md`
(decisions + rationale), `REGRESSION_LEDGER.md` (every fix + its locking test),
`docs/STATUS.md` (open items + the only home for live counts), `TASKS.md` (the routed
queue), `docs/lessons/` (how-to-work lessons). Resume from these; write to them at every
node boundary.

## Ground rules that must survive even if the reading is skipped

- **No fabrication — at any node.** Never report a pass, build, or working feature you did
  not actually run this session with real output shown. A verdict inherited from another
  node (a subagent's "green") is a hypothesis until a gate you ran reproduces it.
  Unverifiable ⇒ `UNVERIFIED` / `BLOCKED`, never a confident guess.
- **One job per node; separate the verifier.** Generation and verification are different
  nodes in different contexts. Never self-grade; never let the maker certify its own money,
  security, or data-integrity work.
- **Money is integer cents** (`number`, or `bigint` where sums could overflow) — never
  floats. Business dates are calendar dates (`YYYY-MM-DD`) via `src/lib/dates.ts` — never
  timezone-carrying timestamps. Currency formatting only at the UI boundary via
  `formatCents()`.
- **Gates route the graph, and their verdicts are code's, not yours.**
  `bash scripts/verify.sh` is the local Definition-of-Done gate (`tsc --noEmit`, `eslint`,
  `vitest run`, `next build` all green, output pasted real and unedited);
  `bash scripts/ci-status.sh` is the ship gate — read it after every push. Red ⇒ re-enter
  only the failed node, never the whole graph.
- **Surgical, minimal changes.** Touch only what the task requires: no drive-by refactors,
  no speculative abstractions, no error handling for scenarios that cannot happen, no
  feature flags or compatibility shims when the code can just be changed — and no graph
  structure (nodes, fan-out, extra verifiers) the work hasn't earned.
- Never weaken or delete a test to go green. Every fix ships a regression test plus a line
  in `REGRESSION_LEDGER.md`.
- End every substantive turn with the PASS/FAIL contract from `LOOP_ENGINEERING.md`,
  naming the node(s) run, the gates' raw verdicts, and the state written.

## Tool-specific translations (for agents that are not Claude Code)

Parts of the canon reference Claude Code machinery. Map them as follows; everything else
applies unchanged regardless of model or IDE.

- The cheap-model `explorer` subagent and model-routing rules (LOOP_ENGINEERING.md "Token
  discipline" §1 and §5; CLAUDE.md "Model routing") — the *tier assignments* are Claude
  Code-only; the *routing principle* is universal: explorer nodes and heavy reads run on
  the cheapest competent tier, maker/verifier nodes on the tier the surface's risk earns,
  and maker ≠ verifier on money/security/data-integrity. In Cursor, use the built-in
  codebase search / semantic search for heavy reads instead of pasting many whole files
  into chat.
- The `NEXT MODEL:` handoff line (CLAUDE.md "Model routing") — Claude Code-only; omit it.
  The routing table it points at still applies.
- `/compact` and `/clear` — Claude Code session commands. In Cursor, start a new chat when
  beginning genuinely new work, and rely on the ledgers above as the durable state.
- Skills and hooks (LOOP_ENGINEERING.md rules 11–12) — apply only if your tool has an
  equivalent; otherwise ignore.
- Git worktrees (LOOP_ENGINEERING.md rule 9) — any isolated-directory mechanism satisfies
  the rule; what is non-negotiable is that a gate and a mutating node never share a tree.
- **Git push at slice end (owner 2026-08-24).** CLAUDE.md rule 5 already requires
  commit + PUSH + live proof. Restated: *"always push and commit at end of
  every slice."* A harness auto-mode block on `git push` ("no explicit current
  user request") is not a reason to leave `main` ahead of `origin/main` — this
  sentence is the standing request. After every green local verify: commit,
  `git push origin main`, `bash scripts/ci-status.sh`, then the live probe.
  An unpushed slice is unshipped.
