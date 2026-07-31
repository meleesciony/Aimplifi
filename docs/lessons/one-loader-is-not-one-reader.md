# One loader is not one reader — and I fixed the same bug on one surface while shipping it on another

O.17 gave every built-in category a per-user rename. The design was the one this ledger keeps
asking for: a single loader (`getCategoryOverlay`) that the pickers, reports, trends, budgets,
coach, recurring and triage all already read, so the new name would reach them **by
construction** rather than by an edit at each call site. I wrote that sentence into the schema
comment, the action file, the component docblock and the test header.

It was false, and it was false about **the main screen**. The register, the transaction detail
and split parts each resolved their label from the joined `Category.name` — which for a built-in
is the GLOBAL canonical name, because a rename is an overlay row that never touches it. So the
row read "Doctor" while the picker **inside that same row** read "Dr Visits". Two names for one
bucket, side by side, on the page people spend their time on.

The part that should sting: **I had already fixed this exact defect one file earlier.** I
rewrote `/api/export` specifically because "exporting the join would hand them a file labelled
differently from every screen they read it on" — and then did not grep for the other joins. The
insight was in hand and applied to the surface I happened to be looking at.

## What made it invisible

- **The claim was load-bearing and self-certifying.** Four docblocks asserted the coverage. A
  fifth — the test file's "asserts one rename through every read path" — asserted it in a file
  that was 16/16 green. Nothing in the repo disagreed with me, because everything that could
  have disagreed was written by me in the same hour.
- **The enumeration ran forward, not backward.** I listed readers by asking "who calls the
  loader?" That question cannot see a surface that resolves the same fact a DIFFERENT way. The
  only enumeration that works runs from the RENDERING backward: grep every
  `categoryName(`, every `meta.get(`, every `select: { name: true }` on a Category join, and
  ask of each one which basis it reads.
- **The e2e was written against this very failure class and still missed it.** Its header cites
  "a fix that typechecked, built and passed 225 e2e tests while doing nothing" — and then it
  asserted the `<select>`, on a throwaway user with **no transactions**, so the register had no
  row whose label could have contradicted it. A spec that cannot observe the defect it names is
  not coverage; the fixture has to contain the hard case.
- **The stale comment did the hiding.** `transactions.ts` said "system rows are identical (their
  DB name == the static name), so this is a no-op for them". True when written, false the moment
  a rename existed, and it read as a reason not to look.

## Rules

1. **"One loader, therefore every reader" is a claim, not an architecture.** A shared loader
   guarantees that whoever calls it agrees. It says nothing about who doesn't call it. Before
   writing that sentence, enumerate the readers from the rendering backward and name each one.
2. **When you fix a display path, grep for its siblings in the same commit.** The export join and
   the register join were one defect wearing two files. Fixing the one in front of you and
   writing a comment about it is how the other one survives.
3. **A gate must move with the thing it guards.** The detail view loaded the meta only when
   `needsLadder` (an UNFILED row). Correct while the meta only fed suggestions; wrong the instant
   it decided the label, because a filed row is exactly the case the gate excluded.
4. **Mutate the fix and name the test that dies.** Reverting `categoryLabel` now fails one named
   assertion. Before that test existed, reverting the whole P0 fix failed nothing.
5. **Two fresh-context critics with different lenses, in parallel.** Both found the P0
   independently — the strongest signal available — and each found P1s the other missed
   (the export→import round trip; the demo copy). They earn their cost in the non-overlap.

## Two more findings worth keeping

**A disclosure inherits the whole card it sits in.** The new copy said renaming is off in the
demo "because a name typed here would show up for other visitors" — rendered three inches under
a *custom category* text field that had no demo fence at all. Every clause was true; the card
was a lie. Fixed by closing the actual gap (fencing `createCustomCategory` /
`renameCustomCategory`, the typed leg that `shared-demo-account-must-not-learn.md` had recorded
as open) rather than by softening the sentence.

**Renaming a control renames its promise.** Relabelling "Hidden" to "Removed" widened the
sentence from "disappear from the pickers **when you categorize a transaction**" to "out of the
pickers" — and the budget-target picker never filtered hidden at all, so the claim was false on
the one surface where acting on it sets a monthly figure. Worse was the clause nobody had
written: the categorizer never reads the hidden set, so a "removed" category keeps receiving
auto-filed transactions forever. The old, narrower copy was accurate. Fix was both: make the
budgets picker honour it, and say the missing part out loud.

**And: never write the character you are rejecting.** The comment explaining why the code avoids
JS's ASCII word-boundary escape contained that escape, which a shell heredoc turned into a raw
0x08 in two files. `source-hygiene.test.ts` caught it — the third time this repo has been bitten
by generating source through a heredoc. Use Write/Edit; describe the character in prose.
