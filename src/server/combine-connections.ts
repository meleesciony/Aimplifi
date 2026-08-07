/**
 * Combine two live Plaid connections that are pulling the same account(s) — core
 * (docs/ACCOUNT_IDENTITY_ARCHITECTURE.md §4 layer 3; TASKS L.6 / L.10).
 *
 * Owner-reported 2026-07-24: two Chase connections each pulling `CREDIT CARD ····0977`, so one
 * real card counted twice everywhere. Until now the app had NO path for this — the shipped
 * Combine flow needs one stale side (R3), and both of these are live.
 *
 * The move, in the only order that is safe:
 *
 *   PHASE 1 — one SERIALIZABLE transaction that re-derives the whole plan from CURRENT rows,
 *   re-applies every suppression the card applies, stamps the losing connection's bank identity
 *   onto its accounts, and DELETES that connection row. Deleting the row is both the state change
 *   that makes the losing side stale (which is what R3 requires) and the claim that makes this
 *   operation unrepeatable — the card offers two directions as two live buttons, and deriving the
 *   plan outside a transaction let two concurrent taps each drop a different connection and
 *   destroy BOTH (critic P0-1, executed). Reading the item rows and deleting one inside the same
 *   transaction turns that race into a detected write conflict: one caller commits, the other
 *   re-reads and finds the direction no longer offered.
 *
 *   PHASE 2 — revoke the token at Plaid, then record one reconciliation per proven pair through
 *   the SHIPPED `confirmReconciliationFor`, whose own in-transaction guards (ownership,
 *   direction, cutover bounds, chain monotonicity) re-check everything. This module adds no money
 *   rule of its own; the boundary engine already knows how to make two rows read as one account.
 *   Nothing in phase 2 can strand the user: exactly one connection was dropped, the other is
 *   live, so an unfinished pair reappears as an ordinary "continue this account?" candidate.
 *
 * R3 is honoured rather than weakened: by the time a confirm runs, the predecessor genuinely is
 * disconnected. `confirmedByUserAt` stays honest — the user did confirm, on this screen.
 *
 * The disconnect is not reversible by this action (re-connecting a bank means going through Link
 * again), so it is stated in the confirm step before the tap. The links ARE reversible: Undo on
 * the /accounts "Combined accounts" card restores both rows to counting separately.
 *
 * Kept NextAuth-free (takes `userId` + an injected `today` + an injected revoke) so it runs under
 * vitest against the real Prisma client without a live Plaid. The `'use server'` wrapper lives in
 * server/combine-connections-actions.ts.
 */
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { type ISODate, addDays, compareDates, isoDate } from '@/lib/dates';
import { DEMO_RECONCILE_BLOCKED, isDemoUser } from '@/lib/demo-user';
import {
  explainUncombinableConnections,
  planCombinableConnections,
  type CombineAccountPair,
  type CombineConnectionAccount,
  type CombineConnectionItem,
  type CombineConnectionsProposal,
  type CombineDirection,
  type UncombinableConnections,
} from '@/lib/engine/account/combine-connections';
import { isSupportedCurrency } from '@/lib/providers/currency';
import { duplicatePairDismissKey } from '@/server/duplicate-dismissal';
import { confirmReconciliationFor } from '@/server/reconciliation';

export interface CombineConnectionsInput {
  /** The connection that keeps syncing. */
  keepItemId: string;
  /** The connection that is disconnected; its rows become historical. */
  dropItemId: string;
}

export type CombineConnectionsResult =
  | {
      ok: true;
      /** How many account pairs were linked. */
      combined: number;
      /** Pairs whose link failed AFTER the connection was dropped — named, never swallowed. */
      failures: string[];
      /** Set when the bank was removed from this app but Plaid did not confirm the revoke, so
       *  the token may still be live upstream. Disclosed, never swallowed. */
      revokeFailed: string | null;
    }
  | { ok: false; error: string };

/** One generic refusal for every ownership / shape problem — no cross-user oracle. */
const NOT_FOUND = 'That connection was not found.';

const NOT_COMBINABLE =
  'Those two connections don’t look like the same accounts any more — reload the page and check what each one is carrying.';

/** The `PlaidItem` columns the planner reads. */
export interface CombineItemRow {
  itemId: string;
  institution: string | null;
  institutionId: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: Date;
}

/** The `Account` columns the planner reads. */
export interface CombineAccountRow {
  id: string;
  /** The FEED's name. A nickname must never enter this mapper — the planner downstream sorts
   *  by it and its direction is order-dependent (TASKS L.7 critic F1). */
  name: string;
  provider: string;
  plaidItemId: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currency: string | null;
  persistentAccountId: string | null;
  institutionId: string | null;
  institutionName: string | null;
}

/**
 * Map stored rows onto the pure engine's inputs. Exported because TWO callers need it — the
 * /accounts view (which already has both row sets in hand and must not re-query) and this
 * module's action (which re-reads fresh state inside its transaction). One mapper, so the card
 * the user taps and the guard that admits the tap can never be built from different shapes.
 *
 * `earliestTxnDateByAccountId` is each account's oldest stored transaction date (YYYY-MM-DD),
 * absent when the account holds no rows. The mapper folds it to a per-CONNECTION minimum here —
 * in the one shared place — rather than at each fetch site, so the depth evidence `keepRank`
 * rule 3 ranks on (TASKS H.6c) cannot be computed two different ways by the card and the action.
 */
export function buildCombineInputs(
  items: readonly CombineItemRow[],
  accounts: readonly CombineAccountRow[],
  earliestTxnDateByAccountId: ReadonlyMap<string, string>,
) {
  const institutionByItem = new Map(items.map((i) => [i.itemId, i]));
  const earliestByItem = new Map<string, string>();
  for (const a of accounts) {
    if (a.provider !== 'plaid' || !a.plaidItemId) continue;
    const d = earliestTxnDateByAccountId.get(a.id);
    if (!d) continue;
    const current = earliestByItem.get(a.plaidItemId);
    if (current === undefined || d < current) earliestByItem.set(a.plaidItemId, d);
  }
  const engineItems: CombineConnectionItem[] = items.map((i) => ({
    itemId: i.itemId,
    institutionId: i.institutionId,
    institutionName: i.institution,
    lastSyncedAt: i.lastSyncedAt,
    lastSyncError: i.lastSyncError,
    earliestTxnDate: earliestByItem.get(i.itemId) ?? null,
    linkedAtKey: i.createdAt.toISOString(),
  }));
  const engineAccounts: CombineConnectionAccount[] = accounts.map((a) => {
    const item = a.plaidItemId ? institutionByItem.get(a.plaidItemId) : undefined;
    return {
      id: a.id,
      // The FEED's name, deliberately — TASKS L.7 critic F1 (P0). The identity LADDER never
      // reads a name, but the planner around it does: `accountsOf` sorts rows by name, and
      // `planDirection` is order-dependent through its `claimed` set, so a row that is
      // ambiguous when iterated first becomes unambiguous when iterated second. Feeding it a
      // nickname made a cosmetic rename invert which connection the card recommends
      // DISCONNECTING — and confirming that revokes a Plaid item, an irreversible external
      // side effect. A label may not decide that. The card still identifies each account by
      // the last-4 it prints (#298); rendering the user's own name here is a display-layer
      // follow-up, recorded in STATUS, and must post-map the planner's OUTPUT.
      name: a.name,
      provider: a.provider,
      plaidItemId: a.plaidItemId,
      // The live connection is authoritative; the row's own stamp is the last-known value for a
      // row whose connection has been disconnected (and deleted) — see plaid-identity.ts.
      institutionId: item?.institutionId ?? a.institutionId ?? null,
      institutionName: item?.institution ?? a.institutionName ?? null,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      currency: a.currency,
      persistentAccountId: a.persistentAccountId,
    };
  });
  return { engineItems, engineAccounts };
}

/** Order-independent key for a pair of account ids. */
export function combinePairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Every suppression the /accounts card applies, applied to the SAME proposals — by BOTH the card
 * and the action. A card that is correctly hidden while the action still accepts the request is
 * not a guard, it is a race with a nicer face: a stale tab (or any crafted request) could
 * otherwise disconnect a bank for a pair the user had explicitly marked "not the same account"
 * (docs/lessons/a-guard-must-read-what-it-guards).
 */
export function suppressCombineProposals(
  proposals: readonly CombineConnectionsProposal[],
  ctx: {
    /** Rows the currency guard admits — a proposal must never name a withheld account. */
    supportedAccountIds: ReadonlySet<string>;
    /** Pairs the user judged "not the same account". */
    dismissedPairKeys: ReadonlySet<string>;
    /** Pairs already reconciled, in either direction — resolved, not a proposal. */
    reconciledPairKeys: ReadonlySet<string>;
    /** Accounts already acting as a PREDECESSOR in an active link. Re-targeting one would
     *  silently rewrite a decision the user already confirmed (slice-6 critic C-8). A successor
     *  is deliberately NOT blocked: `successorAccountId` is not unique because one live account
     *  may supersede several old rows — blocking it stranded the third of three connections at
     *  one bank, leaving the user still double-counting and the card withdrawn (critic P1-4). */
    linkedPredecessorIds: ReadonlySet<string>;
  },
): CombineConnectionsProposal[] {
  return proposals.filter((proposal) =>
    [proposal.recommended, proposal.alternative].every(
      (d) =>
        d === null ||
        d.pairs.every(
          (p) =>
            ctx.supportedAccountIds.has(p.predecessorAccountId) &&
            ctx.supportedAccountIds.has(p.successorAccountId) &&
            !ctx.dismissedPairKeys.has(duplicatePairDismissKey(p.predecessorAccountId, p.successorAccountId)) &&
            !ctx.reconciledPairKeys.has(combinePairKey(p.predecessorAccountId, p.successorAccountId)) &&
            !ctx.linkedPredecessorIds.has(p.predecessorAccountId),
        ),
    ),
  );
}

/** The direction the caller asked for, if these proposals still offer it. */
function requestedDirection(
  proposals: readonly CombineConnectionsProposal[],
  input: CombineConnectionsInput,
): CombineDirection | null {
  for (const proposal of proposals) {
    for (const direction of [proposal.recommended, proposal.alternative]) {
      if (
        direction?.offerable &&
        direction.keepItemId === input.keepItemId &&
        direction.dropItemId === input.dropItemId
      ) {
        return direction;
      }
    }
  }
  return null;
}

/**
 * Where the two rows hand over.
 *
 * The boundary gives the predecessor `[its first txn, min(cutover, its last txn)]` and gives the
 * successor everything OUTSIDE that window — so the cutover decides which side owns the overlap,
 * and whatever the losing side holds inside it is dropped from every total.
 *
 * The shipped candidate card defaults to the predecessor's LAST transaction, which is right
 * cross-provider (the stale side is the only one that has that era). Here it is WRONG, and a
 * critic proved it with an executed repro: the dropped connection is by construction the less
 * complete side, so letting it claim the whole overlap deleted two real charges — $890 — that
 * only the surviving connection had pulled, while the flash said "Done". Silent loss is the one
 * failure direction this whole feature was designed to avoid.
 *
 * So the handover is placed the day BEFORE the surviving connection's own history starts:
 *
 *   * the old row keeps everything from before the live feed existed — real history, no overlap;
 *   * the live feed keeps ALL of its own rows, because every one of them is after the cutover;
 *   * the duplicates — old-row copies of charges the live feed also pulled — are exactly what
 *     falls away, which is the entire point.
 *
 * Clamped into what the boundary and `confirmReconciliationFor` accept: never before the old
 * row's first transaction (that would strand its earlier rows) and never after today.
 */
function handoverDate(predFirst: ISODate | null, succFirst: ISODate | null, today: ISODate): ISODate {
  // No live-feed history to defer to (a brand-new connection that has not pulled yet): the old
  // row claims its own span, which duplicates nothing.
  if (succFirst === null) return today;
  const dayBefore = addDays(succFirst, -1);
  // Never before the old row's own first transaction: the boundary would strand everything
  // earlier, and `confirmReconciliationFor` refuses it outright.
  const floored = predFirst !== null && compareDates(dayBefore, predFirst) < 0 ? predFirst : dayBefore;
  return minDate(floored, today);
}

function minDate(a: ISODate, b: ISODate): ISODate {
  return compareDates(a, b) > 0 ? b : a;
}

interface DatedAmount {
  date: string;
  amountCents: number;
}

function firstDate(rows: readonly DatedAmount[]): ISODate | null {
  let min: string | null = null;
  for (const r of rows) if (min === null || r.date < min) min = r.date;
  return min === null ? null : isoDate(min);
}

/**
 * Which rows the date split would drop that are NOT duplicated on the surviving side.
 *
 * The boundary gives the predecessor `[its first, min(cutover, its last)]` and the successor
 * everything outside that window, so the dropped set is: predecessor rows after the cutover, plus
 * successor rows inside the window. A dropped row is harmless only if the side that survives that
 * day holds an identical (date, amount) row — a real duplicate. Matched as a MULTISET, so two
 * genuine $5.00 charges on one day need two survivors, not one.
 */
function rowsLostToTheSplit(
  predRows: readonly DatedAmount[],
  succRows: readonly DatedAmount[],
  cutover: ISODate,
): { count: number; cents: number } {
  const predFirst = firstDate(predRows);
  const key = (r: DatedAmount) => `${r.date}|${r.amountCents}`;
  const inWindow = (r: DatedAmount) =>
    predFirst !== null && r.date >= predFirst && r.date <= cutover;

  const tally = (rows: readonly DatedAmount[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return m;
  };
  // Survivors on each side, i.e. the rows the boundary keeps.
  const predKept = tally(predRows.filter(inWindow));
  const succKept = tally(succRows.filter((r) => !inWindow(r)));

  let count = 0;
  let cents = 0;
  const charge = (r: DatedAmount) => {
    count += 1;
    cents += Math.abs(r.amountCents);
  };
  // Predecessor rows outside its claim are dropped; the successor must hold each of them.
  const succAvailable = new Map(succKept);
  for (const r of predRows.filter((x) => !inWindow(x))) {
    const left = succAvailable.get(key(r)) ?? 0;
    if (left <= 0) charge(r);
    else succAvailable.set(key(r), left - 1);
  }
  // Successor rows inside the predecessor's claim are dropped; the predecessor must hold each.
  const predAvailable = new Map(predKept);
  for (const r of succRows.filter(inWindow)) {
    const left = predAvailable.get(key(r)) ?? 0;
    if (left <= 0) charge(r);
    else predAvailable.set(key(r), left - 1);
  }
  return { count, cents };
}

function cannotSplitCleanly(lost: { count: number; cents: number }): string {
  const amount = (lost.cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return `These two connections don't hold the same transactions — ${lost.count} ${
    lost.count === 1 ? 'charge' : 'charges'
  } totalling ${amount} ${lost.count === 1 ? 'appears' : 'appear'} on only one of them, and combining would stop ${
    lost.count === 1 ? 'it' : 'them'
  } being counted. Nothing was changed. Sync both connections and try again; if it keeps happening, keep them separate and delete the copy you don't want.`;
}

type Claim =
  | { ok: true; pairs: readonly CombineAccountPair[]; cutovers: Map<string, string>; accessToken: string }
  | { ok: false; error: string };

export async function combineDuplicateConnectionsFor(
  userId: string,
  input: CombineConnectionsInput,
  today: ISODate,
  revoke: (userId: string, itemId: string, accessToken: string) => Promise<void>,
): Promise<CombineConnectionsResult> {
  if (isDemoUser(userId)) return { ok: false, error: DEMO_RECONCILE_BLOCKED };
  // 'use server' endpoints take attacker-shaped input: refuse non-scalars before any query.
  if (typeof input?.keepItemId !== 'string' || typeof input?.dropItemId !== 'string') {
    return { ok: false, error: NOT_FOUND };
  }
  if (input.keepItemId === input.dropItemId) {
    return { ok: false, error: 'That’s the same connection twice.' };
  }

  let claim: Claim;
  try {
    claim = await prisma.$transaction(
      async (tx): Promise<Claim> => {
        const [items, accounts, dismissed, links, txnFloors] = await Promise.all([
          tx.plaidItem.findMany({
            where: { userId },
            select: {
              itemId: true,
              institution: true,
              institutionId: true,
              lastSyncedAt: true,
              lastSyncError: true,
              createdAt: true,
              accessToken: true,
            },
          }),
          tx.account.findMany({
            where: { userId, provider: 'plaid' },
            select: {
              id: true,
              name: true,
              provider: true,
              plaidItemId: true,
              mask: true,
              type: true,
              subtype: true,
              currency: true,
              persistentAccountId: true,
              institutionId: true,
              institutionName: true,
            },
          }),
          tx.nudgeDismissal.findMany({
            where: { userId, dismissKey: { startsWith: 'dup:' } },
            select: { dismissKey: true },
            take: 500,
          }),
          tx.accountReconciliation.findMany({
            where: { userId, undoneAt: null },
            select: { predecessorAccountId: true, successorAccountId: true },
          }),
          // Each plaid account's oldest stored row — the same depth evidence the /accounts card
          // ranks on (H.6c), re-read inside this transaction like everything else the plan is
          // derived from, so the action and the card feed the shared mapper the same shape.
          tx.transaction.groupBy({
            by: ['accountId'],
            where: { account: { userId, provider: 'plaid' } },
            _min: { date: true },
          }),
        ]);

        const earliestTxnByAccount = new Map(
          txnFloors.flatMap((g) => (g._min.date != null ? [[g.accountId, g._min.date] as const] : [])),
        );
        const { engineItems, engineAccounts } = buildCombineInputs(items, accounts, earliestTxnByAccount);
        const proposals = suppressCombineProposals(planCombinableConnections(engineItems, engineAccounts), {
          supportedAccountIds: new Set(accounts.filter((a) => isSupportedCurrency(a.currency)).map((a) => a.id)),
          dismissedPairKeys: new Set(dismissed.map((d) => d.dismissKey)),
          reconciledPairKeys: new Set(links.map((l) => combinePairKey(l.predecessorAccountId, l.successorAccountId))),
          linkedPredecessorIds: new Set(links.map((l) => l.predecessorAccountId)),
        });
        // Ownership is implicit and total: both lists are scoped to this user, so an id belonging
        // to anyone else is simply absent and refused exactly like a made-up one.
        const direction = requestedDirection(proposals, input);
        if (!direction) return { ok: false, error: NOT_COMBINABLE };
        const dropItem = items.find((i) => i.itemId === direction.dropItemId);
        if (!dropItem) return { ok: false, error: NOT_COMBINABLE };

        const cutovers = new Map<string, string>();
        // The no-loss guard compares the rows AS THE BANK DELIVERED THEM (TASKS H.6b(b)): split
        // parents and unsplit rows, never split children. A split is the reader's own re-labelling
        // of one bank charge — the children share the parent's date and sum exactly to its amount
        // by `splitTransaction`'s own validation — so the parent is the row the other connection
        // can be expected to hold a copy of. The previous filter (`isSplitParent: false`) presented
        // the CHILDREN (−60.00, −40.00) where the other side holds the parent (−100.00), and one
        // hand-split transaction made the whole combine refuse with a false diagnosis ("2 charges
        // … appear on only one of them") — a blocked remedy on exactly the flow H.6 built. What a
        // combine does to the split STRUCTURE is a separate, disclosed fact (H.6b(a), the amber
        // caveat on the deepen door); this guard's question is whether MONEY would vanish, and for
        // that the bank's own shape is the honest basis on both sides.
        const bankShape = { OR: [{ isSplitParent: true }, { splitParentId: null }] };
        for (const pair of direction.pairs) {
          const [predRows, succRows] = await Promise.all([
            tx.transaction.findMany({
              where: { accountId: pair.predecessorAccountId, ...bankShape },
              select: { date: true, amountCents: true },
            }),
            tx.transaction.findMany({
              where: { accountId: pair.successorAccountId, ...bankShape },
              select: { date: true, amountCents: true },
            }),
          ]);
          const cutover = handoverDate(firstDate(predRows), firstDate(succRows), today);
          const lost = rowsLostToTheSplit(predRows, succRows, cutover);
          if (lost.count > 0) {
            // THE GUARD THIS FEATURE RESTS ON (critic P0, executed in both directions). The
            // boundary splits two rows by a DATE, so whichever side does not own a day loses its
            // copy of it. That is exactly right when the copies are duplicates — which is the
            // whole point — and it silently deletes real money when they are not. Two LIVE feeds
            // are both partial, in different places: one was broken for two days, the other
            // backfills further, so a date line cannot be assumed lossless the way it can when
            // only one feed ever covered the era (the cross-provider case this machinery was
            // built for).
            //
            // So: never act on an assumption. Every row the split would drop must have a
            // same-day, same-amount survivor on the other side. If one does not, the combine is
            // refused with the amount named — the pair keeps its advisory card, and no figure
            // moves. An honest gap beats a silent deletion.
            return { ok: false, error: cannotSplitCleanly(lost) };
          }
          cutovers.set(pair.predecessorAccountId, cutover);
        }

        // WHO these rows bank with, stamped before the row holding it goes (plaid-identity.ts).
        // In-transaction rather than through the shared helper because it must commit or roll
        // back with the delete it protects.
        if (dropItem.institutionId || dropItem.institution) {
          await tx.account.updateMany({
            where: { userId, provider: 'plaid', plaidItemId: dropItem.itemId },
            data: {
              ...(dropItem.institutionId ? { institutionId: dropItem.institutionId } : {}),
              ...(dropItem.institution ? { institutionName: dropItem.institution } : {}),
            },
          });
        }
        // Autopay follows the account, not the connection (critic P1-3, executed): the dropped
        // row's `AutopayConfig` is filtered out with it, so /cards flipped from "autopay will
        // pay this" to "move $8,539.09 yourself" while the bank still pulled the money — a
        // double-payment hazard on the same card. Carried across only when the surviving row has
        // none of its own; the user's own setting on the survivor always wins.
        for (const pair of direction.pairs) {
          const [fromDropped, onSurvivor] = await Promise.all([
            tx.autopayConfig.findUnique({ where: { accountId: pair.predecessorAccountId } }),
            tx.autopayConfig.findUnique({ where: { accountId: pair.successorAccountId } }),
          ]);
          if (fromDropped && !onSurvivor) {
            await tx.autopayConfig.create({
              data: {
                accountId: pair.successorAccountId,
                mode: fromDropped.mode,
                fixedAmountCents: fromDropped.fixedAmountCents,
              },
            });
          }
          // The NAME follows the account too (TASKS L.7, critic F5) — same rule, same reason.
          // Without this the survivor reverts to the string the bank sends, which is the exact
          // name the user renamed away from, while the disclosure card beneath it still shows
          // the name he chose. Carried only onto a survivor with none of its own.
          const [droppedName, survivorName] = await Promise.all([
            tx.account.findUnique({ where: { id: pair.predecessorAccountId }, select: { displayName: true } }),
            tx.account.findUnique({ where: { id: pair.successorAccountId }, select: { displayName: true } }),
          ]);
          if (droppedName?.displayName && !survivorName?.displayName) {
            await tx.account.update({
              where: { id: pair.successorAccountId },
              data: { displayName: droppedName.displayName },
            });
          }
        }

        await tx.plaidItem.deleteMany({ where: { userId, itemId: dropItem.itemId } });

        return { ok: true, pairs: direction.pairs, cutovers, accessToken: dropItem.accessToken };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    // P2034 = the designated loser of a write conflict. The winner's state is consistent.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
      return { ok: false, error: 'That change collided with another update — reload and try again.' };
    }
    throw e;
  }
  if (!claim.ok) return claim;

  let revokeFailed: string | null = null;
  try {
    await revoke(userId, input.dropItemId, claim.accessToken);
  } catch (e) {
    revokeFailed = e instanceof Error ? e.message : 'unknown error';
  }

  let combined = 0;
  const failures: string[] = [];
  for (const pair of claim.pairs) {
    const result = await confirmReconciliationFor(
      userId,
      {
        predecessorAccountId: pair.predecessorAccountId,
        successorAccountId: pair.successorAccountId,
        cutoverDate: claim.cutovers.get(pair.predecessorAccountId) ?? today,
        matchSignal: pair.tier === 'P' ? 'persistent' : 'mask',
        confidence: 'high',
      },
      today,
    );
    if (result.ok) combined += 1;
    else failures.push(`${pair.predecessorName}${pair.mask ? ` ····${pair.mask}` : ''}: ${result.error}`);
  }

  return { ok: true, combined, failures, revokeFailed };
}

/**
 * The proposals to render, from rows the caller already holds. Same mapper, same engine, and —
 * via `suppressCombineProposals` — the same suppressions as the action. Demo is fenced here as
 * well as in the action: the shared demo row must never be offered a control it would be refused
 * (docs/lessons/shared-demo-account-must-not-learn.md).
 */
export function combinableConnectionsFor(
  userId: string,
  items: readonly CombineItemRow[],
  accounts: readonly CombineAccountRow[],
  earliestTxnDateByAccountId: ReadonlyMap<string, string>,
): CombineConnectionsProposal[] {
  if (isDemoUser(userId)) return [];
  const { engineItems, engineAccounts } = buildCombineInputs(items, accounts, earliestTxnDateByAccountId);
  return planCombinableConnections(engineItems, engineAccounts);
}

/** One "why isn't there a Combine button?" row for the /accounts card. */
export interface CombineBlockedView {
  institutionLabel: string | null;
  keepItemId: string;
  dropItemId: string;
  lookalikes: readonly { name: string; mask: string }[];
  kind: UncombinableConnections['kind'] | 'dismissed' | 'already-linked';
  strandedAccountNames: readonly string[];
  /** Present only for `dismissed`: the account pair a "reconsider" control would un-dismiss. */
  dismissedPair: { aId: string; bId: string } | null;
}

/**
 * The pairs that LOOK like duplicates but are not offered, each with the reason — including the
 * two reasons only the server knows: the user dismissed this pair, or it is already reconciled.
 * Rendered so the absence of an offer is never mistaken for the app not having looked.
 */
export function uncombinableConnectionsFor(
  userId: string,
  items: readonly CombineItemRow[],
  accounts: readonly CombineAccountRow[],
  earliestTxnDateByAccountId: ReadonlyMap<string, string>,
  ctx: {
    offeredItemPairKeys: ReadonlySet<string>;
    dismissedPairKeys: ReadonlySet<string>;
    reconciledPairKeys: ReadonlySet<string>;
  },
): CombineBlockedView[] {
  if (isDemoUser(userId)) return [];
  const { engineItems, engineAccounts } = buildCombineInputs(items, accounts, earliestTxnDateByAccountId);
  const out: CombineBlockedView[] = explainUncombinableConnections(engineItems, engineAccounts).map((e) => ({
    ...e,
    dismissedPair: null,
  }));

  // A pair the ENGINE would offer but the server suppressed reaches neither list, so re-derive
  // those here: the user is owed the reason for a control that is deliberately absent.
  for (const proposal of planCombinableConnections(engineItems, engineAccounts)) {
    const d = proposal.recommended;
    if (ctx.offeredItemPairKeys.has(combinePairKey(d.keepItemId, d.dropItemId))) continue;
    const dismissed = d.pairs.find((p) =>
      ctx.dismissedPairKeys.has(duplicatePairDismissKey(p.predecessorAccountId, p.successorAccountId)),
    );
    const linked = d.pairs.some((p) =>
      ctx.reconciledPairKeys.has(combinePairKey(p.predecessorAccountId, p.successorAccountId)),
    );
    if (!dismissed && !linked) continue;
    out.push({
      institutionLabel: proposal.institutionLabel,
      keepItemId: d.keepItemId,
      dropItemId: d.dropItemId,
      lookalikes: d.pairs.flatMap((p) => (p.mask ? [{ name: p.successorName, mask: p.mask }] : [])),
      strandedAccountNames: [],
      kind: dismissed ? 'dismissed' : 'already-linked',
      dismissedPair: dismissed
        ? { aId: dismissed.predecessorAccountId, bId: dismissed.successorAccountId }
        : null,
    });
  }
  return out;
}
