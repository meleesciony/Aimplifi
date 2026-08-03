/**
 * Renaming a BUILT-IN category, per user (O.17) — the pure overlay and then the
 * real actions against throwaway data.
 *
 * The property under test is not "the name changed" but "the name changed
 * EVERYWHERE, and nothing else moved".
 *
 * The first version of this file claimed to assert "every read path" and
 * asserted the four loaders the author had just wired — while the REGISTER, the
 * transaction detail, split parts, the CSV importer and Ask were all still
 * printing the canonical name. Two independent critics found it; the file was
 * 16/16 green throughout. So the read paths below are enumerated from the
 * RENDERING backward, and each one names the surface it stands for. If you add a
 * surface that shows a category name, it belongs here — a list of readers is a
 * claim like any other.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import {
  CATEGORIES,
  CATEGORY_BY_ID,
  categoryName,
  isIncomeCategoryId,
  mergeCategoryMeta,
  MAX_CATEGORY_NAME,
} from '@/lib/engine/categorize/categories';
import {
  ASSIGNABLE_CATEGORIES,
  ASSIGNABLE_GROUPS,
  assignableCategories,
  assignableGroups,
} from '@/lib/engine/categorize/assign';
import { categoryCatalog, visibleGroups } from '@/lib/engine/categorize/visibility';
import { renameSystemCategory, resetSystemCategoryName } from '@/server/category-rename-actions';
import { createCustomCategory, deleteCustomCategory } from '@/server/custom-category-actions';
import { getTransactions, getTransactionDetail } from '@/server/transactions';
import { askVocabulary } from '@/lib/engine/categorize/categories';
import { parseAssistantQuery, resolveSpendTarget, validateIntent } from '@/lib/engine/assistant/intent';
import { DEMO_ENTRY_BLOCKED, DEMO_USER_ID } from '@/lib/demo-user';
import { setCategoryHidden } from '@/server/category-actions';
import { getCategoryCatalog, getVisibleCategories, getVisibleGroups } from '@/server/categories';
import { getCategoryMeta, getCategoryOverlay, getCategoryRenames } from '@/server/category-meta';
import { prisma } from '@/lib/db';

const RENAMES = (o: Record<string, string>) => new Map(Object.entries(o));

describe('rename overlay (pure)', () => {
  it('with no renames every builder returns the SAME array reference', () => {
    // The golden-safety property: a user with neither customs nor renames must
    // get byte-identical output, which reference equality proves outright.
    expect(assignableCategories([])).toBe(ASSIGNABLE_CATEGORIES);
    expect(assignableCategories([], new Map())).toBe(ASSIGNABLE_CATEGORIES);
    expect(assignableGroups([])).toBe(ASSIGNABLE_GROUPS);
    expect(assignableGroups([], new Map())).toBe(ASSIGNABLE_GROUPS);
  });

  it('renames in place: same length, same order, same ids, one new label', () => {
    const out = assignableCategories([], RENAMES({ doctor: 'Dr Visits' }));
    expect(out).toHaveLength(ASSIGNABLE_CATEGORIES.length);
    expect(out.map((c) => c.id)).toEqual(ASSIGNABLE_CATEGORIES.map((c) => c.id));
    expect(out.find((c) => c.id === 'doctor')?.name).toBe('Dr Visits');
    // Every other label is untouched.
    const changed = out.filter((c, i) => c.name !== ASSIGNABLE_CATEGORIES[i].name);
    expect(changed.map((c) => c.id)).toEqual(['doctor']);
  });

  it('does not mutate the shared static array', () => {
    assignableCategories([], RENAMES({ doctor: 'Dr Visits' }));
    expect(CATEGORY_BY_ID.get('doctor')?.name).toBe('Doctor');
    expect(ASSIGNABLE_CATEGORIES.find((c) => c.id === 'doctor')?.name).toBe('Doctor');
  });

  it('a rename cannot move a category between groups or flip discretionary', () => {
    const meta = mergeCategoryMeta([], RENAMES({ groceries: 'Food shop', paycheck: 'Wages' }));
    expect(meta.get('groceries')).toEqual({
      name: 'Food shop',
      group: 'Food & Dining',
      discretionary: false,
    });
    // Still income, because only the LABEL moved.
    expect(meta.get('paycheck')?.group).toBe('Income');
    expect(isIncomeCategoryId('paycheck')).toBe(true);
  });

  it('a custom category wins over a stale rename row carrying its id', () => {
    // Customs are renamed through their own row; a CategoryRename keyed to a
    // custom id must never rewrite it.
    const meta = mergeCategoryMeta(
      [{ id: 'cust_1', name: 'Golf', group: 'Entertainment', discretionary: true }],
      RENAMES({ cust_1: 'Stale' }),
    );
    expect(meta.get('cust_1')?.name).toBe('Golf');
  });

  it('the catalog carries the built-in name so the manager can offer a reset', () => {
    const cat = categoryCatalog([], RENAMES({ doctor: 'Dr Visits' }));
    const entries = cat.flatMap((g) => g.categories);
    const doctor = entries.find((c) => c.id === 'doctor');
    expect(doctor).toMatchObject({ name: 'Dr Visits', defaultName: 'Doctor', renamed: true });
    const dining = entries.find((c) => c.id === 'dining');
    expect(dining).toMatchObject({ name: 'Dining Out', defaultName: 'Dining Out', renamed: false });
  });

  it('a renamed category that is also hidden stays out of the pickers', () => {
    // Renaming must not resurrect a removed category.
    const groups = visibleGroups(['doctor'], [], RENAMES({ doctor: 'Dr Visits' }));
    const ids = groups.flatMap((g) => g.categories.map((c) => c.id));
    expect(ids).not.toContain('doctor');
  });
});

describe('system rename lifecycle (real actions, throwaway data)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `sys-rename-${stamp}`;
  const OTHER = `sys-rename-other-${stamp}`;

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.createMany({
      data: [
        { id: USER, email: `${USER}@test.local` },
        { id: OTHER, email: `${OTHER}@test.local` },
      ],
    });
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  afterAll(async () => {
    await wipe();
  });

  it('renames a built-in, and the picker read paths return the new name', async () => {
    expect(await renameSystemCategory({ categoryId: 'doctor', name: 'Dr Visits' })).toMatchObject({
      ok: true,
      name: 'Dr Visits',
    });

    const [meta, flat, groups, catalog] = await Promise.all([
      getCategoryMeta(USER),
      getVisibleCategories(USER),
      getVisibleGroups(USER),
      getCategoryCatalog(USER),
    ]);

    expect(categoryName('doctor', meta)).toBe('Dr Visits');
    expect(flat.find((c) => c.id === 'doctor')?.name).toBe('Dr Visits');
    expect(groups.flatMap((g) => g.categories).find((c) => c.id === 'doctor')?.name).toBe('Dr Visits');
    expect(
      catalog.flatMap((g) => g.categories).find((c) => c.id === 'doctor'),
    ).toMatchObject({ name: 'Dr Visits', defaultName: 'Doctor', renamed: true });
  });

  it('leaves every other category, and the global row, alone', async () => {
    const meta = await getCategoryMeta(USER);
    // Only one label differs from the built-in taxonomy.
    const differing = CATEGORIES.filter((c) => meta.get(c.id)?.name !== c.name).map((c) => c.id);
    expect(differing).toEqual(['doctor']);
    // The shared Category row is untouched — this is an overlay, not an edit.
    const row = await prisma.category.findUnique({ where: { id: 'doctor' } });
    if (row) expect(row.name).toBe('Doctor');
  });

  it('is private to the user who set it', async () => {
    expect(await getCategoryRenames(OTHER)).toEqual(new Map());
    vi.mocked(auth).mockResolvedValue({ user: { id: OTHER } } as never);
    const otherMeta = await getCategoryMeta(OTHER);
    expect(categoryName('doctor', otherMeta)).toBe('Doctor');
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  it('refuses a name that collides with another category the reader can see', async () => {
    expect(await renameSystemCategory({ categoryId: 'fuel', name: 'Dr Visits' })).toMatchObject({
      ok: false,
    });
    expect(await renameSystemCategory({ categoryId: 'fuel', name: 'groceries' })).toMatchObject({
      ok: false,
    });
    // …including one of their own custom categories.
    const custom = await createCustomCategory({
      name: `Sailing ${stamp}`,
      group: 'Entertainment',
      discretionary: true,
    });
    expect(custom.ok).toBe(true);
    expect(
      await renameSystemCategory({ categoryId: 'fuel', name: `sailing ${stamp}` }),
    ).toMatchObject({ ok: false });
    // The refusals changed nothing.
    expect(categoryName('fuel', await getCategoryMeta(USER))).toBe('Fuel');
  });

  it('refuses an empty name, an over-long one, and a category that is not renameable', async () => {
    expect(await renameSystemCategory({ categoryId: 'fuel', name: '   ' })).toMatchObject({ ok: false });
    expect(
      await renameSystemCategory({ categoryId: 'fuel', name: 'x'.repeat(MAX_CATEGORY_NAME + 1) }),
    ).toMatchObject({ ok: false });
    expect(await renameSystemCategory({ categoryId: 'uncategorized', name: 'Nope' })).toMatchObject({
      ok: false,
    });
    expect(await renameSystemCategory({ categoryId: 'no-such-id', name: 'Nope' })).toMatchObject({
      ok: false,
    });
    expect(await prisma.categoryRename.count({ where: { userId: USER, categoryId: 'fuel' } })).toBe(0);
  });

  it('renaming back to the built-in name resets rather than storing a no-op row', async () => {
    expect(await renameSystemCategory({ categoryId: 'doctor', name: 'Doctor' })).toMatchObject({
      ok: true,
    });
    expect(await prisma.categoryRename.count({ where: { userId: USER, categoryId: 'doctor' } })).toBe(0);
    const catalog = await getCategoryCatalog(USER);
    expect(
      catalog.flatMap((g) => g.categories).find((c) => c.id === 'doctor')?.renamed,
    ).toBe(false);
  });

  it('reset removes the override, and resetting an un-renamed category is a no-op', async () => {
    await renameSystemCategory({ categoryId: 'doctor', name: 'Dr Visits' });
    expect(await resetSystemCategoryName({ categoryId: 'doctor' })).toMatchObject({
      ok: true,
      name: 'Doctor',
    });
    expect(categoryName('doctor', await getCategoryMeta(USER))).toBe('Doctor');
    // Twice is still fine — the reader pressing Reset on an untouched row gets
    // success, not an error they would have to interpret.
    expect(await resetSystemCategoryName({ categoryId: 'doctor' })).toMatchObject({ ok: true });
  });

  it('a rename survives the category being removed and restored', async () => {
    await renameSystemCategory({ categoryId: 'doctor', name: 'Dr Visits' });
    await setCategoryHidden({ categoryId: 'doctor', hidden: true });
    expect((await getVisibleCategories(USER)).some((c) => c.id === 'doctor')).toBe(false);
    await setCategoryHidden({ categoryId: 'doctor', hidden: false });
    const flat = await getVisibleCategories(USER);
    expect(flat.find((c) => c.id === 'doctor')?.name).toBe('Dr Visits');
    await resetSystemCategoryName({ categoryId: 'doctor' });
  });


  it('THE REGISTER, the detail view and split parts use the new name', async () => {
    // The P0 both critics found independently. All three resolved their label
    // from the joined `Category.name`, which for a built-in is the GLOBAL
    // canonical name — so the row read "Doctor" while the picker inside that
    // same row read "Dr Visits". Reverting `categoryLabel` in
    // src/server/transactions.ts kills this test.
    const account = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'Checking', type: 'CHECKING', currentBalanceCents: 0 },
    });
    const parent = await prisma.transaction.create({
      data: {
        accountId: account.id,
        date: '2026-06-01',
        rawDescriptor: 'CITY MEDICAL',
        amountCents: -5000,
        status: 'POSTED',
        categoryId: 'doctor',
      },
    });
    await prisma.transaction.create({
      data: {
        accountId: account.id,
        date: '2026-06-01',
        rawDescriptor: 'CITY MEDICAL',
        amountCents: -2500,
        status: 'POSTED',
        categoryId: 'doctor',
        splitParentId: parent.id,
      },
    });

    await renameSystemCategory({ categoryId: 'doctor', name: 'Dr Visits' });

    const register = await getTransactions(USER, {});
    const row = register.rows.find((r) => r.id === parent.id);
    expect(row, 'the fixture row must be in the register').toBeDefined();
    expect(row?.categoryName).toBe('Dr Visits');

    const detail = await getTransactionDetail(USER, parent.id);
    expect(detail?.row.categoryName).toBe('Dr Visits');
    expect(detail?.parts.map((p) => p.categoryName)).toEqual(['Dr Visits']);

    await resetSystemCategoryName({ categoryId: 'doctor' });
    const after = await getTransactions(USER, {});
    expect(after.rows.find((r) => r.id === parent.id)?.categoryName).toBe('Doctor');

    await prisma.transaction.deleteMany({ where: { accountId: account.id } });
    await prisma.account.delete({ where: { id: account.id } });
  });

  it('Ask can be asked by the new name, and answers under it', async () => {
    await renameSystemCategory({ categoryId: 'doctor', name: 'Dr Visits' });
    const { custom, renames } = await getCategoryOverlay(USER);
    const spoken = askVocabulary(custom, renames);

    expect(resolveSpendTarget('spend on dr visits', spoken)).toMatchObject({
      type: 'category',
      categoryId: 'doctor',
      label: 'Dr Visits',
    });
    // And the headline label is re-derived as the READER's word. Reading the
    // static map first printed "You spent $X on Doctor" beside a top-categories
    // list that said "Dr Visits" — one reply, two names, one bucket.
    const parsed = parseAssistantQuery(
      'how much did i spend on dr visits this month',
      '2026-06-10' as Parameters<typeof parseAssistantQuery>[1],
      spoken,
    );
    expect(parsed.kind).toBe('spend_by_category');
    expect(validateIntent(parsed, spoken)).toMatchObject({
      target: { categoryId: 'doctor', label: 'Dr Visits' },
    });
    await resetSystemCategoryName({ categoryId: 'doctor' });
  });

  it('a rename outranks a built-in synonym for the same word', async () => {
    // The reader renamed Hobbies to "Gas". Asking about "gas" answered the FUEL
    // total — a different figure, under a word that on their own screens names
    // something else.
    await renameSystemCategory({ categoryId: 'hobbies', name: 'Gas' });
    const { custom, renames } = await getCategoryOverlay(USER);
    expect(resolveSpendTarget('how much on gas', askVocabulary(custom, renames))).toMatchObject({
      categoryId: 'hobbies',
      label: 'Gas',
    });
    // With no rename the synonym still wins — built-in behaviour is unchanged.
    expect(resolveSpendTarget('how much on gas', [])).toMatchObject({ categoryId: 'fuel' });
    await resetSystemCategoryName({ categoryId: 'hobbies' });
  });

  it('a custom may not take a renamed built-in name, and MAY take its freed one', async () => {
    await renameSystemCategory({ categoryId: 'groceries', name: 'Food shop' });
    // The name now on screen is spoken for...
    expect(
      await createCustomCategory({ name: 'Food shop', group: 'Shopping', discretionary: true }),
    ).toMatchObject({ ok: false });
    // ...and the built-in's ORIGINAL name is free, because nothing shows it now.
    const freed = await createCustomCategory({
      name: 'Groceries',
      group: 'Shopping',
      discretionary: true,
    });
    expect(freed.ok).toBe(true);
    const labels = (await getVisibleCategories(USER)).map((c) => c.name.toLowerCase());
    expect(labels.filter((n) => n === 'food shop')).toHaveLength(1);
    expect(labels.filter((n) => n === 'groceries')).toHaveLength(1);
    if (freed.id) await deleteCustomCategory({ id: freed.id });
    await resetSystemCategoryName({ categoryId: 'groceries' });
  });

  it('invisible characters cannot smuggle a duplicate name past the check', async () => {
    // Pixel-identical to a name already in the list, byte-different.
    const zeroWidth = 'Dining Out' + String.fromCodePoint(0x200b);
    expect(await renameSystemCategory({ categoryId: 'fuel', name: zeroWidth })).toMatchObject({
      ok: false,
    });
    // NFD "Cafe" + combining acute renders exactly as the NFC "Cafe" + acute.
    await renameSystemCategory({
      categoryId: 'hobbies',
      name: 'Cafe' + String.fromCodePoint(0x301),
    });
    expect(
      await renameSystemCategory({ categoryId: 'gifts', name: String.fromCodePoint(0x43, 0x61, 0x66, 0xe9) }),
    ).toMatchObject({ ok: false });
    await resetSystemCategoryName({ categoryId: 'hobbies' });
    // A NUL is accepted by SQLite and REJECTED by Postgres, so it must never be
    // stored: stripped here, which no production-only failure can then surprise us with.
    const nul = await renameSystemCategory({
      categoryId: 'fuel',
      name: 'Pe' + String.fromCodePoint(0) + 'trol',
    });
    expect(nul).toMatchObject({ ok: true, name: 'Petrol' });
    await resetSystemCategoryName({ categoryId: 'fuel' });
  });

  it('the length limit counts CODE POINTS, so emoji and CJK agree', async () => {
    const forty = String.fromCodePoint(0x1f600).repeat(MAX_CATEGORY_NAME);
    expect(await renameSystemCategory({ categoryId: 'fuel', name: forty })).toMatchObject({
      ok: true,
    });
    await resetSystemCategoryName({ categoryId: 'fuel' });
    const fortyOne = String.fromCodePoint(0x1f600).repeat(MAX_CATEGORY_NAME + 1);
    expect(await renameSystemCategory({ categoryId: 'fuel', name: fortyOne })).toMatchObject({
      ok: false,
    });
  });

  it('the shared demo row refuses a rename, and its reset stays open', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: DEMO_USER_ID } } as never);
    expect(await renameSystemCategory({ categoryId: 'doctor', name: 'Whatever' })).toMatchObject({
      ok: false,
      error: DEMO_ENTRY_BLOCKED,
    });
    expect(await prisma.categoryRename.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
    // A custom category is the same leak by another door, fenced in the same slice.
    expect(
      await createCustomCategory({ name: 'Whatever', group: 'Shopping', discretionary: true }),
    ).toMatchObject({ ok: false, error: DEMO_ENTRY_BLOCKED });
    // Reset carries no words of the visitor's, so it stays allowed.
    expect(await resetSystemCategoryName({ categoryId: 'doctor' })).toMatchObject({ ok: true });
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  it('deleting the user removes their renames (retention policy §3, one cascade)', async () => {
    await renameSystemCategory({ categoryId: 'doctor', name: 'Dr Visits' });
    expect(await prisma.categoryRename.count({ where: { userId: USER } })).toBeGreaterThan(0);
    await prisma.user.delete({ where: { id: USER } });
    expect(await prisma.categoryRename.count({ where: { userId: USER } })).toBe(0);
  });
});
