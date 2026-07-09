# Competitive gap plan — Aimplifi vs Mint / Simplifi / Monarch / Copilot

*Written 2026-07-07 from a full-codebase + docs review (3 explorer sweeps: product surface,
engine/data/tests, vision-vs-reality). Assessment first, then the gap plan, then the
model-routing policy for build sessions.*

---

## 1. Verdict scorecard

| Dimension | vs Mint/Simplifi today | Evidence |
|---|---|---|
| **Smarter** | **Ahead — genuinely differentiated** | Cash-Needed engine (white space no competitor owns), inverse planners (Plan-in-Words trilogy #125/#126/#131 — no tracker does inverse solving), grounded never-originates-a-fact AI (structural, not a prompt), Brier-scored categorization accuracy. 1,411 unit tests pinned to hand-verified EDGE_CASES.md. |
| **More useful** | **Ahead on cash-flow/planning; behind on breadth-of-life** | Wins the "how much do I need and when" job outright. Investments now basic-parity (holdings, TWR/XIRR, retirement decumulation) but Simplifi still deeper. No credit score, no FX/multi-currency, no bill negotiation. |
| **Easier to use** | **Behind for a normal user** | Demo mode is best-in-class for evaluation, but real onboarding friction is high: Plaid live is gated, SimpleFIN needs a pasted token, live network paths are UNVERIFIED. Mobile secondary nav is 7 unlabeled icons. Mint/Simplifi win the first 10 minutes for a non-technical user. |
| **Stickier** | **Behind — the biggest strategic gap** | Retention mechanics are thin: triage badge, dashboard reminder card, dormant email reminders. No push, no digest, no proactive alerts. Cash Flow Radar (the adjudicated-build-now proactive feature) is not built. Mint's stickiness was alerts + habit; Aimplifi currently requires the user to remember to open it. |

**Bottom line:** the *engine and trust core* is on a clearly winning path — it is already smarter
than any incumbent in its lane, and the discipline (verify gate, hostile critic, integer cents,
no-fabrication AI) is a durable moat. The path to "way more useful, easier, stickier" is **not
blocked by code quality; it is blocked by distribution and the proactive layer**: live-sync
reliability, onboarding friction, and the absence of push/digest/radar mechanics that make a
finance app a habit instead of a tool.

---

## 2. The gap plan (priority order)

> **STATUS RECONCILIATION (2026-07-08, updated as of #182).** A full-codebase audit
> found this plan was written (2026-07-07) without noticing several listed "gaps" were
> **already built**. Corrected state, so no future session rebuilds them:
> - **Gap 1:** §3 connection-health UX **BUILT** (`engine/sync/health.ts`, dashboard
>   `StaleDataBanner`, per-account freshness #179). §4 sync-*failure* surfacing (vs
>   recency) **BUILT (#183)** — persisted `lastSyncError` signal on both connection models,
>   pure broken/ok/unknown classifier, dashboard `ConnectionAlertsCard`. §1 live
>   walkthroughs + §2 sync cron remain **owner/env-gated** (tokens, `CRON_SECRET`).
>   **Gap 1 is now fully built except the owner/env-gated live spot-checks.**
> - **Gap 2 (the "strategic build"):** §1 Cash Flow Radar **BUILT & surfaced** on the
>   dashboard (`engine/radar/radar.ts`, `cash-flow-radar-card.tsx`). §2 web push **BUILT**
>   (`lib/push.ts`, `/api/push/*`, `PushSubscription`, `PushOptIn`) + materiality filter
>   (`engine/notify/select.ts`, `/api/cron/notify`). §3 weekly digest **BUILT**
>   (`engine/digest/build.ts`, `/api/cron/digest`). Email/push delivery is **env-gated**
>   (`RESEND_API_KEY`, `VAPID_*`). ~~**Genuine remaining gap:** `/api/cron/notify` and
>   `/api/cron/digest` are **NOT in `vercel.json`**~~ **WIRED (#184)** — both scheduled
>   (notify daily 13:00, digest Mon 14:00), locked by a bidirectional `vercel.json`↔route
>   coherence test. **Gap 2 is now fully built; delivery remains env-gated (keys) and,
>   for the weekly digest + 4-cron count, Vercel-Pro-gated (Hobby is daily-only/2-cron).**
> - **Gap 4:** §1 Glass-Box **BUILT** (#178), §2 AI-trust panel **BUILT** (#177).
> - **Gap 5:** §1 provenance tag **BUILT** (#180); Plaid holdings parity + benchmark line
>   **owner/data-gated** (no market-data feed / holdings-history schema).
> - **Gap 6:** §1 CI **BUILT** (#181). §3 session invalidation + PII-free deletion record
>   **BUILT (#182, this).** §2 error tracking + §4 Neon backups still **NOT BUILT**.
> - **Gap 3:** §3 guided first-run **BUILT** (#176), Investments nav **BUILT**; §1 loading
>   skeletons + destructive-delete confirms **NOT BUILT**; §2 mobile nav **owner-design-gated**.
>
> **True unblocked, in-session-verifiable remaining work:** ~~wire the two crons into
> `vercel.json` (Gap 2)~~ **DONE #184**; ~~Gap 1 §4 sync-failure surfacing~~ **DONE #183**;
> Gap 3 §1 skeletons + delete confirmations; Gap 6 §2 error tracking (partially env-gated).
> Everything else is owner/env-gated or already done.


### Gap 1 — Live-data reliability (usefulness gate; everything else is downstream)

The app's differentiators only matter on *live* data. Today Plaid and SimpleFIN network paths
are UNVERIFIED and sync is manual/cron-dormant.

1. Execute `docs/SIMPLEFIN_WALKTHROUGH.md` and `docs/PLAID_WALKTHROUGH.md` live spot-checks
   (owner-gated: needs tokens). Convert both UNVERIFIED labels to verified with logged output.
2. Activate scheduled sync: add the sync cron path(s) to `vercel.json` + `CRON_SECRET`
   (documented operator step, no code).
3. Connection-health UX: a "last synced Xh ago / connection broken → reconnect" state on
   /accounts and a stale-data banner on the dashboard when the newest transaction is older
   than N days. (Engine-first: a pure staleness classifier; trivial tests.)
4. Sync-failure surfacing into the reminders card (a broken feed is the most material alert
   a tracker can send).

### Gap 2 — Stickiness: the proactive layer (the strategic build)

1. **Cash Flow Radar** (AI plan §1.2, adjudicated **build-now**, commit-only alarm variant):
   forward-simulate checking against upcoming card dues + scheduled flows; warn *before* the
   dip; name the colliding card; compute the minimum timed cover-transfer. Reuses cash-needed
   + forecast + scheduled engines; pure engine first per rule 5.
2. **Notification delivery**: activate email reminders (set `RESEND_API_KEY`, add
   `/api/cron/reminders` to `vercel.json` crons) and add **PWA web push** (the manifest + SW
   are already in place; push is the missing half). Radar alerts and payment reminders share
   one notification engine with per-user quiet rules (Smart Notification Engine, Wave 2 —
   build the minimal materiality filter, not the full concept).
3. **Weekly digest email**: Money Review + "one next action" + upcoming week's dues, rendered
   from the same tested engines. This is the cheapest retention win in the plan: it brings
   the user back without requiring a new surface.

### Gap 3 — Ease of use: onboarding + mobile polish

1. Burn down the 2026-06-24 production-readiness backlog "DO NEXT" list (loading skeletons,
   empty states for chartless data, real heading structure, per-page titles, destructive-delete
   confirmations, popover dismissal, Investments nav entry) — all additive, all small.
2. **Mobile secondary-nav redesign** (7 unlabeled icons, sub-44px targets — flagged in the
   audit as needing owner scoping): propose a "More" sheet or labeled 2-row grid; benchmark
   against the <10s "how much do I need?" goal.
3. Guided first-run: after signup, a 3-step connect flow (bank → confirm payment account →
   see your Cash-Needed number) with the SimpleFIN token walkthrough inlined. Measure
   time-to-first-number; the target is the existing <10s benchmark from real data, not demo.
4. Later/optional: wrap as a store-distributed app only if PWA push proves insufficient.

### Gap 4 — Make the trust moat *visible* (marketing the architecture)

1. **Glass-Box assistant** (Wave 2, needs the rework pass first): "tap any number → the rows
   it's made of, reconciled to the penny." Start with the two highest-traffic numbers:
   dashboard Cash-Needed and safe-to-spend. This converts the internal cardinal rule into a
   felt product promise no incumbent can copy without a rebuild.
2. Surface the already-instrumented accuracy metrics (Brier/precision from
   CategoryPrediction) on a small "AI trust" panel in Settings — data exists, UI is thin.

### Gap 5 — Investments depth (parity pressure from Simplifi)

Lower priority than 1–4; incremental: provenance tag on synced holdings (`source` column is
in place), live Plaid `/investments/holdings` parity with the SimpleFIN path, simple
benchmark-vs-index line on /investments. Skip watchlists/research — off-thesis.

### Gap 6 — Operate-for-real-users hardening

1. CI: run `scripts/verify.sh` in GitHub Actions on push (today it's on-demand local only).
2. Error tracking in prod (Sentry or Vercel monitoring) — currently no visibility into real
   users' failures.
3. The two deferred auth/compliance items before widening the allowlist: multi-device session
   invalidation and a non-cascading PII-free deletion record.
4. Scheduled Neon backups per BACKUP_AND_RECOVERY.md.

**Sequencing rationale:** 1 → 2 → 3 form the useful→sticky ladder (live data makes alerts
truthful; alerts make the app a habit; polish removes the friction for invited users). 4 is
the brand story once 1–3 exist. 5–6 run as small slices between phases.

---

## 3. Model-routing policy (token efficiency)

Pricing (per MTok, in/out): **Fable 5** $10/$50 · **Opus 4.8** $5/$25 · **Sonnet** $3/$15 ·
**Haiku 4.5** $1/$5. Output tokens dominate agentic sessions, so Fable ≈ 2× Opus ≈ 10× Haiku
in practice.

| Work | Model | Why |
|---|---|---|
| Architecture decisions, new *money-math* engines (radar simulation, solvers), hostile-critic passes on rule-3 domains (money, security, data integrity), multi-hour autonomous phase builds | **Fable 5** | Highest ceiling on long-horizon + adversarial work; this repo's correctness bar justifies 2× exactly where a silent math bug is the most expensive defect. Give it the full phase spec up front, effort high. |
| Default daily driver: feature slices, UI work, refactors, most implementation + routine critic cycles, e2e authoring | **Opus 4.8** | Same tokenizer as Fable at half the price; state-of-the-art agentic coding. This should be ~80% of main-thread sessions. |
| Mechanical, well-specified slices (backlog burn-down items in Gap 3.1, copy edits, test scaffolds) | **Sonnet** (or Opus at `effort: medium`) | Near-Opus on scoped coding at 60% of the price; lowering effort on Opus is often the simpler lever than switching models. |
| Exploration, doc digestion, lesson-mining, grep-and-summarize — anything read-heavy | **Haiku 4.5** via the `explorer` subagent | Already codified in LOOP_ENGINEERING token rule 1/5. Keep heavy reads out of the Fable/Opus context; this session's three sweeps ran exactly this way. |
| **Local Qwen (Ollama)** | See below | Not for in-repo agentic coding; genuinely good for two specific jobs. |

**Where local Qwen fits:**

1. **The app's runtime LLM, not the build loop.** Ask Aimplifi's model only picks an intent
   from a closed set or extracts a date, and the categorizer's LLM only picks a label from a
   closed set — exactly the tasks a local 7–14B Qwen does nearly free. Adding an
   OpenAI-compatible local endpoint alongside the existing Anthropic/xAI providers is a small
   provider addition, and it upgrades the privacy story from "your data is never sent to the
   model" to "the model runs on-device/self-hosted." Zero marginal cost per query; the
   closed-set validation (`parseLlmCategory`, `validateIntent`) already protects against a
   weaker model's mistakes — a wrong pick lands in triage, never a fabricated number.
2. **Offline batch chores**: generating merchant-descriptor test variants, drafting commit
   messages, summarizing long logs. Low stakes, zero cost.

**Where Qwen does *not* fit:** main-thread coding sessions in this repo. The operating rules
(no fabrication, verify-gate honesty, hostile critic) depend on a model that reliably runs the
loop rather than narrating it; a local model saving $5 that ships one silent money bug is a
bad trade. Route cheapness to reads (Haiku) and to the app's runtime (Qwen), never to the
edits.

**Session hygiene (all models):** explorer-first for anything >2 files; state in the ledgers
not the scrollback; `xhigh`/`high` effort only for engine/critic work, `medium` for routine
slices.
