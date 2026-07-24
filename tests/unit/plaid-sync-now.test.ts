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
const updateWebhooks = vi.fn(async () => ({ attempted: 0, updated: 0, failed: 0 }));
let currentUserId = '';

const rateLimitDurable = vi.fn(async () => true);
const auditLog = vi.fn(async () => {});
vi.mock('@/server/authz', () => ({
  requireUserId: async () => currentUserId,
  rateLimitDurable: (...args: unknown[]) => rateLimitDurable(...(args as [])),
  auditLog: (...args: unknown[]) => auditLog(...(args as [])),
}));
vi.mock('@/lib/providers/plaid', () => ({
  PlaidProvider: class {
    syncTransactions = syncTransactions;
    syncLiabilities = syncLiabilities;
    updateWebhooks = updateWebhooks;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { syncPlaidNow, updatePlaidWebhooksNow } = await import('@/server/plaid-actions');

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
    rateLimitDurable.mockReset().mockResolvedValue(true);
    syncTransactions.mockReset().mockResolvedValue({ added: 7 });
    syncLiabilities.mockReset().mockResolvedValue({
      itemsAttempted: 1,
      itemsFailed: 0,
      itemsUnsupported: 0,
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
    syncLiabilities.mockResolvedValue({ itemsAttempted: 2, itemsFailed: 2, itemsUnsupported: 0, statementsWritten: 0 });

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
 * Webhook backfill runs best-effort at the tail of a normal sync, so a user who
 * taps Sync (or the cron) also registers the webhook on any item that predates
 * PLAID_WEBHOOK_URL — without a separate step. It must NEVER fail the sync.
 */
describe('syncPlaidNow — webhook backfill integration', () => {
  beforeEach(() => {
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'test-key');
    rateLimitDurable.mockReset().mockResolvedValue(true);
    syncTransactions.mockReset().mockResolvedValue({ added: 3 });
    syncLiabilities.mockReset().mockResolvedValue({ itemsAttempted: 1, itemsFailed: 0, itemsUnsupported: 0, statementsWritten: 0 });
    updateWebhooks.mockReset().mockResolvedValue({ attempted: 1, updated: 1, failed: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('backfills the webhook after a sync, scoped to the same bank', async () => {
    currentUserId = await userWithItem('whok');
    const r = await syncPlaidNow();
    expect(r.ok).toBe(true);
    expect(updateWebhooks).toHaveBeenCalledWith(currentUserId, { itemId: undefined });
  });

  it('a webhook-backfill failure never fails an otherwise-successful sync', async () => {
    currentUserId = await userWithItem('whfail');
    updateWebhooks.mockRejectedValue(new Error('boom'));
    const r = await syncPlaidNow();
    expect(r.ok).toBe(true); // the data pull succeeded — that is the point of the sync
    expect(r.added).toBe(3);
  });
});

/**
 * updatePlaidWebhooksNow — the direct, user-triggerable backfill. Same guards as
 * every other Plaid action (demo-fenced, config-gated, rate-limited, user-scoped),
 * plus a distinct "not configured yet" signal so a missing PLAID_WEBHOOK_URL reads
 * as setup-incomplete rather than a failure.
 */
describe('updatePlaidWebhooksNow', () => {
  beforeEach(() => {
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'test-key');
    vi.stubEnv('PLAID_WEBHOOK_URL', 'https://www.aimplifi.app/api/plaid/webhook');
    rateLimitDurable.mockReset().mockResolvedValue(true);
    updateWebhooks.mockReset().mockResolvedValue({ attempted: 2, updated: 2, failed: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('registers webhooks for the caller and reports counts', async () => {
    currentUserId = await userWithItem('wh-run');
    const r = await updatePlaidWebhooksNow();
    expect(r).toMatchObject({ ok: true, configured: true, attempted: 2, updated: 2 });
    expect(updateWebhooks).toHaveBeenCalledWith(currentUserId);
  });

  it('reports "not configured" (distinct from a failure) when PLAID_WEBHOOK_URL is unset', async () => {
    vi.stubEnv('PLAID_WEBHOOK_URL', '');
    currentUserId = await userWithItem('wh-unset');
    const r = await updatePlaidWebhooksNow();
    expect(r).toMatchObject({ ok: false, configured: false });
    expect(updateWebhooks).not.toHaveBeenCalled();
  });

  it('refuses for the shared demo account', async () => {
    currentUserId = DEMO_USER_ID;
    const r = await updatePlaidWebhooksNow();
    expect(r.ok).toBe(false);
    expect(updateWebhooks).not.toHaveBeenCalled();
  });

  it('refuses when no Plaid bank is connected', async () => {
    const user = await prisma.user.create({
      data: { email: `wh-none-${Date.now()}-${Math.random()}@aimplifi.test` },
    });
    currentUserId = user.id;
    const r = await updatePlaidWebhooksNow();
    expect(r).toMatchObject({ ok: false, error: 'No Plaid banks are connected.' });
    expect(updateWebhooks).not.toHaveBeenCalled();
  });

  it('honors the durable rate limiter without spending a Plaid call', async () => {
    currentUserId = await userWithItem('wh-rate');
    rateLimitDurable.mockResolvedValue(false);
    const r = await updatePlaidWebhooksNow();
    expect(r.ok).toBe(false);
    expect(updateWebhooks).not.toHaveBeenCalled();
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
    rateLimitDurable.mockReset().mockResolvedValue(true);
    syncTransactions.mockReset().mockResolvedValue({ added: 1 });
    syncLiabilities
      .mockReset()
      .mockResolvedValue({ itemsAttempted: 1, itemsFailed: 0, itemsUnsupported: 0, statementsWritten: 0 });
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

/**
 * Hostile-critic findings on the shipped #278 commit, each reproduced by the
 * critic before being fixed here.
 */
describe('syncPlaidNow — critic hardening', () => {
  beforeEach(() => {
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'test-key');
    rateLimitDurable.mockReset().mockResolvedValue(true);
    syncTransactions.mockReset().mockResolvedValue({ added: 1 });
    syncLiabilities
      .mockReset()
      .mockResolvedValue({ itemsAttempted: 1, itemsFailed: 0, itemsUnsupported: 0, statementsWritten: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());

  /**
   * P1-1. A server-action argument is attacker-controlled — TypeScript's `string`
   * is erased at the boundary. Unvalidated, `{not:'x'}` reached the Prisma `where`
   * verbatim, matched EVERY item, passed the ownership gate, and turned the
   * per-bank control into an all-banks sweep.
   */
  it('refuses a non-string itemId instead of forwarding it into the query', async () => {
    currentUserId = await userWithItem('filterobj');

    const r = await syncPlaidNow({ not: 'nope' } as unknown as string);

    expect(r).toMatchObject({ ok: false, error: 'That bank isn’t connected.' });
    expect(syncTransactions).not.toHaveBeenCalled();
    expect(syncLiabilities).not.toHaveBeenCalled();
  });

  it('refuses an empty/whitespace itemId', async () => {
    currentUserId = await userWithItem('blank');
    expect((await syncPlaidNow('   ')).ok).toBe(false);
    expect(syncTransactions).not.toHaveBeenCalled();
  });

  /**
   * P1-2. The outer catch returned `e.message`; a Prisma validation error carries
   * absolute server paths, four lines of source, the model shape and the raw
   * userId — and the UI renders it verbatim in a role="alert".
   */
  it('never leaks internal error detail to the caller', async () => {
    currentUserId = await userWithItem('leak');
    syncTransactions.mockImplementation(() => {
      throw new Error('C:/dev/Aimplifi/src/server/plaid-actions.ts:134 userId "secret-id"');
    });
    syncLiabilities.mockRejectedValue(new Error('also failed'));

    const r = await syncPlaidNow();

    expect(r.ok).toBe(false);
    expect(r.error).toBe('Sync failed — please try again in a minute.');
    expect(r.error).not.toContain('Aimplifi');
    expect(r.error).not.toContain('secret-id');
  });

  /**
   * P1-3. `added: undefined` after a THROWN pull was indistinguishable from a
   * genuine zero, so the caller reported "No new transactions" to a user whose
   * bank login had expired.
   */
  it('flags a failed transaction half rather than letting it read as zero', async () => {
    currentUserId = await userWithItem('halfflag');
    syncTransactions.mockRejectedValue(new Error('ITEM_LOGIN_REQUIRED'));

    const r = await syncPlaidNow();

    expect(r.ok).toBe(true); // the liabilities half still delivered
    expect(r.transactionsFailed).toBe(true);
    expect(r.added).toBeUndefined();
    // #277 P2 (TASKS L.4): a total transaction-sync failure the user triggered used
    // to vanish — returned to the UI, recorded nowhere. It must now be audited.
    expect(auditLog).toHaveBeenCalledWith(
      currentUserId,
      'plaid.sync.transactions.failed',
      expect.objectContaining({ error: expect.stringContaining('ITEM_LOGIN_REQUIRED') }),
    );
  });

  it('does not flag a transaction half that genuinely returned zero', async () => {
    currentUserId = await userWithItem('realzero');
    syncTransactions.mockResolvedValue({ added: 0 });

    const r = await syncPlaidNow();

    expect(r.transactionsFailed).toBe(false);
    expect(r.added).toBe(0);
  });

  /**
   * P1-4. A per-request-BILLED endpoint had no server-side ceiling; the only brake
   * was a per-tab sessionStorage stamp that a fresh tab or a reload loop resets for
   * free. These lock that the action CONSULTS the durable limiter and HONORS a
   * refusal without spending a Plaid call.
   */
  it('consults the durable rate limiter, scoped per user', async () => {
    currentUserId = await userWithItem('ratekey');

    await syncPlaidNow();

    expect(rateLimitDurable).toHaveBeenCalledWith(
      `plaid-sync:${currentUserId}`,
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('refuses without calling Plaid when the limiter says no', async () => {
    currentUserId = await userWithItem('ratedeny');
    rateLimitDurable.mockResolvedValue(false);

    const r = await syncPlaidNow();

    expect(r.ok).toBe(false);
    expect(r.error).toContain('Too many syncs');
    expect(syncTransactions).not.toHaveBeenCalled();
    expect(syncLiabilities).not.toHaveBeenCalled();
  });
});
