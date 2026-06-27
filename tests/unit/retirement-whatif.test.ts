/**
 * Retirement what-if reducers (DECISIONS #123) — the safety-critical client logic behind
 * the /investments explorer, extracted to a pure module so it is testable without a DOM.
 * The load-bearing claim (Hostile Critic F1): for ANY sequence of user edits — including
 * cleared fields, NaN, out-of-range, decimals, and retire>end — the resulting plan stays
 * engine-valid (currentAge ≤ retirementAge < endAge ≤ 120, whole years, inflation 0–10%),
 * so projectRetirement never throws and the displayed inputs equal the projected ones.
 */
import { describe, expect, it } from 'vitest';
import {
  type WhatIfPlan,
  clampInt,
  endRange,
  retireRange,
  setEnd,
  setInflationPercent,
  setRetirement,
} from '@/lib/engine/investments/retirement-whatif';
import { DIAL_LIMITS } from '@/lib/engine/settings/dials';
import { buildRetirementInputs, projectRetirement } from '@/lib/engine/investments/retirement';

const SAVED: WhatIfPlan = { retirementAge: 65, endAge: 95, inflationBps: 250 };
const CURRENT = 40;
const BASE = {
  currentPortfolioCents: 14_200_000,
  monthlyContributionCents: 120_000,
  annualRetirementSpendingCents: 6_000_000,
  nominalReturnBps: 700,
  swrBps: 400,
};

/** The exact invariant projectRetirement requires (plus our persistable inflation bound). */
const valid = (plan: WhatIfPlan, currentAge: number): boolean =>
  Number.isInteger(plan.retirementAge) &&
  Number.isInteger(plan.endAge) &&
  Number.isInteger(plan.inflationBps) &&
  currentAge <= plan.retirementAge &&
  plan.retirementAge < plan.endAge &&
  plan.endAge <= DIAL_LIMITS.endAge.max &&
  plan.inflationBps >= DIAL_LIMITS.inflationBps.min &&
  plan.inflationBps <= DIAL_LIMITS.inflationBps.max;

describe('clampInt', () => {
  it('rounds then clamps into [lo, hi]', () => {
    expect(clampInt(5.4, 0, 10)).toBe(5);
    expect(clampInt(5.5, 0, 10)).toBe(6);
    expect(clampInt(-3, 0, 10)).toBe(0);
    expect(clampInt(99, 0, 10)).toBe(10);
  });
  it('snaps a non-finite value (cleared field / NaN / Infinity) to lo; a finite huge value clamps to hi', () => {
    expect(clampInt(NaN, 40, 119)).toBe(40);
    expect(clampInt(Infinity, 0, 1000)).toBe(0); // non-finite → lo (the safe default)
    expect(clampInt(1e9, 0, 1000)).toBe(1000); // a finite huge value clamps to hi normally
    expect(clampInt(Number(''), 40, 119)).toBe(40); // Number('') === 0 → below lo → 40
  });
});

describe('range helpers track the persistable bounds', () => {
  it('retire is floored at the current age, capped at the validator max', () => {
    expect(retireRange(40)).toEqual({ min: 40, max: DIAL_LIMITS.retirementAge.max });
  });
  it('end is at least one year past retirement', () => {
    expect(endRange(65)).toEqual({ min: 66, max: DIAL_LIMITS.endAge.max });
  });
});

describe('setRetirement — clamps and bumps the end age', () => {
  it('clamps retirement into [currentAge, max]', () => {
    expect(setRetirement(SAVED, CURRENT, 30).retirementAge).toBe(40); // below current → floor
    expect(setRetirement(SAVED, CURRENT, 999).retirementAge).toBe(DIAL_LIMITS.retirementAge.max);
  });
  it('bumps the end age up so it stays strictly after retirement', () => {
    expect(setRetirement(SAVED, CURRENT, 94).endAge).toBe(95); // 95 already > 94
    expect(setRetirement({ ...SAVED, endAge: 80 }, CURRENT, 90).endAge).toBe(91); // bumped to retire+1
  });
  it('never yields retire ≥ end, even at the maximum retirement age', () => {
    const r = setRetirement({ ...SAVED, endAge: 70 }, CURRENT, DIAL_LIMITS.retirementAge.max);
    expect(valid(r, CURRENT)).toBe(true);
  });
});

describe('setEnd — clamps to (retirement, max]', () => {
  it('floors the end age at retirement + 1', () => {
    expect(setEnd({ ...SAVED, retirementAge: 65 }, 60).endAge).toBe(66);
  });
  it('caps the end age at the bound', () => {
    expect(setEnd(SAVED, 999).endAge).toBe(DIAL_LIMITS.endAge.max);
  });
});

describe('setInflationPercent — exact string parse, no float', () => {
  it('parses a percent string to clamped bps', () => {
    expect(setInflationPercent(SAVED, '2.5').inflationBps).toBe(250);
    expect(setInflationPercent(SAVED, '0').inflationBps).toBe(0);
    expect(setInflationPercent(SAVED, '10').inflationBps).toBe(1000);
    expect(setInflationPercent(SAVED, '15').inflationBps).toBe(1000); // clamped to the max
  });
  it('leaves the plan unchanged on an out-of-grammar value (mid-typing safety)', () => {
    expect(setInflationPercent(SAVED, '').inflationBps).toBe(250);
    expect(setInflationPercent(SAVED, '2.555').inflationBps).toBe(250);
    expect(setInflationPercent(SAVED, 'abc').inflationBps).toBe(250);
  });
});

describe('invariant fuzz — no edit sequence can make projectRetirement throw (F1)', () => {
  const ageEdits = ['', 'x', '-5', '0', '17', '18', '40', '65', '95', '110', '120', '999', '65.7'];
  const inflEdits = ['', 'x', '-1', '0', '2.5', '10', '50', '7.25'];

  it('every retirement-age edit keeps the plan engine-valid for any current age', () => {
    for (const cur of [18, 40, 100]) {
      // Normalize the starting plan for this current age, then hammer it.
      let plan = setRetirement({ retirementAge: 65, endAge: 95, inflationBps: 250 }, cur, Math.max(cur, 65));
      expect(valid(plan, cur)).toBe(true);
      for (const a of ageEdits) {
        plan = setRetirement(plan, cur, Number(a));
        expect(valid(plan, cur)).toBe(true);
        expect(() =>
          projectRetirement(buildRetirementInputs(BASE, { currentAge: cur, ...plan })),
        ).not.toThrow();
      }
    }
  });

  it('every end-age and inflation edit keeps the plan engine-valid', () => {
    let plan: WhatIfPlan = { ...SAVED };
    for (const a of ageEdits) {
      plan = setEnd(plan, Number(a));
      expect(valid(plan, CURRENT)).toBe(true);
    }
    for (const inf of inflEdits) {
      plan = setInflationPercent(plan, inf);
      expect(valid(plan, CURRENT)).toBe(true);
    }
    expect(() =>
      projectRetirement(buildRetirementInputs(BASE, { currentAge: CURRENT, ...plan })),
    ).not.toThrow();
  });

  it('the displayed plan is exactly what gets projected (no divergent clamped copy)', () => {
    const plan = setRetirement(SAVED, CURRENT, 58);
    const engineInputs = buildRetirementInputs(BASE, { currentAge: CURRENT, ...plan });
    expect(engineInputs.retirementAge).toBe(plan.retirementAge);
    expect(engineInputs.endAge).toBe(plan.endAge);
  });
});
