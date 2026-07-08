/**
 * Weekly digest builder (Gap 2 §3) — known-answer tests for the pure composition.
 * Fixtures are a hand-built MoneyReview + PaymentReminders, so these are seed-
 * independent. today = 2026-06-10. Every figure is copied verbatim from the source;
 * the digest reconciles with /coach (review) and the reminder surface (dues) by reusing
 * the same objects and the shared `reminderLine`.
 */
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import type { MoneyReview } from '@/lib/engine/fi/coach-copy';
import { type PaymentReminder, reminderLine } from '@/lib/engine/reminders/select';
import { buildWeeklyDigest } from '@/lib/engine/digest/build';

const TODAY = isoDate('2026-06-10');

const REVIEW: MoneyReview = {
  month: '2026-05',
  improvement: 'Your savings rate improved from 18% to 32% in May 2026.',
  creep: 'What held steady: discretionary spending is flat.',
  nextAction: 'One next action: move $500.00 to checking by Jun 15 so every card clears in full.',
};

function reminder(p: {
  accountId: string;
  accountName: string;
  dueDate: string;
  daysUntil: number;
  userActionCents?: number;
  autopayCents?: number;
  isEstimated?: boolean;
}): PaymentReminder {
  const userAction = p.userActionCents ?? 45000;
  return {
    accountId: p.accountId,
    accountName: p.accountName,
    obligationType: 'card',
    dueDate: isoDate(p.dueDate),
    daysUntil: p.daysUntil,
    urgency: p.daysUntil === 0 ? 'today' : p.daysUntil <= 3 ? 'soon' : 'upcoming',
    cashRequiredCents: cents(userAction),
    userActionCents: cents(userAction),
    autopayCents: cents(p.autopayCents ?? 0),
    autopayCovered: userAction === 0 && (p.autopayCents ?? 0) > 0,
    isEstimated: p.isEstimated ?? false,
  };
}

describe('buildWeeklyDigest', () => {
  it('composes the review + dues verbatim, reusing the shared reminder line', () => {
    const dues = [reminder({ accountId: 'a1', accountName: 'Sapphire', dueDate: '2026-06-15', daysUntil: 5 })];
    const digest = buildWeeklyDigest({ review: REVIEW, reminders: dues, today: TODAY });
    expect(digest).not.toBeNull();
    expect(digest!.subject).toBe('Your week with Aimplifi');
    // Review lines copied verbatim (no recomputation).
    expect(digest!.text).toContain(REVIEW.improvement);
    expect(digest!.text).toContain(REVIEW.creep);
    expect(digest!.text).toContain(REVIEW.nextAction);
    // The due renders through the SHARED reminderLine (identical to the reminder email).
    expect(digest!.text).toContain(reminderLine(dues[0]));
    expect(digest!.text).toContain('Coming up in the next 7 days:');
    expect(digest!.text).toContain('never moves your money');
  });

  it('shows a clear-week line when nothing is due', () => {
    const digest = buildWeeklyDigest({ review: REVIEW, reminders: [], today: TODAY });
    expect(digest!.text).toContain('Nothing due in the next 7 days');
    expect(digest!.text).not.toContain('•');
  });

  it('still sends with dues even when there is no review', () => {
    const dues = [reminder({ accountId: 'a1', accountName: 'Freedom', dueDate: '2026-06-12', daysUntil: 2 })];
    const digest = buildWeeklyDigest({ review: null, reminders: dues, today: TODAY });
    expect(digest).not.toBeNull();
    expect(digest!.text).toContain('Freedom');
    // No review → no improvement/creep lines.
    expect(digest!.text).not.toContain('savings rate');
  });

  it('returns null when there is genuinely nothing to say', () => {
    expect(buildWeeklyDigest({ review: null, reminders: [], today: TODAY })).toBeNull();
  });

  it('marks an estimated due', () => {
    const dues = [reminder({ accountId: 'a1', accountName: 'Store Card', dueDate: '2026-06-14', daysUntil: 4, isEstimated: true })];
    const digest = buildWeeklyDigest({ review: REVIEW, reminders: dues, today: TODAY });
    expect(digest!.text).toContain('[estimated]');
  });
});
