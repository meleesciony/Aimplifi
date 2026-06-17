/**
 * Manual net-worth items (DECISIONS #39) — integration test driving the REAL
 * actions against a throwaway user: add asset + liability, verify net worth math
 * via getAccountsView, edit + delete, and the guard that a LINKED account can't
 * be edited/deleted through these actions.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { addManualAccount, deleteManualAccount, updateManualAccountValue } from '@/server/networth-actions';
import { getAccountsView } from '@/server/transactions';
import { prisma } from '@/lib/db';

describe('manual net-worth actions (real, throwaway user — DECISIONS #39)', () => {
  const USER = `nw-user-${Date.now()}-${process.pid}`;
  let linkedId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const linked = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'Checking', type: 'CHECKING', currentBalanceCents: 10_000_00 },
    });
    linkedId = linked.id;
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  it('adds a home asset and a mortgage, and net worth nets them against linked accounts', async () => {
    const home = await addManualAccount({ name: 'Primary home', type: 'REAL_ESTATE', value: '500000' });
    const mortgage = await addManualAccount({ name: 'Mortgage', type: 'MORTGAGE', value: '350000' });
    expect(home.ok && mortgage.ok).toBe(true);

    const view = await getAccountsView(USER);
    // assets: $10k checking + $500k home = $510k; liabilities: $350k mortgage
    expect(view.assets.subtotalCents).toBe(510_000_00);
    expect(view.liabilities.subtotalCents).toBe(350_000_00);
    expect(view.netWorthCents).toBe(160_000_00);
    // the manual ones are flagged manual; the linked one is not
    const home1 = view.assets.accounts.find((a) => a.name === 'Primary home');
    expect(home1?.manual).toBe(true);
    expect(view.assets.accounts.find((a) => a.id === linkedId)?.manual).toBe(false);
  });

  it('rejects invalid input without creating anything', async () => {
    const r = await addManualAccount({ name: '', type: 'NOPE', value: 'x' });
    expect(r.ok).toBe(false);
    expect(r.errors && r.errors.length).toBeGreaterThan(0);
  });

  it('updates a manual value and deletes it', async () => {
    const a = await addManualAccount({ name: 'Car', type: 'VEHICLE', value: '20000' });
    await updateManualAccountValue({ accountId: a.id!, value: '18500' });
    expect((await prisma.account.findUnique({ where: { id: a.id! } }))!.currentBalanceCents).toBe(18_500_00);
    await deleteManualAccount(a.id!);
    expect(await prisma.account.findUnique({ where: { id: a.id! } })).toBeNull();
  });

  it('refuses to edit or delete a LINKED account through the manual actions', async () => {
    await expect(updateManualAccountValue({ accountId: linkedId, value: '1' })).rejects.toThrow(/manually-added/i);
    await expect(deleteManualAccount(linkedId)).rejects.toThrow(/manually-added/i);
    // the linked account is untouched
    expect((await prisma.account.findUnique({ where: { id: linkedId } }))!.currentBalanceCents).toBe(10_000_00);
  });
});
