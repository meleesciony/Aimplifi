/**
 * THE answer, above the fold: how much must be in checking, and by when,
 * to pay every card in full this cycle. Server component — all math comes
 * from the cash-needed engine; nothing is recomputed here. The headline is
 * a Glass-Box number (DECISIONS #178): tap it to see the rows it's made of,
 * reconciled to the penny.
 */
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { GlassBoxNumber } from '@/components/finance/glass-box';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import { traceCashNeeded } from '@/lib/engine/glass-box/trace';
import { formatISODate, formatRelativeDays, isoDate, type ISODate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';

export function CashNeededCard({
  result,
  paymentAccountName,
  today,
  transferSource,
}: {
  result: CashNeededResult;
  paymentAccountName: string;
  today: string;
  /** The real account the transfer can come from (name + live balance). */
  transferSource?: { name: string; balanceCents: number } | null;
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
        <GlassBoxNumber
          trace={traceCashNeeded(result)}
          amountTestId="cash-needed-amount"
          amountClassName="text-3xl tabular-nums sm:text-4xl"
        >
          <p className="text-sm text-muted-foreground" data-testid="cash-needed-headline">
            needed in {paymentAccountName} by{' '}
            <span className="font-medium text-foreground">
              {formatISODate(isoDate(headline.byDate))}
            </span>{' '}
            to pay all {headline.cardsDueCount} cards in full this cycle.
          </p>
        </GlassBoxNumber>
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
                <span className="font-medium text-foreground" data-testid="transfer-recommendation">
                  Transfer {formatCents(headline.recommendation.amountCents)}
                  {transferSource
                    ? ` from ${transferSource.name} (${formatCents(cents(transferSource.balanceCents))} available)`
                    : ' (e.g. from savings)'}{' '}
                  by {formatISODate(isoDate(headline.recommendation.byDate))} —{' '}
                  {formatRelativeDays(today as ISODate, headline.recommendation.byDate)}.
                  {transferSource &&
                    transferSource.balanceCents < headline.recommendation.amountCents && (
                      <span className="font-normal">
                        {' '}
                        That account alone doesn&apos;t cover it — combine sources or move what you can.
                      </span>
                    )}
                </span>
              )}
              {headline.recommendation && (
                <span className="mt-1.5 block">
                  <Link
                    href={`/calendar?month=${headline.recommendation.byDate.slice(0, 7)}`}
                    className="underline underline-offset-2 hover:no-underline"
                    data-testid="shortfall-calendar-link"
                  >
                    See it on the calendar →
                  </Link>
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        <ul className="space-y-1.5" data-testid="due-date-list">
          {result.perDueDate.map((point) => (
            <li
              key={point.date}
              className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 text-sm"
            >
              <span className="whitespace-nowrap text-muted-foreground">
                {formatISODate(isoDate(point.date))}
                <span className="ml-1 text-xs">({formatRelativeDays(today as ISODate, point.date)})</span>
              </span>
              <span>
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
              className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 text-sm text-muted-foreground"
            >
              <span className="whitespace-nowrap">{formatISODate(isoDate(u.effectiveDueDate))}</span>
              <span>
                {u.cardName} {formatCents(u.cashRequiredCents)}{' '}
                <Badge variant="outline" className="ml-1 align-middle">
                  est.
                </Badge>
              </span>
              <span className="tabular-nums">next cycle</span>
            </li>
          ))}
        </ul>

        <div className="flex justify-between pt-1">
          <Link
            href="/forecast"
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            data-testid="see-forecast"
          >
            90-day forecast →
          </Link>
          <Link
            href="/cards"
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            data-testid="see-card-breakdown"
          >
            Per-card breakdown →
          </Link>
        </div>

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
