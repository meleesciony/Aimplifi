/**
 * O.20j converse-leak measurement (DECISIONS #487).
 *
 * Shape (named in #446, still OPEN after #485/#486): a row with
 * `isTransfer=true` under a real spend category vanishes from BOTH
 * `countsInFlows` and `isSpendRow` — identical exclusion, so basis-gap
 * probes cannot see the undercount.
 *
 * WHY THIS MODULE DOES NOT FIX THE PREDICATE. Overturns write
 * `isTransfer: true` and KEEP the competing spend category
 * (`transfer-refresh.ts` overturnIds). Ignoring the flag whenever
 * `categoryId` is a spend leaf would re-admit genuine account-to-account
 * moves into every spend total. The false-positive subset (today's rule
 * declines the flag) is already the H.7b repair's job — owner-triggered,
 * previewed, undoable — not a silent spend-basis rewrite.
 *
 * This helper sizes a fixture corpus into vanished / clearable / endorsed
 * partitions so a future live probe and the owner can see the dollars
 * without inventing a product call.
 */
import { countsInFlows } from '@/lib/engine/fi/insights';
import { isSpendRow, type ReportTxn } from '@/lib/engine/reports/reports';
import { isIncomeCategoryId } from './categories';
import { planTransferUpdates } from './transfers';
import {
  planTransferFlagRepair,
  type TransferFlagRepairRow,
} from './transfer-flag-repair';

/** One corpus row: spend-predicate fields plus the repair planner's shape. */
export interface ConverseLeakRow extends TransferFlagRepairRow {
  /** Required for isSpendRow's window check (YYYY-MM-DD). */
  date: string;
  isSplitParent?: boolean;
  excludeFromTotals?: boolean;
}

export interface ConverseLeakCategoryBucket {
  categoryId: string;
  rowCount: number;
  /** Absolute cents on outflows (spend-shaped) in this bucket. */
  outflowCents: number;
  /** Absolute cents on inflows in this bucket. */
  inflowCents: number;
}

export interface ConverseLeakMeasure {
  /** Flagged under a non-transfer, non-income category — excluded by both predicates. */
  vanishedIds: string[];
  vanishedOutflowCents: number;
  vanishedInflowCents: number;
  byCategory: ConverseLeakCategoryBucket[];
  /**
   * Subset H.7b would clear: today's `planTransferUpdates` declines the flag
   * and the row is in repair scope. Restoring these to totals is the owner
   * repair's claim — not a predicate change.
   */
  clearableIds: string[];
  clearableOutflowCents: number;
  clearableInflowCents: number;
  /**
   * Subset H.7b endorses: evidenced transfer that kept a spend category
   * (overturn). Must stay out of spend — a "spend category overrides flag"
   * rule would wrongly restore these cents.
   */
  endorsedIds: string[];
  endorsedOutflowCents: number;
  endorsedInflowCents: number;
  /**
   * Flagged spend-category rows today's rule declines but H.7b will not touch
   * (pinned / pending / non-USD / reader-excluded). Named so a zero clearable
   * count is not mistaken for "no leak."
   */
  declinedOutOfScopeIds: string[];
}

function asFlowTxn(t: ConverseLeakRow) {
  return {
    id: t.id,
    date: t.date,
    amountCents: t.amountCents,
    categoryId: t.categoryId,
    isTransfer: t.isTransfer,
    status: t.status,
    isSplitParent: t.isSplitParent ?? false,
    excludeFromTotals: t.excludeFromTotals ?? false,
    rawDescriptor: t.rawDescriptor,
    accountId: t.accountId,
  };
}

function asReportTxn(t: ConverseLeakRow): ReportTxn {
  return {
    id: t.id,
    date: t.date,
    amountCents: t.amountCents,
    categoryId: t.categoryId,
    isTransfer: t.isTransfer,
    isSplitParent: t.isSplitParent ?? false,
    excludeFromTotals: t.excludeFromTotals ?? false,
    accountId: t.accountId,
  };
}

/**
 * A spend-category row counted as the converse leak: flagged transfer, not
 * the transfer leaf, not Income-group (income undercount is a sibling harm
 * H.7b already names separately).
 */
export function isConverseSpendLeakRow(t: ConverseLeakRow): boolean {
  if (!t.isTransfer) return false;
  if (t.categoryId === null || t.categoryId === 'transfer') return false;
  if (isIncomeCategoryId(t.categoryId)) return false;
  // Must be a row both shared bases refuse *because of the flag* — i.e. it
  // would otherwise be in-window spend. POSTED / not split / not excluded.
  if (t.status !== 'POSTED' || t.isSplitParent || t.excludeFromTotals) return false;
  return true;
}

/**
 * Size the converse leak on a fixture (or live) corpus. Does not write.
 * Partition uses the shipped H.7b planner so clearable ⇔ repair preview.
 */
export function measureConverseTransferLeak(
  transactions: readonly ConverseLeakRow[],
  spendWindow: { fromYm: string; toYm: string } = { fromYm: '1900-01', toYm: '2999-12' },
): ConverseLeakMeasure {
  const vanished = transactions.filter(isConverseSpendLeakRow);

  // Lock the dual-exclusion invariant on every vanished row: both predicates
  // refuse it, and clearing only the flag (not the category) would admit it.
  for (const t of vanished) {
    const flow = asFlowTxn(t);
    const report = asReportTxn(t);
    if (countsInFlows(flow) || isSpendRow(report, spendWindow)) {
      throw new Error(
        `converse-leak invariant broken for ${t.id}: a flagged spend-category row must be refused by both bases`,
      );
    }
    const unflagged = { ...flow, isTransfer: false };
    const unflaggedReport = { ...report, isTransfer: false };
    if (!countsInFlows(unflagged) || !isSpendRow(unflaggedReport, spendWindow)) {
      throw new Error(
        `converse-leak invariant broken for ${t.id}: unflagging alone must restore both bases`,
      );
    }
  }

  const byCat = new Map<string, ConverseLeakCategoryBucket>();
  let vanishedOutflowCents = 0;
  let vanishedInflowCents = 0;
  for (const t of vanished) {
    const id = t.categoryId!;
    const bucket = byCat.get(id) ?? { categoryId: id, rowCount: 0, outflowCents: 0, inflowCents: 0 };
    bucket.rowCount += 1;
    if (t.amountCents < 0) {
      const c = -t.amountCents;
      bucket.outflowCents += c;
      vanishedOutflowCents += c;
    } else {
      bucket.inflowCents += t.amountCents;
      vanishedInflowCents += t.amountCents;
    }
    byCat.set(id, bucket);
  }

  // Same replay H.7b uses: clear flags, ask today's rule which ids it would
  // still mark. Endorsed ⇔ wouldFlagNow; clearable ⇔ repair.clearIds.
  const fromScratch = planTransferUpdates(transactions.map((t) => ({ ...t, isTransfer: false })));
  const wouldFlagNow = new Set([...fromScratch.flagIds, ...fromScratch.overturnIds]);
  const plan = planTransferFlagRepair(transactions);
  const clearableSet = new Set(plan.clearIds);

  const vanishedIds = vanished.map((t) => t.id);
  const vanishedSet = new Set(vanishedIds);
  const clearableIds = plan.clearIds.filter((id) => vanishedSet.has(id));
  const endorsedIds = vanishedIds.filter((id) => wouldFlagNow.has(id));
  const declinedOutOfScopeIds = vanishedIds.filter(
    (id) => !wouldFlagNow.has(id) && !clearableSet.has(id),
  );

  const centsFor = (ids: string[]) => {
    let out = 0;
    let inn = 0;
    const set = new Set(ids);
    for (const t of vanished) {
      if (!set.has(t.id)) continue;
      if (t.amountCents < 0) out += -t.amountCents;
      else inn += t.amountCents;
    }
    return { out, inn };
  };
  const clearable = centsFor(clearableIds);
  const endorsed = centsFor(endorsedIds);

  return {
    vanishedIds,
    vanishedOutflowCents,
    vanishedInflowCents,
    byCategory: [...byCat.values()].sort(
      (a, b) => b.rowCount - a.rowCount || a.categoryId.localeCompare(b.categoryId),
    ),
    clearableIds,
    clearableOutflowCents: clearable.out,
    clearableInflowCents: clearable.inn,
    endorsedIds,
    endorsedOutflowCents: endorsed.out,
    endorsedInflowCents: endorsed.inn,
    declinedOutOfScopeIds,
  };
}
