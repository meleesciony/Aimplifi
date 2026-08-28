## §Why-This-Category provenance (AI plan §3.1 — `describeProvenance`, hand-verified)

The pure resolver maps stored facts to a display verdict. The one path to `ai-guess` is a
persisted `source === 'llm'` on a row whose current category still matches the prediction and
that the user has not labeled — origin is NEVER inferred from confidence or category. Branch
order matters; this table is the resolver's spec (`categorize-provenance.test.ts` sweeps it).

| userLabeled | hasRow | source | txnConf | predicted===current | → kind | needsConfirm |
|---|---|---|---|---|---|---|
| true | any | any | any | any | user-set | no |
| false | false | — | 10000 | — | user-set | no |
| false | false | — | <10000 | — | not-recorded | no |
| false | true | null | any | — | not-recorded | no |
| false | true | (set) | any | **false** | not-recorded | no |
| false | true | llm | any | true | ai-guess | **yes** |
| false | true | user-rule | any | true | your-rule | no |
| false | true | merchant-default | any | true | merchant-default | no |
| false | true | provider-category | any | true | provider | no |
| false | true | transfer | any | true | transfer | no |
| false | true | fallback | any | true | uncategorized | no |

Load-bearing invariants (each a critic fix):
- **10000 is reserved for user-dictated.** An LLM pick at confidence 1.0 would round to 10000
  (`parseLlmCategory`), collide with the "you set this" sentinel, get dropped by the `<10000`
  prediction-log filter, and render as a HUMAN fact. Fix: `parseLlmCategory` caps at 9900
  (RULE_CONFIDENCE_BPS) — the model's most confident guess stays logged, auto-filed, and
  labeled `llm`. (Critic P0-1.)
- **The prediction is the FIRST verdict; the current category can move** (backfill LLM re-file,
  sync verdict refresh, household-partner correction at 9900 without `labeledAt`). When
  predicted ≠ current, the stored source is stale → `not-recorded`, never a false origin.
  (Critic P1-3.)
- **CSV import correlates provenance by pre-assigned id**, not `createManyAndReturn` row order
  (SQLite/Prisma give no ordering contract). (Critic P1-2.)

Accepted / deferred (each honest — never a false origin, never a wrong $):
- **User corrections on pre-#190 rows** (no prediction row, confidence 9900) read
  `not-recorded`, not `user-set` — a false NEGATIVE (honest direction). Slice 2 can enrich via
  a `Correction` join; the `labeledAt` path already covers post-#190 owner corrections. (P2-4.)
- **Manual-entry LLM path** (`createTransaction`) calls `pickAssistedCategory` directly, missing
  the transfer/income-sign guards the batch overlay enforces (#163/#165). Pre-existing; the
  `source='llm'` stamp is honest. Tracked for a separate fix. (P2-5.)
- **No Postgres migration artifact** for the additive `source` column — repo convention is
  `db push` (frozen `_init`), same as the #237 `NudgeDismissal` addition. (P2-7.)
- **Backfill LLM re-files read `not-recorded`, not `ai-guess`.** `runBackfillForUser` knows the
  new `source:'llm'` but writes only the Transaction (never the create-only prediction row), so
  a backfilled LLM re-file drifts predicted≠current → the guard returns `not-recorded`. Honest
  direction (never a false origin; inferring `llm` from drift is the forbidden fabrication) but
  the same "source computed then discarded" class this slice fixes at ingest. A future slice can
  log/stamp when the FIRST verdict was an abstention (`predicted==='uncategorized'` — a non-claim
  safe to update). (Cycle-2 critic P2-1.)
- **A partner re-confirming the SAME category doesn't quiet the badge.**
  `recategorizeSharedTransaction` sets category+9900 without `labeledAt`; when it re-confirms the
  already-predicted category, predicted===current so the guard doesn't fire and an `ai-guess`
  keeps asking for an OK. Honest direction (over-asks, never under-asks); slice-2 copy note.
  (Cycle-2 critic P2-2.)

### Slice 2 — the register surface + the demo AI-guess fixture (#239)

The register renders one provenance badge per row (the resolver's own label, verbatim) and, for
the single `ai-guess` kind, a one-tap **Confirm**. Behaviors worth pinning:
- **Badge == verdict, always.** The badge label is `describeProvenance(...).label` copied
  verbatim by `provenanceBadgeView`; tone (attention vs muted) and the confirm control are a
  function of `needsConfirm` alone. There is no display-only re-derivation, so a row can never
  show an origin that disagrees with the resolver. The e2e asserts the rendered kind on real demo
  rows; the render unit test pins label + tone + confirm per kind.
- **Confirm files the CURRENT category.** For an `ai-guess` the current category equals the
  predicted one by construction (the resolver returns `ai-guess` only when predicted===current),
  so `confirmGuess` files `t.categoryId` through `recategorize({scope:'one'})` — a same-category
  Correction that stamps `labeledAt`, flipping the row to `user-set` on reload. No rule is minted
  (confirming one charge is not "always for this merchant"). This same-value Correction is
  identical to re-picking the current category on the register today (accepted, Fable P2-2).
- **No fabricated confidence.** No badge renders a percentage or any digit — only the qualitative
  band copy from `LABELS` (swept by the render test over every kind × confidence).
- **Demo AI-guess fixture is an AMBIGUOUS merchant, never a name brand.** The demo has no
  auto-filed unknown-merchant row (every real-category row is a known merchant → merchant-default,
  which beats the LLM overlay), so an `ai-guess` badge on a known brand would fabricate an
  impossible origin (Fable P2-1). The seed instead PROMOTES one uncategorized, unknown-merchant
  review row to an llm-resolved row (real category, source 'llm', auto-filed) — the authentic
  overlay path. The seed-contract test pins: exactly one demo `ai-guess`, unlabeled,
  predicted===current, on a merchant with no real default (null or 'uncategorized'). Moving that
  one row out of uncategorized/review is the slice's only deliberate golden change and broke no
  money/accuracy/e2e golden.
- **Register-only scope.** `ai-guess` rows are auto-filed (LLM overlay files ≥ `AUTO_SILENT_BPS`),
  so they surface in the register, not the triage review queue; triage suggestions derive from the
  LIVE pipeline (a different provenance path than the persisted prediction). Provenance is not
  threaded into the partner `SharedTxnRow` — "You set this"/"Your rule" must never render on
  someone else's data (the #221 second-person-copy fence). A triage provenance badge is a noted
  follow-up, not this slice.
