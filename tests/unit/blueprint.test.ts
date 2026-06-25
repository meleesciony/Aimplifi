/**
 * Automation Blueprint (P0.5, DECISIONS #94). Pure ordering/selection engine:
 * savings before cards (pay yourself first), largest savings first, soonest-due
 * cards first, with empty/zero rows dropped.
 */
import { describe, expect, it } from 'vitest';
import { buildAutomationBlueprint, type BlueprintInput } from '@/lib/engine/automation/blueprint';

const base: BlueprintInput = {
  paycheck: { cadence: 'BIWEEKLY', amountCents: 350_000 },
  savings: [
    { name: 'Emergency Fund', monthlyCents: 50_000 },
    { name: 'Vacation', monthlyCents: 20_000 },
  ],
  cards: [
    { cardName: 'Amex', dueDate: '2026-07-12', cashRequiredCents: 120_000 },
    { cardName: 'Visa', dueDate: '2026-07-03', cashRequiredCents: 80_000 },
  ],
};

describe('buildAutomationBlueprint', () => {
  it('orders savings first (largest first), then cards (soonest due first)', () => {
    const steps = buildAutomationBlueprint(base);
    expect(steps.map((s) => [s.kind, s.name])).toEqual([
      ['savings', 'Emergency Fund'],
      ['savings', 'Vacation'],
      ['card', 'Visa'], // due 07-03, before Amex 07-12
      ['card', 'Amex'],
    ]);
    expect(steps.map((s) => s.order)).toEqual([1, 2, 3, 4]);
    expect(steps.every((s) => s.onPayday)).toBe(true);
  });

  it('drops zero/negative savings and cards with no cash due', () => {
    const steps = buildAutomationBlueprint({
      ...base,
      savings: [{ name: 'Emergency Fund', monthlyCents: 50_000 }, { name: 'Empty', monthlyCents: 0 }],
      cards: [
        { cardName: 'Amex', dueDate: '2026-07-12', cashRequiredCents: 0 },
        { cardName: 'Visa', dueDate: '2026-07-03', cashRequiredCents: 80_000 },
      ],
    });
    expect(steps.map((s) => s.name)).toEqual(['Emergency Fund', 'Visa']);
  });

  it('drops estimated (no-statement) cards — they have no real amount to autopay (DECISIONS #98)', () => {
    const steps = buildAutomationBlueprint({
      ...base,
      cards: [
        { cardName: 'Visa', dueDate: '2026-07-03', cashRequiredCents: 80_000, isEstimated: false },
        { cardName: 'Store Card', dueDate: '2026-07-20', cashRequiredCents: 4_350, isEstimated: true },
      ],
    });
    // The estimated Store Card (a projected next-cycle amount/date) is excluded;
    // only the real-statement Visa survives as a firm "set it once" instruction.
    expect(steps.filter((s) => s.kind === 'card').map((s) => s.name)).toEqual(['Visa']);
  });

  it('marks onPayday false when no paycheck cadence is detected', () => {
    const steps = buildAutomationBlueprint({ ...base, paycheck: null });
    expect(steps.every((s) => !s.onPayday)).toBe(true);
    const steps2 = buildAutomationBlueprint({ ...base, paycheck: { cadence: null, amountCents: 0 } });
    expect(steps2.every((s) => !s.onPayday)).toBe(true);
  });

  it('returns an empty blueprint when there is nothing to automate', () => {
    expect(buildAutomationBlueprint({ paycheck: null, savings: [], cards: [] })).toEqual([]);
  });

  it('carries the card due date through and the right amounts', () => {
    const steps = buildAutomationBlueprint(base);
    const visa = steps.find((s) => s.name === 'Visa')!;
    expect(visa.dueDate).toBe('2026-07-03');
    expect(visa.amountCents).toBe(80_000);
    const ef = steps.find((s) => s.name === 'Emergency Fund')!;
    expect(ef.dueDate).toBeNull();
    expect(ef.amountCents).toBe(50_000);
  });
});
