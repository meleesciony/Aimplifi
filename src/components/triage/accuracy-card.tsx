/**
 * Categorization accuracy + calibration card (DECISIONS #37). Presentational —
 * the numbers come from the pure scoring engine via getCategorizationAccuracy.
 * Makes "the AI improves over time" measurable and visible, not asserted.
 */
import { Card, CardContent } from '@/components/ui/card';
import type { AccuracyResult } from '@/lib/engine/accuracy/score';
import { formatRateBps, type SelfAuditView } from '@/lib/engine/audit/snapshot';
import { AUTO_FLAGGED_BPS } from '@/lib/engine/categorize/pipeline';
import type { ThresholdTuning } from '@/lib/engine/categorize/tuning';
import { formatISODate, isoDate } from '@/lib/dates';

/**
 * Threshold-tuning disclosure (DECISIONS #190): every runtime adaptation must be
 * user-visible, so when the auto-file bar deviates from the global default — or
 * the regression gate has frozen a deviation — the AI-trust panel says so, in
 * plain, no-shame terms. Silent when tuning is at the default (nothing adapted,
 * nothing to disclose).
 */
function TuningDisclosure({ tuning }: { tuning: ThresholdTuning }) {
  if (tuning.reason === 'tuned') {
    const bar = (tuning.flaggedBps / 100).toFixed(1);
    const std = (AUTO_FLAGGED_BPS / 100).toFixed(1);
    return (
      <p className="text-xs text-muted-foreground" data-testid="tuning-disclosure">
        Based on your filing history, transactions now auto-file at{' '}
        <span className="tabular-nums">{bar}%</span> confidence or higher (standard:{' '}
        <span className="tabular-nums">{std}%</span>). This adjusts automatically as you confirm or
        correct categories — undoing corrections undoes it too.
      </p>
    );
  }
  if (tuning.reason === 'reverted-regression') {
    return (
      <p className="text-xs text-muted-foreground" data-testid="tuning-disclosure">
        Your recent filings look different from your earlier history, so the standard auto-file bar
        (<span className="tabular-nums">{(AUTO_FLAGGED_BPS / 100).toFixed(1)}%</span>) is in effect
        until the picture settles.
      </p>
    );
  }
  return null;
}

/**
 * Presentational accuracy + calibration readout (no Card wrapper). Shared by the
 * triage AccuracyCard and the Settings "AI trust" panel so both surfaces show the
 * SAME guardrail-safe copy from one source — the numbers come from the pure scoring
 * engine (getCategorizationAccuracy); this only formats them. `tuning` (optional)
 * adds the threshold-tuning disclosure where the caller surfaces it (Settings).
 */
export function AccuracyMetrics({ result, tuning }: { result: AccuracyResult; tuning?: ThresholdTuning }) {
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
      {tuning ? <TuningDisclosure tuning={tuning} /> : null}
    </div>
  );
}

/**
 * Weekly self-audit Critic (TASKS 3.2 / #211) — review / unknown / alert-act
 * rates from the latest cron snapshot. Distinct from categorization accuracy.
 */
export function SelfAuditMetrics({ snapshot }: { snapshot: SelfAuditView | null }) {
  if (!snapshot) {
    return (
      <div className="space-y-1 border-t border-border/60 pt-2" data-testid="self-audit-metrics">
        <p className="text-sm font-medium">Weekly self-audit</p>
        <p className="text-xs text-muted-foreground">
          Weekly self-audit starts after your first scheduled Critic run — it tracks how much still
          needs review, how often Ask stays unrecognized, and whether alert surfaces get attention.
        </p>
      </div>
    );
  }

  const { counts } = snapshot;
  return (
    <div className="space-y-1 border-t border-border/60 pt-2" data-testid="self-audit-metrics">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Weekly self-audit</p>
        <span className="text-xs text-muted-foreground tabular-nums">
          week of {formatISODate(isoDate(snapshot.weekStart))}
        </span>
      </div>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        <li data-testid="self-audit-review">
          Review queue:{' '}
          <span className="font-medium text-foreground tabular-nums">
            {formatRateBps(snapshot.reviewRateBps)}
          </span>{' '}
          needed sorting ({counts.reviewNeeding} of {counts.reviewTotal})
        </li>
        <li data-testid="self-audit-unknown">
          Ask:{' '}
          <span className="font-medium text-foreground tabular-nums">
            {formatRateBps(snapshot.unknownRateBps)}
          </span>{' '}
          of unrecognized phrasings stayed unknown ({counts.unknownStayed} of{' '}
          {counts.unknownAttempts})
        </li>
        <li data-testid="self-audit-alerts">
          Alerts:{' '}
          <span className="font-medium text-foreground tabular-nums">
            {formatRateBps(snapshot.alertActRateBps)}
          </span>{' '}
          acted on ({counts.alertsActed} of {counts.alertsSent} sent) — attention proxy until
          per-alert hooks land
        </li>
      </ul>
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
