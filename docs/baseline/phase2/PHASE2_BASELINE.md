# Phase 2 baseline — current triage flow on a realistic messy feed

Measured 2026-07-02 (PULSE_CATEGORIZATION_FIX Phase 2). Everything below is from real
command output, a real browser run, and screenshots in `shots/` — no estimates except
where labeled "modeled," which uses the repo's own documented tap-time budget
(4.0 s/interaction, tests/e2e/phase2-triage.spec.ts:9-11).

## Dataset (deterministic; scripts/messy-corpus.ts, seed 42)

Built by `scripts/messy-categorization-seed.ts` through the REAL pure pipeline
(`categorize()`, zero user rules — a live account on day one). 60 days ending 2026-07-01.

| metric | value |
|---|---|
| transactions | **437** |
| real-world merchants (human view) | **50** |
| pipeline merchant identities created | **63** (fragmentation: +13 phantom merchants) |
| review queue (needsReview) | **144 rows = 33.0%** |
| distinct merchants inside the queue | **24** |
| auto-filed to a category ≠ the human label | **104 rows = 23.8%** (silent misfiles, zero taps — wrong data) |

The SPEC target is <5% review after 60 days (SPEC.md:28). Ledger context: the seed's
curated descriptors measure 1.91-3.6%; DECISIONS #55 measured 60% on novel messy
descriptors. This corpus (recognizable brands + realistic processor noise) lands at
33% — between the two, exactly as the diagnosis predicted.

## Walkthrough (scripts/baseline-triage-walkthrough.ts — Pixel-5 380×800, headless)

Naive-efficient user policy, favorable to the current design: accept/batch whenever the
suggestion is right; otherwise Pick → one of the 3 alternatives, else search + tap row.

| metric | value |
|---|---|
| /triage initial load | 225 ms (144-row queue, N+1 similar-count queries) |
| queue framing | "**144 to review**" (transactions, not merchants) |
| **interactions to clear the queue** | **397** (144 pick + 110 search + 109 option + 34 alternative) |
| Accept taps usable | **0 of 144** — every card's suggestion was wrong |
| batch taps usable | **0** — batch applies the *suggested* category, which was never right |
| bot wall-clock | 67.1 s (machine speed, not human time) |
| **modeled human time** (397 × 4.0 s) | **1,588 s ≈ 26.5 minutes** |
| **one week's triage** (newest 7 days: 22 cards) | **61 interactions ≈ 4.1 min modeled** — targets are <15 taps / <60 s |
| environmental stalls | 1 (retried, run completed; STATUS #16/#17 machine issue) |

Why Accept was never usable: for unknown merchants the "suggestion" is
`bestGuess(amountCents)` (src/server/triage.ts:89) — an amount-only static heuristic that
suggested **Shopping on all 144 cards**, including $6 coffees. The batch button therefore
offers to bulk-apply a wrong category (see `shots/01-initial-queue.png`: "Apply
'Shopping' to all 10 Seawolf Bakers items").

## Versus the spec targets

| SPEC target | measured baseline |
|---|---|
| <5% of transactions need review after 60 days | **33.0%** (144/437) |
| a week's triage <60 s / <15 taps | **~4.1 min / 61 interactions** (4-6× over) |
| "the user should never review their whole feed" | queue shows all 144 transaction rows; 24 merchants would suffice (**6× inflation**) |

Repeat-merchant waste, measured: Kroger cost 52 interactions, Seawolf Bakers 51,
Starbucks 50, Anchorhead 45, Uber 42 — five merchants = 240 of the 397 interactions.
Categorizing each merchant ONCE would have collapsed those 240 to ~15.

## Screenshots (shots/)

01 initial queue (144 to review; wrong batch offer) · 02 top card · 03 alternatives ·
04 picker search · 07 halfway · 08 empty. The accuracy card reads "No data yet" for this
live-style user — CategoryPrediction rows are only created by the demo seed, so the
"learning" metric never engages on real data.

## Reproduce

```
DATABASE_URL=<file:...aimplifi-baseline...> npx prisma db push
npx tsx scripts/baseline-triage-walkthrough.ts   # seeds, serves, drives, measures
```
Full interaction log: `baseline-run.json`.
