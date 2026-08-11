# A fix that no test can fail on is a hypothesis — and a client module's export is not a value on the server

**Hook:** O.13b's detail view went through two hostile-critic cycles. Cycle 1 found eight P1s. Cycle 2
found four more, and **three of them existed because a cycle-1 fix had been reviewed rather than
locked** — including one that typechecked, built, passed 225 e2e tests and did *literally nothing*.

## The sharpest case: a fix that was inert and green

The cycle-1 fix for "a timed-out write reloads looking exactly like a success" was a banner gated on a
query flag:

```tsx
// page.tsx (a SERVER component)
import { TransactionDetailView, UNCONFIRMED_PARAM } from '@/components/finance/transaction-detail-view';
//                              ^^^^^^^^^^^^^^^^^^ exported from a 'use client' module
unconfirmed={query[UNCONFIRMED_PARAM] === '1'}
```

Every export of a `'use client'` module becomes a **client-reference stub** on the server side of the
RSC graph. It is not the string `'unconfirmed'` there. So `query[…]` indexed `searchParams` with a
non-string, never matched, and the banner rendered zero times — while `tsc`, `eslint`, `next build`,
and every existing test stayed green, because none of them ever loaded the URL.

The proof was an A/B build changing exactly one expression:

```
# as shipped:            unconfirmed={query[UNCONFIRMED_PARAM] === '1'}   → banner count 0
# one-token difference:  unconfirmed={query['unconfirmed'] === '1'}       → banner count 1
```

**Rule:** a value shared across the server/client boundary belongs in a module that declares *neither*
directive. This is `docs/lessons/mutation-form-recipe.md`'s L.7 rule (`'use server'` files may export
only async functions) seen from the other side — both are the same fact, that a directive changes what
your exports *are* to the other environment, not just where they run.

## The generalisable half: "closed" is a claim, and claims need a failing test

Cycle 2's method was the lesson. It did not read the comments asserting each cycle-1 fix; it **mutated
the source back and named the test that died**. The ledger it produced is the artefact worth copying:

| mutation | test that fails |
|---|---|
| split claim re-nulls `categoryId` | *gives the reader's own category back when a split is undone* |
| `descriptorOrigin` → always `'bank'` | *says a manual row was ENTERED…* |
| drop the `isTransfer` branch | *refuses a split on a transfer…* |
| **drop the reconciliation boundary** | **none** |
| **anything about the unconfirmed banner** | **none** |

The two rows reading "none" were exactly the two defects. A fix with no failing test is not
protection, it is a note in the source about what someone intended — and the next refactor deletes it
silently. Write the mutation ledger for your own slice *before* claiming a cycle closed.

## Corollaries, each paid for

- **A test can lock the bug in.** My own test flipped an *account* to `provider: 'plaid'` and asserted
  `'bank'` — certifying the very defect cycle 2 found, that a hand-typed row on a linked card is not
  the bank's text. When a critic names a discriminator as wrong, check whether a test is *defending*
  it. (The row already knew: `providerRef` is null unless a feed delivered the row. Ask the row about
  the row.)
- **Fixing a false claim can put the fix on the wrong noun.** "Say ENTERED for manual rows" was
  implemented as `account.provider === 'manual'`, but manual add and CSV import accept *any* account
  the reader owns. The sentence got less false rather than true.
- **A fixture can be vacuous for a reason the engine documents.** The reconciliation test looked right
  and passed against the *unfixed* code, because a single row dated after the cutover trips the
  engine's own degenerate-claim guard. Straddle the boundary, and assert **both** directions — the row
  withheld *and* the row kept.
- **A withheld control still submits its field.** Hiding the tax `<select>` on a split container meant
  `FormData` carried no `taxClass`, and the action writes both fields on every call — so saving a
  *note* erased a tag the reader never touched. Withholding a control changes what the form *means*.
- **Disclose before the irreversible step.** Splitting a tax-tagged row silently removed $212.40 from
  the tax report; the sentence explaining it appeared only after the money had moved.
- **When you make an old path newly reachable, you own its latent defects.** Split had been reachable
  only from the triage inbox, where rows are unfiled by definition — so "undo split loses the
  category" was invisible for months and became real the moment a *filed* row could be split. Ask what
  the old surface's population made impossible.
- **A guard's condition must move with the branch it guards.** Making the restore conditional left an
  unconditional `reviewPinned: true` beside it, which would have minted the app's first
  filed-and-pinned row — a state an earlier cycle had already ruled a P1.
- **Your change can falsify comments in files you never opened.** Two money-reasoning comments
  (`trends.ts`, `keyword-rules.ts`) cited "undoing a split restores `categoryId: null`" as their
  rationale. Still-correct conclusions, dead evidence — and the next reader re-derives from the
  evidence. `grep` for the behaviour you changed, not just the symbol.
- **The scariest edit was fine and the safe-looking ones were not.** The money change — a split
  container retaining its category — was verified clean by execution across reports, trends, register,
  tax, spending-plan, dashboard and Ask. All four cycle-2 P1s were in the UI-truth layer. Effort spent
  on the part that *feels* dangerous is not automatically effort spent where the defects are.

## Addendum (O.20g, 2026-08-11): a fail-old fixture must move the STATISTIC the rule reads

Two "FAIL-OLD" locks shipped green in O.20g and neither of them bound. A fresh-context critic proved
it by mutation — restoring the old income accumulator left the whole suite passing — and the cause
was arithmetic in the test's own comment:

> *"median second half 700_000 vs 500_000 first half = +40%, which beats the spend growth and clears
> it"*

The second half was `[500000, 700000, 500000]`. Its median is **500000**. The rule under test
compares two MEDIANS specifically because a median is robust to one anomalous month — the engine's
own comment says so — and the fixture perturbed exactly one month. The test asserted a number that
the old code and the new code both produce.

**The rule:** when the behaviour under test is a median, a percentile, a majority, a quorum, a mode,
or anything else chosen for robustness, a one-element fixture cannot fail it. Perturb enough
elements to move the statistic — for a median of three, that is two — and then **prove it by
mutation**, not by reading the fixture. The whole O.20g lock set was re-proven with an eleven-
mutation battery (revert each fix in turn, confirm red); it found one more fix, a copy sentence,
with no binding lock at all.

Corollary: the same robustness makes the *product* rule safe in the direction a naive reviewer
worries about, and unsafe in the direction they don't. O.20g's first refusal rule vetoed on a single
missing month — a month the median provably ignores — and would have silenced a correct verdict for
everyone paid ten months a year. Ask what the statistic is robust to BEFORE writing either the guard
or the test that locks it.

