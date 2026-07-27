/**
 * Capability benchmark (reproducible: `npm run benchmark`). Runs the app's REAL
 * pure engines over the seed dataset and prints MEASURED numbers — no claims, no
 * fabrication. Deterministic (seed + pinned asOf), so the output is stable and
 * anyone can re-run it. Every figure here comes from an engine that ships with
 * known-answer unit tests; this just exercises them at dataset scale.
 *
 * What it does NOT do: compare against Mint/Simplifi (never measured), assert
 * real-world savings (no real users), or score categorization "accuracy" against
 * an independent label set (the merchant table IS the label, so that number would
 * be circular — review rate + coverage are the honest categorization metrics).
 */
import { buildSeedData } from '../src/lib/seed/build';
import { categorize } from '../src/lib/engine/categorize/pipeline';
import { detectRecurring, type Cadence } from '../src/lib/engine/recurring/detect';
import { monthlyFlows } from '../src/lib/engine/fi/insights';
import { fiNumberCents, monthsToFI, savingsRateBps } from '../src/lib/engine/fi/fi';
import { assembleCashNeededInput } from '../src/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '../src/lib/engine/cash-needed/engine';
import { cents, formatCents } from '../src/lib/money';
import { holidayTable, isoDate } from '../src/lib/dates';

const pct = (n: number, d: number) => (d === 0 ? '0.0' : ((n / d) * 100).toFixed(2));
const bpsPct = (bps: number | null) => (bps === null ? 'n/a' : (bps / 100).toFixed(1) + '%');
const rint = (n: number) => Math.round(n);

function main() {
  const seed = buildSeedData();
  const today = isoDate(seed.asOf);
  const posted = seed.transactions.filter((t) => t.status === 'POSTED');

  console.log('═'.repeat(64));
  console.log(`PULSE FINANCE — capability benchmark (seed dataset, asOf ${seed.asOf})`);
  console.log('═'.repeat(64));
  console.log(`Dataset: ${seed.transactions.length} transactions, ${seed.accounts.length} accounts, ` +
    `${seed.statements.length} statements.\n`);

  // ── 1. Categorization (no user rules → cold-start pipeline) ──
  let review = 0, aiBadge = 0, known = 0;
  const categorized = posted.map((t) => {
    const c = categorize({ rawDescriptor: t.rawDescriptor, amountCents: t.amountCents, date: t.date, accountId: t.accountId, isTransfer: t.isTransfer });
    if (c.needsReview) review++;
    if (c.aiBadge) aiBadge++;
    if (c.merchantKnown) known++;
    return { ...t, categoryId: c.categoryId };
  });
  console.log('1. CATEGORIZATION (cold start, zero user rules)');
  console.log(`   ${posted.length} posted transactions auto-filed by the pipeline.`);
  console.log(`   • Need manual review : ${review} (${pct(review, posted.length)}%)   [lower = less hand-sorting]`);
  console.log(`   • Auto-filed         : ${posted.length - review} (${pct(posted.length - review, posted.length)}%)`);
  console.log(`   • Merchant recognized: ${known} (${pct(known, posted.length)}%)`);
  console.log(`   • Auto-filed w/ "AI" badge (7000–8999 conf): ${aiBadge}`);
  console.log(`   NOTE: "accuracy %" is omitted on purpose — the merchant table is the`);
  console.log(`   label, so scoring against it would be circular. Review rate is honest.\n`);

  // ── 2. Recurring / subscription detection ──
  const series = detectRecurring(posted, today);
  const subs = series.filter((s) => s.isSubscription);
  const unused = series.filter((s) => s.possiblyUnused);
  const priceChanges = series.filter((s) => s.priceChangedAt);
  const ANNUAL: Record<Cadence, number> = {
    WEEKLY: 52, BIWEEKLY: 26, MONTHLY: 12, QUARTERLY: 4, SEMIANNUAL: 2, ANNUAL: 1, IRREGULAR: 0,
  };
  const annualSubCost = subs.reduce((s, x) => s + Math.abs(x.typicalAmountCents) * ANNUAL[x.cadence], 0);
  console.log('2. RECURRING / SUBSCRIPTIONS SURFACED');
  console.log(`   • Recurring series detected: ${series.length}`);
  console.log(`   • Of those, subscriptions  : ${subs.length}  (≈ ${formatCents(cents(annualSubCost))}/yr in recurring spend surfaced)`);
  console.log(`   • Flagged "possibly unused": ${unused.length}  (a question, never an accusation)`);
  console.log(`   • Price increases caught   : ${priceChanges.length}`);
  for (const s of priceChanges) {
    console.log(`       ↑ ${s.merchantCanonical}: ${formatCents(cents(Math.abs(s.previousAmountCents ?? 0)))} → ${formatCents(cents(Math.abs(s.lastAmountCents)))} (${s.priceChangedAt})`);
  }
  console.log();

  // ── 3. Cash-Needed ("how much do I need & when") ──
  const input = assembleCashNeededInput({
    today, scenario: 'PAY_IN_FULL', paymentAccountId: seed.user.paymentAccountId,
    accounts: seed.accounts, autopays: seed.autopays, statements: seed.statements,
    cardPayments: seed.cardPayments, transactions: seed.transactions, scheduled: seed.scheduled,
    holidayTable: holidayTable(2024, 2027),
  });
  const payInFull = computeCashNeeded(input);
  const minimum = computeCashNeeded({ ...input, scenario: 'MINIMUM' });
  const h = payInFull.headline;
  console.log('3. CASH-NEEDED ENGINE (the headline answer, hand-verified to the cent)');
  console.log(`   • Pay all cards in full: ${formatCents(h.requiredCents)} needed by ${h.byDate ?? '—'} (${h.cardsDueCount} card(s) due)`);
  if (h.shortfallCents > 0) {
    console.log(`   • Projected shortfall  : ${formatCents(h.shortfallCents)} on ${h.shortfallDate}`);
    if (h.recommendation) console.log(`   • Suggested transfer   : ${formatCents(h.recommendation.amountCents)} by ${h.recommendation.byDate}`);
  }
  console.log(`   • Minimum-path cost    : ${formatCents(minimum.minimumPathInterestCents ?? cents(0))} of interest next cycle (avg-daily-balance)\n`);

  // ── 4. Savings rate + FI projection ──
  const flows = monthlyFlows(categorized);
  const avgIncome = rint(flows.reduce((s, f) => s + f.incomeCents, 0) / Math.max(1, flows.length));
  const avgExpenses = rint(flows.reduce((s, f) => s + f.expensesCents, 0) / Math.max(1, flows.length));
  const rate = savingsRateBps(cents(avgIncome), cents(avgExpenses));
  const annualExpenses = avgExpenses * 12;
  const fiNumber = fiNumberCents(cents(annualExpenses), seed.user.swrBps);
  const portfolio = seed.accounts.filter((a) => a.type === 'INVESTMENT').reduce((s, a) => s + a.currentBalanceCents, 0);
  const monthlySavings = Math.max(0, avgIncome - avgExpenses);
  const months = monthsToFI(cents(portfolio), cents(monthlySavings), seed.user.expectedReturnBps, fiNumber);
  console.log('4. SAVINGS RATE + FINANCIAL-INDEPENDENCE PROJECTION');
  console.log(`   • Avg monthly income / expenses: ${formatCents(cents(avgIncome))} / ${formatCents(cents(avgExpenses))}  (over ${flows.length} months)`);
  console.log(`   • Savings rate          : ${bpsPct(rate)}`);
  console.log(`   • FI number (${(seed.user.swrBps / 100).toFixed(0)}% SWR): ${formatCents(fiNumber)}  (= ${formatCents(cents(annualExpenses))}/yr ÷ SWR)`);
  console.log(`   • Invested today        : ${formatCents(cents(portfolio))}`);
  console.log(`   • Years to FI (@ ${(seed.user.expectedReturnBps / 100).toFixed(0)}% return): ${months === null ? 'not on track within 100y' : (months / 12).toFixed(1)}`);
  console.log('═'.repeat(64));
  console.log('All numbers above are produced by the same engines the unit tests pin.');
  console.log('Re-run anytime: `npm run benchmark`. They prove MECHANICS, not market');
  console.log('superiority — that would require real users + a side-by-side study.');
  console.log('═'.repeat(64));
}

main();
