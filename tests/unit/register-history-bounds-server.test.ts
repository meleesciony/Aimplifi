/**
 * `getTransactions` reports the register's real history BOUNDS — integration.
 *
 * Why this file exists (K.3 critic cycle 1, F4): the slice shipped `newestDate`
 * and an `after-history` empty state with no lock on either. The critic's
 * sabotage was exact — flip `r.date > newestDate` to `r.date < newestDate` in
 * `server/transactions.ts` and `newestDate` collapses onto `oldestDate`, so a
 * reader inside their own history is told their "latest transaction" is the
 * FIRST row we hold — and nothing in 6,126 unit tests or 21 e2e assertions
 * turned red. `a-fix-that-cannot-fail-a-test-is-a-hypothesis`.
 *
 * The pure decision lives in register-empty-reason.test.ts. What only a real
 * loader can prove is that both bounds come off the register's own row set:
 * both directions distinct, both spanning the whole set rather than the page
 * slice, and both surviving the reader's filter — because the copy built from
 * them is a claim about all of the reader's history, not about the window.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { getTransactions } from '@/server/transactions';
import { prisma } from '@/lib/db';

const USER = `histbounds-${Date.now()}-${process.pid}`;

async function wipe() {
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
}

async function row(id: string, date: string, amountCents = -1_234) {
  const acct = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'hb-chk' } });
  await prisma.transaction.create({
    data: {
      id: `${id}-${process.pid}`,
      accountId: acct.id,
      date,
      amountCents,
      rawDescriptor: `ROW ${id}`,
      categoryId: 'uncategorized',
      confidenceBps: 4000,
      needsReview: true,
    },
  });
}

describe('the register reports its own history bounds', () => {
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.account.create({
      data: {
        userId: USER,
        provider: 'simplefin',
        providerRef: 'hb-chk',
        name: 'Checking',
        type: 'CHECKING',
        currentBalanceCents: 500_000,
        currency: 'USD',
      },
    });
  });

  it('an empty register reports NO bounds — not a date-shaped zero', async () => {
    const r = await getTransactions(USER);
    expect(r.oldestDate).toBeNull();
    expect(r.newestDate).toBeNull();
  });

  it('reports the first and last dates it holds, and they are DISTINCT ends', async () => {
    await row('a', '2026-03-25');
    await row('b', '2026-06-10');
    await row('c', '2026-08-05');

    const r = await getTransactions(USER);
    expect(r.oldestDate).toBe('2026-03-25');
    // The F4 sabotage lock: a newest computed with the oldest comparison
    // collapses these two, and this assertion is what turns red.
    expect(r.newestDate).toBe('2026-08-05');
    expect(r.newestDate).not.toBe(r.oldestDate);
  });

  it('a single row is both ends at once', async () => {
    await row('only', '2026-04-24');
    const r = await getTransactions(USER);
    expect(r.oldestDate).toBe('2026-04-24');
    expect(r.newestDate).toBe('2026-04-24');
  });

  it('the bounds describe the WHOLE set, not the window the reader filtered to', async () => {
    await row('a', '2026-03-25');
    await row('b', '2026-06-10');
    await row('c', '2026-08-05');

    // A window holding exactly the middle row must not move either bound: the
    // sentence built from them says how much history EXISTS, which is the only
    // reason it can explain a window that found none of it.
    const r = await getTransactions(USER, { from: '2026-06-01', to: '2026-06-30' });
    expect(r.rows).toHaveLength(1);
    expect(r.oldestDate).toBe('2026-03-25');
    expect(r.newestDate).toBe('2026-08-05');
  });

  it("a window entirely before the history still reports the bounds that explain it — the owner's shape", async () => {
    await row('a', '2026-03-25');
    await row('c', '2026-08-05');

    const r = await getTransactions(USER, { from: '2024-08-06', to: '2025-08-06' });
    expect(r.rows).toHaveLength(0);
    expect(r.summary.count).toBe(0);
    expect(r.oldestDate).toBe('2026-03-25');
    expect(r.newestDate).toBe('2026-08-05');
  });
});
