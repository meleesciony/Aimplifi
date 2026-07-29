/**
 * O.12d — provider-category BACKFILL (TASKS Wave O.12; the repair for the root cause
 * in STATUS §RE-DIAGNOSIS 2026-07-29). L.12 added `providerCategoryId` /
 * `providerCategoryConfidenceBps` with one writer (live /transactions/sync ingest)
 * and no backfill, and /transactions/sync never re-sends a delivered row — so every
 * pre-L.12 Plaid row carries a permanent null in the column the triage inbox's
 * "Plaid's guess" tier reads. The repair fetches the window via /transactions/get
 * and fills exactly the two provider columns, null-only.
 *
 * Failure direction under test throughout: a WRONG guess written here becomes a
 * confident-looking ONE-TAP mis-file in the inbox, so the majority of these cases
 * are SKIPS — the planner must refuse, with a named bucket, everything it cannot
 * match exactly (per the abstention-first rule in docs/lessons).
 *
 * Two layers, same file:
 *  1. the PURE planner (`planProviderCategoryBackfill`) — known-answer cases;
 *  2. the REAL `PlaidProvider.backfillProviderCategories` against a stubbed Plaid
 *     server + throwaway prisma rows (the plaid-balance-refresh.test.ts idiom):
 *     null-only writes, verdict untouchedness byte-for-byte, SimpleFIN/manual rows
 *     out of scope, pagination, per-item failure isolation, idempotency, demo fence.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { PlaidProvider } from '@/lib/providers/plaid';
import {
  type BackfillCandidateRow,
  type FetchedPlaidTxn,
  planProviderCategoryBackfill,
} from '@/lib/providers/plaid-backfill';
import { persistedProviderGuess, prepareIngestedTransaction, type PlaidTransaction } from '@/lib/providers/plaid-map';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { encryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';

// ---------------------------------------------------------------------------
// Layer 1: the pure planner
// ---------------------------------------------------------------------------

const DINING_LOW = {
  primary: 'FOOD_AND_DRINK',
  detailed: 'FOOD_AND_DRINK_RESTAURANT',
  confidence_level: 'LOW',
} as const; // → dining / 4000 (locked in plaid-map.test.ts)
const SHOPPING_VH = {
  primary: 'GENERAL_MERCHANDISE',
  detailed: 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES',
  confidence_level: 'VERY_HIGH',
} as const; // → shopping / 8800
const INCOME_HIGH = {
  primary: 'INCOME',
  detailed: 'INCOME_WAGES',
  confidence_level: 'HIGH',
} as const; // → paycheck (Income group — the F4 sign-guard case)

const row = (over: Partial<BackfillCandidateRow> = {}): BackfillCandidateRow => ({
  id: 'row-1',
  providerRef: 'txn-1',
  accountId: 'acct-A',
  amountCents: -4200, // $42.00 outflow (Pulse-signed)
  ...over,
});
const fetchedTxn = (over: Partial<FetchedPlaidTxn> = {}): FetchedPlaidTxn => ({
  transaction_id: 'txn-1',
  account_id: 'pa-A',
  amount: 42.0, // Plaid outflow-positive dollars
  personal_finance_category: DINING_LOW,
  ...over,
});
const MAP = new Map([
  ['pa-A', 'acct-A'],
  ['pa-B', 'acct-B'],
]);

describe('planProviderCategoryBackfill — pure planner (O.12d)', () => {
  it('exact match on id + account + amount → writes the ingest-authored guess', () => {
    const plan = planProviderCategoryBackfill([row()], [fetchedTxn()], MAP);
    expect(plan.writes).toEqual([
      { id: 'row-1', providerCategoryId: 'dining', providerCategoryConfidenceBps: 4000, amountCents: -4200 },
    ]);
    expect(Object.values(plan.skipped).every((n) => n === 0)).toBe(true);
  });

  it('writes agree with what live ingest would have persisted for the same txn (one author)', () => {
    // The planner's guess and prepareIngestedTransaction's persisted columns must be
    // the SAME function. Cases: a kept guess, and the F4 sign-guard drop.
    for (const pfc of [DINING_LOW, SHOPPING_VH, INCOME_HIGH]) {
      const txn: PlaidTransaction = {
        transaction_id: 't',
        account_id: 'pa-A',
        date: '2026-06-08',
        amount: 42.0,
        name: 'ACME',
        pending: false,
        personal_finance_category: pfc,
      };
      const ingested = prepareIngestedTransaction(txn, 'acct-A');
      const guess = persistedProviderGuess(ingested.amountCents, txn.personal_finance_category);
      expect(guess?.categoryId ?? null).toBe(ingested.providerCategoryId);
      expect(guess?.confidenceBps ?? null).toBe(ingested.providerCategoryConfidenceBps);
    }
  });

  it('a row the fetch did not return is SKIPPED (notReturned), never guessed', () => {
    const plan = planProviderCategoryBackfill([row({ providerRef: 'txn-absent' })], [fetchedTxn()], MAP);
    expect(plan.writes).toEqual([]);
    expect(plan.skipped.notReturned).toBe(1);
  });

  it("a fetched row whose account maps to a DIFFERENT local account is SKIPPED (accountMismatch)", () => {
    const plan = planProviderCategoryBackfill(
      [row({ accountId: 'acct-B' })], // local row sits on B; fetched txn's account maps to A
      [fetchedTxn()],
      MAP,
    );
    expect(plan.writes).toEqual([]);
    expect(plan.skipped.accountMismatch).toBe(1);
  });

  it('a fetched row whose account_id is UNMAPPED is SKIPPED (accountMismatch), not written', () => {
    const plan = planProviderCategoryBackfill([row()], [fetchedTxn({ account_id: 'pa-unknown' })], MAP);
    expect(plan.writes).toEqual([]);
    expect(plan.skipped.accountMismatch).toBe(1);
  });

  it('an amount that disagrees through the ingest conversion is SKIPPED (amountMismatch)', () => {
    const plan = planProviderCategoryBackfill([row()], [fetchedTxn({ amount: 43.0 })], MAP);
    expect(plan.writes).toEqual([]);
    expect(plan.skipped.amountMismatch).toBe(1);
  });

  it('a NON-FINITE fetched amount skips the one row (amountMismatch), never aborts the run', () => {
    // plaidAmountToCents THROWS on a non-finite amount; a malformed payload row must
    // cost one counted skip, not the whole user's repair (critic A P3-2).
    for (const amount of [NaN, Infinity, -Infinity]) {
      const plan = planProviderCategoryBackfill([row()], [fetchedTxn({ amount })], MAP);
      expect(plan.writes).toEqual([]);
      expect(plan.skipped.amountMismatch).toBe(1);
    }
  });

  it('a matched row Plaid has no usable guess for is a counted no-op (noGuess) — the null is CORRECT', () => {
    const noPfc = planProviderCategoryBackfill(
      [row()],
      [fetchedTxn({ personal_finance_category: null })],
      MAP,
    );
    expect(noPfc.writes).toEqual([]);
    expect(noPfc.skipped.noGuess).toBe(1);
    const unknown = planProviderCategoryBackfill(
      [row()],
      [fetchedTxn({ personal_finance_category: { ...DINING_LOW, confidence_level: 'UNKNOWN' } })],
      MAP,
    );
    expect(unknown.skipped.noGuess).toBe(1);
  });

  it('F4 sign guard: an OUTFLOW guessed as INCOME is SKIPPED (noGuess) — same rule as live ingest', () => {
    const plan = planProviderCategoryBackfill(
      [row({ amountCents: -4200 })],
      [fetchedTxn({ personal_finance_category: INCOME_HIGH })],
      MAP,
    );
    expect(plan.writes).toEqual([]);
    expect(plan.skipped.noGuess).toBe(1);
    // …and the INFLOW twin IS written (income on a credit is legitimate).
    const inflow = planProviderCategoryBackfill(
      [row({ amountCents: 300000 })],
      [fetchedTxn({ amount: -3000.0, personal_finance_category: INCOME_HIGH })],
      MAP,
    );
    expect(inflow.writes).toEqual([
      { id: 'row-1', providerCategoryId: 'paycheck', providerCategoryConfidenceBps: 8000, amountCents: 300000 }, // HIGH
    ]);
  });

  it('a transaction_id fetched twice with DISAGREEING fields is distrusted entirely (inconsistentFetch)', () => {
    const plan = planProviderCategoryBackfill(
      [row()],
      [fetchedTxn(), fetchedTxn({ amount: 99.0 })], // same id, different amount — pagination shifted
      MAP,
    );
    expect(plan.writes).toEqual([]);
    expect(plan.skipped.inconsistentFetch).toBe(1);
  });

  it('a transaction_id fetched twice IDENTICALLY (page overlap) still writes once', () => {
    const plan = planProviderCategoryBackfill([row()], [fetchedTxn(), fetchedTxn()], MAP);
    expect(plan.writes).toHaveLength(1);
    expect(plan.skipped.inconsistentFetch).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: the real provider method against a stubbed Plaid server
// ---------------------------------------------------------------------------

const KEY = Buffer.alloc(32, 7).toString('base64');

interface GetPage {
  transactions: unknown[];
  total_transactions: number;
}
// Fake-Plaid /transactions/get: pages keyed by offset, per access token; records calls.
let getPages: Map<string, (offset: number) => GetPage | { failWith: number }>;
let getCalls: Array<{ start_date: string; end_date: string; offset: number }>;

const ok = (json: unknown): Response =>
  ({ ok: true, status: 200, json: async () => json }) as Response;
const fail = (status: number, body: unknown): Response =>
  ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

function mockServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.endsWith('/transactions/get')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          access_token: string;
          start_date: string;
          end_date: string;
          options?: { offset?: number };
        };
        const offset = body.options?.offset ?? 0;
        getCalls.push({ start_date: body.start_date, end_date: body.end_date, offset });
        const pager = getPages.get(body.access_token);
        if (!pager) return fail(400, { error_code: 'ITEM_NOT_FOUND' });
        const page = pager(offset);
        if ('failWith' in page) return fail(page.failWith, { error_code: 'ITEM_LOGIN_REQUIRED' });
        return ok(page);
      }
      return fail(404, { error_code: 'NOT_MOCKED' });
    }),
  );
}

describe('PlaidProvider.backfillProviderCategories (real provider, mocked Plaid server, throwaway rows)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `o12d-user-${stamp}`;
  const provider = new PlaidProvider();
  const ids: Record<string, string> = {};

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    for (const c of [
      { id: 'dining', name: 'Dining Out' },
      { id: 'shopping', name: 'Shopping' },
    ]) {
      await prisma.category.upsert({
        where: { id: c.id },
        update: {},
        create: { id: c.id, name: c.name, isSystem: true },
      });
    }
  });
  afterAll(wipe);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    getPages = new Map();
    getCalls = [];
    mockServer();

    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    await prisma.plaidItem.create({
      data: {
        userId: USER,
        itemId: `item-1-${stamp}`,
        accessToken: encryptToken('tok-1', Buffer.from(KEY, 'base64')),
      },
    });
    const acct = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'plaid',
        providerRef: 'pa-A',
        name: 'Checking',
        type: 'CHECKING',
        currentBalanceCents: 100000,
      },
    });
    const sfAcct = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'simplefin',
        providerRef: 'sf-A',
        name: 'SF Checking',
        type: 'CHECKING',
        currentBalanceCents: 50000,
      },
    });
    ids.acct = acct.id;
    ids.sfAcct = sfAcct.id;

    // t1: pre-L.12 Plaid row, null provider cols, unfiled — the repair target.
    ids.t1 = (
      await prisma.transaction.create({
        data: {
          accountId: acct.id,
          providerRef: 'txn-1',
          date: '2026-05-02',
          amountCents: -4200,
          rawDescriptor: 'GOOSE POND BAR GRILLE',
          needsReview: true,
          status: 'POSTED',
        },
      })
    ).id;
    // t2: matched but Plaid has no guess — must STAY null (correct null).
    ids.t2 = (
      await prisma.transaction.create({
        data: {
          accountId: acct.id,
          providerRef: 'txn-2',
          date: '2026-05-10',
          amountCents: -1000,
          rawDescriptor: 'LA MEI ZI',
          needsReview: true,
          status: 'POSTED',
        },
      })
    ).id;
    // t3: provider cols ALREADY populated — not a candidate; a differing fetched
    // guess must NOT overwrite it.
    ids.t3 = (
      await prisma.transaction.create({
        data: {
          accountId: acct.id,
          providerRef: 'txn-3',
          date: '2026-05-12',
          amountCents: -2000,
          rawDescriptor: 'AMAZON MKTP',
          providerCategoryId: 'shopping',
          providerCategoryConfidenceBps: 8800,
          status: 'POSTED',
        },
      })
    ).id;
    // t4: SimpleFIN row with null cols — out of scope by account.provider.
    ids.t4 = (
      await prisma.transaction.create({
        data: {
          accountId: sfAcct.id,
          providerRef: 'sf-txn-1',
          date: '2026-05-03',
          amountCents: -3000,
          rawDescriptor: 'SF ROW',
          status: 'POSTED',
        },
      })
    ).id;
    // t5: FILED Plaid row (user verdict) with null provider cols — columns may be
    // filled, the verdict may not move.
    ids.t5 = (
      await prisma.transaction.create({
        data: {
          accountId: acct.id,
          providerRef: 'txn-5',
          date: '2026-05-20',
          amountCents: -5500,
          rawDescriptor: 'ACME WIDGETS LLC',
          categoryId: 'dining',
          confidenceBps: 10000,
          needsReview: false,
          note: 'team lunch',
          status: 'POSTED',
        },
      })
    ).id;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const t = (id: string, over: Record<string, unknown> = {}) => ({
    transaction_id: id,
    account_id: 'pa-A',
    date: '2026-05-02',
    amount: 42.0,
    name: 'X',
    pending: false,
    ...over,
  });

  it('fills exactly the two provider columns on matched null rows; verdicts and out-of-scope rows byte-identical', async () => {
    const before = new Map(
      (await prisma.transaction.findMany({ where: { account: { userId: USER } } })).map((r) => [r.id, r]),
    );
    getPages.set('tok-1', (offset) =>
      offset === 0
        ? {
            // Two pages to prove pagination is followed (3 txns total, 2 on page 1).
            transactions: [
              t('txn-1', { amount: 42.0, personal_finance_category: DINING_LOW }),
              t('txn-2', { amount: 10.0, personal_finance_category: null }),
            ],
            total_transactions: 3,
          }
        : {
            transactions: [
              t('txn-5', { amount: 55.0, personal_finance_category: SHOPPING_VH }),
              // txn-3 deliberately NOT returned on any page for this test.
            ],
            total_transactions: 3,
          },
    );

    const r = await provider.backfillProviderCategories(USER);

    // The fetch window is exactly the null rows' date span (t1..t5, not t3/t4's dates).
    expect(getCalls.length).toBe(2);
    expect(getCalls[0]).toMatchObject({ start_date: '2026-05-02', end_date: '2026-05-20', offset: 0 });
    expect(getCalls[1]).toMatchObject({ offset: 2 });

    expect(r).toMatchObject({
      candidates: 3, // t1, t2, t5 — never t3 (populated), t4 (simplefin)
      planned: 2,
      written: 2,
      itemsQueried: 1,
      itemsFailed: 0,
      skipped: { notReturned: 0, inconsistentFetch: 0, accountMismatch: 0, amountMismatch: 0, noGuess: 1 },
    });

    const after = new Map(
      (await prisma.transaction.findMany({ where: { account: { userId: USER } } })).map((r2) => [r2.id, r2]),
    );
    // t1: the two provider columns and NOTHING else.
    expect(after.get(ids.t1)).toEqual({
      ...before.get(ids.t1),
      providerCategoryId: 'dining',
      providerCategoryConfidenceBps: 4000,
    });
    // t5 (filed): columns filled, the verdict — category, confidence, needsReview,
    // note — byte-identical.
    expect(after.get(ids.t5)).toEqual({
      ...before.get(ids.t5),
      providerCategoryId: 'shopping',
      providerCategoryConfidenceBps: 8800,
    });
    // t2 (no guess), t3 (already populated), t4 (simplefin): byte-identical.
    expect(after.get(ids.t2)).toEqual(before.get(ids.t2));
    expect(after.get(ids.t3)).toEqual(before.get(ids.t3));
    expect(after.get(ids.t4)).toEqual(before.get(ids.t4));

    // Counts-only audit row exists (no descriptors, no amounts in meta).
    const audit = await prisma.auditLog.findFirst({
      where: { userId: USER, action: 'plaid.provider-category.backfill' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.meta).not.toContain('GOOSE POND');
    expect(audit!.meta).not.toContain('4200');

    // IDEMPOTENT: a second run re-plans only the still-null rows and writes nothing new.
    const r2 = await provider.backfillProviderCategories(USER);
    expect(r2.candidates).toBe(1); // t2 only
    expect(r2.written).toBe(0);
    const again = await prisma.transaction.findUnique({ where: { id: ids.t1 } });
    expect(again).toEqual(after.get(ids.t1));
  });

  it('per-item failure is isolated: a dead item is counted + audited, the healthy item still repairs', async () => {
    await prisma.plaidItem.create({
      data: {
        userId: USER,
        itemId: `item-2-${stamp}`,
        accessToken: encryptToken('tok-2', Buffer.from(KEY, 'base64')),
      },
    });
    getPages.set('tok-1', () => ({
      transactions: [t('txn-1', { amount: 42.0, personal_finance_category: DINING_LOW })],
      total_transactions: 1,
    }));
    getPages.set('tok-2', () => ({ failWith: 400 }));

    const r = await provider.backfillProviderCategories(USER);
    expect(r.itemsQueried).toBe(1);
    expect(r.itemsFailed).toBe(1);
    expect(r.written).toBe(1);
    const audit = await prisma.auditLog.findFirst({
      where: { userId: USER, action: 'plaid.provider-category.backfill.item-failed' },
    });
    expect(audit).not.toBeNull();

    const t1 = await prisma.transaction.findUnique({ where: { id: ids.t1 } });
    expect(t1!.providerCategoryId).toBe('dining');
  });

  it('a user with no null-column Plaid rows makes ZERO Plaid calls', async () => {
    await prisma.transaction.updateMany({
      where: { account: { userId: USER, provider: 'plaid' } },
      data: { providerCategoryId: 'shopping', providerCategoryConfidenceBps: 8800 },
    });
    const r = await provider.backfillProviderCategories(USER);
    expect(r.candidates).toBe(0);
    expect(getCalls.length).toBe(0);
  });

  it('demo fence: the shared demo row triggers no query and no egress, by construction', async () => {
    const r = await provider.backfillProviderCategories(DEMO_USER_ID);
    expect(r).toMatchObject({ candidates: 0, written: 0, itemsQueried: 0 });
    expect(getCalls.length).toBe(0);
  });
});
