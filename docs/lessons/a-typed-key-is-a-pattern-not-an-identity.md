# A typed key is a PATTERN, and every guard in the app was written for an identity

*One-line hook: giving the reader an authoring surface does not inherit the safeguards built for
inferred keys — a substring generalises to rows he has never seen, so the guards that protected an
exact merchant identity all had to be re-derived, and the sentences describing them were falser than
the code.*

O.13a shipped user-typed `contains` keyword rules. Two fresh-context critics with different lenses
(money/data-integrity; claims/privacy) both returned **FAIL** — 2 P0 + 7 P1 — and converged
independently on two of them, which is the strongest signal available that a finding is real. The
engine itself was clean; everything that broke was at the boundary where a *pattern* met machinery
written for an *identity*.

## The rule that generalises the whole cycle

Every existing safeguard assumed a rule's key was an exact identity the reader attached to one payee.
`cardone → income` is obviously right for the deposits on screen and obviously wrong for the
management fee that arrives next month. So:

- **The sign guard had to become universal.** A keyword rule was the ONLY auto-file path in the app
  with no #44 check, and the failure was not mis-labelling but **erasure**: `isSpendRow` drops
  Income-group rows, so an outflow filed as income deleted real spending from reports, trends and
  budgets while `monthlyFlows` still counted it as an expense. Two surfaces, one row, disagreeing by
  the amount, with no badge and no review.
- **The write scope had to become the product's, not the engine's.** The apply set was
  `{ account: { userId } }` — every row the user owns — where three sibling writers each carry five
  exclusions. It re-filed a detected transfer, a split parent, both split CHILDREN (a split child
  carries its parent's descriptor, so a hand-made allocation, the only record that it existed, was
  collapsed into one category), a review-pinned row, and investment/non-USD rows no register renders.
  Ask not "which rows match" but "which rows are the app's to decide".
- **Precedence needs a companion question.** Giving typed rules their own priority band was correct and
  insufficient: the pipeline's transfer tier returns *before* rules are read, so the preview counted
  rows the rule could never file. A new precedence band obliges you to walk the whole resolution order
  and ask what already wins.

## The first fix was wrong in the mirror direction

Applying the existing `learnedSignOk` to keyword rules looked like reuse and was a bug: that guard is
**symmetric**, so it also refused a positive row in a spend category — the documented refund
convention, where a return offsets the spend it reverses. The slice's own new lock caught it within
minutes. **Borrow a guard for its semantics, never for its name**, and when two rule kinds fail in
different directions they need different guards even if the code looks duplicated.

## The claims half was worse than the code half

- **A rationale shipped as a fact.** Three strings told the reader an empty rule "would match
  everything". The engine does the exact opposite and says so in capitals: `keywordsMatch([])` is
  `false`. "Absent this guard, a null merchantCanonical would mean any merchant" is a true
  *justification* and a false *description*. Comments may argue counterfactuals; user-visible copy may
  only describe behaviour.
- **Two changes in one session worked against each other.** The builder told the reader to check his
  spelling against "the transaction's original bank text" — which the register does not display, and
  which the same session's brand-coverage work moved further away, because `MACYS LENOX SQUARE` now
  renders as `Macy's` and never matches as typed (4 of 6 executed cases failed). Every improvement to a
  DISPLAY name widens the gap to the MATCH string. When two slices land the same day, ask what each did
  to the other's assumptions.
- **A capability with one caller is barely a capability.** `undoCorrections` had existed for months
  with the triage card as its only caller, so a one-click rewrite of months of filings had no undo
  anywhere in the product — while the server docblock called the rewrite opt-in "deliberately" and the
  UI defaulted it ON. Grep for a function's callers before assuming a UI can rely on it.
- **A doc can falsify itself within hours.** `SIMPLIFI_PARITY.md` was written and then contradicted by
  its own wave the same day (row 1 "MISSING" shipped; two schema line references moved by exactly the
  11 lines the new column added). The plan-verdicts-are-authoring-time lesson applies to the author, in
  the same session, not just to inherited docs.

## Test and process corollaries

- **A stale render is invisible to unit tests and to a passing e2e.** The page printed "Rule saved, and
  2 transactions filed" directly above "You haven't written any rules yet"; `revalidatePath` +
  `router.refresh()` did not reliably repaint, and the row sat in the database while the page showed the
  empty state for 20s. It only surfaced because the spec asserted the row appears *without* a reload.
  Assert the optimistic path AND the reload-confirmed one — they are different claims.
- **A load-sensitive assertion of your own looks exactly like an app flake.** This spec failed 3 of 4
  full-suite runs on a post-refresh count and passed every time it ran alone. The fix was an explicit
  wait budget, never a weaker claim.
- **Parallel critics, different lenses.** Both found the demo leak and the preview/pipeline mismatch;
  each found P1s the other missed. Serialize only for proving.
- **Heredocs still corrupt source.** Writing docs through a shell heredoc put four raw `0x08` bytes into
  `TASKS.md`; the control-byte gate caught them. Use the file tools, as the earlier lesson already says.
