## §Lifestyle creep — the income baseline and the three verdicts (O.20g, `engine/fi/insights.ts`)

`detectLifestyleCreep` compares the growth of MEDIAN discretionary spend against the growth of
MEDIAN income across two halves of a 6-month window, and flags when spending outgrew income by
≥5 percentage points. Medians, not means, so one 3-payday month is not a raise and one big
restaurant night is not creep.

**What counts as income.** The one predicate `monthlyFlows` uses — `isIncomeFlowRow`: a positive,
POSTED, non-transfer row with either NO stored category or an Income-group category that is not the
`refund` leaf. Before O.20g this series admitted every positive row, so a merchandise return was
income here while being netted against spend one function away (#166). Hand-verified: flat $5,000
income for six months, discretionary $1,000 → $2,000, plus two $20,000 returns filed to `refund` in
the second half → income growth **0 bps** (was 40,000 bps), spend growth **5,000 bps**, `flagged`
**true** (was false — the silenced warning).

**A refused positive is DROPPED, never netted into the bar.** The creep bar is deliberately GROSS
discretionary spend and the panel discloses it; netting would move a live figure on three surfaces
and falsify that sentence. Hand-verified: a $450 purchase + $450 return both filed to `shopping` →
bar **$450.00**, `hasDiscretionaryRefunds` true, income baseline unchanged at the paycheck alone.

**When the comparison is refused (`incomeMeasured` / `spendMeasured`).** `halfGrowth` returns 0
both for a genuinely flat series and as a refusal when there is nothing to divide by, so the two are
named apart:
- `spendMeasured` = first-half discretionary median > 0.
- `incomeMeasured` = first-half income median > 0 **AND** ≥ the first-half discretionary median.
- `flagged` requires both. "Spending is outpacing income" is a comparative claim, and an income the
  app cannot see is not an income the reader is outpacing.

The income rule is self-referential — no dollar threshold — and the argument is that the card
compares exactly these two series: if the income visible over the baseline months is smaller than
the discretionary spending it is being compared with, the app is not seeing the income that paid for
that spending. Hand-verified cases:
- 8¢/month savings interest against $1,000/month discretionary → baselines **$0.08 vs $1,000.00**,
  `incomeMeasured` false, `flagged` false even though spend grew 15,000 bps against a flat income.
- Live corpus (2026-08-11, re-verified under O.20k against the reconciliation boundary): first-half
  income median **$0.08** (one interest credit; the prior month had zero income rows while carrying
  59 others) against **$6,046.67** discretionary → income growth **40,607,025%**, which silenced
  the flag while discretionary spending grew ~59.7% (approx meta). Now refused. (The originally
  recorded magnitudes — 70,470,525% growth, ~153% spend — were computed by a probe run carrying a
  silent reconciliation-boundary bug and were superseded by the O.20k re-verification.)
- ONE missing income month does NOT refuse: `median([500000, 500000, 0])` is still **$5,000.00**, so
  a reader paid ten months a year keeps a correct verdict. A count-of-covered-months rule was built
  first and rejected for exactly this (and for admitting the 8¢ case above).
- Empty account → both false. `windowMonths = 1` → the compared half is an EMPTY slice and
  `median([])` is NaN; a non-finite baseline is collapsed to 0 at the boundary, because passing NaN
  to `cents()` throws rather than refusing.

**The three verdicts** are composed together in `COACH_COPY.creepCard` (title + body + link), never
selected in the page: `Spending is outpacing income` / `Tracking income` / `Can't compare yet`. The
refusal prints only the growth figure of the side that IS measured, and states the two baselines
rather than a conclusion the reader cannot check. Its link label deliberately does not say "what the
app counts as income": the register's `type=income` is a SIGN filter (`matchesType`), not
`isIncomeFlowRow`, so a credit this engine refuses still appears there.

---
