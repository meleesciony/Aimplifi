/**
 * Cross-provider duplicate-account detection (DECISIONS #192).
 * Hand-verified scenarios; see docs/EDGE_CASES.md §Duplicate-Accounts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type DuplicateAccountCandidate,
  detectDuplicateAccounts,
  distinctiveNameTokens,
  hasSuspectedDuplicates,
} from '@/lib/engine/account/duplicates';
import { getAccountsView } from '@/server/transactions';
import { prisma } from '@/lib/db';

function acct(p: Partial<DuplicateAccountCandidate> & { id: string }): DuplicateAccountCandidate {
  return {
    provider: 'plaid',
    name: 'Account',
    type: 'CHECKING',
    mask: null,
    currentBalanceCents: 0,
    currency: 'USD',
    ...p,
  };
}

describe('distinctiveNameTokens', () => {
  it('drops stopwords, numbers, and single chars; keeps institution tokens', () => {
    expect([...distinctiveNameTokens('Chase Total Checking 1234')].sort()).toEqual(['chase', 'total']);
    expect([...distinctiveNameTokens('My Savings Account')]).toEqual([]); // all stopwords
    expect([...distinctiveNameTokens('SimpleFIN Demo SimpleFIN Savings')]).toEqual([]);
    expect([...distinctiveNameTokens('WELLS FARGO')].sort()).toEqual(['fargo', 'wells']);
  });
});

describe('detectDuplicateAccounts', () => {
  it('flags cross-provider same-institution names (medium) — the core Plaid↔SimpleFIN case', () => {
    const pairs = detectDuplicateAccounts([
      acct({ id: 'p', provider: 'plaid', name: 'Chase Total Checking', mask: '1234', currentBalanceCents: 50000 }),
      acct({ id: 's', provider: 'simplefin', name: 'CHASE Checking', mask: null, currentBalanceCents: 48000 }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe('medium');
    expect(pairs[0].reasons).toEqual(['shared name: “chase”']);
    // deterministic ordering: plaid sorts before simplefin
    expect([pairs[0].a.id, pairs[0].b.id]).toEqual(['p', 's']);
  });

  it('flags identical non-zero balance as HIGH even when names do not overlap', () => {
    const pairs = detectDuplicateAccounts([
      acct({ id: 'p', provider: 'plaid', name: 'Savings', type: 'SAVINGS', mask: '2222', currentBalanceCents: 21000 }),
      acct({ id: 's', provider: 'simplefin', name: 'My Savings', type: 'SAVINGS', currentBalanceCents: 21000 }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe('high');
    expect(pairs[0].reasons).toEqual(['identical balance']);
  });

  it('flags matching last-4 as HIGH and lists both signals when name also overlaps', () => {
    const pairs = detectDuplicateAccounts([
      acct({ id: 'p', provider: 'plaid', name: 'Chase', mask: '1234', currentBalanceCents: 50000 }),
      acct({ id: 'm', provider: 'manual', name: 'Chase Bank', mask: '1234', currentBalanceCents: 30000 }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe('high');
    expect(pairs[0].reasons).toEqual(['same last-4 (1234)', 'shared name: “chase”']);
  });

  it('does NOT flag identical ZERO balances with no other signal (empty accounts)', () => {
    // Stopword-only names → no shared distinctive token, so only the (excluded) zero-balance
    // signal remains → nothing flagged.
    expect(
      detectDuplicateAccounts([
        acct({ id: 'p', provider: 'plaid', name: 'Checking Account', currentBalanceCents: 0 }),
        acct({ id: 's', provider: 'simplefin', name: 'My Bank', currentBalanceCents: 0 }),
      ]),
    ).toEqual([]);
  });

  it('does NOT flag different account types even with same name and balance', () => {
    expect(
      detectDuplicateAccounts([
        acct({ id: 'p', provider: 'plaid', name: 'Chase', type: 'CHECKING', currentBalanceCents: 5000 }),
        acct({ id: 's', provider: 'simplefin', name: 'Chase', type: 'CREDIT', currentBalanceCents: 5000 }),
      ]),
    ).toEqual([]);
  });

  it('does NOT flag different currencies', () => {
    expect(
      detectDuplicateAccounts([
        acct({ id: 'p', provider: 'plaid', name: 'Chase', currency: 'USD', currentBalanceCents: 5000 }),
        acct({ id: 's', provider: 'simplefin', name: 'Chase', currency: 'EUR', currentBalanceCents: 5000 }),
      ]),
    ).toEqual([]);
    // null currency is assumed USD, so null↔USD with a shared name still matches
    expect(
      detectDuplicateAccounts([
        acct({ id: 'p', provider: 'plaid', name: 'Chase', currency: null, currentBalanceCents: 5000 }),
        acct({ id: 's', provider: 'simplefin', name: 'Chase', currency: 'USD', currentBalanceCents: 7000 }),
      ]),
    ).toHaveLength(1);
  });

  it('does NOT flag same-provider pairs (ingest already dedups within a provider)', () => {
    expect(
      detectDuplicateAccounts([
        acct({ id: 'a', provider: 'plaid', name: 'Chase', mask: '1234', currentBalanceCents: 5000 }),
        acct({ id: 'b', provider: 'plaid', name: 'Chase', mask: '1234', currentBalanceCents: 5000 }),
      ]),
    ).toEqual([]);
  });

  it('never compares demo/seed rows', () => {
    expect(
      detectDuplicateAccounts([
        acct({ id: 'd', provider: 'demo', name: 'Plaid Checking', mask: '0000', currentBalanceCents: 11000 }),
        acct({ id: 's', provider: 'simplefin', name: 'Plaid Checking', currentBalanceCents: 11000 }),
      ]),
    ).toEqual([]);
  });

  it('orders high-confidence pairs before medium ones', () => {
    const pairs = detectDuplicateAccounts([
      acct({ id: 'p1', provider: 'plaid', name: 'Wells Fargo', type: 'CHECKING', currentBalanceCents: 111 }),
      acct({ id: 's1', provider: 'simplefin', name: 'WELLS FARGO', type: 'CHECKING', currentBalanceCents: 999 }), // name only → medium
      acct({ id: 'p2', provider: 'plaid', name: 'Amex', type: 'CREDIT', mask: '9', currentBalanceCents: 4000 }),
      acct({ id: 'm2', provider: 'manual', name: 'Amex', type: 'CREDIT', mask: '9', currentBalanceCents: 4000 }), // mask+bal+name → high
    ]);
    expect(pairs.map((p) => p.confidence)).toEqual(['high', 'medium']);
  });

  it('hasSuspectedDuplicates mirrors detect', () => {
    expect(hasSuspectedDuplicates([acct({ id: 'x' })])).toBe(false);
    expect(
      hasSuspectedDuplicates([
        acct({ id: 'p', provider: 'plaid', name: 'Chase', currentBalanceCents: 100 }),
        acct({ id: 's', provider: 'simplefin', name: 'Chase', currentBalanceCents: 200 }),
      ]),
    ).toBe(true);
  });

  it('handles the empty / single-account cases', () => {
    expect(detectDuplicateAccounts([])).toEqual([]);
    expect(detectDuplicateAccounts([acct({ id: 'only' })])).toEqual([]);
  });
});

/**
 * Integration: drive the REAL getAccountsView against a throwaway user with a Plaid + a
 * SimpleFIN account that share a name — proving the server surfaces `duplicates`, not just
 * the pure engine. Unique per-run id, own rows only, never the seeded `user-demo`, cleans up.
 */
describe('getAccountsView duplicates (integration — real server view)', () => {
  const id = `dup-view-${Date.now()}-${process.pid}`;
  const wipe = () => prisma.user.deleteMany({ where: { id } });

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id, email: `${id}@test.local` } });
    await prisma.account.createMany({
      data: [
        { userId: id, provider: 'plaid', providerRef: 'p1', name: 'Chase Total Checking', type: 'CHECKING', mask: '1234', currentBalanceCents: 50000, currency: 'USD' },
        { userId: id, provider: 'simplefin', providerRef: 's1', name: 'CHASE Checking', type: 'CHECKING', currentBalanceCents: 48000, currency: 'USD' },
        { userId: id, provider: 'plaid', providerRef: 'p2', name: 'Fidelity Brokerage', type: 'INVESTMENT', currentBalanceCents: 900000, currency: 'USD' },
      ],
    });
  });
  afterAll(wipe);

  it('surfaces the cross-provider pair (and not the unrelated third account)', async () => {
    const view = await getAccountsView(id);
    expect(view.duplicates).toHaveLength(1);
    const [pair] = view.duplicates;
    expect(new Set([pair.a.provider, pair.b.provider])).toEqual(new Set(['plaid', 'simplefin']));
    expect(pair.reasons).toContain('shared name: “chase”');
  });

  it('the seeded demo user (single provider) surfaces zero duplicates — golden-safe', async () => {
    const demo = await getAccountsView('user-demo');
    expect(demo.duplicates).toEqual([]);
  });
});
