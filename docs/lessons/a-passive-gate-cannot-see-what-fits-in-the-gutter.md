# A passive page-load gate cannot see a defect that fits inside the gutter

**One-line summary:** the M.1 mobile overflow gate asserts `document.scrollWidth <= clientWidth` on
passively-loaded routes, so it is structurally blind to two whole classes — anything behind a tap,
and any overflow small enough to land in the shell's side padding; the fix is a per-ELEMENT
measurement of the controls you actually open, and a fixture that doesn't ride on shared demo state.

## What happened (#276, Wave M.3 close-out)

Wave M.3's brief listed four deferred overflow items. Rather than fix them from the brief, a
temporary probe spec opened each control at 360/393/430 and measured every element's own
`scrollWidth` vs `clientWidth`. Result: **three of the four items were stale** (measured clean) and
the one real defect was in a control the gate can never reach.

The real defect: the triage quick-pick `grid-cols-3` sized each track at ~102px, while the shadcn
Button base carries `whitespace-nowrap shrink-0` and a grid item's `min-width: auto` floors the
track at min-content — so "Household & Home" (108px) painted outside its own cell.

## Why the existing gate could not have caught it

Two independent blind spots, both structural, neither fixable by adding routes to the sweep:

1. **Passive load only.** The sweep visits a route and measures. Every control behind a tap — the
   triage picker panel, a "New category" panel, a what-if grid — is unmounted at measure time.
2. **The gutter absorbs it.** The overflow was ~5px into a 16px shell gutter, so the *document*
   never got wider than the viewport. A page-level assertion is mathematically incapable of firing
   on any overflow smaller than the side padding, no matter how wrong the element looks.

Corollary: when a page-level invariant passes, that is evidence about the page, not about the
elements on it. If the thing you care about is "this label is fully visible", measure the label.

## The fixture trap that came with it

The first version of the locking test drove the **shared demo** triage queue. It passed in
isolation and then failed under the full suite with an empty inbox, because `phase2-triage` files
that queue first. Any fixture built on the demo row inherits every other spec's mutations and is
order-dependent by construction. The test now signs up a throwaway user and seeds its own
`needsReview` row — and asserts the long category name is actually present, so the lock cannot
silently degrade into measuring only short labels that would fit anything.

## Rules

- Before "fixing" a deferred item off a brief, **measure it**. Three of four here were stale (the
  same #248 / §c class); fixing a measured-clean element is unverifiable churn.
- A gate's assertion defines its blind spots. Write down what it *cannot* see when you add it.
- Per-element `scrollWidth > clientWidth` is the assertion for "is this label/figure fully visible";
  document-level scrollWidth is the assertion for "does the page scroll sideways". They are
  different bugs.
- E2E fixtures that need mutable state seed their own user. The demo row is shared with every other
  spec in the suite.
- A lock whose fixture can drift into a trivially-passing case needs an assertion on the FIXTURE
  (here: the long name is present), not just on the invariant.

## Recurrence 2026-07-27 (O.2) — the demo-fixture half of this lesson repeated verbatim

The order-dependence warned about here bit again, in a slice written after it. O.2's e2e signed in as the
shared demo account and asserted the seed's review queue was non-empty (`needsReview: 17`). It passed in
isolation and failed in the full suite with the control simply absent.

What makes it worth re-recording is how cheaply it was settled and how badly it reads if it isn't. The
failure message is "element not found", which looks like a rendering regression in the feature under test.
It is not: the control is deliberately hidden at a count of zero, so the register was correct and the
ASSERTION was describing a world that no longer existed. One query against the e2e SQLite file — which
still holds the end-state of the run that just failed — showed demo at 847 transactions with `needsReview=0`
and `uncategorized=0`. That is the whole diagnosis, and it cost one query rather than a hunt through 56 spec
files for whichever one drains the queue.

Two transferable points beyond "use a throwaway user":

- **The end-state of the e2e database is evidence, and it survives the run.** Before theorising about which
  spec mutated shared state, ask the database what the state actually was. `Transaction` has no `userId`
  here — join through `Account` — and the demo row is `user-demo`.
- **Owning the fixture buys exact numbers, which is a second win.** The rewrite imports its own three rows
  (two with an empty category column, one filed to `shopping`), so the counts became literals — 2 of 3 —
  instead of "greater than zero" against whatever the seed holds. The classified third row is the control
  group: without it, a filter that returned EVERYTHING would still pass.
