import { describe, expect, it } from 'vitest';
import { parsePlanOverrides } from '@/lib/engine/spending-plan/overrides';

describe('parsePlanOverrides', () => {
  it('parses dollars and savings percent; empty clears overrides', () => {
    const r = parsePlanOverrides({
      income: '30,000.00',
      fixed: '12000',
      savingsTarget: '25',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.incomeOverrideCents).toBe(3_000_000);
    expect(r.value.fixedOverrideCents).toBe(1_200_000);
    expect(r.value.savingsTargetBps).toBe(2500);
    expect(r.value.savingsTargetProvided).toBe(true);
  });

  it('empty income/fixed means clear override (use suggestion)', () => {
    const r = parsePlanOverrides({ income: '', fixed: ' ', savingsTarget: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.incomeOverrideCents).toBeNull();
    expect(r.value.fixedOverrideCents).toBeNull();
    expect(r.value.savingsTargetBps).toBeNull();
  });

  it('rejects garbage and over-cap', () => {
    const r = parsePlanOverrides({ income: 'abc', fixed: '600000', savingsTarget: '99' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.income).toMatch(/dollars/i);
    expect(r.errors.fixed).toMatch(/500,000/);
    expect(r.errors.savingsTarget).toMatch(/0 and 90/);
  });
});
