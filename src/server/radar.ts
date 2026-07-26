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
import { cashNeededFromSnapshot, personalCardDuplicates, resolvePaymentAccount } from '@/server/finance';
import {
  type CardDuplicatePairInput,
  cardDuplicateRadarNote,
} from '@/lib/engine/account/card-duplicate-view';
import { getProvider } from '@/lib/providers/demo';
import type { FinanceSnapshot } from '@/lib/providers/types';
import { accountLabel } from '@/lib/engine/account/display-name';

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
  /**
   * Suspected same-card-twice pairs (TASKS L.15, critic P1-2). Advisory: the projection is left
   * exactly as computed — the radar only says why it may be pessimistic, the same way it already
   * discloses the #134 loan overlap. Omitted ⇒ byte-identical to the pre-L.15 radar.
   */
  cardDuplicates: readonly CardDuplicatePairInput[] = [],
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

  /**
   * TASKS L.15 (g) — the duplicate disclosure for the radar, and the boundary took THREE critic
   * cycles to get right.
   *
   * Cut 1 resolved the pair against `cashNeeded.cards`, so a PAID-OFF pair — in no projected cycle
   * at all — hedged a genuine overdraft warning. Cut 2 narrowed to `dues`, the rows the projection
   * actually repeats. A third critic falsified that too, and the falsification is the useful part:
   * **being in the projection does not make this sentence true.** The sentence claims the dip date
   * may be earlier and the amount to move larger than needed, and BOTH of those are fixed by the
   * worst point of the 90-day walk — not by the presence of dues elsewhere in it. An ordinary state
   * separates them: a real crunch this week caused by a DIFFERENT card, with the duplicated pair due
   * next month. Removing the duplicate changes neither figure, yet the reader was told the $2,900
   * they must move within four days might be imaginary. Acting on that hedge means overdrafting.
   *
   * So the gate is now the counterfactual the sentence itself asserts: re-walk the projection with
   * one side of each pair removed, and speak ONLY if the dip date or the cover amount actually
   * moves. `computeRadar` is pure, so this is one extra in-memory walk and no I/O, paid only by a
   * user who has a projected duplicate at all.
   *
   * This also settles the `status === 'ok'` case (critic P2) without a second rule: with no dip
   * there is no dip date and no transfer in either walk, nothing differs, and the radar stays quiet
   * instead of printing "the dip date may be earlier" under a header reading "Clear".
   *
   * Nothing is ADJUSTED: the counterfactual decides only whether to speak. Every figure the radar
   * displays comes from the real walk, duplicates included.
   */
  const projectedPairs = cardDuplicateRadarNote(
    cardDuplicates,
    dues.map((d) => ({ cardId: d.cardId, label: d.cardName })),
  );
  const baseInput: RadarInput = {
    today,
    horizonDays,
    startingBalanceCents,
    committedEvents,
    cardDues: dues,
    // `feedDroppedAt` is optional on the snapshot shape and REQUIRED here, so the normalization
    // happens once, at the boundary, rather than the engine guessing (TASKS L.14).
    accounts: snap.accounts.map((a) => ({ ...a, feedDroppedAt: a.feedDroppedAt ?? null })),
    paymentAccountId: payment.id,
    holidays,
    burn,
    assumptions,
  };
  const radar = computeRadar(baseInput);

  let duplicateNotes: string[] = [];
  if (projectedPairs.length > 0) {
    // Drop ONE side of every suspected pair — if they really are one card, this is what the
    // projection would have looked like all along.
    const shadowed = new Set(cardDuplicates.map((p) => p.bId));
    const deduped = dues.filter((d) => !shadowed.has(d.cardId));
    const truth = computeRadar({ ...baseInput, cardDues: deduped });
    const dipMoved =
      truth.committed.firstNegativeDate !== radar.committed.firstNegativeDate;
    const coverMoved =
      (truth.coverTransfer?.amountCents ?? null) !== (radar.coverTransfer?.amountCents ?? null);
    if (dipMoved || coverMoved) duplicateNotes = projectedPairs;
  }
  assumptions.push(...duplicateNotes);

  const input: RadarInput = { ...baseInput, assumptions };
  return {
    input,
    // Carried on the result as well as in `assumptions`: the cash_flow_alert PUSH composes its own
    // body and never reads `assumptions`, and the push is where this alert does its damage.
    // First pair only (critic NEW-5): a push body is truncated by the operating system, and two
    // stacked disclosures would push the dip date and the amount off screen. `assumptions` keeps
    // every pair for the in-app card, which has room. Same trade as `cardDuplicatePushNotes`.
    radar: { ...radar, duplicateDisclosure: duplicateNotes[0] ?? null },
    paymentAccountName: accountLabel(payment),
  };
}

export async function getCashFlowRadar(userId: string): Promise<CashFlowRadarData> {
  const provider = getProvider();
  const today = provider.today(userId);
  const snap = await provider.getFinanceSnapshot(userId);
  // The pair is detected per run here too, from this same PERSONAL snapshot (the radar has no
  // household scope). `cashNeededFromSnapshot` inside `radarFromSnapshot` recomputes the obligation
  // set, so the ids line up with what the projection repeats.
  const { result } = cashNeededFromSnapshot(snap, today, 'PAY_IN_FULL');
  const cardDuplicates = await personalCardDuplicates(userId, snap, result);
  const { radar, paymentAccountName } = radarFromSnapshot(snap, today, undefined, cardDuplicates);
  return { radar, paymentAccountName };
}
