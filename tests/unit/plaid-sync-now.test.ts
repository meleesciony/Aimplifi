/**
 * test_regression__plaid_accounts_can_be_synced_on_demand
 * (owner-reported 2026-07-23: "Is there a way to (force) sync accounts in app?
 * Some of my accounts haven't been synced for almost a week.")
 *
 * They could not. SimpleFIN has had BOTH an on-demand `syncSimplefinNow` and
 * auto-sync-on-page-load since #91; Plaid had NEITHER. Its only ingest was the
 * one-shot pull inside `linkPlaidAccount`, plus a nightly cron that is a no-op
 * unless DATA_PROVIDER === 'plaid' — so a Plaid account synced once, at link, and
 * then went stale with nothing in the UI able to move it. The "last synced …"
 * label on /accounts could sit a week old and there was no button beside it.
 *
 * These lock the ACTION's contract. The provider itself is exercised by
 * plaid-sync-sweep.test.ts and the sandbox validator.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';

const syncTransactions = vi.fn();
const syncLiabilities = vi.fn();
let currentUserId = '';

vi.mock('@/server/authz', () => ({ requireUserId: async () => currentUserId }));
vi.mock('@/lib/providers/plaid', () => ({
  PlaidProvider: class {
    syncTransactions = syncTransactions;
    syncLiabilities = syncLiabilities;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { syncPlaidNow } = await import('@/server/plaid-actions');

async function userWithItem(tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `plaid-syncnow-${tag}-${Date.now()}-${Math.random()}@aimplifi.test` },
  });
  await prisma.plaidItem.create({
    data: { userId: user.id, itemId: `item-${tag}-${Date.now()}-${Math.random()}`, accessToken: 'enc' },
  });
  return user.id;
}

describe('syncPlaidNow', () => {
  beforeEach(() => {
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'test-key');
    syncTransactions.mockReset().mockResolvedValue({ added: 7 });
    syncLiabilities.mockReset().mockResolvedValue({
      itemsAttempted: 1,
      itemsFailed: 0,
      statementsWritten: 2,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('runs BOTH halves and reports what each did', async () => {
    currentUserId = await userWithItem('both');
    const r = await syncPlaidNow();

    // Second arg is the optional per-item scope; undefined here = every bank.
    expect(syncTransactions).toHaveBeenCalledWith(currentUserId, { itemId: undefined });
    expect(syncLiabilities).toHaveBeenCalledWith(currentUserId, { itemId: undefined });
    expect(r).toMatchObject({ ok: true, added: 7, statementsWritten: 2, liabilitiesFailed: false });
  });

  it('still syncs card due dates when the transaction half throws', async () => {
    currentUserId = await userWithItem('txfail');
    syncTransactions.mockRejectedValue(new Error('ITEM_LOGIN_REQUIRED'));

    const r = await syncPlaidNow();

    expect(syncLiabilities).toHaveBeenCalled(); // the more valuable datum survives
    expect(r.ok).toBe(true);
    expect(r.added).toBeUndefined();
    expect(r.statementsWritten).toBe(2);
  });

  it('reports a liabilities-only failure without calling the whole sync failed', async () => {
    currentUserId = await userWithItem('liabfail');
    syncLiabilities.mockResolvedValue({ itemsAttempted: 2, itemsFailed: 2, statementsWritten: 0 });

    const r = await syncPlaidNow();

    expect(r.ok).toBe(true); // transactions still landed — that is real progress
    expect(r.liabilitiesFailed).toBe(true);
  });

  it('fails only when BOTH halves fail', async () => {
    currentUserId = await userWithItem('bothfail');
    syncTransactions.mockRejectedValue(new Error('ITEM_LOGIN_REQUIRED'));
    syncLiabilities.mockRejectedValue(new Error('PRODUCTS_NOT_SUPPORTED'));

    const r = await syncPlaidNow();

    expect(r.ok).toBe(false);
    // Fixed message — provider errors can embed credential-bearing detail.
    expect(r.error).toBe('Sync failed — please try again in a minute.');
  });

  it('refuses for the shared demo account', async () => {
    currentUserId = DEMO_USER_ID;
    const r = await syncPlaidNow();
    expect(r.ok).toBe(false);
    expect(syncTransactions).not.toHaveBeenCalled();
  });

  it('refuses when no Plaid bank is connected (never a silent no-op)', async () => {
    const user = await prisma.user.create({
      data: { email: `plaid-syncnow-none-${Date.now()}-${Math.random()}@aimplifi.test` },
    });
    currentUserId = user.id;

    const r = await syncPlaidNow();

    expect(r).toMatchObject({ ok: false, error: 'No Plaid banks are connected.' });
    expect(syncTransactions).not.toHaveBeenCalled();
  });

  it('refuses when Plaid credentials are absent (zero-credential demo preserved)', async () => {
    currentUserId = await userWithItem('nokeys');
    vi.stubEnv('PLAID_CLIENT_ID', '');

    const r = await syncPlaidNow();

    expect(r.ok).toBe(false);
    expect(syncTransactions).not.toHaveBeenCalled();
  });
});

/**
 * Individual syncing (owner request: "And individual syncing if required").
 * A per-connection sync must be scoped AND ownership-checked — syncing by an id
 * alone would let a crafted request touch another user's bank.
 */
describe('syncPlaidNow — per-connection', () => {
  beforeEach(() => {
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'test-key');
    syncTransactions.mockReset().mockResolvedValue({ added: 1 });
    syncLiabilities
      .mockReset()
      .mockResolvedValue({ itemsAttempted: 1, itemsFailed: 0, statementsWritten: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('scopes both halves to the requested bank', async () => {
    const user = await prisma.user.create({
      data: { email: `plaid-one-${Date.now()}-${Math.random()}@aimplifi.test` },
    });
    currentUserId = user.id;
    const itemId = `item-one-${Date.now()}`;
    await prisma.plaidItem.create({ data: { userId: user.id, itemId, accessToken: 'enc' } });
    await prisma.plaidItem.create({
      data: { userId: user.id, itemId: `${itemId}-other`, accessToken: 'enc' },
    });

    const r = await syncPlaidNow(itemId);

    expect(r.ok).toBe(true);
    expect(syncTransactions).toHaveBeenCalledWith(user.id, { itemId });
    expect(syncLiabilities).toHaveBeenCalledWith(user.id, { itemId });
  });

  it("refuses another user's itemId instead of silently syncing nothing", async () => {
    const [mine, theirs] = await Promise.all([
      prisma.user.create({ data: { email: `plaid-mine-${Date.now()}-${Math.random()}@aimplifi.test` } }),
      prisma.user.create({ data: { email: `plaid-theirs-${Date.now()}-${Math.random()}@aimplifi.test` } }),
    ]);
    const strangerItem = `item-stranger-${Date.now()}`;
    await prisma.plaidItem.create({
      data: { userId: theirs.id, itemId: strangerItem, accessToken: 'enc' },
    });
    await prisma.plaidItem.create({
      data: { userId: mine.id, itemId: `item-mine-${Date.now()}`, accessToken: 'enc' },
    });
    currentUserId = mine.id;

    const r = await syncPlaidNow(strangerItem);

    expect(r).toMatchObject({ ok: false, error: 'That bank isn’t connected.' });
    expect(syncTransactions).not.toHaveBeenCalled();
    expect(syncLiabilities).not.toHaveBeenCalled();
  });
});
