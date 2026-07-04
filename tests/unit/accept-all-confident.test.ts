/**
 * "Accept all confident" — drain the review pile in one action (DECISIONS #162).
 *
 * Pure: selectConfidentGroups / summarizeConfident partition groups on the honest
 * unanimous suggestion (suggestedCategoryId !== null) — the exact bar swipe-right uses.
 *
 * Integration (throwaway users): acceptAllConfident files EVERY confident group to
 * its OWN suggestion via the tested fileMerchantGroup path (per-group commit, rule
 * mint/reuse, aggregate handling), leaves the ambiguous groups queued, and returns
 * the fresh remaining queue + the aggregated correctionIds for a SINGLE undo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { DEMO_USER_ID } from '@/auth.config';
import { isConfidentGroup, selectConfidentGroups, summarizeConfident } from '@/lib/engine/categorize/group';
import { getTriageGroups } from '@/server/triage';
import { acceptAllConfident, undoCorrections } from '@/server/triage-actions';
import { prisma } from '@/lib/db';

describe('confident-group selection (pure)', () => {
  const g = (suggestedCategoryId: string | null, count: number) => ({ suggestedCategoryId, count });

  it('isConfidentGroup: a non-null suggestion is confident, null is not', () => {
    expect(isConfidentGroup(g('coffee', 3))).toBe(true);
    expect(isConfidentGroup(g(null, 3))).toBe(false);
  });

  it('selectConfidentGroups: keeps only suggested groups, preserving order', () => {
    const groups = [g('coffee', 3), g(null, 2), g('entertainment', 1), g(null, 5)];
    expect(selectConfidentGroups(groups)).toEqual([g('coffee', 3), g('entertainment', 1)]);
  });

  it('selectConfidentGroups: all-ambiguous → [], empty → []', () => {
    expect(selectConfidentGroups([g(null, 1), g(null, 9)])).toEqual([]);
    expect(selectConfidentGroups([])).toEqual([]);
  });

  it('summarizeConfident: counts merchants (groups) and total transactions', () => {
    expect(summarizeConfident([g('coffee', 3), g(null, 2), g('entertainment', 1)])).toEqual({
      merchants: 2,
      transactions: 4,
    });
    expect(summarizeConfident([g(null, 2), g(null, 5)])).toEqual({ merchants: 0, transactions: 0 });
  });
});

describe('acceptAllConfident (integration)', () => {
  const USER = `acc-${Date.now()}-${process.pid}`;
  const OTHER = `acc-other-${Date.now()}-${process.pid}`;
  const NETFLIX_CANONICAL = `Aimplifi Test Netflix ${process.pid}`;
  let MERCH_SEAWOLF = '';
  let MERCH_NETFLIX = '';
  let MERCH_ZELLE = '';

  async function wipe() {
    await prisma.correction.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    await prisma.categorizationRule.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    await prisma.categoryPrediction.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    await prisma.account.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    // Custom categories these tests mint (userId set) — delete AFTER their rules.
    await prisma.category.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    // Seawolf + our Netflix are test-only; Zelle stays (seed-owned canonical).
    await prisma.merchant.deleteMany({ where: { canonical: { in: ['Seawolf Bakers', NETFLIX_CANONICAL] } } });
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
    MERCH_SEAWOLF = (
      await prisma.merchant.upsert({
        where: { canonical: 'Seawolf Bakers' },
        create: { id: `acc-merch-seawolf-${process.pid}`, canonical: 'Seawolf Bakers' },
        update: {},
      })
    ).id;
    // Native categorization keys on the rawDescriptor ('NETFLIX'), not the Merchant
    // row — so a test-scoped canonical stays natively confident AND wipes cleanly.
    MERCH_NETFLIX = (
      await prisma.merchant.upsert({
        where: { canonical: NETFLIX_CANONICAL },
        create: { id: `acc-merch-netflix-${process.pid}`, canonical: NETFLIX_CANONICAL },
        update: {},
      })
    ).id;
    MERCH_ZELLE = (
      await prisma.merchant.upsert({
        where: { canonical: 'Zelle Payment' },
        create: { id: `acc-merch-zelle-${process.pid}`, canonical: 'Zelle Payment' },
        update: {},
      })
    ).id;
  });
  afterAll(wipe);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    await prisma.correction.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    await prisma.categorizationRule.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    await prisma.categoryPrediction.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    await prisma.account.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    await prisma.category.deleteMany({ where: { userId: { in: [USER, OTHER] } } });

    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'simplefin', providerRef: 'acc-chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 100_000, currency: 'USD' },
    });
    // Default: everything AMBIGUOUS. Seawolf is an unknown merchant (null suggestion
    // until a rule exists); Zelle is an aggregate (never a suggestion). Tests opt into
    // confidence by adding a Seawolf rule and/or the natively-known Netflix rows.
    await prisma.transaction.createMany({
      data: [
        { id: `acc-s1-${process.pid}`, accountId: acct.id, date: '2026-06-09', amountCents: -1200, rawDescriptor: 'SQ *SEAWOLF BAKERS', merchantId: MERCH_SEAWOLF, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `acc-s2-${process.pid}`, accountId: acct.id, date: '2026-06-08', amountCents: -950, rawDescriptor: 'SQ *SEAWOLF BAKERS SEATTLE WA', merchantId: MERCH_SEAWOLF, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `acc-s3-${process.pid}`, accountId: acct.id, date: '2026-06-01', amountCents: -1500, rawDescriptor: 'SQ *SEAWOLF BAKERS', merchantId: MERCH_SEAWOLF, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `acc-z1-${process.pid}`, accountId: acct.id, date: '2026-06-07', amountCents: -92500, rawDescriptor: 'ZELLE PAYMENT TO MARCUS CHEN', merchantId: MERCH_ZELLE, categoryId: 'uncategorized', confidenceBps: 4000, needsReview: true },
        { id: `acc-z2-${process.pid}`, accountId: acct.id, date: '2026-05-07', amountCents: -92500, rawDescriptor: 'ZELLE PAYMENT TO MARCUS CHEN', merchantId: MERCH_ZELLE, categoryId: 'uncategorized', confidenceBps: 4000, needsReview: true },
      ],
    });
  });

  /** Make Seawolf confident (rule PRE-EXISTS → reused) and add the natively-confident
   *  Netflix group (no rule → acceptAll MINTS one). Returns the Netflix row ids. */
  async function makeTwoConfidentGroups() {
    await prisma.categorizationRule.create({
      data: { userId: USER, merchantId: MERCH_SEAWOLF, categoryId: 'coffee', priority: 100 },
    });
    const acct = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'acc-chk' } });
    await prisma.transaction.createMany({
      data: [
        { id: `acc-n1-${process.pid}`, accountId: acct.id, date: '2026-06-06', amountCents: -1599, rawDescriptor: 'NETFLIX', merchantId: MERCH_NETFLIX, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `acc-n2-${process.pid}`, accountId: acct.id, date: '2026-05-06', amountCents: -1599, rawDescriptor: 'NETFLIX', merchantId: MERCH_NETFLIX, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
      ],
    });
  }

  it('files every confident group to its own suggestion; leaves the ambiguous ones', async () => {
    await makeTwoConfidentGroups();
    // Precondition: exactly the two confident groups + the one ambiguous Zelle group.
    const before = await getTriageGroups(USER);
    expect(selectConfidentGroups(before).map((g) => g.merchantCanonical).sort()).toEqual(
      [NETFLIX_CANONICAL, 'Seawolf Bakers'].sort(),
    );

    const res = await acceptAllConfident();
    expect(res.merchantsFiled).toBe(2);
    expect(res.affected).toBe(5); // Seawolf ×3 + Netflix ×2
    expect(res.correctionIds).toHaveLength(5);
    // Only the ambiguous Zelle group remains, and it is genuinely ambiguous.
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].variants).toContain('ZELLE PAYMENT TO MARCUS CHEN');
    expect(res.groups[0].suggestedCategoryId).toBeNull();

    // Seawolf filed to its suggestion (coffee), none left in review.
    const seawolf = await prisma.transaction.findMany({ where: { merchantId: MERCH_SEAWOLF, account: { userId: USER } } });
    for (const r of seawolf) {
      expect(r.categoryId).toBe('coffee');
      expect(r.needsReview).toBe(false);
    }
    // Netflix filed to its native suggestion (entertainment).
    const netflix = await prisma.transaction.findMany({ where: { merchantId: MERCH_NETFLIX, account: { userId: USER } } });
    for (const r of netflix) {
      expect(r.categoryId).toBe('entertainment');
      expect(r.needsReview).toBe(false);
    }
    // Zelle untouched.
    const zelle = await prisma.transaction.findMany({ where: { merchantId: MERCH_ZELLE, account: { userId: USER } } });
    for (const r of zelle) {
      expect(r.needsReview).toBe(true);
      expect(r.categoryId).toBe('uncategorized');
    }
  });

  it('mints a rule for a rule-eligible confident group with no prior rule; reuses a pre-existing one', async () => {
    await makeTwoConfidentGroups();
    await acceptAllConfident();
    // Netflix had NO rule → acceptAll minted one (future Netflix auto-files).
    const netflixRules = await prisma.categorizationRule.findMany({ where: { userId: USER, merchantId: MERCH_NETFLIX } });
    expect(netflixRules).toHaveLength(1);
    expect(netflixRules[0].categoryId).toBe('entertainment');
    // Seawolf rule PRE-EXISTED → reused, never duplicated.
    const seawolfRules = await prisma.categorizationRule.findMany({ where: { userId: USER, merchantId: MERCH_SEAWOLF } });
    expect(seawolfRules).toHaveLength(1);
    expect(seawolfRules[0].categoryId).toBe('coffee');
  });

  it('undo of the batch restores every filed row and removes ONLY the rules it minted', async () => {
    await makeTwoConfidentGroups();
    const res = await acceptAllConfident();
    const fresh = await undoCorrections(res.correctionIds);

    // Every filed row back in review, restored to uncategorized.
    for (const id of [`acc-s1-${process.pid}`, `acc-s2-${process.pid}`, `acc-s3-${process.pid}`, `acc-n1-${process.pid}`, `acc-n2-${process.pid}`]) {
      const t = await prisma.transaction.findUniqueOrThrow({ where: { id } });
      expect(t.needsReview).toBe(true);
      expect(t.categoryId).toBe('uncategorized');
    }
    // The minted Netflix rule is gone; the pre-existing Seawolf rule survives.
    expect(await prisma.categorizationRule.count({ where: { userId: USER, merchantId: MERCH_NETFLIX } })).toBe(0);
    expect(await prisma.categorizationRule.count({ where: { userId: USER, merchantId: MERCH_SEAWOLF } })).toBe(1);
    // Fresh queue is back to all three groups (two confident again, one ambiguous).
    expect(fresh).toHaveLength(3);
    expect(selectConfidentGroups(fresh)).toHaveLength(2);
  });

  it('no confident groups → no-op (nothing filed, nothing thrown, queue unchanged)', async () => {
    // Default fixture only: Seawolf (no rule → ambiguous) + Zelle (aggregate → ambiguous).
    const res = await acceptAllConfident();
    expect(res.merchantsFiled).toBe(0);
    expect(res.affected).toBe(0);
    expect(res.correctionIds).toEqual([]);
    // Both groups still queued.
    const rows = await prisma.transaction.findMany({ where: { account: { userId: USER }, needsReview: true } });
    expect(rows).toHaveLength(5);
  });

  it('ownership: a second user is untouched by the caller draining their own pile', async () => {
    await makeTwoConfidentGroups(); // USER now has confident groups
    // OTHER independently has a natively-confident Netflix row still in review.
    const otherAcct = await prisma.account.create({
      data: { userId: OTHER, provider: 'simplefin', providerRef: 'acc-other-chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 100_000, currency: 'USD' },
    });
    await prisma.transaction.create({
      data: { id: `acc-other-n1-${process.pid}`, accountId: otherAcct.id, date: '2026-06-06', amountCents: -1599, rawDescriptor: 'NETFLIX', merchantId: MERCH_NETFLIX, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
    });

    await acceptAllConfident(); // acting as USER

    const otherRow = await prisma.transaction.findUniqueOrThrow({ where: { id: `acc-other-n1-${process.pid}` } });
    expect(otherRow.needsReview).toBe(true);
    expect(otherRow.categoryId).toBe('uncategorized');
    expect(await prisma.categorizationRule.count({ where: { userId: OTHER } })).toBe(0);
  });

  /** A confident group the user can't actually file: a rule points its merchant at
   *  ANOTHER user's custom category (a real Category row → satisfies the rule FK; not
   *  a system id and not owned by USER → fileMerchantGroup's assertOwnedCategory
   *  rejects it). getTriageGroups still SUGGESTS it (no ownership check at suggest
   *  time), so the group is confident but unfileable — exactly the per-group failure. */
  async function makeUnfileableSeawolf(idSuffix: string) {
    const otherCat = await prisma.category.create({
      data: { id: `acc-othercat-${idSuffix}-${process.pid}`, name: `Other Only ${idSuffix} ${process.pid}`, userId: OTHER, group: 'Discretionary', discretionary: true, isSystem: false },
    });
    await prisma.categorizationRule.create({
      data: { userId: USER, merchantId: MERCH_SEAWOLF, categoryId: otherCat.id, priority: 100 },
    });
  }

  it('partial failure: an unfileable confident group is SKIPPED, the rest still file, and it stays queued — no throw', async () => {
    await makeUnfileableSeawolf('partial'); // Seawolf confident but unfileable
    const acct = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'acc-chk' } });
    await prisma.transaction.createMany({
      data: [
        { id: `acc-n1-${process.pid}`, accountId: acct.id, date: '2026-06-06', amountCents: -1599, rawDescriptor: 'NETFLIX', merchantId: MERCH_NETFLIX, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `acc-n2-${process.pid}`, accountId: acct.id, date: '2026-05-06', amountCents: -1599, rawDescriptor: 'NETFLIX', merchantId: MERCH_NETFLIX, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
      ],
    });
    // Precondition: BOTH Seawolf (unfileable) and Netflix (valid) are confident.
    expect(selectConfidentGroups(await getTriageGroups(USER))).toHaveLength(2);

    const res = await acceptAllConfident(); // must NOT throw
    expect(res.merchantsFiled).toBe(1); // only Netflix
    expect(res.affected).toBe(2);
    // Netflix filed; Seawolf left in review and STILL in the returned queue.
    for (const r of await prisma.transaction.findMany({ where: { merchantId: MERCH_NETFLIX, account: { userId: USER } } })) {
      expect(r.needsReview).toBe(false);
    }
    for (const r of await prisma.transaction.findMany({ where: { merchantId: MERCH_SEAWOLF, account: { userId: USER } } })) {
      expect(r.needsReview).toBe(true);
    }
    expect(res.groups.some((g) => g.merchantId === MERCH_SEAWOLF)).toBe(true);
  });

  it('total failure: every confident group unfileable → throws (fail-loud), nothing filed', async () => {
    await makeUnfileableSeawolf('total'); // the ONLY confident group, and it can't file
    expect(selectConfidentGroups(await getTriageGroups(USER))).toHaveLength(1);
    await expect(acceptAllConfident()).rejects.toThrow(/nothing was saved/i);
    // Nothing filed — Seawolf still fully queued.
    for (const r of await prisma.transaction.findMany({ where: { merchantId: MERCH_SEAWOLF, account: { userId: USER } } })) {
      expect(r.needsReview).toBe(true);
      expect(r.categoryId).toBe('uncategorized');
    }
  });

  // NOTE (aggregate-confident): an aggregate group (Zelle/checks) can only become
  // confident via a #161 LEARNED rule (the pipeline refuses merchant-wide rules on
  // aggregates by design, #23). acceptAll would then file its exact-descriptor rows
  // and mint NO durable rule — but that aggregate/no-rule behavior is inherited from
  // the tested fileMerchantGroup path (see triage-groups.test.ts "aggregate group:
  // files ONLY the exact descriptor rows, creates NO rule"), and the "is it confident"
  // decision is the pure isConfidentGroup test above. Not re-locked here to avoid
  // coupling this file to the #161 correction-history machinery.
});

describe('accept-all confident: golden-safety (demo inertness, DECISIONS #162)', () => {
  it('the demo seed has ZERO confident groups — the bulk banner is provably inert', async () => {
    // Locks the exact invariant the read-only e2e can only approximate: every demo
    // review group is genuinely ambiguous (Zelle payees / checks / Store Card), so a
    // seed change that introduced ANY confident group would fail here, loudly.
    const groups = await getTriageGroups(DEMO_USER_ID);
    expect(groups.length).toBeGreaterThan(0); // non-vacuous: the demo DOES have a review pile
    expect(summarizeConfident(groups)).toEqual({ merchants: 0, transactions: 0 });
  });
});
