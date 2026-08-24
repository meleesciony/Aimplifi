/**
 * P.1 counterfactual re-projection — the pure FI delta behind "what should I
 * cut?" (src/lib/engine/fi/counterfactual.ts).
 *
 * The headline anchors are hand-computed at a 0% return so the arithmetic is
 * exact (the fi.ts convention: degenerate-rate anchors first, then a real-rate
 * pin that recomputes through `monthsToFI` itself). Non-vacuity is asserted
 * the fi-real-basis way: the dual-effect result must differ from the
 * savings-only recompute, so the target-drop half cannot silently revert.
 */
import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { getCoachData } from '@/server/coach';
import { monthsToFI } from '@/lib/engine/fi/fi';
import {
  cutCounterfactual,
  sumCutMonthlyCents,
} from '@/lib/engine/fi/counterfactual';
import type { Opportunity } from '@/lib/engine/fi/insights';

// $100k invested, $2,000/mo saved, $36,000/yr of spending at a 4% SWR → a
// $900,000 FI number. Hand-computed anchors below are at a 0% real return.
const BASE = {
  portfolioCents: cents(10_000_000),
  monthlySavingsCents: cents(200_000),
  annualExpensesCents: cents(3_600_000),
  realReturnBps: 0,
  swrBps: 400,
} as const;

function opportunity(over: Partial<Omit<Opportunity, 'monthlyCents'>> & { merchant: string; monthlyCents: number }): Opportunity {
  return {
    kind: 'unused-subscription',
    todayValue10Cents: cents(0),
    todayValue20Cents: cents(0),
    todayValue30Cents: cents(0),
    isEstimate: false,
    ...over,
    monthlyCents: cents(over.monthlyCents),
  };
}

describe('cutCounterfactual — hand-computed anchors (0% real return)', () => {
  it('the standing basis itself: $900,000 target, 400 months', () => {
    const r = cutCounterfactual({ ...BASE, cutMonthlyCents: cents(0) });
    expect(r.baselineFiTargetCents).toBe(90_000_000);
    // ($900,000 − $100,000) ÷ $2,000/mo = 400 months exactly.
    expect(r.baselineMonths).toBe(400);
    expect(r.cutMonths).toBe(400);
    expect(r.monthsSooner).toBe(0);
    expect(r.newlyReachable).toBe(false);
    expect(r.targetDropCents).toBe(0);
  });

  it('a $100/mo cut: target drops $30,000 (the 25× rule), FI arrives 33 months sooner', () => {
    const r = cutCounterfactual({ ...BASE, cutMonthlyCents: cents(10_000) });
    // Target half: $36,000 − $1,200 = $34,800/yr → $870,000. Drop = $30,000 = 300 × the monthly cut.
    expect(r.cutFiTargetCents).toBe(87_000_000);
    expect(r.targetDropCents).toBe(3_000_000);
    // Pace half: ($870,000 − $100,000) ÷ $2,100/mo = 366.67 → 367 months.
    expect(r.cutMonths).toBe(367);
    expect(r.monthsSooner).toBe(400 - 367);
    expect(r.newlyReachable).toBe(false);

    // Non-vacuity: moving only the SAVINGS half (the slider's move) gives 381
    // months — a different, smaller delta. If the target-drop half silently
    // reverted, the pin above would land on this number instead.
    const savingsOnly = monthsToFI(
      BASE.portfolioCents,
      cents(210_000),
      0,
      cents(90_000_000),
    );
    expect(savingsOnly).toBe(381);
    expect(r.cutMonths).not.toBe(savingsOnly);
  });

  it('compounds at the real rate it is handed, untouched', () => {
    const r = cutCounterfactual({ ...BASE, realReturnBps: 450, cutMonthlyCents: cents(10_000) });
    expect(r.baselineMonths).toBe(
      monthsToFI(BASE.portfolioCents, BASE.monthlySavingsCents, 450, cents(90_000_000)),
    );
    expect(r.cutMonths).toBe(
      monthsToFI(BASE.portfolioCents, cents(210_000), 450, cents(87_000_000)),
    );
    expect(r.monthsSooner).toBe(r.baselineMonths! - r.cutMonths!);
    // And the walk is long enough here that the rate actually moves the answer
    // (a same-months coincidence would make the pins above theatre).
    expect(r.baselineMonths).not.toBe(400);
  });
});

describe('cutCounterfactual — the honest nulls', () => {
  it('already FI: nothing to move, and no "sooner" claim', () => {
    const r = cutCounterfactual({
      ...BASE,
      portfolioCents: cents(90_000_000),
      cutMonthlyCents: cents(10_000),
    });
    expect(r.baselineMonths).toBe(0);
    expect(r.cutMonths).toBe(0);
    expect(r.monthsSooner).toBe(0);
    expect(r.newlyReachable).toBe(false);
  });

  it('unreachable → reachable is its own fact, not a month delta', () => {
    // $100/mo saved against a $900,000 target at 0% needs 9,000 months — past
    // the 100-year cap. An $800/mo cut drops the target to $660,000 and raises
    // savings to $900/mo: 733.33 → 734 months, inside the cap.
    const r = cutCounterfactual({
      ...BASE,
      portfolioCents: cents(0),
      monthlySavingsCents: cents(10_000),
      cutMonthlyCents: cents(80_000),
    });
    expect(r.baselineMonths).toBeNull();
    expect(r.cutMonths).toBe(734);
    expect(r.newlyReachable).toBe(true);
    expect(r.monthsSooner).toBe(0); // no baseline date exists to subtract
    expect(r.targetDropCents).toBe(24_000_000);
  });

  it('unreachable → still unreachable: both null, nothing claimed', () => {
    const r = cutCounterfactual({
      ...BASE,
      portfolioCents: cents(0),
      monthlySavingsCents: cents(10_000),
      cutMonthlyCents: cents(1_000),
    });
    expect(r.baselineMonths).toBeNull();
    expect(r.cutMonths).toBeNull();
    expect(r.newlyReachable).toBe(false);
    expect(r.monthsSooner).toBe(0);
  });

  it('a cut larger than the whole expense basis floors the target at $0, never negative', () => {
    const r = cutCounterfactual({ ...BASE, cutMonthlyCents: cents(400_000) });
    expect(r.cutFiTargetCents).toBe(0);
    expect(r.cutMonths).toBe(0); // any portfolio is already past a $0 target
    expect(r.targetDropCents).toBe(90_000_000);
  });
});

describe('cutCounterfactual — a cut can never delay FI', () => {
  it.each([
    { realReturnBps: 0, cut: 5_000 },
    { realReturnBps: 450, cut: 10_000 },
    { realReturnBps: 700, cut: 25_000 },
    { realReturnBps: 100, cut: 100_000 },
  ])(
    'monthsSooner ≥ 0 and targetDrop ≥ 0 at %o',
    ({ realReturnBps, cut }) => {
      const r = cutCounterfactual({
        ...BASE,
        realReturnBps,
        cutMonthlyCents: cents(cut),
      });
      expect(r.monthsSooner).toBeGreaterThanOrEqual(0);
      expect(r.targetDropCents).toBeGreaterThanOrEqual(0);
      if (r.baselineMonths !== null && r.cutMonths !== null) {
        expect(r.cutMonths).toBeLessThanOrEqual(r.baselineMonths);
      }
    },
  );
});

describe('sumCutMonthlyCents — one merchant, one saving', () => {
  it('sums distinct merchants', () => {
    const total = sumCutMonthlyCents([
      opportunity({ merchant: 'LA Fitness', monthlyCents: 3499 }),
      opportunity({ merchant: 'Comcast', monthlyCents: 2000, kind: 'negotiable-bill', isEstimate: true }),
    ]);
    expect(total).toBe(5499);
  });

  it('a merchant whose price rose AND looks unused contributes its largest row once, not the sum', () => {
    // Cancelling saves the full $34.99 — not $34.99 + the $2.50 increase.
    const total = sumCutMonthlyCents([
      opportunity({ merchant: 'LA Fitness', monthlyCents: 3499 }),
      opportunity({ merchant: 'LA Fitness', monthlyCents: 250, kind: 'price-increase' }),
    ]);
    expect(total).toBe(3499);
  });

  it('the dedupe is by merchant, so the order of the rows cannot matter', () => {
    const rows = [
      opportunity({ merchant: 'LA Fitness', monthlyCents: 250, kind: 'price-increase' }),
      opportunity({ merchant: 'LA Fitness', monthlyCents: 3499 }),
    ];
    expect(sumCutMonthlyCents(rows)).toBe(3499);
    expect(sumCutMonthlyCents([...rows].reverse())).toBe(3499);
  });

  it('empty list → 0 (the caller treats 0 as "no counterfactual to run")', () => {
    expect(sumCutMonthlyCents([])).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe('the demo wiring — the counterfactual runs on the SAME basis the FI card prints', () => {
  it('baseline and target agree with getCoachData, and the demo genuinely moves', async () => {
    const d = await getCoachData(DEMO_USER_ID);
    const cut = sumCutMonthlyCents(d.opportunities);
    expect(cut).toBeGreaterThan(0); // the demo HAS opportunities (LA Fitness first)

    const r = cutCounterfactual({
      portfolioCents: d.fi.portfolioCents,
      monthlySavingsCents: d.fi.monthlySavingsCents,
      annualExpensesCents: d.fi.annualExpensesCents,
      realReturnBps: d.fi.projectionReturnBps,
      swrBps: d.fi.swrBps,
      cutMonthlyCents: cut,
    });

    // The counterfactual's standing side IS the card's standing figure — if a
    // coach.ts refactor re-based the FI card, this pair of assertions is what
    // keeps the Ask sentence describing the same walk.
    expect(r.baselineFiTargetCents).toBe(d.fi.fiNumberCents);
    expect(r.baselineMonths).toBe(d.fi.monthsToFI);

    // The demo must actually MOVE — the Ask e2e asserts the movement sentence,
    // so a silent demo counterfactual fails here first, with numbers.
    expect(r.newlyReachable || r.monthsSooner > 0).toBe(true);

    // Non-vacuity: a savings-only recompute (target unmoved) disagrees, so the
    // dual-effect wiring cannot silently revert to the slider's move.
    const savingsOnly = monthsToFI(
      d.fi.portfolioCents,
      cents(d.fi.monthlySavingsCents + cut),
      d.fi.projectionReturnBps,
      d.fi.fiNumberCents,
    );
    expect(r.cutMonths).not.toBe(savingsOnly);
  });
});
