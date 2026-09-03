/**
 * The one rule for "what do we call this transaction's payee".
 *
 * `Merchant.canonical` first, the normalizer's reading of the bank text second.
 * The order is the whole point and it is not a tie-break: a keyword rule's
 * `renameTo` WRITES `Merchant.canonical` (O.13a, `server/keyword-rules.ts`), so
 * the joined row is where a reader's own name for a payee lives, and falling
 * back to `normalizeMerchant(rawDescriptor)` when a join exists would show them
 * the guess at the bank text they had deliberately replaced.
 *
 * It became a function during O.18. Before that the expression was written out
 * at six call sites — three in `server/transactions.ts` (the register list, a
 * reimbursement match, the detail view) and three new ones feeding the category
 * breakdown panels. Six copies of a two-branch rule is exactly the shape
 * `dedup-must-diff-the-copies-first` is about, and the new copies were the
 * dangerous ones: they render the SAME transaction as the register does, one tap
 * apart, so any drift between them shows up as one charge with two names on two
 * screens.
 *
 * The rule was also untestable while it was six expressions. It has one live
 * consequence that no fixture in the repo exercised — the demo seed's every
 * merchant canonical happens to equal the normalizer's output, so deleting the
 * first branch entirely was invisible to the whole suite (measured: 847 of 847
 * rows identical). Now it has a test.
 *
 * Pure: no I/O. The `merchant` shape is deliberately structural rather than the
 * Prisma type, so an engine fixture can build one.
 */
import { normalizeMerchant, stripPayeeNoise } from '@/lib/engine/categorize/normalize';
import { MAX_PAYEE_KEY } from '@/lib/engine/transactions/payee-rename';

export interface DisplayNameSource {
  /** The joined merchant row, when the transaction has one. */
  merchant?: { canonical: string } | null;
  /** The bank's own text. */
  rawDescriptor: string;
}

/** Stable identity for a payee overlay. Join first; bank text if no merchant. */
export function payeeRenameKey(t: DisplayNameSource): string {
  const fromJoin = t.merchant?.canonical?.trim();
  if (fromJoin) return fromJoin.slice(0, MAX_PAYEE_KEY);
  return normalizeMerchant(t.rawDescriptor).canonical.slice(0, MAX_PAYEE_KEY);
}

export function registerDisplayName(
  t: DisplayNameSource,
  names?: ReadonlyMap<string, string>,
): string {
  const overlay = names?.get(payeeRenameKey(t))?.trim();
  if (overlay) return overlay;
  const base = t.merchant?.canonical ?? normalizeMerchant(t.rawDescriptor).canonical;
  // Bank-noise tokens are not a rename (O.13a). Strip them on the way to the
  // register so a persisted dirty canonical still reads as a payee. A reader's
  // overlay above is their own words — never stripped.
  return stripPayeeNoise(base) || base;
}
