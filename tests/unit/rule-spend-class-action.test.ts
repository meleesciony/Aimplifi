/**
 * Rule Fixed/Discretionary THEN-action — pure semantics.
 * Extra occurrence is the only outlier; amount variation is not.
 */
import { describe, expect, it } from 'vitest';
import {
  expectedPerCalendarMonth,
  extraOccurrenceIds,
  guessRuleSpendClass,
  normalizeSetSpendClass,
  resolveRuleSpendClassStamp,
} from '@/lib/engine/categorize/spend-class-action';
import { categorize, type RuleLike } from '@/lib/engine/categorize/pipeline';

const RULE: RuleLike = {
  id: 'r1',
  merchantCanonical: null,
  matchKeywords: ['duke', 'energy'],
  setSpendClass: 'fixed',
  minAmountCents: null,
  maxAmountCents: null,
  weekendOnly: null,
  weekdayOnly: null,
  accountId: null,
  categoryId: 'utilities',
  priority: 110,
};

const TXN = {
  rawDescriptor: 'DUKE ENERGY EPAY',
  amountCents: -12450,
  date: '2026-07-15',
  accountId: 'a1',
};

describe('normalizeSetSpendClass / resolveRuleSpendClassStamp', () => {
  it('keeps the closed set and refuses everything else', () => {
    expect(normalizeSetSpendClass('fixed')).toBe('fixed');
    expect(normalizeSetSpendClass('guilt-free')).toBe('guilt-free');
    expect(normalizeSetSpendClass('')).toBeNull();
    expect(normalizeSetSpendClass('Discretionary')).toBeNull();
  });

  it('stamps baseline rows and abstains on extras', () => {
    expect(
      resolveRuleSpendClassStamp({ ruleSpendClass: 'fixed', isExtraOccurrence: false }),
    ).toBe('fixed');
    expect(
      resolveRuleSpendClassStamp({ ruleSpendClass: 'fixed', isExtraOccurrence: true }),
    ).toBeNull();
  });
});

describe('extraOccurrenceIds — utilities vary in amount, not in count', () => {
  it('keeps one per month as baseline even when amounts differ wildly', () => {
    const rows = [
      { id: 'jan', date: '2026-01-10', groupKey: 'duke energy' },
      { id: 'feb', date: '2026-02-10', groupKey: 'duke energy' },
      { id: 'mar', date: '2026-03-10', groupKey: 'duke energy' },
    ];
    const cadence = new Map([['duke energy', 'MONTHLY' as const]]);
    expect(extraOccurrenceIds(rows, cadence).size).toBe(0);
  });

  it('marks a second charge in the same month as an extra occurrence', () => {
    const rows = [
      { id: 'a', date: '2026-07-05', groupKey: 'duke energy' },
      { id: 'b', date: '2026-07-20', groupKey: 'duke energy' },
      { id: 'c', date: '2026-08-05', groupKey: 'duke energy' },
    ];
    const cadence = new Map([['duke energy', 'MONTHLY' as const]]);
    expect([...extraOccurrenceIds(rows, cadence)]).toEqual(['b']);
  });

  it('allows biweekly baseline room in a month', () => {
    const rows = [
      { id: '1', date: '2026-07-01', groupKey: 'gym' },
      { id: '2', date: '2026-07-15', groupKey: 'gym' },
      { id: '3', date: '2026-07-29', groupKey: 'gym' },
      { id: '4', date: '2026-07-30', groupKey: 'gym' },
    ];
    const cadence = new Map([['gym', 'BIWEEKLY' as const]]);
    expect(expectedPerCalendarMonth('BIWEEKLY')).toBe(3);
    expect([...extraOccurrenceIds(rows, cadence)]).toEqual(['4']);
  });

  it('counts extras per payee, not across payees', () => {
    const rows = [
      { id: 'w1', date: '2026-07-01', groupKey: 'water' },
      { id: 'e1', date: '2026-07-02', groupKey: 'electric' },
      { id: 'w2', date: '2026-07-20', groupKey: 'water' },
    ];
    const cadence = new Map([
      ['water', 'MONTHLY' as const],
      ['electric', 'MONTHLY' as const],
    ]);
    expect([...extraOccurrenceIds(rows, cadence)]).toEqual(['w2']);
  });
});

describe('guessRuleSpendClass', () => {
  it('majority Fixed when recurring/history says so; tie → Discretionary', () => {
    expect(guessRuleSpendClass(['fixed', 'fixed', 'guilt-free'])).toBe('fixed');
    expect(guessRuleSpendClass(['fixed', 'guilt-free'])).toBe('fixed');
    expect(guessRuleSpendClass(['guilt-free', 'guilt-free', 'fixed'])).toBe('guilt-free');
    expect(guessRuleSpendClass([])).toBe('guilt-free');
  });
});

describe('categorize() — spendClassStamp', () => {
  it('a typed keyword rule that FILES stamps Fixed', () => {
    const out = categorize(TXN, [RULE]);
    expect(out.categoryId).toBe('utilities');
    expect(out.spendClassStamp).toBe('fixed');
  });

  it('a learned rule never stamps spend class', () => {
    const out = categorize(TXN, [{ ...RULE, isLearned: true }]);
    expect(out.spendClassStamp).toBeNull();
  });

  it('no action leaves the stamp null — pre-slice rules unchanged', () => {
    const out = categorize(TXN, [{ ...RULE, setSpendClass: null }]);
    expect(out.spendClassStamp).toBeNull();
  });
});
