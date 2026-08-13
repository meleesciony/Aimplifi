# STATUS — known limitations & open items

Living document; updated at each phase boundary and critic cycle.

> Entries from 2026-06/2026-07 (BUILT/CLOSED history) were moved verbatim to
> `docs/archive/STATUS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04 to keep this
> file loadable. Only OPEN/DECIDED items and 2026-08 entries live here.

## ✅ BUILT 2026-08-12 — U.23: the exported ledger becomes the register's, and says what the currency guard kept out of it (DECISIONS #457)

**Shipped.** The transactions CSV route built its OWN Prisma where-clause three lines above a
comment claiming "the exported ledger must match the in-app register", and it did not: missing
`isSplitParent: false`, so every split shipped as the parent CONTAINER — the row the schema calls
"excluded from ALL sums" — beside the children carrying the real amounts, and missing the #135
currency guard, so rows the register withholds for having no exchange rate landed unlabelled in a
column of dollars. Measured on the repro that opened U.23: **4 rows / −$299.00 exported against
the register's 2 / −$100.00.** Fixed by deleting the second clause rather than patching it —
`where: registerRowWhere(userId)`, the register's own expression, so the parity claim is true by
construction (H.8).

**The open question in the task row — a currency column, or the guard? — decided: the guard.**
#135 withholds non-USD accounts from every money surface because the app does no FX, and a
currency column would make this file the one place unconverted foreign money appears,
contradicting the decision it would implement. The header therefore does not move, which also
keeps U.19's live-deploy header check valid unedited. But the withhold is disclosed IN the file:
`withheldExportNote`, its own author, because both siblings (#141 banner, #150 inline note) say a
FIGURE excludes accounts and a reader holding that over a file of rows can conclude their rows
are present and merely un-summarised. Its input, `getWithheldRegisterAccountSummary`, is the
literal complement of `registerAccountWhere`'s own currency clause — destructured and negated,
with the rest of the basis passed WHOLE as one `AND` member so a key that clause later gains
cannot be silently shadowed — scoped to spending accounts holding an exportable row. An empty
euro account produces no note (the U.19 byte-identity rule, in the other direction).
`transactionsToCsv`'s second parameter is REQUIRED, never optional-defaulting-to-silence.

**Critic cycle: two fresh contexts, and they produced the SAME P1 independently.** The note's
count is FILE-scoped while one clause claimed the APP — "an account in EUR is left out of every
total the app shows" is false for a reader who also owns a yen brokerage, whose screens correctly
say "2 accounts" — the family's own non-disagreement rule (#141) broken inside the author written
to honour it, and locked in by the slice's own test. Now the totals sentence states a RULE
carrying no number and every counted clause names this file. Also executed: "stay saved" names
Aimplifi (in a downloaded file an unplaced promise of persistence acquires the file as a second
referent); the currency codes moved to a parenthetical the opaque-token case omits entirely; one
account is named once, definitely; "counting them" → "counting those transactions in a column of
dollars"; the `AND`-wrapped where-clause (a future `NOT` on the register's basis would have been
silently shadowed); the parity test's page-size cap asserted rather than assumed; the route test
clears its own rate-limit key (the eleventh export would have failed as a 429 and read as a
parity defect); the new e2e assertion moved to integer cents. Lesson distilled:
`scoping-the-number-does-not-scope-the-sentence`.

**Filed with executed evidence, not fixed here. U.25** — the file names one of the four reasons
it is incomplete (loans/mortgages/brokerage rows, split parents and R1-disowned rows are omitted
silently); deliberately deferred because bolting a basis clause onto the currency note would gate
a fact true for EVERY reader behind the rare condition of owning a non-USD account, which is last
session's `a-disclosure-gated-to-the-loudest-branch` defect exactly — where the basis belongs
needs deciding first. **U.26 — MEASURED this session against a real Prisma DB:** one $100.00
purchase, one $1,200.00 row the reader marked "not my spending" and one $2,000.00 transfer export
as **3 rows summing −$3,300.00** while `TxnSummary` reports **$100.00** of money out for the same
three rows (`excludedCount: 1` — the register knows and badges it). Row-set parity is intact, so
this is the column's legibility, not U.23's clause: the file carries no `excluded` and no
`transfer` column and emits no note, so the one act it exists for cannot reproduce any figure in
the app. **U.27** — currency copy drift ("US dollars" in four other authors) and the shared
"EUR and others" phrase.

**Gate.** `bash scripts/verify.sh` with `VERIFY_E2E=1` → **✅ VERIFY GREEN** (exit 0): tsc 0 /
eslint 0 / **6,954 passed + 1 expected fail + 1 skipped / 421 files passed + 1 skipped** / build
clean (compiled in 13.7s, 42/42 static pages) / **346 e2e passed, 2 flaky-passed-on-retry**
(`register-return:119`, `transactions:295` — both [mobile-380], both documented members of the
recorded 4-worker timing-flake class, in specs this slice does not touch; the slice's own
extended e2e `transaction-detail.spec.ts:65` passed in 6.5s). 19 locks in
`tests/unit/u23-export-register-parity.test.ts`, both halves proven fail-old by sabotage: the old
where-clause reddened 5 at the exact 4-rows/−$299.00 shape, and suppressing the note reddened 4.

**Gate read (rule 5) + live.** CI run **31664067318 on `adbba2f`** = **SUCCESS on attempt 1**,
read to conclusion via `scripts/ci-status.sh` (exit 0). Vercel commit status: success,
"Deployment has completed", on the same sha. Live: `node scripts/u23-live-deploy-check.mjs` →
**10 PASS / 0 FAIL / 2 declared SKIP** against production. U.23 has NO demo-visible marker and
deliberately cannot have one — the seed writes neither a split nor a non-USD account (the K.4
situation, declared rather than papered over) — so the live script asserts the claim that IS
reachable: the route now runs the register's own clause against the production database, and the
exported row count **equals the count the register states, 842 = 842**, measured on real seeded
rows. It also asserts the decision's inertness promise: the header did not move and an all-USD
reader gets no note of any kind. Predecessors re-run, none regressed: **U.19 17/17**, **U.16
13/13**, **U.13 6/6**.

## ✅ BUILT 2026-08-12 — U.19–U.22: the last silent surfaces of the released day, closed as one slice (DECISIONS #456)

**Session note:** the building session's PowerShell window died mid-slice; this entry's work was
recovered from the uncommitted tree plus PROGRESS.md and completed in a fresh session — the
checkpoint discipline (LOOP_ENGINEERING rule 8) is what made that a resume instead of a restart.

**Shipped.** U.16's four residuals as one slice, since all four consume the same account-scoped
`getReconciliationHandoverKeys` set. **U.19:** the transactions CSV gets an UNCONDITIONAL
`changeover_day` column (one schema for every reader), `yes` on released rows, and a trailing
rectangular note row only when the file holds one — a column-and-note, not the tax export's
prose block, because this file's first line is its header and the reader's first act is to sort
it. **U.20:** the register — the surface where the two identical lines actually sit adjacent —
gets the panels' own `(connection changeover)` per-row marker, a totals-caption sentence from a
fourth author (`handoverDayRegisterTotalsNote`: the register prints THREE tiles and counts
income, so no sibling's direction clause survives there), `TxnSummary.countedOnHandoverDays`
counted after the transfer/excluded/zero gates, and the detail page gets the marker as a Badge
plus its own explanatory sentence (deep links break "came from the register"). Ask's
`merchant_spend` gets REQUIRED `countedOnHandoverDays` off the same predicate that flags its
items, the note on every money branch, and the trace reads the engine's own rows. **U.21:**
`SpendingBreakdown.uncountedOnHandoverDays` records the categories the net<=0 drop removed that
still hold released rows — filled inside the same loop that drops them, carrying group but
deliberately NO amount — and `handoverDayUncountedNote` prints wherever that set is non-empty,
scoped to the answer's target. **U.22:** the /reports page total carries the answer note; the
empty state and the positive table carry the uncounted note.

**Critic cycle: two fresh contexts, 2 P1 + 8 P1/P2, every finding executed.** (1) P1 money: the
uncounted note was gated to the ZERO branches — the critic rendered "You spent $50.00 on
Food & Dining this month." over a breakdown whose groceries a doubled released return had
silently dropped: a positive, UNDERSTATED figure, the direction that costs money, disclosed
nowhere. Now fact-gated (set non-empty), not branch-gated. (2) P1 claims: the answer note's
direction clause was INVERTED on the merchant negative-net branches — two copies of one $50.00
return rendered "$100.00 came back in refunds" (too HIGH) under "returns make this figure too
LOW"; those branches now use `handoverDayAmountsNote`, which states the counting rule and no
direction. (3) The zero-gated trace mirror was DEAD CODE — traces attach only where an answer
states `headlineCents`, and zero branches state none; ungating (1) is what made it real. (4) A
$0 verification hold was flagged and counted while an engine comment claimed it was excluded —
now excluded, in the one predicate both the marks and the count read. (5) The register note's
tile enumeration missed doubled DEPOSITS → "in whichever of these totals its amount feeds".
(6) "This figure" had no referent under "No spending recorded" → the note is referent-free.
Lesson distilled: `a-disclosure-gated-to-the-loudest-branch-misses-the-reachable-one`.

**Filed with executed evidence, not fixed here: U.23** — pre-existing, on the surface U.19
certifies: the export route's own where-clause double-counts every split (parent AND children)
and ships non-USD rows the register withholds; measured 4 rows/−$299.00 exported vs the
register's 2 rows/−$100.00. **U.24** — /calendar sums both released copies through a lean row
shape that cannot carry the flag; its summary count is a structural zero and no calendar surface
speaks any handover vocabulary.

**Gate.** `bash scripts/verify.sh` with `VERIFY_E2E=1` → **✅ VERIFY GREEN** (exit 0): tsc 0 /
eslint 0 / **6,935 passed + 1 expected fail + 1 skipped / 421 files** / build clean / **346 e2e
passed, 2 flaky-passed-on-retry** (`budget-targets`, `transactions` CSV *import* — files this
slice does not touch, the recorded load-flake class). 56 locks across the two handover test
files; four sabotage proofs each reddened exactly their own locks and were reverted (drop-loop,
merchant predicate, summary count, CSV note); the two updated legacy expectations (phase4 CSV
header, merchant result shape) failed against the new code before updating, which is fail-old
evidence for those surfaces. No `prisma/` diff — read-path and copy only.

**Live check with a DISCRIMINATING half this time:** `scripts/u19-live-deploy-check.mjs` — the
CSV header is the one demo-visible string that differs between builds, so unlike U.5/U.9/U.13/
U.16 this script can actually catch a stale deploy. Run against production PRE-deploy: **16
PASS / 1 FAIL / 4 declared SKIP**, the single failure being exactly the discriminating header
check (old header captured verbatim) — its own fail-old proof.

**SHIPPED AND PROVEN LIVE (2026-08-12).** Commit `2629e7d` → pushed → **CI gate `success`, run
31660421048, attempt 1**, read to conclusion via `scripts/ci-status.sh` — the full
`VERIFY_E2E=1` suite on the Linux runner, where the extended
`handover-day-disclosure.spec.ts` (register marker + caption, /reports total note, exported CSV
against a real seeded combined pair) actually discriminates the build. Post-deploy live check:
**17 PASS / 0 FAIL / 4 declared SKIP** — the discriminating header check flipped from its
pre-deploy FAIL, which is this family's first live proof that can and did tie production to the
commit. Predecessor proofs re-run against the same deployment: **U.16 13/13, U.13 6/6** — this
money-core change regressed neither. Demo figures unmoved ($299.93 /reports, $4,900.00
/budgets, $2,763.00 /coach); every new marker and sentence correctly ABSENT for a reader with
no combined accounts.

## ✅ BUILT 2026-08-12 — U.16: the drilldown stops certifying the handover-day double, on every surface that counts it (DECISIONS #455)

**The defect.** U.13 (#454) deliberately releases the one handover day between a retired feed and the live one that replaced it to BOTH sides — a measured decision, since either whole-day award silently lost real money — and priced it as "9 rows / $374.40 of VISIBLE duplication". Nothing made it visible. Every spending surface counted those rows in silence, and the glass-box panel actively certified them: two identical lines listed together with "matched to the penny" printed underneath, on the one screen a suspicious reader opens to AUDIT a figure. `BREAKDOWN_BASIS` stayed literally true throughout — both rows are counted and the panel does list both — which is precisely why silence could not stand.

**Shipped.** One authored sentence (`breakdownHandoverDayCopy`) on every transaction panel, a no-row-list variant (`handoverDayAnswerNote`) for Ask, and a per-row `(connection changeover)` marker so the reader can find the two lines rather than scan a bucket. Fed by `getReconciliationHandoverDates` — the function U.13 built for the tax export — threaded through `server/reports.ts`, `server/trends.ts`, `server/coach.ts`, `server/assistant.ts` and `/budgets`.

**The sweep was bigger than the task row, and the compiler is why.** The row named the drilldown, /reports, /budgets and Ask. Making `onHandoverDay` REQUIRED on `BreakdownRow` made `tsc` enumerate: three more transaction panels nobody had listed (the /reports chart's month-flow panels, the lifestyle-creep bars, /trends' new-merchant panels), each printing the same penny-match line, plus a fourth Ask answer (`top_categories`) found by the critic pass. The three non-transaction panels — allocation holdings, forecast projections, net-worth constituents — answer `false` by construction with the reason recorded on the field.

**Three critic findings, each executed, each a false money claim that would have shipped.** (1) The breakdown-wide count was accumulated before a filter the figure applies after: `spendingByCategory` drops any category whose net is `<= 0`, so a handover-day purchase more than cancelled by a refund left the figure while still being counted in the sentence beside it — Ask qualified a **$20.00 total containing no released row** with "2 … fall on a day…". Now summed off the surviving categories. (2) The copy called every released row a "charge", which is false of a REFUND in both senses — wrong kind of row, and a duplicated refund pushes a spending figure DOWN, not up. (3) The Ask note promised "Spending in Reports lists those rows and marks them"; /reports' category table is always the CURRENT month while an Ask timeframe is whatever the reader said, so the pointer was false for every answer about last month or last quarter.


**A SECOND critic cycle, and it found more than the first.** Two fresh-context critics ran against the
post-cycle-1 tree and returned 2 P0 + 8 P1/P2 between them, with executed evidence. Four mattered:

- **The marker was scoped to a DATE, not to the pair.** Every consumer tested `handoverDates.has(t.date)`,
  and a released day is an ordinary shopping day on every other account the reader owns. Measured: six
  grocery rows on the handover day, two of them from the pair, and the panel marked **all six** and said
  "6 rows here fall on a day one of your combined accounts was changing connections". The set came from
  `getReconciliationHandoverDates`, built for the tax export — which has no account column and is right to
  be unscoped. Inheriting a helper inherits its SCOPE. Now `handoverKey(accountId, date)`, and
  `toTrendTxns` had to start carrying `accountId` at all, without which /trends silently marked nothing.
- **"A released day can only make a figure too high" — my own comment, and false.** The release is a rule
  about a date, not a sign, so a RETURN both feeds reported subtracts twice. Executed: one $100 purchase
  and one real $30 return doubled renders **"You spent $40.00" against a true $70.00**, with the only
  sentence beside it saying the figure may be too high. A disclosure naming the wrong direction is worse
  than silence — it steers a reader auditing a low number away from the cause. Both sentences and the tax
  export now name both directions.
- **Ask's own drilldown, four lines under the slice's own new sentence.** "Tap to see the transactions
  behind this number" opens a trace that listed the two identical rows unmarked under "✓ 3 transactions
  add up to $130.00". `assistant/trace.ts` was untouched: the slice threaded the ANSWER path and left the
  TRACE path, a second selector over the same rows, with its own un-fed call. Both critics found it
  independently.
- **The tally clause claimed a tally the panel had declined to print.** At exactly one row `BreakdownPanel`
  says "This amount is the whole figure." and suppresses the penny-match, while the basis asserted "These
  rows still add up" — plural, over one row, and with an antecedent that read as *the marked rows alone*
  sum to the figure. The gate is now `statesATally` (`reconciles && rows.length > 1`) at all four call
  sites.

Also executed: the tax CSV still said "both … counted twice", the sentence this slice's own test declares
false at multiplicity ≥ 3; and `combineSuccessFlash`'s PARTIAL branch still promised "count once" eight
lines below the success branch U.13 had already requalified.

**Filed rather than fixed, with the critics' evidence: U.19** (the transactions CSV ships the double
silently while the tax CSV discloses it), **U.20** (Ask's `merchant_spend` and the register's own in/out/net
totals), **U.21** (a doubled RETURN can hold a category at $0.00, and the zero branches then print "No
spending recorded" — closing it needs a second, raw count that survives the category drop), **U.22**
(/reports' page-level total).

**Gate.** `bash scripts/verify.sh` with `VERIFY_E2E=1` green. Fail-old proven four ways rather than asserted: three unit sabotages each redden exactly their own locks, and the e2e sabotage ran against a REBUILT server because a Playwright run tests the last `next build`, not the working tree. The e2e seeds a real combined pair and asserts **3 rows, not 4** — 4 would mean de-duplication stopped, 2 would mean a real row is being silently dropped, the direction U.13 measured and rejected. No `prisma/` diff: read-path and copy only, the live database untouched.

**What the live check cannot prove, stated in the script itself.** `prisma/seed.ts` writes no `AccountReconciliation` rows, so the demo cannot express a combined pair, no released day can exist, and NO demo-visible string differs between the pre- and post-U.16 builds (the same limit U.5, U.9, U.13 and U.15 recorded). `scripts/u16-live-deploy-check.mjs` declares that as explicit SKIPs and asserts instead the half that carries the real deployment risk: this slice edited `spendingByCategory`, the selector behind /reports' table, the dashboard's top-spending card and three Ask answers, and every edit is supposed to be INERT for a reader with no combined accounts. The demo IS that reader, so a figure moving there is exactly how this could go wrong at scale.


**SHIPPED AND PROVEN LIVE (2026-08-12).** `bash scripts/verify.sh` with `VERIFY_E2E=1` GREEN on the
shipped tree — tsc 0 / eslint 0 / **6,901 passed + 1 expected fail + 1 skipped / 420 files** / build clean
/ **342 e2e passed, 5 flaky-but-passed on retry** (all in `phase5-a11y`, `register-return` and
`transactions` — files this slice does not touch, and the load-induced local flake class the lessons
already record). Committed `0e3d665` → pushed → **CI gate `success`, run 31650606917, attempt 1**, read to
conclusion via `scripts/ci-status.sh` — the full `VERIFY_E2E=1` suite on the Linux runner, which is where
`handover-day-disclosure.spec.ts` actually discriminates the build. Vercel reports `success` on that exact
sha (deployment `FRsWtyzFUFDQa425jkp95aigkSGc`). No `prisma/` diff.

**Live proof: `node scripts/u16-live-deploy-check.mjs` → 13 PASS / 0 FAIL / 4 declared SKIP.** It states up
front that it CANNOT discriminate this deployment and why (no `AccountReconciliation` rows in the seed → no
combined pair → no released day → no demo-visible string differs), and asserts instead the half that
carries the real risk: this slice edited `spendingByCategory`, the selector behind /reports' table, the
dashboard's top-spending card and three Ask answers, and every edit must be INERT for a reader with no
combined accounts. The demo is that reader, and its figures are unmoved (`$299.93` on /reports, `$4,900.00`
on /budgets, `$2,763.00` on /coach), with the new marker and the new sentence correctly ABSENT everywhere.
**U.13's own proof re-run against the same deployment: 6 PASS / 0 FAIL / 3 SKIP** — this money-core change
regressed neither.

**Two bugs in the live check itself, found by running it rather than by reading it.** It first asserted a
`reports-total` testid the app does not have, and then read `body.innerText()` after `domcontentloaded` —
which returns before the client render finishes, so it reported "/budgets renders money: FAIL (none)"
against a page that renders money perfectly well, and reported it *inconsistently between runs*, which is
the tell. A check that races the app is testing the harness. Both fixed (`paintedText()` polls to a
deadline and still fails an genuinely empty page); the corrected script is what produced the 13/13 above.

**Residual, filed not papered over:** the register (`transaction-list.tsx`) still carries no reconciliation vocabulary, so a reader scrolling their activity list sees both rows with only the account name to tell them apart. A list of events is a different question from a certified total, and whether a per-row marker there informs or merely adds noise to every row of a busy day needs its own decision.

## ✅ BUILT 2026-08-12 — U.9: one real account connected twice is one account, and the tiebreak was the money (DECISIONS #453)

**The defect.** `AccountReconciliation.successorAccountId` is deliberately not unique — "one live account may supersede more than one old row" — so two stale rows can be continued onto one live account. `keepsSnapshot` decided same-date collisions by walking `upstreamsOf`/`downstreamsOf`, and siblings are neither to each other: each was compared against the successor, which it correctly beat, and never against its twin. On every date on or before both cutovers BOTH survived, and one real $5,000.00 savings account contributed $10,000.00 to the net-worth trend. Reproduced by the U.5 critic, recorded, and fixed here.

**The fix.** A link asserts "these two rows are the same real account" and that claim is TRANSITIVE, so the unit of de-duplication is the connected COMPONENT, not the chain. Exactly one snapshot survives per (component, date), chosen only among rows that exist on that date — a lone observation is still never dropped, so no fabricated dip — ranked by the side whose ownership window most tightly contains the date: still-covering sides first (earliest cutover), then the live terminal row, then closed windows (latest cutover).

**Two fresh-context Opus 5 critics (money/data-integrity, rendered claims) returned 1 P0 + 5 P1 + 7 P2, all executed.** Both independently found the SAME P0, and it was in the tiebreak rather than the rule: with a chain whose two cutovers are EQUAL, the mid-chain account's window `(cut..cut]` is empty so the upstream owns the date, but the comparator fell through to ACCOUNT ID — the same data produced a $4,000.00 or a $9,000.00 point depending only on how two cuids sorted. Equal cutovers are valid write-path data (the confirm action refuses only a strictly *earlier* downstream cutover; `handoverDate` returns today for a successor with no transactions). `depth` now breaks that tie before the id. Also executed: an out-degree guard (a forked predecessor silently broke the component key and reproduced the double-count through another door — unreachable from the schema, but the fix made that borrowed invariant load-bearing for money); four false clauses in the panel note; the drilldown's "a pair you have combined" on the surface that shows the money; the combine card's "a date is never counted twice"; and a plural-subject/singular-verb fold note in the assistant.

**What the slice's own probe could not see.** `scripts/audit-probes/u9-component-invariant.mts` (210,120 cases, union-find grouping, discriminating — 43,648 violations against the pre-fix engine) asserts one survivor, never zero, order-independent. It never asked WHICH row wins, so it reported HOLDS on the equal-cutover shape. Every pre-existing chain fixture also used distinct cutovers. An invariant probe is only as strong as the property it names.

**Gate + live (rule 5 / K.8).** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,848 passed + 1 expected fail + 1 skipped / 417 files** / build clean; `npx playwright test tests/e2e/no-dead-ends.spec.ts` 14/14. Committed `494a7ee` → pushed → **CI run 31620484428 = SUCCESS, attempt 1**, read to conclusion (full `VERIFY_E2E=1`, so the real-Prisma SIBLINGS tests ran in a real environment). Vercel production deployment `5873718071` = success on that sha. `node scripts/u9-live-deploy-check.mjs` → **18/18** (plus 2 declared SKIPs), and the earlier slices' proofs re-run clean on the new build: **U.5 12/12, U.6 13/13**. No `prisma/` diff — read-path only, the live database untouched. The live check states outright that it CANNOT discriminate this deployment: the demo seed writes no `AccountReconciliation` rows, so no combined pair can render and no demo-visible string differs between builds; it asserts only the R8 golden path that must not move, and the deployment record is what ties production to the commit.

**Known residuals, split out rather than papered over:** **U.11** — the identical sibling blind spot on TRANSACTIONS, measured at −$100.00 for one real −$50.00 purchase, reaching every spending surface. Not fixed here because a snapshot is a STOCK (a second row for one date is provably a duplicate) while a transaction is a FLOW (two $50.00 charges on one day are ordinary), so the fix needs a failure-direction decision — silent loss vs. visible double — that it cannot inherit. Locked as `it.fails` asserting the CORRECT number, so fixing U.11 turns it into an unexpected pass. **U.12** — the winner is ranked by cutover alone, so a quiet feed's carried-forward repeat can outrank another record's genuine reading for the same date.

## ✅ BUILT 2026-08-12 — U.5: the panel's rows and the chart's points are decided by ONE engine, and a row it drops says so (DECISIONS #452)

**The defect, and what the task row got wrong.** `getAccountDetail` read `BalanceSnapshot` RAW while the net-worth trend on the same page read it through `applyReconciliationBoundary`. U.4 writes both sides of a combined pair at ONE date — deliberately, because that is what lets the boundary de-duplicate them — so every month a combined pair produces a same-dated collision and one side is dropped. The panel printed the dropped row as an ordinary recorded balance, beneath a "counted as" marker and notes that state which side of net worth a date lands on: claims that were false for exactly those rows.

The row filed the defect on the PREDECESSOR's panel. That panel is **unreachable** — `filterGroup` folds a superseded predecessor out of both account groups, and the panel renders only for a row in a group, so `?detail=<predecessorId>` renders nothing. The same is true of the row's currency clause: a non-USD account is filtered out of `getAccountsView` before any row exists. Verified by reading both gates rather than inferred. The defect is real one surface over: the **successor's** panel is a live row, and the boundary drops ITS rows for every date on or before the cutover, in favour of the predecessor's. That is the shape that shipped, and the shape the tests lock.

**Shipped:** `getAccountDetail` now runs the trend's own boundary and hands each row `countsInNetWorth` plus `countedInstead` — the balance the chart used for that date, carried per row because each dropped date has its own counterpart figure (the two sides disagree, which is why one has to win). The panel shows the row, marks it, and names that figure; `src/lib/engine/account/balance-history-view.ts` holds the copy as a pure module, because a rule written in a `.tsx` cannot be locked by a unit test — the first draft proved it by shipping a singular/plural defect in the branch the component test missed.

**Critic cycle — two fresh-context critics (money/data-integrity and rendered claims): 1 P0 + 6 P1, all executed.**

1. **P0, and it was mine, introduced by an optimisation.** Scoping the boundary's snapshot input to the account's DIRECT counterparts looked like a free payload win. `keepsSnapshot` walks the chain TRANSITIVELY: in A→B→C a row of C's can be dropped in favour of A's. The truncated input hid A and returned both a wrong verdict (a row called counted that the chart counts nothing of) and a wrong figure (naming B's balance where the chart used A's). Reproduced on a real 3-link chain and now locked by one. The input set is part of the algorithm — sharing the engine is not sharing the answer.
2. **P1 — the sign explanation was deleted by the fix.** Gating the class marker on `countsInNetWorth` left a POSITIVE figure inside a liability account's history with nothing to explain it, re-opening precisely the unexplained sign flip U.6 closed. A row's SIGN is not a counting claim: the marker stays and says "recorded as" instead of "counted as". The slice's own test had asserted the deletion — a lock ratifying the defect it was written to prevent.
3. **P1 — a false claim on the same screen, twice.** `NET_WORTH_TREND_BASIS` and `netWorthPointBasis` both said the only account missing from a point is one with no balance for that date; a combined account HAS a balance and is dropped. Both now name it, and U.6's clauses survive verbatim.
4. **P1 — two cards contradicting the new marker.** "we keep both records and only ever count the live one" and the title "Counted once, on the live connection" are false for every date on or before the cutover, where the boundary counts the RETIRED side. Corrected to what the engine does: counted once PER DATE.
5. **P1 — the panel showed the balance net worth did NOT use and never the one it did**, while claiming "counting both would double it" about two balances that differ ($14,300 vs $13,100). The figure is now on the row and that sentence is gone.
6. **P1 — a currency-withheld account had no honest verdict.** One draft marked all its rows counted (the trend counts none), the other marked them all uncounted and explained it with a combine that never happened. Its panel cannot render at all, so the view now returns the same `null` a stale or foreign id gets rather than an answer with no true value.
7. **P1 — the note named an account this page deliberately hides**, with no way to find it. It now points at Account cleanup.

**Sabotage proofs (each reverted):** the pre-U.5 raw read reddens 3 server locks; the direct-counterparts input reddens the chain lock; deleting the class marker from uncounted rows reddens 1; widening either note's count to all rows reddens 1 each.

**Known residuals, split out rather than papered over:** **U.9** — sibling predecessors (two stale rows continued onto ONE live account, the shape `successorAccountId`'s non-uniqueness exists for) are de-duplicated against the successor but never against each other, so a single $5,000 account was reproduced counting as $10,000 on every date on or before both cutovers. Pre-existing in the Wave 4.6 boundary, not from this slice, and money-visible. **U.10** — a snapshot dated exactly today is marked counted, but `netWorthSeries` replaces today's bucket with live balances, so the panel names a figure the chart does not show for that one date. Also: opening a panel now issues reads `getAccountsView` already made on the same request (three round-trips); correctness first, but it is worth passing the loaded data down.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,831 unit passed + 1 skipped / 417 files** / build clean. Full local `npx playwright test`: **344 passed / 0 failed** (exit 0). Shipped as `9347c97`; **CI gate SUCCESS on run 31612606380, first attempt** — the full `VERIFY_E2E=1` suite, so the new marker, the rewritten notes and the combined-pair fixture all passed in a real browser on the Linux runner.

**Schema:** no `prisma/` diff at all — this slice is read-path only, so the live Neon database is untouched.

**Live proof, and what it cannot show:** the marker needs a confirmed reconciliation between two LOAN-class accounts sharing a date, which the demo seed cannot produce (it writes no `AccountReconciliation` rows), so `scripts/u5-live-deploy-check.mjs` proves the build is deployed and that the demo half did not move. **Before deploying, against production: 8/12** — exactly the four discriminating checks failing, which is the fail-old proof that it can tell the builds apart. **After deploying: 12/12** (plus 4 declared SKIPs), Vercel deployment `E1Dk1L5KmKTexy5FStBcGCb7G9pu`, commit status "Deployment has completed". Because this slice edits a sentence U.6 owns, `scripts/u6-live-deploy-check.mjs` was re-run against the same deployment and still reads **13/13** — the added clause did not revert U.6's disclosure. The behaviour itself is locked in a real browser at 380px by `no-dead-ends.spec.ts` on a seeded combined pair, against real Prisma by `account-detail-reconciled.test.ts` (including the chain), and as pure copy by `balance-history-view.test.ts`.

**U.9 was reproduced first-hand before being filed** (not taken from the critic's report): three accounts, two active links onto one successor, one date both cutovers cover → `getAccountsView().trend` returns constituents `["Savings (Plaid old):500000","Savings (SimpleFIN):500000"]` and `netWorthCents: 1000000` for a single real $5,000.00 account. The probe was deleted rather than left behind as a test that locks nothing.

## ✅ BUILT 2026-08-12 — U.6: a recorded balance keeps the class it was read under (DECISIONS #451)

**The defect (found by the U.4 critic, executed against the real engine):** `BalanceSnapshot` stored a balance magnitude, and whether it added to or subtracted from net worth was decided at READ time from the account's CURRENT `Account.type` — which this repo states in its own code that both providers rewrite on every ordinary sync. One reclassification across the asset/liability line rewrote the sign of every past point for that account, silently: one stored row of 1,000,000 renders `$10,000.00` as CHECKING and `−$10,000.00` as CREDIT.

**Shipped:** `BalanceSnapshot.accountType` — the class the balance was read under — written by the planner and the live writer, and by the seed so the golden dataset carries the same complete row. `isLiabilityType` stays the single sign author, applied to THAT value rather than to what the account has since become, so a later correction to the classification rule still reaches history. `NetWorthConstituent` carries the class explicitly because a stored balance's SIGN cannot recover it: SimpleFIN `abs()`es a liability, Plaid keeps its own sign (negative for an overpaid card), and an overdrawn checking or margin account is a genuinely negative ASSET.

**The slice owns a surface it created.** Pre-U.6 a reclassification re-signed both points of a comparison together — history was wrong, but the subtraction came out clean. With history pinned, two points covering the same accounts can be counted under different classes, and the delta would print 2× a balance as a month's earnings. `netWorthDelta` refuses and names it — but only when the change MOVES the figure, since the distorting term is exactly 2 × the previous balance and a paid-off card at $0.00 distorts nothing.

**Critic cycle — two fresh-context critics (money/data-integrity and rendered claims): 3 P0 + 11 P1, all executed.**

1. **The decision they reversed: no backfill.** The slice shipped a script to fill pre-U.6 NULL rows, verified on a scratch DB (36 filled, 0 remaining, idempotent). A critic proved it wrong through the real engine — a **$40,000.00 swing** — and named the property that settles it: an un-backfilled NULL row **self-heals** when a misclassification is corrected, because it is re-signed by the corrected type; a stamped row never can. Every surface renders a non-null value as an OBSERVATION, so filling it launders a guess into a record. Deleted, not fixed. (It also could not have run against Neon — the generated client is built from the sqlite schema — and with `DATABASE_URL` unset would have silently written to the local dev database while printing success.)
2. **P0** — the panel's note claimed the trend "counts every balance the way it was recorded", an absolute the slice's own NULL fallback falsifies, rendered exactly where NULL rows are most likely mis-signed.
3. **P0** — carried-forward rows were counted as balances that "were read", four lines beneath the note saying nothing had been read since a date.
4. **P1** — "money you owned at the time" asserted a classification the app cannot validate (a re-classing feed may be CORRECTING itself), contradicted the panel's own top line, and pointed at a remedy that does not exist — there is no control anywhere to change an account's type.
5. **P1** — a false refusal deleting a true +$2,000.00 delta over a $0.00 account changing sides.
6. **P1** — the chart cliff nobody explained: both delta call sites compare only the last two points, so an earlier reclassification refuses nothing while the chart keeps a permanent step. The shared trend basis sentence now names it.
7. **P1** — the fact was carried to the render and dropped: the drilldown mapped `label: c.name` and ignored `isLiability`, showing a credit card positive inside a sum called "assets minus liabilities".
8. **P1** — `netWorthSeries`'s new field was optional, so a `select` could drop it and revert that surface with a green gate. Now required: a caller must SAY null.

**Sabotage proofs (each reverted):** the pre-U.6 sign rule reddens 2 series locks; dropping the delta refusal reddens 2; repainting panel rows from the current class reddens 1; dropping the drilldown marker reddens 1.

**Known residuals, split out:** **U.7** — a reconciled pair's collision winner now decides that date's sign (filed as a shape, unverified in practice). **U.8** — the detail panel never renders for CHECKING/SAVINGS/CREDIT accounts, the likelier reclassification targets, so their per-row explanation rides on the drilldown marker alone.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,808 unit passed + 1 skipped / 415 files** / build clean. Full local `npx playwright test`: **342 passed / 1 flaky / 0 failed** (exit 0). Shipped as `e60f9b1`; **CI gate SUCCESS on run 31605655317, first attempt** — the full `VERIFY_E2E=1` suite, so the rewritten copy, the new drilldown marker and the reclassified-row assertions all passed in a real browser on the Linux runner.

**Schema:** the `prisma/` diff is ONE nullable column plus comments, so the `prisma db push` the Vercel build runs against live Neon is additive and destroys nothing. Until a sync writes new rows, every existing row is NULL and reads byte-identically to pre-U.6.

**Live proof, and what it cannot show:** U.6 deliberately changes nothing the demo can see — seeded types never move, so every demo figure and sentence is byte-identical. `scripts/u6-live-deploy-check.mjs` therefore proves two things: that the deployment IS the U.6 build (the rewritten trend basis, asserted together with the absence of the sentence it replaced, on both surfaces that draw the chart), and that the half which must NOT move did not (the demo delta still reads `+$1,667.46 vs last month-end`, and neither the new class-change refusal nor either new note misfires).

- **Before deploying, against production: 9/13** — exactly the four discriminating checks failing. That is the fail-old proof that the script can tell the builds apart, and it was worth having: an earlier draft used a whole-document `isLiability` substring match, which `household-sharing-card` also emits, so it measured which components happened to render rather than which build was deployed (the documented wrong-instrument class).
- **After deploying, against production: 13/13** (plus 4 declared SKIPs). Vercel deployment `aimplifi-72gcqqn12`, which took ~5m against the usual ~1m — consistent with `prisma db push` adding the column to Neon rather than doing nothing.

The reclassification behaviour ITSELF is unreachable on the demo — it needs a stored class that differs from the account's current one, which no seeded row has and which cannot be created without corrupting the golden dataset. Those four are declared SKIPs, never silently omitted, and are locked instead in the unit gate and in a real browser at 380px by `no-dead-ends.spec.ts`.

## ✅ BUILT 2026-08-12 — U.4: a live account gets balance history, and its shape is decided by what reads it (DECISIONS #450)

**The gap U.3 left, honestly:** the /accounts detail panel read *"No balance history recorded"* for every real account, permanently, because **only `prisma/seed.ts` had ever written a `BalanceSnapshot` row** — no Plaid or SimpleFIN path did.

**Shipped:** a pure planner (`src/lib/engine/networth/snapshot-plan.ts`) and a thin writer (`src/server/balance-history.ts`), called from the nightly `/api/cron/sync` sweep AND from both sync actions, idempotent within the calendar month, demo-fenced inside the writer itself so no trigger added later can accumulate history onto the shared seeded demo row.

**The basis decision (the money part):** ONE date across ALL of a user's accounts, stamped the day the balance was actually read.
- `netWorthSeries` sums a date BUCKET, so a bucket missing an account is an **understated net-worth figure**, not a shorter list. A per-provider writer would date SimpleFIN accounts and Plaid accounts differently — 25 against 13 on the owner's live corpus — making every historical point a partial sum.
- `reconcile-boundary.keepsSnapshot` de-duplicates a reconciled pair **only on an exact-date collision**, and a reconciled pair here is cross-provider by definition. Different dates would defeat it and count one real account twice. The FAIL-OLD lock in `networth-snapshot-plan.test.ts` runs the split-date case through the real boundary and shows the double presence.
- No synthesized month-end: that would either write a future-dated row (invisible until the month closes, then asserting as month-end a figure observed weeks earlier) or force rewriting the row all month. The schema comment that DEFINED the model as month-end — what every later writer would have read — is corrected.

**Critic cycle — two fresh-context hostile critics (money/data-integrity and rendered-claims): 1 P0 + 7 P1, all executed.**
1. **P0** — a quiet feed's carried-forward rows printed as dated observations, directly beneath the amber note saying the bank stopped sharing the account and the balance "has not changed since". Fixed: `feedDroppedAt` travels with the history and each row after it is marked *carried forward*, with a note naming the last date anything was read.
2. **P1** — the delta under the net-worth headline compared points built from DIFFERENT account sets: add an account mid-month and it printed −$251,200.00, or +$50,000.00 in green depending only on arrival order. Pre-U.4 a live user had one point so it never rendered at all; this slice created that surface. `netWorthDelta` now refuses the comparison and names the reason.
3. **P1 × 5** — copy asserting a shape or completeness the code no longer had: the chart footnote (now ONE shared positive admission rule on BOTH surfaces — /accounts had none at all), the drilldown's "every account's balance", the live basis's "not a month-end snapshot", the "vs last month-end" label across a gap, and **the exported PDF's "Trend (month-end)" heading** — the one artifact handed to a third party.
4. **P2** — both trend reads were unwindowed and now grow ~accounts × 12 rows a year into the page payload; bounded to 19 months, one more than the 18 points the chip strip renders.

**Sabotage proofs (each reverted):** a "snapshot only what the feed refreshed" writer turns the completeness lock red; a same-day-only guard turns the calendar-month lock red; deleting the cron's call turns the wiring lock red.

**Known residuals, split out rather than papered over:** **U.5** — the detail panel reads snapshots raw while the trend reads them through the reconciliation boundary, so a reconciled pair's panel can name a balance the chart does not count. **U.6** — `netWorthSeries` signs a stored row by the account's CURRENT, mutable `type`, which both providers rewrite on every sync, so a reclassification across the asset/liability line retroactively flips the sign of recorded history.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,786 unit passed + 1 skipped / 415 files** / build clean. Full local `npx playwright test`: **341 passed / 2 flaky / 0 failed** (exit 0). Shipped as `2a8fbf1`; **CI gate SUCCESS on run 31565312675, first attempt** — the full `VERIFY_E2E=1` suite, so the changed panel and copy assertions passed in a real browser on the Linux runner. The `prisma/` diff is COMMENT ONLY (verified by reading the diff: no column, index or constraint changed), so the live Neon database is untouched.

**Live proof:** `node scripts/u4-live-deploy-check.mjs` → **11/11 checks PASS** against production (plus 2 declared SKIPs). Each check asserts the new sentence AND the absence of the one it replaced, so a stale deployment cannot pass it. It also asserts the half that must NOT have moved: the demo's delta still reads "+$1,667.46 vs last month-end", byte-identical, because the seeded buckets are complete and its previous point is a true month-end.

**What the live check deliberately CANNOT prove, and the event to watch instead:** the writer itself. The shared demo user is fenced out of it by construction, and the one real production user's rows appear on his **next nightly cron sweep (`0 11 * * *`) or next sync, whichever comes first** — that is when his /accounts detail panels start showing recorded history and his net-worth trend gains its second point. Not "the number moved on deploy". The writer's own contract is locked against real Prisma (`balance-history-server.test.ts`) and its wiring through the cron route (`cron-sync-snapshot.test.ts`).

## ✅ BUILT 2026-08-11 — U.3: account clicks land somewhere true — the owner's mortgage dead-end closed across its whole class (DECISIONS #449)

**The report (owner, with screenshot):** *"when i click on my mortgage in accounts, why does it bring me to a completely empty transaction page?"* — plus the standing directive to make every click make sense. The defect was structural, not cosmetic: the register's basis is `SPENDING_ACCOUNT_TYPES` (#62), so **8 of the 11 account types linked from /accounts to a page empty by construction**, the account dropdown (built from rows-present) could not display the active filter — "the controls below say which" was false exactly on that screen — and the empty state blamed "these filters", a remedy that cannot work.

**Shipped (full decisions in DECISIONS #449):**
- **`accountRowDestination`** (new engine module, one author over the register's OWN type set): spending → register, brokerage → holdings (#159 kept), everything else — LOAN, MORTGAGE, REAL_ESTATE, VEHICLE, CASH, OTHER_* — expands an **in-place detail panel** on /accounts (`?detail=<id>`, server-rendered, back-button collapses). The panel (`account-detail-panel.tsx`) renders only held facts: net-worth role, loan terms when the feed supplied them, recorded balance history with the row's own liability sign — and an honest "No balance history recorded" for live accounts, because **only the seed writes BalanceSnapshot rows** (queued as TASKS U.4, the snapshot writer at sync time). **Manual rows open too** — a hand-added mortgage is the app's modal mortgage (critic P1).
- **The register answers every `?account=` it can't populate by naming WHICH zero:** `account-not-here` (with a currency-vs-type discriminator), `account-empty` (in-basis, zero rows), `account-unknown` ("isn't one of your own"); decided above the window branches; the count line names the account zeros beside the $0.00 tiles (F2 rule extended). The dropdown lists the **filterable set** (zero-row spending accounts included, superseded predecessors excluded on the /transactions/new basis), and a filter its options don't hold is **injected into the select itself** — no more "All accounts" painted over an active filter, and choosing All accounts is a live escape.
- **Standing copy corrected on four surfaces:** /transactions greeting + nav ("spending accounts", not "all your accounts"), /accounts subtitle + nav ("Tap an account to open it").

**Critic cycle (fresh-context, adversarial): FIX-FIRST with 4 P1 / 8 P2 — all twelve executed** (manual rows; account-empty; the real-user panel lock; server authz locks; currency contradiction; injected option; count-line zeros; superseded predecessors + two stale comments; possessive holdings claim; softened unknown copy; aria-controls/panel id). One finding of the critic's was about evidence, not code: the demo e2e alone proved only the seed's best case — so the panel's REAL-user shape (no snapshots, no loan facts) is now locked in `account-detail-panel.test.tsx` AND driven in a browser by a throwaway-signup e2e that hand-adds a mortgage.

**Gate:** `bash scripts/verify.sh` — **GREEN, exit 0: tsc 0 / eslint 0 / vitest 6,761 passed + 1 skipped (413 files) / build clean.** e2e: `no-dead-ends.spec.ts` full spec **13 passed** (three new journeys: demo Auto Loan expands in place; hand-added mortgage opens with the real-user shape; zero-row card names its own zero; the stale deep link names the account in the select with a live escape); adjacent `investments.spec` + `category-drilldown.spec` green in the same batch. Authz locks: a stranger's account id resolves `'unknown'` / `null` (`register-account-filter-server.test.ts` — delete `userId` from either where-clause and they go red). Ledger reindexed for #449 (ledger test 16/16). **No `prisma/` diff — the live Neon database is untouched.**

**Gate read (rule 5/K.8):** CI run **31559826062 on `fb2ad52` = SUCCESS, first attempt** — the full `VERIFY_E2E=1` suite, read via `scripts/ci-status.sh` (exit 0). **Live deploy proof: PASS 9/9** (`scripts/u3-live-deploy-check.mjs`, Pixel-5 emulation against www.aimplifi.app, exit 0 from the script itself — the first run's `| tail` had reported tail's exit over a 8/9, the `proof-is-the-full-output` trap, caught and re-run): subtitle honest, Auto Loan row hrefs `/accounts?detail=acct-autoloan`, panel renders role + loan facts + 18 rows of declining balance history, the deep link names the loan in both the empty state and the select, count line names the zero, zero page errors. One check made data-adaptive on inspection: the PRODUCTION demo's loan row carries `aprBps` + `dueDayOfMonth` but a NULL `minimumPaymentCents` (seed drift vs the local dataset) — the panel's contract is to render exactly the held facts, and it does; the all-three case stays locked by the CI e2e on the seeded set.

**Known residuals (deliberate):** U.4 (BalanceSnapshot writer for live synced accounts — until it ships, live panels show no history, honestly; **SHIPPED 2026-08-12, see the U.4 entry above** — the two claims in this U.3 entry that only the seed writes snapshots were true when written and are not now); /investments `?account=` silent full-portfolio fallback (#160's documented decision — the copy no longer overclaims, a visible-chip fix is a candidate row for Wave U).

## ✅ MEASURED + SHIPPED 2026-08-11 — O.20b: the /reports payload measured against the heavy real account — the rows are the feature, both suggested trims falsified, and the one dead weight was /dashboard's 89% (DECISIONS #448)

**The queued task:** `monthFlows` ships the transaction rows behind every bar of the income-vs-spending chart (six months at the default window) — "~6× this route's RSC payload, unmeasured against a heavy real account". The row prescribed: measure first, then choose between a per-bar fetch (which would break the same-array guarantee) and trimming `rawDescriptor` from chart panels.

**Measured first** (new read-only probe `scripts/audit-probes/o20b-reports-payload.mts`, the o20a pattern: raw `pg` against production, the shipped engines composed exactly as `getReports` assembles them, with the merchant JOIN `registerDisplayName` reads — byte fidelity requires the label; type-checks clean under the one-off `.mts` `--project` check, the O.20k mechanism, temp tsconfig not committed):

| Window | Payload | monthFlows | monthFlows rows (bars) | Largest bar |
|---|---|---|---|---|
| 6 mo (real user) | **316.9 KB** | **282.6 KB (89%)** | 1,415 across 12 | 305 rows |
| 12 mo (real user) | 403.4 KB | 368.7 KB (91%) | 1,853 across 24 | 305 rows |
| 24 mo (real user) | 508.7 KB | 473.4 KB (93%) | 2,375 across 48 | 305 rows |
| 6 mo (demo) | 49.9 KB | 41.1 KB (82%) | 213 across 12 | 41 rows |

The one-month baseline (the pre-feature shape the row's "~6×" refers to) measures **21.4 KB** — the six-month carry is **13.2×**, not ~6×: complete trailing months hold more rows than the asOf-clamped current month. `rawDescriptor` is present on **86% of the real user's rows (1,217/1,415)**; dropping the field entirely would save ~44.5 KB (14%).

**The decisions (all recorded in DECISIONS #448):**
1. **Per-bar fetch: REJECTED** — the row's own framing (a re-query can sum to a different number than the painted bar; panels reconcile against it).
2. **rawDescriptor trim: REJECTED, falsified by reading the consumer** — it is a RENDERED line (`breakdown-panel.tsx:256-263`, "the line the question is actually about: it is what the categorizer read before deciding on this bucket"), present on 86% of the real user's rows, already deduped at build. Trimming deletes a displayed feature to save 14%.
3. **The /reports six-month carry: KEPT** — the rows ARE the O.20 feature ("every single bar immediately available"); 316.9 KB is that page's reason for existing on the heaviest account. 12/24-month sizes recorded for the owner's awareness.
4. **The measured dead weight: /dashboard pays 282.6 KB (89% of its reports payload) for rows no surface on the page renders.** Its call (`dashboard/page.tsx:69`) reads exactly four fields — `breakdown`, `breakdowns`, `ym`, `notCountedYetCents` (TopSpendingCard's props). Shipped: `getReports(userId, months, { includeMonthFlows: false })` — ONE assembler stays one author for both callers (a second lean function would be a second copy of the composition, the drift shape the panels exist to prevent); /reports always ships the rows; the dashboard's figures are byte-identical by construction. Locked in `tests/unit/spend-window-parity.test.ts` (O.20b block): opt-out yields `monthFlows: {}` while everything the dashboard reads equals the full payload's — **fail-old proven by mutation** (deleting the opt-out from `server/reports.ts` turns the lock red at `expect(lean.monthFlows).toEqual({})`; reverted, green again). The default payload's `2026-06:expense` bar row count is locked too.

**Gate:** tsc 0 / eslint 0 (probe cleaned of 4 unused-import warnings; product files zero errors) / full vitest 6,722 passed | 1 skipped (exit 0, including the parity suite 25/25 with the 2 new locks and the ledger test 16/16 after the `ledger.ts reindex` for #448) / `bash scripts/verify.sh` GREEN (exit 0, build clean) / **CI run 31554704790 SUCCESS on e40f321, first attempt** (scripts/ci-status.sh, rule 5/K.8 read). No `prisma/` diff — the live Neon database is untouched. Also observed (recorded for Wave G.2, not fixed here): the one-off `.mts` `--project` check surfaces **21 pre-existing errors across 11 other probes** — the documented class, untouched by this slice.

## ✅ BUILT 2026-08-11 — O.20f: the five O.20d controls carry the tap-target floor, plus the seven same-file P2s (verify green, shipped)

**The P1 (WCAG 2.2 AA 2.5.8, in the Definition of Done):** making the O.20d bars controls is what created the violation. An allocation segment's BUTTON was the painted bar (`h-2.5` = 10px tall, width = the position's weight) — the demo's NVDA segment was a **34×10px** target at 380px, and a portfolio priced at 0 rendered every segment `width: 0%` (nothing openable by touch at all). The retirement strip is worse by count: up to 103 bars share ~316px ⇒ **≈4.7px each**, and a mis-tap returned the WRONG refusal on the WRONG bar. Two of three fresh-context O.20d-FU critics found the class independently, on different surfaces. The e2e missed it because Playwright's `.click()` hits an element's center at any size, and the mobile-380 gate measured two hand-picked controls.

**The fix:**
- **Allocation:** the LEGEND entries are the buttons (they already carried symbol + swatch + index) with the full 44px `.tap-target` floor; the bar stays a picture — `role="img"` with a composed aria-label ("Portfolio allocation by symbol: NVDA 34%, …"), colors stable by segment index, rounded ends on first/last. The `investments-allocation` testid stays on the wrapper so the existing e2e locator pattern still resolves.
- **Retirement:** the strip is `overflow-x-auto` with a 24px minimum bar width (`min-w-6`, the WCAG floor) — a 24×64px bar is still a target a finger can land on; the strip scrolls past 103 bars.
- **Net-worth chips and forecast day chips** carry `.tap-target`.
- **The gate can see the next one:** `tests/e2e/tap-targets.spec.ts` now enumerates all five O.20d surfaces (creep bars, net-worth chips, forecast chips, allocation legend, retirement bars), each measured under the mobile-380 project where `pointer: coarse` makes the floor live.

**The P2s (all from the O.20d-FU critics, same files):**
- **(a/b)** `allocationPercent` (new pure display module, unit-locked): a sub-0.05% position renders **"<0.1"** — the critic case, $3.00 in a $1,000,000.00 portfolio, no longer announces "0.0%"; whole percents are decided on the ROUNDED side (`Math.round(v*10)`), so an exact 50/29/14/7 split renders **"50% · 29% · 14% · 7%"**, never the IEEE754 residue's "29.0% · 7.0%". Exactly zero renders "0" — that IS 0%, not a rounding artifact.
- **(c)** net-worth constituents are sorted by **name** (accountId tiebreak) in the engine's final map, so the "Apr 30" and "Today" panels list the same accounts in the SAME sequence (Σ is order-invariant — sorting never moves a figure).
- **(d)** new `usePanelToggleFocus` hook, wired at **all five** call sites: the panel's inner Hide unmounts the panel the toggle lives in, dropping focus to `<body>`; the opening control is remembered on click and refocused on collapse. e2e-locked per surface (each o20d-bars test now Hides from inside the panel and asserts focus on the opener).
- **(e)** row keys index-suffixed (`${accountId}:${i}`) — the engine's own two-same-account-snapshots input (blessed by its test) no longer collides on the React key.
- **(f)** the chip strip is capped at the card's documented **18-month window** (tail-slice, live "Today" point always last by construction); render-locked: >18 points renders exactly the most recent 18, ≤18 renders all. The chart still draws the full history.
- **(g)** the month-end basis sentence is derived from the **date itself** (`isMonthEnd(date) ? "month-end balance" : "balance on"`), so the seed's documented invocation `npx prisma db seed -- --asOf 2026-05-15` (with `DEMO_TODAY` still 2026-06-10) writes exactly one mid-month point, and its chip opens a panel reading **"balance on Fri, May 15"**, never "month-end balance" over a date that is not one. The known coupling (`netWorthMonthEndBasis`'s "every snapshot writer today writes month-ends" was false of the writer it named) is broken; `seed/build.ts`'s `back === 0` docblock names the invocation.

**Gate:** `bash scripts/verify.sh` — **GREEN**: tsc 0 / eslint 0 / **6,720 unit passed + 1 skipped / 409 files** / build clean. e2e: the two changed specs run locally — **14 passed** (tap-targets 7, o20d-bars 7, the latter now carrying the per-surface focus-restore assertions). No `prisma/` diff — the live Neon database is untouched.

**Flake note (recorded per CLAUDE.md):** one mid-session vitest run showed **22 scattered failures across 10 unrelated server/ingest files** (simplefin backfill/pending-reconcile, keyword-rules, combine-connections, income-pause, ingest-prediction-log, plaid-institution, accept-all-confident, transaction-spend-class — none touched by this slice). A clean standalone re-run passed the **full suite** (6,720/6,720). Not reproducible ⇒ environment flake, not a code defect; the failures were in files this slice never imports or modifies.

**Critic:** the O.20f row routes to **DeepSeek V4 Flash (UI); no money math** — no hostile-critic pass owed (the P2s themselves were generated by the O.20d-FU critics and executed to their prescription; the one open choice in each — sort key, cap size, derive-vs-drop — is recorded in DECISIONS #447).

**Gate read (rule 5/K.8).** CI run **31549221724 on `bee791a` = SUCCESS, first attempt** — the full `VERIFY_E2E=1` suite (14 of its tests are this slice's changed specs: the 7 tap-target measurements + the 7 o20d-bars gesture tests with the new focus assertions), read via `scripts/ci-status.sh` (exit 0). **Live deploy proof: PASS** — `scripts/o20f-live-deploy-check.mjs`, 8 checks against www.aimplifi.app under the Pixel-5 emulation: net-worth chip 44px, forecast chip 44px, creep bar 56px, retirement bar 24px wide with `overflow-x: auto` computed, inner-Hide focus returned to the chip (`activeElement=net-worth-point-2025-01-31`), zero page errors; the allocation-legend check SKIPPED loudly (the production demo has no holdings — its honest empty state; the surface is covered by the CI e2e gate on the seeded set, same data-adaptive pattern as the O.20d check).

**Docs-chain gate read (the record behind the record).** The first docs commit (3619c0e: DECISIONS.md #447, TASKS.md, STATUS.md) failed its own gate — run **31550320738**: `tests/unit/ledger-decisions-index.test.ts` ("carries exactly one index row per decision") expected rows [1..426] where `docs/DECISIONS_INDEX.md` had [1..425] — #447 was appended without the reindex. Fixed by `npx tsx scripts/ledger.ts reindex` (ledger test 16/16 locally) and pushed as **4836039** → run **31551214063 = SUCCESS, first attempt**, the full `VERIFY_E2E=1` suite including the two CSV tests below. The same run 31550320738 also carried two e2e CSV-import failures in `tests/e2e/transactions.spec.ts` (`:638` "re-importing the same file adds nothing — duplicates reported, depth shown"; `:735` "a double-pasted export warns with the repeated-row count") — both pass locally (**2/2, 11.8s**), in a file the docs push never touches, and green on the run before (31549221724); recorded here per rule 5 as the non-reproducing flake class under CLAUDE.md's environment-flake rule, not a code defect. No `prisma/` diff on any of the three pushes — the live Neon database was never touched.

## ✅ BUILT 2026-08-11 — O.20k: the shipped O.20g probe's reconciliation-boundary call fixed and its magnitudes re-verified (DECISIONS #445 residual)

**The defect (inherited from DECISIONS #445, filed by O.20a as TASKS O.20k):** `scripts/audit-probes/o20g-creep-income-refunds.mts:152` called the keep closure with a single object — `keep({ accountId, date })` — while `reconciliationTxnKeepFilter` returns `(accountId: string, date: string) => boolean` (two positional args, `reconcile-boundary.ts:383`). The object fails every keyed lookup (coerced to `"[object Object]"`), both branches needing a real `date` never run, and the closure falls through to `return true` for every row — so every reconciled predecessor/successor pair double-counted, and every probe-computed magnitude in DECISIONS #445 / TASKS O.20g / STATUS §O.20g / EDGE_CASES.md / the O.20g lesson was tainted against this user's 27 active reconciliation links. Same class as the P0 the O.20a critic caught in its own probe's first draft — and, like that one, invisible to `npx tsc --noEmit`, because `.mts` probes are not in `tsconfig.json`'s compile set (Wave G row remains open).

**Fixed and re-run (one line: `keep(t.accountId, t.date)`).** The sweep of all nine boundary-using probes confirmed every other call site already used the two-arg form. The probe also carried the O.20a critic's second class: `Acc` was missing `currentBalanceCents` (required by `BoundaryAccountLike`) — a latent type error with no runtime effect (the boundary reads only `id`/`type` at runtime), fixed to match the O.20a probe's idiom, and the file now compiles clean under the one-off `--project` check (exit 0).

**The re-verified magnitudes, against production, window 2026-02..2026-07:**

| Figure | Originally recorded | Re-verified |
|---|---|---|
| Positives the old rule counted as income, `isIncomeFlowRow` refuses | 67 rows / $38,619.68 | **42 rows / $28,673.90** |
| First-half income median | $10,604.95 → $0.08 | **Reproduces exactly** |
| Shipped income growth | 70,470,525% | **40,607,025.0%** |
| Discretionary spend growth | ~153% | **~59.7% (approx meta)** |
| Verdict state | refused | **Unchanged** (`incomeMeasured=false` → "Can't compare yet"; baselines $0.08 vs $6,046.67) |

**Reading:** the first-half median reproduced byte-for-byte (the boundary's double-counted rows did not touch those three months' medians), while the second-half median falls (implied $56,376.42 → $32,485.70) — the reconciliation boundary's effect was entirely in the second half. O.20g's DIRECTION and its shipped engine fix are confirmed, not merely assumed; only the magnitudes changed, and they are now corrected at every recorded site (DECISIONS #445 Decision (0) + #446 parenthetical, EDGE_CASES.md, STATUS §O.20g, TASKS O.20g, `docs/lessons/measure-the-prescribed-fix-not-just-the-bug.md` — whose quoted probe output is corrected to the re-verified block, with the old-rule growth figures (592%, 153.3%) dropped rather than guessed at, since the corrected probe does not reproduce them). "Seven orders of magnitude" was an overstatement even of the tainted pair; the corrected claim is five orders.

**Gate:** no product code changed — a probe fix + a record correction. `bash scripts/verify.sh` — **GREEN**: tsc 0 / eslint 0 / **6,710 unit passed + 1 skipped / 407 files** (standalone re-run of the vitest stage for the count: same numbers) / build clean; e2e skipped locally (VERIFY_E2E opt-in), shipped via the CI gate below. The probe compiles clean under the one-off `.mts` `--project` check (exit 0) and re-ran read-only against production. No `prisma/` diff.

**Gate read (rule 5/K.8).** CI run **31544899626 on `8c5659f` = SUCCESS, first attempt** — the full `VERIFY_E2E=1` suite, read via `scripts/ci-status.sh` (exit 0). GitHub commit status `success` with `Vercel: success` ("Deployment has completed") on the same sha. No live-deploy proof is needed or claimed: this slice changed no user-facing behavior (a probe fix and record corrections — there is no new marker for a production check to discriminate on); Vercel auto-deploys the commit regardless, and the CI gate is the complete proof for a diff of this shape (the O.20a precedent).

**Also filed this slice (record integrity):** the `.mts`-invisible-to-`tsc` class was claimed "filed as its own row (Wave G)" by both DECISIONS #446 and TASKS O.20k — checked against Wave G, the row did not exist. Filed as **TASKS G.2** with the two incidents as evidence.

**Docs-chain gate read (rule 5).** CI run **31545561845 on `c8788b1`** (docs-only: this record plus the G.2 row) = **SUCCESS, first attempt** — so head of main is green behind both the O.20k code and the record commit it carried.

## ✅ MEASURED 2026-08-11 — O.20a: the /reports basis gap is not what the task row thought it was (DECISIONS #446)

**The queued task:** /reports prints one month's spending on two bases that can disagree — the income/expense CHART (`countsInFlows`) and the "Spending by category" CARD (`isSpendRow`) — measured at $299.93 on the demo, with an existing disclosure that deliberately names only the DIRECTION of the gap, never a mechanism. The row asked whether to unify the bases, give the card the chart's basis, or leave the disclosure. PROGRESS.md's carried note corrected the row's own count: "SEVEN divergences, not the five the row records."

**Measured first, per the row's own instruction.** New read-only production probe (`scripts/audit-probes/o20a-reports-basis-gap.mts`, the C.19/O.20g pattern): calls the shipped `countsInFlows`, `isIncomeFlowRow`, `monthlyFlows`, `isSpendRow`, `spendingByCategory`, `spendRowCategoryId`, `spendContributionCents`, `spentSoFarWindow`, `wholeMonthWindow` directly, reproduces `reports-view.tsx`'s own `basisGapCents` formula exactly, and tags every divergent row against six source-traced mechanisms with file:line citations in the probe's own docblock.

**Self-correction before anything was recorded.** A fresh-context Opus critic reviewed the probe against real source and found a P0: `reconciliationTxnKeepFilter` takes two positional args (`accountId, date`), and the first draft passed a single object — a silent no-op (proven with a controlled fixture) that inflated 3 of 6 historical months by up to 4.6x on this user's 27 active reconciliation links. Fixed (one line), independently re-run, numbers reproduce the critic's own corrected table exactly. The critic also caught two latent `tsc` errors invisible to the normal gate (`.mts` probes aren't in `tsconfig.json`'s compile set at all — confirmed via `tsc --listFiles`) — fixed via a manual `--project` check built for the purpose.

**The finding: the demo and the one real production user are dominated by completely different mechanisms.** The demo's $299.93 is **100% pending (R1)** — three seeded rows — and every trailing complete month is a clean **$0.00**, to the penny; a single-mechanism, textbook case. The real user shows the opposite shape: R1 **never fires** (zero pending rows in the whole snapshot); the current-month gap is **$4,301.23** (48% of the smaller figure); trailing months run **$1,286.72–$10,039.57, every month**. The dominant driver is rows filed to `categoryId==='transfer'` whose `isTransfer` boolean is `false` (**76 such rows corpus-wide**, against 132 correctly flagged) — `countsInFlows` has no category check at all and admits them; `isSpendRow` excludes them. A second, related mechanism (a $7,792.97 "Overdraft Transfer from Brokerage" miscategorized to Fees & Charges, also `isTransfer:false`) dominates one month via the per-category floor. Plus a **converse leak invisible to this measurement by construction**: `isTransfer=true` rows filed under 15 real spending categories vanish from BOTH bases identically, under-counting real spending with no gap to surface it.

**Decision: no basis change in O.20a itself.** The real driver is a transfer-DETECTION reliability problem (inconsistent `isTransfer` flagging and categorization), not "two reasonable definitions of spending." `countsInFlows`/`isSpendRow` are shared well beyond /reports (`/coach` savings rate + Money Review, Ask's income answers) — a fix here isn't safely scoped to this slice, per `check-what-the-fix-breaks-before-what-it-fixes`. The existing no-mechanism disclosure stays exactly as shipped; the measurement now BACKS that restraint rather than merely assuming it. Filed as their own rows: **O.20j** (the transfer-reliability finding, its own critic-gated slice) and **O.20k** (the inherited reconciliation-boundary bug in the already-shipped `o20g-creep-income-refunds.mts`, which means DECISIONS #445's specific dollar figures are unverified against this user's reconciliation links, though its direction and engine fix are not in question).

**Gate:** no product code changed — a measurement + decision, not a fix. `bash scripts/verify.sh` run for the Definition of Done anyway (a new file under `scripts/`) — **GREEN**: tsc 0 / eslint 0 / **6,710 unit passed + 1 skipped / 407 files** / build clean; no `prisma/` diff.

**Gate read (rule 5/K.8).** CI run **31539275068 on `e7f7906` = SUCCESS, first attempt** — the full `VERIFY_E2E=1` suite, no rerun — read via `scripts/ci-status.sh` (exit 0). No live-deploy proof is needed or claimed: this slice changed no user-facing behavior (a measurement, a decision, and docs), so there is no new marker for a production check to discriminate on; Vercel auto-deploys the commit regardless, and the CI gate is the complete proof for a diff of this shape.

**Docs-chain gate read (rule 5).** CI run **31540258999 on `0a4de26`** (docs-only: the gate-read record above) = **CANCELLED on attempt 1** — not superseded by a newer push (`origin/main` confirmed still at `0a4de26` when the cancellation was read; no intervening commit exists), so the rule 5 "a newer push superseded this one" reading did not apply here. `gh run rerun 31540258999` → attempt 2 = **SUCCESS**, read via `scripts/ci-status.sh` (exit 0). Head of main is green behind both the O.20a code and the record commit it carried.

## ✅ BUILT 2026-08-11 — O.20g: merchandise returns stop counting as income, and the creep card learns to say "I can't compare that" (verify green)

**The queued task, and why its own prescription was wrong.** TASKS O.20g reported that `detectLifestyleCreep` added EVERY positive row to its income series, so a return counted as a raise — printing "income grew ~33.3%" and, because `flagged` is a DIFFERENCE, silencing the very warning the detector exists to raise. The row prescribed the fix: gate the accumulator with `isIncomeFlowRow`, the predicate `monthlyFlows` already uses on the same page (#166).

**A read-only production probe was written first, and it falsified that.** Replaying the engine per real user (`scripts/audit-probes/o20g-creep-income-refunds.mts`, the C.19 pattern) showed the gating ALONE made the owner's own figure **worse**: 42 positives totalling $28,673.90 left his income series, the first-half income median fell from **$10,604.95 to $0.08** (one interest credit — the month before it carried 59 rows and zero income rows), and income growth went from 592% (old rule) to **40,607,025.0%**. That number never printed, because the sentence carrying it only renders when flagged — but it silenced the flag, so his /coach page said "Spending growth is tracking income growth — no lifestyle drift detected" while his discretionary spending grew ~59.7% (approx meta). Shipping the row as written would have left that false all-clear in place and made the underlying figure five orders of magnitude worse. *(Magnitudes re-verified 2026-08-11 under O.20k — the probe's first run carried a silent reconciliation-boundary bug, so the originally recorded figures (67 rows / $38,619.68; 592% → 70,470,525%; ~153% spend) were tainted; the first-half median and the verdict state reproduce exactly, the rest are corrected as written here — see §O.20k.)*

**So two things shipped together.**

- **The income series uses the app's one income predicate.** A refused positive is DROPPED, never netted into the bar: the creep bar is deliberately GROSS discretionary spend and the O.20d-FU disclosure exists to say so, and netting would move a live figure on three surfaces and falsify that sentence.
- **A zero that is a refusal is named, and the card gains a THIRD verdict.** `halfGrowth` returns 0 both for a genuinely flat series and when there is nothing to divide by, and every consumer read `flagged` as a binary over income — `false` rendered "Tracking income" / "no lifestyle drift detected" / "See the income in your activity". `CreepResult` now carries `incomeMeasured`, `spendMeasured` and both first-half baselines; `flagged` requires both sides measured; and `COACH_COPY.creepCard` composes title, body and link together in the engine, because a three-way rule in a `.tsx` cannot be locked and those three must never disagree about which state the reader is in.

**THE RULE, and the rule that was rejected.** `incomeMeasured` = the first-half income median is positive AND at least the first-half discretionary median. Self-referential, no dollar threshold: this card compares exactly these two series, so if the income visible over the baseline months is smaller than the discretionary spending it is being compared with, the app is not seeing the income that paid for that spending. **A COVERAGE rule — refuse when any window month carries no income row — was built first and rejected after two independent critics broke it from opposite sides.** Too weak: `interest-income` is Income-group, so 8 cents of monthly savings interest satisfies a month count while the reader's payroll account is unlinked, and the card then asserted "income was flat" — the same fabrication class as the bug being fixed. Too strong: a median of three is unmoved by ONE missing month, so vetoing on a single gap silences a correct figure for anyone paid ten months a year. The median's robustness is exactly why the rule has to be about the baseline and not about attendance.

**Three fresh-context hostile critics (money/engine, copy honesty, wiring/test-validity). All three returned FAIL on the first pass — 2 P0 + 6 P1 between them, every finding executed rather than argued, all fixed.**

- **The sharpest finding was that the slice's own locks did not bind.** Proven by mutation: restoring the old income accumulator left the whole suite green, because a one-month refund fixture cannot move a three-month median — the "fail-old" comment's arithmetic was simply wrong. Every lock was rebuilt and the complete set re-proven by an **eleven-mutation battery** (each fix reverted in turn; all eleven now go red). One fix — the recap sentence below — had NO binding lock until that battery found it.
- **P0: the Money Review silently dropped its watch line.** `selectDeterministic`'s watch chain is a hardcoded `price-increase ?? creep ?? clear`; the new candidate id was added to the closed set and emitted (suppressing `watch-clear`) but not added to the chain, so the role resolved to `undefined` and was filtered out — two recap rows instead of three, the module's own byte-for-byte contract false, and the "Personalized" badge firing because the floor was broken.
- **P0: the spend-side refusal claimed more than it tests.** `spendMeasured` is a MEDIAN test, false when half the first-half months are empty — but the copy said "the first half recorded no discretionary purchases", which the card's own bar strip can contradict on screen with a named restaurant. It now says "most months in the first half".
- **P1: a recap sentence with no input behind it.** `reviewCreepSpending` took the spend figure alone and hard-coded "while income is flat", printing beside a card that said income fell 50% — and rendered "is up ~-10.0%" whenever the figure fell, which is reachable exactly when it renders. It now takes the whole result and shares one `growthPhrase` helper with the card.
- **P1: the link label asserted a definition its destination does not implement.** `matchesType(t, 'income')` is a SIGN filter, not `isIncomeFlowRow`, so "Check what the app counts as income" would land the reader on the very credit the sentence above calls "no income". It now describes what it opens.
- **P1: the refusal printed the figure it was refusing** — a card headed "Can't compare yet" opening with "Typical income grew ~6,249,900.0%". It now prints only the measured side's growth, plus both baselines verbatim so the reader can check it.
- **A crash of my own:** the new baseline fields passed a NaN median to `cents()`, which throws, so `detectLifestyleCreep` at `windowMonths <= 1` **threw instead of refusing**. A non-finite median is now collapsed to 0 at the boundary.

**The demo verdict does NOT move** — measured on the seed at DEMO_TODAY before and after: flagged, spend +25.5%, income exactly flat, both sides measured, zero refused positives. The task row's "re-baselines the demo golden" was wrong; no golden moved.

**Gate:** `VERIFY_E2E=1 bash scripts/verify.sh` **GREEN** — tsc 0 / eslint 0 / **6,710 unit passed + 1 skipped across 407 files** / build clean / **e2e 331 passed, 2 flaky, 0 failed (7.2m)**. The two flaky are documented K.8-family members untouched by this diff (`category-rename.spec.ts:110`, `transactions.spec.ts:638` — the forensicked CSV wedge), both absorbed by the configured retries. No schema change (empty `prisma/` diff). One earlier gate attempt failed on this slice's OWN new spec and is named rather than waved away: the fixture posted an identical charge at an identical payee on the same day of six consecutive months, which the recurring detector correctly read as a subscription with a $1,500/mo price increase — and `watch-price-increase` correctly outranks the new creep line in the recap, so the page was behaving exactly as designed. The fixture now varies payee and day.

**Residuals, named not hidden (TASKS O.20i):** (a) a reader whose discretionary baseline is ALSO near zero satisfies `income >= spend` and the ratio still explodes — vanishingly narrow, absent from the live corpus; (b) a genuinely low-income reader living off a portfolio the app cannot see is now refused by design, which is the honest direction but is a live copy change on an unbounded population. Both re-measurable with the probe, which calls the shipped engine and prints both baselines plus the rendered verdict per real user.

**Gate read (rule 5/K.8).** CI run **31531559114 on `bf40c37` = SUCCESS, first attempt** — the full `VERIFY_E2E=1` suite, no rerun — read via `scripts/ci-status.sh` (exit 0). Vercel commit status `success` ("Deployment has completed") on the same sha. **Docs-chain gate:** CI run **31532820819 on `8b0fe65`** (docs-only: this record plus two lessons) = **SUCCESS, first attempt** — so head of main is green behind both the O.20g code and the record commit it carried.

**Live (production, on `bf40c37`):** `node scripts/o20g-live-deploy-check.mjs` — **DEPLOY PROOF: PASS, 11 checks.** The refusal verdict itself is NOT reachable on the production demo (its income is covered by construction — that state is covered by `coach-creep-verdict.spec.ts` on a throwaway user, in the CI gate), so the check discriminates on what this slice changed on the MEASURED path, which no pre-O.20g build can render: the new `creep-title` testid (the title was inline text before), the demo's exactly-flat income now reading **"income was flat"** with the old "income grew 0.0%" wording **GONE**, no negated-percentage growth phrase, the link matching the verdict, and — on the ONE demo month that carries a discretionary credit (2026-05; measured on the seed, the other five are false, so clicking `.first()` would have made this check vacuous) — the panel disclosure now reading "does not reduce this figure" with "counts as money in" gone. Zero page errors.

## ✅ BUILT 2026-08-11 — Cohesion pass slice 1: one chart palette + mission-led docs (Cowork session)

**Owner request (Cowork, 2026-08-11): "visually beautiful, highly functional, entirely cohesive; clean up READMEs for clarity of mission."** Two bounded moves this slice; the judgment-heavy rest is queued, not half-done.

- **Chart colors unified in `src/lib/ui/chart-colors.ts`** (new, the single source of chart hexes). Before: /reports cycled a 400-series palette (income `#34d399`, spend `#fb7185`) while allocation/forecast/net-worth/retirement used 500-series (`#10b981`/`#f43f5e`) — the same semantic rendered two colors depending on the page. Now every Recharts/SVG surface imports `CHART_POSITIVE`/`CHART_NEGATIVE`/`CHART_COMPARE`/`CHART_SERIES` (7 files: reports-view, top-spending-card, allocation-drilldown, forecast-view, net-worth-card, accounts-list, retirement-outlook-card). Visible change: /reports income/spend bars and both categorical palettes now match the brand 500-series. Remaining hex literals are each justified in place (global-error's standalone inline styles, layout's PWA `themeColor`, glass-box-share's canvas export). Grep proves no other `'#rrggbb'` in src.
- **Docs now lead with the mission** (CLAUDE.md #418): README's pillar list reordered (Coach → categorization → Cash-Needed, introduced as "none of them *is* the mission"), same reorder in "What's implemented" and ROADMAP v1; PHASES.md Phase 1 "(THE killer feature)" → "(a flagship feature)". Audit also confirmed: no hardcoded counts anywhere (status homes clean), SPEC.md's rename banner correct as written, ROADMAP's "Neon `pulse` database" is the literal DB name (verified against archived `db push` output) — left factual.
- **Queued, deliberately:** U.2 (semantic `brand`/`positive`/`warning` class-token migration — 172 emerald/amber literals across 51 files; must land whole, a partial migration splits the vocabulary) with full spec in TASKS.md. Empty states inspected and left alone — they are per-surface, critic-reviewed copy, not drift.

**Verification, stated exactly:** session ran in a network-restricted Linux sandbox against a Linux `npm install`. `npx tsc --noEmit` exit 0, `npx eslint .` exit 0. `vitest run` and `next build` could NOT run there (global-setup `prisma db push` needs the CDN-blocked schema engine; build blocked at Google Fonts fetch) — **local unit/build/e2e UNVERIFIED; the push's CI conclusion (full `VERIFY_E2E=1` gate) is the evidence for this slice**, per rule 5/K.8. Change is TS-only, no schema diff, no test touches chart hexes (grepped).

## ✅ BUILT 2026-08-11 — O.20d-FU: the re-review Opus/Fable never ran — three fresh-context critics, 10 P1s, the money math survives and the copy does not

**Why this exists.** O.20d was built and self-certified in a **DeepSeek V4 Flash** session, including its "Opus fresh-context hostile pass (round 1 FAIL 2 P1s → round 2 PASS)". CLAUDE.md routes EVERY rule-3 hostile-critic pass to Opus 5 / Fable 5 **"including, especially, slices Flash built — Flash never self-certifies these"**, so that pass did not satisfy the gate it claimed to. The owner caught the routing error after the fact and asked for the check. Three fresh-context critics (Opus 5, one per surface) were re-run against `c407404`, plus a fabrication audit of the record itself.

**The headline: the money is sound.** The slice's central claim — every panel is fed the rows the engine carried out of the SAME loop that summed the figure, so Σ rows === figure by construction — **HOLDS in all three engines**, verified by trace, not by reading the comments: `networth/series.ts` and `investments/panel.ts` compute the figure *from* the carried array (strictly stronger than "same loop"), and `forecast.ts` binds the events once. Integer-cents discipline is intact (no float ever touches a cents value; every `Math.round`/`toFixed` in the diff is CSS geometry or a percent label), signed liabilities reconcile, and the denominators match the figures the pages headline. **The record's numbers also reproduce exactly**: unit 6,650 by delta arithmetic from the 6,626 baseline (+24 added `it(`s), e2e 330 by declaration count + the dual-project `mobile-overflow` spec, CI run 31502352535 `success` on `c407404` attempt 1, and an empty `prisma/` diff. The defects are all in the *sentences* and the *tap targets*, not the arithmetic.

**The tally, stated exactly: 10 P1 found. 7 addressed in place here** (one of those — the Fixed/Discretionary contradiction — by DISCLOSURE, with the unification itself queued as O.20h, because it moves a live figure) **and 3 queued** (the two tap-target findings → O.20f, the returns-as-income defect → O.20g). **Plus 4 P2 executed.** Every P1 below is the same failure in a different place: a sentence asserting more than its inputs support.

- **Retirement F2 — a clamped output printed as a measurement.** `buildRetirementInputs` floors the portfolio at 0; one INVESTMENT account carrying a −$5,000.00 margin balance therefore rendered *"The $0.00 is your current portfolio — the live balance of your investment accounts today"* — wrong by $5,000.00, in the flattering direction, and against this module's own stated rule that a clamped output may not print its inputs. The composer now takes the UNCLAMPED signed sum and names the clamp instead of the figure; a genuinely empty portfolio gets its own sentence rather than a claim about an empty set.
- **Retirement F3 — two figures labelled "portfolio", no reconciliation.** Bar 0 is Σ INVESTMENT *account balances* (`coach.fi.portfolioCents`); the /investments headline is Σ *holdings market value*. The old docstring asserted they were the same figure and that "the five holdings DO make it up" — both false, and **false on the production site today**, where O.20e means the page renders "no investment holdings" directly beneath the panel's portfolio figure. The basis now names both bases and says they can differ.
- **Retirement F1 — "live … today" contradicted the frozen-feed note in the same card**, whose entire purpose is to deny that word. Both branches now drop "today" for "as we last have it" when a feed has stopped.
- **Retirement F4 — the one O.20d caller that skipped `rowNoun`**, so a screen-reader user entered a region announced *"Transactions in Projection at age 65"* over copy saying there are none — the exact lie `rowNoun` was added in this slice to stop. Now `rowNoun="holding"`.
- **Retirement F5 — the same P1-1 defect left standing on the louder surface.** Retiring at your current age is one keystroke (`retireRange(currentAge).min === currentAge`) and then `accumMonths === 0`, so the card headlined *"Projected balance at age 40"* over the live starting portfolio while the bar's own panel two rows down said "not a projection".
- **Creep F1 — the gross-vs-net disclosure had a blind spot at its canonical case.** The flag keyed on the category's `discretionary` flag, but the app's own **"Refund"** category ships `{group: 'Income', discretionary: false}` — so the reader who returns a jacket and picks Refund from the picker got a still-gross bar AND total silence, on precisely the month the disclosure exists to explain. Deliberately NOT widened to every non-income positive: a grocery return neither enters this bar nor is withheld from it, and an uncategorized inflow may be a deposit, which the sentence must not call a refund.
- **Creep F2 — "discretionary" means two different things and they now contradict each other on screen.** The bar counts by the category taxonomy flag; the register and /budgets use the Fixed/Discretionary spend class, which honours the reader's own override. A detected gym membership reads "Fixed · you set this" in the register and is still counted here — and this slice's panel now LISTS that row under "discretionary purchases", beside a footer link inviting a re-file that cannot move the number. Unifying the definitions moves a live figure on three surfaces, so it is queued as **O.20h** with a critic; the panel states the divergence outright in the meantime rather than letting the reader discover it.
- **4 P2s executed:** the credit sentence says "a credit posted", never "a refund you filed" — the same branch catches a bike sold and filed to `shopping`, and a category the app guessed rather than one the reader chose. `reconciles` was a hardcoded `true` at all four new panels — two of them (allocation, forecast) passed the headline as its own `sumCents`, so "matched to the penny" was a sentence verifying itself and BreakdownPanel's documented mismatch branch was dead code. All four now reduce the rendered rows and compare. The creep panel's loan-payment sentence was REMOVED: it was window-wide (a July payment printed the exclusion on the February bar) and vacuous regardless (`loan-payment` is `discretionary: false`, so it could never enter this figure). A `$0.00` authorization no longer becomes a panel row inflating "Show N purchases" without moving the figure.

**Deliberately NOT fixed here — queued with full traces, because each is a different kind of work:** **O.20f** (P1, WCAG 2.2 AA 2.5.8 — the allocation segment's button IS the 10px painted bar, and a zero-priced portfolio makes every segment 0px wide so no panel is touch-openable at all; the retirement strip gives 56 bars ~4.7px each and a mis-tap returns the wrong refusal on the wrong bar) is UI work with no money math, routed to Flash with the gate extension specified. **O.20g** (P1 — the creep detector counts merchandise returns as income, which can clear the "spending is outpacing income" flag and print "income grew ~33.3%", a raise that never happened) and **O.20h** (P1 — the two definitions of "discretionary") both move live figures and re-baseline the demo golden, so they are money-visible slices needing their own critic rather than a rider on a fix pass.

**Also corrected: the deploy proof over-counted its own evidence.** `scripts/o20d-live-deploy-check.mjs` contained `check('accounts: the net-worth points are drillable there too', true)` — a check asserting a literal — and a second that passed on any non-empty text. Both now assert rendered content from the live DOM (a basis sentence plus a money figure). Re-run against production: **11 checks PASS**, now 10 genuinely-asserting live checks.

**Gate + live (this slice's fixes shipped inside `1adc826`, which the parallel Cowork session committed from the same working tree alongside its chart-palette work; the owner pushed it):** local `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,660 unit passed + 1 skipped** (+10 new locks over O.20d's 6,650) / build clean. Schema: none (no `prisma/` diff). **CI run 31517105602 on `1adc826`: SUCCESS, first attempt** — the full `VERIFY_E2E=1` suite, so the changed e2e assertion passed in a real browser (the Cowork sandbox could run only tsc + eslint; the unit/build evidence is this session's, on the same tree). **Live: `node scripts/o20d-live-deploy-check.mjs` → 14 checks PASS** against production (13 live + 1 documented SKIP). The retirement check as originally written was NOT discriminating — `/current portfolio|live balance/` matches the PRE-FU sentence, the same wrong-instrument class as the /ask and /trends lessons — so three discriminating checks were added and pass live: the new "combined balance of your investment accounts" wording, the F3 reconciliation sentence against the page's "Portfolio value", and the ABSENCE of the old "live balance of your investment accounts" claim.

**The record's one unbacked claim:** no critic scorecard was ever committed for O.20d, though ~15 source comments cite numbered findings and their fixes, so findings were acted on — the round structure ("round 1 FAIL, round 2 PASS, zero P0/P1") is narration with no artifact behind it. CLAUDE.md build-loop step 5 requires the scorecard; this entry is O.20d-FU's.

## ✅ BUILT 2026-08-11 — O.20d: the last five inert bars/charts are real controls — creep strip, net-worth trend, forecast line, allocation bar, retirement years (verify green, shipped)

**The owner's standing request, *"every single bar and collection of categories needs to be immediately available"* — the remaining non-drillable surfaces from O.20/C.18.** Each was mapped to its honest verdict (TASKS): a transaction bar DRILLS, a figure made of accounts/projections gets a CONSTITUENT PANEL, and a projection with no rows REFUSES. The five surfaces, all wired to `BreakdownPanel` with the O.18c/O.18e carry-out rule — the panel is fed the ROWS the engine carried out of the SAME loop that summed the figure, so Σ rows === figure by construction and the "matched to the penny" sentence is a real check:

- **/coach creep strip** (was twelve inert `<div>`s with a hover-only `title`): each bar opens the month's discretionary purchases, an engine-composed basis sentence (what counts / what never does / loan-payment exclusion when actually applied / the gross-vs-net refund disclosure when a return was filed to a discretionary category — `hasDiscretionaryRefunds` per month), and the month's activity link.
- **Net-worth trend** (/dashboard + /accounts): point chips — month-ends plus "Today" — open the account constituents the series engine carried per point (`netWorthSeries` now emits them). The LIVE point gets its own basis ("same live balances the headline above shows right now"), the month-end points theirs; the two sentences are engine-composed so they cannot be swapped.
- **/forecast balance line**: days with scheduled flows are chips; the panel shows that day's flows and says plainly "the balance line is cumulative … so these rows never add up to the balance shown on the chart" (Σ events === the day's net change by construction — same loop).
- **/investments allocation bar**: segments group positions by symbol (a symbol in two accounts reads as ONE allocation) with the per-account rows beneath; sub-0.5% positions announce 0.5%, never "0%".
- **/investments retirement year bars**: a REFUSAL — a projection has no rows, and the panel says so instead of inventing any. The critic caught (P1-1) that the age-currentAge bar is the LIVE portfolio seeded as the projection's start — it now gets its own honest refusal ("your current portfolio — not a projection") and never the "no transactions or holdings make it up" sentence.

**The BreakdownPanel contract grew two required-honesty props:** `rowNoun` (account rows and flow rows are never called "transactions" — P1-2; default `transaction` keeps every existing caller byte-identical) and `onToggle` (the panel's inner Hide clears the opening control's aria-expanded — P2-1, WCAG 4.1.2). Both e2e-locked.

**Critic record:** Opus fresh-context hostile pass (money-visible slice): **round 1 FAIL — 2 P1s** (both copy-honesty: the current-portfolio refusal; "Show N transactions" over account rows), 5 P2s → all fixed → **round 2 PASS, zero P0/P1**, surviving P2s (forecast region-label redundancy, current-bar "projected balance" first clause, plural rowNoun guard, apostrophe style) fixed before shipping. P2-4 (month-end sentence assumes snapshot writers write month-ends) accepted as latent and documented in the panel module.

**Gate:** local verify GREEN — tsc 0 / eslint 0 / unit 6,650 (1 skipped) / build clean / **e2e 330 passed, zero flaky** (o20d-bars.spec.ts 7/7 first attempt; the one mid-round failure was the spec's own wrong assertion — the toggle lives OUTSIDE the panel region — fixed, not the product). Schema: none (no prisma diff).

**Live (2026-08-11, commit c407404):** `node scripts/o20d-live-deploy-check.mjs` — **DEPLOY PROOF: PASS, 11 checks (10 live + 1 documented SKIP)** against production. CI gate: run 31502352535 SUCCESS on c407404, first attempt. The age-currentAge retirement bar on the LIVE site says "is your current portfolio — not a projection" (P1-1 fix verified in production); age-65 refuses as a projection. The one SKIP is the allocation drilldown: **the production demo user has no investment holdings** — the seed's five demo holdings postdate the production demo's seeding, so the honest `investments-empty` state renders instead. The surface is covered by the CI e2e gate on the freshly-seeded dataset; the drilldown code is deployed (same build as the live retirement bars). The additive, guarded fix is ready (`scripts/seed-demo-holdings.ts`, DECISIONS #79; production URL in `.env.prod.tmp`) but requires owner action: it writes to the live Neon demo, which this slice's permission scope did not cover.

## ✅ BUILT 2026-08-10 — O.18g: the conscious-buckets e2e binds its savings else-branch — a throwaway user whose working $1,000.00 savings figure renders no control (verify green, shipped)

**The O.18g task (carried from O.18f):** the branch where a working savings figure carries NO adjacent control was unit-locked only — the demo's savings is provably always $0 (the seed creates no savings target and no goals; the settings dial is demo-fenced, settings-actions.ts:44) — so the demo test passed vacuously over the else state, and an unreachable branch is a claim that something is handled. The branch is real product behavior (the L.29 "Set a savings target" control for unset-$0 rows, plan-row-labels.ts:579-587), so it stays. The demo test now pins the provable $0 with a BINDING control assertion (a fixture fact, cross-referencing the throwaway test); the working-figure state is exercised by a new throwaway-user test (the trends-caps / reports-total idiom — UI signup + direct better-sqlite3 seeding: a checking account, two POSTED paycheck months under the pinned DEMO_TODAY=2026-06-10, `savingsTargetBps=2000`) which reaches the state by construction: pattern income $5,000.00 → `Math.round(500000 * 2000 / 10000)` = $1,000.00 planned savings, with an anti-vacuity chain (strip visible, toggle > $0, panel penny-match, reconciled clause) that must prove the state binds before the `toHaveCount(0)` control assertion can pass. Spec 2/2 green on first run (25.5s; the new test 2.9s).

**Gate (O.18g):** tsc 0 / eslint 0 / **6,626 unit + 1 skipped / build clean / e2e 318 passed, 1 failed, 4 flaky (7.6m)** — named per K.8: the ONE failure is `transactions.spec.ts:735` (CSV double-paste warning test), a documented flaky-ledger member (recorded with the CSV family above on this date — runs this gate and the b036b13 push), PROVEN pre-existing on this commit: the push's diff is only `tests/e2e/conscious-buckets.spec.ts` (the failing file is untouched), an isolation run passes it on a fresh attempt (1 flaky — passed retry #1), and all three full-run failures are the documented severed-confirmation-flight class (the 90s toPass windows expired on the stale first-import panel — the class the test's own comments describe at transactions.spec.ts:755-757/:780-781, ledger runs 31367228157 / 31362750997 / 31360315737). The 4 flaky (merchant-lens:22, register-scroll:162, transactions:295, transactions:610 — all documented members) passed on retry. **CI (run 31455615084 on 5b6721e): SUCCESS — gate GREEN, first attempt** (no rerun; the whole suite passed in the run the push triggered). **Live:** the push is test+docs only (zero src/ changes — the deployed artifact is byte-identical to the 6111d7b deploy), so the live record is the regression pass on the guarded surface against production on 5b6721e: demo sign-in → /budgets → conscious-buckets strip visible, savings toggle reads "$0.00" (the fixture fact the demo test's pinned assertion rests on), the unset-$0 control renders beside it (count=1 — the L.29 control the demo test binds), zero page errors — **4/4 PASS**. Deployment READY on 5b6721e. Schema: none (no prisma diff).

## ✅ BUILT 2026-08-10 — O.18e-FU2: the figureless-state sentence — /reports and /trends speak when the only thing that moved is an excluded loan payment (composer 'figureless' scope, verify green, shipped)

**The O.18e-FU re-review's P2-1 closes by the same direction as the parent slice: copy, not money.** /reports and /trends gated the scoped C.25 sentence behind the figure it describes (`hasFlows` at reports-view.tsx:137/356, the non-null-pace branch at trends-view.tsx:259), so a dedicated mortgage account whose ONLY activity is the excluded payment — the population C.25 exists for — got a non-empty exclusion set and NO sentence, while the page printed "No income or spending recorded in the last N months." / PACE_NO_SPEND_YET: the surfaces' own "silence means nothing did" contract violated, something did move. The critic's suggested fix (gate on the array) was FALSE COPY — the scoped sentence names a pace figure the abstain state does not render, and a claim about an absent figure is the same falsehood class O.18e-FU removed — so the empty branches got their own figureless sentence from the one-definition composer.

**The engine:** a new `'figureless'` scope on `loanPaymentBasisSentence` (the 7th scope; the docblock's count corrected — FU3's 'answer' had never been counted) — "Payments to {payee} at {amount}/mo are counted on {loanName} instead." — positive facts only, with "instead" pointing back at the empty claim it sits under; it never claims the page is empty (the /trends new-merchant panel can list the payment below — the F3 coexistence holds here too), so it is true wherever it renders. Deliberately NO "not in X" clause (absent figure) and NO escrow boundary (that clause explains what counts in a figure; the abstain state renders no figure — and a different-amount payment would flip the state to the with-figure branch where the boundary exists). The render decision is the slice's second half: BOTH empty branches map the exclusion set under the empty claim (testids `reports-loan-payment-basis-empty` / `trends-loan-payment-basis-empty`); the two states are single-ternary disjoint, so the two sentences can never co-render and neither branch can silently lose its sentence while exclusions exist.

**Locks: 1 golden + 6 render tests.** `loan-payment-basis.test.ts` — the `Record<LoanPaymentBasisScope, string>` forces the figureless golden verbatim, and the F3 negative + amount-format loops extend over `Object.keys` automatically (the figureless string contains neither "not spending" nor a figure claim). `o18e-fu2-render.test.tsx` (jsdom + RTL, the spend-window-render precedent) — fixtures that REACH the state on both surfaces (pace null / all-zero months + non-empty exclusions, the exact P2-1 pair): the empty branch prints the empty claim AND the figureless sentence verbatim; the with-figure sentence is absent there; CONTROL fixtures (empty + no exclusions → silent — an empty exclusion set is the only honest silence); and the mirror disjointness guard (critic P2-2: a with-figure render prints the pace-figure/page-figures sentence and never the figureless one) — the O.18e-FU record's "the naive fix goes red" now holds in BOTH directions. The FU2 state's engine reachability was traced end-to-end by the critic (exclusions mint without requiring other activity; pace abstains on zero counted; monthlyFlows drops excluded ids) — the fixtures are engine-producible, not vacuous.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,626 unit + 1 skipped** (the 2 new tests over the pre-slice 6,624; one lint failure on run 1 — an unused `cents` import in the new test — fixed, the K.8 lesson's `--max-warnings=0` working as designed) / build clean; e2e skipped locally, the `VERIFY_E2E=1` gate runs in CI on push.

**Hostile critic (Opus 5, fresh context): PASS — 0 P0 / 0 P1.** Financial correctness 9 (facts derive from actual exclusions, never eligibility; money untouched), truth of "instead" beside the panel that lists the payment verified by direct trace (pass 2 never receives exclusion ids — trends.ts:868-872/926), reachability non-vacuous, disjointness by construction, both render-site deletions go red. Two P2s EXECUTED: P2-1 the docblock's scope count (six said, seven in the union — the FU3 'answer' never counted), P2-2 the mirror disjointness guard (nothing asserted the figureless sentence absent from a with-figure render — the F3 render test's fixture never checked the empty testid; added, both surfaces). One P2 ACCEPTED (P2-3): the exclusion facts are snapshot-wide, not window-scoped, so the figureless sentence can render beside a payment that predates the window — it stays true (a standing disclosure with no month claim), and the with-figure branches share the identical property by documented design (reports-view's own "the figures here drop it in every month" comment); a per-month exclusion basis would be a separate feature.

**CI (run 31450796439 on 23f5485): SUCCESS — gate GREEN, first attempt** (no rerun; the whole `VERIFY_E2E=1` suite passed in the run the push triggered). **Scripts/docs follow-up pushes: 0ec47ed → CI run 31451490356 SUCCESS, first attempt; 3c2eaee (this record + the check correction) → CI run 31452148198 SUCCESS, first attempt.** **Live:** `scripts/o18efu2-live-deploy-check.mjs` **7/7 against production on 23f5485** (after a premise correction in the check's own header — the FU3 lesson once more). The demo corpus has no exclusions, so the sentence never renders on demo and bytes are the only honest discriminator: the /reports bundle (1,146,990 bytes) ships the `figureless` scope literal (the FU2 discriminator — no pre-FU2 bundle can contain it), the `reports-loan-payment-basis-empty` render testid, the page-figures escrow sentence ("an escrow change, say") still ships, the old universal "not as spending" is GONE, /reports + /trends load with their markers, zero page errors. **Premise correction:** trends-view is a SERVER component (no 'use client' directive, no hooks — verified by grep), so the composer runs server-side for /trends and the originally drafted "/trends bundle ships the figureless scope + render testid" markers were VACUOUS there — the first script draft failed them on a live NEW deploy for exactly that reason, not a deploy failure, the wrong instrument (the identical /ask case in FU3). The /trends page-level proof is load + zero page errors; the sentence's shippedness is covered by the same build CI green proved — the strings ARE in the deployed commit's SSR chunks (verified locally by grep before shipping: `trends-loan-payment-basis-empty` in `src_1hiwh11._.js`, `reports-loan-payment-basis-empty` in `_0g4yvee._.js`, the composer's `figureless` across the SSR graph; exactly ONE client chunk — `1ujvdnmsiiksg.js`, the /reports bundle — carries `figureless`, consistent with reports-view being the only 'use client' caller).

## ✅ BUILT 2026-08-10 — O.18e-FU3: the /ask loan-payment answer copy loses the universal — four sites (the record cited three), scoped to the answer's own figures (DECISIONS #442, verify green, shipped)

**O.18e-FU's P2-3 closes by the same direction as the parent slice: copy, not money.** The /ask answers still said "counted on the loan, not as spending" — the universal at one remove, a SIXTH surface outside F3's five. The record cited three sites (answer.ts:989/1037/1058); grep found a FOURTH the record missed: `src/server/assistant.ts` appended its own hand-rolled copy of the universal to five /ask intents (spend_total, spend_by_category, top_categories, income, savings_rate) whenever `loanPaymentBasisFacts` was non-empty — the F3 lesson once more: a fix on the reported surface is not a fix on the pattern. All four now qualify their own answer. **The engine:** the appended clause (`excludedLoanClause`) reads "counted on the loan, **not in these figures.**" — true wherever it renders: all four call sites (1071/1088/1107/1108) have visible figures on the answer surface. The count-0 branches (the answers that abstain, e.g. "No purchases at {merchant} {month}") end "— **counted on the loan instead.**" and deliberately do NOT claim "not in these figures": those answers render NO figure, and a claim about an absent figure is the exact class of falsehood O.18e-FU2 is queued against — "instead" points back at the unchanged headline ("Payments to {merchant} aren't counted as spending {month}"), which already scopes the claim to this month. **The server append** now calls the composer with a NEW scope, 'answer' — "**not in this answer.**" — which holds in BOTH states: with figures (spend_total etc., which drop the rows) and in the abstain states, where the appended sentence sits beside "No spending recorded this month" and is then the only sign money moved ("not in this answer" names the claim it accompanies, never an absent figure). The composer's structural lock extends automatically: the test's `Record<LoanPaymentBasisScope, string>` forces a golden verbatim for the new scope, and `SCOPES` derives from `Object.keys`, so the F3 negative (no scope contains "not spending") covers it without a test edit. The hand-rolled server copy is deleted; `cents`/`formatCents` imports died with it (the composer renders the amount).

**Locks: 2 new tests + 1 strengthened** in `loan-payment-flow-exclusion.test.ts` (a `row()` fixture: merchant "Truist Mortg Olb Mtgpmt", categoryId null): the refunds-only branch asserts headline "No purchases at Truist Mortg Olb Mtgpmt July 2026." and detail "$6,217.07 in a payment to this lender is counted on the loan, not in these figures."; the purchases branch (2 excluded payments + 1 purchase) asserts "You spent $100.00 at Truist Mortg Olb Mtgpmt July 2026." and detail "$12,434.14 in 2 payments to this lender are counted on the loan, not in these figures."; both assert `not.toContain("not as spending")`; the pre-existing P1-C test's detail is tightened to the exact new "…went there — counted on the loan instead." with the same negative. `loan-payment-basis.test.ts` gains the 'answer' golden (the 6th scope). Repo-wide grep after the slice: **zero runtime "not as spending" strings remain** — only history-describing comments and the negative test locks. All quoting comments updated (loan-payment-flows.ts no longer quotes the old universal; answer.ts's docblock names the answer's own figures).

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,618 unit + 1 skipped** (was 6,616 — the 2 new tests) / build clean; e2e skipped locally, the `VERIFY_E2E=1` gate runs in CI on push.

**CI (run 31440918262 on d7ab339): SUCCESS — gate GREEN, first attempt** (no rerun; the whole `VERIFY_E2E=1` suite passed in the run the push triggered). **Scripts/docs follow-up push (c300647): CI run 31442434404 SUCCESS, first attempt.**
**Live:** `scripts/o18efu3-live-deploy-check.mjs` **6/6 against production on d7ab339**. Premise correction recorded in the check's header: the answer ENGINE is server-side by construction — ask-view imports it TYPE-ONLY (its own comment: "doesn't pull the engine into the client bundle") and the answer text is computed in the 'use server' action — so none of the engine strings ever ship in the /ask client bundle on EITHER deploy, and the originally drafted "/ask bundle carries the new strings / old universal gone" markers were vacuous on /ask (the first script draft failed them on a live NEW deploy for exactly that reason — the first run was not a deploy failure, it was the wrong instrument). The one client-visible artifact the slice changed is the composer's where-map: the new 'answer' scope inlines as `answer:"this answer"` in the /reports client bundle, and no pre-FU3 bundle can contain that fragment. Discriminator green: /ask + /reports load with their markers, the fragment is in the shipped bytes (1,146,500 across the route's chunks), the page-figures escrow sentence still ships, "not as spending" is gone from /reports, zero page errors. The /ask server copy is covered by the same build CI green proved — the strings ARE in the deployed commit's SSR chunk (verified locally by grep before shipping).

## ✅ BUILT 2026-08-10 — O.18c: the /recurring rows panel carries the detector's own charges, and its first sentence says the figure above is the typical, not their total (DECISIONS #439, verify green, shipped)

**The last holdout of the owner's every-table-expandable ask (Wave O.18 — "what exactly is the system classifying as a bill") gets its rows panel — under the INVERSE of the glass-box contract.** A series row prints `typicalAmountCents` — a median, not a sum — so "these rows add up to the figure above, matched to the penny" would be FALSE, and the panel instead says so plainly. `RecurringSeriesResult` gains a required `occurrenceRows: readonly RecurringOccurrence[]` (`{date, amountCents (signed), descriptor}`, oldest first) built in `buildSeries` — the ONE constructor both the detected and the declared path funnel through — from the same `sorted` array the cadence/amount/count were read from, so the rows and the figure cannot disagree. No total is rendered (a cumulative sum of N months invites "**$1,400 of Netflix?!**" and the figure is a rate, not a sum); there is deliberately no `reconciles` line — the honest fail-loud is the opening sentence, composed in the engine (`recurring/panel.ts`, pure functions, non-empty tuple — the categoryPanelBasis lesson: a rule in a .tsx cannot be locked) and embedding the row's RENDERED figure: "The $17.99 above is this payee's most recent charge — the typical amount, not the total of 14 charges in the series." The rhythm sentence distinguishes declared bills ("the rhythm is yours, not detected from your history" — O.13f) from detected ones; the price-change sentence fires only for detected plateaus; income series read "deposit"/"amount" throughout (a raise is not a price change). The toggle interaction is BreakdownPanel's own (visible label + chevron, aria-expanded/controls, rows mounted on first open). Per-row transaction links deliberately not added: the merchant link already opens the register view of exactly these charges. Locks: 8 unit tests (verbatim copy contract + carry through both detection paths, incl. the declared ONE_RENT series carrying its exact charge) + 1 new e2e (Netflix panel: newest-first signed rows, the sentence embeds the row's own $17.99, price-change sentence, "deposits" wording on the payroll row, collapse, axe WCAG AA after expand).

**Gate:** `VERIFY_E2E=1 bash scripts/verify.sh` GREEN on run 3 — tsc 0 / eslint 0 / **6,593 unit + 1 skipped / 400 files** / build clean / **e2e 317 passed (5.8m)**. The first two gate attempts were RED and are named here rather than waved away. Run 1 was killed mid-flight (its log was mis-targeted at the repo root); the kill leaked the process tree (Windows kills the wrapper, not the children) — a zombie `vitest run` and a zombie `next start -p 3100` + 4 Playwright workers kept running and holding the SQLite test DBs. Run 2 then failed at the unit stage with 25 failures across 11 files, all `PrismaClientKnownRequestError` / "disk I/O error" — the K.8 cross-process SQLite contention class, at the UNIT stage this time, caused by run 1's zombie still hammering the same files (a standalone full-vitest repro between the runs passed because it predated the leak). Run 2's e2e then couldn't start ("no production build" — the zombie `next start` held the port). **One failure in run 2 was REAL and mine:** `ledger-decisions-index.test.ts` — DECISIONS #439 was appended to `docs/DECISIONS.md` without its `DECISIONS_INDEX.md` row, and the ledger test catches exactly that (417 index rows vs 418 decisions). Fixed (row added), 16/16 green. Zombies killed, full gate GREEN on run 3; the 4 flaky members (action-menu:307, transactions:295/:638/:735) were absorbed by the K.8 `retries: 2` and passed — the documented family, none isolation-proven necessary because none failed after retry.

**Hostile critic (Opus 5, fresh context): FAIL on first pass — one P1 + three P2s; the P1 and one P2 executed, the rest measured or documented.** P1 (F1): "not the total of 1 charge in the series" is a literal FALSEHOOD whenever a declared series carries one charge (reachable — `declaredSeries` admits ≥1 txn, and detection's floor of 3 cannot produce it): the total of the one listed row IS the figure above. The locked test had frozen the false sentence ("stays grammatical at count 1" — grammatical, not true). Fixed: at count 1 the sentence says "— the only charge in the series" (per-noun: deposit), and the lock now asserts the honest sentence for both nouns. F4 (P2, executed): "The price changed from X to Y on D" over-claims — `priceChangedAt` is the date of the FIRST charge at the new price, never a recorded change date, and this repo's own badge precedent says "never a time claim the detector doesn't record". Fixed: "…— the first charge at the new price was D" (income: "first deposit at the new amount"), locks + e2e + live check moved. F2 (P2, measured): for a BILL row stored before `declaredSign` existed, `declaredSeries` falls back to the majority sign and the sentence would claim "You marked this as recurring income" — a direction never stated. Probe `scripts/audit-probes/o18c-f2-legacy-declared-sign.mts` against the live corpus: **ZERO BILL overrides exist on production** — the state cannot render today; F2 stays latent with the probe as the re-measurement instrument. F3 (P2, accepted + documented): the sentence quotes the unsigned rate while the newest evidence row renders the same charge signed — the deliberate signed-rows convention (DECISIONS #439 decision 1), same magnitude, no arithmetic disagreement; both facts individually e2e-locked. **Re-review (same Opus critic, fresh pass on the fixed tree): PASS — 0 P0 / 0 P1, the two executed findings verifiably fixed** (repo-wide greps: the false "not the total of 1 " and the old "changed from X to Y on " forms have zero hits; the new sentences match detector state exactly for both nouns and both directions), **F2 accepted as latent-with-instrument and F3 accepted**; the Q1–Q8 wiring assertions all re-verified standing (only panel.ts + its locks changed). One P2-grade instrument caveat from the critic (no action): the probe's per-row direction tally approximates detection's grouping — moot at zero legacy rows.

**CI (run 31412992047 on ebb987c): SUCCESS — gate GREEN, first attempt** (no rerun; the whole suite passed in the run the push triggered).
**Live:** `scripts/o18c-live-deploy-check.mjs` **12/12 against production on both deploys** — on ebb987c (as-shipped) and re-run on fcb5257 (the F1/F4 sentences live): the /recurring rows carry the charges toggle ("Show 18 charges" on Netflix), the panel lists the 18 charges newest-first with signed amounts, the basis embeds the row's own $17.99 with "typical amount, not the total of 18 charges", the plateau sentence names both amounts ("…— the first charge at the new price was …"), payroll reads "Show 39 deposits" + "most recent deposit" + biweekly, collapse + aria follow, zero page errors.

**CI (run 31415210741 on fcb5257 — the critic-fix push): FAILED 3/3 — `action-menu.spec.ts:361`, root-caused to a K.8 harness coupling, not O.18c code.** The failure was NEVER the sign-in: CI's server log and the test's own progress (it reached the split flow) prove the sign-in at :366 worked; the error was `detail-split-parts` `toBeVisible` with **Timeout: 500ms** — the split→reload→render pipeline racing a 500ms budget on the loaded runner. Mechanism: the K.8 fix (0114b4e) pins `SQLITE_BUSY_TIMEOUT_MS=500` in playwright.config.ts:29; the spec had `{ timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 }` at action-menu.spec.ts:377 — pre-K.8 that resolved to 15s, post-K.8 it silently collapses to 500ms (a DB-lock budget misused as a render budget; the env coupling itself entered the spec in 0114b4e). **Fixed:** :377 carries a fixed 15s render budget with a comment naming the trap; the other env usages are `Database` constructor busy-timeouts and stay. A red herring recorded so no future session re-derives it: running `:361` ALONE fails at :366 with a 20s `waitForURL` timeout — the serial describe has NO beforeEach; `email` is set by test 1 (:98), so a lone `:361` run fills `''` into the `required` email input, native HTML5 validation blocks the submit, and no POST ever fires (trace: `fill auth-email value:""`, exactly one network entry). Not a sign-in defect — the earlier sign-in-stall theory is withdrawn. **Gate on the fix:** `VERIFY_E2E=1 bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / 6,593 unit + 1 skipped / 400 files / build clean / **e2e 320 passed (3.8m)**, `action-menu:361` green in the full suite (the 1 flaky — budget-targets:61, the documented family — absorbed by retries). **CI (run 31418339930 on 659012a): SUCCESS — gate GREEN, first attempt.**

## ✅ BUILT 2026-08-10 — O.18e: the /trends "New this month" row expands into its merchant's own rows — carried out of the same pass that summed the figure, with the in-progress window stated (DECISIONS #440, verify green)

**The last Wave O.18 holdout closes under the GLASS-BOX contract — the mirror image of O.18c's inverse.** "New this month" rows are aggregates (a merchant's month), so here the panel's rows ARE the figure: `NewMerchant` gains required `rows: readonly BreakdownRow[]` (oldest first) and `futureDatedCents`, both built in pass 2 of `computeSpendingTrends` — the SAME loop that sums the figure (the #439 carry-out construction: rows and figure cannot disagree by construction), so the "These N rows add up to exactly $X — matched to the penny." line renders, computed in the view from the carried rows (`sum === headline`). Money dated after today never enters the totals; it is totaled separately (nets within itself, floored at 0) and disclosed via the shared C.26 not-counted-yet sentence ONLY when it exists — a panel claiming "these are the rows" that silently omitted a future-dated charge would be complete-sounding and false. The basis is composed in the engine (`newMerchantPanelBasis`, non-empty tuple, RENDERED figure/month/through-date embedded — the O.18c contract): S1 names the window — "The $80.00 above is this merchant's spending in Jun '26 through Wed, Jun 10, 2026." (the date RENDERED, never the word "today", because demo/e2e pin DEMO_TODAY) — because the in-progress aggregate sits beside the movers, which compare COMPLETE months, and a bare "$80.00" there would read as the whole month (C.26's stop-at-today lesson). **Premise corrected mid-slice (critic F1):** this is NOT "a third basis /reports does not share" — /reports has stopped at today since C.26 (reports.ts:154) and /budgets sums the whole month (budgets/page.tsx:176); the intra-page contrast is the real one, and the false premise is fixed in the slice's comments, the e2e header and the deploy-check header. The register footer reuses the row's existing merchant link with a label naming what it opens ("Open {merchant} in your activity list…" — the merchant's whole history is a superset of the panel's rows, never the default "Open these", critic F4). `merchantBreakdownRow` is the sibling shaper (label fallback merchantName → rawDescriptor → 'No description'; key `${merchantKey}:${index}:${date}`, unique per merchant+date; `rawDescriptor` null when equal to the label OR whitespace-only — the category builder's exact rule, critic F6; signed integer cents; pending marked). Per-row transaction links deliberately not added (the O.18c precedent — the panel answers "is this bucket right?" in place). Locks: 15 unit tests (11 engine carry-out + 4 composer incl. the source-scan: trends-view renders the composer, never a local sentence) + 1 new e2e (throwaway user, seeded ALPHA CAFE rows incl. a FUTURE-dated charge → figure $70.00, 4 rows, the not-counted-yet disclosure, collapse/re-expand round-trip, axe WCAG AA after expand).

**Gate:** `VERIFY_E2E=1 bash scripts/verify.sh` GREEN on run 2 — tsc 0 / eslint 0 / **6,608 unit + 1 skipped / 399 files** / build clean / **e2e 320 passed (4.1m)**. Run 1 was RED on this slice's own spec — a strict-mode violation my two locator fixes closed: `getByText('$70.00', { exact: true })` resolved to TWO elements because the panel's Total span is mounted-but-hidden from page load (`.filter({ visible: true })` added — the visible one pre-expansion is the card figure by construction), and the e2e's testids used the raw seed descriptor 'ALPHA CAFE' where the engine's canonical display merchant is 'Alpha Cafe' (the gate's error context proved it — `new-merchant-breakdown-sum-Alpha Cafe`); testids now use the NORMALIZED name, with a comment explaining why. Run 2 green with 2 flaky absorbed by the K.8 retries (category-rename:110 and merchant-lens:22 — both the documented family, both passed on retry; zero failures after retries).

**Hostile critic (Opus 5, fresh context): PASS on first pass — 0 P0 / 0 P1.** The carry-out/reconcile construction verified sound: rows and figure summed in the same loop, integer arithmetic, keys unique, `reconciles` cannot silently disagree (no second derivation, no rounding, no row cap). Six P2s: **F1** (false "/reports applies no clamp" premise in the slice's own comments + deploy-check header — EXECUTED, corrected to the true intra-page contrast, verified against reports.ts:154 and budgets/page.tsx:176), **F4** (the default "Open these" register label over-promised — the merchant register shows the merchant's whole history, a superset — EXECUTED via "Open {merchant} in your activity list…"), **F6** (a whitespace-only rawDescriptor shipped `''` instead of the sibling builder's null — EXECUTED + unit-locked), **F2** (S2's word "today" beside S1's rendered date — ACCEPTED: the C.26 not-counted-yet sentence is /reports' and /budgets' shared locked wording, and it is true in every reachable state — the engine clock's today IS the as-of date), **F3** (a C.25 flow-excluded loan payment can appear in this panel as "spending" while the pace card says "loan payments are not spending" — ACCEPTED with the executed scenario: a new auto loan's lender absent from the prior 6 months, so its payments are new-merchant rows the panel lists; the figure's exclusion set is pre-existing (pass 2 never took `excludedFlowIds`, the register-basis decision documented in trends.ts), the critic's own direction is "copy, not money", and the C.25 sentence is shared by FIVE surfaces with their own locks — the fix is a future slice, queued as TASKS.md O.18e-FU), **F5** (the net-floored future disclosure can silently omit a future charge fully offset by a future refund — ACCEPTED, the C.26 per-category precedent; S1 always names the through-date, so the month never reads as whole).

**CI (run 31426651241 on 07d0255): FAILED attempt 1 — two documented K.8-family members, neither touched by this push: `budget-targets.spec.ts:61` and `transactions.spec.ts:638` (the latter failing all 3 attempts incl. retries). Both proven pre-existing on this exact commit: 2/2 PASS in isolation (13.4s) on 07d0255, both files untouched by the push's 12-file diff, and both members recorded in C.16's/K.8's flaky ledger (transactions:638 is the forensicked CSV wedge — "that class never writes"). `gh run rerun --failed` → attempt 2 SUCCESS — **07d0255 gate: GREEN.****
**Live:** `scripts/o18e-live-deploy-check.mjs` **10/10 against production on 07d0255** — the first new-merchant row (Costco Gas $37.38) carries its panel toggle ("Show 1 transaction"), the panel lists the row and dates it, the panel total equals the card figure to the penny, the one-row "This amount is the whole figure." sentence, the basis embeds the card's own $37.38 with "in Jun '26 through Wed, Jun 10, 2026", collapse + aria follow, zero page errors.

## ✅ BUILT 2026-08-10 — O.18e-FU: the C.25 loan-payment basis sentence is scoped per surface — one composer, five scopes, the universal "loan payments are not spending" removed (DECISIONS #441, verify green)

**O.18e's critic F3 closes by the critic's own direction: copy, not money.** The C.25 sentence ended "loan payments are not spending" — a universal hand-rolled in FIVE surfaces (dashboard, coach, budgets, reports, trends) — and it was false wherever a surface lists the rows the exclusion moved. F3 executed exactly that: on /trends the pace card printed it while the page's own "New this month" panel listed the same payment as spending (the deliberate register basis of O.18e — pass 2 sums what the activity list shows; it never took `excludedFlowIds`). Reachability, executed: a loan merchant with old pairing evidence (C.25 gate 2 re-derives from ALL rows, whenever they happened) + a 6+ month gap + a resumed payment this month is BOTH "new" (pass 1's seenBefore only sweeps months [earliestPrior, ym)) AND flow-excluded. The money behavior is UNTOUCHED — pace/movers/largest keep dropping the row, pass 2 keeps counting it — and the divergence is now locked as DELIBERATE (`trends-f3-regression.test.ts` with anti-vacuity), so a future money-route change is a conscious figure change, never a silent one. The fix: ONE composer `loanPaymentBasisSentence(fact, scope)` in `src/server/loan-payment-basis.ts` — the existing one-definition facts module, whose docblock promise ("one definition so /reports, /trends and /budgets cannot phrase the same fact three different ways") now includes the sentence, not just the facts. Five scopes, each naming the figures the claim actually covers: 'pace-figure' (/trends — the pace figure the sentence sits under), 'figures' (/coach), 'cards' (/dashboard), 'this-list' (/budgets — the By-category list), 'page-figures' (/reports — keeping the escrow-change boundary "A payment at another amount (an escrow change, say) counts normally."). The amount is rendered once in the composer (`formatCents`), so every surface prints the same string for the same payment. All five surfaces now call it: /dashboard's and /budgets' hand-rolled copies are deleted (the old /dashboard comment "Same words /coach uses (one helper)" was a lie — two hand-rolled copies; it is now true), /reports-view (a 'use client' component) imports the pure composer (safe — the module imports only engine modules and money utilities), and /trends' comment records the scoping reason: the movers and biggest purchases drop the same rows, but the page's own panel lists them — it follows the register, which shows the charge — so a universal claim would contradict the card below it. The panel's own "this merchant's spending" basis was deliberately not flagged by the critic and is out of scope.

**Locks: 8 new tests.** `loan-payment-basis.test.ts` — verbatim contract for all five scopes (golden strings), the F3 regression negative (NO scope contains "not spending" or matches /loan payments are not/i — the C.26 reverse lesson: a false string no test forbids will ship), and the amount-format lock ($6,217.07/mo in every scope). `trends-f3-regression.test.ts` — the engine divergence locked as deliberate (same excluded row: out of pace + largest, IN the new-merchant panel with its exact transactionId; anti-vacuity: without the exclusion the payment is in the pace total too). `trends-f3-render.test.tsx` (jsdom + RTL, the spend-window-render precedent) — the /trends page prints the pace-figure scope verbatim and the universal exists nowhere on the page, and the panel opens to the honest "this merchant's spending" basis — the F3 coexistence the universal made self-contradictory.

**Gate:** run 1 RED on this slice's own code — tsc (the test's `as keyof typeof EXPECTED` cast yielded `string`, not `LoanPaymentBasisScope`, 3 sites) + eslint (`dashboard/page.tsx` still imported `cents`/`formatCents` — the composer renders the amount now). Both fixed, re-checked targeted (tsc 0 / eslint 0 / 8/8). Run 2 GREEN: tsc 0 / eslint 0 / **6,616 unit + 1 skipped / 403 files** / build clean. Full `VERIFY_E2E=1` run GREEN: tsc 0 / eslint 0 / 6,616 unit + 1 skipped / build clean / **e2e 320 passed (4.7m)** — 2 flaky absorbed by the K.8 retries (action-menu:307 and pwa-offline:51, both the documented family, both passed on retry; zero failures after retries).

**Hostile critic (Opus 5, fresh context on the shipped tree): PASS on first pass — 0 P0 / 0 P1.** Scope truth verified per surface by direct trace (every /coach flow figure applies `excludedFlowIds`; /budgets' list, breakdowns and links all apply it while the SpendClassPanel above counts the rows and cross-references the two-page sentences — they agree; /reports' chart, category card and panels; /trends' pace/movers/largest drop while pass 2 counts); the escrow boundary matches the engine's own named staying case (loan-payment-flows.ts:170-174); `paymentCents` is the excluded row's actual amount so the rendered `$X/mo` always equals what the figure dropped; the deliberate-divergence lock is sound (a future pass-2 change zeroes the panel amount → net-≤-0 drop → the non-null assertion throws; anti-vacuity pins the baseline); the refused-categories link path intact (three link-bearing surfaces refuse, /dashboard's covered cards carry no category-window links). Four P2s, all determined: **P2-1** (real, unexecuted): /reports and /trends gate the sentence behind the figure it describes — a dedicated mortgage account whose only activity is the excluded payment gets a non-empty exclusion set and NO sentence, while the page prints "No spending counted yet this month" (the surfaces' own "silence means nothing did" contract violated; something did move) — /coach, /dashboard and /budgets render unconditionally, only the two client-gated surfaces share the hole; the critic's suggested fix (gate on the array) is FALSE COPY — the scoped claim names a pace figure that the abstain state doesn't render — so the truthful fix needs figureless-state copy + a render decision + locks, queued as TASKS.md O.18e-FU2. **P2-2 (EXECUTED):** the /dashboard scope "not in these cards" was the one scope a literal reading falsifies — the same-page recent-transactions card lists the payment row with its amount, above the sentence (the other four scopes name one unambiguous referent or are page-true); fixed to "the figures on these cards" — the aggregates (savings rate, top spending, pace) all drop the rows while the recent card shows raw amounts, not figures — lock updated, full gate GREEN below. **P2-3** (accepted): the /ask answers still carry the universal at one remove ("counted on the loan, not as spending", answer.ts:989/1037/1058) — a SIXTH surface outside F3's five, pre-existing (C.25 P1-C), consistency not correctness, queued as O.18e-FU3. **P2-4** (accepted): /coach's reimbursement card copy ("They still count as spending until the money comes back") can contradict the figures sentence if a reader marks a loan payment "awaiting reimbursement" — reachable only under that contrived action, pre-existing, recorded only.

**CI (run 31433781510 on 46f6369): SUCCESS — gate GREEN, first attempt** (no rerun; the whole suite passed in the run the push triggered). **P2-2 fix push (b036b13): gate `VERIFY_E2E=1` GREEN — tsc 0 / eslint 0 / 6,616 unit + 1 skipped / build clean / e2e 320 passed (4.4m), 2 flaky absorbed (category-rename:110, transactions:735 — documented family, both passed on retry); CI run 31437099166 SUCCESS, first attempt.**
**Live:** `scripts/o18efu-live-deploy-check.mjs` **8/8 against production on 46f6369** — all five surfaces load with their markers (net-worth-card / money-review-card / budget-list / income-expense-chart / trends-new-merchants); the discriminating marker: the demo corpus has NO loan-payment exclusions (the sentence never renders on demo in either build), so the check greps the shipped CLIENT BUNDLE of /reports (a 'use client' component importing the composer) — the page-figures sentence "an escrow change, say" is in the bytes (1,146,464 across 18 chunks) and the old universal "loan payments are not spending" is GONE from them; zero page errors. **Re-run 8/8 on b036b13** (the P2-2 wording push — the composer is in the /reports bundle, so the bytes moved to 1,146,479): scoped sentence still shipped, universal still gone, zero page errors.


## ✅ BUILT 2026-08-09 — C.17: the audit P2 sweep — the pace divides by real elapsed time, every "zero is a claim" figure names which zero, and the Opus critic's one P1 + four P2s are closed (DECISIONS #435, verify green, shipped)

**The audit's P2 list closes item by item.** Pace: the credit/sum/quotient stays integer cents — `daysElapsed` is the real fractional days between the month's first day and today (business-day fraction, floored at 1), so `(spentSoFar * daysInMonth) / daysElapsed` divides by true elapsed time instead of the float 30.43 hacks; the displayed "day" is still the whole number of elapsed days (integer display days preserved). Cash-needed headline: the total is paired with the FIRST effective due while `byDate` remains the projection horizon — the horizon can stretch into a cadence where the 10-second answer must still name a date. `baselineLabel` prints a gapped set as "N months through <first>", never a contiguous range the balance-move sentence contradicts 40px away. A mover row's netted-zero never prints as a fact (abstains) and sorts netted. The discretionary denominator counts distinct data months. `toFIInputs` deleted — it paired a nominal return with a present-value target and had no caller (a trap, not a live claim). Negative runway is named on every coach surface (the /coach runway lines and banding already were; the today-feed's negative branch was dead code — the nudge clamps non-positive runway to null — and was removed, so no surface prints "-2.3 months" as a fact). The /forecast frozen note uses `accountLabel`, the same basis as the figure. The savings streak is exclusive of zero ("under 0.1%" banded) and personal-best is full-history. The merchant lens note states both bases; the calendar strings name their account scope; the minimum-interest note names the covered set ("on the N cards that carry a balance" / "because every card is paid in full" for a zero cycle, plus the exclusions); the wealth-target header correction shipped in the same sweep.

**Hostile critic (Opus 5, fresh context): FAIL on first pass — one P1 + four P2s, all executed and closed (DECISIONS #435).** P1 — the /coach recap re-derived streak + personal-best over the 12-month chart slice while the savings-rate card used FULL history, so a key-gated recap could print "personal best so far" an older month already beat: `buildReviewCandidates` now receives the SAME full-history `SavingsStreakResult` the card uses (one helper, one basis; the private local functions deleted, and the recap's stricter single-month gate superseded by the unified semantics — a first measurable month IS "so far" honest), with a new lock pinning the slice-vs-history divergence (an older better month suppresses the candidate while the honest streak stays). P2s: `isPersonalBest` gained a positivity gate (an all-negative least-bad month would have rendered "-0.0%" — a zero-looking claim about a number that isn't zero, the audit's own rule); the /trends clock comment now states the truth (date and day-fraction are two reads of the same clock milliseconds apart; the engine floors the divisor at 1); the minimum-interest note says "every card is paid in full" for a zero cycle and counts only positive-required estimated cards in the next-cycle exclusion; the today-feed dead negative branch removed (see above).

**Gate:** `bash scripts/verify.sh VERIFY_E2E=1` GREEN on run 13 — tsc 0 / eslint 0 / **6,539 unit / 395 files** / build clean / **e2e 318/318 (4m)**. The 12 prior attempts were the documented 4-worker stall lottery on the shared SQLite DB — every failing member isolation-proven green on this exact tree: `transactions.spec.ts:566` (5×; 1/1 in isolation — the run-12 failure was a transient server-teardown race with the just-finished gate, not reproduced, clean rerun passed 13.7s), `:637` (2×), `:553` (1×), `:223` (1×), `category-rename.spec.ts:110` (1×), `mobile-overflow.spec.ts:386` (1×), `combine-connections.spec.ts:67` (1×), `pwa-offline.spec.ts:23` (1×), `spend-class.spec.ts:13` (1×), `budget-targets.spec.ts:61` (1×), `phase4-features.spec.ts:97` (1×) — the full documented family, each 1/1 PASS in isolation on this tree. **Two REAL defects were found and fixed during the marathon:** (1) the lint phase was silently red in EVERY run 1–6 (`--max-warnings=0` turns warnings into failures) — `scenario.ts` carried unused `Cents`/`fiNumberCents` imports left over from the `toFIInputs` deletion; fixed, `eslint --max-warnings=0` LINT-CLEAN. Full-log greps, never just e2e tails. (2) The critic's P1 (above) — the recap divergence no test had locked. Run 7 proved tree-independence (318/318 e2e with the lint failure; run 8 failed the same specs after a lint-only tree change). No schema change (prisma diff vs origin/main empty).

**CI (run 31322110690 on ed65c95):** attempt 1 FAILED — `merchant-lens.spec.ts:22` (the `waitForURL('**/transactions?merchant=*')` 60s navigation stall on [mobile-380], the C.14/C.15/C.16-documented family; this push's own e2e specs — calendar-posted, phase1-cash-needed, trends-pace-bills — passed). Isolation proof on this exact commit: **1/1 PASS (2.1s)**. **`gh run rerun --failed` → attempt 2 SUCCESS. ed65c95 gate: GREEN.**

The docs-record push (b68b1ee, STATUS.md + TASKS.md + the check-script toggle fix — zero src/test code) ran the stall lottery the same way: CI run 31323189132 failed attempt 1 (`category-rename.spec.ts:110`, 1/1 PASS in isolation on this tree, 1.9s), attempt 2 (`transactions.spec.ts:637`, the C.14/C.16 CSV double-paste wedge; its local isolation run failed TWICE on the accumulated temp e2e DB — the C.15 file-degradation class; the DB was deleted per the C.15 remedy and the spec passed 2.8s on the fresh DB), attempt 3 (`category-rename.spec.ts:110` again), attempt 4 SUCCESS — **b68b1ee gate: GREEN**. Live: `scripts/c17-live-deploy-check.mjs` **6/6 against production** on the ed65c95 deploy — the calendar posted line states its scope, the minimum-interest sentence names the covered cards (the check clicks the Minimum-payments toggle the sentence lives under), the merchant lens states the gross-posted basis and names the register summary as the different set, zero page errors.

The record push itself (79062de, the line above — zero src/test code) ran the lottery hardest: CI run 31325090499 failed attempt 1 (`duplicate-connections.spec.ts:277`, a new member — 1/1 PASS in isolation on this tree, 3.2s, after the degraded temp e2e DB was deleted per the C.15 remedy), attempt 2 (`category-rename.spec.ts:110`, 1/1 PASS on this tree, 2.3s), attempt 3 (`phase4-features.spec.ts:97` — the C.14 severed-flight member — plus `transactions.spec.ts:637` again; both 1/1 PASS in isolation on this tree; :637's failure was trace-forensicked to the C.15 `:566` client-side pending wedge — one import POST, 200 response, result never rendered, button stuck disabled, zero re-submits, "already in your history" absent from the trace — while solo runs pass 2.6-2.8s), attempt 4 SUCCESS — **79062de gate: GREEN.**

## ✅ BUILT 2026-08-08 — C.16: Fixed/Discretionary moves into the action menu — the register dial is gone, and a row can say whether its class is ours or the reader's (DECISIONS #434)

**The audit finding's parts close in one construction.** F4: the always-on dial on every register row (the clunk the owner named) is deleted — the register renders an inert badge SPAN (`txn-spend-class`, `data-spend-class` ∈ {fixed, guilt-free, out-of-scope}) and the class write lives in the one action menu as the `spendClass` verb, "Change spending class…" (state-free label, markRecurring precedent), slotted after 'category' with the demo fence FIRST: engine order matches the wire (`!canEditSpendClass` → `DEMO_ENTRY_BLOCKED`, then out-of-scope → `SPEND_CLASS_BLOCKED_OUT_OF_SCOPE`). The detail page's For-your-Plan block stays read-only — no select anywhere (e2e locks `select` count 0 inside `detail-spend-class`). F5's mandatory confirm-step spirit is served by two deliberate in-menu gestures: a pick step (`menuitemradio` + `aria-checked`; picking the current class closes with NO write — the no-op is e2e-locked) and, when the verb applies to more than one row, a scope step ("Make {label} for:" / "All {n} {merchantName}" — this transaction only / all N from this payee, `merchantId`-scoped write; `bulkCount` = the register's `merchantCount`, `ruleEligible`-gated). F6 (the tooltip named 3 causes for a predicate with 7) was closed by #397's predicate redesign; the detail view's reason chip now speaks the SAME predicate the classifier uses, and the block renders the classifier's own out-of-scope sentence. F7 (a live control an inch below copy saying the row is in no total): root cause found and fixed — the detail map's `classifySpendClass` TxnLike omitted `isSplitParent`, so a split parent fell through to its override/guess while the reason chip said 'split-parent'; the flag now reaches the classifier (transactions.ts:768, commented) and the register never loads containers (`registerRowWhere`), so no control can ever sit under that copy (e2e: verb disabled with reason 'split-parent' on the container, block shows no select and no 'We guess' copy). F8: `spendClassReaderSet` (`spendClassOverride !== null`, both view maps) is the provenance marker — only reader-authored classes ever stamp the override (the non-learned keyword-rule branch; every machine-guess path stamps null, verified by inventory), the badge and detail copy render "you set this" exactly when it's true, and availability never reads the marker (undo never locks). The demo fence is airtight: verb disabled with the shared-account sentence on the demo, both server actions refuse `DEMO_ENTRY_BLOCKED` before any row check, keyword-rule create/apply throw it. The module invariant ("a disabled reason on screen and a refusal on the wire can never say different things") is single-sourced: `SPEND_CLASS_BLOCKED_OUT_OF_SCOPE` (actions.ts:228-229) is imported by the engine AND the server action (transaction-flags-actions.ts:31), `DEMO_ENTRY_BLOCKED` (demo-user.ts:38) likewise, the sentence equality is unit-locked, and the classifier gates out-of-scope before the override — so menu-enable ⇔ wire-write agreement is structural, not copy-sharing. Hostile critic (Opus 5 xhigh): **PASS — zero P0/P1.** Four P2s named for the record: (1) the unit DB's documented same-checkout concurrency race — the critic's own verification vitest runs collided with the gate's shared unit DB; isolated green (6,488 below); (2) the register's "All N" counts over spending-account rows while the merchant write set has no account-type filter — the identical pre-existing basis of the recategorize "Always" verb, unreachable on the demo seed, and the detail page's sibling count matches the write set exactly; (3) dev-tools-only: the merchant-attached bulk action skips an out-of-scope ANCHOR silently (single-row path refuses; the menu can never reach it); (4) the pick-step buttons omit `disabled={busy}` — unreachable since both surfaces clear the step / close the menu before the write. No schema change (the prisma diff against origin/main is empty).

**Gate:** full `VERIFY_E2E=1` run (fresh temp DB — the C.15 hard lesson applied): tsc 0 / eslint 0 / **6,488 unit + 1 skipped / 393 files** (re-confirmed isolated after the critic's P2-1 collision) / build clean / **e2e 317/318** — `merchant-lens.spec.ts:77` (the clear-lens `waitForURL` 60s navigation stall; merchant-lens is the family documented at :22 in the C.14/C.15 gates), **4/4 PASS in isolation on this exact tree (14.2s)** and PASS in this session's earlier full run on this same tree with all C.16 edits in place. The earlier full run on this tree was 316/318 — `category-rename.spec.ts:110` (1/1 PASS in isolation, 1.8s) and `transactions.spec.ts:637` (passed on the fresh DB in the transactions-only run). The transactions-only run on the fresh DB played `transactions.spec.ts:538` (the CSV line-errors `toContainText` stall — failed identically on C.15's docs-only push run 31285468106 attempt 1, a zero-source-diff tree), **1/1 PASS in isolation on this exact tree (10.9s)**. Every failure is the documented stall lottery, each isolation-proven on this exact tree; the C.16 specs (action-menu.spec.ts + txn-spend-class.spec.ts) were green in every run. **CI (run 31291325656 on 4d373d3): SUCCESS — gate GREEN, first attempt** (no rerun; the whole suite passed in the run the push triggered). The record push (2547f3d, STATUS.md + the check script — zero src/test code) ran the stall lottery the same way: CI run 31291689414 failed attempt 1 (`mobile-overflow.spec.ts:386`, the [mobile-webkit] route sweep — 7/7 PASS in isolation on this exact tree, 22.6s) and attempt 2 (`category-rename.spec.ts:110`, the C.14/C.15-recorded member — 3/3 PASS in isolation on this exact tree, 47.6s; the C.16 specs passed in both failed runs), attempt 3 SUCCESS — **2547f3d gate: GREEN.** Live: `scripts/c16-live-deploy-check.mjs` **5/5 against production** — the register renders the badge SPAN (`data-spend-class=guilt-free` on the top demo row, no `select`), the action menu lists "Change spending class…" (impossible on the previous build), the demo fence disables the verb with the shared-account sentence; zero page errors. Schema: none.

## ✅ BUILT 2026-08-08 — C.15: the return affordance one hop deeper — a TRANSACTION or a named page as the way back, and the reader's place survives the second hop (DECISIONS #433)

**Both halves of the audit finding (F1/F2/F3) close in the same "path is a literal, only the query comes from the caller" construction as O.16.** F1: `decodeRegisterReturn` was rooted at the `REGISTER_PATH` literal, so a TRANSACTION destination was structurally inexpressible — `/rules` always landed on the register, and on an unfiltered register rendered no return link at all. The slice adds two sibling encoders to `src/lib/engine/transactions/links.ts`: `decodeTransactionReturn` (id admitted only through `TRANSACTION_ID_PATTERN` — both the cuid `cmqvrv3hd0025j0cu9gvo2zor` and the demo `txn-00001` shapes verified against the live database; absolute/protocol-relative/script URLs, percent-encoding, traversal, backslashes, `?`/`#` and dot-segments all refused by the invariant table) and `decodeNamedPageReturn` (a closed `PAGE_RETURNS` table: triage/dashboard/budgets/reports/trends; the query rides on the table's literal path, never built from the caller). The three encodings are mutually disjoint, so decode order cannot launder one into another. F2: the split-parent link on a split child's detail page was bare — it now rides forward the CHILD's forwardable context, so the reader's place survives the second hop (never the parent's id). F3: the triage inbox (both entry links), the dashboard recents, and the breakdown expanders (host token derived as the INVERSE of `PAGE_RETURNS` via `usePathname()`, the page's own query carried via `useSearchParams()`) hand the detail page a named token. `forwardableBack` gates every second-hop forward (decode-first, else the Activity sentinel — a forwarded value no decoder can read is dead context, indistinguishable from lost context) and `withForwardedReturn` is the sibling encoder (fragment-safe `?`/`&` separation, percent-encoded param, hostile values collapsed inside the encoder); the raw `?back=` travels as a server prop after the O.16 e2e caught a pre-hydration `window.location` read shipping `_activity` on a cold click. No third back link. Locks: 41 new unit tests (hostile-input invariant tables, disjointness, sentinel gate, fragment/multi-value cases) + 3 new e2e (triage F3; dashboard F3+F2 through the split-parent second hop; budgets expander F3), each on a throwaway user per the O.16 prescription.

**Gate:** full `VERIFY_E2E=1` run (clean temp DB): tsc 0 / eslint 0 / **6,482 unit + 1 skipped / 393 files** / build clean / **e2e 313/315** — `transactions.spec.ts:566` + `:910`, both `[mobile-380]`, both the `toContainText`/element-not-found stall signature. `:566` was the hard one: it failed IN ISOLATION once on the day's dirty temp DB (trace forensics: one import POST, a stuck-disabled button, zero re-submits — a pure client-side pending wedge; the action's 200 response and its result had rendered; node:sqlite PRAGMA integrity_check = "ok"; a stash run on the pre-C.15 tree failed identically). Root cause: **accumulated state in the persistent temp e2e SQLite DB** (power-cut debris + ~8 runs' residue — `integrity_check` checks structure, not content, so it read "ok" while the file was logically degraded). Deleting the temp DB fixed it: `:566` passes on a clean DB reproducibly (2.9s, then 3.5s in isolation). The reruns on the clean DB then played the documented 4-worker stall lottery, one member per run: run 2 `:566`+`:910`, run 3 `category-rename.spec.ts:110`, run 4 `budget-targets.spec.ts:61` — each 1/1 PASS in isolation on this exact tree (`:566` 3.5s, `:910` 3.1s, category-rename 1.8s, budget-targets 2.5s); none of those specs' code is in this slice's diff (rules/detail/triage/dashboard/breakdown links + encoders + tests only). Run 5: **315/315 GREEN (3.8m)** — 312 pre-existing + the 3 new C.15 tests, the C.15 spec green in every full run. The same-day earlier rounds (dirty DB) had already documented the class (merchant-lens:22, transactions:910, category-rename:110, spend-class:13 — each isolation-green). **CI (run 31284624859 on 417844c): FAILED once — `phase4-features.spec.ts:97` (the C.14-recorded severed-flight member, `apiRequestContext.get: read ECONNRESET`, 120ms) and `transactions.spec.ts:637` (the C.14-recorded CSV double-paste wedge: 32.3s `toContainText` — the register stuck on the unclassified filter), both on `[mobile-380]`, both pre-existing specs whose code is in no slice diff, and this push's own tests (`transactions.spec.ts:566`/`:910` + the 3 C.15 tests) passed in run 1. **`gh run rerun --failed` → run 31284624859 SUCCESS. 417844c gate: GREEN.** Live: `scripts/c15-live-deploy-check.mjs` **5/5 against production** — the triage drill-in carries `back=_triage` and the detail page renders "Back to the triage inbox"; the dashboard recents drill-in carries `back=_dashboard` and renders "Back to your dashboard" (both F3 markers impossible on the previous build); zero page errors. Schema: none (prisma diff empty). The docs-record push (e4fe35d, STATUS.md + the check script — zero src/test code) ran the stall lottery the same way: CI run 31285468106 failed attempt 1 (`transactions.spec.ts:538`, the CSV line-errors `toContainText` stall) and attempt 2 (`mobile-overflow.spec.ts:386`, the route sweep, 1/1 PASS in isolation on this tree, 10.2s), attempt 3 SUCCESS — **e4fe35d gate: GREEN.** The record push itself (cbf192a) — run 31286714978 SUCCESS, gate GREEN, read 2026-08-09.****

## ✅ BUILT 2026-08-08 — C.14: the goals card names its third FI state (no more "~null months"), and a goal pledge beyond the reader's savings is charged in FULL against their FI date (DECISIONS #432)

**Both audit findings (CALC_AUDIT #21/#22) fixed and locked.** (1) `fiDelayMonths`
is null when the FI date sits past the engine's 1200-month cap — the card's
`=== 0` branch let that state print the literal "~null months", and the worked
example mirrored it with `?? 0` ("~0 months"); both now render the coach's
beyond-horizon refusal (`COACH_COPY.goalFiBeyondHorizon`, copy-locked in the
442-string sweep) while still stating the goal's own timeline. (2) The FI
simulation no longer floors the funding diversion at the whole surplus — the
FULL pledge is charged (negative savings during funding, honestly carried and
recovered) — so a pledge beyond the reader's savings reports its real delay:
the audit's executed 7-vs-29 is re-executed with integer cents and locked
(savings $1,000/mo, pledge $4,100/mo, goal $28,700, 0% → monthsToGoal 7, delay
29, hand-verified); the C ≤ S path is byte-identical (floorAtZero was the
identity there) — every existing lock on the sane case passed unchanged, only
the C > S lock moved 24 → 36 with its hand-work restated in the test comment.

**Gate:** full `VERIFY_E2E=1` run 1: tsc 0 / eslint 0 / **6,441 unit + 1 skipped
/ 392 files** / build clean / **e2e 310/312** — `budget-targets.spec.ts:61`
(the clear round-trip held 1 element through 19 retries at 2s — the exact
server-action-stall class its own header documents) and
`phase4-features.spec.ts:97` (`apiRequestContext.get: read ECONNRESET` — a
severed flight mid-request), both on the `[mobile-380]` worker, **both 7/7
PASS in isolation on this exact tree**, neither spec's code in this slice's
diff (goals engine/page + copy only). The documented severed-flight
contention class (G.1/H.2); **CI (run 31271648219 on 8d8af1c): FAILED once —
`transactions.spec.ts:637` (the CSV double-paste round-trip: toContainText
failed after 32.6s — the register page wedged on the unclassified filter,
13× unexpected URL) and `transactions.spec.ts:910` (the isolate register: the
same wedged page state, :910 being the run-1/run-2 flake of the C.23 gate),
both on the `[mobile-380]` worker, neither spec's code in this slice's diff.
Isolation proof: **both 2/2 PASS on this exact commit (16.7s)**.
**`gh run rerun --failed` → run 31271648219 SUCCESS. 8d8af1c gate: GREEN.**
Live: Vercel deployment READY for 8d8af1c; `scripts/c14-live-deploy-check.mjs`
4/4 against production. Schema: none. No demo data change (the demo's goals
are within the surplus). The docs-record push (acee935, STATUS.md + the
check script — zero src/test code) **ran the stall lottery hard: CI run
31272707342 failed attempt 1 (`category-rename.spec.ts:110`), attempt 2
(`category-rename.spec.ts:110` + `merchant-lens.spec.ts:22`), attempt 3
(`merchant-lens.spec.ts:22`) — every one the documented severed-flight
contention class on `[mobile-380]` (each 1/1 PASS in isolation on this exact
tree: category-rename 1.9s, merchant-lens 2.4s; merchant-lens was red in
the C.23 run-2 gate, isolation-green then too). Third rerun → **31272707342
SUCCESS. acee935 gate: GREEN.****

## ✅ BUILT 2026-08-08 — C.23 guided half: the Fixed-costs setup section PROPOSES series, converts long-cadence bills to monthly reserves, and names one holding account (DECISIONS #431, critic-cycled)

**Closes the STILL OPEN half of TASKS C.23** (the reserve MODEL shipped in #412). A settings section that IS the app's Fixed basis, not a second one: every counted recurring series renders with its verdict — `in your fixed costs` / `covered under <Category>` / `not counted — adding it grows the figure` / `priced by your budget` — and long-cadence series (QUARTERLY/SEMIANNUAL/ANNUAL, never MONTHLY) offer the ONE new lever, **"turn this into a monthly reserve"**: the app stores true cost + cadence and divides (the owner's ÷12), the `NOT_BILL` demotion is paired with the reserve row in one transaction, and the swap is EXACT — in-basis −rate + reserve at the same rate = the Fixed figure does not move a cent; out-of-basis +rate exactly. The lever is never offered where the swap is not exact (covered series would double-count; settlement categories are never proposed; loan payments are debts). "Move this much to reserves this month" is the plan's own reduce, and the reader names the holding account (`User.reserveHoldingAccountId` — a NAME, never a transfer; PAYMENT_ACCOUNT_TYPES; demo-fenced).

**The one-authority construction held under an executed hostile critic (fresh-context Opus, 2 P1 + 1 P2 + 3 P3, all fixed and locked):**
- **P1-1** — the pair-integrity guard covered only half the undo: a BILL re-declaration on a converted payee (reachable from the transaction-detail declaration once the next charge posts) resurrected the series while the reserve still counted it — same payee twice in Fixed, `ok: true`, executed at +1,000 cents. Now refused by the same shared check as the clear-side (`hasLinkedReserve`).
- **P1-2** — on the plan's last-resort basis (`detected-series`) the proposal's verdict used the union oracle, which skips taxonomy-discretionary series the plan COUNTS — a counted series rendered "not in your fixed costs" with a lever whose delta was zero. The proposal now takes the plan's own `fixedBasis` and re-runs `recurringPlanExpenseRows` — the very function the plan summed — as its oracle there.
- **P2-1** — `deleteGoal` (no kind filter) could delete a reserve and orphan its NOT_BILL; now refused with the #412 `OR: [kind null, kind not]` form.
- **P3s recorded not fixed**: convert prefill re-derived fresh at click (stale-read artifact, conservation holds); /settings pays a full plan load per render with no failure boundary; a superseded holding account keeps its label.

**Gate:** verify GREEN (full `VERIFY_E2E=1`) — tsc 0 / eslint 0 / **6,437 unit + 1 skipped / 392 files** / build clean; new e2e `fixed-setup.spec.ts` **5/5** (proposals render, conservation to the cent, full-pair undo restores figure AND lever, holding-account sentence, demo fence). **Schema: two additive nullable columns** (`User.reserveHoldingAccountId`, `Goal.merchantCanonical`) — `prisma db push` on deploy, existing rows/demo NULL. Three regression-ledger rows. Full-suite e2e runs: [run 1] 311/1 on `transactions.spec.ts:910`, [run 2] 311/1 on `merchant-lens.spec.ts:77` — both green in isolation (16–19s), both reload-bearing specs on the `[mobile-380]` worker, zero register/lens code in this slice's diff: the documented severed-flight contention class (G.1/H.2), CI is the arbiter. [run 3: **312/312 e2e PASSED (3.9m), full gate GREEN** — the clean local record that shipped.] **CI (run 31270118623 on e07f7d6): FAILED once — `pwa-offline.spec.ts:23` (the demo's budget set/clear round-trip wedged: toHaveCount(0) held 1 element) and, second-order, `spend-class.spec.ts:13` (the wedged clear left the demo's $123.00 groceries target live → the panel rendered "(your target)" where the spec requires "(typical)"). Root cause chain verified: pwa-offline IS the demo-mutation spec (sets $123 on the demo, then clears); the same class the budget-targets spec's header documents ("pwa-offline's budget-clear round-trip flaked exactly this way" — the pre-existing standing red, runs 31243413430/31243942530/31244506540, none touching budget code). Neither failing spec's code is in this slice's diff (no SW, no budget actions, no budgets form; this slice's budgets change adds only the converted-reserve exclusion, empty for the demo; its own new spec uses throwaway users). **Isolation proof: both specs 4/4 PASS on this exact commit.** **`gh run rerun --failed` → run 31270118623 SUCCESS.** e07f7d6 gate: GREEN.**

## ✅ CLOSED 2026-08-08 — V.4: the triage singles-mode regression was fixed by K.6 and this row was never updated

The row (opened 2026-08-01: write-in on a singles group's LAST row left
`data-remaining` stuck, "LIVE on production") does not reproduce on the current
tree. K.6 (`4a612c7`, 2026-08-06) already rebuilt the cycle-2 P1 shape —
`groupEmptied` is no longer mutated inside the `setGroups` updater
(`triage-inbox.tsx:337`) — sabotage-proven in its commit message, and re-homed
both write-in tests to `tests/e2e/triage-write-in.spec.ts` on a throwaway user
(the O.17 demo fence, not the product, had broken the old fixture). The moved
test asserts the exact V.4 scenario. **Re-verified this session on the fresh
`68c3f7f` build: `npx playwright test tests/e2e/triage-write-in.spec.ts` → 2
passed (51.2s wall; singles 3.4s, write-in 6.0s).** TASKS row closed with the
evidence.

## ✅ SHIPPED 2026-08-08 — H.2: guided CSV backfill (TASKS H.2, DECISIONS #430, critic-cycled)

Closes the last open wave-H task. The importer was rebuilt into a first-class
backfill path: per-institution export guides on `/transactions/import`
(web-verified, unit-tested), an overlap dedupe keyed on (date, signed amount)
as a multiset difference, a post-import "history now reaches \<date\>" depth
confirmation on the register's own basis, and imported rows flowing through
the same categorization + recurring-detection pipeline as synced rows.

**Hostile critic round (Opus 5, money surface — this slice's dedupe): round 1
FAIL (1 P1 + 6 P2) → round 2 PASS ("the slice may ship", zero P0/P1).**
Executed before shipping:
- **P1-1** (file-internal duplicate lines imported silently): `repeatedRows`
  added to the engine plan, `ImportResult`, and the audit meta; the form shows
  an amber warning ("the file contains N identical rows — this usually means
  two overlapping exports were pasted together") and the page copy no longer
  claims "always safe". Warn, never block — the multiset semantics are
  untouched (two genuine same-day same-amount charges still import).
- **P2-2** (picker offered non-register accounts): the page's account query is
  filtered to `SPENDING_ACCOUNT_TYPES` — the same basis the register,
  `/api/export` and the engines use — and the action itself refuses a
  crafted non-register or non-USD target with an inline error (round-2
  residual, closed same cycle).
- **P2-3** (amber contrast): both amber notes moved to the codebase's
  `text-amber-700 dark:text-amber-300` idiom.
- **P2-4** (dedupe not atomic): the check-then-act is now two reads by design —
  a planning snapshot that decides which rows pay for prepare + LLM assist,
  then the authoritative re-plan + `createMany` inside `serializableTx`
  (DB-only fn, P2034-retried). A concurrent double-import (double-click, two
  tabs) can no longer mint duplicate rows under Postgres READ COMMITTED; while
  the store only grows, the in-tx re-plan only subtracts, so no import is ever
  missed (a concurrent DELETE instead yields a countable under-import that a
  re-import repairs — never the dangerous double-import direction).
- **P2-5** (docblock overclaims): export-guide docblock + test comment corrected
  to what actually reaches the lookup (live `PlaidItem.institution` names).

**Tracked, not fixed (recorded for a future slice):**
- **P2-1** — sync re-delivery mirror hole: nothing dedupes a provider sync
  against rows the user IMPORTED via CSV (the mirror of the overlap dedupe). A
  bank that later re-delivers an imported row would re-create it. Imported rows
  are `provider: 'manual'`, so a real fix must make the sync ingest's own
  uniqueness check provider-agnostic — bigger than this slice.
- **P2-6** — depth-floor query fetches all account rows to find the minimum
  (no aggregate/`orderBy take: 1`). Correct, cheap at household scale, tracked.

**Round-2 residuals, closed same cycle:** the action gained the crafted-FormData
fence (non-register/non-USD target → inline refusal, unit-locked), the warning
copy was fixed for the partial-overlap shape (M=2/N=1 grammar + honesty), and
the "only subtracts" claim carries its monotonic-growth qualifier. Shipped as
`d17c132` + `4cf670e` (live-proof script); live deploy proven 6/6 against
production (`scripts/h2-live-deploy-check.mjs` — guides section, P1-1 copy,
demo fence). CI ship gate on `4cf670e`: run 31260280863+ watched via
`scripts/ci-status.sh` — the verdict goes in the PASS/FAIL contract below.

**Full-suite e2e re-run `bsno88rjr` (4 workers, post-H.2): 297 passed / 2 failed** —
`category-rename.spec.ts:110` and `transactions.spec.ts:538` (both on the
`[mobile-380]` worker, both reload-bearing mutation specs). Both pass in
isolation; both are the documented severed-flight contention class (G.1
doctrine: server-side correct, audit-proven, solo-green). Recorded with run id;
CI is the arbiter. The H.2 specs (:566, :637) passed in that same run and in a
standalone file run (27/27 at 4 workers after the critic fixes).

## ✅ FIXED 2026-08-08 — G.1: the standing CI red was test contention, not a product defect (TASKS G.1)

**The gate had been failing on three consecutive shas** — runs **31243413430** (`3fe37f6`),
**31243942530** (`8f32ca4`), **31244506540** (`1fd9fdc`) — always on the same single spec,
`budget-targets.spec.ts`, with unit results identical to local every time and no commit touching
budget code. That is the K.8 condition: a gate red on every push teaches the loop to stop reading
it.

**Identified by reading the failure block instead of re-running:** locator `budget-clear-dining`,
expected 0 / received 1, at `budget-targets.spec.ts:70-71` — the clear step's `toPass`, with its
full 20s exhausted. A stale read cannot survive twenty full-document reloads, so the delete never
committed, which ruled out the "single post-mutation read" class `ci-e2e-timing-flake.md`
describes (whose remedy was already applied there).

**A first root cause was WRONG and is recorded as wrong.** It read this as
`ClearBudgetButton`'s `finally`-reload cancelling its own in-flight action — which would have made
it a money-surface PRODUCT defect on a recipe shared by the budget form, goal create/delete and
money-dials save. Nothing was changed on that hypothesis. The repo had already diagnosed the real
family: `playwright.config.ts`'s worker note and `mobile-overflow.spec.ts:333-339` both record that
concurrent demo sessions on the single-writer SQLite e2e DB sever exactly the reload-bearing
mutation specs — *"pwa-offline's budget-clear round-trip flaked exactly this way"*.

**The contention was real and the spec's own header denied it:** it claimed "no other spec asserts
a budget target" while `pwa-offline.spec.ts:44-49` drives the same set/clear round-trip on the
demo user concurrently under `fullyParallel` × 4 workers. Different categories, so the ROWS never
collided — the collision was for the WRITER.

**Fix:** the spec runs on a throwaway user plus one seeded account (/budgets renders first-run
onboarding until an account exists), which removes it from the contention pool and makes its
end-of-test cleanup moot. **No assertion weakened** — the upsert-yields-ONE-row invariant
(#37/#186), the WCAG AA scan and the clear round-trip are all user-agnostic, and budget targets
are display-only, so no golden value moves.

**Gate:** verify GREEN — tsc 0 / eslint 0 / 6,381 unit + 1 skipped / 388 files / build clean; full
e2e **305 passed / 0 failed** (was 304 / 1). **CI ship gate (K.8): SUCCESS on run 31245525851 for
`fa2da16`** — the full `VERIFY_E2E=1` gate, green for the first time since 2026-08-07, and the
verdict that counts because CI is the only environment that ever reproduced the failure. Four
consecutive shas red, then green on the fix.

**Watch item, deliberately unchanged:** `pwa-offline.spec.ts` still runs its budget round-trip as
the shared demo user and stays in the contention pool. It is an OFFLINE/service-worker spec whose
point is caching the demo's real seeded pages, so moving it to a bare throwaway user could hollow
out what it tests — a bigger decision than this row. Its round-trip timeouts are 15s (vs the 2s
inner poll that broke here), so it is a watch item, not a known break.

## ✅ BUILT 2026-08-08 — H.1(b): every bank connection states its own history depth, on the register's own basis (DECISIONS #429, critic-cycled)

**Closes TASKS H.1** — (b) built here; (c) needed nothing, since #421 already records Plaid's
730-day ceiling beside `plaid.ts:189`. Wave H now has only **H.2** (guided CSV backfill) open.

**Re-measured live before building.** The corpus MOVED since 2026-08-06: **58 accounts / 4,493
rows / 3,278 owned / 27 active links**, and the register's global floor is now **2024-08-11**
(was 2026-03-25) — a Chase item with **1,395 rows**, `backfill=2026-08-07`. The deepen route
worked. That is also exactly why one global line is the wrong answer: twelve of thirteen
connections still start in **July 2026**, so a date set by the single deepest account reads as a
claim about ALL history.

**Two rules stand between "rows exist" and "the owner can see them", and the first cut only
applied one.** (1) The R1 keep rule is windowed — **seven** connections carry a raw-vs-owned
delta of **84–91 days**. (2) The REGISTER'S OWN basis (`registerRowWhere`) lists only spending
types, USD-or-null, non-split-parent rows. Missing (2) was the cycle's sharpest finding.

**Five states, each because a smaller set forced a lie:** `reaches` · `counted-elsewhere` (live:
an Amex item holds 7 rows and owns 0) · `balances-only` (investment/loan/mortgage — they never
send transactions) · `not-counted` (currency-withheld; must not be called empty when the card
NAMES the account one line above) · `no-rows`, which finally means what it says.

**CRITIC CYCLE 1 — two fresh-context critics (data integrity; copy/UX), BOTH FAIL: 6 P1 + 5 P2
+ 5 P3, every finding executed, all six P1s fixed and locked.** The two that mattered most:
(a) a connection rendered *"History goes back to Mon, May 18, 2026"* while /transactions showed
zero rows and did not offer the account in its dropdown — the H.8 defect reproduced inside the
slice built to avoid it; (b) **all four** connections showing "No transactions yet." were 100%
never-transactional accounts (U.S. Bank ×2 LOAN, Vanguard ×4 INVESTMENT, Schwab ×2 IRA, Truist
×1 MORTGAGE — 9 of 9), each synced cleanly that morning, so 31% of the owner's connections were
being told to wait for something that is never coming.

**Live re-measure with the shipped rule** (`h1b-depth-states.mts`, read-only): **9 reaches / 4
balances-only / 1 counted-elsewhere, and ZERO false "No transactions yet."** SimpleFIN now
answers too (**History available from Wed, Mar 25, 2026**) — 43% of the owner's accounts, and
deeper than seven of the eight Plaid connections that print a date. It renders in the ORPHANED
branch as well as the connected one, because the owner's `SimpleFinConnection` row is deleted
(#421) and a line wired only into the connected branch would have answered for every user
except the one who most needs it (regression-locked).

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,381 unit + 1 skipped / 388
files** / build clean; connection e2e **18/18**; full e2e **304 passed / 1 failed** —
`budget-targets.spec.ts:20`, the pre-existing flake this file already names by line for H.7b
(green on re-run with this code present). Four post-critic sabotages (register basis;
split-parent filter; the never-transactional state; the reverted sentence) each turned exactly
its own locks RED, all restored. No schema change.

**CI ship gate (K.8):** run **31243413430** for `3fe37f6` came back **failure** on a single spec —
`budget-targets.spec.ts:20`, signature `toHaveCount … 20 × locator resolved to 1 element`. Unit
results were IDENTICAL to local (6,381 passed / 1 skipped / 388 files); e2e 304 passed / 1 failed.
Proven not this slice's: `git log --stat` confirms the commit touches no budget file, and the same
spec reddened H.7b's gate (green on `rerun --failed`) and a full local run here (green on re-run).
`gh run rerun --failed` was issued and then **cancelled** — by this session's own docs-only push,
which is now its own lesson (a cancelled run is an absence, not a pass). Re-read against the newest
sha: run **31243942530** (`8f32ca4`, which contains the whole slice) is **also failure, on the
SAME single spec** — unit again identical to local (6,381 / 388), e2e 304 passed / 1 failed. Two
CI runs, two shas, one spec, and that spec was already red on `58cb989` and `e772d8f` before any
of this existed, so the slice closes on rule 5's pre-existing clause with both run ids recorded
here. **The flake itself is NOT waved through:** the remedy `ci-e2e-timing-flake.md`
prescribes is already applied to that spec's clear step and it failed anyway, so re-running is not
a diagnosis — filed as **TASKS G.1** with identification (which `toHaveCount`) as the first
deliverable, ahead of any fix, and with an explicit "do not weaken the assertion" (it guards the
upsert-yields-ONE-row invariant on a money surface). **G.1 is now IDENTIFIED, and it is probably
not a test defect at all:** the failing locator is `budget-clear-dining` expected 0 / received 1 at
`budget-targets.spec.ts:70-71`, with the 20s `toPass` fully exhausted — a stale read cannot survive
twenty full-document reloads, so the delete never committed. The standing hypothesis (labeled, with
its confirming step written into the TASKS row) is that `ClearBudgetButton`'s `finally`-reload fires
while the 8s-deadlined action is still in flight and cancels it, which would contradict both
`form-deadline.ts` ("abandons the AWAIT, not the WRITE") and the button's own "usually COMMITTED"
comment — and would make this a money-surface product defect shared by every form on that recipe,
not a flake.

**Live deploy proof: 6/6** (`scripts/h1-live-deploy-check.mjs` against www.aimplifi.app) — new
build serving (this slice's copy found in a live `/_next/static` chunk), /accounts rendering
through the rewritten loader on PostgreSQL, the register's global line untouched, no depth line
invented for the demo's zero connections, no client errors. **Honestly scoped and said so in the
script header:** production's only reachable account is the shared demo, which has no connections
and no links, so this proves the zero-links fast path only — the PostgreSQL LINKED path is covered
by the unit and e2e gates on SQLite and by the read-only prod replay, not by this script.

**STILL OPEN after H.1(b), recorded not fixed:** (1) **prominence** — the depth line is the
third identically-styled muted line on each card (+11% card height at 380px, no overflow); the
copy critic marked this optional and it is recorded rather than churned; (2) **`counted-elsewhere`
names no account** — the data to name the claimant exists on `AccountsView.reconciliations`, but
three executed shapes have two or more claimants, so the sentence is deliberately unnamed and
points at "Account cleanup" instead; (3) **connection cards carry no `role="group"` or accessible
name** — pre-existing, so a screen-reader user hears the card's lines as unattributed fragments;
this slice added a third one without fixing the grouping; (4) the depth read for linked accounts
is **row-sized, not date-sized** — `distinct` is client-side in Prisma (critic captured the SQL
on both datasources), so it grows with history depth, though it is skipped entirely for any user
with no combined accounts.

## ✅ BUILT 2026-08-08 — H.7b: the wrongly-written transfer flags get an owner-triggered, undoable repair (DECISIONS #428, critic-cycled)

**Closes STATUS §STILL OPEN after H.7 residual 1** — the highest-money open item in this
file: the settled rows the pre-H.7 coincidence rule flagged, which the shipped rule
declines, measured live at **53 rows / $29,848.84** (4 income-categorised) withheld from the
owner's totals. **Partially closes residual 4**: the repair is the app's first and only
`isTransfer: false` write path — scoped to declined flags via an explicit owner action,
never a general un-flagger, never a sync's.

**The shape is the one this file prescribed**: preview states the change before it happens
(rows, dollars by direction, the income count), the apply is an owner tap on /settings
("Transfer mark repair", beside AI trust), the run is recorded (`TransferFlagRepairRun`,
additive — after a clear, a repaired row is indistinguishable from a never-flagged one, so
the run is the only record undo can restore from), and undo is atomic, newest-run-only, and
skips any row the reader re-decided since (their value wins). One rule, not two: the planner
replays the SHIPPED `planTransferUpdates` from scratch over the sweep's own read, so a
cleared row cannot bounce back on the next sweep — locked through the real
`refreshTransferFlags`. The counts are recomputed live at preview and again at apply;
nothing hardcodes the measured 53.

**Critic cycle 1: two fresh-context critics (money semantics; copy/wiring), both FAIL —
6 P1 + 5 P2 + 9 P3, every finding executed, all but one fixed same cycle** (detail in
DECISIONS #428; 6 regression-ledger rows; three sabotages re-executed RED). The finding that
sets this slice's residual: **a GENUINE cash advance or balance transfer out of a card would
be actively un-flagged** — the one class `CAN_SEND_ACCOUNT_TYPES` cannot see, H.7 residual
2's refusal converted into an act, and unfixable by the sweep since repair and sweep share
one rule. Mitigations shipped: the caution names the class and the remedy before the button;
the row list is shown first; the act is undoable; zero such rows exist on the live corpus
(`h7-sender-types.mts`).

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,345 unit + 1 skipped /
385 passed files (386)** / build clean; e2e **4/4** (the new `transfer-flag-repair.spec.ts`
apply→undo round trip + all three settings specs). Schema: additive `TransferFlagRepairRun`
only (prisma diff = one new model; deploy runs `prisma db push`, no existing rows touched).
**CI ship gate (K.8): success** on run 31239696772 for `0c72db9` (the full `VERIFY_E2E=1`
gate; the slice commits are `3ee4720` + `500c37e`, whose own run 31239506594 was cancelled
as superseded by the proof-script push minutes later — same source tree). Attempt 1 failed
on **`budget-targets.spec.ts:20` only** — the documented pre-existing `toHaveCount`
single-post-mutation race (red on `58cb989`'s and `e772d8f`'s gates before any H.7b code
existed; nothing in this slice touches budgets); `gh run rerun --failed` → **success**.
**Live deploy proof: 5/5** (`scripts/h7b-live-deploy-check.mjs` against www.aimplifi.app):
new build serving (the card's testid is the unique marker), `TransferFlagRepairRun` live on
Neon (the /settings render requires its `findFirst`), the shared demo lands in a truthful
named zero with no write doors, no client errors.

**STILL OPEN after H.7b, recorded not fixed:** (1) **per-row selection** — the apply is
all-or-nothing; an owner holding 52 wrong flags and 1 genuine cash advance cannot repair the
52 without un-marking the 1 (today: zero such rows live; the caution names the manual
remedy); (2) **declined flags OUTSIDE the scope stay withheld** — filed-as-'transfer' by the
old rule, pending, non-USD, reader-excluded, pinned: counted and disclosed on the card,
repaired by nothing (unfiling a recorded filing and minting review work are different acts
with their own consequences); (3) a pair straddling the scope boundary repairs one leg while
the transfer-filed leg stays excluded — same money, two verdicts, disclosed via (2)'s count;
(4) `TransferFlagRepairRun.inflowCents/outflowCents` share the repo-wide `Int` (int4)
ceiling; (5) H.7 residuals 2, 3, 5, 6 stand unchanged. The /settings load now pays the
full-corpus replay (~200ms at 3k rows) on every render — measured acceptable, noted here so
a future settings slowdown has its suspect named.

## ✅ BUILT 2026-08-07 — H.6b(a): the combine carries the reader's hand-filed work onto the successor's copies (DECISIONS #427, critic-cycled to the hard cap)

**Closes TASKS H.6b(a)** — the last OPEN item of H.6's critic's three findings, and the
highest-ranked OPEN P1 in STATUS. In a successful deepen the boundary keeps the old side's
first day and disowns everything after it, so the reader's filing on those rows stopped
counting in favour of the new connection's untouched copies. `planReaderFieldCarry`
(`src/server/combine-connections.ts`, pure planner unit-tested first) now moves that work onto
the successor's matching copy — exact date + amount, C.6's multiplicity gate on BOTH sides
(never a guess), and a carry can never refuse a combine.

**The doctrine, in one line: the survivor's own reader values always win, and a row no surface
reads receives nothing.** Corrections MOVE (`updateMany transactionId`), never copy. A settled
verdict carries only where no reader value claims the row — blocked by the survivor's own
correction, its review pin, a split-child shape, a stale pred family (destroyed decisions
re-decide: forced into DURABLE review, the transplant's dissolve precedent), and a survivor
that is itself a split container, from ANY source. Engine guesses never travel (no Correction =
no reader decision). Split families carry whole onto a plain survivor; both-split combines
carry piece flats by unique match; the survivor's own flat flags (note, taxClass, exclusion,
reimbursement) inherit onto re-created pieces — O.15 P1-1's "the pieces inherit the reader's
'not my spending'" extended to all four (NEW-1).

**Four critic cycles — the hard cap, used to the last.** Every finding executed and locked with
discriminating tests: P1-1 (refiled old piece never replaces a survivor piece's own category),
F1 (an un-filed parent — splitting never mints a Correction — no longer gates its pieces'
flats), F2 (pred-side multiplicity), F3 (a stale family never pins an intact dangling-child
allocation into durable review), NEW-1, NEW-2 (caveat copy now promises the carry, not
everything), and cycle 4's Finding A (the cap): the per-row write targeted the survivor's
CONTAINER — a row the register, the tax export and the reimbursement line all skip — so a
verdict + Correction would have fed the learner evidence contradicting the reader's own pieces
and the pred row's live flats (exclusion, claim, tag, note) would have stopped applying. Fixed
per the critic's own prescription and locked with the demanded A1 test: containers never
receive a verdict, a correction move or flats; flat state routes onto the container's children
as a survivor-first gap-fill. No fifth fresh-context critic ran; this entry records the cap
honestly, as O.19/H.6c/H.7 did. The P2 caveat rider from cycle 4 ("unless the new copy already
carries your filing, which always wins") is applied and e2e-re-locked.

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,303 unit + 1 skipped / 381
passed files (382)** / build clean (the documented fi-real-basis hook flake did not reproduce);
deepen-history e2e **2/2**, re-run after the caveat copy's final edit. **No schema change** —
`git diff --stat -- prisma/` empty. **CI gate: success** on run 31234685975 for `ea27091`
(the full `VERIFY_E2E=1` gate, read via `scripts/ci-status.sh` — same mechanism that caught
O.19's five). The two follow-up docs-only pushes (ledgers `ccdaf1a`, gate note `e165404`;
diffs are docs files only, zero source/tests) ran 31235121073 and 31235580774. 31235121073 →
**failure on the documented pre-existing CI flake only: `budget-targets.spec.ts:20`** (same
spec, same `toHaveCount` single-post-mutation race the 2026-08-07 ledger row records — red on
`58cb989`'s and `e772d8f`'s gates before this slice). 31235580774 → **failure on
`transaction-detail.spec.ts:188` + `mobile-overflow.spec.ts:386`** — no prior-run record, so
not waved off: diff-scope proof (byte-identical test+app code passed the full gate at
`ea27091` ~30 min earlier), both specs pass locally, and `gh run rerun --failed` →
**success** (the ci-e2e-timing-flake class: CI load wins a race the test invites, it does not
create it). Ship gate for the slice's code stands on 31234685975 (success); head of main is
green.

**STILL OPEN after H.6b(a), recorded not fixed:** (1) a succ-side DISOWNED row (in the deepen
shape, the pred's own claim day) still loses its filing — there is no reverse carry, and the
boundary is R1's rule, not this slice's; (2) the null-check can't distinguish a reader's
deliberate blank from an untouched copy — the survivor's blank still wins, same direction,
never a clobber; (3) sequential combines are order-dependent; (4) after a branch-A carry
`findOffsettingInflow` can't match a whole-charge refund to the re-created pieces (display-time
only). The H.6c STILL OPEN item (2) — `excludeFromTotals`/`isTransfer` parity between the two
copies unmeasured — stands.

## ✅ BUILT 2026-08-07 — O.19: /accounts hides the combine machinery and keeps its claim (DECISIONS #426, critic-cycled)

**Closes TASKS O.19** (filed as "O.18"; renumbered because Wave O.18 — expandable rows — already
owns that id). Owner: *"Can we get rid of all the combine accounts on accounts page. Looks like a
beta website … Maybe hide it for now."* Five cards that stacked above his own accounts — combine
offers + blocked reasons, reconciliation candidates, ambiguities, the combined-accounts card with
its Undo, and the #192 duplicate warning — are now behind one collapsed `Account cleanup`
disclosure. HIDE, NEVER DELETE: nothing is unmounted, the cards keep every string they had, and
the server-side guards are untouched (`git diff --name-only` shows **zero** files under
`src/server/` or `src/lib/engine/` in the build half of the slice).

**What stays visible is the claim, not the machinery.** Two of those five say something about a
figure printed on the same page — a balance counted twice, and an account missing from the list
because it was folded into another — so the collapsed line carries them: a constant heading plus a
detail clause chosen by evidence strength, with the fold always named in its own clause. Every
sentence anywhere in the app that sends a reader to the Combine control now names the section by
importing the heading (15 sentences across the page, /cards, /calendar, the dashboard, the digest
and reminder emails).

**Critic cycle 1: two fresh-context critics, both FAIL — 1 P0 + 4 P1 + 4 P2, all executed, all
fixed** (detail in DECISIONS #426). The P0 is the slice's own governing lesson turned on itself:
the money sentence went to the ADVISORY pairs (the residue with no proven remedy) while the case
the app is certain about got a procedural "can be combined", so a critic's executed fixture showed
net worth **$2,000.00 for $1,000.00 of real money with the word "twice" nowhere on the page** — and
this slice's e2e had asserted the weakened clause, ratifying it. Also fixed: a pair count printed
as a balance count (three copies of one account read "3 balances"), the missing-account claim
collapsing into "· N more", 11 unfixed "Accounts lists the choices" sentences including one in an
email, and a `role="alert"` that can no longer fire because it is born hidden.

**Gate:** `VERIFY_E2E=1 bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,274 unit + 1
skipped / 381 files** / build clean / **full e2e 303 passed**. One executed sabotage (restoring the
procedural clause) turns four locks red at once; reverted and re-gated. **No schema change** —
`git diff --stat -- prisma/` empty. Live deploy proof `scripts/o19-live-deploy-check.mjs` **9/9 on
production**, including an anti-vacuity check that the JS actually served contains the new heading
(the demo has zero `PlaidItem` rows, so the section's ABSENCE there is the contract — which would
pass against the old build too).

**CI caught five failures a targeted run did not, and both mechanisms are now a lesson.** The first
push (`319f161`) was gated only against the four specs the task row named; the full CI gate failed
**5**. Four were `reconcile.spec.ts` — it drives the reconciliation candidate cards and was simply
not on the row's list, which a `getByTestId` grep for every wrapped testid finds in one command. The
fifth was a REAL copy defect, not test debt: `dashboard-duplicate-disclosure.spec.ts` extracts every
curly-quoted string from the disclosure and asserts each names a card the reader can find, so
writing the section as `“Account cleanup”` borrowed a convention that means "a row on this page".
The lib-side copy now says `in its Account cleanup section`, unquoted. Both recorded in
`docs/lessons/hiding-a-surface-reassigns-its-claims-by-certainty.md` (rules 8–9).

**Open behind it, recorded not fixed:** (1) the section paints closed on first render after every
mutation reload, so there is a brief layout shift — a session cookie read server-side would remove
it and also close a theoretical pre-hydration toggle race (both P2; neither can print a wrong
figure); (2) the read-only probe `scripts/audit-probes/o18-accounts-clutter.mts`, which would
measure how tall the wall actually was on the owner's live corpus, is **committed but UNRUN** —
blocked by the permission classifier, same as K.2(a); (3) with 13 connections the Bank-sync list
below is now the densest thing on /accounts and is the next candidate for the owner's
"beta website" signal — out of scope here by the task row's own boundary.

## ✅ BUILT 2026-08-07 — H.6c + H.6b(b): the combine's last step goes the right way (DECISIONS #425 + addendum, critic-cycled)

**Closes TASKS H.6c and the (b) half of H.6b — the two follow-ups H.6's critic filed.** The
/accounts combine card's PRIMARY button now proposes keeping the connection whose FEED reaches
further back (`keepRank` rule 3, ahead of linked-first), and one hand-split transaction no
longer refuses the whole combine with a false diagnosis.

**Critic cycle 1: two fresh-context critics in isolated worktrees, both FAIL — 1 P0 + 5 P1 +
3 P2, every finding executed, all fixed same cycle** (full detail: DECISIONS #425 addendum).
The P0: the first bank-shape guard assumed split children share the parent's date, and the
pending→posted sync drifts them apart — a drifted split let the combine DELETE a counted
$100.00 behind `ok: true`. The guard now computes the boundary's own window over ALL rows,
refuses outright when it would sever a split family, and counts dangling children as the money
they are. The depth P1s: depth is now FEED depth (`providerRef` non-null — one hand-typed
backdated row must not flip an irreversible default), the multi-account fold is locked, the
deep-history refusal names the true remedy ("combine the other way round"), and the card
renders `combineDepthNote` beside each direction — the mid-pull deepen state's only on-page
warning that a tap would revoke the connection still downloading (jsdom-locked wiring).

**Gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6,256 unit + 1 skipped / 380
files** / build clean; combine-connections + deepen-history e2e **4/4** serialized on a fresh
build. **Eight executed sabotages across the slice** (depth rule deleted, view map starved,
guard filter reverted, successor-side raw, orphan arm dropped, severed check deleted, fold
inverted, feed filter dropped) — each turning exactly its own lock RED, each restored. No
schema change, no prisma diff. 2 + 3 regression-ledger rows.

**CI: red three consecutive runs, then DIAGNOSED as a test defect rather than re-run until
green.** `category-rename.spec.ts:110` failed the gate on `015c42b` (×2, unit fully green both
times) and `109b23e` (×1) while passing 18/18 locally — because the settings remove-category
toggle is deliberately OPTIMISTIC with rollback (#167), so the spec's "removed" assertion was
the client's echo, not the committed write; on a loaded CI runner the next navigation's server
read beat the commit, and a full document response never re-polls. The spec now confirms on a
RE-RENDERED /settings (reload inside `toPass`) before reading the picker — the component's own
rename-flow rule ("the re-rendered page is the confirmation that can't lie"). Ledger row
2026-08-07. budget-targets (the documented CI flake) failed attempt 1 only. The closing push's
CI conclusion is recorded below when read.

**STILL OPEN after H.6c/H.6b(b):** ~~(1) H.6b(a) — hand-filed work stop being applied after a
combine~~ — **CLOSED 2026-08-07 by DECISIONS #427** (STATUS §H.6b(a) above); (2) the guard
compares only (date, amount) — `excludeFromTotals` / `isTransfer` parity between the two copies
is not checked, so a combine can revert an exclusion decision on the dropped side
(pre-existing, critic-noted, unmeasured); (3) H.6's P2s stand (two link-token minters on
/accounts; no rate limit on `createPlaidLinkToken`; no server-side deepen audit mark); (4) the
owner's per-institution deepen walk-through (STATUS §H.6) is unchanged and still the only thing
that moves data.

## ✅ BUILT 2026-08-07 — H.6: the 730-day Plaid window stops being discarded (DECISIONS #424, critic-cycled)

**Owner, verbatim: *"Unacceptable we don't have at least plaid maximal dates."* He was right,
and the cause was ours, not Plaid's.**

**SHIPPED-GREEN 2026-08-07: CI run 31209654673 `success` on `211a4fd` — the full `VERIFY_E2E=1`
gate, conclusion read via `ci-status.sh` (exit 0), 19:01:52Z → 19:12:56Z.** The two runs before
it (31208665347 on `abe7c86`, 31208789658 on `5d83438`) came back `cancelled`, each superseded by
this session's own next push — not test failures.

**PROVEN LIVE 2026-08-07:** `scripts/h6-live-deploy-check.mjs` **11/11 PASS** against
https://www.aimplifi.app — the served /accounts bundle carries the new door, the door does NOT
render for a user with nothing to deepen, and all three critic-forced copy corrections shipped
(including the anti-vacuity check that the pre-critic false promise is ABSENT from production
JS). Local gate: tsc 0 / eslint 0 / **6,232 unit + 1 skipped / 379 files** / build clean; new
e2e 2/2 and adjacent connect/duplicate specs 12/12.

### What was actually wrong

Plaid freezes an Item's transaction window when Transactions is added to it — *"Once
Transactions has been added to an Item, this value cannot be updated"* (plaid.com/docs/api/link/,
fetched this session) — and names `/item/remove` plus a fresh trip through Link as the only
remedy. We have asked for the 730-day maximum on every new link since 2026-07-31, but all 13 of
the owner's Items were created 2026-07-23/24, so each carries the 90-day default. The measured
floor (oldest Plaid row `2026-04-24`) is exactly `2026-07-23 − 90d`; the arithmetic closes, and
`backfillItemHistory` returned `added: 0` on all of them because Plaid holds nothing outside an
Item's birth window.

**The defect: the owner could not perform the remedy, because the app undid it.** A 730-day Item
necessarily returns the SAME accounts as the 90-day one, so `classifyNewItem` marked it
`whollyRedundant` and `decideAndPersistItem` handed it back to Plaid (`plaid.ts:505-522`) —
keeping the shallow connection and destroying the deep one. That branch is L.10 layer 2 working
correctly for the case it was built for; re-linking for DEPTH is the one case where *"it just
refreshes"* is the wrong answer.

**This corrects the record twice over.** K.2 said *"Route C is dead for depth, confirmed twice"* —
both confirmations measured how much history the existing Items hold, neither executed the route
and read what the app does with the result. TASKS H.6 budgeted 90k for a dedupe engine that was
never needed: `combineDuplicateConnections` already folds the old connection into the new one, and
`applyReconciliationBoundary` already keeps the successor's deeper rows
(`reconcile-boundary.ts:17-23`, critic cycle-1 F2).

### What shipped

One explicit owner intent (`deepenHistory`), carried from a new /accounts door through the
localStorage record that survives the OAuth redirect, into the server action and the provider. It
exempts the wholly-redundant discard and nothing else — the lease, the live `/accounts/get`
interrogation of every candidate, and the identity ladder all run unchanged, and the ordinary
front door still refuses. Two sabotages: removing the exemption fails exactly its own lock (1 red
/ 28 green); leaking it to every link fires 9 of L.10's tests.

### Residuals — recorded, not fixed (fresh-context critic: 0 P0, 4 P1)

1. **H.6c (P1, OPEN — highest-priority follow-up).** The /accounts combine card's PRIMARY button
   proposes dropping the connection that holds the history. `keepRank` ties on health and on
   `lastSyncedAt` (a calendar day, so same-day ties are the norm) and falls through to *"linked
   first wins"*; the recommended proposal renders first as `variant="default"`. Critic-executed:
   `RECOMMENDED keep=old drop=new`. Combine REVOKES the dropped Item, irreversibly, most likely
   before Plaid's background historical pull has finished. **Mitigated in copy, not fixed:** the
   flash now names the ordinal to keep and what the other choice costs (locked). The real fix is
   a depth rule in `keepRank` ahead of the linked-first tie-break.
2. **H.6b(a) (P1, DISCLOSED).** After combining, each account reads from the new connection's
   copies, so categories, notes and splits filed by hand on the old copies stop being applied —
   `handoverDate` clamps the cutover to the predecessor's FIRST transaction whenever the successor
   reaches further back, which is what a successful deepen guarantees. No money moves, nothing is
   deleted. Now an amber caveat on the door (e2e-locked as its own element); carrying the fields
   across is the fix.
3. **H.6b(b) (P1, OPEN — blocks the owner where he has split a transaction).** One split on the
   old connection makes the whole combine refuse with a FALSE diagnosis (*"2 charges totalling
   $100.00 appear on only one of them"*), because `rowsLostToTheSplit` is fed rows filtered
   `isSplitParent: false` and compares split CHILDREN against the successor's PARENT. Refuses
   safely — a blocked remedy, not data loss. Named fix in the TASKS row.
4. **P2s not actioned:** two link-token minters now mount on /accounts and `createPlaidLinkToken`
   has no rate limit (unlike its update-mode sibling); the exemption writes only the ordinary
   `plaid.item.link` audit row, so nothing server-side distinguishes "the owner asked for depth"
   from "the collision check abstained"; the door is one button for thirteen connections, with no
   per-connection depth readout.

### What the owner has to do (per institution, and only he can)

Link the bank again from **Only seeing a few months? → Get the full two years of history**,
sharing **the same accounts** as before → the app keeps both and says so → **wait** for the older
transactions to appear → combine the two, keeping the connection just added (the highest-numbered
one at that bank). Until H.6c lands, the card's prominent button proposes the opposite direction.

### Suite flake, measured not diagnosed

One full unit run failed 2 tests in `cron-notify.test.ts` (delivery counted 0, then a
`pushSubscription.create` conflict). The same tree re-run passed 6,227; the file passes alone; the
stashed clean tree at `ddd7682` passed 6,224. Same code, different verdicts — non-determinism in
that file, outside this diff.

## ✅ BUILT 2026-08-07 — K.2(b): a deleted connection stops impersonating a stale one (DECISIONS #423, critic-cycled)

**SHIPPED-GREEN + PROVEN LIVE 2026-08-07: CI run 31148722758 `success` on `82a8d7d`
(the full VERIFY_E2E=1 gate; conclusion read via ci-status.sh, exit 0) and
`scripts/k2b-live-deploy-check.mjs` 9/9 PASS against https://www.aimplifi.app —
attempt 1 mid-deploy correctly failed the three new-marker checks on the old build,
proving the markers change-unique.** The live check claims exactly what an anonymous
+demo run CAN prove: the negative direction live (demo still gets the unchanged
first-time door, no notice, no freshness lines) and build identity (the served
bundle carries the new strings and NOT the critic-killed remedy tail); the orphaned
state's behavior is proven by the e2e (CI-green), and materializes on the owner's
account on his next /accounts visit.

**Closes K.2 sub-items (a) and (b); the DATA remains gated on the owner reconnect.**

**(a) The probe RAN** (was permission-blocked): the 25 frozen SimpleFIN accounts are
**Amex 2 / Capital One 5 / Schwab 10 / Chase 4 / Vanguard 4** — so ONE SimpleFIN
reconnect serves five of seven institutions; **Truist (mortgage) and U.S. Bank (2
loans) are Plaid-only**, so their only multi-year route is per-bank CSV (H.2), and
Truist stays the designated one-bank 730-day re-link test (K.2 correction). Anomaly:
one Plaid CREDIT account with **264 rows joins to NO PlaidItem** (the 3 removed
items) — permanently frozen, and now NAMED on /accounts by this slice.

**(b) Built, engine-first:** freshness level `disconnected` + REQUIRED
`connectionRemoved`, claimed only on PROOF — a simplefin account with no connection
row (the row IS the connection), or a plaid account whose stamped `plaidItemId`
matches no live item (removeItem stamps before deleting ⇒ dangling = removed).
`plaidItemId: null` (pre-#256) stays unknown, NEVER "removed" — the catastrophic
direction, sabotage-locked. Outranks `not_shared` and the INVESTMENT early-return.
The /accounts front door over orphaned accounts becomes a RECONNECT (amber notice
naming the count + "no new transactions since <date>"; "Reconnect your bank"), never
first-time setup; per-row copy drops the "you may need to reconnect" hedge for
"Bank connection removed — last transaction N days ago".

**Two fresh-context critics (isolated worktrees), both FAIL, 0 P0 — all P1s fixed
same-session:** (copy lens, 3 P1) the per-row "Reconnect to resume updates." was
FALSE on a Plaid dangling row (re-link mints new ids — executed) and on a superseded
predecessor (frozen by design; the migration flow's own end state) → remedy tail
DELETED, the front door carries it for the one provider where it's true, and
`orphaned` excludes active superseded predecessors (K.1 P0-1 precedent); "resumes
where your data stopped" cut (H.5 backfill is oldest-first — the gap fills LAST).
(wiring lens, 1 P1) sabotage (e) flipped the count's declared all-accounts basis to
supported-only and ALL 6,180 tests stayed green → EUR-holds-the-newer-transaction
lock added, sabotage re-run RED (REGRESSION_LEDGER 2026-08-07). Wiring critic's
false-direction hunt: 6/6 probes held; every deleter of both connection-row types
enumerated; no level leak (only accounts-list + freshnessMessage consume it). Clock
pin: 60/60 under `DEMO_TODAY=2031-12-25 TZ=Australia/Eucla`.

**STILL OPEN after K.2b, ranked:** (1) **the owner reconnect** — unchanged, the only
thing that moves data (setup token at simplefin.org → the new Reconnect door); (2)
**the dashboard banner still hedges** ("a sync may have stopped — check your
connections") over the proven fact — portfolio-scope, own slice; (3) **H.5 fills the
disconnect gap LAST** (oldest-first capped batches) while rows read "Synced today" —
after a reconnect, current-month spending is understated until the backfill reaches
2026; machinery, own slice; (4) H.2 per-bank CSV instructions (route table above
names the banks); (5) pending-at-disconnect rows that later post backdated can fall
between the 5-day live window and a stamped backfill (P3, recorded); (6) SimpleFIN
account-id stability across bridges UNVERIFIED (P3 hypothesis).

## ⚠️ FOUND + PARTIALLY BUILT 2026-08-06 — K.2: the multi-year history ask is not blocked by code, it is blocked by a connection that no longer exists (DECISIONS #421)

**Owner:** *"why haven't we populated 2023-2026 yet. I want all data possible."*

**Re-measured live this session** rather than quoted — `h1-connection-depth.mts`
(read-only, committed) against Neon: 56 accounts, 3,087 rows, 1,872 after the R1
keep, register floor **2026-03-25**.

**Nothing was skipped — both automatic routes were already asked for their
maximum.** Plaid sits at its documented 730-day ceiling (`plaid.ts:189`); all
**13** items show `backfill=2026-08-04` and the oldest Plaid row anywhere is
**2026-04-24**, so Plaid holds no more and a fresh Link (H.6) cannot reach 2023
by construction. **The blocking fact is different and was not previously in
STATUS: the `SimpleFinConnection` row is DELETED** — the probe buckets 25
accounts and 1,684 rows under `simplefin:NO-CONNECTION-ROW`, frozen
[2026-03-25..2026-07-21]. SimpleFIN is the only automatic route that reaches
years, and it has had nothing to run against for ~16 days.

**Shipped this session (#421):** `SIMPLEFIN_INITIAL_LOOKBACK_DAYS` 1095 → 1460.
At 1095 the window stopped at **2023-08-07**, leaving Jan–Jul 2023 unreachable —
the owner named 2023 and would have received five months of it. 1460 lands on
2022-08-07. Locked as a property (from any "today" in 2026 the window still
reaches 2023-01-01), which caught its own off-by-one pre-commit: 2026-12-31 maps
to *exactly* 2023-01-01, so the assertion is `<=`. **This moves no data by
itself** — it sizes the ask the add-only backfill makes the next time a
connection exists to make it. `connectSimplefin` is already correct for the
reconnect-after-disconnect case (`create:` with `lastSyncedAt = today` because
1,684 rows are retained, `historyBackfilledAt` left null to arm the backfill).

**STILL OPEN, ranked:** (1) **the owner reconnect** — a SimpleFIN setup token,
owner-only, and the only thing that moves data; (2) **the accounts page cannot
say the connection is gone** — with no connection row, freshness falls back to
newest-txn-date and prints "No new data in 16 days — you may need to reconnect"
(`health.ts:82`, `accounts-list.tsx:1317`) while `feedDroppedAt` stays null (its
only writer is an active sync), so a DELETED connection is indistinguishable
from a stale one and the entry point reads as first-time setup
(`simplefin-connect-btn`) — traced read-only, **not** UI-verified, confirm before
building; (3) `scripts/audit-probes/k2-institution-routes.mts` was written this
session to name the 25 SimpleFIN accounts' institutions and was **BLOCKED by the
permission classifier** — never ran, so the route table is Plaid-granularity only
and no per-bank CSV instructions can be written yet; (4) H.2's guided per-bank
CSV import remains the only route for institutions that cap short, and the only
route to 2023 for the Plaid-only banks; (5) SimpleFIN's ask ≠ SimpleFIN's answer
— the institution caps what comes back, so depth stays unknown until a real pull.

## ✅ BUILT 2026-08-06 — K.1: the past half of /calendar is recorded fact, totaled by the register's own math (DECISIONS #419, critic-cycled ×2)

**DEPLOYED + PROVEN LIVE 2026-08-06 16:25 ET — `scripts/k1-live-deploy-check.mjs`
8/8 PASS against https://www.aimplifi.app on commit `a59c5ea`** (attempt 1, mid-
deploy, correctly FAILED on the old build — the markers are change-unique). Live
header reads "Posted + pending through Wed, Jun 10: in $0.00 · out $1,039.22 · 3
pending" (the demo's three pending rows, named); May 2026 paints 23 posted days
each linking to its one-day register window; January 2023 names the history floor.

**Closes TASKS K.1** (owner: *"Calendar makes no sense. I have forward data but not
trailing?"*). Days on or before today now paint what the banks actually reported —
per-day Money in / Money out / count, each day linking to the register pre-filtered
to that one day — and every event after today is a labeled projection ("scheduled"
badges, "Expected:" header line, `(est.)` on repeated card cycles). The gate (the
two money surfaces must not disagree on a total) is structural: one where-clause,
one reconciliation keep, one `summarizeTransactions`, locked at function, loader
(register-equality with hand-verified values) and DOM-to-DOM (e2e reads both pages'
painted figures). Zeros follow K.3's rule with the bound inside the reason;
history floor and trailing-lag edge named where the gaps are. Posted half is
viewer-only at household scope by design, said on the page.

**Both fresh-context critics returned FAIL (4 P1 + 12 P2); all P1s and 8 P2s fixed
and locked, 2 regression-ledger entries.** Converged P1: "Posted" over PENDING
money (the demo's pinned month holds three pending rows) — now "Posted + pending"
with per-day counts and a footer stating pending can change. Wiring P1: the first
clamp started projections at today+1 while the assembler's window is `>= today` —
a bill expected today painted nowhere, and the dip paragraph could vanish while
the frozen notice claimed it was on screen (the day list now keeps the shortfall
day unconditionally). Copy P1: before-history denied the CSV reconstruction the
register's own empty state offers one click away.

**STILL OPEN after K.1, ranked:** (1) **K.5** — see below, the biggest find of the
session; (2) the duplicate/frozen banners' "the money-out total above" clause is
ambiguous now that TWO out-figures sit above it (copy lives in
`card-duplicate-view.ts` + `feed-dropped-view.ts`, both critic-cycled — own
slice); (3) a frozen non-card feed silently thins recent posted days — the frozen
notice qualifies dues and the funding projection, never the posted half (parity
with the register today; belongs with the L.19 surface-(3) family); (4) two
full-history loads per calendar view (`getCashNeeded` + the posted read) — the
register's own load-all precedent, ROADMAP #8; (5) the past-day net label and
shortfall-day-keep are page-level and locked only via the e2e labels, not
independently.

## ⚠️ FOUND 2026-08-06 — K.5: the full e2e suite has been red since 2026-08-01 and no session knew

K.1's gate ran the FULL suite for the first time since Aug 1 and it cannot go
green: **283/297 serialized**, and the identical 14 non-passes reproduce on a
stashed pre-K.1 tree — pre-existing, deterministic, not flake. Three were
transaction-status.spec's URL regexes pinning detail URLs to end at the id, broken
by O.16's `?back=` return-context param — **repaired this session**. The other ten
assert the pre-#369 dashboard: commit `2e3bf72` ("Home polish", Aug 1) removed the
recurring-total and payment-reminders cards from Home, and its session never ran
the full suite. Repair is TASKS K.5 (re-point each assertion at where #369 moved
the surface — requires reading that commit's intent, not a regex pass). Until
then, every slice's "full e2e" claim must run its targeted specs and say so.

**Process locks from the same find (docs/lessons/proof-is-the-full-output.md):** a
background verify piped to `tail` reported exit 0 — the pipe returns tail's
status, so a FAILED verify read as a pass; and two truncated failure lists were
misread as "passes in isolation", which sent the diagnosis toward "flake" until
full listings were pulled. Proof is the command's own `$?` and the complete
failure list.

## ✅ BUILT 2026-08-06 — K.3: the register's empty state names WHICH zero, from the bounds it already printed (DECISIONS #417)

**Closes TASKS K.3** — owner screenshot, same day. A custom window of Aug 6 2024 →
Aug 6 2025 on a register whose history starts Mar 25 2026 rendered, in this order:
"History available from Wed, Mar 25, 2026." · $0.00 / $0.00 / $0.00 · "0
transactions." · **"No transactions match these filters."** Every sentence true,
the screen incoherent — one line held the reason and another asserted a
different one. His reading was *"we have no trailing data in transactions"*,
which is correct about the DATA and was not derivable from this screen.

**The fix is a decision, not copy.** Pure `registerEmptyReason` returns four
kinds ('no-rows-yet' | 'filters' | 'before-history' | 'after-history'); each
window kind carries BOTH dates it compared, so the sentence states a comparison
rather than a bare bound. `getTransactions` now returns `newestDate` alongside
`oldestDate` from the same single scan, so the empty state and the filter bar's
"History available from …" are the same two values by construction. #186's
answers are preserved verbatim, including the empty-register-with-a-filter case.

**Caught in-session, before shipping, by reading rather than by a test:** the raw
`from`/`to` are `''` when unset (`str(sp.to)`) and `?to=banana` is reachable
with nothing upstream validating it, while `isoDate()` throws — so the first
wiring would have converted a cosmetic empty state into a thrown /transactions
on every unfiltered load. An unparseable bound is now treated as ABSENT and the
reader falls through to #186.

**Gate:** verify GREEN — tsc 0 / eslint 0 / **6126 unit across 371 files** /
build clean; `transactions.spec` **21/21**. Fail-old by four executed sabotages,
each restored and residue-checked: each window branch deleted turns only its own
locks RED (3, then 1), removing the total-parse guard turns the two URL-input
locks RED, and blanking the page wiring turns the e2e RED after a rebuild. No
schema change, no prisma diff.

### K.3 critic cycle 1 — FAIL, 4 P1 + 5 P2 + 2 P3; all four P1s executed

A fresh-context critic broke four things worth having found:

* **the remedy was refused for the reader it shipped to** — "Import a CSV from
  your bank" is refused for the demo user, i.e. every anonymous visitor on
  production, and the slice's own e2e drove that path; now gated, and the e2e
  asserts the sentence's ABSENCE there;
* **the zero was named below the zeros** — the owner's report named the four
  `$0.00`/count figures and the first version explained them in a box under all
  of them; the count line now carries the clause;
* **an inverted window (`from` after `to`, two clicks apart — the date inputs
  carry no min/max) was told the history bound and offered an import** that
  cannot help a window empty by construction; new `inverted-window` kind decided
  first and without consulting the data;
* **`newestDate` and the whole `after-history` branch had no lock** — the
  critic's sabotage (`>` → `<`) collapsed the two bounds and stayed green across
  6,126 tests; `register-history-bounds-server.test.ts` now turns 3 red on it.

**And it disproved a claim this slice had written down.** The docblock said a
tolerant date parse was needed because a bare cast "would throw a route that
renders fine today" — `/transactions?to=banana` was **already a 500**, because
`filterTransactions` casts the same value with an unguarded `isoDate` first. The
comment was asserting a defect did not exist. Fixed at the boundary: the page
drops an unreadable bound before building the filter, closing a live 500 on the
reported surface.

**Re-gate:** verify GREEN — tsc 0 / eslint 0 / **6137 unit across 372 files** /
build clean; `transactions.spec` **24/24**; seven executed sabotages across the
cycle, each restored and residue-checked.

### K.3 live deploy proof — PASS (7/7), www.aimplifi.app, 2026-08-06

`node scripts/k3-live-deploy-check.mjs` against production deployment
`aimplifi-ahnwykodf` (Ready, aliased to www.aimplifi.app) on `10f2dfd`. Unlike
H.5/H.7 this slice HAS a discriminator — `txn-empty-before-history` exists in no
earlier build — so this proves the new code is the code serving, not merely a 200:

```
PASS  signed into the shared demo on production — https://www.aimplifi.app
PASS  a window before the register history renders the NEW empty-state branch — status=200 History here goes back to Thu, Dec 12, 2024, and this window ends Tue, Dec 31, 2019 — so t
PASS  the empty state names the same date the filter bar prints — both say "Thu, Dec 12, 2024"
PASS  the old "matched nothing" sentence is gone from a disjoint window — absent
PASS  the unfiltered register still renders (the empty-string bound path) — status=200
PASS  a genuine no-match zero still gets the unchanged filter sentence — No transactions match these filters.
PASS  no uncaught client errors on the routes read — none

7/7 checks passed
```

The two dates agreeing on a LIVE corpus is the property, not the rendering: the
defect was two surfaces disagreeing, so "a date appeared" would not have been a
proof. Note the demo's own bound is Dec 12 2024, not the owner's Mar 25 2026 —
production runs the shared demo dataset, so this proves the mechanism, and the
owner's own screen is proved by the same code path with his own bounds.

### STILL OPEN after K.3

0. **The owner's exact pair survives one filter away (TASKS K.4).** A reader
   narrowed to a card connected last month who picks "Last year" gets a `to`
   inside the GLOBAL span, falls through to `filters`, and sees "No transactions
   match these filters" under "History available from …" — the identical broken
   pair, one dropdown later. The bounds are computed pre-filter and the printed
   line is too, so fixing it means moving BOTH to the filtered scope; narrowing
   one alone would re-create the disagreement this slice removed.
1. **It does not make the history deeper.** The owner's actual ask is three
   trailing years (TASKS K.2); the oldest row he holds is 2026-04-24 and Plaid
   cannot serve more than 730 days. This slice only stops the screen from
   misattributing that.
2. **"Your history starts …" is register-wide while a reader may be filtered to
   one account.** Inherited from the existing "History available from" line,
   which has the same scope; recorded rather than changed, because narrowing one
   without the other would make the two disagree — which is the defect this
   slice just removed.

## ✅ BUILT 2026-08-06 — H.8: every reader that describes or writes what a register shows now applies the register's own ownership rule (DECISIONS #416)

**Closes TASKS H.8** — the measurement H.7's self-correction filed: six direct
transaction readers skip `getReconciliationTxnKeep`, the R1 rule the
register/triage/budgets/export apply; which of them reaches a rendered number?

**MEASURED FIRST, on the owner's live corpus** (read-only probe
`scripts/audit-probes/h8-boundary-readers.mts`, 26 active links, 1,124 rows the
boundary does not own), and the verdicts followed the task row's own rule — only
a delta that reaches a rendered number gets a fix:

* **[1] spending-plan loan inflows — CLEAN, untouched.** The sharpest
  hypothesized reader (it runs the same ±3-day pair rule H.7 fixed) has delta 0:
  3 loan-side rows, all on the live Truist mortgage, merchant sets byte-identical
  with and without the boundary.
* **[2] household digest — n/a, untouched.** No household exists, and the code
  already excludes superseded predecessors (verified, not assumed).
* **[3] self-audit — FIXED.** /settings said "75 of 2,456 needed sorting" while
  the triage queue it audits held 7 of 1,332 — a rendered contradiction.
* **[4] keyword rules — FIXED.** The preview counted 1,124 invisible rows
  ($271,467.59) and Apply WROTE categories onto rows no register shows. One
  filter site (`matchableHistory`) covers the preview and all four writes, so
  "the number shown IS the population written" survives by construction; a
  `/rules?from=` link to a disowned row now names the reason.
* **[5] backfill — FIXED.** 68 of 75 scanned unresolved rows were invisible
  (~10× LLM fan-out), stamped `needsReview: false` so an undone combine would
  return them silently pre-filed; now they return to triage unresolved.
* **[6] learned-rule corrections — DELIBERATELY NOT FILTERED.** 146 of 827
  corrections sit on disowned rows, but a correction is the user's decision
  about a PAYEE — blinding the rule-learner to evidence is the H.7 P1-3 shape.
  Recorded, with the residual below.

**CRITIC CYCLE 1 (fresh context, isolated worktree): FAIL — 1 P1, 1 P2, 4 P3;
the P1 fixed and locked same cycle.** The critic's probe executed what the slice
declared impossible: the MERCHANT-BATCH writers were never swept. The triage
group card (keep-filtered) said "File all 2" and one tap on it filed **3** —
`fileMerchantGroup` wrote the disowned duplicate, stamped it `needsReview:
false`, and minted a Correction with no `sourceRuleId`, which reads back as a
HAND decision and feeds the deliberately-unfiltered learner with newly
GENERATED duplicate evidence (the P2: worse than pre-H.8, because the backfill
filter made the hidden population permanent fuel for exactly this). Fixed at
all four sites with the slice's own idiom — `fileMerchantGroup`,
`applyToAllSimilar`, `recategorize scope:'merchant'`, and triage's
`similarCount`, which now shares the queue's own keep fetch — the same filter
the spend-class twin of this gesture (#397) has carried since it shipped. P3s
fixed: the excludedReason sentence overclaimed for a predecessor's own
post-cutover row (now claims absence, never a counted twin); the race comment
stated only the safe direction (now states both); no fail-open lock existed
(an inert cross-type link now has a test proving all readers fall open TOGETHER
to the pre-H.8 behavior — a visible double, never a reader disagreeing with the
screen).

**Gate:** `bash scripts/verify.sh` GREEN twice (slice: **6108 unit / 370
files**; re-gate after critic fixes: see PROGRESS). **No schema change, no
prisma diff.** Fail-old proven by SEVEN executed sabotages — each keep filter
deleted in turn (self-audit, keyword-rules, backfill, fileMerchantGroup,
applyToAllSimilar, recategorize, similarCount), each turning exactly its own
lock RED, each restored, residue grep 0.

### H.8 live deploy proof — PASS (7/7), www.aimplifi.app, 2026-08-06

`node scripts/h8-live-deploy-check.mjs` against production deployment
`aimplifi-8509v4fi5` (● Ready, aliased to www.aimplifi.app) on `a207b5f`:

```
PASS  signed into the shared demo on production — https://www.aimplifi.app
PASS  settings (self-audit card) renders after the keep import — status=200
PASS  the rules builder renders after the matchableHistory change — status=200
PASS  the triage inbox renders after the similarCount/getTriageItems restructure — status=200
PASS  the register renders and reads real transaction history — History available from Thu, Dec 12, 2024.
PASS  the reports totals still render — status=200 money-rendered=true
PASS  no uncaught client errors on the routes read — none

7/7 checks passed
```

**What this proves and what it cannot.** The shared demo has no reconciliation
links, so every keep on it is the constant-true fast path and no count differs
from the old build — the discriminating behavior (a disowned duplicate excluded
from tallies, previews, and batch writes) is proven by the unit gate's 10 locks
and 7 executed sabotages, not by this script. What the script does establish is
that the deploy's real risk did not land: seven server modules now import
`getReconciliationTxnKeep` inside routes that never loaded it (/settings,
/rules, /triage and the actions behind them), and a bad import or shape
mismatch would have 500'd exactly the routes read above.

### STILL OPEN after H.8 (recorded, not fixed)

1. **The hidden unresolved population on disowned rows is permanent while a
   combine is active.** Every categorization path now correctly refuses them,
   so a disowned `needsReview: true` row stays unresolved until the combine is
   undone (when it returns to triage visibly — the designed direction). Harmless
   while invisible, but it is standing state; the repair-pass idea in H.7
   residual 1 could clear it if the owner ever asks.
2. **Corrections already minted on disowned rows (146 of 827) still feed
   learned rules un-deduplicated.** The follow-up probe to classify them
   (duplicate-copy vs sole-copy, `h8-correction-duplication.mts`, committed) was
   blocked by the session's command classifier and has not run. LEARN_THRESHOLD
   is 2, so a decision duplicated across copies can lower the effective bar to
   one real decision. Unmeasured — run the probe before deciding anything.
3. **`getTriageItems` similarCount is now a findMany per item** (the windowed
   keep cannot live in a Prisma count) — same N+1 shape as before, marginally
   heavier per query; the items view is bounded by the review queue.

## ✅ BUILT 2026-08-05 — H.7: a pair-only transfer guess may supply a verdict, never silently reverse one — and the sweep now reads what the reconciliation boundary owns (DECISIONS #415)

**Closes TASKS H.7**, the OPEN P1 the #414 critic executed and the entry below
recorded rather than patched. The defect, restated: `isTransfer` is a
categorization verdict wearing a different column — setting it withholds the row
from every income, spending, budget, report, tax-export and cash-needed total —
and only the FILE branch ever learned the #148 rule about not clobbering a
resolved decision. So a coincidental same-|amount| counterpart landing within ±3
days reversed a settled row silently: no category change, no confidence change,
no audit row, no undo.

**MEASURED LIVE FIRST, on the owner's production corpus** (read-only probes
`scripts/audit-probes/h7-{transfer-sweep-exposure,pair-evidence,guard-blast-radius,boundary-effect}.mts`,
each replaying the REAL engine over 3,065 real rows rather than a replica):

* **92** settled rows carried `isTransfer: true` under a non-transfer category,
  withholding **$21,411.05** of inflow and **$181,281.51** of outflow;
* **73** of those stood on nothing but a pair. By the evidence they actually had:
  **45** duplicate-account artifacts, **12** brokerage funding, **9** card/loan
  payments, **7** nothing but an equal amount within 3 days;
* the critic's repro was found LIVE and in both directions at once — a **$500.00**
  "CEF I CEF IV PPD" distribution settled at 9900 bps, cancelled against a
  **$500.00** Zelle payment to a landscaper two days earlier, so a real income row
  AND a real expense row both vanished from their totals.

**Two causes.** (1) ACCOUNT IDENTITY: with 26 active links the sweep saw BOTH
copies of a reconciled account and paired rows against their own duplicates,
defeating the same-account exclusion `transfers.ts` already declares. Rows now
carry their confirmed identity (`activeTerminalSuccessorMap`) and two rows on one
real account never pair. (Cycle 1 instead filtered the READ through
`getReconciliationTxnKeep`; a critic showed that blinds the WRITER to a leg its
readers still count — see CRITIC CYCLE 1 below — so the boundary moved out of the
input and into the matching rule.) (2) THE DIRECTION GATE: an outflow on a credit
line is a purchase, not money leaving for another account. That is what the
remaining false overturns had in common ($500 KALSHI, $7.00 Tesla Supercharger,
$100 AT&T bill). It applies to every write, not just the overturn, and its one
counterexample class (cash advance, balance transfer) is recorded as residual 2
rather than hidden.

**Rejected after measuring, not assumed:** an AGE gate (it would refuse exactly the
corrections a deep-history backfill exists to make) and a CONFIDENCE gate (measured
useless — the genuine fundings and the false coincidences both sit at 9000-9900 bps).

**Gate:** `bash scripts/verify.sh` **GREEN** — tsc 0 / eslint 0 / **6090 unit
across 369 files** / build clean. **No schema change, no prisma diff, no UI
surface.** Fail-old proven by three executed sabotages, each restored and
residue-checked: removing the overturn gate fails 6 of the 7 new pure locks;
removing the boundary filter fails the duplicate-pair lock; removing the flag
write's premise re-assertion fails the read→write race lock.

### H.7 live deploy proof — PASS (6/6), www.aimplifi.app, 2026-08-05

`node scripts/h7-live-deploy-check.mjs` against production deployment
`aimplifi-9py4gtpn2` (Ready, aliased to www.aimplifi.app) on `52de853`, and
**re-run 6/6 on `23f343b`** after critic cycle 2 against deployment
`aimplifi-noi473ykv` (Ready, same alias):

```
PASS  signed into the shared demo on production — https://www.aimplifi.app
PASS  the accounts page renders after the reconciliation-identity import — status=200
PASS  the register renders and reads real transaction history — History available from Thu, Dec 12, 2024.
PASS  the income/spending totals that a wrong transfer flag would move still render — status=200 money-rendered=true
PASS  the dashboard still renders after the sync-path return-shape change — status=200
PASS  no uncaught client errors on the routes read — none

6/6 checks passed
```

**What this proves and what it cannot.** H.7 is entirely a server path that runs
only inside a provider sync, and the shared demo is fenced from provider egress
by construction (#242 F1) — so production cannot be made to run the sweep, and
there is no schema change to observe either. What it does establish is that the
real risk of this deploy did not land: `transfer-refresh` now imports
`activeTerminalSuccessorMap` from the reconciliation server module and both
providers read a third field off its return value, so a bad import or a shape
mismatch would have taken down exactly the routes checked above — including
/reports, whose income and spending totals are the figures a wrong transfer flag
moves. That a coincidence no longer reverses a settled verdict is proven by the
unit gate with five executed sabotages, not by this script.

### CRITIC CYCLE 1 (2026-08-05) — two fresh-context critics in isolated worktrees, both FAIL: 1 P0, 5 P1, 4 P2, 1 P3. All fixed and locked; the mechanism changed twice.

**P0-1 — the gate never fired on the shape a row actually arrives in.** Every
synced row is BORN `needsReview`, so gating only the SETTLED case left the
coincidence winning on the very first sweep — and worse than before, because
`fileIds` (untouched by cycle 1) also stamps `categoryId: 'transfer'` and clears
`needsReview`, removing the row from triage entirely. The critic executed the
slice's own live repro end to end: the $500.00 CEF distribution left every income
total AND never reached the queue. Fixed by making the evidence bar ONE bar over
every write, not just the overturn. **A second defect surfaced while fixing it,
mine:** gating only `fileIds` and still flagging would have recreated the
pre-#165 WEDGE, since a flagged `needsReview` row is hidden from triage by its own
transfer guard while being excluded from every total. So an unevidenced pair now
gets no action at all — the row stays visible and countable exactly as it is.

**P1-2 — the direction gate manufactured false negatives.** A $20,000 HELOC draw
the owner had filed as Income stayed Income: in the income bars, the FI savings
rate, and the **tax export**. My comment had claimed refusing to overturn is
"always the safe direction"; it is not, when the recorded verdict is itself wrong.
`LOAN` and `MORTGAGE` now sit inside `CAN_SEND_ACCOUNT_TYPES` — a draw on a line
of credit IS money moving between the owner's accounts, and those account types
carry no merchant purchases to confuse it with. Only `CREDIT` stays withheld.

**P1-3 — the sharpest: filtering the sweep's READ made the WRITER blind to a leg
its readers still count.** `getReconciliationTxnKeep` disowns a successor row
dated inside the predecessor's claim; when that row is the only copy of a
transfer's paying leg, the sweep could no longer see it, while the counterpart on
an unlinked card was counted by everyone. Executed: a $123.45 card payment read as
negative spending, taking a month's expenses from $200.00 to $76.55. **The
mechanism is therefore replaced, not patched:** each row now carries its confirmed
account IDENTITY (`activeTerminalSuccessorMap`) and the pair rule refuses two rows
on the same real account. Same protection, no blindness — a writer that guards a
flag must see at least everything its readers see.

**P1 (2nd critic) — "a row can only become MORE settled inside the window" was
false.** `undoCorrections` returns a row to 'uncategorized' + `needsReview`, and
flagging it then mints the hidden `needsReview + isTransfer` wedge — turning the
user's request to re-review into a silent transfer filing. The overturn write now
re-asserts its premise, like the flag write beside it.

**P2s fixed:** the write's `['transfer','uncategorized']` was hand-mirrored from
the engine and drifted freely (deleting `'uncategorized'` from the copy passed
every test) — one exported constant now feeds both; the doubled pair+normalizer
walk (measured +86% on 3,065 rows, inside every sync) is one walk; and the
overstated "only read surface" claim is corrected in place, with the counterexample
the critic found — `spending-plan.ts:198` reads LOAN/MORTGAGE inflows unboundaried
and feeds them to `loanPaymentMerchantCanonicals`, which runs the SAME ±3-day
pair rule — filed as **TASKS H.8**. **P3 fixed:** an overturn is now returned
separately (`{flagged, overturned, filed}`) and counts toward `derivedChanged` in
both providers, because reversing a verdict the owner recorded is the one of the
three worth telling them about.

**Re-measured with the SHIPPED cycle-2 code against the live corpus**
(`h7-shipped-plan.mts`): all 3,065 rows read (identity replaces the filtered
read), 26 reconciled accounts; a from-scratch replay justifies **114** flags and
**39** overturns — the Capital One and Chase autopays, the brokerage fundings,
three Truist mortgage payments, the "Overdraft Transfer from Brokerage" moves —
against **two** residual false ones (the $0.07 "Interest Paid" rows, now visible
on both copies). **Re-gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 /
**6096 unit across 369 files** / build clean. Fail-old re-proven on five
sabotages, each RED and each restored with a residue check: identity, the
evidence bar, the LOAN/MORTGAGE vocabulary, and both write-premise
re-assertions.

### CRITIC CYCLE 2 (2026-08-05) — one fresh-context critic, FAIL: 2 P1, 3 P2, 3 P3. Both P1s fixed and locked; 27 sabotages run against the shipped code, 23 already RED.

**P1-1 — the identity map inherited the money boundary's fail-OPEN default.**
`activeTerminalSuccessorMap` keys off `effectiveReconciliationLinks`, whose
documented doctrine is that an ambiguous link shape falls back to "both sides
count fully" — right for a READER, where the failure is a visible double the
duplicate disclosure already covers, and wrong for this WRITER, where an inert
link means the two copies of one real account pair with each other again and REAL
money leaves every total. The critic executed four inert shapes (cross-type,
non-monotone, cycle, currency drift) and got the eBay purchase/refund artifact
back every time. **It is reachable without crafted data:** both providers rewrite
`Account.type` and `currency` unconditionally on every sync, so a feed
reclassifying checking → money market makes a confirmed link cross-type and
inert. Fixed with a sibling primitive, `accountIdentityMap` /
`activeAccountIdentityMap`, which reads EVERY `undoneAt: null` link with only the
cycle guard `chainMaps` already carries — because a confirmed link is the user's
statement about identity, and that does not stop being true when a feed renames a
type. **Measured live: 26 identity entries against 26 on the money basis — no
inert links today**, so this is protection against drift rather than a repair of
something already broken.

**P1-2 — the evidence bar was per-ROW, so a pair could be half-actioned.**
Descriptor evidence lands on the leg whose own name matched, so a pair the sender
rule refuses could still have ONE leg written. Executed: a $5,000.00 cash advance
out of a card, arriving as "ONLINE TRANSFER FROM VISA 4001" — the inflow was
descriptor-known and left income, the CREDIT outflow stayed in spending, and the
pair stopped netting. Before H.7 both legs were flagged and the net was $0.00; the
first cut of this slice **minted a $5,000 expense that had not previously
existed**, in every budget, report and spending-plan figure. It also falsified my
own comment that "an unevidenced pair gets NO action". Fixed: if either leg of a
matched pair is descriptor-known, both legs are. This cannot re-open the case the
slice was built for — in the KALSHI/CEF coincidence neither leg is
descriptor-known — and it is locked in both directions.

**P2s fixed:** `'INVESTMENT'` in the sender set was completely unlocked (deleting
it left 115 tests green, because the "brokerage funding" fixture puts the
investment account on the INFLOW side) — the mirror case is now a test, since a
$78,000 brokerage WITHDRAWAL filed as Income is the same shape as the HELOC draw
cycle 1 fixed; and two of the file write's four re-assertions (`status: 'POSTED'`
and the currency OR) were deletable with the suite green, now executed through the
existing mid-window seam.

**What the critic could NOT break, which is evidence too:** three-account chains
and two-predecessors-one-successor both collapse to a single identity; three
consecutive sweeps produce `[{2,0,2}, {0,0,0}, {0,0,0}]` — no oscillation and no
growing state, because filing stamps `categoryId: 'transfer'` which
`NON_COMPETING_CATEGORY_IDS` absorbs; `fileIds ∩ overturnIds = ∅` is proven from
the predicates rather than observed; 2,600 pair rows sweep in 199 ms with an
unchunked `updateMany` and no parameter-limit failure; the shared constant genuinely
cannot drift; identity really does subsume the original same-account check (one
sabotage reddens both the duplicate-account AND the plain refund test); and the
sweep's only narrowing versus its readers is `isSplitParent`, which every total
excludes anyway — so "a writer must see everything its readers see" holds.

**Re-gate:** `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **6103 unit
across 369 files** / build clean. Six new sabotages, all RED, restored in a
`finally` after the cycle-1 harness crashed mid-run and left one applied.

### STILL OPEN after H.7 (recorded, not fixed — ranked by money consequence)

> **2026-08-08: residual 1 is CLOSED and residual 4 partially closed by H.7b**
> (DECISIONS #428, the entry near the top of this file) — the owner-triggered,
> undoable repair this residual prescribed now exists on /settings. Residuals
> 2, 3, 5 and 6 stand; H.7b adds its own residual list (§STILL OPEN after H.7b).

1. ~~**The 53 flags already written are NOT repaired — the one that still affects
   what the owner sees today.**~~ **CLOSED by H.7b (2026-08-08).** Flags are add-only by construction. Re-measured
   with the shipped rule: of the rows flagged on his corpus, it declines **53**
   (**$29,848.84**, 4 of them income-categorised) and endorses the rest. Those 53
   are still withheld from his income and spending totals right now.
   **Deliberately not automated**, for the reason the app applies everywhere else
   (#192/#221/#299 — disclose, never silently adjust): clearing a flag is itself a
   silent rewrite in the opposite direction on figures he has already looked at,
   and where a flag happens to be RIGHT, clearing it would double-count a real
   transfer. The shape this should take is the existing repair-route idiom
   (`/api/repair/plaid-provider-categories` is the precedent): an explicit,
   owner-triggered pass that states what it will change before it changes it, and
   is undoable. **Owner decision needed** — nobody else can authorise rewriting
   money figures he has already seen.
2. **A CREDIT-sourced transfer is refused.** A cash advance or a balance transfer
   genuinely sends from a card, and `CAN_SEND_ACCOUNT_TYPES` withholds `CREDIT`
   because a card outflow is overwhelmingly a purchase and type alone cannot tell
   them apart. Consequence: such a row settled under a substantive category keeps
   that category (a cash advance filed as Income stays Income). Narrower than the
   cycle-1 version, which refused LOAN and MORTGAGE too, but real — and it needs a
   measurement on a corpus that actually contains one before a rule is invented.
   **Measured on his corpus** (`h7-sender-types.mts`): the only non-sender type
   carrying outflows at all is CREDIT, with 2,508 of them — card purchases, which
   is exactly what the gate is for; REAL_ESTATE has no transactions, and LOAN and
   MORTGAGE have **zero** outflows today, so adding them to the sender set is
   precautionary against the HELOC-draw class a critic executed, not a change
   anything on this corpus needed.
3. **Two $0.07 false overturns survive.** An "Interest Paid" inflow matched to a
   $0.07 Vanguard money-market row on each copy. Closing it means inventing an
   amount floor with a magic number, which the evidence does not support.
4. **Nothing in the app can ever clear `isTransfer`.** `grep -rn "isTransfer: false" src/`
   finds only read filters and derived-view spreads — no write path. A filed
   transfer whose counterpart is later deleted by the feed stays out of every
   total permanently, and recategorising it does not bring it back (cycle-2 P2-5,
   executed). This predates H.7 (#165) and is the same family as residual 1, which
   is why the repair pass should clear flags rather than only re-run the rule.
5. **Three P3s recorded, not fixed** (cycle 2): `flagIds`/`overturnIds`
   disjointness is per-row rather than per-id, so a caller passing the exported
   pure function two rows with the SAME id gets it in both lists (unreachable
   through Prisma, whose ids are unique); the returned counts sum per-write, so a
   2-row pair reports `flagged: 2, filed: 2` and any future "N transfers found"
   copy would say 4; and an unknown or lowercase `accountType` fails silently
   closed (latent — both providers map to the same six types and Plaid's mapper
   throws on anything else).
6. **Critic cycles run: 2 of the 4-cycle cap.** Cycle 2's two P1s are fixed and
   locked but have not themselves been adversarially reviewed.

## ✅ BUILT 2026-08-05 — the Plaid deep-history backfill mirror: superseded predecessors refused, runs capped+chunked, every server-performed un-supersede re-arms (DECISIONS #414)

**Closes the H.5 OPEN P1 "the PLAID backfill has the same superseded-predecessor
defect this slice rated P0" (the entry below).** `backfillItemHistory` (shipped
2026-08-04 in `18b6ad6`) mapped every plaid account with no supersession filter,
ran the LLM assist over the WHOLE plan before any commit, trusted a truncated
fetch as done, aborted the entire run on one malformed row, and could never be
re-armed after an undo. All five now mirror the critic-tested SimpleFIN H.5
shape: `activeSupersededPredecessorIds` filters the account map (a filtered row
lands in the planner's `unmappedAccount` skip — counted, never written);
oldest-first, capped 2000/run, committed per 250-row chunk with the assist per
chunk; `fetchComplete` gates every markDone; malformed rows skip without
charging the cap; and `undoReconciliationFor` clears `PlaidItem.historyBackfilledAt`.

**MEASURED LIVE BEFORE BUILDING** (read-only probe,
`scripts/audit-probes/plaid-backfill-exposure.mts`, executed this session): **no
harm occurred** — all 12 of the owner's items backfilled 2026-08-04 20:27 UTC
with `added: 0` on every item (everything fetched was `alreadyExists`), and the
only plaid→plaid reconciliation's predecessor belongs to a DISCONNECTED item no
live fetch can map. The defect was dormant; this slice is prevention. Two more
live facts fell out: **(1) H.6's gate is answered** — `added≈0` everywhere means
Plaid holds nothing older than the ~90-day init window for these pre-730d items,
so deeper Plaid history is reachable only through a fresh Link (H.6) or CSV
(H.2); **(2) the owner's SimpleFinConnection row NO LONGER EXISTS** (simplefin
history frozen at 2026-07-21; his simplefin accounts live on as the 24 superseded
predecessors of his Plaid successors) — so H.5's backfill runs only if he
reconnects SimpleFIN.

**Two fresh-context critics in isolated worktrees, cycle 1: both FAIL — 0 P0,
4 P1, 6 P2 combined.** Critic B's three P1s all fixed + sabotage-locked same
cycle: **(1) the direction-conflict auto-undo un-superseded without re-arming**
(executed: fixing a wrong-direction reconcile through the real
`confirmReconciliationFor` left the flag set and the skipped years permanently
unreachable) — `rearmHistoryBackfills` is now the ONE author for both
server-performed un-supersede events, called after the SERIALIZABLE transaction
commits; **(2) the oldest-first lock was fixture-weak** — DELETING the sort
passed, because the fixture arrived pre-sorted; the over-cap fixture is now
served newest-first (the order a real feed uses); **(3) nothing locked the
one-time guard** — removing `if (!item.historyBackfilledAt)` passed 81 tests
while re-fetching 730 days on every sync; a second-sync assertion now proves
zero `/transactions/get` calls. Critic B's P2 (the race-loser catch was
exercised by nothing) also locked with a P2002 injection. Critic A confirmed the
headline claims under sabotage (superseded filter out → 2 red; truncation
trusted → 1 red) and stored-row byte-identity; its one P1 is recorded OPEN below
(the transfer sweep), its TOCTOU/counter/pagination P2s are recorded in
DECISIONS #414.

**OPEN P1 (recorded, NOT fixed here — needs its own measured slice): the
transfer sweep pair-flips `isTransfer` on SETTLED rows, both providers, and the
backfills enlarge its input.** Executed by critic A: a settled +$1,000 income
row on another account flipped to `isTransfer: true` — leaving every income
total, silently, `needsReview: false` — when a backfilled two-year-old row
supplied a coincidental ±3-day same-|amount| counterpart in the same sync
(`planTransferUpdates`'s flag branch has no settled-row guard,
`transfers.ts:106`). The critic's sharpest fact: **H.5's "dropped the refresh on
the backfill" was only a ONE-SYNC deferral** — the next cron sync's sweep
performs the identical rewrite over SimpleFIN-backfilled rows, so this is a
standing defect of the shared sweep, not a property of either backfill. It is
also not uniformly harm: a backfill-revealed GENUINE counterpart flipping an old
"expense" to a transfer CORRECTS double-counted flows — which is why the fix is
a semantics decision on `planTransferUpdates` (when may a pair-only detection
rewrite a settled row?), measured on the owner's corpus, with its own critic —
filed as **TASKS H.7**, not patched here.

**Gate:** `bash scripts/verify.sh` → VERIFY GREEN twice (cycle 1: **6076
unit / 368 files**, tsc 0, eslint 0, build clean; cycle 2 re-gate after the
fixes: see PROGRESS). 9 server tests, every behavioral claim sabotage-proven in
both directions (10 sabotages executed across the two cycles, all caught by the
final suite; sabotage residue grep = 0 — the `d38086e` check). **No schema
change; no prisma diff; no UI surface** (the deploy proof is sha-match, the C.9
precedent).

## ✅ BUILT 2026-08-05 — H.5: the deep-history backfill for existing SimpleFIN connections (DECISIONS #413)

**The premise was measured before anything was built, and it held.** The owner's
*"i see a max date of march this year"* is not a bank limit: `SIMPLEFIN_INITIAL_LOOKBACK_DAYS`
(1095) is applied only to a connection's first-ever pull or an account first seen
mid-sync, and every other sync starts at `lastSyncedAt - 5d`. A connection whose
first pull ran under the old 90-day default keeps that floor for life, so widening
the constant on 2026-08-04 reached no connection that already existed. The
`opts.fullLookbackDays` escape hatch built for exactly this had **zero callers**.

**Built as an add-only path rather than by calling that parameter.** A 1095-day pull
through the live ingest answers every already-stored row with `guardedVerdictRefresh`,
which rewrites categoryId/needsReview/isTransfer on any row without an explicit
Correction — a refresh over 5 days, a silent re-filing of three years of history
against today's rules over 1095. A pure planner emits only genuinely-new rows and the
writer only ever `create`s.

**Two fresh-context critics: FAIL — 1 P0 + 11 P1, all executed.** The P0 and the
headline P1 were the same shape, and it is now a lesson
(`docs/lessons/add-only-bounds-what-you-write-not-what-it-means.md`): *add-only bounds
what you WRITE, not what your write MEANS downstream.* P0 — writing into a SUPERSEDED
PREDECESSOR drags its full-history `span.first`, which is a reconciliation claim edge,
back three years and thereby DELETES three years of the successor's corrected rows
from every figure, without updating one row. P1 — `refreshTransferFlags`, inherited
from the live sync, rewrites `isTransfer` on already-settled rows whenever a new row
supplies a counterpart; dropped here, kept on the ordinary sync. Also fixed: an empty
plan marking done on an untrustworthy response (now `inconclusive`; `data.errors` is
read at last); the connect-time flag, which re-created the reported defect and made it
unreachable (removed; a reconnect now clears it); an unbounded LLM fan-out over the
whole plan before any commit, so a timeout committed nothing and repeated forever (now
chunked 250 / capped 2000 per run, oldest-first, `markDone` only when the plan is
consumed); and `rateLimitDurable` on `syncSimplefinNow`.

**Critic cycle 2: FAIL — 1 P0 + 3 P1, all executed, and the P0 was cycle 1's own
fix.** Cycle 1 made a reconnect clear the backfill flag; the line above it had been
setting `lastSyncedAt: null` since long before this slice. Together, a reconnect took
the full-pull branch through the LIVE ingest and then fetched three years a second
time — a probe measured a stored 2024 row moving Groceries → Coffee, silently, no
audit row. `Disconnect` keeps the history and the UI hints at "reconnect", so this is
a shipped route. Reconnect no longer nulls `lastSyncedAt`. Also fixed: unpreparable
rows were charged to the per-run cap though they can never be stored (one bad-format
bridge could pin the cap forever and never converge); a superseded-only connection
marked itself permanently done though supersession is reversible; and the oldest-first
ordering the cap's safety argument rests on was asserted by nothing — a newest-first
sort left the suite green while the owner's March floor survived every run. Plus a
planner skip for undatable rows, which the TODAY date-fallback would otherwise mint
into the current month.

**Critic cycle 3: FAIL — 1 P0 + 3 P1, and the P0 was cycle 2's fix, again.** Cycle
2's comment named `disconnect → connect` as the route it was closing and then closed
the upsert's `update:` branch — but `disconnectSimplefin` DELETES the connection row,
so that route takes `create:`, where a null `lastSyncedAt` still meant a 1095-day pull
through the live ingest over the rows the disconnect deliberately KEPT. Measured
again: Groceries → Coffee. A connection created for a user who still holds SimpleFIN
history now gets today's date, so the sync goes incremental and the add-only backfill
supplies the depth; nothing is lost to the narrower window, because anything in the
gap is unstored and the backfill adds it. Cycle 2's superseded-retry was wrong the
other way — a permanent LOOP (1095-day fetch + full providerRef scan + audit row on
every sync, forever). Reversibility is now an EVENT: `undoReconciliationFor` clears
`historyBackfilledAt`, which is what makes marking that state done safe. Two tests
carrying cycle-2 finding numbers were proven no-ops by sabotage and rewritten to cross
the limits they name.

**Scale gate executed** (the task row's explicit pre-ship condition),
`tests/unit/simplefin-history-backfill-scale.test.ts` behind `H5_SCALE_PROBE=1`:
3000 rows over ~1090 days converge in **2 capped runs at 1.55 ms/row**; a forced full
re-plan against an entirely-stored history adds **0 rows, 0 duplicates, 0 drifted
columns**.

**Schema:** `SimpleFinConnection.historyBackfilledAt String?` — additive and nullable,
verified to survive `scripts/gen-pg-schema.mjs` into the Postgres schema `prisma db
push` applies on deploy. Existing rows get NULL, which is the intended semantics: every
existing connection is owed a backfill.

**No surface was built, deliberately.** `transaction-filters.tsx` already prints
"History available from <date>" derived from the OLDEST ACTUAL TRANSACTION rather than
from a promised window, so it states what the institution actually returned and moves
back on its own once the backfill lands. A critic flagged this as missing; it was
verified present instead of rebuilt.

**Critic cycle 4: FAIL — 1 P0 + 3 P1. THE HARD CAP IS REACHED (CLAUDE.md §6), so
these are recorded open rather than fixed, and the owner is asked for direction.**

*Cycle 4's P0-1 ("the unit suite does not pass") did NOT reproduce and is recorded
as a measurement artifact.* It reported five red full-suite runs; three consecutive
runs afterwards, with no other agent running, were **6069 passed / 0 failed**, and
`bash scripts/verify.sh` is GREEN. The confound: the unit test DB filename hashes
`process.cwd()` (`tests/setup/test-db.ts:48`), so the critic's control — run in a
separate git worktree — had a private database, while its treatment runs shared one
SQLite file with this session's concurrent runs. The `database is locked` errors it
saw are that contention. The mechanism it named is real in kind (the backfill does
add per-sync work, and fires for every fixture whose flag starts null), so it is worth
re-checking if suite flakiness reappears — but the attribution was not sound.

**MY OWN INCIDENT, recorded because it nearly shipped:** commit `d38086e` captured a
sabotage line the critic had left in the tree mid-probe — `if (false && !conn.historyBackfilledAt)`,
i.e. the whole feature disabled — because the commit was made while a critic was
actively mutating the same working tree. It was caught by the critic's own report,
amended to `16759d1` before any push, and the residue was verified to be exactly one
line. **The rule this earns: never `git add -A` while a subagent is working in the
same checkout** — give critics a worktree, or commit only explicit paths after the
agent reports. This is the third instance of `a-subagents-green-is-a-hypothesis`.

**OPEN P1 — was "three ways an account stops being superseded do NOT re-arm the
backfill"; the first is CLOSED 2026-08-05 (#414), two remain, now for BOTH
providers.** `confirmReconciliationFor`'s direction-conflict auto-undo now calls
the same `rearmHistoryBackfills` the explicit undo uses (executed lock in
`tests/unit/plaid-history-backfill-server.test.ts`). Still open: deleting the
successor account drops the link via `effectiveReconciliationLinks` with no FK
and no flag clear; and the successor's `type`/`currency` — which the feed sync
overwrites on every run — can drift the link out of effectiveness with no user
action at all. Each leaves a connection/item permanently unable to widen its
history. The by-construction fix remains deriving "is a backfill owed" from
state (the `learn.ts` recompute-from-scratch idiom) — a design change, not a
patch, and it now owes coverage of `PlaidItem.historyBackfilledAt` too.

**OPEN P1 — reconnect-after-disconnect can lose a pending row older than 5 days.**
`connectSimplefin` now sets `lastSyncedAt: today` when history is retained (that is
what stops the live ingest re-filing it), the planner skips every `pending` row, and
`markDone` fires once the plan is consumed. So a hold outstanding when the user
disconnected, older than the 5-day overlap, is refused by the backfill and falls
outside every later live window. Before this slice that reconnect did a 1095-day LIVE
pull, which would have ingested it — so this trades a re-categorisation bug for a
narrower data-absence bug. Depends on SimpleFIN's `start-date` filtering on posted
time, which is the documented protocol semantics but was not observed against a live
bridge.

**CLOSED 2026-08-05 (#414) — the PLAID deep-history backfill's
superseded-predecessor defect.** Was: `plaidAccountIdMap` mapped every
`provider: 'plaid'` account with no supersession filter, and
`undoReconciliationFor` did not clear `plaidItem.historyBackfilledAt`. Fixed,
critic-cycled and live-measured (no harm had occurred — every item's backfill
added 0 rows). See the #414 entry at the top of this file.

**OPEN P2s from cycle 4:** the effective-date sort and the new rate limit are both
correct but unlocked by any test; `syncAllAccounts` double-charges the limiter
(`sync-all:` then `sync-simplefin:`); `undoReconciliationFor` re-arms unconditionally,
so undoing a Plaid/manual pair still costs the next sync a three-year fetch;
`reportedAny` is any-not-all, so one account reporting marks the whole connection done;
and `connectSimplefin` has no rate limit at all.

**OPEN — a CSV-imported or hand-typed row carries no `providerRef`, so the backfill
cannot see it as a duplicate.** `@@unique([accountId, providerRef])` protects only
feed-owned rows, and `existingRefs` filters `providerRef: { not: null }`. A user who
filled the pre-March gap by hand — which the app's own `/transactions/import` page
invites — will get those charges duplicated when the feed's copies arrive. Additive and
visible in the register rather than a wrong stored verdict, but it inflates spend. A
real fix needs amount+date+account fuzzy matching, which is its own slice with its own
critic (the C.6 lesson: a loose pair rule credited 11 refunds as payments). **Filed, not
built.**

**OPEN — the per-chunk commit is reasoned, not asserted.** `BACKFILL_CHUNK_ROWS`
exists so an uncatchable serverless timeout leaves committed work behind, and a
critic confirmed by sabotage that deleting the chunk flush leaves the suite green.
Locking it needs a test that throws from `transaction.create` partway through a plan
and asserts the earlier chunks survived. **Filed, not built.**

**OPEN — a providerRef stored on a superseded PREDECESSOR suppresses the row on the
successor.** `existingRefs` is scoped by provider, not by account, so a charge already
held on a read-only predecessor is treated as present and never added to the live
successor. Conservative and consistent with add-only, but it is a history hole of
exactly the kind this slice exists to close. **Filed, not built.**

**OPEN — backfilled rows land in an unbounded triage inbox.** `getTriageItems` has no
date floor, no `take` and no pagination, so a three-year backfill can move the review
queue from ~17 items to hundreds of two-year-old rows in one page load. The per-run cap
staggers the inflow but does not bound the queue. **Filed, not built.**

**OPEN — reconnect still takes its full pull through the LIVE ingest.** `connectSimplefin`
sets `lastSyncedAt: null`, so the next `runSimplefinSync` is a 1095-day pass in which
every already-stored row hits `guardedVerdictRefresh` — precisely the harm this slice
routes around everywhere else. Pre-existing, not introduced here, and out of this
slice's scope; recorded so it is not mistaken for covered.

**UNVERIFIED — no `maxDuration` is raised on the server-action path.** The three routes
that set it are crons and a repair route. A large first backfill on Neon is O(N)
sequential round-trips; the per-run cap bounds it, but the platform default for this
project has not been read off the Vercel dashboard and is not asserted here.

## ✅ BUILT 2026-08-05 — C.19/H.3: the Fixed list accounts for its own total, and the mortgage is a line in it (DECISIONS #411)

**The C.19 task row was stale.** It was written 2026-08-02 asking for
per-transaction spend class, a recurrence-first default and row-derived Fixed
sums; #397 shipped all three on 2026-08-03. Measured before building, so none of
it was rewritten.

**What was actually broken is the owner's actual word: LIST.** He has asked
"where is mortgage?" four times. C.24 put it in the Fixed FIGURE at $6,217.07/mo;
it was in no list, because the union returned a bare number while C.24's
exactness invariant removed the merchant's rows from the category rollup — the
only half that produces lines. `loan-payment-fixed-union.test.ts:206` asserts the
resulting empty rollup as correct, so no test could see the hole.

Now: `recurringOutsideFixedCategoryRows` / `recurringPlanExpenseRows` emit the
rows they sum and the `...Cents` functions are implemented in terms of them;
`buildFixedList` assembles both halves and refuses to certify when they cannot
meet; `/spending-plan` renders it and computes nothing. **No figure moves —
`suggestedFixedCents` is byte-identical. No schema change.**

**Copy critic (fresh context): FAIL — 4 P1 + 2 P2, all executed, all fixed.** All
four shared one shape: a sentence written against one basis printed above rows
produced by another. The general intro sentence was DELETED rather than narrowed
(it was false for any bill deduped into a rollup category, and for a
mid-window-started quarterly premium whose category line prints its whole
charge); each line now carries its own basis, reusing `fixedAmountBasisClause`
and `LONG_CADENCE_WORDS` rather than paraphrasing them.

**Money critic (fresh context): FAIL — 2 P1 + 4 P2, all executed, all fixed.**
The arithmetic attacks came back clean (row-sum parity across every cadence and
skip set, every override refusing, the demo list reconciling to the penny by
hand). What it found: "matched to the penny" is a claim about a SUM printed as
if it were a claim about the COMPOSITION. P1-1: canonical drift can leave the
same bill as its own line AND inside a category line with the sum still
balancing — the certification now also refuses when a bill is filed to a
category that has its own line (free on the intended C.24 path). P1-2: a reader
who typed their figure was told it "came from the spending pattern" (the empty
branch's second ladder dropped the user-set disclosure) — the ladder is now
reused. P2-1: a zero median printed "$300.00" twice under a sentence about a
nonexistent gap — both now gated on a non-zero remainder. P2-2:
`unionedLoanMerchants` was derived before the union's skips, so a skipped series
still lost its rows — now derived from what was actually kept. P2-3/P2-4
(singular note; duplicate labels) fixed or recorded as not-live residual.

**OPEN — the reserve/sinking-fund third source is NOT in this slice.** The
owner's "money set aside every month for home repair" and "yearly dues ÷ 12" have
no model in the app; that is C.23/H.4, still gated. This slice makes the existing
Fixed figure sayable, which is the half of H.3 about the mortgage.

**OPEN — the /budgets Fixed panel is a different question and stays separate.**
That panel lists this month's fixed-CLASSIFIED spend by category; this one lists
what composes the PLAN's monthly Fixed figure. Two lists, two questions, both
labelled. Deliberate, recorded so it is not "unified" later by mistake.

## ✅ BUILT 2026-08-04 — C.13 P1-27: the Fixed/Discretionary heading and its register read one row set (DECISIONS #409)

The audit's stated cause was already dead — #397 admits PENDING into
`classifySpendClass`, so the $49.93 it cited is gone, verified before anything was
touched. The parity claim survived through a mechanism the audit did not name: the
register applies the shared R1 reconciliation keep before it stamps `spendClass`,
`/budgets` applied that keep to `spendRows` and handed the Fixed/Discretionary panel
the raw month query. `summarizeSpendClassCategories` now takes `keepsReconciled` as a
REQUIRED parameter. Critic P1 (fresh context, executed): with the panel now provably
equal to the register, /budgets prints one category twice — C.25 excludes a loan
payment from By-category so THAT figure matches its link, the split keeps it so ITS
link matches — with the explaining sentence under the lower card only.
`spendClassLoanPaymentNote` now states the direction beside both.

Gate: `bash scripts/verify.sh` GREEN — tsc 0, eslint 0, **5952 unit / 361 files**,
build clean. Targeted e2e 10/10 serially (spend-class, spend-class-drilldown,
budgets-basis, budget-targets, category-drilldown).

**OPEN — `/budgets/page.tsx` has no test of its own.** The new required parameter is
load-bearing by TYPE only: an edit could satisfy it with `() => true` and no test in
the repo would fail (the critic verified this by grep). The real lock is a
server-level test over a seeded reconciled pair comparing `getTransactions().summary`
against the page's panel total. Filed, not built.

**CLOSED 2026-08-05 — C.26 built (DECISIONS #410).** See the entry below.

## ✅ BUILT 2026-08-05 — C.26 (P1-28): one window for "spent this month", and the register link is built from it (DECISIONS #410)

`computePace` stopped at today and `spendingByCategory` did not, so the
dashboard's top-spending card and the pace card an inch away answered "this
month" over two windows; Ask carried the same split (`merchant_spend` has
clamped since O.7, the three category intents had not). The window is now a
value a figure CARRIES — `SpendWindow` — with one translation to register dates,
so a figure and its link cannot be windowed by two authors. /budgets keeps the
whole month deliberately (an allowance a later-dated charge has already
consumed; clamping would raise "left to spend"), and each page equals its OWN
register.

**Critic cycle 1: FAIL, 6 P1s, all executed, all fixed.** The /reports view
could still reintroduce the measured $120→$520 defect with the suite green, so
the href is now built by `getReports` (the view names no window); the new
disclosure was asserted nowhere, so basis composition moved out of the .tsx into
the engine; the CHART panel had the clamp without its disclosure and printed two
false sentences (it blamed the reader's refunds for money the date rule removed,
and said "No posted spending in June 2026" over $400.00 of posted June
spending); a category the clamp emptied disclosed nothing anywhere; and Ask's
basis line read as the complete rule while omitting the newest exclusion.

Cycles 2 and 3 each found a defect introduced by the previous cycle's FIX (a
page figure subtracted from two independently-floored sums, which cancelled to
silence; then a window label narrowed twice — "Jun 2026 so far so far"). Cycle 4
signed off: zero P0, zero P1.

Gate: `bash scripts/verify.sh` GREEN — tsc 0, eslint 0, **5989 unit / 363
files**, build clean. Targeted e2e 13/13 (reports-total-reconciles,
category-breakdown, category-drilldown, dashboard, budgets-basis).

**Deploy-verified 2026-08-05:** `01ab3ab` (no `prisma/` diff — the live database
is untouched); production deployment `aimplifi-g76kkcs0r` ● Ready;
`node scripts/c26-live-deploy-check.mjs` → **DEPLOY PROOF: PASS (7/7)**. The
discriminating check is the link's own window: production now emits
`/transactions?category=groceries&from=2026-06-01&to=2026-06-10` — today, where
the previous build emitted the month end — and the register it opens nets to
exactly the figure that was clicked (25282 vs 25282).

**CLOSED — components can now be asserted.** The "no component-rendering
harness" gap that had let two cycles of user-visible copy ship unlocked is gone:
`@testing-library/react` + `jsdom`, `.tsx` in the vitest include, opted into per
file with a `// @vitest-environment jsdom` pragma. `tests/unit/spend-window-render.test.tsx`
renders `ReportsView`, `TopSpendingCard`, `CategoryBreakdownPanel` and
`MonthFlowPanel`. Available to every future slice.

**OPEN — one seam the harness cannot reach: an async server component's prop
wiring.** Mutation-proven: passing `notCountedYetCents={0}` in
`dashboard/page.tsx` restores the disclosure defect with the whole suite green.
Not a live defect — the prop is REQUIRED so an omission fails `tsc`, the
component itself is locked, and the value has one plausible source — but it is
the last unlocked link in this chain. Only an e2e on /dashboard with a seeded
future-dated row closes it.

## ✅ BUILT 2026-08-04 — C.12: an instruction and the figure it qualifies now come from the same selection (audit P1-16/17/18/20, DECISIONS #408)

Four instruction/figure drifts, one root. (a) The cash-needed shortfall paired
the window's worst dip with the FIRST short date on four surfaces ("$10,001.00
on Aug 10" for a $1.00 day, incl. a `critical` nudge) — the exact pairing
radar had already fixed (L.23), unported to the sibling engine. The headline
now carries `firstShortCents` / `worstDipDate` / `shortfallDateBalanceCents`;
the hero title pairs the window figure with the worst dip's own date, the
nudge stakes the first date's own step figure, Ask and the calendar cell pair
each amount with its own date. **Critic cycle 1 (P1) caught the fix itself:**
the two-step sentence re-introduced the decoupling whenever an intermediate
day dipped deeper than step 1 covers — both engines now offer the split only
when the walk proves every day in [firstNegativeDate, worstDipDate) sound,
and withhold it otherwise (the single sufficient transfer always stands).
Wording says "covers", never "is needed" (the step figure rounds UP), and is
cause-neutral ("the rest is for the low point on …"). (b) /cards "Do this
first" is gated by `firstCountedActionCard` — the same `paintedHeroCards`
membership the hero uses and the same set the printed total sums; a next-cycle
estimate can no longer head the page's one imperative, and its row reads
"Estimated — next cycle". (c) /forecast's card-payment caveat moved above the
hero figure (DOM-order e2e lock). (d) `RadarInput.undatableCards` is required
at the boundary (the hero's own #277 fence), the radar card discloses the
count in every status ahead of the cover transfer, and the assumption names
the verdict actually on screen.

**Locks:** cash-needed H2 (split fields, single-event zero, P1-1 withhold),
nudge per-date stake, Ask two-step present/absent, firstCountedActionCard
(estimate-first trap / all-estimates promote / null banner), radar undatable
(ok/alert/none) and P1-1 withhold, forecast DOM-order e2e. Mutation-proven in
both directions per the critics' revert checks. Two fresh-context critics
(money + copy), 2 cycles, zero open P0/P1. Accepted residuals (nudge stake
precision, second-step posting buffer, chip-string duplication, unnamed first
short day on the hero) are recorded in DECISIONS #408. Lesson:
docs/lessons/a-fix-on-the-reported-surface-is-not-a-fix-on-the-pattern.md.

**Deploy-verified 2026-08-04:** `29d3b86` (no prisma diff);
`scripts/c12-live-deploy-check.mjs` against production → DEPLOY PROOF: PASS
(5/5) — `forecast-scope-note` renders above the hero figure (DOM order
checked), and the served client bundle carries the marker. Targeted e2e on
the verify build: 17 passed; the 3 failures reproduce identically on clean
HEAD (pre-existing drift — see the OPEN entry below).

## ✅ BUILT 2026-08-04 — C.11: the Glass-Box certification is split into the claim it can stand behind and the one it can't (audit P1-14, DECISIONS #407)

The audit's trust-surface finding: every Glass-Box panel ended "…matched to
the penny. Every amount is computed from your own data; nothing is invented",
and both halves overclaimed. `reconciles` compared two readings of the SAME
plan fields (`income − fixed − savings` vs `leftToSpendCents`, which
`plan.ts:707` computes from the same three; the bucket panels against
`conscious.ts` copies of the identical fields) — true for every input,
including every defect in the audit, while the comments called it "a real
cross-module check". And the provenance clause was false whenever a figure was
reader-typed: an income/fixed override, a goal or savings-% target above $0,
a budget target pricing a Fixed category — or, found by critic cycle 2, a
reader-ADDED card whose statement or balance is a typed figure. Fix:
`NumberTrace` gains a REQUIRED `dataDerived` flag, per-panel: cash-needed is
true iff no row comes from a manual card (`Account.provider` →
`CardSnapshot.manual` → `CardObligation.isManual`, both statement and estimate
paths); the fixed bucket answers for the fixed term alone; savings never; the
full identity requires all three terms clean, unknown budget-pricing treated
conservatively as reader-set. One-row panels say "This amount is the whole
figure." — no penny-match and no completeness claim (cycle 2 P1-1: the Fixed
row is itself an aggregate); multi-row panels keep the arithmetic sentence and
the fail-loud mismatch branch; the clause renders only under the flag in all
four copy authors (panel, share text, /spending-plan's fused sentence, plus
the zero-income basis and Ask's two copies reworded to the app's state: "no
income has been detected"). `reconciles` is restated everywhere as what it is
— a drift alarm, not a certification. The same one-row rule now applies in
breakdown-panel.tsx.

**Locks:** S8 in glass-box.test.ts (gate cases incl. cash-needed feed-true /
manual-false on both paths + mixed, and the reconciles/dataDerived
independence), per-bucket locks in conscious-trace.test.ts, redact locks for
both branches, and e2e on /budgets (no penny-match on the one-row panels, no
clause on savings). Mutation-proven in both directions: four mutations (delete
savings condition → 5 tests kill it; flip the unknown-default → 2; force flag
off → 4; force the fixed predicate true → 5), all reverted green.

**Critic cycles:** 2 (DECISIONS #407). Cycle 2 (fresh context, two lenses)
refuted the first cut's cash-needed `true` (wrong source checked — manual
cards exist, DECISIONS #45) and the one-row sentence's completeness claim;
both fixed same cycle, the overclaiming test rewritten with them.

**Gate:** `bash scripts/verify.sh` → **VERIFY GREEN** (tsc 0, eslint 0,
**5930 unit / 360 files**, build clean). E2e serially on that build:
glass-box, conscious-buckets, spending-plan-month-edge, month-flow-drilldown,
category-breakdown. Pre-existing red
fixed on the way: DECISIONS_INDEX.md had stopped at #405 while DECISIONS.md
carried #406 — `ledger.ts reindex` regenerated it (395 entries, drop-guarded).

**Deploy-verified 2026-08-04:** pushed `4b5c43c` (no prisma diff → database
untouched). Deployment `aimplifi-53qi3p5bv` ● Ready, aliased to
www.aimplifi.app. Proof is `scripts/c11-live-deploy-check.mjs` → **DEPLOY
PROOF: PASS (7/7)** on the live site: signed into the shared demo, the Fixed
panel (one row) renders the C.11 sentence with the provenance clause (the
demo's Fixed term is data-derived) and NO penny-match; the Savings panel
withholds the clause; the guilt-free panel keeps the arithmetic sentence; the
served client bundle carries the C.11-only literal. (The zero-income sentence
is a server-chunk literal and demo-unreachable — freshness rides the DOM
states, which the old build cannot render.)

**Honest residuals (DECISIONS #407):** the clause-render FALSE branch is
e2e-reached only via the savings panel (the seed has no overrides, budget
targets, or manual accounts); override/budget/manual readers are unit-locked
at the flag only (no RTL in the repo). Month-flow / category-breakdown panels
keep their MULTI-row penny-match as product behaviour — their check is the
same drift-alarm shape (rows are the figure's own input transactions), not a
re-certification. `AccountLike.provider` is optional: only the demo provider
exists, and it emits full Prisma rows.

## ✅ BUILT 2026-08-04 — C.10: the wealth-target pace line branches on the contribution's basis, and a plan the history doesn't back gets no date (audit P0-8, DECISIONS #406)

The last open P0 of the calc audit. #375 made the years dial compound the settings
savings-% target whenever one is set, but the pace line kept calling the figure
"what was left after spending, averaged over the N months" — a history claim the
line beneath falsified ("Recent surplus averaged −$450.00/month") — and the refusal
tested only the figure the dial was HANDED, which a positive plan clears by
construction: an overspender with a savings % set got a confident 20-year arrival
beside the FI card refusing one. Fix: the pace-line decision moved into a pure
selector (`COACH_COPY.wealthTargetPaceLine`) that branches on the basis and gates a
settings contribution on the OBSERVED surplus; new planned-pace sentence ("what your
plan has you setting aside", no window claim); refusal with the
`wealthTargetNotSaving` split (zero complete months = absence, not behaviour;
otherwise "nothing has been left over after spending", accurate at an exact tie).
Critic cycle 1 caught the sibling defect: a refused plan still SEEDED the horizon
slider ("your current pace lands it" under the refusal) — now one exported
predicate (`wealthTargetPlanUnproven`) gates BOTH the refusal and the seed, which
falls back to the unchosen 25-year default like a floored surplus. Surplus-basis
rendering is byte-identical, locked as such.

**Gate:** `bash scripts/verify.sh` → **VERIFY GREEN** (tsc 0, eslint 0, **5909
unit / 360 files** (+1 predicate lock), build clean). `wealth-target.spec.ts` 2/2
serially on that build. **P2 residuals noted in DECISIONS #406** (beyond-horizon
"what's going in now" now reachable on the settings basis; the seed's OR line has
no node-env lock — repo has no RTL — its two inputs are locked).

**Deploy-verified 2026-08-04:** pushed `a243e90` (no prisma diff → database
untouched). Proof is `scripts/c10-live-deploy-check.mjs` → **DEPLOY PROOF: PASS**
on www.aimplifi.app: signed into the shared demo, the pace line renders an arrival
through the new selector ("At $1,239.70/month — what was left after spending,
averaged over the 6 months of …"), and the SERVED client bundle carries both
C.10-only literals ("what your plan has you setting aside", "nothing has been left
over after spending") — the freshness marker the byte-identical demo sentence
cannot provide. A script-only commit `14d4059` followed (not in the app build).

## ✅ BUILT 2026-08-04 — scenario engine speaks the coach's REAL window (closes the C.9 residual)

The C.9 OPEN residual is closed. `ScenarioBase` now carries a REQUIRED
`averageWindowMonths` — verbatim `CoachData.fi.monthlySavingsMonths`, the coach's real
window (≤ 6 full months; 0 = none on record) — and `ScenarioState` carries it through
`applyScenario`. Every copy site that hardcoded "6 months" now interpolates the window
in the coach's C.9 dialect: the standing assumption ("averages over your last N full
month(s)"), both S15 $0-base disclosures ("income/spending over the last N months"),
and the doc comments. Window 0 gets the honest named-zero branch ("no complete months
of history are on record yet" / "your history so far") instead of inventing a window.
No math changed — the aggregates arrive pre-averaged verbatim, and the window is
copy-only by documented contract. There is no scenario UI yet, so no page renders the
copy; the engine contract is what the future what-if surface will read.

**Locks:** scenario.test.ts grew a window-consistency block — the window carried
verbatim for 0..6; the assumption string pinned per N with a no-"6"-unless-N-is-6
guard; singular at 1; the window-0 branches; S15 notes interpolated on BOTH sides;
consistency surviving a fully-knobbed scenario. Full-window (6) rendering stays
byte-identical, so the existing pinned assertions were untouched.

**Gate:** `bash scripts/verify.sh` → **VERIFY GREEN** (tsc 0, eslint 0, unit green,
next build clean).

**Deploy-verified 2026-08-04:** pushed `b902ac9` (no prisma diff → database untouched);
Vercel deployment status **success** on that SHA (deployment id 5751099840,
`aimplifi-73d3kh9nh-reiforge.vercel.app`); www answers (307 → /sign-in, the auth
gate, as designed) and the deployment URL serves 200 at /sign-in. No content-match
grep was possible: the scenario engine has no rendered UI surface yet — the changed
copy lives entirely in the engine contract the unit locks executed.

## ✅ BUILT 2026-08-04 — C.9: annual spending scales by the REAL window, never ×2 (DECISIONS #405, audit P0-6)

`getCoachData` computed `annualExpenses = expenses6 * 2` while the savings/income
averages divided by `Math.max(1, last6.length)` — so a reader three months in got an
annual figure exactly HALF their true spending, and the FI number, the FI date, Coast
and the /goals emergency-fund example halved with it. Fix: one line of money math in
the server that owns the window — `roundHalfAwayFromZero(expenses6 * 12 /
Math.max(1, last6.length))`. For a full six-month window this is byte-identical to the
old value (×12/6 = ×2, exact integer — no rounding drift); for N < 6 it is the true year.

**The copy half of the slice.** Five surfaces hardcoded "6": the FI sentence ("last 6
full months × 2"), the slider caption + context, the share-of-income sentence, and the
runway cushion on BOTH the signature weather line and the dashboard income-pause line.
Each now receives the window — the server's existing `monthlySavingsMonths` (documented
as ALSO the annual-expense window) for the /coach cards; a new REQUIRED
`NudgeInput.runwayWindowMonths` riding onto `Proposal` for the income-pause line
(required, not defaulted). Full-window renderings are byte-identical; short windows say
"your last 3 full months × 4" / "3-month average pace"; zero history gets a named-zero
branch instead of "0 months".

**Critic cycle 1 — zero P0/P1.** One P2 recorded as an OPEN residual below (the
scenario engine's own "6-month averages" note — pre-existing, separate engine).

**Locks:** fi-real-basis.test.ts grew a 3-month-history Prisma lock (window carried as
3; annual = the true $36,000; FI = $900,000; fail-old pins against the $18,000/$450,000
half-values; the FI sentence naming "your last 3 full months × 4" off the REAL server
output). Copy locks pin the N=3/1/0 branches and byte-identical N=6 forms.

**Gate:** `bash scripts/verify.sh` → **VERIFY GREEN** (tsc 0, eslint 0, unit green,
next build clean). Targeted `phase3-coach.spec.ts` e2e 1/1 — the demo seed's six-month
window leaves every pinned string byte-identical.

**Deploy-verified 2026-08-04:** pushed `ba90b3c` (no prisma diff → database untouched);
Vercel status **success** on that SHA (deployment
`reiforge/aimplifi/DX6YxPgg1h3zRhABL8dA3BNvkXJU`); www answers (307 → /sign-in, the
auth gate, as designed). No content-match grep was possible: /coach is behind the login
and the demo's six-month window renders every pinned string byte-identical by
construction — the changed behaviour lives in the short-history branches, which the
3-month Prisma lock executed against the real engine.

## ✅ BUILT 2026-08-04 — C.8: /calendar places each card and loan due in EVERY month (DECISIONS #404, audit P0-3)

`buildCashFlowCalendar` used to window-gate the ONE obligation the engines emit
per card/loan, so every month but the due month printed "0 payments due across 0
dates" under a footnote promising each due day is badged — September understated
the owner's committed outflow by ~$25,000. Now the engine SYNTHESIZES future
cycles inside the month window: cards repeat monthly from the RAW issuer due date,
business-day re-adjusted per occurrence, priced at the statement basis
(`cycleBasisCents ?? cashRequiredCents`), always `(est.)` — the radar's
`projectCardDues` rule for rule; loans repeat their fixed issuer-reported payment,
never `(est.)`, from the same raw anchor /forecast expands. New REQUIRED params
`today` + `holidays`. Current-month events are untouched (fail-old locked).

**Critic cycle 1 — FAIL, 1 P1 + 4 P2, all fixed + locked.** The P1 (F-1): the
synthesized events reused the boolean `isEstimated`, and the frozen disclosure
keyed its amount sentence off it — so a frozen card WITH a statement was told, in
every later month, that its figure was "worked out from the last balance we saw"
while the grid printed the statement basis. Fix: `DueAmountSource`
(`statement | repeated-statement | balance | loan-terms`) computed once in the
engine, carried on `CalendarEvent.amountSource`, mapped verbatim by the page,
branched in `frozenCardsNote` (three sentences) and `frozenCardDatesNote` (a
repeated statement still derives its DATE from the statement).
`FrozenCardRow.isEstimated` replaced by `amountSource`; the six current-cycle call
sites map through one `currentCycleAmountSource()`. Follow-up scoped critic caught
the source logic keying on the page-injected `cycleBasisCents` alone — a bare
statement card would have mislabeled as balance; now keyed on the obligation's own
estimate path. P2s: overclaimed "one date" comment corrected (calendar rolls back
to business days, /forecast prints raw — by design), footnote precision for
estimate-path cards, the F-4 stale-anchor residual recorded in-source, and
phase4.test.ts's `[...cards, ...upcoming]` double-list (a post-C.8
double-synthesis trap) now `result.cards` alone.

**Gate:** `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0,
**5849 unit / 358 files** (21 new: synthesis locks, amountSource locks, the three
F-1 sentence branches + the September real-engine provenance lock), next build
clean. Targeted calendar e2e (calendar-frozen ×6 / duplicate-connections /
phase4-features) **21/21** serially; the calendar-frozen quiet-month lock was
REWRITTEN to the new truth — later months now paint the frozen fact on the
synthesized money; only a PRE-due month is silent. Three unrelated mobile-380 e2e
fail identically on clean HEAD — see the OPEN entry below.

## ✅ BUILT 2026-08-04 — C.25: the mortgage leaves the spending totals in EVERY month, at read time (DECISIONS #403)

The #400 revert direction stood up: nothing stored is written. The exclusion is
computed ONCE in the snapshot assembler (`getFinanceSnapshot`) and inherited by
every flow-summing surface through the shared predicates (`countsInFlows`,
`isSpendRow`, `monthlyFlows`, `spendingByCategory`) via an optional row-id set;
an unwired caller and the demo golden are unchanged by construction.

**The four gates** (`src/lib/engine/categorize/loan-payment-flows.ts`): a row
leaves the flows only when (1) it would otherwise have counted, (2) its
canonical is linked to one loan account by ≥2 DISTINCT pair-months re-derived
at read time (aggregate canonicals refused; the stored flag is not an input,
so it cannot be consulted), (3) that account has a DATEABLE obligation, and
(4) the amount equals an obligation payment. Attribution is PER EDGE (critic
P1-3): a row that paired itself is judged by where its pair lands; an
unpaired month leaves only if EVERY linked account can project — SimpleFIN
and undatable loans keep their money visible.

**Measured on the owner's data** (read-only probe,
`scripts/audit-probes/c25-read-side-exclusion.mts`, first run executed this
session): exactly one merchant edge — Truist Mortg Olb Mtgpmt → Mortgage 1192
@ $6,217.07/mo; April's total drops $6,217.07, July's drops $12,434.14 (two
rows), flagged months unchanged. A row-identity re-run was blocked by a
permissions gate after the first run — recorded, not hidden; the month-level
figures above are the executed evidence.

**Critic cycles 1–3.** Cycle 1 FAIL, five P1s — pace's bill basis dropped the
excluded merchant from BOTH halves, Ask `merchant_spend` joined the one
basis, per-edge attribution, register links REFUSED for categories whose
figure dropped excluded rows (O.5/O.6 link invariant), coach/dashboard name
what left their figures. Cycle 2 FAIL, three P1s — the carry CAPACITY cap
(at most the carried count leaves per canonical/month/amount: the month's
inflows onto eligible accounts or the obligations covering it, whichever is
larger), all-partner eligibility for attributed rows, and Ask disclosure
(engine branch for the lender case + basis sentence on the total intents,
largest-purchase rankings drop excluded rows). Cycle 3 FAIL, one P1 — the
disclosure FACTS now derive from actual exclusions, never eligibility (a
merchant that qualified but kept its rows publishes nothing), and split/
reader-excluded rows can no longer classify a merchant. All locks live in
the three test files below; cycle 3's P2 residuals (aggregate-branch clause,
pending qualifier wording, window-independent Ask sentence, new-merchant
surface) are RECORDED, not fixed.

**Gate:** `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0,
**5828 unit** (30 new: the gates, attribution/capacity shapes, phantom locks,
pace locks, merchant_spend basis, assembler wiring on a throwaway user + the
demo-golden lock), next build clean. Targeted e2e
(reports/reports-total-reconciles/budgets-basis/trends×3/phase3-coach/ask/
spending-plan×2/dashboard-duplicate-disclosure): **39/41** — the two
`dashboard-duplicate-disclosure` mobile-380 failures reproduce IDENTICALLY on
clean HEAD (stash-verified this session), so they predate this slice; see the
OPEN entry below.

**Deploy:** `d4347c6` → GitHub deployment `aimplifi-38lifklki-reiforge`
state `success` (Production), www.aimplifi.app `/sign-in` byte-identical to
the deployment URL this session (cmp). No demo figure moves by construction
(the seed's exclusion set is empty), so the sha-match + content-match is the
live proof, as with C.24.

## ⚠️ OPEN 2026-08-04 — three more mobile-380 e2e fail on clean HEAD (predates C.8)

Found while running C.8's targeted e2e; stash/run/pop on clean HEAD (`87f0f08`)
reproduced all three IDENTICALLY, so the C.8 slice did not cause them:

- `tests/e2e/auth.spec.ts:82` — "first manual account → dashboard explains its
  sparse cards (no bare $0.00)" (mobile-380)
- `tests/e2e/today-feed-frozen.spec.ts:220` — "an UNDATABLE frozen loan finally
  reaches the all-clear" (mobile-380)
- `tests/e2e/today-feed-frozen.spec.ts:238` — "the undatable loan is still named
  when another payment IS due" (mobile-380)

All three pass on desktop projects; `phase4-features.spec.ts:33` also failed once
in a parallel run but passes alone and serially (known parallel-flake class).
Not diagnosed.

**Reproduced again 2026-08-04 (C.12 session), same stash/run/pop method on
clean HEAD (`fec663a`): the two today-feed-frozen tests fail identically, AND
a third spec joined them — `tests/e2e/frozen-figure-surfaces.spec.ts:92` "the
surfaces that print a frozen figure now say so — /cards, Ask and /coach"
(mobile-380).** The failure mode is visible in the page snapshot: the custom
seeds render the feed's copy ("Nothing needs you today. Your bank stopped
sharing Home Mortgage…") but NOT inside the `payment-reminders-card` testid
the specs query, and the copy no longer starts "You're all caught up" — the
feed component drifted from both specs after O.3 (`c336b38`). The drift is
testid-and-copy, not the seeded data (the mortgage is named correctly on
screen). C.12 did not cause any of the three.

## ⚠️ OPEN 2026-08-04 — dashboard-duplicate-disclosure mobile e2e fails on clean HEAD (predates C.25)

`tests/e2e/dashboard-duplicate-disclosure.spec.ts` mobile-380 variants fail
with zero `reminder-row` elements (expected 2) — reproduced on unmodified
`main` (8c5b3fe) this session by stash/run/pop, so the C.25 slice did not
cause them. Desktop variants pass. Not diagnosed; likely a date-window or
mobile-layout drift against the seed's asOf.

## ✅ BUILT 2026-08-03 — C.24: the transfer-flagged mortgage counts once, at its full rate (DECISIONS #394)

Audit P1-13, measured live in C.0/#393: the owner's $6,217.07 Truist mortgage
was transfer-flagged only in months the linked MORTGAGE account's inflow
settled ≤3 days out, so it vanished from both halves of the Fixed union —
rollup fragment "rent $2,072.36", no series, Fixed ~$4,145/mo under.

The class is now STRUCTURAL (`loanPaymentMerchantCanonicals`: flagged cash
outflow whose ±3-day same-|amount| pair sits on a linked LOAN/MORTGAGE
account; per-merchant; aggregate canonicals refused). Detection keeps the
flagged rows (auto-loan precedent); the rollup/median exclusions read only
the UNIONED set (the exactness invariant: excluded ⇔ unioned — a merchant
detection cannot series, e.g. an escrow-adjusted amount, keeps its counted
rows instead of vanishing); the union adds the series at its monthly rate
unconditionally except the settlement-NEVER set and reader-priced (budget)
categories. Loan-side rows come from a targeted POSTED/USD query — the
snapshot keeps withholding loan activity (#62). /budgets reads the plan's
exclusion set, so the two surfaces print one basis.

Production replay (`scripts/audit-probes/mortgage-replay.mts`, read-only):
structural set = exactly {Truist Mortg Olb Mtgpmt}; rollup $9,785.24 →
$7,712.88 (the fragment gone); union +$6,217.07; **suggested Fixed
$9,785.24 → $13,929.95**; per-item trace matches the real function.

Gate: `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0, **5731
unit / 350 files** (21 pure + 3 real-server locks new), next build clean.
Targeted e2e `spending-plan.spec.ts` + `budgets-basis.spec.ts` **2/2** (demo
figures unchanged — the seed's loan account has no transactions, so the
structural set is empty on the golden dataset). Critic cycle 1 FAIL (4 P1 — F1
vanish-on-detection-failure, F2 budget double-price, F3 aggregate strip, F5
query guards), all fixed and locked; cycle 2 self-critic PASS (the
fresh-context subagent died on an account quota 403 — recorded, not hidden).

**Deploy:** `217147d` → Vercel `aimplifi-ptgrkst2j` **READY**, sha-matched via
the GitHub deployment status on the exact commit, www aliased. No UI marker by
construction (demo unchanged); the sha-match is the live proof.

**Residuals → TASKS C.25:** the radar, the stored-series refresh (and with it
/calendar, cash-needed, the L.30 census) still cannot see the bill the plan
now reserves, and the unflagged mortgage months still feed discretionary
burn; the month totals still see a lumpy mortgage (July counts in flows,
May/June don't — same root flag, out of this slice's Fixed scope).

## ✅ BUILT 2026-08-02 — C.3: Dashboard Trends card names divisor, assumption, mover window (DECISIONS #387)

Wave C P1-2 / P1-3 / P1-5. The dashboard card now prints "in the first N days",
the shared `PACE_ASSUMPTION` line, a muted (not green/rose) pace comparison with
a real zero-delta branch, and `(Jul '26 vs Apr '26–Jun '26 average)` on Biggest
change. The projected dollar is unchanged — that is C.2.

**Deliberately left to other rows:** C.1 (zero-spend abstention, Opus), C.2
(bill-calendar pace model, Fable), `/trends` pace colour (task named the
dashboard card).

Gate: `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0, **5636
unit / 345 files**, build clean; `trends.spec.ts` e2e **3/3**. Empty `prisma/`
diff.

**Deploy:** Vercel `aimplifi-nklnbw1pe` **READY** on `8511e9d`, www aliased.
Live demo /dashboard: `dashboard-trends-pace-days` ("in the first 10 days"),
`dashboard-trends-pace-assumption` ("a projection, not a prediction"),
`dashboard-trends-mover-window` ("May '26 vs Feb '26–Apr '26 average"), muted.

## ⚠️ OPEN 2026-08-02 — `ledger.ts` truncates a multi-line body to its FIRST LINE, and reports success

Found by using the tool: writing this session's PROGRESS entry via
`tsx scripts/ledger.ts progress "<title>" "<body>"` wrote **one line** of a
70-line body and printed `PROGRESS.md: prepended "…"`. The entry was repaired
with an editor; nothing is currently lost.

Not a quoting mistake on the caller's side — it is the process boundary. Probe:

```
$ npx tsx -e 'console.log(JSON.stringify(process.argv[1]))' "$(printf 'line one\nline two\n')"
"line one"
```

So every `ledger.ts` subcommand that takes prose as an ARGUMENT (`progress`,
`decision`, `regression`) silently keeps the first line on Windows. Same family
as #386 — a ledger script losing content while reporting that it wrote it —
which is why it is filed the day #386 closed rather than folded into it.

**Until fixed:** append to the ledgers with a heredoc into the file (`cat >> … <<
'EOF'`), which goes through stdin and is unaffected, or use an editor; then run
`tsx scripts/ledger.ts reindex`, which reads files rather than arguments and is
now safe. This is the same class `docs/lessons/windows-codegen-via-shell.md`
already warns about.

**Fix when picked up:** read prose from stdin or a `--file` path instead of
argv, and refuse to write a body that arrives shorter than some floor without
saying so. A script that can write less than it was given must not print success.

## ✅ CLOSED 2026-08-02 — `scripts/ledger.ts reindex` is safe to run (DECISIONS #386)

Was: the script parsed only the legacy pipe-table rows (#1–#337) and was blind to
the `## #N — title` sections every decision since #338 uses, so regenerating wrote
329 rows where 375 belong — and the header it generates prescribes that exact
command, which is how a Cursor agent deleted #374–#382 in good faith during #384.
34 decisions (#338–#373) were still absent when this session measured.

Now: `scripts/ledger-parse.ts` reads both formats (including the bare `## #354`
shape, whose summary comes from its first bold body line), and **regenerating
refuses to write if it would drop any number the index already carries** — it
throws, names every one, and leaves the file untouched. The second half is the
real fix: the next format the parser fails to understand fails in the terminal
instead of in the file. `nextDecisionNumber` was blind the same way and would
have returned 338, a number already used; it now counts both formats.

**376 of 376 decisions indexed, exactly one row each**, asserted against the real
committed files by `tests/unit/ledger-decisions-index.test.ts`. Residual, filed
not waived: `ledger.ts decision` still appends a legacy TABLE row while sessions
hand-write heading sections — the number is right, the shape is not.

## ✅ BUILT 2026-08-01 — Home polish + guilt-free without card pay (DECISIONS #369)

Owner: cluttered Home; Plan math treated card pay as fixed; transactions buried.
Shipped: three-term guilt-free (`income − fixed − savings`); card dues stay on cash-needed
only; Home = guilt-free → cash needed → recent transactions (needs-file) → Today → banners →
Radar → net worth. Ask / top spending / trends / recurring / reminders / savings-rate left
their own routes.

Gate: tsc 0, eslint 0, **5549 unit / 335 files**, next build clean; targeted e2e 25/25
(phase1 + spending-plan-month-edge + ask). Empty `prisma/` diff.

**Deploy:** Vercel `dpl_5Hn8UXcy64hpzsaFeYfYxcAkyWNJ` **READY** on `2e3bf72`, www aliased.
Live demo /dashboard: guilt-free `$2,215.00` with “after fixed costs”, recent strip +
“merchants need filing”, cash-needed `$5,412.33`; top-spending/Ask cards absent.
Live /spending-plan: no “Card payments due this month” row; basis notes card pay is not
subtracted.

## ✅ BUILT 2026-08-01 — W.12: the FI card names the real rate once (DECISIONS #368)

After W.2 the same 4.50% appeared four times in four wordings and the new basis
paragraph pushed the payoff (`freedom-dividend`) past an 800px viewport. Headline,
Coast and payoff now defer with "under this card's return assumptions" (or silence)
and never restate a `xx.xx%`; the payoff sits ABOVE the basis so a scanner sees it
first. `fiProjectionBasis` remains the sole namer of both dials and the derived
real rate. The opt-in volatility disclosure still names both rates — deliberate.

Gate: `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0, **5549 unit /
335 files**, build clean; empty `prisma/` diff. phase3-coach e2e 1/1 (painted order
+ absence of 4.50% outside the basis). Self-review on the money-copy axis; 0 P0/P1.

**Deploy:** Vercel `dpl_5USJrJk5WskcN1NJbKV9Pm1rHSpo` **READY** on `cd46ef1`
(code `716e529`), www aliased. Live demo /coach: years contains "this card's
return assumptions", years/payoff/coast lack 4.50%, basis has 4.50%, payoff
y=430 < basis y=506.

## ✅ BUILT 2026-08-01 — W.13: the return dial is no longer called the reader's (DECISIONS #367)

`User.expectedReturnBps` is `Int @default(700)` and NOT nullable, and the /settings field is
required and pre-filled — so a reader who has never opened that page still carries the app's own
7.00%, and six sentences across three cards called it **"your 7.00% return assumption"**. The
wealth card said it outright: *"7.00% return is your setting; 2.50% inflation is Aimplifi's
default, which you haven't changed"* — one sentence attributing one dial correctly and the other
falsely, shipped for four slices, live on the demo.

**Decided by VALUE, not by a new column.** There is no stored "unset" to read the way
`inflationIsDefault` reads a null column, and making the column nullable would describe none of
the rows already in the database (every one holds 700), so `returnIsAppDefault(bps)` is
`bps === DEFAULT_EXPECTED_RETURN_BPS`. The one reachable error — a reader who deliberately typed
7 is told 7.00% is our default — runs in the safe direction and is pinned in
`tests/unit/return-dial-default.test.ts` so it cannot be re-litigated as a bug. The copy claims
only what the equality proves: **"our default 7.00% return assumption"**, never "which you
haven't changed" (true for the nullable inflation column, unprovable for this one).

Both flags now travel as one `DialOwnership` object rather than two positional booleans, because
`boolean` and `boolean` are indistinguishable to tsc and a swap would put each dial's possessive
on the other dial's rate. Surfaces changed: the FI card's projection basis, the opportunity
list's basis, the wealth card's basis / dials / sensitivity intro / required-contribution, and
/investments' retirement outlook. Each has a RENDERED lock (a unit test on a copy function cannot
see the page handing over the wrong answer); the /investments path was mutation-proven through a
rebuild.

**Deliberately unchanged, enumerated rather than overlooked:** `/goals` (×3) and the Goals
empty state say "assuming your current savings rate and expected return" — no rate is printed
and the phrase means the settings that apply to the reader's plan, so there is no number whose
provenance a reader could question; `money-dials-form` says "your expected return" twice while
the reader is editing that very field, and now carries "The 7% here is our default." beside it so
the page /coach links to says what /coach says. `COACH_COPY.opportunity`'s "your 0.00% return
assumption" is untouched because that branch is `nominalReturnBps === 0` and the app's default is
700 — a possessive kept true by arithmetic, asserted about the constant rather than left in a
comment.

## ✅ BUILT 2026-08-01 — W.11: FI slider first paint is the unchanged branch (DECISIONS #364)

An 85% saver used to see "Lowering your savings rate from 85.0% to 70.0%…" on first paint
because the thumb was hard-clamped to 70% while the caption compared against the real pace.
Ceiling is now `Math.max(7000, currentRateBps)`; initial thumb = current pace; both bounds
share `fi-slider-bounds.ts`. W.12 (rate-copy accretion) shipped — see its section above.

### Critic / locks

Self-review against the money-copy axis (small, mechanical slice — no separate critic
subagent). Fail-old pin of the hard clamp; unit lock that an 85% first paint says "current
pace" and does not leak the mixed year pair; e2e asserts the same on the painted card.
Gate: `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0, **5511 unit / 334
files**, build clean; empty `prisma/` diff. phase3-coach e2e 1/1.

**Deploy:** Vercel `dpl_847yTgBW9j1VFh3vCyRrU9vw6CEC` **READY** on `b1f9600`, www
aliased. Live demo /coach first paint: "This is your current pace (23.4%…)" — no
Lowering/Raising; slider `max` stays 7000 for the demo (pace < 70%).

## ✅ BUILT 2026-08-01 — W.10: the opportunity list is in today's money (DECISIONS #363)

Opened by the W.2 money critic: /coach's "Worth a look" rows printed 30-year
NOMINAL future values ("$X of future wealth … assuming 7.00%") one scroll below
the FI card that had just moved into today's money. At the shipped defaults
$500/mo read as **$609,985.50** where it buys **$290,806.13** of today's goods.

**Decision that took two critic cycles.** Two today's-money figures exist and
differ by ~23%: (A) compound at the REAL rate (level in today's dollars,
$379,693.07) or (B) compound at the NOMINAL dial and deflate the whole total
(level in nominal dollars, $290,806.13). **(A) shipped first and was wrong** —
two independent critics killed it on `negotiable-bill`, a hard-coded flat
$20/mo retention offer, so "the price would have risen" is a claim about a
price that does not exist. (B) is conservative for every kind, and its premise
is the literal sentence beside the figure.

Also fixed: two of four row kinds ran a colon into "is $X" and had never
parsed; a zero-return dial no longer credits compounding with the deposits;
the basis sentence has three branches for the dial edges `validateDials`
permits. Two contribution conventions now coexist on /coach deliberately —
the FI card's monthly figures are level-real; this list is flat-nominal —
each stating its own model.

### OPEN / stated limitations

- **`User.expectedReturnBps` is non-nullable with a DB default of 700**, so the
  copy calls 7.00% "your return assumption" for a reader who has never opened
  /settings. The possessive `inflationIsDefault` exists to prevent this for the
  *other* dial. Pre-existing and identical on two other cards; fixing it here
  alone would make three cards disagree. Filed as **W.13**.
- **W.12** (rate-copy accretion) and **W.11** (slider first paint) both shipped
  2026-08-01 — see their sections above.

### Critic cycle

Two fresh-context critics across two cycles, both FAIL on the first model,
converging independently on the indexed-contribution overstatement and the
floored-real-rate copy lie. All P0/P1 fixed and locked (golden sentence, model
gap pin, e2e golden dollar figure `$20,350.61` for the demo's LA Fitness).
Gate: `bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0,
**5504 unit / 333 files**, build clean; empty `prisma/` diff (no schema change).
First vitest pass under the parallel verify run hit 6 SQLite `database is locked`
flakes (known contention class); isolated re-run of those files 522/522, then
full suite alone 5504/5504, then clean verify 5504/5504. E2E golden
`$20,350.61 in today's money over 30 years` locked in `phase3-coach.spec.ts`
(7/7 with auth.spec).

**Deploy:** Vercel `dpl_9qp3dkEUNLRs1W7httzq4P58JMUV` **READY** on
`db2a5e1`, target production, aliased to www.aimplifi.app (GitHub Production
deployment sha `db2a5e1`). Live marker via demo sign-in on /coach:
`$20,350.61 in today's money over 30 years` present; old `"future wealth"`
absent; `data-testid="opportunities-basis"` rendered.

## ✅ BUILT 2026-08-01 — O.20: every bar on the /reports chart opens the rows behind it (DECISIONS #362)

Owner, 2026-08-01: *"every single bar and collection of categories needs to be immediately
available … essentially you are filtering transactions … why is this so hard, you're not
recreating wheel … mint and simplify both do this."*

**What was actually missing.** Twelve surfaces already drilled into transactions (every
category row on /reports, /trends and /budgets — name, figure and inline bar — plus the O.18
expandable panels). The CHART did not, and it is the first thing on the page. W.3 had filed the
charts as a deliberate refusal, and **its own enumeration was incomplete**: it named four
Recharts files when there are seven, plus six more surfaces drawing hand-rolled bars.

Tapping an income or spending bar now opens the transactions that bar is made of, inline, with
the register offered in the footer. Six month buttons under the chart reach the same panels —
the bars are SVG rectangles and cannot be focused, so the buttons are the accessible path and
the bar tap is an accelerator.

**Built on the flows predicate, not the category one.** `buildMonthFlowBreakdowns` selects rows
through `monthlyFlows`' own exported predicates, and `getReports` hands both breakdown families
the same array, so a bar and its rows cannot describe different sets. The register link claims
only a WINDOW: no `type=expense` filter, because that drops the refunds the bar netted and keeps
the pending rows it never saw.

### OPEN / stated limitations

- **/reports prints one month's spending twice, on two bases, and they differ.** The bars are
  posted-only; the "Spending by category" card counts pending charges. Measured on the demo at
  **$299.93** for the current month. Each panel states its own basis and a new sentence names the
  DIRECTION of the gap — but it deliberately names no mechanism, because at least five rules
  separate the two figures and a critic falsified the "pending charges" explanation in both
  directions. Unifying the two bases is a bigger decision, filed as **O.20a**.
- **The /reports payload now carries six months of rows instead of one.** `monthFlows` ships the
  rows behind all twelve bars so the panels can reconcile without a second query. Roughly a 6×
  increase in this route's RSC payload; not measured against a heavy real account. Filed as
  **O.20b**.
- **Two unfiled deposits that look identical land on opposite sides.** A positive row with no
  category counts as income; one filed to `uncategorized` nets against spending. That is
  pre-existing engine behaviour which this panel now makes visible; both basis sentences name it
  rather than pretending there is one rule. Filed as **O.20c**.
- **Still not drillable:** /coach's hand-rolled discretionary bars, /trends "New this month"
  (O.18e), /recurring rows (O.18c), and the three charts that are not transaction sets at all —
  net worth, forecast, and the investments allocation bar, which want a panel showing what they
  ARE made of rather than a transaction filter. Filed as **O.20d**.

### Critic cycle

Two fresh-context critics, **both FAIL** (3 P1 and 4 P1 respectively), converging independently
on two findings: the clamp sentence printed *"outran purchases by −$80.00"* — a double negative
asserting the opposite of the truth — and three positional claims pointed the wrong way. The
deepest was the flow SPLIT: the basis sentence described it as a rule about refunds, and was
falsified by rows rendered inside the panel it described. The two critics disagreed about which
way an unfiled deposit goes, and **executing the predicate settled it** — both were half right.
All P1s fixed and locked; the sign bug is now impossible by construction rather than correct by
argument. Gate: **5481 unit / 333 files**, tsc 0, eslint 0, build clean; 10/10 on the affected
e2e specs, 14/14 mobile-overflow.

## ✅ BUILT 2026-08-01 — W.2 + W.9: the FI card's dates are in today's money (DECISIONS #361)

**Every FI date on /coach used to arrive early, by the whole inflation gap.** The FI number is
built from the reader's own last six complete months of spending — a figure in today's dollars
— and the server grew the portfolio toward it at the NOMINAL return dial. Comparing future
nominal dollars against a present-value target is a unit mismatch, and it errs in one
direction only. At the default dials that is 7.00% against 4.50%: decades on a long horizon.
The projections now compound at the real rate, so **dates move LATER** and /coach carries one
basis instead of two. W.9 landed with it: the Coast line's "25 years" now says the app chose
it, not the reader.

**Two fresh-context hostile critics, both FAIL, seven P1s, converging independently on two.**
All fixed and mutation-proven. The one worth reading twice: `monthsToFI` returns `null` both
for "not saving" and for "saving, but past the 1200-month projection cap", and the card
asserted the first for both — so at a low real rate a reader putting away $500 a month was
told their contributions weren't outpacing their spending. Also fixed: /goals was still
running the identical simulation against the identical target at the nominal rate (181 months
there against 221 on the card the reader had just left); the Coast card's monthly figure had
silently become a today's-dollars instalment that a flat standing order outruns, while new
copy told the reader both cards agreed; and `realReturnBps` was clamped at only one end.

### OPEN / stated limitations

- **One finding deliberately deferred** — W.12 (the same rate is now stated four times in
  four wordings, pushing the payoff line past the fold at 380×800). W.10 and W.11 shipped
  2026-08-01 — see their sections above.
- **The Coast horizon's "reader chose it" branch is unreachable today.** No control sets
  `COAST_TARGET_YEARS`; the flag is a server field rather than a literal so that adding one
  later changes a line instead of a copy branch that has quietly become false. Stated in the
  test so nobody infers a control exists.

### ⚠️ The full e2e gate is RED, and neither failure belongs to this slice

`bash scripts/verify.sh` is GREEN (tsc 0, eslint 0, **5455 unit / 331 files**, build clean).
With `VERIFY_E2E=1` two specs fail, both attributed by execution:

1. **`phase2-triage.spec.ts` "singles mode never leaks onto the next card" — deterministic,
   pre-existing, and probably a LIVE PRODUCT BUG.** It fails alone at `--workers=1` and
   **fails identically on clean HEAD** (verified by `git stash`), so it is on the deployed
   commit. Filing the last row of a singles group through the write-in leaves
   `data-remaining` at 11 when it should read 10 — the group empties but the queue never
   advances, which is exactly the behaviour that spec was written to lock. Filed as **V.4**;
   deliberately NOT fixed here, because it is a state-machine change in the categorization
   path and wants its own diagnosis and critic rather than a ride-along in a money slice.
2. **`category-rename.spec.ts` — the V.1 rotating flake.** Fails in the full parallel run,
   passes alone in 1.4s.

**A process finding filed as V.3, worth more than either.** Three specs failed mid-slice with
/dashboard rendering its "Something went wrong" error boundary — indistinguishable from a P0
in the change under test. The cause was a **leaked `next start` on port 3100**: with
`reuseExistingServer: true`, Playwright served a build predating the fixes, so the fresh
`next build` the gate had just run was ignored. One `taskkill` turned all three green with no
code change. This **contradicts the evidence recorded under V.1**, which reports "nothing is
LISTENING on port 3100 between runs" and treats the leaked-server hypothesis as refuted on
this machine. It is not refuted. `docs/lessons/e2e-runs-a-stale-build.md` has been corrected:
its claim that the full gate is immune because it builds first is false, since building does
not help if the port is occupied.

## 🧭 DECIDED 2026-07-30 — O.15 slice 5 / O.13e: category parity is three questions (DECISIONS #345)

TASKS O.13e bundles three Simplifi capabilities under one row and says to decide
which are real gaps **before** building. This slice is that decision, and the
bundling was the thing to undo — the three share a noun and nothing else.

**(a) Three-level hierarchy — REFUSED, deliberately.** `Category.parentId` has zero
readers and zero writers outside generated Prisma, so nothing is half-built. Six
picker surfaces plus every group-by in reports/trends/budgets/spending-plan render
the 2-level shape, and Simplifi's own example (Auto & Transport -> Registration ->
Registration Fees) is already expressible as a leaf under a group — `auto-registration`
literally is it. Reopens on an owner request naming a distinction two levels cannot
express.

**(b) Explicit Expense/Income type — REAL, DEFERRED, and not a UI toggle.** "Is this
category income?" is answered in **14 places**; only 2 use the shared
`isIncomeCategoryId`. The readers split across two maps — `reports.ts`/`trends.ts`
use the per-user merged meta, the other twelve the static custom-blind
`CATEGORY_BY_ID` — and they agree solely because `NON_CUSTOM_GROUPS` bars a custom
from the Income group. Relaxing that turns `pipeline.ts`'s three #44 sign guards
from a documented exemption into a live defect: an OUTFLOW would file into an income
category, which `isSpendRow` drops from reports/trends/budgets while `monthlyFlows`
still counts it. **This is not hypothetical — it is O.13a critic cycle 1's P0
(`cardone` -> income meeting `CARDONE MGMT FEE -$125.00`), already paid for once.**
Prerequisite: thread per-user meta into `pipeline.ts` and collapse all 14 onto one
custom-aware basis. Weighed against 11 income leaves already shipped, the marginal
capability is small and the blast radius is the auto-filing path.

**(c) Per-category tax flag — REAL, re-routed to rule then-actions (parity row 2).**
Semantics settled on failure direction: a write-time stamp, never a read-time
fallback (which would silently re-tag history a reader may have handed a preparer;
write-time can only under-tag, which is visible). What blocks it as a *category*
column is topology — `applyCategory`, recategorize, keyword-rule apply, backfill,
Plaid and SimpleFIN each write `categoryId` independently, so a per-call-site stamp
is the fence-by-call-site anti-pattern. It belongs on the rule machinery, which
already has counted apply-to-existing and undo.

**Code shipped:** two understated comments corrected in place — `NON_CUSTOM_GROUPS`
now records all 14 dependents across two maps and what breaks in `pipeline.ts` if it
is relaxed; `isIncomeCategoryId`'s "This is THE income test" now says it is one of
fourteen. Behaviour is unchanged by construction.

**Self-correction, recorded:** the first draft of this finding claimed the exclusion
was an unlocked invariant. It is locked fail-old by
`tests/unit/custom-category-lifecycle.test.ts:82` ("refuses the Income and Transfers
groups"). Reading the test is what corrected it; the real defect was the narrower one
that shipped.

Gate: `bash scripts/verify.sh` — tsc 0, eslint 0, build clean, **5038 unit / 316
files**, identical to slice 4's baseline, which is the evidence that nothing
behavioural moved. No `prisma/` diff, so the live database is untouched.

### 🟠 OPEN, carried forward from this decision

1. **The 14 income predicates are still 14.** Consolidation onto one custom-aware
   basis is the named prerequisite for (b) and is not done. Until it is, the
   `NON_CUSTOM_GROUPS` exclusion is what holds reports/trends and the other twelve
   readers in agreement.
2. **Per-category tax defaults do not exist**; the reader still tags every row by
   hand. Now tracked under parity row 2 rather than O.13e.

## 🔴 OPEN — owner-reported 2026-07-21: "the password isn't being remembered" (START HERE NEXT SESSION)

Owner, verbatim, at the end of the #260 session: *"There's a problem with the
password saves that we need to fix next session. It used to work. We did lots of
things in env variables today and now it's just not remembering the password I
entered earlier."*

**NOT DIAGNOSED — do not act on any theory below before its check.** The symptom
sentence has at least three readings (the browser isn't saving/filling it; sign-in
rejects a password that used to work; the session drops and it asks again), and
they have different fixes.

**Verified facts, read-only, this session (these are evidence, not guesses):**
1. **No env var can invalidate a stored password.** `src/lib/auth/password.ts`
   stores `scrypt$<salt>$<key>` with the per-password salt INSIDE the stored
   string; verification re-derives from that salt alone. Today's env work cannot
   have made a correct password stop matching. (Env DOES affect reset links: their
   hashes are salted with `RESET_TOKEN_SALT ?? AUTH_SECRET ?? dev-fallback`, so a
   changed `AUTH_SECRET` kills outstanding reset links — not stored passwords.)
2. **Sessions are JWTs** (`src/auth.config.ts`: `session: { strategy: 'jwt' }`)
   carrying a `sessionEpoch` re-checked server-side; a completed password reset
   bumps it and signs out every existing session BY DESIGN (#257).
3. **The one thing that changed about the password FIELD today is #258.** Git
   confirms the `autoComplete` attributes (`email`, `current-password` /
   `new-password`) have been there since the original auth commit `c665ae6` and
   were not touched; `src/components/auth/password-input.tsx` — the show/hide
   viewer whose `type` attribute flips between `password` and `text` — was created
   today in `0deda04` (#258) and wired into sign-in, sign-up AND reset-password.

**CORRECTION, 2026-07-21 (#261): the #258 hypothesis is DEAD for the deployed
app.** Production was running commit `9e3e56f` (#257) — verified against the
Vercel deployment list, `githubCommitSha` on every production deployment — while
local `main` sat **8 commits ahead, unpushed**. #258 (the show/hide viewer) was
therefore *never live on www.aimplifi.app*, so a `type`-flip on the deployed site
cannot have caused anything the owner saw there. It remains a possible cause only
if the owner was testing against a local dev server. The restoration below is
still correct and still shipped; it is just no longer the leading explanation.
(The owner reported the same session that they could not see the reveal at all —
that observation is fully explained by the same unpushed-branch fact.)

**Also corrected: the repo is PRIVATE** (`githubRepoVisibility: "private"` on
every production deployment record), which de-escalates the secrets item below
from "publicly exposed" to "committed where it should not be".

**New leading hypothesis (LABELLED — unconfirmed) + its check.** What WAS newly
live on the deployed app is #257, the reset flow, and it has two verified
properties that compose into exactly the reported sentence: a completed reset
bumps `sessionEpoch` and signs out every session by design, and the reset form
does *not* sign the user in afterwards — it links them to /sign-in. So after
resetting, the browser meets a sign-in form and autofills the **old** saved
password, because nothing ever offered to save the new one. "It's just not
remembering the password I entered earlier" is a precise description of that.
**Check:** have the owner open their browser's saved-passwords list and compare
the stored entry for aimplifi.app against the password they most recently set. If
the stored one is stale, the fix is on the reset form (make the browser offer to
update the credential), not on the sign-in field.

**Superseded hypothesis, kept for the record:** a password manager can stop
offering to save a credential when the field's `type` flips away from `password`,
which is what #258 introduced on all three forms.

**Shipped 2026-07-21 (#261) — a precautionary RESTORATION, not a claimed
diagnosis.** Per CLAUDE.md rule 0 ("when the app is broken, restore a known-good
state first"), `PasswordInput` now re-hides itself in a capture-phase `submit`
listener on its own form, so the form the browser inspects at submission carries a
real `type="password"` field exactly as it did before the viewer existed — while
keeping the viewer the owner asked for. Locked by `auth.spec.ts` "a visible
password is hidden again before the form submits" (toggle to `text` → submit →
assert `type` is `password` and `aria-pressed` is `false`).
**What this does and does not establish:** it removes #258 as a *possible* cause
by construction, and the DOM state is executed-and-verified. Whether the browser
now offers to save again is **UNVERIFIED** — no password manager runs in this
environment, and only the owner can confirm it on the real device.

**Still ask the owner (never describe a screen we haven't seen):**
(a) a screenshot of where it fails; (b) whether the prompt that's missing is the
BROWSER's "save password?" or the APP's sign-in rejecting it; (c) the exact
on-screen message, if any; (d) which browser/device; (e) which env vars were
changed today (names only, never values) — **(e) is now the highest-value
question**: `AUTH_SECRET` is the JWT signing key, so *rotating it signs every
device out at once*, which reads exactly like "it stopped remembering me". That
mechanism is env-caused and entirely separate from the field-`type` one above,
and the two have different fixes.

## 🟠 OPEN — two real secrets are committed to git (repo confirmed PRIVATE; owner: decide on rotation)

`docs/DEPLOY.md:54–55` carries literal generated values for `AUTH_SECRET` and
`DATA_ENCRYPTION_KEY` ("provided for you"), committed in `ca23eac` (2026-06-21)
and never removed, on a branch pushed to `github.com/meleesciony/Aimplifi`.
Verified by `git log --all -S`: one commit introduced them, none removed them, so
they are still in HEAD *and* in history.

**RESOLVED, same session:** the repo is **private** — every production deployment
record carries `githubRepoVisibility: "private"`. So this is not a public
exposure. It is still a real hygiene failure (a secret in version control is
readable by every current and future collaborator, every CI integration granted
repo access, and anyone who ever clones it), and the values should be treated as
burned. Still unknown from here: whether the deployed project actually uses these
exact values — DECISIONS #198 records only that Production already had the
variables set, not what they were set to.

**If the values match production**, anyone with repo access can forge a
signed session JWT for any account. Rotation order matters and each step has a
visible cost, so it is owner-gated:
1. Rotating `AUTH_SECRET` signs every device out (expected, harmless) and kills
   outstanding password-reset links (`RESET_TOKEN_SALT ?? AUTH_SECRET`).
2. Rotating `DATA_ENCRYPTION_KEY` makes every stored Plaid/SimpleFIN token
   undecryptable (`src/lib/crypto.ts` AES-256-GCM), so connected banks must be
   re-linked. Do not rotate this one casually.
3. Removing the values from `docs/DEPLOY.md` fixes HEAD but not history; the
   values must be treated as burned regardless.


## ⚠️ OPEN — Ask parser/vocab, remaining items (post-2.7)

The #226 escalation is fully **RESOLVED**: TASKS 2.6 shipped 2026-07-12 (#229) and TASKS 2.7
shipped 2026-07-14 (#230; §Wave 2.7 below) — escalation items 3 (largest merchant scope) and
4 (bare-year/numeric-date windows) now earn real answers. Still open, each honest-but-
unanswered (no wrong number is ever shown):

1. **The weekly vocab re-check cannot distinguish the classifier answering "none" (a real
   disagreement) from a network fault**; both mean "no opinion, no change", so a rule the
   resolver now considers unanswerable keeps serving. (Escalation item 5, unchanged.)
2. **Tier-1 synonyms inside store names — ATTEMPTED as TASKS 2.8 (#231), found
   MERCHANT-DB-BLOCKED, and REVERTED (tree back at #230).** "at travel lodge" → the Travel
   group, "at total wine" → alcohol, "at 24 hour fitness" → fitness: a curated synonym inside a
   store name outranks the merchant reading and answers the whole CATEGORY. Note the failure
   class: the category is a **superset** of the store, so this is a nonzero, wrong-SCOPE figure
   — never a $0. The 2.8 slice tried to route these to `merchant_spend` by detecting a
   "distinctive" store token adjacent to the synonym (a `resolveSpendTarget` guard aligned with
   `extractSpendMerchant`, span-based synonym coverage, curated tail/modifier sets). **Three
   fresh-context Fable critic cycles proved the approach unsound.** The decisive finding:
   "SHELL gas station" (a brand) and "FANCY gas station" (an adjective) are structurally
   identical `[X][synonym][tail]`, and **no lexicon or structural rule separates a brand token
   from a generic modifier — that IS the merchant-identification problem** (the same dependency
   as item 3). Worse, the precision fix **regressed common, currently-correct category
   phrasings into confident $0 fabrications**: "at gas stations" (plural) → "No spending at Gas
   Stations", "at the fancy/big/old/neighborhood coffee shop" → $0. Trading a common
   correct answer for a confident $0 to win a rarer store answer is a net-negative trade
   (cardinal-sin direction), so the slice was reverted rather than shipped. **CONCLUSION: this
   is the SAME class as item 3 below — closable only with a merchant database.** Until one
   exists, the safe category-superset answer stands (nonzero, directionally-correct, never a
   $0). A future *narrow* slice could soundly fix only the un-ambiguous sub-cases — possessives
   ("gold's gym") and digit-bearing names ("24 hour fitness") — but every headline name
   ("travel lodge", "total wine", "shell gas station") is in the ambiguous class. Full evidence:
   DECISIONS #231; the three critic reports are summarized there.
3. **A residual licence gap by construction (now the umbrella for item 2's class too):** a
   store whose name we cannot distinguish from category/reserved words without a merchant
   database. Two instances: (a) a store spelled entirely in licence-consumed tokens ("Do It
   Best") can license the total in fronted order — the one real case is fixed and locked; (b)
   a store name that is `[brand-or-adjective][category-synonym][place-tail]` ("shell gas
   station" vs "fancy gas station") — item 2's reverted 2.8 investigation. Both need a
   merchant database; the conservative bias means new instances cost an honest redirect or a
   category-superset figure, never a wrong $0.
4. **Recorded 2.7 trades and limits** (each an honest redirect or a disclosed coarsening,
   never a wrong figure; see EDGE_CASES §Ask Timeframes / §Largest Merchant Scope): fronted
   largest objects ("At Costco, what was my biggest purchase?") redirect rather than scope;
   attributive merchants ("biggest costco purchase") redirect — resolving them needs a
   merchant database; single idiom-word stores ("at Max") cede to the idiom/total reading;
   "at Bank of America" redirects (account words joined the #168 set); verb-order "at do it
   best" still truncates to merchant "do" ('it' is a phrase-ending total word — pre-existing);
   day-granular windows ("on 3/5" as a DAY) deferred — `Timeframe` is month-granular, and the
   widening ripples through `SpendingBreakdown`/trends parity; category-scoped largest
   ("biggest grocery purchase") redirects — no engine computes it.

## 2026-07-02 — Checker CYCLE 4 (wf_4cb0ba46, FINAL under the 4-cycle cap): 9 confirmed (1 P1 + 8 P2), 1 refuted → HARD STOP, OPEN FINDINGS
Per the build-loop rule (4 critic cycles per phase, then STOP and ask the human), these are recorded
OPEN, not fixed. The cycle-4 checker's verification was unusually rigorous: the P1 was empirically
probed twice (finder + independent verifier), and three P2s were proven by revert-stays-green runs in
scratch copies.

**OPEN P1 — forced-review dissolve is clobbered by the NEXT sync.** The dissolve writes
needsReview:true + confidenceBps:null but leaves NO durable marker; the preserve predicate
(corrected && !needsReview) is structurally false for a dissolved row, so the 5-day-overlap re-send
(daily cron) re-applies the rule verdict: needsReview:false/9900 — the triage card vanishes within
one cron interval and the full drifted amount silently auto-files. EMPIRICALLY PROVEN (probe:
sync N = review/true; sync N+1 = auto-filed/false). Plaid's dissolve sites share the hole on
modified[] re-sends. Root cause: a dissolved row is representationally identical to an UNDONE row,
and the cycle-1 rule ("an undone row takes the fresh verdict") correctly wins. Proposed fix (needs
owner sign-off — SCHEMA CHANGE): a `reviewPinned Boolean @default(false)` on Transaction — set by
every dissolve, respected by the preserve predicate (preserve = isSplitParent || reviewPinned ||
(corrected && !needsReview)), cleared by every user filing action; plus multi-sync locks (assert
review SURVIVES a second identical re-send) at all three dissolve sites. Mitigation until then:
the defect needs {pending split + amount drift + merchant rule} AND is in the UNPUSHED stack only —
production is unaffected today.

**OPEN P2s (8):**
26. Reconcile dissolve fires on FALSE staleness — a per-row parse failure (garbled amount) drops the
    ref from the corroboration set, dissolving a still-reported split. Cheap fix: record txn.id into
    the returned-ref set in the parse-catch arm (skip-ingest must never imply dissolve).
27. Same-id transient absence (one flaky snapshot) dissolves a still-real pending split immediately in
    pass 1. Design alternative the checker validated: split parents dissolve only in the pass-2
    age-out (≤32d bounded double count — the SAME residual bound #128 already accepts) — the
    immortality P0 stays closed. Owner taste call: immediate-dissolve (current) vs age-out-only.
28. Plaid same-id split-drift dissolve (plaid.ts:404) has NO lock — proven: reverting it runs
    1546/1546 green in a scratch worktree. Fix: clone the transplant-drift test with a modified[]
    same-id payload.
29. Wiring lock pins call-presence only; triage-actions.ts has no source pin (partial re-strip of
    applyCategory's tx stays green). Harden: extend the pin with a 3-site interactive allowlist.
30. Wiring source pin is comment-satisfiable and misses non-async interactive callbacks — both
    evasions demonstrated on scratch copies. Harden: count non-comment lines; drop the async literal.
31. Supersede leaves Correction.becameRuleId dangling at the deleted rule; makeRuleFromCorrection's
    early return can report a dead ruleId without minting (UI can't reach it today). Fix: existence
    check in the early return (also covers future dangling sources).
32. P2025 skip-on-null + rule.create/rule.reuse audit gating have no locks (revert-stays-green
    proven, 1547/1547). Cheap locks via the '@/lib/db' mock seam + an audit-action assertion.
33. reconcilePendingTransactions' function-header Safety doc still states the PRE-#147 invariant
    ("split parents are excluded") — actively argues for restoring the P0. One-line doc fix.
Refuted (1): the becameRuleId-liveness variant that claimed UI reachability (duplicate of 31's
unreachable half).

## 2026-07-25 — L.14 an unshared account stops claiming to be fresh (critic cycle 1: 2 P0 + 6 P1, 4 P1s OPEN)

**Shipped (commit a16f9e4).** Plaid Link update mode ships with `account_selection_enabled`, so a
user can untick an account. Nothing pruned the row, so it kept its last balance, kept counting
toward net worth / cash-needed / /cards, and kept reading as freshly synced because its BANK was
still syncing (#293) — and it could not be deleted, since the refusal's premise ("the next sync
would bring it back") is false for a row the feed no longer sends.

Additive `Account.feedDroppedAt`, stamped by a pure `reconcileFeedPresence` from a complete
`/accounts/get` census only. Never from the `/transactions/sync` echo (it carries only accounts
with transaction activity, so absence there would have frozen every quiet loan, card and brokerage
on the first sync after deploy), never on an empty or unreadable list, never re-stamped, cleared
when the account returns. New `not_shared` freshness level graded from the drop; Delete permitted;
disclosure on /accounts and the dashboard.

**Two fresh-context critics ran in parallel and both broke it.** Cycle 1 verdict: FAIL. Both P0s
and 4 of the 6 P1s are fixed and locked by executed tests (see PROGRESS.md and DECISIONS #302).
The deepest finding, reached independently by both: the "keep counting, just say so" stance had
been argued over LIABILITIES only, and the user's own PAYMENT account can be frozen, where the
direction inverts — a balance frozen high reports shortfall $0 while the real account cannot cover
the autopay.

### OPEN — 4 P1s, tracked as TASKS L.18. This slice does NOT claim a critic pass.

A feed-dropped account keeps counting by design. That is now disclosed on /accounts, in the
dashboard banner, and in the cash-needed engine's `assumptions`. These surfaces still print
figures derived from a frozen balance with nothing said, ranked by money consequence:

1. **/cards** — `finance.ts` builds the dashboard accounts payload as an explicit 5-field list
   that drops `feedDroppedAt`, and /cards renders no assumptions block, so a frozen card can print
   "pay $X by DATE" from a stale statement-substitute.
2. **The weekly digest email, the reminder email and web push** — each composes its own body from
   figures derived from frozen balances, and per the L.15 lesson a channel that composes its own
   body inherits nothing from an `assumptions` array.
3. **The Ask assistant** — quotes the balance bare, and `traceNetWorthDerivation` green-checks it
   in the panel a reader opens specifically to audit the number.
4. **/coach** — a frozen balance drives the FI number, years-to-FI and runway months behind only
   the currency banner.

Deliberately not bulk-patched: pasting one sentence onto four surfaces is the L.15 failure
verbatim. Each needs copy true for what that surface can point at, plus a lock that drives the
real engine rather than a pure builder.

### Also recorded

Residuals that fail toward the pre-existing behaviour, never toward a false drop: a row whose
`plaidItemId` predates #256 is out of scope (it cannot be proven to belong to the connection), and
SimpleFIN is unwired. **UNVERIFIED against live Plaid** — no credentials in this environment;
every request shape runs against a mocked Plaid server with real Prisma.

## O.17b — DECIDED: removing a category does not stop the categorizer (2026-07-31, DECISIONS #352)

**No code change.** The behaviour question is closed: "Remove" stays a picker preference, and the
disclosure O.17 added is the resolution rather than a placeholder. Reasons in full in DECISIONS
#352; the short version is that one of the two proposed destinations does not exist
(`Category.parentId` has never been populated; `group` is a string, not an assignable row), and the
other — `uncategorized` — discards knowledge the engine had, asserts a false "we don't know", fills
the triage queue as a *consequence* of the reader asking to see less, and silently merges two
meanings of the needs-review class across four downstream consumers.

**Checked and NOT found while deciding:** the suspected silent mis-file — a `<select>` whose value
is absent from its own options, the #166/#170 shape — is not present. `transaction-detail-view.tsx`
falls back to an explicit "Choose a category…" placeholder when a row's category is hidden, so
saving requires a deliberate choice. Recorded because it was the concrete fear underneath the
question, and it is answered.

## W.10a — the trailing sentence is gated on the arithmetic (2026-08-01, DECISIONS #365)

Follow-on to W.10, made after that slice had already been committed and deployed by a
concurrent session in this checkout.

### What was wrong on production

The opportunity list's basis paragraph carries a sentence for readers whose figures land below
the money they hand over — without it, a total under the contributions reads as a bug. It was
gated on `inflationBps >= nominalBps`, a rule about the two dials. Executing the sweep instead
of trusting the rule:

- **1,579 horizon-cases** (return 0–15.00% x inflation 0–10.00%, 25bps steps, three horizons)
  have inflation strictly BELOW the return assumption and still trail the contributions.
  10.25% against 10.00% trails by 62% at thirty years, with the sentence silent.
- **149 dial pairs** trail at ten or twenty years but not at thirty, so "every figure" and "the
  shorter horizons" are two claims, not one with a soft edge.

Each annuity dollar is invested for less than the whole horizon while the deflator runs all of
it, so break-even sits well above equal dials and moves with the horizon.

### The fix

`opportunityValueTrailsContributions` computes the relation from the same engine the figures
come from, asked once per horizon; the copy has three branches. Amount-independent, so one
card-level sentence stands for every row — proven over the whole grid at three amounts rather
than asserted. `OPPORTUNITY_HORIZON_MONTHS` gains one author so the sentence cannot describe a
different set of horizons than the rows print.

"at or below" rather than "below" is load-bearing: the predicate is exact and the display is
rounded, so at 14.00%/8.00% over ten years a $2.50/mo row trails by under a cent and prints as
exactly what was paid in. The sweep caught the tie; reading the sentence would not have.

### Gate

`bash scripts/verify.sh` → **VERIFY GREEN**: tsc 0, eslint 0, **5513 unit / 334 files**, build
clean. Affected e2e serially on the fresh build: 21/21 (phase3-coach, auth, mobile-overflow).

### Honest status of the critic requirement

Two fresh-context cycle-2 critics were launched and **both died on a platform session limit**
before returning findings. Everything above came from running their assignment by hand, which
is weaker than an independent pass because the checks were chosen by the author of the code.
W.10 has had one full critic cycle (#363's two critics, both FAIL, converging independently on
two P1s); W.10a has had none. A second pass over `opportunityBasis`'s branches is owed and is
filed, not waived.

**Deploy-verified.** `npx vercel ls aimplifi --meta githubCommitSha=926e94c…` returns exactly
one production deployment, `aimplifi-kdwy902zz`, status ● Ready — and `npx vercel inspect` on it
lists `https://www.aimplifi.app` among its aliases. The commit-sha filter is the proof rather
than a 200: an old deployment answers 200 perfectly well.

## W.10a critic cycle — the owed independent pass (2026-08-01, DECISIONS #366)

#365 shipped W.10a and recorded that both cycle-2 critics had died on a platform session limit,
so the findings came from running their assignment by hand and an independent pass was owed.
This is that pass, from a fresh context.

### The branches held

Every claim #365 makes about `opportunityBasis` survives execution over the whole permitted dial
grid (return 0–15.00%, inflation 0–10.00%, 25bps steps):

- The `trails` array is always a **prefix** — 0 of 2,501 pairs trail at a longer horizon without
  trailing at every shorter one. The mixed branch's "the shorter horizons" was an unproven
  monotonicity claim when it shipped, and it is true. Exactly four patterns occur:
  `[F,F,F]` ×1,037, `[T,T,T]` ×1,315, `[T,F,F]` ×84, `[T,T,F]` ×65.
- "at or below" survives the **rounded display**: 0 violations at five amounts down to $0.01/mo,
  with 12 exact ties — the knife-edge #365 predicted.
- The sentence is gated on the same rate pair the rows were computed with, and no other surface
  prints these figures.

### The P1, one function above

`COACH_COPY.opportunity` — the ROW sentence, which prints all three figures — still ended
"compounding does the work, not willpower", guarded only by `nominalReturnBps === 0`. #363 had
recorded the reasoning for that guard explicitly: *"the only degenerate input is the reader's own
0.00% return dial."* W.10a's sweep is a disproof of that sentence, and it was applied to the
paragraph while the claim one function above was left standing.

Of the **2,400 non-zero** dial pairs `validateDials` permits, **1,275 put every printed figure at
or below the dollars handed over** and 149 more put one or two there. At 10.25%/10.00% a $50/mo
row printed **$6,833.08 against $18,000 paid in** and credited compounding with it. Reachable from
the DEFAULT return dial: keep 7.00% and set inflation to 3.75% and the ten-year figure trails; at
4.25% all three do. The card contradicted itself — the row crediting compounding, the paragraph
beneath saying inflation took more than the growth added.

Fixed by `opportunityRowTrailsContributions`, which reads the row's **printed integers** rather
than re-deriving from the dials. The trailing branch drops the payoff and adds nothing in its
place; the paragraph carrying the explanation renders under the identical gate.

A test was certifying the defect: the zero-return test closed with *"…and the ordinary branch
still says it"* on a fixture whose ten-year figure was itself below its own contributions. The
fixture now carries real 7.00%/2.50% figures.

### Gate

`bash scripts/verify.sh` → **VERIFY GREEN**: tsc 0, eslint 0, **5518 unit / 334 files** (from
5513/334), build clean. `phase3-coach.spec.ts` 1/1 serially on that build, with a new render-site
assertion that the demo — a pair where nothing trails — still shows the clause.

Both new locks mutation-proven in both directions: disabling the guard kills two tests, forcing
it to fire always kills three.

### Residual, not fixed

A $0.01/mo row ties its contributions at ten years for 12 dial pairs where the list sentence
stays silent. No opportunity kind can mint a row that small (the smallest is a detected series or
a hard-coded $20.00 retention offer), and a figure equal to the deposits does not read as a bug
the way one below them does.

## C.23/H.4 — reserves are a Fixed cost the reader declares (2026-08-05, DECISIONS #412, critic cycle 1 done)

**Shipped.** A reserve (sinking fund) is a `Goal` row with `kind='reserve'` plus an
additive nullable `Goal.cadence`, storing the TRUE COST once per rhythm; the app
divides. It counts as FIXED, appears as its own line kind in the C.19/H.3 Fixed
list, and is declared on /spending-plan. H.4's two acceptance locks are executed:
the reserve renders at cost/12 beside the mortgage (e2e, through the real form),
and it LEAVES the `plannedSavingsCents` max as it enters Fixed, with the plan
identity holding to the cent on all five bases (unit, through the real loader).

**Three fresh-context critics: 1 P0 + 5 P1 + 4 P2, all executed and all fixed.**
See PROGRESS.md and the 8 REGRESSION_LEDGER entries.

### OPEN after C.23/H.4, ranked

1. **The guided half of C.23 is not built.** The owner asked for a settings
   section that PROPOSES lines from `detectRecurring`/`RecurringSeries` so he
   confirms and edits rather than types, plus one "move this much to reserves this
   month" figure with a named holding account. Today every reserve is typed by
   hand. C.23's row stays `[~]`.
2. **A reader whose ONLY reserve is refused still reaches "Fixed & recurring
   expenses (none counted)" and a "See your recurring bills" control** that cannot
   reach the thing they declared (copy critic P2). Mitigated on the surface that
   matters: /spending-plan names the refused row directly below, with its own
   remove control. Closing it properly needs a refused-count on `SpendingPlan`,
   which the label author would then read.
3. **Refused reserves are surfaced on /spending-plan only.** `refusedReserves`
   lives on `SpendingPlanWithNotes` and is rendered at one call site, so /budgets,
   the dashboard and Ask say nothing about a declaration the reader made. No
   figure is wrong — a refused reserve is in no total — so this is an absence of
   disclosure, not a false claim.
4. **Two reserves with the same name and amount both count, with no warning.**
   Nothing enforces uniqueness; the two lines are order-indistinguishable and only
   the delete control's id separates them (security critic P2-6).
5. **The reserve fact is stated twice on one panel** — once in the row label's
   "+ reserves you declared" suffix and once in the Glass-Box clause two lines
   below (copy critic P2). Both are true; neither is redundant on every surface,
   which is why it was not collapsed.

## K.5 — the ten red e2e assertions, and the disclosure one of them was hiding (2026-08-06)

**Shipped.** K.1's full-suite gate found ten deterministic e2e failures and the task row
attributed all ten to `2e3bf72` (#369, "Home polish", 2026-08-01), which removed
`PaymentRemindersCard`, `RecurringSummaryCard` and `AskAimplifiCard` from the dashboard.
All ten reproduce, serialized, against a fresh build. **Eight are #369. Two are not.**

### The premise that was wrong

`phase2-triage.spec.ts:132` fails on `expected "10", received "11"` — a triage queue that
never advances — and has no dashboard dependency of any kind. The cause is O.17's demo
fence: `createCustomCategory` returns `DEMO_ENTRY_BLOCKED` for the shared demo user, both
tests sign in as demo, and both then create a category. `:184` does the same and is masked
behind `:132` by `mode:'serial'`. Split out as **K.6**; the fence is correct and stays.

The three components are **orphaned** — no render site anywhere — so nothing "moved," and
each assertion had to be judged on the claim it guarded rather than on its selector.

### The regression the red tests were hiding

`frozenNothingDueNote` composes the L.19/L.20 sentence naming a frozen card, a frozen dated
loan, or an undatable frozen mortgage — rows an "all clear" cannot honestly cover. It was
spliced onto the tail of `NudgeFeed.emptyReason`, which the Today feed renders **only in its
empty branch**. That was safe while the reminders card rendered the same sentence in its
list branch. #369 deleted that card, so from 2026-08-01 one live card being due today
removed a frozen mortgage from every page in the web app, leaving the weekly digest **email**
as the only surface that named it — precisely the gap all three L.20 critics found
independently, reintroduced by deleting a renderer rather than by editing an engine.

Fixed by promoting it to its own `NudgeFeed.frozenDueNote`, rendered unconditionally beside
`fundingFrozen` — the other half of the same disclosure, which had been a separate ungated
field since L.20 for exactly this reason.

Nothing could have caught it: the nudge engine had **zero** `frozenDues` coverage (the field
appeared only as `frozenDues: []` in a fixture builder), so the composition was asserted
nowhere and its single renderer could be deleted in silence. Five locks now exist; the
regression one is sabotage-proven RED by re-gating the field on an empty feed.

Also corrected: `cards-breakdown.tsx` narrowed its all-clear to cards on the stated grounds
that "the two surfaces whose all-clear covers both are the dashboard reminders card and the
weekly digest" — a delegation to a surface deleted five days earlier, and a cross-file
invariant with nothing enforcing it.

### Where the eight went

/cards took the duplicate disclosure and the undated-card section; /calendar took named card
**and loan** dues (the Today feed's `payment_due` row names no account — `Proposal.merchant`
is null for that kind — so Home could not take it); the Today feed took the frozen note and
the zero-balance-undated fence; `dashboard-recent-empty` took the sparse-card invariant from
the recurring card that used to sit in that slot. One was deleted with a note in its place,
because Home deliberately no longer claims a recurring total.

Two of my own re-points were wrong and the tests caught them before they shipped: /cards
makes the **total**-claim, not the reminders card's instruction-claim (correctly — it prints
`scenario-required` directly above the box, so the L.15 "where is the reader standing" rule
is satisfied), and the demo Auto Loan is not due in the pinned month at all, so the calendar
assertion had to step to the next month rather than assert a loan the fixture cannot show.

### Gate

tsc 0 / eslint 0 / **6,166 unit + 1 skipped across 374 files** (from 6,161/374) / build clean.
The eight re-pointed specs: **34/34** serialized.

### OPEN after K.5, ranked

1. ~~**K.6 — the last two reds.**~~ **CLOSED 2026-08-06 — and there were THREE, not two.** See
   §K.6 below. Two corrections to what this item claimed: the file's true red count could not
   be read off a serial run (a failure masks everything behind it — four tests never ran, and
   one of them, `Skip for now`, was independently red on declaration order); and "until it
   closes, `VERIFY_E2E=1` still cannot exit 0" was true but not because of K.6. It still cannot
   exit 0 — see §K.8.
2. **`/recurring` has no nav-level entry point.** Its only link in the whole app lived on the
   orphaned `RecurringSummaryCard`. The route is still reachable from a transaction's detail
   view and from /spending-plan, so no figure is wrong — this is a navigation question for the
   owner, recorded rather than fixed.
3. **A shipped fence has now left the full suite red three times** (#244, K.3, K.6) because
   `VERIFY_E2E=1` is opt-in locally. **The proposed remedy here — "a cheap grep-level guard for
   demo-driven writes in specs" — was assessed under K.6 and REJECTED; do not re-propose it.**
   A spec file mixes demo and throwaway users per TEST, so a file-level grep cannot tell which
   sign-in a given test used: run against the suite it flagged `transactions.spec.ts`, which
   already uses throwaway users for both its write-in tests and even carries an explicit
   demo-fence test at `:529`. The real guard is not missing — `.github/workflows/verify.yml`
   has been running the full `VERIFY_E2E=1` gate on every push the whole time, and it has been
   FAILING on every push. Nothing in the loop reads it. That is §K.8.

### K.5 addendum — a re-point that passed for the wrong reason (2026-08-06)

The deploy proof caught what the local suite did not. My re-pointed
`payment-reminders.spec` assertion read `calendar-list` for the string
"Auto Loan" and passed locally — against a **detected recurring series**
(`Auto loan — CarMax`, `scheduled` badge), not the `loan-due` obligation the
#134 claim is about. It would have stayed green if loan dues were deleted
outright.

Verified on production across Jun/Jul/Sep/Oct/Nov 2026: no month paints a
loan due. That contradicts the seed's own design note
(`src/lib/seed/build.ts:550`), which removed the hand-authored auto-loan
scheduled row precisely because the loan account "drives a first-class
loan-due obligation on the calendar + reminders (#134)". Recorded as **K.7**
and RESOLVED 2026-08-10 (DECISIONS #437): the obligation owns the payment —
a detected scheduled row C.25 has proven to be that payment yields on
/calendar, /forecast and /radar (one pure engine, `splitLoanCarriedScheduled`,
suppression capped 1:1 per proven fact), and the radar's overlap disclosure
names only what survives. /calendar now paints `Auto Loan due` with the `due`
badge — the very assertion this note said could not exist.

**CI on the resolution:** the first shipped run (324c717) failed the new
forecast lock on **run 31357353819** (suite pollution: the recurring detector
persists a `CarMax Auto Finance` row for the shared demo, so the K.7 fixture
saw two detected rows for one fact). Fixed in e4721d4 (fixture fence),
**run 31359227811 SUCCESS**; deploy verified 7/7 via the build-id
discriminator (PROGRESS.md 2026-08-10).

**Flake ledger, run 31360315737 (sha cdf0ed2, docs-only):** attempts 1 and 2
failed `tests/e2e/transactions.spec.ts:638 › CSV import (H.2): re-importing
the same file adds nothing` at two different assertions (line 698 dedup,
line 664 first-import render), attempt 3 **SUCCESS**. Not a test this push
touched (`git diff` on the spec = 0 lines across the entire K.7 chain; last
spec change is K.4-era `79abf43`), and the identical app tree passed the full
gate on e4721d4 (run 31359227811). Recorded per §K.8 as a pre-existing
timing flake, not a K.7 defect.

**Flake ledger, run 31362750997 (sha b673bca, docs-only):** attempt 1 failed
`transactions.spec.ts:638` at line 664 (first-import result never rendered).
Same harness class; recorded, not a K.7 defect. After three failures of this
test in four identical-tree attempts, the retry windows were raised 30s→90s
and the two import tests got `test.setTimeout(240s)` (commit 29b5a0d, the
playwright.config:31 stall class is ≥60s — the 30s windows were shorter than
the stall they were meant to ride out, and the 60s config timeout would have
killed the 90s windows without the per-test override).

**Flake ledger, run 31363585943 (sha 29b5a0d):** attempts 1 and 2 failed two
DIFFERENT tests — `category-rename.spec.ts:110` (hidden-count after reload,
attempt 1) and `mobile-overflow.spec.ts:386` `/forecast @360 overflow`
(attempt 2, the exact test C.18 already named as the timing flake; the same
run's [mobile-380] project PASSED the same test at 07:13:05 while
[mobile-webkit] failed it at 07:16:03 — same tree, one project green, one
red). Both isolated-proven on this exact tree: **17/17 locally (26.9s)**.
transactions.spec.ts:638 (the test this push actually touched) PASSED both
attempts — the 29b5a0d hardening worked. All four failures across the three
runs are different tests on app trees byte-identical to the 06:05 full pass
(31359227811) — a degraded CI environment exercising the documented
4-worker shared-SQLite / WebKit-layout harness classes, not a K.7 defect.

**Flake ledger, run 31366324555 (sha 09d7fad, e2e-window + docs):** failed
`recurring-verdict.spec.ts:61` at line 84 — the markRecurring server action's
router.push navigation to /transactions/[id] stalled past a 20s waitForURL.
The error-context page snapshot shows a HEALTHY /transactions with the action
menu open and the Recurring… menuitem active — no error state, the navigation
just never arrived: the ≥60s server-action stall class (playwright.config:31).
The push-touched test (mobile-overflow, whose poll window this push raised
4s→8s after run 31363585943) PASSED on BOTH projects. Not a test this push
touched; passed 06:05 on the byte-identical app tree. Fix in ba60293: the
navigation window raised 20s→90s + `test.setTimeout(240s)` (the 90s window is
unreachable past the 60s config timeout without it).

**Flake ledger, run 31367228157 (sha ba60293, e2e-window):** failed
`transactions.spec.ts:638` at line 715 — a NEW line for this test: the SECOND
import's server action ran past the 90s window. The result panel stayed on the
first import's text across all 14 toPass polls — the submit button never left
`pending`, so the re-submit retry could not fire; the snapshot shows a stale
result, not a fresh one, so nothing was duplicated (the register assertion at
line 723 is the authoritative proof). Same class as 31360315737 attempt 1
(check-then-act race) but this time a pure >90s stall — the documented ≥60s
class is unbounded above. The push-touched test (recurring-verdict) PASSED;
not a test this push touched. Fix in b8dbe8b: second block window 90s→180s,
per-test budget 240s→480s (both windows + overhead must fit inside it).

**RESOLUTION, run 31368294618 (sha b8dbe8b): SUCCESS.** The full
VERIFY_E2E=1 gate passed — the first green read since the 06:05 pass
(31359227811). Each of the four hardening commits (29b5a0d, 09d7fad,
ba60293, b8dbe8b) fixed its targeted test on the next run; the failures
hopped between four different tests in documented harness classes on an app
tree byte-identical to the 06:05 pass, so no app code changed all morning.
Deploy verified 7/7 via the build-id discriminator on b8dbe8b
(`node scripts/k7-live-deploy-check.mjs`).

**Flake ledger, run 31369410049 (sha c884f32, docs-only — K.7 close-out):
CLOSED PER §K.8.** TWO tests failed in one run — the first multi-failure
run — on a push that touches no app code (docs/STATUS.md, PROGRESS.md,
deploy-check constants):

- `combine-connections.spec.ts:67` @ line 108: after the
  `combine-connections-confirm-yes` click (server action), the net-worth
  card stayed at `-$2,000.00` across 43 polls / 20s — the client never
  received the action's re-render (severed-flight class; the page snapshot
  is healthy, the value is the stable pre-click state). This test has no
  bounded-retry structure on the confirm click — the weakest remaining
  window shape in the suite. Passed both 06:05 (31359227811) and 08:00
  (31368294618) on this byte-identical tree.
- `transactions.spec.ts:638` @ the second-import toPass: the SAME mode as
  run 31367228157 — the second import's server action produced no
  client-visible result even inside the 180s window (the result panel kept
  the first import's text across all polls). The ≥60s documented stall
  class is unbounded above; 90s→180s did not converge, so no further
  window raising is attempted. Register assertion (:723) is the
  authoritative proof; the snapshot shows a stale result, nothing
  duplicated.

Close-out rationale (the §K.8 clause, applied): every failure in this
morning's chain is on a test NOT touched by its push, on an app tree
byte-identical to TWO full green gates (31359227811 at 06:05, 31368294618
at 08:00) — i.e., proven pre-existing, not caused by any push this chain
shipped. The K.7 slice's own gate reads are green and its deploy is proven
live 7/7. The open issue is NOT the K.7 code — it is the e2e harness
itself: 4-worker shared-SQLite on GitHub-hosted runners is unreliable
under heavy load (9 failed reads today across SIX different tests, all in
the documented classes at playwright.config:31). Follow-up candidate
(TASKS): worker-isolated databases or workflow-level retries for the e2e
step — window raising has hit its limit; the harness needs a real fix.

**Flake ledger, run 31370372607 (sha d35223d, docs-only close-out):**
`transactions.spec.ts:367 › transaction register paginates: Next advances to
page 2` — `page.toHaveURL` failed (24.1s) with `[WebServer] Error: aborted`
immediately after: the navigation request was aborted at the transport level
under load, a SEVENTH distinct test this day (transactions:638, :367,
category-rename:110, mobile-overflow:386, recurring-verdict:61,
combine-connections:67, + the CSV second-block modes). Untouched by the
docs-only push; passed both green gates (31359227811, 31368294618) on the
byte-identical app tree. Recorded per §K.8 — ten failed reads today across
seven tests, every one in the documented harness classes, none caused by
its push. The §K.8 close-out above stands; the harness fix (worker-isolated
e2e DBs or workflow-level retries) is the follow-up, not more windows.

**Flake ledger, run 31372410140 (sha 2ff4475, script-only):**
`transactions.spec.ts:638` again — the second-import block failed for the
THIRD consecutive run (31367228157 at 90s, 31369410049 at 180s, now
31372410140 at 180s, 3.1m), same signature: the second import's server
action never produces a client-visible result while the first import always
completes within its window. The same test passed 4× earlier today
(31363585943 ×2, 31366324555, 31368294618), so it is intermittent, not
deterministic — and no window converges (30s/90s/180s all exceeded), which
is the documented unbounded stall class. Eleventh failed read today;
untouched by the script-only push; byte-identical twice-green tree. The
§K.8 close-out stands. The harness fix is now unambiguously the required
next slice — the window-raised test itself is fine; the 4-worker
shared-SQLite e2e harness on GitHub-hosted runners cannot reliably pass a
server-action-heavy suite, and no amount of per-test window raising fixes
that (TASKS: worker-isolated e2e DBs or workflow-level retries).

**Flake ledger, run 31373586981 (sha 0f0f213, docs-only):** TWO tests
failed — `category-rename.spec.ts:110` (the FIRST repeat of a previously
recorded failure — it also failed attempt 1 of 31363585943; both attempts
of that run's retries passed it, and it passed both green gates) and
`transactions.spec.ts:638` (the second-import block, FOURTH consecutive
run). The environment now fails multiple tests per run, including repeats —
the ledger's own prediction. Twelfth failed read today; docs-only push;
byte-identical twice-green tree; both tests recorded above. The §K.8
close-out and the harness-fix follow-up (worker-isolated e2e DBs or
workflow-level retries) stand unchanged. Note for the harness slice:
Playwright `retries` is unset (default 0) — a `retries: 2` config would
likely absorb SOME of these (each observed failure passed on another
attempt), but the 4-worker contention persists during a retry, so it is a
mitigation, not the fix; evaluate it inside the harness slice with its own
verification, not as a gate-semantics change shipped mid-close.

**RESOLUTION, run 31374649135 (sha 873812e, docs-only ledger): SUCCESS.**
The full gate passed again — the second green read after the close-out
(also 31371331555 on 41dcfba). The day's reads on the byte-identical app
tree: green at 06:05, 08:00, 08:47, 09:38; red in between on
environment-class failures. The ledger above stands complete through run
31373586981 (twelve failed reads, eight tests, all pre-existing harness
classes); the harness fix (worker-isolated e2e DBs, `retries` evaluated as
a mitigation inside it) remains the named follow-up. The K.7 slice's own
gate reads (31359227811, 31368294618) and its deploy proofs are untouched
by any of this.

**HARNESS FIX SHIPPED 2026-08-10 (DECISIONS #438) — the stall class is now
mechanism-proven and bounded.** Two instrumented runs (request/action/statement
log inside `next start`) proved the mechanism the ledger had documented as a
class: ~40 specs open their OWN better-sqlite3 connections to the single e2e
file, and a worker seed (or concurrent server transaction) committing between
a server action's first read and first write makes the write upgrade burn the
FULL 15s busy_timeout on a doomed stale-snapshot wait (BUSY_SNAPSHOT never
clears for that snapshot). The Prisma engine serializes per connection, so
concurrent burns STACK — run 2: actions resolving at 6–19.4s (≈15s burn +
re-roll), 97 POSTs still open at run end, 3 tests failing on 20–30s
action-response timeouts; run 1: 2 POSTs never finished while the loop stayed
healthy. That is why no window raising converged: each burn multiplies every
statement queued behind it. **Fix:** the SQLite busy_timeout is now
env-tunable (`SQLITE_BUSY_TIMEOUT_MS`, default 15s unchanged for dev/unit)
and the e2e harness sets it to 500ms — a collision costs ≤500ms + one
serializableTx re-roll instead of a 15s queue-blocking burn — plus Playwright
`retries: 2` (K.8-sanctioned, verified here) absorbing the residual lottery;
a test failing after retries is a real failure that enters this ledger.
**Verification (4 local draws with the fix):** run 3: 319 passed / 1 flaky /
0 failed; full gate GREEN — tsc 0 / eslint 0 / 6,575 unit + 1 skipped / build
clean / e2e 318 passed / 2 flaky / 0 failed. Both flaky were CSV members:
transactions:638's retry-1 reproduced the EXACT CI signature locally (180s
stale-result window — the second import's action never produced a
client-visible result; the K.4 forensic proved that class never writes),
passed in 2.3s on retry — machine-independence of the class, and the retry
absorbing it. **Residual, recorded not fixed:** the C.14/C.15 severed-flight
wedge has a non-DB component (the action stalls before writing; a 500ms burn
cannot touch it) — ~1 draw in 4 locally, absorbed by retries, follow-up open
(TASKS K.10); and the combine-connections 500 is a REAL engine race
(concurrent combines at combine-connections.ts:1042, "H.6b(a) carry"), now
fast + retry-absorbed, engine-side fix as its own task. Instrument hook
deleted; evidence log preserved (run-1/run-2 full request logs, 38k lines).

**Gate read (rule 5).** CI run **31396366182 on `0114b4e` = SUCCESS, attempt
1, 12m20s** (`scripts/ci-status.sh`, exit 0) — the full `VERIFY_E2E=1` gate
on GitHub-hosted runners passed first-attempt with the fix, breaking the
day's chain of 12 failed reads on the byte-identical tree. Vercel deploy on
the same sha: "Deployment has completed" (success); the slice changes no
production behavior (Postgres path; the default busy_timeout is unchanged;
retries + spec plumbing are test-only), so the CI conclusion is the ship
verdict. Follow-ups recorded (TASKS K.10): the C.14/C.15 severed-flight
wedge's non-DB component if it persists, and the combine-connections engine
race.

The assertion is gone rather than inverted: pinning "no loan due appears"
would lock the gap in and go red the day someone fixes it.

**Deploy proof:** `node scripts/k5-live-deploy-check.mjs` → **10/10 PASS** on
www.aimplifi.app, including the discriminator (a served chunk carries
`today-feed-frozen-dues`, a string in no earlier build) and the abstention
(nothing frozen on the demo ⇒ the new paragraph is absent).

## K.6 — three reds, not two; and the fence was never the thing to change (2026-08-06)

The row said two tests were red and four were unproven. Executed rather than inspected, the
file held **three** reds, and the third had nothing to do with the demo fence.

### What was actually red

| Test | Root cause |
|---|---|
| `phase2-triage.spec.ts:132` singles mode | O.17's demo fence on `createCustomCategory` |
| `phase2-triage.spec.ts:184` write-in | the same fence, same signature at `:223` |
| `phase2-triage.spec.ts:394` Skip for now (#374) | declared AFTER `review cost`, which drains the queue |

A full-file serial run fails at `:132` and reports **4 did not run** — so `:184`, `:314`,
`:385` and `:394` were all masked, and "the true red count is 2" was a hypothesis over four
unrun tests. `--grep-invert` on both fenced tests exposes `:394`: `triage-card` not found,
queue EMPTY. Run alone it PASSES in 2.1s. It had therefore never run green in a full-file run
since #374 added it, because the two fenced tests always aborted the serial file first.

### The fix

The fence is correct and was not touched. The two write-in tests moved to
`tests/e2e/triage-write-in.spec.ts`, each owning a throwaway signup and a purpose-built
four-group queue: one 3-row group (groups sort by row count DESC, so it is deterministically
on top and the per-row mode is reachable on the first look) plus three 1-row groups, every row
with `providerCategoryId` NULL so all three suggestion paths — our pipeline, the L.12 provider
fallback, and the `unanimousProposal` last resort — are null. That last part is load-bearing,
not decoration: `:184` reaches the picker by clicking accept on a card with nothing to accept,
so an ambiguous top card is a precondition of the test, and the fixture asserts it on arrival
rather than discovering it mid-flow. `GOOSE POND BAR GRILLE` is used because
`triage-provider-suggestion.spec.ts` already proves our ruleset cannot categorize it.

`phase2-triage.spec.ts` keeps the demo queue and gains a rewritten serial-residue contract: one
ordering invariant — every test that leaves the queue as it found it comes first, the single
test that drains it comes last — replacing a per-test hand-off written around the two departed
tests. `Skip for now` moved above `review cost`.

**Sabotage-proven.** Restoring the pre-fix cycle-2 P1 shape (the `groupEmptied` flag mutated
INSIDE the `setGroups` updater, `triage-inbox.tsx:337`) turns the singles test RED at exactly
the assertion its title names — `triage-singles` count 1, the mode leaking onto the next card.
Reverted and rebuilt before the gate run.

**The one deliberate coverage change, stated rather than buried.** The singles test's original
opening was a loop that filed 1-row groups until a multi-row group surfaced, with a
`fixture drift` guard — composition-independence against a demo seed the test did not control.
The new fixture controls the composition (groups sort by count DESC, so the 3-row group is
provably on top), so the loop is replaced by a direct `toContainText('One by one')`. What the
loop uniquely guarded — that filing decrements `data-remaining` — is still asserted in the
write-in test and in `review cost`, so no claim lost a home. What DID change: the reset is now
exercised on the FIRST card rather than one reached after several filings. That is sound
because the defect is a `setGroups` updater-deferral, not a card-position bug, and the sabotage
above confirms the test still catches it from the first card. Recorded because a fixture that
removes a loop is exactly where coverage goes missing quietly.

**How the critic pass was actually run — stated because the preferred method failed.** A
fresh-context critic subagent was launched over five named attack vectors (lost coverage,
vacuity, fixture fragility, the reorder's residue, parallel-worker collisions). It ran ~45
minutes producing zero output and was stopped mid-sentence; **it returned no findings, and none
are claimed on its behalf.** The five vectors were then worked in the main thread, each closed
with executed or inspected evidence rather than assertion — the two differences recorded below
are that pass's own output. This is a weaker check than a fresh context would have been (a
self-critique cannot find what it rationalized away), so it is logged as a known gap in this
slice's review, not as an equivalent substitute.

**A second deliberate difference, found by self-critique and recorded rather than left latent:
the fixture's merchants are RULE-ELIGIBLE and the demo's top group was not.** The demo queue's
top card was the 6-row Zelle aggregate, and `ruleEligible` is false for aggregate
pseudo-merchants (Zelle/checks/ATM) so they "never offer Always rules" (#23,
`src/server/triage.ts:45`). The seeded merchants here are ordinary merchants, so
`ruleEligible` is true and filing a group now renders the `rule-prompt` panel
(`triage-inbox.tsx:317`) and a different group-card footer, neither of which the old fixture
ever produced. Nothing in either test asserts against the prompt and both pass — in isolation
and under 4-worker full-suite load — and `undo` clears it (`:444`). Net: strictly MORE of the
product is exercised, at the cost of a mild new fragility, because a future change to the rule
prompt could now break `:184` for reasons unrelated to its own claim. Named here so the next
reader does not have to rediscover it from a red test.

**The reorder creates no residue, checked two ways.** `skipGroup` (`triage-inbox.tsx:200`) is
`setGroups((gs) => rotateSkippedGroup(gs))` — and `rotateSkippedGroup`
(`group.ts:226`) is a pure array rotation with no server action and no persistence, so a skip
cannot alter what `review cost` then measures; the next test's fresh `signInToTriage` re-fetches
from the server, where the rotation never existed. Empirically the same: in the full-suite run
`Skip for now` (index 183) and `review cost` (index 191) both passed in that order.

**Descriptor ambiguity is verified, not assumed.** Grepped the categorizer's keyword rules for
every token in the four fixture descriptors — no rule matches any of them — and the fixture
additionally self-checks `triage-no-suggestion` on arrival, so a ruleset that later learns one
of these merchants fails loudly at the top of the test rather than subtly inside it.

### Gate

`VERIFY_E2E=1 bash scripts/verify.sh`, exit code taken from verify.sh itself: tsc 0 / eslint 0 /
**6,167 unit passed + 1 skipped / 374 files** / build clean / **e2e 295 passed, 2 failed** /
`VERIFY_EXIT=1`.

### CI proof — what a test-only slice can actually prove live

There is no change-unique marker to grep on production: this slice touches no `src/`, no client
bundle and no schema, so the deploy is a no-op for readers (deployment for the SHA is `● Ready`,
and the standing live check passes 10/10, but its discriminator is K.5's, not this slice's). For
a change to the test suite, the CI run IS the proof. Run 31132827368 (`e78d863`) against
31129722042 (`3994e9d`, before):

| | before | after |
|---|---|---|
| e2e passed | 291 | **296** |
| e2e failed | 2 — incl. `phase2-triage.spec.ts:132` | 1 — `category-rename.spec.ts:110` |
| e2e did not run | **4** | **0** |
| unit failed | 4 | 4 (unchanged — K.8) |

All five remaining `phase2-triage` tests and both `triage-write-in` tests pass on the Linux
runner. `did not run` is 0, so the file's verdict is complete rather than a floor.
`budget-targets:20` PASSED on CI here after failing locally and on the previous CI run, and the
single e2e failure is a DIFFERENT test — exactly the pattern `ci-e2e-timing-flake.md` documents.

### Local gate

All 5 remaining `phase2-triage` tests and both `triage-write-in` tests passed inside that run,
under 4-worker parallel load. The two non-passes are outside this slice:
`budget-targets.spec.ts:20` and `transactions.spec.ts:145`. `budget-targets:20` was already red
on CI run 31129722042 before this change, and nothing here is imported by either spec. Together
in isolation they pass 25/25 — recorded as what it is, not as proof they are sound.

## K.8 — the unit gate is environment-dependent, and CI has been red the whole time (2026-08-06)

K.6's row claimed closing it would make `VERIFY_E2E=1` green. That is false, and the reason is
larger than K.6.

`.github/workflows/verify.yml` has been running the full `VERIFY_E2E=1` gate on every push and
PR the entire time. Grouped over the last 100 runs the API returns (2026-08-02 → 2026-08-06):
**50 `failure`, 49 `cancelled` (the concurrency-cancel of superseded pushes), and 0 `success`.**
Not one green CI run in the entire window. `Skip for now` (#374) landed 2026-08-01, so it has
literally never been observed passing in a full-file run.

**The 49 cancelled are their own contributing cause, and this session demonstrated the
mechanism by accident.** The workflow sets `concurrency: cancel-in-progress: true` on
`${{ github.workflow }}-${{ github.ref }}`, and a session that pushes a code commit and then a
docs commit five minutes later kills the first run before it can reach a verdict — which is
exactly what happened to run 31132538431 here. So roughly half of all pushes produce NO signal
at all, which is a large part of why a permanently-red gate went unread: the habit of
push-then-push-docs means the run you would have looked at usually does not exist. Any fix for
K.8 should account for this — batch the docs commit into the code commit, or wait for the run.

The latest run fails **four unit tests that pass locally** — `fi-real-basis` ×2,
`loan-payment-flow-assembler` ×1, `merchant-lens-server` ×1 — so the "6,167 passed / 374 files"
that every recent entry in this file reports is a fact about the maintainer's machine, not
about a clean checkout.

**Root cause, reproduced rather than reasoned.** `businessToday()`
(`src/lib/business-today.ts:33`) gives `process.env.DEMO_TODAY` top precedence. `.env` sets
`DEMO_TODAY=2026-06-10`, but vitest does not load `.env`, so locally these tests fall through
to the real clock; GitHub Actions declares `DEMO_TODAY: "2026-06-10"` as a job-level env var
that IS in `process.env` for every step. None of the three files pins a date itself.
`DEMO_TODAY=2026-06-10 npx vitest run` on the three files reproduces all four failures
byte-identically: `expected 1 to be 3`; the FI sentence printing `your last 1 full month × 12`
where the test wants `your last 3 full months × 4`; `length of 4 but got 2`; `$50.00` where the
test wants `$60.00 in all`.

**A timezone explanation was proposed and rejected — do not re-propose it.** Local is UTC−4 and
CI is UTC, but `currentMonth = today.slice(0,7)`, so a one-day shift cannot change a month
count.

The fix is not four edited assertions. Three tests silently depend on the ambient wall clock, so
their verdicts drift with the calendar as well as with the environment; the deliverable is a
deterministic clock for the unit gate and then repairs to whatever that surfaces. It moves
money-math expectations (FI number, loan flows, merchant totals), so it takes its own slice with
a critic pass. Tracked as **K.8**.

### K.8 RESOLVED (2026-08-06, DECISIONS #422) — and the critic found a FIFTH cause

The clock: `vitest.config.ts` pins `DEMO_TODAY=2026-06-10` + `TZ=UTC` unconditionally
(process.env + test.env; executed against a hostile shell `DEMO_TODAY=2031-12-25
TZ=Australia/Eucla` — the pin wins) and blanks `XAI_API_KEY`/`ANTHROPIC_API_KEY` (the ambient
machine carries a real key CI lacks; playwright.config already did this). The three files pin
the dates their fixtures were written for — fi-real-basis C.9 and the loan assembler at
2026-08-15; merchant-lens-server now derives its fixture FROM the pin instead of a raw
`new Date()`. No hand-verified money expectation changed. Tripwire:
`tests/unit/gate-clock-pin.test.ts`.

**Two fresh-context critics.** Money-math critic: **PASS, 0 P0/P1/P2** — earned by seven
executed sabotages (expenses6×2 → RED at :994; stub removals reproduce the exact CI failures;
POSTED-filter removal → RED; C.25 disabled → RED; insurance-reshop suppressed → the W.10
escape hatches proven non-vacuous; pin fully removed → tripwire RED); 5 P3 stale-comment
corrections, all applied. Gate critic: **FAIL — 1 P0, 1 P1, 4 P2, 5 P3, all fixed or accepted
in place.** The P0 is the fifth CI-red cause: **CI ran Node 20, and jsdom's undici dependency
requires ≥ 22.19, so `spend-window-render.test.tsx` (the C.26 render harness, 14 copy
assertions) had NEVER executed on CI** — an unhandled forks-worker error on every run.
verify.yml now pins `node-version: "24"` (the local major, v24.16); a package.json `engines`
field was REJECTED because Vercel reads it to select the production runtime (blast radius).
The P1: the first draft of the new CLAUDE.md rule both mandated waiting for a `success` that
had never existed and offered a ship-past escape in the same breath — rewritten: verify.sh =
LOCAL done, CI conclusion = SHIP gate, `cancelled` = superseded (re-run against the newest
sha), and a pre-existing-failure close requires the run id + failing tests recorded here.

The unread gate: `scripts/ci-status.sh` (5 exit codes — success/failure/no-run/cancelled/
gh-broken; short shas resolved through git; a gh auth failure reports UNKNOWN, never "no run";
4 of 5 paths executed against real runs, `success` unverifiable until one exists) + CLAUDE.md
rule 5 "Read the gate, not just the deploy" + the rule 2 cross-reference.

**Gate on the final tree:** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0 / eslint 0 /
build clean); unit **6,169 passed + 1 skipped / 376 files** — same count with the pin as the
ambient run, i.e. the pin flips nothing beyond the three repaired files (the gate critic's
independent full run on an isolated TEST_DB_DIR agrees).

**CI CONFIRMED — the first `success` in the repo's recorded history.** Push `ba442f4`, run
31141077515 (read via `bash scripts/ci-status.sh ba442f4`, its success path executed live for
the first time): conclusion **success**; unit on the Linux runner **375 passed + 1 skipped
(376 files)** — byte-identical to local, which is the whole point of the slice; full e2e
**297 passed** in 6.2m, zero failed, zero did not run. Against the prior window's 50 failure /
49 cancelled / 0 success, this is the run that proves the local gate and CI now answer the
same question — and the C.26 render harness's 14 assertions executed on CI for the first time
since the file was created (Node 24).

## K.2 CORRECTION — Plaid is at the 90-day DEFAULT, not the 730-day ceiling (2026-08-07)

Owner: *"All I want is max plaid data."* The recorded answer was wrong and the new one is
measured, not inferred. Probe: `scripts/audit-probes/plaid-depth-why.mts` (read-only, live Neon).

**What K.2 said:** "Plaid is at its documented 730-day ceiling … Plaid holds no more."
**What is true:** 730 days is two years; the corpus holds ~90 days. The ceiling was never the
binding constraint — our own request was. K.2 read `historyBackfilledAt` set on every item as
"backfilled, therefore exhausted", which the flag cannot mean.

**Measured, all 12 items (not 13 — three of the 15 `plaid.item.link` audit rows were removed):**
every Item was created **2026-07-23/24**, one week before `PLAID_DAYS_REQUESTED = 730` shipped
on 2026-07-31. Plaid applies `days_requested` only where Transactions was not already
initialized, so all twelve are pinned to Plaid's 90-day default permanently. Reach-back from
link date is 67–90 days on every item holding rows.

**The backfill ran and provably bought nothing — this is the important part.** All 12
`plaid.item.history-backfill` audit rows read `windowStart: "2024-08-04"` (a correct 730-day
ask), `added: 0`, and `alreadyExists: N` equal to the rows already held (289 Chase, 392 Capital
One, 189 Schwab, …). So `/transactions/get` over two years returned ONLY the existing 90-day
window and nothing older. That is a clean, complete fetch — not an error.

**Therefore the core assumption in `plaid-history-backfill.ts` is FALSE:** its header claims
`/transactions/get` "DOES return already-delivered rows and, for most institutions, up to about
two years of them." It does not return rows outside the Item's initialized window. That file
flagged itself "UNVERIFIED against a live sandbox"; it is now verified, and it is wrong. The
backfill cannot deepen any existing Item and no amount of syncing will change that.

**The only remaining lever is remove + fresh Link**, which the code already said
(`plaid.ts:280`) and which is now the ONLY route rather than one of two. `disconnectPlaidItem`
is safe for data — it revokes at Plaid and deletes the item row, but keeps accounts and
transactions ("they just won't update"), so the 90 days already held survive the round trip and
the reconciliation boundary handles the overlap when the fresh link lands.

**Do ONE bank first.** `days_requested: 730` has never been exercised against a live bank —
every network path in `plaid.ts` carries the same UNVERIFIED note that just proved wrong once.
Re-link the smallest connection (Truist, 3 rows) and confirm it returns ~730 days before
spending the clicks on the other six institutions.

**Ceiling regardless: 730 days is Plaid's documented maximum.** Even a perfect re-link of every
bank reaches 2024, not 2023. The owner's three-year ask cannot come from Plaid at all — that is
SimpleFIN (connection currently deleted) or per-bank CSV.

## ⚠️ CI flake record 2026-08-07 — run 31189535166 (docs-only push e772d8f): failure

One failing test: `budget-targets.spec.ts:20` (`toHaveCount` timeout at :58) — the
named repeat offender in `docs/lessons/ci-e2e-timing-flake.md`, on a push whose
entire diff is PROGRESS.md; the identical code passed as a15c790 (31186804353)
twenty minutes earlier. Recorded per rule 5 (failure never silent; proven
pre-existing by diff scope). Further docs-only flakes of this same test need no
fresh record — the lesson file owns the class; a flake on a CODE push still gets
judged against its own diff every time.

## Register "still not showing up" (owner, 2026-08-07) — FIXED: the merchant filter had no control

The screenshot decided it without a database read: **Clear** was rendered (so a filter was
active) while Type/Account/Category/Class/Period/dates/search all read their defaults, and
"History available from Wed, Mar 25, 2026" proved the rows exist (that bound is computed over
the FULL pre-filter set). `?merchant=` was the only axis in the page's `hasFilters` predicate
with nothing in the filter bar — invisible, exact-matched on the display name, and set from a
dozen link surfaces, so an unmatched name reads as "the app lost my data".

Shipped: a merchant chip that names and clears it; a `merchant` kind in `registerEmptyReason`
(ordered below the window branches, blank/whitespace reads as OFF) rendering «No transactions
here match "X"» plus a link to the whole register; a table-driven render lock over ALL TEN
filter axes so the next invisible filter fails a test instead of reaching a phone. Sabotage
proven RED (chip deleted → 5 failures). Third instance of
`docs/lessons/a-zero-is-a-claim-and-must-name-which-zero.md`, appended there.

Local gate on the final tree: **✅ VERIFY GREEN** — tsc 0, eslint 0, unit **6,211 passed +
1 skipped / 378 files**, `next build` clean; new e2e `a merchant filter shows itself, names its
own zero, and clears in one tap` passed on a real build (mobile-380).

Open after this slice: (1) WHICH merchant link produced the empty set — the chip now prints the
name; the candidate mechanism is `/recurring` grouping by the normalized descriptor while the
register displays `Merchant.canonical`, and `no-dead-ends.spec.ts` checks hrefs without ever
navigating. (2) **K.2 Truist 730-day verdict stays PENDING** — the read-only probe
`scripts/audit-probes/register-zero-2026-08-07.mts` is committed UNRUN because `npx tsx` against
the production connection string was refused by the permission classifier twice this session.

**SHIP GATE READ (rule 5).** CI run **31203380818 on `d5898ad` = success**: unit **6,211 passed +
1 skipped / 378 files** — byte-identical to local — and the full e2e **299 passed** in 6.0m, zero
failed, `budget-targets:20` included. The preceding run 31200587384 on `7f70328` failed twice on
the SAME code with DIFFERENT sets (attempt 2: transactions:785 + phase4-features:33; attempt 3:
mobile-overflow:408 webkit; budget-targets:20 in both), which is what identified the class — a
bare first click after a load, dropped before hydration — now barriered with a state-GUARDED
retry in all three. Production deploy Ready; `d5898ad` touches no `src/`, so the behaviour proven
live on `7f70328` (7/7) is the behaviour running now.

## C.18 record — 2026-08-09: production-polish cohesion sweep (2138a04)

Local gate on the final tree: **✅ VERIFY GREEN** — tsc 0, eslint 0, unit **6,546 passed +
1 skipped / 396 files**, `next build` clean, e2e **319 passed** (4.0m).

What shipped: the demo-fence wave closed the last visitor-personalization write family on
the shared demo row (money dials, budget targets, the unknown-question ledger, the audit
cron skip — server refusals + a fence note on the dials form, unit-locked in
`shared-demo-fences.test.ts`); both e2e specs that drove those writes as demo migrated to
throwaway users (the budget-targets pattern); the false "precached by the service worker"
/offline shell was deleted (middleware + sw-register docblocks corrected); every app
description leads with the mission instead of the cash-needed feature (sign-in tagline,
metadata, privacy-policy intro); the privacy policy now names the one PII-free salted hash
that outlives deletion instead of claiming "nothing is retained"; the coach creep-card
title stopped being the clickable claim (the link claims only the register filter); the
register caption names its pending-included basis; the cash-needed forecast link says
"90-day recurring forecast" (forecast is recurring-only); /goals and /investments carry
the same frozen-portfolio qualifier /coach prints; forecast.ts now anchors via the shared
`resolvePaymentAccount` (D1: the drift copy disagreed on the SAVINGS fallback tier); the
"Aim·plifi" brand drift was fixed.

Gate history on the way to green (all local runs of the same tree): a first run was a
script-misuse skip (flag passed as argv, not env); a second hit my own new e2e throwaway
test (fresh user's payment-account select resets after reload and its `required` blocks
every later submit — fixed by seeding the stored payment account, exactly the demo's
shape); a third hit the two documented lottery members `category-rename:110` +
`transactions:637` (both isolation-proven solo, 30/30); a fourth found 5 failures in
`retirement-outlook.test.ts` — MY new `frozenPortfolioNote` field broke that file's mocked
`getCoachData` (mock lacked `frozenBalances`) — fixed + a lock added; the fifth was green.

**SHIP GATE READ (rule 5).** CI run **31332192499 on `2138a04` = failure — exactly ONE
failing test: `category-rename.spec.ts:110`**, the documented stall-lottery member of the
C.16/C.17 records (red there on unrelated trees, isolation-proven solo today 30/30; this
push touches neither the test nor the category-remove path). Everything else in the run —
unit, build, the other 318 e2e — green. Recorded per rule 5 (failure never silent; the
failing test is proven pre-existing by the C.16/C.17 records + solo isolation). The docs
commit carrying this record re-triggers the gate on the new sha; a fresh lottery hit on
`category-rename:110` needs no new record — the class is owned.

Live deploy proven (rule 5): `/sign-in` renders "deliberately wealthier"; `/privacy`
renders "one-way salted hash"; `/offline` answers 307 (middleware) instead of serving the
deleted shell; `/sign-in` 200.

**Second gate read (rule 5).** CI run **31332778256 on `be965ad` (docs-only: this
record) = failure — THREE tests: `budget-targets:61`, `register-return:119`,
`transactions:910`**, all in the documented 4-worker timing-flake class
(`docs/lessons/ci-e2e-timing-flake.md` — budget-targets is its named repeat offender;
the 2026-08-07 record closes docs-only flakes of it with a rerun-green proof). This
tree's code is byte-identical to `2138a04` plus this markdown file, and the local full
gate on that code ran **319/319 green**. Isolation/rerun proofs on this tree:
`budget-targets:61` failed once under a 3-file/4-worker local run, passed solo (2.6s),
passed again in the trio rerun 32/32; `register-return:119` + `transactions:910`
passed every local run including the trio. No test in either CI failure set is touched
by the C.18 diff; no new record needed for further hits of these members — the lesson
file owns the class.

**Third gate read (rule 5).** CI run **31333436087 on `c427e46` (docs-only: this record) =
failure — exactly ONE failing test: `mobile-overflow.spec.ts:386`** (the [mobile-webkit]
route sweep), a member named verbatim in the C.16 record ("the [mobile-webkit] route
sweep — 7/7 PASS in isolation on this exact tree, 22.6s") and in C.15's. The CI failure
itself named a route — `/forecast (demo) @360px overflows: scrollWidth 393 > clientWidth
360` — so it was checked as a potential real regression, not waved through: the C.18 diff
provably cannot change demo /forecast content (the D1 forecast change is identity for a
user with a designated payment account — the unit lock asserts the 'Everyday Checking'
anchor on the seeded demo; no other C.18 edit reaches the forecast page), and the sweep
passes this exact route+width on this exact tree both in the local full gate (319/319)
and solo (7/7, 22.0s, today — measured 393→fits at every width including 360). Not
reproduced in either local run; the class (CI-Linux-WebKit scrollWidth/font metrics vs
local WebKit, caught mid-4-worker-run) is owned by
`docs/lessons/ci-e2e-timing-flake.md` + the C.15/C.16 records. This tree is byte-identical
to `2138a04` plus this markdown file. The docs commit carrying this line re-triggers the
gate.

**Fourth gate read (rule 5).** CI run **31334105296 on `3b75a05` (docs-only: this record) =
SUCCESS — gate GREEN**, read via `scripts/ci-status.sh` (exit 0). The C.18 docs chain closes:
head of main is green behind the C.18 code and every record commit it carried.

## C.19 record — 2026-08-09: residual (2) MEASURED — budget-target replacement is latent on the live corpus

**The residual (TASKS C.19, re-scoped #411):** `resolveFixedCategoryAmounts` lets a
whole-category BUDGET TARGET replace the fixed-classified typical
(`fixed-category-amounts.ts:367` `const amountCents = budgetCents ?? typicalCents;`), so a
mixed category the reader priced enters Fixed at its ENTIRE allowance including its
discretionary share. The row prescribed C.0-style measurement before assuming direction.

**The measurement (this session):** wrote `scripts/audit-probes/c19-fixed-budget-replacement.mts`
— read-only, in the established probe pattern (`.env.prod.tmp` → pg → SELECTs only), replaying
the shipped `getSpendingPlan` inputs exactly: spend-account transactions (currency null|USD,
reconciliation boundary keep), `mergeCategoryMeta` from custom Category + CategoryRename rows,
`fixedMerchants` from RecurringSeries outflow canonicals + RecurringOverride BILL/NOT_BILL
verdicts (later wins, overrideKey'd), and `excludeMerchantCanonicals` as the broad structural
loan set ∪ converted-reserve canonicals (the broad-vs-unioned approximation is moot unless a
budget-bearing category holds excluded rows — the probe checks that). Both the SHIPPED rollup
(budgets applied) and the COUNTERFACTUAL (budget map empty) were computed per real user.

**Result (real output, run 2026-08-09):**

```
===== user cmqisanqh000004l7wylnhrpd =====
budget targets: 0 — the C.19(2) replacement cannot fire on this corpus; nothing to measure.
done — users with budget targets: 0, total delta across corpus: $0.00, mixed budget-targeted
categories: 0. read-only, nothing written.
```

plus a direct confirmation query: **total Budget rows across ALL users: 0** (real user 0,
demo user 0, no seed Budget rows in prisma).

**Verdict:** the P1 cannot fire anywhere — `budgetByCategory` is always empty, so `budgetCents`
is always null and the replacement is dead code on this corpus; measured delta **$0.00**. No
direction to assume, **no fix warranted** — per the row's own prescription, the measurement
precedes any change, and zero reach means no change is evidenced. The mechanism stays
documented as latent (the only writer, `setBudget`, is demo-fenced; it arms only if the owner
sets a budget target on a mixed category). The probe is the re-measurement instrument for that
future state. Residual (1) of the row (the reserve third source) was already closed by C.23's
reserve half (#412). **TASKS C.19 row: DONE 2026-08-09.**

**Gate read (rule 5).** CI run **31339041797 on `59ee75b`** (the C.19 probe + records) =
**SUCCESS — gate GREEN**, read via `scripts/ci-status.sh` (exit 0). The C.19 slice is
SHIPPED-green by both gates; the K.4 slice now lands on top of a green head.

## K.4 record — 2026-08-09: the register's history bounds are scoped by the SET-DEFINING axes, both surfaces move together by construction (DECISIONS #436)

**The defect (K.3 critic, F10):** `registerEmptyReason` was computed from the GLOBAL
account-depth bounds while the filter bar printed the same global numbers, so the K.3
pair was consistent only while no filter narrowed the set. The F10 shape: the reader
narrows to a card whose history starts 2026-07-01 and picks "Last year"
[2025-01-01..2025-12-31]; the global oldest (a 2024 row in another account) sits before
`to`, so the before-history branch could not fire and the empty state said "No
transactions match these filters" — correct but useless (nothing can match; the reader's
card does not exist yet). Decided by execution (#436), not inspection, per the row's own
prescription ("Decide the scope question first, then build").

**The decision (#436):** the bound names the SET the reader is browsing, so it is
narrowed by the set-defining axes — **account, category, unclassified** — and nothing
else. Match axes (type, class, search, merchant, reimbursement, and the window itself)
never move the line. Both bound surfaces — the filter-bar sentence and the empty-state
reason — receive the same scoped value (`oldestDate` prop and `oldest` input from one
`scopedDateBounds` result in `getTransactions`), so K.3's pair-equality holds by
construction. Rejected: narrowing only one surface (re-breaks the pair), scoping by all
axes (the line flip-flops on every toggle), and patching the before-history branch alone
(both sentences stay true-but-not-about-the-view). Soundness argument: the scoped set is
a superset of every further-narrowed subset, so the scoped oldest is a lower bound on
any of them — the window branches stay honest on every deeper filter; an empty scoped
set (nulls) falls through to the `filters` branch correctly.

**Implementation:** `scopedDateBounds` (pure, `src/lib/engine/transactions/query.ts`,
set-defining axes only, explicit scan over the bounded rows); `getTransactions`'
previous global scan replaced by the scoped call; docblocks in `empty-reason.ts` and
`transaction-filters.tsx` rewritten to K.4 semantics.

**Locks:** 8 unit tests (scopedDateBounds ×7 — no scope → global, account narrows,
category narrows, unclassified narrows, combined intersect, empty-scoped → nulls,
single-row; plus the F10-shape `registerEmptyReason` test: scoped oldest inside the
window → `before-history` fires where the global bound could not). E2E F10 test with a
throwaway user: two accounts of different depth (2024-08-11 vs 2026-07-01); unfiltered
prints the global bound, account-narrowed + "Last year" prints the card's OWN bound in
BOTH surfaces (`txn-empty-before-history`, exact string "Wed, Jul 1, 2026", never "No
transactions match") — a state the unscoped code cannot reach, and the demo seed cannot
produce (uniform account depth), hence the custom seed in the e2e.

**Gate:** local verify GREEN — **320/320 e2e, 6,554 unit + 1 skipped**. The 4-worker
lottery drew documented members on runs 1-4 (category-rename:110 ×2, transactions:638
×2, :709, regression #216) — every member isolation-proven 1/1 on this exact tree, the
CSV failures forensicked to the C.14/C.15 severed-flight/stuck-button wedge (temp DB
held exactly the first import's 2 rows, zero duplicate writes; the slice touches no
import code); run 5 GREEN on a fresh temp e2e DB per the C.15 playbook.

**Gate read (rule 5).** CI run **31342632605 on `79abf43`** = **FAILED on attempt 1 —
one test: `category-rename.spec.ts:110`** (the removing-a-built-in-category test, 25.7s
on the [mobile-380] worker) — the documented 4-worker severed-flight lottery member from
the C.14/C.15/C.16/C.17 records and `docs/lessons/ci-e2e-timing-flake.md`, isolation-proven
1/1 (1.9s) on this exact tree during this slice's local gate, in a spec the K.4 diff does
not touch (the slice's own F10 e2e — `transactions.spec.ts:255` — PASSED in the same
run, and every other member of the 320 was green). **`gh run rerun --failed` → attempt
2 = SUCCESS — gate GREEN on `79abf43`**, read via `scripts/ci-status.sh` (exit 0). Per
rule 5's pre-existing-failure clause this was a recorded, proven-pre-existing member,
not a stop; the rerun conclusion is the ship verdict for the slice.

**Docs-chain gate read (rule 5).** CI run **31343734777 on `987228e`** (docs-only: the
gate-read record above; the diff vs the 320/320-verified `79abf43` is STATUS.md text
alone) = **FAILED on attempt 1 — two tests, both proven pre-existing on this exact
tree: `transactions.spec.ts:982`** (the unclassified-isolate, a NEW member of the wedge
class — isolation-proven 1/1, 2.7s) **and `mobile-overflow.spec.ts:386`** (the
[mobile-webkit] route sweep, the C.18-recorded member — isolation-proven 1/1, 6.5s; see
the member log appended to `docs/lessons/ci-e2e-timing-flake.md`). **`gh run rerun
--failed` → attempt 2 = SUCCESS — gate GREEN on `987228e`**, read via
`scripts/ci-status.sh` (exit 0). The K.4 docs chain closes: head of main is green behind
the K.4 code and both record commits it carried (the C.19 precedent — the gate read of
the previous sha recorded in the next commit — holds through this record).

**Deployment note (honest marker claim):** K.4 has no demo-visible marker — the demo
seed's accounts share uniform depth, so the F10 shape (depth variance) is unrepresentable
on demo data. The deployment proof is READY (Vercel commit status "Deployment has
completed", success, on `79abf43`; deployment `5yQ1T73MDxRKaxNDGBPB4i7YEksZ`) + the live
route serving (the register-surface K.3 live check passes 7/7 against production,
including the pair-equality sentence K.4 preserves by construction) + the CI gate
conclusion on the shipped sha; the behavioral proof is the e2e on the throwaway depth
accounts.

## U.25 + U.26 — the exported file states its basis and carries the register's two flags (2026-08-13)

**What shipped.** The transactions CSV gained two unconditional columns —
`excluded_from_totals` and `transfer` — read straight off the Prisma row, plus an
unconditional note stating the file's basis and a conditional note explaining whichever
of the two flags a given file actually contains. U.26 was opened by the U.23 money critic
and MEASURED against a real database: three rows summing −$3,300.00 in the file against
$100.00 of money out on the register, over the very same three rows. Row-set parity was
intact (U.23 made the route run `registerRowWhere`); what the file could not carry was
WHY two of its rows are in no figure the app prints.

**Gate (local).** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**: tsc 0,
eslint 0, **6,976 unit passed** (1 expected fail, 1 skipped, 422 files), `next build`
clean, **348 e2e passed** (5.5m).

**Critic cycle — two fresh contexts, both hostile, run against the finished slice.** They
found ZERO defects in the columns, the arithmetic, the rectangular padding, the
append-only position or the gate logic (money critic: financial correctness 9/10,
structural integrity 10/10 across all 16 note branches with an adversarial account name
and a formula-injection descriptor). **All six P1s were in the copy, and both critics
executed the same one independently.** Fixed and locked, each with a named regression
test: the basis note asserted omissions the reader may not have; "left out of the
spending, income and net totals it shows" is false live on the demo (an auto-loan ACH
marked `transfer,yes` is printed by /spending-plan as "CarMax Auto Finance $385.00/mo"
inside a $3,096.72 Fixed figure); the transfer clause promised a counterpart row that
need not exist; "Account balances count every row either way" is false for a hand-entered
row; the excluded clause was not sign-neutral; and the equality clause ignored the
household member's shared list and pagination. See DECISIONS #458 and
`docs/lessons/an-unconditional-sentence-may-only-state-a-rule.md`.

**Locks.** `tests/unit/u25-u26-export-basis-and-flags.test.ts` 22/22, including the
critic's measurement rebuilt against a real Prisma DB and every row's mark asserted BY
CONSTRUCTION against `getTransactions`; a new e2e in `action-menu.spec.ts` that drives the
exclusion through the real action menu and measures the file's unmarked rows against the
register's own tile ($85.00 → $45.00). FIVE sabotage proofs run and reverted (columns
unmarked → 2 red; basis note suppressed → 10 red; note AND-gated → 5 red; direction
clause restored → 2 red; the whole pre-critic first draft of both notes → 9 red).

**Predecessor checks updated, not left to rot.** U.19's and U.23's live-deploy scripts
both asserted the old header verbatim and would have failed the moment this deployed;
both are re-scoped to the claim each still owns. `scripts/u25-live-deploy-check.mjs` is
new, and unlike U.23's it has a real demo marker: the seed writes own-account transfers
on the demo's checking and savings accounts, so the `transfer` column, its `yes` rows and
the transfer shape of the note are all live-visible, and the central claim is measured on
production data against the register's outflow tile.

## ✅ BUILT 2026-08-13 — U.27: the currency family's standard has five authors, not one (DECISIONS #459)

**What shipped.** (a) DECISIONS #141 standardized the currency-withhold family on "not in
U.S. dollars" (never "foreign" — crypto is a first-class withheld case), but the standard
lived only in the string, not a shared constant every caller is routed through. Re-verified
by grepping all of `src/` for the bare, case-sensitive `US dollar(s)`: two of the row's four
named sites (`connection-depth-copy.ts:57`, `accounts-list.tsx:216`) were already correct —
not drift — but `household-copy.ts:109,175`, `keyword-rules.ts:1378` and a `money.ts`
docblock the row never named all said "US dollars"/"US dollar". Fixed to "U.S. dollars",
with `keyword-rules.ts` taking the hyphenated adjectival form ("U.S.-dollar accounts")
already shipped and locked in `currency-disclosure.spec.ts`. (b) `formatWithheldCurrencies`
rendered a mixed printable+opaque currency list as "EUR and others", which parses as "EUR,
and other ACCOUNTS" beside sentences that already talk about accounts — fixed to "EUR and
other currencies", reaching both the shipped #141 banner and the U.23 export note (both
locked, both updated). (c) Recorded, not fixed, per the task row's own instruction:
`getWithheldRegisterAccountSummary` doesn't apply the R1 reconciliation keep, so a
fully-disowned non-USD predecessor is counted as withheld-by-currency when currency isn't
what cost it its rows — generous, never false, doubly rare, unreachable on the demo seed.
Filed as **U.28**.

**Locked as a sweep.** `tests/unit/u27-currency-copy-drift.test.ts` walks every `.ts`/`.tsx`
file under `src/` for the informal phrase (the `source-hygiene.test.ts` shape, applied to a
copy standard instead of a byte class) and asserts both rendered consumers carry the fixed
phrase directly — so the next drift, wherever it lands, fails a test naming what it did.
Fail-old proven for both locks by direct sabotage (household-copy.ts reverted → 1 red;
currency.ts reverted → 3 red across two files), not asserted.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**: tsc 0 / eslint 0 /
**6,980 passed + 1 expected fail + 1 skipped, 423 files** (+4 tests, this slice's new file)
/ `next build` compiled in 9.1s / **347 e2e passed, 2 flaky-passed-on-retry**
(`merchant-lens.spec.ts`, `transactions.spec.ts` CSV import — both pre-existing members of
the recorded load-induced local flake class, in specs this slice does not touch). No
`prisma/` diff — copy-only change to three rendered strings and two comments.

**Gate read (rule 5) + live.** CI run **31690491184 on `eef777b`** = **SUCCESS**, read to
conclusion via `scripts/ci-status.sh` (exit 0). Vercel commit status: success, "Deployment
has completed", same sha. Production responds correctly post-deploy (`/` → 307 to
`/sign-in`, `/dashboard` → 307 unauthenticated — both expected). **No demo-visible marker,
and deliberately none exists (the K.4 situation, same as U.23):** every changed string sits
behind the currency guard or a household-scoped non-USD share, and the seed writes neither
a non-USD account nor a household (confirmed fact from U.23/U.25/U.26, not re-derived).
Unlike U.23, this slice has no computational claim to check live either — it is pure copy,
with zero engine logic and no `prisma/` diff — so there is nothing further a live probe
could assert beyond deployment health. The correctness claim rests on the CI e2e suite,
which ran the FULL suite (incl. `currency-disclosure.spec.ts`'s locks on the correct
family phrasing) against a genuine build of this exact commit, plus the unit-level
fail-old/pass-new sabotage proofs above.

## ✅ BUILT 2026-08-13 — U.18: two docblocks corrected, one false claim traced to a genuine gap (filed U.29)

**What shipped.** Pure docblock corrections, zero runtime diff, no `prisma/` change. (a) The
row named three files carrying a stale "counted once" claim; only one actually did.
`budgets/page.tsx` was already correct — U.16 had already qualified it with the handover-day
exception. `providers/transfer-refresh.ts` carries no such claim at all (grepped for
"once"/"migrat", zero hits — the row's premise about this file was stale, likely from an
earlier refactor). The one real false claim was `spend-class.ts`'s own docblock, which still
asserted "sees each real purchase ONCE there" after U.13 deliberately released the one
handover day per link to both sides. Corrected, and while tracing it: `summarizeSpendClassCategories`
is handed `keepsReconciled` only — no `handoverKeys`, unlike the four families U.16 disclosed
this on and unlike the Fixed-vs-typical total the SAME calling function builds two calls
above it — so the Fixed/Guilt-free panel on /budgets can still double a handover-day purchase
today, with no marker. Filed as **U.29** (money-visible, needs its own critic pass) rather
than fixed inside a docs-only row's budget.

(b) `reconcile-boundary.ts` claimed `refreshRecurringForUser` "excludes superseded
predecessors outright." Read `server/recurring.ts` directly: the query has no account-level
supersession filter — predecessor history flows through detection like any other account's
rows, correctly, since pre-migration history is real spend. The actual mechanism is the
ordinary `keepsReconciled` + (U.13) `collapseHandoverDuplicates`, same as every other R1
reader. Docblock corrected to describe that; the unsupported sentence removed.

No test locked either string (grepped `tests/`). Gate: `bash scripts/verify.sh` — tsc and
eslint printed nothing between their headers (zero errors), 423 files / 6980 unit tests
passed (1 expected fail, 1 skipped, both pre-existing), build clean, all 42 routes generated.

**SHIPPED AND PROVEN LIVE (2026-08-13).** Commit `b78504d` → pushed → CI gate `success`
(run 31702774413, read via `scripts/ci-status.sh`, exit 0). First Vercel build on this sha
FAILED — `P1001: Can't reach database server at ep-proud-sound-atpgfoct...neon.tech:5432`
during the build's `prisma db push` step, confirmed via `npx vercel inspect --logs` to be a
transient Neon connectivity gap, not caused by this commit (zero `prisma/` diff, pure
docblock comments): the immediately prior commit `eef777b` built clean, and production kept
serving that last-good deploy throughout (`curl` → 307, never a 500 — the owner was never
locked out). Retried with `npx vercel redeploy`; the second build reached the same Neon
endpoint successfully and went `Ready` in 2m, aliased to `www.aimplifi.app`. GitHub commit
status for `b78504d` now reads `success` on both CI and Vercel; production `/` and
`/dashboard` both 307 (expected, unauthenticated). No demo-visible marker needed or
possible — this is a pure copy/comment fix with no rendered or exported string touched.

## ✅ BUILT 2026-08-13 — U.29: the Fixed / Guilt-free split now discloses the one released
day it was already counting twice (DECISIONS #460)

**What shipped.** `summarizeSpendClassCategories` (`spending-plan/spend-class.ts`) — the engine
behind /budgets' Fixed vs. guilt-free split — was the one family U.16's handover-day disclosure
never reached (U.18 traced the gap while correcting this file's own docblock). It gained a sixth
parameter, `handoverKeys: ReadonlySet<string> = new Set()` (same default as
`buildCategoryBreakdowns` — the truth for every reader with no combined accounts), and its return
type gained `countedOnHandoverDays: number`: incremented once per row that survives
`keepsReconciled`, classifies as `fixed` or `guilt-free` (never `out-of-scope` — a transfer or
excluded row on a handover date must not inflate a count about a split it never joins), and whose
`handoverKey(accountId, date)` is a released day. `budgets/page.tsx` threads through the same
`handoverKeys` it already fetches for `buildCategoryBreakdowns` two calls above (one boundary
read feeds both), builds `breakdownHandoverDayCopy(count, false)` when the count is positive —
`false` because this panel prints category subtotals only, never a per-transaction row list, so
there is no "these rows still add up" tally to claim honestly — and passes it to `SpendClassPanel`
as a new required `handoverNote: string | null` prop, rendered as one sentence above the two
lists. The subtotal arithmetic itself is untouched: the released rows were already both counted,
correctly, by U.13's boundary; this slice adds a side-counter and a sentence, never a filter.

**Hostile critic cycle — one fresh-context pass, money-visible per the row's own instruction.**
Traced the real source (not a summary) against nine checks: loop order (the handover check runs
only after both the `keepsReconciled` and `out-of-scope` `continue`s, so a disqualified row can
never inflate the count); no false doubling (one `Set.has()` per row, account+date scoped); the
`statesATally: false` claim verified against the actual rendered `SpendClassRow` (one `<li>` per
category subtotal, never a per-transaction list); no stale/parallel computation (one boundary
read feeds the one call this slice touches); the summation line byte-identical in the diff; the
new optional 6th parameter doesn't break `spend-class-link-parity.test.ts`'s existing 5-arg call;
the new e2e test is non-vacuous (the pre-fix component had no `handoverNote` prop or
`spend-class-handover-note` testid at all); no missed family and no regression to the four U.16
already fixed (diff scoped to three files); integer-cents respected (no float introduced).
**Zero defects found across all nine checks.**

**Locked.** `tests/unit/spend-class.test.ts` — four new tests: the pre-U.29 5-arg call shape still
defaults `countedOnHandoverDays` to 0; a released handover day is counted and the subtotal is
untouched by the marker (both rows still sum in, exactly as before this slice); an unrelated
account on the same date and an out-of-scope transfer on the handover date are both excluded from
the count. `tests/e2e/handover-day-disclosure.spec.ts` — a new test reusing the file's existing
`seedHandoverDayDuplicate` fixture (a real combined SimpleFIN→Plaid pair: one $30.00 control
charge de-duplicated to its predecessor's copy, one $50.00 charge released to both sides) drives
`/budgets`, asserts the Fixed groceries row prints $130.00 (30 + 50 + 50) and the handover note is
visible with the engine's exact sentence, and that the note does not claim a row-by-row tally the
panel cannot show; the file's existing no-combined-accounts control test gained an assertion that
`/budgets` shows no note either.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**: tsc 0, eslint 0, unit suite
green (spend-class 23/23 incl. 4 new), `next build` clean, e2e **349 passed, 1 flaky-passed-on-
retry** (`transactions.spec.ts` CSV import — the pre-existing load-induced local flake class,
unrelated to this slice). No `prisma/` diff.

**SHIPPED AND PROVEN LIVE (2026-08-13).** Commit `4c8bc6e` → pushed → CI gate `success` (run
31710700200, read via `scripts/ci-status.sh`, exit 0). Vercel commit status: `success`,
"Deployment has completed", same sha (`gh api repos/meleesciony/Aimplifi/commits/4c8bc6e/status`).
Production `/` and `/budgets` both 307 (expected, unauthenticated). **No demo-visible marker
exists, and deliberately none does** (the K.4 shape, same as U.18/U.27): the demo seed writes no
`AccountReconciliation` row at all (`grep AccountReconciliation prisma/seed.ts` → zero hits), so
the handover-day disclosure this slice adds has nothing to fire on for the demo user — the
correctness claim rests on the new e2e test, which drives a real seeded combined-account handover
pair through a genuine build of this exact commit inside the FULL `VERIFY_E2E=1` CI suite, plus
the unit-level counting-boundary tests above.

## ✅ BUILT 2026-08-13 — U.24: the calendar's released day is counted out loud (DECISIONS #461)

The last spending surface that counted U.13's released handover day in silence. /calendar reuses
the register's where-clause and R1 keep (the K.1 gate), so a day both a retiring feed and its
replacement reported has always shown BOTH copies in its tiles — one real $50.00 purchase printing
$100.00 of money out — while the page carried no handover vocabulary at all.

**The fact was dropped at a narrowing, and the narrowing was documented as a design.**
`PostedTxnLike` is a lean row shape ("exactly what the shared summarize needs"), and
`TotalableTxn.onHandoverDay` was OPTIONAL with a docblock naming that very shape as its
justification — so `summarizeTransactions` read the absent value as "not released" and returned 0
forever. Fixed by making the flag REQUIRED on the calendar's own row type (the compiler then
enumerated every builder: exactly one in production, one test helper) and resolving it in
`getPostedCalendarRows`, the layer that holds `accountId`, so the unit of the claim stays the
(account, day) PAIR rather than the bare date. `countedOnHandoverDays` on the day and the month
come off the SAME `summarizeTransactions` calls the tiles and totals are summed from.

**Copy: the sixth existing author reused, not a seventh written.** This surface lists no
transaction rows (each day links out to Activity) and prints an in AND an out, so
`breakdownHandoverDayCopy` ("N rows here"), `handoverDayRegisterTotalsNote` ("it is listed") and
`handoverDayAnswerNote` (one direction: "too high / too LOW") are each false here in a different
way. `handoverDayAmountsNote` states the counting rule and claims neither.

**Two fresh-context critics, 2 P1 — each found BOTH, independently.** (1) The per-day marker
asserted the double as FACT ("counted on both connections' records") four lines under this slice's
own comment saying it deliberately makes no such claim; the keys are minted per link from the
cutover alone, so a released day on which only ONE connection reported is marked too, and there the
flat claim is false beside a specific amount. Restated to the unconditionally-true keep. (2) The
note was placed below the projected "Expected" line, whose figures are built from scheduled series
and card dues and hold no released row — so "these amounts" qualified the two figures it is not
about. Moved directly under the posted totals, locked by DOM ORDER. Residuals filed as U.30 (the
home screen's Recent transactions card, still silent and without even an account name), U.31 (two
independent reads of the link table in one loader) and U.32 (the day tile's row COUNTS and the
closing basis caption).

**Nothing about the money changed** — no filter added, no sum touched. Both copies are still
counted, as U.13 intended and the K.1 gate requires. The failure closed is silence.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN** (exit 0). E2E **349 passed,
2 flaky-passed-on-retry** (`action-menu.spec.ts`, `merchant-lens.spec.ts` — both pre-existing
members of the recorded load-induced local flake class, in specs this slice does not touch).
Independently this session: `npx tsc --noEmit` 0 errors, `npx eslint .` 0 output, `npx vitest run`
**423 files / 6991 tests passed** (1 expected-fail, 1 skipped), `npx next build` clean. No
`prisma/` diff — read-path and copy only, so the live Neon database is untouched.

**SHIPPED AND PROVEN LIVE (2026-08-13).** Commits `c46ef6c` (slice) + `0db1041` (the hypothesis
refutation) → pushed → CI gate **`success`**, run 31716116407, read to conclusion via
`scripts/ci-status.sh` (exit 0). Vercel commit status: `success`, "Deployment has completed", same
sha. Production responds correctly: `https://www.aimplifi.app/` → 307 and `/calendar` → 307, the
expected unauthenticated redirect to sign-in, not a 500.

**No demo-visible marker, and none is possible — declared, not skipped (the K.4 shape).** Re-verified
this session rather than inherited: `grep AccountReconciliation prisma/seed.ts` → **zero hits**, so
the demo dataset contains no combined-account pair, no cutover, and therefore no released handover
day for this disclosure to fire on. Every string and count this slice adds sits behind
`countedOnHandoverDays > 0`, which is unreachable for the demo user by construction. What stands in
for a live probe: CI's full `VERIFY_E2E=1` suite ran against a genuine build of this exact commit,
including the new /calendar e2e test, which drives a REAL seeded combined-account handover pair
(a SimpleFIN predecessor and its Plaid successor, one $30.00 control charge de-duplicated and one
$50.00 charge released to both sides) through the browser and asserts the $100.00 tile, the note's
text, its DOM position above the projected line, and the day marker's exact wording — plus the
no-combined-accounts control asserting /calendar stays silent. A bespoke production probe would
assert only that the deployment exists, which the two gate reads above already prove more precisely.

## ✅ BUILT 2026-08-13 — U.30: the FIRST screen a reader sees was also the last one saying nothing about the released day (DECISIONS #462)

The residual U.24's own critic filed: the home dashboard's "Recent transactions" strip showed a
released handover day's two identical rows with no marker — and no account name either, the one
clue `TxnView.onHandoverDay`'s docblock names as the reader's fallback elsewhere. Unlike every
other surface in this family (/transactions, /reports, /budgets, /trends, Ask, the CSV export,
/calendar), this card is the first thing a reader sees after signing in.

**Same pattern, sixth reuse of the marker, no new sentence.** `onHandoverDay` added REQUIRED to
`DashboardRecentTxn` — `tsc` enumerated exactly one production builder, none in tests, matching
#461's compiler argument. Resolved in `getDashboardRecent` by fetching `getReconciliationHandoverKeys`
alongside the existing `getReconciliationTxnKeep` call, inside the SAME `Promise.all` (concurrent,
which narrows rather than widens the U.31 race window against the precedent's sequential awaits).
Keyed exactly as every prior surface: `handoverKeys.has(handoverKey(t.accountId, t.date))`. Rendered
as the same `(connection changeover)` span used on /transactions, /reports, Ask and /calendar — no
seventh sentence authored, because this strip carries no aggregate total of its own to qualify (a
six-row list with an "All activity" link out, not a category or month summary).

**Fresh-context hostile critic (money-visible per this row) — PASS, zero P0/P1.** One P2 accepted
in place: the merchant name and the marker share one `truncate` `<p>`, so a long enough merchant
name could clip the marker past the ellipsis — the identical pattern already shipped and
critic-passed on `ask-view.tsx` (U.16), where `transaction-list.tsx` and `breakdown-panel.tsx`
instead give the marker its own non-truncating slot. Not raised as new; worth revisiting the two
remaining truncate-together sites together, someday.

**Locked.** `tests/unit/dashboard-recent.test.ts` — a byte-for-byte match of #461's own fixture
shape (predecessor/successor/unrelated-account trio, same cutover, same scoping controls): flags
both released copies, not the unrelated account's row on the identical date, not a pair-account row
off the cutover date. `tests/e2e/handover-day-disclosure.spec.ts` gains a test reusing the file's
`seedHandoverDayDuplicate` fixture — /dashboard prints 3 rows (the control pair de-duplicated to
one, the handover day keeping both), exactly 2 carry `dashboard-recent-handover-row`; the existing
no-combined-accounts control test gained the matching zero-count assertion.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**: tsc 0, eslint 0, unit tests
green (2 new dashboard-recent locks), `next build` clean, e2e **350 passed, 2 flaky-passed-on-
retry** (`category-rename.spec.ts:110`, `merchant-lens.spec.ts:22` — both named members of the
pre-existing load-induced local flake class in `docs/lessons/ci-e2e-timing-flake.md`, neither a
spec this slice touches). No `prisma/` diff — read-path and copy only, so the live Neon database is
untouched.

**SHIPPED AND PROVEN LIVE (2026-08-13).** Commit `cf102d0` → pushed → CI run 31720492510 **FAILED on
attempt 1**, and the failure is named rather than waved away per rule 5: both reds were
`transactions.spec.ts:638` and `:735` (the "CSV import" / "forensicked CSV wedge" contention class
documented since #422/K.8 — proven pre-existing across dozens of prior runs, e.g. STATUS.md:483,
:548, :596 — and outside this push's diff, which touches only `dashboard-recent.ts`,
`recent-transactions-card.tsx`, `handover-day-disclosure.spec.ts` and the new unit test). `gh run
rerun 31720492510 --failed` → attempt 2 **`success`**, read to conclusion via `gh run view` (not
inferred). Vercel commit status: `success`, "Deployment has completed", same sha
(`gh api repos/meleesciony/Aimplifi/commits/cf102d0/status`). Production `/` and `/dashboard` both
307 (expected unauthenticated redirect to sign-in, not a 500).

**No demo-visible marker, and none is possible — declared, not skipped (the K.4 shape, same as
U.18/U.24/U.27/U.29).** `grep AccountReconciliation prisma/seed.ts` → zero hits, unchanged from
every prior slice in this family: the demo dataset has no combined-account pair, no cutover, and
therefore no released handover day for `onHandoverDay` to ever be true for the demo user. What
stands in for a live probe: CI's full `VERIFY_E2E=1` suite ran against a genuine build of this exact
commit, including the new /dashboard e2e test, which drives a REAL seeded combined-account handover
pair through the browser and asserts the 3-row shape and the exact marker count, plus the
no-combined-accounts control asserting /dashboard stays silent.

## ✅ BUILT 2026-08-13 — U.31: six loaders read the reconciliation link table twice, not two (DECISIONS #463)

The exact "two independent reads of the same link table" shape `getAccountsView` already argued
against in writing, at scale: `getReconciliationTxnKeep` and `getReconciliationHandoverKeys` each
independently re-fetched the same links/accounts/spans, and the row's own text named two call
sites carrying that pattern. There were six.

**What shipped.** `getReconciliationBoundary(userId)` reads the link table once and returns both
outputs together, via a private shared loader `loadReconciliationBoundaryInputs`. Converted at
`getPostedCalendarRows`, `getTransactions`, `getTransactionDetail` (all `transactions.ts`),
`getDashboardRecent` (`dashboard-recent.ts`, U.30's addition), and — found only by the fresh-context
critic grepping every consumer rather than trusting the row's own background text —
`budgets/page.tsx` and `api/export/route.ts`, both of which paired the two functions sequentially
in one loader exactly like the four sites already named.

**Fresh-context hostile critic — 0 P0, 2 P1 (both fixed in-session), 1 P2 (fixed).** The two P1s
were the missed call sites above. The row's claimed "single-value elsewhere" list for these two
functions was checked, not trusted, and found false.

**Filed rather than fixed — U.33.** `recurring.ts` and `tax.ts` pair `getReconciliationTxnKeep`
with a DIFFERENT sibling, `getReconciliationHandoverDates` (unscoped by account, its own
triplicated fetch) — feeding PERSISTED `RecurringSeries`/`ScheduledTransaction` rows and the tax
export respectively. Same race shape, needs a different shared function (undecided design, not a
mechanical swap) — its own row rather than scope creep on this one.

**Locked.** `tests/unit/reconciliation-boundary-shared-read.test.ts` (new, 3 tests) proves
`getReconciliationBoundary`'s two outputs agree row-by-row with the two standalone functions over
an identical fixture — behavioral equivalence, not just "returns a value" — plus the
(account, day)-scoping shape and the no-active-links fast path. The full existing suite (6,995
unit tests, unchanged pass count) proves no behavior moved at any of the six converted sites.

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**: tsc 0, eslint 0, unit
**6,995 passed + 1 skipped / 426 files**, `next build` clean, e2e **350 passed, 2
flaky-passed-on-retry** (`category-rename.spec.ts:110`, the documented pre-existing flake-class
member; `triage-write-in.spec.ts:129`, a `SQLITE_BUSY_SNAPSHOT` contention hit — the
K.10-documented e2e-harness class the configured retries exist to absorb, in a spec untouched by
this diff). No `prisma/` diff — the live Neon database is untouched by a read-path refactor.

**SHIPPED AND PROVEN LIVE (2026-08-13).** Commit `c061050` → pushed → CI run 31727687546
**`success`**, read to conclusion via `gh run view` (not inferred). Vercel commit status:
`success`, "Deployment has completed", same sha. Production `/`, `/budgets` and `/transactions`
all 307 (expected unauthenticated redirect to sign-in, not a 500). This slice's correctness rests
on the full existing e2e/unit suite (behavior-preserving refactor, no new user-visible surface):
the six converted call sites' own tests — register, calendar, dashboard, budgets, CSV export,
transaction detail — all ran green against a genuine build of this exact commit inside CI's full
`VERIFY_E2E=1` gate, alongside the new unit-level equivalence proof.

## ✅ BUILT 2026-08-13 — U.32: /calendar's per-day marker was gated on the money it moved, not the fact it stated (DECISIONS #464)

Both U.24 critics converged on the same finding: the day tile's flat row counts ("N transactions
in Activity →", "N transfers... / N rows you excluded") have no released-day awareness, while the
page's ONLY per-day changeover marker was gated on `countedOnHandoverDays` — a count scoped to
rows the MONEY figures sum from. A released day whose only duplicated rows were transfers,
reader-excluded or $0 printed a doubled count with no changeover vocabulary anywhere on the page.

**What shipped.** New `PostedCalendarDay.handoverRowCount` (the RAW released-row count, transfer/
excluded/$0 included) widens the per-day marker's gate — safe because the marker's own claim
("both connections' records are kept for this day") is unconditionally true regardless of whether
the released rows moved a tile. The closing basis caption gained an unconditional released-day
clause, matching its own established voice (every other clause states a rule, not whether it
currently applies). The money-scoped month sentence stayed unchanged and correctly silent on a
transfer-only day — not a residual, the right answer.

**Locked.** Two existing unit tests extended proving `handoverRowCount` and `countedOnHandoverDays`
are genuinely different counts, not one renamed (a transfer/excluded/$0 fixture lands 3/0). A new
e2e fixture (`seedHandoverDayTransferOnly`) and test prove the day tile shows BOTH
`cal-posted-nonmoney` and the now-widened `cal-posted-handover-day` marker together, the month
sentence stays absent, and the caption clause is present; the existing no-combined-accounts
control gained an assertion that the caption clause renders even there (proving it is genuinely
unconditional).

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**: tsc 0, eslint 0, unit
**6,995 passed + 1 skipped / 426 files**, `next build` clean, e2e **349 passed, 4
flaky-passed-on-retry** (`action-menu.spec.ts:391`, `category-rename.spec.ts:110`,
`transactions.spec.ts:735`, `transactions.spec.ts:1014` — all members of the documented K.10
shared-SQLite contention class, none touching calendar or reconciliation code). No `prisma/` diff.

**SHIPPED AND PROVEN LIVE (2026-08-13).** Commit `7768ff9` → pushed → CI run 31732435392
**`success`** (first attempt, no rerun needed), read to conclusion via `gh run view`. Vercel
commit status: `success`, "Deployment has completed", same sha. Production `/` and `/calendar`
both 307 (expected unauthenticated redirect). The new e2e fixture (a genuine transfer-only
released day, two SAVINGS accounts) ran inside CI's full `VERIFY_E2E=1` suite against this exact
commit, proving the widened marker and the caption clause both render correctly together with
the money-scoped month sentence staying silent — the shape a bespoke production probe could not
usefully add to (no demo-visible marker: `grep AccountReconciliation prisma/seed.ts` — zero hits,
same K.4 fact as every slice in this family).

## ✅ BUILT 2026-08-13 — U.33: the boundary's last two hand-rolled reads, and a link table read four times inside one write (DECISIONS #465)

U.31 consolidated the reconciliation link table's double read at six loaders and left two views out.
The U.31 critic filed the remainder as U.33 and named two call sites; the measurement found four reads,
not two, at the more consequential of them. `refreshRecurringForUser` read `accountReconciliation` FOUR
times per run — the keep, the released dates, `activeTerminalSuccessorMap` feeding the same
`collapseHandoverDuplicates` call, and `activeTerminalSuccessorMap` again fifty lines later where
`new Set(terminalOf.keys())` decides the account scope for the rows it WRITES — and that call's output
is persisted as `RecurringSeries` + `ScheduledTransaction`, driving forecast, the calendar, the spending
plan and the Cash-Needed Engine. `getTaxExport` read it twice for a file that leaves the app.

**What shipped.** `getReconciliationBoundary` returns FOUR views from one read (`keepsReconciled`,
`handoverKeys`, `handoverDates`, `terminalOf`) — every one the same derivation from the same two inputs,
all empty/constant-true on the no-links fast path. Neither shape the row proposed was built: a second
boundary function is a second place for the fetch to drift. `getReconciliationHandoverDates` is deleted
outright (U.33 consumed its only two callers; the critic caught that leaving it exported made a docblock
sentence false). `taxRows` takes the keep as a REQUIRED parameter so the compiler enumerates its callers.
Measured query counts with links present: `getTaxExport` 6 → 3, `refreshRecurringForUser` 11 → 4.

**Locked by a COUNT, because equivalence passes just as well against four reads.**
`tests/unit/reconciliation-boundary-shared-read.test.ts` (+6 tests): a
`vi.spyOn(prisma.accountReconciliation, 'findMany')` count asserting one read each, on a fixture carrying
a real ACTIVE link (the critic caught the first draft measuring the links-empty fast path — the one
branch that reads once however you ask). Fail-old proven by sabotage: reverting `src/` to HEAD reddens
6 of 9, at "expected 1, got 2" for the export and "expected 1, got **4**" for the refresh.

**Hostile critic (fresh context, Opus 5): PASS — 0 P0, 0 P1.** Behavior preservation proven by dumping
every persisted `RecurringSeries`/`ScheduledTransaction` field plus the whole tax export on a
mid-stream-cutover fixture, reverting to HEAD, re-running and diffing — identical on two runs. Ordering
safety proven by permuting every ordering of six link shapes against all four views. Three P2s executed,
one accepted with its measurement, one filed as U.34 (`getSpendingPlan` reads the table three times per
call; `assistant.ts` six times in one file).

**Gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN** (exit 0): tsc 0, eslint 0, unit
**7,001 passed + 1 expected fail + 1 skipped / 426 files**, `next build` clean, e2e **349 passed, 4
flaky-passed-on-retry** (all K.10 shared-SQLite contention class, none touching this slice's code). No
`prisma/` diff.
