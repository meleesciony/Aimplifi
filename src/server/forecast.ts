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
import { frozenProjectionNote } from '@/lib/engine/account/feed-dropped-view';
import { holidayTable } from '@/lib/dates';
import { getProvider } from '@/lib/providers/demo';
import { accountLabel } from '@/lib/engine/account/display-name';
import { resolvePaymentAccount } from '@/server/finance';

export interface CashFlowForecastData {
  /** Set when the account this projection starts from is one the bank stopped sharing (L.18).
   *  REQUIRED: a second reader of this shape that forgets it prints an unqualified projection. */
  frozenNote: string | null;
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

  // Anchor on the designated payment account via the SAME one definition the
  // cash-needed path uses (cycle-1 H1 / audit D1: the drift copy here once
  // disagreed about the SAVINGS fallback tier — a savings-only user's forecast
  // and cash-needed could anchor on different accounts). The helper skips
  // superseded predecessors too (their balance reads 0, which would fabricate
  // a negative projection).
  const superseded = new Set(snap.supersededAccountIds ?? []);
  const payment = resolvePaymentAccount(snap);

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
  // Reconciliation (Wave 4.6 slice 4, R4): a superseded predecessor LOAN keeps its
  // `minimumPaymentCents`/`dueDayOfMonth` (the boundary only zeros the balance), so
  // without this filter it would inject a phantom loan flow into the projection —
  // the same skip `cashNeededFromSnapshot` applies for the reminders/headline surface.
  const loanFlows = loanObligationsToScheduledFlows(
    selectLoanObligations({ accounts: snap.accounts.filter((a) => !superseded.has(a.id)), today, holidays }),
  );

  const events = expandScheduled([...flows, ...loanFlows], today, horizonDays);
  const forecast = computeForecast({
    today,
    startingBalanceCents: payment?.currentBalanceCents ?? 0,
    horizonDays,
    events,
  });

  return {
    forecast,
    accountName: payment ? accountLabel(payment) : 'your account',
    horizonDays,
    // TASKS L.18. This page walks forward from ONE balance and prints "dips below $0 on DATE" and a
    // lowest point off it, which is structurally the radar's claim with no transfer attached — and
    // unlike the radar or the dashboard, nothing else on /forecast qualifies it. The frozen-HIGH
    // case is the quiet one: no dip is projected at all, so the reader is reassured by a projection
    // that cannot see the account it is projecting.
    frozenNote:
      payment?.feedDroppedAt != null
        ? frozenProjectionNote(
            // Audit P2: the SAME label the headline uses (`accountLabel` — a
            // reader's rename/displayName wins over the stored name). The old
            // `payment.name` could name the account differently from the
            // figure 40px above it.
            { label: accountLabel(payment), frozenSince: payment.feedDroppedAt },
            {
              shows: forecast.firstNegativeDate ? 'a-dip' : 'no-dip',
              nextStep: 'accounts-route',
            },
          )
        : null,
  };
}
