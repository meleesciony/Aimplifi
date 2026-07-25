/**
 * Smart Notification Engine (Competitive-Gap plan Gap 2 §2). PURE, no I/O — the
 * single place that decides WHICH proactive alerts are worth interrupting a user
 * for, unifying two already-computed sources so a push and the in-app cards can
 * never disagree:
 *
 *   1. Payment reminders  (engine/reminders/select.ts) — a card/loan payment the
 *      user must make themselves, imminent enough to matter.
 *   2. The Cash Flow Radar (engine/radar/radar.ts)     — a committed-line dip
 *      below $0 within the push window (radar.pushWorthy, the #172 hook).
 *
 * MATERIALITY (the plan's "minimal materiality filter, not the full concept") is
 * actionability + urgency, never an arbitrary dollar floor:
 *   • payment_due   — surfaced only when the user has money to move themselves
 *                     (userActionCents > 0; autopay-covered items have nothing to
 *                     do → no push) AND it is due within NOTIFY_DUE_WINDOW_DAYS.
 *   • cash_flow_alert — surfaced only when radar.pushWorthy (a committed dip ≤ 7d;
 *                     the burn band can never raise this, by #172 condition 1).
 *
 * QUIET RULE / dedup: every notification carries a stable `key`; the caller passes
 * the keys already delivered (from NotificationSent) and they are excluded here, so
 * a daily sweep alerts at most once per subject. No fabrication: every amount is
 * copied verbatim from the source engine — this module never computes a money value.
 */
import { type Cents, ZERO, formatCents } from '@/lib/money';
import { type ISODate, compareDates, formatISODate } from '@/lib/dates';
import type { PaymentReminder } from '@/lib/engine/reminders/select';
import type { RadarResult } from '@/lib/engine/radar/radar';
import {
  type CardDuplicatePairInput,
  cardDuplicatePushNotes,
} from '@/lib/engine/account/card-duplicate-view';

export type NotificationKind = 'payment_due' | 'cash_flow_alert';
/** Client-facing severity: critical = today/negative now, warning = imminent, info = fyi. */
export type NotificationLevel = 'critical' | 'warning' | 'info';

export interface AppNotification {
  /** Stable idempotency key — dedup across sweeps (see NotificationSent). */
  key: string;
  kind: NotificationKind;
  level: NotificationLevel;
  title: string;
  body: string;
  /** The salient figure, copied from the source engine (never computed here). */
  amountCents: Cents;
  /** The date the money is needed / the account dips; null if not date-anchored. */
  dueDate: ISODate | null;
  isEstimated: boolean;
  /** In-app deep link the notification opens (SW notificationclick). */
  url: string;
}

/**
 * Push only for imminent, actionable payments — urgency 'today' | 'soon' in the
 * reminders engine is daysUntil ≤ 3. 'upcoming' payments stay in-app only.
 */
export const NOTIFY_DUE_WINDOW_DAYS = 3;

export interface SelectNotificationsParams {
  reminders: readonly PaymentReminder[];
  radar: RadarResult | null;
  today: ISODate;
  /** Notification keys already delivered (from NotificationSent) — excluded. */
  sentKeys?: ReadonlySet<string>;
  /**
   * True when a radar alert was already delivered to this user within the re-alert
   * cooldown (the caller does the date math). Suppresses a new cash_flow_alert so a
   * dip-date wobble can't re-push the same shortfall episode. Payment reminders are
   * unaffected — their keys are stable.
   */
  radarAlertOnCooldown?: boolean;
  /**
   * Suspected same-card-twice pairs among the viewer's own cards (TASKS L.15 (d)). ADVISORY, and
   * deliberately NOT a suppression input: both notifications still go out, each naming the other
   * row. See `cardDuplicatePushNotes` for why disclosing beats dropping one. Omitted ⇒ every
   * emitted notification is byte-identical to pre-L.15.
   */
  cardDuplicates?: readonly CardDuplicatePairInput[];
}

/** Stable dedup key for a payment reminder notification. */
export function paymentNotificationKey(r: { accountId: string; dueDate: string }): string {
  return `payment_due:${r.accountId}:${r.dueDate}`;
}

/** Stable dedup key for a radar alert notification (one per projected-negative date). */
export function radarNotificationKey(firstNegativeDate: string): string {
  return `cash_flow_alert:${firstNegativeDate}`;
}

function whenPhrase(daysUntil: number): string {
  if (daysUntil <= 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  return `in ${daysUntil} days`;
}

/**
 * The material, not-yet-delivered notifications for one user, most urgent first
 * (critical → warning → info, then earliest date). Deterministic and pure; the
 * caller records the returned keys in NotificationSent and delivers them.
 */
export function selectNotifications(params: SelectNotificationsParams): AppNotification[] {
  const { reminders, radar, sentKeys, radarAlertOnCooldown, cardDuplicates = [] } = params;
  const out: AppNotification[] = [];

  // Resolved against the whole reminders list, and consulted per notification below. Built from the
  // complete list on purpose: a pair is a fact about the reader's accounts, not about which of the
  // two happens to clear the filters in THIS run, and `cardDuplicatePushNotes` states no claim about
  // how many notifications arrive precisely so it stays true when only one side survives them.
  const duplicateNotes = cardDuplicatePushNotes(
    cardDuplicates,
    reminders.map((r) => ({ cardId: r.accountId, label: r.accountName })),
  );

  // 1. Payment reminders: actionable (money to move) + imminent.
  for (const r of reminders) {
    if (r.userActionCents <= 0) continue; // autopay-covered / nothing to do
    if (r.daysUntil > NOTIFY_DUE_WINDOW_DAYS) continue;
    const key = paymentNotificationKey({ accountId: r.accountId, dueDate: r.dueDate });
    if (sentKeys?.has(key)) continue;
    const level: NotificationLevel = r.daysUntil <= 0 ? 'critical' : 'warning';
    const est = r.isEstimated ? ' (estimated — the statement may not have posted yet)' : '';
    // Appended LAST so an operating system that truncates the body still shows the amount and the
    // date — the half the reader must act on — before the advisory.
    const dup = duplicateNotes.get(r.accountId);
    out.push({
      key,
      kind: 'payment_due',
      level,
      title: `${r.accountName} payment ${whenPhrase(r.daysUntil)}`,
      body: `Pay ${formatCents(r.userActionCents)} yourself by ${formatISODate(r.dueDate, 'long')}${est}. Aimplifi never moves money for you.${dup ? ` ${dup}` : ''}`,
      amountCents: r.userActionCents,
      dueDate: r.dueDate,
      isEstimated: r.isEstimated,
      url: '/accounts',
    });
  }

  // 2. Cash Flow Radar: a committed dip below $0 within the push window (unless a
  // recent radar alert already covered this episode — the wobble cooldown).
  if (radar && radar.pushWorthy && radar.committed.firstNegativeDate && !radarAlertOnCooldown) {
    const key = radarNotificationKey(radar.committed.firstNegativeDate);
    if (!sentKeys?.has(key)) {
      const daysUntil = radar.daysUntilFirstNegative ?? 0;
      const level: NotificationLevel = daysUntil <= 1 ? 'critical' : 'warning';
      const card = radar.collidingCards[0];
      const coverCents = radar.coverTransfer?.amountCents ?? ZERO;
      const cardPhrase = card ? ` after your ${card.cardName} payment` : '';
      const coverPhrase = radar.coverTransfer
        ? ` Moving ${formatCents(coverCents)} into checking by ${formatISODate(radar.coverTransfer.byDate, 'long')} keeps you clear.`
        : '';
      const est = radar.includesEstimatedDues
        ? ' Some upcoming statements are estimated.'
        : '';
      // TASKS L.15 (critic P1-2). This alert can exist ONLY because of the duplicate — the critic's
      // executed repro showed one connection projecting no alert at all while two projected a
      // CRITICAL dip four weeks earlier and a $33,100 transfer instead of $13,050. The reader is
      // being told to move money, on a channel that interrupts, so the caveat rides the same body.
      const dupNote = radar.duplicateDisclosure ? ` ${radar.duplicateDisclosure}` : '';
      out.push({
        key,
        kind: 'cash_flow_alert',
        level,
        title: `Checking may go negative ${whenPhrase(daysUntil)}`,
        body: `Your checking is on track to dip below $0 on ${formatISODate(radar.committed.firstNegativeDate, 'long')}${cardPhrase}.${coverPhrase}${est}${dupNote}`,
        amountCents: coverCents,
        dueDate: radar.committed.firstNegativeDate,
        isEstimated: radar.includesEstimatedDues,
        url: '/dashboard',
      });
    }
  }

  const rank: Record<NotificationLevel, number> = { critical: 0, warning: 1, info: 2 };
  // Null-dated notifications (none today, but the type allows it) sort last.
  const byDate = (a: AppNotification, b: AppNotification): number =>
    a.dueDate && b.dueDate ? compareDates(a.dueDate, b.dueDate) : a.dueDate ? -1 : b.dueDate ? 1 : 0;
  return out.sort(
    (a, b) => rank[a.level] - rank[b.level] || byDate(a, b) || a.title.localeCompare(b.title),
  );
}
