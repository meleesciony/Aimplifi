import { describe, expect, it } from 'vitest';
import {
  resolveInvestmentScope,
  type ScopableInvestmentAccount,
} from '@/lib/engine/investments/scope';

/** Minimal fixtures: only the fields the resolver reads (id, name, positions count). */
const acct = (id: string, name: string, positionCount: number): ScopableInvestmentAccount => ({
  accountId: id,
  accountName: name,
  portfolio: { positions: Array.from({ length: positionCount }, (_, i) => i) },
});

const BROKERAGE = acct('acc_brok', 'Brokerage', 5);
const ROTH = acct('acc_roth', 'Roth IRA', 3);
const K401 = acct('acc_401k', '401(k)', 2);

describe('resolveInvestmentScope', () => {
  it('no scoped id → full list, no scope active (byte-identical to pre-#160)', () => {
    const accounts = [BROKERAGE, ROTH];
    const scope = resolveInvestmentScope(accounts, undefined);
    expect(scope.accounts).toBe(accounts); // same array reference — nothing narrowed
    expect(scope.scopedName).toBeNull();
    expect(scope.showAllAccounts).toBe(false);
  });

  it('is INERT with a single account even when the id matches (the demo case → golden-safe)', () => {
    const accounts = [BROKERAGE];
    const scope = resolveInvestmentScope(accounts, 'acc_brok');
    // One investment account: nothing to narrow to → full, no chip. The single-brokerage
    // demo renders identically whether or not the row-link carries ?account.
    expect(scope.accounts).toEqual([BROKERAGE]);
    expect(scope.scopedName).toBeNull();
    expect(scope.showAllAccounts).toBe(false);
  });

  it('is INERT with zero accounts and any id', () => {
    const scope = resolveInvestmentScope([] as ScopableInvestmentAccount[], 'acc_anything');
    expect(scope.accounts).toEqual([]);
    expect(scope.scopedName).toBeNull();
    expect(scope.showAllAccounts).toBe(false);
  });

  it('active scope with 2 accounts filters OUT the non-matching account', () => {
    const scope = resolveInvestmentScope([BROKERAGE, ROTH], 'acc_roth');
    expect(scope.accounts).toEqual([ROTH]); // Brokerage dropped
    expect(scope.scopedName).toBe('Roth IRA');
    expect(scope.showAllAccounts).toBe(true);
  });

  it('active scope with 3 accounts keeps only the matched one', () => {
    const scope = resolveInvestmentScope([BROKERAGE, ROTH, K401], 'acc_401k');
    expect(scope.accounts).toEqual([K401]);
    expect(scope.scopedName).toBe('401(k)');
    expect(scope.showAllAccounts).toBe(true);
  });

  it('unknown id (stale/typed link) with multiple accounts → full fallback', () => {
    const accounts = [BROKERAGE, ROTH];
    const scope = resolveInvestmentScope(accounts, 'acc_ghost');
    expect(scope.accounts).toBe(accounts);
    expect(scope.scopedName).toBeNull();
    expect(scope.showAllAccounts).toBe(false);
  });

  it('a matched-but-empty account → full fallback (no confusing empty scoped view)', () => {
    const EMPTY = acct('acc_empty', 'Empty Brokerage', 0);
    const accounts = [BROKERAGE, EMPTY];
    const scope = resolveInvestmentScope(accounts, 'acc_empty');
    expect(scope.accounts).toBe(accounts); // falls back to the full list
    expect(scope.scopedName).toBeNull();
    expect(scope.showAllAccounts).toBe(false);
  });

  it('preserves account order when scoping is inert', () => {
    const accounts = [ROTH, BROKERAGE, K401];
    const scope = resolveInvestmentScope(accounts, undefined);
    expect(scope.accounts.map((a) => a.accountId)).toEqual(['acc_roth', 'acc_brok', 'acc_401k']);
  });
});
