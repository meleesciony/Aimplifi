/**
 * Known-answer + property tests for goal progress & pace
 * (src/lib/engine/goals/progress.ts, DECISIONS #737).
 *
 * Every figure is hand-derived and pinned in docs/EDGE_CASES.md §Goal-progress-and-pace
 * (tests/edge-cases/goal-progress-and-pace-decisions-737.md). Load-bearing locks:
 *   - SOLVER CONSISTENCY: a dated goal's requiredMonthly IS solveSavingsGoalByDate's figure,
 *     and pledging exactly it is on-track while one cent less is behind (minimality).
 *   - FLOORED PERCENT: 299,999 of 300,000 is 9999 bps, never 10000.
 *   - CALENDAR MONTHS: funded-by uses addMonthsClamped (Jan 31 + 1 → Feb 28).
 */
import { describe, expect, it } from 'vitest';

import { isoDate, monthKey, monthWindow } from '@/lib/dates';
import { goalFundingMonths } from '@/lib/engine/goals';
import {
  GOAL_PACE_ATTENTION_RANK,
  goalProgress,
  type GoalPace,
  type GoalProgressInput,
} from '@/lib/engine/goals/progress';
import { GOAL_PACE_LABEL, goalPaceSentence, goalsHeadline } from '@/lib/engine/goals/progress-copy';
import { solveSavingsGoalByDate } from '@/lib/engine/solve/savings-goal-by-date';

const d = isoDate;
const TODAY = d('2026-06-10');

function progress(over: Partial<GoalProgressInput>) {
  const input: GoalProgressInput = {
    targetCents: over.targetCents ?? 600_000,
    savedCents: over.savedCents ?? 0,
    monthlyContributionCents: over.monthlyContributionCents === undefined ? 50_000 : over.monthlyContributionCents,
    targetDate: over.targetDate === undefined ? d('2027-06-10') : over.targetDate,
    today: over.today ?? TODAY,
  };
  return { input, p: goalProgress(input) };
}

describe('goalProgress — hand-verified anchors (EDGE_CASES §Goal-progress-and-pace)', () => {
  it('GP-A: $6,000, nothing saved, $500/mo, 12 months out → on-track, right on the date', () => {
    const { p } = progress({});
    expect(p.pace).toBe('on-track');
    expect(p.remainingCents).toBe(600_000);
    expect(p.fundedBps).toBe(0);
    expect(p.monthsToFunded).toBe(12);
    expect(p.fundedByDate).toBe('2027-06-10');
    expect(p.targetMonths).toBe(12);
    expect(p.requiredMonthlyCents).toBe(50_000);
    expect(p.monthsDelta).toBe(0);
    expect(p.gapMonthlyCents).toBeNull();
  });

  it('GP-B: $1,500 already saved (25%) at $500/mo → on-track, 3 months ahead; required drops to $375', () => {
    const { p } = progress({ savedCents: 150_000 });
    expect(p.pace).toBe('on-track');
    expect(p.remainingCents).toBe(450_000);
    expect(p.fundedBps).toBe(2500);
    expect(p.monthsToFunded).toBe(9);
    expect(p.fundedByDate).toBe('2027-03-10');
    expect(p.requiredMonthlyCents).toBe(37_500);
    expect(p.monthsDelta).toBe(3);
  });

  it('GP-C: $300/mo toward $6,000 in 12 months → behind by 8 months; $500/mo closes it, $200/mo more', () => {
    const { p } = progress({ monthlyContributionCents: 30_000 });
    expect(p.pace).toBe('behind');
    expect(p.monthsToFunded).toBe(20);
    expect(p.fundedByDate).toBe('2028-02-10');
    expect(p.targetMonths).toBe(12);
    expect(p.requiredMonthlyCents).toBe(50_000);
    expect(p.monthsDelta).toBe(8);
    expect(p.gapMonthlyCents).toBe(20_000);
  });

  it('GP-D: saved ≥ target → funded, 10000 bps, 0 months, funded-by today, required $0 (dated) / null (undated)', () => {
    const dated = progress({ targetCents: 100_000, savedCents: 100_000 }).p;
    expect(dated.pace).toBe('funded');
    expect(dated.remainingCents).toBe(0);
    expect(dated.fundedBps).toBe(10_000);
    expect(dated.monthsToFunded).toBe(0);
    expect(dated.fundedByDate).toBe(TODAY);
    expect(dated.requiredMonthlyCents).toBe(0);
    expect(dated.monthsDelta).toBeNull();

    const over = progress({ targetCents: 100_000, savedCents: 250_000, targetDate: null }).p;
    expect(over.pace).toBe('funded');
    expect(over.fundedBps).toBe(10_000);
    expect(over.requiredMonthlyCents).toBeNull();
  });

  it('GP-E: a date this month (under one whole month away) with money to go → date-passed, no required figure invented', () => {
    const { p } = progress({ targetCents: 100_000, monthlyContributionCents: 10_000, targetDate: d('2026-06-30') });
    expect(p.pace).toBe('date-passed');
    expect(p.targetMonths).toBe(0);
    expect(p.requiredMonthlyCents).toBeNull();
    // The timeline at the pledge is still a fact and still reported.
    expect(p.monthsToFunded).toBe(10);
    expect(p.fundedByDate).toBe('2027-04-10');
    expect(p.monthsDelta).toBeNull();
    expect(p.gapMonthlyCents).toBeNull();

    const past = progress({ targetCents: 100_000, monthlyContributionCents: 10_000, targetDate: d('2025-12-01') }).p;
    expect(past.pace).toBe('date-passed');
  });

  it('GP-F: no pledge but a date → no-pledge, and the required monthly is the solver’s $714.29 (SG-C)', () => {
    const { p } = progress({ targetCents: 500_000, monthlyContributionCents: null, targetDate: d('2027-01-10') });
    expect(p.pace).toBe('no-pledge');
    expect(p.targetMonths).toBe(7);
    expect(p.requiredMonthlyCents).toBe(71_429);
    expect(p.monthsToFunded).toBeNull();
    expect(p.fundedByDate).toBeNull();
  });

  it('GP-G: a zero pledge is no pledge; with no date nothing about a timeline is stated', () => {
    const { p } = progress({ monthlyContributionCents: 0, targetDate: null });
    expect(p.pace).toBe('no-pledge');
    expect(p.monthsToFunded).toBeNull();
    expect(p.targetMonths).toBeNull();
    expect(p.requiredMonthlyCents).toBeNull();
  });

  it('GP-H: a pledge and no date → no-date with a funded-by month', () => {
    const { p } = progress({ targetDate: null });
    expect(p.pace).toBe('no-date');
    expect(p.monthsToFunded).toBe(12);
    expect(p.fundedByDate).toBe('2027-06-10');
    expect(p.requiredMonthlyCents).toBeNull();
  });

  it('GP-I: percent is FLOORED — $2,999.99 of $3,000 is 9999 bps, never 100%', () => {
    const { p } = progress({ targetCents: 300_000, savedCents: 299_999 });
    expect(p.fundedBps).toBe(9999);
    expect(p.pace).not.toBe('funded');
    expect(p.remainingCents).toBe(1);
  });

  it('GP-J: funded-by is a calendar month — Jan 31 + 1 month lands Feb 28', () => {
    const { p } = progress({
      today: d('2026-01-31'),
      targetCents: 10_000,
      monthlyContributionCents: 10_000,
      targetDate: null,
    });
    expect(p.monthsToFunded).toBe(1);
    expect(p.fundedByDate).toBe('2026-02-28');
  });

  it('GP-L: the date is MONTH-granular — the form’s 1st-of-month, Ask’s month-end and any mid-month day judge alike', () => {
    // updateGoalTargetDate stores a month pick as YYYY-MM-01; Ask's parseTargetDate resolves
    // "by June 2027" to 2027-06-30; both render "by Jun 2027". $500/mo toward $6,000 funds in
    // 12 months = 2027-06-10, which is INSIDE June — on pace, not "1 month behind" the 1st.
    const first = progress({ targetDate: d('2027-06-01') }).p;
    const mid = progress({ targetDate: d('2027-06-10') }).p;
    const end = progress({ targetDate: d('2027-06-30') }).p;
    for (const p of [first, mid, end]) {
      expect(p.pace).toBe('on-track');
      expect(p.targetMonths).toBe(12);
      expect(p.requiredMonthlyCents).toBe(50_000);
      expect(p.monthsDelta).toBe(0);
    }
    // And "by Jul 2026" (next month, stored as the 1st) still buys one contribution cycle.
    const nextMonth = progress({ targetCents: 50_000, targetDate: d('2026-07-01') }).p;
    expect(nextMonth.pace).toBe('on-track');
    expect(nextMonth.targetMonths).toBe(1);
    // While "by Jun 2026" (this month) is already here.
    expect(progress({ targetCents: 50_000, targetDate: d('2026-06-01') }).p.pace).toBe('date-passed');
  });

  it('GP-K: a non-positive target has nothing to fund → 10000 bps and funded; negative saved reads as 0', () => {
    expect(progress({ targetCents: 0, savedCents: 0 }).p.fundedBps).toBe(10_000);
    expect(progress({ targetCents: 0, savedCents: 0 }).p.pace).toBe('funded');
    const neg = progress({ savedCents: -500 }).p;
    expect(neg.fundedBps).toBe(0);
    expect(neg.remainingCents).toBe(600_500);
  });
});

describe('goalProgress — solver consistency (the card and Ask are one figure)', () => {
  const grid: Array<{ target: number; saved: number; date: string }> = [
    { target: 600_000, saved: 0, date: '2027-06-10' },
    { target: 500_000, saved: 0, date: '2027-01-10' },
    { target: 1_234_567, saved: 89_012, date: '2029-03-01' },
    { target: 45_000, saved: 1, date: '2026-08-15' },
    { target: 9_999_999, saved: 123_456, date: '2031-12-31' },
  ];

  it.each(grid)('requiredMonthly equals solveSavingsGoalByDate at the end of the target month for %o', ({ target, saved, date }) => {
    const { p } = progress({ targetCents: target, savedCents: saved, monthlyContributionCents: null, targetDate: d(date) });
    const solved = solveSavingsGoalByDate({
      goalAmountCents: target,
      currentSavingsCents: saved,
      // The deadline Ask itself resolves "by <Month YYYY>" to (parseTargetDate → month end).
      targetDate: monthWindow(monthKey(date)).to,
      today: TODAY,
      safeToSpendCents: 999_999_999,
    });
    expect(p.requiredMonthlyCents).toBe(solved.requiredMonthlyCents);
    expect(p.targetMonths).toBe(solved.targetMonths);
  });

  it.each(grid)('pledging exactly requiredMonthly is on-track; one cent less is behind (minimality) for %o', ({ target, saved, date }) => {
    const required = progress({ targetCents: target, savedCents: saved, monthlyContributionCents: null, targetDate: d(date) }).p
      .requiredMonthlyCents as number;
    expect(required).toBeGreaterThan(0);

    const exact = progress({ targetCents: target, savedCents: saved, monthlyContributionCents: required, targetDate: d(date) }).p;
    expect(exact.pace).toBe('on-track');
    // Independent oracle: the card's own timeline helper agrees the pledge lands by the month count.
    expect(goalFundingMonths(target - saved, required)).toBeLessThanOrEqual(exact.targetMonths as number);

    const short = progress({ targetCents: target, savedCents: saved, monthlyContributionCents: required - 1, targetDate: d(date) }).p;
    expect(short.pace).toBe('behind');
    expect(short.gapMonthlyCents).toBe(1);
    expect(short.monthsDelta).toBeGreaterThanOrEqual(1);
  });

  it('on-track means the funded-by date is inside or before the target month; behind means after it', () => {
    const on = progress({}).p;
    expect(on.fundedByDate! <= '2027-06-30').toBe(true);
    const behind = progress({ monthlyContributionCents: 30_000 }).p;
    expect(behind.fundedByDate! > '2027-06-30').toBe(true);
  });
});

describe('goalPaceSentence — one insight sentence per pace, no shame, assumptions named', () => {
  const goal = (over: Partial<GoalProgressInput>) => {
    const { input, p } = progress(over);
    return goalPaceSentence(p, {
      targetCents: input.targetCents,
      savedCents: input.savedCents,
      monthlyContributionCents: input.monthlyContributionCents,
      targetDate: input.targetDate,
      today: input.today,
    });
  };

  it('GP-A on the date', () => {
    expect(goal({})).toBe(
      "On pace: counting the $0.00 you've marked saved, $500.00/mo has this funded by Jun 2027 — right on your date.",
    );
  });
  it('GP-B ahead', () => {
    expect(goal({ savedCents: 150_000 })).toBe(
      "On pace: counting the $1,500.00 you've marked saved, $500.00/mo has this funded by Mar 2027, 3 months ahead of your Jun 2027 date.",
    );
  });
  it('GP-C behind names the basis, the funded-by month, the lag, the required monthly, the gap — and the update', () => {
    expect(goal({ monthlyContributionCents: 30_000 })).toBe(
      "Behind pace: counting the $0.00 you've marked saved, $300.00/mo has this funded by Feb 2028, 8 months after your Jun 2027 date. $500.00/mo gets you there on time ($200.00/mo more). If you've set more aside, update what you've saved and this recalculates.",
    );
  });
  it('GP-D funded', () => {
    expect(goal({ targetCents: 100_000, savedCents: 100_000 })).toBe(
      'Fully funded — the whole $1,000.00 is set aside. Nice work.',
    );
  });
  it('GP-E date passed offers a new date, invents no figure; "is here" only while the month is current', () => {
    const s = goal({ targetCents: 100_000, monthlyContributionCents: 10_000, targetDate: d('2026-06-30') });
    expect(s).toBe('Your Jun 2026 date is here with $1,000.00 still to go. Pick a new date to get a fresh monthly figure.');
    expect(s).not.toMatch(/\/mo/);
    // Critic P2-1: an older month "has passed" — it is not "here".
    expect(goal({ targetCents: 100_000, monthlyContributionCents: 10_000, targetDate: d('2025-12-01') })).toBe(
      'Your Dec 2025 date has passed with $1,000.00 still to go. Pick a new date to get a fresh monthly figure.',
    );
  });
  it('GP-F no pledge with a date states the solver’s monthly', () => {
    expect(goal({ targetCents: 500_000, monthlyContributionCents: null, targetDate: d('2027-01-10') })).toBe(
      "$5,000.00 to go, counting the $0.00 you've marked saved. Setting aside $714.29/mo funds this by Jan 2027.",
    );
  });
  it('GP-G no pledge, no date', () => {
    expect(goal({ monthlyContributionCents: 0, targetDate: null })).toBe(
      "$6,000.00 to go, counting the $0.00 you've marked saved. Add a monthly amount to see when this lands.",
    );
  });
  it('GP-H no date names the funded-by month and invites a date', () => {
    expect(goal({ targetDate: null })).toBe(
      "$6,000.00 to go, counting the $0.00 you've marked saved. At $500.00/mo this is funded by Jun 2027. Set a date to check your pace.",
    );
  });
  it('singular month', () => {
    // $6,000 saved $5,500 at $500/mo, 2 months out → funded in 1 month, 1 month ahead.
    expect(goal({ savedCents: 550_000, targetDate: d('2026-08-10') })).toContain('1 month ahead');
  });

  it('GP-M (critic P1-1): an Ask-saved goal read one month later, saved never updated, names its basis and the fix', () => {
    // saveSavingsGoal writes savedCents 0 + monthly = the solved $500 for "$6,000 by Jun 2027".
    // One month on, with the reader's July transfer made but never marked, the engine is
    // BEHIND by one month — true of the stored fields, not necessarily of the reader's money.
    const { input, p } = progress({ today: d('2026-07-10'), targetDate: d('2027-06-30') });
    expect(p.pace).toBe('behind');
    expect(p.monthsDelta).toBe(1);
    expect(p.requiredMonthlyCents).toBe(54_546);
    const s = goalPaceSentence(p, { ...input });
    // The sentence may not pretend the $0 is a fact about the reader's money: it names the
    // hand-typed basis and offers the update BEFORE the bigger pledge lands as the verdict.
    expect(s).toContain("counting the $0.00 you've marked saved");
    expect(s).toContain("update what you've saved");
    expect(s).toContain('$545.46/mo gets you there on time ($45.46/mo more)');
  });

  it('every projection names BOTH inputs: the pledge and the marked-saved basis', () => {
    const projecting = [
      goal({}),
      goal({ savedCents: 150_000 }),
      goal({ monthlyContributionCents: 30_000 }),
      goal({ targetDate: null }),
      goal({ targetCents: 500_000, monthlyContributionCents: null, targetDate: d('2027-01-10') }),
    ];
    for (const s of projecting) {
      expect(s).toMatch(/\/mo/);
      expect(s).toContain("you've marked saved");
    }
  });

  it('guardrails: every sentence is second-person or neutral and never shames', () => {
    const shame = /\b(wasted|stop buying|guilty|should have|failed|behind schedule|lazy)\b/i;
    const all: GoalPace[] = ['funded', 'date-passed', 'no-pledge', 'no-date', 'on-track', 'behind'];
    const samples = [
      goal({}),
      goal({ savedCents: 150_000 }),
      goal({ monthlyContributionCents: 30_000 }),
      goal({ targetCents: 100_000, savedCents: 100_000 }),
      goal({ targetCents: 100_000, monthlyContributionCents: 10_000, targetDate: d('2026-06-30') }),
      goal({ targetCents: 500_000, monthlyContributionCents: null, targetDate: d('2027-01-10') }),
      goal({ monthlyContributionCents: 0, targetDate: null }),
      goal({ targetDate: null }),
    ];
    for (const s of samples) expect(s).not.toMatch(shame);
    for (const pace of all) {
      expect(GOAL_PACE_LABEL[pace]).not.toMatch(shame);
      expect(GOAL_PACE_LABEL[pace].length).toBeLessThanOrEqual(24);
    }
  });
});

describe('goalsHeadline — attention first, then unpaced, then fine', () => {
  it('names the count that needs a look before anything else', () => {
    expect(goalsHeadline(['behind', 'on-track', 'funded'])).toBe('1 of 3 goals needs a look');
    expect(goalsHeadline(['date-passed', 'behind', 'no-pledge'])).toBe('2 of 3 goals need a look');
    expect(goalsHeadline(['behind'])).toBe('Your goal needs a look');
  });
  it('then the goals that cannot be paced yet', () => {
    expect(goalsHeadline(['no-pledge', 'on-track'])).toBe('1 of 2 goals needs a monthly amount or a date');
    expect(goalsHeadline(['no-pledge', 'no-date', 'on-track'])).toBe('2 of 3 goals need a monthly amount or a date');
    expect(goalsHeadline(['no-date'])).toBe('Your goal needs a monthly amount or a date');
  });
  it('then all fine', () => {
    expect(goalsHeadline(['on-track', 'funded'])).toBe('All 2 goals on pace');
    expect(goalsHeadline(['funded', 'funded'])).toBe('All 2 goals funded');
    expect(goalsHeadline(['on-track'])).toBe('Your goal is on pace');
    expect(goalsHeadline(['funded'])).toBe('Your goal is funded');
  });
});

describe('GOAL_PACE_ATTENTION_RANK', () => {
  it('slipping goals sort first, done goals last, every pace ranked once', () => {
    const ranked = (Object.keys(GOAL_PACE_ATTENTION_RANK) as GoalPace[]).sort(
      (a, b) => GOAL_PACE_ATTENTION_RANK[a] - GOAL_PACE_ATTENTION_RANK[b],
    );
    expect(ranked).toEqual(['behind', 'date-passed', 'no-pledge', 'no-date', 'on-track', 'funded']);
    expect(new Set(Object.values(GOAL_PACE_ATTENTION_RANK)).size).toBe(6);
  });
});
