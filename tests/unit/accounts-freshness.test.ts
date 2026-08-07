/**
 * test_regression__plaid_account_freshness_uses_its_bank_sync
 * (owner-reported 2026-07-24, with screenshots).
 *
 * The /accounts page contradicted itself: every Plaid CONNECTION row said "last synced
 * 2026-07-24", while the ACCOUNT rows under Liabilities said "Not synced yet" (Loan - 2927,
 * QuicksilverOne), "Last synced 8 days ago" (Mortgage 1192, Bonvoy Amex) and even "No new data
 * in 15 days — you may need to reconnect." (Delta SkyMiles) — a reconnect nudge for a card whose
 * bank had synced that morning.
 *
 * Cause: getAccountsView supplied `connectionLastSyncedAt` — the "a sync actually RAN" floor that
 * health.ts/mostRecentDate exists to apply — for SimpleFIN ONLY; Plaid passed a hardcoded null.
 * So a Plaid account's freshness fell back entirely to its newest TRANSACTION date, and a
 * mortgage/loan (no transactions at all) or a quiet card reads stale forever however well it syncs.
 *
 * These drive the REAL getAccountsView against a throwaway user.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAccountsView } from '@/server/transactions';
import { freshnessMessage } from '@/lib/engine/sync/health';
import { prisma } from '@/lib/db';

const TODAY = '2026-06-10';

describe('getAccountsView — a Plaid account is fresh when its BANK synced, even with no transactions', () => {
  const uid = `fresh-${Date.now()}-${process.pid}`;
  const wipe = async () => {
    await prisma.account.deleteMany({ where: { userId: uid } }); // cascades transactions
    await prisma.plaidItem.deleteMany({ where: { userId: uid } });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { id: uid } });
  };
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: uid, email: `${uid}@test.local` } });
  });
  afterAll(wipe);
  beforeEach(async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    await prisma.account.deleteMany({ where: { userId: uid } });
    await prisma.plaidItem.deleteMany({ where: { userId: uid } });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: uid } });
  });

  const rows = async () => {
    const v = await getAccountsView(uid);
    return [...v.assets.accounts, ...v.liabilities.accounts];
  };

  it('a Plaid LOAN with ZERO transactions reads "Synced today" when its bank synced today (was "Not synced yet")', async () => {
    await prisma.plaidItem.create({
      data: { userId: uid, itemId: 'it-usb', accessToken: 'enc', institution: 'U.S. Bank', lastSyncedAt: TODAY },
    });
    await prisma.account.create({
      data: { userId: uid, provider: 'plaid', providerRef: 'ln', plaidItemId: 'it-usb', name: 'Loan - 2927', type: 'LOAN', mask: '2927', currentBalanceCents: 2379657, currency: 'USD' },
    });
    const loan = (await rows()).find((a) => a.name === 'Loan - 2927')!;
    expect(loan.freshness).not.toBeNull();
    expect(loan.freshness!.level).toBe('fresh');
    expect(freshnessMessage(loan.freshness!)).toBe('Synced today');
  });

  it('a quiet Plaid card whose newest transaction is 15 days old is NOT told to reconnect when its bank synced today', async () => {
    await prisma.plaidItem.create({
      data: { userId: uid, itemId: 'it-amex', accessToken: 'enc', institution: 'American Express', lastSyncedAt: TODAY },
    });
    const card = await prisma.account.create({
      data: { userId: uid, provider: 'plaid', providerRef: 'dl', plaidItemId: 'it-amex', name: 'Delta SkyMiles', type: 'CREDIT', mask: '1005', currentBalanceCents: 0, currency: 'USD' },
    });
    await prisma.transaction.create({
      data: { accountId: card.id, date: '2026-05-26', amountCents: -1000, rawDescriptor: 'OLD CHARGE', categoryId: 'shopping', confidenceBps: 9000, needsReview: false },
    });
    const row = (await rows()).find((a) => a.name === 'Delta SkyMiles')!;
    expect(row.freshness!.level).toBe('fresh'); // the bank sync floors it — 15-day-old spend is not staleness
    expect(freshnessMessage(row.freshness!)).not.toMatch(/reconnect/i);
  });

  it('a genuinely STALE bank still reports stale — the floor never INVENTS freshness', async () => {
    // The counter-lock: this fix must not paper over a connection that really has stopped.
    await prisma.plaidItem.create({
      data: { userId: uid, itemId: 'it-truist', accessToken: 'enc', institution: 'Truist', lastSyncedAt: '2026-05-03' },
    });
    await prisma.account.create({
      data: { userId: uid, provider: 'plaid', providerRef: 'mg', plaidItemId: 'it-truist', name: 'Mortgage 1192', type: 'MORTGAGE', mask: '1192', currentBalanceCents: 93130641, currency: 'USD' },
    });
    const row = (await rows()).find((a) => a.name === 'Mortgage 1192')!;
    expect(row.freshness!.level).toBe('very_stale');
    expect(freshnessMessage(row.freshness!)).toMatch(/reconnect/i);
  });

  it('a Plaid row with no item linkage yet (pre-#256) keeps the transaction-date fallback — self-heals on the next sync', async () => {
    await prisma.plaidItem.create({
      data: { userId: uid, itemId: 'it-chase', accessToken: 'enc', institution: 'Chase', lastSyncedAt: TODAY },
    });
    await prisma.account.create({
      data: { userId: uid, provider: 'plaid', providerRef: 'legacy', plaidItemId: null, name: 'Legacy Card', type: 'CREDIT', mask: '9999', currentBalanceCents: 0, currency: 'USD' },
    });
    const row = (await rows()).find((a) => a.name === 'Legacy Card')!;
    // No linkage → no connection floor → no transactions → "Not synced yet" (documented, not a claim).
    // ALSO the K.2b false-direction lock: unknown linkage must never be told its connection was
    // removed — this row's item is alive; the stamp just hasn't landed yet.
    expect(row.freshness!.level).toBe('unknown');
  });

  // ── TASKS K.2b: the connection is GONE, and the row says so instead of hedging ──────────
  // Production state 2026-08-06: SimpleFinConnection row DELETED, 25 accounts frozen for 16
  // days reading "No new data in 16 days — you may need to reconnect" (a guess about a feed
  // that provably no longer exists), while the connect button offered first-time setup.

  it('a SimpleFIN account with NO connection row reads disconnected, not the stale-feed hedge', async () => {
    const card = await prisma.account.create({
      data: { userId: uid, provider: 'simplefin', providerRef: 'sf-1', name: 'Venture', type: 'CREDIT', mask: '6271', currentBalanceCents: -50000, currency: 'USD' },
    });
    await prisma.transaction.create({
      data: { accountId: card.id, date: '2026-05-25', amountCents: -1000, rawDescriptor: 'LAST CHARGE', categoryId: 'shopping', confidenceBps: 9000, needsReview: false },
    });
    const row = (await rows()).find((a) => a.name === 'Venture')!;
    expect(row.freshness!.level).toBe('disconnected');
    expect(freshnessMessage(row.freshness!)).toBe(
      'Bank connection removed — last data 16 days ago. Reconnect to resume updates.',
    );
  });

  it('the same SimpleFIN account WITH a live connection row is NEVER called disconnected', async () => {
    await prisma.simpleFinConnection.create({
      data: { userId: uid, accessUrl: 'enc', lastSyncedAt: TODAY },
    });
    await prisma.account.create({
      data: { userId: uid, provider: 'simplefin', providerRef: 'sf-1', name: 'Venture', type: 'CREDIT', mask: '6271', currentBalanceCents: -50000, currency: 'USD' },
    });
    const row = (await rows()).find((a) => a.name === 'Venture')!;
    expect(row.freshness!.level).toBe('fresh'); // graded from the connection's own sync date
  });

  it('a Plaid account whose stamped item was DELETED reads disconnected (dangling ref = proven removed)', async () => {
    // No plaidItem row for 'it-gone' — removeItem stamps plaidItemId, then deletes the item,
    // which is exactly the orphan the K.2 probe found live (264 rows, institution "?").
    const card = await prisma.account.create({
      data: { userId: uid, provider: 'plaid', providerRef: 'or-1', plaidItemId: 'it-gone', name: 'Orphan Card', type: 'CREDIT', mask: '4242', currentBalanceCents: 0, currency: 'USD' },
    });
    await prisma.transaction.create({
      data: { accountId: card.id, date: '2026-06-01', amountCents: -1000, rawDescriptor: 'LAST CHARGE', categoryId: 'shopping', confidenceBps: 9000, needsReview: false },
    });
    const row = (await rows()).find((a) => a.name === 'Orphan Card')!;
    expect(row.freshness!.level).toBe('disconnected');
    expect(freshnessMessage(row.freshness!)).toBe(
      'Bank connection removed — last data 9 days ago. Reconnect to resume updates.',
    );
  });

  it('simplefin.orphaned names the count and the newest data date exactly when the row is gone', async () => {
    const a = await prisma.account.create({
      data: { userId: uid, provider: 'simplefin', providerRef: 'sf-1', name: 'Venture', type: 'CREDIT', mask: '6271', currentBalanceCents: 0, currency: 'USD' },
    });
    await prisma.account.create({
      data: { userId: uid, provider: 'simplefin', providerRef: 'sf-2', name: 'Sapphire', type: 'CREDIT', mask: '0977', currentBalanceCents: 0, currency: 'USD' },
    });
    await prisma.transaction.create({
      data: { accountId: a.id, date: '2026-05-25', amountCents: -1000, rawDescriptor: 'LAST', categoryId: 'shopping', confidenceBps: 9000, needsReview: false },
    });
    const v = await getAccountsView(uid);
    expect(v.simplefin.connected).toBe(false);
    expect(v.simplefin.orphaned).toEqual({ count: 2, lastDataAt: '2026-05-25' });
  });

  it('simplefin.orphaned is null when connected, and null when there are no SimpleFIN accounts', async () => {
    // No simplefin rows at all → null (a genuinely new user gets the first-time door).
    expect((await getAccountsView(uid)).simplefin.orphaned).toBeNull();
    // Connected with rows → null (the ordinary connected card renders instead).
    await prisma.simpleFinConnection.create({ data: { userId: uid, accessUrl: 'enc', lastSyncedAt: TODAY } });
    await prisma.account.create({
      data: { userId: uid, provider: 'simplefin', providerRef: 'sf-1', name: 'Venture', type: 'CREDIT', mask: '6271', currentBalanceCents: 0, currency: 'USD' },
    });
    expect((await getAccountsView(uid)).simplefin.orphaned).toBeNull();
  });
});
