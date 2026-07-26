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
import type { SpendingPlan, SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';
import type { RecurringSummary } from '@/lib/engine/recurring/summary';
import type { Forecast } from '@/lib/engine/forecast/forecast';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import {
  type CardDuplicatePairInput,
  cardDuplicateAnswerNote,
  cardDuplicateUndatedNote,
} from '@/lib/engine/account/card-duplicate-view';
import {
  frozenCardsNote,
  frozenFundingNote,
  frozenListedBalancesNote,
  frozenNothingDueNote,
  frozenQuotedBalanceNote,
  frozenTotalNote,
} from '@/lib/engine/account/feed-dropped-view';
import type { LargestTxn } from '@/lib/engine/trends/trends';
import { CATEGORY_BY_ID, type CategoryMeta } from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { addMonthsClamped, compareDates, formatMonth, isoDate } from '@/lib/dates';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { DebtPayoffResult } from '@/lib/engine/debt/payoff';
import type { DebtFreeByDateResult } from '@/lib/engine/solve/debt-free-by-date';
import type { SavingsGoalByDateResult } from '@/lib/engine/solve/savings-goal-by-date';
import type { RetireAtAgeResult } from '@/lib/engine/solve/retire-at-age';
import type { AssistantIntent, SpendTarget, Timeframe } from './intent';
// Type-only (erased at runtime) — trace.ts imports runtime values FROM this file,
// so a value import would cycle; a type import does not. The server attaches the
// trace object; the client reads it to render the reconciliation panel (slice 2).
import type { AnswerTrace } from './trace';
// Runtime import is safe: trace-view is dependency-light and imports only TYPES
// from this module's graph (no cycle). Shared so the savings-rate headline and
// the derivation panel format the same bps through the same function (slice 3).
import { bpsToPct1dp } from './trace-view';
import { accountLabel } from '@/lib/engine/account/display-name';

export interface AssistantFact {
  label: string;
  value: string;
  /** Glass-Box slice 2b: the trace-group key (categoryId) whose rows reconcile
   *  this fact's figure. Set ONLY by builders whose facts are per-category sums
   *  the trace groups by (spend_total / umbrella spend_by_category /
   *  top_categories) — facts are TAGGED at build time, never matched back to
   *  groups by display string (the slice-1 critic's fragility finding). Absent →
   *  the fact is not tappable (largest runner-ups, account balances, details). */
  traceKey?: string;
  /** The fact's own integer cents, from the SAME breakdown entry the builder
   *  formatted into `value` — the per-fact analog of `headlineCents`, so the
   *  UI's tap gate (`factView`) is a real equality check against the trace
   *  group's independently recomputed amount, not a self-comparison. */
  cents?: number;
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
  /** The exact integer cents of the figure embedded in `headline`, set ONLY by
   *  builders whose figure a trace can honor — the row-sum family (slice 2) and
   *  the cents-headline derivation kinds net_worth / cash_needed (slice 3) —
   *  always from the builder's OWN computed figure, independent of the trace,
   *  so the trace's drift check is a real equality gate, not a self-comparison.
   *  Absent for untraced intents and empty results (no number to reconcile →
   *  the UI keeps them non-tappable). */
  headlineCents?: number;
  /** savings_rate only (slice 3): the rate embedded in `headline`, in BASIS
   *  POINTS (not cents — the figure is a percent). The builder's own value, so
   *  the derivation trace's recompute-vs-displayed equality is a real gate.
   *  Absent when no rate exists (income ≤ 0 → no figure, no tap). */
  headlineBps?: number;
  /** The reconciliation for the headline figure: a row-sum trace computed by
   *  the server after the answer is built (slice 2), or a derivation trace
   *  ("formula + inputs", slice 3) attached where the engine result is live.
   *  The client renders the matching inline panel; a `not_row_sum` / absent
   *  trace stays non-tappable. Never offered for a figure a trace can't honor. */
  trace?: AnswerTrace;
  /** One supporting sentence — assumptions or context (never a new number). */
  detail?: string;
  facts: AssistantFact[];
  /** Where the full view lives, for "show me more" grounding. */
  source?: AssistantSource;
  /** Follow-up question chips — contextual per intent (#197) or the unknown
   *  capabilities list from answerUnknown(). */
  suggestions?: string[];
  /** True when the routing came from the LLM classifier (an inference, not an
   *  exact phrase match) — surfaced in the UI so the guess is never silent. Also set
   *  for a `flagged` learned phrase, which is an inference on trial. */
  interpreted?: boolean;
  /** Set when this user's LEARNED vocabulary routed the question (TASKS 2.3). The
   *  entry supplied only the intent KIND; every figure below still comes from the
   *  same engines. Surfaced so the adaptation is visible, with `entryId` carrying
   *  the one-click undo (the server re-scopes it to the caller). */
  learned?: { entryId: string; phrase: string; status: 'flagged' | 'active' };
  /** An optional confirm-before-create action the UI may surface (e.g. save a goal). */
  action?: AssistantGoalAction;
  /** The resolved intent, echoed so the next turn can resolve an ellipsis against
   *  it ("what about last month?" — TASKS 2.1). Set by the server orchestrator,
   *  never by an answer formatter; absent for `unknown` (nothing to carry). The
   *  client hands it straight back, so the server re-validates it on arrival. */
  intent?: AssistantIntent;
}

const fmt = (n: number) => formatCents(n as Cents);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM-DD' → 'Mon D, YYYY', without a Date object (business-date safe).
 *  Exported (slice-3 critic F3): the derivation panel's "Needed by" footer
 *  restates the cash-needed headline's own date claim, so both must format it
 *  through THIS one function — never two renderings of the same claim. */
export function humanDate(s: string): string {
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
  /**
   * YYYY-MM-DD the bank stopped sharing this account, else null (TASKS L.18).
   *
   * The snapshot has carried this since L.14 and this narrow re-declaration was where it was lost:
   * every balance the assistant quotes comes through here, so a shape that cannot see the flag is a
   * surface that cannot qualify its own figures. REQUIRED rather than optional for that reason — an
   * omitted flag reads as "this balance is live", which is the claim being corrected.
   */
  feedDroppedAt: string | null;
}

/**
 * The snapshot's account shape carries `feedDroppedAt` as OPTIONAL (older fixtures omit it); the
 * assistant's carries it as required. Normalize once, here, rather than at each `buildAnswer` case —
 * the `server/radar.ts` boundary precedent, and the reason is `fence-by-construction`: a conversion
 * copied per call site is a conversion some future call site will not copy.
 */
export function assistantAccounts(
  accounts: readonly (Omit<AccountLike, 'feedDroppedAt'> & { feedDroppedAt?: string | null })[],
  /**
   * `FinanceSnapshot.supersededAccountIds` — the predecessor side of an active reconciliation.
   *
   * REQUIRED, because of critic P0-2: `applyReconciliationBoundary` zeroes such a row's balance and
   * keeps every other field, `feedDroppedAt` included. Reading the flag raw made the assistant say
   * a $0.00 row's "last figure is still counted in your net worth" — on the very panel a reader
   * opens to audit the number, three lines under that row printing $0.00. It is not counted; the
   * boundary already removed it. Clearing the stamp here means no builder downstream can make the
   * claim, which is the same fix `/coach` carries (server/coach.ts) and the same defect L.14's own
   * critic P0-1 found on the dashboard banner.
   */
  supersededIds: ReadonlySet<string>,
): AccountLike[] {
  return accounts.map((a) => ({
    ...a,
    feedDroppedAt: supersededIds.has(a.id) ? null : (a.feedDroppedAt ?? null),
  }));
}

/** The frozen rows among a set the answer is about to quote, labelled as the answer names them. */
function frozenRowsOf(accounts: readonly AccountLike[]): { label: string; frozenSince: string }[] {
  return accounts
    .filter((a) => a.feedDroppedAt != null)
    .map((a) => ({ label: accountLabel(a), frozenSince: a.feedDroppedAt as string }));
}

/** Appends a disclosure to a `detail` that may or may not already carry one. */
function withDetail(base: string | undefined, note: string | null): string | undefined {
  if (!note) return base;
  return base === undefined ? note : `${base} ${note}`;
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
    // Slice 3: the builder's own figure — the independent half of the
    // derivation trace's drift gate (traceNetWorthDerivation reshapes the
    // accounts separately and must land on exactly this number).
    // No accounts → no computed figure, no tap (slice-3 critic F6): "$0.00" with
    // an empty formula panel behind it is a hollow reconciliation, not a real one.
    ...(accounts.length > 0 ? { headlineCents: net } : {}),
    // TASKS L.18. The headline is a total over every account, so a frozen one is inside it by
    // definition — there is no counterfactual to check here, unlike a duplicate. The trace behind
    // this figure carries the same fact as a basis line; the reconciliation itself is untouched,
    // because the rows really do sum to the headline whether or not a balance is current.
    detail: withDetail(
      "Everything you own minus everything you owe, across every account you've linked or added.",
      frozenTotalNote(frozenRowsOf(accounts), {
        figureLabel: 'your net worth',
        nextStep: 'accounts-route',
      }),
    ) as string,
    facts: [
      { label: 'Assets', value: fmt(assets) },
      { label: 'Liabilities', value: fmt(liabilities) },
    ],
    source: { label: 'See accounts', href: '/accounts' },
  };
}

// ─── account balance ────────────────────────────────────────────────────────

export function answerAccountBalance(
  accounts: readonly AccountLike[],
  query: string,
  /** Reconciled predecessor id → terminal successor id (slice-6 critic C-5). A superseded
   *  predecessor is boundary-zeroed — answering its "$0.00" would be a false money claim, and
   *  counting it beside its successor reports one real account as two. Matching still SEES
   *  predecessors (their old name is exactly what the user may ask by), but every match and
   *  every listed fact folds onto the account that actually carries the money. */
  successorOf: ReadonlyMap<string, string> = new Map(),
): AssistantAnswer {
  const q = query.toLowerCase();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const foldMatches = (raw: readonly AccountLike[]): { folded: AccountLike[]; foldedFrom: string[] } => {
    const foldedFrom: string[] = [];
    const seen = new Set<string>();
    const folded: AccountLike[] = [];
    for (const a of raw) {
      const succId = successorOf.get(a.id);
      const target = succId !== undefined ? (byId.get(succId) ?? a) : a;
      if (succId !== undefined && byId.has(succId)) foldedFrom.push(accountLabel(a));
      if (!seen.has(target.id)) {
        seen.add(target.id);
        folded.push(target);
      }
    }
    return { folded, foldedFrom };
  };
  const visible = accounts.filter((a) => !successorOf.has(a.id));
  const typeHit = TYPE_WORDS.find((t) => t.re.test(q));
  let rawMatches: AccountLike[] = [];
  if (typeHit) rawMatches = accounts.filter((a) => a.type === typeHit.type);
  if (rawMatches.length === 0) {
    // The FEED name only, deliberately (TASKS L.7 critic F3). Matching the user's own nickname
    // too is the better product, but the branch below sums every match with no
    // `isLiabilityType` handling — so a second, short, user-chosen string reaching this matcher
    // can turn one correct answer into a total that ADDS money owed to money held and states
    // it as a balance (executed by the critic: a card renamed "Everyday Card" alongside
    // "Everyday Checking" answered "$6,348.11 across 2 accounts"). The mixed-kind total is a
    // pre-existing defect; widening the matcher into it is not. Nickname matching returns with
    // that fix, recorded in STATUS.
    rawMatches = accounts.filter((a) =>
      a.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((w) => w.length >= 4 && !GENERIC_NAME_WORD.has(w) && q.includes(w)),
    );
  }
  const { folded: matches, foldedFrom } = foldMatches(rawMatches);
  // Disclosed only when a fold actually changed what the user asked about (their word
  // named the OLD account) — a plain type query over live accounts stays undecorated.
  const foldNote =
    foldedFrom.length > 0
      ? `${foldedFrom.join(' and ')} was combined into its connected account, so it counts once.`
      : undefined;

  // TASKS L.18. Resolved against the accounts each BRANCH actually quotes, not against the whole
  // snapshot: the no-match branch lists `visible`, the single branch quotes exactly one row, and
  // the multi branch sums `matches`. A frozen account nowhere in the answer is nowhere in the
  // disclosure either — the reader would have no figure to attach it to.
  if (matches.length === 0) {
    return {
      kind: 'account_balance',
      headline: "I couldn't find an account matching that.",
      detail: withDetail(
        'Here are the accounts I can see.',
        // This branch LISTS balances rather than summing them, so a frozen row is not "counted in"
        // anything (critic P3-5) — it is one of the figures on the list. Named per row, with the
        // account named because the list has several.
        frozenListedBalancesNote(frozenRowsOf(visible)),
      ) as string,
      facts: visible.map((a) => ({ label: accountLabel(a), value: fmt(a.currentBalanceCents) })),
      source: { label: 'See accounts', href: '/accounts' },
    };
  }
  if (matches.length === 1) {
    const a = matches[0];
    const owed = isLiabilityType(a.type);
    // The figure IS this account's balance, so the claim is not "a stale number is inside a total"
    // but "this number is the last one we saw" — a different sentence, deliberately.
    const detail = withDetail(
      foldNote,
      a.feedDroppedAt != null
        ? frozenQuotedBalanceNote({ frozenSince: a.feedDroppedAt }, { nextStep: 'accounts-route' })
        : null,
    );
    return {
      kind: 'account_balance',
      headline: `${accountLabel(a)} ${owed ? 'has a balance of' : 'has'} ${fmt(a.currentBalanceCents)}${owed ? ' owed' : ''}.`,
      ...(detail !== undefined ? { detail } : {}),
      facts: [{ label: accountLabel(a), value: fmt(a.currentBalanceCents) }],
      source: { label: 'See accounts', href: '/accounts' },
    };
  }
  const total = matches.reduce((s, a) => s + a.currentBalanceCents, 0);
  const detail = withDetail(
    foldNote,
    frozenTotalNote(frozenRowsOf(matches), {
      figureLabel: 'this total',
      nextStep: 'accounts-route',
    }),
  );
  return {
    kind: 'account_balance',
    headline: `${fmt(total)} across ${matches.length} accounts.`,
    ...(detail !== undefined ? { detail } : {}),
    facts: matches.map((a) => ({ label: accountLabel(a), value: fmt(a.currentBalanceCents) })),
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
    headlineCents: breakdown.totalCents,
    detail: 'Purchases only — transfers, credit-card payments, and income are excluded.',
    // Tagged (slice 2b): each top category is a trace group, so its figure is
    // independently tappable. traceKey/cents come from the SAME breakdown entry.
    facts: breakdown.byCategory
      .slice(0, 3)
      .map((c) => ({ label: c.name, value: fmt(c.amountCents), traceKey: c.categoryId, cents: c.amountCents })),
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
    // Tagged (slice 2b): each member category is a trace group when >1 are cited.
    for (const c of matches.slice(0, 3))
      facts.push({ label: c.name, value: fmt(c.amountCents), traceKey: c.categoryId, cents: c.amountCents });
  } else {
    const g = breakdown.byGroup.find((x) => x.group === target.group);
    amount = g?.amountCents ?? 0;
    for (const c of g?.categories.slice(0, 3) ?? [])
      facts.push({ label: c.name, value: fmt(c.amountCents), traceKey: c.categoryId, cents: c.amountCents });
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
    headlineCents: amount,
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
    // The headline figure is the TOP category's amount — exactly what the trace
    // reconciles (the period total in `detail` is NOT traced, so it stays untapped).
    headlineCents: top[0].amountCents,
    detail: `Total ${tf.label}: ${fmt(breakdown.totalCents)}.`,
    // Tagged (slice 2b): every listed category rides in the trace as a reconciled
    // group, so each fact is independently tappable — including the non-top ones
    // the HEADLINE panel honestly hides (they don't sum to the tapped figure).
    facts: top.map((c) => ({ label: c.name, value: fmt(c.amountCents), traceKey: c.categoryId, cents: c.amountCents })),
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

/** A raw snapshot transaction as the assistant reads it. `categoryId` and
 *  `isSplitParent` are present on DB rows at runtime (declared here instead of
 *  re-cast at each call site — GLASSBOX_PLAN readiness note). */
export interface SnapshotTxnLike {
  date: string;
  amountCents: number;
  rawDescriptor: string;
  status: string;
  isTransfer: boolean;
  isSplitParent?: boolean;
  categoryId?: string | null;
}

/** POSTED-only purchase rows with a derived canonical merchant — the shared input
 *  for both merchant intents (largest_purchases + merchant_spend) AND the
 *  Glass-Box trace, so all three read the same universe of purchases and can't
 *  diverge. (Moved from the server orchestrator for that lockstep.) */
export function toPurchaseRows(txns: readonly SnapshotTxnLike[]): PurchaseRow[] {
  return txns
    .filter((t) => t.status === 'POSTED')
    .map((t) => {
      const m = normalizeMerchant(t.rawDescriptor);
      return {
        date: t.date,
        amountCents: t.amountCents,
        categoryId: t.categoryId ?? m.categoryId,
        isTransfer: t.isTransfer,
        isSplitParent: t.isSplitParent ?? false,
        merchant: m.canonical,
      };
    });
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
  // Optional merchant scope (TASKS 2.7): same matching semantics as
  // merchantSpend (`merchantMatches` — punctuation-folded, whole-word prefix),
  // so "biggest purchase at costco" and "spend at costco" can never disagree
  // about which rows are Costco's. Absent → the global ranking, byte-identical
  // to before.
  merchant?: string,
): LargestTxn[] {
  return rows
    .filter((t) => {
      const ym = t.date.slice(0, 7);
      return (
        ym >= tf.fromYm &&
        ym <= tf.toYm &&
        t.date <= today &&
        isPurchaseRow(t, meta) &&
        (!merchant || merchantMatches(t.merchant, merchant))
      );
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

export function answerLargest(largest: readonly LargestTxn[], tf: Timeframe, merchant?: string): AssistantAnswer {
  if (largest.length === 0) {
    return {
      kind: 'largest_purchases',
      // Scoped empty case mirrors answerMerchantSpend's ("No spending at X"):
      // the query term title-cased, since no matched row can supply a name.
      headline: merchant ? `No purchases at ${titleCaseTerm(merchant)} ${tf.label}.` : `No purchases recorded ${tf.label}.`,
      facts: [],
      source: { label: 'See activity', href: '/transactions' },
    };
  }
  const top = largest[0];
  return {
    kind: 'largest_purchases',
    // Scoped: the store is the question's subject, so it leads — and it is the
    // TOP MATCH's canonical name (the row the figure comes from), never the
    // raw query term ("costco gas" rows under a "costco" query stay honest).
    headline: merchant
      ? `Your biggest purchase at ${top.merchant} ${tf.label} was ${fmt(top.amountCents)}.`
      : `Your biggest purchase ${tf.label} was ${fmt(top.amountCents)} at ${top.merchant}.`,
    // Only the single cited top row is traced (the runner-up facts are NOT in the
    // trace — GLASSBOX_PLAN slice-2 constraint (b), so they stay non-tappable).
    headlineCents: top.amountCents,
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
    headlineCents: res.totalCents,
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
    headlineCents: incomeCents,
    detail: 'Income only — transfers between your own accounts are excluded.',
    facts: [],
    source: REPORTS_SOURCE,
  };
}

// ─── guilt-free spending (formerly "safe to spend") ─────────────────────────

/**
 * `disclosures` is REQUIRED, not defaulted (the L.15 lesson: a defaulted
 * disclosure argument fails silent at exactly the caller that forgets it).
 * The server resolves each against the set the card-payments term sums.
 */
export function answerSafeToSpend(
  plan: SpendingPlan,
  disclosures: SpendingPlanDisclosures,
): AssistantAnswer {
  const source: AssistantSource = { label: 'Open spending plan', href: '/spending-plan' };
  const facts: AssistantFact[] = [
    { label: 'Expected income', value: fmt(plan.expectedIncomeCents) },
    { label: 'Spent so far (outside credit cards)', value: fmt(plan.spentSoFarCents) },
    { label: 'Bills still due', value: fmt(plan.upcomingBillsCents) },
    {
      label: plan.cardObligationsEstimated
        ? 'Card payments due this month (estimated)'
        : 'Card payments due this month',
      value: fmt(plan.cardObligationsCents),
    },
    {
      label: plan.savingsSource === 'target' ? 'Savings target (Settings)' : 'Planned savings (goals)',
      value: fmt(plan.plannedSavingsCents),
    },
  ];
  // Each qualifier states its own DIRECTION, and states it for THE FIGURE THIS
  // BRANCH RENDERS (critic P1-1: the overspent branch shows the OVERAGE — the
  // negation of leftToSpend — so every "lower/higher" flips with it).
  // Directions never share a sentence (a-disclosure-is-several-claims lesson).
  const over = plan.overspent;
  const qualifiers: string[] = [];
  // The all-estimate state (cycle-2 critic F2-1): this answer is untraced, so
  // the trace's estimate basis can never reach the reader — the qualifier must
  // live here, or Ask claims statement provenance the term does not have.
  if (plan.cardObligationsEstimated) {
    qualifiers.push(
      'No statement has been generated yet, so the card-payments figure is estimated from current balances.',
    );
  }
  if (disclosures.undatedCards.length > 0) {
    const names = disclosures.undatedCards.map((c) => c.cardName).join(', ');
    const one = disclosures.undatedCards.length === 1;
    qualifiers.push(
      `${one ? 'One card has' : `${disclosures.undatedCards.length} cards have`} a balance but no due date yet (${names}) — ${one ? 'its payment is' : 'their payments are'} not in the card-payments figure, so ${over ? 'the real overage may be higher than shown' : 'the real amount free to spend may be lower than shown'}.`,
    );
  }
  if (disclosures.statementPendingCards.length > 0) {
    const parts = disclosures.statementPendingCards
      .map((c) => `${c.cardName} (due around ${c.dueDate})`)
      .join('; ');
    qualifiers.push(
      `${disclosures.statementPendingCards.length === 1 ? 'A statement has' : 'Statements have'} not been generated yet for ${parts}, so ${disclosures.statementPendingCards.length === 1 ? 'that payment is' : 'those payments are'} not counted — ${over ? 'the real overage may be higher than shown' : 'the real amount free to spend may be lower than shown'}.`,
    );
  }
  if (disclosures.duplicatePairs.length > 0) {
    const pairLines = disclosures.duplicatePairs.map((p) => `${p.aName} and ${p.bName}`).join('; ');
    qualifiers.push(
      `Two cards behind the card-payments figure (${pairLines}) look like the same card counted twice. If so, that figure is higher than you owe and ${over ? 'the real overage is smaller than shown' : 'the real amount free to spend is higher than shown'}. No amount was adjusted — only you can confirm it, on Accounts.`,
    );
  }
  if (disclosures.frozenCards.length > 0) {
    const names = disclosures.frozenCards.map((c) => c.label).join(', ');
    qualifiers.push(
      `The bank stopped sharing ${disclosures.frozenCards.length === 1 ? 'one card behind the card-payments figure' : `${disclosures.frozenCards.length} cards behind the card-payments figure`} (${names}), so ${disclosures.frozenCards.length === 1 ? 'its amount' : 'their amounts'} may be stale.`,
    );
  }
  const withQualifiers = (base: string) => [base, ...qualifiers].join(' ');
  if (plan.overspent) {
    return {
      kind: 'safe_to_spend',
      headline: `You're ${fmt(-plan.leftToSpendCents)} over your plan for this month.`,
      detail: withQualifiers(
        'That counts what you have left after spending outside your cards, bills still due, card payments due this month, and planned savings.',
      ),
      facts,
      source,
    };
  }
  return {
    kind: 'safe_to_spend',
    headline: `You have ${fmt(plan.leftToSpendCents)} guilt-free to spend this month — about ${fmt(plan.perDayCents)}/day for the next ${plan.daysLeftInMonth} days.`,
    detail: withQualifiers(
      'After the bills still due this month, the card payments due this month, and your planned savings. Card purchases count once, in the month their statement’s payment is due — not again at purchase time.',
    ),
    facts,
    source,
  };
}

// ─── cash needed (pay cards this cycle) ─────────────────────────────────────

export function answerCashNeeded(
  result: CashNeededResult,
  paymentAccountName: string,
  /**
   * Suspected same-card-twice pairs among the asker's own cards (TASKS L.15 (e)). Advisory — no
   * figure below is adjusted. Omitted ⇒ byte-identical to the pre-L.15 answer.
   */
  cardDuplicates: readonly CardDuplicatePairInput[] = [],
): AssistantAnswer {
  const s = result.headline;
  const source: AssistantSource = { label: 'See cards', href: '/cards' };
  // A card the engine could not date is absent from cardsDueCount, so "nothing is
  // due" would be a false all-clear for exactly the case this branch is most likely
  // to hit: a linked card whose issuer sent no statement (owner-reported
  // 2026-07-23). Name the gap instead of answering past it.
  const undated = result.unknownDueDateCards;
  const undatedFact: AssistantFact[] =
    undated.length > 0
      ? [{ label: 'No due date yet', value: undated.map((c) => c.cardName).join(', ') }]
      : [];
  if (s.cardsDueCount === 0 || s.requiredCents === 0) {
    // L.15 critic F4: this branch states a COUNT of undated cards and names them, and a duplicated
    // pair inflates both. It was first scoped out because the pair is in no AMOUNT here — which is
    // true, and is exactly why the note below says so rather than borrowing the counted wording.
    const undatedNotes = cardDuplicateUndatedNote(
      cardDuplicates,
      undated.map((c) => ({ cardId: c.cardId, label: c.cardName })),
    );
    /**
     * TASKS L.18, and the most expensive claim in the slice: this branch is an ALL-CLEAR. A card
     * whose bank stopped sharing it is exactly a card whose new statement could not have arrived,
     * so a paid-off frozen card and a card with a fresh unseen statement produce the identical
     * silence here. Resolved over EVERY frozen card the result knows about — dated and undated
     * alike — because the claim this branch makes is about all of them, not about a printed row.
     */
    const nothingDueNote = frozenNothingDueNote(
      [...result.cards, ...undated]
        .filter((c) => c.frozenSince != null)
        .map((c) => ({
          label: c.cardName,
          frozenSince: c.frozenSince as string,
          // The assistant reads `getCashNeeded(userId)` at PERSONAL scope — no household merge —
          // so every card here is the asker's own.
          ownership: 'reader' as const,
          // `CashNeededResult` carries card obligations only; loans reach a surface through
          // `selectLoanObligations`, which this branch does not read (TASKS L.19).
          kind: 'card' as const,
          // `missing` describes an undatable LOAN's absent field; a card is never one.
          missing: null,
        })),
      { nextStep: 'accounts-route' },
    );
    const zeroDueDetail = withDetail(
      undatedNotes.length > 0 ? undatedNotes.join(' ') : undefined,
      nothingDueNote,
    );
    return {
      kind: 'cash_needed',
      headline:
        undated.length > 0
          ? `Nothing is due on the cards I can date — but ${undated.length === 1 ? 'one card has' : `${undated.length} cards have`} no statement or due date yet, so I can’t tell you what’s due on ${undated.length === 1 ? 'it' : 'them'}.`
          : 'You have nothing due on your cards this cycle.',
      ...(zeroDueDetail !== undefined ? { detail: zeroDueDetail } : {}),
      facts: undatedFact,
      source,
    };
  }
  const facts: AssistantFact[] = [
    { label: 'Cards due', value: String(s.cardsDueCount) },
    { label: 'From', value: paymentAccountName },
    ...undatedFact,
  ];
  const detailParts: string[] = [];
  /**
   * Resolved against the COUNTED rows only — the obligations `perDueDate` partitions, which are
   * exactly the rows summed into `requiredCents` and counted by `cardsDueCount`. Both of the
   * figures this answer states are therefore genuinely inflated by such a pair, which is what makes
   * the note's claim precisely true rather than approximately so.
   *
   * Computed HERE, below the zero-due early return, not at the top of the function: on that branch
   * there is no figure and no count for the note to qualify, and reaching into `perDueDate` before
   * the guard made the whole builder throw on a result that legitimately has none.
   *
   * A pair whose cards are UNDATED is deliberately out of scope: it is in neither figure, so this
   * sentence would be false about it, and the surfaces that DO name undated cards (/cards, the
   * dashboard, now the calendar and the two emails) disclose it correctly. Recorded as a residual.
   *
   * Pushed BEFORE the shortfall instruction, deliberately. A shortfall is derived from
   * `requiredCents`, so a duplicated card can manufacture one — and the instruction that follows
   * tells the reader to move cash they may not need to move. The qualifier has to reach them first.
   */
  detailParts.push(
    ...cardDuplicateAnswerNote(
      cardDuplicates,
      (result.perDueDate ?? []).flatMap((p) =>
        p.cards.map((c) => ({ cardId: c.cardId, label: c.cardName })),
      ),
    ),
  );
  /**
   * TASKS L.18 — the frozen CARDS behind the two figures this answer states, resolved against the
   * same counted set the duplicate note uses (`perDueDate`, i.e. exactly what `requiredCents` sums
   * and `cardsDueCount` counts) and read off `result.cards` for the flag and the estimate path.
   * `role: 'instruction'` (critic P2-8): the headline is an amount AND a by-date — "You need
   * $2,179.99 by Jun 15 to pay your cards in full" is something the reader acts on, and /cards
   * qualifies the same `requiredCents`-derived figure the same way. This answer is also the surface
   * most likely to be read on its own.
   */
  const countedIds = new Set((result.perDueDate ?? []).flatMap((p) => p.cards.map((c) => c.cardId)));
  detailParts.push(
    ...[
      frozenCardsNote(
        result.cards
          .filter((c) => c.frozenSince != null && countedIds.has(c.cardId))
          .map((c) => ({
            cardId: c.cardId,
            label: c.cardName,
            frozenSince: c.frozenSince as string,
            isEstimated: c.isEstimated,
            ownership: 'reader' as const,
          })),
        { role: 'instruction', nextStep: 'accounts-route' },
      ),
    ].filter((n): n is string => n !== null),
  );
  if (s.shortfallCents > 0 && s.recommendation) {
    facts.push({ label: 'Shortfall', value: fmt(s.shortfallCents) });
    detailParts.push(
      `That's more than ${paymentAccountName} holds — move ${fmt(s.recommendation.amountCents)} in by ${humanDate(s.recommendation.byDate)}.`,
    );
  }
  /**
   * The funding account, named with the label THIS answer prints for it (the "From" fact), and
   * placed last so it sits beside the transfer instruction it qualifies when there is one.
   *
   * Stated whether or not a shortfall is shown, because the silent case is the dangerous one: a
   * balance frozen HIGH produces no shortfall and no transfer at all, and the reader is told what
   * they need by a date with no hint that the account may not hold it. `role` follows what this
   * answer actually printed, not the engine's opinion of it.
   */
  if (result.fundingFrozen) {
    detailParts.push(
      frozenFundingNote(
        {
          label: paymentAccountName,
          frozenSince: result.fundingFrozen.frozenSince,
          balanceCents: result.fundingFrozen.balanceCents,
        },
        {
          role: s.shortfallCents > 0 && s.recommendation ? 'instruction' : 'figure',
          nextStep: 'accounts-route',
        },
      ),
    );
  }
  const detail: string | undefined = detailParts.length > 0 ? detailParts.join(' ') : undefined;
  return {
    kind: 'cash_needed',
    // "your cards" = all of them. Only true when every card could be dated.
    headline: `You need ${fmt(s.requiredCents)}${s.byDate ? ` by ${humanDate(s.byDate)}` : ''} to pay ${undated.length > 0 ? 'the cards I can date' : 'your cards'} in full.`,
    // Slice 3: the builder's own figure for the derivation trace's drift gate.
    // Set only on this path — the zero-due answer above has no figure to trace.
    headlineCents: s.requiredCents,
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
/**
 * One sentence naming the Settings savings-target reserve (critic F3), or ''
 * when there is none. Appended wherever a required monthly is weighed against
 * guilt-free spending: that figure is NET of this reserve, and a new plan is
 * exactly what the reserve exists to fund, so the comparison must name it.
 */
function savingsReserveNote(unallocatedSavingsCents: number, requiredMonthlyCents: number): string {
  if (unallocatedSavingsCents <= 0) return '';
  // The sentence may claim only what the reserve actually covers (cycle-2
  // critic F2-3: "this monthly amount can come out of that reserve" over a
  // $50 reserve and a $900 requirement overstated affordability — the
  // dangerous direction).
  const covers = unallocatedSavingsCents >= requiredMonthlyCents;
  return ` Your savings target in Settings already sets aside ${fmt(unallocatedSavingsCents)} of this month's income that isn't committed to a named goal — ${covers ? 'this monthly amount can come out of that reserve first' : `the first ${fmt(unallocatedSavingsCents)} of this monthly amount can come out of that reserve`}.`;
}

export function answerDebtFreeByDate(
  result: DebtFreeByDateResult,
  label: string,
  targetDate: string,
  today: string,
  /**
 * The Settings savings target's reserve beyond named goals (critic F3):
 * `plan.unallocatedSavingsCents`. REQUIRED, never defaulted (the L.15
 * lesson) — the share/affordability below compares a required monthly
 * against a figure that is NET of this reserve, and a new savings,
 * investing, or debt plan is exactly what pay-yourself-first money exists
 * to fund, so an answer that cannot name the reserve declares "beyond
 * budget" over money the user already set aside.
 */
  unallocatedSavingsCents: number,
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
    ...(sharePct ? [{ label: 'Share of guilt-free spending', value: sharePct }] : []),
  ];

  if (sharePct === null) {
    // Overspent: a real figure, but honestly flagged as budget they don't have yet — NOT a
    // fake "just add $X/mo" yes for exactly the cohort that most needs the caveat (UX-1).
    return {
      kind: 'debt_free_by_date',
      headline: `To be debt-free by ${label} you'd add about ${fmt(required)}/mo on top of your minimums — but you're over your monthly plan right now, so that's budget you don't have yet.`,
      detail: `A later date would ask less each month.${savingsReserveNote(unallocatedSavingsCents, required)} Illustration, not advice — assumes the least-interest (avalanche) order and APRs as entered.`,
      facts,
      source: DEBT_PLAN_SOURCE,
      action,
    };
  }

  if (result.withinSafeToSpend === false) {
    return {
      kind: 'debt_free_by_date',
      headline: `Being debt-free by ${label} would take about ${fmt(required)}/mo extra — about ${sharePct} of your guilt-free spending, beyond a single month's budget.`,
      detail: `A later date would ask less of your budget each month.${savingsReserveNote(unallocatedSavingsCents, required)} Illustration, not advice — assumes the least-interest (avalanche) order and APRs as entered.`,
      facts,
      source: DEBT_PLAN_SOURCE,
      action,
    };
  }

  return {
    kind: 'debt_free_by_date',
    headline: `To be debt-free by ${label}, add about ${fmt(required)}/mo on top of your minimums — about ${sharePct} of your guilt-free spending.`,
    detail: `That clears everything around ${byMonth} at the least-interest (avalanche) order.${savingsReserveNote(unallocatedSavingsCents, required)} Illustration, not advice — assumes APRs as entered and steady payments.`,
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
  /**
 * The Settings savings target's reserve beyond named goals (critic F3):
 * `plan.unallocatedSavingsCents`. REQUIRED, never defaulted (the L.15
 * lesson) — the share/affordability below compares a required monthly
 * against a figure that is NET of this reserve, and a new savings,
 * investing, or debt plan is exactly what pay-yourself-first money exists
 * to fund, so an answer that cannot name the reserve declares "beyond
 * budget" over money the user already set aside.
 */
  unallocatedSavingsCents: number,
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
    ...(sharePct ? [{ label: 'Share of guilt-free spending', value: sharePct }] : []),
  ];

  if (sharePct === null) {
    // Overspent: a real figure, but honestly flagged as budget they don't have yet — NOT a
    // fake "just set aside $X/mo" yes for exactly the cohort that most needs the caveat.
    return {
      kind: 'savings_goal_by_date',
      headline: `To save ${fmt(result.goalAmountCents)} by ${label}, you'd set aside about ${fmt(required)}/mo — but you're over your monthly plan right now, so that's budget you don't have yet.`,
      detail: `A later date would ask less each month.${savingsReserveNote(unallocatedSavingsCents, required)} Illustration, not advice — assumes steady saving, no investment growth.`,
      facts,
      source: GOALS_SOURCE,
      action,
    };
  }

  if (result.withinSafeToSpend === false) {
    return {
      kind: 'savings_goal_by_date',
      headline: `Saving ${fmt(result.goalAmountCents)} by ${label} would take about ${fmt(required)}/mo — about ${sharePct} of your guilt-free spending, beyond a single month's budget.`,
      detail: `A later date would ask less of your budget each month.${savingsReserveNote(unallocatedSavingsCents, required)} Illustration, not advice — assumes steady saving, no investment growth.`,
      facts,
      source: GOALS_SOURCE,
      action,
    };
  }

  return {
    kind: 'savings_goal_by_date',
    headline: `To save ${fmt(result.goalAmountCents)} by ${label}, set aside about ${fmt(required)}/mo — about ${sharePct} of your guilt-free spending.`,
    detail: `That reaches your goal around ${byMonth}.${savingsReserveNote(unallocatedSavingsCents, required)} Illustration, not advice — assumes steady saving, no investment growth.`,
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
export function answerRetireAtAge(
  result: RetireAtAgeResult,
  label: string,
  /**
 * The Settings savings target's reserve beyond named goals (critic F3):
 * `plan.unallocatedSavingsCents`. REQUIRED, never defaulted (the L.15
 * lesson) — the share/affordability below compares a required monthly
 * against a figure that is NET of this reserve, and a new savings,
 * investing, or debt plan is exactly what pay-yourself-first money exists
 * to fund, so an answer that cannot name the reserve declares "beyond
 * budget" over money the user already set aside.
 */
  unallocatedSavingsCents: number,
): AssistantAnswer {
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
    ...(sharePct ? [{ label: 'Share of guilt-free spending', value: sharePct }] : []),
  ];

  if (sharePct === null) {
    // Overspent: a real figure, but honestly flagged as budget they don't have yet — NOT a
    // fake "just add $X/mo" yes for exactly the cohort that most needs the caveat.
    return {
      kind: 'retire_at_age',
      headline: `To retire at ${age}, you'd add about ${fmt(required)}/mo to your investing — but you're over your monthly plan right now, so that's budget you don't have yet.`,
      detail: `A later age would ask less each month.${savingsReserveNote(unallocatedSavingsCents, required)} Illustration, not advice — in today's dollars, after-inflation growth.`,
      facts,
      source: RETIREMENT_SOURCE,
      action,
    };
  }

  if (result.withinSafeToSpend === false) {
    return {
      kind: 'retire_at_age',
      headline: `Retiring at ${age} would take about ${fmt(required)}/mo more into investments — about ${sharePct} of your guilt-free spending, beyond a single month's budget.`,
      detail: `A later age would ask less of your budget each month.${savingsReserveNote(unallocatedSavingsCents, required)} Illustration, not advice — in today's dollars, after-inflation growth.`,
      facts,
      source: RETIREMENT_SOURCE,
      action,
    };
  }

  return {
    kind: 'retire_at_age',
    headline: `To retire at ${age}, add about ${fmt(required)}/mo to your investing — about ${sharePct} of your guilt-free spending.`,
    detail: `That's projected to make your savings last through your plan-through age.${savingsReserveNote(unallocatedSavingsCents, required)} Illustration, not advice — in today's dollars, after-inflation growth.`,
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
  // ONE formatter for the percent (bpsToPct1dp) — the derivation panel renders
  // the same bps through the same function, so headline and panel can never
  // display two different roundings of the same rate (slice 3).
  const pct = bpsToPct1dp(input.rateBps);
  const saved = input.incomeCents - input.expensesCents;
  return {
    kind: 'savings_rate',
    headline: `Your savings rate was ${pct}% in ${input.monthLabel}.`,
    // The builder's own figure, in bps — the independent half of the derivation
    // trace's gate (the trace RECOMPUTES the rate from the month's flows).
    headlineBps: input.rateBps,
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
  'How much is guilt-free to spend this month?',
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
      'Try asking about net worth, spending by category, month, or a specific store, guilt-free spending, what you owe on your cards, subscriptions, your 90-day forecast, income, or savings rate.',
    facts: [],
    suggestions: [...ASSISTANT_SUGGESTIONS],
  };
}
