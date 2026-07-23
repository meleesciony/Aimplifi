/**
 * test_regression__existing_plaid_items_get_the_webhook_backfilled
 *
 * An item linked BEFORE PLAID_WEBHOOK_URL was configured carries no webhook, so
 * Plaid never pushes TRANSACTIONS updates and it drifts stale between manual syncs
 * — the root cause under the #278 "some accounts haven't synced in a week" report
 * (there was no webhook registered at all, only sync-at-link + page-load + cron).
 *
 * updateWebhooks registers the configured webhook on those items via
 * /item/webhook/update — idempotently (skipping items already registered, so it is
 * cheap to call on every sync), self-healingly (re-registering if the URL changes),
 * and with per-item fault isolation. Runs the REAL PlaidProvider with global.fetch
 * stubbed to a fake Plaid server; the live socket stays UNVERIFIED against Plaid.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { PlaidProvider } from '@/lib/providers/plaid';
import { encryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';

const KEY = Buffer.alloc(32, 7).toString('base64');
const WEBHOOK = 'https://www.aimplifi.app/api/plaid/webhook';

const ok = (json: unknown): Response => ({ ok: true, status: 200, json: async () => json }) as Response;
const fail = (status: number, body: unknown): Response =>
  ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

// Fake-Plaid controls, reset per test.
let rejectTokens: Set<string>; // decrypted access_tokens the fake server should reject
let updateCalls: string[]; // decrypted access_token per /item/webhook/update call

function mockServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { body?: string }) => {
      const url = String(input);
      if (url.endsWith('/item/webhook/update')) {
        const body = JSON.parse(init?.body ?? '{}') as { access_token: string; webhook: string };
        updateCalls.push(body.access_token);
        if (rejectTokens.has(body.access_token)) {
          return fail(400, {
            error_code: 'ITEM_LOGIN_REQUIRED',
            error_type: 'ITEM_ERROR',
            request_id: 'req-test',
          });
        }
        return ok({ item: { item_id: 'x', webhook: body.webhook } });
      }
      return fail(404, { error_code: 'NOT_MOCKED' });
    }),
  );
}

async function makeUser(tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `plaid-wh-${tag}-${Date.now()}-${Math.random()}@aimplifi.test` },
  });
  return user.id;
}

async function addItem(
  userId: string,
  tag: string,
  token: string,
  webhookUrl: string | null,
): Promise<string> {
  const itemId = `item-wh-${tag}-${Date.now()}-${Math.random()}`;
  await prisma.plaidItem.create({
    data: { userId, itemId, accessToken: encryptToken(token), webhookUrl },
  });
  return itemId;
}

describe('PlaidProvider.updateWebhooks', () => {
  beforeEach(() => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    vi.stubEnv('PLAID_WEBHOOK_URL', WEBHOOK);
    rejectTokens = new Set();
    updateCalls = [];
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('registers the webhook on an item that has none, and records it locally', async () => {
    const userId = await makeUser('none');
    const itemId = await addItem(userId, 'none', 'tok-none', null);

    const r = await new PlaidProvider().updateWebhooks(userId);

    expect(r).toEqual({ attempted: 1, updated: 1, failed: 0 });
    expect(updateCalls).toEqual(['tok-none']);
    const item = await prisma.plaidItem.findUnique({ where: { itemId } });
    expect(item?.webhookUrl).toBe(WEBHOOK);
  });

  it('skips an item already registered with the desired URL (no billed call)', async () => {
    const userId = await makeUser('already');
    await addItem(userId, 'already', 'tok-already', WEBHOOK);

    const r = await new PlaidProvider().updateWebhooks(userId);

    expect(r).toEqual({ attempted: 0, updated: 0, failed: 0 });
    expect(updateCalls).toEqual([]);
  });

  it('re-registers an item whose stored URL is stale (self-healing on URL change)', async () => {
    const userId = await makeUser('stale');
    const itemId = await addItem(userId, 'stale', 'tok-stale', 'https://old.example.com/webhook');

    const r = await new PlaidProvider().updateWebhooks(userId);

    expect(r.updated).toBe(1);
    expect(updateCalls).toEqual(['tok-stale']);
    expect((await prisma.plaidItem.findUnique({ where: { itemId } }))?.webhookUrl).toBe(WEBHOOK);
  });

  it('isolates a per-item failure: one bank failing does not block the others, and audits it', async () => {
    const userId = await makeUser('iso');
    const badItem = await addItem(userId, 'bad', 'tok-bad', null);
    const goodItem = await addItem(userId, 'good', 'tok-good', null);
    rejectTokens.add('tok-bad');

    const r = await new PlaidProvider().updateWebhooks(userId);

    expect(r).toEqual({ attempted: 2, updated: 1, failed: 1 });
    // The good item is registered + recorded; the bad one is left null for the next sweep to retry.
    expect((await prisma.plaidItem.findUnique({ where: { itemId: goodItem } }))?.webhookUrl).toBe(WEBHOOK);
    expect((await prisma.plaidItem.findUnique({ where: { itemId: badItem } }))?.webhookUrl).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { userId, action: 'plaid.item.webhook.update.failed' },
    });
    expect(audit).not.toBeNull();
  });

  it('is a no-op when PLAID_WEBHOOK_URL is unset (nothing to register)', async () => {
    vi.stubEnv('PLAID_WEBHOOK_URL', '');
    const userId = await makeUser('unset');
    await addItem(userId, 'unset', 'tok-unset', null);

    const r = await new PlaidProvider().updateWebhooks(userId);

    expect(r).toEqual({ attempted: 0, updated: 0, failed: 0 });
    expect(updateCalls).toEqual([]);
  });

  it('scopes to one bank when itemId is given', async () => {
    const userId = await makeUser('scope');
    const a = await addItem(userId, 'a', 'tok-a', null);
    await addItem(userId, 'b', 'tok-b', null);

    const r = await new PlaidProvider().updateWebhooks(userId, { itemId: a });

    expect(r).toEqual({ attempted: 1, updated: 1, failed: 0 });
    expect(updateCalls).toEqual(['tok-a']);
  });

  it('is user-scoped: another user’s itemId matches nothing', async () => {
    const mine = await makeUser('mine');
    const theirs = await makeUser('theirs');
    const strangerItem = await addItem(theirs, 'stranger', 'tok-stranger', null);

    const r = await new PlaidProvider().updateWebhooks(mine, { itemId: strangerItem });

    expect(r).toEqual({ attempted: 0, updated: 0, failed: 0 });
    expect(updateCalls).toEqual([]);
    // Their item is untouched.
    expect((await prisma.plaidItem.findUnique({ where: { itemId: strangerItem } }))?.webhookUrl).toBeNull();
  });
});
