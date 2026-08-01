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
import {
  mapToConsciousBuckets,
  type ConsciousBucketKey,
} from '@/lib/engine/spending-plan/conscious';
import type { SpendingPlan, SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';
import { LONG_CADENCE_WORDS, longCadencesInTerm } from '@/lib/engine/spending-plan/plan';
import {
  BUDGETS_CARD_NOTE_SURFACE,
  planCardNotes,
  planRowLabels,
  uncountedFixedNote,
} from '@/lib/engine/spending-plan/row-labels';
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
  key: 'cash_needed' | 'safe_to_spend' | 'conscious_fixed' | 'conscious_savings';
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
 * The safe-to-spend identity, decomposed ONCE — rows and basis sentences built
 * here and reshaped by two consumers: `traceSafeToSpend` (the full identity)
 * and `traceConsciousBuckets` (the strip's per-bucket panels, O.18b). The
 * basis sentences are grouped by the TERM each one describes, so a bucket
 * panel can carry exactly the sentences about its own rows without a second
 * author — the flatten order in `assembleSafeToSpend` reproduces the
 * pre-O.18b list byte-for-byte.
 */
interface SafeToSpendParts {
  rows: {
    income: TraceRow;
    fixed: TraceRow;
    savings: TraceRow;
  };
  basis: {
    income: string[];
    fixedRate: string[];
    shortfall: string[];
    discretionary: string[];
    longCadence: string[];
    /** Points readers at cash-needed — cards are not a guilt-free subtraction. */
    card: string[];
    savings: string[];
  };
}

function safeToSpendParts(plan: SpendingPlan, disclosures: SpendingPlanDisclosures): SafeToSpendParts {
  const labels = planRowLabels(plan, disclosures);
  const fixedShortfallNote = uncountedFixedNote(disclosures, 'left-to-spend', 'the fixed-expenses line');
  const rows: SafeToSpendParts['rows'] = {
    income: {
      id: 'income',
      label: labels.income.label,
      amountCents: cents(plan.patternIncomeCents),
      isEstimated: false,
      notes: [],
    },
    fixed: {
      id: 'fixed',
      label: labels.fixed.label,
      amountCents: cents(-plan.fixedExpensesCents || 0), // `|| 0` normalizes the -0 a zero term would negate to
      isEstimated: false,
      notes: [],
      action: labels.fixed.action,
    },
    savings: {
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
  };

  const basis: SafeToSpendParts['basis'] = {
    income: [
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
    ],
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
    fixedRate:
      plan.scheduledFixed.length > 0
        ? [
            'Fixed & recurring expenses are your recurring bills at a monthly rate — a weekly bill counts 52/12 each month, a biweekly one 26/12.',
          ]
        : [],
    // The understated NON-ZERO figure, which no label can reach (L.30) —
    // authored once in `row-labels.ts` beside the labels, and printed by the Ask
    // answer too. 'left-to-spend' because this panel's headline is always
    // `plan.leftToSpendCents`, negative and all, never the overage Ask renders.
    shortfall: fixedShortfallNote ? [fixedShortfallNote] : [],
    discretionary: [
      'Discretionary spending is never subtracted: guilt-free is the month’s allocation after fixed costs and savings, not what is left of it today.',
    ],
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
    longCadence: longCadenceSentences(plan, 'subtracts'),
      // Owner 2026-08-01: card statement payments are settlement, not a plan
    // subtraction. Point at Cash needed when the reader has cards.
    card:
      disclosures.creditCardCount > 0 ||
      plan.cardObligationsCents !== 0 ||
      plan.obligationsBeyondMonthCents !== 0
        ? [
            'Card statement payments are not subtracted here — paying the card settles spending already counted as fixed or guilt-free. How much cash you need for cards, and when, is answered on the dashboard under Cash needed.',
          ]
        : [],
    savings:
      plan.savingsTargetBps != null
        ? [
            'Planned savings takes the larger of your goal contributions and the savings target set in Settings — they express the same pay-yourself-first intent, so they are never added together.',
          ]
        : [],
  };

  return { rows, basis };
}

/**
 * O.18b critic P2-1: the verb is a fact about the SURFACE — the guilt-free
 * figure SUBTRACTS the monthly share; the fixed-costs figure COUNTS it.
 * Everything else in the sentence is byte-shared between the two variants (the
 * wording the L.23/L.24 copy critics arrived at), so they cannot drift apart.
 */
function longCadenceSentences(plan: SpendingPlan, verb: 'subtracts' | 'counts'): string[] {
  return longCadencesInTerm(plan.scheduledFixed).map(
    (c) =>
      `A ${LONG_CADENCE_WORDS[c].adjective} bill is spread across the ${LONG_CADENCE_WORDS[c].period}: this figure ${verb} ${LONG_CADENCE_WORDS[c].share} of it every month. Nothing is actually moved or set aside for you — ${LONG_CADENCE_WORDS[c].landing} the whole amount goes out while this figure only ever counted ${LONG_CADENCE_WORDS[c].share}, so ${LONG_CADENCE_WORDS[c].planLine}.`,
  );
}

/** Flattens the parts back into the pre-O.18b trace, byte-for-byte. Row order
 *  is pinned by tests/unit/glass-box.test.ts; basis ORDER is pinned by the
 *  order lock in tests/unit/conscious-trace.test.ts (the glass-box suite
 *  asserts membership only — O.18b critic P2-2 caught this comment claiming a
 *  lock that did not exist). */
function assembleSafeToSpend(plan: SpendingPlan, parts: SafeToSpendParts): NumberTrace {
  const { income, fixed, savings } = parts.rows;
  const rows: TraceRow[] = [income, fixed, savings];
  const sum = sumCents(rows.map((r) => r.amountCents));
  const b = parts.basis;
  return {
    key: 'safe_to_spend',
    headlineCents: cents(plan.leftToSpendCents),
    rows,
    sumCents: sum,
    reconciles: sum === plan.leftToSpendCents,
    basis: [
      ...b.income,
      ...b.fixedRate,
      ...b.shortfall,
      ...b.discretionary,
      ...b.longCadence,
      ...b.card,
      ...b.savings,
    ],
  };
}

/**
 * Rows behind the guilt-free-spending headline: the identity
 * left = pattern income − fixed expenses − planned savings, carried as SIGNED
 * rows so the same plain-summation invariant holds. Card payments are not a
 * term (owner 2026-08-01). All fields live on the SpendingPlan result itself
 * (it extends its input), so nothing is re-derived.
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
  return assembleSafeToSpend(plan, safeToSpendParts(plan, disclosures));
}

/**
 * The Conscious Spending strip's per-bucket panels (O.18b). Each bucket's rows
 * are the safe-to-spend trace's OWN rows — reshaped, sign-flipped where the
 * bucket states a cost as a positive amount — and each bucket's headline is
 * `mapToConsciousBuckets`' figure for it. That makes `reconciles` a real
 * CROSS-MODULE check of the #93 partition: the partition module and this one
 * read the same plan fields through different code, and a formula change on
 * either side surfaces here as a reported mismatch, never a silent drift.
 *
 * Guilt-free is a REMAINDER, not a sum of costs, so its honest panel is the
 * whole subtraction — the safe-to-spend trace itself, key and all: its
 * headline IS the bucket figure (`leftToSpendCents`, negative when overspent).
 *
 * Basis sentences ride the bucket whose rows they describe; none is authored
 * here. The strip-level notes (savings-unset, uncounted-fixed, overspent, and
 * the card notes) stay on the strip too — they qualify the SPLIT — but two of
 * those facts ALSO enter the panel bases below, because a panel is exported by
 * the share snapshot and a snapshot must carry the alarms the page displays
 * (O.18b critic P1-2: without this, a reader could copy "Fixed costs: $X …
 * matched to the penny" with no trace of the missing-bill caveat printed an
 * inch below it).
 */
export function traceConsciousBuckets(
  plan: SpendingPlan,
  disclosures: SpendingPlanDisclosures,
): Record<ConsciousBucketKey, NumberTrace> {
  const parts = safeToSpendParts(plan, disclosures);
  const figure = new Map(mapToConsciousBuckets(plan).buckets.map((b) => [b.key, b.cents]));
  // `|| 0` normalizes the -0 a zero term would negate to (same rule as the rows).
  const flip = (r: TraceRow): TraceRow => ({ ...r, amountCents: cents(-r.amountCents || 0) });
  const b = parts.basis;
  // The card facts the plan could not count (O.18b critic P1-1): /budgets was
  // the one surface printing this figure with no excluded-card disclosure, and
  // these panels would otherwise certify to the penny around that silence.
  // NOT added to `parts.basis` / the shared safe-to-spend trace: /spending-plan
  // renders that basis list AND its own "What this figure can't see" section,
  // so the shared trace carrying these would print them twice there.
  // The SAME surface constant the strip uses — these bases and its visible notes
  // must stay one text (critic P2-2).
  const cardNotes = planCardNotes(disclosures, BUDGETS_CARD_NOTE_SURFACE);

  const fixedRows = [flip(parts.rows.fixed)];
  const fixedSum = sumCents(fixedRows.map((r) => r.amountCents));
  const savingsRows = [flip(parts.rows.savings)];
  const savingsSum = sumCents(savingsRows.map((r) => r.amountCents));

  // O.18b critic P2-5: for fixed and savings, `reconciles` really is a runtime
  // cross-module check (headline from the partition, sum from the trace rows).
  // Guilt-free's headline and sum both read `plan.leftToSpendCents`, so its
  // agreement with the partition's cell is checked HERE instead: a future
  // conscious.ts change (say, clamping guiltFree at zero) turns this panel
  // into a visible "can't reconcile" rather than a strip whose bar and panel
  // drift silently. The line is also held by the unit partition suite and the
  // e2e painted-money sum.
  const guiltFree = assembleSafeToSpend(plan, parts);
  const guiltFreeCell = figure.get('guiltFree');
  return {
    fixed: {
      key: 'conscious_fixed',
      headlineCents: cents(figure.get('fixed') ?? 0),
      rows: fixedRows,
      sumCents: fixedSum,
      reconciles: fixedSum === figure.get('fixed'),
      // Shortfall included (critic P1-2): the missing-bill alarm qualifies this
      // bucket's own arithmetic, and the share snapshot exports only `basis`.
      basis: [
        ...b.fixedRate,
        ...b.shortfall,
        ...longCadenceSentences(plan, 'counts'),
        ...b.card,
        ...cardNotes,
      ],
    },
    savings: {
      key: 'conscious_savings',
      headlineCents: cents(figure.get('savings') ?? 0),
      rows: savingsRows,
      sumCents: savingsSum,
      reconciles: savingsSum === figure.get('savings'),
      basis: [...b.savings],
    },
    guiltFree:
      guiltFreeCell === guiltFree.headlineCents
        ? { ...guiltFree, basis: [...guiltFree.basis, ...cardNotes] }
        : { ...guiltFree, basis: [...guiltFree.basis, ...cardNotes], reconciles: false },
  };
}
