/**
 * The rule tag-for-taxes action reaching history through the BACKFILL
 * (O.15 slice 6, critic cycle 1 findings 3/4/6).
 *
 * The keyword-rule apply has a preview, a count and three documented exclusions.
 * The backfill is the SAME write reached by a different button, and its first cut
 * had none of them: it reported no tag count, and its read scope — unlike
 * `matchableWhere` — does not exclude split CHILDREN or rows the reader removed
 * from his totals. A child carries its parent's descriptor, so a keyword rule
 * matches it, and its amount is real money in the tax export.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { runBackfillForUser, type SuggestCategoryFn } from '@/server/backfill';
import { prisma } from '@/lib/db';

const USER = `bf-tax-${Date.now()}-${process.pid}`;
/** No provider key in test: the LLM pass is a no-op, as in demo. */
const noLlm: SuggestCategoryFn = async () => null;

let accountId = '';

async function wipe() {
  await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
  await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
}

beforeAll(async () => {
  await wipe();
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
});
afterAll(wipe);

beforeEach(async () => {
  await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
  await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  const account = await prisma.account.create({
    data: {
      userId: USER,
      provider: 'demo',
      name: 'Card',
      type: 'CREDIT',
      currentBalanceCents: 0,
      currency: 'USD',
    },
  });
  accountId = account.id;
  await prisma.categorizationRule.create({
    data: {
      userId: USER,
      categoryId: 'dining',
      priority: 110,
      matchKeywords: 'mirko',
      matchKeywordGroups: 'mirko',
      setTaxClass: 'business',
    },
  });
});

/** One unsure row the rule resolves. */
async function unsureRow(over: Record<string, unknown> = {}) {
  return prisma.transaction.create({
    data: {
      accountId,
      date: '2026-06-10',
      rawDescriptor: 'MIRKO PASTA',
      amountCents: -4400,
      categoryId: 'uncategorized',
      needsReview: true,
      confidenceBps: 5000,
      ...over,
    },
  });
}

describe('runBackfillForUser — the tag action', () => {
  it('tags the rows it re-files, and REPORTS how many (the /triage button says so)', async () => {
    await unsureRow();
    const res = await runBackfillForUser(USER, noLlm);
    expect(res.refiled).toBe(1);
    expect(res.taxTagged).toBe(1);
    const row = await prisma.transaction.findFirstOrThrow({ where: { account: { userId: USER } } });
    expect(row.categoryId).toBe('dining');
    expect(row.taxClass).toBe('business');
  });

  it('never overwrites a tag the reader set, and still re-files the row', async () => {
    await unsureRow({ taxClass: 'medical' });
    const res = await runBackfillForUser(USER, noLlm);
    expect(res.refiled).toBe(1);
    expect(res.taxTagged).toBe(0);
    const row = await prisma.transaction.findFirstOrThrow({ where: { account: { userId: USER } } });
    expect(row.categoryId).toBe('dining'); // the category still moved…
    expect(row.taxClass).toBe('medical'); // …and his answer stands
  });

  it('never tags a row the reader removed from his totals, and still re-files it', async () => {
    await unsureRow({ excludeFromTotals: true });
    const res = await runBackfillForUser(USER, noLlm);
    expect(res.refiled).toBe(1);
    expect(res.taxTagged).toBe(0);
    const row = await prisma.transaction.findFirstOrThrow({ where: { account: { userId: USER } } });
    expect(row.categoryId).toBe('dining');
    expect(row.taxClass).toBeNull();
  });

  it('never tags a split CHILD — the allocation is the only record of the reader’s intent', async () => {
    const parent = await prisma.transaction.create({
      data: {
        accountId,
        date: '2026-06-10',
        rawDescriptor: 'MIRKO PASTA',
        amountCents: -10000,
        isSplitParent: true,
        needsReview: false,
      },
    });
    const child = await unsureRow({ amountCents: -4000, splitParentId: parent.id });
    const res = await runBackfillForUser(USER, noLlm);
    expect(res.taxTagged).toBe(0);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: child.id } });
    expect(row.taxClass).toBeNull();
  });

  it('treats a BLANK stored tag as untagged, exactly as the keyword-rule writer does', async () => {
    // The two writers had two definitions of "untagged": the keyword path counted
    // '' as free, the backfill's WHERE said `taxClass: null` only — and because the
    // clause sat in the same update as the category, the whole re-file was lost.
    await unsureRow({ taxClass: '' });
    const res = await runBackfillForUser(USER, noLlm);
    expect(res.refiled).toBe(1);
    expect(res.taxTagged).toBe(1);
    const row = await prisma.transaction.findFirstOrThrow({ where: { account: { userId: USER } } });
    expect(row.categoryId).toBe('dining');
    expect(row.taxClass).toBe('business');
  });
});
