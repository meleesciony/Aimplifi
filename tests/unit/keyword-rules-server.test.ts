/**
 * Typed keyword rules — the trip through the server (TASKS O.13a).
 *
 * The pure semantics are covered in `keyword-rule.test.ts`. What a pure test
 * cannot see is the claim the UI makes to the reader: **the preview count and the
 * set the rule actually files must be the same set.** A preview is a promise about
 * a mutation, and this repo has been bitten repeatedly by two surfaces answering
 * one question over different rows (docs/lessons/one-question-one-basis…), so the
 * parity is asserted here against real rows rather than argued in a comment.
 *
 * Also locked: the empty key is refused at the server boundary too (it is refused
 * in three places because it is the one mistake in this feature whose blast radius
 * is the whole account), and every re-filed row gets a Correction so the action is
 * undoable like every other filing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { keywordsMatch, parseKeywords } from '@/lib/engine/categorize/keyword-rule';
import {
  createKeywordRule,
  deleteKeywordRule,
  listKeywordRules,
  previewKeywordRule,
} from '@/server/keyword-rules';
import { loadExplicitUserRules } from '@/server/rules';
import { prisma } from '@/lib/db';

const USER = `kw-${Date.now()}-${process.pid}`;

/** One restaurant under two descriptors — the pair no derived key can span. */
const ROWS = [
  { d: 'Tst*mirko Pasta Buckhead', cents: -12125, date: '2026-07-28' },
  { d: 'MIRKO PASTA', cents: -4400, date: '2026-06-14' },
  { d: 'Mirko Pasta Buckhead', cents: -8800, date: '2026-05-02' },
  // Must NOT be swept in: shares a word with the key but not the key itself.
  { d: 'PASTA HOUSE ATLANTA', cents: -3300, date: '2026-05-01' },
  { d: 'PUBLIX #1234', cents: -9200, date: '2026-04-20' },
];

async function wipe() {
  await prisma.correction.deleteMany({ where: { userId: USER } });
  await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
  await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
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
  vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  await prisma.correction.deleteMany({ where: { userId: USER } });
  await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
  await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  const account = await prisma.account.create({
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
    data: ROWS.map((r) => ({
      accountId: account.id,
      date: r.date,
      rawDescriptor: r.d,
      amountCents: r.cents,
      status: 'POSTED',
      needsReview: true,
    })),
  });
});

describe('previewKeywordRule', () => {
  it('counts exactly the rows the ENGINE would match — no more, no less', async () => {
    const preview = await previewKeywordRule({ keywordsRaw: 'mirko' });
    const expected = ROWS.filter((r) => keywordsMatch(['mirko'], r.d));
    expect(preview.keywords).toEqual(['mirko']);
    expect(preview.matchCount).toBe(expected.length);
    expect(preview.matchCount).toBe(3);
    // The word-sharing row is not swept in, and neither is the unrelated one.
    expect(preview.samples.map((s) => s.rawDescriptor)).not.toContain('PASTA HOUSE ATLANTA');
    expect(preview.samples.map((s) => s.rawDescriptor)).not.toContain('PUBLIX #1234');
  });

  it('returns nothing for an empty key rather than everything', async () => {
    const preview = await previewKeywordRule({ keywordsRaw: '   ,  ' });
    expect(preview.keywords).toEqual([]);
    expect(preview.matchCount).toBe(0);
  });

  it('separates "still unfiled" from "already filed elsewhere"', async () => {
    const rows = await prisma.transaction.findMany({ where: { account: { userId: USER } } });
    const one = rows.find((r) => r.rawDescriptor === 'MIRKO PASTA')!;
    await prisma.transaction.update({ where: { id: one.id }, data: { categoryId: 'groceries' } });
    const preview = await previewKeywordRule({ keywordsRaw: 'mirko', categoryId: 'dining' });
    expect(preview.matchCount).toBe(3);
    expect(preview.unfiledCount).toBe(2);
    expect(preview.alreadyFiledElsewhereCount).toBe(1);
  });
});

describe('createKeywordRule', () => {
  it('files exactly the previewed set, and every row is undoable', async () => {
    const preview = await previewKeywordRule({ keywordsRaw: 'mirko', categoryId: 'dining' });
    const res = await createKeywordRule({
      keywordsRaw: 'mirko',
      categoryId: 'dining',
      applyToExisting: true,
    });
    // THE PARITY CLAIM: the promise the preview made is the mutation that happened.
    expect(res.affected).toBe(preview.matchCount);
    expect(res.correctionIds).toHaveLength(preview.matchCount);

    const filed = await prisma.transaction.findMany({
      where: { account: { userId: USER }, categoryId: 'dining' },
      select: { rawDescriptor: true },
    });
    expect(filed.map((f) => f.rawDescriptor).sort()).toEqual(
      ['MIRKO PASTA', 'Mirko Pasta Buckhead', 'Tst*mirko Pasta Buckhead'].sort(),
    );
    // The row that merely shares a word is untouched.
    const untouched = await prisma.transaction.findFirst({
      where: { account: { userId: USER }, rawDescriptor: 'PASTA HOUSE ATLANTA' },
    });
    expect(untouched!.categoryId).toBeNull();
  });

  it('does NOT touch history unless asked', async () => {
    const res = await createKeywordRule({ keywordsRaw: 'mirko', categoryId: 'dining' });
    expect(res.affected).toBe(0);
    expect(await prisma.correction.count({ where: { userId: USER } })).toBe(0);
    expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(1);
  });

  it('REFUSES an empty key at the server boundary', async () => {
    await expect(createKeywordRule({ keywordsRaw: '  ', categoryId: 'dining' })).rejects.toThrow(
      /at least one keyword/i,
    );
    expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(0);
  });

  it('is loaded back as a live rule the pipeline can use', async () => {
    await createKeywordRule({ keywordsRaw: 'mirko pasta', categoryId: 'dining' });
    const loaded = await loadExplicitUserRules(USER);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.matchKeywords).toEqual(parseKeywords('mirko pasta'));
    expect(loaded[0]!.merchantCanonical).toBeNull();
    expect(loaded[0]!.priority).toBe(110);
  });
});

describe('the reader can see and remove what he wrote', () => {
  it('lists typed rules and deletes one without reverting its filings', async () => {
    const created = await createKeywordRule({
      keywordsRaw: 'mirko',
      categoryId: 'dining',
      applyToExisting: true,
    });
    expect((await listKeywordRules()).map((r) => r.keywords)).toEqual([['mirko']]);

    expect(await deleteKeywordRule(created.ruleId)).toEqual({ deleted: true });
    expect(await listKeywordRules()).toEqual([]);
    // Deleting a rule is a statement about the FUTURE. Silently re-uncategorizing
    // months of rows is the destructive reading, and it is not what happens.
    expect(
      await prisma.transaction.count({ where: { account: { userId: USER }, categoryId: 'dining' } }),
    ).toBe(3);
  });

  it('will not delete another user’s rule', async () => {
    const other = `${USER}-other`;
    await prisma.user.create({ data: { id: other, email: `${other}@test.local` } });
    const theirs = await prisma.categorizationRule.create({
      data: { userId: other, categoryId: 'dining', priority: 110, matchKeywords: 'mirko' },
    });
    expect(await deleteKeywordRule(theirs.id)).toEqual({ deleted: false });
    expect(await prisma.categorizationRule.findUnique({ where: { id: theirs.id } })).not.toBeNull();
    await prisma.categorizationRule.deleteMany({ where: { userId: other } });
    await prisma.user.deleteMany({ where: { id: other } });
  });
});
