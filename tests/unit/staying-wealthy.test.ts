/**
 * P1.2 — staying-wealthy row. Composes card-cleared + runway + creep.
 * No new money math. The framing must not claim all three signals are true.
 */
import { describe, expect, it } from 'vitest';
import type { CardClearedStreakResult } from '@/lib/engine/cards/cleared-streak';
import type { CreepResult } from '@/lib/engine/fi/insights';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import {
  composeStayingWealthy,
  cardsSignalState,
  runwaySignalState,
  incomeSignalState,
} from '@/lib/engine/fi/staying-wealthy';
import { cents } from '@/lib/money';

const cardsPresent: CardClearedStreakResult = {
  streakMonths: 17,
  latestMonth: '2026-05',
  formingThisMonth: false,
  cardsInStreak: 4,
  statementsInStreak: 59,
  brokeAt: null,
};
const cardsBroken: CardClearedStreakResult = {
  ...cardsPresent,
  streakMonths: 0,
  cardsInStreak: 0,
  statementsInStreak: 0,
  brokeAt: '2026-05',
};
const cardsNoHistory: CardClearedStreakResult = {
  streakMonths: 0,
  latestMonth: null,
  formingThisMonth: false,
  cardsInStreak: 0,
  statementsInStreak: 0,
  brokeAt: null,
};
const cardsForming: CardClearedStreakResult = {
  ...cardsNoHistory,
  formingThisMonth: true,
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
const creepFlagged: CreepResult = { ...creepClear, flagged: true, spendGrowthBps: 1240 };
const creepUnknown: CreepResult = {
  ...creepClear,
  flagged: false,
  incomeMeasured: false,
  incomeBaselineCents: cents(8),
};

describe('signal states — reuse the existing engines, invent no threshold', () => {
  it('cards: a positive streak is present; forming / none / broken are not', () => {
    expect(cardsSignalState(cardsPresent)).toBe('present');
    expect(cardsSignalState(cardsForming)).toBe('forming');
    expect(cardsSignalState(cardsNoHistory)).toBe('no_history');
    expect(cardsSignalState(cardsBroken)).toBe('broken');
  });

  it('runway: a positive finite count is a cushion; 0/negative build; non-finite is unknown', () => {
    expect(runwaySignalState(4.2)).toBe('present');
    expect(runwaySignalState(0.1)).toBe('present');
    expect(runwaySignalState(0)).toBe('building');
    expect(runwaySignalState(-2.3)).toBe('building');
    expect(runwaySignalState(Infinity)).toBe('unknown');
  });

  it('income: tracking requires both sides measured and not flagged', () => {
    expect(incomeSignalState(creepClear)).toBe('present');
    expect(incomeSignalState(creepFlagged)).toBe('outpaced');
    expect(incomeSignalState(creepUnknown)).toBe('unknown');
    expect(
      incomeSignalState({ ...creepClear, flagged: false, spendMeasured: false }),
    ).toBe('unknown');
  });
});

describe('composeStayingWealthy — each checkmark is that signal, not a trio claim', () => {
  it('test_regression__stay_wealthy_does_not_claim_all_three_when_one_is_absent', () => {
    const row = composeStayingWealthy({
      cardCleared: cardsBroken,
      runwayMonths: 4.2,
      creep: creepClear,
    });
    expect(row.framing).toBe(COACH_COPY.stayingWealthyFraming());
    expect(row.framing).not.toMatch(/every card clears|tracking income|months of runway/i);
    expect(row.signals[0]).toEqual({
      id: 'cards',
      present: false,
      label: COACH_COPY.stayingWealthyCards('broken'),
    });
    expect(row.signals[1].present).toBe(true);
    expect(row.signals[1].label).toBe(COACH_COPY.stayingWealthyRunway('present', 4.2));
    expect(row.signals[2].present).toBe(true);
    expect(row.signals.map((s) => s.present).filter(Boolean)).toHaveLength(2);
  });

  it('all three present uses the plan labels and the same runway number the card prints', () => {
    const row = composeStayingWealthy({
      cardCleared: cardsPresent,
      runwayMonths: 4.2,
      creep: creepClear,
    });
    expect(row.title).toBe('Staying wealthy');
    expect(row.signals[0].label).toBe('every card clears in full');
    expect(row.signals[1].label).toBe('4.2-month cushion');
    expect(row.signals[2].label).toBe('spending is tracking income');
    expect(row.signals.every((s) => s.present)).toBe(true);
    expect(row.footer).toBe(COACH_COPY.stayingWealthyFooter());
  });

  it('test_regression__stay_wealthy_copy_does_not_claim_this_card_or_below', () => {
    const variants = [
      composeStayingWealthy({ cardCleared: cardsPresent, runwayMonths: 4.2, creep: creepClear }),
      composeStayingWealthy({ cardCleared: cardsForming, runwayMonths: -2.3, creep: creepFlagged }),
      composeStayingWealthy({
        cardCleared: cardsNoHistory,
        runwayMonths: Infinity,
        creep: creepUnknown,
      }),
    ];
    for (const row of variants) {
      const text = [row.title, row.framing, row.footer, ...row.signals.map((s) => s.label)].join(
        ' ',
      );
      expect(text).not.toMatch(/\bthis card\b/i);
      expect(text).not.toMatch(/\bbelow\b/i);
    }
  });
});
