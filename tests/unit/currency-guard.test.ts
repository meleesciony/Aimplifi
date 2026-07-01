/**
 * Currency guard — read-path exclusion, end to end (DECISIONS #135; #127 live-ingest audit #3/#10).
 * Integration test against throwaway users. A non-USD account — and ALL its child rows — is WITHHELD
 * from net worth (DemoProvider.getFinanceSnapshot → netWorthCents), the /accounts page
 * (getAccountsView), the spending snapshot (snap.transactions → reports/coach/trends), the triage
 * inbox count (getReviewCount), the /investments roll-up (getInvestments), and the first-run gate
 * count — while null-currency legacy rows stay counted (assumed USD → golden-safe). The app does no
 * FX; a foreign balance/transaction must never be summed at a fabricated 1:1.
 *
 * The four critic-confirmed P1 bypasses (#135 hostile critic) are each regression-locked here:
 *   P1-A getInvestments roll-up · P1-B first-run gate vs snapshot · P1-C snapshot transactions leak.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));

import { auth } from '@/auth';
import { DemoProvider } from '@/lib/providers/demo';
import { getAccountsView } from '@/server/transactions';
import { getReviewCount } from '@/server/triage';
import { getInvestments } from '@/server/investments';
import { netWorthCents } from '@/lib/engine/cash-needed/assemble';
import { prisma } from '@/lib/db';

describe('currency guard — non-USD accounts & their rows withheld everywhere (DECISIONS #135)', () => {
  const USER = `cur-user-${Date.now()}-${process.pid}`;
  const USER_INV = `cur-inv-${Date.now()}-${process.pid}`;

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: { in: [USER, USER_INV] } } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.createMany({
      data: [
        { id: USER, email: `${USER}@test.local` },
        { id: USER_INV, email: `${USER_INV}@test.local` },
      ],
    });

    // ── USER: net worth / accounts / gate / transactions / review-count ──
    const usChecking = await prisma.account.create({
      data: { userId: USER, provider: 'simplefin', providerRef: 'cur-usd', name: 'US Checking', type: 'CHECKING', currentBalanceCents: 1_000_00, currency: 'USD' },
    });
    await prisma.account.create({
      data: { userId: USER, provider: 'demo', providerRef: 'cur-legacy', name: 'Legacy Savings', type: 'SAVINGS', currentBalanceCents: 500_00, currency: null },
    });
    await prisma.account.create({ // withheld asset
      data: { userId: USER, provider: 'simplefin', providerRef: 'cur-eur', name: 'Euro Savings', type: 'SAVINGS', currentBalanceCents: 9_999_00, currency: 'EUR' },
    });
    await prisma.account.create({ // withheld liability
      data: { userId: USER, provider: 'plaid', providerRef: 'cur-gbp', name: 'UK Card', type: 'CREDIT', currentBalanceCents: 2_000_00, currency: 'GBP' },
    });
    const eurChecking = await prisma.account.create({ // withheld spending account with a txn
      data: { userId: USER, provider: 'simplefin', providerRef: 'cur-eur-chk', name: 'Euro Checking', type: 'CHECKING', currentBalanceCents: 100_00, currency: 'EUR' },
    });
    await prisma.transaction.create({
      data: { accountId: usChecking.id, date: '2026-06-01', amountCents: -10_00, rawDescriptor: 'US SPEND', needsReview: true },
    });
    await prisma.transaction.create({
      data: { accountId: eurChecking.id, date: '2026-06-01', amountCents: -50_00, rawDescriptor: 'EURO SPEND', needsReview: true },
    });

    // ── USER_INV: /investments roll-up ──
    const usBroker = await prisma.account.create({
      data: { userId: USER_INV, provider: 'simplefin', providerRef: 'inv-usd', name: 'US Brokerage', type: 'INVESTMENT', currentBalanceCents: 50_000_00, currency: 'USD' },
    });
    const eurBroker = await prisma.account.create({
      data: { userId: USER_INV, provider: 'simplefin', providerRef: 'inv-eur', name: 'EUR Brokerage', type: 'INVESTMENT', currentBalanceCents: 30_000_00, currency: 'EUR' },
    });
    await prisma.holding.create({
      data: { accountId: usBroker.id, symbol: 'VOO', quantity: 100, costBasisCents: 40_000_00, priceCents: 500_00, source: 'simplefin' },
    });
    await prisma.holding.create({
      data: { accountId: eurBroker.id, symbol: 'EUEQ', quantity: 100, costBasisCents: 25_000_00, priceCents: 300_00, source: 'simplefin' },
    });
  });
  afterAll(wipe);
  beforeEach(() => vi.clearAllMocks());

  it('excludes non-USD accounts from the snapshot and its net worth (USD + null only)', async () => {
    const snap = await new DemoProvider().getFinanceSnapshot(USER);
    expect(snap.accounts.map((a) => a.name).sort()).toEqual(['Legacy Savings', 'US Checking']);
    // $1,000 + $500 — the EUR asset, GBP liability, and EUR checking are WITHHELD, not summed at 1:1.
    expect(netWorthCents(snap.accounts)).toBe(1_500_00);
  });

  it('excludes a withheld account TRANSACTIONS from the snapshot (P1-C — no 1:1 spend leak)', async () => {
    const snap = await new DemoProvider().getFinanceSnapshot(USER);
    const descriptors = snap.transactions.map((t) => t.rawDescriptor);
    expect(descriptors).toContain('US SPEND'); // supported account's row stays
    expect(descriptors).not.toContain('EURO SPEND'); // withheld account's €50 row is gone
  });

  it('excludes withheld-account rows from the triage review count (P1-C)', async () => {
    expect(await getReviewCount(USER)).toBe(1); // only the US-checking needs-review row, not the EUR one
  });

  it('excludes non-USD accounts from the /accounts page subtotals + net worth', async () => {
    const view = await getAccountsView(USER);
    expect(view.assets.subtotalCents).toBe(1_500_00);
    expect(view.liabilities.subtotalCents).toBe(0);
    expect(view.netWorthCents).toBe(1_500_00);
    const allNames = [...view.assets.accounts, ...view.liabilities.accounts].map((a) => a.name);
    expect(allNames).not.toContain('Euro Savings');
    expect(allNames).not.toContain('UK Card');
    expect(allNames).not.toContain('Euro Checking');
  });

  it('excludes a non-USD brokerage from the /investments roll-up (P1-A — no 1:1 portfolio leak)', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: USER_INV } } as never);
    const data = await getInvestments();
    // Only the USD brokerage is rolled in; the EUR brokerage (and its €30k holding) is excluded.
    expect(data.accounts.map((a) => a.accountName)).toEqual(['US Brokerage']);
  });

  it('the direct supported-account predicate (used by /budgets + recurring refresh) excludes foreign rows', async () => {
    // /budgets and refreshRecurringForUser read transactions directly (NOT via the filtered
    // snapshot), so they carry the same OR-predicate; prove it drops the EUR row (confirmation critic).
    const rows = await prisma.transaction.findMany({
      where: { account: { userId: USER, OR: [{ currency: null }, { currency: 'USD' }] } },
      select: { rawDescriptor: true },
    });
    const d = rows.map((r) => r.rawDescriptor);
    expect(d).toContain('US SPEND');
    expect(d).not.toContain('EURO SPEND');
  });

  it('counts ONLY supported accounts for the first-run gate (P1-B — gate agrees with the snapshot)', async () => {
    const raw = await prisma.account.count({ where: { userId: USER } });
    const supported = await prisma.account.count({
      where: { userId: USER, OR: [{ currency: null }, { currency: 'USD' }] },
    });
    expect(raw).toBe(5); // US Checking, Legacy Savings, Euro Savings, UK Card, Euro Checking
    expect(supported).toBe(2); // US Checking + Legacy Savings — so an all-non-USD user gates to EmptyDashboard
  });
});
