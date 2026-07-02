# PROGRESS.md — session resume log

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
