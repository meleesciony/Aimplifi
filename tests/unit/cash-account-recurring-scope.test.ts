/**
 * L.25 — a bill paid from ANY cash account reaches the money.
 *
 * `toScheduledTransactions` filtered detected series to the single resolved
 * PAYMENT account, so a bill autopaid from a second checking or from savings was
 * projected nowhere: a monthly rate on /recurring and $0 in the spending plan's
 * fixed term. Same direction as the L.23/L.24 gaps — an uncounted bill overstates
 * guilt-free spending by its whole monthly share.
 *
 * NOT a diagnosis of the owner's live "Fixed & recurring expenses $0.00" against
 * $21,117.48 of income (2026-07-26). That remains UNVERIFIED — no live DB is
 * reachable from here. Account scope is one candidate and, per the L.25 claims
 * critic, not the likeliest: reaching $0.00 by scope alone needs EVERY bill to sit
 * off the payment account, whereas the amount-stability rule (`detect.ts` drops any
 * series with 3+ distinct amounts) silently excludes every variable utility bill,
 * which is the ordinary shape of a household's bills. Recorded in docs/STATUS.md.
 *
 * The narrowing was also in the WRONG PLACE. The three consumers that walk ONE
 * account's running balance re-filter to the payment account at their own read
 * site — cash-needed's `assemble.ts:195`, `forecast.ts:51`, `radar.ts:88/105/131` —
 * so filtering at the writer protected nothing they did not already protect, and
 * starved the two consumers that legitimately span accounts: the plan's fixed term
 * and the calendar. These tests hold both halves: the widened writer, and the
 * re-filters that make widening safe (mutation-tested, see docs/STATUS.md §L.25).
 *
 * CREDIT stays excluded on purpose: a subscription charged to a card is already
 * inside the plan's card-obligation term, so projecting it here would double-count
 * it and paint it twice on the calendar.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { holidayTable, isoDate } from '@/lib/dates';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import {
  detectRecurring,
  toScheduledTransactions,
  type RecurringSeriesResult,
  type RecurringTxn,
} from '@/lib/engine/recurring/detect';
import { assembleCashNeededInput } from '@/lib/engine/cash-needed/assemble';
import { refreshRecurringForUser } from '@/server/recurring';
import { getSpendingPlan } from '@/server/spending-plan';
import { prisma } from '@/lib/db';

const TODAY = '2026-06-10';
const GYM_DESC = 'CITY GYM MEMBERSHIP';

/** Three monthly charges on one account — the shape `cadenceFromGaps` reads MONTHLY. */
function monthlyTxns(descriptor: string, accountId: string, amountCents: number): RecurringTxn[] {
  return ['2026-03-10', '2026-04-10', '2026-05-10'].map((date, i) => ({
    id: `${descriptor}-${i}`,
    accountId,
    date,
    amountCents,
    rawDescriptor: descriptor,
  }));
}

describe('toScheduledTransactions — the account SET, not one account (L.25)', () => {
  const savingsSeries = () => {
    const [s] = detectRecurring(monthlyTxns(GYM_DESC, 'acct-savings', -4500), isoDate(TODAY));
    expect(s?.cadence).toBe('MONTHLY');
    expect(s?.accountId).toBe('acct-savings');
    return s!;
  };

  it('projects a bill whose charges land on a SECOND cash account', () => {
    const rows = toScheduledTransactions(
      [savingsSeries()],
      { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking', 'acct-savings']) },
      isoDate(TODAY),
    );
    // FAIL-OLD: the filter was `s.accountId === paymentAccountId` with the ONE
    // resolved payment account (checking), so this array was empty and the bill
    // reached no surface that projects money.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: 'acct-savings', amountCents: -4500, cadence: 'MONTHLY' });
  });

  it('still drops it when that account is NOT among the cash accounts', () => {
    // The old behaviour, stated as the boundary rather than as the rule: membership
    // is what decides, so a set of one still behaves exactly as the old filter did.
    expect(toScheduledTransactions([savingsSeries()], { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking']) }, isoDate(TODAY))).toEqual([]);
  });

  it('does NOT project a series charged to a CREDIT card — that is the obligation term', () => {
    const [card] = detectRecurring(monthlyTxns(GYM_DESC, 'acct-card', -4500), isoDate(TODAY));
    expect(card?.accountId).toBe('acct-card');
    // The cash set is CHECKING/SAVINGS only. Were the card admitted, this $45 would
    // be subtracted twice: once as its own fixed-expense row and once inside the
    // card's statement obligation, and the calendar would paint it twice.
    expect(
      toScheduledTransactions([card!], { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking', 'acct-savings']) }, isoDate(TODAY)),
    ).toEqual([]);
  });

  it('does NOT widen INCOME to a second cash account — that scope is unchanged', () => {
    // The asymmetry, and the first L.25 draft got it wrong (claims critic P1-1): the
    // W/B/M branch carries no isIncome test, so widening the account filter admitted
    // detected recurring INCOME on savings too. An expense anywhere is money that
    // leaves; income landing in savings does NOT fund a card payment that must leave
    // checking, and counting it would shrink the L.11(D) reservation — the
    // figure-vs-instruction error L.14 records, in the guilt-free-RAISING direction.
    const [income] = detectRecurring(monthlyTxns('STRIPE PAYOUT ETSY SHOP', 'acct-savings', 38000), isoDate(TODAY));
    expect(income?.isIncome).toBe(true);
    expect(income?.cadence).toBe('MONTHLY');
    expect(
      toScheduledTransactions(
        [income!],
        { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking', 'acct-savings']) },
        isoDate(TODAY),
      ),
    ).toEqual([]);
  });

  it('still projects detected income ON the payment account, exactly as before', () => {
    // The other direction of the same rule — the asymmetry must not become a silent
    // ban on detected payroll, which is what feeds `payroll-detected` rows.
    const [income] = detectRecurring(monthlyTxns('ACME PAYROLL', 'acct-checking', 38000), isoDate(TODAY));
    const rows = toScheduledTransactions(
      [income!],
      { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking', 'acct-savings']) },
      isoDate(TODAY),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: 'acct-checking', amountCents: 38000, source: 'payroll-detected' });
  });

  it('does NOT widen an AUTO-LOAN ACH to a second cash account — the loan already paints it', () => {
    // L.25 money critic P1-2, executed: `detectRecurring` deliberately KEEPS one
    // isTransfer class (auto-loan), and the linked LOAN account paints the same
    // payment as an obligation. That double count is the accepted #134 residual,
    // disclosed on the radar for the payment account only — so widening it would
    // put the same $385.00 on /calendar twice on one day, undisclosed.
    const ach = (accountId: string): RecurringTxn[] =>
      ['2026-03-05', '2026-04-05', '2026-05-05'].map((date, i) => ({
        id: `loan-${i}`, accountId, date, amountCents: -38500,
        rawDescriptor: 'ACH WITHDRAWAL CARMAX AUTO FIN', isTransfer: true,
      }));

    const [onJoint] = detectRecurring(ach('acct-joint'), isoDate(TODAY));
    expect(onJoint?.categoryId).toBe('auto-loan');
    expect(
      toScheduledTransactions(
        [onJoint!],
        { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking', 'acct-joint']) },
        isoDate(TODAY),
      ),
    ).toEqual([]);

    // …but on the PAYMENT account it still projects exactly as it always has.
    // #134 is an accepted residual; this slice must not silently close it either.
    const [onPayment] = detectRecurring(ach('acct-checking'), isoDate(TODAY));
    expect(
      toScheduledTransactions(
        [onPayment!],
        { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking', 'acct-joint']) },
        isoDate(TODAY),
      ),
    ).toHaveLength(1);
  });

  it('an empty cash set projects nothing rather than throwing', () => {
    // A user whose only accounts are credit cards. The caller short-circuits, but the
    // engine must not depend on that to be safe.
    expect(toScheduledTransactions([savingsSeries()], { paymentAccountId: null, cashAccountIds: new Set<string>() }, isoDate(TODAY))).toEqual([]);
  });
});

describe('the single-account balance walks re-filter, which is what makes widening safe (L.25)', () => {
  const seriesShape = {
    merchantCanonical: 'City Gym',
    categoryId: 'fitness',
    cadence: 'MONTHLY',
    typicalAmountCents: -4500,
    lastAmountCents: -4500,
    previousAmountCents: null,
    priceChangedAt: null,
    lastSeenAt: isoDate('2026-05-10'),
    nextExpectedAt: isoDate('2026-06-10'),
    occurrences: 3,
    isSubscription: true,
    isIncome: false,
    possiblyUnused: true,
    accountId: 'acct-savings',
  } satisfies RecurringSeriesResult;

  it('cash-needed assembles only the PAYMENT account rows, so a savings bill never hits the checking walk', () => {
    const scheduled = toScheduledTransactions(
      [seriesShape, { ...seriesShape, accountId: 'acct-checking', typicalAmountCents: -1000 }],
      { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking', 'acct-savings']) },
      isoDate(TODAY),
    );
    // The writer now emits BOTH rows — that is the L.25 change.
    expect(scheduled).toHaveLength(2);

    const input = assembleCashNeededInput({
      today: isoDate(TODAY),
      scenario: 'PAY_IN_FULL',
      paymentAccountId: 'acct-checking',
      accounts: [
        {
          id: 'acct-checking', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500000,
          aprBps: null, dueDayOfMonth: null, cycleCloseDayOfMonth: null,
        },
        {
          id: 'acct-savings', name: 'Savings', type: 'SAVINGS', currentBalanceCents: 900000,
          aprBps: null, dueDayOfMonth: null, cycleCloseDayOfMonth: null,
        },
      ],
      autopays: [],
      statements: [],
      cardPayments: [],
      transactions: [],
      scheduled: scheduled.map((r) => ({
        accountId: r.accountId,
        description: r.description,
        amountCents: r.amountCents,
        nextDate: r.nextDate,
        cadence: r.cadence,
      })),
      holidayTable: holidayTable(2026, 2027),
    });

    // MUTATION-TESTED: deleting `assemble.ts:195`'s account filter makes this fail.
    // The savings bill must not be subtracted from the checking balance the walk
    // projects — the money leaves a different account.
    expect(input.scheduled.every((s) => s.amountCents === -1000)).toBe(true);
    expect(input.scheduled.some((s) => s.amountCents === -4500)).toBe(false);
  });
});

describe('the real server path: a bill autopaid from SAVINGS reaches the plan (L.25)', () => {
  const uid = `cashscope-${Date.now()}-${process.pid}`;
  let checkingId = '';
  let savingsId = '';

  const wipe = async () => {
    await prisma.account.deleteMany({ where: { userId: uid } });
    await prisma.recurringSeries.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { id: uid } });
  };

  beforeAll(async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    await wipe();
    await prisma.user.create({ data: { id: uid, email: `${uid}@test.local` } });
    const chk = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-chk`,
        name: 'Everyday Checking',
        type: 'CHECKING',
        currentBalanceCents: 800000,
        currency: 'USD',
      },
    });
    checkingId = chk.id;
    const sav = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-sav`,
        name: 'Household Savings',
        type: 'SAVINGS',
        currentBalanceCents: 1200000,
        currency: 'USD',
      },
    });
    savingsId = sav.id;
    // The payment account is CHECKING — the bill below leaves SAVINGS, which is
    // exactly the shape that was worth $0.
    await prisma.user.update({ where: { id: uid }, data: { paymentAccountId: checkingId } });

    const canonical = normalizeMerchant(GYM_DESC).canonical;
    const merchant = await prisma.merchant.upsert({
      where: { canonical },
      create: { canonical, defaultCategoryId: null },
      update: {},
    });
    for (const date of ['2026-03-10', '2026-04-10', '2026-05-10']) {
      await prisma.transaction.create({
        data: {
          accountId: savingsId,
          date,
          amountCents: -4500,
          rawDescriptor: GYM_DESC,
          merchantId: merchant.id,
          categoryId: null,
          status: 'POSTED',
        },
      });
    }
    await refreshRecurringForUser(uid, isoDate(TODAY));
  });

  afterAll(async () => {
    await wipe();
    vi.unstubAllEnvs();
  });

  it('persists the savings bill as a scheduled row on the savings account', async () => {
    const rows = await prisma.scheduledTransaction.findMany({
      where: { account: { userId: uid } },
      select: { accountId: true, amountCents: true, cadence: true, source: true },
    });
    // FAIL-OLD: no row was written at all — the series' account was not the
    // payment account, so the writer dropped it.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: savingsId, amountCents: -4500, cadence: 'MONTHLY', source: 'recurring' });
  });

  it("counts it in the plan's fixed-expense term — $45.00 that used to be $0.00", async () => {
    const plan = await getSpendingPlan(uid);
    // FAIL-OLD: 0. This is the owner-reported symptom in miniature.
    expect(plan.fixedExpensesCents).toBe(4500);
    // And it is a real subtraction, not a display.
    expect(plan.leftToSpendCents).toBe(
      plan.patternIncomeCents -
        (4500 + plan.cardObligationsCents + plan.obligationsBeyondMonthCents + plan.plannedSavingsCents),
    );
  });
});

describe('a SUPERSEDED cash account does not resurrect its bills (L.25)', () => {
  const uid = `cashscope-sup-${Date.now()}-${process.pid}`;

  const wipe = async () => {
    await prisma.accountReconciliation.deleteMany({ where: { userId: uid } });
    await prisma.account.deleteMany({ where: { userId: uid } });
    await prisma.recurringSeries.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { id: uid } });
  };

  beforeAll(async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    await wipe();
    await prisma.user.create({ data: { id: uid, email: `${uid}@test.local` } });
  });

  afterAll(async () => {
    await wipe();
    vi.unstubAllEnvs();
  });

  it('drops a bill whose charges are on a reconciled-away predecessor', async () => {
    const oldChk = await prisma.account.create({
      data: {
        userId: uid, provider: 'manual', providerRef: `${uid}-old`, name: 'Old Checking',
        type: 'CHECKING', currentBalanceCents: 0, currency: 'USD',
      },
    });
    const newChk = await prisma.account.create({
      data: {
        userId: uid, provider: 'manual', providerRef: `${uid}-new`, name: 'New Checking',
        type: 'CHECKING', currentBalanceCents: 500000, currency: 'USD',
      },
    });
    await prisma.user.update({ where: { id: uid }, data: { paymentAccountId: newChk.id } });

    const canonical = normalizeMerchant(GYM_DESC).canonical;
    const merchant = await prisma.merchant.upsert({
      where: { canonical },
      create: { canonical, defaultCategoryId: null },
      update: {},
    });
    for (const date of ['2026-03-10', '2026-04-10', '2026-05-10']) {
      await prisma.transaction.create({
        data: {
          accountId: oldChk.id, date, amountCents: -4500, rawDescriptor: GYM_DESC,
          merchantId: merchant.id, categoryId: null, status: 'POSTED',
        },
      });
    }
    // The old account is superseded by the new one, cutover AFTER the charges so the
    // rows themselves survive the reconciliation keep — the account is what is dead.
    await prisma.accountReconciliation.create({
      data: {
        userId: uid,
        predecessorAccountId: oldChk.id,
        successorAccountId: newChk.id,
        cutoverDate: '2026-06-01',
        matchSignal: 'mask',
        confidence: 'high',
      },
    });

    await refreshRecurringForUser(uid, isoDate(TODAY));
    const rows = await prisma.scheduledTransaction.findMany({ where: { account: { userId: uid } } });
    // Widening to "every CHECKING/SAVINGS" would otherwise have started projecting a
    // dead account's bills. WEEKLY/BIWEEKLY/MONTHLY rows carry no lapse gate, so
    // nothing downstream would have caught it.
    expect(rows).toEqual([]);
  });
});
