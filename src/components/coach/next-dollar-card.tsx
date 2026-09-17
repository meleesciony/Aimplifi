/**
 * W.6(b) — extra-dollar ranking. Server component: pure display of
 * `nextDollar` via COACH_COPY. Every string is already scanned.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { NextDollarPlan } from '@/lib/engine/fi/next-dollar';
import { FROZEN_NEXT_DOLLAR_TESTID } from '@/lib/engine/account/feed-dropped-view';

export function NextDollarCard({ plan }: { plan: NextDollarPlan }) {
  // TASKS L.19 residual (5): qualifies the debt the headline names when its bank stopped
  // sharing it. Null when nothing named is frozen, so the card renders as before.
  const frozenNote = COACH_COPY.nextDollarFrozenNote(plan);
  return (
    <Card data-testid="next-dollar-card">
      <CardHeader className="pb-2">
        <CardDescription>{COACH_COPY.nextDollarTitle()}</CardDescription>
        <CardTitle className="text-base" data-testid="next-dollar-headline">
          {COACH_COPY.nextDollarHeadline(plan)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        {/* Directly under the instruction it qualifies, before the reasoning that leans on it. */}
        {frozenNote ? (
          <p className="text-xs" data-testid={FROZEN_NEXT_DOLLAR_TESTID}>
            {frozenNote}
          </p>
        ) : null}
        <p data-testid="next-dollar-why">{COACH_COPY.nextDollarWhy(plan)}</p>
        <p data-testid="next-dollar-skipped">{COACH_COPY.nextDollarSkipped(plan)}</p>
        <p data-testid="next-dollar-cards">{COACH_COPY.nextDollarCardsNote()}</p>
        <p data-testid="next-dollar-assumptions">{COACH_COPY.nextDollarAssumptions(plan)}</p>
      </CardContent>
    </Card>
  );
}
