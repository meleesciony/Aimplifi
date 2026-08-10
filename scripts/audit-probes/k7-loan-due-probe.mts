/**
 * K.7 probe — decide by EXECUTION which of the two candidate causes is real:
 *  (a) `selectLoanObligations` yields nothing for the demo Auto Loan, and a detected
 *      recurring series stands in silently; or
 *  (b) the obligation exists and /calendar is not receiving it.
 *
 * Read-only. Runs the REAL server path (`getCashNeeded`) and the REAL calendar engine
 * for the demo user, then prints (1) the loan account row as the snapshot holds it,
 * (2) the loan obligations the server computed, (3) every scheduled row that mentions
 * the loan, and (4) the calendar events for the demo's current month.
 */
import { getCashNeeded } from '../../src/server/finance';
import { buildCashFlowCalendar } from '../../src/lib/engine/calendar/build';
import { holidayTable } from '../../src/lib/dates';
import { DEMO_USER_ID } from '../../src/lib/demo-user';
import { prisma } from '../../src/lib/db';

async function main() {
  const { today, snap, result, loanObligations } = await getCashNeeded(DEMO_USER_ID);
  console.log('today =', today);

  const loans = snap.accounts.filter((a) => a.type === 'LOAN' || a.type === 'MORTGAGE');
  console.log('\n[1] LOAN/MORTGAGE accounts in the snapshot:');
  for (const a of loans) {
    console.log(
      `  ${a.id} | ${a.name} | type=${a.type} | minimumPaymentCents=${a.minimumPaymentCents} | dueDayOfMonth=${a.dueDayOfMonth} | feedDroppedAt=${(a as { feedDroppedAt?: string | null }).feedDroppedAt ?? null}`,
    );
  }
  if (loans.length === 0) console.log('  (none — the snapshot holds no loan account at all)');

  console.log('\n[2] loanObligations from getCashNeeded:', JSON.stringify(loanObligations, null, 2));

  console.log('\n[3] scheduled rows in the snapshot:');
  for (const s of snap.scheduled) {
    console.log(
      `  ${s.description} | accountId=${s.accountId} | nextDate=${s.nextDate} | cadence=${s.cadence} | amountCents=${s.amountCents}`,
    );
  }

  const month = today.slice(0, 7);
  const y = +month.slice(0, 4);
  const cal = buildCashFlowCalendar({
    month,
    scheduled: snap.scheduled,
    cardObligations: result.cards,
    loanObligations,
    today,
    holidays: holidayTable(y - 1, y + 1),
  });
  console.log(`\n[4] calendar events for ${month}:`);
  for (const d of cal.days) {
    for (const e of d.events) {
      console.log(`  ${d.date} | ${e.kind} | ${e.label} | ${e.amountCents}`);
    }
  }

  console.log('\n[5] loan-due events anywhere this month:', cal.days.flatMap((d) => d.events).filter((e) => e.kind === 'loan-due').length);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
