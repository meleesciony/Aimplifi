# An irreversible act may not be authorised by stored state — re-prove it against the source

**One line:** L.10 layer 2 decided whether to hand a just-created Plaid connection back to Plaid
by comparing against `Account` ROWS, and rows keep describing a connection long after it has
stopped being able to reach them — so re-linking a bank to REPAIR it destroyed the working
credential and kept the dead one, while telling the user it had "refreshed that connection".

## What happened

The feature is the one the owner asked for by name: *"when I try to link same account again, it
just refreshes."* The engine (`detectLinkCollision`) was pure, well-tested and correct. The
wiring fed it the wrong facts.

Two fresh-context critics, run in parallel with different lenses and no sight of the
implementer's reasoning, independently produced the same P0. Both then found further instances
of the identical mechanism that neither the implementer nor a single critic had enumerated:

* **An expired login still has all its rows.** The user's bank stops updating, they reconnect it
  through the front door — the commonest reason anyone re-runs Link — and every account matches
  perfectly against the dead connection's leftover rows. The app revoked the new, working Item.
* **A row the feed stopped returning still matches** (deselected in update mode, or closed at the
  bank — the state `TASKS L.14` already documents as un-pruned). That turned a known staleness
  bug into an irreversible one: the only live route to the account was revoked.
* **A row predating the `plaidItemId` stamp (#256) was invisible**, so the same comparison ALSO
  failed in the opposite direction and created the duplicate the feature exists to prevent.

One cause, three symptoms, two of them opposite in direction. The fix is one sentence: ask each
candidate connection what it can reach *right now, over the wire*, and treat a connection that
cannot answer as proving nothing.

## The rule

**Before an irreversible act, re-derive the facts that authorise it from the system that owns
them.** A database row is a cache of an external resource's state, and a cache is exactly as old
as the last successful sync. For a reversible action, stale input costs a correction. For an
irreversible one it costs the thing itself — and the app will then narrate the loss as a success,
because the copy was written against the state the code believed it was in.

Corollaries worth keeping:

* **The extra call is the price of the act, not overhead.** Here it is one `/accounts/get` per
  candidate, paid only when the user already has a connection at that bank — never on an
  ordinary first link.
* **Failure direction is a design input.** Missing a collision leaves a duplicate that is
  disclosed (#299/#306) and combinable (#304); a wrong one destroys a connection. So every
  ambiguity — no institution id, a failed fetch, a candidate that will not answer — links
  normally. Write the abstentions as the majority of the tests.
* **A count that drives user-facing copy must be computed over what will actually render.** The
  same slice claimed "this login reaches an account the other one can't" while counting an
  account Plaid types `other`, which never becomes a row and appears on no screen.
* **When the irreversible step itself fails, fall back to the state the user can SEE.** A failed
  `/item/remove` originally left a live billed Item whose token the app had never stored:
  invisible, unremovable, re-minted on every retry. Keeping it as a visible duplicate they can
  combine is strictly better.
* **If a locked invariant is not going to be honoured, amend it in the same slice and say so.**
  D7 required a "different login — keep both" prompt with a remembered choice; what shipped is a
  structural escape that does not cover two named cases. That is written into the design doc as
  D7a and queued as `TASKS L.16` — not silently dropped.

## How it was caught

Two critics in parallel, each given a different lens (irreversible data loss; claims, copy and
missed consumers), each told to EXECUTE repros rather than argue. Both wrote throwaway vitest
files against the real provider and the real database and deleted them afterwards. The
overlapping finding is the strongest signal available that a defect is real; the
non-overlapping ones (four separate copy defects, a stale sibling sentence pinned in place by
an e2e asserting its exact wording) are the argument for running more than one.
