## §Value-Receipts (DECISIONS #206 — TASKS 1.3, `engine/receipts/receipts.ts`)

The module NEVER computes a money value at catch time — every `amountCents` is a verbatim copy
(reminder → `cashRequiredCents`; radar → the alert's own `coverTransfer.amountCents`, 0 when the
alert had none; price increase → `Opportunity.monthlyCents`). The only arithmetic anywhere is the
summary's per-kind sums. Pinned in `tests/unit/receipts.test.ts`.

### A. Hand-verified summary (per-kind sums, unknown kinds ignored)
Rows: reminder 123456 + reminder 50000 · radar 50000 · price 250 + price 1000 · unknown-kind 999999
⇒ `total 5` (2+1+2; the unknown row counts nowhere), `remindersAmountCents 173456`
(123456+50000), `priceIncreaseMonthlyCents 1250` (250+1000). Radar carries a COUNT only.
**Structural honesty lock:** the summary type has NO cross-kind dollar field — reminder amounts are
bills covered and price amounts are monthly deltas, so any cross-kind "$ total" would be a
meaningless "we saved you $X" claim (also banned in copy by a coach-copy guardrail test).

### B. Keys (idempotency, channel-agnostic)
- reminder: `payment_due:<accountId>:<dueDate>` — the notify-engine key builder itself, so a
  reminder EMAIL and a payment_due PUSH about the same due payment mint ONE receipt.
  **Estimated reminders mint nothing** (critic #206 P2-3): a projection must not enter the
  permanent tally unmarked, and the real statement's different due date would otherwise mint a
  second receipt for the same payment. Undercount-safe; the real statement's reminder is the one
  true receipt.
- radar: `cash_flow_alert:<firstNegativeDate>`; gate identical to the push (`pushWorthy` +
  a projected-negative date), so a receipt exists iff an alert could.
- price: `price_increase:<merchant>:<fromCents>><toCents>` — keyed on the PRICE TRANSITION
  (Netflix ⇒ `price_increase:Netflix:1549>1799`), NOT the detection date, because
  detectRecurring's change date is a detection artifact that can shift under re-import churn and
  a shifted date must not re-mint the same increase (critic #206 P2-2). A genuinely new hike —
  even with the same +$2.50 delta (1799>2049) — keys distinctly. `occurredOn` is the change date
  (the business date of the event), not the view date.

### C. Delivery/surfacing-gated minting (locked in the cron tests)
Dormant email/push runs mint NOTHING ("delivered" means delivered); a 410-pruned phantom push
mints nothing; a repeat delivery about the same subject leaves the count unchanged. Price
receipts mint where the flag is actually surfaced: the /coach render, and the digest cron ONLY
after a real send (critic #206 P2-1 — its Money Review creep line names the increase; a dormant
sweep mints nothing). Seed's only price increase is Netflix $15.49→$17.99 ⇒ demo /coach shows
exactly "1 catch … $2.50/mo in total." (e2e-pinned).
