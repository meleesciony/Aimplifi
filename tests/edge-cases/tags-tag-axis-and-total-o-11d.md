## §Tags — the tag filter axis and the tag total (O.11d, `engine/transactions/query.ts` + `engine/transactions/tags.ts`)

Hand-verified values for the O.11d engine tests (`tests/unit/txn-tags.test.ts`).
Suite: `tests/unit/txn-tags.test.ts`.

A tag total is not a new arithmetic. It is `summarizeTransactions` over the rows the
tag axis keeps — the same function the unfiltered summary strip uses — so every
gate that function owns (transfers, O.15 exclusion, U.20 hand-over) owns the tag
total too, with no tag-specific branch anywhere. These values lock that.

## Fixture (cents; signed, outflow negative)

| row | amount | account | flags | tags |
|-----|--------|---------|-------|------|
| t1 | −1 250 (−$12.50) | Checking | — | trip |
| t2 | −4 500 (−$45.00) | Amex | — | trip, night-out |
| t3 | −8 000 (−$80.00) | Checking | — | *(untagged)* |
| t4 | −150 000 (−$1,500.00) | Amex | **excluded from totals** | trip |
| t5 | +500 000 (+$5,000.00) | Checking | **transfer** | trip |
| t6 | +2 000 (+$20.00) | Checking | — | night-out (refund) |
| t7 | −3 000 (−$30.00) | Checking | needsReview/uncategorized | night-out |

## Tag = `trip` → rows {t1, t2, t4, t5}

- `count` = **4** — all listed rows count, INCLUDING the excluded one and the transfer
  (count is the row count; O.11c's rule: excluded rows leave the figures, not the list).
- `excludedCount` = **1** (t4) — the figures' own honesty about what they dropped.
- `inflowCents` = **0** — t5 is a transfer: never income (engine-wide rule), and t4 is
  excluded; no other positive row.
- `outflowCents` = 1 250 + 4 500 = **5 750** — t4 (150 000) excluded from the figures;
  t5 (transfer) skipped.
- `netCents` = 0 − 5 750 = **−5 750** (−$57.50).

## Tag = `night-out` → rows {t2, t6, t7}

- `count` = **3**.
- `inflowCents` = **2 000** (t6, a refund — inflow like any positive row).
- `outflowCents` = 4 500 + 3 000 = **7 500**.
- `netCents` = 2 000 − 7 500 = **−5 500** (−$55.00).
- `excludedCount` = **0**.

## Unknown tag id → {}

- Every figure **0**, `count` **0**. The empty is VISIBLE (the register's own empty
  state + the toolbar mirroring the stale filter); it is never the unfiltered total
  wearing a filter it did not answer.

## Naming (validated at every write; `MAX_TAG_NAME` = 40 code points = the category ceiling)

- `"  Work   Trip \t"` → `"Work Trip"` (collapse + trim — the category rules, reused verbatim).
- `"Work\u200BTrip"` → `"WorkTrip"`; `"Work\u202ETrip"` → `"WorkTrip"` (invisible characters
  cannot create two chips that render identically — the L.12c lesson).
- `"   "` → refuse, one sentence: "Give the tag a name."
- 40 CJK (`旅`×40) pass; 40 emoji (surrogate pairs) pass; 41 of either refuse with
  "Keep the name to 40 characters." (code points, not UTF-16 units).
- Display order: code-point order by name (`Alpha` < `apple` < `beta`) — locale-independent.
