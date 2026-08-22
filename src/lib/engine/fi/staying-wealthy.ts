/**
 * P1.2 — "Staying wealthy" survival row (C2 · Housel).
 *
 * Composes three engines `/coach` already runs: card-cleared streak, cash
 * runway, and lifestyle creep. No new money math. Each checkmark is a claim
 * about THAT signal — the framing never asserts all three are true.
 *
 * Present rules reuse existing engine facts:
 *  - cards: at least one full month of every resolved statement cleared
 *    (`streakMonths > 0`)
 *  - runway: a positive finite month count (the same number `runwayTitle`
 *    prints). Zero / negative is not a cushion; non-finite is "no expenses"
 *  - income: `creepCard`'s "Tracking income" state — both sides measured
 *    and not flagged. `!flagged` alone is also the incomparable window.
 */
import type { CardClearedStreakResult } from '@/lib/engine/cards/cleared-streak';
import { COACH_COPY } from './coach-copy';
import type { CreepResult } from './insights';

export type SurvivalSignalId = 'cards' | 'runway' | 'income';

export type CardsSignalState = 'present' | 'forming' | 'no_history' | 'broken';
export type RunwaySignalState = 'present' | 'building' | 'unknown';
export type IncomeSignalState = 'present' | 'outpaced' | 'unknown';

export interface SurvivalSignal {
  id: SurvivalSignalId;
  present: boolean;
  label: string;
}

export interface StayingWealthyRow {
  title: string;
  framing: string;
  footer: string;
  signals: [SurvivalSignal, SurvivalSignal, SurvivalSignal];
}

export function cardsSignalState(cardCleared: CardClearedStreakResult): CardsSignalState {
  if (cardCleared.streakMonths > 0) return 'present';
  if (cardCleared.formingThisMonth) return 'forming';
  if (cardCleared.latestMonth === null) return 'no_history';
  return 'broken';
}

export function runwaySignalState(runwayMonths: number): RunwaySignalState {
  if (!Number.isFinite(runwayMonths)) return 'unknown';
  if (runwayMonths > 0) return 'present';
  return 'building';
}

export function incomeSignalState(creep: CreepResult): IncomeSignalState {
  if (!creep.incomeMeasured || !creep.spendMeasured) return 'unknown';
  return creep.flagged ? 'outpaced' : 'present';
}

export function composeStayingWealthy(input: {
  cardCleared: CardClearedStreakResult;
  runwayMonths: number;
  creep: CreepResult;
}): StayingWealthyRow {
  const cards = cardsSignalState(input.cardCleared);
  const runway = runwaySignalState(input.runwayMonths);
  const income = incomeSignalState(input.creep);
  return {
    title: COACH_COPY.stayingWealthyTitle(),
    framing: COACH_COPY.stayingWealthyFraming(),
    footer: COACH_COPY.stayingWealthyFooter(),
    signals: [
      {
        id: 'cards',
        present: cards === 'present',
        label: COACH_COPY.stayingWealthyCards(cards),
      },
      {
        id: 'runway',
        present: runway === 'present',
        label: COACH_COPY.stayingWealthyRunway(runway, input.runwayMonths),
      },
      {
        id: 'income',
        present: income === 'present',
        label: COACH_COPY.stayingWealthyIncome(income),
      },
    ],
  };
}
