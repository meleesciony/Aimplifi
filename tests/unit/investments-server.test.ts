/**
 * Investments server layer (DECISIONS #78) — getInvestments read-path + manual entry,
 * driven against a throwaway user with a MOCKED auth session (the simplefin.test.ts
 * pattern). Proves the portfolio roll-up matches hand-computed values and that add /
 * remove are ownership- and type-scoped.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { addHolding, getInvestments, removeHolding } from '@/server/investments';
import { prisma } from '@/lib/db';

const USER = `inv-user-${Date.now()}-${process.pid}`;
const OTHER = `inv-other-${Date.now()}-${process.pid}`;
const ACCT = `inv-acct-${USER}`;
const CHECKING = `inv-chk-${USER}`;
const OTHER_ACCT = `inv-acct-${OTHER}`;

async function wipe() {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
}

beforeAll(async () => {
  await wipe();
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  await prisma.user.create({ data: { id: OTHER, email: `${OTHER}@test.local` } });
  await prisma.account.create({ data: { id: ACCT, userId: USER, provider: 'demo', name: 'Brokerage', type: 'INVESTMENT', currentBalanceCents: 125000 } });
  await prisma.account.create({ data: { id: CHECKING, userId: USER, provider: 'demo', name: 'Checking', type: 'CHECKING', currentBalanceCents: 50000 } });
  await prisma.account.create({ data: { id: OTHER_ACCT, userId: OTHER, provider: 'demo', name: 'Other Brokerage', type: 'INVESTMENT', currentBalanceCents: 0 } });
  await prisma.holding.createMany({
    data: [
      { accountId: ACCT, symbol: 'AAA', name: 'Alpha', quantity: 10, costBasisCents: 80000, priceCents: 10000 }, // MV 100000, gain +20000
      { accountId: ACCT, symbol: 'BBB', name: 'Beta', quantity: 5, costBasisCents: 30000, priceCents: 5000 }, //   MV  25000, gain  −5000
    ],
  });
});
afterAll(wipe);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
});

describe('getInvestments — portfolio roll-up', () => {
  it('aggregates holdings into the right totals, only for INVESTMENT accounts', async () => {
    const view = await getInvestments();
    expect(view.accounts).toHaveLength(1); // checking account excluded
    expect(view.accounts[0].accountId).toBe(ACCT);
    expect(view.accounts[0].accountBalanceCents).toBe(125000);
    expect(view.overall.totalMarketValueCents).toBe(125000); // 100000 + 25000
    expect(view.overall.totalCostBasisCents).toBe(110000); //   80000 + 30000
    expect(view.overall.totalUnrealizedGainCents).toBe(15000);
    expect(view.overall.positions.find((p) => p.symbol === 'AAA')!.unrealizedGainCents).toBe(20000);
    expect(view.overall.positions.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 10);
  });
});

describe('addHolding / removeHolding — ownership- and type-scoped manual entry', () => {
  it('adds a new holding (ticker upcased) and it shows up in the roll-up', async () => {
    const r = await addHolding({ accountId: ACCT, symbol: 'ccc', quantity: 2, costBasisCents: 150000, priceCents: 100000 });
    expect(r.ok).toBe(true);
    const view = await getInvestments();
    expect(view.overall.totalMarketValueCents).toBe(325000); // + 200000
    expect(view.overall.positions.find((p) => p.symbol === 'CCC')).toBeDefined();
  });

  it('upserts by ticker — same symbol updates in place, never duplicates', async () => {
    await addHolding({ accountId: ACCT, symbol: 'CCC', quantity: 3, costBasisCents: 150000, priceCents: 100000 });
    const rows = await prisma.holding.findMany({ where: { accountId: ACCT, symbol: 'CCC' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(3);
  });

  it('manual entry stores NO authoritative total — the engine derives from price (DECISIONS #129)', async () => {
    await addHolding({ accountId: ACCT, symbol: 'MAN', quantity: 4, costBasisCents: 100000, priceCents: 50000 });
    const row = await prisma.holding.findFirstOrThrow({ where: { accountId: ACCT, symbol: 'MAN' } });
    expect(row.marketValueCents).toBeNull(); // price-derived, not an authoritative total
    const view = await getInvestments();
    expect(view.overall.positions.find((p) => p.symbol === 'MAN')!.marketValueCents).toBe(200000); // round(4 × 50000)
  });

  it('editing a previously-fed holding by hand CLEARS the stale feed total for THIS edit (DECISIONS #129)', async () => {
    // Scope: this asserts the IMMEDIATE post-edit state — the stale authoritative total is
    // dropped so the hand-entered per-share price is shown. It does NOT claim cross-sync
    // durability: the row keeps source='simplefin', so a later sync may re-ingest it (the
    // existing #124 reconcile behavior, unchanged by this fix; critic P2-1).
    // A previously-synced simplefin row carrying an authoritative total of $50.00.
    await prisma.holding.create({
      data: { accountId: ACCT, symbol: 'FED', quantity: 10, costBasisCents: 50000, priceCents: 1, marketValueCents: 5000, source: 'simplefin' },
    });
    // The user manually re-enters it at a real $60.00/share.
    expect((await addHolding({ accountId: ACCT, symbol: 'FED', quantity: 10, costBasisCents: 50000, priceCents: 6000 })).ok).toBe(true);
    const row = await prisma.holding.findFirstOrThrow({ where: { accountId: ACCT, symbol: 'FED' } });
    expect(row.marketValueCents).toBeNull(); // the stale $50.00 total is cleared
    const view = await getInvestments();
    expect(view.overall.positions.find((p) => p.symbol === 'FED')!.marketValueCents).toBe(60000); // round(10 × 6000) = $600.00, not the stale 5000
  });

  it('rejects bad input without writing', async () => {
    expect((await addHolding({ accountId: ACCT, symbol: '', quantity: 1, costBasisCents: 0, priceCents: 100 })).ok).toBe(false);
    expect((await addHolding({ accountId: ACCT, symbol: 'ZZZ', quantity: 0, costBasisCents: 0, priceCents: 100 })).ok).toBe(false);
    expect(await prisma.holding.findFirst({ where: { accountId: ACCT, symbol: 'ZZZ' } })).toBeNull();
  });

  it('refuses to add to an account the user does not own', async () => {
    const r = await addHolding({ accountId: OTHER_ACCT, symbol: 'XXX', quantity: 1, costBasisCents: 100, priceCents: 100 });
    expect(r.ok).toBe(false);
    expect(await prisma.holding.findFirst({ where: { accountId: OTHER_ACCT, symbol: 'XXX' } })).toBeNull();
  });

  it('refuses to add to a non-INVESTMENT account', async () => {
    expect((await addHolding({ accountId: CHECKING, symbol: 'YYY', quantity: 1, costBasisCents: 100, priceCents: 100 })).ok).toBe(false);
  });

  it('removeHolding only deletes the user’s own holding', async () => {
    const foreign = await prisma.holding.create({ data: { accountId: OTHER_ACCT, symbol: 'FGN', quantity: 1, costBasisCents: 100, priceCents: 100 } });
    await removeHolding(foreign.id); // acting as USER, not OTHER
    expect(await prisma.holding.findUnique({ where: { id: foreign.id } })).not.toBeNull(); // survives

    const own = await prisma.holding.findFirst({ where: { accountId: ACCT, symbol: 'AAA' } });
    await removeHolding(own!.id);
    expect(await prisma.holding.findUnique({ where: { id: own!.id } })).toBeNull(); // removed
  });
});

describe('addHolding — input hardening (a bad row can never break the read path)', () => {
  it('rejects non-finite / overflow quantity, writing nothing', async () => {
    expect((await addHolding({ accountId: ACCT, symbol: 'INF', quantity: Infinity, costBasisCents: 100, priceCents: 100 })).ok).toBe(false);
    expect((await addHolding({ accountId: ACCT, symbol: 'NAN', quantity: NaN, costBasisCents: 100, priceCents: 100 })).ok).toBe(false);
    expect((await addHolding({ accountId: ACCT, symbol: 'OVR', quantity: 1e15, costBasisCents: 100, priceCents: 100 })).ok).toBe(false); // 1e15 × 100 overflows
    expect(await prisma.holding.findFirst({ where: { accountId: ACCT, symbol: { in: ['INF', 'NAN', 'OVR'] } } })).toBeNull();
    await expect(getInvestments()).resolves.toBeDefined(); // read path still resolves
  });

  it('rejects non-safe-integer / fractional cents', async () => {
    expect((await addHolding({ accountId: ACCT, symbol: 'FLT', quantity: 1, costBasisCents: 1.5, priceCents: 100 })).ok).toBe(false);
    expect((await addHolding({ accountId: ACCT, symbol: 'UNSAFE', quantity: 1, costBasisCents: 100, priceCents: 2 ** 53 })).ok).toBe(false);
  });

  it('rejects an invalid or oversized ticker symbol', async () => {
    expect((await addHolding({ accountId: ACCT, symbol: 'A'.repeat(40), quantity: 1, costBasisCents: 100, priceCents: 100 })).ok).toBe(false);
    expect((await addHolding({ accountId: ACCT, symbol: '日本株', quantity: 1, costBasisCents: 100, priceCents: 100 })).ok).toBe(false);
    expect(await prisma.holding.count({ where: { accountId: ACCT, symbol: { contains: '日' } } })).toBe(0);
  });
});

describe('getInvestments — surfaces holding provenance to the UI (DECISIONS #180)', () => {
  it('exposes each position’s source so the view can badge a synced feed holding', async () => {
    // A synced (feed) holding and a default (manual) holding, created directly.
    await prisma.holding.createMany({
      data: [
        { accountId: ACCT, symbol: 'SYNC', quantity: 1, costBasisCents: 1000, priceCents: 1200, marketValueCents: 1200, source: 'simplefin' },
        { accountId: ACCT, symbol: 'HAND', quantity: 1, costBasisCents: 1000, priceCents: 1200 }, // source defaults to 'manual'
      ],
    });
    try {
      const view = await getInvestments();
      const synced = view.overall.positions.find((p) => p.symbol === 'SYNC')!;
      const manual = view.overall.positions.find((p) => p.symbol === 'HAND')!;
      expect(synced.source).toBe('simplefin'); // → holdingProvenance renders a "Synced" badge
      expect(manual.source).toBe('manual'); //    → holdingProvenance renders no badge (demo-safe)
    } finally {
      await prisma.holding.deleteMany({ where: { accountId: ACCT, symbol: { in: ['SYNC', 'HAND'] } } });
    }
  });
});
