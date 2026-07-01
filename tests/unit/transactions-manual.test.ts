import { describe, expect, it } from 'vitest';
import { prepareManualTransaction } from '@/lib/engine/transactions/manual';

describe('prepareManualTransaction — sign + parsing', () => {
  it('an expense is stored as a negative amount', () => {
    const t = prepareManualTransaction({
      descriptor: 'Farmers market cash',
      amount: '24.50',
      direction: 'out',
      date: '2026-06-12',
      accountId: 'acct-A',
      categoryId: 'groceries',
    });
    expect(t.amountCents).toBe(-2450);
    expect(t.categoryId).toBe('groceries');
    expect(t.needsReview).toBe(false);
    expect(t.isTransfer).toBe(false);
    expect(t.status).toBe('POSTED');
  });

  it('income is stored as a positive amount', () => {
    const t = prepareManualTransaction({
      descriptor: 'Side gig',
      amount: '1200',
      direction: 'in',
      date: '2026-06-12',
      accountId: 'acct-A',
      categoryId: 'income',
    });
    expect(t.amountCents).toBe(120000);
  });

  it('strips currency formatting ($ and commas)', () => {
    const t = prepareManualTransaction({
      descriptor: 'Rent',
      amount: '$1,250.00',
      direction: 'out',
      date: '2026-06-01',
      accountId: 'acct-A',
      categoryId: 'rent',
    });
    expect(t.amountCents).toBe(-125000);
  });

  it('an explicit "transfer" category sets isTransfer', () => {
    const t = prepareManualTransaction({
      descriptor: 'Move to savings',
      amount: '500',
      direction: 'out',
      date: '2026-06-01',
      accountId: 'acct-A',
      categoryId: 'transfer',
    });
    expect(t.isTransfer).toBe(true);
  });
});

describe('prepareManualTransaction — auto-categorization fallback', () => {
  it('routes a known merchant without an explicit category', () => {
    const t = prepareManualTransaction({
      descriptor: 'NETFLIX.COM',
      amount: '15.49',
      direction: 'out',
      date: '2026-06-12',
      accountId: 'acct-A',
      categoryId: null,
    });
    // Netflix normalizes to a known entertainment merchant — confidently routed.
    expect(t.categoryId).not.toBe('uncategorized');
    expect(t.amountCents).toBe(-1549);
  });

  it('a gibberish descriptor with no category lands in review', () => {
    const t = prepareManualTransaction({
      descriptor: 'XQZ 7741 ZZ',
      amount: '9.99',
      direction: 'out',
      date: '2026-06-12',
      accountId: 'acct-A',
    });
    expect(t.needsReview).toBe(true);
  });
});

describe('prepareManualTransaction — validation', () => {
  const base = {
    descriptor: 'Test',
    amount: '10',
    direction: 'out' as const,
    date: '2026-06-12',
    accountId: 'acct-A',
    categoryId: 'shopping',
  };

  it('rejects an empty description', () => {
    expect(() => prepareManualTransaction({ ...base, descriptor: '   ' })).toThrow(/description/i);
  });

  it('rejects a missing account', () => {
    expect(() => prepareManualTransaction({ ...base, accountId: '' })).toThrow(/account/i);
  });

  it('rejects a zero or negative amount', () => {
    expect(() => prepareManualTransaction({ ...base, amount: '0' })).toThrow(/greater than zero/i);
    expect(() => prepareManualTransaction({ ...base, amount: '-5' })).toThrow(/greater than zero/i);
  });

  it('rejects a malformed amount', () => {
    expect(() => prepareManualTransaction({ ...base, amount: 'abc' })).toThrow();
    expect(() => prepareManualTransaction({ ...base, amount: '10.999' })).toThrow();
  });

  it('rejects a malformed date', () => {
    expect(() => prepareManualTransaction({ ...base, date: '2026-13-40' })).toThrow();
  });

  it('rejects an unknown explicit category slug', () => {
    expect(() => prepareManualTransaction({ ...base, categoryId: 'not-a-real-category' })).toThrow(
      /unknown category/i,
    );
  });
});

describe('prepareManualTransaction — custom categories via extraValidCategoryIds (#136)', () => {
  const CUSTOM_ID = 'cmr0custom0000cuidgolf0001'; // a per-user cuid, unknown to CATEGORY_BY_ID
  const base = {
    descriptor: 'GREENS FEE',
    amount: '54.00',
    direction: 'out' as const,
    date: '2026-06-15',
    accountId: 'acct-A',
    categoryId: CUSTOM_ID,
  };

  it('accepts a custom id present in the caller-verified extra set', () => {
    const t = prepareManualTransaction(base, [], new Set([CUSTOM_ID]));
    expect(t.categoryId).toBe(CUSTOM_ID);
    expect(t.amountCents).toBe(-5400);
    expect(t.needsReview).toBe(false); // explicit category is authoritative
    expect(t.isTransfer).toBe(false); // a cuid can never be the 'transfer' slug
  });

  it('still rejects a custom id when no extra set is supplied (default unchanged)', () => {
    expect(() => prepareManualTransaction(base)).toThrow(/unknown category/i);
  });

  it('rejects an id absent from the extra set (defense in depth)', () => {
    expect(() =>
      prepareManualTransaction(base, [], new Set(['cmr0someoneelses0000cuid02'])),
    ).toThrow(/unknown category/i);
  });
});
