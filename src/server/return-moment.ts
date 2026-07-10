/**
 * Return-moment server glue (TASKS 1.1). Thin, deterministic: reads the stored
 * last-seen calendar date, measures the gap in civil days, stamps today, and —
 * only for an actual return (gap > 7d) — assembles the pure `buildReturnMoment`
 * from pieces the dashboard has ALREADY fetched (coach review + opportunities,
 * radar) plus one cheap count. It recomputes no money and re-fetches nothing
 * heavy, so it adds a single indexed read + at most one tiny write to a load.
 *
 * Golden/demo-safe by construction: `lastSeenDate` is stamped to the provider's
 * "today", so for the demo user (fixed today) every stamp equals the last and the
 * gap is always 0 → null → no card, and no engine reads the column.
 */
import { type ISODate, daysBetween, isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { AUTO_SILENT_BPS } from '@/lib/engine/categorize/pipeline';
import type { MoneyReview } from '@/lib/engine/fi/coach-copy';
import type { Opportunity } from '@/lib/engine/fi/insights';
import type { RadarResult } from '@/lib/engine/radar/radar';
import {
  RETURN_MOMENT_THRESHOLD_DAYS,
  type ReturnMoment,
  buildReturnMoment,
} from '@/lib/engine/return-moment/build';

export interface ReturnMomentSources {
  /** The provider's "today" for this user (calendar date). */
  today: ISODate;
  review: MoneyReview | null;
  opportunities: readonly Opportunity[];
  radar: RadarResult;
}

export async function getReturnMoment(
  userId: string,
  sources: ReturnMomentSources,
): Promise<ReturnMoment | null> {
  const { today, review, opportunities, radar } = sources;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { lastSeenDate: true } });
  const previous = user?.lastSeenDate ?? null;

  // Civil-day gap in the same calendar domain as `today` (both provider dates),
  // so it is TZ-free and, for the fixed-today demo user, always 0.
  const daysSinceLastSeen = previous ? daysBetween(isoDate(previous), today) : null;

  // Stamp this visit. Skip the write when the date is unchanged (same-day revisit,
  // and every demo load) so we don't churn a row on every render.
  if (previous !== today) {
    await prisma.user.update({ where: { id: userId }, data: { lastSeenDate: today } });
  }

  // The engine owns the greeting gate; short-circuit the count query when it won't
  // greet (same threshold, so this can never disagree with buildReturnMoment).
  if (daysSinceLastSeen === null || daysSinceLastSeen <= RETURN_MOMENT_THRESHOLD_DAYS) return null;

  // Silently auto-filed since the previous visit: predictions logged at/after the
  // start of that calendar date, in the SILENT band (a deliberate "Always"/high-
  // confidence auto-file, never the review band). `previous` is a valid ISO date we
  // wrote ourselves, so the UTC-midnight boundary is well-defined.
  const since = new Date(`${previous}T00:00:00.000Z`);
  const autoFiledCount = await prisma.categoryPrediction.count({
    where: { userId, confidenceBps: { gte: AUTO_SILENT_BPS }, createdAt: { gte: since } },
  });

  const priceIncreases = opportunities
    .filter((o) => o.kind === 'price-increase')
    .map((o) => ({ merchant: o.merchant, deltaCents: o.monthlyCents }));

  return buildReturnMoment({
    daysSinceLastSeen,
    review,
    radar: {
      firstNegativeDate: radar.committed.firstNegativeDate,
      daysUntilFirstNegative: radar.daysUntilFirstNegative,
      collidingCardName: radar.collidingCards[0]?.cardName ?? null,
    },
    autoFiledCount,
    priceIncreases,
  });
}
