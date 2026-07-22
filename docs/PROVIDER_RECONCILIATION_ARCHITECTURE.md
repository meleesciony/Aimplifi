# Cross-provider account reconciliation — architecture decision

Status: **DESIGN (spec only, not built)** · Opened 2026-07-22 (owner question:
"how do we reconcile the account data pulled from SimpleFIN Bridge — no longer
connected — with the new Plaid pull when it's available"). Money-aggregation +
cross-provider-identity work ⇒ **Fable-lane build + hostile critic** per TASKS
routing. This doc is the decision + schema design; the build follows the slice
plan in §9, engine-first, each slice verify-green.

---

## 1. The problem, verified against the code

Every claim here was read from the current tree this session (file:line given), not
assumed.

1. **No cross-provider account identity.** `Account` (`prisma/schema.prisma:146-175`)
   has `provider` (runtime values `demo` / `plaid` / `simplefin` / `manual`),
   `providerRef` (each provider's own opaque id), `mask` (last-4), and `plaidItemId`
   (Plaid-only). There is **no institution-id column and no unique constraint** across
   `(userId, provider, providerRef)` or any external identity — nothing ties two
   providers' rows for the same real account together, and nothing stops duplicate
   rows.

2. **Disconnect keeps the data, frozen.** `disconnectSimplefin`
   (`src/server/simplefin-actions.ts:84-94`) deletes only the `SimpleFinConnection`
   credential row. The `Account` rows and all their transactions/statements/history
   are **left intact** — not deleted, not soft-deleted, not flagged. `Account` has no
   `status` / `disconnectedAt` / `lastSyncedAt` / `isActive` / `createdAt` column;
   freshness lives only on the *connection* rows (`SimpleFinConnection.lastSyncedAt`,
   `PlaidItem.lastSyncedAt`). A disconnected account simply stops being synced and
   keeps counting at its last balance.

3. **Net worth sums every row.** The shared assembler
   (`src/lib/providers/demo.ts:42`, used by all providers incl. Plaid via
   `plaid.ts:856`) does `prisma.account.findMany({ where: { userId } })` with **no
   provider or staleness filter**; the only exclusion is non-USD currency
   (`demo.ts:60`). Net-worth summation (`src/lib/engine/networth/series.ts:38-40`)
   adds every account. So a stale SimpleFIN balance and a live Plaid balance for the
   same account **both count** — the balance doubles.

4. **Transaction dedup is per account row.** `Transaction` has
   `@@unique([accountId, providerRef])` (`prisma/schema.prisma:275`). `accountId` is a
   specific row's surrogate id and `providerRef` is one provider's id scheme, so the
   same real transaction pulled by a SimpleFIN row **and** a Plaid row becomes two
   rows that both count in spending, cash-needed, and every sum. There is **no**
   cross-account or cross-provider transaction dedup anywhere in the tree.

5. **The only safeguard is advisory.** `src/lib/engine/account/duplicates.ts` (task
   1.8 / #192) is a pure, display-only detector: cross-provider pairs of the same
   `type` + normalized `currency` with at least one of `mask` equal (high),
   non-zero `currentBalanceCents` equal (high), or a shared distinctive name token
   (medium). It is surfaced as the `duplicate-accounts-warning` card
   (`src/components/finance/accounts-list.tsx:349-358`) and, per its own docstring,
   **"never deletes or merges anything — the fix (disconnect one side) stays the
   user's explicit choice."**

6. **No merge / relink / migration exists.** Searches for
   `merge|relink|reconnect|migrateAccount|moveTransaction|reassign` found nothing that
   re-points transactions between accounts or moves an account between providers. The
   only current "fix" is the user manually deleting one side via
   `deleteDisconnectedSyncedAccountFor` (`src/server/account-delete.ts:68-120`), which
   **cascades and deletes that account's entire transaction history**, along with any
   manual categorizations / splits / corrections on those rows.

**Net effect today:** connecting Plaid on top of the old SimpleFIN accounts
double-counts both balances and overlapping transactions, and the only resolution
available (delete the stale side) discards its pre-Plaid history and the user's
hand-tuning of it.

---

## 2. Design principles this must obey

Inherited from `CLAUDE.md` / `LOOP_ENGINEERING.md` / the audit §4 constitution:

- **Money integrity is sacred.** The invariant is *exactly one contribution per
  real-world account, per date, across a linked pair* — never a double-count, never a
  fabricated or dropped figure. Integer cents throughout; calendar dates via the one
  tested date module.
- **Never auto-delete or auto-mutate money data.** The #192 precedent is deliberate:
  detect and advise, act only on explicit user confirmation.
- **Additive schema, demo/golden byte-identical.** No destructive column changes; the
  seeded demo dataset must render identically (demo accounts are excluded from
  reconciliation by construction — see §7).
- **Reversible and user-visible.** Every adaptation is undoable and disclosed inline.
- **One central scope point.** Like `visibleAccountsWhere` for household, the boundary
  is applied once in the shared assembler so every downstream engine inherits it
  unchanged.

---

## 3. The chosen design: a linked pair with a date boundary (no mutation)

**Decision.** Do **not** re-point transactions or swap a row's provider (both are
destructive and hard to reverse). Instead, keep **both** `Account` rows and add a
**link** that assigns each a role and a single **cutover date**:

- **Predecessor** = the disconnected/stale row (e.g. SimpleFIN). It becomes
  *historical*: its **balance stops counting** toward net worth, and it contributes
  **only its transactions on/before the cutover date**.
- **Successor** = the live row (e.g. Plaid). It is *active*: its **live balance
  counts**, and it contributes **only its transactions after the cutover date**.

Because there is one clean date line, each real transaction date is owned by exactly
one side — so **no fuzzy cross-provider transaction matching is ever needed**, which is
precisely where a money-integrity bug would otherwise hide. Nothing is deleted or
moved, so the operation is **fully reversible**: drop the link and both rows count
exactly as they do today.

This blends the two options discussed with the owner — the *date-boundary archive*
(safety: no overlap to dedup, history retained) and *adopt-and-continue* (continuity:
the pair reads as one logical account in the UI) — while avoiding the destructive
re-pointing that adopt-onto-one-row would require.

### What the user sees
One logical account: pre-cutover history and corrections from the predecessor, live
balance and post-cutover activity from Plaid, a single net-worth contribution. The
balance shown is **always the successor's live figure, never a sum**.

---

## 4. Schema additions (additive only)

One new table; **no changes to `Account` columns** (only a back-relation on `User`).

```prisma
/// Cross-provider account reconciliation (docs/PROVIDER_RECONCILIATION_ARCHITECTURE.md).
/// Links a disconnected/stale account (predecessor, e.g. SimpleFIN) to the live account
/// that now represents the SAME real-world account (successor, e.g. Plaid), so the pair
/// reads as ONE logical account and never double-counts. Absence of a row = today's
/// behavior (both rows count fully). Always user-confirmed; reversible via undoneAt.
model AccountReconciliation {
  id                   String    @id @default(cuid())
  userId               String
  predecessorAccountId String    @unique // owns transactions with date <= cutoverDate; balance excluded
  successorAccountId   String            // owns transactions with date > cutoverDate; live balance counts
  cutoverDate          String            // YYYY-MM-DD calendar date (single tested date module)
  matchSignal          String            // 'mask' | 'balance' | 'name' — the #192 signal that proposed it
  confidence           String            // 'high' | 'medium'
  confirmedByUserAt    DateTime          // never automatic — set only on explicit user confirm
  undoneAt             DateTime?         // reversible; when set the link is inert and both sides count fully

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([successorAccountId])
}
```

Plus, on `User`: `accountReconciliations AccountReconciliation[]` (back-relation).

Notes:
- `predecessorAccountId @unique` ⇒ one supersession per predecessor row.
- `successorAccountId` intentionally **not** unique: one live account may supersede
  more than one old row (e.g. the user had the same account connected twice before).
- No FK relation to `Account` is declared (Account ids are validated in the server
  action, and a hard FK would complicate the cascade already on `Account.onDelete`);
  ids are resolved and authz-checked inside the mutation. Deleting either underlying
  account (still possible) leaves an inert link the assembler ignores — see R7.

---

## 5. The aggregation invariant (the money core — Fable-critic surface)

Applied **once**, in the shared assembler (`demo.ts` `getFinanceSnapshot`, which every
provider delegates to), so spending, cash-needed, radar, digest, trends, and the
net-worth series all inherit it with no per-engine change:

1. Load the user's accounts **and** their **active** reconciliations
   (`undoneAt == null`). Build two maps: predecessor→cutover and the set of successor
   ids.
2. **Balance / net worth:** a predecessor in an active reconciliation contributes
   **0**. The successor contributes its full live balance. Every other account is
   unchanged. ⇒ exactly one balance per real account.
3. **Transactions:** the predecessor is authoritative exactly over its own covered
   span. It keeps rows with `date <= cutoverDate`; the successor keeps rows OUTSIDE
   the predecessor's claim `[predecessor's first txn date, min(cutoverDate,
   predecessor's last txn date)]`. All other accounts unchanged. ⇒ inside the claim
   exactly one side owns each date (no overlap); outside it the successor's deeper
   backfill (Plaid reaches years further back than a 90-day SimpleFIN window) is
   never dropped, and a cutover past the predecessor's last data claims nothing
   extra. *(As built — the original "successor keeps only `date > cutover`" draft
   dropped the successor's pre-predecessor backfill; slice-3 critic cycle 1, F2/F4.)*
4. **Balance snapshots:** snapshots are STOCKS, not flows — a lone observation is a
   correct single contribution. A row is dropped only on an EXACT-date collision
   with the linked counterpart; the cutover picks the winner (predecessor on/before,
   successor after). Never a fabricated dip where only one side has data (F3).
5. **Funding account:** a `paymentAccountId` pointing at a predecessor is remapped to
   its successor (chains follow to the terminal live side), and the snapshot carries
   `supersededAccountIds` so FALLBACK funding resolution (`resolvePaymentAccount`,
   the forecast anchor) never picks a zeroed predecessor (F1).

**The boundary rule at the cutover is half-open** — the cutover date itself belongs
to the predecessor and is never double-owned. This is the single most important line
to test at the exact boundary date (R1).

---

## 6. Cutover date rule

Default `cutoverDate` = **the predecessor's last posted-transaction date**. Rationale:
the predecessor is disconnected, so all its data is historical and complete up to that
day; making it the boundary retains the *entire* SimpleFIN history and hands everything
after it to Plaid (whose backfill covers that window and beyond). The user may adjust
the date in the confirm step (bounded: not in the future; not before the predecessor's
first transaction).

**Residual risk (documented, for the critic + EDGE_CASES):** a single real purchase can
straddle the boundary if the two providers date it differently — e.g. SimpleFIN carried
it *pending* on date D and Plaid posts it on D+1. With the half-open rule it would count
once on each side only if D ≤ cutover < D+1, i.e. the purchase's predecessor-date is the
cutover day and its successor-date is after — a one-day window. Mitigation options to
decide in the build: (a) accept and disclose the ≤1-day reconciliation window inline;
(b) suppress successor transactions whose `(amount, merchant)` exactly matches a
predecessor transaction within ±3 days of the cutover — a *narrow, boundary-local* dedup,
not a general fuzzy match. Prefer (a) unless the critic shows a realistic double-count;
never a general cross-provider fuzzy dedup (§3 rationale).

---

## 7. Interaction with existing systems

- **#192 duplicate detector.** Once a pair has an active reconciliation, the advisory
  `duplicate-accounts-warning` must **stop firing for that pair** (it is resolved) —
  the detector consults active reconciliations and suppresses matched pairs. If the
  link is undone, the warning reappears (R6).
- **Cash-needed / cards.** Card config (`dueDayOfMonth`, `cycleCloseDayOfMonth`,
  `aprBps`) and `Statement` rows live on the Account. For a reconciled **credit card**,
  cash-needed must read the **successor** row's config and statements (the live source);
  the predecessor's pre-cutover statements are historical only. R4 locks this.
- **Household.** `sharedToHousehold` is per-row. The linked pair's household visibility
  must follow the **successor** so a partner sees the live account once, not the stale
  duplicate. R5.
- **Demo / golden.** Demo accounts are excluded from the #192 detector
  (`EXCLUDED_PROVIDERS`) and therefore never proposed for reconciliation; the migration
  adds an empty table. The seeded dataset renders **byte-identical** (R8, deep-equality
  golden test).
- **Account deletion.** Still allowed. Deleting a predecessor or successor leaves an
  inert link; the assembler ignores links whose referenced accounts are missing (R7).

---

## 8. The flow (never automatic, always confirmed)

1. Plaid connects and upserts its own rows (unchanged).
2. The #192 detector finds a cross-provider match.
3. **Direction rule:** offer the continue-flow **only when exactly one side has a live
   provider connection** — the connected side is the *successor*, the disconnected side
   the *predecessor*. If *both* are connected, this is a genuine active duplicate: keep
   the passive warning, do **not** offer to link (R3).
4. Present: *"This looks like the same account (Chase Checking ••1234) you had before.
   Continue it with Plaid? We'll keep your old history and stop the old balance from
   double-counting."* — with the match reason (`matchSignal`/`confidence`) shown and the
   cutover date editable.
5. On confirm: create the `AccountReconciliation` (server action, authz-checked, both
   account ids re-resolved inside the mutation, TOCTOU-closed like #219).
6. `/accounts` shows the pair as one logical account with an inline disclosure and an
   **Undo** (sets `undoneAt`; reversible, and the advisory warning returns).

---

## 9. Invariants → locking tests

Every invariant below ships with a named test in its build slice (fail-old proven).

- **R1 — boundary integrity.** At `date == cutoverDate` the predecessor owns the row and
  the successor does not; sum of the pair's transactions over all dates = predecessor(≤)
  ⊍ successor(>) with no overlap and no gap. Known-answer fixture at the exact boundary.
- **R2 — single balance.** Net worth of a reconciled pair = successor's balance only;
  predecessor contributes 0. (Pre-fix: sum of both.)
- **R3 — direction / both-live guard.** Two *live* providers for one real account are
  never auto-linked; the advisory warning still fires.
- **R4 — reconciled card.** Cash-needed for a reconciled credit card uses the successor's
  statements/config; the predecessor's pre-cutover statements never inflate the due total.
- **R5 — household follows successor.** A shared reconciled account appears once (the
  successor) in the household view; the predecessor is not separately shared.
- **R6 — advisory suppression + return.** An active link suppresses the #192 warning for
  that pair; undo restores it.
- **R7 — inert-on-delete.** Deleting either underlying account leaves the assembler's
  output well-defined (the surviving side counts normally; no crash, no phantom).
- **R8 — demo golden.** With no reconciliations, every engine output is byte-identical to
  today (deep-equality); demo accounts are never proposed.
- **R9 — reversible.** `undoneAt` set ⇒ both rows count exactly as pre-link (net worth,
  transactions, warning) — the full round-trip.
- **R10 — authz.** A user can only reconcile their own accounts; ids are re-resolved and
  ownership re-checked inside the mutation.

---

## 10. Slice plan (engine-first; Fable critic on the money slices)

1. **Detector direction + candidate engine** (pure): extend the #192 output to identify
   predecessor/successor by live-connection state and emit a reconciliation *candidate*.
   Tests R3. — Opus, no money mutation yet.
2. **Schema + server action** (`AccountReconciliation`, confirm/undo, authz, TOCTOU):
   additive migration, Prisma-only server module. Tests R7, R9, R10. — Opus.
3. **The assembler boundary** — balance exclusion + transaction date split in
   `getFinanceSnapshot`. The money core. Tests R1, R2, R8. — **Fable build + hostile
   critic.**
4. **Cash-needed cards + household follow-through + scheduled rows.** Tests R4, R5.
   Scheduled rows explicitly belong here (slice-3 critic F6): once the funding
   account remaps to the successor, the predecessor's `ScheduledTransaction` rows
   fall out of the forecast/radar account filters — decide re-key vs re-detect with
   the cash-needed critic, in the same slice as the statement/autopay boundary. —
   **Fable critic** (cash-needed is money; household is a visibility boundary).
5. **UI: continue-flow + one-logical-account rendering + advisory suppression + undo.**
   Tests R6 + an e2e that seeds a SimpleFIN account, disconnects, "connects" a Plaid
   twin, links them, and asserts net worth stops doubling. **Scope is EVERY
   per-account money surface, in the SAME deploy as the link-creation UI** (slice-3
   critic F5): once a link exists, the dashboard accounts list and the assistant's
   account-balance answer show the predecessor at $0.00, and `/accounts` +
   `getAccountsView` (Prisma-direct, NOT snapshot-fed) still show the stale balance
   and a contradicting net-worth trend. Safe today ONLY because no UI can create a
   link yet — that invariant must hold until this slice closes all four surfaces.
   For a MANUAL/sparse predecessor, the confirm step must disclose inline what the
   claim span will supersede (slice-3 critic F10): inside `[first txn, cutover]`
   the old account's records replace the new provider's backfill.
   — Opus (+ Cursor/Grok polish).
6. **Full-surface hostile critic** over R1–R10 with the residual §6 boundary-straddle as
   the lead adversarial target. — **Fable.**

---

## 11. Open question for the owner (non-blocking)

The §6 boundary-straddle mitigation (accept-and-disclose a ≤1-day window vs. a narrow
boundary-local amount/merchant dedup) is a small money-honesty tradeoff. The build will
pick the safer option the critic supports and record it; flagging here only so the owner
knows it exists. Nothing else in this design needs owner input — it follows from the
stated request and the existing constitution.
