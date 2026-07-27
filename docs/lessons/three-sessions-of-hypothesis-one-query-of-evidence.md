# Three sessions of hypothesis, one query of evidence

**L.26, 2026-07-26.** The owner sent the same screenshot for a fourth time: *"Why are there 0s here.
It's not true."* — "Fixed & recurring expenses (monthly pattern) — $0.00" under $21,117.48 of income.

L.23, L.24 and L.25 had each shipped a real fix aimed at that $0.00: annual bills reaching the
plan, quarterly and twice-a-year bills reaching it, and bills paid from a second cash account
reaching it. All three were genuine uncounted-bill defects. **None of them was the cause.** L.25's
own test file said so honestly in its header — *"That remains UNVERIFIED — no live DB is reachable
from here"* — and then named a leading candidate anyway (the amount-stability rule), which was also
wrong.

The live database was reachable. `npx vercel env pull` in the linked checkout, `pg`, and a read-only
replay of the exact pipeline gave the answer in one run: **21 series detected, 0 scheduled rows
written.** The owner had re-linked their Schwab checking five days earlier; the reconciliation keep
rule bounds a superseded predecessor at its cutover, a series' account is the account of its most
recent kept charge, and the projection scope excludes superseded accounts. Every bill last charged
before the cutover was resolved to a dead account id and projected nowhere.

## The lessons

**Reachable evidence outranks three sessions of reasoning, and "no live DB is reachable from here"
is a claim to test, not a premise.** Rule 0 of this repo says never guess — verify, or say you're
not sure. Three sessions said "not sure" correctly and then optimised the guess instead of paying
the (small, read-only) cost of looking. The check is not "did I label it a hypothesis"; it is
**"what would it take to make this a measurement, and have I tried?"**

**A production replay is a different instrument from a unit test.** The fixtures were right, the
tests passed, the arithmetic was correct — and the production input class (a series whose account
was superseded four days ago) existed in nobody's fixture. Replay the real rows through the real
pipeline before believing a fixture describes production.

**Excluding a ghost is only half a boundary.** The dead account is correctly excluded from scope. But
a row *derived* from its history — a detected series, a projection, an aggregate — is not a ghost to
drop; it is a live fact to **re-key** onto whatever carries the money now. The snapshot boundary
already knew this and re-keyed stored scheduled rows onto the successor (F6); the WRITE path dropped
the same class of row before it could ever be stored. When you add an exclusion, ask what is derived
from the excluded thing and where it should land instead.

**"A reconciled-away account's series is a dead bill" — the shape of the false claim.** It was
written as a justification in a comment, locked by a test that asserted `expect(rows).toEqual([])`,
and reviewed by a critic. A test that asserts a wrong belief makes it *harder* to fix, because the
red test now reads as a regression. When a slice adds an exclusion "for the same reason X excludes
it", check that the reason survives the transfer: `resolvePaymentAccount` excludes a predecessor
because a zeroed account **funds** nothing, which says nothing about whether its bills still
**charge**.

**A true zero and a broken zero look identical.** Three of that card's five lines read $0.00; two
were correct (no card due before month-end, no savings goals set) and one was a defect. The owner
could see something was wrong but not which line, and each session picked a different one. A zero
meaning "nothing qualifies this month" and a zero meaning "you never set this up" and a zero meaning
"we found nothing to count" are three different sentences, and printing all three as `$0.00` is what
let this survive in plain sight for four sessions.

**Shipping the fix is not shipping the number.** `ScheduledTransaction` is written only by
`refreshRecurringForUser`, which runs on sync — so the deploy changes nothing on the owner's screen
until the next sync runs. A fix whose effect is gated behind a job the reader cannot see needs that
job triggered in the same session, or the owner looks at the same $0.00 and concludes nothing
happened again.
