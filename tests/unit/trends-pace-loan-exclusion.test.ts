/**
 * C.25 critic P1-1 (#403) — the pace projection must not read a carried-
 * elsewhere loan payment through ONE half of its basis and not the other.
 *
 * The defect, executed by the critic: `spentSoFar` applied the flow
 * exclusion while the bill credit (`billsThisMonth`) still admitted the
 * scheduled loan payment and credited its posted charge — so the payment
 * left the month total and was ALSO subtracted again as a bill credit (the
 * under-projection this file's C.2 comment names the dangerous direction),
 * or crossed the bases and extrapolated unrelated spending across the whole
 * remaining month. The fix drops the excluded merchant from the bill basis
 * ENTIRELY — still-due and posted credit leave together.
 *
 * Hand-verified values in docs/EDGE_CASES.md style, computed here:
 *
 *  Fixture 1 (Aug 4, dim 31, 4 elapsed / 27 left):
 *    excluded:  spentSoFar 150000 (rent), no bills admitted →
 *               150000 + round(150000×27/4) = 150000 + 1012500 = 1,162,500
 *    control :  spentSoFar 771707, credited 621707 → discretionary 150000 →
 *               771707 + 1012500 = 1,784,207
 *  Fixture 2 (Aug 28, 28 elapsed / 3 left — the double-subtraction shape):
 *    excluded:  spentSoFar 950000, rent credit 150000 → discretionary 800000 →
 *               950000 + round(800000×3/28) = 950000 + 85714 = 1,035,714
 */
import { describe, expect, it } from 'vitest';
import { computeSpendingTrends, type TrendTxn } from '@/lib/engine/trends/trends';

function txn(t: {
  id: string;
  date: string;
  amountCents: number;
  merchant: string;
}): TrendTxn {
  return {
    ...t,
    categoryId: null,
    isTransfer: false,
    isSplitParent: false,
    excludeFromTotals: false,
    status: 'POSTED',
  };
}

const MTG_CANONICAL = 'Truist Mortg Olb Mtgpmt';

describe('C.25 critic P1-1 — pace and the carried-elsewhere loan payment', () => {
  it('early month: the excluded payment leaves BOTH halves of the bill basis', () => {
    const txns = [
      txn({ id: 'mtg-aug', date: '2026-08-01', amountCents: -621_707, merchant: MTG_CANONICAL }),
      txn({ id: 'rent-aug', date: '2026-08-01', amountCents: -150_000, merchant: 'Peachtree Properties' }),
    ];
    const scheduled = [
      { description: MTG_CANONICAL, amountCents: -621_707, nextDate: '2026-09-01', cadence: 'MONTHLY' },
    ];
    const withExclusion = computeSpendingTrends({
      txns,
      today: '2026-08-04',
      scheduled,
      excludedFlowIds: new Set(['mtg-aug']),
      excludedLoanCanonicals: new Set([MTG_CANONICAL]),
    });
    expect(withExclusion.pace).not.toBeNull();
    expect(withExclusion.pace!.spentSoFarCents).toBe(150_000); // mortgage out of the total
    expect(withExclusion.pace!.billsStillDueCents).toBe(0); // and out of the bill basis
    expect(withExclusion.pace!.projectedCents).toBe(1_162_500);

    // Control — no exclusion anywhere (pre-C.25 world): the payment is in
    // the total AND credited as a bill. Different figure, self-consistent.
    const control = computeSpendingTrends({ txns, today: '2026-08-04', scheduled });
    expect(control.pace!.spentSoFarCents).toBe(771_707);
    expect(control.pace!.projectedCents).toBe(1_784_207);
  });

  it('late month: no double subtraction of the excluded payment (the dangerous direction)', () => {
    const txns = [
      txn({ id: 'mtg-aug', date: '2026-08-01', amountCents: -621_707, merchant: MTG_CANONICAL }),
      txn({ id: 'rent-aug', date: '2026-08-01', amountCents: -150_000, merchant: 'Peachtree Properties' }),
      txn({ id: 'extra', date: '2026-08-15', amountCents: -800_000, merchant: 'Extra Store' }),
    ];
    const scheduled = [
      { description: MTG_CANONICAL, amountCents: -621_707, nextDate: '2026-09-01', cadence: 'MONTHLY' },
      { description: 'Peachtree Properties', amountCents: -150_000, nextDate: '2026-09-01', cadence: 'MONTHLY' },
    ];
    const withExclusion = computeSpendingTrends({
      txns,
      today: '2026-08-28',
      scheduled,
      excludedFlowIds: new Set(['mtg-aug']),
      excludedLoanCanonicals: new Set([MTG_CANONICAL]),
    });
    // The rent credit is legitimate (rent IS in the total); the mortgage
    // credit would subtract money that the exclusion already removed.
    expect(withExclusion.pace!.spentSoFarCents).toBe(950_000);
    expect(withExclusion.pace!.projectedCents).toBe(1_035_714);
  });
});
