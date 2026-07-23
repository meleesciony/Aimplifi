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
import { HOUSEHOLD_COPY } from '@/lib/copy/household-copy';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import { traceCashNeeded } from '@/lib/engine/glass-box/trace';
import { formatISODate, formatRelativeDays, isoDate, type ISODate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';

export function CashNeededCard({
  result,
  paymentAccountName,
  today,
  transferSource,
  householdName = null,
}: {
  result: CashNeededResult;
  paymentAccountName: string;
  today: string;
  /** The real account the transfer can come from (name + live balance). */
  transferSource?: { name: string; balanceCents: number } | null;
  /** Set ONLY at household scope (slice-8 critic F-3): a partner's autopay
   *  drafts from THEIR account, so the joint total is needed ACROSS the
   *  household — never claimed to belong in the viewer's funding account. */
  householdName?: string | null;
}) {
  const { headline } = result;

  if (headline.byDate === null) {
    // "Nothing is due" and "we cannot date anything" are different facts, and only
    // one of them is a claim about the user's money. A card whose issuer never sent
    // a statement (and that has no cycle days to estimate from) carries a real
    // balance the user still owes — saying nothing is due would be false.
    // A card carrying NO balance owes nothing, so "nothing is due" is true for it —
    // raising the amber alert over a closed or paid-off card would be a false alarm,
    // the mirror of the false all-clear this branch exists to prevent. Those cards
    // are still listed on /cards; they just don't take over the hero.
    const unknown = result.unknownDueDateCards.filter((c) => c.currentBalanceCents !== 0);
    if (unknown.length > 0) {
      const owed = unknown.reduce((sum, c) => sum + c.currentBalanceCents, 0);
      return (
        <Card data-testid="cash-needed-card" className="border-amber-900/40">
          <CardHeader>
            <CardTitle>Cards: due dates missing</CardTitle>
            <CardDescription data-testid="cash-needed-unknown">
              {unknown.length === 1
                ? `We don’t have a statement or due date for ${unknown[0]!.cardName}, so it isn’t in this cycle’s total.`
                : `We don’t have a statement or due date for ${unknown.length} cards, so they aren’t in this cycle’s total.`}{' '}
              {/* Only state a total when every balance points the same way. A set
                  mixing a balance owed with a credit can net to a number that
                  describes neither, so we say nothing rather than something wrong. */}
              {unknown.every((c) => c.currentBalanceCents > 0)
                ? `${unknown.length === 1 ? 'Its balance is' : 'Their balances add up to'} ${formatCents(cents(owed))} — that is a balance, not an amount we can say is due.`
                : 'A balance on one of these is not an amount we can say is due.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            {/* No instruction here. The "+ Add statement" control exists ONLY for
                manually-added cards (server/transactions.ts builds cardBilling for
                provider === 'manual', and card-actions.ts refuses anything else), so
                telling the owner of a CONNECTED card to add one sends them looking
                for a button that isn't on their row — cycle-2 critic P1-1. What is
                true for every card is that we re-check daily. */}
            <p>
              The bank hasn’t sent a statement for{' '}
              {unknown.length === 1 ? 'this card' : 'these cards'} yet. Connected cards
              are re-checked every day, and the due date appears here as soon as it
              arrives — there’s nothing to do in the meantime.
            </p>
            <p>
              <Link href="/cards" className="underline hover:text-foreground">
                See all cards →
              </Link>
            </p>
          </CardContent>
        </Card>
      );
    }
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
          amountClassName="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl"
          engagementSubjectKey="cash-needed"
        >
          <p className="text-sm text-muted-foreground" data-testid="cash-needed-headline">
            needed{' '}
            {householdName
              ? HOUSEHOLD_COPY.headlineAcrossHousehold(householdName)
              : `in ${paymentAccountName}`}{' '}
            by{' '}
            <span className="font-medium text-foreground">
              {formatISODate(isoDate(headline.byDate))}
            </span>{' '}
            {/* "all" is a claim about EVERY card. It is false the moment one card
                has no due date we can place, so it only survives when there are
                none — otherwise this figure covers the datable cards only. */}
            {result.unknownDueDateCards.length > 0
              ? `to pay the ${headline.cardsDueCount} cards we have due dates for.`
              : `to pay all ${headline.cardsDueCount} cards in full this cycle.`}
          </p>
        </GlassBoxNumber>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.unknownDueDateCards.length > 0 && (
          // The mixed case: a real total for the datable cards, plus at least one
          // card we cannot date. Without this line the figure reads as complete.
          <p className="text-xs text-amber-500" data-testid="cash-needed-unknown-note">
            Not included:{' '}
            {result.unknownDueDateCards.map((c) => c.cardName).join(', ')} — no statement or
            due date yet, so {result.unknownDueDateCards.length === 1 ? 'its' : 'their'}{' '}
            balance isn’t in this figure.
          </p>
        )}
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
              <span className="min-w-0 break-words">
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
              <span className="min-w-0 break-words">
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
