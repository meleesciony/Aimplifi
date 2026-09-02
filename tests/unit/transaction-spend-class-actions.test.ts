/**
 * Per-transaction Fixed/Discretionary verdict action (DECISIONS #397) — real
 * server action against throwaway data (never the seeded demo user):
 *
 *   flip one row → only THAT row stores a verdict (the owner's complaint:
 *   "when I switch one transaction in this category, they all do")
 *   a choice matching the guess stores NULL (the guess stays the default)
 *   the recurring-bill guess is honoured (declared/stored series → fixed)
 *   clear → NULL; out-of-scope rows and unknown values are refused
 *   the shared demo is fenced
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import {
  setMerchantSpendClass,
  setTransactionSpendClass,
} from '@/server/transaction-flags-actions';
import { DEMO_ENTRY_BLOCKED, DEMO_USER_ID } from '@/lib/demo-user';
import { SPEND_CLASS_BLOCKED_OUT_OF_SCOPE } from '@/lib/engine/transactions/actions';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { prisma } from '@/lib/db';

describe('setTransactionSpendClass (real action, throwaway data — DECISIONS #397)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `spend-class-${stamp}`;
  let accountId = '';
  let diningA = '';
  let diningB = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } }); // cascades account→txn
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'Checking', type: 'CHECKING', currentBalanceCents: 0 },
    });
    accountId = acct.id;
    const base = {
      accountId,
      amountCents: -4200,
      rawDescriptor: 'SQ *SALON SEVEN',
      categoryId: 'dining',
      status: 'POSTED',
      needsReview: false,
    };
    diningA = (await prisma.transaction.create({ data: { ...base, date: '2026-07-01' } })).id;
    diningB = (await prisma.transaction.create({ data: { ...base, date: '2026-07-02' } })).id;
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  afterAll(wipe);

  it('test_regression__set_spend_class_refuses_shared_demo', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { id: DEMO_USER_ID } } as never);
    const res = await setTransactionSpendClass({ transactionId: diningA, spendClass: 'fixed' });
    expect(res).toEqual({ ok: false, error: DEMO_ENTRY_BLOCKED });
  });

  it('flips ONE row — the category sibling keeps its own guess', async () => {
    const res = await setTransactionSpendClass({ transactionId: diningA, spendClass: 'fixed' });
    expect(res.ok).toBe(true);
    const [a, b] = await Promise.all([
      prisma.transaction.findUniqueOrThrow({ where: { id: diningA } }),
      prisma.transaction.findUniqueOrThrow({ where: { id: diningB } }),
    ]);
    expect(a.spendClassOverride).toBe('fixed');
    expect(b.spendClassOverride).toBeNull();
  });

  it('a choice matching the guess stores NULL — the guess stays the default', async () => {
    // dining guesses guilt-free by taxonomy; saying "discretionary" is agreement.
    const res = await setTransactionSpendClass({ transactionId: diningB, spendClass: 'guilt-free' });
    expect(res.ok).toBe(true);
    const b = await prisma.transaction.findUniqueOrThrow({ where: { id: diningB } });
    expect(b.spendClassOverride).toBeNull();
  });

  it('the recurring-bill guess makes "fixed" the agreement (stored as NULL)', async () => {
    const canonical = normalizeMerchant('SQ *SALON SEVEN').canonical;
    const merchant = await prisma.merchant.create({ data: { canonical } });
    await prisma.recurringSeries.create({
      data: {
        userId: USER,
        merchantId: merchant.id,
        cadence: 'MONTHLY',
        typicalAmountCents: -4200,
        lastAmountCents: -4200,
        lastSeenAt: '2026-07-02',
        isSubscription: false,
      },
    });
    const res = await setTransactionSpendClass({ transactionId: diningB, spendClass: 'fixed' });
    expect(res.ok).toBe(true);
    const b = await prisma.transaction.findUniqueOrThrow({ where: { id: diningB } });
    expect(b.spendClassOverride).toBeNull(); // fixed IS the guess now — nothing to store
    // …and saying "discretionary" against that guess stores the verdict.
    const flip = await setTransactionSpendClass({ transactionId: diningB, spendClass: 'guilt-free' });
    expect(flip.ok).toBe(true);
    const b2 = await prisma.transaction.findUniqueOrThrow({ where: { id: diningB } });
    expect(b2.spendClassOverride).toBe('guilt-free');
  });

  it('clear restores the guess', async () => {
    const res = await setTransactionSpendClass({ transactionId: diningB, spendClass: null });
    expect(res.ok).toBe(true);
    const b = await prisma.transaction.findUniqueOrThrow({ where: { id: diningB } });
    expect(b.spendClassOverride).toBeNull();
  });

  it('refuses an out-of-scope row and an unknown class', async () => {
    const transfer = await prisma.transaction.create({
      data: {
        accountId,
        date: '2026-07-03',
        amountCents: -1000,
        rawDescriptor: 'TRANSFER TO SAVINGS',
        categoryId: 'transfer',
        status: 'POSTED',
        isTransfer: true,
      },
    });
    const res = await setTransactionSpendClass({ transactionId: transfer.id, spendClass: 'fixed' });
    expect(res).toEqual({ ok: false, error: SPEND_CLASS_BLOCKED_OUT_OF_SCOPE });
    const bad = await setTransactionSpendClass({ transactionId: diningA, spendClass: 'essential' });
    expect(bad.ok).toBe(false);
  });
});

describe('setMerchantSpendClass — the "all of this payee" scope (#397)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `spend-class-bulk-${stamp}`;
  let accountId = '';
  let chunsA = '';
  let chunsB = '';
  let other = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'Checking', type: 'CHECKING', currentBalanceCents: 0 },
    });
    accountId = acct.id;
    const chuns = await prisma.merchant.create({ data: { canonical: `Chuns Martial ${stamp}` } });
    const otherMerchant = await prisma.merchant.create({ data: { canonical: `Other Gym ${stamp}` } });
    const base = {
      accountId,
      amountCents: -445,
      categoryId: 'fitness',
      status: 'POSTED',
      needsReview: false,
    };
    chunsA = (
      await prisma.transaction.create({
        data: { ...base, date: '2026-06-04', rawDescriptor: `CHUNS MARTIAL ${stamp}`, merchantId: chuns.id },
      })
    ).id;
    chunsB = (
      await prisma.transaction.create({
        data: { ...base, date: '2026-07-04', rawDescriptor: `CHUNS MARTIAL ${stamp}`, merchantId: chuns.id },
      })
    ).id;
    other = (
      await prisma.transaction.create({
        data: { ...base, date: '2026-07-05', rawDescriptor: `OTHER GYM ${stamp}`, merchantId: otherMerchant.id },
      })
    ).id;
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  afterAll(wipe);

  it('marks every transaction of the payee — and no other payee', async () => {
    const res = await setMerchantSpendClass({ transactionId: chunsA, spendClass: 'fixed' });
    expect(res).toEqual({ ok: true, affected: 2 });
    const [a, b, o] = await Promise.all([
      prisma.transaction.findUniqueOrThrow({ where: { id: chunsA } }),
      prisma.transaction.findUniqueOrThrow({ where: { id: chunsB } }),
      prisma.transaction.findUniqueOrThrow({ where: { id: other } }),
    ]);
    expect(a.spendClassOverride).toBe('fixed');
    expect(b.spendClassOverride).toBe('fixed');
    expect(o.spendClassOverride).toBeNull();
  });

  it('stores NULL on rows whose guess already agrees', async () => {
    // fitness guesses guilt-free by taxonomy, so a merchant-wide
    // "Discretionary" is agreement everywhere — nothing to store.
    const res = await setMerchantSpendClass({ transactionId: chunsA, spendClass: 'guilt-free' });
    expect(res).toEqual({ ok: true, affected: 2 });
    const b = await prisma.transaction.findUniqueOrThrow({ where: { id: chunsB } });
    expect(b.spendClassOverride).toBeNull();
  });

  it('is fenced off the shared demo', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { id: DEMO_USER_ID } } as never);
    const res = await setMerchantSpendClass({ transactionId: chunsA, spendClass: 'fixed' });
    expect(res).toEqual({ ok: false, error: DEMO_ENTRY_BLOCKED });
  });
});

describe('setMerchantSpendClass — merchantless payee (DECISIONS #590)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `spend-class-mless-${stamp}`;
  let a = '';
  let b = '';
  let other = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'Checking', type: 'CHECKING', currentBalanceCents: 0 },
    });
    const d1 = `RIVER BEND POTTERY #12 ${stamp}`;
    const d2 = `RIVER BEND POTTERY #99 ${stamp}`;
    expect(normalizeMerchant(d1).canonical).toBe(normalizeMerchant(d2).canonical);
    const base = {
      accountId: acct.id,
      amountCents: -2200,
      categoryId: 'shopping',
      status: 'POSTED',
      needsReview: false,
      merchantId: null,
    };
    a = (await prisma.transaction.create({ data: { ...base, date: '2026-06-04', rawDescriptor: d1 } })).id;
    b = (await prisma.transaction.create({ data: { ...base, date: '2026-07-04', rawDescriptor: d2 } })).id;
    other = (
      await prisma.transaction.create({
        data: { ...base, date: '2026-07-05', rawDescriptor: `QQQZX PAYEE LLC ${stamp}` },
      })
    ).id;
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  afterAll(wipe);

  it('test_regression__household_can_change_spend_class_for_all_similar_merchantless_payee', async () => {
    const res = await setMerchantSpendClass({ transactionId: a, spendClass: 'fixed' });
    expect(res).toEqual({ ok: true, affected: 2 });
    const [ra, rb, ro] = await Promise.all([
      prisma.transaction.findUniqueOrThrow({ where: { id: a } }),
      prisma.transaction.findUniqueOrThrow({ where: { id: b } }),
      prisma.transaction.findUniqueOrThrow({ where: { id: other } }),
    ]);
    expect(ra.spendClassOverride).toBe('fixed');
    expect(rb.spendClassOverride).toBe('fixed');
    expect(ro.spendClassOverride).toBeNull();
  });
});
