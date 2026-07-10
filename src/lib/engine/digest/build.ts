/**
 * Weekly digest email (Competitive-Gap plan Gap 2 §3) — the cheapest retention win:
 * bring the user back without a new surface. PURE, no I/O. It COMPOSES two
 * already-computed, already-tested pieces and renders them as plain text:
 *
 *   1. The Monthly Money Review (`generateMoneyReview` → the same object /coach shows):
 *      what improved, what crept, and the single next action. Copied verbatim — the
 *      digest never recomputes a number, so it can't disagree with /coach.
 *   2. The upcoming week's payment dues (`selectPaymentReminders` within 7 days),
 *      rendered by the SHARED `reminderLine` so a due reads identically to the
 *      reminder email and the in-app card.
 *
 * All wrapper copy lives in COACH_COPY (guardrail-scanned by coach-copy.test.ts).
 * Returns null only when there is genuinely nothing to say (no review AND no dues) —
 * a brand-new user with no history and nothing due gets no digest.
 */
import { type ISODate, formatISODate } from '@/lib/dates';
import { COACH_COPY, type MoneyReview } from '@/lib/engine/fi/coach-copy';
import { type PaymentReminder, reminderLine } from '@/lib/engine/reminders/select';
import { receiptLines, type ValueReceiptsSummary } from '@/lib/engine/receipts/receipts';

export interface WeeklyDigest {
  subject: string;
  text: string;
}

export function buildWeeklyDigest(input: {
  review: MoneyReview | null;
  reminders: readonly PaymentReminder[];
  today: ISODate;
  /**
   * Cumulative value-receipts tally (TASKS 1.3), rendered via the SAME receiptLines
   * the /coach card uses. Optional and never a send trigger: a digest with no review
   * and nothing due stays null — a running tally alone isn't news.
   */
  receipts?: ValueReceiptsSummary | null;
}): WeeklyDigest | null {
  const { review, reminders, today, receipts } = input;
  if (!review && reminders.length === 0) return null;

  const parts: string[] = [COACH_COPY.digestIntro(formatISODate(today, 'long')), ''];

  if (review) {
    parts.push(review.improvement, review.creep, '', review.nextAction, '');
  }

  if (receipts && receipts.total > 0) {
    parts.push(COACH_COPY.digestCaughtHeader(), ...receiptLines(receipts).map((l) => `• ${l}`), '');
  }

  parts.push(COACH_COPY.digestPaymentsHeader());
  if (reminders.length === 0) {
    parts.push(COACH_COPY.digestNothingDue());
  } else {
    for (const r of reminders) parts.push(reminderLine(r));
  }

  parts.push('', COACH_COPY.digestOutro());

  return { subject: COACH_COPY.digestSubject(), text: parts.join('\n') };
}
