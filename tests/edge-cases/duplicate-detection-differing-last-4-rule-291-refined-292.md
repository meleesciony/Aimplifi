## Duplicate-detection differing-last-4 rule (#291, refined #292)

A different last-4 means different CARDS, not necessarily different ACCOUNTS: one account can carry
several cards (a spouse authorized-user card) with different numbers but ONE shared balance. So in
duplicateSignals (src/lib/engine/account/duplicates.ts), a differing last-4 disqualifies ONLY the
WEAK name signal, NEVER the strong identical-non-zero-balance signal:
`last4ForNameVeto` = mask column, else a 4-digit non-year name embedding (`maskFromName` minus
`looksLikeYear`); `masksDiffer` when both sides have a last-4 and they differ. Then the shared-name
signal is gated on `!masksDiffer`. A 2- or 3-digit SimpleFIN id is an absence, not a last-4
(Schwab "...396 (396)" vs Plaid ····5351 is the same account — DECISIONS #476). Applies to BOTH
the #192 duplicate warning and the reconciliation candidate path (shared function).

- His Venture ····6271 ($10,218.99) vs spouse Venture ····0966 ($0) — both Plaid, DIFFERENT masks,
  DIFFERENT balances, matched only on the name "venture" -> name disqualified -> NOT flagged.
- His Chase E.LEE (no mask column, SimpleFIN) vs wife M.LEE ····4927 (Plaid), IDENTICAL balance ->
  the identical balance is a real same-account signal (likely his account + her authorized card) ->
  SURFACED so the owner can Combine (one account) or dismiss (genuinely separate). Not hidden.
- A year in a NAME is not a last-4 (`looksLikeYear` on `maskFromName` only). A year-shaped MASK
  COLUMN (`2021`) is the bank's last-4 and still vetoes a different name-embedded last-4
  (DECISIONS #476 / U.14 critic P1-2). The x in "Amex" is still not read (`maskFromName`). A real
  duplicate whose sides differ only by card number but share a balance is always surfaced on the
  balance; the safe direction is a visible dismissable pair, never a silent hide.

Dismissal: a user "Not a duplicate" dismissal is stored in NudgeDismissal under a `dup:<sortedIds>`
key and filtered from BOTH the duplicate warning AND the reconciliation candidates (an explicit
judgment binds every surface derived from the same signal — critic DUP-DISMISS-1).
