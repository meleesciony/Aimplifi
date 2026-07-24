/**
 * Plaid investment-HOLDINGS ingest (TASKS 4.3), mocked-server integration. Runs the REAL
 * PlaidProvider.syncHoldings against a throwaway user with global.fetch stubbed to a fake
 * Plaid /investments/holdings/get (the plaid-loan-liabilities-sync idiom; the live socket
 * stays UNVERIFIED). Locks the Plaid parity of the SimpleFIN holdings guarantees:
 *   - positions ingest as source='plaid' with authoritative cents; net worth stays on the
 *     account balance (holdings are a within-account breakdown);
 *   - a user with NO investment account makes ZERO billed calls; a checking/credit-only bank
 *     is never asked;
 *   - source isolation: a manual holding (same or different ticker) is never touched;
 *   - reconcile prunes sold positions; a cash-only account prunes; a glitch feed does NOT wipe;
 *   - a cash sweep is excluded (not persisted, not counted skipped); a non-USD lot is withheld;
 *   - PRODUCTS_NOT_SUPPORTED counts as unsupported (audited apart), a real error as failed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { PlaidProvider } from '@/lib/providers/plaid';
import { getInvestments } from '@/server/investments';
import { encryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';

const KEY = Buffer.alloc(32, 7).toString('base64');
const ITEM_ID = 'item-inv-1';
const INV_REF = 'inv-acct-1';

const ok = (json: unknown): Response => ({ ok: true, status: 200, json: async () => json }) as Response;
const fail = (status: number, body: unknown): Response =>
  ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

// The item's securities catalog (joined by security_id). Cash sweep + a tickerless fund included.
const SECURITIES = [
  { security_id: 'sec-aapl', ticker_symbol: 'AAPL', name: 'Apple Inc.', type: 'equity' },
  { security_id: 'sec-vti', ticker_symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'etf' },
  { security_id: 'sec-cash', ticker_symbol: 'CUR:USD', name: 'Cash', type: 'cash' },
];

const hold = (over: Record<string, unknown>) => ({
  account_id: INV_REF,
  security_id: 'sec-aapl',
  institution_value: 0,
  quantity: 0,
  iso_currency_code: 'USD',
  unofficial_currency_code: null,
  ...over,
});

// Default: AAPL (100 sh, $20,000 total, $15,000 basis) + VTI (200 sh, $50,000 total, $40,000 basis).
const DEFAULT_HOLDINGS = [
  hold({ security_id: 'sec-aapl', quantity: 100, institution_value: 20000, cost_basis: 15000 }),
  hold({ security_id: 'sec-vti', quantity: 200, institution_value: 50000, cost_basis: 40000 }),
];

let holdingsResponse: () => Response;
let holdingsCalls = 0;
function mockServer() {
  holdingsCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/investments/holdings/get')) {
        holdingsCalls += 1;
        return holdingsResponse();
      }
      return fail(404, { error_code: 'NOT_MOCKED' });
    }),
  );
}

describe('Plaid holdings ingest (real provider, mocked Plaid server) — TASKS 4.3', () => {
  const USER = `plaid-hold-${Date.now()}-${process.pid}`;

  async function wipe() {
    await prisma.account.deleteMany({ where: { userId: USER } }); // cascades holdings
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  async function makeInvestmentAccount(over: Record<string, unknown> = {}) {
    return prisma.account.create({
      data: {
        userId: USER,
        provider: 'plaid',
        providerRef: INV_REF,
        plaidItemId: ITEM_ID, // links the account to its bank — syncHoldings asks only linked banks
        name: 'Brokerage',
        type: 'INVESTMENT',
        currentBalanceCents: 14200000, // $142,000 authoritative (≠ holdings sum, on purpose)
        ...over,
      },
    });
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
    vi.stubEnv('PLAID_CLIENT_ID', 'test-id');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
    vi.stubEnv('DEMO_TODAY', '2026-06-10');
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.auditLog.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.create({
      data: { userId: USER, itemId: ITEM_ID, accessToken: encryptToken('access-tok', Buffer.from(KEY, 'base64')) },
    });
    holdingsResponse = () => ok({ holdings: DEFAULT_HOLDINGS, securities: SECURITIES });
    mockServer();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('ingests positions as source=plaid with authoritative cents; derives per-share from the total', async () => {
    await makeInvestmentAccount();
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ itemsAttempted: 1, itemsFailed: 0, itemsUnsupported: 0, upserted: 2, removed: 0, skipped: 0, withheldNonUsd: 0 });

    const holdings = await prisma.holding.findMany({ where: { account: { userId: USER } }, orderBy: { symbol: 'asc' } });
    expect(holdings).toHaveLength(2);
    expect(holdings[0]).toMatchObject({
      symbol: 'AAPL', name: 'Apple Inc.', quantity: 100, costBasisCents: 1500000, priceCents: 20000, marketValueCents: 2000000, source: 'plaid',
    });
    expect(holdings[1]).toMatchObject({
      symbol: 'VTI', quantity: 200, costBasisCents: 4000000, priceCents: 25000, marketValueCents: 5000000, source: 'plaid',
    });
  });

  it('net worth follows the account balance, not the holdings sum; positions render on /investments', async () => {
    await makeInvestmentAccount();
    await new PlaidProvider().syncHoldings(USER);
    const view = await getInvestments();
    expect(view.accounts).toHaveLength(1);
    expect(view.accounts[0].accountBalanceCents).toBe(14200000); // drives net worth, unchanged
    expect(view.overall.totalMarketValueCents).toBe(7000000); // $70,000 breakdown only
    expect(view.overall.totalCostBasisCents).toBe(5500000);
  });

  it('makes ZERO billed calls when the user has no investment account', async () => {
    // Only a checking account exists — syncHoldings must short-circuit before any fetch.
    await prisma.account.create({
      data: { userId: USER, provider: 'plaid', providerRef: 'chk-1', plaidItemId: ITEM_ID, name: 'Checking', type: 'CHECKING', currentBalanceCents: 500000 },
    });
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ itemsAttempted: 0, upserted: 0, removed: 0 });
    expect(holdingsCalls).toBe(0);
  });

  it('does NOT ask a bank that has no investment account (billed per request)', async () => {
    // Investment account under ITEM_ID (so we get past the early return), plus a SECOND
    // checking-only item — that item must not fire a holdings call.
    await makeInvestmentAccount();
    await prisma.plaidItem.create({ data: { userId: USER, itemId: 'item-chk-2', accessToken: encryptToken('tok2', Buffer.from(KEY, 'base64')) } });
    await prisma.account.create({
      data: { userId: USER, provider: 'plaid', providerRef: 'chk-2', plaidItemId: 'item-chk-2', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500000 },
    });
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r.itemsAttempted).toBe(1); // only the investment-bearing item
    expect(holdingsCalls).toBe(1);
  });

  it('is idempotent (updates in place, never duplicates)', async () => {
    await makeInvestmentAccount();
    await new PlaidProvider().syncHoldings(USER);
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ upserted: 2, removed: 0, skipped: 0 });
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(2);
  });

  it('reconciles: a sold position is deleted, a price change is applied', async () => {
    await makeInvestmentAccount();
    await new PlaidProvider().syncHoldings(USER); // AAPL + VTI
    holdingsResponse = () => ok({ holdings: [hold({ security_id: 'sec-aapl', quantity: 100, institution_value: 22000, cost_basis: 15000 })], securities: SECURITIES });
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ upserted: 1, removed: 1 });
    const holdings = await prisma.holding.findMany({ where: { account: { userId: USER } } });
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({ symbol: 'AAPL', priceCents: 22000, marketValueCents: 2200000 });
  });

  it('NEVER deletes or overwrites a manual holding (source isolation)', async () => {
    const acct = await makeInvestmentAccount();
    // A manual position the feed never reports, AND a manual AAPL the feed DOES report.
    await prisma.holding.createMany({
      data: [
        { accountId: acct.id, symbol: 'TSLA', name: 'Tesla', quantity: 3, costBasisCents: 60000, priceCents: 25000, source: 'manual' },
        { accountId: acct.id, symbol: 'AAPL', name: 'My Apple', quantity: 5, costBasisCents: 50000, priceCents: 10000, source: 'manual' },
      ],
    });
    // Feed reports AAPL (collides with manual) + VTI (new).
    const r = await new PlaidProvider().syncHoldings(USER);
    // VTI upserted; AAPL is manual → skipped (not overwritten); TSLA manual → untouched (removed:0).
    expect(r).toMatchObject({ upserted: 1, removed: 0, skipped: 1 });
    const aapl = await prisma.holding.findFirstOrThrow({ where: { account: { userId: USER }, symbol: 'AAPL' } });
    expect(aapl).toMatchObject({ source: 'manual', name: 'My Apple', quantity: 5, costBasisCents: 50000, priceCents: 10000 });
    const tsla = await prisma.holding.findFirstOrThrow({ where: { account: { userId: USER }, symbol: 'TSLA' } });
    expect(tsla.source).toBe('manual');
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(3); // TSLA, AAPL(manual), VTI
  });

  it('excludes a cash sweep: not persisted, not counted skipped', async () => {
    await makeInvestmentAccount();
    holdingsResponse = () =>
      ok({
        holdings: [hold({ security_id: 'sec-cash', quantity: 5000, institution_value: 5000 }), hold({ security_id: 'sec-aapl', quantity: 10, institution_value: 2000 })],
        securities: SECURITIES,
      });
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ upserted: 1, skipped: 0, withheldNonUsd: 0 });
    expect((await prisma.holding.findMany({ where: { account: { userId: USER } } })).map((h) => h.symbol)).toEqual(['AAPL']);
  });

  it('withholds a non-USD lot (no FX): not persisted, counted withheldNonUsd', async () => {
    await makeInvestmentAccount();
    holdingsResponse = () =>
      ok({
        holdings: [hold({ security_id: 'sec-aapl', quantity: 10, institution_value: 2000 }), hold({ security_id: 'sec-vti', quantity: 10, institution_value: 3000, iso_currency_code: 'EUR' })],
        securities: SECURITIES,
      });
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ upserted: 1, withheldNonUsd: 1, skipped: 0 });
    expect(await prisma.holding.findFirst({ where: { account: { userId: USER }, symbol: 'VTI' } })).toBeNull();
  });

  it('prunes stale positions when the account holds only cash now (clean-zero prune)', async () => {
    await makeInvestmentAccount();
    await new PlaidProvider().syncHoldings(USER); // AAPL + VTI
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(2);
    // Now the account reports only its cash sweep — all securities sold.
    holdingsResponse = () => ok({ holdings: [hold({ security_id: 'sec-cash', quantity: 9999, institution_value: 9999 })], securities: SECURITIES });
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ upserted: 0, removed: 2, skipped: 0 });
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(0);
  });

  it('prunes all when the account reports zero holdings (sold everything)', async () => {
    await makeInvestmentAccount();
    await new PlaidProvider().syncHoldings(USER); // AAPL + VTI
    holdingsResponse = () => ok({ holdings: [], securities: SECURITIES });
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ upserted: 0, removed: 2 });
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(0);
  });

  it('does NOT wipe the breakdown when a non-empty feed maps to zero positions (glitch guard)', async () => {
    await makeInvestmentAccount();
    await new PlaidProvider().syncHoldings(USER); // AAPL + VTI
    // Positions ARE reported, but each references a security_id absent from securities[] → un-mappable.
    holdingsResponse = () => ok({ holdings: [hold({ security_id: 'sec-missing', quantity: 10, institution_value: 2000 })], securities: SECURITIES });
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ upserted: 0, removed: 0, skipped: 1 });
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(2); // intact
  });

  it('leaves positions intact (does NOT prune) when a 200 OMITS the holdings array (malformed)', async () => {
    await makeInvestmentAccount();
    await new PlaidProvider().syncHoldings(USER); // AAPL + VTI
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(2);
    // A truncated/garbled 200: the holdings key is absent. Reading it as "sold everything" would
    // wipe the breakdown — the #128 hazard the SimpleFIN Array.isArray guard exists for.
    holdingsResponse = () => ok({ securities: SECURITIES });
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ itemsAttempted: 1, itemsFailed: 0, upserted: 0, removed: 0 });
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(2); // NOT wiped
    expect(await prisma.auditLog.findFirst({ where: { userId: USER, action: 'plaid.holdings.malformed' } })).not.toBeNull();
  });

  it('also leaves positions intact when the holdings field is null (non-array)', async () => {
    await makeInvestmentAccount();
    await new PlaidProvider().syncHoldings(USER);
    holdingsResponse = () => ok({ holdings: null, securities: SECURITIES });
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ upserted: 0, removed: 0 });
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(2);
  });

  it('does NOT prune a still-held position when its security row is missing this run (partial securities[])', async () => {
    await makeInvestmentAccount();
    await new PlaidProvider().syncHoldings(USER); // AAPL + VTI (securities complete)
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(2);
    // Both holdings still reported, but VTI's SECURITY row is dropped from a truncated securities[].
    // VTI is un-joinable -> skipped; because skipped>0 we must NOT prune (it is still held).
    holdingsResponse = () =>
      ok({
        holdings: [hold({ security_id: 'sec-aapl', quantity: 100, institution_value: 21000 }), hold({ security_id: 'sec-vti', quantity: 200, institution_value: 50000 })],
        securities: [SECURITIES[0]], // AAPL only
      });
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ upserted: 1, removed: 0, skipped: 1 });
    const holdings = await prisma.holding.findMany({ where: { account: { userId: USER } }, orderBy: { symbol: 'asc' } });
    expect(holdings.map((h) => h.symbol)).toEqual(['AAPL', 'VTI']); // VTI preserved at its last-known value
    expect(holdings.find((h) => h.symbol === 'AAPL')!.marketValueCents).toBe(2100000); // AAPL updated
  });

  it('counts PRODUCTS_NOT_SUPPORTED as unsupported (not failed) and leaves holdings untouched', async () => {
    await makeInvestmentAccount();
    await new PlaidProvider().syncHoldings(USER); // seed AAPL + VTI
    holdingsResponse = () => fail(400, { error_code: 'PRODUCTS_NOT_SUPPORTED', error_type: 'INVALID_INPUT', error_message: 'investments not enabled' });
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ itemsAttempted: 1, itemsFailed: 0, itemsUnsupported: 1, upserted: 0, removed: 0 });
    expect(await prisma.holding.count({ where: { account: { userId: USER } } })).toBe(2); // NOT wiped by an errored pull
    const audit = await prisma.auditLog.findFirst({ where: { userId: USER, action: 'plaid.holdings.unsupported' } });
    expect(audit).not.toBeNull();
  });

  it('counts a real error as failed (audited apart from unsupported)', async () => {
    await makeInvestmentAccount();
    holdingsResponse = () => fail(500, { error_code: 'INTERNAL_SERVER_ERROR', error_type: 'API_ERROR', error_message: 'boom' });
    const r = await new PlaidProvider().syncHoldings(USER);
    expect(r).toMatchObject({ itemsAttempted: 1, itemsFailed: 1, itemsUnsupported: 0 });
    expect(await prisma.auditLog.findFirst({ where: { userId: USER, action: 'plaid.holdings.failed' } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { userId: USER, action: 'plaid.holdings.unsupported' } })).toBeNull();
  });

  it('scopes to one bank when itemId is passed', async () => {
    await makeInvestmentAccount(); // under ITEM_ID
    // A second investment bank the scoped sync must NOT touch.
    await prisma.plaidItem.create({ data: { userId: USER, itemId: 'item-inv-2', accessToken: encryptToken('tok2', Buffer.from(KEY, 'base64')) } });
    await prisma.account.create({
      data: { userId: USER, provider: 'plaid', providerRef: 'inv-2', plaidItemId: 'item-inv-2', name: 'Brokerage 2', type: 'INVESTMENT', currentBalanceCents: 1000000 },
    });
    const r = await new PlaidProvider().syncHoldings(USER, { itemId: ITEM_ID });
    expect(r.itemsAttempted).toBe(1); // only ITEM_ID
    expect(holdingsCalls).toBe(1);
  });
});
