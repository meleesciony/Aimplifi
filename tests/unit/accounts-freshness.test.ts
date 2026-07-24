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
    expect(row.freshness!.level).toBe('unknown');
  });
});
