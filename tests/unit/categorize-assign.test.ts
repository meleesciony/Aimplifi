import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '@/lib/engine/categorize/categories';
import { ASSIGNABLE_CATEGORIES, isRuleEligibleMerchant } from '@/lib/engine/categorize/assign';

describe('ASSIGNABLE_CATEGORIES (DECISIONS #36)', () => {
  it('excludes the internal uncategorized placeholder and nothing else', () => {
    expect(ASSIGNABLE_CATEGORIES).toHaveLength(CATEGORIES.length - 1);
    expect(ASSIGNABLE_CATEGORIES.some((c) => c.id === 'uncategorized')).toBe(false);
  });

  it('keeps the canonical order and includes the real categories a user picks', () => {
    const ids = ASSIGNABLE_CATEGORIES.map((c) => c.id);
    expect(ids).toContain('dining');
    expect(ids).toContain('groceries');
    expect(ids).toContain('income');
    expect(ids).toContain('transfer');
    // order matches CATEGORIES (minus uncategorized)
    expect(ids).toEqual(CATEGORIES.filter((c) => c.id !== 'uncategorized').map((c) => c.id));
  });

  it('carries display names', () => {
    expect(ASSIGNABLE_CATEGORIES.find((c) => c.id === 'dining')?.name).toBe('Dining Out');
  });
});

describe('isRuleEligibleMerchant (DECISIONS #36 / #23)', () => {
  it('allows merchant-wide rules for real merchants', () => {
    expect(isRuleEligibleMerchant('AMZN MKTP US*2X4')).toBe(true);
    expect(isRuleEligibleMerchant('NETFLIX.COM')).toBe(true);
  });

  it('refuses rules for aggregate pseudo-merchants (Zelle / checks)', () => {
    expect(isRuleEligibleMerchant('ZELLE PAYMENT TO JANE')).toBe(false);
    expect(isRuleEligibleMerchant('CHECK # 1042')).toBe(false);
  });
});
