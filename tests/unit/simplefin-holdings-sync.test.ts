/**
 * SimpleFIN brokerage-HOLDINGS ingest (DECISIONS #124) — real connect/sync actions
 * against a throwaway user with a MOCKED SimpleFIN server returning an INVESTMENT
 * account that carries `holdings`. Proves: positions ingest as source='simplefin'
 * with correct cents; net worth stays on the authoritative account balance (holdings
 * are a within-account breakdown); idempotent re-sync; reconciliation deletes sold
 * positions; a manually-entered holding on the same account SURVIVES; and a brokerage's
 * trades are still NOT ingested as spending (#62). Live network is UNVERIFIED.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { connectSimplefin, syncSimplefinNow } from '@/server/simplefin-actions';
import { getInvestments } from '@/server/investments';
import { prisma } from '@/lib/db';

const CLAIM_URL = 'https://claim.example/abc123';
const SETUP_TOKEN = Buffer.from(CLAIM_URL, 'utf8').toString('base64');
const ACCESS_URL = 'https://ro-user:secret@bridge.example/simplefin';
const KEY = Buffer.alloc(32, 7).toString('base64');

interface RawHolding {
  id: string;
  symbol?: string;
  description?: string;
  shares?: string;
  cost_basis?: string;
  market_value?: string;
}
interface RawAccount {
  id: string;
  name: string;
  balance: string;
  org?: { name?: string };
  holdings?: RawHolding[];
  transactions?: { id: string; posted: number; amount: string; description?: string }[];
}

// $142,000 account balance, but holdings total only $70,000 — deliberately DIFFERENT
// so a test can prove net worth follows the account balance, not the holdings sum.
const DEFAULT_HOLDINGS: RawHolding[] = [
  { id: 'p1', symbol: 'AAPL', description: 'Apple Inc', shares: '100', cost_basis: '15000.00', market_value: '20000.00' },
  { id: 'p2', symbol: 'VTI', description: 'Vanguard Total Mkt', shares: '200', cost_basis: '40000.00', market_value: '50000.00' },
];
const brokerage = (holdings: RawHolding[], transactions: RawAccount['transactions'] = []): RawAccount => ({
  id: 'brk-1',
  name: 'Brokerage',
  balance: '142000.00',
  org: { name: 'Vanguard' },
  holdings,
  transactions,
});

let accountsPayload: { accounts: RawAccount[] } = { accounts: [] };

function mockServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if (init?.method === 'POST' && url === CLAIM_URL) {
        return { ok: true, status: 200, text: async () => ACCESS_URL } as Response;
      }
      if (url.startsWith('https://bridge.example/simplefin/accounts')) {
        return { ok: true, status: 200, json: async () => accountsPayload } as Response;
      }
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) } as Response;
    }),
  );
}

describe('SimpleFIN holdings ingest (real actions, mocked server)', () => {
  const USER = `sf-hold-${Date.now()}-${process.pid}`;

  async function wipe() {
    await prisma.account.deleteMany({ where: { userId: USER } }); // cascades holdings + txns
    await prisma.simpleFinConnection.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(wipe);
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
    vi.stubEnv('DEMO_TODAY', '2026-06-10');
    // Clean slate each test: drop the user's accounts (cascade) + connection.
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: USER } });
    accountsPayload = { accounts: [brokerage(DEFAULT_HOLDINGS)] };
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('ingests holdings as source=simplefin with correct cents; account type INVESTMENT', async () => {
    const r = await connectSimplefin(SETUP_TOKEN);
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.added).toBe(0); // no spending transactions on a brokerage
    expect(r.holdings).toEqual({ upserted: 2, removed: 0, skipped: 0 });

    const acct = await prisma.account.findFirst({
      where: { userId: USER, provider: 'simplefin', providerRef: 'brk-1' },
    });
    expect(acct!.type).toBe('INVESTMENT');
    expect(acct!.currentBalanceCents).toBe(14200000); // $142,000, authoritative

    const holdings = await prisma.holding.findMany({
      where: { account: { userId: USER } },
      orderBy: { symbol: 'asc' },
    });
    expect(holdings).toHaveLength(2);
    expect(holdings[0]).toMatchObject({
      symbol: 'AAPL',
      name: 'Apple Inc',
      quantity: 100,
      costBasisCents: 1500000,
      priceCents: 20000, // round($20,000 ÷ 100)
      marketValueCents: 2000000, // $20,000 authoritative total persisted (DECISIONS #129)
      source: 'simplefin',
    });
    expect(holdings[1]).toMatchObject({
      symbol: 'VTI',
      quantity: 200,
      costBasisCents: 4000000,
      priceCents: 25000, // round($50,000 ÷ 200)
      marketValueCents: 5000000, // $50,000 authoritative total persisted
      source: 'simplefin',
    });
  });

  it('net worth follows the authoritative account balance, not the holdings sum', async () => {
    await connectSimplefin(SETUP_TOKEN);
    const view = await getInvestments();
    expect(view.accounts).toHaveLength(1);
    expect(view.accounts[0].accountBalanceCents).toBe(14200000); // $142,000 (drives net worth)
    expect(view.overall.totalMarketValueCents).toBe(7000000); // $70,000 (holdings breakdown only)
    expect(view.overall.totalCostBasisCents).toBe(5500000);
    expect(view.overall.totalUnrealizedGainCents).toBe(1500000);
  });

  it('a low-price / high-quantity lot keeps its real value end-to-end (does NOT vanish to $0; DECISIONS #129)', async () => {
    // A 1,000,000-share lot worth $0.01 total → $0/share rounded. The #124 per-share-only
    // model reconstructed round(1000000 × 0) = $0, silently dropping the position from the
    // /investments breakdown. With the authoritative total stored, it reports 1¢.
    accountsPayload = {
      accounts: [
        brokerage([
          { id: 'p1', symbol: 'AAPL', description: 'Apple Inc', shares: '100', cost_basis: '15000.00', market_value: '20000.00' },
          { id: 'pny', symbol: 'PENNY', description: 'Penny Lot', shares: '1000000', market_value: '0.01' },
        ]),
      ],
    };
    await connectSimplefin(SETUP_TOKEN);

    const penny = await prisma.holding.findFirstOrThrow({ where: { account: { userId: USER }, symbol: 'PENNY' } });
    expect(penny.priceCents).toBe(0); // rounds to $0/share …
    expect(penny.marketValueCents).toBe(1); // … but the 1¢ authoritative total is persisted

    const view = await getInvestments();
    // $20,000.00 (AAPL) + $0.01 (PENNY) — the penny lot is present, not lost.
    expect(view.overall.totalMarketValueCents).toBe(2000001);
    expect(view.overall.positions.find((p) => p.symbol === 'PENNY')!.marketValueCents).toBe(1);
  });

  it('does NOT ingest a brokerage trade as a spending transaction (#62)', async () => {
    accountsPayload = {
      accounts: [
        brokerage(DEFAULT_HOLDINGS, [
          { id: 'trade-1', posted: 1781049600, amount: '-5000.00', description: 'BUY AAPL 25 SHARES' },
        ]),
      ],
    };
    await connectSimplefin(SETUP_TOKEN);
    const trade = await prisma.transaction.findFirst({ where: { providerRef: 'trade-1', account: { userId: USER } } });
    expect(trade).toBeNull();
    expect(await prisma.transaction.count({ where: { account: { userId: USER } } })).toBe(0);
  });

  it('re-syncing is idempotent (updates in place, never duplicates positions)', async () => {
    await connectSimplefin(SETUP_TOKEN);
    const r = await syncSimplefinNow();
    expect(r.ok).toBe(true);
    expect(r.holdings).toEqual({ upserted: 2, removed: 0, skipped: 0 });
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(2);
  });

  it('reconciles: a sold position is deleted, a price change is applied', async () => {
    await connectSimplefin(SETUP_TOKEN); // AAPL + VTI
    // Next feed: VTI sold (gone), AAPL re-priced up to $22,000 total.
    accountsPayload = {
      accounts: [
        brokerage([
          { id: 'p1', symbol: 'AAPL', description: 'Apple Inc', shares: '100', cost_basis: '15000.00', market_value: '22000.00' },
        ]),
      ],
    };
    const r = await syncSimplefinNow();
    expect(r.holdings).toEqual({ upserted: 1, removed: 1, skipped: 0 });
    const holdings = await prisma.holding.findMany({ where: { account: { userId: USER } } });
    expect(holdings).toHaveLength(1);
    expect(holdings[0].symbol).toBe('AAPL');
    expect(holdings[0].priceCents).toBe(22000); // round($22,000 ÷ 100)
    expect(await prisma.holding.findFirst({ where: { account: { userId: USER }, symbol: 'VTI' } })).toBeNull();
  });

  it('NEVER deletes a manually-entered holding on the same account (source-scoped reconcile)', async () => {
    await connectSimplefin(SETUP_TOKEN); // AAPL + VTI (source=simplefin)
    const acct = await prisma.account.findFirstOrThrow({
      where: { userId: USER, provider: 'simplefin', providerRef: 'brk-1' },
      select: { id: true },
    });
    // The user manually tracks a position the brokerage feed never reports.
    await prisma.holding.create({
      data: { accountId: acct.id, symbol: 'TSLA', name: 'Tesla', quantity: 3, costBasisCents: 60000, priceCents: 25000, source: 'manual' },
    });
    // Re-sync with a feed that does NOT include TSLA.
    const r = await syncSimplefinNow();
    expect(r.holdings!.removed).toBe(0); // TSLA is manual → out of the feed's reconcile scope
    const tsla = await prisma.holding.findFirst({ where: { account: { userId: USER }, symbol: 'TSLA' } });
    expect(tsla).not.toBeNull();
    expect(tsla!.source).toBe('manual');
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(3); // AAPL, VTI, TSLA
  });

  it('NEVER overwrites a manual holding when the feed reports the SAME ticker (#124 P0)', async () => {
    // First connect with a feed that does NOT include AAPL, so we can plant a manual AAPL.
    accountsPayload = { accounts: [brokerage([{ id: 'p2', symbol: 'VTI', shares: '200', cost_basis: '40000.00', market_value: '50000.00' }])] };
    await connectSimplefin(SETUP_TOKEN);
    const acct = await prisma.account.findFirstOrThrow({
      where: { userId: USER, provider: 'simplefin', providerRef: 'brk-1' },
      select: { id: true },
    });
    await prisma.holding.create({
      data: { accountId: acct.id, symbol: 'AAPL', name: 'My Apple', quantity: 3, costBasisCents: 50000, priceCents: 10000, source: 'manual' },
    });
    // Now the feed ALSO reports AAPL at a totally different price/basis.
    accountsPayload = {
      accounts: [
        brokerage([
          { id: 'p1', symbol: 'AAPL', description: 'Apple Inc (feed)', shares: '100', cost_basis: '99999.00', market_value: '99999.00' },
          { id: 'p2', symbol: 'VTI', shares: '200', cost_basis: '40000.00', market_value: '50000.00' },
        ]),
      ],
    };
    const r = await syncSimplefinNow();
    expect(r.holdings).toEqual({ upserted: 1, removed: 0, skipped: 1 }); // VTI upserted; AAPL (manual) skipped

    const aapl = await prisma.holding.findFirstOrThrow({ where: { account: { userId: USER }, symbol: 'AAPL' } });
    expect(aapl.source).toBe('manual'); // untouched
    expect(aapl.name).toBe('My Apple'); // feed name NOT applied
    expect(aapl.quantity).toBe(3); // feed quantity NOT applied
    expect(aapl.costBasisCents).toBe(50000); // user's cost basis PRESERVED
    expect(aapl.priceCents).toBe(10000); // user's price PRESERVED
  });

  it('leaves synced holdings intact when a sync response OMITS the holdings field (#124 P2)', async () => {
    await connectSimplefin(SETUP_TOKEN); // AAPL + VTI (source=simplefin)
    // A transient/partial response: the account comes back with NO holdings field at all.
    accountsPayload = { accounts: [{ id: 'brk-1', name: 'Brokerage', balance: '142000.00', org: { name: 'Vanguard' } }] };
    const r = await syncSimplefinNow();
    expect(r.ok).toBe(true);
    expect(r.holdings).toEqual({ upserted: 0, removed: 0, skipped: 0 }); // no reconcile ran
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(2); // NOT wiped
  });

  it('reconciles to empty when the feed EXPLICITLY reports zero holdings (sold everything)', async () => {
    await connectSimplefin(SETUP_TOKEN); // AAPL + VTI
    accountsPayload = { accounts: [brokerage([])] }; // explicit empty array
    const r = await syncSimplefinNow();
    expect(r.holdings).toEqual({ upserted: 0, removed: 2, skipped: 0 });
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(0);
  });

  // DECISIONS #133 — audit #127 P2: a NON-EMPTY feed that maps to ZERO positions is an
  // anomaly (format glitch / all-unsupported types), NOT a sell-all. It must NOT wipe the
  // synced breakdown — distinct from the explicit-empty (above) and omitted-field cases.
  it('does NOT wipe synced holdings when a NON-EMPTY feed maps to zero positions (all un-mappable)', async () => {
    await connectSimplefin(SETUP_TOKEN); // AAPL + VTI (source=simplefin)
    // Positions ARE reported, but every one is un-mappable (no symbol) → mapped to [].
    accountsPayload = {
      accounts: [
        brokerage([
          { id: 'x1', shares: '100', market_value: '20000.00' }, // no symbol
          { id: 'x2', shares: '200', market_value: '50000.00' }, // no symbol
        ]),
      ],
    };
    const r = await syncSimplefinNow();
    expect(r.ok).toBe(true);
    // Without the guard this would be removed:2 and the breakdown would be wiped to 0.
    expect(r.holdings).toEqual({ upserted: 0, removed: 0, skipped: 2 });
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(2); // intact
  });

  // DECISIONS #133 — critic P2: an untrusted feed can send a NON-ARRAY holdings (null).
  // Array.isArray routes it to "leave rows intact"; the prior `!== undefined` guard would
  // have thrown "null is not iterable" and ABORTED the whole sync (the #128 transactions:null class).
  it('leaves synced holdings intact (and does NOT abort) when the feed sends a non-array holdings (null)', async () => {
    await connectSimplefin(SETUP_TOKEN); // AAPL + VTI (source=simplefin)
    accountsPayload = {
      accounts: [
        { id: 'brk-1', name: 'Brokerage', balance: '142000.00', org: { name: 'Vanguard' }, holdings: null as unknown as RawHolding[] },
      ],
    };
    const r = await syncSimplefinNow();
    expect(r.ok).toBe(true); // sync completes, not aborted
    expect(r.holdings).toEqual({ upserted: 0, removed: 0, skipped: 0 });
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(2); // NOT wiped
  });

  it('counts un-mappable feed positions as skipped without failing the sync', async () => {
    accountsPayload = {
      accounts: [
        brokerage([
          { id: 'p1', symbol: 'AAPL', shares: '100', cost_basis: '15000.00', market_value: '20000.00' },
          { id: 'p2', shares: '10', market_value: '500.00' }, // no symbol → un-mappable
        ]),
      ],
    };
    const r = await connectSimplefin(SETUP_TOKEN);
    expect(r.ok).toBe(true);
    expect(r.holdings).toEqual({ upserted: 1, removed: 0, skipped: 1 });
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(1);
  });
});
