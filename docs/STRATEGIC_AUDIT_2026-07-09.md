# Strategic Audit & Self-Improving System Blueprint — Aimplifi

*2026-07-09. A 50,000-foot product audit + deep user simulation, grounded in a full read of the
repo's docs (SPEC, ROADMAP, COMPETITIVE_GAP_PLAN, AI_DIFFERENTIATION_PLAN, COACH_PRINCIPLES_PLAN,
STATUS through DECISIONS #182) and the actual engine/UI code (dashboard, coach, ask, triage,
radar/notify/digest, glass-box, categorize/learn). Companion deliverable: `TASKS.md` at the repo
root — the prioritized, model-routed build queue derived from this audit.*

---

## Executive Summary

**Overall health: 6.5 / 10** — with an unusual shape. Component scores: engine correctness &
trust architecture **9.5**, product surface & UX **6.5**, retention mechanics **4** (built but
dormant), distribution **2** (unpushed, undeployed, allowlist-gated). The constraint on this
product is no longer code quality. It is that almost nothing built since #171 has reached a
user, and nothing brings a user back on day 3.

**Top 3 strengths (durable moats):**

1. **The no-fabrication AI architecture is structural, not a prompt.** The LLM only picks from
   closed sets; every number comes from a tested pure engine; Glass-Box reconciles headline
   numbers to the penny (#178). No incumbent can copy this without a rebuild — it is the single
   most marketable fact about the product.
2. **The Cash-Needed lane is genuinely uncontested.** "How much must be in checking, and by
   when?" plus the Plan-in-Words inverse planners (#125/#126/#131) and Cash Flow Radar (#172)
   answer questions Mint/Simplifi/Monarch never even pose. 2,010 unit tests pinned to
   hand-verified values make the answers trustworthy.
3. **The learn-from-history idiom already exists and is excellent.** `categorize/learn.ts`
   derives per-user rules from correction history at read time — undoable, schema-free,
   golden-safe, guarded by repetition and sign checks. This is the seed of the self-improving
   architecture in §4; the pattern just hasn't been generalized beyond categorization.

**Top 5 highest-leverage opportunities (in order):**

1. **Ship the dormant layer.** Push #171–#182, deploy, set the env keys (`RESEND_API_KEY`,
   `VAPID_*`, `CRON_SECRET`, `SENTRY_DSN`). Radar, push, digest, reminders — the entire
   stickiness stack — is built, tested, and off. This is days of ops work worth more than any
   quarter of new features.
2. **Give Ask a memory.** The assistant is stateless: "what about last month?" fails. A
   deterministic conversation frame (last intent + entities, resolved in the parser — no LLM)
   converts one-shot Q&A into the habit-forming surface it's positioned to be.
3. **Engineer the return moment.** Nothing greets a returning user. A "since you were away"
   composition of already-computed pieces (Money Review + radar + what auto-filed) plus a
   value-receipts ledger ("Radar caught this dip 6 days early") makes every absence build a
   reason to come back.
4. **Close the self-improvement loop on real signals** (§4 blueprint): unknown-question ledger →
   parser vocabulary; engagement events → notification cadence and dashboard order; Brier data →
   bounded per-user threshold tuning. The tables and idioms mostly exist; they're not yet wired
   into a compounding loop.
5. **Decide on households.** Money is relational; the schema is structurally single-user. If
   the ambition is category-defining, partner visibility (distinct logins, shared account
   scopes, per-partner money dials) is the one gap that can't be closed by composition later —
   it needs an architecture decision this year.

**World-class potential: yes — in its lane.** Aimplifi will not out-breadth Monarch (credit
scores, FX, collaboration) this year. But "the app that tells you exactly how much money you
need, by when, shows its work to the penny, and never invents a number" is a category-defining
position, and the hard part — the trust core — is already built. The risk is not competition;
it is that the product remains a beautifully verified machine no one is using. Distribution and
the return loop are the whole game for the next 90 days.

---

## 1. User Journey Simulations

Five personas walked end-to-end against the actual flows (empty-dashboard → connect → triage →
dashboard → coach → ask → return visit). Quotes are imagined but grounded in real UI copy and
real code paths.

### Persona A — Maya, 36. Two kids, four cards, Mint refugee, non-technical. New user, day 0.

- **Signup:** invite-only (`SIGNUP_ALLOWLIST`). Fine for now; every persona below assumes she got in.
- **Empty dashboard** is honest and warm ("Welcome to Aimplifi 👋 … Connect a bank — takes about
  a minute"). Then she picks SimpleFIN: *"Wait — I have to create an account on a different
  website, pay them, and paste a token back here?"* **This is the single highest-abandonment
  moment in the product.** Plaid Link is the smooth path but is sandbox/demo-gated. Maya's
  realistic day-0 outcome on a fresh deploy: CSV import or walk away.
- **If she gets data in:** the payoff is fast and real. StepIndicator → confirm payment account →
  CashNeededCard: *"You need $2,340 in Checking by July 15."* — *"No app has ever just… told me
  that."* This is a genuine 10-second wow; the <10s benchmark is the right north star.
- **Triage:** 3.6% review rate means her first inbox is ~15 items, not 400. Swipe, "apply to all
  14 similar," undo — this is best-in-class vs Mint's rule hell. Small miss: swipe-left
  alternatives are generic (`shopping/dining/household/groceries`) even after she's corrected
  similar rows — her own correction history isn't consulted for alternatives.
- **Day 3:** nothing happens. Push is built but keyless; digest is built but cron-gated. Maya
  forgets Aimplifi exists. **Verdict: delight at minute 8, abandonment by day 4 — for
  infrastructure reasons, not product reasons.**

### Persona B — Dave & Jen, married, shared checking + separate cards.

- Dave connects everything under his login. Jen asks: *"Can I see it on my phone?"* There is no
  answer. No second login sharing scoped accounts, no per-partner money dials, no "who spent
  this" attribution, no shared Money Review. Dave screenshots the dashboard and texts it — the
  app's most important chart is being distributed over iMessage.
- Relational failure mode: the coach's "lifestyle creep" flags *Jen's* deliberate dial-up
  spending to *Dave*, because dials are per-User and the User is Dave. The anti-shame guardrails
  are excellent within one person; the app has no concept that money is a two-person system.
- **Verdict: the household is the natural unit of "cash needed by Friday," and the product
  can't hold it. Structural, not cosmetic.**

### Persona C — Priya, 29. FIRE-obsessed power user, high effort tolerance.

- Coach page lands: savings rate as hero, coast-FI, honest assumptions inline. She tries Plan
  in Words: *"retire at 45"* → real bisection over the decumulation engine, honest
  "reachable if you add $410/mo." *"It told me no. Respect."*
- She taps Cash-Needed → Glass-Box rows reconcile to the penny. This is her conversion moment;
  she screenshots it for her FIRE Discord. **Glass-Box is the marketing asset; it's currently
  buried as a feature.**
- Then friction: *"what if I move somewhere cheaper?"* → unknown-intent fallback. *"and what
  about last month?"* after a spend answer → cold restart. She wants threaded exploration; the
  assistant gives her vending-machine turns. Scenario Studio is rightly deferred, but ellipsis
  follow-ups are cheap (§3, idea 2).
- **Verdict: retained anyway (the math keeps her), but she generates zero viral loops because
  sharing/export of insights isn't designed.**

### Persona D — Marcus, 54. High-stress day: paycheck landed, but a dip is coming.

- Radar (committed-only) correctly predicts checking going negative Thursday after the Amex
  autopay; the alert copy is genuinely calm and complete: names the card, the date, and the
  exact timed cover-transfer. Materiality filtering (actionable + imminent only, autopay-covered
  = silent) is exactly right — this respects a stressed user.
- **Failure mode: on today's deploy, that alert is delivered to no one.** No VAPID keys, no
  Resend key, cron not firing → Marcus overdrafts with the warning sitting computed in a
  database. On his low-energy day, the dashboard also greets him with the same fixed stack of ~10 cards when
  he needs exactly one line ("You're clear until the 22nd").
- **Verdict: the emotionally hardest moment is designed beautifully and shipped nowhere.**

### Persona E — Tom, lapsed 3 weeks, comes back.

- No digest reached him (env-gated). On return: stale-data banner, possibly a SimpleFIN
  reconnect dance. No "welcome back — here's what changed": the Money Review exists on /coach
  but nothing surfaces it at re-entry; nothing says "while you were gone, 214 transactions
  auto-filed themselves, 2 subscriptions went up."
- **Verdict: the product punishes absence with chores instead of rewarding return with a story.
  Retention design is the inverse of what it should be.**

### Cross-cutting moments of delight (keep and amplify)

The <10s cash-needed answer; the 3.6% review rate; "Illustration, not advice" honesty; refusal
to fake feasibility in inverse planners; the no-shame creep copy ("Heads up, not a verdict…");
Glass-Box reconciliation; demo mode as a zero-risk evaluation.

---

## 2. Sense-Making & Completeness Audit

- **Coherence: exceptionally high within a session.** One spend definition, one compounding
  convention, /ask can't drift from /coach — the "surfaces can never disagree" discipline is
  real and rare. The experience feels *intentional* screen by screen.
- **Coherence across time: weak.** The product has no arc: day 1 is identical to day 90 except
  the numbers. Coach copy never acknowledges tenure ("your savings rate is up 3 points since
  you started"); the dashboard never reorders around what a user actually checks; nothing
  distinguishes a first visit from a hundredth. The app *knows* the user (dials, corrections,
  goals) but never *shows* that it knows them.
- **"Why this matters" gaps:** Savings-rate and FI cards explain themselves well. Safe-to-spend
  and Radar don't cross-reference ("safe to spend $412 — already accounts for Thursday's Amex").
  They are consistent by construction, but the *user* is never told they agree, which is the
  felt version of trust.
- **The app is never guessing — sometimes to a fault.** Honest abstention ("I couldn't find an
  account matching that") is right, but abstention without a recovery path ("did you mean…?",
  contextual chips after real answers) reads as dumb rather than careful.

## 2b. Bugs, Brittle Assumptions & Failure Modes

1. **Built-but-dormant is the top product risk, and it's invisible.** Push, email, digest,
   Sentry, crons — all env-gated with no in-product surface telling the operator what is
   dormant. Recommend an operator-facing "activation checklist" panel (reads env presence,
   never values). A product whose stickiness stack silently no-ops is one misconfigured deploy
   away from looking abandoned.
2. **Unpushed work #171–#182 sits on one Windows machine** that cannot run a green verify
   (mobile-380 flake). Single point of loss for ~12 shipped increments.
3. **Keyless production silently degrades Ask.** Without an LLM key, every fuzzy phrasing
   falls to `unknown` — and nothing measures it. There is no unknown-rate telemetry, so the
   parser's real-world hit rate is unknowable. (Design intent for demo; a blind spot in prod.)
4. **Single-user schema assumption** (every row User-owned) — see Persona B. Retrofitting
   households later touches authz on every server action; the cost only grows.
5. **`suggestAlternatives` ignores the user's own correction history** — the swipe-left flow
   pitches generic categories to a user whose Corrections table already knows better.
6. **Static in-code synonym/normalization tables** mean the parser and merchant matcher can
   only improve via deploy. There is no path from observed user language to routing coverage
   (§4 fixes this).
7. **Learned rules never expire.** `learn.ts` guards derivation well, but a user whose life
   changes (that Zelle payee was rent, now it's a personal sale) relies on manual undo;
   there's no recency weighting. Low frequency, worth a decay term eventually.
8. **Digest cron is Vercel-Pro-gated** (weekly + 4-cron count) — a plan-tier dependency
   encoded in the retention loop; worth a fallback (fold digest into the daily notify sweep).
9. **Emotional edge case:** a user in genuine financial crisis (every card colliding, radar
   red across the horizon) gets the same calm card-by-card framing. There is no "things are
   hard — here's the triage order" mode. The guardrails prevent shame; they don't yet provide
   care.

---

## 3. 10x Improvement Opportunities (ranked, impact ÷ effort)

| # | Idea | What it feels like | Impact | Effort |
|---|------|--------------------|:------:|:------:|
| 1 | **Activate the proactive stack** (deploy + keys + crons + CI green) | The app starts speaking first: "Checking may go negative Thursday." | 10 | Ops-only |
| 2 | **Ask conversation frame** — deterministic ellipsis resolution: hold `{lastIntent, timeframe, category, merchant}`; "what about last month?" re-runs the frame with one slot swapped. Pure parser state, no LLM, fully testable. | The assistant stops having amnesia. | 9 | M |
| 3 | **Return moment** — "Since you were away" interstitial composing Money Review + radar + auto-filed count + price changes. All numbers already computed. | Absence builds a story instead of a backlog. | 9 | S |
| 4 | **Value receipts** — persist each radar catch / reminder honored / price-increase flagged into a running "what Aimplifi caught" ledger; show cumulative on /coach and in the digest. | "This app has saved me $340 in overdrafts" — retention as receipts. | 8 | S–M |
| 5 | **Contextual follow-up chips** after *every* answer (intent-keyed static map: spend answer → "vs last month · by merchant · largest"), not only on unknown. | Every answer teaches the next question. | 7 | S |
| 6 | **Unknown-question ledger → vocabulary data** (§4) — log unroutable phrasings (PII-scrubbed), mine weekly, promote to a synonym table read at runtime. | The parser gets smarter every week without a deploy. | 8 | M |
| 7 | **Adaptive dashboard** — derive card order/collapse from engagement events at read time (the learn.ts idiom applied to layout); Marcus's one-line day, Priya's FI-first day. | The dashboard becomes *yours*. | 7 | M |
| 8 | **Tenure- & tone-aware coach copy** — closed-set variants of COACH_COPY keyed to weeks-of-history and observed dismissals; "up 3 points since March" beats "your savings rate is 12%." | The coach visibly knows you. | 7 | M |
| 9 | **Personalized triage alternatives** — feed correction history into `suggestAlternatives`. | Swipe-left reads your mind. | 6 | S |
| 10 | **Household mode** — partner logins, scoped sharing, per-partner dials, joint cash-needed. | The product matches how money actually works. | 9 | XL |
| 11 | **Savings-rate streaks + small-win celebrations** (Atomic Habits mechanics; data exists). | A reason to check in weekly that isn't fear. | 6 | S |
| 12 | **Glass-Box as marketing** — shareable (redacted) reconciliation snapshot; "we show our work" landing-page story. | The moat becomes the pitch. | 7 | S |

---

## 4. Self-Improving System Blueprint (runtime adaptation, minimal-to-zero new code)

**Design stance.** Generic "let the LLM rewrite its own prompt" loops would violate this
product's constitution (no fabrication; deterministic decisions in code). But Aimplifi already
contains the *correct* self-improvement idiom, shipped and hostile-critic'd: **`learn.ts` —
derive adaptations from user-visible, undoable history at read time; earn trust by repetition;
enter at the flagged band, never the silent band.** The blueprint below is that idiom
generalized to five loops. Nothing here lets a model originate a fact; everything is a data
row a user (or operator) can see and delete.

### 4.1 Memory structures (mostly already exist)

| Store | Exists? | Feeds |
|---|---|---|
| `Correction` (+ signature) | ✅ | learned rules; **extend to:** triage alternatives, per-merchant vocab |
| `CategoryPrediction` (Brier) | ✅ | gatekeeper validation; per-user threshold tuning |
| `NotificationSent` | ✅ | alert-fatigue detection (sent vs subsequently acted) |
| `Goal`, dials, `AuditLog` | ✅ | tenure narrative, adherence loops |
| `EngagementEvent` *(new, one generic table)* | ➕ | `{userId, surface, verb: viewed/dismissed/expanded/acted, subjectKey, at}` — powers adaptive dashboard, copy suppression, notification cadence |
| `UnknownQuestion` *(new, tiny)* | ➕ | `{userId, scrubbedText, llmGuessKind?, at, resolvedIntent?}` — parser vocabulary mining |
| `VocabEntry` *(new, data not code)* | ➕ | `{phrase → intent/category/merchant, status: shadow/flagged/active, source}` — moves synonym tables from code to data |

### 4.2 The five loops

1. **Categorization (running today).** Correction history → learned rules at read time.
   *Extend:* consult the same history in `suggestAlternatives`; add recency weighting so stale
   intent decays.
2. **Language.** Every `unknown` (and every LLM-rescued classification) writes an
   `UnknownQuestion` row. A weekly reflection pass (cron or an idle-time job — same pattern as
   the digest cron) clusters them by n-gram; clusters with ≥N distinct users/asks become
   `VocabEntry(status=shadow)`. Shadow entries are evaluated silently: would they have routed
   subsequent questions to an intent the user then engaged with? Pass → `flagged` (answer
   carries "interpreted" disclosure, exactly like today's LLM route) → `active`. **The parser
   improves weekly with zero deploys, and every promotion has held-out evidence.**
3. **Attention.** `EngagementEvent` rows → derived-at-read-time weights: dashboard card order
   (viewed/expanded ↑, chronically ignored ↓ and collapsed behind "More"), notification cadence
   (alerts repeatedly dismissed without action → demote a level; acted-on → keep), coach-insight
   suppression ("you've seen this creep note 3× and dismissed it — stop repeating it," the
   suppression notifications already have, generalized). Hard floor: `critical` radar alerts are
   never demotable — safety copy is not personalizable.
4. **Calibration.** Per-user Brier from `CategoryPrediction` → *bounded* nudging of
   `AUTO_FLAGGED_BPS` per user (clamp ±500bps around global; never below the global silent
   floor). A consistently-corrected user gets more review; a never-correcting user gets more
   silence. The gate: tuning is recomputed from scratch each read (no ratchet), and a
   regression in per-user Brier auto-reverts to global thresholds.
5. **Narrative.** Coach copy variants (all pre-written, all guardrail-test-scanned — the
   closed set IS the safety) selected by tenure bucket + observed tone response (does this user
   expand narrative cards or dismiss them?). The runtime chooses *which approved sentence*, never
   *what the sentence says*.

### 4.3 Multi-agent pattern, mapped honestly onto this codebase

- **Executor** = the pure engines (unchanged).
- **Proposer** = the reflection passes (loops 2–5 miners) — cron/idle jobs that only *write
  candidate rows in shadow status*.
- **Gatekeeper** = deterministic validators: held-out replay against Corrections/Brier
  (machinery exists), guardrail copy tests, the sign checks — plus the existing build-time
  Hostile Critic for any change to the validators themselves.
- **Critic** = the weekly self-audit snapshot: per-user review-rate, unknown-rate, alert
  act-rate, digest open proxy (link taps), written to a metrics table and surfaced on the
  existing AI-trust panel (#177). When a loop's metric regresses, its candidates freeze.

**Constitution & safeguards.** COACH_COPY + guardrail tests + the no-fabrication rule are the
immutable constitution — runtime loops may only *select within* it. Every adaptation is: (a) a
visible data row, (b) undoable, (c) entered at the flagged/disclosed band, (d) promoted only on
repetition + held-out validation, (e) reverted automatically on metric regression. This is
`learn.ts`'s five safety properties, verbatim, applied system-wide.

**How it compounds.** Week 1: corrections → learned rules; payment account grounds radar.
Month 1: engagement events reorder the dashboard; ignored insights stop repeating; unknown
ledger has its first mined vocabulary. Month 3: the parser routes phrasings no deploy ever
taught it; thresholds fit the user's correction temperament; the value-receipts ledger and
streaks give the digest a personal spine. **By month 6 the switching cost is the accumulated
model of you** — which no export to a competitor can carry.

---

## 5. Prioritized Roadmap

**30 days — ship & return (retention is ops-bound, not code-bound):**
Push #171–#182 · CI green (quarantine mobile-380 on Windows, trust CI) · deploy Vercel+Neon ·
set all keys (Resend, VAPID, CRON_SECRET, Sentry DSN) · live SimpleFIN/Plaid spot-checks ·
operator activation-checklist panel · return-moment interstitial (idea 3) · contextual chips
(idea 5) · Glass-Box shareable snapshot (idea 12).

**90 days — memory & loops:**
Ask conversation frame (idea 2) · UnknownQuestion ledger + weekly mining + VocabEntry
shadow→flagged pipeline (loop 2) · EngagementEvent capture (one table, thin hooks) · value
receipts (idea 4) · adaptive dashboard order (loop 3) · personalized triage alternatives
(idea 9) · streaks (idea 11) · tenure-aware coach variants (loop 5, first bucket only).

**6 months — structure & scale:**
Household architecture decision + spike, then MVP (partner login, scoped account sharing,
joint cash-needed, per-partner dials) · bounded per-user threshold tuning with gatekeeper
(loop 4) · Plaid holdings parity + benchmark line · crisis-mode coach framing (§2b #9) ·
reassess native wrapper only if PWA push underperforms · widen the allowlist deliberately and
watch the self-audit metrics as the first real cohort arrives.

---

## 6. Unknowns & Questions (assumptions made)

1. **Who is using this today?** Signup is allowlisted; I assumed user count ≈ owner + invitees.
   Every retention claim above is untestable until the loop in §4.3's Critic exists — there is
   currently zero telemetry (a privacy stance I preserved: all proposed events are first-party,
   per-user-visible, no third-party analytics).
2. **Is "family/household" in scope?** The audit brief weights family dynamics heavily; the
   product is structurally single-user. I flagged household mode as the 6-month structural bet —
   this needs an explicit owner decision, recorded in DECISIONS.md.
3. **Operator appetite for paid infra** (Vercel Pro for the weekly cron, Resend, Neon backups)
   — several retention features are plan-tier-gated.
4. **Monetization intent** — unaddressed everywhere in the docs. It changes the 6-month
   ordering (household mode is also the natural paid tier).
5. **LLM key policy in production** — Ask's fuzzy routing and loop-2 mining assume some model
   access (local Qwen per COMPETITIVE_GAP_PLAN §3 is the stated fit; unverified here).
6. **The mobile-380 flake** — I assumed it is environmental (per docs/lessons) and CI is the
   arbiter; if it reproduces in CI, that's a real defect and jumps the queue.
7. I could not run the app or `verify.sh` in this audit environment; all claims trace to code
   and ledger reads, not executed sessions — flows were simulated against source, not clicked.
