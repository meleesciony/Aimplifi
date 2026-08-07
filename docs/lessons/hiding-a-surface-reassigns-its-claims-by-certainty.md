# Hiding a surface makes you re-rank its claims — and rank by CERTAINTY, not by which array sounds scariest

**One line:** O.19 collapsed five /accounts cards behind one line, deliberately kept "the claim, not
the machinery", and still shipped a P0 — because the one sentence left visible was chosen by which
data set *sounded* most alarming, and the app's most CERTAIN double-count was the one that lost its
money sentence.

## What happened

The owner asked for the combine/duplicate machinery to be hidden ("looks like a beta website").
`deleting-a-surface-deletes-the-claims-it-carried` says putting a surface behind a tap removes every
claim it was the only renderer of, so the slice was designed around keeping the claims: the
collapsed line prints a heading plus one detail clause, chosen "by money consequence".

The ranking put the #192 advisory duplicate warning first — *"N balances may be counted twice"* —
reasoning that it is the only kind that says a printed figure may be WRONG. A combine offer got
*"N duplicate connections can be combined"*.

That reasoning was exactly backwards, and a fresh-context critic proved it by execution:

- `getAccountsView` filters out of `duplicates` **every pair that has a combine offer, a
  reconciliation candidate, or an existing reconciliation** (`transactions.ts:1352`). The advisory
  set is not the strongest case — it is the **residue**, the pairs for which the app has no proven
  remedy.
- The combine offer is the case the app is *certain* about, and its own card says so outright:
  `combineEvidence` — the balance *"counts twice everywhere this app adds your accounts up."*

So the money sentence went to "possibly" and the procedural sentence went to "definitely." The
critic seeded the slice's own fixture — one $1,000 account arriving through two live connections —
and dumped every visible string with the section collapsed: **net worth $2,000.00, and the word
"twice" nowhere on the page, or on /cards, or on /dashboard.**

## The part that should be uncomfortable

The slice's own new e2e asserted:

```ts
await expect(page.getByTestId('account-cleanup-summary')).toContainText('can be combined');
```

A test written in the same hour, by the same author, over the same design — **ratifying** the
weakened claim. It would have stayed green forever. Writing the lock does not verify the claim; the
lock inherits whatever the author already believed.

## The rules

1. **When you collapse N surfaces into one line, you are not summarising — you are RE-RANKING.**
   Every claim that does not lead is a claim you decided the reader can live without seeing. Do that
   deliberately, and write down which ones you demoted.
2. **Rank by certainty, and check the data set's definition before you call it the strong one.** An
   "advisory / possible / suspected" set is often the leftovers after every provable case has been
   routed elsewhere. Read the filter that builds it, not its name.
3. **Every kind that describes the same consequence must state that consequence.** If three clauses
   all mean "a balance is counted twice", none of them may be phrased as a remedy ("can be
   combined") — a procedural sentence silently drops the money.
4. **Check the UNIT of any count you newly print.** The same slice printed `duplicates.length` — a
   PAIR count from an all-pairs loop with no transitive collapse — as a count of balances, so three
   copies of one account read "3 balances may be counted twice" directly above a card headed "One
   account may be counted twice". A number that never existed before has no precedent to inherit
   correctness from.
5. **A claim that is exclusive with the lead may not live inside the lead's sentence** (this is
   `deleting-a-surface-…` rule 2, re-earned one level up). "An account is missing from your list
   because it was folded into another" was 4th of 6, so anything louder collapsed it into "· N
   more". It now gets its own clause unconditionally.
6. **Then grep the whole repo for prose that points at the thing you hid.** The rule was applied to
   4 sentences and missed 11 — across /cards, /calendar, the dashboard, and the weekly digest
   **email**, whose reader cannot be sent hunting around a page. Note the tree shape that hides
   them: `src/lib` may not import from `src/components`, so a constant defined beside the component
   cannot reach the copy that needs it most.
7. **A live region born hidden is a dead promise.** `role="alert"` on a card that now mounts inside
   a collapsed `<details>` never announces, and expanding does not reliably re-announce it. Two
   critics found this independently. Remove the role and put the claim where the reader actually
   reaches it.

## Addendum, from the CI gate on the same slice

The verify above was run against the four specs the task row named. CI then failed **five** tests
the row did not name, and both mechanisms are worth writing down:

8. **The task row's list of affected specs is a hypothesis, not an inventory.** `reconcile.spec.ts`
   drives the reconciliation candidate cards — four of the five failures — and was simply not on the
   row's list of "four e2e specs [that] drive these cards". A `getByTestId` grep for every wrapped
   testid finds it in one command, and that grep should be the FIRST thing a hide-behind-a-tap slice
   runs, before any of the work.
9. **A phrase-grep cannot find a structural assertion.** The fifth failure was
   `dashboard-duplicate-disclosure.spec.ts`, which extracts every curly-quoted string from the
   disclosure and asserts each one names a card the reader can see. Naming the section as
   `“Account cleanup”` borrowed that exact typographic convention, so the test was right and the
   copy was wrong: in a disclosure whose quotes mean "a row you can find on this page", a section
   name has to be written plainly (`in its Account cleanup section`). No amount of grepping for the
   sentences I had edited would have found this — only running the suite did.

The general form: when a change is a UI-shape change plus a copy change, the copy half has no
testid to grep and no phrase to grep either, because the assertions that guard copy are often
*rules about the copy* rather than the copy itself. Run the full suite before the push, not after.
