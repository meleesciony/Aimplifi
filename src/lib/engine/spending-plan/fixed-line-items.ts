/**
 * The Fixed list that accounts for its own total (C.19 / H.3, owner-reported
 * four times: *"where is mortgage? Fixed expense list must include mortgage"*).
 *
 * THE DEFECT THIS CLOSES. The mortgage was never missing from the Fixed FIGURE —
 * C.24 (#394) put it there deliberately, at its full $6,217.07 monthly rate. It
 * was missing from every Fixed LIST, and for a structural reason rather than a
 * rendering one: C.24's exactness invariant removes a structural loan payment's
 * rows from the category rollup (the half that produces lines) and re-adds the
 * money through the union (the half that returned a bare `number`).
 * `tests/unit/loan-payment-fixed-union.test.ts` asserts that as CORRECT — for a
 * reader whose only housing spend is that mortgage the rollup returns
 * `rows: []`. So the list showed nothing, the total showed $6,217.07, and the
 * reader was right that the app had lost his largest bill.
 *
 * WHY THE ASSEMBLY LIVES HERE AND NOT IN THE PAGE. A list under a money figure
 * is a claim that the lines add up to it (the O.5/O.6 link invariant, restated
 * for a list instead of a link). C.26's critic proved that leaving such a
 * composition in a `.tsx` lets a later edit reintroduce the defect with the
 * whole suite green, because nothing in the repo asserts a view's arithmetic. So
 * the engine assembles the lines, does the subtraction, and REFUSES to certify
 * when the two halves cannot meet — and the page renders a verdict it cannot
 * forge.
 *
 * THE THIRD SOURCE, ADDED BY C.23/H.4. The reserve/sinking fund the owner
 * described (*"money being reserved every month for home repair"*, *"yearly
 * membership dues… divide by 12 and put that cash aside"*) now has a model, and
 * its lines are assembled here beside the other two. It is the only kind with no
 * transaction behind it, so it is the only kind whose label is the reader's own
 * words — see `reserves.ts` for why that is Fixed and not savings.
 */
import {
  LONG_CADENCE_WORDS,
  type FixedUnionRow,
  type SpendingPlan,
} from '@/lib/engine/spending-plan/plan';
import {
  fixedAmountBasisClause,
  type FixedCategoryAmount,
} from '@/lib/engine/spending-plan/fixed-category-amounts';
import { reserveBasisNote } from '@/lib/engine/spending-plan/reserves';
import { billRenameKey, namedBillLabel } from '@/lib/engine/spending-plan/bill-rename';
export { UNNAMED_BILL_LABEL } from '@/lib/engine/spending-plan/bill-rename';

/** Where a line's money came from — the three sources genuinely differ in kind.
 *  `'reserve'` is the one with no transaction behind it: the reader declared it
 *  (C.23/H.4), so it can never be traced to a merchant or a category. */
export type FixedLineKind = 'category' | 'recurring-bill' | 'reserve';

export interface FixedListLine {
  key: string;
  /** What the reader sees. Never a guess — see `label` handling below. */
  label: string;
  /**
   * Recurring-bill overlay key. Absent on category and reserve lines.
   * Identity for a household name; not a money figure.
   */
  billKey?: string;
  amountCents: number;
  /** True when a BillAmount overlay priced this line (DECISIONS #607). */
  amountOverlaid?: boolean;
  kind: FixedLineKind;
  /** MONTHLY-rate lines say so: a quarterly premium is listed at a third of its
   *  charge, and a reader comparing this to a statement must be told that. */
  cadence: string | null;
  /** C.24's structural loan payment — the reason it is listed as its own bill
   *  rather than inside its category. */
  loanPayment: boolean;
  /**
   * HOW THIS LINE'S AMOUNT WAS ARRIVED AT, per line, rendered beside it.
   *
   * The copy critic's sharpest pair of findings were both this: one sentence
   * above the list described the union's monthly smoothing while most rows are
   * category averages, so it was false twice over (a quarterly premium first
   * charged mid-window renders at its WHOLE charge in a category line, which is
   * the exact opposite of what the sentence promised) — and a reader's own typed
   * budget target rendered pixel-identical to a measured three-month average,
   * losing the provenance clause `/budgets` is REQUIRED to print beside the same
   * figure (audit P1-8, `fixedAmountBasisClause`).
   *
   * A list whose rows come from two different bases cannot be described by one
   * sentence. So the basis travels ON the row, from the same authors: the
   * rollup's own clause for a category line, and `LONG_CADENCE_WORDS` — the
   * table two other surfaces already disclose smoothing from — for a bill.
   * `null` only when the line's own amount needs no qualifier (a monthly bill
   * counted once a month).
   */
  basisNote: string | null;
  /**
   * A RESERVE's whole cost, once per its cadence — the figure the reader
   * actually typed, which `amountCents` is a twelfth (or third, or sixth) of.
   *
   * Carried as a number rather than baked into `basisNote` so the one
   * `formatCents` at the UI boundary stays the only place money becomes text.
   * `null` on every other kind: a category average and a detected bill have no
   * "whole cost" the reader ever stated.
   */
  reserveTrueCostCents?: number;
}

export interface FixedListResult {
  lines: FixedListLine[];
  /**
   * ALWAYS the sum of `lines`, in every branch.
   *
   * The first cut printed the PLAN's fixed figure here and let the branches
   * below explain the difference in prose. That put a total on screen that its
   * own lines contradict — a reader who adds up what is in front of them gets a
   * different number and has no way to tell which one is wrong. A figure
   * directly above a list is read as that list's total, so it has to BE that
   * list's total; the plan's figure is published separately as
   * `planFixedCents`, and the gap between them is the thing the note explains.
   */
  totalCents: number;
  /** What the plan actually uses for fixed costs. Equal to `totalCents` exactly
   *  when `reconciles`; otherwise the figure the list cannot fully reach. */
  planFixedCents: number;
  /** True ⇒ the lines account for every cent of `planFixedCents`. */
  reconciles: boolean;
  /** `planFixedCents − totalCents`; 0 when it reconciles. */
  unaccountedCents: number;
  /**
   * The sentence to print under the list. Non-null in EVERY case, because both
   * a reconciled list and an incomplete one make a claim the reader is entitled
   * to (`an-empty-set-is-not-a-fact-about-money`).
   */
  note: string;
}


/**
 * The qualifier for a BILL line. Only the three smoothed long rhythms get one —
 * they are the cases where the figure listed is deliberately not the charge the
 * reader will see on a statement, which is the whole reason the disclosure
 * exists. WEEKLY/BIWEEKLY are also converted, and say so plainly. A MONTHLY bill
 * listed at its monthly amount needs no explanation and is given none, because a
 * qualifier on a line that needs none trains readers to skip the ones that do.
 */
export function billBasisNote(cadence: string | null): string | null {
  if (cadence === 'QUARTERLY' || cadence === 'SEMIANNUAL' || cadence === 'ANNUAL') {
    const w = LONG_CADENCE_WORDS[cadence];
    return ` (${w.adjective} bill — ${w.share} of it each month)`;
  }
  if (cadence === 'WEEKLY') return ' (weekly bill — counted at what it comes to each month)';
  if (cadence === 'BIWEEKLY')
    return ' (every-two-weeks bill — counted at what it comes to each month)';
  return null;
}

function labelFor(
  row: FixedUnionRow,
  nameOfCategory: (id: string) => string,
  names: ReadonlyMap<string, string>,
): string {
  return namedBillLabel(row, names, nameOfCategory);
}

/**
 * Assemble the Fixed list and certify it.
 *
 * `rollupRows` are the per-category Fixed amounts (`resolveFixedCategoryAmounts`)
 * the caller already computed for this same month with the same exclusions. They
 * are NOT recomputed here: two authors for one basis is the divergence class
 * this whole wave exists to remove.
 */
export function buildFixedList(input: {
  plan: Pick<
    SpendingPlan,
    | 'fixedBasis'
    | 'suggestedFixedCents'
    | 'fixedExpensesCents'
    | 'fixedLineItems'
    | 'fixedLineItemsCoverRemainder'
    | 'reserveLines'
  >;
  rollupRows: readonly FixedCategoryAmount[];
  nameOfCategory: (id: string) => string;
  /** Household names for repeating bills. Absent/empty = detector labels. */
  billNames?: ReadonlyMap<string, string>;
  /** Household monthly-rate overlays. Absent/empty = detector amounts. */
  billAmounts?: ReadonlyMap<string, number>;
}): FixedListResult {
  const { plan } = input;
  const billNames = input.billNames ?? new Map<string, string>();
  const billAmounts = input.billAmounts ?? new Map<string, number>();
  const categoryLines: FixedListLine[] = input.rollupRows.map((r) => ({
    key: `category:${r.categoryId}`,
    label: r.name,
    amountCents: r.amountCents,
    kind: 'category' as const,
    cadence: null,
    loanPayment: false,
    // The rollup's OWN clause, not a second author's paraphrase of it.
    basisNote: fixedAmountBasisClause(r),
  }));
  const billLines: FixedListLine[] = plan.fixedLineItems.map((r) => {
    const key = billRenameKey(r);
    const overlay = billAmounts.get(key);
    return {
      key: `bill:${r.key}`,
      label: labelFor(r, input.nameOfCategory, billNames),
      billKey: key,
      amountCents: r.monthlyRateCents,
      amountOverlaid: typeof overlay === 'number' && overlay > 0,
      kind: 'recurring-bill' as const,
      cadence: r.cadence,
      loanPayment: r.loanPayment,
      basisNote: billBasisNote(r.cadence),
    };
  });
  // Declared reserves (C.23/H.4). The label is the reader's own name for it and
  // is never decorated with a category or a merchant, because there is neither:
  // the whole point of this kind is that no transaction implies it.
  const reserveListLines: FixedListLine[] = plan.reserveLines.map((r) => ({
    key: `reserve:${r.id}`,
    label: r.name,
    amountCents: r.monthlyCents,
    kind: 'reserve' as const,
    cadence: r.cadence,
    loanPayment: false,
    basisNote: reserveBasisNote(r.cadence),
    reserveTrueCostCents: r.trueCostCents,
  }));
  const lines = [...categoryLines, ...billLines, ...reserveListLines].sort(
    (a, b) => b.amountCents - a.amountCents || a.label.localeCompare(b.label),
  );
  const sum = lines.reduce((s, l) => s + l.amountCents, 0);

  // A LOCKED INTENTION IS NOT AN ITEMIZABLE FIGURE. The reader typed the number
  // on the page; the lines describe the data suggestion beside it. Certifying
  // here would claim the reader's own figure was computed from these bills.
  // TWO INDEPENDENT FACTS, DELIBERATELY NOT NESTED. The first cut tested
  // `fixedBasis === 'user-set'` and returned, so an override laid over the
  // MEDIAN basis printed "these lines are what your data shows" while the
  // majority of that data — a typical month with no lines behind it at all —
  // had no line and never could. One branch swallowed the other's disclosure.
  // A sentence per fact, composed, is the `a-disclosure-is-several-claims-in-
  // one-sentence` remedy.
  const readerSetTheFigure = plan.fixedBasis === 'user-set';
  const remainderCannotBeListed = !plan.fixedLineItemsCoverRemainder;
  const planFixedCents = readerSetTheFigure
    ? plan.fixedExpensesCents
    : plan.suggestedFixedCents;
  const unaccountedCents = planFixedCents - sum;

  /**
   * DISJOINTNESS, WHICH THE ARITHMETIC CANNOT SEE (money critic P1-1).
   *
   * `sum(lines) === planFixedCents` is a claim about a TOTAL. Printed under a
   * list it is read as a claim about the COMPOSITION — that each line is
   * different money — and those two come apart in exactly one place. C.24 keeps
   * a unioned bill out of the rollup by MERCHANT CANONICAL, so if the payee's
   * wording changes mid-window (a servicer transfer, a bank relabel) the old
   * rows stay in the rollup while the series unions at full rate: the critic
   * executed a mortgage appearing as its own $6,217.07 line AND as $2,072.36
   * inside Rent & Mortgage, over by exactly the fragment
   * `averageMonthlySpendByCategory` calls "the trap the exclusion exists to
   * kill" — with the sum balancing and the page certifying it to the penny.
   * The same happens when a series carries no `merchantCanonical` at all, since
   * then no exclusion is derivable.
   *
   * The app cannot tell that two canonicals are one payee — that is the limit of
   * merchant identity, not of this function. What it CAN see is that it is not
   * in a position to promise: a bill filed to a category that also has its own
   * line here. On the intended C.24 path that costs nothing, because the
   * merchant's rows have left the rollup and the category usually has no row at
   * all (`loan-payment-fixed-union.test.ts` asserts exactly that). So the guard
   * fires only on the ambiguous overlap, and it withholds a sentence rather than
   * changing a figure — the safe direction for a claim about money.
   */
  const rollupCategoryIds = new Set(input.rollupRows.map((r) => r.categoryId));
  const overlappingBill = plan.fixedLineItems.find(
    (r) => r.categoryId !== null && rollupCategoryIds.has(r.categoryId),
  );
  const compositionUnprovable = overlappingBill !== undefined;

  const reconciles =
    !readerSetTheFigure &&
    !remainderCannotBeListed &&
    !compositionUnprovable &&
    unaccountedCents === 0;

  const parts: string[] = [];
  if (readerSetTheFigure) {
    parts.push(
      'Your plan uses the fixed-costs figure you set yourself, so these lines are what your data suggests instead.',
    );
    // …EXCEPT the reserves, which are not a suggestion: they are added on top of
    // the typed figure (`reserveMonthlyCents`), so the sentence above is false
    // about them and has to be corrected rather than left to be read across.
    // `a-disclosure-is-several-claims-in-one-sentence` — one fact, one sentence.
    if (plan.reserveLines.length > 0) {
      parts.push(
        plan.reserveLines.length === 1
          ? 'The reserve you declared is the exception — it is added on top of the figure you set, because you told us about it separately.'
          : `The ${plan.reserveLines.length} reserves you declared are the exception — they are added on top of the figure you set, because you told us about them separately.`,
      );
    }
  }
  // Gated on the remainder being NON-ZERO, not merely on the basis: a median of
  // zero leaves nothing unlisted, and explaining "the rest" when the rest is
  // $0.00 describes a gap the reader cannot see (money critic P2-1).
  if (remainderCannotBeListed && unaccountedCents !== 0) {
    parts.push(
      'The rest comes from your monthly spending pattern — a typical month rather than a list of bills — so it has no individual lines behind it.',
    );
  } else if (!readerSetTheFigure && !remainderCannotBeListed && unaccountedCents !== 0) {
    parts.push(
      "These lines don't add up to the fixed costs your plan uses, and we'd rather say so than pretend.",
    );
  }
  if (compositionUnprovable) {
    parts.push(
      `One of these bills is filed under ${input.nameOfCategory(overlappingBill.categoryId!)}, which also has its own line here — so we can't promise the two aren't counting some of the same money.`,
    );
  } else if (reconciles) {
    // P2-3: the singular carries its own determiner — "This line adds up".
    parts.push(
      lines.length === 1
        ? 'This line adds up to the fixed costs your plan uses — matched to the penny.'
        : `These ${lines.length} lines add up to the fixed costs your plan uses — matched to the penny.`,
    );
  }

  // The empty case is SEVERAL different facts (money critic P1-2: the second
  // ladder dropped the `user-set` disclosure for a NON-ZERO override, telling a
  // reader who had typed $5,000 that it "comes from their monthly spending
  // pattern"). The `parts` ladder above already composes every fact correctly,
  // so it is REUSED and only the "no lines yet" sentence is added when the
  // figure is genuinely zero — the one case a sentence about nothing can still
  // be true. `a-zero-is-a-claim-and-must-name-which-zero`.
  if (lines.length === 0) {
    if (planFixedCents === 0 && !readerSetTheFigure) {
      parts.push(
        'Your plan counts no fixed costs this month. Once a category has a complete month of spending behind it, or a repeating bill is detected, its lines show up here.',
      );
    }
    if (parts.length === 0) {
      parts.push(
        'There are no lines to list here — and we can’t invent any, because every amount on this page has to come from your data.',
      );
    }
    return {
      lines,
      totalCents: 0,
      planFixedCents,
      reconciles: false,
      unaccountedCents,
      note: parts.join(' '),
    };
  }

  return {
    lines,
    totalCents: sum,
    planFixedCents,
    reconciles,
    unaccountedCents,
    note: parts.join(' '),
  };
}
