## §Monthly Money Review (AI plan §2.4 — `buildReviewCandidates` / `selectReview`, `money-review.test.ts`)

The recap is a CLOSED candidate set: each candidate is `{id, role, priority, material, line}` where
`line` is a verbatim COACH_COPY string with engine cents substituted in code. The optional key-gated
LLM returns ONLY an ordered id list; it cannot author a line, a number, or an id outside the set.
One line per ROLE (improvement / watch / action).

### Deterministic floor (zero-key / demo) — byte-equal to `generateMoneyReview`
Pinned 3-branch matrix (hand-verified in `money-review.test.ts`):
- Rate up (2500→3750 bps) + price-increase + pending transfer 42000c by 2026-06-14 →
  `[improvement-savings-rate, watch-price-increase, action-transfer]`.
- Rate down (3750→1250 bps) + creep flagged (1800 vs 200 bps) + unused sub (Peloton 4400c/mo) →
  `[improvement-runway, watch-creep, action-cancel-sub]` (down month → runway line, no shame).
- Flat rates, nothing flagged → `[improvement-runway, watch-clear, action-automate]`.
- Flat rates, creep NOT COMPARABLE (O.20g) → `[improvement-runway, watch-creep-not-comparable,
  action-automate]`. `watch-clear` is SUPPRESSED, not merely outranked — it carries "no lifestyle
  drift detected", a claim this state cannot make. The floor's watch chain is
  `price-increase ?? creep ?? creep-not-comparable ?? clear`; omitting the third link dropped the
  watch role entirely and shrank the recap to two lines while `generateMoneyReview` still emitted
  three, which is why the byte-equality above is pinned across this branch too.
- Empty flows → same honest minimal triple; no savings-rate/streak/best candidate is fabricated.

### Selection invariants (`selectReview(candidates, orderedIds)`)
- **Material pin:** `action-transfer` (`material: true`, exists iff a pending cover-transfer) appears
  for EVERY selection input — omitted → appended; truncation to `max` drops non-material lines first
  and never the pin; a non-material action pick is OVERRIDDEN by the material line for that role.
- **Never below the floor:** every role the deterministic floor would show is backfilled — a
  valid-vocabulary reply naming an ABSENT id (`["action-transfer"]` with no pending transfer) or an
  empty array yields exactly the floor, never a shrunken or empty recap.
- **Closed set:** unknown ids and duplicates are dropped (`parseReviewOrder` + presence filter);
  `["totally-made-up", "improvement-runway", "improvement-runway", "watch-clear"]` →
  `[improvement-runway, watch-clear, action-automate]`.

### Candidate emission honesty
- `improvement-streak` needs ≥2 trailing months with strictly positive rates; a positive-but-lower
  month keeps the streak (37.5%→12.5% = streak 2), a negative month breaks it.
- `improvement-personal-best` needs the last rate to be the strict max AND ≥1 PRIOR month with a
  non-null rate (all-null priors → no "best" — a single measurable month is not an achievement).
- Streak/personal-best live in the LLM pool only — the deterministic floor never shows them, so the
  zero-key recap is unchanged from pre-§2.4.
- The "Personalized" badge renders only when the LLM selection's lines DIFFER from the floor's
  (reorder counts; identical output → no badge), and only the /coach path
  (`getCoachData(userId, {orderReview: true})`) ever makes the model call — dashboard, goals,
  investments, assistant, and the digest cron always get the floor with no egress.
