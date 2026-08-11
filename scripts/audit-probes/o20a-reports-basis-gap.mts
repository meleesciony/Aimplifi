/**
 * READ-ONLY production probe — O.20a.
 *
 * /reports prints one month's spending on two bases that can disagree: the
 * income/expense CHART (`monthlyFlows` → `countsInFlows`) and the "Spending
 * by category" CARD (`spendingByCategory` → `isSpendRow`). The view computes
 * the on-screen gap itself —
 *
 *   basisGapCents = data.breakdown.totalCents - currentMonthBar.expensesCents
 *   (reports-view.tsx:81-83, 0 when the chart draws no bar for this month)
 *
 * — and states only the DIRECTION of that gap, never a mechanism, because an
 * earlier draft's "it's pending charges" explanation was falsified in both
 * directions by a critic. TASKS O.20a is the decision this probe measures
 * for: unify the bases, give the card the chart's basis, or leave the
 * disclosure as the honest answer. PROGRESS.md's carried note: "there are
 * SEVEN divergences, not the five the row records — spendingByCategory also
 * drops any category netting ≤ 0 from totalCents, and countsInFlows applies
 * no category filter at all." This probe finds the mechanisms by SOURCE
 * TRACE (reports.ts, insights.ts) and then measures each one's live dollar
 * contribution — never the reverse.
 *
 * SOURCE-TRACED MECHANISMS (verified by reading, not guessed):
 *   R1 pending      — chart requires status==='POSTED' (countsInFlows);
 *                      card allows PENDING (isSpendRow has no status check).
 *   R2 uncategorized — `isIncomeFlowRow` treats ANY positive row with categoryId
 *                      null as income unconditionally (`!t.categoryId` branch,
 *                      insights.ts:87) and removes it from the chart's expense
 *                      pool entirely; `spendRowCategoryId` buckets the same row
 *                      under the literal 'uncategorized' category (group
 *                      'Transfers & Other', NOT Income — categories.ts:180),
 *                      so the card nets it INTO spending instead.
 *   R3 refund-leaf  — a positive row categorized 'refund' (group 'Income',
 *                      categories.ts:41) is explicitly EXCLUDED from
 *                      `isIncomeFlowRow`'s income test (O.20g's own fix, "not
 *                      a raise"), so the chart's `else if amountCents>0` branch
 *                      SUBTRACTS it from the month's expense pool; the card
 *                      drops it entirely via the Income-group check in
 *                      `isSpendRow` — it touches NO category's total there.
 *   R4 income-group  — a NEGATIVE row filed to any Income-group category
 *      outflow         (payroll correction, a clawback) fails
 *                      `isIncomeFlowRow`'s `amountCents > 0` gate, so the chart
 *                      adds it to expenses like any ordinary purchase; the card
 *                      excludes it via the same Income-group check that catches
 *                      R3, whatever its sign.
 *   R5 transfer-leaf — a row manually filed to the 'transfer' CATEGORY (not the
 *                      `isTransfer` boolean) is rejected outright by
 *                      `isSpendRow` (reports.ts:166); `countsInFlows` has no
 *                      per-category check at all and admits it.
 *   R6 floor grain   — `spendingByCategory` drops a category ENTIRELY when its
 *                      own net is ≤ 0 (reports.ts:203, "net refund / zero →
 *                      drop") — per-CATEGORY granularity. `monthlyFlows` only
 *                      floors the WHOLE MONTH at 0 (insights.ts:126) — one pool,
 *                      so a heavy-refund category can net down a genuinely
 *                      spendy one in the chart's total in a way the card's
 *                      per-category isolation never allows. Both halves of
 *                      this floor are measured below (the card's per-category
 *                      drop AND the chart's whole-month clamp) — an earlier
 *                      draft measured only the first and left an $11.70
 *                      residual in one month, caught by a fresh-context critic.
 *
 * Every number below comes from calling the SHIPPED functions
 * (`countsInFlows`, `isIncomeFlowRow`, `isSpendRow`, `spendingByCategory`,
 * `monthlyFlows`, `spendRowCategoryId`, `spendContributionCents`,
 * `spentSoFarWindow`) directly — nothing here reimplements a rule. The one
 * exception is explicitly labelled at its call site: R6's isolation reuses
 * the three per-row primitives `spendingByCategory` itself calls, omitting
 * only the one-line `<= 0` floor, so its own aggregation loop is not
 * duplicated, only its final filter is skipped.
 *
 * REPLAY FIDELITY:
 *   - EXACT: row scope (spend accounts, currency null|USD), reconciliation
 *     boundary (`reconciliationTxnKeepFilter(accountId, date)` — TWO
 *     positional args; an earlier draft passed an object and silently
 *     disabled the boundary entirely, caught by a fresh-context critic —
 *     see the call site below), `window`/`ym`/`today` construction
 *     (byte-identical to `getReports`), and every predicate/engine call.
 *     The demo user resolves `today` the way production actually does
 *     (`businessToday()`: DEMO_TODAY if set, else DEFAULT_AS_OF for
 *     DEMO_USER_ID specifically) rather than being skipped for the ABSENCE
 *     of DEMO_TODAY in `.env.prod.tmp` — which `docs/DEPLOY.md:91` says
 *     must never be set there, so that absence IS the production state.
 *   - APPROXIMATED: `meta` is per-user `mergeCategoryMeta` (custom Category +
 *     CategoryRename), same as C.19/O.20g — exact, not the static map.
 *   - OMITTED, NOT DISMISSED: `excludedFlowIds` (C.25) runs empty
 *     (undefined). A critic found the symmetry argument for why this can't
 *     matter is NOT airtight: this user has 5 loan/mortgage accounts and 24
 *     `loan-payment`-categorized rows totalling −$17,223.76 in spend
 *     accounts, and dropping negative rows from a category CAN flip its net
 *     from positive to ≤ 0, tripping the card's R6 per-category floor with
 *     no counterpart on the chart side. Bounded, believed small relative to
 *     the R5/R6 figures measured below, but UNVERIFIED — a residual, stated
 *     as one rather than reasoned away.
 *
 * Every statement is a SELECT; nothing is written.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { reconciliationTxnKeepFilter } from '../../src/lib/engine/account/reconcile-boundary';
import { SPENDING_ACCOUNT_TYPES } from '../../src/lib/engine/transactions/query';
import { countsInFlows, isIncomeFlowRow, monthlyFlows } from '../../src/lib/engine/fi/insights';
import {
  isSpendRow,
  spendingByCategory,
  spendRowCategoryId,
  spendContributionCents,
  spentSoFarWindow,
  wholeMonthWindow,
  type SpendWindow,
} from '../../src/lib/engine/reports/reports';
import { mergeCategoryMeta, CATEGORY_BY_ID, type CategoryMeta } from '../../src/lib/engine/categorize/categories';
import { isoDate, monthKey, addMonthsClamped } from '../../src/lib/dates';
import { DEFAULT_AS_OF } from '../../src/lib/seed/build';
import { DEMO_USER_ID } from '../../src/lib/demo-user';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const usd = (n: number) => `${n < 0 ? '-' : ''}$${(Math.abs(n) / 100).toFixed(2)}`;
const SPEND = [...SPENDING_ACCOUNT_TYPES];

interface Txn {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  isTransfer: boolean;
  status: string;
  categoryId: string | null;
  isSplitParent: boolean;
  splitParentId: string | null;
  excludeFromTotals: boolean;
}
interface Acc {
  id: string;
  type: string;
  currency: string | null;
  userId: string;
  currentBalanceCents: number;
}

async function loadAccounts(userIds: string[]): Promise<Acc[]> {
  const r = await c.query(
    `select id, type, currency, "userId", "currentBalanceCents" from "Account" where "userId" = any($1::text[])`,
    [userIds],
  );
  return r.rows;
}

async function boundaryFor(userId: string, accs: Acc[]) {
  const links = await c.query<{ predecessorAccountId: string; successorAccountId: string; cutoverDate: string }>(
    `select "predecessorAccountId", "successorAccountId", "cutoverDate"
     from "AccountReconciliation" where "userId" = $1 and "undoneAt" is null`,
    [userId],
  );
  const spans = await c.query<{ accountId: string; first: string; last: string }>(
    `select "accountId", min(date) as first, max(date) as last from "Transaction"
     where "accountId" = any($1::text[]) group by "accountId"`,
    [links.rows.map((l) => l.predecessorAccountId)],
  );
  return reconciliationTxnKeepFilter(accs, links.rows, spans.rows);
}

async function spendTxns(userId: string): Promise<Txn[]> {
  const r = await c.query(
    `select t.id, t."accountId", t.date::text as date, t."amountCents", t."rawDescriptor",
            t."isTransfer", t.status, t."categoryId", t."isSplitParent", t."splitParentId",
            t."excludeFromTotals"
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where a."userId" = $1 and a.type = any($2::text[])
       and (a.currency is null or a.currency = 'USD')
     order by t.date asc, t.id asc`,
    [userId, SPEND],
  );
  return r.rows.map((x: Txn & { date: string }) => ({ ...x, date: x.date.slice(0, 10) }));
}

async function categoryMetaFor(userId: string): Promise<Map<string, CategoryMeta>> {
  const custom = (
    await c.query<{ id: string; name: string; group: string | null; discretionary: boolean }>(
      `select id, name, "group", discretionary from "Category"
       where "userId" = $1 and "isSystem" = false order by name asc`,
      [userId],
    )
  ).rows.map((r) => ({
    id: r.id,
    name: r.name,
    group: r.group ?? 'Transfers & Other',
    discretionary: r.discretionary,
  }));
  const renames = new Map(
    (
      await c.query<{ categoryId: string; name: string }>(
        `select "categoryId", name from "CategoryRename" where "userId" = $1`,
        [userId],
      )
    ).rows
      .filter((r) => CATEGORY_BY_ID.has(r.categoryId))
      .map((r) => [r.categoryId, r.name] as const),
  );
  return mergeCategoryMeta(custom, renames);
}

/** R6 in isolation: the SAME per-row loop `spendingByCategory` runs, minus its one-line ≤0 floor. */
function unflooredCardTotals(
  txns: readonly Txn[],
  window: SpendWindow,
  meta: Map<string, CategoryMeta>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const t of txns) {
    if (!isSpendRow(t, window, meta)) continue;
    const id = spendRowCategoryId(t);
    totals.set(id, (totals.get(id) ?? 0) + spendContributionCents(t));
  }
  return totals; // no `<= 0 → drop`
}

/**
 * Everything below `console.log` for ONE month's comparison: the two totals,
 * the R6 floor isolation (with the dropped categories' own rows), and the
 * row-level R1-R5 attribution. Shared between the current (asOf-clamped)
 * month and each trailing complete month so the same evidence prints for
 * both, instead of a totals-only line for the history that could hide which
 * mechanism is doing the work.
 */
function analyzeMonth(
  allTxns: readonly Txn[],
  window: SpendWindow,
  meta: Map<string, CategoryMeta>,
  m: string,
  chartExpensesCents: number | undefined,
  today: string,
): number {
  const breakdown = spendingByCategory(allTxns, window, meta);
  const gapCents = chartExpensesCents === undefined ? 0 : breakdown.totalCents - chartExpensesCents;
  console.log(
    `    ${m}:  chart ${chartExpensesCents === undefined ? '(no bar)' : usd(chartExpensesCents)}   ` +
      `card ${usd(breakdown.totalCents)}   gap(card−chart) ${usd(gapCents)}`,
  );
  if (gapCents === 0) return gapCents;

  // "chart-admits toward the EXPENSE pool" — countsInFlows alone is not the
  // right comparison, because a genuine income row is legitimately admitted
  // to the chart (routed to the income bucket) and legitimately excluded from
  // the card's spend total — that agreement must NOT be flagged as a defect.
  const chartExpenseIn = (t: Txn) => countsInFlows(t) && !isIncomeFlowRow(t);
  const inMonth = allTxns.filter((t) => monthKey(t.date) === m && t.date <= today);

  // R6, the CHART half: `monthlyFlows` floors the whole month at 0
  // (`Math.max(0, expenses)`, insights.ts:126). Both of its accumulator
  // branches reduce to the same arithmetic (`amt>0` subtracts amt; `amt<=0`
  // adds -amt — identical to `+= -amt` either way), so the raw, unfloored
  // month expense is just `Σ -amountCents` over the same admitted rows,
  // called through the same two real predicates. A critic found this half of
  // R6 unmeasured in an earlier draft — it left an $11.70 residual in
  // 2026-03, exactly the chart-clamp amount, in the one month the chart
  // shows $0.00.
  const rawChartExpense = inMonth
    .filter((t) => chartExpenseIn(t))
    .reduce((s, t) => s - t.amountCents, 0);
  const chartFloorEffectCents = (chartExpensesCents ?? 0) - rawChartExpense;
  if (chartFloorEffectCents !== 0) {
    console.log(`        R6 whole-month floor (chart): raw expense would be ${usd(rawChartExpense)}, clamped to ${usd(chartExpensesCents ?? 0)}`);
  }

  const nameOf = (id: string) => meta.get(id)?.name ?? CATEGORY_BY_ID.get(id)?.name ?? id;
  const catTotals = unflooredCardTotals(allTxns, window, meta);
  const unfloored = [...catTotals.values()].reduce((s, v) => s + v, 0);
  const floorEffectCents = breakdown.totalCents - unfloored;
  if (floorEffectCents !== 0) {
    console.log(`        R6 per-category floor: net effect on card total ${usd(floorEffectCents)}`);
    for (const [id, v] of [...catTotals.entries()].filter(([, v]) => v <= 0).sort((a, b) => a[1] - b[1])) {
      console.log(`            DROPPED ${nameOf(id)}: net ${usd(v)}`);
      for (const r of inMonth.filter((t) => isSpendRow(t, window, meta) && spendRowCategoryId(t) === id)) {
        console.log(`                ${r.date}  ${usd(r.amountCents)}  status=${r.status}  "${r.rawDescriptor}"`);
      }
    }
  }

  const tags = new Map<string, { count: number; cents: number; examples: Txn[] }>();
  const tag = (name: string, t: Txn) => {
    const slot = tags.get(name) ?? { count: 0, cents: 0, examples: [] };
    slot.count++;
    slot.cents += t.amountCents;
    if (slot.examples.length < 3) slot.examples.push(t);
    tags.set(name, slot);
  };
  for (const t of inMonth) {
    const chartIn = chartExpenseIn(t);
    const cardIn = isSpendRow(t, window, meta);
    if (chartIn === cardIn) continue;
    const id = spendRowCategoryId(t);
    const group = meta.get(id)?.group ?? CATEGORY_BY_ID.get(id)?.group;
    const postedHypothetical = { ...t, status: 'POSTED' };
    if (t.status === 'PENDING' && chartExpenseIn(postedHypothetical) === cardIn) tag('R1 pending', t);
    else if (!t.categoryId && t.amountCents > 0) tag('R2 uncategorized→income', t);
    // R3 is positive-only by definition (a positive 'refund' row is excluded
    // from isIncomeFlowRow's income test and nets DOWN the chart's expense
    // pool instead — the O.20g carve-out). A NEGATIVE 'refund' row is not
    // that mechanism at all — sign alone routes it to R4 below, which is the
    // general "any-sign Income-group row the card drops entirely" case and
    // already covers it correctly (a critic caught this over-broad branch;
    // no such row exists on this corpus, so it was latent, not manifested).
    else if (id === 'refund' && t.amountCents > 0) tag('R3 refund-leaf', t);
    else if (group === 'Income') tag('R4 income-group outflow', t);
    else if (id === 'transfer') tag('R5 transfer-leaf category', t);
    else tag('UNEXPLAINED', t);
  }
  for (const [name, slot] of [...tags.entries()].sort((a, b) => Math.abs(b[1].cents) - Math.abs(a[1].cents))) {
    console.log(`        ${name}: ${slot.count} row(s), ${usd(slot.cents)}`);
    for (const ex of slot.examples) {
      console.log(`            ${ex.date}  ${usd(ex.amountCents)}  status=${ex.status}  category=${ex.categoryId ?? '(none)'}  "${ex.rawDescriptor}"`);
    }
  }
  return gapCents;
}

const users = await c.query<{ id: string; email: string | null }>(
  `select id, email from "User" order by id asc`,
);

// `businessToday()` (src/lib/business-today.ts) resolves "today" as: (1)
// DEMO_TODAY if set — pinned, for e2e/CI determinism; (2) else, for the
// DEMO_USER_ID specifically — DEFAULT_AS_OF (the seed's own `asOf`), so the
// curated demo stays coherent even in prod; (3) else, the real wall clock.
// docs/DEPLOY.md:91 says explicitly not to set DEMO_TODAY in production, so
// `.env.prod.tmp` correctly has none — an earlier draft of this probe read
// that absence as "cannot measure the demo" and skipped it. It should read
// it as "the demo resolves via rule (2)," which is the ACTUAL production
// behavior for the one user who takes that branch.
const demoToday =
  env
    .split(/\r?\n/)
    .find((l) => l.startsWith('DEMO_TODAY='))
    ?.slice('DEMO_TODAY='.length)
    .trim()
    .replace(/^["']|["']$/g, '') ?? DEFAULT_AS_OF;

let usersWithGap = 0;
let maxAbsGapCents = 0;

for (const u of users.rows) {
  const isDemo = u.id === DEMO_USER_ID;
  console.log(`\n===== user ${u.id}${isDemo ? ' (DEMO)' : ''} =====`);
  const today = isoDate(isDemo ? demoToday : new Date().toISOString().slice(0, 10));
  const ym = monthKey(today);

  const accs = await loadAccounts([u.id]);
  const keep = await boundaryFor(u.id, accs);
  // `reconciliationTxnKeepFilter` returns (accountId, date) => boolean — TWO
  // positional args, not an object (reconcile-boundary.ts:382-383). Passing an
  // object here is a silent no-op: `date` is undefined, both branches that key
  // on it never run, and the closure falls through to `return true` for every
  // row — the boundary never drops anything. Confirmed by a fresh-context
  // critic (O.20a review) with a controlled before/after fixture; the SAME
  // bug is inherited in scripts/audit-probes/o20g-creep-income-refunds.mts:152
  // (DECISIONS #445) — filed as its own row rather than fixed here, since
  // re-verifying O.20g's numbers is a separate investigation.
  const allTxns = (await spendTxns(u.id)).filter((t) => keep(t.accountId, t.date));
  if (allTxns.length === 0) {
    console.log('  no spend-account transactions — nothing to compare.');
    continue;
  }
  const meta = await categoryMetaFor(u.id);

  // ── Reproduce the exact on-screen numbers (reports-view.tsx:81-96), then
  //    the same evidence for the trailing 6 COMPLETE months (whole-month
  //    window, no asOf — every row in a past month already happened, so the
  //    clamp is a no-op there; byte-identical to spentSoFarWindow for a
  //    completed month). One function, one output shape, for both. ──
  const happened = allTxns.filter((t) => t.date <= today);
  const series = monthlyFlows(happened);
  const currentMonthBar = series.find((m) => m.month === ym);

  console.log(`  today=${today}${isDemo ? ' (DEMO_TODAY, pinned)' : ''}  ym=${ym}`);
  console.log('  CURRENT MONTH (asOf-clamped, the on-screen basisGapCents):');
  const basisGapCents = analyzeMonth(allTxns, spentSoFarWindow(ym, today), meta, ym, currentMonthBar?.expensesCents, today);
  if (basisGapCents !== 0) {
    usersWithGap++;
    maxAbsGapCents = Math.max(maxAbsGapCents, Math.abs(basisGapCents));
  }

  console.log('  trailing complete months:');
  const lastFullMonthStart = addMonthsClamped(isoDate(`${ym}-01`), 0);
  for (let k = 6; k >= 1; k--) {
    const m = monthKey(addMonthsClamped(lastFullMonthStart, -k));
    const mChart = series.find((f) => f.month === m);
    analyzeMonth(allTxns, wholeMonthWindow(m), meta, m, mChart?.expensesCents, today);
  }
}

console.log(
  `\ndone — users: ${users.rows.length}, users with a nonzero on-screen gap this month: ${usersWithGap}, ` +
    `largest |gap| seen: ${usd(maxAbsGapCents)}. read-only, nothing written.`,
);
await c.end();
