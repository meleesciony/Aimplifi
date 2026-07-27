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
