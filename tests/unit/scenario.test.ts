/**
 * Scenario coherence engine (AI plan §Later #13 slice 1, DECISIONS #255).
 *
 * Every expected value is hand-verified in docs/EDGE_CASES.md §Scenario Coherence
 * (fixture SC, cases S1–S14). The suite locks the cardinal both-or-neither rule
 * (a knob applies to BOTH representations or NOT AT ALL with a note), the
 * net-vs-investible split, the E-CUT no-op, clamp-and-note behavior, and — via
 * real downstream calls — that forecast, cash-needed assembly, debt payoff, FI,
 * savings-rate, and retirement all see the SAME scenario.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';
import {
  SCENARIO_LIMITS,
  applyScenario,
  toDebtPlanInput,
  toRetirementBase,
  toScenarioSavingsRateBps,
  type ScenarioBase,
  type ScenarioScheduledRow,
} from '@/lib/engine/scenario/scenario';
import { expandScheduled, type ScheduledCadence } from '@/lib/engine/forecast/forecast';
import { assembleCashNeededInput } from '@/lib/engine/cash-needed/assemble';
import { planDebtPayoff } from '@/lib/engine/debt/payoff';
import { fiNumberCents, monthsToFI } from '@/lib/engine/fi/fi';
import {
  RETIREMENT_ASSUMPTIONS,
  buildRetirementInputs,
  projectRetirement,
} from '@/lib/engine/investments/retirement';

const TODAY = isoDate('2026-06-10');

/** Fixture SC from EDGE_CASES §Scenario Coherence — hand math depends on these exact values. */
function baseSC(overrides: Partial<ScenarioBase> = {}): ScenarioBase {
  const rows: ScenarioScheduledRow[] = [
    { accountId: 'acct-check', description: 'Paycheck', amountCents: 250000, nextDate: '2026-06-12', cadence: 'BIWEEKLY' },
    { accountId: 'acct-check', description: 'Rent', amountCents: -150000, nextDate: '2026-07-01', cadence: 'MONTHLY' },
    { accountId: 'acct-check', description: 'Side gig', amountCents: 33333, nextDate: '2026-06-20', cadence: 'MONTHLY' },
  ];
  return {
    today: TODAY,
    monthlyIncomeCents: 500000,
    monthlySavingsCents: 120000,
    annualExpensesCents: 4560000,
    averageWindowMonths: 6,
    portfolioCents: 2500000,
    paymentAccountId: 'acct-check',
    scheduledRows: rows,
    debts: [
      { id: 'd1', name: 'Card', balanceCents: 450000, aprBps: 2199, minimumPaymentCents: 15000 },
      { id: 'd2', name: 'Loan', balanceCents: 800000, aprBps: 649, minimumPaymentCents: 25000 },
    ],
    dials: { swrBps: 400, expectedReturnBps: 700 },
    ...overrides,
  };
}

describe('applyScenario — S1 identity', () => {
  it('no knobs → verbatim base figures, byte-identical rows, no notes', () => {
    const base = baseSC();
    const s = applyScenario(base, {});
    expect(s.monthlyIncomeCents).toBe(500000);
    expect(s.monthlyExpensesCents).toBe(380000); // income − savings, the canonical identity
    expect(s.monthlyNetCents).toBe(120000);
    expect(s.monthlyInvestibleCents).toBe(120000); // equals verbatim coach savings at base
    expect(s.annualExpensesCents).toBe(4560000);
    expect(s.extraDebtMonthlyCents).toBe(0);
    expect(s.scheduledRows).toEqual(base.scheduledRows);
    expect(s.scheduledRows.some((r) => r.isSynthetic)).toBe(false);
    expect(s.notes).toEqual([]);
    expect(s.assumptions.length).toBeGreaterThan(0);
  });

  it('identity extends through every adapter', () => {
    const s = applyScenario(baseSC(), {});
    // toFIInputs was REMOVED (audit P2): it paired the nominal return with a
    // present-value target — a mixed-base trap with no caller. The sanctioned
    // path to the FI engines is the retirement adapter's real-return builder,
    // asserted next, which the /coach server uses.
    expect(toRetirementBase(s)).toEqual({
      currentPortfolioCents: 2500000,
      monthlyContributionCents: 120000,
      annualRetirementSpendingCents: 4560000,
      nominalReturnBps: 700,
      swrBps: 400,
    });
    // base rate: (500000−380000)/500000 = 2400 bps
    expect(toScenarioSavingsRateBps(s)).toBe(2400);
    expect(toDebtPlanInput(s, 'avalanche').extraMonthlyCents).toBe(0);
  });
});

describe('applyScenario — income knob', () => {
  it('S2: percent −1500 bps moves the aggregate AND every income row by the same factor', () => {
    const s = applyScenario(baseSC(), { income: { percentBps: -1500 } });
    // aggregate: rHAFZ(500000 × −1500/10000) = −75000
    expect(s.monthlyIncomeCents).toBe(425000);
    expect(s.monthlyExpensesCents).toBe(380000);
    expect(s.monthlyNetCents).toBe(45000);
    expect(s.monthlyInvestibleCents).toBe(45000);
    expect(s.annualExpensesCents).toBe(4560000);
    const byDesc = new Map(s.scheduledRows.map((r) => [r.description, r.amountCents]));
    expect(byDesc.get('Paycheck')).toBe(212500); // 250000 × 0.85 exact
    expect(byDesc.get('Side gig')).toBe(28333); // rHAFZ(33333 × 0.85 = 28333.05)
    expect(byDesc.get('Rent')).toBe(-150000); // expense rows untouched
    expect(s.scheduledRows.some((r) => r.isSynthetic)).toBe(false);
    expect(s.notes).toEqual([]);
  });

  it('S3: absolute −50000 shifts the aggregate and lands ONE synthetic monthly row', () => {
    const s = applyScenario(baseSC(), { income: { monthlyCents: -50000 } });
    expect(s.monthlyIncomeCents).toBe(450000);
    expect(s.monthlyNetCents).toBe(70000);
    const synth = s.scheduledRows.filter((r) => r.isSynthetic);
    expect(synth).toEqual([
      {
        accountId: 'acct-check',
        description: 'Scenario: income adjustment',
        amountCents: -50000,
        nextDate: '2026-07-01', // first of next month
        cadence: 'MONTHLY',
        isSynthetic: true,
      },
    ]);
    // existing rows untouched
    expect(s.scheduledRows.filter((r) => !r.isSynthetic)).toEqual(baseSC().scheduledRows);
  });

  it('S4: percent then absolute — percent on the base, absolute added after', () => {
    const s = applyScenario(baseSC(), { income: { percentBps: -1500, monthlyCents: 20000 } });
    expect(s.monthlyIncomeCents).toBe(445000); // 500000 − 75000 + 20000
    expect(s.monthlyNetCents).toBe(65000);
    const synth = s.scheduledRows.filter((r) => r.isSynthetic);
    expect(synth).toHaveLength(1);
    expect(synth[0].amountCents).toBe(20000);
    // scaled originals per S2
    const byDesc = new Map(s.scheduledRows.filter((r) => !r.isSynthetic).map((r) => [r.description, r.amountCents]));
    expect(byDesc.get('Paycheck')).toBe(212500);
  });

  it('S10: percent −10000 → $0 income; net honestly negative; rate null; retirement floors', () => {
    const s = applyScenario(baseSC(), { income: { percentBps: -10000 } });
    expect(s.monthlyIncomeCents).toBe(0);
    expect(s.monthlyNetCents).toBe(-380000);
    expect(s.monthlyInvestibleCents).toBe(-380000);
    expect(toScenarioSavingsRateBps(s)).toBeNull(); // income ≤ 0 contract preserved
    const byDesc = new Map(s.scheduledRows.map((r) => [r.description, r.amountCents]));
    expect(byDesc.get('Paycheck')).toBe(0);
    expect(byDesc.get('Side gig')).toBe(0);
    // buildRetirementInputs (the one shared builder) floors the contribution at 0
    const ri = buildRetirementInputs(toRetirementBase(s), RETIREMENT_ASSUMPTIONS);
    expect(ri.monthlyContributionCents).toBe(0);
    expect(() => projectRetirement(ri)).not.toThrow();
  });

  it('S11: out-of-bounds percent clamps to −100% with a note', () => {
    const s = applyScenario(baseSC(), { income: { percentBps: -12000 } });
    expect(s.monthlyIncomeCents).toBe(0);
    expect(s.notes.some((n) => n.includes('limited to the supported range'))).toBe(true);
  });

  it('S14: absolute below −income floors at $0 and the synthetic row carries the EFFECTIVE delta', () => {
    const s = applyScenario(baseSC(), { income: { monthlyCents: -600000 } });
    expect(s.monthlyIncomeCents).toBe(0);
    const synth = s.scheduledRows.filter((r) => r.isSynthetic);
    expect(synth).toHaveLength(1);
    expect(synth[0].amountCents).toBe(-500000); // effective, not requested — both representations agree
    expect(s.notes.some((n) => n.includes('cannot go below $0'))).toBe(true);
  });

  it('S9: absolute knob with no payment account is a no-op on BOTH representations', () => {
    const s = applyScenario(baseSC({ paymentAccountId: null }), { income: { monthlyCents: -50000 } });
    expect(s.monthlyIncomeCents).toBe(500000); // aggregate unchanged (both-or-neither)
    expect(s.scheduledRows.some((r) => r.isSynthetic)).toBe(false);
    expect(s.notes.some((n) => n.includes('no payment account'))).toBe(true);
  });

  it('percent knob still applies with no payment account (scaling needs no synthetic row)', () => {
    const s = applyScenario(baseSC({ paymentAccountId: null }), { income: { percentBps: -1500 } });
    expect(s.monthlyIncomeCents).toBe(425000);
    const byDesc = new Map(s.scheduledRows.map((r) => [r.description, r.amountCents]));
    expect(byDesc.get('Paycheck')).toBe(212500);
  });
});

describe('applyScenario — expense knob', () => {
  it('S5: percent +1000 bps moves expenses, annualExpenses by 12× the monthly delta, and bill rows', () => {
    const s = applyScenario(baseSC(), { expense: { percentBps: 1000 } });
    expect(s.monthlyExpensesCents).toBe(418000); // 380000 + rHAFZ(38000)
    expect(s.monthlyNetCents).toBe(82000);
    expect(s.monthlyInvestibleCents).toBe(82000);
    expect(s.annualExpensesCents).toBe(5016000); // 4560000 + 12×38000
    const byDesc = new Map(s.scheduledRows.map((r) => [r.description, r.amountCents]));
    expect(byDesc.get('Rent')).toBe(-165000); // −150000 × 1.1
    expect(byDesc.get('Paycheck')).toBe(250000); // income rows untouched
    expect(toScenarioSavingsRateBps(s)).toBe(1640); // round(82000/500000 × 10000)
  });

  it('S6: absolute NEGATIVE (a cut) is the documented E-CUT no-op with a note', () => {
    const base = baseSC();
    const s = applyScenario(base, { expense: { monthlyCents: -25000 } });
    expect(s.monthlyExpensesCents).toBe(380000);
    expect(s.annualExpensesCents).toBe(4560000);
    expect(s.scheduledRows).toEqual(base.scheduledRows);
    expect(s.notes.some((n) => n.includes('percent knob'))).toBe(true);
  });

  it('S6b: absolute POSITIVE lands as a committed monthly outflow in both representations', () => {
    const s = applyScenario(baseSC(), { expense: { monthlyCents: 25000 } });
    expect(s.monthlyExpensesCents).toBe(405000);
    expect(s.monthlyNetCents).toBe(95000);
    expect(s.annualExpensesCents).toBe(4860000); // 4560000 + 300000
    const synth = s.scheduledRows.filter((r) => r.isSynthetic);
    expect(synth).toEqual([
      {
        accountId: 'acct-check',
        description: 'Scenario: added spending',
        amountCents: -25000,
        nextDate: '2026-07-01',
        cadence: 'MONTHLY',
        isSynthetic: true,
      },
    ]);
  });

  it('S13: percent with zero matching bill rows still moves the aggregate (empty flow set, same factor)', () => {
    const incomeOnly = baseSC().scheduledRows.filter((r) => r.amountCents > 0);
    const s = applyScenario(baseSC({ scheduledRows: incomeOnly }), { expense: { percentBps: 1000 } });
    expect(s.monthlyExpensesCents).toBe(418000);
    expect(s.scheduledRows).toEqual(incomeOnly);
    expect(s.notes).toEqual([]);
  });
});

describe('applyScenario — extra debt knob (the cross-engine coherence case)', () => {
  it('S7: $300/mo extra reduces investible but NOT net, feeds debt + flows, leaves the rate alone', () => {
    const s = applyScenario(baseSC(), { extraDebtMonthlyCents: 30000 });
    expect(s.monthlyNetCents).toBe(120000); // reallocation, not new spending
    expect(s.monthlyInvestibleCents).toBe(90000);
    expect(toScenarioSavingsRateBps(s)).toBe(2400); // unchanged from base
    expect(toDebtPlanInput(s, 'avalanche').extraMonthlyCents).toBe(30000);
    const synth = s.scheduledRows.filter((r) => r.isSynthetic);
    expect(synth).toEqual([
      {
        accountId: 'acct-check',
        description: 'Scenario: extra debt payment',
        amountCents: -30000,
        nextDate: '2026-07-01',
        cadence: 'MONTHLY',
        isSynthetic: true,
      },
    ]);
    // FI sees the reduced contribution; retirement floors via the shared builder
    expect(
      buildRetirementInputs(toRetirementBase(s), RETIREMENT_ASSUMPTIONS).monthlyContributionCents,
    ).toBe(90000);
  });

  it('S8: zero payable debts → the knob is a disclosed no-op everywhere', () => {
    const s = applyScenario(
      baseSC({
        debts: [{ id: 'd1', name: 'Paid card', balanceCents: 0, aprBps: 2199, minimumPaymentCents: 0 }],
      }),
      { extraDebtMonthlyCents: 30000 },
    );
    expect(s.monthlyInvestibleCents).toBe(120000);
    expect(s.extraDebtMonthlyCents).toBe(0);
    expect(toDebtPlanInput(s, 'avalanche').extraMonthlyCents).toBe(0);
    expect(s.scheduledRows.some((r) => r.isSynthetic)).toBe(false);
    expect(s.notes.some((n) => n.includes('no debts'))).toBe(true);
  });

  it('S12: negative extra clamps to 0 (no-op, noted)', () => {
    const s = applyScenario(baseSC(), { extraDebtMonthlyCents: -5000 });
    expect(s.extraDebtMonthlyCents).toBe(0);
    expect(s.monthlyInvestibleCents).toBe(120000);
    expect(s.notes.some((n) => n.includes('limited to the supported range'))).toBe(true);
  });

  it('no payment account → disclosed no-op (a flow-less cash outflow would be one-sided)', () => {
    const s = applyScenario(baseSC({ paymentAccountId: null }), { extraDebtMonthlyCents: 30000 });
    expect(s.extraDebtMonthlyCents).toBe(0);
    expect(s.monthlyInvestibleCents).toBe(120000);
    expect(s.notes.some((n) => n.includes('no payment account'))).toBe(true);
  });

  it('a larger extra never delays debt freedom (pass-through to the pinned monotone engine)', () => {
    const s300 = applyScenario(baseSC(), { extraDebtMonthlyCents: 30000 });
    const s600 = applyScenario(baseSC(), { extraDebtMonthlyCents: 60000 });
    const m300 = planDebtPayoff(toDebtPlanInput(s300, 'avalanche')).monthsToDebtFree;
    const m600 = planDebtPayoff(toDebtPlanInput(s600, 'avalanche')).monthsToDebtFree;
    expect(m300).not.toBeNull();
    expect(m600).not.toBeNull();
    expect(m600!).toBeLessThanOrEqual(m300!);
  });
});

describe('coherence across the real downstream engines', () => {
  it('forecast and cash-needed both see the SAME scenario rows (S7 synthetic outflow)', () => {
    const s = applyScenario(baseSC(), { extraDebtMonthlyCents: 30000 });

    // Forecast path: expandScheduled over the state's rows for the payment account.
    const flows = s.scheduledRows
      .filter((r) => r.accountId === 'acct-check')
      .map((r) => ({
        description: r.description,
        amountCents: r.amountCents,
        nextDate: r.nextDate,
        cadence: (r.cadence as ScheduledCadence) ?? null,
      }));
    const events = expandScheduled(flows, TODAY, 90);
    const extraEvents = events.filter((e) => e.label === 'Scenario: extra debt payment');
    // 2026-07-01, 08-01, 09-01 within (06-10, 09-08]... horizon = 09-08 → Jul & Aug & Sep 1? 09-01 ≤ 09-08 ✓
    expect(extraEvents.map((e) => e.date)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
    expect(extraEvents.every((e) => e.amountCents === -30000)).toBe(true);

    // Cash-needed path: the assembler expands the SAME rows into scheduled items.
    const input = assembleCashNeededInput({
      today: TODAY,
      scenario: 'PAY_IN_FULL',
      paymentAccountId: 'acct-check',
      accounts: [
        {
          id: 'acct-check',
          name: 'Checking',
          type: 'CHECKING',
          currentBalanceCents: 800000,
          aprBps: null,
          dueDayOfMonth: null,
          cycleCloseDayOfMonth: null,
        },
      ],
      autopays: [],
      statements: [],
      cardPayments: [],
      transactions: [],
      scheduled: s.scheduledRows,
      holidayTable: [],
    });
    const extraItems = input.scheduled.filter((i) => i.description === 'Scenario: extra debt payment');
    expect(extraItems.map((i) => i.date)).toEqual(['2026-07-01', '2026-08-01']); // 60d horizon
    expect(extraItems.every((i) => i.amountCents === -30000)).toBe(true);
  });

  it('the same pay cut reaches FI and the flow engines together (no stale side)', () => {
    const base = baseSC();
    const cut = applyScenario(base, { income: { percentBps: -1500 } });
    const idle = applyScenario(base, {});

    // FI: fewer months to FI with more savings — the cut must WORSEN months-to-FI.
    // Sanctioned path (audit P2): the retirement adapter's REAL-return builder —
    // the same one /coach compounds monthsToFI at — never the nominal dial.
    const fiIdle = buildRetirementInputs(toRetirementBase(idle), RETIREMENT_ASSUMPTIONS);
    const fiCut = buildRetirementInputs(toRetirementBase(cut), RETIREMENT_ASSUMPTIONS);
    const mIdle = monthsToFI(
      fiIdle.currentPortfolioCents,
      fiIdle.monthlyContributionCents,
      fiIdle.annualReturnBps,
      fiNumberCents(fiIdle.annualRetirementSpendingCents, fiIdle.swrBps),
    );
    const mCut = monthsToFI(
      fiCut.currentPortfolioCents,
      fiCut.monthlyContributionCents,
      fiCut.annualReturnBps,
      fiNumberCents(fiCut.annualRetirementSpendingCents, fiCut.swrBps),
    );
    expect(mIdle).not.toBeNull();
    expect(mCut).not.toBeNull();
    expect(mCut!).toBeGreaterThan(mIdle!);

    // Flows: every income occurrence in the 90-day window shrank by exactly the factor.
    const toFlows = (rows: readonly ScenarioScheduledRow[]) =>
      expandScheduled(
        rows.map((r) => ({
          description: r.description,
          amountCents: r.amountCents,
          nextDate: r.nextDate,
          cadence: (r.cadence as ScheduledCadence) ?? null,
        })),
        TODAY,
        90,
      );
    const idleIncome = toFlows(idle.scheduledRows).filter((e) => e.amountCents > 0);
    const cutIncome = toFlows(cut.scheduledRows).filter((e) => e.amountCents > 0);
    expect(cutIncome.length).toBe(idleIncome.length);
    for (let i = 0; i < idleIncome.length; i++) {
      expect(cutIncome[i].amountCents).toBeLessThan(idleIncome[i].amountCents);
    }
  });

  it('retirement never throws across the clamped knob grid (downstream contract safety)', () => {
    const base = baseSC();
    const pcts = [SCENARIO_LIMITS.percentBps.min, -1500, 0, 1000, SCENARIO_LIMITS.percentBps.max];
    const abss = [SCENARIO_LIMITS.monthlyCents.min, -50000, 0, 25000, SCENARIO_LIMITS.monthlyCents.max];
    const extras = [0, 30000, SCENARIO_LIMITS.extraDebtMonthlyCents.max];
    for (const p of pcts) {
      for (const a of abss) {
        for (const x of extras) {
          const s = applyScenario(base, {
            income: { percentBps: p, monthlyCents: a },
            expense: { percentBps: -p },
            extraDebtMonthlyCents: x,
          });
          const ri = buildRetirementInputs(toRetirementBase(s), RETIREMENT_ASSUMPTIONS);
          expect(() => projectRetirement(ri)).not.toThrow();
          expect(Number.isSafeInteger(s.monthlyNetCents)).toBe(true);
          expect(Number.isSafeInteger(s.annualExpensesCents)).toBe(true);
        }
      }
    }
  });

  it('every materialized money value is integer cents', () => {
    const s = applyScenario(baseSC(), {
      income: { percentBps: -333, monthlyCents: 12345 },
      expense: { percentBps: 777 },
      extraDebtMonthlyCents: 6789,
    });
    for (const v of [
      s.monthlyIncomeCents,
      s.monthlyExpensesCents,
      s.monthlyNetCents,
      s.monthlyInvestibleCents,
      s.annualExpensesCents,
      ...s.scheduledRows.map((r) => r.amountCents),
    ]) {
      expect(Number.isSafeInteger(v)).toBe(true);
    }
  });

  it('cents() branding round-trips (adapter outputs are engine-legal Cents)', () => {
    const s = applyScenario(baseSC(), { income: { percentBps: -1500 } });
    // Sanctioned adapter (audit P2 — toFIInputs removed): the retirement
    // builder floors and re-brands every figure.
    const ri = buildRetirementInputs(toRetirementBase(s), RETIREMENT_ASSUMPTIONS);
    expect(ri.currentPortfolioCents).toBe(cents(2500000));
    expect(ri.annualRetirementSpendingCents).toBe(cents(4560000));
  });
});

describe('critic fixes (#255 cycle 1)', () => {
  it('F1: NaN knobs are ignored with a note — never a throw, never a NaN state (S16)', () => {
    for (const knobs of [
      { income: { percentBps: NaN } },
      { income: { monthlyCents: NaN } },
      { expense: { percentBps: Infinity } },
      { extraDebtMonthlyCents: NaN },
    ]) {
      const s = applyScenario(baseSC(), knobs);
      // ignored = identity on every figure and row
      expect(s.monthlyIncomeCents).toBe(500000);
      expect(s.monthlyExpensesCents).toBe(380000);
      expect(s.monthlyInvestibleCents).toBe(120000);
      expect(s.scheduledRows.some((r) => r.isSynthetic)).toBe(false);
      expect(s.scheduledRows.every((r) => Number.isSafeInteger(r.amountCents))).toBe(true);
      expect(s.notes.some((n) => n.includes('not a usable number'))).toBe(true);
      expect(() => projectRetirement(buildRetirementInputs(toRetirementBase(s), RETIREMENT_ASSUMPTIONS))).not.toThrow();
    }
  });

  it('F1: non-integer knob cents round half-away with a note, state stays integer (S16)', () => {
    const s = applyScenario(baseSC(), { income: { monthlyCents: 50000.5 } });
    expect(s.monthlyIncomeCents).toBe(550001); // 500000 + rHAFZ(50000.5)
    const synth = s.scheduledRows.filter((r) => r.isSynthetic);
    expect(synth).toHaveLength(1);
    expect(synth[0].amountCents).toBe(50001);
    expect(s.notes.some((n) => n.includes('rounded to a whole number'))).toBe(true);
  });

  it('F2/S15: percent income on a $0 aggregate base still scales the rows, with a disclosure', () => {
    const s = applyScenario(baseSC({ monthlyIncomeCents: 0, monthlySavingsCents: -380000 }), {
      income: { percentBps: 5000 },
    });
    expect(s.monthlyIncomeCents).toBe(0); // 0 × any factor = 0 — same factor, both sides
    const byDesc = new Map(s.scheduledRows.map((r) => [r.description, r.amountCents]));
    expect(byDesc.get('Paycheck')).toBe(375000); // 250000 × 1.5
    expect(s.notes.some((n) => n.includes('income over the last 6 months is $0'))).toBe(true);
  });

  it('F3: an applied extra-debt payment states its no-end-date assumption inline', () => {
    const withExtra = applyScenario(baseSC(), { extraDebtMonthlyCents: 30000 });
    expect(withExtra.assumptions.some((a) => a.includes('even after the debts would be paid off'))).toBe(true);
    const without = applyScenario(baseSC(), {});
    expect(without.assumptions.some((a) => a.includes('even after the debts'))).toBe(false);
    // a no-op'd extra (no debts) must NOT carry the assumption either
    const noDebts = applyScenario(
      baseSC({ debts: [{ id: 'd1', name: 'Paid', balanceCents: 0, aprBps: 0, minimumPaymentCents: 0 }] }),
      { extraDebtMonthlyCents: 30000 },
    );
    expect(noDebts.assumptions.some((a) => a.includes('even after the debts'))).toBe(false);
  });
});

/**
 * Window consistency (task 1, 2026-08-04): the coach averages over its REAL window —
 * `CoachData.fi.monthlySavingsMonths` = the count of full months on record, ≤ 6 — and
 * every scenario surface must name THAT window, never a hardcoded 6. These tests lock
 * the value end-to-end: carried verbatim into the state, and interpolated into every
 * piece of copy that previously said "6 months".
 */
describe('window consistency: scenario copy speaks the coach\'s real window', () => {
  it('carries the coach\'s window verbatim through applyScenario', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6]) {
      expect(applyScenario(baseSC({ averageWindowMonths: n }), {}).averageWindowMonths).toBe(n);
    }
  });

  it('the standing assumption names the real window for every 1..6, and never says 6 otherwise', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const s = applyScenario(baseSC({ averageWindowMonths: n }), {});
      const plural = n === 1 ? '' : 's';
      expect(s.assumptions[0]).toBe(
        `Aggregate figures are averages over your last ${n} full month${plural}; scheduled flows are your detected recurring items — the same knob moves both.`,
      );
      if (n !== 6) {
        expect(s.assumptions.join(' ')).not.toMatch(/6.?month/);
        expect(s.notes.join(' ')).not.toMatch(/6.?month/);
      }
    }
  });

  it('window 0 (no complete months on record) says that instead of inventing a window', () => {
    const s = applyScenario(baseSC({ averageWindowMonths: 0 }), {});
    expect(s.assumptions[0]).toContain('no complete months of history are on record yet');
  });

  it('the S15 $0-base disclosures interpolate the window — income and expense sides', () => {
    const income = applyScenario(
      baseSC({ averageWindowMonths: 3, monthlyIncomeCents: 0, monthlySavingsCents: -380000 }),
      { income: { percentBps: 5000 } },
    );
    expect(income.notes.some((note) => note.includes('income over the last 3 months is $0'))).toBe(true);

    const expense = applyScenario(
      baseSC({ averageWindowMonths: 4, monthlyIncomeCents: 380000, monthlySavingsCents: 380000 }),
      { expense: { percentBps: 1000 } },
    );
    expect(expense.notes.some((note) => note.includes('spending over the last 4 months is $0'))).toBe(true);
  });

  it('window 1 is singular everywhere, and window 0 falls back to "your history so far"', () => {
    const one = applyScenario(
      baseSC({ averageWindowMonths: 1, monthlyIncomeCents: 0, monthlySavingsCents: -380000 }),
      { income: { percentBps: 5000 } },
    );
    expect(one.assumptions[0]).toContain('your last 1 full month;');
    expect(one.notes.some((note) => note.includes('income over the last 1 month is $0'))).toBe(true);

    const zero = applyScenario(
      baseSC({ averageWindowMonths: 0, monthlyIncomeCents: 0, monthlySavingsCents: -380000 }),
      { income: { percentBps: 5000 } },
    );
    expect(zero.notes.some((note) => note.includes('income over your history so far is $0'))).toBe(true);
  });

  it('a knobbed scenario still carries the window — consistency survives the knobs, not just identity', () => {
    const s = applyScenario(baseSC({ averageWindowMonths: 2 }), {
      income: { percentBps: -1500 },
      expense: { percentBps: -1000 },
      extraDebtMonthlyCents: 20000,
    });
    expect(s.averageWindowMonths).toBe(2);
    expect(s.assumptions[0]).toContain('your last 2 full months');
  });
});
