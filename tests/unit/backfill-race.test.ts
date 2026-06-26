/**
 * Backfill TOCTOU guard (DECISIONS #117; adversarial-review P1) — proves the
 * compare-and-set write does NOT clobber a row the user settled between the
 * backfill's snapshot read and its write. The injected LLM stub doubles as the
 * race hook: it runs after the read and before the write (pass 2), and settles the
 * to-be-refiled row exactly as a concurrent triage confirm would. Without the
 * write-time unsure predicate this test fails (the row is overwritten).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { runBackfillForUser, type SuggestCategoryFn } from '@/server/backfill';
import { prisma } from '@/lib/db';

describe('runBackfillForUser — concurrent-confirm guard (DECISIONS #117)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `backfill-race-${stamp}`;
  const ids: Record<string, string> = {};

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    for (const c of [
      { id: 'uncategorized', name: 'Uncategorized' },
      { id: 'dental-insurance', name: 'Dental Insurance' },
      { id: 'groceries', name: 'Groceries' },
    ]) {
      await prisma.category.upsert({ where: { id: c.id }, update: {}, create: { id: c.id, name: c.name, isSystem: true } });
    }
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'T', type: 'CHECKING', currentBalanceCents: 0 },
    });
    const det = await prisma.transaction.create({
      data: { accountId: acct.id, date: '2026-06-10', rawDescriptor: 'DELTA DENTAL OF GA PREMIUM', amountCents: -4500, categoryId: 'uncategorized', needsReview: true, confidenceBps: 5000 },
    });
    ids.det = det.id;
    // An unknown row so the LLM stub (the race hook) is actually invoked.
    const unknown = await prisma.transaction.create({
      data: { accountId: acct.id, date: '2026-06-10', rawDescriptor: 'ACME WIDGETS LLC 7781', amountCents: -2000, categoryId: 'uncategorized', needsReview: true, confidenceBps: 5000 },
    });
    ids.unknown = unknown.id;
  });
  afterAll(wipe);

  it('does not overwrite a row a concurrent confirm settled mid-backfill', async () => {
    let hooked = false;
    const racySuggest: SuggestCategoryFn = async () => {
      // Runs between the backfill's read and write; settle `det` to a user category
      // exactly as applyCategory would (needsReview:false + confirmed confidence).
      if (!hooked) {
        hooked = true;
        await prisma.transaction.update({
          where: { id: ids.det },
          data: { categoryId: 'groceries', needsReview: false, confidenceBps: 9900 },
        });
      }
      return null;
    };

    const res = await runBackfillForUser(USER, racySuggest);

    // `det` was settled to groceries mid-flight → the backfill must NOT clobber it.
    const det = await prisma.transaction.findUnique({ where: { id: ids.det } });
    expect(det!.categoryId).toBe('groceries');
    expect(det!.needsReview).toBe(false);
    expect(det!.confidenceBps).toBe(9900);

    // `det` was the only refilable row → skipped by compare-and-set → 0 written.
    expect(res.refiled).toBe(0);
  });
});
