# Decision Log

Record every non-trivial decision made during the build: what, why, alternatives
considered. Append-only.

> Entries #1-#401 live in `docs/archive/DECISIONS_ARCHIVE_1_to_401.md`;
> #402-#484 live in `docs/archive/DECISIONS_ARCHIVE_402_to_484.md`
> (rotated 2026-08-28, same current-wave cut as PROGRESS/REGRESSION).
> #485-#723 live in `docs/archive/DECISIONS_ARCHIVE_485_to_723.md` (rotated 2026-09-11);
> #724-#736 live in `docs/archive/DECISIONS_ARCHIVE_724_to_736.md` (rotated 2026-09-16);
> #737-#739 live in `docs/archive/DECISIONS_ARCHIVE_737_to_739.md` (rotated 2026-09-17);
> #740-#741 live in `docs/archive/DECISIONS_ARCHIVE_740_to_741.md` (rotated 2026-09-17);
> #742-#748 live in `docs/archive/DECISIONS_ARCHIVE_742_to_748.md` (rotated 2026-09-19).
> Only entries #749 onward live here; append new entries as before — the numbering
> never resets, the archives hold the lower numbers.

## #762 — Open chapter bodies before the shell; restore landmark focus rings (2026-09-19)

**Context.** #761 P2s the owner can see: first open painted an empty `<details>` then the cards; nested Coach landmarks hid the land ring with `focus:outline-none`.

**Decision.** First open mounts children, then sets `details.open` in `useLayoutEffect` (`pendingOpen`). First summary click `preventDefault`s while unmounted. Nested Coach landmarks drop `focus:outline-none`. Home clicks parse `new URL(href).hash`. No schema change. RSC payload and M.4 restyle stay residual.

**Locked.** Units: `pendingOpen`, `preventDefault`, landmark tags have no `focus:outline-none`. Playwright: open chapter already contains `fi-card` / `net-worth-amount`; `#coach-money-dials` `outlineStyle !== none`.

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 7 P2.**

## #761 — Mount unread chapter bodies only after first open (2026-09-19)

**Context.** #760 residual (5): closed Home/Coach chapters still committed every card into the first HTML. Owner: continue.

**Decision.** `{mounted ? children : null}` with `useState(defaultOpen)`. First open (toggle, hash, nav, or e2e OPEN without KEEP_*_CLOSED) keeps the body mounted. Coach nested landmarks (`coach-money-dials`, `coach-rich-life`, `coach-employer-match`, `coach-tax-advantaged-room`) reveal the parent chapter so wealth-target / onboarding / Investments jumps still land. Daily loop and Coach This month stay mounted. RSC still serializes children (named residual; not `next/dynamic`). No schema change. M.4 restyle stays owner-gated.

**Locked.** `tests/unit/coach-chapters.test.ts` / `home-chapters.test.ts` (`{mounted ? children : null}`; Habits/Trajectory `landmarks`). Playwright under KEEP_*: closed `fi-card` / `money-rules-card` / `net-worth-amount` / `home-plan-figures` `not.toBeAttached()`; `/coach#coach-money-dials` and `wealth-target-dials-link` open Habits.

**Critic (fresh context): cycle 1 FAIL UX 7 / 1 P1 (nested hashes dead). Cycle 2 PASS UX 9 / 0 P0 / 0 P1 / 7 P2.**

## #760 — Home chapter jump nav, focus on open, valid summary lead (2026-09-19)

**Context.** #759 residuals the owner can use: no Home jump nav; hash/nav open did not move focus; `<p>` inside `<summary>` is outside the HTML summary model; marker locked only by source grep.

**Decision.** After the open daily loop (radar last), a `home-chapter-nav` jumps to Adjust / Picture / Setup. Setup link and chapter share one `showHomeSetup` flag. Hash or `#id` click opens the chapter and focuses it (`tabIndex={-1}`). Leads are a `<span className="mt-1 block…">`. Native `listStyleType` locked in e2e. Focus ring stays visible. No schema change. Coach SSR and M.4 restyle stay residual.

**Locked.** `tests/unit/home-chapters.test.ts` (radar < nav < adjust; `showHomeSetup` used ≥3 times; span lead; `el.focus()`). Playwright `home-chapters.spec.ts` (nav opens Picture, Adjust closed, focused; hash focused; painted `disclosure|disc`). Coach same-hash + focus + marker.

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 5 P2.** P2-1/P2-2 closed same-session (outline kept; one setup flag).

## #759 — Coach chapters: native marker, same-hash re-open, coaching voice (2026-09-19)

**Context.** #757 P2s: Coach summaries hid the disclosure triangle; a second Trajectory tap was a no-op; Trajectory/Habits leads talked about page structure. #758 P2-4: Home hash-open untested.

**Decision.** Restore the native `<details>` marker on Coach (same `ps-4` gutter as Home). A click on `a[href="#id"]` opens that chapter even when the hash does not change. Trajectory: "Your savings rate, FI number, and how the long game is tracking." Habits: "Your money dials, streaks, and the rules that keep the plan going." Home chapters get the same click-to-open. No schema change. Coach SSR and M.4 restyle stay residual.

**Locked.** `tests/unit/coach-chapters.test.ts` (no hide tokens; leads second-person; click href). `tests/e2e/coach-chapters.spec.ts` (Habits closed at 380; same-hash Trajectory re-open). `tests/e2e/home-chapters.spec.ts` (`#home-picture` opens Picture only). `tests/e2e/desktop-header.spec.ts` Plan/Trends described.

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 3 P2.**

## #758 — Home chapters: daily loop open, Adjust / Picture / Setup closed (2026-09-19)

**Context.** #757 residual (5): Home below the stage was still a feature dump. Owner: continue (including mobile). Cycle 1 critic FAIL UX 6: Welcome back and alarm-state radar sat inside closed chapters.

**Decision.** After stage + recent + Today + goals + alert banners + onboarding + return-moment + cash-flow radar, unread Home chapters start closed: **Adjust the plan** (plan figures), **The picture** (savings / spending / insights / net worth / export / paw / idle), **Home setup** (deepen + push, only if either exists). Native disclosure marker kept. Alerts and radar stay in the open loop. No schema change.

**Locked.** `tests/unit/home-chapters.test.ts` (source order; banners + return + radar before Adjust; chapters not `defaultOpen`). Playwright `home-chapters.spec.ts` (380: daily loop + radar visible; Picture/Adjust closed until summary click). Harness `__AIMPLIFI_E2E_OPEN_HOME`; collapse spec sets `KEEP_HOME_CLOSED`.

**Critic (fresh context): cycle 1 FAIL UX 6 / 2 P1. Cycle 2 PASS UX 9 / 0 P0 / 0 P1 / 4 P2.** P2s: return vs banners (then banners-first); 4px then `ps-4` gutter; harness auto-open; no hash-nav.

## #757 — Visual IA: grouped sidebar, Home stage, Coach chapters (2026-09-19)

**Context.** Live review of www.aimplifi.app (1280 / 390) scored Craft 6 / Identity 4 / Composition 5 / IA 4 / Mobile 7. Desktop nav wrapped 19 pills; Home dumped the plan form between heroes; Coach was a 7,076px essay. Owner: keep working until the worst critic scores 9.

**Decision.** Desktop: grouped sidebar (Daily / Money / Explore), labels only except Plan / Spending / Reports / Trends (one-line descriptions). Phones: five tabs + More sheet (descriptions + search focus + Tab trap). Home `home-stage`: cash-needed first in the DOM (left on desktop, above on 380); guilt-free is the pair (`MONEY_PAIR_CLASS`); plan form after recent + today. Cash-needed card `size="sm"`; this cycle's dues, forecast/cards links, and assumptions start inside a closed `<details data-testid="cash-needed-dues">` so both amounts finish inside 800px on CI Linux chrome. Trends description starts with "Category movers…" — never "What changed" — so `/trends` `getByText('What changed')` stays unique. Coach: h1 "Coach"; chapters This month / Trajectory / Habits in source order; unread chapters are `<details>` closed (Now `defaultOpen`); goals + household in Now; Rich Life + money rules in Habits. Brand: `BrandMark` + uncolored "Aimplifi"; sign-in real `<h1>`. Money tokens: `MONEY_DISPLAY_CLASS` / `MONEY_PAIR_CLASS` / `MONEY_NEGATIVE_CLASS`. No schema change.

**Locked.** `tests/unit/desktop-sidebar.test.ts`, `tests/unit/coach-chapters.test.ts`, `tests/unit/home-plan-figures.test.ts`, `tests/unit/page-chrome.test.ts`, `tests/unit/demo-sign-in.test.ts`, `tests/unit/nav-destinations.test.ts` (Trends contains `movers`, not `what changed`). Playwright: `home-stage.spec.ts` (380 y-order + dues closed + 1280 x-order), `coach-chapters.spec.ts` (order + 380 collapse), `phase1-cash-needed.spec.ts` (guilt ≤800), `desktop-header.spec.ts`, `mobile-nav.spec.ts` (search focused; Trends `Category movers`). Harness `__AIMPLIFI_E2E_OPEN_COACH` opens chapters for existing Coach specs; collapse spec sets `KEEP_COACH_CLOSED`.

**Critic (fresh context, cycle 3): PASS UX 9 / 0 P0 / 0 P1 / 4 P2.** Cycle 1 FAIL UX 5 (4 P1). Cycle 2 FAIL UX 7 (2 P1: labeled feed; 19 bare nouns). Cycle 3 closed both. P2s: no chapter chevron; same-hash re-click no-op; Trajectory lead voice; Habits/desktop description not e2e-locked.

## #756 — O.20j residual (10): trim sibling plaidItemId === so same-item copies stay two accounts (2026-09-19)

**Context.** #755 critic P2-1: the live-map join trims keys, but `sameIngestConnection`, `accountsOf`, and the `/accounts` card filters still used raw `plaidItemId ===`. A padded vs clean stored item id looked like two connections, so same-item copies folded on last-4 and a genuine transfer could vanish; padded accounts also disappeared from combine.

**Decision.** `samePlaidItemId` trims both sides; empty / whitespace-only is not a match (membership). `sameIngestConnection` treats empty / whitespace after trim as missing (fail-closed: same ingest, block folding). Wired into `accountsOf` and both `/accounts` filters. Live 0977 unchanged. `isTransfer` add-only. H.7b not auto-run. No schema change. Present map value `''`, leftover raw maps / `Set.has`, and `plaid.ts` investment `===` stay residual.

**Locked.** `tests/unit/transfer-pair-identity.test.ts`: padded vs clean same item does not fold; empty / whitespace does not fold; padded same-item transfer still flags+files; `samePlaidItemId` empty-not-a-match; three sites use the helper. `tests/unit/combine-connections.test.ts`: padded account fk and padded stored `itemId` still offer the Chase combine. FAIL-OLD (maker, no helper): **8 failed | 80 skipped**. Critic independently: **6 failed | 82 passed** (restored untrimmed `===` at the three sites; helper left intact).

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r10`): cycle 1 PASS 0 P0 / 0 P1 / 7 P2.** Independently: tsc 0, 88/88, FAIL-OLD 6|82, kill-calls (a) trim-one-side 2|86, (b) empty-equals-empty 1|87, (c) empty-as-different-ingest 1|87. P2s in STATUS.

## #755 — O.20j residual (9): trim live-map keys so a padded stored itemId still joins (2026-09-18)

**Context.** #754 critic P2-1: lookup was trimmed, map keys were raw `itemId`. A padded stored `PlaidItem.itemId` missed `Map.has` and inherited the Account stamp — the #754 inversion.

**Decision.** `liveInstitutionByItem` trims the insert key. Empty / whitespace-only stored ids are not keys. Combine, `/accounts`, and the transfer sweep all call it. Live 0977 unchanged. `isTransfer` add-only. H.7b not auto-run. No schema change. Sibling `plaidItemId ===` and present map value `''` stay residual.

**Locked.** `tests/unit/transfer-pair-identity.test.ts`: padded stored key + clean fk stays present-null; padded stored key still presents `ins_56`; whitespace-only stored id is not a key; three callers use the helper. `tests/unit/combine-connections-server.test.ts`: padded `itemId` + clean fk → `institutionId` null. FAIL-OLD (untrimmed helper): **3 failed | 113 skipped** (maker, filtered); critic independently **4 failed | 1 passed | 111 skipped**.

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r9`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, eslint 0, 116/116, FAIL-OLD 4|1|111, kill-call skip empty-key guard 1 failed. P2s in STATUS.

## #754 — O.20j residual (8): trim plaidItemId before the live institution join (2026-09-18)

**Context.** #753 critic P2-1 / P2-2: `resolveLiveInstitutionField` looked up `plaidItemId` without trimming. A padded id (`" item-a"`) missed `Map.has` and inherited the Account stamp, so a present-null live item looked identified.

**Decision.** Trim the lookup key. Empty / whitespace-only is missing (stamp is last-known). Live 0977 unchanged. `isTransfer` add-only. H.7b not auto-run. No schema change. Map keys and sibling `plaidItemId ===` sites stay untrimmed (this-cycle P2s). Present map value `''` still returns `''`.

**Locked.** `tests/unit/transfer-pair-identity.test.ts`: padded present-null stays null; padded live `ins_56` over null stamp; whitespace-only uses stamp. `tests/unit/combine-connections-server.test.ts`: padded fk + present-null item → `institutionId` null. FAIL-OLD (untrimmed `has`): **3 failed | 108 skipped**.

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r8`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, eslint 0, 111/111, FAIL-OLD 3|108, kill-call value-trim 3 failed. P2s in STATUS.

## #753 — O.20j residual (7): present-null institution name does not inherit the stamp (2026-09-18)

**Context.** #752 critic P2-1: `buildCombineInputs` and `/accounts` `identityOf` still inlined `item?.institution ?? stamp`. A present-null live PlaidItem inherited the account name stamp, so the identity ladder's both-null name fallback could prove SAME and offer an irreversible continue while the live bank is unknown.

**Decision.** Both surfaces call `resolveLiveInstitutionName` (same `Map.has` join as the id helper, shared `resolveLiveInstitutionField`). Present null stays null; missing item still uses the stamp (disconnect). Live 0977 (`ins_56` over a null stamp) is unchanged. `isTransfer` add-only. H.7b not auto-run. No schema change. Whitespace / empty-string `plaidItemId` stays residual (this-cycle P2-1/P2-2).

**Locked.** `tests/unit/combine-connections-server.test.ts`: present-null + stale name stamp → `engineAccounts[0].institutionName` null; missing item → stamp; live Chase over null stamp; `getAccountsView` present-null live name + matching stamps after disconnect → `reconciliationCandidates []`. `tests/unit/transfer-pair-identity.test.ts`: both files call `resolveLiveInstitutionName(a.plaidItemId, a.institutionName, institutionNameByItem)`. FAIL-OLD (`??` restored): **3 failed | 1 passed | 103 skipped**.

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r7`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, eslint 0, 130/130, FAIL-OLD 3|1|103, kill-call stamp-only 4 failed. P2s in STATUS.

## #752 — O.20j residual (6): combine and /accounts use the Map.has institution join (2026-09-18)

**Context.** #750 critic P2-1: `buildCombineInputs` and `/accounts` `identityOf` still inlined `item?.institutionId ?? stamp`. A present-null live PlaidItem inherited the account stamp, so the identity ladder could prove SAME and offer a combine while the transfer writer fail-closed.

**Decision.** Both surfaces call `resolveLiveInstitutionId` (Map.has). Present null stays null; missing item still uses the stamp (disconnect). Live 0977 (`ins_56` over a null stamp) is unchanged. `isTransfer` add-only. H.7b not auto-run. No schema change. `institutionName` still uses `??` (critic P2-1 this cycle: names are ignored whenever either side has an id; both-null name match is the documented ladder fallback).

**Locked.** `tests/unit/combine-connections-server.test.ts`: present-null + stale stamp → `engineAccounts[0].institutionId` null; missing item → stamp; live `ins_56` over null stamp; `getAccountsView` present-null + matching stamps → no combine offer, `bank-id-missing`. `tests/unit/transfer-pair-identity.test.ts`: both files call `resolveLiveInstitutionId(a.plaidItemId, a.institutionId, institutionIdByItem)`. FAIL-OLD (`??` restored): **3 failed | 95 skipped**.

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r6`): cycle 1 PASS 0 P0 / 0 P1 / 4 P2.** Independently: tsc 0, eslint 0, 98/98, FAIL-OLD 3|95, kill-call stamp-only 5 failed. P2s in STATUS.

## #751 — Owner Yes on the ops walkthrough and the two live-data writes (2026-09-18)

**Context.** After #750 the owner asked what they still needed to do. Four optional
items were named. Owner, verbatim: **"3. Yes. 4. Yes."** — (3) a first-timer
walkthrough for Neon backups, cron fire, and Sentry; (4) undo the nine
`unsupported` Combined-accounts supersessions and seed demo holdings on
production.

**Decision.** Write the walkthrough from official / in-app labels
(`docs/OPS_WALKTHROUGH.md`). Do not invent a bulk-undo script — U.15 (b) already
has per-link **Undo** on `/accounts`, reversible via `undoneAt`. Do not run
`prisma db seed`. Seed holdings only via `npm run seed:demo-holdings` (additive,
demo `acct-brokerage`, INVESTMENT-gated). This VM has no `DATABASE_URL` and will
not decrypt Vercel env, so the two writes stay owner-executed. Do not flip
`DATA_PROVIDER=plaid`. Do not undo GENUINE / UNTESTABLE links. Sentry is DSN-only
(no `@sentry/wizard`); #203's "deferred paid tracking" still holds — Developer
plan + `SENTRY_DSN` is enough. Cron fire stays UNVERIFIED until the owner reads a
200 in Vercel **View Logs** after 11:00 UTC (Hobby ~1h log retention; a 24h
`requestPath` group on 2026-09-18 returned zero `/api/cron/*` lines).

**Locked.** Docs only. No money-math change. No schema change.

## #750 — O.20j residual (5): a present PlaidItem with null `ins_*` does not inherit the stamp (2026-09-18)

**Context.** #749 critic P2-1: `resolveLiveInstitutionId` used `Map.get` + `??`, so a *present* PlaidItem whose `institutionId` is `null` (pre-backfill) fell through to `Account.institutionId`. Two live copies with matching stale stamps then folded on last-4 — #748's fail-closed rule never ran. Map.has mutation on the #749 tree killed 0 tests.

**Decision.** `Map.has`: a present item (including null) is live and unproven; return `get(...) ?? null`. The stamp is last-known only after disconnect deletes the item (key absent). Live 0977 (`ins_56` over a null stamp) is unchanged. `isTransfer` add-only. H.7b not auto-run. No schema change. Mixed-type over-veto stays residual (1). combine-connections / `/accounts` keep their inline `??` (critic P2-1; not the transfer writer).

**Locked.** `tests/unit/transfer-pair-identity.test.ts`: helper golden (present-null + stale stamp → null); `test_regression__o20j_live_null_item_ignores_a_stale_matching_stamp` (joined ids stay null, no fold). `tests/unit/transfer-pair-filing.test.ts`: `test_regression__o20j_live_null_item_stale_stamp_still_overturns_a_purchase` (`{ overturned: 1 }`). FAIL-OLD (`??` restored): **3 failed | 84 passed**. Critic ignore-map: **7 failed | 80 passed**. Map.has always-true: **1 failed | 86 passed** (disconnect stamp fallback).

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r5`): cycle 1 PASS 0 P0 / 0 P1 / 6 P2.** Independently: tsc 0, 87/87, FAIL-OLD 3|84. P2s in STATUS.

## #749 — O.20j residual (4): the live 0977 fold reads PlaidItem `ins_*`, not the null stamp (2026-09-18)

**Context.** #748's critic P2-2: the filing 0977 lock stamped `Account.institutionId = ins_56` and never created a `PlaidItem` row. Live 0977 is the opposite (stamp NULL, item `ins_56`). A join regression to stamp-only would keep that fixture green and refuse the live fold, so a dining purchase vs a filed TRAVEL CREDIT would overturn again.

**Decision.** Extract `resolveLiveInstitutionId` (live item wins; stamp is last-known after disconnect deletes the item — same `??` join combine-connections already inlines). `loadTransferSweepRows` is the only transfer-identity caller; it must call the helper, not the stamp. The filing fixture is the measured shape: two `PlaidItem` rows with `ins_56`, both account stamps null, unique `${userId}-item-*` ids. `isTransfer` stays add-only. H.7b not auto-run. No schema change. Mixed-type over-veto stays residual (1); cycle-4 still refuses CREDIT≡CHECKING through a confirmed terminal.

**Locked.** `tests/unit/transfer-pair-identity.test.ts`: helper goldens (item over null stamp; stamp after missing item; item over stale stamp; missing both → null); live-shape fold through the helper; stamp-null without a map does not fold; `loadTransferSweepRows` source lock on `resolveLiveInstitutionId(a.plaidItemId, a.institutionId, institutionByItem)`. `tests/unit/transfer-pair-filing.test.ts`: live-shape Prisma fixture, `{ overturned: 0 }`. FAIL-OLD (stamp-only `a.institutionId ?? null` in transfer-refresh): **2 failed | 82 passed**. Ignore-map mutation (critic): **4 failed | 80 passed**.

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r4`): cycle 1 PASS 0 P0 / 0 P1 / 4 P2.** Independently: tsc 0, 84/84, FAIL-OLD 2|82, ignore-map 4|80, Map.has (live-null no fallthrough) 0 died. P2s in STATUS.
