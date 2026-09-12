/**
 * TASKS GL.3 — the goal_behind_pace nudge kind. The Today feed learns about slipping
 * savings goals from `goalProgress` rows (the SAME verdict the cards render). Pins:
 *   1. only behind / date-passed paces produce rows (the feed never re-derives pace),
 *   2. centsAtStake is gapMonthlyCents verbatim — the EXTRA monthly, not the pledge —
 *      and 0 for a passed date,
 *   3. the dismissal fact is goal id + target month (a changed fact returns),
 *   4. ACTION tier, dismissable, never pushed,
 *   5. the detail line is the goal card's own goalPaceSentence, byte-identical.
 * Hand math (vitest clock DEMO_TODAY=2026-06-10; see seed-goals.test.ts):
 *   behind goal  $6,000 · $600 saved · $150/mo · Jun 2027 → gap $300/mo.
 *   passed goal  $1,000 · $0 saved · $200/mo · May 2026   → gap 0, pace date-passed.
 */
import { describe, expect, it } from 'vitest';
import { cents, ZERO, type Cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import { goalProgress, isGoalPaceNudgeWorthy, type GoalPaceNudgeRow } from '@/lib/engine/goals/progress';
import { goalPaceSentence } from '@/lib/engine/goals/progress-copy';
import { buildNudgeFeed } from '@/lib/engine/nudge/select';
import type { NudgeInput } from '@/lib/engine/nudge/types';
import { proposalCopy, whyInputs } from '@/components/dashboard/today-feed-copy';

const TODAY = isoDate('2026-06-10');

function input(o: Partial<NudgeInput>): NudgeInput {
  return {
    today: TODAY,
    reminders: [],
    radar: null,
    cashNeeded: null,
    opportunities: [],
    paymentAccountName: 'Everyday Checking',
    frozenDues: [],
    runwayWindowMonths: 6,
    ...o,
  };
}

function row(o: {
  id: string;
  name: string;
  targetCents: number;
  savedCents: number;
  monthlyCents: number | null;
  targetDate: string | null;
}): GoalPaceNudgeRow {
  const progress = goalProgress({
    targetCents: o.targetCents,
    savedCents: o.savedCents,
    monthlyContributionCents: o.monthlyCents,
    targetDate: o.targetDate === null ? null : isoDate(o.targetDate),
    today: TODAY,
  });
  return {
    id: o.id,
    name: o.name,
    progress,
    sentence: {
      targetCents: o.targetCents,
      savedCents: o.savedCents,
      monthlyContributionCents: o.monthlyCents,
      targetDate: o.targetDate === null ? null : isoDate(o.targetDate),
      today: TODAY,
    },
  };
}

const BEHIND = () =>
  row({ id: 'goal-1', name: 'New Car Fund', targetCents: 600000, savedCents: 60000, monthlyCents: 15000, targetDate: '2027-06-01' });
const PASSED = () =>
  row({ id: 'goal-2', name: 'Old Pledge', targetCents: 100000, savedCents: 0, monthlyCents: 20000, targetDate: '2026-05-01' });

describe('goal_behind_pace — engine (GL.3)', () => {
  it('emits one ACTION row for a behind goal, gap monthly verbatim, never critical', () => {
    const feed = buildNudgeFeed(input({ goalPaceRows: [BEHIND()] }));
    expect(feed.ordered).toHaveLength(1);
    const p = feed.ordered[0];
    expect(p.kind).toBe('goal_behind_pace');
    expect(p.tier).toBe('action');
    expect(p.subjectKey).toBe('nudge:goal_behind_pace');
    expect(p.centsAtStake).toBe(cents(30000)); // ceil(5400/12) − 150 = 300.00
    expect(p.goalNudge?.name).toBe('New Car Fund');
    expect(p.daysUntil).toBeNull();
    expect(p.fundingFrozen).toBeNull();
  });

  it('emits a row for a date-passed goal with centsAtStake 0 (no monthly closes a gone date)', () => {
    const feed = buildNudgeFeed(input({ goalPaceRows: [PASSED()] }));
    const p = feed.ordered.find((x) => x.kind === 'goal_behind_pace');
    expect(p).toBeDefined();
    expect(p!.tier).toBe('action');
    expect(p!.centsAtStake).toBe(ZERO);
  });

  it('does not re-derive pace: only behind / date-passed rows are passed in at all', () => {
    // The predicate lives with the pace enum; on-track/no-date rows never reach the feed.
    expect(isGoalPaceNudgeWorthy('behind')).toBe(true);
    expect(isGoalPaceNudgeWorthy('date-passed')).toBe(true);
    expect(isGoalPaceNudgeWorthy('on-track')).toBe(false);
    expect(isGoalPaceNudgeWorthy('no-date')).toBe(false);
    expect(isGoalPaceNudgeWorthy('no-pledge')).toBe(false);
    expect(isGoalPaceNudgeWorthy('funded')).toBe(false);
  });

  it('dismissal keys to the goal AND its target month — a moved date returns, an unchanged one stays gone', () => {
    const feed = buildNudgeFeed(input({ goalPaceRows: [BEHIND()] }));
    const p = feed.ordered[0];
    expect(p.key).toBe('goal_behind_pace:goal-1:2027-06');
    expect(p.dismissKey).toBe(p.key);

    const dismissed = buildNudgeFeed(
      input({ goalPaceRows: [BEHIND()], dismissedKeys: new Set([p.dismissKey]) }),
    );
    expect(dismissed.ordered).toHaveLength(0); // same fact → stays dismissed

    // The date moves to Jul 2027 → a NEW fact → the row returns.
    const moved = row({ id: 'goal-1', name: 'New Car Fund', targetCents: 600000, savedCents: 60000, monthlyCents: 15000, targetDate: '2027-07-01' });
    const returned = buildNudgeFeed(
      input({ goalPaceRows: [moved], dismissedKeys: new Set([p.dismissKey]) }),
    );
    expect(returned.ordered).toHaveLength(1);
    expect(returned.ordered[0].key).toBe('goal_behind_pace:goal-1:2027-07');
  });

  it('sortDate is the target month END (GP-L) — the same deadline the verdict was judged on', () => {
    const feed = buildNudgeFeed(input({ goalPaceRows: [BEHIND()] }));
    expect(feed.ordered[0].sortDate).toBe('2027-06-30');
  });

  it('orders with the feed: dated ACTION rows interleave on date, not kind', () => {
    const feed = buildNudgeFeed(
      input({
        goalPaceRows: [BEHIND()],
        incomePauses: [
          {
            merchantCanonical: 'Stripe Payout',
            accountId: 'acct-savings',
            typicalAmountCents: cents(38000) as Cents,
            cadence: 'MONTHLY',
            lastSeenAt: isoDate('2026-04-10'),
            missedSince: isoDate('2026-05-10'),
            daysLate: 31,
            occurrences: 4,
            confirmed: false,
          },
        ],
      }),
    );
    // Both ACTION: income_pause dated 2026-05-10 sorts before the goal's 2027-06-30.
    expect(feed.ordered.map((p) => p.kind)).toEqual(['income_pause', 'goal_behind_pace']);
  });
});

describe('goal_behind_pace — copy (GL.3)', () => {
  it('the detail line is the goal card\'s own pace sentence, byte-identical', () => {
    const feed = buildNudgeFeed(input({ goalPaceRows: [BEHIND()] }));
    const p = feed.ordered[0];
    const c = proposalCopy(p);
    expect(c.title).toBe('New Car Fund is behind pace');
    const cardSentence = goalPaceSentence(p.goalNudge!.progress, p.goalNudge!.sentence);
    expect(c.detail).toBe(cardSentence);
    // And that sentence is the full coaching line with both inputs named (GP-M).
    expect(c.detail).toContain('counting the $600.00 you\'ve marked saved');
    expect(c.detail).toContain('$450.00/mo gets you there on time ($300.00/mo more)');
  });

  it('the why-inputs line labels gapMonthlyCents as extra-needed, never "at stake"', () => {
    const feed = buildNudgeFeed(input({ goalPaceRows: [BEHIND(), PASSED()] }));
    const behind = feed.ordered.find((x) => x.centsAtStake > 0)!;
    const passed = feed.ordered.find((x) => x.centsAtStake === 0)!;
    expect(whyInputs(behind)).toContain('$300.00/mo more needed');
    expect(whyInputs(behind)).not.toContain('at stake');
    // A passed date gets the FACT, not a $0 remedy (critic P1-2): no monthly closes
    // a gone date, so "$0.00/mo more needed" would offer a fix that cannot work.
    expect(whyInputs(passed)).toContain('the target month has passed');
    expect(whyInputs(passed)).not.toContain('more needed');
  });

  it('the title names the pace like the card badge does (critic P1-2)', () => {
    const feed = buildNudgeFeed(input({ goalPaceRows: [BEHIND(), PASSED()] }));
    const behind = feed.ordered.find((x) => x.centsAtStake > 0)!;
    const passed = feed.ordered.find((x) => x.centsAtStake === 0)!;
    // 'behind' → "is behind pace" (the card badge's 'Behind pace'); 'date-passed'
    // → "date has passed" (the badge's 'Date passed') — one verdict, one wording.
    expect(proposalCopy(behind).title).toBe('New Car Fund is behind pace');
    expect(proposalCopy(passed).title).toBe('Old Pledge’s date has passed');
    expect(proposalCopy(passed).detail).toContain('has passed with $1,000.00 still to go');
  });
});
