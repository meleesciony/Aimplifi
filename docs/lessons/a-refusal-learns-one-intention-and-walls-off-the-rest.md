# A refusal built from one intention becomes a wall the day a second intention makes the same shape

**One-line:** L.10 layer 2 was built to stop an accidental duplicate connection and did it
correctly; when the owner needed a DELIBERATE duplicate — the only way Plaid will sell two years
of history — the guard destroyed it every time, silently, because the two requests are
byte-for-byte identical in the accounts they return and the distinguishing fact was never in the
data at all.

## What happened (2026-08-07, H.6 / DECISIONS #424)

The owner: *"Unacceptable we don't have at least plaid maximal dates."* Four sessions had already
measured the corpus, confirmed Plaid's 730-day ceiling, and filed the shortfall as an owner-click
gap — reconnect SimpleFIN, import CSVs, wait for a re-link he had to initiate. Every one of those
notes was true and none of them was the reason.

Plaid freezes `transactions.days_requested` when Transactions is added to an Item and names
`/item/remove` plus a fresh trip through Link as the only way to widen it. So the connection that
carries two years is necessarily a SECOND connection returning the SAME accounts as the first —
which is exactly the shape `decideAndPersistItem` was written to recognise and hand back to
Plaid. The owner could have re-linked all thirteen banks and ended each attempt with the same
ninety days, having been told "we refreshed that connection instead of adding a second copy."

The guard was not wrong. It had learned one intention — *"when I try to link same account again,
it just refreshes"*, the owner's own words from three weeks earlier — and it enforced that
intention against a request that meant the opposite.

## Why it stayed invisible

Because everything downstream was **already built and correct**. Two live connections at one bank
already combine; the reconciliation boundary already keeps the successor's deeper rows and had
been hardened by an earlier critic for precisely this case. The feature was one boolean away from
working, and four sessions of investigation never found that boolean, because they were all
looking at the DATA — how much history exists, where it lives, which provider can reach further —
and the defect was in a decision the app makes about the user's purpose.

## The rule

**When a guard refuses, ask what intention it learned, and enumerate the other intentions that
produce the same evidence.** A refusal is a claim about *why* someone did something, inferred
from *what* they did. That inference is safe only while one purpose can produce that shape. The
day a second purpose produces it, the guard is not merely wrong in a new case — it is
unappealable, because the user has no way to say which of the two they meant.

Three things follow:

1. **Carry the intent; do not infer it.** The fix that was rejected here is instructive: "keep any
   link that would bring deeper history than the one it duplicates" needs no user input and is
   true by construction — and it fires on every repair re-link too, which is the commonest reason
   anyone re-runs Link. Inference cannot separate purposes that the evidence does not separate.
   Only the person can.
2. **Exempt the intent, never the shape.** The exemption here is one flag that suppresses one
   branch. Every other guard on the path — the per-bank lease, the live interrogation of each
   candidate connection, the identity ladder's proven-only verdict — still runs, and the ordinary
   front door still refuses. A sabotage proved the split: remove the exemption and exactly its own
   lock dies; leak it to every link and nine of the original guard's tests fire.
3. **Check the failure direction of trusting the user.** Taking the caller's word was safe here for
   a specific, checkable reason: the flag can only ADD a connection, and an unwanted extra
   connection is disclosed, combinable and undoable, while a wrong discard hands back a live
   credential irreversibly. That asymmetry is what licenses trusting an unverifiable claim — not
   the fact that it comes from a button we built.

## The tell

The status doc said *"Route C is dead for depth, confirmed twice."* Confirmed twice, and both
confirmations measured the same thing: that the existing items hold ninety days. Neither asked
what happens when you try the remedy. **A route is not proven dead by measuring the state it was
meant to change** — only by executing it and reading what the app itself does with the result.
