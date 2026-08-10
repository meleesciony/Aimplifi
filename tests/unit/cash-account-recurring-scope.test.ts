/**
 * L.25 — a bill paid from ANY cash account reaches the money.
 *
 * `toScheduledTransactions` filtered detected series to the single resolved
 * PAYMENT account, so a bill autopaid from a second checking or from savings was
 * projected nowhere: a monthly rate on /recurring and $0 in the spending plan's
 * fixed term. Same direction as the L.23/L.24 gaps — an uncounted bill overstates
 * guilt-free spending by its whole monthly share.
 *
 * THE OWNER'S $0.00 IS NOW DIAGNOSED, and it was neither of the two candidates this
 * header used to name. Read-only replay of this pipeline against production
 * (2026-07-26) returned 21 detected series and 0 scheduled rows: 12 sat on CREDIT
 * cards (excluded by design — they belong to the card-obligation term), and every
 * remaining one, income included, resolved to a SUPERSEDED predecessor after the
 * checking account was re-linked on 2026-07-21. Fixed in L.26 (see the re-key block
 * at the foot of this file); the amount-stability rule this header guessed at is a
 * real narrowing but was not the cause. Recorded in docs/STATUS.md.
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
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
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
    const [s] = detectRecurring(monthlyTxns(GYM_DESC, 'acct-savings', -4500), isoDate(TODAY), NO_RECURRING_OVERRIDES);
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
    const [card] = detectRecurring(monthlyTxns(GYM_DESC, 'acct-card', -4500), isoDate(TODAY), NO_RECURRING_OVERRIDES);
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
    const [income] = detectRecurring(monthlyTxns('STRIPE PAYOUT ETSY SHOP', 'acct-savings', 38000), isoDate(TODAY), NO_RECURRING_OVERRIDES);
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
    const [income] = detectRecurring(monthlyTxns('ACME PAYROLL', 'acct-checking', 38000), isoDate(TODAY), NO_RECURRING_OVERRIDES);
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

    const [onJoint] = detectRecurring(ach('acct-joint'), isoDate(TODAY), NO_RECURRING_OVERRIDES);
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
    const [onPayment] = detectRecurring(ach('acct-checking'), isoDate(TODAY), NO_RECURRING_OVERRIDES);
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
    occurrenceRows: [], // evidence rows are out of scope here — the account walk is what is under test
    isSubscription: true,
    isIncome: false,
    possiblyUnused: true,
    accountId: 'acct-savings',
    declaredByUser: false,
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
      plan.patternIncomeCents - (4500 + plan.plannedSavingsCents),
    );
  });
});

describe('a bill on a RE-LINKED cash account is re-keyed, not dropped (L.26)', () => {
  /**
   * This block asserted the OPPOSITE until L.26, on a claim that measurement
   * disproved: "a reconciled-away account's series is a dead bill." It is not. A
   * reconciliation is the same real-world account reconnected — the bills did not
   * stop, they moved to the new connection's id. Because a series' account is the
   * account of its most recent KEPT charge, and the keep rule bounds a predecessor
   * at its cutover, EVERY bill last charged before the cutover carried the dead id
   * and was projected nowhere.
   *
   * Measured on the owner's production data (2026-07-26, read-only replay of this
   * exact pipeline): 21 series detected, 0 scheduled rows written. Their Schwab
   * checking had been re-linked on 2026-07-21, so a $176.79 student loan, a $146.40
   * insurance premium and a $166.67 biweekly retirement contribution — plus five
   * detected income series — all resolved to the superseded id. The dashboard read
   * "Fixed & recurring expenses — $0.00" under $21,117.48 of income, the exact
   * uncounted-bill direction (guilt-free OVERSTATED) that L.23/L.24/L.25 each closed
   * one other way into.
   *
   * The old risk this block guarded — projecting a genuinely stopped bill — survives
   * only in the SAFE direction (a bill counted that no longer charges understates
   * guilt-free), and it is the same risk every series carries between occurrences.
   */
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

  it('re-keys a bill whose charges are on a reconciled-away predecessor onto the live account', async () => {
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
    // rows themselves survive the reconciliation keep — this is the owner's shape:
    // a live bill whose last kept charge sits on the replaced connection.
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
    const rows = await prisma.scheduledTransaction.findMany({
      where: { account: { userId: uid } },
      select: { accountId: true, amountCents: true, cadence: true, source: true },
    });
    // FAIL-OLD: []. The bill charged, the user could not see it, and $45.00 a month
    // of it was inside "guilt-free to spend".
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId: newChk.id, // the LIVE account, never the boundary-zeroed ghost
      amountCents: -4500,
      cadence: 'MONTHLY',
      source: 'recurring',
    });

    // …and it reaches the money, which is the whole point of the row existing.
    const plan = await getSpendingPlan(uid);
    expect(plan.fixedExpensesCents).toBe(4500);
  });

  it('does not re-key across account TYPES — a card predecessor stays out of the cash set', async () => {
    // The re-key rides `effectiveReconciliationLinks`, which refuses cross-type
    // pairs, so a CREDIT predecessor can only ever map to a CREDIT successor and is
    // still excluded from `cashAccountIds`. Without that, a subscription charged to
    // a re-linked card would be subtracted twice — once here, once inside the card's
    // statement obligation — and painted twice on the calendar.
    const oldCard = await prisma.account.create({
      data: {
        userId: uid, provider: 'manual', providerRef: `${uid}-oldcard`, name: 'Old Card',
        type: 'CREDIT', currentBalanceCents: 0, currency: 'USD',
      },
    });
    const newCard = await prisma.account.create({
      data: {
        userId: uid, provider: 'manual', providerRef: `${uid}-newcard`, name: 'New Card',
        type: 'CREDIT', currentBalanceCents: 120000, currency: 'USD',
      },
    });
    const desc = 'STREAMFLIX SUBSCRIPTION';
    const canonical = normalizeMerchant(desc).canonical;
    const merchant = await prisma.merchant.upsert({
      where: { canonical },
      create: { canonical, defaultCategoryId: null },
      update: {},
    });
    for (const date of ['2026-03-12', '2026-04-12', '2026-05-12']) {
      await prisma.transaction.create({
        data: {
          accountId: oldCard.id, date, amountCents: -1599, rawDescriptor: desc,
          merchantId: merchant.id, categoryId: null, status: 'POSTED',
        },
      });
    }
    await prisma.accountReconciliation.create({
      data: {
        userId: uid,
        predecessorAccountId: oldCard.id,
        successorAccountId: newCard.id,
        cutoverDate: '2026-06-01',
        matchSignal: 'mask',
        confidence: 'high',
      },
    });

    await refreshRecurringForUser(uid, isoDate(TODAY));
    const rows = await prisma.scheduledTransaction.findMany({
      where: { account: { userId: uid } },
      select: { accountId: true, amountCents: true },
    });
    // Only the checking bill from the previous test survives; the card's does not.
    expect(rows.some((r) => r.amountCents === -1599)).toBe(false);
    expect(rows).toHaveLength(1);
  });
});
