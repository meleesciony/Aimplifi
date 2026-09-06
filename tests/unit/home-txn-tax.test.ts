/**
 * Home recent-charge tax tag write without opening detail (DECISIONS #640).
 *
 * Tax tag write lived only on transaction detail via setTransactionTax (note +
 * taxClass together). Calling that from Home with only a tax class would clear
 * the note. New updateTransactionTaxClass writes taxClass only. TxnTaxClassControl
 * mounts on the Home meta line as a sibling of the C.15 row Link. Detail paired
 * form unchanged.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { updateTransactionTaxClass } from '@/server/transaction-tax-actions';
import { setTransactionTax } from '@/server/tax-actions';
import { DEMO_ENTRY_BLOCKED, DEMO_USER_ID } from '@/lib/demo-user';

describe('Home recent charges mount TxnTaxClassControl', () => {
  it('test_regression__household_can_set_a_tax_tag_on_a_home_recent_charge_without_opening_detail', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('TxnTaxClassControl');
    expect(card).toContain("from '@/components/finance/txn-tax-form'");
    expect(card).toContain('compact');
    expect(card).toContain('triggerTestId="home-recent-tax"');
    expect(card).toContain('canRenamePayee');

    // TxnTaxClassControl is a sibling of the row Link, not nested inside it.
    const mapStart = card.indexOf('rows.map');
    expect(mapStart).toBeGreaterThan(-1);
    const mapBlock = card.slice(mapStart);
    const controlIdx = mapBlock.indexOf('<TxnTaxClassControl');
    const rowTestIdIdx = mapBlock.indexOf('data-testid="dashboard-recent-row"');
    expect(controlIdx).toBeGreaterThan(-1);
    expect(rowTestIdIdx).toBeGreaterThan(-1);
    const linkOpen = mapBlock.lastIndexOf('<Link', rowTestIdIdx);
    expect(linkOpen).toBeGreaterThan(-1);
    const linkClose = mapBlock.indexOf('</Link>', rowTestIdIdx);
    expect(linkClose).toBeGreaterThan(linkOpen);
    const rowLinkInner = mapBlock.slice(linkOpen, linkClose);
    expect(rowLinkInner).toContain('data-testid="dashboard-recent-row"');
    expect(rowLinkInner).toContain('formatCents');
    expect(rowLinkInner).toContain('Open');
    expect(rowLinkInner).not.toContain('TxnTaxClassControl');

    const recent = readFileSync(resolve('src/server/dashboard-recent.ts'), 'utf8');
    expect(recent).toContain('taxClass: string | null');
    const pushStart = recent.indexOf('rows.push');
    expect(pushStart).toBeGreaterThan(-1);
    const pushBlock = recent.slice(pushStart, recent.indexOf('});', pushStart) + 3);
    expect(pushBlock).toContain('taxClass: t.taxClass ?? null');

    const form = readFileSync(resolve('src/components/finance/txn-tax-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionTaxClass');
    expect(form).toContain('compact');
    expect(form).toContain('Tax tag');
    expect(form).not.toContain('useActionState');
    expect(form).toContain("triggerTestId = 'detail-tax'");
    expect(form).toContain('txn-tax-form');
    expect(form).toContain('txn-tax-select');
    expect(form).toContain('txn-tax-save');

    const actions = readFileSync(resolve('src/server/transaction-tax-actions.ts'), 'utf8');
    expect(actions).toContain('isTaxClass');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
    expect(actions).toContain('transaction.taxClass.set');
    // Tax-only writer must not touch note.
    const writeStart = actions.indexOf('export async function updateTransactionTaxClass');
    expect(writeStart).toBeGreaterThan(-1);
    const writeFn = actions.slice(writeStart);
    expect(writeFn).toContain('data: { taxClass }');
    expect(writeFn).not.toContain('note');

    // Detail contract unchanged: setTransactionTax still writes both.
    const tax = readFileSync(resolve('src/server/tax-actions.ts'), 'utf8');
    expect(tax).toContain('data: { taxClass: input.taxClass, note: note.note }');
  });
});

describe('updateTransactionTaxClass — taxClass only, note untouched', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const OWNER = `tax-owner-${stamp}`;
  const STRANGER = `tax-stranger-${stamp}`;
  let ownTxnId = '';
  let strangerTxnId = '';

  const asUser = (id: string) => vi.mocked(auth).mockResolvedValue({ user: { id } } as never);

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: { in: [OWNER, STRANGER] } } });
  }

  beforeAll(async () => {
    await wipe().catch(() => {});
    for (const id of [OWNER, STRANGER]) {
      await prisma.user.create({ data: { id, email: `${id}@test.local` } });
    }
    const ownAcct = await prisma.account.create({
      data: {
        userId: OWNER,
        provider: 'simplefin',
        name: 'Tax Checking',
        type: 'CHECKING',
        currentBalanceCents: 10_000,
        currency: 'USD',
      },
    });
    const strangerAcct = await prisma.account.create({
      data: {
        userId: STRANGER,
        provider: 'simplefin',
        name: 'Stranger Checking',
        type: 'CHECKING',
        currentBalanceCents: 10_000,
        currency: 'USD',
      },
    });
    const mk = (accountId: string, over: Record<string, unknown> = {}) =>
      prisma.transaction.create({
        data: {
          accountId,
          date: '2025-03-04',
          amountCents: -12_345,
          rawDescriptor: 'TAX FIXTURE',
          status: 'POSTED',
          isTransfer: false,
          isSplitParent: false,
          ...over,
        },
      });
    ownTxnId = (await mk(ownAcct.id, { taxClass: null, note: "mum's prescription" })).id;
    strangerTxnId = (await mk(strangerAcct.id, { rawDescriptor: 'STRANGER TAX' })).id;
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes the tax class and leaves note put', async () => {
    asUser(OWNER);
    const fd = new FormData();
    fd.set('taxClass', 'medical');
    expect(await updateTransactionTaxClass(ownTxnId, fd)).toEqual({ ok: true });
    const t = await prisma.transaction.findUnique({ where: { id: ownTxnId } });
    expect(t?.taxClass).toBe('medical');
    expect(t?.note).toBe("mum's prescription");
  });

  it('empty string clears taxClass without clearing note', async () => {
    asUser(OWNER);
    await prisma.transaction.update({
      where: { id: ownTxnId },
      data: { taxClass: 'medical', note: "mum's prescription" },
    });
    const fd = new FormData();
    fd.set('taxClass', '');
    expect(await updateTransactionTaxClass(ownTxnId, fd)).toEqual({ ok: true });
    const t = await prisma.transaction.findUnique({ where: { id: ownTxnId } });
    expect(t?.taxClass).toBeNull();
    expect(t?.note).toBe("mum's prescription");
  });

  it('refuses an unrecognized class and writes nothing', async () => {
    asUser(OWNER);
    await prisma.transaction.update({
      where: { id: ownTxnId },
      data: { taxClass: 'medical', note: 'keep' },
    });
    const fd = new FormData();
    fd.set('taxClass', 'not-a-real-class');
    const res = await updateTransactionTaxClass(ownTxnId, fd);
    expect(res.ok).toBe(false);
    expect(res.errors?.taxClass).toMatch(/not a tax category/);
    const t = await prisma.transaction.findUnique({ where: { id: ownTxnId } });
    expect(t?.taxClass).toBe('medical');
    expect(t?.note).toBe('keep');
  });

  it('refuses a stranger row', async () => {
    asUser(OWNER);
    const fd = new FormData();
    fd.set('taxClass', 'charitable');
    const res = await updateTransactionTaxClass(strangerTxnId, fd);
    expect(res).toEqual({
      ok: false,
      error: "That transaction isn't on your list, so nothing changed.",
    });
  });

  it('audits taxClass, never note text', async () => {
    asUser(OWNER);
    await prisma.transaction.update({
      where: { id: ownTxnId },
      data: { note: 'therapy for my son', taxClass: null },
    });
    const fd = new FormData();
    fd.set('taxClass', 'education');
    await updateTransactionTaxClass(ownTxnId, fd);
    const logs = await prisma.auditLog.findMany({
      where: { userId: OWNER, action: 'transaction.taxClass.set' },
    });
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l.meta ?? '').not.toContain('therapy');
    expect(logs.at(-1)?.meta ?? '').toContain('taxClass');
  });

  it('setTransactionTax still writes note and taxClass together', async () => {
    asUser(OWNER);
    expect(
      await setTransactionTax({
        transactionId: ownTxnId,
        taxClass: 'charitable',
        note: 'paired write',
      }),
    ).toEqual({ ok: true });
    const t = await prisma.transaction.findUnique({ where: { id: ownTxnId } });
    expect(t?.taxClass).toBe('charitable');
    expect(t?.note).toBe('paired write');
  });

  it('demo fence refuses', async () => {
    asUser(DEMO_USER_ID);
    const fd = new FormData();
    fd.set('taxClass', 'medical');
    expect(await updateTransactionTaxClass(ownTxnId, fd)).toEqual({
      ok: false,
      error: DEMO_ENTRY_BLOCKED,
    });
  });
});
