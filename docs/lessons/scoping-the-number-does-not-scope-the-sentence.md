# Scoping the number does not scope the sentence

**One line:** when a new surface needs a narrower version of an existing set, the hard part is
not narrowing the set — it is that the copy you inherit alongside it still contains predicates
whose subject is the OLD scope, so a correctly-scoped count ends up asserting something about a
world it was never counted over, and the two surfaces then contradict each other in front of the
same reader.

**Where it was paid for (U.23, DECISIONS #457, 2026-08-12).** The transactions CSV needed to
disclose what the currency guard (#135) kept out of it. The app already had that disclosure
family — a page banner (#141) and an inline note (#150) — both fed by
`getWithheldAccountSummary`, which counts EVERY non-USD account the reader owns, of any type.
The export cannot use that count: a euro brokerage is out of the CSV for a reason that has
nothing to do with currency (#62), so announcing it as withheld FROM THIS FILE would be a new
false statement. That much the slice got right, and deliberately: it built
`getWithheldRegisterAccountSummary`, scoped to the file's own basis, with a docstring citing the
U.16 panels lesson about sets carrying the scope they were built for.

Then it wrote the note by adapting the banner's sentence, and kept this clause:

> …an account in EUR **is left out of every total the app shows**…

Two fresh-context critics, on different axes, produced the same finding independently, from the
slice's own test fixture — a euro checking account plus a yen brokerage:

* the reader's screens say **"2 accounts not included — not in U.S. dollars"** (app scope, right);
* the reader's exported file says **"an account in EUR"** (file scope, right) **"is left out of
  every total the app shows"** (app scope, and now false — two accounts are, and JPY has silently
  vanished from a sentence promising to describe what the app excludes).

Nothing was wrong with the number and nothing was wrong with the sentence. The defect was
entirely in the join: a file-scoped count spent on an app-scoped predicate. #141 had made
non-disagreement between the withhold and its disclosure the design rule for this family, and the
slice broke it inside the very author written to honour it — while its own test locked the
divergence in with `expect(csv).not.toContain('2 accounts')`, in the one fixture where the banner
says exactly that.

**The rule.** Re-scoping an input is half the work. Walk the sentence clause by clause and ask of
each one *what set is this predicate quantified over?* — then check that set is the one you
narrowed to. Where a clause genuinely needs to speak about the wider world, state it as a RULE
carrying no count ("Accounts that aren't in U.S. dollars are left out of Aimplifi's totals for
the same reason") rather than as an enumeration, so no number can be read off it. The fix is
cheap; finding it after ship is not, because both surfaces are individually correct and only
contradict each other in the hands of a reader holding both.

**How it was locked.** `regression__u23_totals_clause_states_a_rule_not_a_count` asserts the
app-wide sentence contains no digit at all (`totalsClause.not.toMatch(/\d/)`), and the
brokerage-scope test now asserts the banner's count for the same fixture is 2 while the file's
is 1 — the disagreement recorded as intended behaviour rather than left to be rediscovered as a
bug.

**Related:** [`sharing-a-basis-is-not-sharing-a-scope`](sharing-a-basis-is-not-sharing-a-scope.md)
(the same split one level down: same rows, different membership rule),
[`a-disclosure-is-several-claims-in-one-sentence`](a-disclosure-is-several-claims-in-one-sentence.md)
(why clause-by-clause is the only reliable pass), and
[`a-disclosure-written-for-a-page-is-false-in-an-email`](a-disclosure-written-for-a-page-is-false-in-an-email.md)
(the same slice also had to re-anchor "stay saved" to name Aimplifi, because in a downloaded file
an unplaced promise of persistence acquires the file as a second referent).
