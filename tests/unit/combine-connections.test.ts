/**
 * Planning a both-live duplicate combine (TASKS L.6 / L.10; ACCOUNT_IDENTITY_ARCHITECTURE §4 layer 3).
 *
 * Lead scenario is the owner's, from his 2026-07-24 /accounts screenshots: "Plaid: Chase ·
 * connection 1 of 4" and "connection 4 of 4", each carrying `CREDIT CARD ····0977`, both live,
 * both counting. The engine must offer to combine them — and must REFUSE any direction that
 * would disconnect a connection carrying an account the combine does not resolve, because
 * freezing a real account silently is the same class of harm as double-counting one.
 */
import { describe, expect, it } from 'vitest';

import {
  planCombinableConnections,
  type CombineConnectionAccount,
  type CombineConnectionItem,
} from '@/lib/engine/account/combine-connections';

function item(p: Partial<CombineConnectionItem> & { itemId: string }): CombineConnectionItem {
  return {
    institutionId: 'ins_56',
    institutionName: 'Chase',
    lastSyncedAt: '2026-07-24',
    lastSyncError: null,
    linkedAtKey: '2026-01-01T00:00:00.000Z',
    ...p,
  };
}

function acct(
  p: Partial<CombineConnectionAccount> & { id: string; plaidItemId: string },
): CombineConnectionAccount {
  return {
    provider: 'plaid',
    name: 'CREDIT CARD',
    institutionId: 'ins_56',
    institutionName: 'Chase',
    mask: '0977',
    type: 'CREDIT',
    subtype: 'credit card',
    currency: 'USD',
    persistentAccountId: null,
    ...p,
  };
}

const OLD = item({ itemId: 'item-old', linkedAtKey: '2026-01-01T00:00:00.000Z' });
const NEW = item({ itemId: 'item-new', linkedAtKey: '2026-06-01T00:00:00.000Z' });

describe('planCombinableConnections — the owner’s Chase pair', () => {
  const accounts = [acct({ id: 'a-old', plaidItemId: 'item-old' }), acct({ id: 'a-new', plaidItemId: 'item-new' })];

  it('offers the combine, keeping the connection that was linked first', () => {
    const [p] = planCombinableConnections([OLD, NEW], accounts);
    expect(p).toBeDefined();
    expect(p.institutionLabel).toBe('Chase');
    expect(p.recommended.keepItemId).toBe('item-old');
    expect(p.recommended.dropItemId).toBe('item-new');
    expect(p.recommended.offerable).toBe(true);
    expect(p.recommended.pairs).toEqual([
      expect.objectContaining({
        predecessorAccountId: 'a-new',
        successorAccountId: 'a-old',
        mask: '0977',
        tier: 'A',
      }),
    ]);
  });

  it('offers the other direction too, so the user chooses which connection survives', () => {
    const [p] = planCombinableConnections([OLD, NEW], accounts);
    expect(p.alternative?.keepItemId).toBe('item-new');
    expect(p.alternative?.dropItemId).toBe('item-old');
    expect(p.alternative?.pairs[0].predecessorAccountId).toBe('a-old');
  });

  it('is deterministic — input order never changes the recommendation', () => {
    const forward = planCombinableConnections([OLD, NEW], accounts);
    const backward = planCombinableConnections([NEW, OLD], [...accounts].reverse());
    expect(backward).toEqual(forward);
  });
});

describe('planCombinableConnections — which connection survives', () => {
  const accounts = [acct({ id: 'a-old', plaidItemId: 'item-old' }), acct({ id: 'a-new', plaidItemId: 'item-new' })];

  it('drops the connection carrying a sync error, even though it is the older one', () => {
    const [p] = planCombinableConnections([item({ ...OLD, lastSyncError: 'ITEM_LOGIN_REQUIRED' }), NEW], accounts);
    expect(p.recommended.keepItemId).toBe('item-new');
    expect(p.recommended.dropItemId).toBe('item-old');
  });

  it('drops the staler connection when both are healthy', () => {
    const [p] = planCombinableConnections([item({ ...OLD, lastSyncedAt: '2026-07-01' }), NEW], accounts);
    expect(p.recommended.keepItemId).toBe('item-new');
  });

  it('treats a connection that never synced as the stalest', () => {
    const [p] = planCombinableConnections([item({ ...OLD, lastSyncedAt: null }), NEW], accounts);
    expect(p.recommended.keepItemId).toBe('item-new');
  });
});

describe('planCombinableConnections — refuses to strand an account', () => {
  it('does not offer a direction that would freeze a non-duplicate account', () => {
    const accounts = [
      acct({ id: 'a-old', plaidItemId: 'item-old' }),
      acct({ id: 'a-new', plaidItemId: 'item-new' }),
      // The newer connection also carries a checking account that exists nowhere else.
      acct({ id: 'chk-new', plaidItemId: 'item-new', name: 'CHECKING', mask: '1111', type: 'CHECKING', subtype: 'checking' }),
    ];
    const [p] = planCombinableConnections([OLD, NEW], accounts);
    // Dropping the newer connection would strand the checking account, so the offer flips.
    expect(p.recommended.keepItemId).toBe('item-new');
    expect(p.recommended.dropItemId).toBe('item-old');
    expect(p.alternative).toBeNull();
  });

  it('names what would be stranded so the UI can say why the other way round is not offered', () => {
    const accounts = [
      acct({ id: 'a-old', plaidItemId: 'item-old' }),
      acct({ id: 'a-new', plaidItemId: 'item-new' }),
      acct({ id: 'chk-new', plaidItemId: 'item-new', name: 'CHECKING', mask: '1111', type: 'CHECKING', subtype: 'checking' }),
      acct({ id: 'sav-old', plaidItemId: 'item-old', name: 'SAVINGS', mask: '2222', type: 'SAVINGS', subtype: 'savings' }),
    ];
    // Now BOTH sides carry something unique → neither direction is safe → no proposal at all.
    expect(planCombinableConnections([OLD, NEW], accounts)).toEqual([]);
  });

  it('offers nothing when a row could be either of two rows on the other side', () => {
    const accounts = [
      acct({ id: 'a-old', plaidItemId: 'item-old' }),
      acct({ id: 'a-new', plaidItemId: 'item-new' }),
      // A second row on the other connection with the SAME last-4. Whichever way round it is
      // read, one row would have to be matched by name order — and picking the wrong one folds a
      // real account into a stranger. Two proofs of the same thing prove neither.
      acct({ id: 'a-new-2', plaidItemId: 'item-new' }),
    ];
    expect(planCombinableConnections([OLD, NEW], accounts)).toEqual([]);
  });
});

describe('planCombinableConnections — abstains', () => {
  it('says nothing about connections at different banks', () => {
    const amex = item({ itemId: 'item-amex', institutionId: 'ins_9', institutionName: 'American Express' });
    const accounts = [
      acct({ id: 'a-old', plaidItemId: 'item-old' }),
      acct({ id: 'a-amex', plaidItemId: 'item-amex', institutionId: 'ins_9', institutionName: 'American Express' }),
    ];
    expect(planCombinableConnections([OLD, amex], accounts)).toEqual([]);
  });

  it('says nothing when the two connections’ cards have different last-4s', () => {
    const accounts = [
      acct({ id: 'a-old', plaidItemId: 'item-old', mask: '0977' }),
      acct({ id: 'a-new', plaidItemId: 'item-new', mask: '4927' }),
    ];
    expect(planCombinableConnections([OLD, NEW], accounts)).toEqual([]);
  });

  it('says nothing when a connection carries no accounts yet', () => {
    const accounts = [acct({ id: 'a-old', plaidItemId: 'item-old' })];
    expect(planCombinableConnections([OLD, NEW], accounts)).toEqual([]);
  });

  it('says nothing about a single connection', () => {
    expect(planCombinableConnections([OLD], [acct({ id: 'a-old', plaidItemId: 'item-old' })])).toEqual([]);
  });

  it('never proposes on balances or names — an unidentifiable pair is left alone', () => {
    const accounts = [
      acct({ id: 'a-old', plaidItemId: 'item-old', mask: null }),
      acct({ id: 'a-new', plaidItemId: 'item-new', mask: null }),
    ];
    expect(planCombinableConnections([OLD, NEW], accounts)).toEqual([]);
  });
});
