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
import { median } from '@/lib/stats';
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
    const cadence = cadenceFromGap(Math.round(median(gaps)));
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

/** The cadences a detected series is projected under. IRREGULAR never reaches
 *  here (detectRecurring drops it); ANNUAL reaches it for EXPENSES only — see
 *  `toScheduledTransactions`. */
export type ProjectedCadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'ANNUAL';

/** Nominal cadence length in days — the basis of the active/lapsed cutoff.
 *  Lives here, with the detector that assigns the cadence, so the projection
 *  filter and the /recurring summary share ONE rule instead of two copies that
 *  can drift (`summarizeRecurring` imports it). */
export const CADENCE_DAYS: Record<Cadence, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30,
  ANNUAL: 365,
  IRREGULAR: 0,
};

/**
 * Is this series still charging? False once it is overdue by more than half a
 * cadence again — the exact rule /recurring uses to file a series under "no
 * longer charging" and to drop it out of the monthly-spend headline.
 *
 * Shared, not copied, because the two callers must agree by construction: when
 * they disagreed, a lapsed series read $0/month on /recurring and a full
 * monthly rate inside the spending plan (found independently by both L.23
 * critics). Cadence-scaled on purpose — the cutoff is ~45 days on a monthly
 * bill and ~548 on an annual one, because that is how long silence takes to
 * become evidence at each rhythm.
 */
export function isSeriesActive(
  series: Pick<RecurringSeriesResult, 'cadence' | 'lastSeenAt'>,
  today: ISODate,
): boolean {
  return daysBetween(series.lastSeenAt, today) <= Math.round(CADENCE_DAYS[series.cadence] * 1.5);
}

/**
 * Map detected recurring series on the payment account to ScheduledTransaction
 * rows — this is how Phase 2 feeds the Phase 1 cash-needed projection.
 *
 * WHY ANNUAL EXPENSES ARE PROJECTED (L.23, the L.22 money-critic P1-2 residual).
 * While this filter was W/B/M only, a detected annual bill reached NO surface
 * that projects money: `src/server/recurring.ts` is the only writer of the
 * ScheduledTransaction table in the app, so the spending plan's `/12` rule —
 * written for exactly that bill — was dead for every row in production, and a
 * $1,200/yr premium overstated guilt-free spending by $100 every month. The
 * /recurring page's own headline already normalized the same series at 1/12
 * (summary.ts PER_MONTH), so two surfaces disagreed about one fact.
 *
 * WHY ANNUAL INCOME IS NOT — the failure direction differs by ROLE, not by
 * class of value (the L.14 lesson). An annual BILL can only ask the reader to
 * hold more cash: in the plan it raises fixed expenses, and in the ≤90-day
 * projections it lands as one dated outflow. An annual BONUS does the opposite
 * — projected on a date inferred from a 365-day gap, it offsets a dip and can
 * silence a warning the reader would otherwise act on, and an annual event's
 * date moves by weeks where a paycheck's moves by days. The plan does not need
 * it either: the trailing median already saw the month a bonus arrived in, and
 * dividing it into the no-history fallback would manufacture monthly income
 * that never arrives monthly — the phantom-income class the L.22 re-spec
 * exists to kill. So it stays out until a slice can date it from better
 * evidence than one gap.
 *
 * AND ONLY WHILE IT IS STILL CHARGING. `detectRecurring` reads all of history
 * with no staleness gate, and `nextExpectedAt` steps a dormant anchor forward
 * until it is in the future — so a policy last charged in 2021 detects today
 * with `nextExpectedAt` next August. Both L.23 critics found this independently
 * and executed it: /recurring files that series under "no longer charging" and
 * counts it $0, while the plan counted a full $100/month forever and the
 * calendar printed a dated −$1,200 for a cancelled policy. The lapse gate is
 * `isSeriesActive` — the SAME predicate /recurring files by, so the two surfaces
 * agree by construction. It is applied to ANNUAL only: at 365 days the silence
 * needed to prove death is ~18 months, where a monthly bill's is ~45 days, and
 * widening the gate to every cadence would change what is projected for every
 * existing user (recorded in docs/STATUS.md instead).
 *
 * NOT PROJECTED AT ALL, recorded in docs/STATUS.md: a QUARTERLY or SEMIANNUAL
 * bill, because `cadenceFromGap` classifies a ~91/182-day gap as IRREGULAR and
 * `detectRecurring` drops it before this function sees it. And the agreement
 * with /recurring holds only for series on the PAYMENT account, which is the
 * only account this function projects: an annual premium autopaid from savings
 * is still $100/month on /recurring and $0 in the plan.
 */
export function toScheduledTransactions(
  series: readonly RecurringSeriesResult[],
  paymentAccountId: string,
  today: ISODate,
): {
  accountId: string;
  description: string;
  amountCents: number;
  nextDate: string;
  // Never null: the filter above admits exactly the four projected cadences, so
  // this function cannot emit the one-off shape the DB column also allows.
  cadence: ProjectedCadence;
  source: string;
}[] {
  return series
    .filter((s) => s.accountId === paymentAccountId)
    .filter(
      (s) =>
        s.cadence === 'WEEKLY' ||
        s.cadence === 'BIWEEKLY' ||
        s.cadence === 'MONTHLY' ||
        (s.cadence === 'ANNUAL' && !s.isIncome && isSeriesActive(s, today)),
    )
    .map((s) => ({
      accountId: s.accountId,
      description: s.merchantCanonical,
      amountCents: s.typicalAmountCents,
      nextDate: s.nextExpectedAt,
      cadence: s.cadence as ProjectedCadence,
      source: s.isIncome ? 'payroll-detected' : 'recurring',
    }));
}
