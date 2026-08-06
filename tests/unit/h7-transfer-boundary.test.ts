/**
 * H.7 — two rows on the SAME REAL ACCOUNT never pair, and the sweep still SEES
 * every row while enforcing that.
 *
 * A reconciled pair — the same real account arriving from two providers — makes
 * a purchase and its own refund look like two accounts, which defeats the
 * same-account exclusion the pair rule already declares and manufactures a
 * transfer out of two copies of one row. Measured live on the owner's corpus
 * (26 active links): 45 of the 73 settled rows the sweep had silently overturned
 * were this artifact — an eBay purchase and its refund at $429.90 on one card,
 * an Uber One charge and its Amex statement credit, a $500 Zelle payment matched
 * to an unrelated $500 deposit.
 *
 * WHY IDENTITY AND NOT A FILTERED READ. Cycle 1 filtered the sweep's read
 * through `getReconciliationTxnKeep`. A hostile critic broke it: that rule
 * disowns a SUCCESSOR row dated inside the predecessor's claim, so when the only
 * copy of a leg is that row, the sweep — a WRITER — goes blind to it while every
 * reader still counts its counterpart on the unlinked side. The executed
 * consequence was a $123.45 card payment reading as negative spending, taking a
 * month's expenses from $200.00 to $76.55. The last test here is that
 * regression, locked: a writer that guards a flag must see at least everything
 * its readers see.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { refreshTransferFlags } from '@/lib/providers/transfer-refresh';

describe('H.7: one real account cannot pair with itself', () => {
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
   * is a transfer; the only thing they have in common is $500.00. The sending
   * leg is a checking account, so the direction gate passes it — identity is the
   * only thing that can refuse this one, which is what makes the premise lock
   * below meaningful rather than vacuous.
   */
  async function zelleAndDistributionOnBothCopies() {
    await prisma.transaction.createMany({
      data: [OLD_CHK, NEW_CHK].flatMap((accountId, i) => [
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
    });
  }

  it('a payment does not pair with a deposit on its own reconciled duplicate', async () => {
    await link();
    await zelleAndDistributionOnBothCopies();

    expect(await refreshTransferFlags(USER)).toEqual({ flagged: 0, overturned: 0, filed: 0 });

    const rows = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    expect(rows).toHaveLength(4);
    // Named directly, because these are the two figures the defect moved: real
    // spending stayed spending, and real income stayed income.
    expect(rows.filter((t) => t.categoryId === 'lawn-garden').every((t) => !t.isTransfer)).toBe(true);
    expect(rows.filter((t) => t.categoryId === 'income').every((t) => !t.isTransfer)).toBe(true);
  });

  it('premise lock: WITHOUT the link those same four rows DO pair — identity is what stops it', async () => {
    // No reconciliation row => every account is its own identity, so the two
    // copies are four rows on two different accounts and the cross-copy match is
    // a pair whose sending leg is a checking account. Without this assertion the
    // test above could pass because nothing pairs at all.
    await zelleAndDistributionOnBothCopies();
    expect((await refreshTransferFlags(USER)).overturned).toBe(4);
  });

  it('an UNDONE link is inert: the rows pair again, exactly as with no link at all (R9)', async () => {
    await link();
    await prisma.accountReconciliation.updateMany({
      where: { userId: USER },
      data: { undoneAt: new Date() },
    });
    await zelleAndDistributionOnBothCopies();
    expect((await refreshTransferFlags(USER)).overturned).toBe(4);
  });

  it('a genuine transfer BETWEEN two different real accounts still flags and files', async () => {
    await link();
    await prisma.transaction.createMany({
      data: [
        {
          id: `${USER}-pay`,
          accountId: NEW_CHK,
          date: '2026-07-10',
          amountCents: -12_345,
          rawDescriptor: 'CREDIT CARD PAID',
          categoryId: 'uncategorized',
          confidenceBps: 5000,
          needsReview: true,
        },
        {
          id: `${USER}-got`,
          accountId: CARD,
          date: '2026-07-11',
          amountCents: 12_345,
          rawDescriptor: 'PAYMENT RECEIVED - THANK YOU',
          categoryId: 'uncategorized',
          confidenceBps: 5000,
          needsReview: true,
        },
      ],
    });
    expect(await refreshTransferFlags(USER)).toEqual({ flagged: 2, overturned: 0, filed: 2 });
  });

  /**
   * The cycle-1 regression, locked. The R1 boundary rule disowns a SUCCESSOR row
   * dated inside the predecessor's claim. When that row is the only copy of a
   * transfer's paying leg, a sweep that FILTERED its read could not see it — and
   * the card leg, on an account under no link at all, is counted by every
   * reader. The card payment then read as negative spending.
   */
  it('sees a leg the reconciliation boundary would DISOWN, so its counterpart is still flagged', async () => {
    await link('2026-06-30');
    await prisma.transaction.createMany({
      data: [
        // Predecessor history that makes the claim non-degenerate and spans the
        // date below, so the R1 rule genuinely disowns the successor row.
        {
          id: `${USER}-anchor-a`,
          accountId: OLD_CHK,
          date: '2026-05-15',
          amountCents: -2_500,
          rawDescriptor: 'SQ *BLUE BOTTLE',
          categoryId: 'dining',
          confidenceBps: 9000,
          needsReview: false,
        },
        {
          id: `${USER}-anchor-b`,
          accountId: OLD_CHK,
          date: '2026-06-20',
          amountCents: -3_500,
          rawDescriptor: 'SQ *BLUE BOTTLE',
          categoryId: 'dining',
          confidenceBps: 9000,
          needsReview: false,
        },
        // The PAYING leg: on the successor, dated inside [first, cutover] — the
        // predecessor's claim — so the boundary disowns it. No predecessor copy
        // exists, which is the ordinary reason someone re-links a bank.
        {
          id: `${USER}-payer`,
          accountId: NEW_CHK,
          date: '2026-06-10',
          amountCents: -12_345,
          rawDescriptor: 'CREDIT CARD PAID',
          categoryId: 'uncategorized',
          confidenceBps: 5000,
          needsReview: true,
        },
        // The counterpart, on a card under no link: every reader counts it.
        {
          id: `${USER}-cardleg`,
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

    await refreshTransferFlags(USER);
    const cardLeg = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-cardleg` } });
    expect(cardLeg.isTransfer, 'a card payment must never read as negative spending').toBe(true);
    expect(cardLeg.categoryId).toBe('transfer');
  });

  /**
   * Cycle-1 critic F1, executed. The overturn write originally carried no
   * re-assertion, justified by "a row can only become MORE settled inside the
   * window" — which `undoCorrections` falsifies: Undo returns a row to
   * 'uncategorized' + needsReview. Flagging it then mints needsReview +
   * isTransfer, a state the triage queue HIDES, so the user's request to
   * re-review silently becomes a transfer filing.
   */
  it('the overturn write re-asserts its premise: a row UNDONE inside the window is skipped', async () => {
    await prisma.transaction.createMany({
      data: [
        {
          id: `${USER}-ot-out`,
          accountId: NEW_CHK,
          date: '2026-07-10',
          amountCents: -50_000,
          rawDescriptor: 'ONLINE WITHDRAWAL',
          categoryId: 'shopping',
          confidenceBps: 9000,
          needsReview: false,
        },
        {
          id: `${USER}-ot-in`,
          accountId: CARD,
          date: '2026-07-11',
          amountCents: 50_000,
          rawDescriptor: 'DEPOSIT RECEIVED',
          categoryId: 'income',
          confidenceBps: 9900,
          needsReview: false,
        },
      ],
    });

    const real = prisma.transaction.updateMany.bind(prisma.transaction);
    type Args = Parameters<typeof real>[0];
    // Both rows are settled + coherent, so overturnIds is the ONLY write —
    // making it call #1 and the mock unambiguous.
    const spy = vi.spyOn(prisma.transaction, 'updateMany').mockImplementationOnce((async (args: Args) => {
      await real({
        where: { id: `${USER}-ot-out` },
        data: { categoryId: 'uncategorized', needsReview: true, confidenceBps: 5000 },
      });
      return real(args);
    }) as unknown as typeof prisma.transaction.updateMany);
    try {
      await refreshTransferFlags(USER);
    } finally {
      spy.mockRestore();
    }

    const undone = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-ot-out` } });
    expect(undone.needsReview).toBe(true);
    expect(undone.isTransfer, 'an undone row must not be flagged into the hidden wedge').toBe(false);
  });

  /**
   * The FLAG write has the same exposure as the overturn write, from the other
   * direction: its ids were planned BECAUSE they carried no verdict, and a row
   * the user FILES inside the window now carries one. (Kept as its own test
   * because a sabotage of the flag write's guard alone left the suite green
   * when only the overturn lock existed.)
   */
  it('the flag write re-asserts its premise: a row FILED inside the read->write window is skipped', async () => {
    await prisma.transaction.createMany({
      data: [
        {
          id: `${USER}-race-out`,
          accountId: NEW_CHK,
          date: '2026-07-10',
          amountCents: -12_345,
          rawDescriptor: 'CREDIT CARD PAID',
          categoryId: 'uncategorized',
          confidenceBps: 5000,
          needsReview: true,
        },
        {
          id: `${USER}-race-in`,
          accountId: CARD,
          date: '2026-07-11',
          amountCents: 12_345,
          rawDescriptor: 'PAYMENT RECEIVED - THANK YOU',
          categoryId: 'uncategorized',
          confidenceBps: 5000,
          needsReview: true,
        },
      ],
    });

    const real = prisma.transaction.updateMany.bind(prisma.transaction);
    type Args = Parameters<typeof real>[0];
    // Both rows are unsettled, so flagIds is the FIRST write — the mock is
    // unambiguous. The user files the outflow as real dining right then.
    const spy = vi.spyOn(prisma.transaction, 'updateMany').mockImplementationOnce((async (args: Args) => {
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

  it('a resolved-but-UNCATEGORIZED row has no verdict to overturn: it flags, not overturns', async () => {
    // Reachable in production: deleting a custom category re-files its rows to
    // 'uncategorized' without touching needsReview. The write's OR clause and
    // the engine's predicate are built from ONE exported constant, so this and
    // `hasCompetingVerdict` cannot drift apart (cycle-1 critic F3).
    await prisma.transaction.createMany({
      data: [
        {
          id: `${USER}-uc-out`,
          accountId: NEW_CHK,
          date: '2026-07-10',
          amountCents: -70_000,
          rawDescriptor: 'ONLINE WITHDRAWAL',
          categoryId: 'uncategorized',
          confidenceBps: 5000,
          needsReview: false,
        },
        {
          id: `${USER}-uc-in`,
          accountId: CARD,
          date: '2026-07-11',
          amountCents: 70_000,
          rawDescriptor: 'DEPOSIT RECEIVED',
          categoryId: 'uncategorized',
          confidenceBps: 5000,
          needsReview: false,
        },
      ],
    });
    expect(await refreshTransferFlags(USER)).toEqual({ flagged: 2, overturned: 0, filed: 0 });
  });
});
