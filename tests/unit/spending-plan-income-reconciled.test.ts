/**
 * The income pattern must survive a RE-LINKED payment account.
 *
 * Owner-reported 2026-08-02 ("the monthly income is wrong") and measured on his
 * production data the same day (scripts/audit-probes/income-replay.mts): a Schwab
 * checking re-linked through Plaid on 2026-07-21 became a reconciliation
 * PREDECESSOR of the new Plaid row, which is his payment account.
 *
 * `applyReconciliationBoundary` decides which side OWNS a date; it does NOT re-key
 * transactions, so every pre-cutover paycheck keeps the predecessor's accountId.
 * The income scope is built from the live payment-account id, so all of that
 * history fell outside it: the "median of up to 3 complete months" became a median
 * of ONE partial month — $10,681.30 against a real median of $30,937.91.
 *
 * The failure is silent and structural, which is why nothing caught it: both figures
 * are real money that really landed in his account, and the wrong one is a perfectly
 * plausible paycheck. The two sibling paths in the same file already remap — the
 * boundary re-keys `snap.scheduled` itself (F6, "so the successor's payment-account
 * filter finds them") and `countedExpenseSeriesForPlan` remaps detected series — so
 * this locks the third, and asserts the SHAPE (three months, both sides counted once)
 * rather than only the total, because a total can be right for the wrong reason.
 *
 * Driven through the REAL server path against a throwaway user: a pure-builder test
 * cannot catch a wiring bug (the L.15 lesson).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSpendingPlan } from '@/server/spending-plan';
import { prisma } from '@/lib/db';

const TODAY = '2026-08-02'; // the day it was reported; 2026-08 is the incomplete month
const CUTOVER = '2026-07-21';

describe('getSpendingPlan — income across a reconciled payment account', () => {
  const uid = `inc-recon-${Date.now()}-${process.pid}`;
  let oldCheckingId = ''; // predecessor (the retired SimpleFIN feed)
  let newCheckingId = ''; // successor  (the live Plaid feed, and the payment account)

  const wipe = async () => {
    await prisma.accountReconciliation.deleteMany({ where: { userId: uid } });
    await prisma.account.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { id: uid } });
  };

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: uid, email: `${uid}@test.local` } });

    const oldChecking = await prisma.account.create({
      data: {
        userId: uid, provider: 'simplefin', providerRef: `${uid}-old`,
        name: 'Investor Checking (old feed)', type: 'CHECKING',
        currentBalanceCents: 1277383, currency: 'USD',
      },
    });
    oldCheckingId = oldChecking.id;

    const newChecking = await prisma.account.create({
      data: {
        userId: uid, provider: 'plaid', providerRef: `${uid}-new`,
        name: 'Investor Checking', type: 'CHECKING', mask: '3927',
        currentBalanceCents: 1804846, currency: 'USD',
      },
    });
    newCheckingId = newChecking.id;
    // The payment account is the LIVE side — exactly the owner's shape.
    await prisma.user.update({ where: { id: uid }, data: { paymentAccountId: newCheckingId } });

    // Two complete months land wholly on the PREDECESSOR (pre-cutover), and the
    // third straddles: the old feed carries 07-10, the new one carries 07-24.
    // Same real account, one payroll, no month double-counted.
    await prisma.transaction.createMany({
      data: [
        { accountId: oldCheckingId, date: '2026-05-08', amountCents: 1000000, rawDescriptor: 'FINAN DERMATOPAT PAYROLL', categoryId: 'paycheck', confidenceBps: 9900, needsReview: false },
        { accountId: oldCheckingId, date: '2026-06-08', amountCents: 1000000, rawDescriptor: 'FINAN DERMATOPAT PAYROLL', categoryId: 'paycheck', confidenceBps: 9900, needsReview: false },
        { accountId: oldCheckingId, date: '2026-07-10', amountCents: 1000000, rawDescriptor: 'FINAN DERMATOPAT PAYROLL', categoryId: 'paycheck', confidenceBps: 9900, needsReview: false },
        { accountId: newCheckingId, date: '2026-07-24', amountCents: 400000, rawDescriptor: 'FINAN DERMATOPAT PAYROLL', categoryId: 'paycheck', confidenceBps: 9900, needsReview: false },
      ],
    });

    await prisma.accountReconciliation.create({
      data: {
        userId: uid,
        predecessorAccountId: oldCheckingId,
        successorAccountId: newCheckingId,
        cutoverDate: CUTOVER,
        matchSignal: 'mask',
        confidence: 'high',
      },
    });
  });

  afterAll(async () => {
    await wipe();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv('DEMO_TODAY', TODAY);
  });

  it('counts the predecessor months — the re-link does not delete the income history', async () => {
    const plan = await getSpendingPlan(uid);

    // THE LOCK. On the pre-fix code this is [400000]: only the post-cutover row is
    // in scope, so `incomeMonths` is 1 and the median is the successor's part-month.
    expect(plan.trailingMonthlyIncomeCents).toEqual([1000000, 1000000, 1400000]);
    expect(plan.incomeMonths).toBe(3);
    expect(plan.incomeBasis).toBe('trailing-median');
    expect(plan.patternIncomeCents).toBe(1000000);
  });

  it('July counts BOTH sides exactly once — the boundary owns the overlap, not the scope', async () => {
    const plan = await getSpendingPlan(uid);

    // $10,000 (old feed, 07-10) + $4,000 (new feed, 07-24) = $14,000. If the remap
    // double-counted, or if the boundary let both feeds claim the same date, this
    // month is the one that moves.
    const july = plan.trailingMonthlyIncomeCents[2];
    expect(july).toBe(1400000);
  });

  it('the successor alone is NOT the answer — the mutation this test exists to kill', async () => {
    const plan = await getSpendingPlan(uid);

    // Reverting the fix makes the pattern the successor's lone part-month. Naming
    // the wrong value explicitly means a regression cannot pass by moving a number.
    expect(plan.patternIncomeCents).not.toBe(400000);
    expect(plan.incomeMonths).not.toBe(1);
  });
});
