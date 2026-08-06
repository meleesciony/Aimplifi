/**
 * H.7 — the transfer sweep reads what the reconciliation boundary OWNS.
 *
 * `refreshTransferFlags` was the only transaction read surface in the app that
 * skipped `getReconciliationTxnKeep` (the R1 ownership rule the register, CSV
 * export, budgets, recurring detection and triage all apply). With a reconciled
 * pair — the same real account arriving from two providers — it therefore saw
 * BOTH copies of every row, and could match a row against a row on its own
 * duplicate: exactly the same-account case the pair rule already refuses.
 *
 * Measured live on the owner's corpus before the fix
 * (scripts/audit-probes/h7-boundary-effect.mts): 1,215 of 3,065 rows were not
 * the boundary's to read, and 45 of the 73 settled rows the sweep had silently
 * overturned were duplicate-account artifacts.
 *
 * THE FIXTURE IS THE LIVE CASE, and it is chosen to isolate the boundary: a
 * $500.00 Zelle payment to a landscaper and an unrelated $500.00 fund
 * distribution two days later, on ONE real checking account that exists as two
 * rows. Its sending leg is a checking account, so the direction gate passes it
 * — only the boundary can stop this one, which is what makes the premise lock
 * below meaningful rather than vacuous. (The eBay purchase/refund case measured
 * alongside it is caught by BOTH guards, so it could not isolate either.)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { refreshTransferFlags } from '@/lib/providers/transfer-refresh';

describe('H.7: the transfer sweep applies the reconciliation boundary', () => {
  const USER = `h7b-${Date.now()}-${process.pid}`;
  let OLD_CHK = '';
  let NEW_CHK = '';
  let CARD = '';

  async function wipe() {
    await prisma.accountReconciliation.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);

  beforeEach(async () => {
    await prisma.accountReconciliation.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    const mk = async (ref: string, name: string, type: string, balance: number) =>
      (
        await prisma.account.create({
          data: {
            userId: USER,
            provider: 'simplefin',
            providerRef: ref,
            name,
            type,
            currentBalanceCents: balance,
            currency: 'USD',
          },
        })
      ).id;
    OLD_CHK = await mk('h7-old', 'Investor Checking (SimpleFIN)', 'CHECKING', 500_000);
    NEW_CHK = await mk('h7-new', 'Investor Checking (Plaid)', 'CHECKING', 500_000);
    CARD = await mk('h7-card', 'Sapphire', 'CREDIT', -12_345);
  });

  /** The user-confirmed link: one real checking account, two rows. */
  async function link(cutoverDate = '2026-06-30') {
    await prisma.accountReconciliation.create({
      data: {
        userId: USER,
        predecessorAccountId: OLD_CHK,
        successorAccountId: NEW_CHK,
        cutoverDate,
        matchSignal: 'mask',
        confidence: 'high',
      },
    });
  }

  /**
   * Two unrelated settled rows — a landscaping payment out, a fund distribution
   * in — as BOTH feeds report them. Same |amount|, two days apart. Nothing here
   * is a transfer; the only thing they have in common is $500.00.
   */
  async function zelleAndDistributionOnBothCopies() {
    await prisma.transaction.createMany({
      data: [
        // The predecessor's own pre-cutover history. Without it the stored
        // cutover would predate its FIRST row, which the boundary treats as a
        // DEGENERATE claim and answers by keeping everything (A-F8: never erase
        // a whole history that has no successor copies). A real reconciled pair
        // always spans its cutover, and the sweep must be tested against the
        // rule as it actually behaves, not a shape confirm cannot produce.
        {
          id: `${USER}-anchor`,
          accountId: OLD_CHK,
          date: '2026-05-15',
          amountCents: -2_500,
          rawDescriptor: 'SQ *BLUE BOTTLE',
          categoryId: 'dining',
          confidenceBps: 9000,
          needsReview: false,
        },
      ].concat(
        [OLD_CHK, NEW_CHK].flatMap((accountId, i) => [
        {
          id: `${USER}-zelle${i}`,
          accountId,
          date: '2026-07-01',
          amountCents: -50_000,
          rawDescriptor: 'ZELLE TO GREEN LANDSCAPING',
          categoryId: 'lawn-garden',
          confidenceBps: 9000,
          needsReview: false,
        },
        {
          id: `${USER}-cef${i}`,
          accountId,
          date: '2026-07-03',
          amountCents: 50_000,
          rawDescriptor: '5006-DB/CR-CEF I CEF IV PPD',
          categoryId: 'income',
          confidenceBps: 9900,
          needsReview: false,
        },
        ]),
      ),
    });
  }

  it('a payment does not pair with a deposit on its own reconciled duplicate', async () => {
    await link();
    await zelleAndDistributionOnBothCopies();

    const res = await refreshTransferFlags(USER);
    expect(res).toEqual({ flagged: 0, filed: 0 });

    const rows = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(rows).toHaveLength(5);
    for (const t of rows) {
      expect(t.isTransfer, `${t.id} must keep counting`).toBe(false);
    }
    // Named directly, because these are the two figures the defect moved: real
    // spending stayed spending, and real income stayed income.
    const spend = rows.filter((t) => t.categoryId === 'lawn-garden');
    const income = rows.filter((t) => t.categoryId === 'income');
    expect(spend.every((t) => !t.isTransfer)).toBe(true);
    expect(income.every((t) => !t.isTransfer)).toBe(true);
  });

  it('premise lock: WITHOUT the link those same four rows DO pair — the boundary is what stops it', async () => {
    // No reconciliation row => the keep rule is constant-true (R8), so the two
    // copies are four rows on two different accounts and the cross-copy match is
    // a pair whose sending leg is a checking account. Without this assertion the
    // test above could pass because nothing pairs at all.
    await zelleAndDistributionOnBothCopies();
    expect((await refreshTransferFlags(USER)).flagged).toBe(4);
  });

  it('narrows the read WITHOUT blinding it: a pre-cutover pair still flags and files', async () => {
    await link();
    // Dated before the cutover, so the PREDECESSOR still owns this row — a real
    // card payment from checking, which must still be detected and filed.
    await prisma.transaction.createMany({
      data: [
        {
          id: `${USER}-pay`,
          accountId: OLD_CHK,
          date: '2026-06-10',
          amountCents: -12_345,
          rawDescriptor: 'CREDIT CARD PAID',
          categoryId: 'uncategorized',
          confidenceBps: 5000,
          needsReview: true,
        },
        {
          id: `${USER}-got`,
          accountId: CARD,
          date: '2026-06-11',
          amountCents: 12_345,
          rawDescriptor: 'PAYMENT RECEIVED - THANK YOU',
          categoryId: 'uncategorized',
          confidenceBps: 5000,
          needsReview: true,
        },
      ],
    });
    expect(await refreshTransferFlags(USER)).toEqual({ flagged: 2, filed: 2 });
  });

  it('an UNDONE link is inert: the rows pair again, exactly as with no link at all (R9)', async () => {
    await link();
    await prisma.accountReconciliation.updateMany({
      where: { userId: USER },
      data: { undoneAt: new Date() },
    });
    await zelleAndDistributionOnBothCopies();
    expect((await refreshTransferFlags(USER)).flagged).toBe(4);
  });

  it('the flag write re-asserts its premise: a row settled inside the read->write window is skipped', async () => {
    await prisma.transaction.createMany({
      data: [
        {
          id: `${USER}-race-out`,
          accountId: NEW_CHK,
          date: '2026-06-10',
          amountCents: -12_345,
          rawDescriptor: 'CREDIT CARD PAID',
          categoryId: 'uncategorized',
          confidenceBps: 5000,
          needsReview: true,
        },
        {
          id: `${USER}-race-in`,
          accountId: CARD,
          date: '2026-06-11',
          amountCents: 12_345,
          rawDescriptor: 'PAYMENT RECEIVED - THANK YOU',
          categoryId: 'uncategorized',
          confidenceBps: 5000,
          needsReview: true,
        },
      ],
    });

    // Execute the window rather than reason about it: the user files the
    // outflow as real dining at the moment the first write goes out.
    const real = prisma.transaction.updateMany.bind(prisma.transaction);
    type UpdateManyArgs = Parameters<typeof real>[0];
    // `updateMany` is generic and returns a PrismaPromise, which an async
    // implementation cannot structurally satisfy; the cast is the repo's
    // existing test idiom for spying on a Prisma method, and the delegation
    // below keeps the real behaviour intact.
    const spy = vi.spyOn(prisma.transaction, 'updateMany').mockImplementationOnce((async (
      args: UpdateManyArgs,
    ) => {
      await real({
        where: { id: `${USER}-race-out` },
        data: { categoryId: 'dining', needsReview: false, confidenceBps: 10_000 },
      });
      return real(args);
    }) as unknown as typeof prisma.transaction.updateMany);
    try {
      await refreshTransferFlags(USER);
    } finally {
      spy.mockRestore();
    }

    const out = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-race-out` } });
    expect(out.categoryId).toBe('dining');
    expect(out.isTransfer, 'a just-filed row must not be reversed by a stale plan').toBe(false);
  });
});
