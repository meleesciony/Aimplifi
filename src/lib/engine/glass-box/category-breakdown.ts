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
import { type Cents, cents, sumCents } from '@/lib/money';
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import {
  isSpendRow,
  spendContributionCents,
  spendRowCategoryId,
  type ReportTxn,
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
 */
export const BREAKDOWN_BASIS =
  'These are the rows the figure counts. Pending charges are included; income, transfers ' +
  'between your own accounts, the container row left by a split, and anything you marked ' +
  'as not your spending are left out.';

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
 * `month` is a single "YYYY-MM": all four call sites sum whole calendar months
 * (`spendingByCategory` windows by month key, and /trends' movers window on
 * `comparedYm`). A wider window would need the caller to say which one, so the
 * narrow signature is the fence.
 */
export function buildCategoryBreakdowns(
  txns: readonly BreakdownSourceTxn[],
  month: string,
  headlines: ReadonlyMap<string, number>,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
): Record<string, CategoryBreakdown> {
  const range = { fromYm: month, toYm: month };
  const wanted = new Set(headlines.keys());
  const collected = new Map<string, BreakdownRow[]>();

  for (const t of txns) {
    // The predicate, not a copy of it. Any change to what counts as spending
    // moves the figures and these rows in the same commit.
    if (!isSpendRow(t, range, meta)) continue;
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
    });
    collected.set(categoryId, rows);
  }

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
    };
  }
  return out;
}
