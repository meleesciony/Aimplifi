/**
 * The proposal reaches the triage inbox (DECISIONS #331) — integration.
 *
 * The pure engine is covered in propose.test.ts. What is UNCOVERED by a pure
 * test, and what actually broke the owner's experience, is whether a proposal
 * survives the trip through the server: a real Correction row, a real
 * transaction, the real grouping, the real `getTriageGroups`. This file drives
 * that path on throwaway users.
 *
 * Two claims, and the second matters more than the first:
 *   1. a recurring check the owner has filed twice is PROPOSED on the third; and
 *   2. that proposal is NOT confident — "Accept all confident" cannot sweep it,
 *      because the owner asked to be ASKED. `isConfidentGroup` reads
 *      `suggestedCategoryId` alone, so this holds by construction; the test
 *      exists to fail loudly if anyone ever widens that predicate.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { isConfidentGroup, selectConfidentGroups } from '@/lib/engine/categorize/group';
import { loadCorrectionInputs, loadLearnedRules } from '@/server/rules';
import { getTriageGroups } from '@/server/triage';
import { prisma } from '@/lib/db';

const USER = `prop-${Date.now()}-${process.pid}`;
const CHECK_AMOUNT = -145_000; // $1,450.00 rent check, identical every month

async function wipe() {
  await prisma.correction.deleteMany({ where: { userId: USER } });
  await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
  await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.category.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
}

async function account() {
  return prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'prop-chk' } });
}

/** A filed row plus the Correction that filed it — the owner's past decision. */
async function filedCheck(id: string, date: string, descriptor: string, amountCents: number, categoryId: string) {
  const acct = await account();
  await prisma.transaction.create({
    data: {
      id: `${id}-${process.pid}`,
      accountId: acct.id,
      date,
      amountCents,
      rawDescriptor: descriptor,
      categoryId,
      confidenceBps: 10_000,
      needsReview: false,
    },
  });
  await prisma.correction.create({
    data: { userId: USER, transactionId: `${id}-${process.pid}`, toCategoryId: categoryId },
  });
}

/** An unfiled row sitting in the review queue — what the inbox will show. */
async function queuedCheck(id: string, date: string, descriptor: string, amountCents: number) {
  const acct = await account();
  await prisma.transaction.create({
    data: {
      id: `${id}-${process.pid}`,
      accountId: acct.id,
      date,
      amountCents,
      rawDescriptor: descriptor,
      categoryId: 'uncategorized',
      confidenceBps: 4000,
      needsReview: true,
    },
  });
}

describe('a proposal reaches the inbox (integration)', () => {
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
    await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.account.create({
      data: {
        userId: USER,
        provider: 'simplefin',
        providerRef: 'prop-chk',
        name: 'Checking',
        type: 'CHECKING',
        currentBalanceCents: 500_000,
        currency: 'USD',
      },
    });
  });

  it('with no history, the recurring check is queued with NO suggestion at all', async () => {
    await queuedCheck('p-q1', '2026-06-01', 'CHECK PAID 1874', CHECK_AMOUNT);
    const [group] = await getTriageGroups(USER);
    expect(group).toBeDefined();
    expect(group!.suggestedCategoryId).toBeNull();
    expect(group!.providerSuggestedCategoryId).toBeNull();
    expect(group!.proposedCategoryId).toBeNull(); // the "very dumb" baseline
  });

  it('after two identical checks are filed, the third is PROPOSED with its evidence', async () => {
    await filedCheck('p-f1', '2026-04-01', 'CHECK PAID 1841', CHECK_AMOUNT, 'rent');
    await filedCheck('p-f2', '2026-05-01', 'CHECK PAID 1856', CHECK_AMOUNT, 'rent');
    await queuedCheck('p-q1', '2026-06-01', 'CHECK PAID 1874', CHECK_AMOUNT);

    const [group] = await getTriageGroups(USER);
    expect(group).toBeDefined();
    expect(group!.proposedCategoryId).toBe('rent');
    expect(group!.proposedCategoryName).toBe('Rent & Mortgage'); // the taxonomy's own label
    // the reason names the repeated amount VERBATIM, formatted once at this boundary
    expect(group!.proposalReason).toContain('$1,450.00');
    expect(group!.proposalReason).toContain('Rent & Mortgage');
  });

  it('the proposal is NOT confident — "Accept all confident" cannot sweep it', async () => {
    await filedCheck('p-f1', '2026-04-01', 'CHECK PAID 1841', CHECK_AMOUNT, 'rent');
    await filedCheck('p-f2', '2026-05-01', 'CHECK PAID 1856', CHECK_AMOUNT, 'rent');
    await queuedCheck('p-q1', '2026-06-01', 'CHECK PAID 1874', CHECK_AMOUNT);

    const groups = await getTriageGroups(USER);
    const proposed = groups.filter((g) => g.proposedCategoryId !== null);
    expect(proposed.length).toBeGreaterThan(0);
    for (const g of proposed) expect(isConfidentGroup(g)).toBe(false);
    expect(selectConfidentGroups(groups)).toEqual([]);
  });

  it('a DIFFERENT amount on the same channel is not proposed', async () => {
    await filedCheck('p-f1', '2026-04-01', 'CHECK PAID 1841', CHECK_AMOUNT, 'rent');
    await filedCheck('p-f2', '2026-05-01', 'CHECK PAID 1856', CHECK_AMOUNT, 'rent');
    await queuedCheck('p-q1', '2026-06-01', 'CHECK PAID 1899', -6_000);

    const [group] = await getTriageGroups(USER);
    expect(group!.proposedCategoryId).toBeNull();
  });

  it('a Venmo to the same payee is proposed despite a moving transaction id', async () => {
    await filedCheck('p-v1', '2026-04-03', 'VENMO PAYMENT 1029384756 JOHN SMITH', -45_000, 'childcare');
    await queuedCheck('p-q1', '2026-06-03', 'VENMO PAYMENT 1938475620 JOHN SMITH', -45_000);

    const [group] = await getTriageGroups(USER);
    expect(group!.proposedCategoryId).toBe('childcare');
    expect(group!.proposalReason).toContain('JOHN SMITH');
  });

  it('a Venmo to a DIFFERENT payee is left alone', async () => {
    await filedCheck('p-v1', '2026-04-03', 'VENMO PAYMENT 1029384756 JOHN SMITH', -45_000, 'childcare');
    await queuedCheck('p-q1', '2026-06-03', 'VENMO PAYMENT 5566778899 ACME LANDSCAPING', -8_000);

    const [group] = await getTriageGroups(USER);
    expect(group!.proposedCategoryId).toBeNull();
  });

  it('the SHARED DEMO row never learns from a visitor, on any of the three paths', async () => {
    // The demo is credential-free, so every anonymous visitor is this same row.
    // One visitor's filing decisions must never become evidence shown to the next
    // — least of all as "You filed …", a sentence that would be false about them.
    // Fenced at the single loader all three correction-derived features read.
    const demoAccount = await prisma.account.findFirst({ where: { userId: DEMO_USER_ID } });
    expect(demoAccount, 'demo seed must exist for this test to mean anything').not.toBeNull();

    const demoTxn = await prisma.transaction.findFirstOrThrow({
      where: { account: { userId: DEMO_USER_ID } },
    });
    const planted = await prisma.correction.create({
      data: { userId: DEMO_USER_ID, transactionId: demoTxn.id, toCategoryId: 'dining' },
    });
    try {
      expect(await loadCorrectionInputs(DEMO_USER_ID)).toEqual([]);
      expect(await loadLearnedRules(DEMO_USER_ID)).toEqual([]);
      const demoGroups = await getTriageGroups(DEMO_USER_ID);
      expect(demoGroups.every((g) => g.proposedCategoryId === null)).toBe(true);
      expect(demoGroups.every((g) => g.proposalReason === null)).toBe(true);
    } finally {
      await prisma.correction.delete({ where: { id: planted.id } });
    }
  });

  it('undoing the history withdraws the proposal', async () => {
    await filedCheck('p-f1', '2026-04-01', 'CHECK PAID 1841', CHECK_AMOUNT, 'rent');
    await filedCheck('p-f2', '2026-05-01', 'CHECK PAID 1856', CHECK_AMOUNT, 'rent');
    await queuedCheck('p-q1', '2026-06-01', 'CHECK PAID 1874', CHECK_AMOUNT);
    expect((await getTriageGroups(USER))[0]!.proposedCategoryId).toBe('rent');

    // an inverse correction on one of the two demonstrations drops it below the bar
    const original = await prisma.correction.findFirstOrThrow({
      where: { userId: USER, transactionId: `p-f2-${process.pid}` },
    });
    await prisma.correction.create({
      data: {
        userId: USER,
        transactionId: `p-f2-${process.pid}`,
        toCategoryId: 'rent',
        undoesId: original.id,
      },
    });

    expect((await getTriageGroups(USER))[0]!.proposedCategoryId).toBeNull();
  });
});
