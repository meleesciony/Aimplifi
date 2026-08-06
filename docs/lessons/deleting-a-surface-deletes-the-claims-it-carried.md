# Deleting a surface deletes the claims it carried — and the engine that composes them stays green

**One line:** #369 removed three cards from Home for good reasons and shipped verify-green, because
every engine still computed every sentence those cards used to print; the loss was invisible to unit
tests by construction, and a *comment on another page* went on delegating a case to a card that no
longer existed.

## What happened

`2e3bf72` ("Home polish", 2026-08-01) reordered the dashboard around the IWT loop and removed
`PaymentRemindersCard`, `RecurringSummaryCard` and `AskAimplifiCard`. All three became **orphaned** —
still compiling, still tested at the component level, imported by nothing. The commit ran 25 targeted
e2e specs and was green. The full suite was not run; `VERIFY_E2E=1` is opt-in.

Five days later K.1's full-suite gate surfaced ten deterministic failures. Nine were straightforward
re-points. The tenth thing nobody was looking for was this:

`frozenNothingDueNote` composes the sentence that names a frozen card, a frozen dated loan, or an
undatable frozen loan — the rows an "all clear, nothing due" claim cannot honestly cover. L.19 and
L.20 spent three critic cycles on it, and its sharpest finding (reached independently by all three
critics) was that the sentence must survive a **non-empty** list: one unrelated card being due must
not remove a frozen mortgage from the page.

The engine encoded that by composing the sentence unconditionally and splicing it onto
`NudgeFeed.emptyReason`. That was correct *while two surfaces rendered it* — the Today feed in its
empty branch, and the reminders card in its list branch. Deleting the reminders card deleted the
non-empty branch, and the exact defect L.20 existed to fix came back. Not by editing the engine. By
deleting a renderer.

Nothing could catch it:

- **the engine stayed green** — it still composed the string, correctly, and every assertion about
  it still passed;
- **the engine had no coverage of that input at all** — `frozenDues` appeared in the nudge test file
  only as `frozenDues: []` in a fixture builder, so the composition had no lock of its own;
- **the e2e that would have caught it was red for a different-looking reason** ("payment-reminders-card
  not found"), which reads like test debt, not like a lost disclosure.

## The second half: prose delegating to a deleted surface

`cards-breakdown.tsx` deliberately narrows its frozen all-clear to cards, and said so:

> `/cards` lists cards and nothing else, so this set cannot contain a loan (TASKS L.19). The two
> surfaces whose all-clear covers both are the dashboard reminders card and the weekly digest.

That is a **cross-file invariant with nothing enforcing it**. The moment the reminders card was
deleted, this narrowing was justified by a surface that did not exist, and the weekly digest email
became the only place in the entire product where a frozen loan's all-clear could reach anyone.

Grepping for a deleted component's *imports* finds zero call sites and reads as "safely orphaned."
Grepping for its *name in prose* finds the claims other files were leaning on.

## The rules

1. **When you delete a render site, list the claims it was the only renderer of.** Not the props it
   took — the sentences it put on a screen. For each, name the surface that now carries it, or record
   that none does.
2. **A qualifier that is exclusive with an all-clear may not live inside the all-clear's own
   sentence.** If it is owed to the reader whether or not the all-clear shows, it is a separate field
   the surface renders unconditionally. `fundingFrozen` — the other half of this very disclosure —
   had been exactly that since L.20; `frozenDueNote` stayed a substring only because a second
   renderer happened to exist.
3. **Grep the repo for the deleted component's NAME, not just its import.** Comments that say
   "surface X handles this case" are invariants, and they are the last thing to be re-read.
4. **A composition with no engine-level lock can lose its only renderer in silence.** If an engine
   composes a sentence, one test must assert that sentence for a non-trivial input — otherwise the
   whole feature is load-bearing on a UI test whose failure will be read as a stale selector.
5. **`VERIFY_E2E=1` is where surface-loss shows up.** A commit that deletes render sites and runs
   "25 targeted e2e" has verified the specs it thought about. This is the third time a shipped
   fence/removal left the full suite red without anyone seeing it (see
   `fencing-a-write-path-breaks-the-tests-that-drove-it`).

## Also found, same shape

- `/recurring`'s **only** link in the whole app lived on the deleted `RecurringSummaryCard`. The
  route still exists and is still reachable from a transaction's detail view and /spending-plan, but
  it lost its nav-level entry point and nothing said so.
- Two `phase2-triage` failures in the same red set were **not** #369 at all: O.17's demo fence on
  `createCustomCategory` refuses the shared demo user, and both tests drive the write-in as demo.
  The K.5 task row attributed all ten failures to #369; one row of attribution, written from the
  commit rather than from the failures, sent the next reader at the wrong cause. **Reproduce before
  you inherit a diagnosis** — and note that serial mode hid the second of those two behind the first.
