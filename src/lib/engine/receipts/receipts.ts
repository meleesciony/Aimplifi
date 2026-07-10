/**
 * Value-receipts engine (TASKS 1.3, DECISIONS #206). PURE, no I/O — turns the three
 * proactive "Aimplifi caught something" moments into append-only receipt candidates,
 * and folds persisted receipt rows into the cumulative "what Aimplifi caught" summary
 * shown on /coach and in the weekly digest.
 *
 * The notify/select.ts invariant applies verbatim: THIS MODULE NEVER COMPUTES A MONEY
 * VALUE. Every `amountCents` is copied from an already-tested source engine at the
 * moment of the catch:
 *   • reminder-delivered — PaymentReminder.cashRequiredCents (the payment the reminder
 *     covered), minted only after a REAL delivery (email or push; never on a dormant run).
 *   • radar-catch       — the cover-transfer amount the alert itself showed
 *     (coverTransfer.amountCents, 0 when the alert had no transfer to suggest), minted
 *     only when the cash_flow_alert push was actually delivered.
 *   • price-increase    — Opportunity.monthlyCents (the detected monthly delta), minted
 *     when the flag is surfaced on /coach or in the digest sweep.
 *
 * Keys are channel-agnostic and idempotent (an email and a push about the same due
 * payment mint ONE receipt): payment/radar receipts reuse the notify-engine key
 * builders; price receipts key on merchant + the series' detected change date.
 *
 * HONESTY RULE for the summary: counts and per-kind totals only. Receipts record what
 * Aimplifi SURFACED, not outcomes — so no cross-kind grand total in dollars and never a
 * "we saved you $X" claim (that would assert causation the data cannot support).
 */
import { type Cents, ZERO, cents, sumCents } from '@/lib/money';
import type { ISODate } from '@/lib/dates';
import type { PaymentReminder } from '@/lib/engine/reminders/select';
import type { RadarResult } from '@/lib/engine/radar/radar';
import type { Opportunity } from '@/lib/engine/fi/insights';
import { paymentNotificationKey, radarNotificationKey } from '@/lib/engine/notify/select';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';

export type ValueReceiptKind = 'reminder-delivered' | 'radar-catch' | 'price-increase';

/** One catch, ready to persist (server dedups on `key` per user). */
export interface ReceiptCandidate {
  kind: ValueReceiptKind;
  /** Stable idempotency key within the user, shared across delivery channels. */
  key: string;
  /** Copied verbatim from the source engine — meaning per kind (see module doc). */
  amountCents: Cents;
  /** Account or merchant name at catch time — data, not copy. */
  label: string;
  /** Business calendar date of the catch (YYYY-MM-DD). */
  occurredOn: ISODate;
}

/**
 * Idempotency key for a flagged price increase: one per merchant + PRICE TRANSITION
 * (absolute before→after cents). Keyed on the transition, not the detection date —
 * the date is a detectRecurring artifact that can shift under re-import churn, and a
 * shifted date must never re-mint (and so double-count) the same increase (critic
 * #206 P2-2). A genuinely new hike (e.g. 1799→2049 after 1549→1799) keys distinctly.
 */
export function priceIncreaseReceiptKey(
  merchant: string,
  fromCents: number,
  toCents: number,
): string {
  return `price_increase:${merchant}:${fromCents}>${toCents}`;
}

/**
 * Receipt per REAL-statement reminder in a DELIVERED reminder set (the caller
 * guarantees delivery). Amount = the payment the reminder covered
 * (cashRequiredCents), key = the same payment key the notify engine dedups on, so
 * email and push mint one receipt.
 *
 * ESTIMATED reminders mint nothing (critic #206 P2-3): an estimate's amount and due
 * date are projections — recording one would put an unmarked projected dollar figure
 * into a permanent tally, and the real statement's different due date would then
 * mint a SECOND receipt for the same payment. Skipping is the undercount-safe
 * direction; the real statement's reminder mints the one true receipt.
 */
export function receiptsFromReminders(
  reminders: readonly PaymentReminder[],
  deliveredOn: ISODate,
): ReceiptCandidate[] {
  return reminders
    .filter((r) => !r.isEstimated)
    .map((r) => ({
      kind: 'reminder-delivered' as const,
      key: paymentNotificationKey({ accountId: r.accountId, dueDate: r.dueDate }),
      amountCents: r.cashRequiredCents,
      label: r.accountName,
      occurredOn: deliveredOn,
    }));
}

/**
 * Receipt for a DELIVERED radar alert (null when the radar state isn't alert-worthy —
 * same gate as the notification itself: pushWorthy + a projected-negative date).
 * Amount = the cover-transfer the alert showed (0 when it had none to suggest).
 */
export function receiptFromRadarAlert(
  radar: RadarResult,
  caughtOn: ISODate,
): ReceiptCandidate | null {
  if (!radar.pushWorthy || !radar.committed.firstNegativeDate) return null;
  return {
    kind: 'radar-catch',
    key: radarNotificationKey(radar.committed.firstNegativeDate),
    amountCents: radar.coverTransfer?.amountCents ?? ZERO,
    label: radar.collidingCards[0]?.cardName ?? '',
    occurredOn: caughtOn,
  };
}

/**
 * Receipt per flagged price increase. Only 'price-increase' opportunities carrying
 * their transition (from→to cents, which anchors the key) and change date qualify —
 * the same increase surfaced week after week still counts once, and a shifted
 * detection date can't re-mint it. `occurredOn` is the change date itself (the
 * business date of the event), not the day it happened to be viewed.
 */
export function receiptsFromOpportunities(
  opportunities: readonly Opportunity[],
): ReceiptCandidate[] {
  const out: ReceiptCandidate[] = [];
  for (const o of opportunities) {
    if (o.kind !== 'price-increase') continue;
    if (!o.priceChangedAt || o.priceFromCents === undefined || o.priceToCents === undefined) continue;
    out.push({
      kind: 'price-increase',
      key: priceIncreaseReceiptKey(o.merchant, o.priceFromCents, o.priceToCents),
      amountCents: o.monthlyCents,
      label: o.merchant,
      occurredOn: o.priceChangedAt as ISODate,
    });
  }
  return out;
}

/** Cumulative tally — counts plus per-kind totals only (see module honesty rule). */
export interface ValueReceiptsSummary {
  /** Total catches across the three known kinds. */
  total: number;
  remindersCount: number;
  /** Σ payments covered by delivered reminders (cashRequiredCents at catch time). */
  remindersAmountCents: Cents;
  radarCount: number;
  priceIncreaseCount: number;
  /** Σ detected monthly deltas across flagged price increases. */
  priceIncreaseMonthlyCents: Cents;
}

/** Fold persisted receipt rows into the summary. Unknown kinds are ignored. */
export function summarizeReceipts(
  rows: readonly { kind: string; amountCents: number }[],
): ValueReceiptsSummary {
  const of = (kind: ValueReceiptKind) => rows.filter((r) => r.kind === kind);
  const reminders = of('reminder-delivered');
  const radar = of('radar-catch');
  const price = of('price-increase');
  return {
    total: reminders.length + radar.length + price.length,
    remindersCount: reminders.length,
    remindersAmountCents: sumCents(reminders.map((r) => cents(r.amountCents))),
    radarCount: radar.length,
    priceIncreaseCount: price.length,
    priceIncreaseMonthlyCents: sumCents(price.map((r) => cents(r.amountCents))),
  };
}

/**
 * The per-kind tally lines (only kinds with a count), SHARED by the /coach card and
 * the weekly digest — the reminderLine precedent: both surfaces render a catch
 * identically. All copy lives in COACH_COPY (guardrail-scanned).
 */
export function receiptLines(summary: ValueReceiptsSummary): string[] {
  const lines: string[] = [];
  if (summary.remindersCount > 0) {
    lines.push(COACH_COPY.receiptsReminders(summary.remindersCount, summary.remindersAmountCents));
  }
  if (summary.radarCount > 0) {
    lines.push(COACH_COPY.receiptsRadar(summary.radarCount));
  }
  if (summary.priceIncreaseCount > 0) {
    lines.push(
      COACH_COPY.receiptsPriceIncreases(summary.priceIncreaseCount, summary.priceIncreaseMonthlyCents),
    );
  }
  return lines;
}
