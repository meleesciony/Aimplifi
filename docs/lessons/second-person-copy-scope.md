# Second-person copy is a load-bearing invariant, not a style choice

**One-line summary:** `reminderLine`'s "you'll pay $600.00 yourself" was *true* only because that
line had only ever rendered the reader's OWN card. The joint household digest (slice 7) fed it a
**partner's** card and the same unchanged string became a false money claim — telling one partner
they must personally pay the other's bill, inviting a double payment. When a new surface widens
whose data flows into an existing copy string, every sentence must be re-read for its implied
subject; the string did not change, but its truth conditions did.

## What happened (TASKS 4.2 slice 7, critic F1 — P1, caught pre-merge)

`selectPaymentReminders` was given household-scope obligations (the slice-4 merge: the viewer's
cards + the partner's SHARED cards). The dues then rendered through the SHARED `reminderLine`,
which is second-person by construction:

- `you'll pay ${userActionCents} yourself`
- `autopay will handle it — just keep the funds in your account` ← points at the WRONG account

Every layer was individually correct: the merge is scope-safe (T1 holds, no private account leaks),
the arithmetic is right, and `reminderLine` is exactly the string the reminder email and the in-app
card have always used. The defect lived in the *seam*: a shared renderer whose correctness depended
on an unstated precondition ("the account belongs to the reader") that the new caller silently broke.

The fix was not to change `reminderLine` (its personal callers are still correct) but to give the
household path its own owner-attributed line (`HOUSEHOLD_COPY.digestPartnerDue`) and to document the
precondition in `reminderLine`'s docstring so the next caller sees it. The owner-label map covers
shared accounts of **every type**, not just the spending types — a shared LOAN reaches the digest via
`loanObligations` and would otherwise have fallen through to the same false line.

## The generalizable rule

1. A pronoun is a claim. "You", "your account", "yourself" each assert a relationship between the
   reader and the data. Reusing a string in a wider scope re-asserts that claim about data it was
   never written for.
2. When widening what feeds an existing renderer, grep the renderer's strings for first/second-person
   pronouns and possessives before wiring it up — that is a 30-second check that would have caught
   this at design time.
3. Encode the precondition where the next person will hit it: a docstring on the renderer naming who
   may render it, plus a copy-guardrail test asserting the banned phrasings can never appear on the
   widened path (`tests/unit/household-copy.test.ts` → `PARTNER_DUE_BANNED`).
4. This is the copy-layer twin of `multi-actor-field-scoping.md` (widening `Correction.userId` from
   "the owner" to "the acting user" required re-auditing every consumer). Same shape: a field or a
   string whose meaning was pinned by a single-actor assumption, widened without re-auditing the
   consumers that quietly relied on it.

## Why the fresh-context critic caught it and the implementer did not

The implementer had just built the merge and knew the numbers were right, so the dues section read as
"already-verified territory" and attention went to the genuinely new movement summary. A critic
reading the rendered email as a *user* — with no memory of which layer was trusted — saw a sentence
telling someone to pay a bill that is not theirs. Cheap insurance; run it on any surface that mails,
displays, or speaks money.
