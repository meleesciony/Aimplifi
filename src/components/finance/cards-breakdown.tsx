'use client';

/**
 * Per-card breakdown with the pay-in-full ⇄ minimum toggle. Both scenarios are
 * computed server-side by the engine; this component only switches between them.
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import { formatISODate, formatRelativeDays, isoDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';

export function CardsBreakdown({
  payInFull,
  minimum,
  paymentAccountName,
  today,
  cardOwnerLabel = {},
}: {
  payInFull: CashNeededResult;
  minimum: CashNeededResult;
  paymentAccountName: string;
  today: string;
  /** cardId → owning partner's name, for cards folded in from household scope
   *  (TASKS 4.2 slice 5). Empty for solo/'mine' scope — no badge renders. */
  cardOwnerLabel?: Record<string, string>;
}) {
  const [scenario, setScenario] = useState<'PAY_IN_FULL' | 'MINIMUM'>('PAY_IN_FULL');
  const result = scenario === 'PAY_IN_FULL' ? payInFull : minimum;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Payment scenario" className="inline-flex rounded-lg border p-0.5">
          <Button
            variant={scenario === 'PAY_IN_FULL' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={scenario === 'PAY_IN_FULL'}
            onClick={() => setScenario('PAY_IN_FULL')}
            data-testid="toggle-pay-in-full"
          >
            Pay in full
          </Button>
          <Button
            variant={scenario === 'MINIMUM' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={scenario === 'MINIMUM'}
            onClick={() => setScenario('MINIMUM')}
            data-testid="toggle-minimum"
          >
            Minimum payments
          </Button>
        </div>
        <div className="text-sm text-muted-foreground" aria-live="polite" data-testid="scenario-summary">
          {result.headline.byDate ? (
            <>
              Needs{' '}
              <span className="font-semibold text-foreground" data-testid="scenario-required">
                {formatCents(result.headline.requiredCents)}
              </span>{' '}
              in {paymentAccountName} by {formatISODate(isoDate(result.headline.byDate))}
            </>
          ) : (
            'Nothing due this cycle'
          )}
        </div>
      </div>

      {scenario === 'MINIMUM' && result.minimumPathInterestCents !== null && (
        <p className="text-sm text-amber-500" data-testid="minimum-interest">
          Minimum path costs ≈ {formatCents(result.minimumPathInterestCents)} in interest
          next cycle (estimated by the average-daily-balance method at each card&apos;s APR;
          new purchases aren&apos;t included).
        </p>
      )}

      {(() => {
        // urgency order: soonest effective due date first, manual action before autopay
        const ordered = [...result.cards].sort(
          (a, b) =>
            a.effectiveDueDate.localeCompare(b.effectiveDueDate) ||
            b.userActionCents - a.userActionCents,
        );
        const firstAction = ordered.find((c) => c.userActionCents > 0);
        return (
          <>
            {firstAction && (
              <p
                className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-sm"
                data-testid="do-this-first"
              >
                <span className="font-medium">Do this first:</span> pay {firstAction.cardName}
                {cardOwnerLabel[firstAction.cardId] ? ` (${cardOwnerLabel[firstAction.cardId]}'s)` : ''}{' '}
                {formatCents(firstAction.userActionCents)} by{' '}
                {formatISODate(isoDate(firstAction.effectiveDueDate))} (
                {formatRelativeDays(isoDate(today), isoDate(firstAction.effectiveDueDate))}).
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {ordered.map((card) => (
                <Card key={card.cardId} data-testid={`card-${card.cardId}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">{card.cardName}</CardTitle>
                      <div className="flex gap-1">
                        {cardOwnerLabel[card.cardId] && (
                          <Badge variant="outline" data-testid={`card-owner-${card.cardId}`}>
                            {cardOwnerLabel[card.cardId]}
                          </Badge>
                        )}
                        {card.isEstimated && <Badge variant="outline">est.</Badge>}
                        {card.autopayCents > 0 && <Badge variant="secondary">autopay</Badge>}
                      </div>
                    </div>
                    <CardDescription>
                      Due {formatISODate(isoDate(card.effectiveDueDate))} (
                      {formatRelativeDays(isoDate(today), isoDate(card.effectiveDueDate))})
                      {card.effectiveDueDate !== card.dueDate &&
                        ` · issuer date ${formatISODate(isoDate(card.dueDate))}`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    {/* THE answer for this card, biggest thing on it */}
                    <div className="flex items-baseline justify-between">
                      <span className="text-muted-foreground">You must pay</span>
                      <span
                        className="text-xl font-semibold tabular-nums"
                        data-testid={`user-action-${card.cardId}`}
                      >
                        {formatCents(card.userActionCents)}
                      </span>
                    </div>
                    {card.userActionCents === 0 && card.autopayCents > 0 && (
                      <p className="text-xs text-emerald-500">
                        Autopay handles it — just keep the cash in place.
                      </p>
                    )}
                    <div className="flex justify-between pt-1">
                      <span className="text-muted-foreground">Cash required</span>
                      <span className="tabular-nums">{formatCents(card.cashRequiredCents)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Remaining statement due</span>
                      <span className="tabular-nums">{formatCents(card.remainingDueCents)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Minimum due</span>
                      <span className="tabular-nums">{formatCents(card.minimumDueCents)}</span>
                    </div>
                    {card.autopayCents > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Autopay will move</span>
                        <span className="tabular-nums">{formatCents(card.autopayCents)}</span>
                      </div>
                    )}
                    {card.notes.length > 0 && (
                      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                        {card.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        );
      })()}
    </div>
  );
}
