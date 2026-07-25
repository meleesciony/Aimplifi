# A disclosure is several claims wearing one sentence — and they can be true and false independently

**One line:** L.18's partner bug was fixed three times in a row because each fix corrected one
clause — the subject, then the possessive, then the remedy — while the others went on asserting the
assumption the sentence was written under; and the sentence itself only reached the surfaces at all
because the FACT was made to ride the money instead of the string being pasted per surface.

## The setup

L.14 established that an account whose bank has stopped sharing it keeps counting **by design**, and
disclosed that on /accounts and the dashboard. The two *dependent* cases — a card's own obligation
and the funding account a projection walks from — were disclosed once, in the cash-needed engine's
`assumptions`, under a code comment stating that array reached "/cards, the dashboard hero, the
calendar, the Ask answer and the weekly digest."

Two surfaces render it. **The four the comment named as covered were four of the ones that were
silent.** A comment asserting coverage is worth nothing until the callers are grepped — the same
trap this repo has now recorded three times, and the reason L.18 existed.

## What actually made the disclosure reach the surfaces

Not a shared string. `frozenSince` was put on the OBLIGATION (`CardObligation`,
`UnknownDueDateCard`, `LoanObligation`, `PaymentReminder`) and `fundingFrozen` on the result, all
required. Every surface that prints one of those amounts already holds that object, so the fact
arrives with no new query, no new argument, and nothing a caller can forget. A shared *sentence*
reaches only whoever happens to render the array it lives in; a shared *fact* reaches everyone who
touches the money.

**Carry the fact with the money. Let each surface write its own sentence.**

## The clauses, and why fixing one is not fixing the sentence

A single qualifying sentence turned out to be six independent claims. Over two critic cycles the
partner case had to be corrected in three separate passes, each time because the previous fix had
addressed one clause and left the rest:

| Clause | What it asserts | How it broke |
|---|---|---|
| **Subject** | *"**Your bank** stopped sharing…"* | It is the partner's bank; the reader has no relationship with it |
| **Mechanism** | *"…nothing that has happened on **the card** since… against **this statement**"* | A frozen LOAN has no statement, and nothing subtracts payments from a loan obligation at all |
| **Possessive** | *"…including any payment **you have already made**"* | The payment on a partner's card is theirs |
| **Imperative** | *"**Check the card with your bank before paying**"* | Addressed to whoever pays — and the reader is not |
| **Remedy** | *"**Accounts** shows the connection"* | Their /accounts does not list a partner's connection |
| **Scope** | *"…is in **these figures**"* | Which figures? See below |

The first cut fixed the remedy (a `'partner'` next-step) and shipped a sentence that said *"check
the card with your bank before paying. Only the household member who owns it can reconnect it."* —
an instruction pointing one way and a remedy the other, inside one paragraph.

**The rule:** when a disclosure is reused across a widened data class, enumerate its clauses and ask
each one separately who it is about. Ownership in particular is a property of the ROW, not of the
call site's choice of arguments — put it on the row and let the builder decide, or the next call
site will get it wrong.

## Where a caller genuinely cannot know, name the ignorance

The cash-needed engine is pure and is handed a household-**merged** account list with no ownership
on it. Given a boolean it would have had to assert *something*. A third state (`'unknown'`) lets it
say "the bank" instead of "your bank" — and, once the second critic pointed out that the fix had
stopped at the subject, lets it decline to name a remedy it cannot know the reader can reach.

A defaulted `false` there would have been the silent-failure this codebase keeps re-learning. **A
tri-state that names the ignorance is honest; a default that hides it is not.**

## Resolve against the set the SURFACE renders — which may be larger than the set the total sums

Cycle 1 found the engine naming a frozen card that was in no figure at all (an undatable card, in
`unknownDueDateCards`, contributing $0) as the source of *"the amount asked for here"*. The fix
resolved the claim against `due` — the rows summed into `requiredCents`.

Cycle 2 found that **the fix over-shot**. `upcoming` holds the estimate-path obligations, whose
amount *is* the frozen balance verbatim, and the dashboard hero prints them as "est. — next cycle"
right beside a surviving assumption that names that figure and calls it "the current balance". Before
the fix the card was named; after it, it was not.

"Resolve a claim against the set it describes" is the right rule, and *the set is what the surface
renders*, not what the headline sums. A narrowing fix needs its own boundary tests in the direction
of the narrowing, not only in the direction of the original bug.

## Test a disclosure by mutating it in BOTH directions

A feature whose output is a caveat has two failure modes, and a suite that only proves it speaks
catches one of them:

* **silence** — silence every builder: 19 assertions failed, so the positive claims are load-bearing;
* **false hedging** — make every builder speak unconditionally: 6 assertions failed, so the
  abstentions are load-bearing too.

On an instruction, a false hedge is the more expensive direction: a reader told the amount might be
inflated under-funds, and the payment bounces. The abstention tests are what stand between a
disclosure and that, so they belong in the majority — and one of them found a residual no critic
did (after the per-row email sentence was made partner-safe, the block's title and closing line
still said "your bank").

## Corollaries worth keeping

* **An audit panel is the worst place to be silent, and the worst place to be wrong.** A reader opens
  the derivation panel precisely because they doubt the number, and every row is green-checked. The
  reconciliation must stay TRUE — the rows really do sum to the headline; whether a balance is
  current is a different question, and failing the check would claim a drift that does not exist and
  hide the audit trail behind an unreconciled banner. The disclosure rides `basis`, not `reconciled`.
* **Two advisories on one push body compete for the same truncation budget.** Fixing the ordering in
  one branch and introducing the identical demotion one branch down, in the same pass, is how a
  shipped decision gets silently reversed. Rank by which warning a reader can act wrongly on *now*.
* **A projection's starting balance is more load-bearing than anything it walks over.** L.14 taught
  the radar to withhold a frozen account as a transfer *source* and stopped there; the balance the
  walk starts FROM decides whether there is a dip at all, when it lands, and how large the transfer
  is — and its frozen-high case produces no alert whatsoever, which is the quiet, expensive
  direction. When a fix guards one use of a value, enumerate the others in the same function.
* **Check the brief against the code.** L.18's own task text said the frozen balance drives the FI
  number. It does not — `fiNumberCents(annualExpenses, swrBps)` reads no balance at all, and a test
  now holds a frozen $4,210.55 brokerage beside an FI number of $0.00. Qualifying it would have
  attached a caveat to a figure the account does not touch.
