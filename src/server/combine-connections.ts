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

/** The direction the caller asked for, if these proposals still offer it — plus whether the SAME
 *  pair offers the opposite direction, which the no-loss refusal needs before it may name
 *  "combine the other way round" as the remedy (a remedy that would refuse is worse than none). */
function requestedDirection(
  proposals: readonly CombineConnectionsProposal[],
  input: CombineConnectionsInput,
): { direction: CombineDirection; otherDirectionOffered: boolean } | null {
  for (const proposal of proposals) {
    for (const direction of [proposal.recommended, proposal.alternative]) {
      if (
        direction?.offerable &&
        direction.keepItemId === input.keepItemId &&
        direction.dropItemId === input.dropItemId
      ) {
        const other = direction === proposal.recommended ? proposal.alternative : proposal.recommended;
        return { direction, otherDirectionOffered: other?.offerable === true };
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

/** The guard's read of one account: every stored row, with the split linkage that decides which
 *  rows the register actually counts. Fetched UNFILTERED because the guard has to see the same
 *  world the boundary will operate on. */
interface GuardRow extends DatedAmount {
  id: string;
  isSplitParent: boolean;
  splitParentId: string | null;
}

function firstDate(rows: readonly DatedAmount[]): ISODate | null {
  let min: string | null = null;
  for (const r of rows) if (min === null || r.date < min) min = r.date;
  return min === null ? null : isoDate(min);
}

function lastDate(rows: readonly DatedAmount[]): ISODate | null {
  let max: string | null = null;
  for (const r of rows) if (max === null || r.date > max) max = r.date;
  return max === null ? null : isoDate(max);
}

/**
 * The rows AS THE BANK DELIVERED THEM (TASKS H.6b(b), reworked by its critic cycle): a split
 * parent stands in for its children — the children are the reader's own re-labelling of one bank
 * charge and sum exactly to it by `splitTransaction`'s validation — an unsplit row stands as
 * itself, and a child whose parent row NO LONGER EXISTS on this account (dangling
 * `splitParentId`; the column has no FK, and the sync's dissolve path has historically dangled
 * children) stands as itself too, because the register counts it as real money. The critic
 * executed the version that dropped dangling children from this multiset: a counted $60.00
 * vanished from the register behind an `ok: true`.
 */
function bankShapeRows<T extends GuardRow>(rows: readonly T[]): T[] {
  const parentIds = new Set(rows.filter((r) => r.isSplitParent).map((r) => r.id));
  return rows.filter((r) => r.splitParentId === null || !parentIds.has(r.splitParentId));
}

/**
 * A split family whose rows fall on BOTH sides of an ownership line (H.6b(b) critic P0,
 * executed). The parent-stands-in accounting above is sound only while the boundary treats a
 * family as one unit — and the dates genuinely drift apart in production: the pending→posted
 * sync moves the PARENT to the posted date while leaving the children at the pending date
 * (plaid.ts, both the preserve branch and the id-churn transplant). A severed family either
 * stops counting its children (successor side: children inside the predecessor's claim are
 * dropped while the surviving parent counts in no total) or double-counts against the other
 * side's surviving copy (predecessor side: kept children plus the successor's kept copy). Both
 * are silent money errors, so a straddling family refuses the whole combine — fail closed,
 * nothing changed, and the message names the remedy the reader actually has (undo the split).
 */
function splitFamilySevered(rows: readonly GuardRow[], dropped: (r: GuardRow) => boolean): boolean {
  const parents = new Map<string, GuardRow>();
  const childrenByParent = new Map<string, GuardRow[]>();
  for (const r of rows) {
    if (r.isSplitParent) parents.set(r.id, r);
    else if (r.splitParentId !== null) {
      const list = childrenByParent.get(r.splitParentId) ?? [];
      list.push(r);
      childrenByParent.set(r.splitParentId, list);
    }
  }
  for (const [parentId, children] of childrenByParent) {
    const parent = parents.get(parentId);
    if (!parent) continue; // dangling children stand alone in the multiset instead
    const verdicts = [parent, ...children].map(dropped);
    if (verdicts.some(Boolean) && !verdicts.every(Boolean)) return true;
  }
  return false;
}

function splitSeveredMessage(accountLabelText: string): string {
  return `A transaction you split on ${accountLabelText} has pieces dated on both sides of the day these two connections would hand over, so combining would miscount that charge. Nothing was changed. Undo that split, sync both connections, and try the combine again — you can split the charge again afterwards on the connection you keep.`;
}

/**
 * Which rows the date split would drop that are NOT duplicated on the surviving side.
 *
 * The window is the boundary's OWN claim — `[predFirst, claimEnd)` with
 * `claimEnd = min(cutover, predLast)`, both computed by the caller over ALL stored rows, exactly
 * as `txnKeepRule` computes its spans (reconcile-boundary.ts) — so the guard predicts the same
 * ownership the combine will create, never a window of its own invention (H.6b(b) critic P0:
 * recomputing the window from the bank-shape subset diverged from the boundary the moment a
 * split's dates drifted). The dropped set is: predecessor rows outside the claim, plus successor
 * rows inside it. A dropped row is harmless only if the side that survives that day holds an
 * identical (date, amount) row — a real duplicate. Matched as a MULTISET, so two genuine $5.00
 * charges on one day need two survivors, not one.
 *
 * U.13 — THE TWO SIDES NO LONGER SHARE ONE PREDICATE, and that asymmetry is the point.
 * The claim end is now EXCLUSIVE for the successor (the handover day is released to both sides,
 * because a feed stops partway through a day), while the predecessor still keeps its own rows
 * THROUGH that day under its `date <= cutover` rule. So "inside the claim" means `< claimEnd`
 * when asking what the SUCCESSOR loses, and `<= claimEnd` when asking what the PREDECESSOR
 * keeps. Collapsing them back into one predicate is what this guard did before U.13, and it
 * would now over-predict loss on exactly the handover day — refusing a combine, and naming a
 * dollar figure, over rows the boundary no longer drops. That would have blocked the very case
 * U.13 exists to protect: the owner's real $2,086.40 deposit sits on a handover day with no
 * counterpart, which is precisely the shape `cannotSplitCleanly` refuses on.
 */
function rowsLostToTheSplit(
  predRows: readonly DatedAmount[],
  succRows: readonly DatedAmount[],
  window: { predFirst: ISODate | null; claimEnd: ISODate },
): { count: number; cents: number; allOnDroppedConnection: boolean } {
  const { predFirst, claimEnd } = window;
  const key = (r: DatedAmount) => `${r.date}|${r.amountCents}`;
  // What the SUCCESSOR loses: strictly inside the claim (U.13 — the handover day is released).
  const succLoses = (r: DatedAmount) => predFirst !== null && r.date >= predFirst && r.date < claimEnd;
  // What the PREDECESSOR keeps: through the claim end, under its own `date <= cutover` rule.
  const predKeeps = (r: DatedAmount) => predFirst !== null && r.date >= predFirst && r.date <= claimEnd;

  const tally = (rows: readonly DatedAmount[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return m;
  };
  // Survivors on each side, i.e. the rows the boundary keeps.
  const predKept = tally(predRows.filter(predKeeps));
  const succKept = tally(succRows.filter((r) => !succLoses(r)));

  let count = 0;
  let cents = 0;
  let chargedOnSuccessor = 0;
  const charge = (r: DatedAmount) => {
    count += 1;
    cents += Math.abs(r.amountCents);
  };
  // Predecessor rows outside its claim are dropped; the successor must hold each of them.
  const succAvailable = new Map(succKept);
  for (const r of predRows.filter((x) => !predKeeps(x))) {
    const left = succAvailable.get(key(r)) ?? 0;
    if (left <= 0) charge(r);
    else succAvailable.set(key(r), left - 1);
  }
  // Successor rows inside the predecessor's claim are dropped; the predecessor must hold each.
  const predAvailable = new Map(predKept);
  for (const r of succRows.filter(succLoses)) {
    const left = predAvailable.get(key(r)) ?? 0;
    if (left <= 0) {
      charge(r);
      chargedOnSuccessor += 1;
    } else predAvailable.set(key(r), left - 1);
  }
  // The predecessor IS the dropped connection's row set, so "every lost row came from the
  // predecessor side" means the missing money lives entirely on the connection this direction
  // disconnects — the deepen flow's wrong direction has exactly this shape, and there "keep the
  // other one instead" is a true remedy the refusal can name (H.6c critic P1: the old copy told
  // that reader to "sync and try again" — permanently false there — or to delete real history).
  return { count, cents, allOnDroppedConnection: count > 0 && chargedOnSuccessor === 0 };
}

function cannotSplitCleanly(
  lost: { count: number; cents: number; allOnDroppedConnection: boolean },
  otherDirectionOffered: boolean,
): string {
  const amount = (lost.cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const head = `These two connections don't hold the same transactions — ${lost.count} ${
    lost.count === 1 ? 'charge' : 'charges'
  } totalling ${amount} ${lost.count === 1 ? 'appears' : 'appear'} on only one of them, and combining would stop ${
    lost.count === 1 ? 'it' : 'them'
  } being counted. Nothing was changed.`;
  if (lost.allOnDroppedConnection && otherDirectionOffered) {
    // Every missing charge sits on the side this choice disconnects — deeper history is the
    // classic cause — and the opposite direction is actually on offer, so name it.
    return `${head} ${
      lost.count === 1 ? 'That charge lives' : 'Those charges live'
    } only on the connection this choice would disconnect, so combine the other way round instead — keep that connection, and ${
      lost.count === 1 ? 'it keeps' : 'they keep'
    } counting. If you recently re-linked this bank for more history, its older transactions may also still be arriving; waiting costs nothing.`;
  }
  return `${head} Sync both connections and try again; if it keeps happening, the two genuinely differ in places — keep them both, and use “Not the same account” below to stop this offer.`;
}

/**
 * TASKS H.6b(a) — the reader's hand-filed work follows the account across a combine.
 *
 * The boundary hands the overlap to the survivor, and in the deepen shape (the cutover clamped
 * to the predecessor's FIRST transaction) that is nearly everything the old side recorded — so
 * without this, categories, notes, tax classes, exclusions and split families set by hand on
 * the old connection's copies silently stopped being applied in favour of the new connection's
 * untouched copies. No money was lost (that is the guard's job); the reader's decisions were.
 *
 * The planner matches every row the boundary will DISOWN on the predecessor side to its
 * counterpart on the survivor by the exact (date, amount) pair — the same conservative unit the
 * no-loss guard uses (TASKS H.6b(b); C.6's lesson: a loose pair rule once credited 11 refunds
 * as payments, so no tolerance, no fuzzy matching). A key is carried only when exactly ONE
 * disowned predecessor row and exactly ONE survivor row hold it; two identical charges on
 * either side cannot be told apart, so the key is skipped rather than guessed.
 *
 * What is reader-owned:
 *   * the flat per-row state (`note`, `taxClass`, `excludeFromTotals`, `reimbursement`) — the
 *     same set plaid.ts's pending→posted transplant carries (`carriedReaderState`);
 *   * the category verdict — a row with a Correction and not flagged for review (the same
 *     `settled` predicate the transplant uses). The reader's verdict outranks the survivor's
 *     ENGINE guess exactly as it outranks the bank's fresh row in the id-churn transplant, and
 *     is blocked by the survivor's OWN correction, by a pin (a dissolve-forced review has no
 *     verdict to accept), and by a survivor that is itself a split CHILD — a child's category
 *     is the reader's own allocation, so a verdict there would replace one reader value with
 *     another (P1-1). The corrections MOVE, never copy — a copy would feed the learner the same
 *     decision twice (H.8 residual-2);
 *   * a split family — the reader's re-labelling of one bank charge (children sum to the parent
 *     by `splitTransaction`'s validation). Children's categories are reader-owned BY
 *     CONSTRUCTION: only the split UI writes children. Two doctrine edges, both critic-executed:
 *     a SETTLED filing on the survivor blocks the family entirely (the row would become a
 *     container that no sum reads — the survivor's completed decision wins, P1-2), and a family
 *     whose parts no longer sum to the charge is a STALE split (the transplant's dissolve
 *     shape): no pre-split verdict travels and the survivor is FORCED into review — a destroyed
 *     reader decision always re-decides (DECISIONS #147/#148, P1-3).
 *
 * Deliberately not carried: `spendClassOverride` (the keyword-rule backfill stamps it),
 * `reviewPinned` (a pin is a per-copy review demand, and the survivor's queue presence is the
 * survivor's own state), and the successor's engine filing where the reader made none.
 *
 * A carry can never refuse or roll back a combine: data conditions (an ambiguous key, a split
 * whose parts no longer sum, a survivor already carrying its own reader state) skip that row or
 * family — they never throw.
 */

/** One row of the two connections, as read for the carry. */
export interface CarryRow {
  id: string;
  date: string;
  amountCents: number;
  isSplitParent: boolean;
  splitParentId: string | null;
  categoryId: string | null;
  confidenceBps: number | null;
  needsReview: boolean;
  isTransfer: boolean;
  reviewPinned: boolean;
  note: string | null;
  taxClass: string | null;
  excludeFromTotals: boolean;
  reimbursement: string | null;
  status: string;
  rawDescriptor: string; // schema-required — the bank's own descriptor text
  merchantId: string | null;
  /** A Correction exists on this row — the reader (or their rule) filed it. */
  hasCorrection: boolean;
}

/** One planned write onto a surviving row: the changed fields, the family to create under it,
 *  and the corrections to MOVE onto it from the disowned rows. */
export interface CarryRowWrite {
  targetId: string;
  /** Only the fields that actually change — the never-clobber rules are decided here. */
  data: {
    categoryId?: string | null;
    confidenceBps?: number | null;
    needsReview?: boolean;
    isTransfer?: boolean;
    note?: string;
    taxClass?: string;
    excludeFromTotals?: boolean;
    reimbursement?: string;
    isSplitParent?: boolean;
    reviewPinned?: boolean;
  };
  /** Created under `targetId` when a split family is carried whole. */
  children?: CarryChildWrite[];
  /** Corrections on the disowned row(s), moved onto `targetId` (never copied). */
  moveCorrectionsFrom?: string[];
}

/** A re-created split child: the disowned child's columns verbatim, with its id re-pointed. */
export interface CarryChildWrite {
  date: string;
  amountCents: number;
  rawDescriptor: string; // schema-required — the bank's own descriptor text
  merchantId: string | null;
  categoryId: string | null;
  confidenceBps: number | null;
  needsReview: boolean;
  isTransfer: boolean;
  note: string | null;
  taxClass: string | null;
  excludeFromTotals: boolean;
  reimbursement: string | null;
  status: string;
  moveCorrectionsFrom: string[];
}

function carryKey(r: { date: string; amountCents: number }): string {
  return `${r.date}|${r.amountCents}`;
}

/** The never-clobber carry of one disowned row's reader state onto its matched survivor row. */
function buildCarryRowWrite(p: CarryRow, s: CarryRow): CarryRowWrite {
  const data: CarryRowWrite['data'] = {};
  // Flat reader fields — carried only onto a survivor that has none of its own.
  if (p.note !== null && s.note === null) data.note = p.note;
  if (p.taxClass !== null && p.taxClass !== '' && (s.taxClass === null || s.taxClass === '')) {
    data.taxClass = p.taxClass;
  }
  if (p.excludeFromTotals && !s.excludeFromTotals) data.excludeFromTotals = true;
  if (p.reimbursement !== null && s.reimbursement === null) data.reimbursement = p.reimbursement;
  // The category verdict: a Correction marks an explicit reader filing, which outranks the
  // survivor's engine guess — but never the survivor's OWN filing, a pinned row (a
  // dissolve-forced review) has no verdict to accept, and a survivor that is itself a split
  // CHILD (splitParentId set) never receives one: its category is the reader's own allocation
  // — only the split UI writes children — so a carried verdict would replace one reader value
  // with another. The corrections MOVE with a verdict, never copy.
  const settled = p.hasCorrection && !p.needsReview;
  const verdictWins =
    settled &&
    !s.hasCorrection &&
    !s.reviewPinned &&
    s.splitParentId === null &&
    // Finding A (critic cycle 4, P1, extended from F4): a verdict and its Correction NEVER
    // land on a survivor that is a split container, from ANY source — F4 proved it for a
    // PIECE source (the child's category is reader-owned by construction), and the cycle-4
    // critic extended it: the container's children are the reader's own allocation, so a
    // whole-charge verdict from a plain predecessor row would replace one reader value with
    // another (O.13b keeps the reader's pre-split category on the container) and the moved
    // Correction would feed the learner evidence that contradicts the reader's own pieces.
    // (A verdict onto a PLAIN survivor is fine — the plain row is that same amount's own copy.)
    !s.isSplitParent;
  if (verdictWins) {
    data.categoryId = p.categoryId;
    data.confidenceBps = p.confidenceBps;
    data.needsReview = false;
    data.isTransfer = p.isTransfer;
  }
  const write: CarryRowWrite = { targetId: s.id, data };
  if (verdictWins) write.moveCorrectionsFrom = [p.id];
  return write;
}

export function planReaderFieldCarry(
  predRows: readonly CarryRow[],
  succRows: readonly CarryRow[],
  cutover: ISODate,
): CarryRowWrite[] {
  const predShape = bankShapeRows(predRows);
  const succShape = bankShapeRows(succRows);
  // Rows the boundary will disown — the survivor owns everything after the cutover, so the
  // predecessor's own post-cutover rows stop being read. The guard's own `predDropped`.
  const disowned = predShape.filter((r) => compareDates(isoDate(r.date), cutover) > 0);
  if (disowned.length === 0) return [];

  // C.6's conservative matching: a (date, amount) key is carried only when exactly one
  // disowned predecessor row and exactly one survivor row hold it.
  const predCounts = new Map<string, number>();
  const succCounts = new Map<string, number>();
  for (const r of disowned) predCounts.set(carryKey(r), (predCounts.get(carryKey(r)) ?? 0) + 1);
  for (const r of succShape) succCounts.set(carryKey(r), (succCounts.get(carryKey(r)) ?? 0) + 1);
  const succByKey = new Map<string, CarryRow>();
  for (const s of succShape) if (!succByKey.has(carryKey(s))) succByKey.set(carryKey(s), s);
  // A write that would change nothing (every never-clobber rule blocked) is not a write.
  const hasContent = (w: CarryRowWrite): boolean =>
    Object.keys(w.data).length > 0 ||
    w.children !== undefined ||
    (w.moveCorrectionsFrom !== undefined && w.moveCorrectionsFrom.length > 0);

  const writes: CarryRowWrite[] = [];
  for (const p of disowned) {
    const key = carryKey(p);
    if (predCounts.get(key) !== 1 || succCounts.get(key) !== 1) continue;
    const s = succByKey.get(key) as CarryRow;
    const write = buildCarryRowWrite(p, s);
    const childWrites: CarryRowWrite[] = [];
    if (p.isSplitParent) {
      const children = predRows.filter((r) => r.splitParentId === p.id);
      const childSum = children.reduce((sum, c) => sum + c.amountCents, 0);
      if (
        children.length > 0 &&
        childSum === p.amountCents &&
        !s.isSplitParent &&
        s.splitParentId === null &&
        !s.reviewPinned &&
        // P1-2 (critic-executed): a SETTLED filing on the survivor is a completed reader
        // decision — converting the row into a container would neutralize it silently and
        // forever (containers don't drive any sum), the mirror of this slice's own bug. The
        // survivor's filing wins; the family is not carried. (An UNFINISHED review demand
        // still admits the family — the reader re-decides it with the pieces visible.)
        !(s.hasCorrection && !s.needsReview)
      ) {
        // The family is carried whole, exactly like the pending→posted transplant: the
        // survivor's plain row becomes the container and the children are re-created under it
        // verbatim — their categories and amounts are the reader's own allocation. The
        // survivor's OWN review state is never clobbered: a settled verdict (the only one
        // buildCarryRowWrite can emit) already clears needsReview, and reviewPinned is
        // impossible here — this branch requires a survivor that carries none.
        write.data.isSplitParent = true;
        write.children = children.map((c) => ({
          date: c.date,
          amountCents: c.amountCents,
          rawDescriptor: c.rawDescriptor,
          merchantId: c.merchantId,
          categoryId: c.categoryId,
          confidenceBps: c.confidenceBps,
          needsReview: c.needsReview,
          isTransfer: c.isTransfer,
          // NEW-1 (critic-executed): the survivor's OWN flat flags are charge-level reader
          // work, and once this row becomes a container none of them is read anywhere —
          // the register lists only children, the tax report leaves containers out entirely
          // (TAX_BLOCKED_SPLIT_PARENT's doctrine: a tag "belongs on the pieces"), and the
          // reimbursement line skips containers. The children inherit the survivor's flags
          // (survivor wins; the old pieces' own values fill gaps) — O.15 P1-1's exclusion
          // rule, "the pieces inherit the reader's 'not my spending'", extended to all four
          // flats, so the carry cannot make an excluded charge count again, vanish a
          // money-owed claim, or hide a tag the reader set on the new copy.
          note: s.note ?? c.note,
          taxClass: s.taxClass !== null && s.taxClass !== '' ? s.taxClass : c.taxClass,
          excludeFromTotals: s.excludeFromTotals || c.excludeFromTotals,
          reimbursement: s.reimbursement ?? c.reimbursement,
          status: c.status,
          moveCorrectionsFrom: c.hasCorrection ? [c.id] : [],
        }));
      } else if (s.isSplitParent) {
        // BOTH sides were split by the reader: the survivor's family already is their work.
        // Carry each piece's flat state onto its uniquely-matched piece; the survivor's own
        // categories are the reader's (only the split UI writes children — P1-1, critic
        // executed: a settled refile on the old piece must not replace the survivor piece's
        // own category), so `buildCarryRowWrite`'s child-verdict rule blocks any verdict and
        // correction move here.
        const succChildren = succRows.filter((r) => r.splitParentId === s.id);
        const succChildCounts = new Map<string, number>();
        for (const sc of succChildren) {
          succChildCounts.set(carryKey(sc), (succChildCounts.get(carryKey(sc)) ?? 0) + 1);
        }
        // F2 (critic-executed): C.6's multiplicity gate runs on BOTH sides — two identical
        // pieces on the old copy (the reader split a $10 charge into two $5s) both match the
        // same survivor piece; carrying both would let the second overwrite the first.
        const predChildCounts = new Map<string, number>();
        for (const c of children) {
          predChildCounts.set(carryKey(c), (predChildCounts.get(carryKey(c)) ?? 0) + 1);
        }
        for (const c of children) {
          const childKey = carryKey(c);
          if (predChildCounts.get(childKey) !== 1 || succChildCounts.get(childKey) !== 1) continue;
          const sc = succChildren.find((r) => carryKey(r) === childKey) as CarryRow;
          const childWrite = buildCarryRowWrite(c, sc);
          if (hasContent(childWrite)) childWrites.push(childWrite);
        }
        // Finding A (critic cycle 4, P1): the OLD container's own charge-level flats (its note,
        // tag, exclusion, reimbursement) are read nowhere once it is a container, so they route
        // onto the survivor's pieces — each piece's effective value wins (the piece→piece
        // carries above first, then the old container's flats fill the gaps). The verdict is
        // blocked on a container from ANY source (the container rule in buildCarryRowWrite), so
        // `write.data` here is flats only.
        if (Object.keys(write.data).length > 0) {
          for (const sc of succChildren) {
            const existing = childWrites.find((w) => w.targetId === sc.id);
            const eff = existing ? { ...sc, ...existing.data } : sc;
            const gap: CarryRowWrite['data'] = {};
            if (write.data.note !== undefined && eff.note === null) gap.note = write.data.note;
            if (write.data.taxClass !== undefined && (eff.taxClass === null || eff.taxClass === '')) {
              gap.taxClass = write.data.taxClass;
            }
            if (write.data.excludeFromTotals === true && !eff.excludeFromTotals) {
              gap.excludeFromTotals = true;
            }
            if (write.data.reimbursement !== undefined && eff.reimbursement === null) {
              gap.reimbursement = write.data.reimbursement;
            }
            if (Object.keys(gap).length > 0) {
              if (existing) Object.assign(existing.data, gap);
              else childWrites.push({ targetId: sc.id, data: gap });
            }
          }
        }
        // The container itself takes nothing — a row no surface reads.
        write.data = {};
        delete write.moveCorrectionsFrom;
      } else if (
        children.length > 0 &&
        childSum !== p.amountCents &&
        // F3 (critic-executed): never fire on a dangling-child survivor — its category IS the
        // reader's own allocation, so pinning it into durable review would force the reader to
        // re-decide an intact decision. (The P1-2 settled-survivor exception above, and this
        // same child guard, are the two shapes where the stale family just stops being applied.)
        s.splitParentId === null &&
        !(s.hasCorrection && !s.needsReview)
      ) {
        // P1-3 (critic-executed): the parts no longer sum to the charge — the exact stale-split
        // shape the transplant's dissolve branch exists for (the bank amended the amount, and a
        // split whose pieces stopped matching was destroyed). The reader's allocation is gone,
        // so a destroyed reader decision must re-decide (DECISIONS #147/#148): no pre-split
        // verdict is carried, no correction moves, and the survivor is FORCED into review —
        // durably, so a re-sync cannot clear it. A SETTLED filing on the survivor still wins
        // (P1-2's rule — nothing was destroyed on the survivor's own copy); the stale family
        // simply stops being applied.
        delete write.data.categoryId;
        delete write.data.confidenceBps;
        delete write.data.needsReview;
        delete write.data.isTransfer;
        delete write.moveCorrectionsFrom;
        write.data.needsReview = true;
        write.data.reviewPinned = true;
      }
      // Any other shape (a childless container treated as a plain row, or a survivor that is a
      // dangling child, a pinned row, or its own settled filing) keeps the flat carry and
      // skips the family — a carry never blocks an admitted combine.
    } else if (s.isSplitParent) {
      // Finding A (critic cycle 4, P1): a PLAIN (or dangling-child) predecessor row matched
      // the survivor's CONTAINER — a row no surface reads (the register lists only children,
      // the tax report leaves containers out entirely, the reimbursement line skips them).
      // The pred row's flats are LIVE, money-bearing state — the plain row counts, and a
      // dangling child counts by the bank-shape doctrine — so on the container they would
      // stop applying: an exclusion reinstates the charge into every total, an 'awaiting'
      // claim vanishes, a tag leaves the export. They route onto the container's CHILDREN,
      // the same survivor-first gap-fill as the NEW-1 inheritance; the verdict never lands
      // here either (the container rule — the pieces are the reader's own allocation).
      const succChildren = succRows.filter((r) => r.splitParentId === s.id);
      for (const sc of succChildren) {
        const childWrite: CarryRowWrite = { targetId: sc.id, data: {} };
        if (p.note !== null && sc.note === null) childWrite.data.note = p.note;
        if (p.taxClass !== null && p.taxClass !== '' && (sc.taxClass === null || sc.taxClass === '')) {
          childWrite.data.taxClass = p.taxClass;
        }
        if (p.excludeFromTotals && !sc.excludeFromTotals) childWrite.data.excludeFromTotals = true;
        if (p.reimbursement !== null && sc.reimbursement === null) childWrite.data.reimbursement = p.reimbursement;
        if (hasContent(childWrite)) childWrites.push(childWrite);
      }
      // No write targets the container itself — the `write` computed above is discarded.
      write.data = {};
      delete write.moveCorrectionsFrom;
    }
    if (hasContent(write)) {
      writes.push(write);
      // Piece writes target different rows, but the container's write comes first so a reader
      // of the plan sees the family's verdict before its pieces' flats.
      writes.push(...childWrites);
    } else if (childWrites.length > 0) {
      // F1 (critic-executed): a contentless PARENT write must not gate its pieces' flats.
      // Splitting never mints a Correction, so in the common family→family combine the old
      // container's own write is empty while its pieces carry notes, tax classes, exclusions
      // and reimbursements — those travel even though the parent changes nothing.
      writes.push(...childWrites);
    }
  }
  return writes;
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
          // Each plaid account's oldest FEED-DELIVERED row (`providerRef` non-null — manual and
          // CSV rows say nothing about a feed's reach, H.6c critic P1) — the same depth evidence
          // the /accounts card ranks on, re-read inside this transaction so the shared mapper is
          // fed the same shape at both sites. Honesty note (H.6c critic P2): this CANNOT change
          // whether the action accepts or refuses — `requestedDirection` matches either offerable
          // direction by id, and the ranking only orders the card's buttons — it keeps the plan's
          // inputs truthful for anything that later reads them, nothing more.
          tx.transaction.groupBy({
            by: ['accountId'],
            where: { account: { userId, provider: 'plaid' }, providerRef: { not: null } },
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
        const requested = requestedDirection(proposals, input);
        if (!requested) return { ok: false, error: NOT_COMBINABLE };
        const { direction, otherDirectionOffered } = requested;
        const dropItem = items.find((i) => i.itemId === direction.dropItemId);
        if (!dropItem) return { ok: false, error: NOT_COMBINABLE };

        const cutovers = new Map<string, ISODate>();
        // THE GUARD THIS FEATURE RESTS ON (critic P0 #304, executed in both directions; reworked
        // by the H.6b(b) critic's P0). The boundary splits two rows by a DATE, so whichever side
        // does not own a day loses its copy of it — exactly right when the copies are duplicates,
        // and a silent deletion of real money when they are not. So every row the split would
        // drop must have a same-day, same-amount survivor on the other side, or the combine is
        // refused with the amount named.
        //
        // The comparison runs over the rows AS THE BANK DELIVERED THEM (TASKS H.6b(b)): a split
        // parent stands in for its children (they sum to it by `splitTransaction`'s validation),
        // and a dangling child with no surviving parent stands as itself, because the register
        // counts it (`bankShapeRows`). The previous `isSplitParent: false` read presented split
        // CHILDREN against the other side's PARENT, and one hand-split row falsely refused the
        // whole combine. That accounting is sound only while the boundary treats a split family
        // as one unit — and the pending→posted sync drifts a parent's date away from its
        // children's — so a family the claim window would SEVER refuses outright first
        // (`splitFamilySevered`): on the successor side a severed family's children silently
        // stop counting; on the predecessor side they double-count. Fail closed, name the split.
        const guardSelect = { id: true, date: true, amountCents: true, isSplitParent: true, splitParentId: true };
        for (const pair of direction.pairs) {
          const [predAll, succAll] = await Promise.all([
            tx.transaction.findMany({ where: { accountId: pair.predecessorAccountId }, select: guardSelect }),
            tx.transaction.findMany({ where: { accountId: pair.successorAccountId }, select: guardSelect }),
          ]);
          // The window is the boundary's own claim, spans computed over ALL rows exactly as
          // txnKeepRule computes them: [predFirst, min(cutover, predLast)) — HALF-OPEN at the
          // end since U.13, so the successor keeps the handover day and a family that merely
          // straddles it is no longer severed.
          const predFirst = firstDate(predAll);
          const predLast = lastDate(predAll);
          const cutover = handoverDate(predFirst, firstDate(succAll), today);
          const claimEnd = predLast !== null && compareDates(cutover, predLast) > 0 ? predLast : cutover;
          const inClaim = (r: DatedAmount) => predFirst !== null && r.date >= predFirst && r.date < claimEnd;
          // Predecessor keeps date <= cutover (rows before its own first cannot exist); the
          // successor loses exactly the rows inside the claim.
          const predDropped = (r: GuardRow) => compareDates(isoDate(r.date), cutover) > 0;
          const severedSide = splitFamilySevered(predAll, predDropped)
            ? pair.predecessorName
            : splitFamilySevered(succAll, inClaim)
              ? pair.successorName
              : null;
          if (severedSide !== null) {
            return {
              ok: false,
              error: splitSeveredMessage(pair.mask ? `${severedSide} ····${pair.mask}` : severedSide),
            };
          }
          const lost = rowsLostToTheSplit(bankShapeRows(predAll), bankShapeRows(succAll), { predFirst, claimEnd });
          if (lost.count > 0) {
            return { ok: false, error: cannotSplitCleanly(lost, otherDirectionOffered) };
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
        // TASKS H.6b(a) — the reader's hand-filed work follows the account across a combine,
        // like the AutopayConfig and displayName carries above. The boundary hands the overlap
        // to the survivor, and in the deepen shape (the cutover clamped to the predecessor's
        // FIRST transaction) that is nearly everything the old side recorded — so categories,
        // notes, tax classes, exclusions and split families set by hand on the old connection's
        // copies silently stopped being applied. `planReaderFieldCarry` matches each row the
        // boundary will disown to its survivor counterpart (exact date + amount — C.6's
        // conservative rule) and plans the writes; nothing here can refuse the combine, and a
        // data condition skips its row or family rather than throwing.
        const carrySelect = {
          id: true,
          date: true,
          amountCents: true,
          isSplitParent: true,
          splitParentId: true,
          categoryId: true,
          confidenceBps: true,
          needsReview: true,
          isTransfer: true,
          reviewPinned: true,
          note: true,
          taxClass: true,
          excludeFromTotals: true,
          reimbursement: true,
          status: true,
          rawDescriptor: true,
          merchantId: true,
        };
        for (const pair of direction.pairs) {
          const [predAll, succAll] = await Promise.all([
            tx.transaction.findMany({ where: { accountId: pair.predecessorAccountId }, select: carrySelect }),
            tx.transaction.findMany({ where: { accountId: pair.successorAccountId }, select: carrySelect }),
          ]);
          const correctedRows = await tx.correction.findMany({
            where: { transactionId: { in: [...predAll, ...succAll].map((r) => r.id) } },
            select: { transactionId: true },
          });
          const correctedIds = new Set(correctedRows.map((c) => c.transactionId));
          const toCarry = (rows: (typeof predAll)[number][]): CarryRow[] =>
            rows.map((r) => ({ ...r, hasCorrection: correctedIds.has(r.id) }));
          // The cutover the guard validated for THIS pair — never recomputed, so the carry
          // disowns exactly the rows the boundary will (a-guard-must-read-what-it-guards).
          // The guard loop set every pair's cutover before returning ok, so a missing entry is
          // an invariant violation, not a data condition — a `?? today` fallback here could
          // silently disown a different row set than the boundary (P2-1, critic).
          const cutover = cutovers.get(pair.predecessorAccountId);
          if (cutover === undefined) {
            throw new Error('H.6b(a) carry: pair reached without a planned cutover');
          }
          const writes = planReaderFieldCarry(toCarry(predAll), toCarry(succAll), cutover);
          for (const write of writes) {
            if (Object.keys(write.data).length > 0) {
              await tx.transaction.update({ where: { id: write.targetId }, data: write.data });
            }
            for (const child of write.children ?? []) {
              const { moveCorrectionsFrom, ...childData } = child;
              const created = await tx.transaction.create({
                data: { accountId: pair.successorAccountId, ...childData, splitParentId: write.targetId },
              });
              if (moveCorrectionsFrom.length > 0) {
                await tx.correction.updateMany({
                  where: { transactionId: { in: moveCorrectionsFrom } },
                  data: { transactionId: created.id },
                });
              }
            }
            if (write.moveCorrectionsFrom && write.moveCorrectionsFrom.length > 0) {
              await tx.correction.updateMany({
                where: { transactionId: { in: write.moveCorrectionsFrom } },
                data: { transactionId: write.targetId },
              });
            }
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
