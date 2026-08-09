/**
 * READ-ONLY production probe — C.19 residual (2): the whole-category BUDGET
 * TARGET replaces the fixed-classified typical in `resolveFixedCategoryAmounts`
 * (fixed-category-amounts.ts:367 `const amountCents = budgetCents ?? typicalCents;`),
 * so a MIXED category the reader priced enters Fixed at its ENTIRE allowance,
 * including its discretionary share. Measure, on the live corpus, the delta
 * between the SHIPPED rollup (budgets applied) and the COUNTERFACTUAL (budget
 * map empty) — the budget-replaced mass — and name every category where it is
 * nonzero. Every statement is a SELECT; nothing is written.
 *
 * The C.19 row prescribes C.0-style measurement before assuming direction:
 * a fix is warranted only if the delta reaches a rendered figure (the Plan
 * fixed term, a rendered money number) on live data.
 *
 * Inputs replayed EXACTLY as the shipped server path (spending-plan.ts
 * getSpendingPlan, #397/#377/#393/#403):
 *   - transactions: spend-account rows (currency null|USD), reconciliation
 *     boundary keep applied when active links exist (snapshot semantics)
 *   - meta: mergeCategoryMeta(custom Category rows, CategoryRename overlay)
 *   - fixedMerchants: RecurringSeries outflow canonicals + RecurringOverride
 *     BILL/NOT_BILL verdicts (later wins, createdAt asc), overrideKey'd —
 *     one definition, recurring-bill-merchants.ts
 *   - budgetByCategory: Budget rows (userId, categoryId, monthCents)
 *   - excludeMerchantCanonicals: the BROAD structural loan set
 *     (loanPaymentMerchantCanonicals over keep-boundaried cash outflows +
 *     raw loan-side POSTED inflows — the detection input) ∪ converted-reserve
 *     canonicals (goals of kind 'reserve' with merchantCanonical). This
 *     approximates the shipped UNIONED set, which requires live series
 *     detection. The approximation cannot move the delta unless a budget-
 *     bearing category also holds excluded rows — the probe prints that check.
 *
 * Verdict rule (the C.19 row): only a corpus where budget-targeted categories
 * have fixed-classified typical mass BELOW the target (a positive
 * budget − typical delta on a mixed category) warrants a fix; a bare budget on
 * a suggested-fixed category is the sanctioned "reader's own number".
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { reconciliationTxnKeepFilter } from '../../src/lib/engine/account/reconcile-boundary';
import { loanPaymentMerchantCanonicals, LOAN_ACCOUNT_TYPES } from '../../src/lib/engine/categorize/transfers';
import { SPENDING_ACCOUNT_TYPES } from '../../src/lib/engine/transactions/query';
import { PAYMENT_ACCOUNT_TYPES } from '../../src/lib/engine/settings/dials';
import { resolveFixedCategoryAmounts } from '../../src/lib/engine/spending-plan/fixed-category-amounts';
import {
  mergeCategoryMeta,
  CATEGORY_BY_ID,
  type CategoryMeta,
} from '../../src/lib/engine/categorize/categories';
import { overrideKey } from '../../src/lib/engine/recurring/override';
import { normalizeMerchant } from '../../src/lib/engine/categorize/normalize';
import { suggestedCategoryIsFixed } from '../../src/lib/engine/spending-plan/spend-class';
import { RESERVE_KIND } from '../../src/lib/engine/spending-plan/reserves';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const SPEND = [...SPENDING_ACCOUNT_TYPES];
const CADENCES = new Set([
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
  'IRREGULAR',
]);

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
  spendClassOverride: string | null;
}
const asTxnLike = (t: Txn) => ({
  id: t.id,
  accountId: t.accountId,
  date: t.date,
  amountCents: t.amountCents,
  rawDescriptor: t.rawDescriptor,
  isTransfer: t.isTransfer,
  status: t.status,
  categoryId: t.categoryId,
  isSplitParent: t.isSplitParent,
  splitParentId: t.splitParentId,
  excludeFromTotals: t.excludeFromTotals,
  spendClassOverride: t.spendClassOverride,
});

interface Acc {
  id: string;
  type: string;
  currency: string | null;
  userId: string;
}

async function loadAccounts(userIds: string[]): Promise<Acc[]> {
  const r = await c.query(
    `select id, type, currency, "userId" from "Account" where "userId" = any($1::text[])`,
    [userIds],
  );
  return r.rows;
}

/** Snapshot boundary: active links → reconciliationTxnKeepFilter (h8 pattern). */
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
  const keep = reconciliationTxnKeepFilter(accs, links.rows, spans.rows);
  return { keep, activeLinks: links.rows.length };
}

async function spendTxns(userId: string): Promise<Txn[]> {
  const r = await c.query(
    `select t.id, t."accountId", t.date, t."amountCents", t."rawDescriptor", t."isTransfer",
            t.status, t."categoryId", t."isSplitParent", t."splitParentId",
            t."excludeFromTotals", t."spendClassOverride"
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where a."userId" = $1 and a.type = any($2::text[])
       and (a.currency is null or a.currency = 'USD')
     order by t.date asc, t.id asc`,
    [userId, SPEND],
  );
  return r.rows;
}

/** mergeCategoryMeta input, replayed from the DB (category-meta.ts). */
async function categoryMetaFor(userId: string): Promise<Map<string, CategoryMeta>> {
  const custom = (
    await c.query<{ id: string; name: string; group: string | null; discretionary: boolean | null }>(
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

/** fixedMerchants, replayed from the DB (recurring-bill-merchants.ts). */
async function fixedMerchantsFor(userId: string): Promise<Set<string>> {
  const series = await c.query<{ canonical: string; cadence: string | null }>(
    `select m.canonical, s.cadence from "RecurringSeries" s
     join "Merchant" m on m.id = s."merchantId"
     where s."userId" = $1 and s."typicalAmountCents" < 0`,
    [userId],
  );
  const verdicts = await c.query<{ merchantCanonical: string; decision: string; cadence: string | null }>(
    `select "merchantCanonical", decision, cadence from "RecurringOverride"
     where "userId" = $1 order by "createdAt" asc limit 200`,
    [userId],
  );
  const asCadence = (raw: string | null) => (raw && CADENCES.has(raw) ? raw : null);
  const cadenceBy = new Map<string, string | null>();
  for (const s of series.rows) {
    if (!s.canonical) continue;
    cadenceBy.set(overrideKey(s.canonical), asCadence(s.cadence));
  }
  for (const v of verdicts.rows) {
    if (!v.merchantCanonical || (v.decision !== 'BILL' && v.decision !== 'NOT_BILL')) continue;
    const key = overrideKey(v.merchantCanonical);
    if (v.decision === 'BILL') cadenceBy.set(key, asCadence(v.cadence) ?? cadenceBy.get(key) ?? 'MONTHLY');
    else cadenceBy.delete(key);
  }
  return new Set(cadenceBy.keys());
}

/** Broad structural loan set ∪ converted-reserve canonicals (see docblock). */
async function exclusionFor(userId: string, accs: Acc[], keep: (accountId: string, date: string) => boolean) {
  const typeById = new Map(accs.map((a) => [a.id, a.type]));
  const cashSide = (
    await c.query<Txn>(
      `select t.id, t."accountId", t.date, t."amountCents", t."rawDescriptor", t."isTransfer",
              t.status, t."categoryId", t."isSplitParent", t."splitParentId",
              t."excludeFromTotals", t."spendClassOverride"
       from "Transaction" t join "Account" a on a.id = t."accountId"
       where a."userId" = $1 and a.type = any($2::text[])
         and (a.currency is null or a.currency = 'USD')
         and t."isSplitParent" = false and t."isTransfer" = true and t."amountCents" < 0`,
      [userId, [...PAYMENT_ACCOUNT_TYPES]],
    )
  ).rows.filter((t) => keep(t.accountId, t.date));
  const loanSide = (
    await c.query<Txn>(
      `select t.id, t."accountId", t.date, t."amountCents", t."rawDescriptor", t."isTransfer",
              t.status, t."categoryId", t."isSplitParent", t."splitParentId",
              t."excludeFromTotals", t."spendClassOverride"
       from "Transaction" t join "Account" a on a.id = t."accountId"
       where a."userId" = $1 and a.type = any($2::text[])
         and (a.currency is null or a.currency = 'USD')
         and t."amountCents" > 0 and t.status = 'POSTED'`,
      [userId, [...LOAN_ACCOUNT_TYPES]],
    )
  ).rows; // raw, unfiltered — the shipped loanSideInflows query applies no boundary
  const loanSet = loanPaymentMerchantCanonicals(
    [...cashSide, ...loanSide].map((t) => ({
      accountId: t.accountId,
      date: t.date,
      amountCents: t.amountCents,
      rawDescriptor: t.rawDescriptor,
      isTransfer: t.isTransfer,
    })),
    typeById,
  );
  const converted = new Set(
    (
      await c.query<{ merchantCanonical: string }>(
        `select "merchantCanonical" from "Goal"
         where "userId" = $1 and kind = $2 and "merchantCanonical" is not null`,
        [userId, RESERVE_KIND],
      )
    ).rows.map((g) => g.merchantCanonical),
  );
  return new Set([...loanSet, ...converted]);
}

const users = await c.query<{ id: string }>(
  `select distinct u.id from "User" u join "Account" a on a."userId" = u.id
   where a."providerRef" is not null order by u.id asc`,
);

let usersWithBudgets = 0;
let totalDeltaCents = 0;
let affectedCategories = 0;

for (const user of users.rows) {
  const budgetRows = await c.query<{ categoryId: string; monthCents: number }>(
    `select "categoryId", "monthCents" from "Budget" where "userId" = $1 order by "categoryId" asc`,
    [user.id],
  );
  console.log(`\n===== user ${user.id} =====`);
  if (budgetRows.rows.length === 0) {
    console.log('budget targets: 0 — the C.19(2) replacement cannot fire on this corpus; nothing to measure.');
    continue;
  }
  usersWithBudgets++;

  const accs = await loadAccounts([user.id]);
  const { keep, activeLinks } = await boundaryFor(user.id, accs);
  const today = new Date().toISOString().slice(0, 10);
  const [txns, meta, fixedMerchants, exclusion] = await Promise.all([
    spendTxns(user.id),
    categoryMetaFor(user.id),
    fixedMerchantsFor(user.id),
    exclusionFor(user.id, accs, keep),
  ]);
  const kept = txns.filter((t) => keep(t.accountId, t.date));
  const txnLike = kept.map(asTxnLike);
  const budgetByCategory = new Map(budgetRows.rows.map((b) => [b.categoryId, b.monthCents]));
  const nameOf = (id: string) => meta.get(id)?.name ?? CATEGORY_BY_ID.get(id)?.name ?? id;

  const shipped = resolveFixedCategoryAmounts({
    transactions: txnLike,
    today,
    meta,
    fixedMerchants,
    budgetByCategory,
    nameOf,
    excludeMerchantCanonicals: exclusion,
  });
  const counterfactual = resolveFixedCategoryAmounts({
    transactions: txnLike,
    today,
    meta,
    fixedMerchants,
    budgetByCategory: new Map(),
    nameOf,
    excludeMerchantCanonicals: exclusion,
  });
  const deltaCents = shipped.totalCents - counterfactual.totalCents;

  // Does the exclusion approximation touch any budget-bearing category? The
  // engine keys the exclusion on the NORMALIZED canonical (C.24).
  const budgetCatHasExcludedRow = new Set<string>();
  for (const t of kept) {
    if (budgetByCategory.has(t.categoryId!) && exclusion.has(normalizeMerchant(t.rawDescriptor).canonical)) {
      budgetCatHasExcludedRow.add(t.categoryId!);
    }
  }

  console.log(
    `budget targets: ${budgetRows.rows.length} — ${budgetRows.rows
      .map((b) => `${nameOf(b.categoryId)} ${usd(b.monthCents)}`)
      .join(', ')}`,
  );
  console.log(`accounts=${accs.length} activeLinks=${activeLinks} keptTxns=${kept.length}/${txns.length} today=${today}`);
  console.log(
    `SHIPPED (budgets applied):   fixed total ${usd(shipped.totalCents)} across ${shipped.rows.length} categories`,
  );
  console.log(
    `COUNTERFACTUAL (no budgets): fixed total ${usd(counterfactual.totalCents)} across ${counterfactual.rows.length} categories`,
  );
  console.log(`DELTA (budget-replaced mass entering Fixed): ${usd(deltaCents)}`);

  console.log('\nPer budget-targeted category (shipped basis):');
  let userDelta = 0;
  for (const row of shipped.rows.filter((r) => r.basis === 'budget-target')) {
    const suggested = suggestedCategoryIsFixed(row.categoryId, meta);
    const isMixed = row.typicalCents > 0;
    const d = row.amountCents - row.typicalCents;
    userDelta += d;
    console.log(
      `  - ${row.name}: budget=${usd(row.budgetCents ?? 0)} typical=${usd(row.typicalCents)}` +
        ` (${row.typicalMonths}mo) suggestedFixed=${String(suggested)}` +
        (isMixed
          ? `  ** MIXED — replacement delta ${usd(d)} (${((row.typicalCents / row.amountCents) * 100).toFixed(0)}% of the allowance is fixed-classified mass)`
          : `  bare (sanctioned: reader's own number, no fixed-classified typical)`),
    );
  }
  if (budgetCatHasExcludedRow.size > 0) {
    console.log(
      `  NOTE: excluded merchants touch budget-bearing categories: ${[...budgetCatHasExcludedRow].map(nameOf).join(', ')} — the broad-vs-unioned approximation could move these typicals.`,
    );
  }
  console.log(`user delta: ${usd(userDelta)}`);
  totalDeltaCents += deltaCents;
  affectedCategories += shipped.rows.filter((r) => r.basis === 'budget-target' && r.typicalCents > 0).length;
}

await c.end();
console.log(`\ndone — users with budget targets: ${usersWithBudgets}, total delta across corpus: ${usd(totalDeltaCents)}, mixed budget-targeted categories: ${affectedCategories}. read-only, nothing written.`);
