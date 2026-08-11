/**
 * READ-ONLY production probe — O.20g.
 *
 * Before this slice the creep detector's income series admitted EVERY positive
 * row, including merchandise returns that `monthlyFlows` refuses on the same
 * page (#166). The slice gates that series on `isIncomeFlowRow` and then refuses
 * the whole comparison when the income baseline is not credible.
 *
 * This probe answers three questions against the live corpus, per real user:
 *
 *   (1) How far apart were the two income rules? — the positives the old rule
 *       counted as income and `isIncomeFlowRow` refuses, named and totalled.
 *   (2) What does the SHIPPED engine now conclude? — `incomeMeasured`,
 *       `flagged`, and the two first-half baselines the refusal rests on.
 *   (3) Which of the three rendered verdicts does that reader actually see?
 *
 * It calls `detectLifestyleCreep` ITSELF rather than re-deriving its rules. An
 * earlier draft hand-copied the window construction and the growth helper with
 * "verbatim from insights.ts:421-427" in the header — which pointed at nothing
 * the moment the slice that moved those lines landed, and measured the copy
 * rather than the code. The only thing reconstructed here is the OLD income
 * series, because that code no longer exists to call.
 *
 * Every statement is a SELECT; nothing is written.
 *
 * REPLAY FIDELITY — stated so the verdict is read at its real strength:
 *   - EXACT: the row scope (`getCoachData` maps `snap.transactions`, the
 *     spend-account rows with currency null|USD), the reconciliation boundary,
 *     and the entire engine, called directly.
 *   - APPROXIMATED: `meta` is the static `CATEGORY_BY_ID`, not the per-user
 *     `mergeCategoryMeta` overlay, so a reader's CUSTOM discretionary category
 *     is missed by the spend side. That can move `spendGrowthBps` and the
 *     discretionary baseline, so every line derived from them is labelled
 *     `(approx meta)` — including the rendered-verdict line, which depends on
 *     both sides.
 *   - OMITTED: `excludedFlowIds` (C.25) runs empty. Loan payments are OUTFLOWS,
 *     so they never enter the income series; they can only leave extra rows in
 *     the discretionary one, which is already labelled approximate.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { reconciliationTxnKeepFilter } from '../../src/lib/engine/account/reconcile-boundary';
import { SPENDING_ACCOUNT_TYPES } from '../../src/lib/engine/transactions/query';
import { isIncomeCategoryId } from '../../src/lib/engine/categorize/categories';
import { isExcludedFromTotals } from '../../src/lib/engine/transactions/exclude';
import { detectLifestyleCreep } from '../../src/lib/engine/fi/insights';
import { COACH_COPY } from '../../src/lib/engine/fi/coach-copy';
import { isoDate, monthKey, addMonthsClamped } from '../../src/lib/dates';
import { median } from '../../src/lib/stats';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const usd = (n: number) => `$${(n / 100).toFixed(2)}`;
const pct1 = (bps: number) => `${(bps / 100).toFixed(1)}%`;
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
}

/** The OLD income rule — reconstructed because the code no longer exists to call. */
const countsInFlowsOld = (t: Txn) =>
  !t.isTransfer && t.status === 'POSTED' && !t.isSplitParent && !isExcludedFromTotals(t);
const wasIncomeUnderOldRule = (t: Txn) => countsInFlowsOld(t) && t.amountCents > 0;
const isIncomeNow = (t: Txn) =>
  wasIncomeUnderOldRule(t) &&
  (!t.categoryId || (t.categoryId !== 'refund' && isIncomeCategoryId(t.categoryId)));

async function loadAccounts(userIds: string[]): Promise<Acc[]> {
  const r = await c.query(
    `select id, type, currency, "userId" from "Account" where "userId" = any($1::text[])`,
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

const users = await c.query<{ id: string; email: string | null }>(
  `select id, email from "User" order by id asc`,
);

let refused = 0;
for (const u of users.rows) {
  console.log(`\n===== user ${u.id}${u.email?.includes('demo') ? ' (DEMO)' : ''} =====`);

  // `today` MUST be the provider's business today, per user. The demo provider
  // pins DEMO_TODAY, so measuring the demo user at the wall clock renders a
  // window the app never shows (`the-fixture-must-live-at-the-same-today-as-the-server`).
  const demoToday = env
    .split(/\r?\n/)
    .find((l) => l.startsWith('DEMO_TODAY='))
    ?.slice('DEMO_TODAY='.length)
    .trim()
    .replace(/^["']|["']$/g, '');
  const isDemo = u.id === 'user-demo';
  if (isDemo && !demoToday) {
    console.log('  SKIPPED — no DEMO_TODAY in .env.prod.tmp; a wall-clock window would describe nothing.');
    console.log('  (the demo is measured against the SEED by scripts/audit-probes/o20g-demo-seed-arms.mts)');
    continue;
  }
  const today = isoDate(isDemo ? demoToday! : new Date().toISOString().slice(0, 10));

  const accs = await loadAccounts([u.id]);
  const keep = await boundaryFor(u.id, accs);
  const txns = (await spendTxns(u.id)).filter((t) => keep({ accountId: t.accountId, date: t.date }));

  const months: string[] = [];
  const lastFullMonthStart = addMonthsClamped(isoDate(`${monthKey(today)}-01`), 0);
  for (let k = 6; k >= 1; k--) months.push(monthKey(addMonthsClamped(lastFullMonthStart, -k)));
  const inWindow = (t: Txn) => months.includes(monthKey(isoDate(t.date)));

  /* (1) how far apart the two income rules were */
  const rejected = txns.filter((t) => inWindow(t) && wasIncomeUnderOldRule(t) && !isIncomeNow(t));
  console.log(
    `  window ${months[0]}..${months[5]}   today=${today}${isDemo ? ' (DEMO_TODAY, pinned)' : ''}`,
  );
  console.log(
    `  positives the OLD rule counted as income and isIncomeFlowRow refuses: ` +
      `${rejected.length} rows, ${usd(rejected.reduce((s, r) => s + r.amountCents, 0))}`,
  );
  for (const r of rejected.slice(0, 10)) {
    console.log(`      ${r.date}  ${usd(r.amountCents)}  category=${r.categoryId ?? '(none)'}`);
  }
  if (rejected.length > 10) console.log(`      … ${rejected.length - 10} more`);

  /* the OLD first-half income median, to show what the gating moved */
  const oldByMonth = new Map(months.map((m) => [m, 0]));
  const newByMonth = new Map(months.map((m) => [m, 0]));
  for (const t of txns) {
    if (!inWindow(t)) continue;
    const m = monthKey(isoDate(t.date));
    if (wasIncomeUnderOldRule(t)) oldByMonth.set(m, oldByMonth.get(m)! + t.amountCents);
    if (isIncomeNow(t)) newByMonth.set(m, newByMonth.get(m)! + t.amountCents);
  }
  const oldBaseline = median(months.slice(0, 3).map((m) => oldByMonth.get(m)!));
  console.log(
    `  first-half income median: OLD ${usd(oldBaseline)}  ->  NEW ${usd(median(months.slice(0, 3).map((m) => newByMonth.get(m)!)))}`,
  );
  console.log(`  monthly income (isIncomeFlowRow): ${months.map((m) => usd(newByMonth.get(m)!)).join('  ')}`);

  /* (2) + (3) what the SHIPPED engine concludes, and what the reader sees */
  const creep = detectLifestyleCreep(
    txns.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      date: isoDate(t.date),
      amountCents: t.amountCents,
      rawDescriptor: t.rawDescriptor,
      isTransfer: t.isTransfer,
      status: t.status,
      categoryId: t.categoryId,
      isSplitParent: t.isSplitParent,
      splitParentId: t.splitParentId,
      excludeFromTotals: t.excludeFromTotals,
    })),
    today,
  );
  console.log(
    `  SHIPPED: incomeMeasured=${creep.incomeMeasured} spendMeasured=${creep.spendMeasured} flagged=${creep.flagged}`,
  );
  console.log(
    `           baselines: income ${usd(creep.incomeBaselineCents)} vs discretionary ` +
      `${usd(creep.discretionaryBaselineCents)} (approx meta)`,
  );
  console.log(
    `           growth: spend ${pct1(creep.spendGrowthBps)} (approx meta) / income ${pct1(creep.incomeGrowthBps)}`,
  );
  const card = COACH_COPY.creepCard(creep);
  console.log(`  RENDERED VERDICT (approx meta) >> ${card.title}`);
  console.log(`  RENDERED BODY               >> ${card.body}`);
  if (!creep.incomeMeasured || !creep.spendMeasured) refused++;
}

console.log(
  `\ndone — users: ${users.rows.length}, readers the comparison is refused for: ${refused}. ` +
    `read-only, nothing written.`,
);
await c.end();
