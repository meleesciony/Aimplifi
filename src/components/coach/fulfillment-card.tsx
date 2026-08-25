/**
 * W.6(c) — YMOYL fulfillment curve on /coach.
 * Category × months in hours of working life. A lens, never a grade.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { FulfillmentCurve } from '@/lib/engine/fi/fulfillment';
import { cents } from '@/lib/money';

export function FulfillmentCard({ curve }: { curve: FulfillmentCurve | null }) {
  // Wage unset → engine returns null; hide the card (hours are the whole lens).
  if (curve == null) return null;

  const omitted = COACH_COPY.fulfillmentOmitted(curve);

  return (
    <Card data-testid="fulfillment-card">
      <CardHeader className="pb-2">
        <CardDescription>{COACH_COPY.fulfillmentTitle()}</CardDescription>
        <CardTitle className="text-base" data-testid="fulfillment-subtitle">
          {COACH_COPY.fulfillmentSubtitle(curve)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {curve.categories.length === 0 ? (
          <p className="text-muted-foreground" data-testid="fulfillment-empty">
            {COACH_COPY.fulfillmentEmpty()}
          </p>
        ) : (
          <ul className="space-y-3" data-testid="fulfillment-list">
            {curve.categories.map((cat) => (
              <li key={cat.categoryId} data-testid="fulfillment-row">
                <p>{COACH_COPY.fulfillmentRow(cat, curve.windowMonths)}</p>
                <p
                  className="mt-0.5 text-xs tabular-nums text-muted-foreground"
                  data-testid="fulfillment-spark"
                >
                  {COACH_COPY.fulfillmentSpark(cat)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {omitted && (
          <p className="text-xs text-muted-foreground" data-testid="fulfillment-omitted">
            {omitted}
          </p>
        )}
        <p className="text-xs text-muted-foreground" data-testid="fulfillment-footnote">
          {COACH_COPY.fulfillmentFootnote(cents(curve.hourlyWageCents))}
        </p>
      </CardContent>
    </Card>
  );
}
