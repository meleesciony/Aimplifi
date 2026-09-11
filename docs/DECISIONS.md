# Decision Log

Record every non-trivial decision made during the build: what, why, alternatives
considered. Append-only.

> Entries #1-#401 live in `docs/archive/DECISIONS_ARCHIVE_1_to_401.md`;
> #402-#484 live in `docs/archive/DECISIONS_ARCHIVE_402_to_484.md`
> (rotated 2026-08-28, same current-wave cut as PROGRESS/REGRESSION).
> #485-#723 live in `docs/archive/DECISIONS_ARCHIVE_485_to_723.md` (rotated 2026-09-11).
> Only entries #724 onward live here; append new entries as before — the numbering
> never resets, the archives hold the lower numbers.

## #724 - M.4 slice 2: shared page-chrome tokens, chrome restyle, brand-tinted dark theme (2026-09-10)
**Context.** The owner's standing beauty pass (Wave M.4, docs/MOBILE_UI_BRIEF.md: tokens before routes, no big-bang restyle). The working tree held the maker output, interrupted before gates: type scale and spacing had drifted (text-xl vs text-2xl page titles; some routes space-y-4), the shell chrome (header, nav, footer, demo banner, sign-in card) had no shared elevation language, and dark mode was a generic neutral slate.
**Decision.** Four shared tokens in src/components/finance/page-chrome.ts (PAGE_TITLE_CLASS, PAGE_LEAD_CLASS, PAGE_STACK_CLASS, PAGE_SECTION_LABEL_CLASS), unit-locked; every visible page h1 and lead migrated (including the new-user welcome card, the only h1 a zero-account user sees); the two byte-identical trends-view section labels migrated with it. Shell chrome restyle: sticky translucent header, pill desktop nav, mobile bottom-bar active indicator (shape, not color), demo banner as a rounded pill, sign-in card elevation, rounded-lg auth inputs, surface cards gain a 1-ring hairline. The .dark block re-tinted with slight brand-green chroma (oklch hue 165) - the app renders hard-coded dark, so this IS the product's identity; light :root untouched. All changes are className/CSS-variable only: no copy, figure, adjacency, testid, or logic change.
**Locked.** tests/unit/page-chrome.test.ts (token utilities); tests/e2e/m4-page-chrome.spec.ts (19 routes x 380+1440 no horizontal overflow; 30px desktop title scale; pill nav; demo-banner pill radius).
**Boundary repairs earned this session (own ledger rows).** A core.autocrlf=true re-smudge had rewritten 586 worktree files to CRLF (bash -n broke; a source-window test overflowed) - repaired byte-identically and pinned with .gitattributes `* text=auto eol=lf`. tests/unit/vercel-build.test.ts never passed on this machine: bash here is WSL (PATH/env do not cross the boundary as the test assumed; DATABASE_URL needs WSLENV) - made platform-aware, Linux path unchanged.
## #725 — CI repair: four red e2e specs + Needs-a-category aria-pressed (2026-09-10)
**Context.** CI `verify` run `34511385651` (slice 2) failed four mobile-380 e2e plus a flaky axe scan. Logs named the lines: `budget-clear-*` not found after set; reconnect alert missing "Reconnect it on the Accounts page"; wealth-target href still `/settings#money-dials`; `/transactions` axe `aria-allowed-attr` on `<a aria-pressed>`.
**Decision.** Retarget the specs to the shipped UI. Clear is inside BudgetRowTargetControl's editing form (#659) — open the row target first; after clear, lock the first-run hint and the gone row (a collapsed clear count-0 is a tautology). Failed-sync copy is `Reconnect it so your numbers stay current` with in-place SimpleFIN reconnect. Wealth-target assumptions link on /coach is `#coach-money-dials` (Settings `#money-dials` remains). The Needs-a-category chip stays an `<a>` so a click before hydration still filters; on-state uses `aria-current`, never `aria-pressed`.
**Locked.** `tests/e2e/budget-targets.spec.ts`, `tests/e2e/pwa-offline.spec.ts`, `tests/e2e/connection-health.spec.ts`, `tests/e2e/wealth-target.spec.ts`, `tests/e2e/transactions.spec.ts`; `test_regression__needs_category_chip_is_a_href_before_hydration`; `test_regression__household_can_change_a_budget_target_on_the_category_row` (Clear after `if (!editing)`).

## #726 — Household can edit plan figures from Home without leaving for Spending plan (2026-09-10)
**Context.** PlanFiguresForm (savings %, optional income/fixed locks) lived on Spending plan and Budgets. Home's Safe to Spend and cash-needed cards read those dials, but changing them required leaving — Safe to Spend only linked to Spending plan.
**Decision.** Mount PlanFiguresForm on /dashboard (`home-plan-figures`) beside Safe to Spend, ahead of Cash needed. Same writer (`updatePlanFigures`); already revalidates /dashboard. Demo read-only. No Settings remount. No PushOptIn / deepen / Coach Goals / category / CSV work.
**Locked.** `test_regression__household_can_edit_plan_figures_from_home_without_leaving_for_spending_plan`.

## #727 — Household can edit a card statement from Home Cash Needed without leaving for Cards (2026-09-10)
**Context.** Cash Needed on Home listed undated cards with balance and mostly said there was nothing to do except open Cards. Manual CREDIT cards already use CardStatementControl on Cards and Calendar (#710); Home still sent the owner away to add the statement that would put the card into the figure.
**Decision.** On /dashboard CashNeededCard, for viewer-owned manual CREDIT cards in the undated / not-included set, mount CardStatementControl (`home-cash-needed-statements` / `home-cash-needed-statement-{accountId}`). Same setManualCardStatement / clearManualCardStatement writers; card-actions already revalidates /dashboard. Partner cards stay display-only. Linked (non-manual) cards keep the honest “nothing to do” / wait-for-feed copy — no fake Add. Demo fenced. No PushOptIn. No Settings remount. No deepen / Coach Goals / category / CSV / Trust invent.
**Locked.** `test_regression__household_can_edit_card_statement_from_home_cash_needed_without_leaving_for_cards`.

## #728 — Household can edit a dated card statement from Home Cash Needed without leaving for Cards (2026-09-10)
**Context.** #727 mounted CardStatementControl on Home Cash Needed for undated / not-included manual cards. Dated dues still listed on the same card, but correcting an existing statement still required Cards or Calendar.
**Decision.** On /dashboard CashNeededCard, for viewer-owned manual CREDIT cards that appear in this-cycle due dates or upcoming estimated dues, mount CardStatementControl (`home-cash-needed-dated-statements` / same `home-cash-needed-statement-{accountId}`). Same writers; card-actions already revalidates /dashboard. Partner and linked cards stay display-only. Demo fenced. No PushOptIn. No Settings remount. No deepen / Sync / Coach Goals / category / CSV / Trust invent.
**Locked.** `test_regression__household_can_edit_dated_card_statement_from_home_cash_needed_without_leaving_for_cards`.

## #729 — Household can convert a repeating bill to a reserve from Recurring without leaving for Spending plan (2026-09-10)
**Context.** ConvertToReserveButton (createReserveFromSeries) lived on Spending plan Fixed composition and Settings Fixed costs. Recurring already edits bill name/amount/cadence and can mark Not a bill, but turning a convertible series into a reserve still required leaving.
**Decision.** On /recurring, for non-demo outflow rows whose billKey or merchantCanonical is convertible in the same `getSpendingPlan().fixedSetup` gate Spending plan uses, mount ConvertToReserveButton (`recurring-convert-to-reserve`) with that billKey. Same writer; already revalidates /recurring. Loan payments and income excluded. No Settings remount. No PushOptIn / deepen / Sync / Coach Goals / category create / CSV / Trust invent.
**Locked.** `test_regression__household_can_convert_bill_to_reserve_from_recurring_without_leaving_for_spending_plan`.
## #730 — Household can take a repeating bill off the plan from Recurring without leaving for Spending plan (2026-09-10)
**Context.** TakeBillOffPlanButton lived on Spending plan Fixed composition. Recurring already mounts Not a bill and now Convert (#729), but taking an on-plan repeating bill off the Fixed figure still required leaving.
**Decision.** On /recurring, for non-demo outflow rows whose billKey is on the Spending plan Fixed list (same gate as takeRepeatingBillOffPlan), mount TakeBillOffPlanButton (`recurring-take-off-plan`). Same writer; bill-rename-actions already revalidates /recurring. Loan payments excluded by the plan line gate. No Settings remount. No PushOptIn / deepen / Sync / Coach Goals / category / CSV / Trust invent.
**Locked.** `test_regression__household_can_take_bill_off_plan_from_recurring_without_leaving_for_spending_plan`.
## #731 — Household can put a bill back on the plan from Recurring without leaving for Spending plan (2026-09-10)
**Context.** PutBillBackOnPlanButton lived on Spending plan and Settings Fixed costs for `billsTakenOff`. Recurring already mounts take-off (#730) and Convert (#729), but restoring a taken-off bill still required leaving.
**Decision.** On /recurring, when non-demo and `getSpendingPlan().billsTakenOff` is non-empty, mount the same PutBillBackOnPlanButton list (`recurring-bills-taken-off` / `recurring-bill-taken-off-row`). Same writer; bill-rename-actions already revalidates /recurring. No Settings remount. No PushOptIn / deepen / Sync / Coach Goals / category / CSV / Trust invent.
**Locked.** `test_regression__household_can_put_bill_back_on_plan_from_recurring_without_leaving_for_spending_plan`.
## #732 — Household can download net worth export from Accounts without leaving for Investments (2026-09-10)
**Context.** Net worth CSV/PDF lived on Investments (#696) and Settings. Accounts already shows the net-worth headline and trend, but downloading still required leaving.
**Decision.** Mount the same `/api/export?format=net-worth-csv` and `net-worth-pdf` links on /accounts (`accounts-net-worth-export-card` / `export-net-worth-csv` / `export-net-worth-pdf`), after AccountsList. Same export routes. No Settings remount. No PushOptIn / deepen / Sync / Coach Goals / category / CSV parser / Trust invent.
**Locked.** `test_regression__household_can_download_net_worth_export_from_accounts_without_leaving_for_investments`.
## #733 — Household can download net worth export from Home without leaving for Investments (2026-09-10)
**Context.** Net worth CSV/PDF lived on Investments (#696), Settings, and Accounts (#732). Home already mounts NetWorthCard with the headline and trend, but downloading still required leaving.
**Decision.** Mount the same `/api/export?format=net-worth-csv` and `net-worth-pdf` links on /dashboard after NetWorthCard (`home-net-worth-export-card` / `export-net-worth-csv` / `export-net-worth-pdf`). Same export routes. No Settings remount. No PushOptIn / deepen / Sync / Coach Goals / category / CSV parser / Trust invent.
**Locked.** `test_regression__household_can_download_net_worth_export_from_home_without_leaving_for_investments`.

## #734 - M.4 slice 3: section-label token, lead-column cap, body-wash scrolls (2026-09-11)
**Context.** #724's critic left three residual P2s: seven near-twin section-label literals outside the token; PAGE_LEAD_CLASS max-w-2xl overreaching the max-w-md routes (triage, error, transactions/import, transactions/new); body gradient background-attachment: fixed (iOS Safari ignores it; forces a paint on every scroll frame).
**Decision.** The seven files render PAGE_SECTION_LABEL_CLASS (spend-class-panel's h3 keeps mb-2). PAGE_LEAD_CLASS caps at max-w-md - a ceiling, not a width - and PAGE_LEAD_WIDE_CLASS ('sm:max-w-2xl') re-opens the column on the wide routes (accounts, goals, rules, triage, ask). Body gradient uses background-attachment: local; the desktop pinned-wash behavior is intentionally gone on every platform. Two byte-visible micro-deltas accepted on /investments and /recurring: label icon gaps gap-1.5 to gap-2, aligning to the token the dashboard cards already use. Same-session repair before gates: spend-class-panel's mb-2 was silently dropped by the tokenization and restored.
**Locked.** tests/unit/section-label-tokens.test.ts (all seven files render the token; the near-twin literal is gone from them); tests/unit/page-chrome.test.ts (token utilities + PAGE_LEAD_WIDE_CLASS wired into all five wide consumers).
