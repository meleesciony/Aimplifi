/**
 * Home recent-charge note write without opening detail (DECISIONS #639).
 *
 * Note write lived only on transaction detail via setTransactionTax (note +
 * taxClass together). Calling that from Home with only a note would clobber the
 * tax tag. New updateTransactionNote writes note only. TxnNoteControl mounts on
 * the Home meta line as a sibling of the C.15 row Link. Detail paired form
 * unchanged.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { updateTransactionNote } from '@/server/transaction-note-actions';
import { setTransactionTax } from '@/server/tax-actions';
import { DEMO_ENTRY_BLOCKED, DEMO_USER_ID } from '@/lib/demo-user';
import { TXN_NOTE_MAX_CHARS } from '@/lib/engine/tax/note';

describe('Home recent charges mount TxnNoteControl', () => {
  it('test_regression__household_can_add_or_edit_a_home_recent_charge_note_without_opening_detail', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('TxnNoteControl');
    expect(card).toContain("from '@/components/finance/txn-note-form'");
    expect(card).toContain('compact');
    expect(card).toContain('triggerTestId="home-recent-note"');
    expect(card).toContain('canRenamePayee');

    // TxnNoteControl is a sibling of the row Link, not nested inside it.
    const mapStart = card.indexOf('rows.map');
    expect(mapStart).toBeGreaterThan(-1);
    const mapBlock = card.slice(mapStart);
    const controlIdx = mapBlock.indexOf('<TxnNoteControl');
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
    expect(rowLinkInner).not.toContain('TxnNoteControl');

    const recent = readFileSync(resolve('src/server/dashboard-recent.ts'), 'utf8');
    expect(recent).toContain('note: string | null');
    const pushStart = recent.indexOf('rows.push');
    expect(pushStart).toBeGreaterThan(-1);
    const pushBlock = recent.slice(pushStart, recent.indexOf('});', pushStart) + 3);
    expect(pushBlock).toContain('note: t.note ?? null');

    const form = readFileSync(resolve('src/components/finance/txn-note-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionNote');
    expect(form).toContain('compact');
    expect(form).toContain('Note');
    expect(form).not.toContain('useActionState');
    expect(form).toContain("triggerTestId = 'detail-note'");

    const actions = readFileSync(resolve('src/server/transaction-note-actions.ts'), 'utf8');
    expect(actions).toContain('normalizeNote');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
    expect(actions).toContain('transaction.note.set');
    expect(actions).toContain('noteChars');
    // Note-only writer must not touch taxClass.
    const writeStart = actions.indexOf('export async function updateTransactionNote');
    expect(writeStart).toBeGreaterThan(-1);
    const writeFn = actions.slice(writeStart);
    expect(writeFn).toContain('data: { note: note.note }');
    expect(writeFn).not.toContain('taxClass');

    // Detail contract unchanged: setTransactionTax still writes both.
    const tax = readFileSync(resolve('src/server/tax-actions.ts'), 'utf8');
    expect(tax).toContain('data: { taxClass: input.taxClass, note: note.note }');
  });
});

describe('updateTransactionNote — note only, taxClass untouched', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const OWNER = `note-owner-${stamp}`;
  const STRANGER = `note-stranger-${stamp}`;
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
        name: 'Note Checking',
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
          rawDescriptor: 'NOTE FIXTURE',
          status: 'POSTED',
          isTransfer: false,
          isSplitParent: false,
          ...over,
        },
      });
    ownTxnId = (await mk(ownAcct.id, { taxClass: 'medical', note: null })).id;
    strangerTxnId = (await mk(strangerAcct.id, { rawDescriptor: 'STRANGER NOTE' })).id;
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes the note and leaves taxClass put', async () => {
    asUser(OWNER);
    const fd = new FormData();
    fd.set('note', "  mum's prescription  ");
    expect(await updateTransactionNote(ownTxnId, fd)).toEqual({ ok: true });
    const t = await prisma.transaction.findUnique({ where: { id: ownTxnId } });
    expect(t?.note).toBe("mum's prescription");
    expect(t?.taxClass).toBe('medical');
  });

  it('clears whitespace to null without clearing taxClass', async () => {
    asUser(OWNER);
    await prisma.transaction.update({
      where: { id: ownTxnId },
      data: { note: 'temporary', taxClass: 'medical' },
    });
    const fd = new FormData();
    fd.set('note', '   ');
    expect(await updateTransactionNote(ownTxnId, fd)).toEqual({ ok: true });
    const t = await prisma.transaction.findUnique({ where: { id: ownTxnId } });
    expect(t?.note).toBeNull();
    expect(t?.taxClass).toBe('medical');
  });

  it('refuses over the cap and writes nothing', async () => {
    asUser(OWNER);
    await prisma.transaction.update({
      where: { id: ownTxnId },
      data: { note: 'keep', taxClass: 'medical' },
    });
    const fd = new FormData();
    fd.set('note', 'x'.repeat(TXN_NOTE_MAX_CHARS + 1));
    const res = await updateTransactionNote(ownTxnId, fd);
    expect(res.ok).toBe(false);
    expect(res.errors?.note).toMatch(/longer than/);
    const t = await prisma.transaction.findUnique({ where: { id: ownTxnId } });
    expect(t?.note).toBe('keep');
    expect(t?.taxClass).toBe('medical');
  });

  it('refuses a stranger row', async () => {
    asUser(OWNER);
    const fd = new FormData();
    fd.set('note', 'mine now');
    const res = await updateTransactionNote(strangerTxnId, fd);
    expect(res).toEqual({
      ok: false,
      error: "That transaction isn't on your list, so nothing changed.",
    });
  });

  it('audits noteChars only, never the note text', async () => {
    asUser(OWNER);
    const fd = new FormData();
    fd.set('note', 'therapy for my son');
    await updateTransactionNote(ownTxnId, fd);
    const logs = await prisma.auditLog.findMany({
      where: { userId: OWNER, action: 'transaction.note.set' },
    });
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l.meta ?? '').not.toContain('therapy');
    expect(logs.at(-1)?.meta ?? '').toContain('noteChars');
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
    fd.set('note', 'should not save');
    expect(await updateTransactionNote(ownTxnId, fd)).toEqual({
      ok: false,
      error: DEMO_ENTRY_BLOCKED,
    });
  });
});
