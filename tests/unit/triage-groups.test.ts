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
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { getReviewCount, getTriageGroups } from '@/server/triage';
import { applyCategory, fileMerchantGroup, makeRuleFromCorrection, recategorize } from '@/server/triage-actions';
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
    await prisma.merchant.deleteMany({ where: { canonical: 'Seawolf Sundries' } });
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
        where: { canonical: 'Seawolf Sundries' },
        create: { id: `grp-merch-seawolf-${process.pid}`, canonical: 'Seawolf Sundries' },
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
        { id: `grp-s1-${process.pid}`, accountId: acct.id, date: '2026-06-09', amountCents: -1200, rawDescriptor: 'SQ *SEAWOLF SUNDRIES', merchantId: MERCH_SEAWOLF, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `grp-s2-${process.pid}`, accountId: acct.id, date: '2026-06-08', amountCents: -950, rawDescriptor: 'SQ *SEAWOLF SUNDRIES SEATTLE WA', merchantId: MERCH_SEAWOLF, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `grp-s3-${process.pid}`, accountId: acct.id, date: '2026-06-01', amountCents: -1500, rawDescriptor: 'SQ *SEAWOLF SUNDRIES', merchantId: MERCH_SEAWOLF, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
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
    expect(seawolf.merchantCanonical).toBe('Seawolf Sundries');
    expect(seawolf.count).toBe(3);
    expect(seawolf.totalCents).toBe(-3650);
    expect(seawolf.variants.sort()).toEqual(['SQ *SEAWOLF SUNDRIES', 'SQ *SEAWOLF SUNDRIES SEATTLE WA']);
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
    const seawolf = groups.find((g) => g.merchantCanonical === 'Seawolf Sundries')!;
    expect(seawolf.suggestedCategoryId).toBe('coffee');
  });

  it('fileMerchantGroup: files ALL rows + per-row corrections + prediction truth + durable rule → next ingest auto-files (trust on repeat)', async () => {
    const groups = await getTriageGroups(USER);
    const seawolf = groups.find((g) => g.merchantCanonical === 'Seawolf Sundries')!;

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
    for (const raw of ['SQ *SEAWOLF SUNDRIES', 'SQ *SEAWOLF SUNDRIES SEATTLE WA']) {
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

  it('test_regression__raw_card_files_m_card_rows (cycle-2 P2): a merchantless card never files same-descriptor rows on a m: card', async () => {
    const acct = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'grp-chk' } });
    // Identical bank text; one row merchantless (CSV/manual ingest), one merchant-
    // attached (synced). groupKey puts them on SEPARATE cards (raw: vs m:) — the
    // pre-fix scope { rawDescriptor } filed BOTH from the raw: card's one tap.
    await prisma.transaction.createMany({
      data: [
        { id: `grp-d1-${process.pid}`, accountId: acct.id, date: '2026-06-09', amountCents: -1000, rawDescriptor: 'CORNER STORE 55', merchantId: null, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `grp-d2-${process.pid}`, accountId: acct.id, date: '2026-06-08', amountCents: -2000, rawDescriptor: 'CORNER STORE 55', merchantId: MERCH_SEAWOLF, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
      ],
    });
    // The partition the scope must honor: d1 on its own raw: card, d2 inside the
    // merchant's m: card (count ≡ what one tap files — DECISIONS #23).
    const groups = await getTriageGroups(USER);
    const rawCard = groups.find((g) => g.key === 'raw:CORNER STORE 55');
    expect(rawCard).toBeDefined();
    expect(rawCard!.count).toBe(1);
    const seawolf = groups.find((g) => g.merchantId === MERCH_SEAWOLF)!;
    expect(seawolf.rows.map((r) => r.id)).toContain(`grp-d2-${process.pid}`);

    const res = await fileMerchantGroup({ anchorTransactionId: `grp-d1-${process.pid}`, categoryId: 'groceries' });
    expect(res.affected).toBe(1); // pre-fix: 2 — the m: card's row was co-filed
    const d2 = await prisma.transaction.findUniqueOrThrow({ where: { id: `grp-d2-${process.pid}` } });
    expect(d2.needsReview).toBe(true); // still queued on ITS card
    expect(d2.categoryId).toBe('uncategorized');
  });

  it('test_regression__scope_is_descriptor_not_canonical (cycle-2 gate gap): same-canonical merchantless rows stay separate', async () => {
    // Precondition asserted so a normalizer change fails LOUDLY, not vacuously:
    // both descriptors converge to one canonical, yet they are separate cards and
    // separate scopes (store-number variants of an unknown local merchant).
    const a = 'BLUE HERON POTTERY #12';
    const b = 'BLUE HERON POTTERY #99';
    expect(normalizeMerchant(a).canonical).toBe(normalizeMerchant(b).canonical);
    expect(normalizeMerchant(a).aggregate).toBe(false);
    const acct = await prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'grp-chk' } });
    await prisma.transaction.createMany({
      data: [
        { id: `grp-c1-${process.pid}`, accountId: acct.id, date: '2026-06-09', amountCents: -1000, rawDescriptor: a, merchantId: null, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `grp-c2-${process.pid}`, accountId: acct.id, date: '2026-06-08', amountCents: -2000, rawDescriptor: b, merchantId: null, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
      ],
    });
    // A canonical-scoped where (or canonical-keyed card) would merge these; the
    // existing P0 lock could not tell — its fixtures differed in BOTH canonical
    // and descriptor (cycle-2 gate gap).
    const res = await fileMerchantGroup({ anchorTransactionId: `grp-c1-${process.pid}`, categoryId: 'shopping' });
    expect(res.affected).toBe(1);
    const c2 = await prisma.transaction.findUniqueOrThrow({ where: { id: `grp-c2-${process.pid}` } });
    expect(c2.needsReview).toBe(true);
  });

  it('test_regression__conditional_rule_satisfies_dedupe (cycle-2 P2): a banded rule must not suppress the unconditional mint', async () => {
    // An amount-banded rule for the same merchant→category exists (no app path
    // writes conditions today, but the schema + pipeline enforce them — latent).
    const conditional = await prisma.categorizationRule.create({
      data: { userId: USER, merchantId: MERCH_SEAWOLF, categoryId: 'coffee', priority: 100, minAmountCents: -2000 },
    });
    const res = await fileMerchantGroup({ anchorTransactionId: `grp-s1-${process.pid}`, categoryId: 'coffee' });
    // Pre-fix the dedupe matched (merchant, category) only: the banded rule was
    // "reused", no unconditional rule was minted, and the card's "every future X
    // files automatically" promise silently broke for out-of-band amounts.
    expect(res.ruleId).not.toBeNull();
    expect(res.ruleId).not.toBe(conditional.id);
    const minted = await prisma.categorizationRule.findUniqueOrThrow({ where: { id: res.ruleId! } });
    expect(minted).toMatchObject({ minAmountCents: null, maxAmountCents: null, weekendOnly: null, weekdayOnly: null, accountId: null });
    expect(await prisma.categorizationRule.count({ where: { userId: USER, merchantId: MERCH_SEAWOLF, categoryId: 'coffee' } })).toBe(2);
  });

  it('test_regression__recategorize_stacks_duplicate_rules (cycle-2 gate gap): merchant-wide recategorize dedupes through the shared mint', async () => {
    const first = await recategorize({ transactionId: `grp-s1-${process.pid}`, categoryId: 'coffee', scope: 'merchant' });
    expect(first.ruleId).not.toBeNull();
    // Pre-fix this ALWAYS minted another priority-100 rule — equal-priority
    // duplicates with an unspecified tie-break in the pipeline's stable sort.
    const second = await recategorize({ transactionId: `grp-s2-${process.pid}`, categoryId: 'coffee', scope: 'merchant' });
    expect(second.ruleId).toBe(first.ruleId);
    expect(await prisma.categorizationRule.count({ where: { userId: USER, merchantId: MERCH_SEAWOLF } })).toBe(1);
  });

  it('test_regression__stale_rule_wins_recategorize (cycle-3 P1): re-filing a merchant to a DIFFERENT category retires the old rule — the NEW decision wins future ingests', async () => {
    const groups = await getTriageGroups(USER);
    const seawolf = groups.find((g) => g.merchantCanonical === 'Seawolf Sundries')!;
    const first = await fileMerchantGroup({ anchorTransactionId: seawolf.anchorTransactionId, categoryId: 'coffee' });
    expect(first.ruleId).not.toBeNull();
    // The changed mind — the reason recategorize exists. Pre-fix BOTH unconditional
    // rules survived at priority 100 and the OLDEST won the stable-sort tie-break:
    // every future charge of this merchant kept auto-filing as coffee at 9900,
    // silently overriding the user's newest decision, forever.
    const second = await recategorize({ transactionId: `grp-s1-${process.pid}`, categoryId: 'dining', scope: 'merchant' });
    expect(second.ruleId).not.toBeNull();
    const rules = await prisma.categorizationRule.findMany({ where: { userId: USER, merchantId: MERCH_SEAWOLF } });
    expect(rules).toHaveLength(1); // the coffee rule was RETIRED, not out-tie-broken
    expect(rules[0].categoryId).toBe('dining');
    const verdict = categorize(
      { rawDescriptor: 'SQ *SEAWOLF SUNDRIES', amountCents: -800, date: '2026-06-15', accountId: 'any' },
      await loadUserRules(USER),
    );
    expect(verdict.categoryId).toBe('dining'); // the NEW decision drives ingest
    expect(verdict.needsReview).toBe(false);
  });

  it('test_regression__always_stacks_duplicates (cycle-3 P2): singles "Always" + one-tap rule prompt dedupe through the shared mint', async () => {
    const r1 = await applyCategory({ transactionId: `grp-s1-${process.pid}`, categoryId: 'coffee', always: true });
    expect(r1.ruleId).not.toBeNull();
    // Pre-fix a second "Always" on ANOTHER row of the same merchant raw-created an
    // exact duplicate priority-100 rule (undo removed only one).
    const r2 = await applyCategory({ transactionId: `grp-s2-${process.pid}`, categoryId: 'coffee', always: true });
    expect(r2.ruleId).toBe(r1.ruleId);
    expect(await prisma.categorizationRule.count({ where: { userId: USER, merchantId: MERCH_SEAWOLF } })).toBe(1);
    // The fourth mint surface: the post-file one-tap "Always" prompt.
    const r3 = await applyCategory({ transactionId: `grp-s3-${process.pid}`, categoryId: 'coffee' });
    const made = await makeRuleFromCorrection(r3.correctionIds[0]);
    expect(made.ruleId).toBe(r1.ruleId); // reused, not re-minted
    expect(await prisma.categorizationRule.count({ where: { userId: USER, merchantId: MERCH_SEAWOLF } })).toBe(1);
  });

  it('test_regression__dead_becameRuleId (cycle-4 #31): a superseded rule pointer falls through to a fresh mint', async () => {
    const r1 = await applyCategory({ transactionId: `grp-s1-${process.pid}`, categoryId: 'coffee', always: true });
    expect(r1.ruleId).not.toBeNull();
    // Changed mind merchant-wide: the supersede retires the coffee rule (#147) —
    // but c1.becameRuleId still points at the dead id (no FK, nothing cascades).
    await recategorize({ transactionId: `grp-s2-${process.pid}`, categoryId: 'dining', scope: 'merchant' });
    expect(await prisma.categorizationRule.count({ where: { id: r1.ruleId! } })).toBe(0);
    // One-tap "Always" on the OLD correction: pre-fix the early return reported the
    // DEAD rule id while minting nothing ("success", no rule). Now a dangling
    // pointer falls through to a fresh mint — which itself supersedes the dining
    // rule (latest action wins, the #147 semantic).
    const made = await makeRuleFromCorrection(r1.correctionIds[0]);
    expect(made.ruleId).not.toBeNull();
    expect(made.ruleId).not.toBe(r1.ruleId);
    const rules = await prisma.categorizationRule.findMany({ where: { userId: USER, merchantId: MERCH_SEAWOLF } });
    expect(rules).toHaveLength(1);
    expect(rules[0].categoryId).toBe('coffee');
    const c1 = await prisma.correction.findUniqueOrThrow({ where: { id: r1.correctionIds[0] } });
    expect(c1.becameRuleId).toBe(made.ruleId); // lineage re-pointed to the LIVE rule
  });

  it('double-file is idempotent and rules are deduped (checker P1)', async () => {
    const groups = await getTriageGroups(USER);
    const seawolf = groups.find((g) => g.merchantCanonical === 'Seawolf Sundries')!;
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
      data: { id: `grp-s4-${process.pid}`, accountId: acct.id, date: '2026-06-10', amountCents: -700, rawDescriptor: 'SQ *SEAWOLF SUNDRIES', merchantId: MERCH_SEAWOLF, categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
    });
    const third = await fileMerchantGroup({ anchorTransactionId: `grp-s4-${process.pid}`, categoryId: 'coffee' });
    expect(third.affected).toBe(1);
    expect(third.ruleId).toBe(first.ruleId); // deduped, not duplicated
    expect(await prisma.categorizationRule.count({ where: { userId: USER, merchantId: MERCH_SEAWOLF } })).toBe(1);
  });
});
