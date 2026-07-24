/**
 * /cards surfaces the personal duplicate detector — TASKS L.6, server half (integration).
 *
 * Owner-reported 2026-07-24: one real Chase card arriving through TWO LIVE Plaid connections was
 * listed twice on /cards and counted twice in the "Do this first" instruction and every card total,
 * with nothing on the page flagging it. `cashNeededFromSnapshot` de-duplicates only the RECONCILED
 * kind, and the personal detector rendered only inside `accounts-list.tsx`.
 *
 * FAIL-OLD: `DashboardData.cardDuplicates` did not exist, so every assertion here fails to compile
 * against the old build.
 *
 * These are DB-backed because the whole point is the wiring — the detector itself is locked in
 * tests/unit/account-duplicates.test.ts and the copy in tests/unit/card-duplicate-view.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { getDashboardData } from '@/server/finance';
import { duplicatePairDismissKey } from '@/server/duplicate-dismissal';

const stamp = `${Date.now()}-${process.pid}`;
const ALL_IDS: string[] = [];

async function seedUser(slug: string): Promise<string> {
  const id = `l6-${slug}-${stamp}`;
  ALL_IDS.push(id);
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: slug } });
  return id;
}

/** A LIVE Plaid connection. `isAccountLive` reads exactly this row, so an account whose
 *  `plaidItemId` has no PlaidItem is a disconnected leftover, not a live connection. */
async function seedItem(userId: string, itemId: string): Promise<void> {
  await prisma.plaidItem.create({
    data: { userId, itemId, accessToken: 'ct-test', institution: 'Chase' },
  });
}

/** A live Plaid CARD row. `plaidItemId` differs per connection — that is what makes two rows for
 *  one real card possible, and what the detector's C-10 rule keys on. */
async function seedCard(
  userId: string,
  name: string,
  mask: string | null,
  plaidItemId: string,
  balanceCents = -667_968,
): Promise<string> {
  const a = await prisma.account.create({
    data: {
      userId,
      provider: 'plaid',
      plaidItemId,
      name,
      type: 'CREDIT',
      mask,
      currentBalanceCents: balanceCents,
      currency: 'USD',
      dueDayOfMonth: 5,
      cycleCloseDayOfMonth: 8,
    },
  });
  return a.id;
}

describe('/cards duplicate disclosure — server wiring (TASKS L.6)', () => {
  let userId: string;
  let chaseA = '';
  let chaseB = '';

  beforeAll(async () => {
    userId = await seedUser('owner');
    for (const item of ['item-chk', 'item-1', 'item-2', 'item-3']) await seedItem(userId, item);
    await prisma.account.create({
      data: {
        userId, provider: 'plaid', plaidItemId: 'item-chk', name: 'Everyday Checking',
        type: 'CHECKING', currentBalanceCents: 500_000, currency: 'USD',
      },
    });
    // THE reported pair: same name, same last-4, two live connections.
    chaseA = await seedCard(userId, 'CREDIT CARD', '0977', 'item-1');
    chaseB = await seedCard(userId, 'CREDIT CARD', '0977', 'item-2');
    // A genuinely different card — the detector must not sweep it in.
    await seedCard(userId, 'Spark Miles', '5154', 'item-3', -91_330);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ALL_IDS } } });
  });

  it('reports the both-live pair — the case /cards silently double-counted', async () => {
    const data = await getDashboardData(userId, 'mine');
    expect(data.cardDuplicates).toHaveLength(1);
    expect([data.cardDuplicates[0].aId, data.cardDuplicates[0].bId].sort()).toEqual(
      [chaseA, chaseB].sort(),
    );
  });

  it('both rows really are displayed AND counted — the disclosure is about a live double-count', async () => {
    const data = await getDashboardData(userId, 'mine');
    const displayed = new Set([
      ...data.payInFull.cards.map((c) => c.cardId),
      ...data.payInFull.unknownDueDateCards.map((c) => c.cardId),
    ]);
    expect(displayed.has(chaseA)).toBe(true);
    expect(displayed.has(chaseB)).toBe(true);
  });

  it('every figure is left EXACTLY as the engine computed it — disclose, never silently subtract', async () => {
    // DECISIONS #289: excluding a suspected duplicate from a money headline would assert that two
    // rows are one card, which only the user can confirm.
    const data = await getDashboardData(userId, 'mine');
    const both = data.payInFull.cards.filter((c) => c.cardId === chaseA || c.cardId === chaseB);
    expect(both).toHaveLength(2);
  });

  it('a pair the user dismissed as "not duplicates" never re-asks on this page', async () => {
    const dismissKey = duplicatePairDismissKey(chaseA, chaseB);
    await prisma.nudgeDismissal.create({ data: { userId, dismissKey } });
    try {
      const data = await getDashboardData(userId, 'mine');
      expect(data.cardDuplicates).toEqual([]);
    } finally {
      await prisma.nudgeDismissal.delete({ where: { userId_dismissKey: { userId, dismissKey } } });
    }
  });

  it('a duplicate pair that /cards does not LIST is not disclosed here — /accounts lists it', async () => {
    const other = await seedUser('checking-dupe');
    ALL_IDS.push(other);
    for (const item of ['c-1', 'c-2']) {
      await prisma.account.create({
        data: {
          userId: other, provider: 'plaid', plaidItemId: item, name: 'Everyday Checking',
          type: 'CHECKING', mask: '2927', currentBalanceCents: 123_456, currency: 'USD',
        },
      });
    }
    await seedCard(other, 'Venture', '6271', 'c-3');
    const data = await getDashboardData(other, 'mine');
    expect(data.cardDuplicates).toEqual([]);
  });

  it('a user with no duplicates gets an empty list — no card is flagged on a hunch', async () => {
    const clean = await seedUser('clean');
    for (const item of ['k-1', 'k-2']) await seedItem(clean, item);
    await seedCard(clean, 'Venture', '6271', 'k-1');
    await seedCard(clean, 'Bonvoy', '3312', 'k-2', -21_799);
    const data = await getDashboardData(clean, 'mine');
    expect(data.cardDuplicates).toEqual([]);
  });

  it('carries the detector BASIS through, so the page can state its assumptions inline', async () => {
    const data = await getDashboardData(userId, 'mine');
    expect(data.cardDuplicates[0].confidence).toBe('high');
    expect(data.cardDuplicates[0].reasons.join(' ')).toContain('0977');
  });

  it('says NOTHING when one side is no longer live — that pair has no dismiss control anywhere', async () => {
    // Critic P1. `detectReconciliationCandidates` only proposes a pair whose sides DIFFER in
    // liveness, and /accounts suppresses its duplicate warning (and therefore its Dismiss button)
    // for any pair that has such a candidate. An unsuppressed banner here would be permanent and
    // undismissable on the money page — the exact complaint that created the dismissal feature.
    const halfDead = await seedUser('half-dead');
    await seedItem(halfDead, 'live-1'); // 'gone-1' deliberately has NO PlaidItem row
    await seedCard(halfDead, 'CREDIT CARD', '0977', 'live-1');
    await seedCard(halfDead, 'CREDIT CARD', '0977', 'gone-1');
    const data = await getDashboardData(halfDead, 'mine');
    // The detector still pairs them — this is a display fence, not a change to the heuristic.
    expect(data.payInFull.cards.length + data.payInFull.unknownDueDateCards.length).toBe(2);
    expect(data.cardDuplicates).toEqual([]);
  });
});
