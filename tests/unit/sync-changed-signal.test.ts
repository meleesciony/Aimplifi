/**
 * test_regression__a_sync_that_changed_something_tells_the_page_to_re_render (L.28)
 *
 * `AutoSync` fires on every full page load and calls `router.refresh()` only when the
 * sync reports that something moved. That predicate lived in the client component and
 * read two numbers — `added` and `statementsWritten` — so every OTHER thing a sync
 * writes was invisible to it.
 *
 * The owner's live syncs reported `addedTransactions: 0, statementsWritten: 0` while
 * L.26's re-keying rewrote his detected scheduled projections from 0 rows to 8
 * ($684.31/month). The very page load that repaired his guilt-free breakdown therefore
 * re-painted the stale server render, and only the NEXT load showed the money — which
 * is why "I opened it and it still says $0.00" was the honest report of a working fix.
 *
 * These lock the ACTIONS' `changed` contract, which is where the enumeration now lives:
 * `auto-sync.tsx` is a 'use client' file nothing in the repo can assert on, so keeping
 * the predicate there meant every future sync side-effect had to remember to edit an
 * untested file. The first case in each provider block is the owner's exact shape —
 * nothing ingested, projections rewritten — and it is the one that fails on the old
 * behaviour.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';

const syncTransactions = vi.fn();
const syncLiabilities = vi.fn();
const syncHoldings = vi.fn();
const syncInstitutions = vi.fn();
const updateWebhooks = vi.fn(async () => ({ attempted: 0, updated: 0, failed: 0 }));
const syncFromSimplefin = vi.fn();
let currentUserId = '';

vi.mock('@/server/authz', () => ({
  requireUserId: async () => currentUserId,
  rateLimitDurable: async () => true,
  auditLog: async () => {},
}));
vi.mock('@/lib/providers/plaid', () => ({
  PlaidProvider: class {
    syncTransactions = syncTransactions;
    syncLiabilities = syncLiabilities;
    syncHoldings = syncHoldings;
    syncInstitutions = syncInstitutions;
    updateWebhooks = updateWebhooks;
  },
}));
vi.mock('@/lib/providers/simplefin', () => ({
  syncFromSimplefin: (...args: unknown[]) => syncFromSimplefin(...(args as [])),
  claimAccessUrl: async () => 'https://example.invalid/access',
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { syncPlaidNow } = await import('@/server/plaid-actions');
const { syncSimplefinNow } = await import('@/server/simplefin-actions');

/** A sync that ingested nothing at all — the baseline every case below varies from. */
const QUIET_TRANSACTIONS = { added: 0, modified: 0, removed: 0, nextCursor: null, derivedChanged: false };
const QUIET_LIABILITIES = { itemsAttempted: 1, itemsFailed: 0, itemsUnsupported: 0, statementsWritten: 0 };
const QUIET_HOLDINGS = {
  itemsAttempted: 0,
  itemsFailed: 0,
  itemsUnsupported: 0,
  upserted: 0,
  removed: 0,
  skipped: 0,
  withheldNonUsd: 0,
};
const QUIET_INSTITUTIONS = { attempted: 1, updated: 0, failed: 0 };

async function userWithItem(tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `changed-${tag}-${Date.now()}-${Math.random()}@aimplifi.test` },
  });
  await prisma.plaidItem.create({
    data: { userId: user.id, itemId: `item-${tag}-${Date.now()}-${Math.random()}`, accessToken: 'enc' },
  });
  return user.id;
}

describe('syncPlaidNow — the re-render signal', () => {
  beforeEach(async () => {
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'test-key');
    syncTransactions.mockReset().mockResolvedValue(QUIET_TRANSACTIONS);
    syncLiabilities.mockReset().mockResolvedValue(QUIET_LIABILITIES);
    syncHoldings.mockReset().mockResolvedValue(QUIET_HOLDINGS);
    syncInstitutions.mockReset().mockResolvedValue(QUIET_INSTITUTIONS);
    currentUserId = await userWithItem('plaid');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('says changed when the projections were rewritten and NOTHING was ingested', async () => {
    // The owner's shape, exactly: no new transaction, no new statement, and the
    // detected scheduled rows replaced underneath the page.
    syncTransactions.mockResolvedValue({ ...QUIET_TRANSACTIONS, derivedChanged: true });

    const r = await syncPlaidNow();

    expect(r.added).toBe(0);
    expect(r.statementsWritten).toBe(0);
    expect(r.changed).toBe(true);
  });

  it('says NOT changed when the sync genuinely moved nothing', async () => {
    const r = await syncPlaidNow();

    expect(r.ok).toBe(true);
    expect(r.changed).toBe(false);
  });

  it('says changed when a pending row posted, adding nothing', async () => {
    // `modified`/`removed` rewrite the register and the balances built on it while
    // `added` stays at zero. Both were dropped at this boundary before L.28.
    syncTransactions.mockResolvedValue({ ...QUIET_TRANSACTIONS, modified: 3 });
    expect((await syncPlaidNow()).changed).toBe(true);

    syncTransactions.mockResolvedValue({ ...QUIET_TRANSACTIONS, removed: 1 });
    expect((await syncPlaidNow()).changed).toBe(true);
  });

  it('says changed when only a card statement was written', async () => {
    syncLiabilities.mockResolvedValue({ ...QUIET_LIABILITIES, statementsWritten: 2 });
    expect((await syncPlaidNow()).changed).toBe(true);
  });

  it('says changed when only holdings moved, but not for positions it refused to store', async () => {
    syncHoldings.mockResolvedValue({ ...QUIET_HOLDINGS, upserted: 4 });
    expect((await syncPlaidNow()).changed).toBe(true);

    syncHoldings.mockResolvedValue({ ...QUIET_HOLDINGS, removed: 1 });
    expect((await syncPlaidNow()).changed).toBe(true);

    // Nothing was stored, so there is nothing new to paint.
    syncHoldings.mockResolvedValue({ ...QUIET_HOLDINGS, skipped: 3, withheldNonUsd: 2 });
    expect((await syncPlaidNow()).changed).toBe(false);
  });

  it('says changed when the bank name was backfilled, but not for a webhook registration', async () => {
    // This backfill is what turns "Connected bank" into "Chase" on /accounts.
    syncInstitutions.mockResolvedValue({ attempted: 1, updated: 1, failed: 0 });
    expect((await syncPlaidNow()).changed).toBe(true);

    // A webhook URL is plumbing and is rendered nowhere: registering one is not a
    // reason to re-render the page the reader is looking at.
    syncInstitutions.mockResolvedValue(QUIET_INSTITUTIONS);
    updateWebhooks.mockResolvedValue({ attempted: 1, updated: 1, failed: 0 });
    expect((await syncPlaidNow()).changed).toBe(false);
  });

  it('reports the truth about what was written when ONE half failed', async () => {
    // A failed transaction pull does not un-write the statement the other half stored.
    // Note this path still returns ok:true (the both-halves gate), so it is NOT yet the
    // case that justifies dropping the client's `ok` guard — the next test is.
    syncTransactions.mockRejectedValue(new Error('ITEM_LOGIN_REQUIRED'));
    syncLiabilities.mockResolvedValue({ ...QUIET_LIABILITIES, statementsWritten: 1 });

    const r = await syncPlaidNow();

    expect(r.ok).toBe(true);
    expect(r.transactionsFailed).toBe(true);
    expect(r.changed).toBe(true);
  });

  it('reports ok:false with changed:true when BOTH halves failed over a real write', async () => {
    // THE case the client's missing `ok` guard exists for, previously asserted by
    // nothing (critic P2-4): the sync is reported failed, but the institution backfill
    // still renamed the bank on /accounts, and that write is on the page regardless.
    syncTransactions.mockRejectedValue(new Error('ITEM_LOGIN_REQUIRED'));
    syncLiabilities.mockRejectedValue(new Error('PRODUCTS_NOT_SUPPORTED'));
    syncInstitutions.mockResolvedValue({ attempted: 1, updated: 1, failed: 0 });

    const r = await syncPlaidNow();

    expect(r.ok).toBe(false);
    expect(r.changed).toBe(true);
  });

  it('says changed when only an account BALANCE moved (critic P0-1)', async () => {
    // The biggest writer in the sync reports no counter at all: `syncAccountsForItem`
    // rewrites every balance and returns void. An INVESTMENT or LOAN account has no
    // transactions, so its balance is the only thing that ever moves — without this,
    // net worth, /dashboard, /accounts and /trends stay stale for a whole page load.
    const account = await prisma.account.create({
      data: {
        userId: currentUserId,
        provider: 'plaid',
        name: 'Brokerage',
        type: 'INVESTMENT',
        currentBalanceCents: 10_000_000,
      },
    });
    syncTransactions.mockImplementation(async () => {
      await prisma.account.update({
        where: { id: account.id },
        data: { currentBalanceCents: 14_200_000 },
      });
      return QUIET_TRANSACTIONS;
    });

    const r = await syncPlaidNow();

    expect(r.added).toBe(0);
    expect(r.statementsWritten).toBe(0);
    expect(r.changed).toBe(true);
  });

  it('says changed when a brand-new account row appears', async () => {
    syncTransactions.mockImplementation(async () => {
      await prisma.account.create({
        data: {
          userId: currentUserId,
          provider: 'plaid',
          name: 'Newly shared savings',
          type: 'SAVINGS',
          currentBalanceCents: 250_000,
        },
      });
      return QUIET_TRANSACTIONS;
    });

    expect((await syncPlaidNow()).changed).toBe(true);
  });

  it('says changed when only a card DUE DAY moved, with no statement written', async () => {
    // `syncLiabilities` writes APR, cycle-close day, due day and loan minimums onto the
    // account and counts only STATEMENTS — and a card whose issuer sends a due date but
    // has generated no statement takes exactly that path (critic P1-2). /cards,
    // /calendar and the cash-needed engine all render that day.
    const card = await prisma.account.create({
      data: {
        userId: currentUserId,
        provider: 'plaid',
        name: 'Visa',
        type: 'CREDIT',
        currentBalanceCents: 120_000,
        dueDayOfMonth: 12,
      },
    });
    syncLiabilities.mockImplementation(async () => {
      await prisma.account.update({ where: { id: card.id }, data: { dueDayOfMonth: 28 } });
      return QUIET_LIABILITIES; // statementsWritten: 0
    });

    const r = await syncPlaidNow();

    expect(r.statementsWritten).toBe(0);
    expect(r.changed).toBe(true);
  });

  it('does not invent a change when a sync rewrites the same account values', async () => {
    // The upserts run on every sync and mostly write back what is already stored. If
    // that read as a change, every page load would re-render and the signal would be
    // worth nothing — the failure the id-bearing comparison would have caused.
    const account = await prisma.account.create({
      data: {
        userId: currentUserId,
        provider: 'plaid',
        name: 'Checking',
        type: 'CHECKING',
        currentBalanceCents: 321_00,
      },
    });
    syncTransactions.mockImplementation(async () => {
      await prisma.account.update({
        where: { id: account.id },
        data: { currentBalanceCents: 321_00, name: 'Checking' },
      });
      return QUIET_TRANSACTIONS;
    });

    expect((await syncPlaidNow()).changed).toBe(false);
  });

  it('never claims a change when both halves failed and nothing was written', async () => {
    syncTransactions.mockRejectedValue(new Error('ITEM_LOGIN_REQUIRED'));
    syncLiabilities.mockRejectedValue(new Error('PRODUCTS_NOT_SUPPORTED'));
    syncHoldings.mockResolvedValue(QUIET_HOLDINGS);

    const r = await syncPlaidNow();

    expect(r.ok).toBe(false);
    expect(r.changed).toBe(false);
  });

  it('never claims a change on any path that refuses BEFORE syncing', async () => {
    // The old test carried this NAME while its body failed both halves mid-sync, so the
    // five hand-edited pre-sync refusal returns were covered by nothing (critic P2-5).
    // Each must carry changed:false AND must not reach the provider at all.
    const arrangements: Array<[string, () => Promise<void>]> = [
      ['demo user', async () => { currentUserId = DEMO_USER_ID; }],
      ['plaid not configured', async () => { vi.stubEnv('PLAID_CLIENT_ID', ''); }],
      ['no bank connected', async () => {
        currentUserId = (await prisma.user.create({
          data: { email: `changed-nobank-${Date.now()}-${Math.random()}@aimplifi.test` },
        })).id;
      }],
    ];
    for (const [name, arrange] of arrangements) {
      syncTransactions.mockClear();
      await arrange();
      expect(await syncPlaidNow(), name).toMatchObject({ ok: false, changed: false });
      expect(syncTransactions, name).not.toHaveBeenCalled();
      vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
      currentUserId = await userWithItem('presync');
    }

    // A non-string itemId is refused by the boundary validator, also before syncing.
    syncTransactions.mockClear();
    const bad = await syncPlaidNow({ not: 'a string' } as unknown as string);
    expect(bad).toMatchObject({ ok: false, changed: false });
    expect(syncTransactions).not.toHaveBeenCalled();
  });
});

describe('syncSimplefinNow — the re-render signal', () => {
  beforeEach(async () => {
    syncFromSimplefin.mockReset().mockResolvedValue(QUIET_TRANSACTIONS);
    const user = await prisma.user.create({
      data: { email: `changed-sf-${Date.now()}-${Math.random()}@aimplifi.test` },
    });
    currentUserId = user.id;
  });

  it('says changed when the projections were rewritten and NOTHING was ingested', async () => {
    syncFromSimplefin.mockResolvedValue({ ...QUIET_TRANSACTIONS, derivedChanged: true });

    const r = await syncSimplefinNow();

    expect(r.added).toBe(0);
    expect(r.changed).toBe(true);
  });

  it('says NOT changed when the sync genuinely moved nothing', async () => {
    const r = await syncSimplefinNow();

    expect(r.ok).toBe(true);
    expect(r.changed).toBe(false);
  });

  it('says changed for ingested rows, re-shaped pending rows, and stored holdings alike', async () => {
    for (const delta of [
      { added: 5 },
      { modified: 2 },
      { removed: 1 },
      { holdings: { upserted: 3, removed: 0, skipped: 0, withheldNonUsd: 0 } },
      { holdings: { upserted: 0, removed: 2, skipped: 0, withheldNonUsd: 0 } },
    ]) {
      syncFromSimplefin.mockResolvedValue({ ...QUIET_TRANSACTIONS, ...delta });
      expect((await syncSimplefinNow()).changed).toBe(true);
    }

    // Positions the ingest refused to store changed nothing a page can render.
    syncFromSimplefin.mockResolvedValue({
      ...QUIET_TRANSACTIONS,
      holdings: { upserted: 0, removed: 0, skipped: 4, withheldNonUsd: 1 },
    });
    expect((await syncSimplefinNow()).changed).toBe(false);
  });

  it('never claims a change when the sync threw', async () => {
    syncFromSimplefin.mockRejectedValue(new Error('bridge down'));

    const r = await syncSimplefinNow();

    expect(r.ok).toBe(false);
    expect(r.changed).toBe(false);
  });
});
