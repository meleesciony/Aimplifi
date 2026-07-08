/**
 * #170 regression lock — manual-entry validation returns an INLINE error, never
 * the app error boundary.
 *
 * Before #170, createManualTransaction was a plain `<form action>` returning
 * Promise<void>; prepareManualTransaction THROWS on reachable form input (a
 * non-numeric or non-positive amount — the amount box is free text), so a typo
 * hit the app error boundary. Now the action is the useActionState shape
 * (prev, formData) => Promise<AddTxnResult> and catches those throws into
 * `{ ok: false, errors }`, and — critically — writes NO row on the bad path.
 *
 * Drives the REAL server action against a throwaway user (never the seeded demo
 * user). All three cases return before any DB write, so no Category FK target is
 * needed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { auth } from '@/auth';
import { createManualTransaction } from '@/server/transaction-actions';
import { prisma } from '@/lib/db';

describe('createManualTransaction validation → inline errors, no error boundary, no orphan row (#170)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `manual-valid-${stamp}`;
  let accountId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } }); // cascades accounts→txns
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'Checking', type: 'CHECKING', currentBalanceCents: 0 },
    });
    accountId = acct.id;
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  afterAll(wipe);

  function form(amount: string) {
    const f = new FormData();
    f.set('accountId', accountId);
    f.set('descriptor', 'E2E VALIDATION ROW');
    f.set('amount', amount);
    f.set('direction', 'out');
    f.set('date', '2026-06-15');
    return f; // auto-detect category (empty)
  }

  function rowCount() {
    return prisma.transaction.count({ where: { account: { userId: USER } } });
  }

  it('a non-numeric amount → { ok:false } with an amount hint, and NO row is written', async () => {
    const res = await createManualTransaction(null, form('abc'));
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual([expect.stringMatching(/amount/i)]);
    expect(await rowCount()).toBe(0);
  });

  it('a zero amount → { ok:false } with an amount hint, and NO row is written', async () => {
    const res = await createManualTransaction(null, form('0'));
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual([expect.stringMatching(/amount/i)]);
    expect(await rowCount()).toBe(0);
  });

  it('a negative amount → { ok:false }, and NO row is written', async () => {
    const res = await createManualTransaction(null, form('-5'));
    expect(res.ok).toBe(false);
    expect(res.errors?.length).toBeGreaterThan(0);
    expect(await rowCount()).toBe(0);
  });
});
