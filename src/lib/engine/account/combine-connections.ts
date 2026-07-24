/**
 * "These two connections are pulling the same account" — the remedy for a BOTH-LIVE duplicate
 * (docs/ACCOUNT_IDENTITY_ARCHITECTURE.md §4 layer 3; TASKS L.6 / L.10).
 *
 * Owner-reported 2026-07-24 with screenshots: two Plaid connections at Chase, each pulling
 * `CREDIT CARD ····0977`, so one real card counts twice in Liabilities, twice in the
 * cash-needed headline, and every one of its transactions is stored twice. Until now the app's
 * only answer was an advisory note — and the shipped Combine flow refuses a both-live pair by
 * design (R3: a reconciliation needs one stale side), so there was no path at all.
 *
 * This engine plans that path. It is the ITEM (connection) level on purpose, because the only
 * way to make one side stale is to disconnect a Plaid connection, and a connection can carry
 * more than one account. So the unit of the decision is "drop this connection, keep that one",
 * and a direction is offered only when dropping strands nothing:
 *
 *   **every account under the dropped connection is proven the same real account as exactly one
 *   account under the kept connection** (the ladder in `identity.ts` — last-4 + kind + currency
 *   at one bank, or Plaid's persistent id; never a balance, never a name).
 *
 * If the dropped side carries anything that is NOT a proven duplicate, that direction is not
 * offered: disconnecting would silently freeze a real account, which is the same class of harm
 * as double-counting one (a wrong figure the user was never told about). The other direction is
 * usually still offerable, and when neither is, the pair stays with the advisory layer.
 *
 * Planning only — this module mutates nothing and decides nothing on the user's behalf. The
 * caller re-derives the plan server-side before acting, and the user picks the direction.
 *
 * Pure: no React, no DB, no `new Date()`, no model calls. Deterministic output ordering.
 */

import { compareAccountIdentity, type IdentityAccount, type IdentityTier } from '@/lib/engine/account/identity';

/** One live Plaid connection. A disconnected item's row is deleted, so every row here is live. */
export interface CombineConnectionItem {
  readonly itemId: string;
  readonly institutionId: string | null;
  readonly institutionName: string | null;
  /** YYYY-MM-DD of the last SUCCESSFUL sync, or null if it has never completed one. */
  readonly lastSyncedAt: string | null;
  /** Sanitized failure reason from the last attempt; null = healthy. */
  readonly lastSyncError: string | null;
  /** Stable ascending key for "which connection came first" (an ISO timestamp). */
  readonly linkedAtKey: string;
}

/** One account row, with the identity fields and the connection it arrived through.
 *  `connectionId` is derived from `plaidItemId` rather than carried twice — one field, so the
 *  two can never disagree about which connection a row came through. */
export interface CombineConnectionAccount extends Omit<IdentityAccount, 'connectionId'> {
  readonly id: string;
  readonly name: string;
  readonly plaidItemId: string | null;
}

function identityOf(a: CombineConnectionAccount): IdentityAccount {
  return { ...a, connectionId: a.plaidItemId };
}

/** How a stranded account is named in the copy. The last-4 is part of the name here for the same
 *  reason it is on /cards (#298): the owner holds three cards all called `CREDIT CARD`, and a
 *  sentence listing "CREDIT CARD and CREDIT CARD" names nothing (critic P1-3). */
function strandedLabel(a: CombineConnectionAccount): string {
  return a.mask ? `${a.name} ····${a.mask}` : a.name;
}

/** One proven same-account pair inside a direction: the dropped row → the kept row. */
export interface CombineAccountPair {
  /** The row under the DROPPED connection. It becomes historical (balance stops counting). */
  readonly predecessorAccountId: string;
  readonly predecessorName: string;
  /** The row under the KEPT connection. It keeps updating and carries the balance. */
  readonly successorAccountId: string;
  readonly successorName: string;
  readonly mask: string | null;
  readonly tier: IdentityTier;
  readonly reasons: readonly string[];
}

export interface CombineDirection {
  readonly keepItemId: string;
  readonly dropItemId: string;
  /** True when every account under `dropItemId` is a proven duplicate of one under `keepItemId`. */
  readonly offerable: boolean;
  /** Accounts under the dropped connection this combine would NOT resolve — the reason it is
   *  not offerable. Named so the UI can say exactly what would be frozen. */
  readonly strandedAccountNames: readonly string[];
  readonly pairs: readonly CombineAccountPair[];
}

export interface CombineConnectionsProposal {
  /** How the two connections' bank reads on screen, when known ("Chase"). */
  readonly institutionLabel: string | null;
  /** The direction to present first: drop the less healthy connection. Always offerable. */
  readonly recommended: CombineDirection;
  /** The same pair the other way round, when that direction is also offerable — so the user can
   *  choose which connection survives. Null when only one direction is safe. */
  readonly alternative: CombineDirection | null;
  /** When `alternative` is null: the accounts that made the other direction unsafe. Carried so
   *  the UI can say WHY only one choice is offered instead of silently offering one — a control
   *  that quietly isn't there reads as an app that didn't consider it. */
  readonly alternativeBlockedNames: readonly string[];
}

/** Accounts under one connection, in a stable order. */
function accountsOf(accounts: readonly CombineConnectionAccount[], itemId: string): CombineConnectionAccount[] {
  return accounts
    .filter((a) => a.provider === 'plaid' && a.plaidItemId === itemId)
    .sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
}

/**
 * Plan one direction. Offerable only when every dropped-side account maps 1:1 onto a kept-side
 * account the ladder proves is the same. A kept-side row is claimed at most once: two dropped
 * rows collapsing onto one kept row would mean two reconciliation links racing for the same
 * successor, and the app cannot prove which is which — that is stranded, not resolved.
 */
function planDirection(
  keep: CombineConnectionItem,
  drop: CombineConnectionItem,
  accounts: readonly CombineConnectionAccount[],
): CombineDirection {
  const keepAccounts = accountsOf(accounts, keep.itemId);
  const dropAccounts = accountsOf(accounts, drop.itemId);
  const claimed = new Set<string>();
  const pairs: CombineAccountPair[] = [];
  const stranded: string[] = [];

  for (const d of dropAccounts) {
    // EXACTLY one, never the first of several. Two rows on the kept side that both "prove" they
    // are this row means the ladder has proven nothing about either — picking one by name order
    // would silently discard a real account (critic P2-4, executed against three same-last-4
    // cards). An ambiguous row is stranded, which is what refuses the direction.
    const matches = keepAccounts.filter(
      (k) => !claimed.has(k.id) && compareAccountIdentity(identityOf(d), identityOf(k)).verdict === 'same',
    );
    if (matches.length !== 1) {
      stranded.push(strandedLabel(d));
      continue;
    }
    const match = matches[0];
    claimed.add(match.id);
    const verdict = compareAccountIdentity(identityOf(d), identityOf(match));
    pairs.push({
      predecessorAccountId: d.id,
      predecessorName: d.name,
      successorAccountId: match.id,
      successorName: match.name,
      mask: d.mask ?? match.mask,
      tier: verdict.tier ?? 'A',
      reasons: verdict.reasons,
    });
  }

  return {
    keepItemId: keep.itemId,
    dropItemId: drop.itemId,
    // An empty connection (no rows yet) resolves nothing, so it is not a combine — the user
    // disconnects it if they want it gone. Requiring a pair keeps this action about duplicates.
    offerable: stranded.length === 0 && pairs.length > 0,
    strandedAccountNames: stranded,
    pairs,
  };
}

/** Two connections are comparable only when they are known to be at the same bank. */
function sameInstitution(a: CombineConnectionItem, b: CombineConnectionItem): boolean {
  const idA = (a.institutionId ?? '').trim();
  const idB = (b.institutionId ?? '').trim();
  if (idA && idB) return idA === idB;
  const nameA = (a.institutionName ?? '').trim().toLowerCase();
  const nameB = (b.institutionName ?? '').trim().toLowerCase();
  return nameA.length > 0 && nameA === nameB;
}

/**
 * Which connection should SURVIVE, when both directions are safe. Ordered, first difference wins:
 *
 *   1. A connection with no sync error beats one carrying an error — the broken one is what the
 *      user was trying to fix when they created the second copy.
 *   2. The more recently synced connection beats a staler one (never synced = worst).
 *   3. The connection that was linked FIRST beats a newer one. This is a tie-break, not a claim
 *      about which feed is deeper: nothing here measures the two transaction histories (a critic
 *      correctly called out an earlier comment for asserting it did). What protects the history
 *      is the caller's no-loss check, which refuses ANY direction whose date split would drop a
 *      charge the other side does not also hold — so a wrong guess here costs a refusal, never a
 *      row. Note that rules 1–2 tie for two healthy daily-syncing connections, because
 *      `lastSyncedAt` is a calendar DAY, so in the common case this rule is the one that decides.
 *   4. `itemId` order, so the result is deterministic rather than input-ordered.
 *
 * Returns a negative number when `a` should be kept.
 */
function keepRank(a: CombineConnectionItem, b: CombineConnectionItem): number {
  const errA = a.lastSyncError ? 1 : 0;
  const errB = b.lastSyncError ? 1 : 0;
  if (errA !== errB) return errA - errB;
  const syncA = a.lastSyncedAt ?? '';
  const syncB = b.lastSyncedAt ?? '';
  if (syncA !== syncB) return syncA < syncB ? 1 : -1;
  if (a.linkedAtKey !== b.linkedAtKey) return a.linkedAtKey < b.linkedAtKey ? -1 : 1;
  return a.itemId.localeCompare(b.itemId);
}

/**
 * Every pair of live connections at one bank that a combine would resolve, most-actionable first.
 * Empty for the overwhelmingly common case of one connection per bank.
 */
export function planCombinableConnections(
  items: readonly CombineConnectionItem[],
  accounts: readonly CombineConnectionAccount[],
): CombineConnectionsProposal[] {
  const sorted = [...items].sort((x, y) => x.linkedAtKey.localeCompare(y.linkedAtKey) || x.itemId.localeCompare(y.itemId));
  const out: CombineConnectionsProposal[] = [];

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const first = sorted[i];
      const second = sorted[j];
      if (!sameInstitution(first, second)) continue;

      // Present the direction that keeps the healthier connection.
      const [keep, drop] = keepRank(first, second) <= 0 ? [first, second] : [second, first];
      const preferred = planDirection(keep, drop, accounts);
      const reverse = planDirection(drop, keep, accounts);
      if (!preferred.offerable && !reverse.offerable) continue;

      const recommended = preferred.offerable ? preferred : reverse;
      const other = recommended === preferred ? reverse : preferred;
      out.push({
        institutionLabel: (keep.institutionName ?? drop.institutionName ?? '').trim() || null,
        recommended,
        alternative: other.offerable ? other : null,
        alternativeBlockedNames: other.offerable ? [] : other.strandedAccountNames,
      });
    }
  }

  return out;
}
