## §Household Duplicate Detection (TASKS 4.2 slice 8 — critic F-5 / T9(b), `detectHouseholdDuplicateAccounts`)

Not money arithmetic — set logic over the household's visible accounts (viewer's own +
partners' shared, supported currencies only). Same signals as the personal #192 detector
(same type + same currency prerequisites; last-4 / identical non-zero balance / shared
distinctive name token), with ONE deliberate difference: the same-provider skip applies only
within one owner, because "same-provider ingest already dedups" is true per user and false
across two users (both partners linking the same bank through Plaid is the most likely shape).

- **Joint-account twins:** A owns `plaid` "Chase Joint Checking" mask 1234, balance 512,345¢
  ($5,123.45); B shares `simplefin` "CHASE Joint Checking" mask null, same balance, both
  USD CHECKING. **Expected:** exactly one pair, HIGH (identical non-zero balance), spanning
  both owners.
- **Same-provider cross-owner:** both rows `plaid`, same mask. **Expected:** still one pair
  (the relaxed-skip regression lock). Same owner + same provider: **no pair.**
- **Advisory only, by decision:** the merged figures deliberately still contain BOTH twins
  (locked by a fail-old test) — the heuristic has false positives, and silently dropping a
  REAL account from money math is strictly worse than a disclosed possible double-count.
  Disclosure surfaces: the household scope toggle (dashboard/cards/calendar) and one line in
  the joint digest.
