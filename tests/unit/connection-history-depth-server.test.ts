/**
 * TASKS H.1(b) — the per-connection "History goes back to <date>" line, driven through the
 * REAL `getAccountsView` against a throwaway user (the accounts-freshness harness idiom).
 *
 * The engine tests next door prove the decision; these prove the WIRING, which is where this
 * surface can actually lie. The defect they exist to prevent is a rendered date computed from
 * a raw `groupBy _min` instead of the app's own R1 keep rule — a /accounts line three months
 * older than the register on the same screenload, i.e. the H.8 defect one surface further on.
 * The fixture is the live shape, not a hypothetical: on 2026-08-08
 * (`scripts/audit-probes/h1-connection-depth.mts`) SEVEN of the owner's connections carried a
 * raw-vs-owned delta of 84–91 days, and one held 7 rows while owning none of them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAccountsView } from '@/server/transactions';
import { prisma } from '@/lib/db';

const TODAY = '2026-08-08';

describe('getAccountsView — per-connection history depth is read through the reconciliation keep rule', () => {
  const uid = `depth-${Date.now()}-${process.pid}`;
  const wipe = async () => {
    await prisma.accountReconciliation.deleteMany({ where: { userId: uid } });
    await prisma.account.deleteMany({ where: { userId: uid } }); // cascades transactions
    await prisma.plaidItem.deleteMany({ where: { userId: uid } });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { id: uid } });
  };
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: uid, email: `${uid}@test.local` } });
  });
  afterAll(wipe);
  beforeEach(async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    await prisma.accountReconciliation.deleteMany({ where: { userId: uid } });
    await prisma.account.deleteMany({ where: { userId: uid } });
    await prisma.plaidItem.deleteMany({ where: { userId: uid } });
  });

  const item = (itemId: string, institution: string) =>
    prisma.plaidItem.create({
      data: { userId: uid, itemId, accessToken: 'enc', institution, lastSyncedAt: TODAY },
    });
  const account = (itemId: string | null, name: string, provider = 'plaid') =>
    prisma.account.create({
      data: {
        userId: uid,
        provider,
        providerRef: `${provider}-${name}`,
        plaidItemId: itemId,
        name,
        type: 'CREDIT',
        currentBalanceCents: 0,
        currency: 'USD',
      },
    });
  const txn = (accountId: string, date: string) =>
    prisma.transaction.create({
      data: {
        accountId,
        date,
        amountCents: -1234,
        rawDescriptor: `ROW ${date}`,
        categoryId: 'shopping',
        confidenceBps: 9000,
        needsReview: false,
      },
    });
  const depthOf = async (itemId: string) => {
    const v = await getAccountsView(uid);
    return v.plaid.items.find((i) => i.itemId === itemId)?.historyDepth;
  };

  it('with no links at all, the depth is simply the connection\'s oldest row', async () => {
    await item('it-plain', 'Chase');
    const a = await account('it-plain', 'Sapphire');
    await txn(a.id, '2024-08-11');
    await txn(a.id, '2026-08-07');
    expect(await depthOf('it-plain')).toEqual({ state: 'reaches', earliest: '2024-08-11' });
  });

  it('the OLDEST owning account sets a multi-account connection\'s depth', async () => {
    await item('it-multi', 'Charles Schwab');
    const a = await account('it-multi', 'Brokerage');
    const b = await account('it-multi', 'Checking');
    await txn(a.id, '2026-07-22');
    await txn(b.id, '2026-07-20');
    expect(await depthOf('it-multi')).toEqual({ state: 'reaches', earliest: '2026-07-20' });
  });

  it('REGRESSION — a successor reports the date it OWNS, not the raw row it holds', async () => {
    // test_regression__connection_depth_reads_the_keep_rule
    // The live 84–91-day shape. The predecessor's claim is [2026-04-24 .. 2026-07-20], so the
    // successor's own 2026-04-24 and 2026-05-18 rows belong to the predecessor and the register
    // never shows them under this connection. A raw `_min` would print 2026-04-24 here — 88 days
    // of history this connection does not own.
    await item('it-succ', 'Capital One');
    const pred = await account(null, 'Old Venture', 'simplefin');
    const succ = await account('it-succ', 'New Venture');
    for (const d of ['2026-04-24', '2026-06-01', '2026-07-25']) await txn(pred.id, d);
    for (const d of ['2026-04-24', '2026-05-18', '2026-07-21', '2026-08-06']) await txn(succ.id, d);
    await prisma.accountReconciliation.create({
      data: {
        userId: uid,
        predecessorAccountId: pred.id,
        successorAccountId: succ.id,
        cutoverDate: '2026-07-20',
        matchSignal: 'mask',
        confidence: 'high',
        confirmedByUserAt: new Date(),
      },
    });
    expect(await depthOf('it-succ')).toEqual({ state: 'reaches', earliest: '2026-07-21' });
  });

  it('a connection holding rows it owns NONE of says so, and never prints a date', async () => {
    // The live Q3 hit (American Express, 7 rows held / 0 owned). Every successor row falls
    // inside the predecessor's claim, so this connection owns nothing at all.
    await item('it-none', 'American Express');
    const pred = await account(null, 'Old Amex', 'simplefin');
    const succ = await account('it-none', 'New Amex');
    for (const d of ['2026-05-05', '2026-07-09']) await txn(pred.id, d);
    for (const d of ['2026-05-05', '2026-07-09']) await txn(succ.id, d);
    await prisma.accountReconciliation.create({
      data: {
        userId: uid,
        predecessorAccountId: pred.id,
        successorAccountId: succ.id,
        cutoverDate: '2026-07-20',
        matchSignal: 'mask',
        confidence: 'high',
        confirmedByUserAt: new Date(),
      },
    });
    expect(await depthOf('it-none')).toEqual({ state: 'counted-elsewhere' });
  });

  it('the PREDECESSOR side keeps its own depth — the boundary moves rows, it does not blank a connection', async () => {
    // Both sides on Plaid items, so both render a line. The predecessor keeps everything up to
    // its cutover, so its depth is its own first row; only the successor's prefix moves.
    await item('it-old', 'Chase');
    await item('it-new', 'Chase');
    const pred = await account('it-old', 'Old Freedom');
    const succ = await account('it-new', 'New Freedom');
    for (const d of ['2026-04-24', '2026-07-01']) await txn(pred.id, d);
    for (const d of ['2026-04-26', '2026-07-21']) await txn(succ.id, d);
    await prisma.accountReconciliation.create({
      data: {
        userId: uid,
        predecessorAccountId: pred.id,
        successorAccountId: succ.id,
        cutoverDate: '2026-07-20',
        matchSignal: 'mask',
        confidence: 'high',
        confirmedByUserAt: new Date(),
      },
    });
    expect(await depthOf('it-old')).toEqual({ state: 'reaches', earliest: '2026-04-24' });
    expect(await depthOf('it-new')).toEqual({ state: 'reaches', earliest: '2026-07-21' });
  });

  it('a connection whose accounts hold no transactions says "no rows", not "counted elsewhere"', async () => {
    // Live shape: Vanguard / Truist / U.S. Bank — real connections, real accounts, zero rows.
    await item('it-empty', 'Truist');
    await account('it-empty', 'Checking');
    expect(await depthOf('it-empty')).toEqual({ state: 'no-rows' });
  });

  it('a connection with no accounts at all holds nothing', async () => {
    await item('it-bare', 'U.S. Bank');
    expect(await depthOf('it-bare')).toEqual({ state: 'no-rows' });
  });

  it('a currency-WITHHELD account sets no date, and is not called empty either', async () => {
    // The page withholds non-USD accounts from every total (#135), so a date sourced from one
    // would claim rows the page is not counting. But the card NAMES "London Card" one line
    // above, so "No transactions yet." would deny rows it just listed (critic F-3).
    await item('it-fx', 'Chase');
    const gbp = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'plaid',
        providerRef: 'plaid-gbp',
        plaidItemId: 'it-fx',
        name: 'London Card',
        type: 'CREDIT',
        currentBalanceCents: 0,
        currency: 'GBP',
      },
    });
    await txn(gbp.id, '2024-01-02');
    expect(await depthOf('it-fx')).toEqual({ state: 'not-counted' });
  });

  it('REGRESSION — a MORTGAGE-only connection never prints a date the register denies', async () => {
    // test_regression__connection_depth_uses_the_registers_basis (critic F-1, executed against
    // the real getAccountsView AND the real getTransactions: /accounts rendered "History goes
    // back to Mon, May 18, 2026" while the register showed 0 rows and did not even offer the
    // account in its filter dropdown). Live shape: the Truist item whose ONLY account is
    // "Mortgage 1192", and a mortgage account elsewhere in the corpus already holding 3 rows.
    await item('it-mortgage', 'Truist');
    const m = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'plaid',
        providerRef: 'plaid-mortgage',
        plaidItemId: 'it-mortgage',
        name: 'Mortgage 1192',
        type: 'MORTGAGE',
        currentBalanceCents: -25_000_00,
        currency: 'USD',
      },
    });
    for (const d of ['2026-05-18', '2026-06-18']) await txn(m.id, d);
    expect(await depthOf('it-mortgage')).toEqual({ state: 'balances-only' });
  });

  it('a spending account beside an investment account answers from the spending one', async () => {
    // The live Charles Schwab shape: 7 INVESTMENT accounts and 1 CHECKING on one connection.
    await item('it-mixed', 'Charles Schwab');
    const brokerage = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'plaid',
        providerRef: 'plaid-brokerage',
        plaidItemId: 'it-mixed',
        name: 'Brokerage',
        type: 'INVESTMENT',
        currentBalanceCents: 100_000_00,
        currency: 'USD',
      },
    });
    const checking = await account('it-mixed', 'Checking');
    await txn(brokerage.id, '2020-01-01');
    await txn(checking.id, '2026-07-22');
    expect(await depthOf('it-mixed')).toEqual({ state: 'reaches', earliest: '2026-07-22' });
  });

  it('a split PARENT row cannot set the floor — the register lists its children, not it', async () => {
    // `registerRowWhere` excludes isSplitParent rows; a container dated before its own pieces
    // (the pending→posted drift H.6b(a) documents) would otherwise back-date the whole line.
    await item('it-split', 'Capital One');
    const a = await account('it-split', 'Quicksilver');
    await prisma.transaction.create({
      data: {
        accountId: a.id,
        date: '2025-01-01',
        amountCents: -10_000,
        rawDescriptor: 'CONTAINER',
        categoryId: 'shopping',
        confidenceBps: 9000,
        needsReview: false,
        isSplitParent: true,
      },
    });
    await txn(a.id, '2026-03-09');
    expect(await depthOf('it-split')).toEqual({ state: 'reaches', earliest: '2026-03-09' });
  });
});

describe('getAccountsView — the SimpleFIN feed answers the same question, in the state the owner is in', () => {
  const uid = `sfdepth-${Date.now()}-${process.pid}`;
  const wipe = async () => {
    await prisma.account.deleteMany({ where: { userId: uid } });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { id: uid } });
  };
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: uid, email: `${uid}@test.local` } });
  });
  afterAll(wipe);
  beforeEach(async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    await prisma.account.deleteMany({ where: { userId: uid } });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: uid } });
  });

  const sfAccount = (name: string, type = 'CREDIT') =>
    prisma.account.create({
      data: {
        userId: uid,
        provider: 'simplefin',
        providerRef: `sf-${name}`,
        name,
        type,
        currentBalanceCents: 0,
        currency: 'USD',
      },
    });

  it('reports the feed\'s own floor across every simplefin account', async () => {
    // The connection is one-per-user, so provider IS the linkage — there is no item id.
    await prisma.simpleFinConnection.create({ data: { userId: uid, accessUrl: 'enc', lastSyncedAt: TODAY } });
    const a = await sfAccount('Venture');
    const b = await sfAccount('Sapphire');
    await prisma.transaction.create({
      data: { accountId: a.id, date: '2026-03-25', amountCents: -100, rawDescriptor: 'A', categoryId: 'shopping', confidenceBps: 9000, needsReview: false },
    });
    await prisma.transaction.create({
      data: { accountId: b.id, date: '2026-05-01', amountCents: -100, rawDescriptor: 'B', categoryId: 'shopping', confidenceBps: 9000, needsReview: false },
    });
    const v = await getAccountsView(uid);
    expect(v.simplefin.historyDepth).toEqual({ state: 'reaches', earliest: '2026-03-25' });
  });

  it('REGRESSION — the depth still answers when the CONNECTION ROW IS GONE', async () => {
    // test_regression__simplefin_depth_survives_a_deleted_connection.
    // This is the owner's ACTUAL live state (DECISIONS #421): 25 simplefin accounts, 1,684 rows
    // reaching 2026-03-25, and no SimpleFinConnection row at all. A depth line wired only into
    // the connected branch would answer for every user except the one who most needs it.
    const a = await sfAccount('Venture');
    await prisma.transaction.create({
      data: { accountId: a.id, date: '2026-03-25', amountCents: -100, rawDescriptor: 'A', categoryId: 'shopping', confidenceBps: 9000, needsReview: false },
    });
    const v = await getAccountsView(uid);
    expect(v.simplefin.connected).toBe(false);
    expect(v.simplefin.orphaned).not.toBeNull();
    expect(v.simplefin.historyDepth).toEqual({ state: 'reaches', earliest: '2026-03-25' });
  });

  it('an all-investment simplefin feed says balances-only, never "no transactions yet"', async () => {
    await prisma.simpleFinConnection.create({ data: { userId: uid, accessUrl: 'enc', lastSyncedAt: TODAY } });
    await sfAccount('Rollover IRA', 'INVESTMENT');
    expect((await getAccountsView(uid)).simplefin.historyDepth).toEqual({ state: 'balances-only' });
  });
});
