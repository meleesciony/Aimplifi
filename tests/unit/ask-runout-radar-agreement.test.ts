/**
 * Trust lock (DECISIONS #488): on the seeded demo (asOf 2026-06-10), Ask
 * "Will I run out of money in the next 90 days?" must not print the
 * recurring-only forecast dollars that contradicted Cash flow radar on the
 * live site (ending ~$12,495 / lowest $3,400 while radar projected below $0).
 *
 * Ask run-out ≡ radar (same account, same asOf). Cash-needed stays this-cycle
 * and may disagree on the transfer amount — that is a different question —
 * but Ask must not print the forecast ending as an all-clear next to radar.
 */
import { describe, expect, it } from 'vitest';
import { formatCents, type Cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import { holidayTable } from '@/lib/dates';
import { buildSeedData } from '@/lib/seed/build';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import {
  computeForecast,
  expandScheduled,
  loanObligationsToScheduledFlows,
  type ScheduledFlow,
} from '@/lib/engine/forecast/forecast';
import { selectLoanObligations } from '@/lib/engine/loans/obligations';
import { cashNeededFromSnapshot } from '@/server/finance';
import { radarFromSnapshot, RADAR_HORIZON_DAYS } from '@/server/radar';
import {
  answerCashFlowRadar,
  answerCashNeeded,
  answerForecast,
  humanDate,
} from '@/lib/engine/assistant/answer';
import { parseAssistantQuery } from '@/lib/engine/assistant/intent';
import type { FinanceSnapshot } from '@/lib/providers/types';
import { accountLabel } from '@/lib/engine/account/display-name';

const TODAY = isoDate('2026-06-10');
const seed = buildSeedData('2026-06-10');

const snap: FinanceSnapshot = {
  paymentAccountId: 'acct-checking',
  accounts: seed.accounts,
  autopays: seed.autopays,
  statements: seed.statements,
  cardPayments: seed.cardPayments,
  transactions: seed.transactions,
  scheduled: seed.scheduled,
  balanceSnapshots: seed.snapshots,
  handoverKeys: new Set<string>(),
};

const fmt = (n: number) => formatCents(n as Cents);

describe('Ask run-out vs radar vs cash-needed (demo asOf 2026-06-10)', () => {
  const { radar, paymentAccountName } = radarFromSnapshot(snap, TODAY, NO_RECURRING_OVERRIDES);
  const { result: cashNeeded } = cashNeededFromSnapshot(snap, TODAY, 'PAY_IN_FULL');
  const payment = snap.accounts.find((a) => a.id === 'acct-checking')!;
  const payName = accountLabel(payment);

  const year = Number(TODAY.slice(0, 4));
  const holidays = holidayTable(year - 1, year + 1);
  const flows: ScheduledFlow[] = seed.scheduled
    .filter((s) => s.accountId === 'acct-checking')
    .map((s) => ({
      description: s.description,
      amountCents: s.amountCents,
      nextDate: s.nextDate,
      cadence: s.cadence,
    }));
  const obligations = selectLoanObligations({ accounts: seed.accounts, today: TODAY, holidays });
  const events = expandScheduled(
    [...flows, ...loanObligationsToScheduledFlows(obligations)],
    TODAY,
    RADAR_HORIZON_DAYS,
  );
  const forecast = computeForecast({
    today: TODAY,
    startingBalanceCents: payment.currentBalanceCents,
    horizonDays: RADAR_HORIZON_DAYS,
    events,
  });

  it('test_regression__ask_runout_routes_to_cash_flow_radar_not_forecast', () => {
    expect(parseAssistantQuery('Will I run out of money in the next 90 days?', TODAY).kind).toBe(
      'cash_flow_radar',
    );
    expect(parseAssistantQuery("what's my cash flow forecast", TODAY).kind).toBe('forecast');
  });

  it('test_regression__ask_runout_agrees_with_radar_lowest_and_cover', () => {
    // Premise: on this seed the three engines disagree — otherwise the lock is vacuous.
    expect(radar.status).toBe('alert');
    expect(radar.committed.firstNegativeDate).not.toBeNull();
    expect(radar.coverTransfer).not.toBeNull();
    expect(forecast.firstNegativeDate).toBeNull();
    expect(forecast.endingBalanceCents).toBeGreaterThan(0);
    expect(forecast.endingBalanceCents).not.toBe(radar.committed.lowestCents);
    expect(cashNeeded.headline.recommendation).not.toBeNull();
    expect(cashNeeded.headline.recommendation!.amountCents).not.toBe(
      radar.coverTransfer!.amountCents,
    );

    const ask = answerCashFlowRadar(radar, paymentAccountName);
    expect(ask.kind).toBe('cash_flow_radar');
    expect(ask.headline).toContain(humanDate(radar.committed.firstNegativeDate!));
    expect(ask.headline).toContain(payName);

    const lowest = ask.facts.find((f) => f.label === 'Lowest point');
    expect(lowest?.value).toBe(
      `${fmt(radar.committed.lowestCents)} · ${humanDate(radar.committed.lowestDate)}`,
    );

    const cover = ask.facts.find((f) => f.label === 'Stay covered');
    expect(cover?.value).toBe(
      `move ${fmt(radar.coverTransfer!.amountCents)} by ${humanDate(radar.coverTransfer!.byDate)}`,
    );
    expect(ask.facts.find((f) => f.label === 'From')?.value).toBe(
      radar.coverTransfer!.sources[0]?.name,
    );

    // Must not print the recurring-only all-clear that contradicted radar.
    const askBlob = [ask.headline, ask.detail ?? '', ...ask.facts.map((f) => f.value)].join(' ');
    expect(askBlob).not.toContain(fmt(forecast.endingBalanceCents));
    expect(ask.detail ?? '').toMatch(/Cash flow radar/i);
    expect(ask.detail ?? '').toMatch(/Cash needed/i);
  });

  it('test_regression__thin_forecast_and_cycle_cash_needed_stay_different_questions', () => {
    const thin = answerForecast(forecast, payName, RADAR_HORIZON_DAYS);
    expect(thin.kind).toBe('forecast');
    expect(thin.headline).toContain(fmt(forecast.endingBalanceCents));
    expect(thin.detail ?? '').toMatch(/card payments/i);

    const cycle = answerCashNeeded(cashNeeded, payName);
    expect(cycle.kind).toBe('cash_needed');
    expect(cycle.headline).toMatch(/cards/i);
    // Cycle transfer (golden $1,050) must not be what Ask run-out prints as the 90-day cover.
    const ask = answerCashFlowRadar(radar, paymentAccountName);
    const cover = ask.facts.find((f) => f.label === 'Stay covered')?.value ?? '';
    expect(cover).not.toContain(fmt(cashNeeded.headline.recommendation!.amountCents));
    expect(cycle.detail ?? '').toContain(fmt(cashNeeded.headline.recommendation!.amountCents));
  });
});
