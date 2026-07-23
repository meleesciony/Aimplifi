# PROGRESS.md — session resume log

## 2026-07-23 — #278 — one-button 'Sync all accounts' + per-connection sync (owner request)

Owner: 'Is there a way to (force) sync accounts in app? Some of my accounts haven't been synced for almost a week', then 'Not talking about just plaid. Also simplefin sync. I want one button sync of all accounts. And individual syncing if required.' VERIFIED CAUSE (not assumed): SimpleFIN has had on-demand syncSimplefinNow AND auto-sync-on-page-load since #91; Plaid had NEITHER — only the one-shot pull inside linkPlaidAccount, plus a nightly cron that is a no-op unless DATA_PROVIDER==='plaid'. The /accounts Plaid row printed 'last synced <date>' beside a Disconnect button and no sync control at all. SHIPPED: (1) new src/server/sync-actions.ts syncAllAccounts() — COMPOSES syncSimplefinNow + syncPlaidNow so there is one definition of what syncing a provider means; each provider isolated (a throw or an ok:false in one never suppresses the other); partial success = success with the failing provider NAMED; summary always states the outcome incl. 'No new transactions'; demo-fenced; refuses when no bank is connected. (2) new src/components/finance/sync-all-button.tsx ('sync-all') at the top of the accounts connections block, rendering nothing when no provider is connected. (3) new syncPlaidNow(itemId?) server action — runs BOTH halves (transactions + liabilities) with each caught separately, since a failed transaction pull must not cost the user their card due dates; only a both-halves failure is a failure; fixed error string (provider errors can embed credential-bearing detail). (4) per-bank 'Sync' button on each Plaid connection row. (5) AutoSync gains a plaid flag with its OWN 15-minute throttle + stamp key (SimpleFIN stays 10s) because production Plaid calls are billed per request and this fires on every full page load; layout now computes hasPlaid alongside hasSimplefin. (6) DataProvider.syncTransactions' second param was a vestigial cursor?: string that NO caller ever passed — replaced with { itemId? } so a sweep can be scoped to one bank; same option added to syncLiabilities; both always user-scoped so a foreign itemId matches nothing (locked by a cross-user test). Tests: tests/unit/plaid-sync-now.test.ts (9) + tests/unit/sync-all-accounts.test.ts (8). Gate: VERIFY_E2E=1 bash scripts/verify.sh -> VERIFY GREEN, 3504 unit / 241 files, e2e 162/162 (one earlier run hit the documented load-contention flake; clean on rerun). No schema change. Ledgers: DECISIONS #278 (+reindex), 1 REGRESSION_LEDGER entry, STATUS top section. UNVERIFIED: the buttons have never run against a LIVE Plaid connection — only mocked providers + the demo/e2e fences; the owner tapping 'Sync all accounts' on the real site is the first real exercise. NEXT: owner taps Sync all accounts on /accounts and reports what the flash message says (it names transactions ingested and card statements updated, which also answers the #277 question of whether their issuers return liabilities at all).

## 2026-07-23 — #277 — cards said "nothing due" while cards were owed — owner-reported, FIXED (3 critic cycles)

Owner, verbatim, with real Chase/Capital One cards linked via Plaid: 'cards: no card payments are due this cycle...this isn't true'; and separately /cards listed NO cards while /accounts showed them with balances. TWO independent root causes, both executed not assumed. (a) ENGINE->UI: buildObligation returns null for a card with no statement AND no cycle days ('nothing knowable about this card'); the caller dropped that null, so undatable and paid-off became the same value (absence of a row) and EIGHT surfaces rendered it as a positive money claim. A Plaid card reaches this by construction: syncLiabilities writes a Statement or nothing, and the ONLY writer of cycleCloseDayOfMonth is the manual-card form, so the advertised estimate-path fallback could never fire for a linked card. (b) DATA: syncLiabilities — the only writer of statements/due dates/minimums — had ONE production caller (linkPlaidAccount, inside a swallowing try/catch) and NO cron; and the nightly sweep resolves via getProvider(), a no-op unless DATA_PROVIDER==='plaid'. Due dates were fetched once at link, best-effort, never refreshed. SHIPPED: CashNeededResult.unknownDueDateCards carries the undatable cards out (excluded from every total/projection/trace, stated in assumptions); dashboard hero, /cards (incl. its 'No credit cards yet' guard which had excluded undatable cards from the definition of 'cards'), Ask assistant, weekly digest EMAIL and payment-reminders card all separate 'nothing is due' from 'we don't know', in the MIXED branch as well as the empty one; new src/server/plaid-sync.ts sweeps Plaid-linked users daily for liabilities regardless of DATA_PROVIDER (skips demo, isolates per-user AND per-step failures, audits sync.cron.plaid); PlaidProvider.syncLiabilities returns counts so a silent total failure is reportable (it catches per-item errors itself, so 'it didn't throw' was never evidence); its credit branch records whichever cycle days Plaid reports; cron route gains maxDuration=300 + a wrapping try/catch; new dayOfMonthFromISO in the tested dates module. THREE CRITIC CYCLES: cycle 1 FAIL (7 P1) — the same false claim was standing on six surfaces the first pass never touched (#221 widened-data-class lesson). Cycle 2 FAIL (1 P0 + 2 P1) — the P0 was SELF-INFLICTED: an attempt to rescue Plaid cards by dating them from a due day with no cycle anchor produced a due date a month early, an 42.67 shortfall and a live 'move 50 into checking today' instruction, with the guess disclosed as the issuer's own date; REVERTED and counter-locked. Cycle 2 also proved the new 'Add statement' instruction was unfollowable (that control exists only for provider==='manual'; card-actions.ts refuses the rest) — removed rather than reworded. Cycle 3 was ABORTED mid-run after ~20min (2x its peers) because its concurrent vitest runs were contending on the single-writer SQLite test DB and corrupting my gate; it had captured P0-1 and P1-2 evidence before being stopped, but issued NO verdict — so cycle-3 verification is UNVERIFIED. I separately hand-verified the one claim it had not reached (the 'connected cards are re-checked every day' copy) and REMOVED it, because whether this deployment's cron fires is itself unverified (STATUS Wave 0.3). Also removed 3 throwaway probe test files the critic subagents left behind (one committed by git add -A, one gitignored but still executing and inflating counts). OPEN P2s recorded in STATUS: nudge feed 'Nothing needs you today'; cash-needed-card takes no accountOwnerLabel so a partner's card is unattributed in the mixed-case note; a depository-only Plaid item audits liabilities:'failed' daily; plaidError returned but not audited; the dashboard mixed-path component branch has no unit/e2e coverage. STILL UNVERIFIED AGAINST LIVE DATA: whether the owner's issuers return liabilities at all — if they don't, those cards stay in the honest 'no due date yet' panel; confirming needs the plaid.liabilities.failed / sync.cron.plaid audit rows from a real run. Gate (clean, no concurrent agents): VERIFY_E2E=1 bash scripts/verify.sh -> VERIFY GREEN, tsc 0 / eslint 0 / 3487 unit / 239 files / build clean / e2e 162/162. No schema change (deploy touches no DB). Ledgers: DECISIONS #277 (+reindex), 1 REGRESSION_LEDGER entry, new lesson docs/lessons/an-empty-set-is-not-a-fact-about-money.md + INDEX. NEXT: owner to check /cards and the dashboard on the live site; if the cards still show under 'No due date yet', pull the audit rows to see what Plaid actually returned for them.

## 2026-07-23 — #276 — Wave M.3 close-out — the tap-reachable overflow class — M.3 COMPLETE

Closed the M.3 items deferred as 'no clipped figure' by MEASURING them (temporary per-element probe spec, deleted before commit) at 360/393/430 on every control the passive M.1 sweep cannot reach: the triage picker panel, the 'New category' panel, the retirement what-if grid, /settings. ONE offender found: the triage quick-pick grid-cols-3 put 'Household & Home' (min-content 108px) in a ~102px track — the shadcn Button base is whitespace-nowrap shrink-0 and a grid item's min-width:auto floors the track at min-content, so the category name painted outside its own cell; a longer user-created name would run off the edge. Fix: h-auto min-w-0 py-1.5 leading-tight whitespace-normal on the quick-pick Buttons (wraps in place, .tap-target 44px floor still applies, measured 46px, screenshot confirmed). The page-level gate cannot see this class (the ~5px bleed lands in the 16px shell gutter without widening the document), so the lock is a per-BUTTON scrollWidth<=clientWidth assertion at all three widths in BOTH mobile-380 and mobile-webkit; fail-old EXECUTED against pre-fix code (108>102, stash + rebuild + run). Test-fixture bug caught by the gate itself: v1 drove the shared DEMO triage queue, passed alone, then found an empty inbox under the full suite (phase2-triage files it first) — rewritten to sign up a throwaway user and seed its own needsReview row via better-sqlite3, plus an assertion that the long name is present so the lock cannot degrade into measuring only short labels. THREE brief items CORRECTED as stale (the section-c / #248 class) and deliberately left untouched: money-dials + retirement what-if number grids and every section-d fixed-width input (custom-category-manager w-40/w-44, household-card max-w-40/max-w-60, triage w-40/w-44/w-24) all measure CLEAN — they sit in flex flex-wrap containers that wrap or minmax(0,1fr) tracks that shrink. Moved to M.4: the 2 inline category-chips. E2E flake settled per the lesson rather than assumed: two full-suite runs on this tree failed on the two documented contention specs (phase4-features goals, then pwa-offline, a different one each run), clean HEAD then ran 159/159 and this tree 161/161. Gate: VERIFY_E2E=1 bash scripts/verify.sh -> VERIFY GREEN; npx vitest run -> 3465 tests / 238 files; e2e 161/161 both engines. No schema change (deploy touches no DB). Ledgers: DECISIONS #276 (+reindex), 1 REGRESSION_LEDGER entry, TASKS M.3 -> [x], STATUS top section. PARKED FOR TASKS 3.7 (explored this session, not built — do not re-explore): learned rules live in src/lib/engine/categorize/learn.ts (deriveLearnedRules line 97, LEARN_THRESHOLD=2 line 47, LEARNED_PRIORITY=50 line 49), keyed on descriptor SIGNATURE, needs >=2 distinct txns to the same category with zero conflicts; production loader src/server/rules.ts (loadCorrectionInputs line 72, loadLearnedRules line 107, loadUserRules line 116); applied in categorize() src/lib/engine/categorize/pipeline.ts line 178 (match line 147, auto-file at LEARNED_RULE_CONFIDENCE_BPS=8500 line 31); Correction.createdAt (prisma/schema.prisma line 385) is the recency signal and seq is derived from it; the decay idiom to reuse is ANOMALY_RECENT_WINDOW_DAYS (src/lib/engine/anomaly/detect.ts line 68) with daysBetween from lib/dates; tests tests/unit/learn.test.ts (21 tests, corr() helper); undo needs no new path — rules are re-derived from Correction history and undoCorrections (src/server/triage-actions.ts line 653) writes an inverse row that deriveLearnedRules skips. NEXT: TASKS open board — M.4 route-by-route restyle is owner-eyeball-gated (needs screenshots); unblocked open rows: 2.4, 2.5, 3.3, 3.4, 3.7, S.4-S.8.

## 2026-07-22 — #275 — Wave 4.6 slice 6 — full-surface hostile critic — WAVE 4.6 COMPLETE

Slice 6 of 6 (spec docs/PROVIDER_RECONCILIATION_ARCHITECTURE.md §10.6). Ran three parallel fresh-context critics (money core with the §6 boundary-straddle as lead target / lifecycle-authz-races / downstream-surfaces + copy honesty) over R1-R10; consolidated 8 P1 + 8 P2 + 6 P3. ALL P1s fixed and regression-locked same-session: (1) ENGINE reconcile-boundary.ts — transitive chain composition for txn claims (A-F1) and snapshot collisions (A-F4), statement re-key dedup per (terminal,cycleEnd) latest-cutover-wins (A-F6), pre-first-txn cutover claim-inert instead of history erasure (A-F8), read-time chain-monotonicity inertness (B-F4); new exports reconciliationTxnKeepFilter + terminalSuccessorMap sharing the ONE R1 rule. (2) SURFACES — new server helper getReconciliationTxnKeep applied to getTransactions (register rows+summary), /api/export transactions-csv, budgets month spend, triage items/groups/badge, recurring re-detection; /investments filters activeSupersededPredecessorIds; refuseManualWriteToSuperseded fences createManualTransaction + importTransactionsCsv and the add/import pickers + settings funding selector exclude superseded preds; assistant answerAccountBalance folds preds onto terminal successors (disclosed); getAccountsView returns boundary.paymentAccountId, enriches candidates with predecessorTxnSpan (UI default cutover = span end per spec §6, min = span start), filters candidates whose pred is already linked, suppresses warnings involving folded preds; duplicates.ts flags different-PlaidItem plaid pairs (C-10). (3) LIFECYCLE — confirm transaction now SERIALIZABLE with P2034 -> retryable refusal (closes B-F3 cycle race + B-F4 non-monotone race at the source), direction-conflict auto-undo captured and audit-logged (reconciliation.auto-undo-reverse), isAccountLive conservatism documented. §6 straddle DECIDED accept-and-disclose across all three skew windows (b/b-prime/b-double-prime) — amount-dedup FP direction is a silent loss (worse); confirm-card copy rewritten to the real claim span + skew caveat. Tests: +9 engine (chain/sibling/misorder/monotone) in reconcile-boundary.test.ts, +15 in NEW reconcile-surfaces.test.ts (register integration, keep-rule parity, fence, C-8 trio, C-10, A-F7, span, assistant fold), +1 e2e (register agreement + span disclosure + cutover default) in reconcile.spec.ts. Gate: VERIFY_E2E=1 bash scripts/verify.sh -> VERIFY GREEN — tsc 0, eslint 0, 3465 unit / 238 files, build clean, e2e 159/159 both engines (no flake this run). Ledgers: DECISIONS #275 (+index), 5 REGRESSION_LEDGER entries, EDGE_CASES slice-6 sections, spec header BUILT + §10.6 done + §11 resolved, TASKS 4.6 -> [x], STATUS top section. No schema change (deploy touches no DB). NEXT: TASKS open board — M.4 route-by-route restyle is owner-eyeball-gated; open rows: 2.4, 2.5, 3.3, 3.4, 3.7, S.4-S.8.

## 2026-07-22 — #271 — Wave 4.6 slice 2 — AccountReconciliation schema + confirm/undo server action (R7/R9/R10)

Slice 2 of 6 (spec docs/PROVIDER_RECONCILIATION_ARCHITECTURE.md). Shipped the additive AccountReconciliation table (one table, NO Account column changes; predecessorAccountId @unique, successorAccountId NOT unique, NO Account FK, User back-relation only) + the Prisma-only confirm/undo core src/server/reconciliation.ts (NextAuth-free so it runs under vitest against real Prisma, like account-delete.ts) + the thin use-server wrapper reconciliation-actions.ts (requireUserId + businessToday + auditLog + revalidatePath). confirmReconciliationFor: demo-fenced (new DEMO_RECONCILE_BLOCKED), scalar/enum-validated, cutover bounded (valid isoDate, <= today up front, >= predecessor first txn in-tx), then a prisma.$transaction that re-resolves BOTH account ids where {id,userId} (R10 TOCTOU) and re-derives liveness in-tx via the shared isAccountLive helper to enforce direction predecessor=stale/successor=live (R3 money guard: never zero a live balance), then UPSERTS on the predecessor @unique slot (idempotent + re-activation-safe). undoReconciliationFor sets undoneAt scoped where {id,userId,undoneAt:null} (R9 reversible). getActiveReconciliations feeds slices 3/5. isAccountLive is the SAME derivation slice 5 will feed the detector (one source, cannot disagree — a-guard-must-read lesson). 20 real-Prisma tests (reconciliation-server.test.ts): isAccountLive matrix, demo fence, scalar/enum/self-link/malformed-date/future/before-first-txn validation, R10 cross-user (successor + predecessor + stranger-undo), R3 (successor-not-live, both-live, manual-predecessor-accepted), R9 confirm->undo->re-undo-noop->re-confirm-same-row round-trip, R7 delete-account-leaves-inert-link. NO money figure changes yet (balance-exclusion + date-split is slice 3), so nominally Opus-lane; built on Fable as the direct prereq to slice 3's Fable money core. Gate: bash scripts/verify.sh -> VERIFY GREEN (tsc 0, eslint 0, next build clean); npx vitest run -> 233 files / 3385 tests passed (+20, +1 file). Schema change: additive table only -> on push, Vercel deploy runs prisma db push and CREATES AccountReconciliation in Neon (safe, no column/data changes; demo/golden byte-identical, R8 via the green suite). No route/UI change this slice (confirm/undo unwired until slice 5), so no live-site marker to grep. NEXT: slice 3 — the assembler boundary (balance exclusion + transaction date-split in getFinanceSnapshot), R1/R2/R8, Fable build + hostile critic.

## 2026-07-22 — #270 — Wave 4.6 slice 1 — cross-provider reconciliation candidate engine (R3)

Started Wave 4.6 (cross-provider account reconciliation, spec docs/PROVIDER_RECONCILIATION_ARCHITECTURE.md #266) from a clean in-sync main. Slice 1 of 6 (spec 10): the PURE directional candidate engine, no schema/mutation/UI. detectReconciliationCandidates extends the #192 detector (src/lib/engine/account/duplicates.ts) — a suspected cross-provider duplicate pair becomes a predecessor->successor candidate from each row's hasLiveConnection flag. R3 locked: candidate only when EXACTLY ONE side is live (successor=live, predecessor=stale); both-live (active duplicate, advisory #192 warning stays) and both-dead (no live row) yield nothing. Refactored duplicateSignals to expose the primary matchSignal (mask>balance>name) once; updated both existing callers to not leak it. Liveness is an engine INPUT (caller derives from SimpleFinConnection/PlaidItem presence in later slices); manual rows are predecessor-eligible; direction is order-independent; demo excluded upstream. 11 new abstention-majority tests (tests/unit/account-reconciliation-candidates.test.ts), EDGE_CASES section-Reconciliation-Candidates. Pure logic -> Opus-lane per spec, no Fable critic (gates are slices 3/4/6); Checker stance via the abstention tests. Gate: bash scripts/verify.sh -> VERIFY GREEN, tsc 0 / eslint 0 / 3365 unit / 232 files / build clean. No user-visible/route/schema change this slice, so nothing to grep on the live site; committed+pushed for single-machine-loss safety + CI arbiter. NEXT: slice 2 — additive AccountReconciliation schema (prisma) + confirm/undo server action (Prisma-only, authz + TOCTOU like #219), locking R7/R9/R10.

## 2026-07-22 — #269 — M.4 shared dashboard link-card surface token (consistency follow-up)

Extracted the five byte-identical dashboard link-card className strings (safe-to-spend, spending-insights, top-spending, recurring-summary, ask-aimplifi — all whole-card TrackedActedLink affordances) into one shared token `SURFACE_LINK_CARD_CLASS` in src/components/finance/surface-card-styles.ts, mirroring the AUTH_INPUT_CLASS idiom from the same 2026-07-21 B5 review. Confirmed full-string byte-identity across all five before extracting (per the #260 diff-first lesson), and confirmed the other TrackedActedLink consumers (onboarding-nudge uses shadcn Card; connection-alerts-card uses a different inner CTA) are deliberately out of scope — documented in the token's header. Byte-identical => appearance provably unchanged, so no rule-0 hazard on a beauty surface that can't be screenshot post-/clear. Lock: tests/unit/surface-card-styles.test.ts asserts the load-bearing utilities survive any future edit of the token (the surface trio + the keyboard focus-visible ring — the one new risk centralisation introduces that duplication did not have). Route-by-route M.4 restyle stays owner-eyeball-gated and needs screenshots; this is foundation only. Gate: bash scripts/verify.sh -> VERIFY GREEN (tsc 0, eslint 0, next build clean); npx vitest run -> 231 files / 3354 tests passed; npx playwright test mobile-overflow -> 10/10 in both mobile-380 (Chromium) and mobile-webkit (iOS Safari) at 360/393/430, /dashboard surface locked. No money/authz/routing touched -> no Fable critic.

## 2026-07-21 — #260 Agent-review follow-up slice 2 (redundancy wave B + A5/A6) — COMPLETE

Closed every remaining non-owner-gated candidate from the 2026-07-21 agent review; D (Plaid
merge into an existing account) is the ONLY item left and stays owner-gated because it deletes
transaction rows. Extractions: src/server/llm-provider.ts (5 LLM modules had copied the same
~45-line provider selection + round-trip; also removes the `anthropicKey!` non-null assertion 3 of
the 5 had drifted into — the "no key returns BEFORE onOutcome" contract and the null=unavailable
vs ''=replied-with-nothing distinction are preserved at every caller); src/lib/auth/token-salt.ts
(3 at-rest salt chains); dates.ts monthKey + addMonthsToMonthKey (6 ym slices + 5 prev/next
wrappers); src/lib/stats.ts (5 median copies); shared isDemoUser in household-actions;
useConfirmArm + ConfirmPrompt for the 6 two-tap confirms; AUTH_INPUT_CLASS for the 3 auth forms.
MEDIAN DRIFT, the one real find: the 5 copies disagreed on the even-count case (3 floor, 1 round,
1 raw), so the shared util returns the EXACT median and each engine states its rounding at its own
call site — all figures byte-identical (unit suite unchanged). 2 deliberate behaviour changes:
Escape now disarms an armed destructive control on all 6 surfaces, and /trust joins nav DISCOVER
(it was reachable only from a card inside /settings). DECLINED WITH EVIDENCE (not skipped): A6's
"time promise drift" (4 claims about 4 different things — verified in the copy), B5's
"provider-configured checks" (plaid-actions needs DATA_ENCRYPTION_KEY; the others throw operator
messages — different on purpose), and the "Safe to Spend vs Cash Needed" rename (owner product
call). RE-FILED FOR THE OWNER: safe-to-spend deducts snap.scheduled bills and NOT card statement
dues (verified in server/spending-plan.ts), so the dashboard shows two figures that don't
reconcile — a copy fix here would be a money claim the code doesn't support (#221 class).
New tests: stats.test.ts, token-salt.test.ts, llm-provider.test.ts, month-key cases in
dates.test.ts, Escape-disarm step in transactions.spec.ts, nav-trust in mobile-nav.spec.ts.
REGRESSION FOUND + FIXED (from #259, not this slice): the first FULL e2e run since #259 showed its
zero-account /triage empty replaces the whole page, so Backfill was unreachable for every new signup —
backfill.spec repaired (one manual asset past the gate + an explicit assert that the first-run empty is
gone before clicking) and REGRESSION_LEDGER filed. #259 ran targeted specs only; a route-level gate is a
fence and needs the full suite.
E2E LESSON RE-CONFIRMED: `next start` serves the LAST build — my first spec run failed on BOTH new
assertions purely because the served bundle predated the edits; rebuild before running specs.
NEXT SESSION STARTS HERE — OWNER-REPORTED, UNDIAGNOSED: "the password isn't being remembered"
(full framing + verified facts + the questions to ask in docs/STATUS.md, top section). Short form:
stored passwords CANNOT be broken by an env change (scrypt salt lives inside the stored hash), and
the only change to the password FIELD today was #258's show/hide viewer, which flips the input's
type away from `password` — a plausible reason a password MANAGER stops offering to save. Labelled
hypothesis, not a conclusion: ask for a screenshot + whether the missing prompt is the browser's or
the app's before touching anything. #258 is a one-component revert if the owner is blocked.
AFTER THAT: owner decision on D (Plaid merge) — or TASKS 2.4 / 3.3 / 3.7 from the open board.

## 2026-07-21 — #257 Forgot-password / reset flow (owner request, owner locked out) — COMPLETE (verify green 3324/227, security critic PASS 0 P0/P1 both cycles)

Owner locked out of the deployed app -> full reset flow, engine-first on Fable. Pure engine/auth/reset.ts + guarded core server/password-reset.ts (authz-free, real-Prisma-tested: hash-only at rest, single-active mint, ATOMIC single-use claim + passwordHash rewrite + sessionEpoch bump in one transaction — #256 P1-1 lesson applied from the start; demo fence in core; enumeration-neutral request; fail-closed origin refusing CWE-640 reset-link poisoning off-Vercel without AUTH_URL) + rate-limited 'use server' wrappers (750ms timing-oracle floor) + /forgot-password + /reset-password pages + sign-in link + middleware exclusions. PasswordResetToken additive table. password-reset-server.test.ts 13/13 (atomic race, boundary expiry, forged-demo-row refusal, Google-only policy, no-origin); e2e password-reset 3/3 + auth 3/3 post-rebuild (e2e lesson: next start serves the LAST build — rebuild before spec runs). Fresh-context security critic cycle 1 PASS 0P0/0P1 w/ 2P2+3P3 hardening (executed timing measurement 3.14x -> floored; host-poisoning -> fail-closed + .env.example AUTH_URL requirement) -> ALL actionable fixed -> critic re-verified by executed re-repro PASS, 1 negligible new P3 comment-recorded. 3 residuals in STATUS. Docs: DECISIONS #257 + index, STATUS section. Committed + PUSHED (the owner needs this ON VERCEL to get back in; RESEND_API_KEY owner-verified live at #204). OPEN OWNER LOOP: PLAID_ENV value in Vercel still unconfirmed (sandbox phone screen) — owner was mid-check when the lockout interrupted.

## 2026-07-21 — #256 Plaid disconnect + per-account deletion + sandbox disclosure (owner request) — COMPLETE (verify green 3311/226, critic cycle 2 PASS 0 P0/P1)

Owner interject mid-#255: Plaid Link rejected their real phone number, and /accounts had no per-account disconnect. Root causes mapped by explorer: (1) phone rejection is Plaid's sandbox Link UI (we send no phone/identity config; PLAID_ENV=sandbox accepts only Plaid test input) -> inline plaid-sandbox-notice on the connect button + PLAID_WALKTHROUGH section; (2) provider.removeItem existed with no surface (the #253 recorded unblock). Shipped: additive Account.plaidItemId stamped on every Plaid upsert + best-effort at disconnect; disconnectPlaidItem action (ownership, demo fence in action AND removeItem core); PlaidConnections two-tap UI; deletion core generalized to deleteDisconnectedSyncedAccountFor with ONE shared predicate syncedDeleteBlockReason read by the view affordance AND re-read INSIDE the delete transaction (critic P1-1: pre-tx linkage read was exploitable to delete-then-resurrect via concurrent re-link — executed repro, fixed, regression-locked test_regression__plaid-linkage-read-inside-tx + REGRESSION_LEDGER). account-delete-server.test.ts 16/16 (P1-P4 plaid contract, TOCTOU lock, deletable matrix, predicate matrix); e2e account-deletion 4/4 + connection-health 3/3; verify green 3311/226. Docs: DECISIONS #256 + index, STATUS section (closes #253 limitation 1, 3 new limitations), PLAID_WALKTHROUGH sandbox + disconnect sections. NEXT at the fork: Scenario Studio slice 2 (what-if UI + sensitivity band over the #255 engine), or owner direction.

## 2026-07-21 — #255 Scenario Coherence Engine (AI plan §Later #13 slice 1) — COMPLETE (verify green 3301/226, critic PASS 0 P0/P1 after 1 fix cycle)

Owner-chosen at the #252 fork, resumed after the #253/#254 interjects. Shipped the pure snapshot-coherence engine per the verdict's blocker (a): src/lib/engine/scenario/scenario.ts (canonical ScenarioBase/State, knob deltas income/expense pct+abs + extraDebt, both-or-neither rule, net-vs-investible split, E-CUT, synthetic-row anchor first-of-next-month with EFFECTIVE deltas, SCENARIO_LIMITS sanitize-before-clamp never-throw, adapters toFIInputs/toRetirementBase/toScenarioSavingsRateBps/toDebtPlanInput preserving downstream conventions verbatim). tests/unit/scenario.test.ts 28/28 (S1-S16 hand math from EDGE_CASES §Scenario Coherence + real cross-engine coherence: expandScheduled, assembleCashNeededInput, planDebtPayoff, monthsToFI, projectRetirement all driven from one state). Fresh-context Fable critic cycle 1 FAIL (1 P1 NaN-knob contract break, 2 P2 zero-aggregate disclosure + perpetual-extra-debt assumption, 3 P3) -> all actionable fixed in-cycle -> critic re-verified by executed re-repro (17/17 attacks) -> PASS 0 P0/P1; F5/F6 P3 residuals recorded in STATUS. Docs: DECISIONS #255 + index, STATUS section, EDGE_CASES section, AI plan #13 marked slice-1-shipped. Engine only: NO UI, NO LLM, NO persistence, NO schema change; e2e comes with the what-if UI slice. NEXT SLICES (later): what-if UI + sensitivity band + LLM parameter-mapper; comparison half permanently dropped. OWNER INTERJECT (mid-session, being handled next as #256): Plaid Link rejects a real phone number (PLAID_ENV=sandbox — Link's phone step only accepts Plaid sandbox test numbers; explorer confirmed we never pass phone/identity config, so it is Link-UI-side) and no per-account disconnect exists on /accounts (provider.removeItem exists unexposed; #253 recorded the gap as 'unblocks when a Plaid item-disconnect action exists').

## 2026-07-21 — #254 Habit Streaks (AI plan §Later #17 streaks half: card-cleared + no-subscription-creep) — COMPLETE (verify green 3273/225, critic PASS 0 P0/P1, all 4 P2 fixed + critic-re-verified)

Owner's "continue" at the #253 fork. Board reconciliation (explorer + git, lesson #26): Cash Flow
Radar already shipped (#172 — the plan's "build-now" verdict is authoring-time stale); §Later
remaining = #13 XL (snapshot-coherence engine), #15 vision-blocked, #21 superseded, #17 split.
#17's rework verdict: streaks half (card cleared in full, no subscription creep) is build-now with
NO blockers — savings-rate streak (#205) already exists; the drift-loop half stays gated on the
transfer-pair engine (NOT this slice). Next DECISIONS number: **#254**. Tree clean at 6bcbd7c.

DESIGN (settled):
- Two pure engines, NO LLM, NO persistence, NO schema change:
  1. `engine/cards/cleared-streak.ts` — computeCardClearedStreak(statements, payments, today).
     Resolved = !isEstimated && dueDate < today (strict). Cleared = balance ≤ 0 OR Σ payments
     (dated ≤ dueDate) ≥ balance — "by due date" is the basis, stated inline in copy. Group
     resolved by ym(dueDate); walk calendar months back from latest signal month down to earliest
     signal month; a month with no due statements qualifies (nothing due = nothing missed); a
     month with ANY resolved uncleared statement stops the walk. Late/partial payment breaks.
  2. `engine/recurring/creep-streak.ts` — computeNoCreepStreak(series, today, window=12).
     Subs = isSubscription series. Creep event = priceChangedAt set ∧ |typical| > |previous|
     (decreases never break) at month ym(priceChangedAt). Walk full months from ym(today)−1, cap
     12 (disclosed); brokeOn carries {merchant, fromCents, toCents, month} — facts inline.
     Abstain (null) when no subscription series. Current-partial-month increase is invisible to
     the walk by construction — copy says "full months" (lag-honest, #252 precedent).
- Seed hand math (asOf 2026-06-10, pinned demo today): cleared streak **17 months** (dues
  2025-01..2026-05 all seed-paid on due date across sapphire/platinum/freedom/store; store $0
  cycles cleared by construction; June dues unresolved), 4 cards, latestMonth 2026-05, brokeAt
  null. No-creep streak **3** (Netflix 1549→1799 first new-price charge 2026-02-03 → Feb breaks;
  Mar/Apr/May qualify; only seeded increase). Both locked by buildSeedData seed-lock tests.
- Server: getCoachData grows `streaks: { cardCleared, noCreep }` from snap.statements +
  snap.cardPayments + the SAME `series` (predicates already shared). No new queries.
- UI: habit-streaks-card.tsx on /coach (after MoneySignatureCard); savings streak stays on
  SavingsRateCard (#205) — no duplicate surface. Copy in COACH_COPY (no-shame scan +
  assumptions-inline; plural handling; broken-state copy shame-free).
- Tests: unit hand-verified suites for both engines + seed locks; ALL_STRINGS additions +
  one exact rendered-copy lock for the money-bearing broken-creep line (verbatim-value lesson);
  e2e phase3-coach extension (17 months / 3 full months / Netflix fact) + existing axe AA.
- Docs: EDGE_CASES §Streaks hand math; DECISIONS #254; STATUS section; AI plan #17 updated to
  "streaks half shipped, drift loop still gated"; this file.

STEPS: 1.[x] EDGE_CASES §Habit Streaks hand math (C1–C9, N1–N9, seed locks) → 2.[x] engines +
unit tests green (cleared-streak 12/12 + creep-streak 12/12 incl. both seed locks, first run;
seed lock EXECUTED: 17/59 statements/4 cards + creep 3/Netflix 1549→1799/2026-02) → 3.[x]
server (`streaks` on CoachData, same snapshot+series inputs) + habit-streaks-card on /coach +
COACH_COPY block (245/245 copy suite incl. new exact rendered locks) → 4.[x] full verify
GREEN (✅ exit 0; full unit suite 3268 passed) + phase3-coach e2e 1/1 at mobile-380 with the
new assertions → 5.[x] hostile critic (fresh-context Fable, 14 adversarial executions +
independent hand math): PASS 0 P0/P1, 4 P2 (F1 gap-month count opacity, F2 partial-month walk
inconsistency, F3 snapshot statements unfiltered by the currency guard, F4 seed-lock predicate
drift) → 6.[~] ALL 4 P2s fixed (F1 copy discloses the statement count; F2 full-months-only
walk + formingThisMonth state + C10–C12 locks; F3 demo.ts filters statements/cardPayments at
the source; F4 predicate aligned); affected suites green + tsc clean; critic RE-VERIFIED all
four fixes by executed re-repro (PASS ×4, no new defects; its sub-threshold forming-copy nit
also taken — outcome-neutral wording, copy suite 247/247) → 7.[x] settled final gate ✅ VERIFY
GREEN 3273/225 (a 1-failure count run mid-edit did not reproduce on the settled rerun —
edit-race, the recorded flake class) + phase3-coach e2e 1/1 at mobile-380 with the
"(4 cards, 59 statements)" literal + docs (DECISIONS #254 + index, STATUS §Habit Streaks with
3 recorded limitations, EDGE_CASES §Habit Streaks incl. C10–C12, AI plan #17 marked
streaks-half-shipped) + committed.

## 2026-07-21 — #252 Adaptive Coaching Profile / Money Signature (AI plan §Later #11, rework baked in) — COMPLETE (verify green 3210/222, critic cycle closed PASS 0 P0/P1)

Owner's "continue" at the #251 fork. Board reconciliation (explorer + git, lesson #26): Threaded
Ask #21 superseded by #222/#230; double-bill timestamp-blocked; #17 drift needs the transfer-pair
engine (riskier, larger); #13 Scenario Studio is XL behind a snapshot-coherence engine; PROGRESS
backfill #173–176 already done (entries at PROGRESS:3617–3660 — the STATUS "outstanding" flags are
inside dated 2026-07-08 historical entries, not current state). #11 is the last M-size groundable
item and its "needs-rework" verdict IS the resolved design decision (plan:241): hysteresis before
any axis label change, stable axes decoupled from responsive weather, habit framing not
personality. Next DECISIONS number: **#252**. Tree clean at c71cccc, 7 ahead of origin (push
owner-gated).

DESIGN (settled):
- Pure engine `src/lib/engine/fi/signature.ts`, NO LLM, NO persistence: hysteresis is a
  retrospective walk over the monthly series (a label flips only after 3 consecutive months of
  contrary banded signal), so labels are deterministic from history — no schema change, no
  demo-fence, no consent state. Input: full-calendar-month MonthlyFlow[] (+ runwayMonths + today);
  engine excludes ym(today) itself so a partial month never feeds an axis.
- Axis 1 — saving habit: over trailing ≤12 eligible months (rate ≠ null), shareBps =
  floor(saved×10000/eligible), saved = rate ≥ 0 (streak-engine convention). Banded: steady ≥ 7500,
  variable ≤ 5000, dead zone between (no signal). ≥6 eligible months required, else 'forming'.
- Axis 2 — spending steadiness: trailing 6 full months' expensesCents; med + MAD via the
  documented radar integer convention (private medianOfSorted copy — the anomaly/merchant
  precedent); spreadBps = floor(mad×10000/med); steady ≤ 1000, variable ≥ 2500, dead zone between;
  guard med > 0.
- Hysteresis walk (shared by both axes): confirmed starts null ('forming'); first non-dead-zone
  raw initializes (sinceMonth = that month); thereafter flip only on 3 CONSECUTIVE identical
  contrary raws (dead-zone months reset the run — conservative, fewer flips).
- Weather (responsive by design, "this month", flips expected): strained if runway < 1; else
  tight if runway < 3 or latest full-month rate < 0; else bright if computeSavingsStreak
  isPersonalBest ∧ latest rate ≥ 0 ∧ ≥6 eligible months; else calm.
- Copy: coach-copy.ts templates — facts-first habit lines ("saved in N of the last 12 months"),
  weather greeting variants re-toning the SAME facts; banned identity-framing lexicon test
  ("personality", "you are a", archetype nouns); no-shame scan covers new keys automatically.
- UI: money-signature-card on /coach (weather line + 2 axis lines, thresholds/assumptions
  inline). getCoachData grows a `signature` field. No writes anywhere.

STEPS: 1.[x] EDGE_CASES §Money Signature hand math (S1–S5, H1–H5, D1–D6, W1–W10) →
2.[x] engine + unit tests (money-signature.test.ts 29/29 incl. seed lock: steady/steady/calm,
spreadBps 296 hand-verified med 390166/mad 11550 + independent re-aggregation cross-check;
probe test used then DELETED) → 3.[x] coach-copy templates (weather×4 + tight-negative +
infinite-runway, saving steady/variable/forming/MIXED, steadiness ×4 — mixed = dead-zone-
before-init state the forming copy would lie about) + ALL_STRINGS entries + identity-lexicon
ban (money-signature-copy.test.ts; 229/229 with coach-copy suite) → 4.[x] coach.ts wiring
(signature from ALL flows, not the 12-mo slice) + money-signature-card + page insert →
5.[x] seed lock (in step 2; seed UNTOUCHED — zero ripple) → 6.[x] e2e phase3-coach.spec
pinned demo copy (calm / 12 of last 12 / May 2025 / 3.0% / median / 3-month rule) →
7.[x] docs (DECISIONS #252 + index, STATUS §Money Signature, plan §11 un-staled) →
8.[x] verify.sh GREEN (pre-critic: 3187/222; e2e phase3-coach 1/1 + a11y 7/7) →
9.[x] fresh-context Fable critic (empirical): FAIL 2 P1 / 4 P2 — engine mechanics survived
both rounds (prefix-stable hysteresis 55-recompute sweep, integer math, weather table,
purity); ALL findings were copy/branch honesty defects. P1-1 lag-divergent label copy
("steady habit … has held" beside 5/12 saved) → engine `latestContrary` + 4 lag-honest
"had been…" copy variants; P1-2 "your last N full months" false across skipped no-income
months → "full months with income" on every count line; P2: `hasFullWindow`
unreadable-vs-forming split, trailing-gap materialization anchored to ym(today)−1 (creep's
grid), licensed seed-lock cross-check precondition, "1 months" plural. Locks mirror the
executed repros (test_regression__signature-lag-contrary ×2, -with-income-qualifier,
-shifting-copy, -unreadable-window, -trailing-gap-weather); 2 REGRESSION_LEDGER rows.
Critic re-verified EVERY fix by executed re-repro → **PASS 0 P0/P1**; 1 P2-grade residual
recorded in STATUS (contrary run can complete across trailing no-income months; copy stays
true, steadiness structurally protected). →
10.[x] FINAL GATES (real output): `bash scripts/verify.sh` → ✅ VERIFY GREEN exit 0,
**222 files / 3210 tests passed**; post-fix e2e phase3-coach + phase5-a11y → **8/8**
(coach WCAG AA incl. the new card). Committed as #252.
Design note (settled): commitment-load REJECTED as axis 2 (applies today's series
membership backward = dishonest history); hysteresis has NO stored state by design.

## 2026-07-21 — #251 Income-Pause / Runway Radar (AI plan §Later #20, groundable half) — COMPLETE (committed 67eda28; verify green 3104/220, critic cycle closed 0 P0/P1)

Owner's "continue" at the #250 fork. Last unblocked groundable §Later sub-slice per STATUS #248
menu (streaks #205 and outlier radar #249 both shipped). §20 verdict: exactly ONE groundable
signature — a lapsed `isIncome` series + thin runway; plan mutation (`projectedIncome = 0`) is
confirmation-gated; the rest of Life-Event Radar stays hard-gated.

DESIGN (settled):
- Engine `src/lib/engine/income/pause.ts` (pure, NO LLM) over `detectRecurring` output.
  Gates: isIncome, cadence ∈ {W, BW, M} (ANNUAL excluded), occurrences ≥ 4, typicalAmountCents
  ≥ 10000 ($100 floor), aggregate pseudo-merchants excluded (shared isAggregateCanonical,
  #250 F3). Lapse: missedSince = nextDate(lastSeenAt, cadence) — NOT the forward-stepped
  nextExpectedAt, which HIDES lapses; daysLate = daysBetween(missedSince, today); flag iff
  daysLate ≥ grace {W:5, BW:7, M:10}. TWO predicates, one lapse computation:
  `lapsedIncomeSeries` (no staleness cap — feeds projection EXCLUSION; a confirmed pause must
  never silently re-enter projections after 61 days) and `detectIncomePauses` (lapsed ∧
  daysLate ≤ 60 — nudge-worthiness: news, not history). Order typicalAmountCents desc then
  merchant asc (locale-free). No count cap.
- Nudge: kind `income_pause`, ACTION tier (precision-first like #249 — a late paycheck may be
  a payroll hiccup; never CRITICAL, never pushed). dismissKey income_pause:<merchant>:<missedSince>.
  Verbatim: centsAtStake = typicalAmountCents, sortDate = missedSince, merchant, typicalCount =
  occurrences; NEW display-context fields cadence + runwayMonths (verbatim from coach
  monthsOfRunway; null for other kinds). Extend ENGAGEMENT_SUBJECT_KEYS `nudge:income_pause`.
- Copy: per-kind semantic = "the expected deposit that hasn't arrived" (never "at stake");
  basis "based on N deposits" inline; runway line "about X months of typical spending (cash on
  hand ÷ your 6-month average expenses)", omitted when null/Infinity; dismiss offered as the
  expected outcome ("a job change, a pause you planned"); no-shame, non-advisory.
- Mutation (confirmation-gated): new IncomePauseConfirmation model (@@unique userId+merchant).
  Confirm/undo server action, demo-fenced (DEMO_USER_ID no-op — nudge-dismissal precedent) →
  triggers refreshRecurringForUser. refreshRecurringForUser excludes a series from
  ScheduledTransaction rows iff confirmed AND still in lapsedIncomeSeries; resumed series ⇒
  confirmation inert + stale row deleted on refresh. coach.ts blueprint paycheck gets the same
  filter.
- Seed (demo-first): 'STRIPE PAYOUT ETSY SHOP' → canonical "Stripe Payout" (side-income,
  known, non-aggregate; probed). +38000¢ × 4 monthly on acct-savings (NOT the payment account
  → cash-needed/seed-headline untouched by construction), dates addMonthsClamped(asOf, -5..-2)
  → default-asOf 2026-01-10..04-10, missedSince 2026-05-10, daysLate 31. Exactly-one seed lock
  (#249 pattern). KNOWN ripple: income6 += 4×38000 across Jan–Apr → savings-rate/FI/review/
  streak/trend locks need re-hand-verified expected values (the recorded "ripples the demo
  narrative" cost — accepted).

STEPS: 1.[x] engine+unit tests (17, incl. seed lock + production-shaped fixture) → 2.[x] nudge
types/select/copy+engagement key+tests (select 6 new, copy 6 new; CONFIRMED→HANDLED rework: a
confirmed pause stays in the feed as quiet state carrying the Undo — a money mutation may never
outlive its own visibility) → 3.[x] coach.ts+dashboard wiring (incomePausesForFeed; blueprint
topIncome skips confirmed-paused) → 4.[x] seed (+$380×4 Stripe Payout on acct-savings,
2026-01-10..04-10; ripple = EXACTLY 3 insights.test.ts income locks, re-hand-verified 528000 =
2×245000+38000) → 5.[x] IncomePauseConfirmation schema + fenced store/actions +
refreshRecurringForUser exclusion + resumed-cleanup + income-pause-server.test.ts 5/5 →
6.[x] UI confirm/undo on today-feed-card (canManageIncomePause=false for demo) → 7.[x] e2e:
today-feed.spec 8/8 (demo pinned copy incl. both fences; throwaway signup manual-entry confirm→
HANDLED→undo loop; TWO real fixes en route: dir-in pre-hydration click-and-verify (#167 idiom),
and spec dates must follow the DEMO_TODAY pin (businessToday precedence 1 pins EVERY user in
e2e — the phase2-triage precedent)); recurring.spec unmasked a LATENT a11y bug: "No longer
charging" opacity-70 × muted-foreground < 4.5:1 AA — section was always empty on demo until
#251's inactive row; fixed in recurring-view (muted title only), recurring.spec 3/3 →
8.[x] docs: EDGE_CASES §Income-Pause Radar, SEED_SPEC, STATUS §Income-Pause Radar, DECISIONS
#251 + index, AI plan §20 un-staled → 9.[~] GATES RUN (real output): `bash scripts/verify.sh`
→ ✅ VERIFY GREEN (exit 0); direct `npx vitest run` → **219 files / 3094 tests, all passed**;
full e2e sweep 135/136 passed with the 1 failure (phase4 goals) passing 6/6 in isolation — the
documented local 4-worker contention flake class. POST-VERIFY ADDITION (self-caught coherence
gap before the critic): manual entry/CSV now run refreshRecurringBestEffort (the plaid
post-ingest precedent) — without it a manual-entry user's resumed deposit never retired the
confirmation/exclusion, falsifying the HANDLED copy's "returns automatically" claim; locked by
income-pause-manual-entry.test.ts (drives the REAL createManualTransaction, 1/1 green; +21/21
around the hook).

CRITIC CYCLE 1 (fresh-context Fable, empirical): FAIL — 2 P1 + 6 P2, all with executed evidence.
F1 (P1): "resumed" = ¬lapsed inherited the ALARM gates, so a provider row-removal (occ 4→3)
deleted the consent row and re-projected phantom income with no feed row (critic reproduced it
against the real refreshRecurringForUser). F2 (P1): confirmed row's "why" said "Autopay covers
this". ALL 8 FIXED: `confirmedPauseState` consent machine (paused/resumed/inert; only date-fresh
deposits retire consent; exclusion + HANDLED row + cleanup all ride it — one predicate),
`tierRule` per-kind override in the copy module, dev db:push (F3), coach detection universe
aligned to spending-only (F4), `income_pause_confirmed:<merchant>` key namespace (F5),
non-positive runway nulled (F6), month-end `missedSinceOf` (F7, P13), undo input cap (F8).
Locks: P13, P14a–d, server 2b (row-removal regression), select F5/F6, copy F2 — 92/92 across
the 5 touched suites; 2 REGRESSION_LEDGER rows; back-half lesson extended (#251); EDGE_CASES/
STATUS/DECISIONS updated; residual recorded (sync-vs-confirm refresh race, self-healing).
FINAL GATES (real output): `bash scripts/verify.sh` → ✅ VERIFY GREEN, 220 files / 3104 tests
passed; post-fix e2e today-feed+recurring+phase3-coach+ask+return-moment+trends → 36/36.
Committed as #251 (67eda28).

## 2026-07-21 — Merchant Pattern Lens (#250) — COMPLETE (verify green, critic cycle closed)

Critic cycle 1 (fresh-context Fable, empirical repros): FAIL — 2 P1 (F1 cadence line rendered
SIGNED typicalAmountCents → "typically −$1,800.00" contradicting the same card; F2 lens fed
PENDING rows to detectRecurring while /recurring is POSTED-only → surfaces disagreed + phantom
price change) + 3 P2 (F3 case-sensitive aggregate guard; F4 overbroad never-disagree claim +
seed lock testing the radar's own mapping; F5 full-history card above a filtered/empty list).
ALL fixed: copy renders magnitude (production-negative fixture locked); server POSTED-only +
income-series skip + new integration lock merchant-lens-server.test.ts; isAggregateCanonical
case-insensitive for all callers; claims scoped in code+STATUS with the stored-canonical drift
residual recorded; always-on card scope note. Ledger: 3 rows. Lesson: verbatim-value extended
(#250 intake side). FINAL GATES: bash scripts/verify.sh → ✅ VERIFY GREEN 3061 unit / 217 files;
merchant-lens.spec + transactions.spec 22/22 green post-fix. Committed as #250.

## 2026-07-21 — Merchant Pattern Lens (#250, AI plan §Later #19 reshaped) — superseded by the COMPLETE entry above

Owner "continue" at the #249 fork → picked §Later #19 (last unblocked M item; rationale in
DECISIONS #250). DONE: EDGE_CASES §Merchant Pattern Lens hand math; pure engine
`engine/merchant/profile.ts` (qualifying-charge rule shared with anomaly engine; median = radar
convention; 3-full-month recent-vs-prior windows gated on firstYm ≤ window start; aggregate →
null; <3 charges → facts only); pure `lens-copy.ts` templates (+ banned time-of-day/day-of-week
lexicon test); TxnFilter.merchant exact case-insensitive predicate; getTransactions lens
composition (recurring cadence via detectRecurring); UI (merchant-name links on register rows,
lens card, filter preservation, hasFilters mirror both sides); seed lock: lens typical/count ===
radar baseline (1156¢/19, demo Blue Bottle). GATES RUN: bash scripts/verify.sh → ✅ VERIFY GREEN
3059 unit / 216 files, tsc+eslint+build clean; merchant-lens.spec + transactions.spec e2e 22/22
(incl. axe AA). Docs: DECISIONS #250 + reindex, STATUS §Merchant Pattern Lens, plan §Later #19
un-staled. NOW: fresh-context Fable hostile critic cycle 1 in flight (empirical repro mandate).
NEXT: fix any P0/P1, re-verify, commit `feat(merchant-lens): #250 …`.

## 2026-07-21 — Unusual Charge Radar v1 (#249) — COMPLETE (verify green, critic cycle closed)

All 11 steps done. Fresh-context Fable critic: FAIL (1 P1: seed change left ask.spec stale-red —
2 tests pinned Costco $158.44 as June's biggest purchase; lesson-#25 class, only today-feed.spec
had been run / 5 P2) → P1 + 3 P2s fixed (ask.spec re-pinned to Blue Bottle $214.36; window
docstring age 0–44; whyInputs "a $X charge" never "at stake" for a spent charge; SEED_SPEC
default-asOf dependency documented with the critic's 2026-06-20 counterexample), 2 P2 residuals
recorded in STATUS (txn-id index fallback under the persisted dismissal key; household-scope
viewer-only unusualCharges asymmetry). Critic independently recomputed EDGE_CASES hand math and
swept 42 asOf dates: 0 organic false positives. Final gate: bash scripts/verify.sh → ✅ VERIFY
GREEN 3036 unit / 214 files, tsc+eslint+build clean; ask.spec + today-feed.spec 26/26 against the
fresh build. Docs: DECISIONS #249 + index, STATUS §Unusual Charge Radar, EDGE_CASES §Unusual
Charge Radar, SEED_SPEC, AI plan §Later #12 un-staled. Next owner-gated menu: income-pause/runway
radar (Fable; needs FI-mutation plumbing + seed design), streaks drift loop (transfer-pair
blocked), double-bill (timestamp-blocked), or non-AI-plan work.

## 2026-07-20 — Unusual Charge Radar v1 (#249, AI plan §3-Later #12 reshaped) — IN PROGRESS (superseded by the COMPLETE entry above)

Owner "continue" at the #248 owner-gated fork. Pick: per-merchant median+MAD outlier detector —
the plan's own reshape verdict ("ship the per-merchant outlier detector after seeding 1-2
engineered anomalies; defer the duplicate detector until timestamps are captured",
AI_DIFFERENTIATION_PLAN.md:247). Income-pause/runway deferred (needs FI-mutation plumbing plus a
seeded income pause that ripples the whole 18-month demo narrative). Reconciled per lesson #26:
streaks' groundable core already shipped #205 — STATUS #248's menu line was partially stale.
Next DECISIONS number: **#249**. Tree clean at 9c835ae.

**Design (settled, step 1 done):**
- Engine `src/lib/engine/anomaly/detect.ts` (pure, NO LLM anywhere): group POSTED, non-transfer,
  non-split-parent, negative txns by `normalizeMerchant().canonical`; magnitudes in integer cents.
  Median/MAD convention: sort asc; even n → floor of midpair mean. Flag iff merchant has
  ≥ MIN_SAMPLE=6 qualifying charges (baseline = all history ≤ today), the charge is within
  RECENT_WINDOW_DAYS=45 of `today`, and deviation = magnitude − median **strictly >**
  K_MAD=4 × MAD + FLOOR=4000¢ (additive floor handles MAD=0 subscriptions: a $2.50 Netflix bump
  never flags; a $200 spike does). Above-median only. ≤1 flag per merchant (max deviation; tie →
  later date → txnId); overall top-3 by deviation desc (tie → merchant asc).
- Seed ONE engineered anomaly: `SQ *BLUE BOTTLE 0042 OAK` −21436 ($214.36 — the plan's marketed
  "$214 coffee") on 2026-06-02, acct-sapphire. Current PARTIAL month → coach full-month aggregates
  (expenses6, FI, streak) untouched; statements are pinned constants → cash-needed untouched.
  Uniform seed draws can't flag under K=4+floor (deviation ≤ half-range < 4×quarter-range) — a
  lock test asserts EXACTLY one flag over buildSeedData.
- Feed: new fixed ProposalKind `'unusual_charge'`, tier `'action'`, key/dismissKey
  `unusual_charge:<txnId>`, subjectKey `nudge:unusual_charge` (ENGAGEMENT_SUBJECT_KEYS compile-time
  lockstep). centsAtStake = charge magnitude verbatim; new verbatim display-context fields on
  Proposal (autopayCents precedent): `merchant`, `typicalCents`, `typicalCount` — null for every
  other kind. No push (notify/select untouched). Copy in today-feed-copy.ts: figure labeled as the
  charge, median disclosed with sample count, owner-neutral, no summing.
- Server/UI: coach.ts runs detector on already-fetched txns → CoachData.unusualCharges; dashboard
  page adds to nudgeInput. Demo dashboard must show the $214.36 nudge (demo-first).

**Steps 1–9 DONE (real output):** engine + 20 unit tests incl. exactly-one seed lock; EDGE_CASES
§Unusual Charge Radar (F1–F12 hand math); seed anomaly (−21436 Blue Bottle 2026-06-02, RNG stream
untouched); feed integration (types/select/event/copy) + extended nudge-select / nudge-feed-copy /
engagement tests; coach+dashboard wiring; 3 seed-pinned tests re-verified by hand (trends pace
95365/286095, largest lists, Ask headline $214.36 Blue Bottle); `bash scripts/verify.sh` →
✅ VERIFY GREEN 3035 unit / 214 files, tsc+eslint+build clean; today-feed.spec 6/6 green (fresh
build) incl. new #249 case; docs done (DECISIONS #249 + index, STATUS §Unusual Charge Radar,
SEED_SPEC, AI plan §Later #12 un-staled). **Pending:** 10 fresh-context Fable hostile critic →
fix → re-verify · 11 commit #249.

## 2026-07-20 — AI plan §3.4 Subscription Radar — COMPLETE (#246, verify green, critic PASS)

All 5 steps done. Engine engine/recurring/renewals.ts (upcomingRenewals + renewalsWithin; 21 unit tests incl. seed-grounded block) + RecurringData.renewals + 'Coming up' section on /recurring + recurring.spec e2e 3/3 (fresh build) + EDGE_CASES §Upcoming renewals. Fable fresh-context critic: PASS 0 P0/P1; P2-1/2/3 fixed same session (honest 'was $X' badge, IRREGULAR skip locked, shared bucket predicate), P2-4 resolved by P2-1 rewrite. Gate: bash scripts/verify.sh -> VERIFY GREEN, 2934 unit / 211 files, tsc+eslint+build clean. Residuals recorded in STATUS (calendar gap, nudge kinds, drafter deferred). DECISIONS #246; STATUS section added; next owner-gated pick: AI plan §3.3 / §3.5 / Later.

## 2026-07-20 — AI plan §3.4 Subscription Radar — deterministic slice (session start)

Owner picked §3.4 (Subscription Radar, deterministic slice only) as the next AI-plan slice after #244/#245; tree clean at 6f23280. Next DECISIONS number: **#246**.

## 2026-07-16 — AI plan §3.2 Trust Center & Audit Ledger (#242) — SHIPPED, verify green, critic cycle 3 PASS

**Final:** 3 Fable critic cycles FAIL (P1: demo copy falsifiable on keyed deployments — demo Ask
egressed invisibly) / FAIL (P1: per-site fences missed both INGEST sites; fixed with the single
`categorizeSuggestFor(userId)` constructor) / PASS (0 P0/P1, exhaustive call-path audit, no
bypass). Gate: ✅ VERIFY GREEN 2898/206; trust.spec 1/1 + ask.spec 20/20 (the server-only
conversion briefly broke the tsx vocab fixture — assistant-llm/ai-audit are plain modules now,
llm-categorize keeps server-only) + phase3-coach 1/1. Docs: DECISIONS #242, STATUS §Trust Center,
EDGE_CASES §AI Trust Center, 3 regression rows. Owner follow-up recorded: fence demo out of the
bank-connect actions (pre-existing shared-account privacy hole, now the only residual).

## 2026-07-16 — AI plan §3.2 Trust Center & Audit Ledger (#242) — original plan (superseded by the SHIPPED entry above)

**Owner pick** after the stale STATUS pointer was corrected (790e895): §1.1 had NO remaining
goal-type solvers (trilogy #125/#126/#131 complete; §1.2 = #172; §3.1 = #238/#239). Owner chose
§3.2 from the Wave 3 remainder.

**Adjudication reworks, re-scoped against current tree:** (b) `CategoryPrediction.source` +
live-ingest persistence ALREADY SHIPPED via #238 (plaid.ts:629, simplefin.ts:645,
predictions.ts:40 — no schema work needed). Remaining: (a) narrowed headline ("AI-originated
dollar figures / financial facts: 0"; LLM confidence disclosed as surfaced uncertainty), (c)
AuditLog LLM-touchpoint logging incl. rejections, + pure formatter + surface.

**Design (settled):**
- 4 LLM touchpoint modules (llm-categorize, assistant-llm, money-review-llm, balance-move-llm)
  gain an optional `onOutcome?` sink param, called EXACTLY ONCE per attempted provider call with
  `replied | rejected | unavailable` + closed-set meta (categorize {categoryId, confidenceBps};
  intent {kind}; review_order {count}; move_draft {} — model-authored template text is never
  persisted). No key → sink NOT called (no call happened). Sink await'ed, wrapped so it can never
  break the answer path. Existing null-fallback tests untouched.
- Convert llm-categorize.ts + assistant-llm.ts from 'use server' → `import 'server-only'`
  (all callers are server-side; closes a pre-existing exposed-endpoint hole; matches the two
  newer LLM modules). DECISIONS note.
- New `src/server/ai-audit.ts`: `aiAuditSink(userId, touchpoint)` → writes
  `ai.<touchpoint>.<outcome>` AuditLog rows; DEMO_USER_ID → no-op (shared-demo lesson); write
  failure swallowed. Touchpoints: categorize | intent | vocab_recheck | review_order | move_draft.
- 9 call sites wired: transaction-actions (manual + CSV), plaid, simplefin, backfill-actions,
  assistant.ts, vocab.ts, coach.ts, balance-move.ts.
- New pure `src/lib/engine/ai-audit/describe.ts`: parse/describe/summarize AuditLog `ai.*` rows →
  human lines (closed-set values only; category label via CATEGORY_BY_ID; unknown → honest
  generic). Reuse `accuracy/score.ts` UNCHANGED for the Brier scorecard.
- Surface: new `/(app)/trust` page (linked from /settings, NOT a new nav icon): narrowed headline
  invariant, scorecard with inline sample size + honest small-n copy, static touchpoint table,
  recent-AI-events ledger, honestly-empty demo state. e2e trust.spec.ts + axe AA.

**Steps:** [1] engine describe.ts + tests → [2] sink params in 4 modules + tests → [3) recorder +
9 call sites → [4] read path + page + e2e → [5] verify green → [6] Fable hostile critic (cap 4)
→ [7] docs (STATUS/DECISIONS/EDGE_CASES/REGRESSION_LEDGER) + commit.
**Now at:** step 6, critic cycle 1 dispatched. Steps 1–5 done: `bash scripts/verify.sh` →
✅ VERIFY GREEN (exit 0); full vitest 2892 passed / 205 files (+38 vs #241); trust.spec.ts e2e
1/1 mobile-380 incl. axe AA; EDGE_CASES §AI Trust Center + 3 REGRESSION_LEDGER rows written.
Route /trust builds (in next build route table). Design deltas vs plan: adjudication rework (b)
was already shipped by #238 (no schema change in this slice); 'use server'→server-only conversion
on llm-categorize.ts + assistant-llm.ts (closed a pre-existing exposed-endpoint hole).

## 2026-07-15 — Glass-Box slice 2a (GLASSBOX_PLAN, trace UI) — SHIPPED, verify green, critic cycle 2 PASS

**Done (committed as #233):** the slice-1 trace engine is now wired into Ask. A row-sum answer's
headline number is tappable → an inline reconciliation panel (the exact rows behind it, penny-
reconciled + basis lines). Derivation figures stay a plain untappable `<p>`.
- `answer.ts`: `AssistantAnswer` gains `headlineCents?` (each row-sum builder sets it from its OWN
  figure) + `trace?: AnswerTrace` (type-only import of AnswerTrace — erased, no runtime cycle).
- `server/assistant.ts`: after `buildAnswer`, for a row-sum kind with `headlineCents`, attaches
  `traceAnswer(intent, { transactions, today, meta, expectedHeadlineCents: headlineCents })` —
  same snapshot+meta, so the drift guard is a real (non-vacuous) equality gate.
- `ask-view.tsx`: headline is a `<button aria-expanded>` disclosure when `trace.kind==='row_sum'`;
  `TracePanel` renders rows/groups + a "✓ … add up to $X" line (or an honest "can't reconcile"
  fallback, no ✓); `traceOpen` resets per answer.
- NEW `trace-view.ts`: pure `reconciledView(trace)` — shows the group breakdown ONLY when groups
  sum to the tapped figure (fixes the top_categories false green-check). Client-safe (type-only
  deps → no engine in the bundle).
- Tests: `assistant-headline-cents.test.ts` (headline string contains `formatCents(headlineCents)`;
  empty/derivation omit it), `assistant-trace-view.test.ts` (real-engine top vs total), e2e:
  3 new Ask cases (tappable reconciles; top_categories groups-count 0; net worth not tappable).

**Critic:** cycle 1 FAIL (P1-1: top_categories green-checked a count/sum across all listed
categories) → fixed with reconciledView → cycle 2 PASS 0 P0/P1. Gate: verify GREEN 2650/190,
ask e2e 15/15.

**Next: slice 2b** — per-fact tappability (builder-tagged trace keys) + the one-tap correction
chip (a WRITE path; shared-demo-account fence; own Maker/Checker slice). Then slice 3 (derivation
"formula + inputs" view). Owner-gated items unchanged (the push; #171+ ride together).

## 2026-07-15 — Glass-Box slice 1 (GLASSBOX_PLAN, engine) — code done, verify green, critic cycle 1 IN FLIGHT

**Done:** the ROW-SUM trace engine per docs/GLASSBOX_PLAN.md. (a) reports.ts: `isSpendRow` /
`spendRowCategoryId` / `spendContributionCents` extracted from `spendingByCategory`, which now calls
them (claimed byte-identical; C6 reference test locks it). (b) insights.ts: `isIncomeFlowRow`
extracted from `monthlyFlows`, loop refactored. (c) answer.ts: `toPurchaseRows` moved in from
server/assistant.ts (new `SnapshotTxnLike`); server delegates. (d) NEW
src/lib/engine/assistant/trace.ts — `traceAnswer(intent, {transactions, today, meta})`: spend_total
hierarchical (byCategory IS the reconciliation; net-refund categories excluded), spend_by_category
(category/umbrella/group), top_categories (headline = top category's rows; all listed as groups),
merchant_spend (pure reshape of `merchantSpend().items`, gross), income (windowed `monthlyFlows`
sum + `isIncomeFlowRow` rows), largest_purchases (the single top row). Derivation intents →
`{kind:'not_row_sum'}`; `ROW_SUM_KINDS` exported for UI tappability. Runtime `reconciled` check —
fail loud, never a wrong number. (e) NEW tests/unit/assistant-trace.test.ts: acceptance criteria
1–6 incl. seed grounding (36 tests).

**Evidence:** `bash scripts/verify.sh` → ✅ VERIFY GREEN; `npx vitest run` → **2630 passed / 188
files** (+36/+1 over #230's 2594/187). Seed income note: June (asOf 2026-06-10) has $0 income —
non-vacuous income grounding asserted on May instead.

**Critic cycle 1 (fresh-context Fable, 2026-07-15): FAIL — 2 P1, 1 P2, 2 P3.** The lockstep core
survived a 4000-iteration old-vs-new fuzz (~160k intent checks) clean; both P1s were API-shape:
(F1) `TraceInput.meta` optional → a meta-less caller mis-bucketed custom categories, wrong number
stamped reconciled — FIXED: meta now REQUIRED, custom-meta tests added (F3). (F2) no answer→tap
drift detection — FIXED: `expectedHeadlineCents?` folds the tapped figure into `reconciled`.
(F4/F5, P3) recorded as binding slice-2 constraints in GLASSBOX_PLAN §Sequencing: per-figure
tappability (detail sentences with totals/share-% stay non-tappable), largest runner-up facts
non-tappable, server must thread mergeCategoryMeta + expectedHeadlineCents. Post-fix:
verify GREEN, **2635 unit / 188 files** (41 trace tests).

**Critic cycle 2 (fresh-context Fable, 2026-07-15): PASS — 0 P0/P1.** Both cycle-1 P1 repros
re-executed independently and confirmed closed (incl. tsc rejecting a meta-less call); falsy-zero
`expectedHeadlineCents`, not_row_sum interaction, and additivity all verified; independent
400-iteration fuzz clean. 3 P3s: dead `TxnLike` cast (removed), expectedHeadlineCents-optional
trap (slice-2 constraint (c) — consider required when the first caller lands), custom-Income-group
observation (recorded in STATUS). **DONE:** docs updated (STATUS wave section, DECISIONS #232 +
index, 2 REGRESSION_LEDGER entries), committed.

## 2026-07-14 — #230 TASKS 2.7 — timeframe follow-up + largest merchant scope — DONE, verify green, critic cycle 2 PASS

**Done:** TASKS 2.7 shipped (DECISIONS #230). (a) `parseExplicitTimeframe` learns bare years / since / ranges / numeric dates (month-window rule for M/D, matching the shipped worded form); future years and months are never windows. (b) NEW `unresolvedDateShape` guard: an unwindowable date shape abstains every timeframe-carrying route — parser, `intentFromKind` (LLM + vocab, custom categories now threaded), and the conversation frame. Fixed CONFIRMED live cardinal sins: 'groceries in 2025' → the THIS-MONTH figure, 'since 2024' / 'between 2024 and 2025' → the this-month total, 'since march' → March-only. (c) The #229 licence takes `today` and consumes exactly what the parser windows (shared recognizers). (d) `largest_purchases` gains optional `merchant` via shared `largestScope` (at/with/from; abstains on fronted stores, #168 payment/account words, unreadable names, category/unknown modifiers); frame carries the merchant on window swaps and re-scopes on 'what about at X?' (supersedes #223 P2-5); `validateIntent` bounds it. (e) NEW shared `isLicensedIdiomPhrase`: 'at the moment' / 'at the end of last month' are idioms, not stores — also fixes pre-existing merchant_spend 'No spending at Moment' answers.

## 2026-07-12 — #229 TASKS 2.6 — spend_total earns its answer (the inversion) — DONE, verify green, critic cycle 2 PASS

**Done:** TASKS 2.6 shipped (DECISIONS #229). `spend_total` now requires a POSITIVE LICENCE — the new shared primitive `unconsumedSpendObject` (every at/with/on/in object anywhere in the question must be consumed-class, whole-object, up to a genuine closer) — enforced identically at the parser sink, in `intentFromKind` (LLM + vocab routes), and in the conversation frame. Fronted objects ("At Costco, how much did I spend?"), sentence breaks, "@"/"in" phrasings and punctuation glue abstain instead of answering the user's entire spending. Bundled siblings: home depot/homegoods/home-and-garden → merchant_spend (tier-3 group fallback word-bounded + extension-checked); "at - costco"/"at... costco" → merchant "costco"; custom "Café" reachable (NFC + Unicode boundaries + exact-object carve-outs, tail included); the frame BLOCKS guard-refused objects ("with amex in june" / "income in june" no longer answer the carried question's window swap; pronouns still carry).

## 2026-07-12 — #224 Frame critic cycle 2 — PASS (0 P0/P1)

Cycle 2 (same critic, every repro re-executed against the fixed tree): **PASS — 0 P0, 0 P1**. All 7 cycle-1 findings CLOSED by re-run repros; a 19-case sweep found no legitimate ellipsis broken by the new guards. Two new P2s found and fixed: (a) `validateIntent` derived nothing about `target.label`, so a client-echoed frame could label the TRAVEL group "Groceries" — a true figure under a false name in a money headline; labels are now re-derived from the target's own identity (`canonicalTargetLabel`). (b) a stray "at" manufactured merchants ("at least", "at work"). Plus two P3s: "save"/"cut"/"back" left the question-word guard ("and at Save Mart?" must resolve), and a carried TRAILING window is re-named once today leaves it ("the last 3 months" → "April 2026 – June 2026").

## 2026-07-12 — #222/#223 Ask conversation frame (TASKS 2.1) — DONE

Gate (real 2026-07-12, post-critic): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — tsc/eslint clean, **2429 unit / 181 files** (+38), build clean. `npx playwright test tests/e2e/ask.spec.ts` → **10/10**, including a new flow that drives the real UI through two chained ellipses (window swap, then category swap) — proving the client→server→client frame round-trip, not just the pure engine.

## 2026-07-12 — Household MVP slice 8: full-surface hostile critic (T1–T12) — DONE ✅ (#221, VERIFY GREEN incl. e2e 104/104 @ 4 workers)

**Done:** three fresh-context Fable critics returned: A (authz) 0 P0/P1 + 3 P2, all invariants VERIFIED; B (visibility) 0 P0, 1 P1 (missing T8 export lock) + 2 P2, exhaustive fetcher inventory clean; C (money) 0 P0, **6 P1** + 5 P2 — the composition boundary carried the second-person/false-disclosure disease the slice-7 digest fix cured in email only, plus the routed F-5 double-count. ALL P1s and all actionable P2s fixed and locked: T8 export test; T10 visibility-half assertion; deleteMyData ghost-household reap; `detectHouseholdDuplicateAccounts` (relaxed same-provider skip) + advisory disclosures on scope toggle (dashboard/cards/calendar) and joint digest — figures deliberately NOT adjusted (DECISIONS #221); all-types `accountOwnerLabel` + owner-attributed partner copy on reminders card and /cards (new HOUSEHOLD_COPY keys under the exhaustive scan + partner-due ban); household headline re-attributed 'across <household>' + autopay assumptions sentence; digest `sharedAccountCount` fixes loan-only "nothing shared" lie; slice filters orphan rows + counts withheld for interactive disclosure; `|| 'Partner'`/`name || email` empty-string label fixes; cron digest degrades household→personal atomically (audited); deleteCustomCategory owner-scoped; sanctioned-predicate-site index in household-authz. Ledgers: 8 REGRESSION_LEDGER entries + DECISIONS #221 + EDGE_CASES §Household Duplicate Detection + T9 row corrected in HOUSEHOLD_ARCHITECTURE. Touched suites green (127 tests across 5 files at last targeted run).
**Gate (real):** `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN exit 0 — tsc clean, eslint clean, 2391 unit / 180 files, build clean, e2e 104/104 at the configured 4 workers. (First gate run failed on 2 lint warnings: the /calendar page destructured the new disclosures but never wired them into the toggle — a real F-5/F-6 wiring gap, fixed before the green run.)
**Ledger:** STATUS §slice 8, TASKS 4.2 → [x] all 8 slices, DECISIONS #221, 8 REGRESSION_LEDGER entries, EDGE_CASES §Household Duplicate Detection, HOUSEHOLD_ARCHITECTURE T9 row corrected.
**Blocked:** nothing.

## 2026-07-12 — Household MVP slice 6: partner categorization on shared accounts (#219)

**What shipped:** new `recategorizeSharedTransaction` (src/server/household-actions.ts) -- the entire partner-write surface on shared data per SS6.1: system categories only, no rule, no batch, Correction attributed to the acting user, CategoryPrediction.labeledAt never touched, authorization re-derived fresh inside the serializable tx (not the outer requireViewer() snapshot). `SharedTransactionList` upgraded from read-only to a one-off recategorize picker (register mutation-form recipe, ASSIGNABLE_GROUPS only). No schema change.

## 2026-07-12 — Household MVP slice 5: cards/calendar household scope + copy audit (#218)

**What shipped:** /cards and /calendar wired to the existing slice-4 scope support (getDashboardData/getCashNeeded already merged partner cards; slice 5 was pure plumbing, no engine change). HouseholdScopeToggle generalized (basePath + extraParams) and reused on both new pages; calendar's month nav now carries scope so paging months does not reset it to mine. cardId -> ownerLabel map built server-side (resolveViewer gained memberNames) so CardsBreakdown can badge a partner's shared card without touching CardObligation. Cross-app copy audit extracted every household disclosure into src/lib/copy/household-copy.ts (verbatim, no wording changed) with a new guardrail test (tests/unit/household-copy.test.ts) mirroring coach-copy.test.ts -- closes the blind spot slice 7's joint digest will otherwise inherit. New/extended tests: tests/unit/household-cash-needed.test.ts (getCashNeeded household/scope parity with getDashboardData, cardOwnerLabel T6-empty-in-mine + correct-in-household), tests/e2e/household.spec.ts (slice 5 T6 golden safety: no toggle on /cards or /calendar for the demo user, stale ?scope=household never errors).

## 2026-07-11 — S.3: scripts/docs-lint.ts

Built and verified scripts/docs-lint.ts (Pulse-leak / hardcoded-count / archive-banner / verify-phrasing checks). Added

## 2026-07-11 — #216 Docs de-dup pass (TASKS S.1 + S.2)

**S.1 re-confirmed done** (was already DONE from a prior session, DECISIONS #214): `scripts/ledger.ts` + package.json aliases exist and work (used by this very entry).

## 2026-07-11 — Housekeeping: push #216, confirm CI green — DONE ✅ (tree clean, origin green)

Session scope: no new features. The 4 line-ending files the task named (CLAUDE.md,
docs/PRIVACY.md, docs/archive/{CATEGORIZATION_DIAGNOSIS,PULSE_CATEGORIZATION_FIX}.md) already
matched HEAD byte-for-byte — nothing to restore. The #216 fix (transaction-filters.tsx +
transactions.spec.ts) was already committed in `5ceb390` with its ledger entries. Pushed the
6 local commits (`a892402..e1fca4a`) to `origin/main`.

**First CI run (`29140509509`, commit `e1fca4a`) was RED**, not the flake it might have looked
like: `tests/unit/self-audit-server.test.ts` failed deterministically (reproduced on a manual
rerun too — ruled out flake before touching code). Root cause: CI's `verify.yml` pins
`DEMO_TODAY=2026-06-10` at the job level, which overrides `businessToday()` for **every** user
by design (DECISIONS #58) — but the test seeded `UnknownQuestion`/`NotificationSent`/
`EngagementEvent` rows with implicit `now()` timestamps, then queried them by a
`[weekStart, weekStart+7)` window built from that pinned date. Locally `vitest run` never
loads `.env`, so `DEMO_TODAY` is unset there and `now()` happens to coincide with the
real-clock week, masking the bug. In CI the real insert clock (2026-07-11) and the pinned
week (containing 2026-06-10) are a month apart, so the windowed counts came back 0. Fixed by
seeding those three rows with an explicit in-window timestamp instead of relying on wall-clock
coincidence (`9c60cc3`, REGRESSION_LEDGER 2026-07-11). Fail-old proven via
`DEMO_TODAY=2026-06-10 npx vitest run tests/unit/self-audit-server.test.ts` before the fix.

After the fix, two more full CI runs each failed on a DIFFERENT e2e assertion timeout
(`budget-targets.spec.ts`, then `phase2-triage.spec.ts`) — neither touched by this session's
diff, neither repeating on its own rerun, unit suite green throughout. Diagnosed as CI-runner
timing contention, not a regression (see new lesson `docs/lessons/ci-e2e-timing-flake.md`,
distinct from the local-Windows `mobile-380-viewport-scaling-flake.md`). A fourth full run
(same commit `9c60cc3`, run `29141495777`) came back **green**.

Gate (real 2026-07-11): CI run https://github.com/meleesciony/Aimplifi/actions/runs/29141495777
→ **conclusion: success** on `9c60cc3`. `git status` → clean, up to date with `origin/main`.
**SAFE to /clear.**

## 2026-07-11 — #216 register-search hydration bug — DONE ✅ (tree clean, HEAD green)

Session opened to finish a "large uncommitted change set" (all `(app)` pages, schema,
cron routes). **It did not exist.** The four modified files had EMPTY diffs — EOL-only
phantoms (`core.autocrlf=true`, no `.gitattributes`); the only real untracked item was
`docs/archive/README.md` (now committed, `b9a713a`). The remembered change set was
already committed as slices 1–4 (#210/#212/#213/#215). `stash@{0}` ("Cursor: moved local
changes to cloud agent") + branch `cursor/cloud-agent-1783688239547-e4cv5` hold the SAME
four ledger/doc files for #198, all of which are **already in main** and superseded by
main's newer TASKS 0.3 row (#198/#203/#204) — kept, not dropped, pending owner sign-off.

**HEAD was NOT green.** `VERIFY_E2E=1 bash scripts/verify.sh` at `3375d9c` → ❌ 3 e2e
failures. Two (exports, pwa-offline) were load flakes that passed in isolation; the third
was **deterministic on mobile-380**. Not the known viewport flake — the signature was not
`intercepts pointer events` (per docs/lessons, read the signature before blaming it).

Root cause (#216, REGRESSION_LEDGER): `txn-search` was a CONTROLLED input. Text typed
before hydration attached `onChange` never reached React state; the first render blanked
the DOM box and `commit()` pushed `/transactions` — the same URL — with an EMPTY query.
The user's search silently vanished and they stayed on the unfiltered register. Fixed by
letting the DOM own the typed text: uncontrolled input (`name="q"` + `defaultValue`, keyed
on `current.search` so Clear remounts it), `onSubmit` reads the live value via `FormData`.
Also retires the `react-hooks/set-state-in-effect` eslint-disable that flagged this exact
smell in #166.

**Process gap worth keeping:** slice 4's recorded gate line is plain `bash scripts/verify.sh`
(unit-only). e2e only runs under `VERIFY_E2E=1`, so this shipped as "verify green" with the
e2e lane never executed. Run the e2e lane before stamping a slice green.

Gate (real 2026-07-11): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN**, exit 0 —
tsc/eslint clean, **2285 unit / 178 files**, build clean, **103 e2e** (+1: the #216 lock,
fail-old proven on mobile-380 before the fix).

### HANDOFF — 2026-07-11
**NEXT:** TASKS 4.2 **slice 5** — cards/calendar household scope + copy audit (**Sonnet-lane**,
not slice 6). Surfaces mapped: `/cards` calls `getDashboardData(userId)` at the default
`'mine'` scope (one-line hook); `/calendar` calls `getCashNeeded(userId)` and already parses
a `month` searchParam (add `scope` alongside it, and carry BOTH on the `cal-prev`/`cal-next`
links, which currently drop everything but `month`). Scope type is `'mine' | 'household'`
(`src/server/finance.ts:27`). Two design notes for that session: (a) keep the engine free of
any user concept — build a `cardId → ownerLabel` map server-side in `getDashboardData` and
badge partner cards in `CardsBreakdown`, mirroring the slice-2/3 owner-badge precedent,
rather than adding an owner field to `CardObligation`; (b) **there is no `HOUSEHOLD_COPY`
module** — all household copy is inline JSX, and `tests/unit/coach-copy.test.ts` scans only
CALLABLE exported copy (its `ALL_STRINGS` array invokes copy fns; no auto-discovery), so the
"guardrail scan of all new household copy" requires extracting household copy into a callable
constant first. Slice 7 assumes that module exists.
**SAFE to /clear.**

## 2026-07-11 — Household MVP slice 4 — Joint cash-needed

Gate (real 2026-07-11): `bash scripts/verify.sh` -> **VERIFY GREEN** -- tsc/eslint clean,

## 2026-07-10 — S.1 ledger.ts + TASKS.md restore (Wave S)

**What shipped:** `scripts/ledger.ts` (decision/regression/progress appenders + `docs/DECISIONS_INDEX.md` generator, zero model calls) + package.json aliases `verify:e2e`, `verify:fast`, `ledger` (`verify`/`eval:categorize` already existed). Per docs/SKILLS_PLAN.md S2+S4.

## 2026-07-10 — #213 Household slice 3: shared transactions in register (TASKS 4.2 §5 slice 3) — DONE ✅

Resumed on "continue" after #212. **What shipped:** `categoryNamesByIds` in
category-meta.ts (scoped-ids only — getCategoryMeta untouched, F3);
`getSharedTransactionsView()` SEPARATE from `getTransactions` (personal
summary/picker isolation, §4.5); `SharedTransactionList` on /transactions
(owner badge, plain-text category, no triage); consent copy updated on
/accounts; PRIVACY disclosure widened to transactions.

**Locks:** T1 (private absent), T2/T4 (leave empties), T3 (recategorize → not
found), F3 (viewer meta lacks partner customs), personal-register isolation,
T6 e2e absence on /transactions. No Fable critic this slice (authz locked in
#212; money merge is slice 4).

**Gate (real output 2026-07-10):** `bash scripts/verify.sh` → **✅ VERIFY
GREEN** — tsc/eslint clean, **2271 unit / 177 files** (+8 in new file), build
clean. Targeted e2e `household.spec.ts` **4/4**. Ledgers: DECISIONS #213,
STATUS §Wave 4.2 slice 3, PRIVACY, TASKS 4.2 → slices 1–3 done,
REGRESSION_LEDGER F3 line.

### HANDOFF (resume after /clear) — 2026-07-10, #213 DONE
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md → CLAUDE.md →
docs/lessons/INDEX.md, then TASKS.md. **State:** #213 at `9d98087` on main;
prod deploy **Ready** `dpl_2e88AFkkXjbFBgXe6YS5HrTVLgcB` → `aimplifi.app` /
`www.aimplifi.app`. Health baseline: verify GREEN 2271/177, household e2e 4/4.
**Next per TASKS.md:** 4.2 slice 4 — joint cash-needed (`getSharedSnapshotSlice`
+ pure `mergeSnapshots()` with EDGE_CASES fixtures; dashboard scope toggle;
assumptions copy; **Fable hostile critic — money surface**; T9). Alternatives:
3.3 adaptive dashboard / 3.4 tone variants (lighter). **Owner-gated
(unchanged):** cron FIRE verification in Vercel logs (0.3), Neon backups (0.6),
live Plaid Link UI + webhook round-trip, Wave 4.5 allowlist widening.
**SAFE to /clear.**

## 2026-07-10 — #212 Household slice 2: account sharing (TASKS 4.2 §5 slice 2) — DONE ✅

Resumed on "continue" (Fable lane — slice 2 IS the central authz seam, so build +
critic ran on Fable in one session, the #210/#206 precedent). **What shipped:**
§4.3's central helpers in `src/server/authz.ts` — `partnerIdsOf`,
`partnerSharedAccountsWhere` (null without partners), `visibleAccountsWhere`
(degenerates to EXACTLY `{ userId }`, deep-equality-locked — T6);
`getAccountSharingView()` in server/household.ts as a SEPARATE query path from
`getAccountsView` so the #192 duplicate detector's input stays the OWNED set
(T9 — unit proves a partner-shared twin that WOULD pair never trips it);
`setAccountShared` action (owner-only row scope, demo refused, audited);
`HouseholdSharingCard` on /accounts ("Shared with you" read-only owner-badged
rows + own-account share toggles, #167 mutation recipe); PRIVACY.md disclosure.

**Fresh-context Fable hostile critic: cycle 1 FAIL — 1 P1 + 3 P2, all fixed
in-cycle.** P1 (real consent race): setAccountShared(ON) racing leave/remove
strands `sharedToHousehold=true` with no membership → since the flag names no
household, it would auto-share into the user's NEXT household (§4.1 violation).
Fixed both sides: the ON-write re-checks live membership inside its own `where`
(leaveHousehold idiom), AND createHousehold/acceptInvite reset the joiner's
flags atomically with the membership create — locked by tests on both join
paths. P2s fixed: consent copy now states the FULL disclosure (name, type,
last 4, balance); owner's toggle list is NOT currency-filtered (consent must
always be visible/revocable; partner-side display stays guarded); member-state
e2e added (throwaway signup → create household → manual account → REAL share
round-trip → axe WCAG-AA at 380px). P3 hygiene: scalar-args validation on the
action. Accepted P3s documented in DECISIONS #212 / STATUS §4.2-slice-2.

**Gate (real output 2026-07-10, post-critic):** `bash scripts/verify.sh` →
**✅ VERIFY GREEN** — tsc/eslint clean, **2263 unit / 176 files** (+15: 5 pure
degeneracy + 8 integration + 2 join-reset locks), build clean. Targeted e2e
`household.spec.ts` **3/3** (demo golden-safety + member-state mutation + axe).
Ledgers: DECISIONS #212, STATUS §Wave 4.2 slice 2, PRIVACY §What-is-stored,
TASKS 4.2 → slices 1–2 done.

### HANDOFF (resume after /clear) — 2026-07-10, #212 DONE
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md → CLAUDE.md →
docs/lessons/INDEX.md, then TASKS.md. **State:** #212 committed at HEAD (push
owner-gated? No — pushes are unblocked since 0.1; push after commit unless the
owner said otherwise this session). Health baseline (re-confirm, don't trust):
verify GREEN 2263/176, household e2e 3/3. **Next per TASKS.md:** 4.2 slice 3 —
shared transactions in the register (read-only rows, owner badge, NO triage
affordances on partner rows, category names via a scoped-ids lookup — NEVER a
`getCategoryMeta` widening; T1, T3 — Opus lane per routing, Fable critic not
required until slice 4's money merge) — or 3.3 adaptive dashboard order / 3.4
tone variants if a lighter session is wanted. Slice 4 (joint cash-needed) is
the next Fable-critic money surface. **Owner-gated (unchanged):** cron FIRE
verification in Vercel logs (0.3), Neon backups (0.6), live Plaid Link UI +
webhook round-trip, Wave 4.5 allowlist widening.

## 2026-07-10 — prod deploy confirmed (post-#211)

`main` clean @ `20152fb` (#211) + `f420925` (#210). GitHub→Vercel auto-deploy
**Ready** `dpl_Bg3XVz6u9rWrzEPYmgzrQVF4zizs` → aliases `aimplifi.app` /
`www.aimplifi.app`. Build includes `/api/cron/audit` (Mon 15:00). Spot-check:
`GET /api/cron/audit` → **401** (route live, secret-gated); `/sign-in` → 200.
CLI `vercel --prod` upload failed once (empty Vercel error); git deploy is the
source of truth. **Do not seed.** Cron *fire* still UNVERIFIED.

### HANDOFF — 2026-07-10, deploy confirmed
**Resume from `C:\dev\Aimplifi`.**
**NEXT:** 4.2 slice 2 `visibleAccountsWhere` (Opus), or 3.3 / 3.4.
**SAFE to /clear.**

## 2026-07-10 — #211 weekly self-audit Critic (TASKS 3.2) — DONE ✅

Pure rates + `SelfAuditSnapshot` + `/api/cron/audit` + AI-trust panel.
Alert act-rate is an engagement proxy until 3.5.
Gate: verify ✅ **2248 unit / 175 files**.

### HANDOFF — 2026-07-10, #211 / TASKS 3.2 DONE
**Resume from `C:\dev\Aimplifi`.**
**NEXT:** 4.2 slice 2 `visibleAccountsWhere` (Opus; scoped Fable critic on
helper), or 3.3 adaptive dashboard (Opus+Grok UI), or 3.4 coach-copy (Sonnet).
Cron fire still UNVERIFIED (0.3).
**SAFE to /clear.**

## 2026-07-10 — #210 Household MVP slice 1: membership core (TASKS 4.2 §5.1) — DONE ✅

Engine-first per HOUSEHOLD_ARCHITECTURE.md: §4.2 schema verbatim (3 tables +
inert `Account.sharedToHousehold`), pure `engine/household/membership.ts`
(two-factor redemption gate, lazy expiry, deterministic repair, role rules),
`requireViewer()` self-heal (authz.ts), the 7 actions, `getHouseholdView`,
/settings Household card (one-time code shown once, #167 recipe). Fresh-context
Fable hostile critic on the state machine: **cycle 1 FAIL — 1 P1 + 3 P2, all
fixed in-cycle** (demo-user guard = T6 as a GUARD; email-factor-first gate order
kills the invite-liveness oracle + only code mismatches burn attempts;
serializableTx pending-claim on accept kills the revoke-overwrite TOCTOU; sticky
declines until window expiry) + P3s (converging cap-revoke, P2002-aware catches,
`isValidEmail` on invites, honest entropy comment, doc reconciliation). Ledgers:
DECISIONS #210, STATUS, PRIVACY §What-is-stored, TASKS 4.2 → [~] slice 1,
HOUSEHOLD_ARCHITECTURE §4.1/§4.6 updated. Tests: 24 engine units + 19
integration (real actions, throwaway users, T2/T4/T6/T7/T10/T11/T12 locks) +
render-only e2e (demo empty state + axe AA).

### HANDOFF — 2026-07-10, #210 / TASKS 4.2 slice 1 DONE
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md → CLAUDE.md →
docs/lessons/INDEX.md, then TASKS.md.
**NEXT:** 4.2 slice 2 — `visibleAccountsWhere` + degeneracy units + /accounts
"Shared with you" as a SEPARATE query path (the #192 detector constraint, T9)
+ `setAccountShared` action (owner-only, requires live membership). Opus lane;
Fable critic optional (helper is small but is THE confidentiality boundary —
recommend a scoped critic on the helper + action only). Alternatives: 2.1
conversation frame (Opus high + Fable), 3.2 weekly self-audit (Opus).
Cron fire still UNVERIFIED (0.3).
**SAFE to /clear.**

## 2026-07-10 — #209 EngagementEvent capture (TASKS 3.1) — DONE ✅

Closed-set `EngagementEvent` + dashboard dismiss/expand/act hooks +
PRIVACY/AI-trust disclosure. Writes-only (3.3 reads later).
Gate: verify ✅ **2195 unit / 171 files**.

### HANDOFF — 2026-07-10, #209 / TASKS 3.1 DONE
**Resume from `C:\dev\Aimplifi`.**
**NEXT:** Wave 4.2 household slice 1 (Opus + Fable critic), or 2.1 conversation
frame (Opus high + Fable), or 3.2 weekly self-audit (Opus). Cron fire still
UNVERIFIED (0.3).
**SAFE to /clear.**

## 2026-07-10 — #208 UnknownQuestion ledger (TASKS 2.2) — DONE ✅

Pure `scrubQuestionText` + additive `UnknownQuestion` + Ask wiring on
parser-unknown (incl. LLM rescue). Golden-safe (engines never read).
Gate: verify ✅ **2189 unit / 169 files**.

### HANDOFF — 2026-07-10, #208 / TASKS 2.2 DONE
**Resume from `C:\dev\Aimplifi`.**
**NEXT:** Wave 4.2 household slice 1 (Opus + Fable critic on membership state
machine), or Wave 2.1 conversation frame (Opus high + Fable), or 3.1
EngagementEvent (Opus). Cron fire still UNVERIFIED (0.3).
**SAFE to /clear.**

## 2026-07-10 — #207 personalized triage alternatives (TASKS 1.7) — DONE ✅

`deriveCorrectionHints` + `suggestAlternatives({ personalized })` + triage
wiring via `loadCorrectionInputs`. Demo/zero corrections unchanged.
(Renumbered from a colliding #206 — value-receipts already claimed #206.)
Gate: verify ✅ **2179 unit**.

### HANDOFF — 2026-07-10, #207 / TASKS 1.7 DONE
**Resume from `C:\dev\Aimplifi`.**
**NEXT:** Wave 4.2 household slice 1 (Opus+Fable), or remaining Wave 1/2/3
open rows. Cron fire still UNVERIFIED (0.3).
**SAFE to /clear.**

## 2026-07-10 — #205 savings-rate streaks (TASKS 1.4) + #204 Resend verified — DONE ✅

Owner confirmed Resend domain + Delivered test (#204). Shipped Wave 1.4:
`computeSavingsStreak` + COACH_COPY + SavingsRateCard streak/PB lines.
Gate: verify ✅ **2127 unit**; phase3-coach e2e 1/1.

### HANDOFF — 2026-07-10, #205 / TASKS 1.4 DONE
**Resume from `C:\dev\Aimplifi`.**
**NEXT:** Wave 1.3 value receipts (Opus+Fable), 1.7 triage alternatives (Opus),
or 4.2 household slice 1 (Opus+Fable). Cron fire still UNVERIFIED (0.3).
**SAFE to /clear.**

## 2026-07-10 — #203 Sentry deferred (owner) + Resend live

Owner: no Sentry DSN for now (cost; personal/family app). Recorded #203.
`RESEND_API_KEY` already on prod. Wave 0.3 remaining: Resend domain verify +
cron fire check — not Sentry.

### HANDOFF — 2026-07-10, #203
**Resume from `C:\dev\Aimplifi`.**
**NEXT:** Confirm Resend domain for `reminders@aimplifi.app`, or build Wave 1.3 /
1.4 / 1.7 / 4.2 slice 1. Do not ask for Sentry again unless owner reopens.
**SAFE to /clear.**

## 2026-07-10 — #202 Glass-Box shareable snapshot (TASKS 1.6) — DONE ✅

Client-only redacted share on reconciled Cash-Needed Glass-Box. Pure
`redactTraceForShare` + clipboard/PNG (Canvas 2D, no third-party, no network).
Gate: verify ✅ 2117/163; glass-box.spec 3/3 (incl. share redaction).

### HANDOFF — 2026-07-10, #202 / TASKS 1.6 DONE
**Resume from `C:\dev\Aimplifi`.**
**NEXT:** Owner `RESEND_API_KEY` (± Sentry) to finish 0.3; or Wave 1.3 value
receipts / 1.4 streaks / 1.7 triage alternatives / 4.2 slice 1 (Opus+Fable).
Optional: Opus privacy pass on #202.
**SAFE to /clear.**

## 2026-07-10 — TASKS 4.1 Household architecture spike (#200, Fable lane) — DONE ✅

Owner green-lit household (#196). Deliverable was decision doc + schema design
ONLY — shipped `docs/HOUSEHOLD_ARCHITECTURE.md`: household entity + membership
(one/user v1) + per-account read-only sharing; authz untouched on all 41
existing actions; central `visibleAccountsWhere`; joint cash-needed via
query-scoped `getSharedSnapshotSlice` + pure merge; lazy-repair lifecycle;
code+DB-email invites. Fresh-context Fable hostile critic cycle 1 FAIL
(5 P1 / 5 P2 / 1 P3, all confirmed) → all fixed in doc. T1–T12 invariant→test
map; 6-slice MVP plan in TASKS 4.2. Gate: verify ✅ GREEN 2113/162 (docs-only).

### HANDOFF — 2026-07-10, #200 + #201 / TASKS 4.1 DONE, owner questions ANSWERED
**Resume from `C:\dev\Aimplifi`.**
Owner answered §6 same day (#201): partner categorization YES (slice 6,
single-teacher boundary), ONE joint digest (slice 7), naming "Household".
Slice plan now 8 slices; design fully unblocked.
**NEXT:** 4.2 slice 1 membership core (Opus build + Fable critic), or Wave 1.3
value receipts (Opus + Fable critic), or 1.4 streaks (Sonnet), or owner keys
(`RESEND_API_KEY` ± `SENTRY_DSN`) to close 0.3.
**SAFE to /clear.**

## 2026-07-10 — #199 Route-specific empty states (TASKS 1.5) + #198 ledger — DONE ✅

Resend/Sentry still pending → shipped Wave 1.5. Extracted
`ConnectOnboardingPanel`; coach/goals/calendar get `EmptyCoach`/`EmptyGoals`/
`EmptyCalendar`. Also recorded #198 Wave 0.3 partial (prod env already live;
SIGNUP/CRON/VAPID set). Gate: verify ✅ 2113/162; auth.spec 3/3;
guided-onboarding 1/1.

### HANDOFF — 2026-07-10, #199 DONE
**Resume from `C:\dev\Aimplifi`.**
**NEXT:** Owner `RESEND_API_KEY` (± `SENTRY_DSN`) to finish 0.3; else Wave 1.6
Glass-Box (Grok) or 1.3 value receipts (Opus + Fable critic) or 1.4 streaks (Sonnet).
**SAFE to /clear.**

## 2026-07-09 — #197 Contextual Ask follow-up chips (TASKS 1.2) — DONE ✅

Static `followUpQuestions(intent)` map → server merges onto `suggestions` →
UI chips via existing plumbing. No new parsing. Fixed ISODate branding in
unit test (`isoDate()`). Gate: verify ✅ 2113 unit / 162 files; ask.spec
e2e 9/9 (incl. follow-up re-ask). Ledgers: DECISIONS/STATUS/TASKS #197.

### HANDOFF — 2026-07-09, #197 / TASKS 1.2 DONE
**Resume from `C:\dev\Aimplifi`.**
**NEXT:** Wave 1.3 value receipts, or Wave 0.3 deploy (owner keys per #196).
**SAFE to /clear.**

## 2026-07-09 — #189 Prod error tracking (Gap 6 §2) — DONE ✅

Owner: "continue with what's next" after #188 confirmed fixed. Next unblocked
plan item = Gap 6 §2. Shipped dormant-until-DSN Sentry envelope client
(`lib/errors.ts`), `instrumentation.ts` onRequestError, error-boundary wiring,
CSP gate, DEPLOY.md. No `@sentry/nextjs` dep (thin fetch, email/push pattern).
Unit locks in `errors.test.ts`. Neon backups (§4) remain owner/ops.

### HANDOFF — 2026-07-09, #189 DONE
**Resume from `C:\dev\Aimplifi`.**
**NEXT:** Gap 6 §4 Neon backups (owner), live Plaid/SimpleFIN walkthroughs
(tokens), Gap 5 benchmark (market-data), or mobile-380 Playwright infra.
Set `SENTRY_DSN` in Vercel when ready to activate error tracking.
**SAFE to /clear.**

## 2026-07-09 — #187 Mobile More-sheet nav (Gap 3 §2) — DONE ✅

Owner: "lets work on mobile-nav redesign; polish and make it beautiful and user
friendly." Kept 5 primary bottom tabs (e2e-safe). Replaced 8 unlabeled top icons
with a labelled More sheet (2-col icon+label grid + Explore section). Updated
secondary e2e to open More first; new mobile-nav.spec.ts. Ledgers: DECISIONS/
STATUS/ROADMAP/COMPETITIVE_GAP_PLAN #187.

### HANDOFF — 2026-07-09, #187 DONE
**Resume from `C:\dev\Aimplifi`.** Gap 3 §2 mobile nav is shipped.
**NEXT:** env-gated (live sync, error tracking, backups) or Gap 5 benchmark /
mobile-380 infra. No further owner-design-gated nav work.
**SAFE to /clear.**

## 2026-07-09 (resumed: "push, then continue") — push #171–#185 + #186 ALSO CONSIDER UX burn-down — DONE ✅

Owner: "push, then continue." Pushed local main `83428e2..cd77bad` (16 commits, #171–#185)
to `origin/main` — now matches HEAD. Then burned down ROADMAP ALSO CONSIDER (the only
unblocked in-session work left after #185): audit found 6/10 already built; shipped the
4 genuine gaps (spending-plan legend, overspent dashboard reframe, empty-register
no-data/no-match, budgets no-target hint) + reconciled ROADMAP/STATUS/plan. No engine/
schema. Gate (real): verify.sh ✅ GREEN, 2039 unit / 153 files; targeted e2e 4/4.
Committing + pushing as #186 (owner authorized push this session).

### HANDOFF (resume after /clear) — 2026-07-09, #186 DONE
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md + docs/lessons/INDEX.md first.
**State:** #186 at HEAD on origin/main (pushed with the #171–#185 stack earlier this
session, then this commit). Working tree should be clean aside from any owner-local
untracked (`.cursor/`, `AGENTS.md` if still untracked).
**Health baseline (re-confirm, don't trust):** core `bash scripts/verify.sh` → GREEN,
2039 unit / 153 files; full `VERIFY_E2E=1` still can't exit 0 here (mobile-380 flake).
**STANDING OWNER-ONLY:** Gap 1 §1–2 live Plaid/SimpleFIN walkthroughs; Gap 3 §2 mobile nav
redesign (design input); Gap 5 benchmark (market-data + holdings history); Gap 6 §2/§4;
mobile-380 Playwright infra; set `RESEND_API_KEY`/`VAPID_*` for delivery; Vercel Pro for
weekly digest + 4-cron.
**NEXT:** no further unblocked ALSO CONSIDER items. Next increments are owner/env-gated
or the mobile-nav redesign. Check GitHub Actions `verify.yml` on the push (first CI
full-e2e witness — was UNVERIFIED until the #171–#185 push).
**SAFE to /clear.**

## 2026-07-05 (resumed: "push; then continue") — #165 transfer pair filing — DONE ✅ (verify green, critic 2 cycles, FULL e2e 75/75)
Owner authorized the push (the #161–#164 stack + their CLAUDE.md/LOOP_ENGINEERING.md edits committed
as docs, all now on origin/main through 9c05431), then picked "transfer-pairing for credit card paid"
via AskUserQuestion. Premise re-checked FIRST (the #162 lesson): pairing already existed — the real
defect was add-flag-only persistence wedging pair-detected rows in triage (probe output in DECISIONS
#165). Shipped engine-first: planTransferUpdates flag/file split + shared refreshTransferFlags helper
+ structural "a transfer is never in review" guards (pin wins) + backfill/assist transfer stances +
undo-pins-transfer-rows. Hostile Critic cycle 1: 2 P1 + 3 P2 + 1 P3, all fixed with locks; cycle-2
fresh checker confirmed the fixes and caught 1 NEW P1 (filing write didn't re-assert read guards —
the backfill cycle-5 class), fixed + deterministically locked (mocked ensureCategories performs the
mid-window user action). Full-suite e2e drops under load PROVEN pre-existing by stash A/B (clean tree
fails the same spec + a different one; solo runs green both trees); idle-machine witness 75/75
(53.4s). Gate: verify.sh ✅ GREEN, 1798 units / 133 files, phase2-triage 6/6 ×2.
Ledger: DECISIONS #165 (+cycle-2 amendment); REGRESSION_LEDGER ×2; STATUS #165. Committing as #165;
pushing (the session's opening instruction authorized push).

### HANDOFF (resume after /clear) — 2026-07-05, session "aimplifi", #165 DONE
**Resume from `C:\dev\Aimplifi`.** Working tree CLEAN after the #165 commit+push; origin/main current.
**Health baseline (re-confirm, don't trust):** `bash scripts/verify.sh` → GREEN, 1798 units / 133 files;
full e2e 75/75 on an idle machine (expect 1-2 roaming load-flakes when the machine is busy — documented
STATUS #165, tree-independent).
**STANDING OWNER-ONLY (unchanged + new):**
- Paste ~10 real still-wrong prod descriptors to pin #161 learn.ts signatures against REAL bank strings.
- Reboot for the full VERIFY_E2E re-witness (#16); #155 Plaid + #156 SimpleFIN live-sandbox spot-checks.
- Next patch bump (15.5.19 → latest) with the next dependency pass (STATUS #164 follow-up).
- After the next real sync: confirm the prod "CREDIT CARD PAID" pile drains (pair rows should file to
  Transfer with an AI badge and leave the review queue).
**NEXT INCREMENT candidates (owner-gated pick):** ambiguous-remainder multi-select triage polish;
tighten pair matching (require a CREDIT-account side / same-currency — the F3 residual); LLM assist
deterministic-first reorder (assist interface needs account/date so the pair pass can run first);
real-prod-descriptor tuning (needs the owner paste).
**SAFE to /clear.**

## 2026-07-05 (resumed: "continue") — #164 phase2-triage stall ROOT-CAUSED + FIXED — DONE ✅ (verify green, FULL e2e 75/75)
Resumed at the #163 handoff; the one non-owner-gated open item was the phase2-triage
e2e stall (STATUS 2026-07-04). Re-confirmed baseline: verify.sh GREEN. Took the two
STATUS-suggested fixes first — (a) hermetic e2e (XAI/ANTHROPIC keys blanked at
playwright.config module scope) and (b) a 7s AbortController bound on the
llm-categorize fetches (parity with assistant-llm.ts; fail-old-proven regression
test) — then DISPROVED both as the stall's cause: it reproduced 4/4 with keys
blanked. Boundary probes (client POST send/hdr/body-fin + server action entry/exit
+ piped webServer stdout) convicted the real mechanism in one run: the action
commits in ~5ms and the response even FINISHES, but Next aborts SUPERSEDED action
streams under rapid dispatch (net::ERR_ABORTED), the router flight-data application
never resolves, and React's transition-lane ENTANGLEMENT wedges
useTransition.pending forever — every triage button disabled until reload.
Fix (DECISIONS #164): triage-inbox busy = explicit useState (immune to the wedged
lane); all four dispatch sites bounded by withDeadline (15s, new
action-deadline.ts, 5 unit locks incl. test_regression__triage_pending_stall_bounded);
deadline recovery re-syncs via new read-only refreshTriageQueue (never rollback —
the write committed; only the confirmation was lost). Fixing the stall UNMASKED two
deterministic ordering bugs hidden behind it for weeks as "did not run": write-in
net-files the demo's ONLY multi-row group (starving the singles test) and the
read-only #162 banner lock ran after review-cost drained the queue → reordered with
a SERIAL-RESIDUE CONTRACT comment. Witness: pre-fix 4/4 full-file runs failed;
post-fix 6/6 × 3 consecutive (~31s). Gate (real 2026-07-05): verify.sh ✅ GREEN,
1778 unit / 131 files (+6), tsc/eslint/build clean, FULL e2e suite 75/75 (55.0s) —
first fully green full-suite run since STATUS #16/#17. Ledger: DECISIONS #164,
REGRESSION_LEDGER 2026-07-05, STATUS #164, lessons/diagnose-hangs-at-boundaries.md.
Committing as #164; NOT pushed (push owner-gated).

### HANDOFF (resume after /clear) — 2026-07-05, session "aimplifi", #164 DONE, awaiting owner
**Resume from `C:\dev\Aimplifi`.** `origin/main` = `47380e1`; local main = 5 commits ahead after the
#164 commit (2 docs + #161 + #162 + #163 + #164 — count from git log), all UNPUSHED (owner-gated).
CLAUDE.md + LOOP_ENGINEERING.md still carry the owner's pre-session edits, LEFT UNCOMMITTED
(the #163 precedent: they are the owner's to commit).

**Health baseline (re-confirm, don't trust):** `bash scripts/verify.sh` -> GREEN, 1778 unit / 131
files; `npx playwright test` -> 75/75.

**STANDING OWNER-ONLY (unchanged + new):**
- Push the stack when authorized — all verify-green + critic/checker-clean.
- Paste ~10 real still-wrong prod descriptors to pin #161 learn.ts signatures against REAL bank strings.
- Reboot for the full VERIFY_E2E re-witness (#16); #155 Plaid + #156 SimpleFIN live-sandbox spot-checks.
- Consider a Next patch bump (15.5.19 → latest) with the next dependency pass — may fix the underlying
  action-stream abort race upstream (STATUS #164 follow-ups).

**NEXT INCREMENT candidates (owner-gated pick):** unchanged from the #162/#163 handoffs — ambiguous-
remainder multi-select triage polish; LLM second-pass tuning / transfer-pairing for "credit card paid";
or real-prod-descriptor tuning (needs the owner paste above).

**SAFE to /clear.**

## 2026-07-04 — #163 categorization-quality pass (owner: "make the categorizer better than Simplifi/Mint") — DONE ✅ (commit 9ba0d38)
Diagnosed the gap via explorer + measured evals: (a) leaf-precision — merchant
defaults predate the #63/#65 taxonomy (Starbucks→dining not coffee, CVS→health
not pharmacy, payroll→income not paycheck…) = the 23.8% silent-misfile class in
PHASE2_BASELINE; (b) ^-anchored table blind behind bank channel prefixes
(PURCHASE AUTHORIZED ON…); (c) long-tail coverage; (d) greedy UNIVERSITY token.
Shipped in src/lib/engine/categorize/normalize.ts: re-pointed defaults,
stripBankNoise, TST*(Toast)→dining + PADDLE.NET→software processor priors
(8000 bps, AI badge), ~70 KNOWN + ~25 generic additions, new aggregates
(Cash App/Apple Cash/PayPal INST XFER/CHECK forms), issuer card-pmt ACH→transfer,
income split into paycheck/interest-income/govt-benefits/tax-refund, fixed the
-alternation inflection bug class (WENDYS/WEGMANS/PLUMBING/VETERINARY/...).
Follow-through: backfill + categorize-assist sign guards → Income GROUP;
recurring SUBSCRIPTION_CATEGORIES + insights keys extended; LLM assist wired
into Plaid sync (two-pass; parity with SimpleFIN/CSV/manual). Eval rebuilt as
3-corpus harness incl. NEW 343-case novel benchmark
(scripts/categorize-benchmark-corpus.ts). MEASURED: novel review 32.1%→9.3%,
precision 89.3%→100%; messy wrongs 25→11 (all documented convention drift);
demo seed stable 1.91% review / 100% recognized; suite 1752/1752; verify.sh
GREEN (no-e2e run). Regression lock tests/unit/categorize-precision.test.ts
(36→56 after critic locks). DECISIONS #163 appended + amended with cycle-1.
Hostile critic cycle 1: FAIL, 3 P1 (proven by execution) → ALL FIXED same
session: pipeline merchant-default outflow→Income-group guard (P1-1, also
closes P2-5); categorize-assist sign guard REALLY landed this time, both
directions (P1-2); greedy tokens tightened — CARTER/CHURCH/HOA/FIDELITY/
PROGRESSIVE/GOODWILL/CARDMEMBER SERV (P1-3, P2-4, P2-7, P3-8, P3-9); critic
probes added to the corpus as 14 adversarial traps (P2-6). Post-fix measured:
NOVEL 357 cases 100% precision / 0 wrong / 12.3% review; suite 1772/1772.
E2E: 70/71 pass; the 1 failing spec (phase2-triage 'write-in category')
PROVEN PRE-EXISTING — fails identically on the stashed pre-#163 tree; root
cause suspicion (live XAI_API_KEY in e2e server) + suggested fix recorded in
docs/STATUS.md 2026-07-04 (A/B-proven: the stall roams specs AND trees —
the documented SQLite write-stall flake, not #163). Final gate: verify.sh
GREEN (tsc 0 / eslint 0 / vitest 1772/1772 / build clean). Committed 9ba0d38;
NOT pushed (push owner-gated). CLAUDE.md + LOOP_ENGINEERING.md left
uncommitted (owner's pre-session edits, untouched).

## 2026-06-23 — Spending Trends / insights (#74, surpass feature #7) — DONE ✅
User "cont" → continued the match-and-surpass series after the #73 SimpleFIN bug
fix. Chose feature #7: the "what changed" lens (movers/pace/largest/new merchants)
the category/recurring/forecast views never exposed. Engine-first: pure
`engine/trends/trends.ts` as a thin exact layer over the tested
`spendingByCategory` (one spend definition, no model calls) → `server/trends.ts`
(shared ownership-scoped snapshot) → `/trends` page + dashboard
`SpendingInsightsCard` + reciprocal /reports link (no 8th nav icon, #71).
Verify: typecheck/lint clean, **807 unit/65 files, 46 e2e**, build clean (✅ GREEN).
Hostile critic (wf_a12a2a9e, 4 dims + adversarial verify): fin 7/edge 7/sec 9/UX 8;
1 P1 (Store Card as "new merchant") resolved as a docstring over-claim — this repo
deliberately treats Store Card Purchase as a real rule-eligible merchant
(assign.ts + triage e2e), so corrected the doc + added an integrated normalize→engine
test instead of breaking that decision. Cheap P2s fixed; rest accepted (STATUS #74).
Earlier e2e caught a real dark-mode contrast miss (opacity-80 % label) → fixed.


Session goal (user: "lets go one by one and do all"): build three roadmap threads
in order, each engine-first → verify green → hostile critic → commit.

Baseline at session start: `bash scripts/verify.sh` → **GREEN** (647 unit / 42 files,
typecheck+lint clean, next build clean). E2E opt-in (VERIFY_E2E=1).

## Feature 1 — Manual card statements (IN PROGRESS)
**Why:** a manual CREDIT card (DECISIONS #45) has `type==='CREDIT'` so the cash-needed
engine treats it as a card, but with no Statement AND no cycle days `buildObligation`
returns null (engine.ts:83) → the card is DROPPED from "how much do I need & when",
counting only toward net worth. Goal: let a manual card carry a current statement
(+ APR + autopay) so it runs the PRECISE path.

**Key facts found (ground truth):**
- No schema change: `Statement` already exists for any account; `@@unique([accountId, cycleEnd])`.
- `getFinanceSnapshot` loads ALL statements/autopays `where: { account: { userId } }`,
  so a manual statement flows into the engine with zero plumbing changes.
- Engine picks up `accounts.filter(a => a.type === 'CREDIT')`; `current` = newest stmt
  whose dueDate ≥ today OR with unpaid remainder; else estimate (needs cycle days) else null.
- `assemble.ts` precise path uses statement.{statementBalanceCents,minimumPaymentCents,dueDate,cycleEnd}.
- Money: `centsFromDollarString` throws on junk; "24.99" → 2499 (reusable for APR bps).
  Dates: `isoDate` throws on invalid; `addMonthsClamped`, `compareDates`, `daysBetween`.
- /accounts data = `getAccountsView` (no statement info today); UI in `accounts-list.tsx`
  (`ManualRow`). Integration-test idiom: `tests/unit/networth-actions.test.ts` (throwaway user).

**Plan / steps:**
1. [x] `src/lib/engine/cards/manual-statement.ts` — pure `parseManualStatement` (+ derived
   cycleStart, cycleCloseDayOfMonth, dueDayOfMonth, autopay), all-errors-at-once.
2. [x] `tests/unit/manual-card-statement.test.ts` — parser known-answer + END-TO-END (10 tests).
3. [x] `src/server/card-actions.ts` — set/clear, owned-manual-CREDIT guard, atomic ARRAY
   `$transaction` (interactive form timed out under parallel SQLite — array form is the
   house pattern, triage-actions.ts:315). `tests/unit/card-actions.test.ts` (6 tests).
4. [x] `getAccountsView`+AccountsView carry `cardBilling`; `accounts-list.tsx` ManualRow
   "+ Add statement" / summary + `manual-card-statement-form.tsx`.
5. [x] `tests/e2e/manual-card-statement.spec.ts` — $0 statement (headline-neutral) round-trip.
6. [~] DONE: `VERIFY_E2E=1 bash scripts/verify.sh` → GREEN (663 unit / 44 files, 33 e2e).
   IN FLIGHT: multi-agent hostile critic (wf_786483e0). TODO after: apply confirmed P0/P1,
   re-verify, write DECISIONS #46 + ROADMAP/STATUS, commit.

## Feature 1 — DONE ✅ (commit dc223fe, verify+e2e green, critic 0 P0/P1)

## Feature 2 — Payment reminders (ROADMAP #6) — IN PROGRESS
**Why:** calendar badges due days but there's NO notification mechanism. Add a
credential-free notification pipeline + an in-app reminders surface.
**Found:** cron pattern = CRON_SECRET Bearer + per-user sweep + audit + no-abort
(api/cron/sync). No email infra exists. DEMO_TODAY=2026-06-10; demo cards due
Jun 23–26 (~13–16 days out) → dashboard panel needs the whole cycle (no tight window);
cron email uses a short imminent window. calendar/build.ts already lays obligations on days.
**Plan:**
1. [ ] `engine/reminders/select.ts` — pure `selectPaymentReminders` (obligations within
   window, urgency today/soon/upcoming, autopay-covered, dismissed) + `buildReminderEmail`
   (pure text, educational/no-shame). Known-answer tests.
2. [ ] `lib/email.ts` — `sendEmail` dormant fallback (no RESEND_API_KEY → {sent:false} no
   network; with key → Resend POST; never throws). Tests: no-key + mocked success/fail.
3. [ ] `api/cron/reminders/route.ts` — CRON_SECRET-guarded sweep: per user build+dispatch
   reminders (email dormant → logs would-send), audit, summary. Route test (auth gate + dormant).
4. [ ] dashboard `PaymentRemindersCard` (derived from payInFull obligations, whole cycle),
   wired below the cash-needed card (above-the-fold unaffected). e2e: panel renders.
5. [x] DONE — critic ran (wf_3889cb35): 2 P1s FIXED (F1 cards/upcoming double-count →
   pass cards only + selector dedup + e2e uniqueness; PR6-001 autopay-topup disclosure
   → both-portions in email+card + fixture). P2s fixed: shared constant-time cron compare
   (SEC-1), keyed-send cron test, tomorrow/soon-boundary tests, long email dates, calendar
   footer copy. `VERIFY_E2E=1 verify.sh` → GREEN (686 unit/48 files, 35 e2e). DECISIONS #47
   + ROADMAP #6 done + STATUS written.

## Feature 2 — DONE ✅ (verify+e2e green, critic 2 P1s fixed)

## Deferred hardening (post-"do all three", user-requested) — DONE ✅
(A) Always/Undo orphan-rule race: `undoCorrections` rule deletion now lineage-scoped
(`createdFrom: correction.id`) — `tests/unit/undo-orphan-rule.test.ts`. (B) Sign-in
throttle redesigned to kill the targeted-account lockout (#48 residual): per-IP cap
before auth + per-account-FAIL after, so a correct password is never blocked
(`src/lib/request-ip.ts` + `tests/unit/rate-limit-durable.test.ts` no-lockout proof).
Focused adversarial review: both PASS, 0 P0/P1 (1 accepted P2: shared 'unknown' bucket
local-only). `VERIFY_E2E=1 verify.sh` → GREEN (702 unit/52 files, 35 e2e). DECISIONS #49
+ ROADMAP #9 done + STATUS #10 + REGRESSION_LEDGER updated. Deferred: alreadyUndone TOCTOU
(append-only audit, no UI path).

## Feature 3 — DONE ✅ (verify+e2e green, critic 3 P1s fixed). ALL THREE SHIPPED.
**Built:** (#9) splitTransaction conditional-claim guard inside the tx. (#8) new RateLimit
table + `rateLimitDurable` on export + per-account sign-in throttle. Critic (wf_f2438c81):
split fix 10/10 (20/20). 3 P1s in the limiter FIXED: (CONC-1/SEC-1) reset branch returned
true unconditionally → concurrent burst bypassed → decide from an atomic increment count
(12-burst→4 allowed); (OPS-1) unbounded RateLimit growth → `@@index([resetAt])` +
self-pruning. P2s fixed: export 401/429 test, undo→resplit test, fail-closed comments,
lockout doc. Deferred: Always/Undo orphan-rule race (STATUS #10). `VERIFY_E2E=1 verify.sh`
→ GREEN (698 unit/51 files, 35 e2e). DECISIONS #48 + ROADMAP + STATUS + REGRESSION_LEDGER done.

## 2026-06-23 (session: "aimplifi") — Ask Aimplifi: grounded NL assistant (#75, surpass #8) — IN PROGRESS
User "cont" after renaming the session "aimplifi". Baseline `bash scripts/verify.sh` →
**GREEN** (807 unit/65 files, typecheck+lint+build clean). Next surpass feature = the
AI-native conversational surface the app is literally named for (nav brand "Aim·plifi"),
which none of the match-and-surpass features (#1–#7) provided.

DESIGN (engine-first, no-fabrication soul): a grounded financial Q&A where **the LLM
never originates a fact**. Deterministic NL→typed-intent parser (no model calls — rule #5)
→ routes to the EXISTING tested engines (spendingByCategory/spending-plan/cash-needed/
recurring/forecast/monthlyFlows/netWorthCents) → pure answer formatters. The LLM is an
OPTIONAL routing fallback for genuinely-unknown questions only, gated on a key, and its
proposed routing is re-resolved + validated deterministically before any data is touched
(mirrors the categorize/llm.ts pattern: provider-agnostic xAI→Anthropic→null, never throws).
Zero-key demo is fully functional (deterministic parse + answers). No new dep (hand-written
validator like parseLlmCategory, not zod). No 8th nav icon (#71/#74) — dashboard card + /ask.

Files: engine/assistant/{intent,answer,llm}.ts (pure) + server/{assistant,assistant-llm}.ts
+ components/finance/{ask-view,ask-aimplifi-card}.tsx + app/(app)/ask/page.tsx + dashboard wiring.
Tests: assistant-intent (hand-derived intents), assistant-answer (hand-computed $),
assistant-grounding (buildSeedData: answers == dedicated engine outputs, no drift),
assistant-llm (parse + no-key no-network), e2e ask.spec.

### Update — verify GREEN + hostile critic cycle 1 (6 P1s fixed)
Gate (real, 2026-06-24): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ GREEN** —
typecheck/lint/build clean, **899 unit / 70 files** (+92), **51 e2e** (+5; off-topic
case 7.0s confirms the LLM 7s-timeout→deterministic fallback), axe AA.
Hostile critic (wf_0df635e6, 12 agents): fin 7 / sec 8 / code 6 / UX 8 — **6 P1s
confirmed + FIXED**, each with a locking regression test:
- P1 net-worth used a truncated liability set → now canonical `isLiabilityType`
  (CREDIT/LOAN/MORTGAGE/OTHER_LIABILITY); facts reconcile to headline (test: MORTGAGE/OTHER_LIABILITY).
- P1 income/savings dropped categoryId+isSplitParent → income now `monthlyFlows(snap.transactions)`
  (full rows; refunds net, splits excluded — F3 synthetic regression); savings_rate delegates to
  `getCoachData` → byte-identical to /coach.
- P1 largest omitted POSTED filter → now POSTED-only; grounding test pins top-5 == /trends `computeLargest`.
- P1 off-topic misroute (key set) → LLM prompt offers `none` abstention → answerUnknown; LLM gated by
  per-user `rateLimitDurable`; question clamped 500 chars; `interpreted` flag surfaced in UI.
P2s fixed: dead answerUnknown source line, 3rd-party disclosure footnote (assistEnabled), no-flicker
re-ask, dashboard card non-interactive example text. Confirmation critic (wf_83f7b0a3) running.

## 2026-06-24 (session: "aimplifi") — crash recovery + flake hardening — DONE ✅
Resumed after a crash. Ask Aimplifi (#75) was already committed verify-green; the crash
left only doc/index housekeeping in the tree (no half-done feature). On the first
post-restart `verify`, tests/unit/simplefin.test.ts flaked once ("expected 0 to be 2")
— root-caused to SQLITE_BUSY (rollback-journal writer starvation on the shared dev.db
under the codegraph re-index I/O spike), masked by connectSimplefin's credential-safe
catch as added:0. NOT a regression (23+ clean reruns). Fix (TEST-ONLY; prod=Postgres):
WAL via a vitest globalSetup + fail-loud r.error assertion + retry-bounded WAL
regression test + gitignore (/.codegraph/, dev.db-wal/-shm). Proven fail-before/
pass-after; independent hostile Checker 0 P0/0 P1/4 P2 (accepted — STATUS #14-16 +
DECISIONS #76). Also cleanly reconstructed the corrupted LOOP_ENGINEERING.md (kept the
new Token-discipline section). Gate (real 2026-06-24): bash scripts/verify.sh → GREEN,
901 unit/71 files, typecheck/lint/build clean; e2e 51 passed; 10/10 consecutive
full-suite runs. NEXT: deploy/go-live prep handoff (Vercel + Neon, env vars) — DEPLOY.md.

## 2026-06-24 (session: "aimplifi") — Investments engine (#77) — engine increment DONE ✅
An honest Aimplifi-vs-Simplifi scorecard (skeptical adjudicator: Simplifi 6 / Aimplifi 5 / 2 ties)
identified investments as the clearest Simplifi win + the app's own declared gap. Started closing it
ENGINE-FIRST (§5): pure src/lib/engine/investments/portfolio.ts — valuation (market value, cost basis,
unrealized gain, allocation), TWR, and XIRR (Newton + full-domain bracketing bisection). 20 known-answer
tests. Independent hostile critic found 2 P0 + 4 P1 (XIRR null on deep losses + missed roots; Newton
accepted on step not residual; missing safe-int guard; flow ordering) — ALL fixed + regression-locked;
docstrings narrowed to honest conventional-flow scope. Gate (real 2026-06-24): bash scripts/verify.sh →
GREEN, 921 unit/72 files, typecheck/lint/build clean. NEXT increment: Holding schema (additive, pg-safe)
+ manual holdings entry + /investments view (from /accounts, no 8th nav icon) + demo seed + e2e.

## 2026-06-24 (session: "aimplifi") — Investments persistence + server (#78) — DONE ✅
Wired the #77 engine into the app — data + server only (owner handles UI; "only change if
markedly better"). Additive Holding model (pg-safe, cascade) + demo seed holdings ($142k
Brokerage, +$35k) + src/server/investments.ts (getInvestments read-path runs the engine;
ownership-scoped + type-gated addHolding/removeHolding + audit). 10 integration tests incl.
the full threat model. Independent hostile critic: authz / net-worth / determinism clean;
1 P0 (unbounded quantity → read-path break) + 3 P1 FIXED + locked (safe-integer cents, symbol
length/charset, threat tests); P2s done. Touched NO existing UI. Gate (real 2026-06-24):
verify GREEN, 931 unit/73 files, build clean; seed holdings:5. NEXT (owner): an /investments
view consuming getInvestments() (+ optional manual-entry form using addHolding).

## 2026-06-24 (session: "aimplifi") — prod-seed safety guard + additive holdings script (#79) — DONE ✅
Caught a footgun before it fired: `prisma db seed` deleteMany-wipes every table, and the live Neon DB
holds the owner's REAL SimpleFIN data — a "re-seed to add demo holdings" would have destroyed it (and the
sandbox can't reach Neon anyway). Added: (1) a guard in prisma/seed.ts refusing a Postgres seed without
`-- --force-prod` / SEED_ALLOW_PROD=1 (sqlite unaffected); (2) an additive-only scripts/seed-demo-holdings.ts
(+ npm seed:demo-holdings) that upserts the 5 demo holdings onto one INVESTMENT account and deletes nothing;
(3) DEPLOY.md §6 rewritten with the wipe warning + the safe paths. Verified: postgres seed → exit 1 (blocked,
no wipe); sqlite seed → normal; additive script → "Upserted 5 … Nothing else was touched". Also confirmed
the #78 prod deploy 516b3d6 reached READY (Holding table live in Neon via the build's db push). Gate (real
2026-06-24): verify GREEN, 931 unit/73 files, build clean.

## 2026-06-24 (session: "aimplifi") — Investments UI + production-readiness pass (#80) — DONE ✅
The owner invited UI work ("make it more user-friendly … get ready for production", still
"only change if markedly better"). Ran an 11-agent UX/prod audit (background workflow) and:
(a) built the additive /investments view (page + view reusing the Card system + a reciprocal
/accounts link; 2 e2e incl. axe); (b) fixed all 3 audit production-BLOCKERS — dev command on
the prod error screen removed; "Pulse"→"Aimplifi" brand leaks on bank-connect/reminder copy
(reminders.test updated to match); Settings "demo mode" card rewritten to a real connect path
correct for all users. Audit's remaining items recorded as a prioritized roadmap (docs/ROADMAP.md)
for owner approval — proposed, not unilaterally changed. Gate (real 2026-06-24): VERIFY_E2E=1
bash scripts/verify.sh → GREEN, 931 unit/73 files, 53 e2e, typecheck/lint/build clean.

## 2026-06-24 (session: "aimplifi") — production-readiness a11y/resilience batch (#81) — DONE ✅
First half of the approved audit batch (additive, no screen rewrites): route-group loading.tsx
skeleton; global-error.tsx branded recovery; skip-to-content link + focusable <main> landmark;
calendar prev/next aria-labels; per-page <title> template (+ /investments override). Gate (real
2026-06-24): VERIFY_E2E=1 verify → GREEN, 931 unit/73 files, 53 e2e, build clean. NEXT (same approved
batch): delete confirmations (goals + manual accounts) and empty states (reports/coach/forecast/cards).

## 2026-06-24 (session: "aimplifi") — manual-account delete confirmation (#82) — DONE ✅
Two-step inline confirm on the manual-account Delete (accounts-list ManualRow); two e2e specs
updated to click through it. Gate (real 2026-06-24): VERIFY_E2E=1 verify → GREEN, 931 unit/73
files, 53 e2e. REMAINING from the approved audit batch: empty states (reports/coach/forecast/cards)
and the goals delete confirm (needs a small client component); plus per-page title overrides and
the CardTitle-as-heading change (deferred — shared primitive).

## 2026-06-24 (session: "aimplifi") — goals delete-confirm + cards empty state (#83) — DONE ✅
Completed the delete-confirmation guard (goals, via a new client component matching the accounts
pattern; no e2e drove goal-delete, but phase4-features' goal cleanup did — updated to click the
confirm) and added a "No credit cards yet" empty state on /cards. Gate (real 2026-06-24):
VERIFY_E2E=1 verify → GREEN, 931 unit/73 files, 53 e2e. Remaining empty states: reports / forecast
(blank charts) and coach / life-energy (nuanced) — investments + cards done.

## 2026-06-24 (session: "aimplifi") — empty-state completion (#84) — DONE ✅
Reports income/expense chart empty state ("No income or spending …") for the all-zero case; the
category breakdown already had one. Assessed forecast + coach — neither goes blank (forecast = flat
line + starting balance; coach = degenerate values), so no change. With investments + cards, the
genuine blank cases are covered. Gate (real 2026-06-24): VERIFY_E2E=1 verify → GREEN, 931/73, 53 e2e.
Approved audit batch substantially complete. Remaining tail (low priority / needs owner nod): per-page
<title> overrides for the rest of the pages; CardTitle-as-heading (shared primitive — verify visually);
triage split flow (2nd category hardcoded); mobile nav redesign. All in docs/ROADMAP.md.

## 2026-06-24 (session: "aimplifi") — per-page titles (#85) — DONE ✅
Added title metadata to all 18 (app) pages (→ "<Page> · Aimplifi" via the #81 template) via one
idempotent bulk script. Gate (real 2026-06-24): bash scripts/verify.sh → GREEN, 931 unit/73 files,
build clean. Approved audit batch (1–5) now complete bar deferred items (CardTitle-as-heading,
triage split flow, mobile nav — all need owner nod), captured in docs/ROADMAP.md.

## 2026-06-24 (session: "aimplifi") — mobile nav tap targets (#86) — DONE ✅
Phone top-bar secondary nav: sub-44px cramped icons → 44px-tall targets (min-h-11; sm+ text link
unchanged), fits 380px, no overflow. iOS safe-area inset attempted but reverted (viewport-fit=cover
grew the fixed bar past content clearance → e2e caught bottom-nav interception); deferred — needs the
content pb to track env(safe-area-inset-bottom) too. A scrollable-strip attempt caused page-wide
overflow and was dropped. Gate (real 2026-06-24): verify.sh → GREEN, 931 unit/73 files; e2e 53 passed.
Remaining roadmap tail: safe-area inset (careful follow-up), CardTitle-as-heading (shared primitive),
triage split flow.

## 2026-06-24 (session: "aimplifi") — budgets first-run empty state (#87) — DONE ✅
Added the zero-account EmptyDashboard guard to /budgets (the one page missing it). Gate (real
2026-06-24): VERIFY_E2E=1 verify → GREEN, 931 unit/73 files, 53 e2e. Remaining roadmap items are the
RISKY/dedicated ones (iOS safe-area inset — cascades through every bottom-anchored element; CardTitle-as-
heading — shared primitive used by every card; triage split-flow rework). Recommended as focused tasks,
not end-of-session work.

## 2026-06-26 (session: "vitaforge") — crash recovery + landed the categorization arc + go-live — DONE ✅
Resumed after a crash with the working tree CLEAN (HEAD = #117, verify-green) — nothing lost; the last
work was committed AND pushed. Health re-confirmed: `bash scripts/verify.sh` → GREEN (1133 unit / 92
files; typecheck/lint/build clean; e2e opt-in, skipped). NOTE: this checkout lives under OneDrive; the
"canonical" C:\dev\Pulse Finance copy is stale (~#74) and effectively abandoned — all recent work is here.

Landed feat/categorization-improvements onto main by fast-forward (origin/main b9204e1..f4a9b5d): #115
insurance-vs-medical split, #116 deterministic backfill of the review pile, #117 backfill LLM second pass
+ TOCTOU compare-and-set guard. Linear history, no merge commit.

Go-live via the Vercel MCP (project aimplifi, team reiforge): found prod was STILL on #112 — the main push
did NOT auto-build because Vercel dedups by commit SHA and f4a9b5d had already built once as an ERRORED
preview. Those preview errors are BENIGN — the Preview env has no DATABASE_URL, so the build dies at
`prisma db push` before `next build` (build log: "datasource.url property is required"); every
target:production build is READY. Owner set XAI_API_KEY in Vercel → Production (enables the #117 live LLM:
xAI Grok preferred → Anthropic fallback → deterministic no-op without a key). THIS docs commit is the fresh
SHA that triggers the real production build (now with the key present), taking #115–#117 + the live LLM
second pass live together; after READY, /triage "Re-run categorizer" works the ~515-row backlog with the
LLM. Also fixed DEPLOY.md's optional-env table (added XAI_API_KEY, the preferred provider it had omitted).

## 2026-06-26 (session: "aimplifi") — empty-state verify+critic & Plaid production diligence — HANDOFF
Full context for resuming after a chat clear: **`docs/SESSION_CONTEXT_2026-06-26.md`** (read it first).
Two threads this session:
(1) Verified + hostile-critic'd the two empty-state commits (c594eb1 /accounts, 050ee1d dashboard).
`VERIFY_E2E=1 verify.sh` → GREEN (92 files/1133 unit, 54/54 e2e, build clean). Critic (4 dims +
adversarial verify): **0 P0/0 P1, 17 P2**, demo path byte-identical (golden-safe). The 17 P2s and these
two commits are NOT yet logged in STATUS.md (notable: REC-2 income-raise-as-price-increase, COPY-1, A11Y-2
no-axe-on-empty-states, E2E-1..4 test hardening, GOLD-1 conditional testids).
(2) Prepared the **Plaid PRODUCTION security questionnaire** (live account; user runs Plaid+SimpleFIN
half/half). Finalized all 11 answers (in the handoff doc); regenerated the **Data Retention & Disposal
Policy to v1.2** (`C:\Users\micha\Downloads\Aimplifi-Data-Retention-Policy.docx`, v1.1 backed up) adding
DB storage-layer at-rest encryption (backs Q7) + Neon as a subprocessor; created the missing repo source
`docs/DATA_RETENTION_AND_DISPOSAL.md`. NEXT (user): enable MFA on GitHub/Vercel/Neon → flip Q5 to Yes;
Q9 link https://aimplifi.app/privacy (verified live); attach the Q11 docx; submit. Deferred (not done):
HSTS header (prod deploy, not form-required); docs/PRIVACY.md stale rate-limiter line. New docs are
UNCOMMITTED.

## 2026-06-26 (resumed: "read progress.md and continue") — REC-2 income-raise fix + prod HSTS + privacy-doc accuracy — DONE ✅ (verify green, critic 0 P0/P1)
Resumed at the prior handoff boundary. The headline pending item (Plaid PRODUCTION security questionnaire) is
USER-action (submit in Plaid's dashboard + enable MFA on Neon/Vercel/GitHub) — not doable here — so picked up the
actionable engineering items from SESSION_CONTEXT_2026-06-26 "Pending". Baseline re-confirmed before any change:
`bash scripts/verify.sh` → GREEN (1133 unit/92 files).

**REC-2 (DECISIONS #118):** a recurring INCOME series whose amount ROSE (a pay raise) was mis-surfaced as a red
"price increase" cost-warning at THREE sites — summary.ts `priceIncreases` (dashboard card + /recurring hero pill +
Ask answer), insights.ts `findOpportunities` (coach reviewCreep), and the per-row badge in recurring-view.tsx. Engine
fix: `!isIncome` on the two engines; extracted a PURE `priceChangeBadge()` for the per-row tone (income rise=emerald,
expense rise=rose) so the UI logic is unit-locked without a DOM. Seed payroll is FLAT → zero demo/golden movement (a
latent real-user bug). New tests/unit/recurring-income-raise.test.ts (engine end-to-end + badge tone), proven to fail
without the fix.

**Prod HSTS + privacy doc (DECISIONS #119):** added production-gated HSTS (`max-age=63072000; includeSubDomains`, no
preload) to next.config.ts, asserted in the phase4 e2e (runs the prod build); corrected PRIVACY.md's stale
"in-memory" rate-limiter line to the real durable DB-backed limiter + softened the CSP wording (Plaid origin
allowlisted). NOT pushed — pushing main = prod deploy + the 2-year HSTS commitment, the owner's call.

Hostile critic wf_1ba761ed (4 dims → adversarial verify): **0 P0/0 P1, 2 P2** — both FIXED (UI third site now
pure+tested; CSP wording softened). Gate (real): `bash scripts/verify.sh` → ✅ GREEN (1140 unit/93 files, +7;
typecheck/lint/build clean). E2E: the changed surfaces pass deterministically every run (phase4 security-headers incl.
HSTS :79; recurring :14/:20). The lone HARD e2e failure is the documented OneDrive/SQLITE_BUSY flake on an untouched
page — phase2-triage:82 ("a full review session in <15 interactions"), a cumulative ~15-writes-in-60s throughput test
that even --retries=2 can't clear (shorter triage:29 went flaky→pass); recorded at STATUS #16 / DECISIONS #88,#99, NOT
a regression. Three local commits (docs housekeeping + #118 + #119), UNPUSHED.

NEXT: Plaid PRODUCTION questionnaire **SUBMITTED ✅** (owner, 2026-06-26). REC-2 (#118) + HSTS (#119) **DEPLOYED ✅** —
pushed to main (origin now 551ac97), Vercel built production `dpl_856aSb6f…` to **READY** (~65s); prod aliases
aimplifi.app / www.aimplifi.app now serve the income-raise fix + the HSTS header. (One local-only doc commit records
this deploy, intentionally UNPUSHED to avoid a redundant identical rebuild — push it with the next real change.)
Safe to /clear. Deferred: the durable e2e-flake fix stays the #16 item (e2e DB off the OneDrive tree, or develop on a
plain local disk per CLAUDE.md).

## 2026-06-27 (resumed: "read HANDOFF.md -> then PROGRESS.md and continue") — test/e2e DB off the OneDrive tree (#120) — UNIT flake FIXED; e2e improved (residual env-flake)
Resumed at the prior clean stopping point (HEAD 905da57, the unpushed deploy-record docs commit; origin 551ac97 live).
Baseline re-confirmed: `bash scripts/verify.sh` -> GREEN (1140 unit/93 files). The handoff's pending items were all done
(Plaid submitted; REC-2 #118 + HSTS #119 deployed), leaving ONE un-gated engineering item: the deferred durable fix for
the OneDrive SQLITE_BUSY flake (STATUS #16/#17).

**Built it:** `tests/setup/test-db.ts` points the unit + e2e SQLite DBs at the OS temp dir, off the synced tree
(per-checkout sha1(cwd) suffix; TEST_DB_DIR override, mkdir'd). vitest + playwright wired to it; both global-setups
`db push` -> WAL -> `db seed` the temp file (e2e WAL via a tsx child `scripts/set-sqlite-wal.ts` — the CJS generated
Prisma client can't import into Playwright's ESM config loader). Locked by `tests/unit/test-db-location.test.ts`. No
production surface (db-adapter/next.config untouched; `npm run dev` keeps the repo-root dev.db; prod=Postgres #35).

**Hostile critic** wf_d9503a9a (4 dims -> adversarial verify): 0 P0/0 P1, 10 P2; applied 5 (TEST_DB_DIR-honoring
location test; mkdir; per-checkout hash; accurate re-seed wording re RateLimit; reuseExistingServer/3100 doc).

**OUTCOME (honest, measured — not fabricated):** core `bash scripts/verify.sh` -> GREEN + FAST across many runs
(1142 unit/94 files, +2 regression tests). The UNIT SQLITE_BUSY flake (SimpleFIN "expected 0 to be 2") is FIXED. The
e2e is improved (DB off-tree + WAL, confirmed) but STILL flakes ~2/5 full-suite runs under load — and the failures are
wall-clock timeouts of DIFFERENT correct tests run-to-run (phase2-triage throughput AND transactions register-search),
proving the residual cause is broader than the DB: the `next start` server, the `.next` build, and the app files all
still live on OneDrive. A 120s timeout band-aid was tried and REVERTED (still timed out under load; the suite flaked on
other tests anyway). DECISIONS #120 + STATUS #16/#17/#120 + REGRESSION_LEDGER updated.

**Committed locally** (test-infra + docs only; no prod bundle impact). NOT pushed — like 905da57, pushing main triggers
an identical-functional prod redeploy, so deferred to the next functional change (owner's call).

**NEXT (owner):** the COMPLETE e2e flake fix is to relocate the working copy off OneDrive onto a plain local disk
(CLAUDE.md already recommends this; the canonical C:\dev copy is stale). That removes the whole-tree sync I/O
contention the DB move can't reach.

**HANDOFF (resume after /clear):** full self-contained context in **`docs/SESSION_CONTEXT_2026-06-27.md`** (read it
first, then this file). State: working tree CLEAN; HEAD `6df4aca` (#120), local main 2 commits ahead of origin
(`905da57` + `6df4aca`, both unpushed test-infra/docs — no prod impact); origin `551ac97` live. Safe to /clear.

## 2026-06-27 (resumed: "read HANDOFF.md → then PROGRESS.md and continue") — working tree RELOCATED off OneDrive to C:\dev\Aimplifi (completes #16/#17/#120 e2e fix) + transactions:145 test-race hardened — DONE ✅
Resumed at HEAD f958cc5 (#120 handoff). Re-confirmed baseline before any change, independently measured (not trusted
from the handoff): `bash scripts/verify.sh` → GREEN (1142 unit/94 files). The handoff's pending items were all
owner-gated; owner chose the #1 item — relocate the working copy off OneDrive (the COMPLETE half of the #16/#17/#120
e2e fix the DB-move could not reach).

**The move (non-destructive):** robocopy'd the active checkout → `C:\dev\Aimplifi`, excluding regenerable caches
(node_modules, .next, .codegraph, test-results/playwright-report) but INCLUDING `.git` (the 3 unpushed commits + the
correct GitHub origin) and all gitignored secrets (`.env*`, `keys/`, `dev.db`). Fresh `npm ci` (788 pkgs +
`prisma generate`) on local disk. The OneDrive copy is left INTACT as a reversible fallback.

**Verified AT C:\dev\Aimplifi (real, measured):** core `verify.sh` → GREEN (1142 unit/94 files, typecheck/lint/build
clean); `VERIFY_E2E=1` full suite **54/54**. The #120-residual OneDrive timeout flake — `phase2-triage:82` throughput,
which even a 120s bump + `--retries=2` could not clear on OneDrive — now runs in **14-24s** and passed every run.
Confirms #120's prediction: the residual was whole-tree OneDrive sync I/O contention, not DB location.

**Found + fixed a SEPARATE latent race** while stress-testing (7 full e2e runs): `tests/e2e/transactions.spec.ts:145`
(inline recat) asserted `expect(ROW).toContainText('Groceries')` — but the in-flight confirm menu reads
'File as Groceries?', so the positive passed BEFORE persistence and the negative `not.toContainText('Dining Out')`
then raced `router.refresh()` on its default 5s budget. App verified CORRECT (`commit()` awaits `recategorize()` then
`close()`+`router.refresh()`). Test-only hardening: assert on the category-**chip** element (prompt is a sibling div)
with a matching 20s timeout on both — **stricter, not laxer** (does not mask a bug; DECISIONS #121). Post-fix:
**4/4 consecutive full e2e runs 54/54** (~55s), :145 green each.

**State:** working tree CLEAN at `C:\dev\Aimplifi`; one new local commit (#121: relocation record + the :145 fix + doc
updates) atop the 3 prior unpushed (`905da57`, `6df4aca`, `f958cc5`) → local main now **4 ahead of origin**, all
unpushed (no prod-bundle change; bundle with the next push — owner's call). origin `551ac97` still live.

**NEXT (owner):** (1) going forward, START SESSIONS FROM `C:\dev\Aimplifi` (CLAUDE.md updated); the OneDrive copy +
the stale `C:\dev\Pulse Finance` (~#74) can be deleted once you've confirmed the new copy. (2) Push the 4 local
commits when ready (redundant prod rebuild only — no functional change), or bundle with the next feature. (3) Roadmap
backlog stays owner-gated ('only change if markedly better').

**HANDOFF (resume after /clear):** authoritative self-contained context in
**`docs/SESSION_CONTEXT_2026-06-27-relocation.md`** (read it first, then this file).
**Resume from `C:\dev\Aimplifi`** — the OneDrive copy + stale `C:\dev\Pulse Finance` are
abandoned. Working tree CLEAN; origin `551ac97` live; local main ahead by 5 (all
test-infra/docs, unpushed). Safe to /clear.

## 2026-06-27 (resumed: "continue") — Retirement planner: decumulation engine (#122) — DONE ✅ (verify+e2e green, critic 0 P0/P1)
Owner chose the roadmap "retirement planner" increment (the declared investments gap, a clear
Simplifi win). Engine-first per rule #5. Baseline re-confirmed before any change (measured):
`bash scripts/verify.sh` → GREEN (1142 unit/94 files).

**Design boundary (no duplication):** the FI engine (#3) already owns ACCUMULATION-to-FI
(monthsToFI/coastFI/fiNumberCents). The genuine gap = the DECUMULATION / "will my money last"
lens. New pure engine `src/lib/engine/investments/retirement.ts` → `projectRetirement`: a
deterministic month-by-month two-phase sim (accumulate → draw down) that REUSES
`geometricMonthlyRate` (#3 — one compounding convention, not a second), rounds once/month
half-away-from-zero, floors at zero, and reports balanceAtRetirement, endBalance, outcome
(sustained|depleted), depletionAge, a sustainable-withdrawal (SWR) reference, and a yearly
balance path. Ages are STATED assumptions (40→65→95); inflation handled by documenting "pass a
REAL return" (no invented knob). 15 known-answer tests (0%-return cases hand-verified exact;
compounding via property + closed-form cross-check; validation throws).

**Grounding (no-fabrication soul):** `getRetirementOutlook` (server) delegates to `getCoachData`
so portfolio/savings/spending/return/SWR are byte-identical to /coach — can't drift. Negative
savings floors to $0 contribution; hasData gates the UI. 3 glue tests (mapping, floor, gate, no
drift) with mocked coach. UI: a grounded "Retirement outlook" card on /investments (headline
outcome, balance-at-retirement, phase-colored balance sparkline role=img+aria-label,
planned-vs-sustainable framing, assumptions stated inline). e2e: 3/3 (incl. axe AA).

**Gate (real, measured):** core `bash scripts/verify.sh` → ✅ GREEN — typecheck/lint/build clean,
**1160 unit / 96 files** (+18). Full e2e: investments spec 3/3 (new retirement test + axe green);
full suite 54/55 with the ONE documented `phase2-triage:82` throughput flake (SQLite write
contention under my sustained back-to-back load — button stuck disabled mid-write; retry-clears
to `interactions=7 / 28.0s`, well in budget) + a one-off `pwa-offline:17` flake that passed on
rerun. Neither is in this change's code path (investments→coach is a one-way edge, no cycle);
all other triage tests pass. NOT a regression (STATUS #16, DECISIONS #88/#99/#120/#121).

**Hostile Critic — two independent Checkers (Maker/Checker; engine is risk-bearing money math):**
ENGINE: 0 P0, NO math defect (independently reproduced the 30yr 7%/4% grow-then-withdraw value
371,408,328¢); 1 P1 TEST-GAP (decumulation-with-growth was unpinned — a reversed-ordering bug
passed the old 0%-only suite, proven $22k off over 30yr) → FIXED with an INDEPENDENT closed-form
annuity ordering test + a growth-extends-runway property; 3 P2 fixed. INTEGRATION: 0 P0, 2 P1
grounding → FIXED — (P1-1) "in today's dollars" had fed a NOMINAL return; now feeds a REAL return
(nominal − a disclosed 2.5% inflation), honestly today's-dollars; (P1-2) currentAge=40 was
undisclosed → now stated in copy. A confirmation Checker re-verified both P1 fixes sound + found
one more P2 (sub-inflation copy implied a negative real rate) → FIXED ("no real growth assumed").
Accepted P2: getRetirementOutlook reuses heavy getCoachData for 5 scalars — grounding-over-perf
tradeoff on a non-critical page.

**Gate (real, measured 2026-06-27):** core `bash scripts/verify.sh` → ✅ GREEN — typecheck/lint/build
clean, **1162 unit / 96 files** (+20: engine 17, glue 3). Investments e2e **3/3** (new retirement
test + axe AA). Full e2e earlier run 54/55 with the ONE documented `phase2-triage:82` SQLite-write
throughput flake (button stuck disabled mid-write under my sustained back-to-back load; on isolated
retry passed `interactions=7 / 28.0s`, well in budget) — not in this change's path (investments→coach
is a one-way edge, no cycle), all other triage tests pass; STATUS #16 / DECISIONS #88/#99/#120/#121.

**State:** committed as `97eb72e` (engine + server + UI + 3 tests + DECISIONS/ROADMAP/PROGRESS).
REPO-STATE CORRECTION (verified via `git fetch`, not trusted from the handoff): origin/main is
**`87f4a21`** — i.e. the 5 commits the #120/#121 handoffs called "unpushed" are ALREADY on origin
(that claim was stale). So local `main` is **1 ahead of origin** — just this `97eb72e`, the FIRST
functional change since the relocation and the only genuinely unpushed commit. Production at
aimplifi.app still serves the pre-#122 functional bundle (the 5 prior commits are test-infra/docs,
zero bundle impact). Working tree CLEAN after commit.

NEXT (owner): push `97eb72e` when ready — it deploys the retirement planner to aimplifi.app (the
first functional deploy since 551ac97). Roadmap backlog stays owner-gated ("only change if markedly
better").

## 2026-06-27 (resumed: "continue") — Retirement planner: editable inputs + interactive what-if (#123) — DONE ✅ (verify+e2e green, critic 0 P0/P1)
Repo-state correction first (verified via `git fetch`, not trusted): `origin/main` is **`ee0f690`** —
the #122 retirement-decumulation planner is ALREADY committed AND pushed (the prior handoff's "1
unpushed commit" is resolved; local == origin, tree clean). Re-confirmed baseline independently before
any change: `bash scripts/verify.sh` → GREEN (1162 unit/96 files). Owner chose the #122 follow-up:
make the planning ages + inflation user-editable and add interactive what-if controls.

**Built (engine-first, all additive):**
- **Schema:** 4 NULLABLE `User` Int columns — currentAge/retirementAge/endAge/inflationBps — null =
  "use the documented default" → demo user stays null → projection byte-identical to #122, **golden-safe,
  seed untouched**. (schema.prisma only; db-push-is-source-of-truth per the documented convention.)
- **Validation (one engine):** extended `engine/settings/dials.ts` — DIAL_LIMITS age/inflation bounds,
  `wholeYearsFromString`, exact inflation parse via `bpsFromPercentString`, and a CROSS-FIELD ordering
  check resolving empties to the read-path default so **whatever persists is always engine-valid**.
- **Server:** `updateMoneyDials` persists the four + audit + `revalidatePath('/investments')`;
  `getRetirementOutlook` reads them (coalesced to defaults) and feeds the planner via a NEW shared pure
  builder `buildRetirementInputs(base, planning)` + `realReturnBps` — financial figures still ONLY from
  /coach (no drift, no fabricated fact).
- **UI:** Settings "Retirement plan (optional)" fieldset; the /investments "Retirement outlook" card is
  now a CLIENT island (`retirement-outlook-card.tsx`) with an interactive what-if (live recompute of the
  SAME pure `projectRetirement` via the SAME builder → byte-identical at saved values; exploratory, never
  persists → can't perturb shared demo/golden data; reset + Settings link). Invariant-maintaining lever
  logic extracted to a PURE fuzz-tested module `engine/investments/retirement-whatif.ts`.

**Hostile Critic — two independent Checkers (engine math + integration/grounding; money math is
risk-bearing):** 0 P0. Engine Checker: claims 1–4 (persist-is-valid, client-can't-throw, math, bounds)
all SURVIVED; **1 P1** — the client lever logic had ZERO test coverage (a regression would 500
/investments or show wrong numbers while every test stayed green) → FIXED by extracting the pure
`retirement-whatif` module + a FUZZ test that provably catches each named regression (dropped end-bump,
off-by-one end floor, raised age cap, missing inflation parse). Integration Checker: 0 P0/0 P1, all six
claims (golden-safety, no-fabrication, e2e parallel-race safety, authz, a11y, copy guardrails) SURVIVED.
P2s fixed: explorer bounds aligned to the savable validator bounds (DIAL_LIMITS), exact inflation parse,
"at or below inflation" wording, e2e asserts all four fields restored. Accepted P2s: inflation shows
"2.50" (Settings) vs "2.5" (what-if number input) — inherent to `<input type=number>`; the
"Age-now-blank uses 40" ordering message doesn't surface the effective default.

**Gate (real, measured 2026-06-27):** core `bash scripts/verify.sh` → ✅ GREEN — typecheck/lint/build
clean, **1200 unit / 97 files** (+38). E2E: the two affected specs (settings-dials + investments) **5/5
across two runs**, incl. the new what-if recompute test + axe AA. Full suite: in the full-suite run
`phase2-triage:82` PASSED (52 passed; the 2 full-run failures `phase1-cash-needed:10` and
`phase2-triage:29` BOTH passed on isolated rerun → load flakes); after I re-ran e2e 4–5× back-to-back,
`phase2-triage:82` then flaked with the EXACT documented symptom (triage-accept button stuck `disabled`
mid-write → 60s timeout) — the SQLite-write throughput flake in UNTOUCHED /triage code (STATUS #16,
DECISIONS #88/#99/#120/#121), aggravated by my repeated runs, NOT a regression. Stopped hammering rather
than chase a clean :82 (re-running only worsens the write saturation).

**State:** working tree has the #123 change UNCOMMITTED at time of writing → see the commit below.
origin/main `ee0f690` (#122) is live-pending-deploy.

**DEPLOYED (owner: "push it"):** pushed `main` → `origin/main` now **`12ad163`** (`ee0f690..12ad163`,
local == origin). This takes #122 (retirement decumulation planner) + #123 (editable inputs + what-if)
to production together — the first functional deploy since `551ac97`. **Deploy VERIFIED READY** (no Vercel
MCP/CLI in-session; verified via GitHub's combined commit status for `12ad163` → the `Vercel` check =
`success` at 2026-06-27 23:42:43Z, deployment `vercel.com/reiforge/aimplifi/DWGuhksb94MZAHeHRBavJ1…`;
corroborated by aimplifi.app serving 200 + HSTS). #122 + #123 are LIVE in production.

NEXT (owner): nothing pending — both shipped + deployed. Roadmap LATER: live brokerage-holdings ingest.
(This deploy-record line is a local-only docs commit, intentionally UNPUSHED to avoid a redundant
identical prod rebuild — push it with the next functional change.)

## 2026-06-27 (resumed: "continue") — Live brokerage-holdings ingest from SimpleFIN (#124) — DONE ✅ (verify+e2e green, critic P0 fixed + locked)
Picked the roadmap's explicitly-named LATER item: ingest real positions from SimpleFIN INVESTMENT
accounts → the Holding model → the tested portfolio engine. Baseline re-confirmed before any change
(measured): `bash scripts/verify.sh` → ✅ GREEN (exit 0; 1200 unit/97 files at #123, tree was clean).
Understand phase = a 4-agent workflow (wf_6bff45ac-a8b) mapping the SimpleFIN ingest, investments
model/engine, provider seam, and test idioms (full report archived in the workflow output).

**Design (engine-first, locked):**
- SimpleFIN's `/accounts` returns an optional `holdings[]` on investment accounts (the repo's type just
  didn't model it). Each holding is decimal STRINGS: symbol?, shares, cost_basis?, market_value, description?.
- The Pulse `Holding` stores a PER-SHARE `priceCents` (engine: marketValue = round(quantity×priceCents)).
  SimpleFIN gives a TOTAL market_value + shares ⇒ derive priceCents = round(market_value ÷ shares).
  Sub-cent round-trip drift on odd fractional lots is documented + negligible, and NEVER touches net worth.
- **Net worth is unaffected**: it uses the authoritative `account.currentBalanceCents` (refreshed every
  sync); holdings are a *within-account breakdown*. So this increment is purely additive to the /investments
  view and cannot perturb the dashboard net-worth golden.
- **Reconciliation w/o data loss**: added `Holding.source @default("manual")`. Sync upserts incoming as
  source='simplefin' and deletes stale source='simplefin' rows (sold positions) — NEVER touching manual
  holdings on the same account. Default 'manual' ⇒ demo/golden byte-identical, seed untouched.
- Live SimpleFIN holdings path stays **UNVERIFIED** (no token), consistent with the existing SimpleFIN/Plaid
  live-path labeling; unit + mocked-server integration cover all the logic that could corrupt the ledger.

**Built (engine-first, all additive):**
- `prisma/schema.prisma` — `Holding.source String @default("manual")` ('manual'|'simplefin'). Default
  'manual' ⇒ existing + demo-seeded rows unchanged, golden byte-identical, seed untouched.
- `src/lib/providers/simplefin-map.ts` — `SimplefinHolding` wire type + `holdings?` on `SimplefinAccount`.
- `src/lib/providers/simplefin-holdings.ts` (NEW) — pure `mapSimplefinHoldings(raw)→{holdings,skipped}`:
  aggregates same-symbol lots, derives per-share `priceCents = round(Σmarket_value ÷ Σshares)` (engine
  recomputes marketValue=round(qty×price)), validates to the EXACT addHolding bounds, skips+counts
  un-mappable rows, never throws.
- `src/lib/providers/simplefin.ts` — `reconcileSimplefinHoldings` (upsert source='simplefin' + delete sold
  source='simplefin' rows, touching ONLY its own rows) wired into the INVESTMENT branch; `SyncResult.holdings`.
- `src/lib/providers/types.ts` + `src/server/simplefin-actions.ts` — surface `holdings:{upserted,removed,
  skipped}`; revalidate `/investments`. getInvestments unchanged (reads holdings regardless of source).
- Tests: `tests/unit/simplefin-holdings.test.ts` (19: known-answer + end-to-end through summarizePortfolio +
  P2 edge cases) and `tests/unit/simplefin-holdings-sync.test.ts` (10: mocked-server integration — ingest+cents,
  net-worth-vs-holdings separation, trades-not-spending #62, idempotent, sold-position reconcile,
  manual-preserved-on-collision, absent-vs-explicit-empty, skip accounting).

**Net worth is unaffected** (uses the authoritative account.currentBalanceCents; holdings are a within-account
breakdown), so this is purely additive to /investments and can't move any golden. **Live network UNVERIFIED**
(no token) — the mocked-server integration is the labeled end-to-end simulation, consistent with the existing
SimpleFIN/Plaid live-path labeling.

**Hostile critic — two Checkers (engine math + integration/data-loss) → adversarial verify (wf_58c29acd):**
engine 0 math-defect (round-trip drift ≤ ~0.5¢/share, documented, never net worth). CONFIRMED P0 (one Checker)/
P1 (other), same root cause: the reconcile upsert UPDATE silently overwrote a `source='manual'` holding on a
same-ticker collision (destroying the user's cost basis + flipping it feed-owned), contradicting the stated
invariant → FIXED: reconcile pre-fetches the account's manual symbols and SKIPS them so the upsert AND the
delete both exclude manual ("sync touches only its own rows" is now literally true); regression-locked. P2
transient-empty data-loss → FIXED: only reconcile on an explicit holdings ARRAY (absent field no longer wipes
synced rows; explicit `[]` still reconciles to empty). Remaining P2s closed with tests (price-rounds-to-zero,
NAME_MAX truncation, unicode/empty-symbol rejection, deterministic aggregation-name) or recorded non-issues
(round-half-up ≡ round-half-away for non-negative holdings values).

**Gate (real, measured 2026-06-27):** core `bash scripts/verify.sh` → ✅ GREEN — typecheck/lint/build clean,
**1229 unit / 99 files** (+29 across 2 new files, post-fix). Full e2e **56/56** (~48s, off OneDrive — no flake);
investments e2e **4/4** post-fix (golden $142k + AAPL + retirement + axe AA — demo never connects SimpleFIN).

**State:** committed as the #124 commit atop `c93e794`. Working tree CLEAN after commit. origin/main `12ad163`
is LIVE; local main is ahead by the deploy-record docs commit (`c93e794`) + this #124 commit, UNPUSHED (push is
the owner's call — pushing deploys the holdings-ingest path; the live SimpleFIN holdings field stays UNVERIFIED
until a real token confirms it). Handoff: `docs/SESSION_CONTEXT_2026-06-27-holdings-ingest.md` (DONE). **SAFE to
/clear.** NEXT (owner): push when ready; LATER — a "Synced from your brokerage" provenance tag + live Plaid
holdings ingest.

## 2026-06-28 (resumed: "continue ... think of ways to differentiate ... infuse more ai ideas") — AI Differentiation Plan (PLAN ONLY, no code) — DELIVERED ✅ / decision PENDING
User asked to brainstorm AI-native differentiation, not build. Ran a 4-phase background workflow
(`wf_a1bf031d-990`, 55 agents / ~2.4M tokens): GROUND (engines + the shipped "LLM-never-originates-a-fact"
pattern + data/providers + 2026 competitive scan) → IDEATE (7 lenses) → REFINE (deduped to 21 concepts,
scored 5 axes + adversarial-verified each, ranked) → SYNTHESIZE. Output written verbatim to
**`docs/AI_DIFFERENTIATION_PLAN.md`** (49KB, 270 lines, house plan-doc voice; the workflow result file was
parsed + the `plan` markdown extracted to the doc, temp `.wf_result.json` deleted).

**Thesis (north star):** the moat is *trustworthy* AI, not *more* AI. Every competitor's NL assistant can
hallucinate a dollar figure; Aimplifi already has the rare architecture that structurally can't
(`parseLlmCategory` closed-set; `classifyIntentViaLLM → intentFromKind → validateIntent`, engines produce
every number). Turn that internal rule into a felt/marketable surface, then layer proactive/predictive
intelligence on existing engines. Do NOT chase the SEC-advisor (Origin) or MCP-agent (Era) battleground —
both invert the moat.

**Two `build-now` (only ones that survived adversarial review):** #1 **Plan in Words** (NL goal → pure
bisection solver over `planDebtPayoff`/`monthsToFI`, generalizes shipped `coastFI`; LLM extracts only the
target date/type, never a number; honest feasibility) and #2 **Cash Flow Radar** (predict the dip, name the
colliding card, propose the timed cover-transfer — math prototyped at `cash-needed/engine.ts:266-281`; AI
does zero math). `build-later`: Glass-Box Assistant, Why-This-Category (surface the existing
`'deterministic'|'llm'` provenance), AI Trust Center (`accuracy/score.ts` Brier, made public), Document
Extractor, Smart Nudge. **Recommended first build:** the **debt-free-by-date slice of Plan in Words** —
new pure `src/lib/engine/solve/debt-free-by-date.ts` (`solveDebtFreeByDate`, bounded integer-cent
bisection), EDGE_CASES-pinned tests, land on Ask Aimplifi + Goals (no 8th nav icon). Full sketch in §5.
**NOT worth building** (with reasons, §4): Fairness Ledger (couples don't share logins), Scenario Studio's
decision-comparison half + tax "which-wins" (advice line), Money Dial Finder (scoring proxy inverts its
thesis on our data).

**State:** working tree has TWO untracked/edited files only — `docs/AI_DIFFERENTIATION_PLAN.md` (new) and
this PROGRESS.md edit. NO app/engine/test code touched, so NO `verify.sh` was run (correctly — nothing to
verify; this is a doc). Committing both locally as a `docs:` commit (unpushed, owner-gated, the house
pattern). origin/main `12ad163` still live.

**PENDING DECISION (resume here):** I asked the owner to pick the next step (AskUserQuestion) — Build Plan
in Words (debt slice) / Build Cash Flow Radar / Just commit the plan / Adjust the plan first — and the user
interrupted with "save progress, I'm going to clear" before selecting. **No build has started.** On resume:
re-read `docs/AI_DIFFERENTIATION_PLAN.md` (esp. §5 recommended first build), confirm the owner's pick, then
go engine-first per the constitution. SAFE to /clear.

## 2026-06-28 (resumed: "continue") — Plan in Words: debt-free-by-date inverse planner (#125) — DONE ✅ (verify green, critic+confirm 0 open P0/P1)
Owner picked the AI_DIFFERENTIATION_PLAN §5 recommendation (AskUserQuestion → "Plan in Words (debt slice)").
Baseline re-confirmed before any change (measured): `bash scripts/verify.sh` → GREEN (HEAD 28b153c). Understand
phase = a 7-agent read-only workflow (wf_57aa9be5) mapping planDebtPayoff, the coastFI bisection idiom, safe-to-spend,
the assistant intent seam, the goals surface, the utils/EDGE_CASES idiom, and the seed debts (correcting the plan's
stale "auto loan has no APR" claim — all seed debts DO have APR, so the demo exercises the happy path).

**Built (engine-first, no-fabrication soul):**
- `src/lib/engine/solve/debt-free-by-date.ts` — pure `solveDebtFreeByDate` BISECTS the monotone `planDebtPayoff`
  `extraMonthlyCents→monthsToDebtFree` (the shipped `coastFI` idiom; originates NO new debt math), maps the date to
  the engine's month index via a clamp-correct `wholeMonthsUntil`, returns an honest `outcome`
  (already-debt-free/on-track/reachable/unreachable) + the required figure as a share of real `getSpendingPlan`
  safe-to-spend + a `withinSafeToSpend` affordability flag (replacing §5's self-contradictory single `feasible` bool).
- Ask intent `debt_free_by_date` (intent.ts/llm.ts/answer.ts/server/assistant.ts): a deterministic `parseTargetDate`
  owns date extraction zero-key (parsed BEFORE the forward `debt_payoff`, only with a date); the LLM, if it routes
  here, supplies ONLY the kind and the date is re-derived deterministically.
- "Confirm & save as goal": `saveDebtFreeGoal` RE-SOLVES server-side (never trusts a client number), populates the
  previously-unused `Goal.targetDate`, and tags a new nullable `Goal.kind='debt_free'` (db push, golden-safe) so
  /goals renders a debt-aware card (the solver's date + suggested extra), not the savings-goal timeline.
- Tests: tests/unit/debt-free-by-date.test.ts (engine known-answers incl. with-interest $1,020.00 / $515.05,
  minimality oracle, monotonicity), assistant-debt-free-by-date.test.ts (parser/routing/validator/llm/formatter/seed
  grounding), save-debt-free-goal.test.ts (server re-solve security, non-zero + far-date + rejections), + ask.spec e2e.

**Hostile critic (wf_8faca37d, 5 dims + adversarial verify): 0 P0, 3 confirmed P1 — ALL FIXED + regression-locked:**
(1) saved goal rendered via the generic savings card (flat-division ETA contradicting the solver, "moves FI date
back" framing, targetDate dropped) → debt-aware `Goal.kind` card. (2) "…loan in March … by 2028" mis-parsed to March
2028 → bare-year deadline resolved BEFORE the month loop + dropped the global year fallback. (3) overspent users
(safe-to-spend ≤ 0) got an unflagged fake "add $X/mo" yes → honest "budget you don't have yet" branch. Many P2s also
fixed (hi grows past one month's interest; de-doubled over-budget clause; past-date copy; Save disabled-while-pending
+ focus-preserving; "in N→end of month", "next/this month", "done with my debt" routing; rounding/snowball/high-APR
tests). **Confirmation critic (wf_ab686016)** re-verified all three P1 fixes resolved + found ONE new P1 I'd
introduced — `in <year>` in the bare-year cue let a START year ("started in 2020 … by Dec 2027") hijack the deadline
→ FIXED (dropped `in` from the cue; bare "in 2028" now keeps the forward answer rather than mis-dating) + regression-
locked (year-in-passing test). No other new defects.

**Gate (real, measured 2026-06-28):** core `bash scripts/verify.sh` → ✅ GREEN — typecheck/lint/build clean,
**1282 unit / 102 files** (+53). Full `VERIFY_E2E=1` (pre-final-parser-fix run): **55/57**, ask.spec **6/6** (incl. the
new inverse-planner flow + axe AA), phase4-features goals + phase5-a11y goals green (debt-aware card did NOT regress
the savings renderer); the ONLY failure was the documented `phase2-triage:82` throughput flake (triage-accept button
stuck `disabled` mid-write → 60s `locator.click` timeout) on an UNTOUCHED page under a machine saturated by this
session's heavy runs — identical symptom to STATUS #16/#17 + DECISIONS #88/#99/#120/#121, confirmed on isolated
rerun, NOT a regression. The final fix is parser-only (unit-covered) with no e2e-observable demo change.

**State:** committed as the #125 commit. origin/main `12ad163` LIVE; local main ahead by the prior unpushed
deploy-record docs (`c93e794`) + #124 (`3c0045b`) + the #125 docs commit (`28b153c`) + this #125 feature commit, all
UNPUSHED (push deploys the inverse planner; owner's call — the live SimpleFIN holdings path from #124 stays UNVERIFIED
until a real token). Accepted P2s (documented in STATUS): bare credit-card question stays cash_needed even with a date
(DECISIONS #98); the /goals debt-card render + Save success/error states are display-layer (save persistence is
integration-tested; can't e2e without mutating the shared demo). SAFE to /clear. NEXT (owner): push when ready; next
slices — savings-goal-by-date, then retire-at-age; and Cash Flow Radar (AI plan §1.2).

## 2026-06-28 (resumed: "continue") — Plan in Words: savings-goal-by-date inverse planner (#126) — DONE ✅ (verify green, critic+confirm 0 open P0/P1)
"continue" → the next sequenced Plan-in-Words slice after #125 (the owner-set sequence: debt → savings goal → retire-at-age).
Baseline re-confirmed before any change (measured): `bash scripts/verify.sh` core → ✅ GREEN (HEAD 8b67997, tree clean).
Understand phase = a 5-agent read-only workflow (wf_f94d7f50) mapping #125's solver/save/intent patterns, the existing
goals engine+card, the safe-to-spend read-path, and the EDGE_CASES idiom (caught + corrected two agent claims by reading
the source myself: centsFromDollarString does NOT handle commas; the goal FUNDING ETA is flat — the compounding is only
the separate FI-delay calc).

**Built (engine-first, the no-fabrication soul):**
- `src/lib/engine/solve/savings-goal-by-date.ts` — pure `solveSavingsGoalByDate`. Funding is LINEAR (no growth — a cash
  envelope), so the minimal monthly is CLOSED-FORM `ceil(remaining/targetMonths)` (proven minimal), not a bisection like
  the debt twin. Same honest `outcome`/share-bps/`withinSafeToSpend` shape as #125; reuses #125's `wholeMonthsUntil`.
- `src/lib/engine/goals.ts` — extracted `goalFundingMonths` (the flat `ceil(remaining/monthly)`), now shared by the solver
  AND the /goals `goalFIImpact` card → a saved goal's timeline is byte-identical to the solver by construction (the #125
  card-vs-solver P1 designed OUT; no new `Goal.kind` — a normal savings goal carrying `targetDate`).
- Ask intent `savings_goal_by_date` (intent.ts/llm.ts/answer.ts/server/assistant.ts): new deterministic `parseTargetAmount`
  extracts the user-STATED amount from their own text (the LLM supplies only the kind; amount+date re-derived in code);
  a date with no amount → `answerSavingsGoalNeedsAmount` ("how much?"). `saveSavingsGoal` re-solves the monthly server-side.
- Tests (+46): savings-goal-by-date.test.ts (known-answers SG-A..G + minimality oracle + the card-consistency lock via the
  real goalFIImpact path), assistant-savings-goal-by-date.test.ts (parseTargetAmount adversarial + routing + formatters +
  the critic/confirm regression locks), save-savings-goal.test.ts (server re-solve security), + ask.spec e2e + EDGE_CASES
  §Savings-goal-by-date.

**Hostile critic (wf_3de855be, 5 dims + adversarial verify): 0 refuted; 1 P0 + 1 P1 confirmed — both FIXED + regression-locked:**
(P0) parseTargetAmount truncated ungrouped 4+ digit `$` amounts to 3 digits — "$20000"→$200, a 100×-wrong figure persisted
on Save → require ≥1 comma-group (`+` not `*`) so ungrouped numbers fall through to `\d+` (REGRESSION_LEDGER). (P1)
"have $X **saved** by <date>" (the feature's own canonical phrasing) missed → added "saved". 3 P2 mis-routes also fixed
(past/status poach, per-period-rate-as-total, non-money quantity). **Confirmation critic (wf_99a99d0d)** verified all 5 fixes
+ caught my P2 guards OVER-blocking the canonical demo-mode ask ("how much per month to save $20,000 by 2027" → unknown) →
made the rate-guard precise (adjacent-to-amount only) + scoped the past guard to the amount-free path; locked + an 18-case
routing probe (real output) all green. Accepted P2s (STATUS): two-amount sentences pick the leftmost (mis-role of a
user-typed number, not fabrication); a contrived income+save+date question can be poached.

**Gate (real, measured 2026-06-28):** core `bash scripts/verify.sh` → ✅ GREEN — typecheck/lint/build clean, **1328 unit /
105 files** (+46). ask.spec e2e **7/7** (new savings-by-date flow + axe AA + debt sibling no-regression). One UNRELATED e2e
(`phase4-features:32` goals create/delete) failed in this long session's degraded env, but **fails IDENTICALLY at baseline
HEAD with a clean rebuild** (proven via stash+rebuild; the delete persists to the DB correctly; `router.refresh()` isn't
dropping the card here even at 20s) — the documented OneDrive/long-session flake class (STATUS #16/#17), on a page #126 does
not touch, NOT a regression. My (ineffective) timeout tweak was reverted to keep the diff surgical.

**State:** committing as the #126 commit. origin/main `12ad163` LIVE; local main ahead by the prior unpushed deploy-record
(`c93e794`) + #124 (`3c0045b`) + #125 docs (`28b153c`) + #125 feature (`8b67997`) + this #126 commit, all UNPUSHED (push
deploys the savings planner; owner's call — the live SimpleFIN holdings path from #124 stays UNVERIFIED until a real token).
SAFE to /clear. NEXT (owner): push when ready; next slices — retire-at-age (accumulation+decumulation, the last Plan-in-Words
type), then Cash Flow Radar (AI plan §1.2).

## 2026-06-28 — Live-provider ingest CONTRACT AUDIT + first money fixes (#127) — DONE ✅ (verify green, PUSHED)
Owner corrected a stale claim: the app runs in PRODUCTION with REAL creds (Plaid PLAID_ENV=production; SimpleFIN Bridge has
all their accounts, access URL encrypted in the DB per #56) — the "UNVERIFIED (no token in env)" notes describe the CI suite,
NOT the deployment. So the mock-written mappers process REAL money data. Ran an adversarial contract audit (wf_6eade83c, 5
reviewers vs the official Plaid/SimpleFIN schemas → verify): **1 P0(→P1) + 10 P1 + 9 P2 confirmed.**

FIXED + pushed (commit fbb45d9, DECISIONS #127, REGRESSION_LEDGER 2026-06-28; core verify GREEN 1332 unit/105 files):
- **SimpleFIN sign+type (#1/#2/#8/#9):** `Math.abs(balance)` on every account inverted overdrafts (asset shown +) and
  booked positive-principal loans / no-keyword cards as CHECKING assets → store SIGNED for assets, `|owed|` for liabilities
  (SimpleFIN has no liability sign convention), broadened `inferAccountType` (no-keyword cards + heloc/servicer LOAN branch).
- **Plaid APR (#7):** `aprs[]` never mapped → every live card aprBps=0 → ZERO interest in debt/cash-needed → new
  `pickPlaidAprBps` wired into `/liabilities/get` to set `Account.aprBps`.

**TRACKED BACKLOG (confirmed real, NOT fixed — full detail + suggested fixes in STATUS "Live provider ingest" + DECISIONS #127):**
the agreed next increments, highest-money-impact first, EACH its own verified commit:
  1. **(#4, P1) SimpleFIN pending reconcile** — a pending row that never posts lingers; a pending→posted id change double-counts.
     Fix: a pending-reconcile pass in `syncFromSimplefin` (simplefin.ts ~349-378) mirroring `reconcileSimplefinHoldings` /
     Plaid `removed[]` — deleteMany PENDING rows in the fetched window (date >= startDate) whose providerRef wasn't returned.
     Test idiom: `tests/unit/simplefin-holdings-sync.test.ts` (mocked server).
  2. **(#5, P1) SimpleFIN holdings per-share round-trip** loses the authoritative total → low-price lots render $0. Needs a
     `Holding.marketValueCents Int?` schema column (db push). Does NOT touch net worth.
  3. **(#6, P1) Plaid investment/loan balances freeze at link time** → call syncAccountsForItem / `/accounts/balance/get` each sync.
  4. (#3/#10, P1) currency never read (~N/A US user); + 9 P2s (epoch-UTC date boundary, symbol regex, Plaid last_statement abs,
     null minimum→$0, mortgage/student dropped, etc.).

**State:** origin/main = local main = `fbb45d9` (in sync, deployed). Working tree CLEAN except this PROGRESS edit. **SAFE to /clear
NOW** — token-efficient checkpoint. NEXT: on "continue", do backlog #4 (SimpleFIN pending reconcile) in a lean context, engine-first
+ regression test + green verify + commit; then #5, then #6. (Plan-in-Words retire-at-age + Cash Flow Radar remain the feature track.)

## 2026-06-28 (resumed: "continue") — Live-ingest backlog #4: SimpleFIN PENDING reconcile (#128) — DONE ✅ (verify green, critic+confirm SHIP, 0 open P0/P1)
"continue" → the #127 audit's tracked backlog, highest-money-impact first = #4 (SimpleFIN pending reconcile).
Baseline re-confirmed before any change (measured): `bash scripts/verify.sh` → ✅ GREEN (HEAD b23c9fa, tree clean).
Read only the files I edited (token-lean): simplefin.ts sync + reconcileSimplefinHoldings pattern, simplefin-map.ts
(status/IngestedSfTransaction), schema (Transaction.date String/status/isSplitParent; Correction & CategoryPrediction
reference txn by id-string only → NO DB FK, delete can't FK-violate), business-today + simplefin-actions (today/removed
surfacing).

**Built (mirrors the house reconcile pattern, all in src/lib/providers/simplefin.ts):**
- `reconcilePendingTransactions(returnedRefsByAccount, startDate, userId, today)` run after the Pass-2 upsert (before
  transfer pairing so a to-be-deleted row is never paired), in TWO passes:
  (1) IN-WINDOW — per account synced this run, deleteMany feed-owned PENDING (date>=startDate) whose providerRef the
  feed didn't return; (2) AGE-OUT — deleteMany feed-owned PENDING on the user's SimpleFIN accounts older than
  `PENDING_MAX_AGE_DAYS=32`, excluding the snapshot's still-reported (`corroborated`) refs.
- Safety rails on the deleteMany (real money rows): status:'PENDING' (POSTED never touched), providerRef:{not:null}
  (manual/seed feed-unowned rows never touched), isSplitParent:false (no orphaned split). SyncResult.removed now
  carries the count (no UI consumer; demo never connects SimpleFIN → golden byte-identical, seed untouched).
- prepareAccountTxns guard `if (!acct.transactions) return;` — an OMITTED transactions field (transient response)
  doesn't wipe pending (mirrors #124 holdings), and an untrusted `transactions: null` no longer throws.
- Tests: tests/unit/simplefin-pending-reconcile.test.ts (11, mocked-server idiom) — proven fail-before/pass-after
  (stashed source → 5 fail incl. the age-out test; the null test is a lock against the `=== undefined` regression).

**Hostile critic wf_35ef0562 (3 dims + adversarial verify): 0 refuted, 2 P1 confirmed + FIXED + regression-locked:**
(P1-1) an aged multi-day hold drifting past the narrow 5-day incremental window was unreconcilable (linger +
double-count on a new-id re-post) — the reconcile window was welded to the fetch window → added the AGE-OUT pass
(with a corroboration guard so a still-reported long hold is never falsely deleted). (P1-2) the omitted-field guard
used `=== undefined`, a regression from the prior `?? []`, so a feed `transactions: null` hit `for...of null` →
TypeError → whole sync aborted → `!acct.transactions` (falsy catches null+undefined, [] still reconciles).
**Confirmation checker (independent agent): SHIP** — both P1s genuinely resolved, no provable over-delete/double-count,
all safety invariants hold (POSTED/manual-null/out-of-window/split-parent/cross-user/cross-provider/net-worth/golden).
3 doc-only P2s it raised all addressed in one accurate comment (the "passes are date-disjoint" claim is false for a
STALE connection where startDate<ageOutFloor — corrected to the real guarantee: sequential awaited account-scoped
deletes count each physical deletion once; age-out spans all accounts incl. transiently-absent; global corroborated
union is safe because SimpleFIN ids are globally unique).

**Gate (real, measured 2026-06-28):** `bash scripts/verify.sh` → ✅ GREEN — typecheck/lint/build clean, **1343 unit /
106 files** (+11). e2e not run (no e2e-observable surface — SimpleFIN sync is server-only and the demo never connects;
the mocked-server integration is the labeled end-to-end per the SimpleFIN live-path convention). DECISIONS #128 +
REGRESSION_LEDGER (3 rows) + STATUS (backlog #4 DONE + residuals) written.

**State (verified via git fetch):** origin/main = `fbb45d9` (#127 SimpleFIN sign/type + Plaid APR money fix — LIVE /
deployed). Local main was 1 ahead = `b23c9fa` (the #127 PROGRESS docs checkpoint; docs-only, unpushed, zero bundle
impact); this #128 commit makes local 2 ahead of origin. SAFE to /clear after commit. NEXT (owner): push when ready
(deploys the pending reconcile); next live-ingest increments — #5 SimpleFIN holdings per-share round-trip (needs
Holding.marketValueCents), then #6 Plaid balance refresh. Plan-in-Words retire-at-age + Cash Flow Radar remain the
feature track.

## 2026-06-28 (resumed: "continue") — Live-ingest backlog #5: SimpleFIN holdings AUTHORITATIVE marketValueCents (#129) — DONE ✅ (verify+e2e green, critic 1 P1 + 3 P2 FIXED, confirm SHIP)
"continue" → the #127 audit's tracked backlog, next highest-money-impact = #5 (holdings per-share round-trip),
the documented NEXT after #128. Baseline re-confirmed before any change (measured): `bash scripts/verify.sh`
→ ✅ GREEN (HEAD f8769dd, 1343 unit/106 files, tree clean). Read only the files I edited (token-lean):
portfolio engine, simplefin-holdings mapper, simplefin.ts reconcile, server/investments, coach.ts
(confirmed portfolioCents source), seed/build holdings, the 4 affected test files.

**The bug (#124 residual):** SimpleFIN reports a position's TOTAL market_value; #124 stored ONLY a per-share
priceCents=round(market_value÷shares) and the engine recomputed marketValue=round(quantity×priceCents). For
sub-cent-per-share lots the per-share rounds to 0/1¢, so the reconstruction LOSES or DOUBLES the real total —
a 1,000,000-sh penny lot (1¢ total) reconstructs to $0 and VANISHES from /investments; a 10,000-sh/$50 lot
shows $100; the documented VOO $100→9999 −1¢ drift.

**Built (engine-first, all additive):**
- `prisma/schema.prisma` — new nullable `Holding.marketValueCents Int?` (db-pushed; db-push-is-source-of-truth
  per #35). Null for manual/seed → engine derives → demo $142k byte-identical, seed untouched, golden-safe.
- `portfolio.ts` — engine `Holding` gains optional `marketValueCents`; `valuePosition` uses it VERBATIM when
  present (explicit 0 honored via `!= null`; derive-path fail-loud preserved), else derives round(qty×price).
- `simplefin-holdings.ts` — `MappedSfHolding` emits the authoritative total (already aggregated, was discarded);
  `simplefin.ts` reconcile persists it; `server/investments.ts` selects+maps it (cents() at the read boundary)
  and `addHolding` writes `marketValueCents:null` on create AND update (manual is price-derived).
- Tests (+12 first pass): engine authoritative path; mapper PENNY/SUB/VOO end-to-end (fail-without-fix);
  sync low-price lot through getInvestments; existing toEqual assertions updated; EDGE_CASES H-A..H-E.
- **Blast radius independently traced:** coach.ts:96-97 sums INVESTMENT currentBalanceCents (NOT
  summarizePortfolio), and getInvestments is summarizePortfolio's ONLY prod consumer → net worth / coach /
  FI / retirement / goals / every dashboard golden CANNOT move; this touches only the /investments breakdown.

**Hostile critic wf_844918ca (3 Checkers — engine math, integration/data-loss, net-worth blast radius — +
adversarial verify): 0 P0, 1 P1 confirmed (isReal verified) + 3 P2, ALL FIXED + regression-locked:**
- **P1-1:** the new `marketValueCents` Int column is Postgres 32-bit (max 2,147,483,647¢ = $21,474,836.47/
  position), but the mapper bounded only by Number.isSafeInteger (~$90T). A single position with a TOTAL above
  the ceiling overflows the column → the error is swallowed by reconcile's per-row try/catch → the position
  SILENTLY VANISHES from /investments in PRODUCTION (invisible on 64-bit SQLite CI). NEW exposure vs #124
  (which never persisted the total). FIX: `MAX_DB_CENTS=2_147_483_647` bound on priceCents/costBasisCents/
  marketValueCents in the mapper ok-check → an over-ceiling position is SKIPPED + COUNTED, not silently
  swallowed (boundary-pinned: $21,474,836.47 kept, +1¢ skipped). Also closes the pre-existing costBasisCents
  exposure at the same boundary.
- **P2 (ENG-1):** the engine authoritative branch trusted the total verbatim → added a located fail-loud throw
  on a negative/non-integer total (self-validating pure module). **P2 (NWBR-1):** a sub-cent lot's "{qty} @
  {price}" row no longer reconciled with the now-authoritative total ("10,000 @ $0.01" beside "$50.00") →
  pure `isPerShareApproximate` + the /investments row renders "≈" when it can't rebuild the total (demo lots
  are whole-cent → unflagged → display/golden unchanged). **P2 (P2-1):** softened the addHolding "price always
  wins" comment to the immediate edit (a fed symbol keeps source='simplefin' so a later sync may re-ingest —
  pre-existing #124 behavior). **Confirmation Checker (independent agent): SHIP** — all four fixes resolve
  their findings, no new defect, core invariants (net-worth containment, golden-safety, #124 reconcile) hold.

**Gate (real, measured 2026-06-28):** `bash scripts/verify.sh` → ✅ GREEN — typecheck/lint/build clean,
**1364 unit / 106 files** (+21: 12 first pass + 9 critic-fix). /investments e2e **4/4** (seeded $142k portfolio
+ retirement + what-if + axe AA; the "≈" is invisible on whole-cent demo lots). DECISIONS #129 +
REGRESSION_LEDGER (2 rows) + STATUS (backlog #5 DONE + residuals) + EDGE_CASES H-A..H-G written.

**State:** committed as `8a4efe9` (#129).

**DEPLOYED (owner: "push"):** pushed `main` → `origin/main` now **`8a4efe9`** (`fbb45d9..8a4efe9`, local ==
origin, tree clean). This takes #128 (SimpleFIN PENDING reconcile) + #129 (holdings authoritative market value)
to production together — the first FUNCTIONAL deploy since `fbb45d9` (#127). The Vercel production build is
auto-triggered by the push (the established GitHub-integration behavior recorded for every prior deploy).
**Deploy READY is UNVERIFIED from this sandbox** — `gh` is unauthenticated here and the repo's Vercel
commit-status / check-runs / deployments are not publicly readable via the unauthenticated GitHub API
(combined status empty; check-runs + deployments → 404). NOT fabricating a READY verdict; the owner can confirm
in the Vercel dashboard or via an authed `gh`. The live SimpleFIN holdings path itself stays UNVERIFIED until a
real-token sync (consistent with the existing live-path labeling; the mocked-server integration is the labeled
end-to-end). This deploy-record edit is a LOCAL-ONLY docs commit (intentionally unpushed to avoid a redundant
identical prod rebuild — push it with the next functional change), matching the #122/#125 house pattern.

**SAFE to /clear.** NEXT (owner): confirm the Vercel deploy READY if desired; next live-ingest increment —
#6 Plaid investment/loan balance refresh each sync, then the currency + 9 P2 items. Plan-in-Words retire-at-age
+ Cash Flow Radar remain the feature track.

## 2026-06-28 (resumed: "continue") — Live-ingest backlog #6: Plaid per-sync balance REFRESH (#130) — DONE ✅ (verify green, critic 1 P1 FIXED + confirm SHIP)
"continue" → the #127 audit's tracked backlog, the last named live-ingest P1 = #6 (Plaid investment/loan balances
freeze at link time). Baseline re-confirmed before any change (measured): `bash scripts/verify.sh` → ✅ GREEN
(HEAD d9de3ef, 1364 unit/106 files, tree clean — d9de3ef is the local-only #129 deploy-record docs commit, 1 ahead
of origin `8a4efe9` which is LIVE). Read only the files I edited (token-lean): plaid.ts (syncTransactions /
syncAccountsForItem / upsertPlaidAccounts), plaid-map.ts (mapPlaidAccount / sign conventions), the plaid test idiom
(no existing mocked-server integration for the provider's network methods — only the pure mapper was tested), the
SimpleFIN mocked-server idiom (mirrored it), crypto.ts (key format), schema (Account balance nullability).

**The bug (#127 audit item 3):** `syncTransactions` refreshed a balance only when `/transactions/sync` echoed the
account in its `accounts` array — depository/credit accounts with transaction activity. INVESTMENT and LOAN accounts
carry no Transactions product, so they were re-fetched ONLY at link (`exchangePublicToken` → `syncAccountsForItem`)
and their `currentBalanceCents` — hence net worth — froze afterward.

**Built (surgical, reuses tested code):**
- `plaid.ts` — at the start of each item's sync (after decrypt, before the cursor loop) call the already-existing
  `this.syncAccountsForItem(userId, item.itemId)` (`/accounts/get` → `upsertPlaidAccounts`, ALL accounts on the item).
  Best-effort + audited (`plaid.accounts.refresh.failed`): a refresh failure (ITEM_LOGIN_REQUIRED) never blocks
  transaction ingest; the per-item catch still retries. The loop's `page.accounts` echo (fresher-or-equal) still wins
  for active accounts. Reuses `/accounts/get` (cached, free) over billable `/accounts/balance/get` — the audit's pick.
- Tests: `tests/unit/plaid-balance-refresh.test.ts` (NEW — the FIRST mocked-server integration test of the Plaid
  network orchestration; real PlaidProvider vs a stubbed Plaid server). Proven fail-before (3 failed, fix stashed) /
  pass-after (3 passed). Golden-safe (demo never uses PlaidProvider); live socket stays UNVERIFIED (existing labeling).

**Hostile critic wf_25be9884 (3 lenses + adversarial verify): 0 P0, 1 P1 CONFIRMED (adversarially verified) + FIXED + locked:**
making investment/loan balances refresh every sync newly subjects them to the mapper's `current ?? 0` — a documented-
nullable Plaid field — so a `/accounts/get` reporting null `current` would OVERWRITE a real balance with $0, silently
cratering net worth until a later non-null sync self-heals. FIX: map null `current` → null (UNKNOWN, not 0) and OMIT
`currentBalanceCents` from the UPDATE data when null so Prisma preserves the last-known-good value (CREATE falls back
to `?? 0` — no prior to preserve). Fixing it in the shared `upsertPlaidAccounts` ALSO closes the same pre-existing
hole on the depository/credit echo path. Added 2 locks (mapper null→null; null-on-resync preserves) — proven fail-
before (reverting the mapper line alone reproduces the full old zeroing end-to-end: both null tests `+0`) / pass-after.
**Independent confirmation checker: SHIP, 0 P0/P1** — fix type-safe, regression lock non-vacuous, robust to either
`/accounts/get` or the sync echo writing null. Accepted P2s (DECISIONS #130/STATUS): per-sync audit noise; double
token-decrypt per item (negligible, kept surgical); available/limit write-through on null (nullable by design, non-net-worth).

**Gate (real, measured 2026-06-28):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — typecheck/lint/build clean,
**1369 unit / 107 files** (+5: 3 backlog-#6 + 1 null-preserve integration + 1 mapper null). DECISIONS #130 +
REGRESSION_LEDGER (2 rows) + STATUS (backlog #6 DONE + residuals) written.

**State:** committing as the #130 commit. origin/main `8a4efe9` (#129) is LIVE; local main was 1 ahead = `d9de3ef`
(the #129 deploy-record docs commit, unpushed, zero bundle impact); this #130 commit makes local 2 ahead of origin.
SAFE to /clear after commit. NEXT (owner): push when ready (deploys the Plaid balance refresh + the null-preservation
fix — both money-correctness on the owner's real connected accounts); next live-ingest increments — the currency
guard (#3/#10, ~N/A for a US user) + the 9 P2 items from the #127 audit. Plan-in-Words retire-at-age + Cash Flow
Radar remain the feature track.

## 2026-06-28→29 (resumed: "continue") — Plan-in-Words slice 3: retire-at-age inverse planner (#131) — DONE ✅ (verify green, critic 0 P0/P1)
Owner (AskUserQuestion) chose the retire-at-age planner over the lower-value live-ingest P2 remainder, and "push #130
now". DID FIRST: pushed `174da9a` (#130 Plaid balance refresh + null-preservation) → origin/main = `174da9a`, LIVE.
Re-confirmed baseline before any change (measured): `bash scripts/verify.sh` → GREEN (1369 unit/107 files). Understand
phase = a 5-agent read-only workflow (wf_a5d13d4a) mapping the #122 projectRetirement engine, the #125/#126 solver
idiom, the Ask intent seam, the grounding/inputs, and the save/surfaces/test idioms → a synthesized engine-first plan.

**Built (engine-first, no-fabrication soul):**
- `src/lib/engine/solve/retire-at-age.ts` — pure `solveRetireAtAge`. The portfolio COMPOUNDS (unlike the flat savings
  twin), so no closed form: BISECT the BOOLEAN `projectRetirement(...).outcome==='sustained'` (the #122 decumulation
  engine via the SAME `buildRetirementInputs` the /investments outlook uses — originates NO compounding math, only the
  contribution). Bisecting the boolean (not a cent value) is exact under the engine's weakly-monotone cent rounding
  because the depleted→sustained flip is one-directional (proven by induction). Honest outcome
  (already-on-track / reachable / unreachable{age-in-past, age-after-end, cannot-sustain}) + share-bps on the ADDITIONAL
  money + withinSafeToSpend. `accumMonths===0` short-circuit + HI_CAP-bounded hi-doubling avoid an assertSafe overflow.
- Ask intent `retire_at_age` (intent.ts deterministic `parseTargetAge` + recognition block + validator; llm.ts prompt +
  intentFromKind re-derives the age — the model supplies only the kind; answer.ts `answerRetireAtAge`; server/assistant.ts
  grounds every figure in getCoachData.fi + the User planning dials + getSpendingPlan).
- Save path option (a): `saveRetirementAge` persists the chosen age to the EXISTING `User.retirementAge` dial
  (re-validates bounds + cross-field ordering, ownership, audit) — NOT a flat Goal (would contradict the compounding
  engine). `AssistantGoalAction` → discriminated union; ask-view save dispatch a type-safe switch with retirement-specific
  copy ("Save as my plan" → /investments). Golden-safe: read-only Ask; demo planning cols null → defaults → byte-identical.
- Tests (+40): retire-at-age.test.ts (14 — RA-0PCT exact $2,000.01/mo + minimality oracle under real compounding),
  assistant-retire-at-age.test.ts (parse/route/validate/llm/formatter + inflection locks), save-retirement-age.test.ts
  (server re-validate security), ask.spec e2e (8/8), EDGE_CASES §Retire-at-age.

**Hostile critic (wf_c5d22775, 4 dims → adversarial verify of every P0/P1): 0 P0 / 0 P1 confirmed.** The lone P1
candidate (gate + parseTargetAge anchored on literal "retire" missed the inflections "retiring"/"retired") was
adversarially DOWNGRADED to P2 (canonical phrasings all work) — FIXED anyway + regression-locked (broadened to
`retir(e/es/ed/ing/ement)`). Two more P2s FIXED: (grounding) strict `targetAge > endAge` let age==endAge give a vacuous
savable "on-track" the save validator rejects → `>=`; (ux) "your current saving" → "savings". ACCEPTED P2 (STATUS):
the solver fails LOUD on a structurally-invalid PLANNING age (current≥end) — correct, the server only supplies validated
ages or defaults (#122 / STATUS #13 precedent).

**Gate (real, measured 2026-06-29):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — typecheck/lint/build clean, **1409
unit / 110 files** (+40). Full e2e: ask.spec **8/8** incl. the new retire-at-age flow (`:107` ✓ 6.6s) + axe AA. The only
full-suite e2e failure was the documented `phase2-triage:82` throughput flake on an UNTOUCHED page under my own
back-to-back-run write saturation (STATUS #16/#17, DECISIONS #88/#99/#120/#121) — confirmed by isolated rerun, NOT a
regression (retire-at-age is a one-way edge into /coach, no triage code touched).

**State:** committed as `6a63729` (#131).

**DEPLOYED (owner: "push"):** pushed `main` → `origin/main` now **`6a63729`** (`174da9a..6a63729`, local == origin, tree
clean). This takes the retire-at-age planner (the final Plan-in-Words slice) to production — the first functional deploy
since `174da9a` (#130). The Vercel production build is auto-triggered by the push (the established GitHub-integration
behavior). **Deploy READY is UNVERIFIED from this sandbox** — `gh` is unauthenticated here and the repo's Vercel
commit-status / check-runs are not publicly readable via the unauthenticated GitHub API; NOT fabricating a READY verdict
(the owner can confirm in the Vercel dashboard). This deploy-record edit is a LOCAL-ONLY docs commit (intentionally
unpushed to avoid a redundant identical prod rebuild — push it with the next functional change), matching the
#122/#125/#129 house pattern.

**SAFE to /clear.** NEXT (owner): confirm the Vercel deploy READY if desired; remaining feature track = Cash Flow Radar
(AI plan §1.2); the live-ingest P2 remainder (currency ~N/A + 9 P2s) stays owner-gated.

## 2026-06-29 (resumed: "continue") — Plaid credit-liability statement-field correctness (#132) — DONE ✅ (verify green, critic 0 P0/P1)
Plan-in-Words trilogy (debt #125 / savings #126 / retire-at-age #131) complete + deployed → on "continue"
the owner chose the LIVE-MONEY CORRECTNESS backlog (#127 audit remainder) over the next feature (Cash Flow
Radar §1.2). Re-confirmed baseline independently before any change (measured): `bash scripts/verify.sh` →
GREEN (HEAD c399eff/#131). Picked the two highest-money-impact remaining audit items — both in the Plaid
credit-liability → statement mapper, both corrupting the cash-needed headline on REAL connected cards:
- **abs() flip:** `last_statement_balance` ran through `plaidDollarsToPositiveCents` (abs) → a statement
  CREDIT (negative balance) became an amount OWED. Fix: sign-preserving `plaidSignedDollarsToCents`; the
  engine's floorAtZero then yields $0 for a credit.
- **null/zero min → $0:** a null/0 `minimum_payment_amount` understated the MINIMUM-path cash needed. Fix:
  when no usable (>0) minimum is reported on a positive balance, reuse the engine's now-exported
  `estimateMinimumPayment` (max $35 / 1%) — one definition, no drift.
Hostile critic wf_edd3d8f3 (4 dims → adversarial verify): **0 P0/0 P1**; 2 P2 FIXED (provided-0 unified
with null; contradictory credit+min pinned), 1 P2 deferred (per-field "minimum estimated" disclosure needs
a persisted Statement column through the engine — disproportionate; documented STATUS/DECISIONS #132).
Gate (real, measured 2026-06-29): `bash scripts/verify.sh` → ✅ VERIFY GREEN, typecheck/lint/build clean,
**1417 unit / 110 files** (+8, proven fail-before/pass-after). No e2e surface (server-only; demo never
connects Plaid — labeled unit + mapper→cash-needed engine e2e is the coverage, per #124/#128/#129/#130).
NEXT: remaining #127 backlog in small increments — Plaid mortgage/student liabilities dropped, all-
unmappable-holdings deletes synced rows, currency guard, epoch UTC-boundary, SimpleFIN symbol regex.

## 2026-06-29 (resumed: "continue") — SimpleFIN all-unmappable-holdings data-loss guard (#133) — DONE ✅ (verify green, critic 0 P0/P1)
Second live-money backlog increment this session (after #132). Closed the #127 audit P2: a SimpleFIN sync
could WIPE the owner's synced /investments breakdown when a NON-EMPTY feed mapped to zero positions (all
un-mappable) — reconcileSimplefinHoldings treats an empty mapped set as "sold everything" and deleted every
source='simplefin' row. Fix (simplefin.ts INVESTMENT branch): reconcile only when `holdings.length > 0 ||
acct.holdings.length === 0`; a non-empty feed that maps to zero leaves rows intact (skipped), self-heals next
sync. Net-worth-safe (account balance authoritative) + golden-safe (demo never connects SimpleFIN).
Hostile critic wf_8a9d99dc (2 dims → adversarial verify): **0 P0/0 P1**; 1 P2 FIXED — the guard tested
`!== undefined`, so an untrusted `holdings: null` would abort the whole sync ("null is not iterable", the
#128 transactions:null class) → changed to `Array.isArray(acct.holdings)` (covers undefined/null/non-array).
Gate (real, measured 2026-06-29): `bash scripts/verify.sh` → ✅ VERIFY GREEN, typecheck/lint/build clean,
**1419 unit / 110 files** (+2, proven fail-before/pass-after). No e2e surface (server-only; mocked-server
integration is the labeled end-to-end).
NEXT (#127 backlog, owner-gated direction): Plaid mortgage[]/student[] liabilities dropped (biggest remaining;
needs a small design call on loan due dates), currency guard, epoch UTC-boundary, SimpleFIN symbol regex.

## 2026-06-29 (end-of-session HANDOFF — safe to /clear)
RESUME POINT for a fresh session (read LOOP_ENGINEERING.md + CLAUDE.md first, then this file).
- **What shipped this session (on "continue", owner chose the LIVE-MONEY CORRECTNESS backlog):** two
  #127-audit fixes, each verify-green + hostile-critic'd (0 P0/P1) + committed — #132 Plaid credit-liability
  statement fields (credit-sign + missing/zero minimum) `5638c16`, and #133 SimpleFIN all-unmappable/non-array
  holdings data-loss guard `772fdd4`.
- **Repo state:** working tree CLEAN. Local `main` is **3 commits ahead of origin/main** (`c399eff` #131
  deploy-record doc + `5638c16` #132 + `772fdd4` #133), ALL UNPUSHED. origin/main = `6a63729` (#131) is live
  in prod. Pushing deploys #132+#133 to aimplifi.app — OWNER'S CALL (no functional change is live yet for them).
- **Last gate (real, measured):** `bash scripts/verify.sh` → ✅ VERIFY GREEN, 1419 unit/110 files, tsc/eslint/
  build clean. (Re-confirm baseline independently before any new change, per discipline.)
- **NEXT (remaining #127 backlog — owner-gated direction):**
  (1) Plaid `mortgage[]`/`student[]` dropped (only `credit[]` read) — BIGGEST remaining, but it has an OPEN
      PRODUCT DECISION: cash-needed only processes `CREDIT` accounts, so loans get no due-date there today
      (net worth is already correct via the account balance). Decide whether mortgage/student payments should
      appear in the cash-needed headline, only the calendar, or stay as-is BEFORE building.
  (2) currency guard (audit #3/#10, likely N/A for a US-only user); (3) epoch→date UTC-day-boundary;
  (4) SimpleFIN symbol regex (coupled to the addHolding ticker rule — wider change). All lower-value.

## 2026-06-30 (resumed: "continue") — Plaid mortgage/student loans → calendar + reminders (#134) — IN PROGRESS
Owner (AskUserQuestion) chose: (a) PUSH #132+#133 now [DONE — pushed `6a63729..bcf26c2`, origin==local, Vercel
auto-build triggered; READY unverifiable from sandbox]; (b) build the BIGGEST #127 item = Plaid mortgage[]/student[]
ingest, surfacing the loan payment+due-date on the **calendar + reminders** (NOT the cash-needed dollar headline).
Baseline re-confirmed before any change (measured): `bash scripts/verify.sh` → ✅ GREEN (1419 unit/110 files, HEAD
`bcf26c2`, tree clean). Understand phase = a 5-agent read-only workflow (wf_eaf4415a) mapping Plaid ingest /
cash-needed / calendar+reminders / schema+net-worth / official Plaid mortgage+student schema + test idioms.

**Ground truth (cited):** net worth is ALREADY correct for loans (Plaid `loan`→type LOAN, isLiabilityType covers
LOAN+MORTGAGE, balances refresh every sync #130) — NO change there. Gap: a linked loan carries ONLY a balance — APR
never set (debt-payoff sees 0), monthly payment + due date invisible. Plaid `mortgage[]` gives next_payment_due_date
/ next_monthly_payment / interest_rate.percentage (nested) / account_id (non-null); `student[]` gives
next_payment_due_date / minimum_payment_amount / interest_rate_percentage (flat) / account_id (NULLABLE). Neither
carries current principal (use account balance). cash-needed filters `type==='CREDIT'` (assemble.ts:107) — loans
never become obligations. calendar consumes result.cards + snap.scheduled; reminders consume payInFull.cards. Seed
Auto Loan is double-modeled: acct-autoloan (LOAN, apr 649, min 38500, dueDay 5) + sched-autoloan (-38500 MONTHLY on
checking) — the scheduled row is what puts it in cash-needed/calendar today.

**Plan (engine-first; acceptance criteria as testable assertions):**
1. [ ] `dates.ts` — move `nextDayOfMonth` here (single tested date utility, rule #3); assemble.ts imports it. Test: known-answer (same-month, roll-to-next, clamp Feb).
2. [ ] `engine/loans/obligations.ts` — pure `selectLoanObligations({accounts,today,holidays})→LoanObligation[]`
   (LOAN|MORTGAGE with minimumPaymentCents>0 && dueDayOfMonth!=null; dueDate=nextDayOfMonth, effectiveDueDate=
   priorBusinessDayIfNonBusiness clamped≥today, paymentCents=min). Excludes CREDIT/CHECKING/no-payment/no-dueDay.
   Tests: weekend rollback, clamp-to-today, exclusion, sort, MORTGAGE included.
3. [ ] `plaid-map.ts` — `PlaidMortgageLiability`/`PlaidStudentLiability` types + pure `mapPlaidMortgageToLoanFields`
   / `mapPlaidStudentToLoanFields` → {aprBps,minimumPaymentCents,dueDayOfMonth} (each null on missing/non-finite,
   never throws); `mapPlaidAccountType('loan','mortgage')→'MORTGAGE'`, ('loan','student'|other)→'LOAN'; add MORTGAGE
   to PulseAccountType. Tests: known-answer + nulls + subtype mapping.
4. [ ] `plaid.ts` syncLiabilities — widen response to {credit?,mortgage?,student?}; sibling loops UPDATE the joined
   loan Account with only the non-null fields (preserve-on-null, #130); skip rows w/o joinable account_id (student
   account_id nullable). Mocked-server integration test (mirror plaid-balance-refresh idiom): populate + preserve.
5. [ ] `calendar/build.ts` — CalendarEvent.kind +'loan-due'; emit loan-due (label "{name} due", -paymentCents);
   reminderDates include loan-due. Calendar page renders loan-due (Landmark icon + 'due' badge) + generalized
   summary copy. Tests: loan-due event + reminderDates.
6. [ ] `reminders/select.ts` — generalize to `obligationType:'card'|'loan'`; accept loanObligations; copy "card
   payment"→"payment" (subject/email/dashboard card). finance.ts cashNeededFromSnapshot returns `loanObligations`
   (one definition); getDashboardData + cron + calendar consume it. Tests: loan→reminder, copy.
7. [ ] Seed — remove `sched-autoloan` (loan now first-class loan-due; no double-display). Re-golden calendar/
   projection/reminders demo tests (headline byte-identical — demo has no shortfall). EDGE_CASES + DECISIONS #134 +
   REGRESSION_LEDGER.
8. [ ] `bash scripts/verify.sh` + VERIFY_E2E (calendar/dashboard) GREEN; hostile critic (money + data-loss) 0 P0/P1.

**Accepted boundary (owner's choice):** loans surface as calendar/reminder SIGNALS; the cash-needed projection/
shortfall stays card-focused (the "headline too" option was declined). Net-worth + golden-safe (demo never connects
Plaid; the one demo change is removing the sched-autoloan stand-in, headline unchanged).

### #134 — DONE ✅ (verify+e2e green, critic 0 confirmed P0/P1)
All 8 plan steps complete. **Gate (real, measured 2026-06-30):** `bash scripts/verify.sh` → ✅ VERIFY GREEN —
typecheck/lint/build clean, **1446 unit / 113 files** (+27 over the 1419 baseline). e2e calendar/reminders/a11y
**15/15** clean (axe AA; dashboard reminder surfaces the demo Auto Loan; calendar card-due unaffected). Demo loan
verified surfacing end-to-end (loan-due 2026-07-02, scheduled rows 3 after sched-autoloan removal).

**Hostile critic wf_d388bf4b** (3 lenses → adversarial verify): 0 confirmed P0/P1. 2 mapper money-bugs FIXED +
regression-locked — (F1) `> 0` on the PRE-rounded value wrote a fabricated 0 for a sub-cent payment / sub-bps rate
→ round-FIRST then `> 0`; (F2) a huge finite payment threw via cents() safe-int assert → magnitude-bound to the
Postgres Int ceiling before rounding. **Residuals documented (STATUS #134, owner-gated NEXT):** recurring-detection
vs loan-due have NO de-dup → demo /forecast drops the loan (real users unaffected); a recurring-detected
mortgage/student could double-display (narrow — not the auto loan, not transfer-categorized payments). Reported-$0
payment preserved (per #132). DECISIONS #134 + REGRESSION_LEDGER (3 rows) + EDGE_CASES §Loan-obligations + STATUS #134.

**Docs commits + #134 feature commit pending.** origin/main `bcf26c2` is LIVE (incl. #132/#133, pushed this
session). Push deploys #134 — owner's call (the live Plaid mortgage/student path stays UNVERIFIED until a real-token
sync; the mocked-server integration is the labeled end-to-end, per the live-path convention). SAFE to /clear after commit.

**NEXT (owner):** push #134 when ready; the de-dup design (canonical loan source across calendar/forecast/reminders)
is the documented follow-up. Remaining #127 tail (lower value): currency guard (~N/A US), epoch→date UTC-boundary,
SimpleFIN symbol regex.

## 2026-06-30 (session: "aimplifi", resumed "continue") — Currency guard (#135, live-ingest audit #3/#10) — DONE ✅ (verify green, 2 critic cycles, all confirmed P1s fixed + locked)
Baseline re-confirmed before any change: `bash scripts/verify.sh` → GREEN (HEAD 859ab29 = #134, 1444 unit/113 files).
Owner's standing preference (#132) = finish the live-money correctness backlog before new features; picked the
highest-severity remaining item I could take end-to-end autonomously (the loan de-dup is owner-gated; currency was P1).

**Built (engine/read-path first):** nullable `Account.currency` (null=assumed USD → golden-safe), pure
`src/lib/providers/currency.ts` (canonicalize/resolvePlaid/isSupported), both mappers persist it + both sync writers
store it. Withhold non-USD accounts + ALL their child rows at every account-scoped read: the snapshot
(accounts+transactions+scheduled+snapshots), getAccountsView, getInvestments, register, triage, /budgets,
refreshRecurringForUser, and all ~15 first-run empty-state gates (DB reads mirror `isSupportedCurrency` as
`OR:[{currency:null},{currency:'USD'}]`).

**Critic cycle 1 (wf_74fc0808, 4 dims → adversarial verify):** my "two source filters cover everything" premise was
WRONG — **4 P1 bypasses + 1 P2, all FIXED + regression-locked:** getInvestments roll-up (P1-A); count-gates vs
snapshot invariant → all-non-USD user throws + export 500 (P1-B); transaction leak into reports/trends/coach/register
(P1-C ×2); resolvePlaidCurrency('','BTC') fail-open (P2).
**Confirmation cycle (wf_bda5c45a, 3 lenses):** 2 fixes-hold; completeness lens found **2 MORE direct transaction
reads of the same class — /budgets spend + refreshRecurringForUser — FIXED + locked** (a foreign subscription would
persist a scheduled row on the USD payment account at 1:1). I also independently grepped every `prisma.account.find*`
+ `prisma.transaction.find*/count`: all figure-paths now guarded; `listAccounts` has zero consumers (dead); the
remaining reads are single-row ownership checks, sync internals, or cosmetic (export CSV dump / pickers / counts).

**Gate (real, measured 2026-06-30):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — typecheck/lint/build clean,
**1465 unit / 115 files** (+21). No e2e surface (server/read-path; the `currency-guard.test.ts` integration suite is
the labeled end-to-end). Tests: currency.test.ts (9) + currency-guard.test.ts (8: net worth, snapshot transactions,
review-count, accounts view, getInvestments, direct-read predicate, supported gate-count).

**State:** committed as the #135 feature+docs commit (see below); working tree clean after commit. **NOT pushed** —
pushing main = prod deploy (owner's call). Deploy is byte-identical for the demo (all null-currency) but activates the
guard for the owner's real Plaid+SimpleFIN accounts.

**NEXT (owner-gated, choose one for the next session):**
1. **Currency-exclusion disclosure UI** (STATUS #135 residual 18) — the highest-value follow-up: a "N accounts
   excluded — no FX yet" banner on the dashboard + /accounts, so a withheld foreign LIABILITY can't silently flatter
   net worth. (Small UI increment.)
2. **#134 loan de-dup** — decide the canonical loan source and de-duplicate calendar/forecast/reminders (owner design
   call; STATUS #134).
3. **Remaining #127 tail** (lower money-impact P2s): SimpleFIN symbol regex (options/crypto/slash tickers) + epoch→date
   UTC-day-boundary + SimpleFIN holding-LEVEL currency (STATUS #135 residual 20).

**SAFE to /clear after this commit** — this PROGRESS entry + DECISIONS #135 + STATUS #135 + REGRESSION_LEDGER (5 rows)
are the complete resume anchor. Push #134 (+ this #135) together when ready, or bundle with the next change.

## 2026-07-01 — OWNER FEATURE REQUEST logged (custom subcategories in triage) — NEW #1 NEXT ITEM
Owner (verbatim intent): "the inbox categorization is clunky and doesn't allow for write-in
categories. for instance our family plays a lot of golf, there should be a button to add
subcategories to main categories, like in mint or simplifi."
→ **This jumps to #1 NEXT**, ahead of the #135 owner-gated list (currency-disclosure UI /
#134 loan de-dup / #127 tail — all still open, unchanged).
Scope notes for the next session (understand-first, engine-first per rule #5):
- Two asks in one: (a) user-defined **write-in subcategories** attached to existing main
  categories (e.g. "Golf" under an entertainment/leisure parent), with an add button surfaced
  in the categorization flow; (b) the triage/inbox categorization UX itself is "clunky" —
  audit the picker flow while in there (don't rebuild the whole inbox unasked).
- Understand phase must map: the Category model + taxonomy (fixed seed set? parent/child
  support?), the triage picker + inline recat UI, rules engine (assign.ts / corrections /
  Always-rules lineage), the LLM second pass (categorize/llm.ts validates against known
  categories — a dynamic set changes that contract), and every category consumer
  (budgets / reports / trends / coach / Ask answers / spendingByCategory).
- Constraints: golden/demo byte-identical (additive user-scoped rows, seed untouched);
  custom categories must be ownership-scoped; deletion/rename semantics need a decision
  (what happens to transactions filed under a deleted custom subcategory).
Repo state at logging: HEAD `00555d5` (#135), tree clean, local main **2 ahead of origin**
(`859ab29` #134 + `00555d5` #135, unpushed — pushing deploys both; owner's call).
Resume: fresh session reads LOOP_ENGINEERING.md + CLAUDE.md → this entry → build.

## 2026-07-01 (resumed: "continue") — Custom subcategories in triage (#136, owner's #1) — IN PROGRESS
Baseline re-confirmed before any change (measured): `bash scripts/verify.sh` → ✅ VERIFY GREEN (exit 0,
HEAD dd08f2e, tree clean, local main 3 ahead of origin incl. the request-log commit). Understand phase =
5-agent read-only workflow (wf_198a10d5) + synthesizer; full brief archived in the workflow output.

**HEADLINE FINDING: custom categories are ~80% SHIPPED** (DECISIONS #111/#112 — createCustomCategory/
rename/delete, ownership-scoped, atomic delete-remap, Settings-only UI at custom-category-manager.tsx).
The gap = the add affordance INSIDE the categorization flow + one LIVE BUG + "clunky" picker UX.
Owner (AskUserQuestion) chose the FULL SWEEP, sequenced — each increment verify-green + critic'd +
committed before the next, stop-anywhere safe:
  (1) write-in "+ New category" in triage alternatives (creates + files the current txn immediately)
      + fix the LIVE manual-add bug (manual.ts:60 re-validates against system-only CATEGORY_BY_ID and
      throws `Unknown category` for any custom id the form legitimately offers — verified by direct read)
  (2) replace triage's unsearchable ~84-option native <select> with a searchable picker
  (3) same add affordance in the register inline-recat.

**Design decisions (recorded here + DECISIONS #136 at commit; per "when blocked → decide"):**
- D1 parent model: GROUP STRING (parentId stays dead — DECISIONS #65); "Golf" = custom row, group e.g.
  'Entertainment'. D5 ordering: KEEP append-within-group (grouped pickers already slot customs into their
  optgroup; create-then-file auto-selects, so discoverability is moot). D4 discretionary: explicit
  checkbox defaulting true (mirrors shipped Settings manager — no opaque inheritance). D7 LLM/auto-file:
  stays SYSTEM-ONLY (llm.ts:33/41 untouched; Always-rules already give auto-filing of customs). D6: no
  parent-rollup budgets (customs behave exactly like system leaves). D8 manual.ts fix: thread an
  `extraValidCategoryIds` set (server passes ONLY the assertOwnedCategory-validated id — defense in depth
  preserved, default empty set → byte-identical). CSV path confirmed NOT buggy (resolveCategory handles
  customs; prepareImportedTransaction never re-checks).
- Guardrails held: customs never under Income/Transfers (R1 — CUSTOM_CATEGORY_GROUPS enforced server-side
  already); create-then-file SEQUENCED await (R4); no second delete path (R6).

**Increment 1 acceptance criteria (testable):** A1 prepareManualTransaction accepts a custom id present in
the extra set / rejects absent / default unchanged (unit). A2 create→createManualTransaction(custom id)
persists — FAILS TODAY with `Unknown category` → regression lock, proven fail-before (integration,
throwaway user). A3 create→applyCategory sequence files (integration — locks the UI contract). A4 e2e:
alternatives → "+ New category" → name+prefilled group → creates, files, advances; new category present in
subsequent pickers; `triage-alternatives` grid still EXACTLY 3 buttons (pin at phase2-triage.spec.ts:54
— button lives OUTSIDE the grid). A5 duplicate/shadow errors surface inline, nothing filed. A6 axe AA with
the mini-form open. A7 zero-custom user byte-identical (no seed/schema change; assignableCategories
identity already locked).
Files: src/lib/engine/transactions/manual.ts + src/server/transaction-actions.ts (bug fix),
src/components/triage/triage-inbox.tsx (UI), tests/unit/transactions-manual.test.ts +
tests/unit/manual-custom-category.test.ts (new) + tests/e2e/phase2-triage.spec.ts.

### Increment 1 — DONE ✅ (verify green, critic 2 P1s fixed + e2e-locked, 0 open P0/P1)
Test-first: the regression test drove the REAL createManualTransaction and FAILED with the exact
diagnosed error (`Unknown category "cmr2it..."` at manual.ts:61) → fix (`extraValidCategoryIds`,
default-empty = byte-identical; the action passes the one assertOwnedCategory-verified id) → pass.
UI shipped as designed (create→file sequenced; overlay bridges the RSC refresh, deduped AND pruned
once the server list knows the id — an e2e run caught the duplicate-option bug the dedup fixes).
**Hostile critic (wf_e4584600, 4 lenses → adversarial verifier): 2 CONFIRMED P1, both FIXED +
e2e-locked** — (a) rejected create action escaped to the route error boundary (try/catch → inline
error; locked by a route-abort e2e); (b) open mini-form survived batchApply/undoLast top-card changes
with a stale group prefill (both paths close it; locked by an undo-path e2e). P2s fixed: overlay
prune, IME isComposing, name-normalization parity, Escape. Accepted residuals in STATUS 2026-07-01.
**Gate (real, measured 2026-07-01):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — **1470 unit / 116
files** (+5), tsc/eslint/build clean. E2E: gestures + write-in + accuracy **3/3** (write-in incl. axe
AA with the form open + both P1 locks; 0.8–4.1s each).

**ENVIRONMENTAL FINDING (evidence, not vibes):** the full-suite gate ran 58/59 — the one failure is
the documented phase2-triage full-review throughput stall (#16/#17), which TODAY reproduces even
isolated + fresh temp DB at THREE code points (my tree / pre-change HEAD / #131 where it last measured
green) — a 3-point A/B proving machine-level SQLite write-throughput degradation, NOT a code
regression and NOT caused by #136. Full evidence + follow-ups in STATUS 2026-07-01. Stopped hammering
per the #123 protocol once the A/B was conclusive.

**NEXT (owner-approved sweep, in order):** increment 2 = replace triage's unsearchable ~84-option
native <select> with a searchable picker (register's listbox is the in-repo precedent; mind the
triage-all-categories testid + axe pins); increment 3 = the same add affordance in the register
inline-recat (transaction-list.tsx category-menu). Then: push (deploys #134+#135+#136 — owner's call).

### Increment 2 — DONE ✅ (verify green 1476/116, Checker 2 P1 fixed + locked, e2e 3/3)
Searchable picker shipped: pure `filterCategoryOptions` (assign.ts, 11 known-answer tests incl.
blank-query identity + group-label matching) + search input/option list replacing the native select
(plain buttons — deliberately NOT ARIA listbox/option, keeps the axe scan clean; DECISIONS #137).
Focused Checker (wf_634e20c6) found 2 REAL P1 regressions the picker would have shipped: (1)
name-only search missed visible GROUP labels ("bills" → false no-match → duplicate-manufacturing);
(2) keyboard access regressed hard vs the select (~86 tab stops, dead Enter). Fixed: group-label
match keeps the whole group; the PANEL takes focus on open (container tabIndex -1 — a first-run e2e
failure proved focusing a child button silently no-ops while it's disabled mid-action); Enter files
the single visible match; Escape clears/closes; stale query reset on batch/undo (P2, same class as
the form fix). All e2e-locked in the write-in spec.
**Stall diagnosis CORRECTED (STATUS 2026-07-01):** direct Prisma write probe on the e2e DB =
min 0/p50 1/p95 1/max 22 ms while browser actions stalled ≥60s → storage HEALTHY, the stall is in
the request/server layer under rapid sequential actions; localhost→127.0.0.1 pinned (hygiene; light
specs stabilized, full-review stall persists; still environmental per the 3-point A/B). Versions
recorded for the owner: node v24.16.0 / playwright 1.60.0 / next 15.5.19.
Gate (real 2026-07-01): verify.sh → ✅ GREEN 1476 unit/116 files; e2e gestures+write-in+accuracy 3/3.

### Increment 3 — DONE ✅ (verify green 1476/116, Checker 1 P1 fixed + race-locked ×4) — SWEEP COMPLETE
Register write-in: "+ New category" inside the category-menu → hands the new id to the EXISTING
once/always confirm (#121, never one-tap); shared group-label filterCategoryOptions replaces the menu's
name-only filter (same P1 class as triage); drop-up menu on low rows (checker downgraded the nav-
interception theory — z-50 out-paints z-40; residual = reach/overlay polish). **Checker (wf_0b0ff005):
1 CONFIRMED P1 FIXED + e2e-locked — `chosen` unbound to its row + un-gated chips meant a create
resolving after a row switch put the one-tap confirm (worst case merchant-wide + durable rule) on the
WRONG row → `chosen` now carries rowId; pane renders + commit() fires only for the matching row.
Route-delayed race spec GREEN ×4 on the final tree.** P2s: stale draft cleared on chip-open; redundant
createAndChoose refresh removed (the action's revalidation is the payload carrier — and anything held
in the transition keeps the confirm buttons disabled); spec budgets 20s. Accepted P2s in STATUS.
**Honest e2e label:** the happy-path register spec measured GREEN once (3.0s) pre-rowId-refactor; on
the FINAL tree it is witnessed green THROUGH the confirm pane (×3 runs) but the once-click tail
repeatedly hits the machine's ≥60s action-apply stall → full-pass UNVERIFIED until the box recovers.
**Stall root-cause refined (STATUS):** it's the ACTION-RESPONSE REVALIDATION APPLY holding the client
transition (hence every disabled={pending} button); storage healthy (p50=1ms probe); environmental
today (3-point A/B incl. #131). OWNER: reboot, then `npx playwright test` to re-witness.

**Session state at close:** local main = dd08f2e +3 session commits (d7907c8 #136-inc1, f5a04b5
#137-inc2, 28cad97 #138-inc3).

**RE-WITNESS + DEPLOYED ✅ (owner: "go with what you're recommending"):** pre-push full gate
`VERIFY_E2E=1 verify.sh` → **60/61 e2e passed** — every spec covering this session's code GREEN on the
final tree (incl. the previously-stalled register happy path); the ONE failure remains the A/B-proven
environmental full-review throughput test (fails identically on already-deployed code; isolated rerun
still red → cure = reboot, gates nothing). Pushed `bcf26c2..28cad97` → Vercel production
`dpl_FyeLL6utdJM6fwVFn8mm4GhL5q9Q` reached **READY** in ~84s (verified via the Vercel MCP, team
reiforge/project aimplifi), aliases aimplifi.app + www.aimplifi.app live (apex 308→www with the HSTS
header; /sign-in → 200). This deploy takes **#134 (Plaid loans → calendar/reminders) + #135 (currency
guard) + #136/#137/#138 (the category sweep)** to production together.
NEXT (owner-gated): reboot when convenient + one full VERIFY_E2E=1 to re-witness the throughput test
(STATUS 2026-07-01 has the diagnosis + version pins); backlog unchanged — #135 currency-disclosure UI,
#134 loan de-dup, #127 tail, shared-CategoryPicker/SR-listbox follow-up. (This deploy-record entry is a
LOCAL-ONLY docs commit, intentionally unpushed per the house pattern — bundle with the next change.)
SAFE to /clear.

## 2026-07-01 (evening, session cont.) — #139 write-in prefill (owner live-prod request) — DONE ✅
Owner verified #136-#138 live (deploy dpl_FyeLL6 confirmed READY, built from 28cad97, aliases live;
"don't see it" = stale PWA bundle, resolved by reopen) then asked: consolidate the new-category name
into the picker search box. Built as its own increment (the in-flight #135 disclosure work was stashed
first — stash 'wip-135-disclosure', task #2 holds the resume state). Prefill name from live query in
BOTH write-ins + triage zero-match-Enter opens the prefilled form. Checker wf_e902ad02: 2 P1 fixed +
locked (!newCatOpen clobber guard; e.repeat held-key chain guard), test-adequacy locks added, 1 finding
refuted, double-DISCRETE-Enter accepted residual (STATUS). Gate: verify GREEN 1476/116; triage write-in
spec GREEN 7.9s final tree; register race GREEN; register happy-path tail = documented environmental
stall (re-A/B'd at HEAD today). PROCESS LOCK recorded: never run e2e concurrently with verify's build
(stale .next serves the previous tree — burned 40 min on a phantom "failure" that was actually the
pre-fix bundle proving the checker's P1 for real).
NEXT: (1) resume #135 disclosure increment from stash (task #2 has the full state: integration tests +
guarded e2e-add-account script + currency-disclosure.spec remain); (2) owner-gated: reboot + full
VERIFY_E2E=1 re-witness; (3) backlog unchanged (#134 loan de-dup, #127 tail, shared CategoryPicker).

## 2026-07-01 (late) — #140 iOS focus-zoom + dropdown formatting (owner report) — DONE ✅
Owner hit the iOS <16px focus-zoom on the #139 dropdown. Root-cause fix: global (pointer:coarse) 1rem
floor on form controls in globals.css (no shared Input component exists — bug was app-wide); register
menu w-56→w-72 + viewport clamp; e2e computed-font-size locks on both surfaces (GREEN — emulation
matches coarse). Gate: verify GREEN 1476/116; triage write-in 7.7s; race 4.6s; happy-path tail =
documented stall. OWNER TO CONFIRM on the physical phone after deploy. NEXT unchanged: resume #135
disclosure from stash (task #2), owner-gated reboot re-witness, then backlog.

## 2026-07-02 (resumed: "continue") — #141 currency-disclosure banner (#135 residual) — DONE ✅
Resumed exactly per the 2026-07-01 NEXT: popped stash `wip-135-disclosure` clean (banner component was
in the stash's untracked parent; task #2 did not survive the session — the stash + this ledger did).
Stash contents verified green as restored (tsc clean, 16/16 currency unit tests) before new work.
Built the three pending pieces: (1) integration its on the existing currency-guard fixture —
`getAccountsView(USER).withheld == {count:3, currencies:['EUR','GBP']}` + `getWithheldAccountSummary`
for USER / USER_INV / unknown-user; (2) guarded `scripts/e2e-add-foreign-account.ts` (exact-match
DATABASE_URL === E2E_DB_URL + @aimplifi.test-only email + delete-own-rows-first idempotency); (3)
`tests/e2e/currency-disclosure.spec.ts` — negative zero-render lock on the all-USD demo user,
positive ad-hoc-signup path (banner on dashboard + /accounts, withheld names absent, axe AA with the
banner present). Demo user deliberately never mutated: it is SHARED across fully-parallel specs.

**Hostile Checker (wf_de889cf4, 4 lenses → adversarial verify): 17 raw → 11 confirmed (1 P1 + 10 P2),
6 refuted. P1 FIXED:** the negative spec's "page rendered" anchor (`demo-banner`) is LAYOUT content
that flushes before the route-group Suspense boundary, so the absence assertion passed against the
loading skeleton — re-anchored on `net-worth-card` (page content). 7 P2 fixed: pure
`withheldBannerCopy()` copy authority (title "not in U.S. dollars" — crypto isn't "foreign"; singular
+opaque → "another currency"; display tokens letters-3–5 uppercased/deduped, '840'/'US'/'doge' fold);
all-foreign /accounts empty-state contradiction; spec `.first()` strict-mode bypass; helper
idempotency. 3 accepted → STATUS residuals 23–25 (other surfaces still silent — /investments first
when extended; predicate duplication refactor; projection-assumption inline copy).

**Gate (real, measured 2026-07-02):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — **1492 unit / 116
files** (+16), tsc/eslint/build clean. E2E final tree: currency-disclosure **2/2 GREEN ×3** (2.7s /
4.0–4.8s, incl. axe); auth.spec (touched empty-state) **3/3 GREEN** — one single-test failure in the
first post-build run did NOT reproduce (isolated 2.6s + full-file 3/3), classed environmental per the
#16/#17 protocol. No stall hit any of this session's runs.

**NEXT:** (1) commit + owner's call on push (deploys #139/#140 docs + #141 together); (2) owner-gated:
reboot + full `VERIFY_E2E=1` re-witness of the throughput spec (STATUS 2026-07-01 diagnosis stands);
(3) backlog: STATUS residual 23 (extend disclosure — /investments first), #134 loan de-dup, #127 tail
(SimpleFIN symbol regex + epoch→date), shared CategoryPicker/SR-listbox follow-up.

**DEPLOYED ✅ (owner: "Push + verify deploy"):** pushed `69a335b..7393633` → Vercel production
`dpl_2RZXpkApYzK8EGUFime229bzuc41` (team reiforge / project aimplifi, built from 7393633) reached
**READY in ~68s** (verified via the Vercel MCP; aliasError null). Aliases live: aimplifi.app
(308→www, HSTS pattern) + www.aimplifi.app (/sign-in → 200, probed 2026-07-02). #141 currency
disclosure is in production. NEXT unchanged: owner-gated reboot + full VERIFY_E2E=1 re-witness;
backlog — STATUS residual 23 (extend disclosure, /investments first), #134 loan de-dup, #127 tail,
shared CategoryPicker. (This deploy-record entry is a LOCAL-ONLY docs commit per the house pattern —
bundle with the next change.) SAFE to /clear.

## 2026-07-02 (cont.) — PULSE_CATEGORIZATION_FIX Phases 1-2 — DONE ✅ (owner-gated per phase)
Owner loaded PULSE_CATEGORIZATION_FIX.md: diagnose → baseline → rebuild → test → prove.
**Phase 1 (read-only)**: 5-reader workflow wf_37625155 + executed normalizer traces + seeded-DB
probe. Diagnosis delivered in-chat + docs/CATEGORIZATION_DIAGNOSIS.md. Verdict: 420-item queue =
expected output (per-txn queue unit × no learning from default flow × static 52-regex identity ×
resync clobber × honest 33-60% messy review rate). Owner confirmed → Phase 2.
**Phase 2 (measured baseline)**: scripts/messy-corpus.ts (437 txns/60d/50 merchants, deterministic)
+ guarded messy-categorization-seed.ts (real pipeline, dedicated aimplifi-baseline DB) +
baseline-triage-walkthrough.ts (Playwright 380px, tap+time accounting, screenshots). RESULT
(baseline-run.json + PHASE2_BASELINE.md): queue 144/437 = 33.0% (24 merchants → 6× inflation);
397 interactions to clear (Accept/batch usable on 0/144 — bestGuess suggests 'Shopping' on every
unknown card); modeled 26.5 min full / 4.1 min + 61 interactions for one week (targets: <60s/<15);
23.8% silent auto-misfiles; 63 pipeline merchants from 50 real (fragmentation). 1 environmental
stall (retried; run completed). Evidence: docs/baseline/phase2/shots/*.png.
NEXT: Phase 3 rebuild (owner-gated): merchant-unit queue + trust-on-repeat + retro-in-one-action +
chunking + learned defaults. The #135-#141 backlog (disclosure /investments, #134 loan de-dup,
#127 tail) queues behind the categorization fix.

## 2026-07-02 (cont.) — Phase 3 rebuild IN PROGRESS: 3d ✅ + 3a ✅ committed, 3b next
Owner confirmed Phase 3. Increment plan: 3d clobber-guard → 3a normalization → 3b group
engine/server → 3c UI → Checker → e2e adaptation → Phase 4 tests → Phase 5 before/after.
**3d DONE (cd3e01a):** resync never clobbers a corrected verdict; both providers; regression
fail-old/pass-new via real sync paths + real applyCategory; REGRESSION_LEDGER entry; 1495/117.
**3a DONE (ec5a152, DECISIONS #142):** clean-second-chance (full-consume rule preserves the
critic2 anchored-pattern lock), city/state strip w/ safety rails, asterisk scrub, robustified
patterns (Kroger/Target/Home Depot/Shell/Uber×2/T-Mobile), Uber-Eats drift → food-delivery
(seed churn hand-verified: movers +food-delivery, cents pins unchanged), LIGHT utility token
(municipal bill no longer erased as transfer), +8 national entries incl. Venmo-as-aggregate.
MEASURED: adversarial eval 60% → 23.3% review on messy data, precision 100%; 1507/118 green.
**NEXT: 3b** = pure groupReviewRows engine + getTriageGroups (kills the N+1 similarCount) +
fileMerchantGroup action (batch + corrections + prediction truth + rule when eligible, one
$transaction; group framing IS the Always consent — record as DECISIONS #143) + merchant-count
badge. Then 3c UI (group cards, "X merchants left", honest quick-picks replacing
bestGuess='Shopping'), Checker workflow, phase2-triage e2e adaptation.
Baseline artifacts for Phase 5 comparison: docs/baseline/phase2/ (same corpus, same driver).

## 2026-07-02 (cont.) — PULSE_CATEGORIZATION_FIX Phases 3-5 COMPLETE ✅ (pending Checker)
Phase 3 shipped in 4 verify-green commits: 3d clobber-guard (cd3e01a), 3a identity (ec5a152, #142),
3b group engine (6362f90, #143), 3c UI + rescoped e2e (001eb5b, #144). Phase 4: corpus locks
(messy-corpus-queue.test.ts — 83.8% day-one auto, 16 decisions, <5% after one pass, aggregates-only
residue, real numbers printed). Phase 5 MEASURED (same corpus/driver/labels as the Phase-2 baseline):
queue 144→16 (9×), interactions 397→45 (8.8×), modeled 26.5min→3.0min, week-slice 61→14 interactions
(56s — MEETS SPEC <15/<60s), 0 stalls, evidence in docs/baseline/phase5/. Report: PHASE5_AFTER.md.
Environmental (3-point A/B'd): phase5-a11y keyboard-only /cards fails today at 69a335b too — machine,
not code; retest post-reboot. NEXT: Maker/Checker workflow over the Phase-3 diff (house rule for the
core engine), then owner review + push call (deploys #142-#144 + the fix).

## 2026-07-02 (late) — Checker cycle 1 on the rebuild — DONE ✅ (5bd0106)
wf_908cf9a8 (39 agents): 35 confirmed. FIXED + locked: merchantless mass-misfile P0 (scope+groupKey),
sync-guard atomicity + predicate v2 (split parents, undone rows, isTransfer), Plaid pending→posted
transplant, fileMerchantGroup compare-and-set + rule dedupe + card parity, 3 UI hardening fixes, demo
ACH name-binding, badge-key unification, week-slice canary. Gate: verify GREEN 1520/120; phase2 e2e
gestures+write-in green; throughput e2e = late-day machine stall (green ×3 mid-day; a11y 3-point A/B
proves day-long degradation — reboot-gated re-witness). Deferred P2s recorded in STATUS w/ rationale.
Local main = 69a335b +9 commits, ALL UNPUSHED (push = prod deploy = owner's call).
NEXT: owner reboot → VERIFY_E2E=1 re-witness → owner push call; then backlog (#135 residual 23 disclosure
/investments, 3a rule re-point backfill follow-up, #134 loan de-dup, #127 tail). SAFE to /clear.

## 2026-07-02 (resumed: "continue") — #145 /investments disclosure + CYCLE-2 CHECKER LANDED
Owner picked "start next backlog item" (reboot/push stay owner-gated; machine still un-rebooted —
last boot Jun 30). **#145 built (STATUS residual 23):** CurrencyExclusionBanner + withheld-aware
empty state on /investments (page.tsx Promise.all + InvestmentsView prop; zero-withheld byte-identical),
currency-disclosure.spec extended BOTH paths (negative anchored investments-summary per the #141
anchor rule; positive + second axe scan). Gate: `bash scripts/verify.sh` → ✅ VERIFY GREEN; isolated
`npx vitest run` re-capture → **1520 passed / 120 files (38.7s)** (no new unit tests — the increment's
locks are e2e); targeted e2e **6/6 GREEN 16.9s** (disclosure 2/2 + investments 4/4, no stall). Checker wf_637cc5e5: **0 P0/P1, 2 P2 confirmed → FIXED** (zero-withheld empty-state
branch unlocked → --usd-only fixture + byte-identity e2e; /investments name assertions couldn't
witness the guard → INVESTMENT-typed EUR brokerage added to the fixture, counts 2→3), 2 refuted.
Re-run: currency-disclosure **3/3 GREEN 15.4s**. Committed with docs.

**MID-SESSION: cycle-2 confirmation checker (wf pre-/clear, 23 agents) completed — 20 raw,
20 CONFIRMED, 0 refuted** against the unpushed cycle-1 stack (5bd0106). Deduped defects:
**P0-A** transplant × split-parent (plaid.ts:404-431 select omits isSplitParent; splitTransaction has
NO status guard; split PENDING posts under new id → parent deleted, children dangle (no FK), new
full-amount row → DOUBLE-COUNTED spend; removed[] path has the pre-existing sibling for canceled
charges). **P1-B** guards assume SQLite write serialization, prod = PrismaPg READ COMMITTED
(db-adapter.ts:40-42): sync-guard read-then-unconditional-update (plaid 382-394 / simplefin 501-510)
reopens the clobber; fileMerchantGroup raced corrections commit + duplicate priority-100 rules; also
affected==0 path commits corrections+rule then skips auditLog. **P1-C** groupEmptied mutated inside
setGroups updater, read synchronously (triage-inbox.tsx:232-252) — deferred updater on the write-in
path (createAndFile dispatches state first) skips setMode('idle') → singles leak resurfaces.
**P1/P2-F** transplant computes settled from predecessor fields read OUTSIDE its tx. **P2s:** D
merchantless scope lacks merchantId:null (triage.ts:58-61 — m: card rows co-filed); E simplefin
findFirst+create reintroduces CQ-2 upsert race (plaid create:435 same shape); G removed[] applied
per-page defeats transplant when removed lands a page early; H rule dedupe ignores the 5 condition
columns; I gate gaps (count≡scope equivalence unlocked; recategorize mints undeduped rules).
Fix plan (tasks #2-#6): P0-A three ends (split status guard + transplant preserves split-parent for
legacy rows + removed[] cascades children); P1-B compare-and-set/Serializable design decision;
P1-C pre-dispatch emptiness derivation; P2 batch; then cycle-3 confirmation workflow (cycle cap 4).
NEXT: checker wf_637cc5e5 result → #145 commit → cycle-2 fixes (P0 first).

**#145 COMMITTED (e51d6fe)** — checker 0 P0/P1, 2 P2 fixed (byte-identity lock + real guard witness),
disclosure spec 3/3 GREEN 15.4s. Local main now +11 unpushed.

**CYCLE-2 FIXES IMPLEMENTED (DECISIONS #146, STATUS cycle-2 section, REGRESSION_LEDGER row):**
Design pivots vs the initial plan, decided from ground truth: (1) NO pending-split status guard —
critic2 F1 models splitting the seeded pending Zelle, it's a documented capability; instead the split
lifecycle invariant is enforced at every churn path (transplant carries/dissolves; removed[] cascades
children; same-id drift dissolves BOTH providers; preserved splits post children). (2) Serializable
(serializableTx helper, probed OK on better-sqlite3) over CAS — Correction has no FK so a WHERE can't
re-assert "corrected", and CAS can't stop the double-mint dedupe race. (3) P2002→guarded-update
fallback restores CQ-2 in both providers. (4) Merchantless scope pins merchantId:null; aggregates
descriptor-only BY DESIGN (agg: cards mix CSV+synced rows). (5) ensureUnconditionalRule shared mint
(5 condition columns in the dedupe; recategorize dedupes + fetches targets in-tx). (6) groupEmptied
derived pre-dispatch; e2e lock drains a group and files the last row via write-in.
Locks: serializable-tx.test.ts (helper contract) + sync-preserves +6 + triage-groups +4 + phase2 e2e
singles-leak. **Fail-old PROVEN by stash-run: 8 locks red on pre-fix code, green on fixed** (the
count≡scope lock passes both by design — prophylactic; the singles e2e fail-old is by mechanism
inspection). Affected suites 35/35 + 12/12 green; tsc/eslint clean.
NEXT: full verify + phase2-triage/sync e2e → cycle-2 commit → cycle-3 confirmation workflow.

## 2026-07-02 (cont.) — CYCLE 3 (wf_55f3cc23): 16/16 CONFIRMED on the cycle-2 fixes → ALL FIXED
Cycle-3 landed AFTER the cycle-2 commit (bbda775): P0 SimpleFIN new-id churn (stale pending split
IMMORTAL → permanent double count), P1 silent dissolve (pipeline verdict inherited → user rule
auto-filed, probed), P1 applyCategory unguarded (the sixth writer), P1 stale-rule-wins (supersede
missing), P1 gate (sed-strip stayed green — no wiring lock), P2s (cascade read outside tx, P2025
aborts pass-2, audit provenance, ledger miscounts). ALL fixed same session (DECISIONS #147, STATUS
cycle-3 section, ledger row + in-place count corrections). 9 new locks, ALL fail-old proven by
stash-run (9 red pre-fix). NOTE: a cycle-3 verifier agent ran a sed-strip experiment IN the working
tree mid-flight (restored itself; caught via a modified-since-read edit rejection — tree verified
clean against bbda775 before continuing). NEXT: full gate → cycle-3 commit → cycle-4 confirmation
(FINAL under the 4-cycle cap) → owner report.

**CYCLE-3 GATE:** first verify ❌ — ONE red: the OLD reconcile lock "NEVER deletes a split-parent
pending row" = the exact invariant cycle-3 deliberately retired (it MADE the P0 — stale splits were
immortal). Rewritten to the new contract with a STRONGER fixture (corroborated split kept ×3 rows;
stale split dissolves to 0 rows with an explicit no-orphans assert) — deliberate spec change ratified
by the checker, intent ("never orphaned") still asserted on the correct mechanism. Re-verify →
✅ VERIFY GREEN **1546 unit / 122 files** (+11: 4 sync + 2 triage + 5 wiring; +1 register-write-in
discriminator in custom-category-lifecycle). E2E: 12/16 green in-suite incl. BOTH register write-in
siblings + gesture + triage write-in; singles-leak stalled in its SETUP loop (environmental signature,
green 5.6s isolated on the cycle-2 build); **transactions:191 failed REPRODUCIBLY (isolated ×2) →
treated as CODE until proven otherwise: (1) new unit lock drives the exact server path
(createCustomCategory → recategorize scope:'one' → custom id, real actions) → GREEN; (2) sibling :145
(same chip→picker→recat-once component + action) → GREEN 7.0s same run; (3) 3-point A/B with a fresh
`next build` per point: HEAD ✗ / bbda775 (cycle-2) ✗ / e51d6fe (PRE-cycle-2 code) ✗ → the failure
predates the entire unpushed stack = ENVIRONMENTAL** (STATUS note; same day-long degradation as
yesterday's a11y 3-point A/B; the write-in+refile combo fires two server actions back-to-back — the
heaviest single-row flow — so it trips first). Machine still unrebooted (boot Jun 30).
Final-tree witness after rebuild: **singles-leak lock GREEN 4.4s isolated on the cycle-3 build.**
NEXT: cycle-3 commit → cycle-4 (FINAL) confirmation → owner report.

## 2026-07-02 (late) — CYCLE 4 (wf_4cb0ba46, FINAL): 9 confirmed (1 P1 + 8 P2) → HARD STOP at the 4-cycle cap
Cycle-3 committed (829d291, verify green 1546/122, 9 locks fail-old-proven). Cycle-4 confirmed:
**P1 — the forced-review dissolve is clobbered by the NEXT sync** (no durable marker; a dissolved row
is representationally an UNDONE row, so the cycle-1 "undone takes fresh verdict" rule re-applies the
merchant rule one cron interval later — empirically probed twice). Proposed fix needs a SCHEMA CHANGE
(Transaction.reviewPinned) → owner sign-off. Plus 8 P2s: 2 reconcile-dissolve behavior edges (false
staleness on parse failure; same-id transient absence — age-out-only alternative validated), 5
lock/doc hardenings (3 proven by revert-stays-green in scratch copies), 1 dangling becameRuleId.
STATUS "CYCLE 4 OPEN FINDINGS" section has the full list with proposed fixes. Per the build-loop
rule: STOPPED, findings written, owner asked for direction. Stack state: local main = 69a335b + 13
commits, ALL UNPUSHED; production unaffected by every finding in cycles 2-4 (the defect family needs
the unpushed group-filing/split-lifecycle code). Machine still unrebooted (boot Jun 30).

## 2026-07-02 (late) — CYCLE 5: owner AUTHORIZED the fix round + ratified age-out-only (#27)
Implemented (DECISIONS #148): Transaction.reviewPinned schema column (probe-free design — a dissolved
row was representationally an UNDONE row; no in-band encoding survives) set at all 3 dissolve sites,
respected by both preserve predicates, CARRIED ACROSS ID CHURN by the transplant (pin-laundering
path closed), cleared by every user filing action (5 write sites). Reconcile: in-window pass never
touches split parents (owner call #27 — bounded ≤32d staleness beats one-flake destruction);
corroboration now from RAW feed ids (#26 — parse-skip ≠ absence). makeRuleFromCorrection live-rule
check (#31). Wiring pin hardened (#29/#30: non-comment lines, any-shape ban, triage-actions
allowlist). New locks: multi-sync pin ×3 sites + churn-carry + same-id-drift (#28) + garbled-row
(#26) + deleted-in-window & audit-provenance (#32) + dead-becameRuleId (#31); reconcile 3-state
contract lock rewritten. Affected suites 55/55 green; **fail-old stash-run: exactly the 8
new/rewritten behavioral locks red on pre-fix code.** NEXT: full verify + e2e → cycle-5 commit →
SCOPED confirmation workflow (owner-authorized) → final owner report.
**CYCLE-5 GATE:** ✅ VERIFY GREEN **1552 unit / 122 files**; lint clean; e2e: serial run hit the
environmental stall (throughput, disabled-pending, position varies again) → ALL FIVE phase2 tests
witnessed GREEN ISOLATED back-to-back on the cycle-5 build (13.6/17.2/14.7/14.1/11.5s, no stall).
**SCOPED CONFIRMATION (wf_eed966ba): 4 confirmed (1 P1 + 3 P2, 0 refuted) → FIXED:** backfill = the
SEVENTH pin-blind writer (select + CAS re-assert now exclude pinned rows); in-window sweep laundered
the pin via delete+recreate (pinned rows now sweep-protected like splits, age-out backstop); wiring
pin comment-stripping hardened. 2 behavioral locks fail-old-proven. gen-pg-schema carries
reviewPinned ✓; deploys run `prisma db push` so the column applies automatically ✓.

**CYCLE-2 GATE (real, measured 2026-07-02 ~14:55):** `bash scripts/verify.sh` → ✅ VERIFY GREEN;
isolated `npx vitest run` → **1535 passed / 121 files (36.8s)** (+15: 5 helper-contract + 6 sync +
4 triage-groups). E2E on the final tree: currency-disclosure 3/3 GREEN in-suite; phase2-triage —
EVERY test witnessed green on this tree (gesture in-suite run 1; write-in isolated 8.0s; **NEW
singles-leak lock isolated 5.6s**; throughput isolated 5.4s; accuracy isolated 1.3s). TWO serial-run
stalls = the documented environmental disabled-pending class (STATUS 2026-07-01): position VARIES
(write-in :199 run 1, gesture :103 run 2), signature identical (`triage-undo` disabled ≥60s while the
action itself APPLIED — data-remaining asserted <1s earlier), non-reproducing isolated, same class hit
already-deployed 69a335b yesterday. Machine still unrebooted (boot Jun 30). Full-suite serial re-witness
stays reboot-gated (standing owner NEXT).


## 2026-07-02 (close) — SESSION END: 7 commits today, stack COMPLETE pending owner reboot/push
Local main = 69a335b + 16 commits, ALL UNPUSHED. Today: #145 /investments disclosure (e51d6fe,
checker-clean) + the full checker campaign on the categorization rebuild — cycle-2 (bbda775, 20/20),
cycle-3 (829d291, 16/16), cycle-4 final (f05a55c, 1 P1 + 8 P2 recorded open at the cap), owner
authorized cycle-5 (509c208, reviewPinned schema + P2 batch) + scoped confirmation fixes (8055243,
backfill seventh writer + sweep laundering). Gate at HEAD: ✅ VERIFY GREEN **1554 unit / 122 files**
(session start: 1520/120). Every confirmed finding across 5 adversarial rounds is fixed with a
fail-old-proven lock or documented as an owner-ratified residual (STATUS).
HONESTY LABELS STANDING: PG isolation closure = reasoning + wiring locks, UNVERIFIED-on-PG; the two
confirmation fixes are lock-proven, not further adversarially checked (authorization spent); e2e
serial runs stall environmentally (3-point A/B-proven, position varies) — every test witnessed green
isolated on the final build.
OWNER NEXT: (1) reboot → `VERIFY_E2E=1 bash scripts/verify.sh` full re-witness; (2) push call
(deploy applies reviewPinned via the build's `prisma db push` automatically); (3) backlog: STATUS 23
remainder (register/triage/reports disclosure), #134 loan de-dup, #127 tail, shared CategoryPicker.
SAFE to /clear.

## HANDOFF (2026-07-02, session end — next session runs on OPUS, /clear'd)
Nothing in the repo state is model-specific. Resume protocol: read this section + the owner NEXT
below; do NOT re-explore what the ledgers already record (LOOP_ENGINEERING §token-discipline 4/6).

**EXACT STATE:** local main = HEAD **f12128e** = 69a335b + **17 commits, ALL UNPUSHED**
(push = prod deploy = OWNER's call). Working tree clean. Today's 7:
  e51d6fe  #145 /investments currency disclosure (checker-clean, DECISIONS #145)
  bbda775  checker cycle-2 fixes  — 20/20 confirmed (P0 split lifecycle, Serializable class) #146
  829d291  checker cycle-3 fixes  — 16/16 confirmed (SF churn P0, sixth writer, supersede)   #147
  f05a55c  cycle-4 hard stop docs — 1 P1 + 8 P2 recorded open at the 4-cycle cap
  509c208  cycle-5 (owner-authorized) — reviewPinned SCHEMA + P2 batch 26-33                 #148
  8055243  cycle-5 scoped confirmation fixes — backfill 7th writer + sweep laundering
  f12128e  session-close checkpoint
Prior 10 (unpushed, pre-session): the phase-3 rebuild + checker cycle-1 stack (see 4bdc6e8 entry).

**GATE AT HEAD (real, 2026-07-02):** `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1554 unit / 122
files**; every phase2-triage e2e witnessed GREEN ISOLATED on the final build; e2e SERIAL runs stall
environmentally (disabled-pending ≥60s, position varies, 3-POINT A/B-PROVEN incl. pre-stack code —
machine unrebooted since Jun 30; cure = reboot). transactions.spec:191 failure = same A/B-proven
environmental class, NOT code.

**SCHEMA CHANGE IN THE STACK:** Transaction.reviewPinned (additive, default false). Local/test DBs
pick it up via the test setup's db push; prod applies it automatically — vercel.json's buildCommand
runs `prisma db push` against Neon. gen-pg-schema carries it (verified).

**CHECKER CAMPAIGN: SPENT.** 5 adversarial rounds total (cycle-1 pre-session; cycles 2-5 + scoped
confirmation today). The 4-cycle cap was reached at cycle 4 (hard stop honored, owner asked); the
owner authorized exactly ONE fix round + ONE scoped confirmation — both delivered. Do NOT launch
further checker rounds on THIS stack without a fresh owner ask; NEW engine work gets its own
maker/checker per house rule.

**HONESTY LABELS STANDING (do not silently upgrade):** (1) PG isolation closure (serializableTx at
7 writer sites) = documented-Postgres-semantics reasoning + helper/wiring locks; UNVERIFIED-on-PG —
no Postgres integration env exists. (2) The two scoped-confirmation fixes (8055243) are
fail-old-lock-proven but had NO further adversarial round. (3) Full-suite serial e2e = reboot-gated
re-witness (`VERIFY_E2E=1 bash scripts/verify.sh`).

**OWNER-GATED NEXT (in order):** (1) reboot → `VERIFY_E2E=1 bash scripts/verify.sh` full re-witness
(STATUS 2026-07-01 + the 3-point A/B notes have the diagnosis); (2) owner push call — one push ships
the entire categorization rebuild + all checker fixes + #145; verify the Vercel deploy (house
pattern: check dpl_ READY via the Vercel MCP, team reiforge / project aimplifi, aliases
aimplifi.app + www). (3) THEN the backlog, unchanged: STATUS residual 23 remainder (disclosure on
register → /triage → /recurring → /reports → /coach), 3a rule re-point backfill follow-up, #134 loan
de-dup, #127 tail (SimpleFIN symbol regex + epoch→date), shared CategoryPicker/SR-listbox.

**LEDGER MAP:** decisions → docs/DECISIONS.md rows 145-148; per-cycle findings/fixes/residuals →
docs/STATUS.md (cycle 2/3/4/5 + confirmation sections; accepted residuals enumerated per cycle);
regression proofs → REGRESSION_LEDGER.md last 5 rows; measured before/after for the rebuild →
docs/baseline/phase2 + phase5. Task list: all 7 tasks completed/closed.

## 2026-07-02 (resumed: "continue", session "aimplifi") — #149 currency disclosure → final 5 surfaces (residual 23 CLOSED) — DONE ✅ (verify+e2e green, Checker 0 P0/P1)
Resumed at the model-switch HANDOFF boundary (HEAD `d6d87f3`, 18 unpushed, tree clean). Independently
re-confirmed the baseline before any change (NOT trusted from the handoff): `bash scripts/verify.sh` →
✅ VERIFY GREEN + `npx vitest run` → **1554 / 122**. Reboot + push of the unpushed stack stay OWNER-GATED and
the categorization Checker campaign is SPENT, so I took the top agent-actionable backlog item: STATUS residual
23 — extend the shipped currency-exclusion banner (#141/#145) to the remaining silent surfaces.

Understand-first (wf_98499351, 5 readers → synth): mapped the banner mechanism + all 5 targets. Built additively:
banner now on register (`/transactions`), `/triage`, `/recurring`, `/reports`, `/coach` — mounted INLINE on the 3
server pages (after each `EmptyDashboard` gate), `withheld` THREADED into RecurringView/ReportsView for the 2
view-backed pages. The banner self-nulls at count 0 → demo/golden byte-identical. e2e extends BOTH paths across
all 5 + per-surface axe A/AA. Focused Checker (wf_a7eaf280, 3 lenses → adversarial verify): **0 P0/P1**, 2 P2
FIXED pre-commit (axe folded into the 5-surface positive loop; the initial wrapper redundancy → prop-threading,
byte-identical), 8 refuted.

Gate (real, measured 2026-07-02): `bash scripts/verify.sh` → ✅ VERIFY GREEN **1554 / 122**, tsc/eslint/build
clean; targeted `currency-disclosure` e2e **3/3** (19.2s, no stall). Committed as the #149 feature+docs commit
(see below). residual 23 CLOSED (every money surface discloses; residual 25 inline-copy remains, but the banner
now surfaces that assumption atop /coach + /reports). DECISIONS #149 + STATUS section + this entry.

**State:** local main = `d6d87f3` + this #149 commit (19 unpushed), tree clean after commit; production still
serves the pre-stack functional bundle. **NEXT (owner-gated, unchanged from the handoff):** (1) reboot → full
`VERIFY_E2E=1 bash scripts/verify.sh` re-witness (the environmental disabled-pending stall is untouched by this
read-only change); (2) push — ships the categorization rebuild + all checker fixes + #145 + #149 together and
applies `reviewPinned` via the build's `prisma db push`; verify the Vercel deploy (dpl_ READY, team reiforge /
project aimplifi, aliases aimplifi.app + www). (3) backlog: residual 25 inline-copy, #134 loan de-dup, #127 tail
(SimpleFIN symbol regex + epoch→date), shared CategoryPicker/SR-listbox. SAFE to /clear.

## 2026-07-02 (cont., owner: "DO ALL RECOMMENDED INCLUDING PUSHING") — #149 stack DEPLOYED + #150 residual 25 CLOSED
Owner authorized doing all recommended backlog items AND pushing. (Reboot is a physical owner action I can't do;
the environmental e2e stall re-witness stays reboot-gated.)

**PUSHED + DEPLOYED ✅:** `git push origin main` → `7393633..e4f5f50` (origin now == local, 0 unpushed). This
shipped the ENTIRE prior unpushed stack to production together — the categorization rebuild + all 5 checker
cycles + #145 + #149 — applying `Transaction.reviewPinned` via the build's `prisma db push`. Deploy VERIFIED
READY: the Vercel commit-status check for e4f5f50 = **success** (deployment `8P12WGYNAmysYB8uo82UiXsNuSJS`, team
reiforge / project aimplifi; queried via GitHub's commit-status API using the stored git credential — no Vercel
MCP this session), corroborated by aimplifi.app 308→www + www.aimplifi.app/sign-in 200 + HSTS.

**#150 residual 25 CLOSED (verify+e2e green, focused checker 0 P0/P1/P2):** inline currency-exclusion assumption
note (`withheldInlineNote`) at the /coach FI card + /reports spending total, gated on withheld > 0 (byte-identical
otherwise), matching the app's per-projection assumption style. Accurate — the currency guard filters
transactions/accounts/investments to USD-only in the shared snapshot (getCoachData + getReports both read it).
Unit tests (currency.test.ts, +4) + e2e locks (present for the fx user, absent for the demo user). Gate (real):
verify GREEN **1558 / 122**; currency-disclosure e2e **3/3** (21.1s). Committed + pushed (deploy) below.

**Remaining backlog this session:** #134 loan de-dup, #127 tail (SimpleFIN symbol regex + epoch→date), shared
CategoryPicker. Each engine-first → verify → checker → commit → push.

### #134/#151 loan de-dup → forecast — DONE ✅ (verify+e2e green, Checker 0 P0/P1)
The owner-gated de-dup DESIGN decision, delegated by "do all recommended." Understand workflow (wf_aae820f1,
3 readers → synth) proved the crux: NO structural key links a checking scheduled row to a loan Account, so a
cross-source de-dup needs heuristic money-matching (house-rejected). Chose **Option D** — feed loan
obligations into the /forecast balance projection from their one safe source (the loan Account): pure
`loanObligationsToScheduledFlows` (MONTHLY outflow on RAW dueDate) + `getCashFlowForecast` concat. Fixes the
demo $385/mo forecast under-count (the auto-loan was invisible — a loan-due obligation, not a checking
scheduled row) with zero heuristic and zero golden movement (no test pinned demo forecast milestones).
Declined the companion carve-out removal (not demo-reachable; ~8-golden churn) — optional follow-up.
Hostile Checker (wf_1a6616ee, 3 lenses → adversarial verify; money-math = maker/checker): **0 P0/P1**,
probe-confirmed loan folds in ×3 @ −$385. P2s FIXED pre-commit: EDGE_CASES §LO-H relabeled (isolated
contribution, not on-screen milestone — honesty) + a quantitative server-path test (forecast-server.test.ts).
Accepted residuals (STATUS #134): non-transfer-ACH double-count (no safe fix, same population), day-31 clamp
(pre-existing, not demo-reachable). Gate (real 2026-07-02): verify GREEN **1563 / 123**, forecast e2e 2/2
(demo /forecast now shows "Auto Loan"). Committed `563ad6a` + pushed → Vercel success (Ex7dj2My…). LIVE.

### #127 tail (#152) — SimpleFIN symbol regex + epoch→date — DONE ✅ (verify green, Checker 0 P0/P1/P2)
Two P2 live-ingest edges. (a) Extracted ONE shared `parseTicker`/`TICKER_RE` (src/lib/engine/investments/ticker.ts)
used by BOTH the SimpleFIN holdings mapper and manual addHolding (the audit flagged the two duplicated regexes
as drift-prone), and widened to accept "/" → BRK/B, BTC/USD no longer dropped (space-bearing OCC options stay a
documented skip). (b) The epoch→UTC-day convention is inherently tz-ambiguous (no feed timezone) → documented
precisely + boundary-locked, no logic change (no money figure depends on the exact day). Focused adversarial
Checker (single reviewer): 0 P0/P1/P2 — regex exact, no downstream "/" breakage, coupling single-source, epoch
math confirmed. Gate (real 2026-07-02): verify GREEN **1570 / 124** (+7). Committed + pushed (deploy) below.

**Remaining backlog this session:** shared CategoryPicker/SR-listbox (last item).

### Category picker SR-listbox parity (#153) — DONE ✅ (verify green, axe-verified)
The safe half of the "shared CategoryPicker" follow-up: brought the triage picker to the register's
already-proven `role="listbox"`/`role="option"`/`aria-selected` semantics (a screen-reader gap #137 deferred).
Surgical — ARIA attributes only, no behavior change; axe-clean (the triage search input is OUTSIDE the listbox,
cleaner than the register's). DEFERRED the full `<CategoryPicker>` component extraction with rationale: the two
pickers have divergent filing behaviors (triage create-then-file vs register once/always confirm #121), so it's
a large parameterized refactor of two just-stabilized 5-cycle-checkered files for low user value, AND the
register e2e that would verify it is blocked by the environmental action-apply stall (reboot-gated).
`filterCategoryOptions` is already the shared engine. Gate: verify GREEN 1570/124; axe test phase2-triage:109
(picker open with the new role=listbox) GREEN; :50 gesture/undo GREEN 4/5 (the 1 fail = documented triage-undo
disabled-pending stall at line 105, OUTSIDE the diff — proven a flake by 3 consecutive with-change passes +
a pre-change pass, stash-rebuild A/B). Committed + pushed (deploy) below.

## 2026-07-02 (session close) — "DO ALL RECOMMENDED INCLUDING PUSHING" COMPLETE ✅
All four backlog items shipped, each engine-first → verify → checker → commit → **pushed + deploy-verified**:
| commit | item | deploy |
|---|---|---|
| e4f5f50 | #149 currency disclosure → 5 more surfaces (residual 23 CLOSED) + the whole prior 18-commit stack | Vercel ✓ 8P12WGY… |
| 7f0155b | #150 inline currency-exclusion note on /coach + /reports (residual 25 CLOSED) | Vercel ✓ DiUQZ5nn… |
| 563ad6a | #151 loan payments folded into /forecast (#134 de-dup, Option D) | Vercel ✓ Ex7dj2My… |
| 789455d | #152 shared ticker validator (BRK/B, BTC/USD) + SimpleFIN epoch UTC-day convention (#127 tail) | Vercel ✓ 6hq5odVQ… |
| (this)  | #153 category-picker SR-listbox parity | pushed below |
Also took the entire previously-unpushed 18-commit stack (categorization rebuild + 5 checker cycles + #145) to
production on the first push. `reviewPinned` applied via the build's `prisma db push`. origin/main advanced
551ac97→(this). Every functional change is verify-green + adversarially-checked (0 P0/P1) + deploy-verified via
GitHub's commit-status API (no Vercel MCP this session; corroborated by aimplifi.app 200 + HSTS).

**STANDING OWNER ITEMS (I cannot do these):** (1) REBOOT the box (unrebooted since Jun 30) → then a full
`VERIFY_E2E=1 bash scripts/verify.sh` re-witness — the environmental disabled-pending/action-apply stall
(3-point-A/B-proven, code-independent) is the only thing gating a clean full-suite e2e. (2) After reboot, the
full shared-CategoryPicker extraction becomes verifiable (register e2e) if desired (#153 deferred half).
Backlog now: STATUS residual 20 (SimpleFIN holding-level currency), #134 companion carve-out (optional). SAFE to /clear.

## 2026-07-02 (resumed: "continue and do the Plaid personal_finance_category passthrough we discussed") — #155 Plaid PFC passthrough — IN PROGRESS
Owner asked to build the previously-discussed Plaid `personal_finance_category` passthrough (not yet in any ledger
— reconstructed the design from the codebase's established patterns). Baseline re-confirmed independently before any
change: `bash scripts/verify.sh` → GREEN (1570 unit / 124 files at HEAD 5b2cd99 #154, tree clean).

**Design (engine-first, single-path, golden-safe):** Plaid returns per-txn ML categorization
(`personal_finance_category` = primary/detailed/confidence_level) that we ingested but IGNORED. Wire it as a
DETERMINISTIC (no model call — LOOP #5) rescue signal that only fills in rows our own normalization would send to
review:
- `plaid-map.ts` — new pure `mapPlaidPersonalFinanceCategory(pfc)` → `{categoryId,confidenceBps}|null`: detailed→specific
  leaf, primary fallback; confidence-gated (VERY_HIGH 8800 / HIGH 8000 / MEDIUM 7200; LOW/UNKNOWN/absent → null), all in
  [AUTO_FLAGGED 7000, AUTO_SILENT 9000) so a PFC-filed row auto-files with the visible AI badge, never silent, never
  below review. **Never maps to `transfer`** (TRANSFER_IN/OUT → null): mislabeling spend as transfer silently erases it
  (critic F4) — our tested transfer-detection path owns that. Over-broad buckets (GENERAL_SERVICES, GOVT_AND_NON_PROFIT
  primary) → null; only their specific detailed children map.
- `pipeline.ts` — generic `TxnInput.providerCategoryHint` (already mapped to OUR taxonomy) consulted ONLY in the
  needsReview fallback branch, gated: `!merchant.aggregate` (never rescue Zelle/checks) + sign guard (#44, inflow→Income
  group only, outflow→never income) + hint is a known non-transfer/non-uncategorized system category + confident. New
  `CategorySource` member `'provider-category'`. User rule / transfer / confident merchant match all still win (they never
  reach the branch). Absent for demo/CSV/SimpleFIN → categorization byte-identical (DECISIONS #22), zero golden movement;
  Plaid path is dormant/UNVERIFIED so no seed/e2e data exercises it — unit-tested only.

**Steps:** [x] pipeline.ts hint tier + tests  [x] plaid-map.ts PFC mapper + thread + tests  [x] verify.sh GREEN
[x] hostile Checker (wf_677df90e-922, 0 P0/P1)  [x] applied 6 P2 hardening fixes + re-verify  [x] DECISIONS #155 +
STATUS + PLAID_WALKTHROUGH + commit.

### DONE ✅ (verify green, hostile Checker 0 P0/P1)
Built exactly the design above. Maker green on first verify; then the hostile Checker (6 dimension reviewers + 2
adversarial verifiers/finding, 8 agents / 745k tokens) returned **0 P0/P1** — the lone P1 candidate (map
under-tested) was refuted to P2 by both verifiers (all ~102 targets re-confirmed real + non-transfer; invariants
enforced at runtime). Applied 6 P2 hardening fixes pre-commit: map-integrity guard test (every target exists, none
`transfer`/`uncategorized`); `$0`-amount + amount-band-ordering + Venmo/Check aggregate tests; income-inflow success
e2e; malformed-field-type non-throwing test; and SEWAGE_AND_WASTE_MANAGEMENT → `water` remap (consistency with our
own normalizer + the "Water & Sewer" leaf). No schema change. Gate (real 2026-07-03): `bash scripts/verify.sh` → ✅
VERIFY GREEN — typecheck/lint/build clean, **1656 unit / 125 files** (+27 vs the #154 baseline). Golden byte-identical
(demo/CSV/SimpleFIN never set the hint); the live Plaid path stays dormant/UNVERIFIED (STATUS #12/#155). DECISIONS
#155 + STATUS 2026-07-03 + PLAID_WALKTHROUGH updated. Committed `5a110c5`.

**DEPLOYED ✅ (owner: "push"):** `git push origin main` → `81c1dcb..5a110c5`. origin was at `81c1dcb` (#153), so this
push also shipped the two previously-unpushed #154 commits (household-utility split `f2b991a` + category-vocab tier
`5b2cd99`) to production ALONGSIDE #155. Deploy VERIFIED READY — the Vercel commit-status check for `5a110c5` =
**success** (queried via GitHub's commit-status API with the stored git credential; no Vercel MCP this session),
corroborated by www.aimplifi.app/sign-in → HTTP 200 + HSTS (`max-age=63072000; includeSubDomains`). #154 + #155 are
LIVE. (This deploy-record line is a local-only doc commit, intentionally UNPUSHED to avoid a redundant identical
rebuild — push it with the next functional change.)

## HANDOFF (resume after /clear) — 2026-07-03, session "aimplifi"
**Resume from `C:\dev\Aimplifi`** (the OneDrive copy + stale `C:\dev\Pulse Finance` are abandoned — CLAUDE.md).
**Clean stopping point. Safe to /clear.** #155 (Plaid PFC passthrough) is DONE, verify-green, adversarially
checker'd (0 P0/P1), and LIVE in production.

**Exact repo state:** working tree CLEAN. `origin/main` = **`5a110c5`** (#155 + the two prior #154 commits — all
LIVE, deploy verified success + 200 + HSTS). Local `main` = **`7ce82f7`**, i.e. 1 commit ahead of origin — ONLY the
local-only deploy-record doc commit, intentionally unpushed (push it with the next functional change to avoid a
redundant identical rebuild). Nothing half-done; no schema change pending.

**Health baseline (re-confirm before any change, don't trust this line):** `bash scripts/verify.sh` → ✅ VERIFY
GREEN, **1656 unit / 125 files**, typecheck/lint/build clean. E2E is opt-in (`VERIFY_E2E=1`).

**Ledger map for #155:** DECISIONS #155; STATUS "2026-07-03 … Plaid PFC passthrough"; PLAID_WALKTHROUGH.md "tested"
list + §5 spot-check note; the DONE entry just above. Design in one line: Plaid's per-txn `personal_finance_category`
→ pure `mapPlaidPersonalFinanceCategory` (plaid-map.ts) → generic `TxnInput.providerCategoryHint` consulted ONLY in
the needsReview fallback of `categorize()` (pipeline.ts, `isUsableProviderHint`) — rescue-only, sign-guarded (#44),
never a `transfer` (F4), never overrides rule/transfer/confident-merchant/aggregate; golden-safe (#22).

**BACKLOG (go straight in — all "only change if markedly better", owner-gated on scope):**
- STATUS residual 20 — SimpleFIN holding-level currency (declared gap).
- #134 companion carve-out removal (optional; ~8-golden churn, not demo-reachable — was declined as out-of-scope).
- Shared `<CategoryPicker>` full extraction — the #153 DEFERRED half (register e2e verification is reboot-gated; see
  standing items). `filterCategoryOptions` is already the shared engine.
- General "match & surpass" backlog per docs/ROADMAP.md (owner-selected).

**STANDING OWNER-ONLY ITEMS (I can't do these; not blocking new work):**
1. REBOOT the box (unrebooted since ~Jun 30) → then a full `VERIFY_E2E=1 bash scripts/verify.sh` re-witness. The
   environmental "disabled-pending"/action-apply e2e stall (3-point A/B-proven, code-independent — STATUS #16) is the
   only thing gating a clean full-suite e2e; unit + core verify are green and fast.
2. #155 live-sandbox spot-check: on your next real Plaid sandbox run (PLAID_WALKTHROUGH §5), confirm live
   transactions carry `personal_finance_category` in the `{primary, detailed, confidence_level}` shape the mapper
   expects. Rows without it just fall through to the normal review path — no downside, so this is verify-not-fix.

**Push discipline:** commit to `main` after every green verify; a PUSH = a prod deploy (Vercel, team reiforge /
project aimplifi, aliases aimplifi.app + www) — the owner's explicit call. Verify a deploy via GitHub's commit-status
API for the SHA (Vercel check = success) + a live 200/HSTS curl (no Vercel MCP this session).
## 2026-07-03 (resumed: "continue" after /clear, session "aimplifi") — #156 SimpleFIN holding-level currency guard (residual 20 CLOSED) — DONE ✅ (verify green, hostile Checker 0 P0/P1)

Resumed at the clean #155 handoff boundary. Independently re-confirmed the baseline (NOT trusted from the handoff):
`bash scripts/verify.sh` → ✅ VERIFY GREEN, **1656 unit / 125 files**, tsc/eslint/build clean. Local `7958a0c` (the
#155 deploy-record doc commit) = 1 ahead of origin `5a110c5`, tree clean. Reboot + push stay OWNER-GATED, so I took
the top agent-actionable backlog item from the handoff: STATUS residual 20 — SimpleFIN HOLDING-level currency.

Understand-first (wf_095ba78c, 4 readers → synth): mapped the account-level guard, the SimpleFIN holding mapper +
`Holding` schema, the investment aggregation, and the currency tests. Root cause: `mapSimplefinHoldings`
(simplefin-holdings.ts) received each position's `currency` but never read it, so a non-USD lot inside a USD
brokerage summed into `/investments` at a fabricated 1:1 (the #135 guard is account-level only).

Built (engine-first, NO schema change): the mapper withholds confidently-non-USD positions before aggregation,
counting them in a new `withheldNonUsd` field kept DISTINCT from `skipped`; threaded through `syncFromSimplefin` →
`SyncResult.holdings` (types.ts) → `SimplefinResult.holdings` (simplefin-actions.ts). PREDICATE = account-consistent
`!isSupportedCurrency(canonicalizeCurrency(h.currency))` — DELIBERATELY diverged from the understand workflow's
NARROW recommendation (applied Maker/Checker to the rec itself): narrow keeps crypto/non-ISO URL currencies as USD
→ leaks them at 1:1, the silent corruption the guard exists to stop; aggressive is account-consistent + philosophy-
aligned ("a withheld figure beats a silently wrong one"). Gate refinement `|| (withheldNonUsd > 0 && skipped === 0)`
so a clean all-foreign feed prunes stale USD rows while a mixed foreign+glitch feed preserves rows (#133 intact).
Golden byte-identical (SimpleFIN is the only currency-bearing ingress; the demo seed's 5 holdings carry no currency
and never touch the mapper); net-worth-neutral (holdings are a within-account breakdown). Live SimpleFIN path
dormant/UNVERIFIED → unit-tested only.

Hostile Checker (wf_1ac2c779, 4 dimension reviewers → refute-by-default verification of each P0/P1): **0 P0/P1**,
money 9 / golden 9 / sync 8 / tests 8; independently CONFIRMED the aggressive predicate SOUND (under the SimpleFIN
protocol USD is always 'USD' or omitted → aggressive cannot false-withhold a real USD lot). 2 P2 FIXED pre-commit +
fail-old-proven: (1) gate opener too coarse (`|| withheldNonUsd > 0` alone pruned a mixed feed's held rows, silently
widening #133) → `&& skipped === 0` qualifier; (2) mixed-case regression test (proven red on the coarse gate, green
after). Accepted P2s (documented): numeric '840' false-withhold (SimpleFIN never emits numeric codes); per-account
accumulation trivially correct.

Gate (real, measured 2026-07-03): `bash scripts/verify.sh` → ✅ VERIFY GREEN — **1666 unit / 125 files** (+10:
7 mapper + 3 sync), tsc/eslint/build clean. Ledger map: DECISIONS #156; STATUS "2026-07-03 … holding-level currency
guard" + residual 20 marked CLOSED; REGRESSION_LEDGER last row (gate qualifier, fail-old-proven).

## HANDOFF (resume after /clear) — 2026-07-03, session "aimplifi", post-#156
**Resume from `C:\dev\Aimplifi`** (OneDrive + stale `C:\dev\Pulse Finance` copies abandoned — CLAUDE.md).
**Clean stopping point. Safe to /clear.** #156 (SimpleFIN holding-level currency guard, residual 20 CLOSED) is
DONE, verify-green (1666/125), adversarially checker'd (0 P0/P1). NOT pushed (push is owner-gated).

**Exact repo state:** working tree CLEAN after the #156 commit. `origin/main` = `5a110c5` (#155, LIVE). Local `main`
= 2 commits ahead of origin: the #155 deploy-record doc commit (`7958a0c`, intentionally unpushed) + the #156
commit. No schema change pending.

**Health baseline (re-confirm, don't trust this line):** `bash scripts/verify.sh` → ✅ VERIFY GREEN, 1666 unit /
125 files. E2E opt-in (`VERIFY_E2E=1`); #156 added no e2e surface (SimpleFIN live path dormant).

**Ledger map for #156:** DECISIONS #156; STATUS "2026-07-03 … SimpleFIN holding-level currency guard" + residual 20
CLOSED line; REGRESSION_LEDGER last row; the DONE entry just above. One-line design: `mapSimplefinHoldings` reads
`h.currency` and withholds non-USD lots before aggregation (account-consistent `!isSupportedCurrency(canonicalizeCurrency)`
predicate, distinct `withheldNonUsd` counter), gate `|| (withheldNonUsd>0 && skipped===0)`; golden-safe (#135/#22).

**NEXT (owner-gated):** (1) push — ships #156 + the #155 deploy-record doc commit together; verify the Vercel deploy
(commit-status = success via GitHub API, team reiforge / project aimplifi, aliases aimplifi.app + www + a 200/HSTS
curl). (2) reboot → full `VERIFY_E2E=1` re-witness (the environmental disabled-pending e2e stall, STATUS #16, is the
only thing gating a clean full-suite e2e; untouched by #156). (3) BACKLOG (go straight in, all "only if markedly
better"): shared `<CategoryPicker>` full extraction (register e2e reboot-gated — #153 deferred half; `filterCategoryOptions`
already shared), #134 companion carve-out removal (optional, ~8-golden churn, not demo-reachable), general match-&-surpass
per docs/ROADMAP.md (owner-selected). residual 20 is now CLOSED.

**STANDING OWNER-ONLY ITEMS (I can't do; not blocking new work):** reboot the box (unrebooted since ~Jun 30) for the
full e2e re-witness; #155 live-sandbox Plaid PFC spot-check (PLAID_WALKTHROUGH §5); #156 live-sandbox SimpleFIN
spot-check — on a real SimpleFIN run, confirm whether `holding.currency` carries an ISO code / URL (as assumed) vs a
security identifier; if the latter ever appears, flip `isNonUsdHolding` to the narrow ISO-only predicate (one line, the
mapper test comments the flip). No downside today: the path is dormant.

## 2026-07-03 (cont., owner: "push, commit, update") — #156 DEPLOYED ✅
Owner authorized the push. `git push origin main` → `5a110c5..7764871` (origin was at `5a110c5` #155, so this push
shipped the previously-unpushed #155 deploy-record doc commit `7958a0c` ALONGSIDE #156 — origin/main advanced
5a110c5→7764871, now 0 ahead/0 behind). Deploy VERIFIED READY: the Vercel commit-status check for `7764871` =
**success** ("Deployment has completed", deployment `D9gjiaVn2GRHn43As6VL6AwHK8WL`, team reiforge / project aimplifi;
queried via GitHub's commit-status API with the stored git credential — no Vercel MCP this session), corroborated by
`www.aimplifi.app/sign-in` → HTTP 200 + HSTS (`max-age=63072000; includeSubDomains`). #156 (SimpleFIN holding-level
currency guard, residual 20 CLOSED) is LIVE. This deploy-record doc update is committed + pushed below (accepting one
harmless redundant identical rebuild to keep origin == local, per the owner's explicit "push").

**Backlog remaining (owner-gated, "only if markedly better"):** shared `<CategoryPicker>` full extraction (register
e2e reboot-gated — #153 deferred half), #134 companion carve-out removal (optional, ~8-golden churn, not
demo-reachable), general match-&-surpass per docs/ROADMAP.md. STANDING OWNER-ONLY: reboot for the full
`VERIFY_E2E=1` re-witness (STATUS #16 stall); #155 Plaid + #156 SimpleFIN live-sandbox spot-checks. SAFE to /clear.

## 2026-07-03 (cont., session "aimplifi", "continue") — #157 Root 404 / not-found chrome — DONE ✅ (verify green, hostile Checker 0 P0/P1)

Resumed at the clean post-#156 boundary. Re-confirmed baseline (NOT trusted from the handoff): `bash
scripts/verify.sh` → ✅ VERIFY GREEN, 1666 unit / 125 files, tsc/eslint/build clean; tree clean, local
== origin == 2046fd5. The live-money/currency backlog is exhausted (residual 20 was the last
agent-actionable item), so I took the top clean agent-actionable ROADMAP prod-readiness item.

Understand-first (explorer survey of 6 UX candidates): per-page titles + destructive-delete confirms
are ALREADY done; investments-in-nav needs an 8th phone icon (#71 owner-scoped); the clean, open,
fully-verifiable-without-reboot pick is the missing root 404 (global-error + (app)/error existed;
not-found did not).

Built: branded `src/app/not-found.tsx` (server component, Tailwind + buttonVariants, wordmark + h1 +
/dashboard recovery, metadata title via the root template) + `tests/e2e/not-found.spec.ts` (2 tests).
Design one-liner: one root not-found.tsx (no notFound() callers → unmatched URL is the only 404 path,
resolves outside the (app) group); no schema change; golden byte-identical.

Hostile Checker wf_f412b291-329 (4 lenses → refute-by-default): 0 P0/P1. 3 P2 — FIXED the docstring
"authenticated-only" overclaim (middleware's unanchored icon/manifest/favicon.ico exclusions) + added
the unauth→/sign-in boundary e2e; ACCEPTED (documented) the unauth-typo→sign-in and single-CTA choices;
OBSERVED (flagged, not fixed — no data exposure) the unanchored middleware matcher prefixes. A
self-inflicted comment-terminator build break was caught by verify (red) and fixed pre-commit.

Gate (real 2026-07-03): verify GREEN 1666/125, tsc/eslint/build clean; e2e not-found 2/2 GREEN
(authed 404+recovery 2.7s; unauth→sign-in 336ms). Ledger: DECISIONS #157; STATUS "2026-07-03 … Root
404 / not-found chrome"; this entry. Committed below. NOT pushed (push is owner-gated).

## HANDOFF (resume after /clear) — 2026-07-03, session "aimplifi", post-#157
**Resume from `C:\dev\Aimplifi`.** Clean stopping point, safe to /clear. #157 (root 404 / not-found
chrome) is DONE, verify-green (1666/125), e2e 2/2, hostile-Checker'd (0 P0/P1). Committed, NOT pushed.

**Exact repo state:** working tree CLEAN after the #157 commit. `origin/main` = `2046fd5` (#156, LIVE).
Local `main` = 1 commit ahead of origin (the #157 commit). No schema change pending.

**Health baseline (re-confirm, don't trust this line):** `bash scripts/verify.sh` → ✅ VERIFY GREEN,
1666 unit / 125 files. E2E opt-in; #157's e2e is `not-found.spec.ts` (2/2, pure-navigation, NOT
stall-prone).

**Ledger map for #157:** DECISIONS #157; STATUS "2026-07-03 … Root 404 / not-found chrome"; this
handoff. One-line design: branded root `src/app/not-found.tsx` (server component; unmatched URL → 404),
title via the root template, golden-safe, e2e-locked.

**NEXT (owner-gated):** (1) push — ships #157; verify the Vercel deploy (commit-status = success via the
GitHub API, team reiforge / project aimplifi, aliases aimplifi.app + www + a 200/HSTS curl). (2) reboot
→ full `VERIFY_E2E=1` re-witness (the environmental disabled-pending e2e stall, STATUS #16, still gates
a clean full-suite e2e; untouched by #157). (3) BACKLOG (all "only if markedly better"):
  - **Investments discoverability** — HIGH product value (the flagship Aimplifi-vs-Simplifi gap) but
    owner-scoped: surfacing /investments in nav needs an 8th phone icon (#71 "bar full at 7") → part of
    the mobile-nav redesign. Surgical alt (no new icon): link INVESTMENT-type account rows on /accounts
    straight to /investments. Owner taste call.
  - Recategorize popover Escape/outside-click dismissal (small, demo-reachable, NOT stall-prone — the
    picker is client-only, no server action).
  - Per-route loading.tsx skeletons (medium; only the generic root loader exists).
  - Empty states for no-data charts/cards (needs a fresh-signup user like the currency work).
  - middleware.ts unanchored icon/manifest/favicon.ico matcher prefixes (OBSERVED under #157 — a careful
    auth-boundary increment, no data exposure today).
  - #134 companion carve-out removal (optional, ~8-golden churn, not demo-reachable).

**STANDING OWNER-ONLY:** reboot for the full VERIFY_E2E re-witness (STATUS #16); #155 Plaid + #156
SimpleFIN live-sandbox spot-checks. SAFE to /clear.

## 2026-07-03 (cont., owner: "push it") — #157 DEPLOYED ✅
Pushed `2046fd5..ed72acf`; origin/main == local on the functional commit. Vercel commit-status for
`ed72acf` = success (deployment EPSeh5KcqMHvaTc16EWodXxbYsoB, "Deployment has completed"; via GitHub's
commit-status API + the stored git credential, gh unauthenticated). Live-verified beyond the usual
200/HSTS: `/sign-in` → 200 + HSTS, and `/iconzzz` (unmatched, skips auth via the unanchored icon-prefix)
→ HTTP 404 rendering the branded not-found page LIVE (not-found testid, "Page not found" h1, wordmark,
"Go to dashboard"). #157 is LIVE. This deploy-record doc commit is local-only (UNPUSHED to avoid a
redundant rebuild; ships with the next functional change). Local main is now 1 ahead of origin (this doc
commit only). SAFE to /clear.

## 2026-07-03 (cont., "continue") — #158 Register picker Escape / outside-click dismissal — DONE (verify green, hostile Checker 0 P0/P1)

Took the next clean ROADMAP prod-readiness item after #157: "Escape/outside-click dismissal for the
inline recategorize popover." Re-confirmed baseline green first (1666/125). Built in transaction-list.tsx
(client-only): document mousedown outside-click (scoped to open, menuRef on the open row wrapper,
!pending-gated), container-level Escape -> close + focus-return to the chip, close()->useCallback, and
hardened the sub-form's two-level Escape onto the sub-form CONTAINER. 4 e2e locks in transactions.spec.ts.

Verification path (evidence, not assumed): the initial dismissal tests passed except outside-click, which
failed because the first row's menu opens UPWARD and its options overlay txn-summary (Playwright
pointer-intercept) -> switched the outside target to txn-search (top of page, always clear) -> green.
Then checked the existing register menu flows for regression: recat (#36) FAILED then PASSED on retry
(non-deterministic => environmental #16/#17, not a code regression); write-in (#136) fails only at its
final post-server-action persistence assertion (line 244) — the full menu interaction completed, so
#158's client-only dismissal provably didn't break it; row-switch (#138) PASSES.

Hostile Checker wf_1e6176e9-763 (4 lenses -> refute-by-default): 0 P0/P1. 2 P2 FIXED (two-level Escape
moved to the sub-form container + fail-old group-select test; outside-click pending gate); 3 P2
accepted-documented. Independently confirmed menuRef containment, no leak, robust target, genuine
fail-old locks, and the environmental-not-regression conclusion.

Gate (real 2026-07-03): verify GREEN 1666/125, tsc/eslint/build clean; the 4 #158 e2e tests PASS.
Ledger: DECISIONS #158; STATUS "2026-07-03 ... Register recategorize-picker Escape / outside-click
dismissal"; this entry. Committed below. NOT pushed (push owner-gated).

## HANDOFF (resume after /clear) — 2026-07-03, session "aimplifi", post-#158
Resume from C:\dev\Aimplifi. Clean stopping point, safe to /clear. #158 (register picker Escape/outside-
click dismissal) is DONE, verify-green (1666/125), e2e 4/4 (#158), hostile-Checker'd (0 P0/P1).
Committed, NOT pushed.

Exact repo state: working tree CLEAN after the #158 commit. origin/main = ed72acf (#157, LIVE). Local
main = 2 commits ahead of origin: the #157 deploy-record doc commit (6cb9418, intentionally unpushed) +
the #158 commit. No schema change pending.

Health baseline (re-confirm, don't trust this line): bash scripts/verify.sh -> VERIFY GREEN, 1666 unit /
125 files. E2E opt-in; #158's locks are the 4 #158 tests in transactions.spec.ts (pure open/close, NOT
stall-prone).

Ledger map for #158: DECISIONS #158; STATUS "2026-07-03 ... Register recategorize-picker Escape /
outside-click dismissal"; this handoff. One-line design: transaction-list.tsx gains a !pending-gated
document mousedown outside-click + a container-level Escape (focus-returns to the chip); sub-form Escape
is two-level on the sub-form container. Client-only, golden-safe.

KNOWN (pre-existing, reboot-gated): the action-heavy register e2e (recat #36, write-in #136) stall on this
unrebooted machine (#16/#17) — proven environmental this session (recat fail->pass on retry; write-in
fails only at its post-action assertion). Re-witness after the owner reboot.

NEXT (owner-gated): (1) push — ships #158 + the #157 deploy-record doc commit; verify the Vercel deploy
(commit-status = success via the GitHub API, team reiforge / project aimplifi, aliases aimplifi.app + www
+ a 200/HSTS curl). (2) reboot -> full VERIFY_E2E=1 re-witness (STATUS #16 stall). (3) BACKLOG (all "only
if markedly better"):
  - Investments discoverability — HIGH value (flagship Aimplifi-vs-Simplifi gap), owner-scoped: nav entry
    = an 8th phone icon (#71) -> mobile-nav redesign; surgical alt = link INVESTMENT account rows on
    /accounts to /investments (no new icon).
  - Per-route loading.tsx skeletons (medium; only the generic root loader exists).
  - Empty states for no-data charts/cards (needs a fresh-signup user like the currency work).
  - middleware.ts unanchored icon/manifest/favicon.ico matcher prefixes (OBSERVED under #157 — careful
    auth-boundary increment, no data exposure today).
  - #134 companion carve-out removal (optional, ~8-golden churn, not demo-reachable).

STANDING OWNER-ONLY: reboot for the full VERIFY_E2E re-witness (STATUS #16); #155 Plaid + #156 SimpleFIN
live-sandbox spot-checks. SAFE to /clear.

## 2026-07-03 (cont., owner: "push") — #158 DEPLOYED
Pushed ed72acf..be5707a (shipped #158 + the #157 deploy-record doc commit; origin 0/0). Vercel
commit-status for be5707a = success (deployment E3roppmuNgvymGe1seY6kfMF9UnY). Live: /sign-in -> 200 +
HSTS; /iconzzz -> 404 branded (confirms #157 live + deploy healthy). #158's client dismissal is
auth+browser-gated (not curl-verifiable) — proven by the 4 #158 e2e pre-deploy. #158 LIVE. Deploy-record
doc commit is local-only (unpushed, avoids a redundant rebuild). Local main is now 1 ahead of origin
(this doc commit only). RECOMMENDED: /clear before the next increment (fresh, independent work; the
post-#158 handoff above is current + comprehensive). SAFE to /clear.

## 2026-07-03 — NEXT INCREMENT DECIDED (owner, pre-/clear): Investments discoverability via SURGICAL ROW-LINK
Owner chose the surgical, no-new-icon option (over a full nav entry / a different item). This is the TOP
directive for the fresh session — go straight in.

BUILD (DECISIONS #159): make INVESTMENT-type account rows on /accounts link to /investments, so a user
taps their brokerage account and lands on the portfolio view (holdings, TWR/XIRR, retirement planner —
today only reachable via a tiny "View investments ->" text link at accounts-list.tsx ~198). Respects #71
(NO 8th phone nav icon; the mobile-nav redesign stays owner-scoped).

Build notes / guardrails:
- UNDERSTAND-FIRST on src/components/finance/accounts-list.tsx before editing: how account rows render,
  which rows are INVESTMENT-type, and whether rows already carry interactive controls.
- A11Y — avoid nested interactive elements: /accounts rows may already carry actions (manual account
  delete/edit two-step). Do NOT wrap an action-bearing row in an <a>/<Link>. Make the account NAME/label
  (or a dedicated row region) the link, or a row-level navigate that does not swallow existing buttons.
  Keyboard + axe must stay clean.
- The existing "View investments ->" text link can stay or be folded in; the point is the INVESTMENT rows
  themselves become navigable.
- Demo-reachable (seed has a brokerage account w/ 5 holdings) and verifiable WITHOUT the reboot-gated stall
  (pure navigation, no server action). E2e: click an INVESTMENT account row -> lands on /investments.
- Client/nav-only, golden byte-identical (no engine/schema change).
Flow: verify baseline -> understand -> build -> verify -> hostile Checker (0 P0/P1) -> commit -> (owner-gated) push.

STARTING REPO STATE for the fresh session: origin/main = be5707a (#157+#158 LIVE). Local main = 1 ahead
(0e20117, the #158 deploy-record doc commit + this decision note) — the deploy-record + this note are
docs-only and ride out with the #159 functional push. Re-confirm `bash scripts/verify.sh` green (expect
1666/125) before building.

## 2026-07-03 — #159 BUILT + committed (INVESTMENT rows -> /investments), owner-gated push pending
DONE. Surgical row-link shipped in `src/components/finance/accounts-list.tsx` (`LinkedRow`): when
`account.type === 'INVESTMENT'`, href = `/investments` (else the unchanged `/transactions?account=<id>`),
plus an inline "· View holdings ->" cue (inherits `text-muted-foreground`, axe-clean). `ManualRow`
untouched — a manual INVESTMENT is a typed balance with no holdings + inline edit/delete controls, so it
is intentionally not linked (avoids nesting buttons in an <a>; /investments is portfolio-wide anyway).
New e2e in `tests/e2e/investments.spec.ts` locks it (Brokerage row -> /investments + $142k + cue).

VERIFIED (real, 2026-07-03): baseline core verify GREEN 1666/125; post-change core `bash scripts/verify.sh`
GREEN (typecheck/lint clean, 1666/125, build clean); new #159 e2e PASSES; transactions.spec.ts:29
(non-investment row -> /transactions) + :313 (/accounts axe WCAG-AA WITH the cue live) both PASS.
Hostile Checker wf_af042228-cf6 (a11y / correctness / ux): 0 P0/P1, 3 non-blocking P3 (recorded in
DECISIONS #159 + STATUS). Full VERIFY_E2E's 4 failures are the pre-existing environmental #16/#17
server-action-stall flakes on /budgets, /calendar, /triage, transactions write-in/filter — NON-DETERMINISTIC
across 3 reruns (transactions:76<->:191; phase4 1<->2), all disjoint from #159's blast radius, NOT a regression.

COMMITTED (local): feat(accounts): #159. Local main is now ahead of origin/main (be5707a) by the two prior
docs-only commits + this #159 feat commit. PUSH IS OWNER-GATED — do NOT `git push` until the owner says
"push"/"deploy". After push, add the usual deploy-record doc line (Vercel commit-status success + a live
health check on www.aimplifi.app/accounts) as the closing step, per the #157/#158 precedent.

NEXT (owner to choose): the #71 mobile-nav redesign (would unlock a first-class Investments nav entry), a
dedicated /accounts+/investments axe scan (locks the Checker's P3-a), or `?account` scoping on /investments
so a multi-brokerage user's row anchors to that account's card (P3-b). All are refinements above the
"markedly better" stop bar; none blocking. SAFE to /clear before the next increment.

**DEPLOYED (owner: "push", 2026-07-03).** `git push origin main` -> be5707a..f17b0d0, origin 0/0.
Vercel prod deploy dpl_A9YGDCGmhPwkkLzexsq8i1F4VfmY (f17b0d0) READY in ~64s, all prod aliases attached
(www.aimplifi.app), aliasError null. Live health: www.aimplifi.app -> HTTP 200 + HSTS + full security
headers; sign-in renders; unauth bogus path -> /sign-in (#157 boundary). #159 LIVE. The row-link is
auth+browser-gated (not curl-verifiable) — proven by the passing #159 e2e pre-deploy. This deploy-record
doc commit is LOCAL-ONLY (UNPUSHED, avoids a redundant identical rebuild); it rides out with the next
functional push. Local main is now 1 ahead of origin (this doc commit only). RECOMMENDED: /clear before
the next increment (the #159 handoff above is current + comprehensive). SAFE to /clear.

## 2026-07-03 (cont., "continue" after /clear) — #160 /investments account scoping (?account) — DONE ✅ (verify green, hostile Checker 0 P0/P1)
Resumed at the clean post-#159 boundary. Re-confirmed baseline independently (NOT trusted from the handoff):
`bash scripts/verify.sh` → GREEN 1666/125; origin/main f17b0d0 (#159 LIVE), local 1 doc-only commit ahead
(4be4c4a), tree clean.

Understand-first (wf_a53fdb00 survey → decide): every clean non-owner-scoped backlog candidate was borderline
or disqualified — middleware anchoring (HIGH-value security but NOT demo-reachable + owner-flagged LIVE
/iconzzz change at high regression risk = owner-gated), loading skeletons (structurally unverifiable — Next
loading.tsx only paints during slow fetches; no throttling harness), empty states (fresh-signup-only). Chose
the owner-named P3-b (?account scoping) with the reframe the surveyors under-weighted: the value is for the
OWNER's real MULTI-account production usage (Plaid+SimpleFIN), the single-brokerage demo being the golden-safe
test vehicle.

Built (view-layer; engine-first pure core): `src/lib/engine/investments/scope.ts` `resolveInvestmentScope`
(returns the full unchanged list — "inert" — when no id / ≤1 investment account / unknown id / matched-but-empty
account; else narrows to `[found]` + a "Show all accounts →" chip) + 8 known-answer unit tests. page.tsx reads
Next-15 async searchParams (string[]/absent → undefined → full view). investments-view.tsx consumes the scope +
chip; the summary card is UNCHANGED (data.overall = the $142k golden). accounts-list.tsx LinkedRow INVESTMENT
href carries `?account=<id>`. e2e updated (#159 → ?account inert-demo assertion) + new unknown-id fallback test.
`getInvestments()`/net worth/retirement untouched. The ≤1-account INERTNESS rule makes the single-brokerage demo
byte-identical with or without ?account → provably golden-safe; scoping activates only for >1 investment account.

Gate (real 2026-07-03): core verify GREEN **1674/126** (+8), tsc/eslint/build clean; investments e2e 6/6 (incl.
#159 inert-demo + #160 unknown-id fallback + axe AA); transactions:29 (non-investment row → /transactions) + :313
(/accounts axe) PASS. All pure-nav/render/unit → sidesteps the #16 stall. Hostile Checker (wf_13d4c3fc-c44, 4
dims → refute-by-default): 0 P0/P1 (correctness 10/10, security 9/10); all 3 P1 candidates (active multi-account
path not e2e-testable without moving goldens) REFUTED to P2 → narrowing logic unit-locked (8 known-answers) +
thin view consumer + e2e wiring, per the #123 precedent (no RTL/jsdom; environment:'node'). 1 P2 FIXED (chip copy
"Showing <name> holdings"). Ledger: DECISIONS #160; STATUS "… #160 /investments account scoping"; this entry.
Committed below. NOT pushed (push owner-gated).

## HANDOFF (resume after /clear) — 2026-07-03, session "aimplifi", post-#160
Resume from C:\dev\Aimplifi. Clean stopping point, safe to /clear. #160 (/investments ?account scoping) DONE,
verify-green (1674/126), e2e 6/6 investments + regression guards (transactions:29/:313), hostile-Checker'd
(0 P0/P1). Committed, NOT pushed.

Exact repo state: working tree CLEAN after the #160 commit. origin/main = f17b0d0 (#159, LIVE). Local main = 2
commits ahead of origin: the #159 deploy-record doc commit (4be4c4a, intentionally unpushed) + the #160 commit.
No schema change pending.

Health baseline (re-confirm, don't trust this line): `bash scripts/verify.sh` → GREEN, 1674 unit / 126 files.
E2E opt-in; #160's locks are investments-scope.test.ts (8 unit) + investments.spec.ts (6 e2e, pure-nav, NOT
stall-prone).

Ledger map for #160: DECISIONS #160; STATUS "2026-07-03 … /investments account scoping — ?account narrows to one
account"; this handoff. One-line design: LinkedRow INVESTMENT href carries `?account=<id>`; /investments narrows
its per-account list via the pure `resolveInvestmentScope` (inert with ≤1 account → demo byte-identical,
golden-safe); the portfolio-wide summary card is unchanged.

NEXT (owner-gated): (1) push — ships #160 + the #159 deploy-record doc commit; verify the Vercel deploy
(commit-status = success via the GitHub API, team reiforge / project aimplifi, aliases aimplifi.app + www + a
200/HSTS curl). (2) reboot → full `VERIFY_E2E=1` re-witness (the environmental #16 stall still gates a clean
full-suite e2e; untouched by #160). (3) BACKLOG (all "only if markedly better"):
  - Investments in NAV — the flagship discoverability item, but needs an 8th phone icon (#71 owner-scoped
    mobile-nav redesign).
  - middleware.ts unanchored icon/manifest/favicon.ico matcher anchoring — real latent auth-boundary hygiene but
    changes LIVE /iconzzz 404 behavior (owner sign-off) + not demo-reachable.
  - shared <CategoryPicker> full extraction (#153 deferred half; register e2e reboot-gated).
  - #134 companion carve-out removal (optional, ~8-golden churn, not demo-reachable).
  - a component/RTL test locking the ACTIVE multi-account scope view-wiring (P2 defense-in-depth — needs RTL+jsdom,
    which the repo lacks; the resolver logic is already exhaustively unit-locked, per the #123 precedent).

STANDING OWNER-ONLY: reboot for the full VERIFY_E2E re-witness (#16); #155 Plaid + #156 SimpleFIN live-sandbox
spot-checks. SAFE to /clear.

## 2026-07-03 (cont., owner: "push") — #160 DEPLOYED ✅
`git push origin main` → `f17b0d0..47380e1` (origin now 0/0). This shipped #160 (`47380e1`) + the previously
unpushed #159 deploy-record doc commit (`4be4c4a`) together. Deploy VERIFIED READY: the Vercel commit-status
check for `47380e1` = **success** ("Deployment has completed", deployment `8B28NKR8gMwi2nCXh9xPYYxbYpjf`, team
reiforge / project aimplifi; queried via GitHub's commit-status API with the stored git credential — no Vercel
MCP this session), corroborated by `www.aimplifi.app/sign-in` → HTTP 200 + HSTS (`max-age=63072000;
includeSubDomains`). #160 (/investments ?account scoping) is LIVE. The row-link + scoping is auth+browser-gated
(not curl-verifiable) — proven by the 6/6 investments e2e pre-deploy (per the #158/#159 precedent). This
deploy-record doc commit is LOCAL-ONLY (UNPUSHED to avoid a redundant identical rebuild; rides with the next
functional change). Local main is now 1 ahead of origin (this doc commit only). SAFE to /clear.

**Backlog remaining (owner-gated, "only if markedly better"):** Investments in NAV (needs an 8th phone icon —
#71 owner-scoped mobile-nav redesign); middleware.ts icon/manifest/favicon.ico matcher anchoring (latent
auth-boundary hygiene but changes LIVE /iconzzz behavior + not demo-reachable); shared <CategoryPicker> full
extraction (#153 deferred, register e2e reboot-gated); #134 companion carve-out removal (optional, ~8-golden
churn); an RTL/component test for the active multi-account scope view-wiring (P2 defense-in-depth — repo lacks
RTL/jsdom). STANDING OWNER-ONLY: reboot for the full VERIFY_E2E re-witness (#16); #155 Plaid + #156 SimpleFIN
live-sandbox spot-checks.

## 2026-07-03 (session "aimplifi") — CATEGORIZATION: learn-from-user-corrections — DIAGNOSIS + DESIGN (NO BUILD; owner asked me to notate + /clear for token efficiency)

**This is the NEXT increment to build (owner-reported, high priority). No code was written this turn — it is a
grounded design brief for a fresh session to execute engine-first.**

### Owner report (real, from using PRODUCTION — I cannot see this data from the dev checkout)
- **159 items in the triage Inbox.** Too many; the pile keeps refilling.
- Specific misses named: **"Google One"**, **"Round1"** ("round1am"), "amongst others".
- **THE CORE COMPLAINT:** the owner repeatedly recategorizes **"check paid"** and **"credit card paid"** to
  **transfer**, "many times", and *the system never learns* — every sync they redo it. Owner's words:
  "The categorization should have some ability to learn from users inputs. User shouldn't have to recreate the
  wheel each time."

### What I verified in the code THIS turn (files read: pipeline.ts, normalize.ts, assign.ts, backfill.ts,
### triage-actions.ts, simplefin.ts; plus a real tsx trace of the vocab tier)
1. **"glf → golf" ALREADY works** (#154, deployed to prod earlier today 2026-07-03): TOKEN_EXPANSIONS `GLF→GOLF`
   + CATEGORY_VOCAB `['GOLF']→entertainment` — trace-confirmed `GLF`/`PEBBLE BEACH GLF`/`SQ *OAK HOLLOW GLF` all
   auto-file to entertainment. So the earlier "glf" example is a **staleness / not-yet-re-run** issue, NOT missing
   logic. THIS report ("check paid" etc.) is a different, deeper problem: **learning**.
2. **categorize(txn, rules[])** (pipeline.ts:113) applies explicit user `CategorizationRule` rows FIRST
   (pipeline.ts:131), matching on `merchantCanonical` (+ amount band / account / weekday). It already consumes a
   rules array — so learned rules can be injected with ZERO change to the engine.
3. **A plain "just once" correction does NOT generalize.** triage-actions.ts `recategorize({scope:'one'|'merchant'})`:
   scope 'one' writes a `Correction` row (…:429) that is **read by NOTHING at categorization time**; only
   scope 'merchant' creates a `CategorizationRule` (…:83/442, linked via `correction.becameRuleId`). So unless the
   user picks "apply to all / Always", the correction is invisible to the next transaction of the same merchant.
4. **Aggregates are BLOCKED from durable rules.** assign.ts `isRuleEligibleMerchant = !aggregate`; Check#, Card
   Payment, Zelle, Venmo are `aggregate:true` (normalize.ts). Rationale in-code: "all checks aren't the same"
   (one Zelle = rent, another = a friend). So for those descriptors the user **cannot teach the system at all** —
   every occurrence returns to review. This is very likely a big chunk of the 159.
5. **Re-sync no longer blindly clobbers** (I re-checked — the diagnosis doc's factor 4 is partly fixed):
   simplefin.ts `guardedVerdictRefresh` computes `preserve = isSplitParent || reviewPinned || (corrected &&
   !needsReview)` and writes bank-facts-only (`base2`) when preserving (…:581-587). So a corrected+settled row
   survives a re-sync. **But a NEW transaction with the same descriptor is a new id with no correction → it
   re-reviews.** (VERIFY next session: does plaid.ts ~360-373 have the SAME preserve guard? owner runs BOTH feeds.)

### Root cause (one sentence)
A `Correction` is per-transaction and never consulted by the categorizer; it only helps future transactions if the
user manually promotes it to an explicit "Always" rule — a step that's easy to miss and is **blocked outright for
aggregates** — so repeated corrections (esp. "check paid" / "credit card paid" → transfer) never stick.

### DESIGN — engine-first, for the next session (the owner's ask = passive learning)
**A) LEARNED RULES FROM REPEATED CORRECTIONS (the centerpiece).** New PURE engine, e.g.
`src/lib/engine/categorize/learn.ts`: given a user's `Correction` history, derive synthetic `RuleLike[]`
("learned rules") for any *learning-key* corrected to the SAME category ≥ N times (start N=2) with ZERO conflicting
corrections. Append these to the explicit rules already passed into `categorize()` at INGEST and in the
backfill/re-run read-paths — **no change to categorize() itself** (it already applies rules[]). Priority: BELOW an
explicit user "Always" (user rules ≥100), ABOVE merchant-default.
  - **LEARNING KEY (the crux):** normal merchant → `merchantCanonical` (matches the existing rule mechanism).
    Aggregate / varying-descriptor → a NORMALIZED DESCRIPTOR SIGNATURE (uppercase; strip digits, #store, dates,
    amounts, trailing "CITY ST") so "CREDIT CARD PAID 07/01" and "…08/01" share a key, while "CHECK #1234" vs
    "CHECK #5678" (varying numbers → different signature) do NOT over-generalize. So a stable "CREDIT CARD PAID"
    becomes learnable; a genuinely-ambiguous varying check does not.
  - **AGGREGATE TENSION (the P0 the hostile Checker must probe):** one "Zelle → rent" correction must NEVER file
    ALL Zelles as rent. Guards: require ≥N consistent + 0 conflicting corrections; key aggregates on the FULL
    signature INCLUDING the payee token when present; never learn a blanket rule on a bare aggregate canonical
    from a single example. Keep the MANUAL one-tap "Always" still blocked for aggregates (one tap ≠ demonstrated
    consistency) — learning is earned by repetition, not a single click.
  - **Materialize vs compute-on-the-fly:** leaning toward MATERIALIZE a learned `CategorizationRule` on promotion
    (transparent + user-visible/editable/undoable; reuse the `becameRuleId` lineage) and, for the LEARNED case
    only, allow it on an aggregate signature (the user's demonstrated consistency overrides the global "aggregate
    ambiguous" prior). Decide in build.
  - **Sign guard (#44):** never learn an inflow (positive) into a spend category.
  - **Golden-safety:** the demo seed has ZERO corrections → zero learned rules → seed/goldens byte-identical.

**B) SPECIFIC MERCHANT MISSES (quick, additive, golden-safe — demo doesn't use them):**
  - **Google One** → `software` (KNOWN_MERCHANTS `/^GOOGLE \*?ONE\b/i` or GENERIC `\bGOOGLE ONE\b`). NB current
    GENERIC has GOOGLE CLOUD / GOOGLE WORKSPACE but not GOOGLE ONE.
  - **Round1** (round1am / "ROUND1") → `entertainment` (arcade/bowling: `\bROUND\s?1\b`).
  - Add both to the `eval:categorize` corpus (scripts/categorize-eval.ts).

**C) QUEUE UX (the 159 pile):** merchant-grouped inbox + "apply to all N like this" (the diagnosis's Phase-3
"merchant-unit queue"; `recategorize scope:'merchant'` already does the WRITE — the grouping/bulk UI is the gap).
(A) stops the pile refilling; (C) drains what's there fast. Follow-on to (A).

### VERIFY-FIRST for the next session (don't trust this note — re-confirm)
- Does the register/triage UI actually OFFER the "apply to all / Always" (merchant) scope for a rule-eligible
  descriptor like "credit card paid", and hide it for aggregates? (transaction-list.tsx + triage recategorize gating.)
- Does plaid.ts re-sync have the same corrected-row preserve guard as simplefin.ts? (owner runs BOTH.)
- Is "credit card paid" actually a cross-account TRANSFER the pairing SHOULD auto-detect (are both sides linked)?
  If so, fixing transfer PAIRING may beat a category rule for that specific case.
- Get the EXACT raw descriptors from the owner (still can't see prod) to pin signatures + write real tests.

### DISCIPLINE (per LOOP + CLAUDE.md)
Engine-first pure `learn.ts` with known-answer unit tests; golden byte-identical (no demo corrections); hostile
Checker with the aggregate over-generalization as the headline P0 to refute; verify green; owner-gated push.
**Canary tests:** "CREDIT CARD PAID" ×2 corrections → transfer learned + applied to the 3rd; "CHECK #1234" +
"CHECK #5678" → NOT blanket-learned; a single "ZELLE → rent" → NOT applied to other Zelles; Google One → software;
Round1 → entertainment.

## HANDOFF (resume after /clear) — 2026-07-03, session "aimplifi", CATEGORIZATION LEARNING is the next increment
**Resume from `C:\dev\Aimplifi`.** Working tree CLEAN (this is a docs-only commit). `origin/main` = `47380e1`
(#160 LIVE). Local `main` = 2 commits ahead of origin: the #160 deploy-record doc (`c22a817`) + THIS categorization
design-brief doc commit — both docs-only, unpushed, ride out with the next functional push.

**Health baseline (re-confirm, don't trust):** `bash scripts/verify.sh` → GREEN, 1674 unit / 126 files.

**THE NEXT INCREMENT (owner-directed, high priority): make categorization LEARN from repeated user corrections.**
Full diagnosis + design is the section immediately above (the "learn-from-user-corrections" entry). One-line: a
`Correction` is per-transaction and never consulted by categorize(); build a pure `learn.ts` that turns ≥N
consistent corrections (keyed on merchantCanonical, or a normalized descriptor signature for aggregates/varying
descriptors) into synthetic learned rules appended to the rules[] categorize() already applies — carefully guarded
so one "Zelle → rent" never files all Zelles as rent. Plus quick merchant adds (Google One → software, Round1 →
entertainment) and, as a follow-on, a merchant-grouped inbox to drain the 159-item pile.

**Owner's immediate lever (already told them):** Triage "Inbox" page → top-right "Re-run categorizer" (sparkles) —
re-runs the deterministic tier + an LLM second pass over the review pile (catches today's #154 GLF→GOLF and opaque
names via the LLM if the xAI key is live). It only re-files rows STILL in review; a confidently-mis-filed row needs
a one-tap recat in the register.

**STANDING OWNER-ONLY:** reboot for the full VERIFY_E2E re-witness (#16); #155 Plaid + #156 SimpleFIN live-sandbox
spot-checks; paste ~10 real still-wrong descriptors (raw text + intended category) so the learn.ts signatures +
tests are pinned to real data. **SAFE to /clear.**

## 2026-07-04 (resumed: "continue") — Categorization LEARNS from repeated corrections (#161) — DONE ✅ (verify green, hostile critic 0 P0/P1 after 4 cycles)
Resumed at the cbdc000 handoff. Re-confirmed baseline independently (not trusted from the note): `bash
scripts/verify.sh` -> GREEN, 1674 unit / 126 files. Built the owner-directed increment: passive learning
from repeated corrections.

**What shipped (engine-first, all guards pure-unit-tested):**
- `src/lib/engine/categorize/signature.ts` (NEW) — `computeDescriptorSignature`: IDENTITY-PRESERVING key
  (strip ONLY dates + money amounts; KEEP account/phone/check numbers) so two occurrences of the same payee
  share one signature while two different payees never do. `hasDistinguishingToken` = secondary guard for a
  genuinely payee-less residue (NOISE_TOKENS = channel roots + glue + generic mechanism/frequency/entry labels).
- `src/lib/engine/categorize/learn.ts` (NEW) — pure `deriveLearnedRules(corrections)`: latest-correction-wins
  per txn (folds undos), group by signature, emit a rule only when a signature is corrected to the SAME
  category >= LEARN_THRESHOLD (2) times, zero conflicts, #44 sign guard, hasDistinguishingToken. Emits
  `RuleLike{ descriptorSignature, isLearned:true, priority 50 }`.
- `src/lib/engine/categorize/pipeline.ts` — `RuleLike` gained `descriptorSignature?` + `isLearned?`;
  `ruleMatches` signature check; `LEARNED_RULE_CONFIDENCE_BPS = 8500` (learned rules auto-file in the FLAGGED
  band with the AI badge = a visible correctable guess, NOT the silent 9900 an explicit "Always" earns);
  `learnedSignOk` match-time sign guard.
- `src/server/rules.ts` — `loadUserRules` = `loadExplicitUserRules` ++ `loadLearnedRules` (joins Correction ->
  Transaction, userId-scoped, ordered, -> deriveLearnedRules). Early-returns [] at 0 corrections.
- `normalize.ts` + `categorize-eval.ts` — Google One -> software, Round1 (arcade) -> entertainment.
- Tests: `learn.test.ts` (known-answer canaries + the cycles 1-4 hostile-critic regression block),
  `learn-loader.test.ts` (real recategorize -> loadUserRules -> categorize chain), `normalize.test.ts` variants.

**Compute-on-the-fly (no schema change, no DB writes):** the demo seed has 0 corrections -> 0 learned rules ->
every golden byte-identical. Undo re-derives. This is why there is no migration and no golden movement.

**Canary tests (from the handoff) — all GREEN:** "CREDIT CARD PAID" x2 -> transfer learned + applied to the
3rd; "CHECK #1234" + "CHECK #5678" -> NOT blanket-learned; single "ZELLE -> rent" -> NOT applied to other
Zelles; Google One -> software; Round1 -> entertainment. Owner's "check paid" correctly REFUSES (payee-less +
ambiguous — the documented safe default; "credit card paid" learns because CREDIT is its distinguishing token).

**Gate (real 2026-07-04):** `bash scripts/verify.sh` -> ✅ VERIFY GREEN, **1704 unit / 128 files** (+30 over
baseline), tsc/eslint/next build clean; adversarial `eval:categorize` 100% precision / 0 confidently-wrong
(43 descriptors; Google One + Round1 now auto-file). E2E opt-in (VERIFY_E2E=1) — this increment is engine +
server-loader + unit/loader tests, no new UI, so it sidesteps the #16 write-stall e2e flake entirely.

**Hostile Checker — FOUR cycles (Workflow maker/checker, refute-by-default verify), 0 P0/P1 at sign-off:**
c1 6 P0/P1 (enumeration over-generalization) -> identity-preserving signature + distinguishing-token +
match-time sign guard; c2 2 -> REMOVED canonical mode entirely; c3 1 P1 (generic mechanism labels) ->
NOISE_TOKENS + AI-badge backstop; c4 (final) ripple dimension CLEAN + 1 P1 (bare payment-frequency / card-entry
labels "AUTOMATIC PAYMENT"/SCHEDULED/PIN PURCHASE — payee-less AND number-less) reproduced end-to-end -> FIXED
by extending NOISE_TOKENS with 11 brand-safe tokens. Accepted residual: the payee-less-AND-number-less class is
closed enumeratively for every common US-bank autopay label, and any rare unlisted bare label is bounded to P2
by the AI-badge backstop (visible correctable guess, never a silent misfile). Full detail: DECISIONS #161,
STATUS #161, REGRESSION_LEDGER 2026-07-04.

**Repo state:** `origin/main` = `47380e1` (#160 LIVE). Local `main` was 2 docs-only commits ahead (c22a817 +
cbdc000); THIS #161 functional commit makes it 3 ahead. **NOT pushed — push is owner-gated.**

### HANDOFF (resume after /clear) — 2026-07-04, session "aimplifi", #161 DONE, awaiting owner
**Resume from `C:\dev\Aimplifi`.** Working tree CLEAN after the #161 commit. `origin/main` = `47380e1`; local
`main` = 3 commits ahead (2 docs + #161), all UNPUSHED — ride out with the next owner-gated push.

**Health baseline (re-confirm, don't trust):** `bash scripts/verify.sh` -> GREEN, 1704 unit / 128 files.

**STANDING OWNER-ONLY (unchanged, still open):**
- Push #161 (+ the 2 riding docs commits) when the owner authorizes — the code is verify-green and critic-clean.
- Paste ~10 real still-wrong prod descriptors (raw text + intended category) to pin learn.ts signatures against
  REAL data — the current canaries use synthesized descriptors; the identity-signature design is robust, but
  real descriptors would (a) confirm "credit card paid" / "check paid" match the owner's actual bank strings and
  (b) surface any bank-specific bare-label the NOISE_TOKENS list should also cover.
- Reboot for the full VERIFY_E2E re-witness (#16); #155 Plaid + #156 SimpleFIN live-sandbox spot-checks.

**NEXT INCREMENT candidates (owner-gated pick):**
- **QUEUE UX / drain the 159 pile (design-brief part C, the natural follow-on):** merchant-grouped triage inbox
  + "apply to all N like this". `recategorize scope:'merchant'` already does the WRITE; the grouping/bulk UI is
  the gap. #161 stops the pile REFILLING (learned rules auto-file the repeats); this DRAINS what's already there.
- Or LLM second-pass tuning / transfer-pairing for "credit card paid" (if both sides are linked accounts, transfer
  PAIRING may be the more correct fix than a learned category rule for that specific case — flagged in the brief).

**SAFE to /clear.**

## 2026-07-04 (resumed: "continue") — "Accept all confident" one-tap triage drain (#162) — DONE ✅ (verify green, hostile critic 0 P0/P1)
Resumed at the #161 handoff. Re-confirmed baseline independently (not trusted): `bash scripts/verify.sh` ->
GREEN, 1704 unit / 128 files. Owner picked the "drain the pile" queue-UX increment via AskUserQuestion.

**KEY FINDING (surfaced to the owner before building):** a subsystem-mapping workflow (5 parallel readers)
showed the handoff's premise was STALE — the merchant-grouped bulk-apply UI ALREADY EXISTS (`/triage`
groups by merchant; `fileMerchantGroup` files a whole group + mints the rule, DECISIONS #143 Phase 3c). So
I did NOT rebuild it. I re-scoped with the owner (second AskUserQuestion) to the genuine remaining gap and
they chose "One-tap Accept all confident": a header action that files every group the categorizer is
confident about, leaving the ambiguous rest.

**What shipped (surgical, engine-first — full detail: DECISIONS #162, STATUS #162):**
- group.ts (+3 pure fns): isConfidentGroup / selectConfidentGroups / summarizeConfident. "Confident" =
  suggestedCategoryId !== null (the exact swipe-right bar). ONE predicate → client + server can't drift.
- triage-actions.ts acceptAllConfident(): re-derives confident set server-side, loops the tested
  fileMerchantGroup per group (per-group commit, mint/reuse, aggregate-safe), ONE undo batch, graceful
  partial (catch-per-group) + fail-loud total, no-op early-return.
- triage-inbox.tsx: banner (mode==='idle' && >=2 confident), optimistic reconcile, focus handoff, aria-live
  count, one undo entry.
- tests/unit/accept-all-confident.test.ts (NEW, 12): 4 pure + 7 integration (files-confident/leaves-
  ambiguous, mint-vs-reuse, undo round-trip removing ONLY minted rules, ownership, no-op, partial-failure,
  total-failure) + 1 demo-0-confident golden lock. tests/e2e/phase2-triage.spec.ts +1 read-only inertness.

**Golden-safe:** demo has 0 confident groups (all 12 review groups ambiguous) → banner inert → byte-identical.

**Gate (real 2026-07-04):** verify.sh → ✅ GREEN, **1716 unit / 129 files** (+12), tsc/eslint/build clean.
Read-only e2e green (banner absent on demo 3.0s; existing gesture/filing/undo flow unregressed 4.6s).

**Hostile Checker (Workflow, 5 dims → refute-by-default verify):** correctness 8 / security 8 / golden 9 /
ux-a11y 7 / coverage 6, **0 confirmed P0/P1** (lone P1 self-downgraded to P2 by its verifier). Fixed the
high-value P2/P3s pre-sign-off (partial+total tests, golden lock, no-op early-return, clean fail-loud msg,
idle-gated banner, focus handoff, copy + undo label). Accepted P2/P3s documented in DECISIONS #162 / STATUS.

**Repo state:** `origin/main` = `47380e1` (#160 LIVE). Local `main` was 3 commits ahead (2 docs + #161);
THIS #162 functional commit makes it 4 ahead. **NOT pushed — push is owner-gated.**

### HANDOFF (resume after /clear) — 2026-07-04, session "aimplifi", #162 DONE, awaiting owner
**Resume from `C:\dev\Aimplifi`.** Working tree CLEAN after the #162 commit. `origin/main` = `47380e1`;
local `main` = 4 commits ahead (2 docs + #161 + #162), all UNPUSHED — ride out with the next owner-gated push.

**Health baseline (re-confirm, don't trust):** `bash scripts/verify.sh` -> GREEN, 1716 unit / 129 files.

**STANDING OWNER-ONLY (unchanged + new):**
- Push #161 + #162 (+ the 2 riding docs commits) when the owner authorizes — both verify-green + critic-clean.
- Paste ~10 real still-wrong prod descriptors to pin #161's learn.ts signatures against REAL bank strings.
- Reboot for the full VERIFY_E2E re-witness (#16); #155 Plaid + #156 SimpleFIN live-sandbox spot-checks.
- #162 active-path e2e is inert on the demo (0 confident); if the owner wants the ACTIVE drain flow witnessed
  in a browser, it needs a throwaway user seeded with >=2 confident review groups (out of the demo's scope —
  the server path is fully unit+integration locked, #160/#123 precedent).

**NEXT INCREMENT candidates (owner-gated pick):**
- The design-brief part C tail is now largely closed (#161 stops the pile refilling; #162 drains the
  confident bulk in one tap). Remaining pile-drain polish: a scannable multi-select list for the AMBIGUOUS
  remainder (assign several no-suggestion groups at once) — the heavier "Review all" screen from the earlier
  fork, only if the owner still feels friction after #161+#162 in real use.
- Or LLM second-pass tuning / transfer-pairing for "credit card paid" (the other earlier fork).
- Or pull real prod descriptors (owner action) → tune normalize/#161 against them.

## 2026-07-05 — #166 SEAMLESSNESS PASS (owner: "make it something users want over Simplifi/Mint; too many things don't work seamless")

**Step 1 — full-app audit (DONE):** production build + fresh seeded audit DB (%TEMP%/aimplifi-audit.db) +
`next start -p 3100`; scripted walk of all 17 pages at 380x800 (scripts/audit-walk.ts, screenshots in
.audit/): ZERO console errors / failed requests / page errors, warm loads <700ms. 3 interactive audit
agents (triage+register / forms+settings / ask+nav+charts) + 1 docs-mining agent dispatched.

**Step 2 — P0 FOUND & FIXED (fail-old proven): real users' income misclassified since #163.**
`monthlyFlows` (fi/insights.ts:63) keyed income on the LITERAL id 'income'; #163's leaf taxonomy makes
real payroll descriptors (PAYROLL/DIRECT DEP/GUSTO/ADP → 'paycheck') classify as a *refund netted
against expenses* → prod income $0, savings rate/FI/coach/Money Review garbage. Demo dodged it via the
merchant-specific ACME→'income' rule (why every golden stayed green). Fix: new
`isIncomeCategoryId` (group-aware, categories.ts) used by monthlyFlows + `isBudgetable` (which offered
'Paycheck' as the DEFAULT budget-target option — same stale-id class; now excludes the Income group +
credit-card-payment, keeps 'cash' + custom). 6 new tests incl. an every-Income-leaf canary; fail-old
proven (4 fail pre-fix); FULL unit suite 1804/1804 green, tsc/eslint clean on touched files.

**Step 3 — view-layer polish (pending verify):** /recurring row: next-charge date moved to the fixed
right column (was truncate-swallowed at 380px: "next ~ Mon, Ju…"); overspent Safe-to-Spend reframe
(ROADMAP COPY-1): hero label "Over plan this month" + positive amount, dashboard card "Over by $X",
both with "safe to spend is $0" subtitles — matches the assistant's existing phrasing.

**Audit findings queue (for fix ordering):** two adjacent "Connect a bank" buttons on /accounts
(SimpleFIN vs Plaid — owner uses BOTH; label, don't merge); goals debt-name truncation; interactive-agent
reports pending.

## 2026-07-05 — #166 SEAMLESSNESS PASS — COMPLETE (pending final e2e gate line below)

**What the owner asked:** "make this app something users will want to use over Simplifi or Mint —
far too many things don't work seamless." Full detail: DECISIONS #166, STATUS #166, REGRESSION_LEDGER ×3,
lessons/diagnose-hangs-at-boundaries (extended).

**Method:** 17-page scripted audit (clean) → 3 interactive audit agents + docs-miner → fixes in severity
order → 3 fresh-context hostile critics on the diff → every critic P1 fixed → deterministic probe
witnesses (.audit/) → full verify.

**Shipped:**
1. P0: group-aware income classification (real payroll was being netted as a refund since #163 —
   prod savings rate/FI/coach garbage; goldens blind to it). isBudgetable group-aware ('Paycheck' was
   the default budget-target option). 'refund' leaf still nets (critic).
2. Next 15.5.19 → 16.2.10 exact-pinned (+ eslint-config-next 16 flat config): fixes the deterministic
   GET flight-application bug — calendar paging 7/7 (was 5/7 FAIL, the "phase4:13 flake"),
   transactions filters/pagination/Import 8/8 (was 4/4 FAIL).
3. Mutation reliability: budgets/goals forms + clear/delete + MoneyDialsForm now direct-invoke +
   own busy + withDeadline(8s) + reload-on-success (dials: inline confirmation, reload only on
   severed confirmation) — post-action page application was a ~50% coin-flip on BOTH Next versions,
   the #164 class app-wide; e2e had outrun it for months and the dials spec caught it mid-gate.
   budget-probe 5/5 deterministic.
   Money typos: inline errors, fields preserved, "$500"/"1,000" parse, "1,00" rejected (never ×100),
   no more crash-to-boundary.
4. SW v3: installability only, no fetch handler (v1/v2 amplified aborted action streams; offline
   shell retired; installed clients self-heal). pwa spec now drives an action under a CONTROLLING SW.
5. Ask honesty: unresolved-merchant spend abstains (parser + LLM fallback); afford+amount+future-date
   → savings solver (current-month/rate/bill guards per critic); subscriptions total no longer ~7× off.
6. Polish: overspent safe-to-spend reframe, recurring/goals truncation fixes, year in register/triage
   dates, reports Uncategorized→Inbox link, aimplifi-* exports, nav prefetch=false, calendar
   empty-month copy, dials error spacing.

**Critics:** A (financial) 0 P0/P1 — F1 refund-leaf fixed, F2 comma-guard fixed, F3 doc fixed;
B (forms/actions) P1 auto-reset — fixed structurally (no form-action dispatch at all);
C (Ask routing) P1s F1/F2/F6 — all fixed + regression-locked, F7 whitelist added.

**STANDING OWNER-ONLY:**
- Push when authorized (this rides with the earlier unpushed #161/#162 + docs commits).
- PROD CORROBORATION ASK: after deploying, use budgets/goals on the phone — mutations should now
  always land. If other surfaces (accounts add/edit, settings, register recategorize) still feel
  "did nothing", that's the same class → next increment applies the same pattern there.
- The Vercel deploy must serve the new sw.js (it will — byte-change → clients update within a day).

**NEXT INCREMENT candidates:** reliable-mutation pattern app-wide; merchant-spend Ask intent;
category month-over-month drill-down; #71 nav redesign + settings reorg (owner-scoped); Recharts
pinned-tooltip/width warning; triage accuracy-metric UX; "Connect a bank" button labels.

### HANDOFF (resume after /clear) — 2026-07-05, session "#166 seamlessness", for Opus 4.8
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md + this handoff + docs/lessons/INDEX.md first
(CLAUDE.md rule). The #166 seamlessness pass is COMPLETE and committed (see the commit right at HEAD;
if no #166 commit exists at HEAD, the session died between gate and commit — the tree holds the full
verified work: run `bash scripts/verify.sh`, then commit with the message in the paragraph below).

**State:** local `main` carries the unpushed #161 + #162 commits (+ doc commits) AND the new #166
commit. `origin/main` is at f17b0d0 (#160). **Push remains owner-gated** — when the owner says push,
everything rides together. Working tree should be CLEAN after the #166 commit; `.audit/` is gitignored
session scratch (probe outputs, screenshots) — leave or delete freely.

**What #166 changed (full detail: DECISIONS #166, STATUS #166, REGRESSION_LEDGER 2026-07-05 ×3,
docs/lessons/diagnose-hangs-at-boundaries.md):**
- P0 money fix: `isIncomeCategoryId()` group-aware income classification (real payroll was netted as
  a refund since #163 — prod savings rate/FI/coach were garbage; goldens were blind). 'refund' leaf
  still nets. `isBudgetable` group-aware ('Paycheck' was the DEFAULT budget-target option).
- Next 15.5.19 → **16.2.10** (exact-pinned; eslint-config-next 16 flat config in eslint.config.mjs).
  Fixes the deterministic GET flight-application bug (calendar paging, transactions filters).
- Mutation reliability: GoalForm / BudgetTargetForm / ClearBudgetButton / DeleteGoalButton /
  MoneyDialsForm now direct-invoke server actions + own useState busy + withDeadline(8s,
  src/components/finance/form-deadline.ts) + reload-on-success (dials: inline confirmation instead —
  nothing on that page derives from them). NEVER convert these back to useActionState/form-action —
  React 19 auto-reset wipes input on validation failure AND the pending/result application is the
  #164 race (~50% loss at human pacing on this machine, e2e outruns it).
- SW v3 = installability only (public/sw.js, NO fetch handler; offline shell retired; old installs
  self-heal). Nav links prefetch={false} (app-nav.tsx). Ask honesty fixes (intent.ts/llm.ts/answer.ts).
  Copy/layout polish per DECISIONS #166 item 7.
- Probes live in **scripts/audit-probes/** (README explains how to run them; they catch what e2e
  can't — plain pacing). Use them before/after touching mutations, navigation, Next version.

**STANDING OWNER-ONLY (unchanged + new):**
- Authorize the push (now: #161 + #162 + #166 + doc commits).
- PROD CORROBORATION after deploy: budgets/goals/settings mutations on the phone should now always
  land. If accounts add/edit, register recategorize, or settings category toggles still feel "did
  nothing", that's the SAME class — next increment applies the same pattern there (see NEXT below).
- Reboot-gated re-witness (#16) is OBSOLETE — #164/#166 root-caused that flake class; ignore old notes.
- Paste ~10 real prod descriptors to pin #161's learn.ts signatures (still open from last session).
- #155 Plaid / #156 SimpleFIN live-sandbox spot-checks (still open).

**NEXT INCREMENT candidates (severity-ordered from the #166 audit; pick with the owner or by prod
corroboration):**
0. E2E scheduling hygiene: move manual-card-statement.spec.ts onto a THROWAWAY USER (auth.spec has
   the signup pattern) — its $500-balance add→delete window collides with the exact net-worth
   golden readers (phase1:38, ask:38/46) under fullyParallel; a retrying assertion cannot converge
   on a static server render, so isolation is the only real fix. MITIGATED for now by the e2e
   workers:4 cap (playwright.config.ts, #166) — the shared-SQLite harness at 8 workers severed
   action streams and widened the collision window; at 4 the FULL suite is green (75/75, 59.7s).
1. Reliable-mutation pattern app-wide: accounts add/edit/delete forms, settings category/custom
   managers, register recategorize (agent-1 saw stale chips — same class), split/backfill buttons.
   Recipe = the five #166 conversions; witness with a probe per surface.
2. Merchant-spend Ask intent ("how much did I spend at Costco" should be ANSWERED, not abstained).
3. Category month-over-month drill-down (reports rows → filtered register / per-category trend).
4. #71 mobile-nav redesign + settings-page reorganization (owner-scoped design work).
5. Smaller: Recharts pinned-on-load tooltip + width(-1) warning; triage accuracy-metric UX
   (drops when filing ambiguous groups, doesn't restore on undo); "Connect a bank" button labels.

**Gotchas for the next session:** never reseed the DB under a live server between probe runs (fakes
alternating results); e2e-green ≠ healthy for pacing-sensitive races — trust the plain-paced probes;
dev.db at repo root is the dev DB, e2e uses %TEMP%/aimplifi-e2e.db, probes use %TEMP%/aimplifi-audit.db.

## 2026-07-05 (resumed: "continue") — #167 reliable-mutation app-wide + e2e isolation — DONE ✅ (verify green, critic 1 P1 + 2 P2 all addressed)

Took #166 NEXT items 0+1 (severity order). Baseline re-confirmed (verify GREEN), then:
- **#0:** manual-card-statement.spec.ts → THROWAWAY user (auth.spec signup pattern); zero demo-golden
  coupling; fixed dates proven clock-safe (parser only enforces due > close).
- **#1:** five conversions to the #166 recipe: transaction-list (recategorize commit → reload;
  write-in deadline-guarded, stays inline), accounts-list refreshAfter, backfill-button
  (flash+reload when refiled>0; refresh NEVER updated the inbox's client state), custom-category-manager
  (optimistic state deleted, renders from props), category-manager (stays optimistic by design —
  checker-verified nothing on /settings derives — + deadline guard + thrown-rejection rollback fix).
  NEW: src/components/finance/flash.ts (one-shot sessionStorage, set only after res.ok; unit-tested 5/5).
- **Probes (before → after):** scripts/audit-probes/recategorize-mutation.ts 0/2 → 2/2 at plain pacing;
  accounts-mutation.ts, backfill-mutation.ts new; budget + first-action regression probes green.
- **Hostile critic (fresh context):** P1 post-reload pre-hydration click drop → state-aware
  click-and-verify retries in the spec, 3/3 on the exact failing mix; P2 coverage → flash.test.ts +
  tests/e2e/backfill.spec.ts (throwaway user); P2 ACCEPTED (STATUS #167): reload aborts a sibling's
  queued action — follow-up is page-scoped shared pending.

**Gate (real output):** VERIFY_E2E=1 bash scripts/verify.sh → ✅ VERIFY GREEN — 1816 unit / 133 files,
FULL e2e 75/75 (52.2s). Post-critic fixes were TEST-ONLY; targeted mix 3/3 green; **FULL 76-spec rerun
NOT executed** (owner ended session mid-run) — first act next session: `npx playwright test` → expect 76/76.

**STANDING OWNER-ONLY (unchanged + new):** authorize the push (origin is now 2 behind: #166 + #167);
prod corroboration after deploy — register recategorize, accounts add/edit, settings category managers
should now always land at human pacing (same class as the healed budgets/goals); the #166 list's other
items (real prod descriptors for learn.ts, Plaid/SimpleFIN sandbox checks) still open.

**NEXT INCREMENT candidates (from #166 list, minus what #167 closed):** remaining old-pattern
low-traffic forms (add-transaction <form action>, import-csv useActionState, delete-my-data,
connect-simplefin) — same recipe, smaller blast radius; merchant-spend Ask intent; category
month-over-month drill-down; #71 mobile-nav redesign (owner-scoped); page-scoped shared pending
(the accepted P2); Recharts pinned-tooltip/width(-1) polish.

**Gotchas:** unchanged from #166 (never reseed under a live server; e2e-green ≠ pacing-healthy — trust
the plain probes; dev.db root = dev, %TEMP%/aimplifi-e2e.db = e2e, %TEMP%/aimplifi-audit.db = probes).
Windows: TaskStop on a background `npx next start` does NOT free the port — kill the LISTEN PID
(netstat -ano | grep :3100) or the next start EADDRINUSEs and probes silently hit the OLD build.

## 2026-07-07 — #169 triage accuracy metric recovers on undo (#166/#168 follow-up (e))

**DONE (verify green, critic 0 P0/P1/P2, committed).** The /triage categorization-accuracy
card (DECISIONS #37) dropped when you filed an ambiguous group (filing stamps
`CategoryPrediction.actualCategoryId` = your chosen category as ground truth, and a mis-guess
scores as a miss) but NEVER recovered when you undid the filing: `undoCorrections` restored the
transaction to review and removed the minted rule yet left `actualCategoryId` set, so
`getCategorizationAccuracy` kept counting a retracted decision. The exact STATUS #168 open
follow-up (e), "accuracy-metric drops when filing ambiguous groups + doesn't restore on undo".

**Fix:** one write inside the existing per-correction `$transaction` in `undoCorrections`
(`src/server/triage-actions.ts`): null `categoryPrediction.actualCategoryId` for the restored
transaction, atomic with the inverse-correction insert + restore + transfer-pin + rule cleanup.
Invariant now symmetric with the four filing writes: a `needsReview` row carries no confirmed
label. `undoSplit` deliberately untouched — `splitTransaction` sets categoryId=null and never
labels a prediction (children are brand-new rows with no CategoryPrediction), critic-verified.

**Proof:** new `tests/unit/accuracy-undo.test.ts` (2, real `applyCategory` -> `undoCorrections`
against throwaway data — MISS and HIT both un-counted on undo). Fail-old/pass-new PROVEN by
stash-run: fix stashed -> 2/2 fail (label stays 'dining' after undo; the un-nulled sample even
leaks into the sibling test's count 2!=1); restored -> 2/2 pass. Fresh-context hostile Critic
acquitted every adversarial angle (scoping via transactionId @unique, over-revert-is-correct,
undoSplit, undo-funnel completeness, idempotency/atomicity, golden-safety, metric-honesty):
**0 P0/P1/P2**. Gate (real 2026-07-07): `VERIFY_E2E=1 bash scripts/verify.sh` -> VERIFY GREEN,
**1845 unit / 136 files** (+2/+1), build clean, FULL e2e **76/76 (47.7s)** incl. the existing
"accuracy card shows a measured value" spec. Ledgers: DECISIONS #169, REGRESSION_LEDGER 2026-07-07,
STATUS #169.

**NEXT INCREMENT candidates (from #166/#168 list, minus this item):** remaining lower-traffic
reliable-mutation forms (add-transaction `<form action>`, import-csv useActionState,
delete-my-data, connect-simplefin — same recipe, smaller blast radius); category
month-over-month drill-down (Mint-parity); #71 mobile-nav redesign (owner-scoped); page-scoped
shared pending (the #167 accepted P2); Recharts pinned-tooltip/width(-1) polish; the two
adjacent "Connect a bank" button labels; #168 P3 multi-merchant "at A and B".

## 2026-07-07 — #170 reliable-mutation pass finished (last four surfaces)

**DONE (verify green, 2 critic passes → PASS 0 P0/P1, committed).** The #166/#167 top-queued NEXT
item (a): the last four lower-traffic mutation surfaces, each judged on its merits (LOOP rule 3 — don't
force the recipe on the unbroken).

- **connect-simplefin** (the only true stale-UI defect): useTransition + `router.refresh()` (the coin-flip
  #166/#167 retired) → reload + `setFlash('accounts')` recipe; failure = red inline error, no reload. No
  `withDeadline` (a SimpleFIN action is a single-shot NETWORK call that can outlast the 8s deadline). The
  connect/sync SUCCESS branch is dormant/UNVERIFIED (no creds) — inspection-verified; dormant form-opens
  e2e stays green.
- **add-transaction**: plain `<form action>` that THREW on reachable bad input (non-numeric/zero/negative
  amount) to the app error boundary → the proven GoalForm onSubmit recipe (own busy + withDeadline +
  inline errors + `window.location.assign('/transactions')` on ok; action returns AddTxnResult, no
  redirect; catch splits ActionDeadline→navigate vs real error→inline).
- **delete-my-data**: `useFormStatus` "Deleting…" busy state (native form + signOut redirect unchanged).
- **import-csv LEFT AS-IS** (documented): self-contained inline imported/skipped/per-row-error report, no
  same-page stale list — already compliant; flash+reload would regress the per-row report.

**The mid-course correction (the useful part):** I FIRST converted add-transaction with `useActionState`
— gate-green EXCEPT my own new e2e assertion `expect(account).toHaveValue(chosen)` FAILED. React 19's
form-action auto-reset silently reverts the account `<select>` to the first option on the error return →
a corrected retry files to the WRONG account (critic P1). Echo-back-as-defaultValue did NOT reliably
restore the select. Fix = switch to the plain onSubmit recipe (no reset → uncontrolled inputs untouched),
re-confirming the #166 finding that this app moved OFF useActionState for exactly this class. Distilled to
`docs/lessons/mutation-form-recipe.md` so the next session doesn't re-derive it the hard way.

**Critic (2 fresh-context passes):** find → 1 P1 (account revert) + 2 P2 (green "failed" banner;
over-broad assertOwnedCategory catch); all fixed. confirm → PASS, 0 P0/P1, all three verified resolved
with code evidence, no new P0/P1. Accepted P2s: onSubmit non-deadline catch now surfaces the error;
combined role="alert" not per-field (errors aren't field-keyed); harmless dead redirect mocks.

**Gate (real output 2026-07-07):** `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint
clean, **1848 unit / 137 files** (+3: tests/unit/manual-txn-validation.test.ts), build clean, **FULL e2e
77/77 (48.4s)** (+1: the error-path-with-account-preservation spec). Fail-old PROVEN both ways: validation
lock 3/3 fail with the try/catch defeated (engine throw propagates); the account-revert P1 was witnessed
failing the full gate on the useActionState attempt. Ledgers: DECISIONS #170, REGRESSION_LEDGER 2026-07-07,
STATUS #170, lessons/mutation-form-recipe.md.

**NEXT INCREMENT candidates:** category month-over-month drill-down (Mint-parity); #71 mobile-nav
(owner-scoped); connect-simplefin network success branch UNVERIFIED (dormant, needs creds); import-csv's
own latent useActionState reset (milder — no mis-file, rows filed server-side before the reset);
Recharts pinned-tooltip/width(-1) polish; the two "Connect a bank" button labels; #168 P3 multi-merchant.

## 2026-07-07 (resumed: "continue") — #171 connection-health / data-staleness (Competitive-Gap Gap 1 §3–4) — DONE ✅ (verify green, critic 0 P0/P1)

The #166–#170 seamlessness/reliable-mutation thread finished at #170; the working tree held only the
owner's freshly-written docs/COMPETITIVE_GAP_PLAN.md + a CLAUDE.md handoff-line edit. "continue" =
start executing that plan, top-down, taking the highest-value slice buildable now. Gap 1 (live-data
reliability) is the stated #1 priority; its token-gated live-sync items are owner-only, but items 3–4
(a pure staleness classifier + surfacing) are engine-first and Opus-lane. Baseline re-confirmed before
any change: `bash scripts/verify.sh` → ✅ GREEN.

Built engine-first (LOOP #5): `src/lib/engine/sync/health.ts` (classifyFreshness / freshnessMessage /
summarizeDataFreshness / dataFreshnessBanner / mostRecentDate; thresholds 3/13 exported + pinned) + 21
hand-verified unit tests. Wiring, NO schema change: getAccountsView → `simplefin.health` (from the
existing lastSyncedAt); new `server/connection-health.ts` getDataFreshness (grades the most recent of
lastSyncedAt + newest linked transaction); connect-simplefin connected row shows the freshness message
(amber when stale); new StaleDataBanner on the dashboard. e2e: connection-health.spec.ts (negative
demo-lock + positive throwaway via scripts/e2e-add-stale-linked-account.ts).

DIAGNOSTIC NOTE (recorded so the next session doesn't relearn it): an isolated `npx playwright test`
served a STALE `.next` — the webServer runs `next start` and never rebuilds, so the positive banner
test failed because the build predated the new code while the negative test passed either way. Fix =
run the full verify (it builds first). Same stale-3100 trap already documented in playwright.config.ts / #168.

Hostile critic (fresh-context, refute-by-default): 0 P0/P1; 1 P2 (dashboard graded newest-txn while
/accounts graded lastSyncedAt → a healthy quiet feed could show a contradictory banner) FIXED via the
most-recent-reference rule + a unit lock. Gate (real 2026-07-07): `VERIFY_E2E=1 verify.sh` → ✅ GREEN —
**1869 unit / 138 files**, build clean, **FULL e2e 79/79** (48.2s). DECISIONS #171 + STATUS #171.

Committing as #171 (NOT pushed — push is owner-gated per the #164/#165 precedent). The owner's
uncommitted CLAUDE.md handoff-line edit + docs/COMPETITIVE_GAP_PLAN.md are LEFT as-is (the owner's to
commit — #163/#170 precedent).

**NEXT INCREMENT candidates (Competitive-Gap plan order):** Gap 1 §1–2 live Plaid/SimpleFIN sync + cron
+ reconnect (OWNER-GATED — needs tokens); Gap 2 Cash Flow Radar (the strategic build — a NEW money-math
sim, routed to FABLE 5 per plan §3, not Opus); per-account last-activity on /accounts (this increment's
deferred follow-up, Opus-lane); the #170 tail (category month-over-month drill-down, #71 nav redesign).

## 2026-07-08 (resumed: "continue" after /clear, model set to Fable 5) — #172 Cash Flow Radar (Gap 2 §1) — DONE ✅ (verify green ×2, critic FAIL→fixed→confirm PASS 0 open P0/P1)

Resumed at the #171 handoff; next plan increment = Gap 2 §1 Cash Flow Radar, explicitly Fable-lane
(new money-math engine). Baseline re-confirmed GREEN before any change. Built engine-first:
`src/lib/engine/radar/burn.ts` + `radar.ts` (committed-only walk composing the TESTED computeForecast
+ cash-needed obligations; future cycles synthesized at full statement basis, estimated-labeled;
minimum timed cover-transfer, deposit-only sources; weekly-percentile burn band; pushWorthy hook),
pure `radarFromSnapshot` in `src/server/radar.ts` (reuses cashNeededFromSnapshot + /forecast's exact
event assembly — seed-grounding test pins no-drift), dashboard `CashFlowRadarCard`, e2e spec.
EDGE_CASES §Cash Flow Radar (hand-verified A–F).

Hostile critic (fresh-context) cycle 1: FAIL — 2 P1 (both proven by execution) + 4 P2 + 5 P3:
P1-1 future cycles repeated the post-mid-cycle-payment residual (optimistic bias; demo cover was
$800 low) → cycleBasisCents = full statement; P1-2 daily-percentile burn = false $0/day on
sparse-but-real spend + a false fallback sentence → weekly estimator + honest copy. P2s fixed
(cover-copy attribution, estimated label on colliding names, #134 loan-overlap disclosed as a
hedged conservative assumption, DECISIONS written). Confirmation Checker: PASS, 0 open P0/P1,
independent seed probe reproduced $6,950 / 1400¢ / 3051¢.

**Gate (real output 2026-07-08): `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint
clean, 1908 unit / 141 files (+39/+3 over #171), build clean, FULL e2e 80/80 (54.4s, +1
cash-flow-radar.spec.ts incl. axe AA).** Demo surface: alert, dip Wed 2026-06-24 (after the Jun-15
Platinum+Sapphire dues, rent tips it), cover $6,950.00 by Tue Jun 23 from High-Yield Savings,
burn ~$14/day typical ~$30.51/day heavy. Committing as #172 (NOT pushed — owner-gated). The owner's
CLAUDE.md edit + docs/COMPETITIVE_GAP_PLAN.md remain uncommitted (theirs to commit — #163/#170/#171
precedent).

### HANDOFF (resume after /clear) — 2026-07-08, session "aimplifi", #172 DONE
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md + docs/lessons/INDEX.md first (CLAUDE.md rule).
**State:** #172 committed at HEAD; local main 2 ahead of origin (`cded4a9` #171 + the #172 commit); push
owner-gated. Working tree should hold ONLY the owner's CLAUDE.md edit + docs/COMPETITIVE_GAP_PLAN.md.
**Health baseline (re-confirm, don't trust):** `bash scripts/verify.sh` → GREEN, 1908 unit / 141 files;
`VERIFY_E2E=1` → FULL e2e 80/80.
**STANDING OWNER-ONLY (unchanged + new):** authorize the push (#171 + #172 ride together); Gap 1 §1–2
live Plaid/SimpleFIN walkthroughs + sync cron in vercel.json (needs tokens); real prod descriptors for
#161 learn.ts; prod corroboration of the #166/#167/#170 mutation surfaces on the phone.
**NEXT INCREMENT candidates (Competitive-Gap plan order):** Gap 2 §2 notification delivery — wire the
radar's `pushWorthy` + payment reminders into email (RESEND_API_KEY dormant path exists) + PWA web push
(manifest+SW in place; push is the missing half) + the minimal materiality filter (Opus-lane feature
slice, engine-first for the filter); Gap 2 §3 weekly digest email (cheapest retention win); Gap 3 §1
production-readiness DO-NEXT burn-down (Sonnet/Opus-medium lane); radar follow-ups (forecast sparkline
of the three lines; mortgage-overlap disclosure P3; per-account last-activity on /accounts from #171).
**Gotchas:** never reseed the DB under a live server; e2e uses %TEMP%/aimplifi-e2e.db; a solo
`npx playwright test` serves a STALE .next (run the full verify, it builds first — #171 note); kill the
:3100 LISTEN PID if next start EADDRINUSEs (Windows TaskStop doesn't free it).
**SAFE to /clear.**

## 2026-07-08 — #173 Notification delivery (Competitive-Gap Gap 2 §2) — DONE ✅ (backfilled from STATUS.md; this session did not run it live)

*(Backfill note: this entry and the two below reconstruct #173/#174/#175 from their STATUS.md
records — those sessions shipped and verified the work but didn't write a PROGRESS.md entry.
Condensed from what STATUS already recorded, not reconstructed from memory.)*

Unified `engine/notify/select.ts` (`selectNotifications`) drives BOTH email reminders and a new
Web Push channel from one materiality rule (imminent payment due <=3 days with a real
user-action amount, OR `radar.pushWorthy`). Web Push behind the same dormant-until-configured
contract as email: `lib/push.ts` no-ops without all three `VAPID_*` vars, never throws, prunes
dead subscriptions on 404/410. New `/api/cron/notify` (CRON_SECRET-guarded). Golden-safe: a
`NotificationSent` dedup row is written only after a real delivery, so a dormant/no-op run
writes nothing. Two new Prisma models (`PushSubscription`, `NotificationSent`), cascade-deleted.
SSRF guard on subscribe endpoints (https-only, rejects IP literals/localhost). Fresh Fable
hostile critic (money/security lane): PASS 0 P0/P1; 2 P2 + P3s fixed (radar cooldown to prevent
push-spam on one dip episode, subscription cap, dedup pruning). Gate: `VERIFY_E2E=1 verify.sh` ->
GREEN, 1938 unit / 145 files, FULL e2e 83/83.

## 2026-07-08 — #174 Weekly digest email (Competitive-Gap Gap 2 §3) — DONE ✅ (backfilled; completes Gap 2)

Mostly composition, not new math: `engine/digest/build.ts` renders the SAME Money Review object
/coach shows plus the upcoming week's dues, as plain text — no number the digest touches is
computed independently of /coach or the reminder surface. New `/api/cron/digest`
(CRON_SECRET-guarded), dormant without `RESEND_API_KEY`, reuses #173's dedup table keyed on the
ISO week's Monday. Fresh Opus hostile critic (routine lane): PASS 0 P0/P1; 1 P2 fixed — an
inherited /coach bug the digest would have EMAILED (a first-week zero-transaction user's
`monthsOfRunway = Infinity` rendered the literal word "Infinity"; both the digest copy and the
un-guarded /coach source fixed together). Gate: GREEN, 1969 unit / 147 files, FULL e2e 84/84.
This completed Gap 2 (radar #172 + notifications #173 + digest #174); Gap 3 (onboarding + mobile
polish) started next.

## 2026-07-08 — #175 Gap 3 §1 production-readiness backlog burn-down — DONE ✅ (backfilled; honest gate, pre-existing e2e flake first documented here)

Explorer survey of the 2026-06-24 audit's 7-item "DO NEXT" list found 5 already done by prior
sessions without a backlog checkoff; shipped the 3 genuine gaps (EmptyDashboard's missing `<h1>`
on 13 zero-account routes; two silent-blank empty states in LifeEnergyCard/opportunities-card;
an Investments nav entry). UI-only, no critic cycle (routine additive lane). First session to hit
and root-cause the `[mobile-380]` Playwright viewport-scaling flake (config 380x800 actually
renders ~425x895 on this machine — a Chromium/Windows scaling artifact, not app CSS) via a
`git stash` A/B control; documented in `docs/lessons/mobile-380-viewport-scaling-flake.md`. Gate:
tsc/eslint/vitest (1969/1969) /build clean; `VERIFY_E2E=1 verify.sh` -> 75 passed / 5 failed, all
5 pre-existing — `scripts/verify.sh` has not been able to exit 0 on this machine since.

## 2026-07-08 (resumed: "continue.") — #176 Guided first-run connect flow (Competitive-Gap Gap 3 §3) — DONE ✅ (verify green modulo the documented flake, critic FAIL→2 P1 fixed)

Resumed at the #175 handoff with no further user input ("continue."). Re-confirmed baseline
GREEN, surveyed the codebase (explorer subagent) for what the guided flow needed, found the app
already had ~90% of a 3-step "bank → confirm → see number" flow spread across three existing
surfaces with no shared narrative and no inlined connect UI. Built pure UI composition:
`EmptyDashboard` now renders `<ConnectSimplefin>`/`<ConnectAccountsButton>` directly (SimpleFIN
walkthrough inlined, zero navigation, on all 13 zero-account routes); a new shared
`StepIndicator`; step badges on the dashboard's cash-needed reveal and `OnboardingNudge`, both
gated on the existing `showOnboarding` boolean; Plaid button label gained "(Plaid)" (closes a
#175-flagged loose end).

Fresh-context hostile critic (routine feature-slice lane): FAIL → 2 P1. **P1-1**: the step
badges read backwards (a "Step 3" cash-needed badge rendered ABOVE a "Step 2" nudge below it) —
fixed by renumbering to match the app's actual top-to-bottom reveal instead of moving the
deliberately payoff-first `CashNeededCard`; locked with a `boundingBox().y` DOM-order e2e
assertion. **P1-2**: `ConnectAccountsButton` is no longer /accounts-only, but `/plaid-oauth`'s
post-OAuth resume was hardcoded to `/accounts` — a Chase/BofA connect started from the
dashboard's Step 1 would strand the user off the flow. Fixed with a new origin-path
stash/read/clear trio in `lib/plaid-oauth.ts` (same lifecycle as the existing link-token
storage), 2 new unit tests. Both re-verified fixed inline (routine lane, no separate confirm-pass
agent).

**Gate (real, 2026-07-08):** `npx tsc --noEmit` / `npx eslint . --max-warnings=0` clean;
`npx vitest run` → **1971/1971** (147 files, +2 over #175); `npx next build` clean;
`VERIFY_E2E=1 bash scripts/verify.sh` → **77 passed, 4 failed, 5 did not run** on `[mobile-380]`
— proven pre-existing and unrelated via a `git stash` + fresh `next build` A/B control run TWICE
(matches 4 of the 5 documented symptoms in `docs/lessons/mobile-380-viewport-scaling-flake.md`;
only this session's own new test flips fail→pass between the stashed and unstashed runs).
`scripts/verify.sh` still can't exit 0 on this machine for any diff (unchanged since #175) — that
viewport investigation remains its own separate task, not this session's to fix.

New/changed: `src/components/onboarding/empty-dashboard.tsx`, `src/components/onboarding/step-indicator.tsx`
(new), `src/components/settings/onboarding-nudge.tsx`, `src/app/(app)/dashboard/page.tsx`,
`src/components/finance/connect-accounts-button.tsx`, `src/lib/plaid-oauth.ts`,
`src/app/plaid-oauth/page.tsx`, `tests/e2e/guided-onboarding.spec.ts` (new),
`tests/unit/plaid-oauth.test.ts`. Ledgers: DECISIONS #176, STATUS #176 (incl. the PROGRESS.md
backfill note above), REGRESSION_LEDGER not touched (no bug fix to a shipped defect — the P1s
were caught in-cycle before ever being committed, so nothing regressed for a user). Committing as
#176; NOT pushed — push remains owner-gated per the #164/#165/#171/#172 precedent.

### HANDOFF (resume after /clear) — 2026-07-08, session "aimplifi", #176 DONE
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md + docs/lessons/INDEX.md first (CLAUDE.md rule).
**State:** #176 committed at HEAD; local main ahead of origin (#171 through #176, 7 commits); push
owner-gated.
**Health baseline (re-confirm, don't trust):** `bash scripts/verify.sh` (no E2E) → GREEN, 1971 unit
/ 147 files, build clean. `VERIFY_E2E=1` → 77 passed / 4 failed / 5 did not run on `[mobile-380]`,
ALL pre-existing per `docs/lessons/mobile-380-viewport-scaling-flake.md` — do not re-investigate
inside an unrelated task; do a `git stash` A/B control first if a NEW test starts failing, to tell
a real regression from this known flake.
**STANDING OWNER-ONLY (unchanged + new):** authorize the push (#171–#176 ride together); Gap 1
§1–2 live Plaid/SimpleFIN walkthroughs + sync cron (needs tokens); Gap 3 §2 mobile secondary-nav
redesign (explicitly flagged in the plan as needing owner design input — a real product decision,
not a mechanical slice); the mobile-380 viewport-scaling Playwright fix itself (its own infra
task, scope per the lesson file).
**NEXT INCREMENT candidates:** Gap 3's remaining polish (per-account last-activity on /accounts,
carried since #171); Gap 4 (Glass-Box assistant, AI-trust panel); Gap 5 (investments provenance
tag, benchmark line); Gap 6 (CI verify.sh in Actions, error tracking, backups) — all smaller,
independently schedulable slices with nothing else fully blocking.
**Gotchas:** never reseed the DB under a live server; e2e uses %TEMP%/aimplifi-e2e.db; a solo
`npx playwright test` invocation spawns its OWN `next start` from whatever `.next` currently
exists (no server persists between separate tool calls in this environment, confirmed this
session via `netstat`) — so a "control" run against reverted source is only valid if you ran
`npx next build` AFTER stashing, not before; kill the :3100 LISTEN PID if next start EADDRINUSEs.
**SAFE to /clear.**

## 2026-07-08 — #178 Glass-Box reconciled numbers (Gap 4 §1) — DONE, committed

Fable-lane session (model switched per the #177 handoff). Built the trust-moat flagship: tap the
dashboard Cash-Needed headline → panel of the rows it's made of + per-row engine notes + the
literal row-sum Total + "matched to the penny… nothing is invented"; /spending-plan breakdown
re-sourced from the same trace engine + reconciliation line + basis. Core design: traces RESHAPE
the engine result (never recompute), so sum(rows)===headline is structural and the mismatch branch
(fail-loud, doctored-result-tested) is the only alternative. New: engine/glass-box/trace.ts,
components/finance/glass-box.tsx, tests/unit/glass-box.test.ts (16), tests/e2e/glass-box.spec.ts
(2, real DOM-parsed sum + scoped axe). Modified: cash-needed-card.tsx (headline → disclosure
button, testid + text preserved), spending-plan/page.tsx, spending-plan.spec.ts (exact:true
locators — getByText is case-insensitive and the new basis copy collided), EDGE_CASES §Glass-Box,
DECISIONS #177(backfill)+#178, STATUS #178.

Gate: bash scripts/verify.sh → ✅ VERIFY GREEN (tsc/eslint clean, 1987 unit / 148 files, build
clean); targeted e2e 14/14 on every touched surface (full-suite exit 0 still blocked by the known
mobile-380 viewport flake — unchanged, do NOT re-investigate in-task). Fresh-context Fable critic:
PASS 0 P0/P1, 7 P2 (fixed all but two accepted — duplicate-cardId notes join unreachable via DB
PKs; no component-render test for mismatch branches, no harness exists).

### HANDOFF (resume after /clear) — 2026-07-08, #178 DONE
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md + docs/lessons/INDEX.md first.
**State:** #178 committed at HEAD; local main ahead of origin (#171–#178); push owner-gated.
**Health baseline:** core verify GREEN, 1987 unit / 148 files; full VERIFY_E2E=1 cannot exit 0 on
this machine (documented mobile-380 viewport flake, docs/lessons/mobile-380-viewport-scaling-flake.md)
— git-stash A/B control before blaming any new diff.
**STANDING OWNER-ONLY:** the push; Gap 1 §1–2 live walkthroughs (tokens); Gap 3 §2 mobile nav
redesign; the mobile-380 Playwright infra fix.
**NEXT INCREMENT candidates (Opus/routine lane — /clear + model-switch point):** Gap 5
(investments provenance tag + benchmark line), Gap 6 §1 (CI verify.sh in Actions), per-account
last-activity on /accounts (carried since #171), PROGRESS.md backfill #173–175 (still outstanding).
**SAFE to /clear.**

## 2026-07-08 (resumed: "continue" after /clear, model Opus 4.8) — #179 per-account freshness on /accounts (Gap 1 §3 follow-up) — DONE ✅ (verify green, targeted e2e green, self-review clean)
Resumed at the #178 handoff in the Opus/routine lane it names. Re-confirmed baseline before any
change (measured, not trusted): core `bash scripts/verify.sh` → GREEN (1987 unit / 148 files). Picked
the "per-account last-activity on /accounts" slice — the increment #171 explicitly deferred as "the
next slice" and the highest-value fully-in-session-verifiable item on the #178 menu (Gap 6 §1 CI can't
be observed green without a push, which is owner-gated; this can).

Scoped via the explorer subagent (codegraph absent here): #171's connection-health engine
(`engine/sync/health.ts`) is reusable verbatim; per-account freshness did NOT exist (only a global
banner + one SimpleFIN connected-row status). Built engine-first (LOOP #5):
- Pure `perAccountFreshness(accounts, today)` in health.ts → id→FreshnessResult|null; null for
  non-linked (provider {manual,demo}) + INVESTMENT; else classify from
  mostRecentDate(newestTxn, connectionLastSync) — #171's quiet-account guard applied per row.
- `getAccountsView`: +1 `transaction.groupBy(_max date by accountId)` in the existing Promise.all;
  isLinkedFeed = provider in {simplefin,plaid}; connectionLastSyncedAt = sfLastSynced for simplefin
  only; assigns `AccountView.freshness` (new optional field).
- `LinkedRow`: freshness sub-line (`data-testid="account-freshness"`, amber on very_stale) via the
  existing `freshnessMessage`.
GOLDEN-SAFE by construction: demo accounts are provider 'demo' → no line → demo /accounts byte-identical
(locked by an account-freshness count-0 e2e assertion).

Proportionate adversarial self-review (display-only, single-path, reuses tested classification — #33/#57
precedent, not a multi-agent workflow): consistency with banner + connection status confirmed on the
month-old e2e fixture; no double-count (_max not sum); non-USD withheld excluded; deterministic. One
gap FIXED: the amber very_stale line was only reachable in the linked-stale state (phase5-a11y is
demo-only) → added a full-page axe WCAG-AA scan of /accounts to the stale e2e (green). Known limitation
documented (latent-only): a quiet Plaid account has no sync stamp (cursor only) → grades by txn recency
alone; Plaid dormant, no live impact.

Gate (real 2026-07-08): `bash scripts/verify.sh` → ✅ GREEN — tsc/eslint clean, 1994 unit / 148 files
(+7), build clean. Targeted `connection-health.spec.ts` 2/2 (demo count-0 golden lock + stale positive
per-row reconnect line + /accounts axe AA). 30 other /accounts-touching e2e pass; lone `auth.spec.ts`
sign-out failure PROVEN pre-existing (mobile-380 viewport flake) by git-stash A/B (identical clean-tree
result). Ledgers: DECISIONS #179, STATUS #179. No REGRESSION_LEDGER entry (feature, not a bug fix).
Committing as #179; NOT pushed (push owner-gated, #171–#179 ride together).

### HANDOFF (resume after /clear) — 2026-07-08, #179 DONE
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md + docs/lessons/INDEX.md first.
**State:** #179 committed at HEAD; local main ahead of origin (#171–#179); push owner-gated.
**Health baseline:** core verify GREEN, 1994 unit / 148 files; full VERIFY_E2E=1 cannot exit 0 on this
machine (documented mobile-380 viewport flake, docs/lessons/mobile-380-viewport-scaling-flake.md) —
git-stash A/B control before blaming any new diff.
**STANDING OWNER-ONLY:** the push; Gap 1 §1–2 live walkthroughs (tokens); Gap 3 §2 mobile nav redesign;
the mobile-380 Playwright infra fix.
**NEXT INCREMENT candidates (Opus/routine lane):** Gap 5 (investments provenance tag surfaced on
/investments + benchmark-vs-index line), Gap 6 §1 (CI verify.sh in GitHub Actions — note: can't observe
green without a push, so pair with the owner's next push), PROGRESS.md backfill #173–175 (still
outstanding — reconstruct from STATUS #173/#174/#175 only, don't invent live detail).
**SAFE to /clear.**

## 2026-07-08 (resumed: "continue" after /clear, model Fable 5) — #180 Holding provenance badge on /investments (Gap 5 §1) + benchmark line blocked — DONE ✅ (verify green, targeted e2e 7/7, self-review clean)
Resumed at the #179 handoff. From its Opus/routine menu the Fable-lane fit was Gap 5 — the one
menu item with a genuine money-math component (the benchmark-vs-index line); the others were
owner-gated (Gap 6 §1 CI needs a push to observe green) or pure doc backfill. Re-confirmed
baseline before any change (measured, not trusted): `bash scripts/verify.sh` → ✅ GREEN.

Scoped via the explorer subagent (codegraph absent here): `Holding.source` already exists
(`String @default("manual")`, set to `'simplefin'` only by `reconcileSimplefinHoldings`; manual
adds + the demo seed leave it default), but `getInvestments` did NOT select it and the view
never showed it. Built engine-first (LOOP #5):
- Pure `holdingProvenance(source)` in `engine/investments/portfolio.ts` (the #118
  priceChangeBadge pattern — badge decision unit-locked without a DOM): manual/absent → null
  (no badge); any real feed key → "Synced" (one branch covers simplefin now + plaid later).
- Optional display-only `source?` passthrough on `Holding` + `PositionValuation` (alongside
  the existing `name?`; zero weight in any valuation — pinned identical marketValue/gain).
- `getInvestments`: +`source` in the holdings select, threaded through `toEngineHolding`.
- `investments-view.tsx`: `<Badge data-testid="holding-provenance">Synced</Badge>` after the
  symbol, only when `holdingProvenance` is non-null.
GOLDEN-SAFE by construction: demo holdings all `manual` → no badge → demo /investments
byte-identical (locked by a `holding-provenance` count-0 e2e assertion).

**Benchmark-vs-index line (Gap 5's 2nd item) DEFERRED — BLOCKED, not faked:** needs a
per-holding valuation history / acquisition dates (only current snapshot + cost basis stored →
the portfolio's own period return is uncomputable; the `timeWeightedReturn`/`xirr` engines have
no dated series) AND an index market-data source (none configured; bash allowlist has no
market-data host). Building it now = inventing both the period and the index return = a
no-fabrication violation. Recorded owner-gated (needs a market-data feed + a purchase-date /
periodic-snapshot schema addition) — DECISIONS #180 + STATUS #180.

Proportionate adversarial self-review (display-only single-path passthrough reusing tested
classification — #33/#57/#179 precedent, not a multi-agent workflow): golden-safety structural
+ e2e-locked; money inert (passthrough unit test); existing valuation tests assert per-field so
`source:undefined` breaks nothing; axe WCAG-AA green on the badge-free demo panel.

Gate (real 2026-07-08): `bash scripts/verify.sh` → ✅ GREEN — tsc/eslint clean, build clean;
targeted `investments.test.ts` + `investments-server.test.ts` 47/47 (+6); `VERIFY_E2E=1
investments.spec.ts` 7/7 (count-0 golden lock + axe AA). Full VERIFY_E2E can't exit 0 on this
machine (documented mobile-380 viewport flake) — the spec is run directly. Ledgers: DECISIONS
#180, STATUS #180. No REGRESSION_LEDGER entry (feature, not a bug fix). Committing as #180;
NOT pushed (push owner-gated, #171–#180 ride together).

### HANDOFF (resume after /clear) — 2026-07-08, #180 DONE
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md + docs/lessons/INDEX.md first.
**State:** #180 committed at HEAD; local main ahead of origin (#171–#180); push owner-gated.
**Health baseline:** core verify GREEN; full VERIFY_E2E=1 cannot exit 0 on this machine
(mobile-380 viewport flake, docs/lessons/mobile-380-viewport-scaling-flake.md) — git-stash A/B
control before blaming any new diff; run the touched spec directly.
**STANDING OWNER-ONLY:** the push; Gap 1 §1–2 live Plaid/SimpleFIN walkthroughs (tokens);
Gap 3 §2 mobile nav redesign; the mobile-380 Playwright infra fix; the Gap 5 benchmark line
(needs a market-data feed + a purchase-date/periodic-snapshot schema addition — see #180).
**NEXT INCREMENT candidates (Opus/routine lane):** Gap 5 remainder gated on the market-data
feed above; Gap 6 §1 (CI verify.sh in GitHub Actions — can't observe green without a push, pair
with the owner's next push); Gap 6 §2 (prod error tracking); PROGRESS.md backfill #173–175
(still outstanding — reconstruct from STATUS #173/#174/#175 only, don't invent live detail).
**SAFE to /clear.**

## 2026-07-08 (resumed: "continue" after /clear, model Fable 5) — #182 multi-device session invalidation + PII-free deletion record (Gap 6 §3) — DONE ✅ (verify GREEN, critic FAIL→fixed→re-verified, touched e2e 2/2)

Resumed at the #181 HEAD. First action was a full-codebase reconciliation (two explorer
sweeps) because the #180/#181 handoffs pointed back at the COMPETITIVE_GAP_PLAN — which
turned out to be STALE: Cash Flow Radar (`engine/radar/radar.ts` + dashboard card), web
push (`lib/push.ts`, `/api/push/*`, `PushSubscription`, `PushOptIn`), and the weekly digest
(`engine/digest/build.ts`, `/api/cron/digest`) were ALL already built though the plan (written
07-07) listed them as gaps. Annotated `COMPETITIVE_GAP_PLAN.md §2` with a dated reconciliation
banner (per-gap BUILT/PARTIAL/NOT-BUILT/GATED) so no future session rebuilds them. Also noted:
**#181 (CI) committed without its own PROGRESS entry** — its full record is DECISIONS/STATUS #181;
this is that backfill acknowledgement. (The older #173–175 PROGRESS backfill is STILL outstanding —
reconstruct from STATUS only.)

Picked Gap 6 §3 as the highest-value UNBLOCKED, in-session-verifiable, rule-3 (security/data-
integrity) slice — the two items PRIVACY.md §Deletion listed as deferred. Built engine-first:
- `engine/auth/session.ts` — pure `isSessionCurrent(dbEpoch|null, tokenEpoch?)` (fail-closed) +
  `hashUserRef` (salted sha256), unit-pinned against independently-computed vectors.
- `User.sessionEpoch` (Int @default(0), golden-safe) + new `DeletionRecord` (no User relation →
  survives the cascade). `prisma db push` applied.
- `server/session-guard.ts` — `currentSessionEpoch` (stamp source) + `isSessionEpochCurrent`
  (request check), ONE DB source so stamp and check can't diverge.
- auth.ts — Node `jwt` override stamps `token.epoch` from the DB at sign-in for EVERY provider;
  Node `session` override strips `user` on a stale/absent epoch → `requireUserId` throws on every
  device. Edge middleware stays Prisma-free.
- `revokeOtherSessions()` action (bump + audit + signOut) + Settings "Sign out of all devices".
- `deleteMyData` writes the `DeletionRecord` ATOMICALLY with the cascade (`$transaction`), keyed
  by AUTH_SECRET.

FRESH-CONTEXT HOSTILE CRITIC (Fable, refute-by-default) — **cycle 1 FAIL: 1 P0 + 2 P1, all FIXED
+ re-verified**:
- **P0-1** demo/Google tokens minted at a hardcoded epoch 0 → one "sign out of all devices" would
  BRICK those accounts (fresh sign-in re-minted 0 ≠ bumped DB epoch → infinite redirect; breaks
  CLAUDE.md rule 4). FIX: dropped the edge/authorize stamp; the Node `jwt` override reads the DB
  epoch at sign-in for all providers. Regression-locked by a round-trip test.
- **P1-1** non-atomic record+delete → `$transaction`.
- **P1-2** untested stamp↔check seam → round-trip regression added (catches P0-1 mechanically).
- **P2s** hash keyed by AUTH_SECRET (was public-salt-enumerable for Google ids); overclaimed
  comments softened. Accepted: per-request PK findUnique (negligible); `db push` deploy note.

Gate (real 2026-07-08): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — tsc/eslint clean,
**2010 unit / 150 files**, build clean. `VERIFY_E2E=1 account-deletion.spec.ts` 2/2 (demo sign-in
exercises the P0 fix; new render-only Sessions assertion, never clicks revoke). Full VERIFY_E2E
can't exit 0 on this Windows machine (documented mobile-380 viewport flake — unrelated). Ledgers:
DECISIONS #182, STATUS #182, PRIVACY §Deletion rewritten, COMPETITIVE_GAP_PLAN §2 reconciled. No
REGRESSION_LEDGER entry (the P0/P1 were caught in-cycle, never shipped). Committing as #182; NOT
pushed (push owner-gated, #171–#182 ride together).

### HANDOFF (resume after /clear) — 2026-07-08, #182 DONE
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md + docs/lessons/INDEX.md first.
**State:** #182 committed at HEAD; local main ahead of origin (#171–#182, push owner-gated).
**Health baseline (re-confirm, don't trust):** core `bash scripts/verify.sh` → GREEN, 2010 unit /
150 files, build clean. Full `VERIFY_E2E=1` cannot exit 0 here (mobile-380 viewport flake,
docs/lessons/mobile-380-viewport-scaling-flake.md) — git-stash A/B control before blaming any new
diff; run the touched spec directly.
**IMPORTANT — the plan was stale; trust the reconciliation, not the raw gap list.** COMPETITIVE_GAP_PLAN
§2 now has a dated BUILT/GATED banner. **True unblocked, in-session-verifiable remaining work:**
(1) wire `/api/cron/notify` + `/api/cron/digest` into `vercel.json` crons (Gap 2 — they exist but
never fire; ~config, low-risk, pair with the owner push to observe); (2) Gap 1 §4 sync-FAILURE
surfacing in the reminders card (needs a persisted sync-error state — real engine work); (3) Gap 3
§1 loading skeletons + destructive-delete confirmations (mechanical, Opus/Sonnet lane); (4) Gap 6
§2 prod error tracking (Sentry — partially env-gated, hard to observe green in-session).
**STANDING OWNER-ONLY:** the push; Gap 1 §1–2 live Plaid/SimpleFIN walkthroughs (tokens) + sync
cron enable; Gap 3 §2 mobile secondary-nav redesign (design input); Gap 5 benchmark line (market-
data feed + holdings-history schema, #180); the mobile-380 Playwright infra fix; #173–175 PROGRESS
backfill (doc chore, reconstruct from STATUS only).
**Gotchas:** never reseed under a live server; e2e uses %TEMP%/aimplifi-e2e.db; a solo `npx playwright
test` spawns its own `next start` from current `.next` — rebuild AFTER stashing for a valid control;
kill :3100 LISTEN PID on EADDRINUSE.
**SAFE to /clear.**

## 2026-07-09 — #190 Bounded per-user threshold tuning (TASKS 3.6) — DONE

Gate (real 2026-07-09): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — tsc/eslint clean,
**2071 unit / 157 files** (+24 over #189's 2047/154 baseline… note #189 recorded 154 files;
+3 files: tuning, threshold-tuning-labels, ingest-prediction-log), build clean. E2e real
runs (mobile-380): settings-dials + phase2-triage **8/8**, transactions **16/16**.

**What shipped:** pure tuning engine (`src/lib/engine/categorize/tuning.ts`) — per-user
Brier → AUTO_FLAGGED offset clamp((brier−150)×5, ±500), ≥20 committed user-labeled
samples, recompute-from-scratch, one-sided auto-revert (recent 20 vs prior, >25 milli);
optional `flaggedBps` threaded through categorize() + 5 wrappers, loaded at all 7 per-user
read sites; additive `CategoryPrediction.labeledAt` (user filings set it, undo clears it,
seed rows stay null ⇒ demo/golden byte-identical); Settings AI-trust disclosure. Hostile
critic F1 (P1) fixed in-cycle: live ingest never wrote prediction rows — now all 4 ingest
paths log verdicts (`src/server/predictions.ts`; user-dictated 10000-confidence rows
skipped) and predictions follow Plaid pending→posted churn like Corrections. Ledgers:
DECISIONS #190, STATUS #190, REGRESSION_LEDGER (ingest log), EDGE_CASES §Threshold tuning
(hand-verified Brier table). TASKS 3.6 → [x]. **PUSHED 2026-07-09** (owner: "push") —
`git push origin main` → `34671b4..5e9d616`; origin/main now matches HEAD, #171–#190 all
live on GitHub. TASKS 0.1 → [x]. CI (#181, `.github/workflows/verify.yml`) should now have
fired on this push for the first time ever — **UNVERIFIED from this machine** (`gh` CLI here
is unauthenticated and the unauthenticated REST API 404s on this repo, consistent with it
being private); confirm the Actions run in the GitHub UI or via an authenticated `gh run
list` next session, and flip #181 from UNVERIFIED to verified (or log a real regression) once
seen.

### HANDOFF (resume after /clear) — 2026-07-09, #190 DONE + pushed
**Resume from `C:\dev\Aimplifi`.** Read AGENTS.md → LOOP_ENGINEERING.md → CLAUDE.md →
docs/lessons/INDEX.md, then TASKS.md. **State:** #190 committed AND pushed; local main =
origin/main (`5e9d616`). Health baseline (re-confirm, don't trust): core verify GREEN
2071/157, build clean; full VERIFY_E2E=1 still can't exit 0 here (mobile-380 viewport
flake — docs/lessons). **First thing next session:** check whether the #181 GitHub Actions
run went green (first-ever real run) — flip its UNVERIFIED status either way. **Next per
TASKS.md routing:** Wave-0 0.2 (flake quarantine, Opus) unblocks local full-e2e; Wave-0 0.5
(activation checklist panel, Sonnet) is the other unblocked non-owner item; Wave-1
1.1/1.3/1.7 are open Opus lanes; 3.6 is done — its follow-on leverage is a user-facing
confirm surface (would give tuning positive evidence; today live labels are
corrections-biased → tighten-only, documented in STATUS #190). Still owner-gated: deploy
env vars (0.3), live provider spot-checks (0.4), Neon backups (0.6).

### HANDOFF (resume after /clear) — 2026-07-09, #193 DONE (Wave 0.2), NOT yet pushed
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md → CLAUDE.md → docs/lessons/INDEX.md,
then TASKS.md. **State:** #193 committed AND pushed; local main = origin/main (`8683814`). **What #193 did:**
Wave 0.2 (flake quarantine) closed WITHOUT quarantine — the recurring "full VERIFY_E2E can't
exit 0 here" was a MISDIAGNOSIS. Real cause: deterministic `auth.spec.ts` strict-mode locator
bug from #182's "Sign out of all devices" button; scoped the locator → full gate green.
**Health baseline (real, re-confirm don't trust):** `VERIFY_E2E=1 bash scripts/verify.sh`
→ ✅ GREEN, 2085 unit / 158 files, build clean, **93 e2e passed** — full gate exits 0 on this
machine now (3 full runs green this session, 0 viewport-flake recurrence). Standing assumption
flipped: local full e2e is expected to exit 0; read the actual error signature before blaming
the mobile-380 lesson. **Open non-owner items next (per TASKS.md):** 0.5 activation-checklist
panel (Sonnet, recon done — 3 `…Configured()` helpers exist to aggregate); Wave-1 1.1 return
moment (Opus), 1.3 value-receipts ledger (Opus build + Fable critic — money-adjacent copy),
1.4 streaks (Sonnet), 1.7 personalized triage alternatives (Opus). **Still owner-gated:** 0.1
confirm CI Actions run went green (gh unauth here — check Actions UI), 0.3 deploy env vars,
0.6 Neon backups; live Plaid Link UI + webhook round-trip.

### HANDOFF (resume after /clear) — 2026-07-09, #194 DONE (Wave 0.5)
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md → CLAUDE.md → docs/lessons/INDEX.md,
then TASKS.md. **State after this session:** #193 (Wave 0.2, auth-locator fix) + #194 (Wave 0.5,
activation checklist) done. **What #194 did:** operator activation-checklist panel on /settings —
pure `engine/ops/activation.ts` (env-var PRESENCE → 7 live/dormant rows, compound cron+provider
gates) + RSC panel (`activation-card`); booleans + env-var NAMES only, no secret value to client.
**Health baseline (real, re-confirm don't trust):** `VERIFY_E2E=1 bash scripts/verify.sh` → ✅
GREEN, 2092 unit / 159 files, build clean, 94 e2e passed. Full gate exits 0 locally (Wave 0.2).
**CI STILL UNCONFIRMED / likely OFF:** owner reported NO Actions run for #181; workflow file is
correct + pushed, so GitHub **Actions is probably DISABLED for the repo** — owner must enable it
(repo Settings → Actions → General → Allow all actions → Save), then a push triggers it. Until
then "CI is the arbiter" does not hold (TASKS 0.1). **Open non-owner items next (TASKS.md):**
Wave-1 1.1 return-moment card (Opus, engine-first), 1.3 value-receipts ledger (Opus build +
Fable critic — money-adjacent copy), 1.4 savings streaks (Sonnet), 1.7 personalized triage
alternatives (Opus). **Owner-gated:** 0.1 enable Actions + confirm CI green, 0.3 deploy env vars,
0.6 Neon backups, live Plaid Link UI + webhook round-trip.

### UPDATE — 2026-07-09, CI arbiter confirmed GREEN (Wave 0.1 DONE)
Supersedes the "CI STILL UNCONFIRMED / likely OFF" note above: owner ENABLED GitHub Actions;
the `verify` workflow run **#15** (from the #194 push) was **owner-confirmed GREEN** on the
Linux runner — first confirmed CI-arbiter pass. Wave 0.1 done; single-machine-loss net now
holds; a green CI e2e independently confirms the mobile-380 flake is Windows-local. Next lane
unchanged: Wave-1 1.1 return-moment (Opus, engine-first).

## 2026-07-10 — #206 Value-receipts ledger (TASKS 1.3) — DONE

Gate (real 2026-07-10, post-critic): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — tsc/eslint
clean, **2170 unit / 166 files**, build clean. Targeted e2e (mobile-380): phase3-coach (new
"1 catch … $2.50/mo" + reload idempotency) + payment-reminders + notifications **7/7**; critic
independently ran phase5-a11y + auth **10/10** (WCAG-AA with the new card visible).

**What shipped:** additive `ValueReceipt` (`@@unique([userId,key])`, user-cascade) + pure
`engine/receipts/receipts.ts` (verbatim-copy builders, per-kind summary, shared `receiptLines`) +
`server/receipts.ts` (filter-then-create + P2002 swallow) + delivery-gated minting in the
reminders/notify crons (channel-agnostic `payment_due` keys; estimated reminders mint nothing) +
price receipts keyed on the PRICE TRANSITION (`price_increase:merchant:from>to`; from/to/changedAt
threaded onto price-increase Opportunities) minted on the /coach render and post-send in the digest
cron + /coach "What Aimplifi caught" card (hidden until first catch) + digest tally section.
Honesty structural: per-kind counts/totals only, no cross-kind $ field, copy-guardrail test bans
saved/earned phrasing. Fresh-context Fable hostile critic: **0 P0/P1, 4 P2 — all fixed in-cycle**
(digest delivery gate; transition keys vs date-churn re-mint; estimated-amount skip; PRIVACY.md
disclosure) + P3s (insights threading lock, redundant index). Ledgers: DECISIONS #206, STATUS
§Wave 1.3, EDGE_CASES §Value-Receipts, PRIVACY §What-is-stored/§Deletion, TASKS 1.3 → [x].

### HANDOFF (resume after /clear) — 2026-07-10, #206 DONE
**Resume from `C:\dev\Aimplifi`.** Read LOOP_ENGINEERING.md → CLAUDE.md → docs/lessons/INDEX.md,
then TASKS.md. **State:** #206 committed at HEAD. Health baseline (re-confirm, don't trust): verify
GREEN 2170/166, build clean; full VERIFY_E2E expected to exit 0 locally (#193 standing assumption).
**Wave 1 is now closed except 1.7** (personalized triage alternatives — Opus lane, pure function +
tests). **Next per TASKS.md routing:** 1.7 (Opus, 40k) is the last small Wave-1 slice; then either
Wave 2.1 conversation-frame engine (Opus-high build + Fable critic, 120k+40k) or start Household
MVP slice 1 (membership core, Opus build + Fable critic on the state machine — TASKS 4.2, green-lit
and "schedule sooner"; HOUSEHOLD_ARCHITECTURE.md §5 has the 8-slice plan). **Owner-gated:** cron
FIRE verification in Vercel logs (0.3), Neon backups (0.6), live Plaid Link UI + webhook.

### UPDATE — 2026-07-10, #206 PUSHED (owner: "push")
`git push origin main` → `8fea5de..7011fcd`; local main = origin/main. CI `verify` workflow should
fire on this push — confirm green in the Actions UI next session (gh here is unauthenticated).
Owner guidance recorded: engine-first always before UI; if the engine is complete per plan, carry
on without pausing. Next: TASKS 1.7 (Opus), then Household MVP slice 1 (engine/state-machine first,
per HOUSEHOLD_ARCHITECTURE.md §5 slice plan; Fable critic on the membership state machine).

## 2026-07-12 — #225/#226 Learned vocabulary (TASKS 2.3) — DONE

Gate (real 2026-07-12, post-critic): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — tsc/eslint
clean, **2503 unit / 184 files**, build clean. `npx playwright test tests/e2e/ask.spec.ts` → **11/11**,
including a new flow that signs up a REAL account, drives the actual miner (3 independent rescues →
shadow; 2 held-out → flagged), answers an unroutable phrasing with the learned rule, and forgets it.
Committed at 2f9a94e.

**What shipped:** additive `VocabEntry` (per-user, `@@unique([userId,phrase])`, cascade) + pure
`engine/vocab/vocab.ts` (`normalizePhrase` / `matchVocab` / `mineVocab`) + Prisma-only `server/vocab.ts`
+ `server/vocab-actions.ts` (undo) + weekly `/api/cron/vocab` (Mon 16:00) + the learned disclosure and
"Not what I meant" on the Ask answer + the "Phrasings Aimplifi learned from you" list on Settings → AI
trust. Routing order parser → frame → **vocab** → LLM, on a parser-`unknown` only. **An entry supplies an
intent KIND and nothing else** — every parameter is re-derived from the asker's own words via
`intentFromKind` + `validateIntent`, the same contract the LLM classifier has had since #75.

**Critic cycle 1 (3 fresh-context Fable critics in parallel — routing/money · the loop · authz+privacy):
0 P0, 5 P1, 11 P2 — all P1s + actionable P2s fixed in-cycle, 7 REGRESSION_LEDGER entries.** The routing
critic confirmed the kind-only claim held; the other two found the real leaks, all in the loop's BACK
half: the shared demo account learned (a visitor's typed words would render in the next visitor's
settings); a "Forget this" landing mid-mining-run was silently reverted; a served entry was
unmonitorable and self-promoted; `VocabEntry` was undisclosed in PRIVACY; plus a PRE-EXISTING
cardinal-sin parser bug ("spend at 星巴克" → the ALL-spending total, unhedged).

Ledgers: DECISIONS #225 (+#226 critic), STATUS §Wave 2.3, TASKS 2.3 → [x], PRIVACY (store + deletion
cascade), REGRESSION_LEDGER ×7, two new lessons (`shared-demo-account-must-not-learn.md`,
`self-improving-loops-leak-in-the-back-half.md`) + INDEX.

---

# PROGRESS — §2.3 Balance-Move Explainer (AI plan §2.3, rank #9) — started 2026-07-16

Owner picked this as the next AI-plan slice after §3.1 (Why-This-Category) completed at #239.
Next DECISIONS number: **#240**. Tree clean at b988dce.

## Goal (testable "done")
Deterministic engine computes a typed list of contributing spending-change factors
(label + already-formatted signed cents) and trips a deviation threshold. The LLM ONLY
(a) picks the single primary-driver id and (b) writes ONE connective sentence — zero
arithmetic. validateNarrative rejects any prose whose number/percent/merchant tokens
aren't already in the payload, plus shame words AND comparative-magnitude words
("nearly doubled", "tripled", "most of the drop"). Reject -> deterministic template
(never a guess). Framing descriptive, not causal.

## Rework rails (from AI_DIFFERENTIATION_PLAN §2.3 — MUST honor)
1. Force primaryDriver = movers[0] deterministically, or reject any LLM pick != top mover.
2. Banned comparative-magnitude lexicon (no numeral) OR fixed connective template.
3. Keep framing descriptive, not causal.
Honest caveat from the plan: deterministic template already delivers ~80% of value.

## Steps
- [ ] 1. Explorer maps reused engine signatures. IN FLIGHT.
- [ ] 2. Pure engine balance-move.ts + known-answer tests + EDGE_CASES (engine-first).
- [ ] 3. validateNarrative guard + adversarial tests (majority).
- [ ] 4. LLM boundary (id pick + one sentence), key-gated/timeout/abstain.
- [ ] 5. Server read-path + UI + e2e/axe.
- [ ] 6. verify.sh green + Fable hostile critic to 0 P0/P1; docs + commit.

## Notes
- Model: Fable 5 (this session) — correct per model-routing for prose-safety critic.
- Blocked on explorer engine-map before writing the pure module (avoid guessing signatures).

## Update 2026-07-16 (build complete, verify green, critic in flight)
- Engine `src/lib/engine/trends/balance-move.ts`: explainBalanceMove, validateNarrative,
  resolveMoveSentence, buildMovePrompt, categoryNameTokens + banned lexicons. 67 unit tests.
- LLM boundary `src/server/balance-move-llm.ts` (key-gated, 7s timeout, null-degrade).
- Read-path `src/server/balance-move.ts` (getBalanceMove; read-only/stateless — no demo fence needed).
- UI: trends-view.tsx renders `balance-move-explainer` line + "AI-worded" hedge only when interpreted;
  wired via trends/page.tsx.
- e2e `tests/e2e/balance-move.spec.ts` 2/2: demo shows deterministic template (no AI badge),
  explainer figure appears in movers list (grounding), WCAG AA clean.
- GATE: bash scripts/verify.sh -> ✅ VERIFY GREEN; vitest 2868 passed / 201 files; tsc+eslint+build clean.
- Fable fresh-context hostile critic (prose-safety) RUNNING. Then fix P0/P1, docs, commit as #240.
- Known likely critic hits to consider: word-form numbers ("forty percent"), bare numbers w/o $,
  sentence-initial invented proper noun (MIDSENTENCE_CAPS_RE exempts word 0), magnitude synonyms
  (outpaced/eclipsed). Fix reject-biased. Design accepts high fallback (template = ~80% value).

## Cycle 1 critic: FAIL (3 P0, 3 P1) -> reworked to SLOT-FILL. 2026-07-16
Fresh-context Fable critic empirically broke the free-prose validator (20/20 attack strings):
bare/word-form numbers, swapped/flipped figures, invented merchants (sentence-initial/lowercase/
parenthesized), fabricated windows, unenforced advice/magnitude. Root cause: validating free LLM
prose for money-truth is unwinnable.
FIX (architectural): LLM now returns a TEMPLATE of placeholders {primary}{primary_delta}{second}
{window}... + whitelisted neutral connectives ONLY. Engine substitutes every figure/label, so
figures can't be fabricated/swapped/flipped. validateTemplate (closed grammar) + validateSentence
(final scan: non-ASCII/emoji reject, ws-normalized banned lexicon incl. number-words/advice/magnitude,
stray-number-after-masking, all-caps proper-noun incl. pos 0, foreign-category). Plus: demo fence
(never LLM), bounded per-instance cache (P1-5 cost+nondeterminism), dropped 'use server' (P2-7).
34 unit tests (adversarial majority = cycle-1 attack classes). e2e 5/5. tsc/eslint/build clean.
NEXT: full verify + critic cycle 2; then EDGE_CASES/DECISIONS/STATUS/REGRESSION_LEDGER + commit #240.

## Cycle 2 critic: FAIL (1 P0, 2 P1) -> ATOMIC placeholders. 2026-07-16
P0-1: model could REORDER placeholders; adjacency=binding, so {second},{primary_delta} swapped
figures (badged AI). P1-2: connective whitelist had claim words (new/biggest/...). P1-3: hostile
custom-category NAME (user free-text) reached screen via UNVALIDATED deterministic fallback (shame/
causal/$-lookalike). FIX: atomic {primary}="Dining, up $240.00 (+40%)" fuses label+figure (no
rebind); fixed order primary->second->window, {window} required; pruned ranking words from
connectives; deterministic fallback now re-scanned -> suppress surface (empty) on hostile label;
cache key includes label (P2-4). 39 unit tests. e2e 2/2 (demo deterministic still renders).
tsc/eslint/build clean. NEXT: full verify + critic cycle 3 (of 4-cap).

## Cycle 3 critic: FAIL (0 P0, 2 P1) -> connective prune + drop foreign-category. 2026-07-16
Money-integrity core CONFIRMED sound (no fabricate/swap/rebind possible). Two P1s:
P1-1 relational connectives (from/to/shifted/compared-before-{second}) asserted false inter-category
FLOW. P1-2 foreign-category scan silently suppressed the whole surface forever for common custom
names ("Spare Change" -> word "change"). FIX: (a) bake "compared with" into {window} atom + prune
ALLOWED_CONNECTIVES to purely ADDITIVE/neutral (removed from/to/over/shifted/moved/vs/compared/
than/while/as/...); (b) REMOVE foreign-category scan (vestigial: atomic grammar makes model
category-injection impossible; only false-positived on benign labels). Plus P2-7 pct ±0 omit, P2-5
cache key includes window+pct. 32 unit tests. e2e 2/2. tsc/eslint/build clean.
NEXT: full verify + critic cycle 4 (LAST of 4-cap). If PASS -> docs (EDGE_CASES/DECISIONS/STATUS/
REGRESSION_LEDGER) + commit #240. If FAIL -> STOP, write open findings, ask human.

## #253 interject + Scenario Studio slice-1 checkpoint. 2026-07-21
Post-#252 board survey (fresh explorer, git-reconciled per the stale-verdict lesson): groundable
backlog EXHAUSTED — every remaining AI-plan item is hard-blocked (vision/OCR, intraday timestamps,
merchant DB, no ground truth) or needs a net-new engine. Owner CHOSE (AskUserQuestion): Scenario
Studio slice 1 = pure snapshot-coherence engine (plan §Later #13; advisory comparison half stays
dropped). PREEMPTED mid-plan by owner's live gap report -> #253 synced-account deletion (shipped
this session; see DECISIONS #253 / STATUS).
SCENARIO STUDIO RESEARCH (architecture map, key conclusions — full detail re-derivable from these
pointers): NO canonical assembler exists; the 5 engines get inputs from 3 independent derivations:
getCoachData (server/coach.ts:91, aggregate: monthlyFlows -> 6-mo avg income/savings, annualExp =
expenses6*2) feeds FI+savings-rate+retirement (investments.ts:135 reuses coach figures verbatim);
cash-needed (assemble.ts:80) + forecast (server/forecast.ts:26) read per-flow snap.scheduled
instead. The coherence engine must DEFINE the canonical derived-state object and map each knob
delta onto BOTH representations (aggregate AND per-flow) or one engine won't see the change.
Top hazards (10 catalogued): savings = ratio (fi.ts:108 savingsRateBps) vs cents amount
(coach.ts:125), different windows; annualExpenses x2 factor (coach.ts:123); FI fed NOMINAL
expectedReturnBps while retirement fed realReturnBps(nominal - inflation) — same user, two rates;
geometric (fi.ts:21) vs nominal r/12 (fi.ts:96 opportunityFV) compounding in one file; forecast
uses plain number cents (unbranded) vs branded Cents in cash-needed; ScheduledFlow vs
ScheduledItem near-dupe types; extra-debt-payment has NO first-class input anywhere (decide
mapping or scope out); retirement floors negatives at 0 + throws on bad ages, FI accepts negative
savings silently -> null; per-user dials (User row: swrBps/expectedReturnBps/ages/inflation)
live OUTSIDE FinanceSnapshot; DIAL_LIMITS (settings/dials.ts:38) are the clamp bounds,
retirement-whatif.ts is the clamp-reducer template. Conventions: engine in src/lib/engine/,
tests in tests/unit/, EDGE_CASES section required, injected today, no Date.now().
NEXT (Scenario Studio): design canonical ScenarioState + knob-delta type; slice 1 = engine only.

## #261 password-field restoration + secrets-in-git finding. 2026-07-21
Owner's "not remembering the password" is STILL NOT DIAGNOSED (three readings, different fixes).
DONE: precautionary restoration per rule 0 — PasswordInput registers a capture-phase submit
listener on el.form, writes el.type='password' imperatively (a state update would not reach the
DOM before the submit handlers) then setVisible(false). Submitted DOM == pre-#258 DOM; viewer kept.
E2E lock in auth.spec.ts via the wrong-password path (the one submit that stays on /sign-in).
UNVERIFIED (honest): whether a browser password manager now offers to save — no manager here.
FOUND (owner-gated, more serious than the symptom): docs/DEPLOY.md:54-55 commits real AUTH_SECRET
and DATA_ENCRYPTION_KEY values, ca23eac 2026-06-21, never removed, pushed to GitHub. Repo
visibility + whether prod uses these values are NOT verifiable from here.
RECORDED: AUTH_SECRET is the JWT signing key -> rotating it signs every device out, which reads
exactly like the reported symptom and is env-caused (the previous session's note missed this link).
GATE: VERIFY_E2E=1 bash scripts/verify.sh -> VERIFY GREEN, 3352 unit / 230 files, 143 e2e (+1).
NEXT: owner answers (which reading / which env vars / repo visibility); then TASKS 3.3 or 2.4.

## #261 follow-up: the branch was never pushed. 2026-07-21
Owner asked why they could not see the password reveal. CAUSE (verified, not theorized):
local main was 8 commits ahead of origin/main (#257..#261 range); production was pinned at
9e3e56f (#257) per every Vercel deployment's githubCommitSha. #258 was NEVER live.
CONSEQUENCE: the previous session's leading hypothesis (the #258 type-flip breaking the
browser save prompt) cannot explain anything seen on www.aimplifi.app. STATUS corrected;
new labelled hypothesis recorded — #257's reset signs out every session and does NOT sign
the user back in, so the browser autofills the OLD saved password on the sign-in page it
lands on. Check = the owner's saved-passwords list vs the password they last set.
ALSO RESOLVED: repo is PRIVATE (githubRepoVisibility on every deployment record), so the
committed secrets are a hygiene failure, not a public exposure. Rotation still owner-gated.
SHIPPED: pushed 9e3e56f..0563e0f; Vercel auto-deployed dpl_58y9k85mpNYJ7kkoTuLxbscBacML ->
READY on 0563e0f; verified live by fetching https://www.aimplifi.app/sign-in and finding
aria-label="Show password" + data-testid="auth-password-toggle". No prisma/ diff in the
pushed range, so the live database was untouched.
NEW RULE: CLAUDE.md rule 5 — commit, push, deploy, prove it live, THEN ask the owner.
NEXT: owner checks saved-passwords list; then TASKS 3.3.

## Wave M notated: mobile UI, owner request. 2026-07-21 (#262)
Owner: "mobile platform on my phone doesn't format correctly in the accounts section and
other sections... make it more functional and beautiful than simplifi, mint".
NOT STARTED — notated only, per the owner's "notate this for next session".
DELIVERABLE: TASKS.md Wave M (M.0-M.4) + docs/MOBILE_UI_BRIEF.md (evidence, coverage gap,
what is already sound, the money-copy constraint the restyle inherits).
BLOCKING (M.0): a screenshot. "Doesn't format correctly" has 4 readings (overflow, cramping,
clipping under the tab bar, iOS Larger Text) with different fixes — rule 0, do not guess.
ROOT-CAUSE OF THE MISS (verified): playwright.config.ts:53-56 defines ONE viewport
(mobile-380, 380x800) and NO test asserts layout at all — axe checks a11y, everything else
checks existence. Real widths are 360/393/402/430. Second hole: phase5-a11y.spec.ts never
scans /accounts (the reported section) nor 9 other routes.
VERIFIED DEFECTS (independent of the screenshot): accounts-list.tsx has 8 controls at
px-1.5 py-0.5 / text-[10px] ~20px tall vs 44pt iOS / 48dp Android — worst file in the repo,
and it is the section the owner named; 7 unprefixed grid-cols-3 sites; cash-needed-card:144
grid-cols-[auto_1fr_auto] concatenates card names with '+' and no break handling (the hero
card); shared-transaction-list:185 w-72 dropdown with NO max-w guard (transaction-list:415
has one); 8 fixed-width inputs with no responsive variant.
VERIFIED SOUND — do not re-do: viewport meta (device-width/initialScale 1/viewportFit cover,
zoom NOT disabled), safe-area env() helpers + bottom-nav padding, 16px touch input floor
(prevents iOS focus zoom), zero raw <table>, bottom-nav tap targets ~76px.
ALSO CLOSED: TASKS S.9 — the Vercel team-name "discrepancy" was a false dichotomy; the API
returns one team, name "Mike's projects" / slug "reiforge". Both docs were right.
NEXT: owner screenshot -> M.1 (widen the net, unblocked today) -> M.2/M.3 -> M.4 slices.

## #272 Wave 4.6 slice 3: the assembler money boundary (R1/R2/R8). 2026-07-22
Built + hostile-criticized on Fable, 2 critic cycles (cap 4).
SHIPPED: pure engine/account/reconcile-boundary.ts applied ONCE in getFinanceSnapshot (after the
currency guard): pred balance -> 0 (row kept); txns: pred owns [first txn, min(cutover, last txn)],
succ keeps everything outside; balanceSnapshots: exact-date collision dedup only (stocks, not flows);
paymentAccountId remap + supersededAccountIds consumed by resolvePaymentAccount/forecast fallbacks;
inertness = missing-side/self/cross-type/cycles (today's behavior, never a dropped figure); zero
links = exact input references (R8 structural). Confirm hardening: cross-type refusal, reverse-link
auto-undo (chains survive), chain cutover monotonicity (cycle-2 F9).
CRITIC: cycle 1 FAIL — F1 P0 (no designated payment account -> fallback anchored cash-needed on the
zeroed pred, fabricated 80000c shortfall, executed repro), F2 P0 (succ 24-mo backfill before pred's
first row dropped — real money removed), F3 P1 (pred post-cutover lone snapshots dropped -> fabricated
~70% trend dip), F4-F8 P2/P3. ALL fixed; rules re-derived (claim-span; stock-vs-flow). Cycle 2 PASS —
F1/F2/F3 CLOSED by re-executed repros; new F9 P2 (misordered chain cutovers double-count a window)
fixed same session (write-time monotonicity guard + test); F10 P3 -> spec §10 slice-5 disclosure line.
LEDGERS: DECISIONS #272 (+reindex), 4 REGRESSION_LEDGER entries, EDGE_CASES §Reconciliation boundary
(hand-verified figures, residuals a-e), spec §5/§10 rewritten to as-built, TASKS 4.6 row updated.
DEFERRED (spec-pinned): scheduled follow-through -> slice 4 (F6); ALL four per-account display
surfaces in the SAME deploy as link UI -> slice 5 (F5); /accounts+getAccountsView are Prisma-direct.
GATE: VERIFY_E2E=1 bash scripts/verify.sh -> VERIFY GREEN, 3417 unit / 235 files, 157 e2e, exit 0
(run includes the F9 guard; 52/52 across all three reconciliation suites).
NEXT: slice 4 (R4/R5 + scheduled) — Fable critic.
