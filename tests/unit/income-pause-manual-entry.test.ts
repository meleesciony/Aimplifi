/**
 * #251 — the manual-entry hook closes the confirmation lifecycle WITHOUT a provider
 * sync. The HANDLED-row copy claims "returns automatically when a new deposit
 * arrives"; for Plaid/SimpleFIN users the post-ingest refresh honors that, but a
 * manual-entry user has no sync — so createManualTransaction itself must run the
 * best-effort recurring refresh. This drives the REAL server action for the
 * resumed deposit and asserts the projection is restored and the stale
 * confirmation deleted, with NO direct refreshRecurringForUser call in the resumed
 * step (the hook does it).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { auth } from '@/auth';
import { addMonthsClamped, isoDate } from '@/lib/dates';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { createManualTransaction } from '@/server/transaction-actions';
import { confirmIncomePause, getConfirmedIncomePauses } from '@/server/income-pause';
import { refreshRecurringForUser } from '@/server/recurring';
import { prisma } from '@/lib/db';

const TODAY = '2026-06-10'; // pinned below via DEMO_TODAY (the ask-correction precedent)
const INCOME_DESC = 'STRIPE PAYOUT ETSY SHOP';
const INCOME_CANON = normalizeMerchant(INCOME_DESC).canonical; // "Stripe Payout"

describe('manual entry closes the income-pause lifecycle (#251)', () => {
  const USER = `pause-manual-${Date.now()}-${process.pid}`;
  let checkingId = '';
  let priorDemoToday: string | undefined;

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    priorDemoToday = process.env.DEMO_TODAY;
    process.env.DEMO_TODAY = TODAY; // pins businessToday for the action's refresh hook
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    const chk = await prisma.account.create({
      data: { userId: USER, provider: 'plaid', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500_000 },
    });
    checkingId = chk.id;
    await prisma.merchant.upsert({
      where: { canonical: INCOME_CANON },
      create: { canonical: INCOME_CANON, defaultCategoryId: null },
      update: {},
    });
    // Lapsed income series: 4 monthly +$380.00 deposits ending 2026-04-10.
    for (let i = 0; i < 4; i++) {
      await prisma.transaction.create({
        data: {
          accountId: checkingId,
          date: addMonthsClamped(isoDate('2026-01-10'), i),
          amountCents: 38000,
          rawDescriptor: INCOME_DESC,
          categoryId: null,
          status: 'POSTED',
        },
      });
    }
    // Confirm the pause and apply the exclusion (one explicit refresh to set the stage).
    expect(await confirmIncomePause(USER, INCOME_CANON)).toBe(true);
    await refreshRecurringForUser(USER, isoDate(TODAY));
  });
  afterAll(async () => {
    if (priorDemoToday === undefined) delete process.env.DEMO_TODAY;
    else process.env.DEMO_TODAY = priorDemoToday;
    await wipe();
  });

  it('a manually-entered resumed deposit restores the projection and retires the confirmation — no sync, no direct refresh', async () => {
    // Stage check: the confirmed lapse is excluded from projections.
    expect(
      await prisma.scheduledTransaction.count({
        where: { account: { userId: USER }, description: INCOME_CANON },
      }),
    ).toBe(0);

    // The resumed deposit arrives through the REAL manual-entry action.
    const form = new FormData();
    form.set('accountId', checkingId);
    form.set('descriptor', INCOME_DESC);
    form.set('amount', '380.00');
    form.set('direction', 'in');
    form.set('date', '2026-06-08');
    const res = await createManualTransaction(null, form);
    expect(res.ok).toBe(true);

    // The action's own best-effort refresh did the rest: projection restored…
    expect(
      await prisma.scheduledTransaction.count({
        where: { account: { userId: USER }, description: INCOME_CANON },
      }),
    ).toBe(1);
    // …and the stale confirmation is gone (a future pause re-asks).
    expect(await getConfirmedIncomePauses(USER)).toEqual(new Set());
  });
});
