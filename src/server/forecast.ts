/**
 * Cash-flow forecast data (DECISIONS #72). Projects the payment (checking)
 * account forward 90 days from its known scheduled flows — income and bills,
 * cadences expanded — using the same snapshot every other view reads. Scheduled
 * rows are populated by detection at ingest for real users and by the seed for
 * the demo, so this works with zero credentials.
 */
import {
  computeForecast,
  expandScheduled,
  loanObligationsToScheduledFlows,
  type Forecast,
  type ScheduledCadence,
  type ScheduledFlow,
} from '@/lib/engine/forecast/forecast';
import { selectLoanObligations } from '@/lib/engine/loans/obligations';
import { holidayTable } from '@/lib/dates';
import { getProvider } from '@/lib/providers/demo';

export interface CashFlowForecastData {
  forecast: Forecast;
  accountName: string;
  horizonDays: number;
}

export async function getCashFlowForecast(
  userId: string,
  horizonDays = 90,
): Promise<CashFlowForecastData> {
  const provider = getProvider();
  const today = provider.today(userId);
  const snap = await provider.getFinanceSnapshot(userId);

  // Anchor on the designated payment account; fall back to a checking/savings.
  // Reconciliation (Wave 4.6 slice 3, critic F1): never anchor on a superseded
  // predecessor — its balance reads 0 and would fabricate a negative projection.
  const superseded = new Set(snap.supersededAccountIds ?? []);
  const payment =
    snap.accounts.find((a) => a.id === snap.paymentAccountId && !superseded.has(a.id)) ??
    snap.accounts.find((a) => a.type === 'CHECKING' && !superseded.has(a.id)) ??
    snap.accounts.find((a) => a.type === 'SAVINGS' && !superseded.has(a.id)) ??
    snap.accounts.find((a) => !superseded.has(a.id)) ??
    snap.accounts[0];

  const flows: ScheduledFlow[] = snap.scheduled
    .filter((s) => s.accountId === payment?.id)
    .map((s) => ({
      description: s.description,
      amountCents: s.amountCents,
      nextDate: s.nextDate,
      cadence: (s.cadence as ScheduledCadence) ?? null,
    }));

  // #134: a LOAN/MORTGAGE payment debits checking every month but is NOT in snap.scheduled
  // (it surfaces only as a loan-due obligation on the calendar/reminders — obligations.ts).
  // Fold those obligations into the balance projection so /forecast agrees with the calendar
  // instead of over-projecting checking (the demo's $385/mo auto-loan was invisible here).
  // All loan flows attach to the payment-account projection: loan autopays pull from checking,
  // consistent with the forecast's single-payment-account model (a rare pay-from-savings loan
  // is an accepted approximation). Same holiday+obligation derivation as finance.ts.
  const year = Number(today.slice(0, 4));
  const holidays = holidayTable(year - 1, year + 1);
  const loanFlows = loanObligationsToScheduledFlows(
    selectLoanObligations({ accounts: snap.accounts, today, holidays }),
  );

  const events = expandScheduled([...flows, ...loanFlows], today, horizonDays);
  const forecast = computeForecast({
    today,
    startingBalanceCents: payment?.currentBalanceCents ?? 0,
    horizonDays,
    events,
  });

  return { forecast, accountName: payment?.name ?? 'your account', horizonDays };
}
