# PROGRESS.md — session resume log

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
