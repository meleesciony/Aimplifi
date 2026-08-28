# A numbered ledger is not in number order

One-line summary: splitting DECISIONS.md on `## #485` archived #486 and #487 with the old wave, because those two headings were written into the file *above* #485; cut on file-order boundaries, then verify the number *set*.

## What happened

Wave D.2 kept "newest ~50" live, which by number is #485–#524 (the 2026-08-20 current-wave cut already used for PROGRESS/REGRESSION). The first rotation script split the live file at the string `## #485 —`. `collectDecisionEntries` then reported the archive as 402..487 (85 entries), not 402..484.

Cause, read from the file, not inferred: headings are append-mostly but not monotonic. #486 (line 4684) and #487 (line 4724) sit *above* #485 (line 4767) because they were written first and #485 was inserted after. A byte-offset cut at the keep-set's *lowest number* is not a cut at the keep-set's *first heading*.

The successful cut was the first keep-set heading in file order (`## #486 —`). Archive bytes are still a contiguous verbatim range; live numbers are still exactly #485–#524, just not in numeric order at the top of the file.

## The rule

**A numbered ledger's file order is not its number order.** When rotating by number range: find the first heading in the file whose number belongs to the keep-set, split there, then assert the two sides' *sorted number sets* — not that the live file opens with the lowest keep number. Do not reshape entries into numeric order to make the split prettier; verbatim means the bytes stay put.

Locked by the D.2 fidelity checks in the one-shot rotator (number-set equality on both sides) and by `tests/unit/ledger-decisions-index.test.ts` (union still 512, each index line's `→ file` holds that number).
