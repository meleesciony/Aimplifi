/**
 * Cross-provider duplicate-account detection (DECISIONS #192).
 * Hand-verified scenarios; see docs/EDGE_CASES.md §Duplicate-Accounts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type DuplicateAccountCandidate,
  type HouseholdDuplicateAccountCandidate,
  detectDuplicateAccounts,
  detectHouseholdDuplicateAccounts,
  distinctiveNameTokens,
  hasSuspectedDuplicates,
} from '@/lib/engine/account/duplicates';
import { getAccountsView } from '@/server/transactions';
import { duplicatePairDismissKey } from '@/server/duplicate-dismissal';
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

  it('does NOT flag two accounts with DIFFERENT last-4, even on a shared name (owner: his Venture ····6271 vs her Venture ····0966)', () => {
    // Two Capital One "Venture" cards connected through DIFFERENT Plaid items (his + spouse).
    // Shared name "venture", but different last-4 → definitively different cards → never flagged.
    expect(
      detectDuplicateAccounts([
        acct({ id: 'his', provider: 'plaid', plaidItemId: 'item-his', name: 'Venture', type: 'CREDIT', mask: '6271', currentBalanceCents: 1021899 }),
        acct({ id: 'hers', provider: 'plaid', plaidItemId: 'item-hers', name: 'Venture', type: 'CREDIT', mask: '0966', currentBalanceCents: 0 }),
      ]),
    ).toEqual([]);
  });

  it('a differing last-4 with an IDENTICAL non-zero balance IS surfaced (might be one account with two cards)', () => {
    // Different last-4 = different CARDS, but the same non-zero balance points at ONE account seen
    // twice (e.g. a spouse's authorized-user card). The differing last-4 disqualifies the shared
    // NAME, but the identical balance carries it — surfaced so the user can Combine or dismiss.
    const pairs = detectDuplicateAccounts([
      acct({ id: 'p', provider: 'plaid', name: 'Venture', type: 'CREDIT', mask: '6271', currentBalanceCents: 50000 }),
      acct({ id: 'm', provider: 'manual', name: 'Venture', type: 'CREDIT', mask: '0966', currentBalanceCents: 50000 }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe('high');
    expect(pairs[0].reasons).toEqual(['identical balance']); // NOT the shared name (disqualified by the differing last-4)
  });

  it('still flags when only ONE side has a last-4 (SimpleFIN carries none) — the veto needs BOTH masks', () => {
    // The veto must NOT fire when one side is mask-null, or a real Plaid↔SimpleFIN duplicate
    // (the whole reason #192 exists) would stop being detected.
    const pairs = detectDuplicateAccounts([
      acct({ id: 'p', provider: 'plaid', name: 'Chase', mask: '6271', currentBalanceCents: 50000 }),
      acct({ id: 's', provider: 'simplefin', name: 'Chase', mask: null, currentBalanceCents: 48000 }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].reasons).toContain('shared name: “chase”');
  });

  it('SURFACES the his/wife Chase pair (SimpleFIN "Chase Bank E. LEE (4034)" vs Plaid "M. LEE" ····4927) because the balance is identical', () => {
    // Owner-confirmed 2026-07-24: this is likely ONE account (his + his wife's authorized card) seen
    // through two connections, so the identical balance genuinely double-counts. SimpleFIN carries no
    // mask column, and we do NOT parse the "(4034)" out of the name (that mis-reads years — critic
    // F1/F2). The identical balance surfaces it so the owner can Combine (one account) or dismiss.
    const pairs = detectDuplicateAccounts([
      acct({ id: 'sf', provider: 'simplefin', name: 'Chase Bank E. LEE (4034)', type: 'CHECKING', mask: null, currentBalanceCents: 250000 }),
      acct({ id: 'pl', provider: 'plaid', name: 'M. LEE', type: 'CHECKING', mask: '4927', currentBalanceCents: 250000 }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].reasons).toContain('identical balance');
  });

  it('does NOT read a parenthesized YEAR as a last-4 — a real duplicate with an identical balance still flags (critic F1)', () => {
    // "Roth IRA (2021)" (the year, not a last-4) vs a live Plaid Roth IRA with a real mask, same
    // balance: we must NOT suppress it. Using the mask COLUMN only (no name parsing) means the
    // identical balance carries it — the genuine duplicate is never silently hidden.
    const pairs = detectDuplicateAccounts([
      acct({ id: 'm', provider: 'manual', name: 'Roth IRA (2021)', type: 'INVESTMENT', mask: null, currentBalanceCents: 5000000 }),
      acct({ id: 'p', provider: 'plaid', name: 'Fidelity Roth IRA', type: 'INVESTMENT', mask: '8842', currentBalanceCents: 5000000 }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].reasons).toContain('identical balance');
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

/**
 * Household variant (TASKS 4.2 slice 8 — critic F5 / T9(b)): two partners each
 * connecting the SAME real joint account mint two Account rows with different
 * ids, invisible to the merge's disjoint-by-id guard. The detector is the
 * DISCLOSURE half — advisory only, figures never adjusted.
 */
describe('detectHouseholdDuplicateAccounts (slice 8 — F5 / T9(b))', () => {
  function hAcct(
    p: Partial<HouseholdDuplicateAccountCandidate> & { id: string; ownerId: string },
  ): HouseholdDuplicateAccountCandidate {
    return { ...acct(p), ownerId: p.ownerId };
  }

  it('flags a cross-owner CROSS-provider pair — the classic joint-account shape', () => {
    const pairs = detectHouseholdDuplicateAccounts([
      hAcct({ id: 'a', ownerId: 'u1', provider: 'plaid', name: 'Chase Joint Checking', mask: '1234', currentBalanceCents: 512_345 }),
      hAcct({ id: 'b', ownerId: 'u2', provider: 'simplefin', name: 'CHASE Joint Checking', mask: null, currentBalanceCents: 512_345 }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe('high'); // identical non-zero balance
    expect(new Set([pairs[0].a.ownerId, pairs[0].b.ownerId])).toEqual(new Set(['u1', 'u2']));
  });

  it('flags a cross-owner SAME-provider pair — the relaxed skip (both partners on Plaid)', () => {
    // The personal detector's same-provider skip ("ingest already dedups") is
    // true within one user and FALSE across two: each partner's Plaid item is
    // its own connection. Regression lock on the relaxed skip.
    const pairs = detectHouseholdDuplicateAccounts([
      hAcct({ id: 'a', ownerId: 'u1', provider: 'plaid', name: 'Chase Joint Checking', mask: '1234', currentBalanceCents: 512_345 }),
      hAcct({ id: 'b', ownerId: 'u2', provider: 'plaid', name: 'Chase Joint Checking', mask: '1234', currentBalanceCents: 512_345 }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe('high');
    expect(pairs[0].reasons).toContain('same last-4 (1234)');
  });

  it('still skips a same-owner same-provider pair — that ingest really does dedup', () => {
    expect(
      detectHouseholdDuplicateAccounts([
        hAcct({ id: 'a', ownerId: 'u1', provider: 'plaid', name: 'Chase Checking', mask: '1234', currentBalanceCents: 512_345 }),
        hAcct({ id: 'b', ownerId: 'u1', provider: 'plaid', name: 'Chase Checking', mask: '1234', currentBalanceCents: 512_345 }),
      ]),
    ).toEqual([]);
  });

  it("a same-owner CROSS-provider pair is still flagged — the viewer's own #192 dupes double household figures too", () => {
    const pairs = detectHouseholdDuplicateAccounts([
      hAcct({ id: 'a', ownerId: 'u1', provider: 'plaid', name: 'Chase Checking', mask: '1234', currentBalanceCents: 50_000 }),
      hAcct({ id: 'b', ownerId: 'u1', provider: 'simplefin', name: 'CHASE Checking', currentBalanceCents: 48_000 }),
    ]);
    expect(pairs).toHaveLength(1);
  });

  it('hard prerequisites unchanged: different type or currency never pairs', () => {
    expect(
      detectHouseholdDuplicateAccounts([
        hAcct({ id: 'a', ownerId: 'u1', provider: 'plaid', name: 'Chase', type: 'CHECKING', currentBalanceCents: 100 }),
        hAcct({ id: 'b', ownerId: 'u2', provider: 'simplefin', name: 'Chase', type: 'SAVINGS', currentBalanceCents: 100 }),
      ]),
    ).toEqual([]);
    expect(
      detectHouseholdDuplicateAccounts([
        hAcct({ id: 'a', ownerId: 'u1', provider: 'plaid', name: 'Chase', currency: 'USD', currentBalanceCents: 100 }),
        hAcct({ id: 'b', ownerId: 'u2', provider: 'simplefin', name: 'Chase', currency: 'EUR', currentBalanceCents: 100 }),
      ]),
    ).toEqual([]);
  });
});

/**
 * Owner-reported /accounts fixes (2026-07-23, #290-adjacent): (a) each Plaid connection now
 * shows the accounts under it (name + last-4) so two same-bank connections are distinguishable;
 * (b) a duplicate warning can be dismissed. Drives the REAL getAccountsView.
 */
describe('getAccountsView — connection accounts + dismissible duplicate warning', () => {
  const uid = `dup-fix-${Date.now()}-${process.pid}`;
  const wipe = async () => {
    await prisma.account.deleteMany({ where: { userId: uid } });
    await prisma.plaidItem.deleteMany({ where: { userId: uid } });
    await prisma.nudgeDismissal.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { id: uid } });
  };
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: uid, email: `${uid}@test.local` } });
  });
  afterAll(wipe);
  beforeEach(async () => {
    await prisma.account.deleteMany({ where: { userId: uid } });
    await prisma.plaidItem.deleteMany({ where: { userId: uid } });
    await prisma.nudgeDismissal.deleteMany({ where: { userId: uid } });
  });

  it('lists each connection’s cards (name + last-4) and vetoes his-vs-spouse Ventures across TWO connections', async () => {
    // The owner's real setup: two Capital One connections (his + spouse). His has Venture ····6271
    // and Venture One ····2689; hers has Venture ····0966. DIFFERENT plaidItems, so the cross-
    // connection pairs reach the mask veto (not the same-item skip) — this exercises the veto on
    // the server path, unlike a single-item setup which would short-circuit before it.
    await prisma.plaidItem.createMany({
      data: [
        { userId: uid, itemId: 'it-his', accessToken: 'enc', institution: 'Capital One' },
        { userId: uid, itemId: 'it-hers', accessToken: 'enc', institution: 'Capital One' },
      ],
    });
    await prisma.account.createMany({
      data: [
        { userId: uid, provider: 'plaid', providerRef: 'v1', plaidItemId: 'it-his', name: 'Venture', type: 'CREDIT', mask: '6271', currentBalanceCents: 1021899, currency: 'USD' },
        { userId: uid, provider: 'plaid', providerRef: 'v2', plaidItemId: 'it-his', name: 'Venture One', type: 'CREDIT', mask: '2689', currentBalanceCents: 0, currency: 'USD' },
        { userId: uid, provider: 'plaid', providerRef: 'v3', plaidItemId: 'it-hers', name: 'Venture', type: 'CREDIT', mask: '0966', currentBalanceCents: 0, currency: 'USD' },
      ],
    });
    const view = await getAccountsView(uid);
    // Each connection lists its OWN cards with last-4, so the two "Capital One" rows are distinguishable.
    expect(view.plaid.items.find((i) => i.itemId === 'it-his')!.accounts).toEqual([
      { name: 'Venture', mask: '6271' },
      { name: 'Venture One', mask: '2689' },
    ]);
    expect(view.plaid.items.find((i) => i.itemId === 'it-hers')!.accounts).toEqual([{ name: 'Venture', mask: '0966' }]);
    // No pair is flagged: his Venture 6271 ↔ his Venture One 2689 is a same-item skip; the two
    // cross-connection pairs (6271↔0966, 2689↔0966) reach the veto and are vetoed on the differing
    // last-4 despite the shared name "Venture" — the owner's false positive is gone via the veto.
    expect(view.duplicates).toEqual([]);
  });

  it('filters out a pair the user has dismissed (the warning is no longer permanent)', async () => {
    // Cross-provider shared-name pair — SimpleFIN carries no last-4, so the veto can't fire and it DOES flag.
    const p = await prisma.account.create({ data: { userId: uid, provider: 'plaid', providerRef: 'cp', name: 'Chase Checking', type: 'CHECKING', mask: '1234', currentBalanceCents: 50000, currency: 'USD' } });
    const s = await prisma.account.create({ data: { userId: uid, provider: 'simplefin', providerRef: 'cs', name: 'CHASE Checking', type: 'CHECKING', mask: null, currentBalanceCents: 48000, currency: 'USD' } });
    expect((await getAccountsView(uid)).duplicates).toHaveLength(1); // surfaces before dismissal
    // The dup:-namespaced NudgeDismissal row the dismiss action writes.
    await prisma.nudgeDismissal.create({ data: { userId: uid, dismissKey: duplicatePairDismissKey(p.id, s.id) } });
    expect((await getAccountsView(uid)).duplicates).toEqual([]); // filtered after
  });

  it('a dismissed pair does NOT re-surface as a reconciliation (combine) candidate either (dup-veto DUP-DISMISS-1)', async () => {
    // A LIVE Plaid "Chase" + a DEAD SimpleFIN "Chase" (no SimpleFIN connection): one live + one
    // dead, shared name, SF mask null so the veto can't fire → a reconciliation CANDIDATE (the
    // "actionable version" of the duplicate warning). An explicit dismiss must bind this surface too.
    await prisma.plaidItem.create({ data: { userId: uid, itemId: 'it-chase', accessToken: 'enc', institution: 'Chase' } });
    const live = await prisma.account.create({ data: { userId: uid, provider: 'plaid', providerRef: 'pc', plaidItemId: 'it-chase', name: 'Chase Checking', type: 'CHECKING', mask: '1234', currentBalanceCents: 50000, currency: 'USD' } });
    const dead = await prisma.account.create({ data: { userId: uid, provider: 'simplefin', providerRef: 'sc', name: 'CHASE Checking', type: 'CHECKING', mask: null, currentBalanceCents: 48000, currency: 'USD' } });
    const before = await getAccountsView(uid);
    expect(before.reconciliationCandidates).toHaveLength(1); // proposed as a combine before dismissal
    await prisma.nudgeDismissal.create({ data: { userId: uid, dismissKey: duplicatePairDismissKey(live.id, dead.id) } });
    const after = await getAccountsView(uid);
    expect(after.reconciliationCandidates).toEqual([]); // the dismissed "not a duplicate" judgment binds here too
  });

  it('DOES propose a reconciliation combine for the his/wife Chase pair — identical balance surfaces it so the owner decides (owner-confirmed 2026-07-24)', async () => {
    // The owner's "Combine accounts" card: a DEAD SimpleFIN "Chase Bank E. LEE (4034)" + a LIVE
    // Plaid "M. LEE" ····4927 (his wife's card on, likely, his account), IDENTICAL balance. It is
    // NOT silently hidden on the differing last-4 — the identical balance points at one real account,
    // so it is surfaced for the owner to Combine (one account) or dismiss (genuinely separate).
    await prisma.plaidItem.create({ data: { userId: uid, itemId: 'it-mlee', accessToken: 'enc', institution: 'Chase' } });
    await prisma.account.create({ data: { userId: uid, provider: 'plaid', providerRef: 'pm', plaidItemId: 'it-mlee', name: 'M. LEE', type: 'CHECKING', mask: '4927', currentBalanceCents: 250000, currency: 'USD' } });
    await prisma.account.create({ data: { userId: uid, provider: 'simplefin', providerRef: 'se', name: 'Chase Bank E. LEE (4034)', type: 'CHECKING', mask: null, currentBalanceCents: 250000, currency: 'USD' } });
    const view = await getAccountsView(uid);
    expect(view.reconciliationCandidates).toHaveLength(1); // surfaced for the owner to Combine or dismiss
  });
});
