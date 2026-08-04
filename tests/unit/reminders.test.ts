/**
 * Payment reminders (ROADMAP #6) — known-answer tests for the pure selection +
 * email rendering. Obligation fixtures are hand-built CardObligations (the shape
 * the Cash-Needed Engine emits), so these tests are independent of the seed.
 *
 * today = 2026-06-10 throughout; daysUntil are exact (civil-day arithmetic).
 */
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import type { CardObligation } from '@/lib/engine/cash-needed/types';
import type { LoanObligation } from '@/lib/engine/loans/obligations';
import {
  buildReminderEmail,
  reminderKey,
  selectPaymentReminders,
} from '@/lib/engine/reminders/select';

function loanOb(p: {
  accountId: string;
  accountName: string;
  effectiveDueDate: string;
  paymentCents: number;
  accountType?: 'LOAN' | 'MORTGAGE';
  dueDate?: string;
  frozenSince?: string | null;
}): LoanObligation {
  return {
    accountId: p.accountId,
    accountName: p.accountName,
    accountType: p.accountType ?? 'LOAN',
    dueDate: isoDate(p.dueDate ?? p.effectiveDueDate),
    effectiveDueDate: isoDate(p.effectiveDueDate),
    paymentCents: cents(p.paymentCents),
    isEstimated: false,
    frozenSince: p.frozenSince ?? null,
  };
}

function ob(p: {
  cardId: string;
  cardName: string;
  effectiveDueDate: string;
  dueDate?: string;
  cashRequiredCents?: number;
  autopayCents?: number;
  userActionCents?: number;
  remainingDueCents?: number;
  minimumDueCents?: number;
  isEstimated?: boolean;
  notes?: string[];
  frozenSince?: string | null;
  isManual?: boolean;
}): CardObligation {
  return {
    cardId: p.cardId,
    cardName: p.cardName,
    dueDate: isoDate(p.dueDate ?? p.effectiveDueDate),
    effectiveDueDate: isoDate(p.effectiveDueDate),
    cashRequiredCents: cents(p.cashRequiredCents ?? 0),
    autopayCents: cents(p.autopayCents ?? 0),
    userActionCents: cents(p.userActionCents ?? 0),
    remainingDueCents: cents(p.remainingDueCents ?? 0),
    minimumDueCents: cents(p.minimumDueCents ?? 0),
    isEstimated: p.isEstimated ?? false,
    notes: p.notes ?? [],
    frozenSince: p.frozenSince ?? null,
    isManual: p.isManual ?? false,
  };
}

const today = isoDate('2026-06-10');

const obligations: CardObligation[] = [
  ob({ cardId: 'sapphire', cardName: 'Sapphire', effectiveDueDate: '2026-06-10', cashRequiredCents: 100000, userActionCents: 100000 }), // today
  ob({ cardId: 'platinum', cardName: 'Platinum', effectiveDueDate: '2026-06-12', cashRequiredCents: 50000, autopayCents: 50000, userActionCents: 0 }), // soon, autopay
  ob({ cardId: 'store', cardName: 'Store', effectiveDueDate: '2026-06-20', cashRequiredCents: 30000, userActionCents: 30000, isEstimated: true }), // upcoming, est
  ob({ cardId: 'freedom', cardName: 'Freedom', effectiveDueDate: '2026-06-26', cashRequiredCents: 60000, userActionCents: 60000 }), // upcoming
  ob({ cardId: 'paid', cardName: 'PaidOff', effectiveDueDate: '2026-06-15', cashRequiredCents: 0 }), // nothing due → excluded
];

describe('selectPaymentReminders', () => {
  it('selects every due card across the cycle, oldest first, with correct urgency + flags', () => {
    const r = selectPaymentReminders({ obligations, today });
    expect(r.map((x) => x.accountId)).toEqual(['sapphire', 'platinum', 'store', 'freedom']); // $0 PaidOff excluded
    expect(r.map((x) => x.daysUntil)).toEqual([0, 2, 10, 16]);
    expect(r.map((x) => x.urgency)).toEqual(['today', 'soon', 'upcoming', 'upcoming']);
    expect(r[1].autopayCovered).toBe(true); // Platinum: userAction 0 + autopay > 0
    expect(r[0].autopayCovered).toBe(false); // Sapphire: user must act
    expect(r[2].isEstimated).toBe(true); // Store
  });

  it('honors the withinDays window (imminent only)', () => {
    const r = selectPaymentReminders({ obligations, today, withinDays: 3 });
    expect(r.map((x) => x.accountId)).toEqual(['sapphire', 'platinum']); // 0 and 2 days only
  });

  it('excludes dismissed reminders by key', () => {
    const dismissed = new Set([reminderKey({ accountId: 'sapphire', dueDate: '2026-06-10' })]);
    const r = selectPaymentReminders({ obligations, today, dismissedKeys: dismissed });
    expect(r.find((x) => x.accountId === 'sapphire')).toBeUndefined();
    expect(r).toHaveLength(3);
  });

  it('returns nothing when no card needs cash', () => {
    const r = selectPaymentReminders({ obligations: [obligations[4]], today });
    expect(r).toHaveLength(0);
  });

  it('dedups an overlapping input (cards + a subset) so no card appears twice', () => {
    // Mirrors the engine's result.cards (complete) + result.upcoming (a subset):
    // the estimated Store card appears in both, but must surface ONCE.
    const store = obligations[2];
    const r = selectPaymentReminders({ obligations: [...obligations, store], today });
    expect(r.map((x) => x.accountId)).toEqual(['sapphire', 'platinum', 'store', 'freedom']);
    expect(r.filter((x) => x.accountId === 'store')).toHaveLength(1);
  });

  it('marks the soon boundary at exactly 3 days and upcoming at 4', () => {
    const c3 = ob({ cardId: 'c3', cardName: 'C3', effectiveDueDate: '2026-06-13', cashRequiredCents: 2000, userActionCents: 2000 });
    const c4 = ob({ cardId: 'c4', cardName: 'C4', effectiveDueDate: '2026-06-14', cashRequiredCents: 3000, userActionCents: 3000 });
    const r = selectPaymentReminders({ obligations: [c3, c4], today });
    expect(r.map((x) => [x.accountId, x.daysUntil, x.urgency])).toEqual([
      ['c3', 3, 'soon'],
      ['c4', 4, 'upcoming'],
    ]);
  });
});

describe('selectPaymentReminders — loans (#134)', () => {
  it('surfaces a loan payment as a loan-typed reminder, whole amount user-owed (no autopay)', () => {
    const loans = [loanOb({ accountId: 'auto', accountName: 'Auto Loan', effectiveDueDate: '2026-06-18', paymentCents: 38500 })];
    const r = selectPaymentReminders({ obligations: [], loanObligations: loans, today });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      accountId: 'auto',
      accountName: 'Auto Loan',
      obligationType: 'loan',
      cashRequiredCents: 38500,
      userActionCents: 38500,
      autopayCents: 0,
      autopayCovered: false,
      daysUntil: 8,
      urgency: 'upcoming',
      isEstimated: false,
    });
  });

  it('merges cards and loans into one list sorted by due date, then name', () => {
    const loans = [loanOb({ accountId: 'auto', accountName: 'Auto Loan', effectiveDueDate: '2026-06-12', paymentCents: 38500 })];
    const r = selectPaymentReminders({ obligations, loanObligations: loans, today });
    // 06-12 has both Auto Loan (loan) and Platinum (card) → name tiebreak puts Auto Loan first.
    expect(r.map((x) => [x.accountId, x.obligationType])).toEqual([
      ['sapphire', 'card'],
      ['auto', 'loan'],
      ['platinum', 'card'],
      ['store', 'card'],
      ['freedom', 'card'],
    ]);
  });

  it('honors the withinDays window for loans too', () => {
    const loans = [loanOb({ accountId: 'auto', accountName: 'Auto Loan', effectiveDueDate: '2026-06-30', paymentCents: 38500 })];
    const r = selectPaymentReminders({ obligations: [], loanObligations: loans, today, withinDays: 5 });
    expect(r).toHaveLength(0); // 20 days out — outside the imminent window
  });

  it('renders a loan line and a generalized (card-or-loan) email subject', () => {
    const loans = [loanOb({ accountId: 'auto', accountName: 'Auto Loan', effectiveDueDate: '2026-06-14', paymentCents: 38500 })];
    const r = selectPaymentReminders({ obligations: [obligations[0]], loanObligations: loans, today });
    const email = buildReminderEmail(r, today);
    expect(email!.subject).toBe('Aimplifi: 2 payments coming up');
    expect(email!.text).toContain('Auto Loan: $385.00 due');
    expect(email!.text).toContain("you'll pay $385.00 yourself");
  });
});

describe('buildReminderEmail', () => {
  it('renders a non-shaming, money-safe summary with per-card lines', () => {
    const reminders = selectPaymentReminders({ obligations, today });
    const email = buildReminderEmail(reminders, today);
    expect(email).not.toBeNull();
    expect(email!.subject).toBe('Aimplifi: 4 payments coming up');
    expect(email!.text).toContain('Sapphire: $1,000.00 due');
    expect(email!.text).toContain('(today)');
    expect(email!.text).toContain('autopay will handle it'); // Platinum line
    expect(email!.text).toContain("you'll pay $600.00 yourself"); // Freedom line
    expect(email!.text).toContain('[estimated]'); // Store line
    expect(email!.text).toContain('Aimplifi never moves money for you'); // guardrail
  });

  it('singularizes the subject for one reminder', () => {
    const email = buildReminderEmail(
      selectPaymentReminders({ obligations: [obligations[0]], today }),
      today,
    );
    expect(email!.subject).toBe('Aimplifi: 1 payment coming up');
  });

  it('discloses BOTH portions for a partial-autopay (top-up) card', () => {
    // autopay covers part (MINIMUM/FIXED), user pays the rest under PAY_IN_FULL.
    const topup = ob({ cardId: 'amex', cardName: 'Amex', effectiveDueDate: '2026-06-14', cashRequiredCents: 210000, autopayCents: 3500, userActionCents: 206500 });
    const r = selectPaymentReminders({ obligations: [topup], today });
    expect(r[0].autopayCovered).toBe(false);
    expect(r[0].autopayCents).toBe(3500);
    const email = buildReminderEmail(r, today);
    expect(email!.text).toContain("autopay covers $35.00; you'll pay the remaining $2,065.00 yourself");
  });

  it('phrases tomorrow (daysUntil 1) and includes the year (long date)', () => {
    const c1 = ob({ cardId: 'c1', cardName: 'C1', effectiveDueDate: '2026-06-11', cashRequiredCents: 1000, userActionCents: 1000 });
    const email = buildReminderEmail(selectPaymentReminders({ obligations: [c1], today }), today);
    expect(email!.text).toContain('(tomorrow)');
    expect(email!.text).toContain('2026'); // long date disambiguates a standalone email
  });

  it('returns null when there is nothing to remind about', () => {
    expect(buildReminderEmail([], today)).toBeNull();
  });
});
