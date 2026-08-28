## §Nudge feed (AI plan §2.2 — tier-then-rank, hand-verified orderings)

The Smart Notification & Nudge Engine is a pure reshape+order over existing engine
outputs (NUDGE_PLAN.md slice 1). It does ZERO money arithmetic — every cents/date on
a proposal is copied verbatim from its source. Severity is an ORDERING, not a scalar
score. Tier rank: `critical(0) < action(1) < opportunity(2) < handled(3)`. Within a
tier: `sortDate` ascending (undated last), then `centsAtStake` descending, then `key`
ascending. Total and deterministic. `today = 2026-06-10` throughout.

### Tier assignment (each source row → exactly one tier)
- **payment_due:** `userActionCents <= 0` → HANDLED (autopay covers it, never pushed);
  else `daysUntil <= 3` (the notify/select push window) → CRITICAL; else → ACTION.
  A card with autopay=MINIMUM leaving a top-up (`autopayCovered=true` **and**
  `userActionCents > 0`) tiers by daysUntil like any actionable due — `autopayCovered`
  is a display flag, `userActionCents` is the gate (matches the push floor exactly).
- **cash_flow_dip:** emitted only when `radar.pushWorthy && firstNegativeDate != null`
  → always CRITICAL (pushWorthy already encodes the committed-only within-window test).
- **cash_needed_shortfall:** emitted only when `shortfallCents > 0` → CRITICAL.
- **opportunity** (unused-subscription / price-increase / insurance-reshop /
  negotiable-bill): OPPORTUNITY, undated (`sortDate = null`).

### Hand-verified orderings
- **O1 — shortfall vs due-tomorrow (both CRITICAL).** payment_due due 2026-06-11
  ($500 action); cash_needed_shortfall date 2026-06-15 ($1,412.33). Both CRITICAL →
  order by date ascending: **[payment_due (06-11), cash_needed_shortfall (06-15)]**.
  The nearer deadline ranks first even though the shortfall is larger — the tie-break
  is date, then cents, never a blended score.
- **O2 — estimated vs real, same day (both CRITICAL).** Amex real $1,800 due
  2026-06-12; Chase **estimated** $2,000 due 2026-06-12. Same date → `centsAtStake`
  descending: **[Chase ($2,000, estimated), Amex ($1,800, real)]**. Ordering is
  estimate-agnostic — the larger stake wins; `isEstimated` is a display flag only
  (the push floor likewise never reorders by estimate).
- **O3 — price-increase vs unused-subscription (both OPPORTUNITY, undated).**
  price-increase Netflix $24.99; unused-subscription GymPass $40.00. Both undated →
  `centsAtStake` descending: **[unused-subscription ($40.00), price-increase ($24.99)]**.
- **Full tier order.** critical due (06-12, $500) + action due (06-30, $300) + unused-sub
  ($40) + handled autopay (06-11, $900) → **[critical, action, opportunity, handled]**.
  The handled autopay sorts LAST despite its earliest date — HANDLED is never the
  headline and never above a user-action proposal (autopay silence).

### Dismissal honesty
- CRITICAL dismissKey = `<key>:<today>` (per-day): dismissing collapses it for today
  only; on the next build the per-day key no longer matches, so it returns un-dismissed
  while the condition persists. It is NEVER suppressed from the feed regardless of
  dismissal state — a material warning is never buried.
- ACTION/OPPORTUNITY dismissKey = `<key>` (per-fact): stays suppressed until the
  underlying fact changes. A price-increase key embeds the `from→to` transition, so a
  NEW price change mints a new key and the opportunity returns despite the old dismissal.

### Push lockstep (the load-bearing safety invariant)
Every `selectNotifications` candidate has a feed proposal with the SAME key, tiered
CRITICAL. payment_due reuses `paymentNotificationKey`, cash_flow_dip reuses
`radarNotificationKey` — keys are reused from notify/select, not re-minted, and the
CRITICAL window is the shared `NOTIFY_DUE_WINDOW_DAYS` constant. A feed that buries a
push candidate, or a push the feed can't resolve, fails the lockstep test in both drifts.

### Slice-2 display copy — `centsAtStake` means a DIFFERENT thing per kind
The feed engine copies `centsAtStake` verbatim, but its SEMANTIC is not uniform, so the
`TodayFeedCard` copy (today-feed-copy.ts) labels each kind correctly — copying a value is
not copying its meaning (critic cycle-1 P1-1):
- **payment_due:** `userActionCents` — the amount to pay AFTER autopay, NOT the statement
  total. When autopay covers part, the card shows the split "$500 to pay · (autopay covers
  $100)" from the verbatim `Proposal.autopayCents` — the two parts are shown, never summed,
  so it agrees with the reminders card and never presents the remainder as the total.
- **cash_flow_dip:** `coverTransfer.amountCents` — the recommended cover transfer.
- **cash_needed_shortfall:** `shortfallCents` — the projected dip. `isEstimated` is derived
  `perDueDate.some(cards estimated)` (the engine makes the cycle homogeneous), disclosed
  INLINE "(estimated)".
- **price-increase:** the monthly INCREASE (delta) — "Up $X/mo", never "Now $X".
- **unused-subscription:** the actual monthly cost.
- **insurance-reshop / negotiable-bill:** an ESTIMATED monthly SAVING (~15% / flat $20),
  labeled "could save around $X/mo (estimated)".
Titles are obligation-neutral ("Payment due" covers cards AND loans — the proposal drops
the discriminant), and no copy addresses the reader as the payer (a partner's row can flow
in at household scope — the #221 lesson).

### Slice-2 dismissal store + demo fence
Nudge dismissals persist to a DEDICATED `NudgeDismissal` store (keys embed merchant+cents,
so EngagementEvent's closed-set no-money contract can't hold them — #236 P1-1), read into
`NudgeInput.dismissedKeys` and fed ONLY to `buildNudgeFeed` (never `selectPaymentReminders`
— the push-but-absent-from-feed bury failure). The shared demo user never WRITES and never
READS the store (double fence, independently tested) — dismissal is session-only for
`user-demo`, so one visitor's "hide this" never leaks to the next. The write path is
rate-limited (40/60s/user), key-length-capped (≤200), and read-bounded (newest 500;
re-dismiss bumps recency). CRITICAL is exempt from all suppression regardless of the store.
