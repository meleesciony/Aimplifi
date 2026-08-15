/**
 * H.9 — set/clear the reader-chosen payee; loader lists register-axis rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO_ENTRY_BLOCKED, DEMO_USER_ID } from '@/lib/demo-user';
import { ACCOUNT_NOT_FOUND } from '@/lib/engine/account/display-name';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import {
  PAYMENT_MERCHANT_ACCOUNT_NOT_ELIGIBLE,
  PAYMENT_MERCHANT_NOT_IN_ACTIVITY,
} from '@/lib/engine/account/loan-payment-history';

let mockUserId = '';
vi.mock('@/server/authz', () => ({
  requireUserId: async () => mockUserId,
  auditLog: async () => undefined,
  rateLimitDurable: async () => true,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { prisma } = await import('@/lib/db');
const { setAccountPaymentMerchant } = await import('@/server/account-payment-merchant-actions');
const { getAccountDetail } = await import('@/server/transactions');

const USER = `payee-${Date.now()}-${process.pid}`;
const OTHER = `${USER}-other`;
const PAYEE = `Wells Fargo Mortgage ${USER}`;
const MANUAL_DESC = `ACME SERVICER ${USER}`;
const MANUAL_NAME = normalizeMerchant(MANUAL_DESC).canonical;

let mortgageId = '';
let checkingId = '';
let otherMortgageId = '';
let predId = '';
let paymentId = '';
let predPaymentId = '';

async function wipe() {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  await prisma.merchant.deleteMany({ where: { canonical: { in: [PAYEE, MANUAL_NAME] } } });
}

beforeAll(async () => {
  await wipe();
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  await prisma.user.create({ data: { id: OTHER, email: `${OTHER}@test.local` } });
  const merchant = await prisma.merchant.create({ data: { canonical: PAYEE } });
  // MANUAL_NAME is created only if the reader picks it — the no-merchantId path.
  const checking = await prisma.account.create({
    data: {
      userId: USER, provider: 'plaid', name: 'Everyday Checking', type: 'CHECKING',
      currentBalanceCents: 500_000,
    },
  });
  checkingId = checking.id;
  const pred = await prisma.account.create({
    data: {
      userId: USER, provider: 'simplefin', name: 'Old Checking', type: 'CHECKING',
      currentBalanceCents: 400_000,
    },
  });
  predId = pred.id;
  const mortgage = await prisma.account.create({
    data: {
      userId: USER, provider: 'plaid', name: 'Home Mortgage', type: 'MORTGAGE',
      currentBalanceCents: 41_230_000,
    },
  });
  mortgageId = mortgage.id;
  const otherMort = await prisma.account.create({
    data: {
      userId: OTHER, provider: 'plaid', name: 'Their Mortgage', type: 'MORTGAGE',
      currentBalanceCents: 10_000_000,
    },
  });
  otherMortgageId = otherMort.id;
  const payment = await prisma.transaction.create({
    data: {
      accountId: checkingId,
      date: '2026-06-03',
      amountCents: -621_707,
      rawDescriptor: PAYEE,
      merchantId: merchant.id,
      categoryId: 'uncategorized',
      confidenceBps: 9000,
      isTransfer: true,
    },
  });
  paymentId = payment.id;
  const predPay = await prisma.transaction.create({
    data: {
      accountId: predId,
      date: '2026-06-03',
      amountCents: -621_707,
      rawDescriptor: PAYEE,
      merchantId: merchant.id,
      categoryId: 'uncategorized',
      confidenceBps: 9000,
      isTransfer: true,
    },
  });
  predPaymentId = predPay.id;
  await prisma.transaction.create({
    data: {
      accountId: checkingId,
      date: '2026-06-04',
      amountCents: -8_000,
      rawDescriptor: MANUAL_DESC,
      categoryId: 'uncategorized',
      confidenceBps: 4000,
    },
  });
  mockUserId = USER;
});

afterAll(wipe);

describe('setAccountPaymentMerchant', () => {
  it('writes the reader-chosen payee and the panel lists the register row', async () => {
    const res = await setAccountPaymentMerchant({ accountId: mortgageId, payee: PAYEE });
    expect(res).toEqual({ ok: true });
    const detail = await getAccountDetail(USER, mortgageId);
    expect(detail?.paymentMerchant?.canonical).toBe(PAYEE);
    expect(detail?.payments.map((p) => p.id).sort()).toEqual([paymentId, predPaymentId].sort());
    expect(detail?.payments[0]?.amountCents).toBe(-621_707);
    expect(detail?.payments[0]?.isTransfer).toBe(true);
    expect(detail?.canSetPaymentMerchant).toBe(true);
    expect(detail?.paymentMerchantCandidates.map((c) => c.canonical).sort()).toEqual(
      [MANUAL_NAME, PAYEE].sort(),
    );
  });

  it('a case-variant POST stores the painted name, not a second Merchant', async () => {
    const res = await setAccountPaymentMerchant({ accountId: mortgageId, payee: PAYEE.toLowerCase() });
    expect(res).toEqual({ ok: true });
    const row = await prisma.account.findUniqueOrThrow({
      where: { id: mortgageId },
      select: { paymentMerchant: { select: { canonical: true } } },
    });
    expect(row.paymentMerchant?.canonical).toBe(PAYEE);
  });

  it('a hand-entered row with no merchantId still matches via the register display name', async () => {
    const res = await setAccountPaymentMerchant({ accountId: mortgageId, payee: MANUAL_NAME });
    expect(res).toEqual({ ok: true });
    const detail = await getAccountDetail(USER, mortgageId);
    expect(detail?.payments).toHaveLength(1);
    expect(detail?.payments[0]?.merchantName).toBe(MANUAL_NAME);
    expect(detail?.payments[0]?.amountCents).toBe(-8_000);
  });

  it('clears back to ASK', async () => {
    const res = await setAccountPaymentMerchant({ accountId: mortgageId, payee: null });
    expect(res).toEqual({ ok: true });
    const detail = await getAccountDetail(USER, mortgageId);
    expect(detail?.paymentMerchant).toBeNull();
    expect(detail?.payments).toEqual([]);
  });

  it('refuses a checking account, a stranger’s mortgage, a name not in activity, and the demo', async () => {
    expect(await setAccountPaymentMerchant({ accountId: checkingId, payee: PAYEE })).toEqual({
      ok: false,
      errors: [PAYMENT_MERCHANT_ACCOUNT_NOT_ELIGIBLE],
    });
    expect(await setAccountPaymentMerchant({ accountId: otherMortgageId, payee: PAYEE })).toEqual({
      ok: false,
      errors: [ACCOUNT_NOT_FOUND],
    });
    expect(await setAccountPaymentMerchant({ accountId: mortgageId, payee: 'Not A Real Payee' })).toEqual({
      ok: false,
      errors: [PAYMENT_MERCHANT_NOT_IN_ACTIVITY],
    });
    mockUserId = DEMO_USER_ID;
    expect(await setAccountPaymentMerchant({ accountId: mortgageId, payee: PAYEE })).toEqual({
      ok: false,
      errors: [DEMO_ENTRY_BLOCKED],
    });
    mockUserId = USER;
  });

  it('does not infer a payee from a similar name sitting on the register', async () => {
    const detail = await getAccountDetail(USER, mortgageId);
    expect(detail?.paymentMerchant).toBeNull();
    expect(detail?.payments).toEqual([]);
  });
});
