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
import type { Cadence } from '@/lib/engine/recurring/detect';
import { getRecurringOverrides } from '@/server/recurring-overrides';
import { overrideKey } from '@/lib/engine/recurring/override';

const CADENCES = new Set<Cadence>([
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
  'IRREGULAR',
]);

function asCadence(raw: string | null | undefined): Cadence | null {
  if (raw && CADENCES.has(raw as Cadence)) return raw as Cadence;
  return null;
}

export async function getRecurringBillMerchantCanonicals(
  userId: string,
): Promise<Set<string>> {
  const cadenceBy = await getRecurringOutflowCadences(userId);
  return new Set(cadenceBy.keys());
}

/**
 * Payee → cadence for outflow recurring series + BILL declarations.
 * Used by rule apply to refuse EXTRA OCCURRENCES when stamping Fixed/Discretionary
 * (utilities vary in amount; a second charge in the same month is the outlier).
 */
export async function getRecurringOutflowCadences(
  userId: string,
): Promise<Map<string, Cadence | null>> {
  const [series, verdicts] = await Promise.all([
    prisma.recurringSeries.findMany({
      where: { userId, typicalAmountCents: { lt: 0 } },
      select: { cadence: true, merchant: { select: { canonical: true } } },
    }),
    getRecurringOverrides(userId),
  ]);
  const out = new Map<string, Cadence | null>();
  for (const s of series) {
    out.set(overrideKey(s.merchant.canonical), asCadence(s.cadence));
  }
  for (const v of verdicts) {
    const key = overrideKey(v.merchantCanonical);
    if (v.decision === 'BILL') out.set(key, asCadence(v.cadence) ?? out.get(key) ?? 'MONTHLY');
    else out.delete(key);
  }
  return out;
}
