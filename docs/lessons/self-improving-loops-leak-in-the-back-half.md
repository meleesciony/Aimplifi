# A self-improving loop leaks in its BACK half — the abstention gates are the part you'll get right

**Summary:** building the vocabulary-mining loop (#225/#226), all the design attention went to *what it
refuses to learn* — and that half survived three hostile critics intact. Every P1 was in the half nobody
was looking at: whether the undo *stays* undone, whether anything still watches a rule *after* it starts
answering, and who else can see what it learned. Write the abstention tests, then go straight to the back
half and attack it.

## The three back-half failures, and the shape of each

**1. An undo a background job can overwrite is not an undo.**
The miner reads → decides → writes. A user clicking "Forget this" inside that window had their rejection
silently reverted by the stale decision — and since the rejection lived nowhere but the row itself, it was
gone for good; the rule resumed serving and went on to self-promote. Fix: `status: { not: 'retired' }` in
the miner's write filter, so a tombstone always wins the race. **Generalize:** whenever a user action and
a background job write the same row, the user's terminal action must be part of the job's *where*, not
just its read.

**2. Excluding your own output from your own evidence creates a monitoring blackout — something must
replace the signal you removed.**
The self-confirmation guard was right: rows the loop's own rules resolved are tagged `vocab:<kind>` and
never count as evidence, or a rule would confirm itself forever. But that guard is exactly *why* a rule,
once it starts serving, short-circuits the independent resolver and can never be contradicted again.
Held-out evidence froze at the moment of promotion; `flagged → active` was promoting on the rule's own
serves; and "one disagreement retires it" had become unreachable. The audit's constitution demands
"reverted automatically on metric regression" — and no metric could regress, because no independent signal
existed. Fix: a weekly replay of every SERVED phrase against the resolver that never sees the rule.
**Generalize:** if a loop stops consulting the oracle once it's confident, it has stopped being able to
learn it was wrong.

**3. A "held-out" gate validated by a wall clock is not held out.**
Held-out evidence was "rows created after the entry's mint timestamp". On multi-instance deploys a row
stamped by a faster clock lands *after* the mint and gets recounted as held-out evidence for the rule it
helped create — the one gate that makes a promotion mean anything, defeated by clock skew. Fix: draw the
boundary from the DATA (`evidenceThrough` = the newest row that supported the mint), not from the clock.
**Generalize:** a boundary between "what I learned from" and "what tests me" must be derived from the same
ordering the evidence itself carries.

## What to do next time

- Write the abstention suite first (it's the #223 lesson, and it works). Then assume it's fine and spend
  the critic budget on: **undo durability under concurrency**, **what still watches the rule after it
  ships**, and **who else can see what was learned**.
- Fan out critics with *different lenses*, not more of the same. The routing/money critic proved the
  feature's central safety claim held under every injection attack it could build — and was blind to all
  three failures above. The loop critic and the privacy critic, given the same diff, found them
  immediately.
- A false *retire* costs the user nothing (the question returns to the route it had before it was ever
  learned); a false *promote* puts a true figure under a false question. That asymmetry is what licenses
  zero-tolerance reversion: one disagreement is enough.

## Extended #251 — a consent-retirement rule inferred from ¬condition inherits every gate of the condition

The income-pause radar's whole design budget went to the alarm's precision gates — and they survived the
critic untouched. The P1 was in the back half again: "resumed" (which both *deleted the user's consent
row* and *re-projected the income*) was implemented as ¬lapsed, and `lapsed` carried the ALARM's gates
(occurrence floor, amount floor, aggregate exclusion). So a provider deleting one historical row — a
routine sync event — dropped the series below the occurrence floor and read as "resumption": consent
deleted, phantom income projected, no feed row left to disclose either. **Generalize:** alarm gates and
standing consent answer different questions; a rule that RETIRES a user's explicit state may only fire on
positive, date-fresh evidence of the thing it claims happened (here: an actual new deposit), never on the
negation of a compound predicate. And the disclosure row must ride the SAME predicate as the mutation it
discloses, or a gate flicker hides an active money mutation (#251 F1/F4; fixed via one shared
`confirmedPauseState`).
