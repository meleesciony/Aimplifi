/**
 * Glass-Box slice 2b — per-FACT tappability (GLASSBOX_PLAN §Sequencing 2b).
 *
 * Facts are TAGGED by the builders (`traceKey` = categoryId, `cents` = the
 * builder's own figure) — never matched back to trace groups by display string
 * (the slice-1 critic's fragility finding). `factView` is the tap gate: it
 * returns a per-fact panel view ONLY when the whole chain holds (reconciled
 * trace → tagged fact → existing group → group rows sum to group amount →
 * group amount equals the fact's own cents). Any break → null → the fact stays
 * plain text. Driven through the REAL engines so tags and gates can't drift.
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { spendingByCategory } from '@/lib/engine/reports/reports';
import {
  traceSpendByCategory,
  traceSpendTotal,
  traceTopCategories,
  traceMerchantSpend,
  traceIncome,
  type RowSumTrace,
  type TraceTxn,
} from '@/lib/engine/assistant/trace';
import { CORRECTABLE_KINDS, factView, reconciledView } from '@/lib/engine/assistant/trace-view';
import {
  answerLargest,
  answerSpendByCategory,
  answerSpendTotal,
  answerTopCategories,
  largestPurchases,
  merchantSpend,
  toPurchaseRows,
} from '@/lib/engine/assistant/answer';
import { monthlyFlows } from '@/lib/engine/fi/insights';
import type { SpendTarget, Timeframe } from '@/lib/engine/assistant/intent';

const TODAY = '2026-06-15';
const JUNE: Timeframe = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };

// Shopping (12100) > dining (8500) > groceries (8000); total 28600. Two rows in
// groceries so a per-fact panel shows a real multi-row sum.
const TXNS: TraceTxn[] = [
  { id: 'tx-shop', date: '2026-06-03', amountCents: -12100, categoryId: 'shopping', rawDescriptor: 'AMZN Mktp US*1A2B3', accountId: 'a1', status: 'POSTED', isTransfer: false },
  { id: 'tx-dine', date: '2026-06-07', amountCents: -8500, categoryId: 'dining', rawDescriptor: 'CHIPOTLE 1122', accountId: 'a1', status: 'POSTED', isTransfer: false },
  { id: 'tx-groc-1', date: '2026-06-02', amountCents: -5000, categoryId: 'groceries', rawDescriptor: 'KROGER #529', accountId: 'a1', status: 'POSTED', isTransfer: false },
  { id: 'tx-groc-2', date: '2026-06-09', amountCents: -3000, categoryId: 'groceries', rawDescriptor: 'KROGER #529', accountId: 'a1', status: 'POSTED', isTransfer: false },
  { id: 'tx-pay', date: '2026-06-01', amountCents: 400000, categoryId: 'income', rawDescriptor: 'ACME PAYROLL', accountId: 'a1', status: 'POSTED', isTransfer: false },
];

const BREAKDOWN = spendingByCategory(TXNS, JUNE, CATEGORY_BY_ID);
const sumRows = (rows: readonly { contributionCents: number }[]) =>
  rows.reduce((s, r) => s + r.contributionCents, 0);

// ── Builders tag their category facts (traceKey + cents from the SAME entry) ──

describe('builders tag category facts with traceKey + cents', () => {
  it('answerSpendTotal: top-3 facts carry categoryId + the entry cents', () => {
    const a = answerSpendTotal(BREAKDOWN, JUNE);
    expect(a.facts).toHaveLength(3);
    for (const [i, f] of a.facts.entries()) {
      expect(f.traceKey).toBe(BREAKDOWN.byCategory[i].categoryId);
      expect(f.cents).toBe(BREAKDOWN.byCategory[i].amountCents);
    }
  });

  it('answerTopCategories: EVERY listed fact is tagged (incl. non-top ones)', () => {
    const a = answerTopCategories(BREAKDOWN, JUNE, 3);
    expect(a.facts).toHaveLength(3);
    for (const [i, f] of a.facts.entries()) {
      expect(f.traceKey).toBe(BREAKDOWN.byCategory[i].categoryId);
      expect(f.cents).toBe(BREAKDOWN.byCategory[i].amountCents);
    }
  });

  it('answerSpendByCategory umbrella: member facts tagged', () => {
    const target: SpendTarget = { type: 'categories', categoryIds: ['groceries', 'dining'], label: 'food' };
    const a = answerSpendByCategory(BREAKDOWN, target, JUNE);
    expect(a.facts.length).toBe(2);
    for (const f of a.facts) {
      expect(['groceries', 'dining']).toContain(f.traceKey);
      expect(f.cents).toBe(BREAKDOWN.byCategory.find((c) => c.categoryId === f.traceKey)?.amountCents);
    }
  });

  it('answerLargest: runner-up facts are NOT tagged (constraint (b) — not in the trace)', () => {
    const largest = largestPurchases(toPurchaseRows(TXNS), JUNE, 3, TODAY, CATEGORY_BY_ID);
    const a = answerLargest(largest, JUNE);
    expect(a.facts.length).toBeGreaterThan(1);
    for (const f of a.facts) {
      expect(f.traceKey).toBeUndefined();
      expect(f.cents).toBeUndefined();
    }
  });
});

// ── factView: the tap gate, end to end on real traces ────────────────────────

describe('factView reconciles every tagged fact against its trace group', () => {
  const cases: { name: string; answerFacts: () => { traceKey?: string; cents?: number }[]; trace: () => RowSumTrace }[] = [
    {
      name: 'spend_total',
      answerFacts: () => answerSpendTotal(BREAKDOWN, JUNE).facts,
      trace: () => traceSpendTotal(BREAKDOWN, TXNS, JUNE, CATEGORY_BY_ID),
    },
    {
      name: 'top_categories',
      answerFacts: () => answerTopCategories(BREAKDOWN, JUNE, 3).facts,
      trace: () => traceTopCategories(BREAKDOWN, 3, TXNS, JUNE, CATEGORY_BY_ID),
    },
    {
      name: 'spend_by_category (umbrella)',
      answerFacts: () =>
        answerSpendByCategory(BREAKDOWN, { type: 'categories', categoryIds: ['groceries', 'dining'], label: 'food' }, JUNE).facts,
      trace: () =>
        traceSpendByCategory(BREAKDOWN, { type: 'categories', categoryIds: ['groceries', 'dining'], label: 'food' }, TXNS, JUNE, CATEGORY_BY_ID),
    },
  ];

  for (const c of cases) {
    it(`${c.name}: every tagged fact opens a panel whose rows sum to the fact's own cents`, () => {
      const facts = c.answerFacts();
      const trace = c.trace();
      expect(trace.reconciled).toBe(true);
      for (const f of facts) {
        const view = factView(trace, f.traceKey, f.cents);
        expect(view).not.toBeNull();
        expect(view!.amountCents).toBe(f.cents);
        expect(sumRows(view!.rows)).toBe(f.cents);
        // Only that category's rows are shown.
        for (const r of view!.rows) expect(r.categoryId).toBe(f.traceKey);
      }
    });
  }

  it('top_categories: a NON-TOP fact is tappable even though the HEADLINE panel hides groups', () => {
    const trace = traceTopCategories(BREAKDOWN, 3, TXNS, JUNE, CATEGORY_BY_ID);
    // The headline panel honestly refuses the group breakdown (2a P1-1 guard)…
    expect(reconciledView(trace).groups).toBeNull();
    // …but the groceries FACT (8000, non-top) reconciles on its own.
    const view = factView(trace, 'groceries', 8000);
    expect(view).not.toBeNull();
    expect(view!.rows).toHaveLength(2); // 5000 + 3000
    expect(sumRows(view!.rows)).toBe(8000);
  });
});

// ── The gates are real (false-negative guards — each failure mode → null) ────

describe('factView refuses everything it cannot stand behind', () => {
  const trace = traceSpendTotal(BREAKDOWN, TXNS, JUNE, CATEGORY_BY_ID);

  it('drifted fact cents (builder/trace divergence) → null', () => {
    expect(factView(trace, 'groceries', 8000 + 1)).toBeNull();
  });

  it('unknown traceKey → null', () => {
    expect(factView(trace, 'not-a-category', 8000)).toBeNull();
  });

  it('untagged fact (no traceKey / no cents) → null', () => {
    expect(factView(trace, undefined, 8000)).toBeNull();
    expect(factView(trace, 'groceries', undefined)).toBeNull();
  });

  it('absent trace / not_row_sum → null', () => {
    expect(factView(undefined, 'groceries', 8000)).toBeNull();
    expect(factView({ kind: 'not_row_sum', intentKind: 'net_worth' }, 'groceries', 8000)).toBeNull();
  });

  it('an UNRECONCILED trace green-checks nothing — no per-fact panel either', () => {
    expect(factView({ ...trace, reconciled: false }, 'groceries', 8000)).toBeNull();
  });

  it('doctored group rows (a row dropped after the fact) → null', () => {
    const doctored: RowSumTrace = {
      ...trace,
      groups: trace.groups!.map((g) =>
        g.key === 'groceries' ? { ...g, rows: g.rows.slice(0, 1) } : g,
      ),
    };
    expect(factView(doctored, 'groceries', 8000)).toBeNull();
  });
});

// ── Pinned shape: single-member umbrella (critic 2b F5) ──────────────────────

describe('single-member umbrella: the tagged fact stays PLAIN — an honest non-offer', () => {
  const target: SpendTarget = { type: 'categories', categoryIds: ['groceries'], label: 'food' };

  it('the fact is tagged but the trace offers no group, so factView refuses the tap', () => {
    const a = answerSpendByCategory(BREAKDOWN, target, JUNE);
    expect(a.facts).toHaveLength(1);
    expect(a.facts[0].traceKey).toBe('groceries'); // tagged…
    const trace = traceSpendByCategory(BREAKDOWN, target, TXNS, JUNE, CATEGORY_BY_ID);
    expect(trace.groups).toBeUndefined(); // …but a lone cited category carries no groups
    expect(factView(trace, a.facts[0].traceKey, a.facts[0].cents)).toBeNull();
    // Nothing is lost: the fact's figure IS the headline, whose own tap
    // reconciles the same rows — a duplicate per-fact panel would add nothing.
    expect(trace.headlineCents).toBe(a.facts[0].cents);
    expect(trace.reconciled).toBe(true);
  });
});

// ── txnId threading (slice 2b write-path key) ────────────────────────────────

describe('trace rows carry txnId exactly where the correction chip is offered', () => {
  it('spend-family rows carry the fixture ids', () => {
    const trace = traceSpendTotal(BREAKDOWN, TXNS, JUNE, CATEGORY_BY_ID);
    const ids = trace.rows.map((r) => r.txnId).sort();
    expect(ids).toEqual(['tx-dine', 'tx-groc-1', 'tx-groc-2', 'tx-shop']);
  });

  it('merchant_spend and income rows carry none (no chip — a category change does not move those figures the same way)', () => {
    const m = traceMerchantSpend(merchantSpend(toPurchaseRows(TXNS), JUNE, 'kroger', TODAY, CATEGORY_BY_ID));
    expect(m.rows.length).toBeGreaterThan(0);
    for (const r of m.rows) expect(r.txnId).toBeUndefined();
    const inc = traceIncome(monthlyFlows(TXNS), TXNS, JUNE);
    expect(inc.rows.length).toBeGreaterThan(0);
    for (const r of inc.rows) expect(r.txnId).toBeUndefined();
  });

  it('CORRECTABLE_KINDS is exactly the category-sum family', () => {
    expect([...CORRECTABLE_KINDS].sort()).toEqual(['spend_by_category', 'spend_total', 'top_categories']);
  });
});
