/**
 * The rule inventory through the server (TASKS O.13d / O.15 slice 3).
 *
 * `rule-inventory.test.ts` proves the pure shape. What a pure test cannot see is the
 * claim the PAGE makes to the reader — **every rule that files my money is on this
 * page** — because that claim is about two different database queries agreeing, and
 * before this slice they did not:
 *
 *   - the engine (`loadExplicitUserRules`) loaded EVERY stored rule;
 *   - the page listed only rows with a typed key.
 *
 * A rule minted by "Always" therefore filed money for as long as the account existed
 * while appearing on no screen, and `deleteKeywordRule`'s WHERE was scoped to the
 * same narrow subset, so it could not be removed anywhere either. These tests assert
 * the union of the two on-page lists against the set the categorizer actually loads,
 * over real rows, rather than arguing it in a comment.
 *
 * The delete tests are the other half: a rule you can see and cannot remove is the
 * same defect one screen later.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { isBuilderListed, isInventoryListed } from '@/lib/engine/categorize/rule-inventory';
import { deleteKeywordRule, listKeywordRules } from '@/server/keyword-rules';
import { deleteRule, listRuleInventory } from '@/server/rule-inventory';
import { loadExplicitUserRules } from '@/server/rules';
import { prisma } from '@/lib/db';

const USER = `inv-${Date.now()}-${process.pid}`;

async function wipe() {
  await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
  await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
}

/** The merchant rows "Always" keys a rule to. Shared across the suite, not per-user. */
let costcoId = '';

beforeAll(async () => {
  await wipe();
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  const costco = await prisma.merchant.upsert({
    where: { canonical: 'Costco' },
    update: {},
    create: { canonical: 'Costco' },
  });
  costcoId = costco.id;
});

afterAll(wipe);

beforeEach(async () => {
  vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
});

/** The gesture the inbox's "Always" button performs: a merchant-keyed rule, no typed key. */
async function mintAlwaysRule(categoryId = 'groceries') {
  return prisma.categorizationRule.create({
    data: { userId: USER, merchantId: costcoId, categoryId, priority: 100 },
  });
}

/** A typed rule as `createKeywordRule` stores one. */
async function mintTypedRule(keywords = 'costco gas', categoryId = 'dining') {
  return prisma.categorizationRule.create({
    data: { userId: USER, categoryId, priority: 110, matchKeywords: keywords },
  });
}

describe('listRuleInventory', () => {
  it('lists the "Always" rule that filed money on no screen before this slice', async () => {
    const rule = await mintAlwaysRule();

    const { entries } = await listRuleInventory();

    expect(entries.map((e) => e.id)).toEqual([rule.id]);
    expect(entries[0]).toMatchObject({
      origin: 'always',
      merchantCanonical: 'Costco',
      categoryId: 'groceries',
      active: true,
    });
    // The list it was missing from is still the list it does not belong to.
    expect(await listKeywordRules()).toEqual([]);
  });

  describe('the page shows exactly what the categorizer runs', () => {
    it('union of the two lists = the rules the engine loads; intersection is empty', async () => {
      const always = await mintAlwaysRule();
      const typed = await mintTypedRule();

      const { entries } = await listRuleInventory();
      const builderList = entries.filter(isBuilderListed).map((e) => e.id);
      const inventoryList = entries.filter(isInventoryListed).map((e) => e.id);

      // Disjoint: no rule is rendered twice.
      expect(builderList.filter((id) => inventoryList.includes(id))).toEqual([]);
      // Complete: nothing the engine runs is missing from the page. `loadExplicitUserRules`
      // is the SAME loader every ingest path and the triage suggester categorize through.
      const engineIds = new Set((await loadExplicitUserRules(USER)).map((r) => r.id));
      expect(new Set([...builderList, ...inventoryList])).toEqual(engineIds);
      expect(engineIds).toEqual(new Set([always.id, typed.id]));
    });

    it('the builder half is exactly what listKeywordRules renders', async () => {
      await mintAlwaysRule();
      const typed = await mintTypedRule();

      const { entries } = await listRuleInventory();

      expect(entries.filter(isBuilderListed).map((e) => e.id)).toEqual([typed.id]);
      expect((await listKeywordRules()).map((r) => r.id)).toEqual([typed.id]);
    });

    it('lists a rule the engine has STOPPED running — invisible AND undeletable before', async () => {
      const orphan = await prisma.categorizationRule.create({
        data: { userId: USER, merchantId: 'merchant-that-is-gone', categoryId: 'groceries', priority: 100 },
      });

      const { entries } = await listRuleInventory();

      expect(entries.map((e) => e.id)).toEqual([orphan.id]);
      expect(entries[0]).toMatchObject({ active: false, refusal: 'orphan-merchant' });
      // The engine agrees it files nothing — which is exactly why no screen showed it.
      expect(await loadExplicitUserRules(USER)).toEqual([]);
      // And it is on the half of the page that carries a delete control.
      expect(entries.filter(isInventoryListed).map((e) => e.id)).toEqual([orphan.id]);
    });
  });

  it('names the account a condition scopes to, by the name the reader gave it', async () => {
    const account = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'simplefin',
        providerRef: `${USER}-card`,
        name: 'Chase Freedom',
        displayName: 'Everyday card',
        type: 'CREDIT',
        currentBalanceCents: 0,
        currency: 'USD',
      },
    });
    await prisma.categorizationRule.create({
      data: {
        userId: USER,
        merchantId: costcoId,
        categoryId: 'groceries',
        priority: 100,
        accountId: account.id,
      },
    });

    const { entries, accountNameById } = await listRuleInventory();

    expect(entries[0].conditions.accountId).toBe(account.id);
    expect(accountNameById[account.id]).toBe('Everyday card');
  });

  it('returns nothing for the shared demo account — one visitor never sees the next visitor rules', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'user-demo' } } as never);

    await expect(listRuleInventory()).resolves.toEqual({
      entries: [],
      accountNameById: {},
      hasLearnedRules: false,
      // …and it says so, rather than letting the page promise a rule will appear:
      // nothing stops a demo visitor minting one, so that promise is disproved by
      // their own next click (critic P2-4).
      isDemo: true,
    });
  });

  it('is NOT the demo for a real signed-up account', async () => {
    // Asserted in both directions on purpose: with only the `true` case locked, a
    // hardcoded `isDemo: true` passed the whole suite, and every real user with no
    // rules would have been told the demo account is shared by everyone (cycle-2 F5).
    const view = await listRuleInventory();
    expect(view.isDemo).toBe(false);
  });

  describe('learned rules are reported as a FACT, not a count', () => {
    it('is false before the reader has corrected anything', async () => {
      const view = await listRuleInventory();
      expect(view.hasLearnedRules).toBe(false);
      // One payee taught the app is not "2 patterns" — the field that said so is gone.
      expect(view).not.toHaveProperty('learnedCount');
    });

    /**
     * The `true` path needs real corrections to exist, and without this test a
     * hardcoded `false` passes everything — silently removing the one paragraph where
     * the page admits its list is not everything filing your money (cycle-2 F6).
     */
    it('is true once corrections have taught the app a payee', async () => {
      const account = await prisma.account.create({
        data: {
          userId: USER,
          provider: 'simplefin',
          providerRef: `${USER}-learn`,
          name: 'Learner',
          type: 'CREDIT',
          currentBalanceCents: 0,
          currency: 'USD',
        },
      });
      for (const [i, amount] of [-3000, -3200].entries()) {
        const txn = await prisma.transaction.create({
          data: {
            accountId: account.id,
            date: `2026-06-0${i + 1}`,
            rawDescriptor: 'JOES PIZZA 123',
            amountCents: amount,
            status: 'POSTED',
          },
        });
        await prisma.correction.create({
          data: { userId: USER, transactionId: txn.id, fromCategoryId: null, toCategoryId: 'dining' },
        });
      }

      expect((await listRuleInventory()).hasLearnedRules).toBe(true);

      await prisma.correction.deleteMany({ where: { userId: USER } });
      await prisma.transaction.deleteMany({ where: { accountId: account.id } });
      await prisma.account.delete({ where: { id: account.id } });
    });
  });
});

describe('deleteRule', () => {
  it('removes the "Always" rule and stops it filing anything new', async () => {
    const rule = await mintAlwaysRule();
    expect((await loadExplicitUserRules(USER)).map((r) => r.id)).toEqual([rule.id]);

    await expect(deleteRule(rule.id)).resolves.toEqual({ deleted: true });

    expect(await loadExplicitUserRules(USER)).toEqual([]);
    expect((await listRuleInventory()).entries).toEqual([]);
  });

  it('deletes a rule the engine had already stopped running', async () => {
    const orphan = await prisma.categorizationRule.create({
      data: { userId: USER, merchantId: 'merchant-that-is-gone', categoryId: 'groceries', priority: 100 },
    });

    await expect(deleteRule(orphan.id)).resolves.toEqual({ deleted: true });
    expect((await listRuleInventory()).entries).toEqual([]);
  });

  /**
   * THE INVARIANT, and the critic finding that produced it (P1-1). The first version
   * scoped this delete to merchant-keyed rows — `matchKeywords: null` — which the
   * inventory list does not: it also renders a TYPED rule whose key decoded to
   * nothing. `''` is not `null`, so the WHERE matched no rows, the action returned
   * `{ deleted: false }` WITHOUT throwing, and the button spun and did nothing beside
   * copy that said "Delete it and write the rule again". Visible and undeletable is
   * the same dead end this slice exists to close.
   */
  describe('every rule the inventory renders is deleted by the button it renders', () => {
    it('a typed rule whose key decoded to nothing — the row that broke the first version', async () => {
      const rotted = await prisma.categorizationRule.create({
        data: { userId: USER, categoryId: 'groceries', priority: 110, matchKeywords: '' },
      });
      const { entries } = await listRuleInventory();
      // It is on the inventory half of the page (the builder's list drops it), so the
      // button the reader can reach is this action.
      expect(entries.filter(isInventoryListed).map((e) => e.id)).toEqual([rotted.id]);

      await expect(deleteRule(rotted.id)).resolves.toEqual({ deleted: true });
      expect((await listRuleInventory()).entries).toEqual([]);
    });

    it('holds for every row the list renders, whatever its kind', async () => {
      await mintAlwaysRule();
      await prisma.categorizationRule.create({
        data: { userId: USER, merchantId: 'merchant-that-is-gone', categoryId: 'groceries', priority: 100 },
      });
      await prisma.categorizationRule.create({
        data: { userId: USER, categoryId: 'groceries', priority: 110, matchKeywords: '' },
      });
      await mintTypedRule(); // builder-listed: NOT this list's to delete

      const rendered = (await listRuleInventory()).entries.filter(isInventoryListed);
      expect(rendered).toHaveLength(3);
      for (const e of rendered) {
        await expect(deleteRule(e.id)).resolves.toEqual({ deleted: true });
      }
      expect((await listRuleInventory()).entries.filter(isInventoryListed)).toEqual([]);
    });

    it('the typed-rule delete still refuses an "Always" rule, so the builder list cannot reach one', async () => {
      const always = await mintAlwaysRule();

      await expect(deleteKeywordRule(always.id)).resolves.toEqual({ deleted: false });

      expect((await listRuleInventory()).entries.map((e) => e.id)).toEqual([always.id]);
    });
  });

  it('never deletes another account rule, even with a valid id', async () => {
    const other = `${USER}-other`;
    await prisma.user.create({ data: { id: other, email: `${other}@test.local` } });
    const theirs = await prisma.categorizationRule.create({
      data: { userId: other, merchantId: costcoId, categoryId: 'groceries', priority: 100 },
    });

    await expect(deleteRule(theirs.id)).resolves.toEqual({ deleted: false });

    expect(await prisma.categorizationRule.findUnique({ where: { id: theirs.id } })).not.toBeNull();
    await prisma.categorizationRule.deleteMany({ where: { userId: other } });
    await prisma.user.deleteMany({ where: { id: other } });
  });

  it('is refused on the shared demo account', async () => {
    const rule = await mintAlwaysRule();
    vi.mocked(auth).mockResolvedValue({ user: { id: 'user-demo' } } as never);

    await expect(deleteRule(rule.id)).rejects.toThrow();
  });
});
