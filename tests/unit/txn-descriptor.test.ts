/**
 * Transaction bank-text write on the detail page (DECISIONS #617).
 *
 * The words a rule matches were display-only. The write is rawDescriptor.
 * Amount, date, and merchantId stay put. Demo cannot learn.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/recurring', () => ({ refreshRecurringForUser: vi.fn() }));

import { prisma } from '@/lib/db';
import { MAX_TXN_DESCRIPTOR, txnDescriptorError } from '@/lib/engine/transactions/descriptor';

const USER = `txn-desc-${Date.now()}-${process.pid}`;

describe('Transaction detail surface lets the household change the bank text', () => {
  it('test_regression__txn_descriptor_control_is_on_the_detail_page', () => {
    const page = readFileSync(
      resolve('src/components/finance/transaction-detail-view.tsx'),
      'utf8',
    );
    expect(page).toContain('TxnDescriptorControl');
    const control = readFileSync(
      resolve('src/components/finance/txn-descriptor-form.tsx'),
      'utf8',
    );
    expect(control).toContain('updateTransactionDescriptor');
    expect(control).toContain('detail-raw-descriptor');
    expect(control).toContain('Save text');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('useActionState');
  });
});

describe('txnDescriptorError — blank and over-cap refuse', () => {
  it('test_regression__txn_descriptor_refuses_blank_and_over_cap', () => {
    expect(txnDescriptorError('')).toMatch(/bank sent/);
    expect(txnDescriptorError('   ')).toMatch(/bank sent/);
    expect(txnDescriptorError('x'.repeat(MAX_TXN_DESCRIPTOR + 1))).toMatch(/under 200/);
    expect(txnDescriptorError('COSTCO WHSE 1084')).toBeUndefined();
  });
});

describe('updateTransactionDescriptor — words change, amount stays', () => {
  let accountId = '';
  let merchantId = '';

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
    const merchant = await prisma.merchant.upsert({
      where: { canonical: 'Costco' },
      update: {},
      create: { canonical: 'Costco' },
    });
    merchantId = merchant.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_change_the_bank_text_on_a_transaction', async () => {
    const { updateTransactionDescriptor } = await import('@/server/transaction-descriptor-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const row = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-10',
          rawDescriptor: 'COSTCO WHSE 1084',
          amountCents: -21_240,
          merchantId,
        },
      });
      const fd = new FormData();
      fd.set('descriptor', 'COSTCO WHSE 9999');
      const res = await updateTransactionDescriptor(row.id, fd);
      expect(res.ok).toBe(true);
      const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
      expect(updated.rawDescriptor).toBe('COSTCO WHSE 9999');
      expect(updated.amountCents).toBe(-21_240);
      expect(updated.date).toBe('2026-06-10');
      expect(updated.merchantId).toBe(merchantId);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__txn_descriptor_demo_cannot_learn', async () => {
    const { updateTransactionDescriptor } = await import('@/server/transaction-descriptor-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('descriptor', 'COSTCO WHSE 1084');
      const res = await updateTransactionDescriptor('txn-x', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
