/**
 * Home "Goals" card (DECISIONS #737): the goals that need a look first, each with its bar
 * and its one pace sentence, then a link to the full page. Renders nothing with no savings
 * goals — Home already carries the nav; an empty coaching card here would be noise.
 * Read-only: every writer stays on /goals.
 */
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GoalPaceBadge, GoalProgressBar, fundedPercent } from '@/components/finance/goal-progress';
import { goalPaceSentence, goalsHeadline } from '@/lib/engine/goals/progress-copy';
import { cents, formatCents } from '@/lib/money';
import type { GoalProgressRow } from '@/server/goals';

const SHOWN = 3;

export function GoalsProgressCard({ rows }: { rows: GoalProgressRow[] }) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, SHOWN);
  const more = rows.length - shown.length;
  return (
    <Card data-testid="home-goals-card">
      <CardHeader className="pb-2">
        <CardDescription>Goals</CardDescription>
        <CardTitle className="text-base" data-testid="home-goals-headline">
          {goalsHeadline(rows.map((r) => r.progress.pace))}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-3">
          {shown.map((row) => (
            <li key={row.id} className="space-y-1.5" data-testid={`home-goal-row-${row.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="min-w-0 truncate text-sm font-medium" title={row.name}>
                  {row.name}
                </span>
                <GoalPaceBadge progress={row.progress} />
              </div>
              <GoalProgressBar name={row.name} progress={row.progress} />
              {/* The saved figure is hand-typed (critic P1-1): the percent alone would let
                  "0%" mean "never entered" or "$0" alike, so the basis is printed with it. */}
              <p className="text-xs text-muted-foreground" data-testid="home-goal-basis">
                {formatCents(cents(row.savedCents))} marked saved of {formatCents(cents(row.targetCents))} ·{' '}
                {fundedPercent(row.progress.fundedBps)}% funded
              </p>
              <p className="text-xs text-muted-foreground" data-testid="home-goal-pace" data-pace={row.progress.pace}>
                {goalPaceSentence(row.progress, row)}
              </p>
            </li>
          ))}
        </ul>
        <Link href="/goals" className="text-sm underline underline-offset-4" data-testid="home-goals-link">
          {more > 0 ? `All goals (${more} more)` : 'All goals'}
        </Link>
      </CardContent>
    </Card>
  );
}
