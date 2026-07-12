# STATUS — known limitations & open items

Living document; updated at each phase boundary and critic cycle.

## Wave 4.2 slice 6: partner categorization on shared accounts (#219)

`recategorizeSharedTransaction` (`src/server/household-actions.ts`) is the
entire partner-write surface on shared data (HOUSEHOLD_ARCHITECTURE §6.1,
owner decision #201): one-off only (no scope param), system categories only
(never a custom, either side's), no "Always" rule, no batch, Correction
attributed to the acting user, `CategoryPrediction.labeledAt` never touched
(per-user Brier tuning #190 stays single-teacher). Authorization is re-derived
from a live DB read inside the serializable transaction rather than trusted
from the pre-transaction `requireViewer()` snapshot, closing a TOCTOU window
on a concurrently-removed viewer. `SharedTransactionList` is now interactive
(one-off recategorize picker, system categories only) instead of read-only.

Fresh-context Fable hostile critic (dispatched as an independent agent): cycle
1 FAIL — 2 P1 + 7 P2, all fixed before re-verify. P1s: (1) Plaid's
pending→posted correction-transplant `where` clauses (4 sites) were scoped by
the syncing owner's userId, so a partner's correction was silently stranded on
the deleted predecessor id and reverted by the next re-sync — fixed by scoping
the transplant to `transactionId` only; (2) the action accepted non-scalar
input and audit-logged the raw input rather than the in-tx-resolved row — both
now guarded. P2s: `ensureCategories()` FK-safety call; the
`needsReview`/`confidenceBps`/`reviewPinned` write is now explicitly
documented as intentional parity with the owner's `applyCategory`; audit meta
carries `accountId`/`ownerUserId`; `undoCorrections` now checks transaction
ownership before writing an inverse Correction (closes a latent "reverted"
audit-lie for a shared-account correction — unreachable via any UI today, but
now structurally closed); the T3 grep-lock counts `correction.createMany` too
and the component is banned from importing `@/server/triage-actions` at all.

Gate (real 2026-07-12): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — tsc/eslint clean, **2319 unit / 179 files**, build clean, **104
e2e**. Known limitations (accepted): no two-browser partner-recategorize e2e
(same accepted gap as slice 2/3 — a single Playwright session has no second
signed-in identity to invite/accept within one run); behavior is proven at the
integration level instead (`tests/unit/household-shared-txns.test.ts`,
`tests/unit/learn-loader.test.ts`, `tests/unit/sync-preserves-corrections.test.ts`).

## Wave 4.2 slice 5: cards/calendar household scope + copy audit (#218)

`/cards` and `/calendar` now accept the same `?scope=mine|household` contract
as `/dashboard` (TASKS 4.2 slice 5): `getDashboardData`/`getCashNeeded` both
resolve the viewer's household unconditionally and return `household`/`scope`
so a page can decide whether to offer `HouseholdScopeToggle` — generalized
with a `basePath` + `extraParams` prop (calendar carries `month` through both
scope links, so paging months no longer silently resets scope to `mine`).
Card ownership: a `cardId → ownerLabel` map is built server-side in
`getDashboardData` from each partner's pre-merge slice (no owner field added
to `CardObligation` — the engine stays free of any user concept);
`CardsBreakdown` badges partner cards with it. Cross-app copy audit: every
household disclosure/consent string across settings, `household-card`,
`household-sharing-card`, `shared-transaction-list`, and the scope toggle was
extracted verbatim (no wording changed) into `src/lib/copy/household-copy.ts`
and is now scanned by `tests/unit/household-copy.test.ts` against the same
guardrails as `coach-copy.test.ts` (zero shame language, every disclosure
states what is/isn't shared) — previously this copy was inline JSX and never
guardrail-scanned. All existing strings passed unchanged.

Gate (real 2026-07-12): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — tsc/eslint clean, **2305 unit / 179 files**, build clean, **104
e2e** (+1: slice-5 T6 golden-safety lock on `/cards` + `/calendar`).

## Wave S: S.3 docs-lint script (#217)

`scripts/docs-lint.ts` — zero-model-call check over every tracked `*.md` file for
unallowlisted "Pulse" mentions, hardcoded test-count claims outside docs/STATUS.md,
missing `> HISTORICAL` archive banners, and stale verify-command phrasing. Ledgers
(DECISIONS/DECISIONS_INDEX/STATUS/PROGRESS/REGRESSION_LEDGER/TASKS) and anything
already bannered HISTORICAL are exempt (frozen records). `npm run docs:lint`; a
non-gating `continue-on-error: true` step runs it in CI alongside (not inside) the
required verify job.

Gate (real 2026-07-11): `bash scripts/verify.sh` → **VERIFY GREEN** —
tsc/eslint clean, **2285 unit / 178 files**, build clean. `docs:lint` itself: 0
findings across 49 markdown files (confirms S.2 D1–D8 holds). Known limitations
(accepted): warning-only by design (see DECISIONS #217 rationale); allowlists are
named per-file/per-string rather than a general heuristic, so a genuinely new
leak in an unlisted file would still be caught, but a new *legitimate* historical
reference in a not-yet-exempted doc will false-positive once and need a one-line
allowlist addition.

## Wave 4.2 slice 3: Shared transactions in the register (#213)

`getSharedTransactionsView()` SEPARATE from `getTransactions` (§4.5); scoped
`categoryNamesByIds` (never a `getCategoryMeta` widening — F3); read-only
`SharedTransactionList` on /transactions (owner badge, no triage affordances);
consent copy updated. Locks T1/T2/T3/T4/T6 + F3 + personal-register isolation.

Gate (real 2026-07-10): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2271 unit / 177 files**, build clean. Targeted e2e
household.spec **4/4** (demo golden-safety on settings/accounts/transactions +
member-state share round-trip + axe). Known limitations (accepted): shared
section capped at 100 most-recent (truncation disclosed; no pagination yet);
shared rows not filterable via the personal register filters; no member-state
e2e for the shared-txn DOM (integration covers the data path; two-browser
partner round-trip deferred).

## Wave 4.2 slice 2: Household account sharing (#212)

`partnerIdsOf`/`partnerSharedAccountsWhere`/`visibleAccountsWhere` in authz.ts
(§4.3 central helpers; EXACT `{ userId }` degeneracy deep-equality-locked, T6);
`getAccountSharingView()` as a SEPARATE query path from `getAccountsView`
(#192/T9 detector-input constraint, unit-locked with a provably trip-worthy
twin); `setAccountShared` (owner-only row scope, self-guarding ON-write,
audited); `HouseholdSharingCard` on /accounts (member-only render).

Fresh-context Fable critic cycle 1 FAIL (1 P1 + 3 P2) → all fixed in-cycle +
re-verified. P1: setAccountShared(ON) vs leave/remove race could strand a
consentless flag that would auto-share into the user's NEXT household — fixed
both sides (membership re-checked inside the ON-write's own where; join paths
reset the joiner's flags atomically; both locked by tests). P2s: consent copy
states the full disclosure; owner's toggle list not currency-filtered (consent
must always be visible/revocable); member-state e2e (real signup → household →
share round-trip → axe AA at 380px). Known limitations (accepted, DECISIONS
#212): partner account ids ship to the client (all actions userId-scoped);
no rate limit on the toggle (matches declineInvite; self-scoped); slice-3+
surfaces composing `partnerSharedAccountsWhere` must replicate the currency
guard where money aggregation demands it (partner-side /accounts display does).

Gate (real 2026-07-10, post-critic): `bash scripts/verify.sh` → **✅ VERIFY
GREEN** — tsc/eslint clean, **2263 unit / 176 files**, build clean. Targeted
e2e household.spec **3/3** (demo golden-safety absence + member-state real
share round-trip + axe WCAG-AA).

## Wave 3.2: weekly self-audit Critic (#211, TASKS 3.2)

Additive `SelfAuditSnapshot` + pure bps rates + `/api/cron/audit` (Mon 15:00)
+ AI-trust `SelfAuditMetrics`. Review = triage queue snapshot; unknown =
UnknownQuestion window; alert act = NotificationSent vs engagement proxy
(radar/connection). No money fields.

Gate (real 2026-07-10): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2248 unit / 175 files**, build clean (incl. `/api/cron/audit`).
Known limitations (accepted): (1) alert act-rate is a proxy until 3.5; (2)
unknown denominator is parser-unknown attempts only; (3) empty until first cron
fire (demo shows empty-state copy).

## Wave 4.2 slice 1: Household membership core (#210)

Schema (3 tables + inert `Account.sharedToHousehold`), pure membership engine,
`requireViewer()` lazy-repair self-heal, the 7 actions, /settings Household card.
Fresh-context Fable critic cycle 1 FAIL (1 P1 + 3 P2) → all fixed in-cycle +
re-verified (demo-user guard; enumeration-safe gate order; serializable accept
claim; sticky declines). Known limitations (accepted, documented in DECISIONS
#210): dev-fallback invite-code salt when AUTH_SECRET is absent (demo-mode
zero-env rule; real deploys always have AUTH_SECRET); T11 concurrency locked by
determinism units + scoped-updateMany construction, not a true concurrent probe;
invite-existence timing oracle (cuid ids unguessable); ghost-household edge via
acceptInvite after a lost double-leave reap race (harmless — flags already
reset, accepter promoted at next read, still lazily reapable). Sharing UI +
`visibleAccountsWhere` are slice 2 — the flag exists but NOTHING reads it yet.

## Wave 3.1: EngagementEvent capture (#209, TASKS 3.1)

Additive `EngagementEvent` + closed-set validator + dashboard hooks
(viewed/dismissed/expanded/acted). First-party only; PRIVACY.md + Settings
AI-trust disclosure. **No read path** — layout unchanged until Wave 3.3.

Gate (real 2026-07-10): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2195 unit / 171 files**, build clean. Known limitations
(accepted): (1) deletion-preview counts omit these rows (ledger precedent);
(2) demo dashboard CTA taps append rows (inert for goldens); (3) `viewed` only
on return-moment (not every card mount — avoids write amplification).

## Wave 2.2: UnknownQuestion ledger (#208, TASKS 2.2)

Additive `UnknownQuestion` + pure `scrubQuestionText` + `recordUnknownQuestion`
on every parser-`unknown` Ask (rescued or not). Deterministic routes write
nothing. Money engines never read the table → golden-safe. PRIVACY.md discloses
scrubbed storage.

Gate (real 2026-07-10): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2189 unit / 169 files**, build clean. Known limitations
(accepted): (1) deletion-preview counts omit these rows (NotificationSent/
ValueReceipt precedent; cascade itself is complete); (2) demo Ask of gibberish
will append rows in the shared demo DB — not consumed by goldens; (3) no prune
cron yet (Wave 2.3 mining can add retention).

## Wave 1.7: personalized triage alternatives (#207, TASKS 1.7)

Soft hints for swipe-left: pure `deriveCorrectionHints` (same signature +
latest-wins + #44 sign guard as learned rules; threshold = 1; conflicts → no
hint). `suggestAlternatives(txn, { personalized })` merges base → personalized
→ generic (cap 3). Server: `loadCorrectionInputs` shared with learned rules;
`getTriageItems` / `getTriageGroups` pass hints. Demo/zero corrections → [] →
byte-identical golden. No schema. Numbered #207 because #206 was claimed by
value-receipts in a parallel session.

Gate (real 2026-07-10): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
**2179 unit**. Known-answer tests in `suggest-alternatives.test.ts`.

**Known limitations (accepted):** one consistent correction is enough to hint
(earlier than LEARN_THRESHOLD=2 auto-rules); conflicting categories for a
signature suppress the hint entirely (no majority vote).

## Wave 1.3: value-receipts ledger — "What Aimplifi caught" (#206, TASKS 1.3)

Append-only `ValueReceipt` (additive; `@@unique([userId,key])`) + pure
`engine/receipts`: amounts copied verbatim at catch time (reminder →
cashRequiredCents; radar → the alert's own coverTransfer amount; price
increase → monthlyCents). Minting: reminder/radar receipts ONLY on real
delivery (reminders/notify crons; channel-agnostic `payment_due` keys →
email+push mint one receipt per catch; ESTIMATED reminders mint nothing);
price receipts keyed on the PRICE TRANSITION
(`price_increase:merchant:from>to`, from/to/changedAt threaded onto
price-increase Opportunities) and minted where the flag is actually surfaced
(/coach render; digest cron only after a real send). Surfaces: /coach
`value-receipts-card` (hidden until the first catch) + a digest tally via the
SHARED `receiptLines`; the digest null-rule is unchanged (a tally alone never
triggers a send). Honesty is structural: the summary is per-kind counts/totals
only (no cross-kind dollar field exists in the type) and a coach-copy test
bans "saved you / earned you" phrasing — the tally counts what was SURFACED,
never outcomes.

**Hostile critic (fresh-context Fable, refute-by-default): cycle 1 = 0 P0/P1,
4 P2 — all fixed in-cycle:** digest price-mint was not delivery-gated (now
mints only after a real send); price keys were detection-date-anchored and
re-mintable under re-import churn (now transition-anchored); estimated
reminder amounts entered the permanent tally unmarked and could double-mint
when the real statement's due date differed (estimates now mint nothing —
undercount-safe); PRIVACY.md omitted the new table (now discloses ValueReceipt
AND the pre-existing NotificationSent). P3 fixes: seed→opportunity threading
lock in insights.test; redundant `@@index([userId])` dropped.

**Known limitations (accepted, documented):** (1) radar catches count only on
actual push delivery — a user with no push subscription accrues none even if
the dashboard showed the warning (honest: nothing was proactively delivered);
(2) the mocked-provider unit cron tests sweep every user in the vitest DB, so
its demo user can accrue receipt rows — test-DB residue only, reseed clears,
the e2e golden DB untouched; (3) receipts are append-only history — later
renames don't rewrite recorded labels (by design); (4) deletion-preview counts
omit receipt rows (NotificationSent precedent; the cascade itself is complete);
(5) a non-P2002 receipt-write error in the notify loop defers that user's
remaining pushes to the next sweep (contained by the per-user try).

Gate (real 2026-07-10, post-critic): `bash scripts/verify.sh` → **✅ VERIFY
GREEN** — tsc/eslint clean, **2170 unit / 166 files** (receipts engine 17 +
receipts-server integration 7 + digest/coach-copy/cron/insights additions),
build clean. Targeted e2e: phase3-coach (incl. new "1 catch … $2.50/mo" demo
assertions + reload idempotency) **1/1**, payment-reminders + notifications
**6/6**, phase5-a11y + auth **10/10** (critic-run, WCAG-AA with the new card).

## Wave 1.4: savings-rate streaks + celebration copy (#205, TASKS 1.4)

Pure `computeSavingsStreak` over existing `MonthlyFlow[]` (bps, no floats).
COACH_COPY `savingsStreak` / `savingsPersonalBest` guardrail-registered.
`SavingsRateCard` shows streak (≥2 months) and personal-best lines.
Gate: verify ✅ (unit + coach-copy); phase3 e2e asserts streak or PB visible.

## Wave 0.3: Resend domain verified (#204) — 2026-07-10

Owner verified `aimplifi.app` in Resend (Vercel DNS) and confirmed a Delivered
test to `michael.lee.p@gmail.com`. Email + digest env path is live. Cron *fire*
still UNVERIFIED. Sentry remains deferred (#203).

## Wave 1.6: Glass-Box shareable snapshot (#202, TASKS 1.6)

Client-only redacted share from the open reconciled Cash-Needed Glass-Box
panel. Pure `redactTraceForShare` / `formatShareText` (amounts unchanged;
card names → Card N; notes stripped). UI copies text (+ best-effort PNG via
Canvas 2D, no html2canvas) — no network. Share hidden when `!reconciles`.
Gate: verify ✅ **2117 unit / 163 files** (+4/+1); glass-box.spec share case.

**Privacy note:** Opus privacy review still recommended (TASKS routing) —
inline check: no server path, share-target excludes live labels, clipboard
fallback downloads .txt only.

## Wave 4.1: household architecture spike — decision doc landed (#200) — 2026-07-10

`docs/HOUSEHOLD_ARCHITECTURE.md` (DECISIONS #200): household entity + explicit
membership (one household per user in v1) + per-account, owner-consented,
**read-only** sharing (`Account.sharedToHousehold Boolean @default(false)`), NOT
a tenant layer. No existing action's authz changes; one central
`visibleAccountsWhere` helper; joint cash-needed via query-scoped
`getSharedSnapshotSlice` + pure `mergeSnapshots` (engine untouched); deterministic
lazy-repair lifecycle; invite = hashed out-of-band code + DB-row email match.
Docs-only — **no schema/product code shipped**; three tables + one Boolean are
DESIGNED, not pushed. Fresh-context Fable hostile critic: cycle 1 **FAIL (5 P1,
5 P2, 1 P3)** — all confirmed real (deletion-transaction promotion structurally
impossible; Household orphan on owner deletion; `getCategoryMeta` widening
contaminating six personal surfaces; invite trust on unverified email + dormant
allowlist; merge filtering a full cross-user snapshot in memory) — all fixed in
the doc, cycle-2 self-check no open P0/P1. Invariants T1–T12 each mapped to a
future locking test; 6-slice MVP plan recorded in TASKS 4.2.

Owner answered all three open questions same day (DECISIONS #201): partner
categorization YES (slice 6, single-teacher boundary — one-off recategorize,
acting-user corrections, no partner rules, no prediction labeling, Fable
critic); ONE joint household digest (slice 7); naming "Household". Slice plan
is now 8 slices; design fully unblocked for TASKS 4.2.

Gate (real 2026-07-10, docs-only — no source touched): `bash scripts/verify.sh`
→ **✅ VERIFY GREEN** — tsc/eslint clean, **2113 unit / 162 files**, build clean.

## Wave 1.5: route-specific empty states (#199, TASKS 1.5)

Zero-account coach/goals/calendar no longer show the shared dashboard welcome.
Extracted `ConnectOnboardingPanel` (same SimpleFIN/Plaid/CSV/manual testids);
`EmptyCoach` / `EmptyGoals` / `EmptyCalendar` keep route `<h1>` + dashed card
framing. Dashboard/cards/etc. still use `EmptyDashboard`. Gate: verify ✅
**2113 unit / 162 files**; auth.spec 3/3 + guided-onboarding 1/1.

## Wave 0.3: production env activation (partial, #198) — 2026-07-10

Linked local checkout to existing Vercel project `reiforge/aimplifi`
(`prj_Zr3x9TKUklr2LRswwc1rqZR4lcRO`); prod already live at https://aimplifi.app
(Neon `DATABASE_URL` + `AUTH_SECRET` + `DATA_ENCRYPTION_KEY` + Plaid + `XAI_API_KEY`
were already set — this was never a greenfield deploy).

**Added to Production (2026-07-10) and redeployed** (`dpl_7h8vU7LeEWoiUPjzLEH3N7aJGd9T`,
READY, aliased to www.aimplifi.app):
- `SIGNUP_ALLOWLIST=michael.lee.p@gmail.com` (owners still always allowed via
  baked `OWNER_ALLOWLIST` incl. lizysuh55@gmail.com — DECISIONS #60)
- `CRON_SECRET` (generated)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT=mailto:michael.lee.p@gmail.com`

**Still missing (owner keys — cannot invent):**
- ~~`RESEND_API_KEY`~~ **SET 2026-07-10** (redeployed). Default From =
  `Aimplifi <reminders@aimplifi.app>` — confirm that domain/sender is verified
  in the Resend dashboard or mail will fail at send time.
- ~~`SENTRY_DSN`~~ **DEFERRED by owner (#203, 2026-07-10)** — personal/family
  app; paid error tracking not wanted for now. Dormant client stays in place;
  activate later only if needed.

**Seed recommendation: DO NOT run `prisma db seed` / `--force-prod`.** Owner
account is already active on the live Neon DB; seed deletes every row.

**Cron fire verification:** schedule is in `vercel.json` (4 jobs); bearer secret
now set. Actual Vercel Cron invocations = UNVERIFIED until a scheduled run is
observed in Vercel logs (or a manual bearer-authenticated probe). Requires
Vercel Pro for weekly digest + 4-cron count (Hobby is daily-only / 2-cron).

See DECISIONS #198.

## Wave 1.2: contextual Ask follow-up chips (#197, TASKS 1.2)

After every non-unknown Ask answer, up to 3 contextual follow-up chips
(static intent→full-NL-question map). Pure `engine/assistant/follow-ups.ts`
(`followUpQuestions`); server merges onto `answer.suggestions`; UI reuses
existing chip plumbing (`ask-follow-up`). No new parsing — every chip is a
complete question the existing parser already routes. `unknown` keeps
`ASSISTANT_SUGGESTIONS` from `answerUnknown`.

Gate (real 2026-07-09): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2113 unit / 162 files** (+4/+1: assistant-follow-ups),
build clean. Targeted e2e `ask.spec.ts` **9/9** (incl. new follow-up chips
re-ask → Costco biggest-purchase). See DECISIONS #197.

## Wave 1.1: return-moment "Since you were away" greeting (#195, TASKS 1.1)

First Wave-1 (return-loop) slice and the audit's highest-impact idea (idea 3,
impact 9): a returning user after a >7-day gap is greeted with a short story of
what happened while away, instead of being punished with a backlog (audit
persona E). Composes FOUR already-computed pieces and originates no number.

Pure composer `engine/return-moment/build.ts` (`buildReturnMoment`), mirroring
`buildWeeklyDigest`: takes `daysSinceLastSeen` + the four pieces and returns a
structured `ReturnMoment | null`. Null for a first-ever visit
(`daysSinceLastSeen === null`) or a gap of ≤ 7 days; a quiet return still greets
honestly (radar `clear`, zero counts) — the reassurance is the point. Every
value is copied verbatim: radar clear/warning from the tested `RadarResult`,
auto-filed count from a userId-scoped `CategoryPrediction` query, price bumps
from `findOpportunities` (`kind:'price-increase'`), and one guardrail-scanned
sentence from `MoneyReview.improvement`. No cents are formatted in the engine
(formatCents stays a UI-boundary concern).

Additive nullable schema `User.lastSeenDate String?` — a CALENDAR DATE (the
provider's "today"), not a timestamp, per the date-discipline rule, so the gap
is TZ-free and lives in the same civil-date domain as every other business date.
Thin server `server/return-moment.ts` reads the stored date, measures the
civil-day gap (`daysBetween`), stamps today (only when changed → no write
amplification; short-circuits the count query below the threshold), and — on a
real return — counts silently auto-filed predictions (`confidenceBps >=
AUTO_SILENT_BPS`, `createdAt >=` the previous visit's midnight-UTC) then calls
the engine with the page's ALREADY-fetched `coach.review` / `coach.opportunities`
/ `radar.radar` (no re-fetch, no new money math). The dismissable
`ReturnMomentCard` (which also self-retires once the visit stamps today) renders
directly under THE cash-needed answer.

Golden/demo-safe by construction: no engine reads `lastSeenDate`, and the
fixed-today demo user's every stamp equals the last → gap always 0 → no card.
Maker→Checker (proportionate inline pass — display-only surface + a benign
last-seen write; no money/authz/routing): no P0/P1. Accepted P2s (documented):
the auto-filed `since` boundary is midnight-UTC-approximate (a count, not money —
errs toward inclusion); the card's own copy is not yet in the guardrail-scan set
(trends-copy precedent); and the positive card RENDER is not browser-tested —
proven by the engine + integration tests, since the shared fixed-today demo user
can't seed a >7-day gap without racing the auto-stamp (the #192/#183 "positive
path by integration, demo shows nothing by e2e" precedent).

Gate (real 2026-07-09): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — tsc/eslint clean, **2109 unit / 161 files** (+17/+2: 9 known-answer
engine — gate boundary, verbatim copy, honest-empty, no-mutation — and 8
real-`getReturnMoment` integration — first-visit/active/7-day-boundary/10-day
return/no-double-greet/silent-band count/price-increase filter/radar warning),
build clean, **95 e2e** (+1: demo golden-safety — dashboard renders, no greeting,
holds across a reload).

## Wave 0.1: CI arbiter confirmed GREEN (owner-verified, 2026-07-09)

GitHub Actions had been **disabled** for the repo — which is why no run appeared for
#181 (the `.github/workflows/verify.yml` file was correct and pushed all along; #193
diagnosed this). The owner enabled Actions; the `verify` workflow run **#15**, triggered
by the #194 push, was **owner-confirmed GREEN** on the clean `ubuntu-latest` runner —
the first confirmed CI pass of `scripts/verify.sh` (typecheck + lint + unit + build +
full e2e). Significance: CI is now a real arbiter, the single-machine-loss risk (TASKS
0.1) is retired, and because a headless Linux runner has no OS display scaling, a green
CI e2e also independently confirms the mobile-380 viewport artifact is Windows-local
(not an app bug). Any future red CI e2e is therefore a real failure, not the flake.

## Wave 0.5: operator activation-checklist panel on /settings (#194, TASKS 0.5)

An operator-facing "Activation checklist" card on /settings that reads env-var
**presence** only (never values) and shows which dormant systems are live vs dormant,
with the exact env-var **names** still needed for each dormant one. Answers "on this
deployment, is email/push/digest/Sentry/cron actually going to fire?" at a glance.

Pure engine `engine/ops/activation.ts` (`buildActivationChecklist` + `activationSummary`):
takes four presence booleans (cronSecret / email / push / errorTracking) and returns a
fixed-order 7-row map — base capabilities (error-tracking, email, web-push,
scheduled-jobs) then the composed delivery jobs (payment-reminders, weekly-digest,
push-notifications). "Live" is honest about **compound** gates: a delivery job is live
only when BOTH its `CRON_SECRET` bearer AND its provider are present — the same two-part
gate the cron routes encode. The engine reads no `process.env` (booleans in), so it is
deterministic, unit-testable, and cannot leak a value.

The server component (`/settings/page.tsx`, an RSC) supplies the booleans via the three
existing `*Configured()` helpers (`emailProviderConfigured`/`pushProviderConfigured`/
`errorTrackingConfigured`) plus an inline `!!process.env.CRON_SECRET`, and renders the
derived rows inline — only booleans and env-var **names** cross into the markup; no secret
value ever reaches the client (Next inlines only `NEXT_PUBLIC_*`). Shown to all signed-in
users (invite-only app, no admin role) — acceptable operational transparency, no value
disclosed. Maker→Checker (proportionate: display-only, no writes/money/schema): no secret
path, compound gates correct, a11y status conveyed by text not color, no P0/P1.

Gate (real 2026-07-09): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2092 unit / 159 files** (+7 known-answer: all-off/all-on/partial
compound + secret-free-names invariant + summary counts), build clean, **94 e2e passed**
(+1: renders all 7 rows, engine↔UI coherence — summary count equals Live badges — dormant
rows advertise only known env names, axe WCAG-AA scoped to the card). The e2e asserts
coherence, not a hard "0 of 7", so it holds both in CI (all dormant) and locally where
`.env.local` may set some keys.

## Wave 0.2: local full-e2e unblocked — the "mobile-380 flake" was a masked deterministic bug (#193)

Task 0.2 was scoped as "quarantine the mobile-380 viewport flake so local `VERIFY_E2E=1`
can exit 0." Investigation found the premise was wrong: the recurring "full e2e can't
exit 0 on this Windows machine" (reported across #183/#186/#187) was **not** the viewport
flake — it was a **deterministic** `auth.spec.ts` failure hiding behind that attribution.

Root cause: #182 ("Sign out of all devices" / multi-device session revocation) added a
button (`revoke-sessions-submit`) on /settings whose accessible name **contains** "Sign
out". `auth.spec.ts` ends its nav loop on /settings, then clicked a bare
`getByRole('button', { name: 'Sign out' })` → Playwright **strict-mode violation** (2
matches), on **every** run. #182 landed after auth.spec's last edit (#175) and never
updated the now-ambiguous locator; the red gate was then written off as the known flake
in three subsequent sessions. Fix: scope the click to the header form
(`getByTestId('sign-out-form').getByRole('button', { name: 'Sign out' })`) — a **test-only**
one-line change (the revoke button keeps its own render coverage in
`account-deletion.spec.ts`; no product code touched).

**No quarantine was needed.** Across three full `mobile-380` suite runs this session the
viewport-interception flake did not reproduce (0 `intercepts pointer events` failures) —
likely defused by the #187 nav redesign and/or Playwright 1.60.0. The lesson file is kept
(intermittent flakes can recur) but annotated with this correction and a "read the error
signature before blaming the flake" rule. Standing assumption is now: **full e2e exits 0
here.** Maker→Checker: test-only, no golden/money/schema surface; verified no other spec
carries the same bare `Sign out` locator (grep: only auth.spec, now scoped).

Gate (real 2026-07-09): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN** —
tsc/eslint clean, **2085 unit / 158 files**, build clean, **93 e2e passed** (first time the
full gate incl. Playwright exits 0 on this machine). Two prior full runs same session: one
green, one green-but-for the deterministic auth failure this fixes (0 viewport failures in
either).

## Wave 1.8: cross-provider duplicate-account guard (#192, DECISIONS #192)

Answering the owner's "is running both Plaid and SimpleFIN redundant?" surfaced a real
data-integrity gap: the app has **no cross-provider dedup**. Plaid, SimpleFIN, and manual
entry each mint their own `Account` row, and transaction dedup is
`@@unique([accountId, providerRef])` — scoped to one account and one provider's id scheme.
So the SAME real account connected through two providers is stored twice and its
balance/transactions double-count in net worth, spending, and cash-needed (verified against
the ingest + `netWorthSeries` paths — no code matches a Plaid account to a SimpleFIN one).

Shipped an **advisory** guard: pure `engine/account/duplicates.ts` (`detectDuplicateAccounts`)
flags cross-provider pairs sharing account `type` + `currency` with ≥1 signal — matching
last-4 (high), identical non-zero balance (high), or a shared distinctive name token (medium);
`demo`/seed rows never compared; zero-balance token-less pairs never flagged. Surfaced as a
**display-only** amber `role="alert"` card on /accounts (`duplicate-accounts-warning`) — it
never auto-deletes (which side to keep is the user's call; they disconnect via existing flows),
computed over the currency-guarded `supported` set so it never references a hidden row.
Matching is heuristic by necessity (SimpleFIN carries no mask → no exact cross-provider key).

Maker→Checker self-review (data-integrity display surface, non-destructive — proportionate to
an inline hostile pass, not a multi-agent workflow): confirmed golden-safety (demo user is
single-provider → zero pairs, integration-tested); no false positive on same-provider pairs
(Plaid dedups within itself), different type/currency, or zero-balance empties; advisory-only
so a false positive costs a dismissible card, never data loss. Accepted limitation (documented):
purely heuristic — a user with two genuinely different accounts at the same bank with a shared
name token gets a `medium` false-positive warning (safe: advisory, and the reason string shows
exactly why); and two same-institution accounts renamed with no shared token + different
balances would be missed (`low`-signal false negative). Both are acceptable for a warning.

Gate (real 2026-07-09): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — tsc/eslint clean,
**2085 unit / 158 files** (+14/+1: 12 known-answer engine + 2 real-`getAccountsView`
integration incl. the demo-user=0 golden-safety control), build clean. No new Playwright spec
(the demo user shows no warning by design; the positive path needs throwaway cross-provider
rows, which the integration test drives against the real server view — the account-deletion
precedent for a destructive/data-shaped flow proven by integration rather than browser e2e).

## Wave 0.4: live provider spot-checks — Plaid VERIFIED, SimpleFIN re-confirmed (#191)

Ran the two provider validators live from the dev machine (egress to the providers
is open here; sandbox creds are in `.env.local`).

- **Plaid sandbox** (`npm run plaid:validate`): `✅ VALIDATION PASSED` — 12 accounts
  (2 credit), 50 transactions with correct signs (5 outflow / 1 inflow in the newest-6
  sample), 1 statement from `/liabilities/get`; encrypted `PlaidItem` token stored
  (len 110); item + temp user cleaned up. Flipped `docs/PLAID_WALKTHROUGH.md` from
  **UNVERIFIED → LIVE-PATH VERIFIED** for the exchange / `/accounts` /
  `/transactions/sync` / `/liabilities/get` paths. Still UNVERIFIED (need a
  human/hosted step, not the headless validator): the browser Link UI and the live
  webhook round-trip.
- **SimpleFIN demo** (`npm run simplefin:validate <accessUrl>`): re-confirmed the
  `fetchSimplefinAccounts` → map path — 3 accounts, `"114125.51"` → `11412551` cents,
  Groceries categorized, outflow signs preserved. Already VERIFIED (2026-06-22); this
  re-confirms it. **Finding + fix:** the public demo *setup token* is single-use and
  was permanently consumed by the first claim (re-POST → `403 Forbidden (was it already
  claimed?)`), so `scripts/simplefin-validate.ts` now also accepts an already-claimed
  access URL directly (dev-script-only change; the claim step stays covered by the
  mocked-server unit test). Pass `https://demo:demo@beta-bridge.simplefin.org/simplefin`
  to re-run against the free demo.

Docs/dev-script only — no app/engine/money/schema code touched, so no golden moves and
no critic cycle (docs-only precedent #185). Gate below.

**Blocked in this environment (owner-only, credentials):** Wave 0.3 (Vercel + Neon env
vars, Sentry DSN — no `VERCEL_TOKEN`/`NEON_API_KEY`/CLI/`.vercel` link, `gh` unauth,
prod secrets in the Drive crash-backup folder) and Wave 0.6 (Neon scheduled backups —
Neon dashboard/ops). The code/config side of 0.3 is confirmed ready: `vercel.json` wires
all four crons (`sync`/`reminders`/`notify`/`digest`); `docs/DEPLOY.md` is complete.

## Post-Phase-5: Bounded per-user threshold tuning + live prediction log (#190, TASKS 3.6)

Pure engine (`categorize/tuning.ts`): per-user Brier over user-labeled predictions nudges
the AUTO_FLAGGED boundary ±500bps around 7000, ≥20 committed samples, recomputed from
scratch, one-sided auto-revert on recent-window regression; can never create a silent
filing (aiBadge stays pinned to the global AUTO_SILENT). Disclosed on the Settings
AI-trust panel. Critic F1 fixed in-cycle: live ingest never wrote CategoryPrediction
rows (seed-only), so the #177 accuracy panel and this loop were demo-ware — now all 4
ingest paths log the pipeline's verdict and predictions follow Plaid id churn like
Corrections. **Known limitations:** live committed labels are corrections-biased
(miss-heavy), so live tuning mostly tightens (safe direction) until an explicit
confirm surface gives it positive evidence; rows ingested before #190 have no
prediction rows (going-forward data only). Gate (real 2026-07-09):
`bash scripts/verify.sh` → **✅ VERIFY GREEN** — **2071 unit / 157 files** (+24:
tuning engine + pipeline opts 17, labeledAt lifecycle 3, live ingest log 4); build
clean. E2e (real, mobile-380): settings-dials + phase2-triage 8/8, transactions 16/16.

## Post-Phase-5: Prod error tracking — dormant Sentry (#189, Gap 6 §2)

Thin `lib/errors.ts` envelope client + `instrumentation.ts` `onRequestError` +
error-boundary capture. Dormant without `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`
(same stance as email/push). CSP widens ingest only when configured. Owner
activates by setting the DSN in Vercel (DEPLOY.md). Gate (real 2026-07-09):
`bash scripts/verify.sh` → **✅ VERIFY GREEN** — **2047 unit / 154 files**
(+8 errors.test); build clean. **Remaining Gap 6:** §4 Neon backups (owner/ops).

## Post-Phase-5: Desktop header Settings/Sign-out overlap (#188)

Owner report after #187: on desktop, Settings overlapped Sign out. Cause: nav
`flex-1` + 13 text links expanded into the Sign-out sibling. Fix: wrap +
`shrink-0` Sign out; e2e bbox lock at 1280×800. Gate evidence in the #188 commit.

## Post-Phase-5: Mobile More-sheet nav (DECISIONS #187, Competitive-Gap Gap 3 §2)

Owner authorized the long-gated mobile secondary-nav redesign. Phones no longer
show 8 unlabeled top icons — header is brand + labelled **More** + Sign out;
More opens a bottom sheet with a 2-col labelled grid (Plan/Reports/Accounts/
Investments/Activity/Goals/Spending/Settings) plus Explore (Ask/Trends/Recurring/
Forecast). Five primary bottom tabs unchanged (`bottom-nav-*` e2e intact).
Desktop text nav unchanged. Gate (real 2026-07-09): `bash scripts/verify.sh` →
**✅ VERIFY GREEN** — tsc/eslint clean, **2039 unit / 153 files**, build clean.
Targeted e2e (mobile-nav + spending-plan + reports + investments + phase4 +
not-found) **18/18**. Full `VERIFY_E2E=1` still can't exit 0 on this Windows
machine (mobile-380 flake — unrelated; new More path uses mid-header clicks).

**Remaining after #187:** env-gated live Plaid/SimpleFIN spot-checks; ~~Gap 6 §2
error tracking~~ **DONE #189**; Gap 6 §4 Neon backups; Gap 5 benchmark line;
mobile-380 Playwright infra fix. Mobile-nav redesign is **done**.

## Post-Phase-5: ROADMAP ALSO CONSIDER UX/a11y burn-down (DECISIONS #186)

Resumed on "push, then continue" after the #171–#185 stack landed on `origin/main`
(`cd77bad`). Opus/Sonnet-lane per COMPETITIVE_GAP_PLAN §3. A read-only audit found
six of the ten ALSO CONSIDER items already built (#81/#89/#90/#166) and left stale
in the plan — same hazard as #185. Shipped the four genuine remaining items
(display/copy only, no engine/schema/money math):

1. Spending-plan allocation legend (`spending-plan-legend`) under the four-segment bar.
2. Dashboard overspent reframe: header "Over plan" + amount "Over plan by $X".
3. Empty-register no-data vs no-match (`hasFilters` → branched `txn-empty` copy).
4. Budgets no-target first-run hint (`budget-no-targets-hint` when `budgets.length === 0`).

Docs reconciled (ROADMAP ALSO CONSIDER + COMPETITIVE_GAP_PLAN §2 + this file).
E2E: legend labels; impossible-filter empty copy; hint visible→gone on budget set.
No critic cycle (UI-only, #81/#175 class). Gate (real 2026-07-09):
`bash scripts/verify.sh` → **✅ VERIFY GREEN** — tsc/eslint clean, **2039 unit /
153 files**, build clean. Targeted e2e (spending-plan + transactions register +
budget-targets) **4/4**. Full `VERIFY_E2E=1` still can't exit 0 on this Windows
machine (mobile-380 flake — unrelated).

**Remaining after #186:** ~~owner-design-gated mobile secondary-nav redesign~~
**DONE #187**; env-gated live Plaid/SimpleFIN spot-checks + Gap 6 §2 error
tracking + Gap 6 §4 Neon backups; Gap 5 benchmark line (market-data feed +
holdings history); mobile-380 Playwright infra fix.

## Post-Phase-5 reconciliation: Gap 3 §1 is already built (DECISIONS #185, Competitive-Gap Gap 3 §1)

Resumed on "continue" (Fable lane, #184 handoff). The plan §2 still listed "Gap 3 §1
loading skeletons + destructive-delete confirms" as unblocked-and-in-session-verifiable.
A read-only file:line audit found the whole 2026-06-24 ROADMAP "DO NEXT" backlog is
**already built** — the note was stale (the "written without noticing already-built" hazard
§2 exists to catch). Verified-built: `(app)/loading.tsx` (#81); recategorize-popover Escape +
outside-click dismissal (`transaction-list.tsx:315-323` / `:106-117`); `<title>` template
(`layout.tsx:17`) + `global-error.tsx`; empty states on reports/coach/life-energy/cards/
investments; `CardTitle` real heading (`ui/card.tsx:36-54`); Investments nav (#176-era);
inline goal/budget validation returns field errors, never throws (`goal-actions.ts:31-67` #166,
`parseBudgetTargetCents` #30); and every destructive **Delete** already confirms — account-data
typed-phrase (`engine/account/deletion.ts:16`), goal (#83), manual-account
(`accounts-list.tsx:509-517`), custom-category two-step.

**Budget-`Clear` adjudicated a non-gap (not a missing confirm).** The audit flagged
`clear-budget-button.tsx` one-tap "Clear" as missing confirmation by grouping it with the
Deletes. But the app follows a coherent, documented convention: *Delete a persistent entity*
→ confirm; *Clear a reversible attribute* → one-tap. Budget-`Clear` removes a display-only
per-category target (#30, restorable in seconds, no money/history loss); its true sibling is
manual-statement `Clear`, whose one-tap behavior is an EXPLICIT decision (STATUS
§manual-card-statements, "reversible, no money/history loss"). A confirm would make it
inconsistent with that sibling and fail the backlog's own "only change if markedly better" bar.

DOCS-ONLY reconciliation (no app-code/schema/engine/test change; #181/#184 precedent — no
critic cycle). No source touched → tsc/eslint/vitest/build unchanged from #184's green.
Gate (real output 2026-07-08): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — typecheck/lint
clean, **2039 unit / 153 files**, build clean (see evidence in the commit).

**Fable-lane in-session-verifiable backlog is now exhausted.** ALSO CONSIDER mechanical
UX/a11y list was the remaining Opus/Sonnet-lane work — **burned down in #186** (four
genuine gaps shipped; six already-built items struck in ROADMAP). Remaining: env-gated
(live Plaid/SimpleFIN spot-checks, Gap 6 §2 error-tracking DSN, Gap 6 §4 Neon backups)
and the owner-design-gated mobile-nav redesign.

## Post-Phase-5 refinement: proactive-cron scheduling (DECISIONS #184, Competitive-Gap Gap 2 §2/§3)

The notify (Web Push) and digest (weekly email) sweeps were fully built,
`CRON_SECRET`-guarded, and unit-tested (`cron-notify.test.ts`/`cron-digest.test.ts`)
but were absent from `vercel.json` crons, so the entire proactive/stickiness layer
never fired even with keys set (the plan's "genuine remaining gap"). Added both
schedules (`/api/cron/notify` daily 13:00 UTC, `/api/cron/digest` Mon 14:00 UTC) and
a bidirectional coherence regression (`tests/unit/cron-wiring.test.ts`): every
`api/cron/<name>/route.ts` must be scheduled AND every scheduled path must resolve to a
route — so neither "built-but-unscheduled" nor "scheduled-but-404" can reappear.
Delivery stays dormant without `VAPID_*`/`RESEND_API_KEY` (safe no-op, records nothing),
so wiring perturbs no golden and is inert until an operator sets keys. Deploy caveat
(documented, not a code defect): the weekly schedule + 4-cron count need Vercel **Pro**
(Hobby is daily-only, 2-cron max).

Gate (real output 2026-07-08): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
typecheck/lint clean, **2039 unit / 153 files** (+3/+1, the wiring test), build clean
(all four `/api/cron/*` routes compile as functions). No new e2e: a `vercel.json` cron
is a platform trigger with no locally-drivable runtime surface, and the handlers
themselves are already integration-tested against their real GET (consistent with the
reminders/sync cron precedent — scheduling is an operator deploy step).

## Post-Phase-5 refinement: sync-failure surfacing (DECISIONS #183, Competitive-Gap Gap 1 §4)

The connection-health engine graded data *recency* (#171/#179) but by design never
claimed a connection was "broken" — there was no persisted sync-error signal to observe.
This slice creates that signal and surfaces it as a dashboard reconnect alert. Nullable
`lastSyncAttemptAt` + `lastSyncError` on `SimpleFinConnection`/`PlaidItem` (PlaidItem also
gains `lastSyncedAt`); providers persist a SANITIZED reason (`safeSyncErrorReason` →
allow-listed `{auth,timeout,network,server,unknown}`, never the raw error, which can carry
the credentialed access URL — #5) on a caught sync failure and clear it on every success.
Pure `classifyConnectionHealth`/`selectConnectionAlerts` grade `broken` IFF `lastSyncError
!= null` — never inferred from recency — and `ConnectionAlertsCard` renders the reconnect
prompt (message never echoes the recorded reason). Golden/demo-safe by construction (the
demo user has no connection rows → zero alerts).

Gate (real output 2026-07-08): `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
typecheck/lint clean, **2036 unit / 152 files** (+26/+2), build clean; `connection-health`
e2e **3/3** (broken-connection render + axe WCAG-AA + the demo count-0 negative). Full
`VERIFY_E2E=1` still can't exit 0 on this Windows machine: the 4 failures are ALL the
documented mobile-380 bottom-nav viewport flake (item #16 / lesson file), on flows where
this card renders `null` (zero DOM added) — not a regression.

Hostile Critic (fresh-context, refute-by-default): could not break claims 1–8
(honesty/no-false-positive, no-credential-leak, recovery, non-masking, refactor-safety,
golden-safety, multi-item-Plaid isolation, ownership). **1 P2 confirmed + FIXED:** the
SimpleFIN success bookkeeping write sat inside the failure-catch, so a transient DB blip on
that final write (after ingest committed) could persist a false "broken" alert
(self-healing, but a false fact) → relocated the success write OUTSIDE the try, so only a
real ingest failure can set the signal. **Accepted P2 (documented):** Plaid's per-item
success write keeps the same merged-write shape; the identical self-healing edge is left
as-is because the Plaid live path is UNVERIFIED (no sandbox creds) and adding control-flow
to that untested loop for a self-healing edge is disproportionate — the SimpleFIN
(verifiable) path is airtight.

## Phase 1 (complete — critic cycle 2 green)

Hostile Critic cycle 1 verdict: FAIL (2× P1). Both fixed in cycle 2; the
critic's adversarial probes are kept permanently in
`tests/unit/critic-scenarios.test.ts`:

- **P1-1 fixed:** transfer recommendation could be dated in the past when the
  first short date was today/overdue. Now clamped to `today`
  (`engine.ts`, regression: probes S3/S9).
- **P1-2 fixed:** the assembler dropped a delinquent (past-due, unpaid)
  statement into the estimate path, mislabeling real debt. Current-statement
  selection now also matches any statement with an unpaid remainder
  (`assemble.ts`, regression: probe S4).
- P2s addressed: future-dated balance snapshot (seed now dates the current
  month's snapshot at asOf), scenario toggle semantics (segmented buttons with
  `aria-pressed` + `aria-live` summary), tabular-nums on headline amounts,
  PHASES.md recommendation wording aligned with EDGE_CASES, this file created.

## Phase 2 (complete — critic cycle 2 green)

Critic cycle 1 verdict: FAIL (1 P0, 6 P1). All fixed in cycle 2; the critic's
probes live on as regressions in `tests/unit/critic2-*.test.ts`:

- **F1 (P0) fixed:** splitting a transaction double-counted it (parent +
  children) in the cash-needed pending projection and flow aggregates. Splits
  now mark the parent `isSplitParent`; every aggregation excludes parents and
  counts children (schema field + assemble/insights/transfers updates).
- **F2 fixed:** split validation now rejects mixed signs, zero parts,
  re-splitting parents, and splitting children; multi-writes run in
  `prisma.$transaction`.
- **F3 fixed:** batch apply no longer creates a silent durable rule — the same
  one-tap "Always / Just this once" consent prompt follows batches, and undo
  removes a consented rule via `becameRuleId`.
- **F4 fixed:** transfer descriptor patterns are anchored/word-bounded and
  transfer detection consumes the normalizer's verdict (one decision path) —
  "T-MOBILE PREPAY", "GIFT CARD PAYMENT", "GEICO AUTOPAY" no longer vanish.
- **F5 fixed:** the band-gap→review rule honors account/day scoping.
- **F6 fixed:** triage actions roll back the optimistic UI and surface an
  error banner on failure; corrections are never silently lost.
- **F7 fixed:** tree green (`npx vitest run` → 321/321).
- F8/F9 partials: `previousAmountCents` + `possiblyUnused` now persisted on
  RecurringSeries; whitespace descriptors get an "Unknown Merchant" fallback;
  `undoSplit` guards non-split rows; split input parses via
  `centsFromDollarString`. Remaining accepted P2s listed below.

## Phase 3 (complete — critic cycle 2 green)

Cycle 1 verdict: FAIL (1 P1). All hand-verified math passed (8/8 anchors to
the cent). Fixed in cycle 2:

- **P1-1 fixed:** the FI number now states its expense basis inline on the FI
  card ("…on $X/yr of spending — estimated from your last 6 full months × 2").
- P2s fixed: split parents excluded from life-energy list and recurring
  detection input; runway "Infinity" rendered as "no expenses yet"; negative
  savings-rate headline has honest copy; slider state clamped to its range;
  Money Review fallback no longer claims an improvement it didn't measure
  ("What held steady…"); opportunity projections state the assumed return rate.
- Phase 2 cycle-2 hardening from the same review: integer-cents split
  validation, one-action-at-a-time guard on triage gestures, empty-batch
  prompt guard.

## Phase 5 / final full-app critic: **PASS** (zero P0/P1)

Financial correctness 10/10 (30 hand-verified assertions incl. 6 brand-new
adversarial cash-needed scenarios, all exact to the cent), edge-case coverage
10/10. Findings, all P2:
- **P2-1 CSV formula injection — FIXED post-review**: `csvField` now prefixes
  `= + - @` / tab / CR-leading fields with an apostrophe; the critic's evidence
  probes were flipped to safe-behavior regressions (critic5-surface.test.ts).
- P2-2 rate limiter is in-memory/single-instance — accepted for v1, documented
  in authz.ts and ROADMAP #8.
- P2-3 cosmetic Recharts width(-1) console warning during headless e2e.

## Post-Phase-5 refinement: Spending Trends / insights (DECISIONS #74, surpass feature #7)

The "what changed & what to look at" surface (Copilot/Cleo/Monarch lead with it)
that the category/recurring/forecast views never exposed. Pure engine
`engine/trends/trends.ts` — a thin, exact layer over the tested
`spendingByCategory` (one spend definition, integer cents, no model calls):
pace projection for the in-progress month, completed-month category movers (last
month vs a ≤3-month average, ≥$20 AND ≥20%), largest purchases, and new merchants
(vs the prior 6 months). Non-actionable money movement ('Transfers & Other':
cash/transfer/cc-payment/uncategorized) is kept out of movers/largest/new and
aggregate pseudo-merchants out of new-merchants; pace alone keeps the full reports
total so the headline matches /reports & /spending-plan. `getSpendingTrends`
reads the same ownership-scoped snapshot; `/trends` page + a dashboard
`SpendingInsightsCard` + a reciprocal /reports link, NO 8th nav icon (380px bar
full at 7, #71).

Gate (real output 2026-06-23): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, **807 unit / 65 files** (+16: hand-
derived synthetic + a real-seed pinned run + an integrated normalize→engine test),
build clean, **46 e2e** (+3: discovery, render incl. Costco as the seed's biggest
June buy, WCAG-AA axe). One e2e iteration first caught a real dark-mode contrast
miss (an `opacity-80` on the % label, 4.42 vs 4.5:1) — FIXED before sign-off.

Hostile Critic (4 dimension critics + adversarial verification of every P0/P1):
financial 7 / edge-case 7 / security 9 / UX-a11y 8. **1 P1 confirmed + RESOLVED:**
"Store Card Purchase" surfaced as a new merchant — traced to a docstring
OVER-CLAIM, not a code bug. This codebase deliberately treats "Store Card
Purchase" as a real, rule-eligible merchant (`assign.ts isRuleEligibleMerchant`
+ the triage flow assert `rule-always` for it), so flagging it aggregate would
have broken that tested decision; fixed by correcting the doc + adding an
INTEGRATED test (derives the aggregate flag via `normalizeMerchant` like the
server does, proves genuine aggregates Zelle/Check ARE excluded while Store Card
legitimately appears). P2s FIXED: deterministic largest tie-break
(amount→date→merchant), no-history-vs-steady empty-state copy, pace `h2` for
heading order, reciprocal /reports→/trends link, new-merchant amount doc clarified.
Accepted P2s (documented, by design): (1) pace counts money-movement to MATCH
/reports & /spending-plan (movers exclude it for actionability — a deliberate,
documented split, not a third spend definition); (2) largest excludes
uncategorized to avoid Unknown-Merchant noise (consistent with movers); (3)
refunds are not netted from the new-merchant total (a brand-new merchant rarely
has a same-month return; netting would risk a confusing negative line); (4) the
day-1/2 pace projection is volatile but explicitly caveated ("a projection, not a
prediction"); (5) the mover baseline averages over months-with-any-spend — a true
calendar-monthly average including $0 months; (6) trends copy is hand-verified
against the coaching guardrails but isn't yet in the automated guardrail-scan set.

## Post-Phase-5 refinement: Money Dials settings/onboarding (DECISIONS #28)

The five per-user dials the engines read (payment account, SWR, expected return,
hourly wage, money dials) were seed-only with no editing path. Added the
credential-free half of ROADMAP #2:
- Pure validation engine `src/lib/engine/settings/dials.ts` (string-only parse,
  all-fields-at-once errors, bounds that keep the FI engine defined — SWR
  rejected ≤ 0 because `fiNumberCents` divides by it). `tests/unit/settings-dials.test.ts`
  (70 cases) + hand-verified parse table in EDGE_CASES §Money-Dials.
- Thin ownership-scoped `updateMoneyDials` server action (validate → persist →
  audit → revalidate dashboard/coach/cards/accounts/settings).
- `MoneyDialsForm` (useActionState, inline per-field errors + ARIA, assumptions
  in copy) on `/settings`; dashboard onboarding nudge gated on `paymentAccountId
  == null` (dormant in demo, activates for real new users post-auth).
- E2e `tests/e2e/settings-dials.spec.ts`: one sequential test (mutates only
  `moneyDials`, the dial with no golden coupling, and restores it) — proves
  pre-population, validation-without-persist, and a DB round-trip, golden-safe
  under fullyParallel.

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green (27 files), build
clean, **24 e2e** green (was 23 + the new dials flow).

Hostile Critic (multi-agent workflow, 4 dimension critics + adversarial
verification of every P0/P1): **PASS** — scorecard financial 9 / security 9 /
UX-a11y 8 / code-tests 8, **0 P0/P1** (the lone P1 candidate — a stale
`paymentAccountId` silently falling back — was independently verified to P2:
no account-deletion path exists anywhere in the codebase, so it is latent /
forward-looking). P2s fixed in this pass: centralized the triplicated
`JSON.parse(moneyDials)` into a malformed-safe `parseStoredDials`/`encodeDials`
engine boundary (used by coach/settings/budgets/action); made `needsOnboarding`
existence-aware (a dangling/ineligible saved id re-fires the nudge instead of a
silent fallback) and removed the redundant 3rd dashboard user-read (single
source via `DashboardData.paymentAccountId`); added a `role="status"` live region
for the "saved" confirmation (WCAG SC 4.1.3); code-point-aware dial length;
zero-eligible-account empty state; tightened the nudge copy (money dials don't
move the headline); `autoComplete="off"` on the numeric inputs. Deferred P2s
(documented, not fixed): per-action rate limit (consistent with the codebase's
other mutations — DECISIONS/ROADMAP #8), focus-to-first-error + error summary,
and light-theme error/success contrast (light theme is unreachable today).

NOTE (env, not a code defect): the first e2e run failed with `ChunkLoadError`
because a stale `next start` (the desktop launcher app) held port 3100 and
Playwright's `reuseExistingServer` reused it after the rebuild overwrote its
chunks. Stopping that process and re-running clean was green. If e2e ever shows
chunk-load / 400-on-`_next/static` errors, check for a stray server on 3100
(`netstat -ano | grep :3100`).

## Post-Phase-5 refinement: average-daily-balance interest (DECISIONS #29, ROADMAP #3)

Minimum-path interest moved from the labeled v1 simple-monthly approximation
(carried × APR/12) to the **average-daily-balance method**: per card not paid in
full, interest = round(DPR × Σ daily balances) over the next cycle
[close → close+1mo], DPR = APR/10000/365, balance = full statement until the
minimum posts on the due date then carried after; grace-gated (paid in full → $0).
New pure primitive `averageDailyBalanceInterestCents` in money.ts (own known-answer
tests incl. a fail-loud overflow guard); engine derives cycleDays/daysUntilDue from
the statement close+due dates. The retired `mulBps` (its sole caller) was removed.
Every pinned value recomputed BY HAND and updated with its test + doc (EDGE_CASES
§I/§Seed-headline: §I $61.08, the 06-01-cycle §I anchor $58.81, seed $65.76→$67.36,
S8 $12.23, N6 $19.17/$18.74).

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green (27 files), build
clean, 24 e2e green. (One full-run failure was a confirmed environment flake —
`net::ERR_NETWORK_IO_SUSPENDED` from the machine suspending network I/O mid-run;
the 3 affected specs, all on pages untouched by this change, passed on a clean
re-run, and the subsequent full verify was green.)

Hostile Critic (multi-agent, adversarial verification): **PASS** — financial 9 /
regression 9 / code-tests 9, **0 P0/P1**, 0 refuted; all three critics
independently hand-derived every pinned ADB value and each matched exactly, and
confirmed PAY_IN_FULL + all non-interest golden values are unchanged. Critic P2s
fixed: removed dead `mulBps` + its fossil test, overflow guard, citation #5/#21→#29,
type-comment + assumption-string transparency (mid-cycle payment timing). Accepted
P2s: theoretical float-half fragility and the latent estimate-path clamp (unreached;
estimates are excluded from MINIMUM interest whenever a real statement exists).

## Post-Phase-5 refinement: budget-targets UI (DECISIONS #30, ROADMAP #7)

Set/clear a per-category monthly target against actuals on `/budgets`. Pure engine
`engine/budgets/status.ts` (summarizeBudgets over the union of spent+target
categories; netSpendByCategory nets refunds; isBudgetable; parseBudgetTargetCents),
22 unit cases. `setBudget` is an atomic `prisma.budget.upsert` on a new
`@@unique([userId, categoryId])` (applied via `prisma db push`); `clearBudget` is
ownership-scoped. Budget targets are display-only — they feed nothing but /budgets
(not cash-needed/FI/net-worth) — so writes perturb no golden value.

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green, build clean, e2e green
(incl. the new budget-targets flow: set → axe scan → atomic overwrite → clear).

Hostile Critic (multi-agent, adversarial verification): **PASS after fixes** —
correctness 8 / security 9 / ux-tests 7. Two P1s found and FIXED before sign-off:
(1) budget actuals ignored refunds → a net-under-target category could show a false
"over target" bar — fixed by netting refunds in the budgets spend calc (scoped to
the display; income/savings-rate aggregations stay gross per the documented
convention, ROADMAP #4); (2) the overwrite path was untested with no DB uniqueness
guard → fixed with `@@unique` + `upsert` (structurally one row, no race) + an e2e
overwrite step. P2s fixed: non-spendable categories no longer selectable (shared
`isBudgetable` allow-list on picker AND server), progress bar gained
`role="progressbar"` + aria, and the e2e now runs axe on the target-bearing DOM.
Accepted P2s (consistent with the codebase): action throws on invalid input like the
sibling `createGoal` (no error boundary app-wide), per-action rate limit deferred
(ROADMAP #8), and the pre-existing exact-name money-dial match.

## Post-Phase-5 refinement: account-deletion UI (DECISIONS #31, ROADMAP #10)

Settings → "Delete my data": typed-confirmation gate → ownership-scoped
`prisma.user.delete` (cascades every user-owned row; shared Merchant/Category
left intact) → best-effort Plaid revoke → signOut. Idempotent (existence guard
skips audit+delete on an already-gone row, still signs out). Pure gate/summary
engine (`engine/account/deletion.ts`) + an integration test that drives the REAL
`deleteMyData` against throwaway users (gate-reject → no deletion; exact phrase →
scoped wipe + signOut; idempotent re-run). `(app)/error.tsx` added so a
post-deletion no-accounts render (or any action throw) degrades gracefully.

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green, build clean, e2e green
(incl. the gate/summary flow; the destructive execution is deliberately not e2e'd
against the shared demo — proven by the integration test instead).

Hostile Critic (multi-agent, adversarial verification): **PASS after fixes** —
security 7 / correctness 8 / ux-tests 6; cascade correctness verified down to live
`PRAGMA foreign_keys`. Four P1s found and FIXED: (1) the action had zero execution
coverage → action-level integration test; (2)+(4) non-idempotent crash (P2003/P2025)
on an absent/double-submitted row → existence guard; (3) post-deletion demo
re-sign-in 500 with no error boundary → `(app)/error.tsx`. P2s fixed: honest
summary catch-all, permanence warning moved above the form + `aria-describedby`,
form suppressed in the no-data state, de-flaked the integration test (unique ids).
Accepted P2s (real-auth release): multi-device JWT session invalidation and a
non-cascading compliance deletion-record (documented in PRIVACY.md §Deletion).

## Post-Phase-5 refinement: offline PWA service worker (DECISIONS #32, ROADMAP #5)

`public/sw.js` + a precached self-contained `/offline` shell + production-only
registration (`sw-register.tsx`, wired into the root layout). Conservative by
design: navigations network-first (online always fresh, never cached → no stale/
cross-user data), icon/manifest cache-first with a `res.ok` guard, hashed
`/_next/static/*` passthrough (bounded SW storage — no per-deploy accumulation).
Middleware excludes `/sw.js` + `/offline` (anchored so prefix collisions can't
skip auth).

Gate (real output 2026-06-15): `VERIFY_E2E=1 bash scripts/verify.sh` →
**✅ VERIFY GREEN** — typecheck/lint clean, unit suite green, build clean, e2e green
(new pwa-offline spec: SW registers + an offline reload serves the shell; existing
PWA-manifest + security-header specs unaffected — network-first means online specs
always hit the network).

Hostile Critic (multi-agent, adversarial verification): **PASS** — suite-safety 8 /
correctness 9 / privacy-robustness 7, **0 P0/P1** (the 3 review-phase "P1"s —
fixed cache name, atomic-precache-swallow, cache-first-stale-offline — were all
adversarially downgraded to P2: no online stale-serving, no leak, no suite
destabilization). P2s fixed proactively: `res.ok` cache guard, resilient per-asset
precache, network-first `/offline`, self-contained inline-styled shell, anchored
middleware matcher. Deferred P2s (documented): a build-stamped cache name and an
in-app "update available" affordance — unneeded while hashed assets are passthrough
and online navigations are network-first.

## Post-Phase-5 refinement: app-wide refund netting (DECISIONS #33, ROADMAP #4)

`monthlyFlows` (the single income/expense classifier feeding savings rate + FI)
now nets refunds: a positive transaction in a non-income category reduces that
month's expenses instead of counting as income (payroll/income unaffected;
ambiguous no-category positives stay income; a month's spend is floored at 0). The
demo's lone refund (+$50 AMZN return, May) now reduces shopping spend rather than
inflating May income — a small, correct shift (no pinned golden value depended on
it). Verified by 4 known-answer fixture tests in insights.test.ts; the only
in-app income path is `monthlyFlows` (`incomeExcludingTransfers` is test-only), so
the change is consistent. Reviewed by a focused self-check (income-detection edge
cases + single-path confirmation) rather than the full multi-agent critic, given
the 6-line, well-tested, single-path scope. `VERIFY_E2E=1 bash scripts/verify.sh`
→ **✅ VERIFY GREEN** (585 unit / 29 files, 27 e2e, clean typecheck/lint/build).

## Post-Phase-5 refinement: production hardening (DECISIONS #48, ROADMAP #8 + #9)

Closed two deferred launch-gating items. (#9) The `splitTransaction` double-split race
— it read `isSplitParent` before its transaction, so two concurrent splits could each
create children (doubling the txn in every aggregate). Now the parent is CLAIMED
atomically inside the transaction (conditional `updateMany`; a racing loser aborts before
creating children). (#8) The in-memory rate limiter was a per-instance no-op on
serverless; replaced with a durable, DB-backed `rateLimitDurable` (new `RateLimit` table,
applied via `prisma db push`) on the export route + a new per-account sign-in throttle.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **698 unit / 51 files**, build clean, **35 e2e** (existing
split + export flows unaffected).

Hostile Critic (4 parallel dimension critics + adversarial verification): the split fix
scored 10/10 (proven 20/20; the loser is rejected by the claim, not the pre-read). But it
found **3 P1s in the limiter, all FIXED**: (CONC-1/SEC-1) the reset branch returned `true`
UNCONDITIONALLY, so a concurrent burst of N first-hits ALL bypassed (50/50 at limit 8) —
fully defeating the brute-force throttle; fixed by deciding from an atomic
increment-or-create's returned count (regression: a 12-call burst at limit 4 allows exactly
4). (OPS-1) the `RateLimit` table grew unboundedly (no prune/index, attacker-controlled
`signin:<email>` keys, CWE-770); fixed with `@@index([resetAt])` + a self-pruning
`pruneExpiredRateLimits()` (≤1/min/instance, no cron needed). P2s fixed: export 401/429
tests, undo→resplit test, honest dead-code comment, explicit fail-closed comments. Deferred
P2s (documented): email-keyed sign-in throttle allows a bounded ≤60s account lockout
(IP-scoping is the next step); the limiter is two Prisma statements vs a single raw
ON-CONFLICT (a Postgres-only optimization); the Always/Undo orphan-rule race (STATUS #10).

## Post-Phase-5 refinement: payment reminders (DECISIONS #47, ROADMAP #6)

The calendar badged due days but nothing delivered a reminder. Added the MECHANISM:
a pure `engine/reminders/select.ts` (selection + email text) shared by an in-app
dashboard "Payment reminders" card and a `CRON_SECRET`-guarded `/api/cron/reminders`
sweep. Email dispatch (`lib/email.ts`) is DORMANT by default — no `RESEND_API_KEY` →
nothing sent, no network call (zero-credential demo, fetch-spy tested); set a Resend
key to switch on. Both surfaces derive from the same Cash-Needed obligations so they
can't disagree.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **686 unit / 48 files**, build clean, **35 e2e**
(dashboard reminders panel + no-duplicate-card assertion + reminder-cron-secret 401).

Hostile Critic (4 parallel dimension critics + adversarial verification): **2 P1s found
+ FIXED** before sign-off. (F1) both callers spread `[...result.cards, ...result.upcoming]`,
but the engine's `cards` already includes `upcoming` (a subset) → estimated obligations
double-counted (demo showed "Store Card" twice) → pass `cards` only + made the selector
idempotent under overlap (dedup) + an e2e uniqueness check. (PR6-001) the partial-autopay
(top-up) case dropped the autopay portion in the email/card against the larger headline
→ added the both-portions disclosure + a known-answer fixture. P2s fixed: shared
constant-time cron compare (now used by sync too), keyed-send cron test, tomorrow/soon-
boundary coverage, long email dates, stale calendar-footer copy. Deferred P2s
(documented): scheduling is an operator deploy step (`vercel.json` crons + `CRON_SECRET`),
consistent with the sync cron; the cron response lists userIds to the secret-holder only.

NOTE (deploy): to actually fire, add `{ "crons": [{ "path": "/api/cron/reminders",
"schedule": "0 13 * * *" }, { "path": "/api/cron/sync", "schedule": "0 * * * *" }] }` to
`vercel.json` and set `CRON_SECRET` (+ `RESEND_API_KEY` to send email). Dormant otherwise.

## Post-Phase-5 refinement: manual card statements (DECISIONS #46, extends #45)

A manual CREDIT card was treated as a card by the Cash-Needed Engine but, lacking a
Statement and cycle days, `buildObligation` returned null (engine.ts:83) → it was
DROPPED from "how much do I need & when", counting only toward net worth. Now a user
attaches a statement (+ optional APR + autopay) on `/accounts` so the card runs the
PRECISE path. No schema change (Statement/AutopayConfig already exist; the snapshot
already loads all of them). Pure parser `engine/cards/manual-statement.ts`, atomic
manual+CREDIT-guarded `card-actions.ts` (ARRAY-form `$transaction` — the interactive
form timed out under parallel SQLite), `getAccountsView` billing + `/accounts` UI.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **666 unit / 44 files**, build clean, **33 e2e**
(new manual-card-statement flow: add card → add $0 statement [headline-neutral] →
FIXED_AMOUNT autopay re-hydrates on edit → clear → delete-revert).

Hostile Critic (4 parallel dimension critics + adversarial verification of every
P0/P1): **0 P0/P1** — all three P0/P1 candidates reproduced then downgraded to P2
(parse failure returns before any DB write → no data loss; clear error surfaced in
the role=alert banner; narrow blast radius). Scorecard: security 9–10, code/tests
6–9, UX/a11y 6–9. P2s FIXED: FIXED_AMOUNT autopay round-trip on edit (billing now
carries the amount), blank-APR inline disclosure, `role="group"` on the form, an
aria-live `role="status"` success confirmation, + 3 missing tests (FIXED_AMOUNT split,
idempotent clear, APR-wipe). Accepted/deferred P2s (documented): manual estimate path
uses the user-entered balance for the next cycle; input-prefill `toFixed` (consistent
with existing prefill code); read-then-write single-statement race (STATUS #10 /
ROADMAP #9); one-tap Clear without confirm (consistent with the more-destructive
sibling `manual-delete`, reversible, no money/history loss).

## Post-Phase-5 refinement: real-clock "today" for real users (DECISIONS #58)

Found while prepping the multi-user deploy: the app resolved "today" as
`DEMO_TODAY ?? DEFAULT_AS_OF('2026-06-10')`, so a production deploy with
`DEMO_TODAY` unset would FREEZE every real user's "today" at the seed date —
wrong days-until-due, reminders, and net-worth "today" point. Fixed with one
sanctioned wall-clock read (`src/lib/business-today.ts` `businessToday(userId?)`):
DEMO_TODAY pin → demo user pinned to the seed date → real users get the real
clock. Threaded `userId` through `DataProvider.today(userId?)` and all call sites
(finance/coach/budgets/layout/new-txn/accounts/simplefin/plaid + the reminders
cron via getCashNeeded). Golden-safe by construction: tests set DEMO_TODAY, the
demo path still resolves to 2026-06-10.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — **753 unit / 60 files** (+4 known-answer: DEMO_TODAY-wins, demo-pinned,
real-user-real-clock, no-userId-real-clock), build clean, **37 e2e**.

## Post-Phase-5 refinement: invite-only signup (DECISIONS #57, ROADMAP #2)

The user needs the app for themselves + spouse + chosen testers, not the public.
Real multi-user auth already existed (DECISIONS #43) and its data isolation is
tested (re-confirmed live: `auth-actions`/`auth-password` → 10 passed, incl. the
two-user isolation check). What was missing was a way to keep signup private. Added
a pure env-driven allowlist (`src/lib/auth/allowlist.ts`) wired into
`signUpWithPassword` before any DB write. DORMANT by default (`SIGNUP_ALLOWLIST`
unset → open, so demo/local/tests are unchanged); set it → invite-only (exact
emails and/or whole `@domains`, case-insensitive). Gates creation only; existing
logins are unaffected.

Inline hostile-critic (proportionate to a ~45-line pure gate), 0 P0/P1: rejected
domain-suffix spoofing (`@team.com` ≠ `evilteam.com` / `team.com.attacker.net`),
multi-`@`/malformed (regex gate runs first + independent no-local/no-domain guard),
typo'd entries fail closed, no eval/SQL. KNOWN OPERATIONAL RISK (documented, bold in
docs/DEPLOY.md, not a code defect): forget to set `SIGNUP_ALLOWLIST` on deploy →
open signup.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **749 unit / 59 files** (+9: 8 known-answer allowlist
+ 1 action-level gate test), build clean, **37 e2e**. New deploy runbook docs/DEPLOY.md.

## Post-Phase-5 refinement: SimpleFIN aggregator (DECISIONS #56, ROADMAP)

A user hit Plaid's approval/cost wall and asked for an aggregator. Answer: don't
clone Plaid — wire SimpleFIN, a read-only documented protocol with no business
gate. Split like Plaid (#26): a TESTED pure mapper (`simplefin-map.ts` — signs,
cents, dates, account-type, dedup) + an UNVERIFIED network layer (`simplefin.ts`).
A `SimpleFinConnection` row stores ONLY the AES-256-GCM-encrypted access URL.
Re-sync is idempotent + race-safe on a new `@@unique([accountId, providerRef])`
(seed/Plaid goldens unaffected — providerRef nullable), 5-day overlap, then
cross-account transfer pairing (Plaid parity). SimpleFIN amounts are
outflow-NEGATIVE like Pulse, so — unlike Plaid — the sign is NOT flipped.

Gate (real output 2026-06-21): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY
GREEN** — typecheck/lint clean, **740 unit / 58 files**, build clean, **37 e2e**.
20 new SimpleFIN tests (mapper fixtures + real connect/sync actions vs a mocked
server: encrypted-at-rest, correct signs/categories, idempotent re-sync, SSRF
rejection incl. an internal access URL returned BY the claim server, IPv6 internal
tokens, malformed-row skip).

Hostile Critic (4 parallel dimension critics + adversarial verification of every
P0/P1): **5 P1s confirmed and FIXED + tested** — (1) SSRF redirect-follow bypass →
`safeFetch` re-validates every hop + drops Authorization on cross-host redirect;
(2) IPv6 private/ULA/link-local not blocked → added (`::`, fc00::/7, fe80::/10,
::ffff: mapped); (3) `posted:0` pending sentinel → 1970-01-01 → falls back to
`transacted_at` then sync date; (4) ambiguous account + negative balance could
INVERT net-worth sign → classified as liability + UI notice; (5) action errors
echoed `e.message` (could leak the credentialed URL) → fixed strings. P2s fixed:
amount parser tolerant of thousands-separators + >2 decimals (integer math, no
float); malformed-row skip not fatal.

**UNVERIFIED (honest, documented — docs/SIMPLEFIN_WALKTHROUGH.md):** the live
network path has NEVER run against a real SimpleFIN server here (no token in env).
The ledger-corrupting logic is unit-tested; the socket isn't. Confirm field shapes
vs the current spec before trusting real money data. Like Plaid, a real bank
linking to the *deployed* app also waits on real multi-user auth (ROADMAP #2) —
linking to the shared demo user would leak data. DNS-rebinding (pin-resolved-IP)
and scheduled auto-sync are deferred follow-ups.

## Phase 4 (complete — see commit)

Calendar/goals/budgets/exports/PWA/cron/security headers + dormant Plaid
provider (UNVERIFIED — docs/PLAID_WALKTHROUGH.md has the validation
checklist). Unauthenticated API requests now return 401 JSON (middleware).

## Known limitations (accepted, by design or deferred)

1. **Statement balances in seed history are plausible PRNG values**, not exact
   sums of that cycle's card transactions (DECISIONS #14). Likewise the
   checking account's posted balance is not reconciled against its full
   transaction history. No engine math depends on this reconciliation.
2. **Minimum-path interest uses the average-daily-balance method** (DECISIONS #29,
   supersedes the v1 simple-monthly approximation): APR÷365 × the cycle's average
   balance (full statement until the minimum posts, carried after), grace-gated so
   paid-in-full cards show $0. New purchases are not projected (a stated
   assumption); the minimum is modeled as posting on the due date, and any
   mid-cycle payment already made is treated as reducing the balance from the
   statement's close date (its exact posting date is not modeled — a conservative,
   user-favorable simplification). Two §I anchors in EDGE_CASES differ purely by
   cycle dates ($61.08 vs $58.81) — expected, both pinned.
3. **Demo auth is one-click** (anyone can open the demo user). Real auth
   (magic link / Google) plus the security pass land in Phase 4 (DECISIONS #13).
4. **`getDashboardData` loads the full snapshot per render** — fine at seed
   scale; pagination/caching is a Phase 4/5 concern.
5. **A card payment in transit that is recorded nowhere** (neither CardPayment
   row nor pending debit) is conservatively double-demanded (full statement +
   money still in checking). Documented behavior (critic scenario S2).
6. WCAG AA: axe (wcag2a/aa + wcag21a/aa tags) passes on all core pages plus a
   keyboard-only flow (tests/e2e/phase5-a11y.spec.ts); a full manual audit
   (screen readers, zoom, cognitive review) has not been performed.
7. **Recurring-detection fragilities (critic F8, P2):** ~~a refund+rebill inside a
   series drops it for the period~~ — **FIXED** (DECISIONS #34, ROADMAP #4): the
   detector analyzes only the dominant sign per merchant, so a refund (the minority
   sign) no longer breaks amount-stability or flips a series to "income"; the two
   critic2-recurring probes now assert the survived behavior. Still open: annual
   subscriptions need 3 occurrences (2+ years of history); `possiblyUnused` is a
   fitness-category proxy (usage is not observable in transaction data —
   DECISIONS #18) and is always phrased as a question in the UI.
8. **Refunds are NETTED against spend** (DECISIONS #33, ROADMAP #4 — supersedes the
   prior "refunds count as inflows" stance): a positive transaction in a non-income
   category reduces that month's expenses in `monthlyFlows` rather than counting as
   income, so savings rate and FI inputs reflect net spend. Payroll (category
   `income`) still counts as income; a positive with no/unknown category stays
   income (ambiguous inflow not netted). The /budgets view already did this locally
   (DECISIONS #30); this makes it consistent engine-wide.
9. **Equal-priority rules tie-break by creation order** (stable sort) — documented
   here rather than enforced.
10. **Concurrency races:** ~~two concurrent splits could double-split~~ — **FIXED**
    (DECISIONS #48: `splitTransaction` claims its parent atomically inside the tx).
    ~~"Always" racing "Undo" can orphan a rule~~ — **FIXED** (DECISIONS #49:
    `undoCorrections` deletes the rule only WHERE `createdFrom` still points back to
    this correction; regression-tested). ~~The `alreadyUndone` pre-read TOCTOU lets two
    concurrent undos of the same correction write a duplicate inverse~~ — **FIXED**
    (DECISIONS #50: the inverse correction carries `undoesId` with a `@@unique`, so the
    racing loser's insert violates the unique and rolls back; regression-tested with two
    concurrent undos → exactly one inverse). **All of #10 is now closed.**
11. ~~**Unknown billers containing a word-bounded "EPAY"** (e.g. "DUKE ENERGY
    EPAY") classify as transfers~~ — **FIXED** (DECISIONS #55): a utility-token +
    biller-payment-token pattern now wins before the transfer pattern, so utility
    e-payments are categorized as `utilities` (real spend) instead of being dropped
    as transfers — without affecting card payments. Surfaced by the adversarial
    categorization eval (`npm run eval:categorize`) + regression-tested.
12. **Plaid integration is IMPLEMENTED but UNVERIFIED** (no sandbox credentials
    in the build environment). The pure mapping layer (sign flip, account-type,
    liability→statement, per-row categorization) is unit-tested
    (tests/unit/plaid-map.test.ts, 18 cases); the network orchestration in
    plaid.ts (accounts/transactions-sync/liabilities/webhook/item-remove, with a
    dedicated `PlaidItem` token+cursor table) is real code that has never run
    against a live sandbox. Webhook JWT verification — **DONE** (DECISIONS #52:
    ES256 + body-SHA-256 + freshness, unit-tested with a real keypair; the live
    key fetch is the only UNVERIFIED part). Recurring/scheduled refresh after ingest
    — **DONE** (DECISIONS #53: `refreshRecurringForUser`, unit-tested). The only thing
    still UNVERIFIED is the live Plaid NETWORK orchestration itself (no sandbox creds
    here); production OAuth (ROADMAP #1d) is the remaining gap. Validation checklist in
    docs/PLAID_WALKTHROUGH.md §5.
13. **Coast-FI with a 0-month target** and `detectLifestyleCreep(windowMonths=1)`
    are degenerate for out-of-range inputs — unreachable from the app
    (constants fixed), noted for API consumers.

## Post-Phase-5 refinement: Ask Aimplifi — grounded NL assistant (DECISIONS #75, surpass feature #8)

The conversational surface the app is named for, built on the no-fabrication soul:
the LLM never originates a fact. A pure rule-based parser (`engine/assistant/intent.ts`,
no model call — LOOP #5) maps a question to a typed intent; the server answers it from
the SAME tested engines/read-paths the dedicated views use (`spendingByCategory` == /reports,
spending-plan, cash-needed, recurring, forecast, `monthlyFlows`, `netWorthCents`, coach),
rendered by pure formatters via `formatCents`. The LLM is an optional, key-gated,
7s-timeout-bounded, per-user-rate-limited fallback that ONLY classifies an unknown question
into a kind (can abstain via "none"); params are re-derived deterministically + re-validated
before any data is touched, and answers flag `interpreted` so a guess is never silent.
Zero-key demo fully functional. Dashboard `AskAimplifiCard` + `/ask` (no 8th nav icon, #71/#74).

Gate (real output 2026-06-24): `VERIFY_E2E=1 bash scripts/verify.sh` → **✅ VERIFY GREEN** —
typecheck/lint clean, **900 unit / 70 files** (+93), build clean, **51 e2e** (+5; the off-topic
case at 7.0s confirms the LLM-timeout → deterministic-fallback path), axe WCAG-AA green.

Hostile Critic (2 cycles, 16 agents, adversarial verification): cycle 1 financial 7 / security 8 /
code 6 / UX 8 — **6 P1s confirmed + FIXED**, each regression-locked: (1) net-worth used a truncated
liability set → canonical `isLiabilityType` (incl. MORTGAGE/OTHER_LIABILITY), facts reconcile to the
headline; (2) income/savings dropped `categoryId`+`isSplitParent` → income now `monthlyFlows(snap.transactions)`
(full rows; refunds net, splits excluded — F3 synthetic regression) and savings_rate delegates to
`getCoachData` (byte-identical to /coach); (3) largest omitted the POSTED filter → POSTED-only, grounding
test pins top-5 == /trends `computeLargest`; (4) off-topic could be silently misrouted when a key is set →
LLM `none` abstention + per-user `rateLimitDurable` + visible `interpreted` note. Confirmation cycle
(financial 93 / security 95 / code 88 / UX 88) confirmed all six and surfaced **1 further P1** — largest
diverged from /trends on the `<= today` guard + locale-vs-code-point tie-break — now FIXED to mirror
`computeLargest` exactly, with a non-tautological test (future-dated exclusion + code-point tie).
P2s FIXED: dead `answerUnknown` source line, third-party disclosure footnote (gated on `assistEnabled`),
no-flicker re-ask (prior answer dimmed while pending), dashboard card examples no longer fake-interactive,
500-char question clamp. Accepted/deferred P2s (documented): a shared `toFlowTxns`/`isPurchaseRow`/month-name
extraction across coach/trends/assistant (future DRY refactor); the pre-existing `monthlyFlows` income rule
(positive = income only for category null/'income', else nets) is unchanged.

## 2026-06-24 — SimpleFIN test flake hardened (DECISIONS #76)

A post-restart `verify` once failed `tests/unit/simplefin.test.ts` as "expected 0 to
be 2". Root cause: the parallel unit suite shares ONE rollback-journal SQLite dev.db
across worker processes; under an I/O spike (the codegraph daemon re-indexing) a write
was starved past the 15s busy_timeout → SQLITE_BUSY, which connectSimplefin's
intentional credential-safe catch masks as `added:0`. The code was never wrong (23+
clean full-suite reruns). Fix is TEST-ONLY (prod is Postgres): a vitest globalSetup
puts dev.db in WAL (concurrent readers + one writer no longer block), the SimpleFIN
test now asserts no swallowed error, and a regression test locks WAL on. Proven
fail-before/pass-after; verify GREEN (901 unit / 71 files), e2e 51 passed, 10/10
consecutive full-suite reruns clean.

## Coach Principles (Wave 1 + P0.4 + P0.5 + Wave 3) — M7 hostile-critic PASS (DECISIONS #92–98)

Embedded 7/9 finance-book principles into the Coach + app: Wave-1 captions
(Housel/Sethi/Ramsey framings), the P0.4 Conscious-Spending bucket lens, the
P0.5 Automation blueprint, and the Wave-3 Debt Freedom planner + Ask `debt_payoff`
intent — engine-first, each milestone verify-green and committed (#92–97).

**M7 hostile-critic review** (8 read-only dimension reviewers, opus, + adversarial
verification): **6 P1s confirmed and FIXED, each regression-locked** (full detail
in DECISIONS #98):
- **DEBT (P1):** the negative-amortization guard tested the *portfolio total*, so a
  single never-amortizing debt reported ALL debts — even ones steadily clearing —
  as never-paid-off (reachable with the seed's own estimated card minimums). Now a
  **per-debt** progress guard + a $1B overflow valve + a $0-budget short-circuit;
  pinned by new mixed-portfolio + zero-budget known-answer tests (EDGE_CASES §D/F/G).
- **AUTOMATION (P1):** the blueprint presented *estimated* next-cycle card
  obligations (the demo Store Card) as firm "set autopay" instructions → the engine
  now drops `isEstimated` cards, matching the cash-needed headline.
- **GUARDRAILS (P1):** `debtTradeoff` was a projection flagged `isProjection:false`
  (bypassing the assumption scan) → inline assumption added + flag corrected.
- **ASK (P1×2):** "pay off my credit card debt" was poached into `debt_payoff` (now
  stays cash_needed); "owe"/"out of debt"/"pay down" debt questions were missed (now
  routed) — both directions regression-tested.
- **MIGRATION (P1):** README's `prisma migrate deploy` builds a column-short DB —
  the single init migration is broadly stale (the migrations dir is vestigial;
  schema.prisma + `db push` are the real source of truth) → README + deploy step
  aligned to `prisma db push`.

P2s fixed: two `Math.round`/`*0.01` float-on-cents smells → `roundHalfAwayFromZero`;
conscious-strip bar widths normalized to sum 100% (overspent no longer overflows);
value CardTitles `as="div"` (#88); strategy toggle `aria-pressed`; sliders
`aria-valuetext`; debt-row truncation; trends mover-icon label. Deferred-with-rationale
P2s: Plaid LOAN minimum unmodeled (connector dormant); the conscious fixed-bucket
caveat already conveyed by the "bills and spending" copy; marginal small-text contrast
(axe-PASSING).

Gate (real output 2026-06-25): core `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
typecheck/lint clean, **1008 unit / 77 files**, build clean. A11y-focused e2e
**16/16 pass** (coach/goals/budgets/trends/ask axe WCAG-AA — all four new surfaces).

**Book coverage completed to 9/9 (DECISIONS #99).** On "continue", the two books the
recommended scope left invisible were surfaced as content lines (the plan §2 line-69
owner option): C11 Kiyosaki — assets-vs-liabilities caption on /accounts; C16
Aliche/Sethi — a "Your money rules" strip on /coach (reads the existing moneyDials, no
new storage). Pure content, guardrail-scanned, no engine/schema change. The remaining
Wave-4 items (income-lever slider, mortgage early-payoff what-if, memory-dividend
reflection, PAW lens, the heavier stored My-Money-Rules feature, new Ask intents) stay
deferred as genuine polish below the plan's "markedly better" stop bar (§7 + #80). Gate:
core verify GREEN (**1014 unit / 77 files**), axe e2e for /accounts + /coach 2/2.

NOTE (env, not a code defect): a full `VERIFY_E2E=1` run's lone failure is
`phase2-triage` "a full review session completes in <15 interactions" — it times out
on a `disabled`-while-`pending` accept button under SQLite write contention (1/4 pass
in isolation). This is the OneDrive/SQLite `SQLITE_BUSY` flake class already recorded
in item #16 below; it occurs on a page this work never touched (the entire Coach
Principles delta since the pre-work commit is a nullable `Account.minimumPaymentCents`
column + its nullable seed field — zero triage/transaction/provider code), so it is
not a regression. The documented bigger fix (move the test DB to %TEMP%) remains the
deferred infra item in #16.

Accepted P2s (independent hostile Checker, 0 P0/P1):
14. The WAL regression test catches an unwired globalSetup on a fresh/CI checkout
    (dev.db created in rollback mode) but NOT on a dev machine whose dev.db is already
    persistently WAL — an accepted blind spot (the pipeline path is covered).
15. The e2e global-setup does not separately enforce WAL; e2e is low-contention and
    inherits the persistent-WAL file in practice.
16. OneDrive (the repo lives under OneDrive\) can hold a transient OS lock on dev.db /
    -wal / -shm that WAL cannot prevent; a future transient SQLITE_BUSY there is NOT a
    WAL regression. Deferred bigger fix: move the test DB out of the synced tree (%TEMP%).
    **PARTIALLY RESOLVED 2026-06-27 (#120):** the unit + e2e SQLite DBs now live under
    the OS temp dir, off the synced tree (tests/setup/test-db.ts). This FULLY fixes the
    UNIT SQLITE_BUSY flake (the SimpleFIN "expected 0 to be 2"; unit suite green + fast,
    reliably). The e2e flake is reduced but NOT eliminated — see the dated section below.

## 2026-06-26 (resumed session) — REC-2 income-raise fix + prod HSTS + privacy-doc accuracy (DECISIONS #118–119)

Picked up the actionable items from the 2026-06-26 handoff (the Plaid questionnaire is user-action). Shipped:
- **REC-2 (#118):** recurring INCOME raises no longer render as red "price increase" warnings — engine `!isIncome`
  at summary.ts (`priceIncreases`) + insights.ts (`findOpportunities`), and the per-row badge tone extracted to a
  pure `priceChangeBadge()` and unit-locked. Seed payroll is flat → golden-safe. New
  tests/unit/recurring-income-raise.test.ts (proven to fail without the fix).
- **HSTS + privacy doc (#119):** production-gated `Strict-Transport-Security: max-age=63072000; includeSubDomains`
  (no preload) in next.config.ts, asserted in the phase4 e2e (prod build); PRIVACY.md rate-limiter line corrected to
  the durable DB-backed limiter (RateLimit table; export + per-IP/per-account auth throttle, STATUS #48) + CSP
  wording softened (Plaid origin allowlisted). NOT pushed — deploy + the 2-year HSTS commitment are the owner's call.

Hostile critic wf_1ba761ed (4 dims → adversarial verify): **0 P0 / 0 P1, 2 P2 (both FIXED)**. Gate:
`bash scripts/verify.sh` → ✅ GREEN (1140 unit / 93 files, +7 over baseline; typecheck/lint/build clean).

17. **E2E throughput flake reaffirmed (NOT a regression).** The changed surfaces pass every run (HSTS phase4:79;
    recurring:14/:20), but `phase2-triage:82` ("a full review session in <15 interactions") still times out under
    the OneDrive/SQLITE_BUSY contention of item #16. It is a CUMULATIVE-throughput test (~15 sequential accept→DB
    writes inside a 60s budget), so unlike a single-action flake it cannot be cleared by `--retries=2` (the shorter
    triage:29 did go flaky→pass). The page is untouched by this diff. Durable fix = the #16 item (e2e DB off the
    OneDrive-synced tree) or developing on a plain local disk per CLAUDE.md.
    **UPDATE 2026-06-27 (#120):** the e2e DB is now off the synced tree (+ WAL), but this did NOT eliminate the
    e2e flake — measured 3/5 full-suite runs green, and the failures were wall-clock timeouts of DIFFERENT correct
    tests run-to-run (phase2-triage throughput AND transactions register-search), not just one page. Root cause is
    broader than the DB: the `next start` server, the `.next` build, and the app files all still live on OneDrive,
    so its sync I/O contends with the server's synchronous better-sqlite3 round-trips. The COMPLETE e2e fix is the
    OTHER half of the #16 disjunction — relocate the whole working copy off OneDrive (CLAUDE.md), the owner's
    environment call. The e2e flakes are correct tests timing out under load, clearable by re-run, not code defects.

## 2026-06-27 (resumed) — Test/e2e DB relocated off the OneDrive tree (durable #16/#17 fix, DECISIONS #120)

Picked up the deferred durable fix for the SQLITE_BUSY flake class (the only un-gated engineering item left in the
handoff). The unit (vitest) and e2e (playwright) suites resolved DATABASE_URL to the repo-root `file:./dev.db`, under
OneDrive; the sync client's external OS locks on .db/-wal/-shm starved SQLite writers (masked as the SimpleFIN
"expected 0 to be 2"; aggravating the e2e phase2-triage throughput timeout). In-process mitigations (WAL,
busy_timeout, fileParallelism:false) can't wait out an external lock.

**Fix:** `tests/setup/test-db.ts` points the unit + e2e SQLite files at the OS temp dir (TEST_DB_DIR override,
mkdir'd; per-checkout hash so this OneDrive copy and the stale C:\dev copy don't share one file). vitest +
playwright configs set DATABASE_URL to it; both global-setups `db push` → WAL → `db seed` the off-tree file (e2e
WAL is set by a tsx child `scripts/set-sqlite-wal.ts` — the generated Prisma client is CJS and can't import into
Playwright's ESM config loader). Locked by `tests/unit/test-db-location.test.ts`. NO production surface (db-adapter
/ next.config untouched; `npm run dev` keeps the repo-root dev.db; prod = Postgres #35); nothing ships in the bundle.

**Outcome (honest):** the UNIT SQLITE_BUSY flake is FIXED — core `bash scripts/verify.sh` GREEN and FAST across
many runs (1142 unit / 94 files, +2 regression tests). The e2e suite is improved (DB off-tree + WAL) but STILL
flakes ~2/5 under load — the residual cause is the whole working tree on OneDrive (server/.next/app I/O), not the
DB. Documented at #16/#17; complete fix = relocate the working copy.

**Hostile critic** wf_d9503a9a (4 dims → adversarial verify): **0 P0 / 0 P1, 10 P2.** Applied 5: location test
honors TEST_DB_DIR (else the documented /dev/shm CI example would go red); mkdir the TEST_DB_DIR; per-checkout
hashed filename; accurate re-seed wording (RateLimit isn't wiped but its tests are key-isolated); documented the
reuseExistingServer/port-3100 assumption. Accepted P2s: same-checkout CONCURRENT runs (vitest --watch + verify)
still share a file (set TEST_DB_DIR); a server squatting on 3100 started from the repo would bypass the relocation
(verify 3100 free; CI spawns fresh).

## 2026-06-27 (resumed) — working tree relocated off OneDrive → C:\dev\Aimplifi (completes the #16/#17 e2e half) + transactions:145 hardened

The owner approved the #16/#17 COMPLETE fix (relocate the whole working copy off the synced tree). Done
non-destructively: robocopy'd the active checkout → `C:\dev\Aimplifi` (excluding regenerable node_modules/.next/
.codegraph + test artifacts; INCLUDING .git with the unpushed commits + all secrets .env*/keys/dev.db), then a fresh
`npm ci` (788 pkgs + prisma generate) on local disk. The OneDrive copy is retained as a reversible fallback.

**Measured at the new location:** core `verify.sh` GREEN (1142 unit/94 files); `VERIFY_E2E=1` full suite **54/54**.
The #16 e2e residual (phase2-triage:82 throughput timeout that no in-tree mitigation could clear) now runs in
14-24s and passed on EVERY run — confirming #120's finding that the residual was whole-tree OneDrive sync I/O
contention. Items #16/#17 are RESOLVED for the new checkout (the OneDrive copy is abandoned, not repaired).

**transactions:145 (inline recat) latent race — FIXED** (DECISIONS #121, REGRESSION_LEDGER 2026-06-27): the positive
assert matched the in-flight 'File as Groceries?' confirm prompt on the whole row → passed before persistence, so the
negative `not.toContainText('Dining Out')` raced `router.refresh()` on a 5s budget. App verified correct; the
assertion now targets the category-chip with a 20s budget on both sides. **4/4 consecutive full-suite runs green
post-fix.**

**Process caveat:** future sessions MUST run from `C:\dev\Aimplifi`; if work happens in the OneDrive copy out of
habit, the two repos diverge. CLAUDE.md's canonical-path note is updated to prevent this.

## Post-Phase-5 refinement: Plan in Words — debt-free-by-date (DECISIONS #125)

The first AI-differentiation build from `docs/AI_DIFFERENTIATION_PLAN.md` §5 (owner-chosen):
an INVERSE debt planner. State a goal date and the app SOLVES the tested debt engine for
the minimal extra/mo, with honest feasibility. New pure `engine/solve/debt-free-by-date.ts`
`solveDebtFreeByDate` bisects the monotone `planDebtPayoff` (the shipped `coastFI` idiom —
no new debt math); the answer is a share of real `getSpendingPlan` safe-to-spend. New Ask
intent `debt_free_by_date` (a deterministic `parseTargetDate` owns date extraction zero-key;
the LLM, if it routes here, supplies only the kind). "Confirm & save as goal" via
`saveDebtFreeGoal` re-solves server-side (never trusts a client number) and tags
`Goal.kind='debt_free'` (new nullable column) so /goals renders it with the solver's date,
not the savings-goal timeline. Engine-first; the LLM never originates a number or a date.

Gate (real output 2026-06-28): `bash scripts/verify.sh` core → **✅ VERIFY GREEN** —
typecheck/lint clean, **1281 unit / 102 files**, build clean. Full `VERIFY_E2E=1`: **55/57
passed** (+1 new debt-free-by-date e2e), with the ONE documented `phase2-triage:82`
throughput flake (triage-accept button stuck `disabled` mid-write → 60s `locator.click`
timeout) — an untouched page, machine saturated by this session's heavy runs; identical
symptom to STATUS #16/#17 + DECISIONS #88/#99/#120/#121; confirmed it on isolated rerun, NOT
a regression. All changed surfaces pass every run: ask.spec **6/6** (incl. the new inverse-
planner flow + axe AA), phase4-features goals + phase5-a11y goals green (the debt-aware
goals card did not regress the savings-goal renderer).

Hostile critic (wf_8faca37d, 5 dimension critics + adversarial verification): all dims 7/10,
**0 P0, 3 confirmed P1 — ALL FIXED + regression-locked**, then a confirmation cycle
(wf_ab686016) re-verified the fixes:
- **P1 goal render/drift** — the saved goal rendered via the generic savings card (flat
  `remaining/extra` ETA contradicting the solver, "moves your FI date back" framing,
  `targetDate` never shown, on-track→$0→"add a contribution") → debt-aware `Goal.kind` card
  showing the date + the suggested extra (or "on track … no extra needed"), bypassing
  `goalFIImpact`; savings goals render unchanged.
- **P1 parse misroute** — a month mentioned in passing + "by `<year>`" ("…loan in March …
  debt-free by 2028") parsed to March 2028 → the bare-year deadline is now resolved BEFORE
  the month loop and the global "any year in the string" fallback dropped (adjacent-year
  only); "by December 2027" still resolves correctly. Regression-locked.
- **P1 overspent fake-yes** — safe-to-spend ≤ 0 returns `withinSafeToSpend:null`, and the
  formatter's `=== false` check skipped the warning → an honest "budget you don't have yet"
  branch for the overspent cohort (real figure shown, no fake affordable framing).

P2s fixed: `hi` grows past one month's interest (no false "unreachable" at pathological APR),
de-doubled the over-budget clause, past-date copy ("already behind us"), Save button disabled
while a question is in flight + kept mounted on save (focus preserved, no nested `role=status`),
"in N → end of month", "by next/this month" + "done with my debt" routing, and new tests
(non-divisible share rounding, snowball + tighter monotonicity, high-APR reachable, overspent
formatter, non-zero server re-solve). Accepted P2s (documented): a bare credit-card question
stays `cash_needed` even with a date (DECISIONS #98 convention, pinned); the /goals debt-card
render + Save success/error states are display-layer, covered by inspection (the save
persistence is integration-tested; can't e2e without mutating the shared demo's goals).

## Post-Phase-5 refinement: Plan in Words — savings-goal-by-date (DECISIONS #126)

The second AI-differentiation slice (after #125's debt-free-by-date): state an amount + a
date ("save $20,000 by December 2028") and the app SOLVES for the minimal monthly
contribution, with honest feasibility (share of safe-to-spend, within-budget flag). New pure
`engine/solve/savings-goal-by-date.ts` `solveSavingsGoalByDate` — funding is LINEAR (no
investment growth; closed-form `ceil(remaining/targetMonths)`, NOT a bisection, because
savings doesn't amortize). The funding-months formula is extracted to one shared
`goals.ts::goalFundingMonths` used by BOTH the solver and the /goals `goalFIImpact` card, so a
saved goal renders a byte-identical timeline (the #125 card-vs-solver P1 designed out — no new
`Goal.kind` needed). The user-stated AMOUNT is extracted deterministically by a new
`parseTargetAmount` (the LLM supplies only the kind; the amount/date are re-derived in code);
a date with no amount → an "ask for the amount" answer. `saveSavingsGoal` re-solves the monthly
server-side (the client passes only the stated amount + date; the contribution is never trusted).

Gate (real, measured 2026-06-28): core `bash scripts/verify.sh` → **✅ VERIFY GREEN** —
typecheck/lint/build clean, **1328 unit / 105 files** (+46). ask.spec e2e **7/7** (new
savings-by-date flow + axe WCAG-AA + debt sibling no-regression).

Hostile critic (wf_3de855be, 5 dims → adversarial verify): **0 refuted; 1 P0 + 1 P1 confirmed,
both FIXED + regression-locked**, then a confirmation critic (wf_99a99d0d) re-verified the fixes:
- **P0 (parseTargetAmount truncation):** an ungrouped 4+ digit `$` amount truncated to its first
  3 digits — "$20000"→$200 (regex alternation matched the first branch without backtracking), a
  100×-wrong figure persisted on Save → fixed by requiring ≥1 comma-group (`+` not `*`).
  REGRESSION_LEDGER 2026-06-28.
- **P1 (canonical phrasing missed):** "have $X **saved** by <date>" routed to unknown because
  `saveVerb` didn't match the past participle → added "saved".
- **3 P2 mis-routes FIXED:** past/status review poached into the "ask" path; a per-period RATE
  ("$500 a month") misread as the lump total; a comma-grouped NON-money quantity ("10,000 steps")
  read as $10,000.
- **Confirmation round caught my P2 guards OVER-blocking** (the broad rate/past guards blocked
  the feature's own canonical demo-mode ask "how much per month to save $20,000 by 2027", and
  amount-bearing forward goals) → fixed by making the rate-guard PRECISE (a rate only when a
  period cue is adjacent to a dollar figure) and applying the past guard ONLY to the amount-free
  path; locked + an 18-case routing probe (real output) green.

Accepted P2s (documented, by design):
1. **Two-amount sentences pick the leftmost amount** — "I have $20,000 saved, goal of $50,000 by
   2028" plans for the stated $20,000, not the $50,000 goal (`parseTargetAmount` returns the
   leftmost match). It is a *mis-role of a number the user actually typed* (surfaced in the
   answer), NOT a fabrication, and needs an uncommon two-amount phrasing; full disambiguation is
   deferred. The save path re-solves the (mis-roled-but-user-stated) amount, so no app-originated
   figure is ever persisted.
2. **A contrived income question embedding "saving $X by <year>"** can be poached by the savings
   block (it sits before the income intent). Low likelihood; `savings_rate` (the common collision)
   is correctly NOT poached.
3. The /goals savings-card target-date line + the Ask "Save as a goal" success/error states are
   display-layer, covered by inspection (save persistence is integration-tested; can't e2e
   without mutating the shared demo's goals).

NOTE (env, not a code defect): an e2e `phase4-features.spec.ts:32` ("goals: creating a goal")
failed repeatedly in this session's degraded environment — but it fails IDENTICALLY at baseline
HEAD with a clean rebuild (proven by stash + rebuild), the delete persists to the DB correctly
(verified), and `router.refresh()` simply isn't dropping the card here even at a 20s budget. It
passed in #124 (56/56) and #125. This is the documented OneDrive/long-session e2e-flake class
(STATUS #16/#17), on a page this feature does not touch; NOT a regression from #126.

## Live provider ingest — contract audit + first fixes (DECISIONS #127)

**Framing correction (important).** The owner runs the app in PRODUCTION with REAL aggregator
credentials: Plaid is on `PLAID_ENV=production` (Vercel env) and SimpleFIN Bridge has all their
accounts linked (the encrypted access URL lives in the `SimpleFinConnection` DB row, by design —
DECISIONS #56 — so there is no SimpleFIN env var). The repeated "Plaid/SimpleFIN live path is
UNVERIFIED (no token in env)" notes elsewhere in this doc and in the mapper headers describe the
CI/TEST SUITE (which has no creds and runs against mocks), NOT the owner's deployment. Those paths
DO run on real money data every sync. The mappers' ledger math is unit/mock-tested; what CI never
exercised is the live socket + the providers' real field shapes — which the owner's accounts now do.

Because real data flows through code written against mocks, ran an adversarial CONTRACT AUDIT
(wf_6eade83c, 5 reviewers vs the official Plaid/SimpleFIN response schemas → adversarial verify of
every P0/P1). Result: **1 P0 (downgraded P1 on verify) + 10 P1 + 9 P2 confirmed.**

**FIXED now (DECISIONS #127, two clusters, hand-verified + regression-locked):**
- **SimpleFIN balance SIGN + TYPE (audit #1/#2/#8/#9):** `mapSimplefinAccount` did `Math.abs(balance)`
  on every account, so an OVERDRAWN deposit account was stored as a positive ASSET (net-worth sign
  inverted), and a keyword-less liability (HELOC, a loan under a servicer name, a no-keyword card like
  "Active Cash") defaulted to CHECKING and only the negative-balance rescue saved it — so a
  positive-principal loan booked as an asset. Fix: store the SIGNED balance for assets (overdraft
  stays negative) and `|amount owed|` for liabilities (SimpleFIN gives NO liability sign convention —
  a card may report owed-negative, a loan positive-principal — so the magnitude is the robust owed
  value); broadened `inferAccountType` with no-keyword card products + a non-card-liability branch
  (heloc/home-equity/line-of-credit/servicers) checked BEFORE the generic "credit" rule. Net-worth
  contribution hand-verified per case in `tests/unit/simplefin-map.test.ts`. KNOWN EDGE (documented in
  code): a genuine OVERPAID card credit balance is indistinguishable from owed-reported-positive, so
  it's treated as a small owed amount (rare).
- **Plaid APR (audit #7):** `aprs[]` was never mapped, so EVERY live Plaid card carried `aprBps`
  null/0 → the debt-payoff + cash-needed engines computed ZERO interest on real cards (corrupting the
  just-shipped debt-free-by-date + cash-needed figures). Fix: new pure `pickPlaidAprBps` (purchase APR
  → bps, fallback highest non-special, integer-rounded ×100 so no float drift) wired into the
  `/liabilities/get` loop to set `Account.aprBps` (even when no statement has generated yet). Locked by
  `tests/unit/plaid-map.test.ts`. (SimpleFIN has no APR field in its protocol, so SimpleFIN cards keep
  a user-entered/blank rate — expected.)

**TRACKED backlog (confirmed real, NOT yet fixed — prioritized for follow-up increments):**
1. **(P1, audit #4) SimpleFIN pending never reconciled** — ✅ **DONE (DECISIONS #128, 2026-06-28)** — see
   the dedicated section directly below. A pending that never posts lingered forever, and a
   pending→posted `id` change double-counted. Fixed with a two-pass `reconcilePendingTransactions`
   (in-window absence reconcile + an age-out backstop).
2. **(P1, audit #5) SimpleFIN holdings per-share round-trip** — ✅ **DONE (DECISIONS #129, 2026-06-28)**.
   Persisted the feed's authoritative TOTAL as a new nullable `Holding.marketValueCents`; `valuePosition`
   uses it verbatim when present, else derives round(qty×price). A penny lot no longer renders $0; the VOO
   −1¢ drift is gone. Net worth untouched (only the /investments breakdown). Hostile critic: 1 P1 FIXED —
   the new Int column is Postgres 32-bit ($21.4M/position ceiling); an over-ceiling total would overflow +
   be silently swallowed by the reconcile catch → mapper now bounds every persisted cents value to
   MAX_DB_CENTS (skip+count, not silent vanish). 3 P2 FIXED (engine self-validation; "≈" approximate
   per-share display; softened addHolding comment). **Residual / accepted (documented):** a single position
   over $21,474,836.47 is skipped+counted (out of model scope; widening these total columns to BigInt is the
   follow-up if such positions come into scope — the cost-basis column has always had the same Int ceiling).
   A hand-edited fed symbol keeps `source='simplefin'` so a later sync may re-ingest it (pre-existing #124).
3. **(P1, audit #6) Plaid investment/loan balances freeze at link time** — only refreshed on link, not
   on sync, so net worth goes stale. Fix: call `syncAccountsForItem` (or `/accounts/balance/get`) each
   sync.
4. **(P1, audit #3/#10) Currency never read** (both providers) — a non-USD or zero-decimal (JPY/KRW)
   balance is summed into net worth at a fake 1:1 / 100×-off rate. Almost certainly N/A for a US-only
   user, but unguarded. Fix: read `currency`/`iso_currency_code`; exclude-or-FX non-USD at the
   net-worth boundary (a withheld figure beats a silently wrong one).
5. **P2s (9):** epoch→date UTC-day-boundary (evening txn can land a day off); SimpleFIN symbol regex
   drops options/crypto/slash share-class tickers; all-unmappable-holdings → `[]` is treated as
   "sold everything" and deletes synced rows; Plaid null `balances.current`→0; Plaid
   `last_statement_balance` run through abs() (a statement CREDIT flips to owed); Plaid null
   `minimum_payment_amount`→$0 (worse than the estimate path); Plaid `liabilities.mortgage[]` /
   `student[]` dropped (only `credit[]` read). Each carries a suggested fix in the audit output.

Recommendation: tackle the backlog in small, individually-verified increments (each its own DECISIONS
entry + regression test), highest-money-impact first (pending reconcile, then holdings total, then the
Plaid balance refresh), rather than one large risky change.

## SimpleFIN pending reconcile — backlog #4 DONE ✅ (DECISIONS #128)

Closed the highest-money-impact live-ingest backlog item. `reconcilePendingTransactions` runs after the
Pass-2 transaction upsert in `syncFromSimplefin`, in two passes: (1) IN-WINDOW — per account synced this
run, delete feed-owned PENDING rows (date >= startDate) the snapshot no longer reports; (2) AGE-OUT —
delete feed-owned PENDING on the user's SimpleFIN accounts older than `PENDING_MAX_AGE_DAYS = 32`,
excluding anything the current snapshot still reports as pending. Kills both #127-audit failure modes: a
pending that never posts (lingered, overstated the cash-needed sum) and a pending re-posting under a new
id (double-count). Safety rails on the deleteMany: `status:'PENDING'` (POSTED never touched),
`providerRef:{not:null}` (manual/seed rows never touched), `isSplitParent:false` (no orphaned split),
passes date-disjoint. Golden-safe (demo never connects SimpleFIN; `SyncResult.removed` has no UI consumer).

Gate (real 2026-06-28): `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1343 unit / 106 files** (+11
known-answer, proven fail-before/pass-after), typecheck/lint/build clean. Hostile critic wf_35ef0562 (3
dims + adversarial verify): 0 refuted, **2 P1 confirmed + FIXED** (age-out for aged-pending drift past the
fetch window; `!acct.transactions` null guard replacing a `=== undefined` regression that let
`transactions: null` abort the whole sync), each regression-locked.

Accepted residuals (P2, documented in code + DECISIONS #128):
- A multi-day hold that drifts past the 5-day overlap then re-posts under a NEW id can briefly double-count
  until it ages out (≤ 32 days, self-healing). Eliminating it needs a wider per-sync fetch window, which
  would expand the existing re-sync re-categorization churn + bandwidth for a rare, self-correcting case.
- An account entirely ABSENT from a sync response isn't in-window-reconciled (its aged pendings are still
  swept by the age-out pass).
- The delete can orphan a Correction / CategoryPrediction analytics-log row (linked by id-string, no FK) —
  harmless and consistent with the Plaid `removed[]` path.

REMAINING live-ingest backlog: ~~**#5** SimpleFIN holdings per-share round-trip~~ ✅ DONE (DECISIONS #129);
~~**#6** Plaid investment/loan balance refresh each sync~~ ✅ DONE (DECISIONS #130); plus the currency
(#3/#10) + 9 P2 items from the #127 audit.

## Plaid per-sync balance refresh — backlog #6 DONE ✅ (DECISIONS #130)

Closed the last named live-ingest P1 from the #127 audit. `PlaidProvider.syncTransactions` refreshed an
account's balance only when `/transactions/sync` echoed it in its `accounts` array — i.e. depository/credit
accounts with transaction activity. INVESTMENT and LOAN accounts carry no Transactions product, so they were
re-fetched ONLY at link (`exchangePublicToken` → `syncAccountsForItem`) and their `currentBalanceCents` —
hence the owner's net worth — froze afterward. Fix: call the already-tested `syncAccountsForItem`
(`/accounts/get`, which returns EVERY account on the item) once per item at the start of each sync, before
the cursor loop; the loop's `page.accounts` echo still wins (fresher-or-equal) for active accounts.
Best-effort + audited (`plaid.accounts.refresh.failed`) so a refresh failure never blocks transaction ingest.
Reuses `/accounts/get` (cached, no per-call fee) over the billable real-time `/accounts/balance/get`, as the
audit recommended. Golden-safe (the demo never uses PlaidProvider). This also adds the FIRST mocked-server
integration test of the Plaid network orchestration; the live socket stays UNVERIFIED, consistent with the
existing labeling.

Gate (real 2026-06-28): `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1369 unit / 107 files** (+5 across one
new file, proven fail-before/pass-after), typecheck/lint/build clean. No e2e surface (server-only sync; the
demo never connects Plaid → the mocked-server integration is the labeled end-to-end, per #124/#128/#129).

Hostile critic wf_25be9884 (3 lenses + adversarial verify): **0 P0, 1 P1 confirmed + FIXED + regression-locked.**
The P1: now that investment/loan balances refresh every sync, a `/accounts/get` reporting a null
`balances.current` (documented-nullable) ran through the mapper's `?? 0` and would OVERWRITE a real balance
with $0 — silently cratering net worth until a later non-null sync self-heals. Fix = map a null `current` →
null (UNKNOWN, not 0) and OMIT `currentBalanceCents` from the UPDATE data when null so Prisma preserves the
last-known-good value (CREATE falls back to 0 — no prior to preserve); fixing it in the shared
`upsertPlaidAccounts` ALSO closes the same pre-existing hole on the depository/credit echo path. Independent
confirmation checker: SHIP, 0 P0/P1 (and confirmed the fix is robust to either `/accounts/get` or the
`/transactions/sync` echo writing null — last-writer preserves).

Accepted residuals (P2, documented in DECISIONS #130):
- Per-sync audit-log noise: a `plaid.account.skipped` row each sync for a permanently-unmappable account, and
  double rows (`refresh.failed` + `item.sync.failed`) on a full item outage — cosmetic, zero ledger/net-worth
  impact.
- The access token is decrypted twice + the item re-fetched per item per sync (the sync loop has the token,
  but `syncAccountsForItem` re-derives it) — negligible at hourly cadence; kept surgical rather than widen the
  method signature.
- `availableBalanceCents`/`creditLimitCents` still write through a null value (both nullable by design and
  non-net-worth; null is a legitimate state for them, unlike `current` where a balance always exists).

## 2026-06-29 — Plan-in-Words slice 3: retire-at-age inverse planner (DECISIONS #131)

The final Plan-in-Words slice (after debt #125 + savings #126), completing the owner-sequenced trilogy. "Can I
retire at 60?" → `solveRetireAtAge` bisects the boolean `projectRetirement(...).outcome==='sustained'` (the #122
decumulation engine, via the same `buildRetirementInputs` the /investments outlook uses — no new compounding math)
for the minimal monthly contribution that makes the portfolio last, framed as an honest share of real safe-to-spend.
Grounded: every figure from `getCoachData.fi` + the User planning dials (?? the documented defaults) + `getSpendingPlan`;
the LLM supplies only the intent kind, the age is deterministic (`parseTargetAge`). "Save as my plan" persists the age
to the existing `User.retirementAge` dial (not a flat Goal, which would contradict the compounding engine). Read-only
Ask path + demo planning columns null → byte-identical to #122/#123 (golden-safe). Hostile critic wf_c5d22775 (4 dims +
adversarial verify): **0 P0 / 0 P1**; 1 P1 candidate downgraded to P2 + 2 more P2 all FIXED + regression-locked
(inflection coverage "retiring"/"retired"; the age==endAge answer-vs-save inconsistency; "saving"→"savings"). Gate:
`bash scripts/verify.sh` → ✅ VERIFY GREEN (1409 unit/110 files, +40; typecheck/lint/build clean); ask.spec e2e 8/8 incl.
the new retire-at-age flow + axe AA.

Accepted P2 (documented, by design):
- **The solver fails LOUD on a structurally-invalid PLANNING age** (currentAge ≥ endAge, non-integer, out of [0,120]) —
  those reach `projectRetirement` and throw, rather than returning a clean `unreachable`. The solver only guards the
  USER-facing `targetAge` (age-in-past / age-after-end / cannot-sustain); the planning ages are always app-validated
  (User columns through the dials validator, or the documented defaults), so this throw is unreachable from the app and
  fail-loud on a programming error is correct (matches the #122 / STATUS #13 API-consumer precedent).
- **E2E throughput flake reaffirmed (NOT a regression).** The phase's own e2e (ask.spec, all 8 incl. retire-at-age,
  `:107` ✓ 6.6s) passes reliably, but a full-suite run during this heavy session failed `phase2-triage:82` (the
  ~15-sequential-accept-in-60s throughput test) with the documented symptom — the triage accept/`rule-always` button
  stuck `disabled` mid-write → `locator.click` timeout, under SQLite single-writer contention. It reproduced in
  isolation too because the machine was still write-saturated from this session's many back-to-back verify/critic/e2e
  runs (the #122/#123 finding: re-running only worsens it). The page is UNTOUCHED by #131 (retire-at-age → /coach is a
  one-way edge; zero triage/transaction/provider code in the diff). Same class as STATUS #16/#17, DECISIONS
  #88/#99/#120/#121/#122/#123 — clears on a settled machine, not a code defect.

## 2026-06-29 — Plaid credit-liability statement-field correctness (DECISIONS #132, live-ingest backlog)

Resumed on "continue" with the Plan-in-Words trilogy (debt #125 / savings #126 / retire-at-age #131)
complete + deployed; owner chose the LIVE-MONEY CORRECTNESS backlog over the next feature (Cash Flow
Radar). Picked up the highest-money-impact remaining items from the #127 live-ingest audit — both in the
Plaid credit-liability → statement mapper, both corrupting the cash-needed headline on the owner's REAL
connected Plaid cards:
- **abs() flip:** `mapPlaidLiabilityToStatement` mapped `last_statement_balance` through
  `plaidDollarsToPositiveCents` (abs), so a statement CREDIT / overpayment (negative balance) flipped to
  an amount OWED → a card the holder overpaid would DEMAND cash it doesn't owe. Fix: sign-preserving
  `plaidSignedDollarsToCents`; the engine's `floorAtZero` then yields a correct $0 obligation.
- **null/zero minimum → $0:** a null (or literal 0) `minimum_payment_amount` collapsed to a $0 minimum,
  understating the MINIMUM-path cash needed below the engine's own no-statement estimate. Fix: when no
  usable (>0) minimum is reported on a positive balance, mirror the engine's exact estimate by reusing a
  now-exported `estimateMinimumPayment` (max $35 / 1% of balance) — one definition, no drift.

Golden-safe by construction (common positive-balance + provided-positive-min path byte-identical; demo
never connects Plaid). Gate (real, measured): `bash scripts/verify.sh` → ✅ VERIFY GREEN, typecheck/lint/
build clean, **1417 unit / 110 files** (+8, proven fail-before/pass-after). No e2e surface (server-only
mapper; the labeled unit + mapper→cash-needed ENGINE end-to-end is the coverage, per #124/#128/#129/#130).

Hostile critic wf_edd3d8f3 (4 dimension critics → adversarial verification of every P0/P1): **0 P0 / 0 P1.**
Two P2s FIXED + regression-locked: (a) a PROVIDED 0 (or sub-cent) minimum on a positive balance reproduced
the same understatement → a "usable" minimum is now >0 (a reported ≤0 falls through to the estimate); (b)
the $0 guarantee for CONTRADICTORY feed data (a credit balance reported with a positive minimum) was
unpinned → pinned with a mapper known-answer + a mapper→computeCashNeeded e2e under both scenarios.

ACCEPTED/DEFERRED P2 (documented): an estimated minimum is presented with `isEstimated:false` and no
per-card "minimum estimated" disclosure. Honoring the cardinal "assumptions inline" rule here would need a
PERSISTED `Statement.minimumIsEstimated` column threaded through the sacred cash-needed engine + types
(the assemble layer reads stored Statement rows and cannot re-derive whether a minimum was synthesized) —
disproportionate to the rare trigger (Plaid omitting the minimum on a card that HAS a generated statement).
The estimate is conservative and equals the engine's own no-statement formula; in the MINIMUM scenario it
only ever errs toward funding more (paying ≥ an estimated minimum is always safe).

REMAINING #127 live-ingest backlog (confirmed-real, NOT yet fixed): the currency guard (audit #3/#10,
likely N/A for a US-only user but unguarded) + the rest of the audit's P2 cluster — Plaid
`liabilities.mortgage[]`/`student[]` dropped (only `credit[]` read), all-unmappable-holdings `[]` treated
as "sold everything" (deletes synced rows), epoch→date UTC-day-boundary, SimpleFIN symbol regex dropping
options/crypto/slash tickers. Tackle in small individually-verified increments, highest-money-impact first.

## 2026-06-29 — SimpleFIN all-unmappable-holdings data-loss guard (DECISIONS #133, live-ingest backlog)

Second live-money backlog increment this session (after #132). Closed the #127 audit P2 where a SimpleFIN
sync could WIPE the owner's synced /investments breakdown. `syncFromSimplefin`'s INVESTMENT branch
reconciled holdings whenever `acct.holdings !== undefined`; since `mapSimplefinHoldings` skips un-mappable
positions, a NON-EMPTY feed whose positions ALL fail to map returned `holdings:[]`, and the reconcile's
empty-set branch (`deleteMany({accountId, source:'simplefin'})`) deleted every synced row — mistaking a
format glitch / all-unsupported-types feed for a sell-all.

Fix: reconcile only when `holdings.length > 0 || acct.holdings.length === 0` (positions to write, OR an
EXPLICITLY empty feed = a genuine sell-all); a non-empty feed mapping to zero leaves existing rows intact
(counted as skipped) and self-heals on the next sync that maps any position — the same conservative stance
as the OMITTED-field guard (#124 P2). NET WORTH UNAFFECTED (account.currentBalanceCents stays authoritative;
holdings are a within-account breakdown). GOLDEN-SAFE (demo never connects SimpleFIN).

Hostile critic wf_8a9d99dc (2 dims → adversarial verify; one dim hit a mid-response API error, the other
returned the finding): **0 P0 / 0 P1**; **1 P2 FIXED + regression-locked** — the outer guard tested
`!== undefined`, so an untrusted feed sending `holdings: null` (not omitted) reached `mapSimplefinHoldings(null)`
→ "null is not iterable" → ABORTED the whole sync (the `transactions: null` failure class fixed in #128),
and a `holdings: ""` would even wipe via `.length`. Changed the guard to `Array.isArray(acct.holdings)` so
undefined/null/any-non-array all route to "leave rows intact".

Gate (real, measured): `bash scripts/verify.sh` → ✅ VERIFY GREEN, typecheck/lint/build clean, **1419 unit /
110 files** (+2, proven fail-before/pass-after). No e2e surface (server-only sync; the mocked-server
integration is the labeled end-to-end, per #124/#128/#129/#130).

REMAINING #127 live-ingest backlog (confirmed-real, NOT yet fixed): Plaid `liabilities.mortgage[]`/`student[]`
dropped (only `credit[]` read — these loans get no statement/due-date in cash-needed/calendar; net worth is
correct via the account balance) — the biggest remaining item, needs a small design call on how loan due
dates surface; currency guard (audit #3/#10, likely N/A for a US-only user); epoch→date UTC-day-boundary;
SimpleFIN symbol regex dropping options/crypto/slash tickers (coupled to the addHolding ticker rule, so a
wider change). Tackle in small individually-verified increments.

---

## #134 — Plaid mortgage/student loans → calendar + reminders (2026-06-30)

Biggest remaining #127 live-ingest item, SHIPPED (owner picked the surface = "Calendar + reminders", NOT the
cash-needed dollar headline). `syncLiabilities` now ingests `liabilities.mortgage[]`/`student[]` → populates
each loan Account's aprBps + minimumPaymentCents + dueDayOfMonth (preserve-on-null #130; mortgage subtype →
MORTGAGE, excluded from the snowball; student/other → LOAN). A new pure `selectLoanObligations` engine
surfaces the next loan payment on the calendar (`loan-due` event) + reminders ONLY — the cash-needed engine is
untouched. Seed `sched-autoloan` stand-in removed (loan now first-class). Gate: VERIFY GREEN, 1444→ unit /
113 files; e2e calendar/reminders/a11y 15/15 clean.

Hostile critic wf_d388bf4b (3 lenses → adversarial verify): **0 confirmed P0/P1.** 2 mapper money-bugs FIXED
+ regression-locked: (F1) `> 0` checked on the PRE-rounded value, so a sub-cent payment / sub-bps rate wrote a
fabricated 0 (zeroing a stored value) → now round-FIRST then `> 0`; (F2) a huge finite payment threw via
cents()'s safe-integer assert (aborting the item's whole liability sweep) despite the "non-throwing" comment →
now magnitude-bounded to the Postgres Int ceiling BEFORE rounding, returns null.

### KNOWN LIMITATIONS / NEXT (owner-gated de-dup design)
A loan payment is representable two ways — a recurring-detected/scheduled cash outflow (existing) AND the new
loan-due obligation — and #134 does not de-duplicate between them. Two consequences, both documented, neither a
confirmed P0/P1:
1. **Demo /forecast inconsistency:** `getCashFlowForecast` reads `snap.scheduled`; removing `sched-autoloan`
   dropped the demo's only scheduled loan row, so the demo forecast over-projects checking by $385/mo and is
   inconsistent with its own calendar/reminders (which DO show the loan). Real users are unaffected here (their
   loan ACH is still recurring-detected into `snap.scheduled`). Negligible ($385 on $340k) but a visible demo
   gap.
2. **Real-user calendar double-display (narrow):** a connected MORTGAGE/STUDENT loan whose monthly payment is
   ALSO recurring-detected as a NON-transfer checking outflow would show twice on the calendar (recurring
   outflow + loan-due) and double-count in totalOut. Does NOT affect an AUTO loan (not a Plaid liability → no
   loan-due) nor a payment categorized as a transfer (recurring detection skips it, detect.ts:85).
3. **Reported-$0 payment preserve (F1a, accepted):** a forbearance/IDR loan reporting `minimum_payment_amount:0`
   is treated like "not reported" (preserve prior), conservatively matching #132 — a later increment could read
   `loan_status` to clear a genuinely-$0 obligation.

NEXT (owner-gated): decide the CANONICAL loan source and de-duplicate — e.g. exclude loan-categorized
recurring/scheduled rows from the calendar+forecast when a loanObligation exists for that loan, OR feed
loanObligations into the forecast and suppress the recurring row. Requires threading a loan-account link or
categoryId through the scheduled pipeline; a focused follow-up, not bolted onto this increment.

**RESOLVED 2026-07-02 (DECISIONS #151, owner "do all recommended"):** the understand workflow proved there
is NO structural key linking a checking scheduled row to a loan Account, so a cross-source de-dup would need
heuristic money-matching (house-rejected). Chose **Option D** — feed loan obligations into the /forecast
balance projection from their one safe source (the loan Account) via `loanObligationsToScheduledFlows`; this
fixes the demo $385/mo under-count (consequence 1) with no heuristic and no golden movement. Checker
wf_1a6616ee 0 P0/P1. **Accepted residuals (documented, not fixed — no safe automatic fix exists):**
- **Consequence 2 (calendar + now forecast) unchanged:** a loan whose ACH is ALSO recurring-detected as a
  non-transfer checking row double-counts (folding loan-due into the forecast extends this to the forecast
  for that SAME already-broken population — no new victims). A future non-heuristic link (a
  loan-account/categoryId on the scheduled pipeline) would enable de-dup; pinned by a regression test that
  documents the limitation.
- **Day-31 clamp (checker P2-B):** a loan due on day 31 anchored in a short month expands a day early (e.g.
  06-30 → 07-30, 08-30 not 07-31/08-31) — a pre-existing `expandScheduled` MONTHLY property, now reachable
  via the loan fold; not demo-reachable (demo loan is day 5), ≤1-day shift, no golden moves.
- **Companion carve-out (detect.ts:83-85 `'auto-loan'`) DECLINED as out of scope:** `refreshRecurringForUser`
  runs only on real provider sync, never for the seeded demo, so the "latent post-refresh double-count" is
  not demo-reachable; removing the carve-out would churn ~8 recurring goldens for zero demo benefit. Optional
  owner-gated follow-up.

## 2026-06-30 — Currency guard: withhold non-USD accounts (DECISIONS #135, live-ingest audit #3/#10)

Closed the #127 live-ingest "currency never read" item. The app does no FX, so a non-USD feed
balance was summed into net worth at a fabricated 1:1. Persisted a nullable `Account.currency`
(null = legacy/demo/manual = assumed USD → golden-safe) set by both mappers; withhold non-USD
accounts AND all their child rows at every account-scoped read (snapshot accounts/transactions/
scheduled/snapshots; getAccountsView; getInvestments; register; triage; /budgets; the recurring
refresh; and all ~15 first-run empty-state gates). Pure `src/lib/providers/currency.ts`
(`canonicalizeCurrency`/`resolvePlaidCurrency`/`isSupportedCurrency`); the DB reads mirror it as
`OR:[{currency:null},{currency:'USD'}]`.

**Two hostile-critic cycles.** Cycle 1 (wf_74fc0808, 4 dims → adversarial verify): **4 P1 bypasses
+ 1 P2, all FIXED + regression-locked** — getInvestments roll-up (P1-A); the count-gates-vs-snapshot
invariant break → all-non-USD user throws + export 500 (P1-B); the transaction leak into
reports/trends/coach/register (P1-C ×2); and `resolvePlaidCurrency('','BTC')` failing open (P2).
Confirmation (wf_bda5c45a, 3 lenses): 2 lenses fixes-hold, the completeness lens found **2 more
direct transaction reads of the same class — `/budgets` spend + `refreshRecurringForUser` — both
FIXED + locked** (a foreign subscription would otherwise persist a scheduled row on the USD payment
account at 1:1). Gate (real 2026-06-30): `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1465 unit /
115 files** (+21), typecheck/lint/build clean.

### Accepted / deferred P2 residuals (documented, by design or follow-up)
18. **No excluded-account disclosure.** A withheld non-USD account vanishes from /accounts + the net
    worth headline with no "N accounts excluded — no FX yet" note; for a LIABILITY the withhold
    flatters net worth ("a withheld figure beats a silently wrong one" — but the direction is
    optimistic). **Highest-value follow-up:** a disclosure banner on the dashboard + /accounts.
19. **Cosmetic non-figure surfaces still touch foreign rows:** the transactions-CSV export lists a
    foreign account's rows (faithful raw dump, no summed figure); the account pickers (settings
    payment-account selector, /transactions/new, /transactions/import) may list a non-USD account
    (a foreign payment-account choice falls back to a USD account); the categorization backfill +
    the settings transaction-COUNT still process foreign rows. None is a wrong money figure.
20. **SimpleFIN HOLDING-level currency unread.** The guard is account-level; a non-USD position
    inside a SUPPORTED (USD) brokerage rolls into the /investments breakdown at 1:1. Net worth uses
    the authoritative account balance, so bounded to the breakdown; a deeper follow-up.
21. **Numeric ISO codes withheld, not mapped** (e.g. '840'=USD) — fail-safe; neither Plaid nor
    SimpleFIN emits numeric codes.
22. **All-non-USD user is a fail-SAFE edge** (unreachable for the invite-only US base; every real
    user has ≥1 USD account). The gates now render EmptyDashboard for it; the remaining pages that
    don't throw render zero-data safely.

REMAINING #127 live-ingest backlog: SimpleFIN symbol regex (options/crypto/slash tickers, coupled to
the addHolding ticker rule) + epoch→date UTC-day-boundary — both P2, lower money-impact.
**RESOLVED 2026-07-02 (DECISIONS #152):** (a) symbol regex — extracted ONE shared `parseTicker`/`TICKER_RE`
(kills the mapper/addHolding drift the audit flagged) and widened to accept "/" so BRK/B, BTC/USD are kept
(space-bearing OCC option symbols stay a documented skip); (b) epoch→date — inherently tz-ambiguous with no
feed timezone, so the UTC-calendar-day convention is now documented + boundary-tested (no logic change; no
money figure depends on the exact day). Checker 0 P0/P1/P2; verify GREEN 1570/124. Remaining #127 item:
residual 20 (SimpleFIN HOLDING-level currency unread — the guard is account-level).
**residual 20 CLOSED 2026-07-03 (DECISIONS #156):** `mapSimplefinHoldings` now reads each position's
`currency` and withholds non-USD lots before aggregation (account-consistent predicate — same
`isSupportedCurrency` rule as the account guard — with a distinct `withheldNonUsd` counter), so a non-USD
holding inside a USD account no longer sums into `/investments` at a fabricated 1:1. See the dated section below.

## 2026-07-01 — Triage write-in custom categories (DECISIONS #136, owner request #1)
Shipped increment 1 of the owner's sweep: "+ New category" in the triage picker (create + file in one
step) and the LIVE manual-entry custom-id bug fix. Hostile critic wf_e4584600: 2 confirmed P1 FIXED +
e2e-locked (error-boundary escape on a rejected create; stale open form crossing cards via batch/undo);
4 P2 fixed (overlay prune, IME Enter guard, name normalization parity, Escape). **0 open P0/P1.**

Accepted P2 residuals:
1. PRE-EXISTING: applyCategory creates its Correction row before the FK-guarded transaction update,
   non-atomically — a deleteCustomCategory race can orphan a Correction string ref (delete already
   remaps corrections; window is milliseconds; same class as the deferred alreadyUndone TOCTOU).
2. Partial-success recovery: if the create succeeds but the filing fails, retrying via the form shows
   "You already have a category with that name" — the category IS in every picker (discoverable path);
   custom copy plumbing for a rare double-failure judged disproportionate.
3. Focus is not restored to a specific control when the mini-form closes (axe AA passes).
4. The Settings manager has the same IME Enter-composition gap (pre-existing, same class as the
   triage one fixed here).

**ENVIRONMENTAL ESCALATION of #16/#17 (evidence-backed):** the phase2-triage full-review throughput
test now fails on THIS MACHINE even isolated on a fresh temp DB, at THREE code points: the #136 tree,
the pre-change HEAD (dd08f2e), and #131 (6a63729 — the commit where it measured green isolated on
2026-06-29). Symptom unchanged (accept/batch/undo stuck disabled ≥60s mid-write); stall position
varies run-to-run (15 remaining, 7 remaining). Conclusion: machine-level SQLite write-throughput
degradation TODAY — not a code regression at any point (3-point A/B), not OneDrive (the #121
relocation stands). Blast radius: ONLY the rapid-sequential-write loop — the other 58 e2e passed the
same day, and the three triage specs run in 0.8–4.1s when the box isn't saturated. Follow-up
(owner-gated): retest after a reboot; consider Windows Defender exclusions for the repo and
%TEMP%\aimplifi-test-*; if it persists, serialize that one spec's writes or give the throughput test
a dedicated DB.

## 2026-07-01 — #136 increment 2: searchable triage picker (Checker 2 P1 fixed) + stall diagnosis CORRECTED
Replaced the unsearchable ~84-option native <select> in triage alternatives with a search input +
scrollable option list over the pure `filterCategoryOptions` (assign.ts, 11 unit tests). Focused
Checker (wf_634e20c6): **2 confirmed P1, both FIXED + locked** — (1) search matched category NAMES
only while GROUP labels are visible in the list ("bills" → false "no match" → nudged the user to
create a DUPLICATE category; fix: a group-label match keeps the whole group); (2) keyboard access
regressed vs the native select (~86 tab stops to reach search, dead Enter; fix: the panel takes focus
on open (tabIndex -1 container — child buttons can be disabled mid-action, a container focus can't
silently no-op), Enter files the single visible match, Escape clears/closes). P2 fixed: stale search
query no longer survives batchApply/undoLast card changes (same class as the P1 form fix). e2e locks
added for all of it (focus-on-open, group-label search, Enter-files, empty-query-after-undo).

**STALL DIAGNOSIS CORRECTED (supersedes this morning's "SQLite write-throughput" wording):** a direct
Prisma write probe against the SAME e2e DB file ran 60×(create+update+delete) at **min 0 / p50 1 /
p95 1 / max 22 ms** while browser-driven server actions stalled ≥60s — the storage layer is HEALTHY;
the stall lives in the request/server layer (`next start` action POST handling) under RAPID
SEQUENTIAL actions. Switching the test loopback localhost→127.0.0.1 stabilized the lighter specs this
session but did NOT cure the full-review rapid-write stall (still reproduces, stall position varies).
Still environmental-not-code (3-point A/B incl. #131 stands). Runtime versions for future comparison:
node v24.16.0, playwright 1.60.0, next 15.5.19 — a system Node/OS update since 2026-06-29 (when this
test last measured green) is the prime suspect. Owner follow-ups: reboot + rerun; if persistent, try
pinning the Node version the 6/29 run used, or instrument the action route latency server-side.

## 2026-07-01 — #136 increment 3: register write-in (Checker 1 P1 fixed) — sweep COMPLETE
"+ New category" inside the register's category-menu → hands off to the existing once/always confirm
(#121); shared group-label search (#137) replaces the menu's name-only filter; drop-up menu on low rows.
Checker P1 FIXED + locked: `chosen` is now ROW-BOUND (rowId) — a create resolving after a row switch can
no longer put the one-tap confirm (incl. merchant-wide + durable-rule) on the wrong row. Race lock GREEN
×4 on the final tree. Accepted P2s: one-shot dropUp measurement (no scroll/resize re-measure; stale side
after scrolling with the menu open); write-in form inside the pre-existing role=listbox (SR
discoverability — fold into the shared-CategoryPicker follow-up); drop-up top-clipping on very short
viewports; the happy-path spec's full pass on the FINAL tree is UNVERIFIED (witnessed green through the
confirm pane ×3; the tail stalls on the machine's documented action-apply stall) — rerun after reboot.
Root-cause note for #16/#17: the ≥60s stalls are the ACTION-RESPONSE REVALIDATION APPLY (server actions
carrying 9-route revalidations hold the client transition — and every disabled={pending} button — until
the payload lands); storage proven healthy (p50=1ms probe). Environmental TODAY per the 3-point A/B.

## 2026-07-01 — #139 write-in prefill from the search query (owner request; Checker 2 P1 fixed)
Owner (testing #136-#138 in prod): "consolidate the new category into that search box so user doesn't
have to retype a field." Shipped: both write-in mini-forms prefill their name from the picker's live
search query at open (still editable; submit normalizes as before); triage Enter on a zero-match query
opens the prefilled form. Register search gains no Enter semantics (has none today — shared-
CategoryPicker follow-up). Checker wf_e902ad02 (3 lenses → adversarial verify): 2 P1 FIXED + locked —
(1) missing !newCatOpen let a second zero-match Enter silently clobber the edited draft (name/group/
discretionary) since the search box stays interactive beside the open form; (2) HELD-Enter auto-repeat
chained through the name input's autoFocus into an instant create+file with never-reviewed defaults →
e.repeat guards both Enter handlers. The pre-guard bundle DEMONSTRATED (2) in a stale-build e2e run
(rule prompt offering the typo category) — see process lock below. Test-adequacy P2 fixed (guards now
pinned: multi-match no-op, repeat no-op, draft survival).

Accepted residuals: two DISCRETE rapid Enters still create+file (indistinguishable from intent; filing
undoable, category deletable, rule prompt consensual); register keyboard parity deferred (pre-existing).

**PROCESS LOCK (cost ~40 min today):** playwright webServer = `next start -p 3100` with
reuseExistingServer — it serves whatever .next holds. NEVER run e2e concurrently with scripts/verify.sh
(its `next build` races/lags the spec edits): the first "P1 reproduction" run was the PREVIOUS bundle.
Sequence is always: verify green FIRST, then e2e.

Gate (real 2026-07-01): verify.sh → ✅ GREEN 1476 unit/116 files, tsc/eslint/build clean. E2E on the
final tree: triage write-in spec (all 5 new locks) GREEN 7.9s; register race lock GREEN; register happy
path witnessed green through prefill assert + confirm pane ×3 — its once-click tail is the documented
environmental action-apply stall (re-A/B'd at HEAD this session: fails at spec line 230 pre-change) —
full pass UNVERIFIED until the owner reboot (#16/#17 protocol; one triage stall occurrence also hit
line 106 mid-session then passed 7.9s on retry, consistent with "position varies").

## 2026-07-01 — #140 iOS focus-zoom fix (owner report)
Owner on #139 in prod: the dropdown "zooms in" — iOS Safari force-zoom on <16px focused controls; ALL
raw inputs here are text-sm (14px) and the register menu autofocuses its search. Fixed at the root:
globals.css (pointer:coarse) floors input/select/textarea at 1rem ([class] specificity trick, no
!important; checkbox/radio excluded; desktop unchanged). Register menu w-56→w-72 + max-w viewport clamp.
e2e locks assert computed ≥16px on both surfaces in the touch-emulated project (proved the media query
matches under Playwright's Pixel-5 emulation). Gate: verify GREEN 1476/116; triage write-in 7.7s GREEN
(incl. zoom locks); register race 4.6s GREEN; register happy-path tail = the documented environmental
stall (unchanged label). Residual: real-device (physical iPhone) confirmation is the owner's — emulation
proves the CSS applies, not Safari's zoom behavior itself.

## 2026-07-02 — #141 currency-disclosure banner (#135 residual 18) — Checker 1 P1 + 10 P2 confirmed, P1 + 7 P2 fixed
Resumed from stash `wip-135-disclosure` (banner + pure summarizer + getAccountsView.withheld +
getWithheldAccountSummary + dashboard//accounts wiring). Completed the pending pieces: integration
tests on the existing currency-guard fixture, the guarded scripts/e2e-add-foreign-account.ts (refuses
unless DATABASE_URL === E2E_DB_URL exactly AND the email is an @aimplifi.test throwaway; idempotent
via delete-own-rows-first), and tests/e2e/currency-disclosure.spec.ts (negative: all-USD demo user, no
banner; positive: ad-hoc signup user + helper → banner on dashboard + /accounts, withheld names absent,
axe AA with the banner present — the demo user never renders it, so the phase-5 pass can't cover it).

**Hostile Checker (wf_de889cf4, 4 lenses → adversarial verifier): 17 raw → 11 CONFIRMED (1 P1, 10 P2),
6 refuted.** Fixed:
- **P1 (tests): vacuous dashboard zero-render lock** — the negative spec anchored on `demo-banner`,
  which the LAYOUT flushes before the route-group Suspense resolves, so `toHaveCount(0)` passed
  against the loading skeleton. Re-anchored on `net-worth-card` (page content below the boundary).
- P2 copy sweep, all grammar now built by the PURE `withheldBannerCopy()` and branch-locked in unit
  tests: singular+opaque folds to "another currency" (was ungrammatical "an account in other
  currencies"); title now "not in U.S. dollars" (was "foreign currency" — mislabels crypto/BTC, a
  first-class withheld case); display tokens = letters 3–5 only, uppercased + deduped ('840', 'US',
  'doge' no longer pasted into copy; case-variant dedupe can't fake "and others").
- P2: all-foreign /accounts contradiction (banner "Nothing is deleted" above "No accounts yet / Add
  your first account") — AccountsEmptyState gets a withheld-aware copy variant; zero-account users
  byte-identical.
- P2: spec `.first()` removed (strict mode now locks single-render); helper made idempotent.

**Accepted residuals (documented, not fixed):**
23. Disclosure covers dashboard + /accounts only (the residual-18 scope as recorded). The register,
    /investments, /triage, /recurring, /reports, /coach still withhold silently — register is the
    page a user hunts a missing account on, /investments is one click from the disclosed /accounts.
    Follow-up: reuse getWithheldAccountSummary there (checker recommends /investments first). Note:
    every sign-in lands on /dashboard, whose banner reads app-wide ("every total, trend, and
    projection shown"), so the vanish is no longer fully silent anywhere.
    [UPDATE 2026-07-02: /investments covered — DECISIONS #145 (banner + withheld-aware empty
    state + e2e both paths). Remaining silent surfaces: register, /triage, /recurring, /reports,
    /coach; residual 25 (projection-assumption copy) unchanged.]
    [UPDATE 2026-07-02 (later) — **CLOSED**: register/triage/recurring/reports/coach all covered
    (DECISIONS #149; inline mount on the 3 server pages after each EmptyDashboard gate, `withheld`
    threaded into RecurringView/ReportsView for byte-identity). EVERY money surface now discloses
    withheld non-USD accounts; only residual 25 (inline per-projection assumption copy) remains,
    though the banner now surfaces that assumption at the top of /coach + /reports.]
24. The supported-currency predicate stays hand-duplicated across ~4 page gates + the DB complement
    in getWithheldAccountSummary; only the summary side is invariance-tested. Refactor candidate
    (single exported Prisma where-fragment), not a live defect.
25. Coach/reports projections don't state the currency-exclusion assumption inline (guardrail
    tension flagged by the checker; same scope decision as 23).
    [UPDATE 2026-07-02 — **CLOSED** (DECISIONS #150): pure `withheldInlineNote()` states the
    assumption inline at the /coach FI card + the /reports spending total (gated on withheld > 0,
    byte-identical otherwise), matching the app's per-projection "assuming X%" style. Accurate —
    the currency guard filters transactions/accounts/investments to USD-only in the shared
    snapshot. Unit + e2e locked; focused checker 0 P0/P1/P2.]
Refuted (verifier): CSV-export marker claim (accepted residual 19 covers it), backfill-count
disagreement, all-foreign dashboard P1 (gates to EmptyDashboard = accepted 22), banner salience,
reassurance-copy coupling, execSync cwd fragility.

**Gate (real, 2026-07-02):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — **1492 unit / 116 files**
(+16 this session: 6 stash + 2 integration + 8 checker locks), tsc/eslint/build clean.
E2E on the final tree: currency-disclosure 2/2 GREEN (2.7s/4.0–4.8s incl. axe) ×3 runs;
auth.spec 3/3 GREEN (one non-reproducing single failure in the first post-build parallel run —
isolated rerun 2.6s + full-file rerun 3/3 green; classed environmental per the #16/#17 protocol and
the CLAUDE.md cold-start-flake rule).

## 2026-07-02 — Phase 3 (3d+3a+3b+3c) shipped; environmental notes
Rebuild increments all verify-green + committed: resync clobber guard (regression-locked), merchant
identity (eval 60%→23.3% review on messy data, precision 100%), group engine/server (trust-on-repeat
locked end-to-end), group-first UI + adapted e2e. Two environmental findings today (evidence-backed):
(1) phase5-a11y "keyboard-only /cards" fails TODAY at THREE code points incl. 69a335b (witnessed green
60/61 on 2026-07-01) — identical $2,135 toggle assertion, focus+Enter racing hydration on the degraded
box; 3-point A/B ⇒ NOT a regression from today's code; retest after the owner-gated reboot.
(2) The new throughput e2e passed isolated ×2 (14s) + in-suite once; one serial run hit the documented
#16/#17 pending-stall (button disabled >120s, position varies). Same cure.
Accepted 3c residuals: the "Always/Just once" prompt is now reachable only via one-by-one mode on
multi-row rule-eligible groups (group cards carry consent in copy — #143/#144); positive e2e coverage
of that prompt needs a multi-row real-merchant fixture (demo has none) — Phase-4 item with the messy
corpus; rule-prompt makeRuleFromCorrection machinery unchanged and unit-covered.

## 2026-07-02 — Phase-3 Checker cycle 1 (wf_908cf9a8: 35 confirmed — 3×P0 one root cause, 12 P1, 20 P2)
FIXED this cycle (all locked, verify green): the merchantless mass-misfile P0 (scope + groupKey unified);
sync-guard check-then-act race → atomic tx w/ fresh in-tx reads; guard predicate v2 (split parents never
resurrected; undone rows take fresh verdicts; isTransfer preserved as verdict); Plaid pending→posted
transplant via pending_transaction_id (corrections follow the row); fileMerchantGroup fetch-in-tx +
needsReview re-assert + rule dedupe + spending-type/currency parity with the card; demo ACH patterns
name-bound (`.*RENT` convergence sink); badge/queue merchantless-key unification; singles-mode leak;
empty-state undo double-tap; "Always"-tap error escape; week-slice non-vacuity canary.
ACCEPTED/DEFERRED (P2s + structural, with rationale): SimpleFIN pending-id churn has NO linkage field —
correction transplant impossible without heuristics; residual documented (correct a pending row that
re-posts under a new id within days → reverts; rare, and the new one-tap group flow re-teaches cheaply).
3a canonical-migration gap (pre-3a rules on re-canonicalized brands stop matching; one live invite-only
user; one-tap re-teach; backfill re-point queued as follow-up). Prediction stamping no-op for live rows
(pre-existing #37 scope). Venmo/aggregate per-descriptor degeneracy on noisy feeds. City-strip multi-word
-city partials. LIGHT-token false-positive surface (requires biller token too). Singles-list a11y polish.
Server-level undo-of-group-reformation lock. Group-count-vs-late-sync drift note in consent copy.
ENVIRONMENTAL (worsening through the day, reboot-gated): the throughput e2e went green×3 (14-25s,
incl. isolated ×2 + in-suite) mid-day, then stuck-pending ≥120s across serial AND isolated runs late-day
— alongside the a11y keyboard test failing at 69a335b (yesterday's witnessed-green commit, 3-point A/B).
No surfaced error (a Prisma tx timeout would error fast + re-enable) → request-layer stall, #16/#17.
OWNER: reboot, then `VERIFY_E2E=1 bash scripts/verify.sh` re-witnesses both.

## 2026-07-02 — Checker CYCLE 2 on the rebuild (wf pre-/clear, 23 agents): 20 raw → 20 CONFIRMED, 0 refuted → ALL FIXED (DECISIONS #146)
Distinct defects after dedupe across the three lenses (fixes-hold / new-paths / gates):
- **P0 transplant × split (3 findings)**: split PENDING parent posting under a new id → parent deleted
  (isSplitParent dropped), children dangling, NEW full-amount row → spending double-counted. FIXED:
  transplant carries the split (container re-created, children re-pointed + posted, corrections follow)
  or DISSOLVES it to review on amount drift; removed[] cascades children of canceled split charges;
  same-id drift dissolves in BOTH providers; preserved splits post their children. 6 regression locks,
  5 proven fail-old by stash-run.
- **P1 isolation class (5 findings)**: every check-then-act guard assumed SQLite serialization; prod
  Postgres = READ COMMITTED. FIXED: serializableTx (SERIALIZABLE + bounded P2034 retry) at all five
  sites; the transplant's predecessor read moved INSIDE its tx; recategorize's target fetch moved
  in-tx. **HONESTY NOTE: the PG interleavings are unreproducible on the single-writer SQLite test
  env — closure rests on documented Postgres semantics (write-write first-updater-wins detects
  conflicts even against READ COMMITTED writers; SSI predicate locking covers the dedupe insert race
  between two serializable txs) + the helper-contract locks (serializable-tx.test.ts). Status:
  UNVERIFIED-on-PG until a Postgres integration env exists. The failure mode of a WRONG argument here
  is bounded: P2034 storms (visible, fail-loud) or the original clobber (no worse than pre-fix).**
- **P1 singles leak (3 findings)**: groupEmptied side-effected inside the setGroups updater — reset
  no-oped whenever React deferred the updater (deterministic on the write-in path). FIXED: derived
  before dispatch from committed state; e2e lock drains a group one-by-one and files the last row via
  the write-in (fail-old by mechanism inspection only — the eager-bailout skip is not deterministically
  reproducible under Playwright timing; the checker's React-19.1 trace stands as the pre-fix witness).
- **P2 batch**: merchantless scope pins merchantId:null (raw: card ≡ its action; aggregates stay
  descriptor-only BY DESIGN — one agg: card mixes CSV + synced rows of the same text); SimpleFIN (and
  Plaid, same shape) create/create race → P2002-catch → guarded-update fallback (CQ-2 restored without
  losing the verdict guard); removed[] buffered per item until all pages applied; rule dedupe requires
  the five condition columns null via the shared ensureUnconditionalRule (recategorize now dedupes too);
  gate gaps closed (same-canonical separation lock — prophylactic, passes old code by design; conditional
  -rule mint lock).
Residuals accepted (rationale): duplicate rules from two concurrent group-files remain possible only if
BOTH sessions race the SSI window AND retries interleave identically (bounded, self-healing on next
dedupe pass); Correction rows on a bank-canceled charge keep their dead transactionId (append-only audit
tolerates dead refs; the transplant re-points the live cases); SimpleFIN children of a DISSOLVED split
lose child-level corrections' target rows (charge no longer exists at that shape — audit rows retained).

## 2026-07-02 — Checker CYCLE 3 (wf_55f3cc23, 20 agents over the cycle-2 fix commit): 16 raw → 16 CONFIRMED, 1 refuted → ALL FIXED (DECISIONS #147)
The confirmation pass did its job twice over: it found the cycle-2 invariant claimed more than it
covered, and empirically proved a gate gap by stripping the fix and watching the suite stay green.
Deduped defects and their fixes:
- **P0 SimpleFIN new-id churn** (2 findings): stale pending split parents were IMMORTAL (reconcile
  excluded them in BOTH passes; children shielded by providerRef not-null) → the re-posted charge
  double-counted PERMANENTLY. FIXED: reconcile dissolves stale/aged pending split parents WITH
  children, read-in-tx, both passes. Locks: sf_new_id_churn + aged_out_split (fail-old proven).
- **P1 silent dissolve** (3): dissolve inherited the pipeline verdict → a user rule auto-filed the
  drifted charge, no triage card (checker probed it mechanically). FIXED: needsReview:true +
  confidenceBps:null forced at all 3 sites; the rule still supplies the SUGGESTION. Locks ×2 providers.
- **P1 sixth writer** (2): applyCategory (singles fileRow + recategorize 'one') was four bare
  statements. FIXED: one serializableTx, fresh in-tx reads, shared mint. makeRuleFromCorrection too.
- **P1 stale-rule-wins** (1): unconditional rule to a DIFFERENT category was never retired; the
  stable-sort tie-break let the OLD rule drive every future ingest (probed). FIXED: supersede in
  ensureUnconditionalRule; all four mint surfaces share it. Lock: stale_rule_wins_recategorize.
- **P1 gate** (1): NO lock pinned the serializableTx wiring (sed-strip stayed green). FIXED:
  serializable-wiring.test.ts — spy over the four triage actions + provider source pin.
- **P2s**: cascade read in-tx; P2025 → skip-deleted-row (was: whole SimpleFIN pass-2 abort);
  rule.create vs rule.reuse audit honesty; ledger counts corrected in place.
Residuals accepted (rationale): applyToAllSimilar keeps its old shape — no UI caller imports it
(verified by the checker); a retired rule is not resurrected by undo (re-mint is one tap); SimpleFIN
new-id churn LOSES the split decision by design (no id link — heuristic matching rejected, would
misfile real money; the fresh row lands in review when the pipeline is unsure, or files under the
user's own rule).
Fail-old proof (stash-run): exactly the 9 new locks red on pre-fix code, green on fixed.

### 2026-07-02 (late) — transactions:191 register-write-in e2e: 3-point A/B → ENVIRONMENTAL
During the cycle-3 gate, `register write-in: create a category inside the picker and refile (#136)`
failed reproducibly (isolated ×2): recat-once clicked, chip never flips within 20s, NO server error.
Discriminators run: (1) NEW unit lock drives the EXACT server path (createCustomCategory →
recategorize scope:'one' → custom id on a manual merchantless row) through the REAL actions → GREEN
(custom-category-lifecycle.test.ts); (2) sibling e2e :145 (same chip→picker→recat-once component,
same action, system category) → GREEN 7.0s same run; (3) **3-point A/B, fresh `next build` each:
HEAD=FAIL, bbda775 (cycle-2)=FAIL, e51d6fe (PRE-cycle-2, old recategorize/applyCategory)=FAIL.**
The failure predates every categorization change in the unpushed stack; the spec was green in prior
sessions. Same class as yesterday's a11y 3-point A/B (day-long machine degradation, unrebooted since
Jun 30): the action response/revalidation apply stalls, UI never re-renders. The write-in+refile
combination does TWO server actions back-to-back — the heaviest single-row flow — which is why it
trips before its siblings. Cure = reboot; re-witness gated on the standing owner NEXT.

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

## 2026-07-02 — CYCLE 5 (owner-authorized fix round): the open P1 + P2s 26-33 CLOSED (DECISIONS #148)
Owner authorized one more maker/checker round + ratified age-out-only split sweeping (#27).
FIXED: **the P1** via Transaction.reviewPinned (set on every dissolve, respected by the preserve
predicates, carried across id churn, cleared by every user filing action) — multi-sync locks now
assert the review SURVIVES identical re-sends and releases only on the user's decision, both
providers + the churn path; **#26** raw-id corroboration (a garbled row never reads as absence);
**#27** in-window reconcile never touches split parents (age-out dissolves, bounded ≤32d — same
residual class as #128); **#28** Plaid same-id dissolve locked (multi-sync); **#29/#30** wiring pin
hardened (non-comment lines only; any-shape $transaction ban in providers; triage-actions pinned
with an exact-4 interactive allowlist); **#31** dead becameRuleId falls through to a fresh mint
(lineage re-pointed); **#32** deleted-in-window + audit-provenance locks added; **#33** Safety
docstring rewritten to the real contract. Items 26-33 and the cycle-4 P1 are CLOSED.
Fail-old (stash-run): exactly the 8 new/rewritten behavioral locks red on pre-fix code.

### 2026-07-02 — Cycle-5 SCOPED confirmation (wf_eed966ba): 4 confirmed (1 P1 + 3 P2, 0 refuted) → FIXED same session
The confirmation caught the pin's remaining blind spots:
- **P1 backfill (the SEVENTH writer, found by both lenses)**: the /triage backfill button re-ran the
  user's own rules over a dissolve-pinned row — silently auto-filed it AND left the contradictory
  pinned-but-filed shape (never in triage → no surface could clear the pin; a later churn popped it
  BACK into review). FIXED: `reviewPinned: false` in backfill's select AND its compare-and-set
  re-assert (a row pinned inside the read→write window is skipped). Lock: backfill_respects_pin.
- **P2 sweep laundering**: a dissolve converts a sweep-protected split parent into a plain PENDING
  row; one flaky snapshot deleted it and the re-report re-created it on the rule verdict — pin
  laundered. FIXED: the in-window sweep excludes pinned rows (age-out stays the backstop). Lock:
  sweep_launders_pin.
- **P2 comment-stripping**: trailing comments / block-comment interiors could still satisfy the
  wiring pin. FIXED: block comments removed globally + trailing ` //` stripped (string URLs kept).
Both behavioral locks fail-old-proven by stash-run (exactly the 2 new locks red pre-fix).
HONESTY: these confirmation fixes are lock-proven but have NOT had a further adversarial round —
the owner authorization covered one fix round + one scoped confirmation, both now spent.

## 2026-07-02 — Currency disclosure extended to the final 5 surfaces (#149) — residual 23 CLOSED
Picked up the top backlog item (STATUS residual 23) while reboot + push of the unpushed stack stay
owner-gated. Extended the shipped currency-exclusion banner (#141/#145) from dashboard//accounts//investments
to register (`/transactions`), `/triage`, `/recurring`, `/reports`, `/coach`. Purely additive UI wiring:
each server page fetches `getWithheldAccountSummary(userId)` and mounts `<CurrencyExclusionBanner>`, which
SELF-NULLS at count 0 → all-USD users (incl. the seeded demo user) render zero banner DOM → demo/golden
byte-identical. Mount style per the #141/#145 convention: inline in the 3 inline-JSX server pages (after each
page's zero-account `EmptyDashboard` gate — auth.spec's onboarding contract untouched), `withheld` threaded
into `RecurringView`/`ReportsView` for the 2 view-backed pages (no redundant wrapper).

**Focused Checker (wf_a7eaf280, 3 lenses → adversarial verify): 0 P0/P1**, 2 P2 CONFIRMED + FIXED before
commit — (P2-a) axe covered only /recurring in the positive path → folded a per-surface axe A/AA scan into a
unified 5-surface loop (phase5-a11y's triage/coach pins run on the all-USD demo user, where the banner
self-nulls, so they never exercise it); (P2-b) the first /recurring + /reports page wrappers duplicated the
view's own `max-w` root (an inert extra `<div>`, so NOT strictly byte-identical) → re-threaded `withheld` into
both views, wrapper removed. 8 candidates refuted (self-null; gates preserved; `role="status"` overrides
Alert's default; single-mount; RSC boundary valid; anchors non-vacuous; copy matches; pure-all-foreign→EmptyDashboard
is a PRE-EXISTING documented residual). The verifier also independently re-ran `tsc`/`eslint` clean on the diff.

**Gate (real, measured 2026-07-02):** `bash scripts/verify.sh` → ✅ VERIFY GREEN — **1554 unit / 122 files**
(no new unit tests — the mechanism is already unit-locked; this increment's locks are e2e, the #145 precedent),
tsc/eslint/build clean. Targeted e2e `currency-disclosure.spec` **3/3 GREEN** (19.2s, no stall): negative
zero-render on all 5 new surfaces for the demo user (anchored on below-Suspense page content per the #141 rule),
positive banner-present + `'EUR, GBP'` + per-surface axe A/AA on all 5 for the withheld fx user, + the unchanged
byte-identity lock. Full-suite serial e2e re-witness stays reboot-gated (standing owner NEXT; the environmental
disabled-pending stall is untouched by this read-only change).

**Accepted residual (pre-existing, not introduced):** a user with ONLY non-USD accounts (zero USD) still hits
`EmptyDashboard` on the 4 gated pages (dashboard/recurring/reports/coach) before the banner — the same gate
asymmetry #141/#145 documented (accepted-22 pattern); such a user still sees the disclosure on /accounts,
/transactions, /triage (ungated). Residual 25 (inline per-projection assumption copy on /coach + /reports) also
remains, though the banner now surfaces that assumption at the top of both pages.

**State:** working tree has the #149 change (7 files: 5 pages + 2 views + the spec) — committed below. Local main
was HEAD `d6d87f3` (18 unpushed); this adds one more functional commit. Production unaffected until the owner
pushes (the whole categorization stack + #149 ship together on the next push — owner's call).

## 2026-07-03 (session "aimplifi") — Plaid PFC passthrough (#155) — DONE ✅ (verify green, hostile Checker 0 P0/P1)

Wired Plaid's per-transaction `personal_finance_category` (ingested but previously ignored) into the shared
categorizer as a DETERMINISTIC rescue signal — see DECISIONS #155 for the full design. Highlights / honest limits:

- **Rescue-only, never override.** The hint fills in ONLY a row our own normalization would send to review; a user
  rule, a transfer, a confident merchant match, an amount-banded ambiguity, and a deliberate aggregate
  (Zelle/Venmo/Check) all win over it. Confidence is capped in `[7000, 9000)` so a PFC-filed row auto-files with the
  visible AI badge — a correctable guess, never silent.
- **Transfer-safe (critic F4).** The mapper NEVER emits `transfer`: every Plaid TRANSFER_IN/OUT taxonomy value → no
  hint, and the pipeline re-guards non-transfer. Spend can't be silently erased by a Plaid guess.
- **Sign-guarded (#44).** Inflow → an Income-group category only; outflow → never income; `$0` → never rescued.
- **Golden-safe (#22).** demo / CSV / SimpleFIN / seed never set the hint → `categorize()` byte-identical, zero
  golden movement. **The live Plaid network path remains dormant + UNVERIFIED** (no sandbox creds here, consistent
  with STATUS #12) — the PFC LOGIC is fully unit-tested (categorize.test.ts + plaid-map.test.ts, +27 tests incl. a
  map-integrity guard over all ~102 targets), but whether real Plaid rows carry the field / confidence we expect
  needs the owner's live sandbox run (docs/PLAID_WALKTHROUGH.md §5).

Hostile Checker (wf_677df90e-922; 6 dimension reviewers — golden-safety / transfer-safety / sign-guard /
rescue-ordering / taxonomy / robustness — + 2 adversarial verifiers per finding; 8 agents / 745k tokens / 130 tool
calls): **0 P0/P1**. The lone P1 candidate ("the 102-entry map is under-tested") was refuted to P2 by BOTH
verifiers (every target independently re-confirmed to exist and be non-transfer; the taxonomy/sign invariants are
enforced at runtime). 6 P2 hardening fixes applied pre-commit: the map-integrity guard test; `$0`-amount,
amount-band-ordering, and Venmo/Check aggregate tests; an income-inflow success e2e; a malformed-field-type
non-throwing test; and a SEWAGE_AND_WASTE_MANAGEMENT → `water` remap (matches our own normalizer's SEWER/SEWAGE →
water and the "Water & Sewer" leaf name). Accepted P2 (documented): GENERAL_SERVICES_POSTAGE_AND_SHIPPING → `business`
is KEPT — it matches our own normalize.ts (FEDEX/UPS STORE/USPS → business), not a defect.

Gate (real, measured 2026-07-03): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — typecheck/lint clean,
**1656 unit / 125 files** (+27), build clean. E2E: not applicable (the Plaid path is dormant — no e2e surface;
demo/seed are byte-identical, so the existing suite is unperturbed). No schema change.

## 2026-07-03 — SimpleFIN holding-level currency guard (DECISIONS #156, residual 20 CLOSED)

The account-level currency guard (#135/#141/#149/#150) withholds non-USD ACCOUNTS from the USD read
paths, but `mapSimplefinHoldings` received each position's `currency` and never read it — so a non-USD
lot inside a USD-labeled brokerage summed into `/investments` at a fabricated 1:1 (the guard only fires
on the whole account). Fix (engine-first, no schema change): the mapper now WITHHOLDS confidently-non-USD
positions before aggregation and counts them in a new `withheldNonUsd` field kept DISTINCT from `skipped`
(a foreign lot is working-as-intended, not an un-mappable glitch). Threaded through `syncFromSimplefin` →
`SyncResult.holdings` (types.ts) → `SimplefinResult.holdings` (simplefin-actions.ts).

- **Predicate = account-consistent** (not a divergent second rule): `!isSupportedCurrency(canonicalizeCurrency(h.currency))`
  — null/omitted → USD (golden-safe: demo/CSV/manual carry no currency), `'usd'/'USD'` → USD, any non-USD
  ISO code / crypto-or-non-ISO URL / opaque token → withheld. Deliberately REJECTED the "understand"
  workflow's NARROW recommendation (withhold only a clean 3-letter ISO ≠ USD, keep URLs/opaque as USD):
  SimpleFIN expresses crypto/non-ISO currencies as a URL, so narrow would LEAK exactly those at a wrong
  1:1 — the silent corruption the guard exists to prevent — contradicting the app-wide "a withheld figure
  beats a silently wrong one" philosophy. A false-withhold is visible + recoverable (data preserved); a
  1:1 leak is invisible. The Checker independently confirmed the aggressive call SOUND (under the SimpleFIN
  protocol USD is always `'USD'` or omitted, so aggressive CANNOT false-withhold a real USD lot).
- **Gate refinement** (simplefin.ts ~475): `|| (withheldNonUsd > 0 && skipped === 0)` so a CLEANLY-interpreted
  all-foreign feed reconciles (prunes stale USD rows) while a MIXED foreign+glitch feed still preserves rows
  (#133 intact — the `skipped === 0` qualifier is a Checker P2, fail-old-proven).
- **Golden-safe / net-worth-neutral:** SimpleFIN is the only currency-bearing ingress; net worth uses account
  balances (holdings are a within-account breakdown). The live SimpleFIN path is dormant/UNVERIFIED → unit-tested
  only.

Hostile Checker (wf_1ac2c779; 4 dimension reviewers — money-semantics / golden-safety / sync-orchestration /
test-coverage — → refute-by-default verification of each P0/P1): **0 P0/P1**; scorecard money 9 / golden 9 /
sync 8 / tests 8. **2 P2 FIXED pre-commit + fail-old-proven:** (1) the gate opener was too coarse — `|| withheldNonUsd > 0`
alone reconciled a mixed foreign+glitch feed and pruned its held rows, silently widening the #133 guarantee →
added the `&& skipped === 0` qualifier; (2) a mixed-case regression test (proven red against the coarse gate).
Accepted/deferred P2s (documented): numeric ISO `'840'` would be false-withheld (SimpleFIN never emits numeric
currency codes; byte-consistent with the account guard); per-account `withheldNonUsd` accumulation is trivially
correct by inspection (a two-brokerage test is a deferred nicety). The predicate can be flipped to narrow in one
line if a live sandbox run ever shows `holding.currency` carrying a security identifier.

Gate (real, measured 2026-07-03): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — typecheck/lint clean,
**1666 unit / 125 files** (+10: 7 mapper cases + 3 sync cases), build clean. No schema change; demo/golden
byte-identical (the demo seed's 5 holdings carry no currency and never pass through the mapper).

**DEPLOYED ✅ (owner: "push")** — `git push origin main` → `5a110c5..7764871` (origin was at #155, so this also
shipped the previously-unpushed #155 deploy-record doc commit `7958a0c`). Deploy VERIFIED READY: Vercel
commit-status for `7764871` = **success** ("Deployment has completed", deployment `D9gjiaVn2GRHn43As6VL6AwHK8WL`,
team reiforge / project aimplifi; queried via GitHub's commit-status API with the stored git credential — no
Vercel MCP this session), corroborated by `www.aimplifi.app/sign-in` → HTTP 200 + HSTS
(`max-age=63072000; includeSubDomains`). #156 is LIVE.

## 2026-07-03 — Root 404 / not-found chrome (#157, ROADMAP prod-readiness)

The error chrome had global-error.tsx (root-layout crash) + (app)/error.tsx (in-shell render throw)
but no not-found.tsx, so an unmatched URL rendered Next's unstyled default 404. Added a branded root
`src/app/not-found.tsx` — a lean server component rendered INSIDE the root layout (Tailwind + the dark
theme + buttonVariants, like (app)/error.tsx): an Aimplifi wordmark, one `<h1>` "Page not found", muted
copy, one recovery Link to /dashboard. `metadata:{title:'Page not found'}` flows through the root
`title.template` → "Page not found · Aimplifi" (confirmed applied by the e2e). Zero notFound() callers
→ an unmatched URL is the only 404 path (resolves OUTSIDE the (app) group), so one root not-found.tsx
is exactly right; no (app)/not-found.tsx (YAGNI). NO schema change; purely additive → demo/golden
byte-identical (a static page touches no financial data).

Scope note: chose this over the higher-visibility "Investments in nav" item — the latter needs an 8th
phone nav icon (SECONDARY renders as 7 icons on the phone top bar, app-nav.tsx), exactly the #71 "bar
full at 7" constraint prior sessions honored, so it belongs to the owner-scoped mobile-nav redesign.
The 404 is additive, golden-neutral, and fully verifiable WITHOUT the reboot-gated action-apply e2e
stall (a 404 is a pure GET — no server action).

Hostile Checker (wf_f412b291-329, 4 lenses → double refute-by-default verification): **0 P0/P1**. All
lenses clean (service worker passes 404s through, no cache-masking; emerald-500 ~7.8:1 +
muted-foreground ~7.6:1 on the dark bg both clear AA; the title is locked by a real e2e assertion so a
metadata regression fails CI not silently; the e2e is a genuine non-vacuous fail-old lock —
`data-testid="not-found"` + the exact h1 + title distinguish it from Next's default 404). 3 P2:
- FIXED: the not-found.tsx + spec docstrings overclaimed "authenticated-only" — middleware's UNANCHORED
  icon/manifest/favicon.ico exclusions let those prefixes skip auth and render the 404 with no session.
  Corrected both docstrings AND added the intended-boundary lock (unauthenticated unmatched → /sign-in)
  as a robust second e2e test. (Also caught a self-inflicted build break pre-commit: the first docstring
  edit put a comment-terminator inside the block comment — verify went red, fixed by rephrasing. The
  gate did its job.)
- ACCEPTED (documented): (a) an unauthenticated typo'd URL → /sign-in rather than a friendly public 404
  — pre-existing middleware behavior, defensible for a fully auth-gated app; (b) single "Go to dashboard"
  recovery with no "Sign in" link — a second CTA would confuse the common (authed) reacher (unlike
  (app)/error.tsx, whose case is auth-adjacent), and the expired-session path already redirects
  gracefully — a deliberate single-CTA choice.

OBSERVED (pre-existing, NOT fixed — out of scope, no data exposure): middleware.ts's unanchored
icon/manifest/favicon.ico exclusions let /iconzzz, /manifestfoo, /favicon.icoX skip the auth matcher.
They all 404 anyway (no route/asset), so nothing protected is served — the only effect is they render
the branded 404 without a redirect. Tightening the auth-boundary matcher (anchoring those prefixes)
risks the auth boundary and deserves its own careful increment; flagged for the owner, not changed here.

Gate (real, measured 2026-07-03): `bash scripts/verify.sh` → ✅ VERIFY GREEN — typecheck/lint clean,
**1666 unit / 125 files** (no unit delta — UI chrome is e2e-locked per the #145/#156 precedent), build
clean. E2E `not-found.spec.ts` **2/2 GREEN** (authed 404+recovery 2.7s; unauth→sign-in boundary 336ms).

**DEPLOYED ✅ (owner: "push it")** — `git push origin main` → `2046fd5..ed72acf` (origin was at #156;
now 0 ahead/0 behind on the functional commit). Deploy VERIFIED: Vercel commit-status for `ed72acf` =
**success** ("Deployment has completed", deployment `EPSeh5KcqMHvaTc16EWodXxbYsoB`, team reiforge /
project aimplifi; via GitHub's commit-status API with the stored git credential — gh was unauthenticated,
no Vercel MCP this session). Stronger-than-usual live corroboration: `www.aimplifi.app/sign-in` → HTTP
200 + HSTS (`max-age=63072000; includeSubDomains`), AND the #157 change itself confirmed serving live —
`www.aimplifi.app/iconzzz` (an unmatched path that skips the auth matcher via its unanchored icon-prefix)
→ **HTTP 404** with the branded page in the response body (`data-testid="not-found"`, the "Page not found"
h1, the "Aim<span>" wordmark, the "Go to dashboard" recovery). #157 is LIVE. This deploy-record doc line
is committed local-only (intentionally UNPUSHED to avoid a redundant identical rebuild — rides out with
the next functional change, per the #154/#155 precedent).

## 2026-07-03 — Register recategorize-picker Escape / outside-click dismissal (#158, ROADMAP prod-readiness)

The inline category picker on /transactions (transaction-list.tsx, single-controller openId model) only
closed by re-tapping the chip — no Escape, no outside-click. A real keyboard-operability + usability gap
on the app's most-used flow. Added (client-only, no server/engine touch):
- A useEffect scoped to an open menu that adds a document mousedown outside-click listener closing the
  picker (ref on the open row's chip+menu wrapper), gated on !pending so a stray click can't abandon an
  in-flight create/refile.
- A container-level Escape (onKeyDown) that closes and RETURNS focus to the chip (WCAG 2.4.3).
- close() promoted to useCallback (stable effect dep).
- Two-level Escape preserved + hardened: the "+ New category" sub-form's Escape closes ONLY the
  sub-form, now handled on the sub-form CONTAINER so Escape from ANY sub-form control (not just the name
  input) steps back one level.
Escape is deliberately NOT gated on pending (only the outside-click is) so it stays a keyboard escape
hatch even if a server action stalls (#16/#17) — a false-lock trap is worse than a rare orphan category.
Golden byte-identical.

Hostile Checker (wf_1e6176e9-763, 4 lenses -> double refute-by-default): 0 P0/P1 (lone a11y P1 candidate
double-refuted). Independently confirmed menuRef containment (recat confirm pane + sub-form clicks count
as inside -> recat/write-in/row-switch flows intact), no listener leak, stable close(), robust
outside-click target, genuine fail-old locks, non-vacuous focus-return assertion, and that the write-in
test failure is the environmental #16/#17 stall not a #158 regression. 2 P2 FIXED pre-commit: (a)
two-level Escape worked only from the name input -> moved to the sub-form container + a fail-old
group-select test; (b) outside-click could orphan a category mid-create -> pending gate. Accepted P2s
(documented, low value): a listener-leak double-cycle test and an Escape-from-option-button test
(cleanup correct by construction; Escape scope is container-level, covered by the search-input test).

Gate (real, measured 2026-07-03): bash scripts/verify.sh -> VERIFY GREEN — typecheck/lint clean,
1666 unit / 125 files (no unit delta — client UI, e2e-locked per the #145/#156/#157 precedent), build
clean. E2E: the 4 new #158 tests in transactions.spec.ts PASS (Escape+focus-return 3.3s; outside-click
3.4s; sub-form name-input Escape 3.6s; sub-form group-select Escape 3.7s). Pre-existing action-heavy
register tests (recat #36, write-in #136) hit the documented environmental #16/#17 action-apply stall on
this unrebooted machine (recat FAILED-then-PASSED on retry -> non-deterministic; write-in fails only at
its post-server-action persistence assertion, AFTER the full menu interaction completed) — NOT a #158
regression; reboot-gated re-witness.

**DEPLOYED (owner: "push")** — git push origin main -> ed72acf..be5707a (shipped #158 + the #157
deploy-record doc commit; origin now 0/0). Deploy VERIFIED: Vercel commit-status for be5707a = success
("Deployment has completed", deployment E3roppmuNgvymGe1seY6kfMF9UnY, team reiforge / project aimplifi;
via GitHub's commit-status API + the stored git credential). Live health: www.aimplifi.app/sign-in ->
HTTP 200 + HSTS; /iconzzz -> HTTP 404 branded ("Page not found") — confirms #157 still live + the deploy
serves latest. #158's client-side dismissal is behind auth + browser interaction so not curl-verifiable —
proven by the 4 passing #158 e2e tests pre-deploy. #158 is LIVE. This deploy-record doc line is committed
local-only (UNPUSHED to avoid a redundant identical rebuild; rides with the next functional change).

## Investments discoverability — INVESTMENT rows link to /investments (DECISIONS #159)

The portfolio view (holdings, TWR/XIRR, retirement outlook) was reachable only via a tiny
top-of-page "View investments ->" text link on /accounts; a linked brokerage's own row
dead-ended at its transaction ledger. Now an INVESTMENT-type `LinkedRow` navigates to
`/investments` and shows an inline "· View holdings ->" cue (inherits the AA
`text-muted-foreground` token — no new color, axe-clean). Surgical + a11y-safe: `LinkedRow`
is a lone `<Link>`, so a type-conditional href introduces no nested-interactive element; the
action-bearing `ManualRow` (a manual INVESTMENT is a typed balance with no holdings) is left
untouched, and `/investments` is portfolio-wide (no account param) so the link is plain.
Client/nav-only — golden + demo byte-identical, no engine/schema change.

Gate (real, measured 2026-07-03): core `bash scripts/verify.sh` -> **VERIFY GREEN** —
typecheck/lint clean, **1666 unit / 125 files** (no unit delta — client UI, e2e-locked per
#145/#156/#157/#158), build clean. E2E: the new #159 test in investments.spec.ts PASSES (click
the seeded "Brokerage" account-row -> /investments + $142,000.00 portfolio + "View holdings"
cue, 3.5s); the non-investment row -> /transactions path stays green (transactions.spec.ts:29);
/accounts stays WCAG-AA (transactions.spec.ts:313 axe scan passed WITH the cue span live).

Hostile Checker (wf_af042228-cf6, 3 lenses + refute-by-default verify): **0 P0/P1**. 3 P3, none
blocking (see DECISIONS #159): (a) a dedicated per-page /accounts+/investments axe scan would lock
the guardrail the Checker flagged — though transactions.spec.ts:313 already covers /accounts and
passed; (b) with multiple INVESTMENT accounts the per-row cue lands at the aggregate top, not that
account's card (right for the single-brokerage seed); (c) the brokerage's transaction ledger is now
one hop further (via the /transactions Account filter) — a no-op for the demo (the seed brokerage
has zero transactions).

FULL VERIFY_E2E on this unrebooted machine still surfaces the pre-existing environmental #16/#17
server-action-stall flakes on write-heavy pages this change never touches (/budgets set-target,
/calendar next-month, /triage accept, transactions write-in/filter). The failing SUBSET is
non-deterministic across reruns (parallel: transactions:76; serial: transactions:191; phase4 went
1->2 fails in isolation) — the signature of the documented stall, NOT a #159 regression. The #159
blast radius is exactly `LinkedRow` on /accounts + one /investments test; it is disjoint from every
failing spec. Reboot-gated re-witness, consistent with the #158 sign-off.

**DEPLOYED (owner: "push")** — `git push origin main` -> be5707a..f17b0d0 (shipped #159 +
the #158-deploy-record + #159-decision doc commits; origin now 0/0). Deploy VERIFIED: Vercel
production deployment dpl_A9YGDCGmhPwkkLzexsq8i1F4VfmY (commit f17b0d0) reached READY in ~64s and
holds every production alias (www.aimplifi.app, aimplifi.app, aimplifi-git-main-reiforge.vercel.app),
aliasError null. Live health: www.aimplifi.app -> HTTP 200 via Vercel (iad1) with full security
headers intact (HSTS max-age=63072000, CSP, X-Frame-Options DENY, nosniff); the sign-in page renders
(demo-sign-in present); an unauth bogus path rewrites to /sign-in (x-matched-path=/sign-in) — the
documented #157 unauth boundary. #159's investment row-link is behind auth + browser interaction so
not curl-verifiable — proven by the passing #159 e2e pre-deploy. #159 is LIVE. This deploy-record
doc line is committed local-only (UNPUSHED to avoid a redundant identical rebuild; rides with the
next functional change).

## /investments account scoping — ?account narrows to one account (DECISIONS #160)

The #159 follow-up (P3-b the owner named in the #159 NEXT list). INVESTMENT /accounts rows now link
to `/investments?account=<id>` (LinkedRow carries the id), and /investments narrows its per-account
holdings list to that account for a real MULTI-brokerage user (the owner's Plaid+SimpleFIN production
case) with a "Show all accounts →" reset; the single-brokerage demo is the golden-safe test vehicle.
Built VIEW-LAYER (pure `resolveInvestmentScope` in src/lib/engine/investments/scope.ts) — `getInvestments()`
/ net worth / retirement UNCHANGED; the portfolio-wide summary card (the pinned $142k golden) reads
`data.overall` exclusively. Golden-safety keystone = the ≤1-account INERTNESS rule: the demo renders
byte-identical with or without `?account`, so no pinned golden (portfolio value, allocation, net worth,
retirement) can move; scoping activates only with >1 investment account. Unknown / matched-but-empty /
array `?account` → full-view fallback (never empty or broken).

Gate (real 2026-07-03): core `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1674 unit / 126 files** (+8:
scope resolver known-answers), tsc/eslint/build clean; investments e2e 6/6 (incl. #159 ?account
inert-demo + #160 unknown-id fallback + axe WCAG-AA); transactions:29 (non-investment row → /transactions)
+ :313 (/accounts axe) PASS. All pure-nav/render/unit → sidesteps the #16 stall entirely.

Hostile Checker (wf_13d4c3fc-c44, 4 dimensions → refute-by-default verify of every P0/P1): **0 P0/P1** —
correctness 10/10 (summary card structurally reads data.overall only; inertness holds; no golden moves),
security 9/10 (ownership unbreakable — the view filters already-ownership-scoped data, a foreign id just
matches nothing → full view; searchParams type-safe; no XSS). All 3 P1 candidates (test-adequacy: the
active multi-account scope path isn't e2e-tested) REFUTED to P2 — adding a 2nd seed brokerage would move
the very goldens #160 must hold, so the narrowing LOGIC is unit-locked (the 8 known-answers ARE the
"filtering-applied vs param-ignored" distinction) + a thin view consumer + e2e wiring, matching the #123
retirement-what-if precedent (repo has no RTL/jsdom; environment:'node'). 1 P2 FIXED: chip copy "Showing
<name> holdings" (scope clarity). Accepted P2s (documented, app-consistent): the reset link uses the shared
muted+hover:underline+arrow pattern (axe-passing, transactions:313); no bespoke focus-restore (consistent
app-wide — #81 skip-link + focusable <main>); `?account` unencoded matches the shipped /transactions
sibling (cuid URL-safe); no axe-on-scoped-view (the demo can't render one — inert). Ledger: DECISIONS #160;
PROGRESS 2026-07-03 #160 + handoff. Committed, NOT pushed (push owner-gated).

## #161 — Categorization learns from repeated corrections (passive learning) — DONE ✅

Owner ask: "the categorization should learn from users' inputs; the user shouldn't have to recreate
the wheel each time." Before this, a `Correction` was per-transaction and consulted by NOTHING at
categorize time — it only helped future rows if the user manually promoted it to an explicit "Always"
rule (easy to miss, blocked for aggregates), so "credit card paid" / "check paid" -> transfer, re-filed
every sync, never stuck. Now pure `deriveLearnedRules()` (src/lib/engine/categorize/learn.ts) turns the
undoable Correction HISTORY into synthetic `RuleLike[]` appended (in src/server/rules.ts `loadUserRules`)
to the same `rules[]` array `categorize()` already applies at every ingest + backfill path. Learned rules
key on an IDENTITY-PRESERVING descriptor signature (src/lib/engine/categorize/signature.ts): dates + money
amounts stripped, account/phone/check numbers KEPT — so two occurrences of the same payee share one key
while two different payees never do. Earned by repetition: same category >= 2 times across distinct
transactions, zero conflicts, #44 sign guard at derive AND match time, a distinguishing-token guard for
payee-less residues. Computed on the fly — no schema change, no DB writes — so the demo (0 corrections)
derives 0 learned rules and every golden is byte-identical; undo re-derives. A learned rule auto-files at
8500 (FLAGGED band) with the visible AI badge, a correctable guess rather than the silent 9900 an explicit
"Always" earns. Also shipped: Google One -> software, Round1 -> entertainment (owner-reported normalize misses).

Gate (real 2026-07-04): `bash scripts/verify.sh` -> ✅ VERIFY GREEN, **1704 unit / 128 files** (+30 over the
1674/126 baseline: learn.test.ts known-answer canaries + hostile-critic regressions; learn-loader.test.ts
drives the real recategorize -> loadUserRules -> categorize chain on a throwaway user), tsc/eslint/next build
clean; adversarial `eval:categorize` 100% auto-file precision / 0 confidently-wrong (Google One + Round1 now
auto-file). Engine-first: the whole learner is a pure unit-tested function on flat primitive inputs.

Hostile Checker — FOUR cycles (Workflow maker/checker, dimension critics -> refute-by-default verify of every
P0/P1), **0 P0/P1 at sign-off**. c1: 6 P0/P1 over-generalization (enumeration defeated by numeric payees;
unguarded canonical; no match-time sign guard) -> adopted the identity-preserving signature + distinguishing-token
+ match-time sign guard. c2: 2 (fragile SEND/MONEY/BANKING; HMSHOST bucket canonical) -> REMOVED canonical mode
entirely (distinct payees structurally un-mergeable). c3: 1 P1 (payee-less generic mechanism labels DIRECT DEBIT /
POINT OF SALE / SERVICE CHARGE / LOAN PAYMENT) -> extended NOISE_TOKENS + AI-badge backstop so any missed label
is visible, not silent. c4 (final): the confidence/AI-badge ripple dimension came back CLEAN (0 findings), and
1 P1 was reproduced end-to-end — bare payment-frequency / card-entry labels ("AUTOMATIC PAYMENT <date>",
SCHEDULED/REGULAR/PERIODIC/GENERAL PAYMENT, PIN PURCHASE) are a payee-less-AND-number-less residue with no number
to keep billers apart -> FIXED by extending NOISE_TOKENS with 11 payment-frequency adjectives + card-entry modes,
each verified brand-safe (GENERAL MOTORS->MOTORS, AUTOMATIC DATA PROCESSING->DATA, SIGNATURE PROPERTIES->PROPERTIES).

Accepted residual (documented): the payee-less-AND-number-less class is closed enumeratively for every common
US-bank autopay label; any RARE unlisted bare label is bounded to P2 by the AI-badge backstop (auto-files as a
visible correctable guess at 8500, strictly no worse than the app's existing provider-hint / low-confidence
merchant guesses). Two accepted P2s: (a) a named payee whose descriptor carries a VARYING confirmation number
never repeats a signature, so it stays in review — a money-safe false negative; explicit "Always" remains the
merchant-wide tool. (b) learnedSignOk is inert for a custom/unknown-group category (returns true), gated instead
by the derive-time consistency + distinguishing-token guards. Owner's headline cases: "CREDIT CARD PAID" learns
(date-fragmented; CREDIT is its distinguishing token; a card payment IS a transfer); "CHECK PAID" correctly
REFUSES (payee-less + ambiguous — the safe default). Ledger: DECISIONS #161; REGRESSION_LEDGER 2026-07-04;
PROGRESS 2026-07-04 #161 + handoff. Committed, NOT pushed (push owner-gated).

## #162 — "Accept all confident": one-tap triage-pile drain — DONE ✅

Owner "drain the pile" queue-UX pick. SUBSYSTEM-MAP FINDING (surfaced to the owner before building):
the handoff's premise was STALE — `/triage` already groups the review pile by merchant and files a
whole group in one action (`fileMerchantGroup`, #143). So this adds the missing accelerant on TOP of
the existing carousel, it does NOT rebuild it.

**What shipped (engine-first, surgical — reuses the tested #143/#146/#147 filing path):**
- `src/lib/engine/categorize/group.ts` (+3 pure fns) — `isConfidentGroup` (suggestedCategoryId !== null =
  the exact swipe-right bar; groupReviewRows only sets it when EVERY row agrees, never a guess),
  `selectConfidentGroups`, `summarizeConfident`. ONE predicate → client button + server action can't drift.
- `src/server/triage-actions.ts` `acceptAllConfident()` — re-derives the confident set server-side from
  getTriageGroups(userId) (client list never trusted), loops the EXISTING `fileMerchantGroup` per group
  (per-group serializable-tx commit, rule mint/reuse, aggregates no rule #23), collects all correctionIds
  into ONE undo batch (existing `undoCorrections` reverts the lot + removes ONLY minted rules). Per-group
  commits (a drain is incremental + independently undoable); catch-per-group = graceful partial; total
  wipeout throws a stable user-safe message (fail-loud, no raw-error leak); no-op early-return (0 confident
  → no audit/revalidate).
- `src/components/triage/triage-inbox.tsx` — bulk-accept banner shown only when `mode==='idle'` AND ≥2
  confident (never mid-pick → never discards an in-progress recategorization; 1 is just a swipe), optimistic
  drop-then-reconcile with the authoritative returned queue, focus handoff to the aria-live count (SC 2.4.3),
  one undo entry ("N transactions in M merchants").

**Golden-safe by construction:** the demo's 12 review groups are ALL ambiguous (Zelle payees / checks /
Store Card → 0 confident) → banner provably inert → every golden byte-identical; it acts only on a click.

**Gate (real 2026-07-04):** `bash scripts/verify.sh` → ✅ VERIFY GREEN, **1716 unit / 129 files** (+12:
pure selection; drain files-confident/leaves-ambiguous; mint-vs-reuse; undo round-trip removing ONLY minted
rules; ownership isolation; no-op; partial-failure-skips-and-requeues; total-failure-fail-loud; non-vacuous
demo-0-confident golden lock), tsc/eslint/next build clean. Read-only e2e green: banner absent on the
all-ambiguous demo (3.0s) + the existing gesture/filing/undo flow unregressed (4.6s).

**Hostile Checker (Workflow, 5 dimension critics → refute-by-default adversarial verify of every P0/P1):**
scorecards correctness 8 / security 8 / golden 9 / ux-a11y 7 / coverage 6, **0 confirmed P0/P1** (the lone
P1 candidate — the untested partial-failure branch — was self-DOWNGRADED to P2 by its verifier: "shipped
code is correct, a pure coverage gap"). Fixed the high-value P2/P3s before sign-off: partial + total-failure
tests + demo-0-confident golden lock; no-op early-return; clean fail-loud message; banner gated to idle;
focus handoff; "the ambiguous rest stay for you to review" copy + unit-bearing undo label. Accepted/
documented P2/P3s: partial failure is signalled by the failed groups visibly reappearing in the queue (rare
error path; no new toast channel); fileMerchantGroup's post-commit auditLog-throw un-undoable edge is a
pre-existing property of that path; no per-action rate limit (consistent app-wide, ROADMAP #8); the active
client handler is e2e-inert on the all-ambiguous demo so it is server-boundary + pure-unit locked (the
#160/#123 no-RTL precedent); #161 learned rules re-confidencing a still-queued group is the learner working.
Ledger: DECISIONS #162; REGRESSION_LEDGER 2026-07-04; PROGRESS 2026-07-04 #162 + handoff. Committed, NOT
pushed (push owner-gated).

## 2026-07-04 — #163 open finding: phase2-triage e2e stall (PRE-EXISTING, roaming — not #163)
One phase2-triage spec per run times out (60s) on a triage button stuck disabled mid-flow (`pending`
never settles — a server action that neither errors nor returns; the manually-captured `next start` log
shows NOTHING). PROVEN pre-existing and tree-independent by controlled A/B runs (all with fresh builds,
killed 3100 servers):
  • pre-#163 tree, :109 SOLO run → FAILS;  post-#163 tree, :109 in full-suite → passes.
  • post-#163 tree, :239 solo → passes;  :239 after 2+ specs in sequence → FAILS (×3).
  • pre-#163 tree, SAME full spec file in sequence → FAILS at :239 IDENTICALLY.
The failure roams between specs and trees and correlates with SEQUENCE LENGTH / machine load, matching
the flake already documented in tests/setup/test-db.ts and tests/e2e/global-setup.ts ("an accept/triage
write can stall past the click timeout and hang the disabled-while-pending button — the phase2-triage
flake"): a SQLite writer starved under load. WAL mitigated but did not eliminate it. Secondary note: the
dev machine's `.env.local` carries a real `XAI_API_KEY` (84 chars) so e2e triage-adjacent actions CAN make
live LLM calls — worth removing from the e2e server env regardless. Suggested for a future session:
(a) blank XAI_API_KEY/ANTHROPIC_API_KEY in playwright webServer.env; (b) add a busy_timeout / bounded
retry probe around the triage write path with instrumentation to catch the stall in the act; (c) consider
per-spec DB reseed. Not fixed in #163 — pre-existing infrastructure, out of scope.

## 2026-07-05 — #164 phase2-triage stall ROOT-CAUSED AND FIXED (the STATUS 2026-07-04 open finding)
The "server action that neither errors nor returns" stall was NOT the SQLite writer and NOT the live
LLM key. Boundary probes (client POST send/headers/body-fin events + server action entry/exit logs +
piped server stdout) showed every triage write committing in ~5ms and even net-FINISHING — while
`useTransition.pending` stayed true forever. Mechanism: under rapid sequential dispatch Next aborts a
superseded action's response stream (`net::ERR_ABORTED` on the action POST) and leaves the router's
flight-data application unresolved; React ENTANGLES transition lanes, so the wedged lane froze
`pending` for every later action too — all triage buttons disabled until reload. The old evidence
(roams specs/trees, correlates with load) had pattern-matched to the known SQLite flake; the probes
split the layers honestly.

**Shipped (DECISIONS #164):**
- triage-inbox busy state = explicit `useState`, NOT `useTransition` (immune to the wedged lane);
  every awaited action bounded by `withDeadline` (15s, `action-deadline.ts`); deadline recovery
  re-syncs via the new read-only `refreshTriageQueue` action (never rollback — the write usually
  COMMITTED; only the confirmation was lost).
- Hermetic e2e: XAI/ANTHROPIC keys blanked at playwright.config module scope (the dev `.env.local`
  carries real keys; e2e must never make live LLM calls).
- `llm-categorize.ts` fetches now carry the same 7s AbortController bound as assistant-llm.ts (an
  unbounded hung provider fetch stalls the calling server action — the same UX signature in
  production; locked fail-old-proven).
- The stall had MASKED two deterministic e2e ordering bugs behind its failure point ("did not run"
  for weeks): the write-in test net-files the demo's ONLY multi-row group (its mid-test reload
  discards the undo stack) starving the singles-mode test, and the read-only #162 banner lock ran
  AFTER the review-cost test drained the whole queue. Fixed by ordering, documented as the
  SERIAL-RESIDUE CONTRACT comment in the spec.

**Witness (real, 2026-07-05):** pre-fix 4/4 full-file runs failed (60s stall); post-fix phase2-triage
6/6 × 3 consecutive runs (~31s each); `bash scripts/verify.sh` → ✅ VERIFY GREEN; FULL e2e suite
**75/75 passed (55.0s)** — first fully green full-suite run since the flake was first documented
(STATUS #16/#17).

**Accepted / follow-ups:** other useTransition surfaces (transaction-list, backfill-button, settings
managers, etc.) are single-action per interaction — the wedge needs OVERLAPPING sequential dispatches —
so they keep useTransition (exposure noted, not changed). A Next patch upgrade (15.5.19 → latest) may
fix the underlying abort race upstream — worth taking with the next dependency pass. The e2e reseed-
per-spec idea (STATUS 2026-07-04 suggestion c) is superseded by the residue contract for now.

## 2026-07-05 — #165 transfer pair FILING: "a transfer is never in review" (owner pick: transfer-pairing for "credit card paid")
Premise re-checked before building (the #162 stale-premise lesson): pairing already existed
(detectTransfers, DECISIONS #22) — the real defect was add-flag-only persistence. A pair whose
descriptor the normalizer doesn't know (probe, real output: normalizeMerchant('CREDIT CARD PAID')
→ uncategorized/5000 → needsReview:true, while detectTransfers pairs both sides) got isTransfer:true
(excluded from every sum) yet stayed WEDGED in the triage queue under a wrong guess — the exact prod
symptom the #161 learned rule worked around. Demo-inert (every seeded pair descriptor is
normalizer-recognized), which is why it only ever bit in prod.

**Shipped (full detail: DECISIONS #165):** pure planTransferUpdates() flag-vs-file split (file only
needsReview && !reviewPinned && POSTED && supported-currency; heals legacy wedges; pair filings at
8500 FLAGGED band — visible AI provenance); ONE shared refreshTransferFlags(userId) helper replacing
the two drifting provider copies (FK-guarded by ensureCategories, #65); structural queue guards —
getTriageItems/getTriageGroups/getReviewCount/review-scoped batch all carry
OR:[{isTransfer:false},{reviewPinned:true}] (PIN WINS; register scope still re-files transfers, #36);
backfill excludes isTransfer in read AND re-asserted write; categorize-assist refuses 'transfer' in
BOTH directions (the #155/#163 stance, previously contradicted by an inflow allowance); undo of a
transfer-flagged row PINS it (undoCorrections + undoSplit).

**Hostile Critic cycle 1 (fresh-context, 8-axis):** 2 P1 (undo-vanish + batch-scope drift), 3 P2
(provisional/currency/confidence filing; assist-transfer; coverage), 1 P3 — all fixed with locks.
**Cycle 2 (fresh-context re-verify):** F1–F4 CONFIRMED FIXED; caught 1 NEW P1 — the filing write's
where was bare `id IN (...)`, no read-guard re-assertion (the backfill cycle-5 class): a user
decision landing in the read→write window was clobbered, or an undo-pin raced into the unclearable
pinned-but-filed wedge. Fixed (write re-asserts every guard; helper returns the guarded writes' REAL
counts) + deterministically locked by mocking ensureCategories to perform the mid-window action
(transfer-refresh-race.test.ts, fail-old by construction). REGRESSION_LEDGER ×2 (2026-07-05).

**Gate (real, 2026-07-05):** `bash scripts/verify.sh` → ✅ VERIFY GREEN; units **1798/1798, 133
files** (+20/+2 over #164); phase2-triage e2e 6/6 twice (30–31s); FULL e2e **75/75 (53.4s)** on a
fresh build. Full-suite runs under heavy machine load dropped 1–2 roaming specs
(transactions:145/:191, phase4:13) — PROVEN pre-existing by controlled A/B: the stashed pre-#165
tree fails the SAME :191 plus a DIFFERENT spec on a fresh build, both trees pass the specs solo.
Same load-correlated class STATUS 2026-07-04 documents; not a #165 regression.

**Accepted (documented in DECISIONS #165):** LLM-key users can still have assist file ONE side of an
unrecognized pair to a non-transfer category at ingest (assist runs pre-persist; sums stay correct
via the flag; register-correctable; a deterministic-first reorder needs the assist interface to
carry account/date — deferred). Provider re-send transient reset healed by end-of-sync re-filing
(untested lifecycle). Pair matching itself stays loose (any 2 accounts, ±3d) — tightening is a
separate increment.

## 2026-07-05 — #166 SEAMLESSNESS PASS (owner directive: "too many things don't work seamless")

Full detail in DECISIONS #166 + REGRESSION_LEDGER (3 entries). Headlines:
- **P0 FIXED:** real users' payroll ('paycheck' leaf since #163) was classified as a refund by
  `monthlyFlows` — prod income $0, savings rate/FI/coach garbage; goldens stayed green because the
  demo's payroll matches a merchant rule mapping to the old 'income' id. Group-aware
  `isIncomeCategoryId` now used by monthlyFlows + isBudgetable ('Paycheck' was the DEFAULT
  budget-target option). 'refund' leaf still nets (critic F1).
- **Next 15.5.19 → 16.2.10:** fixes the deterministic client flight-application bug that killed
  calendar month-paging (the misread "phase4:13 flake") and /transactions filters/pagination/Import
  (probes: 5/7 fail → 7/7 commit; 4/4 fail → 8/8 work).
- **Mutation reliability:** post-action page application was ~50% roulette in plain-paced probes on
  BOTH Next versions (the #164 class beyond triage; almost certainly the old #16/#17 "stall flakes"
  and a big share of the owner's prod complaint). Budgets/goals mutations now use direct invocation +
  own busy flag + withDeadline(8s, form-deadline.ts) + full reload on success — probes 5/5
  deterministic. MoneyDialsForm converted too (its useActionState "saved" confirmation failed the
  same way mid-gate): direct invocation, inline confirmation from OWN awaited state (no reload —
  nothing else on the page derives from dials), reload only on a severed confirmation. Typos get
  inline field errors with fields preserved ("$500"/"1,000" now parse; "abc" never crashes the page).
- **SW v3 (installability only):** the v1/v2 fetch listener amplified aborted action streams for
  near-zero value; offline shell retired; existing installs self-heal on update. pwa-offline.spec.ts
  now regression-tests a server action under a CONTROLLING SW.
- **Ask honesty:** unresolved "spent at X" abstains (deterministic + LLM fallback); "afford $X by
  <future date>" solves the savings goal (with current-month/rate/bill guards); subscriptions answer
  no longer attributes rent/loans to "subscriptions" (~7× overstatement fixed, dashboard card too).
- **Polish:** overspent safe-to-spend reframe; recurring next-dates un-truncated; year shown in
  register/triage dates; reports Uncategorized → Inbox link; aimplifi-* export filenames; nav
  prefetch=false (revalidate prefetch-storm removed).

**Gate (real, 2026-07-05):** `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint
clean, **1816 unit / 133 files** (+18 over #165), build clean, **FULL e2e 75/75 (59.7s)** with the
new e2e `workers: 4` cap (the shared-SQLite harness at default workers severed action-confirmation
streams under load — the same single-writer reason the unit suite serializes; prod is Postgres).
Deterministic probe witnesses in scripts/audit-probes/ (budget mutation 5/5 consecutive runs,
calendar 7/7 months, transactions first-action 8/8, invalid-input fields-preserved).

**OPEN / follow-ups (#166):** (a) apply the reliable-mutation pattern to remaining plain form
actions (accounts add/edit/delete, settings managers, register recategorize feedback) — the register
chip staleness agent-1 flagged is this same class; owner corroboration from prod welcome; (b)
merchant-spend Ask intent; (c) category month-over-month drill-down; (d) #71 nav redesign +
settings reorganization (owner-scoped); (e) Recharts pinned-on-load tooltip + width(-1) warning;
(f) triage accuracy-metric drops when filing ambiguous groups + doesn't restore on undo (agent-1
P2-1); (g) two adjacent "Connect a bank" buttons need clearer labels (owner uses BOTH providers).

## 2026-07-05 — #167 reliable-mutation pattern app-wide + e2e golden isolation

(#166 NEXT items 0+1.) The five surfaces still on useTransition+router.refresh()
(register recategorize, accounts manual mutations, backfill, settings custom-category
CRUD, settings visibility toggles) converted to the #166 recipe; the
manual-card-statement e2e moved onto a throwaway user (no demo-golden coupling).
Before-witness: recategorize probe lost 0/2 rounds on the old wiring at plain pacing
(the transactions.spec:145 flake reproduced 2× the same session); after: 2/2, all
probes green (recategorize/accounts/backfill/budget/first-action). New flash.ts
carries text confirmations (backfill count, "Statement saved") across the confirming
reload — set strictly after res.ok; unit-tested.

Hostile Critic (fresh-context): 1 P1 FIXED (post-reload pre-hydration clicks drop —
state-aware click-and-verify retries in the spec; re-witnessed 3/3 on the exact
failing mix), coverage P2 FIXED (flash unit tests + a throwaway-user backfill e2e).
**Accepted P2 (documented, inherent to the recipe since #166):** reload-on-success
aborts a sibling component's queued action (Next serializes action POSTs per tab;
pending flags are per-component) — visible and recoverable, one-round-trip window;
follow-up: page-scoped shared pending that disables sibling mutation surfaces while
a reload-bearing mutation is in flight.

Gate (real output 2026-07-05): VERIFY_E2E=1 bash scripts/verify.sh → ✅ VERIFY GREEN
(1816 unit / 133 files, FULL e2e 75/75 at 52.2s). Post-critic-fix changes were
test-only; the targeted 17-spec mix ran 3/3 green but a FULL 76-spec rerun was not
executed (session ended on owner request) — re-witness with `npx playwright test`.

Remaining same-class surfaces (old pattern, lower traffic): add-transaction form
(plain <form action>), import-csv form (useActionState, inline-result shaped),
delete-my-data form, auth forms (navigation class), connect-simplefin. Next
increments list otherwise unchanged from #166 (merchant-spend Ask intent, category
drill-down, #71 mobile-nav, Recharts polish).

## 2026-07-05 — #168 merchant-spend Ask intent

(#166/#167 top-queued NEXT item, resumed on "continue".) "How much did I spend at
Costco?" now answers a per-merchant total instead of abstaining. New `merchant_spend`
intent: pure `merchantSpend()` aggregator + `answerMerchantSpend()` formatter, server
`buildAnswer` case reusing a factored `toPurchaseRows()` shared with `largest_purchases`
(same POSTED-only, `isPurchaseRow`-filtered universe — can't drift). The merchant name
is derived from the DATA (canonical with the largest matched total), never the user's
typed string; every dollar traces to a real transaction.

**Precedence + preposition split (the design crux):** `resolveSpendTarget` runs first,
so category synonyms keep precedence ("on coffee"/"on groceries" stay `spend_by_category`;
Starbucks→coffee / Amazon→shopping undisturbed). Only an **at/with** object that didn't
resolve to a category routes to `merchant_spend`; a bare unresolved **"on X"** ("on golf",
"on average") keeps ABSTAINING to the honest unknown redirect — never the all-spending
total (the #166 P1 invariant, re-locked). The split made assistant-custom-category's
"spend on golf → unknown" test pass unchanged.

**Hostile Critic (fresh-context):** 1 P1 + 2 P2 + 2 P3. P1 FIXED — apostrophe/possessive
false-negative ("mcdonalds"/"trader joes"/"lowes" missed the apostrophe'd canonical →
confident-wrong "No spending"): symmetric punctuation folding (`merchantKey`), unit +
seed-grounded locks. P2 FIXED — payment-method phrasings ("with my card/venmo") fabricated
"No spending at Card": a tender stop-set abstains. P2 ACCEPTED (documented) — GROSS by
design (matches /trends `largest` + the /transactions activity list it links to; keeps the
headline reconcilable against the listed facts), where `spend_by_category` reads net. P3
left: "at A and B" reports only A (uncommon); "at home"-class short terms already caught by
the GROUPS-substring category precedence.

**Gate (real, 2026-07-05):** `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN —
tsc/eslint clean, **1843 unit / 135 files** (+27 over #167), build clean, **FULL e2e 76/76**
incl. a new read-only "at Costco" ask.spec assertion. (Diagnostic: the first ask.spec run
failed all 8 — a straggler `next start` on port 3100 served a stale build under
`reuseExistingServer`; killed → fresh spawn 8/8. Stale-3100 trap is in playwright.config.ts.)

**OPEN / follow-ups (unchanged from #166/#167 minus this item):** (a) remaining lower-traffic
reliable-mutation surfaces (add-transaction/import-csv/delete-my-data/auth/connect-simplefin);
(b) category month-over-month drill-down (Mint-parity); (c) #71 nav redesign + settings
reorganization (owner-scoped); (d) Recharts pinned-on-load tooltip + width(-1) warning; (e)
triage accuracy-metric drops when filing ambiguous groups + doesn't restore on undo (agent-1
P2-1); (f) two adjacent "Connect a bank" buttons need clearer labels (owner uses BOTH
providers); (g) #168 P3s: multi-merchant "at A and B", and page-scoped shared pending (the
#167 accepted-P2 follow-up).

## 2026-07-07 — #169 triage accuracy metric recovers on undo (was #168 open follow-up (e)) — DONE

The /triage categorization-accuracy card (DECISIONS #37) dropped when you filed an ambiguous
group but never recovered when you undid the filing. Filing stamps
`CategoryPrediction.actualCategoryId` = the chosen category (ground truth), so a mis-guess scores
as a miss and drops the displayed accuracy; `undoCorrections` restored the transaction to review
+ removed any minted rule but NEVER cleared `actualCategoryId`, so `getCategorizationAccuracy`
(counts predictions WHERE actualCategoryId is not null) kept counting a decision the user took
back. Reachable in the seed's own drain flow.

**Shipped:** one write inside the existing per-correction `$transaction` in `undoCorrections`
(`src/server/triage-actions.ts`) — null `categoryPrediction.actualCategoryId` for the restored
transaction, atomic with the inverse-correction insert + restore + transfer-pin + rule cleanup.
Invariant now symmetric with the four filing writes (applyCategory / applyToAllSimilar /
fileMerchantGroup / recategorize): a `needsReview` row carries no confirmed label. `undoSplit`
deliberately unchanged — `splitTransaction` sets categoryId=null and never labels a prediction.

**Fresh-context hostile Critic (adversarial, refute-by-default): 0 P0/P1/P2** — scoping
(transactionId @unique -> at most one row; userId session-trusted), over-revert (null is the ONLY
consistent label for a restored review row; restoring a prior label would be the bug), undoSplit,
undo-funnel completeness (recategorize/applyToAllSimilar have no undo path bypassing
undoCorrections), idempotency/atomicity, golden-safety, and metric-honesty all acquitted with
evidence.

**Gate (real output 2026-07-07):** `VERIFY_E2E=1 bash scripts/verify.sh` -> VERIFY GREEN —
tsc/eslint clean, **1845 unit / 136 files** (+2/+1 over #168: tests/unit/accuracy-undo.test.ts),
build clean, **FULL e2e 76/76 (47.7s)** incl. the existing "accuracy card shows a measured value
(DECISIONS #37)" spec. Fail-old/pass-new PROVEN by stash-run (2/2 fail without the fix, incl. the
un-nulled sample leaking into the sibling test's count; 2/2 pass restored). Committed. Ledgers:
DECISIONS #169, REGRESSION_LEDGER 2026-07-07, PROGRESS 2026-07-07.

**OPEN / follow-ups (unchanged from #168 minus this item (e)):** (a) remaining lower-traffic
reliable-mutation surfaces (add-transaction/import-csv/delete-my-data/connect-simplefin); (b)
category month-over-month drill-down (Mint-parity); (c) #71 nav redesign + settings
reorganization (owner-scoped); (d) Recharts pinned-on-load tooltip + width(-1) warning; (e) two
adjacent "Connect a bank" buttons need clearer labels (owner uses BOTH providers); (f) #168 P3s:
multi-merchant "at A and B", and page-scoped shared pending (the #167 accepted-P2 follow-up).

## 2026-07-07 — #170 reliable-mutation pass finished (last four surfaces)

(#166/#167 top-queued NEXT item (a), resumed on "continue".) The four remaining lower-traffic
mutation surfaces, each treated on its merits rather than force-fitting the recipe:

- **connect-simplefin** — the only TRUE stale-UI defect (useTransition + `router.refresh()`, the
  coin-flip #166/#167 retired, on a same-page mutation). Converted to the reload + `setFlash('accounts')`
  recipe; a failure shows a red inline error and does NOT reload. No `withDeadline` (a SimpleFIN action
  is a single-shot NETWORK call that can outlast the 8s form deadline; no severed-stream case). The
  connect/sync SUCCESS branch is dormant/UNVERIFIED (no creds) — inspection-verified only; the dormant
  form-opens e2e stays green.
- **add-transaction** — a plain `<form action>` whose action THREW on reachable bad input (non-numeric /
  zero / negative amount) to the app error boundary. Converted to the proven GoalForm onSubmit recipe
  (own busy + `withDeadline` + inline errors + `window.location.assign('/transactions')` on success; the
  action returns `AddTxnResult`, no longer redirects). **First tried useActionState and the new e2e caught
  React 19's form-reset silently reverting the account `<select>` to the first option (critic P1 — a
  wrong-account mis-file); onSubmit avoids the reset entirely (the #166 lesson, re-confirmed).**
- **delete-my-data** — added a `useFormStatus` "Deleting…" busy state (native form + signOut redirect
  unchanged) so the irreversible action gives feedback and blocks a double-submit.
- **import-csv — LEFT AS-IS (by design):** it already satisfies the invariant — a self-contained inline
  imported/skipped/per-row-error report with no same-page stale list. flash+reload would REGRESS that
  per-row report. Documented, not converted.

**Hostile Critic (2 fresh-context passes — find + confirm):** find pass scored the money math clean and
found **1 P1 + 2 P2, all FIXED**: (P1) the useActionState form-reset account revert → onSubmit recipe +
an e2e that selects a non-default account and asserts it survives the error; (P2) "Connected, but first
sync failed" flashed GREEN → success-framed copy; (P2) a bare `catch` mislabeled any DB error as
"category not found" → narrowed to the exact `'Choose a valid category'` throw. **Confirm pass: PASS,
0 P0/P1** (all three verified resolved with code evidence, no new P0/P1). Accepted P2s: the onSubmit
non-deadline catch now surfaces the error (tighter than GoalForm); one combined `role="alert"` rather
than per-field wiring (the errors aren't field-keyed); two harmless dead `redirect` mocks in test files.

**Gate (real output 2026-07-07):** `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint
clean, **1848 unit / 137 files** (+3 over #169: tests/unit/manual-txn-validation.test.ts), build clean,
**FULL e2e 77/77** (+1: the error-path-with-account-preservation spec). Fail-old PROVEN both ways: the
validation lock 3/3 fail when the try/catch is defeated (engine throw propagates); the P1 account-revert
was witnessed failing the full gate on the useActionState attempt (`expect(account).toHaveValue(chosen)`).

**OPEN / follow-ups (unchanged from #169 minus item (a)):** (a) category month-over-month drill-down
(Mint-parity); (b) #71 nav redesign + settings reorganization (owner-scoped); (c) Recharts pinned-on-load
tooltip + width(-1) warning; (d) two adjacent "Connect a bank" buttons need clearer labels (owner uses
BOTH providers); (e) #168 P3s: multi-merchant "at A and B", and page-scoped shared pending (the #167
accepted-P2 follow-up); (f) NEW: import-csv's own account `<select>` shares the latent useActionState
reset (milder — rows are filed server-side with the correct account BEFORE the reset, so no mis-file),
left as pre-existing; (g) NEW: connect-simplefin's network success branch remains UNVERIFIED (dormant).

## Post-Phase-5 refinement: connection-health / data-staleness (#171, Competitive-Gap plan Gap 1 §3–4)

First increment executing docs/COMPETITIVE_GAP_PLAN.md (written 2026-07-07). The #166–#170
seamlessness/reliable-mutation thread finished at #170; "continue" picks up the plan's top
NON-owner-gated slice of Gap 1 (live-data reliability): a pure staleness classifier + its
surfacing. Live Plaid/SimpleFIN sync + reconnect (Gap 1 §1–2) stay owner-gated (need tokens).

Pure engine `src/lib/engine/sync/health.ts` grades a linked feed fresh/stale/very_stale/unknown
by whole-day recency (FRESH_THROUGH_DAYS=3, STALE_THROUGH_DAYS=13, exported + boundary-pinned).
Copy states data is OLD but NEVER asserts a connection is "broken" — there is no persisted
sync-error signal to observe, so a "broken" claim would fabricate (no-fabrication rule at product
scope). Surfaces: /accounts SimpleFIN connected row → "Synced N days ago" / amber "…you may need
to reconnect" (from the existing SimpleFinConnection.lastSyncedAt; getAccountsView gains
simplefin.health, no new query); dashboard StaleDataBanner (from getDataFreshness in
server/connection-health.ts). No schema change; the network layer is untouched.

Golden-safe: linked = provider in {plaid,simplefin}; demo accounts are all provider 'demo' → no
linked feed → banner self-nulls and /accounts is unchanged (hostile critic proved the demo
byte-identical). getDataFreshness grades the MOST RECENT of {lastSyncedAt, newest linked
transaction}, so a healthy-but-quiet linked feed can't trip a false "sync may have stopped".

Gate (real output 2026-07-07): `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN —
tsc/eslint clean, **1869 unit / 138 files** (+21: tests/unit/sync-health.test.ts), build clean,
**FULL e2e 79/79** (+2: connection-health.spec.ts negative demo-lock + positive throwaway fixture
via scripts/e2e-add-stale-linked-account.ts, incl. axe AA on the banner).

Hostile Critic (fresh-context, refute-by-default): **0 P0/P1**. Honesty, golden-safety (proven),
classifier boundaries (recomputed), ownership, perf (2 indexed queries), e2e rigor, and isoDate
crash-safety all PASS. One P2 FIXED: the dashboard graded newest-transaction while /accounts graded
lastSyncedAt → a quiet-but-healthy feed could show a banner contradicting its own /accounts row;
now both reconcile through the most-recent-reference rule (unit-locked). Accepted (documented): a
single portfolio banner can't say WHICH of several linked feeds stalled (per-account last-activity
on /accounts is the next slice); live sync/reconnect stays owner-gated.

## Post-Phase-5: Cash Flow Radar (#172, Competitive-Gap plan Gap 2 §1 — AI plan §1.2, adjudicated build-now)

The strategic proactive-layer build, engine-first (LOOP #5), Fable lane per plan §3. New pure
engine `src/lib/engine/radar/`: `burn.ts` (day-to-day discretionary checking pace — WEEKLY
nearest-rank p50/p80 ÷ 7, clamped to real account history; selection excludes transfers, split
parents, pending, and committed merchants) and `radar.ts` (`projectCardDues` — cash-needed
obligations + synthesized future cycles from each card's raw due date at the FULL statement
basis, always `isEstimated`; `computeRadar` — one committed-only walk via `computeForecast`
merging /forecast's exact scheduled+loan events with the card dues, first-negative + lowest
point, colliding-card attribution + dip-day events, minimum timed cover-transfer, burn band).
Server `radarFromSnapshot` (pure, seed-groundable) + `getCashFlowRadar`; dashboard
`CashFlowRadarCard`; e2e `cash-flow-radar.spec.ts` (demo: alert on 2026-06-24 after the Jun-15
Platinum+Sapphire dues, cover $6,950.00 by Tue Jun 23 from High-Yield Savings, axe AA).

All three adjudicated conditions are engine-enforced and test-pinned: (1) status derives from
the committed line only — the burn band can raise at most `watch`, never `alert`; (2) transfer
sources are CHECKING/SAVINGS only, never the payment account or the demo's $142k brokerage;
(3) every synthesized future cycle is labeled estimated, including in the colliding-card
sentence. `pushWorthy` (committed dip ≤ 7 days) is the Gap 2 §2 notification hook, unused yet.

Hostile Critic cycle 1 (fresh-context, refute-by-default): FAIL — 2 P1 + 4 P2 + 5 P3, both P1s
proven by execution. P1-1 FIXED: future cycles repeated the post-mid-cycle-payment RESIDUAL
(seed Freedom: $600 instead of the $1,000 statement) — optimistic bias on the alarm line; now
`cycleBasisCents` (full statement balance) drives synthesis, a fully-paid card still projects
its future cycles, demo cover corrected $6,150 → $6,950 (exactly the predicted +$800). P1-2
FIXED: the daily-percentile burn collapsed to a false $0/day on sparse-but-real spend (~$966 in
the demo window) and the fallback copy asserted a falsehood — replaced with the weekly
estimator (demo now 1400¢/3051¢ per day) and a literally-true zero-spend sentence. P2s: cover
copy now says what the amount buys ("the whole 90 days"); estimated label added to the
colliding sentence; the #134 loan-ACH double-count (which the radar promotes from chart wobble
to alarm input) now detected and disclosed as a hedged "counted twice → conservative"
assumption (no heuristic dedupe — STATUS #134 stands); DECISIONS #172 written. Confirmation
Checker (independent seed probe): **PASS, 0 open P0/P1**, no new defects from the fixes.

Accepted / follow-ups (documented, non-gating): mortgage/unbranded-loan overlap disclosure gap
(normalize.ts has no mortgage category, so only auto-loan overlaps are detectable — same
accepted-residual class as #134); CD/money-market map to SAVINGS and are within condition 2's
letter as transfer sources (liquidity caveat); the dashboard now runs a 9th parallel snapshot +
a detectRecurring pass per load (pre-existing pattern, grounding-over-perf); cover amount is
sized to the whole-horizon worst dip (estimate-dominated when future cycles drive it) — the
copy states this basis. NEXT radar increments: wire `pushWorthy` into notifications (Gap 2 §2),
a sparkline of the three lines on /forecast, per-card "what if I pay early" interaction.

Gate (real output 2026-07-08): `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN —
tsc/eslint clean, **1908 unit / 141 files** (+39/+3 over #171: radar.test.ts,
radar-burn.test.ts, radar-grounding.test.ts), build clean, **FULL e2e 80/80** (54.4s, +1:
cash-flow-radar.spec.ts). EDGE_CASES §Cash Flow Radar added (hand-verified cases A–F).

## Post-Phase-5: Notification delivery (#173, Competitive-Gap plan Gap 2 §2 — the proactive stickiness layer)

The delivery half of the proactive layer, wiring #172's dormant `pushWorthy` hook to a real
channel. Engine-first (LOOP #5): a PURE `engine/notify/select.ts` (`selectNotifications`) unifies
imminent payment reminders + a pushWorthy radar dip into one material, deduped, most-urgent-first
list. Materiality = actionability + urgency (NO dollar floor): a payment surfaces only when
`userActionCents > 0` (autopay-fully-covered → suppressed; partial-autopay with a remainder →
surfaced at the user-action amount) AND due ≤ 3 days; a radar alert only when `radar.pushWorthy`
(committed dip ≤ 7d). No fabrication: every amount is copied verbatim from the source engine, so a
push can't disagree with the in-app card.

Delivery is Web Push behind the SAME dormant contract as email (#47): `lib/push.ts` no-ops
(`{sent:false,reason:'no-provider'}`, no crypto/network) unless all three `VAPID_*` vars are set,
never throws, and reports `{gone:true}` on 404/410 to prune a dead subscription. New
`/api/cron/notify` (CRON_SECRET-guarded) runs the engine per user and delivers via the standard
`web-push` lib. Golden-safe by construction: a `NotificationSent` dedup row is written ONLY after a
real delivery to ≥1 live device, so no-VAPID / zero-subs / all-gone writes NOTHING and a later
opt-in still fires. The seeded demo (provider 'demo', zero subs, no VAPID) is a pure no-op that
reports what it WOULD send — the settings opt-in card is hidden (gated on `getVapidPublicKey()`).
Two SQLite-portable models (`PushSubscription`, `NotificationSent`), both `onDelete: Cascade` so
deletion #31 still fully wipes. SW v4 gains `push` + `notificationclick` (still NO fetch handler).

Fresh-context Fable hostile critic (refute-by-default, money/data-integrity lane): **PASS — 0 P0 /
0 P1** (financial 10 / security 8 / correctness 8 / data-integrity 9); the dedup matrix (dormant /
0-subs / all-410 / partial-410 / DB-race), no-fabrication, dormancy byte-identity, materiality
(incl. partial-autopay), auth-scoping, and cascade all survived attack. 2 P2 + substantive P3s
FIXED same session, each test-locked: SSRF (`isAllowedPushEndpoint` — https-only, rejects all
IP literals + localhost, WHATWG-canonicalized; enforced at subscribe AND re-checked before send);
P2-1 radar dip-date wobble → `radarAlertOnCooldown` (4-day recency, engine-applied) so one episode
pushes ~once; P2-2 unbounded subs → cap 20, oldest-evicted; P3-2 dedup catch narrowed to P2002;
P3-3 NotificationSent pruned at 120d; P3-4 notificationclick pathname-match; P3-6 `'Notification'
in window` guard.

Gate (real output 2026-07-08): `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint
clean, **1938 unit / 145 files** (+30/+4 over #172: notify-select, push, push-subscriptions,
cron-notify), build clean, **FULL e2e 83/83** (+3: notifications.spec — cron 401, subscribe-
unauthed 401, demo-settings-shows-no-card). EDGE_CASES §Notifications added.

**Accepted / follow-ups (documented, non-gating):** email *activation* (set `RESEND_API_KEY`) and
wiring `/api/cron/notify` + `VAPID_*` into `vercel.json`/env are pure operator steps (DEPLOY.md),
consistent with the reminders/sync crons — the mechanism is dormant until then, so live push
delivery (real VAPID + a real push service) is proven at unit/integration level, not e2e (same
stance as the SimpleFIN/Plaid network-dormant precedent). The **weekly digest** (plan §3) is the
next Gap-2 increment. P3s left (critic backlog, non-gating): once-per-subject is per-USER not
per-device (a transient per-device failure with another device succeeding still records — a
deliberate anti-retry-storm choice, comment corrected); `disable()` doesn't check `res.ok` (self-
heals via the next 410-prune); a payment `dueDate` correction mid-cycle is a rare wobble the radar
cooldown doesn't cover (payment keys are otherwise stable).

## Post-Phase-5: Weekly digest email (#174, Competitive-Gap plan Gap 2 §3 — completes the proactive layer)

The last Gap-2 increment and the plan's "cheapest retention win": a weekly email that brings the
user back without a new surface. Mostly COMPOSITION over tested engines — pure
`engine/digest/build.ts` (`buildWeeklyDigest`) renders the Monthly Money Review (the SAME `review`
object /coach shows, via `getCoachData`) + the upcoming week's dues (`selectPaymentReminders` within
7 days) as plain text. No fabrication: the builder touches no number — it passes the already-formatted
MoneyReview strings through verbatim and renders each due via the SHARED `reminderLine` (extracted
from `buildReminderEmail` as a byte-identical pure move), so the digest reconciles with /coach and the
reminder surface by construction.

Delivery reuses the dormant email path (#47): new `/api/cron/digest` (CRON_SECRET-guarded), dormant
without RESEND_API_KEY. Once-per-ISO-week dedup reuses #173's `NotificationSent` keyed on the week's
Monday, recorded ONLY after a real send (dormant week records nothing → activation later still
delivers; race-safe via @@unique + P2002-scoped catch). New digest copy (5 COACH_COPY strings) + the
shared reminderLine variants are in coach-copy.test.ts ALL_STRINGS so the shame/ticker/projection
guardrails scan them.

Fresh-context Opus hostile critic (refute-by-default, routine-cycle lane — no new money math/schema/
security): **PASS — 0 P0 / 0 P1** (financial 9 / correctness 9 / data-integrity 10 / copy-safety 7);
proved the reminderLine extraction byte-identical, the Monday math correct for every weekday, no
key-namespace collision, and the prune-induced-resend attack FAILED. **1 P2 FIXED** — an inherited
/coach bug the digest would have EMAILED: a first-week user (checking account, zero transactions) →
`monthsOfRunway=Infinity` → the runway copy rendered the literal "Infinity months". Both
`COACH_COPY.runway` and `reviewImprovementRunway` (unguarded on /coach too) now branch on
`Number.isFinite`, fixed at the copy SOURCE so /coach and the digest are both correct; locked by a
no-"Infinity" empty-flows test.

Gate (real output 2026-07-08): `VERIFY_E2E=1 bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint
clean, **1969 unit / 147 files** (+31/+2 over #173: digest, cron-digest + coach-copy guardrail
additions + the reminders reminderLine refactor), build clean, **FULL e2e 84/84** (+1: digest cron
401 gate). EDGE_CASES §Weekly Digest added.

**Accepted / follow-ups (documented, non-gating):** concurrent-sweep double-send (same accepted #173
TOCTOU; Vercel cron doesn't overlap; one duplicate weekly email at worst); the getCoachData +
getCashNeeded double snapshot load per user (fine for a weekly cron; each surface is internally
consistent); `weekly_digest:` keys pruned only by the #173 notify cron's global 120-day prune
(negligible ~52 rows/user/yr, indexed, if notify isn't scheduled). Digest/email *activation* (set
`RESEND_API_KEY`, wire `/api/cron/digest` weekly in `vercel.json`) is a pure operator step (DEPLOY.md).
**This completes Gap 2** (radar #172 + notifications #173 + digest #174). Gap 3 (onboarding + mobile
polish) is next.

## Post-Phase-5: Gap 3 §1 — production-readiness backlog burn-down (#175)

Started Gap 3 (onboarding + mobile polish) with its first, smallest slice: the 2026-06-24 UX/
production-readiness audit's "DO NEXT" list (7 items — loading skeleton, empty states, heading
structure, per-page titles, delete confirmations, popover dismissal, an Investments nav entry). An
explorer survey against the current codebase found **5 of the 7 already done** by prior sessions
without ever being checked off the backlog: `(app)/loading.tsx` skeleton exists and covers every
route; every one of the 19 routes already sets `metadata.title` through the existing `%s · Aimplifi`
template, and `global-error.tsx` is already branded; `CardTitle` already renders a real `<h2>` (via
an `as` override for deeper nesting) and every spot-checked page already carries its own `<h1>`;
both the manual-account delete and the goal delete already use an inline two-step "Delete? Yes /
Cancel" confirm; the recategorize popover already dismisses on outside-click AND Escape. That left
3 genuine gaps, all additive UI-only fixes (no engine/schema touch, so no critic cycle — routine
lane):

1. **Heading structure, the real miss.** `EmptyDashboard` — the entire page for a brand-new,
   zero-account user, rendered as the early return on 13 different routes (dashboard, cards, ask,
   forecast, goals, coach, budgets, calendar, investments, recurring, reports, spending-plan,
   trends) — used `CardTitle`'s default `<h2>` as its ONLY heading. A first-run user's very first
   screen, on every one of those routes, had no `<h1>` at all. Fixed with one line
   (`<CardTitle as="h1">`) since the primitive already supported the override; fixes all 13 routes
   at once.
2. **Empty states.** `LifeEnergyCard` (coach) rendered a silently blank `<ul>` for a user with no
   large purchases in the last 90 days; the coach `opportunities-card` did the same for zero
   detected savings opportunities. Both now guard with the same empty-state pattern already used in
   `reports-view.tsx`. (The forecast `AreaChart` the survey flagged as "unguarded" turned out to be
   a non-issue on inspection — `f.days` is built by a `for (d=0; d<=horizonDays; d++)` loop, so it
   always has at least 1 entry; no true-empty case exists, so no guard was added — LOOP rule 2.)
3. **Investments nav entry.** `/investments` (#78) was fully built but reachable only via an inline
   "View investments →" link on /accounts or by clicking an INVESTMENT-type account row — not from
   either app nav. Added as an 8th `SECONDARY` nav entry (`LineChart` icon) between Accounts and
   Activity.

New/extended e2e locks (no new spec files needed — the natural fixtures already existed):
`auth.spec.ts`'s fresh-signup test gained an `<h1>` count/text assertion at the exact point
`empty-dashboard` first renders; its "sparse dashboard" test (one manual asset, zero
transactions — already the zero-opportunities/zero-life-energy fixture) gained assertions that both
new empty states render and the old list testids are absent; `investments.spec.ts` gained a
nav-click-through test.

**A pre-existing, unrelated e2e infra issue was found and root-caused, not fixed, while running the
gate.** `VERIFY_E2E=1 bash scripts/verify.sh` → tsc/eslint/vitest (**1969/1969 unchanged**, no
engine touched)/build all clean, but Playwright reported **75 passed, 5 failed**, all 5 on the
`[mobile-380]` project. `git stash`-ing this entire diff and rerunning the same spec files against
clean `main` HEAD reproduced the identical 5 failures (confirmed again with `--workers` reduced
4→2→1) — proving this predates and is unrelated to this session's changes. A throwaway diagnostic
spec (written, run, then deleted) found the root cause: on this machine, the `mobile-380` Playwright
project (configured `viewport: {width:380,height:800}`) actually renders the page at
`window.innerWidth/innerHeight` ≈ **425×895** — an ~11.8% mismatch. The app's CSS is not at fault
(the fixed bottom-nav bar's `boundingBox()` correctly sits flush with the REAL 895px-tall viewport
bottom); this is a Chromium/Playwright viewport-emulation-vs-OS-display-scaling artifact on this
Windows machine, and it makes clicks on the fixed bottom-nav bar (and other edge-of-viewport
elements) land on unrelated page content instead. Documented as
`docs/lessons/mobile-380-viewport-scaling-flake.md` (with the git-stash A/B control recipe for the
next session that hits it) rather than silently patched — mutating shared Playwright device config
inside an unrelated backlog session would be a silent side-fix, not a scoped one. Every one of THIS
session's own new/modified e2e assertions passed (none of the 3 files touched are in the 5 failing
tests); the `[desktop]` project (no fixed bottom nav) passed in full on every run.

**Honest gate:** `npx tsc --noEmit` clean; `npx eslint . --max-warnings=0` clean; `npx vitest run` →
**1969/1969** (147 files); `npx next build` clean; `VERIFY_E2E=1 bash scripts/verify.sh` →
75 passed / 5 failed (pre-existing, root-caused, unrelated — see above) — `scripts/verify.sh` cannot
currently exit 0 on this machine for any diff until the viewport-scaling issue is separately
investigated. NEXT Gap 3 increments: §2 mobile secondary-nav redesign (7→8 icons now, still
"scope with owner" per the plan), §3 guided first-run connect flow.

## Post-Phase-5: Guided first-run connect flow (#176, Competitive-Gap Gap 3 §3)

Bank → confirm payment account → see your Cash-Needed number, with zero navigation for Step 1
(SimpleFIN/Plaid connect widgets now render INLINE on `EmptyDashboard`, not linked out to
/accounts) and the Step-2/Step-3 badges tied to the existing `showOnboarding` gate. Pure UI
composition — reuses `ConnectSimplefin`, `ConnectAccountsButton`, `needsOnboarding()`, and
`MoneyDialsForm` verbatim; no schema/server-action/engine change.

Numbering follows the app's ACTUAL top-to-bottom reveal (connect → an instant best-guess
Cash-Needed number → confirm the account to lock it in), not the plan doc's literal prose order —
a hostile critic caught that numbering the confirm nudge "Step 2" below a "Step 3" cash-needed
badge above it read backwards on the one page showing both; fixed by renumbering (2↔3) to match
the deliberately payoff-first dashboard layout rather than moving the card. A `boundingBox().y`
DOM-order assertion in `tests/e2e/guided-onboarding.spec.ts` locks this.

Second critic P1: `ConnectAccountsButton` is no longer /accounts-only — it now renders on all 13
zero-account routes via `EmptyDashboard` — but `/plaid-oauth`'s post-OAuth resume was hardcoded
to `router.replace('/accounts')`. A user starting a big OAuth bank (Chase/BofA) from the
dashboard's Step 1 would land on /accounts instead of back on the guided flow. Fixed with a new
origin-path stash/read/clear trio in `lib/plaid-oauth.ts` (same lifecycle as the existing
link-token storage), 2 new unit tests.

Also closes the #175 loose end: `ConnectAccountsButton`'s label now reads "+ Connect a bank or
brokerage (Plaid)", matching SimpleFIN's existing "(SimpleFIN)" suffix.

Gate (real, 2026-07-08): `VERIFY_E2E=1 bash scripts/verify.sh` → tsc/eslint clean, **1971/1971**
unit (147 files, +2), build clean, **77 passed / 4 failed / 5 did not run** on `[mobile-380]`.
Confirmed pre-existing and unrelated via a `git stash` + fresh `next build` A/B control run
TWICE (once quick, once with the port-3100 server killed and rebuilt from scratch): identical
4-failed/5-did-not-run pattern on clean `main` HEAD, matching 4 of the 5 documented symptoms in
`docs/lessons/mobile-380-viewport-scaling-flake.md`; only this session's own new test flips
fail→pass between the two runs. `scripts/verify.sh` still can't exit 0 on this machine for any
diff (unchanged from #175) until that viewport issue is separately investigated as its own task.

**Ledger gap, not this session's:** PROGRESS.md was not updated across #173 (notifications),
#174 (weekly digest), or #175 (production-readiness backlog) — those sessions' work is fully
recorded in DECISIONS.md/STATUS.md/git history, just not in the resume log. Flagged rather than
silently backfilled (reconstructing after the fact risks inventing detail nobody actually
recorded live); the next session doing routine ledger cleanup should backfill three short
one-paragraph PROGRESS.md entries from the existing DECISIONS #173–175 rows.

**NEXT Gap 3 increments:** §2 mobile secondary-nav redesign (still "scope with owner" per the
plan — a genuine product/design decision, not a mechanical slice); §3's remaining piece (this
increment covers the connect/confirm/reveal wiring; a literal "3-step wizard page" with its own
progress UI was considered and rejected in favor of reusing the existing surfaces — see
DECISIONS #176 rationale). Gap 1 §1–2 live Plaid/SimpleFIN walkthroughs + sync cron (owner-gated,
needs tokens) remain the only fully-blocked items in the whole plan.

## Post-Phase-5: AI-trust accuracy panel in Settings (#177, Competitive-Gap plan Gap 4 §2)

Gap 4 ("make the trust moat visible") §2: surface the already-instrumented categorization
accuracy on a Settings panel — the plan's "data exists, UI is thin". Pure COMPOSITION, no new
engine, no schema, no money math (routine/Opus lane): the accuracy math
(engine/accuracy/score.ts), the ownership-scoped read (getCategorizationAccuracy), and a triage
AccuracyCard have existed since DECISIONS #37 — the only gap was that Settings never showed it.
Extracted a presentational `AccuracyMetrics` from accuracy-card.tsx (the triage AccuracyCard now
wraps it, byte-identical output + same testids) so the new Settings "AI trust" card reuses the
SAME guardrail-safe copy from one source instead of duplicating it. The panel adds one plain
sentence stating the no-fabrication promise ("never invents a figure — every number is computed
from your own transactions"). Golden-safe: read-only, no writes; the seeded demo's labeled
predictions (n>0) render a real percentage, identical to the triage card.

Gate (real output 2026-07-08): `npx tsc --noEmit` clean; `npx eslint . --max-warnings=0` clean;
`npx vitest run` → **1971/1971 (147 files, unchanged** — the refactor is presentational, no
engine touched); `npx next build` clean. New e2e in settings-dials.spec.ts (read-only: panel
visible, shows "Categorization accuracy" + a %, states "never invents", card-scoped axe WCAG-AA
clean) → PASS on [mobile-380], alongside the existing mutating dials test. The refactored
component is directly exercised and proven correct by that passing Settings render.

Known env flake (NOT this change): phase2-triage "accuracy card shows a measured value" fails at
its `signInToTriage` helper (line 42, a `bottom-nav-triage` click) — the documented mobile-380
viewport-scaling flake (docs/lessons/mobile-380-viewport-scaling-flake.md). It dies at navigation
before /triage renders, a code path this change does not touch; the accuracy component itself
renders fine (proven by the passing Settings e2e). Only the [mobile-380] Playwright project is
currently configured, so a [desktop] isolation run wasn't available; `verify.sh` still can't exit
0 on this machine for any diff until that issue is separately investigated (unchanged #175/#176).

NEXT: Gap 4 §1 (Glass-Box "tap any number → the rows it's made of, reconciled to the penny") is
the flagship trust-moat build — a **Fable-lane** feature (data-integrity critic), and the natural
/clear + model-switch point. Gap 3 §2 (mobile secondary-nav redesign) and Gap 1 §1–2 (live-sync
token walkthroughs) remain owner-gated. PROGRESS.md backfill for #173–176 still outstanding
(flagged in #176).

## Post-Phase-5: Glass-Box reconciled numbers (#178, Competitive-Gap Gap 4 §1)

The flagship trust-moat build, run in the Fable lane per the plan §3: tap the dashboard
Cash-Needed headline → a panel of the exact rows it's made of, reconciled to the penny; and
/spending-plan's "How we got there" breakdown re-sourced from a tested trace engine with an
explicit reconciliation line. The AI plan §2.1 adversarial verdict had flagged the sharp failure
mode (a trace module drifting from the engine and stamping "can't reconcile" on a CORRECT number)
— answered architecturally: `engine/glass-box/trace.ts` never recomputes anything from raw
inputs, it only reshapes the engine result it is handed (`traceCashNeeded` flattens `perDueDate`,
the same `due` set engine.ts:199 summed into the headline; `traceSafeToSpend` carries the
income−spent−bills−savings identity as SIGNED rows so plain summation IS the headline). The one
computed value — the row sum — makes `reconciles` a real check; a doctored result reports the
mismatch with the true sum (fail-loud), locked by G7/S4. Safe-to-spend's proof lives on
/spending-plan, not the dashboard card, because that card is deliberately a whole-card Link
(no nested interactive elements). Upcoming (estimated next-cycle) cards stay excluded and are
disclosed in the panel's basis notes.

Gate (real output 2026-07-08): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — tsc/eslint clean,
**1987 unit / 148 files** (+16/+1: glass-box trace suite, G1–G7 + S1–S4 hand-verified in
EDGE_CASES §Glass-Box), build clean. Targeted e2e (full-suite exit 0 still blocked by the
documented mobile-380 viewport flake, unchanged #175–#177): **14/14** across glass-box.spec.ts
(NEW — parses the RENDERED row amounts off the DOM, sums them, compares to the rendered headline:
271233+210000+60000=541233; scoped axe WCAG-AA on the expanded panel; disclosure toggle
round-trip) + phase1-cash-needed + spending-plan + phase5-a11y + not-found (every pre-existing
lock on the touched surfaces, incl. the pinned `$5,412.33` headline text on the moved testid).

Fresh-context hostile critic (Fable lane, refute-by-default, ran the suites itself): **PASS —
0 P0/P1, 7 P2** (financial 9 / data-integrity 9 / copy 8 / UX-a11y 8 / tests 8). It independently
re-derived every pinned value, verified every `due` obligation lands in exactly one `perDueDate`
point, and FAILED to construct any honest engine input where rows ≠ headline (attacked past-due
clamp, weekend walk-back, FIXED_AMOUNT>remaining, $0 cards, MINIMUM+autopay max(), pending, −0).
P2s fixed before sign-off: tautological invariant test → S4 doctored-plan fail-loud test;
/spending-plan renders `trace.basis` (and the old spec's case-insensitive substring locators,
newly ambiguous, tightened to `exact: true`); rendered sign now derives from the value ($0 keeps
role sign) so displayed lines can never contradict the sum; aria-label on the disclosure button;
host-coupled mismatch copy dropped; `autopayCents` rendered as "(autopay)"; position-hardened row
ids. Accepted P2s: duplicate-cardId notes join (unreachable — DB primary keys) and no
component-render test for the mismatch branches (no component harness exists; the trace-level
doctored tests lock the contract).

**Ledger note:** DECISIONS had no #177 row (that session committed without writing it) — backfilled
minimally this session, pointing at STATUS #177 as the authoritative record. PROGRESS.md backfill
for #173–175 remains outstanding (flagged in #176).

NEXT: Gap 5 (investments provenance tag, benchmark-vs-index line) and Gap 6 §1 (CI verify.sh in
GitHub Actions) are the largest unblocked increments — both Opus/routine lane. Owner-gated
(unchanged): the push (#171–#178 ride together), Gap 1 §1–2 live-sync walkthroughs, Gap 3 §2
mobile secondary-nav redesign, the mobile-380 Playwright viewport fix.

## Post-Phase-5: Per-account data freshness on /accounts (#179, Competitive-Gap Gap 1 §3 follow-up)

The "per-account last-activity on /accounts" slice #171 deferred as "the next slice". #171 shipped
connection-health at the whole-connection level (one dashboard banner + one SimpleFIN connected-row
status); #179 brings it to EACH linked row, so a user with several linked banks can see WHICH feed
went quiet, not just that "something" is stale.

Reuses the tested engine verbatim (no new classification). New pure
`perAccountFreshness(accounts, today)` in `src/lib/engine/sync/health.ts` → id→`FreshnessResult|null`:
`null` for accounts with no sync concept (non-linked provider {manual,demo}, or type INVESTMENT —
holdings-valued, not a transaction feed); else
`classifyFreshness(mostRecentDate(newestTxnDate, connectionLastSyncedAt), today)`. The `mostRecentDate`
floor is #171's quiet-account guard applied per-row: a SimpleFIN account's per-user connection
`lastSyncedAt` floors its reference date, so a quiet-but-live feed reads fresh instead of a false
"reconnect" nudge. `getAccountsView` adds ONE `prisma.transaction.groupBy({by:['accountId'],_max:{date}})`
to the existing `Promise.all` (no extra round-trip), sets `connectionLastSyncedAt` only for simplefin
rows, and assigns each `AccountView.freshness` (new optional field). `LinkedRow` renders a
`data-testid="account-freshness"` sub-line via the existing `freshnessMessage` (amber on very_stale,
matching the shipped ConnectSimplefin stale hint on the same page).

GOLDEN-SAFE BY CONSTRUCTION: demo accounts are provider 'demo' → isLinkedFeed false → no line → the
demo /accounts page is byte-identical (locked by an `account-freshness` count-0 assertion in the demo
e2e). Proportionate adversarial self-review (display-only, single-path, reuses tested classification):
consistency with the banner + connection status verified on the month-old e2e fixture; no double-count
(`_max`, not a sum); non-USD withheld accounts excluded; deterministic (isoDate + integer day math).
One gap found + FIXED: the amber very_stale line was only reachable in the linked-stale state, which
phase5-a11y (demo-only) never covers → added a full-page axe WCAG-AA scan of /accounts in the stale
e2e.

KNOWN LIMITATION (documented, latent-only): a quiet **Plaid** account has no per-connection sync
timestamp available (PlaidItem carries only a cursor), so it grades by transaction recency alone and a
genuinely quiet Plaid feed could read stale. No live impact — Plaid is dormant/UNVERIFIED (item #12).

Gate (real output 2026-07-08): `bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint clean,
**1994 unit / 148 files** (+7: `perAccountFreshness` cases in tests/unit/sync-health.test.ts), build
clean. Targeted `connection-health.spec.ts` 2/2 (demo count-0 golden lock + stale positive per-row
reconnect line + /accounts axe AA). 30 other /accounts-touching e2e pass; the lone `auth.spec.ts`
sign-out failure was PROVEN pre-existing (mobile-380 viewport flake, docs/lessons/
mobile-380-viewport-scaling-flake.md) via a git-stash A/B control (identical 1-fail/2-pass on the clean
tree). Full VERIFY_E2E exit-0 remains blocked by that documented flake, unchanged since #175.

NEXT: Gap 5 (investments provenance tag, benchmark-vs-index line) and Gap 6 §1 (CI verify.sh in
GitHub Actions) are the largest unblocked increments — both Opus/routine lane. Owner-gated (unchanged):
the push (#171–#179 ride together), Gap 1 §1–2 live-sync walkthroughs, Gap 3 §2 mobile secondary-nav
redesign, the mobile-380 Playwright viewport fix.

## 2026-07-08 — #180 Holding provenance badge on /investments (Competitive-Gap Gap 5 §1) + benchmark line blocked

Resumed on "continue" in the Fable lane per the #179 handoff. Shipped Gap 5's first
item — a per-holding provenance badge on /investments — and recorded Gap 5's second
item (benchmark-vs-index line) as blocked rather than faking it.

- **Provenance badge (SHIPPED):** the `Holding.source` column already existed
  (`String @default("manual")`; `reconcileSimplefinHoldings` sets `'simplefin'`).
  Engine-first, display-only: optional `source?` passthrough on `Holding`/`PositionValuation`
  (alongside the existing display-only `name?`, zero weight in any math), a pure
  `holdingProvenance(source)` in `portfolio.ts` (manual/absent → no badge; any real feed
  → "Synced"), `getInvestments` selects + threads `source`, and `investments-view.tsx`
  renders a `<Badge data-testid="holding-provenance">Synced</Badge>` only for feed rows.
  GOLDEN-SAFE by construction: the demo's 5 holdings are all `manual` → no badge → demo
  /investments byte-identical (locked by a `holding-provenance` count-0 e2e assertion).
- **Benchmark-vs-index line (BLOCKED — owner-gated, not faked):** an honest portfolio-vs-index
  comparison needs (a) a per-holding valuation history / acquisition dates — the app stores
  only a current snapshot + cost basis, so the portfolio's own period return is uncomputable
  (the `timeWeightedReturn`/`xirr` engines have no dated series) — and (b) an index
  market-data source (none configured; the bash network allowlist has no market-data host).
  Shipping it now would mean inventing both the period and the index return, a no-fabrication
  violation. Needs a market-data feed + a schema addition (purchase dates or periodic holding
  snapshots) before it can be built honestly. See DECISIONS #180.

Proportionate adversarial self-review (display-only single-path passthrough, reuses tested
classification — #33/#57/#179 precedent, not a multi-agent workflow): golden-safety structural
+ e2e-locked; money values proven inert by the passthrough unit test; existing valuation tests
assert per-field so `source:undefined` on manual rows breaks nothing; axe WCAG-AA green on the
(badge-free) demo panel.

Gate (real output 2026-07-08): `bash scripts/verify.sh` → ✅ VERIFY GREEN — tsc/eslint clean,
build clean; targeted `tests/unit/investments.test.ts` + `investments-server.test.ts` 47/47
(+6: `holdingProvenance` cases + a source-passthrough + a getInvestments source-flow test);
`VERIFY_E2E=1 investments.spec.ts` 7/7 (incl. the count-0 golden lock + the WCAG-AA axe scan).
Full `VERIFY_E2E=1` still can't exit 0 on this machine (documented mobile-380 viewport flake,
docs/lessons/mobile-380-viewport-scaling-flake.md) — the investments spec is run directly.
Committing as #180; NOT pushed (push owner-gated; #171–#180 ride together).

## 2026-07-08 — #181 CI: verify.sh in GitHub Actions (Competitive-Gap Gap 6 §1)

Resumed on "continue" per the #180 handoff, which named Gap 6 §1 (CI) as one of the two
largest UNBLOCKED increments. Added `.github/workflows/verify.yml` — config only, ZERO
app-code/schema/engine change (so no critic cycle; the YAML is outside the tsc/eslint/vitest
globs). Runs on every push + PR.

**What it does:** `ubuntu-latest`, Node 20 (matches `@types/node ^20`; no `engines` field in
the repo) → `npm ci` (postinstall runs `prisma generate`) → `npx prisma db push --accept-data-loss`
(materializes `file:./dev.db` so `next build` has a valid DB) → `npx playwright install --with-deps
chromium` (the sole `mobile-380` Playwright project is a Pixel 5 = chromium) → `VERIFY_E2E=1 bash
scripts/verify.sh` → upload `playwright-report/` + `test-results/` on failure. `concurrency` cancels
a superseded run per ref; 30-min timeout.

**Env:** the local `.env` is gitignored (`.env*`), so the workflow supplies the same dev-only,
non-secret values (`DATA_PROVIDER=demo`, `DATABASE_URL=file:./dev.db`, a throwaway CI `AUTH_SECRET`,
`DEMO_TODAY=2026-06-10`). Those feed `next build` ONLY — the unit + e2e suites relocate their own
SQLite DBs under `os.tmpdir()` via `tests/setup/test-db.ts` (cross-platform; `/tmp` on the runner),
and the seed's destructive-wipe guard is Postgres-only, so a `file:` CI DB seeds freely. GitHub
Actions sets `CI=true`, so `playwright.config`'s `reuseExistingServer` is false → it spawns a fresh
`next start` against the seeded e2e DB.

**WHY CI MATTERS HERE SPECIFICALLY:** a full `VERIFY_E2E=1` run cannot exit 0 on the maintainer's
Windows machine because of the documented mobile-380 Playwright viewport-scaling artifact
(`docs/lessons/mobile-380-viewport-scaling-flake.md`) — a Chromium-vs-OS-display-scaling mismatch
that is Windows-display-specific. A headless Linux runner has no OS display scaling, so **CI is
expected to produce the first GREEN full e2e run this machine structurally can't**, and becomes the
authoritative full-suite gate. A mobile-380 failure on CI would be a real regression, not the flake.

**VERIFIED locally** (proportionate to a config-only add): YAML parses (pyyaml `safe_load` OK); the
one novel step `npx prisma db push --accept-data-loss` runs and honors the `DATABASE_URL` env
override (real output: `Datasource "db": SQLite database "dev.db" … The database is already in sync`);
Prisma 7 dropped `--skip-generate` (my first draft used it; `unknown or unexpected option` → switched
to `--accept-data-loss`, the flag e2e global-setup already uses); all referenced paths exist
(`package-lock.json` for `npm ci`, `scripts/set-sqlite-wal.ts`, `prisma/seed.ts`); DB harness is
`os.tmpdir()`-based.

**UNVERIFIED (honest):** the workflow has never executed on GitHub Actions from here — the actual
run only happens on push, which is owner-gated (#171–#181 ride together). Like the Plaid/SimpleFIN
network paths, every command it wraps is locally proven but the orchestration itself is untested until
it runs on Actions. No app source changed this session, so tsc/eslint/vitest/build are unchanged from
#180's green (1994 unit / 148 files).

**NEXT (unblocked):** Gap 6 §2 (prod error tracking — Sentry/Vercel monitoring) and Gap 6 §3–4
(deferred auth/compliance items, Neon backups) are the remaining Gap 6 slices; the outstanding
PROGRESS.md backfill for #173–176 (flagged in #176) is still open. Owner-gated (unchanged): the push,
Gap 1 §1–2 live-sync token walkthroughs, Gap 3 §2 mobile secondary-nav redesign, the mobile-380
viewport fix. **Once the owner pushes, the FIRST thing to confirm is the Actions run: if it's green,
flip #181 from UNVERIFIED to verified and note the first-ever clean full-suite e2e; if mobile-380
fails, that's real.**

## Post-Phase-5 refinement: multi-device session invalidation + PII-free deletion record (DECISIONS #182, Competitive-Gap Gap 6 §3)

Closed the two items PRIVACY.md §Deletion had listed as deferred "real-auth release"
limitations. Resumed on "continue" (Fable lane); a full-codebase reconciliation first
found COMPETITIVE_GAP_PLAN stale (Cash Flow Radar, web push, and the weekly digest were
already BUILT — the plan's §2 now carries a dated reconciliation banner so no future
session rebuilds them), leaving Gap 6 §3 as the highest-value UNBLOCKED, rule-3 slice.

- **Mechanism:** `User.sessionEpoch` (Int @default(0), golden-safe) stamped into the JWT
  at sign-in and re-checked on every Node-side session resolution. Pure core
  `isSessionCurrent` + `hashUserRef` in `engine/auth/session.ts` (unit-pinned, fail-closed);
  Node enforcement in `server/session-guard.ts` called from a Node `session`-callback
  override (auth.ts) that strips `user` on a stale/absent epoch → `requireUserId` throws on
  every device. Edge middleware stays Prisma-free (coarse gate; all data access re-resolves
  through the enforced Node callback, so a stale token that passes middleware leaks nothing).
- **Triggers:** `revokeOtherSessions()` (Settings → "Sign out of all devices", bumps the
  epoch, signs out this device too — honest "everywhere"); account deletion (user gone →
  existence check fails everywhere, no extra code).
- **Deletion record:** `DeletionRecord` (no User relation → survives the cascade), only
  `hashUserRef(id)` + timestamp, written ATOMICALLY with `user.delete` (array-form
  `$transaction`) so it exists IFF the deletion committed. Keyed by a SECRET salt
  (AUTH_SECRET) so low-entropy ids (a Google id embeds an email) aren't enumerable.

**Hostile Critic (fresh-context Fable, refute-by-default): cycle 1 FAIL — 1 P0, 2 P1, all
FIXED + re-verified.**
- **P0-1 (serious):** demo + Google tokens were minted at a hardcoded epoch 0, so one
  "sign out of all devices" would BRICK those accounts (fresh sign-in re-minted 0 ≠ bumped
  DB epoch → infinite redirect; violates CLAUDE.md rule 4). FIXED: removed the
  edge/authorize stamp; a Node `jwt` override now stamps `token.epoch` from the DB
  (`currentSessionEpoch`) at sign-in for EVERY provider, so re-sign-in reads the current
  epoch. Regression-locked (round-trip test: revoke → old token dead → fresh stamp == bumped
  epoch → valid).
- **P1-1:** deletion record + delete were non-atomic → wrapped in `$transaction`.
- **P1-2 (coverage):** the stamp↔check seam was untested → added the round-trip regression
  (mechanically catches P0-1).
- **P2s FIXED:** hash keyed by AUTH_SECRET (was public-salt-enumerable); overclaimed
  "non-enumerable" comments softened to honest "pseudonymous unless secret salt". **Accepted
  P2s (documented):** one indexed-PK findUnique per Node `auth()` (negligible beside the
  per-render snapshot load; React `cache()` dedupe is a possible future trim); `db push`
  convention means a Postgres deploy must push before the new code runs, else the password
  authorize / session guard 500 on a column-short DB.

Gate (real output 2026-07-08): `bash scripts/verify.sh` → **✅ VERIFY GREEN** — tsc/eslint
clean, **2010 unit / 150 files** (+2 files: `session-lifecycle` 8 pure + `session-invalidation`
real-DB revoke/delete/round-trip), build clean. Touched e2e `account-deletion.spec.ts` 2/2 (a
render-only Sessions-control assertion — never clicks revoke, which would bump the shared demo
epoch and sign every parallel spec out; the real bump + rejection is proven by the integration
test). Full `VERIFY_E2E=1` still cannot exit 0 on this Windows machine (documented mobile-380
viewport flake, docs/lessons/mobile-380-viewport-scaling-flake.md — unrelated). Committing as
#182; NOT pushed (push owner-gated, #171–#182 ride together).
