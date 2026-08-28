## §Household Joint Cash-Needed (DECISIONS #215 — TASKS 4.2 slice 4, `mergeSnapshots`)

`mergeSnapshots(today, mine, partners[])` unions the viewer's own cash-needed inputs with 0+
live partners' shared-account slices (`getSharedSnapshotSlice`), mirrored in
`tests/unit/household-cash-needed.test.ts`.

- **Two-partner union:** viewer has 1 card (id `mine-1`); partner A shares 1 card (`p1-1`);
  partner B shares 2 accounts (`p2-1`, `p2-2`). **Expected:** merged `accounts` =
  `[mine-1, p1-1, p2-1, p2-2]` — mine first, then each partner in call order, nothing dropped,
  nothing duplicated.
- **Overlap-impossible-by-construction proof:** an account row has exactly one `userId`, so
  the viewer's own slice and a live partner's `sharedToHousehold` slice can only overlap if
  something upstream is broken (a share-flag/authz defect leaking the SAME account id into
  both). `mergeSnapshots` does not assume this is impossible — it asserts it: the same account
  id appearing in `mine` and a partner slice, or in two different partner slices, **throws**
  rather than silently double-counting a balance. Locked: `tests/unit/household-cash-needed.test.ts`
  "T9: the SAME account id in both the viewer slice and a partner slice fails loudly" +
  the two-different-partners variant.
- **Drift guard:** a partner slice tagged with a `today` different from the viewer's throws
  rather than merging across business days. Nearly vacuous today (one server clock drives
  every `businessToday`), honest scaffolding for future per-user timezones.
- **#192 dedup-guard interaction:** a shared account seen via a partner must NOT trip the
  cross-provider duplicate-account detector for the OWNER's own `/accounts` view — the
  detector's input stays the viewer's OWNED set (`getAccountsView`), a separate query path
  never touched by the household merge. Locked in both `tests/unit/household-sharing.test.ts`
  (T9 original) and `tests/unit/household-cash-needed.test.ts` ("T9: household cash-needed
  merge does not perturb the #192 duplicate detector").
- **Funding-account regression (hostile-critic P0, fixed same session):** the payment account
  that funds the household answer must always be the VIEWER'S OWN, resolved from their
  pre-merge snapshot — `resolvePaymentAccount`'s CHECKING/first-account fallback must never be
  allowed to search the merged (mine + partners') accounts array, or a viewer with no checking
  account of their own could have the answer silently funded from a partner's shared checking.
  Hand case: owner owns only a CREDIT card (no CHECKING, no stored `paymentAccountId`); partner
  shares a CHECKING account with a $99,999.99 balance. **Expected:** `input.paymentAccount.name`
  = the owner's own card name (their only account), never the partner's checking, and
  `balanceCents` = the owner's own $150.00, never the partner's $99,999.99. Fail-old proven by
  temporarily removing the explicit override — the leak reproduced deterministically.
