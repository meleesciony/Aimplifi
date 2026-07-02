# Categorization diagnosis (PULSE_CATEGORIZATION_FIX Phase 1, 2026-07-02)

Read-only findings, workflow wf_37625155 (5 readers, executed tsx traces). Full detail in
the session record; Phase-2 measured baseline in docs/baseline/phase2/PHASE2_BASELINE.md.

**Root cause of the 420-item queue — five stacked factors:**
1. **Queue unit = transaction everywhere.** getTriageItems: flat findMany(needsReview), no
   grouping/cap (triage.ts:62-129); badge + header count rows; one card = one txn.
2. **The default flow learns nothing.** Only an explicit "Always" creates a
   CategorizationRule (the sole ingest-consulted artifact, pipeline.ts:91-103 → 9900,
   silent). Plain accepts write Correction rows — read by NOTHING at ingest. Triage
   "Always" doesn't retro-clear queued siblings (rule-only, triage-actions.ts:96-116);
   only the register merchant-scope does both.
3. **Merchant identity is a static 52-regex table** (+48 keywords) tested against the RAW
   descriptor (^-anchored → 'SQ *STARBUCKS' misses the Starbucks entry); no city/state
   stripping (header claims it, code lacks it) → variant fragmentation;
   Merchant.defaultCategoryId is write-only dead data.
4. **Resync clobbers "just once" corrections**: SimpleFIN 5-day overlap upsert +
   Plaid 'modified' update rewrite categoryId/needsReview from a fresh pipeline verdict
   (simplefin.ts:475-494, plaid.ts:360-373) — corrected txns return to the queue.
5. **Honest review rate on messy data is ~33-60%** (DECISIONS #55: 60%; Phase-2 corpus:
   33%), not the seed-curated 1.91-3.6% the <5% target was tuned on. Plaid path also has
   NO LLM assist at ingest (SimpleFIN/CSV/manual do).

Also: unknown-merchant "suggestion" = bestGuess(amount) — static 'Shopping' for nearly
everything (triage.ts:89) → Accept/batch unusable on precisely the cards that dominate a
real queue. Accuracy card scores only seed-era CategoryPrediction rows; live users show
"No data yet" forever. Ledger hygiene: code cites DECISIONS #121 for the register confirm
(actual: #36); table rows #113/#114 missing.

**Phase-3 mechanics scorecard:** merchant-unit queue MISSING · trust-on-repeat HALF-BUILT
(opt-in Always only) · chunked/merchant framing MISSING · bulk+retro-in-one-action PARTIAL
(register only) · new-merchant defaults STATIC (no learning).
