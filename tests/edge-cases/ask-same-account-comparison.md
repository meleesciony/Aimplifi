## §Ask — same-account comparison and average (DECISIONS #781 — engine `analyst/same-account.ts`)

Suite: `tests/unit/analyst-same-account.test.ts`. Every figure below is worked by hand
here and asserted there. All amounts are integer cents; `$` values are shown only to make
the arithmetic readable.

The engine does not add spending up itself. It decides which accounts are in, and hands
their rows to a `figure` function the caller supplies — in the app, `spendingByCategory`,
the one every other surface prints. §A–§I use the plainest figure there is (add the rows,
by group) so the account rule can be checked by hand; §J uses one shaped like the app's.

## The rule being tested

An account is **in** a comparison only if its record is known to be whole for both
periods. "Known" means one of three facts, and nothing inferred from the pattern of rows:

| Edge | A row says so | The feed says so | The reader says so |
|---|---|---|---|
| Start of a period | first row on or before the period's first day | — | "its first transaction is when I opened it" |
| End of a period | last row on or after the period's last day | a live feed that succeeded through the last day | "nothing since its last transaction" |

Any other account that has ever spent is **left out of both sides** — never counted as
$0 — and returned with what it has on record, the reason, and (when a question can settle
it) the question. An account that has never spent is not mentioned at all.

The reader's word is kept against the edge date it was given for. If the record later
grows past that date, the word no longer matches the edge and is ignored.

## §A — the base household

Today is 2026-10-02. Current = September 2026 (09-01…09-30). Baseline = August 2026
(08-01…08-31).

| Account | First row | Last row | Feed | Whole for Aug? | Whole for Sep? |
|---|---|---|---|---|---|
| Checking | 2025-01-03 | 2026-10-01 | live, through 10-01 | yes | yes |
| Sapphire | 2025-02-10 | 2026-09-28 | live, through 10-01 | yes | yes (feed covers 09-29, 09-30) |
| Freedom | 2025-01-05 | 2026-08-14 | none | **no** — stops 08-14, before 08-31 | no |
| Venture | 2026-09-10 | 2026-09-29 | live, through 10-01 | **no** — starts 09-10, after 08-01 | no (starts after 09-01) |
| Savings | — | — | — | never spent: not part of the question | |

Rows (positive = spent):

| Account | Date | Cents | Group |
|---|---|---|---|
| Checking | 08-01 | 150000 | rent |
| Checking | 08-03 | 30000 | groceries |
| Checking | 09-01 | 150000 | rent |
| Checking | 09-04 | 34500 | groceries |
| Sapphire | 08-20 | 12000 | dining |
| Sapphire | 08-22 | 8000 | groceries |
| Sapphire | 09-15 | 20550 | dining |
| Sapphire | 09-18 | −1550 | dining (a refund) |
| Freedom | 08-10 | 4000 | dining |
| Venture | 09-12 | 7000 | dining |
| Checking | 07-31, 10-01 | 99999, 88888 | outside both periods — ignored |

Included = Checking + Sapphire.

- August: 150000 + 30000 + 12000 + 8000 = **200000** ($2,000.00)
- September: 150000 + 34500 + 20550 − 1550 = **203500** ($2,035.00)
- Change: 203500 − 200000 = **+3500**
- Percent: 3500 × 100 ÷ 200000 = 1.75 → **2** (half away from zero)

By group, included accounts only:

| Group | September | August | Change |
|---|---|---|---|
| Dining | 20550 − 1550 = 19000 | 12000 | +7000 |
| Groceries | 34500 | 30000 + 8000 = 38000 | −3500 |
| Rent | 150000 | 150000 | 0 |
| **Sum** | 203500 | 200000 | **+3500** ✓ equals the change |

Left out, largest on-record amount first:

- Venture — 7000 in September, 0 in August. Reason: record starts 2026-09-10. Question: start, 2026-09-10.
- Freedom — 0 in September, 4000 in August. Reason: record stops 2026-08-14, no feed. Question: end, 2026-08-14.

Conservation: 200000 + 203500 + 7000 + 4000 = **414500** = every row in the two periods.

## §B — the reader's word

Freedom: "I stopped using it after Aug 14" (end, real, for 2026-08-14). Venture: "Sep 10 is
when I opened it" (start, real, for 2026-09-10). Both are now whole: Freedom's September is a
real zero, Venture's August is a real zero.

- August: 200000 + 4000 = **204000**
- September: 203500 + 7000 = **210500**
- Change: **+6500**; percent 6500 × 100 ÷ 204000 = 3.186… → **3**
- Dining: September 19000 + 7000 = 26000; August 12000 + 4000 = 16000; change **+10000**.
  Check: 10000 − 3500 + 0 = 6500 ✓

A word for a different date (end, real, for 2026-08-10 while the last row is 08-14): ignored.
Freedom is left out and asked again.

A word of "missing" (end, missing, for 2026-08-14): Freedom stays out, `told` is true, and
no question is returned. August stays 200000.

A start word does not settle an end edge: Freedom with only a start word is still left out.

## §C — the feed

- Sapphire's last row is 09-28 and its feed succeeded through 10-01 ≥ 09-30: whole. The
  silence on 09-29 and 09-30 is real.
- Sapphire failing: last row 09-18, last success 09-20. Known through 09-20 < 09-30: left
  out, reason `end / 2026-09-20 / failing`, **no question** (a question cannot mend a
  connection). On record: September 20550 − 1550 = 19000, August 12000 + 8000 = 20000.
  Checking alone: September 34500 + 150000 = **184500**; August 30000 + 150000 = **180000**.
- Sapphire live but last success 09-29 (last row 09-28): known through 09-29 < 09-30: left
  out, reason `end / 2026-09-29 / live`, no question.

## §D — the edges, to the day (one account, no feed, no rows in the periods)

| First row | Last row | Result |
|---|---|---|
| 2026-08-01 | 2026-10-01 | in |
| 2026-08-02 | 2026-10-01 | out — start, 2026-08-02 |
| 2025-01-03 | 2026-09-30 | in |
| 2025-01-03 | 2026-09-29 | out — end, through 2026-09-29 |
| 2026-08-05 | 2026-09-20 | out — both reasons, both questions |

**The months between are not examined.** May against March, one account with first row
02-27, last row 06-01, and no row in April: March 5000, May 6500, change +1500,
1500 × 100 ÷ 5000 = **30**%.

Percent is null when the baseline is 0 or negative (a net-refund month).

Rounding: 200 → 201 is +0.5% → **1**; 200 → 199 is −0.5% → **−1**; 201 → 202 is 0.4975% → **0**.

## §E — one account, two records

Freedom's old record (first 2025-01-05, last 2026-08-14, no feed) and the record that
replaced it (first 2026-08-12, last 2026-09-30, live), joined by a reconciliation the reader
confirmed: one lineage. First row 2025-01-05 ≤ 08-01, last row 09-30 ≥ 09-30: whole.

- Its August: 4000 (old) + 2500 (new, 08-25) = **6500**. Its September: **3100** (new, 09-09).
- Household August: 200000 + 6500 = **206500**. September: 203500 + 3100 = **206600**.
- Named for the record that carries it now: "Freedom Unlimited".

If the replacement's record stopped at 09-12 with no feed, the lineage is left out and the
question is about the replacement (the member holding the edge), for 2026-09-12.

## §E2 — two records of one card that do not meet (critic cycle 1, P0-1)

*Engine-level rule. In the app every effective combined card is "trimmed" (the boundary
always drops a predecessor's days after its cutover — §E3), and a trimmed card takes no
reader's word and no older record's feed (critic cycle 4): the word-proved rows of the table
below are what the ENGINE does for a lineage given without dropped ranges.*

Joining two records into one lineage does not extend "a record has no holes" to the days
BETWEEN them. Where the records are read from: each account's own stored span (first and
last row before a combined account's boundary trims the snapshot), capped at today.

Freedom (old): no feed, rows 2025-01-05 … 2026-06-14 (May 10: 20000; Jun 10: 30000; Jun 14:
500). Freedom Unlimited: live through 10-01, rows 2026-08-25 … 2026-09-30 (Aug 25: 30000;
Sep 10: 30000). Hole = the day after the last row so far … the day before the next first
row = **2026-06-15 … 2026-08-24**.

| Asked | Result |
|---|---|
| July vs June | left out — gap 06-15…08-24; on record July **0**, June 30000 + 500 = **30500**; asked: Unlimited start 08-25, old end 06-14 |
| September vs May (hole touches neither) | in: September **30000**, May **20000** |
| Average May…September | left out — the run crosses the hole |
| July vs June, both words "real" | in: July **0** (a real zero), June **30500** |
| Only the start word | still out; only the old end is asked |
| Old record live through 08-24 + start word | in (its feed covers the hole); through 08-23 → out |
| New first row 06-10 (overlap) or 06-15 (touch) | no hole |
| New first row 06-16 | hole 06-15 … 06-15 |
| Start word "missing" | out, `told`, nothing asked |

The lineage's end is vouched for by the feed of the member holding the LAST row: old record
live through 10-01, new record (no feed) stopping 08-14 → September is left out, end through
08-14 (it used to borrow the old feed).

A row dated after today is not counted toward an edge (a typed December row proved nothing
about September).

## §E3 — an old record cut at its cutover (critic cycle 2, P1-1)

The reconciliation boundary keeps a combined card's OLD rows only up to the cutover the
reader chose; the new record drops its rows inside the old one's claim. Each record's
coverage is its own row span MINUS the ranges the boundary drops for it
(`reconciliationDroppedRanges`, checked day by day against the keep rule in
`reconcile-dropped-ranges.test.ts`). A day a record has rows for that is dropped and kept by
no other record is activity counted nowhere: the card stays out, and nothing is asked.

Freedom (old), SimpleFIN: $300 on the 10th and 20th of April … August (last row Aug 20).
Freedom Unlimited, Plaid (live): rows Aug 18 ($1), Aug 20, Sep 10, Sep 20 ($300 each).
Today 2026-10-02. Run through the real `applyReconciliationBoundary`
(`assistant-analyst-boundary.test.ts`):

| Cutover | Old coverage ends | Gap | July vs June |
|---|---|---|---|
| 2026-07-15 | Jul 15 (its Jul 20, Aug 10, Aug 20 rows are dropped) | **Jul 16 … Aug 17** | left out: on record July $300 (Jul 10), June $600; **nothing asked** — no answer can prove days whose rows were dropped |
| 2026-08-20 (default: the old last row) | Aug 20 | none (new first row Aug 18 ≤ Aug 21) | included: July **$600**, June **$600** — "the same" |

A cutover before the old record's first row is a degenerate claim: the boundary keeps ALL of
it (A-F8), and so does this rule.

Two further shapes, through the real boundary: a hand-typed row on the old card dated
2026-12-01, combined at today, moves the claim to today and drops the new card's August —
August vs July is refused (no $0 August); a chain one → two → three with both cutovers on
Jul 31 drops two's August rows while three begins in September — refused, nothing asked.

A tie on the latest row between two records of one card goes to the account that carries
the lineage now (its feed, its name, its question), whatever the ids.

## §K — a month in progress, day for day (critic cycle 1, F3)

When exactly one of the two months is in progress, both sides are its first N days with
N = (today's day − 1), capped at the other month's length; on the 1st, the whole months are
kept and the unfinished one is refused by name.

| Today | Months | Periods |
|---|---|---|
| 2026-10-12 | Oct vs Sep | Oct 1–11 vs Sep 1–11 (N = 11) |
| 2026-03-31 | Mar vs Feb | Mar 1–28 vs Feb 1–28 (N = min(30, 28)) |
| 2026-10-02 | Oct 2025 vs Oct 2026 | first day of each |
| 2026-10-01 | Oct vs Sep | whole months → refused (October in progress) |

Worked: Checking rows Sep 1 rent 150000, Sep 4 groceries 34500, Oct 1 rent 150000; today
2026-10-12. Oct 1–11 = **150000**; Sep 1–11 = 150000 + 34500 = **184500**; change **−34500**;
percent −34500 × 100 ÷ 184500 = −18.69… → **−19** ("19% lower").

The partial window is `spendingByCategory`'s own `asOf` stop date: first 8 days of May with
rows May 3 −5000 dining, May 9 +2000 dining refund, May 10 −1000 groceries → 5000; first 9 →
5000 − 2000 = **3000**; first 10 → 3000 + 1000 = **4000**.

## §F — refusals

| Asked | Result |
|---|---|
| September vs August, today 2026-09-30 | `unfinished` (the period ends today) |
| September vs August, today 2026-10-01 | answered |
| September vs 08-01…09-01 | `overlap` (they share 09-01) |
| September vs September | `overlap` |
| A period 09-30…09-01 | `order` |
| A row for an account that was not described | throws — a caller bug must not become a silent zero |

## §H — average

June, July, August 2026. Checking: 100000, 110001, 120000. Midyear (first row 2026-07-05):
5000 in July, 6000 in August.

- An average examines the whole run, 06-01…08-31. Midyear starts 07-05: left out (total on
  record 11000; question: start, 2026-07-05) — even though it is whole for August alone.
- Total 100000 + 110001 + 120000 = **330001**; ÷ 3 = 110000.33… → **110000**.

Rounding: (100 + 101) ÷ 2 = 100.5 → **101**; (−100 − 101) ÷ 2 = −100.5 → **−101**.

Refused: one month (`too-few`); a month ending today or later (`unfinished`); months out
of order or repeated (`overlap`).

## §I — the property

300 seeded households of four accounts. Each account has a true life (born, died, a row
every few days); the record handed to the engine is that life with its start and/or end
possibly cut off. The facts handed over are only true ones: a live feed only when the
record really runs to today, the reader's word only as the truth would have them answer.

Asserted for three pairs of months per household: every **included** account's two
figures equal the truth for that account, to the cent; every row on record lands in
exactly one account's figure, included or left out; the groups sum to the change.

The generator must produce both outcomes in quantity (over 500 included checks and over
500 left-out accounts) or the test fails as vacuous.

## §J — a figure that does not add up across accounts

The app's figure nets refunds inside a category and DROPS a category whose net is zero or
less. Then two accounts' own figures need not add up to the figure for both, so a side must
be the figure over the included rows taken together — never a sum of per-account figures.

September: Checking buys 5000 of dining; Sapphire gets a 2000 dining refund and buys 3000
of groceries. August: Checking buys 1000 of dining. Both accounts are whole.

- September, together: dining 5000 − 2000 = 3000; groceries 3000. **6000**.
- August: **1000**. Change **+5000**.
- Each alone, September: Checking 5000. Sapphire: dining nets −2000 and is dropped,
  groceries 3000 → 3000. 5000 + 3000 = 8000 ≠ 6000 — which is why they are shown, not summed.
- Groups: groceries 3000 − 0 = +3000; dining 3000 − 1000 = +2000. Sum **+5000** ✓

## Known limit, stated in the answer

The engine does not examine what lies between an account's first and last row. A
connected account's feed delivers that span whole; an account kept by hand (typed or
imported) has nothing vouching for it, so it carries `handKept` and the answer says so.
