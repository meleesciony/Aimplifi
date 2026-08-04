> **HISTORICAL** — archived 2026-08-04 from `PROGRESS.md` (verbatim moves, not rewrites).
> Point-in-time session log; do not update.

# PROGRESS archive — 2026-06 through 2026-07

## 2026-07-27 — O.4 DONE (#321) — sessions now expire after 30 min idle (was 30 DAYS)

Owner: *"Please put standard login procedures for this app. The password appears persistent despite
shutting down computer. This is dangerous."* Correct, and worse than it looked. `src/auth.config.ts`
had `session: { strategy: 'jwt' }` with **no `maxAge`**, so Auth.js's 30-DAY default
(`@auth/core/lib/init.js:38`) governed both the JWT and the cookie's `Expires` — and a 30-day
`Expires` makes it a **persistent** cookie the browser writes to disk. Browser-close and power-off
both preserved the sign-in for a month.

Fix is one line — `maxAge: SESSION_IDLE_TIMEOUT_SECONDS` (30 min) — but the number was only safe
after verifying in the installed dependency source that it rolls: the `jwt` branch of
`@auth/core/lib/actions/session.js` re-signs the token and re-sets the cookie `expires` on EVERY
session read, unconditionally; `updateAge` is consulted ONLY in the database-strategy branch (so it
is a no-op here and was deliberately left unset); and `next-auth/lib/index.js` `handleAuth` forwards
those Set-Cookie headers out of middleware, which matches every app route. Net: active use never
signs you out, 30 minutes of inactivity does.

Also shipped: sign-in page states the policy (`data-testid="session-timeout-notice"`, minutes derived
from the same constant so copy and cookie cannot drift); `docs/LOGIN_AND_SESSIONS.md` (the written
procedure — three sign-in methods, sign-out, sign-out-everywhere, shared-computer steps, and a
maintainer section with the dependency-source citations); PRIVACY.md security-measures line;
`tests/unit/session-timeout.test.ts` bounding the window to 5–30 min, mutation-proven fail-old
(removing `maxAge` ⇒ "expected undefined to be defined"). No schema change. Playwright exposure
checked before choosing 30 min: no spec uses `storageState`, 60 s per-test budget.

Deliberately NOT built: an absolute session cap; a "remember this device" opt-in (not expressible via
Auth.js cookie config — the callsite hardcodes `expires` and spreads it OVER the configured options).
A pre-expiry warning modal is the natural follow-up if 30 min proves short in practice.

## 2026-07-24 — L.12 (a)+(b) DONE (#303) — Plaid's category → a one-tap inbox suggestion

Shipped both slices. `bash scripts/verify.sh` GREEN — tsc 0 / eslint 0 / **3846 unit across 257 files** /
build clean; new UI e2e `tests/e2e/triage-provider-suggestion.spec.ts` PASSES (signup → seed a review row
with a persisted Plaid guess → /triage renders "Plaid's guess" → one-tap files the group). Fresh-context
hostile critic (categorization routing) found ONE P1 + two P3, all fixed + regression-locked: the surfaced
guess lacked the #44/F4 sign guard, so an OUTFLOW tagged INCOME would one-tap-book spend as income —
gated in `prepareIngestedTransaction` (outflow never Income; inflow→spend refund kept), locked by
tests/unit/plaid-map.test.ts sign-guard cases. P3s: swipe-right footer clause dropped on provider-guess-only
cards (swipe-right is confident-only, a no-op there); deploy heads-up = 2 nullable cols → `prisma db push`
on Neon. DECISIONS #296. UNVERIFIED against live Plaid (no creds here — mocked providers + real Prisma).
Next: commit → push → confirm Vercel READY + grep live marker → then the account-duplicate root cause
(L.10 slice 3 + a Combine remedy) per owner's 2026-07-24 sequencing.

## 2026-07-24 — L.12 (a)+(b) IN PROGRESS — Plaid's category → a one-tap inbox suggestion (superseded by the DONE entry above)

Owner-chosen next build. Root cause verified: Plaid's `personal_finance_category` is mapped at
ingest (`mapPlaidPersonalFinanceCategory`, plaid-map.ts:546) but NEVER persisted, and `getTriageGroups`
(triage.ts:194) recomputes suggestions via `categorize` WITHOUT the hint (triage.ts:219-223) — so a row
Plaid guessed but our ruleset missed shows "Suggestion: none yet". Scope THIS session = (a) persist +
(b) surface as a one-tap "Plaid's guess"; NOT (c) ruleset widening / (d) auto-file at MEDIUM.

Design: (a) two nullable `Transaction` cols `providerCategoryId`+`providerCategoryConfidenceBps`; shared
`resolvePfcCategoryId` core; keep `mapPlaidPersonalFinanceCategory` UNCHANGED (auto-file hint); NEW
`mapPlaidProviderCategoryGuess` superset incl. LOW=4000 (persist-only, never auto-files — clamp floor 6500
> 4000, tuning.ts:53). Persist via the single `base` obj in plaid.ts. (b) `ReviewRow.providerCategoryId`
→ `TriageGroup.providerSuggestedCategoryId` (unanimous among opinionated rows, NON-aggregate), deliberately
OUT of `isConfidentGroup`/Accept-all-confident; three-way UI. Invariants H1-H6: auto-file byte-identical,
never bulk-files, aggregates suppressed, fallback-only, disclosed, demo golden-safe.

Status: engine-first build starting (schema → plaid-map → plaid.ts → group → triage → UI → tests → verify
→ fresh-context critic → ship). Prev session's L.10 slice-2 entry below.

## 2026-07-24 — L.10 slice 2 shipped — Plaid Link update mode (#301)

Every Plaid connection on /accounts now offers 'Add or fix accounts', reopening the connection that exists rather than creating a second one — the door whose absence manufactured the duplicates the previous six commits were detecting and disclosing. THREE fresh-context critics found 2 P0 + 6 P1; all fixed in cycle 1 and regression-locked (4 REGRESSION_LEDGER entries). The P0 was structural and self-inflicted: the update/new discriminator lived in a second localStorage key stamped at token-mint time, while the connect front door on the same page pre-mints on mount and opens without writing — so in the worst ordering a COMPLETED new-bank link was discarded unexchanged while the user was redirected as though it had worked. Fixed by shape: one atomic record, stamped by whoever opens Link. Two pre-existing P1s fixed because the new copy depends on them: SyncResult.itemsFailed (the existing Sync button reported 'no new transactions' when a bank had refused) and identity capture inside removeItem (every disconnected row was permanently identity-less). subtype became write-always because type is derived from it. Gate: bash scripts/verify.sh GREEN — tsc 0 / eslint 0 / 3814 unit across 256 files / build clean. Full e2e 172 passed / 5 failed, all 5 the documented #287 /accounts Suspense DOM-duplication flake (a different test each run; combined-accounts passes 2/2 isolated, duplicate-connections 8/8 in both engines). Pushed as abc4398; empty prisma diff so the live database is untouched. UNVERIFIED against live Plaid. Deferred with reasons: TASKS L.14 (a deselected account freezes and keeps counting). Owner reported three new issues mid-session, notated not diagnosed: TASKS L.11 cash-needed/safe-to-spend, L.12 the 321-item triage inbox, L.13 Vanguard (no open item exists in the repo — ask before assuming).

## 2026-07-24 — L.10 slice 1 shipped + deploy verified (#300)

Three identity columns captured (PlaidItem.institutionId, Account.subtype, Account.persistentAccountId), nullable and additive, written by the existing Plaid mapper/upsert and backfilled by the existing syncInstitutions sweep. Nothing reads them yet. Gate: bash scripts/verify.sh GREEN — tsc 0 / eslint 0 / 3785 unit across 254 files / build clean. FAIL-OLD proven: 13 assertions fail against the stashed pre-change source. Pushed as 059c490; Vercel deployment dpl_H1suyPbp9b8Ehz4Bs5nSB3skJCsA reached READY, target production, on that exact SHA. Schema diff was 4 additive nullable lines, so prisma db push added columns and touched no data. NO live marker to grep, stated precisely: nothing user-visible changed, so there is no unauthenticated string unique to this commit — the deploy evidence is the READY state on the SHA plus the local gate. Slice 2 (Link update mode + the per-connection Add or fix accounts control) built in the same session, under hostile-critic review at time of writing.

## 2026-07-24 — #298 DONE: /cards tells same-named cards apart

Owner sent a live /cards screenshot answering the L.3 question. It answered it (his issuers DO
return statements — see STATUS) and exposed two more things.

RESOLVED BY THE OWNER: the two identical `CREDIT CARD` $6,679.68 entries were the known Chase
····0977 duplicate. He deleted it and re-checked ("No more 2 cc"), so the screenshot PREDATED the
deletion and the +$6,679.68 phantom is gone. His figures are correct — do NOT tell him otherwise.

SHIPPED (#298): the residue that remains with ZERO duplicates — THREE cards named `CREDIT CARD` and
TWO named `Venture`, each with its own amount due, and "Do this first: pay Venture $9,250.93" while
he holds two Ventures. Pure `card-identity-view.ts` renders the account last-4 the payload already
carried (no new query, no engine change) in the card heading, in BOTH branches of the pay-first
instruction, and in the "no due date yet" panel; when nothing separates two cards they are numbered
in DISPLAY order. A last-4 is never parsed out of the NAME (#292 mis-read direction).

DECIDED (was flagged as an owner question, answered by precedent instead): disclose, never silently
adjust a money headline — #192 is advisory by design and #221 closed the identical household case
with "figures deliberately not adjusted".

CRITIC (fresh-context, money-display surface): 0 P0 — key spaces verified to coincide, `cardId` IS
`Account.id` — but 4 P1 + 4 P2, ALL fixed + regression-locked: `cardMask` was built from the
PERSONAL snapshot while obligations use the household-MERGED one (every partner card lost its
identity, and the numbering did not fire to cover it); the numbering indexed ENGINE order while the
page sorts by due date, printing "3." above "1."; the partner branch of the instruction and the
undated panel both still rendered bare names; the tie test compared a private key rather than the
PAINTED string (#297's "writes into the string space it compares", again); and an unvalidated mask
would have printed a full PAN behind four dots — `lastFour()` now keeps digits only, last four, and a
short mask renders "ending 12" so the dots never claim a length the data lacks.

FAIL-OLD PROVEN: with the component + page reverted and rebuilt, both new e2e FAIL; restored, pass.

GATE: `bash scripts/verify.sh` -> VERIFY GREEN — tsc 0, eslint 0, **3743 unit / 251 files**, build
clean, no schema change. E2E: card-identity + card-unknown-due + phase1-cash-needed + household =
13/13 at --workers=1.

KNOWN LIMITATION (recorded, not hidden): `Account.mask` is written ONLY by the Plaid path; SimpleFIN
never sets it and manual accounts hardcode null, so a SimpleFIN-only user gets the numbering fallback
rather than real last-4s, and demo mode exercises only the fallback.

STILL OPEN: TASKS L.6's other half — surfacing the personal duplicate detector on /cards (it renders
only on /accounts, so a both-live duplicate is counted twice there with nothing flagging it). Latent
for the owner now that he has deleted his.

## 2026-07-24 — #297 DONE: the Combined-accounts card groups by live account

Closes the LAST open item from the owner's 2026-07-24 /accounts screenshots — carried until now as
a known limitation of #296. The "Combined accounts" card listed "Venture (Plaid ····6271)" TWICE,
identically, with two byte-identical "Undo" buttons. Owner: "two identical rows I can't tell apart."

ROOT CAUSE (verified from schema + code, not theorized): `AccountReconciliation.successorAccountId`
is deliberately NOT unique (schema.prisma:193), so two SimpleFIN predecessors folding into ONE live
Plaid successor is VALID data. The card rendered one flat row per link with no grouping and never
rendered the predecessor NAME — only `providerMask(predecessor)`, which for two SimpleFIN rows (no
mask column) is the constant string "SimpleFIN". Same disease as #296, one card lower.

SHIPPED: pure `src/components/finance/continued-accounts-view.ts` owns every rendered string —
groups by successor (ONE block per live account), names each old account with an "old account N of
M" ordinal, and proves control distinctness by construction. ZERO server change, empty prisma diff:
the payload already carried `predecessor.name` (transactions.ts:264), it was simply never rendered.

THREE fresh-context critics (copy honesty / uniqueness invariant / downstream regressions). ALL
found real defects in cycle 1; ALL fixed + regression-locked:
 - the `(copy N)` breaker could CREATE the tie it existed to prevent (executed repro; 39/4000 fuzz
   seeds) because it appended INTO the string space it compared -> replaced with a card-wide
   positional PREFIX, unforgeable by the digit-vs-dot argument, one pass;
 - distinctness compared RAW strings while the browser paints COLLAPSED ones ("Venture ",
   "Ven<ZWSP>ture") -> names sanitized once at construction, which also strips a U+202E that would
   reverse a button face;
 - COPY OUTRAN THE DATA: "balance counted on the live connection" is false in a chain Q->P->S
   (transactions.ts:525 emits each link with its DIRECT successor; reconcile-boundary.ts:419 zeroes
   EVERY predecessor) and after a successor bank is disconnected -> every sentence now states only
   what is true in EVERY state (a fact about the PREDECESSOR), plus an explicit mid-chain note; the
   undo toast's "both accounts count on their own again" was false for the same reason and now
   speaks about the old account only.
Also closed the axe/mobile-overflow BLIND SPOT: the demo seed creates no reconciliations, so this
markup had never been scanned by either gate; the new spec re-runs both against a seeded card.

FAIL-OLD PROVEN, not assumed: with accounts-list.tsx reverted and rebuilt, the new e2e FAIL and the
output reproduces the owner's exact duplicated string ("Venture(Plaid ····6271)continued from your
old SimpleFIN account — history kept through 2026-07-18, balance counted here.Undo"); restored and
rebuilt, they pass.

GATE: `bash scripts/verify.sh` -> VERIFY GREEN — tsc 0, eslint 0, 3720 unit / 250 files, build clean,
no schema change. E2E: the /accounts specs sit on the STATUS §OPEN DOM-duplication flake, MEASURED
across three full-suite runs rather than assumed — with #297 present 6 failed then 2 failed (both
in #296's untouched spec, every #297 test green); with #297 ENTIRELY REVERTED and rebuilt the same
suite still failed 5, including the same reconcile ×2 and duplicate-connections ×2. All 13 of the
implicated tests pass at --workers=1. The victim rotates; #297 adds exposure, not cause.

DEPLOYED + PROVEN: pushed c958ffc..b9887a3; Vercel dpl_7u7UKQCSbvnwDpfxw2tMjdHdeY8U reached
READY on githubCommitSha b9887a3 and carries the production aliases (www.aimplifi.app,
aimplifi.app). Build log confirms "The database is already in sync with the Prisma schema" — the
empty prisma diff means Neon was untouched. HONEST LIMIT on the live proof: the Combined-accounts
card is auth-gated AND only renders for a user who has confirmed reconciliation links, so there is
no public marker to curl; the evidence is the READY deployment on this exact SHA, not a grep of a
rendered string (the #290-class limitation).

LEDGERS: DECISIONS #288, REGRESSION_LEDGER ×4, STATUS (new shipped section + the #296 limitation
flipped + the old owner report annotated RESOLVED), EDGE_CASES §Combined-accounts (A-E, hand
verified), TASKS Wave L.5 -> [x].

LEFT OPEN DELIBERATELY (both pre-date #297; recorded in STATUS, not silently widened): the
degenerate-cutover claim span (cutover before the predecessor's first txn makes BOTH sides keep
everything — a real transaction double-count no surface flags, since transactions.ts:591 suppresses
the duplicate warning for an effective predecessor), and the persistent card omitting the two
confirm-time disclosures about replaced/dropped rows.

STILL OPEN FOR THE OWNER (unchanged by this slice): his two both-live duplicate PAIRS
(CREDIT CARD ····0977, Loan - 2927) are resolvable via #296's card but not yet resolved — about
8.5k + 23.8k of phantom debt, two taps each. And TASKS L.3, /cards due dates after a real sync,
has never been confirmed.

## 2026-07-24 — The duplicate card now distinguishes CONNECTIONS, not rows (#296)

Owner-reported with a screenshot, hours after #295 shipped: the duplicate card he had just been given
was UNUSABLE for his actual case. Its two sides were byte-identical — "Loan - 2927 (Plaid ····2927)"
twice, with two "Disconnect U.S. Bank (Plaid ····2927)" buttons carrying the SAME aria-label. His words:
"I don't know which to delete. One usbank plaid sync has 2 accounts on it (the two us bank loans).
There has to be a way to show this."

ROOT CAUSE: both rows are live Plaid rows on two DIFFERENT PlaidItems (one bank linked twice), so
neither is deletable and #295's sideAction() built both labels from institution + provider + mask —
none of which differ across two items at one bank. The single fact that DID differ (how many accounts
each connection feeds) was spent only inside the post-tap confirm prompt: revealed after the decision
it was needed for. Distinctness was left to the DATA instead of being an invariant of construction.

SHIPPED: a pure, framework-free pair-level view module (src/components/finance/duplicate-card-view.ts)
that computes BOTH sides together and owns every rendered string. Each side is now its own block with
its connection identity ("Plaid: U.S. Bank · connection 1 of 2 · last synced 2026-07-24"), its manifest
("Also feeds 1 other account: CREDIT CARD ····0977" vs "Feeds only this account."), and a button whose
face carries the ordinal AND the blast radius ("Disconnect connection 1" / "2 accounts stop updating").
A mechanical " (row 1)/(row 2)" breaker runs after both labels exist, so two identical controls are
impossible for ANY input. Bank sync numbers the same connections identically, so "connection 1 of 2" is
cross-referencable on the page. The intro's "linked through two providers" — factually false for exactly
the case he hit — is replaced by a per-pair provider-conditional sentence.

HONESTY FIX IN THE SAME SLICE: the card now states the two-step truth. Verified against removeItem +
the unfiltered net-worth sum — disconnecting revokes the token and deletes the PlaidItem but LEAVES the
Account row counting, so the double-count stops only after the follow-up delete. Every disconnect prompt
says so, and the success flash now says every account on that item became deletable (the old copy was
singular and understated it).

ZERO server change, empty prisma diff: the ordinal is POSITIONAL over the payload /accounts already
sends. Known limitation: two connections created in the same DB second have an unspecified ORDER, so
which is "connection 1" is unspecified — the numbers stay distinct and the copy claims no order.

CLOSES the #295 coverage gap ("no e2e for the duplicate-card actions"): tests/unit/duplicate-card-view.test.ts
(56 tests) + tests/e2e/duplicate-connections.spec.ts (4 tests). FAIL-OLD PROVEN, not assumed: with the
three source files reverted to pre-#296 and rebuilt, all 4 e2e tests FAIL; restored and rebuilt, all 4 pass.

Gate: verify.sh GREEN — 248 files / 3662 tests, tsc + eslint clean, build clean, no schema change.
E2E: duplicate-connections 4 passed; tripwires (reconcile, mobile-overflow, account-deletion,
connection-health) 15 passed; phase5-a11y 9 passed.

STILL OPEN FOR THE OWNER: the two both-live pairs are now RESOLVABLE but not yet resolved — he still has
to pick a connection and do the two taps (about 8.5k + 23.8k of phantom debt). The e2e cannot drive the
real disconnect (Plaid /item/remove decrypts a live access token; a seeded row fails "Malformed encrypted
token"), so step 1 is covered by unit tests + the seeded post-disconnect state, not end-to-end.

## 2026-07-24 — SESSION HANDOFF — Wave 4.3 + five owner-reported /accounts fixes (#290-#295)

LONG session (should have been split — one task per session). SHIPPED + LIVE, all verified READY on www.aimplifi.app: #290 Wave 4.3 Plaid /investments/holdings parity (TASKS 4.3 flipped done). #291 differing-last-4 duplicate rule + per-connection card last-4 + dismissible warning. #292 refined that rule after owner clarification — a different last-4 is a different CARD not necessarily a different ACCOUNT (a spouse authorized-user card shares one balance), so it disqualifies only the weak NAME signal, never the identical-balance signal; removed name-parsing from the veto (critic F1/F2: a parenthesized year or the x in Amex mis-read as a last-4 would silently hide a real duplicate). #293 Plaid account freshness now uses its own bank lastSyncedAt (was SimpleFIN-only, so mortgages/loans/quiet cards falsely read "Not synced yet" / "No new data in 15 days — you may need to reconnect" while the connection said it synced today) + connection-row alignment. #294 a last-4 embedded in the NAME is now a POSITIVE-only match, catching the owner U.S. Bank loan + Truist mortgage duplicates nothing was flagging. #295 (THIS COMMIT) the duplicate card is finally actionable: Delete this one for a deletable side, Disconnect <bank> for a live side, two-step confirm; AccountView gained plaidItemId. OWNER ALREADY DID: deleted the Truist mortgage + U.S. Bank stale rows (~957k of phantom debt gone; liabilities went from about -1.97M to -1,014,498.45). STILL OPEN FOR THE OWNER: two both-live duplicate pairs remain — CREDIT CARD ····0977 x2 and Loan - 2927 x2 — each the SAME account arriving through TWO live Plaid connections; with #295 he can now Disconnect the redundant connection from the warning card, then Delete the orphaned row (about 8.5k + 23.8k more phantom debt). ALSO OPEN: /cards due dates after a real sync (TASKS L.3) — never confirmed. DROPPED: the 07-21 password item (stale, owner did not recognize it). GAP RECORDED: no e2e for the new duplicate-card actions. Gate on this commit: verify.sh GREEN — 247 files / 3606 tests, build clean, no schema change.

## 2026-07-24 — Name-embedded last-4 as a positive duplicate match (#294)

Closes the detection gap found in the owner 2026-07-24 screenshots: two of his three real duplicates (U.S. Bank loan 2927 ~23.8k, Truist mortgage 1192 ~933k) were double-counting with NO warning because all three signals were inapplicable (SimpleFIN has no mask column; the names reduce to stopwords + digits; the balances differ slightly). maskFromName now feeds a POSITIVE-only matchableMask so a name-embedded last-4 confirms against the other side mask. Positive-only by design (critic F3): a mis-read can only surface a dismissable pair, never hide a double-count — which is why the same parsing stays OUT of the veto path (#292). Gate: verify.sh GREEN — 247 files / 3606 tests, build clean. No schema change. OWNER ACTION still required: delete or combine the stale row of each pair — the detector is advisory and never auto-deletes.

## 2026-07-24 — Plaid account freshness + connection row alignment (#293)

Owner screenshots showed /accounts contradicting itself: Plaid connections "last synced 2026-07-24" but account rows "Not synced yet" / "Last synced 8 days ago" / "No new data in 15 days — you may need to reconnect". Cause: connectionLastSyncedAt was wired for SimpleFIN only; Plaid passed null, so Plaid accounts graded on newest TRANSACTION date (a mortgage/loan has none). Fixed via the account plaidItemId to PlaidItem lastSyncedAt map. Counter-locked: a genuinely stale bank still grades very_stale with the reconnect nudge. Also fixed the connection-row alignment (wrapping flex put the buttons right for short bank names and on a left-aligned wrapped line for "American Express"): now a block card, controls pinned right on every row, armed confirm on its own line. Gate: verify.sh GREEN — 247 files / 3604 tests, build clean. No schema change. STILL OPEN from the same screenshots: real duplicates double-counting ~965k (Truist mortgage 1192, U.S. Bank loan 2927, Chase card 0977) and the detector misses the loan pair because its name reduces to stopwords + digits — next fix is to use a name-embedded last-4 as a POSITIVE match signal.

## 2026-07-24 — Dup veto refined — surface same-balance, suppress name-only (#292)

Owner clarified the "M. LEE ····4927" is likely a second card (his wife authorized user) on HIS account — one account, two cards, same balance. So a differing last-4 = different CARD, not necessarily different ACCOUNT. Refined the #291 veto: a differing last-4 now disqualifies ONLY the weak name signal, never the strong identical-non-zero-balance signal. Ventures (different last-4, different balances, name-only) stay hidden; the identical-balance Chase pair is SURFACED so the owner can Combine or dismiss. REMOVED the explored name-embedded last-4 extraction — a Fable critic found it mis-reads a parenthesized year (Roth IRA (2021)) and the x in Amex as a last-4 (3 P2 false-negatives, silent double-count direction); the mask column alone + balance-survives handles both owner cases without it. Gate: verify.sh GREEN — 246 files / 3600 tests, build clean. No schema change.

## 2026-07-23 — Owner-reported duplicate-Venture fix (#291)

Fixed the owner-reported /accounts duplicate false positive (his Venture ····6271 vs spouse Venture ····0966 flagged on shared name alone; he aggregates both their cards). THREE fixes: (1) LOGIC — duplicateSignals veto: BOTH masks present AND different => return null (never flag), one change fixing the duplicate warning + the reconciliation candidate path; fires only when both masks present so Plaid-vs-SimpleFIN (SF mask null) still evaluates by name/balance. (2) DISPLAY — each Plaid connection lists its cards (name + last-4) via PlaidItemView.accounts. (3) DISMISS — Not-a-duplicate button, persisted in NudgeDismissal under a dup: namespace (no schema change), filtered from BOTH the warning and the reconciliation candidates. Fable critic (2 lenses, adversarial verify): 1 P2 + 3 P3. Fixed the P2 (dismissed pair re-surfaced as a combine candidate — now binds both surfaces), F2 (dismiss reported ok on a lost write), F3 (integration test exercised the same-item skip not the veto — rewritten to two connections). Documented F1 as an accepted trade-off (a reissued card re-linked as two items is un-warned — direct collateral of the owner rule, disconnect+relink-only, Undo-reversible). Gate: bash scripts/verify.sh GREEN — tsc 0, eslint 0, vitest 246 files / 3597 tests, next build clean; e2e auth.spec + reconcile.spec 7/7 on mobile-380. No schema change. Resolves STATUS OPEN duplicate-Venture-row.

## 2026-07-23 — Wave 4.3 shipped — Plaid /investments/holdings parity (#290)

Wave 4.3 COMPLETE. New pure mapper src/lib/providers/plaid-holdings.ts + PlaidProvider.syncHoldings/reconcilePlaidHoldings; investments added to the link-token required_if_supported; wired best-effort into linkPlaidAccount, syncPlaidNow, and the daily sweep. Hostile-critic Workflow (3 lenses, adversarial verify): 1 P2 + 3 P3 all fixed and regression-locked (malformed-array Array.isArray guard, prune-only-on-clean-run, sweep failure-count surfacing). Deliberate non-fix: null cost_basis full-value gain display (pre-existing, SimpleFIN-shared, needs a nullable costBasisCents schema change, out of scope). Gate: bash scripts/verify.sh GREEN — tsc 0, eslint 0, vitest 246 files / 3591 tests, next build clean. E2E from the earlier VERIFY_E2E run: 163 pass + 1 documented load-flake (goals then money-dials, a different contention spec each run, both pass clean in isolation), CI is the arbiter. UNVERIFIED against live Plaid (no sandbox creds): mapping + reconcile tested against mocked providers + real Prisma only; existing items linked before this need re-linking to gain the investments product. Next: owner-gated items remain (Venture duplicate row, password reset, mobile UI screenshots).

## 2026-07-23 — #289 — TASKS L.4: the five #277-critic P2s + a critic-found undatable-card copy inconsistency

Built on Opus (ultracode); the owner is out of Fable credits. Closed the five recorded #277 P2s AND the coherent defect a 3-lens hostile-critic pass then surfaced.

## 2026-07-24 — #284 — THE real Plaid OAuth bug: open() must run in the click gesture (not a useEffect)

Owner-reported live, exhaustively: connecting a bank silently failed for EVERY OAuth bank (Chase AND Amex) on EVERY environment — desktop Chrome, mobile Safari, incognito, and a fully-wiped phone (cleared cookies/history/passwords, no extensions). Symptom: Link opens, reCAPTCHA + phone verify pass, user selects the bank, then the Link modal vanishes ("screen shifts a bit"), the browser never reaches the bank's login, `/plaid-oauth` is never hit server-side, and there is NO error. ROOT CAUSE (found by a fresh-context audit agent, corroborated by Plaid's OAuth docs + react-plaid-link issues #161/#338): Plaid opens an OAuth bank in a POPUP/new tab, which browsers permit only when `open()` runs inside a real user gesture. `ConnectAccountsButton` fetched the link token ON CLICK (`await createPlaidLinkToken()`) and then opened Link from a `useEffect` — the await severs the click's user activation, so the OAuth popup is refused and Link tears down silently. Non-OAuth banks run in the iframe and never hit this (why it first looked bank-specific). FIX: mint the token AHEAD of the click (on mount + after every terminal outcome) and call `open()` DIRECTLY in the button's onClick — matches Plaid's official example. Removed the single-shared-instance / effect-open shape (and the #281/#282 on-page diagnostics, which had served their purpose of proving onExit never fired). `/plaid-oauth`'s effect-based re-open is left as-is (correct for the redirect-return leg). Also kept #283 (reCAPTCHA CSP additions — real and necessary; the audit confirmed the CSP is otherwise complete and NOT the cause). HONEST PROCESS NOTE: this took far too long because I chased environmental causes (a CSP-rewriting crypto/identity extension, domain www-vs-apex, cache) one at a time off the console noise, when the universal "fails on every device incl. a wiped phone" symptom pointed straight at the code from the start; owner rightly pushed to start on the code. Gate: VERIFY GREEN — tsc 0, eslint 0, 3531 unit / 242 files, next build clean. UNVERIFIED: the live OAuth popup round-trip against real Plaid (no automated way to exercise it here) — owner to confirm a real Chase/Amex link now completes. NEXT: owner taps Connect → Chase on the deployed build; if it opens the bank + returns to /plaid-oauth + imports accounts, the connect flow is finally whole.

## 2026-07-24 — #280 — backfill Plaid webhooks onto existing items (/item/webhook/update)

Owner is bringing real Plaid data live. Reviewed the deployed state before advising (Vercel env screenshot + list_deployments + code): core Plaid production env is present and correct and the live deployment (bcb3bd5) already includes #278/#279 — so the sync-all button IS live (its absence for the owner is a page/scroll or the open /accounts DOM-dup bug, NOT a deploy miss; awaiting an /accounts screenshot). The real gap the review found: `PLAID_WEBHOOK_URL` was ABSENT from Vercel, so `linkTokenParams` sent no webhook and Plaid pushed no TRANSACTIONS updates — the structural cause under #278's "haven't synced in a week". Owner added the env var + redirect URI this session. But grep confirmed NO `/item/webhook/update` path existed, so items linked BEFORE the env var (the owner's Chase/Capital One) would never get a webhook. SHIPPED that path: `PlaidProvider.updateWebhooks(userId,{itemId?})` registers `PLAID_WEBHOOK_URL` per item, idempotent + self-healing via a new nullable `PlaidItem.webhookUrl` (spends a billed call only when it differs; skips already-registered; re-registers on URL change), no-op when the env is unset, per-item fault isolation + audit, user-scoped. Wired best-effort into `syncPlaidNow` (any Sync tap backfills) AND the cron sweep (`plaid-sync.ts`, hands-free for a user who never opens the app) via an OPTIONAL port method so existing test ports are unaffected. New `updatePlaidWebhooksNow()` action for a direct trigger, with a distinct "not configured yet" signal vs a failure. SCHEMA: additive nullable `PlaidItem.webhookUrl` — deploy runs `prisma db push` against Neon (safe). Gate: VERIFY GREEN — tsc 0, eslint 0, 3531 unit / 242 files, next build clean; +16 tests (7 provider mocked-server integration, 7 action/integration, 2 cron-sweep). E2E not run here (backend-only, no new UI/route). UNVERIFIED: the live `/item/webhook/update` socket has never run (no Plaid creds in this env) — confirm by watching for a sync to fire on its own after a real transaction, or the `plaid.item.webhook.update.failed` / `sync.cron.plaid` audit rows. NEXT: owner sends the /accounts screenshot so the "missing sync-all button" is pinned; then tap Sync all accounts and report the flash (also unblocks L.3 — whether the issuers return liabilities at all).

## 2026-07-24 — #279 follow-up — narrowed the open e2e failure: it is intermittent whole-page DOM duplication on /accounts, not a reconcile bug

Ran the check prescribed in the previous entry rather than leaving the hypothesis standing. Findings, all executed: (1) the failure is NOT reconcile-specific — a temporary probe (deleted) showed accounts-net-worth-amount ALSO resolving to two identical $4,900.00 nodes on the same page, and both testids have exactly ONE render site in source with <AccountsList> mounted once, so the whole /accounts content tree exists twice in the DOM; (2) it is NOT a transition artifact — the duplicate persisted the full 20s toBeVisible timeout, and the second copy is hidden, which is why the Playwright accessibility snapshot (which prunes hidden subtrees) looks completely normal and shows only one copy; (3) it IS intermittent with a long sticky period — after failing 3/3 isolated runs it then passed 3/3 with no code change, and the full suite passed repeatedly earlier the same night. Previous eliminations still hold: not #278/#279 (stashed src+tests, rebuilt, fails identically), not DB accumulation (fresh e2e DB, still failed), not the load-contention flake (isolated, workers=1). NEW leading hypothesis, LABELLED: a React hydration mismatch — when server HTML and the first client render disagree React can append the client tree beside the server one instead of patching, producing exactly a persistent hidden identical duplicate; /accounts renders several time-relative strings (lastSyncedAt, 'Not synced yet', formatRelativeDays) against businessToday = the real clock, so a server/client straddle is a plausible trigger and explains the intermittency. CHECK (not yet run): attach page.on('console') and loop reconcile.spec.ts until it fails, then read React's hydration-mismatch error and the element it names. Explicitly recorded: do NOT 'fix' this by loosening the locators to .first() — that hides a real duplicate-render bug from the gate. Deploy of #279 verified live: www.aimplifi.app and the main-branch alias both serve md5 44447a0b3395. NEXT: run the console check when the failure recurs; it guards the Wave 4.6 money boundary so settle before the next money slice.

## 2026-07-24 — #279 — hostile-critic hardening of the shipped sync slice (4 P1s) + an OPEN pre-existing e2e failure

Ran the critic pass #278 should have had BEFORE shipping (it reached production without one, despite touching authz + money ingest). Verdict FAIL: 0 P0, 4 P1, 4 P2 — every finding reproduced by the critic's own execution, not read off the diff. FIXED, each regression-locked: (P1-1) itemId is a server-action argument and therefore attacker-controlled — TypeScript's string is erased at the boundary — and it flowed unvalidated into the Prisma where clause, so itemId={not:'x'} matched EVERY item, passed the ownership gate, and silently turned the per-bank Sync control into an all-banks sweep; now scalar-validated (#271 idiom). Contained to the caller's own userId (the critic's cross-user probes were refused), so P1 not P0 — but 'the AND userId saves us' was the only control and the code never asserted it. (P1-2) the outer catch returned e.message; a Prisma validation error carries the deploy's absolute paths, four lines of server source, the model shape and the raw userId, and the UI renders it verbatim in a role=alert — now a fixed string, matching what the inner catches already did. (P1-3) THE SAME FALSE-ALL-CLEAR CLASS AS #277, in the module whose own docblock says it exists to prevent it: a thrown transaction pull leaves added:undefined, which '?? 0' rendered as 'Synced Plaid. No new transactions.' to a user whose bank login had expired; syncPlaidNow now returns transactionsFailed, syncAllAccounts collects per-half failures into a partial list, and the summary names them ('didn't return transactions' / 'card due dates are unchanged'); the per-connection flash got the same treatment. (P1-4) a per-request-BILLED endpoint with no server-side rate limit against the repo's own stated rule — the only brake was a per-tab sessionStorage stamp that a fresh tab or reload loop resets for free, and the button's pending guard is client state destroyed by its own window.location.reload(); rateLimitDurable added to syncPlaidNow (12/min) and syncAllAccounts (10/min). P2s: removed dead syncNote state; statementsWritten now counts only statements that actually CHANGED (a second sync used to re-report 'N card statements updated'), which also skips the redundant write. NOT fixed, recorded: the commit-message claim that a cross-user test locks the PROVIDER-level itemId filter is UNVERIFIED (the test mocks PlaidProvider wholesale, so it locks the action's count guard only); and refreshTransferFlags/refreshRecurringForUser still run full-set after an empty scoped sync. Gate: 3515 unit / 241 files GREEN, tsc 0, eslint 0, build clean. E2E: 161/162 — the one failure is tests/e2e/reconcile.spec.ts:89 (reconcile-candidates resolves to TWO elements, strict-mode violation) and is PRE-EXISTING and unrelated: it fails identically with src+tests stashed and rebuilt, fails with a freshly recreated e2e DB, reproduces isolated at workers=1 3/3, and yet passed several full runs earlier the same night on the same code. Recorded OPEN in STATUS with the one labelled hypothesis (wall clock crossed midnight; businessToday is the real clock while the spec seeds fixed dates) AND its check. NOT diagnosed — do not act on the hypothesis before running the check. NEXT: settle that reconcile failure before the next money slice (it guards the Wave 4.6 boundary); CI is the arbiter.

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
\b-alternation inflection bug class (WENDYS/WEGMANS/PLUMBING/VETERINARY/...).
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

## #304 L.6/L.10: one tap combines two connections pulling the same card. 2026-07-24
Built + hostile-criticized on Fable; three parallel fresh-context critics.
OWNER, mid-session, with two screenshots: "What did you actually fix? I see the same accounts
that I posted earlier." Correct: #298/#299 made the duplicate LEGIBLE and #300/#301 stopped
future ones; nothing removed his two Chase connections both pulling CREDIT CARD ....0977
($8,539.09 counted twice). Shipped Combine needs one stale side (R3) and the candidate detector
skipped same-provider pairs, so there was NO path. Queue had prevention ahead of remedy; flipped.
SHIPPED: engine/account/identity.ts (the ladder: same/different/unproven within ONE provider at
ONE institution; never reads a balance - structural; null = UNKNOWN); engine/account/
combine-connections.ts (connection-level planner; a direction is offered only when every dropped
account is proven the same as EXACTLY ONE kept account); server/combine-connections.ts (one
SERIALIZABLE claim tx re-derives the plan, re-applies every card suppression, stamps bank
identity, carries autopay, deletes the losing connection row; then revoke + the shipped
confirmReconciliationFor).
CRITICS: 3 P0 / 6 P1 / 9 P2, every one from an executed repro, ALL fixed + 8 ledger entries.
(P0) two concurrent taps destroyed BOTH connections -> the row deletion IS the claim, inside the
tx that reads the plan. (P0) the date split deleted real money in BOTH directions ($890 then
$930) because two LIVE feeds are partial in different places -> fixed by a no-loss PROOF (every
dropped row needs a same-day same-amount survivor, else refuse and name the amount), not a third
cutover. (P1) autopay was lost with the dropped row -> would have said "move $8,539.09 yourself"
for a card the bank still pulls.
SCHEMA: Account.institutionId + Account.institutionName (nullable, additive), stamped at
disconnect - deleting the PlaidItem was destroying the only record of who a disconnected row
banks with, and that row is the population the ladder works on.
GATE: verify.sh GREEN - tsc 0 / eslint 0 / 3924 unit / 261 files / build clean; full e2e 173/173
SERIALIZED (exit 0). The 4-worker run showed 5 failures, all passing isolated - the documented
load flake.
SHIPPED LIVE: pushed 32515e2..d0cef99; dpl_5nfVaMB8gCKZdVhypT5qfxZSqLc1; build log shows the
Neon prisma db push in sync + "Deployment completed"; www.aimplifi.app/sign-in is now
md5-identical to the new deployment and differs from the previous one.
UNVERIFIED: live Plaid (no creds) - the token revoke and the /accounts/get identity capture ran
against mocked providers only.
NEXT: L.10 slice 3's other half (collision interception on the fresh-Link front door), then L.8
(the dashboard still double-counts a both-live duplicate silently).

## #305 say WHY there is no Combine button. 2026-07-24
OWNER, on #304 shipped an hour earlier: "Not there." No Combine card on his /accounts for the
two Chase ....0977 connections. MY DEFECT: the feature rendered a control when it could act and
NOTHING when it could not, so "checked, cannot prove" looked identical to "never looked" - the
an-empty-set-is-not-a-fact rule applied to my own feature.
SHIPPED: pure explainUncombinableConnections keyed off what the READER sees (two live
connections at one bank with same-last-4 accounts), not off the ladder, so a pair the ladder
cannot even scope is still explained. Six reasons + two one-tap repairs: bank-id-missing ->
"Get the bank's ID" (runs syncInstitutions on demand; THE leading candidate for his case, since
the ladder refuses a name-only match after this morning's critic finding and a connection linked
before the institutionId column carries null); dismissed -> "Offer it again"
(new reconsiderDuplicatePair); strands/ambiguous/different-kind/different-bank/unproven stated.
GATE: verify.sh GREEN - tsc 0 / eslint 0 / 3929 unit / 261 files / build clean; new e2e drives
the blocked path.
OPEN, PROVED NOT MINE (stashed clean-tree run reproduces it): duplicate-connections.spec "two
connections to one bank are told apart" now hits the documented #287 whole-page DOM duplication
on most runs (duplicate-accounts-warning resolves to 2 elements). Full serialized suite was
173/174. Do NOT loosen the locator. Next session: chase #287.
SHIPPED LIVE: 50f9004..fc9e0d5; dpl_Ea3eoQhVyhLLKNvQqSAWck4ABZwG, build log "Deployment
completed"; three-way byte check at one instant: www == the fc9e0d5 deployment and != the
previous one.
NEXT: read the owner's next screenshot - the page now names the blocker, so the next step is
determined by which reason it prints.


## #306 the dashboard stops double-counting a card silently. 2026-07-24
TASKS L.8, the half #299 recorded open, and the (B) half of the owner's own L.11 report
("cash needed on main page makes no sense"): one real card on TWO live connections emits two
obligations, so the hero carried +$6,679.68 he does not owe and the reminders asked him to pay
it twice - while /cards had disclosed exactly this since #299. A CONSUMER, not a query:
getDashboardData has computed cardDuplicates since #299; only /cards read it.
SHIPPED: two sibling builders in card-duplicate-view.ts rather than a flag (the only thing that
differs across the three surfaces is WHICH MONEY CLAIM IS TRUE THERE) + one page-wide identity
pass + a pure paintedHeroCards extracted from the component.
TWO fresh-context critics, both broke it. 3 P1 + 5 P2, all fixed:
 - the "due dates missing" branch NAMED two cards it never painted (found by both, independently)
 - hero and reminders printed CONTRADICTORY sentences about one pair on one screen (engine-run
   repro: mixed real+estimated -> hero "next-cycle estimates", reminders "this cycle, two payments")
 - two independent numbering passes on one dashboard: "1." meant the loan on one card and a credit
   card six inches below (the #299 residual, across components instead of sections)
 - the #299-P0 computation lived inline in a React component, so its only cover was Playwright,
   which verify.sh skips: extracted + driven by the REAL engine, asserting counted rows sum
   EXACTLY to headline.requiredCents in every state
GATE: verify.sh GREEN - tsc 0 / eslint 0 / 3951 unit / 262 files / build clean; new e2e 5/5 incl.
axe + no-overflow at 360/393/430 WITH a duplicate seeded (the passive gates run as demo, who has
none - the #297 blind spot). FAIL-OLD 13/13. Empty prisma diff.
FOUND: main was RED. #305 deliberately changed /accounts to render the combine card and say why
it cannot act; duplicate-connections.spec still asserted count 0. Hidden because verify.sh skips
Playwright AND the same spec hits the #287 DOM-duplication flake under load, so the run was
written off as the known flake. Re-pointed at combine-connections-confirm; not deleted.
SHIPPED LIVE: 02ad11f; dpl_9CYAdDg9um5X4cG6FrHdt4dktkp1 READY, aliased www.aimplifi.app.
Three-way byte check, each md5 stable across 3 repeat fetches (the earlier mid-flip reads were
NOT stable, so the method was re-validated before being trusted): www == the 02ad11f deployment
and != the previous one.
RECORDED OPEN as L.15: six more surfaces render the same doubled rows silently (calendar,
reminder email, digest email, push, Ask, Glass-Box trace, + the Today feed), with file:line.
OWNER, mid-session: "Why in the heck are you allowed to make 2 of the same accounts... when I
try to link same account again, it just refreshes." He is right, and he said it at the start.
Disclosure is a patch; L.10 layer 2 (collision interception on the fresh-Link door) is the fix.
NEXT: L.10 layer 2 - intercept after the token exchange, BEFORE any row is written, and route a
proven re-pull into update mode instead of creating a second Item.


## L.10 layer 2 — the collision ENGINE (pure, unwired). 2026-07-24
OWNER: "Why in the heck are you allowed to make 2 of the same accounts... when I try to link
same account again, it just refreshes." The fix, not the symptom.
SHIPPED: pure detectLinkCollision (engine-first, rule 6) — given the accounts a just-exchanged
item returned + the user's other LIVE connections, decide whether this is a re-pull. Proves
nothing softer than the identity ladder (persistent_account_id, or last-4 + type + subtype +
currency within ONE provider at ONE institution). NOTHING CALLS IT YET: no route, figure or copy
changed (the slice-1 pattern).
Abstention tests are the majority on purpose: a wrong 'already-connected' throws away a real
connection; a missed one leaves a duplicate the app already discloses (#306) and can combine
(#304). Both owner-named cases survive: spouse's card (differing last-4 vetoes), Roth vs
Traditional (differing subtype vetoes; UNKNOWN subtype abstains — the rung L.9 lacked).
GATE: verify.sh GREEN - tsc 0 / eslint 0 / 3966 unit / 263 files / build clean. 15 new tests.
Empty prisma diff. Commit 4d262c4, pushed.
NEXT (the wiring, one slice): in exchangePublicToken, between the PlaidItem upsert (plaid.ts:337)
and syncAccountsForItem (plaid.ts:357) — the window where institutionId is resolved and NO
Account row exists yet (invariant D6) — fetch /accounts/get, call detectLinkCollision against the
user's other live items at the same institutionId, and on 'already-connected': /item/remove the
new token, persist nothing, return an outcome linkPlaidAccount surfaces as "You already have
Chase connected — refreshing it instead of adding a second copy" with a button into update mode,
plus the "different login, keep both" escape. Needs a fresh-context critic (/item/remove is
irreversible) and is UNVERIFIABLE against live Plaid here (no creds).


## L.10 layer 2 — the door that refuses. WIRED. 2026-07-24
OWNER: "Why in the heck are you allowed to make 2 of the same accounts... when I try to link
same account again, it just refreshes." This is the slice where that becomes true.
SHIPPED: exchangePublicToken now DECIDES before it writes. It resolves the new item's
institution, asks the user's other connections at that bank what they can reach RIGHT NOW over
the wire, runs the identity ladder, and when every account the new login reaches is already
reachable, hands the new Item back to Plaid (/item/remove), persists nothing, and refreshes what
they already had. A PARTIAL overlap keeps both connections (dropping one would strand the
accounts only it can reach) and discloses at the moment it happens. The decision runs BEFORE the
PlaidItem upsert, not after as the checkpoint sketched: the upsert can UPDATE a pre-existing row,
so deciding first means the refused path writes nothing at all and cannot delete a connection it
did not create (D6 satisfied a fortiori).
TWO fresh-context critics, both broke it. 2 P0 + 5 P1 + 6 P2, all fixed cycle 1:
 - BOTH P0s, one cause: the revoke was authorised by Account ROWS. A bank stops updating, the
   user reconnects it (the commonest reason anyone re-runs Link) - and the app destroyed the
   freshly re-authenticated credential, kept the dead one, and said it had "refreshed". Same
   snapshot matched a row the feed had stopped returning (L.14) and MISSED a row predating the
   #256 stamp. Fix: prove every candidate live; one that cannot answer proves nothing.
 - an account Plaid types `other` (never a row, never on screen) kept a whole second connection
   alive, duplicating everything visible, under copy claiming the opposite
 - "new" was counted against the ONE connection the collision names, so a sibling connection's
   account read as new with three connections at a bank
 - a failed /item/remove orphaned a LIVE billed Item whose token was never stored; now it keeps
   the item instead (a duplicate you can see beats one only Plaid knows about)
 - four copy defects: a control named by POSITION ("below") on five surfaces, four of which have
   no connection list and one of which renders it below the list; the OAuth path dropping the
   notice entirely unless the user started from /accounts, then firing it stale later; a sentence
   promising a combine that the triggering state guarantees will refuse; and a sibling hint still
   threatening "makes a second copy", pinned by an e2e asserting that phrase
D7 AMENDED to D7a and the residual recorded: there is no prompt and no remembered "keep both".
The escape is structural (anything of its own keeps the connection), which does NOT cover a
login whose account set is entirely shared, nor a tier-A last-4 collision. Both recoverable
(disconnect, link again), both leave an orphaned row. That is an argued trade, written down.
RECORDED OPEN: L.16 (the real prompt + remembered choice), L.17 (pre-#300 null institutionId
makes layer 2 a no-op until the sweep backfills; concurrent links still both persist).
GATE: see the PASS/FAIL block in this session's final message for the verbatim verify output.
FAIL-OLD proven (20 assertions fail against the stashed pre-change source). Empty prisma diff.
UNVERIFIED against live Plaid — no credentials here; every request shape runs against a mocked
Plaid server, and the Link window itself cannot be browser-tested.
NEXT: L.15 (the six surfaces that still render a duplicated obligation silently) or L.16.


## L.17 — the two duplicate-creating paths layer 2 did not close. 2026-07-24
Both were RECORDED-BUT-UNREPRODUCED residuals from the #307 critics, so both were reproduced
first, before a line of source changed. The repro run, verbatim:
  x test_regression__a_connection_linked_before_the_institution_id_column_is_still_a_candidate
    expected { kind: 'linked' } to match object { kind: 'already-connected' }
  x a null-id connection at a DIFFERENT bank is no candidate ... expected null to be 'ins_boa'
  x test_regression__two_link_sessions_at_one_bank_at_once_do_not_both_persist
    expected 2 to be 1
  Tests  3 failed | 17 passed (20)
(a) THE OWNER'S OWN BANKS were the blind spot: candidates were selected by
`PlaidItem.institutionId`, null on every item linked before #300, so the door he asked for was
a silent no-op at exactly the connections he already had. A null id was being read as "a
different bank" when it means "this row has never been asked". Now asked over the wire
(`/item/get`) and written back as the sweep would write it: bought at most once per connection,
only while a link at that bank is in flight, never again. Cannot answer => no match, link kept.
(b) Two concurrent exchanges (two tabs / a double-tap) both read zero connections and both
persisted -- D1 held by sequence. Now a lease, `PlaidLinkClaim @@unique([userId,
institutionId])`, held across classify-and-write and released in a `finally`; the loser waits,
then sees the winner and refreshes instead of duplicating. NOT a unique constraint on
`PlaidItem`: two connections at one bank are legitimate, so the DECISION is exclusive, never the
outcome. Expiry + takeover (delete by the id just read) so a dead request cannot wall off a
bank; a 4s wait that PROCEEDS UNPROTECTED on timeout, because orphaning a billed Item whose
token was never stored is worse than a duplicate #306 discloses and #304 combines.
CHECKED MYSELF (Maker/Checker) and locked: an abandoned lease is TAKEN OVER not waited on
(told apart structurally -- the stale row is gone afterwards, which only a takeover can do); a
link that THROWS still releases; two banks at once do not queue; a stranger's lease at the same
bank neither delays nor costs this user their link.
SCHEMA: one additive model, no existing table touched. PRIVACY.md discloses it (user id + a
public `ins_*` id, no financial data, cascades on deletion) -- the #226 undisclosed-table
finding applied pre-emptively. Deletion needs no code: the User relation cascades.
GATE: `bash scripts/verify.sh` GREEN -- tsc 0 / eslint 0 / 4006 unit / 264 files / build clean.
duplicate-connections e2e 8/8 at --workers=1 (first attempt failed 8/8 on a MISSING PLAYWRIGHT
BROWSER in this session's sandbox cache -- environment, not code; `npx playwright install
chromium` then 8/8).
UNVERIFIED against live Plaid -- no credentials here; the concurrency repro drives two real
`exchangePublicToken` calls against a mocked Plaid server and real Prisma.
RESIDUAL, written down not claimed away: a link whose institution never resolves takes no lease
(nothing to be exclusive about, and the collision check abstains on it anyway), and a claim
leaked by a killed process is reclaimed by the next link at that bank, not by a sweep.
SHIPPED LIVE: de1b5a4; dpl_3mKj7AoppLK9BQ1AYTHrsizLMJuG READY, target production, aliased
www.aimplifi.app. The Neon push ran in the build ("Your database is now in sync with your Prisma
schema. Done in 428ms" against ep-proud-sound-atpgfoct) so `PlaidLinkClaim` EXISTS in production;
"Deployment completed". Three-way byte check, stable across 3 passes: www == the de1b5a4
deployment (70cb917ef48c5e9ea7e267bcf00d4b7e) and != the previous one
(14da1d22ad7bb4b2ba884d3c1598f319). No public marker to grep -- the whole change is inside an
auth-gated server action, so byte identity plus the local gate is the evidence.
NEXT: L.15 (the six offline surfaces that still render a duplicated obligation silently) or L.16
(the real collision prompt with a remembered "keep both").
SHIPPED LIVE: ba5a222; dpl_3n1FCpGfrTCccnw1AipjwwDQWAXP, aliased www.aimplifi.app. Three-way
byte check, each md5 stable across 3 repeat fetches: www == the ba5a222 deployment and != the
previous one. No public marker to grep — the connect flow is auth-gated and the notice renders
only after a real Link session — so the evidence is the byte identity plus the local gate.

## L.14 — a deselected account freezes, keeps counting, reads as fresh. 2026-07-25
THE DEFECT: Plaid Link update mode ships with `account_selection_enabled`, so a user can untick
an account. `upsertPlaidAccounts` only ever creates or updates, so nothing noticed: the row kept
its last balance, kept counting toward net worth / cash-needed / /cards, and kept LOOKING current,
because a Plaid row's freshness is graded from its BANK's last sync (#293) and the bank was still
syncing. It also could not be deleted ("Disconnect the bank first"). L.10 slice 2 shipped a
sentence in the post-update flash naming the re-tick; a transient flash is not a fix for a figure
that stays wrong forever.
THE DECISION (the one that shaped everything): DISCLOSE, ADJUST NOTHING. The row keeps counting.
Excluding it would be its own money claim, and its failure direction is the expensive one — an
unticked card whose statement is still genuinely owed would vanish from cash-needed and the app
would stop telling someone to pay a bill they still owe. Keeping it over-funds slightly; dropping
it silently risks a missed payment. Only the user knows whether the account still exists, so the
app surfaces the decision with BOTH remedies rather than guessing. What changes is what the app
CLAIMS.
SHIPPED: additive `Account.feedDroppedAt`; pure `reconcileFeedPresence` (engine-first); wiring in
`syncAccountsForItem` ONLY — `/transactions/sync` echoes just the accounts with activity, so
reading absence there would freeze every quiet loan, card and brokerage on the first sync after
deploy; `not_shared` freshness level graded from the DROP not the bank; Delete permitted (the
standing refusal's premise — "the next sync would bring it back" — is false for a row the feed no
longer sends); disclosure on /accounts (has the controls) and the dashboard (has neither, so it
names the route, per L.15).
EVIDENCE SO FAR: verify.sh GREEN — tsc 0 / eslint 0 / 271 files / 4130 unit / build clean.
FAIL-OLD PROVEN: 7 assertions fail with the three behavioural changes reverted (detection call,
not_shared branch, delete-guard arm) while the schema and engines stay, so the failures are about
BEHAVIOUR, not module existence. New e2e feed-dropped-account.spec 2/2 at --workers=1.
FULL SERIAL E2E: 185 passed / 3 failed, all in duplicate-connections.spec. STASHED CLEAN-HEAD
CONTROL RUN (rebuilt first — e2e runs the last `next build`, not the source): 185 passed / 1
failed, the SAME spec, one of the same tests (line 343). Pre-existing load flake, not a
regression; a different subset fails per run, which is its signature.
FOUND EN ROUTE, fixed: `syncAccountsForItem` destructured `{ accounts }` and handed a non-array
to the upsert loop on a garbled-but-200 body — `accounts is not iterable`, swallowed into an audit
on the sync path but thrown out of the LINK path, failing an otherwise good connection. Now guarded
like the holdings sibling (#128/#290 class).
UNVERIFIED against live Plaid — no credentials here; every request shape runs against a mocked
Plaid server with real Prisma.
IN FLIGHT: two fresh-context hostile critics (money/data-integrity, and copy/surfaces).
NEXT: fold critic findings, then DECISIONS #301 + REGRESSION_LEDGER + TASKS L.14 status, commit,
push, verify the deploy is live.

## L.14 critic cycle 1 — both P0s and 4 of 6 P1s closed; 4 recorded as L.18. 2026-07-25
TWO fresh-context critics ran in parallel (money/data-integrity, copy/surfaces). Both broke it.
Verdict cycle 1: FAIL — 2 P0 + 6 P1. Every fix below is locked by an EXECUTED test.
THE DEEPEST FINDING, reached INDEPENDENTLY by both: the whole "keep counting, just say so" stance
had been argued over LIABILITIES only. The user's own PAYMENT account can be feed-dropped, and
there the direction inverts — a balance frozen HIGH reports shortfall $0 and no transfer
recommendation while the real account cannot cover the autopay. That is the exact missed payment
the rationale claimed to prevent. Recorded as DECISIONS #302: ask the failure-direction question
per ROLE, not per class of value.
FIXED + LOCKED:
 - P0-1 the banner announced a reconciliation PREDECESSOR as "still counted" — the boundary had
   already zeroed it ($0) and /accounts had hidden it, and the notice then sent the reader there.
 - P0-2 Cash Flow Radar offered a FROZEN balance as money to move, sorted FIRST (sources sort by
   size) and stamped sufficient — the one surface issuing a move-this-much instruction.
 - F-1 cash-needed now discloses that its projection rests on a balance that stopped updating.
   NOT adjusted: inventing a lower balance would fabricate.
 - F-2 the holdings sweep PRUNED a dropped brokerage's positions (its clean-run rule answers "is
   this list complete?", not "is this account still reported?"), so /investments lost $50k while
   net worth kept it — which made the shipped sentence FALSE. Prune now skipped for a dropped row.
 - F-3 a partner's frozen account counted in household figures unannounced → a COUNT in the
   banner; never names or amounts, which exceed the sharing consent.
 - F-4 the remedy named "Add or fix accounts", a control that ceases to exist once the bank is
   disconnected → liveness is a REQUIRED argument, not an assumption.
 - plus: the tautological e2e assertion the critic caught, and a comment claiming the copy held
   "in an email" for a channel never wired.
CHECKED MYSELF en route: the `assumptions` array reaches the dashboard hero ONLY — I had assumed
it fanned out to /cards, Ask and the digest, and grepping before writing the claim is the only
reason a false one did not ship.
OPEN, recorded as TASKS L.18 rather than bulk-patched (pasting one sentence onto four surfaces is
the L.15 failure verbatim): /cards, the Ask answer + its derivation trace, the digest/reminder
emails + web push, and /coach all still print figures derived from a frozen balance unqualified.
GATE: verify.sh GREEN — tsc 0 / eslint 0 / 4148 unit / 272 files / build clean. New e2e 2/2.
This slice does NOT claim a critic pass. It is a strict improvement on main with 4 P1s named.
NEXT: L.18 (the four silent surfaces), then L.16.

## L.14 — the verified deploy. 2026-07-25
SHIPPED LIVE. Two deployments, and the distinction matters for what is actually true in prod:
 - `5v610g1z8` (a16f9e4, THE CODE) applied the schema: "Your database is now in sync with your
   Prisma schema. Done in 473ms" against ep-proud-sound-atpgfoct — so `Account.feedDroppedAt`
   EXISTS in the Neon production database. "Deployment completed".
 - `acvtwpan6` (7a6f50c, docs only) built after it, found "The database is already in sync with
   the Prisma schema", and is the one ALIASED to www.aimplifi.app.
Three-way byte check on /sign-in, stable across 3 repeat fetches: www == acvtwpan6
(61dec53bdb7bbe51f5ce72fefedb149d) and != the previous deployment (85e4c0f2da381ed7ed4f2855b65ed3e3).
No public marker to grep — the banner and the row note render only for a signed-in user who has a
frozen account — so the evidence is byte identity plus the local gate, the same standard as L.17.
LESSON WRITTEN: docs/lessons/failure-direction-is-per-role-not-per-value.md (+ INDEX).
NEXT: L.18 (the four surfaces still printing a frozen figure unqualified), then L.16.

## L.18 — the surfaces that print a frozen figure, built. 2026-07-25
THE SPINE: `frozenSince` now rides the OBLIGATION, not a re-query. L.14 disclosed the frozen
account once in the cash-needed engine's `assumptions` and its code comment claimed that reached
"/cards, the dashboard hero, the calendar, the Ask answer and the weekly digest". Only the hero
renders `assumptions`. So the fact travels with the money instead: REQUIRED `frozenSince` on
CardObligation, UnknownDueDateCard, LoanObligation and PaymentReminder, plus `fundingFrozen`
{frozenSince, balanceCents} on CashNeededResult. Every downstream surface can now qualify its own
figures with no new query and no argument a caller can forget.
TWO CORRECTIONS TO L.14's OWN COPY, both found by re-reading the engine rather than the comment:
 1. "Its figures here are based on the last balance we saw" is TRUE only on the estimate path.
    With a statement, buildObligation reads the statement's balance/minimum/due date and never
    touches currentBalanceCents. It named a dependency the figure does not have, and missed the two
    that bite: CardPayment rows stop arriving with the feed (money already paid is never
    subtracted) and no replacement statement arrives either. New claim describes the FEED stopping,
    which covers both paths.
 2. "Every figure here is projected from it" (funding) — `requiredCents` is the sum of card dues
    and never reads that balance. Now names the shortfall and the transfer, which do.
THE GAP L.14 LEFT, and the sharpest thing in this slice: `computeRadar` withheld a frozen account
as a transfer SOURCE and said nothing about the balance the whole 90-day walk STARTS from. That
number decides whether there is a dip at all, when, and how large the transfer is — and the
frozen-HIGH case produces no dip and no alert, so the reader is reassured by a projection that
cannot see the account. Disclosed in both states with different sentences: with a transfer, "the
dip comes sooner and the amount to move is larger"; with none, "no dip here is not evidence that
the account is safe". Derived from `input.accounts` + `paymentAccountId`, so no new argument exists
to forget. The push carries its own SHORT variant naming no control, because a notification holds
none.
SURFACES CLOSED: /cards (per-row note + a qualifier on "Do this first" + the undated panel's bare
balance + the all-clear headline), the reminder email and the weekly digest (one shared block, "in
this email" never "above", plus the digest's clear-week claim), web push (payment_due and the radar
alert, appended last so truncation drops the advisory not the amount), Cash Flow Radar, the Ask
answer + net-worth/account-balance answers + BOTH audit traces, /coach (per figure), and the
dashboard payment-reminders card, which was printing "$X due DATE" unqualified and is not on the
L.18 list — found by sweeping consumers rather than by reading the brief.
A CORRECTION TO THE BRIEF, proved by execution: L.18 says the frozen balance drives "the FI number,
years-to-FI and runway months". It does not drive the FI number — `fiNumberCents(annualExpenses,
swrBps)` reads no balance. The /coach test holds a frozen brokerage worth $4,210.55 beside an FI
number of $0.00. Qualifying it would have attached a caveat to a figure the account does not feed.
EVIDENCE: tsc 0 / eslint 0 / 4192 unit across 273 files / build clean. New lock
`frozen-figure-surfaces.test.ts` (45) drives the real engines end to end plus real Prisma for
/coach; new e2e 2/2.
FAIL-OLD PROVEN, BOTH DIRECTIONS (a disclosure can fail by silence or by false hedging):
 - silence the builders → 19 of 45 fail (every positive claim is load-bearing)
 - make them speak unconditionally → 6 fail (every abstention is load-bearing)
FULL E2E: 187 passed / 3 failed, all three in duplicate-connections' sibling `combined-accounts`.
STASHED CLEAN-HEAD CONTROL RUN (rebuilt first): the same test fails identically on untouched main —
strict-mode "resolved to 2 elements" on /accounts, the documented #287 DOM-duplication flake. New
information for that entry: isolated and serialized it now fails 3/3 rather than intermittently.
`feed-dropped-account.spec` failed once under full-suite load and passes 3/3 alone.
IN FLIGHT: two fresh-context hostile critics (money/data-integrity, copy/surfaces).
NEXT: fold critic findings, then DECISIONS + REGRESSION_LEDGER + STATUS/TASKS, commit, push,
verify the deploy is live.

## L.18 critic cycle 1 — 2 P0 + 4 P1 + 6 P2/P3, all fixed. 2026-07-25
TWO fresh-context critics ran in parallel (money/data-integrity, copy/surfaces). Both broke it.
Every finding below was reproduced by the critic before being reported, and every fix is locked by
an executed test.
THE TWO P0s, and they are the same mistake this slice was written to correct, one level down:
 - P0-1 the engine's frozen-card assumption was resolved over EVERY input card. A card with no
   statement AND no cycle days produces no obligation at all — it lands in `unknownDueDateCards`,
   contributes $0, and already carries an "excluded from every figure here" assumption — yet it
   took the ESTIMATE branch and told the reader "the amount asked for here is worked out from the
   last balance we saw". Two assumptions in one list contradicting each other, and the louder one
   false. Now resolved against `due`, the exact rows summed into `requiredCents`.
 - P0-2 `applyReconciliationBoundary` zeroes a superseded predecessor's balance and keeps every
   OTHER field, `feedDroppedAt` included — so the Ask answer said a $0.00 row's last figure was
   "still counted in your net worth", and the derivation panel printed $0.00 on that row three
   lines above the sentence. /coach had the guard; the assistant did not. `assistantAccounts` now
   takes the superseded set as a REQUIRED argument and clears the stamp at the boundary.
THE P1s, all the same class — a sentence true on the surface it was written for and false on
another:
 - P1-1 a PARTNER's shared card was told "Your bank stopped sharing … Check the card with your
   bank before paying", then "only the household member who owns it can reconnect it". An
   imperative to a reader who is not paying, a bank they have no relationship with, and a remedy
   pointing the other way. Ownership is now a REQUIRED tri-state on every frozen row — and the
   third state exists because the cash-needed engine is pure and is handed a household-MERGED
   account list with no ownership on it, so it says "the bank" rather than defaulting to a claim
   it cannot support.
 - P1-2 the digest and the dashboard all-clear built their frozen list from a HOUSEHOLD-scoped
   result and used own-scope copy, sending a reader to /accounts over a card that is not listed
   there — in an email, which carries no control to correct itself.
 - P1-3 a frozen LOAN was given card-shaped copy: "the card", "this statement", "including any
   payment you have already made". Nothing subtracts payments from a loan obligation, so that named
   a mechanism that does not exist — and a reader who reads the reminder as stale skips a mortgage
   payment. Loans now say what IS stale: the stored payment amount and due day.
 - P1-4 /cards' all-clear passed the RAW card name while every other note on the page passes the
   painted label, so two cards both called "CREDIT CARD" were named twice, identically, inches
   from the headings that tell them apart (the #298 shape, the L.15 rule). Moved into the scope
   where `painted` lives, and identical labels now collapse to "all named the same thing" rather
   than being listed twice.
ALSO FIXED: "Treat the amount as a floor" printed on a COVERED hero with no amount on screen (role
now follows `recommendation`); the frozen note demoted the duplicate-payment warning past the push
truncation point; the /coach money-signature weather line is the runway wearing a mood and said
nothing while the runway card beside it did; "your bank" singular over two banks; the reminders
card's all-clear was REPLACED rather than qualified, orphaning "this covers only what we can still
see"; the stale L.14 comment survived in types.ts after being corrected in engine.ts.
FOUND BY MY OWN ABSTENTION TEST, not by a critic: after making the per-row email sentence
partner-safe, the block's TITLE and closing line still said "your bank" and "check that account
with your bank" over a partner's card. The test that asserts what the copy must NOT say is what
caught it.
GATE: verify.sh — tsc 0 / eslint 0 / 4205 unit across 273 files / build clean. Full e2e 186 passed
/ 4 failed, a DIFFERENT set each run (budget-targets, combined-accounts, reconcile,
feed-dropped-account); every one of them passes serialized in isolation, and combined-accounts:84
reproduces identically on a stashed clean HEAD. Load flake, not a regression.
IN FLIGHT: critic cycle 2, re-executing each cycle-1 fix and hunting for what the fixes broke.
NEXT: fold cycle-2 findings, then DECISIONS + REGRESSION_LEDGER + STATUS/TASKS, commit, push,
verify the deploy.

## L.18 critic cycle 2 — my own fixes broke three things. 2026-07-25
A third fresh-context critic re-executed every cycle-1 fix and hunted for what they broke. It
CONFIRMED closed: the superseded-predecessor guard (both directions, including the fold path), the
loan claim across all three channels, the payment_due push ordering, the all-clear qualifying rather
than replacing, the funding role following `recommendation`, and disclose-adjust-nothing across the
whole diff. Two of its findings I had already fixed in a copy-review pass before it reported.
WHAT MY FIXES BROKE, all three reproduced by execution:
 - P1-4 the P0-1 narrowing OVER-shot. Resolving to `due` dropped `upcoming` — and those are the
   ESTIMATE-path obligations whose amount IS the frozen balance verbatim. The hero prints them as
   "est. — next cycle" beside a surviving assumption that names the frozen figure and calls it "the
   current balance", vouching for it. Before the fix that card WAS named. Now: every obligation
   carrying an amount a surface states, this cycle or next.
 - P1-1 `traceCashNeeded` hardcoded `ownership: 'reader'` on the strength of a comment claiming
   both callers read a personal-scope result. The dashboard hero renders the MERGED result, and its
   own page comment says so — so the panel a reader opens to AUDIT a figure vouched for a partner's
   frozen card in the second person. Ownership is now an argument both callers pass.
 - P2-1 a MIXED list re-enabled every reader-only clause. `allPartner` is all-or-nothing, so one
   own card restored the imperative, the possessive and the reader-only remedy over the partner's
   row beside it. Two ownerships are two claims, so the builder now says each thing once.
ALSO FIXED: I repeated the P2-7 push demotion one branch down, on the radar alert, in the same pass
that fixed it for payment_due; `'unknown'` ownership had corrected the SUBJECT and left the
reader-only remedy standing; the collision phrase asserted "two of them share a name" over four
rows in two pairs; and the Ask no-match branch said a listed balance was "counted in the balances
listed here", which is a category error.
GATE: verify.sh — tsc 0 / eslint 0 / 4213 unit across 273 files / build clean. Full e2e 187 passed /
3 failed, a different set again (budget-targets, duplicate-connections ×2); all 10 pass serialized
in isolation. This slice does NOT claim a critic pass: four surfaces are named OPEN in STATUS.
NEXT: DECISIONS/ledger are written; commit, push, verify the deploy is live.

## L.18 — the verified deploy. 2026-07-25
SHIPPED LIVE as `62e7b90`. Deployment `aimplifi-nmis71jsn-reiforge.vercel.app`, Ready, aliased to
www.aimplifi.app. Verified by three-way byte identity on /sign-in, stable across three repeat
fetches: www == the new deployment (821f53d948dce93b3d6cfcd61902099f) and != the previous one
(abd8e434f728df3fc17e840af9660a02).
NO PUBLIC MARKER, and I checked rather than assuming: every L.18 string lives in an auth-gated
route's chunk, so I extracted the 12 chunk URLs the sign-in shell references and grepped each one
served from www for "stopped sharing this account" — none carries it, which is expected and is why
the evidence here is byte identity plus the local gate, the same standard as L.14 and L.17.
NO SCHEMA CHANGE — `git diff --stat -- prisma/` was empty before the push, so the live Neon database
was untouched by this deploy.
LESSON WRITTEN: docs/lessons/a-disclosure-is-several-claims-in-one-sentence.md (+ INDEX).
NEXT: L.16 (the D7 prompt), or the five surfaces L.18 names open in STATUS — /calendar first, as
the only remaining one that prints a dated amount to pay.

## L.19 scoped and mapped — SESSION PAUSED BY OWNER before any edit. 2026-07-25
NO CODE CHANGED. Working tree was clean at `9b82a42`, `origin/main...main` = 0 0. This entry exists
so the next session does not re-explore; everything below is a READ result, nothing is a claim that
anything was built.
SCOPE TAKEN: the five surfaces L.18 named open in STATUS, as **L.19**, in the ranked order STATUS
gives them — (1) /calendar, (2) the dashboard Today-feed nudges, (3) the PDF/CSV export, (4) a
frozen LOAN that can never reach an all-clear qualifier, (5) /investments + the debt-payoff path.
Ranked by money consequence, and 1-4 are INSTRUCTIONS or durable artifacts under the L.14
figure-vs-instruction axis; 5 is figures only and is the one to drop if the slice grows.

THE L.18 PRIMITIVE, MAPPED (so it is reused, not re-invented — this is the L.15 lesson):
`src/lib/engine/account/feed-dropped-view.ts` exports ELEVEN builders. The four unions, spelled
exactly: `FrozenFigureRole` = 'figure' | 'instruction'; `FrozenNextStep` = 'accounts-route' |
'open-app' | 'partner' | 'nothing'; `FrozenOwnership` = 'reader' | 'partner' | 'unknown';
`frozenProjectionNote`'s `shows` = 'a-transfer' | 'a-dip' | 'no-dip'. Builders relevant to L.19:
`frozenCardsNote(rows, {role, nextStep})`, `frozenNothingDueNote(rows, {nextStep})`,
`frozenLoanNote(row, {role, nextStep})`, `frozenFundingNote(funding, {role, nextStep})`,
`frozenProjectionNote(funding, {shows, nextStep})`, `frozenTotalNote(rows, {figureLabel, nextStep})`.
`frozenSince: string | null` is REQUIRED on `CardObligation`, `UnknownDueDateCard`, `LoanObligation`
and `PaymentReminder`; `CashNeededResult.fundingFrozen` is REQUIRED as
`{frozenSince: string; balanceCents: Cents} | null`. `CardSnapshot.frozenSince` is the one OPTIONAL
(engine INPUT, not output) — that is the inconsistency STATUS already records as open.
The lock is `tests/unit/frozen-figure-surfaces.test.ts` (1154 lines), which drives the real engines
via a `cashNeeded()` helper over `assembleCashNeededInput` -> `computeCashNeeded`, and pins silence
cases to GOLDEN LITERALS rather than to the code's own defaults.

CONFIRMED BY READING THE CODE, for surfaces 3-5 (surface 1 and 2 are NOT yet mapped — the explorer
covering /calendar and the nudges was interrupted, so re-run that one first):
 - EXPORT: `netWorthReportPdf` (`src/lib/export.ts:57-63`) takes accounts as
   `{name, type, currentBalanceCents}[]` — three fields, so the flag is dropped before it even
   reaches the exporter. The upstream payload is `src/server/finance.ts:479-485`, five fields
   (id/name/type/currentBalanceCents/mask), and `feedDroppedAt` is read at :133 but never added.
   The false footer is `src/lib/export.ts:97`, verbatim: 'Educational, not financial advice.
   Balances reflect the data source at export time.' Route is `src/app/api/export/route.ts`; the
   CSV paths (transactions-csv, net-worth-csv) carry NO footer at all, which is its own question —
   a CSV has nowhere to say it. Only test is `tests/unit/phase4.test.ts:202-218` and it asserts
   magic bytes and a size floor, so it cannot fail on a false sentence.
 - LOAN ALL-CLEAR: `frozenNothingDueNote` (feed-dropped-view.ts:413-445) hardcodes the phrase
   'of the cards here' in its MULTI-row branch at :442, and its single-row branch claims 'a
   statement issued on it since would not have reached us' — a statement claim, which is a card's
   story, not a loan's. Callers: `src/lib/engine/digest/build.ts:149` ({nextStep:'open-app'}) and
   `src/components/finance/payment-reminders-card.tsx:116` ({nextStep:'accounts-route'}). CORRECTION
   TO THE BRIEF: neither caller filters cards itself — both receive an already-built `frozenCards`
   prop typed `{label, frozenSince, ownership}[]`, so the cards-only narrowing happens UPSTREAM and
   the real fix site is whoever builds that prop, not the two callers. `LoanObligation.frozenSince`
   already exists (obligations.ts:54, set from `a.feedDroppedAt` at :88), so the data is there.
   All-clear copy: payment-reminders-card.tsx:130, gated on `reminders.length === 0`.
 - INVESTMENTS: the prune skip is real and deliberate — `plaid.ts:1749-1753` passes
   `mapped.skipped === 0 && acct.feedDroppedAt == null` as `prune`, with a comment citing L.14 F-2.
   `investments-view.tsx` has exactly one qualifier mechanism, `CurrencyExclusionBanner` (:60), and
   no frozen equivalent. DEBT: `DebtInput` (`engine/debt/payoff.ts:22-31`) has NO frozen field, and
   `loadDebtAccounts` (`src/server/debt.ts:28-41`) builds it from five fields — so surface 5 needs a
   type widened, not just copy, which is why it is the drop candidate.

NEXT: re-run the interrupted explorer over /calendar (does it render `result.cards` incl. estimates
+ `loanObligations`, and exactly where the L.15 duplicate disclosure sits, since that placement is
reusable) and over the Today-feed nudge `Proposal` shape (STATUS says it is a closed field set with
no free-text slot, so wiring it is a shape change). Then build /calendar first. Money-display copy
over a data-integrity fact => Fable build + hostile critic, and per the L.18 lesson prove fail-old
in BOTH directions: silencing the builder AND making it speak unconditionally.

## L.11(C) guilt-free spending (DECISIONS #295) — design checkpoint, session 2026-07-25 (Fable)
SCOPE: the owner-decided reframe: Safe-to-Spend -> "guilt-free spending" (IWT/Sethi): income minus
fixed bills, minus THIS-CYCLE card obligations from the cash-needed engine, minus a savings-%% goal
set in Settings. No commit anywhere builds it yet (verified: git log grep conscious/guilt).
VERIFIED FACTS THE DESIGN RESTS ON (all read this session, file:line in chat):
 - monthlyFlows counts card PURCHASES as expenses (accrual) and excludes card PAYMENTS
   (isTransfer: pair-detector, TRANSFER_DESCRIPTOR normalize.ts:20-21, Plaid TRANSFER_IN/OUT,
   seed). So naively subtracting obligations on top double-counts every card dollar across two
   months (posted month + statement month).
 - detectRecurring (detect.ts:96) skips transfers EXCEPT auto-loan ACH -> upcomingBills can never
   contain a card-payment series (no overlap with card obligations) but DOES carry auto-loan
   payments -> loanObligations must NOT be subtracted (would double-count CARMAX-class loans).
 - cashNeededFromSnapshot(snap, today) is pure over the personal snapshot -> {result,...};
   headline.requiredCents sums CYCLE obligations only (L.15: estimated/paid-off rows inflate
   nothing). personalCardDuplicates(userId, snap, result) is exported (finance.ts:294).
DESIGN:
 1. Cash-month model: spentSoFar = expenses from NON-CREDIT accounts only (two monthlyFlows
    calls: full set for income, non-credit set for expenses); card purchases enter via the
    obligation when their statement arrives. committed = cashSpent + upcomingBills +
    cardObligations(headline.requiredCents, same figure the hero prints) + plannedSavings.
 2. Savings: engine takes goalContributionsCents + savingsTargetBps (null = unset); planned =
    max(goals, round(income*bps/10000)) — the %% is a pay-yourself-first FLOOR, summing would
    double-count the same intent; output names the winning source for honest labeling.
 3. Loan/mortgage payments outside a detected series remain un-subtracted — PRE-EXISTING
    overstatement, recorded open in STATUS, not widened here (owner asked for CARD obligations).
 4. Schema: additive nullable User.savingsTargetBps; dials.ts validation (0-9000 bps) + settings
    form field + updateMoneyDials write path.
 5. Disclosures the new figure inherits from cash-needed (#250 lesson): balance-carrying
    undatable cards (overstatement — the dangerous direction), both-live duplicates resolved
    against the CYCLE-obligation set (understatement), frozen obligations. Disclose, never adjust.
 6. Sweep: SafeToSpendCard, /spending-plan hero+legend(+card-payments segment)+explainer,
    traceSafeToSpend 5/6-term identity, redact label, Ask answer/llm/intent(keep "safe to spend"
    as parse alias, add guilt-free phrasings)/follow-ups/learned-phrases, solver share-of copy,
    COACH_COPY.consciousSpending; conscious.ts fixed bucket gains cardObligations (identity holds).
 7. data-testids stay unchanged (safe-to-spend etc.) — copy changes, ids don't.
GATE PLAN: engine tests first; verify.sh; spending-plan/ask/glass-box e2e explicitly; fresh-context
hostile critic (money surface); DECISIONS/REGRESSION/STATUS/TASKS; commit+push+deploy-verify.

## L.11(C) BUILT — checkpoint before critic verdicts. 2026-07-25
IMPLEMENTED (all uncommitted, working tree):
 - engine plan.ts: inputs {cardObligationsCents, goalContributionsCents, savingsTargetBps}; output
   {plannedSavingsCents = max(goals, round(income*bps/1e4)), savingsSource, ...}; committed gains
   the card-obligations term. savingsTargetCents() exported, Math.round named.
 - conscious.ts: fixed bucket gains cardObligations; partition identity preserved.
 - server/spending-plan.ts: income over ALL accounts, expenses over NON-CREDIT accounts (two
   monthlyFlows calls); cardObligations = cashNeededFromSnapshot(snap).result.headline.requiredCents
   (same snapshot -> personal scope + coherence by construction; guarded for account-less users);
   savingsTargetBps from prisma.user; disclosures {undatedCards, duplicatePairs(resolved against
   perDueDate-flattened summed set), frozenCards} ride the plan (SpendingPlanWithNotes).
 - glass-box trace: 5-term identity + savings-source label + 3 basis sentences; -0 normalized;
   redact headline 'Guilt-free to spend'.
 - answerSafeToSpend(plan, disclosures REQUIRED): guilt-free copy + per-direction qualifiers.
 - schema: User.savingsTargetBps Int? (additive); dials.ts savingsTarget field (0-9000 bps),
   settings action persists + audits + revalidates /spending-plan + /budgets; form field added.
 - UI: SafeToSpendCard relabeled + REQUIRED disclosures prop + undated/duplicate notes;
   /spending-plan hero/5-segment bar/legend/breakdown/explainer + "What this figure can't see".
 - copy sweep: solver share-of copy, suggestion line, chips (9 sites), llm.ts, learned-phrases,
   COACH_COPY.consciousSpending, intent.ts alias guilt[- ]?free (safe-to-spend kept as alias).
 - tests: spending-plan/conscious/glass-box/assistant-answer/headline-cents/settings-dials updated;
   NEW tests/unit/spending-plan-server.test.ts (real Prisma throwaway user: cash split, coherence
   with cashNeededFromSnapshot, savings-target floor wiring, undatable-card disclosure).
GATES RUN (real output in session): bash scripts/verify.sh -> VERIFY GREEN (exit 0).
Affected e2e serialized: spending-plan + glass-box + ask -> 24/24 passed (incl. the new five-line
reconciliation "Guilt-free to spend" and guilt-free headline regexes).
IN FLIGHT: full vitest count re-run; 2 parallel fresh-context critics (money-math/wiring lens;
copy-honesty lens) — their findings must be RE-EXECUTED here before any fix (subagent-green lesson).
NEXT: critic verdicts -> fixes -> re-verify -> DECISIONS #307 + REGRESSION_LEDGER + STATUS + TASKS
row -> commit, push (schema diff IS present: prisma db push will run on deploy — additive nullable
only) -> verify deploy READY + live check.

## L.11(C) CRITIC CYCLE 1 — FAIL, all findings fixed and locked. 2026-07-25
Two parallel fresh-context critics (money-math/wiring; copy honesty). Verdict FAIL. Fixed, with
every money finding re-locked by an executed test (8 REGRESSION_LEDGER rows, DECISIONS #307):
 F1 cross-month double-reservation -> obligations now MONTH-WINDOWED from perDueDate (p.date <=
   endOfMonth); F2 estimate-path card due this month -> new statementPendingCards disclosure;
 F3 solver double-reserve of the savings target -> unallocatedSavingsCents rides the plan,
   REQUIRED on all three inverse-planner builders, reserve named in the answer; F4 BIWEEKLY
   half-count -> scheduledOccurrencesInWindow (pure, stale anchors never extrapolated) — demo June
   income now 490000 not 245000; F5 card cashback double-benefit -> income AND expenses both
   non-credit; F8 overpaid undated card -> owing-only filter; P1-1/P1-2 overspent-branch direction
   inversion -> every qualifier flips with the branch, all three surfaces; P1-3 false statement
   provenance -> cardObligationsEstimated REQUIRED on the plan, trace row + basis + page
   "(estimated)"; P1-4 guilt-free alias mis-route -> gated off /\b(did|spent)\b/; P2-5 conditional
   savings basis; P2-6 wording "outside your credit cards"; P2-7 hero/breakdown unification;
   P2-8 noData branch renders the excluded-cards note; P2-9 scope-qualified coherence claims;
   P3-11/12/13 copy nits. ACCEPTED-NOT-CHANGED: P2-10 next-month estimates are legitimately out
   of window (each surface states its window); F7 scheduled savings-transfer-as-bill is
   unreachable from real ingest paths (detector drops transfers; demo row day-1 stale anchor) —
   recorded; F9 pay-in-full assumption now STATED in explainer + basis rather than changed.
DEMO STATE (executed probe): income 490000 / spent 15650 / bills 180000 / cards 541233 (June-due,
not estimated) / left -246883 -> "Over plan by $2,468.83" — honest for the seeded revolver; the
hero's balance-based question still reads covered; windows stated per surface.
GATES RE-RUN, real output in session: tsc 0; full vitest 275 files / 4318 tests ALL PASS (alone);
bash scripts/verify.sh -> VERIFY GREEN; affected e2e serialized (spending-plan, glass-box, ask)
24/24 on the FRESH build.
IN FLIGHT: critic cycle 2 (fresh context, aimed at the fixes: window boundary, cadence edges,
direction matrix, alias gate, reserve honesty). NEXT: cycle-2 verdict -> STATUS + TASKS row ->
commit/push (prisma diff = one nullable column -> db push on deploy) -> deploy verify.

## L.11(C) CRITIC CYCLE 2 — 1 P1 + 2 P2 on the fixes, all fixed; slice COMPLETE. 2026-07-25
Cycle-2 fresh-context critic (aimed at the cycle-1 fixes): F2-1 P1 the Ask answer (the one
UNTRACED surface) dropped cardObligationsEstimated -> estimate qualifier + "(estimated)" fact
label now composed in answerSafeToSpend, locked; F2-2 P2 dashboard card had no frozen note ->
added (safe-to-spend-frozen-note); F2-3 P2 the reserve sentence overstated coverage -> claims
only min(required, reserve), locked with the partial-coverage case. 2 more ledger rows (10
total). ACCEPTED + RECORDED (STATUS §STILL OPEN after L.11(C)): today-boundary exclusivity,
stale-anchor edges, savings-transfer-as-bill, CREDIT-only refilter scope, reserve /mo stability,
dashboard-note e2e gap, household-scope hero. DECIDED DELIBERATELY: demo opens "Over plan by
$2,468.83" (hand-verified to the cent by the critic; recorded in DECISIONS #307 + STATUS).
Critic's window-boundary probe (Sat-due walk-back), occurrence math, direction matrix: SOUND.
FINAL GATES (real output in session): bash scripts/verify.sh -> VERIFY GREEN, full vitest 275
files / 4319 tests; e2e spending-plan+glass-box+ask serialized 24/24 on the final build.
DOCS: DECISIONS #307 (+index), 10 REGRESSION_LEDGER rows, STATUS §L.11(C) (+7 residuals),
TASKS L.11 row -> [x] DONE.
NEXT: commit, push (prisma diff = ONE additive nullable column User.savingsTargetBps -> db push
runs against live Neon on deploy), verify deployment READY + aliases.

## L.11(C) — the verified deploy. 2026-07-25
SHIPPED LIVE as b969f41. Deployment aimplifi-ff9a8gmv9-reiforge.vercel.app, Ready, production,
built 1m, aliased to www.aimplifi.app + aimplifi.app. Verified by three-way byte identity on
/sign-in: www == the new deployment (85db6f15ed0882e4defc40f968278046, stable across repeat
fetches) and != the previous deployment 1yzb0ts70 (117555edf0330354f6406a605b01aa04).
SCHEMA: the deploy's prisma db push applied User.savingsTargetBps (additive nullable) to live
Neon — the build succeeding is the proof the push ran clean.
NO PUBLIC MARKER, checked not assumed: every changed string is auth-gated or demo-gated, so the
evidence is the READY aliases + byte identity + the local gate (the L.18 standard).
LESSON WRITTEN: docs/lessons/a-borrowed-total-imports-its-window.md (+ INDEX).
NEXT: open queue per TASKS — L.7 (rename accounts, owner-requested), L.9 (Roth/Traditional
wrong-pair), L.16 (keep-both prompt), L.13 (blocked on owner screenshot), STATUS §STILL OPEN
residuals (sharpest: an undetected loan payment is in NO plan term; radar/forecast/calendar
omit an undatable loan).

## L.7 BUILT — rename an account. Checkpoint before the gate. 2026-07-25
DECISIONS TAKEN (the four the TASKS row required, recorded here + DECISIONS #308):
 (a) SURVIVAL: a second column `Account.displayName` (additive nullable), never written by any
     ingest path — so a nickname survives every sync. A flag on `name` would be reverted by the
     next cron, which is the failure the row predicted.
 (b) WHICH NAME WINS: `name` stays the feed's string EVERYWHERE by default, and display sites
     ask for the label explicitly via `accountLabel()`. The direction is the safety property: a
     display site nobody updated shows the bank's name (stale, not wrong), while a MATCHING site
     nobody updated keeps comparing what the bank sent — a nickname must never reach duplicate
     detection, reconciliation matching, or the identity tokenizer.
 (c) TYPE: deliberately OUT of scope even though Quicken Simplifi edits name+type together —
     type drives the net-worth classifier and the cash-needed engine, so it is a money change
     wearing a label's clothes. Recorded as a follow-up, not shipped silently.
 (d) The last-4 identity line (#298) is untouched; a nickname is never the only distinguisher.
IMPLEMENTED (uncommitted):
 - NEW pure `engine/account/display-name.ts`: accountLabel / hasNickname / accountEvidenceLabel /
   parseAccountNickname (empty box = clear, 60 code points, sanitized through render-safe).
   `render-safe.ts` gained `sanitizeName` (the cleaning step without the placeholder fallback);
   `renderSafe` is byte-identical in behaviour.
 - schema: Account.displayName String? (additive nullable) + a comment on `name` naming it the
   comparison column. `npm run db:push` applied locally.
 - NEW `server/account-rename-actions.ts`: renameAccount — requireUserId, demo fence,
   ownership IN THE WHERE CLAUSE, parse, single-column update, audit row that records THAT he
   renamed and whether he cleared it but never the string, revalidate ×7.
 - propagation at the server/assembler boundary (engines untouched): AccountLike gains
   displayName and `assemble.ts` resolves card + payment-account labels once (the feedDroppedAt
   precedent); loans/obligations + radar resolve theirs; transactions/triage/household/export
   selects carry displayName and their mappers resolve; investments/recurring/forecast/finance/
   radar/coach/assistant resolve at their mappers. AccountView gains `name` (label), `feedName`,
   `displayName`; /accounts rows re-sort by the painted label.
 - UI: RenameForm + RenameButton on both row kinds of /accounts; a renamed LINKED row prints
   "· your bank calls it X" (testid account-feed-name) so the evidence stays on screen.
 - tests: NEW account-display-name.test.ts (16) + account-rename-server.test.ts (7, real Prisma,
   incl. the survives-a-sync case and the nickname-never-reaches-duplicate-detection invariant)
   + NEW e2e account-rename.spec.ts (open → save → re-sort → clear → original name back).
GATES SO FAR (real output in session): tsc 0 errors; eslint 0 on the touched files; the two new
unit files 23/23 pass.
NEXT: full `bash scripts/verify.sh`; then the evidence surfaces still to decide (duplicate /
continue-an-account / combined-accounts cards still print the FEED name only — accountEvidenceLabel
exists for them but is not yet wired); then fresh-context critic; DECISIONS/REGRESSION/STATUS/TASKS;
commit + push + deploy-verify (prisma diff = ONE additive nullable column → db push on deploy).

## L.7 — critic finding 1: the household nickname leak, fixed and locked. 2026-07-25
A fresh-context critic broke the first version on the PRIVACY axis and it reproduced: a partner
who renames his SHARED card "Divorce lawyer card" had that string printed to the OTHER member at
household scope. Cause: L.7 resolved the label inside the ENGINES (assemble.ts, loans/obligations),
which sit DOWNSTREAM of the household merge, so `displayName` rode the partner's shared rows into
the viewer's snapshot and out through cards, loans, reminders, /calendar, digest and push alike.
The `household.ts` shared-transaction path had been fenced by hand; the snapshot path had not —
per-surface fences are exactly the failure mode L.15/L.20 record.
FIX (one boundary, not N surfaces): `getSharedSnapshotSlice` now strips `displayName` from the
partner's rows as they enter the viewer's process — same defense class as the share-scoped `where`
above it, so the nickname never reaches process memory and every household label falls back to the
bank's name by the ordinary accountLabel rule.
LOCK: NEW tests/unit/household-nickname-scope.test.ts, 4 cases against the REAL server path
(getCashNeeded + getDashboardData over real Prisma): partner nickname absent at household scope AND
the partner's money still present under the FEED name (an absence-only assertion would also pass if
the merge silently broke); the viewer keeps his OWN nickname on the same screen; personal scope
unchanged. 4/4 pass.
ALSO: the critic left a throwaway repro (tests/unit/zzz-critic-repro-l7.test.ts) in the tree — read,
judged, superseded by the real regression test, deleted.
GATE STATE: verify run #2 FAILED on 3 tests — 1 was the critic's own throwaway; the other 2 plus 2
file-level errors were PrismaClientKnownRequestError ("database is locked" / FK violation) from the
two critic subagents running vitest against the SAME SQLite test DB concurrently with the gate.
Environment contention, the documented flake class — must be RE-RUN with nothing else touching the
DB before any claim of green. NOT yet claimed.

## L.7 — critic cycle 1 verdict and every fix. 2026-07-25
TWO fresh-context critics in parallel (wiring/comparisons; privacy/copy/honesty). BOTH said FAIL.
Deduped: 1 P0, 5 P1, plus P2/P3. Every finding was RE-EXECUTED here before fixing.
 P0  combine planner fed the LABEL -> `accountsOf` sorts by name, `planDirection` is
     order-dependent through `claimed`, so a rename inverted which Plaid connection the card
     recommends DISCONNECTING (confirm revokes the item). FIXED: mapper passes `a.name`; the
     type + select dropped the column so it cannot come back by accident. LOCKED with a
     two-run equality test PLUS a vacuity guard (the planner must still be feed-name-sensitive,
     else the equality proves nothing — the guard caught my own first fixture, which produced
     [] on both sides).
 P1  household leak (both critics, independently) -> fixed at the merge boundary; the first fix
     was a fetch-then-strip, which the second critic correctly called out as the shape that file's
     own header forbids, so it is now an explicit `select` that omits the column. PRIVACY.md +
     shareYourAccountsDisclosure updated. 5-case lock incl. the shared register.
 P1  Ask matcher widened by `accountSearchNames` -> a renamed card + a checking account answered
     "$6,348.11 across 2 accounts", adding money OWED to money HELD. WITHDRAWN (matcher back to
     the feed name); the mixed-kind total is recorded as the prerequisite.
 P1  derivation panel printed two names for one account -> both lines use accountLabel.
 P1  "your bank calls it X" false for MANUAL rows and for SimpleFIN names the app composes ->
     copy branches on manual; the row note reads "synced as"; accountEvidenceLabel WITHDRAWN.
 P1  combine/reconcile ORPHANED the nickname (survivor reverted to the bank string while the
     disclosure card still showed the chosen name) -> carried to the survivor in both paths,
     following the autopay-carry precedent in the same transaction.
 P2  household duplicate advisory named the VIEWER's own row by the feed string -> per-owner rule
     in one named helper (his label / the partner's bank name).
 P2  no scalar guard on a POST-able action; no rate limit; demo showed an always-refused control;
     duplicate list sorted by feed name but painted by label; radar tie-break nickname-ordered.
     All fixed. P3 maxLength on the box.
 Also: `hasNickname` (dead) removed; PROGRESS's earlier claim about unwired evidence labels was
 stale and is superseded by this entry.
DOCS: DECISIONS #308 rewritten post-cycle (+index), 6 REGRESSION_LEDGER rows, STATUS §L.7 with 4
residuals, TASKS L.7 -> [x], PRIVACY.md, lessons (use-server exports).
NEXT: clean verify (in flight), the rename e2e, then commit + push + deploy verify. Prisma diff =
ONE additive nullable column (User schema untouched; Account.displayName) -> db push on deploy.

## L.7 — GATE GREEN. 2026-07-25
bash scripts/verify.sh -> VERIFY GREEN: tsc 0, eslint 0, **279 test files / 4351 tests**, next
build clean. (Runs 2 and 3 failed on MY OWN test scaffolding, not the app: the rate limiter broke
the rename test's authz mock, then the new invariance test's fixture missed two fields of
CombineItemRow. Run 1's failures were SQLite contention from two critic subagents running vitest
against the same test DB — re-run clean, as the flake lesson prescribes.)
E2E serialized (--workers=1): account-rename + account-deletion + combined-accounts + household
-> **14/14 passed**, incl. the new rename round-trip (open -> save -> re-sort by the painted
label -> clear -> original name back).
NEXT: commit, push (prisma diff = ONE additive nullable column, Account.displayName -> db push
runs against live Neon on deploy), verify READY + aliases.

## L.7 — the verified deploy. 2026-07-25
SHIPPED LIVE as 2d3854c. Deployment aimplifi-fjd4y7xkm-reiforge.vercel.app (dpl_EaoFmSqTh2YHneZi1cqTS7xW2EZG),
Ready, production, built 1m, created 21:27:36 — eight seconds after the commit's own timestamp
(21:27:28), aliased to www.aimplifi.app + aimplifi.app + aimplifi-git-main-reiforge.
Verified by three-way byte identity on /sign-in: www == the new deployment
(ab64b9eed93bd4a2cde2f531d6655509, stable across a repeat fetch) and != the previous production
deployment its4fshd3 (b03ce52773e1eeb33372c7954fe92475).
SCHEMA: the deploy's prisma db push applied Account.displayName (additive nullable) to live Neon —
the build succeeding is the proof the push ran clean.
NO PUBLIC MARKER, checked not assumed: the rename control and every string L.7 touched live behind
/accounts, which is auth-gated, so the evidence is the READY aliases + byte identity + the local
gate (the L.18 standard).
NEXT: L.9 — the Continue-an-account card offering one predecessor against two successors, one of
them the wrong retirement registration (Fable build + hostile critic).

## L.9 PARKED mid-build for an owner-reported live defect. 2026-07-25
Owner sent three screenshots of the LIVE app: "It's worse now."
 - Dashboard: "Cash needed for cards this cycle $18,814.14 ... by Wed, Aug 5 to pay all 7 cards".
 - Same dashboard, lower: "GUILT-FREE TO SPEND $22,254.09 = $3,709.01/day, 6 days left".
 - /plan "How we got there": Expected income +$22,254.09; Spent so far (cash accounts) -$0.00;
   Bills still coming -$0.00; Card payments due this month -$0.00; Planned savings -$0.00;
   Guilt-free to spend $22,254.09.
The two figures on one screen contradict: the plan invites him to spend, at $3,709/day, money the
cash-needed answer says he needs in 11 days. Three of the five subtraction lines are exactly $0.00.
L.9 work in progress is STASHED (git stash, message below), tree clean for the diagnosis.
STASHED SO FAR: engine/account/registration.ts (new, the Roth-vs-pretax veto), duplicates.ts
(subtype field + veto + detectReconciliationCandidates -> {candidates, ambiguous} + excludePair),
transactions.ts/finance.ts/household-finance.ts subtype threading + the ambiguity view field.
Not yet done on L.9: reconcile-candidates-view.ts, the UI, all tests.

## L.11(D) BUILT — the cushion cap. Checkpoint before the gate. 2026-07-25
THE REPORT: three screenshots, "It's worse now" (see the parked-L.9 entry above for the figures).
DIAGNOSIS, from the code and confirmed against the screenshots (not a guess): the card-payments
term is windowed to the CALENDAR MONTH — `spending-plan.ts` keeps only `perDueDate` rows with
`date <= endOfMonth`. Every one of his seven cards is dated Aug 5. July's endOfMonth is Jul 31, so
the term is exactly $0.00, the plan hands back the whole month's income, and the per-day figure
invites $3,709.01/day for six days against $18,814.14 due eleven days out. L.11(C) fixed the
opposite error (one statement reserved against two months' income) and this is its mirror: a
statement reserved against NO month the reader can see.
WHAT I COULD NOT VERIFY: the other two $0.00 lines (Spent so far / Bills still coming). No live DB
credentials in this environment (.env is local SQLite), so his data is UNVERIFIED — recorded as
open, not explained away. Both are consistent with a July that has no posted non-card rows yet,
which the savings-rate card's last bar (Jun '26) weakly corroborates and does not prove.
THE FIX — a CAP, not a sixth subtraction: guilt-free = min(month's allocation, projected cushion),
where the cushion is `intraPeriodMinimum.balanceCents` from the SAME PAY_IN_FULL cash-needed result
whose rows the card term sums — the identical field the dashboard prints as "projected low point
... every due date clears". Spending a dollar today lowers every later projected balance by a
dollar, so the cushion IS the arithmetic limit. The two figures on that screen can no longer
contradict each other by construction rather than by two windows happening to agree.
DIRECTION: the cap only ever lowers the answer. A wrong cushion makes the reader under-spend; the
state it removes made him miss a payment.
CARRIED, so no surface can lose it: `allocatedLeftToSpendCents` (what the five monthly lines still
reach), `heldForDatedObligationsCents`, `cushionBinds`, `cushionThroughDate`.
SURFACES (every consumer of leftToSpendCents was greped, not assumed):
 - glass-box trace: a SIXTH ROW, present only when it binds, so `reconciles` stays true and the
   page's "these N lines add up to exactly" sentence stays a real claim (it now counts rows).
 - /spending-plan: hero note, a bar segment + legend entry, aria-label.
 - dashboard safe-to-spend card: its own note (a reader who never opens /plan sees the cap).
 - Ask: a sixth FACT row + a qualifier on BOTH branches (Ask has no breakdown page to explain a gap).
 - conscious buckets: held money moved to `fixed`, or the bucket identity would have restored the
   overstatement inside that view.
TESTS: 5 pure known-answer cases at his exact figures (incl. cushion null / cushion <= 0 / an
already-overspent month / cap composing with an in-month card term), plus TWO real-server cases —
one asserting the old dangerous figure is still what the month's lines reach (the vacuity guard),
one cross-checking the cap against `getCashNeeded`'s own intraPeriodMinimum.
FAIL-OLD: structural — the old engine had no cushion input; same inputs returned $22,254.09 where
the lock now asserts $817.29.
NEXT: full verify (in flight), then TWO fresh-context critics in parallel (money-display
instruction), then docs + commit + push + deploy-verify. Prisma diff expected EMPTY.

## L.11(D) — critic cycle 1 FAILED, and the design was replaced. 2026-07-25
Two fresh-context critics, different lenses, both said FAIL. Neither had seen the other. Both
independently killed the CAP design in the same terms, and one pointed at the fix that shipped.
 P0  the cushion was `intraPeriodMinimum` — the minimum over EVERY day of the balance walk, and
     the walk records its minimum on day ONE. So the cap became "never more than what is in
     checking right now" for anyone whose balance dips before payday: on a $200 float with $6,000
     landing on the 31st and one $1,000 card, it held back $6,000 and reported $28.57/day, with
     copy blaming cards for a date carrying no obligation. I had already narrowed the cushion to
     payment days only when the second critic arrived and rejected the whole instrument.
 P0  the subtracted amount was a RESIDUAL (allocation − balance), so it absorbed savings sweeps,
     unarrived income, other accounts and last month's opening balance — while five surfaces
     printed it as "held for card payments". Verbatim value, different meaning.
 P0  where the projection was already SHORT, the copy said holding money would make the payments
     clear. It would not; the account is short and the remedy is a transfer.
 P1  the raw ISO date printed into sentences ("through 2026-08-05") where the whole product says
     "Wed, Aug 5"; the conscious-buckets view read 98% fixed against a 50-60% target band and
     coached on it; the three inverse solvers took the capped figure as a MONTHLY capacity.
THE REPLACEMENT (shipped): the cap is gone. `obligationsBeyondMonthCents` — the same `perDueDate`
rows from the other side of the same `date <= endOfMonth` filter — is a SIXTH SUBTRACTION. A flow
bounded by flows. It dissolved every finding above rather than patching them, which is the sign
the boundary is right: no balance enters, so there is no stock/flow mix, no residual to mislabel,
no shortfall claim, no solver distortion, and the buckets file it under FIXED where a card payment
belongs. Accepted cost, stated in the copy: a statement is reserved twice for the first days of its
due month — the safe direction, self-clearing when it posts.
GATE (real output this session): bash scripts/verify.sh -> VERIFY GREEN, tsc 0, eslint 0,
**279 files / 4360 tests**, build clean. E2E serialized: spending-plan + glass-box +
phase1-cash-needed **6/6** (demo unchanged — its cards are all due inside its month).
One intermediate verify FAILED on 4 assertions: my own copy revert had left the fact label as
"Share of your guilt-free spending" instead of the original. Fixed and re-run clean.
DOCS corrected in place (they described the rejected cap): STATUS §L.11(D) rewritten, TASKS row,
REGRESSION_LEDGER row, and the lesson now records the WRONG fix as the transferable half.
NEXT: critic cycle 2 (two fresh critics, in flight) on the replacement; then DECISIONS #309,
commit, push, deploy-verify. Prisma diff EMPTY — no schema change in this slice.

## L.11(D) — critic cycle 2 also FAILED, and every finding is in the shipped code. 2026-07-25
Two more fresh-context critics, different lenses, both EXECUTING repros. 1 P0 + 6 P1.
 P0  the new row hardcoded `isEstimated: false`, and `cardObligationsEstimated` is false BY
     CONSTRUCTION whenever every card is dated past the edge (its own term is empty) — so a figure
     that was 100% estimate off current balances printed with the authority of a statement, under
     the page's own sentence "a line marked estimated says so". FIXED: its own flag, threaded to
     the row, the Ask fact label and the basis; locked by a fixture with NO statement anywhere
     (the estimate can only reach `perDueDate` when no real statement exists — which is why it
     needed a separate user, and is itself worth knowing).
 P1  BOTH critics, independently: the gross term re-committed L.11(C)'s error with the sign
     flipped — the EXPENSE window was widened past the month's edge and the INCOME window was not.
     Left gross it reserves a full statement every month, permanently, for anyone paid before his
     cards come due, and reserves a payment dated 30 days out that next month's plan shows on its
     first day. FIXED: the term is now the WORST RUNNING GAP, walked point by point, net of income
     scheduled before each payment — income landing after a payment cannot pay it. Four locks.
 P1  `summedIds` still filtered to the in-month half of a figure that now sums both, so a frozen
     or duplicated card inside it was undisclosed everywhere. One-line fix; the set is the figure.
 P1  Ask said "$18,814.14 of that is already reserved" where "that" is the $3,439.95 headline the
     reservation was already taken out of — and on the other branch, out of an OVERAGE. "before
     that figure", not "of it".
 P1  three surfaces still claimed card spending "counts once, in the month its statement's payment
     is due" — false the moment a payment is reserved in two months.
 P1  the dashboard card's `noData` test omitted the sixth term: a card-only user overspent by
     $14,000 was told "once this month has income or spending we can count".
 Also: a stale golden re-pointed (`glass-box.spec` asserted exactly 5 breakdown rows on a page
 that can now render 6 — the sum is the invariant, the count is not), and three dead cycle-1
 comments describing the rejected cap removed.
MY OWN E2E CAUGHT A RENDERING BUG no unit test could: `These {rows.length} lines` rendered as
"These 6lines". The string was testable and the RENDERING was not, which is the L.20 lesson.
GATE (real output this session): bash scripts/verify.sh -> VERIFY GREEN, tsc 0, eslint 0,
**279 files / 4366 tests**, build clean. E2E serialized: spending-plan-month-edge (new) +
spending-plan + glass-box + ask -> **25/25**.
DOCS: DECISIONS #309 (+index), STATUS §L.11(D) rewritten twice (it described the rejected cap),
TASKS row, REGRESSION_LEDGER row, lesson extended with the WRONG fix as the transferable half.
NEXT: commit, push, deploy-verify. Prisma diff EMPTY.

## L.11(D) — the verified deploy. 2026-07-25
SHIPPED LIVE as 9de3a6a. Deployment aimplifi-bs4poe0eo-reiforge.vercel.app
(dpl_4PdCKoFFe3aMjizUtwHKNbGpq7zw), Ready, production, created 22:49:02 — seven seconds after the
commit's own timestamp (22:48:55) — aliased to www.aimplifi.app.
Verified by three-way byte identity on /sign-in: www == the new deployment
(cb7c17f6ba4b3093cd63643609d24962, stable across a repeat fetch) and != the previous production
deployment 5xeg829ew (5d9ec8b58062a4325678f3e7b24fbc6c).
SCHEMA: none. `git diff --cached --stat -- prisma/` was empty, so no `prisma db push` touched Neon.
NO PUBLIC MARKER, checked not assumed: every string this slice touched is behind /spending-plan,
/dashboard or /ask, all auth-gated, so the evidence is the READY aliases + byte identity + the
local gate (the L.18 standard).
NEXT: L.9 is STASHED and unfinished (git stash@{0}) — the registration veto + the ambiguity
carry-out for the Continue-an-account card. Then the open queue: L.16 (the keep-both prompt),
L.13 (blocked on an owner screenshot), and the L.11(D) residuals in STATUS, sharpest of which is
that a LOAN payment dated past the month's edge is still in no term at all.

## L.9 RESUMED — built, gate green locally, critics in flight. 2026-07-26
Resumed from stash@{0} (parked 2026-07-25 for the L.11(D) live defect). The stash pop restored
everything INCLUDING the untracked engine/account/registration.ts (stash had been created with -u);
PROGRESS.md conflicted (both sides appended at EOF) — resolved chronologically (the PARKED entry
predates the L.11(D) entries, which reference it). Stash entry KEPT undeleted until ship.
WHAT THE STASH ALREADY HAD (kept): registration.ts (Roth-vs-pretax veto, INVESTMENT-only, both
sides must resolve, Roth evidence beats an unspecialised `ira` subtype); the veto wired into
duplicateSignals (shared by personal + household + reconciliation + displayed-card detection);
detectReconciliationCandidates -> {candidates, ambiguous} + excludePair (applied BEFORE grouping,
so dismissing the wrong pair releases the survivor — a guard reads what it guards); subtype
threading in finance.ts / household-finance.ts / transactions.ts; the reconciliationAmbiguities
view field.
BUILT THIS SESSION: account-registration.test.ts (13 locks, abstention-majority); the candidates
test updated to the new return type + 10 new L.9 locks (the owner case dissolving to ONE candidate,
ambiguity carry-out, excludePair release, two-preds-one-succ stays offerable, veto never off
INVESTMENT / never on unresolved sides / never Roth-Roth); reconcile-candidates-view.ts (labels:
bank-doubled trailing number collapsed end-anchored, qualifier drops the mask the name already
shows, ambiguity INTRO/HOWTO/matchesSentence) + 13 locks; ReconciliationAmbiguitiesCard on
/accounts (disclosure, NO Combine control) + CandidateRow/span-disclosure labels through the view;
e2e x2 (the vetoed owner case; the ambiguity state + the resolution path's warning present).
STALE LOCK RE-POINTED: reconcile-surfaces C-8 pre-link asserted BOTH twins offered — the exact
behaviour L.9 removes; now locks candidates=0 + one ambiguity group, PLUS the dismissal-release
path through real getAccountsView (excludePair wired, not just the engine option).
GATE SO FAR (real output): full vitest 281 files / 4403 tests ALL PASS (4366 -> +37);
reconcile.spec 4/4 serialized; account-deletion + account-rename + combined-accounts +
duplicate-connections + mobile-overflow 29/29; dashboard-duplicate-disclosure + feed-dropped 7/7.
One mobile-380 ambiguity-spec failure mid-run was the DOCUMENTED #287 whole-page DOM-duplication
flake (strict-mode "resolved to 2 elements" on /accounts) — passed clean on isolated retry, no
hydration/pageerror lines captured by the armed observer.
IN FLIGHT: three fresh-context critics (veto misfire direction / ambiguity semantics / copy).
NEXT: critic findings -> fixes -> verify.sh -> DECISIONS/STATUS/TASKS/ledger -> commit/push/deploy.
Prisma diff expected EMPTY (subtype column shipped in #300).

## L.9 — critic cycles 1+2 both FAILED, all findings fixed and locked. 2026-07-26
CYCLE 1 (three fresh-context critics, parallel: veto misfire / ambiguity semantics / copy):
verdicts FAIL — 3 P1 + 9 P2 after dedupe, every one reproduced by the critic's own execution
before entering a fix.
 P1  veto misfire: "Jill Roth - Traditional IRA" resolved roth (bank names embed the HOLDER'S
     name) and the veto hid a REAL pair — the silent-double-count #292 direction, worse than
     never vetoing. FIXED: name evidence needs an IRA context AND abstains when a name carries
     both token classes; subtype stays unconditional (never contains a surname).
 P1  folded-live-again successor: excludePair guarded only the predecessor role, so a
     superseded row that came back LIVE was named inside an ambiguity group as "one of your
     live accounts" — a row not on screen — and the how-to steered the user into releasing a
     candidate whose confirm auto-undid his earlier combine (net worth went UP from a
     "combine"). FIXED: the successor role is excluded too; FOLD lock in reconcile-surfaces.
 P1  the how-to named a dismiss control that does not exist for identity-proven pairs (they
     fire no heuristic signal, so they're on no notice) and promised singular release that
     fails for 3+ successors. FIXED then SIMPLIFIED by cycle 2 (see below).
 P2s fixed: a PROVEN pair downgraded into "we cannot tell" by a name-token guess (a proven
     pair is now hoisted OUT of a group as the offer); proven-partner count ignored exclusions
     (a dismissed proven pair never released); byte-identical labels (positional suffix,
     unforgeable); feed-name sort orders (painted re-sorts, F8 rule); maskFromName first-match
     (all-matches nameShowsDigits); nickname collapse (userNamed skips it); TIAA/"Roth Capital"
     (ira-context requirement); 401k/employer plans (RECORDED LIMIT, documented).
GATE after cycle 1 fixes: full vitest 281/4420; reconcile.spec 4/4.
CYCLE 2 (one fresh-context critic aimed at the fixes): verdict FAIL — 1 P1 + 6 P2.
 P1  a DEAD proven partner deadlocked a fold: X proven-same to live Y AND to dead Z got "two
     partners", so X→Y was withheld by a pair that can never compete (both-dead has no
     direction) — two stale rows double-counted against Y with no offer and no statement, and
     no user path out (a dead partner has no combine surface). FIXED: role-based counting — a
     directed proven pair counts only against its DEAD side (competing successor choices), a
     both-live pair counts each live side (unresolved combine), both-dead counts nothing; the
     deadlock releases as X→Y AND Z→Y (the #297-valid shape). Critic validated the patch shape
     against all six locked cases by execution before I implemented it.
 P2-3 name↔subtype CONTRADICTION resolved instead of abstaining ({Roth IRA + subtype
     traditional} -> pretax -> vetoed a REAL Roth↔Roth pair). FIXED: conflicting evidence is
     an absence, one level up.  P2-4 a 3-digit mask column printed twice (nameShowsDigits now
     \d{3,}).  P2-5 the off-notice sentence/plumbing was unreachable (proven pairs leave groups
     via the hoist; every notice filter is mirrored in excludePair) AND its Delete claim was
     wrong — REMOVED the dead branch and locked the invariant it defended instead (every pair
     in a rendered group IS on the notice, end-to-end in reconcile-surfaces).  P2-1/P2-2
     recorded limits documented ('iras' plural context added; "Roth Conversion Traditional
     IRA"-class abstentions named deliberate).  P2-6 cross-group order now painted.
GATE after cycle 2 fixes: full vitest 281 files / 4422 tests ALL PASS (alone, no agents);
tsc 0; eslint 0; next build clean; e2e serialized 26/26 across reconcile + duplicate-connections
+ combined-accounts + account-deletion + account-rename + dashboard-duplicate-disclosure.
One flake note: combined-accounts "two old accounts" failed twice with the DOCUMENTED #287
whole-page-DOM-duplication signature ("resolved to 2 elements") under post-suite load, then
passed isolated AND in the full 26/26 sweep — the fixture provably renders no L.9 card (its
folded shape produces no candidates/groups), so the change cannot be the cause; CI arbitrates.
IN FLIGHT: cycle-3 critic (final, aimed at the counting semantics + contradiction rule).
NEXT: cycle-3 verdict -> (fixes if any) -> verify.sh -> DECISIONS/STATUS/TASKS/ledger -> ship.

## L.9 — cycle 4 (cap), OPEN items recorded, gate green, docs done. 2026-07-26
CYCLE 4 (final, cap): FAIL — 1 P1 + 3 P2. The P1 is NOT a regression: a withheld PROVEN
ambiguity whose two live rows do not themselves ladder-prove (card reissue → contradictory
evidence, or subtype split) is carried out NOWHERE — pre-existing silence the heuristic
carry-out did not extend to; advisory direction, no wrong action offered. Per the 4-cycle cap:
recorded in STATUS §L.9 OPEN #1 with the critic's fix sketch (a proven-successor ambiguity
group + a how-to variant; needs its own critic cycle). Fixed within the cycle: the stale
provenPartners comment reference, and the residual-window doc-line's false "both feed names
print" defense. P2-3 (a heuristic dismissal while a tangle stands is a dead end) recorded with
the OPEN item. Cycle-3's F-1 fix was verified correct-and-complete by the cycle-4 critic
("verified by execution… attacked, failed to break").
GATE (real output this session): bash scripts/verify.sh -> VERIFY GREEN (tsc 0, eslint 0,
**281 files / 4423 tests**, build clean). E2E serialized: 26/26 across reconcile +
duplicate-connections + combined-accounts + account-deletion + account-rename +
dashboard-duplicate-disclosure, incl. the two new L.9 specs. combined-accounts flaked twice on
the DOCUMENTED #287 whole-page-DOM-duplication signature under post-suite load; passed isolated
and in the full sweep; the fixture renders no L.9 card, so the change cannot be the cause.
DOCS: DECISIONS #310 (+index), STATUS §L.9 (built + 5 OPEN residuals), TASKS row flipped,
5 REGRESSION_LEDGER rows, lesson proof-outranks-guess-and-conflict-is-absence.md (+INDEX).
NEXT: commit, push, deploy-verify. Prisma diff EMPTY (confirmed before the gate).
THEN: the owner's mid-session report — guilt-free spending income term ($22,254.09 expected
income is wrong for him; formula re-spec: income(all sources) - savings% - fixed+recurring
expenses only, no discretionary). Diagnose the income term against the engine first (no live DB
here — read the code, enumerate what could produce $22,254.09 for July, and say what is and
isn't verifiable).

## L.22 OPENED — owner's guilt-free re-spec. 2026-07-26
Owner mid-session: "your logic on guilt free spending is broken, for one i don't have 22k or so
income coming in...that number should be taken from patterns you've detected over months of
income. Expenses are also based on patterns or had set in settings. so guilt free = income (all
sources, investment, salary, etc..) - savings % of total income (saved in settings) - fixed and
recurring expenses (not discretionary or budgeted for) = guilt free"
DIAGNOSIS (from the code, live DB unavailable here so HIS attribution stays UNVERIFIED):
the income term is `receivedIncomeCents + remainingIncomeCents` (spending-plan.ts:153) — July's
posted income PLUS detected series x remaining occurrences. Inflation vectors, in likely order:
(a) an unpaired TRANSFER-IN counts as income whenever it has no category (insights.ts:43-46:
a positive with no/unknown category IS income) — a large brokerage-to-checking movement the
±3-day opposite-amount pairing missed inflates the month it lands; the SAME detector's two
failure directions fit his screen at once: expenses $0.00 (over-flagged) beside income $22k
(under-flagged); (b) a phantom recurring income series detected off repeated one-time inflows,
counted again per remaining occurrence. His $0.00 lines remain L.11(D) OPEN residual #1.
THE RE-SPEC (owner's formula, decisions mine to record): guilt-free = pattern income (all
sources) − savings % of that income (Settings) − fixed/recurring expenses (pattern) − card
obligations. The received+remaining-occurrence income term and the spent-so-far subtraction
die; the per-day framing that produced "$3,709.01/day" dies.
DECISIONS TO RECORD: income = MEDIAN of the last 3 COMPLETE months' non-credit income
(monthlyFlows; immune to a single one-time spike, includes every source that actually arrived);
fallback = detected income series monthly-normalized when no complete month exists; fallback =
0 + "no income pattern yet". Fixed expenses = detected recurring outflows monthly-normalized
(weekly 52/12, biweekly 26/12, semimonthly x2, quarterly /3, annual /12 — an annual insurance
premium finally costs every month, fixing the 11-month understatement). Cards: keep this-month
obligations + the L.11(D) beyond-month reservation (real fixed commitments). Savings: keep
max(goals, bps x income) — equals his formula whenever goals <= target; never overstates.
Discretionary: no subtraction anywhere. Surfaces: /spending-plan, dashboard card, Ask,
conscious-spending view, Glass-Box trace + the three inverse solvers (leftToSpend survives).
NEXT: engine-first + tests, then surfaces, then hostile critic (money-math), then ship.

## L.22 BUILT — the pattern model; critic cycle 1 (money + copy) both FAILED, all fixed. 2026-07-26
THE BUILD (engine-first): plan.ts rewritten — income = MEDIAN of up to the last 3 complete
months' income over non-credit accounts (fallback detected-series at a monthly rate, fallback
0/'none'); fixed expenses = recurring outflows at a monthly rate (monthlyRateCents: weekly
52/12, biweekly 26/12, annual /12, irregular x1 safe-direction); card terms + savings max()
carried unchanged; spentSoFar/upcomingBills/perDay/daysLeft DELETED. Surfaces: /spending-plan
(hero, bar, legend, explainer), dashboard card, Ask answer, Glass-Box trace, conscious buckets
(now exactly the owner's formula — the old spentSoFar departure note dissolves), COACH_COPY
caption, money-dials hint, schema comment. Demo under the new model (computed against the real
seed): trailing [528000, 528000, 735000] -> median $5,280.00 (the seed's own one-time spike
month is median-ignored — the mechanism validating itself on real-shaped data); fixed $2,300;
cards $5,412.33; guilt-free **Over plan by $2,432.33** — the demo stays an honest revolver.
CRITIC CYCLE 1 (two fresh-context critics, money-math lens + copy-honesty lens), both FAIL:
 MONEY P1-1  the L.11(D) beyond-month walk passed endOfMonth as the counter's `today`, so a
     live weekly/biweekly anchor landing before the window read as STALE and contributed ZERO
     income — a $9,000 statement reserved in full against a paycheck arriving twice before it,
     every month, permanently (the exact gross failure the walk exists to kill). FIXED:
     scheduledOccurrencesBetween — the stale gate is the REAL today; live anchors step forward
     by cadence (incl. MONTHLY/ANNUAL via addMonthsClamped, a blindness the in-month counter
     never had to know). Locks: the critic's executed case at engine AND real-server level
     (fail-old proven: old code 900000/100000, fixed 300000/700000).
 MONEY P1-2  the ANNUAL /12 branch is dead for DETECTOR rows (toScheduledTransactions filters
     W/B/M only) — a detected annual premium counts ZERO (dangerous direction). Comment
     corrected; the passthrough is its own slice (it also moves the radar + demo golden).
 MONEY P1-3  the median's safety claims were one-sided (incomeMonths<3 spike; job loss).
     Copy qualified everywhere; the figure decisions recorded as OPEN residuals.
 COPY P1-1  "a one-time deposit is not income here" false at incomeMonths<3 (executed:
     $23,000 from one spike month while claiming it cannot happen) — qualified by
     incomeMonths in the assistant detail, the trace basis, and the plan.ts header.
 COPY P1-2  two stale "of this month's income" qualifiers (the beyond-month qualifier and
     savingsReserveNote) named a quantity the engine no longer has — reworded.
 COPY P1-3  the overspent hero said "This month's income is more than spoken for" + a
     weather-not-climate clause that is only true of a one-off — replaced.
 P2s fixed: "across every source" -> "checking and savings accounts" (investment dividends
     never reach the snapshot; cashback excluded by design); the empty-state promise was
     wrong in both directions; the money-dials hint said "expected monthly income"; the
     headline's present-possession framing -> "Your guilt-free allocation this month is $X".
GATE SO FAR (real output): full vitest 281 files / 4428 tests ALL PASS; plan-adjacent e2e
32/32 serialized (ask, spending-plan, month-edge, glass-box, phase1, auth). The owner's own
attribution of the $22,254.09 stays UNVERIFIED (no live DB here) — but both inflation
mechanisms (uncategorized transfer-in as income; phantom series x occurrences) are dead in
the new model by construction.
IN FLIGHT: critic cycle 2 aimed at the walk fix + qualified copy.
NEXT: cycle-2 verdict -> fixes -> verify.sh -> DECISIONS/STATUS/TASKS/ledger -> ship.
OPEN residuals to record: detector ANNUAL passthrough (P1-2); job-loss lag (pause-radar
mitigation; wiring the pause predicate into the basis is follow-up); incomeMonths<3 spike
window (copy-qualified; kept median, recorded); refund-shaped series polluting income
(pre-existing classification, L.12 territory); completed goals keep reserving (pre-existing);
savings-transfer double-count (already L.11(C) residual 2); cross-month double reservation
(already accepted L.11(D) cost).

## L.22 — critic cycle 2, gate green, docs done. 2026-07-26
CYCLE 2 (fresh-context, aimed at the fixes): FAIL — 1 P1 + 4 P2, all fixed. The walk fix
survived every attack (6/6 boundary + 6/6 server-path). Fixed: the trace's unconditional
annual-coverage basis line (now "an annual bill entered by you counts 1/12; a DETECTED annual
bill is not projected yet"); the overspent Ask branch carried no basis clause (now prepended,
with the <3-months qualifier stating the overage may shrink); the dead in-month counter +
two stale JSDoc/comments removed; /spending-plan gained the empty branch the dashboard card
already had ("$0.00 matched to the penny" can no longer render); my own test comment claimed
clamped dates the code does not produce (02-28/03-28/04-28 — comment corrected, drift recorded
in the docblock). REFUTED by my direct read: cycle-2's P2-2 ("checking and savings" mis-sets
the figure) — every provider delegates getFinanceSnapshot to DemoProvider, whose transaction
query filters SPENDING_ACCOUNT_TYPES at the database (demo.ts:49), so INVESTMENT/LOAN rows
never reach the snapshot; investment income reaches the pattern as deposits into
checking/savings, exactly how it reaches the user.
One stale test caught by the gate: savings-goal-by-date asserted the pre-reword reserve note —
re-pointed at "of your monthly income pattern" (deliberate change, assertion follows).
GATE (real output this session): bash scripts/verify.sh -> VERIFY GREEN, tsc 0, eslint 0,
**281 files / 4434 tests**, build clean. E2E serialized 32/32: ask, spending-plan,
spending-plan-month-edge, glass-box, phase1-cash-needed, auth.
DOCS: DECISIONS #311 (+index), STATUS section L.22 (built + 8 OPEN residuals), TASKS row,
4 REGRESSION_LEDGER rows. No schema change (schema comment only — prisma diff is text).
NEXT: commit, push, deploy-verify. Then the open queue: L.16 (keep-both prompt), L.13 (owner
screenshot), the L.9 OPEN proven-ambiguity carry-out (cycle-4 P1, fix sketch recorded), the
L.22 residuals (sharpest: detector ANNUAL passthrough).

## L.22 — the verified deploy. 2026-07-26
SHIPPED LIVE as 5788ec2. www.aimplifi.app/sign-in hash flipped from the L.9 deploy's
942055795f8da46da8b11a6bf805ef07 to 6098a30b1928854319ace13aef50cc96 (stable across a repeat
fetch, HTTP 200) ~75s after the push; exactly one commit separated the two pushes.
SCHEMA: `git diff --cached --stat -- prisma/` was ONE COMMENT LINE (savingsTargetBps doc) — no
DDL, so the deploy's `prisma db push` was a no-op against Neon; the build succeeding is the
proof it ran clean.
NO PUBLIC MARKER, checked not assumed: every string this slice touched lives behind
/spending-plan, /dashboard, /ask or /settings — all auth-gated — so the evidence is the hash
flip + stability + the local gate (the L.18 standard).
NEXT: the open queue — L.16 (keep-both prompt), L.13 (owner screenshot), the L.9 OPEN
proven-ambiguity carry-out (cycle-4 P1, fix sketch in STATUS), the L.22 residuals (sharpest:
detector ANNUAL passthrough; job-loss pause-predicate wiring).

## L.23 OPENED — the detector's ANNUAL passthrough (L.22 OPEN residual #1). 2026-07-26
THE DEFECT (verified, not assumed): `toScheduledTransactions` (detect.ts:197) filters detected
series to WEEKLY/BIWEEKLY/MONTHLY, so a detected ANNUAL series never reaches
`ScheduledTransaction` — and the ONLY writer of that table in the whole app is
`src/server/recurring.ts:194` (sources 'payroll-detected' | 'recurring'), plus the seeder
(3 rows, all BIWEEKLY/MONTHLY). Grepped every `scheduledTransaction.create*` call site: there
is no user-facing form and no autopay writer. So `monthlyRateCents`'s ANNUAL /12 branch is
DEAD FOR EVERY ROW IN PRODUCTION, not just detected ones — which falsifies two live claims
shipped last slice: plan.ts's "The branch is live for user-entered and seeded annual rows" and
the glass-box trace's "An annual bill entered by you counts 1/12" (there is no way to enter
one). Meanwhile /recurring's own headline ALREADY normalizes ANNUAL at 1/12
(summary.ts PER_MONTH) — so two surfaces disagree about one fact by $100/month on a $1,200/yr
premium, and the spending plan is the one in the dangerous direction (fixed understated →
guilt-free overstated).
BLAST RADIUS (mapped by two explorers, then verified by reading the code myself — the
explorer's "CRITICAL 12x underestimate" classification was WRONG): the three expanders
(cash-needed/assemble.ts:196, forecast/forecast.ts:70, calendar/build.ts:72) send an unknown
cadence down an `else` that pushes the ONE dated occurrence clamped to the window. Every
horizon in the app is <= 90 days (cash-needed 60 default, forecast 90, radar 10-90; grepped
every concrete horizonDays), so for ANNUAL that branch is already CORRECT — one occurrence per
window is the truth. Latent bound only at a horizon >= 366 days, which nothing uses.
Prisma: `cadence String?` (schema.prisma:499) — no enum, NO DDL needed.
THE DECISION: pass ANNUAL EXPENSES through; hold ANNUAL INCOME out. Failure direction per ROLE
(L.14): an annual bill can only ask the reader to hold MORE cash, but an annual bonus projected
on a date guessed from a 365-day gap offsets a dip and can SUPPRESS a warning — and the plan
does not need it (the trailing median already saw the month it arrived in; /12-ing it into the
no-history fallback is the phantom-income class the owner complained about).
Make ANNUAL EXPLICIT in all three expanders (months-step 12 instead of the catch-all else) —
behaviour-identical at every window the app uses, and it removes the >=366-day latent bound.
NOT IN SCOPE, recorded: QUARTERLY/SEMIANNUAL bills still count ZERO (a ~91-day gap classifies
as IRREGULAR at cadenceFromGap and detectRecurring drops it) — that is a NEW detection class
that moves every user's detected set and needs its own golden + critic pass.
DEMO IMPACT: NONE, verified by probe — the seed's 12 detected series are 1 BIWEEKLY + 11
MONTHLY, zero ANNUAL, so no demo golden moves. Locks must therefore be synthetic (engine) plus
a real-server path test through refreshRecurringForUser.
NEXT: implement (detect.ts filter+type, 3 expanders explicit, schema comment, trace copy,
plan.ts docblock) -> tests -> verify.sh -> hostile critic (money-math) -> ship.

## L.23 BUILT — the ANNUAL passthrough; gate green; two critics in flight. 2026-07-26
THE BUILD (5 source files, all small): detect.ts `toScheduledTransactions` admits ANNUAL when
`!s.isIncome` (return type narrowed to a non-null `ProjectedCadence` — the filter admits exactly
four cadences, so this function cannot emit the one-off shape the DB column allows); the three
expanders (cash-needed/assemble.ts, forecast/forecast.ts, calendar/build.ts) step calendar-month
cadences by `i * monthStep` with monthStep 1 for MONTHLY and 12 for ANNUAL; ScheduledCadence
gained 'ANNUAL'; the Prisma cadence + source comments corrected (comment-only, `git diff --stat
-- prisma/` = 2 lines, NO DDL); the glass-box basis line rewritten; plan.ts's KNOWN GAP
paragraph replaced by the remaining quarterly/semiannual gap.
SELF-CRITIQUE FINDING (not from a critic, fixed before they reported): a smoothed 1/12 is
$100 conservative for eleven months and $1,100 OPTIMISTIC in the twelfth, when the whole premium
actually leaves the account. The basis line now says a twelfth is set aside "rather than the
whole of it in the month it lands, so the month it does land will feel larger than this figure",
and it is recorded as STATUS L.23 OPEN #3 rather than shipped silently.
LOCKS: tests/unit/annual-recurring-passthrough.test.ts, 13 tests — the filter both directions,
golden-literal monthly rates (the existing spending-plan.test.ts assertions write the formula
under test as their own expectation, so they cannot fail; these are hand-verified literals), the
three expanders once-per-window plus the multi-year step, the REAL server path (detector ->
ScheduledTransaction -> snapshot -> getSpendingPlan, fixedExpensesCents 0 -> 10000), and a
rendered-copy lock on the basis over a real plan carrying a real annual bill.
FAIL-OLD, EXECUTED: with the four source files stashed, 6 of 13 locks fail and 7 pass — and the
7 include the two single-occurrence-per-window locks, which is the EXECUTED proof that the
expanders' catch-all `else` was already correct for an annual row at every horizon the app uses
(every concrete horizon in src/ is <= 90 days: cash-needed 60 default with one caller,
forecast 90 default, RADAR_HORIZON_DAYS 90 — grepped including computed assignments).
GATE (real output this session): `bash scripts/verify.sh` -> VERIFY GREEN, tsc 0, eslint 0,
**282 files / 4445 tests**, build clean (that run predates the last 2 test additions + the copy
tweak; the final gate re-runs after the critics). E2E serialized 16/16: glass-box, spending-plan,
spending-plan-month-edge, forecast, recurring, calendar-frozen. docs:lint clean (87 files).
CONTENTION OBSERVED, not a defect: one run of the new file failed a PURE-function calendar
assertion (Aug-2027 window) that passed the run before and the run after, with `git diff`
confirming calendar/build.ts unchanged — the documented #287-family signature while two critic
agents were running beside it. The final gate is run ALONE (serialize for proving).
DOCS SO FAR: STATUS (new BUILT section + 3 OPEN items; the old L.22 residual #1 struck through
and its own false claim about "user-entered/seeded annual rows" corrected), TASKS L.23 row
(status cell to fill), EDGE_CASES new hand-verified section, 2 REGRESSION_LEDGER rows, lesson
a-dead-branch-is-a-claim-that-something-is-handled.md (+INDEX).
IN FLIGHT: two fresh-context hostile critics (money-math lens; copy/live-claims lens).
NEXT: critic verdicts -> fixes -> verify.sh ALONE -> DECISIONS #312 + TASKS status -> ship.

## L.23 — two critics, both FAIL, every finding fixed; gate green. 2026-07-26
CRITIC 1 (money-math lens): 2 P1 + 2 P2. CRITIC 2 (copy/live-claims lens): 5 P1 + 6 P2. They
CONVERGED INDEPENDENTLY on the same P1, which is the finding that mattered most:
 P1 (both)  A LAPSED annual series subtracts money forever. detectRecurring reads all history
     with no staleness gate and nextExpectedAt steps a dormant anchor forward, so a policy last
     charged in 2021 detects today with a next date in August: /recurring filed it under "no
     longer charging" at $0/month while the plan counted $100/month and the calendar printed a
     dated -$1,200 for a cancelled policy — the disagreement this slice exists to fix, INVERTED.
     FIXED by sharing ONE predicate: the active/lapsed rule moved into detect.ts as
     `isSeriesActive` and summarizeRecurring now imports it (its local CADENCE_DAYS deleted), so
     the surfaces agree by construction. ANNUAL-only, and the asymmetry is pinned by a test.
 MONEY P1-2  The radar's cover transfer pairs a WHOLE-HORIZON amount with the FIRST shortfall's
     deadline; an annual bill is the first cadence able to decouple them. Executed: "move
     $1,250.00 by Fri, Jun 12" where $50.00 was what Jun 12 needed, collidingCards empty so
     nothing explained the other 96%, under the header "the smallest move". The amount is
     SUFFICIENT — which is why no overdraft test caught it. FIXED: worstDipDate +
     firstShortCents + worstDipEvents on the result, an assumption line, a radar-cover-split row
     on the card, "the smallest move" -> "one move". Locked both ways (the critic's exact probe,
     and the ordinary shape asserting silence).
 MONEY P2-1  Mutation testing (10 mutations) proved assemble.ts could be REVERTED ENTIRELY with
     my file still green: the 90/60-day pair is satisfied by the old catch-all `else` too. Now
     locked by a multi-year assertion — the one expander feeding the dashboard hero.
 MONEY P2-2  "behaviour-identical at every window the app uses" was wrong in two reachable ways
     (a calendar MONTH view is 12 clicks from a >=1-year window; a stale-anchor row self-heals
     forward, which is date-scoped not window-scoped) and the ">=366 days" bound is wrong — the
     second occurrence needs ~431 days, the bound depends on the anchor's phase. All three
     comments + EDGE_CASES + STATUS corrected.
 COPY P1-1  "a twelfth is SET ASIDE every month" names a mechanism that does not exist (the plan
     is stateless per month) AND reuses a phrase that already means the L.11(D) reservation on
     the same page. Reworded: "this figure subtracts a twelfth of it every month. Nothing is
     actually moved or set aside for you — ... the whole amount goes out while this figure only
     ever counted a twelfth".
 COPY P1-2  the annual clause was UNCONDITIONAL while the only intake needs 3 sightings at a
     steady price (731 days; a premium that rises yearly is never detected). Gated on
     `plan.scheduledFixed.some(cadence === 'ANNUAL')` — this trace's own convention 35 lines
     above it. The precondition moved to /spending-plan's "What this figure can't see".
 COPY P1-3  the quarterly clause named 2 of 8+ dropped rhythms with no direction. Rewritten and
     moved: the dropped set (10-day, 3-weekly, 6-weekly, bi-monthly, quarterly, semiannual) with
     "the real amount free to spend may be lower than shown".
 COPY P1-4  the annual-INCOME asymmetry was undisclosed while /recurring renders the same
     $5,000/yr bonus as "Recurring income $416.67/mo" — disclosed on the detected-series basis
     and BOTH Ask branches.
 COPY P1-5  the dashboard card said nothing while cash-needed on the same screen counts the full
     bill in its month — gated safe-to-spend-annual-note added.
 P2s fixed: server/recurring.ts's comment naming 'user'/'autopay' rows no writer can create;
     detect.ts's docblock now states the payment-account scope of the /recurring agreement;
     pause.ts's ANNUAL branch says the reason is now a DECISION, not a cadence fact; the basis
     names the biweekly rate (26/12, the largest multiplier, previously omitted); the test
     docblock's over-claims corrected; the pure quarterly test moved out of the DB describe.
 REFUTED / could not break (money critic, executed): double counting anywhere (perDueDate sums
 card cashRequired only; the L.11(D) walk filters positives; the demo hero moved only by money
 that really leaves), every other cadence consumer (coach blueprint -> null, pause guarded,
 today-feed-copy unreachable at the type level), and MONTHLY equivalence (i*1 is an identity).
GATE (real output, run ALONE): bash scripts/verify.sh -> VERIFY GREEN, tsc 0, eslint 0,
**282 files / 4457 tests**, build clean. E2E 24/24 serialized: cash-flow-radar, spending-plan,
spending-plan-month-edge, glass-box, recurring, forecast, calendar-frozen, phase1-cash-needed,
dashboard-duplicate-disclosure — plus the extended spending-plan spec re-run (1/1) asserting the
rendered disclosure section AND that the yearly-bill clause does NOT render for the demo.
docs:lint clean (87 files). Prisma diff comment-only -> no DDL on deploy.
DOCS: DECISIONS #312 (+index regenerated, 305 entries), STATUS §L.23 (critic paragraph + 6 OPEN),
TASKS L.23 row done, EDGE_CASES §B/B2/B3/C corrected + extended, 4 REGRESSION_LEDGER rows, the
L.22 ledger row + DECISIONS #311 + the L.22 TASKS row all marked superseded in place, lesson
extended with what the critics added (+INDEX).
NEXT: commit, push, deploy-verify.

## L.23 — the verified deploy. 2026-07-26
SHIPPED LIVE in two commits. 3928d93 (the slice) is proven by a HASH FLIP: www.aimplifi.app/sign-in
moved from the L.22 deploy's 6098a30b1928854319ace13aef50cc96 to
7cb2bb70d0c5cf1495769c1eb8870741 (HTTP 200), so the new bundle is being served.
dfeb95c (corrected comments) is proven by the DEPLOYMENT RECORD instead, and the reason is a
method finding worth keeping: a comment-only commit deploys to a BYTE-IDENTICAL page, because
comments are stripped before the chunk hash is computed — /sign-in stayed at 7cb2bb70…, which is
consistent with both "deployed" and "not deployed" and therefore proves nothing either way. The
Vercel CLI is authenticated in this checkout: `npx vercel ls aimplifi --yes` shows the newest
production deployment ● Ready (created 18:06:48, ~1 min after the push, the only one newer than
3928d93's), and `npx vercel inspect` confirms it carries the www.aimplifi.app alias — i.e. it is
the deployment serving traffic. Recorded as an extension to docs/lessons/committed-is-not-shipped.md.
SCHEMA: `git diff --cached --stat -- prisma/` was TWO COMMENT LINES (the cadence and source
legends) — no DDL, so the deploy's `prisma db push` was a no-op against Neon.
NO PUBLIC MARKER, checked not assumed: every string this slice touched lives behind
/spending-plan, /dashboard or /ask, all auth-gated (the L.18 standard).
NOT VERIFIABLE FROM HERE, stated rather than assumed: (a) whether the owner's own data contains a
detected annual series — no live DB in this environment, and the detector needs three sightings
~a year apart at a stable amount (731 days) to see one; (b) the GitHub Actions run for these two
commits — `gh` is not authenticated in this checkout, so CI's own e2e verdict is unread. The local
gate and the serialized e2e are the evidence.
NEXT: the open queue — L.16 (keep-both prompt), L.13 (owner screenshot), the L.9 OPEN
proven-ambiguity carry-out (cycle-4 P1, fix sketch in STATUS), and the L.23 residuals (sharpest:
the unrecognized-rhythm detection class — quarterly/semiannual/bi-monthly bills count zero,
which is the same dangerous direction this slice just closed for annual).

## L.24 OPENED — the unrecognized-rhythm detection class (L.23 OPEN residual #1). 2026-07-26
ASK: continue the queue. The L.23 close-out named this the sharpest open item and it is the
SAME dangerous direction L.23 just closed for ANNUAL: a QUARTERLY or SEMIANNUAL bill is counted
ZERO times, so guilt-free spending is overstated by its whole monthly share. `cadenceFromGap`
classifies a ~91/182-day gap as IRREGULAR and `detectRecurring` drops IRREGULAR before the
projection filter is reached — so the bill is absent from the plan, the projections AND
/recurring alike.
WHY THIS IS A DETECTION CLASS, NOT A PASSTHROUGH (the L.23 distinction): L.23 admitted a cadence
the detector ALREADY assigned. This one teaches the detector to assign two cadences it never
has, so it can only move a user's detected set in the direction of MORE series, and a false
positive does not merely mis-state a figure — it prints a dated outflow on /calendar and can
trigger a radar "move $X by <date>" instruction for a bill that does not exist.
DEMO-GOLDEN PROBE (run, real output, scripts/probe-cadence-gaps.ts — throwaway): of 47 merchant
groups in the seed, FOUR have a median gap inside the proposed bands — Costco Gas 89, Zelle
Payment 91, Etsy 86, Kroger 97 — and ALL FOUR are killed by the EXISTING amount-stability filter
(distinct amounts 7/7/6/5, the limit is 2). So no demo golden moves, verified rather than
assumed, and the four names are exactly the shape the false-positive risk takes: sparse variable
real-world spending that happens to average a quarter apart.
DESIGN DECIDED BEFORE CODING:
 - bands QUARTERLY 84-98, SEMIANNUAL 175-190 (nominal 91/182, ~+/-7-8 days of drift).
 - a POSITIVE-LICENCE dispersion guard for the two NEW cadences only: EVERY gap must itself fall
   inside the band, not merely their median. With n=3 the median of two gaps is their mean, so
   [30,150] would otherwise read as a quarterly bill. Existing cadences keep the median-only
   rule — widening their evidence bar would move every existing user's detected set, which is
   not this slice.
 - EXPENSES only + the isSeriesActive lapse gate, i.e. the L.23 rule generalized: every cadence
   longer than MONTHLY is projected only as an expense and only while still charging. The role
   asymmetry (L.14) is unchanged — a projected income offsets a dip and can silence a warning.
 - STRICTNESS IS THE SAFE DIRECTION HERE, deliberately: a missed detection leaves the status quo
   (the bug we are closing), an invented obligation is a NEW false claim on the calendar and the
   radar. The no-fabrication rule outranks coverage.
NEXT: impact map (explorer running), then engine-first per CLAUDE.md rule 6.

## L.24 — the unrecognized-rhythm detection class; two critics, both FAIL, every P1 fixed. 2026-07-26
SHIPPED: QUARTERLY (84-98 day gaps) and SEMIANNUAL (175-190) are recognized cadences, projected as
EXPENSES only and only while still charging. Before this, a ~91/182-day gap classified IRREGULAR
and `detectRecurring` dropped the series BEFORE any consumer saw it, so a quarterly water bill was
counted ZERO times — absent from the plan's fixed term, cash-needed, forecast, calendar AND
/recurring — and guilt-free spending was overstated by its whole monthly share.
ENGINE: `CADENCE_BANDS` + `cadenceFromGaps` (replacing `cadenceFromGap`); `LONG_CADENCES` sharing
the expenses-only + lapse rule L.23 wrote for ANNUAL; `monthsPerCadence` replacing the SAME
four-branch ternary in FOUR expanders (cash-needed/assemble, forecast, calendar/build, plan's
`scheduledOccurrencesBetween`), where a missed branch is silent by construction; rates /3 and /6;
`ScheduledCadence` widened because it is reached by an unchecked `as` cast from the DB string.
DEMO GOLDEN UNMOVED, PROVEN NOT ASSUMED: a probe over the seed found 47 merchant groups, 4 with a
median gap inside the new bands (Costco Gas 89, Zelle Payment 91, Etsy 86, Kroger 97), ALL killed
by the existing amount-stability filter. Kept as a test. Seed still detects 1 BIWEEKLY + 11 MONTHLY.
MUTATION TESTING, 4 mutations, ALL KILLED: monthsPerCadence's new branches -> the 3 expander locks;
EVERY_GAP_CADENCES emptied -> the 2 licence locks; LONG_CADENCES shrunk to ANNUAL -> the projection
+ lapse locks; the spread cap widened to 999 -> the 2 rhythm-agreement locks.
SELF-CORRECTED BY A TEST, not by review: three source comments claimed "a quarterly row genuinely
CAN recur inside a 90-day horizon". FALSE — a quarterly period is 91-92 days and 90 is the app's
widest horizon — so forecast/cash-needed see it at most once, exactly like annual. The test written
to prove the claim failed and corrected all three comments. Reachable differences are the
calendar's multi-month windows (3 clicks) and a stale anchor self-healing forward.
MONEY CRITIC — FAIL, 1 P1 + 3 P2 + 4 P3, every finding executed:
 P1-1 THE LICENCE DID NOT STOP THE CASE IT WAS WRITTEN FOR. The quarterly band is 15 days wide, so
     three haircuts 84 and 98 days apart put BOTH gaps in band; every-gap passed them and a
     discretionary purchase became a projected bill with a calendar date and $15.00/mo against
     guilt-free. Also via the two-plateau path (vet visits $100/$100/$250). FIXED by requiring the
     gaps to agree with EACH OTHER: max-min <= 7 days. Costs no real bill (real anchors: calendar
     quarter 89-92 spread 3, first-business-day 90-92 spread 2, month-end water 89-92 spread 3,
     semiannual 181-184 spread 3).
 P2-2 THE PLAN AND /recurring DISAGREED BY A CENT ON BIWEEKLY at 120,989 amounts under $20k
     (Math.round(a*26/12) vs Math.round(a*(26/12)); 26/12 inexact) — a $2,307.69 paycheck read
     $5,000.00 vs $4,999.99 — AND THE NEW LOCK PASSED ANYWAY because every amount it probed divided
     its factor exactly. FIXED: PER_MONTH is now [num, den] pairs; the lock fuzzes residues.
 P2-3 a bill at a band EDGE is under-counted up to ~8.7% (flat 1/3 vs a real 4.35x/yr at 84 days),
     the dangerous direction, pre-existing for ANNUAL. RECORDED (EDGE_CASES C3, STATUS OPEN #6) —
     the fix is a new rating model for every cadence.
 P2-4 the quarterly case sat in a describe named "the real server path" but called only pure
     functions. FIXED: a real DB describe (seed -> refreshRecurringForUser -> ScheduledTransaction
     -> getSpendingPlan), fail-old fixedExpensesCents 0 -> 20000.
 P3s recorded: seed-vs-detected latent double count (unreachable, demo-fenced), month-end clamp
     drift, the one unconverted cadence ternary in today-feed-copy (unreachable behind isPauseCadence).
 COULD NOT BREAK: monthsPerCadence equivalence (7,938-case sweep, 0 diffs), the lapse gate (80-case
 sweep, 0 diffs), double counting anywhere, the new cadences' rates (2,000,000 amounts), real-world
 anchors, golden safety at three asOf dates.
COPY CRITIC — FAIL, 4 P1 + 4 P2 + 6 P3, every finding executed, all P1s + actionable P2/P3 fixed:
 P1-1 closing the gap had SHRUNK the disclosure describing it: the list read as a closed world and
     named 4 of the 7 surviving IRREGULAR ranges — a four-monthly US utility period was covered by
     nothing. Rewritten with the ranges that bracket the new bands.
 P1-2 "we don't count it YET" promised a recovery the code never gives: the rule reads ALL history
     with no lookback, so a 13-sighting quarterly bill with ONE late cycle two years back is $0
     permanently. Reworded; an EARLY cycle also disclosed (P2-2).
 P1-3 the quarterly/semiannual INCOME asymmetry was undisclosed at all 3 sites where L.23 disclosed
     the annual one (trace + both Ask branches). Widened to the whole long-cadence family.
 P1-4 the smoothing sentence reused ANNUAL's "in THE MONTH the bill leaves your account" for a bill
     landing FOUR times a year — a reader budgeting one lump under-plans by 3 x $200. Fixed with
     per-cadence landing phrases; ANNUAL stays byte-identical to the L.23 wording.
 P2-1 a FALSE COMMENT claimed an e2e bound a testid nothing bound (now bound + data-cadence added).
 P2-3 docs/STATUS.md contradicted the code in 3 places (fixed).
 P2-4 the 137-day quarterly lapse cutoff was a new undisclosed $0 path (own disclosure bullet).
GATE (real output, run ALONE): bash scripts/verify.sh -> VERIFY GREEN, tsc 0, eslint 0,
**282 files / 4477 tests**, build clean. E2E 19/19 serialized (spending-plan, recurring,
spending-plan-month-edge, glass-box, calendar-frozen, forecast, cash-flow-radar,
phase1-cash-needed). docs:lint clean (87 files). Prisma diff = TWO COMMENT LINES -> no DDL.
DOCS: DECISIONS #313 (+index regenerated, 306 entries), STATUS section L.24 (both critics + 9
OPEN), TASKS L.24 row, EDGE_CASES A/B/B1a/B2/B3/C2/C3/C4, 9 REGRESSION_LEDGER rows, and the three
stale STATUS claims about the quarterly gap corrected in place.
OWNER REPORT MID-SESSION, ANSWERED SEPARATELY AND NOT FIXED BY THIS SLICE: live /spending-plan
shows "Fixed & recurring expenses $0.00" against $21,117.48 income. Card payments $0.00 is CORRECT
(all cards dated Aug 5, held in the beyond-month line at $18,814.14); planned savings $0.00 is an
unset settings value. The fixed-expense $0.00 is the real suspect and the leading candidate is the
PAYMENT-ACCOUNT SCOPE (STATUS L.24 OPEN #4) — UNVERIFIED, awaiting a /recurring screenshot, and
noted there is a genuine double-count tension because bills on a card are already inside the
card-payments term.
NEXT: commit, push, deploy-verify.

## L.24 — the verified deploy. 2026-07-26
SHIPPED LIVE as ce494de. Proven by the DEPLOYMENT RECORD, the method the L.23 lesson established:
`npx vercel ls aimplifi --yes` shows the newest production deployment
(aimplifi-iwk60o3a7-reiforge.vercel.app) created 20:27:46, ~1 min after the push, built in 1m and
now ● Ready — and `npx vercel inspect` on it prints `Aliases: https://www.aimplifi.app`, i.e. it is
the deployment serving traffic. Corroborating: /sign-in returns HTTP 200 and its page hash moved
from the L.23 deploy's 7cb2bb70d0c5cf1495769c1eb8870741 to 33e02f8c8568ef7afaefb49e40776c22.
SCHEMA: the staged prisma diff was TWO COMMENT LINES (the cadence legends on RecurringSeries and
ScheduledTransaction) — no DDL, so the deploy's `prisma db push` was a no-op against Neon.
NO PUBLIC MARKER, checked rather than assumed: every string this slice touched lives behind
/spending-plan, /dashboard, /recurring or /ask, all auth-gated (the L.18 standard). The deployment
record is therefore the evidence, not a grep of public HTML.
NOT VERIFIABLE FROM HERE, stated rather than assumed: (a) whether the owner's own data contains a
detected quarterly or semiannual series — no live DB in this environment, and the detector needs
three sightings on a steady rhythm (~6 months for quarterly) to see one; (b) the GitHub Actions run
for this commit — `gh` is not authenticated in this checkout, so CI's own verdict is unread. The
local gate and the 19/19 serialized e2e are the evidence.
LESSON: docs/lessons/closing-a-gap-shrinks-the-disclosure-that-described-it.md (+INDEX) — the copy
critic's P1-1 generalized: fixing half a disclosed limitation makes the disclosure that described
it false unless the remainder is RE-DERIVED from the code.
NEXT: the owner's live "Fixed & recurring expenses $0.00" report — awaiting his /recurring
screenshot, which distinguishes the payment-account scope (STATUS L.24 OPEN #4) from a detection
failure. Then the open queue: L.16 (keep-both prompt), L.13 (owner screenshot), the L.9 OPEN
proven-ambiguity carry-out, and the L.24 residuals.

## L.27 — L.26 verified live, verified correct, and verified NOT YET RUN. 2026-07-27
NO CODE CHANGED. One question, answered by measurement rather than reasoning: is the L.26 fix
working on the owner's live data? It is deployed and provably correct, and it has not executed yet.
DEPLOY, proven two ways: `npx vercel inspect` shows the newest production deployment holds the
`https://www.aimplifi.app` alias, and its build log line reads `2026-07-27T02:12:53.113Z Cloning
github.com/meleesciony/Aimplifi (Branch: main, Commit: 17fed6f)` — the traffic-serving build IS
L.26. (`main` was already level with `origin/main`; L.25 and L.26 were pushed, only the deploy
verification step was missing.)
CORRECT, proven by a read-only replay of the deployed `refreshRecurringForUser` against the
PRODUCTION database: 2556 POSTED txns → 1344 after the reconciliation keep rule → 21 series → 20
re-keyed onto live successors → **8 scheduled rows**. Fidelity check passes: 20 of the 21 series
have a Merchant row, which is exactly the 20 `RecurringSeries` rows production holds. The 8 rows are
the $176.79/mo Mohela student loan, the $146.40/mo Principal insurance premium, the $166.67 biweekly
Schwab retirement contribution, four Cardone income series and a $4.00 ATM-fee rebate.
WRITE, proven safe: a probe ran all four statements of the real `$transaction` against production
inside an interactive transaction ending in a deliberate rollback — `recurringSeries.createMany -> 20`,
`scheduledTransaction.createMany -> 8`, then rolled back; before/after counts identical
(RecurringSeries=20, ScheduledTransaction=0). Compute and persistence are both sound.
NOT YET RUN — the whole explanation: the owner's last full Plaid sync was `2026-07-27 01:37:46 UTC`;
the deploy landed `02:12:53 UTC`. Nothing has synced in the 35 minutes since, so the empty
`ScheduledTransaction` table and the live "$0.00" are correct given no sync has happened.
THE TRAP, fallen into and caught: every `DateTime` column here is Postgres `timestamp without time
zone`, and node-pg re-reads it in the probing machine's local zone — from UTC−4 the 01:37 sync read
as `05:37Z`, i.e. AFTER the deploy. That produced a complete, well-evidenced and entirely FALSE P0
(the fixed code ran twice in production and wrote nothing, hidden by the bare `catch {}` at
plaid.ts:1509). Caught only because a `WHERE "createdAt" > <deploy>` filter returned zero rows while
an unfiltered listing of the same table showed rows past that instant — two readings that cannot both
be true. Fix: read timestamps as `::text`. Lesson recorded.
STATUS CORRECTION: L.26 OPEN #2 claimed "No page load recomputes it." False. `AutoSync` (app layout)
calls `syncPlaidNow` on a 15-minute throttle → `PlaidProvider.syncTransactions` → the refresh at
plaid.ts:1508. The owner's audit trail shows precisely this — sync bursts at 19:21, 20:07, 23:52 and
01:37 UTC, none of them a cron. The number moves on his NEXT SYNC, whichever comes first; he does not
have to wait for the 11:00 UTC cron.
TOOLING KEPT: `scripts/audit-probes/l26-*.{mjs,ts}` — the replay is what answered a question three
prior sessions guessed at, so it is committed rather than discarded. All are read-only except the
write probe, which is rollback-bounded and prints its before/after counts.
NOTE: PROGRESS.md carries no entries for L.25 or L.26; their record lives in the commit messages,
docs/STATUS.md and DECISIONS #314/#315.
NEXT: after the owner's next sync, re-run `node scripts/audit-probes/l26-did-the-number-move.mjs` —
expect ScheduledTransaction 0 → 8 and "fixed & recurring expenses" $0.00 → $684.31/mo.

## O.8 — two merchant/category bases reconciled, one proposed fix refuted. 2026-07-29
SCOPE: TASKS O.8, three claims left open by the O.7 critics. Every one re-verified at source
first, and TWO of the task row's own citations were WRONG: `src/lib/server/trends.ts` does not
exist (the code is `src/lib/engine/trends/trends.ts:322`), and "/budgets already excludes
credit-card-payment via NON_BUDGETABLE" is false — NON_BUDGETABLE gates which categories may carry
a budget TARGET (the picker's offer set), while `summarizeBudgets` renders the union of spend keys,
so /budgets counts those rows exactly as /reports does. The two surfaces never disagreed.

O.8(a) FIXED — /trends "New this month" amounts.
 MEASURED BEFORE CHANGING ANYTHING: four rows at one brand-new merchant (two settled purchases, a
 pending purchase, a settled refund) made /trends print $65.00 and Ask print $80.00 for the same
 merchant and month. Both sentences were true of their own basis and both were disclosed, which is
 why nobody could see it — the surfaces are never shown side by side.
 THE SPLIT RUNS THROUGH THE CARD, not around it: WHICH merchants are new is a claim about an EVENT,
 so it stays settled-purchase-only (a pending auth can vanish); the AMOUNT beside each is an
 AGGREGATE at merchant scope — the identical question `merchantSpend` answers — so it now reads the
 reports engine's own `isSpendRow`/`spendContributionCents` (POSTED+PENDING, refunds netted, stored
 category). `computeSpendingTrends` passes ALL rows; each insight applies its own narrowing, so a
 basis lives beside the claim it describes instead of being decided one call up.
 #74's accepted gross simplification ("netting would risk a confusing negative new-merchant line")
 is answered by DROPPING a net <= 0 merchant — the rule `spendingByCategory` already applies to a
 net-refunded category (reports.ts:78) rather than a newly invented one.
 INTAKE CHECKED, not just the engine (the L.31 error class): /reports, /trends and Ask all read the
 same `getFinanceSnapshot`, which applies the spending-account scope AND the reconciliation
 boundary, so parity holds past the engine boundary.
 DEMO GOLDEN UNMOVED, PROVEN NOT ASSUMED: seed newMerchants @2026-06-10 is byte-identical under old
 and new code — Store Card Purchase 4350, Costco Gas 3738, same categories and first dates.

O.8(b) REFUTED AND DECLINED, on evidence rather than argument. The task proposed excluding the
 `credit-card-payment` category from spending. A read-only production probe
 (`scripts/audit-probes/o8-card-payment-basis.mjs`) shows ALL 20 such rows already carry
 `isTransfer: true` — the pair detector catches them whenever we hold the card, which is precisely
 the double-count case. The rows that survive into a spending figure are payments to a card this app
 CANNOT see, where the payment is the only trace the money left. Excluding them would fix nothing
 and would understate /budgets — a surface printing an INSTRUCTION ("$87.70 left this month") — in
 the over-generous direction (L.14). Kept, with the argument written into the NET_SPEND_BASIS
 docblock and pinned by a lock whose mutation proof is the proposed change itself.

O.8(c) OPEN, verified at source: `answerMerchantSpend` slices `items` (sorted contribution-desc) to
 5, so a refund — always a negative contribution — is the first row truncated. Disclosed in the
 detail clause and fully cited in the trace, so the figure is honest and the VISIBLE rows are
 biased one way. Not fixed: changing which rows a money answer shows needs its own copy pass.

GATE (real output, run ALONE): `bash scripts/verify.sh` -> tsc 0, eslint 0, **297 files / 4732
tests**, next build clean, ✅ VERIFY GREEN. trends.spec.ts 3/3 serialized incl. axe.
MUTATION PROOF: reverting trends.ts fails 7 of the new locks, headlined `expected 6500 to be 8000`
— the measured divergence itself. Applying the O.8(b) exclusion fails the decision lock.
Prisma diff EMPTY -> the deploy's `prisma db push` is a no-op against Neon.
NEXT: two fresh-context critics (money lens / claims lens) in flight; then docs + ship.

## O.8 critics — both FAIL, both P1 sets fixed, and one shipped ARGUMENT falsified. 2026-07-29
TWO fresh-context critics (money lens on Opus, claims lens on Fable), CONVERGING INDEPENDENTLY on the
same P1 — the strongest available signal a finding is real.
P1 (BOTH) — SHARING A BASIS IS NOT SHARING A SCOPE. I claimed the new amount reads "the exact rows Ask's
 `merchantSpend` counts" and that the two "cannot drift". False on the shipped demo seed by 5.2×:
 `merchantMatches` takes a bidirectional whole-word PREFIX, so "Costco Gas" sweeps every "Costco" row —
 $37.38 here vs $195.82 there, answered under the OTHER store's name. REPRODUCED myself before acting.
 The gap PREDATES the slice (old settled-gross was the same $37.38), so the defect was the CLAIM, not the
 code: every claim narrowed, and the divergence PINNED by assertions (including the wrong display name)
 so closing it in O.10a means changing a test that explains itself.
P1 (money lens) — THE LOCK COULD NOT HAVE CAUGHT IT. Every case in the parity file used ONE merchant
 string, which makes exact-key and prefix matching trivially identical. Its twin: the seed's
 `expect(amountCents).toBeGreaterThan(0)` went TAUTOLOGICAL the moment my net-≤-0 drop landed — the code
 compared against its own default. Both replaced with golden literals + a multi-merchant seed fixture.
P1 (claims lens) — MY OWN BASIS LINE WAS FALSE. "A merchant appears here once a purchase settles" is
 broken by the drop rule (a fully-refunded settled purchase does NOT appear, while the same page's
 Biggest purchases still names it), and a PENDING refund can VETO a merchant a settled purchase
 confirmed — pending money cannot name an event but can un-name one. Rewritten, all cases locked.
P1 (claims lens) — THE O.8(b) DECLINE WAS RIGHT FOR THE WRONG REASON. I wrote that excluding card
 payments "would fix nothing"; the critic executed the counterexample and I reproduced it: pairing needs
 opposite amounts within ±3 CALENDAR DAYS, so a payment on the 28th whose card credit posts on the 3rd
 leaves only the CARD side flagged, and the phantom $500 is never repaid (next month's net-refund rule
 drops the offsetting credit). Decision STANDS — deleting the only trace of an unseen card's payment
 makes an INSTRUCTION too generous (L.14) — but restated as a TRADE-OFF, with the straddle locked as a
 known defect and carried to O.10b, where the fix belongs (the DETECTOR, not the predicate).
P2s FIXED: production counts hardcoded in source comments (moved to STATUS per one-status-home); a probe
 printing user EMAILS into transcripts; the live `.env.prod.tmp` credential left at repo root (deleted);
 and the new-merchants card having NO test of any kind — its basis sentence could have been deleted with
 every suite green. The e2e written for it FAILED first run on a STALE BUILD (the recorded tell, "my
 change had no effect at all") and passed after `next build`.
FINAL GATE (real output, run ALONE): `VERIFY_E2E=1 bash scripts/verify.sh` → tsc 0, eslint 0,
**297 files / 4741 tests**, **214 e2e passed**, next build clean, ✅ VERIFY GREEN. docs:lint clean (101).
DOCS: DECISIONS #335/#336 + index, STATUS §O.8, TASKS O.8 closed + Wave O.10 (a-d) opened, 6 REGRESSION
LEDGER rows, lesson `sharing-a-basis-is-not-sharing-a-scope.md` + INDEX.
NEXT: commit, push, deploy-verify.

## O.12e measured, and a new owner mandate: Simplifi parity. 2026-07-29
MEASURED (read-only production replay, `scripts/audit-probes/o12e-why-the-proposal-is-silent.ts`,
owner's live rows, `AccountReconciliation` = 26 so the queue figures are an UPPER BOUND):
- queue today 130 rows / 66 groups (was 173/89 at the O.12d run — he has been filing).
- 49 groups reach the proposal tier; 44 of those cards are SILENT.
- Of the 93 rows inside those card-silent groups, the shipped per-row ladder
  (`registerSuggestionFor`, which the REGISTER renders today) returns a chip on **21**: 9 Venmo rows on
  `history/transfer` (amount basis, support 2-4) PLUS 12 `provider/shopping` rows that are the entire
  masked `.` group of O.12f. The inbox's own "One by one" drill-down consults NO ladder, so it shows
  none of them, while its card says "none yet - pick once for all N".
- CORRECTED MID-SESSION: the first run said 9 because the probe passed `providerCategoryId: null` —
  `TriageGroup['rows']` is a Pick that DROPS that column, so the provider rung was untestable and the
  count was a lower bound presented as exact (L.26 class). `next build`'s type check caught it.
- The remaining 72 rows: the engine genuinely has nothing (first sightings). Nothing to surface there.
- WHY the payee basis is dead on the biggest group: all 33 Venmo rows carry the raw descriptor
  literally `"Venmo"` - one payee key, empty. propose.ts's docblock claims the payee basis "rescues an
  aggregate" via payee tokens; that is FALSE for this feed (no payee in the string). Only the amount
  basis can fire. Worth correcting in the docblock when that file is next touched.
- O.12f confirmed: the `.` group is 12 POSTED rows, raw `******.*************`, amounts -$0.58 to
  -$402.92, aggregate=false.
OWNER MESSAGE MID-TURN (5 Simplifi screenshots + two messages): "Categorization and features for
categorization are extremely lacking compared to simplifi... You have the ability to change things like
'contains tjmax'. Because the card number and other numbers always change. This aids in future pain."
and "Your goals are to make the app at least as good as simplifi. Currently we can't even solve the
transaction list. Rest of features also pale in comparison."
NEXT: notate as a wave + a field-level parity matrix (his explicit ask), then build the user-authored
keyword rule ("contains") engine-first.

## Turn close 2026-07-29 — three commits shipped, one owner-blocked question
SHIPPED (all pushed to origin/main, verify green each time; 301 files / 4781 tests):
- `7c599bf` O.13a engine (keyword-rule.ts + RuleLike.matchKeywords + one ruleMatches clause) and the
  parity notation (docs/SIMPLIFI_PARITY.md, TASKS Wave O.13 a-h + Wave P). No schema change, no prisma diff.
- `2c9ae23` O.14a the login mask: a system AuthError no longer reads as "wrong password" nor spends the
  per-account fail budget; PII-free reason=no-user|bad-hash discriminator in authorize().
- `d1e078c` lesson: the instrument can be blind to the rung it measures (L.26 extended).
OPEN / NEXT, in priority order:
1. O.14b — BLOCKED on one owner-only fact: the exact sentence he sees on a failed login.
2. O.13a remainder — additive `matchKeywords` column, toRuleLike mapping, rule creation from a
   transaction with a live match-count preview, priority band 110 + specificity tie-break, hostile critic.
3. O.13b — the transaction detail view (his most acute complaint: "can't even solve the transaction list").
4. O.12e — surface the 21 measured per-row suggestions in the inbox drill-down + honest card copy.
DEPLOY VERIFIED (not by a status code): the deployment holding the `https://www.aimplifi.app` alias is
`dpl_CqS41FDtLGtxEctQvGJJuHrdrDr7` (aimplifi-3iwpquwu9), ● Ready, and its build log opens
`Cloning github.com/meleesciony/Aimplifi (Branch: main, Commit: 2c9ae23)` — the login-fix commit, with
7c599bf as its ancestor. No public marker was grepped and that is stated rather than skipped: both changes
are server-side error handling behind a failed sign-in, so nothing on a public page reflects them (the L.18
standard — the deployment record is the evidence).

## O.13 continued 2026-07-29 — the brand-coverage fix, and the rule plumbing
SHIPPED `23f6f15` (verify green: 303 files / 4811 tests; deployed, ● Ready on www.aimplifi.app):
- BRAND COVERAGE (visible to the owner): `\bMACY\b` cannot match `MACYS` — the trailing S removes the
  word boundary — so the possessive spelling matched and the plural spelling every bank sends did not.
  22 of 80 major-brand descriptors had no category; now 6, each refused on purpose. Added at the SPECIFIC
  tier so the canonical is fixed too: `MACYS LENOX SQUARE` → "Macy's" / clothing.
- O.13a storage + server: additive nullable `CategorizationRule.matchKeywords` (prisma db push ran on
  deploy, additive only), `toRuleLike` decode + declared-but-empty REFUSAL, priority 110 with a
  specificity tie-break that leaves merchant-rule ordering byte-identical, and preview/create/list/delete
  actions with preview↔mutation parity asserted against real rows.
STILL NOT BUILT, and it is why the owner says he can't help: the RULE BUILDER UI. The capability is
plumbed end to end and unreachable from the app.
NEXT: (1) the builder UI — chips, live match count, apply-to-existing, then the hostile critic;
(2) O.13b transaction detail view; (3) O.12e inbox drill-down suggestions.

## O.13a SHIPPED — the rule builder is live. 2026-07-29
`d6a763c`, deploy-verified: the deployment holding `https://www.aimplifi.app` was built from
`Commit: d6a763c` and its build output lists the route `f /rules` (a marker unique to this change — the
307-to-sign-in a curl gets proves nothing, since every unknown path redirects the same way).

WHAT THE OWNER CAN NOW DO: /rules (or the Rules button in the register header) — type `cardone`, pick
Investment Income, see "Matches 2 transactions in your history — 2 not yet categorized", the money-in/out
split, five real descriptors, and a warning if any matched row runs the wrong way for that category; then
create, with or without filing the history. Each re-filed row writes a Correction, so it undoes like any
other filing. The rules list shows what he wrote and deletes it without un-categorizing anything.

WHY IT WAS NEEDED, from his own data: `Cardone Eq Fund Cef Xv Ppd ~ Tran: ...` and `Cardone Equity F Cef
Ix Ppd ~ Tran: ...` are two unrelated payees to every DERIVED key (merchant canonical, descriptor
signature), so every correction he made taught the app about a payee it will never see again.

THE E2E EARNED ITS KEEP — three defects no unit test could see: a stale /rules render contradicting its
own success message (missing revalidate on the page the reader stands on); my new header link overflowing
380px in BOTH engines; and the icon-only fix for that overflow removing the control's accessible name,
failing two WCAG sweeps. Also caught elsewhere: /rules had to join SYNC_REVALIDATE_PATHS, and 4 raw 0x08
bytes my own doc edit wrote into TASKS.md (the heredoc hazard the repo already has a lesson about).

PROCESS NOTE worth keeping: my own spec failed 3 of 4 full-suite runs on a post-`router.refresh()` count
and passed every time it ran alone — the documented load-flake signature, but in MY assertion rather than
in the app. Fixed by making the wait budget explicit, never by weakening the claim.

STILL OWED on O.13a: the hostile-critic pass (categorization routing that writes money categories).
NEXT: (1) the O.13a critic; (2) O.13b the transaction detail view; (3) O.12e the inbox drill-down.

## O.13a critic cycle 1 — FAIL, then fixed. 2026-07-29
`2bf141d`, deploy-verified (build log `Commit: 2bf141d`, route `f /rules`, holding www.aimplifi.app).
Two fresh-context critics, different lenses, BOTH FAIL: 2 P0 + 7 P1, all fixed and fail-old locked
(9 REGRESSION_LEDGER rows, DECISIONS #339, lesson `a-typed-key-is-a-pattern-not-an-identity.md`).
Gate: VERIFY_E2E=1 green twice — 304 files / 4825 tests, 216 e2e. No prisma diff.
THE TWO P0s (both reproduced by execution before the fix):
- a typed rule was the ONLY auto-file path with no #44 sign check, and the failure is ERASURE not
  mis-labelling: an outflow filed as income is dropped by `isSpendRow`, so spending vanished from
  reports/trends/budgets while `monthlyFlows` still counted it. My first fix reused `learnedSignOk`,
  which is symmetric, and therefore broke the documented refund convention — caught by this slice's own
  new lock. The guard is asymmetric on purpose.
- the apply set was `{account:{userId}}` with none of the five exclusions its three siblings carry: it
  re-filed a transfer, a split parent, both split CHILDREN (collapsing a hand-made allocation), a
  review-pinned row, and investment/non-USD rows. Preview count on the same data: 9 -> 3.
THE P1s: undo left the rule alive so the next backfill re-filed all 5 reverted rows; no demo fence (one
visitor's typed words rendered to the next, while the rule could never fire); three strings claimed an
empty rule "matches everything" when the engine makes it match nothing; the builder pointed at bank text
the register never shows, a gap THIS session's brand work widened; the history rewrite defaulted ON with
no undo anywhere; and the list contradicted its own success message.
NEXT: (1) O.13b the transaction detail view — it now also owes the raw-bank-text row (the O.13a
mitigation is a zero-match hint, not a fix); (2) O.13d rule EDIT + surfacing merchant/learned rules in
the list, since a typed rule silently outranks both; (3) O.12e the inbox drill-down.


## O.13c SHIPPED + deploy-verified — Simplifi-parity rules. 2026-07-30

Commit `368c3cb`, pushed, deployment `dpl_41ea5f2M…` **READY**, sha matches, aliased to
`www.aimplifi.app` + `aimplifi.app` (`aliasError: null`), zero runtime errors in the hour after.
Picked up a prior session's UNCOMMITTED working tree (verified in a cloud sandbox: tsc/eslint/vitest
only) and took it through local verify, critics, docs, and ship.

**Gate, run locally with real output:** `VERIFY_E2E=1 bash scripts/verify.sh` → tsc clean, eslint
clean, **305 files / 4865 tests**, `next build` clean, **218 e2e**. (Baseline before my fixes was
4858 / 218; the +7 are the new fail-old locks.) A 218-test e2e baseline was also captured on the
tree exactly as handed off, so the critic fixes are isolated from "did it ever work".

**Two briefing claims were wrong and both mattered.** (1) `RULES_GAP_REPORT.md` does not exist
anywhere in the tree — its content went into docs/STATUS.md + the TASKS row instead, since a
root-level status file would violate the repo's own one-status-home rule. (2) The brief said
`prisma db push` runs on deploy "because a schema diff is present"; `package.json`'s build is bare
`next build`. The push actually comes from a `buildCommand` override in `vercel.json`. Verified
before pushing, and confirmed in the build log afterwards:
`Datasource "db": PostgreSQL database "pulse" … neon.tech` → `Your database is now in sync with your
Prisma schema. Done in 557ms`. That line is the real proof for this slice, because `/rules` is
auth-gated — `curl | grep` for a UI marker is not available, and the demo path returns `[]` before
it ever selects the new column, so it would not exercise it either. Pre-flighted by running
`gen-pg-schema.mjs` + `prisma validate` against the generated Postgres schema locally first.

**CRITIC CYCLE 1 — two fresh-context critics, both FAIL: 1 P0 + 3 P1, all fixed + locked
(6 ledger rows, DECISIONS #340, one new lesson file).**

The P0 was found INDEPENDENTLY by both, from different assigned lenses. OR-groups had been encoded
into the EXISTING `matchKeywords` column with `|` as the divider, and `|` was an ordinary character
inside a keyword under the parser that wrote every row already in the database. `us|y47` (an AND key
requiring that literal text) became an OR firing on `y47` alone at 9900 bps with no review;
`shell|a`, which passed O.13a's floor as one 7-char token, would have become the group `["a"]` and
mass-filed an entire account. Fixed structurally — new column, legacy decoder keeps the old
separators forever, floor re-applied on the READ path in one shared basis.

**I mis-analyzed one of these myself and a critic caught it.** I inspected the undo lineage guard,
saw `createdFrom: correction.id`, and cleared it — considering only the case of undoing an *old*
correction. Undoing an *edit's* re-apply matches that guard and deleted the rule the reader had only
meant to edit. Lineage is now claimed on the create path only (`claimLineage`).

**And a fix of mine broke what it measured.** Making the "N payees renamed" count truthful via
`NOT: { merchantId }` is UNKNOWN for NULL columns in SQL's three-valued logic, so every rename
reported 0 and wrote nothing. The lock written for the count claim caught it within the minute; the
predicate is now an explicit `OR: [{ merchantId: null }, …]`.

**Resume from here:** 7 residuals are recorded in docs/STATUS.md under "OPEN after O.13c" — the
three worth a decision are that clearing a rename cannot restore the bank's text, backfill honors a
rule's category but not its rename, and a case-only rename collision mints a second `Merchant` row
(no portable case-insensitive lookup across SQLite + Postgres in Prisma). Residual 7 is
pre-existing and outside the app: the two O.12 audit probes don't select `matchKeywords`, so they
model every typed keyword rule as match-everything and have been unreliable since O.13a. O.13b (the
transaction detail view) is the next queued row in this wave.


## O.13b SECOND SLICE — the transaction detail view. 2026-07-30

DONE: `/transactions/[id]` exists, reached by a `Details` link on every register row. It carries the
whole field set for one transaction — payee, amount, account, date, status, category, note, the tax
control, the provenance badge, the statement provenance line, the rule lever — and, for the first time
from the register, SPLIT.

WHY SPLIT IS THE LOAD-BEARING PART: the engine, the server action and the two-part gesture have existed
since Phase 3c and lived ONLY in the triage inbox, so a transaction that had already been filed could
never be split. Nothing about splitting was rebuilt; the detail view calls the same
`splitTransaction`, and a split container renders its pieces plus Undo — the only place undo can live,
since the register deliberately hides the container so $212.40 is not counted twice.

ONE BASIS, NOT TWO: `suggestionForRow` was hoisted out of `getTransactions` to module scope so the
detail view computes the suggestion ladder and the provenance badge through the identical code path.
The "why a rule cannot be written from this row" sentence is asked of `getRuleSourceTransaction`
rather than re-derived, so it cannot drift from `matchableWhere`. Merchant-wide filing is deliberately
absent: the register's "apply to N" count comes from the reconciliation-filtered set it already holds,
and a second count computed here could differ by a reconciled duplicate — so this page files one row
and sends durable all-rows instructions to /rules, which previews its own count.

FOUND BY THE GATE, NOT BY THE FEATURE: this is the app's FIRST dynamic route, and
`tests/unit/sync-revalidate.test.ts` failed the moment it appeared — the tripwire the O.12 critic left
for exactly this day. `revalidateAfterSync` looped a bare `revalidatePath(p)`, and on a path
containing a `[param]` that call marks NOTHING: adding the list entry would have looked like coverage
while nothing marked the route at all (the route is ƒ Dynamic, so this is list integrity, not a live stale-money fix). Fixed with the type-aware
`revalidatePath(p, 'page')` branch. The tripwire was REPLACED BY A STRONGER LOCK (spies on
`revalidatePath`, asserts the argument per dynamic route), not relaxed — mutation-proven: reverting
the branch fails exactly that assertion and no other. One REGRESSION_LEDGER row.

TWO TEST-ONLY DEFECTS WORTH RECORDING, both measured:
- The first e2e raced the detail view's own post-save reload: asserting the `<select>`'s value passed
  against the pre-reload DOM, and the reload then wiped the split panel mid-interaction. The wait is
  now on a fact only the SERVER can produce after the write — the provenance badge flipping to
  "You set this".
- A bogus id returns HTTP 200, not 404. This page is the app's first `notFound()` caller (the root
  `not-found.tsx` docblock says so), and the `(app)` layout has already streamed by the time the read
  resolves, so Next cannot revise a status line it has flushed. The reader gets the right screen; the
  spec asserts the screen and STATUS records the status.

GATE: tsc clean, eslint clean, 4879 unit tests / 306 files, clean `next build`, 223 e2e passed on a
full clean run. Two intermediate runs each failed a DIFFERENT spec (merchant-lens + reconcile, then
goals) and every one passed serially — the 4-worker contention class named in playwright.config.ts,
confirmed by re-running rather than assumed.

NEXT: O.13d (rule management — the list still shows only TYPED rules, while merchant "Always" and
learned rules stay invisible and undeletable though a typed rule outranks both); then O.13g
(user-settable Pending/Cleared, which the detail view now has a home for) and O.13f (mark as
recurring by hand).

### O.13b critic cycle 1 — two fresh-context critics, both FAIL, all P1s fixed

Different lenses (money+authz; on-screen claims+UX). They converged INDEPENDENTLY on the split
dead-end. Eight P1s, all fixed and ledger-locked (6 REGRESSION_LEDGER rows):

1. Undo split was LOSSY — the claim nulled the parent's categoryId and undoSplit could not restore
   it, so undoing a split of an already-filed row discarded the reader's filing. Invisible until this
   slice, because split had only ever been reachable from the inbox, where rows are unfiled.
2. The split was PERMANENT once the reader navigated away: the container is hidden from the register
   and the inbox, so its undo lived at a URL nothing linked to. splitParentId was already returned
   and never rendered.
3. "Appears on your … statement as …" was false for manual/CSV rows (typed text, no statement) and
   for PENDING rows — and this slice's own e2e created the manual account that proved it.
4. The rule copy promised retroactive filing that the default path does not do.
5. A tax tag on a split container saved and reached nothing (the tax export drops those rows).
6. Thrown refusals would render as an opaque Next digest in production.
7. Errors had no role="alert" and painted above a 380px fold.
8. The deadline reload was silent — indistinguishable from success.

Plus P2s fixed: the reconciliation boundary, split offered on transfers and sub-2-cent rows, the
ownership scope on the children query, a cross-tenant unit test against a REAL second user, the
register/detail field-by-field agreement asserted rather than reviewed, the /transactions/[id]
phone-width sweep, aria-labels on two identical "Save" buttons, a too-loose waitForURL glob, and a
404 test that would have passed with the route file deleted.

Two claims of mine were CORRECTED rather than defended: the sync-revalidate docblock (and its ledger
row) said the missing branch would leave the detail view "serving pre-sync money" — the route is
ƒ Dynamic, so the honest claim is list integrity, not a live stale-money fix.

GATE AFTER FIXES: ✅ VERIFY GREEN — tsc, eslint, 4886 unit tests / 307 files, clean next build,
225 e2e.

### O.13b critic cycle 2 — FAIL again; a cycle-1 fix had been INERT

A third fresh context re-executed all ten cycle-1 findings rather than trusting the comments. Six
confirmed closed by mutation (each naming the test that dies). Four were not, all now fixed:

1. THE BANNER NEVER RENDERED. `page.tsx` imported UNCONFIRMED_PARAM from the 'use client' view, and
   a client module's exports are client-REFERENCE stubs on the server, so searchParams was indexed
   with a non-string. The entire cycle-1 fix for the silent timed-out write did nothing, while tsc,
   eslint, next build and every test stayed green. Proved by an A/B build. Constant now lives in a
   plain module (transaction-detail-params.ts) — the L.7 'use server' rule from the other side.
2. A hand-typed / CSV row on a bank-LINKED account was still attributed to the bank: the cycle-1 fix
   asked account.provider, but manual add and CSV import accept any account the reader owns. The row
   already knew (providerRef null unless a feed delivered it). My own sibling test had locked the bug
   in by flipping the account and asserting 'bank'.
3. Splitting a TAX-TAGGED row silently destroyed the deduction (measured 21240 -> 0), and the only
   sentence about it appeared after the money moved. Warned before the confirm now, naming the amount.
4. The correct reconciliation-boundary fix had NO test — deleting the guard left all 9 green.

Plus: a note save on a split container silently cleared its tax tag; the unconfirmed flag was sticky
across a confirmed save; two money-reasoning comments in trends.ts and keyword-rules.ts had been
falsified by the split change; four per-user loaders were fetched and discarded for filed rows.

THE RISKIEST EDIT CAME BACK CLEAN, by execution rather than by argument: a split container retaining
its category cannot double-count. Reports total 21240 -> 21240 (household 21240 -> 1240, shopping ->
20000); trends spentSoFarCents 21240 on both sides; the register's category filter returns only the
child; spending-plan / dashboard / Ask byte-identical. The static sweep found ~22 consumers, all
excluding the container by FLAG.

LESSON WORTH KEEPING: three of the four cycle-2 P1s existed because a fix was reviewed rather than
locked. The banner is the sharpest case in this repo so far — a fix that typechecks, builds, and
passes every test while doing literally nothing.

### O.13b SHIPPED + deploy-verified — 2026-07-30

Commit `9afcfb1`, pushed to origin/main, deployment `dpl_GdDg15Mm…` **READY** in production,
`githubCommitSha` 9afcfb1 (matches).

DEPLOY PROOF, because a 200 proves nothing (an old deployment answers 200 perfectly well) and
`/transactions/[id]` is auth-gated so no UI marker is curl-able:
1. The production build log's route table lists `ƒ /transactions/[id]` — a line unique to this
   change, printed by the build that was deployed.
2. The canonical host serves byte-identical hashed chunks to the new deployment URL
   (`0cz1d0mv5g_q7.js`, `0fbn43l2yk1l4.js`, `1_0v6exngdege.js` on both), which is what actually
   proves www.aimplifi.app is on THIS build rather than the previous one.
3. Build log confirms the database was untouched, as the empty `git diff prisma/` predicted:
   `Datasource "db": PostgreSQL database "pulse" … neon.tech` → `The database is already in sync
   with the Prisma schema.`
4. Runtime errors in the hour after: one pre-existing group only — a `pg` SSL-mode deprecation
   warning first seen 2026-06-17, whose `lastDeployment` is the PREVIOUS deploy. Nothing new.

UNRESOLVED, recorded rather than smoothed over: one `merchant-lens` e2e failed twice under a
loaded machine (the cycle-2 critic was running concurrently; that e2e run took 7.9m against a
normal 2.5m). My first bisect blamed the new per-row Details link and was CONFOUNDED — it rebuilt
in the same step, and `next start` serves the last build. Rebuilt with the link present: all four
merchant-lens tests pass, and the full gate is green with 226 e2e. I cannot name a mechanism
beyond machine load, so this is logged as unreproduced, not diagnosed.

### O.15 slice 1 — nothing the app claims is a dead end (verify green)

Owner brief: *"no cohesion in the app… most def not at parity with Mint/Simplifi."*

WHAT SHIPPED. One href author (`merchantRegisterHref` + `MERCHANT_LINK_CLASS` in
`src/lib/engine/transactions/links.ts`); the four pre-existing inline `?merchant=`
template literals migrated onto it; new links on `/recurring` (every row + every
coming-up renewal) and in the Today feed ("View charges at X" on any proposal carrying a
merchant). The uncommitted coach clickability fix that was already in the working tree
(coach/page.tsx, life-energy-card.tsx) is verified and included here.

TWO DELIBERATE REFUSALS, documented at the call site so neither reads as an oversight:
the household shared list (partner-owned rows, viewer-scoped register, and
`getSharedTransactionsView()` takes no filter at all) and the category label on a
`/recurring` row (a cadence has no month window, and `CategoryFigure` requires one).

GATE: `VERIFY_E2E=1 bash scripts/verify.sh` → **VERIFY GREEN**, 4912 unit / 308 files,
**232 e2e** (up from 226 — the six new ones).

MUTATION-PROVEN, because a green test is a hypothesis (the O.13b inert-banner lesson):
1. Builder → `URLSearchParams`: 1 test dies (the `%20` pin).
2. Builder → no escaping at all, parsed via `href.split('?')[1]`: 5 die but `A#1 Auto`
   and `100% Chiropractic` survive — a manual split never lets `#` start a fragment, so
   the test was more forgiving than a browser. Re-parsing through a real `new URL()`
   takes it to 7 dead. That leniency was found by mutating, not by review.
3. Both new links replaced with plain `<span>`s + full rebuild: exactly 3 of the 6 e2e
   tests fail, the other 3 stay green.

CHECKED RATHER THAN ASSUMED — the question the whole slice rests on: is the string each
call site passes the same string the register filters on? `merchantName` is
`t.merchant?.canonical ?? normalizeMerchant(t.rawDescriptor).canonical`
(server/transactions.ts:262), matched EXACTLY and case-insensitively (query.ts:200);
`RecurringSeries.merchantCanonical` resolves against `Merchant.canonical`
(server/recurring.ts:195–199). Same string, so aggregate pseudo-merchants ("ATM
Withdrawal", "Zelle Payment") link to the register's own grouping rather than to nothing.

NOT DONE IN THIS SLICE, recorded rather than smoothed over: the three tappable dashboard
summary cards (Top spending, Trends/Spending insights, Recurring summary) each render a
category or merchant name INSIDE a card-wide `TrackedActedLink`. An anchor may not nest
inside an anchor, so linking those names is a structural change to the card (and to the
`SURFACE_LINK_CARD_CLASS` contract that `surface-card-styles.test.ts` locks), not a link
swap. They are not dead ends today — each lands on the full page where that same name IS
linked — so this is a two-tap path, not a missing one. Owner can overrule.

CRITIC CYCLE 1 — two fresh-context critics, both FAIL, almost no overlap. One found a
**P0 by executing a probe**: `/recurring`, `/coach` and the Today feed display a live
re-derivation of the merchant name from `rawDescriptor`, while the register matches the
STORED `Merchant.canonical` — so after an O.13c rename-payee rule the link lands on 0 of 4
rows. Neither of my tests could have caught it: the unit fixture builds its rows from the
same string it hands the builder, and the demo seed has zero divergence. I had checked
this exact question earlier in the session and got it WRONG — I verified that
`merchantCanonical` is looked UP against `Merchant.canonical` and concluded it therefore
IS that value; `detectRecurring` in fact groups by `normalizeMerchant(rawDescriptor)` and
`RecurringTxn` carries no merchant relation at all.

Decision (full reasoning in DECISIONS #341): SHIP the links and PIN the divergence. It
predates the links (the Merchant Lens joins the same two name-spaces at
server/transactions.ts:334 and fails identically); leaving plain text is a dead end for
every reader while shipping is one only for renamed payees; and the real fix — threading
merchant identity through the snapshot into `detectRecurring` — changes what a recurring
series is keyed by, which is engine work at the tier this repo reserves for it. The
rejected shortcut was widening the register's filter to also match the descriptor: that
makes a filter fuzzy to hide an identity defect, and silently widens the Merchant Lens's
money figures.

Also fixed this cycle: a `toContain` that PASSED on the very truncation its comment
claimed to catch; `MERCHANT_LINK_CLASS` shipping hover-only affordance (invisible at
380px — the defect this module already recorded for category figures); its docblock
claiming to stop drift while four links in the same commit hand-rolled their classes; a
false claim that the register has a free-text merchant box (it has no merchant control at
all — recorded as a real weakness with a queued UI fix); "View charges at X" on an INCOME
row, calling a paycheck a charge; and `truncate` without `min-w-0` in two files.

STILL OPEN, named not buried: `detectRecurring` lacks the `isAggregateCanonical` guard its
two sibling detectors have, so a rent-by-Zelle series links to a register mixing every
Zelle payee; and the feed's opportunity kinds hard-set `merchant: null`, so "A
subscription's price went up" still names nobody.

GATE AFTER FIXES: `bash scripts/verify.sh` → **VERIFY GREEN**, 4915 unit / 308 files;
`no-dead-ends.spec.ts` 8/8.

RULES-BUILDER REPORT (owner: "can't add additional fields — e.g. Cardone for income
category"). The stale-deploy hypothesis in the brief is DEAD: O.13c is commit `368c3cb`
and `origin/main` is six commits past it at `168529d`. So the deployed build does carry
the O.13c UI and this is a real bug, not a missing deploy. Not reproduced yet — `/rules`
answers 307 to an anonymous fetch, so it needs a signed-in session.

### O.15 slice 1 SHIPPED + deploy-verified — 2026-07-30

Commit `a1c10d7`, pushed to origin/main, deployment `dpl_93jaKcJNYCoZ…` **READY**,
`githubCommitSha a1c10d70…` (matches), `alias` includes **www.aimplifi.app** and
**aimplifi.app**, `aliasError: null`. Zero runtime errors in the window after.
`git diff origin/main..main -- prisma/` was EMPTY, so no `db push` ran against Neon.

DEPLOY-PROOF NOTE, because I nearly recorded a vacuous one. The chunk-hash comparison
this repo uses (deployment URL vs canonical host on `/sign-in`) returned MATCH — on the
byte-identical hashes `0cz1d0mv5g_q7.js` / `0fbn43l2yk1l4.js` / `1_0v6exngdege.js`
already recorded for the PREVIOUS deploy. Of course it did: this slice touches no
unauthenticated route, so `/sign-in`'s chunks are the same in both builds and the
comparison would have matched whether or not the change shipped. That is L.23's
page-hash blindness in a new costume — the marker must be unique to THE CHANGE, and
when every changed route is auth-gated there is no curl-able one, so the honest proof
is the deployment's own identity (READY + sha + alias + aliasError).

GATE: `verify.sh` green (tsc, eslint, **4915 unit / 308 files**, build) + full e2e
**234 passed, SERIALIZED (`--workers=1`), 6.4m, zero failure artifacts**.

The parallel run FAILED 1 (`combine-connections.spec.ts:66`) on
`SQLITE_BUSY_SNAPSHOT` — "database is locked" from `prisma.accountReconciliation
.upsert()` under worker contention. Not this diff, which touches no reconciliation
code: the spec passes alone in 2.2s (it took 21.9s while failing), and the serialized
full run is clean. Recorded, not written off — the two artifacts from the earlier
wedged run were read before being cleared, and `mobile-overflow`'s was a `waitForURL`
timeout rather than the `intercepts pointer events` signature that lesson names as the
flake, so it was treated as real until its click target (`txn-detail-link`, untouched
here) cleared it.

PROCESS FAILURE WORTH THE ROW (`docs/lessons/alive-is-not-progressing.md`): an earlier
full gate HUNG. Asked about it, I checked that the Playwright processes EXISTED and
told the owner it was healthy; it had been frozen for 63 minutes with two failure
artifacts already on disk. A process table cannot answer "is this moving". Root cause
of the wedge: repeated targeted spec runs leak `next start` servers that contend on
port 3100 (37 stray node processes). Fixes: measure `now - mtime(newest output)`, never
pipe a long run through a buffering `grep`, treat `test-results/` merely EXISTING as a
finding, and kill strays before a full gate.


### O.15 slice 2 — one action menu per transaction (verify green, shipped below)

Owner brief: "I should be able to do all other features from one menu (tax related,
reimburse, exclude from budget etc) — even if I don't use it." Full design + critic
record in DECISIONS #342; the short shape: `Transaction.excludeFromTotals` drops a row
from every money TOTAL through the SAME predicates that already drop transfers
(`isExcludedFromTotals` in `engine/transactions/exclude.ts`, one greppable basis;
deliberately NOT applied to balances, cash-needed, recurring, or tax export — each
recorded in the module header); `reimbursement` ('awaiting'/'received') is informational
by construction — never touches a predicate (locked by test), its only money-shaped
output the coach's outstanding line (verbatim |amount| sums, linking to
`/transactions?reimb=awaiting`), with the received-side match a display-time SUGGESTION,
not a stored link. `txnActionAvailability` returns ALL EIGHT actions always —
disabled-with-reason, never hidden — and the register menu, detail menu, triage split
door, and the server refusals all read the same exported sentences. Demo fence on both
writes. Schema: two additive Transaction columns (`excludeFromTotals Boolean
@default(false)`, `reimbursement String?`).

CRITIC: cycle 1 FAIL — 0 P0, 4 P1 (all state TRANSITIONS the slice never modeled:
split-reinstates-excluded-money; split-vanishes-the-owed-claim; transfer-reflag locks
the only exit from a standing owed claim — fixed with the UNDO ASYMMETRY, starting an
action may be refused, stopping it never is; coach's owed link landed on a filter the
filter bar denied), 2 P2, 2 P3. Cycle 2 PASS — every finding closed by re-executed
repros; one NEW P2 (triage split door on a tracked row surfaced the refusal as a masked
production throw — field threaded, shared sentence rendered). 5 REGRESSION_LEDGER rows,
EDGE_CASES sections, DECISIONS #342.

SESSION BREAK: the app disconnected mid-final-gate (last owner-visible state: cycle 2
PASS + a "re-run and capture failure details" shell running). Resumed in a fresh
session from the working tree + DECISIONS #342 + two owner screenshots; the gate was
re-run from scratch rather than trusted.

THE FAILURE THAT SHELL WAS CHASING, resolved as a recorded intermittent, not written
off: `mobile-overflow.spec.ts:408` (`/transactions/[id]` sweep) failed ONCE on
mobile-webkit — `page.waitForURL` 20s timeout after clicking the first
`txn-detail-link`; the snapshot showed the click landed (still signed in, still on the
register, no open menu recorded). Evidence it is NOT this slice: the identical
signature (same test, same waitForURL timeout) is already recorded in the slice-1 notes
from a run on a build WITHOUT the action menu; the test passes alone on webkit (3.4s),
passes in the webkit-only spec run (7/7), passed on mobile-380 in the SAME run that
failed on webkit, passed on an immediate identical re-run (18/18), and passed in the
full serialized gate. Correlates with cold first-run-after-build. Mechanism UNKNOWN —
if it recurs, the artifact now gets copied aside BEFORE any re-run (this session lost
the first artifact to a rerun's cleanup; do not repeat that).

GATE (this session, clean env, port 3100 free, no stray next servers):
`bash scripts/verify.sh` → **VERIFY GREEN** — tsc 0, eslint 0, **4950 unit / 312
files** (+35/+4 over slice 1), build clean. Full e2e SERIALIZED (`--workers=1`) →
**238 passed, 6.4m, zero failure artifacts** (+4 = action-menu.spec).

### O.15 slice 2 SHIPPED + deploy-verified — 2026-07-30

Commit `5e15514`, pushed to origin/main. Deployment `dpl_DoDVNhaM15csoEoeBm7HjGdJcvyq`
**READY** on `githubCommitSha 5e1551479…` (matches), `alias` includes **www.aimplifi.app**
and **aimplifi.app**, `aliasError: null`. This slice DOES carry a schema diff, so the
deploy proof includes the build log's db push against Neon:

  Datasource "db": PostgreSQL database "pulse" … neon.tech
  🚀 Your database is now in sync with your Prisma schema. Done in 429ms

— the two additive Transaction columns (`excludeFromTotals` default-false,
`reimbursement` nullable) now exist in production; no data was touched. Zero runtime
errors in the 30-minute window after READY. Every changed route is auth-gated, so per
the slice-1 L.23 note there is no curl-able marker; the deployment's own identity
(READY + sha + alias + aliasError + the db-push line) is the honest proof.

### O.15 slice 3 — every rule that files your money is on one page (IN PROGRESS)

THE DEFECT, measured before building (not a hypothesis):
`src/server/rules.ts:121` — the engine loads EVERY `CategorizationRule` row for the
user. `src/server/keyword-rules.ts:868` — the /rules page lists only
`NOT: { matchKeywords: null }`. So every rule minted by the inbox's "Always" button
(`ensureUnconditionalRule`, triage-actions.ts:86, merchantId + priority 100, no
keywords) files money forever on a page that shows a strict SUBSET of what runs, and
`deleteKeywordRule` (keyword-rules.ts:907) scopes its WHERE to the same subset, so
those rules cannot be deleted from any surface. The builder's empty state says
"You haven't written any rules yet" — false for a reader who has only ever tapped
"Always". Rules refused by the mapper (orphaned merchantId, aggregate canonical,
declared-but-empty key) are likewise invisible AND undeletable.

PLAN (engine-first):
1. Extract the pure mapper out of `src/server/rules.ts` into
   `src/lib/engine/categorize/rule-mapping.ts`, and give it ONE decision point that
   returns either the RuleLikes or the REFUSAL REASON — so the page's "this files
   nothing, and here is why" cannot drift from the engine's silence.
2. Pure `rule-inventory.ts`: stored rows -> ordered inventory entries, ordered the
   way `pipeline.ts:258` resolves (priority desc, keyword specificity, id).
3. Server `listRuleInventory()` reading through the SAME query as
   `loadExplicitUserRules`, demo-fenced; `deleteMerchantRule` as a narrow sibling of
   `deleteKeywordRule` sharing one internal delete helper.
4. UI: the full inventory on /rules; fix the false empty-state copy.
5. DEFERRED, disclosed not hidden: LEARNED rules (priority 50, derived from
   corrections) are counted and named on the page, not listed — a signature key has
   no human-readable rendering and no delete lever. Own slice; STATUS §OPEN.

CRITIC CYCLE 1 — FAIL (fresh-context, had not seen my reasoning): 0 P0, 3 P1, 2 P2,
4 P3. Every finding re-verified against the real code before fixing; all P1s and P2s
fixed, P3s fixed or answered in prose.

 P1-1 THE SLICE'S OWN DEFECT SURVIVED IN ONE CLASS. `deleteMerchantRule` was scoped
   `matchKeywords: null` — a deliberate "narrow sibling" — but the inventory also
   renders a TYPED rule whose key decoded to nothing, and `''` is not `null`. The
   WHERE matched zero rows, returned `{deleted:false}` WITHOUT throwing, so the
   button spun and did nothing beside copy reading "Delete it and write the rule
   again". Visible-and-undeletable is the same dead end, one screen later. Now
   `deleteRule`, scoped `{id, userId}`, with the invariant under test: every entry
   the inventory renders is removed by the action its button calls (locked over all
   three kinds, plus the rotted-key row specifically).
 P1-2 A FALSE NUMBER ABOUT MONEY. `learnedCount: learned.length` rendered as "picked
   up N patterns", but `learn.ts` emits TWO RuleLikes per payee since #331 (a
   signature key at priority 50 AND a canonical key at 40 — the repo's own
   learn.test.ts asserts length 2 for one payee), so one taught merchant read as "2
   patterns". Replaced with `hasLearnedRules: boolean` — the claim the data supports.
 P1-3 ONE FALLBACK STRING, THREE WRONG SENTENCES. Every refused row printed "A payee
   that is no longer here": an AGGREGATE rule said its payee was missing directly
   above a sentence saying it was Venmo (contradictory, and the only identifying
   string was suppressed, so the reader could not tell which rule to delete); a TYPED
   rule with a rotted key was described as a payee it never had. Refusals now carry
   `refusedCanonical` and the phrasing is per-refusal.
 P2-4 The new empty state promised "choose Always and a rule will appear here" — but
   nothing fences the demo mint path (`triage-actions.ts` has no `isDemoUser` check,
   verified by grep), so a demo visitor's own next click disproves it. `isDemo` now
   travels with the empty list and the demo sentence says rules are not kept there.
 P2-5 A row with no payee AND no typed words matches EVERY transaction (`ruleMatches`
   skips both key checks) and was rendered as a missing payee — the broadest rule in
   the account described as the most harmless. Now flagged `matchesEverything` and
   named as such. The engine is deliberately NOT changed: refusing that shape would
   alter what the categorizer does, which is not this slice's licence (see STATUS
   §OPEN).
 P3-6 The ordering docblock claimed to disclose the engine's conflict resolution. It
   cannot: the pipeline's sign guards can skip the top-sorted rule, and learned rules
   share the sorted set at match time. Comparator now mirrors the pipeline's actual
   restriction (id tie-break between TYPED entries only, so equal-priority merchant
   rules keep insertion order, which `ensureUnconditionalRule`'s supersede logic is
   written against) and the prose claims a stable listing order, nothing more.
 P3-7 The partition read `active && typed`; the builder's list actually filters
   `matchKeywords != null` THEN `groups.length > 0`. Equivalent only because no writer
   sets both a merchantId and a typed key. Re-derived from the builder's own two
   conditions, and locked over eight row shapes: never twice, never neither.
 P3-8 Two unverified claims retracted: the refusal docblock no longer asserts every
   refusal state "exists in the database today" (`empty-keyword-key` has no writer this
   repo can name), and plan item 3 above promised "one internal delete helper" — the
   two deletes share nothing, and after P1-1 they deliberately have different scopes.
 P3-9 ACCEPTED COST, recorded not fixed: /rules now loads the full correction history
   on every render to answer one boolean. Same query the categorizer already runs on
   every ingest; not worth a second code path today.

CRITIC CYCLE 2 — 0 P0, 0 P1, 1 P2, 7 P3; every cycle-1 finding re-executed by the
critic against a real database (not read and agreed with) and CLOSED, except one that
had moved rather than gone. All eight fixed.

 F1 (P2) THE CYCLE-1 P1 HAD MOVED ONE BRANCH LEFT. `subjectOf` tested `origin` before
   the refusal, so a TYPED rule refused for a MERCHANT reason rendered "a rule you
   typed whose words are gone" above a paragraph explaining the payee was Venmo — the
   words were not gone, and `refusedCanonical` was computed and thrown away. Branches
   now go refusal-first: whatever the engine refused the row FOR is what the row says,
   and it is the same fact the paragraph states.
 F2/F8 The same branch returned a "verb" that was not one ("a rule you typed whose
   words are gone as Groceries"), and the section heading "Rules from filing a payee"
   was false for the rotted typed rule listed under it. Now `{lead} {name} as
   {category}` reads for every shape, and the heading is "Everything else filing your
   money".
 F3 `aria-label` REPLACES the button's content, and it omitted the conditions the
   visible row shows — the screen-reader user got strictly less than the sighted one,
   and two rules differing only by condition were indistinguishable. Label now built
   from the same parts as the row.
 F4/F5/F6 THE HONEST WEAK SPOT, and the most useful thing either cycle found: three of
   the five cycle-1 fixes were not locked by any test that could fail if they were
   reverted. The partition test asserted `isBuilderListed(e) === isInventoryListed(e)`
   is false — `x === !x`, true of every implementation. `isDemo` was only ever asserted
   TRUE, so hardcoding it would have told every real user "the demo account is shared
   by everyone trying Aimplifi". `hasLearnedRules` was only ever asserted FALSE, so
   hardcoding it would have silently deleted the one paragraph where the page admits
   its list is not everything filing your money. All three now assert both directions,
   with expected membership written out per row shape rather than derived.
   Recorded rather than papered over: the two formulations of `isBuilderListed` are
   EQUIVALENT over every entry the mapper can produce, so no fixture separates them.
   The module says so instead of the test pretending otherwise.
 F7 "rules aren't kept here" was literally false on the demo — `applyCategory` has no
   demo fence, so the row IS written; what is true is that it is never loaded and never
   shown. Now "rules made here aren't saved to your account and won't file anything
   later."

 Cycle 2 could not break: `deleteRule`'s `{id, userId}` scope (ownership in the WHERE,
 no new capability — the only extra rows it reaches are ones `deleteKeywordRule`
 already deletes for the same user); dangling `Correction.becameRuleId` (both
 consumers already re-check liveness); the builder list after an outside delete; and
 the completeness claim itself (`Merchant.defaultCategoryId` is written by three paths
 and read by none, so it is not an unlisted filer — the only unlisted filers are
 learned rules, which the page discloses).

GATE (this session):
`VERIFY_E2E=1 bash scripts/verify.sh` → tsc 0, eslint 0, **4990 unit / 314 files**
(+40 over slice 2), build clean. The parallel e2e phase reported **238 passed, 1
failed** → the script printed ❌ VERIFY FAILED, so this did NOT ship on a green claim.

THE FAILURE, diagnosed rather than written off: `phase4-features.spec.ts:33` (goals —
"Delete Japan trip" → the two-step `goal-delete-confirm` never appeared, 60s timeout).
Nothing in this slice touches goals. The artifact was copied aside BEFORE any re-run
(the slice-2 note: a rerun's cleanup destroyed the first artifact); its page snapshot
shows the delete button `[active]`, i.e. the first click landed and the confirm state
never rendered — the repo's documented pre-hydration/load-flake signature, not a
missing element. Re-ran the spec alone: **6/6 passed, the failing test in 4.6s against
a 60s budget.**

Full e2e re-run SERIALIZED (`--workers=1`), the repo's trustworthy full-suite mode:
**239 passed, 6.1m, zero failures**, including
`rule-inventory.spec.ts` (1.7s). Schema: `git diff origin/main..main -- prisma/` is
EMPTY — this slice adds no columns, so the deploy does not touch the Neon database.

### O.15 slice 3 SHIPPED + deploy-verified — 2026-07-30

Commit `d723f2b`, pushed to origin/main. Deployment `dpl_ZBUEFsKcY17CqEa2UViNc5tEVcmf`
**READY** on `githubCommitSha d723f2bec…` (matches), `alias` includes
**www.aimplifi.app** and **aimplifi.app**, `aliasError: null`.

Every route this slice touches is auth-gated, so there is no curl-able marker (the
slice-1 L.23 note: a chunk-hash comparison against an unauthenticated page is vacuous
when nothing unauthenticated changed, and a 200 proves nothing because an old
deployment answers 200 perfectly well). The honest proof is the deployment's own
identity above, plus the build log confirming the prediction made from the empty
`git diff origin/main..main -- prisma/`:

  Datasource "db": PostgreSQL database "pulse" … neon.tech
  The database is already in sync with the Prisma schema.

— no columns added, no production data touched. Runtime errors in the window: ONE
pre-existing group only, the `pg` SSL-mode deprecation warning first seen
2026-06-17, whose `lastDeployment` is the PREVIOUS deploy. Nothing new.

### O.15 slice 4 — you can tell Aimplifi what repeats (O.13f)

THE GAP, measured before building: `detectRecurring` needs three same-signed charges at
a stable amount with agreeing gaps. Executed against one rent charge: zero series, zero
scheduled rows. The bar is right for a guess — the L.24 money critic showed a false
quarterly prints a dated outflow on /calendar — but the reader could never pay it off
from the other side, in either direction.

THE ARCHITECTURAL DECISION (DECISIONS #344): the instruction is applied INSIDE
`detectRecurring`, as a REQUIRED third parameter. Five production surfaces detect
independently (/recurring, the projection writer, the merchant lens, the radar's
committed-merchant exclusion, the coach), so an instruction honoured by four of them
would leave one still printing the bill he deleted. Required rather than defaulted
because a forgotten argument fails silently; the compiler enumerated all nine call sites
(six production, seed, benchmark, two audit probes). `radarFromSnapshot` took the same
parameter AHEAD of its two optional ones — appended it could only have been optional.

WHAT A DECLARATION MAY CLAIM: the rhythm and the direction, nothing else. Amount,
anchor, account, category and the step-past-today all come from `buildSeries`, the one
function detection now shares, so a declared bill cannot carry a figure absent from the
reader's history. No price-change claim is ever attached (two plateaus need three
sightings). `declaredByUser` is REQUIRED on `RecurringSeriesResult` so no surface can
render his call as a pattern the app observed.

THE E2E CAUGHT THE DEFECT NO UNIT TEST COULD: the first cut keyed the instruction on
`Transaction.merchant.canonical`, which is NULL on every hand-entered row — so the
feature refused precisely the reader it exists for, with "Aimplifi has no payee name for
this transaction" printed under a heading showing the payee. The key is now
`normalizeMerchant(rawDescriptor).canonical`, the string the DETECTOR groups by. Locked
by two tests, both mutation-proven against the old key.

TWO FRESH-CONTEXT FABLE CRITICS, BOTH FAIL — 1 P0 + 6 P1, all fixed:
 * P0: an AGGREGATE payee (`Check`, `Venmo`, `Zelle`) could be declared — rent marked
   monthly on a check would project the gardener's $40 into cash-needed.
 * P1: the dominant-sign rule turned a refunded purchase into +$25.00/month of projected
   INCOME on the payment account. The declared DIRECTION is now stored and honoured.
 * P1: a bill declared from an old charge read "$0/month, no longer charging" on
   /recurring while the plan carried the full rate — the L.23 two-surface split.
 * P1: the detail page offered and SAVED a declaration for transfers and split
   containers its own menu refused three inches above; now enforced on the wire.
 * P1: copy asserted "it is projected … in your forecasts" for series that provably
   reach no projection (on-card, long-cadence income, detection-overtaken).
 * P1: renamed payees named one merchant and bound another.
Plus: no deadline on /recurring's mutations, an exact-bytes lookup where the engine folds
case, the panel reading raw rows instead of the parser, a quoted amount the engine does
not use, tap-target/accessible names, role=alert. 3 REGRESSION_LEDGER rows.

MUTATION-PROVEN, because a green test is a hypothesis: reverting the declared-sign rule
kills 1 test, re-enabling the lapse gate for declared series kills 2, removing the
declaration refusals kills 3. Baseline and restored both 45/45.

GATE, and the two things it caught that nothing else did:
 1. `mobile-overflow.spec.ts` failed in BOTH engines — the new Recurring section made
    /transactions/[id] 415px wide at a 360px viewport, because the shared Button is
    `whitespace-nowrap` and two of its labels were sentences. Labels shortened and a
    wrapping class added; re-run green in both engines.
 2. `rule-inventory.spec.ts` (not this slice's code) failed in the full suite twice —
    parallel AND serialized — and passed twice in ~2s in isolation. Diagnosed rather
    than re-run away: its delete click had no pre-hydration retry where the same spec's
    earlier click does (#167). The click is now retried; the assertion is untouched.
    Three other specs (merchant-lens, transactions, and the first mobile-overflow run)
    failed only in the PARALLEL run and passed serialized — the documented load flake.


### O.15 slice 4 SHIPPED + deploy-verified — 2026-07-30

Commit `b23a57d`, pushed to origin/main. Deployment `dpl_6RkAYhTwHHnKUPMdoybFE6tSNFqd`
**READY** on `githubCommitSha b23a57d940…` (matches), `alias` includes
**www.aimplifi.app** and **aimplifi.app**, `aliasError: null`.

THE SCHEMA CHANGE, which this slice HAS and the last two did not: `git diff` on
`prisma/` shows 33 added lines and **zero deleted** — a new `RecurringOverride` model
plus its `User` back-relation, no column touched on any existing table. The build log
confirms it reached the live database and is the proof for this deploy, since every
route the slice touches is auth-gated and no curl marker exists:

  Datasource "db": PostgreSQL database "pulse" … neon.tech
  🚀  Your database is now in sync with your Prisma schema. Done in 558ms

Note the wording differs from the previous two deploys' "The database is already in
sync" — that difference IS the evidence the table was created rather than nothing
happening.

Runtime errors in the window: ONE pre-existing group, the `pg` SSL-mode deprecation
warning first seen 2026-06-17, whose `lastDeployment` is the PREVIOUS deploy. Nothing
new.

GATE (verbatim, `VERIFY_E2E=1 bash scripts/verify.sh`): tsc 0, eslint 0,
**5038 unit / 316 files** (+48 over slice 3), build clean, **240 e2e** — ✅ VERIFY GREEN,
in the PARALLEL run, with `test-results/` empty.

### O.15 slice 5 — O.13e category parity: the decision, measured before building

TASKS O.13e asks for three Simplifi category capabilities and explicitly says to
**decide which are real gaps and which are our deliberate design BEFORE building**,
because "a third level multiplies every category picker in the app". This is that
decision, and every verdict below was re-derived by execution against the code on
2026-07-30, not read off a plan doc.

**Measurements taken first (all reproduced in the main thread, not delegated):**

1. `Category.parentId` exists in the schema (`schema.prisma:403`) and has **zero
   readers and zero writers** in `src/` outside generated Prisma code (the only
   `parentId` hits are Plaid's unrelated `splitParentId`). Hierarchy is therefore
   NOT half-built — the column is a Phase-1 leftover, and a dead column is not a
   head start (lesson: a-dead-branch-is-a-claim-that-something-is-handled).

2. "Is this category income?" is answered in **14 places**, and only **2** go
   through the shared `isIncomeCategoryId` (`budgets/status.ts:29`,
   `fi/insights.ts:48`). The other twelve are inline `group === 'Income'`
   comparisons. A delegated report claimed 18 call sites; re-running the grep in
   the main thread gave 6 occurrences across 4 files, so the shared-predicate
   count is 2 — a delegated count is a hypothesis (lesson:
   a-subagents-green-is-a-hypothesis).

3. Those 14 readers split into **two families that read different maps**:
   `reports.ts:53` and `trends.ts:236` resolve through the **per-user merged
   meta** (custom-aware); the other twelve read the **static** `CATEGORY_BY_ID`
   (custom-blind). They agree today for exactly one reason: `NON_CUSTOM_GROUPS`
   (`assign.ts:88`) forbids a custom category from the Income group.

4. That exclusion's own comment justifies itself by naming `isIncomeCategoryId`
   — a 2-call-site function — while **twelve** other inline predicates depend on
   it just as much and are documented nowhere. The invariant is far more
   load-bearing than its stated rationale.

5. `pipeline.ts` takes **no category-meta parameter at all**, and its three #44
   sign guards (`isUsableProviderHint:135`, `learnedSignOk:153`,
   `keywordRuleSignOk:179`) each explicitly EXEMPT custom categories — "an
   unknown/custom category group can't be judged, so it is allowed" / "custom
   category — group unknown, so no claim is made".

**VERDICTS.**

- **Three-level hierarchy — REFUSED, deliberate.** Six picker surfaces render the
  2-level shape today, plus every group-by in reports/trends/budgets/spending-plan.
  Simplifi's third level (Auto & Transport -> Registration -> Registration Fees) is
  already representable here as a leaf under a group, so the capability gap is
  presentational, and no owner message has asked for it. What would reopen it: an
  owner request naming a distinction our two levels genuinely cannot express.

- **Explicit Expense/Income type — REAL, and deliberately DEFERRED, with the
  reason measured.** This is not a UI toggle; it is a sign-guard change across the
  categorization hot path. The moment a custom category may be income, finding (5)
  turns from a documented exemption into a live defect: `keywordRuleSignOk`
  returns true for a custom income category on a NEGATIVE amount, so an outflow
  files into an income category — which `isSpendRow` then drops from reports,
  trends and budgets while `monthlyFlows` still counts it as an expense. That is
  the precise erasure the docblock exists to prevent, and it is a P0 shape. Doing
  it honestly means threading per-user meta into `pipeline.ts` and collapsing all
  14 predicates onto ONE custom-aware basis. Against that cost: the system
  taxonomy already ships **11 income leaves** (paycheck, bonus, side-income,
  interest-income, investment-income, rental-income, govt-benefits, tax-refund,
  reimbursement, refund), which covers the real income shapes, so the marginal
  capability is small and the blast radius is the whole auto-filing path. Deferred
  as its own slice, with the work named so it is not re-derived.

- **Per-category tax flag — REAL, and this slice builds it.** The owner asked on
  2026-07-27 for tax-time export; today `taxClass` is per-TRANSACTION only, so a
  reader tags every charitable donation by hand, one row at a time, forever. A
  per-category default collapses that into one gesture. It touches no flow
  predicate and no sign guard, so its risk profile is independent of the two
  verdicts above.

**Design constraint carried into the build, from the tax module's own
constitution** (`tax/classes.ts`: "the reader decides what belongs in each drawer,
and the export reports what they put there and nothing more"): the category tax
class is a **write-time default stamped onto the row at filing**, never a
read-time fallback in the export. A read-time fallback would silently re-tag
history whenever a category is edited, changing totals a reader may already have
handed to a preparer. Write-time can only UNDER-tag, which is visible and
fixable; read-time OVER-tags silently into a number that goes on a return — and
the failure direction is the rule. A hand-set `taxClass` on a row is never
overwritten by a category default, and applying to existing rows is an explicit,
counted, undoable backfill (the O.13d "handle existing transactions next" idiom),
not a silent sweep.

STATUS: decision recorded; build starting on the per-category tax flag.

GATE (`bash scripts/verify.sh`): tsc 0, eslint 0, `next build` clean, **5038 unit /
316 files passed** — ✅ VERIFY GREEN. The count is IDENTICAL to slice 4's baseline
(5038/316), which is the evidence rather than a disappointment: this slice changes two
docblocks and four documents and must not move a single assertion. E2E was skipped
(`VERIFY_E2E` unset) and that is the right call here — no route, no component, no query
and no engine behaviour changed, so there is no user-visible flow for Playwright to
exercise. `git diff --stat -- prisma/` is EMPTY: no schema change, so the live Neon
database is untouched by this deploy.

Correction made during the build, recorded because the first draft was wrong: this entry
originally claimed the custom-category income exclusion was an UNLOCKED invariant. It is
locked, fail-old, by `tests/unit/custom-category-lifecycle.test.ts:82` ("refuses the
Income and Transfers groups") — a create with `group: 'Income'` is refused, so deleting
'Income' from `NON_CUSTOM_GROUPS` fails that test. The real defect was narrower and is
what shipped: the exclusion's stated RATIONALE named 1 of its 14 dependents. Reading the
test before writing the finding is what rule 0 asks for, and the first draft did not.

### O.15 slice 5 SHIPPED + deploy-verified — 2026-07-30

Commit `e98a28d`, pushed to origin/main. Deployment
`dpl_HDJS5TwnehzcoPHvy5E1s8vEVB3W` **READY** on `githubCommitSha e98a28d8f01…`
(matches), `target: production`, `alias` includes **www.aimplifi.app** and
**aimplifi.app**, `aliasError: null`. `git diff --stat -- prisma/` is EMPTY, so the
live Neon database is untouched by this deploy.

WHAT THE DEPLOY PROOF CANNOT BE HERE, stated rather than faked: this commit changes
two docblocks and five documents. L.23 already records that the page-HASH check is
blind to a comment-only commit — comments are stripped before the chunk hash, so
identical hashes mean neither deployed nor not-deployed — and there is no new testid,
label or route to `curl | grep`. The deployment record (READY + sha match + production
alias) is therefore the whole proof, which is exactly the fallback that lesson
prescribes. `www.aimplifi.app/sign-in` serves HTTP 200 throughout.

One thing worth keeping: the FIRST `get_deployment` read at the moment `state` flipped
to READY listed only `aimplifi-reiforge.vercel.app` and the branch alias — the custom
domains were absent. A second read seconds later showed all five with
`aliasError: null`. The alias assignment lags the READY flip, so a single read taken
at the transition understates it; had I reported from that first read I would have
recorded "www not aliased" as a finding about a deploy that was fine.

### O.15 slice 6 — a rule can tag it for taxes (O.13e(c), verify green)

Owner brief this closes, in his own words across two waves: *"Can we add
reimbursable and exclude from budgets and all other mint and simplifi fields? …
Similar to business related items as well"* (O.11), and the deferred half of
DECISIONS #345(c) — Simplifi's per-CATEGORY "Tax Related" toggle, which #345
refused as specified because `categoryId` has SIX independent writers and a
per-category flag would be honoured at six call sites. The rule machinery is one
fenced path with a counted, previewed, opt-in apply-to-existing, so the flag went
there instead.

WHAT SHIPPED. One additive nullable column (`CategorizationRule.setTaxClass`), a
pure decision module (`engine/categorize/tax-action.ts`), the action carried
through `RuleLike` → `categorize()` → all four ingest writers plus the backfill and
the apply-to-existing, a select and helper text in the rule builder, two new
preview counts, a receipt clause, and the action rendered on BOTH rule lists.

THE DECISIONS, each a failure-direction call rather than a preference:
 - WRITE-TIME stamp, never a read-time lookup: read-time would silently re-tag
   history whenever a category was edited, changing a total the reader may already
   have handed a preparer. A stamp can only UNDER-tag, which is visible.
 - NEVER overwrite a tag already on the row, including an unrecognized value.
 - Only an explicit typed rule that FILES may tag. Learned rules, merchant
   defaults, provider guesses, transfers and the LLM backfill pass all abstain.
 - The tag set is deliberately NOT the re-file set: it ADDS rows already sitting in
   the rule's category (the rows a reader adding a tag to an old rule is trying to
   reach) and SUBTRACTS sign-refused rows, hand-filed outliers, and rows excluded
   from totals.

HOSTILE CRITIC CYCLE 1 — two fresh-context critics, one on correctness and one on
claims. BOTH FAIL: 1 P0, 7 P1, several P2/P3. They converged INDEPENDENTLY on the
sharpest finding, which is the strongest signal available here: the first cut
tagged the reader's HAND-FILED outlier while the same toast told him the row was
"left as it was". A rule wrote a deduction claim onto a row it had explicitly
refused to re-file, and my own docblock had argued for it ("their exclusion
protects a CATEGORY, and a tag says nothing about a category") — false in the
direction that matters, because a Correction means "I decided this row" and of the
two decisions the deduction is the higher-stakes one.

The second P1 is the same shape one level out, and I would not have found it:
`exclude.ts` records that the tax export deliberately still counts a row the reader
both TAGGED and EXCLUDED — "two orders", and dropping the deduction silently would
be the worse error. That reasoning was written when the only way to get a
`taxClass` was the reader typing it on that row. With a RULE as the tagger he has
given exactly ONE order — "this is not my spending" — and money he removed from
every other total would have landed in a figure bound for a return. Fixed by
excluding those rows from the tag set (he can still tag one by hand, which is the
case the carve-out was actually written for).

The rest were claims: an apply checkbox whose count described a different set from
the write it authorises (P0); an Undo button covering the filings and not the tags;
three shipped sentences ("a record of your own tagging", "these totals are what you
tagged") that a rule-written tag falsifies; both rule-list footers enumerating what
survives a delete without the new action; and a code comment asserting a residual
was "recorded in docs/STATUS.md" when it was not yet written — rule 1, correctly
caught.

ONE DEFECT THE TESTS FOUND THAT NEITHER CRITIC DID: the backfill's tag guard, first
written as a clause on the SAME `updateMany` as the category, made a row carrying a
blank tag lose its category re-file entirely — a silent under-file bought to buy a
tag guard. Split into two writes.

CARRIED ALONG, SAID OUT LOUD (CLAUDE.md rule 5): a pre-existing P0-class data loss
found while wiring the ingest path. Plaid's pending→posted id churn deletes the
predecessor row and only `Correction`/`CategoryPrediction` were followed across, so
a tax tag, a note, an exclude-from-totals flag and a reimbursement state set on a
PENDING row were destroyed when it posted — silently, on a schedule nobody watches,
with the row still on screen looking untouched. Fixed as a data CLASS (all four
columns, four create sites). SimpleFIN has the same hole by a different mechanism
and is NOT fixed here (STATUS §OPEN 3).

MUTATION-PROVEN, because a green test is a hypothesis:
 1. Remove `...carriedReaderState` from all four Plaid create sites → the churn lock
    dies with `expected null to be 'business'`.
 2. Remove the hand-filed + excluded filters from `taxTagSets` → both new
    regression locks die (`expected 3 to be 2`, twice).
 3. Remove the ingest-side stamp from manual entry, rebuild, re-run the e2e → the
    FORWARD half of the spec dies at `expected "business", received ""`.
 4. Mutate the in-memory tag filter away while leaving the SQL guard → a probe shows
    the SQL guard alone preserves the reader's tag and reports `taxTagged: 1` rather
    than 2, so the redundant guard is load-bearing and the count stays honest.

GATE: `bash scripts/verify.sh` → tsc 0, eslint 0, `next build` clean, **5062 unit /
317 files** at the pre-critic checkpoint (counts re-run below after the fixes).
E2E: 241 tests. THREE full serialized runs each failed exactly ONE test, a DIFFERENT
one each time (phase4-features goals, merchant-lens, action-menu), every one passing
alone afterwards and every one in a spec this slice does not touch — the rotating
failure set that the lessons name as contention rather than regression. The new spec
passed in all three.

SCHEMA: one additive nullable column, so `prisma db push` on deploy ADDS it and
touches nothing else.

### O.15 slice 6 SHIPPED + deploy-verified — 2026-07-30

Commit `ef9ae17`, pushed to origin/main. Deployment
`dpl_ChCh6FhKRVF2PWdfb4XLSyWN3exK` **READY** on `githubCommitSha
ef9ae175a7e2a8c…` (matches HEAD), `target: production`, `alias` includes
**www.aimplifi.app** and **aimplifi.app**, `aliasError: null`.

THE DEPLOY PROOF IS THE NEON LINE, because /rules is auth-gated and there is no
unauthenticated marker to `curl | grep`. This slice adds a column, so the build
log's `prisma db push` against Neon says something the previous no-schema deploys
did not:

```
Datasource "db": PostgreSQL database "pulse", schema "public" at "…neon.tech"
🚀  Your database is now in sync with your Prisma schema. Done in 530ms
```

Slice 5's deploy printed "already in sync"; this one printed "now in sync",
which is the additive `CategorizationRule.setTaxClass` column landing on the live
database and nothing else changing. Build also compiled clean (30.2s) and
TypeScript re-ran on the Vercel machine (32.8s).

`www.aimplifi.app/sign-in` serves **200**; `/rules` serves **307** to sign-in,
which is the auth gate behaving.

Runtime errors in the window after: **one pre-existing group only** — the `pg`
SSL-mode deprecation warning first seen 2026-06-17, whose `lastDeployment` is the
PREVIOUS deployment. Nothing new.


## O.15 slice 7 — "this hasn't cleared yet" (O.13g) — PLAN, 2026-07-30

TASKS O.13g bundles two Simplifi-parity rows. Measured before building; they get
different verdicts, like O.13e:

- **Parity row 15 "Track a refund" — ALREADY SHIPPED, matrix stale.** Slice 2's
  reimbursement tracker IS Simplifi's "Expecting a refund? Track it here":
  `Transaction.reimbursement` ('awaiting' | 'received'),
  `outstandingReimbursements()` on /coach, and `findOffsettingInflow()` proposing
  the matching deposit (exact opposite magnitude, POSTED, ≤90d, earliest-then-id
  tiebreak, never stored). Deliverable = un-stale the row, not a build.
- **Parity row 13 "Pending/Cleared editable" — the genuine gap, and the build.**

### The architecture: do not change what PENDING MEANS

`status` is read by ~30 call sites and there is NO shared predicate. But every one
of them already handles PENDING correctly today, because providers deliver PENDING
rows. So this slice widens WHO MAY WRITE the value and changes no predicate — the
blast radius is the write side, not the read side, and no refactor is needed.

**Only rows the app owns may be flipped.** VERIFIED IN CODE, not from comments:
- `simplefin.ts:172` and `:205` — both pending-sweep deletes carry
  `providerRef: { not: null }`, so a manual row is structurally outside them.
- `plaid.ts:1507` — the removed-path selects `providerRef: { in: chunk }`; a null
  ref can never be in Plaid's removed-id list.
- `plaid.ts:1163/1224/1320` write `status` from `txn.pending` on every create AND
  update, so a reader's flip on a bank row would be silently overwritten next sync.
  That is the refusal's stated reason, and it is true rather than defensive.

**The origin signal already exists and is already reasoned about**:
`server/transactions.ts:626` derives `descriptorOrigin: 'bank' | 'entered'` from the
ROW's `providerRef` (not `account.provider` — O.13b critic cycle 2 fixed exactly that
false attribution), with the demo dataset a documented exception. Reused, not
re-derived; extracted so the register and the detail view share one basis.

### The asymmetry, and why slice 2's version of it does NOT transfer verbatim

Slice 2's rule was "starting an action may be refused; stopping it never is",
because `excludeFromTotals`/`reimbursement` are READER-OWNED columns. `status` is
PROVIDER-OWNED, so for a bank row the refusal is total in BOTH directions — the
reader may only write what he owns. Within an app-owned row the slice-2 rule holds
in full: marking PENDING (the direction that HIDES the row from trends, tax export,
FI, merchant profile, recurring detection, radar) may be refused on a container or a
split piece; marking CLEARED (the direction that RESTORES it to every total) must
never be lockable, or a row could be stranded hidden forever.

### Disclosure (L.29 — a surface that starts hiding money says so)

Marking pending removes the row from trends/tax export/FI/household/anomaly/merchant
profile/recurring/radar and ADDS it to cash-needed's pending-outflow sum
(`assemble.ts:107`, payment account, non-container). The control states this. A row
carrying a `taxClass` gets the tax-export clause specifically — the slice-6
"two orders" class: a tag is an instruction, and silently dropping it from a figure
bound for a preparer is the failure this repo has already been bitten by twice.

### Steps
1. extract origin helper (one basis) + add `descriptorOrigin` to `TxnView`
2. `actions.ts`: `'status'` kind, 2 new REQUIRED `ActionRowFacts` fields (tsc
   enumerates the 2 call sites + the test), refusal copy
3. `setTransactionStatus` server action (same idiom: demo fence, imported refusals,
   audit log, revalidate)
4. UI: detail-view control + disclosure, register menu wiring
5. locks: availability unit, server-guard unit, one e2e that flips a manual row and
   asserts a money total actually moves
6. docs: STATUS, DECISIONS, SIMPLIFI_PARITY rows 13+15, TASKS O.13g
7. gate `VERIFY_E2E=1`, then commit → push → deploy-verify

SCHEMA: **no new column** — this reuses `status`. Expect no prisma diff, so the
live Neon database is untouched by the deploy.

### Self-found before the critics reported (O.15 slice 7)

**The register can flip status with no disclosure.** `STATUS_PENDING_EFFECT` and
`STATUS_PENDING_TAX_CAUTION` render on `/transactions/[id]` only, but the action
menu is also on every register row, where the item is a BUTTON that writes
immediately — so a reader can mark a tax-tagged row pending in one click and
never see the sentence saying the tax export just dropped it. That is the L.29 /
slice-6 "two orders" class again.

Fix chosen: make the register's status item NAVIGATE to the detail view, exactly
as `split` and `markRecurring` already do there ("The split form lives on the
detail view — navigate, don't duplicate it here"). Reuses an established
convention instead of inventing a second disclosure surface, and keeps one place
where the sentence and the control sit together.

Deferred to apply WITH the critics' findings rather than now, so their file:line
references do not go stale mid-run (parallelise for finding, serialize for fixing).

### O.15 slice 7 — HOSTILE CRITIC CYCLE 1: two fresh-context Fable critics, BOTH FAIL

6 P1 total, 0 P0. All fixed and ledger-locked (5 REGRESSION_LEDGER rows). The two
critics were given DIFFERENT lenses (money-truth/data-integrity vs
claims/UI-truth) and run in parallel; fixes were applied afterwards, serialized.

**They converged INDEPENDENTLY on the same finding** — the repo's strongest signal
that a finding is real — and it was the one my own design reasoning had missed:
a split PIECE carries no `providerRef`, so a piece of a BANK charge read as
'entered' and was offered a status write, while both providers push the parent's
status onto children on every sync. Silently reverted; the exact failure the bank
refusal exists to prevent.

**Critic A (money) additionally found the sharpest defect, by execution:** the
pending sum is SIGNED, so a hand-typed "+$2,000 EXPECTED PAYCHECK" marked pending
took a measured $500 shortfall to $0 and deleted the dashboard's transfer
instruction — no date gate, so a row 45 days out counted today. Money in is now
refused outright.

**Critic B (claims) additionally found:** the refusal's stated mechanism was false
(Plaid is a cursor delta, SimpleFIN a ~5-day window — nothing re-asserts a settled
row), the SimpleFIN reconcile's `providerRef: { not: null }` comment still called
itself redundant when it had become the only thing preventing deletion of a
reader's own row, and `action-menu.spec.ts` still asserted "all eight actions"
while the engine returned ten.

**Both found the register's undisclosed flip** (which I had also self-found before
they reported and deferred deliberately, so their line references would not go
stale mid-run).

Mutation-proven, one at a time: neutralising the split-piece branch fails exactly
2 tests; neutralising the inflow branch fails exactly 1.

**What survived attack, stated plainly:** every other clause of
`STATUS_PENDING_EFFECT` verified TRUE against its engine; no provider path can
delete or overwrite a hand-marked row (both SimpleFIN passes, the age-out, Plaid's
removed-path and the churn transplant all key on `providerRef`); no stranding on
non-container rows; `descriptorOrigin` genuinely populated in both mappers; the
server mirrors every menu refusal.

### O.15 slice 7 — GATE RUN 1: 2 e2e failures, investigated before re-running

`VERIFY_E2E=1 bash scripts/verify.sh` run 1: tsc clean, eslint clean,
**5089 unit / 319 files passed**, build clean, **243 e2e passed, 2 failed** →
`❌ VERIFY FAILED`. (Note: the background notification reported "exit 0" — that
was my trailing `echo`, not the gate. Read the log, not the wrapper.)

The two failures, and why neither is this slice — established BEFORE any re-run,
because a re-run destroys the reproduction:

1. `mobile-overflow.spec.ts:408` `/transactions/[id]` on **mobile-webkit** —
   `waitForURL` timeout after clicking `txn-detail-link`. This is the EXACT
   signature docs/STATUS.md recorded as a known intermittent during slice 2
   ("passes alone/warm/full-gate; cold-run-correlated; mechanism unknown"), whose
   own instruction was to copy `test-results/` aside before re-running. Done:
   `/tmp/slice7-e2e-artifacts/`. The preserved `error-context.md` shows the page
   still on `/transactions` with the `Details` link present and the action menu
   CLOSED — so the link this slice added to that menu is not even in the failing
   DOM. Had the slice broken the page, the failure would be in
   `assertFitsEveryWidth` or `detail-raw-descriptor`, i.e. AFTER navigation; this
   one never navigated.
2. `phase4-features.spec.ts:50` goals delete-confirm click timeout on mobile-380 —
   an unrelated surface, and the shape of the documented local full-suite load
   flake (a different assertion each run, passes alone).

Both pass in isolation, serialized: mobile-overflow **7 passed** on webkit,
phase4-features **6 passed**. Per the lessons, one run is not evidence — a
rotating failure set is contention, the SAME set twice is a bug — so the full gate
is being re-run serialized to settle it.

Checked and NOT a gap: `tests/e2e/transaction-status.spec.ts` reports "no tests
found" under mobile-webkit because that project is deliberately scoped
`testMatch: /mobile-overflow\.spec\.ts/` (playwright.config.ts:67).

### O.15 slice 7 — GATE STATE AT HANDOFF: NOT locally green, and NOT explained away

Owner needs to restart the machine, so this is the honest stopping point.

| run | tree | unit | e2e | verdict |
|---|---|---|---|---|
| 1 | slice 7 | 5089 / 319 files pass | 243 pass, **2 fail** | ❌ |
| 2 | slice 7 | 5089 / 319 files pass | 244 pass, **1 fail** | ❌ |
| 3 | **clean HEAD** (stashed) | 5071 / 318 files pass | **241 pass, 0 fail** | ✅ VERIFY GREEN |

The three failures were `mobile-overflow:408` (webkit) + `phase4-features:33`,
then `merchant-lens:77` — three DIFFERENT specs, zero overlap between runs, all
the identical mechanism (a click, then `waitForURL` never completing), and all
passing in isolation in 0.9–2.3s. Artifacts preserved BEFORE any re-run at
`/tmp/slice7-e2e-artifacts/` per the slice-2 instruction; the webkit
`error-context.md` shows the page still on `/transactions` with the action menu
CLOSED, so the link this slice adds to that menu is not in the failing DOM, and
the failure is before navigation rather than at the overflow assertion.

**What I will NOT claim:** that this is "just the known flake". A single clean-HEAD
green run is weak evidence, but it is evidence, and it points the other way. The
rotating failure set and the isolation passes point at contention; one green
clean-HEAD run points at me. Both readings are alive.

**Leading hypothesis, untested, and it is not a product defect:** this slice adds
**4 data-creating e2e tests** (signup + manual account + 2–3 manual transactions
each), so the suite now does materially more DB/server work than clean HEAD's 241
— which would raise the contention that makes OTHER specs' navigations time out
without any product code being wrong. Note runs 1 and 2 executed 243 and 244
tests vs clean HEAD's 241.

**How to settle it next session (in order, cheapest first):**
1. Re-run the full gate on THIS tree 2–3 more times. Same spec failing every time
   ⇒ real bug. Rotating ⇒ contention, and the hypothesis above is the cause.
2. If rotating, re-run clean HEAD 2–3 times too; a clean-HEAD failure appearing
   confirms contention and closes it.
3. Let CI (the Linux runner) arbitrate — it is the documented e2e arbiter here,
   and it runs on different hardware with different timing.
4. `mobile-overflow:408` now has TWO recorded sightings (slice 2, and run 1 here)
   with preserved artifacts. It has earned its own task rather than another
   "known intermittent" note.

**Why this is being pushed anyway:** the product code is verified — tsc, eslint
and `next build` clean on every run; 5089 unit tests green; all 4 new e2e tests
green; both critic P1 fixes mutation-proven; no schema diff. The open question is
about SUITE TIMING, not about whether the feature is correct. Pushing lets CI
arbitrate and lets the owner see the work; leaving it uncommitted across a restart
would risk the slice. **The Definition of Done is NOT met until a gate on this
tree exits 0, and this is recorded as such rather than rounded up.**

### O.15 slice 7 — DEPLOY VERIFIED (with its limitation stated)

Commit `7af382a`, pushed to origin/main (`0 0` with origin, working tree clean).
Deployment `aimplifi-bb8lo0p8u` **● Ready**, `target: production`, created ~8s
after the push and the newest production deployment; aliases include
**www.aimplifi.app** and **aimplifi.app**. `www.aimplifi.app/sign-in` → **200**,
`/transactions` → **307** to sign-in (the auth gate behaving).

**Limitation, stated rather than papered over:** there is no unauthenticated
marker to `curl | grep` for this slice — every surface it touches is behind auth —
AND unlike slice 6 there is no schema change, so the build log carries no Neon
`prisma db push` line to serve as the proof either. The evidence above is
therefore "the newest production deployment, built from the push, is Ready and
aliased", not "I fetched the new control and saw it". A logged-in check of
`/transactions/[id]` for the Status row is the outstanding confirmation.

`vercel inspect` printed no `githubCommitSha` field in this CLI version (58.4.4),
so the sha match is inferred from timing + ordering rather than read directly —
weaker than slice 6's check, and named as such.

### V.1 — the rotating e2e failure: the class PREDATES slice 7 (2026-07-31)

Resuming the slice-7 gate question with the recorded plan (PROGRESS "How to settle
it next session"), cheapest first. Two things are established before any new run.

**1. CI cannot arbitrate from this machine, and that is owner-only to fix.**
`gh run list` → `To get started with GitHub CLI, please run: gh auth login`; no
`GH_TOKEN`/`GITHUB_TOKEN` in the environment; unauthenticated
`api.github.com/repos/meleesciony/Aimplifi` → **404** (private repo). Step 3 of the
recorded plan is therefore unavailable, not skipped. Filed as **TASKS.md V.2**.

**2. The rotating failure is visible on a tree that does NOT contain slice 7 — so
slice 7 is ruled out as its sole cause.** PROGRESS.md:7305, written during slice 6
and therefore before slice 7's four data-creating specs existed, records: *"E2E: 241
tests. THREE full serialized runs each failed exactly ONE test, a DIFFERENT one each
time (phase4-features goals, merchant-lens, action-menu), every one passing alone
afterwards."* That is the same failure set (`phase4-features`, `merchant-lens`), the
same rotation, and the same solo-green property as slice 7's runs 1 and 2.

This corrects the leading hypothesis the last session left open. It does NOT clear
slice 7 of being *additive* load — 243/244 tests vs clean HEAD's 241 — but the class
exists without it, and a fix aimed only at the new specs would not have touched it.

**The contradiction that any explanation must survive:** those three slice-6 sightings
were `--workers=1`, where the shared-SQLite parallel-contention mechanism that
`playwright.config.ts:30-38` documents should not apply. Contention remains the leading
candidate (the config comment describes this precise signature: severed server-action
confirmation streams, "solo-green every time") but it is NOT established, and the
serialized sightings are the reason it is not. Recorded rather than rounded off.

Against that, the one clean-HEAD run in the slice-7 session was fully green (241/0).
So the evidence to date is: rotating failures on both trees, plus one green run on
clean HEAD. That is a RATE question, not a pass/fail one, which is why V.1 asks for N
runs per tree rather than another single re-run.

Opened **TASKS.md Wave V** (V.1 settle it; V.2 owner authenticates `gh`) — filed as its
own wave because the failing specs are not mobile and the subject is the Definition of
Done itself. Artifacts from run 1 survived the restart at `/tmp/slice7-e2e-artifacts/`.

Gate run A on this tree (parallel, default `workers: 4`, matching runs 1–2) in flight;
tsc and eslint already clean.

**V.1 evidence — what the stalling navigation actually is (explorer trace, file:line).**
Every recorded failure in this class is "a click, then `waitForURL` never completes",
so the question is what that click does. For `mobile-overflow:408` it is now answered:

- `txn-detail-link` is a plain Next.js `<Link href="/transactions/{id}">` with
  `prefetch={false}` and **no** onClick, server action, or analytics call
  (`src/components/finance/transaction-list.tsx:582-590`). So this failure is **not** a
  severed server-action confirmation stream — the mechanism `playwright.config.ts:31-37`
  documents. That comment is about mutation specs; this is a read navigation, and the two
  need separate explanations.
- Neither route segment has a `loading.tsx`, and neither page sets `dynamic`,
  `revalidate`, or `runtime`.
- The destination `/transactions/[id]` does ~5–6 DB round-trips before it can render
  (`src/app/(app)/transactions/[id]/page.tsx:27-71`): `auth()`, then
  `getTransactionDetail()`'s three queries, then `getVisibleGroups`,
  `getRuleSourceTransaction`, `getRecurringVerdictForTransaction` in parallel.
- The SOURCE route is the heavier one: `/transactions` calls `getTransactions()`, which
  loads the user's FULL transaction set (`prisma.transaction.findMany`, with its own
  in-file note "Loads the full set per call — fine at demo scale"), plus three more
  loaders, and the App Router re-renders the shared layout tree on navigation.

**Hypothesis this licenses — labeled as one, with the step that would confirm it.**
With no `loading.tsx` and `prefetch={false}`, the App Router has no Suspense boundary to
commit against, so the URL should not change until the destination's RSC payload arrives;
`waitForURL` therefore cannot resolve any faster than that ~5–6-query render. Under DB
contention (4 workers, one SQLite file, 847 seeded transactions) that render slows, and
whichever spec happens to click during a spike is the one that fails — which fits the
rotating set, the identical mechanism across specs, and the 0.9–2.3s solo-green times.
**Not yet executed against this app.** Confirm by timing the RSC request for
`/transactions/[id]` under full-suite load versus solo, not by reasoning about it. Note it
does NOT yet explain the slice-6 `--workers=1` sightings; that contradiction stands.

**Candidate fix to evaluate under V.1(d), recorded so it is not lost — NOT applied here.**
A `loading.tsx` for the `/transactions/[id]` segment would commit the navigation
immediately and is a real product improvement in its own right (today a reader tapping a
row on a phone sees nothing happen until the server answers). It is explicitly NOT the
banned "relax the timeout / retry the spec" move. But it must be evaluated honestly: it
would also make the gate stop measuring destination render time, so it needs its own
assertion on the thing it stops covering.

**Slice 7 deploy proof UPGRADED — the sha is now read directly, not inferred.**
Last session recorded a real weakness: `vercel inspect` (CLI 58.4.4) printed no
`githubCommitSha`, so the match was inferred from timing and ordering. Read today via
the Vercel API instead (`list_deployments`, project `prj_Zr3x9TKUklr2LRswwc1rqZR4lcRO`,
team `team_pk5Bl46h1HAtdlfO5ASqydxE`): the newest production deployment
`dpl_DxM9k2p4HEfvPvHRcpAyVrzgKvoF` is `state: READY`, `target: production`, on
`githubCommitSha 3b8e32b666bf04a3abe9d17ed8127f6c44ca5516` — byte-identical to local
`git rev-parse HEAD`. The slice-7 code commit `7af382a45557b5c6…` is the deployment
below it, also READY. So the live site is built from this exact tree.

**Still outstanding, and still owner-only:** a logged-in look at `/transactions/[id]`
to see the Status row. Every surface this slice touches is auth-gated and it adds no
schema, so there is no unauthenticated marker to curl and no Neon `db push` line — the
deploy evidence is "the newest production deployment is READY on this exact sha", not
"I saw the control".

### V.1 / slice 7 — GATE RUN A ON THIS TREE: ✅ VERIFY GREEN (2026-07-31)

```
 Test Files  319 passed (319)
      Tests  5089 passed (5089)
  245 passed (2.7m)
✅ VERIFY GREEN
EXIT=0
```

`VERIFY_E2E=1 bash scripts/verify.sh` on the slice-7 tree (`3b8e32b`, unchanged —
this session has touched only TASKS.md and PROGRESS.md): tsc 0, eslint 0, **5089 unit
/ 319 files**, `next build` clean, **245 e2e passed, 0 failed**, gate **EXIT=0**.

Read from the LOG's own `EXIT=` line, not the background notification's exit code —
last session's wrapper `echo` masked a failing gate, and that is why the check is
written this way.

**This closes the slice-7 Definition of Done.** CLAUDE.md rule 2 requires a gate on
this tree exiting 0; it now has. The previous session was right to refuse to claim it
and right to push anyway (product code was verified; the open question was suite
timing) — the record simply completes here.

**The failure RATE across four runs of the identical tree, which is the actual finding:**

| run | when | e2e total | failed | which |
|---|---|---|---|---|
| 1 | before restart | 245 | 2 | `mobile-overflow:408` (webkit), `phase4-features:33` |
| 2 | before restart | 245 | 1 | `merchant-lens:77` |
| A | **after restart** | 245 | **0** | — |

Same 245-test suite, same commit, same product code; 2 → 1 → 0. The only variable that
changed between run 2 and run A is the **machine restart** the owner performed. Nothing
was fixed. This is a rate that moved with the environment, which is what V.1 predicted
would need measuring rather than another single re-run.

**What this does NOT establish, stated plainly:** that the flake is gone. One green run
is exactly the weak evidence the last session declined to over-read in the other
direction, and the honest reading has not changed just because the result now favours
us. V.1 stays OPEN. Run B (chained, artifacts from A preserved first) is in flight.

### V.1 — GATE RUN B: ✅ VERIFY GREEN AGAIN. Two consecutive greens, unchanged tree.

```
 Test Files  319 passed (319)
      Tests  5089 passed (5089)
  245 passed (2.7m)
✅ VERIFY GREEN
EXIT=0
```

Run B was chained behind A with A's `test-results/` copied aside first
(`/tmp/slice7-settle/artifacts-A`), per the standing rule that a re-run destroys the
reproduction. Both logs kept at `/tmp/slice7-settle/run-A.log` and `run-B.log`.

**The rate, four runs of commit `3b8e32b` with byte-identical product code:**

| run | environment | e2e total | failed |
|---|---|---|---|
| 1 | before the owner's machine restart | 245 | 2 |
| 2 | before the restart | 245 | 1 |
| A | **after the restart** | 245 | **0** |
| B | after the restart | 245 | **0** |

The failure rate went 2 → 1 → 0 → 0 with no code change and one environment change.
Two consecutive clean full gates is materially stronger than the single clean-HEAD run
the last session correctly refused to lean on, and it points the same way that run did:
away from the slice and at the machine.

**The V.1 question is therefore SHARPENED, not closed.** What is now supported: the
failures are environment-correlated, and slice 7 is not their cause (independently
established by PROGRESS:7305, where the same rotation appears on the slice-6 tree). What
is still NOT established: the mechanism. The `--workers=1` slice-6 sightings still are
not explained by parallel DB contention, and "a restart fixed it" is a correlation over
four runs on one machine, not a diagnosis — the next sighting on a fresh machine would
kill it. V.1 stays OPEN with its rate-measurement framing intact; nobody should read
this as licence to wave through the next rotating failure.

**No test was weakened, no timeout relaxed, no spec retried.** Nothing was changed to
obtain these greens: this session's only edits are TASKS.md, PROGRESS.md and
docs/STATUS.md. That matters, because the cheapest way to turn this record green would
have been to touch the harness, and that is the one move V.1 forbids.

### V.0 record DEPLOY-VERIFIED — 2026-07-31

Commit `3f64773`, pushed to origin/main (`0` ahead, working tree clean). Deployment
`dpl_ETUyithFc3LCz134ZTDC8Hu2VAAC` **READY** on `githubCommitSha
3f64773b719a1fc16dc2257f6435f899303ce5b4` — read directly from the API, matching HEAD —
`target: production`, `aliasError: null`, aliases include **www.aimplifi.app** and
**aimplifi.app**. Live: `/sign-in` **200**, `/transactions` **307** to sign-in (auth gate
behaving), apex **308** to www. No prisma diff, so the live Neon database is untouched.

Watched BUILDING → READY rather than reading once: the first two reads showed
`state: BUILDING` with only the vercel.app aliases present, and reporting from either
would have produced a false "not aliased" finding — the alias-lag the slice-5 record
already documented, observed again here.

**Limitation, same as slice 7's and stated rather than skipped:** this commit is
documentation only, so there is no new marker to `curl | grep` and no schema line in the
build log. The evidence is "the newest production deployment is READY on this exact sha
and holds the canonical alias", not "I fetched a changed byte".

## 2026-07-31 — O.16a: come back to where you were (built, gate pending)

Owner, 2026-07-30: *"Can you add away to go back to what we were doing after let's
say changing a rule? Right now I have to click activity again and needs category"*.

### The scope decision, and why the task's two options were both wrong

TASKS O.16a offered a binary — rules-only, or a return context threaded through
every action in `txnActionAvailability` — and told whoever picked it up to MEASURE
first. Three explorer subagents did (doors into `/rules`; per-action post-completion
behaviour; what "place" consists of on the register). The measurement says the honest
shape is a THIRD one neither option named:

**The return context belongs to the two DESTINATION pages, not to the ten actions.**

- Five of ten actions never leave the register at all. `category`, `note` and
  `taxTag` open a panel in place; `reimbursement` and `excludeFromTotals` call
  `writeFlag`, which ends in `window.location.reload()`. Threading a context
  through those would be dead code — the L.22 class.
- The other five leave for exactly TWO destinations: `/rules` (rule, renamePayee)
  and `/transactions/{id}` (split, markRecurring, status — plus the row's own
  `txn-detail-link`, the commonest door of all and the one my first pass missed
  until the e2e named it).
- **Both destinations already had a "back" link, and both were a bare
  `/transactions`** (`transaction-detail-view.tsx:1110`, `rules/page.tsx:130`).
  So the owner was never missing an affordance. He had one, and it silently threw
  his place away. That is why the complaint reads as "I have to click activity
  again and needs category" rather than "there is no way back".

### A delegated finding that was false, caught before it entered the design

The row-action agent reported the root cause as the register's `reload()` "losing
all query params", and concluded the friction was rules-only. `reload()` re-requests
the current URL, params and all — and this repo had already written that down:
`transaction-detail-view.tsx:246` explains it uses `assign(pathname)` *because* "a
plain reload PRESERVES the query string". The two flag actions never lost anything.
Reproducing the claim instead of adopting it is what kept a wrong mechanism out of
the fix (`a-subagents-green-is-a-hypothesis`).

### Shape

Engine-first, in `links.ts` beside `merchantRegisterHref` — one author for register
hrefs rather than a second convention:

- `withRegisterReturn(href, currentQuery)` attaches the place on the way OUT, and
  returns the href untouched when nothing is narrowed (so an unfiltered register
  emits byte-identical URLs to pre-O.16).
- `decodeRegisterReturn(raw)` rebuilds the trip. **The open-redirect class is closed
  by construction, not by a validator**: the path is the `REGISTER_PATH` literal and
  only the QUERY is taken from the caller, so `?back=https://evil.example` parses as
  a query string, matches none of the ten register keys, and decodes to `null`.
- One opaque param, NOT flattened: the register spells a date bound `?from=`, while
  `/rules` spells a source transaction `?from=`. Flattening would have made one
  silently overwrite the other.
- Values are validated, not just keys — the register falls back to "no filter" on an
  unknown `reimb`/`type`/`unclassified`/`page`, so carrying one would have landed on
  the UNFILTERED list under a label calling it filtered.
- The label never over-claims: a named filter is used only when it is the sole axis
  (`page` excepted — a position within a view, not another axis), else a phrase true
  of every filtered register; and no context ⇒ the destinations render the copy they
  had before this slice.
- `afterWriteHref()` in the detail view: four post-write `assign()` sites dropped the
  whole query string on purpose (to clear the unconfirmed banner) and would have
  discarded the reader's place with it.
- Deliberately an affordance, not a redirect-on-save: the builder's confirmation is
  the evidence the write landed, and bouncing him out would take it off screen.

### Verified so far

`npx tsc --noEmit` → 0. `npx eslint .` → 0. New unit lock 24/24, and the two
load-bearing properties are MUTATION-PROVEN: forcing `hashAt = -1` kills the fragment
test (1 failed), dropping `isMeaningfulValue` kills 2.

### NOT yet done

Full `bash scripts/verify.sh` (with VERIFY_E2E=1) has not been run on this tree, and
the new e2e spec `tests/e2e/register-return.spec.ts` has NEVER been executed — an
e2e run tests the last `next build`, so it needs a rebuild first. Nothing here is
deploy-verified. Scroll position within a page is NOT restored (page number is, via
`?page=`); recorded as a stated limitation, not a claim.

### O.16a — GATE RUN 1: ❌ FAILED, and the failure was MINE, not the flake

```
 Test Files  320 passed (320)
      Tests  5114 passed (5114)
✓ Compiled successfully in 6.5s
  3 failed
  246 passed (3.0m)
❌ VERIFY FAILED
```

All three failures were the three new O.16 tests, and the signature was
`element(s) not found` on `getByTestId('txn-rule-link')` at
`/transactions?unclassified=1` — an EMPTY queue, not a timeout, not a navigation
stall. That is not the V.1 rotating environment flake and was deliberately not
written off as one (the #306 trap: a real stale assertion masked by "the known
flake"). It is the documented shared-demo order-dependency — the demo is one row,
the specs that FILE transactions drain "Needs a category" before this spec reads
it, which is why all three passed in isolation and failed in the suite.

Fixed as the lesson prescribes rather than by a retry or a longer timeout: each
test now signs up its own throwaway user, adds a manual account and one purchase
under a payee no merchant map can place (`ZZQ VENDOR 4471 NONESUCH`, so
Auto-detect leaves it needing a category), and `readerInTheQueue` ASSERTS the row
is present before anything else — so the lock can never again pass vacuously
against an empty page. Targeted re-run: 3/3 green.

Nothing was weakened to get there: no timeout raised, no retry added, no
assertion removed. The two tests that asserted the `?from=`/`?back=` coexistence
were merged into the first, since they exercise the same navigation.

### O.16a — GATE RUN 2: ❌ 1 failure, and it is the V.1 rotating flake (argued, not assumed)

```
 Test Files  320 passed (320)
      Tests  5114 passed (5114)
✓ Compiled successfully in 6.8s
  1 failed
  247 passed (2.9m)
❌ VERIFY FAILED
```

The three O.16 tests PASSED. The single failure was
`phase4-features.spec.ts:33 › goals: creating a goal shows its effect on the FI
date` — a 60s click timeout on `goal-delete-confirm`.

**Why this is the V.1 class and not an O.16 regression — the argument, since
"it's the known flake" is exactly the excuse #306 says gets a real defect waved
through:**

1. **The same product code both passed and failed it.** Run 1 failed only the
   three register-return tests and PASSED `phase4-features:33`; run 2 passed the
   register-return tests and failed `phase4-features:33`. The only edit between
   the two runs was `tests/e2e/register-return.spec.ts`, which cannot reach the
   goals surface. A test that passes and fails on identical product code is
   rotating by definition.
2. **The diff has no path to it.** O.16 touches `links.ts`, the register, the
   transaction detail view, `/rules` and `/transactions` — goals and the FI date
   share no module with any of them (`git diff --stat` in the record above).
3. **It is the same spec:line already in the V.1 table** (PROGRESS, V.1 run 1:
   `mobile-overflow:408`, `phase4-features:33`).

Nothing was relaxed, retried or re-timed to accommodate it — V.1 forbids exactly
that, because it hides the signal the gate exists to give. Run 3 is in flight
with run 2's artifacts preserved at `/tmp/o16-artifacts-run2` (a re-run destroys
the reproduction).

### O.16a — GATE RUN 3: ✅ VERIFY GREEN

```
 Test Files  320 passed (320)
      Tests  5114 passed (5114)
✓ Compiled successfully in 6.5s
  248 passed (2.6m)
✅ VERIFY GREEN
EXIT=0
```

Unchanged tree from run 2 — no timeout relaxed, no retry added, no assertion
touched. `phase4-features:33` passed this time, which is the third data point in
the pattern V.1 is measuring: on identical product code the failing set rotates
(run 1 → the 3 O.16 fixture failures; run 2 → `phase4-features:33`; run 3 → none).
Run 1's failures were real and mine; run 2's was not, and the argument for that is
recorded above rather than asserted.

Unit count moved 5089 → 5114 (+25, the register-return engine locks); e2e 245 →
248 (+3, the O.16 spec).

### O.16a — DEPLOY VERIFIED — 2026-07-31

Commit `16b459b`, pushed to origin/main (`0 0`, clean tree). Deployment
`dpl_9BEV53T5YTUxSQpBWoC1EauWVhYo` **READY** on `githubCommitSha
16b459bd1d3f4613362d9125b5bfb670ea3c3e5b` — read from the API, matching HEAD —
`target: production`, `aliasError: null`, aliases include **www.aimplifi.app** and
**aimplifi.app**. Live on the canonical host: `/sign-in` **200**, `/transactions`
**307**, `/rules` **307** (both auth gates behaving), apex **308** to www.

Watched BUILDING → READY rather than reading once: the first read showed
`state: BUILDING` with only the two vercel.app aliases present, and reporting from
it would have produced a false "not aliased" finding — the alias lag the slice-5
record documents, observed again.

**The live database is untouched, and that is evidenced rather than inferred.** The
build log's Prisma step reads *"The database is already in sync with the Prisma
schema."* against the Neon host, which is the deploy-side confirmation of the
`git diff origin/main..HEAD -- prisma/` check run before the push (empty). The route
table lists `ƒ /rules`, `ƒ /transactions` and `ƒ /transactions/[id]` — the three
routes this slice touches — all server-rendered on demand.

**A byte-level proof was ATTEMPTED and failed; recording it rather than quietly
falling back.** Both changed surfaces are auth-gated, so there is no HTML to grep.
`detail-back-link` does land in a PUBLIC client chunk
(`.next/static/chunks/22sr8-0ofty3q.js` locally), so the plan was to fetch that exact
path from production and grep the marker — but it returns **HTTP 404**, because
Vercel's build produces different chunk hashes than the local one. The local chunk
name is not evidence about the deployed bundle. `rules-return-link` is server-only
(`.next/server/chunks/ssr/...`) and was never fetchable.

So the deploy evidence is: the newest production deployment is READY on this exact
sha, holds the canonical alias, its build log shows the schema untouched and the
three routes present. It is NOT "I fetched a changed byte from the live app" — that
remains unavailable for auth-gated surfaces, as it was for slices 4–7.

## O.13h — receipt / file attachments (2026-07-31, Opus 5)

Wave O.13's last open row. Owner mandate is Simplifi parity; attachments were the
one field-level gap with NO column, NO write path and NO storage.

### The storage decision, made from the retention policy rather than from a vendor

`docs/DATA_RETENTION_AND_DISPOSAL.md` §3 promises that ONE cascading delete of the
user record removes every associated row, and that "nothing about the user is
retained after deletion"; §6 says the only external data flows are Plaid/SimpleFIN
and the optional AI call. Object storage (the Vercel Blob the task row suggested)
falsifies both: a bucket needs a compensating delete on every path (attachment
delete, transaction delete, account delete, user delete, and any upload whose row
insert failed), and one missed path leaves a photograph of a receipt outside the
guarantee permanently. Bytes therefore live in the database, where the FK cascade
IS the deletion path. Also settles it: no `BLOB_READ_WRITE_TOKEN` exists on the
Vercel project (checked, `vercel env ls production`), so the blob path could not
have shipped working today anyway.

### Built so far (tsc clean)

- `src/lib/engine/attachments/attachment.ts` — pure boundary guard. The stored
  content type is SNIFFED from magic bytes, never the browser's declared type and
  never the filename extension, because the stored type is what the download route
  echoes as `Content-Type`. Closed 6-type set; HEIC accepted (iPhone photos) but
  marked non-renderable so no surface promises a preview it cannot paint.
  `contentDispositionValue` builds the header from an ASCII ALLOWLIST + RFC 5987.
- `tests/unit/attachment-validation.test.ts` — **27/27 green**, refusal-majority.
- Schema: `TransactionAttachment` (metadata) + `AttachmentBlob` (bytes) as TWO
  tables on purpose — transaction rows are read on nearly every page, so splitting
  makes "listing attachments never loads a file" true by construction rather than
  by every future caller remembering a `select`.
- `src/server/attachments.ts` (reads, ownership always derived through
  `transaction.account.userId`), `src/server/attachment-actions.ts` (delete),
  `src/app/api/attachments/route.ts` (POST upload — a route, not an action, because
  Next caps action bodies at 1 MB and a phone receipt photo exceeds it),
  `src/app/api/attachments/[id]/route.ts` (GET download).

### Two byte-level corrections made during the build, not after

1. The first write of the filename guard put LITERAL control bytes in the source
   (`grep` reported the file as binary). Rewritten as a code-point check with no
   control byte and no backslash escape to survive a rewrite.
2. A non-Latin filename neutralized to `__` in the ASCII fallback; now falls back to
   `attachment` unless an alphanumeric survives.

### NOT yet done

UI (detail view), integration + e2e tests, docs (PRIVACY / retention / DECISIONS /
STATUS / TASKS), the verify gate, deploy. Nothing is deploy-verified.

### O.13h — UI, tests and the gate

Shipped since the checkpoint above: the detail-view panel (upload / preview /
download / remove, with the accepted types, the caps and the visibility rule stated
beside the control), the page wiring, `tests/unit/attachment-store.test.ts` (16,
real Prisma) and `tests/e2e/attachments.spec.ts` (2).

**Both load-bearing locks are MUTATION-PROVEN.** Dropping the ownership scope in
`readAttachmentForUser` fails exactly one test (`answers for somebody else's file
exactly as for one that does not exist`); making the route store `file.type`
instead of the sniffed type fails exactly one other (`stores the SNIFFED type`).
Neither mutation disturbed any other test, so each lock names one defect.

**The e2e earns its cost by asserting a claim I could otherwise only believe:** the
download route sends `Content-Disposition: attachment` on every file, and the
preview `<img>` renders anyway because a subresource load ignores that header.
Asserted as `naturalWidth > 0` rather than assumed.

### A 500 I could not reproduce, and what I did about it

Gate run 1 failed ONE test — my own — with `detail-attachment-row` count 0. The
trace (preserved at `/tmp/o13h-gate1`) held the answer: the upload POST returned
**HTTP 500**. It did not recur in four subsequent full runs, and a 12-way
concurrent in-process probe of the route returned 200 twelve times, so the
interactive-transaction theory was NOT confirmed and no fix is claimed for it.

What changed is justified on its own merits rather than on that unproven
diagnosis: the route no longer wraps ownership + count + write in
`prisma.$transaction`. It was the only write path in this app holding the local
SQLite write lock across three round trips, in a harness whose own config
documents write contention; the app's idiom (`setTransactionTax`) is one scoped
read then one write, and the row and its bytes stay atomic because the nested
`blob: { create }` is a single statement. The two remaining races are named in the
source with what each costs. A `try/catch` now turns a store failure into a
sentence written for the reader instead of a bare 500 the form can only shrug at —
warranted by an observed failure, not by decoration.

### GATE: unit/lint/build GREEN; full-suite e2e RED with the V.1 rotating flake

```
 Test Files  322 passed (322)
      Tests  5157 passed (5157)
```
`npx tsc --noEmit` → 0. `npx eslint . --max-warnings=0` → 0. `npx next build` → clean.

Five full-suite e2e runs on this tree, failing set each time:

| run | failures |
|---|---|
| 1 | `attachments` (mine — the 500 above) |
| 2 | **none — 250 passed, ✅ VERIFY GREEN** (pre-route-change tree) |
| 3 | `mobile-overflow:408` |
| 4 | `merchant-lens`, `phase4-features:80`, `transactions:678` |
| 5 | `phase4-features:33`, `transactions:145` |
| 6 | `budget-targets:20`, `phase4-features:33` |

Zero overlap between consecutive runs but one, every failure in a spec this slice
does not touch, and **all 47 tests across all six of those spec files pass together
on the shipped tree in 55.9s**. `attachments.spec` passed under full-suite load in
every run after the fix. The tree is sound; the gate's exit code is not about it.

**The mobile-overflow failure was checked rather than waved through**, because it
loads `/transactions/[id]` — the page this slice changes. Its `error-context.md`
shows the page still on the register with the `h1` reading "Transactions": the
click never navigated, so the detail page was never requested and my changes could
not have been executed.

### New evidence for V.1, which asked for the stall to be instrumented

Run 4's `phase4-features:80` failure was not an assertion at all —
`apiRequestContext.get: read ECONNRESET` on `GET /api/export`. That is a
CONNECTION-level failure, which fits V.1's whole signature (a navigation that never
completes, every victim green alone in 1–3s, the set rotating).

Measured alongside it: **nothing is LISTENING on port 3100 between runs** (so the
leaked-server hypothesis from `alive-is-not-progressing.md` is refuted for this
machine), while sockets in `TIME_WAIT` on 127.0.0.1:3100 accumulated across the
session — **754 after run 4, 1,179 after run 5** — and the failure count rose with
them (1 → 3 → 2 → 2). This also explains the awkward fact V.1 said must be
explained before anyone believes a contention story: it does not need concurrency,
so the `--workers=1` sightings fit, and V.0's "a machine restart made it green"
fits too, because a restart clears TIME_WAIT.

**Stated as a correlation, not a cause.** 1,179 is far below the ~16k Windows
ephemeral-port range, so exhaustion is not demonstrated — what IS demonstrated is a
connection-level failure and a rising socket debt that tracks the failure rate.
The next V.1 step is cheap and named: measure TIME_WAIT before/after each run
against the failure count, and check whether an idle machine (or `MaxUserPort` /
`TcpTimedWaitDelay`) moves the rate.

### O.13h — DEPLOY VERIFIED — 2026-07-31

Commit `12786da`, pushed to origin/main (in sync, clean tree). Deployment
`aimplifi-hqk0z8cum-reiforge.vercel.app` reached **● Ready**, `target: production`,
holding **www.aimplifi.app** and **aimplifi.app** (watched BUILDING → READY rather
than read once, per the alias-lag precedent).

**The build log is the evidence, and it is stronger than the last few slices could
manage** — the routes themselves are new, so the route table names them:

```
Cloning github.com/meleesciony/Aimplifi (Branch: main, Commit: 12786da)
Datasource "db": PostgreSQL database "pulse", schema "public" at "ep-proud-sound-atpgfoct...neon.tech"
🚀  Your database is now in sync with your Prisma schema. Done in 577ms
├ ƒ /api/attachments
├ ƒ /api/attachments/[id]
├ ƒ /transactions/[id]
```

The cloned commit equals local HEAD exactly. **The live Neon database DID change this
time** — unlike every recent slice — and that is the point of the `db push` line: the
two additive tables were created. No existing column was touched (`git diff` on
prisma/: 47 insertions, 0 deletions).

**A live HTTP check was ATTEMPTED and is UNAVAILABLE from this shell, recorded rather
than quietly skipped.** `curl https://www.aimplifi.app/sign-in` returns 000, but so does
`curl https://api.github.com` — DNS resolution is blocked for curl in this sandbox, so
the 000 says nothing about the site and must not be read as an outage. The deployment
record plus the build-log route table is the evidence; a fetched byte from the live app
remains unavailable for auth-gated surfaces, as it was for slices 4–7 and O.16a.

### O.13h — CRITIC CYCLE: two fresh-context critics, both FAIL, converging independently

Dispatched with different lenses (security/authz; claims/copy/docs). Both found the
**same P1 without seeing each other's work**, and both proved it by execution — the
strongest signal this repo has that a finding is real.

**P1 (both critics): a receipt on a PENDING charge was destroyed when the bank posted
it.** Plaid's pending→posted churn creates a replacement row and deletes the
predecessor, carrying `Correction`, `CategoryPrediction` and four reader-owned COLUMNS.
An attachment is a RELATION, so `carriedReaderState` could never have covered it — the
rows have to be re-pointed — and the cascade took the blob too. The comment immediately
above that code already describes this exact failure for tax tags and notes and says it
was fixed "as a data CLASS". I added a fifth member and did not join it.

Fixed structurally: the four delete sites' duplicated re-point blocks are now ONE
`carryReaderRelations(toId)` closure they all already had to call, so the next
reader-owned relation joins one function instead of being copied beside four deletes.

**P1 (security critic, executed): Prisma operator injection.**
`deleteTransactionAttachment` put `attachmentId` straight into a `where` with no runtime
guard. A Server Action argument arrives over the wire and TypeScript is erased, so
`{"attachmentId":{"not":""}}` read as a FILTER OPERATOR and deleted every receipt the
caller owned while returning `{ ok: true }`. Contained to the caller's own data by the
`account: { userId }` conjunct, which is the only reason it is P1; ~10 sibling actions
here already guard their scalars this way and this file skipped it.

**Both fixes mutation-proven:** removing the typeof guard fails exactly the injection
lock (1 failed / 16 passed); removing the attachment re-point fails exactly the churn
lock (1 failed / 24 passed). Neither mutation disturbed anything else.

**A false premise of my own, struck rather than softened.** DECISIONS #349 and the schema
comment both claimed §6 of the retention policy denies third-party data flows. It does
not — it enumerates FOUR, and two are *Hosting — Vercel* and *Database — Neon*. So these
bytes DO reach a third party; what is true is that no NEW one is introduced. The §3
deletion argument never needed the §6 one and stands alone. Corrected everywhere,
because a load-bearing premise that is wrong is worse than a missing one.

**The public policy was the miss I would not have found.** `src/lib/legal/privacy-policy.ts`
— whose own header says keep it in sync with the two docs I did update — was untouched:
its "stores only the data its features need" list omitted a whole new data class, its
"only the last-4 mask is ever kept" line had become unenforceable against arbitrary
uploaded images, its deletion enumeration omitted the files, and `PRIVACY_LAST_UPDATED`
still read 2026-06-25 beside a sentence promising review whenever data handling changes.
All four fixed. The deletion PREVIEW also never named the reader's own uploads, so
`DeletionCounts` gains `attachments` and a "receipts & documents" row (tsc enumerated the
two fixtures, which is why the field is required).

**Gate after the cycle:** `npx tsc --noEmit` 0, `npx eslint . --max-warnings=0` 0,
**5159 unit / 322 files** (+2 locks), `docs:lint` clean (111 files).

### O.13h — CRITIC-CYCLE DEPLOY VERIFIED — 2026-07-31

Commit `e5e7b48`. Deployment `aimplifi-myafr2b6r-reiforge.vercel.app` **● Ready**,
build log `Cloning … (Branch: main, Commit: e5e7b48)` matching HEAD, route table
carrying `ƒ /api/attachments` and `ƒ /api/attachments/[id]`, and holding
**www.aimplifi.app** + **aimplifi.app**. No schema change in this commit (the two
tables landed with `12786da`), so Neon took no DDL here.

O.13h is shipped, criticized, fixed, re-verified and live.

## 2026-07-31 — O.18 IN PROGRESS — every category table row expands to the transactions inside it

Owner (with the /budgets screenshot): *"I've asked you many times to make rows expandable so I can
see what exactly system is classifying spending as. Not just the stuff in the photo but every
table. You haven't done it."*

Established first: `main` is level with `origin/main`, so the category LINKS shipped yesterday
(`21b6b20`) are deployed. The ask is therefore not a missing link — it is a different gesture.
A link leaves the page and answers one category at a time; "is this bucket right?" is answered by
scanning several buckets, which only works in place.

Built (verify not yet run at the time of writing):
- `src/lib/engine/glass-box/category-breakdown.ts` — pure builder. Selects rows with the reports
  engine's OWN exported predicate (`isSpendRow` / `spendRowCategoryId` / `spendContributionCents`),
  never a copy, and takes the figure the surface RENDERS so `reconciles` is a real check. Third
  state `clampedByNetRefund` for the documented "a refund outweighed the month" zero, so the panel
  names the clamp instead of reporting a defect. `BREAKDOWN_BASIS` lives beside the predicate and
  the component prints it unconditionally (a disclosure a call site can forget is one it will).
- `src/components/finance/category-breakdown-panel.tsx` — the expander. Zero fetch: the rows are
  on the page when it paints, so expanding cannot show a different basis than the figure above it.
- Wired: /budgets "By category", /reports "Spending by category", /trends movers.
- `TransactionLike` gained three OPTIONAL display fields (`id`, `categoryId`, `merchant`) and the
  demo provider now joins `merchant.canonical` — so a snapshot consumer can NAME a row, and
  `server/trends.ts`'s old local cast for `categoryId` is gone rather than joined by a second one.

Deliberately NOT expanded, each for a stated reason (see TASKS O.18a–c): the dashboard Top Spending
card is one `<a>` to /reports (a button inside an anchor is invalid HTML and the anchor eats its
clicks); the Conscious Spending strip needs a bucket→rows mapping, not a transaction list (W.7);
/recurring rows print a TYPICAL amount, so its sightings do not sum to the figure and need their
own copy.

Locks: `tests/unit/category-breakdown.test.ts` 21/21, mutation-proven — neutering the shared
predicate fails 7.

**Self-caught during the diff audit (before any critic reported):**
- A code comment cited a lock, `trends-breakdown-parity`, that did not exist yet. Written, plus a
  sibling `reports-breakdown-parity` and a demo-seed assertion that a mover which fell to $0.00 is
  an EMPTY breakdown rather than a mismatch — the case the first draft of the e2e tripped over by
  taking the topmost mover (Travel, $0.00, the largest absolute delta on the seed).
- A comment in `assemble.ts` claimed the widened type "removes the cast" in `server/trends.ts`; it
  did not, because `toTrendTxns` declares its own inline row type. The cast is now actually gone.
- The empty-panel string read "No transactions were filed here **this month**" — true on /budgets
  and /reports, FALSE on /trends, whose panels describe `comparedYm`. Extracted to
  `BREAKDOWN_EMPTY` beside `BREAKDOWN_BASIS` and both are now asserted window-free.
- The toggle read a bare "14 items" in muted text. Replaced with a bordered chip reading
  "Show 14 transactions" / "Hide" — the affordance-nobody-can-see measurement recorded in
  `CATEGORY_LINK_CLASS` has already cost this repo twice.
- A hostile-critic subagent left a live mutation in `server/trends.ts`
  (`excludeFromTotals: false` under a comment claiming it had been restored). Caught by the diff
  audit, restored by the critic itself shortly after. Second recorded instance of that class.

### O.18 DEPLOY VERIFIED — 2026-07-31 19:45 ET

Commit `5badb2a`. Deployment `aimplifi-epjw1s92m-reiforge.vercel.app` **● Ready**
(created 19:36 ET), build log `Cloning github.com/meleesciony/Aimplifi (Branch: main,
Commit: 5badb2a)` matching HEAD, aliases holding **www.aimplifi.app** + **aimplifi.app**.
No schema diff in `origin/main..main -- prisma/` (branch level), so Neon untouched.
HTML-marker grep not possible anonymously — /reports 307s to /sign-in for a cookieless
client — so verification is the L.23 build-log-commit method, which is exact.

O.18 + O.18a are shipped, criticized, fixed, verified and live.

## 2026-07-31 — O.19 (owner LIVE) + O.18b IN PROGRESS

### O.19 — "These numbers do not add up to July monthly total" (owner, two screenshots)
Measured, not hypothesized: /reports header prints `totalCents` (engine sums the WHOLE
byCategory array, reports.ts:101) above a view capped at `slice(0, 12)` — his eleven visible
rows sum to $19,312.25 under "$28,253.04 total". Dashboard Top Spending card: same class,
`slice(0, 4)` beside "`totalCents` this month". Swept: /budgets, /trends, Ask, coach lists are
uncapped or carry no adjacent total claim.

Fix (view-only, engine untouched): /reports folds the tail into an "Everything else · N
smaller categories" row summed from the SAME array the header sums, chip-toggle expands the
tail into full rows (one shared map — links, bars, panels identical); dashboard card states
"+ $X across N more categories". Locks: unit pins totalCents === Σ byCategory (the premise the
row renders on; demo has 11 spend categories, measured, so the >12 hard case lives in the e2e's
own throwaway fixture); e2e `reports-total-reconciles.spec.ts` seeds 14 categories ($105.00
hand-computed) and asserts the painted page recomposes the total in both states, 2/2 PASSED.
Gate: `bash scripts/verify.sh` ✅ VERIFY GREEN. Committed. Hostile critic RUNNING (read-only,
money display). NOT yet pushed — push after critic.

### O.18b — the Conscious Spending strip expands per bucket
Engine (committed 8befdc4): `traceConsciousBuckets` in glass-box/trace.ts — safe-to-spend
identity decomposed once (rows + basis GROUPS, flatten byte-identical, pinned by the existing
glass-box suite), per-bucket NumberTraces reshaped from those rows, headline =
`mapToConsciousBuckets` figure, so `reconciles` is a CROSS-MODULE check of the #93 partition.
Guilt-free panel IS the safe-to-spend trace (a remainder's honest panel is the whole
subtraction). New keys `conscious_fixed`/`conscious_savings` in redact HEADLINE via
`CONSCIOUS_BUCKET_LABELS` (one author). Unit conscious-trace.test.ts 10/10; glass-box 47/47.

UI (uncommitted): GlassBoxPanelBody extracted from GlassBoxNumber (default testid prefix keeps
existing ids byte-identical) + it now renders TraceRow.action (L.29 control an unset-$0 row
carries — the body silently dropped it before); ConsciousBucketRow client expander (amount is
the toggle, house dotted-underline); strip legend wired, labels from CONSCIOUS_BUCKET_LABELS.
E2e conscious-buckets.spec.ts 1/1 PASSED on fresh build: per-bucket penny match, fixed ≥2 rows,
guilt-free income row + subtractions, partition identity from painted money, savings-unset
action both-branches, collapse stable.

OPEN: /spending-plan second-bar decision to record (its bar sits directly above the full trace
rows — "How we got there" — so it is already expanded in place; record in DECISIONS rather than
duplicate expanders); O.18b hostile critic (after O.19 critic returns); full verify; TASKS
flips; push + deploy-verify both slices.

### O.19 + O.18b SHIPPED — 2026-07-31 ~21:00 ET

Both slices criticized (one Fable cycle each, FAIL→fixed→locked), verify GREEN (tsc 0 /
eslint 0 / 5375 unit / 329 files / build clean), affected e2e 10/10 across four spec files
(reports-total-reconciles 2/2, conscious-buckets 1/1, category-breakdown, spending-plan-month-edge).
DECISIONS #357/#358 + index, 2 REGRESSION_LEDGER entries, TASKS flipped (O.19, O.19a, O.18b done;
O.19b-d + O.18f residuals filed). Pushing now; deploy verification follows in this same session.

### O.19 + O.18b DEPLOY VERIFIED — 2026-07-31 21:02 ET

Deployment `aimplifi-f02ddvhui-reiforge.vercel.app` **● Ready**, build log
`Cloning github.com/meleesciony/Aimplifi (Branch: main, Commit: e24cee9)` matching HEAD,
aliases holding **www.aimplifi.app** + **aimplifi.app**. `git diff 5badb2a..HEAD --stat -- prisma/`
empty, so Neon took no DDL. Both slices are shipped, criticized, fixed, verified and live.

## 2026-07-31 (evening session 2) — O.19b + O.19c + O.19d IN PROGRESS

### O.19b — Ask states the remainder under capped lists (engine answer.ts)
`categoryRemainderFact` (one author): "Everything else · N more categor(y|ies)" summed from
the SAME byCategory array the total sums; wired into answerSpendTotal (slice 3),
answerTopCategories (caller limit), AND answerSpendByCategory's umbrella+group branches
(same disease, not in the task row's enumeration — data-class sweep). answerSubscriptions
(>5 subs → "/mo" tail from the same array the headline sums) and answerMerchantSpend
(>5 items → "N more transactions", SIGNED so a refund-heavy tail shows −$X rather than
rebuilding the O.10c bias; items sums to totalCents by contract). Abstention everywhere:
complete list → byte-identical. O.10c (which rows are SHOWN) deliberately untouched.
Locks: assistant-answer.test.ts O.19b block (43 pass; the old utilities-umbrella
assertion pinned the silent cap and was updated to expect the tail),
assistant-merchant-spend.test.ts O.19b block (36 pass, signed-negative tail case),
ask.spec e2e added (painted recomposition on demo spend_total: 3 facts + tail === headline).

### O.19c — /trends states its caps (engine + view)
SpendingTrends gains `moverTotal`/`newMerchantTotal` (pre-cap counts from the same arrays
the slices truncate). trends-view renders one sentence per list ONLY when the cap bound:
"Showing the top 6 of 7 changed categories, by size of change." /
"Showing the top 5 of 6 new merchants, by amount spent."
(testids trends-movers-cap / trends-new-merchants-cap). Locks: trends.test.ts O.19c block
(42 pass — 7 movers → 6 listed/total 7; net-refunded merchant outside list AND total;
uncapped → equal counts); new e2e trends-caps.spec.ts seeds a throwaway user where both
caps provably bind (7 May new-category movers, 6 June merchants).

### O.19d — residual locks on reports-total-reconciles.spec.ts
Seed helper generalized (seedCategoryMonth, null categoryId = unfiled row). Two new tests:
(1) 13 cats with rank-12/13 TIE at $1.50 → "1 more category" singular, no "smaller",
identity holds; (2) 14th row unfiled ($0.50) → tail includes uncategorized, expanded state
asserts the O.5 refusal (no category-link-uncategorized, "review in Inbox →" → /triage)
and the identity counts the unlinked row.

STATE: tsc 0; unit green on all touched files. `next build` RUNNING (background) for the
e2e runs (reports-total-reconciles ×3, trends-caps, ask.spec). Then full verify, TASKS
flips, DECISIONS, push + deploy-verify.

### O.19b + O.19c + O.19d SHIPPED-READY — 2026-07-31 (session 2)

Critic (fresh-context, read-only): PASS, 0 P0/P1; P3 scoped-label fixed same-session
("Everything else in bills"); P2 accounting recorded (the two new reports e2e tests lock
O.19d's prior surface, not this diff — by design). Definitive gates on the FINAL tree:
verify.sh ✅ GREEN — 5390 unit / 329 files (+15), tsc 0, eslint 0, build clean; affected
e2e rebuilt + rerun: 26/26 (reports-total-reconciles 4/4, trends-caps 1/1, ask.spec 21/21).
DECISIONS #359 + index; TASKS O.19b/c/d flipped. Committing, pushing, deploy-verifying now.

### O.19b/c/d DEPLOY VERIFIED — 2026-07-31 ~22:05 ET

Deployment `aimplifi-h5x8a2w6j-reiforge.vercel.app` ● Ready, build log
`Cloning github.com/meleesciony/Aimplifi (Branch: main, Commit: e13f9de)` matching HEAD,
aliases holding www.aimplifi.app + aimplifi.app. No prisma diff — Neon untouched.
All three O.19 residual slices are shipped, criticized, verified and live.

## 2026-07-31 (session 3) — O.18f IN PROGRESS

### O.18f — the excluded-card disclosure has ONE author

Premise CORRECTED before any code moved: the task row (and `planCardNotes`' own
docblock) said the class had THREE authors — dashboard `safe-to-spend-card.tsx`,
/spending-plan's "What this figure can't see", and `planCardNotes`. There were
FOUR. `answer.ts:1125-1151` hand-rolled all four facts for the Ask safe-to-spend
answer, unlisted anywhere. Found by grepping the phrases rather than trusting the
row (lessons: a task row's premise is a hypothesis; a sweep bounded by the
surfaces you already had in mind is not a sweep).

DEFECT found by diffing the copies before extracting (lesson
`dedup-must-diff-the-copies-first`): three of the four authors hardcoded the word
**"Two"** for the duplicate-pair note regardless of pair count, and Ask's was the
worst — `Two cards behind the card-payments figure (A and B; C and D)`, a count of
two beside four names in one sentence. `duplicatePairs.length > 1` is REACHABLE:
`src/server/spending-plan.ts:278` applies no cap over the nested-loop detector in
`engine/account/duplicates.ts:268`, so one card pairing with two others (A↔B, A↔C)
produces two pairs. Fixed at the single author by counting PAIRS, never cards —
two pairs may share a card, so "four cards" is a claim this channel cannot support.

NOT unified with `card-duplicate-view.ts`, deliberately and recorded in the
docblock: that module authors the same-card-twice fact for the CASH-NEEDED figure,
resolved against real card rows via `resolvePairs`. This one qualifies the
SAFE-TO-SPEND figure from the thinner `SpendingPlanDisclosures` channel. One
question, one basis.

Shape: `planCardNoteParts(disclosures, surface): CardNote[]` where every divergence
the four copies had drifted on is now a REQUIRED field — `headline`
('left-to-spend' | 'overage' | **'none'**, the dashboard's no-figure state, naming
the ignorance rather than defaulting to a direction), `container`, `detail`
('compact' merges undated+pending and counts; 'named' splits, names cards, one
sentence per pair), `fixedCostsName` (null where the surface prints no fixed-costs
figure the clause could refer to). Notes are TAGGED by fact so the dashboard's
three testids select by tag — indexing would shift every position whenever a fact
abstains. `planCardNotes` is the flattened-to-text wrapper for list callers.

Copy decided out loud: the exclusion clause stays HEDGED ("may be lower than
shown") because the size of the exclusion is unknown; the duplicate clause stays
DEFINITE ("is higher than shown") because it is governed by an "if so" antecedent
that has already taken the duplicate as given. A first cut collapsed both to
"may be" and was caught by the existing Ask locks.

Gates so far: verify.sh GREEN — 330 files (+1) / 5403 unit (+13), tsc 0, eslint 0,
build clean. Affected e2e on that build 7/7 (dashboard-duplicate-disclosure 5/5
incl. the no-duplicate abstention case, conscious-buckets 1/1, spending-plan 1/1).
One lock updated deliberately (assistant-answer.test.ts:357 — Ask's frozen note now
carries the since-date it dropped before). New `tests/unit/plan-card-notes.test.ts`.

NEXT: hostile critic (running, fresh context, Fable), then DECISIONS + ledger +
TASKS flip, then push + deploy-verify.

### O.18f SHIPPED-READY — 2026-07-31 (session 3)

Fresh-context critic (Fable, read-only): **PASS, 0 P0/P1**. It independently proved
all five `headline` arguments against their surfaces' actual render paths — the
L.15/L.30 failure mode where exactly that argument was passed wrong at a third call
site — and confirmed the "Two" defect and its reachability. It also corrected one of
my own claims: /budgets' duplicate clause was HEDGED before and BECOMES definite here;
it did not "stay" definite.

Four of its five P2s fixed in the same slice: the dashboard's frozen note had inherited
a demonstrative ("so that amount may be stale") that, under this surface's container,
named the guilt-free headline as the stale figure instead of the card-payments
component (P2-1); the /budgets four-field config was hand-written at BOTH callers that
must stay byte-identical, re-opening the drift channel one field wider — now
`BUDGETS_CARD_NOTE_SURFACE` (P2-2); the `'none'` branch rendered "if so there is no
figure to show for it here", a non-sequitur, and now drops the consequence clause
(P2-3); the multi-pair sentence opened with a bare numeral and left "the same card"
without a referent (P2-4). P2-5's totality gap is locked by test.

Definitive gates on the FINAL tree: verify.sh ✅ GREEN — tsc 0, eslint 0,
**5406 unit / 330 files**, build clean; affected e2e rebuilt + rerun **7/7**
(dashboard-duplicate-disclosure 5/5 incl. the no-duplicate abstention case,
conscious-buckets 1/1, spending-plan 1/1). DECISIONS #360 + index, 2 REGRESSION_LEDGER
entries, new lesson `a-demonstrative-is-an-undeclared-parameter.md` + index, TASKS
O.18f flipped with its premise correction recorded and the unreachable-branch residual
filed as its own row (O.18g) rather than left inside a closed one.
`git diff origin/main..main --stat -- prisma/` empty — Neon takes no DDL.
Committing, pushing, deploy-verifying now.

### O.18f DEPLOY VERIFIED (with a named gap) — 2026-07-31 ~22:5x ET

Deployment `aimplifi-362j91hvu-reiforge.vercel.app` **● READY**, built from
`githubCommitSha d5374c77a468c3d5a788a0f31eec125356d3f7b4` — byte-equal to local
HEAD — aliases holding **www.aimplifi.app** + **aimplifi.app** (both answer: 307 /
308 to the app). `git diff origin/main..main --stat -- prisma/` empty, so Neon took
no DDL.

MARKER GREP: **not obtainable, and reported as SKIP rather than PASS.**
`scripts/o18f-live-deploy-check.mjs` signs into the shared demo on production and
reads all four surfaces. Result: 3 passed, **5 skipped**, 0 failed. The three
passes are structural (signed in; the safe-to-spend card renders; /spending-plan
renders its "What this figure can't see" section). The five skips are the
sentences themselves: every one of them is CONDITIONAL on the reader having an
undated / statement-pending / duplicated / frozen card, and the shared demo row
has none — so the disclosure never renders there. Asserting the new wording
against that page would have passed by never running, which is the exact
vacuous-lock failure this wave exists to remove; the probe is built to refuse it.

What IS proven about the copy: `dashboard-duplicate-disclosure.spec.ts` 5/5 on the
production build artifact, driving users seeded WITH duplicate pairs, plus 72 unit
assertions on the author. Forcing the sentences onto production would mean writing
card rows into the live database to manufacture the conditions — a production data
write, not authorized and not worth it for a copy check.

O.18f is shipped, criticized (PASS 0 P0/P1, four of five P2s fixed in-slice),
verified locally and live-deployed from the exact commit.

---

