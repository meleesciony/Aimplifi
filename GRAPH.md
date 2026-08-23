# GRAPH.md — the Aimplifi build graph (single source of truth)

This file is the contract every agent and every script in this repo builds under. It
defines the **topology** (which nodes exist, which edges are legal), the **shared
state** (what travels between nodes and where it lives), and the **gates** (what is
allowed to run next). The generic method behind it is `GRAPH_ENGINEERING.md`; the
discipline inside each node is `LOOP_ENGINEERING.md`; the app-specific rules are
`CLAUDE.md`. If this file and a habit conflict, this file wins and the habit gets
updated.

A **loop is a one-node cyclic graph**. Everything this repo already trusts —
`scripts/verify.sh`, the Hostile Critic, the live-deploy proofs, the ledgers — is a
node or an edge in the graph below. Nothing was discarded; it was placed.

## 1. Node vocabulary (the only kinds of work there are)

Every unit of work in this repo is exactly one of these. One node = one job. A node
that does two jobs ("research + write + review") is a workflow hiding inside a prompt
and will fail — split it.

| Node type | What it is here | Instances |
|---|---|---|
| `maker` | An agent (or human) that changes the tree | A phase slice, a fix, a docs rewrite |
| `verifier` | A *separate context* whose only job is to break the maker's work | Hostile Critic (`docs/CRITIC_RUBRIC.md`), a fresh-context critic subagent, a second-opinion model |
| `gate` | Deterministic code with a machine-readable verdict | `bash scripts/verify.sh` (local DoD), `bash scripts/ci-status.sh` (ship gate), Playwright e2e, `docs-lint`, categorizer eval |
| `explorer` | Read-only research that returns a structured report | The explorer subagent; never edits |
| `state-writer` | Writes the ledgers | End-of-node PROGRESS/STATUS/DECISIONS/REGRESSION_LEDGER updates |
| `human-gate` | The owner, exactly where mistakes are expensive to undo | Destructive/irreversible actions, real scope changes, 4 failed critic cycles |

Rules that are non-negotiable:

- **A verifier never shares context with the maker it verifies.** Self-grading is
  forbidden (loop rule: never self-grade). The critic reads the *tree and the
  evidence*, not the maker's reasoning.
- **A gate is code, not a persona.** Routing, retries, thresholds, and status
  branching are deterministic. No model call decides what a gate decides.
- **A gate and a mutating node never share a working tree**
  (`docs/lessons/a-gate-and-a-mutating-agent-cannot-share-a-tree.md`).
- **A subagent's green is a hypothesis until reproduced by a gate you ran**
  (`docs/lessons/a-subagents-green-is-a-hypothesis.md`).

## 2. Edges (data contracts, not arrows)

An edge exists only if real data crosses it. Each edge names its payload. If you
cannot name the payload, delete the edge.

| Edge | Payload (contract) |
|---|---|
| task row → maker | The TASKS.md row + acceptance criteria restated as testable assertions |
| maker → gate | A working tree + the exact gate commands |
| gate → maker | Real, unedited gate output (never a paraphrase — proof-of-work is pasted verbatim) |
| maker → verifier | The diff, the spec/assertions, and the gate output — *not* the maker's confidence |
| verifier → maker | Numbered P0/P1/P2 findings with evidence (the critic scorecard) |
| any node → state-writer | done / found / next / blocked, gate evidence, decisions, regressions |
| maker → human-gate | The diff + the locking test + the irreversibility statement |
| human-gate → maker | Approval, redirection, or stop |

**Conditional routing lives at gates, not in prose.** `verify.sh` red ⇒ the only
legal next node is the fix loop on the failing node. Critic P0/P1 open ⇒ the only
legal next node is another maker cycle. Critic cycle count = 4 ⇒ the only legal next
node is the human-gate.

## 3. Shared state (durable, outside any chat window)

The graph's state is the filesystem. The transcript is *not* state. Every field below
is written by the node that owns it and read by any node that needs it; a resumed or
parallel session must be able to reconstruct "where are we" from these alone.

| State object | File | Carries |
|---|---|---|
| Graph position + evidence | `PROGRESS.md` | Per-slice: picked up / closed / left alone / locked / gate / gate read / next |
| Open & decided items | `docs/STATUS.md` | Current limitations, critic findings, the only home for live counts |
| Decision log | `docs/DECISIONS.md` (+ `docs/DECISIONS_INDEX.md`) | What was decided, why, alternatives — append-only |
| Regression spine | `REGRESSION_LEDGER.md` | date / symptom / root cause / rule broken / locking test |
| Work queue | `TASKS.md` | The routed backlog; done rows move to the archive |
| Method memory | `docs/lessons/` (+ `INDEX.md`) | Cross-session how-to-work corrections |

Provenance rules: every number a node reports traces to a command that node ran this
session; once written to a ledger it may leave working context; timestamps and the
commit sha accompany every gate verdict.

## 4. The standing topology

The per-phase build graph (this is the old "build loop", made explicit):

```
        ┌──────────────────────────────────────────────┐
        │            per-slice subgraph                │
        │                                              │
 task ──▶ PLAN ──▶ IMPLEMENT ──▶ GATE(local verify) ──▶ SIMULATE(user walk)
 row                            │ red ▲                │
                                ▼     │                ▼
                              FIX ────┘          CRITIC(verifier, separate ctx)
                                ▲                    │ P0/P1 open
                                └──── cycle ≤4 ◀─────┘
                                         │ 0 P0/P1
                                         ▼
                              SHIP: commit → push → GATE(ci-status) → LIVE PROBE
                                         │                    │ red/cancelled
                                         ▼                    ▼
                                    STATE-WRITER ◀────── FIX (only the failed node)
                                         │
                                         ▼
                              HUMAN-GATE (only where irreversible / blocked / cap hit)
```

Fan-out is legal **where work is independent and the token cost is justified**:
explorer subagents (they keep large reads out of the main context — usually a net
token *saving*), parallel critics on expensive surfaces, parallel e2e authoring — each
in its own `git worktree` (one agent, one directory), each returning a structured
artifact, merged by an owner node that re-runs the gate on the merged tree. Fan-in
without a fresh gate on the merge is a fake edge. Every parallel node re-pays its
context cost, so the default shape is sequential: one node, a loop inside it, fan-out
only when independence plus cheaper-tier or wall-clock math pays for the duplication
(GRAPH_ENGINEERING.md principle 10).

Failure recovery is **local by default**: retry the failed node and its dependents —
never restart the graph. A red CI on push N does not re-open phases that shipped
green on pushes < N; it opens exactly one node: the failing slice.

## 5. Gate semantics (what "green" means, precisely)

| Gate | Command | Verdict that unblocks the next edge |
|---|---|---|
| Local DoD | `bash scripts/verify.sh` (or `npm run verify`; e2e: `npm run verify:e2e`) | exit 0, real output pasted unedited |
| Ship | `bash scripts/ci-status.sh` | exit 0 = success; 3 = cancelled (absence, never a pass); failure touched by this push = stop |
| Live proof | `curl -s https://www.aimplifi.app/<route> \| grep '<marker unique to the change>'` | marker present on a READY deployment of the same sha |
| Critic | `docs/CRITIC_RUBRIC.md` | zero P0/P1, every score ≥8 with cited evidence |

A green local verify is **not** a shipped slice. "Shipped" = commit + push + CI
conclusion read + live probe. `main` ahead of `origin/main` is an unshipped state,
and any diagnosis made against undeployed code is void (DECISIONS, the #257–#261
incident).

## 6. CLI / script success criteria (machine-checkable)

The script surface (`scripts/`) is how both humans and agents drive the graph
non-interactively. A successful invocation is defined per entry point:

- `npm run verify` / `npm run verify:e2e` — exits 0 **and** prints each stage's real
  summary. Success criteria under the graph: it must be runnable on a clean checkout
  with no prompts, its output must be parseable into per-stage verdicts (the
  `════ STAGE ════` markers + exit code), and it must fail loudly on the first red
  stage without swallowing the failure list (lesson: proof is the *full* output and
  the command's own exit code — never a trimmed tail).
- `bash scripts/ci-status.sh [ref]` — exits with the gate's verdict (0/1/2/3/4 as
  documented in its header). A slice may not report SHIPPED until this is read.
- `npm run eval:categorize` — prints the messy-corpus review rate and any
  confident-but-wrong auto-files; it is a *measurement node*, not a gate: its numbers
  go to state (STATUS) and may open a fix node, but do not block the build.
- `npm run ledger …`, `npm run docs:lint` — state-maintenance nodes: regenerate
  indexes, flag doc drift. docs-lint is a warning node (allowed to fail in CI without
  failing `verify`), by design.
- `scripts/*-live-deploy-check.mjs` — live-probe nodes: each proves one shipped claim
  against production and prints what it checked.

Extension rule: a new script must declare which node type it is (gate, measurement,
probe, or state-writer) in its header comment, exit non-zero on failure, print
structured stage markers if it is a gate, and take no interactive input.

## 7. Observability (reading the graph)

At any moment, the graph's machine-readable state is:

- **Node states** — the top of `PROGRESS.md` (in-flight slice) and the open list in
  `docs/STATUS.md`.
- **Edges taken** — the "Gate" / "Gate read" paragraphs of each PROGRESS entry:
  which gates ran, on which sha, with which verdict.
- **Budgets** — critic cycle count (cap 4), session token budget (loop rule 7),
  retry counts recorded in the slice entry.
- **Queue** — `TASKS.md` open rows.

If a human or agent cannot reconstruct position from those files, the last
state-writer node failed — fix the ledger before doing more work.

## 8. Migration / adoption — the loop you know is already this graph

An existing loop-based workflow becomes a first graph with no change to the verify /
critic / deploy-proof discipline:

1. **Keep the loop inside the node.** Plan → implement → verify → simulate → critic
   → fix stays exactly as written in `CLAUDE.md`; it is now formally the per-slice
   subgraph in §4. The 4-cycle cap becomes "retry budget on the critic edge".
2. **Name the verifier edge.** The Hostile Critic was already a separate-context
   verifier; the only change is treating "same context graded itself" as a contract
   violation, not a style issue.
3. **Split what was one overloaded node.** Anything currently "research + implement +
   review" in one prompt becomes explorer → maker → verifier with the structured
   report as the edge payload. Most slices already do this; make it explicit.
4. **Let gates route.** After any gate verdict, consult §5's table instead of
   judgment: red ⇒ fix node, cancelled ⇒ re-read newest sha, green ⇒ next node.
5. **Write state at node boundaries.** PROGRESS after every step was loop rule 8;
   it is now the state-writer edge that makes the graph resumable and parallel-safe.

Minimal viable topology for any new workflow in this repo: one maker, one
separate-context verifier, the local gate, the ship gate, a state-writer. Add
fan-out (parallel explorers/critics in worktrees) only when the work is provably
independent and the token math pays (cheaper tier, context offload, or needed
wall-clock) — and re-run the gate on the merged tree at fan-in.
