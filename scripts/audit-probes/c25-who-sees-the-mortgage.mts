/**
 * READ-ONLY production probe — C.25: which surfaces can see the owner's
 * transfer-flagged mortgage, and which double-count it?
 *
 * Every statement is a SELECT. Nothing is written.
 *
 * C.25 (from C.24/#394) asserts three residuals. Residual (1) says the radar,
 * /calendar, cash-needed and the L.30 census "stay blind to the bill the plan
 * reserves" because no `loanPayment` keep reaches detection outside the plan.
 * Before building a keep, MEASURE the claim — the radar already expands
 * `selectLoanObligations` → `loanObligationsToScheduledFlows` into its committed
 * line, so the LOAN side may already be carrying this bill, in which case adding
 * a checking-side series would DOUBLE it (the #134 residual, whose disclosure
 * only fires on a normalizer `auto-loan` verdict and so cannot fire here).
 *
 * Printed, in order:
 *   1. the LOAN/MORTGAGE accounts and whether `selectLoanObligations` dates them;
 *   2. the stored ScheduledTransaction rows (what /calendar + forecast read);
 *   3. the structural loan-payment merchant set (C.24's engine, real rows);
 *   4. the radar's burn: `discretionaryDailyOutflows` + `computeBurnRates` as the
 *      server builds them today, then again with the loan-payment merchants
 *      excluded — the delta is residual (1)'s wrong figure, if it is one;
 *   5. residual (2): month-by-month `countsInFlows` for the merchant's rows.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { selectLoanObligations } from '../../src/lib/engine/loans/obligations';
import { loanObligationsToScheduledFlows, expandScheduled } from '../../src/lib/engine/forecast/forecast';
import { loanPaymentMerchantCanonicals, planTransferUpdates } from '../../src/lib/engine/categorize/transfers';
import { normalizeMerchant } from '../../src/lib/engine/categorize/normalize';
import {
  computeBurnRates,
  discretionaryDailyOutflows,
  paymentAccountHistoryDays,
} from '../../src/lib/engine/radar/burn';
import { detectRecurring, type RecurringTxn } from '../../src/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES } from '../../src/lib/engine/recurring/override';
import { countsInFlows, type TxnLike } from '../../src/lib/engine/fi/insights';
import { holidayTable, isoDate, monthKey } from '../../src/lib/dates';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const money = (v: number) =>
  `${v < 0 ? '-' : ''}$${Math.abs(v / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The owner = the account with real linked items (never the shared demo row).
const users = await c.query<{ id: string; email: string; paymentAccountId: string | null }>(
  `select u.id, u.email, u."paymentAccountId" from "User" u
   where exists (select 1 from "Account" a where a."userId" = u.id and a."plaidItemId" is not null)
   order by u.id asc`,
);
if (users.rows.length === 0) throw new Error('no linked user found');
const user = users.rows[0];
console.log(`user ${user.id} <${user.email}>  paymentAccountId=${user.paymentAccountId ?? '(none)'}`);

// `now()` from the database, as text — never a driver-parsed timestamp (L.27).
const nowRow = await c.query<{ today: string }>(`select to_char(now(), 'YYYY-MM-DD') as today`);
const today = isoDate(nowRow.rows[0].today);
console.log(`today (db) = ${today}\n`);

type AccountRow = {
  id: string;
  name: string;
  displayName: string | null;
  type: string;
  minimumPaymentCents: string | null;
  dueDayOfMonth: number | null;
  feedDroppedAt: string | null;
  mask: string | null;
  currency: string | null;
};
const accounts = (
  await c.query<AccountRow>(
    `select id, name, "displayName", type, "minimumPaymentCents"::text, "dueDayOfMonth",
            "feedDroppedAt", mask, currency
     from "Account" where "userId" = $1 order by type, name`,
    [user.id],
  )
).rows;
const num = (s: string | null) => (s === null ? null : Number(s));

console.log('══ 1. LOAN/MORTGAGE accounts — does selectLoanObligations date them? ══');
const loanAccounts = accounts.filter((a) => a.type === 'LOAN' || a.type === 'MORTGAGE');
for (const a of loanAccounts) {
  console.log(
    `  ${a.type.padEnd(8)} ${a.name} (${a.mask ?? '----'})  minimumPaymentCents=${a.minimumPaymentCents ?? 'NULL'}  dueDayOfMonth=${a.dueDayOfMonth ?? 'NULL'}  feedDroppedAt=${a.feedDroppedAt ?? 'null'}`,
  );
}
const year = Number(today.slice(0, 4));
const obligations = selectLoanObligations({
  accounts: accounts.map((a) => ({
    id: a.id,
    name: a.name,
    displayName: a.displayName,
    type: a.type,
    minimumPaymentCents: num(a.minimumPaymentCents),
    dueDayOfMonth: a.dueDayOfMonth,
    feedDroppedAt: a.feedDroppedAt,
  })),
  today,
  holidays: holidayTable(year - 1, year + 1),
});
console.log(`  → selectLoanObligations: ${obligations.length} obligation(s)`);
for (const o of obligations) {
  console.log(`     ${o.accountName}  ${money(o.paymentCents)} due ${o.dueDate} (effective ${o.effectiveDueDate})`);
}
const loanEvents = expandScheduled(loanObligationsToScheduledFlows(obligations), today, 90);
console.log(`  → radar/forecast committed events from the LOAN side, 90d: ${loanEvents.length}`);
for (const e of loanEvents.slice(0, 8)) console.log(`     ${e.date}  ${money(e.amountCents)}  ${e.label}`);

console.log('\n══ 2. Stored ScheduledTransaction rows (what /calendar + forecast read) ══');
const scheduled = (
  await c.query<{ id: string; accountId: string; description: string; amountCents: string; nextDate: string; cadence: string | null; source: string | null }>(
    `select s.id, s."accountId", s.description, s."amountCents"::text, s."nextDate", s.cadence, s.source
     from "ScheduledTransaction" s join "Account" a on a.id = s."accountId"
     where a."userId" = $1 order by s."nextDate"`,
    [user.id],
  )
).rows;
console.log(`  ${scheduled.length} row(s)`);
for (const s of scheduled) {
  console.log(
    `     ${s.nextDate}  ${money(Number(s.amountCents)).padStart(12)}  ${s.cadence ?? '—'}  ${s.description}  [${s.source ?? '—'}]  canonical=${normalizeMerchant(s.description).canonical}`,
  );
}

console.log('\n══ 3. The structural loan-payment merchant set (C.24 engine, real rows) ══');
type TxnRow = {
  id: string;
  accountId: string;
  date: string;
  amountCents: string;
  rawDescriptor: string;
  isTransfer: boolean;
  isSplitParent: boolean;
  status: string;
  categoryId: string | null;
  excludeFromTotals: boolean | null;
};
const txnRows = (
  await c.query<TxnRow>(
    `select t.id, t."accountId", t.date, t."amountCents"::text, t."rawDescriptor", t."isTransfer",
            t."isSplitParent", t.status, t."categoryId", t."excludeFromTotals"
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where a."userId" = $1 and (a.currency is null or a.currency = 'USD')
     order by t.date`,
    [user.id],
  )
).rows;
const typeById = new Map(accounts.map((a) => [a.id, a.type]));
const loanPaymentMerchants = loanPaymentMerchantCanonicals(
  txnRows
    .filter((t) => t.status === 'POSTED')
    .map((t) => ({
      accountId: t.accountId,
      date: t.date,
      amountCents: Number(t.amountCents),
      rawDescriptor: t.rawDescriptor,
      isTransfer: t.isTransfer,
    })),
  typeById,
);
console.log(`  set = {${[...loanPaymentMerchants].join(', ')}}`);

console.log('\n══ 4. Residual (1): the radar burn, with and without the loan-payment merchants ══');
const paymentId =
  user.paymentAccountId && typeById.get(user.paymentAccountId) === 'CHECKING'
    ? user.paymentAccountId
    : (accounts.find((a) => a.type === 'CHECKING')?.id ?? null);
console.log(`  payment account = ${paymentId ?? '(none)'} (${accounts.find((a) => a.id === paymentId)?.name ?? '—'})`);
if (paymentId !== null) {
  const burnTxns = txnRows.map((t) => ({
    accountId: t.accountId,
    date: t.date,
    amountCents: Number(t.amountCents),
    rawDescriptor: t.rawDescriptor,
    status: t.status,
    isTransfer: t.isTransfer,
    isSplitParent: t.isSplitParent,
    excludeFromTotals: t.excludeFromTotals,
  }));
  // Exactly how server/radar.ts builds excludedCanonicals today.
  const excluded = new Set<string>();
  for (const s of scheduled) {
    if (s.accountId === paymentId) excluded.add(normalizeMerchant(s.description).canonical);
  }
  const recurringTxns: RecurringTxn[] = burnTxns
    .filter((t) => t.status === 'POSTED' && !t.isSplitParent && t.accountId === paymentId)
    .map((t, i) => ({
      id: String(i),
      accountId: t.accountId,
      date: t.date,
      amountCents: t.amountCents,
      rawDescriptor: t.rawDescriptor,
      isTransfer: t.isTransfer,
    }));
  const overrideRows = (
    await c.query<{ merchantCanonical: string; decision: string; cadence: string | null; declaredSign: string | null }>(
      `select "merchantCanonical", decision, cadence, "declaredSign" from "RecurringOverride" where "userId" = $1`,
      [user.id],
    )
  ).rows;
  const overrides = overrideRows.length
    ? overrideRows.map((r) => ({
        merchantCanonical: r.merchantCanonical,
        decision: r.decision,
        cadence: r.cadence,
        declaredSign: r.declaredSign,
      }))
    : NO_RECURRING_OVERRIDES;
  const detected = detectRecurring(recurringTxns, today, overrides as never);
  for (const s of detected) excluded.add(s.merchantCanonical);
  console.log(`  detected series on the payment account: ${detected.length}`);
  console.log(`  loan-payment merchants ALREADY excluded from burn? ${[...loanPaymentMerchants].map((m) => `${m}=${excluded.has(m)}`).join(', ') || '(set empty)'}`);

  const historyDays = paymentAccountHistoryDays(burnTxns, paymentId, today);
  const before = computeBurnRates(
    discretionaryDailyOutflows(burnTxns, { paymentAccountId: paymentId, excludedCanonicals: excluded, today }),
    historyDays,
  );
  const widened = new Set([...excluded, ...loanPaymentMerchants]);
  const after = computeBurnRates(
    discretionaryDailyOutflows(burnTxns, { paymentAccountId: paymentId, excludedCanonicals: widened, today }),
    historyDays,
  );
  console.log(
    `  burn TODAY   typical ${money(before.typicalDailyCents)}/day  heavy ${money(before.heavyDailyCents)}/day  (sampleDays ${before.sampleDays}, enough=${before.hasEnoughHistory})`,
  );
  console.log(
    `  burn WIDENED typical ${money(after.typicalDailyCents)}/day  heavy ${money(after.heavyDailyCents)}/day`,
  );
  // Which loan-payment rows are actually inside the 56-day burn window?
  const windowStart = isoDate(new Date(Date.parse(`${today}T00:00:00Z`) - 56 * 86400000).toISOString().slice(0, 10));
  for (const t of burnTxns) {
    if (t.accountId !== paymentId || t.amountCents >= 0) continue;
    const canon = normalizeMerchant(t.rawDescriptor).canonical;
    if (!loanPaymentMerchants.has(canon)) continue;
    const inWindow = t.date >= windowStart && t.date < today;
    console.log(
      `     row ${t.date} ${money(t.amountCents)} "${t.rawDescriptor}" isTransfer=${t.isTransfer} inBurnWindow=${inWindow}`,
    );
  }
}

console.log('\n══ 5. Residual (2): countsInFlows month by month, for the loan-payment merchants ══');
for (const t of txnRows) {
  const canon = normalizeMerchant(t.rawDescriptor).canonical;
  if (!loanPaymentMerchants.has(canon)) continue;
  const like: TxnLike = {
    amountCents: Number(t.amountCents),
    isTransfer: t.isTransfer,
    categoryId: t.categoryId,
    isSplitParent: t.isSplitParent,
    status: t.status,
    excludeFromTotals: t.excludeFromTotals,
  } as TxnLike;
  console.log(
    `  ${monthKey(isoDate(t.date))} ${t.date} ${money(Number(t.amountCents)).padStart(12)} filed=${t.categoryId ?? 'null'} isTransfer=${t.isTransfer} countsInFlows=${countsInFlows(like)}`,
  );
}

console.log('\n══ 6. The C.25 sweep, replayed over production rows (READ-ONLY — no write) ══');
{
  // Exactly what `refreshTransferFlags` will hand the engine on the next sync:
  // every non-split row of every account, with its account type.
  const planRows = (
    await c.query<TxnRow & { currency: string | null }>(
      `select t.id, t."accountId", t.date, t."amountCents"::text, t."rawDescriptor", t."isTransfer",
              t."isSplitParent", t.status, t."categoryId", t."excludeFromTotals", a.currency
       from "Transaction" t join "Account" a on a.id = t."accountId"
       where a."userId" = $1 and t."isSplitParent" = false
       order by t.date`,
      [user.id],
    )
  ).rows;
  const typesForPlan = new Map(accounts.map((a) => [a.id, a.type]));
  const stateTxns = planRows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    date: r.date,
    amountCents: Number(r.amountCents),
    rawDescriptor: r.rawDescriptor,
    isTransfer: r.isTransfer,
    needsReview: false, // filing is not what this measurement is about
    reviewPinned: false,
    status: r.status,
    currencySupported: r.currency === null || r.currency === 'USD',
  }));
  const before = new Set(planRows.filter((r) => r.isTransfer).map((r) => r.id));
  const plan = planTransferUpdates(stateTxns, typesForPlan);
  const newlyFlagged = plan.flagIds.filter((id) => !before.has(id));
  console.log(`  rows the next sync would newly flag: ${newlyFlagged.length}`);
  const byMerchant = new Map<string, { count: number; cents: number; months: string[] }>();
  const rowById = new Map(planRows.map((r) => [r.id, r]));
  for (const id of newlyFlagged) {
    const r = rowById.get(id)!;
    const canon = normalizeMerchant(r.rawDescriptor).canonical;
    const e = byMerchant.get(canon) ?? { count: 0, cents: 0, months: [] };
    e.count += 1;
    e.cents += Number(r.amountCents);
    e.months.push(`${monthKey(isoDate(r.date))} ${money(Number(r.amountCents))}`);
    byMerchant.set(canon, e);
  }
  for (const [canon, e] of byMerchant) {
    console.log(`     ${canon}: ${e.count} row(s), ${money(e.cents)} total`);
    for (const m of e.months) console.log(`        ${m}`);
  }
  // The month totals that move: outflows leaving `countsInFlows`.
  const perMonth = new Map<string, number>();
  for (const id of newlyFlagged) {
    const r = rowById.get(id)!;
    const like = {
      amountCents: Number(r.amountCents),
      isTransfer: false,
      categoryId: r.categoryId,
      isSplitParent: r.isSplitParent,
      status: r.status,
      excludeFromTotals: r.excludeFromTotals,
    } as TxnLike;
    if (!countsInFlows(like) || Number(r.amountCents) >= 0) continue;
    const m = monthKey(isoDate(r.date));
    perMonth.set(m, (perMonth.get(m) ?? 0) + -Number(r.amountCents));
  }
  console.log('  month totals that change (spending removed):');
  for (const [m, v] of [...perMonth].sort()) console.log(`     ${m}  -${money(v)}`);
}

await c.end();
