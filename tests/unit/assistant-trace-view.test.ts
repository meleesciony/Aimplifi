/**
 * Glass-Box slice 2 — `reconciledView` presentation guard (hostile-critic P1-1).
 *
 * The panel may only show, under its ✓, the set that sums to the headline. The bug
 * this locks: `top_categories` reconciles the TOP category alone (headline = its
 * amount) but the trace carries EVERY top-N category in `groups`. Folding those
 * groups into the panel green-checked a transaction count/sum belonging to
 * categories that are NOT behind the tapped figure. `reconciledView` returns the
 * group breakdown ONLY when the groups sum to the headline, else the flat rows —
 * so count, sum, and displayed rows always describe one reconciled set.
 *
 * Driven through the REAL engine (not literals) so it can't drift from trace output.
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { spendingByCategory } from '@/lib/engine/reports/reports';
import { traceSpendTotal, traceTopCategories, type TraceTxn } from '@/lib/engine/assistant/trace';
import { reconciledView } from '@/lib/engine/assistant/trace-view';
import type { Timeframe } from '@/lib/engine/assistant/intent';

const JUNE: Timeframe = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };

// Three spend categories, one row each — shopping (12100) > dining (8500) >
// groceries (8000); total 28600. So the top-category headline (12100) is strictly
// less than the total, which is exactly the shape that exposed the bug.
const TXNS: TraceTxn[] = [
  { date: '2026-06-03', amountCents: -12100, categoryId: 'shopping', rawDescriptor: 'AMZN Mktp US*1A2B3', accountId: 'a1', status: 'POSTED', isTransfer: false },
  { date: '2026-06-07', amountCents: -8500, categoryId: 'dining', rawDescriptor: 'CHIPOTLE 1122', accountId: 'a1', status: 'POSTED', isTransfer: false },
  { date: '2026-06-02', amountCents: -8000, categoryId: 'groceries', rawDescriptor: 'KROGER #529', accountId: 'a1', status: 'POSTED', isTransfer: false },
];

const BREAKDOWN = spendingByCategory(TXNS, JUNE, CATEGORY_BY_ID);
const sumRows = (rows: readonly { contributionCents: number }[]) => rows.reduce((s, r) => s + r.contributionCents, 0);

describe('reconciledView — top_categories shows only the top category, never the rest', () => {
  const top = traceTopCategories(BREAKDOWN, 5, TXNS, JUNE, CATEGORY_BY_ID);

  it('sanity: the trace reconciles the TOP category (12100), not the total (28600)', () => {
    expect(top.headlineCents).toBe(12100);
    expect(top.sumCents).toBe(12100);
    expect(top.groups).toHaveLength(3); // the engine carries all top-N categories…
  });

  it('presents the flat top rows — no group breakdown, count/sum tied to the headline', () => {
    const view = reconciledView(top);
    // …but the panel must NOT render them as the headline's breakdown.
    expect(view.groups).toBeNull();
    const shown = view.groups ? view.groups.flatMap((g) => g.rows) : view.rows;
    expect(shown).toHaveLength(1); // only the shopping row
    expect(sumRows(shown)).toBe(top.headlineCents); // 12100 — never 28600
  });
});

describe('reconciledView — spend_total shows the full hierarchical breakdown', () => {
  const total = traceSpendTotal(BREAKDOWN, TXNS, JUNE, CATEGORY_BY_ID);

  it('groups ARE the headline breakdown, so they are shown and they reconcile', () => {
    expect(total.headlineCents).toBe(28600);
    const view = reconciledView(total);
    expect(view.groups).not.toBeNull();
    const shown = view.groups!.flatMap((g) => g.rows);
    expect(shown).toHaveLength(3);
    expect(sumRows(shown)).toBe(total.headlineCents); // 28600 across all groups
  });
});
