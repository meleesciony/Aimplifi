# A disclosure is inherited by every surface that inherits the rule — and each cycle's fix is the next cycle's defect

**One line:** C.26 clamped "spent this month" to today in one engine, and three
hostile-critic cycles found eleven P1s of which *none* was the arithmetic —
every one was a surface that inherited the new rule without inheriting the
sentence that explains it, including two defects introduced by the previous
cycle's own fix.

## What happened

The change itself was small and right: a figure that says "you spent" counts
money already gone, so it stops at today. The engine work took one pass. Then:

- **Cycle 1 (6 P1s).** The /reports category table clamped; the chart four
  inches above it clamped too — and kept its own basis constant, its own empty
  sentence and its own net-refund sentence, all written before the rule existed.
  Result: "No posted spending in June 2026" over $400.00 of posted June
  spending, and "Returns in June 2026 outran purchases", blaming the reader's
  refunds for money the date rule had removed. Ask's basis line read as the
  complete rule while omitting the newest exclusion. A category the clamp
  emptied disclosed nothing at all, because the disclosure hung on a panel and
  the panel had been dropped.
- **Cycle 2 (3 P1s).** The page-level figure added in cycle 1 was computed as
  `wholeMonthSum − clampedSum`, and the summing engine floors each category at
  zero *independently in each window* — so one category's later-dated refund
  cancelled another's later-dated purchase, the page fell silent, and the panel
  directly beneath it still disclosed $400.00. The dashboard card, fed by the
  same loader, had inherited the clamp and none of the disclosure.
- **Cycle 3 (2 P1s).** The card fix narrowed the window label with the PAGE's
  held-back amount and handed it to panels that narrow with their OWN: "Jun 2026
  so far so far", and "so far" on a category that had held nothing back.

## The rules worth keeping

1. **When a rule changes what a figure counts, list every sentence that
   describes that figure — on every surface — before writing the fix.** The
   defect is never in the number; it is in the copy that was true yesterday.
   Grep for the basis constants, not just the engines.
2. **A disclosure hung on a per-item panel is blind exactly where the rule bit
   hardest**, because the rule can remove the item. Whatever level can vanish,
   put a copy of the fact one level up.
3. **Never compute a "difference" figure by subtracting two aggregates that were
   each independently clamped or floored.** Count the rows. Two floors do not
   subtract. (Written after making this mistake twice in one slice — the second
   time inside the fix for the first.)
4. **A narrowing applied at two levels applies twice.** If a child derives a
   label from its own state, the parent must not pre-derive it.
5. **Expect each critic cycle to find the previous cycle's fix.** That is not
   the critic being pedantic; a fix is new code and new code is unreviewed code.
   Budget for it rather than treating cycle 2 as a failure of cycle 1.

## The structural lesson

Two full cycles shipped user-visible copy that nothing could assert, because
this repo had no way to render a component in a test — so the fixes kept moving
the untestable decision around ("moving the string builder without moving the
render decision converts an unlocked sentence into an unlocked call to a locked
sentence"). The answer was to stop working around the gap and close it: a
component-render harness now exists, and the very next cycle it caught a defect
in its own predecessor's fix. **When two consecutive reviews blame the same
missing capability, build the capability.**
