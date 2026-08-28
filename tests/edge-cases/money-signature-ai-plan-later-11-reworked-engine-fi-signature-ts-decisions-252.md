## §Money Signature (AI plan §Later #11 reworked — `engine/fi/signature.ts`, DECISIONS #252)

Hand-verified expected values for `computeMoneySignature` (two habit axes + weather) and the
shared hysteresis walk `resolveConfirmedLabel`. Conventions: shares and spreads are integer bps
via `Math.floor`; median/MAD use the radar integer convention (sorted; odd n → middle element;
even n → floor of the mean of the two middles; MAD = median, same convention, of absolute
deviations from the median). Only FULL calendar months feed the engine — a flow row whose month
equals `ym(today)` is dropped before anything else. Thresholds (exported constants): axis-1
steady ≥ 7500 bps of eligible months saved, variable ≤ 5000, dead zone between, minimum 6
eligible months; axis-2 steady ≤ 1000 bps spread, variable ≥ 2500, dead zone between, exactly
the trailing 6 full months with median > 0; hysteresis persistence K = 3 consecutive identical
contrary raw labels (a dead-zone month RESETS the run); weather: strained iff runway < 1, else
tight iff runway < 3 or latest rate < 0, else bright iff personal-best latest rate ≥ 0 with ≥ 6
eligible months, else calm.

### Axis 1 — saving habit (shareBps = floor(saved × 10000 / eligible), trailing ≤ 12 eligible)

- **S1 (steady init).** 6 full months, rates [500, 300, 1200, 800, 100, 900] bps, all ≥ 0.
  First signal at month 6 (6 eligible): share = floor(6×10000/6) = **10000** ≥ 7500 → raw
  steady → label **steady**, sinceMonth = month 6, savedMonths 6, eligibleMonths 6.
- **S2 (dead-zone hover never flips).** 16 months: m1–m8 rate +100, m9–m16 alternating
  −100/+100 starting with −100. m6–m8: 10000 (steady, init at m6). m9: 8/9 → floor(80000/9)
  = **8888** steady. m10: 9/10 = 9000. m11: floor(90000/11) = **8181**. m12: 10/12 = 8333.
  m13 (window m2–m13, 9 saved): 9/12 = **7500** steady (boundary inclusive). m14 (m3–m14,
  9 saved): 7500. m15 (m4–m15, 8 saved): floor(80000/12) = **6666** → dead zone → raw null,
  label holds. m16 (m5–m16, 8 saved): 6666 dead. **Zero flips**; label steady since m6
  while the share fell 10000 → 6666.
- **S3 (regime change flips exactly once).** 20 months: m1–m8 rate +100, m9–m20 rate −100.
  m9: 8/9 = 8888 steady. m10: 8/10 = 8000 steady. m11: floor(80000/11) = **7272** dead.
  m12: 8/12 = 6666 dead. m13 (m2–m13, 7 saved): floor(70000/12) = **5833** dead. m14
  (m3–m14, 6 saved): 6/12 = **5000** → raw variable, run 1. m15 (m4–m15, 5 saved):
  floor(50000/12) = **4166**, run 2. m16 (m5–m16, 4 saved): 3333, run 3 → **flip at m16**,
  sinceMonth m16. m17–m20: variable raws continue, **no further flip** — exactly one.
- **S4 (null-rate months are invisible).** Rates [+100, null, +100, null, +100, +100, +100,
  +100]: eligible = 6, saved = 6 → share 10000, init at the 6th ELIGIBLE month (m8);
  a null-rate month is neither saved nor unsaved and does not advance the window.
- **S5 (forming below 6 eligible).** 5 eligible months, all saved → label null ('forming'),
  savedMonths 5, eligibleMonths 5, sinceMonth null. Weather still computed.

### Hysteresis walk — `resolveConfirmedLabel(raws)` (raw = 'steady' | 'variable' | null)

- **H1.** [steady, steady, steady] → label steady, sinceIndex 0 (first non-null initializes
  immediately; persistence gates only FLIPS, not initialization).
- **H2.** [null, null, variable] → forming until index 2, then variable, sinceIndex 2.
- **H3 (contrary run interrupted by dead zone resets).** [steady, variable, variable, null,
  variable, variable, variable, …] → still steady after index 2 (run 2 < 3); the null at
  index 3 RESETS the run; flips only at index 6 (the 3rd consecutive of the second run),
  sinceIndex 6.
- **H4 (contrary run interrupted by same-label raw resets).** [steady, variable, variable,
  steady, variable, variable, variable] → flip at index 6, not index 4.
- **H5.** All null → label null, sinceIndex null.

### Axis 2 — spending steadiness (spreadBps = floor(mad × 10000 / med), trailing exactly 6)

- **D1 (constant).** 6 × 300000¢ → med 300000, all deviations 0 → mad 0 → spread **0** ≤
  1000 → steady.
- **D2 (alternating).** [200000, 400000] × 3 → sorted [2,2,2,4,4,4]×10⁵: med =
  floor((200000+400000)/2) = **300000**; every |dev| = 100000 → mad = 100000; spread =
  floor(100000×10000/300000) = **3333** ≥ 2500 → variable.
- **D3 (mild wiggle).** [300000, 310000, 290000, 305000, 295000, 300000] → med 300000; devs
  sorted [0, 0, 5000, 5000, 10000, 10000] → mad = floor((5000+5000)/2) = 5000; spread =
  floor(5000×10000/300000) = **166** → steady.
- **D4 (dead zone).** [300000, 360000, 240000, 370000, 230000, 300000] → med 300000; devs
  sorted [0, 0, 60000, 60000, 70000, 70000] → mad 60000; spread = floor(60000×10000/300000)
  = **2000** → 1000 < 2000 < 2500 → raw null (no signal; label holds).
- **D5 (zero-median guard).** Six months of 0 expenses → med 0 → raw null (never divide).
- **D6 (forming).** Only 5 full months → raw null at every position → label null.

### Weather (evaluated on the latest FULL month; responsive by design — no hysteresis)

- **W1.** runway 0.9, latest rate 3000 → **strained** (runway dominates; rate irrelevant).
- **W2.** runway 2.9, latest rate 2000 → **tight**.
- **W3.** runway 12, latest rate −500 → **tight** (negative month with cushion is tight, not
  strained).
- **W4.** runway 6, ≥6 eligible months, latest rate strictly above every prior non-null →
  **bright** (isPersonalBest via computeSavingsStreak, reused not re-derived).
- **W5.** runway 6, latest rate ≥ 0 but not a personal best → **calm**.
- **W6.** 3 eligible months, runway 5, rate 800 → **calm** (bright requires ≥ 6 eligible;
  a trivial early "personal best" must not celebrate), axes forming.
- **W7.** latest rate null (no income that month), runway 4 → **calm** (null is not < 0;
  the weather line's basis copy cites runway and rate, so the null case reads on runway).
- **W8.** runway = Infinity (zero average expenses) → not < 1, not < 3 → calm/bright reachable.
- **W9 (partial month excluded).** today 2026-06-10 with a 2026-06 flow present → 2026-06 is
  dropped; latest full month = 2026-05; weather and both axes read through 2026-05.
- **W10 (boundaries).** runway exactly 1 → NOT strained (< is strict); runway exactly 3 →
  NOT tight; latest rate exactly 0 → not negative → not tight on the rate arm.

### Critic-cycle additions (#252 cycle 1 — lag honesty, trailing gaps, unreadable windows)

Materialization amendment (critic P2-2): the zero-filled calendar grid is anchored — like
`detectLifestyleCreep`'s — to the month BEFORE `today`, not to the last month with data. A
trailing gap month is a real completed $0/no-income month, so the weather always reads the
true latest full calendar month and the steadiness window sees completed $0 months.

- **S6 / lag-contrary (critic P1-1).** Rates [8 × +100, 7 × −100]: the S3 flip needs a 3rd
  contrary raw (arrives at m16), so at m15 the confirmed label is still steady while the
  latest window is 5/12 = floor(50000/12) = **4166** bps — inside the VARIABLE band. The
  engine sets `latestContrary: true` and the card renders the lag-honest "had been … recent
  months look different" variant; unqualified "steady … has held" copy there is a falsehood
  against its own inline facts. The S2 dead-zone hover must NOT flag (mid-band ≠ contrary).
- **D7 / steadiness lag-contrary.** [8 × 300000, then 900000/300000 alternating ×6]: windows
  through m12 keep med 300000 with ≤2 spike months → mad 0 → steady raws; the m13/m14
  windows are 3×300000 + 3×900000 → med floor((300000+900000)/2) = **600000**, every dev
  300000 → mad 300000 → spread floor(300000×10000/600000) = **5000** → variable raws (run 2
  of 3) → label steady + `latestContrary: true`.
- **D8 / unreadable window (critic P2-1).** 12 × 300000 ending 2025-12, today 2026-06-15:
  the trailing grid materializes 2026-01..05 as $0, the latest window [300000, 0×5] sorts to
  med floor((0+0)/2) = **0** → spreadBps null — but `hasFullWindow: true` (17 full months on
  record), so the UI says "no recorded spending in the recent window", never "needs 6 full
  months of history".
- **W11 / trailing-gap weather (critic P2-2).** Six months ending 2025-06, today 2026-05-15:
  latest full month = **2026-04**, rate null → weather reads the runway arm (calm at 6);
  the habit window still holds the 6 eligible months (copy qualifies the count as "full
  months with income" — critic P1-2), and steadiness is the D8 unreadable state.
- **Copy quantifier (critic P1-2).** Every rendered month-count is "N of your last M full
  months WITH INCOME" — the eligible window skips no-income months, so the unqualified
  phrase is false whenever such months sit inside the span (rates [10 × +100, null, null,
  +100, +100] → savedMonths 12/eligible 12 across 14 calendar months).
- **Pluralization (critic P2-4).** Runway exactly 1 → "about 1 month of typical spending"
  (reachable only as tight; strained is strict < 1).
