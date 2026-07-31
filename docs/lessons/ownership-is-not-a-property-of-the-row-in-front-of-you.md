# Ownership is not a property of the row in front of you — and a refusal's REASON is a claim

One-line summary: O.15 slice 7 let the reader set `status` by hand and fenced it to rows "no feed
owns", but a split PIECE carries no `providerRef`, so a piece of a BANK charge read as reader-owned
and was offered a write the next sync silently reverted — both critics found it independently; and
three of the remaining findings were about the SENTENCES around the fence, not the fence.

## The central mistake

The design rule was right: *the reader may only write what he owns*. The implementation asked the
wrong object. `rowOrigin` reads the row's own `providerRef`, which is correct for every row a feed
or a human created directly — and wrong for every row the app DERIVES from another. `splitTransaction`
creates children with no `providerRef` (they cannot share the parent's: `@@unique([accountId,
providerRef])`), so a piece of a Plaid charge answers "nobody put me here" when the truth is "a bank
put my parent here". Meanwhile both providers push the parent's status onto its children on every
sync (`updateMany({ where: { splitParentId }, data: { status } })`), so the write looked obeyed and
was not — the exact failure the fence existed to prevent, one row shape over.

**The rule:** when a fence asks "who owns this?", ask it of the thing that OWNS the value, not the
row you happen to be holding. For a derived row that is its origin row. If you cannot cheaply reach
the owner, refuse the derived class outright and say why — that is what shipped here, because
resolving a piece's parent meant loading it at three call sites, and the wave's governing failure
direction was "refuse rather than act too widely".

**Corollary — amend the invariant, don't drop it.** Slice 2's rule "starting an action may be
refused; stopping it never is" had to stop applying to split pieces. That rule governs READER-OWNED
columns, where locking the undo strands the reader in a state he chose. `status` on a piece is not
his, so the exception is principled — and it was written into the docblock next to the rule it
narrows, rather than the rule quietly ceasing to hold.

## A refusal's stated reason is a claim, and the wrong reason is the dangerous half

The bank refusal justified itself with *"says so again on every sync — a change here would be
overwritten."* Natural, plausible, and false for the commonest bank row: Plaid's `/transactions/sync`
is a **cursor delta** that never re-sends an unmodified settled row, and SimpleFIN refetches only a
**~5-day window**. Nothing would have overwritten a local edit on a month-old settled charge.

The POLICY survived — the bank is the authority on whether its own charge cleared — but the argument
did not, and the argument is what the next editor relies on when deciding whether the refusal can be
relaxed. Verify the justification with the same rigour as a figure. (The one place the overwrite
claim was TRUE is split pieces, i.e. exactly the case the fence was getting wrong.)

## A state that is conservative for one sign is the opposite for the other

`status: PENDING` was safe to widen — it HIDES an outflow from eleven surfaces, the cautious
direction. But the cash-needed engine sums pending rows **signed** and adds the total to today's
balance, so on an INFLOW pending means *money already arrived*. A hand-typed "+$2,000 EXPECTED
PAYCHECK" marked pending took a measured $500 shortfall to $0 and deleted the dashboard's transfer
instruction — with no date gate, so a row dated 45 days out counted today. Only a provider could
create that state before, i.e. only for money someone had OBSERVED in flight; the slice made it
reachable for a hope.

**Before widening who may set a state, evaluate it at each SIGN separately.** L.14 decides the
remedy: a stale figure can be weighed, a missing instruction bounces an autopay — so refuse rather
than disclose.

## Write the disclosure against the gates, then make the clauses executable

The obvious sentence — "a pending row stops counting as spending" — is FALSE here: `isSpendRow`
never reads `status`, so /reports, /budgets, /trends pace+movers and the register summary count a
pending row exactly like a cleared one. Only the eleven *other* surfaces drop it. The shipped
sentence names both halves, and each clause is a test that EXECUTES the engine it describes, so
adding a status gate to reports fails a test that says the copy is now a lie.

**And the disclosure must live on every surface that can fire the action.** The sentence was on the
detail view while the shared action menu also rendered on every register row as a bare button — one
click could drop a tax-tagged row out of a preparer-bound total with nothing on screen. Fix: the
register NAVIGATES to the surface that carries the sentence, the arrangement `split` and
`markRecurring` already used. Either the copy goes everywhere the action does, or the action goes
where the copy is.

**Scope the copy by the shape it describes.** Once inflows were refused the reader could not create
the state, but a PROVIDER still can — so the effect line renders for outflows only, or we would print
an outflow's sentence over a bank's pending deposit. A refusal and a render gate are two different
guards and this needed both.

## Method notes that paid

- **Widen the WRITER, not the meaning.** ~30 call sites read `status`; none changed, because every
  one already handled pending rows (providers deliver them). No predicate touched, no column added,
  no schema diff — which is what kept a field that moves eleven surfaces to a small slice.
- **Two critics with different lenses, run in parallel, then serialize the fixing.** They converged
  independently on the split-piece hole (the strongest signal this repo has) and each found P1s the
  other missed — the money lens found the signed-inflow inversion, the claims lens found the false
  sync mechanism and a completeness lock that had decayed from ten actions to eight.
- **A completeness assertion that enumerates by hand decays silently.** `action-menu.spec.ts` still
  said "all eight actions" while the engine returned ten. Assert the COUNT beside the list.
- **tsc does not protect a `switch` over a widened union** when the map callback may return
  undefined: adding a `'status'` kind with no `case` rendered nothing while typechecking clean. The
  repo has shipped exactly this before (a banner that built, passed 225 e2e, and did nothing).
