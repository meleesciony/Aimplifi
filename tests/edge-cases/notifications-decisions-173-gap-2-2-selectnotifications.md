## §Notifications (DECISIONS #173 — Gap 2 §2, `selectNotifications`)

Materiality = actionability + urgency (no dollar floor); dedup = the caller passes keys already
delivered and they're excluded. Every amount is copied verbatim from the source engine. today =
`2026-06-10`; pinned in `tests/unit/notify-select.test.ts`.

### A. Payment reminder — surfaced vs suppressed
- Actionable + imminent: Freedom `userActionCents` 45000¢ due 06-12 (daysUntil 2 ≤ 3) ⇒ ONE
  `payment_due` notification, key `payment_due:a1:2026-06-12`, level `warning`, amount **45000¢**
  ($450.00), url `/accounts`.
- Due today (daysUntil 0) ⇒ level **`critical`**.
- Autopay-FULLY-covered (`userActionCents` 0, `autopayCents` 90000¢) ⇒ **suppressed** (nothing to
  do).
- PARTIAL autopay (`userActionCents` 20000¢, `autopayCents` 50000¢) ⇒ **surfaced** at the
  user-action **20000¢** ($200.00), NOT the full bill — the exact case a `<=`-vs-`autopayCovered`
  slip would wrongly drop.
- Beyond the window (daysUntil 5 > 3) ⇒ **suppressed** (`upcoming` stays in-app only).
- Estimated ⇒ `isEstimated:true` + "(estimated…)" in the body.

### B. Radar alert — the pushWorthy gate
- `pushWorthy` true, firstNegative 06-14, colliding Sapphire, cover 30000¢ ⇒ ONE
  `cash_flow_alert`, key `cash_flow_alert:2026-06-14`, amount = **coverTransfer 30000¢** verbatim,
  names Sapphire, url `/dashboard`. daysUntil ≤ 1 ⇒ `critical`, else `warning`.
- `pushWorthy` false (e.g. the seed's own radar dip is 14 days out) ⇒ **no radar notification**
  (only payment reminders can push in the demo).
- `coverTransfer` null ⇒ amount **0**, no crash, no cover phrase.
- radar null ⇒ nothing.

### C. Dedup + cooldown + ordering
- A key present in `sentKeys` ⇒ that notification is **excluded** (idempotent daily sweep).
- `radarAlertOnCooldown` true ⇒ the `cash_flow_alert` is **suppressed** even when pushWorthy (the
  dip-DATE wobble guard; the cron sets it from a 4-day recency check). Payment reminders are
  **unaffected** — their keys (accountId+dueDate) are stable.
- Ordering: level `critical` → `warning` → `info`, then earliest date, then title. A due-today
  payment (critical) sorts before a same-window radar warning.

### D. Delivery dedup (cron, `tests/unit/cron-notify.test.ts`)
A `NotificationSent` row is written ONLY after a real delivery to ≥1 live device: dormant (no
VAPID) / zero subs / all-subscriptions-410 all deliver nothing and record **nothing** (so a later
opt-in still fires); a real send records the key, and the next sweep selects **0** for that subject
(the @@unique makes a concurrent duplicate insert a no-op, not a double-send).
