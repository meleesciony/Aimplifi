/**
 * Recurring/subscription re-detection after ingest (ROADMAP #1b, DECISIONS #22 tail).
 * After a Plaid sync brings in new transactions (per-row normalize→rules→categorize→
 * transfer is already done), recompute the user's recurring series and the detected
 * ScheduledTransaction projections that feed the cash-needed/FI/calendar views, and
 * persist them (full replace). Pure detection lives in engine/recurring/detect.ts;
 * this is the thin server-side persist.
 */
import { type ISODate, isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import {
  type RecurringTxn,
  detectRecurring,
  toScheduledTransactions,
} from '@/lib/engine/recurring/detect';
import { confirmedPauseState } from '@/lib/engine/income/pause';
import { summarizeRecurring, type RecurringSummary } from '@/lib/engine/recurring/summary';
import { upcomingRenewals, type UpcomingRenewals } from '@/lib/engine/recurring/renewals';
import { categoryName } from '@/lib/engine/categorize/categories';
import { getCategoryMeta } from '@/server/category-meta';
import { getReconciliationTxnKeep } from '@/server/reconciliation';
import { getProvider } from '@/lib/providers/demo';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { PAYMENT_ACCOUNT_TYPES } from '@/lib/engine/settings/dials';
import { accountLabel } from '@/lib/engine/account/display-name';

export interface RecurringData {
  summary: RecurringSummary;
  /** Forward renewal schedule — expected charges over the next 90 days (#246). */
  renewals: UpcomingRenewals;
  accountNames: Record<string, string>;
  /**
   * Display name per category id appearing in the summary — resolved server-side
   * through the merged meta so a CUSTOM category shows its real name instead of a
   * raw cuid (DECISIONS #111). System ids resolve to the same static name.
   */
  categoryNames: Record<string, string>;
}

/**
 * Read path for the Recurring page (DECISIONS #71). Detects live from the
 * shared snapshot — spending accounts only (#62), posted, non-split — so it
 * works identically for the demo seed and real synced users without depending
 * on the persisted RecurringSeries table.
 */
export async function getRecurring(userId: string): Promise<RecurringData> {
  const provider = getProvider();
  const today = provider.today(userId);
  const snap = await provider.getFinanceSnapshot(userId);

  const spendingIds = new Set(
    snap.accounts
      .filter((a) => (SPENDING_ACCOUNT_TYPES as readonly string[]).includes(a.type))
      .map((a) => a.id),
  );
  const txns: RecurringTxn[] = snap.transactions
    .filter((t) => t.status === 'POSTED' && !t.isSplitParent && spendingIds.has(t.accountId))
    .map((t, i) => ({
      id: String(i),
      accountId: t.accountId,
      date: t.date,
      amountCents: t.amountCents,
      rawDescriptor: t.rawDescriptor,
      isTransfer: t.isTransfer,
    }));

  const series = detectRecurring(txns, isoDate(today));
  const summary = summarizeRecurring(series, today);
  const renewals = upcomingRenewals(summary.items, today);

  const accountNames: Record<string, string> = {};
  for (const a of snap.accounts) accountNames[a.id] = accountLabel(a);

  // Resolve each category once through the merged meta (custom + system) so a
  // recurring series filed under a custom category shows its name (DECISIONS #111).
  const meta = await getCategoryMeta(userId);
  const categoryNames: Record<string, string> = {};
  for (const it of summary.items) {
    if (!(it.categoryId in categoryNames)) categoryNames[it.categoryId] = categoryName(it.categoryId, meta);
  }
  return { summary, renewals, accountNames, categoryNames };
}

/** Scheduled-row sources that are DERIVED from detection (and so safe to replace). */
const DETECTED_SCHEDULED_SOURCES = ['payroll-detected', 'recurring'];

export async function refreshRecurringForUser(
  userId: string,
  today: ISODate,
): Promise<{ series: number; scheduled: number }> {
  const txns = await prisma.transaction.findMany({
    // Spending accounts only — don't detect "recurring" from brokerage/loan activity (#62).
    where: {
      // Currency guard (DECISIONS #135): don't detect recurring series from a withheld non-USD
      // account — a foreign subscription would otherwise persist a scheduled row on the USD
      // payment account at a fabricated 1:1, leaking into forecast/cash-needed.
      account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] }, OR: [{ currency: null }, { currency: 'USD' }] },
      status: 'POSTED',
      isSplitParent: false,
    },
    select: { id: true, accountId: true, date: true, amountCents: true, rawDescriptor: true, isTransfer: true },
  });
  // Reconciliation boundary (slice-6 critic C-11): a reconciled pair's overlap rows are two
  // same-day, same-amount copies of every real charge — fed raw into detection they distort
  // cadence/price-change/possiblyUnused, and the persisted scheduled rows feed forecast and
  // cash-needed. Same shared R1 rule as the register.
  const keepsReconciled = await getReconciliationTxnKeep(userId);
  const series = detectRecurring(txns.filter((t) => keepsReconciled(t.accountId, t.date)) as RecurringTxn[], today);

  // RecurringSeries.merchantId is required; resolve canonical → Merchant.id. Series
  // whose merchant has no row are skipped (mirrors the seed). The Plaid ingest
  // upserts a Merchant per row, so detected canonicals resolve after a sync.
  const canonicals = [...new Set(series.map((s) => s.merchantCanonical))];
  const merchants = canonicals.length
    ? await prisma.merchant.findMany({ where: { canonical: { in: canonicals } }, select: { id: true, canonical: true } })
    : [];
  const merchantId = new Map(merchants.map((m) => [m.canonical, m.id]));

  const seriesRows = series
    .filter((s) => merchantId.has(s.merchantCanonical))
    .map((s) => ({
      userId,
      merchantId: merchantId.get(s.merchantCanonical)!,
      cadence: s.cadence,
      typicalAmountCents: s.typicalAmountCents,
      lastAmountCents: s.lastAmountCents,
      previousAmountCents: s.previousAmountCents,
      possiblyUnused: s.possiblyUnused,
      priceChangedAt: s.priceChangedAt,
      lastSeenAt: s.lastSeenAt,
      nextExpectedAt: s.nextExpectedAt,
      isSubscription: s.isSubscription,
    }));

  // Payment account for the projection: the stored choice, else a checking/savings.
  const [user, accounts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { paymentAccountId: true } }),
    prisma.account.findMany({ where: { userId }, select: { id: true, type: true } }),
  ]);
  const paymentAccountId =
    accounts.find((a) => a.id === user?.paymentAccountId)?.id ??
    accounts.find((a) => (PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(a.type))?.id ??
    null;
  // Income-Pause confirmations (#251, AI plan §Later #20): a pause the user has
  // CONFIRMED excludes its income series from the detected projections — this is the
  // confirmation-gated `projectedIncome = 0` mutation. `confirmedPauseState` is the
  // ONE predicate (shared with the feed's HANDLED state row) deciding what consent
  // means right now, recomputed from the series itself each refresh — the
  // confirmation row is never trusted as evidence:
  //   'paused'  → exclude from projections (regardless of the ALARM gates — #251
  //               critic F1: a provider row-removal that drops occurrences below the
  //               alarm floor must not silently re-project income no deposit revived);
  //   'resumed' → a DATE-FRESH deposit arrived: project normally and delete the
  //               stale confirmation, so a future pause re-asks — fresh evidence,
  //               and only fresh evidence, retires consent;
  //   'inert'   → no projectable income series under this canonical: nothing to
  //               exclude, confirmation kept (absence of evidence is not resumption).
  // Unconfirmed lapses project as before: the radar alone never mutates a projection
  // (a merely-late paycheck must not flip cash-needed into a false alarm). The
  // RecurringSeries table and the /recurring page keep showing the series either
  // way — only the forward projection stops counting money that stopped arriving.
  const confirmations = await prisma.incomePauseConfirmation.findMany({
    where: { userId },
    select: { merchantCanonical: true },
  });
  let projectable = series;
  if (confirmations.length > 0) {
    const excluded = new Set<string>();
    const resumed: string[] = [];
    for (const c of confirmations) {
      const state = confirmedPauseState(series, today, c.merchantCanonical);
      if (state.status === 'paused') excluded.add(c.merchantCanonical);
      else if (state.status === 'resumed') resumed.push(c.merchantCanonical);
    }
    if (excluded.size > 0) {
      projectable = series.filter((s) => !(s.isIncome && excluded.has(s.merchantCanonical)));
    }
    if (resumed.length > 0) {
      await prisma.incomePauseConfirmation.deleteMany({
        where: { userId, merchantCanonical: { in: resumed } },
      });
    }
  }
  const scheduledRows = paymentAccountId ? toScheduledTransactions(projectable, paymentAccountId, today) : [];

  // Full replace, atomically. Only the DETECTED scheduled rows are swapped — a
  // SEEDED row is left intact. (The 'user' and 'autopay' sources the column
  // documents have no writer anywhere in the app; the filter would spare them,
  // but no comment here should imply they exist — L.23 copy critic P2-1, the same
  // mistake as the "an annual bill entered by you" clause this slice deleted.)
  await prisma.$transaction([
    prisma.recurringSeries.deleteMany({ where: { userId } }),
    prisma.recurringSeries.createMany({ data: seriesRows }),
    prisma.scheduledTransaction.deleteMany({
      where: { account: { userId }, source: { in: DETECTED_SCHEDULED_SOURCES } },
    }),
    prisma.scheduledTransaction.createMany({ data: scheduledRows }),
  ]);

  return { series: seriesRows.length, scheduled: scheduledRows.length };
}
