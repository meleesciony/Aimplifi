# Linking a money figure to its rows asserts that two engines agree — and by default they don't

One-line summary: O.5 made category figures clickable, and the hard part was never the href — it was that
"spending on groceries in July" is computed by THREE different code paths in this repo whose predicates
disagree, so a link is a *claim of equality* between two of them, and the naive equality is wrong.

## The three bases, none of which is labelled as a basis

Same words on the screen, different arithmetic underneath:

- `/reports`, the dashboard breakdown and the `/trends` movers → `spendingByCategory` over the shared
  snapshot: nets refunds into ONE figure, drops transfers, split parents, income-group categories and the
  `transfer` category, windows by month-key prefix, includes PENDING, spending accounts only, USD only,
  reconciliation boundary applied.
- `/transactions` (the register) → `getTransactions` + `summarizeTransactions`: same account/currency/
  reconciliation predicates, also includes PENDING, split parents excluded in the Prisma query — but it
  reports **Money in** and **Money out** separately and windows by inclusive day bounds.
- `/budgets` → `netSpendByCategory` over a direct Prisma query: `status: 'POSTED'` only, and no
  `SPENDING_ACCOUNT_TYPES` restriction.

Nothing was wrong on any page in isolation. Putting a link between two of them is what makes a divergence
visible, because it invites the reader to compare two numbers that had never been asked to match.

## The netting asymmetry — the naive assertion is wrong exactly where it matters

The source produces one net figure; the destination splits the same rows into two tiles. So:

    source category figure  ==  outflow − inflow  ==  |Net tile|
    source category figure  !=  Money out          (whenever the category contains a refund)

"Assert the landing page's Money out equals the figure" passes on every category that happens to have no
refunds, which is most of them — a test that is green for the wrong reason and silent on the only case
that can embarrass the feature. The fixture must therefore CONTAIN a refund, and the anti-vacuity guard
asserts that `Money out` is *not* the clicked figure, so the easy-but-wrong assertion cannot be written by
accident later.

Corollary for windows (extends L.31): a month-key figure and a day-bounded filter are different
coordinate systems. Translate once, in the tested date module, and mutation-test the translation — a
one-day error in `monthWindow` failed five tests here, which is what proves the lock is load-bearing
rather than merely co-passing.

## State a refusal as a CONDITION, not as an instance

The first version of the fence hard-coded `uncategorized`. A critic then proved by probe that a category the
reader HIDES in Settings reaches the identical hole by a different route: `getReports` applies no visibility
filter (hiding governs pickers, not what you spent), so the figure still renders — while `getVisibleGroups`,
which builds the register's picker, drops it. One id fenced; the condition unfenced.

The fix is to ask the destination what it can display: `categoryRegisterHref` takes a **required**
`linkable: ReadonlySet<string>` — the flattened `getVisibleGroups`, the exact list the register's `<select>`
is built from — so both populations fall out of one predicate that cannot drift from the thing it describes.
Required rather than optional, because a defaulted fence fails silent.

If you find yourself naming a specific value in a guard, ask what property that value has, and whether
anything else has it.

## Rows right, control wrong is still wrong

The register genuinely filters `?category=uncategorized` (null is mapped to the placeholder *before*
filtering). But its category `<select>` deliberately omits that placeholder, so the reader would land on a
correctly filtered list whose control read "All categories" — and their next filter change would commit
that lie and silently drop the category. **A URL parameter the query honours but the CONTROL cannot
represent is not a valid link target.** Before linking to a filtered view, check that the destination's own
UI can *display* the filter it is under, not merely apply it.

The refusal belongs in the BUILDER (return `string | null`), not in an `isLinkable()` predicate each caller
must remember — the fence-by-construction rule, because a fence copied per call site misses call sites.
Returning null also makes the type force every caller to write the not-a-link branch.

## Don't link what has no reproducible window

A mean and a difference name no window a row filter could reproduce, so the trends `baselineCents` and
`deltaCents` were never candidates. Likewise an all-category month total does not reconcile against an
unfiltered register, because the register's Net offsets spending with INCOME. The test for whether a figure
may be linked is not "is it a money number" but "can a filter reproduce exactly this set of rows".

## The one I got wrong: I verified the ENGINE and never read the INTAKE

I checked that `/trends` movers are computed by `spendingByCategory` — the same engine `/reports` uses —
and concluded the bases matched. They don't. `src/server/trends.ts:22` filters `status === 'POSTED'` and
`:32` re-derives a null category from the descriptor **before** the engine sees a row. A fresh-context
critic executed the repro; I confirmed it at source before acting.

**Sharing an engine is not sharing a basis.** The shaping that happens between the snapshot and the engine
is where surfaces diverge, and it is in the *server* file, not the engine file — the one I never opened
because the engine answered my question. When checking whether two surfaces agree, read the call site's
input predicates, not the shared function they both call. (Same shape as the earlier lesson that a new
consumer of an engine inherits its sign/status/scope conventions.)

The failure was well hidden: `comparedYm` is the just-ended month for the first days of every month —
exactly when month-end charges are still pending — so the divergence is largest precisely when the card is
most likely to be read.

## Apply the rule symmetrically, or it isn't a rule

`/budgets` had already been refused for being POSTED-only. Once `/trends` turned out to be POSTED-only too,
the only consistent move was to refuse it as well — not to keep the link I'd already built and written up.
The tell that a rule has become a rationalization is that it starts admitting the surface you already
implemented.

## Make the reason executable

A refusal justified in a comment rots. The reason here is a claim about production code ("these surfaces sum
a different set of rows"), so it's a test: a POSTED-only intake reports less than the register for the same
category month, and the linked surface agrees. Lifting the refusal now requires making the bases agree and
watching a test change — a confrontation prose cannot force. The e2e counterpart asserts the movers card
holds no `?category=` link, with an anti-vacuity guard that the card is actually showing movers.

## Check what a suggested fix costs before taking it

A critic correctly demolished my stated reason for not linking the dashboard's Top-Spending rows ("nested
anchors are invalid") by pointing at non-anchor cards two files away. But those are `<section>` panels,
while the five dashboard summary cards are a documented family sharing `SURFACE_LINK_CARD_CLASS` and locked
by `surface-card-styles.test.ts` *precisely* so one cannot visibly drift from its neighbours. The
restructure would break that invariant and remove a tap affordance, to save one tap on a 4-row summary whose
purpose is to open the surface where every figure is linked.

The critic was right that my *reason* was bad and wrong that the change was cheap. Both halves matter: a bad
justification should be replaced with the real one, not defended, and a recommendation should still be
costed before it is taken. Two other claims from the same report also failed on contact — an argument that
`/budgets` differs by "3 rows in 847" (that measures the demo SEED, not a live card feed where pending is
routine) and a `type=expense` param that would have excluded the very refund rows that net into the figure
being reconciled.

## And the honest residual

Three surfaces compute "spending by category this month" on three different bases. No reader can see that,
and it only became visible because a link invited two of them to be compared. That finding is the real
deliverable of this task; unifying them changes displayed money and belongs in its own slice with its own
critic. Coverage was the ask, but a link whose landing page sums differently is worse than no link, so
no-link outranks coverage.
