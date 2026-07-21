/**
 * Habit streaks card (#254, AI plan §Later #17 streaks half): the card
 * cleared-in-full streak and the no-subscription-creep streak. Server
 * component — pure display of the two engines' facts; every string comes
 * from COACH_COPY so the guardrail scans cover it. The savings-rate streak
 * (#205) stays on the SavingsRateCard — one surface per fact.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { CardClearedStreakResult } from '@/lib/engine/cards/cleared-streak';
import type { NoCreepStreakResult } from '@/lib/engine/recurring/creep-streak';
import { cents } from '@/lib/money';
import { formatMonth } from '@/lib/dates';

function clearedLine(r: CardClearedStreakResult): string {
  if (r.latestMonth === null) {
    // forming (critic #254 F2): only-partial-month history exists — "no
    // statement has come due yet" would be false for that user.
    return r.formingThisMonth ? COACH_COPY.cardClearedForming() : COACH_COPY.cardClearedNoHistory();
  }
  if (r.streakMonths === 0) return COACH_COPY.cardClearedBroken(formatMonth(r.brokeAt ?? r.latestMonth));
  return COACH_COPY.cardClearedStreak(
    r.streakMonths,
    r.cardsInStreak,
    r.statementsInStreak,
    formatMonth(r.latestMonth),
  );
}

export function HabitStreaksCard({
  cardCleared,
  noCreep,
}: {
  cardCleared: CardClearedStreakResult;
  noCreep: NoCreepStreakResult;
}) {
  return (
    <Card data-testid="habit-streaks-card">
      <CardHeader>
        <CardTitle>{COACH_COPY.streaksTitle()}</CardTitle>
        <CardDescription>{COACH_COPY.streaksBasis()}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm" data-testid="card-cleared-streak">
          {clearedLine(cardCleared)}
        </p>
        <div className="space-y-1">
          <p className="text-sm" data-testid="no-creep-streak">
            {noCreep.streakMonths === null
              ? COACH_COPY.noCreepNoSubs()
              : noCreep.streakMonths === 0 && noCreep.brokeOn !== null
                ? COACH_COPY.noCreepBrokenNow(
                    noCreep.brokeOn.merchantCanonical,
                    cents(noCreep.brokeOn.fromCents),
                    cents(noCreep.brokeOn.toCents),
                    formatMonth(noCreep.brokeOn.month),
                  )
                : COACH_COPY.noCreepStreak(noCreep.streakMonths, noCreep.windowMonths, noCreep.subscriptionCount)}
          </p>
          {noCreep.streakMonths !== null && noCreep.streakMonths > 0 && noCreep.brokeOn !== null && (
            <p className="text-xs text-muted-foreground" data-testid="no-creep-last-increase">
              {COACH_COPY.noCreepLastIncrease(
                noCreep.brokeOn.merchantCanonical,
                cents(noCreep.brokeOn.fromCents),
                cents(noCreep.brokeOn.toCents),
                formatMonth(noCreep.brokeOn.month),
              )}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
