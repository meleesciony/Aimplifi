/**
 * Savings goals with progress + pace for the Home Goals card (DECISIONS #737).
 * Savings goals only (`kind: null`): debt-free plans have their own solver copy on /goals
 * and reserves are Plan-page sinking funds, not goals. Sorted so what needs a look comes
 * first (GOAL_PACE_ATTENTION_RANK), then by name — the same order the reader would triage in.
 */
import type { ISODate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import {
  GOAL_PACE_ATTENTION_RANK,
  type GoalPaceNudgeRow,
  type GoalProgress,
  goalProgress,
  goalTargetDate,
  isGoalPaceNudgeWorthy,
} from '@/lib/engine/goals/progress';

export interface GoalProgressRow {
  id: string;
  name: string;
  targetCents: number;
  savedCents: number;
  monthlyContributionCents: number | null;
  targetDate: ISODate | null;
  /** The business "today" the progress was computed on — the copy names is-here vs has-passed from it. */
  today: ISODate;
  progress: GoalProgress;
}

export async function listSavingsGoalNames(userId: string): Promise<string[]> {
  const rows = await prisma.goal.findMany({
    where: { userId, kind: null },
    select: { name: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((r) => r.name);
}

export async function getGoalProgressRows(userId: string, today: ISODate): Promise<GoalProgressRow[]> {
  const goals = await prisma.goal.findMany({
    where: { userId, kind: null },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      targetCents: true,
      savedCents: true,
      monthlyContributionCents: true,
      targetDate: true,
    },
  });
  const rows = goals.map((g) => {
    const targetDate = goalTargetDate(g.targetDate);
    return {
      id: g.id,
      name: g.name,
      targetCents: g.targetCents,
      savedCents: g.savedCents,
      monthlyContributionCents: g.monthlyContributionCents,
      targetDate,
      today,
      progress: goalProgress({
        targetCents: g.targetCents,
        savedCents: g.savedCents,
        monthlyContributionCents: g.monthlyContributionCents,
        targetDate,
        today,
      }),
    };
  });
  return rows.sort(
    (a, b) =>
      GOAL_PACE_ATTENTION_RANK[a.progress.pace] - GOAL_PACE_ATTENTION_RANK[b.progress.pace] ||
      a.name.localeCompare(b.name),
  );
}

/**
 * The rows the Today feed should warn about (TASKS GL.3), reshaped from rows the caller
 * already fetched — no second read. `goalProgress` rows with pace 'behind' or
 * 'date-passed' (isGoalPaceNudgeWorthy), carrying the SAME verdict and sentence context
 * the cards render, so the feed re-derives nothing about pace.
 */
export function goalPaceNudgeRowsFrom(rows: readonly GoalProgressRow[]): GoalPaceNudgeRow[] {
  return rows
    .filter((r) => isGoalPaceNudgeWorthy(r.progress.pace))
    .map((r) => ({
      id: r.id,
      name: r.name,
      progress: r.progress,
      sentence: {
        targetCents: r.targetCents,
        savedCents: r.savedCents,
        monthlyContributionCents: r.monthlyContributionCents,
        targetDate: r.targetDate,
        today: r.today,
      },
    }));
}
