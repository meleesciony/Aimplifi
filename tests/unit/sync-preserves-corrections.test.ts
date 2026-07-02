/**
 * test_regression__resync_clobbers_corrections (PULSE_CATEGORIZATION_FIX Phase 3d).
 *
 * A user decision must outrank the pipeline. Before the fix, both sync paths rewrote
 * categoryId/confidenceBps/needsReview from a fresh pipeline verdict on UPDATE of an
 * existing row: SimpleFIN re-fetches a 5-day overlap window every sync (simplefin.ts
 * incremental window), and Plaid re-sends rows in `modified` — so a transaction the
 * user corrected in triage ("Just this once": Correction row, NO rule) was silently
 * REVERTED to the pre-correction verdict (an unknown merchant went BACK into review).
 * Only an "Always" rule masked the clobber. Diagnosed 2026-07-02 (Phase-1 workflow
 * wf_37625155, confidence-lens surprise #1); docs/CATEGORIZATION_DIAGNOSIS.md item 4.
 *
 * Locks BOTH providers via the real sync paths against mocked servers (the
 * plaid-balance-refresh / simplefin-pending-reconcile harness patterns), with the
 * correction made by the REAL applyCategory action. Also locks the complement: the
 * resync must still refresh the row's non-verdict fields (status PENDING→POSTED).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { connectSimplefin } from '@/server/simplefin-actions';
import { syncFromSimplefin } from '@/lib/providers/simplefin';
import { PlaidProvider } from '@/lib/providers/plaid';
import { applyCategory } from '@/server/triage-actions';
import { encryptToken } from '@/lib/crypto';
import { isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';

const KEY = Buffer.alloc(32, 7).toString('base64');
const TODAY = isoDate('2026-06-10');
const epoch = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 1000);

// An unknown merchant: pipeline verdict = uncategorized/5000/needsReview — the exact
// class the user has to correct by hand, and the exact class a resync used to revert.
const RAW = 'SQ *LITTLE TART BAKESHOP';

describe('SimpleFIN resync preserves user corrections (real actions, mocked server)', () => {
  const USER = `sf-keep-${Date.now()}-${process.pid}`;
  const CLAIM_URL = 'https://claim.example/keep1';
  const SETUP_TOKEN = Buffer.from(CLAIM_URL, 'utf8').toString('base64');
  const ACCESS_URL = 'https://ro-user:secret@bridge.example/simplefin';

  interface RawTxn { id: string; posted: number; amount: string; description?: string; pending?: boolean; transacted_at?: number }
  let accountsPayload: { accounts: unknown[] } = { accounts: [] };
  const checking = (transactions: RawTxn[]) => ({
    id: 'chk-1', name: 'Everyday Checking', balance: '5000.00', org: { name: 'Demo CU' }, transactions,
  });

  function mockServer() {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if (init?.method === 'POST' && url === CLAIM_URL) {
        return { ok: true, status: 200, text: async () => ACCESS_URL } as Response;
      }
      if (url.startsWith('https://bridge.example/simplefin/accounts')) {
        return { ok: true, status: 200, json: async () => accountsPayload } as Response;
      }
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as Response;
    }));
  }

  async function wipe() {
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } }); // cascades txns
    await prisma.simpleFinConnection.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  const row = () =>
    prisma.transaction.findFirstOrThrow({ where: { account: { userId: USER }, providerRef: 't1' } });

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('DEMO_TODAY', '2026-06-10');
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: USER } });
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('a "just once" correction survives the 5-day-overlap resync (and status still refreshes)', async () => {
    // Ingest a PENDING unknown-merchant txn inside the overlap window (TODAY-5 .. TODAY).
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-8.50', description: RAW, pending: true },
    ])] };
    await connectSimplefin(SETUP_TOKEN);
    const before = await row();
    expect(before.needsReview).toBe(true); // unknown merchant → review (precondition)

    // The user corrects it in triage — "Just this once" (Correction row, NO rule).
    await applyCategory({ transactionId: before.id, categoryId: 'coffee' });
    expect((await row()).categoryId).toBe('coffee');

    // Next sync re-sends the same row (5-day overlap), now POSTED.
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: epoch(2026, 6, 8), amount: '-8.50', description: RAW },
    ])] };
    await syncFromSimplefin(USER, TODAY);

    const after = await row();
    expect(after.status).toBe('POSTED'); // non-verdict fields still refresh
    expect(after.categoryId).toBe('coffee'); // the user's decision survives
    expect(after.needsReview).toBe(false); // …and does NOT return to the queue
    expect(after.confidenceBps).toBe(9900);
  });

  it('an UNTOUCHED row still takes the fresh pipeline verdict on resync (guard is correction-scoped)', async () => {
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: 0, transacted_at: epoch(2026, 6, 8), amount: '-8.50', description: RAW, pending: true },
    ])] };
    await connectSimplefin(SETUP_TOKEN);

    // Feed re-sends the row with a DIFFERENT descriptor (bank finalized the payee):
    // no correction exists, so the fresh verdict must land.
    accountsPayload = { accounts: [checking([
      { id: 't1', posted: epoch(2026, 6, 8), amount: '-8.50', description: 'NETFLIX.COM 866-579-7172 CA' },
    ])] };
    await syncFromSimplefin(USER, TODAY);

    const after = await row();
    expect(after.needsReview).toBe(false); // known merchant now — auto-filed
    expect(after.categoryId).not.toBe('uncategorized');
  });
});

describe('Plaid resync preserves user corrections (real provider, mocked server)', () => {
  const USER = `pl-keep-${Date.now()}-${process.pid}`;
  const ITEM_ID = 'item-keep-1';

  const plaidTxn = (over: Partial<Record<string, unknown>> = {}) => ({
    transaction_id: 'ptx-1',
    account_id: 'chk-1',
    amount: 8.5, // Plaid: positive = outflow
    date: '2026-06-08',
    name: RAW,
    pending: true,
    ...over,
  });
  const acct = {
    account_id: 'chk-1', name: 'Everyday Checking', mask: null, type: 'depository', subtype: 'checking',
    balances: { current: 5000, available: 5000, limit: null },
  };
  let syncPages: unknown[] = [];

  function mockServer() {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/accounts/get')) return { ok: true, status: 200, json: async () => ({ accounts: [acct] }) } as Response;
      if (url.endsWith('/liabilities/get')) return { ok: true, status: 200, json: async () => ({ liabilities: { credit: [] } }) } as Response;
      if (url.endsWith('/transactions/sync')) {
        const page = syncPages.shift() ?? { accounts: [], added: [], modified: [], removed: [], next_cursor: 'cur-x', has_more: false };
        return { ok: true, status: 200, json: async () => page } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as Response;
    }));
  }

  async function wipe() {
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  const row = () =>
    prisma.transaction.findFirstOrThrow({ where: { account: { userId: USER }, providerRef: 'ptx-1' } });

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    vi.stubEnv('DEMO_TODAY', '2026-06-10');
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.create({
      data: { userId: USER, itemId: ITEM_ID, accessToken: encryptToken('access-tok', Buffer.from(KEY, 'base64')) },
    });
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('a corrected txn re-sent in `modified` keeps its category (and still posts)', async () => {
    // Sync 1: the pending txn arrives.
    syncPages = [{ accounts: [acct], added: [plaidTxn()], modified: [], removed: [], next_cursor: 'cur-1', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);
    const before = await row();
    expect(before.needsReview).toBe(true); // precondition: unknown merchant → review

    await applyCategory({ transactionId: before.id, categoryId: 'coffee' });

    // Sync 2: Plaid re-sends the txn as modified (pending → posted).
    syncPages = [{ accounts: [acct], added: [], modified: [plaidTxn({ pending: false })], removed: [], next_cursor: 'cur-2', has_more: false }];
    await new PlaidProvider().syncTransactions(USER);

    const after = await row();
    expect(after.status).toBe('POSTED'); // non-verdict refresh still lands
    expect(after.categoryId).toBe('coffee'); // the correction survives
    expect(after.needsReview).toBe(false);
    expect(after.confidenceBps).toBe(9900);
  });
});
