# An excluded balance is not missing money — find where it IS counted before calling it a loss

**One line:** U.11's investigation proved 9 supersessions wrong and computed that they removed
$468,840.29 from the owner's net worth; one more probe showed **$467,849.80 of it was already
counted through the correct live twin**, so the real figure was $990.49 — the wrong link was
reaching the right total by the wrong reasoning, and reporting the arithmetic would have been a
six-figure false alarm.

## What happened

Production held 9 `AccountReconciliation` rows pairing accounts that provably are not the same
account: three distinct Schwab 529 plans continued onto one Vanguard 401k, three distinct Schwab
IRAs onto one Vanguard Roth IRA, and one cardholder's Chase card onto another's. The evidence was
strong and independent — 0% transaction agreement inside the overlap where every genuine pair in
the same database agreed 98–100%, and conflicting account numbers.

`applyReconciliationBoundary` R2 zeroes a superseded predecessor's balance. Those 9 predecessors
carried $468,840.29. The arithmetic is correct and the conclusion — "the owner's net worth is
understated by $468,840.29" — is false, because it silently assumes the account is counted **only**
through the row being zeroed.

It was not. The owner's Schwab rows each had a correct live Plaid twin that the app was already
counting: "Charles Schwab US Rollover IRA ...584" ($61,762.92) is zeroed while Plaid's "Rollover
IRA" 0584 ($54,699.42) counts. The stale row *should* stop counting. Only the reasoning was wrong.
Genuinely missing: $990.49 — one card with no twin anywhere.

## The rule

**A balance excluded from a total is a claim about ONE row. "Missing money" is a claim about the
whole portfolio.** Before converting the first into the second, enumerate every other row that
could carry the same real account and check whether one of them is counted. The exclusion and the
loss are different facts, and only the second is worth waking anyone up about.

The general shape: whenever a fix or a finding rests on "X is excluded, therefore X is absent",
the missing step is a search for X's other representations. This repo has the same shape elsewhere
— a superseded predecessor's transactions are dropped but the successor's copy survives, and
`u11c-silent-loss-today.mts` only became meaningful once it asked, per dropped row, whether a
SURVIVING row carried the same date and amount. 706 of 709 drops were covered; the finding was the
3, not the 709.

## Two smaller errors on the way to the same answer, both caught by inspection

1. **A proxy is not evidence.** The first pass classified links by `matchSignal='name'` +
   `confidence='medium'`, on the theory that weak signals produced the bad pairs. It printed
   $1,379,513.62. That bucket also contained genuine pairs — Schwab "Investor Checking ...927"
   agrees with its successor on 171 of 172 transactions. Judge each item on evidence about IT, not
   on the class it belongs to.
2. **Identifiers are rendered at different lengths by different providers.** The second pass
   compared account numbers with string equality and declared a genuine $898,889.99 brokerage pair
   WRONG because Schwab renders "...383" where Plaid's mask is "7383". Account numbers match by
   SUFFIX. That single line was 65% of the headline.

Both were caught by reading the per-item output rather than the total. The totals looked plausible
every time; only the rows disagreed.

## What this cost and what it saved

Four extra probes, and it converted a report of "$469,000 missing from your net worth" into
"$990.49, plus a separate real $2,086.40 deposit that genuinely is gone". The first would have been
wrong, alarming, and would have justified a data repair on the owner's production database that was
not needed.
