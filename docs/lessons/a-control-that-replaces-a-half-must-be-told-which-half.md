# A control that replaces a HALF must be shown that half — not the whole

**One line:** C.23 added declared reserves into the fixed figure and the override form went on
printing the whole suggestion beside its input, so a reader who locked the number in front of them
would have got a fixed line *higher* than the figure they just accepted — the reserves added on top
of a total that already contained them.

## What happened

C.23/H.4 gave the Fixed term a third source: a reserve the reader declares (home repair, yearly dues
÷ 12), which no transaction implies. Two design decisions followed, both defensible:

1. Reserves fold **into** `suggestedFixedCents` and `fixedExpensesCents` rather than being published
   as a fourth term beside them, because twelve call sites already render the fixed figure and a
   separate term would have understated Fixed on eleven of them until each was found.
2. A typed fixed **override** replaces the pattern half only; the reserve stays added on top, because
   the override is a number typed over a figure derived from spending patterns while a reserve is a
   separate statement made on a different screen, and letting them cancel would silently discard one
   of the reader's own two declarations.

Each is right. Together they falsified a sentence neither of them mentions.
`plan-figures-form.tsx` prints *"From non-discretionary categories: $X"* directly above the input
that sets the override, as the number the reader is invited to lock. After (1), that `$X` is
`pattern + reserves`. After (2), typing it produces `pattern + reserves + reserves`.

The enumeration was wrong too — reserves are not "non-discretionary categories", they are not
categories at all — but that was the small half. The large half was that the figure shown next to a
control was **not the figure the control operates on**.

## The rule

When a control replaces part of a composed figure, the number displayed as its current value must be
**that part**, never the composed total. If the two differ, the surface must publish the part
explicitly — and the split must be computed by whoever composed the figure, not subtracted at the
view (the C.26 lesson: a view that re-derives a window, or a share, is a second author on the same
arithmetic).

`SpendingPlan` therefore publishes `patternFixedCents` beside `suggestedFixedCents`, and the form
also names the remainder in words: *"plus $100.00 a month you set aside, which stays added on top of
any figure you lock here."* A reader can now predict what locking will do.

## Why it was nearly missed

Both halves of the defect were invisible from inside the change. The engine tests all passed — the
arithmetic was correct. The Fixed list reconciled to the penny — the composition was honest. Nothing
was wrong with the number; what was wrong was the *offer* made next to a different control on the
same page. It surfaced only from asking, of each surface that renders the figure, **"what does this
one let the reader DO with it?"** — which is a different question from "does this one print it
correctly", and the only one that finds this class.

## Generalization

A figure has a meaning, and a control beside it makes a promise about what will happen to that
meaning. Adding a term to a figure is therefore a change to every control that writes it, not only
to every surface that reads it. Enumerate the writers with the readers.
