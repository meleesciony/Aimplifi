# Prevention is not a remedy for the instance already on the user's screen — and a rule is only sound where its precondition holds

One-line summary: three sessions in a row shipped identity, disclosure and prevention for the owner's
duplicated Chase card and never removed it, and when the remedy was finally built, the reconciliation
machinery it reused deleted real money in *both* directions because the date-split rule it inherited is
sound only when one of the two feeds is complete.

## The first half: he asked "what did you actually fix?"

Over #298, #299, #300 and #301 the app learned to tell three cards named `CREDIT CARD` apart by last-4,
to disclose on /cards that one card was arriving twice, to capture the identity columns a merge would
need, and to open Plaid Link in update mode so a *future* re-link could not create a second copy. Every
one of those was a real improvement. None of them changed the number on his screen: two Chase
connections, one card, `$8,539.09` counted twice.

He sent two screenshots and asked what had actually been fixed. The honest answer was "nothing you can
see", because:

* the shipped Combine flow requires one side to be **stale** (R3 — a reconciliation zeroes a balance, so
  it must never zero a live one), and both of his connections were live;
* `detectReconciliationCandidates` skipped **same-provider** pairs outright, so two Plaid connections at
  one bank produced no candidate at all;
* which left exactly one remedy in the product: delete a row, and its transaction history with it.

**The rule.** When a defect is reported on a specific instance, the deliverable is that instance
resolved. Legibility ("now you can tell them apart"), disclosure ("we think these are the same"), and
prevention ("this can't happen again") are all worth building — and none of them is a fix. Order the
queue by what the reporter is looking at, not by what is architecturally upstream. The prevention slice
had been scheduled first here; it was the wrong order and the owner is the one who noticed.

## The second half: the inherited rule was only sound upstream

The remedy reused the shipped reconciliation boundary: the old row claims `[its first txn,
min(cutover, its last txn)]`, the live row keeps everything outside that window, and each date is owned
by exactly one side. That is how the double-count ends — and it worked, for the case it was designed
for. Cross-provider, the predecessor is the *only* feed that ever covered its era, so handing it that
window loses nothing.

Two **live** feeds are not that. They are both partial, in different places: one was broken for two days,
the other backfills deeper. So whichever side does not own a day loses its copy of it, and a hostile
critic executed the loss in both directions:

* cutover at the old row's last transaction → the surviving connection's exclusive rows vanished
  (`SHELL OIL`, `DELTA AIR`, $890);
* cutover moved to just before the live feed's history → the dropped connection's exclusive rows vanished
  instead (`WHOLE FOODS`, `UNITED AIR`, $930).

Both times the flash said *"Done — 1 account now counts once."*

**The fix was not a third cutover.** No date line can deduplicate two partial overlapping feeds. It was a
*proof*: before acting, check that every row the split would drop has a same-day, same-amount survivor on
the other side (multiset-matched, so two genuine $5 charges need two survivors). If one does not, refuse
and name the amount. An honest gap beats a silent deletion — the same direction rule as
`precision-fix-that-fabricates-is-worse-than-a-safe-superset.md`.

**The general rule.** Reusing a proven engine carries its *preconditions*, not just its code. Write down
what made it correct where it came from ("the predecessor is complete up to its cutover"), then check
whether that still holds in the new caller. If you cannot check it, do not act on it.

## Two corollaries worth keeping

* **An irreversible action needs its claim inside the transaction that authorises it.** The plan was
  derived by a read outside any transaction and the disconnect fired against that snapshot; two taps on
  the card's two directions destroyed *both* connections (executed 3/3). Making the row deletion itself
  the claim — inside the same transaction that reads the plan — turns the race into a detected write
  conflict, with no separate lock state to leak.
* **Superseding an account must carry the per-account CONFIG, not just the rows carrying money.**
  `AutopayConfig` was filtered out with the dropped row, so /cards would have said "move $8,539.09
  yourself" for a card the bank was still going to pull. Statements and scheduled rows were re-keyed;
  the one config that drives a payment instruction was not.
