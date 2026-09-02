/**
 * Recurring/subscription re-detection after ingest (ROADMAP #1b, DECISIONS #22 tail).
 * After a Plaid sync brings in new transactions (per-row normalize→rules→categorize→
 * transfer is already done), recompute the user's recurring series and the detected
 * ScheduledTransaction projections that feed the cash-needed/FI/calendar views, and
 * persist them (full replace). Pure detection lives in engine/recurring/detect.ts;
 * this is the thin server-side persist.
 */
import type { Prisma } from '@/generated/prisma/client';
import { type ISODate, isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import {
  type RecurringTxn,
  type SeriesProjectionStatus,
  classifySeriesProjection,
  detectRecurring,
  toScheduledRow,
} from '@/lib/engine/recurring/detect';
import { confirmedPauseState } from '@/lib/engine/income/pause';
import { getRecurringOverrides } from '@/server/recurring-overrides';
import { getRecurringPaidThrough } from '@/server/recurring-paid-through';
import { summarizeRecurring, type RecurringSummary } from '@/lib/engine/recurring/summary';
import { upcomingRenewals, type UpcomingRenewals } from '@/lib/engine/recurring/renewals';
import { categoryName } from '@/lib/engine/categorize/categories';
import { getCategoryMeta } from '@/server/category-meta';
import { getReconciliationBoundary } from '@/server/reconciliation';
import { collapseHandoverDuplicates } from '@/lib/engine/account/reconcile-boundary';
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

  const [overrides, paidThrough] = await Promise.all([
    getRecurringOverrides(userId),
    getRecurringPaidThrough(userId),
  ]);
  const series = detectRecurring(txns, isoDate(today), overrides, paidThrough);
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

/**
 * A stable, id-free digest of the derived rows this function replaces — the input to
 * "did this refresh actually move anything a reader can see?" (L.28).
 *
 * Each row's OWN `id` is excluded deliberately. The write below is a full
 * delete-then-create, so every row is minted a new cuid on every single sync; an
 * id-bearing comparison would answer "changed" every time, which is exactly as useless
 * as never answering it, just in the opposite direction. The FOREIGN keys — `merchantId`
 * and `accountId` — are INCLUDED and must stay so: they are stable across the replace,
 * and a series re-keyed from a superseded predecessor onto the live account is the
 * exact change L.26 exists to make (an earlier draft of this sentence said "ids are
 * excluded", which would have told the next maintainer to delete that signal).
 *
 * Everything selected is a plain scalar — the four date-typed columns here
 * (`priceChangedAt`, `lastSeenAt`, `nextExpectedAt`, `nextDate`) are all `String`
 * YYYY-MM-DD, not `DateTime` — so this is an exact value comparison with no driver
 * coercion sitting in the middle of it (the L.27 lesson: a driver-parsed value is not
 * the stored value).
 *
 * Read on both sides of the write rather than diffing the built rows against the
 * stored ones, so both halves come back through the same driver in the same shape and
 * an `undefined` where the column holds `null` cannot masquerade as a change.
 */
async function derivedProjectionDigest(userId: string): Promise<string> {
  const [series, scheduled] = await Promise.all([
    prisma.recurringSeries.findMany({
      where: { userId },
      select: {
        merchantId: true,
        cadence: true,
        typicalAmountCents: true,
        lastAmountCents: true,
        previousAmountCents: true,
        possiblyUnused: true,
        priceChangedAt: true,
        lastSeenAt: true,
        nextExpectedAt: true,
        isSubscription: true,
        // L.30, and L.28's own defect class reintroduced without it (critic P2-5,
        // executed twice): the label beside the fixed-expenses figure is DERIVED
        // from this column, so a sync that changes only the reason rewrites the
        // panel — including the first post-deploy sync, which closes the null
        // window for every existing row. Omitted, the digest reported
        // `changed: false` and the page repainted the stale sentence.
        projectionStatus: true,
      },
    }),
    prisma.scheduledTransaction.findMany({
      where: { account: { userId }, source: { in: DETECTED_SCHEDULED_SOURCES } },
      select: {
        accountId: true,
        description: true,
        amountCents: true,
        nextDate: true,
        cadence: true,
        source: true,
      },
    }),
  ]);
  // Sorted, so a pure re-ordering of identical rows is not reported as a change.
  return [...series.map((r) => JSON.stringify(r)), ...scheduled.map((r) => JSON.stringify(r))]
    .sort()
    .join('\n');
}

export async function refreshRecurringForUser(
  userId: string,
  today: ISODate,
): Promise<{
  series: number;
  scheduled: number;
  /**
   * True when this run left the stored derived rows DIFFERENT from how it found them
   * — a new bill detected, an amount moved, a projected date rolled forward, a series
   * lapsed out, or a resumed income pause retired.
   *
   * It exists because a sync that ingests no transaction can still rewrite every
   * figure on the guilt-free breakdown: on the owner's live data L.26's re-keying
   * turned 0 stored scheduled rows into 8 ($684.31/month) during a sync that reported
   * `added: 0`, and the page had no way to know it should re-render.
   */
  changed: boolean;
}> {
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
  // U.13: the boundary now RELEASES the one handover day to both sides, so exactly the
  // "two same-day, same-amount copies" this comment warns about are back for that date.
  // Right for money (dropping either side deletes what only it reported); wrong here,
  // where a duplicate is a 0-day gap and cadence is inferred from gaps. Collapsed to one
  // occurrence per component for DETECTION only — see collapseHandoverDuplicates.
  // U.33: keep + released dates + the terminal map from ONE read of the link table. All three
  // land in the SAME `collapseHandoverDuplicates` call below, and this function PERSISTS what
  // that call feeds, so a mid-flight "Undo combine" desyncing them would be written down rather
  // than merely rendered. `terminalOf` is reused for the account-scope decision further down
  // (it was read a second time there) — one snapshot of the links decides this whole refresh.
  const { keepsReconciled, handoverDates, terminalOf } = await getReconciliationBoundary(userId);
  // O.13f: the reader's own verdicts, applied by the detector itself — so what this
  // function PERSISTS (RecurringSeries + the ScheduledTransaction rows feeding
  // cash-needed, forecast, the calendar and the spending plan) is the same set the
  // /recurring page shows him. A bill he declared is projected; a series he demoted
  // stops being projected here, which is the only place a projection is written.
  const series = detectRecurring(
    collapseHandoverDuplicates(
      txns.filter((t) => keepsReconciled(t.accountId, t.date)),
      handoverDates,
      terminalOf,
    ) as RecurringTxn[],
    today,
    await getRecurringOverrides(userId),
    await getRecurringPaidThrough(userId),
  );

  // RecurringSeries.merchantId is required; resolve canonical → Merchant.id. Series
  // whose merchant has no row are skipped (mirrors the seed). The Plaid ingest
  // upserts a Merchant per row, so detected canonicals resolve after a sync.
  const canonicals = [...new Set(series.map((s) => s.merchantCanonical))];
  const merchants = canonicals.length
    ? await prisma.merchant.findMany({ where: { canonical: { in: canonicals } }, select: { id: true, canonical: true } })
    : [];
  const merchantId = new Map(merchants.map((m) => [m.canonical, m.id]));

  // Two scopes, deliberately different (L.25 — see toScheduledTransactions' docblock
  // for why they are not symmetric).
  //
  // EXPENSES: every CHECKING/SAVINGS account, not the one resolved payment account.
  // Projecting only the payment account meant a bill autopaid from a second checking
  // or from savings reached no projection at all — a monthly rate on /recurring and $0
  // in the spending plan's fixed term, which overstates guilt-free spending by the
  // bill's whole share. The three consumers that walk a SINGLE account's balance
  // (cash-needed's assemble, forecast, radar) re-filter to the payment account
  // themselves, so widening here cannot leak a savings-paid bill into a checking
  // balance walk.
  //
  // INCOME: the payment account alone, exactly as before. A deposit landing in savings
  // must not shrink the L.11(D) reservation held against card payments that leave
  // checking (the claims critic's P1-1 on the first draft of this slice).
  //
  // CREDIT is excluded on purpose: a subscription charged to a card is already inside
  // the plan's card-obligation term and on the calendar inside that card's due amount.
  //
  // Superseded predecessors stay out of the SCOPE for the same reason
  // resolvePaymentAccount excludes them: a boundary-zeroed ghost funds nothing, and
  // the consumers that walk a live balance would drop a row landed there anyway.
  // What this once claimed — that "a reconciled-away account's series is a dead
  // bill" — was FALSE and cost the owner every cash-paid bill on the guilt-free
  // breakdown: re-linking an account does not retire its bills, it moves them. They
  // are re-keyed onto the live successor below (L.26) rather than dropped.
  // U.33: `terminalOf` is NOT re-read here. It was, and it was the same call with the same
  // argument as the one feeding the collapse above — so this function decided which duplicates
  // to collapse against one snapshot of the links and which accounts are in scope against
  // another, with detection and merchant resolution running in between.
  const [user, accounts, digestBefore] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { paymentAccountId: true } }),
    prisma.account.findMany({ where: { userId }, select: { id: true, type: true } }),
    // Read here because this is the last point in the function before anything is
    // written. It is not free: the digest is two `findMany` calls and it runs again
    // after the write, so the signal costs four queries per refresh over the user's
    // own series and detected scheduled rows (tens of rows). Joining this `Promise.all`
    // saves the before-read a sequential await, not the queries.
    derivedProjectionDigest(userId),
  ]);
  // The key set IS `activeSupersededPredecessorIds` (same links, same effectiveness
  // rule) — read once, used for both halves of the boundary below.
  const superseded = new Set(terminalOf.keys());
  const cashAccountIds = new Set(
    accounts
      .filter((a) => (PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(a.type) && !superseded.has(a.id))
      .map((a) => a.id),
  );
  // Read ONLY to name an absence, never to admit a row (L.30): a bill charged to
  // a card is correctly outside the fixed-expense term because the card-payment
  // term holds it, and a bill charged to an account the projection cannot read is
  // not correctly outside anything. Those two $0.00 lines were the same pixel.
  const creditAccountIds = new Set(accounts.filter((a) => a.type === 'CREDIT').map((a) => a.id));
  // The same resolution order this function has always used, now only for income.
  const paymentAccountId =
    (user?.paymentAccountId && cashAccountIds.has(user.paymentAccountId) ? user.paymentAccountId : null) ??
    accounts.find((a) => cashAccountIds.has(a.id))?.id ??
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
  /** Income canonicals the reader has confirmed as paused — excluded from the
   *  projections below, and recorded as `income-paused` rather than silently
   *  dropped (L.30). */
  const pausedIncome = new Set<string>();
  let retiredConfirmations = 0;
  /** Queued for the replace transaction below, so consent and rows commit together. */
  let retireConfirmations: Prisma.PrismaPromise<unknown> | null = null;
  if (confirmations.length > 0) {
    const resumed: string[] = [];
    for (const c of confirmations) {
      const state = confirmedPauseState(series, today, c.merchantCanonical);
      if (state.status === 'paused') pausedIncome.add(c.merchantCanonical);
      else if (state.status === 'resumed') resumed.push(c.merchantCanonical);
    }
    if (resumed.length > 0) {
      // Retiring a confirmation is not visible in the digest below — it lives in a
      // third table — but it changes what the feed's HANDLED row says, so it counts.
      //
      // It is DEFERRED into the replace transaction rather than committed here (critic
      // P2-1). Standing alone it committed on its own, so a throw anywhere after this
      // point — inside `toScheduledTransactions`, or an FK/lock failure inside the
      // `$transaction` — left the user's consent retired for good while the caller's
      // catch reported that nothing had changed. It is now the same all-or-nothing as
      // the rows it accompanies, which is what the providers' catch comments assert.
      retireConfirmations = prisma.incomePauseConfirmation.deleteMany({
        where: { userId, merchantCanonical: { in: resumed } },
      });
      retiredConfirmations = resumed.length;
    }
  }
  // RE-KEY A SERIES OFF A SUPERSEDED PREDECESSOR ONTO THE LIVE ACCOUNT (L.26).
  //
  // A series' `accountId` is the account of its most recent KEPT charge. After a
  // re-link, the reconciliation keep rule bounds the predecessor at its cutover and
  // the successor starts there — so every bill whose last charge predates the
  // cutover carries the PREDECESSOR's id, which the scope filters immediately below
  // exclude (expenses: not in `cashAccountIds`; income: not the payment account).
  // The bill is real, it is still charging, and it was projected NOWHERE: the owner's
  // production data on 2026-07-26 detected 21 series and wrote 0 scheduled rows,
  // reading "Fixed & recurring expenses — $0.00" on the guilt-free breakdown while
  // a student loan, an insurance premium and a retirement contribution were all
  // charging on the re-linked checking account.
  //
  // Re-keying, not admitting: a scheduled row on the boundary-zeroed predecessor
  // would still be dropped by the three consumers that walk ONE live account's
  // balance (cash-needed, forecast, radar), so the money must arrive on the account
  // that actually carries it — the same terminal successor `applyReconciliationBoundary`
  // re-keys a predecessor's stored scheduled rows onto (F6). It cannot widen scope
  // by type: an effective link is same-type by construction, so a CREDIT predecessor
  // maps to a CREDIT successor and stays out of the cash set exactly as before.
  //
  // ONE PASS, so a stored series and the projected rows can never tell different
  // stories (L.30). Both the row set and the per-series REASON come from
  // `classifySeriesProjection`; the two `.filter`s this used to call threw the
  // reason away, which is how a $0.00 fixed-expense line came to mean four
  // different things and print one pixel.
  const classified = series.map((s) => {
    const to = terminalOf.get(s.accountId);
    const onLive = to === undefined || to === s.accountId ? s : { ...s, accountId: to };
    const status: SeriesProjectionStatus =
      onLive.isIncome && pausedIncome.has(onLive.merchantCanonical)
        ? 'income-paused'
        : classifySeriesProjection(onLive, { paymentAccountId, cashAccountIds, creditAccountIds }, today);
    return { series: onLive, status };
  });
  const scheduledRows = classified.filter((c) => c.status === 'counted').map((c) => toScheduledRow(c.series));

  // RecurringSeries.merchantId is required; series whose merchant has no row are
  // skipped (mirrors the seed). Built from the SAME classified list as the rows
  // above so `projectionStatus` describes the account the projection actually
  // read — the re-keyed one, not the superseded predecessor the charge landed on.
  const seriesRows = classified
    .filter((c) => merchantId.has(c.series.merchantCanonical))
    .map(({ series: s, status }) => ({
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
      projectionStatus: status,
    }));

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
    // Retiring a resumed income-pause confirmation rides along, so the user's consent
    // and the projections it governs can never disagree after a partial failure.
    ...(retireConfirmations ? [retireConfirmations] : []),
  ]);

  const digestAfter = await derivedProjectionDigest(userId);
  return {
    series: seriesRows.length,
    scheduled: scheduledRows.length,
    changed: digestAfter !== digestBefore || retiredConfirmations > 0,
  };
}
