/**
 * The canonical payees the spend-class guess treats as recurring bills
 * (DECISIONS #397: "a good guess is start with all recurring items — most of
 * those are fixed").
 *
 * ONE definition for the register, the transaction detail view and the
 * spending plan, so no two surfaces can guess the same row differently (the
 * L.30 one-writer rule).
 *
 * Sources: the user's stored OUTFLOW recurring series (`typicalAmountCents`
 * is signed — expenses are negative, an income deposit is not a bill), plus
 * declared BILL verdicts, minus NOT_BILL verdicts (later verdict wins, read
 * in created-at order). Keys are `overrideKey`-normalized — the same case-
 * and width-insensitive matching the verdict system itself uses, because
 * `Merchant.canonical` can hold case variants (the O.13c residual).
 */
import { prisma } from '@/lib/db';
import { getRecurringOverrides } from '@/server/recurring-overrides';
import { overrideKey } from '@/lib/engine/recurring/override';

export async function getRecurringBillMerchantCanonicals(
  userId: string,
): Promise<Set<string>> {
  const [series, verdicts] = await Promise.all([
    prisma.recurringSeries.findMany({
      where: { userId, typicalAmountCents: { lt: 0 } },
      select: { merchant: { select: { canonical: true } } },
    }),
    getRecurringOverrides(userId),
  ]);
  const out = new Set(series.map((s) => overrideKey(s.merchant.canonical)));
  for (const v of verdicts) {
    if (v.decision === 'BILL') out.add(overrideKey(v.merchantCanonical));
    else out.delete(overrideKey(v.merchantCanonical));
  }
  return out;
}
