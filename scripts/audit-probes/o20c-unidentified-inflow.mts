/**
 * READ-ONLY production probe — O.20c.
 *
 * THE REPORT (TASKS O.20c). Two unfiled inflows that look identical to a reader
 * land on OPPOSITE sides of the same figure:
 *
 *   - a positive row stored with NO category (`categoryId` null) is counted as
 *     INCOME — `isIncomeFlowRow`'s `!t.categoryId` branch (insights.ts:104);
 *   - a positive row sitting in the taxonomy's own "we do not know" leaf,
 *     `'uncategorized'` (group 'Transfers & Other', categories.ts:180), fails
 *     that branch AND the Income-group test, so `monthlyFlows` SUBTRACTS it from
 *     the month's expense pool (insights.ts:141) while the "Spending by
 *     category" card buckets it INTO spending (`spendRowCategoryId`, reports.ts:249).
 *
 * The row says "the real fix is deciding what an unidentified inflow IS, once".
 * This probe measures the candidate answers against the live corpus and the
 * demo seed BEFORE any code changes — the row's own prescription, and this
 * repo's measure-the-prescribed-fix rule.
 *
 * THE ARMS (each is ONE definition applied to BOTH stores):
 *   ARM A — as shipped: null→income; 'uncategorized'→nets spend (asymmetric).
 *   ARM B — sign rule for every unfiled inflow: null AND 'uncategorized' are
 *           INCOME. This restores symmetry with the app's own treatment of an
 *           unfiled OUTFLOW, which counts as spending on its sign alone.
 *   ARM C — offset rule for every unfiled inflow: null AND 'uncategorized' net
 *           against spending (the `!categoryId` special case is deleted).
 *
 * WHY THESE THREE: the row frames the choice as income-vs-offsets, so B and C
 * are the two single-definition answers, and A is the shipped asymmetry they
 * would replace. WHICH ONE IS RIGHT IS NOT DECIDED HERE — the dollar sizes and
 * the row census below are what settle it, because the two arms move DIFFERENT
 * populations and only one of them is non-empty on a real corpus.
 *
 * FIDELITY (the o20a-reports-basis-gap.mts pattern):
 *   - EXACT: the row scope production reads. Transactions come from
 *     SPEND-type accounts only (the snapshot's own filter, demo.ts:53-54), the
 *     currency guard is applied exactly as the snapshot applies it, and the
 *     reconciliation boundary keep filter is applied with the THREE positional
 *     arguments `reconciliationTxnKeepFilter(accounts, links, spans)` takes
 *     (an earlier draft of the sibling probe passed an object and silently
 *     disabled the boundary).
 *   - EXACT: every predicate call — `countsInFlows`, `isIncomeCategoryId`.
 *   - ONE LABELLED EXCEPTION: the arm predicates. `isIncomeFlowRowA` is the
 *     shipped function verbatim; B and C differ from it by exactly the clause
 *     named beside each, and are written here because the shipped module cannot
 *     hold three answers at once. Nothing else is re-derived: the monthly split
 *     calls `countsInFlows`, and the card side calls the two clauses
 *     `isSpendRow` itself runs.
 *   - OMITTED, NOT DISMISSED: `excludedFlowIds` (C.25) runs empty, exactly as
 *     in o20a, where it is named as a bounded residual for this same user.
 *
 * Every statement is a SELECT; nothing is written.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { countsInFlows } from '../../src/lib/engine/fi/insights';
import { isIncomeCategoryId } from '../../src/lib/engine/categorize/categories';
import { reconciliationTxnKeepFilter } from '../../src/lib/engine/account/reconcile-boundary';
import { SPENDING_ACCOUNT_TYPES } from '../../src/lib/engine/transactions/query';
import { monthKey } from '../../src/lib/dates';

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
  excludeFromTotals: boolean;
}
interface Acc {
  id: string;
  type: string;
  currency: string | null;
  currentBalanceCents: number;
}

/** The shipped rule (insights.ts:102) — verbatim. */
const isIncomeFlowRowA = (t: Txn): boolean => {
  if (!countsInFlows(t) || t.amountCents <= 0) return false;
  return !t.categoryId || (t.categoryId !== 'refund' && isIncomeCategoryId(t.categoryId));
};

/** ARM B — sign rule for unfiled inflows. Differs from A by exactly
 *  `|| t.categoryId === 'uncategorized'`. */
const isIncomeFlowRowB = (t: Txn): boolean => {
  if (!countsInFlows(t) || t.amountCents <= 0) return false;
  return (
    !t.categoryId ||
    t.categoryId === 'uncategorized' ||
    (t.categoryId !== 'refund' && isIncomeCategoryId(t.categoryId))
  );
};

/** ARM C — offset rule for unfiled inflows. Differs from A by exactly deleting
 *  the `!t.categoryId` branch. */
const isIncomeFlowRowC = (t: Txn): boolean => {
  if (!countsInFlows(t) || t.amountCents <= 0) return false;
  return t.categoryId !== 'refund' && !!t.categoryId && isIncomeCategoryId(t.categoryId);
};

const arms = { A: isIncomeFlowRowA, B: isIncomeFlowRowB, C: isIncomeFlowRowC } as const;

/** The split `monthlyFlows` performs (insights.ts:137-143), over a chosen arm. */
function flows(txns: readonly Txn[], pick: (t: Txn) => boolean) {
  const byMonth = new Map<string, { income: number; expenses: number; incomeRows: number; expenseRows: number }>();
  for (const t of txns) {
    if (!countsInFlows(t)) continue;
    const slot = byMonth.get(monthKey(t.date)) ?? { income: 0, expenses: 0, incomeRows: 0, expenseRows: 0 };
    if (pick(t)) {
      slot.income += t.amountCents;
      slot.incomeRows++;
    } else if (t.amountCents > 0) {
      slot.expenses -= t.amountCents;
      slot.expenseRows++;
    } else {
      slot.expenses += -t.amountCents;
      slot.expenseRows++;
    }
    byMonth.set(monthKey(t.date), slot);
  }
  return [...byMonth.entries()]
    .map(([month, { income, expenses, incomeRows, expenseRows }]) => ({
      month,
      incomeCents: income,
      expensesCents: Math.max(0, expenses),
      rawExpensesCents: expenses,
      incomeRows,
      expenseRows,
    }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

async function users(): Promise<{ id: string; email: string | null }[]> {
  const r = await c.query(`select id, email from "User" order by email asc`);
  return r.rows;
}

async function accountsFor(userId: string): Promise<Acc[]> {
  const r = await c.query<Acc>(
    `select id, type, currency, "currentBalanceCents" from "Account"
     where "userId" = $1 and type = any($2::text[])`,
    [userId, SPEND],
  );
  // The snapshot's currency guard: null = assumed USD (demo/manual), else USD only.
  return r.rows.filter((a) => a.currency == null || a.currency === 'USD');
}

async function txnsFor(userId: string, accs: Acc[]): Promise<Txn[]> {
  const ids = accs.map((a) => a.id);
  if (ids.length === 0) return [];
  const r = await c.query(
    `select t.id, t."accountId", t.date::text as date, t."amountCents", t."rawDescriptor",
            t."isTransfer", t.status, t."categoryId", t."isSplitParent", t."excludeFromTotals"
     from "Transaction" t
     where t."accountId" = any($1::text[])
     order by t.date asc, t.id asc`,
    [ids],
  );
  const links = await c.query<{ predecessorAccountId: string; successorAccountId: string; cutoverDate: string }>(
    `select "predecessorAccountId", "successorAccountId", "cutoverDate"
     from "AccountReconciliation" where "userId" = $1 and "undoneAt" is null`,
    [userId],
  );
  const spans = await c.query<{ accountId: string; first: string; last: string }>(
    `select "accountId", min(date)::text as first, max(date)::text as last from "Transaction"
     where "accountId" = any($1::text[]) group by "accountId"`,
    [links.rows.map((l) => l.predecessorAccountId)],
  );
  const keep = reconciliationTxnKeepFilter(accs, links.rows, spans.rows);
  return (r.rows as Txn[])
    .map((x) => ({ ...x, date: x.date.slice(0, 10) }))
    .filter((t) => keep(t.accountId, t.date));
}

/** Every unfiled POSITIVE admitted to the flows pool — the population the arms
 *  disagree about and the two stores split. */
const unfiledPositive = (t: Txn) =>
  countsInFlows(t) && t.amountCents > 0 && (!t.categoryId || t.categoryId === 'uncategorized');

/** `isSpendRow`'s own two clauses (reports.ts:241-259), restated here ONLY to
 *  measure the card side; the reconciliation/currency/window clauses are
 *  already applied to the row set above. */
const cardAdmitsAsSpend = (t: Txn) => {
  if (t.isSplitParent || t.isTransfer || t.excludeFromTotals) return false;
  const id = t.categoryId ?? 'uncategorized';
  if (id === 'transfer') return false;
  if (id !== 'uncategorized' && isIncomeCategoryId(id)) return false;
  return true;
};

console.log('=== O.20c — what an unidentified inflow is (READ-ONLY) ===\n');

const all = await users();
const perUser: { id: string; email: string | null; txns: Txn[] }[] = [];
for (const u of all) {
  const accs = await accountsFor(u.id);
  perUser.push({ id: u.id, email: u.email, txns: await txnsFor(u.id, accs) });
}

// ── 1. The population: how many unfiled inflows exist, and where they sit ──
console.log('1. THE POPULATION — unfiled POSITIVE rows admitted to the flows pool\n');
const nullStore: Txn[] = [];
const uncatStore: Txn[] = [];
for (const u of perUser) {
  for (const t of u.txns.filter(unfiledPositive)) (t.categoryId ? uncatStore : nullStore).push(t);
}
const sum = (rows: Txn[]) => rows.reduce((s, t) => s + t.amountCents, 0);
console.log(`   null-store positives      : ${nullStore.length} rows, ${usd(sum(nullStore))}`);
console.log(`   'uncategorized' positives : ${uncatStore.length} rows, ${usd(sum(uncatStore))}`);
console.log(`   → ARM B changes exactly the 'uncategorized' store: ${uncatStore.length} rows / ${usd(sum(uncatStore))}`);
console.log(`   → ARM C changes exactly the null store          : ${nullStore.length} rows / ${usd(sum(nullStore))}`);

// ── 2. The census: WHAT these rows are, so the definition can be judged ──
console.log("\n2. THE CENSUS — what the 'uncategorized' inflows actually are\n");
{
  const buckets = new Map<string, { n: number; cents: number }>();
  const bucketOf = (t: Txn): string => {
    const d = t.rawDescriptor.toUpperCase();
    if (/\bTAX\b/.test(d)) return 'tax-related';
    if (/BROKERAGE|TRANSFER|SWEEP|DIVIDEND|INTEREST/.test(d)) return 'brokerage / transfer / yield';
    if (/DEPOSIT|MOBILE BANKING/.test(d)) return 'deposit';
    if (/\b(ADR|INC|SPDR|CLASS|ETF|FUND|CORP|PLC)\b|^\w+\s+\w*\d/.test(d)) return 'investment sale / security';
    if (/PAYMENT|PAYROLL|DIRECT DEP|SALARY|GUSTO|ADP/.test(d)) return 'payment / payroll-looking';
    return 'unclassified';
  };
  for (const t of uncatStore) {
    const b = bucketOf(t);
    const s = buckets.get(b) ?? { n: 0, cents: 0 };
    s.n++;
    s.cents += t.amountCents;
    buckets.set(b, s);
  }
  for (const [b, s] of [...buckets.entries()].sort((a, b) => b[1].cents - a[1].cents)) {
    console.log(`   ${b.padEnd(30)} ${String(s.n).padStart(4)} rows   ${usd(s.cents).padStart(14)}`);
  }
  const incomeLooking = buckets.get('payment / payroll-looking')?.cents ?? 0;
  console.log(
    `\n   → income-LOOKING share: ${usd(incomeLooking)} of ${usd(sum(uncatStore))}` +
      ` (${((incomeLooking / Math.max(1, sum(uncatStore))) * 100).toFixed(1)}%)`,
  );
  console.log('   largest 12 rows:');
  for (const t of [...uncatStore].sort((a, b) => b.amountCents - a.amountCents).slice(0, 12)) {
    console.log(`     ${t.date} ${usd(t.amountCents).padStart(12)} "${t.rawDescriptor.slice(0, 44)}"`);
  }
}

// ── 3. The move, per user ──
console.log('\n3. THE MOVE — monthly income/expenses under each arm, per user\n');
for (const u of perUser) {
  const unf = u.txns.filter(unfiledPositive);
  if (unf.length === 0) {
    console.log(`   ${u.email ?? u.id}: NO unfiled inflows — all three arms byte-identical`);
    continue;
  }
  const fA = flows(u.txns, arms.A);
  const fB = flows(u.txns, arms.B);
  const fC = flows(u.txns, arms.C);
  const tot = (f: typeof fA, k: 'incomeCents' | 'expensesCents') => f.reduce((s, m) => s + m[k], 0);
  console.log(`   ${u.email ?? u.id}: ${unf.length} unfiled inflows / ${u.txns.length} pooled rows`);
  console.log(
    `     income  A ${usd(tot(fA, 'incomeCents'))}  B ${usd(tot(fB, 'incomeCents'))}  C ${usd(tot(fC, 'incomeCents'))}`,
  );
  console.log(
    `     expense A ${usd(tot(fA, 'expensesCents'))}  B ${usd(tot(fB, 'expensesCents'))}  C ${usd(tot(fC, 'expensesCents'))}`,
  );
  const moved = (x: typeof fA, y: typeof fA) =>
    x.filter((m, i) => m.incomeCents !== y[i]?.incomeCents || m.expensesCents !== y[i]?.expensesCents);
  console.log(`     months moved A→B: ${moved(fA, fB).length}   A→C: ${moved(fA, fC).length}`);
  for (const m of moved(fA, fB).slice(0, 8)) {
    const i = fA.indexOf(m);
    const b = fB[i]!;
    console.log(
      `       ${m.month}: income ${usd(m.incomeCents)}→${usd(b.incomeCents)}` +
        `   expense ${usd(m.expensesCents)}→${usd(b.expensesCents)}` +
        (m.expensesCents === 0 && m.rawExpensesCents < 0 ? '  (ARM A was CLAMPED to $0 by the inflow)' : ''),
    );
  }
  // Savings rate is the consumed figure with a real failure direction.
  console.log('     savings rate (income−expense)/income, months where A→B moves it:');
  for (const m of fA) {
    const i = fA.indexOf(m);
    const b = fB[i]!;
    const rate = (x: { incomeCents: number; expensesCents: number }) =>
      x.incomeCents > 0 ? `${(((x.incomeCents - x.expensesCents) / x.incomeCents) * 100).toFixed(1)}%` : 'n/a';
    if (rate(m) !== rate(b)) console.log(`       ${m.month}: ${rate(m)} → ${rate(b)}`);
  }
}

// ── 4. The demo seed's own world ──
console.log('\n4. THE DEMO-SEED WORLD — the same three arms over the shipped seed\n');
{
  const { buildSeedData } = await import('../../src/lib/seed/build');
  const { DEMO_USER_ID } = await import('../../src/lib/demo-user');
  const { categorize } = await import('../../src/lib/engine/categorize/pipeline');
  const seed = await buildSeedData();
  // prisma/seed.ts Phase 2 writes each row's category from THIS pipeline call,
  // so the seed's stored categoryId is `categorize(...).categoryId` — never a
  // raw null. Mapping it (not assuming) keeps the arm faithful to the deployed
  // demo DB. Seed rows sit in spending accounts by construction.
  const seedTxns: Txn[] = seed.transactions.map((t) => ({
    id: t.id,
    accountId: t.accountId,
    date: t.date.slice(0, 10),
    amountCents: t.amountCents,
    rawDescriptor: t.rawDescriptor,
    isTransfer: t.isTransfer,
    status: t.status,
    categoryId: categorize({
      rawDescriptor: t.rawDescriptor,
      amountCents: t.amountCents,
      date: t.date,
      accountId: t.accountId,
      isTransfer: t.isTransfer,
    }).categoryId,
    isSplitParent: false,
    excludeFromTotals: false,
  }));
  const unf = seedTxns.filter(unfiledPositive);
  console.log(`   seed rows: ${seedTxns.length}   (demo user ${DEMO_USER_ID})`);
  console.log(`   unfiled positives: ${unf.length} rows / ${usd(sum(unf))}`);
  const fA = flows(seedTxns, arms.A);
  const fB = flows(seedTxns, arms.B);
  const fC = flows(seedTxns, arms.C);
  const tot = (f: typeof fA, k: 'incomeCents' | 'expensesCents') => f.reduce((s, m) => s + m[k], 0);
  console.log(
    `   income  A ${usd(tot(fA, 'incomeCents'))}  B ${usd(tot(fB, 'incomeCents'))}  C ${usd(tot(fC, 'incomeCents'))}`,
  );
  console.log(
    `   expense A ${usd(tot(fA, 'expensesCents'))}  B ${usd(tot(fB, 'expensesCents'))}  C ${usd(tot(fC, 'expensesCents'))}`,
  );
  console.log(`   A→B months moved: ${fA.filter((m, i) => m.incomeCents !== fB[i]?.incomeCents).length}`);
  console.log('   → a zero here means the demo golden does not move under any arm.');
}

// ── 5. The card's side ──
console.log("\n5. THE CARD'S SIDE — does a positive 'uncategorized' row land in the spend card?\n");
{
  const onCard = uncatStore.filter(cardAdmitsAsSpend);
  console.log(`   positive 'uncategorized' rows the spend card COUNTS: ${onCard.length} / ${usd(sum(onCard))}`);
  console.log('   → under ARM B every one of these must ALSO leave the card (one definition, both sides).');
  console.log(`   null-store rows already leave the card by construction: ${nullStore.length}`);
}

console.log('\n=== END — nothing written ===');
await c.end();
