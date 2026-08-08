# STATUS — known limitations & open items

Living document; updated at each phase boundary and critic cycle.

> Entries from 2026-06/2026-07 (BUILT/CLOSED history) were moved verbatim to
> `docs/archive/STATUS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04 to keep this
> file loadable. Only OPEN/DECIDED items and 2026-08 entries live here.

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
loan-due obligation on the calendar + reminders (#134)". Recorded as **K.7**;
the loan half of #134 has no coverage on any surface today.

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
