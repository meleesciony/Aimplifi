/**
 * THE HOSTILE-CRITIC FINDINGS on the keyword-rule write path (TASKS O.13a, cycle 1:
 * 2 P0 + 7 P1 across two fresh-context critics).
 *
 * Every case here was REPRODUCED against the shipped code before the fix, so each is
 * a fail-old lock rather than a restatement of the fix. The theme is one sentence:
 * the apply set used to be "every row the user owns", which swept up rows whose
 * category was a deliberate human decision the app had no business overwriting.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { createKeywordRule, listKeywordRules, previewKeywordRule } from '@/server/keyword-rules';
import { prisma } from '@/lib/db';

const USER = `kwc-${Date.now()}-${process.pid}`;

async function wipe() {
  await prisma.correction.deleteMany({ where: { userId: USER } });
  await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
  await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
  await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.categorizationRule.deleteMany({ where: { userId: DEMO_USER_ID, NOT: { matchKeywords: null } } });
}

beforeAll(async () => {
  await wipe();
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
});

afterAll(wipe);

/** Three ordinary Mirko rows the register would show, plus a spare account set. */
beforeEach(async () => {
  vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  await prisma.correction.deleteMany({ where: { userId: USER } });
  await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
  await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  const card = await prisma.account.create({
    data: {
      userId: USER,
      provider: 'simplefin',
      providerRef: `${USER}-card`,
      name: 'Card',
      type: 'CREDIT',
      currentBalanceCents: 0,
      currency: 'USD',
    },
  });
  await prisma.transaction.createMany({
    data: [
      { accountId: card.id, date: '2026-07-28', rawDescriptor: 'Tst*mirko Pasta Buckhead', amountCents: -12125, status: 'POSTED', needsReview: true },
      { accountId: card.id, date: '2026-06-14', rawDescriptor: 'MIRKO PASTA', amountCents: -4400, status: 'POSTED', needsReview: true },
      { accountId: card.id, date: '2026-05-02', rawDescriptor: 'Mirko Pasta Buckhead', amountCents: -8800, status: 'POSTED', needsReview: true },
    ],
  });
});

async function card() {
  return prisma.account.findFirstOrThrow({ where: { userId: USER, type: 'CREDIT', currency: 'USD' } });
}

describe('the apply set carries the exclusions its siblings carry (P0)', () => {
  it('counts and files only rows the register can actually show', async () => {
    const acct = await card();
    const invest = await prisma.account.create({
      data: { userId: USER, provider: 'simplefin', providerRef: `${USER}-inv`, name: 'Brokerage', type: 'INVESTMENT', currentBalanceCents: 0, currency: 'USD' },
    });
    const eur = await prisma.account.create({
      data: { userId: USER, provider: 'simplefin', providerRef: `${USER}-eur`, name: 'EU Card', type: 'CREDIT', currentBalanceCents: 0, currency: 'EUR' },
    });
    const parent = await prisma.transaction.create({
      data: { accountId: acct.id, date: '2026-04-02', rawDescriptor: 'MIRKO PASTA PARTY', amountCents: -30000, status: 'POSTED', isSplitParent: true },
    });
    await prisma.transaction.createMany({
      data: [
        // Split CHILDREN share the parent's descriptor, so the rule swept the
        // reader's hand-made allocation into one category — and that allocation was
        // the only record it ever existed.
        { accountId: acct.id, date: '2026-04-02', rawDescriptor: 'MIRKO PASTA PARTY', amountCents: -20000, status: 'POSTED', splitParentId: parent.id, categoryId: 'groceries' },
        { accountId: acct.id, date: '2026-04-02', rawDescriptor: 'MIRKO PASTA PARTY', amountCents: -10000, status: 'POSTED', splitParentId: parent.id, categoryId: 'household' },
        // A detected transfer: the transfer pass owns this call, never a rule — and
        // `categorize` returns before rules are read, so counting it promised a
        // filing the pipeline refuses.
        { accountId: acct.id, date: '2026-04-03', rawDescriptor: 'MIRKO PASTA TRANSFER', amountCents: -5000, status: 'POSTED', isTransfer: true },
        // A row the reader PINNED for his own review.
        { accountId: acct.id, date: '2026-04-04', rawDescriptor: 'MIRKO PASTA PINNED', amountCents: -1500, status: 'POSTED', needsReview: true, reviewPinned: true },
        // Populations no register page renders (DECISIONS #135 + spending types).
        { accountId: invest.id, date: '2026-04-05', rawDescriptor: 'MIRKO PASTA DIVIDEND', amountCents: 1234, status: 'POSTED' },
        { accountId: eur.id, date: '2026-04-06', rawDescriptor: 'MIRKO PASTA EU FEE', amountCents: -900, status: 'POSTED' },
      ],
    });

    const preview = await previewKeywordRule({ keywordsRaw: 'mirko', categoryId: 'dining' });
    expect(preview.matchCount).toBe(3); // the three ordinary rows, none of the six specials
    expect(preview.samples.map((s) => s.rawDescriptor)).not.toContain('MIRKO PASTA TRANSFER');

    await createKeywordRule({ keywordsRaw: 'mirko', categoryId: 'dining', applyToExisting: true });

    const byDescriptor = (d: string) =>
      prisma.transaction.findFirstOrThrow({
        where: { account: { userId: USER }, rawDescriptor: d, splitParentId: null },
      });

    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: parent.id } })).categoryId).toBeNull();
    const children = await prisma.transaction.findMany({
      where: { splitParentId: parent.id },
      orderBy: { amountCents: 'asc' },
    });
    expect(children.map((c) => c.categoryId)).toEqual(['groceries', 'household']);
    expect((await byDescriptor('MIRKO PASTA TRANSFER')).categoryId).toBeNull();
    const pinned = await byDescriptor('MIRKO PASTA PINNED');
    expect(pinned.categoryId).toBeNull();
    expect(pinned.reviewPinned).toBe(true); // the flag was cleared before, unrecoverably
    expect((await byDescriptor('MIRKO PASTA DIVIDEND')).categoryId).toBeNull();
    expect((await byDescriptor('MIRKO PASTA EU FEE')).categoryId).toBeNull();
  });
});

describe('an outflow is never filed into an income category (P0)', () => {
  it('skips it, reports the skip, and files the rest', async () => {
    const acct = await card();
    await prisma.transaction.createMany({
      data: [
        { accountId: acct.id, date: '2026-04-10', rawDescriptor: 'CARDONE EQ FUND DIST', amountCents: 37500, status: 'POSTED', needsReview: true },
        { accountId: acct.id, date: '2026-04-11', rawDescriptor: 'CARDONE MGMT FEE', amountCents: -12500, status: 'POSTED', needsReview: true },
      ],
    });
    const preview = await previewKeywordRule({ keywordsRaw: 'cardone', categoryId: 'investment-income' });
    expect(preview.matchCount).toBe(2);
    expect(preview.signMismatchCount).toBe(1);
    expect(preview.wouldFileCount).toBe(1); // so the checkbox cannot promise 2

    const res = await createKeywordRule({
      keywordsRaw: 'cardone',
      categoryId: 'investment-income',
      applyToExisting: true,
    });
    expect(res.affected).toBe(1);
    expect(res.skippedWrongSign).toBe(1);
    const fee = await prisma.transaction.findFirstOrThrow({
      where: { account: { userId: USER }, rawDescriptor: 'CARDONE MGMT FEE' },
    });
    // Filing this as income would have deleted $125 of real spending from reports,
    // trends and budgets while the flows engine still counted it as an expense.
    expect(fee.categoryId).toBeNull();
  });

  it('does NOT flag a refund in a spend category — that is the documented convention', async () => {
    const acct = await card();
    await prisma.transaction.create({
      data: { accountId: acct.id, date: '2026-04-12', rawDescriptor: 'MIRKO PASTA REFUND', amountCents: 4400, status: 'POSTED' },
    });
    const preview = await previewKeywordRule({ keywordsRaw: 'mirko', categoryId: 'dining' });
    expect(preview.inflowCount).toBe(1);
    expect(preview.signMismatchCount).toBe(0); // the symmetric version said 1, falsely
  });
});

describe('undo lineage: reverting also removes the rule (P1)', () => {
  it('stamps becameRuleId + createdFrom so the existing undo path unwinds it', async () => {
    const res = await createKeywordRule({
      keywordsRaw: 'mirko',
      categoryId: 'dining',
      applyToExisting: true,
    });
    expect(res.correctionIds.length).toBeGreaterThan(0);
    const owner = await prisma.correction.findUniqueOrThrow({ where: { id: res.correctionIds[0]! } });
    expect(owner.becameRuleId).toBe(res.ruleId);
    const rule = await prisma.categorizationRule.findUniqueOrThrow({ where: { id: res.ruleId } });
    expect(rule.createdFrom).toBe(res.correctionIds[0]);
    // Without this pairing the rule survived its own undo, and the next backfill
    // silently re-filed every row the reader had just reverted.
  });
});

describe('the shared demo account is fenced (both critics)', () => {
  it('refuses to create, and lists nothing, for the demo row', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: DEMO_USER_ID } } as never);
    await expect(
      createKeywordRule({ keywordsRaw: 'cardone', categoryId: 'investment-income' }),
    ).rejects.toThrow();
    expect(await listKeywordRules()).toEqual([]);
    expect(
      await prisma.categorizationRule.count({
        where: { userId: DEMO_USER_ID, NOT: { matchKeywords: null } },
      }),
    ).toBe(0);
  });
});

describe('targets and keys a durable rule may not have (P2)', () => {
  it('refuses transfer and uncategorized', async () => {
    await expect(createKeywordRule({ keywordsRaw: 'mirko', categoryId: 'transfer' })).rejects.toThrow(
      /detected from the two accounts/i,
    );
    await expect(createKeywordRule({ keywordsRaw: 'mirko', categoryId: 'uncategorized' })).rejects.toThrow(
      /real category/i,
    );
    expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(0);
  });

  it('refuses a key too short to be an identity', async () => {
    await expect(createKeywordRule({ keywordsRaw: 'a', categoryId: 'dining' })).rejects.toThrow(
      /at least 3 letters/i,
    );
  });
});

describe('the zero-match preview hands back real bank text (P1)', () => {
  it('shows recent raw descriptors, because the register displays the cleaned name', async () => {
    // A reader told to "check the spelling" had no surface showing the string a rule
    // matches against — and this session's brand work widened the gap ("MACYS LENOX
    // SQUARE" displays as "Macy's", which never matches as typed).
    const preview = await previewKeywordRule({ keywordsRaw: 'nothingmatchesthis', categoryId: 'dining' });
    expect(preview.matchCount).toBe(0);
    expect(preview.recentDescriptors.length).toBeGreaterThan(0);
    expect(preview.recentDescriptors).toContain('MIRKO PASTA');
  });

  it('does not pad a successful preview with unrelated descriptors', async () => {
    const preview = await previewKeywordRule({ keywordsRaw: 'mirko', categoryId: 'dining' });
    expect(preview.matchCount).toBeGreaterThan(0);
    expect(preview.recentDescriptors).toEqual([]);
  });
});
