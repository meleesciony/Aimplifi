import { describe, expect, it } from 'vitest';
import {
  MANUAL_ASSET_TYPES,
  MANUAL_LIABILITY_TYPES,
  isManualType,
  parseManualAccount,
  parseManualValueCents,
} from '@/lib/engine/networth/manual';
import { groupAccounts, isLiabilityType, type AccountView } from '@/lib/engine/transactions/query';

describe('manual type catalog (DECISIONS #39)', () => {
  it('classifies manual asset types as assets and manual liability types as liabilities', () => {
    for (const t of MANUAL_ASSET_TYPES) expect(isLiabilityType(t.id)).toBe(false);
    for (const t of MANUAL_LIABILITY_TYPES) expect(isLiabilityType(t.id)).toBe(true);
  });
  it('isManualType recognizes manual types but not linked ones', () => {
    expect(isManualType('REAL_ESTATE')).toBe(true);
    expect(isManualType('MORTGAGE')).toBe(true);
    expect(isManualType('CHECKING')).toBe(false);
    expect(isManualType('CREDIT')).toBe(false);
  });
});

describe('parseManualValueCents', () => {
  it('parses a positive dollar amount to cents', () => {
    expect(parseManualValueCents('250000')).toEqual({ ok: true, cents: 25_000_000 });
    expect(parseManualValueCents('  19.99 ')).toEqual({ ok: true, cents: 1999 });
  });
  it('rejects zero, negative, junk, and absurd amounts', () => {
    expect(parseManualValueCents('0').ok).toBe(false);
    expect(parseManualValueCents('-5').ok).toBe(false);
    expect(parseManualValueCents('abc').ok).toBe(false);
    expect(parseManualValueCents('9999999999').ok).toBe(false);
  });
});

describe('parseManualAccount', () => {
  it('accepts a valid home asset', () => {
    expect(parseManualAccount({ name: 'Primary home', type: 'REAL_ESTATE', value: '525000' })).toEqual({
      ok: true,
      account: { name: 'Primary home', type: 'REAL_ESTATE', currentBalanceCents: 52_500_000 },
    });
  });
  it('reports all problems at once', () => {
    const r = parseManualAccount({ name: '   ', type: 'NOPE', value: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('net worth includes manual items (groupAccounts)', () => {
  it('a home asset and a mortgage land on the right sides and net correctly', () => {
    const accounts: AccountView[] = [
      { id: 'a', name: 'Checking', type: 'CHECKING', mask: null, currentBalanceCents: 10_000_00 },
      { id: 'b', name: 'Home', type: 'REAL_ESTATE', mask: null, currentBalanceCents: 500_000_00, manual: true },
      { id: 'c', name: 'Mortgage', type: 'MORTGAGE', mask: null, currentBalanceCents: 350_000_00, manual: true },
    ];
    const g = groupAccounts(accounts);
    expect(g.assets.subtotalCents).toBe(510_000_00); // checking + home
    expect(g.liabilities.subtotalCents).toBe(350_000_00); // mortgage
    expect(g.netWorthCents).toBe(160_000_00); // 510k − 350k
  });
});
