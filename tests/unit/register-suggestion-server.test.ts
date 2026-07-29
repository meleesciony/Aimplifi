/**
 * The suggestion ladder reaches the REGISTER (TASKS O.9d / DECISIONS #333) —
 * integration, on the exact pattern of triage-proposal.test.ts.
 *
 * The pure ladder is covered in register-suggestion.test.ts. What a pure test
 * cannot catch — and what the one-question-one-basis lessons exist for — is the
 * WIRING: real rows, real corrections, the real `getTransactions`, so the
 * register's chip and the inbox's card can be asserted against the same
 * evidence. The owner's report was precisely a wiring gap: the proposal engine
 * worked, and the surface he browses never called it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { getTransactions } from '@/server/transactions';
import { recategorize } from '@/server/triage-actions';
import { prisma } from '@/lib/db';

const USER = `regsug-${Date.now()}-${process.pid}`;
const CHECK_AMOUNT = -145_000; // $1,450.00 rent check, identical every month

async function wipe() {
  await prisma.correction.deleteMany({ where: { userId: USER } });
  await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
  await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.category.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
}

async function account() {
  return prisma.account.findFirstOrThrow({ where: { userId: USER, providerRef: 'regsug-chk' } });
}

/** A filed row plus the Correction that filed it — the owner's past decision. */
async function filed(id: string, date: string, descriptor: string, amountCents: number, categoryId: string) {
  const acct = await account();
  await prisma.transaction.create({
    data: {
      id: `${id}-${process.pid}`,
      accountId: acct.id,
      date,
      amountCents,
      rawDescriptor: descriptor,
      categoryId,
      confidenceBps: 10_000,
      needsReview: false,
    },
  });
  await prisma.correction.create({
    data: { userId: USER, transactionId: `${id}-${process.pid}`, toCategoryId: categoryId },
  });
}

/** An unfiled row — what the register shows as "Uncategorized". */
async function unfiled(
  id: string,
  date: string,
  descriptor: string,
  amountCents: number,
  extra: { providerCategoryId?: string; isTransfer?: boolean } = {},
) {
  const acct = await account();
  await prisma.transaction.create({
    data: {
      id: `${id}-${process.pid}`,
      accountId: acct.id,
      date,
      amountCents,
      rawDescriptor: descriptor,
      categoryId: 'uncategorized',
      confidenceBps: 4000,
      needsReview: true,
      ...extra,
    },
  });
}

async function rowById(id: string) {
  const { rows } = await getTransactions(USER);
  return rows.find((r) => r.id === `${id}-${process.pid}`);
}

describe('the suggestion ladder reaches the register (integration)', () => {
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    await prisma.correction.deleteMany({ where: { userId: USER } });
    await prisma.categorizationRule.deleteMany({ where: { userId: USER } });
    await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.account.create({
      data: {
        userId: USER,
        provider: 'simplefin',
        providerRef: 'regsug-chk',
        name: 'Checking',
        type: 'CHECKING',
        currentBalanceCents: 500_000,
        currency: 'USD',
      },
    });
  });

  it('with no history and no guesses, the unfiled row carries NO chip', async () => {
    await unfiled('r-q1', '2026-06-01', 'CHECK PAID 1874', CHECK_AMOUNT);
    const row = await rowById('r-q1');
    expect(row).toBeDefined();
    expect(row!.suggestion).toBeNull(); // the "very dumb" baseline, now only where it is true
  });

  it('after two identical checks are filed, the third carries a HISTORY chip with its evidence', async () => {
    await filed('r-f1', '2026-04-01', 'CHECK PAID 1841', CHECK_AMOUNT, 'rent');
    await filed('r-f2', '2026-05-01', 'CHECK PAID 1856', CHECK_AMOUNT, 'rent');
    await unfiled('r-q1', '2026-06-01', 'CHECK PAID 1874', CHECK_AMOUNT);

    const row = await rowById('r-q1');
    expect(row!.suggestion).not.toBeNull();
    expect(row!.suggestion!.kind).toBe('history');
    expect(row!.suggestion!.categoryId).toBe('rent');
    expect(row!.suggestion!.categoryName).toBe('Rent & Mortgage');
    // the reason names the repeated amount VERBATIM, formatted once at this boundary
    expect(row!.suggestion!.reason).toContain('$1,450.00');
    expect(row!.suggestion!.reason).toContain('Rent & Mortgage');
  });

  it("Plaid's persisted guess outranks the history proposal on an ORDINARY merchant — the inbox's own gate", async () => {
    // ONE prior filing: below the learner's >=2 evidence bar (no rule, so the
    // pipeline rung stays quiet) but at the propose threshold — the exact
    // window where provider-vs-history precedence is decided.
    await filed('r-f1', '2026-04-01', 'ZYRRO STUDIO #221 ATLANTA GA', -3_200, 'dining');
    await unfiled('r-q0', '2026-05-30', 'ZYRRO STUDIO #500 ATLANTA GA', -2_900);
    await unfiled('r-q1', '2026-06-01', 'ZYRRO STUDIO #512 ATLANTA GA', -3_000, {
      providerCategoryId: 'household',
    });

    // Fixture proves itself: without a provider guess, history CAN speak here.
    const bareRow = await rowById('r-q0');
    expect(bareRow!.suggestion!.kind).toBe('history');
    // With one, the provider outranks it — the inbox's own precedence.
    const row = await rowById('r-q1');
    expect(row!.suggestion!.kind).toBe('provider');
    expect(row!.suggestion!.categoryId).toBe('household');
    expect(row!.suggestion!.reason).toBeNull(); // the evidence sentence belongs to history proposals only
  });

  it('two filings of one merchant graduate to a RULESET chip via the learned canonical tier (O.9a → O.9d)', async () => {
    // The owner's literal report: "I've already inputed many and the system
    // still doesn't recognize that the others are the same." Two distinct
    // filings meet the learner's evidence bar, and the register now SHOWS it.
    await filed('r-f1', '2026-04-01', 'ZYRRO STUDIO #221 ATLANTA GA', -3_200, 'dining');
    await filed('r-f2', '2026-05-01', 'ZYRRO STUDIO #443 ATLANTA GA', -2_850, 'dining');
    await unfiled('r-q1', '2026-06-01', 'ZYRRO STUDIO #512 ATLANTA GA', -3_000);

    const row = await rowById('r-q1');
    expect(row!.suggestion!.kind).toBe('ruleset');
    expect(row!.suggestion!.categoryId).toBe('dining');
  });

  it("an AGGREGATE row suppresses Plaid's guess and speaks from history instead (critic F1)", async () => {
    // A check is a channel, not a payee — the inbox never shows the provider
    // guess for it (group.ts), so the register must not one-tap it either.
    await filed('r-f1', '2026-04-01', 'CHECK PAID 1841', CHECK_AMOUNT, 'rent');
    await filed('r-f2', '2026-05-01', 'CHECK PAID 1856', CHECK_AMOUNT, 'rent');
    await unfiled('r-q1', '2026-06-01', 'CHECK PAID 1874', CHECK_AMOUNT, {
      providerCategoryId: 'household',
    });

    const row = await rowById('r-q1');
    expect(row!.suggestion!.kind).toBe('history'); // never 'provider' on a channel row
    expect(row!.suggestion!.categoryId).toBe('rent');

    // …and with no history either, the aggregate row stays bare.
    await unfiled('r-q2', '2026-06-02', 'ZELLE PAYMENT TO UNKNOWN 991', -5_000, {
      providerCategoryId: 'household',
    });
    const bare = await rowById('r-q2');
    expect(bare!.suggestion).toBeNull();
  });

  it('a row that already has a category is never second-guessed', async () => {
    await filed('r-f1', '2026-04-01', 'CHECK PAID 1841', CHECK_AMOUNT, 'rent');
    const row = await rowById('r-f1');
    expect(row).toBeDefined();
    expect(row!.suggestion).toBeNull();
  });

  it('a transfer row is skipped, exactly as the inbox skips it', async () => {
    await filed('r-f1', '2026-04-01', 'CHECK PAID 1841', CHECK_AMOUNT, 'rent');
    await filed('r-f2', '2026-05-01', 'CHECK PAID 1856', CHECK_AMOUNT, 'rent');
    await unfiled('r-q1', '2026-06-01', 'CHECK PAID 1874', CHECK_AMOUNT, { isTransfer: true });
    const row = await rowById('r-q1');
    expect(row!.suggestion).toBeNull();
  });

  it('a stale chip cannot overwrite a category chosen since the page loaded (critic F2 CAS)', async () => {
    // The row was unfiled when the register rendered its chip; someone (another
    // tab, a partner, the inbox) has since filed it as groceries. The one-tap
    // confirm asserts "still unfiled" — the server must re-prove that premise
    // and refuse, leaving the newer decision in place.
    await unfiled('r-q1', '2026-06-01', 'CHECK PAID 1874', CHECK_AMOUNT);
    const id = `r-q1-${process.pid}`;
    await prisma.transaction.update({ where: { id }, data: { categoryId: 'groceries', needsReview: false } });

    await expect(
      recategorize({ transactionId: id, categoryId: 'rent', scope: 'one', expectUnfiled: true }),
    ).rejects.toThrow(/categorized since/);
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(after.categoryId).toBe('groceries'); // the concurrent actor's decision survives
    expect(await prisma.correction.count({ where: { userId: USER, transactionId: id } })).toBe(0);

    // …while a genuinely unfiled row confirms normally through the same clause.
    await unfiled('r-q2', '2026-06-02', 'CHECK PAID 1875', CHECK_AMOUNT);
    const id2 = `r-q2-${process.pid}`;
    await recategorize({ transactionId: id2, categoryId: 'rent', scope: 'one', expectUnfiled: true });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: id2 } })).categoryId).toBe('rent');
  });

  it('a demo-visitor-minted "Always" rule never steers the next visitor (critic F4 fence)', async () => {
    // Plant a raw rule on the shared demo row, as if a visitor answered
    // "Always" — the read path must refuse to let it speak.
    const { loadUserRules } = await import('@/server/rules');
    const demoMerchant = await prisma.merchant.findFirst({
      where: { transactions: { some: { account: { userId: DEMO_USER_ID } } } },
    });
    expect(demoMerchant, 'demo seed must have merchants for this test to mean anything').not.toBeNull();
    const planted = await prisma.categorizationRule.create({
      data: { userId: DEMO_USER_ID, merchantId: demoMerchant!.id, categoryId: 'dining', priority: 100 },
    });
    try {
      expect(await loadUserRules(DEMO_USER_ID)).toEqual([]);
    } finally {
      await prisma.categorizationRule.delete({ where: { id: planted.id } });
    }
  });

  it('the SHARED DEMO register never proposes from a visitor’s filings', async () => {
    // Same leak class as #332: every anonymous visitor is one row, so a chip
    // reading "from your history" on the demo would narrate a stranger's choices.
    const demoTxn = await prisma.transaction.findFirst({
      where: { account: { userId: DEMO_USER_ID } },
    });
    expect(demoTxn, 'demo seed must exist for this test to mean anything').not.toBeNull();
    const planted = await prisma.correction.create({
      data: { userId: DEMO_USER_ID, transactionId: demoTxn!.id, toCategoryId: 'dining' },
    });
    try {
      const { rows } = await getTransactions(DEMO_USER_ID);
      expect(rows.every((r) => r.suggestion === null || r.suggestion.kind !== 'history')).toBe(true);
    } finally {
      await prisma.correction.delete({ where: { id: planted.id } });
    }
  });
});
