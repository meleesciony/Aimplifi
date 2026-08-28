## §Recurring cadence → monthly rate, and the projection window (L.23/L.24, hand-verified)

**A. The monthly rate of each cadence.** `monthlyRateCents` on a $120.00/wk, $120.00/2wk,
$250.00/mo and $1,200.00/yr bill: weekly `round(12000 × 52 / 12)` = **$520.00**; biweekly
`round(12000 × 26 / 12)` = **$260.00**; monthly **$250.00** unchanged; annual
`round(120000 / 12)` = **$100.00**. L.24 added two: a $300.00 quarterly bill `round(30000 / 3)`
= **$100.00**, and a $600.00 twice-a-year bill `round(60000 / 6)` = **$100.00**. Half-up
rounding where the amount does not divide: $100.00 quarterly → **$33.33**, $100.01 semiannual →
**$16.67**. IRREGULAR and a null cadence count at face ×1 — the safe direction for the least
predictable shape the detector emits. The SAME six factors live in `summary.ts`'s `PER_MONTH`
(the /recurring headline); the two tables are deliberately unshared — they disagree about
IRREGULAR and this one keeps an exact integer form — and are held together by a test.

**B. Which cadences reach the money at all.** `toScheduledTransactions` projects WEEKLY,
BIWEEKLY and MONTHLY unconditionally, and the three LONG cadences — QUARTERLY, SEMIANNUAL,
ANNUAL — **for expenses only, and only while the series is still charging**. Income on a long
rhythm is held out (a bonus dated from one 365-day gap would offset a projected dip and silence
a warning — the failure direction differs by role). Every other rhythm reaches nothing, because
`cadenceFromGaps`' windows are 5–9, 12–16, 26–35, 84–98, 175–190 and 350–380 days and
`detectRecurring` drops IRREGULAR before the filter is reached — executed, the dropped set
includes 10-day, 21-day (three-weekly), 42-day (six-weekly), 61-day (bi-monthly) and 548-day
rhythms, and each window's edges are sharp: a 349-day gap is dropped, 350 and 380 are ANNUAL,
381 is dropped.

**B1a. The every-gap licence the two NEW cadences must earn (L.24).** QUARTERLY and SEMIANNUAL
are the only cadences whose classification requires EVERY gap to fall inside the band, not
merely their median. With three sightings there are two gaps and their median IS their mean, so
gaps of 30 and 150 days average to 90 and would otherwise read as a quarterly bill; executed,
`[30, 150]`, `[10, 172]` and `[90, 274]` are all dropped, while `[91, 89, 92]` is QUARTERLY and
`[182, 181, 184]` is SEMIANNUAL. **Band membership alone is NOT the rule**, because the quarterly
band is 15 days wide and two gaps can both sit inside it without being a rhythm: the L.24 money
critic broke the first version with three haircuts **84 and 98 days apart** — both gaps in band,
every-gap satisfied — which produced a projected `QUARTERLY` bill, a monthly rate of $15.00 and a
date on the calendar, from three discretionary purchases. It also broke it through the
two-plateau price-change path (three vet visits at $100/$100/$250, 84 and 98 days apart). So the
gaps must ALSO agree with each other: `max(gaps) - min(gaps) <= 7` days. Executed, that rejects
`[84, 98]`, `[98, 84]` and `[175, 190]` while costing no genuine bill — real anchors cluster far
tighter: calendar-quarter billing 89–92 (spread 3), first-business-day-of-quarter 90–92 (spread
2), a real Jan 31 / Apr 30 / Jul 31 / Oct 31 water bill 89–92 (spread 3), semiannual 181–184
(spread 3). The band edge is sharp and was executed rather than described:
`[91, 91, 98]` is QUARTERLY and `[91, 91, 99]` is IRREGULAR, `[91, 91, 83]` (eight days EARLY) is
IRREGULAR, and `[182, 182, 191]` is IRREGULAR — so the rule is "more than about a week off in
EITHER direction", not "late". It applies to every gap in the whole history, not to the first
three: `[90,91,92,92,90,91,105,91,91,92,90,91]` — a thirteen-sighting quarterly bill with ONE
14-day-late cycle years ago — is IRREGULAR permanently, because `detectRecurring` reads all of
history and later on-time cycles cannot retire the bad gap. That is the cost of the licence, and
it is stated on /spending-plan rather than left for the reader to discover. Strictness is the safe direction HERE, which is the opposite of the usual reading: a
missed detection leaves the reader with the status quo (an uncounted bill), whereas a false
positive is a NEW invented obligation that prints a dated outflow on /calendar and can raise a
radar "move $X by <date>" for a bill that does not exist. The four older cadences keep the
median-only rule, deliberately — raising their bar would re-detect every existing user.

**B2. What a long-cadence series costs to detect.** Three sightings at a stable amount: two
points give one gap and no median to infer a cadence from, and three distinct amounts (a premium
that rises every year) fail the two-plateau stability rule. Three yearly sightings span **731
days**, three semiannual ones roughly **365**, three quarterly ones roughly **182** — so a
quarterly bill needs about six months of history, a twice-a-year bill about one year, and an
annual bill is invisible until roughly two years of history exist — which is why the audit
panel's yearly-bill clause is gated on one actually being in the figure, and why the
"What this figure can't see" list states the precondition when it is not.

**B3. When a series stops counting.** `isSeriesActive` — silence longer than `CADENCE_DAYS ×
1.5`, rounded — is shared by the projection filter and the `/recurring` summary, so a lapsed
series cannot be $0/month on one surface and a full monthly rate on the other. At ANNUAL that is
548 days: last seen 2025-01-01 is still charging on 2026-07-03 (548) and not on 2026-07-04 (549).
Executed for the two cadences L.24 added, from the same 2025-01-01 anchor: QUARTERLY's cutoff is
**137** days (active on 2025-05-18, lapsed on 2025-05-19) and SEMIANNUAL's is **273** (active on
2025-10-01, lapsed on 2025-10-02). The gate is applied to the three LONG cadences only; a MONTHLY
series silent for a year is still projected (recorded in docs/STATUS.md §L.23 OPEN #6).

**C. One occurrence per sub-year window.** A $1,200.00 premium next due 2026-08-15, today
2026-06-10: the forecast expands **one** occurrence at a 90-day horizon (window ends 2026-09-08)
and **zero** at 60 days (ends 2026-08-09); the cash-needed assembler, whose default horizon is
60 days, likewise sees zero and sees one at 90. Across an 800-day window (ends 2028-08-18) it
expands **three**: 2026-08-15, 2027-08-15, 2028-08-15 — the explicit 12-month step. No *horizon*
caller exercises it (cash-needed 60, forecast 90, `RADAR_HORIZON_DAYS` 90), but the calendar's
month view is a URL query param with prev/next links, so a window a year or more ahead is twelve
clicks away. The second occurrence appears at ~431 days here, NOT at 366: the bound depends on
the anchor's phase within the window, so "identical below 366 days" is the wrong way to state it.
The step also self-heals a row whose `nextDate` is already in the past — that difference is
date-scoped, not window-scoped.

**C2. A QUARTERLY row does NOT recur inside any horizon this app forecasts (L.24, corrected by
an executed test).** A quarterly PERIOD is 91–92 days, which is longer than the 90-day widest
horizon in the codebase — so in forecast and cash-needed a quarterly row expands to at most
**one** occurrence, exactly like an annual one. A first draft of the L.24 comments claimed the
opposite in three source files ("a quarterly row genuinely CAN recur inside a 90-day horizon")
and the test written to prove it failed instead: next due 2026-06-15 with today 2026-06-10, a
90-day window ends 2026-09-08 and the second occurrence falls on 2026-09-15, seven days outside.
The two places the explicit 3-month step DOES change the answer, both executed: the calendar's
month view (2026-09-15 and 2026-12-15 appear on their own grids — three and six clicks from
today, where the old catch-all `else` left them empty), and a stale anchor self-healing forward
(next due 2026-01-15, already past, now yields 2026-07-15 inside a 90-day window where before it
was dropped entirely). Across a 400-day window the forecast and the assembler both expand five:
2026-06-15, 2026-09-15, 2026-12-15, 2027-03-15, 2027-06-15.

**C3. The rate is a fixed fraction, so a bill at a band EDGE is under-counted by up to ~8%
(L.24 money critic P2-3, executed).** The quarterly band admits 84–98 days but the rate is a flat
1/3. A bill every 84 days charges 4.35 times a year, not 4: a $300.00 bill counts **$100.00**/mo
where its true rate is **$108.71**/mo. Semiannual at 175 days: $600.00 counts $100.00 against a
true $104.36. Direction: under-counting a fixed expense RAISES guilt-free spending — the
dangerous direction — bounded at ~8.7% of that one bill's monthly share. Pre-existing in the same
shape for ANNUAL (a 350-day rhythm counts $100.00 against a true $104.36) and NOT introduced by
this slice, but newly reachable at two more cadences. Recorded rather than fixed: rating by the
observed median gap (`amount × 365.25 / medianGap / 12`) is a different rating model for every
cadence, which would move existing figures — docs/STATUS.md §OPEN after L.24.

**C4. Month-end anchors drift one day per clamp and never recover (L.24 money critic P3-6,
executed).** A real Jan 31 / Apr 30 / Jul 31 / Oct 31 water bill (gaps 89, 92, 92, 92) detects
QUARTERLY with `lastSeenAt 2026-04-30` and `nextExpectedAt 2026-07-30` — one day before the real
2026-07-31 — and the chain compounds (`2024-01-31 → 04-30 → 07-30 → 10-30 → 2025-01-30`). Same
class as the MONTHLY bound already recorded at `plan.ts`'s `scheduledOccurrencesBetween`, now
recorded for the long cadences too. The critic swept 4 cadences × 5 anchors (including 2019-01-31
and leap 2020-02-29): **no infinite loop and never a past date**, max 88 steps.

**D. What the plan does with it.** A detected $1,200.00/yr premium subtracts **$100.00** from
guilt-free spending every month, including the month the full $1,200.00 actually leaves the
account — eleven months are $100.00 conservative and the twelfth is $1,100.00 optimistic. That
is the smoothing the owner's formula asks for ("expenses are also based on patterns"), disclosed
on the audit panel rather than left implicit, and recorded in docs/STATUS.md §L.23 OPEN #3.
