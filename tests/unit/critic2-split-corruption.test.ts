/**
 * Phase 2 Hostile Critic finding F1 (P0), kept as the permanent regression
 * after the cycle-2 fix: splitting a transaction must NEVER change any
 * engine aggregate. The fix marks the parent `isSplitParent`, and every
 * aggregation (pending projection, monthly flows, spending/income) excludes
 * split parents while counting their children.
 *
 * Hand math (docs/EDGE_CASES.md §Seed-headline): the golden headline —
 * required 5,412.33 by 06-26, shortfall 1,012.33, recommend 1,050.00 by
 * 06-23 — must be IDENTICAL before and after splitting the seeded pending
 * −$250.00 Zelle on the payment account.
 */
import { describe, expect, it } from 'vitest';
import { buildSeedData, type SeedTransaction } from '@/lib/seed/build';
import { assembleCashNeededInput } from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import { monthlyFlows } from '@/lib/engine/fi/insights';
import { holidayTable, isoDate } from '@/lib/dates';

const seed = buildSeedData('2026-06-10');

type TxnWithSplit = SeedTransaction & { isSplitParent?: boolean; splitParentId?: string };

function headlineFor(transactions: TxnWithSplit[]) {
  const input = assembleCashNeededInput({
    today: isoDate('2026-06-10'),
    scenario: 'PAY_IN_FULL',
    paymentAccountId: 'acct-checking',
    accounts: seed.accounts,
    autopays: seed.autopays,
    statements: seed.statements,
    cardPayments: seed.cardPayments,
    transactions,
    scheduled: seed.scheduled,
    holidayTable: holidayTable(2024, 2027),
  });
  return computeCashNeeded(input).headline;
}

describe('split parents are excluded from every aggregate (critic F1, fixed)', () => {
  const zelle = seed.transactions.find(
    (t) => t.status === 'PENDING' && t.accountId === 'acct-checking' && t.amountCents === -25000,
  )!;

  /** The exact DB state splitTransaction persists after the fix. */
  const afterSplit: TxnWithSplit[] = [
    ...seed.transactions.map((t) =>
      t.id === zelle.id ? { ...t, isSplitParent: true } : t,
    ),
    { ...zelle, id: 'txn-split-a', amountCents: -5000, splitParentId: zelle.id },
    { ...zelle, id: 'txn-split-b', amountCents: -20000, splitParentId: zelle.id },
  ];

  it('sanity: the pending −$250 Zelle exists and the golden headline holds pre-split', () => {
    expect(zelle).toBeDefined();
    const before = headlineFor(seed.transactions);
    expect(before.requiredCents).toBe(541233);
    expect(before.shortfallCents).toBe(101233);
    expect(before.recommendation).toEqual({ amountCents: 105000, byDate: '2026-06-23' });
  });

  it('the cash-needed headline is IDENTICAL after the split (no double count)', () => {
    const after = headlineFor(afterSplit);
    expect(after.requiredCents).toBe(541233);
    expect(after.shortfallCents).toBe(101233);
    expect(after.recommendation).toEqual({ amountCents: 105000, byDate: '2026-06-23' });
  });

  it('monthly flows are IDENTICAL after splitting a POSTED transaction', () => {
    const posted = seed.transactions.find(
      (t) => t.status === 'POSTED' && !t.isTransfer && t.amountCents < -1000,
    )!;
    const split: TxnWithSplit[] = [
      ...seed.transactions.map((t) => (t.id === posted.id ? { ...t, isSplitParent: true } : t)),
      { ...posted, id: 'c1', amountCents: -1000, splitParentId: posted.id },
      { ...posted, id: 'c2', amountCents: posted.amountCents + 1000, splitParentId: posted.id },
    ];
    expect(monthlyFlows(split)).toEqual(monthlyFlows(seed.transactions));
  });
});
