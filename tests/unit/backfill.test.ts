/**
 * Backfill planner (DECISIONS #116) — pure unit tests. Proves the safety rails:
 * only unsure rows are re-filed, the verdict must be confident+concrete, an inflow
 * is never booked as spend, settled rows and split parents are untouched, and user
 * rules win. No DB — the server action's DB write is covered separately.
 */
import { describe, expect, it } from 'vitest';
import { planBackfill, type BackfillRow } from '@/lib/engine/categorize/backfill';
import type { RuleLike } from '@/lib/engine/categorize/pipeline';

function row(p: Partial<BackfillRow> & { id: string; rawDescriptor: string }): BackfillRow {
  return {
    amountCents: -1234,
    date: '2026-06-10',
    accountId: 'a1',
    categoryId: 'uncategorized',
    needsReview: true,
    // Untagged unless a case says otherwise (O.15 slice 6) — the shape every row
    // in this suite had before the tag action existed.
    taxClass: null,
    ...p,
  };
}

describe('planBackfill (pure)', () => {
  it('re-files an unsure row that now matches an improved rule', () => {
    const plan = planBackfill([row({ id: 't1', rawDescriptor: 'DELTA DENTAL OF GA PREMIUM' })]);
    expect(plan.scanned).toBe(1);
    expect(plan.stillUnsure).toBe(0);
    expect(plan.refiles).toHaveLength(1);
    expect(plan.refiles[0]).toMatchObject({
      id: 't1',
      fromCategoryId: 'uncategorized',
      toCategoryId: 'dental-insurance',
    });
    expect(plan.refiles[0].confidenceBps).toBeGreaterThanOrEqual(7000);
  });

  it('allows an income inflow but blocks an inflow that would resolve to a spend category', () => {
    const plan = planBackfill([
      row({ id: 'in', rawDescriptor: 'GUSTO PAYROLL 9X8Y7Z DIRECT DEP', amountCents: 500000 }), // inflow → income OK
      row({ id: 'bad', rawDescriptor: 'STARBUCKS 800-782-7282', amountCents: 500 }), // inflow → would be coffee (a spend leaf) → blocked
    ]);
    const ids = plan.refiles.map((r) => r.id);
    expect(ids).toContain('in');
    expect(ids).not.toContain('bad');
    expect(plan.refiles.find((r) => r.id === 'in')!.toCategoryId).toBe('paycheck'); // #163: payroll = paycheck leaf
    expect(plan.stillUnsure).toBe(1); // the blocked inflow stays for review
  });

  it('leaves a genuinely unknown descriptor in review', () => {
    const plan = planBackfill([row({ id: 'u', rawDescriptor: 'ACME WIDGETS LLC 7781' })]);
    expect(plan.refiles).toHaveLength(0);
    expect(plan.scanned).toBe(1);
    expect(plan.stillUnsure).toBe(1);
  });

  it('never touches a settled row or a split-parent container', () => {
    const plan = planBackfill([
      row({
        id: 'settled',
        rawDescriptor: 'STARBUCKS 800-782-7282',
        amountCents: -600,
        categoryId: 'dining',
        needsReview: false,
      }),
      row({
        id: 'split',
        rawDescriptor: 'KROGER #688 ATLANTA GA',
        categoryId: null,
        needsReview: false,
        isSplitParent: true,
      }),
    ]);
    expect(plan.scanned).toBe(0);
    expect(plan.refiles).toHaveLength(0);
  });

  it('a user rule drives the re-file (priority over merchant default)', () => {
    const rules: RuleLike[] = [
      {
        id: 'r1',
        merchantCanonical: 'Starbucks',
        minAmountCents: null,
        maxAmountCents: null,
        weekendOnly: null,
        weekdayOnly: null,
        accountId: null,
        categoryId: 'coffee',
        priority: 100,
      },
    ];
    const plan = planBackfill(
      [row({ id: 't', rawDescriptor: 'STARBUCKS 800-782-7282', amountCents: -600 })],
      rules,
    );
    expect(plan.refiles[0].toCategoryId).toBe('coffee');
    expect(plan.refiles[0].source).toBe('user-rule');
  });

  it('re-files a row left uncategorized even if it was not flagged needsReview', () => {
    const plan = planBackfill([
      row({
        id: 'x',
        rawDescriptor: 'NETFLIX.COM 866-579-7172',
        amountCents: -1599,
        categoryId: 'uncategorized',
        needsReview: false,
      }),
    ]);
    expect(plan.scanned).toBe(1);
    expect(plan.refiles[0].toCategoryId).toBe('entertainment');
  });
});

/**
 * The rule THEN-action "tag for taxes" reaching rows that were ingested before the
 * rule existed (O.15 slice 6). The planner is where the decision is made; the
 * server writer carries it out under a second `taxClass: null` guard.
 */
describe('planBackfill — the tag-for-taxes action', () => {
  const RULE: RuleLike = {
    id: 'r-tax',
    merchantCanonical: null,
    matchKeywords: ['mirko'],
    setTaxClass: 'business',
    minAmountCents: null,
    maxAmountCents: null,
    weekendOnly: null,
    weekdayOnly: null,
    accountId: null,
    categoryId: 'dining',
    priority: 110,
  };

  it('carries the stamp onto an untagged row the rule now resolves', () => {
    const plan = planBackfill([row({ id: 't1', rawDescriptor: 'MIRKO PASTA' })], [RULE]);
    expect(plan.refiles).toHaveLength(1);
    expect(plan.refiles[0].toCategoryId).toBe('dining');
    expect(plan.refiles[0].taxClassStamp).toBe('business');
  });

  it('carries NO stamp onto a row the reader already tagged', () => {
    const plan = planBackfill(
      [row({ id: 't1', rawDescriptor: 'MIRKO PASTA', taxClass: 'medical' })],
      [RULE],
    );
    expect(plan.refiles).toHaveLength(1); // still re-filed…
    expect(plan.refiles[0].taxClassStamp).toBeNull(); // …and the tag left alone
  });

  it('carries no stamp when the rule has no tag action — every pre-slice rule is unchanged', () => {
    const plan = planBackfill(
      [row({ id: 't1', rawDescriptor: 'MIRKO PASTA' })],
      [{ ...RULE, setTaxClass: null }],
    );
    expect(plan.refiles[0].taxClassStamp).toBeNull();
  });
});
