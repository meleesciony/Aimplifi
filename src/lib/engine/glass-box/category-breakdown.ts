/**
 * Category breakdowns — "tap a category row, see the transactions the app filed
 * into it" (owner request, 2026-07-31: *"make rows expandable so I can see what
 * exactly system is classifying spending as. Not just the stuff in the photo but
 * every table."*).
 *
 * This is the Glass-Box rule (`glass-box/trace.ts`) applied one level down. That
 * module explains a HEADLINE by reshaping the engine result behind it; this one
 * explains a TABLE ROW by naming the individual transactions that were summed
 * into it. The cardinal rule is the same and it is the only thing that makes the
 * panel worth trusting:
 *
 *   **A breakdown never re-queries and never re-derives. It is built from the
 *   very array the surface summed, through the very predicate the surface
 *   summed with.**
 *
 * Concretely: `spendingByCategory` selects rows with `isSpendRow` and adds
 * `spendContributionCents`. So does this. Those two functions are exported from
 * the reports engine for exactly this purpose ("exported so the Glass-Box trace
 * selects contributing rows with the SAME predicate the breakdown summed — by
 * construction, never a re-derivation that can drift"). Every caller here hands
 * over the same `txns` array it handed the figure builder, so there is no second
 * query whose `where` clause could drift from the first — the failure mode
 * `a-link-on-a-figure-asserts-two-engines-agree` and `one-question-one-basis`
 * were both written about.
 *
 * `reconciles` is therefore a real check rather than a decoration: the caller
 * passes the figure it RENDERS, and if the rows this module selected do not sum
 * to it, the panel says so instead of quietly showing a different set. There is
 * no parallel derivation that could make it false on a correct number, which is
 * the guard `trace.ts` documents at length.
 *
 * Pure: no I/O, no Date, integer cents only.
 */
import { type Cents, cents, formatCents, sumCents } from '@/lib/money';
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import {
  isSpendRow,
  spendContributionCents,
  spendRowCategoryId,
  type ReportTxn,
  type SpendWindow,
} from '@/lib/engine/reports/reports';

/**
 * A source row, as the surfaces already hold it.
 *
 * Everything past `ReportTxn` is display material and every field is optional,
 * because the three call sites hold different shapes of the same row: /budgets
 * queries Prisma directly with its own `select`, /reports passes the finance
 * snapshot's rows, and /trends passes the `TrendTxn[]` its movers were summed
 * from. Optional means a caller that cannot supply a field degrades to a less
 * specific LABEL — never to a wrong figure, since none of these fields touches
 * the arithmetic.
 *
 * (An earlier version of this comment said "four call sites", named a dashboard
 * one that does not exist, and described /trends as passing the shape it is in
 * fact the only caller NOT to pass — in the file whose whole thesis is about not
 * deriving the same rows twice. A critic caught all three.)
 */
export interface BreakdownSourceTxn extends ReportTxn {
  /** Database id, when the caller has one — the row's link to its detail page. */
  id?: string | null;
  /** The bank's own text. What the categorizer actually read. */
  rawDescriptor?: string | null;
  /**
   * The display name the register shows for this row. Callers pass
   * `merchant?.canonical ?? normalizeMerchant(rawDescriptor).canonical`, which is
   * the register's own rule — a reader who renamed a payee with a rule (O.13a
   * `renameTo` writes `Merchant.canonical`) must meet their own name here too,
   * not the normalizer's guess at the bank text.
   */
  merchantName?: string | null;
  /** 'PENDING' | 'POSTED'. Pending rows are IN these figures; the row says so. */
  status?: string | null;
}

/** One transaction inside a category, as the panel prints it. */
export interface BreakdownRow {
  /** Stable within a breakdown; a React key that needs no database id. */
  key: string;
  /** Present iff the caller had one — the row's link to `/transactions/<id>`. */
  transactionId: string | null;
  date: string;
  /** Payee as the register names it; falls back to the bank text, then a dash. */
  label: string;
  /**
   * The bank's own descriptor, present ONLY when it differs from `label`.
   *
   * This is the field the owner's question is really about: a reader auditing
   * "why is this in Groceries" is asking what the classifier read, and the
   * cleaned-up payee name is precisely the thing that hides it. Omitted when it
   * adds nothing, so the panel does not print every row twice.
   */
  rawDescriptor: string | null;
  /**
   * This row's contribution to the category figure, oriented as SPEND: a
   * purchase is positive, a refund is negative. That is `spendContributionCents`
   * verbatim (`-amountCents`), so the rows sum to the positive figure the table
   * prints rather than to its negation.
   */
  amountCents: Cents;
  isPending: boolean;
  /**
   * This row is dated on a day one of the reader's combined accounts changed
   * connections — a day the boundary releases to BOTH sides (DECISIONS #454), so
   * a charge both connections reported is listed twice here and counted twice in
   * the figure above.
   *
   * A fact about the row's DATE, never a claim about the row: it says this row
   * sits on a released day, not that it is a duplicate. The boundary's own dates
   * are the only honest detector, which is why they are passed in rather than
   * inferred — `buildTaxExport` records the same reasoning, and guessing from the
   * rows (two equal amounts on one date) cannot tell a real pair of identical
   * charges from a handover duplicate.
   *
   * False for every reader with no combined accounts, which is the default.
   */
  onHandoverDay: boolean;
}

export interface CategoryBreakdown {
  categoryId: string;
  /** The figure the SURFACE renders — passed in, never recomputed here. */
  headlineCents: Cents;
  /** Every contributing row, in date order (oldest first), no cap. */
  rows: BreakdownRow[];
  /** Plain sum of `rows[].amountCents`. */
  sumCents: Cents;
  /** True iff `sumCents === headlineCents` exactly. */
  reconciles: boolean;
  /**
   * The rows net to a REFUND and the figure above is being held at zero.
   *
   * Both figure builders clamp this case by design — `spendingByCategory` drops
   * a category whose net is `<= 0`, and `netSpendByCategory` keeps "only
   * categories whose net is an outflow" — so a month where a return exceeded the
   * month's purchases prints `$0.00` rather than a negative spend. Those rows
   * genuinely do not sum to the figure, so `reconciles` is false and stays
   * false; this flag exists so the panel can name the reason instead of
   * reporting a defect. It can only surface on a category the surface prints
   * anyway, which today means /budgets showing a category that has a target and
   * no net spend.
   */
  clampedByNetRefund: boolean;
  /**
   * Money in this category, inside this window, that the figure does NOT count
   * because it is dated after the window's `asOf` (C.26). Zero on an unclamped
   * window, and zero on a clamped one with nothing dated ahead — which is every
   * reader who has never entered or imported a future-dated row.
   *
   * It is computed HERE, from the same pass that collects the rows, for the
   * reason `BREAKDOWN_BASIS` is printed unconditionally: a disclosure a call
   * site has to remember is one a call site can forget. Every panel on every
   * surface inherits it, and it is a FACT (an amount actually dropped), not a
   * restatement of configuration — a sentence that fires on the clamp's mere
   * existence would nag every reader about a rule that never touched their
   * money (the `dataDerived` gate, C.11/#407).
   */
  notCountedYetCents: Cents;
  /**
   * How many of `rows` fall on a released handover day (U.16).
   *
   * Counted from the rows this panel actually LISTS, so the sentence it drives
   * can never describe money that is not on screen — the same discipline
   * `cardDuplicateTraceBasis` follows when it resolves its pairs against the
   * displayed rows rather than against the whole account set.
   *
   * Zero for every reader with no combined accounts, and zero on a category
   * whose rows all fall elsewhere, so the sentence is `dataDerived` in the
   * C.11/#407 sense: it fires on rows that exist, never on the mere existence of
   * a combined pair.
   */
  countedOnHandoverDays: number;
}

/**
 * What every one of these panels includes and excludes, in one sentence.
 *
 * It lives here, beside the predicate it describes, and the panel component
 * prints it unconditionally rather than taking it from a caller — a disclosure
 * a call site has to remember is one a call site can forget (the defaulted-
 * disclosure lesson in `a-disclosure-written-for-a-page-is-false-in-an-email`).
 * One sentence serves all three surfaces because all three select rows with
 * `isSpendRow`; it deliberately names no month, because the surfaces window
 * differently (/trends' movers describe the last COMPLETE month) and each
 * already prints its own — the two sentences that DO need a window take it as a
 * required argument instead (`breakdownEmptyCopy`, `breakdownNetRefundCopy`).
 *
 * Each clause is a clause of `isSpendRow`, and the enumeration is COMPLETE
 * against it — a critic counted the first draft at three of five. That predicate
 * drops split parents, transfers, reader-excluded rows, the `transfer` category
 * id, and the whole Income GROUP; the last two are the ones the first draft
 * missed, and they are not academic: /budgets' own comment records an executed
 * case where a `paycheck −$500` clawback used to render as $500 of budget spend.
 * A reader auditing a missing outflow needs a clause that covers it
 * (`closing-a-gap-shrinks-the-disclosure-that-described-it`). "Income" covers
 * both, since the `transfer` category is named by the transfers clause already.
 *
 * The ACCOUNT-level narrowings upstream of it (non-USD, non-spending account
 * types, reconciliation predecessors) are deliberately not listed: they shape
 * the figure too, so "these are the rows the figure counts" stays true, and each
 * has its own disclosure on the surfaces where it applies.
 *
 * U.13 CAVEAT, ANSWERED BY U.16 (DECISIONS #455) rather than left implied: the
 * boundary releases the single handover day to BOTH sides (DECISIONS #454), so a
 * charge both connections reported is counted twice on that one date. The
 * sentence below stays TRUE — both rows are counted, and this panel does list
 * both — and that is exactly why silence was not acceptable: a reader auditing
 * the figure sees two identical lines and the panel's `reconciles` tick affirms
 * them. `breakdownHandoverDayCopy` is the answer, on the same pattern
 * `cardDuplicateTraceBasis` (trace.ts) uses for card payments, fed by the
 * released dates the tax export already receives.
 *
 * It stays a SEPARATE sentence rather than a clause of this constant, for the
 * reason `breakdownNotCountedYetCopy` gives above: this constant is
 * unconditional and the handover fact is not. A reader with no combined accounts
 * must not be told about a rule that never touched their money.
 */
export const BREAKDOWN_BASIS =
  'These are the rows the figure counts. Pending charges are included; income, transfers ' +
  'between your own accounts, the container row left by a split, and anything you marked ' +
  'as not your spending are left out.';

/**
 * The clamp's own sentence (C.26), printed only when the clamp actually held
 * money back — `notCountedYetCents > 0`, a fact about this reader's rows.
 *
 * `BREAKDOWN_BASIS` above enumerates what the figure leaves out and claims to be
 * COMPLETE against `isSpendRow`. C.26 gave that predicate a sixth clause, so on
 * a clamped surface the enumeration stopped being complete — a disclosure that
 * sounds exhaustive and is not is worse than a shorter one
 * (`closing-a-gap-shrinks-the-disclosure-that-described-it`). It is a separate
 * sentence rather than a longer constant because the clause is conditional and
 * the constant is not: /budgets counts those rows, so on /budgets the clause
 * would be false, and every reader without a future-dated row would be told
 * about a rule that never touched their money.
 *
 * It says "not yet" rather than "excluded": the money has not left, and the row
 * will count itself on the day it is dated. Nothing here tells the reader they
 * did anything wrong — dating a charge ahead is how the register is meant to be
 * used.
 */
export function breakdownNotCountedYetCopy(amount: string, noun: 'spending' | 'income' = 'spending'): string {
  return `${amount} here is dated after today and isn't counted yet — this figure covers ${noun} through today.`;
}

/**
 * The handover-day sentence (U.16), printed only when this panel actually LISTS
 * rows on a released day — `countedOnHandoverDays > 0`, a fact about this
 * reader's rows, never about the mere existence of a combined pair.
 *
 * Three things it deliberately does NOT say, each one a false claim this repo
 * has already paid for once:
 *
 *  1. It does not say the rows ARE duplicated. The boundary releases the day to
 *     both sides; whether both connections reported a given charge is not
 *     knowable from the dates, and `buildTaxExport` records why guessing from
 *     the rows cannot settle it. So the doubling is stated as a conditional.
 *  2. It does not say "twice". A chain whose links share one cutover releases
 *     the date at every generation — U.13 measured one $999.99 charge at
 *     $3,999.96 — and EDGE_CASES records "the only date that may be counted
 *     twice" as a sentence that was simply false. "Once for each" is true at
 *     every multiplicity, including the ordinary two.
 *  3. It does not assert a CAUSE for the date. "That's the day one connection
 *     stopped" AND "changing connections" are both false whenever the reader
 *     drags the cutover past last-used, and false by sixteen months for a
 *     dormant feed (U.17 critic P1). The locator states the RULE — both
 *     connections' records are kept — and the reason U.13 proved holds in
 *     every shape: neither can be shown to have covered the whole of it.
 *
 * `reconciles` is a required argument rather than a default because the clause
 * it gates is the entire reason U.16 exists: the reader opened this panel to
 * AUDIT a figure, the rows tally to the penny, and that tally reads as
 * CONFIRMATION that both lines belong. Saying so is only honest while the tally
 * actually holds — on a panel already reporting a mismatch, "these still add up"
 * would be the false sentence. Same reasoning, and same wording, as the trace's
 * card-duplicate note: the check is on this app's internal consistency, not on
 * whether the world has two charges.
 */
/** Locator every long handover sentence shares (U.17). The RULE, never a cause. */
export const HANDOVER_DAY_LOCATOR =
  'on a day both connections’ records are kept, because neither can be shown to have covered the whole of it';

/** Per-row marker. Same rule, no cause — a short label cannot carry the "neither" clause. */
export const HANDOVER_DAY_ROW_MARKER = '(both connections kept)';

/** Detail-page heading. Matches the marker's claim. */
export const HANDOVER_DAY_HEADING = 'Both connections kept';

export function breakdownHandoverDayCopy(count: number, statesATally: boolean): string {
  const subject = count === 1 ? '1 row here falls' : `${count} rows here fall`;
  const tally = statesATally
    ? ' The rows in this panel still add up to the figure above, and that check is about this app’s arithmetic — it cannot tell whether two lines are one transaction.'
    : '';
  return (
    `${subject} ${HANDOVER_DAY_LOCATOR} — so if more than one of them reported the same transaction, it is counted ` +
    `once for each — which makes this figure too high when they are purchases, and ` +
    `too LOW when they are returns.${tally} Nothing has been adjusted: dropping either side’s ` +
    `records would lose transactions only one connection saw.`
  );
}

/**
 * The handover-day sentence for a surface with NO row list (U.16) — Ask's spend
 * answers, and the /reports page total.
 *
 * A separate author from `breakdownHandoverDayCopy` for the reason
 * `cardDuplicateAnswerNote` is separate from `cardDuplicateTraceBasis`: the panel
 * sentence says "N rows HERE", points at marked lines, and reassures about a
 * penny-match the reader can see. None of that is true in an answer that prints
 * one figure and nothing else. Saying "rows here" where there are no rows is the
 * `a-disclosure-written-for-a-page-is-false-in-an-email` failure exactly — a
 * qualifying sentence carries an implicit claim about where the reader is
 * standing.
 *
 * So this one names the FIGURE instead of the rows, and points at the surface
 * that can actually show them. It states no tally, because there is none on
 * screen to state.
 */
export function handoverDayAnswerNote(count: number): string {
  const subject =
    count === 1 ? '1 transaction in this figure falls' : `${count} transactions in this figure fall`;
  return (
    `${subject} ${HANDOVER_DAY_LOCATOR} — so if more than one of them reported the same transaction, it is counted ` +
    `once for each — which makes this figure too high when they are purchases, and ` +
    `too LOW when they are returns. Nothing has been adjusted — dropping either side’s records ` +
    `would lose transactions only one connection saw.`
  );
}

/**
 * The handover-day sentence for the register's totals strip (U.20) — the fourth
 * surface shape, and a fourth author for the same reason the second and third
 * exist: each sibling carries an implicit claim about what is on screen, and
 * every one of those claims is false on the register.
 *
 *  - Not `breakdownHandoverDayCopy`: its direction clause names "this figure",
 *    singular, and the register prints THREE (Money in / Money out / Net). A
 *    duplicated purchase and a duplicated return also move DIFFERENT tiles here,
 *    so "too high / too LOW" about one figure would be wrong about two of them.
 *  - Not `handoverDayAnswerNote`: "in this figure" fails the same way, and the
 *    register DOES list the rows — the answer author exists precisely for
 *    surfaces that cannot show them.
 *
 * The count is the rows the money tiles are actually summed from
 * (`TxnSummary.countedOnHandoverDays` — after the transfer and excluded-row
 * gates), NOT the rows the list marks: a released-day transfer is marked in the
 * list (the marker is a fact about its date) but moves no total, and a sentence
 * about the totals must count only what the totals count.
 *
 * The destination clause names no tile (critic cycle: P2-4). The first draft
 * enumerated "in Money out when they are purchases, in Money in when they are
 * returns" — and the register is the one surface that also counts INCOME, so a
 * paycheck both feeds reported doubled Money in while being neither. An
 * enumeration that reads as exhaustive and is not is the exact defect the
 * caption this rides on was amended to fix. "Whichever of these totals its
 * amount feeds" is exhaustive by construction.
 */
export function handoverDayRegisterTotalsNote(count: number): string {
  const subject =
    count === 1 ? '1 row counted in these totals falls' : `${count} rows counted in these totals fall`;
  return (
    `${subject} ${HANDOVER_DAY_LOCATOR} — so if more than one of them reported the same transaction, it is listed ` +
    `and counted once for each, in whichever of these totals its amount feeds. Nothing has ` +
    `been adjusted — dropping either side’s records would lose transactions only one ` +
    `connection saw.`
  );
}

/**
 * The handover-day sentence for the merchant answer's NEGATIVE-NET branches
 * (critic cycle: both critics, independently) — "No purchases at X" with a
 * refunds figure, and "Refunds exceeded purchases by $Y".
 *
 * `handoverDayAnswerNote`'s direction clause is INVERTED here, executed: two
 * copies of one $50.00 return rendered "$100.00 came back in refunds" — a
 * figure the doubling made too HIGH — under a clause saying returns make "this
 * figure too LOW". The figures these branches print are gross magnitudes
 * (spent / returned), which a doubled row can only inflate, while the
 * exceedance headline is a net a doubled purchase DEFLATES — one direction
 * claim cannot cover them, so this author makes none. Same resolution as the
 * register's fourth author: when the surface prints figures a doubling moves
 * in different directions, the sentence states the counting rule and stops.
 */
export function handoverDayAmountsNote(count: number): string {
  const subject =
    count === 1 ? '1 transaction behind these amounts falls' : `${count} transactions behind these amounts fall`;
  return (
    `${subject} ${HANDOVER_DAY_LOCATOR} — so if more than one of them reported the same transaction, these ` +
    `amounts count it once for each. Nothing has been adjusted — dropping either side’s ` +
    `records would lose transactions only one connection saw.`
  );
}

/**
 * The handover-day sentence for the transaction DETAIL page (critic cycle:
 * P2-5) — one transaction, no count, no figure.
 *
 * The register pairs its markers with the caption sentence and the panels pair
 * theirs with the basis copy; the detail page is reachable by deep link or
 * refresh, where "the register row this page was reached from" is an assumption
 * about where the reader is standing that does not hold. So the marker's
 * explanation must live ON this page, scoped to the one row it shows: this row
 * is dated on a released day and MAY have a twin — never that it does.
 */
export function handoverDayDetailNote(): string {
  return (
    `This transaction is dated ${HANDOVER_DAY_LOCATOR} — so if both reported this transaction, it appears ` +
    `once for each in your activity and totals. Nothing has been adjusted — dropping either ` +
    `side’s records would lose transactions only one connection saw.`
  );
}

/**
 * The handover-day sentence for released rows a spending figure DROPPED (U.21,
 * rescoped in the critic cycle) — the rows `uncountedOnHandoverDays` records: a
 * doubled return drives a category's net to <= 0, `spendingByCategory` drops
 * it, and whatever figure the page then states — "No spending recorded" OR a
 * positive total summed from the surviving categories — cannot show these rows.
 *
 * The first draft confined this to the ZERO branches, and the money critic
 * executed the miss: dining $50.00 surviving plus groceries dropped by a
 * doubled return rendered "You spent $50.00 on Food & Dining this month." with
 * no note, while the engine's own record held the dropped rows. A doubled
 * return that only PARTIALLY cancels a breakdown is strictly more reachable
 * than one that empties it, and it understates a printed figure — the failure
 * direction this repo names as the one that costs money. So this sentence now
 * prints wherever the scoped uncounted set is non-empty, beside zero and
 * positive figures alike.
 *
 * That rescope is why the wording is REFERENT-FREE (claims critic, P2-1): the
 * first draft said "This figure leaves out…", which had no referent under
 * Ask's "No spending recorded" (no figure is printed there) and a wrong one
 * beside a positive total. "Spending figures leave out any category that lands
 * there" is true in every standing this sentence can occupy.
 *
 * A third author rather than a parameter on the two above: both siblings open
 * by locating the rows INSIDE the figure ("N rows here", "N transactions in
 * this figure"), and these rows are precisely what the figure does not contain.
 *
 * The causal chain is stated in full because no other surface states it, and
 * every link is a rule this engine actually applies:
 *
 *  1. The release keeps both connections' rows for the day (U.13) — same clause
 *     as its siblings, the only claim about the CAUSE that survives a dragged
 *     cutover and a dormant feed (U.17).
 *  2. A duplicated RETURN subtracts once for each copy. The only direction that
 *     can DROP a category: doubling a purchase raises a net.
 *  3. `spendingByCategory` drops any category whose net lands <= 0, so the
 *     category leaves every spending figure — which is why nothing on screen
 *     can show the reader these rows, and why the count is carried here.
 *
 * It claims only that spending MAY be hidden, never that it is. A category can
 * net to zero for entirely ordinary reasons — a refunded purchase is the common
 * case — and the app cannot tell which happened. Asserting the doubling would
 * be the fabrication `buildTaxExport` refuses when it declines to guess from
 * the rows.
 */
export function handoverDayUncountedNote(count: number, label?: string): string {
  const scope = label ? ` in ${label}` : '';
  const subject =
    count === 1 ? `1 transaction${scope} falls` : `${count} transactions${scope} fall`;
  return (
    `${subject} ${HANDOVER_DAY_LOCATOR} — so if more than one of them reported the same return, it is subtracted ` +
    `once for each, which can pull a category to zero or below. Spending figures leave out any ` +
    `category that lands there, so there may be spending they are not showing. Nothing has ` +
    `been adjusted — dropping either side’s records would lose transactions only one ` +
    `connection saw.`
  );
}

/**
 * The PAGE-level statement of what a stop-at-today window held back (C.26
 * critic cycle 1, P1-5).
 *
 * Separate from the panel sentence because it answers at a different scope and
 * in the one situation the panel sentence cannot exist: when the clamp removes
 * everything a category had, that category is dropped by `spendingByCategory`,
 * never reaches `headlines`, and gets no panel to carry a disclosure. So this
 * one is hung on the page total, where an empty table still has somewhere to
 * say it.
 *
 * Says where the money IS ("still on your activity list"), because the reader's
 * next question is whether it was lost. It was not — the register windows on
 * dates the reader chooses and has always shown these rows.
 */
export function reportsNotCountedYetCopy(amount: string): string {
  return (
    `${amount} of this month's spending is dated later than today, so it isn't in these ` +
    `figures yet. It's still on your activity list, and it'll count on the day it's dated.`
  );
}

/**
 * The window label a panel prints, given the money its window held back.
 *
 * "June 2026" is a false label for a figure that stops on the 10th as soon as
 * anything is dated later in the month, and every sentence in both panel
 * families interpolates this one string — the empty sentence, the net-refund
 * sentence, the register link's accessible name. Narrowing the LABEL therefore
 * corrects all of them at once, which is why the fix is here and not a "so far"
 * variant of each sentence (C.26 critic cycle 1, P1-3/P1-4).
 *
 * Gated on the amount, like the sentence itself: with nothing dated ahead the
 * figure really does cover the whole window so far as anything can tell, and
 * "so far" on every past month would be noise.
 */
export function windowLabelSoFar(windowLabel: string, notCountedYetCents: number): string {
  return notCountedYetCents > 0 ? `${windowLabel} so far` : windowLabel;
}

/**
 * The basis sentences a CATEGORY panel prints, composed here rather than in the
 * component (C.26 critic cycle 1, P1-2).
 *
 * The first cycle put this composition in the .tsx, and a critic deleted the
 * whole conditional clause with the entire suite green — there is no
 * component-rendering harness in this repo, so anything assembled in a
 * component is unlockable by construction. Assembling it in the engine makes
 * the rule a pure function with a test, and leaves the component a spread.
 */
export function categoryPanelBasis(
  breakdown: Pick<CategoryBreakdown, 'notCountedYetCents' | 'countedOnHandoverDays' | 'reconciles' | 'rows'>,
  extra: readonly string[] = [],
): [string, ...string[]] {
  return [
    BREAKDOWN_BASIS,
    ...(breakdown.notCountedYetCents > 0
      ? [breakdownNotCountedYetCopy(formatCents(breakdown.notCountedYetCents))]
      : []),
    // U.16. Assembled HERE, not at the call sites, for the reason this function
    // exists at all: a sentence composed in a .tsx is unlockable by construction,
    // and a disclosure a call site has to remember is one a call site can forget.
    // Every surface that opens a category panel inherits it in the same commit.
    ...(breakdown.countedOnHandoverDays > 0
      ? [breakdownHandoverDayCopy(breakdown.countedOnHandoverDays, breakdown.reconciles && breakdown.rows.length > 1)]
      : []),
    ...extra,
  ];
}

/**
 * The two panel sentences that describe a WINDOW, as functions of it.
 *
 * They take the window rather than naming one, and the caller is REQUIRED to
 * supply it, because that is the defect two independent critics found here. The
 * first draft read "…here this month", which is true on /budgets and /reports
 * and FALSE on /trends, whose panels describe `comparedYm` — the last COMPLETE
 * month — directly beneath a Pace card headed with the CURRENT one. It was not
 * hypothetical: on the demo seed the Fuel mover shows $0.00 for May while
 * /budgets prints $68.27 of Fuel for June, so the sentence told a reader the
 * categorizer had filed nothing into a bucket they were actively spending from.
 *
 * A required argument is the fix rather than a better default, per
 * `a-required-argument-makes-a-caller-answer`: the window is a fact about the
 * SURFACE, and only the surface can be asked. `BREAKDOWN_BASIS` solves the same
 * problem the other way — it names no window at all — and that is fine for a
 * sentence that describes the predicate rather than a period.
 *
 * The empty one is a real answer, not an apology: on /trends a category that
 * fell to nothing is the row a reader most wants explained.
 */
export function breakdownEmptyCopy(windowLabel: string): string {
  return `Nothing was filed into this category in ${windowLabel} — there are no transactions behind this figure.`;
}

/**
 * The net-refund clamp, in the reader's words. `sumLabel` is the already-
 * formatted row total (negative), so this module stays free of the currency
 * boundary.
 */
export function breakdownNetRefundCopy(sumLabel: string, windowLabel: string): string {
  return `These rows come to ${sumLabel} — refunds outweighed spending here in ${windowLabel}, so the figure above stays at $0.00 rather than going negative.`;
}

/**
 * A row's display label, resolved once so every surface names a transaction the
 * same way. `merchantName` first (the register's own resolution, including a
 * reader's rename), then the raw bank text, then an explicit placeholder — never
 * an empty string, which would render as a blank line the reader cannot ask
 * about.
 */
function labelFor(t: BreakdownSourceTxn): string {
  const merchant = t.merchantName?.trim();
  if (merchant) return merchant;
  const raw = t.rawDescriptor?.trim();
  if (raw) return raw;
  return 'No description';
}

/**
 * The money a stop-at-today window kept out of a set of figures, per category,
 * and the total across every category — ONE computation with two readers.
 *
 * Counts rows the clamp ALONE excluded: a row dropped for any other reason (a
 * transfer, an excluded flow, the wrong month) is already described by
 * `BREAKDOWN_BASIS`, and re-counting it here would attribute somebody else's
 * exclusion to the date rule.
 *
 * It exists as a shared function because of the defect it replaced (C.26 critic
 * cycle 2, F1). `getReports` computed its page-level figure as
 * `wholeMonthSum − clampedSum`, and `spendingByCategory` floors each category
 * at zero INDEPENDENTLY IN EACH WINDOW — so a category whose later-dated refund
 * exceeded its purchases contributed a floored zero to one sum and a real
 * amount to the other. Executed: groceries $400 dated ahead and dining carrying
 * a later-dated $1,300 refund cancelled exactly, the page fell silent, and the
 * panel directly beneath it still disclosed the $400. A subtraction of two
 * clamped aggregates is not the quantity; the quantity is a sum of rows, and
 * this is where those rows are counted.
 *
 * `totalCents` is the sum of the FLOORED per-category values, and both halves
 * of that matter. Flooring first is what stops the cancellation from simply
 * moving up a level: summing the raw nets would let one category's later-dated
 * refund erase another's later-dated purchase, which is the cycle-2 defect
 * again in a new place (caught here by the lock, having been written that way
 * first). Summing over EVERY category — not only the ones that survive into a
 * surface's `headlines` — is what makes the page figure cover the category the
 * clamp emptied completely, which has no panel to carry a sentence of its own.
 *
 * The figure therefore answers "how much later-dated spending is waiting",
 * treating a later-dated refund as reducing its own category's wait and never
 * anyone else's — which is exactly what each panel says, so the page and its
 * panels cannot contradict each other.
 */
export function notCountedYetByCategory(
  txns: readonly BreakdownSourceTxn[],
  window: SpendWindow,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  excludedFlowIds?: ReadonlySet<string>,
): { byCategory: Map<string, number>; totalCents: number } {
  const raw = new Map<string, number>();
  if (window.asOf) {
    const unclamped: SpendWindow = { fromYm: window.fromYm, toYm: window.toYm };
    for (const t of txns) {
      if (t.date <= window.asOf) continue;
      if (!isSpendRow(t, unclamped, meta, excludedFlowIds)) continue;
      const categoryId = spendRowCategoryId(t);
      raw.set(categoryId, (raw.get(categoryId) ?? 0) + spendContributionCents(t));
    }
  }
  // Each category floored (a later-dated refund is not "money not counted
  // yet"), and the total summed from those FLOORED values — never from the raw
  // nets, which is what let one category's later-dated refund cancel another's
  // later-dated purchase and silence the page (cycle-2 F1). Flooring first is
  // also what makes `totalCents >= ` every panel's figure, so the page and its
  // panels cannot contradict each other in either direction.
  const byCategory = new Map<string, number>();
  let total = 0;
  for (const [id, amount] of raw) {
    const floored = Math.max(0, amount);
    byCategory.set(id, floored);
    total += floored;
  }
  return { byCategory, totalCents: total };
}

/**
 * Build one breakdown per requested category.
 *
 * `headlines` is the map of `categoryId → the figure that surface prints`, and
 * the returned record has an entry for EVERY key in it — including categories
 * with no contributing rows. That case is deliberate and load-bearing: a target
 * set on a category with no spend prints `$0.00`, and the honest panel for it
 * says "no transactions this month", which is an answer. A category whose
 * headline is non-zero and whose rows are empty reconciles to `false`, and the
 * panel prints the mismatch rather than an empty list under a real number —
 * `an-empty-set-is-not-a-fact-about-money`.
 *
 * `window` is the SpendWindow the headline figures were summed over — the same
 * object, not a month key re-expanded here. Before C.26 it was a month key and
 * every call site summed whole calendar months, so the two could not disagree;
 * once /reports began stopping at today, a panel rebuilt from the month key
 * would have listed a future-dated row the figure above it had dropped, and
 * `reconciles` would have gone false on a figure that was right. The rule this
 * signature enforces is the same one the register link enforces: the rows under
 * a number are selected by the number's own window.
 */
export function buildCategoryBreakdowns(
  txns: readonly BreakdownSourceTxn[],
  window: SpendWindow,
  headlines: ReadonlyMap<string, number>,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  // C.25 (#403): the SAME set the category totals were summed with, so the
  // rows a category opens cannot name money the total itself does not show.
  excludedFlowIds?: ReadonlySet<string>,
  // U.16: the days the boundary released to BOTH sides of a combined pair
  // (`getReconciliationHandoverDates`). Passed in rather than inferred, because
  // the boundary's own rule is the only honest detector — see `onHandoverDay`.
  // Defaults to empty, which is the truth for every reader with no combined
  // accounts, so no existing caller changes behaviour by not passing it.
  handoverKeys: ReadonlySet<string> = new Set<string>(),
): Record<string, CategoryBreakdown> {
  const range = window;
  const wanted = new Set(headlines.keys());
  const collected = new Map<string, BreakdownRow[]>();

  for (const t of txns) {
    // The predicate, not a copy of it. Any change to what counts as spending
    // moves the figures and these rows in the same commit.
    if (!isSpendRow(t, range, meta, excludedFlowIds)) continue;
    const categoryId = spendRowCategoryId(t);
    // Pure optimisation, and deliberately unobservable: `out` is built by
    // iterating `headlines` below, so a surplus category collected here would be
    // discarded anyway. A critic deleted this line and every test still passed,
    // which is the correct result for a line that changes no output — noted so
    // the next reader does not go hunting for the assertion that covers it.
    if (!wanted.has(categoryId)) continue;
    const rows = collected.get(categoryId) ?? [];
    const label = labelFor(t);
    const raw = t.rawDescriptor?.trim() ?? '';
    rows.push({
      // Index within the category keeps the key unique without a database id —
      // two identical charges on one day at one payee are a real thing.
      key: `${categoryId}:${rows.length}:${t.date}`,
      transactionId: t.id ?? null,
      date: t.date,
      label,
      rawDescriptor: raw && raw !== label ? raw : null,
      amountCents: cents(spendContributionCents(t)),
      isPending: t.status === 'PENDING',
      onHandoverDay: t.accountId ? handoverKeys.has(handoverKey(t.accountId, t.date)) : false,
    });
    collected.set(categoryId, rows);
  }

  const notYet = notCountedYetByCategory(txns, window, meta, excludedFlowIds);

  const out: Record<string, CategoryBreakdown> = {};
  for (const [categoryId, headline] of headlines) {
    const rows = collected.get(categoryId) ?? [];
    // Oldest first: a reader scanning for "when did this start" reads down the
    // way a statement does. Ties keep collection order, which is the caller's.
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const sum = sumCents(rows.map((r) => r.amountCents));
    out[categoryId] = {
      categoryId,
      headlineCents: cents(headline),
      rows,
      sumCents: sum,
      reconciles: sum === headline,
      clampedByNetRefund: headline === 0 && sum < 0,
      // Counted off the LISTED rows (U.16), so the sentence this drives can
      // never describe money that is not on screen. `rows` has already been
      // through `isSpendRow`, so a transfer or an excluded flow dated on a
      // handover day is not counted here — it is not in the figure either.
      countedOnHandoverDays: rows.reduce((n, r) => (r.onHandoverDay ? n + 1 : n), 0),
      // Floored per category by `notCountedYetByCategory` (a later-dated refund
      // is not "money not counted yet"); the page-level total sums these same
      // floored values, so the two can never disagree — see that function.
      notCountedYetCents: cents(notYet.byCategory.get(categoryId) ?? 0),
    };
  }
  return out;
}
