/**
 * Demo fence on the four MANUAL-ENTRY (typed/uploaded) ingest actions — the
 * open owner follow-up from #243, i.e. the typed/uploaded leg of the same rule
 * the bank-connect fence enforces. The shared demo account is one row every
 * anonymous visitor logs into, so a manual account balance, a hand-entered
 * transaction (real amount + raw descriptor + date), a pasted CSV statement, or
 * a brokerage holding entered into `user-demo` would show ONE visitor's real
 * numbers to the NEXT visitor — the same shared-account leak class as the
 * household seat (#210), learned vocabulary (#226), and bank connect (#243).
 *
 * Load-bearing notes:
 * - The seed creates no provider='manual' accounts, so with `addManualAccount`
 *   fenced, `updateManualAccountValue` / `deleteManualAccount` can never match a
 *   demo-owned manual row (`ownedManualAccount` requires provider === 'manual').
 * - `removeHolding` / delete paths are intentionally NOT fenced (they remove
 *   data, never ingest — the remediation path, like `disconnectSimplefin`).
 * - ANTHROPIC_API_KEY is set AS CONFIGURED (keyed deployment), so the demo
 *   message is the only possible refusal and the no-key fallback can't mask a
 *   missing fence; the fetch spy proves a demo descriptor never egresses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { auth } = await import('@/auth');
const { prisma } = await import('@/lib/db');
const { addManualAccount } = await import('@/server/networth-actions');
const { createManualTransaction, importTransactionsCsv } = await import('@/server/transaction-actions');
const { addHolding } = await import('@/server/investments');

function actAs(userId: string) {
  vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);
}

/** Rows that could carry a visitor's real figures into the shared demo row. */
async function demoRowCounts() {
  const [manualAccounts, txns, holdings] = await Promise.all([
    prisma.account.count({ where: { userId: DEMO_USER_ID, provider: 'manual' } }),
    prisma.transaction.count({ where: { account: { userId: DEMO_USER_ID } } }),
    prisma.holding.count({ where: { account: { userId: DEMO_USER_ID } } }),
  ]);
  return { manualAccounts, txns, holdings };
}

function txnForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  // Real seed ids (acct-checking / acct-brokerage): with the fence removed these
  // WOULD write, so the row-count-delta assertions are load-bearing (critic P2-1).
  fd.set('accountId', overrides.accountId ?? 'acct-checking');
  fd.set('descriptor', 'MY REAL EMPLOYER PAYROLL');
  fd.set('amount', '4321.09');
  fd.set('date', '2026-07-01');
  fd.set('direction', 'out');
  return fd;
}

function csvForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set('accountId', overrides.accountId ?? 'acct-checking');
  fd.set('csv', 'date,description,amount\n2026-07-01,MY REAL LANDLORD,-2400.00\n');
  return fd;
}

const savedKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  // A KEYED deployment: the fence, not a missing key, must be what refuses demo.
  process.env.ANTHROPIC_API_KEY = 'fake-key-for-fence-test';
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  vi.restoreAllMocks();
});

describe('test_regression__demo_cannot_type_or_upload_real_data (keyed deployment)', () => {
  it('addManualAccount refuses the demo user and writes nothing', async () => {
    actAs(DEMO_USER_ID);
    const before = await demoRowCounts();
    const r = await addManualAccount({ name: 'My real house', type: 'REAL_ESTATE', value: '650000' });
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]).toMatch(/demo/i);
    expect(r.id).toBeUndefined();
    expect(await demoRowCounts()).toEqual(before);
  });

  it('createManualTransaction refuses the demo user before any lookup, write, or egress', async () => {
    actAs(DEMO_USER_ID);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const before = await demoRowCounts();
    const r = await createManualTransaction(null, txnForm());
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]).toMatch(/demo/i);
    // The typed descriptor never reaches a provider (defense in depth on top of
    // the categorizeSuggestFor demo fence).
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await demoRowCounts()).toEqual(before);
  });

  it('importTransactionsCsv refuses the demo user and imports zero rows', async () => {
    actAs(DEMO_USER_ID);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const before = await demoRowCounts();
    const r = await importTransactionsCsv(null, csvForm());
    expect(r.ok).toBe(false);
    expect(r.imported).toBe(0);
    expect(r.errors[0]).toMatch(/demo/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await demoRowCounts()).toEqual(before);
  });

  it('addHolding refuses the demo user and upserts nothing', async () => {
    actAs(DEMO_USER_ID);
    const before = await demoRowCounts();
    const r = await addHolding({
      accountId: 'acct-brokerage', // the real seeded INVESTMENT account (critic P2-1)
      symbol: 'VTI',
      name: 'My real index fund',
      quantity: 123.45,
      costBasisCents: 1_000_000_00,
      priceCents: 250_00,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/demo/i);
    expect(await demoRowCounts()).toEqual(before);
  });

  it('the fence is demo-specific: a real user passes it and hits the normal path', async () => {
    // Each action, called by a NON-demo user with input that fails fast on the
    // normal path, returns that path's error — never the demo refusal. Proves
    // the fence is not a global off-switch.
    actAs('manual-fence-real-user');

    const a = await addManualAccount({ name: '', type: 'NOPE', value: 'x' });
    expect(a.ok).toBe(false);
    expect(a.errors?.join(' ')).not.toMatch(/demo/i);

    const t = await createManualTransaction(null, txnForm({ accountId: 'no-such-account' }));
    expect(t.ok).toBe(false);
    expect(t.errors?.[0]).toMatch(/account/i);
    expect(t.errors?.join(' ')).not.toMatch(/demo/i);

    const c = await importTransactionsCsv(null, csvForm({ accountId: 'no-such-account' }));
    expect(c.ok).toBe(false);
    expect(c.errors.join(' ')).toMatch(/account/i);
    expect(c.errors.join(' ')).not.toMatch(/demo/i);

    const h = await addHolding({
      accountId: 'no-such-account',
      symbol: '!!not a ticker!!',
      quantity: 1,
      costBasisCents: 0,
      priceCents: 0,
    });
    expect(h.ok).toBe(false);
    expect(h.error).not.toMatch(/demo/i);
  });
});
