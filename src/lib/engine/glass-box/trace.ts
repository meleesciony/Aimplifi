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
import type { SpendingPlan, SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';
import { LONG_CADENCE_WORDS, longCadencesInTerm } from '@/lib/engine/spending-plan/plan';
import { planRowLabels, uncountedFixedNote } from '@/lib/engine/spending-plan/row-labels';
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
  /**
   * The control a $0 row meaning "you have not set this up" offers (L.29).
   * Present only on such a row — a control beside a working figure reads as a
   * correction. Authored by `planRowLabels`, so the two surfaces that print
   * these rows cannot disagree about which zeros are actionable.
   */
  action?: { label: string; href: string };
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
 * Rows behind the guilt-free-spending headline: the identity
 * left = pattern income − fixed expenses − card payments − planned savings
 * (− card payments already dated past this month), carried as SIGNED rows so
 * the same plain-summation invariant holds. All fields live on the
 * SpendingPlan result itself (it extends its input), so nothing is re-derived.
 */
export function traceSafeToSpend(
  plan: SpendingPlan,
  /**
   * REQUIRED, not defaulted (the L.15 lesson: a defaulted disclosure argument fails
   * silent at exactly the caller that forgets it). Two of its fields are what
   * separate a zero row that means "nothing qualified" from one that means "you
   * have not set this up" — see `planRowLabels`.
   */
  disclosures: SpendingPlanDisclosures,
): NumberTrace {
  const labels = planRowLabels(plan, disclosures);
  const fixedShortfallNote = uncountedFixedNote(disclosures, 'left-to-spend');
  const rows: TraceRow[] = [
    {
      id: 'income',
      label: labels.income.label,
      amountCents: cents(plan.patternIncomeCents),
      isEstimated: false,
      notes: [],
    },
    {
      id: 'fixed',
      label: labels.fixed.label,
      amountCents: cents(-plan.fixedExpensesCents || 0), // `|| 0` normalizes the -0 a zero term would negate to
      isEstimated: false,
      notes: [],
      action: labels.fixed.action,
    },
    {
      id: 'card-payments',
      label: labels.cardPayments.label,
      amountCents: cents(-plan.cardObligationsCents || 0), // `|| 0` normalizes the -0 a zero term would negate to
      // True in the all-estimate state (no card has a generated statement) —
      // the fact rides the plan so this row cannot claim statement provenance
      // it does not have (critic P1-3).
      isEstimated: plan.cardObligationsEstimated,
      notes: [],
    },
    {
      id: 'savings',
      // The resolved figure is max(goal contributions, the savings-% target),
      // so the label must name the side that actually decided it (#295) — and at
      // $0 name which of the two is missing, with the control that sets it (L.29).
      label: labels.savings.label,
      amountCents: cents(-plan.plannedSavingsCents || 0), // `|| 0` normalizes the -0 a zero term would negate to
      isEstimated: false,
      notes: [],
      action: labels.savings.action,
    },
    // Card payments already dated but falling past this month's edge (L.11(D)).
    // A real subtraction, in the same units as every row above it, so this
    // panel's claim — that its lines add up to the number above — stays a
    // claim that could fail. Present only when such a payment exists: a $0 row
    // would name a mechanism that did not act, for a reader who owns no cards.
    ...(plan.obligationsBeyondMonthCents > 0
      ? [
          {
            id: 'card-payments-next',
            label: `Card payments already dated, due after this month (through ${plan.obligationsBeyondMonthThroughDate})`,
            amountCents: cents(-plan.obligationsBeyondMonthCents),
            // Its own flag: when every card is dated past the edge the in-month
            // one is false by construction, and this row would then claim
            // statement provenance for a figure that is entirely an estimate.
            isEstimated: plan.obligationsBeyondMonthEstimated,
            notes: [],
          },
        ]
      : []),
  ];
  const sum = sumCents(rows.map((r) => r.amountCents));

  return {
    key: 'safe_to_spend',
    headlineCents: cents(plan.leftToSpendCents),
    rows,
    sumCents: sum,
    reconciles: sum === plan.leftToSpendCents,
    basis: [
      plan.incomeBasis === 'trailing-median'
        ? `Income is the median of your last ${plan.incomeMonths} complete month${plan.incomeMonths === 1 ? '' : 's'} of income across everything that arrived in your checking and savings accounts — a pattern, so the figure does not swing with what has posted so far this month. ${
            plan.incomeMonths >= 3
              ? 'A one-time deposit touches only its own month; the median ignores it.'
              : 'With fewer than three complete months behind it, a one-time deposit can still count — the pattern steadies as the third month arrives.'
          }`
        : plan.incomeBasis === 'detected-series'
          ? // The annual-income exclusion is disclosed HERE and nowhere else it
            // matters, because this is the only basis that reads detected series
            // as the income figure (L.23 copy critic P1-4, widened by the L.24 copy
            // critic P1-3 to the two cadences L.24 added): /recurring counts a
            // long-rhythm deposit at a share of a month while this counts $0, and until
            // this sentence they were both described as "detected recurring income
            // at a monthly rate" — two surfaces, one fact, apart. The trailing
            // median needs no such clause: it counts a bonus in the month it
            // actually arrived.
            'Income is your detected recurring income at a monthly rate — there is no complete month of history to take the pattern from yet. A deposit on a rhythm longer than monthly — quarterly, twice a year, or yearly — is not counted here: one long gap is not enough to say when the next one lands, and counting money that may not arrive would make this figure too big. Your recurring list shows such a deposit at a share of a month; this figure leaves it out.'
          : 'There is no income pattern yet — nothing here is invented; once a complete month of income posts, the figure comes from that pattern.',
      // BIWEEKLY is named too (L.23 copy critic P2-4): ×26/12 is the largest
      // multiplier in the table and the commonest real cadence in this app.
      //
      // L.29 splits the sentence in two, because its halves have different truth
      // conditions. The RATE half describes what the fixed term did to rows it
      // holds — this function's own rule ("a $0 row would name a mechanism that
      // did not act") applied to the sentence beside the row instead of the row:
      // told to a reader whose term is empty, it explains an arithmetic that ran
      // on nothing, next to a line that now says so. The DISCRETIONARY half is a
      // property of the formula itself and is true for every reader, including
      // the one with no bills at all — it is what stops "$0 fixed" being read as
      // "nothing I spend is counted anywhere".
      ...(plan.scheduledFixed.length > 0
        ? [
            'Fixed & recurring expenses are your recurring bills at a monthly rate — a weekly bill counts 52/12 each month, a biweekly one 26/12.',
          ]
        : []),
      // The understated NON-ZERO figure, which no label can reach (L.30) —
      // authored once in `row-labels.ts` beside the labels, and printed by the Ask
      // answer too. 'left-to-spend' because this panel's headline is always
      // `plan.leftToSpendCents`, negative and all, never the overage Ask renders.
      ...(fixedShortfallNote ? [fixedShortfallNote] : []),
      'Discretionary spending is never subtracted: guilt-free is the month’s allocation after fixed costs and savings, not what is left of it today.',
      // Only when an annual bill is actually IN the term. Unconditional, this told
      // every reader their yearly premium was handled at a twelfth a month, when
      // the detector needs three sightings at a steady price — about two years of
      // history — to see one at all, and a premium that rises every year is never
      // detected. That is this function's own rule 35 lines above ("a $0 row would
      // name a mechanism that did not act"), applied to a cadence instead of a
      // card (L.23 copy critic P1-2). What the reader gets when the clause is
      // absent lives in /spending-plan's "What this figure can't see".
      //
      // And it may not say the money is SET ASIDE (P1-1): `computeSpendingPlan` is
      // stateless per month and carries nothing forward, while "set aside" already
      // means the L.11(D) reservation — a real carried term with its own visible
      // row — three paragraphs down and on the dashboard card.
      //
      // L.24 generalized the clause to the two cadences it added. The template
      // below reproduces the ANNUAL sentence above BYTE-FOR-BYTE — the wording
      // the L.23 copy critic arrived at — and the fractions come from the same
      // table `monthlyRateCents` divides by, so the sentence cannot claim a
      // third while the arithmetic takes a twelfth.
      ...longCadencesInTerm(plan.scheduledFixed).map(
        (c) =>
          `A ${LONG_CADENCE_WORDS[c].adjective} bill is spread across the ${LONG_CADENCE_WORDS[c].period}: this figure subtracts ${LONG_CADENCE_WORDS[c].share} of it every month. Nothing is actually moved or set aside for you — ${LONG_CADENCE_WORDS[c].landing} the whole amount goes out while this figure only ever counted ${LONG_CADENCE_WORDS[c].share}, so ${LONG_CADENCE_WORDS[c].planLine}.`,
      ),
      // Gated on a card existing at all (L.29, same rule as the clause above):
      // "assumes each is paid in full" and "comes from the same obligation rows"
      // describe a mechanism that cannot have acted for a reader with no linked
      // card, beside a row that now says exactly that. A reader who HAS cards
      // still gets it whether or not any is due this month — the assumption is
      // what makes a $0 in-month line readable.
      ...(disclosures.creditCardCount > 0 || plan.cardObligationsCents !== 0
        ? [
            'Spending on credit cards is counted when its statement’s payment comes due, not again at purchase time. The card-payments line covers your own cards due this month, assumes each is paid in full, and comes from the same obligation rows as the cash-needed answer.',
          ]
        : []),
      ...(plan.cardObligationsEstimated
        ? [
            'No statement has been generated yet, so the card-payments line is estimated from current balances.',
          ]
        : []),
      // Why a monthly plan is quoting a figure smaller than its own arithmetic.
      // The fact a reader needs and cannot see: the money is not gone (it is
      // reserved for a payment already dated). The reservation's income side
      // reads every scheduled income series (user rows on any account,
      // detected rows scoped to the payment account) — never a balance — so
      // the figure says nothing about cash held elsewhere (the L.11(C)
      // account-set rule).
      ...(plan.obligationsBeyondMonthCents > 0
        ? [
            `A statement can come due after the month it belongs to, and one dated ${plan.obligationsBeyondMonthThroughDate} would otherwise sit in no plan you can see — this month would call it next month's business, and next month's plan would arrive after the money was spent. Only the part your scheduled income does not arrive in time to cover is set aside here, so a payment your next paycheck already pays for is not reserved twice. Whatever is set aside will also appear in next month's card-payments line until it is paid.`,
          ]
        : []),
      ...(plan.savingsTargetBps != null
        ? [
            'Planned savings takes the larger of your goal contributions and the savings target set in Settings — they express the same pay-yourself-first intent, so they are never added together.',
          ]
        : []),
    ],
  };
}
