/**
 * P1.5 — investing order of operations + fee-drag on /coach.
 * Generic ladder (match % uncollected). Fee-drag is one-authored
 * through COACH_COPY. Collapsible ladder; the money sentence is the hook.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { FeeDrag } from '@/lib/engine/fi/fee-drag';
import type { DialOwnership } from '@/lib/engine/settings/dials';

export function InvestingLadderCard({
  drag,
  dialOwnership,
  frozenPortfolioNote,
}: {
  drag: FeeDrag | null;
  dialOwnership: DialOwnership;
  /** Same frozen-investment disclosure the FI card already carries. */
  frozenPortfolioNote?: string | null;
}) {
  const sentence = drag ? COACH_COPY.feeDrag(drag, dialOwnership) : null;

  return (
    <Card data-testid="investing-ladder-card">
      <CardHeader className="pb-2">
        <CardDescription>{COACH_COPY.investingLadderTitle()}</CardDescription>
        <CardTitle className="text-base">{COACH_COPY.investingLadderSubtitle()}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {sentence ? (
          <p data-testid="fee-drag-sentence">{sentence}</p>
        ) : drag == null ? (
          <p className="text-muted-foreground" data-testid="fee-drag-empty">
            {COACH_COPY.feeDragEmpty()}
          </p>
        ) : null}
        {frozenPortfolioNote ? (
          <p className="text-xs text-warning-500" data-testid="fee-drag-frozen">
            {frozenPortfolioNote}
          </p>
        ) : null}
        <details className="text-sm text-muted-foreground" data-testid="investing-ladder">
          <summary className="cursor-pointer text-foreground">
            {COACH_COPY.investingLadderSummary()}
          </summary>
          <p className="mt-1" data-testid="investing-ladder-steps">
            {COACH_COPY.investingLadder()}
          </p>
        </details>
        <p className="text-xs text-muted-foreground" data-testid="dont-time-it">
          {COACH_COPY.dontTimeIt()}
        </p>
      </CardContent>
    </Card>
  );
}
