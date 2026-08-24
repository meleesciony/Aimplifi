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

export function NextDollarCard({ plan }: { plan: NextDollarPlan }) {
  return (
    <Card data-testid="next-dollar-card">
      <CardHeader className="pb-2">
        <CardDescription>{COACH_COPY.nextDollarTitle()}</CardDescription>
        <CardTitle className="text-base" data-testid="next-dollar-headline">
          {COACH_COPY.nextDollarHeadline(plan)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p data-testid="next-dollar-why">{COACH_COPY.nextDollarWhy(plan)}</p>
        <p data-testid="next-dollar-skipped">{COACH_COPY.nextDollarSkipped(plan)}</p>
        <p data-testid="next-dollar-cards">{COACH_COPY.nextDollarCardsNote()}</p>
        <p data-testid="next-dollar-assumptions">{COACH_COPY.nextDollarAssumptions(plan)}</p>
      </CardContent>
    </Card>
  );
}
