/**
 * Merchant-group review queue + one-action group filing (Phase 3b, DECISIONS #143).
 * Integration against throwaway users: the queue unit is the merchant (getTriageGroups /
 * getReviewCount), and fileMerchantGroup files every queued row of the merchant, records
 * per-row Corrections, sets prediction ground truth, and creates the durable rule that
 * makes the NEXT ingest of this merchant auto-file silently (trust on repeat = certainty).
 * Aggregates (Zelle) group by EXACT descriptor and never get rules (#23).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { groupReviewRows } from '@/lib/engine/categorize/group';
import { getReviewCount, getTriageGroups } from '@/server/triage';
import { fileMerchantGroup } from '@/server/triage-actions';
import { loadUserRules } from '@/server/rules';
import { prisma } from '@/lib/db';

describe('merchant-group triage (Phase 3b)', () => {
  const USER = `grp-${Date.now()}-${process.pid}`;
  const OTHER = `grp-other-${Date.now()}-${process.pid}`;
  // Merchant.canonical is UNIQUE and the demo seed owns 'Zelle Payment' — upsert by
  // canonical and capture the ids (never assume ours won the row).
  let MERCH_SEAWOLF = '';
  let MERCH_ZELLE = '';

  async function wipe() {
    await prisma.correction.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    await prisma.categorizationRule.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    await prisma.categoryPrediction.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    await prisma.account.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
    // Seawolf is ours alone (the seed has no such merchant); Zelle stays — seed-owned.
    await prisma.merchant.deleteMany({ where: { canonical: 'Seawolf Bakers' } });
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
        create: { id: `grp-merch-seawolf-${process.pid}`, canonical: 'Seawolf Bakers' },
        update: {},
      })
    ).id;
    MERCH_ZELLE = (
      await prisma.merchant.upsert({
        where: { canonical: 'Zelle Payment' },
        create: { id: `grp-merch-zelle-${process.pid}`, canonical: 'Zelle Payment' },
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

    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'simplefin', providerRef: 'grp-chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 100_000, currency: 'USD' },
    });
    // Seawolf: 3 review rows across TWO descriptor variants (converged identity)
    await prisma.transaction.createMany({
      data: [
        { id: `grp-s1-${process.pid}`, accountId: acct.id, date: '2026-06-09', amountCents: -1200, rawDescriptor: 'SQ *SEAWOLF BAKERS', merchantId: MERCH_SEAWOLF, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `grp-s2-${process.pid}`, accountId: acct.id, date: '2026-06-08', amountCents: -950, rawDescriptor: 'SQ *SEAWOLF BAKERS SEATTLE WA', merchantId: MERCH_SEAWOLF, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `grp-s3-${process.pid}`, accountId: acct.id, date: '2026-06-01', amountCents: -1500, rawDescriptor: 'SQ *SEAWOLF BAKERS', merchantId: MERCH_SEAWOLF, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        // Zelle: ONE merchant row, TWO payees → two aggregate groups by exact descriptor
        { id: `grp-z1-${process.pid}`, accountId: acct.id, date: '2026-06-07', amountCents: -92500, rawDescriptor: 'ZELLE PAYMENT TO MARCUS CHEN', merchantId: MERCH_ZELLE, categoryId: 'uncategorized', confidenceBps: 4000, needsReview: true },
        { id: `grp-z2-${process.pid}`, accountId: acct.id, date: '2026-05-07', amountCents: -92500, rawDescriptor: 'ZELLE PAYMENT TO MARCUS CHEN', merchantId: MERCH_ZELLE, categoryId: 'uncategorized', confidenceBps: 4000, needsReview: true },
        { id: `grp-z3-${process.pid}`, accountId: acct.id, date: '2026-06-05', amountCents: -8000, rawDescriptor: 'ZELLE PAYMENT TO RILEY OKAFOR', merchantId: MERCH_ZELLE, categoryId: 'uncategorized', confidenceBps: 4000, needsReview: true },
      ],
    });
    // One prediction row so ground-truth stamping is provable
    await prisma.categoryPrediction.create({
      data: { userId: USER, transactionId: `grp-s1-${process.pid}`, predictedCategoryId: 'uncategorized', confidenceBps: 5000 },
    });
  });

  it('groups by merchant (variants merged) and by exact descriptor for aggregates; badge counts GROUPS', async () => {
    const groups = await getTriageGroups(USER);
    expect(groups).toHaveLength(3); // Seawolf + Zelle-Marcus + Zelle-Riley — not 6 rows
    expect(await getReviewCount(USER)).toBe(3); // the badge = decisions, not rows

    const seawolf = groups[0]; // count DESC → 3-row Seawolf first
    expect(seawolf.merchantCanonical).toBe('Seawolf Bakers');
    expect(seawolf.count).toBe(3);
    expect(seawolf.totalCents).toBe(-3650);
    expect(seawolf.variants.sort()).toEqual(['SQ *SEAWOLF BAKERS', 'SQ *SEAWOLF BAKERS SEATTLE WA']);
    expect(seawolf.anchorTransactionId).toBe(`grp-s1-${process.pid}`); // newest row
    expect(seawolf.ruleEligible).toBe(true);
    // HONEST suggestion: unknown merchant → null, never an amount-based 'Shopping'
    expect(seawolf.suggestedCategoryId).toBeNull();
    expect(seawolf.suggestedCategoryName).toBeNull();

    const marcus = groups.find((g) => g.variants.includes('ZELLE PAYMENT TO MARCUS CHEN'))!;
    expect(marcus.count).toBe(2); // Marcus only — Riley is her own group (#23)
    expect(marcus.ruleEligible).toBe(false);
    expect(marcus.aggregate).toBe(true);
  });

  it('a user rule surfaces as the group suggestion (rows queued before the rule existed)', async () => {
    await prisma.categorizationRule.create({
      data: { userId: USER, merchantId: MERCH_SEAWOLF, categoryId: 'coffee', priority: 100 },
    });
    const groups = await getTriageGroups(USER);
    const seawolf = groups.find((g) => g.merchantCanonical === 'Seawolf Bakers')!;
    expect(seawolf.suggestedCategoryId).toBe('coffee');
  });

  it('fileMerchantGroup: files ALL rows + per-row corrections + prediction truth + durable rule → next ingest auto-files (trust on repeat)', async () => {
    const groups = await getTriageGroups(USER);
    const seawolf = groups.find((g) => g.merchantCanonical === 'Seawolf Bakers')!;

    const res = await fileMerchantGroup({ anchorTransactionId: seawolf.anchorTransactionId, categoryId: 'coffee' });
    expect(res.affected).toBe(3);
    expect(res.correctionIds).toHaveLength(3);
    expect(res.ruleId).not.toBeNull();

    // All three rows filed; none left in review.
    const rows = await prisma.transaction.findMany({ where: { merchantId: MERCH_SEAWOLF, account: { userId: USER } } });
    for (const r of rows) {
      expect(r.categoryId).toBe('coffee');
      expect(r.needsReview).toBe(false);
      expect(r.confidenceBps).toBe(9900);
    }
    // Rule provenance: createdFrom = first correction, back-linked via becameRuleId.
    const rule = await prisma.categorizationRule.findUniqueOrThrow({ where: { id: res.ruleId! } });
    expect(rule).toMatchObject({ merchantId: MERCH_SEAWOLF, categoryId: 'coffee', priority: 100 });
    const firstCorrection = await prisma.correction.findUniqueOrThrow({ where: { id: res.correctionIds[0] } });
    expect(firstCorrection.becameRuleId).toBe(res.ruleId);
    // Prediction ground truth stamped.
    const pred = await prisma.categoryPrediction.findFirstOrThrow({ where: { transactionId: `grp-s1-${process.pid}` } });
    expect(pred.actualCategoryId).toBe('coffee');
    // The queue shrank by exactly one GROUP.
    expect(await getReviewCount(USER)).toBe(2);

    // TRUST ON REPEAT (fix-doc mechanic 2): the NEXT synced Seawolf transaction —
    // under EITHER descriptor variant — auto-files silently at rule confidence.
    const rules = await loadUserRules(USER);
    for (const raw of ['SQ *SEAWOLF BAKERS', 'SQ *SEAWOLF BAKERS SEATTLE WA']) {
      const next = categorize({ rawDescriptor: raw, amountCents: -800, date: '2026-06-15', accountId: 'any' }, rules);
      expect(next.needsReview).toBe(false);
      expect(next.categoryId).toBe('coffee');
      expect(next.confidenceBps).toBe(9900);
      expect(next.source).toBe('user-rule');
    }
  });

  it('aggregate group: files ONLY the exact descriptor rows, creates NO rule', async () => {
    const groups = await getTriageGroups(USER);
    const marcus = groups.find((g) => g.variants.includes('ZELLE PAYMENT TO MARCUS CHEN'))!;

    const res = await fileMerchantGroup({ anchorTransactionId: marcus.anchorTransactionId, categoryId: 'rent' });
    expect(res.affected).toBe(2);
    expect(res.ruleId).toBeNull(); // aggregates never get merchant-wide rules

    const riley = await prisma.transaction.findFirstOrThrow({ where: { id: `grp-z3-${process.pid}` } });
    expect(riley.needsReview).toBe(true); // untouched — different payee
    expect(riley.categoryId).toBe('uncategorized');
    expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(0);
  });

  it('rejects an anchor owned by another user', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: OTHER } } as never);
    const anchor = `grp-s1-${process.pid}`;
    await expect(fileMerchantGroup({ anchorTransactionId: anchor, categoryId: 'coffee' })).rejects.toThrow(
      'Transaction not found',
    );
  });

  it('pure grouping: leverage sort (count desc), preserved newest-first rows, merchantless fallback key', () => {
    const groups = groupReviewRows([
      { id: 'a1', merchantId: null, merchantCanonical: 'Local One', rawDescriptor: 'LOCAL ONE', amountCents: -100, date: '2026-06-09', accountName: 'X', status: 'POSTED', aggregate: false, suggestedCategoryId: null },
      { id: 'b1', merchantId: 'm1', merchantCanonical: 'Busy', rawDescriptor: 'BUSY 1', amountCents: -100, date: '2026-06-08', accountName: 'X', status: 'POSTED', aggregate: false, suggestedCategoryId: 'coffee' },
      { id: 'b2', merchantId: 'm1', merchantCanonical: 'Busy', rawDescriptor: 'BUSY 2', amountCents: -200, date: '2026-06-07', accountName: 'X', status: 'POSTED', aggregate: false, suggestedCategoryId: 'dining' },
    ]);
    expect(groups.map((g) => g.merchantCanonical)).toEqual(['Busy', 'Local One']); // 2 rows beat 1
    expect(groups[0].suggestedCategoryId).toBeNull(); // MIXED verdicts → null, no fake unanimity
    expect(groups[0].rows.map((r) => r.id)).toEqual(['b1', 'b2']); // newest-first preserved
    // Merchantless fallback keys by EXACT DESCRIPTOR — the same scope the file
    // action uses, so card count ≡ action scope (checker P0).
    expect(groups[1].key).toBe('raw:LOCAL ONE');
    expect(groups[1].ruleEligible).toBe(false); // no merchantId → no rule offer
  });

  it('P0 lock: a MERCHANTLESS anchor files ONLY its exact-descriptor rows — never every null-merchant row', async () => {
    const acct = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'grp-chk' } });
    await prisma.transaction.createMany({
      data: [
        { id: `grp-m1-${process.pid}`, accountId: acct.id, date: '2026-06-09', amountCents: -1000, rawDescriptor: 'LOCAL COFFEE HOUSE', merchantId: null, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `grp-m2-${process.pid}`, accountId: acct.id, date: '2026-06-08', amountCents: -2000, rawDescriptor: 'LOCAL HARDWARE STORE', merchantId: null, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
      ],
    });
    const res = await fileMerchantGroup({ anchorTransactionId: `grp-m1-${process.pid}`, categoryId: 'coffee' });
    expect(res.affected).toBe(1); // ONLY the anchor's descriptor — pre-fix this was every merchantless row
    expect(res.ruleId).toBeNull(); // no merchant → nothing durable to hang a rule on
    const other = await prisma.transaction.findUniqueOrThrow({ where: { id: `grp-m2-${process.pid}` } });
    expect(other.needsReview).toBe(true);
    expect(other.categoryId).toBe('uncategorized');
  });

  it('double-file is idempotent and rules are deduped (checker P1)', async () => {
    const groups = await getTriageGroups(USER);
    const seawolf = groups.find((g) => g.merchantCanonical === 'Seawolf Bakers')!;
    const first = await fileMerchantGroup({ anchorTransactionId: seawolf.anchorTransactionId, categoryId: 'coffee' });
    expect(first.affected).toBe(3);
    // Second fire on the same (now-cleared) group: compare-and-set finds nothing.
    const second = await fileMerchantGroup({ anchorTransactionId: seawolf.anchorTransactionId, categoryId: 'coffee' });
    expect(second.affected).toBe(0);
    expect(second.correctionIds).toHaveLength(0);
    expect(await prisma.categorizationRule.count({ where: { userId: USER, merchantId: MERCH_SEAWOLF } })).toBe(1);
    // A new row of the same merchant filed to the SAME category reuses the rule row.
    const acct = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'grp-chk' } });
    await prisma.transaction.create({
      data: { id: `grp-s4-${process.pid}`, accountId: acct.id, date: '2026-06-10', amountCents: -700, rawDescriptor: 'SQ *SEAWOLF BAKERS', merchantId: MERCH_SEAWOLF, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
    });
    const third = await fileMerchantGroup({ anchorTransactionId: `grp-s4-${process.pid}`, categoryId: 'coffee' });
    expect(third.affected).toBe(1);
    expect(third.ruleId).toBe(first.ruleId); // deduped, not duplicated
    expect(await prisma.categorizationRule.count({ where: { userId: USER, merchantId: MERCH_SEAWOLF } })).toBe(1);
  });
});
