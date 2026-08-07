# A zero is a claim, and a figure that cannot look wrong cannot be reported wrong

**One line:** four different facts — "you own no cards", "your statements are all dated past this
month", "you never set up savings", and "an upstream defect dropped every bill" — all rendered as
`− $0.00`, so the owner read the broken one four sessions running and had nothing to report; the fix
is to make each zero name its own basis in the label and to give a zero that means *you have not set
this up* the control that sets it, while refusing to name a basis the code cannot prove.

## What happened

L.26's projection defect showed on /spending-plan as "Fixed & recurring expenses — $0.00". Two other
lines on that same panel were ALSO $0.00 and both were correct. Nothing distinguished them. The
owner looked at the panel repeatedly and could only report that a number "looked wrong", because a
correct zero and a broken zero are the same pixel — and three sessions were then spent optimising
hypotheses about which mechanism might be producing it
(`three-sessions-of-hypothesis-one-query-of-evidence.md`).

## The rules that came out of it

1. **Every `$0` in a money UI is a claim, and the claim is not "zero".** It is one of: *nothing
   qualified*, *you have not set this up*, or *we lost something*. Rendered identically, the reader
   cannot report the third, and a defect becomes unobservable to the only person who can see it.
2. **Say which zero it is where the zero is** — in the label, not in a paragraph three sections
   down. This repo already had the idiom on one row (`Income (no pattern yet)`) and had written the
   rule in a comment (*"a $0 row would name a mechanism that did not act"*) and applied it to one of
   five rows. Look for a rule you have already written and count the rows it reaches.
3. **A zero meaning "not set up" gets a control; a zero meaning "nothing qualified" gets none.** A
   link beside a correct figure reads as a correction — it tells the reader something is wrong when
   nothing is.
4. **Name only the basis you can prove.** The tempting label was "none detected"; the truthful one
   is "none counted". A bill charged to a credit card is detected and correctly unprojected, a
   lapsed series is detected and correctly unprojected, and the defect's dropped rows are
   indistinguishable from both without re-running the scope predicate that decides projection. A
   label that overstates its knowledge re-creates the false all-clear the slice exists to remove —
   so state the mechanism you can prove and point at the surface where the cases differ.
5. **The same rule applies to the sentence beside the row.** Two basis sentences explained an
   arithmetic ("a weekly bill counts 52/12 each month") and an assumption ("assumes each is paid in
   full") to readers whose terms held nothing. Gate them — but SPLIT first: the half that is true
   for every reader ("discretionary spending is never subtracted") is what stops a $0 line being
   read as "nothing I spend counts anywhere", and gating it away would remove the fact the zero
   most needs.
6. **A tie-break field is not a fact once the figure is zero.** `savingsSource` is
   `target > goals`, which resolves 0 vs 0 to `'goals'`, so a reader whose only savings input was a
   Settings target was told his (non-existent) goals decided the line. At zero, ask the input that
   exists, not the comparison.
7. **Duplicated copy drifts, and a per-copy test certifies the drift.** The four labels lived in two
   builders (the trace panel and the Ask answer) and had already diverged — `Savings target
   (Settings)` against `Savings target (from Settings)` — each pinned by its own passing test. Give
   the strings ONE author and lock the two SURFACES against each other; a test comparing a copy with
   itself cannot fail.

## What the two critics added (both FAIL, converging on the same row)

8. **A label naming a FACT must be keyed to that fact, not to a figure that correlates with it.**
   The card zero branched on `obligationsBeyondMonthCents` — a money term netted against scheduled
   income — to decide whether a payment was *dated* later. It nets to zero exactly in the
   commonest issuer pattern there is (paid the 1st, cards due the 3rd), so a reader with a $1,000
   statement three days out was told "none due this month". A net of zero is not an absence.
9. **Rank the branches by the strength of the claim, and make the strongest one reachable last.**
   "None due" asserts an absence of demand and is the only wording that invites spending; it may be
   printed only after every way of NOT KNOWING (a card we could not date, a statement not yet
   generated, a card the snapshot never contained) has been ruled out. Where one of those is
   present, the honest word is "counted", and the panel's other sentences already say why.
10. **Open the destination before offering a control.** The "goals contributing nothing" zero
    offered "Set a monthly amount on a goal" → /goals, and no such control exists anywhere in the
    app. Offering a remedy that is not there is worse than offering none: the reader stops looking
    for the real one. And if a distinction changes the words but not the remedy, do not make the
    distinction — the goal count went away with it.
11. **A count is only as true as the set it comes from.** "No credit cards linked" was read off the
    snapshot, which withholds every non-USD account — so a reader with a CAD card was told, in
    words, that he has no card. A claim about what the reader HAS must be counted from what the
    reader has, not from what this month's computation happened to receive.
12. **Gating a shared sentence is worth nothing while a second copy is unconditional.** The page's
    closing paragraph reprinted both gated claims one paragraph below the gate.
13. **The sweep is bounded by "every surface that prints a component of this figure", not by
    "every place these strings appear".** `/budgets` re-partitions the same plan into buckets and
    printed the same unexplained `$0.00`, on a route the first pass never opened.

## The check that proves it, and cannot degrade

The unit tests assert labels per state; the e2e reads the RENDERED page, requires every `$0.00` row
to carry a parenthetical reason, **and requires at least one zero row to exist** — without that last
assertion the lock passes vacuously on any fixture that happens to have no zeros
(`a-passive-gate-cannot-see-what-fits-in-the-gutter.md`, the same corollary).

**But "a parenthesis is present" is a shape, not a claim, and the first version of that e2e could
not fail.** The demo user has exactly one zero row, and its PRE-fix label — `Planned savings
(goals)` — satisfies the same regex, so a full revert stayed green; meanwhile the fixture that
renders three of the new labels at once (a throwaway user with one card dated past the month's
edge) had no assertion at all. A generic shape assertion belongs beside a per-label one on the
fixture that actually exercises the feature, and both must be mutation-proven **at the e2e level**,
not only in units: revert the label, rebuild, and watch the specs go red.

Mutate in both directions: reverting the labels must fail tests, and offering the control
unconditionally must fail others. Here both did (4 unit mutations + 1 e2e mutation, all killed).

## Second instance, on a different surface — the register (K.3, #417, 2026-08-06)

The owner set a custom window of Aug 6 2024 → Aug 6 2025 on /transactions, whose
history starts Mar 25 2026, and got `$0.00 / $0.00 / $0.00`, "0 transactions",
and **"No transactions match these filters."** — with **"History available from
Wed, Mar 25, 2026."** four lines above. The page was already holding the reason
and a different sentence was doing the talking. He reported it as "we have no
trailing data in transactions", which was true of the DATA and unknowable from
that screen.

What this instance adds to the rules above:

* **Rule 2 has a sharper form: the box under the zeros is not "where the zero
  is."** The first version of the fix explained the emptiness in the empty-state
  box, beneath all four figures the owner had named. A critic rejected it. The
  naming clause has to ride the count line, next to the tiles.
* **Order the branches by how little they need to consult.** `from` after `to`
  is empty *whatever the data is*, so it must be decided before any branch that
  explains emptiness by the data — otherwise the reader is told to import older
  history for a window that would still be empty afterwards. Rank causes by
  independence, not by which one you built first.
* **Rule 10's remedy test applies to the READER, not the app.** The fix offered
  "Import a CSV from your bank"; `importTransactionsCsv` refuses the demo user,
  and on production every anonymous visitor *is* that user. The remedy existed
  and was unavailable to almost everyone who would see the sentence.
* **A corrective sentence inherits the scope of the value it quotes.** The bound
  is read off a set narrowed to spending account types and USD and NOT narrowed
  by the reader's own account filter — so the copy says "history here", never
  "your history".
* **And the same defect can survive the fix one filter away** (recorded as K.4):
  a reader narrowed to one card who picks "Last year" lands back on the original
  broken pair, because the bound is printed at one scope and the zero computed at
  another.

## Third instance, same surface, one day later — the filter with no control (2026-08-07)

The owner sent one screenshot and three words: **"Still not showing up."** The register read
`0 transactions`, `$0.00 / $0.00 / $0.00`, and **"No transactions match these filters."** —
with **"History available from Wed, Mar 25, 2026."** four lines above it, and Type, Account,
Category, Class and Period all displaying their defaults, both date boxes empty, the search
box empty.

The screen contained its own proof that it was lying: a **"Clear" link**. That control renders
on exactly the predicate the page uses to switch its standing copy to "Showing a filtered slice
of your transactions". So a filter was on, and no control on the page held it. Reading the
predicate against the bar showed why: `?merchant=` was in `hasFilters` and had **no control at
all** — the one axis of ten that the reader could not see, set from a dozen surfaces (register
rows, the lens, /recurring, /trends, the coach), matched EXACTLY against the display name, and
therefore capable of returning zero forever.

What this instance adds:

* **An axis a page can filter by is an axis the page must render.** The gap was not unknown —
  `links.ts` had written it down ("the fence would have to be a merchant control on the
  register, which is a UI task and is queued as one") and the reimbursement chip had already
  been through a critic for the identical reason ("a filter the bar denies is a dead end
  wearing a page"). A known gap with a queued ticket is still shipped behaviour. Prefer the
  general lock — *every* member of the predicate, table-driven — over one more chip.
* **A zero cannot be explained by a set the reader cannot see.** "No transactions match these
  filters" is the correct sentence only if the filters are legible. Against an invisible filter
  it is worse than silence: it names a cause and points at controls the reader can verify are
  innocent, so the honest conclusion available to them is "the app is broken" or "my data is
  gone". Both were wrong, and one of them was the owner's.
* **Rank the branches by independence — again.** The merchant branch sits BELOW the three
  window branches, because a window that ends before the first row is empty whatever the
  merchant matches, and the date bounds are read off the register's own set.
* **A remedy for a filter the reader did not set is a link, not an instruction.** Whoever meets
  this sentence has already failed to find the control; "Show all transactions" gets them out
  in one tap, and the chip tells them what was excluded on the way.
* **Report-to-cause was one screenshot, because the page carried a discriminator.** The Clear
  link, the history line and the five defaulted controls were jointly consistent with exactly
  one state. That is the payoff of rules 1–2 compounding: the previous fix (printing the
  history bound) is what made this screenshot decidable without a database query — worth
  remembering when a disclosure looks like it is only for the reader.
