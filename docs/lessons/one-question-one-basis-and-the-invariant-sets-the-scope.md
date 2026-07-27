# One question, one basis — and a documented invariant is what sets your scope

**Summary:** three surfaces answered "how much did I spend on groceries this month" over three different
row sets, invisibly, because they are never shown side by side; unifying them was easy, but the thing that
decided how big the change had to be was a COMMENT — `computeLargest` claiming it "matches Ask's
`largestPurchases` EXACTLY". Changing one side of a stated invariant obliges you to move the other side or
retire the claim; you do not get to leave it false. (O.6, DECISIONS #327.)

## The shape of the defect

A "basis" is which rows a figure is summed over: status, account scope, currency, reconciliation, how a
null category is bucketed. Aimplifi had ONE engine (`spendingByCategory`) and four call sites that each
shaped the snapshot themselves before calling it — so the engine was shared and the *answer* was not.
`/reports` and Ask counted POSTED+PENDING; `/trends` counted POSTED only and invented a category for
unfiled rows from the merchant descriptor; `/budgets` counted POSTED only and forgot the account-type
filter entirely, so a loan or brokerage charge could land in a budget.

Nobody reported it in four sessions of looking, because **two surfaces disagreeing is only visible when
something invites you to compare them.** A deep-link is exactly that invitation, which is why the previous
slice's critic found this and no reader did.

## The rules that came out of it

**One question answered differently on different PAGES is the sin. Different questions using different
bases on ONE page is not.** After the fix `/trends` counts pending in its category figures and refuses it
in "biggest purchases" — because an aggregate over a window that includes a provisional amount is a closer
estimate, while "your biggest purchase was $900" about a pre-authorisation is a false sentence. That is a
real distinction, not a loophole, and it survives only if each section states its basis (L.29).

**Choose the basis by failure direction, not by symmetry.** The `/budgets` remainder ("$87.70 left this
month") is an INSTRUCTION, so omitting committed-but-unsettled money makes it too generous and the failure
is an overspend. A pending amount can still change, but including it errs by the DIFFERENCE where
excluding it errs by the WHOLE amount — so including is never the worse error. Note the uncomfortable
direction too: adding the missing account-type filter REMOVES rows and makes the remainder more generous,
which is correct only because those rows were never spending.

**A stated invariant sets the scope of your change.** Two comments were load-bearing: `computeLargest`
"matches Ask's `largestPurchases` EXACTLY", and `server/trends.ts` claiming its numbers "can't drift from
/reports" (already false when written). The first turned a two-file slice into a five-file one — both
sides had to move together, and `TrendTxn.status` became REQUIRED so the split lives in exactly one
place. Grep the diff for every confident claim near what you touched; the invariant you break silently is
worse than the one you never had.

**Then sweep the data class (L.21).** The descriptor-guessing defect removed from `/trends` was living a
second life in Ask's `toPurchaseRows`. Fixing one instance of a defect you can name is not fixing it.

## Two process corrections worth keeping

**Verify the file you think you are reading.** I grepped `prisma/seed.ts` for `PENDING`, got zero, and
concluded no demo golden could move — a load-bearing claim about blast radius, and wrong: the dataset is
built by `src/lib/seed/build.ts:539-541` and holds three pending rows. The typechecker dragged me through
the test that disproved it. "I checked" is only worth something if you checked the thing that decides.

**A golden that moves is the deliverable, not the damage.** Exactly one pin changed, by exactly the three
seeded pending rows ($299.93) to the cent. Hand-verify the delta and write the derivation into the pin; a
golden updated without an arithmetic reason is indistinguishable from one updated to go green.

## Fence notes

Make the shared thing a TYPE, not a convention: the required `status` field meant `tsc` enumerated every
caller, and no production call site was missed (only fixtures broke). Where a link asserts a figure, make
the figure a required argument — a `/trends` mover prints a delta, a three-month baseline AVERAGE and the
month total, and only the last is a set of rows any window can reproduce, so a positional signature would
have accepted the wrong one in silence. And refuse a link on a ZERO figure: a true zero and a
defect-produced zero look identical, so offering an empty register as "confirmation" is the failure
direction worth declining.
