/**
 * #277 P2 (TASKS L.4): "the issuer has no liability data" and "the sync is broken"
 * shared one count and one audit action, so a depository-only Plaid item wrote
 * `plaid.liabilities.failed` every day forever. Locks the split: Plaid's own
 * PRODUCTS_NOT_SUPPORTED / NO_LIABILITY_ACCOUNTS answers count as
 * `itemsUnsupported` and audit as `plaid.liabilities.unsupported`; anything else
 * still counts as `itemsFailed` under the original action. Runs the REAL
 * PlaidProvider.syncLiabilities with global.fetch stubbed to a fake Plaid server
 * (the plaid-loan-liabilities-sync idiom; the live socket stays UNVERIFIED).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { PlaidProvider } from '@/lib/providers/plaid';
import { encryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';

const KEY = Buffer.alloc(32, 7).toString('base64');

const ok = (json: unknown): Response =>
  ({ ok: true, status: 200, json: async () => json }) as Response;
const fail = (status: number, body: unknown): Response =>
  ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

/** Dispatch /liabilities/get per access_token so each item can answer differently. */
function mockServer(byToken: Record<string, () => Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.endsWith('/liabilities/get')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { access_token?: string };
        const handler = byToken[body.access_token ?? ''];
        if (handler) return handler();
      }
      return fail(404, { error_code: 'NOT_MOCKED' });
    }),
  );
}

describe('Plaid liabilities: unsupported vs failed classification (#277 P2)', () => {
  const USER = `plaid-unsup-${Date.now()}-${process.pid}`;

  async function wipe() {
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function seedItems(itemIds: string[]) {
    const key = Buffer.from(KEY, 'base64');
    for (const itemId of itemIds) {
      await prisma.plaidItem.create({
        data: { userId: USER, itemId, accessToken: encryptToken(`tok-${itemId}`, key) },
      });
    }
  }

  it('splits a 3-item sweep into unsupported / failed / clean, each under its own audit action', async () => {
    await seedItems(['item-dep', 'item-broken', 'item-card']);
    mockServer({
      // Depository-only: Plaid's documented "this item has no Liabilities product".
      'tok-item-dep': () =>
        fail(400, {
          error_code: 'PRODUCTS_NOT_SUPPORTED',
          error_type: 'INVALID_INPUT',
          error_message: 'the following products are not supported: liabilities',
        }),
      // A genuinely broken call.
      'tok-item-broken': () =>
        fail(500, {
          error_code: 'INTERNAL_SERVER_ERROR',
          error_type: 'API_ERROR',
          error_message: 'plaid is on fire',
        }),
      // A clean item with nothing to report.
      'tok-item-card': () => ok({ liabilities: {} }),
    });

    const res = await new PlaidProvider().syncLiabilities(USER);
    expect(res.itemsAttempted).toBe(3);
    expect(res.itemsUnsupported).toBe(1);
    expect(res.itemsFailed).toBe(1);
    expect(res.statementsWritten).toBe(0);

    const audits = await prisma.auditLog.findMany({
      where: { userId: USER, action: { in: ['plaid.liabilities.failed', 'plaid.liabilities.unsupported'] } },
    });
    const byAction = new Map(audits.map((a) => [a.action, JSON.parse(a.meta ?? '{}') as { itemId?: string }]));
    expect(audits).toHaveLength(2);
    expect(byAction.get('plaid.liabilities.unsupported')?.itemId).toBe('item-dep');
    expect(byAction.get('plaid.liabilities.failed')?.itemId).toBe('item-broken');
  });

  it('NO_LIABILITY_ACCOUNTS also counts as unsupported, never failed', async () => {
    await seedItems(['item-empty']);
    mockServer({
      'tok-item-empty': () =>
        fail(400, {
          error_code: 'NO_LIABILITY_ACCOUNTS',
          error_type: 'LIABILITIES_ERROR',
          error_message: 'no liability accounts on this item',
        }),
    });

    const res = await new PlaidProvider().syncLiabilities(USER);
    expect(res).toMatchObject({ itemsAttempted: 1, itemsUnsupported: 1, itemsFailed: 0 });
    const failedRows = await prisma.auditLog.count({
      where: { userId: USER, action: 'plaid.liabilities.failed' },
    });
    expect(failedRows).toBe(0);
  });
});
