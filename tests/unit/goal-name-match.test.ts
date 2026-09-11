/**
 * Goal-name matching for Ask `goal_status` (DECISIONS #738).
 *
 * Abstention tests are the majority — a confident match on the wrong goal is
 * the failure mode (docs/lessons/context-carrying-features-must-abstain.md).
 */
import { describe, expect, it } from 'vitest';

import { leftoverAfterGoalName, matchGoalName, normalizeGoalName } from '@/lib/engine/goals/match';

const NAMES = ['Japan trip', 'Emergency fund', 'Hawaii vacation'] as const;

describe('normalizeGoalName', () => {
  it('folds case, punctuation, and extra space', () => {
    expect(normalizeGoalName('  Japan-trip  ')).toBe('japan trip');
    expect(normalizeGoalName('Emergency fund')).toBe('emergency fund');
  });
});

describe('matchGoalName — unique hits', () => {
  it('exact match is case-insensitive and uses the stored spelling', () => {
    expect(matchGoalName('japan trip', NAMES)).toEqual({ kind: 'unique', name: 'Japan trip' });
    expect(matchGoalName('JAPAN TRIP', NAMES)).toEqual({ kind: 'unique', name: 'Japan trip' });
  });

  it('a unique whole-word span inside a stored name hits', () => {
    expect(matchGoalName('japan', NAMES)).toEqual({ kind: 'unique', name: 'Japan trip' });
    expect(matchGoalName('emergency', NAMES)).toEqual({ kind: 'unique', name: 'Emergency fund' });
  });

  it('a stored name contained in a longer query hits uniquely', () => {
    expect(matchGoalName('my japan trip fund', NAMES)).toEqual({ kind: 'unique', name: 'Japan trip' });
  });
});

describe('matchGoalName — abstentions (the majority)', () => {
  it('no names, empty query, and a 1-character query are none', () => {
    expect(matchGoalName('japan', [])).toEqual({ kind: 'none' });
    expect(matchGoalName('   ', NAMES)).toEqual({ kind: 'none' });
    expect(matchGoalName('j', NAMES)).toEqual({ kind: 'none' });
  });

  it('a name that is not on the list is none — never a neighbour', () => {
    expect(matchGoalName('italy', NAMES)).toEqual({ kind: 'none' });
    expect(matchGoalName('japanes', NAMES)).toEqual({ kind: 'none' });
  });

  it('a shared whole word across two goals is ambiguous, not a guess', () => {
    expect(matchGoalName('trip', ['Japan trip', 'Italy trip'])).toEqual({
      kind: 'ambiguous',
      names: ['Japan trip', 'Italy trip'],
    });
  });

  it('two stored rows with the same normalized name are ambiguous', () => {
    expect(matchGoalName('japan trip', ['Japan trip', 'japan trip'])).toEqual({
      kind: 'ambiguous',
      names: ['Japan trip', 'japan trip'],
    });
  });

  it('a prefix that is not a whole word does not match ("car" ≠ "card")', () => {
    expect(matchGoalName('car', ['Emergency card'])).toEqual({ kind: 'none' });
    expect(matchGoalName('fund', ['Refundable deposit'])).toEqual({ kind: 'none' });
  });

  it('debt-free / reserve names are just strings here — the caller supplies savings names only', () => {
    expect(matchGoalName('debt free', ['Japan trip'])).toEqual({ kind: 'none' });
  });

  it('a one-token stored name inside a longer query is none, not the wrong row (critic P1-4)', () => {
    expect(matchGoalName('emergency fund', ['Fund'])).toEqual({ kind: 'none' });
    expect(matchGoalName('car insurance deductible', ['Car'])).toEqual({ kind: 'none' });
    expect(matchGoalName('wedding ring fund', ['Ring'])).toEqual({ kind: 'none' });
    expect(matchGoalName('japan trip', ['Trip'])).toEqual({ kind: 'none' });
  });

  it('a longer query is none unless leftover tokens are filler (critic #738 cycle 2 P0-2)', () => {
    expect(matchGoalName('car loan payoff', ['Car loan'])).toEqual({ kind: 'none' });
    expect(matchGoalName('down payment or should i invest', ['Down payment'])).toEqual({ kind: 'none' });
    expect(matchGoalName('credit card payments', ['Credit card'])).toEqual({ kind: 'none' });
    expect(matchGoalName('japan trip and my hawaii vacation', ['Japan trip'])).toEqual({ kind: 'none' });
    expect(matchGoalName('japan trip fund', ['Japan trip'])).toEqual({
      kind: 'unique',
      name: 'Japan trip',
    });
  });
});

describe('leftoverAfterGoalName', () => {
  it('drops the stored name so a month inside the name is not a window', () => {
    expect(leftoverAfterGoalName('am I on track for my June wedding?', 'June wedding')).not.toMatch(
      /\bjune\b/,
    );
    expect(leftoverAfterGoalName('am I on track for my Japan trip this month?', 'Japan trip')).toMatch(
      /\bthis month\b/,
    );
  });
});
