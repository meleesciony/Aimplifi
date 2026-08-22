/**
 * Ask Aimplifi — conscious_spending intent (the /budgets bucket strip).
 *
 * `/budgets` already prints Sethi's lens via `COACH_COPY.consciousSpending`
 * over `mapToConsciousBuckets`. This slice routes "how are my spending
 * buckets?" through Ask onto that SAME caption. No new spend math. Copy
 * does not say "this card" or "below" — those claims are false in Ask.
 *
 * Abstention tests are the majority (docs/lessons/context-carrying-features-must-abstain.md).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import {
  consciousSpendingFromQuestion,
  parseAssistantQuery,
  validateIntent,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { answerConsciousSpending } from '@/lib/engine/assistant/answer';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { computeSpendingPlan, type SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';
import { consciousFixedCounts, mapToConsciousBuckets } from '@/lib/engine/spending-plan/conscious';

const today = isoDate('2026-06-10');
const kindOf = (q: string) => parseAssistantQuery(q, today).kind;

const plan = (over: Partial<Parameters<typeof computeSpendingPlan>[0]> = {}) =>
  computeSpendingPlan({
    today,
    trailingMonthlyIncomeCents: [500_000],
    scheduledIncome: [],
    scheduledFixed: [{ amountCents: -300_000, cadence: 'MONTHLY' }],
    cardObligationsCents: 0,
    cardObligationsEstimated: false,
    obligationsBeyondMonthCents: 0,
    obligationsBeyondMonthThroughDate: null,
    obligationsBeyondMonthEstimated: false,
    goalContributionsCents: 50_000,
    savingsTargetBps: null,
    ...over,
  });

const NO_DISCLOSURES: SpendingPlanDisclosures = {
  undatedCards: [],
  statementPendingCards: [],
  duplicatePairs: [],
  frozenCards: [],
  creditCardCount: 0,
  creditCardsOutsideFigure: 0,
  cardsDatedAfterThisMonth: 0,
  fixedSeries: { detected: 0, counted: 0, onCard: 0, lapsed: 0, uncounted: 0, noCashAccount: 0 },
};

const clampPct = (bps: number) => Math.min(100, Math.max(0, Math.round(bps / 100)));

describe('routing — conscious_spending', () => {
  it('test_regression__conscious_spending_how_are_my_spending_buckets_routes_to_strip', () => {
    expect(kindOf('How are my spending buckets?')).toBe('conscious_spending');
    expect(kindOf('how are my spending buckets')).toBe('conscious_spending');
    expect(kindOf('how is my conscious spending')).toBe('conscious_spending');
    expect(kindOf("how's my conscious spending plan")).toBe('conscious_spending');
    expect(kindOf('how is my money split')).toBe('conscious_spending');
    expect(kindOf('how are my spending buckets this month')).toBe('conscious_spending');
  });

  it('does not steal cuts, FI, leftover dollars, or spend totals', () => {
    expect(kindOf('What should I cut?')).toBe('what_to_cut');
    expect(kindOf('When can I retire?')).toBe('fi_status');
    expect(kindOf('How much is guilt-free to spend this month?')).toBe('safe_to_spend');
    expect(kindOf("what's my guilt free spending")).toBe('safe_to_spend');
    expect(kindOf("what's my savings rate?")).toBe('savings_rate');
    expect(kindOf('how much did I spend last month')).toBe('spend_total');
  });
});

describe('abstentions — the majority', () => {
  it('an amount is a different planner', () => {
    expect(kindOf('how are my spending buckets $500')).not.toBe('conscious_spending');
    expect(consciousSpendingFromQuestion('how are my spending buckets $500', today)).toBeNull();
  });

  it('test_regression__conscious_spending_other_date_window_abstains', () => {
    expect(kindOf('how are my spending buckets last month')).toBe('unknown');
    expect(kindOf('conscious spending in 2025')).toBe('unknown');
    expect(consciousSpendingFromQuestion('how are my spending buckets last month', today)).toEqual({
      kind: 'unknown',
      question: 'how are my spending buckets last month',
    });
  });

  it('a named store or category is not the standing strip', () => {
    expect(kindOf('how are my spending buckets at Costco')).toBe('unknown');
    expect(kindOf('how is my grocery conscious spending')).toBe('unknown');
  });

  it('unrelated spend words do not match', () => {
    expect(kindOf('I got a haircut')).not.toBe('conscious_spending');
    expect(kindOf('how much did I spend last month')).not.toBe('conscious_spending');
    expect(kindOf('how much can I safely spend this month')).not.toBe('conscious_spending');
  });

  it('validateIntent accepts only the closed kind', () => {
    expect(validateIntent({ kind: 'conscious_spending' })).toEqual({ kind: 'conscious_spending' });
    expect(validateIntent({ kind: 'conscious_spending', extra: true })).toEqual({
      kind: 'conscious_spending',
    });
  });
});

describe('intentFromKind — the model picks a route, never a window', () => {
  it('re-derives from the words; a non-bucket question tagged conscious_spending abstains', () => {
    expect(intentFromKind('conscious_spending', 'How are my spending buckets?', today)).toEqual({
      kind: 'conscious_spending',
    });
    expect(intentFromKind('conscious_spending', 'how much did I spend last month', today)).toBeNull();
    expect(intentFromKind('conscious_spending', 'whatever', today)).toBeNull();
  });
});

describe('answerConsciousSpending — phrases the /budgets strip, originates no cents', () => {
  it('test_regression__conscious_spending_answer_agrees_with_budgets_caption', () => {
    const p = plan();
    const mapped = mapToConsciousBuckets(p);
    const share = (k: 'fixed' | 'savings' | 'guiltFree') =>
      mapped.buckets.find((b) => b.key === k)!.shareBps;
    const caption = COACH_COPY.consciousSpending(
      clampPct(share('fixed')),
      clampPct(share('savings')),
      clampPct(share('guiltFree')),
      consciousFixedCounts(p.reserveLines.length),
      p.savingsTargetBps,
    );
    const a = answerConsciousSpending(p, NO_DISCLOSURES);
    expect(a.kind).toBe('conscious_spending');
    expect(a.detail).toContain(caption);
    expect(a.source).toEqual({ label: 'See on Spending', href: '/budgets' });
    expect(a.facts[0]?.label).toBe('Fixed costs');
    expect(a.facts[0]?.value).toBe('60% · $3,000.00');
    expect(a.facts[1]?.value).toBe('10% · $500.00');
    expect(a.facts[2]?.value).toBe('30% · $1,500.00');
  });

  it('test_regression__conscious_spending_copy_does_not_claim_this_card_or_below', () => {
    const a = answerConsciousSpending(plan(), NO_DISCLOSURES);
    const empty = answerConsciousSpending(
      plan({ trailingMonthlyIncomeCents: [0], scheduledFixed: [], goalContributionsCents: 0 }),
      NO_DISCLOSURES,
    );
    for (const ans of [a, empty]) {
      const blob = `${ans.headline} ${ans.detail ?? ''} ${ans.facts.map((f) => f.value).join(' ')}`;
      expect(blob).not.toMatch(/this card/i);
      expect(blob).not.toMatch(/\bbelow\b/i);
    }
  });

  it('a missing income pattern refuses a percentage split', () => {
    const a = answerConsciousSpending(
      plan({ trailingMonthlyIncomeCents: [0], scheduledFixed: [], goalContributionsCents: 0 }),
      NO_DISCLOSURES,
    );
    expect(a.headline).toMatch(/no income pattern/i);
    expect(a.facts).toEqual([]);
    expect(a.detail).toBeUndefined();
  });
});
