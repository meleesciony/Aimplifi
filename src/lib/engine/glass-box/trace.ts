/**
 * Glass-Box traces (DECISIONS #178, Competitive-Gap Gap 4 §1) — "tap a number,
 * see the rows it's made of, reconciled to the penny."
 *
 * Cardinal design rule: a trace NEVER recomputes a number from raw inputs. It
 * only RESHAPES the engine result it is handed, so the rows shown are — by
 * construction — the exact values the engine already summed into the headline.
 * The one thing computed here is the plain row sum, which makes `reconciles`
 * a real check rather than an assumption: if an engine result were ever
 * internally inconsistent, the trace reports the mismatch (fail loud) instead
 * of hiding it. This is the guard against the sharpest failure mode a trust
 * feature has — a false "can't reconcile" on a correct number — because there
 * is no parallel derivation that can drift from the engine.
 *
 * Pure: no I/O, no Date, integer cents only. Copy strings here follow the
 * coaching guardrails (educational, assumption stated inline, no shame).
 */
import { type Cents, cents, sumCents } from '@/lib/money';
import type { ISODate } from '@/lib/dates';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import type { SpendingPlan } from '@/lib/engine/spending-plan/plan';

export interface TraceRow {
  id: string;
  label: string;
  /** Signed contribution to the headline; the rows' plain sum IS the number. */
  amountCents: Cents;
  /** Effective due date, when the row is a dated obligation. */
  date?: ISODate;
  /** Portion autopay moves automatically (cash-needed rows). */
  autopayCents?: Cents;
  isEstimated: boolean;
  /** Engine-authored provenance sentences for this row (already formatted). */
  notes: string[];
}

export interface NumberTrace {
  key: 'cash_needed' | 'safe_to_spend';
  /** The headline number being explained, exactly as the engine returned it. */
  headlineCents: Cents;
  rows: TraceRow[];
  /** Plain sum of rows[].amountCents — computed here, displayed verbatim. */
  sumCents: Cents;
  /** True iff sumCents === headlineCents exactly (integer cents). */
  reconciles: boolean;
  /** What the rows include/exclude, stated inline (assumption transparency). */
  basis: string[];
}

/**
 * Rows behind the Cash-Needed headline. The engine's headline is
 * sum(due obligations' cashRequiredCents), and `perDueDate` partitions that
 * same `due` set by effective due date — so flattening `perDueDate` yields
 * exactly the rows the headline summed. Notes are joined from the full
 * obligation list for per-row provenance (autopay split, mid-cycle payments,
 * estimate basis, due-date adjustments).
 */
export function traceCashNeeded(result: CashNeededResult): NumberTrace {
  const notesById = new Map(result.cards.map((c) => [c.cardId, c.notes]));
  const rows: TraceRow[] = result.perDueDate.flatMap((point) =>
    point.cards.map((c, i) => ({
      // Position in the id keeps keys unique even under (API-level) duplicate
      // card ids; the notes join below is by cardId and stays last-wins —
      // unreachable from the app, where card ids are DB primary keys.
      id: `${point.date}:${i}:${c.cardId}`,
      label: c.cardName,
      amountCents: c.amountCents,
      date: point.date,
      autopayCents: c.autopayCents,
      isEstimated: c.isEstimated,
      notes: notesById.get(c.cardId) ?? [],
    })),
  );
  const sum = sumCents(rows.map((r) => r.amountCents));

  const basis: string[] = [];
  if (rows.some((r) => r.isEstimated)) {
    basis.push(
      'Rows marked "est." use the current card balance because a statement has not been generated yet.',
    );
  }
  if (result.upcoming.length > 0) {
    basis.push(
      `${result.upcoming.length} card${result.upcoming.length === 1 ? '' : 's'} without a generated statement belong${result.upcoming.length === 1 ? 's' : ''} to the next cycle and ${result.upcoming.length === 1 ? 'is' : 'are'} not included in this number.`,
    );
  }

  return {
    key: 'cash_needed',
    headlineCents: result.headline.requiredCents,
    rows,
    sumCents: sum,
    reconciles: sum === result.headline.requiredCents,
    basis,
  };
}

/**
 * Rows behind the safe-to-spend headline: the four-term identity
 * left = income − spent − upcoming bills − planned savings, carried as SIGNED
 * rows so the same plain-summation invariant holds. All four fields live on
 * the SpendingPlan result itself (it extends its input), so nothing is
 * re-derived here.
 */
export function traceSafeToSpend(plan: SpendingPlan): NumberTrace {
  const rows: TraceRow[] = [
    {
      id: 'income',
      label: 'Expected income',
      amountCents: cents(plan.expectedIncomeCents),
      isEstimated: false,
      notes: [],
    },
    {
      id: 'spent',
      label: 'Spent so far',
      amountCents: cents(-plan.spentSoFarCents),
      isEstimated: false,
      notes: [],
    },
    {
      id: 'bills',
      label: 'Bills still coming',
      amountCents: cents(-plan.upcomingBillsCents),
      isEstimated: false,
      notes: [],
    },
    {
      id: 'savings',
      label: 'Planned savings',
      amountCents: cents(-plan.plannedSavingsCents),
      isEstimated: false,
      notes: [],
    },
  ];
  const sum = sumCents(rows.map((r) => r.amountCents));

  return {
    key: 'safe_to_spend',
    headlineCents: cents(plan.leftToSpendCents),
    rows,
    sumCents: sum,
    reconciles: sum === plan.leftToSpendCents,
    basis: [
      'Expected income counts what has already arrived this month plus what is still scheduled; bills still coming are your detected recurring bills that have not posted yet.',
    ],
  };
}
