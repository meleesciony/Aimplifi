/**
 * Plaid per-sync account-balance REFRESH (live-ingest backlog #6, the #127 audit's
 * item 3, DECISIONS #130). Before this fix, `syncTransactions` refreshed balances ONLY
 * for accounts echoed in the `/transactions/sync` `accounts` array — depository/credit
 * accounts with transaction activity. An INVESTMENT or LOAN account (no Transactions
 * product) was never re-fetched after link, so its balance — and the owner's net worth —
 * FROZE at link time. The fix calls the already-tested `syncAccountsForItem` (`/accounts/get`,
 * which returns EVERY account on the item) once per item each sync.
 *
 * This is the FIRST mocked-server integration test of the Plaid provider's network
 * orchestration (previously only the pure mapper in plaid-map.ts was tested; the socket
 * stays UNVERIFIED against a live Plaid). It runs the REAL PlaidProvider against a
 * throwaway user with `global.fetch` stubbed to a fake Plaid server.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { PlaidProvider } from '@/lib/providers/plaid';
import { encryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';

const KEY = Buffer.alloc(32, 7).toString('base64');
const ITEM_ID = 'item-refresh-1';

interface PlaidAcct {
  account_id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: { current: number | null; available: number | null; limit: number | null };
}
const acct = (over: Partial<PlaidAcct> & Pick<PlaidAcct, 'account_id' | 'type'>): PlaidAcct => ({
  name: over.account_id,
  mask: null,
  subtype: null,
  balances: { current: 0, available: null, limit: null },
  ...over,
});

// Fake-Plaid-server controls, reset per test.
let accountsGetResponse: () => Response;
let transactionsSyncResponse: () => Response;
let accountsGetCalls = 0;

const ok = (json: unknown): Response => ({ ok: true, status: 200, json: async () => json }) as Response;
const fail = (status: number, body: unknown): Response =>
  ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

const emptySync = () =>
  ok({ accounts: [], added: [], modified: [], removed: [], next_cursor: 'cur-final', has_more: false });

function mockServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/accounts/get')) {
        accountsGetCalls++;
        return accountsGetResponse();
      }
      if (url.endsWith('/transactions/sync')) return transactionsSyncResponse();
      if (url.endsWith('/liabilities/get')) return ok({ liabilities: { credit: [] } });
      return fail(404, { error_code: 'NOT_MOCKED' });
    }),
  );
}

describe('Plaid per-sync balance refresh (real provider, mocked Plaid server) — audit #6', () => {
  const USER = `plaid-refresh-${Date.now()}-${process.pid}`;

  async function wipe() {
    await prisma.account.deleteMany({ where: { userId: USER } }); // cascades txns
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
    accountsGetCalls = 0;
    // Clean slate each test: the user's accounts (cascade), audit, and the single item.
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.create({
      data: { userId: USER, itemId: ITEM_ID, accessToken: encryptToken('access-tok', Buffer.from(KEY, 'base64')) },
    });
    transactionsSyncResponse = emptySync;
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('refreshes a frozen INVESTMENT and LOAN balance each sync (not echoed by /transactions/sync)', async () => {
    // Link-time (stale) balances persisted on the accounts.
    await prisma.account.createMany({
      data: [
        { userId: USER, provider: 'plaid', providerRef: 'inv-1', name: 'Brokerage', type: 'INVESTMENT', currentBalanceCents: 10000000 }, // $100,000 stale
        { userId: USER, provider: 'plaid', providerRef: 'loan-1', name: 'Auto Loan', type: 'LOAN', currentBalanceCents: 2000000 }, // $20,000 owed, stale
      ],
    });
    // The institution's CURRENT balances, returned by /accounts/get — but NOT by
    // /transactions/sync (investment/loan carry no Transactions product).
    accountsGetResponse = () =>
      ok({
        accounts: [
          acct({ account_id: 'inv-1', name: 'Brokerage', type: 'investment', subtype: 'brokerage', balances: { current: 142000.0, available: null, limit: null } }),
          acct({ account_id: 'loan-1', name: 'Auto Loan', type: 'loan', subtype: 'auto', balances: { current: 18000.0, available: null, limit: null } }),
        ],
      });
    transactionsSyncResponse = emptySync; // no transaction activity this sync

    const result = await new PlaidProvider().syncTransactions(USER);
    expect(result).toMatchObject({ added: 0, modified: 0, removed: 0 });

    const inv = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'inv-1' } });
    const loan = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'loan-1' } });
    expect(inv.currentBalanceCents).toBe(14200000); // $142,000 — refreshed, no longer frozen at $100k
    expect(loan.currentBalanceCents).toBe(1800000); // $18,000 owed — refreshed from $20k
  });

  it('persists the sync cursor and calls /accounts/get exactly once per item', async () => {
    await prisma.account.create({
      data: { userId: USER, provider: 'plaid', providerRef: 'inv-1', name: 'Brokerage', type: 'INVESTMENT', currentBalanceCents: 10000000 },
    });
    accountsGetResponse = () =>
      ok({ accounts: [acct({ account_id: 'inv-1', type: 'investment', subtype: 'brokerage', balances: { current: 142000.0, available: null, limit: null } })] });

    await new PlaidProvider().syncTransactions(USER);

    expect(accountsGetCalls).toBe(1); // one linked item → one balance refresh
    const item = await prisma.plaidItem.findFirstOrThrow({ where: { userId: USER, itemId: ITEM_ID } });
    expect(item.cursor).toBe('cur-final');
  });

  it('a balance-refresh failure is best-effort: it does NOT block transaction ingest, and is audited', async () => {
    await prisma.account.create({
      data: { userId: USER, provider: 'plaid', providerRef: 'inv-1', name: 'Brokerage', type: 'INVESTMENT', currentBalanceCents: 10000000 },
    });
    // /accounts/get fails (e.g. ITEM_LOGIN_REQUIRED) — but /transactions/sync still returns a
    // depository account + a transaction, which must ingest regardless.
    accountsGetResponse = () => fail(400, { error_code: 'ITEM_LOGIN_REQUIRED', error_type: 'ITEM_ERROR' });
    transactionsSyncResponse = () =>
      ok({
        accounts: [acct({ account_id: 'chk-1', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 5000.0, available: 5000.0, limit: null } })],
        added: [{ transaction_id: 't1', account_id: 'chk-1', date: '2026-06-05', amount: 12.34, name: 'COFFEE SHOP', pending: false }],
        modified: [],
        removed: [],
        next_cursor: 'cur-final',
        has_more: false,
      });

    const result = await new PlaidProvider().syncTransactions(USER);
    expect(result.added).toBe(1); // transaction ingest proceeded despite the failed refresh

    const txn = await prisma.transaction.findFirst({ where: { providerRef: 't1', account: { userId: USER } } });
    expect(txn).not.toBeNull();

    const inv = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'inv-1' } });
    expect(inv.currentBalanceCents).toBe(10000000); // unchanged — refresh failed, not echoed by sync

    const audit = await prisma.auditLog.findFirst({ where: { userId: USER, action: 'plaid.accounts.refresh.failed' } });
    expect(audit).not.toBeNull();
    expect(audit!.meta).toContain('ITEM_LOGIN_REQUIRED'); // diagnosable, no secret
  });

  it('a null balances.current on resync PRESERVES the last-known-good balance — never zeroes net worth (DECISIONS #130 P1)', async () => {
    // Hostile-critic P1 (wf_25be9884): now that investment/loan balances refresh every sync,
    // a Plaid /accounts/get that reports a null `current` (balance unknown this fetch) must NOT
    // overwrite the stored balance with $0 — that would silently crater net worth until a later
    // non-null sync self-heals. The mapper yields null and upsertPlaidAccounts omits the field.
    await prisma.account.create({
      data: { userId: USER, provider: 'plaid', providerRef: 'inv-1', name: 'Brokerage', type: 'INVESTMENT', currentBalanceCents: 14200000 }, // $142,000 known-good
    });
    accountsGetResponse = () =>
      ok({ accounts: [acct({ account_id: 'inv-1', type: 'investment', subtype: 'brokerage', balances: { current: null, available: null, limit: null } })] });
    transactionsSyncResponse = emptySync;

    await new PlaidProvider().syncTransactions(USER);

    const inv = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'inv-1' } });
    expect(inv.currentBalanceCents).toBe(14200000); // PRESERVED — not zeroed to 0
  });
});
