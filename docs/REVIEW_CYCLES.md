# Adversarial review cycles — merged findings ledger

Protocol: 5 independent agents per cycle (Logic, Architecture, Adaptability,
UI/UX, Trust). Fix Critical+High; defer Mediums with reason; exit after two
consecutive cycles with zero new Critical/High.

## CYCLE 1 (2026-06-12) — merged ranked findings

### Critical
| # | Finding (agents) | Fix |
|---|---|---|
| C1 | Entire app renders in Times New Roman — `--font-sans: var(--font-sans)` circular in globals.css (UI-visual) | point at `--font-geist-sans` |
| C2 | Categorization learning loop severed: rules are written, never read — `categorize()` never receives user rules anywhere at runtime (Logic M2, Arch C1, Adapt C1) | merchantId→canonical rule loader passed into triage; regression test |
| C3 | Plaid provider overclaims "implemented": sync persists nothing, `/liabilities/get` never called, `storeAccessToken` silently discards the token when no plaid accounts exist (Trust C2, Arch H3, Adapt C2) | honest relabel in code+docs; guard token store; full ingestion → roadmap (credential-blocked) |
| C4 | Privacy promises false: audit log covers a fraction of the claimed list; `Correction`/`RecurringSeries` don't cascade on user delete; deletion-retention text self-contradicts (Trust C1/H3, Arch H2) | cascade relations added; audit logging for login + rule create/batch; PRIVACY.md rewritten to facts |
| C5 | Tree fails its own verify gate: critic scratch files at root break `tsc`/`build` (Logic H1) | delete litter; gitignore `_*` |

### High
| # | Finding | Fix |
|---|---|---|
| H1 | assemble+engine+holidayTable dance copy-pasted 3× with DRIFTED payment-account fallbacks (Arch H1, Adapt H2) | single `getCashNeeded()` + `resolvePaymentAccount()` |
| H2 | Category split-brain: creep/insights re-categorize raw descriptors, ignoring user corrections that budgets honor (Arch C2) | insights prefer stored categoryId |
| H3 | Mobile nav: 5 of 8 destinations undiscoverable at 380px; no active state on any viewport (UI) | client nav, active state, bottom tab bar `<sm` |
| H4 | Shortfall alert is a dead end and guesses "e.g. from savings" while holding the real account list (UI) | name the account + balance; calendar link; relative dates |
| H5 | Triage rule prompt unreachable when accepting the last item; "Always" on ambiguous merchants (Zelle/Check) permanently mis-files them (UI, Logic M1) | prompt rendered in empty state; rule offer suppressed for low-confidence merchants |
| H6 | FI slider degenerate copy ("from 23.3% to 23.3%") + unexplained 37.3% vs 23.3% mismatch (UI) | special-case + label vs 6-mo average |
| H7 | Calendar computes the dip and doesn't draw it (UI) | shortfall-day badge with projected low |
| H8 | Creep chart is unreadable decoration (UI) | month labels + value caption |
| H9 | Goals empty state answers nothing (UI) | worked emergency-fund example from live coach data |
| H10 | "In-app reminders" copy overclaims a static badge (Trust H2) | copy corrected |
| H11 | Stale/overclaiming docs: README counts, "AES encryption implemented", auth comments, STATUS WCAG bullet (Trust M1/M3/L1/L3) | corrected |
| H12 | No migrations directory — schema evolution = destructive reseed (Adapt H1) | `prisma migrate` baseline |
| H13 | Cards page ignores urgency order; "You must pay" buried as row 4 of 4 (UI) | sort by due date; user-action as headline |
| H14 | Demo-ness discoverable on 2 of 8 screens (Trust M2) | demo banner in app layout |

### Medium — fixed opportunistically (cheap)
budgets PENDING filter; coach Math.round→roundHalfAwayFromZero; dangling
becameRuleId on undo; authz requireUserId dedupe + missing audit on rule
actions; dead shadcn components; duplicate package.json prisma key; shadcn CLI
out of runtime deps; net-worth ticks "Jan '25" + delta; nav "Review"→"Inbox";
emoji→lucide icons; triage page grid; due-row layout; orphaned button;
null-APR assumption note; aprBps-null interest disclosure.

### Deferred with reason
- **Plaid ingestion trunk** (sync persistence, liabilities mapping, transfer
  detection on ingest, rules-on-ingest): credential-blocked and large;
  honestly labeled everywhere now; ROADMAP #1. The demo product does not
  depend on it.
- **Transfer pair-matching one-to-one consumption** (Logic M3): only reachable
  via ingestion path above; bundled with it.
- **Scale work** (full-history snapshot per render, O(n²) pair groups,
  triage N+1): demo-scale safe; STATUS #4, ROADMAP #8.
- **Zod validation at provider boundary / typed env module** (Adapt M2, Arch M8):
  refactor without user-visible behavior change; scheduled with Plaid work.
- **Engine copy convention** (Arch M7): cash-needed notes ARE presentation
  strings by design; documented in DECISIONS instead of refactored.
- **possiblyUnused 90-day heuristic** (Logic L4): usage is unobservable in
  transaction data; code comment corrected to match DECISIONS #18 proxy.
- **Older-delinquent-behind-newer-statement masking** (Logic L7): only occurs
  for issuers that don't roll balances forward; noted in STATUS.
- **Localization** (Adapt L4): USD/en-US declared a v1 non-goal in README.

## CYCLE 2 (2026-06-12, post-cycle-1 state; fresh agents — two died on API
## stream errors and were re-run focused)

**Critical: 0 · High: 3 · all fixed same cycle.**

| Sev | Finding (agent) | Fix |
|---|---|---|
| High | The Geist font fix only half-landed: variables on `<body>`, `font-sans` applied on `<html>` — most body text still serif (UI) | variables moved to `<html>` |
| High | This ledger claimed a DECISIONS entry that didn't exist (engine-copy convention) — doc-integrity violation (Arch) | DECISIONS #19 written; #20-23 added for the other as-built deviations |
| High | Calendar header counted due DATES as "card due dates" — 3 badges vs "2" (UI) | "N cards due across M dates" |
| Med | loadUserRules trusted pre-guard aggregate rules (Logic) | read-path aggregate filter |
| Med | Batch apply offered merchant-wide on aggregates — one tap files 7 unrelated Zelle payees (Logic+UI) | batch scoped to exact descriptor for aggregates |
| Med | ROADMAP #1 omitted rules-on-ingest; no single documented ingestion order (Adapt) | DECISIONS #22 + ROADMAP clause |
| Med | goals empty-state `cents(x/2)` crashes on odd cents; cron comment claimed unimplemented cursors; PHASE_0 "binding" ADB stale; stale 406 test count | all fixed |
| Low | undo not retryable; swipe could race pending actions (snap-back now); savings "12-month average" overstated window; transfer advice could exceed stated balance; removeItem audit under-described | all fixed |

Discovered during fixing: the new mobile header overflowed 380px (secondary
nav labels), zooming the layout viewport to 401px — found by the gate, fixed
with icon-only secondary links. Gate after fixes: **VERIFY GREEN, 407 unit /
18 e2e.**

Cycle 2 had >0 High findings ⇒ the two-clean-cycles exit clock starts at
cycle 3.

## CYCLE 3 (2026-06-12, post-cycle-2 state, fresh agents)

**Critical: 0 · High: 3 · all fixed same cycle.** Arch/Adapt and Trust lanes
were fully clean; Logic found two engine-adjacent Highs and UI one copy High:

| Sev | Finding | Fix |
|---|---|---|
| High | Calendar spread `[...cards, ...upcoming]` — upcoming is a SUBSET of cards, so estimated obligations double-counted in events/totals/card-count | pass `result.cards` only |
| High | Aggregate batch: server scoped to exact descriptor, client optimistic removal still merchant-wide — unrelated Zelle payees vanished from the queue unfiled | client filter mirrors server scope; ONE shared `similarTransactionsWhere` helper for button-count and mutation |
| High | Savings copy said "this month" for last-FULL-month data (June reader sees May's number) | month named explicitly everywhere ("in May 2026"); card description carries the month |
| Med | `/calendar?month=2026-13` 500; formatMonth garbled out-of-range; batch undo retry duplicated inverse rows; batch where-clause duplicated in two files | month guards; idempotent atomic per-correction undo; shared helper |
| Low | cron failure-audit could abort the sweep if the DB is down; MONTHS const after first use; stale batch docstring; headline/body precision mismatch (1dp everywhere now) | fixed |

Gate after fixes: **VERIFY GREEN, 409 unit / 18 e2e.** Cycle 3 had >0 High ⇒
clean-exit clock restarts: cycles 4 and 5 must both be clean.

## CYCLE 1 fix verification

All 5 Critical and all 14 High findings fixed (Plaid ingestion itself remains
deferred — the FINDING was the dishonest labeling, which is fixed; the feature
is honestly roadmapped). Gate after fixes:
`VERIFY_E2E=1 bash scripts/verify.sh` → **VERIFY GREEN: 406 unit / 18 e2e,
typecheck + lint + build clean.** Fixes landed in 5 commits (`git log
--oneline -5`). One regression introduced-and-caught during the cycle: a
silent `if (pending) return` tap-drop guard (replaced with visibly disabled
buttons), and an orphan-rule mapping that would have matched everything
(caught by the new unit test before commit).
