/**
 * THE answer, above the fold: how much must be in checking, and by when,
 * to pay every card in full this cycle. Server component — all math comes
 * from the cash-needed engine; nothing is recomputed here.
 */
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import { formatISODate, isoDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';

export function CashNeededCard({
  result,
  paymentAccountName,
}: {
  result: CashNeededResult;
  paymentAccountName: string;
}) {
  const { headline } = result;

  if (headline.byDate === null) {
    return (
      <Card data-testid="cash-needed-card">
        <CardHeader>
          <CardTitle>Cards: nothing due</CardTitle>
          <CardDescription>No card payments are due this cycle.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const covered = headline.shortfallCents === 0;

  return (
    <Card data-testid="cash-needed-card" className="border-emerald-900/40">
      <CardHeader className="pb-2">
        <CardDescription>Cash needed for cards this cycle</CardDescription>
        <CardTitle className="text-3xl tabular-nums sm:text-4xl" data-testid="cash-needed-amount">
          {formatCents(headline.requiredCents)}
        </CardTitle>
        <p className="text-sm text-muted-foreground" data-testid="cash-needed-headline">
          needed in {paymentAccountName} by{' '}
          <span className="font-medium text-foreground">
            {formatISODate(isoDate(headline.byDate))}
          </span>{' '}
          to pay all {headline.cardsDueCount} cards in full this cycle.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {covered ? (
          <Alert data-testid="covered-alert">
            <AlertTitle>You&apos;re covered</AlertTitle>
            <AlertDescription>
              Projected low point is{' '}
              {result.intraPeriodMinimum
                ? `${formatCents(result.intraPeriodMinimum.balanceCents)} on ${formatISODate(isoDate(result.intraPeriodMinimum.date))}`
                : 'above zero'}{' '}
              — every due date clears without a transfer.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive" data-testid="shortfall-alert">
            <AlertTitle>
              Shortfall of {formatCents(headline.shortfallCents)}
              {headline.shortfallDate
                ? ` on ${formatISODate(isoDate(headline.shortfallDate))}`
                : ''}
            </AlertTitle>
            <AlertDescription>
              {result.intraPeriodMinimum && (
                <span>
                  Projected balance dips to{' '}
                  {formatCents(result.intraPeriodMinimum.balanceCents)} on{' '}
                  {formatISODate(isoDate(result.intraPeriodMinimum.date))}.{' '}
                </span>
              )}
              {headline.recommendation && (
                <span className="font-medium" data-testid="transfer-recommendation">
                  Transfer {formatCents(headline.recommendation.amountCents)} (e.g. from
                  savings) by {formatISODate(isoDate(headline.recommendation.byDate))}.
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        <ul className="space-y-1.5" data-testid="due-date-list">
          {result.perDueDate.map((point) => (
            <li key={point.date} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {formatISODate(isoDate(point.date))}
              </span>
              <span className="truncate">
                {point.cards
                  .map(
                    (c) =>
                      `${c.cardName} ${formatCents(c.amountCents)}${c.autopayCents > 0 ? ' (autopay)' : ''}`,
                  )
                  .join(' + ')}
              </span>
              <span className="font-medium tabular-nums">{formatCents(point.dayTotalCents)}</span>
            </li>
          ))}
          {result.upcoming.map((u) => (
            <li
              key={u.cardId}
              className="flex items-baseline justify-between gap-2 text-sm text-muted-foreground"
            >
              <span>{formatISODate(isoDate(u.effectiveDueDate))}</span>
              <span className="truncate">
                {u.cardName} {formatCents(u.cashRequiredCents)}{' '}
                <Badge variant="outline" className="ml-1 align-middle">
                  est.
                </Badge>
              </span>
              <span className="tabular-nums">next cycle</span>
            </li>
          ))}
        </ul>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">
            Assumptions ({result.assumptions.length})
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4" data-testid="assumptions-list">
            {result.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
