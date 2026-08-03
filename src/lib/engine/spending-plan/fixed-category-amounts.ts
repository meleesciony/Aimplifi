/**
 * Per-category fixed amounts (Wave B.1 / DECISIONS #377 / #380 / #393;
 * per-transaction classification as of #397, 2026-08-03).
 *
 * A category enters the Fixed rollup when it holds fixed-CLASSIFIED spend
 * (per transaction: the reader's row verdicts and the recurring-bill guess
 * decide row by row, so a mixed category contributes only its fixed share) —
 * amount = Budget.monthCents when set, else typical monthly spend, averaged
 * over the months of the window the category could have been OBSERVED
 * (C.5/#393), not blindly over the window length. A budget target on a
 * suggested-fixed category with no fixed mass still enters (the reader's own
 * number for a committed cost). Sum is the category-rollup for the Plan fixed
 * term whenever totalCents > 0 (always-on).
 */
import { addMonthsClamped, isoDate, monthKey, type ISODate } from '@/lib/dates';
import type { CategoryMeta } from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { countsInFlows, type TxnLike } from '@/lib/engine/fi/insights';
import {
  classifySpendClass,
  suggestedCategoryIsFixed,
} from '@/lib/engine/spending-plan/spend-class';

export type FixedAmountBasis = 'budget-target' | 'typical-spend';

export interface FixedCategoryAmount {
  categoryId: string;
  name: string;
  amountCents: number;
  basis: FixedAmountBasis;
  /** Trailing average before the budget target wins (0 when no history). */
  typicalCents: number;
  /**
   * The divisor behind `typicalCents` (C.5/#393): the number of window months
   * the category could have been observed. Equal to the window length for an
   * established category; smaller for one whose first charge landed mid-window.
   * 0 when there is no typical at all. Surfaces state it beside the figure —
   * "typical" with no window is unauditable (audit P1-8).
   */
  typicalMonths: number;
  budgetCents: number | null;
}

export interface FixedCategoryAmountsResult {
  rows: FixedCategoryAmount[];
  totalCents: number;
  /**
   * True when the reader has set a budget target on any fixed category.
   * Informational for UI — Plan no longer gates on this (#380); the rollup
   * drives whenever totalCents > 0.
   */
  hasReaderInput: boolean;
  windowMonths: number;
}

export interface CategoryTypicalSpend {
  amountCents: number;
  /** The divisor: window months the category could have been observed (≥ 1). */
  months: number;
}

/**
 * ONE window for the Fixed typical basis. The rollup's average, the label, and
 * the union's filed-id resolution must all read the same months (critic cycle
 * 2: three independent `= 3` defaults would let one call site drift and split
 * the dedupe's month set from the rollup's).
 */
export const FIXED_TYPICAL_WINDOW_MONTHS = 3;

/** The last `n` complete month keys before `today`, oldest → newest. */
function lastCompleteMonthKeys(today: ISODate, n: number): string[] {
  const months = Math.max(1, Math.trunc(n));
  const currentMonthStart = addMonthsClamped(isoDate(`${monthKey(today)}-01`), 0);
  const keys: string[] = [];
  for (let k = months; k >= 1; k--) {
    keys.push(monthKey(addMonthsClamped(currentMonthStart, -k)));
  }
  return keys;
}

/**
 * Average monthly outflow per category over the last `windowMonths` complete
 * months before `today`. Only rows that count in flows; positive refunds net.
 *
 * THE DIVISOR (C.5, measured in C.0/#393): months the category could have been
 * OBSERVED — `min(windowMonths, window months ≥ the category's first-ever
 * counted outflow month)` — not the window length blindly and not the months it
 * happened to charge. A category whose first-ever counted charge landed
 * mid-window divides by its own age (a July-start $593/mo bill is $593, not
 * $197.67); a category charging since before the window keeps the full-window
 * divisor, which is what SMOOTHS an established long-cadence bill (a quarterly
 * $1,553 premium is correctly $517.67/mo — dividing by months-with-a-charge
 * would triple it). The NUMERATOR shares the divisor's basis: only window
 * months ≥ the first-outflow month are summed, so a stray refund landing
 * before the category's first charge cannot dilute the average (critic cycle 1,
 * both lenses). Deliberate residual, direction checked: a long-cadence bill
 * whose FIRST charge lands mid-window is over-reserved until history
 * accumulates — Fixed too big makes guilt-free too small, the safe direction —
 * and it self-corrects as months pass.
 *
 * `excludeMerchantCanonicals` (C.24): LOAN-PAYMENT merchants whose series
 * made the Fixed union leave the rollup ENTIRELY — every row, including the
 * months the transfer flag's timing luck left counted. The server derives the
 * set from the union itself (the exactness invariant: excluded ⇔ unioned),
 * so an excluded merchant always re-enters at its series' monthly rate and a
 * merchant detection could not series keeps its previously-counted rows. A
 * partial stay is the trap the exclusion exists to kill: one counted
 * $6,217.07 mortgage month ÷ a 3-month divisor printed "rent $2,072.36"
 * while the union's category-level covered-skip read that fragment as "rent
 * is covered" and starved the series.
 */
export function averageMonthlySpendByCategory(
  transactions: readonly TxnLike[],
  today: ISODate,
  windowMonths: number = FIXED_TYPICAL_WINDOW_MONTHS,
  excludeMerchantCanonicals?: ReadonlySet<string>,
): Map<string, CategoryTypicalSpend> {
  const monthKeys = lastCompleteMonthKeys(today, windowMonths);
  const months = monthKeys.length;
  const monthSet = new Set<string>(monthKeys);
  const lastWindowMonth = monthKeys[monthKeys.length - 1]!;

  // Window rows per category, kept with their month so the numerator can be
  // limited to the observable suffix once the first-outflow month is known.
  const windowRows = new Map<string, { month: string; amountCents: number }[]>();
  // First month (up to the window's end) with a counted OUTFLOW, per category —
  // refunds do not start a category's observation clock.
  const firstOutflowMonth = new Map<string, string>();
  for (const t of transactions) {
    if (!countsInFlows(t)) continue;
    const id = t.categoryId;
    if (!id || id === 'uncategorized') continue;
    // C.24: a structural loan payment's rows leave the rollup entirely — see
    // the docblock. Checked before the first-outflow clock so the merchant
    // cannot start a category's observation either.
    if (
      excludeMerchantCanonicals !== undefined &&
      excludeMerchantCanonicals.has(normalizeMerchant(t.rawDescriptor).canonical)
    ) {
      continue;
    }
    const m = monthKey(t.date);
    if (t.amountCents < 0 && m <= lastWindowMonth) {
      const cur = firstOutflowMonth.get(id);
      if (cur === undefined || m < cur) firstOutflowMonth.set(id, m);
    }
    if (!monthSet.has(m)) continue;
    const rows = windowRows.get(id) ?? [];
    rows.push({ month: m, amountCents: t.amountCents });
    windowRows.set(id, rows);
  }

  const out = new Map<string, CategoryTypicalSpend>();
  for (const [id, rows] of windowRows) {
    const first = firstOutflowMonth.get(id);
    if (first === undefined) continue; // refund-only window: no typical
    const observable = monthKeys.filter((k) => k >= first).length;
    const denom = Math.max(1, Math.min(months, observable));
    const net = rows.reduce((s, r) => (r.month >= first ? s + r.amountCents : s), 0);
    if (net >= 0) continue;
    out.set(id, { amountCents: Math.round(-net / denom), months: denom });
  }
  return out;
}

/**
 * The FILED category per merchant canonical (C.4, measured in C.0/#393): where
 * a merchant's money actually lives in the Fixed rollup, weighted by OUTFLOW
 * CENTS — preferring rows inside the rollup's own window (the last
 * `windowMonths` complete months), falling back to all history — ties broken by
 * the most recent row.
 *
 * WHY: the Fixed union dedupes a detected series against the category rollup by
 * category id, but a series carries the merchant NORMALIZER'S GUESS at the raw
 * descriptor while the rollup keys on the filed id. For any payee the merchant
 * table doesn't know (guess `uncategorized`) whose rows the reader HAS filed,
 * the union re-added money the rollup already counted — measured live at
 * +$296.40/mo (a life-insurance draft and a Zelle house cleaner).
 *
 * Two critic cycles sharpened the rules, each locked:
 * - CENTS in the rollup WINDOW first (all-time row counts let four stale $1
 *   filings out-vote three live $146.40 charges into a category with no current
 *   rollup mass — the double-count reopened one level up);
 * - AGGREGATE canonicals ("Zelle Payment" is one name over many payees)
 *   resolve only when the canonical carries NO unfiled cents on the tested
 *   basis AND a single filed category holds a supermajority
 *   (`AGGREGATE_RESOLVE_MIN_SHARE_BPS`) of its total outflow cents. Cycle 1: a
 *   blanket resolution let a friend's dinner Zelles re-file the unfiled house
 *   cleaner's series (dropping a real draft from Fixed — the dangerous
 *   direction). Cycle 2: a blanket REFUSAL preserved the original double-count
 *   for a reader whose aggregate rows are all filed into one rollup category.
 *   Cycle 3: a bare supermajority still swallowed a MINORITY UNFILED payee —
 *   money in no rollup category, for which the union is the only chance to be
 *   counted — so any unfiled remainder refuses resolution outright. A
 *   fully-filed aggregate behaves as the deliberate filing it is; anything
 *   else keeps the guess, erring toward Fixed-too-big (the safe side);
 * - unfiled rows (`null`/`uncategorized`) never vote FOR a category — a
 *   merchant with no filed row keeps the guess, and a genuinely-unfiled series
 *   is in NO rollup category (the rollup skips uncategorized), so adding it
 *   cannot double-count. Reader-excluded rows do not vote; transfer-flagged
 *   rows DO (the flag removes a row from flow sums, not from what the reader
 *   said the money is).
 */
export const AGGREGATE_RESOLVE_MIN_SHARE_BPS = 9000;

export function filedCategoryByMerchant(
  transactions: readonly TxnLike[],
  today: ISODate,
  windowMonths: number = FIXED_TYPICAL_WINDOW_MONTHS,
): Map<string, string> {
  const monthKeys = lastCompleteMonthKeys(today, windowMonths);
  const windowSet = new Set(monthKeys);
  const tally = new Map<
    string,
    {
      aggregate: boolean;
      totalWindowCents: number;
      totalAllCents: number;
      byId: Map<string, { windowCents: number; allCents: number; last: string }>;
    }
  >();
  for (const t of transactions) {
    if (t.amountCents >= 0) continue;
    if (t.excludeFromTotals) continue;
    const m = normalizeMerchant(t.rawDescriptor);
    const entry =
      tally.get(m.canonical) ??
      {
        aggregate: m.aggregate,
        totalWindowCents: 0,
        totalAllCents: 0,
        byId: new Map<string, { windowCents: number; allCents: number; last: string }>(),
      };
    const cents = -t.amountCents;
    const inWindow = windowSet.has(monthKey(t.date));
    // Every outflow row — filed or not — counts toward the canonical's total,
    // which is the supermajority test's denominator.
    entry.totalAllCents += cents;
    if (inWindow) entry.totalWindowCents += cents;
    tally.set(m.canonical, entry);

    const id = t.categoryId;
    if (!id || id === 'uncategorized') continue;
    const cur = entry.byId.get(id) ?? { windowCents: 0, allCents: 0, last: '' };
    cur.allCents += cents;
    if (inWindow) cur.windowCents += cents;
    if (t.date > cur.last) cur.last = t.date;
    entry.byId.set(id, cur);
  }
  const out = new Map<string, string>();
  for (const [canon, entry] of tally) {
    let bestId: string | null = null;
    let best = { windowCents: 0, allCents: 0, last: '' };
    for (const [id, v] of entry.byId) {
      const better =
        v.windowCents > best.windowCents ||
        (v.windowCents === best.windowCents &&
          (v.allCents > best.allCents ||
            (v.allCents === best.allCents && v.last > best.last)));
      if (bestId === null || better) {
        bestId = id;
        best = v;
      }
    }
    if (bestId === null) continue;
    if (entry.aggregate) {
      // The CANONICAL's window mass picks the basis (window cents when it has
      // any, all-time cents otherwise) — the same branch for the unfiled test
      // and the share, so the two cannot disagree about which rows they count.
      const useWindow = entry.totalWindowCents > 0;
      const total = useWindow ? entry.totalWindowCents : entry.totalAllCents;
      let filedTotal = 0;
      for (const v of entry.byId.values()) {
        filedTotal += useWindow ? v.windowCents : v.allCents;
      }
      const unfiledCents = total - filedTotal;
      const share = total > 0 ? ((useWindow ? best.windowCents : best.allCents) * 10_000) / total : 0;
      if (unfiledCents > 0 || share < AGGREGATE_RESOLVE_MIN_SHARE_BPS) continue;
    }
    out.set(canon, bestId);
  }
  return out;
}

/**
 * The basis clause beside "Plan uses $X" on /budgets (P1-8: "typical" with no
 * method or window is unauditable). ONE author, unit-locked, because the words
 * are a claim about how the money figure was computed.
 *
 * ONE sentence for full and partial windows, and it claims exactly what the
 * code computes: the divisor months are always the LAST `typicalMonths`
 * complete months (the observable suffix of the window), and the numerator
 * sums the same months. An earlier draft said "since its first charge" and the
 * critic cycle falsified it: the observation clock starts at the first COUNTED
 * outflow, while the register can show earlier charges the flow sums exclude
 * (transfer-flagged, pending) — a claim about first charges is not a claim
 * this function can make.
 */
export function fixedAmountBasisClause(
  row: Pick<FixedCategoryAmount, 'basis' | 'typicalMonths'>,
): string {
  if (row.basis === 'budget-target') return ' (your target)';
  if (row.typicalMonths === 1) return ' (typical — average of your last complete month)';
  if (row.typicalMonths > 1) {
    return ` (typical — average of your last ${row.typicalMonths} complete months)`;
  }
  return ' (typical)';
}

export function resolveFixedCategoryAmounts(input: {
  transactions: readonly TxnLike[];
  today: ISODate;
  meta: ReadonlyMap<string, CategoryMeta>;
  /** #397: recurring-bill merchant canonicals — the per-row guess input to
   *  `classifySpendClass` (replaces the #376 category-override map). */
  fixedMerchants: ReadonlySet<string>;
  budgetByCategory: ReadonlyMap<string, number>;
  nameOf: (id: string) => string;
  windowMonths?: number;
  /**
   * C.24: structural loan-payment merchants whose rows leave the typical
   * basis entirely (see `averageMonthlySpendByCategory`). A budget target on
   * the category still wins — that is the reader's own number.
   */
  excludeMerchantCanonicals?: ReadonlySet<string>;
}): FixedCategoryAmountsResult {
  const windowMonths = input.windowMonths ?? FIXED_TYPICAL_WINDOW_MONTHS;
  // #397: the typical basis sums only fixed-CLASSIFIED rows — classification
  // is per transaction, so a mixed category contributes its fixed share and
  // never its discretionary one. The observation clock and divisor logic in
  // averageMonthlySpendByCategory are untouched; the fixed subset's first
  // outflow starts the category's fixed clock.
  const fixedRows = input.transactions.filter(
    (t) => classifySpendClass(t, input.meta, input.fixedMerchants) === 'fixed',
  );
  const typicalByCat = averageMonthlySpendByCategory(
    fixedRows,
    input.today,
    windowMonths,
    input.excludeMerchantCanonicals,
  );

  const ids = new Set<string>([
    ...typicalByCat.keys(),
    ...input.budgetByCategory.keys(),
  ]);

  const rows: FixedCategoryAmount[] = [];
  let hasBudgetOnFixed = false;
  for (const categoryId of ids) {
    const typical = typicalByCat.get(categoryId);
    const typicalCents = typical?.amountCents ?? 0;
    const budgetRaw = input.budgetByCategory.get(categoryId);
    const budgetCents =
      typeof budgetRaw === 'number' && Number.isSafeInteger(budgetRaw) && budgetRaw > 0
        ? budgetRaw
        : null;
    // Fixed-classified mass enters whatever the taxonomy suggests (the ROWS
    // were classified, not the category); a bare budget target enters only on
    // a suggested-fixed category — the reader's own number for a committed
    // cost, never a discretionary category's.
    if (typicalCents <= 0 && !(budgetCents != null && suggestedCategoryIsFixed(categoryId, input.meta) === true)) {
      continue;
    }
    if (budgetCents != null) hasBudgetOnFixed = true;

    const amountCents = budgetCents ?? typicalCents;

    rows.push({
      categoryId,
      name: input.nameOf(categoryId),
      amountCents,
      basis: budgetCents != null ? 'budget-target' : 'typical-spend',
      typicalCents,
      typicalMonths: typical?.months ?? 0,
      budgetCents,
    });
  }

  rows.sort(
    (a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name),
  );
  const totalCents = rows.reduce((s, r) => s + r.amountCents, 0);
  return {
    rows,
    totalCents,
    hasReaderInput: hasBudgetOnFixed,
    windowMonths,
  };
}
