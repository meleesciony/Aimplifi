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
  updateKeywordRule,
} from '@/server/keyword-rules';
import { loadExplicitUserRules } from '@/server/rules';
import { undoCorrections } from '@/server/triage-actions';
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
    expect(preview.groups).toEqual([['mirko']]);
    expect(preview.matchCount).toBe(expected.length);
    expect(preview.matchCount).toBe(3);
    // The word-sharing row is not swept in, and neither is the unrelated one.
    expect(preview.samples.map((s) => s.rawDescriptor)).not.toContain('PASTA HOUSE ATLANTA');
    expect(preview.samples.map((s) => s.rawDescriptor)).not.toContain('PUBLIX #1234');
  });

  it('returns nothing for an empty key rather than everything', async () => {
    const preview = await previewKeywordRule({ keywordsRaw: '   ,  ' });
    expect(preview.groups).toEqual([]);
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
    // The WORDING changed deliberately in the critic pass: the old message told the
    // reader an empty rule "would match every transaction", which is the RATIONALE
    // for the guard, not the behaviour — `keywordsMatch([])` returns false, so an
    // empty key matches NOTHING. This assertion moved with the sentence.
    await expect(createKeywordRule({ keywordsRaw: '  ', categoryId: 'dining' })).rejects.toThrow(
      /at least one word/i,
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
    expect((await listKeywordRules()).map((r) => r.groups)).toEqual([[['mirko']]]);

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


/**
 * O.13c — the Simplifi-parity surface: OR-groups, rename payee, account and
 * amount conditions, and edit-in-place. Same discipline as above: the preview's
 * promise and the write's effect are asserted to be the SAME set, and the
 * bank's own text is asserted untouched by a rename.
 */
describe('OR-groups through the server (O.13c)', () => {
  it('previews and files the union of the groups, still excluding word-sharers', async () => {
    const preview = await previewKeywordRule({ keywordsRaw: 'buckhead | mirko pasta' });
    expect(preview.groups).toEqual([['buckhead'], ['mirko', 'pasta']]);
    expect(preview.matchCount).toBe(3); // the three Mirko rows; PASTA HOUSE shares only a word

    const res = await createKeywordRule({
      keywordsRaw: 'buckhead | mirko pasta',
      categoryId: 'dining',
      applyToExisting: true,
    });
    expect(res.affected).toBe(3);
    const loaded = await loadExplicitUserRules(USER);
    // One stored rule, one RuleLike per group, sharing the id.
    expect(loaded).toHaveLength(2);
    expect(new Set(loaded.map((r) => r.id)).size).toBe(1);
  });

  it('enforces the length floor on EVERY group', async () => {
    await expect(
      createKeywordRule({ keywordsRaw: 'mirko | at', categoryId: 'dining' }),
    ).rejects.toThrow(/at least 3 letters/i);
    expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(0);
  });
});

describe('rename payee through the server (O.13c)', () => {
  it('applies the rename to every matched row, keeps the raw text, and survives reload', async () => {
    const res = await createKeywordRule({
      keywordsRaw: 'mirko',
      categoryId: 'dining',
      renameTo: 'Mirko Pasta',
      applyToExisting: true,
    });
    expect(res.renamed).toBe(3);
    const merchant = await prisma.merchant.findUnique({ where: { canonical: 'Mirko Pasta' } });
    expect(merchant).not.toBeNull();
    const rows = await prisma.transaction.findMany({
      where: { account: { userId: USER }, merchantId: merchant!.id },
      select: { rawDescriptor: true },
    });
    // All three variants grouped under the one payee the reader named…
    expect(rows).toHaveLength(3);
    // …and the bank's text is still the permanent record on each row.
    expect(rows.map((r) => r.rawDescriptor).sort()).toEqual(
      ['MIRKO PASTA', 'Mirko Pasta Buckhead', 'Tst*mirko Pasta Buckhead'].sort(),
    );
    // The rename is loaded back onto the live rule for FUTURE rows too.
    const loaded = await loadExplicitUserRules(USER);
    expect(loaded[0]!.renameTo).toBe('Mirko Pasta');
    expect((await listKeywordRules())[0]!.renameTo).toBe('Mirko Pasta');
  });

  it('does not rename history unless asked, and blank means no rename', async () => {
    const res = await createKeywordRule({ keywordsRaw: 'mirko', categoryId: 'dining', renameTo: '  ' });
    expect(res.renamed).toBe(0);
    expect(res.renameTo).toBeNull();
    expect(
      await prisma.transaction.count({
        where: { account: { userId: USER }, NOT: { merchantId: null } },
      }),
    ).toBe(0);
  });
});

describe('account and amount conditions (O.13c)', () => {
  it('scopes preview AND write to the chosen account — one shared basis', async () => {
    const acct = await prisma.account.findFirstOrThrow({ where: { userId: USER } });
    const other = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'simplefin',
        providerRef: `${USER}-other-acct`,
        name: 'Other Card',
        type: 'CREDIT',
        currentBalanceCents: 0,
        currency: 'USD',
      },
    });
    await prisma.transaction.create({
      data: {
        accountId: other.id,
        date: '2026-07-01',
        rawDescriptor: 'MIRKO PASTA MIDTOWN',
        amountCents: -6000,
        status: 'POSTED',
        needsReview: true,
      },
    });
    const scoped = await previewKeywordRule({ keywordsRaw: 'mirko', accountId: acct.id });
    expect(scoped.matchCount).toBe(3);
    const res = await createKeywordRule({
      keywordsRaw: 'mirko',
      categoryId: 'dining',
      accountId: acct.id,
      applyToExisting: true,
    });
    expect(res.affected).toBe(3);
    const untouched = await prisma.transaction.findFirstOrThrow({
      where: { accountId: other.id },
    });
    expect(untouched.categoryId).toBeNull();
  });

  it("refuses another user's account id", async () => {
    const other = `${USER}-acct-owner`;
    await prisma.user.create({ data: { id: other, email: `${other}@test.local` } });
    const theirs = await prisma.account.create({
      data: {
        userId: other,
        provider: 'simplefin',
        providerRef: `${other}-card`,
        name: 'Their Card',
        type: 'CREDIT',
        currentBalanceCents: 0,
        currency: 'USD',
      },
    });
    await expect(
      previewKeywordRule({ keywordsRaw: 'mirko', accountId: theirs.id }),
    ).rejects.toThrow(/account/i);
    await prisma.account.deleteMany({ where: { userId: other } });
    await prisma.user.deleteMany({ where: { id: other } });
  });

  it('bands the match on the amount MAGNITUDE, in preview and write alike', async () => {
    // Rows are -121.25, -44.00, -88.00; a $50–$100 band keeps exactly one.
    const preview = await previewKeywordRule({
      keywordsRaw: 'mirko',
      minAmountRaw: '$50',
      maxAmountRaw: '100',
    });
    expect(preview.matchCount).toBe(1);
    const res = await createKeywordRule({
      keywordsRaw: 'mirko',
      categoryId: 'dining',
      minAmountRaw: '$50',
      maxAmountRaw: '100',
      applyToExisting: true,
    });
    expect(res.affected).toBe(1);
    const filed = await prisma.transaction.findFirstOrThrow({
      where: { account: { userId: USER }, categoryId: 'dining' },
    });
    expect(filed.amountCents).toBe(-8800);
    // And the band is live on the loaded rule for future rows.
    const loaded = await loadExplicitUserRules(USER);
    expect(loaded[0]!.minAmountCents).toBe(5000);
    expect(loaded[0]!.maxAmountCents).toBe(10000);
  });

  it('refuses a nonsense band rather than storing it silently', async () => {
    await expect(
      previewKeywordRule({ keywordsRaw: 'mirko', minAmountRaw: '100', maxAmountRaw: '50' }),
    ).rejects.toThrow(/minimum amount is larger/i);
    await expect(
      previewKeywordRule({ keywordsRaw: 'mirko', minAmountRaw: 'abc' }),
    ).rejects.toThrow(/positive dollar/i);
  });
});

describe('updateKeywordRule — edit in place (O.13c)', () => {
  it('changes the key, category, and rename without minting a second rule', async () => {
    const created = await createKeywordRule({ keywordsRaw: 'mirko', categoryId: 'dining' });
    const res = await updateKeywordRule(created.ruleId, {
      keywordsRaw: 'mirko pasta | buckhead',
      categoryId: 'groceries',
      renameTo: 'Mirko',
      applyToExisting: true,
    });
    expect(res.ruleId).toBe(created.ruleId);
    expect(res.affected).toBe(3);
    expect(res.renamed).toBe(3);
    expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(1);
    const listed = await listKeywordRules();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.groups).toEqual([['mirko', 'pasta'], ['buckhead']]);
    expect(listed[0]!.categoryId).toBe('groceries');
    expect(listed[0]!.renameTo).toBe('Mirko');
  });

  /**
   * CRITIC CYCLE 1, P1-1. `undoCorrections` deletes the rule whose `createdFrom`
   * still points at the correction being undone — correct for a rule that
   * correction MINTED, catastrophic for one that was merely EDITED. Before the fix,
   * edit → apply → "Undo those N" deleted a rule the reader only meant to change,
   * with a toast that said only "those transactions are back", and the builder's
   * optimistic list kept rendering the rule that no longer existed.
   */
  it('undoing an EDIT’s re-apply restores the rows and LEAVES THE RULE ALIVE', async () => {
    const created = await createKeywordRule({
      keywordsRaw: 'mirko',
      categoryId: 'dining',
      applyToExisting: true,
    });
    expect(created.affected).toBe(3);

    // Edit it, re-applying to history — this must NOT re-claim the undo lineage.
    const edited = await updateKeywordRule(created.ruleId, {
      keywordsRaw: 'mirko',
      categoryId: 'groceries',
      applyToExisting: true,
    });
    expect(edited.affected).toBe(3);
    const ruleRow = await prisma.categorizationRule.findUnique({ where: { id: created.ruleId } });
    // Lineage still names the CREATE's correction, not the edit's.
    expect(created.correctionIds).toContain(ruleRow!.createdFrom);
    expect(edited.correctionIds).not.toContain(ruleRow!.createdFrom);

    await undoCorrections(edited.correctionIds);

    // The rows went back to what the create had filed them as…
    const rows = await prisma.transaction.findMany({
      where: { account: { userId: USER }, rawDescriptor: { contains: 'irko' } },
      select: { categoryId: true },
    });
    expect(rows.every((r) => r.categoryId === 'dining')).toBe(true);
    // …and the rule the reader only EDITED is still there.
    expect(await prisma.categorizationRule.count({ where: { id: created.ruleId } })).toBe(1);
    expect(await listKeywordRules()).toHaveLength(1);
  });

  /**
   * CRITIC CYCLE 1, P1-3. A rename is not just a label: `merchantId` is the batch
   * key `similarTransactionsWhere` uses, and `recategorize({scope:'merchant'})`
   * re-files ALREADY-FILED rows in that batch. Renaming a sign-refused outflow into
   * an income payee's group builds a mixed-sign group in which one later "file all
   * similar" turns real deposits into spend. It also made the two rename paths
   * contradict each other — `categorize` renames only a rule that actually filed.
   */
  it('does NOT rename a row the sign guard refused to file', async () => {
    const account = await prisma.account.findFirstOrThrow({ where: { userId: USER } });
    await prisma.transaction.create({
      data: {
        accountId: account.id,
        date: '2026-07-01',
        rawDescriptor: 'CARDONE MGMT FEE',
        amountCents: -12500,
        status: 'POSTED',
        needsReview: true,
      },
    });
    await prisma.transaction.create({
      data: {
        accountId: account.id,
        date: '2026-07-02',
        rawDescriptor: 'Cardone Eq Fund Cef Xv',
        amountCents: 37500,
        status: 'POSTED',
        needsReview: true,
      },
    });

    const res = await createKeywordRule({
      keywordsRaw: 'cardone',
      categoryId: 'investment-income',
      renameTo: 'Cardone',
      applyToExisting: true,
    });
    expect(res.affected).toBe(1); // the deposit only
    expect(res.skippedWrongSign).toBe(1); // the fee, left alone
    expect(res.renamed).toBe(1); // …and NOT renamed either

    const fee = await prisma.transaction.findFirstOrThrow({
      where: { account: { userId: USER }, rawDescriptor: 'CARDONE MGMT FEE' },
      select: { merchantId: true, categoryId: true },
    });
    expect(fee.merchantId).toBeNull();
    const deposit = await prisma.transaction.findFirstOrThrow({
      where: { account: { userId: USER }, rawDescriptor: 'Cardone Eq Fund Cef Xv' },
      select: { merchant: { select: { canonical: true } } },
    });
    expect(deposit.merchant?.canonical).toBe('Cardone');
  });

  /** Critic P2-9: the count must be rows CHANGED, not rows matched. */
  it('reports 0 renamed when a re-apply changes no payee', async () => {
    const created = await createKeywordRule({
      keywordsRaw: 'mirko',
      categoryId: 'dining',
      renameTo: 'Mirko Pasta',
      applyToExisting: true,
    });
    expect(created.renamed).toBe(3);
    const again = await updateKeywordRule(created.ruleId, {
      keywordsRaw: 'mirko',
      categoryId: 'dining',
      renameTo: 'Mirko Pasta',
      applyToExisting: true,
    });
    expect(again.renamed).toBe(0);
  });

  it("will not edit another user's rule, or a merchant-keyed one", async () => {
    const other = `${USER}-edit-owner`;
    await prisma.user.create({ data: { id: other, email: `${other}@test.local` } });
    const theirs = await prisma.categorizationRule.create({
      data: { userId: other, categoryId: 'dining', priority: 110, matchKeywords: 'mirko' },
    });
    await expect(
      updateKeywordRule(theirs.id, { keywordsRaw: 'mirko', categoryId: 'groceries' }),
    ).rejects.toThrow(/wasn/i);
    const merchantKeyed = await prisma.categorizationRule.create({
      data: { userId: USER, categoryId: 'dining', priority: 100 },
    });
    await expect(
      updateKeywordRule(merchantKeyed.id, { keywordsRaw: 'mirko', categoryId: 'groceries' }),
    ).rejects.toThrow(/wasn/i);
    await prisma.categorizationRule.deleteMany({ where: { userId: other } });
    await prisma.user.deleteMany({ where: { id: other } });
  });
});

/**
 * THE OUTLIER GUARD (owner, 2026-07-30, mid-session):
 *
 *   "Rules are great but occasionally we may change a single transaction
 *    (outlier) for a diff category. Keep that intact."
 *
 * He was right that this was exposed, and the asymmetry is the evidence: the sync
 * path has always preserved a hand-filed row (`simplefin.ts`: `corrected &&
 * !fresh.needsReview` → write bank facts only) and `runBackfillForUser` never
 * touches a decided row at all. The keyword-rule apply had NEITHER guard — it
 * filtered on "already the target category" and the sign check and nothing else —
 * so one tick of "apply to existing" re-filed every outlier he had decided by
 * hand, on a rule that is correct about all the other rows.
 *
 * These tests fail against that behaviour: the hand-filed row comes back with the
 * rule's category instead of his own.
 */
describe('a hand-filed outlier survives apply-to-existing', () => {
  /** File one row the way the register's "just this once" does: category + Correction. */
  async function handFile(rawDescriptor: string, categoryId: string) {
    const row = await prisma.transaction.findFirstOrThrow({
      where: { account: { userId: USER }, rawDescriptor },
    });
    await prisma.transaction.update({
      where: { id: row.id },
      data: { categoryId, needsReview: false, confidenceBps: 9900 },
    });
    await prisma.correction.create({
      data: {
        userId: USER,
        transactionId: row.id,
        fromCategoryId: null,
        toCategoryId: categoryId,
      },
    });
    return row.id;
  }

  it('leaves the reader’s own category on the row he decided', async () => {
    const outlierId = await handFile('MIRKO PASTA', 'groceries');
    const res = await createKeywordRule({
      keywordsRaw: 'mirko',
      categoryId: 'dining',
      applyToExisting: true,
    });
    const outlier = await prisma.transaction.findUniqueOrThrow({ where: { id: outlierId } });
    expect(outlier.categoryId).toBe('groceries');
    // The other two matching rows DID get filed — the rule still works.
    expect(res.affected).toBe(2);
    expect(res.preservedHandFiled).toBe(1);
  });

  it('says so in the preview, and the count it promises is the count it writes', async () => {
    await handFile('MIRKO PASTA', 'groceries');
    const preview = await previewKeywordRule({ keywordsRaw: 'mirko', categoryId: 'dining' });
    expect(preview.matchCount).toBe(3);
    expect(preview.handFiledCount).toBe(1);
    // The file's core invariant: what the preview promised is what the apply wrote.
    expect(preview.wouldFileCount).toBe(2);
    const res = await createKeywordRule({
      keywordsRaw: 'mirko',
      categoryId: 'dining',
      applyToExisting: true,
    });
    expect(res.affected).toBe(preview.wouldFileCount);
  });

  it('still answers a row the app has re-opened for review, decided or not', async () => {
    // `corrected && !needsReview` is the sync path's predicate, copied verbatim: a
    // row the app put BACK in review is undecided again, and the rule may answer
    // it. Using "a Correction exists" alone would freeze such a row forever.
    const id = await handFile('MIRKO PASTA', 'groceries');
    await prisma.transaction.update({ where: { id }, data: { needsReview: true } });
    const res = await createKeywordRule({
      keywordsRaw: 'mirko',
      categoryId: 'dining',
      applyToExisting: true,
    });
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(row.categoryId).toBe('dining');
    expect(res.preservedHandFiled).toBe(0);
    expect(res.affected).toBe(3);
  });

  it('does not freeze a row whose only Correction belongs to ANOTHER user', async () => {
    // Ownership: `handFiledIds` scopes by userId, so a foreign correction row can
    // never make this reader's transaction unwritable.
    const row = await prisma.transaction.findFirstOrThrow({
      where: { account: { userId: USER }, rawDescriptor: 'MIRKO PASTA' },
    });
    const other = `${USER}-other`;
    await prisma.user.create({ data: { id: other, email: `${other}@test.local` } });
    await prisma.transaction.update({
      where: { id: row.id },
      data: { categoryId: 'groceries', needsReview: false },
    });
    await prisma.correction.create({
      data: {
        userId: other,
        transactionId: row.id,
        fromCategoryId: null,
        toCategoryId: 'groceries',
      },
    });
    try {
      const res = await createKeywordRule({
        keywordsRaw: 'mirko',
        categoryId: 'dining',
        renameTo: '',
        accountId: null,
        minAmountRaw: '',
        maxAmountRaw: '',
        applyToExisting: true,
      });
      expect(res.preservedHandFiled).toBe(0);
      expect(
        (await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } })).categoryId,
      ).toBe('dining');
    } finally {
      await prisma.correction.deleteMany({ where: { userId: other } });
      await prisma.user.deleteMany({ where: { id: other } });
    }
  });
});
