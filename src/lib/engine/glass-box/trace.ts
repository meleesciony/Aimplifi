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
import { frozenCardsNote } from '@/lib/engine/account/feed-dropped-view';
import type { SpendingPlan } from '@/lib/engine/spending-plan/plan';
import {
  type CardDuplicatePairInput,
  cardDuplicateTraceBasis,
} from '@/lib/engine/account/card-duplicate-view';

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
export function traceCashNeeded(
  result: CashNeededResult,
  /**
   * Suspected same-card-twice pairs among the viewer's own cards (TASKS L.15 (f)). Advisory: no row
   * is removed and no figure is adjusted, so `reconciles` is untouched. Omitted ⇒ byte-identical to
   * the pre-L.15 trace.
   */
  cardDuplicates: readonly CardDuplicatePairInput[] = [],
  /**
   * Card ids owned by another household member (critic P1-1). The first cut hardcoded
   * `ownership: 'reader'` here on the strength of a comment claiming both callers read a
   * personal-scope result — false for the dashboard hero, which renders `data.payInFull`, the
   * MERGED result, and whose own page comment says so. The panel then vouched for a partner's
   * frozen card in the second person, naming a bank the reader has no relationship with and a
   * connection their /accounts does not list — in the one place a reader goes precisely because
   * they doubt the number.
   *
   * Defaults to empty rather than required only because this is the third positional argument on a
   * builder with an existing defaulted one; the two production callers both pass it explicitly.
   */
  partnerCardIds: ReadonlySet<string> = new Set(),
): NumberTrace {
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
  // TASKS L.15 (f). Resolved against the rows this trace actually lists, in their paint order and
  // under the exact label it prints (`row.label` IS `card.cardName`) — so the sentence can never
  // point at a row that is not on screen. Rebuilt from `perDueDate` rather than read off `rows`
  // because `row.id` is a composite `date:index:cardId` key, which no pair id would ever match.
  //
  // This is the surface where silence costs the most. The reader has deliberately opened the
  // breakdown to audit the number, and the trace reconciles to the penny; two rows for one card
  // therefore read as CONFIRMATION that both belong. `reconciles` stays true because it is a check
  // on the engine's internal consistency, not on whether the world has two cards — and conflating
  // the two is exactly what this line prevents.
  basis.push(
    ...cardDuplicateTraceBasis(
      cardDuplicates,
      result.perDueDate.flatMap((point) =>
        point.cards.map((c) => ({ cardId: c.cardId, label: c.cardName })),
      ),
    ),
  );

  // TASKS L.18, and the same argument one clause down: a reader opens this panel to AUDIT the
  // number, and every row it lists is green-checked against the headline. A card whose bank stopped
  // sharing it is therefore vouched for here more strongly than anywhere else in the app. Resolved
  // against the rows this trace actually lists — a frozen card in `upcoming` is in no row and in no
  // total, so it is not named here (the line above already says why it is excluded).
  const frozenRows = result.perDueDate
    .flatMap((point) => point.cards.map((c) => c.cardId))
    .filter((id, i, all) => all.indexOf(id) === i)
    .map((id) => result.cards.find((c) => c.cardId === id))
    .filter((c): c is NonNullable<typeof c> => c != null && c.frozenSince != null);
  const frozenBasis = frozenCardsNote(
    frozenRows.map((c) => ({
      cardId: c.cardId,
      label: c.cardName,
      frozenSince: c.frozenSince as string,
      isEstimated: c.isEstimated,
      ownership: partnerCardIds.has(c.cardId) ? ('partner' as const) : ('reader' as const),
    })),
    // A figure, not an instruction: this panel explains a total, and the pay-by-date imperative it
    // supports lives on the cards it came from, which carry their own guard.
    { role: 'figure', nextStep: 'accounts-route' },
  );
  if (frozenBasis) basis.push(frozenBasis);
  // `reconciles` is deliberately untouched, for the reason stated above: the rows really do sum to
  // the headline, and failing the check would claim a drift that does not exist.

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
