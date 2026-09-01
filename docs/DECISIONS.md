# Decision Log

Record every non-trivial decision made during the build: what, why, alternatives
considered. Append-only.

> Entries #1-#401 live in `docs/archive/DECISIONS_ARCHIVE_1_to_401.md`;
> #402-#484 live in `docs/archive/DECISIONS_ARCHIVE_402_to_484.md`
> (rotated 2026-08-28, same current-wave cut as PROGRESS/REGRESSION).
> Only entries #485 onward live here; append new entries as before — the numbering
> never resets, the archives hold the lower numbers.

## #486 — O.20j R6: Overdraft Transfer from Brokerage is a transfer, not a fee (2026-08-20)

**Context.** After #485, the transfer-leaf gate still left the live
$7,792.97 "Overdraft Transfer from Brokerage -7383" row in spend: it was
filed to Fees & Charges (`fees`) with `isTransfer=false`. Seven same-
descriptor siblings on 2026-07-06 were `isTransfer=true` (pair-matched).
Owner scoped this remainder: that family must not appear as fee/spend;
do not size the converse leak or chase the broader 76-row detector miss.

**Verified root cause (code, not a live dollar re-probe).**
1. GENERIC `\bOVERDRAFT\b` → `fees` (`normalize.ts`) matches both
   `OVERDRAFT FEE` and `Overdraft Transfer from Brokerage…`.
2. No KNOWN_MERCHANTS / `TRANSFER_DESCRIPTOR` rule claimed the transfer
   phrase first, so `normalizeMerchant` returned `fees` at 8500 bps and
   `categorize` auto-filed it (no transfer short-circuit).
3. `detectTransfers` marks this family only via pair matching (exact
   opposite cents, ±3 days). There is no amount ceiling — the unpaired
   largest leg simply never entered `evidenced`. Sibling flags were
   almost certainly pair-overturns that left category=`fees`.

**Decision.** Add KNOWN_MERCHANTS
`/\bOVERDRAFT\s+TRANSFER\b/i` → Account Transfer / `transfer` with the
other transfer patterns, ahead of the fees keyword. Detector and
`categorize` both consume the normalizer, so descriptor evidence alone
flags unpaired legs; new ingest files `categoryId=transfer`. Settled
existing `fees` rows get `overturnIds` on the next
`refreshTransferFlags` (H.7 keeps the competing category; spend gates
already drop `isTransfer`). Real `OVERDRAFT FEE` unchanged.

**Deliberately NOT fixed:** converse leak; why other unflagged
`transfer`-category rows miss pairing; any production backfill beyond
the normal sync refresh path.

**Locked.** `test_regression__o20j_r6_overdraft_transfer_from_brokerage_is_not_fees_spend`
(`insights.test.ts`),
`test_regression__o20j_r6_overdraft_transfer_beats_fees_keyword`
(`normalize.test.ts`),
`test_regression__o20j_r6_unpaired_overdraft_transfer_descriptor_overturns_fees`
(`transfer-pair-filing.test.ts`).

## #487 — O.20j: filed transfer category is detector evidence (2026-08-20)

**Context.** After #485 (flow predicate) and #486 (Overdraft Transfer
normalizer), TASKS O.20j still named the detector root cause for the 76 live
rows filed `categoryId=transfer` with `isTransfer=false` (Venmo payments,
"AUTOMATIC PAYMENT" card autopay, brokerage sweeps) against 132 correctly
flagged. New siblings can keep arriving unflagged. Owner scoped this slice to
that family only — not converse-leak sizing, not H.7b, not applyCategory.

**Verified root cause (code, not a live dollar re-probe).**
1. `detectTransferParts` evidenced a row only when `normalizeMerchant` returned
   `transfer`/`auto-loan`, OR when an equal/opposite amount existed on another
   account within ±3 days (`matchTransferPairs`).
2. Confirmed against the named families: Venmo → `uncategorized` aggregate;
   `AUTOMATIC PAYMENT - THANK YOU` → `uncategorized` (TRANSFER_DESCRIPTOR
   matches `AUTOPAY PAYMENT`, not AUTOMATIC); `Funds Transfer to Brokerage` →
   `uncategorized`. Without a unique opposite leg they never entered
   `evidenced`, so `planTransferUpdates` never planned `flagIds`.
3. R6's unpaired largest overdraft leg was the same shape for pair-required
   detection; #486 fixed that family via the normalizer. The remaining 76 are
   the filed-leaf / non-matching-descriptor residual.
4. How they got `categoryId=transfer` without the flag is out of this slice's
   write (manual filing and similar paths set category without `isTransfer`);
   the detector must still honor the already-filed leaf.

**Decision.** Optional `TransferTxn.categoryId`; when it is `'transfer'`, add
the row to the same `descriptorIds` evidence set the normalizer path uses
(pair-leg sharing unchanged). One direction only: never clears `isTransfer` on
a spend category (converse leak deliberately untouched). Next
`refreshTransferFlags` add-only-flags the unflagged filed rows.

**Deliberately NOT fixed:** converse leak magnitude / H.7b owner repair;
`applyCategory` still does not stamp `isTransfer` on a hand-file to transfer
(sync refresh covers it; immediate stamp is a separate product choice).

**Locked.** `test_regression__o20j_filed_transfer_category_flags_without_pair_or_descriptor`,
`test_regression__o20j_automatic_payment_and_brokerage_sweep_filed_transfer_flag`,
`test_regression__o20j_converse_leak_spend_category_not_touched_by_filed_leaf_rule`
(`transfer-pair-filing.test.ts`);
`test_regression__o20j_filed_transfer_is_endorsed_by_repair_not_declined_out_of_scope`
(`transfer-flag-repair-plan.test.ts` — H.7b repair now endorses the filed leaf
instead of counting it as declined-out-of-scope).

## #485 — O.20j first slice: `countsInFlows` honors the transfer category leaf (2026-08-20)

**Context.** DECISIONS #446 / TASKS O.20j measured the live trust leak: rows
filed `categoryId === 'transfer'` with `isTransfer === false` (76 vs 132
correctly flagged) freely entered every `countsInFlows` surface — `/reports`
chart bars, `/coach` savings rate + Money Review, Ask income/expense answers,
and `glass-box/month-flow-breakdown.ts` — while `isSpendRow` already dropped
`id === 'transfer'`. Owner scoped a narrow first slice: close that predicate
gap; do not silently "fix" the converse leak (`isTransfer=true` under real
spend categories) or chase detector root-cause / H.7b in the same commit.

**Inventory (callers of `countsInFlows`, before the change).** Direct:
`monthlyFlows` / `isIncomeFlowRow` (insights.ts) → coach + Ask + spending-plan
income pattern / fixed-category-amounts / discretionary-spend; glass-box
`buildMonthFlowBreakdowns`. `isSpendRow` already had the category gate
(reports → spendingByCategory, budgets, Ask spend answers, category
breakdown). `classifySpendClass` already excludes the transfer leaf via
`FIXED_PATTERN_EXCLUDE_CATEGORY_IDS` (not via `countsInFlows`). Lifestyle
creep is unaffected (a transfer leaf is never income nor discretionary —
confirmed in #446).

**Decision.** One new clause in `countsInFlows`: refuse when
`t.categoryId === 'transfer'`, matching `isSpendRow`. No shared-predicate
extraction, no detector write, no flag flip on `isTransfer=true` spend rows.
`MONTH_FLOW_BASIS` reader copy already says "transfers … are all left out";
only the completeness comment was updated (flag + category leaf).

**Deliberately NOT fixed here (remainder tracked on O.20j):**
1. **Converse leak** — `isTransfer=true` under entertainment/rent/etc. Both
   predicates already agree on the flag; flipping it under-counts today and
   needs a sized measurement + product decision (H.7b repair tap is the
   owner-facing remedy path).
2. **R6 / Fees & Charges miscategorization** — closed in **#486** (normalizer
   claims OVERDRAFT TRANSFER before the fees keyword).
3. **Why the pairing detector misses 76 rows** — detector / re-link root
   cause remains a later slice.

**Locked.** `test_regression__o20j_transfer_category_unflagged_does_not_count_in_flows`
(`insights.test.ts`) and
`test_regression__o20j_transfer_category_unflagged_stays_out_of_month_flow_panels`
(`month-flow-breakdown.test.ts`).

## #488 — Ask "will I run out of money?" uses Cash flow radar (2026-08-20)

**Context.** Live demo (www.aimplifi.app, asOf Wed Jun 10, 2026) showed three
cash answers a reader cannot trust together: Cash needed shortfall **$1,012.33**
on Jun 24 / transfer **$1,050**; Cash flow radar lowest **−$6,943.99** on Sep 1 /
cover **$6,950**; Ask “Will I run out of money in the next 90 days?” ending
**$12,495** / lowest **$3,400** on Jun 10. Verified on current main seed: same
cents (`radarLowest: -694399`, `radarCover: 695000`, `cashRec: 105000`,
`forecastEnd: 1249500`, `forecastLowest: 340000`).

**Root cause.** Not three bugs in one engine — three engines (#72 cash-needed
this-cycle; #172 radar 90-day committed + cards; #72/#75 Ask `forecast` →
recurring-only `/forecast`). Ask’s run-out phrasing routed to the thin forecast
and its fine print omitted card payments, so it *looked* like the radar question
while printing an all-clear that contradicted the dashboard.

**Decision.** Split the intent. `cash_flow_radar` (run out / go negative /
overdraft / “cash flow radar”) → `getCashFlowRadar` + `answerCashFlowRadar`
(same dollars as the dashboard card). `forecast` stays the recurring-only walk
with disclosure aligned to `/forecast` (names card payments). Do **not** invent
a fourth engine. Do **not** force cash-needed ≡ radar — cycle vs 90-day remain
different, disclosed questions.

**Locked.** `tests/unit/ask-runout-radar-agreement.test.ts`
`test_regression__ask_runout_routes_to_cash_flow_radar_not_forecast`,
`test_regression__ask_runout_agrees_with_radar_lowest_and_cover`,
`test_regression__thin_forecast_and_cycle_cash_needed_stay_different_questions`;
intent cases in `assistant-intent.test.ts`; `answerCashFlowRadar` in
`assistant-answer.test.ts`.

## #489 — Public "Explore the demo" CTA uses the mutation-form recipe (2026-08-20)

**Context.** Measured on www.aimplifi.app 2026-08-20: `/` 307s to `/sign-in`.
The only demo CTA (`data-testid="demo-sign-in"`, copy "Explore the demo") was
`<form action={demoSignIn}>` with an inline `'use server'` that called
`signIn('demo', { redirectTo: '/dashboard' })`. Live HTML rendered `action=""`.
A document POST (no `Next-Action` header) returned 200, stayed on `/sign-in`,
and set zero auth cookies — progressive enhancement was dead. A JS server-action
POST did 303 + session cookie + dashboard redirect, so the demo *provider* was
fine; the form binding was not.

**Root cause.** Same family as #164/#166/#167: `<form action={fn}>` is unreliable
here (see `docs/lessons/mutation-form-recipe.md`). Every other mutation already
moved to onSubmit + assign/reload; the public demo CTA was the leftover
anti-pattern.

**Decision.** Smallest fix, no redesign:
1. Move `demoSignIn` to `src/server/auth-actions.ts` next to `googleSignIn` /
   password actions. Audit-log try/catch unchanged. Call
   `signIn('demo', { redirect: false })` and `return { ok: true }` so the client
   owns navigation (do not swallow a thrown redirect/AuthError into a false ok).
2. Client `DemoSignInButton`: onSubmit + own busy + `withDeadline` +
   `window.location.assign('/dashboard')` on ok; on `ActionDeadline` also assign
   `/dashboard` (#164: cookie usually already set).
3. Keep copy, testid, demo user, `/dashboard` target. Do **not** set
   `DEMO_TODAY`, touch seed, Plaid/Vercel env, middleware, SW, or Google/password
   forms.

**Locked.** `tests/unit/demo-sign-in.test.ts`
`test_regression__demo_cta_uses_redirect_false_and_returns_ok`,
`test_regression__demo_cta_propagates_auth_failure`,
`test_regression__demo_cta_uses_client_onsubmit_not_form_action`. Existing e2e
(`desktop-header`, `no-dead-ends`, and every other `demo-sign-in` click) still
drives the same testid → `/dashboard`.

## #490 — O.10a: Ask merchant match is exact store identity (2026-08-20)

**Context.** Verified on current main (`dff8385`) + demo seed: Ask
“How much did I spend at Costco Gas this month?” answered **$195.82 at Costco**
while `/trends` “New this month” for Costco Gas printed **$37.38**. Register
merchant filter is already exact (DECISIONS #250 / `merchantNameEquals` —
“Costco” must not match “Costco Gas”); Ask’s `merchantMatches` still used a
bidirectional whole-word prefix after `merchantKey` folding
(`c === qq || c.startsWith(\`${qq} \`) || qq.startsWith(\`${c} \`)`). The
leak for a LONGER query is `qq.startsWith(\`${c} \`)` (“costco gas” sweeps
“Costco”); the family grouping for a SHORTER query is `c.startsWith(\`${qq} \`)`
(“costco” sweeps “Costco Gas”). O.8a pinned both halves in
`o8-merchant-basis-parity.test.ts` so closing the gap meant flipping a test
that explained itself. Same family: Amazon / Amazon Prime, Uber / Uber Eats.

**Decision.** Exact store identity only — same rule as the register. Change
`merchantMatches` to `c === qq` after `merchantKey` (punctuation/case still
fold so “mcdonalds” matches “McDonald's”). Do **not** invent a merchant-family
product. Display name stays “largest matched canonical magnitude” — after the
exact gate the matched set is one store’s spellings. Flip the O.8a divergence
pin to agreement ($37.38 / “Costco Gas”). Do not touch `countsInFlows` /
`isTransfer` / H.7b / converse leak / demo CTA / Plaid / U.15 / login / seed /
env.

**Accepted residual.** Truncated short forms (“Blue Bottle”, “ATM”) no longer
prefix-reach “Blue Bottle Coffee” / “ATM Withdrawal”; they abstain as “No
spending” rather than naming wrong money. Locked. Full-canonical questions
still answer. A synonym / autocomplete layer is a later product choice, not
this slice.

**Parser follow-through (CI).** Exact match alone is not enough if Ask never
reaches `merchant_spend`: `\bgas\b`→fuel matched inside “Costco Gas” and the
e2e saw “You spent $68.27 on Fuel”. Multi-word `at`/`with` objects now keep
merchant routing unless a category synonym owns the WHOLE phrase (bare `gas`,
`natural gas`, `uber eats` still win; single-token `Amazon`→shopping /
`Starbucks`→coffee unchanged — DECISIONS #168).

**Locked.** `tests/unit/o8-merchant-basis-parity.test.ts`
`test_regression__o10a_costco_gas_is_not_costco` (fail-old: restore prefix ⇒
Ask Costco Gas = 19582 under “Costco”); Costco-only locks in
`assistant-merchant-spend.test.ts`; exact scope in
`assistant-largest-scope.test.ts`; grounding independent recompute; e2e
`ask.spec.ts` Costco Gas = $37.38 ≠ Costco dollars;
`test_regression__o10a_costco_gas_is_not_hijacked_by_fuel_synonym` in
`assistant-intent.test.ts`.

## #491 — O.20j: hand-file to Transfer stamps `isTransfer` immediately (2026-08-20)

**Context.** After #485 (flow predicate), #486 (Overdraft Transfer normalizer),
and #487 (detector treats a persisted `transfer` leaf as evidence), STATUS
still named the hand-file hole: `applyCategory` updated `categoryId` but never
`isTransfer`. Register Transfer filter, triage inbox, and recurring still key
off the flag until the next sync. Verified on current main (`018d5cb0`): the
update at `triage-actions.ts` wrote only `categoryId` / `needsReview` /
`confidenceBps` / `reviewPinned`. Manual entry already stamped
(`manual.ts`: `isTransfer: explicit === 'transfer'`). Twin holes on
`applyToAllSimilar`, `fileMerchantGroup`, merchant-scope `recategorize`, and
`recategorizeSharedTransaction`.

**Decision.** When the filed leaf is `categoryId === 'transfer'`, set
`isTransfer: true` on that write. One direction only. Filing away from
Transfer does **not** clear the flag — DECISIONS #428 makes H.7b the app's
only `isTransfer: false` writer; a silent clear would invent endorsement
product. Detector pairing, `countsInFlows`, merchant match, seed, env, and
Plaid untouched.

**Locked.** `tests/unit/apply-category-transfer-stamp.test.ts`
`test_regression__o20j_apply_category_transfer_stamps_is_transfer`,
`test_regression__o20j_file_off_transfer_does_not_clear_is_transfer`,
`test_regression__o20j_apply_to_all_similar_transfer_stamps_is_transfer`,
`test_regression__o20j_recategorize_merchant_transfer_stamps_is_transfer`,
`test_regression__o20j_file_merchant_group_transfer_stamps_is_transfer`
(fail-old: empty stamp helper ⇒ Transfer file leaves `isTransfer` false).

## #492 — Header Sign out uses the mutation-form recipe (2026-08-20)

**Context.** After #489 moved the public "Explore the demo" CTA onto the
`#164/#166/#167` mutation recipe, the always-on signed-in chrome still had one
leftover of the same class: `src/app/(app)/layout.tsx` rendered
`<form action={doSignOut}>` with an inline `'use server'` that called
`signOut({ redirectTo: '/sign-in' })`. Live progressive enhancement for that
pattern is dead (`action=""`); a real click can succeed on the server while the
client does not navigate.

**Root cause.** Same family as #164/#166/#167/#489 — see
`docs/lessons/mutation-form-recipe.md`. Sign out was the last always-on
user-facing leftover in the app header. Settings delete-data and
sign-out-everywhere remain intentional native `<form action>` so their
server-side `signOut({ redirectTo })` is unchanged; Google is off in prod;
password/forgot/reset/import-csv are different surfaces already scoped.

**Decision.** Smallest fix, no redesign:
1. Move `doSignOut` to `src/server/auth-actions.ts` next to `demoSignIn`. Call
   `signOut({ redirect: false })` and `return { ok: true }` so the client owns
   navigation (do not swallow a thrown error into a false ok).
2. Client `SignOutButton`: onSubmit + own busy + `withDeadline` +
   `window.location.assign('/sign-in')` on ok; on `ActionDeadline` also assign
   `/sign-in` (#164: cookie usually already cleared).
3. Keep `data-testid="sign-out-form"`, "Sign out" copy, ghost/sm button,
   shrink-0 header placement. Do **not** redesign nav, touch demo CTA,
   password/Google forms, seed, env, Plaid, or middleware.

**Locked.** `tests/unit/sign-out.test.ts`
`test_regression__sign_out_uses_redirect_false_and_returns_ok`,
`test_regression__sign_out_propagates_auth_failure`,
`test_regression__sign_out_uses_client_onsubmit_not_form_action`. Existing e2e
(`auth.spec` Sign out, `desktop-header`) still drives the same testid →
`/sign-in` and drops the session.

## #493 — Ideal savings percent is the Settings dial, never a hardcoded 40% (2026-08-20)

**Context.** Draft PR #12 (`cursor/spending-plan-40pct-kids-rails-8fd1`) baked
40% into `CONSCIOUS_TARGET_BPS.savings`, the coach dashed line, and the
conscious-spending caption as if it were the product's household goal. The
owner's 40% is **his** target; he will type it in Settings. The dial already
exists: `User.savingsTargetBps` (DECISIONS #295 / #307) already drives
`plannedSavingsCents`.

**Decision.**
1. Keep Sethi's book savings band at `[1500, 2000]` (15–20%) and the Ramsey
   15% chart mark when the dial is unset. **Do not** change the product default
   to 40%.
2. When `savingsTargetBps` is set (including explicit 0%), the conscious
   savings band becomes that point, the coach dashed line moves to it, and
   copy names Settings — never a baked-in household percent.
3. Fixed 50–60% and guilt-free 20–35% stay book bands. Placeholders stay
   `e.g. 15`. No pretax column. No demo seed write. Kids-save
   Path2College/Trump/529 placeholders are **not** product defaults (those
   are the owner's vehicles; he adds them as goals).
4. Draft PR #12 must not merge as written.

**Locked.** `tests/unit/conscious.test.ts`
`test_regression__conscious_savings_band_follows_settings_not_a_hardcoded_40`,
`test_regression__conscious_caption_names_settings_dial_not_a_baked_in_40`.

## #494 — Ask "what should I cut?" uses the Coach opportunities list (2026-08-20)

**Context.** Owner mandate: parity is the floor; the differentiator is cutting
spending that does not buy happiness (TASKS P.1). `/coach` already ranks
`findOpportunities` (unused gym, price increases, insurance re-shop,
negotiable bills). Ask had no route, so the question the owner named went to
unknown.

**Decision.**
1. New Ask intent `what_to_cut`. Parser + `intentFromKind` share
   `whatToCutFromQuestion`. The answer formatter phrases the SAME
   `getCoachData().opportunities` list `/coach` prints — monthly cents,
   estimate labels, `COACH_COPY.opportunity` / `opportunityBasis` /
   `biggestLever` / `moneyDials`. Source is `/coach`.
2. No FI / radar re-projection this slice. Inventing "drop Netflix → FI
   moves 3 weeks" is the rest of P.1 and needs its own engine + critic.
3. Abstain rather than answer the global list: a named store (`at`/`with`),
   a non-subscription category, an amount, or a date. Amounts decline the
   cut route (`null`) so wealth-target / dated-savings planners can match.
   A calendar window (`last month`, `this month`, `in 2025`) is `unknown`
   — the list is standing, not ranked by month, and must not fall through
   to spend. "What subscriptions should I cut?" is the one category
   exception (the word is the cut vocabulary).
4. Empty copy is byte-identical to the coach card's empty sentence.

**Locked.** `tests/unit/assistant-what-to-cut.test.ts`
`test_regression__p1_what_should_i_cut_routes_to_opportunities`,
`test_regression__p1_cut_answer_agrees_with_coach_opportunities`,
`test_regression__p1_cut_does_not_invent_fi_movement`,
`test_regression__p1_cut_with_a_date_window_abstains`. e2e
`tests/e2e/ask.spec.ts` "What should I cut agrees with Coach opportunities".

## #495 — Coach/Ask cut list skips money-dial categories (2026-08-21)

**Context.** #494 routed "what should I cut?" onto `findOpportunities`. That
list did not read Settings money dials, so a reader who set Fitness as a
dial could still be told to cut LA Fitness. W.6(a) already ranked
wealth-target cuts with `categoryMatchesMoneyDial`; Coach/Ask did not.

**Decision.** `findOpportunities` takes required `moneyDialIds` (resolved
O.17a ids). A series whose `categoryId` is a dial is skipped for every
kind — unused-sub, price-increase, insurance-reshop, negotiable-bill.
`getCoachData` passes the same ids the wealth-target card uses. Ask
phrases that array, so the two surfaces cannot disagree. Empty dials (or
demo travel/dining, which are not seed opportunity categories) keep the
pre-#495 ranking byte-identical. No FI/radar re-projection.

**Locked.** `tests/unit/insights.test.ts`
`test_regression__w6a_opportunities_skip_money_dial_categories`;
`tests/unit/assistant-what-to-cut.test.ts`
`test_regression__w6a_ask_cut_list_omits_a_money_dial_merchant`.

## #496 — Ask "when can I retire?" uses the Coach FI card (2026-08-21)

**Context.** Owner: continue; #495 shipped. "When can I retire?" with no age
fell through to unknown (then optional LLM). `/coach` already prints
`monthsToFI` and the FI number. `retire_at_age` only takes a named age.
The long-game differentiator is keeping FI visible and on track.

**Decision.**
1. New Ask intent `fi_status`. Parser + `intentFromKind` share
   `fiStatusFromQuestion`. The answer formatter phrases the SAME
   `getCoachData().fi` numbers `/coach` prints — FI number via
   `COACH_COPY.fiNumber`, years/months from `monthsToFI`, freedom
   dividend, your-enough, frozen-portfolio note. Source is `/coach`.
2. No new projection. The four headline states match the FI card
   mapping (`fiHeadline`) without page-position claims ("this card",
   "below") — those are false in Ask (L.15).
3. A named age stays `retire_at_age`. An amount declines so wealth
   target / dated savings can match. A calendar window or `in N years`
   is `unknown` — the FI card is standing, not ranked by a named date.
4. A model that tags a no-age retire question as `retire_at_age` still
   owes the standing card; a model that tags an aged question as
   `fi_status` still owes the inverse planner.

**Locked.** `tests/unit/assistant-fi-status.test.ts`
`test_regression__fi_status_when_can_i_retire_routes_to_coach_fi`,
`test_regression__fi_status_answer_agrees_with_coach_fi_headline_math`,
`test_regression__fi_status_copy_does_not_claim_this_card_or_below`,
`test_regression__fi_status_date_window_abstains`. e2e
`tests/e2e/ask.spec.ts` "When can I retire agrees with Coach FI card".

## #497 — Ask "is my lifestyle creeping?" uses the Coach lifestyle-creep card (2026-08-21)

**Context.** Owner: continue; #496 committed (unpushed). P.1 remaining half
and W.6(b)(c)(d) are new money engines (off this lane). Highest-leverage
unblocked item: Housel/Sethi lifestyle inflation is the silent FI killer,
and "is my lifestyle creeping?" with no store was unknown while `/coach`
already prints the discretionary-vs-income verdict.

**Decision.**
1. New Ask intent `lifestyle_creep`. Parser + `intentFromKind` share
   `lifestyleCreepFromQuestion`. The answer formatter phrases the SAME
   `getCoachData().creep` `/coach` prints via `COACH_COPY.creepCard` —
   title as headline, body as detail, source `/coach`. Originates no
   growth figure and does not re-run `detectLifestyleCreep`.
2. No new math. The three headline states match the card mapping
   (`Can't compare yet` / `Spending is outpacing income` / `Tracking
   income`) without page-position claims ("this card", "below") — those
   are false in Ask (L.15).
3. An amount declines so other planners can match. A calendar window is
   `unknown` — the card is standing, not ranked by a named date. A named
   store or category is `unknown` (per-category fulfillment is W.6(c)).
   Subscription "price creep" is not this route (`what_to_cut`).
4. A stem regex must match inflections: `\boutpac\b` does not match
   "outpacing", which is how `\bmy income\b` otherwise poaches the
   comparison question.

**Locked.** `tests/unit/assistant-lifestyle-creep.test.ts`
`test_regression__lifestyle_creep_is_my_lifestyle_creeping_routes_to_coach`,
`test_regression__lifestyle_creep_answer_agrees_with_coach_creep_card`,
`test_regression__lifestyle_creep_copy_does_not_claim_this_card_or_below`,
`test_regression__lifestyle_creep_date_window_abstains`. e2e
`tests/e2e/ask.spec.ts` "Is my lifestyle creeping agrees with Coach creep card".

## #499 — P.2 reconciled; Ask phrases the conscious-spending buckets (2026-08-21)

**Context.** Owner: continue. #497 shipped; #498 (runway) landed on main
during this slice. P.1 remaining half and W.6(b)(c)(d) are new money
engines (off this lane). TASKS P.2 was the queued audit:
`COACH_PRINCIPLES_PLAN.md` still said PLAN ONLY (2026-06-24) while
Waves 1–4 and later W.*/Ask work had shipped. Highest-leverage leftover
after the audit: plan §4's Ask `conscious_spending` while `/budgets`
already prints the strip.

**Decision.**
1. Overlay current state on the plan as §0. Authoring-time verdicts stay
   in the body; §0 is what a later session reads. Do not rebuild the
   SHIPPED / SUPERSEDED list.
2. New Ask intent `conscious_spending`. Parser + `intentFromKind` share
   `consciousSpendingFromQuestion`. The answer formatter phrases the SAME
   `mapToConsciousBuckets` + `COACH_COPY.consciousSpending` `/budgets`
   prints — caption in the detail, percents from the strip's clamp,
   source `/budgets`. Originates no cents.
3. No new math. Copy does not say "this card" or "below" (L.15). "This
   month" is the strip's own window and stays; any other date is
   `unknown`. An amount declines so other planners can match. A named
   store or category is `unknown`. "How much is guilt-free to spend"
   stays `safe_to_spend` (no bucket words).
4. Missing income pattern refuses a percentage split — the strip renders
   nothing in that state, and a 0/0/0 answer would be a fabricated lens.

**Locked.** `tests/unit/assistant-conscious-spending.test.ts`
`test_regression__conscious_spending_how_are_my_spending_buckets_routes_to_strip`,
`test_regression__conscious_spending_answer_agrees_with_budgets_caption`,
`test_regression__conscious_spending_copy_does_not_claim_this_card_or_below`,
`test_regression__conscious_spending_other_date_window_abstains`. e2e
`tests/e2e/ask.spec.ts` "How are my spending buckets agrees with Spending strip".

## #498 — Ask "how many months of runway?" uses the Coach room-for-error card (2026-08-21)

**Context.** Owner: continue; #497 shipped. P.1 remaining half and
W.6(b)(c)(d) are new money engines (off this lane). Highest-leverage
unblocked item: Housel's "room for error" is the cash cushion that makes
the long game survivable, and "how many months of runway do I have?" /
"do I have an emergency fund?" was unknown while `/coach` already prints
months of expenses in cash.

**Decision.**
1. New Ask intent `runway`. Parser + `intentFromKind` share
   `runwayFromQuestion`. The answer formatter phrases the SAME
   `getCoachData().runwayMonths` `/coach` prints via shared `runwayTitle`
   + `COACH_COPY.runway`. Source is `/coach`. Originates no month count
   and does not re-run `monthsOfRunway`.
2. No new math. The three headline states match the card mapping
   (`N months` / `no cash buffer` / `no expenses yet`) without
   page-position claims ("this card", "below") — those are false in Ask
   (L.15). Frozen-cash note uses the same `frozenTotalNote` the card does.
3. An amount declines so emergency-fund / wealth-target planners can
   match. A calendar window is `unknown` — the card is standing, not
   ranked by a named date. A named store or category is `unknown`.
   "Will I run out of money" stays `cash_flow_radar`. A dated or
   amount-bearing emergency-fund goal stays those planners. A goal to
   *fund* an emergency fund (no status language) is not this route.
4. `runwayTitle` lives next to `monthsOfRunway` so Coach and Ask cannot
   drift on the three title states.

**Locked.** `tests/unit/assistant-runway.test.ts`
`test_regression__runway_how_many_months_routes_to_coach`,
`test_regression__runway_answer_agrees_with_coach_runway_card`,
`test_regression__runway_copy_does_not_claim_this_card_or_below`,
`test_regression__runway_date_window_abstains`. e2e
`tests/e2e/ask.spec.ts` "How many months of runway agrees with Coach room-for-error card".

## #500 — P1.2 staying-wealthy row composes three Coach signals (2026-08-21)

**Context.** Owner: continue. #499 shipped. P.1 remaining half and
W.6(b)(c)(d) are new money engines (off this lane). Highest-leverage
unblocked leftover: plan P1.2, a compact stay-wealthy row. `/coach`
already prints card-cleared streak, runway months, and lifestyle creep.
The June 24 template always claimed all three were true.

**Decision.**
1. `composeStayingWealthy` reads `cardCleared` + `runwayMonths` +
   `creep`. No new money math. Each checkmark is that signal's own
   state. Framing is Housel's line only — it never lists the three as
   facts. Present: streak > 0; positive finite runway (same number
   `runwayTitle` prints); both creep sides measured and not flagged.
   Absent signals are quiet circles, never a red X or scarcity copy.
2. New Ask intent `stay_wealthy`. Parser + `intentFromKind` share
   `stayWealthyFromQuestion`. The answer phrases the SAME composed row
   `/coach` prints. Source `/coach`. Originates no signal.
3. Requires stay-wealthy / survival-signal language. Single-signal
   questions stay `runway` / `lifestyle_creep` / `cash_needed`. An
   amount declines. A date / store / category is `unknown`. Copy does
   not say "this card" or "below" (L.15).

**Locked.** `tests/unit/staying-wealthy.test.ts`
`test_regression__stay_wealthy_does_not_claim_all_three_when_one_is_absent`,
`test_regression__stay_wealthy_copy_does_not_claim_this_card_or_below`.
`tests/unit/assistant-stay-wealthy.test.ts`
`test_regression__stay_wealthy_am_i_staying_wealthy_routes_to_coach`,
`test_regression__stay_wealthy_answer_agrees_with_coach_row`,
`test_regression__stay_wealthy_copy_does_not_claim_this_card_or_below`,
`test_regression__stay_wealthy_date_window_abstains`. e2e
`tests/e2e/ask.spec.ts` "Am I staying wealthy agrees with Coach staying-wealthy row";
`tests/e2e/phase3-coach.spec.ts` row vs runway title + creep title.


## #501 — Build docs reframed from loop engineering to graph engineering (2026-08-22)

**Context.** Owner task: rewrite the README and all build/instruction/agent-facing
files around graph engineering (topology of nodes/edges/state/routing/gates) instead
of pure loop engineering, elevating rather than discarding the existing discipline.

**Decision.** Graph engineering becomes the top-level mental model; loop engineering
is repositioned as the internal behavior of a single node. Concretely: (1) new
`GRAPH.md` — the repo's build-graph contract: node vocabulary (maker / verifier /
gate / explorer / state-writer / human-gate), edge payloads, the shared-state schema
(the existing ledgers), the standing per-slice topology, gate semantics (verify.sh =
local DoD gate, ci-status.sh = ship gate, curl+grep = live proof, critic = separate
verifier), CLI/script success criteria, observability rules, and the migration note;
(2) new `GRAPH_ENGINEERING.md` — the generic, cross-project method file that now sits
above LOOP_ENGINEERING.md; (3) `LOOP_ENGINEERING.md` rewritten in place as the
node-internal discipline (all 12 rules, self-healing loop, PASS/FAIL contract kept,
each annotated with its graph role); (4) `CLAUDE.md`'s "build loop" rewritten as the
build graph (same six steps, now with named nodes, edge payloads, and the 4-cycle cap
as a retry budget on the critic edge; the "Model handoff line" section became "Model
routing" — model choice framed as per-node-type routing); (5) `AGENTS.md` canon now
reads GRAPH_ENGINEERING → LOOP_ENGINEERING → GRAPH → CLAUDE; (6) README gains a "How
this repo is built — the build graph" section and a repo-map row for the graph files;
(7) framing edits to docs/CRITIC_RUBRIC.md (critic = verifier node, separate context
as contract), docs/PHASES.md intro, docs/STATUS.md preamble (shared-state role),
scripts/verify.sh header (local gate node; explicitly NOT the ship/live gates), and
the TASKS.md header.

**Rationale.** The repo already had latent graph structure — a separate-context Hostile
Critic, worktree isolation for parallel agents, deterministic gates routing work, and
ledgers as cross-session state — but the canon described it as a single-agent loop,
which under-specified the parts that actually caused past failures (unread CI gate,
subagent greens treated as fact, gate/mutator sharing a tree). Naming the topology
makes those rules structural instead of tribal. Nothing operational changed: the same
gates, same critic rubric, same ledgers — so no existing workflow breaks.

**Verification.** Docs-only change; no code touched. `npx tsx scripts/docs-lint.ts`
run this session: zero findings in any rewritten/created file (the only findings are
in stale `.claude/worktrees/agent-*` copies, pre-existing and untouched). Full
`bash scripts/verify.sh` not run — docs-only, and the gate's verdict on an unchanged
tree was already green this week; marked here as not-run rather than claimed.

## #502 — P2.2 memory-dividend reflection on the life-energy card, gated to buys outside the dials (2026-08-23)

**Context.** Owner: continue. #500 shipped; plan P2.2 was the queued
content-only leftover: a Perkins/Housel "memory dividend / who notices"
reflection on `LifeEnergyCard` for big discretionary buys OUTSIDE the
declared money dials only.

**Decision.**
1. One new `COACH_COPY.lifeEnergyReflection` line, registered in the
   hand-maintained `ALL_STRINGS` guardrail scan (the #92 rule — an
   unregistered key passes CI silently). Not a projection; no shame /
   ticker language.
2. The gate is data, not copy: `src/server/coach.ts` adds `isMoneyDial`
   to each life-energy item via the same `categoryMatchesMoneyDial`
   helper W.6(a) uses (same resolved dial ids — no second source of the
   dials). An UNCATEGORIZED purchase counts as outside the dials — it is
   never silently blessed as one.
3. The card renders the line only when at least one listed item is not a
   dial — when every listed buy is a declared dial the sentence has no
   target, and tagging those would contradict "spend there proudly."
   No per-item badges, no verdict coloring: a lens, not a judgment.

**Locked.** `tests/unit/life-energy-reflection-render.test.tsx` (shows
when a non-dial buy sits among dials; silent when all are dials; silent
on the empty state — deliberate assertions, not snapshots). e2e
`tests/e2e/phase3-coach.spec.ts` asserts the line in demo, where the
top buys include rent (not a travel/dining dial).

**Verification (real, this session).** `bash scripts/verify.sh` → VERIFY
GREEN (tsc 0, eslint 0, `next build` clean). Unit **7,309 passed +
1 expected fail + 1 skipped / 444 files + 1 skipped** (`npx vitest run`).
Coach e2e **1/1** (`npx playwright test tests/e2e/phase3-coach.spec.ts`).
First e2e attempt failed on a stale `.next` build (`next start` serves
the last build — a rebuilt gate is the fix, not a code change).

## #503 — C14 "past enough" Coast-FI framing on the FI card; P1.1 closed as a skip (2026-08-23)

**Context.** Owner: continue. #502 shipped. Ranked Flash-lane leftover
(#1: P1.1 dialTag note or skip; #2: Coast past-enough give/spend copy).
The plan's Conflict C resolution: once Coast FI, the Coach opens the
second framing — experiences and giving are a dial you can turn up,
presented as a lens, never a judgment.

**Decision.**
1. **P1.1 closed as a skip, with evidence.** Everything its spec names
   is already shipped: "Your biggest lever" under the #1 opportunity on
   `/coach` (`src/app/(app)/coach/page.tsx:282`), the per-mover
   `COACH_COPY.dialTag` on `/trends` (`trends-view.tsx:159`), and the
   `moneyDials` note on the /coach opportunities header ("spend there
   proudly; the engine only hunts savings everywhere else"). The old
   PARTIAL verdict ("dialTag on /trends only") was the authoring-time
   reading; the "cuts skip dials" behavior is the same rule stated at
   the list level. No delta left to build.
2. **One new `COACH_COPY.pastEnoughCoast` line**, registered in the
   hand-maintained `ALL_STRINGS` guardrail scan (#92 rule). Not a
   projection; no shame/ticker language.
3. **The gate is the engine's own flag:** rendered directly under the
   Coast line in `fi-card.tsx` only when `coastIsCoast`. Before coast,
   "turn the dial toward experiences and giving" would be a nudge the
   engine hasn't earned — the Coast line must not contradict the framing
   two lines below it.
4. **The copy claims nothing about app surfacing.** The plan draft said
   "We surface that the same as any spending"; giving categories
   (`Gifts`, `Charity & Donations`) exist but are per-user visible, so
   the shipped sentence says "many people turn the dial…" — a values
   choice, not a promise of a read-path.

**Locked.** `tests/unit/past-enough-coast-render.test.tsx` (shows on
coastIsCoast; silent when not, both with and without a coast pace).
e2e `phase3-coach.spec.ts` locks the demo's not-coast branch (line
absent AND the coast line naming the required monthly pace — one
predicate, two assertions).

**Left alone.** P1.3 Rich Life (needs a stored string); P.1
counterfactual; W.6(b)(c)(d); P1.4/P1.5; Reports interest & fees YTD.

**Verification (real, this session).** `bash scripts/verify.sh` →
VERIFY GREEN (tsc 0, probes tsc 0, eslint 0, `next build` clean). Unit
**7,314 passed + 1 expected fail + 1 skipped / 445 files + 1 skipped**.
Coach e2e **1/1** (12.0s).

**First full-suite run was RED — and it was not this slice.** 8 tests
across 7 files failed with `database is locked` /
`SQLITE_BUSY_SNAPSHOT` / `disk I/O error` — every one a write in
sync/triage/reserve engine paths this slice never imports. All 7 files
pass isolated (95/95); the full rerun is green. The signature —
one file's disk I/O error cascading into locks on the shared off-tree
temp SQLite DB — is recorded as a lesson
(`docs/lessons/unit-suite-sqlite-cascade-flake.md`).

**Critic divergence (discipline note).** No hostile critic ran on this
slice — content-only copy, verifier = the deterministic coach-copy
guardrail scan + e2e, matching the lane routing and the #500/#502
practice. The hostile-critic lane items (P.1, W.6(b)(c)(d), P1.4/P1.5)
remain ranked under Opus + critic, per the plan's "Still open" list.

## #504 — P1.3 "My Rich Life" vision line: one stored string, two fences (2026-08-23)

**Context.** The ranked Flash-lane leftover from #503: a freeform vision line
("In one line, what does a rich life look like for you?") stored on the User
and echoed quietly atop /coach. First user-authored PROSE on the User row —
the repo's other freeform values are dial IDs, wage/rate numbers, or settings
plans, so this slice had to fix the fence territory and the claim wording from
scratch-ish.

**Decision.**
1. **Schema:** `User.richLifeVision String?`, nullable + additive (the
   reserveHoldingAccountId idiom): null = never written, no echo line, every
   existing user and the demo render identically until they opt in. No
   migration workflow exists by design (frozen `_init`); shipped via `prisma
   db push` (U.4 precedent) — the deployment's build command does it.
2. **Pure normalize in `src/lib/engine/settings/rich-life.ts`** (one-author
   rule like `tax/note.ts`): control/separator characters REPLACED WITH A
   SPACE, never dropped (dropping a tab joins the words it separated — a
   reword, the exact harm the cap rejects on); trim; empty/whitespace-only →
   null (cleared = never written); over `RICH_LIFE_MAX_CHARS` = 120 REJECTS
   with a message naming the limit, never silently truncates.
3. **Write fence:** `updateRichLife` refuses `user-demo` FIRST, before any
   read of form data (the typed-input leg of the shared-account rule — the
   #210/#226/#243 class). The settings card gates the form off for demo and
   shows the honest shared-account note; the action is the proof.
4. **Read fence (critic F3):** `getCoachData` returns `richLifeVision: null`
   for the demo even if a value ever lands on the row — a write fence alone
   leaves a single load-bearing call site, the #226 shape. Both legs + the
   `ai-demo-fence` read lock and a `shared-demo-fences` action lock.
5. **The copy is a frame, scoped (critic F2):** the plan's bare template
   ("Every number below is in service of that") was falsified by the
   value-receipts tally below it — a count of the APP's own flags, not a
   number about the reader's life — and this page's own doctrine is "every
   surface scopes its claim". Shipped: **"Every number about your money
   below is in service of that"** — the page's comments document the refusal
   and the receipt quote. Registered in ALL_STRINGS; the e2e locks the exact
   sentence.
6. **No control cap in the UI (critic F1):** the input deliberately carries no
   `maxLength`; typed/pasted over-length is REJECTED by the action with the
   named limit and the text stays in the box. A control cap would silently
   clamp the reader's answer and make the rejection dead code — the docblock's
   own L.30 rule.
7. **The Ask `rich_life` intent stays OUT** — the plan's Ask row. It shares
   the /coach read-path, which is why this slice hardened that read path; the
   intent is the next Flash-lane candidate.

**Critic (fresh context, read-only): 0 P0, 3 P1, 5 P2 — all executed.** P1s:
F1 maxLength dead-path/silent truncation (→ decision 6); F2 unscoped universal
claim falsified by the receipts tally (→ decision 5); F3 write-leg-only fence
(→ decision 4). P2s: F4 one-token overflow at 380px → `break-words` on the
echo; F5 "Saved — the FI Coach now opens with it" false on clear / zero-account
→ the action returns `hasVision` and the message keys on it, `role="status"`;
F6 control-class missed U+2028/29/85 and stripped-joins → `\p{Cc}\p{Zl}\p{Zp}`
replace-with-space; F7 success not announced → `role="status"`; F8 no
action-level fence lock → `shared-demo-fences.test.ts` row + the read lock in
`ai-demo-fence.test.ts`.

**Verification (final tree, real output).** `VERIFY_E2E=1 bash
scripts/verify.sh` → ✅ VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit
**7,329 passed + 1 expected fail + 1 skipped / 447 files + 1 skipped**, `next
build` clean, e2e **365 passed, 0 flaky (5.0m)** — including
`rich-life.spec.ts` (real-user signup → save → persisted → /coach echo of the
exact scoped sentence; demo note visible, no input, no echo). Fence locks green
on their own: shared-demo-fences (updateRichLife refuses, demo column delta
zero) and ai-demo-fence (a value planted on the demo row never reaches the
`getCoachData` payload, restored after). No `prisma/` diff audit gap: the diff
IS the one additive nullable column above — `prisma db push` runs on deploy by
design, and the row-level effect on existing users is null (= unchanged).

**Lesson added.** `docs/lessons/file-tools-unescape-backslash-u.md` — the
Write/Edit pipeline decodes backslash-u escape texts into real characters
(NUL bytes and a raw line separator both landed as literal bytes in a TS
file), so non-ASCII controls must be written as backslash-x hex or as
`\p{...}` property escapes with the `u` flag; probe the bytes after any such
write.

## #505 — Ask `rich_life` intent: the stored line routed, and the empty state named (2026-08-23)

**Context.** The plan's Ask row last gate: `rich_life` ("what is my rich
life?"). The stored vision shipped in #504; this slice builds the intent on
the SAME read-path (`getCoachData().richLifeVision`), so the #504 read-leg
demo fence carries over — the shared demo always gets the not-written
branch.

**Decision.**
1. **Registration mirrors `stay_wealthy`** (the intent-slice template): kind
   union + `ASSISTANT_INTENT_KINDS`, deterministic guard
   `richLifeFromQuestion` with the same abstentions (amount declines so the
   W.1 compounding planner takes "save $X for my rich life"; date windows and
   `at|with` objects abstain; spend-targets abstain), wired into
   `parseAssistantQuery` after the single-signal routes, `validateIntent`
   accepts the closed kind (the LLM path silently returns null if forgotten
   — the two switch-traps), LLM prompt bullet + `intentFromKind`
   re-derivation case, server read-path case, follow-ups chips that each
   parse non-unknown (the hard gate), and the suggestion/capability copy.
2. **The possessive is the route mark.** "my rich life" routes; bare "rich
   life" (advice-shaped: "how do I live a rich life") does not — the
   stay_wealthy topic-word rule. Unit-locked both directions.
3. **The answer never re-authors the line.** `answerRichLife(vision)` echoes
   the stored value verbatim inside its own sentence (the /coach echo's one
   author stays `COACH_COPY.richLifeHeader` — one-author rule from #504);
   source = See on Coach. When `vision === null`: "I don't have your Rich
   Life line yet. Write one in Settings…" with source = Set it in Settings —
   the retire-at-age precedent for absent user input, NOT `answerUnknown`.
4. **Copy bans hold in Ask**: no "this card", no "below" (the L.15 lesson,
   and "below" is the exact word #504 had to scope away on /coach). Locked.

**Verification (real output).** `VERIFY_E2E=1 bash scripts/verify.sh` → ✅
VERIFY GREEN: tsc 0, probes tsc 0, eslint 0, unit **7,342 passed + 1
expected fail + 1 skipped / 448 files + 1 skipped**, `next build` clean; e2e
**365 passed + 1 flaky-on-retry** (`transactions.spec.ts:295` — documented
K.10 contention class, untouched by this diff; the new ask.spec rich_life
test in the passing set). No `prisma/` diff. No hostile critic — the
intent-slice lane precedent (#496–#500): the verifier is the majority
abstention suite (`assistant-rich-life.test.ts`, 11 tests) plus the
follow-ups hard gate (both switch-traps).

**Lessons recorded while closing.** Live-check strategy correction:
server-only answer copy cannot be bundle-probed (no client chunk carries
it) — the discriminating live proof for an intent is the ANSWER itself
versus the pre-slice unknown answer, and the script now asserts that
DOM-side. Also hardened two harness races live: the ask input is CONTROLLED
(a pre-hydration fill resets it → submit stays disabled — assert the
value stuck before clicking), same class as the demo-button race recorded
in #504. No code defect: production answered correctly on every probe.

## #506 — Ask "what should I cut?": the FI counterfactual over exactly the list printed (2026-08-24)

**Context.** TASKS Wave P row P.1, second half. The first slice (#494) routed
"what should I cut?" to the SAME `findOpportunities` list /coach prints but
deliberately did not answer "and what happens if I do". A cut is a decision
with a counterfactual; this slice computes it.

**Decision.**
1. **New pure engine `src/lib/engine/fi/counterfactual.ts`.**
   `cutCounterfactual` re-runs the SAME `monthsToFI` walk at the SAME real
   projection rate the /coach FI card compounds at (`coach.fi.projectionReturnBps`
   — the W.2 unit rule, never the nominal dial), with the cut applied to BOTH
   sides of the FI math: the target drops (`fiNumberCents(annualExpenses −
   12×cut, swr)`, floored at $0) AND monthly savings rise by the cut. The dual
   effect is the honest counterfactual: the FI number is built from what the
   reader spends, and a permanent cut is spending that stops — the $1/mo =
   $300-at-4% identity. A savings-only move would be the slider's answer, not
   the cut's; a non-vacuity lock asserts the two differ.
2. **`monthsSooner` can never be negative by construction** (a cut lowers the
   target and raises the pace; `monthsToFI` is monotonic in both) — the
   `max(0, …)` is a rounding floor, not a clamp. `newlyReachable` (baseline
   null → a date exists) is its own qualitative fact, because a null baseline
   has no date to subtract.
3. **The honest null lives in the copy's one author.** `COACH_COPY.
   cutCounterfactual` returns `null` when nothing moves, so no caller can
   print "about 0 months sooner" — a fabricated effect.
4. **One merchant, one saving.** `sumCutMonthlyCents` dedupes per merchant by
   the LARGEST row: one series can be both unused-subscription (full amount)
   and price-increase (delta), and cancelling it frees the full amount once —
   full+delta double-counts. The sentence's action count is the unique-merchant
   count for the same reason (critic F6).
5. **Copy discloses the three things that make the figure honest:** estimates
   are qualified inline ("part of it estimated" + the marked rows "assumed to
   land as marked"); the counterfactual's own load-bearing assumptions are
   stated ("Assumes the cuts stick and the freed money goes to savings"); month
   spans phrase as the FI card phrases them (months under two years,
   years+months above — never "about 734 months"; critic F3). No "this
   card"/"below" (the L.15 lesson); "as Coach", never "your rates" (W.13).
6. **The pre-#506 lock was replaced, not weakened.** `test_regression__p1_
   cut_does_not_invent_fi_movement` locked the first slice's no-re-projection
   contract; the task row mandates the counterfactual, so the lock became
   `test_regression__p1_cut_fi_movement_comes_from_the_engine` (movement iff
   the engine reports it, with the engine's own numbers) plus two
   honest-silence locks (no movement ⇒ no sentence; no counterfactual input ⇒
   no sentence).
7. **Scope: Ask only.** The radar/cash-dip re-walk ("your July dip
   disappears") is the remaining open piece of P.1 (recorded in TASKS);
   /coach-card radiation of the sentence is a follow-up candidate. The demo
   wiring lock (`fi-cut-counterfactual.test.ts`, drives `getCoachData`) keeps
   the counterfactual on the card's basis: baseline target and months must
   equal the standing figures.

**Critic (fresh context, read-only): PASS — 0 P0, 0 P1, 6 P2.** F1 (docblock
claimed a permanence clause the copy lacked → the clause shipped), F3 (raw
months → years+months phrasing + lock), F4 (estimate-heavy total → inline
"part of it estimated"), F6 (row count → unique merchants) executed in-slice;
F2 (ledger row citing the replaced test) fixed in REGRESSION_LEDGER; F5 (the
facts panel's remainder sum is per-row while the sentence's total is
per-merchant-max) recorded open with rationale: the facts sum the ROWS they
cover, and a per-merchant-max there would falsify that claim — not reachable
on the demo (raw == deduped == $78.87).

## #507 — Ask "what should I cut?": radar/cash-dip re-walk, speak only if it moves (2026-08-24)

**Context.** TASKS Wave P row P.1 leftover after #506. The FI half says what
acting on the list does to the number and the date. The remaining half is the
cash-flow walk: "your July dip disappears" — only if it actually does.

**Decision.**
1. **Harness, not new scalars.** Dip date and cover amount are properties of
   a 90-day `radarFromSnapshot` walk. The server clones the snapshot, runs
   `applyCutsToScheduled` on `snap.scheduled`, and re-calls the same engine
   with the same recurring overrides. The duplicate-pair radar gate is the
   precedent: re-walk, speak only if `firstNegativeDate` or
   `coverTransfer.amountCents` improves. Worsening-only and identical walks
   are the honest null.
2. **`applyCutsToScheduled` is the pure core**
   (`src/lib/engine/radar/cut-counterfactual.ts`). Opportunity has no series
   id, so matching is `normalizeMerchant(description).canonical` against
   `Opportunity.merchant` (for `toScheduledRow` those are the same string).
   Per-merchant MAX is the same rule as `cutByMerchant`. Income rows are
   never touched.
3. **Cadence scaling for `negotiable-bill`.** That kind is a calendar-monthly
   $20 estimate; unused-subscription / price-increase / 15% re-shop are
   per-occurrence. Applying $20 against a weekly $15 template would cancel
   ~13 hits. `monthlyCutToOccurrenceCents` (WEEKLY = round(monthly×12/52))
   scales the estimate onto the row before comparing. Unknown cadence is
   treated as monthly (fail-safe: do not invent a weekly conversion).
4. **Copy's one author owns the honest null.**
   `COACH_COPY.cutRadarCounterfactual` returns null when `moved` is false.
   A disappeared dip is the whole claim (the cover going to nothing is the
   same fact). Dates come from `formatISODate` on the walk, never a
   hardcoded month. Assumption names both branches: cancelled series leave
   the walk; an estimated saving only shrinks it. Grounding is "same
   committed projection as Cash flow radar". No "this card"/"below".
5. **Demo is the honest null, and that is locked.** Seed scheduled is
   payroll / rent / savings; the four opportunities are card-billed. The
   walk does not move. e2e and the live probe assert the radar sentence is
   ABSENT on the demo. A checking series that does match is locked in the
   unit harness, not on the demo.

**Critic (fresh context, read-only): cycle 1 FAIL 0 P0 / 2 P1 / 7 P2; cycle 2
PASS 0 P0 / 0 P1 / 7 P2 carried.** P1-1 (weekly $20 cancel) and P1-2
("stop hitting" claimed cancellation for reduce-walks) executed in-slice.
Carried P2s: sentence does not name the matching merchant; $50 cover rung;
product gates lock silence not the positive wire; burn Watch vs committed
"goes away"; "around" on an exact date; null-cover `$0.00` on a mixed
sides(); empty-list still does two walks.

**Scope: Ask only.** /coach-card radiation of the sentence remains the
follow-up on this row.

## #508 — /coach-card radiation of the cut FI + radar sentences (2026-08-24)

**Context.** TASKS Wave P row P.1 leftover after #507. Ask already said what
acting on the list does to FI and (when it moves) the 90-day cash-flow walk.
/coach printed the same list with no counterfactual. Two surfaces answering
"what should I cut?" could not disagree about the walk.

**Decision.**
1. **One load-bearing computation.** `getCoachData({ cutImpact: true })`
   runs the same two engines Ask used to call itself (`cutCounterfactual` at
   `projectionReturnBps`, `radarFromSnapshot` after `applyCutsToScheduled`,
   no `cardDuplicates`) and attaches engine results, never copy. /coach and
   Ask both render through `COACH_COPY.cutCounterfactual` /
   `cutRadarCounterfactual`. Ask no longer walks locally.
2. **Opt-in flag, same shape as `orderReview`.** Dashboard, digest, goals,
   and investments omit it so they do not pay two extra 90-day radar walks.
   Both required callers pass it (`/coach` page, Ask `what_to_cut`).
3. **Honest null stays in the copy.** The page mounts a sentence only when
   `COACH_COPY` returns a string — a `moved: false` payload is not a
   sentence. Empty list: no walks, no "Acting on all 0". Demo radar remains
   the seed-honest null (card-billed opportunities).
4. **Spending-plan re-projection stays deferred.** Original P.1 named three
   engines; #506/#507/#508 shipped FI + radar + radiation. The spending-plan
   "what the cut does to guilt-free this month" is a new remaining leftover,
   not this slice.

**Critic (fresh context, read-only): PASS — 0 P0, 0 P1, 4 P2 carried.**
P2-1 radar grounding names an off-page Home card (true on both surfaces);
P2-2 list title is row count vs sentence unique-merchant (#506 F5, now on
the card; demo 4=4); P2-3 positive radar paint on /coach is inspection-only
(demo never moves); P2-4 Card `overflow-hidden` vs document overflow gate.

## #509 — Standing: commit and push at the end of every slice (2026-08-24)

**Context.** CLAUDE.md rule 5 already required commit + PUSH + live proof
(owner 2026-07-21: "Always do all 3 before asking me to check"). The #508
slice still left `main` two commits ahead of `origin/main` because a Grok
auto-mode policy blocked `git push` without an "explicit current user
request," and the session treated that as a stop.

**Decision.** Owner restated 2026-08-24: *"always push and commit at end of
every slice."* That sentence is the standing request. A harness auto-mode
block is not a human gate (GRAPH.md §1 enumerates those: destructive,
real scope change, exhausted critic budget, missing credential). After a
green local verify the maker commits, pushes to `origin/main`, reads
`bash scripts/ci-status.sh`, and runs the live probe. `main` ahead of
`origin/main` remains an unshipped state.

**Alternatives rejected.** Asking "want me to push?" at slice end — that
is the "Want me to…?" pause LOOP_ENGINEERING forbids for reversible
follow-from-the-request work. Leaving the push for the next session —
that is how #257–#261 sat 8 commits unpushed.

## #510 — W.6(b) next extra dollar, ranked from rates on file (2026-08-24)

**Context.** TASKS W.6(b): given a dollar, does it go to debt, the match,
the emergency fund, or investing, from the reader's own rates. Match %
and tax-advantaged room are not collected.

**Decision.** Pure `nextDollar` in `src/lib/engine/fi/next-dollar.ts`.
Order: revolving APR strictly above the **nominal** return dial →
uncaptured match → runway under 3 months (same floor as the net-worth
band) → installment APR strictly above the return → investing. CREDIT is
revolving only when a statement remainder is past the issuer due date
(in-cycle balances are cash-needed). Null loan APR is skipped, never
ranked as 0%. LOAN and MORTGAGE both feed installment. Match is
hardcoded `unknown` this slice. Copy is one author (`COACH_COPY.nextDollar*`).
/coach and Ask `next_dollar` both render the same plan. Demo: Auto Loan
6.49% under our default 7.00%, runway ≥ 3 → investing.

**Ask routing.** Canonical phrases ("Where should my next dollar go?",
"Should I pay off debt or invest?") are locked. Contrast for
invest+debt is `or` / `vs` / `versus` / `rather than` / `instead of`,
or `before` only inside a `should I` ranking frame. Co-occurrence
without contrast stays `debt_payoff` / `cash_needed`.

**Critic.** Four cycles. Engine ranking: 0 P0 on money math across all
four. Ask parser: cycle 4 FAIL 1 P1 (budget exhausted → human gate).
Residual: `"How much should I pay off my cards before I can invest?"`
still hits `next_dollar` because `\bshould i\b` + `\bbefore\b` is the
ranking proxy and also cash-needed's modal. Recorded in STATUS. Not
certified as a critic pass.

**Alternatives rejected.** Collecting match % this slice (task row said
the app does not yet collect it — skip unknown). Comparing APR to the
real/after-inflation FI rate (unit mismatch). Treating in-cycle card
balances as high-APR extra-pay (that is cash-needed). Coercing null
APR to 0%.

## #511 — W.6(b) Ask P1: `should I` is not the ranking proxy (2026-08-24)

**Context.** #510 critic cycle 4 residual: `"How much should I pay off
my cards before I can invest?"` hit `next_dollar` because `\bshould i\b`
+ `\bbefore\b` was the ranking-frame proxy and also cash-needed's modal.
Owner "continue" unblocked the human gate. Money engine not reopened.

**Decision.** Constituency, not another global veto. Quantity/horizon
stems refuse all contrast. Purpose (`before I can` / `I'm able` / `so I
can` and close twins) vs `or`/`vs`/`instead of` is by index: operator
before the purpose is matrix ranking; operator after is inside the
purpose object. Bare `before investing` stays ranking. `next_dollar`
runs before `fi_status`; retirement inside a purpose adjunct declines
the FI date. `Do I need to pay off debt or invest?` is ranking (`how
much do I need to` already refuses via `how much`).

**Critic.** Four cycles this slice, 0 P0, 8 P1 all executed. Budget
exhausted; not certified as a pass.

**Alternatives rejected.** Dropping `before` as contrast entirely
(would un-route `"Should I pay off debt before investing?"`). Treating
every `should I` as ranking (the recorded P1). Another global substring
veto after each critic cycle (C3: purpose-anywhere stole matrix `or`).

## #513 — W.6(c) category fulfillment curve (2026-08-24)

**Context.** TASKS W.6(c): YMOYL fulfillment curve — life-energy exists per
purchase but not per CATEGORY over time. Spec only names the purchase lens;
the task row is the product requirement.

**Decision.** Pure `fulfillmentByCategory` in
`src/lib/engine/fi/fulfillment.ts`. Same complete-month window and
discretionary/`countsInFlows` gates as the discretionary-spend average.
Hours only via `hoursOfWork`. Trend = median of second-half monthly spend
vs first half (creep's half-split), spoken as "typical monthly spend" with
the half-window assumption in the footnote. Top N (5) ranked; `categoryCount`
forces the subtitle to name truncation instead of "each". `totalHours` is
the sum of monthly hours so the sparkline reconciles. `/coach`
`FulfillmentCard`. Ask radiation deferred.

**Critic (fresh context): cycle 1 FAIL 3 P1; cycle 2 PASS — 0 P0, 0 P1.**

**Alternatives rejected.** Ask routing this slice (coach first, W.9/W.10
pattern). Ranking by hours instead of spend at a fixed wage (equivalent
except tenth-rounding). Netting refunds (parity with
`averageDiscretionaryCategorySpend`; creep discloses refunds separately).

## #514 — P1.4 income lever (raise → FI delta) (2026-08-25)

**Context.** COACH_PRINCIPLES_PLAN P1.4: Sethi's income-side lever — a
hypothetical raise, saved at the current rate, recomputes the FI date
via existing `monthsToFI`. The savings-rate slider already exists; nothing
modeled earning more.

**Decision.** Pure `incomeLever` in `src/lib/engine/fi/income-lever.ts`.
Monthly raise = `roundHalfAwayFromZero(annual / 12)`; extra savings =
current `savingsRateBps` × monthly raise; FI **target unchanged**.
Non-positive rate saves $0 of the raise (dissaving is not applied as a
negative extra). `COACH_COPY.incomeLever` names the hybrid (only that
share is extra savings; FI number stays the one on file) and the
N-month **average** rate, never "current" beside the savings slider.
Honest null when nothing moves; newly-reachable is a date, not a
fabricated sooner. `/coach` FI card slider default **$10,000/yr**.
Ask deferred.

**Critic (fresh context): cycle 1 FAIL 2 P1** (lifestyle-frozen overclaim;
"current" vs the savings slider). **Cycle 2 PASS — 0 P0, 0 P1.** P2s
remain (idle/zero-rate still say "current"; first-paint $10k; tap target).

**Alternatives rejected.** Saving 100% of the raise (plan says current
rate). Restating the FI number from implied new expenses (often delays
the date; fabricates a lifestyle). Composing the two sliders this slice
(copy names the window average instead). Ask routing this slice.

---

## #515 — P1.5 investing ladder + fee-drag (2026-08-25)

**Context.** COACH_PRINCIPLES_PLAN P1.5: Collins/Sethi account-type
order (match → Roth IRA → max 401(k) → taxable) plus a 1% fee-drag
illustration on the reader's own portfolio. Match % still uncollected.
The 2026-07 sketch named `opportunityFVCents` (future dollars); W.10
already made /coach print today's money.

**Decision.** Pure `feeDrag` in `src/lib/engine/fi/fee-drag.ts`. 1% of
**today's** invested balance as a **level** monthly leak for 30 years
(`OPPORTUNITY_HORIZON_MONTHS[2]`), grown with `opportunityFVCents` and
printed via `opportunityValueTodayCents`. Not AUM-on-growth
(`FV(r) − FV(r−1%)`) and not their actual fund fee. Honest null when
there is nothing to leak. `COACH_COPY.feeDrag` names the monthly leak
and the grow-then-deflate mechanism; when
`opportunityValueTrailsContributions` the shortfall is "the assumptions
working". Ladder is a lens, not a rule, and does not claim they have a
match. `/coach` `InvestingLadderCard` after next-dollar. Ask deferred.
Demo: $142,000 → $118.33/mo → **$68,822.18** today at 7.00%/2.50%.

**Critic (fresh context): cycle 1 FAIL 2 P1** (trails-contributions
unexplained; monthly leak / grow-then-deflate unnamed). **Cycle 2
PASS — 0 P0, 0 P1.** Residual P2s: withheld-currency inline note on
this card; `dontTimeIt` "this order"; flat-nominal "never raise it"
clause.

**Alternatives rejected.** Lump-sum `FV(r) − FV(r−fee)` (plan said
reuse the opportunity primitive; copy names the level-leak model).
Printing nominal FV (W.10). Personalizing the ladder from an uncollected
match %. Ask routing this slice.

---

## #516 — Reports interest & fees YTD (2026-08-25)

**Context.** COACH_PRINCIPLES_PLAN leftover after P1.5: surface the
cost of interest and fees already on file (C8/C9), no moralizing, with
a 30-year if-invested illustration in today's money. Demo seed files
none of the four fee leaves.

**Decision.** Pure `interestFeesYtd` in
`src/lib/engine/reports/interest-fees-ytd.ts`. Paid = existing
`spendingByCategory` + `isSpendRow` over `interestFeeYtdWindow(today)`
(Jan of `today`'s year through today), summed on `fees` /
`fees-interest` / `atm-fee` / `late-fee` only — never the rest of
Financial. Illustration treats that YTD total as **one year's amount**
(`paid / 12` each month for 360), via `opportunityFVCents` /
`opportunityValueTodayCents`. Honest null when paid is $0. Engine
carries `contributingCategoryIds`; copy names only those leaves in the
paid sentence and the scan set in a separate "this figure counts"
clause. `/reports` `InterestFeesYtdCard`. Ask deferred. Demo empty.

**Critic (fresh context): cycle 1 FAIL 1 P1** (paid sentence listed all
four leaves after the dollars). **Cycle 2 PASS — 0 P0, 0 P1.** Residual
P2s: empty "this figure" after "no figure"; no YTD register href;
dashboard lean path still computes the tile; assembler non-null path
unlocked; reorder/drop of contributing IDs untested.

**Alternatives rejected.** Summing the Financial group (taxes and
loan-payment are not interest/fees). Annualizing remaining months of
the year (copy would have to invent a pace). Adding seed fee rows
(would ripple cash-needed / spend goldens). A this-month category-table
link for a YTD figure (C.26).

---

## #519 — Idle cash past a 6-month cushion (2026-08-26)

**Context.** COACH_PRINCIPLES_PLAN leftover after #518: a high-yield
note when idle cash far exceeds runway (C10 / C2). Runway already
divides checking+savings by the last-N expense average. The classic
6-month ceiling is the same bound Room for error already calls
"past".

**Decision.** Pure `idleCash` in `src/lib/engine/fi/idle-cash.ts`.
Cushion = 6 × monthly expenses (integer cents). Excess is named only
when liquid is at least **one extra month** past that cushion
("far", not a 1¢ nick). Unknown expenses are not a $0 cushion.
Negative liquid is idle, not a shortfall this note invents. No
illustrated yield and no HYSA/checking-yield lecture — we do not
collect a savings APY. Title is the lens name ("Cash vs a 6-month
cushion"), never a surplus claim. `/dashboard` after the expected-NW
card, **mine-scope only** (household net worth is a different set).
Not on `/accounts` (`getCoachData` throws with zero accounts). Frozen
checking/savings reuse `frozenTotalNote` with this note's own figure
label. Ask deferred. No schema change.

**Critic (fresh context): cycle 1 FAIL 3 P1** (HYSA/"pays little"
lecture; 1¢ surplus fired it; title claimed "past" on idle/empty).
**Cycle 2 FAIL 1 P1** (idle copy said "at or under" for the new
past-cushion / not-far band). **Cycle 3 PASS — 0 P0, 0 P1.** Residual
P2s: rounded 7-month runway beside "short of one extra month";
speaking branch has no UI lock.

**Alternatives rejected.** A 4% / 30-year opportunity illustration
(invents a rate and treats cash as invested). Putting the card on
`/accounts` (repeats #518's add-asset crash). A second liquid or
expense definition (violates one-question-one-basis). Nudging the
reader to open a HYSA or invest the difference (advice).

---

## #518 — PAW expected-net-worth lens (2026-08-25)

**Context.** COACH_PRINCIPLES_PLAN leftover after #517: C12 Stanley &
Danko expected net worth (age × income ÷ 10), framed as a lens, no
shame. No date of birth is stored. The FI card already authors average
monthly income.

**Decision.** Pure `pawLens` / `annualIncomeFromMonthly` /
`pawBand` in `src/lib/engine/networth/paw-lens.ts`. Expected =
`roundHalfAwayFromZero(age × yearly income ÷ 10)`. Yearly income is
the FI card's monthly average × 12. Age 0 / unset and income ≤ 0
produce no expected figure (unknown is not $0). Near = |actual −
expected| / expected ≤ 10% inclusive. Bands are above / near / under
— never PAW/UAW labels. `/dashboard` after `NetWorthCard` only when scope is `mine`
(household net worth must not mix with personal FI income). Not on
`/accounts`: `getCoachData` throws with zero accounts, and that page
is the first-run add-asset surface (CI `add-asset-btn`). Age slider
is client-only, not stored. Copy names the income window and that age
is chosen, not a date of birth. Ask deferred. No schema change.

**Critic (fresh context): cycle 1 PASS — 0 P0, 0 P1.** Residual P2s:
`getCoachData` over-fetch on /accounts; slider `aria-valuetext` at 0
(closed this slice); theoretical `delta * 10000` overflow.

**Alternatives rejected.** Persisting `User.ageYears` (schema + PII +
demo fence for a calculator). Defaulting a working age (fabricates
the reader). PAW/UAW labels (shame). Using household net worth on
`?scope=household` (two engines, two sets). A second income definition
(violates one-question-one-basis).

---

## #517 — Mortgage extra-principal what-if (2026-08-25)

**Context.** COACH_PRINCIPLES_PLAN leftover after #516: a mortgage
early-payoff calculator (C9 Conflict B). `loadDebtAccounts` already
excludes mortgages from the consumer-debt planner (Ramsey BS6, not
BS2). Demo seed has no `MORTGAGE` row.

**Decision.** Pure wrapper `mortgageEarlyPayoff` /
`pickMortgageForEarlyPayoff` in
`src/lib/engine/debt/mortgage-early-payoff.ts`. Two calls to the
existing `planDebtPayoff` on one mortgage — no second amortizer.
Unknown APR is not 0%; a stored 0% is a known zero. Months saved and
interest saved only when **both** legs clear. `/accounts` card after
the list (not inside the net-worth pair). Extra-principal slider
recomputes the same engine client-side. Copy is a calculator, not a
nudge — not a recommendation to prepay or to keep the loan. Ask
deferred. Demo empty. No seed mortgage.

**Critic (fresh context): cycle 1 FAIL 1 P1** (cash-due minimum treated
as the amortizing installment with no escrow/add-on disclosure).
**Cycle 2 PASS — 0 P0, 0 P1.** Residual P2s: context line omits escrow
clause; “if any” hedge; two-mortgage switcher; slider-only extra.

**Alternatives rejected.** Folding mortgages into `loadDebtAccounts`
(re-opens Conflict B on the planner). A new amortization loop (the
pinned walk already exists). Treating missing APR as 0% (W.6b). Adding
a demo mortgage (ripples cash-needed / spend goldens). Dashboard
`net-worth-card` this slice — `/accounts` already owns that card.

---

## #512 — W.6(d) drawdown on FI date (2026-08-24)

**Context.** TASKS W.6(d): Housel's "reasonable > rational" — what a 30%
portfolio drop does to the FI date. W.1's wealth-target card already
sensitizes *returns* ±2pp; nothing shocked the *starting portfolio*.
Behavioral `volatilityPrice` on the FI card was not quantitative.

**Decision.** Pure `drawdownCounterfactual` in
`src/lib/engine/fi/drawdown.ts`. Fixed 30% shock (keep 70% of portfolio),
then re-run `monthsToFI` at the same real rate, savings, and FI target as
the standing card. `COACH_COPY.drawdownCounterfactual` reports
`monthsLater` or `newlyUnreachable`; honest null when nothing moves.
/coach FI card: `<details data-testid="fi-drawdown">` after the behavioral
volatility disclosure. Ask radiation deferred (same pattern as P.1 half
slices). Demo: 45 months later on $142k brokerage at 4.5% real.

**Critic (Bugbot, fresh context): PASS — 0 P0, 0 P1.**

**Alternatives rejected.** Shocking the return dial instead of portfolio
(that is W.1). A second behavioral-only paragraph (already have
`volatilityPrice`). Ask routing this slice (engine + /coach first).

---

## #520 — C14 Giving YTD on /reports (2026-08-26)

**Context.** COACH_PRINCIPLES_PLAN leftover after #519: surface a
Giving category on reports. C11 assets-vs-liabilities is already
shipped (#99 — caption on /accounts). C14's Coast-FI "past enough"
framing shipped as #503. What remained was making gifts and
donations visible as spending, not a Coast-gated nudge.

**Decision.** Pure `givingYtd` in `src/lib/engine/reports/giving-ytd.ts`.
Same spend basis and calendar YTD window as interest-and-fees
(`givingYtdWindow === interestFeeYtdWindow`). Two system leaves only
(`gifts`, `charity`) — a custom row in the Giving group is not the
figure. Null when nothing is filed (empty sentence, never $0.00
given). Copy names only the contributing leaves. No 30-year
opportunity illustration (that would frame giving as a leak). No
tithe band, no "you should give." Coast-FI language stays on the FI
card. `/reports` after the interest-and-fees tile (not between the
chart and the category list — #516's mobile-nav lesson). Ask
deferred. Demo empty. No schema change. Giving goal preset left
for a later slice.

**Critic (fresh context): cycle 1 FAIL 2 P1** (empty title claimed
gifts already on file; empty body denied a custom Giving-group
donation). Empty subtitle is now "A lens, not a grade"; empty body
names the two leaves. "give more or less" dropped (P2). Dollars
unchanged. **Cycle 2 PASS — 0 P0, 0 P1.** Residual P2s: empty
"this figure" phrasing; GY5 is absence not a live refund;
assembler non-null path; rename vs taxonomy labels; window
computed twice; no 380px DOM-order lock.

**Alternatives rejected.** Summing the Giving group (a custom
category would silently join the dollars). A 30-year "if invested"
illustration (shame-adjacent; the fee tile earned that because
fees are a leak). Gating the tile on Coast FI (hides a true spend
fact). A $0.00 row inside spending-by-category (a zero is a claim).
Rebuilding C11 (already on /accounts).

---

## #521 — C14 Giving goal preset on /goals (2026-08-26)

**Context.** COACH_PRINCIPLES_PLAN leftover after #520: a Giving
goal preset on `/goals`. C14's Coast-FI "past enough" framing
shipped as #503; the spend fact shipped as #520. What remained was
a named starting point for a savings envelope, not a tithe.

**Decision.** Pure `goalPresetFields` in
`src/lib/engine/goals/presets.ts`. A preset is a **name**, never an
amount — `GoalPresetFields` has `name` only. Chip on the existing
`GoalForm` fills `Giving`; the reader types the dollars on the
unchanged `createGoal` path (`kind` null). Copy through
`COACH_COPY` (intro, label, hint). Hint names Gifts and Charity &
Donations via `GIVING_CATEGORY_LABELS`. No 10% of income, no tithe
band, no Coast-FI gate (that language stays on the FI card, same as
#520). Live probe fills the name and does **not** submit — the demo
row is shared. College/education deferred (same form, later slice).
Ask deferred. No schema change.

**Critic (fresh context): cycle 1 FAIL 1 P1** (e2e `[data-testid^="goal-"]`
also matched the chip and hint, so create+delete could not lock).
Locator scoped to `goals-list` + exact heading; intro no longer
claims a catalog; focus moves to the empty target; hint associated
via `aria-describedby`. **Cycle 2 PASS — 0 P0, 0 P1.** Residual
P2s: ungated vs Conflict C; savings-envelope FI-delay; duplicate
names; placeholder 10000; intro fragment; fill not announced.

**Alternatives rejected.** Inventing a yearly target from Giving YTD
/ 12 (turns a spend fact into a recommended amount — the opposite of
#520). A `kind: 'giving'` or reserve (this slice is a starting name
on the existing savings path). Gating the chip on Coast FI (hides a
starting name the way gating YTD hid a spend fact). Auto-submitting
the chip (a zero is a claim). College in the same slice (one job).

## #522 — C14 Education goal preset on /goals (2026-08-26)

**Context.** The last COACH_PRINCIPLES_PLAN C14 leftover, deferred by
#521 ("College/education deferred — same form, later slice"). With
this, C14 is closed: past-enough framing #503, the spend fact #520,
the Giving name #521, this.

**Decision.** The single Giving const in
`src/lib/engine/goals/presets.ts` became an ordered registry
(`GOAL_PRESETS`, `PRESET_BY_ID`, `goalPresetFields`). The contract is
unchanged and now applies to every preset: a preset is a **name**,
never an amount — `GoalPresetFields` still has `name` only, so a
caller cannot forget an amount was invented. `createGoal` untouched
(`kind` null).

**The name is `Education`, not `College`,** and it is read from the
taxonomy (`CATEGORY_BY_ID.get('education')?.name`) rather than typed
into the copy — same one-author rule as `GIVING_CATEGORY_LABELS`, so
the chip label, the submitted `Goal.name` and the category cannot
drift apart. `College` would narrow the envelope to one case (it also
covers trade school, a certification, the reader's own retraining)
and would invent a word the taxonomy does not carry.

**What the hint refuses to say, and why each refusal is load-bearing:**

* **No "a lens, not a grade".** That clause is Giving's alone.
  `/reports` renders a giving figure (#520) and renders **no**
  education figure — verified in `reports-view.tsx`, which mounts
  `GivingYtdCard` + `InterestFeesYtdCard` and nothing education-shaped.
  Borrowing the clause would describe a surface the app does not have,
  which is rule-1 fabrication in copy rather than in a claim.
* **No 529, ESA, Coverdell, UTMA/UGMA, tax treatment, scholarship or
  FAFSA.** The app has no account-recommendation surface and no
  state-by-state facts to stand on.
* **No ordering against retirement.** The canon disagrees with itself
  here (Ramsey puts BS4 before BS5); a preset is a name the reader
  asked for by clicking, not an ordering the app performed.
* **A student loan is named only to be excluded** — "a debt, not this
  envelope — the debt planner has it" — because `loadDebtAccounts`
  genuinely owns it (LOAN accounts; Plaid `student[]` liabilities map
  to LOAN), and a reader who files a payoff as savings makes both
  surfaces lie. `goalPresetFields('student-loan')` is null.

`givingGoalPresetIntro` renamed to **`goalPresetIntro`** — it heads
every chip, so it is no longer named for one of them. Behaviour
identical; the #521 lock (the heading must not promise a catalog it
does not have) survives, repointed. Giving's label, hint, testids and
`aria-describedby` are byte-identical, because
`scripts/p21-live-deploy-check.mjs` greps four of its phrases against
production. No schema change.

**Critic (fresh context): cycle 1 PASS — 0 P0, 0 P1.** It reproduced
tsc / eslint / vitest / both e2e itself, and independently checked the
premise of the biggest copy refusal (that `/reports` has no education
figure) rather than accepting it. **Its one P2 was fixed before ship,
not deferred:** the *rendered* chip label was pinned by nothing —
swapping the two `label:` entries in the form's `PRESET_COPY` renders
the Education chip as "Giving" and leaves every unit test, both e2e
specs and the production probe green, because they all read the name
*input*, which `applyPreset` fills from the engine registry. That is a
hole in precisely the no-drift claim this slice sells. Now locked by
an exact-text assertion on each chip in both e2e specs and in the live
probe (EDGE_CASES EP6). Residual P3s: a chip click overwrites a
typed name (shipped #521 behaviour, unchanged); both hints render
always, so a scanning reader can attach one to the wrong chip.

**Alternatives rejected.** Naming it `College` (narrower than the
envelope and absent from the taxonomy). Reusing Giving's hint
wholesale (would claim a reports lens that does not exist). A
`kind: 'education'` or a 529-shaped account (this slice is a starting
name on the existing savings path; the app recommends no account).
Rendering the chip label from `preset.name` directly to kill the drift
structurally — it would strand the `COACH_COPY` label key outside the
copy guardrail sweep, so the drift is caught by a test at the rendered
surface instead. A default target from average tuition (a recommended
amount, the thing every preset in this family refuses to be).

## #525 — P0.4 assign-to-zero leftover line on /budgets (2026-08-28)

**Context.** After C5 (#524) the coach-principles plan's remaining named
gap was P0.4 "assign to zero": the 3-bucket lens + bands + Ask already
shipped (#93 / #499); the leftover C6 affordance was to highlight
existing `leftToSpendCents` as leftover toward a fully-assigned plan
(no new math, no parallel budget store).

**Decision.** Pure `assignToZeroLineFor(leftToSpendCents, inflation)` in
`src/lib/engine/spending-plan/assign-to-zero.ts` returns
`COACH_COPY.assignToZero(cents)` only when leftover > 0 AND this card
does not already know the leftover is inflated. Null for 0 / negative
(overspent has `consciousOverspent`; a $0 leftover is an absence, not
a leftover-to-assign claim). Renders on `/budgets` in the conscious-
spending strip after the lens caption, `data-testid="conscious-assign-to-zero"`.
The amount is the guilt-free bucket by construction.

**Copy (critic cycle 1 P1-1).** Leftover is MONTHLY CAPACITY (income −
fixed − savings); discretionary spend this month is not subtracted
(`plan.ts` spentSoFar retirement). The first draft said "You have $X
still unassigned" — a remaining-cash claim about capacity. Shipped
sentence names capacity, never possession of unspent cash:
"$X of this month's income pattern is leftover after Fixed and
savings — that's the guilt-free remainder, a monthly capacity, not
cash still sitting unspent. Giving every dollar a job is the plan,
not a verdict."

**Inflation gate (critic cycle 1 P1-2).** The picker REQUIRES
`{ uncountedFixed, cardNotesPresent }` (L.15 — a default would be
forgotten at the caller that needed it). Either true ⇒ null, so a
leftover this card already discloses as too large / direction-unknown
is not certified as assignable. Unset savings is NOT inflation: that
is genuine unassigned leftover (the Ramsey case) and still prints
beside the savings-unset note. Strip passes the same `fixedShortfall`
and `cardNotes` it renders.

Ask / coach / spending-plan do not emit the line (one author).
`consciousSpending` / `consciousOverspent` byte-identical. ALL_STRINGS
row (`isProjection: false`). No schema change.

**Critic (fresh context): cycle 1 FAIL 2 P1; cycle 2 PASS — 0 P0, 0 P1.**
P1s executed and locked (AZ1–AZ5). Residual P2s recorded, not blocking:
$0 leftover stays silent (celebrating zero guilt-free would fight
Sethi's 20–35% band); soft "is the plan" is the C6 plan copy;
no aria-describedby; capacity clause reads as critic-voiced (true,
and required to close P1-1); inflation locks bind the picker not a
strip-render; `cardNotesPresent` is any note including leftover-
irrelevant frozen card-pay notes (safe direction).

**Alternatives rejected.** (a) Subtracting posted discretionary spend
so leftover means cash remaining — that reopens the retired
`spentSoFarCents` term the plan killed on purpose. (b) Treating unset
savings as inflation and hiding the line — that hides the genuine
Ramsey case, including the demo. (c) Emitting the line on Ask's
`conscious_spending` answer — no plan row names it for Ask; deferred.
(d) A "$0 leftover, every dollar has a job" close — would read as
success at zero guilt-free, against the 20–35% band.

| # | Phase | Decision | Rationale |
|---|---|---|---|
| 523 | P | C2 dashboard cushion line pairs the radar dip (coach-principles plan §4 Dashboard row): a pure composer `cushionLineFor(status, firstNegativeDate, runwayMonths)` (src/lib/engine/radar/cushion-line.ts) returns `COACH_COPY.cushionLine(months)` only when the radar prints a dip (`alert` + a first-negative date) AND the runway is a finite positive month count; null for ok/watch/no-date and for an unbounded (no expenses yet), zero, negative or absent cushion — a 0/∞/negative month count is an absence, not a cushion to name (naming it would fabricate a function). The line renders on /dashboard inside the Cash Flow Radar card (data-testid radar-cushion-line) in the alert block, under the cover-transfer box; the nudge feed's dip row defers to the card ("See Cash Flow Radar below"), and /forecast and /calendar are outside the plan's Dashboard row (recorded scope). Copy claims ONLY that the cushion handles what no forecast sees — it never covers or names the known dip the transfer above handles (regression-locked), and makes no claim about what the projection contains (the card states its own committed basis + estimated-future-cycle disclosure; critic cycle-1 P1-1 caught the maker's first draft asserting "sees only scheduled flows on file", which is false of the synthesized future dues — dropped, plan copy near-verbatim). Months printed as-is per the stayingWealthyRunway convention (2.1-month, never rounded). `COACH_COPY.cushionLine` registered in the guardrail scan as isProjection: false (a values/scope statement, same rule as pastEnoughCoast). Alternatives rejected: (a) adding a scope clause naming the card's basis — the card already states it, and a second statement must stay true of the whole card (cycle-1 P1-1); (b) rendering the line in the nudge feed row — one dip, one treatment is the card's job and the feed points at the card; (c) extending to /forecast and /calendar — the plan row names /dashboard; (d) a runway threshold (e.g. ≥3 months) — the sentence claims no sufficiency, and the pill already bands below/inside/above; (e) a counterpart sentence for negative/unbounded runway — the pill and staying-wealthy row already print the honest negative/no-expenses state; a third copy would duplicate. Cross-surface note: the cushion figure is the SAME `coach.runwayMonths` the room-for-error pill prints — one value, one author. | The plan's Dashboard row asks for exactly one sentence pairing dips with the cushion, and C2 was the last item on that row (pill already shipped). "Surprises" without the cushion would be the Housel point half-credited; the radar dip is where a reader sees a forecast fall short, which is the natural pairing. Honesty rules decided the shape: the sentence may describe what the cushion does (stands under the unseen) but never that it covers a dip the projection DID see, and never restate the projection's composition — that claim belongs to the card's own basis disclosure. |

| 524 | P | C5 time-window-of-life line closes the coach-principles plan's last C5 gap (§3 row: "no ... time-window-of-life framing" — the one-line's "buy experiences while you can"; §6's two C5 sentences — the dials "spend there proudly" line and the P2.2 memory-dividend reflection — were both already shipped; P1.1's dial tags shipped before it — #503 closed P1.1 as a skip). Artifact: a pure `windowLineFor(itemCount)` (src/lib/engine/fi/experiences-window.ts) returns `COACH_COPY.experiencesWindow()` only when the life-energy card has a purchase to qualify; `0` ⇒ null — a card printing "No large purchases" gets no "savor the moment" line under it (same absence rule as the cushion line's null states: an absence never restated as a claim). The line renders inside the life-energy card, beneath the P2.2 reflection, data-testid `life-energy-window` — the plan pairs its time-of-life language with hours-of-working-life (§6 C5 second sentence lives on this card; P2.2's row names this card as the C5 surface). Copy states the general truth only — some experiences are available only during a part of life, and money does not extend that part — with zero reader-specific claims (no age/health data stored, #518), zero numerals, no imperative to spend, no Aimplifi read-path claims, no restatement of the #503 Coast-gated past-enough sentence, byte-identical moneyDials/lifeEnergyReflection (both read by the production probe and the Ask what_to_cut answer — the slice adds one leaf, never edits one). Alternatives rejected: (a) opportunities-card header beside the moneyDials paragraph — that card is a savings-cuts list ("Savings opportunities — big wins first"); a sentence arguing why some spending is worth it would fight the card's purpose from inside it, and being dials-gated it would be invisible to every reader who never set a dial even though the window framing is true of everyone; (b) gating on outside-dial purchases like `showReflection` — the window is P2.2's sibling, not part of P2.2; an all-dial purchase list would lose the line exactly where the celebrating matters; (c) adding it to the Ask `what_to_cut` answer (which carries COACH_COPY.moneyDials) — no plan row names the window for Ask; deferred. ALL_STRINGS row (isProjection: false — no figures, same rule as pastEnoughCoast) + guardrail sweeps + EDGE_CASES EW1–EW4 + e2e exact-text pin. | See §0: "C2 / C5 / C13 PARTIAL"; C2 closed #523 and named this as next; the C5 one-line decomposes as dials (Present), cuts (Present), and exactly one unshipped clause — the time-window framing. The plan's own ordering (§6) puts the time-of-life idea beside the hours-of-working-life sentence, which is the life-energy card's field, so placement follows the plan's pairing, not the easiest slot. |

## #526 — D.3 standing-read audit: INDEX ≤220, EDGE_CASES next to tests, closed TASKS waves out (2026-08-28)

**Context.** Owner 2026-08-04: ledgers were burning session context. D.1/D.2
rotated the heavy ledgers. D.3's remaining job: measure the standing
session reads (LOOP_ENGINEERING.md + lessons INDEX + TASKS.md), then
trim the three named piles.

**Measured before (bytes; ÷4 ≈ tokens).** Named standing set:
LOOP 14,338 (~3.6k) + INDEX 37,527 (~9.4k) + TASKS 144,949 (~36.2k) =
196,814 (~49.2k). INDEX: 93 of 97 lines over 220 chars. EDGE_CASES.md
was a 242,457-byte dump (~60.6k) that every money session slurp- grepped.

**Decision.** (1) INDEX: one physical line per lesson, whole line ≤220
chars; backtick-only entry converted to a markdown link; the previously
unindexed duration lesson added. (2) EDGE_CASES.md is now the index;
69 section bodies moved verbatim to `tests/edge-cases/` (nearer the
suites that pin them). CLAUDE.md rule 3 points at the index + the
section files; do not load the index end-to-end. (3) Closed-wave empty
preambles (Wave 1, Wave P, O.17 residuals) and the now-complete Wave D
heading moved to `TASKS_DONE_ARCHIVE.md` with their rows. Nothing
deleted.

**After.** Named standing: LOOP 14,338 + INDEX 22,380 (~5.6k) + TASKS
142,378 (~35.6k) = 179,096 (~44.8k). INDEX 0 over-220 / 99 files
indexed. EDGE_CASES.md 12,097 (~3.0k). Locked by
`tests/unit/standing-reads.test.ts`.

**Alternatives rejected.** Truncating open-row status cells (not named;
those rows are still the work). Archiving the pre-split EDGE_CASES
monolith (the split files ARE the move; a second 242 KB copy is not a
standing-read win).

## #527 — Opt-in "Remember me on this device" at email/password sign-in (2026-08-28)

**Context.** Owner: "build a remember password button at login." #321 made
every session a 30-minute rolling idle timeout after Auth.js's implicit
30-day `maxAge` kept people signed in across shutdown on a shared
machine. LOGIN_AND_SESSIONS.md recorded "no remember this device option"
as deliberate for a first release. The owner now wants that opt-in.

**Decision.** A checkbox on the email/password form, **off by default**,
labeled "Remember me on this device." Unchecked keeps the 30-minute idle
window. Checked grants a 30-day idle window on that browser. Google and
demo sign-in have no checkbox and never stamp `remember: true`.

Auth.js cannot vary `session.maxAge` per sign-in (`session.js` hardcodes
cookie `Expires` from that single number on every session read — the
same fact that made #321 an idle timeout). So `maxAge` is the 30-day
ceiling, and `applySessionLifetime` in the **edge** jwt callback still
returns `null` when a token without `remember: true` has been idle past
30 minutes. Auth.js then clears the session cookie (`sessionStore.clean()`
in `@auth/core/lib/actions/session.js`). "Sign out of all devices" still
works: remember tokens carry `sessionEpoch`.

Numbers live in `src/lib/engine/auth/session-lifetime.ts` and are
re-exported from `auth.config.ts`. Sign-in copy derives from them.

**Alternatives rejected.** (a) Raising the global idle window — that
reopens #321 for every device, including shared ones. (b) A second
submit button "Sign in and remember" — two ways to sign in. (c) Storing
the password — the app never stores a password the browser's manager
doesn't already handle; this is stay-signed-in, not credential storage.
(d) Expressing the split through cookie config — not possible; see
`docs/lessons/a-framework-default-is-a-decision-you-shipped.md`.

## #528 — Employer-match Settings rung for next-dollar (2026-08-29)

**Context.** W.6(b) `#510` ranked an uncaptured employer match above
runway, but Coach always passed `employerMatch: 'unknown'` because
Settings never collected it. Ledgers called this leftover "Match %."
Tax-advantaged contribution room is still uncollected.

**Decision.** Collect a **rung status**, not a percentage. Match is not
a rate compared to APR (`#510`). Closed set on `User.employerMatch`
(`String?`): null = unknown (skip the rung), `uncaptured` wins the
destination, `captured` / `none` fall through and are not listed as
skipped-unknown. `parseEmployerMatch` is the one boundary; garbage
reads as unknown (never invent uncaptured). Demo writes fenced; demo
reads forced to unknown so the shared row cannot re-rank Coach.

Copy: uncaptured why names Settings, not the feed. Assumptions name
"an uncaptured employer match" (the engine predicate), not "match if
known." The investing ladder drops "we don't yet know" once a status
is stored; it stays a generic lens ("when you have one").

**Schema.** Additive nullable. Existing and demo rows stay null.
`vercel.json` `prisma db push` applies it on deploy.

**Alternatives rejected.** (a) A match-% field (50% of first 6% is two
numbers and is not comparable to APR). (b) Folding `none` into
`captured` in the UI — ranking is the same, the labels are not.
(c) Collecting tax-advantaged room this slice.

**Locked.** `parseEmployerMatch` EM1–EM3;
`test_regression__garbage_employer_match_column_is_unknown_never_uncaptured`;
N12/N13; `test_regression__captured_match_does_not_win_over_thin_runway`;
`test_regression__assumptions_name_uncaptured_match_not_if_known`;
`test_regression__known_match_drops_the_dont_know_ladder_clause`;
`test_regression__uncaptured_why_names_settings_not_a_feed`;
`test_regression__known_match_is_not_described_as_not_on_file`;
demo fence unit + `tests/e2e/employer-match.spec.ts`.

**Critic (fresh context): cycle 1 FAIL 1 P1** (assumptions said "match
if known" after captured/none). **Cycle 2 PASS — 0 P0, 0 P1.** Residual
P2s: generic ladder still leads with capture-the-match for `none`;
radios remount via `key` rather than fully controlled; dead "rate"
fallback in skipped copy; no e2e for captured/none ranking.

## #529 — Tax-advantaged contribution-room Settings rung (2026-08-31)

**Context.** W.6(b) `#510` skipped tax-advantaged contribution room as
unknown because Settings never collected it. `#528` collected match as a
rung status; this leftover stayed. Collecting an IRS dollar limit would
invent MAGI, catch-up ages, and annual caps we do not have, and naming
a vehicle would be account advice the education-preset lesson already
refused.

**Decision.** Collect a **rung status**, not a dollar amount and not a
vehicle. Closed set on `User.taxAdvantagedRoom` (`String?`): null =
unknown (skip the rung), `remaining` wins the destination **after**
revolving, uncaptured match, the 3-month runway floor, and installment
APR above the return — it names the envelope before taxable investing
and never outranks a contracted high-APR loan or a thin cushion.
`maxed` / `none` fall through and are not listed as skipped-unknown.
`parseTaxAdvantagedRoom` is the one boundary; garbage reads as unknown
(never invent remaining). Demo writes fenced; demo reads forced to
unknown so the shared row cannot re-rank Coach.

Copy: remaining why names Settings and the envelope, not Roth / 529 /
HSA. Assumptions name "remaining tax-advantaged contribution room" (the
engine predicate), not "if known." Skipped copy says the room isn't on
file yet (Settings), never "that rate." Radios and legend do **not**
say "this year" — a yearless column cannot carry an indexical tax year
(critic P1-1). The investing ladder is untouched this slice (still a
generic lens).

**Schema.** Additive nullable. Existing and demo rows stay null.
`vercel.json` `prisma db push` applies it on deploy.

**Alternatives rejected.** (a) Collecting remaining-room dollars or an
IRS limit (ungroundable without MAGI / filing status / tax year).
(b) Ranking remaining room above a thin runway or a high-APR installment
(those are contracted / survival rungs; the tax wrapper is not).
(c) Recommending Roth vs 401(k) vs HSA (educational not advisory).
(d) Storing a tax year beside the status — the reader can update the
rung; an invented year would be a calendar claim we do not compute.

**Locked.** `parseTaxAdvantagedRoom` TR1–TR3;
`test_regression__garbage_tax_room_column_is_unknown_never_remaining`;
N14–N20; `test_regression__maxed_tax_room_does_not_win_over_thin_runway`;
`test_regression__remaining_why_names_settings_not_a_vehicle`;
`test_regression__assumptions_name_remaining_room_not_if_known`;
`test_regression__known_tax_room_is_not_described_as_not_on_file`;
`test_regression__tax_room_copy_does_not_bind_a_tax_year`;
`test_regression__demo_tax_room_read_is_forced_unknown_even_if_column_is_dirty`;
`test_regression__ask_tax_advantaged_plan_is_the_same_author_and_names_no_vehicle`;
demo fence unit + `tests/e2e/tax-advantaged-room.spec.ts`.

**Critic (fresh context): cycle 1 FAIL 1 P1** (Settings radios said
"this year" with no stored tax year). **Cycle 2 PASS — 0 P0, 0 P1.**
Residual P2s: investing ladder still names Roth IRA (#515 lens);
radios remount via `key` rather than fully controlled.

## #530 — Change category click persists; Simplifi aliases are clickable (2026-08-31)

**Context.** Money on production: Uncategorized on Home did not open a
picker; ⋮ Change category opened Search categories; a Simplifi name
(Restaurants) was missing; Just this once did not still show after
refresh. Picker is scroll/click, not type-and-Enter.

**Decision.** (1) Category writes revalidate `/dashboard` as well as
`/triage` and `/transactions`, so Home cannot keep a stale Uncategorized
chip after a successful file. (2) O.17 refused Simplifi leaves
(Restaurants → `dining`, etc.) appear as extra clickable rows with the
existing id — no new system leaf. Confirm copy uses the canonical name
(Dining Out). Food Delivery is already a real leaf. Search may filter;
Enter does not file.

**Locked.** `tests/unit/simplifi-aliases.test.ts`.

## #531 — Simplifi CSV recategorizes matching existing rows (2026-09-01)

**Context.** Change category already persists by click. CSV import still skipped
duplicates (date + signed amount) and left Aimplifi's category in place, so a
Simplifi export could not correct live Plaid rows. Simplifi names like
Restaurants also did not resolve (`dining` is Dining Out). Savings-rate percent
is Settings-only; this slice does not restore the deleted 40% rails.

**Decision.** (1) `resolveCategory` maps a Simplifi alias (bare or grouped path)
onto an existing system id — never a new leaf. (2) Duplicate file rows with an
explicit resolved category rewrite the matched register row: Correction +
category write, Just this once (no Always merchant rule). Match order is the
same (date, signed amount) queue as the dedupe. No category column, unknown
name, or already-that-id is a no-op. Dashboard revalidates. Import copy says
matching rows take the file's category while Aimplifi is standing up.

**Locked.** `test_regression__simplifi_restaurants_csv_files_dining_not_a_new_leaf`;
`test_regression__simplifi_csv_recategorizes_duplicate_existing_row`.

## #532 — Needs a category chip is a real link (2026-09-01)

**Context.** Live 2026-09-01 on www.aimplifi.app: tapping Needs a category on
/transactions left the list at 2679 rows and the chip at aria-pressed=false.
`?unclassified=1` already showed the 15 unfiled rows. Server parse already
accepted `str(sp.unclassified) === '1'`. The chip was a `<button onClick>` that
`router.push`ed; a click before React hydration dropped silently (#167).

**Decision.** The unclassified chip is a Next.js `<Link>` to the same URL
`commit()` would push, so a pre-hydration click still filters. Off-state href
includes `unclassified=1` (and preserves other active params); on-state href
drops that param and keeps the rest. Selects, search, and dates stay on
`commit()` / `router.push`. Visibility unchanged: show when unclassifiedCount
> 0 or the filter is already on.

**Locked.** `test_regression__needs_category_href_encodes_unclassified`;
`test_regression__needs_category_chip_is_a_href_before_hydration`.

## #533 — Over-plan copy is the pattern remainder, not this-month spend (2026-09-01)

**Context.** Live 2026-09-01 www.aimplifi.app dashboard (signed-in, not signed
out): top card "Over plan by $3,085.33" / "guilt-free is $0 this month" next to
TOP SPENDING "$0.00 this month / No spending yet this month" and TRENDS "No
spending counted yet this month". Investigation verified this is NOT a clock
split. All three use provider.today. Over-plan is patternIncome − fixed −
savings from complete months month < ym. Discretionary this-month spend was
removed on purpose. Copy labeled that remainder as this-month overspend.

**Decision.** Copy-only; math unchanged. Dashboard SafeToSpendCard overspent
subtitle is the spending-plan honest line ("Your income pattern is more than
spoken for by fixed costs and savings"); drop "guilt-free is $0 this month".
The amount may still show the dollar shortfall ("Over plan by $X") without
"this month". Header stays "Over plan". Positive subtitle is "monthly
allocation after fixed costs & savings" — not a this-month spend window.
Spending-plan hero headers drop "this month" ("Over plan" / "Guilt-free to
spend"); the existing overspent subtitle stays. leftToSpendCents /
computeSpendingPlan stay pattern income − fixed − savings; spentSoFarCents is
not reintroduced. No remaining-after-spend number is invented.

**Locked.** `test_regression__overplan_copy_does_not_claim_this_month_spend`;
`test_regression__positive_safe_to_spend_copy_does_not_claim_this_month_spend`;
`test_regression__spending_plan_hero_headers_drop_this_month`.

## #534 — Today payment-due rows name the account (2026-09-01)

**Context.** Live 2026-09-01 www.aimplifi.app dashboard Today feed: eight
"Payment due $X to pay by DATE" rows with no account name, while Cash needed
above already showed "Bonvoy Amex Card ····2001". The name was already on
PaymentReminder.accountName (cardName / loan accountName). paymentProposal
hardcoded merchant null; Proposal had no accountName, so copy could not print
it. STATUS.md already named this Home gap. Putting the name in merchant would
mint a false register "View charges" link.

**Decision.** Add Proposal.accountName, verbatim from PaymentReminder.accountName
on payment_due and null on every other kind. payment_due detail prefixes
`{accountName}: ` when present; title stays "Payment due" / "Payment scheduled
(autopay)" (never "Card payment due" — rows are cards AND loans). merchant stays
null on payment_due. Amounts and dates unchanged.

**Locked.** `test_regression__payment_due_copy_names_the_account`;
payment_due.accountName verbatim lock in `tests/unit/nudge-select.test.ts`;
`test_regression__payment_due_carries_account_name`.

## #535 — You're covered names this cycle (2026-09-01)

**Context.** Live 2026-09-01 www.aimplifi.app: Cash needed "You're covered /
Projected low point is $2,105.16 on Fri, Sep 4" sat in the same viewport as
Cash flow radar "Investor Checking is projected to dip below $0 in 30 days"
and a 90-day lowest of -$34,442.88. Investigation verified this is not a
math bug (same payment account, same clock, integer cents; $34,450 cover is
the $50 round-up of that low). Cash needed walks this-cycle cards only
(loans and estimated next-cycle excluded). Radar is the 90-day committed
walk (loans + estimated dues). The green all-clear did not repeat window or
account, so a 3-day this-cycle cover read as a 90-day all-clear.

**Decision.** Copy-only on CashNeededCard covered-alert. Title "You're
covered this cycle". Description names through headline.byDate, the low
point, and "every card due this cycle in {paymentAccountName}". Radar math
and layout unchanged. Do not hide the 90-day hole. Do not retune
computeRadar / computeCashNeeded.

**Locked.** `test_regression__covered_alert_names_this_cycle_not_a_90_day_all_clear`.

## #536 — Inbox copy does not promise auto-file quality (2026-09-01)

**Context.** Live 2026-09-01 www.aimplifi.app /triage: the page promised
"Only genuinely ambiguous transactions land here — everything else is
filed automatically" next to Categorization accuracy 5.3% (21 of 398
labeled). The 5.3% is a real scored hit-rate over later labels (DECISIONS
#37). The promise is not. Same claim in nav Inbox description and the
zero-account empty state.

**Decision.** Copy-only. Inbox subtitle, nav description, and first-run
empty state describe transactions that still need a category. Subtitle
names the accuracy figure as how often auto-file matched a later label,
not a promise that the list is small. Accuracy math unchanged. Do not
invent an auto-file quality claim.

**Locked.** `test_regression__inbox_copy_does_not_promise_only_ambiguous_land_here`.

## #537 — Strip bank-feed tokens that are not a payee (2026-09-01)

**Context.** Live 2026-09-01 www.aimplifi.app /transactions showed bank leftovers as names: "Debellis & Assoc Purchase Trn Fj8xzkz", "Linkagnt Hertz", "Www.springscinema.com", "Local Expedition - S". cleanDescriptor title-cased the whole string and did not strip those tokens. Joined Merchant.canonical kept the dirty form, so the register showed it.

**Decision.** stripPayeeNoise removes PURCHASE TRN <token>, leading WWW., leading LINKAGNT, trailing ~ TRAN, and a truncated trailing " - X". cleanDescriptor uses it on ingest. registerDisplayName applies it to the chosen label so a persisted dirty canonical still reads as a payee. A reader's renameTo is unchanged unless it is those tokens. Do not invent a brand table for every leftover.

**Locked.** `test_regression__purchase_trn_and_www_are_not_the_payee`; `test_regression__register_strips_persisted_payee_noise_not_a_rename`.

## #538 — Cursor and Moonshot file software (2026-09-01)

**Context.** Live 2026-09-01 /transactions: "Cursor Usage Jul" and "Moonshot Ai" showed Shopping. normalizeMerchant left them unknown (uncategorized, 50%), so the provider-category rescue (#155) auto-filed Plaid GENERAL_MERCHANDISE as shopping.

**Decision.** Known merchants: CURSOR → Cursor / software; MOONSHOT (AI) → Moonshot / software. Same tokens in the software generic table for non-leading forms. A confident software match is not overridden by a Plaid shopping hint. Starbucks already files coffee in the engine; do not invent a Food Delivery fix without a descriptor that actually files that way.

**Locked.** `test_regression__cursor_usage_and_moonshot_file_software_not_shopping`.

## #539 — Direct Starbucks is coffee; delivery-app Starbucks is Food Delivery (2026-09-01)

**Context.** Live 2026-09-01 some Starbucks rows showed Food Delivery. Direct store charges are Coffee Shops (existing leaf). Food Delivery is correct only when the charge is through DoorDash / Uber Eats / Grubhub / Postmates / similar. `DD *STARBUCKS` cleaned to Starbucks and filed coffee.

**Decision.** A delivery-channel pattern (DD *, DOORDASH, UBER EATS, GRUBHUB, POSTMATES, SEAMLESS, INSTACART, GOPUFF, CAVIAR) plus STARBUCKS files food-delivery. Bare / Square / Toast Starbucks stays coffee. Do not invent a leaf. Do not file every Starbucks as Food Delivery. A reader's renameTo still wins display.

**Locked.** `test_regression__direct_starbucks_is_coffee_not_food_delivery`; `test_regression__doordash_starbucks_is_food_delivery`; `test_regression__starbucks_rename_is_kept`.

## #540 — CSV import is any source, not a Simplifi standup matcher (2026-09-01)

**Context.** Live 2026-09-01 /transactions/import promised "any bank — or a Simplifi CSV" and "Simplifi wins while Aimplifi is standing up." CSV is a production classify-any-source path. That copy made it a household-standup tool.

**Decision.** Copy-only on the import page and paste helper. Any bank or CSV. Optional category column files matching existing rows. Do not name Simplifi. Do not drop the alias table (Restaurants still files dining). Do not hardcode a household's merchants.

**Locked.** `test_regression__csv_import_copy_is_any_source_not_simplifi_standup`.
