# STATUS — known limitations & open items

Living document; updated at each phase boundary and critic cycle. In the build graph
(`GRAPH.md` §3) this file is shared state: the open-items field every node reads and
the state-writer edge updates. It is also the only home for live counts (test totals,
rates) — no other doc may restate them.

> Sections through 2026-08-19 live in `docs/archive/STATUS_ARCHIVE_2026-07_to_2026-08-19.md`
> (rotated 2026-09-11) and the BUILT entries 2026-09-03 through 2026-09-11 in
> `docs/archive/STATUS_ARCHIVE_2026-09-03_to_2026-09-11.md` (rotated 2026-09-17), and the BUILT
> entries for #737–#740 (2026-09-11/12) in `docs/archive/STATUS_ARCHIVE_2026-09-11_to_2026-09-12.md`
> (rotated 2026-09-17), the BUILT entry for #741 (2026-09-14) in
> `docs/archive/STATUS_ARCHIVE_2026-09-14.md` (rotated 2026-09-18), and the BUILT
> entry for #745 (2026-09-17) in `docs/archive/STATUS_ARCHIVE_2026-09-17-745.md`
> (rotated 2026-09-18), and the BUILT entry for #750 (2026-09-18) in
> `docs/archive/STATUS_ARCHIVE_2026-09-18-750.md` (rotated 2026-09-18), and the
> BUILT entries for #749/#752 in
> `docs/archive/STATUS_ARCHIVE_2026-09-18-o20j-749-752.md` (rotated 2026-09-20), and the
> BUILT entries for #753–#756 in
> `docs/archive/STATUS_ARCHIVE_2026-09-18-o20j-753-756.md` (rotated 2026-09-22); only
> current-wave BUILT entries and OPEN/FOUND/DECIDED items remain here.
> BUILT #744/#748 and the superseded #743 human gate live in
> `docs/archive/STATUS_ARCHIVE_2026-09-16_to_2026-09-17.md` (rotated 2026-09-21).
>
> Entries from 2026-06/2026-07 (BUILT/CLOSED history) were moved verbatim to
> `docs/archive/STATUS_ARCHIVE_2026-06_to_2026-07.md` on 2026-08-04, and the 2026-08
> BUILT/CLOSED history to `docs/archive/STATUS_ARCHIVE_2026-08.md` on 2026-08-27, to
> keep this file loadable. Only OPEN/DECIDED/record items live here, plus the newest
> BUILT entry, which stays as the home of the current live counts.

## ✅ BUILT 2026-10-03 — Ask: one month against another, and a monthly average (DECISIONS #781) — critic cycle 5 PASS; shipped

**What it is.** "Compare groceries in May to April", "did I spend more this month than last month", "average monthly dining over the last 6 months" — answered only on the accounts whose records are known whole for the months asked (rows, a live feed, or the reader's yes/no word), every other account named with what it has on record and why, and asked where an answer could change the figure. A month in progress is compared day for day. The rules are DECISIONS #781; the hand-worked values `tests/edge-cases/ask-same-account-comparison.md`.

**History.** The open-English attempt (#777) failed eight critic cycles and is parked, unmerged, on the local branch `ask-analyst-777-parked` (the main checkout held it uncommitted until 2026-10-03). This is the narrow rebuild the owner directed to finish and ship.

**Critic cycle 1 (two lanes, Opus): FAIL** — money 1 P0 / 1 P1 / 6 P2, routing 0 P0 / 6 P1 / 7 P2. **Cycle 2: FAIL** — money 0 P0 / 1 P1 / 7 P2 (a cutover earlier than the old record's last row), routing 0 P0 / 2 P1 / 8 P2 (custom names compared as built-in buckets; chips read without the reader's words). Every cycle-1 finding was confirmed fixed by cycle 2; all cycle-2 P1s fixed and locked; most P2s taken (summarised in #781). Found by the maker on the way: text typed before hydration left Ask disabled (present on main) — fixed. **Cycle 3: routing PASS (0 P0 / 0 P1 / 9 P2); money FAIL (0 P0 / 2 P1 / 5 P2)** — a future-dated old-record row and a three-record chain left dropped rows priced at $0; fixed at the root by taking each record's kept days from the boundary itself (`reconciliationDroppedRanges`, property-tested against the keep rule). **Cycle 4 (last; one lane): FAIL (0 P0 / 1 P1 / 4 P2)** — with three records and a non-default cutover, true answers about two records "proved" the third's silence ("$0.00 in September — 100% lower"). **Budget spent; stopped.** Fixed after the cycle and locked, UNREVIEWED: a card the boundary trims takes no reader's word and no older feed (only its kept days); the four P2s taken. The owner chose a fifth cycle (2026-10-03). **Cycle 5 (one lane, Opus): PASS — 0 P0 / 0 P1 / 6 P2**; a generative truth oracle (~740,000 questions over one card on one to three records) found 0 wrong figures; unlinked accounts and the demo unchanged. P2s: TASKS 2.9a. CI and live proof: below, once pushed.

**Gates on the fixed tree (2026-10-03, from PowerShell).** `bash scripts/verify.sh` **GREEN** on the final (gated) tree — tsc 0, eslint 0, vitest 653 files / 8,887 passed, `next build` clean; full Playwright (both projects) **464 passed / 2 flaky / 0 failed** — the flakes `transactions.spec.ts:149` and `:1015`, recorded before this slice. `ask-compare.spec.ts` 8 / 8 in Chromium (Pixel 5 @380) and WebKit (iPhone 13, newly added to that project).

**Schema.** Four nullable `String?` columns on `Account` (`recordStartWordDate`, `recordStartWordVerdict`, `recordEndWordDate`, `recordEndWordVerdict`) — additive; `prisma db push` on deploy adds them to the live Neon database and touches no existing row.

**Open (recorded, not taken).** A Plaid sync that succeeds at the API is taken as fresh bank data; a hand-kept predecessor marks a combined card "kept by hand"; the left-out sentence can run ~12 lines at 380px; two taps in one frame both fire (the write is idempotent). Locally (Windows), `transactions.spec.ts:639` (CSV re-import) never returns its first import in most worktrees while CI passes it — cause not found.

## ✅ BUILT 2026-10-02 — U.1b: the compact register row (DECISIONS #779) — fifth critic cycle PASS, shipped 2026-10-03

**How it got through.** Four hostile-critic cycles failed (the budget); the owner then asked for a fifth on this tree, rebased onto `48b78387` (X.1), and to ship if it passed. **Cycle 5: PASS — 0 P0 / 0 P1 / 5 P2** (measurements and the P2s in DECISIONS #779; the P2s are TASKS U.1m). The rebase changed no code — only ledger files conflicted, all resolved by keeping both sides.

**The hole.** On a real account an Activity row was 300–350px tall at iPhone width — two rows per screen (owner's screenshot; reproduced on a signed-up account: 353 / 345 / 302 / 302 / 352 in Chromium @380). The demo renders no edit controls, so nothing run on the demo could see it.

**Shipped.** Below `sm`, a row is closed until its chevron opens it in place. Closed: payee, amount, category, date, account, the class label, and the chips that are facts or asks (Pending, handover, Excluded, reimbursement, tags, a needs-your-OK badge with its Confirm, a suggestion with its Confirm). Open: every control. On a phone the row is a grid — chevron first, payee and amount on one line, controls full-width beneath — over the same DOM the desktop flex row uses. Hidden by one CSS class, never unmounted; `sm`+ unchanged. Open rows persist for the session and are restored before the scroll position is. **Measured after, same fixture (eight rows): closed 125 / 101 / 85 / 85 / 108 / 85 / 129 / 108px — mean 103px, about 7½ rows per 800px screen (6½ on an iPhone 13).** Those closed heights are this fixture's: a row with two tags, a reimbursement chip and a note closes at about 155px. **Opened, on the touch profiles: 226–267px at 380/390px (the same rows were 279–353px before); the one row with a 34-character note opens at 320px / 294px (was 328px).** At 430px that long-note row is 8px taller than before (294 against 286) — its controls used to run past their column on one line and now wrap inside the screen. Full table in DECISIONS #779. (An earlier "165–208px in Chromium" here was measured on a desktop pointer profile and is withdrawn.)

**Critic.** Cycle 1 FAIL (1 P1: open rows taller than before — fixed by the grid). Cycle 2 FAIL (3 P1, all on rows the fixture lacked: a long note overflowed the screen; the first tap after opening a panel from a closed row was lost; the amount editor crushed the payee) — all three fixed and locked. Cycle 3 FAIL (3 P1, all older than the slice but inside what it claimed: the Bank text editor and the account picker ran off the screen; the ten inline row editors reloaded without keeping the reader's place) — fixed, locked, and each fix removed once to see its test fail. The maker's own sweep then found the same dropdown fault in Safari on the already-shipped filter bar (#778) and fixed it at the root, for every dropdown. Cycle 4 FAIL (1 P1, new in the slice: the cycle-2 fix left the note editor's text box sharing a line with Save / Clear / Cancel — 53px wide at 360px, 83px on an iPhone, four to eight characters a line; the test for it checked only that nothing left the screen). Everything else re-tested held: all ten editors keep the reader's place (0px drift in 23 of 24 real saves; the 24th is a date change that re-sorts the row), the height table reproduced cell for cell, the dropdown rule changed no dropdown's size on 21 routes. **Fixed after cycle 4, unreviewed:** on a phone each editor's text field (note, tax tag, bank text) takes a line of its own and the payee's rename box takes its column's width instead of being clipped by it; the open-rows list is no longer capped where a reader can reach it (opening a 31st row closed the first and moved the page). Each locked by a width assertion that fails with the fix removed (note box 19% of the row's content width before, over 60% required).

**Gates on this tree (2026-10-02, local).** verify.sh GREEN — tsc, eslint, vitest 8,681 passed (644 files), next build clean. activity-row.spec.ts 26/26 (13 tests, Chromium Pixel-5 @380 and WebKit iPhone 13). Full Playwright, three runs on the way to this tree: before the cycle-4 fixes, 457 passed, 0 flaky, exit 0; with them, first 451 passed / 4 flaky / **2 failed** (exit 1, a slow 10.8-minute run), then 455 passed / 2 flaky / 0 failed (exit 0). The two failures were rule-inventory.spec.ts:81 and the CSV re-import (transactions.spec.ts:641). Re-run with retries off, three times each on this tree and on the pre-slice commit ca40f713: this tree 0, 0 and 1 failure of 33; ca40f713 0, 2 and 1 — the same two tests failed THERE, and the third (the merchant-filter clear, transactions.spec.ts:298) failed identically on both. They are flakes that predate the slice, not caused by it; the suite is not flake-free. The flakes on the passing run were goal-demo-and-nudge.spec.ts:19 and that same merchant-filter clear. Once, on a run of activity-row.spec.ts alone, a worker did not exit after its tests passed and was force-killed (all 26 passed; not reproduced in six further runs). **On the rebased tree (2026-10-03):** tsc 0, probes tsc 0, eslint 0, vitest 644 files / 8,688 passed, `next build` compiled — run from Git Bash, where `tests/unit/vercel-build.test.ts` fails 2 of 3 because its child `bash` resolves to Git Bash instead of WSL; the same file run from PowerShell: 3 / 3. Then `bash scripts/verify.sh` from PowerShell on the final tree (ledgers included): **VERIFY GREEN, exit 0** — vitest 645 files / 8,690 passed. Full Playwright: **454 passed / 2 flaky / 1 failed** — the failure is `transactions.spec.ts:639` (CSV re-import: the FIRST import never returns, "Importing…" stays disabled). Not this slice: run alone it fails the same way on plain `main` (`48b78387`, in `C:\dev\_sfin`), while CI passed it on that commit (run 37075733851) and it passes alone in the Ask worktree; the local cause is not found (the worktrees' env files are identical). CI is the arbiter. **Shipped proof:** CI on `6596c166` **success**, run 37084952022 (the full e2e gate — `transactions.spec.ts:639` passed there); live `node scripts/u1b-live-deploy-check.mjs` → **DEPLOY PROOF PASS, 13 checks** (rows start closed, 44px chevron, open in place, reopen after reload, no overflow, no page errors).

**Open.** Home's recent-activity note editor runs 56–74px off a phone screen (older than this slice, on another page — TASKS U.1l). With storage blocked, a save lands the reader at the top with the row closed. At 640–~900px wide a real-account row is still 250–350px tall — the compact row stops at `sm` (TASKS U.1k). A chevron tap in the first few hundred ms after paint is dropped (any button before hydration). An opened row prints a tax class twice. The out-of-scope class control ("No class yet", "Money in") is a 44px bordered box on the closed row — TASKS U.1j. Rows reopen at hydration, a few hundred ms after first paint. The shared-household list (`shared-transaction-list.tsx`) is unchanged. At 320px the register overflows by 18px — pre-existing (present with rows closed and the chevron hidden; 320 is below the guarded widths).

## ✅ BUILT 2026-10-02 — SimpleFIN retired as a way to connect (DECISIONS #780)

**Owner ask.** "Simplefin was just a bridge until we can get plaid. We have plaid now. I don't mind getting rid of simplefin if we don't break stuff."

**Shipped.** Nothing offers a new SimpleFIN connection: the door and token form are gone from Accounts and from the first-run panel, and Settings no longer names it. A reader who never used it sees no trace. **Kept, unchanged:** an existing connection's panel (status, Sync now, Disconnect), the sync code, the dashboard repair alert, and every stored SimpleFIN account, transaction and holding. Accounts that outlived their connection still get the "connection was removed" notice, now pointing at the Plaid button below it. No schema change; the database is untouched.

**Production, checked read-only before building:** 0 SimpleFIN connections; 24 SimpleFIN accounts, all joined to Plaid successors; 1,357 transactions and 57 holdings stored through it; 12 Plaid items healthy.

**Gates (local).** verify.sh GREEN — tsc, eslint, vitest 8,669 passed (644 files), next build clean. Full Playwright on the slice before the critic's two copy additions: 428 passed, 3 flaky (goal-demo-and-nudge:19, rule-inventory:81, transactions:149 — all retried green; rule-inventory:81 also fails on the pre-change commit), 0 failed. After them, the seven specs that touch the changed copy: 52 passed, 3 flaky (transactions:298 / :639 / :1015, the known merchant-filter, CSV re-import and needs-a-category flakes), 0 failed. **Critic (Sonnet, separate context): PASS, zero P0/P1** — two of its P2s taken (see #780). CI and live proof: below, once pushed.

**Shipped proof (read 2026-10-03).** CI on `48b78387`: **success**, run 37075733851 (`scripts/ci-status.sh`). Live: `node scripts/x1-live-deploy-check.mjs` → **DEPLOY PROOF PASS 8/8** — demo sign-in; Accounts still offers the Plaid button; no SimpleFIN door, no token form, no SimpleFIN text on Accounts; the privacy policy carries the retirement wording and the Plaid-only connector line; no page errors. (A first draft of the probe read `body.textContent`, which includes Next's inline script payload, and reported SimpleFIN on Accounts; the shipped probe reads rendered text nodes only, collapsed ones included.)

**Open.** With no Plaid credentials configured, CSV and manual accounts are the only ways in. Two old live-check scripts (`h5-`, `k2b-`) still look for the removed button.

## ✅ BUILT 2026-10-02 — Usability pass, wave 1 (TASKS U.1a, DECISIONS #778)

**The ask.** Owner: "do a ui / ux pass and make the app user friendly and intuitive." Audit first (`docs/UX_AUDIT_2026-10-02.md` — 21 ranked findings from screenshots of every route at 380px and 1280px, a first-run walk, WebKit re-checks), then the reversible, figure-neutral fixes.

**Shipped (findings 1–11).** Activity's secondary filters fold behind one Filters control on phones (opens itself when one is in use; desktop unchanged). Forecast milestones are rows on a phone and the balance never wraps; register account names wrap at spaces. Chapter triangles share a line with their titles; five Coach rests get a chevron. The Today feed's four "Details in Recurring below." rows link to Coach's "Worth a look" card instead, where each is listed by name. Forecast and Recurring show their titles. Guilt-free folds its three limits, keeping their consequence on the closed line (its method paragraphs stay open). Settings has an index. Inbox leads with the queue. Home's demo rows print dates in the app's long form. No figure, engine or schema change.

**Local gate (this tree, 2026-10-02 12:59–13:09, `bash scripts/verify.sh` from PowerShell): VERIFY GREEN, exit 0** — tsc 0, probes tsc 0, eslint 0, vitest **643 files passed + 1 skipped / 8660 passed + 1 expected fail + 1 skipped**, `next build` compiled. No `prisma/` diff: the database is untouched. (The first gate of the session was RED — a hand-rolled label class on the Settings index failed `section-label-tokens`, a scratch probe left in the worktree failed eslint, and `vercel-build.test.ts` fails when the gate is launched from Git Bash instead of PowerShell. All three were the maker's, not the product's.)

**Browser tests.** `tests/e2e/usability-pass.spec.ts`: 13 tests, 13 passed on this tree; on the pre-fix `src` the first cut failed 11 of its 12 (the twelfth asserts desktop is unchanged). Full Playwright suite on this tree, three runs: 429 passed + 2 flaky; 428 passed + 2 failed + 1 flaky; 427 passed + 1 failed + 3 flaky. **Every hard failure is one of three tests — `transactions.spec.ts` "CSV import (H.2)" ×2 and `merchant-lens.spec.ts:22` — and all three reproduce on untouched `origin/main` (`ca40f713`, a separate worktree):** baseline full run 415 passed + 3 flaky including the same merchant-lens 60 s timeout; the two CSV tests alone, six repeats each, no retries → 2 of 12 failed on the baseline, 5 of 12 on this tree (too few runs to separate). The failing snapshot is the import button stuck on "Importing…" — the server-action stall those tests' own comments document (TASKS V.1); this slice touches neither the import page nor its action. One flake WAS this slice's: the chapter-title test read two bounding boxes in separate round trips while a chapter was opening (a 136px "offset"); it now reads both from one layout (`topsOf`).

**Critic (separate contexts, Fable; budget 3 of 4).** Cycle 1 FAIL (3 P1), cycle 2 FAIL (1 P1), cycle 3 **PASS — 0 P0 / 0 P1 / 4 P2**, all four folded. What each cycle found and what changed is in DECISIONS #778.

**Shipped: `df348762` on `main`.** **CI run 37038882008 = SUCCESS** (the full VERIFY_E2E gate, read via `scripts/ci-status.sh`, exit 0). Vercel: "Deployment has completed" for that sha. **Live proof: `node scripts/u1a-live-deploy-check.mjs` → DEPLOY PROOF: PASS, 22 checks** on www.aimplifi.app (Filters toggle closed then opening, first row above the nav, forecast balances on one line, both page titles, 4 feed rows linking to Coach, chevron, the limits a closed `<details>` with its consequence line, 15 index links each with one target, queue above the scorecard, zero page errors). The edited `o11d-live-deploy-check.mjs` re-run: PASS.

**Owner's iPhone, same day (two screenshots of his own account).** (1) The folded dropdowns render correctly — labels on a dark field. The blank white boxes were the test WebKit on Windows; U.1i closed. (2) His account owns no tag, so the fold had five selects and the two-column grid left "To" stranded alone — a defect of this slice, invisible on the demo (which has tags). Fixed in the follow-up commit: From and To share a row, the fifth select spans one; locked in `usability-pass.spec.ts` on a tagless sign-up. (3) **What the audit missed:** it walked the demo and an empty new account, never a real account with data — and the demo renders none of the edit controls. Reproduced on a signed-up user: a register row is **300–350px tall at iPhone width, about two rows per screen** (`Range`-free measurement: `txn-row` bounding heights 353 / 345 / 302 / 302 / 352 in Chromium @380; 353 / 345 / 279 / 299 / 302 in WebKit iPhone 13). U.1b is therefore the worst screen in the app, not a nicety; the row redesign is with the owner.

**One more pre-existing flake, measured:** `transactions.spec.ts` "a merchant filter shows itself…" — 1 failure in 15 repeats on this tree and 1 in 15 on `ca40f713`. The chip is a `<button>` whose click is dropped if it lands before hydration.

**Open, and whose call.** Owner: Activity row density on a phone (U.1b) and the phone tab bar / Sign out placement (U.1c) — proposals are in the audit. Owner input: one iPhone screenshot of Activity with Filters open (U.1i) — the test Safari engine drew the dropdowns as blank boxes; not verified on a real device. Queued: U.1d–U.1h.

**Not in this commit.** The Ask-analyst slice (#777) is still uncommitted in the main checkout and still at its human gate; its critic cycle 8 returned FAIL on both lanes this morning (verdicts saved in the main checkout under `docs/scratch/`). This slice was built in a separate worktree and touches none of its files.

## ✅ BUILT 2026-09-25 — O.11d: free-form tags — the last field of the "all other mint and simplifi fields" ask (DECISIONS #775)

**The hole.** Mint/Simplifi give readers a free-form label set with filtering and a per-tag total; Aimplifi had categories, notes, and the two O.15 flags but no label the reader invents. Last open row of the owner's O.11 ask and on the O.13b transaction-list field list (one slice, two complaints).

**Shipped.** Additive schema: `Tag` (per-user `@@unique([userId, name])`) + explicit `TransactionTag` join (Cascade both edges — the retention one-cascade promise). The case fold at the WRITER: `addTransactionTag` matches by lower-cased name and APPLIES the existing tag (race-P2002 re-find), so " Work  TRIP " never mints a twin; two spellings slipping a race are two visible chips, never a hidden wrong figure. Tag naming reuses `categories.ts` verbatim (NFC, invisible-character stripping, the 40-CODE-POINT ceiling). **The tag total is `summarizeTransactions` over the tag-filtered rows — the very function the unfiltered summary uses; zero tag-specific branches anywhere.** One `tag` axis on `TxnFilter`/`filterTransactions`; `TxnView.tags` REQUIRED (tsc enumerated the construction sites). `?tag=` carries the tag ID (a renamed chip would orphan deep links); the toolbar select appears only when the reader owns a tag or a stale `?tag=` needs mirroring — "(tag not found)" in the select AND the `txn-empty-tag-unknown` empty state (the account axis's own U.3 parity). Editor on the detail view beside note/receipts; always-visible chips on register rows; demo fence INSIDE the shared action (fence-by-construction, #242/L.12c) + `rateLimitDurable` on the creating verb; `revalidatePath('/transactions')` only (tags move no figure). Seed: 2 demo tags / 6 assignments, PRNG-free deterministic selection → golden figures byte-identical (SEED_SPEC §Tags; seed.test.ts locks counts + "seeded names pass the live `validateTagName`").

**Maker gate.** `tsc --noEmit` green; `eslint . --max-warnings=0` green; full `vitest run` **8633 passed + 1 expected fail + 1 skipped** (the critic's own independent re-run; my first full run 8632 + the edge-case-heading meta-test fix = 8633); `next build` green; targeted e2e `txn-tags.spec.ts` **6/6 on the mobile-380 project** (first run found two TEST bugs — a wrong badge testid, a chip-text assertion counting the remove button's ×; the app was right both times). Hand-verified cents: `tests/edge-cases/tags-tag-axis-and-total-o-11d.md`.

**Critic (fresh verifier context; it re-ran tsc/eslint/full-vitest/build itself before scoring): PASS — 0 P0 / 0 P1 / 6 P2.** All six folded in-session or recorded: `tag-unknown` empty-state parity shipped (the comment had promised what the code lacked); the demo why now renders on every demo row (the seeded rows are the tagged ones); `rateLimitDurable` guards the creating verb; `maxLength` 2× headroom (browser counts UTF-16 units, server is authority); the cap sentence states the true bound ("to 40"); the 40-char-chip-at-380px pin recorded open.

**CI + live.** One commit, `b1e9164d` (35 files, this slice only) → **CI run 36225862658 = SUCCESS** (the full VERIFY_E2E gate, read 22:44). This push carries `prisma/schema.prisma` (additive `Tag` + `TransactionTag`, no column changes) — the deploy's `db push` created them; proven behaviorally, not assumed: the register dropdown's option list is a live `Tag` query, and the probe read the seeded rows back from production. The demo rows needed an additive PROD seed (deploys run `db push`, never `db seed` — the GL.4 lesson): `scripts/seed-demo-tags-prod.ts` (idempotent, refuses to write unless every join's transaction is verified against the live demo user) ran against the `.env.prod.tmp` URL → **2 tags / 6 joins**. **Deploy proof: `scripts/o11d-live-deploy-check.mjs` → DEPLOY PROOF: PASS, 7 checks** on www.aimplifi.app — the dropdown offers the seeded vocabulary ("work trip", "date night"), the filter shows exactly the 3 seeded rows each carrying its chip, the detail page renders chips with NO input (the fence, explained), zero page errors. (The probe's first run FAILED while the deployment was current-but-unseeded — the select is hidden by design until the reader owns a tag; that is the empty-control rule doing its job, and the reason the prod seed step exists.)

**Still open / residuals.** (1) The name-cap refusal sentence says "to N" here while the five sibling validators (categories, goals, payee, bills, reserves) say "under N" for the same `> N` check — one family-wide copy sweep, deliberately not six files in one slice. (2) No pinned test for a 40-char chip at 380px (the suite runs at 380px with real chips; the construction argument is in the ledger). (3) Tag rename and delete-tag-everywhere surfaces, and a register-side quick-add popover, are post-decision scope (DECISIONS #775). The O.13b STILL-OPEN sub-items now: payee edit, O.13g user-settable status, attachments, mark-as-recurring (O.11d tags closed here).

## ✅ BUILT 2026-09-25 — O.11c: the reimbursement round trip (DECISIONS #774)

**The hole.** A positive row filed `reimbursement` (auto-filed for CONCUR/EXPENSIFY/EXPENSE REIMB descriptors) counted as INCOME in `isIncomeFlowRow` while the O.15 tracker + exclude lever had taken the outflow out of spending — the owner's exact workflow (exclude the work expense, the payback lands) fabricated phantom income on the reports chart, the glass-box panel, the coach savings rate, Ask income/savings answers, the creep income baseline and the spending-plan fallback.

**Shipped.** `isReimbursementInflow` — shared, sign-gated, positive-only: the payback counts on NEITHER side, skipped from `monthlyFlows` and the glass-box panel before the asOf accumulation. NOT a `refund` mirror: netting would understate real spend when the outflow was excluded (the too-generous direction). Tracker stays suggestion-only. `tax-refund` income and `refund` netting untouched. Copy re-derived: MONTH_FLOW_BASIS (both sentences), the Ask income trace + month-flow derivation, the income-pattern docblock, the `money-in` chip (no longer claims income), the coach outstanding card + its detail-view sibling (now name the exclusion lever as the mechanism), the `categories.ts` comment. No schema change; demo figures byte-identical (the seed holds zero reimbursement rows — verified).

**Maker gate.** Cycle 1: fail-old **7 failed | 92 passed** → verify GREEN → targeted e2e **10/10** (month-flow-drilldown, reports-total-reconciles, savings-rate-drilldown, o20h-one-definition). Cycle 2 (copy fixes): verify GREEN (FRESH_TSC=1), targeted units **942/942** (5 suites), e2e **17/17** (spend-class/action-menu incl. the reimbursement tracker flow). Final: `bash scripts/verify.sh` FRESH_TSC=1 → ✅ VERIFY GREEN, unit **8611 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped**. Live sizing probe (`scripts/audit-probes/o11c-reimbursement-income.mts`, read-only): **0 reimbursement inflows corpus-wide** — prevention; no live figure moves.

**Critic (fresh context): cycle 1 FAIL 1 P1 + 5 P2 → fixed; cycle 2 PASS — 0 P0 / 0 P1 / 3 delta P2** (all three folded or satisfied by these ledger writes; recorded in DECISIONS #774).

**CI + live.** First push `c9876209` → CI 36208149669 ❌: the ledger tripwire (`ledger-decisions-index.test.ts`) fired — DECISIONS #774 shipped without its `docs/DECISIONS_INDEX.md` line (the state-writer edge wrote DECISIONS.md after the final local verify, so the tripwire only saw the tree that was pushed); index line added, rule recorded in REGRESSION_LEDGER. `36722fca`'s run 36209292926 = **cancelled** (superseded by the deploy-proof fix push, exit 3). **Final: CI run 36209828932 on `aa55dab9` = SUCCESS (full VERIFY_E2E gate, read 22:08)**. Live deployment verified behaviorally (no Vercel token on this VM, so the dashboard label is not readable here): `scripts/o11c-live-deploy-check.mjs` → **DEPLOY PROOF: PASS, 5 checks** on www.aimplifi.app — the production panels render the new O.11c basis clauses ("counts on neither side" / "counts against neither this figure nor the income one"), markers unique to this build, so the deployed bundle IS this slice's; demo flow chart drew 6 months; no page errors. Note: the probe's first five attempts read `innerText`, which hides the collapsed basis text and produced 5 false FAILs while the deployment was already current — the proof now reads each panel element's `textContent`, the same locator strategy the e2e uses.

**Still open / residuals.** (1) The non-excluded round trip strands the purchase in spending with no surface explaining why (deliberate conservative direction; disclosure design work). (2) The Ask income answer enumerates less than its own trace line (no false sentence — defensible depth gap). (3) L.12 P2 residuals carry over (GRILLE non-dining false positives, GRILLS unpinned by a test, the proposal-rung e2e coverage maker-asserted). The O.13b STILL-OPEN sub-items now: payee edit, O.13g user-settable status, attachments, mark-as-recurring (O.11d tags closed above).

## ✅ BUILT 2026-09-24 — Dining rule matches Grille; the owner's inbox revives on read (DECISIONS #773)

**The hole.** L.12(c): the owner's screenshot showed "Goose Pond Bar Grille" (8 txns) at "Suggestion: none yet" — the generic dining keyword rule was `\bGRILL\b`, which cannot match GRILLE (no word boundary before the trailing -e).

**Shipped.** One token widened (`GRILLE?S?`). Triage re-runs `categorize()` per row on read, so rows already in the queue get the suggestion with no backfill (O.12d's repair route separately covers pre-L.12 provider hints). The two #303 fixtures that seeded the descriptor as "a ruleset miss" moved to a verified true miss; the e2e became a two-ladder spec. No schema change.

**Maker gate.** `bash scripts/verify.sh` → ✅ VERIFY GREEN, unit **8601 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped** (first run red: the #303 plaid-map fixture was caught by the widened rule; moved to a verified true miss, re-run green). Fail-old **4 failed | 115 passed** pre-fix. Playwright triage two-ladder **2/2** (17.2s, mobile-380). `eval:categorize` byte-identical (**480 | 59 | 421 | 410 | 11 | 97.4%**).

**Critic (fresh context): cycle 4 PASS — 0 P0 / 0 P1 / 3 P2** (cycles 1–3 reproduced gates, cut off before a verdict; recorded in DECISIONS #773).

**CI + live.** First push 9f337a06 → CI 36059727655 ❌: the write-in spec's by-design tripwire fired (its seeded "merchant the ruleset must not know" was exactly the merchant this slice teaches it); fixture moved to a verified true miss, spec 2/2 locally → **4f238856 → CI 36063077472 ✓ success (16m14s)**, Vercel **READY** (F1ejGigF4JCNNLEVchs3MAHrxWR7), `scripts/l12c-live-deploy-check.mjs` → **DEPLOY PROOF: PASS, 3 checks** on www.aimplifi.app (demo /triage healthy; the demo seed holds no GRILLE merchant — the behavioral discriminator is the CI e2e on this sha).

**Still open / residuals.** (1) P2-1: rare non-dining GRILLE merchants (BMW GRILLE REPLACEMENT-class) confidently auto-file dining — visible, one-tap re-filable. (2) P2-2: the GRILLS plural is newly matched but unpinned by a test. (3) P2-3: the e2e's proposal-rung coverage is maker-asserted. (4) L.12(d) live-corpus auto-file coverage UNVERIFIED (no Plaid creds). Inbox and Activity remain two queues by design. Mobile header still scrolls.

## ✅ BUILT 2026-09-22 — Month-rest names Monthly Money Review the way the card does (DECISIONS #772)

**The hole.** #771 left the closed rest saying “the monthly review” while the card says “Monthly Money Review”.

**Shipped.** The summary ends with the card’s label, Monthly Money Review, from one shared string the card also renders. No schema change.

**Maker gate.** `bash scripts/verify.sh` → VERIFY GREEN, unit **8596 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped**. After the eight sentences were written as full literals: summary unit 4/4. Playwright coach-chapters **7/7**. Browser on that build, demo Coach: rest closed; summary ends “and Monthly Money Review”; opening the row shows the card label “Monthly Money Review”.

**Critic (fresh context): PASS UX 9 / 0 P0 / 0 P1 / 3 P2.** Mobile 8, a11y 8, code quality 9, coverage 8.

**CI + live.** `d88c7698` on `origin/main`. No `prisma/` diff. **CI verify run 35808922617 = SUCCESS**. Vercel `dpl_EQrvvfKwkFzasTJgy2s49PzuwDdd` **READY** (`www.aimplifi.app`). Live demo Coach: rest closed; summary ends “and Monthly Money Review”; opening it shows the card label “Monthly Money Review”. Marker: `Monthly Money Review`.

**Still open / residuals.** (1) The e2e locks only the all-present sentence. (2) The other rest titles are still hand-copied, so case and “the” can drift from those cards. (3) The shared review lock is a source grep. (4) Rest stays in the HTML when closed. Inbox and Activity remain two queues by design. Mobile header still scrolls.

## ✅ BUILT 2026-09-22 — Month-rest names the life-energy view from the card gates (DECISIONS #771)

**The hole.** #770 named the always-on purchases card “hours” (the toggle) and copied the three optional-card gates beside the cards.

**Shipped.** The summary says “life-energy view”. Automation, life energy by category, and what Aimplifi caught stay named only when those cards render, through the same predicates the cards use. No schema change.

**Maker gate.** `bash scripts/verify.sh` → VERIFY GREEN, unit **8595 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped**. Playwright coach-chapters **7/7**.

**Critic (fresh context): PASS UX 8 / 0 P0 / 0 P1 / 4 P2.**

**CI + live.** `d67cc400` on `origin/main`. No `prisma/` diff. **CI verify run 35803590762 = SUCCESS**. Vercel `dpl_A35q9qMiqmEgXYfHEih6rRbpeV2X` **READY** (`www.aimplifi.app`). Live demo Coach: rest closed; summary “Lifestyle creep, room for error, the automation blueprint, life-energy view, life energy by category, what Aimplifi caught, and the monthly review”; creep hidden. Marker: `life-energy view`.

**Still open / residuals.** (1) ~~Summary says “the monthly review”; the card says “Monthly Money Review” (P2-1)~~ — **CLOSED #772.** (2) The life-energy phrase is not locked against the card source (P2-2). (3) The e2e locks only the all-present sentence (P2-3). (4) The shared-gate lock is a source grep (P2-4). (5) Rest stays in the HTML when closed. Inbox **12** and Activity **17** remain two queues by design. Mobile header still scrolls.

## ✅ BUILT 2026-09-21 — Month-rest summary names every claim it hides (DECISIONS #770)

**The hole.** #769 left the closed rest row naming creep, room for error, hours, and the review, while the automation blueprint, life energy by category, and what Aimplifi caught sat inside unnamed.

**Shipped.** The summary names those three only when that card renders. The four always-present claims stay named. No schema change.

**Maker gate.** `bash scripts/verify.sh` → VERIFY GREEN, unit **8593 passed + 1 expected fail + 1 skipped / 640 files + 1 skipped**. After the page-gate and full-sentence locks: chapter unit 1/1, summary unit 1/1, Playwright first-fold **1/1**. Local demo Coach at 380×800: rest closed; summary is the full sentence; creep stays hidden (`checkVisibility` false) until the row opens.

**Critic (fresh context): PASS UX 8 / 0 P0 / 0 P1 / 4 P2.** Same session closed P2-3 and P2-4. P2-1 and P2-2 remain.

**CI + live.** `33039e2c` on `origin/main`. No `prisma/` diff. **CI verify run 35669406939 = SUCCESS**. Vercel `dpl_HaGw5t5n84TAvafXehRYPpds2Vpc` **READY** (`www.aimplifi.app`). Live demo Coach at 380×800: rest closed; summary “Lifestyle creep, room for error, the automation blueprint, hours, life energy by category, what Aimplifi caught, and the monthly review”; creep hidden. Marker: `coach-month-rest`.

**Still open / residuals.** (1) The three presence booleans are duplicated beside the card null-gates (P2-1). (2) Life energy is still named “hours” (P2-2). (3) Rest stays in the HTML when closed. (4) Inbox **12** and Activity **17** remain two queues by design. Mobile header still scrolls.

## ✅ BUILT 2026-09-21 — This month opens on the destination and the flags (DECISIONS #769)

**The hole.** #768 left why, assumptions, and the FI-date essay on the open fold. The destination was a small title, and the flags sat below goals.

**Shipped.** Headline is the destination at 24px. Why stays. Skipped rungs, cards this cycle, and assumptions start closed, and that summary names them. Flags sit under the destination; goals follow the flags. FI date and the 90-day cash-flow walk, when present, start closed under a summary that names them. No schema change.

**Maker gate.** `bash scripts/verify.sh` → VERIFY GREEN, unit **8592 passed + 1 expected fail + 1 skipped / 639 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100, mobile-380): coach-chapters, phase3, employer-match, tax-advantaged, next-dollar-frozen **14/14**. Browser walk: assumptions open to the order sentence; worked-out opens to the 7.00% basis; biggest lever finishes inside 800.

**Critic (fresh context): cycle 1 FAIL UX 5 / 1 P1. Cycle 2 PASS UX 8 / 0 P0 / 0 P1 / 3 P2.** P1 was the FI-date claim under a provenance-only summary. Same session closed P2-2 and P2-3 (both-branch string; “cash-flow walk”).

**CI + live.** `0045560c` on `origin/main`. No `prisma/` diff. **CI verify run 35662854457 = SUCCESS**. Vercel `dpl_7c6uFDKG1cRLTW62tFq5XHcUoyuf` **READY** (`www.aimplifi.app`). Live demo Coach at 380×800: headline **24px** “Next extra dollar: investing”; closed “What we skipped, cards this cycle, and the assumptions”; closed “What this does to your FI date, and how those amounts were worked out”; biggest-lever bottom **787**. Marker: `next-dollar-more`.

**Still open / residuals.** (1) Month-rest summary does not name automation, fulfillment, or value receipts (P2-1). (2) Rest stays in the HTML when closed. (3) Inbox **12** and Activity **17** remain two queues by design. Mobile header still scrolls.

## ✅ BUILT 2026-09-21 — This month first fold is the extra dollar and the flags (DECISIONS #768)

**The hole.** #767 left Coach This month open on next-dollar, but creep, hours, runway, and the monthly review still painted in that chapter.

**Shipped.** Closed `coach-month-rest` after the extra dollar and the flags. Summary names room for error (Ask’s runway answer lands on `/coach`). Goals stay in their own closed disclosure. Reimbursements and opportunity flags stay on the first fold. No schema change.

**Maker gate.** `bash scripts/verify.sh` → VERIFY GREEN, unit **8592 passed + 1 expected fail + 1 skipped / 639 files + 1 skipped**. After the summary named room for error: chapter unit 1/1, `next build` clean, Playwright first-fold **1/1**.

**Critic (fresh context): cycle 1 FAIL UX 7 / 1 P1. Cycle 2 PASS UX 8 / 0 P0 / 0 P1 / 4 P2.**

**CI + live.** `f86b2e1b` on `origin/main`. No `prisma/` diff. **CI verify run 35654006430 = SUCCESS**. Vercel `dpl_ETE64G8VDPUc5TLKx8wYnGEwr9Yo` **READY** (`www.aimplifi.app`). Live demo Coach: next extra dollar investing; rest summary names room for error and stays closed; Trajectory is the next chapter. Marker: `coach-month-rest`.

**Still open / residuals.** (1) First fold still includes next-dollar’s why/assumptions and the opportunity list. (2) Automation, fulfillment, and value-receipts are in the rest disclosure but not in the first-fold lock. (3) Rest stays in the HTML when closed. (4) Goals disclosure has no test id; the rest helper opens by click. Inbox **12** and Activity **17** remain two queues by design. Mobile header still scrolls.

## ✅ BUILT 2026-09-21 — UX A-grade (DECISIONS #767)

**The hole.** Live review C / 5.1: cash-needed 14px, synonym nav, Plan vs Spending, two filing counts, Today restated the hero, Coach/catalog/sign-in dumps.

**Shipped.** Token on the amount button; CardTitle skips sm when the class is 3xl/4xl. Guilt-free / Budgets labels. Home “N to file on Activity.” Today display-filter. Coach next-dollar first; catalogs closed; demo CTA primary.

**Maker gate.** `bash scripts/verify.sh` → VERIFY GREEN, unit **8592 passed + 1 expected fail + 1 skipped / 639 files + 1 skipped**. Playwright: home-stage 2/2 (amount ≥28px), today-feed 8/8, desktop-header 1/1, coach-chapters 6/6, phase5-a11y keyboard 1/1.

**CI + live.** `c812a015` on `origin/main`. No `prisma/` diff. First CI `35625811096` FAILED (first Tab expected email after demo became primary). **CI verify run 35628035698 = SUCCESS**. Vercel `dpl_FxkvZkiBfk7bdwyuJneJ7QnAXppg` **READY** (`www.aimplifi.app`). Live demo: `[data-testid=cash-needed-amount]` **36px / $5,412.33**; Today has **0** `nudge-payment_due`; nav **Guilt-free / Budgets / Trends**; chip **17 to file on Activity**; sign-in **or sign in to your account**.

**Still open / residuals.** ~~Coach This month still lists creep/hours/review under the open chapter~~ — **CLOSED #768.** Inbox **12** and Activity **17** remain two queues by design. Re-grade vs C/5.1 after #767 was **~8.4 / B+**; the first-fold hole is #768.

## FOUND 2026-09-21 — UX adversarial review (owner: grades first, then decide)

Live demo walk. **5.1 / 10 (C). 0 P0 / 8 P1 / 6 P2.** Closed by #767 maker (re-grade after live walk).

## ✅ BUILT 2026-09-21 — Clear chapter hold on the next pointerdown (DECISIONS #766)

**The hole.** #765 P2-4 / P2-5: tap-open did not arm hold, so a leftover click could native-close; Enter's 500ms hold could swallow a real close.

**Shipped.** First click-open arms `holdOpen`. After ready, `pointerdown` (and Space/Enter-to-close) clears it. 500ms fallback kept. No `el.open = false`. No schema change.

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 6/6, home-chapters 6/6 (**12/12**).

**CI + live.** `41973d94` on `origin/main`. No `prisma/` diff. First CI `35559960169` FAILED (leftover after `toBeVisible`). **CI verify run 35561069817 = SUCCESS**. Vercel `dpl_BesMXdeETanZZZpKRnXx2FLej6jA` **READY** (`www.aimplifi.app`). Live `/` → 307 `/sign-in`. Leftover click on Picture holds `$144,804.74`. Marker: `clearHoldOpen` / `onPointerDown`.

**Still open / residuals.** (1) RSC still serializes chapter children. (2) e2e harness still auto-opens chapters. (3) M.4 route-by-route restyle owner-eyeball-gated. (4) **P2-1:** a leftover that also fires `pointerdown` can still native-close. (5) **P2-2:** 500ms timer still the only backstop for click-only leftovers. (6) **P2-3:** chapter units are source greps.

## ✅ BUILT 2026-09-20 — Hold first chapter open through the leftover click (DECISIONS #765)

**The hole.** #764 P2-4 / P2-2: after `readyRef` flipped, Enter's synthesized click or a UA-first leftover click native-closed the chapter.

**Shipped.** `holdOpenRef` arms on `adopt()` and first-open Enter. Leftover click/keydown `preventDefault`s while armed. First click-open does not arm. No `el.open = false`. No schema change.

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.** P2-1/P2-2 closed same-session (`HTMLElement.click()` leftover + next click closes). Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 6/6, home-chapters 6/6 (**12/12**).

**CI + live.** `5b9abc97` on `origin/main`. No `prisma/` diff. **CI verify run 35548078940 = SUCCESS**. Vercel Production `dpl_3XaasU1ydKTcRZ52xRW6QBSoTYab` **READY**, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. Live demo first-open Enter on Picture holds `net-worth-amount` `$144,804.74` already in the open details. Marker: raw `5b9abc97` has `holdOpenRef` / `armHoldOpen`.

**Still open / residuals.** (1) RSC still serializes chapter children. (2) e2e harness still auto-opens chapters. (3) M.4 route-by-route restyle owner-eyeball-gated. (4) ~~**P2-4:** 500ms hold after Enter can swallow one real close~~ — **CLOSED #766** for pointer/keyboard close. (5) ~~**P2-5:** tap-open then a late ghost click can still native-close~~ — **CLOSED #766** for click-only leftovers. (6) **P2-3:** chapter units are source greps (carried as #766 P2-3).

## ✅ BUILT 2026-09-20 — UA-first chapter open mounts the body before paint (DECISIONS #764)

**The hole.** #763 P2-1 / P2-5: a UA that toggled `<details>` first could paint an empty shell; the `toggle` listener attached after paint.

**Shipped.** `MutationObserver` on `open` + `toggle` in `useLayoutEffect`. `flushSync` mounts children in that microtask. Click/Space/Enter `preventDefault` until `readyRef` after first open. No `el.open = false`. No schema change.

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 5/5, home-chapters 5/5 (**10/10**).

**CI + live.** `6b9e5dff` on `origin/main`. No `prisma/` diff. **CI verify run 35543058639 = SUCCESS**. Vercel Production `dpl_Dmxn5FSFq4yDckemvucLsEcWJTbT` **READY**, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200. Live demo Picture open holds `net-worth-amount` `$144,804.74` already in the open details. Marker: raw `6b9e5dff` has `flushSync` / `MutationObserver` / `readyRef`.

**Still open / residuals.** (1) RSC still serializes chapter children. (2) e2e harness still auto-opens chapters. (3) M.4 route-by-route restyle owner-eyeball-gated. (4) ~~**P2-4:** late click after `readyRef` can native-close~~ — **CLOSED #765.** (5) ~~**P2-2:** first-open Enter is coded; e2e locks Space first-open and Enter after a remount~~ — **CLOSED #765.** (6) **P2-3:** chapter units are source greps (carried as #765 P2-3).

## ✅ BUILT 2026-09-20 — Space/Enter opens a chapter with the body already there (DECISIONS #763)

**The hole.** #762 residual (3): Space/Enter could empty-open if a UA toggled `<details>` before click.

**Shipped.** Space/Enter `preventDefault` while unmounted; same mount-then-open as click. `onToggle` mounts children if a UA already opened; does not force-close. No schema change.

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 5/5, home-chapters 5/5 (**10/10**).

**CI + live.** `dcc78112` on `origin/main`. No `prisma/` diff. **CI verify run 35491937395 = SUCCESS**. Vercel Production `dpl_8PwomDELAYoZ8CG2n16xbRDWh91n` **READY**, aliases include `www.aimplifi.app`. Live demo: Space on Picture opens with `net-worth-amount` `$144,804.74` already in the open details. Marker: raw `dcc78112` has `onKeyDown` / `mountedRef`.

**Still open / residuals.** (1) RSC still serializes chapter children. (2) e2e harness still auto-opens chapters. (3) ~~Space/Enter empty-open if a UA toggles before click~~ — **CLOSED #763.** (4) M.4 route-by-route restyle owner-eyeball-gated. (5) ~~**P2-1:** UA-first-toggle empty flash~~ — **CLOSED #764.** (6) **P2-2:** first-open Enter still unproven (carried as #764 P2-2). (7) **P2-3:** chapter units are source greps. (8) **P2-4:** a late click after ready can native-close (carried as #764 P2-4). (9) ~~**P2-5:** `toggle` listener attaches after paint~~ — **CLOSED #764.**

## ✅ BUILT 2026-09-19 — Open chapter bodies before the shell (DECISIONS #762)

**The hole.** #761 first-open flash: empty `<details>` then cards. Nested Coach landmarks hid the land ring.

**Shipped.** Mount, then open in `useLayoutEffect`. First summary click `preventDefault`s until mounted. Landmark wrappers drop `focus:outline-none`. Home hrefs use `new URL`. No schema change.

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 7 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 4/4, home-chapters 4/4, phase1 2/2 (**10/10**).

**CI + live.** `1d82018f` on `origin/main`. No `prisma/` diff. **CI verify run 35486194628 = SUCCESS**. Vercel Production `dpl_Aq99idazihofW8xk9JNC2kA84wVD` **READY**, aliases include `www.aimplifi.app`. Live demo: Picture open already holds `net-worth-amount`. `/coach#coach-money-dials` opens Habits with dials focused and no `outline-none`; Trajectory stays closed. Marker: raw `1d82018f` has `pendingOpen`.

**Still open / residuals.** (1) RSC still serializes chapter children. (2) e2e harness still auto-opens chapters. (3) ~~Space/Enter empty-open if a UA toggles before click~~ — **CLOSED #763.** (4) M.4 route-by-route restyle owner-eyeball-gated.

## ✅ BUILT 2026-09-19 — Mount unread chapter bodies after first open (DECISIONS #761)

**The hole.** Closed Home/Coach chapters still committed every card into first HTML. Cycle 1: `#coach-money-dials` became a dead jump.

**Shipped.** Unread bodies unmount until first open. Nested Coach landmarks reveal the parent. Daily loop + This month stay mounted. No schema change.

**Critic (fresh context): cycle 1 FAIL UX 7 / 1 P1. Cycle 2 PASS UX 9 / 0 P0 / 0 P1 / 7 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 4/4, home-chapters 4/4, phase1 2/2 (**10/10**).

**CI + live.** `c38a2168` on `origin/main`. No `prisma/` diff. **CI verify run 35480517482 = SUCCESS**. Vercel Production `dpl_GDwYXPVDFmWpkXq934DJPELyDbZR` **READY**, aliases include `www.aimplifi.app`. Live demo Home: Picture/Adjust closed; `net-worth-amount` and `home-plan-figures` not in the DOM. Live Coach: Trajectory/Habits closed; `fi-card` / `money-rules-card` / `coach-money-dials` absent until open; Trajectory open mounts `fi-card`; Change your assumptions opens Habits and focuses money-dials. Marker: raw `c38a2168` has `{mounted ? children : null}`.

**Still open / residuals.** (1) RSC still serializes chapter children (not `next/dynamic`). (2) e2e harness still auto-opens chapters. (3) ~~Empty-open flash before children commit~~ — **CLOSED #762.** (4) ~~Nested landmark wrappers use `focus:outline-none`~~ — **CLOSED #762.** (5) M.4 route-by-route restyle owner-eyeball-gated.

## ✅ BUILT 2026-09-19 — Home chapter jump nav, focus on open, valid summary lead (DECISIONS #760)

**The hole.** #759 residuals: no Home jump nav; hash/nav did not move focus; `<p>` in `<summary>`; marker locked by grep only.

**Shipped.** `home-chapter-nav` after radar, before Adjust. Hash/nav open + focus. Span leads. Painted `listStyleType` e2e. One `showHomeSetup` flag. No schema change.

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 5 P2** (P2-1 outline / P2-2 setup flag closed same-session). Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**; after P2 polish: tsc 0, eslint touched 0, chapter units 2/2, next build clean. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 2/2, home-chapters 4/4 (**6/6**).

**CI + live.** `19dec793` on `origin/main`. No `prisma/` diff. **CI verify run 35457883847 = SUCCESS**. Vercel Production `dpl_4gNKGsxYWkhTnvxDLAqQnUx9bt3n` **READY**, aliases include `www.aimplifi.app`. Live demo Home 390: `home-chapter-nav` after radar; Adjust/Picture closed; links Adjust the plan / The picture / Home setup. Marker: raw `19dec793` has `home-chapter-nav`.

**Still open / residuals.** (1) **P2-3:** `listStyleType` is not a `::marker` visual lock. (2) **P2-4:** nav vs radar is source-order, not a painted y-assert. (3) **P2-5:** nav links are `text-sm` (same as Coach). (4) e2e harness still auto-opens chapters. (5) ~~Coach SSR still ships every card~~ — **CLOSED #761** (DOM/hydration; RSC payload residual remains). (6) M.4 route-by-route restyle owner-eyeball-gated.

## ✅ BUILT 2026-09-19 — Coach chapters: native marker, same-hash re-open, coaching voice (DECISIONS #759)

**The hole.** #757 P2s: hidden Coach triangle, Trajectory tap no-op, IA-voice leads. #758 P2-4: Home hash-open untested.

**Shipped.** Native disclosure marker on Coach. Click on `#id` opens the chapter even when the hash is unchanged. Trajectory/Habits leads are second-person money copy. Home hash `#home-picture` locked. No schema change.

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 3 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright (rebuilt `next start` 127.0.0.1:3100): coach-chapters 2/2, home-chapters 3/3, desktop-header 1/1 (**6/6**).

**CI + live.** `eb4848c3` on `origin/main`. No `prisma/` diff. **CI verify run 35453050602 = SUCCESS**. Vercel Production `dpl_2xExX9An6YeS7xbq4VE4kPSYv8Pe` **READY**, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`. Demo Coach 390: Trajectory/Habits closed; leads “Your savings rate…” / “Your money dials…”; summary `list-style-type: disclosure-closed`. Marker: raw `eb4848c3` `coach-chapter.tsx` has `getAttribute('href')` and no hide tokens.

**Still open / residuals.** (1) ~~**P2-1:** marker locked by source grep~~ — **CLOSED #760:** e2e `listStyleType` `/disclosure|disc/`. (2) ~~**P2-2:** `<p>` inside `<summary>`~~ — **CLOSED #760:** `<span className="mt-1 block…">`. (3) ~~**P2-3:** hash/nav open does not move focus~~ — **CLOSED #760.** (4) e2e harness still auto-opens chapters. (5) Coach SSR still ships every card. (6) ~~No Home chapter jump nav~~ — **CLOSED #760.** (7) M.4 route-by-route restyle owner-eyeball-gated.

## ✅ BUILT 2026-09-19 — Home chapters: daily loop open, dump closed (DECISIONS #758)

**The hole.** #757 residual (5): Home below the two numbers was still a long stack. Critic cycle 1: UX 6, Welcome back + radar hidden in closed chapters.

**Shipped.** Closed chapters: Adjust (plan figures), Picture (savings / spending / net worth / …), Setup (deepen + push). Open loop: stage, recent, Today, goals, alert banners, onboarding, return-moment, cash-flow radar. Native disclosure marker. No schema change.

**Critic (fresh context): cycle 2 PASS UX 9 / 0 P0 / 0 P1 / 4 P2.** Cycle 1 FAIL 2 P1. Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8584 passed + 1 expected fail + 1 skipped / 637 files + 1 skipped**. Playwright: home-chapters 2/2, home-stage 2/2, phase1 2/2, today-feed 7/7, idle-cash 1/1, paw-lens 1/1 (**16/16**).

**CI + live.** `64173200` on `origin/main`. No `prisma/` diff. **CI verify run 35448886067 = SUCCESS**. Vercel Production `dpl_Ebo4UwJRwsQp1YyN5jm24hjoHUAS` **READY**, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`. Demo Home 390: `Adjust the plan` and `The picture` present and closed (`open === false`). Marker: raw `64173200` has `home-chapter.tsx`.

**Still open / residuals.** (1) **P2-3:** default e2e harness opens Home chapters. (2) ~~**P2-4:** hash-open untested~~ — **CLOSED 2026-09-19 (DECISIONS #759):** `#home-picture` e2e; same-hash click-open. No Home jump nav remains. (3) ~~Coach SSR still ships every card~~ — **CLOSED #761.** (4) ~~#757 Coach P2s (chevron / same-hash / Trajectory voice)~~ — **CLOSED #759.** (5) M.4 route-by-route restyle owner-eyeball-gated.

## ✅ BUILT 2026-09-19 — Visual IA: grouped sidebar, Home stage, Coach chapters (DECISIONS #757)

**The hole.** Live www.aimplifi.app review: wrapping 19-pill desktop nav, Home as a feature dump, Coach as a 7,076px essay. Critic cycle 1: UX 5, 4 P1s. Cycle 2: UX 7, 2 P1s (labeled feed; 19 bare nouns).

**Shipped.** Grouped desktop sidebar (4 synonym rows described). Home `home-stage` cash-needed first; pair token; plan form off the fold; cash-needed dues/links/assumptions start closed so guilt-free finishes ≤800 at 380 on CI Linux chrome. Trends nav line starts "Category movers" (not "What changed"). Coach three `<details>` chapters, Now open, others closed until jump. Brand mark + uncolored wordmark; sign-in `<h1>`. Money display/pair/negative tokens. No schema change.

**Critic (fresh context): cycle 3 PASS UX 9 / 0 P0 / 0 P1 / 4 P2.** Maker gate: `bash scripts/verify.sh` → VERIFY GREEN, unit **8583 passed + 1 expected fail + 1 skipped / 636 files + 1 skipped**. Playwright (new build): home-stage 2/2, phase1 2/2, trends 3/3, mobile-nav 2/2, forecast 3/3, card-unknown-due 3/3, dashboard-duplicate-disclosure 5/5 (**21/21**).

**CI + live.** `b92219e2` on `origin/main`. No `prisma/` diff. **CI verify run 35426137075 = SUCCESS** (`main`; prior `bec0b32e` run 35424012696 FAILED on fold + Trends collision). Vercel Production `dpl_AKbNTBWUnN3RpydQtKgwabMCiG7w` **READY** on that sha, aliases include `www.aimplifi.app`. Live unsigned `/` → 307 `/sign-in`; `/sign-in` → 200 with brand-mark + h1. Demo Home: `cash-needed-dues` closed, due-date-list hidden, Trends nav "Category movers…". Marker: `raw.githubusercontent.com` on `b92219e2` finds `cash-needed-dues` and `Category movers`; `bec0b32e` Trends description still started with `What changed`.

**Still open / residuals.** (1) ~~**P2-1:** chapter summaries hide the disclosure marker~~ — **CLOSED #759.** (2) ~~**P2-2:** same-hash Trajectory re-click is a no-op~~ — **CLOSED #759.** (3) ~~**P2-3:** Trajectory lead is IA voice~~ — **CLOSED #759.** (4) ~~**P2-4:** Habits collapse and desktop description text are not e2e-locked~~ — **CLOSED #759.** (5) ~~Home below the stage is still a long stack~~ — **CLOSED #758.** (6) ~~Coach SSR still ships every card in the DOM~~ — **CLOSED #761.** (7) M.4 route-by-route restyle remains owner-eyeball-gated.

## DECIDED 2026-09-18 — Owner Yes on ops walkthrough + two live writes (DECISIONS #751)

Owner: **"3. Yes. 4. Yes."** First-timer steps live in `docs/OPS_WALKTHROUGH.md`
(Neon History window, Vercel **Settings → Cron Jobs → View Logs**, Sentry
`SENTRY_DSN` + Redeploy + Settings **Activation checklist**, Combined-accounts
**Worth a look:** Undo only, `npm run seed:demo-holdings`). This VM cannot
execute the two writes (no `DATABASE_URL`; will not decrypt Vercel env). Cron
fire still **UNVERIFIED** (24h production `requestPath` group: zero `/api/cron/*`
lines — Hobby ~1h retention). Do not undo GENUINE/UNTESTABLE links. Do not flip
`DATA_PROVIDER=plaid`. Shipped `19fc703e` on `main`; CI **35376970883 SUCCESS**;
Vercel `dpl_AQAigaAKyGswkes9coT5bhpUqyxU` READY.

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

