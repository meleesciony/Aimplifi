/**
 * Fixed vs guilt-free spend class — PER TRANSACTION (DECISIONS #397,
 * 2026-08-03; supersedes the category-level designation channel of
 * #376/#378/#396, which the owner rejected: "not all hair and beauty is
 * fixed — when I switch one transaction, they all switch").
 *
 * Every spending outflow (posted OR pending) is one of:
 *   - fixed — non-discretionary (utilities, groceries, rent…)
 *   - guilt-free — discretionary (dining, movies, skiing…)
 *   - out-of-scope — transfers, card payments, income, uncategorized, etc.
 *
 * Pending is NOT out-of-scope: the charge already reduced what the reader can
 * spend, and the dial must work on the row they are looking at (owner 2026-08-03:
 * pending Hair Capital showed "Not counted" with no control). Plan intake stays
 * POSTED-only; /budgets already sums pending into its instruction.
 *
 * The class is individual: flipping one row never moves its category
 * siblings. The reader's per-row verdict (`Transaction.spendClassOverride`)
 * wins; absent one the app GUESSES — a recurring-bill merchant guesses fixed
 * (the owner's seed rule: most recurring items are fixed), otherwise the
 * filed category's taxonomy `discretionary` flag decides (custom categories
 * resolve through the same meta map as everywhere else). A dial choice that
 * matches the guess stores NULL, so the guess stays the source of truth
 * until the reader disagrees (setTransactionSpendClass in
 * src/server/transaction-flags-actions.ts).
 */
import { type TxnLike } from '@/lib/engine/fi/insights';
import {
  CATEGORY_BY_ID,
  type CategoryMeta,
} from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { isBudgetable } from '@/lib/engine/budgets/status';
import { overrideKey } from '@/lib/engine/recurring/override';
import { isExcludedFromTotals } from '@/lib/engine/transactions/exclude';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';

/** Settlement / savings / noise — never part of the fixed allocation bucket. */
export const FIXED_PATTERN_EXCLUDE_CATEGORY_IDS = new Set([
  'transfer',
  'credit-card-payment',
  'cash',
  'investment',
]);

export type SpendClass = 'fixed' | 'guilt-free' | 'out-of-scope';

/** Short register label — "discretionary" matches the owner's vocabulary. */
export function spendClassLabel(c: SpendClass): string {
  if (c === 'fixed') return 'Fixed';
  if (c === 'guilt-free') return 'Discretionary';
  return 'Not spending';
}

/**
 * WHY a row has no Fixed/Discretionary side — the reason, not just its absence.
 *
 * THIS IS THE SECOND RENAME OF THIS CHIP, AND RENAMING IT IS NOT THE FIX.
 * #395 shipped "Neither"; the owner asked what it meant, so #397 shipped
 * "Not counted"; the owner asked what THAT meant (screenshot 2026-08-03, an
 * `Interest Paid +$0.10` row). Both words are true and neither is an answer,
 * because ten different facts reach `out-of-scope` and all ten printed one
 * chip — the identical-pixel failure `row-labels.ts` exists to prevent, here
 * applied to the register. "Not counted" also names no SCOPE: it reads as "this
 * money is ignored", when the row still moves the balance, still counts as
 * income, and is missing from exactly one thing — the Fixed/Discretionary split.
 * So the chip now states the row's own fact, and the reason carries the
 * sentence that says what it is not part of.
 *
 * ORDERED BY WHAT THE READER CAN ACT ON, not by `classifySpendClass`'s
 * short-circuit order. The intrinsic facts (split container, transfer, money in)
 * come before `excluded`, because a transfer the reader also excluded is still a
 * transfer, and the exclusion already has its own amber badge on the same row —
 * the chip's job is to explain the missing dial, not to repeat the badge.
 *
 * TAKES THE CLASS AS GIVEN rather than re-deriving it. The verdict is computed
 * once on the server, WITH the reader's custom-category meta and their
 * recurring-bill merchant set; a UI that called `classifySpendClass` again would
 * be re-running it without either, and a custom category missing from the
 * client's static map resolves to `out-of-scope` — so the chip would explain
 * away a dial the server had in fact granted. One verdict, one author; this
 * function only names the reason behind it.
 *
 * Returns null for a row that HAS a class, so a caller cannot print a reason
 * beside a working Fixed/Discretionary dial.
 */
export type OutOfScopeReason =
  | 'split-parent'
  | 'transfer'
  | 'money-in'
  | 'excluded'
  | 'unsettled'
  | 'uncategorized'
  | 'card-payment'
  | 'cash'
  | 'investment'
  | 'not-spending';

export function outOfScopeReason(t: TxnLike, spendClass: SpendClass): OutOfScopeReason | null {
  if (spendClass !== 'out-of-scope') return null;
  if (t.isSplitParent) return 'split-parent';
  if (t.isTransfer) return 'transfer';
  if (t.amountCents >= 0) return 'money-in';
  if (isExcludedFromTotals(t)) return 'excluded';
  if (t.status !== 'POSTED' && t.status !== 'PENDING') return 'unsettled';
  // The register view fills an unfiled row's id with the 'uncategorized'
  // placeholder rather than null (server/transactions.ts), so both spellings of
  // "no category yet" must reach the same reason — one of them silently falling
  // through to the generic tail is how this chip lost its meaning the first time.
  const id = t.categoryId;
  if (!id || id === 'uncategorized') return 'uncategorized';
  if (id === 'transfer') return 'transfer';
  if (id === 'credit-card-payment') return 'card-payment';
  if (id === 'cash') return 'cash';
  if (id === 'investment') return 'investment';
  return 'not-spending';
}

/**
 * The chip text — short, because it sits in the Details / Rule… row chrome.
 *
 * EVERY LABEL HERE IS A WORD THE ROW DOES NOT ALREADY SAY. Checked against the
 * register by screenshot, not by eye over the source: the first cut labelled a
 * transfer "Transfer", and that row already carries the provenance pill
 * "Transfer" (provenance.ts LABELS) beside the category name "Transfer", so the
 * fix for one confusing chip printed the same word three times on one row. The
 * unfiled case had the same collision with provenance's "Needs a category", and
 * the excluded case with the amber "Excluded from totals" badge. A chip that
 * repeats its neighbour is not a disclosure, it is clutter — so each of these
 * states the one fact the rest of the row leaves out: why there is no dial.
 */
export function outOfScopeChipLabel(r: OutOfScopeReason): string {
  switch (r) {
    case 'split-parent':
      return 'Split';
    case 'transfer':
      return 'Own accounts';
    case 'money-in':
      return 'Money in';
    case 'excluded':
      return 'You excluded';
    case 'unsettled':
      return 'Not settled';
    case 'uncategorized':
      return 'No class yet';
    case 'card-payment':
      return 'Card payment';
    case 'cash':
      return 'Cash out';
    case 'investment':
      return 'Investing';
    case 'not-spending':
      return 'Not spending';
  }
}

/**
 * The heading every one of these explanations sits under — the answer to "not
 * counted WHERE", which the old chip never gave. Authored once so the register
 * and the detail view cannot name two different scopes for one fact.
 */
export const OUT_OF_SCOPE_HEADING = 'Not part of Fixed or Discretionary';

/**
 * One sentence per reason: what this row is, and what it is therefore missing
 * from. Each one states where the row still DOES count, because the reader's
 * actual question was whether the money had gone missing.
 */
export function outOfScopeExplanation(r: OutOfScopeReason): string {
  switch (r) {
    case 'split-parent':
      return 'This is the whole charge before it was split. The pieces under it carry the Fixed or Discretionary choice, so counting this one too would double it.';
    case 'transfer':
      return 'Money moved between your own accounts. Both balances change, but nothing was spent, so there is no Fixed or Discretionary side to choose.';
    case 'money-in':
      return 'Money coming in, not going out. It still counts as income and it still changes your balance — only money you spend gets a Fixed or Discretionary choice.';
    case 'excluded':
      return 'You marked this row “Excluded from totals”, so it stays out of your spending figures — including the Fixed and Discretionary split. Your balance still includes it.';
    case 'unsettled':
      return 'This row has not settled yet, so its amount can still change. It gets a Fixed or Discretionary choice once the bank posts it.';
    case 'uncategorized':
      return 'This row has no category yet, and the category is what decides Fixed or Discretionary. File it and the choice appears here.';
    case 'card-payment':
      return 'Paying a card bill settles purchases you already counted when you made them. Counting the payment too would charge you twice for the same spending.';
    case 'cash':
      return 'Cash you took out is not spent until you spend it. Whatever it pays for gets counted when that purchase shows up.';
    case 'investment':
      return 'Money moved into investing is saving, not spending, so it sits outside the Fixed and Discretionary split. It still counts toward your net worth.';
    case 'not-spending':
      return 'This row is not spending, so it has no Fixed or Discretionary side. Everything else about it — your balance, your Activity — is unchanged.';
  }
}

/**
 * The taxonomy's suggestion for a category (no per-row input): true = fixed,
 * false = guilt-free, `null` = the category cannot carry a spend class at all
 * (settlement, income, transfers, uncategorized, or unknown). This is the
 * fallback guess for a row whose merchant is not a recurring bill.
 */
export function suggestedCategoryIsFixed(
  categoryId: string,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
): boolean | null {
  if (!isBudgetable(categoryId)) return null;
  if (FIXED_PATTERN_EXCLUDE_CATEGORY_IDS.has(categoryId)) return null;
  const cat = meta.get(categoryId) ?? CATEGORY_BY_ID.get(categoryId);
  if (!cat) return null;
  if (cat.group === 'Income' || cat.group === 'Transfers & Other') return null;
  return !cat.discretionary;
}

/**
 * The class of ONE transaction. `fixedMerchants` holds the canonical payees
 * the reader's recurring bills resolve to (stored outflow series + declared
 * BILL verdicts − NOT_BILL — one server definition, see
 * getRecurringBillMerchantCanonicals); the default empty set keeps pure-engine
 * callers on the taxonomy guess alone.
 */
export function classifySpendClass(
  t: TxnLike,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  fixedMerchants: ReadonlySet<string> = new Set(),
): SpendClass {
  // Same exclusions as `countsInFlows`, except PENDING is admitted — settlement
  // status is not a spend-class axis (see module doc). Unknown statuses still
  // refuse rather than invent a class.
  if (
    t.isTransfer ||
    Boolean(t.isSplitParent) ||
    isExcludedFromTotals(t) ||
    t.amountCents >= 0 ||
    (t.status !== 'POSTED' && t.status !== 'PENDING')
  ) {
    return 'out-of-scope';
  }
  const id = t.categoryId;
  if (!id || FIXED_PATTERN_EXCLUDE_CATEGORY_IDS.has(id)) return 'out-of-scope';
  const suggested = suggestedCategoryIsFixed(id, meta);
  if (suggested === null) return 'out-of-scope';
  // The reader's verdict on THIS row wins; anything unreadable falls through
  // to the guess (parse-don't-guess, the isTaxClass rule).
  if (t.spendClassOverride === 'fixed' || t.spendClassOverride === 'guilt-free') {
    return t.spendClassOverride;
  }
  if (fixedMerchants.has(overrideKey(normalizeMerchant(t.rawDescriptor).canonical))) return 'fixed';
  return suggested ? 'fixed' : 'guilt-free';
}

/**
 * The app's guess for a row, ignoring any verdict on it — the server action
 * stores NULL when the reader's choice matches this, so the guess stays the
 * source of truth until the reader actually disagrees.
 */
export function guessSpendClass(
  t: TxnLike,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  fixedMerchants: ReadonlySet<string> = new Set(),
): SpendClass {
  return classifySpendClass({ ...t, spendClassOverride: null }, meta, fixedMerchants);
}

/**
 * The sentence that reconciles this panel with the By-category list beneath it
 * (C.13 critic P1-1).
 *
 * They genuinely differ, and both are right for their own job. C.25 (#403)
 * takes a loan payment carried on its loan OUT of the category figures, because
 * a category figure links to a register filtered to that category and must sum
 * to it. The Fixed / Discretionary split does NOT apply that exclusion, because
 * ITS link goes to a register filtered by class — which still lists the payment
 * — and dropping it there would break the destination match C.13 just
 * established. So one page prints Housing twice, at two figures, four inches
 * apart, and until now only the lower one carried an explanation.
 *
 * The sentence names the direction rather than merely disclosing an exclusion:
 * a reader who reads "not counted" under one figure and sees it counted in the
 * other has been told something that contradicts what is on screen.
 *
 * `amount` arrives pre-formatted — currency formatting stays at the UI
 * boundary (`formatCents`), as everywhere else in this codebase.
 */
export function spendClassLoanPaymentNote(fact: {
  payee: string;
  loanName: string;
  amount: string;
}): string {
  return `Payments to ${fact.payee} at ${fact.amount}/mo ARE counted here, because this split follows your Transactions list. Under By category below they are counted on ${fact.loanName} instead, so the two lists differ by that amount.`;
}

export interface SpendClassCategoryRow {
  categoryId: string;
  name: string;
  spentCents: number;
  /** Which list the row sits in — a mixed category appears in both, once per
   *  side, with that side's subtotal. */
  isFixed: boolean;
}

/**
 * Build the Fixed / Guilt-free lists for /budgets from this month's rows,
 * classified PER TRANSACTION (#397): a category whose rows split appears in
 * both lists, each with its own subtotal — the lists answer "what makes up my
 * Fixed number and my guilt-free number", and a single category-level bucket
 * cannot do that honestly. Categories with $0 classified spend are omitted.
 *
 * C.13: `keepsReconciled` is REQUIRED, and it is the parity half of this
 * function's contract rather than an optimisation. Each of these headings is a
 * LINK — `spendClassMonthRegisterHref` sends the reader to the register filtered
 * to the same class and month — so the total printed here is a claim that the
 * destination adds up to it (the O.5/O.6 link invariant). The register applies
 * the shared R1 reconciliation ownership rule (`getReconciliationTxnKeep`, see
 * server/transactions.ts) before it classifies anything, so a reader who has
 * confirmed a provider migration sees each real purchase ONCE there — this
 * panel summed the raw month query, counting the predecessor's copy of every
 * post-cutover purchase a second time, and the heading promised money the
 * destination could not show. Taking the predicate rather than pre-filtered
 * rows keeps the two surfaces on one rule instead of two copies of it.
 *
 * U.18: "ONCE" above is no longer unqualified — U.13 deliberately RELEASES the
 * one handover day per link to both sides (a visible double, not a silent
 * loss), so the register itself shows two rows that day and this function's
 * own `keepsReconciled` filter keeps both here too. Unlike the four families
 * U.16 disclosed this on (category/report/lifestyle-creep/new-merchant
 * breakdowns) and unlike the sibling Fixed-vs-typical total this same page
 * builds two calls above, this classifier used to be handed no `handoverKeys`
 * and folded no marker into its output — filed as U.29 (opened by U.18),
 * fixed here: `handoverKeys` defaults to empty (the truth for every reader
 * with no combined accounts) and every classified row on a released day is
 * counted, the same test `buildCategoryBreakdowns` applies. The panel has no
 * per-transaction row list — only category subtotals — so there is no
 * "these rows still add up" tally to state; `SpendClassPanel` passes
 * `statesATally: false` to `breakdownHandoverDayCopy`, same as every other
 * surface with nothing for the reader to sum by eye.
 */
export function summarizeSpendClassCategories(
  transactions: readonly TxnLike[],
  meta: ReadonlyMap<string, CategoryMeta>,
  fixedMerchants: ReadonlySet<string>,
  nameOf: (id: string) => string,
  keepsReconciled: (accountId: string, date: string) => boolean,
  // U.29: defaults to empty, which is the truth for every reader with no
  // combined accounts — same default `buildCategoryBreakdowns` uses.
  handoverKeys: ReadonlySet<string> = new Set<string>(),
): { fixed: SpendClassCategoryRow[]; guiltFree: SpendClassCategoryRow[]; countedOnHandoverDays: number } {
  const byCat = new Map<string, { fixed: number; guiltFree: number }>();
  let countedOnHandoverDays = 0;
  for (const t of transactions) {
    if (!keepsReconciled(t.accountId, t.date)) continue;
    const cls = classifySpendClass(t, meta, fixedMerchants);
    if (cls === 'out-of-scope') continue;
    const id = t.categoryId!;
    const cur = byCat.get(id) ?? { fixed: 0, guiltFree: 0 };
    cur[cls === 'fixed' ? 'fixed' : 'guiltFree'] += -t.amountCents;
    byCat.set(id, cur);
    if (t.accountId && handoverKeys.has(handoverKey(t.accountId, t.date))) countedOnHandoverDays += 1;
  }
  const fixed: SpendClassCategoryRow[] = [];
  const guiltFree: SpendClassCategoryRow[] = [];
  for (const [categoryId, sums] of byCat) {
    if (sums.fixed > 0) {
      fixed.push({ categoryId, name: nameOf(categoryId), spentCents: sums.fixed, isFixed: true });
    }
    if (sums.guiltFree > 0) {
      guiltFree.push({
        categoryId,
        name: nameOf(categoryId),
        spentCents: sums.guiltFree,
        isFixed: false,
      });
    }
  }
  const bySpendThenName = (a: SpendClassCategoryRow, b: SpendClassCategoryRow) =>
    b.spentCents - a.spentCents || a.name.localeCompare(b.name);
  fixed.sort(bySpendThenName);
  guiltFree.sort(bySpendThenName);
  return { fixed, guiltFree, countedOnHandoverDays };
}
