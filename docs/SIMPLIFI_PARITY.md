# SIMPLIFI_PARITY.md — the parity floor, and why it is only the floor

**Owner mandate, 2026-07-29, verbatim across three messages:**

> *"Categorization and features for categorization are extremely lacking compared to simplifi. See these
> photos. You have the ability to change things like 'contains tjmax'. Because the card number and other
> numbers always change. This aids in future pain."*
>
> *"Your goals are to make the app at least as good as simplifi. Currently we can't even solve the
> transaction list. Rest of features also pale in comparison."*
>
> *"Parity is the baseline. We were supposed to make this smarter and more useful in every way, building
> in principles from personal finance books, finding ways to cut unnecessary spending etc…"*

This document is the field-level gap list against Simplifi (the parity FLOOR), plus the pointer to where
the beyond-parity work is planned. It is a gap description, not a status board: per the one-status-home
rule, what is shipped lives in `docs/STATUS.md` and the build queue in `TASKS.md` (Wave O.13 and Wave P
are the rows this document backs).

Every "Aimplifi today" verdict below was re-derived from the schema and the components on 2026-07-29, not
copied from an older plan. Where an existing doc disagreed, the disagreement is named.

---

## 1. What the owner's screenshots show

Six screenshots of Simplifi, mobile and desktop:

**Create Rule (the headline).** Two columns. *"If a transaction matches this"* — a **Payee** condition
offering the **original statement name** or the cleaned-up name, an operator dropdown (**Contains**), and
the match key rendered as deletable keyword **chips**: `tjmaxx`, `0181`, `0966`. The helper text states
the semantics: *all keywords must be present*, commas or spaces enter a new keyword, and "OR" conditions
target different keyword combinations. Plus **Account** conditions (with OR) and an **Amount** condition.
*"Then make these changes"* — **Rename Payee** (to `Tj Maxx`), **Update Category**, **Add Tags**, **Add
Note**, **Exclude from**, **Mark as Reviewed**. The footer promises *"You'll handle existing transactions
next."* This is the owner's point: the volatile store number `0181` and sequence `0966` are chips he can
delete, leaving `contains tjmaxx`, which then holds forever.

**Transaction detail (mobile + desktop).** A real per-transaction page: Payee (editable), Amount, *"Expecting
a refund? Track it here"*, Account, Date, Category, **Tags**, **Split**, **Transaction Status**
(Pending/Cleared), **Set flag**, **Reviewed** toggle, **Mark as a bill or recurring**, **Exclude from:
Spending Plan / Reports** (each with its own one-line explanation of which calculations it affects),
**Notes**, **Attach a file** for receipts, a provenance line — *"Appears on your <account> statement as
ADOBE \*XXX-XXX-6687 on Jul 23, 2026"* — **Delete**, and on desktop a **Create Rule** button.

**Categories.** A searchable, three-level hierarchy (Auto & Transport → Registration → Registration Fees)
and a **Create Category** form with **Subcategory of**, an **Expense/Income** type toggle, and a **Tax
Related** toggle that feeds a Tax Report.

---

## 2. The parity matrix

| # | Simplifi capability | Aimplifi today | Tracked as |
|---|---|---|---|
| 1 | Rule with a **user-typed match key** and an operator (`contains`), keywords as editable chips | **SHIPPED 2026-07-29 (O.13a)** at `/rules`, with a match-count preview before saving. *As authored, this row read MISSING:* `CategorizationRule` keyed only on `merchantId` + amount/day/account conditions, so the key was always DERIVED (the normalizer's canonical or the learner's signature) and the only authoring gesture was "Always" after filing one row. | **O.13a** |
| 2 | Rule **then-actions** beyond category (rename payee, tags, note, exclude, mark reviewed) | **PARTIAL.** A rule sets the category (O.13a), renames the payee (O.13c), and — since **2026-07-30 (O.15 slice 6)** — **tags the row for taxes**, which is where DECISIONS #345(c) re-routed Simplifi's per-CATEGORY "Tax Related" flag: `categoryId` has six independent writers, so a per-category flag would be fenced at six call sites, while the rule is one fenced path with a counted, previewed apply-to-existing. A rule tags only rows it FILES, never one the reader tagged, hand-filed or excluded from totals. *As authored this row read MISSING.* Still absent: tags (O.11d), note, exclude-from (as a rule ACTION — the per-row flag shipped in slice 2), mark reviewed. | O.13a (category), O.13c (rename), **O.15 slice 6 (tax tag)**, O.11d (tags), O.11a (exclude) |
| 3 | Rule **list / edit / delete**, and "handle existing transactions next" with a count | **PARTIAL (O.13a).** A typed rule can be listed, previewed with a count, applied to history and deleted. Still missing: **edit**, and the list shows only TYPED rules — a merchant "Always" rule and a learned rule remain invisible and undeletable, while a typed rule silently outranks both. So the page heading "Your rules" is narrower than it sounds. | **O.13d** |
| 4 | **Transaction detail** view | **SHIPPED 2026-07-30 (O.13b).** `/transactions/[id]`, reached by a `Details` link on every register row: payee, amount, account, date, status, category, note, tax control, provenance badge, the statement provenance line, split, and the rule lever. *As authored this row read MISSING.* Still absent from it, each its own matrix row: payee edit (5), tags (7), user-set reviewed (9), attachments (14). **Since shipped onto this page: exclude-from (8, O.15 slice 2), mark-as-recurring (O.15 slice 4), a rule tax action (O.15 slice 6) and manual status (13, O.15 slice 7)** — the list is trimmed as each lands, because a "still absent" enumeration is a claim like any other. | **O.13b** |
| 5 | **Payee rename** (display name ≠ statement text) | **MISSING.** `Merchant` (`schema:367`) has no display name. Accounts have one (`Account.displayName`, L.7); merchants do not. | **O.13c** |
| 6 | Category **hierarchy** (3 levels), **Expense/Income** type, **Tax Related** flag | **PARTIAL — and split into three verdicts on 2026-07-30 (DECISIONS #345), each measured against the code.** Custom categories exist with a parent group and a discretionary flag (`custom-category-manager.tsx`). **Hierarchy: deliberately REFUSED** — `Category.parentId` has zero readers/writers, so nothing is half-built, and Simplifi's third level is representable as a leaf under a group. **Type: a REAL gap, deferred with cause** — income is inferred from the group NAME in **14 separate places** (only 2 via the shared predicate), across two different maps, held consistent only by the rule that a custom may not join the Income group; lifting it makes `pipeline.ts`'s sign guards admit an outflow into an income category, which reports/trends/budgets then drop while `monthlyFlows` counts it. **Tax flag: a REAL gap, re-routed to row 2 and SHIPPED there 2026-07-30 (O.15 slice 6)** — the semantics are a write-time stamp, and there is no single category-write choke point to stamp at, so it went onto the rule then-action machinery that already has a counted apply-to-existing. | **O.13e** |
| 7 | **Tags** (many per row, filterable) | **MISSING.** No column, no join table. | O.11d |
| 8 | **Exclude from** budgets / reports, per row | **MISSING.** | O.11a |
| 9 | **Reviewed** flag the user sets | **MISSING** as a user-set flag. `needsReview` and `reviewPinned` are the app's own queue state. | O.11a |
| 10 | **Notes** per row | **HAVE.** `Transaction.note` (`schema:349`), editable in the register. | — |
| 11 | **Split** a transaction | **HAVE, as of 2026-07-30 (O.13b).** The engine, action and two-part gesture have existed since Phase 3c; what was missing was a door for an already-filed row, and the detail view is it (same `splitTransaction`, plus Undo on the container). *As authored this row read PARTIAL.* | O.13b |
| 12 | Mark one row as a **bill / recurring** | **SHIPPED 2026-07-30 (O.15 slice 4).** A `Recurring` section on `/transactions/[id]` (reached from the one action menu on any register row) declares a payee recurring at a rhythm the reader picks, from as little as ONE charge; `/recurring` carries the demotion ("Not recurring") on the row where a false detection is visible, plus a **What you've told Aimplifi** list with an undo for each instruction. Applied inside `detectRecurring` itself, so all five detecting surfaces honour it at once, and the write rebuilds the stored projections so the cash surfaces move in the same gesture. *As authored this row read PARTIAL.* | **O.13f** |
| 13 | **Pending / Cleared** editable by the user | **SHIPPED 2026-07-31 (O.15 slice 7, DECISIONS #347)** — with a deliberately narrower scope than Simplifi's, stated rather than silent. The reader may mark a transaction cleared or pending on `/transactions/[id]`; the register's menu item navigates there rather than writing in place, because the action hides the row from the tax export and five other surfaces and that sentence lives beside the control. Refused, each disabled-with-reason: a row a FEED delivered (the bank is the authority on whether its own charge cleared), a split PIECE (its status belongs to the charge, and both providers rewrite pieces from the parent), a split CONTAINER (inert in every sum), and MONEY IN (the pending sum is signed, so a pending deposit adds to today's cash — a typed "expected paycheck" would cancel the dashboard's transfer instruction). *As authored this row read MISSING.* | **O.13g** |
| 14 | **Attach a receipt / file** | **MISSING.** No column, no upload, no storage. NOTE: Wave O.11's header lists "receipts" among shipped features — that refers to the `ValueReceipt` ledger (`schema:677`, proactive-catch receipts from TASKS 1.3), a different feature. Attachments do not exist. | **O.13h** |
| 15 | **Track a refund** (link an outflow to an expected inflow) | **ALREADY SHIPPED — this row was STALE as authored, corrected 2026-07-31 (O.15 slice 7).** Simplifi words it *"Expecting a refund? Track it here"*, and O.15 slice 2 built exactly that under another name: `Transaction.reimbursement` ('awaiting' | 'received'), an outstanding **"Money you're owed back"** line on /coach, and `findOffsettingInflow` proposing the matching deposit (exact opposite magnitude, POSTED, within 90 days, earliest-then-id) — deliberately a display-time suggestion, never a stored link. The remaining gap is vocabulary, not capability: a reader hunting for "refund" meets the word "reimbursement". | O.13g (naming only) |
| 16 | Statement **provenance line** on the row ("appears as … on …") | **MISSING, and now load-bearing.** The raw bank text is rendered in exactly two places — the triage inbox and the rule builder's own preview — and NOT in the register, which shows the app's cleaned-up name instead. So a reader matching a rule against "the bank's text" has no surface showing it for an already-filed row, and O.13's brand work widened the gap (`MACYS LENOX SQUARE` now displays as `Macy's`, which never matches as typed). Mitigated in O.13a — a zero-match preview lists his real recent descriptors to copy from — and **CLOSED 2026-07-30 (O.13b)**: the detail view renders the line verbatim (*"Appears on your … statement as `<rawDescriptor>` on …"*), so the string a rule matches against is finally on a screen reachable from any filed row. | **O.13b** |

### 2a. One correction to the owner's example, measured before it was built on

`tjmaxx 0181 0966` and `TJMAXX 0499 1122` **both already normalize to the known merchant `Tjmaxx` and
auto-file as clothing with no review** in Aimplifi today (executed against the shipped normalizer +
pipeline, 2026-07-29). His headline example is therefore a capability gap, not a live defect — and saying
so is the difference between a plan and a guess.

The live defect is two rows down his own dashboard screenshot. **`Tst*mirko Pasta Buckhead` normalizes to
`Mirko Pasta Buckhead` and auto-files as dining, while `MIRKO PASTA` normalizes to `Mirko Pasta` and lands
in review as uncategorized** — one restaurant, two canonicals, two categories, two review states,
depending on which descriptor the bank happens to send. No DERIVED key can span that pair: the merchant
canonical differs by construction and the descriptor signature differs too. One typed keyword (`mirko`)
spans it exactly. That pair is now the locking test for O.13a
(`tests/unit/keyword-rule.test.ts`, "the class no DERIVED key can fix"), and it is the mechanism behind
the owner's older report that the app "doesn't recognize that the others are the same" (Wave O.9).

> **Status note, 2026-07-29:** row 1 shipped the same day this matrix was written and row 3 became
> partial, so the "ten of sixteen" count below is as-authored. A critic caught this doc falsifying itself
> within hours of being committed — the plan-verdicts-are-authoring-time lesson, applied to its own author.

**The through-line.** Ten of sixteen were missing outright when this was written, and they are not sixteen unrelated features:
Simplifi gives the reader a **place to stand on one transaction** (the detail view) and **an editable
instruction the app then executes** (the rule). Aimplifi has invested in inference — a normalizer, a
learner, a proposal engine, a provider-guess tier — and given the reader almost no lever. When the
inference is wrong the owner's only recourse is to re-file the row again, which is precisely the
"trailing categorization" complaint of Wave O.12.

---

## 3. Beyond parity — where "smarter" is planned

Parity is the floor; the differentiator work is already specified and must not be re-invented here:

- `docs/COACH_PRINCIPLES_PLAN.md` — the personal-finance-canon principles the coaching layer encodes.
- `docs/NUDGE_PLAN.md` — the proactive nudge feed (with the cadence-adaptation slice TASKS 3.5 merged in).
- `docs/AI_DIFFERENTIATION_PLAN.md` — the AI layer's differentiation.
- `docs/COMPETITIVE_GAP_PLAN.md` — the standing gap plan and model-routing policy.
- `docs/MONEY_REVIEW_PLAN.md`, `docs/WHY_THIS_CATEGORY_PLAN.md`, `docs/GLASSBOX_PLAN.md` — explainability.

What the owner named specifically that is NOT yet a task row anywhere: **"finding ways to cut unnecessary
spending"** as a first-class, recurring output — not a nudge that fires when a price rises, but a standing
answer to "what should I cut, and what happens if I do". Cutting is a decision with a counterfactual, so
it needs the projection engines the app already has (radar, spending plan, FI) pointed at a *proposed
change* rather than at the status quo. Opened as **Wave P** in `TASKS.md`; it is deliberately NOT
scoped inside the parity wave, because a cut recommendation is a money instruction and carries the full
critic gate, while a rule builder is a control surface.

---

## 4. The ordering decision, and why

1. **O.13a keyword rules** first — the owner asked for it by name, it is the mechanism behind the
   recurring pain, and it is the smallest change that ends a class of re-filing forever.
2. **O.13b transaction detail** second — the acute complaint, and the surface every remaining row needs
   (split, status, exclude, tags, reviewed, provenance, "create rule from this row" pre-filled).
3. **O.13d rule management** third — an authored rule the reader cannot see or delete is worse than no
   rule, because it files money silently and it accumulates.
4. Everything else in the matrix follows, with O.11a-d interleaved (they share the same detail surface).

The failure direction that governs the whole wave: a rule the reader typed executes without asking again,
so every ambiguity resolves toward matching too LITTLE (the row stays in review, visible) rather than too
much (a silent mis-file). Preview counts before saving, never after.
