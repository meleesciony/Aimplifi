/**
 * test_regression__plaid_sync_records_what_plaid_answered (K.2 Truist test, 2026-08-07).
 *
 * The blind spot these lock: the owner's fresh 730-day Truist re-link sat at ZERO
 * transactions through two live syncs, and NOTHING in the database could distinguish
 * "Plaid is still preparing the item's history" (normal for a fresh link) from "Plaid
 * delivered nothing" (a real verdict about the institution) from "Plaid sent rows and
 * the ingest dropped them" (a defect). The sync loop RECEIVED Plaid's own answer —
 * `transactions_update_status` — and discarded it, and no per-item counts were recorded
 * anywhere on the ordinary sync path (only the one-time deep backfill audited itself).
 *
 * Now every successful per-item sync writes ONE `plaid.sync.result` audit row: counts
 * (added/modified/removed), pages walked, and Plaid's readiness status. Counts only —
 * no descriptors, no amounts, no secrets. Real provider, mocked Plaid server (the
 * plaid-balance-refresh.test.ts harness idiom).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { PlaidProvider } from '@/lib/providers/plaid';
import { encryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';

const KEY = Buffer.alloc(32, 9).toString('base64');
const ITEM_ID = 'item-sync-audit-1';

const ok = (json: unknown): Response => ({ ok: true, status: 200, json: async () => json }) as Response;
const fail = (status: number, body: unknown): Response =>
  ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

let transactionsSyncResponses: Response[] = [];

function mockServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/accounts/get')) return ok({ accounts: [] });
      if (url.endsWith('/transactions/sync')) {
        const next = transactionsSyncResponses.shift();
        return next ?? fail(500, { error_code: 'MOCK_EXHAUSTED' });
      }
      if (url.endsWith('/liabilities/get')) return ok({ liabilities: { credit: [] } });
      return fail(404, { error_code: 'NOT_MOCKED' });
    }),
  );
}

async function auditRows(userId: string) {
  const rows = await prisma.auditLog.findMany({
    where: { userId, action: 'plaid.sync.result' },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => JSON.parse(r.meta ?? '{}') as Record<string, unknown>);
}

describe('plaid.sync.result — the per-item sync audit row (real provider, mocked server)', () => {
  const USER = `plaid-sync-audit-${Date.now()}-${process.pid}`;

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
    vi.stubEnv('DEMO_TODAY', '2026-06-10');
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    // historyBackfilledAt set: fresh 730d items are stamped at birth, and it keeps the
    // deep backfill out of these tests so the audited deltas are the sync's own.
    await prisma.plaidItem.create({
      data: {
        userId: USER,
        itemId: ITEM_ID,
        accessToken: encryptToken('access-tok', Buffer.from(KEY, 'base64')),
        historyBackfilledAt: '2026-06-10',
      },
    });
    transactionsSyncResponses = [];
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('the Truist shape: zero rows + NOT_READY is recorded as exactly that — not silence', async () => {
    // This is the state the whole file exists for: an empty answer WITH Plaid's own
    // "still preparing" status. Before this row existed, this sync was indistinguishable
    // in the DB from a bank that has nothing.
    transactionsSyncResponses = [
      ok({
        accounts: [],
        added: [],
        modified: [],
        removed: [],
        next_cursor: 'cur-1',
        has_more: false,
        transactions_update_status: 'NOT_READY',
      }),
    ];
    await new PlaidProvider().syncTransactions(USER);
    const rows = await auditRows(USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      itemId: ITEM_ID,
      pages: 1,
      added: 0,
      modified: 0,
      removed: 0,
      txUpdateStatus: 'NOT_READY',
    });
  });

  it('counts and pages are per-item deltas across the cursor walk, and the last non-null status wins', async () => {
    // Page 1 carries a real transaction + NOT_READY; page 2 finishes the walk with the
    // historical pull complete. The row must say pages=2, added=1, and the LATEST status.
    await prisma.account.create({
      data: { userId: USER, provider: 'plaid', providerRef: 'chk-1', plaidItemId: ITEM_ID, name: 'Checking', type: 'CHECKING', currentBalanceCents: 0, currency: 'USD' },
    });
    transactionsSyncResponses = [
      ok({
        accounts: [],
        added: [
          { transaction_id: 'txn-1', account_id: 'chk-1', date: '2026-06-01', amount: 12.5, name: 'COFFEE SHOP', pending: false },
        ],
        modified: [],
        removed: [],
        next_cursor: 'cur-1',
        has_more: true,
        transactions_update_status: 'NOT_READY',
      }),
      ok({
        accounts: [],
        added: [],
        modified: [],
        removed: [],
        next_cursor: 'cur-2',
        has_more: false,
        transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE',
      }),
    ];
    await new PlaidProvider().syncTransactions(USER);
    const rows = await auditRows(USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      itemId: ITEM_ID,
      pages: 2,
      added: 1,
      modified: 0,
      removed: 0,
      txUpdateStatus: 'HISTORICAL_UPDATE_COMPLETE',
    });
  });

  it('a response that omits the status field records null, never a guess', async () => {
    transactionsSyncResponses = [
      ok({ accounts: [], added: [], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }),
    ];
    await new PlaidProvider().syncTransactions(USER);
    const rows = await auditRows(USER);
    expect(rows).toHaveLength(1);
    expect(rows[0].txUpdateStatus).toBeNull();
  });

  it('a FAILED item sync writes NO result row — the failure path owns its own record', async () => {
    transactionsSyncResponses = [fail(500, { error_code: 'INTERNAL_SERVER_ERROR' })];
    await new PlaidProvider().syncTransactions(USER);
    expect(await auditRows(USER)).toHaveLength(0);
    const item = await prisma.plaidItem.findFirst({ where: { userId: USER, itemId: ITEM_ID } });
    expect(item?.lastSyncError).not.toBeNull();
  });
});
