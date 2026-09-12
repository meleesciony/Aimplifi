/**
 * TASKS GL.4 — the demo seed carries two savings goals so the live demo's /goals
 * and Home Goals card open populated (and the behind goal drives the
 * goal_behind_pace nudge). The rows are `kind: null` — byte-shape identical to what
 * the live createGoal writer stores, so every reader treats a seeded row like a
 * hand-made one. Dates derive from asOf; the seed clock stays DEFAULT_AS_OF in
 * production (businessToday precedence 2), so the hand math below holds on the
 * shipped demo and shifts coherently with --asOf.
 */
import { describe, expect, it } from 'vitest';
import { buildSeedData, DEFAULT_AS_OF } from '@/lib/seed/build';
import { goalProgress } from '@/lib/engine/goals/progress';
import { goalPaceSentence } from '@/lib/engine/goals/progress-copy';
import { isoDate } from '@/lib/dates';

const seed = buildSeedData('2026-06-10');

describe('seeded demo savings goals (GL.4)', () => {
  it('carries exactly two savings goals, kind null, on the demo user', () => {
    expect(seed.goals).toHaveLength(2);
    for (const g of seed.goals) {
      expect(g.userId).toBe('user-demo');
      expect(g.kind).toBeNull();
      expect(g.targetCents).toBeGreaterThan(0);
      expect(g.monthlyContributionCents ?? 0).toBeGreaterThan(0);
    }
    // Names avoid every e2e-created demo goal ('Japan trip', 'Education', 'Giving')
    // and the preset labels, so the create-then-delete specs and the picker stay exact.
    const names = seed.goals.map((g) => g.name).sort();
    expect(names).toEqual(['New Car Fund', 'Vacation Fund']);
  });

  it('Vacation Fund is a plain no-date goal: 8 months to funded at the default asOf', () => {
    const g = seed.goals.find((x) => x.name === 'Vacation Fund')!;
    const today = isoDate(DEFAULT_AS_OF);
    const p = goalProgress({
      targetCents: g.targetCents,
      savedCents: g.savedCents,
      monthlyContributionCents: g.monthlyContributionCents,
      targetDate: g.targetDate,
      today,
    });
    // $800 of $2,400 saved = exactly one third; $200/mo funds the remaining
    // $1,600 in 8 whole months (ceil(1600/200)), landing Feb 2027.
    expect(p.pace).toBe('no-date');
    expect(p.remainingCents).toBe(160000);
    expect(p.fundedBps).toBe(3333); // floored, never 3334
    expect(p.monthsToFunded).toBe(8);
    expect(p.fundedByDate).toBe('2027-02-10');
  });

  it('New Car Fund is BEHIND by 24 months with a $300/mo gap at the default asOf', () => {
    const g = seed.goals.find((x) => x.name === 'New Car Fund')!;
    const today = isoDate(DEFAULT_AS_OF);
    const p = goalProgress({
      targetCents: g.targetCents,
      savedCents: g.savedCents,
      monthlyContributionCents: g.monthlyContributionCents,
      targetDate: g.targetDate,
      today,
    });
    // Jun 2027 target (12 month-granular months out), $150/mo funds $5,400 in
    // 36 months → behind by 24; required monthly ceil(5400/12) = $450 → gap $300.
    expect(g.targetDate).toBe('2027-06-01');
    expect(p.pace).toBe('behind');
    expect(p.targetMonths).toBe(12);
    expect(p.monthsToFunded).toBe(36);
    expect(p.monthsDelta).toBe(24);
    expect(p.requiredMonthlyCents).toBe(45000);
    expect(p.gapMonthlyCents).toBe(30000);
  });

  it('the behind goal renders the card sentence from the seeded fields (one copy truth)', () => {
    const g = seed.goals.find((x) => x.name === 'New Car Fund')!;
    const today = isoDate(DEFAULT_AS_OF);
    const p = goalProgress({
      targetCents: g.targetCents,
      savedCents: g.savedCents,
      monthlyContributionCents: g.monthlyContributionCents,
      targetDate: g.targetDate,
      today,
    });
    const s = goalPaceSentence(p, {
      targetCents: g.targetCents,
      savedCents: g.savedCents,
      monthlyContributionCents: g.monthlyContributionCents,
      targetDate: g.targetDate,
      today,
    });
    expect(s).toContain('Behind pace');
    expect(s).toContain('$450.00/mo gets you there on time ($300.00/mo more)');
    expect(s).toContain('counting the $600.00 you\'ve marked saved');
  });
});
