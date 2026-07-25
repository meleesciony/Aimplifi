# Ask the failure-direction question per ROLE, not per class of value

The same frozen number is conservative as a debt and dangerous as a source of funds. L.14 argued
its whole design over one of those roles and shipped the other one broken — and two fresh-context
critics, given different briefs, found it independently.

## What happened

L.14 fixed an account a bank has stopped sharing (Plaid Link update mode lets a user untick one).
The row kept its last balance, kept counting toward every total, and kept reading "Synced today"
because its BANK was still syncing. The design decision was **disclose, adjust nothing**, and the
argument for it was carefully made:

> Excluding the row would be its own money claim, and the expensive direction is exclusion: an
> unticked card whose statement is still genuinely owed would vanish from cash-needed and the app
> would stop telling someone to pay a bill they still owe.

That reasoning is correct. It is also entirely about **liabilities**. Every worked example was a
card. Nobody asked what the same frozen number does when it plays a different part:

- As the **payment account** — the base of the whole cash-needed projection — a balance frozen
  HIGH reports shortfall $0 and no transfer recommendation while the real account cannot cover the
  autopay. That is precisely the missed payment the rationale set out to prevent, arrived at from
  the opposite direction.
- As a **transfer source** on Cash Flow Radar, a frozen balance sorts FIRST (sources sort by size)
  and is stamped `sufficient: true`, on the one surface in the app that says *move $2,900 from
  Rainy Day Savings*. Acting on it means a transfer that bounces and a card payment that
  overdrafts.

## The rule

Before settling a failure direction, enumerate the ROLES the value plays, not the kind of thing it
is. Asset vs liability is not the axis; **figure vs instruction** is:

- A **total** that includes a stale balance is something the reader can weigh. Keep it, say so.
- An **instruction** built on one account's balance is an action whose failure is concrete and
  immediate. Never build it from a number you have just told the user is frozen.
- A **projection** resting on one frozen balance is disclosed at the surface giving the
  instruction — never silently adjusted, because inventing a lower balance fabricates.

The tell that you have made this mistake: your design rationale contains exactly one worked
example, and it is the reassuring one.

## Why two critics both found it

The rationale was written down, in the code, in full sentences. That is what made it checkable —
both critics quoted it back and produced the counter-case. A design decision recorded as a claim
("keeping it over-funds slightly") invites falsification in a way that a decision recorded as a
preference ("we disclose rather than adjust") does not. Write the argument, not the conclusion.

## Corollaries from the same cycle

- **Resolve a disclosure against the same post-processing as the figures it qualifies.** The
  banner announced a reconciliation predecessor as "still counted" while the boundary had already
  zeroed it and /accounts had hidden the row — then sent the reader to that page to fix it.
- **"Absent from the payload" is not an event unless the SUBJECT was in that payload's scope.**
  The holdings sweep deleted an unticked brokerage's positions under its own clean-run rule; that
  rule answers "is this list complete?", not "is this account still being reported?".
- **A remedy may only name a control that exists in the state the message renders in.** "Reopen
  Add or fix accounts" is real per connection; disconnect the bank and the row remains while the
  button does not.
- **Grep before claiming a channel is covered.** A comment here asserted the copy "stays true in
  an email" for a channel that was never wired, and an assumption that the engine's `assumptions`
  array fans out to /cards, Ask and the digest turned out to be false — it reaches the dashboard
  hero only. Checking cost one grep; not checking would have shipped a gap marked closed.
