# Closing a gap shrinks the disclosure that described it — re-derive the remainder, don't delete the clause

**Summary:** when a slice fixes part of a known limitation, the copy that disclosed that limitation
becomes wrong in the *dangerous* direction unless the remaining set is re-derived from the code.
Deleting the clause you just fixed leaves a shorter list that reads as an exhaustive one.

## What happened (L.24, 2026-07-26)

The spending plan's "What this figure can't see" panel listed the billing rhythms the app does not
recognize: *"every ten days, every three weeks, every six weeks, every couple of months,
**quarterly, or twice a year**"*, followed by *"We recognize weekly, every-two-weeks, monthly and
yearly rhythms."*

L.24 taught the detector to recognize quarterly and twice-a-year, so both examples were deleted
from the dropped list and both added to the recognized list. That looked like a faithful update.
It was not. A fresh-context copy critic executed the classifier across every gap length and found
**seven** ranges still returning IRREGULAR: 1–4, 10–11, 17–25, 36–83, **99–174**, **191–349** and
**381+** days. The revised copy named four of them, and the longest example a reader now saw was
"every couple of months" — so a **four-monthly bill (~122 days), a real US utility billing
period**, was covered by nothing, and the two sentences together read as an exhaustive partition:
dropped = these four, recognized = these six.

Direction matters: an uncounted bill makes guilt-free spending read **too generous**, so the reader
who most needed the warning was the one no longer getting it. The pre-fix copy had at least
gestured at *long* rhythms being dropped. The fix removed that signal.

Same session, same shape, a second time: the precondition sentence said a late quarterly bill is
not counted *"yet"*. The every-gap rule reads **all** of history with no lookback window, so a
thirteen-sighting quarterly bill with one 14-day-late cycle two years ago is $0 **permanently** and
no future on-time cycle brings it back. "Yet" was written from the rule's intent instead of its
scope.

## The rule

When a slice closes part of a disclosed gap:

1. **Re-derive the remaining set from the code**, by executing the classifier/branch over its whole
   input domain — never by editing the old sentence to remove what you fixed.
2. **Check whether the list now reads as closed.** "We recognize A, B, C" plus "we don't recognize
   X, Y" is a partition claim. If the true remainder is open-ended, say so ("anything that falls
   between them counts as $0 here").
3. **State scope and permanence, not just existence.** "Yet" is a promise. A rule that reads all of
   history has no "yet".
4. The generalized sentence must be **re-checked per case**, not assumed to carry: reusing ANNUAL's
   "in **the month** the bill leaves your account" for a quarterly bill was wrong four times a year
   (same session, copy critic P1-4).

## Why a critic caught it and the author did not

The author's attention was on the half being *fixed*; the disclosure was treated as bookkeeping
downstream of the fix rather than as a claim with its own truth conditions. A fresh-context critic
with no stake in the fix read the sentence as a reader would and then executed the classifier to
check it. **Copy that describes a limitation is load-bearing and needs its own adversarial pass,
run against the code and not against the previous sentence.**

---

## Extended #391 (C.2's critic cycle): prefer a POSITIVE admission rule to any list of exclusions

The same disease, one step earlier — and this time the fix generalises.

C.2 taught the pace projection to read the bill calendar, then hedged the new figure by listing
what it leaves out: *"Bills charged to a card, and any we have not spotted, are not in that
$6,200.00."* Two items. The engine refuses at least five classes, three of which the app can
plainly see and renders as bills still due on **/calendar, one click away, off the same array**:
an aggregate pseudo-merchant ("Zelle Payment"), a hand-authored label ("Rent — Peachtree
Properties"), and a transfer-paid obligation. A reader whose landlord is paid by Zelle read the
two-item list, found that neither item described them, and correctly concluded their rent was
inside the figure.

A sibling branch was worse: it declared the projection finished — *"The bills we can see for this
month have already been charged"* — and carried no limitation at all. It was the only branch
telling the reader nothing more is coming, and the only one with no hedge.

**The transferable rule: an enumeration of exclusions beside a money figure is a claim to be
complete, and it must be extended by hand forever. A positive statement of the admission rule
cannot decay that way** — it says what IS counted, so every refusal the engine makes, including
ones added by a later session, is covered by construction:

> Only bills we can match to a merchant you have spent at are counted here — one charged to a
> card, paid as a transfer, or that we have not spotted is not.

The examples after the dash are illustrative and can go stale harmlessly; the clause before it is
the one doing the work. A positive rule also tells the reader something they can act on, because
the rule is about matching a merchant and the reader is the one who knows where they have spent.

Two corollaries from the same cycle:

- **Ask which branch has no hedge, and check that one first.** The P0 was not in the branch full
  of qualifications; it was in the confident one. The branch that says "done" is the branch a
  reader stops reading after.
- **A lock whose fixture does the work passes on the old code.** The first draft of the
  future-dated-admission test reused a merchant whose *prior-month* charge admitted the bill
  legitimately, so it passed before the fix and proved nothing. It was caught only by running it
  before believing it — the fixture, not the guard, was deciding the outcome. Ask of any lock what
  value would make it fail, then make that value the fixture.
