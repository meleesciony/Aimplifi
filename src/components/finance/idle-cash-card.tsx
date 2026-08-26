/**
 * Idle-cash lens (DECISIONS #519). Server already ran the pure engine —
 * this card only renders. After the net-worth / expected-NW pair, never
 * on /accounts (`getCoachData` throws with zero accounts).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { frozenTotalNote } from '@/lib/engine/account/feed-dropped-view';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { IdleCash } from '@/lib/engine/fi/idle-cash';
import { cents, formatCents } from '@/lib/money';

export function IdleCashCard({
  result,
  frozenLiquid,
}: {
  result: IdleCash;
  frozenLiquid: { label: string; frozenSince: string }[];
}) {
  const sentence = result.noExpenses
    ? COACH_COPY.idleCashEmpty(result)
    : result.idle
      ? COACH_COPY.idleCashIdle(result)
      : COACH_COPY.idleCash(result);
  const heading = result.excessCents != null
    ? formatCents(cents(result.excessCents))
    : COACH_COPY.idleCashSubtitle();
  const frozenNote = frozenTotalNote(frozenLiquid, {
    figureLabel: 'the checking and savings total this note uses',
    nextStep: 'accounts-route',
  });

  return (
    <Card data-testid="idle-cash-card">
      <CardHeader className="pb-2">
        <CardDescription>{COACH_COPY.idleCashTitle()}</CardDescription>
        <CardTitle className="text-base" data-testid="idle-cash-heading">
          {heading}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p
          className="text-muted-foreground"
          data-testid={
            result.noExpenses ? 'idle-cash-empty' : result.idle ? 'idle-cash-idle' : 'idle-cash-sentence'
          }
        >
          {sentence}
        </p>
        {frozenNote ? (
          <p className="text-xs text-warning-500" data-testid="idle-cash-frozen">
            {frozenNote}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
