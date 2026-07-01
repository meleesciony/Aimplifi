/**
 * Pure preparation + validation for a manually-entered transaction (cash, a
 * check, or anything a feed didn't capture). No I/O — the server action calls
 * this, then persists the result. Unit-tested without a database.
 *
 * Money sign convention (src/lib/money.ts): outflow negative, inflow positive.
 * A manual entry records ACTIVITY; it does NOT rewrite an account's reported
 * balance (balances are provider-authoritative — see docs/DECISIONS.md).
 */
import { isoDate } from '@/lib/dates';
import { centsFromDollarString } from '@/lib/money';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { type RuleLike, categorize } from '@/lib/engine/categorize/pipeline';

export interface ManualTxnInput {
  descriptor: string;
  /** Positive dollar magnitude as typed ("12.50", "$1,200", "80"). */
  amount: string;
  direction: 'out' | 'in';
  date: string; // YYYY-MM-DD
  accountId: string;
  /** Explicit category slug, or null/empty to auto-categorize. */
  categoryId?: string | null;
}

export interface PreparedTxn {
  accountId: string;
  date: string;
  amountCents: number; // signed
  rawDescriptor: string;
  categoryId: string;
  confidenceBps: number;
  needsReview: boolean;
  isTransfer: boolean;
  status: 'POSTED';
}

const NO_EXTRA_IDS: ReadonlySet<string> = new Set();

export function prepareManualTransaction(
  input: ManualTxnInput,
  rules: readonly RuleLike[] = [],
  /**
   * Category ids valid BEYOND the system set — the caller-verified custom
   * categories this user owns (per-user cuids the static CATEGORY_BY_ID can't
   * know). The server action passes only ids it has already run through
   * assertOwnedCategory, so defense in depth is preserved (regression #136).
   */
  extraValidCategoryIds: ReadonlySet<string> = NO_EXTRA_IDS,
): PreparedTxn {
  const descriptor = input.descriptor.trim();
  if (!descriptor) throw new Error('Description is required');
  if (!input.accountId) throw new Error('Account is required');
  if (input.direction !== 'in' && input.direction !== 'out') {
    throw new Error('Direction must be "in" or "out"');
  }

  const date = isoDate(input.date); // throws on malformed/invalid calendar date

  // Strip currency formatting before the exact (float-free) cents parse.
  const cleaned = input.amount.replace(/[$,\s]/g, '');
  const magnitude = centsFromDollarString(cleaned); // throws on malformed input
  if (magnitude <= 0) throw new Error('Amount must be greater than zero');
  const amountCents = input.direction === 'in' ? magnitude : -magnitude;

  // An explicit category is authoritative (no review needed). Reject ids that
  // are neither system categories nor caller-verified customs (defense in
  // depth — the form only offers valid ones).
  const explicit = input.categoryId?.trim();
  if (explicit && !CATEGORY_BY_ID.has(explicit) && !extraValidCategoryIds.has(explicit)) {
    throw new Error(`Unknown category "${explicit}"`);
  }
  if (explicit) {
    return {
      accountId: input.accountId,
      date,
      amountCents,
      rawDescriptor: descriptor,
      categoryId: explicit,
      confidenceBps: 10000,
      needsReview: false,
      isTransfer: explicit === 'transfer',
      status: 'POSTED',
    };
  }

  // Otherwise run the same categorization pipeline as ingested transactions,
  // so a low-confidence guess lands in the triage inbox like any other.
  const result = categorize(
    { rawDescriptor: descriptor, amountCents, date, accountId: input.accountId },
    rules,
  );
  return {
    accountId: input.accountId,
    date,
    amountCents,
    rawDescriptor: descriptor,
    categoryId: result.categoryId,
    confidenceBps: result.confidenceBps,
    needsReview: result.needsReview,
    isTransfer: result.source === 'transfer',
    status: 'POSTED',
  };
}
