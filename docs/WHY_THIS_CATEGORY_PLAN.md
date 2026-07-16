# Why-This-Category — build plan (AI_DIFFERENTIATION_PLAN §3.1, rank #3 — Wave 3 lead)

*Scoping + provenance-design checkpoint. Written 2026-07-16 after a categorization-provenance
surface map (pipeline/assist source axes, the `CategoryPrediction` schema, all four live
prediction-write paths, the register + triage render surfaces). Status: build-loop step 1
(acceptance criteria as testable assertions). Nothing built yet.*

## Job-to-be-done
When a charge lands in "Dining," tell me *who* decided that — a rule I set, a merchant default,
the provider's own hint, or an AI guess — and how solid it is, so I can trust the auto-file and
catch the AI's mistakes before they pollute my budget. AI guesses are shown as suggestions
needing my OK, never as silent facts. No number and no provenance claim is authored by a model.

## What already exists (verified 2026-07-16, so the plan doesn't re-derive it)
- **The engine already computes provenance** — it is *discarded at every write*. `CategorizedTxn`
  (categorize/pipeline.ts:135-145) carries `source: CategorySource`, `confidenceBps`, `aiBadge`
  (true in the 7000–8999 band), and `matchedRuleId`.
- **`source` is TWO axes, not one.** The pipeline emits `CategorySource =
  'transfer'|'user-rule'|'merchant-default'|'fallback'|'provider-category'` (pipeline.ts:80-85)
  — note it has **no `llm` member**. The LLM is a separate overlay: `pickAssistedCategory`
  (llm.ts:60-76) returns its own axis `'deterministic'|'llm'`, and only overrides a row the
  deterministic pipeline was *unsure* about, at ≥ `AUTO_SILENT_BPS` (9000). True persisted
  provenance is therefore a **composition**: the pipeline's `CategorySource`, replaced by `llm`
  when the assist overlay won.
- **The overlay source is dropped.** `assistUnsureRows` (categorize-assist.ts:42-65) returns the
  row type `T` with only `categoryId/confidenceBps/needsReview` updated — the `picked.source`
  it computed on line 44 is never surfaced.
- **`CategoryPrediction` has no provenance column** (schema.prisma:366-385): `predictedCategoryId`,
  `confidenceBps`, `actualCategoryId?`, `labeledAt?`, `createdAt`. No `source`, no `matchedRuleId`.
- **Four live write paths log predictions**, all through one choke point `logCategoryPredictions`
  / `PredictionLogRow` (predictions.ts:26-49): `plaid.ts:629`, `simplefin.ts:645`,
  `transaction-actions.ts:140` (manual create) and `:220` (CSV import); plus `seed.ts:135`. Each
  drops source before the row is written. **Threading Plaid alone would leave three paths
  writing NULL-source rows** — the fix belongs at the choke point.
- **User-dictated categories get NO prediction row.** `logCategoryPredictions` skips
  `confidenceBps >= 10000` (predictions.ts:39) — a user dictating a category made no prediction to
  score. So *absence of a prediction row* is three-way ambiguous: a user-dictated fact (10000),
  a pre-#190 historical row (predictions weren't logged then), or a row predating this feature.
- **The render surface has no provenance affordance.** `TxnView` (transactions/query.ts) carries
  `categoryName` (clickable to re-file) and a Pending badge — no source, no confidence, no
  aiBadge. Triage (`triage-inbox.tsx`) shows a "Suggestion:" category name only. There is already
  a re-categorization path and a `Correction → CategorizationRule` learning loop to reuse.

## The scoping decision (honoring the adversarial verdict — "build-later", forward-only)

The verdict's four load-bearing findings and how v1 answers each:

1. **"Small migration" is understated — source is discarded at every write path, and live ingest
   already logs predictions (post-#190).** So slice 1 is the persistence-plumbing slice: one
   additive nullable column, one choke-point type change, all four callers threaded. No UI.
2. **Forward-only, and "source unknown" masks exactly the LLM rows the feature exists to flag.**
   Accepted and made *honest*, not hidden. The resolver emits a distinct **`not-recorded`** state
   for rows predating the feature and **never guesses `llm` vs `deterministic` where it wasn't
   logged** (that guess is the fabrication the cardinal rule forbids). Copy for those rows is
   "source not recorded for transactions before <date>", not a fabricated origin. Because demo is
   re-seeded with real sources, `not-recorded` affects only a real user's pre-feature history —
   never demo mode.
3. **`CategoryPrediction` rows are demo-only in spirit but live since #190.** Confirmed live paths
   write them; the gap is only the missing `source`. No new pipeline needed.
4. **Historical LLM rows are byte-identical to merchant defaults after write — unrecoverable.**
   No backfill can separate them, so none is attempted; `not-recorded` is the honest terminal
   state for that history.

Further scoping choices:

- **Confidence is shown QUALITATIVELY, never as a fabricated percentage.** The engine's
  `confidenceBps` is a real, engine-produced heuristic — but rendering "92% sure" implies a
  per-user calibration we have not proven (that is exactly §3.2 Trust Center's Brier job). v1
  surfaces a qualitative basis tied to the existing thresholds ("confident", "AI guess — needs
  your OK"), the same posture glass-box `uncertainty.ts` took. Numeric/calibrated confidence is
  explicitly deferred to §3.2. This honors the shipped "refuses a fake confidence %" guardrail.
- **`needsConfirm` iff `source === 'llm'`** (the §3.1 grounding contract). It is the only source
  kind routed to a visible confirm state; every deterministic kind renders informational-only.
- **Learned rules fold into the `user-rule` source at persistence** (the pipeline does not emit a
  distinct learned source). The learned-vs-deliberate nuance is already visible via `aiBadge`
  (learned rules file in the 8500/FLAGGED band); a richer "learned from your history" label is a
  post-v1 refinement keyed off `matchedRuleId.isLearned`, noted not built.
- **`matchedRuleId` persistence is deferred.** v1 persists `source` only; "because your rule
  X → Y" (glass-box `explain-routing` style) is a slice-2+ enrichment, out of the minimal surface.

## Engine design — `src/lib/engine/categorize/provenance.ts` (pure, no I/O)

The whole feature's safety rests on one pure, exhaustively-tested classifier. It never touches the
network or DB; it maps *stored facts* to a display verdict.

### The persisted source union
`PredictionSource = 'transfer' | 'user-rule' | 'merchant-default' | 'provider-category' |
'fallback' | 'llm'` — the pipeline's five members plus `llm` for an assist-overlaid row. Stored as
a nullable `String?` (portable across the SQLite-dev / Postgres-prod split); NULL means the row
predates the column.

### The resolver reads TWO inputs, never one
`describeProvenance({ source, txnConfidenceBps, hasPredictionRow })
→ { kind: ProvenanceKind, label: string, needsConfirm: boolean }` where
`ProvenanceKind = 'user-set' | 'your-rule' | 'merchant-default' | 'provider' | 'ai-guess' |
'uncategorized' | 'not-recorded'`. The mapping (a total function, exhaustive switch, every branch
unit-pinned):
- `source === 'llm'` → `ai-guess`, `needsConfirm: true`.
- `source === 'user-rule'` → `your-rule`.
- `source === 'merchant-default'` / `'provider-category'` / `'transfer'` → the matching
  informational kind.
- `source === 'fallback'` (the pipeline's honest abstention) → `uncategorized`.
- **No prediction row AND `txnConfidenceBps === 10000`** → `user-set` (the human dictated it; no
  prediction was ever made — predictions.ts:39). Informational, never `needsConfirm`.
- **No prediction row (confidence < 10000) OR `source === null`** → `not-recorded`. Honest,
  never a guessed origin.
`ai-guess` is the ONLY `needsConfirm: true` kind. `not-recorded` is unreachable in demo mode (all
seed rows carry a real source), and the resolver proves this with a demo-fixture test.

### Grounding invariants (the tests are the spec)
- **No fabricated origin:** the resolver emits `llm`/`ai-guess` *only* when `source === 'llm'` was
  actually persisted — never inferred from confidence or category. A property test over all
  `(source, confidence, hasRow)` inputs asserts `ai-guess ⇒ source === 'llm'`.
- **Total + closed:** every input maps to exactly one kind; an unknown source string is
  unrepresentable at the type boundary and, if forced (a corrupt row), maps to `not-recorded`,
  never crashes and never guesses.
- **Verbatim, no arithmetic:** the resolver copies `confidenceBps` for band lookup only; it
  authors no number and formats no currency (there is none on this surface).

## Persistence + write-path threading (slice 1, the plumbing)
- **Schema:** add `source String?` to `CategoryPrediction` (additive, nullable, reversible).
  Prisma migration; portable string.
- **Choke point:** extend `PredictionLogRow` (predictions.ts:26) with `source: PredictionSource |
  null`; `logCategoryPredictions` persists it (still skipping user-dictated 10000 rows).
- **Surface the overlay source:** `assistUnsureRows` returns each row's final source (`llm` when
  the overlay won, else the row's incoming pipeline source). Each ingest/action caller composes
  the persisted source = overlay-source-if-llm-else-pipeline-`CategorySource`, and passes it into
  `logCategoryPredictions`. All four live callers + `seed.ts` updated in lockstep so **no path
  writes a NULL source for a new row** going forward.
- **No `Transaction.source` column** — the provenance surface reads the `CategoryPrediction` join;
  the transaction table is untouched.

## Acceptance criteria (write as tests FIRST)

Slice 1 — `tests/unit/categorize-provenance*.test.ts` + a write-path integration test:
1. **Resolver totality:** every `(source ∈ union ∪ {null}, confidence ∈ {10000, <10000},
   hasRow ∈ {t,f})` triple maps to exactly one `ProvenanceKind`; hand-verified table in
   EDGE_CASES.
2. **No fabricated origin:** `ai-guess ⇔ source === 'llm'`; `needsConfirm` true for `ai-guess`
   only; a property/fuzz test asserts no confidence or category value can produce `ai-guess`.
3. **The three-way absence:** no-row+10000 → `user-set`; no-row+<10000 → `not-recorded`;
   row+null-source → `not-recorded`. Never `merchant-default`/`llm` by inference.
4. **Write-path threading:** a categorize→assist→log integration test proves an LLM-overlaid row
   persists `source: 'llm'`, a merchant match persists `'merchant-default'`, a user rule
   `'user-rule'`; a user-dictated 10000 row writes **no** prediction row (unchanged).
5. **Demo golden-safe:** seeding writes a real `source` on every demo prediction; `not-recorded`
   never occurs on the seed dataset; existing accuracy/tuning golden values stay byte-identical
   (source is additive; `actualCategoryId`/`labeledAt` untouched).

Slice 2 — `tests/e2e/why-this-category.spec.ts` + render unit tests:
6. **Badge truthfulness:** each register row's rendered provenance kind equals
   `describeProvenance` over its own stored `(source, confidence, hasRow)` — a render test pins
   the mapping, no display-only re-derivation.
7. **AI rows are suggestions, not facts:** an `ai-guess` row shows the confirm affordance;
   confirming writes a `Correction` (+ `CategorizationRule`) via the existing path and flips the
   row to `user-set`; a deterministic row shows no confirm control.
8. **Demo demonstrability:** the seed carries at least one `ai-guess` row so the confirm flow is
   exercisable with zero credentials; axe WCAG-AA with the provenance disclosure open.
9. **No fabricated confidence:** no percentage is rendered anywhere on the surface; only the
   qualitative band copy appears (pinned by an e2e text assertion).

## Sequencing
- **Slice 1 (engine + persistence, NO UI):** pure `provenance.ts` + the `source` column +
  choke-point threading through all four callers + `assistUnsureRows` return shape + seed
  (criteria 1–5). **Fable build + Fable hostile critic** — a mislabeled provenance badge is a
  trust/data-integrity defect (an AI guess shown as a settled fact is the exact failure this
  feature exists to prevent), the same money/integrity surface class as glass-box and nudge.
- **Slice 2 (UI + confirm + demo):** join `source` into `TxnView`; render the provenance badge on
  register rows and in triage; the "AI guessed — confirm?" affordance reusing the correction path;
  seed one `ai-guess` demo row; e2e + axe (criteria 6–9). Opus 4.8 build; Fable critic on the
  copy-truthfulness surface.

## Landmines carried forward (from the surface map)
- **Shared demo account** (docs/lessons/shared-demo-account-must-not-learn): the seed's `ai-guess`
  demo row and any confirm it receives write to the shared `user-demo` row — a visitor confirming
  the demo AI guess must not leak to the next visitor. Slice 2 fences the confirm write for
  `user-demo` the same way nudge dismissal (#237) and household (#210) did, or seeds the row
  pre-unconfirmed and treats demo confirms as session-only. Decided in slice 2 with critic focus.
- **Forward-only honesty** is a *feature of the copy*, not a bug to paper over — `not-recorded`
  says exactly what it means and never guesses.
- **Golden re-baseline:** adding a `source` to seed predictions and one `ai-guess` row touches
  SEED_SPEC; re-baseline the accuracy/tuning goldens and confirm byte-identical downstream
  (`actualCategoryId`/`labeledAt` deliberately untouched so tuning eligibility is unchanged).
