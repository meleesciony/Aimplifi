/**
 * Progress bar + pace line for a savings goal (DECISIONS #737). Server-safe: reads a
 * `GoalProgress` the page computed and renders it; no state, no writes. Shared by the
 * /goals card and the Home Goals card so the two say the same thing about the same row.
 *
 * The bar is one color in every pace — the verdict is carried by the badge TEXT and the
 * sentence, never by hue alone (same shape-not-color rule as the nav's active indicator).
 */
import { Badge } from '@/components/ui/badge';
import type { GoalProgress } from '@/lib/engine/goals/progress';
import { GOAL_PACE_LABEL, type GoalSentenceContext, goalPaceSentence } from '@/lib/engine/goals/progress-copy';

/** Whole percent for display: floor(bps / 100), so 9999 bps reads 99%, never 100%. */
export function fundedPercent(fundedBps: number): number {
  return Math.floor(fundedBps / 100);
}

export function GoalProgressBar({ name, progress }: { name: string; progress: GoalProgress }) {
  const pct = fundedPercent(progress.fundedBps);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`${name}: ${pct}% funded`}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      data-testid="goal-progress-bar"
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function GoalPaceBadge({ progress }: { progress: GoalProgress }) {
  const variant =
    progress.pace === 'funded' ? 'default' : progress.pace === 'behind' || progress.pace === 'date-passed' ? 'outline' : 'secondary';
  return (
    <Badge variant={variant} data-testid="goal-pace-badge" data-pace={progress.pace}>
      {GOAL_PACE_LABEL[progress.pace]}
    </Badge>
  );
}

export function GoalPaceLine({ progress, goal }: { progress: GoalProgress; goal: GoalSentenceContext }) {
  return (
    <p className="text-sm" data-testid="goal-pace" data-pace={progress.pace}>
      {goalPaceSentence(progress, goal)}
    </p>
  );
}

/** Bar + "N% funded" caption + badge, in one row set. */
export function GoalProgressBlock({ name, progress }: { name: string; progress: GoalProgress }) {
  const pct = fundedPercent(progress.fundedBps);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span data-testid="goal-progress-percent">{pct}% funded</span>
        <GoalPaceBadge progress={progress} />
      </div>
      <GoalProgressBar name={name} progress={progress} />
    </div>
  );
}
