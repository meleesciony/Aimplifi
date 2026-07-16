# Monthly Money Review — build plan (AI_DIFFERENTIATION_PLAN §2.4, rank #10 — Wave 2 completion)

*Scoping + grounding-design checkpoint. Written 2026-07-16 after a verified reuse-surface map
(current `generateMoneyReview` shape, the §2.3 Balance-Move substrate, the closed-set intent
router, both Money-Review consumers, the candidate engines, and the dormant-email cron). Status:
build-loop step 1 (acceptance criteria as testable assertions). Nothing built yet.*

## Job-to-be-done
Hand me a short, honest recap of how last month went — where my money went, what's improving,
what crept up, and the single best thing to do next — without my having to go ask the coach. Every
figure comes from a tested engine; no number, label, or causal claim is authored by a model. When
there's no AI key (demo), the recap is fully deterministic and unchanged.

## What already exists (verified 2026-07-16, so the plan doesn't re-derive it)
- **`generateMoneyReview` is a thin 4-field if/else — NOT a candidate set** (`fi/coach-copy.ts:241–274`).
  Signature takes `{flows, creep, opportunities, runwayMonths, pendingTransfer?}` and returns
  `MoneyReview = {month, improvement, creep, nextAction}` — three fixed semantic slots, each an
  if/else pick among **`COACH_COPY`** lines. `COACH_COPY` (`coach-copy.ts:17–230`) is a `readonly`
  object of functions returning strings; **every user-facing FI line lives here and is already
  guardrail-scanned** (educational, zero-shame, assumptions inline). The §2.4 self-score's "reuse a
  candidate-insight set with ids" was wrong — that set does not exist and is this slice's core build.
- **The §2.3 Balance-Move substrate exists** (`trends/balance-move.ts` + `server/balance-move-llm.ts`):
  `validateTemplate`/`validateSentence`/`substitute`/`resolveMoveSentence`/`buildDeterministicSentence`,
  the atomic-placeholder grammar (`{primary}`/`{second}`/`{window}`), and the LLM wrapper. **But that
  validator is balance-move-*factor*-specific (prose over movers).** The rail §2.4 actually reuses is
  the **closed-set id-router**, below — see the grounding decision.
- **The closed-set id-router is the proven, exact template** (`assistant-llm.ts` + `assistant/llm.ts`):
  `LLM_ROUTABLE_KINDS` (a frozen id set), `classifyIntentViaLLM` (XAI→Haiku, **7s timeout, returns
  `null` with no key** — `assistant-llm.ts:39`), `parseIntentKind` (**rejects any id not in the set** —
  `assistant/llm.ts:61–65`), and every parameter re-derived deterministically. Rate-limited via
  `rateLimitDurable` (`authz.ts:82`), per-user budget (`assistant.ts:80`). The model picks ids from a
  finite set; it originates nothing.
- **Money Review has TWO consumers, byte-identical.** `/coach` renders the 3 fields with icons
  (`app/(app)/coach/page.tsx:204–223`), assembled at `server/coach.ts:171–182`; the **weekly digest
  email** composes the same `MoneyReview` object verbatim (`digest/build.ts:82–84`). Widening the data
  behind either surface is a #221 second-person-copy risk — the email path stays untouched in v1.
- **Every candidate engine is already typed with exact integer-cent / bps numbers** — `monthlyFlows`,
  `findOpportunities`, `detectLifestyleCreep`, `monthsOfRunway` (`fi/insights.ts`), `computeSpendingTrends`
  (`trends/trends.ts:318`), `computeCashNeeded` (`cash-needed/engine.ts:177`). `server/coach.ts` already
  computes flows, creep, opportunities, runway, and pendingTransfer in scope — the candidate set is
  assembled from data the coach page **already holds**, so v1 needs almost no new server plumbing.
- **Dormant-email pattern** (`api/cron/digest/route.ts:42–188`): dormant when `!emailProviderConfigured()`,
  dedup key recorded only after a *real* send, every attempt in `AuditLog`. Reference only — v1 does not
  touch email.

## The scoping decision (honoring the adversarial verdict — "needs-rework")

The verdict's three required reworks and how v1 answers each:

1. **"Drop or fully constrain any free-prose path to id-selection + templated prose."**
   v1 has **zero generated prose**. The optional LLM returns *only an ordered list of candidate ids*
   from the closed set; the displayed text for each selected candidate is the **verbatim, already-
   guardrail-scanned `COACH_COPY` line** with engine cents substituted in code. This is *stronger* than
   the number-allowlist validator the writeup imagined — there is no model-authored sentence to scan,
   so fabricated causality / advisory framing / shame tone are structurally impossible (the lines were
   authored and scanned by us, exactly as they are today). The reused rail is the **router**
   (`parseIntentKind`-style in-set validation), not the balance-move prose validator.
2. **"Build the candidate-set engine and the validator."** Build the candidate-set engine (new pure
   module). The prose validator is deliberately *not* needed under decision 1 — recorded so a later
   critic doesn't read its absence as a gap.
3. **"Keep the cash-needed action pinned."** The material next-action (cash-needed shortfall / pending
   cover-transfer) is **always included and never reorderable out of the recap**, regardless of what the
   LLM returns — a deterministic floor identical in spirit to §2.2's always-escalate rule.

Further scoping choices (recorded, so v1 stays tight):

- **v1 renders an ordered "This month" list on `/coach`, replacing the 3 fixed slots with the top
  N selected candidates.** The email/digest keeps the existing `generateMoneyReview` **untouched**
  (blast-radius + #221 fence). Two generators co-exist briefly; unifying the email onto the candidate
  set is a noted follow-up, not this slice.
- **The LLM is bounded polish, never load-bearing** — same honest caveat §2.3 shipped. Zero-key/demo
  serves a **deterministic priority ordering** (a fixed, tested severity rank over the candidate set),
  which is the floor and the demo experience. The LLM only *personalizes which candidate leads*.
- **Cross-month dedup + per-month caching is DEFERRED** (the writeup's "dedup the lead vs last month's
  stored review"). It needs net-new persistence of last month's lead; the deterministic rank is stable
  and honest without it. Recorded as out-of-scope for v1.
- **Confidence/severity is a deterministic engine rank, not a fabricated score** — the ordering key is
  a pure function of the engine numbers (shortfall depth, savings-rate delta sign/size, creep flag,
  opportunity FV), unit-tested, never a model number.

## Acceptance criteria as testable assertions (build-loop step 1)

Pure engine `src/lib/engine/fi/money-review.ts` (new), tested in `tests/unit/money-review.test.ts`
with EDGE_CASES-pinned cents (§Monthly-Money-Review):

- **A1 — closed candidate set.** `buildReviewCandidates(input)` returns `ReviewCandidate[]`, each with
  a `ReviewCandidateId` from a frozen literal set, a deterministic `priority`, and a `line` that is a
  `COACH_COPY` string with engine cents already substituted. No candidate carries a model-authored token.
- **A2 — deterministic ordering (zero-key floor).** `selectReview(candidates, null)` returns candidates
  in a fixed, hand-verified priority order. Pinned cases: savings-rate-up month, savings-rate-down month
  ("one month is weather, not climate" copy), creep-flagged, opportunity-present, thin-runway.
- **A3 — cash-needed action is pinned.** When a material next-action candidate exists, it appears in the
  output for *every* selection input — including an adversarial LLM order that omits or de-prioritizes it.
- **A4 — LLM order is closed-set-validated, one line per role, never below the floor.** The recap shows
  ONE candidate per role (improvement / watch / action); the model chooses which candidate fills each
  role and the role order. `selectReview(candidates, orderedIds)` **drops any id not in `candidates`**,
  ignores duplicates, never invents a candidate, and **backfills every role the deterministic floor
  would show** — so a valid-vocabulary reply naming an absent id (or an empty array) can never shrink
  the recap below the zero-key baseline (critic cycle-1 P1-2). One-line-per-role also removes duplicate
  render keys / test ids (cycle-1 P2-1). The LLM ordering CALL is gated to the `/coach` path
  (`getCoachData(userId, { orderReview: true })`); every other caller — dashboard, goals, investments,
  assistant, the per-user digest cron — gets the deterministic floor with no model call and no data
  egress (cycle-1 P1-1). The "Personalized" badge shows only when the LLM path actually CHANGED the
  recap vs the floor (honest disclosure), and its string lives in the scanned `COACH_COPY`.
- **A5 — empty / degenerate inputs.** No applicable candidates → an honest minimal recap (never a
  fabricated positive); a down month is never framed with shame; every projection line states its window.
- **A6 — grounding.** Every currency figure rendered in the recap equals a `formatCents()` output of an
  engine number already in `input` (assert by construction: lines are built from typed engine cents).

Server + UI + LLM (after the engine is green):

- **A7 — key-gated LLM select/order.** New `server/money-review-llm.ts` clones the §2.3 wrapper:
  XAI→Haiku, 7s timeout, **returns `null` with no key / any failure**. Its only output is an ordered
  id list, extracted from the first JSON array and `parseReviewOrder`-validated against the closed set,
  then re-filtered to present ids by `selectReview`. Called only from the `getCoachData` page-load path
  (not a user-triggered endpoint), so — exactly like the shipped balance-move drafter it clones — it
  carries no extra per-call rate-limit; the page load is the natural bound.
- **A8 — demo is deterministic.** With no key, `/coach` shows the deterministic ordering and **no
  "AI-worded"/"personalized" badge**; the badge appears only when the LLM path actually ran.
- **A9 — no consumer regressions.** The digest email path and existing coach data are unregressed;
  `bash scripts/verify.sh` green (tsc/eslint/vitest/next build); a `money-review.spec` asserts the
  demo recap renders the deterministic order with a grounded money figure and passes axe WCAG-AA.

## Gate
`bash scripts/verify.sh` is the single source of truth. Fresh-context Fable hostile-critic per
`docs/CRITIC_RUBRIC.md` (money + AI-boundary focus): attack for id-out-of-set, dropped cash-needed
pin, any path where a model token reaches the screen, shame/advisory tone in a selected line, and a
down-month framed as failure. 0 P0/P1 to ship; hard cap 4 cycles.
