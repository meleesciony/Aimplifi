## §Unusual Charge Radar (AI plan §3-Later #12 reshaped — `engine/anomaly/detect.ts`, DECISIONS #249)

Locked by `anomaly-detect.test.ts` (F-numbers match test names; the seed lock lives
there too). Conventions (integer cents throughout): magnitudes = |amountCents| of
qualifying rows (POSTED, non-transfer, non-split-parent, negative); median = sort
ascending, odd n → middle, even n → floor of midpair mean; MAD = median (same
convention) of |x − median|; flag rule = deviation (magnitude − median, above-median
only) **strictly >** K_MAD·MAD + FLOOR with K_MAD=4, FLOOR=4000¢; baseline needs
≥ MIN_SAMPLE=6 charges at the merchant (all history ≤ today); only charges younger
than RECENT_WINDOW_DAYS=45 (age 0–44) may flag; ≤1 flag/merchant (max deviation, tie
→ later date → txnId); ≤ MAX_RESULTS=3 overall (deviation desc, tie → canonical asc →
txnId asc); aggregate pseudo-merchants (ATM/checks/Zelle/Unknown) excluded entirely.

- **F1 (even n):** [500,600,700,800,900,21436] → median floor((700+800)/2)=**750**;
  deviations sorted [50,50,150,150,250,20686] → MAD floor((150+150)/2)=**150**;
  threshold 4·150+4000=**4600**; 21436−750=**20686** > 4600 ⇒ FLAG
  {typical 750, mad 150, sample 6, deviation 20686}.
- **F7 (odd n):** [500,700,900,1100,1300,1500,21436] → median **1100** (middle);
  deviations sorted [0,200,200,400,400,600,20336] → MAD **400**; threshold **5600**;
  deviation **20336** ⇒ FLAG.
- **F2 (boundary):** [1000×5, 5000] → median 1000, MAD 0, threshold 4000; deviation
  exactly 4000 ⇒ **no flag** (strict >); 5001 (deviation 4001) ⇒ flag.
- **F10 (MAD=0 spike vs price bump):** [1549×4,1799,20000] → median 1549, MAD 0,
  deviation 18451 > 4000 ⇒ flag. [1549×4,1799,1799] → deviation 250 ≤ 4000 ⇒ no flag
  (a $15.49→$17.99 subscription bump is price-increase's job, never an "unusual charge").
- **F3:** 5 samples + any magnitude ⇒ no flag (MIN_SAMPLE). **F4:** [8000×5, 100] ⇒
  median 8000; a small charge is below-median ⇒ no flag. **F5/F5b:** an outlier aged 70d
  is baseline-only; age exactly 45 cannot flag, 44 can. **F6:** PENDING / transfer /
  positive (refund) / split-parent excluded; future-dated rows excluded from baseline
  AND flagging; ATM aggregate never flags.
- **F8:** one flag per merchant — deviations 20686 vs 14250 → larger wins; equal
  deviations → later date wins. **F9:** 4 flagging merchants (deviations
  20686/18686/16686/14686) → top 3. **F12:** equal deviations order by canonical asc.
- **Seed lock (demo-first):** `buildSeedData('2026-06-10')` + detector at today
  2026-06-10 yields EXACTLY one flag: the engineered `SQ *BLUE BOTTLE 0042 OAK`
  −21436 on 2026-06-02 (acct-sapphire). Uniform seed draws cannot flag under
  K=4+floor: for a uniform [min,max] pool, max deviation ≈ half-range while
  4·MAD ≈ full range, so every un-engineered merchant abstains by construction.
