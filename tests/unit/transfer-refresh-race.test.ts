/**
 * test_regression__transfer_filing_read_write_race (#165 cycle-2 checker P1).
 *
 * refreshTransferFlags plans its filing from a snapshot, and the read→write
 * window contains an awaited ensureCategories() call. A user decision landing
 * inside that window (filing the row, or an undo PINNING it) must be skipped,
 * not clobbered — the write re-asserts every read guard (the backfill cycle-5
 * precedent). Fail-old by construction: with a bare `id IN (...)` write-where,
 * both tests' rows get overwritten to 'transfer'.
 *
 * The race is made deterministic by mocking ensureCategories to perform the
 * user's mid-window action — it runs exactly between the plan and the write.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let midWindow: (() => Promise<void>) | null = null;
vi.mock('@/server/ensure-categories', () => ({
  ensureCategories: async () => {
    if (midWindow) await midWindow();
  },
}));

import { prisma } from '@/lib/db';
import { refreshTransferFlags } from '@/lib/providers/transfer-refresh';

describe('refreshTransferFlags read→write race (cycle-2 P1 lock)', () => {
  const USER = `tpfr-${Date.now()}-${process.pid}`;
  let CHECKING = '';
  let CARD = '';

  async function wipe() {
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    // The mocked ensureCategories never creates the 'transfer' Category row;
    // the seeded demo dataset already ensured it in this test DB.
  });
  afterAll(wipe);

  beforeEach(async () => {
    midWindow = null;
    await prisma.account.deleteMany({ where: { userId: USER } });
    CHECKING = (
      await prisma.account.create({
        data: { userId: USER, provider: 'simplefin', providerRef: 'tpfr-chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500_000, currency: 'USD' },
      })
    ).id;
    CARD = (
      await prisma.account.create({
        data: { userId: USER, provider: 'simplefin', providerRef: 'tpfr-card', name: 'Card', type: 'CREDIT', currentBalanceCents: -123_456, currency: 'USD' },
      })
    ).id;
    await prisma.transaction.createMany({
      data: [
        { id: `${USER}-out`, accountId: CHECKING, date: '2026-06-10', amountCents: -123_456, rawDescriptor: 'CREDIT CARD PAID', categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
        { id: `${USER}-in`, accountId: CARD, date: '2026-06-11', amountCents: 123_456, rawDescriptor: 'PAYMENT RECEIVED - THANK YOU', categoryId: 'uncategorized', confidenceBps: 5000, needsReview: true },
      ],
    });
  });

  it('a row the USER FILES inside the window is skipped, not clobbered', async () => {
    midWindow = async () => {
      await prisma.transaction.update({
        where: { id: `${USER}-out` },
        data: { categoryId: 'dining', confidenceBps: 10_000, needsReview: false },
      });
    };
    const res = await refreshTransferFlags(USER);
    expect(res.filed).toBe(1); // only the untouched side — honest count from the guarded write
    const out = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-out` } });
    expect(out.categoryId).toBe('dining'); // the user's just-committed decision stands
    expect(out.needsReview).toBe(false);
    expect(out.isTransfer).toBe(true); // the additive flag still lands (sums correct)
    const inn = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-in` } });
    expect(inn.categoryId).toBe('transfer'); // the unraced side files normally
  });

  /**
   * Cycle-2 critic P2-4: the file write claims to "re-assert EVERY read guard",
   * and `needsReview`/`reviewPinned` above prove two of the four. Deleting the
   * other two — `status: 'POSTED'` and the currency OR — left 115 tests green.
   * Both matter only inside this window, which is exactly what this file exists
   * to execute.
   */
  it('a row that goes PENDING inside the window is skipped, not filed', async () => {
    midWindow = async () => {
      await prisma.transaction.update({
        where: { id: `${USER}-out` },
        data: { status: 'PENDING' },
      });
    };
    const res = await refreshTransferFlags(USER);
    expect(res.filed).toBe(1); // only the untouched side
    const out = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-out` } });
    // A pending amount can resettle under a new id; filing it would leave a
    // one-sided transfer (#165 critic F3).
    expect(out.categoryId).toBe('uncategorized');
    expect(out.needsReview).toBe(true);
  });

  it('a row whose ACCOUNT CURRENCY flips to non-USD inside the window is skipped', async () => {
    midWindow = async () => {
      await prisma.account.update({ where: { id: CHECKING }, data: { currency: 'EUR' } });
    };
    const res = await refreshTransferFlags(USER);
    expect(res.filed).toBe(1); // only the still-USD side
    const out = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-out` } });
    // The currency guard withholds withheld-currency rows from every system
    // write (DECISIONS #135), inside the window as well as before it.
    expect(out.categoryId).toBe('uncategorized');
    expect(out.needsReview).toBe(true);
  });

  it('a row an UNDO PINS inside the window is skipped — no pinned-but-filed wedge', async () => {
    midWindow = async () => {
      await prisma.transaction.update({
        where: { id: `${USER}-out` },
        data: { reviewPinned: true },
      });
    };
    const res = await refreshTransferFlags(USER);
    expect(res.filed).toBe(1);
    const out = await prisma.transaction.findUniqueOrThrow({ where: { id: `${USER}-out` } });
    expect(out.reviewPinned).toBe(true);
    expect(out.needsReview).toBe(true); // still the user's to decide
    expect(out.categoryId).toBe('uncategorized'); // never filed over the pin
  });
});
