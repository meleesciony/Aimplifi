/**
 * W.6(c) — coach wiring: fulfillment curve on CoachData + copy locks.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { fulfillmentByCategory } from '@/lib/engine/fi/fulfillment';
import { hoursOfWork } from '@/lib/engine/fi/insights';
import { cents } from '@/lib/money';
import { getCoachData } from '@/server/coach';

describe('COACH_COPY.fulfillment*', () => {
  it('row names dials and shares growthPhrase with creep', () => {
    const row = COACH_COPY.fulfillmentRow(
      {
        categoryId: 'dining',
        categoryName: 'Dining Out',
        isMoneyDial: true,
        monthly: [],
        totalSpendCents: 114_000,
        totalHours: 30,
        trendBps: 10_000,
        trendMeasured: true,
      },
      6,
    );
    expect(row).toContain('Dining Out (a money dial)');
    expect(row).toContain('30 hours');
    expect(row).toContain('typical monthly spend grew ~100.0%');
    expect(row).not.toMatch(/this card/i);
    expect(row).not.toMatch(/\bbelow\b/i);
  });

  it('unmeasured trend stays silent about growth', () => {
    const row = COACH_COPY.fulfillmentRow(
      {
        categoryId: 'shopping',
        categoryName: 'Shopping',
        isMoneyDial: false,
        monthly: [],
        totalSpendCents: 5_000,
        totalHours: hoursOfWork(cents(5_000), 3800),
        trendBps: 0,
        trendMeasured: false,
      },
      6,
    );
    expect(row).toContain('Shopping:');
    expect(row).not.toContain('grew');
    expect(row).not.toContain('fell');
    expect(row).not.toContain('flat');
  });

  it('subtitle and footnote name the wage and complete-month basis', () => {
    const curve = fulfillmentByCategory({
      transactions: [],
      today: isoDate('2026-06-10'),
      hourlyWageCents: 3800,
    });
    expect(curve).not.toBeNull();
    expect(COACH_COPY.fulfillmentSubtitle(curve!)).toContain('complete month');
    expect(COACH_COPY.fulfillmentFootnote(cents(3800))).toContain('$38.00/hr');
    expect(COACH_COPY.fulfillmentFootnote(cents(3800))).toContain('fulfillment curve');
    expect(COACH_COPY.fulfillmentFootnote(cents(3800))).toMatch(/assuming/i);
    expect(COACH_COPY.fulfillmentFootnote(cents(3800))).toContain('typical (median)');
  });
});

describe('W.6(c) /coach fulfillment payload', () => {
  it('demo has a wage and ranked discretionary categories', async () => {
    const d = await getCoachData(DEMO_USER_ID);
    expect(d.hourlyWageCents).toBe(3800);
    expect(d.fulfillment).not.toBeNull();
    expect(d.fulfillment!.windowMonths).toBe(6);
    expect(d.fulfillment!.hourlyWageCents).toBe(3800);
    expect(d.fulfillment!.categories.length).toBeGreaterThan(0);
    expect(d.fulfillment!.categories.length).toBeLessThanOrEqual(5);
    expect(d.fulfillment!.categoryCount).toBeGreaterThanOrEqual(d.fulfillment!.categories.length);
    const top = d.fulfillment!.categories[0]!;
    const sparkSum =
      Math.round(top.monthly.reduce((s, m) => s + m.hours, 0) * 10) / 10;
    expect(top.totalHours).toBe(sparkSum);
    const row = COACH_COPY.fulfillmentRow(top, d.fulfillment!.windowMonths);
    expect(row).toContain(top.categoryName);
    expect(row).not.toMatch(/this card/i);
    expect(row).not.toMatch(/\bbelow\b/i);
    const spark = COACH_COPY.fulfillmentSpark(top);
    expect(spark).toMatch(/\d{4}|\d{2}/); // month label present
    expect(spark).toContain('hrs');
    if (d.fulfillment!.categoryCount > d.fulfillment!.categories.length) {
      const omitted = COACH_COPY.fulfillmentOmitted(d.fulfillment!);
      expect(omitted).not.toBeNull();
      expect(omitted).toContain('more discretionary');
      expect(COACH_COPY.fulfillmentSubtitle(d.fulfillment!)).toContain('that took the most');
      expect(COACH_COPY.fulfillmentSubtitle(d.fulfillment!)).not.toMatch(/\beach\b/);
    }
  });
});
