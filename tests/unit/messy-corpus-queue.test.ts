/**
 * Phase-4 lock (PULSE_CATEGORIZATION_FIX): the 437-transaction messy corpus,
 * through the REAL pipeline + grouping, asserts the fix-doc's targets at the
 * engine level — pure and deterministic (same corpus as the Phase-2 baseline
 * and the Phase-5 before/after).
 *
 * Baseline (Phase 2, pre-fix): 144 review rows (33.0%) across 24 groups from
 * 50 real merchants (63 fragmented identities); 0 usable suggestions.
 */
import { describe, expect, it } from 'vitest';
import { categorize } from '@/lib/engine/categorize/pipeline';
import type { RuleLike } from '@/lib/engine/categorize/pipeline';
import { groupReviewRows, type ReviewRow } from '@/lib/engine/categorize/group';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { buildMessyTransactions, MESSY_MERCHANTS } from '../../scripts/messy-corpus';

const AS_OF = '2026-07-01';

function run(rules: RuleLike[]) {
  const txns = buildMessyTransactions(AS_OF, 'chk', 'card');
  const out = txns.map((t) => ({
    txn: t,
    verdict: categorize(
      { rawDescriptor: t.rawDescriptor, amountCents: t.amountCents, date: t.date, accountId: t.accountId },
      rules,
    ),
  }));
  const review = out.filter((o) => o.verdict.needsReview);
  const rows: ReviewRow[] = review.map((o, i) => ({
    id: `r${i}`,
    merchantId: o.verdict.merchantCanonical, // canonical stands in for the FK in the pure run
    merchantCanonical: o.verdict.merchantCanonical,
    rawDescriptor: o.txn.rawDescriptor,
    amountCents: o.txn.amountCents,
    date: o.txn.date,
    accountName: 'X',
    status: 'POSTED',
    aggregate: normalizeMerchant(o.txn.rawDescriptor).aggregate,
    suggestedCategoryId: o.verdict.categoryId === 'uncategorized' ? null : o.verdict.categoryId,
    providerCategoryId: null, // pure messy-corpus run has no Plaid PFC — provider fallback inert
  }));
  return { total: txns.length, out, review, groups: groupReviewRows(rows) };
}

describe('messy corpus through the rebuilt engine (Phase 4)', () => {
  it('day one, zero rules: the queue is DECISION-sized and most rows auto-apply', () => {
    const { total, review, groups } = run([]);
    const reviewRate = review.length / total;
    const autoRate = 1 - reviewRate;
    // Evidence line (Phase-2 acceptance style: print the real numbers)
    console.log(
      `[messy-corpus] total=${total} review=${review.length} (${(reviewRate * 100).toFixed(1)}%) groups=${groups.length} auto=${(autoRate * 100).toFixed(1)}%`,
    );
    expect(total).toBeGreaterThanOrEqual(400); // the fix-doc's dataset floor
    // Baseline was 33.0% review / 24 groups. The identity work must beat it
    // decisively BEFORE any learning: ≥75% auto-applied, ≤20 decisions pending.
    expect(autoRate).toBeGreaterThanOrEqual(0.75);
    expect(groups.length).toBeLessThanOrEqual(20);
    // The queue unit is the DECISION: rows-per-decision must stay well above 1
    // for the heavy groups to be worth one tap (structural de-inflation).
    expect(review.length / groups.length).toBeGreaterThan(2);
  });

  it('after ONE pass of group decisions, re-ingesting the same 60 days lands under the SPEC 5%', () => {
    const first = run([]);
    // One decision per rule-ELIGIBLE group = the merchant rules the group flow
    // creates (aggregates — Zelle/checks/Venmo/ATM — never get rules, #23).
    const intendedByName = new Map(MESSY_MERCHANTS.flatMap((m) => m.variants.map((v) => [v, m.intended] as const)));
    const rules: RuleLike[] = first.groups
      .filter((g) => !g.aggregate)
      .map((g, i) => ({
        id: `rule-${i}`,
        merchantCanonical: g.merchantCanonical,
        categoryId: intendedByName.get(g.variants[0]) ?? 'shopping',
        minAmountCents: null,
        maxAmountCents: null,
        weekendOnly: null,
        weekdayOnly: null,
        accountId: null,
        priority: 100,
      }));

    const second = run(rules);
    const rate = second.review.length / second.total;
    console.log(
      `[messy-corpus] after ${rules.length} group decisions: review=${second.review.length}/${second.total} (${(rate * 100).toFixed(1)}%) — SPEC target <5%`,
    );
    // SPEC.md:28 — <5% needing review; the residue is the honest aggregate tail
    // (Zelle payees, checks), which no merchant rule may ever absorb.
    expect(rate).toBeLessThan(0.05);
    for (const o of second.review) {
      expect(normalizeMerchant(o.txn.rawDescriptor).aggregate).toBe(true);
    }
  });
});
