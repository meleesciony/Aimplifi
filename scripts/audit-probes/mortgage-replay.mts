/**
 * READ-ONLY production replay — C.0: the owner's mortgage row (gates C.4/C.5).
 * Post-C.24 (#394) it also measures the fix: the structural loan-payment set,
 * the rollup with `excludeMerchantCanonicals`, and the unconditional union leg.
 *
 * Every statement is a SELECT. Nothing is written.
 *
 * Question (docs/CALC_AUDIT_2026-08-02.md "Next measurement"): for the mortgage,
 * print Transaction.categoryId, isTransfer, and whether a RecurringSeries exists
 * for it (plus the resolved series categoryId) — then run the REAL Fixed union
 * (rollup + recurringOutsideFixedCategoryCents) over the real rows and watch
 * whether the P0-4 double-count and/or the P0-5 constant-divisor defect is LIVE
 * on this account. Never a re-implementation: the engine functions themselves
 * run over the production rows (o12 method).
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { applyReconciliationBoundary } from '../../src/lib/engine/account/reconcile-boundary';
import { countsInFlows, type TxnLike } from '../../src/lib/engine/fi/insights';
import {
  averageMonthlySpendByCategory,
  filedCategoryByMerchant,
  resolveFixedCategoryAmounts,
} from '../../src/lib/engine/spending-plan/fixed-category-amounts';
import { suggestedCategoryIsFixed } from '../../src/lib/engine/spending-plan/spend-class';
import {
  fixedSpendCategoryIdsInMonths,
  monthlyNonDiscretionaryCents,
} from '../../src/lib/engine/spending-plan/fixed-pattern';
import {
  PLAN_FIXED_NEVER_CATEGORY_IDS,
  monthlyRateCents,
  recurringOutsideFixedCategoryCents,
  type PlanScheduledItem,
} from '../../src/lib/engine/spending-plan/plan';
import {
  categoryName,
  mergeCategoryMeta,
  type CustomCategoryInput,
} from '../../src/lib/engine/categorize/categories';
import { normalizeMerchant } from '../../src/lib/engine/categorize/normalize';
import {
  classifySeriesProjection,
  detectRecurring,
  type RecurringTxn,
} from '../../src/lib/engine/recurring/detect';
import { loanPaymentMerchantCanonicals } from '../../src/lib/engine/categorize/transfers';
import { overrideKey, parseRecurringOverride, type RecurringOverrideInput } from '../../src/lib/engine/recurring/override';
import { SPENDING_ACCOUNT_TYPES } from '../../src/lib/engine/transactions/query';
import { PAYMENT_ACCOUNT_TYPES } from '../../src/lib/engine/settings/dials';
import { isoDate, monthKey, type ISODate } from '../../src/lib/dates';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${Math.abs(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await c.query(sql, params)).rows as T[];
const head = (s: string) => console.log(`\n${'='.repeat(72)}\n${s}\n${'='.repeat(72)}`);

// ---------------------------------------------------------------- who + when
const users = await q<{ id: string; email: string; txns: number }>(
  `select u.id, u.email,
          (select count(*)::int from "Transaction" t
             join "Account" a on a.id = t."accountId" where a."userId" = u.id) as txns
     from "User" u order by txns desc`,
);
const OWNER = process.env.OWNER_ID ?? users[0].id;
console.log(`OWNER = ${OWNER} (${users.find((u) => u.id === OWNER)?.email})`);
const today = (await q<{ d: string }>(`select to_char(current_date,'YYYY-MM-DD') as d`))[0].d as ISODate;
console.log(`today (db) = ${today}`);

const [user] = await q<{ paymentAccountId: string | null; planFixedOverrideCents: number | null }>(
  `select "paymentAccountId", "planFixedOverrideCents" from "User" where id = $1`,
  [OWNER],
);
console.log({
  paymentAccountId: user.paymentAccountId,
  planFixedOverrideCents: user.planFixedOverrideCents,
  note: user.planFixedOverrideCents != null
    ? 'FIXED OVERRIDE SET — the suggestion below is not what renders as the term'
    : 'no fixed override — the suggested Fixed IS the term',
});

// ---------------------------------------------------------------- inputs
const accounts = await q<{
  id: string; type: string; name: string; currency: string | null;
  currentBalanceCents: number; provider: string | null; feedDroppedAt: string | null;
}>(
  `select id, type, name, currency, "currentBalanceCents", provider,
          "feedDroppedAt"::text as "feedDroppedAt"
     from "Account" where "userId" = $1 order by type, name`,
  [OWNER],
);
const links = await q<{ predecessorAccountId: string; successorAccountId: string; cutoverDate: string }>(
  `select "predecessorAccountId", "successorAccountId", "cutoverDate"
     from "AccountReconciliation" where "userId" = $1 and "undoneAt" is null`,
  [OWNER],
);
const rows = await q<{
  id: string; accountId: string; date: string; amountCents: number; rawDescriptor: string;
  categoryId: string | null; status: string; isTransfer: boolean; isSplitParent: boolean;
  excludeFromTotals: boolean; spendClassOverride: string | null;
}>(
  `select t.id, t."accountId", t.date, t."amountCents", t."rawDescriptor", t."categoryId",
          t.status, t."isTransfer", t."isSplitParent", t."excludeFromTotals", t."spendClassOverride"
     from "Transaction" t join "Account" a on a.id = t."accountId"
    where a."userId" = $1 order by t.date`,
  [OWNER],
);
console.log(`accounts=${accounts.length} links=${links.length} transactions=${rows.length}`);

// The boundary the snapshot applies once before any engine sees a row.
const boundary = applyReconciliationBoundary({
  paymentAccountId: user.paymentAccountId,
  accounts: accounts.map((a) => ({ id: a.id, type: a.type, currency: a.currency, currentBalanceCents: a.currentBalanceCents })),
  transactions: rows.map((r): TxnLike & { id: string; accountId: string } => ({
    id: r.id, date: r.date, amountCents: r.amountCents, rawDescriptor: r.rawDescriptor,
    accountId: r.accountId, isTransfer: r.isTransfer, status: r.status,
    categoryId: r.categoryId, isSplitParent: r.isSplitParent, excludeFromTotals: r.excludeFromTotals,
    spendClassOverride: r.spendClassOverride,
  })),
  balanceSnapshots: [] as Array<{ accountId: string; date: string }>,
  statements: [] as Array<{ accountId: string; cycleEnd: string }>,
  scheduled: [] as Array<{ accountId: string }>,
  links,
});
const snapTxns = boundary.transactions as Array<TxnLike & { id: string; accountId: string }>;
console.log(`after boundary: ${snapTxns.length} rows (${rows.length - snapTxns.length} overlap rows dropped)`);

// Per-user category machinery, from the same tables the server helpers read.
const customRows = await q<{ id: string; name: string; group: string | null; discretionary: boolean }>(
  `select id, name, "group", discretionary from "Category" where "userId" = $1 and "isSystem" = false`,
  [OWNER],
);
const renameRows = await q<{ categoryId: string; name: string }>(
  `select "categoryId", name from "CategoryRename" where "userId" = $1`,
  [OWNER],
);
const custom: CustomCategoryInput[] = customRows.map((r) => ({
  id: r.id, name: r.name, group: r.group ?? 'Transfers & Other', discretionary: r.discretionary,
}));
const meta = mergeCategoryMeta(custom, new Map(renameRows.map((r) => [r.categoryId, r.name])));
// #397: no more CategoryFixedOverride — the guess input is the recurring-bill
// merchant set (stored outflow series + BILL verdicts − NOT_BILL), keyed by
// overrideKey exactly like src/server/recurring-bill-merchants.ts.
const seriesRows = await q<{ canonical: string }>(
  `select m.canonical from "RecurringSeries" rs join "Merchant" m on m.id = rs."merchantId"
    where rs."userId" = $1 and rs."typicalAmountCents" < 0`,
  [OWNER],
);
const budgetRows = await q<{ categoryId: string; monthCents: number }>(
  `select "categoryId", "monthCents" from "Budget" where "userId" = $1`,
  [OWNER],
);
const recurringOverrideRows = await q<{
  merchantCanonical: string; decision: string; cadence: string | null; declaredSign: string | null;
}>(
  `select "merchantCanonical", decision, cadence, "declaredSign"
     from "RecurringOverride" where "userId" = $1 order by "createdAt" asc`,
  [OWNER],
);
const recurringOverrides = recurringOverrideRows
  .map(parseRecurringOverride)
  .filter((o): o is RecurringOverrideInput => o !== null);
const fixedMerchants = new Set(seriesRows.map((r) => overrideKey(r.canonical)));
for (const o of recurringOverrides) {
  if (o.decision === 'BILL') fixedMerchants.add(overrideKey(o.merchantCanonical));
  else fixedMerchants.delete(overrideKey(o.merchantCanonical));
}
console.log(`custom=${custom.length} renames=${renameRows.length} fixedMerchants=${fixedMerchants.size} budgets=${budgetRows.length} recurringOverrides=${recurringOverrides.length}`);

// ------------------------------------------------ find the mortgage rows
head('MORTGAGE CANDIDATES — outflows ≥ $3,000 grouped by the normalizer canonical');
const bigOut = snapTxns.filter((t) => t.amountCents <= -300000);
const byCanon = new Map<string, typeof bigOut>();
for (const t of bigOut) {
  const canon = normalizeMerchant(t.rawDescriptor).canonical;
  const arr = byCanon.get(canon) ?? [];
  arr.push(t);
  byCanon.set(canon, arr);
}
const candidates = [...byCanon.entries()]
  .map(([canon, ts]) => ({ canon, ts }))
  .sort((a, b) => b.ts.length - a.ts.length || Math.abs(b.ts[0].amountCents) - Math.abs(a.ts[0].amountCents));
console.table(
  candidates.slice(0, 12).map(({ canon, ts }) => ({
    canonical: canon.slice(0, 34),
    normGuess: normalizeMerchant(ts[0].rawDescriptor ?? '').categoryId,
    n: ts.length,
    typical: money(ts[ts.length - 1].amountCents),
    filedCategories: [...new Set(ts.map((t) => t.categoryId ?? '(null)'))].join(','),
    transfer: [...new Set(ts.map((t) => String(t.isTransfer)))].join(','),
    dates: `${ts[0].date}..${ts[ts.length - 1].date}`,
  })),
);

head('THE C.0 QUESTION, PER LIKELY-MORTGAGE ROW (every row of the top repeat candidates)');
for (const { canon, ts } of candidates.slice(0, 4)) {
  console.log(`\n--- ${canon} (normalizer guess: ${normalizeMerchant(ts[0].rawDescriptor ?? '').categoryId}) ---`);
  console.table(
    ts.map((t) => ({
      date: t.date,
      amount: money(t.amountCents),
      categoryId: t.categoryId ?? '(null)',
      isTransfer: t.isTransfer,
      status: t.status,
      descriptor: (t.rawDescriptor ?? '').slice(0, 44),
    })),
  );
}

// Stored RecurringSeries rows for those canonicals (the "does a series EXIST" half).
head('STORED RecurringSeries ROWS for the candidates');
const canonList = candidates.slice(0, 8).map((x) => x.canon);
const seriesRows = await q<{
  merchantCanonical: string; merchantCategoryId: string | null; cadence: string;
  typicalAmountCents: number; projectionStatus: string | null; lastSeenAt: string;
}>(
  `select m.canonical as "merchantCanonical", m."defaultCategoryId" as "merchantCategoryId",
          rs.cadence, rs."typicalAmountCents", rs."projectionStatus", rs."lastSeenAt"::text as "lastSeenAt"
     from "RecurringSeries" rs join "Merchant" m on m.id = rs."merchantId"
    where rs."userId" = $1 and m.canonical = any($2)`,
  [OWNER, canonList],
);
if (seriesRows.length) {
  console.table(seriesRows.map((s) => ({ ...s, typical: money(s.typicalAmountCents) })));
} else {
  console.log('(no stored RecurringSeries row matches any candidate canonical)');
}

// ------------------------------------------- the REAL plan pipeline, replayed
// C.24: the structural loan-payment set, exactly as getSpendingPlan computes it
// (the probe reads ALL accounts' rows directly, so the loan-side counterpart
// the snapshot withholds is already here).
const accountTypeById = new Map(accounts.map((a) => [a.id, a.type]));
const loanPaymentMerchants = loanPaymentMerchantCanonicals(snapTxns, accountTypeById);
head(`C.24 STRUCTURAL LOAN-PAYMENT MERCHANTS (${loanPaymentMerchants.size})`);
console.table(
  [...loanPaymentMerchants].map((canon) => ({
    canonical: canon.slice(0, 44),
    rows: snapTxns.filter((t) => normalizeMerchant(t.rawDescriptor ?? '').canonical === canon).length,
  })),
);

// 1) counted expense series — countedExpenseSeriesForPlan reproduced verbatim
//    (BEFORE the rollup: the exactness invariant derives the exclusion set
//    from the series that actually made the union — excluded ⇔ unioned)
const spendingIds = new Set(
  accounts.filter((a) => (SPENDING_ACCOUNT_TYPES as readonly string[]).includes(a.type)).map((a) => a.id),
);
const recSource = snapTxns.filter(
  (t) => t.status === 'POSTED' && !t.isSplitParent && spendingIds.has(t.accountId),
);
const recTxns: RecurringTxn[] = recSource.map((t, i) => ({
  id: String(i), accountId: t.accountId, date: t.date,
  amountCents: t.amountCents, rawDescriptor: t.rawDescriptor ?? '', isTransfer: t.isTransfer,
  // C.24: the same mark countedExpenseSeriesForPlan now sets on flagged rows.
  ...(t.isTransfer
    ? { loanPayment: loanPaymentMerchants.has(normalizeMerchant(t.rawDescriptor ?? '').canonical) }
    : null),
}));
const terminalOf = new Map(links.map((l) => [l.predecessorAccountId, l.successorAccountId]));
const series = detectRecurring(recTxns, isoDate(today), recurringOverrides);
const superseded = new Set(terminalOf.keys());
const cashAccountIds = new Set(
  accounts
    .filter((a) => (PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(a.type) && !superseded.has(a.id))
    .map((a) => a.id),
);
const creditAccountIds = new Set(accounts.filter((a) => a.type === 'CREDIT').map((a) => a.id));
const paymentAccountId =
  (user.paymentAccountId && cashAccountIds.has(user.paymentAccountId) ? user.paymentAccountId : null) ??
  accounts.find((a) => cashAccountIds.has(a.id))?.id ??
  null;
const scope = { paymentAccountId, cashAccountIds, creditAccountIds };
const expenseSeries = series
  .filter((s) => !s.isIncome)
  .map((s) => {
    const to = terminalOf.get(s.accountId);
    return to === undefined || to === s.accountId ? s : { ...s, accountId: to };
  });
const withStatus = expenseSeries.map((s) => ({ s, status: classifySeriesProjection(s, scope, isoDate(today)) }));
const counted = withStatus.filter((x) => x.status === 'counted').map((x) => x.s);

head(`LIVE DETECT (countedExpenseSeriesForPlan replay) — ${series.length} series, ${expenseSeries.length} expense, ${counted.length} counted`);
console.table(
  withStatus.map(({ s, status }) => ({
    canonical: s.merchantCanonical.slice(0, 30),
    seriesCategoryId: s.categoryId,
    cadence: s.cadence,
    typical: money(s.typicalAmountCents),
    status,
  })),
);

// 3) the union half — the REAL recurringOutsideFixedCategoryCents, then a
//    per-item trace using the same rules, asserted equal to the real total.
// C.4: mirror the server exactly — the series' category resolves from its own
// rows' FILED ids (window-cents weighted; aggregates and the NEVER set guarded).
const filedByMerchant = filedCategoryByMerchant(recSource, today);
const resolveSeriesCategory = (s: (typeof counted)[number]): string | null => {
  const filed = filedByMerchant.get(s.merchantCanonical);
  return filed === undefined ||
    (PLAN_FIXED_NEVER_CATEGORY_IDS.has(filed) &&
      !(typeof s.categoryId === 'string' && PLAN_FIXED_NEVER_CATEGORY_IDS.has(s.categoryId)))
    ? s.categoryId
    : filed;
};
const scheduledFixed: PlanScheduledItem[] = counted.map((s) => ({
  amountCents: s.typicalAmountCents,
  cadence: s.cadence,
  categoryId: resolveSeriesCategory(s),
  loanPayment: loanPaymentMerchants.has(s.merchantCanonical),
  merchantCanonical: s.merchantCanonical,
}));
// C.24 exactness invariant (critic F1): only merchants whose series UNIONED
// leave the rollup / median basis.
const unionedLoanMerchants = new Set(
  scheduledFixed
    .filter((s) => s.loanPayment === true && typeof s.merchantCanonical === 'string')
    .map((s) => s.merchantCanonical!),
);
head(`C.24 UNIONED LOAN-PAYMENT MERCHANTS (${unionedLoanMerchants.size}) — the rollup/median exclusion set`);
console.log([...unionedLoanMerchants].join(', ') || '(none)');

// 2) rollup — resolveFixedCategoryAmounts exactly as server/spending-plan.ts
//    (C.24: with the same excludeMerchantCanonicals the server now passes)
const categoryFixed = resolveFixedCategoryAmounts({
  transactions: snapTxns,
  today,
  meta,
  fixedMerchants,
  budgetByCategory: new Map(budgetRows.map((b) => [b.categoryId, b.monthCents])),
  nameOf: (id) => categoryName(id, meta),
  excludeMerchantCanonicals: unionedLoanMerchants,
});
head(`FIXED CATEGORY ROLLUP (resolveFixedCategoryAmounts) — total ${money(categoryFixed.totalCents)}`);
console.table(
  categoryFixed.rows.map((r) => ({
    categoryId: r.categoryId,
    name: r.name.slice(0, 24),
    amount: money(r.amountCents),
    basis: r.basis,
    typical: money(r.typicalCents),
    budget: r.budgetCents == null ? '' : money(r.budgetCents),
  })),
);

// 3) the union half — the REAL recurringOutsideFixedCategoryCents, then a
//    per-item trace using the same rules, asserted equal to the real total.
const categoryIsFixed = (id: string) => suggestedCategoryIsFixed(id, meta);
const budgetCategoryIds = new Set(
  budgetRows.filter((b) => b.monthCents > 0).map((b) => b.categoryId),
);
const coveredIds =
  categoryFixed.totalCents > 0
    ? new Set(categoryFixed.rows.filter((r) => r.amountCents > 0).map((r) => r.categoryId))
    : fixedSpendCategoryIdsInMonths(
        snapTxns,
        new Set(
          monthlyNonDiscretionaryCents(snapTxns, meta, fixedMerchants, unionedLoanMerchants)
            .filter((f) => f.month < today.slice(0, 7))
            .slice(-3)
            .map((f) => f.month),
        ),
        meta,
        fixedMerchants,
        unionedLoanMerchants,
      );
const realOutside = recurringOutsideFixedCategoryCents(scheduledFixed, categoryIsFixed, coveredIds, budgetCategoryIds);

head(`THE UNION — recurringOutsideFixedCategoryCents = ${money(realOutside)} (added ON TOP of the ${money(categoryFixed.totalCents)} rollup)`);
let traced = 0;
const trace = counted.map((s) => {
  const rate = s.typicalAmountCents >= 0 ? 0 : monthlyRateCents(-s.typicalAmountCents, s.cadence);
  const id = resolveSeriesCategory(s);
  const loan = loanPaymentMerchants.has(s.merchantCanonical);
  let decision: string;
  if (s.typicalAmountCents >= 0) decision = 'skip (not an expense)';
  else if (typeof id === 'string' && id !== '' && PLAN_FIXED_NEVER_CATEGORY_IDS.has(id)) decision = 'skip (never-fixed)';
  else if (loan && typeof id === 'string' && id !== '' && budgetCategoryIds.has(id)) decision = 'skip (reader-priced category — C.24 F2)';
  else if (loan) {
    decision = `ADDED ${money(rate)} — LOAN PAYMENT, unconditional (C.24)`;
    traced += rate;
  }
  else if (typeof id === 'string' && id !== '' && categoryIsFixed(id) === false) decision = 'skip (discretionary)';
  else if (typeof id === 'string' && id !== '' && categoryIsFixed(id) === true && coveredIds.has(id)) decision = 'skip (covered by rollup)';
  else {
    decision = `ADDED ${money(rate)}${categoryIsFixed(id ?? '') == null ? ' — NULL/out-of-dial id (the P0-4 leak)' : ''}`;
    traced += rate;
  }
  // The FILED categories of this series' underlying rows — what the rollup keyed on.
  const filed = new Set(
    recSource
      .filter((t) => normalizeMerchant(t.rawDescriptor ?? '').canonical === s.merchantCanonical)
      .map((t) => t.categoryId ?? '(null)'),
  );
  return {
    canonical: s.merchantCanonical.slice(0, 28),
    guessCat: s.categoryId,
    resolvedCat: id,
    isFixed: String(categoryIsFixed(id ?? '')),
    filedCats: [...filed].join(',').slice(0, 30),
    rate: money(rate),
    decision,
  };
});
console.table(trace);
console.log(`trace total ${money(traced)} vs real function ${money(realOutside)} — ${traced === realOutside ? 'MATCH' : '*** MISMATCH: the trace is wrong, trust the function ***'}`);

head(`WHAT THE PLAN SUGGESTS AS FIXED: rollup ${money(categoryFixed.totalCents)} + outside ${money(realOutside)} = ${money(categoryFixed.totalCents + realOutside)}`);

// ------------------------------------------------- C.5: the constant divisor
head('C.5 — divisor per rollup category: window months vs months WITH a charge');
const windowMonths = 3;
const lastMonths: string[] = [];
{
  const ymStart = isoDate(`${monthKey(today)}-01`);
  for (let k = windowMonths; k >= 1; k--) {
    const d = new Date(`${ymStart}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - k);
    lastMonths.push(d.toISOString().slice(0, 7));
  }
}
// Sanity: the engine's own map must match what the rollup rows carry.
const typicalByCat = averageMonthlySpendByCategory(snapTxns, today, windowMonths);
console.log(`window = [${lastMonths.join(', ')}], denom is ALWAYS ${windowMonths}`);
console.table(
  categoryFixed.rows
    .filter((r) => r.basis === 'typical-spend' || r.typicalCents > 0)
    .map((r) => {
      const inWindow = snapTxns.filter(
        (t) => countsInFlows(t) && t.categoryId === r.categoryId && lastMonths.includes(monthKey(t.date)),
      );
      const monthsWith = new Set(inWindow.map((t) => monthKey(t.date)));
      const netCents = inWindow.reduce((s, t) => s + t.amountCents, 0); // signed; spend is negative
      const perMonth = lastMonths.map((m) => {
        const net = inWindow.filter((t) => monthKey(t.date) === m).reduce((s, t) => s + t.amountCents, 0);
        return `${m}:${money(net)}`;
      });
      return {
        categoryId: r.categoryId,
        shipped: money(r.typicalCents),
        engineMap: money(typicalByCat.get(r.categoryId)?.amountCents ?? 0),
        monthsWithCharge: monthsWith.size,
        honest: monthsWith.size > 0 ? money(Math.round(-netCents / monthsWith.size)) : '(none)',
        perMonth: perMonth.join('  '),
      };
    }),
);

await c.end();
