# Hostile Critic Rubric

In the build graph (`GRAPH.md`), the Hostile Critic is the **verifier node**: a
*separate context* from the maker, receiving the diff, the acceptance assertions, and
the gate output — never the maker's rationale or confidence. Self-grading is a contract
violation, not a style issue. A critic that mutates the tree must run in its own
worktree (a gate and a mutating node never share one).

Run after every phase, before declaring it done. Adopt this persona fully (or spawn as
a sub-agent/parallel session): **a skeptical principal engineer who has shipped payment
systems, fused with an impatient real user burned by Mint's shutdown who hates
Simplifi's gaps.** The critic's job is to find problems. An empty findings list on a
first pass is itself suspicious → do a deeper second pass before accepting it.

## Scorecard (1–10 each; every score ≥8 must cite evidence — test output, code
reference, screenshot/DOM description; no vibes)

| Axis | Score | Evidence |
|---|---|---|
| Financial correctness | | |
| Security | | |
| UX clarity | | |
| Mobile usability (380px) | | |
| Accessibility (WCAG AA) | | |
| Performance | | |
| Code quality | | |
| Edge-case test coverage | | |

## Findings list
Numbered, each tagged:
- **P0** — broken, mathematically wrong, or insecure
- **P1** — materially degrades the product
- **P2** — polish

**A phase may NOT pass with any open P0 or P1.** The critic edge carries a retry
budget: hard cap 4 critic cycles per phase; budget exhausted ⇒ stop, write
`docs/STATUS.md`, and route to the human gate (`GRAPH.md` §4).

## Mandatory attacks per differentiator

**(a) Cash-Needed Engine:** re-run every scenario in `docs/EDGE_CASES.md` §Cash-Needed
AND invent ≥3 new adversarial scenarios (suggested seeds: autopay scheduled but
payment account insufficient on autopay date; a card payment in transit at asOf —
neither posted nor reflected; statement due date earlier than cycle close due to data
error; leap-day cycle; pending refund on the payment account). Check the math BY HAND
on paper for each, independently of the code, then compare.

**(b) Categorization:** feed the 10 messiest seed descriptors through the live
pipeline and verify outputs. Verify the <5% review rate from actual test output (not
the test's existence). Replay the mobile triage e2e and count interactions from the
emitted log; verify <15 and the documented time-budget mapping for <60s.

**(c) FI Coach:** hand-verify the FI number, one years-to-FI run, one Coast FI case,
and one opportunity-cost FV against the formulas in EDGE_CASES §FI. Read EVERY
user-facing coach string hunting for shame/preachiness; verify every projection
displays its assumptions; confirm no security/ticker recommendations exist anywhere.

## Standing cross-phase checks
- Grep for `parseFloat|toFixed|Number\(` in engine code (float-money smells);
  `new Date(` in business logic; any full account numbers; any secret in code.
- Confirm `verify.sh` output in the transcript is real (commands actually executed
  this session), not narrated.
- Row-ownership: pick 3 random queries/server actions and confirm userId scoping.
