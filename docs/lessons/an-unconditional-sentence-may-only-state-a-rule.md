# An unconditional sentence may only state a rule about the artifact — never a fact about the reader's data

**Hook:** U.25 applied "gate on the FACT, not the branch" and shipped its mirror failure: a note
that fires for every reader asserting "it does not cover every account you hold", false for
anyone holding only spending accounts and false for the production demo's own file (all 847
stored rows export). The same slice's sibling note said flagged rows are "left out of the
spending, income and net totals it shows" — verified against the one engine that gates the flag,
and falsified by another that deliberately keeps it: /spending-plan prints "CarMax Auto Finance
$385.00/mo" from rows the file marks `transfer,yes`.

## What happened

U.25/U.26 gave the transactions CSV two new notes. The slice was careful in every way its
predecessors had taught it to be: unconditional columns, conditional notes gated on the flags
actually present, no direction clause, no promise of equality, sabotage proofs on all four
behaviours, a real-database fixture, an e2e driving the reader's own control, tsc/eslint/6,973
unit tests/full `VERIFY_E2E=1` verify all green.

Two fresh-context critics then found **zero** defects in the columns, the arithmetic, the
rectangular padding, the append-only column position or the gate logic — financial correctness
scored 9/10 and structural integrity 10/10 across all sixteen note branches with an adversarial
account name. **Every P1 was in the copy**, and the two critics executed the same one
independently.

## The two rules

### 1. Unconditional is right for a rule and wrong for a claim about a reader

The U.21 lesson — `a-disclosure-gated-to-the-loudest-branch-misses-the-reachable-one` — says
derive the gate from the FACT rather than from the branch where the defect was first seen. This
slice read that as "so make it unconditional" and shipped the mirror defect: the fact *"your file
omits rows"* is per-reader, and an unconditional sentence asserting it is a fabrication for every
reader it is false about. Making a per-reader fact unconditional is the same defect with the sign
flipped.

The test is mechanical. Walk each clause of any always-on sentence and ask: **is this a statement
about the artifact, or about the reader?**

- *"Accounts of any other kind are not represented here, whether or not you hold one"* — a rule
  about the file. True when the set is empty. Ship it unconditionally.
- *"It does not cover every account you hold"* — a claim about their holdings. Needs their
  holdings, or it needs deleting.

This is `scoping-the-number-does-not-scope-the-sentence` at the next level up: that lesson said a
clause forced to speak app-wide must state a rule with no count in it. The same applies to a
clause forced to speak reader-wide — no count, and no claimed omission either.

### 2. A claim about "the app's totals" is checked against every engine that READS the flag, not the one that gates it

The note said the two flags keep a row out of "the spending, income and net totals it shows". The
author verified that against `summarizeTransactions`, which is where the flags are gates — and
that verification was correct and irrelevant. `recurring/detect.ts:416` deliberately KEEPS an
`isTransfer` row whose merchant normalises to `auto-loan`; the tax export deliberately keeps a row
the reader both tagged and excluded, because the tag is the later instruction. Both are documented
decisions, and both make an app-wide sentence false.

A flag is not a policy. Before writing "the app leaves these out", grep every consumer of the
field and read what each one decided. Then name the surface you can actually prove — here, the
three register tiles — and nothing wider.

### And the corollaries the same cycle produced

- **A flag set by inference may not be stated as fact.** `isTransfer` comes from descriptor
  evidence alone, so "these rows move money between accounts you own" tells a reader who never
  added their car loan that a counterpart exists somewhere. Attribute the judgement to the app:
  *"ones Aimplifi treated as…"*.
- **A reassurance is a claim too.** "Account balances count every row either way" was written to
  stop a reader concluding the money is fictional, and it is false for a hand-entered row, whose
  balance is provider-authoritative. Give the reassurance without vouching for a figure the
  artifact cannot see.
- **Use the control's own words.** "Ones you told us were not your spending" is wrong about an
  excluded refund; the button says "Exclude from totals", exclusion is not gated on sign, and the
  file should quote the button.

## The rule to carry

Structural tests prove a disclosure *appears*, is rectangular, is gated correctly and is
direction-free. **None of them proves it is true.** Every clause needs its own trace to the code
that makes it true — and for an always-on clause, that trace has to hold for the reader who has
none of the conditions it describes. A slice can be green through tsc, eslint, 6,973 unit tests,
a full e2e verify and its own four sabotage proofs while asserting five things the app does not
do. The critic pass is not a formality on copy; on copy it is the only pass that runs.
