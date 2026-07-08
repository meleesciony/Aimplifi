/**
 * Smart Notification Engine (Gap 2 §2) — known-answer tests for the pure selection.
 * Fixtures are hand-built PaymentReminders + a RadarResult, so these are independent
 * of the seed. today = 2026-06-10 throughout.
 *
 * The engine's contract: materiality = actionability + urgency (no dollar floor),
 * dedup via sentKeys, most-urgent-first ordering, and every amount copied verbatim
 * from the source (never computed here).
 */
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import type { PaymentReminder } from '@/lib/engine/reminders/select';
import type { RadarResult } from '@/lib/engine/radar/radar';
import {
  NOTIFY_DUE_WINDOW_DAYS,
  paymentNotificationKey,
  radarNotificationKey,
  selectNotifications,
} from '@/lib/engine/notify/select';

const TODAY = isoDate('2026-06-10');

function reminder(p: {
  accountId: string;
  accountName: string;
  dueDate: string;
  daysUntil: number;
  userActionCents?: number;
  autopayCents?: number;
  cashRequiredCents?: number;
  isEstimated?: boolean;
  obligationType?: 'card' | 'loan';
}): PaymentReminder {
  const userAction = p.userActionCents ?? 5000;
  return {
    accountId: p.accountId,
    accountName: p.accountName,
    obligationType: p.obligationType ?? 'card',
    dueDate: isoDate(p.dueDate),
    daysUntil: p.daysUntil,
    urgency: p.daysUntil === 0 ? 'today' : p.daysUntil <= 3 ? 'soon' : 'upcoming',
    cashRequiredCents: cents(p.cashRequiredCents ?? userAction),
    userActionCents: cents(userAction),
    autopayCents: cents(p.autopayCents ?? 0),
    autopayCovered: userAction === 0 && (p.autopayCents ?? 0) > 0,
    isEstimated: p.isEstimated ?? false,
  };
}

function radar(p: Partial<RadarResult> & { pushWorthy: boolean }): RadarResult {
  return {
    today: TODAY,
    horizonDays: 90,
    status: p.status ?? (p.pushWorthy ? 'alert' : 'ok'),
    committed: p.committed ?? {
      firstNegativeDate: p.pushWorthy ? isoDate('2026-06-14') : null,
      lowestDate: isoDate('2026-06-14'),
      lowestCents: p.pushWorthy ? -30000 : 100000,
      endingCents: 50000,
    },
    daysUntilFirstNegative: p.daysUntilFirstNegative ?? (p.pushWorthy ? 4 : null),
    pushWorthy: p.pushWorthy,
    collidingCards: p.collidingCards ?? [
      { cardId: 'c1', cardName: 'Sapphire', dueDate: isoDate('2026-06-12'), amountCents: cents(70000), isEstimated: false },
    ],
    dipEvents: p.dipEvents ?? [],
    // `in` check so an explicit `coverTransfer: null` is honored (null is nullish, so ?? wouldn't).
    coverTransfer:
      'coverTransfer' in p
        ? p.coverTransfer ?? null
        : { amountCents: cents(30000), byDate: isoDate('2026-06-13'), sources: [] },
    burn: p.burn ?? null,
    includesEstimatedDues: p.includesEstimatedDues ?? false,
    assumptions: p.assumptions ?? [],
  };
}

describe('selectNotifications — payment reminders (materiality)', () => {
  it('surfaces an actionable payment due within the window', () => {
    const out = selectNotifications({
      reminders: [reminder({ accountId: 'a1', accountName: 'Freedom', dueDate: '2026-06-12', daysUntil: 2, userActionCents: 45000 })],
      radar: null,
      today: TODAY,
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('payment_due');
    expect(out[0].key).toBe('payment_due:a1:2026-06-12');
    expect(out[0].level).toBe('warning');
    expect(out[0].amountCents).toBe(45000);
    expect(out[0].url).toBe('/accounts');
    expect(out[0].body).toContain('$450.00');
    expect(out[0].body).toContain('never moves money');
  });

  it('due today is critical', () => {
    const out = selectNotifications({
      reminders: [reminder({ accountId: 'a1', accountName: 'Freedom', dueDate: '2026-06-10', daysUntil: 0 })],
      radar: null,
      today: TODAY,
    });
    expect(out[0].level).toBe('critical');
    expect(out[0].title).toContain('today');
  });

  it('surfaces a PARTIAL-autopay payment where the user must still fund a remainder', () => {
    // autopay covers part, but userActionCents > 0 → there IS something to do → push.
    const out = selectNotifications({
      reminders: [
        reminder({ accountId: 'a1', accountName: 'Sapphire', dueDate: '2026-06-12', daysUntil: 2, userActionCents: 20000, autopayCents: 50000 }),
      ],
      radar: null,
      today: TODAY,
    });
    expect(out).toHaveLength(1);
    expect(out[0].amountCents).toBe(20000); // the user-action remainder, not the full bill
    expect(out[0].body).toContain('$200.00');
  });

  it('suppresses an autopay-covered payment (nothing for the user to do)', () => {
    const out = selectNotifications({
      reminders: [reminder({ accountId: 'a1', accountName: 'Platinum', dueDate: '2026-06-11', daysUntil: 1, userActionCents: 0, autopayCents: 90000 })],
      radar: null,
      today: TODAY,
    });
    expect(out).toHaveLength(0);
  });

  it('suppresses an upcoming payment beyond the push window', () => {
    expect(NOTIFY_DUE_WINDOW_DAYS).toBe(3);
    const out = selectNotifications({
      reminders: [reminder({ accountId: 'a1', accountName: 'Freedom', dueDate: '2026-06-15', daysUntil: 5, userActionCents: 45000 })],
      radar: null,
      today: TODAY,
    });
    expect(out).toHaveLength(0);
  });

  it('excludes a payment already delivered (dedup via sentKeys)', () => {
    const key = paymentNotificationKey({ accountId: 'a1', dueDate: '2026-06-12' });
    const out = selectNotifications({
      reminders: [reminder({ accountId: 'a1', accountName: 'Freedom', dueDate: '2026-06-12', daysUntil: 2 })],
      radar: null,
      today: TODAY,
      sentKeys: new Set([key]),
    });
    expect(out).toHaveLength(0);
  });

  it('marks an estimated payment in copy and flag', () => {
    const out = selectNotifications({
      reminders: [reminder({ accountId: 'a1', accountName: 'Store Card', dueDate: '2026-06-12', daysUntil: 2, isEstimated: true })],
      radar: null,
      today: TODAY,
    });
    expect(out[0].isEstimated).toBe(true);
    expect(out[0].body).toContain('estimated');
  });
});

describe('selectNotifications — cash flow radar (pushWorthy gate)', () => {
  it('surfaces a pushWorthy committed dip with the colliding card + cover', () => {
    const out = selectNotifications({ reminders: [], radar: radar({ pushWorthy: true }), today: TODAY });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('cash_flow_alert');
    expect(out[0].key).toBe('cash_flow_alert:2026-06-14');
    expect(out[0].amountCents).toBe(30000); // coverTransfer amount, verbatim
    expect(out[0].body).toContain('Sapphire');
    expect(out[0].body).toContain('$300.00');
    expect(out[0].url).toBe('/dashboard');
  });

  it('critical when the dip is within a day', () => {
    const out = selectNotifications({
      reminders: [],
      radar: radar({ pushWorthy: true, daysUntilFirstNegative: 1, committed: { firstNegativeDate: isoDate('2026-06-11'), lowestDate: isoDate('2026-06-11'), lowestCents: -5000, endingCents: 1000 } }),
      today: TODAY,
    });
    expect(out[0].level).toBe('critical');
  });

  it('does NOT surface a radar that is not pushWorthy (dip too far out)', () => {
    // Mirrors the seed demo: the radar alert is 14 days out → pushWorthy false.
    const out = selectNotifications({ reminders: [], radar: radar({ pushWorthy: false }), today: TODAY });
    expect(out).toHaveLength(0);
  });

  it('handles a pushWorthy dip with no cover proposal (amount 0, no crash)', () => {
    const out = selectNotifications({
      reminders: [],
      radar: radar({ pushWorthy: true, coverTransfer: null }),
      today: TODAY,
    });
    expect(out).toHaveLength(1);
    expect(out[0].amountCents).toBe(0);
  });

  it('excludes a radar alert already delivered (dedup)', () => {
    const out = selectNotifications({
      reminders: [],
      radar: radar({ pushWorthy: true }),
      today: TODAY,
      sentKeys: new Set([radarNotificationKey('2026-06-14')]),
    });
    expect(out).toHaveLength(0);
  });

  it('null radar contributes nothing', () => {
    const out = selectNotifications({ reminders: [], radar: null, today: TODAY });
    expect(out).toHaveLength(0);
  });

  it('suppresses a pushWorthy radar alert while on the re-alert cooldown (wobble guard)', () => {
    const out = selectNotifications({
      reminders: [],
      radar: radar({ pushWorthy: true }),
      today: TODAY,
      radarAlertOnCooldown: true,
    });
    expect(out).toHaveLength(0);
    // Payment reminders are unaffected by the radar cooldown.
    const withPayment = selectNotifications({
      reminders: [reminder({ accountId: 'a1', accountName: 'Freedom', dueDate: '2026-06-12', daysUntil: 2 })],
      radar: radar({ pushWorthy: true }),
      today: TODAY,
      radarAlertOnCooldown: true,
    });
    expect(withPayment.map((n) => n.kind)).toEqual(['payment_due']);
  });
});

describe('selectNotifications — ordering', () => {
  it('critical before warning, then earliest date', () => {
    const out = selectNotifications({
      reminders: [
        reminder({ accountId: 'a1', accountName: 'Freedom', dueDate: '2026-06-13', daysUntil: 3 }), // warning
        reminder({ accountId: 'a2', accountName: 'Amex', dueDate: '2026-06-10', daysUntil: 0 }), // critical
      ],
      radar: radar({ pushWorthy: true, daysUntilFirstNegative: 4 }), // warning, dip 06-14
      today: TODAY,
    });
    expect(out.map((n) => n.key)).toEqual([
      'payment_due:a2:2026-06-10', // critical first
      'payment_due:a1:2026-06-13', // warning, 06-13 before 06-14
      'cash_flow_alert:2026-06-14',
    ]);
  });
});
