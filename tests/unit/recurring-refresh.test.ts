/**
 * Recurring re-detection after ingest (ROADMAP #1b / DECISIONS #22 tail) — drives
 * the REAL refreshRecurringForUser against a throwaway user with monthly recurring
 * transactions. Proves it persists the detected series + the scheduled projection,
 * is idempotent (full replace, not duplicate), and leaves user/seed scheduled rows
 * intact.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMonthsClamped, isoDate } from '@/lib/dates';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { refreshRecurringForUser } from '@/server/recurring';
import { prisma } from '@/lib/db';

describe('refreshRecurringForUser (post-ingest re-detection)', () => {
  const USER = `rec-refresh-${Date.now()}-${process.pid}`;
  const DESC = 'NETFLIX MONTHLY';
  const CANON = normalizeMerchant(DESC).canonical;
  let checkingId = '';
  let merchantId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const chk = await prisma.account.create({
      data: { userId: USER, provider: 'plaid', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500_000 },
    });
    checkingId = chk.id;
    const m = await prisma.merchant.upsert({
      where: { canonical: CANON },
      create: { canonical: CANON, defaultCategoryId: null },
      update: {},
    });
    merchantId = m.id;
    // Four monthly $15.99 charges → a MONTHLY recurring series.
    for (let i = 0; i < 4; i++) {
      await prisma.transaction.create({
        data: {
          accountId: checkingId,
          date: addMonthsClamped(isoDate('2026-02-15'), i),
          amountCents: -1599,
          rawDescriptor: DESC,
          merchantId,
          categoryId: null,
          status: 'POSTED',
        },
      });
    }
  });
  afterAll(wipe);

  it('detects the recurring series + a scheduled projection on the payment account', async () => {
    const r = await refreshRecurringForUser(USER, isoDate('2026-06-01'));
    expect(r.series).toBeGreaterThanOrEqual(1);

    const s = await prisma.recurringSeries.findFirst({ where: { userId: USER, merchantId } });
    expect(s).not.toBeNull();
    expect(s!.cadence).toBe('MONTHLY');
    expect(s!.typicalAmountCents).toBe(-1599);

    expect(r.scheduled).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.scheduledTransaction.count({ where: { account: { userId: USER }, source: 'recurring' } }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('is idempotent (replace, not duplicate) and preserves a user-managed scheduled row', async () => {
    // a user's own scheduled row must survive a re-detection
    await prisma.scheduledTransaction.create({
      data: { accountId: checkingId, description: 'Rent', amountCents: -200_000, nextDate: '2026-07-01', cadence: 'MONTHLY', source: 'user' },
    });
    await refreshRecurringForUser(USER, isoDate('2026-06-01'));
    await refreshRecurringForUser(USER, isoDate('2026-06-01')); // twice

    // exactly one series (full replace, no duplicates)
    expect(await prisma.recurringSeries.count({ where: { userId: USER, merchantId } })).toBe(1);
    // exactly one detected scheduled row for the series (not accumulated)
    expect(await prisma.scheduledTransaction.count({ where: { account: { userId: USER }, source: 'recurring' } })).toBe(1);
    // the user's Rent row is untouched
    expect(await prisma.scheduledTransaction.count({ where: { account: { userId: USER }, source: 'user' } })).toBe(1);
  });
});
