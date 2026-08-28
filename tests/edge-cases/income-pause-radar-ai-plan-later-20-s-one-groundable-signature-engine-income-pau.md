## §Income-Pause Radar (AI plan §Later #20's one groundable signature — `engine/income/pause.ts`, DECISIONS #251)

Locked by `income-pause.test.ts` (P-numbers match test names; the seed lock lives
there) and `income-pause-server.test.ts` (the confirmation → projection-exclusion
integration). Pure detection over `detectRecurring` output; NO LLM anywhere.
Conventions (integer cents throughout):

- **Input** = the recurring series the siblings read (POSTED, non-split,
  SPENDING-type accounts — the same universe as getRecurring #62 and
  refreshRecurringForUser; critic F4 aligned the coach call site). **Lapse
  arithmetic never reads `nextExpectedAt`** — detect.ts forward-steps that field
  past missed occurrences until ≥ today, structurally hiding a lapse. Instead:
  `missedSince = missedSinceOf(lastSeenAt, cadence)` = `nextDate(lastSeenAt,
  cadence)`, EXCEPT a MONTHLY series last seen on the LAST day of its month
  expects the END of the next month (critic F7 — a 31st payday clamped to Feb 28
  must expect Mar 31, not Mar 28, or the grace silently shrinks to 7 for
  month-end payroll; the rule only ever moves the expectation LATER).
  `daysLate = daysBetween(missedSince, today)`.
- **Gates (precision-first — a false "your income stopped" shouts, a false
  negative stays quiet):** isIncome (positive series); cadence ∈ {WEEKLY,
  BIWEEKLY, MONTHLY} — ANNUAL excluded (one missed yearly bonus is not a pause);
  occurrences ≥ **4** (3 confirmed gaps); typicalAmountCents ≥ **10000** ($100
  floor); aggregate pseudo-merchants excluded (shared case-insensitive
  `isAggregateCanonical`, #250 F3); `missedSince < today` strictly (nothing due
  today or later has been missed).
- **Grace** (absorbs payroll jitter before anything is said): flag iff daysLate ≥
  {WEEKLY: **5**, BIWEEKLY: **7**, MONTHLY: **10**}.
- **Alarm vs consent — two different predicates, one lapse arithmetic** (critic
  F1): the ALARM (`detectIncomePauses`) carries all the precision gates plus
  daysLate ≤ **STALE_DAYS = 60** (news, not history). STANDING CONSENT
  (`confirmedPauseState`, per confirmed merchant) carries NO alarm gates and NO
  staleness cap — its three states: `paused` (an income series with a
  projectable cadence exists and has NOT date-fresh resumed → exclusion in force
  + HANDLED feed row), `resumed` (missedSinceOf(lastSeenAt, cadence) ≥ today —
  an actual fresh deposit; only THIS retires consent: the confirmation row is
  deleted), `inert` (no projectable income series under the canonical → nothing
  excluded, consent KEPT — absence of evidence is not resumption). The executed
  F1 failure this encodes: a provider row-removal dropping occurrences 4→3 must
  NOT delete consent or re-project income no deposit revived.
  `incomePausesForFeed` composes both: unconfirmed = alarm rows; confirmed = the
  `paused` state rows, so the feed's disclosure rides the SAME predicate as the
  exclusion (a money mutation may never outlive its own visibility).
- **Order**: typicalAmountCents desc (most material first), then merchant asc
  (locale-free). No count cap — income series are naturally few.

Hand-verified cases:

- **P1 (the seed shape):** MONTHLY ×4, +38000, last 2026-04-10, today 2026-06-10 →
  missedSince addMonthsClamped(04-10, 1) = **2026-05-10**; daysLate 21 (rest of
  May) + 10 (June) = **31** ≥ 10 ⇒ exactly one pause {38000, occurrences 4}.
- **P2–P4 (grace boundaries):** MONTHLY daysLate 9 silent / 10 flags; BIWEEKLY
  (last 2026-05-29 → missed 06-12) 6 silent / 7 flags; WEEKLY (last 2026-06-01 →
  missed 06-08) 4 silent / 5 flags.
- **P5 (staleness):** daysLate 60 (2026-07-09) is news, 61 (2026-07-10) is not —
  but `lapsedIncomeSeries` still returns the 61-day row.
- **P6 (abstentions):** occurrences 3; typical 9999 (vs 10000 flags); expense
  series; ANNUAL; aggregate ("ATM Withdrawal", any casing) — all silent.
- **P7:** missedSince == today or future → silent. **P8:** a current payroll next
  to a lapsed side gig → only the side gig flags. **P9:** order 245000 before
  38000; equal amounts → merchant asc.
- **P11/P12 (confirmation composition):** confirmed+stale kept with
  `confirmed: true`; unconfirmed+stale dropped; a confirmation for a RESUMED
  series yields no row — state is recomputed, never trusted from the
  confirmation. **P13 (month-end):** missedSinceOf(2026-02-28, MONTHLY) =
  2026-03-31; (2026-01-31) = 2026-02-28; mid-month and non-monthly untouched;
  grace boundary holds at the true month-end date. **P14 (consent machine):**
  occurrences 3 / typical $99.99 → still `paused` (gate failure ≠ resumption);
  fresh deposit → `resumed`; vanished / ANNUAL-drifted / expense-only series →
  `inert`; the feed keeps the confirmed row through a gate failure.
- **Server contract (`income-pause-server.test.ts`):** unconfirmed lapse still
  projects (the radar alone never mutates); confirmed lapse → its
  ScheduledTransaction row is gone while non-income series project on and the
  RecurringSeries row remains (/recurring keeps showing it); **2b (critic F1
  regression):** deleting one historical row (occ 4→3) leaves the exclusion in
  force and the consent row intact; a resumed series projects again AND its
  stale confirmation row is deleted (future pauses re-ask); demo can never
  read/write a confirmation (fence by construction). Manual entry/CSV run the
  same best-effort refresh as provider ingest
  (`income-pause-manual-entry.test.ts` — the "returns automatically" claim
  holds without a provider sync).
- **Nudge identity (critic F5):** the unconfirmed ACTION row keys to the missed
  occurrence (`income_pause:<merchant>:<missedSince>`); the CONFIRMED state row
  keys to its own namespace (`income_pause_confirmed:<merchant>`) so a dismissal
  of the earlier alarm can never hide the state disclosure carrying the Undo.
- **Runway passthrough (critic F6):** only finite AND > 0 figures are carried;
  zero/negative (overdrawn cash) render no runway sentence — "covers about −0.5
  months" is unrepresentable.
- **Disclosure rule line (critic F2):** a HANDLED income_pause's "why" rule says
  "You confirmed this income is paused… with Undo" — never the autopay rule
  (`tierRule` in the copy module, per-kind override, unit-locked).
- **Seed lock (demo-first):** `buildSeedData('2026-06-10')` yields EXACTLY one
  pause — `STRIPE PAYOUT ETSY SHOP` → "Stripe Payout" (side-income), +38000 × 4
  monthly (2026-01-10..04-10) on **acct-savings**, which is deliberately NOT the
  demo payment account (acct-checking): the paused series can never reach
  `toScheduledTransactions`, so the cash-needed/§Seed-headline arithmetic is
  untouched by construction. **L.25 narrowed the mechanism:** expenses now project
  from every cash account, so what keeps this series out is that it is INCOME, which
  alone remains payment-account-scoped — not merely that savings isn't the payment
  account. The known ripple: monthlyFlows income for
  2026-01..04 is now 2×245000 + 38000 = **528000**/month for two-payday months
  (insights.test.ts re-hand-verified). Payroll (biweekly, current at asOf) never
  flags.
- **Copy:** the figure is "the expected deposit that hasn't arrived" — never "at
  stake" (whyInputs: "an expected $X deposit"), never "spent". Cadence claim
  carries its basis inline ("based on N deposits"); the runway line says "about",
  names its formula inline ("cash ÷ your 6-month average expenses"), and is
  OMITTED when the caller's monthsOfRunway is absent or non-finite (∞ is
  unrepresentable: select.ts nulls non-finite passthrough). Confirmed/HANDLED
  copy disclosures: the exclusion ("cash projections don't count it"), the
  automatic exit ("returns automatically when a new deposit arrives"), and the
  undo. No-shame scan: no crisis/fired/behind lexicon; the offered outcome is a
  planned pause.
