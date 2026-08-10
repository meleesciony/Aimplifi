/**
 * K.7 probe #3 — the double-count, by EXECUTION.
 *
 * #134 accepted a residual (documented in server/radar.ts): "a loan whose bank ACH
 * was ALSO recurring-detected as a checking scheduled row counts twice (no
 * structural key links them; heuristic money-matching rejected)". Neither state
 * in this repo exhibits it — the seeded demo has an obligation and NO detected
 * loan series, and production has a stale scheduled row and NO obligation — so
 * the residual has never been executed. This probe executes it.
 *
 * It writes ONE ScheduledTransaction row shaped exactly as `server/recurring.ts`
 * writes a detected series (source 'recurring', description = merchant canonical,
 * on the payment account), then reports what /forecast and /calendar produce.
 *
 * DESTRUCTIVE — run ONLY against a throwaway probe DB, never dev.db or production.
 * Guarded below on the DATABASE_URL containing 'probe'.
 */
import { getCashNeeded } from '../../src/server/finance';
import { getCashFlowForecast } from '../../src/server/forecast';
import { buildCashFlowCalendar } from '../../src/lib/engine/calendar/build';
import { holidayTable } from '../../src/lib/dates';
import { DEMO_USER_ID } from '../../src/lib/demo-user';
import { prisma } from '../../src/lib/db';

const url = process.env.DATABASE_URL ?? '';
if (!/probe/i.test(url)) {
  console.error(`REFUSED: DATABASE_URL must be a throwaway probe DB (got ${url || '<unset>'})`);
  process.exit(1);
}

async function snapshot(tag: string) {
  const { today, snap, result, loanObligations } = await getCashNeeded(DEMO_USER_ID);
  const month = '2026-07';
  const y = +month.slice(0, 4);
  const cal = buildCashFlowCalendar({
    month,
    scheduled: snap.scheduled,
    cardObligations: result.cards,
    loanObligations,
    today,
    holidays: holidayTable(y - 1, y + 1),
  });
  const julyRows = cal.days.flatMap((d) => d.events.map((e) => ({ date: d.date, ...e })));
  const loanish = julyRows.filter((e) => Math.abs(e.amountCents) === 38500);

  const fc = await getCashFlowForecast(DEMO_USER_ID);
  const loanEvents = fc.forecast.days.flatMap((d) => d.events.map((e) => ({ date: d.date, ...e }))).filter((e) => Math.abs(e.amountCents) === 38500);

  console.log(`\n########## ${tag} ##########`);
  console.log(`scheduled rows on the payment account mentioning the loan amount:`);
  for (const s of snap.scheduled.filter((s) => Math.abs(s.amountCents) === 38500)) {
    console.log(`   ${s.description} | acct=${s.accountId} | ${s.nextDate} | ${s.cadence} | ${s.amountCents}`);
  }
  console.log(`obligations: ${loanObligations.map((o) => `${o.accountName} ${o.dueDate}/${o.effectiveDueDate} ${o.paymentCents}`).join(' ; ') || '(none)'}`);
  console.log(`CALENDAR ${month}: rows at $385.00 = ${loanish.length}`);
  for (const e of loanish) console.log(`   ${e.date} | ${e.kind} | ${e.label} | ${e.amountCents}`);
  console.log(`FORECAST: $385.00 events over ${fc.horizonDays}d = ${loanEvents.length}`);
  for (const e of loanEvents.slice(0, 6)) console.log(`   ${e.date} | ${e.label} | ${e.amountCents}`);
  const total = loanEvents.reduce((n, e) => n + e.amountCents, 0);
  console.log(`FORECAST: total loan-amount outflow over the horizon = ${total} cents`);
  console.log(`FORECAST: ending balance = ${fc.forecast.endingBalanceCents} | first negative = ${fc.forecast.firstNegativeDate ?? 'none'}`);
}

await snapshot('BEFORE — seeded demo (obligation only, no detected series)');

// Exactly what server/recurring.ts persists for a detected series: source
// 'recurring', description = the merchant canonical, on the payment account.
await prisma.scheduledTransaction.create({
  data: {
    accountId: 'acct-checking',
    description: 'CARMAX AUTO FINANCE',
    amountCents: -38500,
    nextDate: '2026-07-05',
    cadence: 'MONTHLY',
    source: 'recurring',
  },
});

await snapshot('AFTER — the detector has also learned the same payment');

await prisma.$disconnect();
