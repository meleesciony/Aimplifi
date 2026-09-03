/**
 * Household correction of the bank text a rule matches.
 *
 * The write is the row's rawDescriptor. After the write the same pipeline
 * ingest uses re-matches the row: a matching rule files it; a settled
 * category stays unless a rule now matches. Amount and date stay put.
 */
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';

export const MAX_TXN_DESCRIPTOR = 200;

export function txnDescriptorError(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return 'Enter the words the bank sent.';
  if (text.length > MAX_TXN_DESCRIPTOR) {
    return `Keep the bank text under ${MAX_TXN_DESCRIPTOR} characters.`;
  }
  return undefined;
}

export interface DescriptorRematchRow {
  isSplitParent: boolean;
  needsReview: boolean;
  categoryId: string | null;
  amountCents: number;
}

export interface DescriptorRematchVerdict {
  matchedRuleId: string | null;
  categoryId: string;
  needsReview: boolean;
}

function isUnsureRow(row: DescriptorRematchRow): boolean {
  return row.needsReview || (row.categoryId ?? 'uncategorized') === 'uncategorized';
}

/**
 * Whether to write the pipeline's category after a bank-text edit.
 *
 * A split container is never re-filed. A matching rule files — those are
 * the words a rule matches. Otherwise only an UNSURE row takes a confident
 * verdict, the same rail as backfill (never clobber a settled row with a
 * guess). The #44 inflow sign guard applies on the unsure path.
 */
export function shouldApplyRematchCategory(
  row: DescriptorRematchRow,
  out: DescriptorRematchVerdict,
): boolean {
  if (row.isSplitParent) return false;
  if (out.needsReview || out.categoryId === 'uncategorized') return false;
  if (out.matchedRuleId) return true;
  if (!isUnsureRow(row)) return false;
  const isIncomeGroup = CATEGORY_BY_ID.get(out.categoryId)?.group === 'Income';
  if (row.amountCents > 0 && !isIncomeGroup && out.categoryId !== 'transfer') {
    return false;
  }
  return true;
}
