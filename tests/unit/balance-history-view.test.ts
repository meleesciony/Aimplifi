/**
 * The U.5 copy, locked where it lives (TASKS U.5).
 *
 * These sentences were inline ternaries in `account-detail-panel.tsx` for one
 * draft, and that draft shipped a singular/plural defect in the branch the
 * component test did not cover — the reason this repo's rule is that a rule
 * written in a .tsx cannot be locked by a unit test.
 */
import { describe, expect, it } from 'vitest';
import {
  uncountedBalanceMarker,
  uncountedBalancesNote,
} from '@/lib/engine/account/balance-history-view';

describe('uncountedBalanceMarker', () => {
  it('names the figure the trend used, with the counterpart row’s own sign', () => {
    expect(uncountedBalanceMarker({ name: 'Auto Loan Retired', balanceCents: 1_430_000, isLiability: true })).toBe(
      'your net worth counts −$14,300.00 from Auto Loan Retired',
    );
  });

  it('an ASSET counterpart carries no minus — the sign is the row’s class, not the panel’s', () => {
    expect(uncountedBalanceMarker({ name: 'Old Savings', balanceCents: 250_000, isLiability: false })).toBe(
      'your net worth counts $2,500.00 from Old Savings',
    );
  });

  it('states only what is certain when no single counterpart owns the date', () => {
    // A chain: the date's owner is not this account's direct counterpart, so
    // naming one would attribute the balance to the wrong account.
    expect(uncountedBalanceMarker(null)).toBe('not in your net worth');
  });

  it('is never positional — "here" inside a list titled Recorded balance history contradicts itself', () => {
    // The L.19/L.20 correction, applied to a new marker in the same family.
    expect(uncountedBalanceMarker(null)).not.toContain('here');
    expect(uncountedBalanceMarker({ name: 'X', balanceCents: 1, isLiability: true })).not.toContain('here');
  });
});

describe('uncountedBalancesNote', () => {
  it('nothing uncounted → no sentence at all (the golden panel is byte-identical)', () => {
    expect(uncountedBalancesNote(0)).toBeNull();
    expect(uncountedBalancesNote(-1)).toBeNull();
  });

  it('agrees with itself in the singular', () => {
    const note = uncountedBalancesNote(1) ?? '';
    expect(note).toContain('One balance here is not in your net worth');
    expect(note).toContain('that date');
    expect(note).not.toContain('those dates');
  });

  it('agrees with itself in the plural', () => {
    const note = uncountedBalancesNote(3) ?? '';
    expect(note).toContain('3 balances here are not in your net worth');
    expect(note).toContain('those dates');
    expect(note).not.toContain('that date —');
  });

  it('never claims the two balances would "double" anything — they differ, which is why one has to win', () => {
    const note = uncountedBalancesNote(2) ?? '';
    expect(note).not.toContain('double');
    expect(note).toContain('not counted twice');
  });

  it('points at the surface that shows the pair, because the named account is folded out of the groups', () => {
    expect(uncountedBalancesNote(1) ?? '').toContain('Account cleanup');
  });
});
