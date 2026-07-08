/**
 * Categorization accuracy + calibration card (DECISIONS #37). Presentational —
 * the numbers come from the pure scoring engine via getCategorizationAccuracy.
 * Makes "the AI improves over time" measurable and visible, not asserted.
 */
import { Card, CardContent } from '@/components/ui/card';
import type { AccuracyResult } from '@/lib/engine/accuracy/score';

/**
 * Presentational accuracy + calibration readout (no Card wrapper). Shared by the
 * triage AccuracyCard and the Settings "AI trust" panel so both surfaces show the
 * SAME guardrail-safe copy from one source — the numbers come from the pure scoring
 * engine (getCategorizationAccuracy); this only formats them.
 */
export function AccuracyMetrics({ result }: { result: AccuracyResult }) {
  const pct = (result.accuracyBps / 100).toFixed(1);
  const brier = (result.brierMilli / 1000).toFixed(3);

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">Categorization accuracy</span>
        {result.n > 0 ? (
          <span className="text-2xl font-semibold tabular-nums" data-testid="accuracy-value">
            {pct}%
          </span>
        ) : (
          <span className="text-sm text-muted-foreground" data-testid="accuracy-value">
            No data yet
          </span>
        )}
      </div>
      {result.n > 0 ? (
        <p className="text-xs text-muted-foreground">
          {result.correct} of {result.n} labeled transactions filed correctly · calibration (Brier){' '}
          <span className="tabular-nums">{brier}</span> (lower is better). This updates every time you
          confirm or correct a category.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          As you confirm or correct categories, the AI’s accuracy and calibration will be measured here —
          so you can see whether it’s actually learning.
        </p>
      )}
    </div>
  );
}

/**
 * Categorization accuracy + calibration card (DECISIONS #37). Presentational —
 * the numbers come from the pure scoring engine via getCategorizationAccuracy.
 * Makes "the AI improves over time" measurable and visible, not asserted.
 */
export function AccuracyCard({ result }: { result: AccuracyResult }) {
  return (
    <Card data-testid="accuracy-card">
      <CardContent className="pt-4">
        <AccuracyMetrics result={result} />
      </CardContent>
    </Card>
  );
}
