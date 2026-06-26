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
import { addMonthsClamped, formatMonth, isoDate } from '@/lib/dates';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { DebtPayoffResult } from '@/lib/engine/debt/payoff';
import type { AssistantIntent, SpendTarget, Timeframe } from './intent';

export interface AssistantFact {
  label: string;
  value: string;
}
export interface AssistantSource {
  label: string;
  href: string;
}
export interface AssistantAnswer {
  kind: AssistantIntent['kind'];
  /** The direct answer, in plain language with the figure embedded. */
  headline: string;
  /** One supporting sentence — assumptions or context (never a new number). */
  detail?: string;
  facts: AssistantFact[];
  /** Where the full view lives, for "show me more" grounding. */
  source?: AssistantSource;
  /** Follow-up question chips (used for the capabilities / unknown answer). */
  suggestions?: string[];
  /** True when the routing came from the LLM classifier (an inference, not an
   *  exact phrase match) — surfaced in the UI so the guess is never silent. */
  interpreted?: boolean;
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

// ─── subscriptions ──────────────────────────────────────────────────────────

export function answerSubscriptions(summary: RecurringSummary): AssistantAnswer {
  const source: AssistantSource = { label: 'See subscriptions', href: '/recurring' };
  if (summary.activeSubscriptionCount === 0) {
    return { kind: 'subscriptions', headline: "I'm not detecting any active subscriptions yet.", facts: [], source };
  }
  const facts = summary.subscriptions
    .slice(0, 5)
    .map((s) => ({ label: s.merchantCanonical, value: `${fmt(s.monthlyEquivalentCents)}/mo` }));
  let detail: string | undefined;
  if (summary.priceIncreases.length > 0) {
    detail = `${summary.priceIncreases.length} ${summary.priceIncreases.length === 1 ? 'subscription has' : 'subscriptions have'} gone up in price recently.`;
  }
  return {
    kind: 'subscriptions',
    headline: `You're paying about ${fmt(summary.monthlyRecurringSpendCents)}/mo across ${summary.activeSubscriptionCount} active ${summary.activeSubscriptionCount === 1 ? 'subscription' : 'subscriptions'}.`,
    detail,
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
  'What subscriptions am I paying for?',
  'Will I run out of money in the next 90 days?',
  'What was my biggest purchase this month?',
  'When will I be debt-free?',
];

export function answerUnknown(): AssistantAnswer {
  return {
    kind: 'unknown',
    headline: 'I can answer questions grounded in your own accounts and transactions.',
    detail:
      'Try asking about net worth, spending by category or month, safe-to-spend, what you owe on your cards, subscriptions, your 90-day forecast, income, or savings rate.',
    facts: [],
    suggestions: [...ASSISTANT_SUGGESTIONS],
  };
}
