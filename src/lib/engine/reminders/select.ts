/**
 * Payment reminders (ROADMAP #6). Pure selection + email rendering over the
 * Cash-Needed Engine's per-card obligations — turns "what's due" into a reminder
 * list (in-app) and a plain-text email (the dormant notification mechanism). No
 * I/O. The cron route and dashboard both consume these so the reminder a user
 * SEES and the reminder we'd EMAIL can never disagree.
 *
 * Money is integer cents; dates are YYYY-MM-DD via dates.ts. Copy follows the
 * coaching guardrail: a non-shaming heads-up that explicitly states Pulse never
 * moves money for you.
 */
import { type Cents, formatCents } from '@/lib/money';
import { type ISODate, compareDates, daysBetween, formatISODate } from '@/lib/dates';
import type { CardObligation } from '@/lib/engine/cash-needed/types';

export type ReminderUrgency = 'today' | 'soon' | 'upcoming';

export interface PaymentReminder {
  cardId: string;
  cardName: string;
  /** Business-day-adjusted due date (funds must be present by this date). */
  dueDate: ISODate;
  daysUntil: number;
  urgency: ReminderUrgency;
  cashRequiredCents: Cents;
  userActionCents: Cents;
  /** Portion autopay will move automatically (0 = no autopay). */
  autopayCents: Cents;
  /** True when autopay covers the user's whole part — they only need funds present. */
  autopayCovered: boolean;
  isEstimated: boolean;
}

/** Stable dedup/dismiss key for a reminder (card + the date funds are needed). */
export function reminderKey(r: { cardId: string; dueDate: string }): string {
  return `${r.cardId}:${r.dueDate}`;
}

export interface SelectRemindersParams {
  obligations: readonly CardObligation[];
  today: ISODate;
  /** Only include payments due within this many days. Omit = the whole cycle. */
  withinDays?: number;
  /** reminderKey()s the user has dismissed. */
  dismissedKeys?: ReadonlySet<string>;
}

/**
 * Reminders for every card whose payment requires cash, due on/after today and
 * within the window, oldest first. Cards with nothing due (cashRequired 0) and
 * dismissed reminders are excluded.
 */
export function selectPaymentReminders(params: SelectRemindersParams): PaymentReminder[] {
  const { obligations, today, withinDays, dismissedKeys } = params;
  const out: PaymentReminder[] = [];
  // Dedup by reminderKey so an overlapping input list (e.g. a caller spreading
  // both the engine's `cards` and its `upcoming`, which is a subset) can never
  // surface the same payment twice.
  const seen = new Set<string>();
  for (const o of obligations) {
    if (o.cashRequiredCents <= 0) continue;
    const daysUntil = daysBetween(today, o.effectiveDueDate);
    if (daysUntil < 0) continue; // the engine clamps a passed date to today; defensive
    if (withinDays !== undefined && daysUntil > withinDays) continue;
    const key = reminderKey({ cardId: o.cardId, dueDate: o.effectiveDueDate });
    if (dismissedKeys?.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const urgency: ReminderUrgency = daysUntil === 0 ? 'today' : daysUntil <= 3 ? 'soon' : 'upcoming';
    out.push({
      cardId: o.cardId,
      cardName: o.cardName,
      dueDate: o.effectiveDueDate,
      daysUntil,
      urgency,
      cashRequiredCents: o.cashRequiredCents,
      userActionCents: o.userActionCents,
      autopayCents: o.autopayCents,
      autopayCovered: o.userActionCents === 0 && o.autopayCents > 0,
      isEstimated: o.isEstimated,
    });
  }
  return out.sort(
    (a, b) => compareDates(a.dueDate, b.dueDate) || a.cardName.localeCompare(b.cardName),
  );
}

export interface ReminderEmail {
  subject: string;
  text: string;
}

/** Plain-text reminder email, or null when there is nothing to remind about. */
export function buildReminderEmail(
  reminders: readonly PaymentReminder[],
  today: ISODate,
): ReminderEmail | null {
  if (reminders.length === 0) return null;
  const n = reminders.length;
  const subject = `Pulse: ${n} card payment${n === 1 ? '' : 's'} coming up`;

  const lines = reminders.map((r) => {
    const when = r.daysUntil === 0 ? 'today' : r.daysUntil === 1 ? 'tomorrow' : `in ${r.daysUntil} days`;
    let how: string;
    if (r.autopayCovered) {
      how = `autopay will handle it — just keep the funds in your account`;
    } else if (r.autopayCents > 0) {
      // Partial autopay (top-up): disclose both portions so the headline amount isn't misread.
      how = `autopay covers ${formatCents(r.autopayCents)}; you'll pay the remaining ${formatCents(r.userActionCents)} yourself`;
    } else {
      how = `you'll pay ${formatCents(r.userActionCents)} yourself`;
    }
    return `• ${r.cardName}: ${formatCents(r.cashRequiredCents)} due ${formatISODate(r.dueDate, 'long')} (${when})${r.isEstimated ? ' [estimated]' : ''} — ${how}`;
  });

  const text = [
    `Here's what's coming up on your cards as of ${formatISODate(today, 'long')}:`,
    '',
    ...lines,
    '',
    `A heads-up so nothing catches you by surprise. Pulse never moves money for you — this is just a reminder.`,
  ].join('\n');

  return { subject, text };
}
