/**
 * Ask Aimplifi — stay_wealthy intent (standing Coach staying-wealthy row).
 *
 * /coach already composes card-cleared + runway + creep via
 * `composeStayingWealthy`. This slice routes "am I staying wealthy?" onto
 * that SAME row. No new money math. Copy does not say "this card" or "below".
 *
 * Abstention tests are the majority (docs/lessons/context-carrying-features-must-abstain.md).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import {
  parseAssistantQuery,
  stayWealthyFromQuestion,
  validateIntent,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { answerStayWealthy } from '@/lib/engine/assistant/answer';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { composeStayingWealthy } from '@/lib/engine/fi/staying-wealthy';
import type { CardClearedStreakResult } from '@/lib/engine/cards/cleared-streak';
import type { CreepResult } from '@/lib/engine/fi/insights';
import { cents } from '@/lib/money';

const today = isoDate('2026-06-10');
const kindOf = (q: string) => parseAssistantQuery(q, today).kind;

const cardsPresent: CardClearedStreakResult = {
  streakMonths: 17,
  latestMonth: '2026-05',
  formingThisMonth: false,
  cardsInStreak: 4,
  statementsInStreak: 59,
  brokeAt: null,
};
const creepClear: CreepResult = {
  flagged: false,
  spendGrowthBps: 20,
  incomeGrowthBps: 10,
  incomeMeasured: true,
  spendMeasured: true,
  incomeBaselineCents: cents(500_000),
  discretionaryBaselineCents: cents(120_000),
  monthlyDiscretionaryCents: [],
  windowMonths: 6,
  loanPaymentsExcluded: false,
};

describe('routing — stay_wealthy', () => {
  it('test_regression__stay_wealthy_am_i_staying_wealthy_routes_to_coach', () => {
    expect(kindOf('Am I staying wealthy?')).toBe('stay_wealthy');
    expect(kindOf('am I staying wealthy')).toBe('stay_wealthy');
    expect(kindOf('how are my survival signals')).toBe('stay_wealthy');
    expect(kindOf("what's my survival signal")).toBe('stay_wealthy');
    expect(kindOf('getting wealthy vs staying wealthy')).toBe('stay_wealthy');
    expect(kindOf('getting wealthy and staying wealthy')).toBe('stay_wealthy');
  });

  it('does not steal runway, creep, FI, cuts, or cash-needed', () => {
    expect(kindOf('How many months of runway do I have?')).toBe('runway');
    expect(kindOf('Is my lifestyle creeping?')).toBe('lifestyle_creep');
    expect(kindOf('When can I retire?')).toBe('fi_status');
    expect(kindOf('What should I cut?')).toBe('what_to_cut');
    expect(kindOf('how much do I need to pay my cards?')).toBe('cash_needed');
  });
});

describe('abstentions — the majority', () => {
  it('an amount declines so other planners can match', () => {
    expect(kindOf('staying wealthy $10,000')).not.toBe('stay_wealthy');
    expect(stayWealthyFromQuestion('am I staying wealthy $500', today)).toBeNull();
  });

  it('test_regression__stay_wealthy_date_window_abstains', () => {
    expect(kindOf('am I staying wealthy last month')).toBe('unknown');
    expect(kindOf('survival signals this month')).toBe('unknown');
    expect(kindOf('am I staying wealthy in 2025')).toBe('unknown');
    expect(stayWealthyFromQuestion('am I staying wealthy last month', today)).toEqual({
      kind: 'unknown',
      question: 'am I staying wealthy last month',
    });
  });

  it('a named store or category is not the standing row', () => {
    expect(kindOf('am I staying wealthy at Costco')).toBe('unknown');
    expect(kindOf('staying wealthy on groceries')).toBe('unknown');
  });

  it('unrelated wealth words do not match', () => {
    expect(kindOf('I got a haircut')).not.toBe('stay_wealthy');
    expect(kindOf('how do I get wealthy')).not.toBe('stay_wealthy');
    expect(kindOf('If I want to save up to $10 million, what do I need to do?')).not.toBe(
      'stay_wealthy',
    );
  });

  it('validateIntent accepts only the closed kind', () => {
    expect(validateIntent({ kind: 'stay_wealthy' })).toEqual({ kind: 'stay_wealthy' });
    expect(validateIntent({ kind: 'stay_wealthy', extra: true })).toEqual({ kind: 'stay_wealthy' });
  });
});

describe('intentFromKind — the model picks a route, never a window', () => {
  it('re-derives from the words; a non-stay-wealthy question tagged stay_wealthy abstains', () => {
    expect(intentFromKind('stay_wealthy', 'Am I staying wealthy?', today)).toEqual({
      kind: 'stay_wealthy',
    });
    expect(intentFromKind('stay_wealthy', 'how much did I spend last month', today)).toBeNull();
    expect(intentFromKind('stay_wealthy', 'whatever', today)).toBeNull();
    expect(intentFromKind('stay_wealthy', 'How many months of runway do I have?', today)).toBeNull();
  });
});

describe('answerStayWealthy — phrases the coach row, originates no signal', () => {
  it('test_regression__stay_wealthy_answer_agrees_with_coach_row', () => {
    const row = composeStayingWealthy({
      cardCleared: cardsPresent,
      runwayMonths: 4.2,
      creep: creepClear,
    });
    const a = answerStayWealthy(row);
    expect(a.kind).toBe('stay_wealthy');
    expect(a.headline).toBe(COACH_COPY.stayingWealthyFraming());
    expect(a.headline).toBe(row.framing);
    expect(a.detail).toContain(row.signals[0].label);
    expect(a.detail).toContain(row.signals[1].label);
    expect(a.detail).toContain(row.signals[2].label);
    expect(a.detail).toContain(row.footer);
    expect(a.source).toEqual({ label: 'See on Coach', href: '/coach' });
    expect(a.facts.map((f) => f.value)).toEqual(row.signals.map((s) => s.label));
  });

  it('test_regression__stay_wealthy_copy_does_not_claim_this_card_or_below', () => {
    const row = composeStayingWealthy({
      cardCleared: cardsPresent,
      runwayMonths: 4.2,
      creep: creepClear,
    });
    const a = answerStayWealthy(row);
    const text = `${a.headline} ${a.detail} ${a.facts.map((f) => `${f.label} ${f.value}`).join(' ')}`;
    expect(text).not.toMatch(/\bthis card\b/i);
    expect(text).not.toMatch(/\bbelow\b/i);
  });
});
