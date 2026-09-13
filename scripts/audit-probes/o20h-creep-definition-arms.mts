/**
 * READ-ONLY production probe — O.20h.
 *
 * "Discretionary" means two different things in this product: the lifestyle-creep
 * detector counts a row by the CATEGORY's `discretionary` taxonomy flag, while
 * the register and /budgets label the same row by its SPEND CLASS
 * (`classifySpendClass` — the reader's per-row override, then the recurring-bill
 * merchant guess, then the taxonomy flag). A gym membership the register labels
 * "Fixed · you set this" is still counted in the /coach discretionary bar.
 *
 * The queued fix passes `fixedMerchants` into `detectLifestyleCreep` and selects
 * rows on `classifySpendClass(...) === 'guilt-free'`. That remedy is a hypothesis
 * (the measure-the-prescribed-fix lesson), so this probe measures the state the
 * fix PRODUCES, per real user, before any code changes:
 *
 *   (1) OLD bar vs NEW bar — the monthly discretionary series under both rules,
 *       each side's first-half median (the baseline the growth divides by), the
 *       growth, and the rendered verdict.
 *   (2) A census of every row the two rules disagree on, bucketed by WHY
 *       (override=fixed / override=guilt-free / recurring-bill merchant /
 *       uncategorized), so the movement is named, not inferred.
 *   (3) The demo seed at its pinned DEMO_TODAY, in both arms — the demo drives
 *       the seed lock, the coach e2e, and the live /coach a visitor sees.
 *
 * OLD-rule figures are reconstructed by hand (the taxonomy predicate over the
 * same resolved categories the engine's spend branch uses), because after the fix
 * no shipped code computes them. NEW-rule figures come from the SHIPPED ENGINE
 * ITSELF, called with each user's real overrides and recurring-bill merchants.
 * The verdict helper mirrors `halfGrowth` + the measured rule in insights.ts —
 * it is measurement code, not a re-derivation shipped anywhere.
 *
 * Every statement is a SELECT; nothing is written.
 *
 * REPLAY FIDELITY — stated so the verdict is read at its real strength:
 *   - EXACT: the row scope (`getCoachData` maps `snap.transactions`, the
 *     spend-account rows with currency null|USD), the reconciliation boundary,
 *     per-row `spendClassOverride`, the custom-category meta overlay, the
 *     recurring-bill merchant fold, and (for the NEW arm) the entire engine.
 *   - APPROXIMATED: nothing on the NEW side. The OLD side is inherently a
 *     reconstruction of code that no longer exists after the fix; it uses the
 *     same category resolution and the same window the engine uses.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { reconciliationTxnKeepFilter } from '../../src/lib/engine/account/reconcile-boundary';
import { SPENDING_ACCOUNT_TYPES } from '../../src/lib/engine/transactions/query';
import {
  countsInFlows,
  detectLifestyleCreep,
  isIncomeFlowRow,
  type TxnLike,
} from '../../src/lib/engine/fi/insights';
import { classifySpendClass } from '../../src/lib/engine/spending-plan/spend-class';
import { mergeCategoryMeta, CATEGORY_BY_ID, type CategoryMeta } from '../../src/lib/engine/categorize/categories';
import { categorize } from '../../src/lib/engine/categorize/pipeline';
import { normalizeMerchant } from '../../src/lib/engine/categorize/normalize';
import { overrideKey } from '../../src/lib/engine/recurring/override';
import { detectRecurring } from '../../src/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES } from '../../src/lib/engine/recurring/override';
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
  spendClassOverride: string | null;
}
interface Acc {
  id: string;
  type: string;
  currency: string | null;
  userId: string;
  currentBalanceCents: number;
}

/** The verdict `COACH_COPY.creepCard` renders, mirrored from insights.ts
 *  (halfGrowth + the measured rule) so BOTH arms can be scored identically.
 *  The income series is identical in both arms, so the pair isolates the
 *  definition change. */
function verdictFromSeries(discSeries: number[], incomeSeries: number[]) {
  const half = Math.floor(discSeries.length / 2);
  const first = median(discSeries.slice(0, half));
  const last = median(discSeries.slice(discSeries.length - half));
  const spendBps = first <= 0 ? 0 : Math.round(((last - first) / first) * 10000);
  const incHalf = Math.floor(incomeSeries.length / 2);
  const incFirst = median(incomeSeries.slice(0, incHalf));
  const incLast = median(incomeSeries.slice(incomeSeries.length - incHalf));
  const incBps = incFirst <= 0 ? 0 : Math.round(((incLast - incFirst) / incFirst) * 10000);
  const spendMeasured = first > 0;
  const incomeMeasured = incFirst > 0 && incFirst >= first;
  const flagged = incomeMeasured && spendMeasured && spendBps - incBps >= 500;
  return { baseline: first, spendBps, incBps, spendMeasured, incomeMeasured, flagged };
}

function resolvedCategoryId(t: Txn): string {
  return (
    t.categoryId ??
    categorize({
      rawDescriptor: t.rawDescriptor,
      amountCents: t.amountCents,
      date: t.date,
      accountId: t.accountId,
    }).categoryId
  );
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
            t."excludeFromTotals", t."spendClassOverride"
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where a."userId" = $1 and a.type = any($2::text[])
       and (a.currency is null or a.currency = 'USD')
     order by t.date asc, t.id asc`,
    [userId, SPEND],
  );
  return r.rows.map((x: Txn & { date: string }) => ({ ...x, date: x.date.slice(0, 10) }));
}

/** Custom categories + system renames merged over the static map — the exact
 *  `getCategoryMeta` overlay, read directly so the probe stays read-only. */
async function metaFor(userId: string): Promise<ReadonlyMap<string, CategoryMeta>> {
  const custom = await c.query<{ id: string; name: string; group: string | null; discretionary: boolean }>(
    `select id, name, "group", discretionary from "Category" where "userId" = $1 and "isSystem" = false`,
    [userId],
  );
  const renames = await c.query<{ categoryId: string; name: string }>(
    `select "categoryId", name from "CategoryRename" where "userId" = $1`,
    [userId],
  );
  return mergeCategoryMeta(
    custom.rows.map((r) => ({ id: r.id, name: r.name, group: r.group ?? 'Transfers & Other', discretionary: r.discretionary })),
    new Map(renames.rows.map((r) => [r.categoryId, r.name])),
  );
}

/** The recurring-bill merchant fold, read directly (RecurringSeries outflows +
 *  BILL verdicts − NOT_BILL, later verdict wins, created-at order, capped at the
 *  same 200 the server loader reads) — the exact shape
 *  `getRecurringBillMerchantCanonicals` returns, without importing `prisma`. */
async function fixedMerchantsFor(userId: string): Promise<ReadonlySet<string>> {
  const CADENCES = new Set(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'IRREGULAR']);
  const [series, verdicts] = await Promise.all([
    c.query<{ canonical: string; cadence: string }>(
      `select m.canonical as canonical, s.cadence as cadence
       from "RecurringSeries" s join "Merchant" m on m.id = s."merchantId"
       where s."userId" = $1 and s."typicalAmountCents" < 0`,
      [userId],
    ),
    c.query<{ merchantCanonical: string; decision: string; cadence: string | null }>(
      `select "merchantCanonical", decision, cadence from "RecurringOverride"
       where "userId" = $1 order by "createdAt" asc limit 200`,
      [userId],
    ),
  ]);
  const cadenceBy = new Map<string, string | null>();
  for (const s of series.rows) {
    cadenceBy.set(overrideKey(s.canonical), CADENCES.has(s.cadence) ? s.cadence : null);
  }
  for (const v of verdicts.rows) {
    const key = overrideKey(v.merchantCanonical);
    if (v.decision === 'BILL') cadenceBy.set(key, v.cadence && CADENCES.has(v.cadence) ? v.cadence : (cadenceBy.get(key) ?? 'MONTHLY'));
    else cadenceBy.delete(key);
  }
  return new Set(cadenceBy.keys());
}

function toEngineTxns(txns: readonly Txn[]): TxnLike[] {
  return txns.map((t) => ({
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
    spendClassOverride: t.spendClassOverride,
  }));
}

function printArms(
  label: string,
  txns: readonly Txn[],
  months: readonly string[],
  meta: ReadonlyMap<string, CategoryMeta>,
  fixedMerchants: ReadonlySet<string>,
  incomeSeries: number[],
) {
  const oldSeries = months.map(() => 0);
  const newSeries = months.map(() => 0);
  const census = {
    overrideFixed: [] as Txn[],
    overrideGuiltFree: [] as Txn[],
    merchantFixed: [] as Txn[],
    uncategorizedLeft: [] as Txn[],
    other: [] as Txn[],
  };
  for (const t of txns) {
    const m = monthKey(isoDate(t.date));
    const mi = months.indexOf(m);
    if (mi < 0) continue;
    if (!countsInFlows(t, undefined)) continue; // the engine's own admission rule
    if (t.amountCents >= 0) continue; // the spend branch is outflows only
    const cat = resolvedCategoryId(t);
    const oldCounts = meta.get(cat)?.discretionary === true;
    // The NEW arm computes the SHIPPED rule: classifySpendClass on the RAW row
    // (a null reaches the classifier's own refusal — critic cycle-1 P1-1). The
    // census buckets are keyed on the raw stored category for the same reason.
    const newCounts = classifySpendClass(t, meta, fixedMerchants) === 'guilt-free';
    if (oldCounts) oldSeries[mi] += -t.amountCents;
    if (newCounts) newSeries[mi] += -t.amountCents;
    if (oldCounts === newCounts) continue;
    if (t.spendClassOverride === 'fixed') census.overrideFixed.push(t);
    else if (t.spendClassOverride === 'guilt-free') census.overrideGuiltFree.push(t);
    else if (fixedMerchants.has(overrideKey(normalizeMerchant(t.rawDescriptor).canonical))) census.merchantFixed.push(t);
    else if (!t.categoryId || t.categoryId === 'uncategorized') census.uncategorizedLeft.push(t);
    else census.other.push(t);
  }
  const oldV = verdictFromSeries(oldSeries, incomeSeries);
  const newV = verdictFromSeries(newSeries, incomeSeries);
  console.log(`\n  ${label}`);
  console.log(`    OLD (category flag)  monthly: ${oldSeries.map(usd).join(' ')}`);
  console.log(`    NEW (spend class)    monthly: ${newSeries.map(usd).join(' ')}`);
  console.log(
    `    baselines: OLD ${usd(oldV.baseline)} -> NEW ${usd(newV.baseline)}   ` +
      `spend growth OLD ${pct1(oldV.spendBps)} -> NEW ${pct1(newV.spendBps)}`,
  );
  console.log(
    `    verdict: OLD flagged=${oldV.flagged} (spendMeasured=${oldV.spendMeasured} incomeMeasured=${oldV.incomeMeasured})` +
      ` -> NEW flagged=${newV.flagged} (spendMeasured=${newV.spendMeasured} incomeMeasured=${newV.incomeMeasured})`,
  );
  const total =
    census.overrideFixed.length +
    census.overrideGuiltFree.length +
    census.merchantFixed.length +
    census.uncategorizedLeft.length +
    census.other.length;
  console.log(
    `    disagreements: ${total} rows — override=fixed ${census.overrideFixed.length}` +
      ` (${usd(census.overrideFixed.reduce((s, t) => s - t.amountCents, 0))}), override=guilt-free ` +
      `${census.overrideGuiltFree.length} (${usd(census.overrideGuiltFree.reduce((s, t) => s - t.amountCents, 0))}), ` +
      `recurring-bill merchant ${census.merchantFixed.length} (${usd(census.merchantFixed.reduce((s, t) => s - t.amountCents, 0))}), ` +
      `uncategorized-left ${census.uncategorizedLeft.length} (${usd(census.uncategorizedLeft.reduce((s, t) => s - t.amountCents, 0))}), ` +
      `other ${census.other.length} (${usd(census.other.reduce((s, t) => s - t.amountCents, 0))})`,
  );
  const sample = [...census.overrideFixed, ...census.merchantFixed, ...census.uncategorizedLeft, ...census.other].slice(0, 8);
  for (const t of sample) {
    console.log(
      `      ${t.date}  ${usd(-t.amountCents)}  ${t.rawDescriptor.slice(0, 40)}  cat=${t.categoryId ?? '(none)'}` +
        `  override=${t.spendClassOverride ?? '-'}`,
    );
  }
  return { oldV, newV };
}

const demoToday = env
  .split(/\r?\n/)
  .find((l) => l.startsWith('DEMO_TODAY='))
  ?.slice('DEMO_TODAY='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const users = await c.query<{ id: string; email: string | null }>(
  `select id, email from "User" order by id asc`,
);

for (const u of users.rows) {
  const isDemo = u.id === 'user-demo';
  console.log(`\n===== user ${u.id}${u.email?.includes('demo') ? ' (DEMO row in prod DB)' : ''} =====`);
  if (isDemo && !demoToday) {
    console.log('  NOTE — no DEMO_TODAY in .env.prod.tmp, so this arm is windowed at the WALL CLOCK and describes a month the demo app never renders; the demo\'s authoritative measurements are the SEED arm below (raw seed) and the shipped-path live-seed arm (seeded RecurringSeries as fixedMerchants).');
  }
  const accs = await loadAccounts([u.id]);
  const keep = await boundaryFor(u.id, accs);
  const txns = (await spendTxns(u.id)).filter((t) => keep(t.accountId, t.date));
  const meta = await metaFor(u.id);
  const fixedMerchants = await fixedMerchantsFor(u.id);
  console.log(`  rows in scope: ${txns.length}; recurring-bill merchants: ${fixedMerchants.size}`);

  const today = isoDate(
    isDemo && demoToday ? demoToday : new Date().toISOString().slice(0, 10),
  );
  const lastFullMonthStart = addMonthsClamped(isoDate(`${monthKey(today)}-01`), 0);
  const months: string[] = [];
  for (let k = 6; k >= 1; k--) months.push(monthKey(addMonthsClamped(lastFullMonthStart, -k)));
  const inWindow = (t: Txn) => months.includes(monthKey(isoDate(t.date)));
  const windowTxns = txns.filter(inWindow);

  // The income series is identical in both arms (isIncomeFlowRow is untouched):
  // run the SHIPPED engine once for it and for the NEW-arm verdict.
  const engine = detectLifestyleCreep(
    toEngineTxns(windowTxns),
    today,
    6,
    meta,
    undefined,
    new Set<string>(),
    fixedMerchants,
  );
  const incomeSeries = months.map(() => 0);
  for (const t of windowTxns) {
    if (t.amountCents <= 0) continue;
    if (!countsInFlows(t, undefined)) continue;
    if (isIncomeFlowRow(t, undefined)) {
      incomeSeries[months.indexOf(monthKey(isoDate(t.date)))] += t.amountCents;
    }
  }
  printArms('PROD DB (live corpus)', windowTxns, months, meta, fixedMerchants, incomeSeries);
  console.log(`    SHIPPED ENGINE: incomeMeasured=${engine.incomeMeasured} spendMeasured=${engine.spendMeasured} flagged=${engine.flagged} spendGrowth=${pct1(engine.spendGrowthBps)} incomeGrowth=${pct1(engine.incomeGrowthBps)}`);
  const card = COACH_COPY.creepCard(engine);
  console.log(`    RENDERED (NEW) >> ${card.title}`);
}

console.log('\n===== DEMO SEED (both arms, at pinned DEMO_TODAY) =====');
const { buildSeedData } = await import('../../src/lib/seed/build');
const today = isoDate(demoToday || '2026-06-10');
const seed = buildSeedData();
const lastFullMonthStart = addMonthsClamped(isoDate(`${monthKey(today)}-01`), 0);
const months: string[] = [];
for (let k = 6; k >= 1; k--) months.push(monthKey(addMonthsClamped(lastFullMonthStart, -k)));
const seedTxns: Txn[] = seed.transactions
  .filter((t) => months.includes(monthKey(isoDate(t.date))))
  .map((t, i) => ({
    id: (t as { id?: string }).id ?? `seed-${i}`,
    accountId: t.accountId,
    date: t.date,
    amountCents: t.amountCents,
    rawDescriptor: t.rawDescriptor,
    isTransfer: t.isTransfer,
    status: t.status,
    categoryId: (t as { categoryId?: string | null }).categoryId ?? null,
    isSplitParent: (t as { isSplitParent?: boolean }).isSplitParent ?? false,
    splitParentId: (t as { splitParentId?: string | null }).splitParentId ?? null,
    excludeFromTotals: (t as { excludeFromTotals?: boolean | null }).excludeFromTotals ?? false,
    spendClassOverride: (t as { spendClassOverride?: string | null }).spendClassOverride ?? null,
  }));
const engine = detectLifestyleCreep(toEngineTxns(seedTxns), today, 6, CATEGORY_BY_ID, undefined, new Set<string>(), new Set());
const incomeSeries = months.map(() => 0);
for (const t of seedTxns) {
  if (t.amountCents <= 0) continue;
  if (!countsInFlows(t, undefined)) continue;
  if (isIncomeFlowRow(t, undefined)) {
    incomeSeries[months.indexOf(monthKey(isoDate(t.date)))] += t.amountCents;
  }
}
printArms('SEED at DEMO_TODAY', seedTxns, months, CATEGORY_BY_ID, new Set(), incomeSeries);
console.log(`    SHIPPED ENGINE: flagged=${engine.flagged} spendGrowth=${pct1(engine.spendGrowthBps)} incomeGrowth=${pct1(engine.incomeGrowthBps)} incomeMeasured=${engine.incomeMeasured} spendMeasured=${engine.spendMeasured}`);

// LIVE-SEED arm — the SHIPPED DEMO PAGE's own world, so the demo figures in
// DECISIONS #740 are re-derivable from this committed probe alone. The seeded
// demo DB writes one RecurringSeries per detected bill (prisma/seed.ts Phase 2)
// and `coach.ts` loads them through the unfenced
// `getRecurringBillMerchantCanonicals` for the demo user too (the override
// store is demo-fenced; the series loader deliberately is not — the demo
// register badge already reads them). So the demo bar classifies through these
// merchants, and the raw-seed arm above (empty set) is NOT the demo page's bar.
// The seed rows arrive UNCATEGORIZED (categories are applied at ingest), so
// this arm mirrors prisma/seed.ts Phase 2's categorize pass first — the same
// mirror the unit locks run.
const ingested: Txn[] = seedTxns.map((t) => ({
  ...t,
  categoryId:
    t.categoryId ??
    categorize({
      rawDescriptor: t.rawDescriptor,
      amountCents: t.amountCents,
      date: t.date,
      accountId: t.accountId,
      isTransfer: t.isTransfer,
    }).categoryId,
}));
const series = detectRecurring(
  ingested.filter((t) => t.status === 'POSTED'),
  isoDate(seed.asOf),
  NO_RECURRING_OVERRIDES,
);
const seededMerchants = new Set(
  series.filter((s) => s.typicalAmountCents < 0).map((s) => overrideKey(s.merchantCanonical)),
);
console.log(`    seeded outflow recurring-bill merchants: ${seededMerchants.size}`);
const liveEngine = detectLifestyleCreep(toEngineTxns(ingested), today, 6, CATEGORY_BY_ID, undefined, new Set<string>(), seededMerchants);
printArms('LIVE-SEED at DEMO_TODAY (seeded RecurringSeries as fixedMerchants — the shipped demo page)', ingested, months, CATEGORY_BY_ID, seededMerchants, incomeSeries);
console.log(`    SHIPPED ENGINE: flagged=${liveEngine.flagged} spendGrowth=${pct1(liveEngine.spendGrowthBps)} incomeGrowth=${pct1(liveEngine.incomeGrowthBps)} incomeMeasured=${liveEngine.incomeMeasured} spendMeasured=${liveEngine.spendMeasured}`);

console.log(`\ndone — users: ${users.rows.length}. read-only, nothing written.`);
await c.end();
