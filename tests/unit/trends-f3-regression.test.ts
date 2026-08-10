/**
 * O.18e-FU (TASKS, critic F3 of O.18e) — the executed F3 shape at engine
 * level, locked as DELIBERATE.
 *
 * The defect: a C.25 flow-excluded loan payment can appear in the /trends
 * "New this month" panel as spending while the pace card says loan payments
 * are not spending. The critic's fixture is reachable in the real data: a
 * loan merchant with old pairing history (2+ distinct months of ±3-day
 * same-amount pairs — the C.25 gate-2 evidence, re-derived from ALL rows,
 * whenever they happened) and a 6+ month gap. The gap clears the
 * NEW_MERCHANT_LOOKBACK_MONTHS window, so the resumed payment NAMES the
 * merchant "new" this month; the old pairs still make the row flow-excluded.
 *
 * The engine behavior — pace, movers and largest drop the row, the new-
 * merchant panel counts it — is the deliberate register basis of O.18e
 * (pass 2 sums what the activity list shows) and was NOT changed by this
 * slice; the fix is the COPY (see loan-payment-basis.test.ts). This test
 * locks the divergence so it stays a documented choice: a future slice that
 * excludes the flow set from pass 2 (the row's money direction) is then a
 * deliberate figure change, never a silent one.
 */
import { describe, expect, it } from 'vitest';
import { computeSpendingTrends, type TrendTxn } from '@/lib/engine/trends/trends';

const TODAY = '2026-06-10'; // asOf June; lookback = Dec 2025 – May 2026
const MTG = 'Mr Cooper';

const T = (
  date: string,
  amountCents: number,
  extra: Partial<TrendTxn> = {},
): TrendTxn => ({ date, amountCents, categoryId: 'dining', status: 'POSTED', ...extra });

describe('O.18e-FU — one loan payment, excluded from the totals, listed by the new-merchant panel', () => {
  it('the same excluded row: out of the pace and largest figures, IN the new-merchant panel (register basis)', () => {
    const txns = [
      T('2026-06-01', -621_707, { id: 'mtg-jun', merchant: MTG }),
      T('2026-06-03', -150_000, { id: 'rent-jun', merchant: 'Peachtree Properties' }),
    ];
    const r = computeSpendingTrends({
      txns,
      today: TODAY,
      scheduled: [],
      excludedFlowIds: new Set(['mtg-jun']),
      excludedLoanCanonicals: new Set([MTG.toLowerCase()]),
    });

    // Pace: the payment left the projection; the rent is the whole month so far.
    expect(r.pace).not.toBeNull();
    expect(r.pace!.spentSoFarCents).toBe(150_000);

    // Largest: the same exclusion.
    expect(r.largest.map((l) => l.merchant)).toEqual(['Peachtree Properties']);

    // New-merchant panel: the merchant IS new (nothing in the 6-month lookback),
    // and pass 2 counts the very row the totals dropped — the F3 shape.
    expect(r.newMerchants[0]!.merchant).toBe(MTG);
    expect(r.newMerchants[0]!.amountCents).toBe(621_707);
    expect(r.newMerchants[0]!.rows).toHaveLength(1);
    expect(r.newMerchants[0]!.rows[0]!.transactionId).toBe('mtg-jun');
  });

  it('anti-vacuity: without the exclusion the payment is in the pace total too', () => {
    const txns = [
      T('2026-06-01', -621_707, { id: 'mtg-jun', merchant: MTG }),
      T('2026-06-03', -150_000, { id: 'rent-jun', merchant: 'Peachtree Properties' }),
    ];
    const r = computeSpendingTrends({ txns, today: TODAY, scheduled: [] });
    expect(r.pace!.spentSoFarCents).toBe(771_707);
    expect(r.newMerchants[0]!.amountCents).toBe(621_707);
  });
});
