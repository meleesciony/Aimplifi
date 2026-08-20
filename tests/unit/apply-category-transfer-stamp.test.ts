/**
 * O.20j hand-file stamp (DECISIONS #491): applyCategory (and twin file paths)
 * must set `isTransfer: true` when the owner files the Transfer leaf, so
 * register filter / inbox / recurring match immediately — not only after the
 * next sync detector (#487). Filing away from Transfer does NOT clear the
 * flag: H.7b (#428) is deliberately the app's only `isTransfer: false` writer.
 *
 * Fail-old: restore the pre-#491 update (no isTransfer in data) ⇒ Transfer
 * file leaves the flag false.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { applyCategory, applyToAllSimilar, fileMerchantGroup, recategorize } from '@/server/triage-actions';
import { prisma } from '@/lib/db';

describe('applyCategory stamps isTransfer on Transfer leaf (O.20j / DECISIONS #491)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `xferstamp-user-${stamp}`;
  const MERCHANT_CANON = `XferStamp Merchant ${stamp}`;
  let acctId = '';
  let merchId = '';
  let singleId = '';
  let siblingId = '';
  let flaggedSpendId = '';
  let groupAnchorId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.merchant.deleteMany({ where: { canonical: MERCHANT_CANON } });
  }

  beforeAll(async () => {
    await wipe();
    for (const c of [
      { id: 'shopping', name: 'Shopping' },
      { id: 'dining', name: 'Dining Out' },
      { id: 'transfer', name: 'Transfer' },
    ]) {
      await prisma.category.upsert({
        where: { id: c.id },
        update: {},
        create: { id: c.id, name: c.name, isSystem: true },
      });
    }
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'demo',
        name: 'T',
        type: 'CHECKING',
        currentBalanceCents: 0,
      },
    });
    acctId = acct.id;
    const merch = await prisma.merchant.create({ data: { canonical: MERCHANT_CANON } });
    merchId = merch.id;

    singleId = (
      await prisma.transaction.create({
        data: {
          accountId: acctId,
          date: '2026-06-01',
          amountCents: -5000,
          rawDescriptor: `XFER STAMP SINGLE ${stamp}`,
          merchantId: merchId,
          categoryId: 'shopping',
          needsReview: true,
          confidenceBps: 5000,
          isTransfer: false,
        },
      })
    ).id;

    siblingId = (
      await prisma.transaction.create({
        data: {
          accountId: acctId,
          date: '2026-06-02',
          amountCents: -5100,
          rawDescriptor: `XFER STAMP SIBLING ${stamp}`,
          merchantId: merchId,
          categoryId: 'shopping',
          needsReview: true,
          confidenceBps: 5000,
          isTransfer: false,
        },
      })
    ).id;

    flaggedSpendId = (
      await prisma.transaction.create({
        data: {
          accountId: acctId,
          date: '2026-06-03',
          amountCents: -5200,
          rawDescriptor: `XFER STAMP FLAGGED SPEND ${stamp}`,
          merchantId: merchId,
          categoryId: 'transfer',
          needsReview: false,
          confidenceBps: 9900,
          // Converse-leak shape: already flagged; filing to a spend leaf must
          // NOT clear (H.7b is the only clear path).
          isTransfer: true,
        },
      })
    ).id;

    groupAnchorId = (
      await prisma.transaction.create({
        data: {
          accountId: acctId,
          date: '2026-06-04',
          amountCents: -5300,
          rawDescriptor: `XFER STAMP GROUP ${stamp}`,
          merchantId: merchId,
          categoryId: 'uncategorized',
          needsReview: true,
          confidenceBps: 5000,
          isTransfer: false,
        },
      })
    ).id;
  });

  afterAll(wipe);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  it('test_regression__o20j_apply_category_transfer_stamps_is_transfer', async () => {
    const res = await applyCategory({ transactionId: singleId, categoryId: 'transfer' });
    expect(res.affected).toBe(1);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: singleId } });
    expect(row.categoryId).toBe('transfer');
    expect(row.isTransfer).toBe(true);
    expect(row.needsReview).toBe(false);
  });

  it('test_regression__o20j_file_off_transfer_does_not_clear_is_transfer', async () => {
    const res = await applyCategory({ transactionId: flaggedSpendId, categoryId: 'dining' });
    expect(res.affected).toBe(1);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: flaggedSpendId } });
    expect(row.categoryId).toBe('dining');
    // #428: only H.7b writes isTransfer:false — owner re-file must not invent a clear.
    expect(row.isTransfer).toBe(true);
  });

  it('test_regression__o20j_apply_to_all_similar_transfer_stamps_is_transfer', async () => {
    // Reset sibling to a known unflagged spend state (single was already filed).
    await prisma.transaction.update({
      where: { id: siblingId },
      data: {
        categoryId: 'shopping',
        needsReview: true,
        isTransfer: false,
        confidenceBps: 5000,
      },
    });
    const res = await applyToAllSimilar({ transactionId: siblingId, categoryId: 'transfer' });
    expect(res.affected).toBeGreaterThanOrEqual(1);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: siblingId } });
    expect(row.categoryId).toBe('transfer');
    expect(row.isTransfer).toBe(true);
  });

  it('test_regression__o20j_recategorize_merchant_transfer_stamps_is_transfer', async () => {
    // Fresh merchant-scoped row so this case does not depend on prior mutations.
    const fresh = await prisma.transaction.create({
      data: {
        accountId: acctId,
        date: '2026-06-05',
        amountCents: -5400,
        rawDescriptor: `XFER STAMP RECAT ${stamp}`,
        merchantId: merchId,
        categoryId: 'shopping',
        needsReview: false,
        confidenceBps: 9500,
        isTransfer: false,
      },
    });
    const res = await recategorize({
      transactionId: fresh.id,
      categoryId: 'transfer',
      scope: 'merchant',
    });
    expect(res.affected).toBeGreaterThanOrEqual(1);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(row.categoryId).toBe('transfer');
    expect(row.isTransfer).toBe(true);
  });

  it('test_regression__o20j_file_merchant_group_transfer_stamps_is_transfer', async () => {
    await prisma.transaction.update({
      where: { id: groupAnchorId },
      data: {
        categoryId: 'uncategorized',
        needsReview: true,
        isTransfer: false,
        confidenceBps: 5000,
      },
    });
    const res = await fileMerchantGroup({
      anchorTransactionId: groupAnchorId,
      categoryId: 'transfer',
    });
    expect(res.affected).toBeGreaterThanOrEqual(1);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: groupAnchorId } });
    expect(row.categoryId).toBe('transfer');
    expect(row.isTransfer).toBe(true);
  });
});
