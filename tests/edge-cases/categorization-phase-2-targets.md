## §Categorization (Phase 2 targets)

- Normalization fixture (≥40 rows) — examples that MUST map correctly:
  `SQ *BLUE BOTTLE 0042 OAK` → Blue Bottle Coffee; `TST* HATTIE BS - ATL` → Hattie B's;
  `AMZN Mktp US*2K4XY1` → Amazon; `PAYPAL *SPOTIFYUSA` → Spotify;
  `HMSHOST-ATL-T4-POS118` → Airport Dining; `COSTCO GAS #1234` → Costco Gas (distinct
  merchant from `COSTCO WHSE #1234` → Costco).
- Review-rate test: most recent 60 seed days, `needsReview` count / total **< 5%**.
- Contextual rules: Amazon < $40 → Household, > $400 → Electronics, between → review;
  weekend-only rule; account-scoped rule; priority ordering test (user rule > merchant
  default > suggestion).
- Recurring: detects ≥8 subscriptions, the engineered price increase (old vs new amount
  + `priceChangedAt`), the 90-day-unused subscription, biweekly payroll cadence.
