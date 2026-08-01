/**
 * Value-receipts engine (TASKS 1.3, DECISIONS #206) — known-answer tests.
 * The module's contract: it NEVER computes a money value (every amount is copied
 * verbatim from the source engine), keys are stable/channel-agnostic, and the
 * summary is counts + per-kind totals only (no cross-kind dollar total exists).
 */
import { describe, expect, it } from 'vitest';
import {
  priceIncreaseReceiptKey,
  receiptFromRadarAlert,
  receiptLines,
  receiptsFromOpportunities,
  receiptsFromReminders,
  summarizeReceipts,
} from '@/lib/engine/receipts/receipts';
import { paymentNotificationKey, radarNotificationKey } from '@/lib/engine/notify/select';
import type { PaymentReminder } from '@/lib/engine/reminders/select';
import type { RadarResult } from '@/lib/engine/radar/radar';
import type { Opportunity } from '@/lib/engine/fi/insights';
import { ZERO, cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';

const TODAY = isoDate('2026-06-10');

const reminder = (over: Partial<PaymentReminder> = {}): PaymentReminder => ({
  accountId: 'card-1',
  accountName: 'Sapphire',
  obligationType: 'card',
  dueDate: isoDate('2026-06-15'),
  daysUntil: 5,
  urgency: 'upcoming',
  cashRequiredCents: cents(123456),
  userActionCents: cents(100000),
  autopayCents: cents(23456),
  autopayCovered: false,
  isEstimated: false,
  frozenSince: null,
  ...over,
});

const radar = (over: Partial<RadarResult> = {}): RadarResult => ({
  today: TODAY,
  horizonDays: 30,
  status: 'alert',
  committed: {
    firstNegativeDate: isoDate('2026-06-14'),
    lowestDate: isoDate('2026-06-14'),
    lowestCents: -45210,
    endingCents: 88000,
  },
  daysUntilFirstNegative: 4,
  pushWorthy: true,
  collidingCards: [
    {
      cardId: 'card-1',
      cardName: 'Sapphire',
      dueDate: isoDate('2026-06-14'),
      amountCents: cents(120000),
      isEstimated: false,
    },
  ],
  dipEvents: [],
  coverTransfer: {
    amountCents: cents(50000),
    byDate: isoDate('2026-06-13'),
    // Worst dip on the first short date — the unsplit shape (L.23).
    worstDipDate: isoDate('2026-06-14'),
    firstShortCents: ZERO,
    worstDipEvents: [],
    sources: [],
  },
  burn: null,
  includesEstimatedDues: false,
  assumptions: [],
  ...over,
});

const opportunity = (over: Partial<Opportunity> = {}): Opportunity => ({
  kind: 'price-increase',
  merchant: 'Netflix',
  monthlyCents: cents(250),
  todayValue10Cents: cents(43000),
  todayValue20Cents: cents(130000),
  todayValue30Cents: cents(305000),
  isEstimate: false,
  priceChangedAt: '2026-02-03',
  priceFromCents: cents(1549),
  priceToCents: cents(1799),
  ...over,
});

describe('receiptsFromReminders — verbatim copy, channel-agnostic key', () => {
  it('copies cashRequiredCents (the payment covered), never a derived value', () => {
    const [r] = receiptsFromReminders([reminder()], TODAY);
    expect(r.amountCents).toBe(123456); // NOT userActionCents (100000) or autopay part
    expect(r.kind).toBe('reminder-delivered');
    expect(r.label).toBe('Sapphire');
    expect(r.occurredOn).toBe(TODAY);
  });

  it('key equals the notify-engine payment key, so email and push mint one receipt', () => {
    const [r] = receiptsFromReminders([reminder()], TODAY);
    expect(r.key).toBe(paymentNotificationKey({ accountId: 'card-1', dueDate: '2026-06-15' }));
  });

  it('one receipt per reminder, in order; empty in → empty out', () => {
    const rs = receiptsFromReminders(
      [reminder(), reminder({ accountId: 'loan-1', accountName: 'Auto Loan', obligationType: 'loan' })],
      TODAY,
    );
    expect(rs).toHaveLength(2);
    expect(rs[1].label).toBe('Auto Loan');
    expect(receiptsFromReminders([], TODAY)).toEqual([]);
  });

  it('does not mutate the caller’s reminders', () => {
    const input = [reminder()];
    const before = JSON.stringify(input);
    receiptsFromReminders(input, TODAY);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('ESTIMATED reminders mint nothing — a projected amount/date must not enter the permanent tally (critic #206 P2-3)', () => {
    const rs = receiptsFromReminders([reminder({ isEstimated: true })], TODAY);
    expect(rs).toEqual([]);
    // Mixed set: only the real-statement reminder mints.
    const mixed = receiptsFromReminders([reminder({ isEstimated: true }), reminder({ accountId: 'card-2' })], TODAY);
    expect(mixed).toHaveLength(1);
    expect(mixed[0].key).toContain('card-2');
  });
});

describe('receiptFromRadarAlert — same gate as the notification itself', () => {
  it('copies the cover-transfer amount the alert showed, key = radar key', () => {
    const r = receiptFromRadarAlert(radar(), TODAY);
    expect(r).not.toBeNull();
    expect(r!.amountCents).toBe(50000);
    expect(r!.key).toBe(radarNotificationKey('2026-06-14'));
    expect(r!.kind).toBe('radar-catch');
    expect(r!.label).toBe('Sapphire');
    expect(r!.occurredOn).toBe(TODAY);
  });

  it('no cover transfer → amount 0 (the alert suggested no move; nothing is invented)', () => {
    const r = receiptFromRadarAlert(radar({ coverTransfer: null }), TODAY);
    expect(r!.amountCents).toBe(0);
  });

  it('no colliding card → empty label, still a valid receipt', () => {
    const r = receiptFromRadarAlert(radar({ collidingCards: [] }), TODAY);
    expect(r!.label).toBe('');
  });

  it('null when not pushWorthy or no projected-negative date (nothing was catch-worthy)', () => {
    expect(receiptFromRadarAlert(radar({ pushWorthy: false }), TODAY)).toBeNull();
    expect(
      receiptFromRadarAlert(
        radar({
          committed: { firstNegativeDate: null, lowestDate: TODAY, lowestCents: 100, endingCents: 100 },
        }),
        TODAY,
      ),
    ).toBeNull();
  });
});

describe('receiptsFromOpportunities — price increases only, keyed on the price transition', () => {
  it('copies monthlyCents verbatim; occurredOn is the change date, not the view date', () => {
    const [r] = receiptsFromOpportunities([opportunity()]);
    expect(r.amountCents).toBe(250);
    expect(r.occurredOn).toBe('2026-02-03');
    expect(r.key).toBe(priceIncreaseReceiptKey('Netflix', 1549, 1799));
    expect(r.key).toBe('price_increase:Netflix:1549>1799');
    expect(r.kind).toBe('price-increase');
    expect(r.label).toBe('Netflix');
  });

  it('ignores every other opportunity kind and a price-increase missing its transition/date', () => {
    const rs = receiptsFromOpportunities([
      opportunity({ kind: 'unused-subscription' }),
      opportunity({ kind: 'insurance-reshop' }),
      opportunity({ kind: 'negotiable-bill' }),
      opportunity({ priceChangedAt: undefined }),
      opportunity({ priceFromCents: undefined }),
      opportunity({ priceToCents: undefined }),
    ]);
    expect(rs).toEqual([]);
  });

  it('a shifted DETECTION DATE does not re-mint (same transition = same key, critic #206 P2-2); a genuinely new hike keys distinctly', () => {
    const feb = receiptsFromOpportunities([opportunity()])[0];
    // Re-import churn moved the detected change date; the increase is the same.
    const dateShift = receiptsFromOpportunities([opportunity({ priceChangedAt: '2026-02-15' })])[0];
    expect(dateShift.key).toBe(feb.key);
    // A later second hike (17.99 → 20.49) — even with the SAME +$2.50 delta — is a new catch.
    const secondHike = receiptsFromOpportunities([
      opportunity({ priceFromCents: cents(1799), priceToCents: cents(2049), priceChangedAt: '2026-05-01' }),
    ])[0];
    expect(secondHike.key).toBe('price_increase:Netflix:1799>2049');
    expect(secondHike.key).not.toBe(feb.key);
  });
});

describe('summarizeReceipts — hand-verified counts + per-kind totals, nothing cross-kind', () => {
  const rows = [
    { kind: 'reminder-delivered', amountCents: 123456 },
    { kind: 'reminder-delivered', amountCents: 50000 },
    { kind: 'radar-catch', amountCents: 50000 },
    { kind: 'price-increase', amountCents: 250 },
    { kind: 'price-increase', amountCents: 1000 },
    { kind: 'someday-new-kind', amountCents: 999999 }, // unknown kinds are ignored
  ];
  const s = summarizeReceipts(rows);

  it('counts: 2 reminders + 1 radar + 2 price = 5 total (unknown kind excluded)', () => {
    expect(s.total).toBe(5);
    expect(s.remindersCount).toBe(2);
    expect(s.radarCount).toBe(1);
    expect(s.priceIncreaseCount).toBe(2);
  });

  it('per-kind totals: reminders 123456+50000=173456; price 250+1000=1250', () => {
    expect(s.remindersAmountCents).toBe(173456);
    expect(s.priceIncreaseMonthlyCents).toBe(1250);
  });

  it('the summary type has NO cross-kind dollar total (the honesty rule, structurally)', () => {
    // Counts may be summed (total: 5) but no field aggregates dollars across kinds —
    // reminder amounts are bills covered, price amounts are monthly deltas; adding
    // them would be a meaningless "we saved you $X" number.
    expect(Object.keys(s).sort()).toEqual([
      'priceIncreaseCount',
      'priceIncreaseMonthlyCents',
      'radarCount',
      'remindersAmountCents',
      'remindersCount',
      'total',
    ]);
  });

  it('empty rows → all-zero summary', () => {
    expect(summarizeReceipts([])).toEqual({
      total: 0,
      remindersCount: 0,
      remindersAmountCents: 0,
      radarCount: 0,
      priceIncreaseCount: 0,
      priceIncreaseMonthlyCents: 0,
    });
  });
});

describe('receiptLines — shared card/digest rendering, only kinds with a count', () => {
  it('all three kinds present → three lines with the hand-verified formatted amounts', () => {
    const lines = receiptLines(
      summarizeReceipts([
        { kind: 'reminder-delivered', amountCents: 173456 },
        { kind: 'radar-catch', amountCents: 50000 },
        { kind: 'price-increase', amountCents: 1250 },
      ]),
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('1 payment reminder delivered');
    expect(lines[0]).toContain('$1,734.56');
    expect(lines[1]).toContain('1 early warning');
    expect(lines[2]).toContain('1 quiet price increase');
    expect(lines[2]).toContain('$12.50/mo');
  });

  it('zero-count kinds render no line; plurals pluralize', () => {
    const lines = receiptLines(
      summarizeReceipts([
        { kind: 'price-increase', amountCents: 250 },
        { kind: 'price-increase', amountCents: 1000 },
      ]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('2 quiet price increases');
  });
});
