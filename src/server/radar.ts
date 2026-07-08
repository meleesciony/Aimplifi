/**
 * Cash Flow Radar read path (DECISIONS #172 — AI plan §1.2, Competitive-Gap Gap 2 §1).
 *
 * Grounding: the radar reads the SAME snapshot every other surface reads and
 * assembles its inputs from the SAME code paths — cashNeededFromSnapshot for
 * card obligations (identical to the dashboard headline) and /forecast's exact
 * scheduled+loan event expansion — so the radar cannot disagree with /cards or
 * /forecast about any event both model. `radarFromSnapshot` is pure (snapshot
 * in, result out) so the seed-grounding test can pin exactly what the server
 * serves. No LLM anywhere in this path: every cent and date is engine output.
 */
import { type ISODate, holidayTable } from '@/lib/dates';
import { cents, sumCents } from '@/lib/money';
import {
  expandScheduled,
  loanObligationsToScheduledFlows,
  type ScheduledCadence,
  type ScheduledFlow,
} from '@/lib/engine/forecast/forecast';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { detectRecurring, type RecurringTxn } from '@/lib/engine/recurring/detect';
import {
  computeBurnRates,
  discretionaryDailyOutflows,
  paymentAccountHistoryDays,
} from '@/lib/engine/radar/burn';
import { computeRadar, projectCardDues, type RadarInput, type RadarResult } from '@/lib/engine/radar/radar';
import { cashNeededFromSnapshot, resolvePaymentAccount } from '@/server/finance';
import { getProvider } from '@/lib/providers/demo';
import type { FinanceSnapshot } from '@/lib/providers/types';

/** Same horizon as /forecast — the "90-day walk" the plan calls for. */
export const RADAR_HORIZON_DAYS = 90;

export interface CashFlowRadarData {
  radar: RadarResult;
  paymentAccountName: string;
}

/** Pure assembly: snapshot → radar. Exported for the seed-grounding test. */
export function radarFromSnapshot(
  snap: FinanceSnapshot,
  today: ISODate,
  horizonDays = RADAR_HORIZON_DAYS,
): { input: RadarInput; radar: RadarResult; paymentAccountName: string } {
  const year = Number(today.slice(0, 4));
  const holidays = holidayTable(year - 1, year + 1);
  const payment = resolvePaymentAccount(snap);

  // Card obligations — the dashboard's exact assembly (PAY_IN_FULL basis).
  const { input: cashInput, result: cashNeeded, loanObligations } = cashNeededFromSnapshot(
    snap,
    today,
    'PAY_IN_FULL',
  );
  // Future cycles repeat each card's STATEMENT basis, not this cycle's
  // post-mid-cycle-payment residual (critic #172 P1-1): a typical cycle debits
  // checking the full statement. Estimate-path cards (no statement) fall back
  // to their obligation amount (the full current balance).
  const statementBasisByCard = new Map(
    cashInput.cards
      .filter((c) => c.statement)
      .map((c) => [c.id, c.statement!.statementBalanceCents] as const),
  );
  const { dues, assumptions: dueAssumptions } = projectCardDues({
    obligations: cashNeeded.cards.map((o) => ({
      ...o,
      cycleBasisCents: statementBasisByCard.get(o.cardId),
    })),
    today,
    horizonDays,
    holidays,
  });

  // Committed events — /forecast's exact assembly (scheduled flows + loan payments).
  const flows: ScheduledFlow[] = snap.scheduled
    .filter((s) => s.accountId === payment.id)
    .map((s) => ({
      description: s.description,
      amountCents: s.amountCents,
      nextDate: s.nextDate,
      cadence: (s.cadence as ScheduledCadence) ?? null,
    }));
  const loanFlows = loanObligationsToScheduledFlows(loanObligations);
  const committedEvents = expandScheduled([...flows, ...loanFlows], today, horizonDays);

  // #134 accepted residual, disclosed here because the radar promotes it from a
  // chart wobble to an alarm input: a loan whose bank ACH was ALSO
  // recurring-detected as a checking scheduled row counts twice (no structural
  // key links them; heuristic money-matching rejected — STATUS #134). Detect
  // the overlap cheaply and say so instead of silently over-warning.
  const loanOverlap =
    loanFlows.length > 0 &&
    snap.scheduled.some(
      (s) =>
        s.accountId === payment.id &&
        normalizeMerchant(s.description).categoryId === 'auto-loan',
    );

  // Starting balance mirrors cash-needed: pending applied to today's balance once.
  const assumptions: string[] = [...dueAssumptions];
  if (loanOverlap) {
    assumptions.push(
      'A detected recurring loan payment and a linked loan account may be the same loan — if so, that payment is counted twice and this projection is conservative.',
    );
  }
  const pending = cashInput.paymentAccount.pending;
  let startingBalanceCents = cashInput.paymentAccount.balanceCents;
  if (pending.length > 0) {
    startingBalanceCents = cents(
      startingBalanceCents + sumCents(pending.map((p) => p.amountCents)),
    );
    assumptions.push('Pending transactions are applied to today’s balance once (not re-counted when they post).');
  }

  // Burn: day-to-day discretionary checking outflows. Committed merchants
  // (scheduled rows + detected recurring series on the payment account) are
  // excluded — those dollars are already on the committed line.
  const excludedCanonicals = new Set<string>();
  for (const s of snap.scheduled) {
    if (s.accountId === payment.id) excludedCanonicals.add(normalizeMerchant(s.description).canonical);
  }
  const recurringTxns: RecurringTxn[] = snap.transactions
    .filter((t) => t.status === 'POSTED' && !t.isSplitParent && t.accountId === payment.id)
    .map((t, i) => ({
      id: String(i),
      accountId: t.accountId,
      date: t.date,
      amountCents: t.amountCents,
      rawDescriptor: t.rawDescriptor,
      isTransfer: t.isTransfer,
    }));
  for (const series of detectRecurring(recurringTxns, today)) {
    excludedCanonicals.add(series.merchantCanonical);
  }
  const burn = computeBurnRates(
    discretionaryDailyOutflows(snap.transactions, {
      paymentAccountId: payment.id,
      excludedCanonicals,
      today,
    }),
    paymentAccountHistoryDays(snap.transactions, payment.id, today),
  );

  const input: RadarInput = {
    today,
    horizonDays,
    startingBalanceCents,
    committedEvents,
    cardDues: dues,
    accounts: snap.accounts,
    paymentAccountId: payment.id,
    holidays,
    burn,
    assumptions,
  };
  return { input, radar: computeRadar(input), paymentAccountName: payment.name };
}

export async function getCashFlowRadar(userId: string): Promise<CashFlowRadarData> {
  const provider = getProvider();
  const today = provider.today(userId);
  const snap = await provider.getFinanceSnapshot(userId);
  const { radar, paymentAccountName } = radarFromSnapshot(snap, today);
  return { radar, paymentAccountName };
}
