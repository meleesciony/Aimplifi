/**
 * test_regression__one_button_syncs_every_connected_provider
 * (owner request 2026-07-23: "I want one button sync of all accounts. And
 * individual syncing if required.")
 *
 * Syncing used to be per-provider and asymmetric — SimpleFIN had a button and an
 * auto-sync; Plaid had neither — so "refresh my accounts" was a thing the user
 * could only do for half their banks, and only if they knew which half.
 *
 * The contract locked here: both providers attempted, each ISOLATED (one bank's
 * expired login must not cost the other's fresh data), partial success reported as
 * success with the failure NAMED, and the summary always says what happened —
 * including "no new transactions", so a sync that did nothing can't be mistaken
 * for one that never ran.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';

const syncSimplefinNow = vi.fn();
const syncPlaidNow = vi.fn();
let currentUserId = '';

const rateLimitDurable = vi.fn(async () => true);
vi.mock('@/server/authz', () => ({
  requireUserId: async () => currentUserId,
  rateLimitDurable: (...args: unknown[]) => rateLimitDurable(...(args as [])),
}));
vi.mock('@/server/simplefin-actions', () => ({ syncSimplefinNow }));
vi.mock('@/server/plaid-actions', () => ({ syncPlaidNow }));

const { syncAllAccounts } = await import('@/server/sync-actions');

async function makeUser(tag: string): Promise<string> {
  const u = await prisma.user.create({
    data: { email: `sync-all-${tag}-${Date.now()}-${Math.random()}@aimplifi.test` },
  });
  return u.id;
}
async function giveSimplefin(userId: string) {
  await prisma.simpleFinConnection.create({ data: { userId, accessUrl: 'enc' } });
}
async function givePlaid(userId: string) {
  await prisma.plaidItem.create({
    data: { userId, itemId: `item-${Date.now()}-${Math.random()}`, accessToken: 'enc' },
  });
}

describe('syncAllAccounts', () => {
  beforeEach(() => {
    rateLimitDurable.mockReset().mockResolvedValue(true);
    syncSimplefinNow.mockReset().mockResolvedValue({ ok: true, added: 3 });
    syncPlaidNow.mockReset().mockResolvedValue({ ok: true, added: 4, statementsWritten: 1 });
  });

  it('syncs BOTH providers in one call and totals what each returned', async () => {
    currentUserId = await makeUser('both');
    await giveSimplefin(currentUserId);
    await givePlaid(currentUserId);

    const r = await syncAllAccounts();

    expect(syncSimplefinNow).toHaveBeenCalled();
    expect(syncPlaidNow).toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, addedTransactions: 7, statementsWritten: 1, failed: [] });
    expect(r.ran.sort()).toEqual(['plaid', 'simplefin']);
    expect(r.summary).toContain('Synced SimpleFIN and Plaid');
    expect(r.summary).toContain('7 new transactions');
  });

  it('only attempts the providers the user actually has', async () => {
    currentUserId = await makeUser('plaidonly');
    await givePlaid(currentUserId);

    const r = await syncAllAccounts();

    expect(syncSimplefinNow).not.toHaveBeenCalled();
    expect(r.ran).toEqual(['plaid']);
    expect(r.summary).toContain('Synced Plaid');
  });

  it('one provider failing does not suppress the other (partial success)', async () => {
    currentUserId = await makeUser('partial');
    await giveSimplefin(currentUserId);
    await givePlaid(currentUserId);
    syncSimplefinNow.mockResolvedValue({ ok: false, error: 'Sync failed' });

    const r = await syncAllAccounts();

    expect(r.ok).toBe(true); // Plaid's 4 transactions still landed
    expect(r.failed).toEqual(['simplefin']);
    expect(r.addedTransactions).toBe(4);
    expect(r.summary).toContain('Synced Plaid');
    expect(r.summary).toContain('SimpleFIN couldn’t be reached');
  });

  it('a throwing provider is contained, not fatal', async () => {
    currentUserId = await makeUser('throws');
    await giveSimplefin(currentUserId);
    await givePlaid(currentUserId);
    syncPlaidNow.mockRejectedValue(new Error('boom'));

    const r = await syncAllAccounts();

    expect(r.ok).toBe(true);
    expect(r.failed).toEqual(['plaid']);
    expect(r.addedTransactions).toBe(3);
  });

  it('is a failure only when every attempted provider failed', async () => {
    currentUserId = await makeUser('allfail');
    await giveSimplefin(currentUserId);
    await givePlaid(currentUserId);
    syncSimplefinNow.mockResolvedValue({ ok: false });
    syncPlaidNow.mockResolvedValue({ ok: false });

    const r = await syncAllAccounts();

    expect(r.ok).toBe(false);
    expect(r.failed.sort()).toEqual(['plaid', 'simplefin']);
  });

  it('says so when nothing new arrived, rather than an ambiguous "synced"', async () => {
    currentUserId = await makeUser('nonew');
    await givePlaid(currentUserId);
    syncPlaidNow.mockResolvedValue({ ok: true, added: 0, statementsWritten: 0 });

    const r = await syncAllAccounts();

    expect(r.ok).toBe(true);
    expect(r.summary).toContain('No new transactions');
  });

  it('refuses when no bank is connected', async () => {
    currentUserId = await makeUser('nobanks');

    const r = await syncAllAccounts();

    expect(r).toMatchObject({ ok: false, error: 'No banks are connected yet.' });
    expect(syncSimplefinNow).not.toHaveBeenCalled();
    expect(syncPlaidNow).not.toHaveBeenCalled();
  });

  it('refuses for the shared demo account', async () => {
    currentUserId = DEMO_USER_ID;

    const r = await syncAllAccounts();

    expect(r.ok).toBe(false);
    expect(syncSimplefinNow).not.toHaveBeenCalled();
    expect(syncPlaidNow).not.toHaveBeenCalled();
  });
});

/**
 * Critic P1-3, the false all-clear — in the summary this module's own docblock says
 * it exists to prevent. A Plaid sync whose TRANSACTION half threw still returns
 * ok:true (the liabilities half's data is real) with `added: undefined`, which
 * `?? 0` turned into "No new transactions." for a user whose bank login had
 * expired: a green all-clear over exactly the staleness that motivated the ticket.
 */
describe('syncAllAccounts — a half-failed provider is never reported as clean', () => {
  beforeEach(() => {
    rateLimitDurable.mockReset().mockResolvedValue(true);
    syncSimplefinNow.mockReset().mockResolvedValue({ ok: true, added: 0 });
    syncPlaidNow.mockReset().mockResolvedValue({ ok: true, added: 4, statementsWritten: 1 });
  });

  it('does NOT say "No new transactions" when the transaction pull failed', async () => {
    currentUserId = await makeUser('txfail');
    await givePlaid(currentUserId);
    syncPlaidNow.mockResolvedValue({
      ok: true,
      added: undefined,
      transactionsFailed: true,
      statementsWritten: 2,
    });

    const r = await syncAllAccounts();

    expect(r.summary).not.toContain('No new transactions');
    expect(r.summary).toContain('didn’t return transactions');
    expect(r.partial).toContain('transactions');
  });

  it('says so when no card statement data came back', async () => {
    currentUserId = await makeUser('liabfail');
    await givePlaid(currentUserId);
    syncPlaidNow.mockResolvedValue({
      ok: true,
      added: 3,
      statementsWritten: 0,
      liabilitiesFailed: true,
    });

    const r = await syncAllAccounts();

    expect(r.summary).toContain('3 new transactions');
    expect(r.summary).toContain('card due dates are unchanged');
    expect(r.partial).toContain('card statements');
  });

  it('still reports a genuine zero as a zero', async () => {
    currentUserId = await makeUser('genuinezero');
    await givePlaid(currentUserId);
    syncPlaidNow.mockResolvedValue({
      ok: true,
      added: 0,
      transactionsFailed: false,
      statementsWritten: 0,
    });

    const r = await syncAllAccounts();

    expect(r.summary).toContain('No new transactions');
    expect(r.partial).toEqual([]);
  });

  it('consults the durable rate limiter and honours a refusal', async () => {
    currentUserId = await makeUser('ratelimited');
    await givePlaid(currentUserId);
    rateLimitDurable.mockResolvedValue(false);

    const r = await syncAllAccounts();

    expect(r.ok).toBe(false);
    expect(r.error).toContain('Too many syncs');
    expect(syncPlaidNow).not.toHaveBeenCalled();
    expect(syncSimplefinNow).not.toHaveBeenCalled();
  });
});
