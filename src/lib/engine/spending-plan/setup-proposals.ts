/**
 * FIXED-COST SETUP PROPOSALS — C.23's guided half (DECISIONS #431).
 *
 * The reserve MODEL shipped (#412): the reader can declare a reserve — a known
 * future expense with no bill behind it — and it enters the Fixed figure at its
 * smoothed monthly rate. What was missing is the GUIDED section the owner asked
 * for verbatim ("there should be a settings section for this"): a surface that
 * IS the app's Fixed basis, not a second one, where the detected recurring
 * series are PROPOSED for the reader to confirm and edit instead of type.
 *
 * WHY THE PROPOSAL IS ONE AUTHORITY WITH THE PLAN, NOT A SECOND DETECTION.
 * The server loader (`countedExpenseSeriesForPlan`, spending-plan.ts) already
 * produces exactly the `PlanScheduledItem[]` the Fixed union consumes. This
 * module runs THE SAME union builder over that same array and marks each series
 * by the union's own row key, so a line cannot be "proposed" in settings while
 * the plan counts it differently — the two surfaces share one verdict by
 * construction. `getSpendingPlan` returns the counted array additively, and the
 * settings card feeds it straight back here. The oracle switches WITH the
 * plan's own basis (critic P1-2): the union is the oracle only for the two
 * bases that ADD it, while the last-resort basis (`detected-series`) counts
 * every non-settlement series directly — `recurringPlanExpenseRows`, the very
 * function the plan summed — so the proposal re-runs THAT builder there,
 * never a narrower verdict that would call a counted series "not in your
 * fixed costs" and offer a lever whose delta is zero.
 *
 * THE LEVERS. A proposal is either already in the basis (a unioned bill — its
 * money is in the Fixed figure at exactly its smoothed monthly rate) or absent
 * with a named reason. The three reasons are the UNION'S OWN three skips, and
 * they must not be read as one thing: `covered` means the money IS in the
 * figure under the category's rollup (a detected series' rows classify fixed
 * via `fixedMerchants` whatever the category taxonomy — so even a
 * taxonomy-discretionary category holding a recurring merchant is covered, not
 * out); `discretionary` means the money is genuinely OUTSIDE the figure (no
 * rollup mass — the reader flipped the rows, or the series is freshly detected
 * and not yet stored); `budget-priced` means the reader's own category budget
 * priced the money themselves.
 *
 * For a long-cadence series the ONE new lever is "turn this into a monthly
 * reserve": the reserve stores the series' own true cost and cadence (the app
 * divides — the owner's ÷12), and the series is demoted via `RecurringOverride
 * NOT_BILL`, which removes it from detection output entirely (`detect.ts:399-403`
 * — "every consumer of this function loses the series at once"). The swap is
 * EXACT only where the money's current home is the union row or nowhere:
 *  - inBasis: −(the union row, which IS the series' whole contribution) + (the
 *    reserve at the same `monthlyRateCents`) = 0. The Fixed figure does not
 *    move a cent — the owner's yearly-dues-as-reserve case, locked by a test.
 *  - discretionary: +rate, exactly — money that was in no figure enters at the
 *    smoothed rate, and the demote changes no class (the rows were never
 *    fixed-classified).
 * The lever is NOT offered on `covered` series: their money sits in the
 * category rollup at the category's actuals-average, and a reserve would count
 * it twice (a taxonomy-fixed category keeps the rows fixed-classified after
 * the demote) or at a drifted figure (a discretionary one). The proposal says
 * "already counted under <Category>" instead of offering a second commitment.
 *
 * WHAT IS NEVER PROPOSED. A MONTHLY series is a bill — converting it would be a
 * rename with no new meaning, so the lever requires QUARTERLY / SEMIANNUAL /
 * ANNUAL. Settlement-category series (`PLAN_FIXED_NEVER` — credit-card-payment,
 * cash, investment, the owner's 2026-08-01 rule) are not emitted at all: a
 * settlement series converted to a reserve would ADD money to Fixed for a flow
 * the owner ruled out of Fixed in words. A loan-payment series is a debt, not a
 * sinking fund — never offered the lever either.
 *
 * THE FIGURE. "Move this much to reserves this month" is `reserveMonthlyCents`,
 * the SAME reduce the plan runs (`plan.ts:933`) over the SAME `resolveReserves`
 * resolution, so the settings card's headline and the plan's Fixed term cannot
 * disagree. The holding account is a NAME the reader gives the money's home —
 * never a transfer the app executes (see DECISIONS #431).
 */
import {
  resolveReserves,
  type ReserveDeclaration,
  type ReserveLine,
  type RefusedReserve,
  type ReserveCadence,
} from '@/lib/engine/spending-plan/reserves';
import {
  monthlyRateCents,
  PLAN_FIXED_NEVER_CATEGORY_IDS,
  recurringOutsideFixedCategoryRows,
  recurringPlanExpenseRows,
  type PlanScheduledItem,
} from '@/lib/engine/spending-plan/plan';
import { billRenameKey } from '@/lib/engine/spending-plan/bill-rename';

/**
 * The rhythms a detected bill may be turned into a reserve on.
 *
 * DELIBERATELY NARROWER than `RESERVE_CADENCES` (which admits MONTHLY, because a
 * reader may declare a monthly reserve by hand — taxes, say). A MONTHLY SERIES
 * is a bill that leaves every month; converting it to a reserve changes its
 * label and nothing else, so the lever is not offered. The three divided
 * rhythms are exactly the owner's case: the money comes due once a quarter,
 * twice a year, or once a year, and the reader sets it aside monthly so the
 * cash is there.
 */
export const RESERVE_CONVERTIBLE_CADENCES = ['QUARTERLY', 'SEMIANNUAL', 'ANNUAL'] as const;

export function convertibleReserveCadence(cadence: string | null): cadence is ReserveCadence {
  return (RESERVE_CONVERTIBLE_CADENCES as readonly string[]).includes(cadence ?? '');
}

/**
 * Why a detected series is NOT in the Fixed figure — the union's own reasons,
 * named rather than collapsed into "not fixed" (a zero is a claim and must
 * name which zero; an ABSENT line is the same failure one axis over).
 */
export type SeriesRefusalReason = 'discretionary' | 'covered' | 'budget-priced';

export interface SetupBillProposal {
  /** The union's OWN row key (`canonical#index`), so the proposal can be
   *  cross-referenced against the very line it stands beside. Never shown. */
  key: string;
  /** Overlay / convert identity (`billRenameKey`). Payee bills equal merchantCanonical; unnamed bills are `unnamed:${category}:${cadence}`. */
  billKey: string;
  merchantCanonical: string | null;
  categoryId: string | null;
  cadence: string | null;
  /** The series' per-period charge (positive cents). */
  typicalAmountCents: number;
  /** What the series contributes to Fixed today, smoothed — the SAME figure the
   *  union counted. */
  monthlyRateCents: number;
  loanPayment: boolean;
  /** TRUE = the union emitted a row for this series: its money is in the Fixed
   *  figure already. */
  inBasis: boolean;
  /** Why an out-of-basis series is out. null when `inBasis`. */
  refusedReason: SeriesRefusalReason | null;
  /** Whether the "turn this into a monthly reserve" lever is offered. */
  convertibleToReserve: boolean;
  /** What the lever would declare — the prefill, derived from the series. null
   *  when not convertible. The NAME is the overlay (unnamed) or the canonical; the action re-validates
   *  it against the reserve form's own limits before writing. */
  convertInput: { name: string; trueCostCents: number; cadence: ReserveCadence } | null;
}

export interface FixedSetupProposal {
  /** One proposal per counted expense series — the loader's array, 1:1. */
  bills: SetupBillProposal[];
  /** The reader's declared reserves, resolved exactly as the plan resolves
   *  them (`resolveReserves` — refusals ride along, never swallowed). */
  reserves: ReserveLine[];
  refusedReserves: RefusedReserve[];
  /** The "move this much to reserves this month" figure — the plan's own
   *  arithmetic (`reserveMonthlyCents`), derived here from the same lines. */
  reserveMonthlyCents: number;
}

export interface FixedSetupInput {
  /** The counted expense series — the loader's array, identical to the one the
   *  union consumed. Negative `amountCents` for expenses. */
  items: readonly PlanScheduledItem[];
  /** The union's own category test (`suggestedCategoryIsFixed` in the server),
   *  passed through UNCHANGED so inBasis is the union's verdict exactly. */
  categoryIsFixed: (categoryId: string) => boolean | null;
  /** Rollup contributor ids — the union's `categoryFixedCoveredIds`. */
  rollupCategoryIds?: ReadonlySet<string>;
  /** Categories the reader priced with a budget — the union's `budgetCategoryIds`. */
  budgetCategoryIds?: ReadonlySet<string>;
  /** The plan's OWN basis verdict (`suggestedFixedBasis`), threaded through so
   *  the inBasis oracle is the one the plan summed (critic P1-2). Absent =
   *  the union, the pre-basis behaviour. */
  planFixedBasis?: string | null;
  /** The reader's stored reserve declarations (unvalidated — validation is
   *  `resolveReserves`' job, exactly as in the plan). */
  reserves?: readonly ReserveDeclaration[];
  /** Household BillRename overlays. An unnamed bill is convertible only with a non-empty overlay — a reserve needs a name they recognize. */
  billNames?: ReadonlyMap<string, string>;
}

/**
 * Build the Fixed-costs setup proposal: every counted expense series marked
 * with its basis verdict, plus the resolved reserves and the monthly figure.
 *
 * Total over the inputs the callers actually share: every item the union could
 * have emitted is emitted with a verdict; income and settlement rows are the
 * two the loader's own contract excludes from being proposed at all (documented
 * below), and every reserve declaration leaves as a line or a refusal.
 */
export function proposeFixedSetup(input: FixedSetupInput): FixedSetupProposal {
  const { items, categoryIsFixed, rollupCategoryIds = new Set<string>(), budgetCategoryIds } = input;

  // THE ORACLE THE PLAN ITSELF SUMMED, RAN ONCE — the verdict for every series
  // is read off its rows by key, so "proposed" and "counted" are one
  // computation. The union is the oracle for the two bases that ADD it; the
  // last-resort basis counts every non-settlement series directly, so the
  // oracle switches with the basis (critic P1-2): a `detected-series` plan
  // would otherwise render a series it COUNTS as "not in your fixed costs"
  // with a lever whose advertised delta is zero.
  const union = recurringOutsideFixedCategoryRows(items, categoryIsFixed, rollupCategoryIds, budgetCategoryIds);
  const inBasisKeys =
    input.planFixedBasis === 'detected-series'
      ? new Set(recurringPlanExpenseRows(items).rows.map((r) => r.key))
      : new Set(union.rows.map((r) => r.key));

  const bills: SetupBillProposal[] = [];
  items.forEach((s, index) => {
    // Income: the loader excludes it before the union, so it can never be a
    // proposal here either — defensive, because this module's contract is that
    // it says something true about every item it is handed.
    if (s.amountCents >= 0) return;
    const id = typeof s.categoryId === 'string' && s.categoryId !== '' ? s.categoryId : null;
    // Settlement — never proposed (DECISIONS #431): the owner's 2026-08-01 rule
    // is that these are never a Plan Fixed cost class, and a conversion lever
    // on one would add money to Fixed for a flow he ruled out in words.
    if (id !== null && PLAN_FIXED_NEVER_CATEGORY_IDS.has(id)) return;

    const key =
      typeof s.merchantCanonical === 'string' && s.merchantCanonical !== ''
        ? `${s.merchantCanonical}#${index}`
        : `series-${index}`;
    const inBasis = inBasisKeys.has(key);
    const typicalAmountCents = -s.amountCents;
    const monthlyRateCentsValue = monthlyRateCents(typicalAmountCents, s.cadence);

    let refusedReason: SeriesRefusalReason | null = null;
    if (!inBasis) {
      if (s.loanPayment === true) {
        // The union's only loan skip is the reader's own budget price.
        refusedReason = 'budget-priced';
      } else if (id !== null && rollupCategoryIds.has(id)) {
        // Covered = the money IS in the figure under the category. Checked
        // BEFORE the taxonomy test on purpose: a detected series' own rows
        // classify fixed via `fixedMerchants` whatever the taxonomy, so a
        // taxonomy-discretionary category holding one is covered, not out.
        refusedReason = 'covered';
      } else if (id !== null && categoryIsFixed(id) === false) {
        // No rollup mass AND taxonomy-discretionary: the rows are not
        // fixed-classified (the reader flipped them, or the series is fresh
        // and un-stored) — the money is genuinely outside the figure. The one
        // absent case where the convert lever ADDS money, exactly.
        refusedReason = 'discretionary';
      } else {
        // Uncovered fixed or null categories are kept by the union, so
        // `inBasis` would be true — this arm is unreachable; total anyway.
        refusedReason = 'covered';
      }
    }

    // The lever needs something to NAME: a series with no canonical cannot
    // become a reserve unless the household typed a BillRename overlay (the
    // reserve form requires a name they recognize — never "A recurring bill we
    // detected" or the category). And it is offered only where the swap is
    // EXACT: in the basis (the union row is the whole contribution, −rate +
    // rate = 0) or genuinely out (no rollup mass, so the demote changes
    // nothing — +rate). A covered series would double-count.
    // A monthly share that rounds to $0 (critic P2-2) is a DEAD lever: a
    // $0.00/mo reserve counts nothing and the write refuses it as "less than a
    // cent a month" — a button that renders and then refuses is a lie in the
    // other direction, so the loader never offers it.
    const billKey = billRenameKey({
      merchantCanonical: s.merchantCanonical,
      categoryId: id,
      cadence: s.cadence,
    });
    const overlay = input.billNames?.get(billKey)?.trim() ?? '';
    const canonicalName = typeof s.merchantCanonical === 'string' ? s.merchantCanonical.trim() : '';
    const hasName = canonicalName !== '' || overlay !== '';
    const convertible =
      convertibleReserveCadence(s.cadence) &&
      s.loanPayment !== true &&
      hasName &&
      monthlyRateCentsValue > 0 &&
      (inBasis || refusedReason === 'discretionary');
    bills.push({
      key,
      billKey,
      // The union's contract types an absent canonical as `undefined`; the
      // proposal normalizes to null so "no payee" is one value for consumers.
      merchantCanonical: s.merchantCanonical ?? null,
      categoryId: id,
      cadence: s.cadence,
      typicalAmountCents,
      monthlyRateCents: monthlyRateCentsValue,
      loanPayment: s.loanPayment === true,
      inBasis,
      refusedReason,
      convertibleToReserve: convertible,
      convertInput: convertible
        ? {
            name: overlay || canonicalName,
            trueCostCents: typicalAmountCents,
            cadence: s.cadence as ReserveCadence,
          }
        : null,
    });
  });

  const resolved = resolveReserves(input.reserves ?? []);
  return {
    bills,
    reserves: resolved.lines,
    refusedReserves: resolved.refused,
    reserveMonthlyCents: resolved.monthlyTotalCents,
  };
}

/** The one sentence a surface prints beside the "move this much to reserves"
 *  figure when the reader has named a holding account. Authored once, so the
 *  sentence and the figure's source cannot drift (the L.30 shape). Returns ''
 *  when the account is unnamed — a surface appends only what is true.
 *
 *  "set aside in" on purpose: the app never moves money for the reader (there
 *  is no transfer write anywhere in the reserve path). The account is the
 *  reader's own statement of where the set-aside lives, and the sentence must
 *  not read as though the app executed a transfer. */
export function holdingAccountClause(accountLabel: string | null): string {
  if (!accountLabel) return '';
  return ` — set aside in ${accountLabel}`;
}
