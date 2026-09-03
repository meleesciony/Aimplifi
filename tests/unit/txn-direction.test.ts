/**
 * Flip a transaction in or out (DECISIONS #616).
 *
 * Amount write keeps sign. Flip is the sign write: magnitude stays,
 * outflow becomes inflow and the reverse. Splits refuse. Demo cannot learn.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/recurring', () => ({ refreshRecurringForUser: vi.fn() }));

import { prisma } from '@/lib/db';
import { flippedTxnAmountCents } from '@/lib/engine/transactions/amount';

const USER = `txn-dir-${Date.now()}-${process.pid}`;

describe('Transaction detail surface lets the household flip in or out', () => {
  it('test_regression__txn_direction_control_is_on_the_detail_page', () => {
    const page = readFileSync(
      resolve('src/components/finance/transaction-detail-view.tsx'),
      'utf8',
    );
    expect(page).toContain('TxnDirectionControl');
    const control = readFileSync(
      resolve('src/components/finance/txn-direction-form.tsx'),
      'utf8',
    );
    expect(control).toContain('flipTransactionDirection');
    expect(control).toContain('Mark as money in');
    expect(control).toContain('Mark as money out');
    expect(control).not.toContain('useActionState');
  });
});

describe('flippedTxnAmountCents — magnitude stays, sign flips', () => {
  it('test_regression__txn_flip_negates_signed_cents', () => {
    expect(flippedTxnAmountCents(-550)).toBe(550);
    expect(flippedTxnAmountCents(5_000)).toBe(-5_000);
    expect(flippedTxnAmountCents(0)).toBeNull();
  });
});

describe('flipTransactionDirection — integer cents, splits refuse', () => {
  let accountId = '';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'demo',
        name: 'Checking',
        type: 'CHECKING',
        currentBalanceCents: 10_000,
      },
    });
    accountId = acct.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
    await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_flip_a_transaction_in_or_out', async () => {
    const { flipTransactionDirection } = await import('@/server/transaction-amount-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const row = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-10',
          rawDescriptor: 'SQ *STARBUCKS STORE 123',
          amountCents: -550,
        },
      });
      const res = await flipTransactionDirection(row.id);
      expect(res.ok).toBe(true);
      const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
      expect(updated.amountCents).toBe(550);
      expect(updated.rawDescriptor).toBe('SQ *STARBUCKS STORE 123');
      expect(updated.date).toBe('2026-06-10');
      const acct = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
      expect(acct.currentBalanceCents).toBe(10_000);

      const back = await flipTransactionDirection(row.id);
      expect(back.ok).toBe(true);
      const restored = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
      expect(restored.amountCents).toBe(-550);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__household_flip_re_matches_the_row', async () => {
    const { flipTransactionDirection } = await import('@/server/transaction-amount-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      await prisma.categorizationRule.create({
        data: {
          userId: USER,
          categoryId: 'paycheck',
          priority: 110,
          matchKeywords: 'paypal',
        },
      });
      const row = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-10',
          rawDescriptor: 'PAYPAL INST XFER',
          amountCents: -25_000,
          categoryId: 'groceries',
          needsReview: false,
        },
      });
      const res = await flipTransactionDirection(row.id);
      expect(res.ok).toBe(true);
      const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
      expect(updated.amountCents).toBe(25_000);
      expect(updated.categoryId).toBe('paycheck');
      expect(updated.rawDescriptor).toBe('PAYPAL INST XFER');
      expect(updated.needsReview).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__txn_flip_refuses_a_split', async () => {
    const { flipTransactionDirection } = await import('@/server/transaction-amount-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const parent = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-11',
          rawDescriptor: 'COSTCO',
          amountCents: -10_000,
          isSplitParent: true,
        },
      });
      const res = await flipTransactionDirection(parent.id);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/split/i);
      const still = await prisma.transaction.findUniqueOrThrow({ where: { id: parent.id } });
      expect(still.amountCents).toBe(-10_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__txn_flip_demo_cannot_learn', async () => {
    const { flipTransactionDirection } = await import('@/server/transaction-amount-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const res = await flipTransactionDirection('txn-x');
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
