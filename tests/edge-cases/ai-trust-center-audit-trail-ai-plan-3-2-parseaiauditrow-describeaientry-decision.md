## §AI Trust Center audit trail (AI plan §3.2 — `parseAiAuditRow` / `describeAiEntry`, DECISIONS #242)

Pure formatter over persisted `ai.<touchpoint>.<outcome>` AuditLog rows
(`src/lib/engine/ai-audit/describe.ts`; tests `ai-audit-describe.test.ts`,
`ai-audit-sink.test.ts`, `ai-audit-recorder.test.ts`).

### Sink contract (all four `*ViaLLM` modules)
- Exactly ONE sink call per ATTEMPTED provider call; no key → no call → NO sink report (a trail
  row must mean a model was actually consulted).
- Outcomes: `replied` (passed the closed-set validator), `rejected` (validator discarded the
  reply — the guardrail firing IS the trust signal), `unavailable` (non-OK status / network
  throw / 7s timeout abort / malformed body).
- Meta is closed-set only: categorize `{categoryId, confidenceBps}` (both pinned by
  `parseLlmCategory`), intent `{kind}` (pinned to `LLM_ROUTABLE_KINDS`), review_order `{count}`,
  move_draft `{}` — the draft is only SHAPE-checked at that point, so its strings are still
  model-authored text and must never persist.
- A THROWING sink never changes the returned value (fire-walled both inside the module and inside
  `aiAuditSink`); recording is subordinate to answering.
- `orderReviewViaLLM([])` and an untriggered balance-move make NO call and NO report.

### Recorder / demo fence
- `aiAuditSink(DEMO_USER_ID, …)` writes NOTHING — the shared demo row records no trail, and the
  seed plants none, so the demo Trust Center ledger is honestly empty by construction.
- A DB fault in the recorder is swallowed (the user's action still completes unrecorded).

### Formatter honesty (hand-verified)
- `parseAiAuditRow` returns null for any non-`ai.*` action, unknown touchpoint/outcome
  (`ai.telepathy.replied`), wrong segment count, or a non-timestamp createdAt — unknown rows are
  DROPPED, never guessed at.
- Malformed meta JSON → empty meta → generic line; non-closed-set meta values are dropped
  field-by-field (categoryId 42, confidenceBps "high", count −3 → all gone).
- Confidence renders as whole % clamped to [0,100]: 7250 bps → 73%, 99999 → 100%, −5 → 0%.
- An unknown categoryId in meta renders "a category", never the raw id string.
- Every touchpoint × outcome is a total function (a non-empty line, no throw).

### Per-touchpoint track record (`tallyTouchpoints` / `describeTouchpointStats` / `getAiTouchpointCounts`)
All-time COUNT of `ai.*` rows grouped by action (server `groupBy`, ownership-scoped), rolled up
per touchpoint for the "Where AI runs" table — distinct from the ledger's most-recent-50 window.
- `tallyTouchpoints([])` → one all-zero entry per touchpoint, in `AI_TOUCHPOINTS` order (the
  honest demo/never-run state; demo persists no trail so its counts are all zero).
- Counts sum per outcome into `total` (replied+rejected+unavailable): e.g. categorize
  {replied 10, rejected 2, unavailable 3} → total 15 (hand-verified).
- Actions that don't parse as a known `ai.<touchpoint>.<outcome>` (non-ai, `ai.telepathy.replied`,
  `ai.categorize.exploded`, wrong segment count) are IGNORED — never guessed into a count. Uses the
  same `parseAiAction` ACTION grammar as the ledger, so both accept/reject the same actions; the
  ledger additionally requires a well-formed date, so the two can differ only on that axis.
- A negative or fractional `count` is dropped, never summed (a corrupt row can't inflate the tally).
- Copy says "Asked", never "Ran": `total` counts every ATTEMPTED call including `unavailable`
  (provider returned nothing), so "Ran" would brand a no-reply as a success — the exact overclaim
  this page exists to prevent (Fable critic P1-1). The `unavailable` clause shows only when > 0 so
  the common case stays clean and the arithmetic stays honest (replied = total − rejected − noReply):
  - total 0 → "Not asked about your data yet."
  - total 1 (replied 1) → "Asked 1 time · 0 discarded by the guardrail."
  - total 12 {replied 9, rejected 2, unavailable 1} → "Asked 12 times · 2 discarded by the guardrail · 1 got no reply."
  - total 40 all unavailable → "Asked 40 times · 0 discarded by the guardrail · 40 got no reply."
  The guardrail-discard count is the §3.2 trust signal. Authors no number — every value is a copied count.
