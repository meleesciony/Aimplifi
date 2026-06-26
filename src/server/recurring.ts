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
import { summarizeRecurring, type RecurringSummary } from '@/lib/engine/recurring/summary';
import { categoryName } from '@/lib/engine/categorize/categories';
import { getCategoryMeta } from '@/server/category-meta';
import { getProvider } from '@/lib/providers/demo';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { PAYMENT_ACCOUNT_TYPES } from '@/lib/engine/settings/dials';

export interface RecurringData {
  summary: RecurringSummary;
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

  const accountNames: Record<string, string> = {};
  for (const a of snap.accounts) accountNames[a.id] = a.name;

  // Resolve each category once through the merged meta (custom + system) so a
  // recurring series filed under a custom category shows its name (DECISIONS #111).
  const meta = await getCategoryMeta(userId);
  const categoryNames: Record<string, string> = {};
  for (const it of summary.items) {
    if (!(it.categoryId in categoryNames)) categoryNames[it.categoryId] = categoryName(it.categoryId, meta);
  }
  return { summary, accountNames, categoryNames };
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
      account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] } },
      status: 'POSTED',
      isSplitParent: false,
    },
    select: { id: true, accountId: true, date: true, amountCents: true, rawDescriptor: true, isTransfer: true },
  });
  const series = detectRecurring(txns as RecurringTxn[], today);

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
  const scheduledRows = paymentAccountId ? toScheduledTransactions(series, paymentAccountId) : [];

  // Full replace, atomically. Only the DETECTED scheduled rows are swapped — the
  // user's own / autopay / seed scheduled rows are left intact.
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
