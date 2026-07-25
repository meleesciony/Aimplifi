'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type ISODate, formatISODate } from '@/lib/dates';
import { type Cents, formatCents } from '@/lib/money';
import type { ReturnMoment } from '@/lib/engine/return-moment/build';
import { frozenProjectionNote } from '@/lib/engine/account/feed-dropped-view';
import { logEngagement } from '@/server/engagement-actions';

/**
 * "Since you were away" re-entry card (TASKS 1.1). Shown once when a user returns
 * after a gap of more than a week — it rewards the return with a short, honest
 * story (what auto-filed, what changed, whether cash flow is clear) instead of a
 * backlog. Every value comes from `buildReturnMoment`, which copies verbatim from
 * already-computed engines; this component only formats and lays out.
 *
 * Dismissable in the session; it also naturally stops appearing after this visit,
 * since loading the dashboard stamps today's date as the new last-seen.
 * Engagement: viewed on mount + dismissed on "Got it" (TASKS 3.1).
 */
const MAX_PRICE_ROWS = 3;

export function ReturnMomentCard({ moment }: { moment: ReturnMoment }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void logEngagement({ surface: 'dashboard', verb: 'viewed', subjectKey: 'return-moment' });
  }, []);

  if (dismissed) return null;

  const shownIncreases = moment.priceIncreases.slice(0, MAX_PRICE_ROWS);
  const extraIncreases = moment.priceIncreases.length - shownIncreases.length;

  return (
    <Card data-testid="return-moment-card" aria-labelledby="return-moment-title">
      <CardHeader>
        <CardTitle id="return-moment-title">Welcome back</CardTitle>
        <p className="text-sm text-muted-foreground">
          It&apos;s been {moment.daysAway} days. Here&apos;s what happened while you were away.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <RadarLine radar={moment.radar} />

        {moment.autoFiledCount > 0 && (
          <p data-testid="return-moment-autofiled">
            <span className="font-medium tabular-nums">{moment.autoFiledCount}</span>{' '}
            {moment.autoFiledCount === 1 ? 'transaction' : 'transactions'} filed themselves into
            categories while you were gone — all reviewable in your activity.
          </p>
        )}

        {shownIncreases.length > 0 && (
          <div data-testid="return-moment-price-increases">
            <p className="font-medium">A few subscriptions changed price:</p>
            <ul className="mt-1 space-y-0.5">
              {shownIncreases.map((p) => (
                <li key={p.merchant} className="flex justify-between gap-4">
                  <span>{p.merchant}</span>
                  <span className="tabular-nums text-muted-foreground">
                    +{formatCents(p.deltaCents as Cents)}/mo
                  </span>
                </li>
              ))}
            </ul>
            {extraIncreases > 0 && (
              <p className="mt-0.5 text-muted-foreground">and {extraIncreases} more</p>
            )}
          </div>
        )}

        {moment.reviewHighlight && (
          <p className="text-muted-foreground">{moment.reviewHighlight}</p>
        )}

        <div className="pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void logEngagement({
                surface: 'dashboard',
                verb: 'dismissed',
                subjectKey: 'return-moment',
              });
              setDismissed(true);
            }}
          >
            Got it
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RadarLine({ radar }: { radar: ReturnMoment['radar'] }) {
  // L.20 critic cycle, finding B-4. Both branches qualify, in opposite directions: on `clear` the
  // silence itself is what a balance frozen HIGH manufactures, and on `warning` the dip may come
  // sooner and deeper than the date printed. `shows` picks the sentence that matches the branch,
  // and `accounts-route` because this card renders in the app, where /accounts is a real route.
  const frozen = radar.frozenStart ? (
    <p data-testid="return-moment-radar-frozen" className="text-muted-foreground">
      {frozenProjectionNote(radar.frozenStart, {
        shows: radar.kind === 'clear' ? 'no-dip' : 'a-dip',
        nextStep: 'accounts-route',
      })}
    </p>
  ) : null;
  if (radar.kind === 'clear') {
    return (
      <>
        <p data-testid="return-moment-radar">
          Your cash flow looks clear — no shortfall ahead on the horizon.
        </p>
        {frozen}
      </>
    );
  }
  const inDays = radar.daysUntil !== null && radar.daysUntil > 0 ? ` (in ${radar.daysUntil} days)` : '';
  const aroundCard = radar.cardName ? `, around your ${radar.cardName} payment` : '';
  return (
    <>
      <p data-testid="return-moment-radar">
        Heads up: your checking could dip below $0 on{' '}
        <span className="font-medium">{formatISODate(radar.onDate as ISODate)}</span>
        {inDays}
        {aroundCard}. See Cash Flow Radar below for the exact cover transfer.
      </p>
      {frozen}
    </>
  );
}
