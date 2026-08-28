# STATUS — known limitations & open items

Living document; updated at each phase boundary and critic cycle. In the build graph
(`GRAPH.md` §3) this file is shared state: the open-items field every node reads and
the state-writer edge updates. It is also the only home for live counts (test totals,
rates) — no other doc may restate them.

> Entries from 2026-06/2026-07 (BUILT/CLOSED history) were moved verbatim to
> `docs/archive/STATUS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04, and the 2026-08
> BUILT/CLOSED history to `docs/archive/STATUS_ARCHIVE_2026-08.md` on 2026-08-27, to
> keep this file loadable. Only OPEN/DECIDED/record items live here, plus the newest
> BUILT entry, which stays as the home of the current live counts.

## ✅ BUILT 2026-08-28 — P0.4 assign-to-zero leftover line on /budgets (DECISIONS #525)

**The report.** After C5 (#524) the coach-principles plan's remaining
named P0.4 gap: highlight existing `leftToSpendCents` as leftover
toward a fully-assigned plan (no new math). The 3-bucket lens + bands
+ Ask were already shipped.

**Shipped.** Pure `assignToZeroLineFor(leftToSpendCents, inflation)` in
`src/lib/engine/spending-plan/assign-to-zero.ts` returns
`COACH_COPY.assignToZero` only when leftover > 0 and this card does
not already know the leftover is inflated. Null for 0 / negative.
Rendered on `/budgets` under the conscious-spending caption,
`data-testid="conscious-assign-to-zero"`. Amount is the guilt-free
bucket by construction. Copy names monthly capacity, not remaining
cash (critic P1-1). Uncounted-fixed / card notes refuse the line
(critic P1-2); unset savings still prints (genuine Ramsey leftover).

**Critic (fresh context): cycle 1 FAIL 2 P1; cycle 2 PASS — 0 P0, 0 P1.**
P2s recorded, not blocking ($0 silence, soft "is the plan", no
aria-describedby, critic-voiced capacity clause, picker-not-strip
inflation locks, blunt card-note gate).

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0, probes
tsc 0, eslint 0, `next build` clean). Unit **7,870 passed + 1 expected
fail + 1 skipped / 478 files**. One intermediate full-suite run hit
the SQLite cascade flake (6 failures in untouched files: lock /
timeout / unique constraint); those 4 files 104/104 isolated; rerun
green. E2E `conscious-buckets.spec.ts` mobile-380 **2/2** on the fresh
build (port 3100 free). EDGE_CASES AZ1–AZ5. No `prisma/` diff.

**Gate read.** Pushed `bc68bbf7` to `origin/main`. GitHub Actions
`verify` = **SUCCESS**, run **33206221592** (13m26s, `gh run watch
--exit-status` exit 0) on sha
`bc68bbf78babe61e9a8998532271003a709a2b0e`. Vercel commit status
`success`, "Deployment has completed", same sha
(`GUiqJ8yBeua61zUbESrz8rwzL71q`). Live proof
`node scripts/p25-live-deploy-check.mjs` → **10/10 PASS**: signed into
the shared demo, `/budgets` conscious-spending strip,
`conscious-assign-to-zero` renders with the capacity sentence ("…a
monthly capacity, not cash still sitting unspent"), one dollar amount
($1,659.08), no "You have" / "still unassigned", no shame, no
zero-out-fun-money imperative. No pre-#525 build has the element, so
the probe passing is the deploy proof. Did not submit (shared demo).

**Still open.** Coach-principles named P0/P1 gaps are closed (P0.4
#525). Wave 0 ops remain owner-blocked. Match % still uncollected.
D.3 standing-read audit still OPEN.

## ✅ BUILT 2026-08-27 — C5 time-window line on the life-energy card (DECISIONS #524)

**The report.** The coach-principles plan §3 row C5's last named gap:
"Partial — no … time-window-of-life framing" — the one-line's "buy
experiences while you can". §6's two C5 sentences (the dials "spend
there proudly" line, `moneyDials`; the P2.2 memory-dividend
reflection, `lifeEnergyReflection`) were already shipped; P1.1's dial
tags shipped before #503 (which closed P1.1 as a skip). This slice
ships the third clause as one sentence.

**Shipped.** Pure `windowLineFor(itemCount)` in
`src/lib/engine/fi/experiences-window.ts` returns
`COACH_COPY.experiencesWindow()` only when the life-energy card has a
purchase to qualify — `0` ⇒ null (an "No large purchases in the last
90 days" card gets no "savor the moment" line under it; same absence
rule as the cushion line's CL4/CL5 null states). Rendered in the
life-energy card under the P2.2 reflection, `data-testid="life-energy-window"`:
"Some experiences only happen inside a window of life — the hike at
one age isn't the same hike at another. Money lasts; the chance at
the moment doesn't wait for the money."

**What the copy refuses.** Any reader-specific claim (no age/health
data is stored, #518 — the framing is general), any numeral, any
imperative to spend, any Aimplifi read-path claim, and any restatement
of the #503 Coast-gated past-enough sentence (`pastEnoughCoast` is
gated on surplus; this line is gated on time — the two coexist).
Placement: the planner's own C5 surface — the plan pairs its
time-of-life language with hours-of-working-life (§6 C5 second
sentence lives on this card; P2.2's row names the card), and the
opportunities-header paragraph was rejected because that card is a
savings-cuts list — a line arguing why some spending is worth it would
fight its purpose from inside it (and would be invisible to any reader
who never set a dial, while the window framing is true of everyone).
`moneyDials` / `lifeEnergyReflection` byte-identical (the production
probe and the Ask `what_to_cut` answer read them — one leaf added,
none edited).

**Critic (fresh context): cycle 1 PASS — 0 P0, 0 P1.** It reproduced
the gates (unit 7 + coach-copy 806 + W.8 completeness pin + tsc +
phase3-coach e2e 1 passed) and audit-confirmed the premise (§3/§6/§7/
§0 quotes), the placement on independent grounds, the copy word by
word, the gate boundary, the test layering (gate locked, copy pinned
byte-exact at unit AND rendered level, e2e negative gap noted), and
regression safety (diff is insertions only). Its three P2s were fixed
**before ship**: the #524 row's P1.1-for-#503 citation corrected to
"closed P1.1 as a skip"; "Money keeps" → "Money lasts" (first-read
clarity, comment §6's copy is calmer than the plan's own "buy
experiences while you can"); rendered-negative now locked by
`auth.spec.ts` zero-purchase fixture
(`life-energy-window` count 0).

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0, probes
tsc 0, eslint 0, `next build` clean). Unit **7,853 passed + 1 expected
fail + 1 skipped / 477 files** (+9: 7 in the new
`experiences-window.test.ts` + 2 guardrail sweep rows from the
ALL_STRINGS entry; one transient disk-I/O flake in
`category-breakdown.test.ts` passed on rerun in isolation — env, not a
defect). E2E phase3-coach 1/1 (mobile-380) and auth sparse-cards 1/1
(rendered-negative) on the fresh build. Locks pinned in EDGE_CASES
(EW1–EW4). No `prisma/` diff.

**Gate read.** Pushed `6dc9c5a7` to `origin/main`. GitHub Actions
`verify` = **SUCCESS**, run **33127710694** (`scripts/ci-status.sh`
exit 0). Vercel commit status `success` on the same sha. Live proof
`node scripts/p24-live-deploy-check.mjs` → **7/7 PASS**: signed into
the shared demo, life-energy card, `life-energy-window` renders with
the exact text ("…Money lasts; the chance at the moment doesn't wait
for the money."), no numerals, no shame, no past-enough restatement.
No pre-#524 build has the element, so the probe passing is the deploy
proof. Did not submit (shared demo).

**Follow-up gate read (owner's rotation commit) — RED, recorded, not
silent.** The owner's ledger rotation `38b09865` ("docs: rotate ledgers
— DECISIONS #1-#401 and STATUS 2026-08 BUILT history to archive,
verbatim, owner-approved") landed on top of this record. Its CI run
**33128661995 FAILED** on exactly two tests, both in
`tests/unit/ledger-decisions-index.test.ts`: "leaves nothing in the
committed index unaccounted for" (`[1..380]` unaccounted) and
"carries exactly one index row per decision" (`[1..503]` vs the live
123). Cause: DECISIONS.md was rotated to #402–#524 but
`DECISIONS_INDEX.md` still carries an index row for every archived
decision — the index-sync guard (`scripts/ledger.ts reindex` refuses a
drop) fired exactly as designed. Class: docs-sync of the rotation
commit, not this slice (code gates all green; this slice's own run
33127710694 succeeded). Fix (owner's lane; docs/archive/ is
permission-walled to agents here): move the #1–#401 index rows
alongside `DECISIONS_ARCHIVE_1_to_401.md` and regenerate with
`npx tsx scripts/ledger.ts reindex` — or if the archive index is
explicitly out of scope, the same trim synchronizes the two files; do
NOT run reindex against the stale index (it refuses by design).

**Resolved.** `a0c390c6` (owner): the decisions-index tooling is now
archive-aware — it unions the live DECISIONS.md with
`DECISIONS_ARCHIVE_*` so the index stays complete and the no-loss
invariant holds. CI run **33130300577 = SUCCESS** on that sha; main is
green again.

**Still open.** C13 remaining content (P0.3 years-until-time-is-yours,
P1.6 define-your-enough). P0.4 assign-to-zero shipped #525. Wave 0 ops
remain owner-blocked. Match % still uncollected.

## ✅ BUILT 2026-08-27 — C2 cushion line pairs the radar dip on /dashboard (DECISIONS #523)

**The report.** The coach-principles plan §4 Dashboard row's last C2
artifact: "pair every forecast dip with the runway cushion line"
("surprises are what history guarantees; your N-month cushion handles
what no forecast sees"). Zero code existed for it (verified by
explorer: the phrase has no source match), so C2's §0 "partial" is now
closed end to end — invisible-wealth caption (P0.1), room-for-error pill
(P0.2), staying-wealthy row (P1.2/#500), reflection (#502), cushion line
here.

**Shipped.** Pure composer `cushionLineFor` in
`src/lib/engine/radar/cushion-line.ts` returns
`COACH_COPY.cushionLine(months)` only when the radar is `alert` with a
first-negative date AND the runway is a finite positive month count —
null for ok/watch/no-date and for ∞/0/negative/absent (an absence is
never restated as a cushion: "your 0-month cushion handles…" would be a
fabricated function; the pill already prints the honest parallel states).
Rendered in the radar card's alert block on /dashboard
(`data-testid="radar-cushion-line"`), under the cover-transfer box. Same
`coach.runwayMonths` the room-for-error pill prints (one value, one
author); raw months per the `stayingWealthyRunway` convention
("2.1-month", never rounded). The sentence claims ONLY that the cushion
is what stands under what no forecast sees — never that it covers the
shown dip (the transfer above does that), never a date/amount, never a
recommendation. The nudge feed's same-dip row was adjudicated out: it
points at the card ("See Cash Flow Radar below"), one dip, one
treatment.

**Critic (fresh context, Opus): cycle 1 FAIL 1 P1; cycle 2 PASS — 0
P0, 0 P1.** The P1 was the maker's own added scope clause — "this
forecast sees only the scheduled flows on file" — which is FALSE of the
radar's committed walk: synthesized future card cycles (estimated dues)
are in it and disclosed one paragraph above ("(includes estimated
future statements)"). The clause is gone; the copy is the plan's
near-verbatim. The critic mutation-checked the `Number.isFinite` gate,
reproduced every gate (7844 unit / 476 files, tsc, eslint, build, e2e
1/1, full suite 372 passed + 1 pre-existing flake that retried green),
and confirmed the ∞/0/negative refusal is the right call. Residual P2s
(recorded, not re-opens): today-feed dip row has no line (adjudicated
above); the cushion's "months of expenses in cash" basis is the pill one
card away; ledger row-style formatting.

**Gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN (tsc 0, probes
tsc 0, eslint 0, `next build` clean). Unit **7,844 passed + 1 expected
fail + 1 skipped / 476 files + 1 skipped** (+8: 6 new composer tests +
2 guardrail `it.each` rows from the ALL_STRINGS entry). E2E
cash-flow-radar 1/1 on the fresh build (mobile-380, axe-clean). New
locks pinned in EDGE_CASES (CL1–CL6). No `prisma/` diff.

**Gate read.** Pushed `11aefcb8` to `origin/main`. GitHub Actions
`verify` = **SUCCESS**, run **33088573999**, first attempt, ~13m14s
(`gh run watch` exit 0; `gh run view` conclusion `success` on sha
`11aefcb884779956834ba35cac28e255c9a1074e`). Vercel commit status:
`success`, "Deployment has completed", same sha. Live proof
`node scripts/p23-live-deploy-check.mjs` → **7/7 PASS**: signed into
the shared demo, radar Heads-up, `radar-cushion-line` renders —
"Surprises are what history guarantees — and your 5.7-month cushion is
what handles what no forecast sees." — no shame, no cover-of-shown-dip
claim. No pre-#523 build has the element, so the probe passing is the
deploy proof. Did not submit (shared demo).

**Still open.** C5 "buy experiences while you can" time-window line
(P2-tier, the C5 partial's last named gap); P0.4 "assign to zero"
(plan marks it optional; 3-bucket lens + bands + Ask already shipped).
Wave 0 ops remain owner-blocked. Match % still uncollected.

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
