## §Household Digest Movement (DECISIONS #220 — TASKS 4.2 slice 7, `summarizeSharedMovement`)

`summarizeSharedMovement({ rows, accountCount, since, today })` tallies the household's
SHARED-account activity for the joint digest. Pure; mirrored in
`tests/unit/household-digest.test.ts`. Window is INCLUSIVE at both ends; the cron passes
`since = today - 6` so the window is exactly 7 calendar days ending today.

- **Window boundaries (inclusive):** `since` = 2026-06-04, `today` = 2026-06-10. Rows on
  2026-06-04 (−$10.00), 2026-06-07 (−$240.55) and 2026-06-10 (+$500.00). **Expected:**
  `transactionCount` = 3, `outflowCents` = 25055, `inflowCents` = 50000. Both boundary dates
  count; 2026-06-03 and 2026-06-11 do not.
- **Exclusion set (the same one every other money surface uses — `coach.ts`, `radar.ts`,
  `engine/transactions/query.ts`):** in-window rows of −$800.00 `isTransfer`, −$700.00
  `isSplitParent`, −$600.00 `status: 'PENDING'`, and one real −$25.00 spend. **Expected:**
  `transactionCount` = 1, `outflowCents` = 2500, `inflowCents` = 0. A transfer is neither
  spend nor income; a split PARENT is a container whose children carry the money (counting
  both double-counts); PENDING is not money that has moved and its amount can still change.
- **Empty week:** no rows, `accountCount` = 0. **Expected:** every figure 0, never undefined
  (the digest then renders the "nothing shared" or "no movement" copy, never "$NaN").
- **Sign convention:** `amountCents` is outflow-negative / inflow-positive (schema line 249),
  and `outflowCents` is reported POSITIVE-signed, so `$1,240.55 out` reads as a magnitude.

Account-set fixtures (server read, `getHouseholdDigestContext`, same test file): household of
A + B; A shares a checking, B shares a card, B also holds a PRIVATE card and a PRIVATE
checking. **Expected:** `accountCount` = 2 (both shared accounts, never the private ones — T1),
and B's private-account rows are absent from every figure. Both partners' contexts return
IDENTICAL movement figures (the one symmetric section of the joint digest).

Slice-8 additions (critic F-4): B also shares a LOAN (inert for dues). **Expected:**
`sharedAccountCount` = 3 (ALL supported shared accounts, any type — drives the "is anything
shared?" branch) while `movement.accountCount` stays 2 (the SPENDING tally set). A household
sharing ONLY the loan renders `digestNoSpendingShared`, never "no accounts are shared".
