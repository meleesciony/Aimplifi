/**
 * Household shared transactions in the register — TASKS 4.2 slice 3
 * (HOUSEHOLD_ARCHITECTURE §4.5 / §5.3), one-off recategorize added in slice 6
 * (§6.1 / DECISIONS #201). Locks:
 *  - T1: partner UNSHARED-account transactions never appear.
 *  - T2: non-member / post-leave rows invisible even with the share flag.
 *  - T3: the ONLY mutation a household member may make on a partner's shared
 *    transaction is the slice-6 one-off `recategorizeSharedTransaction` —
 *    everything else (the owner-only `recategorize`/`applyCategory` path,
 *    rules, batch, prediction labeling) stays exactly where it was.
 *  - F3: category names resolve via scoped-ids lookup; getCategoryMeta for the
 *    viewer does NOT gain the partner's custom category vocabulary.
 *  - Personal getTransactions stays OWNED-only (summary/picker isolation).
 *  - T6: no household → kind 'none' (demo/golden safe).
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { leaveHousehold, recategorizeSharedTransaction } from '@/server/household-actions';
import { getSharedTransactionsView } from '@/server/household';
import { categoryNamesByIds, getCategoryMeta } from '@/server/category-meta';
import { getTransactions } from '@/server/transactions';
import { recategorize } from '@/server/triage-actions';

const stamp = `${Date.now()}-${process.pid}`;
const uid = (slug: string) => `hht-${slug}-${stamp}`;
const emailOf = (id: string) => `${id}@test.local`;

const ALL_IDS: string[] = [];
async function seedUser(slug: string, name?: string): Promise<string> {
  const id = uid(slug);
  ALL_IDS.push(id);
  await prisma.user.create({ data: { id, email: emailOf(id), name: name ?? slug } });
  return id;
}
function actAs(userId: string) {
  vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);
}
async function wipe() {
  const memberships = await prisma.householdMember.findMany({
    where: { userId: { in: ALL_IDS } },
    select: { householdId: true },
  });
  await prisma.household.deleteMany({
    where: { id: { in: memberships.map((m) => m.householdId) } },
  });
  await prisma.user.deleteMany({ where: { id: { in: ALL_IDS } } });
}

describe('categoryNamesByIds (scoped lookup — F3)', () => {
  it('resolves system ids from the static map without inventing partner vocabulary', async () => {
    const map = await categoryNamesByIds(['groceries', 'dining', null, 'uncategorized', '']);
    expect(map.get('groceries')).toBe('Groceries');
    expect(map.get('dining')).toBe('Dining Out');
    expect(map.has('uncategorized')).toBe(false); // caller falls back via categoryName()
  });

  it('resolves ONLY the requested custom ids — not every custom the owner owns', async () => {
    const owner = await seedUser('cat-owner');
    const visible = await prisma.category.create({
      data: {
        id: `cat-vis-${stamp}`,
        userId: owner,
        name: 'Partner Golf',
        group: 'Entertainment',
        discretionary: true,
        isSystem: false,
      },
    });
    const hidden = await prisma.category.create({
      data: {
        id: `cat-hid-${stamp}`,
        userId: owner,
        name: 'Secret Therapy',
        group: 'Health',
        discretionary: true,
        isSystem: false,
      },
    });
    try {
      const map = await categoryNamesByIds([visible.id]);
      expect(map.get(visible.id)).toBe('Partner Golf');
      expect(map.has(hidden.id)).toBe(false); // never loaded — vocabulary stays private
    } finally {
      await prisma.category.deleteMany({ where: { id: { in: [visible.id, hidden.id] } } });
      await prisma.user.delete({ where: { id: owner } });
      ALL_IDS.splice(ALL_IDS.indexOf(owner), 1);
    }
  });
});

describe('household shared transactions (integration)', () => {
  let ownerId = ''; // viewer under test
  let partnerId = '';
  let strangerId = '';
  let ownAcct = '';
  let sharedAcct = '';
  let privateAcct = '';
  let eurSharedAcct = '';
  let investSharedAcct = ''; // slice 6: non-spending type, shared — write-path type guard
  let ownTxn = '';
  let sharedTxn = '';
  let sharedCustomTxn = '';
  let sharedTxnMutable = ''; // slice 6: dedicated row for recategorize mutation tests
  let privateTxn = '';
  let eurTxn = '';
  let investTxn = '';
  let partnerCustomCat = '';
  let partnerHiddenCat = '';
  let ownerCustomCat = ''; // slice 6: the ACTING user's own custom — must also be rejected

  beforeAll(async () => {
    await wipe().catch(() => {});
    ownerId = await seedUser('owner');
    partnerId = await seedUser('partner', 'Pat Partner');
    strangerId = await seedUser('stranger');
    await prisma.household.create({
      data: {
        name: 'Casa Txn',
        members: {
          create: [
            { userId: ownerId, role: 'owner' },
            { userId: partnerId, role: 'partner' },
          ],
        },
      },
    });

    ownAcct = (
      await prisma.account.create({
        data: {
          userId: ownerId,
          provider: 'manual',
          name: 'My Checking',
          type: 'CHECKING',
          currentBalanceCents: 10000,
          currency: 'USD',
        },
      })
    ).id;
    sharedAcct = (
      await prisma.account.create({
        data: {
          userId: partnerId,
          provider: 'manual',
          name: 'Pat Checking',
          type: 'CHECKING',
          currentBalanceCents: 20000,
          currency: 'USD',
          sharedToHousehold: true,
        },
      })
    ).id;
    privateAcct = (
      await prisma.account.create({
        data: {
          userId: partnerId,
          provider: 'manual',
          name: 'Pat Private',
          type: 'SAVINGS',
          currentBalanceCents: 999999,
          currency: 'USD',
          sharedToHousehold: false,
        },
      })
    ).id;
    eurSharedAcct = (
      await prisma.account.create({
        data: {
          userId: partnerId,
          provider: 'manual',
          name: 'Pat Euro',
          type: 'CHECKING',
          currentBalanceCents: 5000,
          currency: 'EUR',
          sharedToHousehold: true,
        },
      })
    ).id;
    investSharedAcct = (
      await prisma.account.create({
        data: {
          userId: partnerId,
          provider: 'manual',
          name: 'Pat Brokerage',
          type: 'INVESTMENT',
          currentBalanceCents: 500000,
          currency: 'USD',
          sharedToHousehold: true,
        },
      })
    ).id;

    partnerCustomCat = (
      await prisma.category.create({
        data: {
          id: `pat-golf-${stamp}`,
          userId: partnerId,
          name: 'Partner Golf',
          group: 'Entertainment',
          discretionary: true,
          isSystem: false,
        },
      })
    ).id;
    partnerHiddenCat = (
      await prisma.category.create({
        data: {
          id: `pat-secret-${stamp}`,
          userId: partnerId,
          name: 'Secret Therapy',
          group: 'Health',
          discretionary: true,
          isSystem: false,
        },
      })
    ).id;
    ownerCustomCat = (
      await prisma.category.create({
        data: {
          id: `own-hobby-${stamp}`,
          userId: ownerId,
          name: 'Owner Hobby',
          group: 'Entertainment',
          discretionary: true,
          isSystem: false,
        },
      })
    ).id;

    const mkTxn = (data: Parameters<typeof prisma.transaction.create>[0]['data']) =>
      prisma.transaction.create({ data });

    ownTxn = (
      await mkTxn({
        accountId: ownAcct,
        date: '2026-07-01',
        amountCents: -1200,
        rawDescriptor: 'MY COFFEE',
        categoryId: 'dining',
        status: 'POSTED',
        isTransfer: false,
        isSplitParent: false,
      })
    ).id;
    sharedTxn = (
      await mkTxn({
        accountId: sharedAcct,
        date: '2026-07-02',
        amountCents: -4500,
        rawDescriptor: 'PAT GROCERY',
        categoryId: 'groceries',
        status: 'POSTED',
        isTransfer: false,
        isSplitParent: false,
      })
    ).id;
    sharedCustomTxn = (
      await mkTxn({
        accountId: sharedAcct,
        date: '2026-07-03',
        amountCents: -8000,
        rawDescriptor: 'PAT GOLF CLUB',
        categoryId: partnerCustomCat,
        status: 'POSTED',
        isTransfer: false,
        isSplitParent: false,
      })
    ).id;
    privateTxn = (
      await mkTxn({
        accountId: privateAcct,
        date: '2026-07-04',
        amountCents: -99900,
        rawDescriptor: 'PRIVATE SPEND',
        categoryId: partnerHiddenCat, // vocabulary that must NOT leak via getCategoryMeta
        status: 'POSTED',
        isTransfer: false,
        isSplitParent: false,
      })
    ).id;
    eurTxn = (
      await mkTxn({
        accountId: eurSharedAcct,
        date: '2026-07-05',
        amountCents: -1000,
        rawDescriptor: 'EURO CAFE',
        categoryId: 'dining',
        status: 'POSTED',
        isTransfer: false,
        isSplitParent: false,
      })
    ).id;
    sharedTxnMutable = (
      await mkTxn({
        accountId: sharedAcct,
        date: '2026-07-06',
        amountCents: -3000,
        rawDescriptor: 'PAT GAS STATION',
        categoryId: 'groceries',
        status: 'POSTED',
        isTransfer: false,
        isSplitParent: false,
      })
    ).id;
    investTxn = (
      await mkTxn({
        accountId: investSharedAcct,
        date: '2026-07-07',
        amountCents: -20000,
        rawDescriptor: 'BROKERAGE FEE',
        categoryId: 'groceries',
        status: 'POSTED',
        isTransfer: false,
        isSplitParent: false,
      })
    ).id;
    // Prediction ground truth belongs to the transaction's OWNER (partnerId) —
    // predictions are logged at ingest under whoever owns the row. Seeded
    // un-labeled (labeledAt null), same as a real ingested prediction, so the
    // slice-6 "never stamps ground truth" test has something to prove untouched.
    await prisma.categoryPrediction.create({
      data: {
        userId: partnerId,
        transactionId: sharedTxnMutable,
        predictedCategoryId: 'groceries',
        confidenceBps: 8000,
      },
    });
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T6: no household → kind none (nothing rendered — golden/demo safe)', async () => {
    actAs(strangerId);
    expect(await getSharedTransactionsView()).toEqual({ kind: 'none' });
  });

  it('T1: shared view shows partner-SHARED spending rows only — private + EUR absent; owner-badged', async () => {
    actAs(ownerId);
    const view = await getSharedTransactionsView();
    expect(view.kind).toBe('member');
    if (view.kind !== 'member') return;
    expect(view.householdName).toBe('Casa Txn');
    const ids = view.rows.map((r) => r.id);
    expect(ids).toContain(sharedTxn);
    expect(ids).toContain(sharedCustomTxn);
    expect(ids).not.toContain(privateTxn); // T1
    expect(ids).not.toContain(eurTxn); // currency guard
    expect(ids).not.toContain(ownTxn); // own rows stay in getTransactions
    const grocery = view.rows.find((r) => r.id === sharedTxn)!;
    expect(grocery).toMatchObject({
      categoryName: 'Groceries',
      ownerLabel: 'Pat Partner',
      accountName: 'Pat Checking',
      amountCents: -4500,
    });
    // Custom category on a SHARED row resolves by scoped id — visible label only.
    const golf = view.rows.find((r) => r.id === sharedCustomTxn)!;
    expect(golf.categoryName).toBe('Partner Golf');
    expect(golf.ownerLabel).toBe('Pat Partner');
  });

  it('personal getTransactions stays OWNED-only — shared partner rows never enter summary', async () => {
    const result = await getTransactions(ownerId);
    const ids = new Set(result.rows.map((r) => r.id));
    expect(ids.has(ownTxn)).toBe(true);
    expect(ids.has(sharedTxn)).toBe(false);
    expect(ids.has(privateTxn)).toBe(false);
  });

  it('F3: getCategoryMeta(viewer) does NOT gain the partner custom vocabulary', async () => {
    const meta = await getCategoryMeta(ownerId);
    expect(meta.has(partnerCustomCat)).toBe(false);
    expect(meta.has(partnerHiddenCat)).toBe(false);
    // The shared-row label still resolves via the scoped helper alone.
    const names = await categoryNamesByIds([partnerCustomCat, partnerHiddenCat]);
    expect(names.get(partnerCustomCat)).toBe('Partner Golf');
    // Hidden id is only resolvable if asked — the shared view never asks for it
    // (locked by the T1 absence of privateTxn above). Asking here proves the
    // helper itself is id-scoped, not "load all partner customs".
    expect(names.get(partnerHiddenCat)).toBe('Secret Therapy');
  });

  it('T3: partner cannot recategorize a shared-account transaction (owner scope)', async () => {
    actAs(ownerId);
    await expect(
      recategorize({ transactionId: sharedTxn, categoryId: 'dining', scope: 'one' }),
    ).rejects.toThrow(/Transaction not found/);
    // Row untouched.
    const row = await prisma.transaction.findUnique({ where: { id: sharedTxn } });
    expect(row?.categoryId).toBe('groceries');
  });

  describe('slice 6: recategorizeSharedTransaction (T3 boundary — §6.1)', () => {
    it('a household member can re-file a partner-shared transaction ONE-OFF — no rule, no labeledAt stamp', async () => {
      actAs(ownerId);
      const res = await recategorizeSharedTransaction({
        transactionId: sharedTxnMutable,
        categoryId: 'dining',
      });
      expect(res).toEqual({ ok: true });

      const row = await prisma.transaction.findUnique({ where: { id: sharedTxnMutable } });
      expect(row?.categoryId).toBe('dining');
      expect(row?.needsReview).toBe(false);

      // Correction is attributed to the ACTING user, not the transaction's owner.
      const corrections = await prisma.correction.findMany({
        where: { transactionId: sharedTxnMutable },
      });
      expect(corrections).toHaveLength(1);
      expect(corrections[0]).toMatchObject({
        userId: ownerId,
        fromCategoryId: 'groceries',
        toCategoryId: 'dining',
        becameRuleId: null,
      });

      // No "Always" rule was minted for either user (§6.1: ingest-time rule
      // application stays owner-only — a partner write must never mint one).
      const rules = await prisma.categorizationRule.count({
        where: { userId: { in: [ownerId, partnerId] } },
      });
      expect(rules).toBe(0);

      // The owner's (partnerId's) CategoryPrediction ground truth is untouched —
      // per-user Brier tuning (#190) stays single-teacher by construction.
      const prediction = await prisma.categoryPrediction.findUnique({
        where: { transactionId: sharedTxnMutable },
      });
      expect(prediction?.actualCategoryId).toBeNull();
      expect(prediction?.labeledAt).toBeNull();

      // Audit meta identifies the IN-TX-RESOLVED row (account + owner), not
      // just the raw input — an actor must never control what the audit trail
      // says was affected (hostile-critic finding).
      const audit = await prisma.auditLog.findFirst({
        where: { userId: ownerId, action: 'household.transaction.recategorize' },
        orderBy: { createdAt: 'desc' },
      });
      const meta = JSON.parse(audit!.meta) as Record<string, unknown>;
      expect(meta).toMatchObject({
        transactionId: sharedTxnMutable,
        accountId: sharedAcct,
        ownerUserId: partnerId,
        categoryId: 'dining',
      });
    });

    it('rejects attacker-shaped (non-scalar) input before it reaches a Prisma where-clause', async () => {
      actAs(ownerId);
      const beforeRow = await prisma.transaction.findUnique({ where: { id: sharedTxn } });
      // An object in place of transactionId would otherwise be trusted in as a
      // Prisma filter operator (e.g. `{ contains: '' }`), matching an arbitrary row.
      let res = await recategorizeSharedTransaction({
        // @ts-expect-error deliberately attacker-shaped input
        transactionId: { contains: '' },
        categoryId: 'dining',
      });
      expect(res).toEqual({ ok: false, error: 'Transaction not found' });
      // Scalar validation catches non-scalar categoryId too, under the SAME
      // generic message as any other malformed request — no field-specific
      // error leaks which argument was rejected.
      res = await recategorizeSharedTransaction({
        transactionId: sharedTxn,
        // @ts-expect-error deliberately attacker-shaped input
        categoryId: { not: 'nope' },
      });
      expect(res).toEqual({ ok: false, error: 'Transaction not found' });
      const afterRow = await prisma.transaction.findUnique({ where: { id: sharedTxn } });
      expect(afterRow?.categoryId).toBe(beforeRow?.categoryId);
    });

    it('rejects the internal `uncategorized` placeholder — filing "as undecided" is not a decision', async () => {
      actAs(ownerId);
      const res = await recategorizeSharedTransaction({
        transactionId: sharedTxn,
        categoryId: 'uncategorized',
      });
      expect(res).toEqual({ ok: false, error: 'Choose a valid category' });
    });

    it('a non-spending shared account (INVESTMENT) stays out of reach — same type guard as the shared view', async () => {
      actAs(ownerId);
      const res = await recategorizeSharedTransaction({
        transactionId: investTxn,
        categoryId: 'dining',
      });
      expect(res).toEqual({ ok: false, error: 'Transaction not found' });
    });

    it('rejects a custom category id — the ACTING user\'s own custom is rejected too (never widens vocabulary)', async () => {
      actAs(ownerId);
      const beforeRow = await prisma.transaction.findUnique({ where: { id: sharedTxn } });
      // The partner's own custom category.
      let res = await recategorizeSharedTransaction({
        transactionId: sharedTxn,
        categoryId: partnerCustomCat,
      });
      expect(res).toEqual({ ok: false, error: 'Choose a valid category' });
      // The ACTING user's own custom category — also rejected (system-only, no
      // exceptions; assertOwnedCategory's ownership branch must never be reused
      // here, or the acting user's vocabulary would cross onto the owner's row).
      res = await recategorizeSharedTransaction({
        transactionId: sharedTxn,
        categoryId: ownerCustomCat,
      });
      expect(res).toEqual({ ok: false, error: 'Choose a valid category' });
      const afterRow = await prisma.transaction.findUnique({ where: { id: sharedTxn } });
      expect(afterRow?.categoryId).toBe(beforeRow?.categoryId);
    });

    it('a private (unshared) transaction stays out of reach', async () => {
      actAs(ownerId);
      const res = await recategorizeSharedTransaction({
        transactionId: privateTxn,
        categoryId: 'dining',
      });
      expect(res).toEqual({ ok: false, error: 'Transaction not found' });
      const row = await prisma.transaction.findUnique({ where: { id: privateTxn } });
      expect(row?.categoryId).toBe(partnerHiddenCat);
    });

    it('a non-currency-supported (EUR) shared transaction stays out of reach — same guard as the shared view', async () => {
      actAs(ownerId);
      const res = await recategorizeSharedTransaction({
        transactionId: eurTxn,
        categoryId: 'dining',
      });
      expect(res).toEqual({ ok: false, error: 'Transaction not found' });
    });

    it('a user with no household cannot recategorize anything', async () => {
      actAs(strangerId);
      const res = await recategorizeSharedTransaction({
        transactionId: sharedTxn,
        categoryId: 'dining',
      });
      expect(res).toEqual({ ok: false, error: 'Transaction not found' });
    });
  });

  it('T2/T4: after leave, shared transactions vanish immediately', async () => {
    actAs(ownerId);
    expect((await getSharedTransactionsView()).kind).toBe('member');
    // Leave as the partner so the owner's household still exists but has no
    // partners → partnerSharedAccountsWhere returns null → empty rows.
    actAs(partnerId);
    expect(await leaveHousehold()).toEqual({ ok: true });
    actAs(ownerId);
    const view = await getSharedTransactionsView();
    expect(view.kind).toBe('member');
    if (view.kind !== 'member') return;
    expect(view.rows).toEqual([]);

    // T3 slice 6: the write path degenerates the same way the read path does —
    // no live partners means recategorizeSharedTransaction has nothing to act on.
    const res = await recategorizeSharedTransaction({
      transactionId: sharedTxnMutable,
      categoryId: 'groceries',
    });
    expect(res).toEqual({ ok: false, error: 'Transaction not found' });
  });
});

describe('slice 6 grep-lock (T3): recategorizeSharedTransaction is the ONLY partner-write path', () => {
  const stripComments = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
      .filter((l) => l.trim().length > 0)
      .join('\n');

  it('household.ts (the shared READ assembly) contains no Prisma mutation call — mutations live only in household-actions.ts', () => {
    const src = stripComments(readFileSync('src/server/household.ts', 'utf8'));
    expect(src, 'household.ts must stay read-only').not.toMatch(
      /prisma\.\w+\.(create|update|updateMany|delete|deleteMany|upsert)\(/,
    );
  });

  it('household-actions.ts: exactly ONE Correction-creating write, and it never mints a rule or stamps CategoryPrediction', () => {
    const src = stripComments(readFileSync('src/server/household-actions.ts', 'utf8'));
    // The slice-6 write is the ONLY place this file creates a Correction row
    // (createMany counted too — a batch creator would be exactly the §6.1
    // violation this lock exists to catch).
    expect(
      (src.match(/\.correction\.(create|createMany)\(/g) ?? []).length,
      'household-actions.ts: correction.create(Many) call sites',
    ).toBe(1);
    // No rule minting, no prediction-labeling — the §6.1 boundary is banned at
    // the SOURCE level, not just proven empty by the integration test above.
    expect(src).not.toMatch(/categorizationRule\.(create|createMany|upsert)\(/);
    expect(src).not.toMatch(/ensureUnconditionalRule/);
    expect(src).not.toMatch(/categoryPrediction\.(update|updateMany|upsert)\(/);
  });

  it('SharedTransactionList never imports a batch/rule/custom-category affordance — including the OWNER-only actions', () => {
    // Strip comments/prose first: the doc comment legitimately SAYS "no Always
    // rule" — this checks for the affordance actually being wired in, not for
    // the word appearing in documentation.
    const src = stripComments(
      readFileSync('src/components/finance/shared-transaction-list.tsx', 'utf8'),
    );
    expect(src).not.toMatch(
      /applyToAllSimilar|fileMerchantGroup|createCustomCategory|recat-always|makeRuleFromCorrection|from ['"]@\/server\/triage-actions['"]/,
    );
  });
});
