# Money taken back is found by what it is, not by whose name it carries — and a lever in copy can teach the learner

**One line:** #787's bonus credit needed to net money that was taken back; matching the take-back by the payer's name failed twice (an exact name, then a name prefix), because a bank's reversal rewrites the MIDDLE word of the payroll's descriptor ("NORTHWIND HEALTH **REVERSAL** PPD", "DES:**REVERSAL**", "DEPOSITED ITEM RETURNED") — what held was identifying it by what it is: no category, filed as income, or worded as a reversal, payer-blind and fail closed.

## What happened

- Cycle 1 (P1): the payroll path summed positive deposits only, so a duplicate paycheck and its same-day take-back read as a $4,512.30 "bonus". The fix matched take-backs to the bonus payer's canonical name, or that name followed by more words.
- Cycle 2 (P1, on the real loader): real reversal descriptors change a middle word, so the canonical is "Northwind Health **Reversal** Ppd Id:" against "Northwind Health **Payroll** Ppd Id:" — never equal, never a prefix. Every reversal shape the critic tried came back `uncategorized` from the real categorizer; a big-retail employer's reversal came back `shopping`.
- The fix that passed: once bonus money landed, every outflow that month with no category, filed to an Income category, or carrying a reversal/return word nets against it — whoever it went to. A purchase filed to its spending category never nets, so the one lever the copy names (file the purchase) is always right.
- Separately, cycle 1's other P1: the copy told readers to file a separate bonus deposit as Bonus. Two such filings for one payer let the learner (`deriveLearnedRules`) mint a rule that filed the payer's NEXT PAYCHECK as Bonus — which the credit then counted on top of regular pay. Executed end to end by the critic through `deriveLearnedRules` → `categorize`.

## The rule

- When a money figure must exclude or net "the same money coming back", do not key it on a descriptor's name — banks rewrite names, and the normalizer (correctly) treats a rewritten name as a different payer. Key it on properties that survive the rewrite (unfiled, income-filed, reversal words), accept the low-direction cost, and say in the copy which lever undoes it.
- Before copy names a lever ("file it as X"), run the lever through the learner: what rule do two uses of it teach, and what does that rule do to the NEXT row? A lever that is right once can be wrong as a habit.

## Also from this slice

- A one-time credit was about to reach every planner as "monthly capacity": the solvers read `leftToSpendCents`. Publishing a separate pay-only figure (`leftToSpendFromPayCents`) and locking every solver input with a source scan kept a bonus month from being repeated across a horizon.
- Shell heredocs broke on test code twice more this session (an unbalanced quote inside the heredoc body); writing the script with the file tool and running it worked every time. See [windows-codegen-via-shell](windows-codegen-via-shell.md).
- A `sed` mutation that did not apply reported "51 passed" — a mutation run must prove the replacement happened before the test result means anything (assert the count of the replaced text, as the runner script does).
