/**
 * getReturnMoment integration (TASKS 1.1) — drives the REAL server composer against
 * a throwaway user (never the seeded demo user), proving the DB-facing behavior the
 * pure engine test can't: the last-seen read/stamp lifecycle, the >7-day gate, the
 * silent-band + since-date auto-filed count, and price-increase filtering.
 *
 * Golden-safety is covered separately by the e2e (the fixed-today demo user shows no
 * card); here we exercise the positive/return path an e2e can't seed in the browser.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { getReturnMoment } from '@/server/return-moment';
import { AUTO_SILENT_BPS, AUTO_FLAGGED_BPS } from '@/lib/engine/categorize/pipeline';
import { isoDate } from '@/lib/dates';
import type { Cents } from '@/lib/money';
import type { MoneyReview } from '@/lib/engine/fi/coach-copy';
import type { Opportunity } from '@/lib/engine/fi/insights';
import type { RadarResult } from '@/lib/engine/radar/radar';

const USER = `returnmoment-${Date.now()}-${process.pid}`;
const TODAY = isoDate('2026-07-09');

const REVIEW: MoneyReview = {
  month: 'Jul 2026',
  improvement: 'Your savings rate held steady — nice work.',
  creep: 'Nothing crept up.',
  nextAction: 'Next: review your subscriptions.',
};

function opp(kind: Opportunity['kind'], merchant: string, monthlyCents: number): Opportunity {
  return {
    kind,
    merchant,
    monthlyCents: monthlyCents as Cents,
    fv10Cents: 0 as Cents,
    fv20Cents: 0 as Cents,
    fv30Cents: 0 as Cents,
    isEstimate: false,
  };
}

function makeRadar(over: Partial<RadarResult['committed']> = {}, top: Partial<RadarResult> = {}): RadarResult {
  return {
    today: TODAY,
    horizonDays: 90,
    status: 'ok',
    committed: { firstNegativeDate: null, lowestDate: TODAY, lowestCents: 500000, endingCents: 500000, ...over },
    daysUntilFirstNegative: null,
    pushWorthy: false,
    collidingCards: [],
    dipEvents: [],
    coverTransfer: null,
    burn: null,
    includesEstimatedDues: false,
    assumptions: [],
    ...top,
  };
}

const sources = (over: Partial<Parameters<typeof getReturnMoment>[1]> = {}) => ({
  today: TODAY,
  review: REVIEW,
  opportunities: [] as Opportunity[],
  radar: makeRadar(),
  ...over,
});

async function setLastSeen(date: string | null) {
  await prisma.user.update({ where: { id: USER }, data: { lastSeenDate: date } });
}
async function readLastSeen(): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: USER }, select: { lastSeenDate: true } });
  return u?.lastSeenDate ?? null;
}

describe('getReturnMoment (integration)', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
  });
  beforeEach(async () => {
    await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
    await setLastSeen(null);
  });

  it('first-ever visit: returns null and stamps today (no greeting on day 0)', async () => {
    const m = await getReturnMoment(USER, sources());
    expect(m).toBeNull();
    expect(await readLastSeen()).toBe(TODAY);
  });

  it('active user (3-day gap): returns null, still re-stamps today', async () => {
    await setLastSeen('2026-07-06'); // 3 days before TODAY
    const m = await getReturnMoment(USER, sources());
    expect(m).toBeNull();
    expect(await readLastSeen()).toBe(TODAY);
  });

  it('boundary: exactly 7 days is still silent', async () => {
    await setLastSeen('2026-07-02'); // 7 days before TODAY
    expect(await getReturnMoment(USER, sources())).toBeNull();
  });

  it('return after 10 days: greets with correct daysAway and stamps today', async () => {
    await setLastSeen('2026-06-29'); // 10 days before TODAY
    const m = await getReturnMoment(USER, sources());
    expect(m).not.toBeNull();
    expect(m!.daysAway).toBe(10);
    expect(m!.reviewHighlight).toBe(REVIEW.improvement);
    expect(await readLastSeen()).toBe(TODAY);
  });

  it('does not greet twice: an immediate re-run (now 0-day gap) is null', async () => {
    await setLastSeen('2026-06-29');
    expect(await getReturnMoment(USER, sources())).not.toBeNull();
    // last-seen is now TODAY → second call sees a 0-day gap
    expect(await getReturnMoment(USER, sources())).toBeNull();
  });

  it('auto-filed count: only SILENT-band predictions since the last visit', async () => {
    await setLastSeen('2026-06-29');
    await prisma.categoryPrediction.createMany({
      data: [
        // counted: silent band, after the since-boundary
        { userId: USER, transactionId: `${USER}-a`, predictedCategoryId: 'groceries', confidenceBps: AUTO_SILENT_BPS, createdAt: new Date('2026-07-01T12:00:00.000Z') },
        { userId: USER, transactionId: `${USER}-b`, predictedCategoryId: 'dining', confidenceBps: 9500, createdAt: new Date('2026-07-03T12:00:00.000Z') },
        // excluded: flagged (review) band, not a silent auto-file
        { userId: USER, transactionId: `${USER}-c`, predictedCategoryId: 'shopping', confidenceBps: AUTO_FLAGGED_BPS, createdAt: new Date('2026-07-02T12:00:00.000Z') },
        // excluded: silent band but BEFORE the previous visit
        { userId: USER, transactionId: `${USER}-d`, predictedCategoryId: 'utilities', confidenceBps: 9900, createdAt: new Date('2026-06-01T12:00:00.000Z') },
      ],
    });
    const m = await getReturnMoment(USER, sources());
    expect(m!.autoFiledCount).toBe(2);
  });

  it('price increases: only price-increase opportunities pass through, verbatim', async () => {
    await setLastSeen('2026-06-29');
    const m = await getReturnMoment(
      USER,
      sources({
        opportunities: [
          opp('price-increase', 'Netflix', 200),
          opp('unused-subscription', 'Ghost Gym', 5000), // filtered out
          opp('price-increase', 'Spotify', 150),
        ],
      }),
    );
    expect(m!.priceIncreases).toEqual([
      { merchant: 'Netflix', deltaCents: 200 },
      { merchant: 'Spotify', deltaCents: 150 },
    ]);
  });

  it('radar warning flows through when a committed dip exists', async () => {
    await setLastSeen('2026-06-29');
    const m = await getReturnMoment(
      USER,
      sources({
        radar: makeRadar(
          { firstNegativeDate: isoDate('2026-07-15') },
          { status: 'alert', daysUntilFirstNegative: 6, collidingCards: [{ cardId: 'c1', cardName: 'Amex', dueDate: isoDate('2026-07-15'), amountCents: 40000 as Cents, isEstimated: false }] },
        ),
      }),
    );
    // `frozenStart` rides both radar states (L.20 critic cycle, B-4): this fixture's funding
    // account is live, so the card qualifies nothing — the abstention half of that finding.
    expect(m!.radar).toEqual({
      kind: 'warning',
      onDate: '2026-07-15',
      daysUntil: 6,
      cardName: 'Amex',
      frozenStart: null,
    });
  });
});
