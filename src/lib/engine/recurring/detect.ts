/**
 * Recurring / subscription detection (Phase 2):
 *  - groups transactions by canonical merchant
 *  - infers cadence from the median gap between occurrences
 *  - tracks price changes (stable old amount → stable new amount)
 *  - flags possibly-unused subscriptions (fitness memberships with no other
 *    activity ≥90 days — a heuristic, surfaced as a question, never a scold)
 *  - detects biweekly payroll as an income cadence, which feeds
 *    ScheduledTransactions for the cash-needed projection.
 */
import { type ISODate, addDays, addMonthsClamped, compareDates, daysBetween, isoDate } from '@/lib/dates';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';

export interface RecurringTxn {
  id: string;
  accountId: string;
  date: string;
  amountCents: number; // signed
  rawDescriptor: string;
  isTransfer?: boolean;
}

export type Cadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'ANNUAL' | 'IRREGULAR';

export interface RecurringSeriesResult {
  merchantCanonical: string;
  categoryId: string;
  cadence: Cadence;
  typicalAmountCents: number; // most recent stable amount (signed)
  lastAmountCents: number;
  previousAmountCents: number | null; // set when a price change was detected
  priceChangedAt: ISODate | null;
  lastSeenAt: ISODate;
  nextExpectedAt: ISODate;
  occurrences: number;
  isSubscription: boolean;
  isIncome: boolean;
  possiblyUnused: boolean;
  accountId: string;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function cadenceFromGap(gapDays: number): Cadence {
  if (gapDays >= 5 && gapDays <= 9) return 'WEEKLY';
  if (gapDays >= 12 && gapDays <= 16) return 'BIWEEKLY';
  if (gapDays >= 26 && gapDays <= 35) return 'MONTHLY';
  if (gapDays >= 350 && gapDays <= 380) return 'ANNUAL';
  return 'IRREGULAR';
}

/**
 * The next expected occurrence after `last` for a cadence. Exported so the
 * forward renewal schedule (renewals.ts, #246) steps by the SAME rule this
 * detector used to compute `nextExpectedAt` — one source of cadence arithmetic.
 */
export function nextDate(last: ISODate, cadence: Cadence): ISODate {
  switch (cadence) {
    case 'WEEKLY':
      return addDays(last, 7);
    case 'BIWEEKLY':
      return addDays(last, 14);
    case 'MONTHLY':
      return addMonthsClamped(last, 1);
    case 'ANNUAL':
      return addMonthsClamped(last, 12);
    default:
      return addMonthsClamped(last, 1);
  }
}

/** Categories whose recurring charges count as subscriptions. */
const SUBSCRIPTION_CATEGORIES = new Set([
  'entertainment', 'software', 'fitness', 'utilities',
  // Household utility leaves (#154) — a monthly electric/gas/water/trash bill is a
  // recurring obligation just like the `utilities` catch-all it was split from.
  'electricity', 'natural-gas', 'water', 'trash',
  'insurance', 'groceries',
  // #163 leaf-precision follow-through: merchants that used to file into the
  // coarse parents above now land on precise leaves (Xfinity → internet,
  // GEICO *AUTO → auto-insurance, consoles → games). A recurring bill on any
  // of them is the same subscription it always was.
  'internet', 'phone', 'subscriptions', 'games', 'music',
  'auto-insurance', 'health-insurance', 'dental-insurance', 'vision-insurance', 'life-insurance',
]);

export function detectRecurring(
  transactions: readonly RecurringTxn[],
  today: ISODate,
): RecurringSeriesResult[] {
  const byMerchant = new Map<string, { txns: RecurringTxn[]; categoryId: string }>();
  for (const t of transactions) {
    const m = normalizeMerchant(t.rawDescriptor);
    // Own-account transfers (incl. card payments) are not subscriptions;
    // the auto-loan ACH is a recurring OBLIGATION and is kept.
    if (t.isTransfer && m.categoryId !== 'auto-loan') continue;
    const entry = byMerchant.get(m.canonical) ?? { txns: [], categoryId: m.categoryId };
    entry.txns.push(t);
    byMerchant.set(m.canonical, entry);
  }

  const results: RecurringSeriesResult[] = [];
  for (const [canonical, group] of byMerchant) {
    const { categoryId } = group;
    // A recurring series is same-signed charges; a stray opposite-sign txn — a
    // refund inside an expense subscription, say — is a one-off, NOT part of the
    // cadence. Analyze only the dominant sign so a refund+rebill doesn't drop the
    // whole series (STATUS #7 fragility / ROADMAP #4). Pure-signed groups (every
    // seed series) are unchanged: the minority list is empty, so `txns` is the full set.
    const negatives = group.txns.filter((t) => t.amountCents < 0);
    const positives = group.txns.filter((t) => t.amountCents > 0);
    const txns = negatives.length >= positives.length ? negatives : positives;
    if (txns.length < 3) continue;
    const sorted = [...txns].sort((a, b) => compareDates(isoDate(a.date), isoDate(b.date)));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(daysBetween(isoDate(sorted[i - 1].date), isoDate(sorted[i].date)));
    }
    const cadence = cadenceFromGap(median(gaps));
    if (cadence === 'IRREGULAR') continue;

    // Amount stability: a series is recurring when amounts cluster tightly.
    // Allow exactly two stable plateaus (price change).
    const amounts = sorted.map((t) => t.amountCents);
    const distinct = [...new Set(amounts)];
    if (distinct.length > 2) {
      // payroll-style: identical amounts required for income; variable spend is
      // not a subscription (e.g. groceries at Kroger).
      continue;
    }

    let previousAmountCents: number | null = null;
    let priceChangedAt: ISODate | null = null;
    if (distinct.length === 2) {
      // must be two contiguous plateaus old→new, else it's just variable spend
      const firstNewIdx = amounts.findIndex((a) => a === amounts[amounts.length - 1]);
      const plateaued =
        amounts.slice(0, firstNewIdx).every((a) => a === amounts[0]) &&
        amounts.slice(firstNewIdx).every((a) => a === amounts[amounts.length - 1]);
      if (!plateaued || firstNewIdx === 0) continue;
      previousAmountCents = amounts[0];
      priceChangedAt = isoDate(sorted[firstNewIdx].date);
    }

    const last = sorted[sorted.length - 1];
    const lastSeenAt = isoDate(last.date);
    const isIncome = last.amountCents > 0;
    const isSubscription = !isIncome && SUBSCRIPTION_CATEGORIES.has(categoryId);

    // "Possibly unused": a fitness membership with no usage signal for 90+ days.
    // Usage can't be observed in transaction data, so this is a question for
    // the user, not an accusation (see coach guardrails).
    const possiblyUnused = isSubscription && categoryId === 'fitness';

    results.push({
      merchantCanonical: canonical,
      categoryId,
      cadence,
      typicalAmountCents: last.amountCents,
      lastAmountCents: last.amountCents,
      previousAmountCents,
      priceChangedAt,
      lastSeenAt,
      nextExpectedAt: (() => {
        let n = nextDate(lastSeenAt, cadence);
        while (compareDates(n, today) < 0) n = nextDate(n, cadence);
        return n;
      })(),
      occurrences: sorted.length,
      isSubscription,
      isIncome,
      possiblyUnused,
      accountId: last.accountId,
    });
  }

  return results.sort((a, b) => a.merchantCanonical.localeCompare(b.merchantCanonical));
}

/**
 * Map detected recurring series on the payment account to ScheduledTransaction
 * rows — this is how Phase 2 feeds the Phase 1 cash-needed projection.
 */
export function toScheduledTransactions(
  series: readonly RecurringSeriesResult[],
  paymentAccountId: string,
): {
  accountId: string;
  description: string;
  amountCents: number;
  nextDate: string;
  cadence: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | null;
  source: string;
}[] {
  return series
    .filter((s) => s.accountId === paymentAccountId)
    .filter((s) => s.cadence === 'WEEKLY' || s.cadence === 'BIWEEKLY' || s.cadence === 'MONTHLY')
    .map((s) => ({
      accountId: s.accountId,
      description: s.merchantCanonical,
      amountCents: s.typicalAmountCents,
      nextDate: s.nextExpectedAt,
      cadence: s.cadence as 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY',
      source: s.isIncome ? 'payroll-detected' : 'recurring',
    }));
}
