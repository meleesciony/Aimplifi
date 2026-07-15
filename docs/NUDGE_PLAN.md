# Smart Notification & Nudge Engine — build plan (AI_DIFFERENTIATION_PLAN §2.2, rank #7)

*Scoping + engine design checkpoint. Written 2026-07-15 after a notification-surface map
(reminders/select, notify/select, the three crons, insight sources, behavioral tables).
Status: build-loop step 1 (acceptance criteria as testable assertions). Engine NOT yet built.*

## Job-to-be-done
Don't bury me in alerts. Push the one thing that needs me today, keep the rest in a ranked
feed, stay silent on anything autopay handles, and stop showing me the suggestion I keep
ignoring. Ranking and routing are fully deterministic; no number is authored by a model.

## The scoping decision (honoring the plan's adversarial verdict, all four conditions)

1. **The learning loop is slice 3, and slice 3 IS TASKS 3.5** — one home, not two tasks.
   Responsiveness-learning cold-starts to deterministic defaults and needs weeks of
   `EngagementEvent` data, so it ships last, bound by the audit §4 constitution (visible row,
   undoable, disclosed band, promotion on repetition, auto-revert on regression) and the
   demo fence (the shared `user-demo` must never learn from a visitor's dismissals).
2. **v1 value is the in-app ranked feed.** Push/email stay exactly as shipped (#173/#184,
   dormant-safe); `notify/select.ts` is NOT touched in v1. The feed is additive.
3. **No cross-kind scalar severity.** The verdict called cross-kind calibration "genuine
   judgment work" — so v1 refuses to do it. Severity is an ORDERING, not a number:
   kinds map to tiers by rule, and ranking within a tier uses only commensurable fields
   (days, cents). There is no weighted sum to mis-calibrate or fake-precision score to defend.
4. **CUT: the LLM digest-title compression** (deterministic templates only — it was the one
   materially softer boundary in the concept). **DEFERRED: the NL-reply mapping** ("snooze
   till payday") — push/email are one-way channels today; there is no reply surface for it to
   read. Revisit only if one ships. Net: **slices 1–2 contain zero LLM calls.**

Further cuts from the surface map: **no new `InsightFeedback` model** — 3.1's
`EngagementEvent` (surface, verb ∈ viewed/dismissed/expanded/acted, closed-set subjectKey,
no money, no PII) is already exactly the behavioral-only record the plan described; nudges
log with `subjectKey = "nudge:<kind>"`. **No `User.notificationPrefs` field in v1** — nothing
would read it; quiet-by-default + the existing channel gates cover v1. Life-event source: not
in the v1 closed set (no detector exists; the plan itself says optional input, not blocker).

## Engine design — `src/lib/engine/nudge/` (pure, no I/O)

### The verbatim-copy rule is the whole grounding story
The nudge engine does **zero money arithmetic**. Every `cents` and date on a `Proposal` is
copied byte-for-byte from the source engine's own output (the `receipts.ts` idiom, already
hostile-critic-proven at #206). The engine is a reshape + order, so its tests are
hand-verified expected orderings, and it can never disagree with the dashboard.

### Proposal sources (closed union, v1)
- `payment_due` — `reminders/select.ts` rows verbatim (carries `autopayCovered`,
  `autopayCents`, `userActionCents`, `isEstimated`, `daysUntil`, `reminderKey`).
- `cash_flow_dip` — the radar result (`pushWorthy`, dip date/depth, cover recommendation).
- `cash_needed_shortfall` — `CashNeededResult.headline.shortfallCents/shortfallDate` +
  `recommendation` verbatim.
- `price_increase`, `unused_subscription`, `insurance_reshop`, `negotiable_bill` —
  `findOpportunities()` rows verbatim (incl. the merchant + from→to transition key).
Connection-repair alerts (#183) are additive later by construction; not in slice 1.

### Tier-then-rank
- **CRITICAL** (exempt from ALL suppression, slice 3 included — the material floor):
  committed-only forecast first-negative within 7 days (`pushWorthy`-aligned); cash-needed
  shortfall > 0; a due within the 3-day push window with `userActionCents > 0`.
- **ACTION**: dues needing user action beyond the push window; estimated dues flagged as such.
- **OPPORTUNITY**: the four `findOpportunities` kinds.
- **HANDLED** (quiet reassurance): `autopayCovered` dues — rendered collapsed ("autopay has
  this"), never the headline, never pushed.
Within a tier: `daysUntil` ascending, then cents at stake descending, then stable key — the
order is total and deterministic. The headline is the single top proposal; everything else
collapses behind it. No proposals → an honest "nothing needs you today", never manufactured
urgency.

### Push lockstep (the sharp failure mode here = burying what push escalates)
`notify/select.ts` already owns the deterministic push floor (materiality, 3-day window,
radar cooldown, `NotificationSent` de-dupe). The feed must never rank below-the-fold what
push would escalate: **a locking test asserts every `selectNotifications` candidate's
corresponding proposal is tier-CRITICAL** on the same inputs. Shared inputs, not re-derived —
same lockstep discipline as glass-box `trace.ts`.

### Dismissal honesty (the "never permanently hides a MATERIAL warning" guardrail)
- CRITICAL: dismiss collapses it for TODAY only; it reappears while the condition persists.
- ACTION/OPPORTUNITY: dismiss keys to the underlying fact (`reminderKey`; the opportunity
  merchant+transition key), so it stays gone until the fact CHANGES — the price-increase
  key idiom, reused not re-minted.
- Every proposal renders "why am I seeing this" (its tier rule + the verbatim inputs) and a
  "show everything" control — the transparency the plan requires.

## Acceptance criteria (write as tests FIRST — `tests/unit/nudge-*.test.ts`)
1. **Verbatim-copy:** on the seed dataset, every Proposal cents/date field equals the source
   engine's output exactly; grep-provable absence of arithmetic on money in `engine/nudge/`.
2. **Total tier mapping:** every source row maps to exactly one tier; unknown kinds are
   unrepresentable (closed union, exhaustive switch).
3. **Always-escalate floor:** a fixture with committed-only first-negative ≤7 days ranks that
   proposal CRITICAL and #1 regardless of any dismissal state.
4. **Autopay silence:** an `autopayCovered` due is HANDLED — never the headline, never above
   any user-action proposal; an all-autopay day yields the honest empty headline.
5. **Push lockstep:** for every fixture where `selectNotifications` emits a candidate, the
   feed tiers that proposal CRITICAL (drift test in BOTH directions: a feed that buries it or
   a push the feed doesn't know fails).
6. **Deterministic order** with hand-verified expected orderings in EDGE_CASES: shortfall vs
   due-tomorrow; estimated vs real due same day; price-increase vs unused-subscription.
7. **Dismissal honesty:** persisting CRITICAL condition reappears next build after dismissal;
   a dismissed OPPORTUNITY stays hidden until its transition key changes, then returns.
8. **Demo fence (recorded now, enforced in slice 3):** no adaptation reads `user-demo`
   behavior; slices 1–2 have no learning by construction.

## Sequencing
- **Slice 1 (engine):** `Proposal` union + tiering + ordering + dismissal-key semantics +
  tests (criteria 1–7). Opus 4.8 build; **Fable hostile critic** — ranking is
  suppression-adjacent (a mis-tier buries a material warning), the same safety class as 3.5.
- **Slice 2 (UI):** dashboard "Today" feed card — headline + collapsed rest, why-this
  disclosure, show-everything, dismiss wiring via existing patterns (`EngagementEvent`
  logging from 3.1; the dismissed-key idiom). e2e: headline present, autopay quiet, dismissal
  honesty, axe. No schema change.
  **Dismissal-wiring guardrail (do NOT misread "reminder dismissedKeys"):** nudge dismissals
  write ONLY the dedicated nudge suppression store that feeds `NudgeInput.dismissedKeys`.
  They must NEVER be routed into `selectPaymentReminders`' own upstream `dismissedKeys`
  filter — that drops the reminder from the feed's INPUT before the engine's CRITICAL
  exemption can act, while the push cron (which passes no `dismissedKeys`) still pushes it:
  push-but-absent-from-feed, the exact bury-failure, invisible to engine-level tests. Build
  the feed's reminder input with the SAME (today: absent) `dismissedKeys` the notify cron
  uses, so push and feed share byte-identical reminder rows.
- **Slice 3 (= TASKS 3.5, merged):** cadence adaptation — repeatedly-dismissed-without-action
  kinds demote a level (never below the CRITICAL floor), acted-on kinds hold; audit §4
  constitution end-to-end; demo-fenced; **Fable critic** (alert suppression = safety surface).
  Deferred until real behavioral data exists.

## Readiness notes (from the surface map, 2026-07-15)
- `reminders/select.ts:20–41` — PaymentReminder + `reminderKey`; already carries every field
  the payment proposal needs. `notify/select.ts:30–154` — materiality filter, 3-day window,
  4-day radar cooldown; the push floor to lockstep against, not modify.
- Crons are dormant-safe with AuditLog would-have-sent records (`reminders`/`notify`/`digest`
  routes); `NotificationSent` `@@unique([userId,key])` is the delivery de-dupe anchor.
- `fi/insights.ts:100–191` — Opportunity shape incl. `isEstimate` + price-change transition
  fields; `recurring/detect.ts:25–40` — `priceChangedAt`, `possiblyUnused`.
- `EngagementEvent` (schema:621) — the behavioral substrate; `SelfAuditSnapshot.alertsActed`
  (3.2) is the regression metric slice 3's auto-revert watches.
- Dashboard renders cards in fixed source order (`dashboard/page.tsx`) — the feed card is a
  new RSC component; no existing ranking to displace.
