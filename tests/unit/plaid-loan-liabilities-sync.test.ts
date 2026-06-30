/**
 * Plaid mortgage/student liability ingest (#134), mocked-server integration. Runs the
 * REAL PlaidProvider.syncLiabilities against a throwaway user with global.fetch stubbed
 * to a fake Plaid server (the plaid-balance-refresh idiom; the live socket stays
 * UNVERIFIED). Locks: (1) a linked mortgage/student loan's APR + fixed monthly payment +
 * due day are populated from /liabilities/get; (2) a null field PRESERVES the last-known
 * value (never zeroes a real rate/payment — DECISIONS #130 discipline); (3) a student
 * loan with a null account_id is skipped without aborting the sweep.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { PlaidProvider } from '@/lib/providers/plaid';
import { encryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';

const KEY = Buffer.alloc(32, 7).toString('base64');
const ITEM_ID = 'item-loan-1';

const ok = (json: unknown): Response => ({ ok: true, status: 200, json: async () => json }) as Response;
const fail = (status: number, body: unknown): Response =>
  ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

let liabilitiesResponse: () => Response;
function mockServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/liabilities/get')) return liabilitiesResponse();
      return fail(404, { error_code: 'NOT_MOCKED' });
    }),
  );
}

describe('Plaid mortgage/student liability ingest (real provider, mocked Plaid server) — #134', () => {
  const USER = `plaid-loan-${Date.now()}-${process.pid}`;

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
    await prisma.plaidItem.create({
      data: { userId: USER, itemId: ITEM_ID, accessToken: encryptToken('access-tok', Buffer.from(KEY, 'base64')) },
    });
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('populates a mortgage and a student loan with APR + fixed monthly payment + due day', async () => {
    await prisma.account.createMany({
      data: [
        { userId: USER, provider: 'plaid', providerRef: 'mtg-1', name: 'Home Mortgage', type: 'MORTGAGE', currentBalanceCents: 32000000 },
        { userId: USER, provider: 'plaid', providerRef: 'stu-1', name: 'Student Loan', type: 'LOAN', currentBalanceCents: 1800000 },
      ],
    });
    liabilitiesResponse = () =>
      ok({
        liabilities: {
          credit: [],
          mortgage: [
            { account_id: 'mtg-1', next_monthly_payment: 1850.0, next_payment_due_date: '2026-07-15', interest_rate: { percentage: 6.49, type: 'fixed' } },
          ],
          student: [
            { account_id: 'stu-1', minimum_payment_amount: 250.0, next_payment_due_date: '2026-07-21', interest_rate_percentage: 4.53 },
          ],
        },
      });

    await new PlaidProvider().syncLiabilities(USER);

    const mtg = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'mtg-1' } });
    expect(mtg).toMatchObject({ aprBps: 649, minimumPaymentCents: 185000, dueDayOfMonth: 15 });
    const stu = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'stu-1' } });
    expect(stu).toMatchObject({ aprBps: 453, minimumPaymentCents: 25000, dueDayOfMonth: 21 });
  });

  it('preserves the last-known APR/payment/due-day when Plaid reports them null (never zeroes)', async () => {
    await prisma.account.create({
      data: { userId: USER, provider: 'plaid', providerRef: 'stu-1', name: 'Student Loan', type: 'LOAN', currentBalanceCents: 1800000, aprBps: 453, minimumPaymentCents: 25000, dueDayOfMonth: 21 },
    });
    // A deferment-state student loan: rate still known, but payment + date are null.
    liabilitiesResponse = () =>
      ok({
        liabilities: {
          student: [{ account_id: 'stu-1', minimum_payment_amount: null, next_payment_due_date: null, interest_rate_percentage: 4.53 }],
        },
      });

    await new PlaidProvider().syncLiabilities(USER);

    const stu = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'stu-1' } });
    // payment + due day PRESERVED (not blanked); rate refreshed to the same value.
    expect(stu).toMatchObject({ aprBps: 453, minimumPaymentCents: 25000, dueDayOfMonth: 21 });
  });

  it('skips a student loan with a null account_id (Plaid allows it) without aborting the sweep', async () => {
    await prisma.account.create({
      data: { userId: USER, provider: 'plaid', providerRef: 'stu-1', name: 'Student Loan', type: 'LOAN', currentBalanceCents: 1800000 },
    });
    liabilitiesResponse = () =>
      ok({
        liabilities: {
          student: [
            { account_id: null, minimum_payment_amount: 250.0, next_payment_due_date: '2026-07-21', interest_rate_percentage: 4.53 },
            { account_id: 'stu-1', minimum_payment_amount: 300.0, next_payment_due_date: '2026-07-09', interest_rate_percentage: 4.53 },
          ],
        },
      });

    await new PlaidProvider().syncLiabilities(USER);

    // The unjoinable (null account_id) row is skipped; the joinable one still applies.
    const stu = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'stu-1' } });
    expect(stu).toMatchObject({ aprBps: 453, minimumPaymentCents: 30000, dueDayOfMonth: 9 });
  });
});
