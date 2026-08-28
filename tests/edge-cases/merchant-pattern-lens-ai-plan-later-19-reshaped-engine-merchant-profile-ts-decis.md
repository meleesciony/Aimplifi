## §Merchant Pattern Lens (AI plan §Later #19 reshaped — `engine/merchant/profile.ts`, DECISIONS #250)

Locked by `merchant-profile.test.ts` (L-numbers) and `merchant-lens-copy.test.ts`
(C-numbers). Deterministic per-merchant behavioral profile; NO LLM anywhere; the
narration is a pure template over engine figures. Conventions (integer cents):

- **Qualifying charge** = POSTED, non-transfer, negative `amountCents`, `date ≤ today`
  (split parents are excluded upstream by the register query — same rule as the
  anomaly engine). Refunds (positive), PENDING, transfers, and future-dated rows
  never move any figure.
- **Merchant match** = case-insensitive EXACT equality on the canonical name
  (never substring: "Costco" ≠ "Costco Gas"); the profile echoes the ROW's casing,
  never the query's. Aggregate pseudo-merchants (Zelle/checks/ATM…) → **null**
  (heterogeneous payees are not one relationship). Zero qualifying charges → null.
- **Pattern floor** `LENS_MIN_PATTERN_SAMPLE = 3`: below it the profile keeps plain
  facts (count, total, first/last seen) but `typicalCents` and both windows are
  null — no pattern claim from thin history.
- **typicalCents** = median of magnitudes, the EXACT §Unusual Charge Radar integer
  convention (sort asc; odd n → middle; even n → floor of midpair mean).
- **Trend windows** (full calendar months only; the current partial month is never
  averaged): with `som = startOfMonth(today)`, recent = months [som−3, som−1],
  prior = [som−6, som−4] (via `addMonthsClamped`, day-01 so clamping never bites).
  A window renders only if the relationship spans it at month granularity:
  recent requires `firstYm ≤ recentFromYm`, prior requires `firstYm ≤ priorFromYm`
  — otherwise months before the first charge would read as $0 behavior.
  `avgPerMonthCents = roundHalfAwayFromZero(windowTotal / 3)`.

Hand-verified cases (today 2026-06-10 → recent 2026-03..2026-05, prior 2025-12..2026-02,
unless noted):

- **L1 (rich history, both windows, even-n median):** Cafe Nine charges
  2025-11-14 −1000, 2025-12-05 −800, 2026-01-10 −900, 2026-02-20 −700,
  2026-03-08 −1100, 2026-04-12 −600, 2026-05-25 −1200, 2026-06-03 −500.
  Count **8**, total **6800**; sorted magnitudes [500,600,700,800,900,1000,1100,1200]
  → median floor((800+900)/2) = **850**; firstSeen 2025-11-14, lastSeen 2026-06-03.
  Recent: 3 charges, 1100+600+1200 = **2900**, avg round(2900/3 = 966.67) = **967**.
  Prior: 3 charges, 800+900+700 = **2400**, avg **800**. Interleaved refund (+1500),
  PENDING (−999), transfer (−5000), future 2026-06-15 (−777), and another merchant's
  row change NOTHING. Query "cafe nine" matches; profile echoes "Cafe Nine".
- **L2 (thin history):** 2 charges → count/total/firstSeen/lastSeen present;
  typicalCents null, both windows null.
- **L3 (aggregate):** "Zelle Payment" → null. **L4 (no qualifying rows):** only
  refund/PENDING/transfer/future rows → null.
- **L6 (old merchant, quiet windows):** 3 charges Oct 2025 (−4000 ×3) → typical
  **4000**; recent {0 charges, 0, avg 0}, prior {0, 0, 0} (both render: firstYm
  2025-10 precedes both windows — "no charges" is a true pattern statement).
- **L7 (newer merchant):** 4 charges from 2026-04-02 (−2000, −3000, −2500, −1800)
  → median floor((2000+2500)/2) = **2250**; firstYm 2026-04 > recentFromYm 2026-03
  → BOTH windows null (an average over months before the relationship would lie).
- **L8 (odd-n median + boundary firstYm == recentFromYm):** −500/−700/−900 in
  Mar/Apr/May 2026 → median **700**; recent {3, 2100, avg 700} renders; prior null.
- **L9 (avg rounding):** window totals 10001 → round(3333.67) = **3334**;
  10000 → round(3333.33) = **3333**.
- **L11 (cross-year windows):** today 2026-01-15 → recent 2025-10..2025-12, prior
  2025-07..2025-09; one −1000/month Jul–Dec 2025 → both windows {3, 3000, avg 1000}.
- **L12 (today boundary):** a charge dated exactly `today` counts (count, total,
  lastSeen).
- **Copy (C-cases):** heading "Your pattern at {merchant}"; facts line always;
  typical line discloses its basis "(median of N posted charges)"; trend line
  carries "about" on every divided figure and the "vs" clause only when the prior
  window rendered; window note ("full calendar months; the current month isn't
  counted") present iff the trend line is; cadence line only from an ACTIVE
  non-IRREGULAR recurring series, hedged "around" on the expected date. Guardrail
  scan over every line: no shame/advice lexicon, and — the §Later #19 verdict's
  hard exclusion — no time-of-day or day-of-week vocabulary (the data doesn't
  exist: `Transaction.date` is date-only).
