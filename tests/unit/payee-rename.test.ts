/**
 * Payee rename from a transaction, without a filing rule (DECISIONS #604).
 *
 * A household could only rename a payee by writing a keyword rule whose
 * renameTo mutates Merchant.canonical. Overlay is a NAME: Merchant.canonical,
 * merchantId, and CategorizationRule stay put. Same payee's other rows pick
 * up the overlay through registerDisplayName.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { registerDisplayName, payeeRenameKey } from '@/lib/engine/transactions/display-name';

const USER = `payee-rename-${Date.now()}-${process.pid}`;

describe('Payee rename overlay is on the transaction detail surface', () => {
  it('test_regression__payee_rename_control_is_on_the_detail_page', () => {
    const page = readFileSync(resolve('src/components/finance/transaction-detail-view.tsx'), 'utf8');
    expect(page).toContain('PayeeNameControl');
    expect(page).toContain('detail-payee');
    const control = readFileSync(resolve('src/components/finance/payee-name-form.tsx'), 'utf8');
    expect(control).toContain('renamePayee');
    expect(control).toContain('clearPayeeRename');
    expect(control).toContain('Save name');
    expect(control).toContain('Clear name');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('createKeywordRule');
    expect(control).not.toContain('updateKeywordRule');
    expect(control).not.toContain('useActionState');
  });
});

describe('registerDisplayName — overlay wins, noise strip does not eat the reader name', () => {
  it('test_regression__payee_overlay_wins_without_rewriting_canonical', () => {
    const t = {
      merchant: { canonical: 'Starbucks' },
      rawDescriptor: 'SQ *STARBUCKS STORE 123',
    };
    expect(registerDisplayName(t)).toBe('Starbucks');
    const names = new Map([[payeeRenameKey(t), 'Coffee shop']]);
    expect(registerDisplayName(t, names)).toBe('Coffee shop');
    expect(t.merchant.canonical).toBe('Starbucks');
  });
});

describe('renamePayee — overlay only, never a rule', () => {
  let accountId = '';
  let merchantId = '';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'Checking', type: 'CHECKING', currentBalanceCents: 0 },
    });
    accountId = acct.id;
    const merchant = await prisma.merchant.upsert({
      where: { canonical: 'Starbucks' },
      update: {},
      create: { canonical: 'Starbucks' },
    });
    merchantId = merchant.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.payeeRename.deleteMany({ where: { userId: USER } });
    await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_rename_a_payee_on_a_transaction_without_writing_a_rule', async () => {
    const { renamePayee } = await import('@/server/payee-rename-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const a = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-10',
          rawDescriptor: 'SQ *STARBUCKS STORE 123',
          amountCents: -550,
          merchantId,
        },
      });
      const b = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-11',
          rawDescriptor: 'SQ *STARBUCKS STORE 999',
          amountCents: -400,
          merchantId,
        },
      });
      const none = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-12',
          rawDescriptor: 'ACME WIDGETS LLC 7781',
          amountCents: -2000,
        },
      });

      const rulesBefore = await prisma.categorizationRule.count({ where: { userId: USER } });
      const fd = new FormData();
      fd.set('name', 'Coffee shop');
      const res = await renamePayee(a.id, fd);
      expect(res.ok).toBe(true);

      expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(rulesBefore);
      const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
      expect(merchant.canonical).toBe('Starbucks');
      const rowA = await prisma.transaction.findUniqueOrThrow({ where: { id: a.id } });
      expect(rowA.merchantId).toBe(merchantId);
      const overlay = await prisma.payeeRename.findUniqueOrThrow({
        where: { userId_payeeKey: { userId: USER, payeeKey: 'Starbucks' } },
      });
      expect(overlay.name).toBe('Coffee shop');

      const { getPayeeRenames } = await import('@/server/payee-names');
      const names = await getPayeeRenames(USER);
      expect(
        registerDisplayName(
          { merchant: { canonical: 'Starbucks' }, rawDescriptor: rowA.rawDescriptor },
          names,
        ),
      ).toBe('Coffee shop');
      const rowB = await prisma.transaction.findUniqueOrThrow({
        where: { id: b.id },
        include: { merchant: true },
      });
      expect(registerDisplayName(rowB, names)).toBe('Coffee shop');
      expect(registerDisplayName({ rawDescriptor: none.rawDescriptor }, names)).not.toBe('Coffee shop');

      const m1 = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-14',
          rawDescriptor: 'ZELLE PAYMENT TO ALEX LEE',
          amountCents: -1500,
        },
      });
      const m2 = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-15',
          rawDescriptor: 'ZELLE PAYMENT TO ALEX LEE',
          amountCents: -900,
        },
      });
      const fd2 = new FormData();
      fd2.set('name', 'Alex');
      const res2 = await renamePayee(m1.id, fd2);
      expect(res2.ok).toBe(true);
      expect(await prisma.transaction.findUniqueOrThrow({ where: { id: m1.id } })).toMatchObject({
        merchantId: null,
      });
      const names2 = await getPayeeRenames(USER);
      expect(registerDisplayName({ rawDescriptor: m1.rawDescriptor }, names2)).toBe('Alex');
      expect(registerDisplayName({ rawDescriptor: m2.rawDescriptor }, names2)).toBe('Alex');
      expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(rulesBefore);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__payee_rename_refuses_blank_and_does_not_write_a_rule', async () => {
    const { renamePayee } = await import('@/server/payee-rename-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const t = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-13',
          rawDescriptor: 'LOCAL CAFE',
          amountCents: -800,
        },
      });
      const key = payeeRenameKey({ rawDescriptor: t.rawDescriptor });
      const blank = new FormData();
      blank.set('name', '   ');
      const res = await renamePayee(t.id, blank);
      expect(res.ok).toBe(false);
      expect(res.errors?.name).toMatch(/name/);
      expect(await prisma.payeeRename.count({ where: { userId: USER, payeeKey: key } })).toBe(0);
      expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__payee_rename_demo_cannot_learn', async () => {
    const { renamePayee } = await import('@/server/payee-rename-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('name', 'Coffee shop');
      const res = await renamePayee('any', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__household_can_clear_a_payee_rename_back_to_the_bank_name', async () => {
    const { renamePayee, clearPayeeRename } = await import('@/server/payee-rename-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const row = await prisma.transaction.create({
        data: {
          accountId,
          date: '2026-06-16',
          rawDescriptor: 'SQ *STARBUCKS STORE 555',
          amountCents: -450,
          merchantId,
        },
      });
      const fd = new FormData();
      fd.set('name', 'Coffee shop');
      expect((await renamePayee(row.id, fd)).ok).toBe(true);
      expect(
        await prisma.payeeRename.findUnique({
          where: { userId_payeeKey: { userId: USER, payeeKey: 'Starbucks' } },
        }),
      ).not.toBeNull();

      const res = await clearPayeeRename(row.id);
      expect(res.ok).toBe(true);
      expect(
        await prisma.payeeRename.findUnique({
          where: { userId_payeeKey: { userId: USER, payeeKey: 'Starbucks' } },
        }),
      ).toBeNull();
      const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
      expect(merchant.canonical).toBe('Starbucks');
      const still = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
      expect(still.merchantId).toBe(merchantId);
      const names = await (await import('@/server/payee-names')).getPayeeRenames(USER);
      expect(
        registerDisplayName(
          { merchant: { canonical: 'Starbucks' }, rawDescriptor: row.rawDescriptor },
          names,
        ),
      ).toBe('Starbucks');

      const again = await clearPayeeRename(row.id);
      expect(again.ok).toBe(false);
      expect(again.error).toMatch(/already what the bank sent/);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__payee_clear_rename_demo_cannot_learn', async () => {
    const { clearPayeeRename } = await import('@/server/payee-rename-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const res = await clearPayeeRename('txn-x');
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
