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
