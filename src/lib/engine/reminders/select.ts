/**
 * Payment reminders (ROADMAP #6, extended #134). Pure selection + email rendering
 * over the Cash-Needed Engine's per-card obligations AND the loan-obligation engine's
 * LOAN/MORTGAGE payments — turns "what's due" into a reminder list (in-app) and a
 * plain-text email (the dormant notification mechanism). No I/O. The cron route and
 * dashboard both consume these so the reminder a user SEES and the reminder we'd EMAIL
 * can never disagree.
 *
 * Money is integer cents; dates are YYYY-MM-DD via dates.ts. Copy follows the coaching
 * guardrail: a non-shaming heads-up that explicitly states Aimplifi never moves money.
 */
import { type Cents, cents, formatCents } from '@/lib/money';
import { type ISODate, compareDates, daysBetween, formatISODate } from '@/lib/dates';
import type { CardObligation } from '@/lib/engine/cash-needed/types';
import type { LoanObligation } from '@/lib/engine/loans/obligations';
import {
  type CardDuplicatePairInput,
  cardDuplicateEmailLines,
} from '@/lib/engine/account/card-duplicate-view';
import { frozenDuesEmailLines } from '@/lib/engine/account/feed-dropped-view';

export type ReminderUrgency = 'today' | 'soon' | 'upcoming';
export type ObligationType = 'card' | 'loan';

export interface PaymentReminder {
  /** The card or loan account this payment is for. */
  accountId: string;
  accountName: string;
  obligationType: ObligationType;
  /** Business-day-adjusted due date (funds must be present by this date). */
  dueDate: ISODate;
  daysUntil: number;
  urgency: ReminderUrgency;
  cashRequiredCents: Cents;
  userActionCents: Cents;
  /** Portion autopay will move automatically (0 = no autopay; always 0 for a loan). */
  autopayCents: Cents;
  /** True when autopay covers the user's whole part — they only need funds present. */
  autopayCovered: boolean;
  isEstimated: boolean;
  /**
   * YYYY-MM-DD the bank stopped sharing this card/loan, else null (TASKS L.18). Carried verbatim
   * from the obligation so the reminder email, the weekly digest and web push can each qualify the
   * amount in their own words — none of them reads the cash-needed engine's `assumptions`, and a
   * per-surface re-query would be a second source of truth for the same fact.
   *
   * REQUIRED: a reminder that silently loses the flag is a payment instruction with the one caveat
   * that matters stripped off it.
   */
  frozenSince: string | null;
}

/** Stable dedup/dismiss key for a reminder (account + the date funds are needed). */
export function reminderKey(r: { accountId: string; dueDate: string }): string {
  return `${r.accountId}:${r.dueDate}`;
}

export interface SelectRemindersParams {
  obligations: readonly CardObligation[];
  /** LOAN/MORTGAGE payments (#134) — surfaced alongside cards, never in the cash headline. */
  loanObligations?: readonly LoanObligation[];
  today: ISODate;
  /** Only include payments due within this many days. Omit = the whole cycle. */
  withinDays?: number;
  /** reminderKey()s the user has dismissed. */
  dismissedKeys?: ReadonlySet<string>;
}

interface NormalizedObligation {
  accountId: string;
  accountName: string;
  obligationType: ObligationType;
  effectiveDueDate: ISODate;
  cashRequiredCents: Cents;
  userActionCents: Cents;
  autopayCents: Cents;
  isEstimated: boolean;
  frozenSince: string | null;
}

/**
 * Reminders for every card/loan whose payment requires cash, due on/after today and
 * within the window, oldest first. Obligations with nothing due (cashRequired 0) and
 * dismissed reminders are excluded. A loan carries no autopay, so its whole amount is
 * the user's to fund.
 */
export function selectPaymentReminders(params: SelectRemindersParams): PaymentReminder[] {
  const { obligations, loanObligations, today, withinDays, dismissedKeys } = params;

  const normalized: NormalizedObligation[] = [
    ...obligations.map(
      (o): NormalizedObligation => ({
        accountId: o.cardId,
        accountName: o.cardName,
        obligationType: 'card',
        effectiveDueDate: o.effectiveDueDate,
        cashRequiredCents: o.cashRequiredCents,
        userActionCents: o.userActionCents,
        autopayCents: o.autopayCents,
        isEstimated: o.isEstimated,
        frozenSince: o.frozenSince,
      }),
    ),
    ...(loanObligations ?? []).map(
      (o): NormalizedObligation => ({
        accountId: o.accountId,
        accountName: o.accountName,
        obligationType: 'loan',
        effectiveDueDate: o.effectiveDueDate,
        cashRequiredCents: o.paymentCents,
        userActionCents: o.paymentCents, // no loan-autopay model → the whole payment is the user's
        autopayCents: cents(0),
        isEstimated: o.isEstimated,
        frozenSince: o.frozenSince,
      }),
    ),
  ];

  const out: PaymentReminder[] = [];
  // Dedup by reminderKey so an overlapping input list (e.g. a caller spreading both the
  // engine's `cards` and its `upcoming`, which is a subset) can never surface twice.
  const seen = new Set<string>();
  for (const o of normalized) {
    if (o.cashRequiredCents <= 0) continue;
    const daysUntil = daysBetween(today, o.effectiveDueDate);
    if (daysUntil < 0) continue; // the engine clamps a passed date to today; defensive
    if (withinDays !== undefined && daysUntil > withinDays) continue;
    const key = reminderKey({ accountId: o.accountId, dueDate: o.effectiveDueDate });
    if (dismissedKeys?.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const urgency: ReminderUrgency = daysUntil === 0 ? 'today' : daysUntil <= 3 ? 'soon' : 'upcoming';
    out.push({
      accountId: o.accountId,
      accountName: o.accountName,
      obligationType: o.obligationType,
      dueDate: o.effectiveDueDate,
      daysUntil,
      urgency,
      cashRequiredCents: o.cashRequiredCents,
      userActionCents: o.userActionCents,
      autopayCents: o.autopayCents,
      autopayCovered: o.userActionCents === 0 && o.autopayCents > 0,
      isEstimated: o.isEstimated,
      frozenSince: o.frozenSince,
    });
  }
  return out.sort(
    (a, b) => compareDates(a.dueDate, b.dueDate) || a.accountName.localeCompare(b.accountName),
  );
}

/**
 * "today" / "tomorrow" / "in N days" — exported so the joint household digest's
 * partner-owned line (TASKS 4.2 slice 7) phrases the SAME due identically to
 * `reminderLine` without copying the expression and letting the two drift.
 */
export function reminderWhen(daysUntil: number): string {
  return daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
}

/**
 * One plain-text bullet for a reminder, with autopay disclosure. Shared by the
 * reminder email and the weekly digest (Gap 2 §3) so both render a due identically.
 *
 * SECOND PERSON BY CONSTRUCTION ("you'll pay … yourself") — it may only render a
 * due on an account the RECIPIENT owns. A partner's shared card in the joint
 * digest goes through `HOUSEHOLD_COPY.digestPartnerDue` instead (slice-7 critic
 * F1): telling a household member they will personally pay their partner's card
 * is a false money claim, and invites a double payment.
 */
export function reminderLine(r: PaymentReminder): string {
  const when = reminderWhen(r.daysUntil);
  let how: string;
  if (r.autopayCovered) {
    how = `autopay will handle it — just keep the funds in your account`;
  } else if (r.autopayCents > 0) {
    // Partial autopay (top-up): disclose both portions so the headline amount isn't misread.
    how = `autopay covers ${formatCents(r.autopayCents)}; you'll pay the remaining ${formatCents(r.userActionCents)} yourself`;
  } else {
    how = `you'll pay ${formatCents(r.userActionCents)} yourself`;
  }
  return `• ${r.accountName}: ${formatCents(r.cashRequiredCents)} due ${formatISODate(r.dueDate, 'long')} (${when})${r.isEstimated ? ' [estimated]' : ''} — ${how}`;
}

export interface ReminderEmail {
  subject: string;
  text: string;
}

/** Plain-text reminder email, or null when there is nothing to remind about. */
export function buildReminderEmail(
  reminders: readonly PaymentReminder[],
  today: ISODate,
  /**
   * Suspected same-card-twice pairs among the viewer's own cards (TASKS L.15 (b)). Advisory: no
   * amount below is adjusted, exactly as on /cards and the dashboard. Omitted ⇒ byte-identical to
   * the pre-L.15 email, so a user with no candidate pair — almost everyone — sees no change.
   */
  cardDuplicates: readonly CardDuplicatePairInput[] = [],
): ReminderEmail | null {
  if (reminders.length === 0) return null;
  const n = reminders.length;
  const subject = `Aimplifi: ${n} payment${n === 1 ? '' : 's'} coming up`;

  const lines = reminders.map(reminderLine);

  // Resolved against the dues this email actually prints, labelled as it prints them
  // (`accountName` is the string inside every bullet above) — so the disclosure can never name a
  // card differently from the bullet the reader is looking at, and a pair whose other side is not
  // in this email is dropped rather than sending them hunting for a bullet that is not there.
  const disclosure = cardDuplicateEmailLines(
    cardDuplicates,
    reminders.map((r) => ({ cardId: r.accountId, label: r.accountName })),
  );

  // TASKS L.18. Resolved against the reminders this email actually prints and labelled with the
  // same `accountName` the bullet uses, so a reader can attach the sentence to a line they can see.
  // No new parameter: the flag rides each reminder, so this email cannot be built without it and
  // there is no caller left to forget it.
  const frozen = frozenDuesEmailLines(
    reminders
      .filter((r) => r.frozenSince != null)
      .map((r) => ({
        label: r.accountName,
        frozenSince: r.frozenSince as string,
        isEstimated: r.isEstimated,
        kind: r.obligationType,
        // This email is composed per user at PERSONAL scope (`getCashNeeded(user.id,
        // 'PAY_IN_FULL')`), so every bullet is a due on the reader's own account. The joint digest
        // is the surface that can carry a partner's, and it decides per row.
        ownedByPartner: false,
      })),
  );

  const text = [
    `Here's what's coming up as of ${formatISODate(today, 'long')}:`,
    '',
    ...lines,
    // Same placement rule as the duplicate disclosure below: after the bullets, because the
    // sentences name them.
    ...(frozen.length > 0 ? ['', ...frozen] : []),
    // AFTER the bullets, not before: the disclosure names two of them, and a reader who meets it
    // first has nothing yet to attach the two names to. `digestUndatedAlongsideDues` sits in the
    // same place for the same reason.
    ...(disclosure.length > 0 ? ['', ...disclosure] : []),
    '',
    `A heads-up so nothing catches you by surprise. Aimplifi never moves money for you — this is just a reminder.`,
  ].join('\n');

  return { subject, text };
}
