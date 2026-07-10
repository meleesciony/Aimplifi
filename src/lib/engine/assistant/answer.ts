/**
 * Ask Aimplifi — pure answer formatters (DECISIONS #75).
 *
 * Each formatter turns a typed intent + the relevant ENGINE output (computed by
 * the same read-paths the dedicated views use) into a display answer. No money
 * math happens here beyond selecting precomputed cents and summing inputs the
 * engines already produced — so the assistant cannot invent a number, and every
 * figure traces back to a tested engine (the no-fabrication contract). All money
 * is rendered through the one canonical `formatCents`; all dates through a pure
 * `humanDate` (no `Date` object). Pure: typed in, typed out, no I/O.
 */
import { type Cents, formatCents } from '@/lib/money';
import { netWorthCents } from '@/lib/engine/cash-needed/assemble';
import { isLiabilityType } from '@/lib/engine/transactions/query';
import type { SpendingBreakdown } from '@/lib/engine/reports/reports';
import type { SpendingPlan } from '@/lib/engine/spending-plan/plan';
import type { RecurringSummary } from '@/lib/engine/recurring/summary';
import type { Forecast } from '@/lib/engine/forecast/forecast';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import type { LargestTxn } from '@/lib/engine/trends/trends';
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import { addMonthsClamped, compareDates, formatMonth, isoDate } from '@/lib/dates';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { DebtPayoffResult } from '@/lib/engine/debt/payoff';
import type { DebtFreeByDateResult } from '@/lib/engine/solve/debt-free-by-date';
import type { SavingsGoalByDateResult } from '@/lib/engine/solve/savings-goal-by-date';
import type { RetireAtAgeResult } from '@/lib/engine/solve/retire-at-age';
import type { AssistantIntent, SpendTarget, Timeframe } from './intent';

export interface AssistantFact {
  label: string;
  value: string;
}
export interface AssistantSource {
  label: string;
  href: string;
}
/** An optional, user-confirmed action an answer can offer (e.g. save a debt-free goal).
 *  Carries only the target date + label — the server RE-SOLVES every figure from the
 *  user's own data on save, so no client-supplied number is ever trusted. */
export type AssistantGoalAction =
  | { kind: 'save_debt_free_goal'; targetDate: string; label: string }
  /** goalAmountCents = the user-stated target; the server RE-SOLVES the monthly from it +
   *  the user's own safe-to-spend on save, so no client-computed figure is ever trusted. */
  | { kind: 'save_savings_goal'; targetDate: string; label: string; goalAmountCents: number }
  /** targetAge = the user-stated retirement age; the server re-validates it (bounds +
   *  cross-field ordering) before persisting — no derived figure is trusted. */
  | { kind: 'save_retirement_age'; targetAge: number; label: string };
export interface AssistantAnswer {
  kind: AssistantIntent['kind'];
  /** The direct answer, in plain language with the figure embedded. */
  headline: string;
  /** One supporting sentence — assumptions or context (never a new number). */
  detail?: string;
  facts: AssistantFact[];
  /** Where the full view lives, for "show me more" grounding. */
  source?: AssistantSource;
  /** Follow-up question chips — contextual per intent (#197) or the unknown
   *  capabilities list from answerUnknown(). */
  suggestions?: string[];
  /** True when the routing came from the LLM classifier (an inference, not an
   *  exact phrase match) — surfaced in the UI so the guess is never silent. */
  interpreted?: boolean;
  /** An optional confirm-before-create action the UI may surface (e.g. save a goal). */
  action?: AssistantGoalAction;
}

const fmt = (n: number) => formatCents(n as Cents);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM-DD' → 'Mon D, YYYY', without a Date object (business-date safe). */
function humanDate(s: string): string {
  const [y, m, d] = s.split('-');
  return `${MON[Number(m) - 1]} ${Number(d)}, ${y}`;
}

/** Whole-percent string for a ratio of cents (e.g. share of total spend). */
function pctOf(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  return `${Math.round((part / whole) * 100)}%`;
}

// ─── account types (mirrors the net-worth classifier) ───────────────────────

export interface AccountLike {
  id: string;
  name: string;
  type: string;
  currentBalanceCents: number;
}
// Liability classification uses the canonical isLiabilityType (CREDIT/LOAN/
// MORTGAGE/OTHER_LIABILITY) — the SAME predicate netWorthCents and /accounts use —
// so the assets/liabilities breakdown can never disagree with the headline.
const TYPE_WORDS: { re: RegExp; type: string }[] = [
  { re: /\bchecking\b/, type: 'CHECKING' },
  { re: /\bsavings?\b/, type: 'SAVINGS' },
  { re: /\b(brokerage|investment|invest|portfolio)\b/, type: 'INVESTMENT' },
  { re: /\b(credit card|credit)\b/, type: 'CREDIT' },
  { re: /\bmortgage\b/, type: 'MORTGAGE' },
  { re: /\bloan\b/, type: 'LOAN' },
];
const GENERIC_NAME_WORD = new Set(['account', 'card', 'the', 'my', 'and']);

// ─── net worth ──────────────────────────────────────────────────────────────

export function answerNetWorth(accounts: readonly AccountLike[]): AssistantAnswer {
  const net = netWorthCents([...accounts]);
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (isLiabilityType(a.type)) liabilities += a.currentBalanceCents;
    else assets += a.currentBalanceCents;
  }
  return {
    kind: 'net_worth',
    headline: `Your net worth is ${fmt(net)}.`,
    detail: 'Everything you own minus everything you owe, across all linked accounts.',
    facts: [
      { label: 'Assets', value: fmt(assets) },
      { label: 'Liabilities', value: fmt(liabilities) },
    ],
    source: { label: 'See accounts', href: '/accounts' },
  };
}

// ─── account balance ────────────────────────────────────────────────────────

export function answerAccountBalance(accounts: readonly AccountLike[], query: string): AssistantAnswer {
  const q = query.toLowerCase();
  const typeHit = TYPE_WORDS.find((t) => t.re.test(q));
  let matches: AccountLike[] = [];
  if (typeHit) matches = accounts.filter((a) => a.type === typeHit.type);
  if (matches.length === 0) {
    matches = accounts.filter((a) =>
      a.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((w) => w.length >= 4 && !GENERIC_NAME_WORD.has(w) && q.includes(w)),
    );
  }

  if (matches.length === 0) {
    return {
      kind: 'account_balance',
      headline: "I couldn't find an account matching that.",
      detail: 'Here are the accounts I can see.',
      facts: accounts.map((a) => ({ label: a.name, value: fmt(a.currentBalanceCents) })),
      source: { label: 'See accounts', href: '/accounts' },
    };
  }
  if (matches.length === 1) {
    const a = matches[0];
    const owed = isLiabilityType(a.type);
    return {
      kind: 'account_balance',
      headline: `${a.name} ${owed ? 'has a balance of' : 'has'} ${fmt(a.currentBalanceCents)}${owed ? ' owed' : ''}.`,
      facts: [{ label: a.name, value: fmt(a.currentBalanceCents) }],
      source: { label: 'See accounts', href: '/accounts' },
    };
  }
  const total = matches.reduce((s, a) => s + a.currentBalanceCents, 0);
  return {
    kind: 'account_balance',
    headline: `${fmt(total)} across ${matches.length} accounts.`,
    facts: matches.map((a) => ({ label: a.name, value: fmt(a.currentBalanceCents) })),
    source: { label: 'See accounts', href: '/accounts' },
  };
}

// ─── spending ───────────────────────────────────────────────────────────────

const REPORTS_SOURCE: AssistantSource = { label: 'See reports', href: '/reports' };

export function answerSpendTotal(breakdown: SpendingBreakdown, tf: Timeframe): AssistantAnswer {
  if (breakdown.totalCents <= 0) {
    return { kind: 'spend_total', headline: `No spending recorded ${tf.label}.`, facts: [], source: REPORTS_SOURCE };
  }
  return {
    kind: 'spend_total',
    headline: `You spent ${fmt(breakdown.totalCents)} ${tf.label}.`,
    detail: 'Purchases only — transfers, credit-card payments, and income are excluded.',
    facts: breakdown.byCategory.slice(0, 3).map((c) => ({ label: c.name, value: fmt(c.amountCents) })),
    source: REPORTS_SOURCE,
  };
}

export function answerSpendByCategory(breakdown: SpendingBreakdown, target: SpendTarget, tf: Timeframe): AssistantAnswer {
  let amount = 0;
  const facts: AssistantFact[] = [];
  if (target.type === 'category') {
    amount = breakdown.byCategory.find((c) => c.categoryId === target.categoryId)?.amountCents ?? 0;
  } else if (target.type === 'categories') {
    // Umbrella: sum the named leaves and surface the top 3 as the supporting facts.
    // byCategory is already amount-desc, so the filtered slice stays ranked.
    const ids = new Set(target.categoryIds);
    const matches = breakdown.byCategory.filter((c) => ids.has(c.categoryId));
    amount = matches.reduce((sum, c) => sum + c.amountCents, 0);
    for (const c of matches.slice(0, 3)) facts.push({ label: c.name, value: fmt(c.amountCents) });
  } else {
    const g = breakdown.byGroup.find((x) => x.group === target.group);
    amount = g?.amountCents ?? 0;
    for (const c of g?.categories.slice(0, 3) ?? []) facts.push({ label: c.name, value: fmt(c.amountCents) });
  }

  if (amount <= 0) {
    return {
      kind: 'spend_by_category',
      headline: `No ${target.label} spending ${tf.label}.`,
      facts,
      source: REPORTS_SOURCE,
    };
  }
  const share = pctOf(amount, breakdown.totalCents);
  return {
    kind: 'spend_by_category',
    headline: `You spent ${fmt(amount)} on ${target.label} ${tf.label}.`,
    detail: share ? `That's ${share} of your ${tf.label} spending.` : undefined,
    facts,
    source: REPORTS_SOURCE,
  };
}

export function answerTopCategories(breakdown: SpendingBreakdown, tf: Timeframe, limit: number): AssistantAnswer {
  const top = breakdown.byCategory.slice(0, limit);
  if (top.length === 0) {
    return { kind: 'top_categories', headline: `No spending recorded ${tf.label}.`, facts: [], source: REPORTS_SOURCE };
  }
  return {
    kind: 'top_categories',
    headline: `Your top spending ${tf.label}: ${top[0].name} at ${fmt(top[0].amountCents)}.`,
    detail: `Total ${tf.label}: ${fmt(breakdown.totalCents)}.`,
    facts: top.map((c) => ({ label: c.name, value: fmt(c.amountCents) })),
    source: REPORTS_SOURCE,
  };
}

// ─── largest purchases ──────────────────────────────────────────────────────

export interface PurchaseRow {
  date: string;
  amountCents: number; // signed; negative = spend
  categoryId?: string | null;
  isTransfer?: boolean;
  isSplitParent?: boolean;
  merchant: string;
}

/** Non-actionable money movement — cash/ATM, transfers, card payments, and
 *  uncategorized — that the trends "largest" list also excludes (one definition
 *  of "a real purchase", so a Zelle/ATM pseudo-merchant never wins "biggest buy"). */
const NON_ACTIONABLE_GROUP = 'Transfers & Other';

/**
 * Mirrors the trends `isPurchaseRow` exactly (negative outflow; not split parent /
 * transfer / income; not the non-actionable group). One definition of "a
 * purchase" across the app — the grounding test pins this to the seed's real
 * biggest June buy (Costco) to catch any drift.
 */
function isPurchaseRow(t: PurchaseRow, meta: ReadonlyMap<string, CategoryMeta>): boolean {
  if (t.isSplitParent || t.isTransfer) return false;
  if (t.amountCents >= 0) return false;
  const id = t.categoryId ?? 'uncategorized';
  if (id === 'transfer') return false;
  const group = meta.get(id)?.group;
  if (group === 'Income' || group === NON_ACTIONABLE_GROUP) return false;
  return true;
}

/**
 * Rank the biggest purchases in [fromYm,toYm], up to and including `today`.
 * Matches /trends `computeLargest` EXACTLY: same window + `<= today` guard (a
 * future-dated in-progress-month charge is not "spent yet") and the same
 * code-point tie-break (amount → date → merchant) — so the two surfaces never
 * disagree, on the demo or on live data.
 */
export function largestPurchases(
  rows: readonly PurchaseRow[],
  tf: Timeframe,
  limit: number,
  today: string,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
): LargestTxn[] {
  return rows
    .filter((t) => {
      const ym = t.date.slice(0, 7);
      return ym >= tf.fromYm && ym <= tf.toYm && t.date <= today && isPurchaseRow(t, meta);
    })
    .map((t) => ({
      date: t.date,
      merchant: t.merchant,
      categoryName: meta.get(t.categoryId ?? 'uncategorized')?.name ?? 'Uncategorized',
      amountCents: -t.amountCents,
    }))
    .sort(
      (a, b) =>
        b.amountCents - a.amountCents ||
        (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
        (a.merchant < b.merchant ? -1 : a.merchant > b.merchant ? 1 : 0),
    )
    .slice(0, limit);
}

export function answerLargest(largest: readonly LargestTxn[], tf: Timeframe): AssistantAnswer {
  if (largest.length === 0) {
    return { kind: 'largest_purchases', headline: `No purchases recorded ${tf.label}.`, facts: [], source: { label: 'See activity', href: '/transactions' } };
  }
  const top = largest[0];
  return {
    kind: 'largest_purchases',
    headline: `Your biggest purchase ${tf.label} was ${fmt(top.amountCents)} at ${top.merchant}.`,
    facts: largest.map((t) => ({ label: `${t.merchant} · ${humanDate(t.date)}`, value: fmt(t.amountCents) })),
    source: { label: 'See activity', href: '/transactions' },
  };
}

// ─── merchant spend ─────────────────────────────────────────────────────────

const ACTIVITY_SOURCE: AssistantSource = { label: 'See activity', href: '/transactions' };

export interface MerchantSpendResult {
  /** Display name: the canonical merchant with the largest matched total (so it's
   *  properly cased — "McDonald's", "Home Depot" — from the merchant table), or
   *  the title-cased query when nothing matched. */
  merchant: string;
  totalCents: number; // positive
  count: number;
  /** Matched purchases, amount-desc then most-recent-first; amounts positive. */
  items: { date: string; merchant: string; amountCents: number }[];
}

/** Title-case a bare query term for the empty-result fallback ("costco" → "Costco"). */
function titleCaseTerm(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Fold case + punctuation to a comparison key so a term a user actually TYPES
 *  matches the merchant table's canonical form: apostrophes and dots dropped,
 *  every other separator collapsed to a single space. "McDonald's" → "mcdonalds",
 *  "Trader Joe's" → "trader joes", "Chick-fil-A" → "chick fil a". Without this the
 *  common apostrophe-less "mcdonalds"/"lowes"/"trader joes" a user types would
 *  miss every possessive brand and answer a false "No spending" (critic #168 P1). */
function merchantKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/['.]/g, '')
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** A transaction's canonical merchant matches the user's query when either is a
 *  whole-word prefix of the other, after punctuation/case folding: "costco"
 *  matches "Costco" and "Costco Gas"; "mcdonalds" matches "McDonald's". Token-safe
 *  — "app" never matches "Apple" (the prefix needs a trailing word boundary). */
function merchantMatches(canonical: string, q: string): boolean {
  const c = merchantKey(canonical);
  const qq = merchantKey(q);
  if (!c || !qq) return false;
  return c === qq || c.startsWith(`${qq} `) || qq.startsWith(`${c} `);
}

/**
 * Sum a single merchant's purchases in [fromYm,toYm] up to `today`, reusing the
 * exact `isPurchaseRow` definition largest/trends use (so a Zelle/ATM/transfer
 * pseudo-merchant can never be counted). Pure: rows in, totals out — the server
 * derives `rows` from the same snapshot the other spending intents read.
 *
 * GROSS by design (#168 critic P2, accepted): this counts purchases, not net
 * spend — a return/refund is not subtracted, matching the sibling "purchase"
 * surfaces (/trends `largest`, which share `toPurchaseRows`) and the /transactions
 * activity list this answer links to. It therefore reads gross where
 * `spend_by_category` reads net; the facts list every counted purchase, so the
 * headline always equals the sum the user can see, never a netted figure that
 * wouldn't reconcile against the listed rows.
 */
export function merchantSpend(
  rows: readonly PurchaseRow[],
  tf: Timeframe,
  query: string,
  today: string,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
): MerchantSpendResult {
  const q = query.trim().toLowerCase();
  const matched = rows.filter((t) => {
    const ym = t.date.slice(0, 7);
    return ym >= tf.fromYm && ym <= tf.toYm && t.date <= today && isPurchaseRow(t, meta) && merchantMatches(t.merchant, q);
  });
  const byCanonical = new Map<string, number>();
  for (const t of matched) byCanonical.set(t.merchant, (byCanonical.get(t.merchant) ?? 0) - t.amountCents);
  let display = '';
  let best = -1;
  for (const [name, amt] of byCanonical) {
    if (amt > best) {
      best = amt;
      display = name;
    }
  }
  const items = matched
    .map((t) => ({ date: t.date, merchant: t.merchant, amountCents: -t.amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return {
    merchant: display || titleCaseTerm(query),
    totalCents: items.reduce((s, i) => s + i.amountCents, 0),
    count: items.length,
    items,
  };
}

export function answerMerchantSpend(res: MerchantSpendResult, tf: Timeframe): AssistantAnswer {
  if (res.count === 0 || res.totalCents <= 0) {
    return { kind: 'merchant_spend', headline: `No spending at ${res.merchant} ${tf.label}.`, facts: [], source: ACTIVITY_SOURCE };
  }
  const noun = res.count === 1 ? 'purchase' : 'purchases';
  return {
    kind: 'merchant_spend',
    headline: `You spent ${fmt(res.totalCents)} at ${res.merchant} ${tf.label}.`,
    detail: `Across ${res.count} ${noun}.`,
    facts: res.items.slice(0, 5).map((i) => ({ label: `${i.merchant} · ${humanDate(i.date)}`, value: fmt(i.amountCents) })),
    source: ACTIVITY_SOURCE,
  };
}

// ─── income ─────────────────────────────────────────────────────────────────

export function answerIncome(incomeCents: number, tf: Timeframe): AssistantAnswer {
  if (incomeCents <= 0) {
    return { kind: 'income', headline: `No income recorded ${tf.label}.`, facts: [], source: REPORTS_SOURCE };
  }
  return {
    kind: 'income',
    headline: `You brought in ${fmt(incomeCents)} ${tf.label}.`,
    detail: 'Income only — transfers between your own accounts are excluded.',
    facts: [],
    source: REPORTS_SOURCE,
  };
}

// ─── safe to spend ──────────────────────────────────────────────────────────

export function answerSafeToSpend(plan: SpendingPlan): AssistantAnswer {
  const source: AssistantSource = { label: 'Open spending plan', href: '/spending-plan' };
  const facts: AssistantFact[] = [
    { label: 'Expected income', value: fmt(plan.expectedIncomeCents) },
    { label: 'Spent so far', value: fmt(plan.spentSoFarCents) },
    { label: 'Bills still due', value: fmt(plan.upcomingBillsCents) },
    { label: 'Planned savings', value: fmt(plan.plannedSavingsCents) },
  ];
  if (plan.overspent) {
    return {
      kind: 'safe_to_spend',
      headline: `You're ${fmt(-plan.leftToSpendCents)} over your plan for this month.`,
      detail: 'That counts what you have left after bills still due and planned savings.',
      facts,
      source,
    };
  }
  return {
    kind: 'safe_to_spend',
    headline: `You have ${fmt(plan.leftToSpendCents)} left to spend this month — about ${fmt(plan.perDayCents)}/day for the next ${plan.daysLeftInMonth} days.`,
    detail: 'After the bills still due this month and your planned savings.',
    facts,
    source,
  };
}

// ─── cash needed (pay cards this cycle) ─────────────────────────────────────

export function answerCashNeeded(result: CashNeededResult, paymentAccountName: string): AssistantAnswer {
  const s = result.headline;
  const source: AssistantSource = { label: 'See cards', href: '/cards' };
  if (s.cardsDueCount === 0 || s.requiredCents === 0) {
    return {
      kind: 'cash_needed',
      headline: 'You have nothing due on your cards this cycle.',
      facts: [],
      source,
    };
  }
  const facts: AssistantFact[] = [
    { label: 'Cards due', value: String(s.cardsDueCount) },
    { label: 'From', value: paymentAccountName },
  ];
  let detail: string | undefined;
  if (s.shortfallCents > 0 && s.recommendation) {
    facts.push({ label: 'Shortfall', value: fmt(s.shortfallCents) });
    detail = `That's more than ${paymentAccountName} holds — move ${fmt(s.recommendation.amountCents)} in by ${humanDate(s.recommendation.byDate)}.`;
  }
  return {
    kind: 'cash_needed',
    headline: `You need ${fmt(s.requiredCents)}${s.byDate ? ` by ${humanDate(s.byDate)}` : ''} to pay your cards in full.`,
    detail,
    facts,
    source,
  };
}

// ─── debt payoff (when am I debt-free) ──────────────────────────────────────

export function answerDebtPayoff(plan: DebtPayoffResult, today: string, debtCount: number): AssistantAnswer {
  const source: AssistantSource = { label: 'See debt plan', href: '/goals' };
  if (debtCount === 0) {
    return { kind: 'debt_payoff', headline: 'You have no tracked debts right now — nothing to pay down.', facts: [], source };
  }
  if (plan.monthsToDebtFree === null) {
    return {
      kind: 'debt_payoff',
      headline: COACH_COPY.debtNotClearing(),
      facts: [
        { label: 'Debts', value: String(debtCount) },
        { label: 'Interest so far', value: fmt(plan.totalInterestCents) },
      ],
      source,
    };
  }
  const monthLabel = formatMonth(addMonthsClamped(isoDate(today), plan.monthsToDebtFree).slice(0, 7));
  return {
    kind: 'debt_payoff',
    headline: COACH_COPY.debtAskAnswer(monthLabel, 'least-interest (avalanche)'),
    detail: 'Snowball (smallest balance first) is one tap away on the planner if momentum matters more.',
    facts: [
      { label: 'Debts', value: String(debtCount) },
      { label: 'Months', value: String(plan.monthsToDebtFree) },
      { label: 'Total interest', value: fmt(plan.totalInterestCents) },
    ],
    source,
  };
}

// ─── debt-free by a target date (inverse planning, DECISIONS #125) ───────────

const DEBT_PLAN_SOURCE: AssistantSource = { label: 'See debt plan', href: '/goals' };

/** Whole-percent string from a bps share (e.g. 4000 → "40%"). Not clamped: an
 *  over-100% share is the honest "more than your whole safe-to-spend" signal. */
function pctFromBps(bps: number): string {
  return `${Math.round(bps / 100)}%`;
}

/**
 * Inverse planner answer: a stated DATE → the minimal extra/mo the SOLVER found, with
 * honest feasibility. Every figure is precomputed by solveDebtFreeByDate over the same
 * loadDebtAccounts read-path the forward debt_payoff uses — this formatter only selects
 * and phrases them (no math), so it cannot originate a number. Copy follows the coaching
 * guardrails: illustration not advice, assumptions inline, no shame on a stretch target.
 */
export function answerDebtFreeByDate(
  result: DebtFreeByDateResult,
  label: string,
  targetDate: string,
  today: string,
): AssistantAnswer {
  if (result.outcome === 'already-debt-free') {
    return {
      kind: 'debt_free_by_date',
      headline: "You have no tracked debts — you're already debt-free.",
      facts: [],
      source: DEBT_PLAN_SOURCE,
    };
  }
  if (result.outcome === 'unreachable') {
    // targetMonths is 0 either because the date is in the past (too LATE) or this month (too soon).
    const past = compareDates(isoDate(targetDate), isoDate(today)) < 0;
    return {
      kind: 'debt_free_by_date',
      headline: past
        ? `${label} is already behind us — pick a future date to plan toward.`
        : `${label} is too soon to be debt-free by — clearing any balance takes at least a month.`,
      detail: 'Try a later date and I’ll work out the payment it would take.',
      facts: [{ label: 'Total debt', value: fmt(result.totalBalanceCents) }],
      source: DEBT_PLAN_SOURCE,
    };
  }

  const byMonth = formatMonth(addMonthsClamped(isoDate(today), result.monthsToDebtFree as number).slice(0, 7));
  const action: AssistantGoalAction = { kind: 'save_debt_free_goal', targetDate, label };

  if (result.outcome === 'on-track') {
    return {
      kind: 'debt_free_by_date',
      headline: `You're on track to be debt-free by ${label} on your current payments — no extra needed.`,
      detail: `At the least-interest (avalanche) order your minimums clear everything around ${byMonth}. Illustration, not advice — assumes APRs as entered and steady payments.`,
      facts: [
        { label: 'Total debt', value: fmt(result.totalBalanceCents) },
        { label: 'Extra needed', value: `${fmt(0)}/mo` },
        { label: 'Debt-free by', value: byMonth },
      ],
      source: DEBT_PLAN_SOURCE,
      action,
    };
  }

  // reachable — a finite extra hits the date; affordability is reported, never hidden.
  const required = result.requiredExtraMonthlyCents as number;
  // share is null IFF safe-to-spend ≤ 0 (the engine guards it), so a null share in the
  // reachable case means the user is overspent / has no room this month.
  const sharePct = result.shareOfSafeToSpendBps !== null ? pctFromBps(result.shareOfSafeToSpendBps) : null;
  const facts: AssistantFact[] = [
    { label: 'Total debt', value: fmt(result.totalBalanceCents) },
    { label: 'Extra needed', value: `${fmt(required)}/mo` },
    { label: 'Debt-free by', value: byMonth },
    ...(sharePct ? [{ label: 'Share of safe-to-spend', value: sharePct }] : []),
  ];

  if (sharePct === null) {
    // Overspent: a real figure, but honestly flagged as budget they don't have yet — NOT a
    // fake "just add $X/mo" yes for exactly the cohort that most needs the caveat (UX-1).
    return {
      kind: 'debt_free_by_date',
      headline: `To be debt-free by ${label} you'd add about ${fmt(required)}/mo on top of your minimums — but you're over your monthly plan right now, so that's budget you don't have yet.`,
      detail: 'A later date would ask less each month. Illustration, not advice — assumes the least-interest (avalanche) order and APRs as entered.',
      facts,
      source: DEBT_PLAN_SOURCE,
      action,
    };
  }

  if (result.withinSafeToSpend === false) {
    return {
      kind: 'debt_free_by_date',
      headline: `Being debt-free by ${label} would take about ${fmt(required)}/mo extra — about ${sharePct} of your safe-to-spend, beyond a single month's budget.`,
      detail: 'A later date would ask less of your budget each month. Illustration, not advice — assumes the least-interest (avalanche) order and APRs as entered.',
      facts,
      source: DEBT_PLAN_SOURCE,
      action,
    };
  }

  return {
    kind: 'debt_free_by_date',
    headline: `To be debt-free by ${label}, add about ${fmt(required)}/mo on top of your minimums — about ${sharePct} of your safe-to-spend.`,
    detail: `That clears everything around ${byMonth} at the least-interest (avalanche) order. Illustration, not advice — assumes APRs as entered and steady payments.`,
    facts,
    source: DEBT_PLAN_SOURCE,
    action,
  };
}

// ─── savings goal by a target date (inverse planning, DECISIONS #126) ─────────

const GOALS_SOURCE: AssistantSource = { label: 'See goals', href: '/goals' };

/**
 * The user named a savings DATE but no amount — ASK for it (the "ask, don't invent"
 * mechanic), never guess a target figure. This is the differentiator made literal.
 */
export function answerSavingsGoalNeedsAmount(label: string): AssistantAnswer {
  return {
    kind: 'savings_goal_by_date',
    headline: `How much do you want to have saved by ${label}?`,
    detail:
      'Tell me the amount and I’ll work out the monthly savings it would take — for example, “save $15,000 by next December.”',
    facts: [],
    source: GOALS_SOURCE,
  };
}

/**
 * Inverse savings planner answer: a stated AMOUNT + DATE → the minimal monthly the SOLVER
 * found, with honest feasibility. Every figure is precomputed by solveSavingsGoalByDate over
 * the SAME getSpendingPlan safe-to-spend the /spending-plan view uses — this formatter only
 * selects and phrases them (no math). Copy follows the coaching guardrails: illustration not
 * advice, the no-growth assumption stated inline, no shame on a stretch target.
 */
export function answerSavingsGoalByDate(
  result: SavingsGoalByDateResult,
  label: string,
  targetDate: string,
  today: string,
): AssistantAnswer {
  if (result.outcome === 'already-funded') {
    return {
      kind: 'savings_goal_by_date',
      headline: `You've already set aside ${fmt(result.goalAmountCents)} or more — that goal is funded.`,
      facts: [{ label: 'Goal amount', value: fmt(result.goalAmountCents) }],
      source: GOALS_SOURCE,
    };
  }
  if (result.outcome === 'unreachable') {
    // targetMonths is 0 because the date is this month or earlier (too soon to save anything up).
    const past = compareDates(isoDate(targetDate), isoDate(today)) < 0;
    return {
      kind: 'savings_goal_by_date',
      headline: past
        ? `${label} is already behind us — pick a future date to save toward.`
        : `${label} is too soon to save that up — building savings takes at least a month.`,
      detail: 'Try a later date and I’ll work out the monthly savings it would take.',
      facts: [{ label: 'Goal amount', value: fmt(result.goalAmountCents) }],
      source: GOALS_SOURCE,
    };
  }

  // reachable — a finite monthly funds the goal by the date; affordability is reported, never hidden.
  const required = result.requiredMonthlyCents as number;
  const byMonth = formatMonth(addMonthsClamped(isoDate(today), result.monthsToGoal as number).slice(0, 7));
  const action: AssistantGoalAction = {
    kind: 'save_savings_goal',
    targetDate,
    label,
    goalAmountCents: result.goalAmountCents,
  };
  // share is null IFF safe-to-spend ≤ 0 (the engine guards it), so a null share here means
  // the user is overspent / has no room this month.
  const sharePct = result.shareOfSafeToSpendBps !== null ? pctFromBps(result.shareOfSafeToSpendBps) : null;
  const facts: AssistantFact[] = [
    { label: 'Goal amount', value: fmt(result.goalAmountCents) },
    { label: 'Monthly savings', value: `${fmt(required)}/mo` },
    { label: 'Funded by', value: byMonth },
    ...(sharePct ? [{ label: 'Share of safe-to-spend', value: sharePct }] : []),
  ];

  if (sharePct === null) {
    // Overspent: a real figure, but honestly flagged as budget they don't have yet — NOT a
    // fake "just set aside $X/mo" yes for exactly the cohort that most needs the caveat.
    return {
      kind: 'savings_goal_by_date',
      headline: `To save ${fmt(result.goalAmountCents)} by ${label}, you'd set aside about ${fmt(required)}/mo — but you're over your monthly plan right now, so that's budget you don't have yet.`,
      detail: 'A later date would ask less each month. Illustration, not advice — assumes steady saving, no investment growth.',
      facts,
      source: GOALS_SOURCE,
      action,
    };
  }

  if (result.withinSafeToSpend === false) {
    return {
      kind: 'savings_goal_by_date',
      headline: `Saving ${fmt(result.goalAmountCents)} by ${label} would take about ${fmt(required)}/mo — about ${sharePct} of your safe-to-spend, beyond a single month's budget.`,
      detail: 'A later date would ask less of your budget each month. Illustration, not advice — assumes steady saving, no investment growth.',
      facts,
      source: GOALS_SOURCE,
      action,
    };
  }

  return {
    kind: 'savings_goal_by_date',
    headline: `To save ${fmt(result.goalAmountCents)} by ${label}, set aside about ${fmt(required)}/mo — about ${sharePct} of your safe-to-spend.`,
    detail: `That reaches your goal around ${byMonth}. Illustration, not advice — assumes steady saving, no investment growth.`,
    facts,
    source: GOALS_SOURCE,
    action,
  };
}

// ─── retire at a target age (inverse planning, DECISIONS #131) ────────────────

const RETIREMENT_SOURCE: AssistantSource = { label: 'Open retirement outlook', href: '/investments' };

/**
 * Inverse retirement planner answer: a stated AGE → the minimal extra/mo the SOLVER found to
 * make the portfolio last to the plan-through age, with honest feasibility. Every figure is
 * precomputed by solveRetireAtAge over the SAME getCoachData + planning dials the /investments
 * outlook uses — this formatter only selects and phrases them (no math), so it cannot originate
 * a number. Copy follows the coaching guardrails: illustration not advice, the today's-dollars
 * (after-inflation) assumption stated inline, no shame on a stretch target.
 */
export function answerRetireAtAge(result: RetireAtAgeResult, label: string): AssistantAnswer {
  const age = result.retirementAge;

  if (result.outcome === 'unreachable') {
    let headline: string;
    let detail: string;
    if (result.unreachableReason === 'age-in-past') {
      headline = `Age ${age} is at or before your age today — pick a later age to plan toward.`;
      detail = 'Set your current age in Settings if that looks off.';
    } else if (result.unreachableReason === 'age-after-end') {
      headline = `Age ${age} is at or past the age your plan runs through — choose a retirement age before then.`;
      detail = 'You can adjust your plan-through age in Settings.';
    } else {
      headline = `Retiring at ${age} right now, your savings can't cover about ${fmt(result.plannedAnnualWithdrawalCents)}/yr of spending.`;
      detail =
        "Retiring this moment leaves no time to add to your savings — a later age would give them room to grow. Illustration, not advice, in today's dollars.";
    }
    return { kind: 'retire_at_age', headline, detail, facts: [], source: RETIREMENT_SOURCE };
  }

  const action: AssistantGoalAction = { kind: 'save_retirement_age', targetAge: age, label };

  if (result.outcome === 'already-on-track') {
    return {
      kind: 'retire_at_age',
      headline: `You're on track to retire at ${age} — your current savings are projected to last.`,
      detail: `Your savings sustain about ${fmt(result.sustainableAnnualWithdrawalCents)}/yr against the ${fmt(result.plannedAnnualWithdrawalCents)}/yr you'd spend. Illustration, not advice — in today's dollars, returns and inflation as set.`,
      facts: [
        { label: 'Retirement age', value: String(age) },
        { label: 'Extra needed', value: `${fmt(0)}/mo` },
        { label: 'Projected nest egg', value: fmt(result.balanceAtRetirementCents) },
      ],
      source: RETIREMENT_SOURCE,
      action,
    };
  }

  // reachable — a finite extra makes it last; affordability is reported, never hidden.
  const required = result.requiredAdditionalMonthlyCents as number;
  // share is null IFF safe-to-spend ≤ 0 (the engine guards it), so a null share in the
  // reachable case means the user is overspent / has no room this month.
  const sharePct = result.shareOfSafeToSpendBps !== null ? pctFromBps(result.shareOfSafeToSpendBps) : null;
  const facts: AssistantFact[] = [
    { label: 'Retirement age', value: String(age) },
    { label: 'Extra needed', value: `${fmt(required)}/mo` },
    { label: 'Projected nest egg', value: fmt(result.balanceAtRetirementCents) },
    ...(sharePct ? [{ label: 'Share of safe-to-spend', value: sharePct }] : []),
  ];

  if (sharePct === null) {
    // Overspent: a real figure, but honestly flagged as budget they don't have yet — NOT a
    // fake "just add $X/mo" yes for exactly the cohort that most needs the caveat.
    return {
      kind: 'retire_at_age',
      headline: `To retire at ${age}, you'd add about ${fmt(required)}/mo to your investing — but you're over your monthly plan right now, so that's budget you don't have yet.`,
      detail: "A later age would ask less each month. Illustration, not advice — in today's dollars, after-inflation growth.",
      facts,
      source: RETIREMENT_SOURCE,
      action,
    };
  }

  if (result.withinSafeToSpend === false) {
    return {
      kind: 'retire_at_age',
      headline: `Retiring at ${age} would take about ${fmt(required)}/mo more into investments — about ${sharePct} of your safe-to-spend, beyond a single month's budget.`,
      detail: "A later age would ask less of your budget each month. Illustration, not advice — in today's dollars, after-inflation growth.",
      facts,
      source: RETIREMENT_SOURCE,
      action,
    };
  }

  return {
    kind: 'retire_at_age',
    headline: `To retire at ${age}, add about ${fmt(required)}/mo to your investing — about ${sharePct} of your safe-to-spend.`,
    detail: "That's projected to make your savings last through your plan-through age. Illustration, not advice — in today's dollars, after-inflation growth.",
    facts,
    source: RETIREMENT_SOURCE,
    action,
  };
}

// ─── subscriptions ──────────────────────────────────────────────────────────

export function answerSubscriptions(summary: RecurringSummary): AssistantAnswer {
  const source: AssistantSource = { label: 'See subscriptions', href: '/recurring' };
  if (summary.activeSubscriptionCount === 0) {
    return { kind: 'subscriptions', headline: "I'm not detecting any active subscriptions yet.", facts: [], source };
  }
  const facts = summary.subscriptions
    .slice(0, 5)
    .map((s) => ({ label: s.merchantCanonical, value: `${fmt(s.monthlyEquivalentCents)}/mo` }));
  // #166: the headline must total SUBSCRIPTIONS only. monthlyRecurringSpendCents
  // is subs + bills, so the old copy attributed rent/loans to "subscriptions"
  // (~7× off for the demo: $2,552.43 claimed vs the true $367.43) — visibly
  // contradicting its own top-5 facts list.
  const subsMonthlyCents = summary.subscriptions.reduce((a, s) => a + s.monthlyEquivalentCents, 0);
  const billsMonthlyCents = summary.bills.reduce((a, s) => a + s.monthlyEquivalentCents, 0);
  const detailParts: string[] = [];
  if (billsMonthlyCents > 0) {
    detailParts.push(
      `Recurring bills (rent, loans, utilities) add ${fmt(billsMonthlyCents)}/mo on top — ${fmt(summary.monthlyRecurringSpendCents)}/mo of recurring charges in total.`,
    );
  }
  if (summary.priceIncreases.length > 0) {
    detailParts.push(
      `${summary.priceIncreases.length} ${summary.priceIncreases.length === 1 ? 'subscription has' : 'subscriptions have'} gone up in price recently.`,
    );
  }
  return {
    kind: 'subscriptions',
    headline: `You're paying about ${fmt(subsMonthlyCents)}/mo across ${summary.activeSubscriptionCount} active ${summary.activeSubscriptionCount === 1 ? 'subscription' : 'subscriptions'}.`,
    detail: detailParts.length > 0 ? detailParts.join(' ') : undefined,
    facts,
    source,
  };
}

// ─── forecast ───────────────────────────────────────────────────────────────

export function answerForecast(forecast: Forecast, accountName: string, horizonDays: number): AssistantAnswer {
  const source: AssistantSource = { label: 'Open forecast', href: '/forecast' };
  const detail = 'Based only on your known recurring income and bills — one-off spending isn’t projected.';
  if (forecast.firstNegativeDate) {
    return {
      kind: 'forecast',
      headline: `Heads up — ${accountName} is projected to dip below ${fmt(0)} around ${humanDate(forecast.firstNegativeDate)}.`,
      detail,
      facts: [
        { label: 'Today', value: fmt(forecast.startingBalanceCents) },
        { label: 'Lowest point', value: `${fmt(forecast.lowest.balanceCents)} · ${humanDate(forecast.lowest.date)}` },
      ],
      source,
    };
  }
  return {
    kind: 'forecast',
    headline: `${accountName} is projected at ${fmt(forecast.endingBalanceCents)} in ${horizonDays} days.`,
    detail,
    facts: [
      { label: 'Today', value: fmt(forecast.startingBalanceCents) },
      { label: 'Lowest point', value: `${fmt(forecast.lowest.balanceCents)} · ${humanDate(forecast.lowest.date)}` },
      { label: 'Money in', value: fmt(forecast.totalInflowCents) },
      { label: 'Money out', value: fmt(forecast.totalOutflowCents) },
    ],
    source,
  };
}

// ─── savings rate ───────────────────────────────────────────────────────────

export function answerSavingsRate(input: {
  rateBps: number | null;
  incomeCents: number;
  expensesCents: number;
  monthLabel: string;
}): AssistantAnswer {
  const source: AssistantSource = { label: 'Open coach', href: '/coach' };
  if (input.rateBps === null) {
    return {
      kind: 'savings_rate',
      headline: "I don't have a full month of income yet to compute a savings rate.",
      facts: [],
      source,
    };
  }
  const pct = (input.rateBps / 100).toFixed(1);
  const saved = input.incomeCents - input.expensesCents;
  return {
    kind: 'savings_rate',
    headline: `Your savings rate was ${pct}% in ${input.monthLabel}.`,
    detail: `You kept ${fmt(saved)} of ${fmt(input.incomeCents)} in income that month.`,
    facts: [
      { label: 'Income', value: fmt(input.incomeCents) },
      { label: 'Expenses', value: fmt(input.expensesCents) },
    ],
    source,
  };
}

// ─── unknown / capabilities ─────────────────────────────────────────────────

export const ASSISTANT_SUGGESTIONS: readonly string[] = [
  'What is my net worth?',
  'How much did I spend on groceries last month?',
  'How much can I safely spend this month?',
  'How much did I spend at Costco this month?',
  'What subscriptions am I paying for?',
  'Will I run out of money in the next 90 days?',
  'What was my biggest purchase this month?',
  'When will I be debt-free?',
  'Can I be debt-free by December 2028?',
  'Can I save $20,000 by December 2028?',
  'Can I retire at 60?',
];

export function answerUnknown(): AssistantAnswer {
  return {
    kind: 'unknown',
    headline: 'I can answer questions grounded in your own accounts and transactions.',
    detail:
      'Try asking about net worth, spending by category, month, or a specific store, safe-to-spend, what you owe on your cards, subscriptions, your 90-day forecast, income, or savings rate.',
    facts: [],
    suggestions: [...ASSISTANT_SUGGESTIONS],
  };
}
