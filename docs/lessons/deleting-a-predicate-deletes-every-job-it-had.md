# Deleting a predicate deletes every job it was doing — including the ones its name doesn't mention

**One line:** O.7 correctly moved `merchantSpend` onto the shared spending basis and, in doing so, gave
away a pseudo-merchant guard nobody had ever written down, because it lived inside a category-group
exclusion whose name only advertised the *other* job — so Ask started answering "You spent $49.27 at ATM
Withdrawal this month" on the demo dataset every anonymous visitor sees.

## The change that was right

Ask answered `merchant_spend` ("how much did I spend at Whole Foods this month") POSTED-only and GROSS,
while `spend_by_category` ("how much did I spend on groceries this month") ran `spendingByCategory` —
pending included, refunds netted. Twenty-five lines apart in the same `switch`. If one merchant is a
category's only member, those two questions are about *identical money*. That is O.6's sin living inside
a single surface instead of across two pages, which is why four sessions of looking at O.6 never saw it:
the two answers are never rendered side by side.

The fix held up under both critics: an **aggregate over a window** reads the register basis; a statement
that **names one row as a settled fact** does not. `merchantSpend` and `largestPurchases` are now the two
sides of that rule rather than two callers of one narrowing, and the shared builder narrows nothing.

## The part that was wrong, and why re-reading my own reasoning could never have found it

`isPurchaseRow` rejected the whole `Transfers & Other` group. I *did* enumerate that admission and I *did*
reason about it — and I cleared it on the wrong axis:

> "the register would show these rows too, so counting them is consistent."

True of the **rows**. False of the **name**. `Transfers & Other` holds `cash`, `credit-card-payment`,
`transfer` and `uncategorized`, and every aggregate pseudo-merchant the normalizer produces — Zelle, Venmo,
Check, Cash App, Apple Cash, PayPal Transfer, ATM Withdrawal, Account Transfer, **Unknown Merchant** — maps
into exactly those ids. So the group exclusion had been doing two unrelated jobs under one condition:

1. keeping non-purchases out of "your biggest purchase" (the job its comment named), and
2. keeping merchant questions off names that are not stores (the job nobody named).

I asked *"does this row belong in the total?"* and never *"is this name a store?"*. The second question
does not arise from the diff, from the predicate, or from any comment — only from asking what the deleted
condition was **load-bearing for**, class by class.

The failure direction is what makes it worse than an imprecise sum: "Unknown Merchant" is the collapse
target for every unrecognised descriptor, so that query totals dozens of unrelated payees under a
fabricated merchant name. And with no sign guard, a two-way app payment inverted: an Apple Cash send
netted against an Apple Cash receipt produced *"Refunds at Apple Cash exceeded purchases by $60.00"* —
a refund nobody sent.

## Rules

- **When you delete or replace a predicate, enumerate what it EXCLUDED, class by class, and name the
  guard that covers each class now.** "The new predicate is correct for its purpose" says nothing about
  the purposes it was never designed for. A condition with one name can hold several invariants.
- **Reconciliation arguments are about rows; fabrication arguments are about names.** "The register shows
  this too" licenses including a row in a total. It never licenses printing a *label* — no category is
  called "ATM Withdrawal", so no reader can put the two side by side, and the aggregate split was never
  part of the money basis at all. That is also why fixing it cannot re-open the basis question.
- **Restore a lost guard by NAME, not by restoring the old condition.** `aggregateMerchant`, carried from
  `normalizeMerchant().aggregate` (the signal `/trends` already gates on), is strictly better than the
  group exclusion it replaces: it refuses the pseudo-merchants *and* still counts an unfiled charge at a
  real store, so O.6's "unfiled Chipotle vanished" P0 stays fixed. Checking a critic's counter-example
  sharpened this — "Store Card Purchase" is deliberately NOT aggregate (`trends.ts:87-89`), and a coarse
  group filter would have wrongly refused it.
- **A refusal is not a denial.** The pre-existing behaviour was "No spending at Atm this month" about real
  cash in the register. Restoring that would not have been a regression, but it is still a false denial;
  the honest form names what it found and why it can't total it.

## Corollaries earned the hard way in the same slice

- **Widening a basis makes every gate it used to skip load-bearing, and every sentence it used to fit
  false.** A NET headline needs refunds listed signed and named in the detail; PENDING needs disclosing
  inline and **split by direction** (Plaid emits pending *credits*, so one netted figure called a pending
  refund a "pending charge"); a `$0` verification hold is neither a purchase nor a refund (`c >= 0`
  counted it as one and produced three false clauses about a merchant with no refunds); and a
  non-positive total is *five* distinct facts, not one shared "no spending".
- **Verify a sentence you are copying, not just one you are inventing.** I lifted "credit-card payments
  are excluded" from the neighbouring `NET_SPEND_BASIS`, then checked: `isSpendRow` excludes transfer-
  *flagged* rows and the `transfer` id, but not the `credit-card-payment` category, which Plaid assigns
  directly (`plaid-map.ts:420`). The clause was false in both places — the pre-existing copy had just
  never been checked.
- **An engine fact is not a user-visible fact until a query reaches it.** I claimed the demo answered "No
  spending at Amazon" and an e2e run falsified it: `resolveSpendTarget` runs first and the deliberate
  Amazon→shopping synonym (#168) routes that phrasing to a *category* answer. The engine behaviour was
  real; the sentence about the reader was not. Reach for the surface before claiming what the reader saw.
- **Changed money COPY needs locks exactly as much as changed money MATH.** Both critics flagged that the
  corrected basis strings had no test, i.e. #328's revert-safety finding repeating one slice later on the
  strings instead of the predicate. Restoring a false clause has to fail something.
- **Make the shared thing a TYPE so tsc enumerates the callers** (O.6's rule, and it paid twice here):
  `status`, `merchantCategoryId` and `aggregateMerchant` as REQUIRED fields walked me through all eight
  construction sites. It does not make the answers correct — one of those fixtures answered
  `categoryId: null` where production always stores a category, which made the seed-grounding test
  *less* faithful than the one it replaced, and only an executed production-shape comparison caught it.
- **Rename the thing whose name caused the bug.** `toPurchaseRows` feeding an aggregate read as a licence
  to inherit the purchase rule. A builder that narrows nothing should not be named after one narrowing.
