# GRAPH_ENGINEERING.md — how work is composed (read every turn, before LOOP_ENGINEERING.md)

Graph engineering is the top-level discipline: *how* work is decomposed, routed, and
verified in any repo. This file is **identical across all projects.** It sits above
`LOOP_ENGINEERING.md`, which remains the discipline *inside* a single node — a loop is
a one-node cyclic graph, and everything in the loop file still applies, scoped to the
node you're running. Pair both with the project's own contract (`GRAPH.md`, if the
repo has one) and its app file (`CLAUDE.md`).

## Prime directive — unchanged, now graph-scoped
No fabrication, at any node. Every fact, number, "PASS", and "done" is produced by
code actually run, with command and real output shown, **by the node reporting it**.
A verdict inherited from another node ("the subagent said it's green") is a
hypothesis until a gate you ran reproduces it. Unverifiable ⇒ **BLOCKED /
UNVERIFIED**, never a confident guess.

## The five primitives

1. **Nodes** — bounded units of work, one job each. A node may be deterministic
   code, a single model call, a tool, a full agent running its own internal loop, a
   human approval gate, or a verifier. Specialization is non-negotiable: "research +
   write + review + format" in one prompt is a workflow in hiding and will fail —
   split it into nodes.
2. **Edges** — real dependencies with a named payload. An edge is a data contract
   (what crosses, in what shape), not a decorative arrow. If you can't name the
   payload, the edge is fake; delete it.
3. **Shared state** — a structured, durable object that travels along edges, outside
   any single chat window: the original brief, evidence, node status, retry counts,
   budgets, approvals, artifacts. In this family of repos the state is the ledger
   set (PROGRESS / STATUS / DECISIONS / REGRESSION_LEDGER / TASKS / lessons). **The
   transcript is not state.**
4. **Routing & gates** — explicit, deterministic rules for what is allowed to run
   next. Routing and thresholds live in code, never in a model's judgment. Human
   gates sit exactly where mistakes are expensive to undo — nowhere else.
5. **Verifiers** — nodes whose only job is to find fault, run in a *separate
   context* from the node that produced the work. Never self-grade. The verifier
   gets the artifact, the spec, and the evidence — not the maker's reasoning.

## The nine principles (what survives the hype)

1. **Model the topology before running it.** Which nodes, which edges, which state —
   written down (here, and per-repo in `GRAPH.md`) before work starts.
2. **One job per node.** Overloaded nodes fail as workflows; split until each node
   can be verified independently.
3. **Parallelism where work is independent.** The diamond: split → parallel workers
   → *separate* verifier contexts → an owned merge. Fan-in re-runs the gate on the
   merged tree; a merge without a fresh gate is unverified by definition.
4. **Separate verifier contexts.** The maker never certifies its own work; on
   risk-bearing surfaces a differently-trained second opinion beats a re-read.
5. **Failure recovery is local.** Retry the failed node and its dependents — never
   the whole graph by default. Every retry carries its count and its budget.
6. **Human gates at irreversibility.** Destructive or high-cost actions, real scope
   changes, and exhausted retry budgets route to the human; reversible work that
   follows from the request does not.
7. **State is the source of truth.** Small typed verb vocabulary; durable,
   timestamped, provenance-carrying records; hybrid retrieval (index first, then the
   full entry).
8. **Observability enables local repair.** Any observer — human or a fresh agent —
   can reconstruct position, edges taken, and budgets from state alone, and fix the
   failing node without re-running the graph.
9. **The loop lives inside the node.** Trigger → act → separate verifier → persist →
   decide next-or-stop is still the right primitive for one bounded job. Graph
   engineering composes loops; it does not replace them.
10. **Token efficiency is a first-class constraint.** Every node and every fan-out
    multiplies token spend — a graph burns tokens by construction. So: no node exists
    without a job a cheaper shape can't do; fan-out only when wall-clock or risk
    justifies the duplicated context; explorers and routine verifiers run on the
    cheapest competent tier; edge payloads are structured summaries, never raw file
    dumps; state retrieval is index-first (`DECISIONS_INDEX`, `lessons/INDEX`,
    PROGRESS top entry), never whole-ledger reads; and a node re-reads nothing the
    ledgers already record. The graph that costs 3× the tokens to reach the same
    verified result is the wrong graph — collapse it.

## Node-exit contract (every node, every turn)

A node ends by writing state and emitting the PASS/FAIL contract defined in
`LOOP_ENGINEERING.md`. The graph-level addition: the report must name **which node**
ran, **which edges** were taken (gates, with their raw verdicts), and **what state
was written**. "It's green" without the gate output is an edge with no payload —
fake, and treated as failed.

## Composition rules for agents

- **Explore in a subagent; verify in a separate one; merge yourself.** The explorer
  returns a structured report (the edge payload); the maker starts fresh from it; the
  critic never sees the maker's rationale.
- **Isolation for parallel mutation.** One agent, one directory (worktrees). A
  read-only explorer may overlap; anything that writes may not share a tree with a
  gate or another writer.
- **Budgets travel on edges.** Token ceilings, retry caps, and cycle caps are part of
  the state every node receives and every node updates. Hitting a budget without a
  verified result = write state, route to stop or human — never silently continue.
- **Fan-out is a token decision before it is a speed decision.** Each parallel node
  re-pays the cost of its context. Spawn a subagent only when the work is provably
  independent AND (it keeps a large read out of the main context, it runs on a cheaper
  tier, or its wall-clock parallelism is actually needed). Never spawn to look busy;
  a sequential loop inside one node is the default.
- **Deterministic routing only.** If a rule can be written, it is code at a gate.
  Models decide inside nodes; code decides between them.

## When a graph is overkill

One bounded job = one node with a loop inside. Do not fan out, add verifiers, or
build routing for work a single loop closes reliably. Graph structure is earned by
independence (parallelizable), risk (needs a separate verifier), or irreversibility
(needs a human gate) — never by aesthetics.
