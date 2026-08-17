/**
 * READ-ONLY probe — O.20g on the DEMO seed, at the seed's own pinned today.
 *
 * The demo drives three things this slice must not move blind: the seed lock
 * (`insights.test.ts` "flags the final-6-months discretionary rise against flat
 * income"), the coach e2e, and the live deploy proof (production's demo user is
 * what a `curl` of /coach renders). The production DB probe cannot measure it —
 * `.env.prod.tmp` carries no DEMO_TODAY, and a wall-clock window over demo rows
 * describes a month the app never renders.
 *
 * So measure the seed directly, at DEMO_TODAY, in both arms:
 *   A. SHIPPED     — every positive row is income (insights.ts:358-359)
 *   B. isIncomeFlowRow — the #166 predicate `monthlyFlows` already uses
 * plus the per-month income COVERAGE the new refusal keys on. Nothing is
 * written and no database is touched: `buildSeedData()` is a pure builder.
 */
import { buildSeedData } from '../../src/lib/seed/build';
import { isIncomeFlowRow, countsInFlows, detectLifestyleCreep } from '../../src/lib/engine/fi/insights';
import { CATEGORY_BY_ID } from '../../src/lib/engine/categorize/categories';
import { categorize } from '../../src/lib/engine/categorize/pipeline';
import { addMonthsClamped, isoDate, monthKey } from '../../src/lib/dates';
import { median } from '../../src/lib/stats';

const DEMO_TODAY = process.env.DEMO_TODAY ?? '2026-06-10';
const today = isoDate(DEMO_TODAY);
const usd = (n: number) => `$${(n / 100).toFixed(2)}`;
const pct1 = (bps: number) => `${(bps / 100).toFixed(1)}%`;

const seed = buildSeedData();
const txns = seed.transactions;

const lastFullMonthStart = addMonthsClamped(isoDate(`${monthKey(today)}-01`), 0);
const months: string[] = [];
for (let k = 6; k >= 1; k--) months.push(monthKey(addMonthsClamped(lastFullMonthStart, -k)));

const shippedIncome = new Map(months.map((m) => [m, 0]));
const fixedIncome = new Map(months.map((m) => [m, 0]));
const incomeRows = new Map(months.map((m) => [m, 0]));
const discSpend = new Map(months.map((m) => [m, 0]));
const rejected: { date: string; cents: number; categoryId: string }[] = [];

for (const t of txns) {
  if (!countsInFlows(t)) continue;
  const m = monthKey(t.date);
  if (!shippedIncome.has(m)) continue;
  if (t.amountCents === 0) continue;
  if (t.amountCents > 0) {
    shippedIncome.set(m, shippedIncome.get(m)! + t.amountCents);
    if (isIncomeFlowRow(t)) {
      fixedIncome.set(m, fixedIncome.get(m)! + t.amountCents);
      incomeRows.set(m, incomeRows.get(m)! + 1);
    } else {
      rejected.push({ date: t.date, cents: t.amountCents, categoryId: '(null)' });
    }
    continue;
  }
  const categoryId = categorize({
    rawDescriptor: t.rawDescriptor,
    amountCents: t.amountCents,
    date: t.date,
    accountId: t.accountId,
  }).categoryId;
  if (CATEGORY_BY_ID.get(categoryId)?.discretionary) discSpend.set(m, discSpend.get(m)! - t.amountCents);
}

/** insights.ts:421-427 — verbatim; returns [bps, firstHalfMedian]. */
function halfGrowth(series: number[]): [number, number] {
  const half = Math.floor(series.length / 2);
  const first = median(series.slice(0, half));
  const last = median(series.slice(series.length - half));
  if (first <= 0) return [0, first];
  return [Math.round(((last - first) / first) * 10000), first];
}

const [spendG] = halfGrowth(months.map((m) => discSpend.get(m)!));
const [shippedG] = halfGrowth(months.map((m) => shippedIncome.get(m)!));
const [fixedG, fixedFirst] = halfGrowth(months.map((m) => fixedIncome.get(m)!));

console.log(`DEMO seed at DEMO_TODAY=${DEMO_TODAY}   window ${months[0]}..${months[5]}`);
console.log(`  spend growth ${pct1(spendG)}`);
console.log(`  income growth: SHIPPED ${pct1(shippedG)}  ->  isIncomeFlowRow ${pct1(fixedG)}   (first-half median ${usd(fixedFirst)})`);
console.log(`  flagged: SHIPPED ${spendG - shippedG >= 500}  ->  FIXED ${spendG - fixedG >= 500}`);
console.log(`  positives isIncomeFlowRow refuses: ${rejected.length} rows, ${usd(rejected.reduce((s, r) => s + r.cents, 0))}`);
for (const r of rejected) console.log(`      ${r.date}  ${usd(r.cents)}  category=${r.categoryId}`);
console.log(`  per month [countedIncomeRows / income$ / disc$]`);
for (const m of months) {
  console.log(`      ${m}: ${String(incomeRows.get(m)).padStart(3)} / ${usd(fixedIncome.get(m)!).padStart(11)} / ${usd(discSpend.get(m)!).padStart(11)}`);
}
const uncovered = months.filter((m) => incomeRows.get(m) === 0);
console.log(`  months with NO counted income row: ${uncovered.length ? uncovered.join(',') : 'none'}`);

// And the shipped engine's own verdict, for the seed lock this slice must not silently move.
const shipped = detectLifestyleCreep(txns, today);
console.log(
  `\n  shipped detectLifestyleCreep(): flagged=${shipped.flagged} ` +
    `spendGrowthBps=${shipped.spendGrowthBps} incomeGrowthBps=${shipped.incomeGrowthBps}`,
);
