/**
 * test_regression__plaid_liabilities_are_swept_on_a_schedule
 * (owner-reported 2026-07-23 — the other half of the "nothing due" bug).
 *
 * `syncLiabilities` — the ONLY writer of a card's statement, due date and minimum
 * payment — had exactly one production caller: `linkPlaidAccount`, in a try/catch
 * that swallows the error. No cron called it. A freshly linked item that Plaid
 * wasn't ready to answer for (anticipated in that catch's own comment) therefore
 * failed once, silently, and never retried; and even a successful pull went stale
 * the next cycle. Separately, the generic sweep resolves through `getProvider()`,
 * a documented no-op unless DATA_PROVIDER === 'plaid', so a linked user could stop
 * syncing entirely while linking itself is deliberately seam-independent.
 *
 * These lock the sweep's contract with an injected port (no network).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { sweepPlaidLinkedUsers, plaidLinkedUserIds, type PlaidSyncPort } from '@/server/plaid-sync';

function port(over: Partial<PlaidSyncPort> = {}) {
  const calls = { transactions: [] as string[], liabilities: [] as string[] };
  const p: PlaidSyncPort = {
    async syncTransactions(userId) {
      calls.transactions.push(userId);
      return { added: 3 };
    },
    async syncLiabilities(userId) {
      calls.liabilities.push(userId);
      return { itemsAttempted: 1, itemsFailed: 0, statementsWritten: 1 };
    },
    ...over,
  };
  return { p, calls };
}

async function makeUserWithItem(tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `plaid-sweep-${tag}-${Date.now()}-${Math.random()}@aimplifi.test` },
  });
  await prisma.plaidItem.create({
    data: { userId: user.id, itemId: `item-${tag}-${Date.now()}-${Math.random()}`, accessToken: 'enc' },
  });
  return user.id;
}

describe('sweepPlaidLinkedUsers', () => {
  beforeEach(async () => {
    await prisma.plaidItem.deleteMany({ where: { userId: DEMO_USER_ID } });
  });

  it('syncs liabilities for a linked user — the call no cron used to make', async () => {
    const userId = await makeUserWithItem('liab');
    const { p, calls } = port();

    const rows = await sweepPlaidLinkedUsers(p, { syncTransactions: true });

    expect(calls.liabilities).toContain(userId);
    const row = rows.find((r) => r.userId === userId)!;
    expect(row.liabilities).toBe('ran');
    expect(row.transactions).toBe('ran');
    expect(row.addedTransactions).toBe(3);
  });

  it('still syncs liabilities when the transaction sync throws (due dates are not collateral)', async () => {
    const userId = await makeUserWithItem('txfail');
    const { p, calls } = port({
      async syncTransactions() {
        throw new Error('ITEM_LOGIN_REQUIRED');
      },
    });

    const rows = await sweepPlaidLinkedUsers(p, { syncTransactions: true });

    expect(calls.liabilities).toContain(userId);
    const row = rows.find((r) => r.userId === userId)!;
    expect(row.transactions).toBe('failed');
    expect(row.liabilities).toBe('ran');
    expect(row.error).toContain('ITEM_LOGIN_REQUIRED');
  });

  it('records a liability failure without aborting the sweep (depository-only items)', async () => {
    const a = await makeUserWithItem('liabfail-a');
    const b = await makeUserWithItem('liabfail-b');
    const { p, calls } = port({
      async syncLiabilities(userId) {
        calls.liabilities.push(userId);
        if (userId === a) throw new Error('PRODUCTS_NOT_SUPPORTED');
        return { itemsAttempted: 1, itemsFailed: 0, statementsWritten: 1 };
      },
    });

    const rows = await sweepPlaidLinkedUsers(p, { syncTransactions: false });

    expect(rows.find((r) => r.userId === a)!.liabilities).toBe('failed');
    expect(rows.find((r) => r.userId === b)!.liabilities).toBe('ran');
  });

  /**
   * The critic's F-6: the real PlaidProvider CATCHES every per-item error itself and
   * returns normally, so "it didn't throw" is not evidence the sweep worked. Counts
   * are the signal — a run where every item failed must not be audited as 'ran'.
   */
  it('reports a silent total failure (nothing thrown, every item errored) as failed', async () => {
    const userId = await makeUserWithItem('silentfail');
    const { p } = port({
      async syncLiabilities() {
        return { itemsAttempted: 2, itemsFailed: 2, statementsWritten: 0 };
      },
    });

    const rows = await sweepPlaidLinkedUsers(p, { syncTransactions: false });
    const row = rows.find((r) => r.userId === userId)!;

    expect(row.liabilities).toBe('failed');
    expect(row.statementsWritten).toBe(0);
    expect(row.error).toContain('all 2 Plaid item(s) failed');

    const audit = await prisma.auditLog.findFirst({
      where: { userId, action: 'sync.cron.plaid' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.parse(audit!.meta ?? '{}')).toMatchObject({ liabilities: 'failed' });
  });

  it('reports a partial failure as ran (some items answered)', async () => {
    const userId = await makeUserWithItem('partial');
    const { p } = port({
      async syncLiabilities() {
        return { itemsAttempted: 3, itemsFailed: 1, statementsWritten: 2 };
      },
    });

    const row = (await sweepPlaidLinkedUsers(p, { syncTransactions: false })).find(
      (r) => r.userId === userId,
    )!;
    expect(row.liabilities).toBe('ran');
    expect(row.statementsWritten).toBe(2);
    expect(row.error).toBeUndefined();
  });

  it('reports "none" when the user has no items left to ask about', async () => {
    const userId = await makeUserWithItem('noitems');
    const { p } = port({
      async syncLiabilities() {
        return { itemsAttempted: 0, itemsFailed: 0, statementsWritten: 0 };
      },
    });

    const row = (await sweepPlaidLinkedUsers(p, { syncTransactions: false })).find(
      (r) => r.userId === userId,
    )!;
    expect(row.liabilities).toBe('none');
  });

  it('skips the transaction half when the primary sweep already owns it', async () => {
    const userId = await makeUserWithItem('skiptx');
    const { p, calls } = port();

    const rows = await sweepPlaidLinkedUsers(p, { syncTransactions: false });

    expect(calls.transactions).not.toContain(userId);
    expect(calls.liabilities).toContain(userId); // …but liabilities ALWAYS run
    expect(rows.find((r) => r.userId === userId)!.transactions).toBe('skipped');
  });

  it('never sweeps the shared demo account', async () => {
    await prisma.plaidItem.create({
      data: { userId: DEMO_USER_ID, itemId: `item-demo-${Date.now()}`, accessToken: 'enc' },
    });
    const { p, calls } = port();

    const ids = await plaidLinkedUserIds();
    await sweepPlaidLinkedUsers(p, { syncTransactions: true });

    expect(ids).not.toContain(DEMO_USER_ID);
    expect(calls.liabilities).not.toContain(DEMO_USER_ID);
    expect(calls.transactions).not.toContain(DEMO_USER_ID);
  });

  it('audits each swept user so a silent failure is no longer invisible', async () => {
    const userId = await makeUserWithItem('audit');
    const { p } = port();

    await sweepPlaidLinkedUsers(p, { syncTransactions: true });

    const audit = await prisma.auditLog.findFirst({
      where: { userId, action: 'sync.cron.plaid' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(JSON.parse(audit!.meta ?? '{}')).toMatchObject({
      transactions: 'ran',
      liabilities: 'ran',
    });
  });

  it('dedupes a user who has several linked items', async () => {
    const userId = await makeUserWithItem('multi');
    await prisma.plaidItem.create({
      data: { userId, itemId: `item-multi-2-${Date.now()}`, accessToken: 'enc' },
    });
    const { p, calls } = port();

    await sweepPlaidLinkedUsers(p, { syncTransactions: true });

    expect(calls.liabilities.filter((u) => u === userId)).toHaveLength(1);
  });

  /**
   * Webhook backfill on the cron path: a user who never opens the app still gets
   * the webhook registered on items that predate PLAID_WEBHOOK_URL, so background
   * push sync becomes hands-free rather than dependent on tapping Sync.
   */
  it('backfills webhooks and records the count in the audit when the port supports it', async () => {
    const userId = await makeUserWithItem('wh');
    const webhookCalls: string[] = [];
    const { p } = port({
      async updateWebhooks(u) {
        webhookCalls.push(u);
        return { attempted: 1, updated: 1, failed: 0 };
      },
    });

    const row = (await sweepPlaidLinkedUsers(p, { syncTransactions: false })).find(
      (r) => r.userId === userId,
    )!;

    expect(webhookCalls).toContain(userId);
    expect(row.webhooksUpdated).toBe(1);
    const audit = await prisma.auditLog.findFirst({
      where: { userId, action: 'sync.cron.plaid' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.parse(audit!.meta ?? '{}')).toMatchObject({ webhooksUpdated: 1 });
  });

  it('a webhook-backfill failure never fails the sweep, nor masks a real prior error', async () => {
    const userId = await makeUserWithItem('whfail');
    const { p } = port({
      async syncLiabilities() {
        return { itemsAttempted: 2, itemsFailed: 2, statementsWritten: 0 };
      },
      async updateWebhooks() {
        throw new Error('webhook boom');
      },
    });

    const row = (await sweepPlaidLinkedUsers(p, { syncTransactions: false })).find(
      (r) => r.userId === userId,
    )!;

    // The liabilities failure is the meaningful error; the webhook throw must not overwrite it.
    expect(row.liabilities).toBe('failed');
    expect(row.error).toContain('all 2 Plaid item(s) failed');
    expect(row.webhooksUpdated).toBeUndefined();
  });

  it('backfills institution names hands-free and records the count in the audit', async () => {
    const userId = await makeUserWithItem('inst');
    const instCalls: string[] = [];
    const { p } = port({
      async syncInstitutions(u) {
        instCalls.push(u);
        return { attempted: 1, updated: 1, failed: 0 };
      },
    });

    const row = (await sweepPlaidLinkedUsers(p, { syncTransactions: false })).find(
      (r) => r.userId === userId,
    )!;

    expect(instCalls).toContain(userId);
    expect(row.institutionsUpdated).toBe(1);
    const audit = await prisma.auditLog.findFirst({
      where: { userId, action: 'sync.cron.plaid' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.parse(audit!.meta ?? '{}')).toMatchObject({ institutionsUpdated: 1 });
  });

  it('an institution-backfill failure never fails the sweep, nor masks a real prior error', async () => {
    const userId = await makeUserWithItem('instfail');
    const { p } = port({
      async syncLiabilities() {
        return { itemsAttempted: 2, itemsFailed: 2, statementsWritten: 0 };
      },
      async syncInstitutions() {
        throw new Error('institution boom');
      },
    });

    const row = (await sweepPlaidLinkedUsers(p, { syncTransactions: false })).find(
      (r) => r.userId === userId,
    )!;

    // The pre-existing liability failure is the reported error, not the cosmetic backfill.
    expect(row.liabilities).toBe('failed');
    expect(row.error).toContain('all 2 Plaid item(s) failed');
    expect(row.institutionsUpdated).toBeUndefined();
  });
});
