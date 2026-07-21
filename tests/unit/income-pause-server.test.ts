/**
 * Income-Pause confirmation → projection exclusion (#251) — drives the REAL
 * refreshRecurringForUser + the confirmation store against a throwaway user whose
 * PAYCHECK lands on the payment account (unlike the demo seed, which parks the
 * engineered pause on savings precisely so projections are untouched — this test
 * exercises the path the demo deliberately avoids).
 *
 * The contract under test (AI plan §Later #20's confirmation-gated mutation):
 *   1. an UNCONFIRMED lapse still projects — the radar alone never mutates;
 *   2. a CONFIRMED lapse is excluded from the detected ScheduledTransaction rows
 *      (the `projectedIncome = 0` mutation), while non-income series project on;
 *   3. a RESUMED series projects again AND its stale confirmation is deleted —
 *      a future pause re-asks instead of silently re-applying old consent;
 *   4. the demo fence: the shared demo account can never write a confirmation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMonthsClamped, isoDate } from '@/lib/dates';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { refreshRecurringForUser } from '@/server/recurring';
import { confirmIncomePause, getConfirmedIncomePauses, undoIncomePause } from '@/server/income-pause';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { prisma } from '@/lib/db';

const TODAY = isoDate('2026-06-10');
const INCOME_DESC = 'STRIPE PAYOUT ETSY SHOP';
const INCOME_CANON = normalizeMerchant(INCOME_DESC).canonical; // "Stripe Payout"
const BILL_DESC = 'NETFLIX MONTHLY';

describe('income-pause confirmation → scheduled-projection exclusion (#251)', () => {
  const USER = `income-pause-${Date.now()}-${process.pid}`;
  let checkingId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  async function scheduledFor(description: string): Promise<number> {
    return prisma.scheduledTransaction.count({
      where: { account: { userId: USER }, description },
    });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const chk = await prisma.account.create({
      data: { userId: USER, provider: 'plaid', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500_000 },
    });
    checkingId = chk.id;
    for (const desc of [INCOME_DESC, BILL_DESC]) {
      await prisma.merchant.upsert({
        where: { canonical: normalizeMerchant(desc).canonical },
        create: { canonical: normalizeMerchant(desc).canonical, defaultCategoryId: null },
        update: {},
      });
    }
    // Income: four identical monthly +$380.00 deposits, 2026-01-10..04-10, then
    // silence — lapsed at TODAY (missedSince 2026-05-10, daysLate 31 ≥ grace 10).
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
    // A current EXPENSE series on the same account — the exclusion must never touch it.
    for (let i = 0; i < 4; i++) {
      await prisma.transaction.create({
        data: {
          accountId: checkingId,
          date: addMonthsClamped(isoDate('2026-03-05'), i),
          amountCents: -1599,
          rawDescriptor: BILL_DESC,
          categoryId: null,
          status: 'POSTED',
        },
      });
    }
  });
  afterAll(wipe);

  it('1. UNCONFIRMED lapse still projects — the radar alone never mutates a projection', async () => {
    await refreshRecurringForUser(USER, TODAY);
    expect(await scheduledFor(INCOME_CANON)).toBe(1);
    const row = await prisma.scheduledTransaction.findFirst({
      where: { account: { userId: USER }, description: INCOME_CANON },
    });
    expect(row!.source).toBe('payroll-detected');
    expect(row!.amountCents).toBe(38000);
  });

  it('2. CONFIRMED lapse is excluded from projections; non-income series project on', async () => {
    expect(await confirmIncomePause(USER, INCOME_CANON)).toBe(true);
    expect(await getConfirmedIncomePauses(USER)).toEqual(new Set([INCOME_CANON]));
    await refreshRecurringForUser(USER, TODAY);
    // The paused income is gone from the projection…
    expect(await scheduledFor(INCOME_CANON)).toBe(0);
    // …but the series ITSELF is still persisted (the /recurring page keeps showing it)…
    const merchant = await prisma.merchant.findUnique({ where: { canonical: INCOME_CANON } });
    expect(
      await prisma.recurringSeries.count({ where: { userId: USER, merchantId: merchant!.id } }),
    ).toBe(1);
    // …and the unrelated expense series still projects.
    expect(await scheduledFor(normalizeMerchant(BILL_DESC).canonical)).toBe(1);
  });

  it('2b. #251 critic F1 (regression): a provider row-removal is NOT resumption — exclusion and consent both hold', async () => {
    // The executed critic repro: delete ONE historical income row (Plaid removes
    // rows routinely). Occurrences drop 4→3 — below the ALARM floor — but no
    // deposit ever arrived, so the confirmed exclusion must stay in force and the
    // consent row must survive. (The old ¬lapsed rule deleted the confirmation and
    // re-projected +$380 as arriving today.)
    const removed = await prisma.transaction.findFirst({
      where: { accountId: checkingId, rawDescriptor: INCOME_DESC, date: '2026-01-10' },
    });
    await prisma.transaction.delete({ where: { id: removed!.id } });
    await refreshRecurringForUser(USER, TODAY);
    // Still excluded — no phantom income re-projected…
    expect(await scheduledFor(INCOME_CANON)).toBe(0);
    // …and the consent row survives (only fresh evidence retires it).
    expect(await getConfirmedIncomePauses(USER)).toEqual(new Set([INCOME_CANON]));
  });

  it('3. a RESUMED series projects again and the stale confirmation is deleted', async () => {
    // A fresh deposit lands: lastSeenAt 2026-06-08 → missedSince 2026-07-08 (future) — not lapsed.
    await prisma.transaction.create({
      data: {
        accountId: checkingId,
        date: isoDate('2026-06-08'),
        amountCents: 38000,
        rawDescriptor: INCOME_DESC,
        categoryId: null,
        status: 'POSTED',
      },
    });
    await refreshRecurringForUser(USER, TODAY);
    // Projection restored…
    expect(await scheduledFor(INCOME_CANON)).toBe(1);
    // …and the confirmation row was deleted (positive resumption evidence), so a
    // FUTURE pause of this income will re-ask instead of silently re-applying.
    expect(await getConfirmedIncomePauses(USER)).toEqual(new Set());
    expect(
      await prisma.incomePauseConfirmation.count({ where: { userId: USER } }),
    ).toBe(0);
  });

  it('4. undo deletes a confirmation; confirming again after undo works', async () => {
    expect(await confirmIncomePause(USER, INCOME_CANON)).toBe(true);
    expect(await undoIncomePause(USER, INCOME_CANON)).toBe(true);
    expect(await getConfirmedIncomePauses(USER)).toEqual(new Set());
    expect(await undoIncomePause(USER, INCOME_CANON)).toBe(false); // nothing left to undo
  });

  it('5. demo fence: the shared demo account can never write or read a confirmation', async () => {
    expect(await confirmIncomePause(DEMO_USER_ID, INCOME_CANON)).toBe(false);
    expect(await undoIncomePause(DEMO_USER_ID, INCOME_CANON)).toBe(false);
    expect(await prisma.incomePauseConfirmation.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
    // Read fence: empty set by construction, before any query.
    expect(await getConfirmedIncomePauses(DEMO_USER_ID)).toEqual(new Set());
  });
});
