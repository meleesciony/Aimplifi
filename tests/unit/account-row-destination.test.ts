/**
 * Locks for `accountRowDestination` — where an account row on /accounts takes
 * the reader (the mortgage dead-end slice, owner 2026-08-11).
 *
 * The invariant: a row may link to the transactions register ONLY for types
 * inside the register's own basis (`SPENDING_ACCOUNT_TYPES`) — asserted here
 * against that very import, not a restated list, so a widened basis widens
 * this lock's expectation with it (a guard must read what it guards).
 */
import { describe, it, expect } from 'vitest';
import { accountRowDestination } from '@/lib/engine/account/row-destination';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { ACCOUNT_TYPE_LABEL } from '@/lib/engine/account/type-label';

// The app's full account-type vocabulary — the label map is its one shared
// enumeration (AccountView.type's docblock lists the same eleven).
const ALL_TYPES = Object.keys(ACCOUNT_TYPE_LABEL);

describe('accountRowDestination', () => {
  it('covers the full type vocabulary — every type resolves to exactly one destination kind', () => {
    for (const type of ALL_TYPES) {
      const d = accountRowDestination({ id: 'a1', type });
      expect(['register', 'holdings', 'detail']).toContain(d.kind);
    }
  });

  it("links to the register EXACTLY for the register's own basis — the owner's mortgage can never again land on a structurally-empty /transactions", () => {
    for (const type of ALL_TYPES) {
      const d = accountRowDestination({ id: 'a1', type });
      expect(d.kind === 'register').toBe(SPENDING_ACCOUNT_TYPES.includes(type));
    }
  });

  it('keeps the #159 special case: a linked brokerage opens its holdings, scoped to the account', () => {
    expect(accountRowDestination({ id: 'brok-1', type: 'INVESTMENT' })).toEqual({
      kind: 'holdings',
      href: '/investments?account=brok-1',
    });
  });

  it('spending accounts open their transactions, scoped to the account', () => {
    expect(accountRowDestination({ id: 'chk-1', type: 'CHECKING' })).toEqual({
      kind: 'register',
      href: '/transactions?account=chk-1',
    });
  });

  it('every non-register, non-investment type expands its detail in place', () => {
    for (const type of ['LOAN', 'MORTGAGE', 'REAL_ESTATE', 'VEHICLE', 'CASH', 'OTHER_ASSET', 'OTHER_LIABILITY']) {
      expect(accountRowDestination({ id: 'a1', type })).toEqual({ kind: 'detail' });
    }
  });

  it('is total over unknown type strings — an unrecognized type gets the safe in-place detail, never a register link', () => {
    expect(accountRowDestination({ id: 'a1', type: 'CRYPTO_WALLET' })).toEqual({ kind: 'detail' });
  });
});
