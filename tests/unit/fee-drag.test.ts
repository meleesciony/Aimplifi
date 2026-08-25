/**
 * P1.5 — fee-drag pinned to docs/EDGE_CASES.md §Fee drag.
 */
import { describe, expect, it } from 'vitest';
import {
  FEE_DRAG_BPS,
  FEE_DRAG_MONTHS,
  feeDrag,
} from '@/lib/engine/fi/fee-drag';
import {
  OPPORTUNITY_HORIZON_MONTHS,
  opportunityFVCents,
  opportunityValueTodayCents,
  opportunityValueTrailsContributions,
} from '@/lib/engine/fi/fi';
import { cents } from '@/lib/money';

describe('feeDrag (EDGE_CASES §Fee drag)', () => {
  it('FD1: $100k at 0%/0% — level 1% leak is $83.33/mo × 360', () => {
    const drag = feeDrag({
      portfolioCents: cents(10_000_000),
      nominalReturnBps: 0,
      inflationBps: 0,
    });
    expect(drag).not.toBeNull();
    expect(drag!.feeBps).toBe(100);
    expect(drag!.months).toBe(360);
    expect(drag!.monthlyLeakCents).toBe(8_333);
    expect(drag!.costNominalCents).toBe(2_999_880);
    expect(drag!.costTodayCents).toBe(2_999_880);
  });

  it('FD2: zero portfolio is an honest null', () => {
    expect(
      feeDrag({
        portfolioCents: cents(0),
        nominalReturnBps: 700,
        inflationBps: 250,
      }),
    ).toBeNull();
  });

  it('FD3: zero fee is an honest null', () => {
    expect(
      feeDrag({
        portfolioCents: cents(10_000_000),
        nominalReturnBps: 700,
        inflationBps: 250,
        feeBps: 0,
      }),
    ).toBeNull();
  });

  it('FD4: a leak that rounds to $0.00 is an honest null', () => {
    expect(
      feeDrag({
        portfolioCents: cents(50),
        nominalReturnBps: 700,
        inflationBps: 250,
      }),
    ).toBeNull();
  });

  it('FD5: reuses opportunityFVCents / opportunityValueTodayCents exactly', () => {
    const drag = feeDrag({
      portfolioCents: cents(10_000_000),
      nominalReturnBps: 700,
      inflationBps: 250,
    });
    expect(drag).not.toBeNull();
    expect(drag!.costNominalCents).toBe(
      opportunityFVCents(drag!.monthlyLeakCents, drag!.months, 700),
    );
    expect(drag!.costTodayCents).toBe(
      opportunityValueTodayCents(drag!.monthlyLeakCents, drag!.months, 700, 250),
    );
  });

  it('FD6: demo $142k at 7.00%/2.50% — monthly $118.33, today-money from the primitive', () => {
    const drag = feeDrag({
      portfolioCents: cents(14_200_000),
      nominalReturnBps: 700,
      inflationBps: 250,
    });
    expect(drag).not.toBeNull();
    expect(drag!.monthlyLeakCents).toBe(11_833);
    expect(drag!.costTodayCents).toBe(
      opportunityValueTodayCents(cents(11_833), 360, 700, 250),
    );
    expect(drag!.costNominalCents).toBe(opportunityFVCents(cents(11_833), 360, 700));
  });

  it('horizon and fee defaults are the opportunity 30-year / 1%', () => {
    expect(FEE_DRAG_MONTHS).toBe(360);
    expect(FEE_DRAG_MONTHS).toBe(OPPORTUNITY_HORIZON_MONTHS[2]);
    expect(FEE_DRAG_BPS).toBe(100);
  });

  it('demo 7.00%/2.50% does not trail; equal 2.50%/2.50% does', () => {
    expect(opportunityValueTrailsContributions(360, 700, 250)).toBe(false);
    expect(opportunityValueTrailsContributions(360, 250, 250)).toBe(true);
  });
});
