# Phase 5 — before/after on the identical messy dataset

Measured 2026-07-02. Same 437-transaction / 50-merchant / 60-day corpus (deterministic,
seed 42), same naive-efficient user policy, same intent labels, same 380×800 viewport,
same driver harness. Before = `docs/baseline/phase2/` (commit b776573, pre-rebuild).
After = this directory (post Phase 3d/3a/3b/3c, commits cd3e01a…001eb5b).

## The comparison

| metric | BEFORE (per-transaction) | AFTER (merchant-group) | change |
|---|---|---|---|
| review queue on day one | **144 transactions** (33.0%) | **16 merchant groups** (71 rows, 16.2%) | **9× smaller queue** |
| pipeline identities for 50 real merchants | 63 (fragmented) | 52 (4 named real-world exceptions) | fragmentation eliminated |
| interactions to clear EVERYTHING | **397** | **45** | **8.8× fewer** |
| modeled human time, full backlog | **26.5 min** | **3.0 min** | 8.8× faster |
| bot wall-clock | 67.1 s (1 stall) | 10.3 s (0 stalls) | page does 6× less work |
| **one week's triage** | 61 interactions / ~4.1 min | **14 interactions / ~56 s** | **meets SPEC <15 / <60s** |
| usable 1-tap accepts | 0 of 144 cards (fake 'Shopping' suggestion) | honest: no suggestion is ever fabricated | wrong-batch trap removed |
| silent auto-misfiles (vs human labels) | 104 rows (23.8%) | table-drift class only; eval precision 100%, 0 confidently-wrong | wrong data eliminated at the eval bar |
| after one pass of decisions, re-ingest same 60 days | n/a (nothing learned from default flow) | **3.7% review — under the SPEC 5%**; residue provably all aggregates | trust on repeat = certainty |

Baseline evidence: `../phase2/baseline-run.json` + shots. After evidence:
`after-run.json` + `shots/` (same states). Engine-level locks: adversarial eval
60% → 23.3% review on novel messy descriptors (precision 100%), and the Phase-4
unit locks (`tests/unit/messy-corpus-queue.test.ts`) pin ≥75% day-one auto-apply,
≤20 decisions, and the <5% steady state — all printed with real numbers each run.

## What did it

Queue unit = normalized merchant (one decision files every variant, past and future);
trust-on-repeat = a durable rule created BY the group decision itself (silent 9900 at
ingest); identity convergence (clean-second-chance with the full-consume safety rule,
city/state strip, robustified patterns); honest suggestions (bestGuess='Shopping'
retired from the queue); resync can no longer un-triage corrected rows.

## Honest residuals

The irreducible tail is aggregates — checks and P2P payees (12 of the after-run's 45
interactions were checks) — which no merchant rule may ever absorb, by design (#23).
Descriptor typos/truncations still split identities (4 named exceptions, each converging
via one extra tap). The stop condition's "week under a minute" is met at the modeled
budget (56s); the wall-clock stall class documented in STATUS #16/#17 is a machine
condition, not a flow property (this run: 0 stalls).

## Reproduce

```
npx tsx scripts/baseline-triage-walkthrough.ts   # before (needs pre-rebuild checkout)
npx tsx scripts/after-triage-walkthrough.ts      # after (this tree)
npx vitest run tests/unit/messy-corpus-queue.test.ts
```
