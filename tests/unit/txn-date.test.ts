/**
 * Transaction date write on the detail page (DECISIONS #612).
 *
 * The date was display-only. The write is Transaction.date (YYYY-MM-DD).
 * Amount, payee, and descriptor stay put. Demo cannot learn.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/recurring', () => ({ refreshRecurringForUser: vi.fn() }));

import { prisma } from '@/lib/db';
import { txnDateError } from '@/lib/engine/transactions/date';

const USER = `txn-date-${Date.now()}-${process.pid}`;

describe('Transaction detail surface lets the household change the date', () => {
  it('test_regression__txn_date_control_is_on_the_detail_page', () => {
    const page = readFileSync(
      resolve('src/components/finance/transaction-detail-view.tsx'),
      'utf8',
    );
    expect(page).toContain('TxnDateControl');
    const control = readFileSync(
      resolve('src/components/finance/txn-date-form.tsx'),
      'utf8',
    );
    expect(control).toContain('updateTransactionDate');
    expect(control).toContain('detail-date');
    expect(control).toContain('Save date');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('useActionState');
  });
});

describe('txnDateError — blank and garbage refuse', () => {
  it('test_regression__txn_date_refuses_blank_and_invalid', () => {
    expect(txnDateError('')).toMatch(/Enter a date/);
    expect(txnDateError('   ')).toMatch(/Enter a date/);
    expect(txnDateError('not-a-date')).toMatch(/valid calendar date/);
    expect(txnDateError('2026-02-31')).toMatch(/valid calendar date/);
    expect(txnDateError('2026-06-15')).toBeUndefined();
  });
});

describe('updateTransactionDate — calendar date, amount stays', () => {
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
        currentBalanceCents: 0,
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

  it('test_regression__household_can_change_a_transaction_date', async () => {
    const { updateTransactionDate } = await import('@/server/transaction-date-actions');
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
      const fd = new FormData();
      fd.set('date', '2026-06-15');
      const res = await updateTransactionDate(row.id, fd);
      expect(res.ok).toBe(true);
      const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
      expect(updated.date).toBe('2026-06-15');
      expect(updated.amountCents).toBe(-550);
      expect(updated.rawDescriptor).toBe('SQ *STARBUCKS STORE 123');
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__household_date_edit_re_matches_the_row', async () => {
    const { updateTransactionDate } = await import('@/server/transaction-date-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      await prisma.categorizationRule.create({
        data: {
          userId: USER,
          categoryId: 'groceries',
          priority: 110,
          matchKeywords: 'costco',
          weekendOnly: true,
        },
      });
      const row = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-10',
          rawDescriptor: 'COSTCO WHSE #1084',
          amountCents: -2_1240,
          categoryId: 'dining',
          needsReview: false,
        },
      });
      const fd = new FormData();
      fd.set('date', '2026-06-13');
      const res = await updateTransactionDate(row.id, fd);
      expect(res.ok).toBe(true);
      const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
      expect(updated.date).toBe('2026-06-13');
      expect(updated.categoryId).toBe('groceries');
      expect(updated.amountCents).toBe(-2_1240);
      expect(updated.needsReview).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__txn_date_demo_cannot_learn', async () => {
    const { updateTransactionDate } = await import('@/server/transaction-date-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('date', '2026-06-15');
      const res = await updateTransactionDate('txn-x', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
